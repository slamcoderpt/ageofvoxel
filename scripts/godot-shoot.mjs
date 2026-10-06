#!/usr/bin/env node
// Deterministic screenshot of the Godot port (the counterpart of shoot.mjs).
//   node scripts/godot-shoot.mjs --scene town --out shots/godot/town.png
//        [--width 1920 --height 1080] [--seed N] [--params "units=500&cam=64,64,30"]
//        [--frames 4] [--timeout 300] [--godot godot]
// Renders through xvfb + lavapipe (software Vulkan, Forward+), saves the PNG
// written by the game itself after --frames frames, prints engine errors and
// exits non-zero on a script/engine error, a missing extension or a blank frame.
// Builds nothing: build the extension first (cd godot/native && scons -j2).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GODOT_DIR = path.join(ROOT, 'godot');

function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}

const args = parseArgs(process.argv.slice(2), { scene: 'town', width: '1920', height: '1080', timeout: '300', frames: '4', godot: 'godot' });
const out = path.resolve(args.out || `shots/godot/${args.scene}.png`);
const lvp = '/usr/share/vulkan/icd.d/lvp_icd.json';
const errors = [];

const libs = fs.existsSync(path.join(GODOT_DIR, 'native/bin')) ? fs.readdirSync(path.join(GODOT_DIR, 'native/bin')) : [];
if (!libs.some((f) => f.startsWith('libaov.'))) {
  console.error('[godot-shoot] extension not built: cd godot/native && scons -j2');
  process.exit(1);
}
// Godot only loads GDExtensions listed in .godot/extension_list.cfg, written by an import.
if (!fs.existsSync(path.join(GODOT_DIR, '.godot/extension_list.cfg'))) {
  console.log('[godot-shoot] first run: importing the project');
  spawnSync(args.godot, ['--headless', '--path', GODOT_DIR, '--import'], { stdio: 'ignore', timeout: 600000 });
}

const user = [`--scene=${args.scene}`, `--out=${out}`, `--width=${args.width}`, `--height=${args.height}`, `--frames=${args.frames}`, '--quit'];
if (args.seed) user.push(`--seed=${args.seed}`);
for (const [k, v] of new URLSearchParams(args.params || '')) user.push(`--${k}=${v}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
// the old PNG is not deleted first: godot writes the new one atomically (temp + rename) and
// only when the frame passes the shear guard, so a failed run leaves the last good shot in place
const before = fs.existsSync(out) ? fs.statSync(out).mtimeMs : -1;
const cmd = ['-a', '-s', `-screen 0 ${args.width}x${args.height}x24`, args.godot, '--path', GODOT_DIR,
  '--rendering-driver', 'vulkan', '--audio-driver', 'Dummy', '--resolution', `${args.width}x${args.height}`, '--', ...user];
const t0 = Date.now();
const child = spawn('xvfb-run', cmd, { env: { ...process.env, VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || lvp }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
// a GDScript error does not stop the engine: give it a moment to print, then stop it
let killer = null;
const watchErrors = () => {
  if (killer || !/SCRIPT ERROR|AOV_ERROR/.test(log)) return;
  killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
};
child.stdout.on('data', watchErrors);
child.stderr.on('data', watchErrors);
const timer = setTimeout(() => { errors.push(`timeout after ${args.timeout}s`); try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, +args.timeout * 1000);
const code = await new Promise((res) => child.on('close', (c) => res(c)));
clearTimeout(timer);
if (killer) clearTimeout(killer);

const lines = log.split('\n');
let cap = null;
for (const l of lines) {
  if (l.startsWith('AOV_CAPTURE ')) cap = JSON.parse(l.slice(12));
  if (/^(SCRIPT ERROR|USER SCRIPT ERROR|ERROR|AOV_ERROR)\b/.test(l.trim())) {
    const i = lines.indexOf(l);
    errors.push([l.trim(), (lines[i + 1] || '').trim()].filter(Boolean).join('  '));
  }
}
if (code !== 0) errors.push(`godot exited with code ${code}`);
if (!cap) errors.push('no AOV_CAPTURE line (capture did not happen)');
else if (cap.mean < 8 || cap.std < 4) errors.push(`image looks blank (mean ${cap.mean}, std ${cap.std})`);
else if (cap.shear > 1.6) errors.push(`image looks sheared (vertical/horizontal gradient ${cap.shear}: a row-pitch error)`);
if (!fs.existsSync(out) || fs.statSync(out).mtimeMs === before || (cap && cap.saved === false))
  errors.push(`no PNG written at ${out}${fs.existsSync(out) ? ' (the previous one is left untouched)' : ''}`);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (cap) console.log(`[godot-shoot] ${args.scene} -> ${out} in ${secs}s  (mean ${cap.mean.toFixed(1)}, std ${cap.std.toFixed(1)}${cap.shear != null ? `, shear ${cap.shear}` : ''}, tick ${cap.tick})`);
if (errors.length && args.verbose !== 'true') console.error(lines.filter((l) => l.trim()).slice(-25).join('\n'));
else if (args.verbose === 'true') console.log(log);
for (const e of errors) console.error(`[godot-shoot] ${e}`);
process.exit(errors.length ? 1 : 0);
