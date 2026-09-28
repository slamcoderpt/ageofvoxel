// Scalability stress test: how the simulation (and the CPU side of rendering)
// scales with the number of units.
//
//   node scripts/stress.mjs [--port 4173] [--units 250,500,1000,2000,3000,4000]
//        [--ticks 600] [--warmup 150] [--frames 4] [--width 1280 --height 720]
//        [--params "players=6"] [--json out.json] [--timeout 900]
//
// Expects a running server with a production build
// (`npm run build && npx vite preview --port 4173`).
// For each N it loads ?scene=stress&units=N&prof=1 (6 players, towns,
// economies, 6 fronts fighting; src/core/scenes/stress.js) in headless
// Chromium, pauses the real loop and steps the fixed-step simulation directly
// (game.tick()), so the software GPU never limits it:
//   1. --warmup ticks (not recorded: JIT warm-up, armies close in),
//   2. --ticks recorded ticks: total sim ms, ms per system in game.simOrder,
//      per EnemyAI instance, selected sub-steps, pathfinding / target-search
//      call counts and ms (src/core/Profiler.js), entity counts, JS heap,
//   3. 60 more ticks counting spatial-hash queries and the entities they visit,
//   4. --frames rendered frames (0: none) with fog of war as in the scene, then --frames
//      with the whole map revealed (every unit drawn): CPU ms per render piece
//      and for lighting.draw(), draw calls and triangles per frame.
// Prints mean / p95 / max per system per N, the log-log growth exponent of
// each system between the smallest and largest N, and the CPU model (CPU
// times are real in this container; only GPU work is software-emulated).
import fs from 'node:fs';
import os from 'node:os';
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), {
  port: '4173', host: 'localhost', units: '250,500,1000,2000,3000,4000', ticks: '600', warmup: '150',
  frames: '4', width: '1280', height: '720', params: '', json: '', timeout: '900',
});
const Ns = args.units.split(',').map(Number);
const cpuModel = (() => {
  try { return (fs.readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/) || [])[1] || os.cpus()[0]?.model; } catch { return os.cpus()[0]?.model; }
})();
console.log(`CPU: ${cpuModel} (${os.cpus().length} threads)   node ${process.version}`);

const browser = await launch(['--enable-precise-memory-info', '--js-flags=--expose-gc']);
const results = { cpu: cpuModel, threads: os.cpus().length, ticks: +args.ticks, warmup: +args.warmup, runs: {} };
let failed = false;

async function run(N) {
  const page = await browser.newPage({ viewport: { width: +args.width, height: +args.height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Cross-origin isolation (COOP + COEP on the page) gives performance.now()
  // ~5 us resolution instead of 100 us; everything the page loads is same-origin.
  await page.route((u) => u.pathname === '/' || u.pathname.endsWith('/index.html'), async (route) => {
    const resp = await route.fetch();
    await route.fulfill({ response: resp, headers: { ...resp.headers(), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' } });
  });
  const url = `http://${args.host}:${args.port}/?scene=stress&units=${N}&prof=1&live=0&fps=0${args.params ? `&${args.params}` : ''}`;
  const tLoad = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__sceneReady === true || (window.__errors || []).length > 0, null, { timeout: +args.timeout * 1000, polling: 250 });
  const loadS = (Date.now() - tLoad) / 1000;
  const res = await page.evaluate(({ ticks, warmup, frames }) => {
    const game = window.__game, prof = game.prof;
    game.paused = true;
    game.frozen = true;
    const heap = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
    const count = () => {
      let alive = 0, dead = 0, moving = 0;
      for (const u of game.entities.units()) { if (u.dead) dead++; else { alive++; if (u.moving) moving++; } }
      return { alive, dead, moving, buildings: game.entities.count('building'), projectiles: game.combat.projectiles.list.length };
    };
    const start = count();
    for (let i = 0; i < warmup; i++) game.tick();
    if (window.gc) window.gc();
    const heap0 = heap();

    // ---- recorded sim ticks ------------------------------------------------
    const T = { wall: [], total: [], sys: {}, ai: [], aiMax: [], sub: {}, calls: {}, callsBy: {}, alive: [], dead: [], moving: [], projectiles: [], heap: [] };
    const push = (o, k, i, v) => { (o[k] ||= new Array(ticks).fill(0))[i] = v; };
    for (let i = 0; i < ticks; i++) {
      const t0 = performance.now();
      game.tick();
      T.wall.push(performance.now() - t0);
      const r = prof.last;
      T.total.push(r.total);
      for (const k in r.sys) push(T.sys, k, i, r.sys[k]);
      let ai = 0, aiMax = 0;
      for (const k in r.ai) { ai += r.ai[k]; aiMax = Math.max(aiMax, r.ai[k]); }
      T.ai.push(ai); T.aiMax.push(aiMax);
      for (const k in r.sub) push(T.sub, k, i, r.sub[k]);
      for (const k in r.calls) { push(T.calls, `${k}.n`, i, r.calls[k][0]); push(T.calls, `${k}.ms`, i, r.calls[k][1]); }
      for (const k in r.callsBy) { push(T.callsBy, `${k}.n`, i, r.callsBy[k][0]); push(T.callsBy, `${k}.ms`, i, r.callsBy[k][1]); }
      const c = count();
      T.alive.push(c.alive); T.dead.push(c.dead); T.moving.push(c.moving); T.projectiles.push(c.projectiles);
      T.heap.push(heap());
    }
    const end = count();

    // ---- neighbour-query census (separate: the counting wrapper costs time)
    const hash = game.movement.hash;
    const orig = hash.forEachNear;
    let q = 0, visited = 0, cells = 0;
    hash.forEachNear = function (x, z, r, fn) {
      q++;
      const c = this.cell;
      const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.n - 1, Math.floor((x + r) / c));
      const z0 = Math.max(0, Math.floor((z - r) / c)), z1 = Math.min(this.n - 1, Math.floor((z + r) / c));
      cells += (x1 - x0 + 1) * (z1 - z0 + 1);
      return orig.call(this, x, z, r, (e) => { visited++; fn(e); });
    };
    const CT = 60;
    for (let i = 0; i < CT; i++) game.tick();
    hash.forEachNear = orig;
    const census = { queries: q / CT, cellsScanned: cells / CT, entitiesVisited: visited / CT };

    // ---- rendered frames --------------------------------------------------
    const r = game.renderer, gl = r.getContext(), px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // two unrecorded frames first: effects that appeared during the fight
    // (arrows, debris, corpses) compile their shaders on first use
    const frameSet = () => {
      const out = [];
      for (let f = frames ? -2 : 0; f < frames; f++) {
        game.tick(); // advance the fight between frames (animation, projectiles)
        sync();
        r.info.reset();
        game.frozen = false;
        const t0 = performance.now();
        game.frame(1 / 60);
        const cpu = performance.now() - t0;
        game.frozen = true;
        sync();
        const lf = prof.lastFrame;
        if (f >= 0) out.push({ cpu, pieces: { ...lf.pieces }, draw: lf.draw, calls: r.info.render.calls, tris: r.info.render.triangles });
      }
      return out;
    };
    const fogFrames = frameSet();
    game.fog.setRevealAll(true);
    const allFrames = frameSet();
    return {
      start, end, heap0, census, T, fogFrames, allFrames,
      isolated: self.crossOriginIsolated, timerRes: (() => { let m = Infinity, a = performance.now(); for (let i = 0; i < 1e5; i++) { const b = performance.now(); if (b > a) { m = Math.min(m, b - a); a = b; } } return m * 1000; })(),
      map: game.map.size, players: Object.keys(game.players).length - 1,
      errors: [...(window.__errors || []), ...game.errors],
    };
  }, { ticks: +args.ticks, warmup: +args.warmup, frames: +args.frames });
  res.loadS = loadS;
  res.errors.push(...errors);
  await page.close();
  return res;
}

// ---- statistics -------------------------------------------------------------
const mean = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? 0; };
const st = (a) => ({ mean: mean(a), p95: pct(a, 0.95), max: Math.max(...a) });
const median = (a) => pct(a, 0.5);
const f = (v, d = 2) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(d));

function summarize(N, r) {
  const T = r.T;
  const sys = {};
  for (const k in T.sys) sys[k] = st(T.sys[k]);
  // combat time includes the AI instances (they run inside combat.update)
  if (T.sys.combat) sys['combat (w/o AI)'] = st(T.sys.combat.map((v, i) => v - T.ai[i]));
  sys['AI (all players)'] = st(T.ai);
  sys['AI (worst player)'] = st(T.aiMax);
  const sub = {};
  for (const k in T.sub) sub[k] = st(T.sub[k]);
  const calls = {};
  for (const k of Object.keys(T.calls).filter((k) => k.endsWith('.n'))) {
    const name = k.slice(0, -2);
    const n = T.calls[k], ms = T.calls[`${name}.ms`];
    calls[name] = { perTick: mean(n), msPerTick: mean(ms), p95ms: pct(ms, 0.95), maxMs: Math.max(...ms), usPerCall: (1000 * ms.reduce((s, v) => s + v, 0)) / Math.max(1, n.reduce((s, v) => s + v, 0)) };
  }
  const callsBy = {};
  for (const k of Object.keys(T.callsBy).filter((k) => k.endsWith('.n'))) {
    const name = k.slice(0, -2);
    callsBy[name] = { perTick: mean(T.callsBy[k]), msPerTick: mean(T.callsBy[`${name}.ms`]) };
  }
  const frameSum = (fr) => {
    const pieces = {};
    for (const k of Object.keys(fr[0]?.pieces || {})) pieces[k] = median(fr.map((x) => x.pieces[k]));
    if (!fr.length) return { cpu: NaN, draw: NaN, calls: NaN, tris: NaN, pieces: {} };
    return { cpu: median(fr.map((x) => x.cpu)), draw: median(fr.map((x) => x.draw)), calls: median(fr.map((x) => x.calls)), tris: median(fr.map((x) => x.tris)), pieces };
  };
  return {
    N, total: st(T.total), wall: st(T.wall), sys, sub, calls, callsBy, census: r.census,
    over16: T.total.filter((v) => v > 16).length / T.total.length,
    over33: T.total.filter((v) => v > 33).length / T.total.length,
    units: { start: r.start, end: r.end, aliveMean: mean(T.alive), movingMean: mean(T.moving), projectilesMean: mean(T.projectiles) },
    heap: { start: r.heap0, max: Math.max(...T.heap), end: T.heap[T.heap.length - 1] },
    render: { fog: frameSum(r.fogFrames), all: frameSum(r.allFrames) },
    isolated: r.isolated, timerResUs: r.timerRes, map: r.map, players: r.players, loadS: r.loadS, errors: r.errors,
  };
}

const sums = [];
for (const N of Ns) {
  const t = Date.now();
  try {
    const r = await run(N);
    const s = summarize(N, r);
    sums.push(s);
    results.runs[N] = { summary: s, perTick: { total: r.T.total, sys: r.T.sys, ai: r.T.ai, heap: r.T.heap, alive: r.T.alive } };
    console.log(`\n=== N=${N}  (${s.players} players, map ${s.map}, load ${s.loadS.toFixed(0)}s, run ${((Date.now() - t) / 1000).toFixed(0)}s, timer ${s.timerResUs.toFixed(0)} us${s.isolated ? '' : ', not isolated'})`);
    console.log(`units alive ${s.units.start.alive} -> ${s.units.end.alive} (mean ${s.units.aliveMean.toFixed(0)}, moving ${s.units.movingMean.toFixed(0)}), corpses at end ${s.units.end.dead}, buildings ${s.units.end.buildings}, projectiles in flight ${s.units.projectilesMean.toFixed(0)}`);
    console.log(`sim ms/tick  mean ${f(s.total.mean)}  p95 ${f(s.total.p95)}  max ${f(s.total.max)}   ticks >16ms ${(100 * s.over16).toFixed(0)}%  >33ms ${(100 * s.over33).toFixed(0)}%`);
    for (const [k, v] of Object.entries(s.sys).sort((a, b) => b[1].mean - a[1].mean)) console.log(`  ${k.padEnd(18)} mean ${f(v.mean).padStart(7)}  p95 ${f(v.p95).padStart(7)}  max ${f(v.max).padStart(7)}`);
    for (const [k, v] of Object.entries(s.sub)) console.log(`  ${`(${k})`.padEnd(18)} mean ${f(v.mean).padStart(7)}  p95 ${f(v.p95).padStart(7)}  max ${f(v.max).padStart(7)}`);
    for (const [k, v] of Object.entries(s.calls)) console.log(`  call ${k.padEnd(16)} ${f(v.perTick, 1).padStart(7)}/tick  ${f(v.msPerTick).padStart(7)} ms/tick  p95 ${f(v.p95ms)}  max ${f(v.maxMs)}  ${f(v.usPerCall, 1)} us/call`);
    console.log(`  findPath by caller: ${Object.entries(s.callsBy).filter(([k]) => k.startsWith('findPath@')).sort((a, b) => b[1].msPerTick - a[1].msPerTick).map(([k, v]) => `${k.slice(9)} ${f(v.perTick, 1)}/tick ${f(v.msPerTick)} ms`).join(', ')}`);
    console.log(`  neighbour queries ${s.census.queries.toFixed(0)}/tick, cells ${s.census.cellsScanned.toFixed(0)}, entities visited ${s.census.entitiesVisited.toFixed(0)}/tick (${(s.census.entitiesVisited / Math.max(1, s.census.queries)).toFixed(1)} per query)`);
    console.log(`  heap MB start ${s.heap.start.toFixed(0)}  max ${s.heap.max.toFixed(0)}  end ${s.heap.end.toFixed(0)}`);
    for (const [k, v] of Object.entries(s.render)) if (v.calls === v.calls) console.log(`  render (${k === 'fog' ? 'fog on ' : 'all vis'}) cpu ${f(v.cpu)} ms  [${Object.entries(v.pieces).map(([a, b]) => `${a} ${f(b)}`).join(', ')}, lighting.draw ${f(v.draw)}]  draws ${v.calls}  tris ${(v.tris / 1e6).toFixed(2)}M`);
    if (s.errors.length) { failed = true; console.log(`  ERRORS: ${s.errors.slice(0, 3).join(' | ')}`); }
  } catch (err) {
    failed = true;
    console.error(`[stress] N=${N}: ${err.stack || err}`);
  }
}
await browser.close();

// ---- scaling table ------------------------------------------------------------
if (sums.length >= 2) {
  const a = sums[0], b = sums[sums.length - 1];
  const expo = (x, y) => (x > 0.005 && y > 0.005 ? Math.log(y / x) / Math.log(b.N / a.N) : NaN);
  console.log(`\n=== mean sim ms per tick vs N (growth exponent k: ms ~ N^k between N=${a.N} and N=${b.N}; 1 = linear, 2 = quadratic)`);
  const keys = Object.keys(b.sys).sort((x, y) => b.sys[y].mean - b.sys[x].mean);
  console.log(`${'system'.padEnd(18)}${sums.map((s) => String(s.N).padStart(8)).join('')}      k`);
  console.log(`${'TOTAL mean'.padEnd(18)}${sums.map((s) => f(s.total.mean).padStart(8)).join('')}  ${expo(a.total.mean, b.total.mean).toFixed(2).padStart(5)}`);
  console.log(`${'TOTAL p95'.padEnd(18)}${sums.map((s) => f(s.total.p95).padStart(8)).join('')}  ${expo(a.total.p95, b.total.p95).toFixed(2).padStart(5)}`);
  for (const k of keys) console.log(`${k.padEnd(18)}${sums.map((s) => f(s.sys[k]?.mean ?? 0).padStart(8)).join('')}  ${expo(a.sys[k]?.mean, b.sys[k]?.mean).toFixed(2).padStart(5)}`);
  for (const k of Object.keys(b.calls)) console.log(`${`${k} ms`.padEnd(18)}${sums.map((s) => f(s.calls[k]?.msPerTick ?? 0).padStart(8)).join('')}  ${expo(a.calls[k]?.msPerTick, b.calls[k]?.msPerTick).toFixed(2).padStart(5)}`);
  console.log(`${'render cpu (fog)'.padEnd(18)}${sums.map((s) => f(s.render.fog.cpu).padStart(8)).join('')}`);
  console.log(`${'render cpu (all)'.padEnd(18)}${sums.map((s) => f(s.render.all.cpu).padStart(8)).join('')}`);
  const brk = (lim, key) => sums.find((s) => s.total[key] > lim)?.N ?? `>${b.N}`;
  console.log(`\nbreak points (sim only): mean > 16 ms at N=${brk(16, 'mean')}, p95 > 16 ms at N=${brk(16, 'p95')}; mean > 33 ms at N=${brk(33, 'mean')}, p95 > 33 ms at N=${brk(33, 'p95')}`);
}
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results));
process.exit(failed ? 1 : 0);
