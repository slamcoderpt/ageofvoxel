// Rendering benchmark: objective per-frame numbers that do not depend on the
// GPU (this runs on software GL, where real FPS means nothing).
//
//   node scripts/bench.mjs [--port 4173] [--scenes skirmish,town,battle]
//        [--width 1920 --height 1080] [--dpr 1] [--params "post=high"]
//        [--frames 3] [--ticks 60] [--json out.json]
//
// Expects a running server (use `npm run build && npx vite preview`).
// For each scene it waits for __sceneReady, pauses the sim, then renders
// --frames frames by hand and reports for the last one:
//   - draw calls / triangles per frame (renderer.info, reset once per frame),
//     split into the shadow pass and every composer pass,
//   - renderer.render() calls (scene/fullscreen passes) and the render targets
//     written, with their total pixel count (MSAA samples not multiplied in),
//   - CPU ms of the frame (JS + GL command submission; the GPU queue is
//     drained before and after with a 1-pixel readPixels) and per piece,
//   - "sw-gpu ms": wall time until the software GPU finished (a rough proxy
//     for fragment + vertex work; relative numbers only),
//   - object counts (visible meshes, instanced meshes, instances),
// then steps --ticks fixed sim ticks and reports sim CPU ms per system.
import fs from 'node:fs';
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), {
  port: '4173', host: 'localhost', scenes: 'skirmish,town,battle', width: '1920', height: '1080',
  dpr: '1', frames: '3', ticks: '60', timeout: '400', params: '',
});
const scenes = args.scenes.split(',');
const browser = await launch();
const results = {};
let failed = false;

async function benchScene(name) {
  const page = await browser.newPage({ viewport: { width: +args.width, height: +args.height }, deviceScaleFactor: +args.dpr });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `http://${args.host}:${args.port}/?scene=${name}&fps=0${args.params ? `&${args.params}` : ''}`;
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__sceneReady === true || (window.__errors || []).length > 0, null, { timeout: +args.timeout * 1000, polling: 250 });
  const res = await page.evaluate(async ({ frames, ticks }) => {
    const game = window.__game;
    game.paused = true;
    game.frozen = true; // stop the rAF loop from drawing; frames are driven below
    const r = game.renderer;
    const gl = r.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const info = r.info;
    info.autoReset = false;

    // ---- instrumentation ---------------------------------------------------
    let cur = null; // per-frame record
    const snap = () => ({ calls: info.render.calls, tris: info.render.triangles });
    const wrap = (obj, key, label, kind) => {
      const orig = obj[key];
      obj[key] = function (...a) {
        if (!cur) return orig.apply(this, a);
        const s = snap(), t = performance.now();
        const out = orig.apply(this, a);
        const e = snap();
        const b = (cur[kind][label] ||= { calls: 0, tris: 0, ms: 0, n: 0 });
        b.calls += e.calls - s.calls; b.tris += e.tris - s.tris; b.ms += performance.now() - t; b.n++;
        return out;
      };
    };
    wrap(r.shadowMap, 'render', 'shadow', 'passes');
    const composer = game.lighting.post?.composer;
    const post = game.lighting.post;
    const passName = (p, i) => (i === 0 ? 'scene' : p === post.gtao ? 'gtao' : p === post.bloom ? 'bloom' : p === post.grade ? 'final' : p === post.aoApply ? 'ao-apply' : p.constructor.name.length > 3 ? p.constructor.name : 'output');
    if (composer) composer.passes.forEach((p, i) => wrap(p, 'render', `${i}:${passName(p, i)}`, 'passes'));
    const pieceName = (piece) => Object.keys(game).find((k) => game[k] === piece) || piece.constructor.name;
    for (const piece of game.renderOrder) wrap(piece, 'render', pieceName(piece), 'cpu');
    wrap(game.lighting.patcher, 'scan', 'patcher.scan', 'cpu');
    wrap(game.lighting.patcher, 'update', 'patcher.update', 'cpu');
    const origRender = r.render.bind(r);
    r.render = (scene, camera) => { if (cur) { cur.renderCalls++; cur.targets.add(r.getRenderTarget()); } return origRender(scene, camera); };
    const origSRT = r.setRenderTarget.bind(r);
    r.setRenderTarget = (t, ...a) => { if (cur) cur.targets.add(t); return origSRT(t, ...a); };

    // draws per top-level scene child (named group or object), main vs shadow
    const groupOf = (o) => { while (o.parent && o.parent !== game.scene) o = o.parent; return o.name || o.type; };
    const trisOf = (o) => {
      const g = o.geometry; if (!g) return 0;
      const n = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0;
      const k = Math.min(n, g.drawRange.count);
      return (k / 3) * (o.isInstancedMesh ? o.count : 1);
    };
    const tally = (o, kind) => {
      if (!cur) return;
      const g = (cur.groups[groupOf(o)] ||= { main: 0, mainTris: 0, shadow: 0, shadowTris: 0 });
      const t = o.isMesh ? trisOf(o) : 0;
      if (kind === 'main') { g.main++; g.mainTris += t; } else { g.shadow++; g.shadowTris += t; }
    };
    const hooked = new WeakSet();
    const hook = () => game.scene.traverse((o) => {
      if (hooked.has(o) || !(o.isMesh || o.isPoints || o.isLine)) return;
      hooked.add(o);
      const b = o.onBeforeRender, sh = o.onBeforeShadow;
      o.onBeforeRender = function (...a) { if (!(post?.gtao && inGtao)) tally(this, 'main'); return b.apply(this, a); };
      o.onBeforeShadow = function (...a) { tally(this, 'shadow'); return sh.apply(this, a); };
    });
    let inGtao = false;
    if (post?.gtao) { const o = post.gtao.render; post.gtao.render = function (...a) { inGtao = true; try { return o.apply(this, a); } finally { inGtao = false; } }; }

    const frame = () => {
      hook();
      sync();
      cur = { passes: {}, cpu: {}, groups: {}, renderCalls: 0, targets: new Set() };
      info.reset();
      game.frozen = false;
      const t0 = performance.now();
      game.frame(1 / 60);
      const cpu = performance.now() - t0;
      sync();
      const gpu = performance.now() - t0;
      game.frozen = true;
      const rec = cur; cur = null;
      const canvas = { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight };
      let pixels = 0, samples = 0;
      const targets = [];
      for (const t of rec.targets) {
        if (!t) { pixels += canvas.w * canvas.h; targets.push(`canvas ${canvas.w}x${canvas.h}`); continue; }
        const w = t.width, h = t.height;
        pixels += w * h; samples += w * h * Math.max(1, t.samples || 1);
        targets.push(`${w}x${h}${t.samples ? ` x${t.samples}` : ''}${t.isWebGLCubeRenderTarget ? ' cube' : ''}`);
      }
      return {
        calls: info.render.calls, tris: info.render.triangles, cpuMs: cpu, swGpuMs: gpu,
        renderCalls: rec.renderCalls, targetCount: rec.targets.size, targetPixels: pixels, targets,
        passes: rec.passes, cpuPieces: rec.cpu, groups: rec.groups,
      };
    };
    let last;
    const cpuAll = [];
    for (let i = 0; i < frames; i++) { last = frame(); cpuAll.push(last.cpuMs); }
    last.cpuMsMin = Math.min(...cpuAll);

    // shadow map size
    const sun = game.lighting.sun;
    last.shadowMap = `${sun.shadow.mapSize.x}x${sun.shadow.mapSize.y}`;
    last.pixelRatio = r.getPixelRatio();

    // ---- scene statistics -----------------------------------------------
    let meshes = 0, inst = 0, instances = 0, noSphere = 0, notCulled = 0, visible = 0;
    game.scene.traverseVisible((o) => {
      if (!o.isMesh) return;
      visible++;
      if (o.isInstancedMesh) { inst++; instances += o.count; if (!o.boundingSphere) noSphere++; }
      else meshes++;
      if (!o.frustumCulled) notCulled++;
    });
    last.objects = { visibleMeshes: visible, plainMeshes: meshes, instancedMeshes: inst, instances, instancedNoSphere: noSphere, frustumCulledOff: notCulled };

    // cost of one scene-graph matrix update (done once per frame)
    {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) game.scene.updateMatrixWorld();
      last.matrixUpdateMs = +((performance.now() - t0) / 20).toFixed(3);
      let auto = 0; game.scene.traverse((o) => { if (o.matrixAutoUpdate) auto++; });
      last.objects.matrixAutoUpdate = auto;
    }

    // ---- sim CPU per system ---------------------------------------------
    const sim = {};
    const restore = [];
    for (const s of game.simOrder) {
      const orig = s.update;
      if (!orig) continue;
      const nm = s.constructor.name;
      s.update = function (...a) { const t = performance.now(); const o = orig.apply(this, a); sim[nm] = (sim[nm] || 0) + performance.now() - t; return o; };
      restore.push(() => { s.update = orig; });
    }
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) game.tick();
    const simTotal = performance.now() - t0;
    restore.forEach((f) => f());
    for (const k in sim) sim[k] = +(sim[k] / ticks).toFixed(3);
    last.simMsPerTick = +(simTotal / ticks).toFixed(3);
    last.simPieces = sim;
    last.errors = [...(window.__errors || []), ...game.errors];
    return last;
  }, { frames: +args.frames, ticks: +args.ticks });
  res.errors.push(...errors);
  await page.close();
  return res;
}

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);
for (const s of scenes) {
  const t = Date.now();
  try {
    const r = await benchScene(s);
    results[s] = r;
    console.log(`\n=== ${s}  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
    console.log(`draw calls ${r.calls}   triangles ${fmt(r.tris)}   cpu ${r.cpuMs.toFixed(1)} ms (min ${r.cpuMsMin.toFixed(1)})   sw-gpu ${r.swGpuMs.toFixed(0)} ms`);
    console.log(`render() calls ${r.renderCalls}   targets ${r.targetCount}   target pixels ${fmt(r.targetPixels)}   shadow map ${r.shadowMap}   pixel ratio ${r.pixelRatio}`);
    console.log(`targets: ${r.targets.join(', ')}`);
    for (const [k, v] of Object.entries(r.passes)) console.log(`  pass ${k.padEnd(22)} calls ${String(v.calls).padStart(5)}  tris ${fmt(v.tris).padStart(7)}  cpu ${v.ms.toFixed(1)} ms`);
    console.log(`  cpu per piece: ${Object.entries(r.cpuPieces).map(([k, v]) => `${k} ${v.ms.toFixed(2)}`).join(', ')}`);
    console.log('  draws by group (main scene pass | shadow pass):');
    for (const [k, v] of Object.entries(r.groups).sort((a, b) => b[1].main + b[1].shadow - a[1].main - a[1].shadow)) console.log(`    ${k.padEnd(20)} ${String(v.main).padStart(5)} ${fmt(Math.round(v.mainTris)).padStart(7)} | ${String(v.shadow).padStart(5)} ${fmt(Math.round(v.shadowTris)).padStart(7)}`);
    console.log(`  objects: ${JSON.stringify(r.objects)}   scene matrix update ${r.matrixUpdateMs} ms`);
    console.log(`  sim ${r.simMsPerTick} ms/tick: ${Object.entries(r.simPieces).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (r.errors.length) { failed = true; console.log(`  ERRORS: ${r.errors.slice(0, 3).join(' | ')}`); }
  } catch (err) {
    failed = true;
    console.error(`[bench] ${s}: ${err.stack || err}`);
  }
}
await browser.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
