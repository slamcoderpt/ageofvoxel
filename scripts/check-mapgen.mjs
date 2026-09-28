#!/usr/bin/env node
// Checks that the C++ map generator (godot/native/src/sim/core/game_map.cpp)
// is bit-exact with src/core/GameMap.js generateMap() for every scene preset:
// compares an FNV-1a hash over heights, ground types and resource spawns.
//   node scripts/check-mapgen.mjs [--godot godot]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMap } from '../src/core/GameMap.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const GODOT = args.includes('--godot') ? args[args.indexOf('--godot') + 1] : 'godot';

function hash({ map, resources }) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { v >>>= 0; for (let k = 0; k < 4; k++) { h ^= (v >>> (k * 8)) & 255; h = Math.imul(h, 16777619) >>> 0; } };
  for (const v of map.heights) mix(v);
  for (const v of map.ground) mix(v);
  for (const r of resources) { mix(r.type.charCodeAt(0)); mix(r.tx); mix(r.tz); mix(r.variant ?? 0); }
  return h.toString(16).padStart(8, '0');
}

const cases = [
  ['skirmish', 3, 128, 'skirmish', 2], ['town', 7, 128, 'skirmish', 2], ['battle', 11, 128, 'battle', 2],
  ['coast', 5, 128, 'coast', 2], ['stress', 23, 256, 'stress', 6], ['stress', 23, 256, 'stress', 3],
];
let bad = 0;
for (const [scene, seed, size, preset, players] of cases) {
  const js = hash(generateMap({ seed, size, preset, players }));
  const out = execFileSync(GODOT, ['--headless', '--path', path.join(ROOT, 'godot'), '--', `--scene=${scene}`, `--players=${players}`, '--bench', '--ticks=1', '--warmup=0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const cpp = (out.match(/map_hash=([0-9a-f]+)/) || [])[1];
  const ok = cpp === js;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${scene.padEnd(9)} seed ${String(seed).padEnd(3)} ${preset.padEnd(9)} players ${players}  js ${js}  c++ ${cpp}`);
}
process.exit(bad ? 1 : 0);
