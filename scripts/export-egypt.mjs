#!/usr/bin/env node
// The Egyptian buildings for the Godot port (Age of Mythology: Retold,
// reference/egypt/building_01..23 and EGYPT.md section 2). Godot-only (the
// browser build has no Egyptians), authored in the voxel format, mesher and
// weathering of scripts/export-techbuildings.mjs (the precedent): 1/8-tile
// voxels, src/core/voxel.js buildVoxelGeometry (jitter, baked AO) plus a few
// smooth parts (shapes.js withExtras), written as the "egypt" model group:
//
//   node scripts/export-egypt.mjs [--out godot/assets/models] [--only house,temple]   (~20 s, deterministic)
//
// Look: flat-roofed sandstone and limestone blocks with a pale cavetto
// cornice, a team-colour line inset on every roof rim and a team band under
// the cornice, painted friezes (blue / red / ochre), battered pylons with
// painted reliefs and gilt winged suns over the doors, striped cloth awnings,
// domed clay silos, palms, dark basalt and gold statues. Every model is
// pivoted at its footprint centre on the ground, the front looks +z, the
// default camera sees the +z front and the +x side.
// Names (T = type, V = variant 0.., A = age look):
//   T/V/aA     finished, in the owner's age look A (the highest listed <= age)
//   T/V/sK     construction (K = floor(progress * 8)), cut from the first age
//              look: 0 = the staked lot, 1..7 the work rising in a palm-wood scaffold
// The manifest's "types" lists for each type its footprint (tiles), variants
// (names) and age looks. Read by godot/game/buildings/egypt_buildings.gd.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('out', 'godot/assets/models'));
const ONLY = argOf('only', '') ? new Set(argOf('only', '').split(',')) : null;
const src = (p) => import(path.join(ROOT, 'src', p));
const { VoxelModel, TEAM, buildVoxelGeometry } = await src('core/voxel.js');
const { hash3 } = await src('core/rng.js');
const S = await src('buildings/shapes.js');
const { poly } = S;

const VOX = 0.125;
const STAGES = 8;
const FORMAT = 2;

// ---- palette ------------------------------------------------------------------
const pick = (h, cols) => cols[Math.min(cols.length - 1, Math.floor(h * cols.length))];
const shade = (c, f) => {
  const r = Math.round(((c >> 16) & 255) * f), g = Math.round(((c >> 8) & 255) * f), b = Math.round((c & 255) * f);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
};
function masonry(tonesA, tonesB, { len = 8, course = 4, bed = 0.84, head = 0.9, grime = 4, seed = 3 } = {}) {
  return (x, y, z) => {
    const row = Math.floor(y / course);
    const u = x + z + (row & 1) * (len >> 1) + 256;
    const blk = Math.floor(u / len);
    const h = hash3(blk, row, (x - z) >> 4, seed);
    const fam = hash3(row, 1, (x - z) >> 4, seed + 1) < 0.5 ? tonesA : tonesB;
    let c = pick(h, fam);
    if (y % course === 0) c = shade(c, bed);
    else if (u % len === 0) c = shade(c, head);
    if (y < grime) c = shade(c, 0.88 + 0.03 * Math.max(0, y));
    return c;
  };
}
// warm sandstone ashlar (Retold's walls: a light, slightly orange sandstone in big courses)
const SAND = masonry([0xe2c491, 0xd9b984, 0xe8cc9c], [0xd6b47f, 0xdfc08c, 0xcfab76], { len: 7, course: 3, bed: 0.84, head: 0.9, grime: 3, seed: 5 });
const SAND_D = masonry([0xc9a26d, 0xbf9862, 0xd1aa76], [0xb98f5b, 0xc49c68, 0xcca572], { len: 6, course: 3, bed: 0.82, head: 0.88, grime: 0, seed: 9 });
// pale limestone (cornices, copings, columns, the migdol)
const LIME = masonry([0xf1e6cf, 0xe9ddc3, 0xf5ecd8], [0xe6d9bd, 0xede2ca, 0xdfd1b4], { len: 9, course: 3, bed: 0.86, head: 0.92, grime: 3, seed: 11 });
const LIME_S = 0xd9c9a8;      // the shadowed lip under a cornice
const PLASTER = (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 13), [0xf4ecdc, 0xefe5d2, 0xf7f0e2, 0xe9dfca]);
const ROOFTILE = (x, y, z) => { const c = pick(hash3(x >> 2, y, z >> 2, 14), [0xf0e7d4, 0xe8dcc5, 0xf3ebdb]); return (x % 4 === 0 || z % 4 === 0) ? shade(c, 0.9) : c; };
const MUD = masonry([0xb98a58, 0xae7f4f, 0xc29463], [0xa77a4c, 0xb48655, 0xbc8e5c], { len: 4, course: 2, bed: 0.86, head: 0.9, grime: 2, seed: 15 });
const THATCH = (x, y, z) => pick(hash3(x, y, z >> 1, 16), [0xa8925a, 0x9c8650, 0xb39d64, 0x8f7a48, 0x7f8a46]);
const SANDGROUND = (x, y, z) => pick(hash3(x, y, z, 25), [0xd9bb84, 0xd2b37c, 0xdfc28c, 0xcbab73, 0xd6b880]);
const EARTH = (x, y, z) => pick(hash3(x, y, z, 26), [0xbf9d6a, 0xb59362, 0xc7a574, 0xad8b5b]);
const PAVE = (x, y, z) => {
  const u = Math.floor((x + ((z >> 2) & 1) * 2) / 4), v = z >> 2;
  let c = pick(hash3(u, v, 3, 8), [0xe0c899, 0xd6bd8c, 0xe6d1a6, 0xcdb27f]);
  if ((x + ((z >> 2) & 1) * 2) % 4 === 0 || z % 4 === 0) c = shade(c, 0.86);
  return c;
};
const WOOD = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0x7a5230 : 0x8b6139);
const DARKWOOD = 0x5a3b22;
const POLE = (x, y, z) => (hash3(x, y >> 1, z, 31) < 0.5 ? 0x8a6a48 : 0x7d5f40);
const PLANK = (x, y, z) => pick(hash3((x + z) >> 1, y >> 2, 5, 22), [0xa98457, 0x9c794f, 0xb38e60, 0x94714a]);
const DOOR = (x, y, z) => pick(hash3((x + z + 64) >> 1, y >> 3, 3, 61), [0x7d4624, 0x8a4f2a, 0x6f3e20, 0x844b27]);
const DARK = 0x221c18;
const DARK2 = 0x2e2620;
const INK = 0x2a2420;
const RED = 0xb4462e;
const BLUEP = 0x3d6fb0;          // painted Egyptian blue (not team)
const OCHRE = 0xd9a640;
const GREENP = 0x4f8a5a;
const GILT = 0xdcab3c;
const GILT_L = 0xf3cf5e;
const GILT_D = 0xa8782a;
const BASALT = (x, y, z) => pick(hash3(x, y, z, 71), [0x343a3c, 0x2d3335, 0x3b4244, 0x293032]);
const BASALT_L = 0x4a5254;
const IRON = 0x3d3b39;
const STEEL = 0x9ea4aa;
const WATER = 0x4f86a8;
const CLOTH = (x, y, z) => (hash3(x, y, z, 64) < 0.5 ? 0xf3ece0 : 0xe9e2d4);
const STRIPE_R = 0xb8503c;
const STRIPE_G = 0x6f9a52;
const STRIPE_O = 0xd88a3a;
const SACK = (x, y, z) => pick(hash3(x, y, z, 65), [0xc9b48a, 0xbfa97f, 0xd2bd94]);
const GRAIN = (x, y, z) => pick(hash3(x, y, z, 66), [0xe2c470, 0xd8b862, 0xeacf80]);
const CLAY = (x, y, z) => pick(hash3(x, y >> 1, z, 33), [0xd6b07c, 0xcfa673, 0xdcb886, 0xc89f6c]);
const TERRA = (x, y, z) => pick(hash3(x, y, z, 34), [0xb8683e, 0xa95e37, 0xc27443]);
const GOLDORE = (x, y, z) => pick(hash3(x, y, z, 35), [0xe8c040, 0xd4a830, 0xf2d460, 0xb08a2a, 0x8c7a5a]);
const BARK = (x, y, z) => pick(hash3(x, y, z, 36), [0x7a5634, 0x6c4a2c, 0x86603c]);
const ENDGRAIN = 0xc9a26a;
const PALM_T = (x, y, z) => ((y & 1) ? 0x8a6a44 : 0x6f5236);
const FROND = (x, y, z) => pick(hash3(x, y, z, 37), [0x4f8a34, 0x3f7a2c, 0x5e9a3c, 0x467f30]);
const PROD = {
  green: (x, y, z) => pick(hash3(x, y, z, 42), [0x5f9a3a, 0x4f8a30, 0x72aa48, 0x87b856]),
  melon: (x, y, z) => pick(hash3(x, y, z, 43), [0x7aa83a, 0x8cb848, 0xe8c840]),
  date: (x, y, z) => pick(hash3(x, y, z, 44), [0x8a3a22, 0x7a2e1a, 0x9a4a2a]),
  orange: (x, y, z) => pick(hash3(x, y, z, 45), [0xe58a2a, 0xd87a20, 0xf09a3a]),
  fish: (x, y, z) => pick(hash3(x, y, z, 46), [0xa9b4bc, 0x97a3ac, 0xbcc6cc]),
  grain: GRAIN,
};
const FIRE = [0xc8400c, 0xe06010, 0xf08a20, 0xffb040];
const FG = { glow: 0.45 };
const TEAL = { glow: 0.7 };

// Records the coordinates it was given (construction stages are cut from it).
class Rec extends VoxelModel {
  constructor(W, D) { super(); this.coords = []; this.W = W; this.D = D; }
  set(x, y, z, color, opts) {
    if (typeof color === 'function') color = color(x, y, z);
    if (color === null || color === undefined) return this;
    if (!this.has(x, y, z)) this.coords.push([x, y, z]);
    return super.set(x, y, z, color, opts);
  }
}
const copyVox = (dst, v, x, y, z) => dst.set(x, y, z, v.team ? TEAM : v.c, v.glow ? { glow: v.glow } : undefined);

// ---- basic shapes ---------------------------------------------------------------
function lathe(m, cx, cz, y0, y1, r, color, { hollow = 0, inner = null } = {}) {
  for (let y = y0; y < y1; y++) {
    const R = r(y);
    if (R <= 0) continue;
    const R2 = (R + 0.2) * (R + 0.2), I2 = hollow > 0 ? Math.max(0, R - hollow) ** 2 : -1;
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) for (let z = Math.floor(cz - R - 1); z <= Math.ceil(cz + R + 1); z++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      if (d2 < I2) { if (inner) m.set(x, y, z, inner); continue; }
      m.set(x, y, z, color);
    }
  }
}
function barrel(m, cx, y, cz, h = 5, r = 1.6) {
  lathe(m, cx, cz, y, y + h, (yy) => r - (yy === y || yy === y + h - 1 ? 0.35 : 0), (x, yy, z) => (yy === y + 1 || yy === y + h - 2 ? IRON : pick(hash3(x, yy >> 1, z, 51), [0xa8723e, 0x9a6836, 0xb47c46])));
  lathe(m, cx, cz, y + h, y + h + 1, () => r - 0.6, 0x8c5c32);
}
// a clay jar: belly, neck and lip
function jar(m, cx, y, cz, c = 0xb8683e, big = false) {
  const prof = big ? [1.0, 1.6, 2.0, 2.1, 2.0, 1.6, 1.0, 0.8, 1.1] : [0.9, 1.4, 1.6, 1.4, 0.9, 0.7, 0.9];
  prof.forEach((r, i) => lathe(m, cx, cz, y + i, y + i + 1, () => r, (x, yy, z) => (i === 3 && big ? INK : shade(c, 0.9 + 0.03 * i))));
}
function crate(m, x, y, z, w, h, d, c = 0x9b7040) {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) {
    const ex = i === 0 || i === w - 1, ey = j === 0 || j === h - 1, ez = k === 0 || k === d - 1;
    const edge = (ex && ey) || (ey && ez) || (ex && ez);
    m.set(x + i, y + j, z + k, edge ? shade(c, 0.72) : ((i + j + k) % 3 === 0 ? shade(c, 0.9) : c));
  }
}
// an open crate / basket heaped with goods
function goodsBox(m, x, y, z, w, d, kind, h = 2, c = 0x8a6236) {
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
    const rim = i === 0 || i === w - 1 || k === 0 || k === d - 1;
    for (let j = 0; j < h; j++) m.set(x + i, y + j, z + k, rim ? shade(c, j === h - 1 ? 1 : 0.85) : (j === h - 1 ? PROD[kind] : c));
    if (!rim && hash3(x + i, y, z + k, 47) < 0.75) m.set(x + i, y + h, z + k, PROD[kind]);
  }
}
function sack(m, x, y, z) {
  m.box(x, y, z, 3, 2, 2, SACK); m.box(x + 1, y + 2, z, 1, 1, 2, SACK); m.set(x + 1, y + 3, z, 0xa8916a);
}
// a pixel sprite painted on the outermost voxels of a face: rows top -> bottom
function outer(m, face, u, y, lim) {
  const [lo, hi] = lim;
  if (face === '+z') { for (let z = hi; z >= lo; z--) if (m.has(u, y, z)) return [u, y, z]; }
  else if (face === '-z') { for (let z = lo; z <= hi; z++) if (m.has(u, y, z)) return [u, y, z]; }
  else if (face === '+x') { for (let x = hi; x >= lo; x--) if (m.has(x, y, u)) return [x, y, u]; }
  else { for (let x = lo; x <= hi; x++) if (m.has(x, y, u)) return [x, y, u]; }
  return null;
}
const OUT_N = { '+z': [0, 0, 1], '-z': [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0] };
function lim(m) { return [0, Math.max(m.W, m.D) + 4]; }
// paint `rows` (strings, top row first; '.' = leave) on a face, u0 = left end
// seen from outside (for +z: increasing x, -z: decreasing x, +x: decreasing z, -x: increasing z)
function paint(m, face, u0, yTop, rows, pal) {
  const dir = face === '+z' ? 1 : face === '-z' ? -1 : face === '+x' ? -1 : 1;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const u = u0 + i * dir, y = yTop - j;
      const p = outer(m, face, u, y, lim(m));
      if (!p) continue;
      const c = pal[ch];
      if (c === undefined) continue;
      m.set(p[0], p[1], p[2], c, ch === '*' ? FG : undefined);
    }
  });
}
// a door recessed into a face: frame of limestone jambs and a projecting lintel
function door(m, face, u0, w, y0, h, { lintel = true, sun = false, lattice = false, frame = LIME } = {}) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  const n = OUT_N[face];
  for (let i = -1; i <= w; i++) for (let y = y0; y <= y0 + h; y++) {
    const u = u0 + i * dir;
    const p = outer(m, face, u, y, lim(m));
    if (!p) continue;
    if (i === -1 || i === w || y === y0 + h) { m.set(p[0], p[1], p[2], frame); continue; }
    m.remove(p[0], p[1], p[2]);
    const q = [p[0] - n[0], p[1], p[2] - n[2]];
    let c = DOOR(q[0], q[1], q[2]);
    if (lattice && ((i & 1) || ((y - y0) % 3 === 0))) c = shade(c, 0.6);
    else if (!lattice && (i === (w >> 1) && w > 3)) c = shade(c, 0.75);
    m.set(q[0], q[1], q[2], c);
  }
  if (lintel) for (let i = -2; i <= w + 1; i++) {
    const u = u0 + i * dir;
    const p = outer(m, face, u, y0 + h, lim(m));
    if (p) m.set(p[0] + n[0], p[1], p[2] + n[2], i === -2 || i === w + 1 ? LIME_S : frame);
  }
  if (sun) {
    // the gilt winged sun disc over the lintel
    const mid = u0 + ((w - 1) / 2) * dir;
    const rows = ['GG.GGG.GG', '.GGGRGGG.', '...GGG...'];
    const len = rows[0].length;
    const start = Math.round(mid - ((len - 1) / 2) * dir);
    paint(m, face, start, y0 + h + 3, rows, { G: GILT, R: RED });
  }
}
function slit(m, face, u, y0, h = 3, w = 1) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  for (let i = 0; i < w; i++) for (let y = y0; y < y0 + h; y++) {
    const p = outer(m, face, u + i * dir, y, lim(m));
    if (p) m.set(p[0], p[1], p[2], y === y0 + h - 1 ? DARK2 : DARK);
  }
}

// ---- the Egyptian block ------------------------------------------------------
// A flat-roofed block on [x0, x1) x [z0, z1) rising from y0 for h rows (walls
// two voxels thick, a paved floor), battered (inset by one every `batter` rows),
// a dark socle, a painted frieze and a team band under the cornice, the pale
// cornice projecting one voxel, the roof plaster and on its rim a pale parapet
// with the team line inside it. Returns the roof level (top of the parapet).
const FRIEZE = [INK, RED, RED, INK, BLUEP, BLUEP, INK, OCHRE, OCHRE];
function block(m, x0, z0, x1, z1, y0, h, { wall = SAND, socle = 1, frieze = 2, band = true, cornice = 1, roofC = PLASTER, rim = true, batter = 0, parapet = true, solid = true, rimC = LIME } = {}) {
  const top = y0 + h;
  let inset = 0;
  for (let y = y0; y < top; y++) {
    inset = batter ? Math.floor((y - y0) / batter) : 0;
    const a0 = x0 + inset, a1 = x1 - inset, b0 = z0 + inset, b1 = z1 - inset;
    const t = top - 1 - y;
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const dEdge = Math.min(x - a0, a1 - 1 - x, z - b0, b1 - 1 - z);
      if (!solid && dEdge > 1) continue;
      let c;
      if (y - y0 < socle) c = SAND_D(x, y, z);
      else if (band && t === 0) c = TEAM;
      else if (t >= (band ? 1 : 0) && t < (band ? 1 : 0) + frieze) {
        const u = (x + z) % FRIEZE.length;
        c = (t === (band ? 1 : 0) + frieze - 1 && frieze > 1) ? (u % 3 === 0 ? INK : OCHRE) : FRIEZE[u];
      } else c = typeof wall === 'function' ? wall(x, y, z) : wall;
      m.set(x, y, z, dEdge > 1 ? SAND_D(x, y, z) : c);
    }
  }
  if (!solid) m.box(x0 + 2, y0, z0 + 2, x1 - x0 - 4, 1, z1 - z0 - 4, PAVE);
  // cornice + roof
  const c0 = x0 + inset - cornice, c1 = x1 - inset + cornice, d0 = z0 + inset - cornice, d1 = z1 - inset + cornice;
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
    const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
    m.set(x, top, z, e === 0 ? rimC : roofC);
    if (parapet) {
      if (e === 0) m.set(x, top + 1, z, rimC);
      else if (e === 1 && rim) m.set(x, top + 1, z, TEAM);
    }
  }
  m.lastTop = { c0, c1, d0, d1, y: top };
  return parapet ? top + 2 : top + 1;
}
// the gorge cornice lip under a roof (a shadowed row projecting one voxel at y)
function lip(m, x0, z0, x1, z1, y, c = LIME_S) {
  for (let x = x0 - 1; x <= x1; x++) for (const z of [z0 - 1, z1]) m.set(x, y, z, c);
  for (let z = z0 - 1; z <= z1; z++) for (const x of [x0 - 1, x1]) m.set(x, y, z, c);
}
// a striped cloth awning. `face` the wall it hangs from: the cloth runs from
// the wall at (yTop) out `depth` voxels to the lip at yTop - drop, across
// [a0, a1). f = the wall's outer plane coordinate. Two posts at the lip.
// colors: array cycled every `sw` voxels across.
function awning(m, face, f, a0, a1, yTop, depth, drop, colors, { sw = 2, posts = true, valance = true, ground = 1 } = {}) {
  const put = (a, y, d, c) => {
    if (face === '+z') m.set(a, y, f + d, c);
    else if (face === '-z') m.set(a, y, f - d, c);
    else if (face === '+x') m.set(f + d, y, a, c);
    else m.set(f - d, y, a, c);
  };
  for (let a = a0; a < a1; a++) {
    const col = colors[Math.floor((a - a0) / sw) % colors.length];
    let prevY = null;
    for (let s = 1; s <= depth; s++) {
      const y = yTop - Math.round(((s - 1) * drop) / Math.max(1, depth - 1));
      const c = typeof col === 'function' ? col(a, y, s) : col;
      put(a, y, s, c);
      if (prevY !== null && prevY - y > 1) put(a, y + 1, s, c);
      prevY = y;
    }
    if (valance && ((a - a0) & 1) === 0) {
      const c = typeof col === 'function' ? col(a, 0, depth) : col;
      put(a, yTop - drop - 1, depth, c);
    }
  }
  if (posts) for (const a of [a0, a1 - 1]) for (let y = ground; y < yTop - drop; y++) put(a, y, depth, POLE);
}
// a palm: a ringed trunk leaning toward (lx, lz) and a crown of drooping fronds
function palm(m, x, y, z, h = 22, { lx = 1, lz = 0, fronds = 9, len = 8, dates = true } = {}) {
  let px = x, pz = z;
  for (let j = 0; j < h; j++) {
    const t = j / h;
    px = x + Math.round(lx * 3 * t * t);
    pz = z + Math.round(lz * 3 * t * t);
    const w = j < 3 ? 2 : 1;
    for (let a = 0; a <= w - 1 + (j < 3 ? 0 : 1); a++) for (let b = 0; b <= (j < 3 ? 1 : 1); b++) m.set(px + a, y + j, pz + b, PALM_T(px, y + j, pz));
  }
  const cy = y + h, cx = px + 1, cz = pz + 1;
  m.box(cx - 1, cy, cz - 1, 2, 2, 2, 0x5e7a2c);
  if (dates) { m.set(cx - 2, cy - 1, cz, 0x9a5a22); m.set(cx + 1, cy - 1, cz - 2, 0x9a5a22); m.set(cx, cy - 1, cz + 1, 0x8a4a1a); }
  for (let k = 0; k < fronds; k++) {
    const ang = (k / fronds) * Math.PI * 2 + 0.3;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const L = len + (k % 3 === 0 ? 1 : k % 3 === 1 ? -1 : 0);
    for (let s = 0; s <= L; s++) {
      const t = s / L;
      const fx = cx + dx * s, fz = cz + dz * s, fy = cy + 1 + 2.2 * t - 6.5 * t * t;
      const X = Math.round(fx - 0.5), Z = Math.round(fz - 0.5), Y = Math.round(fy);
      m.set(X, Y, Z, FROND);
      if (s > 1 && s < L - 1) {
        // leaflets either side
        const sx = Math.round(-dz), sz = Math.round(dx);
        m.set(X + sx, Y - 1, Z + sz, FROND);
        m.set(X - sx, Y - 1, Z - sz, FROND);
      }
    }
  }
}
// a potted shrub (the temple's), a low palm in a pot
function pottedPalm(m, x, y, z) {
  lathe(m, x, z, y, y + 3, (yy) => 2.2 + (yy - y) * 0.3, (xx, yy, zz) => (yy === y + 2 ? 0x9a5a34 : TERRA(xx, yy, zz)));
  for (let k = 0; k < 7; k++) {
    const ang = (k / 7) * Math.PI * 2;
    for (let s = 0; s < 5; s++) {
      const t = s / 5;
      m.set(Math.round(x - 0.5 + Math.cos(ang) * s), Math.round(y + 3 + 3 * t - 4 * t * t), Math.round(z - 0.5 + Math.sin(ang) * s), FROND);
    }
  }
  m.box(Math.floor(x) - 1, y + 3, Math.floor(z) - 1, 2, 2, 2, 0x5e7a2c);
}
// a domed clay silo (the granary's, the TC's): a bellied body with wooden ribs,
// a dome and an open neck with a rim
function silo(m, cx, cz, y, R, H, { ribs = 6, dome = 0.62 } = {}) {
  const Hd = Math.round(R * dome);
  const rib = (x, yy, z) => {
    const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
    const k = ((a / (Math.PI * 2)) * ribs + ribs + 0.25) % 1;
    return k < 0.16 ? (hash3(x, yy, z, 52) < 0.5 ? 0x6e5236 : 0x7a5c3c) : null;
  };
  const body = (x, yy, z) => rib(x, yy, z) ?? (yy % 3 === 0 ? shade(CLAY(x, yy, z), 0.9) : CLAY(x, yy, z));
  lathe(m, cx, cz, y, y + H, (yy) => R * (0.86 + 0.14 * Math.sin(Math.PI * (yy - y + 0.5) / H)), body);
  // dome ring band then the cap
  lathe(m, cx, cz, y + H, y + H + 1, () => R * 0.9 + 0.3, 0x8a6a48);
  lathe(m, cx, cz, y + H + 1, y + H + 1 + Hd, (yy) => { const t = (yy - y - H - 0.5) / Hd; return R * 0.9 * Math.sqrt(Math.max(0, 1 - t * t)); },
    (x, yy, z) => CLAY(x, yy, z), { hollow: 0 });
  const nr = Math.max(1.6, R * 0.32);
  lathe(m, cx, cz, y + H + Hd, y + H + Hd + 2, () => nr + 0.6, (x, yy, z) => shade(CLAY(x, yy, z), 1.04), { hollow: 1, inner: DARK });
}
// a log: a cylinder of bark along x or z, end grain at both ends
function log(m, x0, y, z0, len, along = 'z', r = 1) {
  for (let s = 0; s < len; s++) for (let a = 0; a <= r; a++) for (let b = 0; b <= r; b++) {
    const end = s === 0 || s === len - 1;
    const c = end ? ENDGRAIN : BARK(s, y + b, a);
    if (along === 'z') m.set(x0 + a, y + b, z0 + s, c); else m.set(x0 + s, y + b, z0 + a, c);
  }
}
// a cart / chariot wheel standing on edge in the plane of `face` axis
function wheel(m, cx, y, cz, r = 3, plane = 'x') {
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    const d = Math.hypot(i, j);
    if (d > r + 0.3) continue;
    const c = d > r - 0.8 ? 0x5e4028 : (i === 0 || j === 0 || d < 0.8) ? 0x7a5634 : null;
    if (c === null) continue;
    if (plane === 'x') m.set(cx + i, y + r + j, cz, c); else m.set(cx, y + r + j, cz + i, c);
  }
}
// a brazier: a stone post and a bowl of fire
function brazier(m, cx, y, cz, h = 6) {
  m.box(cx - 1, y, cz - 1, 2, h, 2, LIME);
  m.box(cx - 2, y + h, cz - 2, 4, 1, 4, GILT_D);
  for (const [a, b] of [[-2, -2], [1, -2], [-2, 1], [1, 1]]) m.set(cx + a, y + h + 1, cz + b, GILT);
  m.box(cx - 1, y + h + 1, cz - 1, 2, 1, 2, FIRE[1], FG);
  m.set(cx - 1, y + h + 2, cz, FIRE[2], FG); m.set(cx, y + h + 2, cz - 1, FIRE[3], FG);
}
// a team banner on a pole (the barracks'): cloth 3 wide hanging from a crossbar
function banner(m, x, y, z, h = 20, face = '+z') {
  m.box(x, y, z, 1, h, 1, POLE);
  m.set(x, y + h, z, GILT);
  const across = face === '+z' || face === '-z';
  for (let i = -1; i <= 2; i++) across ? m.set(x + i, y + h - 1, z + (face === '+z' ? 1 : -1), DARKWOOD) : m.set(x + (face === '+x' ? 1 : -1), y + h - 1, z + i, DARKWOOD);
  for (let j = 2; j < 9; j++) for (let i = 0; i < 3; i++) {
    if (j === 8 && i === 1) continue;
    const c = j === 2 || j === 7 ? GILT : TEAM;
    across ? m.set(x + i - 1 + 1, y + h - j, z + (face === '+z' ? 1 : -1), c) : m.set(x + (face === '+x' ? 1 : -1), y + h - j, z + i, c);
  }
}

// ---- statues -------------------------------------------------------------------
// A standing (or kneeling) figure facing +z on (cx, y, cz) (cx, cz on voxel
// boundaries), modelled on a 24-voxel-high canon scaled by h / 24.
// skin: basalt or gilt; head: human | falcon | jackal | cow; crown: nemes | disc | atef | horns | none
// arms: side | staff | crossed | bowls | wings; pose: stride | stand | kneel | mummy | dress
function figure(m, cx, y, cz, o = {}) {
  const { h = 24, skin = BASALT, gold = GILT, kilt = GILT, kiltFront = TEAM, head = 'human', crown = 'nemes', arms = 'side', pose = 'stride', dir = 1 } = o;
  const s = h / 24;
  const B = (xa, ya, za, xb, yb, zb, c) => {
    const X0 = Math.round(cx + xa * s), X1 = Math.max(X0 + 1, Math.round(cx + xb * s));
    const Y0 = Math.round(y + ya * s), Y1 = Math.max(Y0 + 1, Math.round(y + yb * s));
    const Z0 = Math.round(cz + za * s * dir), Z1 = Math.round(cz + zb * s * dir);
    const zl = Math.min(Z0, Z1), zh = Math.max(Math.max(Z0, Z1), zl + 1);
    for (let xx = X0; xx < X1; xx++) for (let yy = Y0; yy < Y1; yy++) for (let zz = zl; zz < zh; zz++) m.set(xx, yy, zz, c);
  };
  const kn = pose === 'kneel' ? -8 : 0;   // the upper body drops when kneeling
  // legs / lower body
  if (pose === 'mummy') {
    B(-2.6, 0, -1.2, 2.6, 18, 1.8, skin);
    for (const yy of [3, 7, 11]) B(-2.7, yy, -1.3, 2.7, yy + 0.8, 1.9, gold);
  } else if (pose === 'dress') {
    B(-2.4, 0, -1.2, 2.4, 13, 1.6, kilt);
    B(-1.9, 0, -1.0, 1.9, 1, 2.2, skin);
    B(-2.5, 12, -1.3, 2.5, 13, 1.7, gold);
  } else if (pose === 'kneel') {
    B(-3, 0, -2.5, 3, 3.2, 3, skin);                // shins folded under
    B(-2.8, 3, -2, 2.8, 5, 1.8, kilt);               // thighs / kilt
    B(-3.1, 0, -2.8, 3.1, 0.8, 3.2, gold);
  } else {
    const fwd = pose === 'stride' ? 2.2 : 0;
    B(-2.6, 0, -0.8 + fwd, -0.4, 1, 2.4 + fwd, skin);
    B(0.4, 0, -0.8, 2.6, 1, 2.4, skin);
    B(-2.4, 1, -0.4 + fwd * 0.6, -0.5, 9.5, 1.4 + fwd * 0.6, skin);
    B(0.5, 1, -0.4, 2.4, 9.5, 1.4, skin);
    B(-2.4, 2.5, -0.5 + fwd * 0.6, -0.5, 3.2, 1.5 + fwd * 0.6, gold);   // anklets
    B(0.5, 2.5, -0.5, 2.4, 3.2, 1.5, gold);
    B(-3, 9, -1.1, 3, 13, 1.9, kilt);                // the kilt
    if (kiltFront !== null) B(-1, 8, 1.9, 1, 12.5, 2.5, kiltFront);
  }
  if (pose !== 'mummy') {
    B(-3, 12.6 + kn, -1.2, 3, 13.4 + kn, 2.0, gold); // belt
    B(-2.8, 13 + kn, -1, 2.8, 17 + kn, 1.6, skin);   // waist / chest
    B(-3.6, 16.5 + kn, -1.1, 3.6, 19 + kn, 1.6, skin); // shoulders
  }
  B(-3.2, 17.4 + kn, 1.4, 3.2, 19 + kn, 2.1, gold);  // the broad collar
  B(-2.6, 18.6 + kn, -1.2, 2.6, 19.2 + kn, 1.8, gold);
  // arms
  const armL = (c) => B(-4.7, 10.5 + kn, -0.6, -3.3, 18.6 + kn, 1.0, c);
  const armR = (c) => B(3.3, 10.5 + kn, -0.6, 4.7, 18.6 + kn, 1.0, c);
  if (arms === 'side') {
    armL(skin); armR(skin);
    B(-4.8, 11.5 + kn, -0.7, -3.2, 12.4 + kn, 1.1, gold); B(3.2, 11.5 + kn, -0.7, 4.8, 12.4 + kn, 1.1, gold);
    B(-4.8, 16 + kn, -0.7, -3.2, 16.8 + kn, 1.1, gold); B(3.2, 16 + kn, -0.7, 4.8, 16.8 + kn, 1.1, gold);
  } else if (arms === 'staff') {
    armL(skin);
    B(-4.8, 11.5 + kn, -0.7, -3.2, 12.4 + kn, 1.1, gold);
    B(3.3, 14.5 + kn, -0.6, 4.7, 18.6 + kn, 1.0, skin);   // upper arm
    B(3.3, 13.5 + kn, -0.4, 4.7, 15 + kn, 3.6, skin);     // forearm forward
    B(3.2, 13.3 + kn, 2.6, 4.8, 15.2 + kn, 3.4, gold);    // bracelet
    B(3.6, 0, 3.0, 4.6, 27, 4.0, gold);                    // the was-sceptre
    B(3.6, 26, 3.0, 4.6, 27, 5.4, gold);
    B(3.0, 0, 3.0, 5.2, 0.8, 4.0, gold);
  } else if (arms === 'crossed') {
    B(-3.4, 14 + kn, 1.4, 3.4, 16 + kn, 2.6, skin);
    B(-2.4, 12 + kn, 2.2, -1.4, 19 + kn, 3.0, gold);  // crook
    B(1.4, 12 + kn, 2.2, 2.4, 19 + kn, 3.0, gold);    // flail
    B(-3.4, 18.4 + kn, 2.2, -1.4, 19.4 + kn, 3.0, gold);
  } else if (arms === 'bowls') {
    B(-4.6, 13 + kn, -0.6, -3.2, 18.6 + kn, 1.0, skin);
    B(3.2, 13 + kn, -0.6, 4.6, 18.6 + kn, 1.0, skin);
    B(-4.6, 12 + kn, 0.4, -3.2, 13.6 + kn, 4.2, skin);
    B(3.2, 12 + kn, 0.4, 4.6, 13.6 + kn, 4.2, skin);
    B(-5.2, 13.4 + kn, 3, -2.6, 15.6 + kn, 5.6, gold);
    B(2.6, 13.4 + kn, 3, 5.2, 15.6 + kn, 5.6, gold);
  } else if (arms === 'wings') {
    // Isis: arms out, wings sweeping down from the arms
    B(-6.5, 15.5 + kn, -0.4, -3.3, 17.5 + kn, 1.0, skin);
    B(3.3, 15.5 + kn, -0.4, 6.5, 17.5 + kn, 1.0, skin);
    for (let k = 0; k < 6; k++) {
      const yy = 15.5 - k * 1.6;
      B(-9 + k * 0.3, yy - 1.6 + kn, -0.2, -3.6, yy + kn, 0.8, k & 1 ? gold : GILT_D);
      B(3.6, yy - 1.6 + kn, -0.2, 9 - k * 0.3, yy + kn, 0.8, k & 1 ? gold : GILT_D);
    }
  } else if (arms === 'embrace') {
    armL(skin);
    B(3.3, 15 + kn, -0.6, 4.7, 18.6 + kn, 1.0, skin);
    B(3.3, 15 + kn, -1.6, 6.5, 16.4 + kn, -0.2, skin);
  }
  // neck and head
  B(-1, 19 + kn, -0.4, 1, 20 + kn, 1.2, skin);
  const hy = 20 + kn;
  if (head === 'falcon') {
    B(-1.7, hy, -1.2, 1.7, hy + 3.4, 1.5, skin);
    B(-0.7, hy + 0.8, 1.5, 0.7, hy + 2.4, 3.1, gold);    // beak
    B(-0.7, hy + 0.6, 2.6, 0.7, hy + 1.2, 3.1, INK);
    B(-1.8, hy + 2, 1.0, -1.1, hy + 2.6, 1.6, gold); B(1.1, hy + 2, 1.0, 1.8, hy + 2.6, 1.6, gold);
    B(-2.2, hy - 2.5, -1.3, 2.2, hy + 2.6, 0.6, gold);  // the striped wig behind
    B(-2.3, hy - 1, -1.4, 2.3, hy - 0.4, 0.7, INK);
  } else if (head === 'jackal') {
    B(-1.6, hy, -1.2, 1.6, hy + 3, 1.4, skin);
    B(-0.7, hy + 0.6, 1.4, 0.7, hy + 2, 4.4, skin);       // the long snout
    B(-1.7, hy + 3, -0.4, -0.5, hy + 7, 0.6, skin);       // square-topped ears
    B(0.5, hy + 3, -0.4, 1.7, hy + 7, 0.6, skin);
    B(-2.2, hy - 2.5, -1.3, 2.2, hy + 2.2, 0.4, gold);
  } else {
    B(-1.6, hy, -1.1, 1.6, hy + 3.4, 1.7, skin);          // the face
    B(-0.4, hy + 1.2, 1.7, 0.4, hy + 2.2, 2.3, skin);      // nose
  }
  if (crown === 'nemes') {
    B(-2.3, hy + 1.6, -1.6, 2.3, hy + 4.4, 1.2, gold);
    B(-2.3, hy + 2.6, -1.6, 2.3, hy + 3.0, 1.2, INK);
    B(-2.4, hy - 2.6, 0.6, -1.4, hy + 2, 1.9, gold); B(1.4, hy - 2.6, 0.6, 2.4, hy + 2, 1.9, gold);  // lappets
    B(-2.4, hy - 1.2, 0.6, -1.4, hy - 0.8, 1.9, INK); B(1.4, hy - 1.2, 0.6, 2.4, hy - 0.8, 1.9, INK);
    B(-0.4, hy + 3.6, 1.2, 0.4, hy + 4.4, 1.9, gold);      // uraeus
  } else if (crown === 'disc') {
    // the sun disc (Ra): a red disc rimmed in gold, standing behind the head
    const r = 3.2 * s, yc = y + (hy + 6.6) * s, zc = Math.round(cz - 0.4 * s * dir);
    for (let i = -Math.ceil(r) - 1; i <= Math.ceil(r); i++) for (let j = -Math.ceil(r) - 1; j <= Math.ceil(r); j++) {
      const d = Math.hypot(i + 0.5, j + 0.5);
      if (d > r + 0.3) continue;
      m.set(cx + i, Math.round(yc + j), zc, d > r - 0.9 ? gold : 0xc8402a);
    }
    B(-0.5, hy + 3.2, 0.6, 0.5, hy + 4.4, 1.6, gold);
  } else if (crown === 'atef' || crown === 'tall') {
    B(-1.8, hy + 2.6, -1.1, 1.8, hy + 5, 1.4, gold);
    B(-1.3, hy + 5, -0.8, 1.3, hy + 8, 1.1, gold);
    B(-0.8, hy + 8, -0.5, 0.8, hy + 10, 0.8, gold);
    B(-0.5, hy + 10, -0.3, 0.5, hy + 11, 0.6, GILT_L);
    if (crown === 'atef') { B(-2.6, hy + 4, -0.4, -1.8, hy + 9, 0.4, gold); B(1.8, hy + 4, -0.4, 2.6, hy + 9, 0.4, gold); }
  } else if (crown === 'horns') {
    // Isis: the vulture cap, cow horns and the sun disc
    B(-2.2, hy + 1.6, -1.5, 2.2, hy + 3.8, 1.3, gold);
    B(-2.3, hy - 2.4, 0.4, -1.5, hy + 2, 1.6, gold); B(1.5, hy - 2.4, 0.4, 2.3, hy + 2, 1.6, gold);
    B(-0.9, hy + 3.8, -0.6, 0.9, hy + 4.6, 0.8, gold);
    B(-3.2, hy + 4.4, -0.3, -2.2, hy + 7.6, 0.5, gold); B(2.2, hy + 4.4, -0.3, 3.2, hy + 7.6, 0.5, gold);
    B(-3.2, hy + 4.4, -0.3, 3.2, hy + 5.2, 0.5, gold);
    const r = 2.1 * s, yc = y + (hy + 6.6) * s, zc = Math.round(cz - 0.2 * s * dir);
    for (let i = -Math.ceil(r) - 1; i <= Math.ceil(r); i++) for (let j = -Math.ceil(r) - 1; j <= Math.ceil(r); j++) {
      const d = Math.hypot(i + 0.5, j + 0.5);
      if (d <= r + 0.3) m.set(cx + i, Math.round(yc + j), zc, d > r - 0.8 ? gold : 0xc8402a);
    }
  } else if (crown === 'set') {
    B(-2.2, hy - 2.5, -1.3, 2.2, hy + 2.6, 0.6, gold);
    B(-1.4, hy + 3, -0.6, 1.4, hy + 4, 0.8, gold);
  } else if (crown === 'vulture') {
    B(-2.3, hy + 1.4, -1.6, 2.3, hy + 4.0, 1.3, gold);
    B(-2.5, hy - 3.6, -0.6, -1.5, hy + 2, 1.5, gold); B(1.5, hy - 3.6, -0.6, 2.5, hy + 2, 1.5, gold);
    B(-1.2, hy + 4, -0.8, 1.2, hy + 5, 1.0, gold);
  }
}
// a plinth: a gilt-framed block with team panels low down, dark or stone faces
function plinth(m, x0, z0, x1, z1, y0, h, { face = BASALT, frame = GILT, team = true, eye = false, cap = true } = {}) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const ex = x === x0 || x === x1 - 1, ez = z === z0 || z === z1 - 1;
    if (!ex && !ez) continue;
    const r = y - y0;
    let c = typeof face === 'function' ? face(x, y, z) : face;
    if ((ex && ez) || r === 0 || r === h - 1) c = frame;
    else if (team && r >= 1 && r <= 2 && ((ex ? z : x) % 3 !== 0)) c = TEAM;
    else if (r === 3) c = frame;
    m.set(x, y, z, c);
  }
  m.box(x0 + 1, y0, z0 + 1, x1 - x0 - 2, h, z1 - z0 - 2, DARK2);
  if (cap) {
    for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) {
      const e = x === x0 - 1 || x === x1 || z === z0 - 1 || z === z1;
      m.set(x, y0 + h, z, e ? frame : (typeof face === 'function' ? face(x, y0 + h, z) : face));
    }
  }
  if (eye) {
    // the Eye of Horus on the front panel
    const mid = Math.floor((x0 + x1) / 2);
    paint(m, '+z', mid - 4, y0 + h - 2, ['..GGGGG..', '.G.GGG.G.', 'GGGG.GGGG', '...G..G..', '..G....G.'], { G: GILT_L });
  }
  return y0 + h + (cap ? 1 : 0);
}

// ---- weathering --------------------------------------------------------------
function weather(m) {
  const updates = [];
  for (const [x, y, z] of m.coords) {
    const v = m.get(x, y, z);
    if (!v || v.glow || y < 1) continue;
    if (v.team) {
      let c = hash3(x, y, z, 97) < 0.5 ? 0xf6f6f6 : 0xe6e6e6;
      if (!m.has(x, y - 1, z)) c = shade(c, 0.88);
      v.c = c;
      continue;
    }
    const ex = !m.has(x + 1, y, z) || !m.has(x - 1, y, z);
    const ez = !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    const up = !m.has(x, y + 1, z);
    const under = !m.has(x, y - 1, z);
    let f = 1;
    if (ex && ez) f *= hash3(x, y, z, 93) < 0.15 ? 0.88 : 1.06;
    else if (up && (ex || ez)) f *= 1.05;
    if (under && (ex || ez)) f *= 0.82;
    if ((ex || ez) && y < 4) f *= 0.9 + 0.025 * Math.max(0, y);     // sand splash at the foot
    if (f !== 1) updates.push([v, f]);
  }
  for (const [v, f] of updates) {
    let c = shade(v.c, f);
    if (f > 1) { const r = Math.min((c >> 16) & 255, 250), g = Math.min((c >> 8) & 255, 244), b = Math.min(c & 255, 232); c = (r << 16) | (g << 8) | b; }
    v.c = c;
  }
}

// ---- construction stages ---------------------------------------------------------
const BRICK = (x, y, z) => pick(hash3(x, y, z, 23), [0xb48655, 0xa77a4c, 0xbc8e5c]);
function stage(full, k) {
  const W = full.W, D = full.D;
  let top = 0;
  const ub = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  for (const [x, y, z] of full.coords) {
    if (!full.has(x, y, z)) continue;
    top = Math.max(top, y + 1);
    if (y >= 3) { ub.x0 = Math.min(ub.x0, x); ub.x1 = Math.max(ub.x1, x); ub.z0 = Math.min(ub.z0, z); ub.z1 = Math.max(ub.z1, z); }
  }
  const cut = k <= 0 ? 1 : Math.max(2, Math.round(1 + (top - 1) * Math.pow(k / STAGES, 0.9)));
  const m = new VoxelModel();
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v || y >= cut) continue;
    if (y === 0 || k > 0) copyVox(m, v, x, y, z);
  }
  if (full.extra) { m.extra = full.extra; m.extraMaxY = k >= STAGES - 1 ? Infinity : cut; }
  const clx = (v) => Math.max(0, Math.min(W - 1, v)), clz = (v) => Math.max(0, Math.min(D - 1, v));
  const x0 = clx(ub.x0 - 1), x1 = clx(ub.x1 + 1), z0 = clz(ub.z0 - 1), z1 = clz(ub.z1 + 1);
  const small = W <= 16;
  if (k <= 0) {
    // the staked-out lot: palm-wood stakes with team pennants, a rope, mud bricks drying
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      m.box(x, 1, z, 1, 6, 1, POLE);
      m.set(x, 6, z, TEAM); m.set(x + (x > W / 2 ? -1 : 1), 6, z, TEAM); m.set(x + (x > W / 2 ? -1 : 1), 5, z, TEAM);
    }
    for (let x = x0; x <= x1; x++) { m.set(x, 3, z0, 0xcdb98a); m.set(x, 3, z1, 0xcdb98a); }
    for (let z = z0; z <= z1; z++) { m.set(x0, 3, z, 0xcdb98a); m.set(x1, 3, z, 0xcdb98a); }
    for (let x = x0 + 2; x < x1 - 1; x++) for (let z = z0 + 2; z < z1 - 1; z++) if (hash3(x, 1, z, 4) < 0.07) m.set(x, 1, z, EARTH);
    for (let i = 0; i < (small ? 2 : 4); i++) m.box(x0 + 2 + i * 3, 1, z1 - 3, 2, 1, 1, BRICK);
  } else {
    const sTop = Math.min(top + 2, cut + 4);
    const xs = [], zs = [];
    const step = small ? 6 : 8;
    for (let x = x0; x < x1 - 3; x += step) xs.push(x);
    xs.push(x1);
    for (let z = z0; z < z1 - 3; z += step) zs.push(z);
    zs.push(z1);
    for (const x of xs) for (const z of [z0, z1]) m.box(x, 1, z, 1, sTop, 1, POLE);
    for (const z of zs) for (const x of [x0, x1]) m.box(x, 1, z, 1, sTop, 1, POLE);
    const walk = Math.max(3, cut - 1);
    const levels = new Set([walk]);
    for (let y = 8; y < walk - 3; y += 8) levels.add(y);
    for (const y of levels) {
      for (let x = x0; x <= x1; x++) { m.set(x, y, z0, PLANK); m.set(x, y, z1, PLANK); }
      for (let z = z0; z <= z1; z++) { m.set(x0, y, z, PLANK); m.set(x1, y, z, PLANK); }
    }
    // reed lashing braces on the front and the side
    for (let i = 0; i + 1 < xs.length; i++) for (let y = 1; y + 7 <= sTop; y += 16) m.line(xs[i], y, z1, xs[i + 1], y + 7, z1, POLE);
    for (let i = 0; i + 1 < zs.length; i++) for (let y = 1; y + 7 <= sTop; y += 16) m.line(x1, y, zs[i], x1, y + 7, zs[i + 1], POLE);
    m.set(x1, sTop, z1, TEAM); m.set(x1 - 1, sTop, z1, TEAM); m.set(x1 - 1, sTop - 1, z1, TEAM);
    // a mud-brick ramp against the front (the Egyptian way up) and stacked bricks / stone blocks
    if (k < STAGES - 1 && !small) {
      const rampH = Math.min(cut - 1, 10);
      for (let s = 0; s < rampH; s++) m.box(x0 + 2, 1 + s, Math.min(D - 1, z1 + 1) - Math.floor(s / 2) , 5, 1, 1, BRICK);
    }
    if (k < STAGES - 1) {
      m.box(W - 5, 1, D - 3, 3, 2, 2, LIME);
      if (k < STAGES - 3) m.box(W - 4, 3, D - 3, 2, 1, 2, LIME);
      m.box(1, 1, D - 2, small ? 4 : 6, 1, 1, BRICK);
      if (k < STAGES - 2) m.box(2, 2, D - 2, small ? 2 : 4, 1, 1, BRICK);
    }
  }
  return m;
}

// ---- buildings -----------------------------------------------------------------
function lot(W, D, ground = SANDGROUND) {
  const m = new Rec(W, D);
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) m.set(x, 0, z, ground);
  return m;
}

// House (3 x 3 tiles; Retold building_03 / building_04): small flat-roofed
// boxes with an upper room, a striped awning on poles, crates and jars.
// age 1 (Archaic): mud brick with palm-thatch roofs; age 2: whitewashed
// sandstone with plaster roofs and painted bands.
function house(v, age) {
  const m = lot(24, 24);
  const arch = age === 1;
  const W = arch ? MUD : SAND, R = arch ? THATCH : PLASTER;
  const bo = { wall: W, roofC: R, frieze: arch ? 0 : 2, socle: 1 };
  const stripes = [STRIPE_R, CLOTH, CLOTH, STRIPE_R, CLOTH];
  if (v === 0) {
    const t = block(m, 3, 4, 15, 16, 1, 11, bo);
    block(m, 6, 6, 13, 13, t - 1, 5, { ...bo, frieze: 0 });
    block(m, 15, 9, 22, 20, 1, 8, { ...bo, frieze: 0 });
    door(m, '+z', 7, 3, 1, 6);
    door(m, '+z', 17, 3, 1, 5);
    slit(m, '+x', 17, 5, 2, 2); slit(m, '+x', 13, 14, 2, 2); slit(m, '+z', 8, t + 1, 2, 2);
    awning(m, '+z', 15, 3, 15, 10, 6, 4, stripes);
    crate(m, 4, 1, 18, 3, 3, 3); crate(m, 5, 4, 18, 2, 2, 2, 0xa77a48);
    goodsBox(m, 17, 1, 21, 3, 2, 'green');
    jar(m, 13.5, 1, 18.5);
    barrel(m, 21, 1, 7, 4, 1.4);
  } else if (v === 1) {
    const t = block(m, 4, 3, 19, 14, 1, 10, bo);
    block(m, 4, 14, 12, 21, 1, 8, { ...bo, frieze: 0 });
    block(m, 13, 5, 19, 12, t - 1, 4, { ...bo, frieze: 0 });
    door(m, '+z', 14, 3, 1, 6);
    door(m, '+x', 19, 3, 1, 5);
    slit(m, '+x', 9, 6, 2, 2); slit(m, '+z', 6, 5, 2, 2);
    awning(m, '+x', 18, 4, 13, 8, 5, 3, stripes, { sw: 2 });
    crate(m, 13, 1, 17, 3, 3, 3); goodsBox(m, 17, 1, 17, 3, 3, 'date');
    jar(m, 21.5, 1, 9.5); jar(m, 21.5, 1, 6.5, 0xc8a070);
    m.box(9, 1, 21, 4, 1, 2, PLANK);
  } else {
    const t = block(m, 5, 5, 17, 17, 1, 9, bo);
    block(m, 8, 3, 15, 10, t - 1, 4, { ...bo, frieze: 0 });
    // a walled yard on the front with a palm
    for (let x = 4; x < 20; x++) for (let y = 1; y < 4; y++) m.set(x, y, 21, y === 3 ? LIME : W);
    for (let z = 17; z < 22; z++) for (let y = 1; y < 4; y++) { m.set(4, y, z, y === 3 ? LIME : W); m.set(19, y, z, y === 3 ? LIME : W); }
    for (let x = 10; x < 13; x++) for (let y = 1; y < 4; y++) m.remove(x, y, 21);
    door(m, '+z', 9, 3, 1, 6);
    slit(m, '+x', 9, 5, 2, 2); slit(m, '+z', 14, 5, 2, 2);
    awning(m, '+x', 17, 7, 15, 8, 4, 3, stripes);
    palm(m, 15, 1, 18, 17, { lx: 1, lz: 0.4, len: 6, fronds: 8 });
    jar(m, 6.5, 1, 18.5, 0xc8a070); crate(m, 6, 1, 19, 2, 2, 2);
  }
  return m;
}

// Granary (3 x 3; building_05): a flat-roofed hut with a roof hatch and a
// ladder, two big domed clay silos with wooden ribs, sacks and a grain bin.
function granary() {
  const m = lot(24, 24);
  const t = block(m, 2, 2, 15, 13, 1, 10, { frieze: 2 });
  for (let x = 6; x < 10; x++) for (let z = 5; z < 9; z++) m.set(x, t - 2, z, DARK);   // the roof hatch
  for (let x = 5; x < 11; x++) for (const z of [4, 9]) m.set(x, t - 1, z, 0x8a6a48);
  for (let z = 4; z < 10; z++) for (const x of [5, 10]) m.set(x, t - 1, z, 0x8a6a48);
  // the ladder leaning on the front
  for (let y = 1; y < t; y++) { const z = 13 + Math.floor((t - y) / 4); m.set(3, y, z, POLE); m.set(6, y, z, POLE); if (y % 3 === 0) { m.set(4, y, z, POLE); m.set(5, y, z, POLE); } }
  silo(m, 18.5, 9, 1, 5.2, 10);
  silo(m, 10.5, 18, 1, 4.8, 9);
  door(m, '-x', 4, 3, 1, 6);
  goodsBox(m, 16, 1, 17, 5, 4, 'grain', 2, 0x7a5430);
  sack(m, 15, 1, 21); sack(m, 19, 1, 21);
  barrel(m, 1.8, 1, 16, 4, 1.4);
  return m;
}

// Lumber Camp (3 x 3; building_06): a battered flat-roofed block with a team
// band, a striped awning on poles over a pile of logs, crates and barrels.
function lumberCamp() {
  const m = lot(24, 24);
  const t = block(m, 2, 3, 13, 15, 1, 12, { batter: 5, frieze: 2 });
  door(m, '+z', 6, 3, 1, 6);
  slit(m, '+x', 7, 7, 2, 1);
  // the awning from the block's east face over the log pile
  awning(m, '+x', 12, 6, 18, t - 4, 9, 4, [STRIPE_R, CLOTH, CLOTH, STRIPE_O, CLOTH]);
  // the log pile (along z) under it, stacked 3-2-1
  for (const [row, n] of [[0, 4], [1, 3], [2, 2]]) for (let i = 0; i < n; i++) log(m, 13 + i * 2 + row, 1 + row * 2, 7, 12 - row, 'z', 1);
  log(m, 9, 1, 18, 9, 'x', 1); log(m, 12, 3, 19, 6, 'x', 1);
  // a chopping block with an axe
  lathe(m, 6, 20, 1, 3, () => 1.6, (x, y, z) => (y === 2 ? ENDGRAIN : BARK(x, y, z)));
  m.set(6, 3, 20, STEEL); m.set(6, 4, 20, 0x7a5230); m.set(6, 5, 20, 0x7a5230);
  crate(m, 2, 1, 19, 3, 3, 3); crate(m, 2, 1, 16, 2, 2, 2, 0xa77a48);
  barrel(m, 20, 1, 3, 4, 1.4);
  return m;
}

// Mining Camp (3 x 3; building_07): a flat-roofed block with two striped
// awnings over bins of gold ore, nuggets, crates and a water trough.
function miningCamp() {
  const m = lot(24, 24);
  const t = block(m, 7, 3, 17, 15, 1, 12, { batter: 6, frieze: 2 });
  door(m, '+z', 10, 4, 1, 7);
  const st = [STRIPE_R, CLOTH, STRIPE_R, CLOTH, CLOTH];
  awning(m, '-x', 7, 6, 17, t - 4, 6, 3, st);
  awning(m, '+x', 16, 6, 17, t - 4, 6, 3, st);
  // ore bins under the west awning, a trough under the east one
  for (let x = 1; x < 7; x++) for (let z = 8; z < 16; z++) for (let y = 1; y < 4; y++) {
    const rim = x === 1 || x === 6 || z === 8 || z === 15;
    if (rim) m.set(x, y, z, PLANK(x, y, z)); else if (y === 3) m.set(x, y, z, GOLDORE);
  }
  for (let x = 2; x < 6; x++) for (let z = 9; z < 15; z++) if (hash3(x, 4, z, 5) < 0.5) m.set(x, 4, z, GOLDORE);
  for (let x = 18; x < 23; x++) for (let z = 9; z < 16; z++) for (let y = 1; y < 4; y++) {
    const rim = x === 18 || x === 22 || z === 9 || z === 15;
    m.set(x, y, z, rim ? LIME(x, y, z) : (y === 3 ? WATER : LIME(x, y, z)));
  }
  for (const [x, z] of [[10, 19], [12, 21], [8, 21], [14, 18]]) { m.box(x, 1, z, 2, 1, 2, GOLDORE); m.set(x, 2, z, GOLDORE); }
  crate(m, 15, 1, 19, 3, 3, 3); crate(m, 18, 1, 19, 2, 2, 2, 0xa77a48);
  barrel(m, 21, 1, 19, 4, 1.4);
  // a pick leaning on the wall
  m.line(16, 1, 15, 17, 6, 16, 0x7a5230); m.set(16, 6, 16, STEEL); m.set(18, 6, 16, STEEL);
  return m;
}

// Town Center (7 x 7; building_02, building_01): a walled sandstone compound,
// two flat-roofed blocks with team rims (the main one two-storeyed), a pylon
// gateway on the front, striped awnings, a big domed silo, a courtyard
// with a fire bowl, a palm, and the falcon-headed Ra statue on a plinth at
// the front-left corner.
function townCenter() {
  const N = 56;
  const m = lot(N, N);
  for (let x = 5; x < 51; x++) for (let z = 5; z < 51; z++) m.set(x, 0, z, PAVE);
  // the enclosure wall with a flat coping, piers at the corners and by the gate
  const wallH = 8;
  const isGate = (x) => x >= 24 && x < 32;
  for (let y = 1; y <= wallH; y++) for (let i = 4; i < 52; i++) {
    for (const [x, z] of [[i, 4], [i, 5], [i, 50], [i, 51], [4, i], [5, i], [50, i], [51, i]]) {
      if ((z === 50 || z === 51) && isGate(x)) continue;
      m.set(x, y, z, y === wallH ? LIME(x, y, z) : y === 1 ? SAND_D(x, y, z) : SAND(x, y, z));
    }
  }
  for (let i = 3; i < 53; i++) for (const [x, z] of [[i, 3], [i, 52], [3, i], [52, i]]) { if ((z === 52) && isGate(x)) continue; m.set(x, wallH, z, LIME_S); }
  for (const [px, pz] of [[2, 2], [48, 2], [48, 48], [17, 48], [32, 48]]) block(m, px, pz, px + 6, pz + 6, 1, 11, { frieze: 0, band: true, rim: true });
  // the gateway: two battered pylon towers with a lintel bridge, painted
  block(m, 17, 46, 24, 54, 1, 16, { batter: 5, frieze: 2 });
  block(m, 32, 46, 39, 54, 1, 16, { batter: 5, frieze: 2 });
  for (let x = 22; x < 34; x++) for (let z = 48; z < 53; z++) for (let y = 12; y < 16; y++) m.set(x, y, z, y === 15 ? LIME(x, y, z) : y === 12 ? LIME_S : SAND(x, y, z));
  paint(m, '+z', 25, 14, ['GG.GGG.GG', '.GGGRGGG.'], { G: GILT, R: RED });
  for (const px of [18, 33]) {
    paint(m, '+z', px + 1, 12, ['.O.', 'OOO', '.O.', 'BOB', 'B.B', 'B.B', 'K.K'], { O: OCHRE, B: BLUEP, K: INK });
    paint(m, '+z', px + 4, 12, ['K', '.', 'R', 'K', '.', 'B', 'K'], { K: INK, R: RED, B: BLUEP });
  }
  // the main hall (two storeys) at the back left, its door to the courtyard
  const t1 = block(m, 8, 8, 30, 27, 1, 16, { frieze: 2 });
  const t1b = block(m, 12, 11, 26, 23, t1 - 1, 6, { frieze: 0 });
  void t1b;
  door(m, '+z', 17, 4, 1, 8, { lattice: true, sun: true });
  slit(m, '+z', 11, 10, 3, 1); slit(m, '+z', 27, 10, 3, 1); slit(m, '+x', 13, 10, 3, 1); slit(m, '+x', 20, 10, 3, 1);
  slit(m, '+z', 15, t1 + 1, 2, 2); slit(m, '+z', 21, t1 + 1, 2, 2);
  awning(m, '+z', 26, 9, 16, 12, 7, 4, [STRIPE_R, CLOTH, STRIPE_R, CLOTH, CLOTH]);
  // the east block with an awning over its west door
  const t2 = block(m, 35, 8, 48, 22, 1, 12, { frieze: 2 });
  void t2;
  door(m, '+z', 39, 4, 1, 7);
  slit(m, '+x', 12, 6, 3, 1); slit(m, '+x', 17, 6, 3, 1);
  awning(m, '-x', 35, 11, 20, 10, 5, 3, [STRIPE_R, CLOTH, CLOTH]);
  // the front-left block (the small barracks room)
  block(m, 8, 33, 22, 45, 1, 11, { frieze: 2 });
  door(m, '+x', 41, 3, 1, 6);
  slit(m, '+z', 11, 6, 2, 2); slit(m, '+z', 17, 6, 2, 2);
  // the big domed silo (front right) and a smaller one
  silo(m, 42, 39, 1, 6.2, 13);
  silo(m, 44.5, 28.5, 1, 4.2, 9);
  // the courtyard: a fire bowl, a basin, jars, crates, a palm
  m.box(27, 1, 34, 5, 1, 5, LIME); m.box(28, 2, 35, 3, 1, 3, DARK);
  m.set(29, 2, 36, FIRE[3], FG); m.set(28, 2, 36, FIRE[1], FG); m.set(29, 2, 35, FIRE[2], FG); m.set(30, 2, 37, FIRE[0], FG); m.set(29, 3, 36, FIRE[2], FG);
  for (let x = 33; x < 38; x++) for (let z = 25; z < 29; z++) m.set(x, 1, z, x === 33 || x === 37 || z === 25 || z === 28 ? LIME : WATER);
  jar(m, 24.5, 1, 30.5); jar(m, 26.5, 1, 29.5, 0xc8a070); jar(m, 32.5, 1, 31.5, 0xb8683e, true);
  barrel(m, 33, 1, 41, 4, 1.4); barrel(m, 36, 1, 43, 4, 1.4);
  crate(m, 24, 1, 40, 3, 3, 3); crate(m, 25, 4, 41, 2, 2, 2, 0xa77a48);
  goodsBox(m, 36, 1, 33, 4, 3, 'grain');
  palm(m, 8, 1, 28, 21, { lx: 0.3, lz: 1, len: 7 });
  // the Ra statue on its plinth at the front-left corner (outside the wall line)
  const py = plinth(m, 2, 46, 12, 54, 1, 7, { face: SAND, frame: LIME, team: true });
  figure(m, 7, py, 50, { h: 26, skin: GILT, gold: GILT_L, kilt: CLOTH, kiltFront: TEAM, head: 'falcon', crown: 'disc', arms: 'staff', pose: 'stride' });
  return m;
}

// Temple (5 x 6; building_08): a two-tier stepped platform with a ramp, a
// pillared kiosk of papyrus columns with screen walls and white drapes, a
// flat roof with a team rim, the major god's statue on a plinth at the front
// left, a potted palm and fire bowls at the ramp foot.
function temple(god) {
  const W = 40, D = 48;
  const m = lot(W, D);
  // tier 1 and tier 2 platforms
  const tier = (x0, z0, x1, z1, y0, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const e = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z);
      m.set(x, y, z, y === y0 + h - 1 ? (e === 0 ? LIME(x, y, z) : PAVE(x, y, z)) : (y === y0 + h - 2 && e === 0 ? TEAM : SAND(x, y, z)));
    }
  };
  tier(1, 2, 39, 38, 1, 3);
  tier(5, 5, 35, 33, 4, 3);
  // the ramp up the front (z 33 -> 46), with low side walls
  for (let z = 33; z < 47; z++) {
    const yTop = Math.max(1, Math.round(6 - ((z - 33) * 5) / 13));
    for (let x = 15; x < 25; x++) for (let y = 1; y <= yTop; y++) m.set(x, y, z, y === yTop ? LIME(x, y, z) : SAND(x, y, z));
    for (const x of [14, 25]) for (let y = 1; y <= yTop + 1; y++) m.set(x, y, z, y === yTop + 1 ? LIME_S : SAND_D(x, y, z));
  }
  // the kiosk: 4 x 4 papyrus columns round [10, 30) x [10, 28)
  const fl = 7;
  const colH = 13;
  const cols = [10, 16, 22, 27];
  const colsZ = [10, 15, 20, 25];
  const column = (x, z) => {
    for (let y = fl; y < fl + colH; y++) {
      const r = y - fl;
      const capital = r >= colH - 3;
      const w = capital ? (r === colH - 1 ? 5 : 4) : 3;
      const o = capital ? (w === 5 ? -1 : -0.5) : 0;
      for (let i = 0; i < w; i++) for (let k = 0; k < w; k++) {
        const X = Math.round(x + o + i - (w === 4 ? 0 : 0)), Z = Math.round(z + o + k);
        let c = LIME(X, y, Z);
        if (capital) c = r === colH - 1 ? LIME(X, y, Z) : ((i + k) & 1 ? GREENP : BLUEP);
        else if (r === 0) c = SAND_D(X, y, Z);
        else if (r % 4 === 2) c = RED;
        else if (r % 4 === 3) c = OCHRE;
        m.set(X, y, Z, c);
      }
    }
  };
  for (const x of cols) { column(x, colsZ[0]); column(x, colsZ[3]); }
  for (const z of [colsZ[1], colsZ[2]]) { column(cols[0], z); column(cols[3], z); }
  // screen walls between the columns (half height, with painted reliefs), open in the front middle
  const screen = (xa, xb, za, zb) => {
    for (let x = xa; x < xb; x++) for (let z = za; z < zb; z++) for (let y = fl; y < fl + 5; y++) m.set(x, y, z, y === fl + 4 ? LIME(x, y, z) : y === fl + 3 ? TEAM : SAND(x, y, z));
  };
  screen(13, 16, 26, 28); screen(25, 27, 26, 28);
  screen(10, 13, 13, 15); screen(10, 13, 18, 20); screen(10, 13, 23, 25);
  screen(27, 30, 13, 15); screen(27, 30, 18, 20); screen(27, 30, 23, 25);
  // the naos inside with its door
  block(m, 14, 12, 26, 23, fl, 9, { frieze: 2, parapet: false, band: false });
  door(m, '+z', 18, 4, fl, 6, { sun: false });
  // architrave and roof
  const ay = fl + colH;
  for (let x = 9; x < 31; x++) for (let z = 9; z < 29; z++) {
    const e = Math.min(x - 9, 30 - x, z - 9, 28 - z);
    if (e > 2) continue;
    for (let y = ay; y < ay + 2; y++) m.set(x, y, z, y === ay ? (((x + z) % 6) < 3 ? RED : BLUEP) : LIME(x, y, z));
  }
  for (let x = 9; x < 31; x++) for (let z = 9; z < 29; z++) {
    const e = Math.min(x - 9, 30 - x, z - 9, 28 - z);
    if (e > 2) m.set(x, ay + 1, z, PLASTER);
  }
  lip(m, 9, 9, 31, 29, ay + 2, LIME_S);
  for (let x = 8; x < 32; x++) for (let z = 8; z < 30; z++) {
    const e = Math.min(x - 8, 31 - x, z - 8, 29 - z);
    m.set(x, ay + 2, z, e === 0 ? LIME(x, ay + 2, z) : PLASTER(x, ay + 2, z));
    if (e === 0) m.set(x, ay + 3, z, LIME(x, ay + 3, z));
    else if (e === 1) m.set(x, ay + 3, z, TEAM);
  }
  // the drapes: white cloth from the front architrave swept to the outer columns
  for (const [x0, dir] of [[13, -1], [26, 1]]) {
    for (let y = fl + 1; y < ay; y++) {
      const t = (ay - y) / (ay - fl);
      const x = Math.round(x0 + dir * 3 * Math.sin(t * Math.PI * 0.5));
      m.set(x, y, 29, CLOTH); m.set(x + (dir > 0 ? -1 : 1), y, 29, CLOTH);
      if (t > 0.4) m.set(x + dir, y, 29, CLOTH);
    }
  }
  // the god statue on its plinth at the front left (on tier 1)
  const py = plinth(m, 2, 30, 11, 38, 4, 8, { face: SAND, frame: LIME });
  const G = {
    ra: { head: 'falcon', crown: 'disc', arms: 'staff', skin: GILT, kilt: CLOTH },
    isis: { head: 'human', crown: 'horns', arms: 'wings', skin: GILT, kilt: CLOTH, pose: 'dress' },
    set: { head: 'jackal', crown: 'set', arms: 'staff', skin: BASALT, kilt: GILT },
  }[god];
  figure(m, 6.5, py, 34, { h: 26, gold: GILT_L, kiltFront: TEAM, pose: 'stride', ...G });
  pottedPalm(m, 33, 4, 35);
  brazier(m, 12, 1, 44, 4); brazier(m, 28, 1, 44, 4);
  jar(m, 31.5, 4, 30.5, 0xc8a070);
  return m;
}

// Barracks (5 x 5; building_09): thick-walled courtyard buildings round
// an open drill yard, a raised two-step gatehouse with team rims, team
// banners on poles, a weapon rack with spears and shields.
function barracks() {
  const W = 40;
  const m = lot(W, W);
  for (let x = 8; x < 36; x++) for (let z = 14; z < 37; z++) m.set(x, 0, z, EARTH);
  // back range, west range, a low east wall
  block(m, 3, 3, 37, 14, 1, 12, { batter: 6 });
  block(m, 3, 14, 12, 36, 1, 11, { batter: 6 });
  block(m, 30, 14, 37, 28, 1, 9, { frieze: 0 });
  // the raised gatehouse in the middle of the back range
  const tg = block(m, 14, 6, 27, 17, 1, 16, { frieze: 2 });
  block(m, 17, 8, 25, 15, tg - 1, 4, { frieze: 0 });
  door(m, '+z', 18, 5, 1, 9, { lattice: true, sun: true });
  // corner piers at the yard entrance with banners
  block(m, 9, 34, 15, 40, 1, 12, { frieze: 0 });
  block(m, 30, 27, 36, 33, 1, 12, { frieze: 0 });
  banner(m, 15, 1, 38, 21);
  banner(m, 36, 1, 32, 21, '+x');
  banner(m, 28, 1, 15, 22);
  slit(m, '+x', 20, 5, 3, 1); slit(m, '+x', 26, 5, 3, 1); slit(m, '+z', 6, 6, 3, 1); slit(m, '+z', 32, 6, 3, 1);
  // the weapon rack: a bar on two posts, spears and Egyptian shields
  for (const x of [20, 28]) m.box(x, 1, 30, 1, 7, 1, POLE);
  for (let x = 20; x < 29; x++) m.set(x, 7, 30, DARKWOOD);
  for (let x = 21; x < 28; x += 2) { m.box(x, 1, 29, 1, 12, 1, 0x8b6139); m.set(x, 13, 29, STEEL); }
  for (const x of [22, 26]) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
      if (j === 5 && (i === 0 || i === 3)) continue;
      m.set(x + i - 1, 1 + j, 31, (i === 0 || i === 3 || j === 0) ? 0x7a5634 : (j > 1 && j < 4) ? TEAM : 0xd8c8a8);
    }
  }
  // a gilt ankh by the gate, barrels, a training post
  paint(m, '+z', 15, 10, ['.G.', 'G.G', '.G.', 'GGG', '.G.', '.G.'], { G: GILT });
  barrel(m, 26, 1, 19, 4, 1.4); barrel(m, 29, 1, 19, 4, 1.4);
  m.box(17, 1, 25, 2, 9, 2, POLE); m.box(16, 6, 25, 4, 1, 2, POLE);
  return m;
}

// Migdol Stronghold (6 x 6; building_10): a tall battered square limestone
// keep with a tiled roof inside a team rim, four taller corner turrets with
// L-shaped team rims, groups of slit windows, a projecting gate front with a
// deep gate, a gilt winged scarab over it, latticed windows, a cart wheel.
function migdol() {
  const N = 56;
  const m = lot(N, N);
  for (let x = 4; x < 52; x++) for (let z = 4; z < 55; z++) m.set(x, 0, z, PAVE);
  const top = block(m, 8, 7, 48, 47, 1, 34, { wall: LIME, batter: 9, frieze: 2, roofC: ROOFTILE });
  // a stepped crown on the roof
  block(m, 14, 13, 42, 41, top - 1, 2, { wall: LIME, frieze: 0, roofC: ROOFTILE, band: false });
  // the corner turrets
  const TS = 12;
  for (const [x, z] of [[3, 2], [N - 3 - TS, 2], [3, 52 - TS], [N - 3 - TS, 52 - TS]]) {
    const tt = block(m, x, z, x + TS, z + TS, 1, 39, { wall: LIME, batter: 20, frieze: 2, roofC: ROOFTILE, rim: true });
    // the team rim only along the turret's two outer sides (an L, as in Retold)
    const T = m.lastTop;
    const west = x < N / 2, north = z < N / 2;
    for (let xx = T.c0; xx < T.c1; xx++) for (let zz = T.d0; zz < T.d1; zz++) {
      const v = m.get(xx, tt - 1, zz);
      if (!v || !v.team) continue;
      const innerX = west ? xx >= T.c1 - 2 : xx <= T.c0 + 1;
      const innerZ = north ? zz >= T.d1 - 2 : zz <= T.d0 + 1;
      if (innerX || innerZ) m.remove(xx, tt - 1, zz);
    }
    // slit windows in threes near the top on the two outer faces
    for (const k of [0, 3, 6]) {
      slit(m, north ? '-z' : '+z', x + 3 + k, 28, 5, 1);
      slit(m, west ? '-x' : '+x', z + 3 + k, 28, 5, 1);
    }
  }
  // slit windows on the keep between the turrets
  for (const face of ['+x', '-z', '-x']) for (const u of [19, 22, 34, 37]) slit(m, face, u, 27, 5, 1);
  // the gate front: a projecting battered block with the deep gate
  block(m, 17, 44, 39, 52, 1, 26, { wall: LIME, frieze: 2, roofC: ROOFTILE, batter: 13 });
  door(m, '+z', 24, 8, 1, 14, { sun: false });
  paint(m, '+z', 23, 21, ['GGG...R...GGG', '.GGGG.R.GGGG.', '...GGGGGGG...', '.....G.G.....'], { G: GILT, R: RED });
  for (const px of [19, 36]) for (let y = 4; y < 22; y += 3) slit(m, '+z', px, y, 1, 1);
  // latticed windows on the keep's front, either side of the gate block
  for (const wx of [11, 14, 41, 44]) for (let y = 14; y < 24; y++) for (let i = 0; i < 2; i++) {
    const p = outer(m, '+z', wx + i, y, lim(m));
    if (p) m.set(p[0], p[1], p[2], ((y + i) & 1) ? 0x6e4a2c : DARK);
  }
  wheel(m, 15, 1, 54, 3, 'z');
  barrel(m, 42, 1, 54, 4, 1.4); barrel(m, 13, 1, 50, 4, 1.4); barrel(m, 45, 1, 52, 4, 1.4);
  return m;
}

// Siege Works (5 x 5; building_11): two flat-roofed stone towers, a long
// striped awning from one down to a low colonnade with painted column feet,
// wheels, barrels, crates and a catapult arm.
function siegeWorks() {
  const W = 56;
  const m = lot(W, W);
  for (let x = 6; x < 54; x++) for (let z = 30; z < 55; z++) m.set(x, 0, z, EARTH);
  // two tall flat-roofed workshop towers on the east, the second stepped forward
  block(m, 22, 4, 40, 22, 1, 28, { wall: LIME, batter: 10 });
  block(m, 36, 14, 53, 33, 1, 25, { wall: LIME, batter: 10 });
  door(m, '+z', 41, 6, 1, 11, { sun: true });
  for (const u of [38, 49]) slit(m, '+z', u, 18, 5, 1);
  for (const u of [17, 22, 27]) slit(m, '+x', u, 18, 5, 1);
  for (const u of [25, 30, 35]) slit(m, '+z', u, 20, 5, 1);
  for (const u of [8, 13, 18]) slit(m, '+x', u, 20, 5, 1);
  // a painted frieze of lotus and reed bundles on the forward tower
  paint(m, '+z', 37, 9, ['R.B.R.B.R.B.R.B.', 'OOOOOOOOOOOOOOOO'], { R: RED, B: BLUEP, O: OCHRE });
  // the colonnade on the west: a low roof on columns with painted green feet
  const cy = 14;
  const colsAt = [[4, 46], [10, 46], [16, 46], [4, 39], [4, 32], [4, 25], [10, 25], [16, 25]];
  for (const [x, z] of colsAt) {
    for (let y = 1; y < cy; y++) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) m.set(x + i, y, z + k, y < 4 ? (y === 3 ? OCHRE : GREENP) : y === cy - 1 ? LIME_S : LIME(x, y, z));
  }
  for (let x = 3; x < 21; x++) for (let z = 23; z < 50; z++) {
    const e = Math.min(x - 3, 20 - x, z - 23, 49 - z);
    m.set(x, cy, z, e === 0 ? LIME_S : LIME(x, cy, z));
    m.set(x, cy + 1, z, e === 0 ? LIME(x, cy + 1, z) : PLASTER(x, cy + 1, z));
    if (e === 0) m.set(x, cy + 2, z, LIME(x, cy + 2, z)); else if (e === 1) m.set(x, cy + 2, z, TEAM);
  }
  // the long striped awning from the first tower's west face down to the colonnade
  const st = [STRIPE_G, CLOTH, STRIPE_R, CLOTH, STRIPE_O, CLOTH];
  awning(m, '-x', 22, 5, 22, 24, 6, 8, st, { posts: false, valance: false });
  for (let z = 5; z < 23; z++) for (let x = 13; x < 16; x++) m.set(x, 16 - (x - 13), z, st[Math.floor((z - 5) / 2) % st.length]);
  // the yard: wheels, barrels, crates, a catapult arm and a siege-tower frame
  wheel(m, 30, 1, 40, 4, 'x'); wheel(m, 38, 1, 44, 4, 'z'); wheel(m, 26, 1, 47, 3, 'x');
  for (const [x, z] of [[24, 36], [48, 40], [50, 46], [27, 53]]) barrel(m, x, 1, z, 4, 1.4);
  crate(m, 10, 1, 34, 3, 3, 3); crate(m, 13, 1, 31, 3, 3, 3, 0xa77a48); crate(m, 13, 4, 32, 2, 2, 2);
  m.line(30, 1, 51, 44, 6, 51, 0x7a5230); m.line(30, 2, 51, 44, 7, 51, 0x7a5230); m.line(30, 1, 52, 44, 6, 52, 0x7a5230);
  lathe(m, 45, 51.5, 6, 9, (y) => 2.2 - (y - 6) * 0.4, 0x6e4a2c, { hollow: 0.8, inner: 0x5a3b22 });
  for (const [x, z] of [[44, 34], [50, 34]]) m.box(x, 1, z, 1, 16, 1, POLE);
  for (let y = 4; y < 17; y += 4) m.line(44, y, 34, 50, y, 34, POLE);
  m.line(44, 1, 34, 50, 16, 34, POLE);
  return m;
}

// Obelisk (1 x 1; building_12): a slim tapering spire with gilt panels on a
// stepped base, four prongs holding a glowing teal flame bowl at the top.
function obelisk() {
  const m = lot(8, 8, SANDGROUND);
  m.box(0, 1, 0, 8, 1, 8, LIME); m.box(1, 2, 1, 6, 1, 6, GILT);
  const H = 30;
  for (let y = 3; y < H; y++) {
    const t = (y - 3) / (H - 3);
    const w = t < 0.45 ? 6 : t < 0.8 ? 4 : 4;
    const o = (8 - w) / 2;
    for (let x = o; x < o + w; x++) for (let z = o; z < o + w; z++) {
      const edge = x === o || x === o + w - 1 || z === o || z === o + w - 1;
      if (!edge) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
      const corner = (x === o || x === o + w - 1) && (z === o || z === o + w - 1);
      let c = corner ? SAND(x, y, z) : (y % 6 === 0 ? OCHRE : GILT);
      if (y === 3 || y === 15 || y === 16) c = GILT_D;
      m.set(x, y, z, c);
    }
  }
  // four prongs flaring out to hold the bowl
  for (let y = H; y < H + 5; y++) {
    const d = Math.floor((y - H) / 2);
    for (const [a, b] of [[2 - d, 2 - d], [5 + d, 2 - d], [2 - d, 5 + d], [5 + d, 5 + d]]) m.set(a, y, b, y === H + 4 ? GILT : SAND(a, y, b));
  }
  // the bowl and the teal flame
  lathe(m, 4, 4, H + 4, H + 6, (y) => (y === H + 4 ? 2.4 : 3.2), GILT_D, { hollow: 1, inner: 0x7fe8e0 });
  lathe(m, 4, 4, H + 5, H + 8, (y) => 2.2 - (y - H - 5) * 0.7, 0x9ff2ea);
  for (const v of m.coords) { const p = m.get(...v); if (p && (p.c === 0x9ff2ea || p.c === 0x7fe8e0)) p.glow = TEAL.glow; }
  return m;
}

// Monuments (building_13..17): dark basalt and gold statues on gilt
// plinths with team panels. 1 to Villagers (kneeling), 2 to Soldiers
// (mummiform), 3 to Priests (striding), 4 to Pharaohs (a king and queen),
// 5 to the Gods (Ra falcon, Set, Isis winged; Eye of Horus panels and
// glowing sun bowls at the corners).
function monument(kind, god = 'ra') {
  if (kind <= 3) {
    const m = lot(16, 16, EARTH);
    const py = plinth(m, 3, 3, 13, 13, 1, kind === 3 ? 7 : 6, { face: BASALT, frame: GILT, eye: false });
    const o = [
      null,
      { pose: 'kneel', arms: 'bowls', crown: 'atef', kilt: GILT, kiltFront: null, h: 22 },
      { pose: 'mummy', arms: 'crossed', crown: 'tall', h: 22 },
      { pose: 'stride', arms: 'side', crown: 'nemes', kilt: GILT, kiltFront: TEAM, h: 22 },
    ][kind];
    figure(m, 8, py, 8, { skin: BASALT, gold: GILT, ...o });
    return m;
  }
  const m = lot(kind === 5 ? 32 : 24, kind === 5 ? 32 : 24, EARTH);
  if (kind === 4) {
    const py = plinth(m, 3, 3, 21, 21, 1, 6, { face: BASALT, frame: GILT });
    const py2 = plinth(m, 5, 5, 19, 19, py, 2, { face: BASALT, frame: GILT, team: false });
    figure(m, 9, py2, 12, { h: 24, skin: BASALT, gold: GILT, kilt: GILT, kiltFront: TEAM, crown: 'atef', arms: 'side', pose: 'stand' });
    figure(m, 15.5, py2, 11.5, { h: 21, skin: BASALT, gold: GILT, kilt: GILT, crown: 'vulture', arms: 'embrace', pose: 'dress' });
    return m;
  }
  const py = plinth(m, 6, 6, 26, 26, 1, 9, { face: BASALT, frame: GILT, eye: true });
  const py2 = plinth(m, 10, 10, 22, 22, py, 3, { face: BASALT, frame: GILT, team: false });
  const G = {
    ra: { head: 'falcon', crown: 'disc', arms: 'staff', pose: 'stride' },
    set: { head: 'jackal', crown: 'set', arms: 'staff', pose: 'stand' },
    isis: { head: 'human', crown: 'horns', arms: 'wings', pose: 'dress' },
  }[god];
  figure(m, 16, py2, 16, { h: 30, skin: BASALT, gold: GILT_L, kilt: GILT, kiltFront: TEAM, ...G });
  // the sun bowls at the corners, glowing
  for (const [x, z] of [[2, 2], [29, 2], [2, 29], [29, 29]]) {
    lathe(m, x + 0.5, z + 0.5, 1, 3, (y) => (y === 1 ? 1.4 : 2.2), GILT_D, { hollow: 1, inner: FIRE[2] });
    m.set(x, 2, z, FIRE[3], FG);
  }
  for (const v of m.coords) { const p = m.get(...v); if (p && p.c === FIRE[2]) p.glow = FG.glow; }
  return m;
}

// Armory (4 x 4; building_18): an L of flat-roofed blocks with team rims, an
// open forge under a dark striped awning on a timber frame, a stepped
// chimney furnace with glowing coals, a trough, a gilt ankh, crates.
function armory() {
  const m = lot(32, 32);
  for (let x = 18; x < 31; x++) for (let z = 4; z < 22; z++) m.set(x, 0, z, EARTH);
  const t = block(m, 2, 4, 19, 16, 1, 13, { frieze: 2 });
  block(m, 8, 6, 18, 14, t - 1, 4, { frieze: 0 });
  block(m, 27, 4, 31, 22, 1, 10, { frieze: 0 });
  door(m, '+z', 8, 4, 1, 8);
  slit(m, '+z', 4, 7, 3, 1); slit(m, '+z', 15, 7, 3, 1);
  // the forge frame: posts and beams, the dark striped awning over it
  for (const [x, z] of [[19, 4], [19, 18]]) m.box(x, 1, z, 1, 12, 1, POLE);
  for (let x = 19; x < 27; x++) for (const z of [4, 10, 16]) m.set(x, 12, z, DARKWOOD);
  awning(m, '+x', 18, 5, 21, 12, 9, 3, [0x3a3f52, 0x4d5470, 0x2e3244, 0x4d5470], { sw: 1, posts: false, valance: true });
  // the forge pit with coals and an anvil
  for (let x = 21; x < 26; x++) for (let z = 8; z < 14; z++) m.set(x, 0, z, (x + z) & 1 ? FIRE[0] : 0x2a1a12, (x + z) & 1 ? { glow: 0.3 } : undefined);
  m.box(22, 1, 15, 3, 2, 2, IRON); m.box(21, 3, 15, 5, 1, 2, IRON);
  // the chimney furnace in the yard
  for (let y = 1; y < 15; y++) {
    const w = y < 5 ? 7 : y < 10 ? 5 : 4;
    const o = (7 - w) / 2;
    for (let x = 0; x < w; x++) for (let z = 0; z < w; z++) {
      const X = Math.floor(9 + o + x), Z = Math.floor(19 + o + z);
      const edge = x === 0 || x === w - 1 || z === 0 || z === w - 1;
      m.set(X, y, Z, edge ? (y === 4 || y === 9 ? LIME(X, y, Z) : SAND(X, y, Z)) : (y === 14 ? FIRE[1] : DARK));
    }
  }
  m.set(11, 14, 21, FIRE[3], FG); m.set(12, 14, 21, FIRE[2], FG); m.set(11, 15, 21, FIRE[1], FG);
  for (let x = 11; x < 14; x++) for (let y = 1; y < 3; y++) m.set(x, y, 26, y === 1 ? FIRE[2] : FIRE[0], FG);
  // a stone trough and the ankh
  for (let x = 16; x < 21; x++) for (let z = 21; z < 25; z++) for (let y = 1; y < 3; y++) {
    const rim = x === 16 || x === 20 || z === 21 || z === 24;
    m.set(x, y, z, rim || y === 1 ? LIME(x, y, z) : WATER);
  }
  paint(m, '+z', 4, 7, ['.G.', 'G.G', '.G.', 'GGG', '.G.', '.G.'], { G: GILT });
  for (let y = 1; y < 6; y++) m.set(7, y, 27, GILT); m.box(6, 4, 27, 3, 1, 1, GILT); m.set(6, 6, 27, GILT); m.set(8, 6, 27, GILT); m.set(7, 7, 27, GILT);
  crate(m, 24, 1, 25, 3, 3, 3); crate(m, 27, 1, 25, 3, 3, 3, 0xa77a48);
  barrel(m, 26, 1, 20, 4, 1.4);
  for (let x = 2; x < 6; x++) m.box(x, 1, 18, 1, 6, 1, 0x8b6139), m.set(x, 7, 18, STEEL);
  return m;
}

// Market (4 x 4; building_19): a long flat-roofed hall with a team rim and
// a projecting door portal, a stone pier, three stalls of team / white
// striped awnings over counters of produce, jars and crates.
function market() {
  const m = lot(32, 32);
  for (let x = 1; x < 31; x++) for (let z = 16; z < 31; z++) m.set(x, 0, z, PAVE);
  const t = block(m, 2, 2, 24, 15, 1, 15, { frieze: 2 });
  void t;
  block(m, 9, 14, 16, 18, 1, 12, { frieze: 0 });
  door(m, '+z', 11, 3, 1, 8);
  slit(m, '+x', 5, 9, 3, 1); slit(m, '+x', 10, 9, 3, 1);
  block(m, 24, 15, 29, 21, 1, 12, { frieze: 0 });
  const st = [TEAM, CLOTH];
  const counter = (x0, x1, z0, z1, goods) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = 1; y < 4; y++) m.set(x, y, z, (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1) ? PLANK(x, y, z) : DARKWOOD);
    const n = goods.length;
    goods.forEach((g, i) => { const a = x0 + Math.round(((x1 - x0) * i) / n), b = x0 + Math.round(((x1 - x0) * (i + 1)) / n); goodsBox(m, a, 4, z0, b - a, z1 - z0, g, 1, 0x7a5430); });
  };
  // stall 1: the front left, the awning from the hall's front wall
  awning(m, '+z', 14, 2, 9, 12, 13, 5, st, { sw: 1 });
  counter(2, 9, 23, 27, ['orange', 'melon']);
  // stall 2: the front right, from the pier to the east
  awning(m, '+z', 20, 16, 29, 10, 9, 3, st, { sw: 1 });
  counter(17, 28, 26, 29, ['green', 'date', 'fish']);
  // stall 3: on the east side, from the hall's east wall
  awning(m, '+x', 23, 3, 14, 12, 8, 4, st, { sw: 1 });
  counter(25, 30, 4, 13, ['grain', 'date']);
  jar(m, 10.5, 1, 20.5, 0xc8a070, true); jar(m, 14.5, 1, 21.5); barrel(m, 16, 1, 21, 4, 1.4);
  crate(m, 1, 1, 17, 3, 3, 3); crate(m, 1, 4, 17, 2, 2, 2, 0xa77a48);
  sack(m, 21, 1, 21);
  return m;
}

// Lighthouse (3 x 3; building_20, Mythic): a tall square stone tower (the
// Pharos) with team bands, a stair to its door, a crenellated gallery, an
// octagonal storey, a columned lantern with a glowing fire and a conical cap,
// fire bowls at the foot.
function lighthouse() {
  const m = lot(24, 24);
  const t = block(m, 4, 3, 20, 19, 1, 30, { wall: LIME, batter: 10, frieze: 0, roofC: LIME, rim: false, parapet: false });
  for (let x = 4; x < 20; x++) for (let z = 3; z < 19; z++) {
    const e = Math.min(x - 4, 19 - x, z - 3, 18 - z);
    if (e > 1) continue;
    for (const y of [4, 5]) { const p = outer(m, '+z', x, y, lim(m)); if (e === 0 && p) m.set(p[0], y, p[2], TEAM); }
  }
  for (const face of ['+z', '+x', '-z', '-x']) for (let y = 3; y < 6; y++) for (let u = 3; u < 21; u++) { const p = outer(m, face, u, y, lim(m)); if (p && y === 4) m.set(p[0], p[1], p[2], TEAM); }
  for (const face of ['+z', '+x']) for (const u of [8, 12, 15]) { slit(m, face, u, 12, 4, 1); slit(m, face, u, 20, 4, 1); }
  door(m, '+z', 10, 4, 1, 7);
  // the stair up to the door
  for (let s = 0; s < 4; s++) m.box(9, 1, 19 + s, 6, 4 - s, 1, LIME);
  // the gallery crenellations
  for (let x = 4; x < 21; x++) for (let z = 3; z < 20; z++) {
    const e = Math.min(x - 4, 20 - x, z - 3, 19 - z);
    if (e === 0 && (x + z) % 3 !== 0) m.set(x, t, z, LIME(x, t, z));
  }
  // the octagonal storey
  const oc = 12, ocz = 11;
  lathe(m, oc, ocz, t - 1, t + 9, () => 5.2, (x, y, z) => (y === t + 1 ? TEAM : LIME(x, y, z)));
  lathe(m, oc, ocz, t + 9, t + 10, () => 6, LIME_S);
  // the lantern: columns round a glowing fire
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.round(oc - 0.5 + Math.cos(a) * 3.3), z = Math.round(ocz - 0.5 + Math.sin(a) * 3.3);
    m.box(x, t + 10, z, 1, 5, 1, LIME);
  }
  lathe(m, oc, ocz, t + 10, t + 14, () => 2.2, (x, y, z) => FIRE[2 + ((x + y + z) & 1)]);
  lathe(m, oc, ocz, t + 15, t + 19, (y) => 4.2 - (y - t - 15) * 1.1, (x, y, z) => LIME(x, y, z));
  m.set(11, t + 19, 10, GILT);
  for (const v of m.coords) { const p = m.get(...v); if (p && (p.c === FIRE[2] || p.c === FIRE[3]) && v[1] >= t + 10) p.glow = FG.glow; }
  brazier(m, 5, 1, 21, 3); brazier(m, 19, 1, 21, 3);
  return m;
}

// Farm (4 x 4): Egyptian fields beside the river: a raised mud border, an
// irrigation channel along the back with a shaduf (the counterweight well
// sweep) at its head, the field soil itself left to the economy piece's crops.
function farm() {
  const m = new Rec(32, 32);
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) {
    const e = Math.min(x, 31 - x, z, 31 - z);
    if (e === 0) { m.set(x, 0, z, MUD(x, 0, z)); if ((x + z) % 5 !== 0) m.set(x, 1, z, MUD(x, 1, z)); }
  }
  for (let x = 1; x < 31; x++) for (const z of [1, 2]) m.set(x, 0, z, z === 1 ? WATER : 0x5f8fa8);
  // the shaduf at the back left
  m.box(2, 1, 4, 1, 9, 1, POLE); m.box(5, 1, 4, 1, 9, 1, POLE); m.box(2, 9, 4, 4, 1, 1, DARKWOOD);
  m.line(0, 7, 4, 9, 12, 4, 0x8a6a48);
  m.box(0, 5, 4, 2, 2, 1, MUD);
  m.box(9, 7, 4, 1, 5, 1, 0xcdb98a); m.box(8, 6, 4, 3, 1, 1, TERRA);
  jar(m, 28.5, 1, 29.5, 0xc8a070);
  return m;
}

// Wonder (8 x 8; building_21): a huge sphinx lying on a stepped plinth
// behind a gilded pylon gate with god reliefs and hieroglyph columns, an
// obelisk either side of the door, column drums before it.
function wonder() {
  const N = 64;
  const m = lot(N, N);
  for (let x = 22; x < 42; x++) for (let z = 50; z < 64; z++) m.set(x, 0, z, PAVE);
  // the plinth: two steps
  block(m, 8, 4, 58, 44, 1, 8, { wall: LIME, frieze: 0, roofC: LIME, rim: false, parapet: false });
  block(m, 12, 6, 54, 40, 9, 4, { wall: LIME, frieze: 0, roofC: LIME, rim: false, parapet: false, band: false });
  // the sphinx: lion body lying toward +z, the head in a nemes
  const sy = 14;
  const SPH = (x, y, z) => pick(hash3(x, y >> 1, z, 81), [0xe8dcc0, 0xdfd1b2, 0xece2ca, 0xd6c6a4]);
  for (let x = 20; x < 46; x++) for (let z = 8; z < 38; z++) for (let y = sy; y < sy + 14; y++) {
    const dx = (x + 0.5 - 33) / 11, dz = (z + 0.5 - 20) / 13, dy = (y + 0.5 - sy) / 13;
    if (dx * dx + dz * dz * 0.9 + (dy * dy) * 1.2 < 1 && y >= sy) m.set(x, y, z, SPH(x, y, z));
  }
  // the front legs/paws stretched forward
  for (const px of [23, 37]) for (let z = 26; z < 41; z++) for (let y = sy; y < sy + 4; y++) for (let x = px; x < px + 6; x++) m.set(x, y, z, SPH(x, y, z));
  // the chest and head
  for (let x = 27; x < 39; x++) for (let z = 28; z < 34; z++) for (let y = sy; y < sy + 20; y++) m.set(x, y, z, SPH(x, y, z));
  for (let x = 26; x < 40; x++) for (let z = 26; z < 36; z++) for (let y = sy + 20; y < sy + 30; y++) {
    const nem = (x < 28 || x > 37 || z < 29);
    if (nem && y > sy + 27 && (x < 27 || x > 38)) continue;
    m.set(x, y, z, nem ? ((y & 1) ? 0xd8c8a6 : 0xc8b690) : SPH(x, y, z));
  }
  for (let x = 30; x < 36; x++) for (let y = sy + 21; y < sy + 27; y++) m.set(x, y, 36, SPH(x, y, 36));
  m.box(32, sy + 23, 37, 2, 2, 1, SPH); m.box(31, sy + 26, 36, 1, 1, 1, INK); m.box(34, sy + 26, 36, 1, 1, 1, INK);
  m.box(32, sy + 28, 36, 2, 2, 1, GILT);
  // a gilded shrine with a pharaoh figure between the paws
  plinth(m, 30, 36, 36, 42, sy, 4, { face: GILT_D, frame: GILT, team: true });
  figure(m, 33, sy + 5, 39, { h: 9, skin: GILT, gold: GILT_L, kilt: GILT, kiltFront: TEAM, arms: 'crossed', pose: 'stand', crown: 'nemes' });
  // the pylon gate (two towers + the door block)
  const RL = { G: GILT, g: GILT_D, K: INK, B: BLUEP, R: RED, T: TEAM };
  for (const [x0, x1] of [[10, 28], [36, 54]]) {
    block(m, x0, 44, x1, 52, 1, 26, { wall: LIME, frieze: 2, batter: 13 });
    // the gold reliefs: a god figure and hieroglyph columns on the front face
    const mid = Math.floor((x0 + x1) / 2);
    const god = ['..GG..', '.GGGG.', '..GG..', '.GGGG.', 'GGGGGG', 'G.GG.G', 'G.GG.G', '..GG..', '..GG..', '.GGGG.', '.G..G.', '.G..G.', '.G..G.', 'GG..GG'];
    paint(m, '+z', mid - 6, 18, god, RL);
    paint(m, '+z', mid + 1, 18, god, RL);
    for (let c = 0; c < 5; c++) {
      const col = [];
      for (let r = 0; r < 6; r++) col.push(hash3(x0, r, c, 3) < 0.5 ? 'GK' : 'KG');
      paint(m, '+z', x0 + 2 + c * 3, 24, col, RL);
    }
    paint(m, '+z', x0 + 1, 3, ['T'.repeat(x1 - x0 - 2)], RL);
  }
  block(m, 28, 46, 36, 52, 1, 18, { wall: LIME, frieze: 2 });
  door(m, '+z', 30, 4, 1, 12, { sun: true });
  // two obelisks by the door
  for (const ox of [25, 37]) for (let y = 1; y < 30; y++) {
    const w = y < 24 ? 2 : 1;
    for (let i = 0; i < w; i++) for (let k = 0; k < 2; k++) m.set(ox + i + (w === 1 ? 0 : 0), y, 53 + k, y >= 26 ? GILT : (y % 4 === 0 ? GILT : LIME(ox, y, 53)));
  }
  // column drums before the gate
  for (const [x, z] of [[18, 58], [44, 58], [20, 62], [42, 62]]) {
    lathe(m, x, z, 1, 10, () => 1.9, (xx, y, zz) => (y > 7 ? GREENP : y % 3 === 0 ? RED : LIME(xx, y, zz)));
    lathe(m, x, z, 10, 11, () => 2.6, GREENP);
  }
  return m;
}

// Sentry Tower (1 x 1 in the sim, drawn 2 x 2; building_01): a tall square
// sandstone tower with a team rim, slit windows and a painted plaque.
function tower() {
  const m = lot(12, 12);
  const t = block(m, 1, 1, 11, 11, 1, 30, { batter: 12, frieze: 2 });
  void t;
  door(m, '+z', 4, 3, 1, 6);
  for (const face of ['+z', '+x']) slit(m, face, face === '+z' ? 5 : 6, 22, 4, 2);
  paint(m, '+z', 4, 18, ['GGGG', 'GTTG', 'GTTG', 'GGGG'], { G: GILT, T: TEAM });
  return m;
}

// Palms (render-only dressing for scenes: 1 x 1, drawn over 2 x 2): a tall
// single palm, a leaning pair, a young palm with a shrub.
function palmProp(v) {
  const m = new Rec(16, 16);
  if (v === 0) palm(m, 7, 0, 7, 30, { lx: 0.6, lz: 0.4, len: 9, fronds: 10 });
  else if (v === 1) { palm(m, 4, 0, 8, 26, { lx: -1, lz: 0.3, len: 8 }); palm(m, 9, 0, 6, 32, { lx: 0.8, lz: -0.6, len: 9 }); }
  else { palm(m, 7, 0, 7, 18, { lx: 0.3, lz: 1, len: 7, fronds: 8 }); pottedPalm(m, 11, 0, 11); }
  return m;
}

// ---- output --------------------------------------------------------------------
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
class Group {
  constructor(name) { this.name = name; this.models = {}; this.chunks = []; this.bytes = 0; this.extra = {}; }
  _blob(typed) {
    const off = this.bytes;
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    this.chunks.push(buf);
    this.bytes += buf.length;
    return off;
  }
  add(name, geo, meta = {}) {
    if (this.models[name]) throw new Error(`duplicate model ${this.name}/${name}`);
    const a = geo.attributes;
    const n = a.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4), ext = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = a.position.getX(i); pos[i * 3 + 1] = a.position.getY(i); pos[i * 3 + 2] = a.position.getZ(i);
      nor[i * 3] = a.normal.getX(i); nor[i * 3 + 1] = a.normal.getY(i); nor[i * 3 + 2] = a.normal.getZ(i);
      col[i * 4] = u8(toSRGB(a.color.getX(i))); col[i * 4 + 1] = u8(toSRGB(a.color.getY(i))); col[i * 4 + 2] = u8(toSRGB(a.color.getZ(i)));
      col[i * 4 + 3] = 255;
      ext[i * 4] = u8(a.team.getX(i));
      ext[i * 4 + 1] = u8(a.glow.getX(i));
    }
    const idx = Int32Array.from(geo.index.array);
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    this.models[name] = {
      vertices: n, indices: idx.length,
      aabb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map(r4),
      position: this._blob(pos), normal: this._blob(nor), color: this._blob(col), extra: this._blob(ext), index: this._blob(idx),
      ...meta,
    };
  }
  write() {
    const man = { format: FORMAT, group: this.name, bin: `${this.name}.bin.gz`, bytes: this.bytes, ...this.extra, models: this.models };
    const gz = zlib.gzipSync(Buffer.concat(this.chunks), { level: 9, mtime: 0 });
    fs.writeFileSync(path.join(OUT, `${this.name}.bin.gz`), gz);
    fs.writeFileSync(path.join(OUT, `${this.name}.json`), JSON.stringify(man, null, 1) + '\n');
    const tris = Object.values(this.models).reduce((s, m) => s + m.indices / 3, 0);
    console.log(`${this.name.padEnd(13)} ${String(Object.keys(this.models).length).padStart(4)} models ${String(tris).padStart(8)} tris ${(this.bytes / 1e6).toFixed(2).padStart(7)} MB raw ${(gz.length / 1e6).toFixed(2).padStart(6)} MB gz`);
  }
}

// type -> { w, h (tiles), variants: [names], ages: [looks], build(variantIndex, age), stages }
const TYPES = {
  town_center: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => townCenter() },
  house: { w: 3, h: 3, variants: ['0', '1', '2'], ages: [1, 2], build: (v, a) => house(v, a) },
  granary: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => granary() },
  lumber_camp: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => lumberCamp() },
  mining_camp: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => miningCamp() },
  farm: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => farm(), stages: false },
  temple: { w: 5, h: 6, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => temple(['ra', 'isis', 'set'][v]) },
  eg_barracks: { w: 5, h: 5, variants: ['0'], ages: [1], build: () => barracks() },
  migdol: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => migdol() },
  siege_works: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => siegeWorks() },
  armory: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => armory() },
  market: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => market() },
  obelisk: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => obelisk() },
  monument_villagers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(1) },
  monument_soldiers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(2) },
  monument_priests: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(3) },
  monument_pharaohs: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => monument(4) },
  monument_gods: { w: 4, h: 4, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => monument(5, ['ra', 'isis', 'set'][v]) },
  lighthouse: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => lighthouse() },
  sentry_tower: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => tower(), draw: 1.5 },
  wonder: { w: 8, h: 8, variants: ['0'], ages: [1], build: () => wonder() },
  palm: { w: 1, h: 1, variants: ['0', '1', '2'], ages: [1], build: (v) => palmProp(v), stages: false },
};

fs.mkdirSync(OUT, { recursive: true });
// two groups: the finished looks ("egypt", loaded when an Egyptian building
// is drawn) and the construction stages ("egypt_stages", only while one is
// being built). Stages are cut from the first variant's first age look, at
// k = 0, 2, 4, 6 (the renderer rounds floor(progress * 8) down to even).
const g = new Group('egypt');
const gs = new Group('egypt_stages');
g.extra.voxel = gs.extra.voxel = VOX;
g.extra.stages = gs.extra.stages = STAGES;
g.extra.stage_keys = [0, 2, 4, 6];
g.extra.types = {};
const geo = (m, seed = 7) => {
  const pivot = [m.W / 2, 0, m.D / 2];
  return S.withExtras(buildVoxelGeometry(m, { size: VOX, pivot, jitter: 0.05, seed }), m, VOX, pivot, { maxY: m.extraMaxY ?? Infinity });
};
const t0 = Date.now();
for (const [type, T] of Object.entries(TYPES)) {
  if (ONLY && !ONLY.has(type)) continue;
  g.extra.types[type] = { w: T.w, h: T.h, variants: T.variants, ages: T.ages, stages: T.stages !== false };
  T.variants.forEach((vn, vi) => {
    T.ages.forEach((age, ai) => {
      const full = T.build(vi, age);
      weather(full);
      g.add(`${type}/${vn}/a${age}`, geo(full, 11 + vi * 3 + age));
      if (vi === 0 && ai === 0 && T.stages !== false) {
        for (const k of g.extra.stage_keys) {
          const sm = stage(full, k);
          sm.W = full.W; sm.D = full.D;
          gs.add(`${type}/s${k}`, geo(sm, 11 + age));
        }
      }
    });
  });
}
g.write();
gs.write();
console.log(`egypt: ${Object.keys(g.extra.types).length} types in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
