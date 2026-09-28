#!/usr/bin/env node
// Sim scaling of the Godot port vs unit count: the counterpart of
// scripts/stress.mjs, printing the same tables (the summarize / print code
// below is stress.mjs's, unchanged) so the two reports compare line by line.
//   node scripts/godot-stress.mjs [--units 250,500,1000,2000,3000,4000] [--ticks 600] [--warmup 150]
//        [--params "players=6"] [--json out.json] [--godot godot] [--timeout 900]
// Per N it runs the stress scene headless (`godot --headless --path godot --
// --scene=stress --units=N --bench ...`, game/core/bench.gd): the C++ sim is
// stepped directly with its profiler on (AovSim.set_profiling / get_profile).
// Render rows are left out (headless); render cost is measured separately.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
const args = parseArgs(process.argv.slice(2), {
  units: '250,500,1000,2000,3000,4000', ticks: '600', warmup: '150', params: '', json: '', timeout: '900', godot: 'godot',
});
const Ns = args.units.split(',').map(Number);
const cpuModel = (() => {
  try { return (fs.readFileSync('/proc/cpuinfo', 'utf8').match(/model name\s*:\s*(.*)/) || [])[1] || os.cpus()[0]?.model; } catch { return os.cpus()[0]?.model; }
})();
const ver = spawnSync(args.godot, ['--version'], { encoding: 'utf8' }).stdout.trim();
console.log(`CPU: ${cpuModel} (${os.cpus().length} threads)   godot ${ver}`);
const results = { cpu: cpuModel, threads: os.cpus().length, ticks: +args.ticks, warmup: +args.warmup, runs: {} };
let failed = false;

async function run(N) {
  const tmp = path.join(os.tmpdir(), `aov-bench-${process.pid}-${N}.json`);
  const user = ['--scene=stress', `--units=${N}`, '--bench', `--ticks=${args.ticks}`, `--warmup=${args.warmup}`, `--json=${tmp}`, `--timeout=${args.timeout}`];
  for (const [k, v] of new URLSearchParams(args.params || '')) user.push(`--${k}=${v}`);
  const t0 = Date.now();
  const p = spawnSync(args.godot, ['--headless', '--path', path.join(ROOT, 'godot'), '--', ...user], { encoding: 'utf8', timeout: +args.timeout * 1000 + 30000 });
  const log = `${p.stdout || ''}${p.stderr || ''}`;
  if (p.status !== 0 || !fs.existsSync(tmp)) throw new Error(`godot exited ${p.status}\n${log.split('\n').slice(-20).join('\n')}`);
  const res = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  const errs = log.split('\n').filter((l) => /SCRIPT ERROR|AOV_ERROR/.test(l));
  res.errors = [...(res.errors || []), ...errs];
  res.loadS = (Date.now() - t0) / 1000;
  return res;
}

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
    console.error(`[godot-stress] N=${N}: ${err.stack || err}`);
  }
}

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
