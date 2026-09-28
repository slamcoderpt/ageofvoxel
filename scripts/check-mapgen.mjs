#!/usr/bin/env node
// Checks that the C++ map generator (godot/native/src/sim/core/game_map.cpp)
// is bit-exact with src/core/GameMap.js generateMap() for the seeds and
// presets of every scene: dumps the C++ map (godot/game/core/simcheck.gd
// --mapdump) and compares, value by value, the column heights and ground
// types, the tile passability, the walkable grid after the initial
// resources block their tiles (what A* sees), every resource spawn (type,
// tile, variant) and the player starts. Prints the first difference.
//   node scripts/check-mapgen.mjs [--godot godot]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMap } from '../src/core/GameMap.js';
import { RESOURCE_DEFS } from '../src/terrain/resourceDefs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const GODOT = args.includes('--godot') ? args[args.indexOf('--godot') + 1] : 'godot';

// [scene(s), seed, size, preset, players]
const cases = [
  ['skirmish, economy', 3, 128, 'skirmish', 2], ['town, hud', 7, 128, 'skirmish', 2], ['battle', 11, 128, 'battle', 2],
  ['godpower', 19, 128, 'battle', 2], ['coast', 5, 128, 'coast', 2], ['stress', 23, 256, 'stress', 6],
  ['stress 3p', 23, 256, 'stress', 3], ['stress 2p', 23, 256, 'stress', 2], ['models', 1, 96, 'battle', 2],
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aov-mapgen-'));
let bad = 0;
for (const [scene, seed, size, preset, players] of cases) {
  const gen = generateMap({ seed, size, preset, players });
  const { map } = gen;
  // walkable after the initial resources block their tiles (terrain.spawnResource)
  for (const r of gen.resources) { const d = RESOURCE_DEFS[r.type]; map.block(r.tx, r.tz, d.w, d.h, 0); }
  const walk = new Uint8Array(size * size);
  for (let tz = 0; tz < size; tz++) for (let tx = 0; tx < size; tx++) walk[tz * size + tx] = map.isWalkable(tx, tz) ? 1 : 0;

  const out = path.join(tmp, `${seed}-${preset}-${players}.json`);
  execFileSync(GODOT, ['--headless', '--path', path.join(ROOT, 'godot'), '-s', 'res://game/core/simcheck.gd', '--',
    `--mapdump=${out}`, `--seed=${seed}`, `--size=${size}`, `--preset=${preset}`, `--players=${players}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const c = JSON.parse(fs.readFileSync(out, 'utf8'));
  const b64 = (s) => Buffer.from(s, 'base64');
  const hb = b64(c.heights);
  const cppH = new Int16Array(hb.buffer, hb.byteOffset, hb.length / 2);
  const cols = map.cols;
  const diffs = [];
  const cmp = (name, a, b, w, cell) => {
    if (a.length !== b.length) { diffs.push(`${name}: length js ${a.length} c++ ${b.length}`); return; }
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) { diffs.push(`${name}: first at ${cell} (${i % w}, ${Math.floor(i / w)}): js ${a[i]} c++ ${b[i]}`); return; }
  };
  if (c.size !== size || c.cols !== cols || c.waterLevel !== map.waterLevel) diffs.push(`header: js ${size}/${cols}/${map.waterLevel} c++ ${c.size}/${c.cols}/${c.waterLevel}`);
  cmp('heights', map.heights, cppH, cols, 'column');
  cmp('ground', map.ground, b64(c.ground), cols, 'column');
  cmp('passable', map.passable, b64(c.passable), size, 'tile');
  cmp('walkable', walk, b64(c.walkable), size, 'tile');
  const jr = gen.resources.map((r) => [r.type, r.tx, r.tz, r.variant ?? 0]);
  if (jr.length !== c.resources.length) diffs.push(`resources: count js ${jr.length} c++ ${c.resources.length}`);
  else {
    const k = jr.findIndex((r, i) => r.some((v, j) => v !== c.resources[i][j]));
    if (k >= 0) diffs.push(`resources: first at #${k}: js ${JSON.stringify(jr[k])} c++ ${JSON.stringify(c.resources[k])}`);
  }
  const js = gen.starts.map((s) => [s.owner, s.tx, s.tz]);
  if (JSON.stringify(js) !== JSON.stringify(c.starts)) diffs.push(`starts: js ${JSON.stringify(js)} c++ ${JSON.stringify(c.starts)}`);
  const ok = diffs.length === 0;
  if (!ok) bad++;
  const water = map.heights.reduce((n, h) => n + (h < map.waterLevel ? 1 : 0), 0);
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${scene.padEnd(17)} seed ${String(seed).padEnd(3)} ${preset.padEnd(9)} ${size}x${size} players ${players}  ` +
    `${cols * cols} columns (${water} under water), ${gen.resources.length} resources, ${walk.reduce((a, v) => a + v, 0)} walkable tiles  c++ hash ${c.hash}`);
  for (const d of diffs) console.log(`     ${d}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
