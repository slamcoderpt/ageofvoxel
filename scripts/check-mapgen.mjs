#!/usr/bin/env node
// Map generator checks for the Godot port (godot/native/src/sim/core/game_map.cpp),
// for the seeds and presets of every scene.
//
// 1. Browser parity of the shared part: the C++ generator with the Godot-only
//    passes off (simcheck.gd --mapdump --rules=browser) must still equal
//    src/core/GameMap.js generateMap() value by value: column heights, ground
//    types, tile passability, the walkable grid after the initial resources
//    block their tiles (what A* sees), every resource spawn (type, tile,
//    variant) and the player starts. Prints the first difference.
// 2. The game's map (--rules=godot) is NOT the browser's any more (the browser
//    build is frozen): Godot-only passes add a woodline near every start and
//    may clear / grade a route between starts. It is checked for what those
//    passes guarantee instead: every start has at least WOOD_MIN trees whose
//    centres are 8-14 tiles from its Town Center's centre; every start, and
//    every mine / bush within 14 tiles of one, is reachable on foot from the
//    first start; the terrain differs from the browser's only where a route
//    was graded; the browser's resources are all there except the felled
//    trees, plus the woodline trees.
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
const WOOD_MIN = 16; // game_map.cpp place_woodlines

// [scene(s), seed, size, preset, players]
const cases = [
  ['skirmish, economy', 3, 128, 'skirmish', 2], ['town, hud', 7, 128, 'skirmish', 2], ['battle', 11, 128, 'battle', 2],
  ['godpower', 19, 128, 'battle', 2], ['coast', 5, 128, 'coast', 2], ['stress', 23, 256, 'stress', 6],
  ['stress 5p', 23, 256, 'stress', 5], ['stress 4p', 23, 256, 'stress', 4], ['stress 3p', 23, 256, 'stress', 3],
  ['stress 2p', 23, 256, 'stress', 2], ['models', 1, 96, 'battle', 2],
  // skirmish seeds whose browser map is cut in two (forest / lake): the game's map connects them
  ['(split) skirmish', 1, 128, 'skirmish', 2], ['(split) skirmish', 32, 128, 'skirmish', 2], ['(split) skirmish', 37, 128, 'skirmish', 2],
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

  const dump = (rules) => {
    const out = path.join(tmp, `${seed}-${preset}-${players}-${rules}.json`);
    execFileSync(GODOT, ['--headless', '--path', path.join(ROOT, 'godot'), '-s', 'res://game/core/simcheck.gd', '--',
      `--mapdump=${out}`, `--seed=${seed}`, `--size=${size}`, `--preset=${preset}`, `--players=${players}`, `--rules=${rules}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  };
  const c = dump('browser');
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

  // --- the game's map: the Godot-only passes
  const g = dump('godot');
  const info = g.mapgen || {};
  const errs = [];
  const gh = b64(g.heights);
  const gH = new Int16Array(gh.buffer, gh.byteOffset, gh.length / 2);
  let hdiff = 0;
  for (let i = 0; i < gH.length; i++) if (gH[i] !== cppH[i]) hdiff++;
  if (hdiff && !info.graded) errs.push(`terrain differs from the browser's in ${hdiff} columns with no route graded`);
  const key = (r) => `${r[0]}:${r[1]}:${r[2]}`;
  const gset = new Map();
  for (const r of g.resources) gset.set(key(r), (gset.get(key(r)) || 0) + 1);
  let missing = 0, missingNonTree = 0;
  for (const r of c.resources) {
    const n = gset.get(key(r)) || 0;
    if (n > 0) gset.set(key(r), n - 1);
    else { missing++; if (r[0] !== 'tree') missingNonTree++; }
  }
  const extra = [...gset.values()].reduce((a, v) => a + v, 0);
  if (missingNonTree) errs.push(`${missingNonTree} mines / bushes of the browser map are gone`);
  if (missing !== (info.felled || 0)) errs.push(`${missing} browser trees gone, ${info.felled || 0} felled`);
  if (extra !== (info.woodline || 0)) errs.push(`${extra} extra resources, woodlines report ${info.woodline || 0}`);
  const gw = b64(g.walkable);
  const seen = new Uint8Array(size * size);
  const s0 = g.starts[0];
  const q = [s0[2] * size + s0[1]];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % size, z = (i / size) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      const j = nz * size + nx;
      if (!seen[j] && gw[j]) { seen[j] = 1; q.push(j); }
    }
  }
  const woods = [];
  for (const [owner, tx, tz] of g.starts) {
    if (!seen[tz * size + tx]) errs.push(`start ${owner} cannot be reached from start ${s0[0]}`);
    let n = 0;
    for (const [type, rx, rz] of g.resources) if (type === 'tree' && Math.hypot(rx - tx, rz - tz) >= 8 && Math.hypot(rx - tx, rz - tz) <= 14) n++;
    woods.push(n);
    if (n < WOOD_MIN) errs.push(`start ${owner}: only ${n} trees 8-14 tiles from its Town Center`);
    for (const [type, rx, rz] of g.resources) {
      if (type === 'tree' || Math.hypot(rx - tx, rz - tz) > 14) continue;
      const d = RESOURCE_DEFS[type];
      let reach = false;
      for (let z = rz - 1; z <= rz + d.h && !reach; z++)
        for (let x = rx - 1; x <= rx + d.w && !reach; x++)
          if (x >= 0 && z >= 0 && x < size && z < size && seen[z * size + x]) reach = true;
      if (!reach) errs.push(`start ${owner}: ${type} at (${rx}, ${rz}) cannot be reached`);
    }
  }
  if (errs.length) bad++;
  console.log(`${errs.length ? 'FAIL' : 'ok  '}   game map (Godot passes): woodline trees 8-14 tiles out per start [${woods.join(', ')}], ` +
    `${info.woodline || 0} woodline trees, ${info.felled || 0} felled / ${info.graded || 0} tiles graded to connect the starts, all starts connected`);
  for (const e of errs) console.log(`     ${e}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
