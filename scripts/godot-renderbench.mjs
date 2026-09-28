#!/usr/bin/env node
// Render benchmark of the Godot port (the counterpart of bench.mjs).
//   node scripts/godot-renderbench.mjs [--scene stress] [--params "units=2000&fog=0"]
//        [--width 1280 --height 720] [--frames 30] [--warmup 10] [--live 0] [--json out.json]
// Renders through xvfb + lavapipe (software Vulkan, Forward+) with vsync off,
// pauses the sim like bench.mjs (unless --live 1) and prints the wall ms per
// frame (mean, median, p95), render CPU / GPU ms, draw calls and primitives
// measured by game/perf/perf.gd. Builds nothing.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GODOT_DIR = path.join(ROOT, 'godot');
const args = { scene: 'stress', params: 'units=2000&fog=0', width: '1280', height: '720', frames: '30', warmup: '10', live: '0', timeout: '900', godot: 'godot' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  args[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
}
if (!fs.existsSync(path.join(GODOT_DIR, '.godot/extension_list.cfg'))) {
  spawnSync(args.godot, ['--headless', '--path', GODOT_DIR, '--import'], { stdio: 'ignore', timeout: 600000 });
}
const user = [`--scene=${args.scene}`, `--width=${args.width}`, `--height=${args.height}`, `--renderbench=${args.frames}`,
  `--rb_warmup=${args.warmup}`, `--rb_live=${args.live}`, `--timeout=${args.timeout}`];
for (const [k, v] of new URLSearchParams(args.params || '')) user.push(`--${k}=${v}`);
const cmd = ['-a', '-s', `-screen 0 ${args.width}x${args.height}x24`, args.godot, '--path', GODOT_DIR,
  '--rendering-driver', 'vulkan', '--audio-driver', 'Dummy', '--resolution', `${args.width}x${args.height}`, '--', ...user];
const t0 = Date.now();
// its own process group: a script error or a timeout kills Godot and Xvfb too
// (a GDScript error does not stop the engine; an orphan would skew every later run)
const child = spawn('xvfb-run', cmd, {
  env: { ...process.env, VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/usr/share/vulkan/icd.d/lvp_icd.json' },
  stdio: ['ignore', 'pipe', 'pipe'], detached: true,
});
let out = '';
let killer = null;
const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
const watch = (d) => {
  out += d;
  if (!killer && /SCRIPT ERROR|AOV_ERROR/.test(out)) killer = setTimeout(kill, 3000);
};
child.stdout.on('data', watch);
child.stderr.on('data', watch);
const timer = setTimeout(kill, (+args.timeout + 60) * 1000);
await new Promise((res) => child.on('close', res));
clearTimeout(timer);
if (killer) clearTimeout(killer);
const r = { stdout: out, stderr: '' };
const log = `${r.stdout || ''}${r.stderr || ''}`;
const line = log.split('\n').find((l) => l.startsWith('AOV_RENDERBENCH '));
const errs = log.split('\n').filter((l) => /SCRIPT ERROR|AOV_ERROR|^ERROR:/.test(l));
if (!line) {
  console.error(log.slice(-4000));
  console.error('[godot-renderbench] no result');
  process.exit(1);
}
const res = JSON.parse(line.slice('AOV_RENDERBENCH '.length));
res.total_s = (Date.now() - t0) / 1000;
res.errors = errs;
const f = (s) => `mean ${s.mean}  median ${s.median}  p95 ${s.p95}  min ${s.min}`;
console.log(`=== ${res.scene} ${res.size.join('x')}  units ${res.units}  frames ${res.frames}${res.live ? ' (live)' : ''}`);
console.log(`wall ms/frame   ${f(res.wall_ms)}`);
console.log(`process cpu ms/frame (all threads) ${res.cpu_ms_per_frame}`);
console.log(`render cpu ms   ${f(res.render_cpu_ms)}`);
console.log(`gpu ms          ${f(res.gpu_ms)}`);
console.log(`draw calls ${res.draw_calls}   primitives ${res.primitives}   objects ${res.objects}   units posed ${res.units_posed} (at LOD ${res.units_lod})`);
for (const k of ['visible', 'shadow']) if (res[k]) console.log(`  ${k.padEnd(8)} draw calls ${res[k].draw_calls}   primitives ${res[k].primitives}   objects ${res[k].objects}`);
if (res.passes?.length) console.log(`  gpu passes (ms): ${res.passes.filter((p) => p[1] >= 1).map((p) => `${p[0]} ${p[1]}`).join(', ')}`);
if (errs.length) console.log(`ERRORS:\n${errs.slice(0, 10).join('\n')}`);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(res, null, 2));
process.exit(errs.length ? 1 : 0);
