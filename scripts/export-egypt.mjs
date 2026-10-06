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
const THREE = await import('three');
const THREE_Color = THREE.Color, THREE_BufferAttribute = THREE.Float32BufferAttribute, THREE_BufferGeometry = THREE.BufferGeometry, THREE_IndexAttribute = THREE.BufferAttribute;
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
// Coursed: the stone courses read from the RTS camera (Retold's house and
// camp walls: pale sandstone blocks in visible courses). Each course is
// `course` voxels high and takes one of three sand tones in an A B A C
// rhythm, its bottom row a darker bed joint, the blocks laid in a running
// bond (head joints a shade darker, offset half a block each course), a
// slight per-block tone wobble, so every course shows as a band on any face.
function coursed(tones, { course = 3, len = 6, head = 0.88, bed = 0.84, seed = 41 } = {}) {
  const seq = [0, 1, 0, 2];
  return (x, y, z) => {
    const row = Math.floor(Math.max(0, y - 1) / course);
    const u = x + z + (row & 1) * (len >> 1) + 256;
    const blk = Math.floor(u / len);
    let c = tones[seq[row % 4] % tones.length];
    c = shade(c, 0.985 + 0.03 * hash3(blk, row, (x - z) >> 4, seed));
    if ((y - 1) % course === 0) c = shade(c, bed);
    else if (u % len === 0) c = shade(c, head);
    return c;
  };
}
// warm sandstone ashlar (Retold's walls: a light, slightly orange sandstone in big courses)
const SAND = coursed([0xe2c491, 0xcca874, 0xd9b984], { len: 7, seed: 5 });
const SAND_D = masonry([0xc9a26d, 0xbf9862, 0xd1aa76], [0xb98f5b, 0xc49c68, 0xcca572], { len: 6, course: 3, bed: 0.82, head: 0.88, grime: 0, seed: 9 });
// pale limestone (cornices, copings, columns, the migdol)
const LIME = coursed([0xf1e6cf, 0xe0d1b2, 0xeadcc1], { len: 9, bed: 0.88, seed: 11 });
const LIME_S = 0xd9c9a8;      // the shadowed lip under a cornice
// the roof deck: a packed-mud / plaster deck two value steps darker than the
// whitewashed walls and the pale lip that frames it, so from the RTS camera
// every roof reads as a dark inset inside a bright frame (never one tan mass)
// a plaster roof deck: one smooth trowelled surface (no tile grid, no
// checker of 2x2 patches): a faint tone drift over large irregular patches,
// a few darker stains, single-voxel speckle at +-1 %
const PLASTER = (x, y, z) => {
  const big = hash3((x + ((z >> 3) & 1) * 3) >> 3, y, (z + ((x >> 3) & 1) * 2) >> 3, 13);
  let c = pick(big, [0xa79680, 0xa49380, 0xa99882]);
  if (hash3(x >> 1, y, z >> 1, 17) < 0.06) c = shade(c, 0.94);
  return shade(c, 0.99 + 0.02 * hash3(x, y, z, 18));
};
const ROOFTILE = (x, y, z) => { const c = pick(hash3(x >> 2, y, z >> 2, 14), [0xbcb19c, 0xb4a993, 0xc2b7a2]); return (x % 4 === 0 || z % 4 === 0) ? shade(c, 0.86) : c; };
// whitewashed plaster walls (Retold's houses and camps: a pale cream wash
// over the brick, faint courses showing through), the lightest value on a lot
const WASH = coursed([0xecd8b0, 0xd0b285, 0xe0c69a], { len: 6, seed: 7 });
// the plinth: a clean darker stone step round the foot of every block, the
// line between the pale walls and the darker ground
// the base course: a dark brown stone, darker than the walls and the apron
// it stands on, its blocks' head joints a shade deeper
const PLINTH = (x, y, z) => { const c = pick(hash3(x >> 2, y, z >> 2, 19), [0x6e5840, 0x67523b, 0x735c44]); return ((x + z) % 6 === 0) ? shade(c, 0.85) : c; };
const MUD = masonry([0xb98a58, 0xae7f4f, 0xc29463], [0xa77a4c, 0xb48655, 0xbc8e5c], { len: 4, course: 2, bed: 0.86, head: 0.9, grime: 2, seed: 15 });
const THATCH = (x, y, z) => pick(hash3(x, y, z >> 1, 16), [0xa8925a, 0x9c8650, 0xb39d64, 0x8f7a48]);
const SANDGROUND = (x, y, z) => pick(hash3(x, y, z, 25), [0xd9bb84, 0xd2b37c, 0xdfc28c, 0xcbab73, 0xd6b880]);
const EARTH = (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 26), [0xa5865f, 0x9e7f59, 0xab8c65, 0x987a55]);
const PAVE = (x, y, z) => {
  const u = Math.floor((x + ((z >> 2) & 1) * 2) / 4), v = z >> 2;
  let c = pick(hash3(u, v, 3, 8), [0xbea47c, 0xb59b73, 0xc4ab84, 0xae946c]);
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
  gold: (x, y, z) => GOLDORE(x, y, z),
};
const FIRE = [0xc8400c, 0xe06010, 0xf08a20, 0xffb040];
const FG = { glow: 0.45 };
const TEAL = { glow: 0.7 };

// Team voxels come in two strengths. TEAM (architecture: the roof line, the
// lapis bands, plinth panels) is weathered to a dark warm grey, so the
// owner's colour reads as a deep lapis / maroon line, not a bright rim; TEAMB
// (one feature per building: the market's awnings, the barracks' banners,
// a statue's kilt, pennants) keeps the bright near-white base.
const TEAMB = -7;
// Records the coordinates it was given (construction stages are cut from it).
class Rec extends VoxelModel {
  constructor(W, D) { super(); this.coords = []; this.W = W; this.D = D; this.paths = []; this.blocks = []; this.feet = []; this.cloths = []; }
  set(x, y, z, color, opts) {
    if (typeof color === 'function') color = color(x, y, z);
    if (color === null || color === undefined) return this;
    if (!this.has(x, y, z)) this.coords.push([x, y, z]);
    if (color === TEAMB) { super.set(x, y, z, TEAM, opts); this.get(x, y, z).bright = 1; return this; }
    return super.set(x, y, z, color, opts);
  }
}
const copyVox = (dst, v, x, y, z) => {
  dst.set(x, y, z, v.team ? TEAM : v.c, v.glow ? { glow: v.glow } : undefined);
  if (v.team) dst.get(x, y, z).c = v.c;
};

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
  const prof = big ? [1.2, 1.8, 2.2, 2.3, 2.1, 1.7, 1.1, 0.9, 1.2] : [1.1, 1.6, 1.9, 1.7, 1.2, 0.8, 1.1];
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
// a door recessed into a face: frame of limestone jambs and a projecting
// lintel, the opening cut `deep` voxels into the wall with near-black reveals
// (jambs, soffit) and a dark door leaf (or an open black passage, leaf: false)
// at the back, so a doorway reads as a deep shadowed hole at any distance
const REVEAL = 0x1c1714, REVEAL2 = 0x262019;
function door(m, face, u0, w, y0, h, { lintel = true, sun = false, lattice = false, frame = LIME, deep = 2, leaf = true, proud = true } = {}) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  const n = OUT_N[face];
  for (let i = -1; i <= w; i++) for (let y = y0; y <= y0 + h; y++) {
    const u = u0 + i * dir;
    const p = outer(m, face, u, y, lim(m));
    if (!p) continue;
    if (i === -1 || i === w || y === y0 + h) {
      m.set(p[0], p[1], p[2], frame);
      // the jambs stand one voxel proud of the wall (a framed doorway, not a hole)
      if (proud && y < y0 + h && (i === -1 || i === w) && !m.has(p[0] + n[0], p[1], p[2] + n[2])) m.set(p[0] + n[0], p[1], p[2] + n[2], frame);
      // the reveal behind the frame: near-black where the opening exposes it
      for (let d = 1; d < deep; d++) { const r = [p[0] - n[0] * d, p[1], p[2] - n[2] * d]; if (m.has(...r)) m.set(r[0], r[1], r[2], REVEAL2); }
      continue;
    }
    for (let d = 0; d < deep; d++) m.remove(p[0] - n[0] * d, p[1], p[2] - n[2] * d);
    const q = [p[0] - n[0] * deep, p[1], p[2] - n[2] * deep];
    let c = leaf ? shade(DOOR(q[0], q[1], q[2]), 0.62) : REVEAL;
    if (leaf && lattice && ((i & 1) || ((y - y0) % 3 === 0))) c = REVEAL;
    else if (leaf && !lattice && (i === (w >> 1) && w > 3)) c = REVEAL2;
    m.set(q[0], q[1], q[2], c);
    if (y === y0 && y0 > 1) for (let d = 0; d < deep; d++) { const f = [p[0] - n[0] * d, y0 - 1, p[2] - n[2] * d]; if (m.has(...f)) m.set(f[0], f[1], f[2], REVEAL2); }
  }
  if (y0 <= 1 && m.paths) {
    const p = outer(m, face, u0 + ((w >> 1) * dir), y0 + h, lim(m)) || outer(m, face, u0, y0 + h + 1, lim(m));
    if (p) {
      const ua = u0, ub = u0 + (w - 1) * dir;
      m.paths.push({ face, a0: Math.min(ua, ub), a1: Math.max(ua, ub) + 1, f: face[1] === 'x' ? p[0] : p[2] });
    }
  }
  if (lintel) for (let i = -2; i <= w + 1; i++) {
    const u = u0 + i * dir;
    const p = outer(m, face, u, y0 + h, lim(m));
    if (p) m.set(p[0] + n[0], p[1], p[2] + n[2], i === -2 || i === w + 1 ? LIME_S : frame);
    // a second, shadowed course over the lintel (the door's small cornice)
    const q = outer(m, face, u, y0 + h + 1, lim(m));
    if (q && !m.has(q[0] + n[0], q[1], q[2] + n[2])) m.set(q[0] + n[0], q[1], q[2] + n[2], LIME_S);
  }
  if (sun) {
    // the gilt winged sun disc over the lintel
    const mid = u0 + ((w - 1) / 2) * dir;
    // solid wings (gaps in them read as eyes over the door's mouth)
    const rows = ['GGGGRRRGGGG', '.GGGGRGGGG.', '...GGGGG...'];
    const len = rows[0].length;
    const start = Math.round(mid - ((len - 1) / 2) * dir);
    paint(m, face, start, y0 + h + 3, rows, { G: GILT, R: RED });
  }
}
// a slit window: the opening cut one voxel into the face (a dark recess
// behind it, so the battered skin shows a hole, not a painted dot), a pale
// limestone lintel one voxel proud over it (a voxel wider each side) and a
// shadowed sill under it. `lintel: false` for a slit inside a window group.
function slit(m, face, u, y0, h = 3, w = 1, { lintel = true, sill = true } = {}) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  const n = OUT_N[face];
  for (let i = 0; i < w; i++) for (let y = y0; y < y0 + h; y++) {
    const p = outer(m, face, u + i * dir, y, lim(m));
    if (!p) continue;
    const q = [p[0] - n[0], p[1], p[2] - n[2]];
    if (m.has(...q)) { m.remove(p[0], p[1], p[2]); m.set(q[0], q[1], q[2], y === y0 + h - 1 ? REVEAL2 : REVEAL); }
    else m.set(p[0], p[1], p[2], y === y0 + h - 1 ? DARK2 : DARK);
  }
  if (lintel) for (let i = -1; i <= w; i++) {
    const p = outer(m, face, u + i * dir, y0 + h, lim(m));
    if (p) m.set(p[0] + n[0], p[1], p[2] + n[2], i === -1 || i === w ? LIME_S : LIME(p[0], p[1], p[2]));
  }
  if (sill) for (let i = 0; i < w; i++) {
    const p = outer(m, face, u + i * dir, y0 - 1, lim(m));
    if (p) m.set(p[0], p[1], p[2], LIME_S);
  }
}
// a window group (win): `n` slits (1 x h) side by side with one-voxel
// mullions of wall between them under one lintel and on one sill (Retold's
// grouped windows), so a face carries a framed window, never a pair of dots.
// wood: true (houses, camps): a house window instead, a 3 x h opening cut
// into the wall with a dark palm-wood grille bar down its middle, a wooden
// lintel one voxel proud and a voxel wider each side, a wooden sill.
function win(m, face, u, y0, { n = 3, h = 3, wood = false } = {}) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  const N = OUT_N[face];
  if (wood) {
    slit(m, face, u, y0, h, 3, { lintel: false, sill: false });
    // the grille: a palm-wood cross (a bar down the middle, a rail across
    // the middle row) set in the recess, four dark panes round it
    const mid = y0 + ((h - 1) >> 1);
    for (let y = y0; y < y0 + h; y++) for (let i = 0; i < 3; i++) {
      if (i !== 1 && y !== mid) continue;
      const p = outer(m, face, u + i * dir, y, lim(m));
      const c = p ? m.get(...p).c : null;
      if (c === REVEAL || c === REVEAL2) m.set(p[0], p[1], p[2], 0x7a5634);
    }
    for (let i = -1; i <= 3; i++) {
      const p = outer(m, face, u + i * dir, y0 + h, lim(m));
      if (p) m.set(p[0] + N[0], p[1], p[2] + N[2], i === -1 || i === 3 ? 0x5e4028 : DARKWOOD);
    }
    for (let i = 0; i < 3; i++) {
      const p = outer(m, face, u + i * dir, y0 - 1, lim(m));
      if (p) m.set(p[0] + N[0], p[1], p[2] + N[2], 0x6a4a2c);
    }
    return;
  }
  const W = 2 * n - 1;
  for (let k = 0; k < n; k++) slit(m, face, u + 2 * k * dir, y0, h, 1, { lintel: false, sill: false });
  slit(m, face, u, y0 + h, 0, W, { sill: false });
  for (let i = 0; i < W; i++) { const p = outer(m, face, u + i * dir, y0 - 1, lim(m)); if (p) m.set(p[0], p[1], p[2], LIME_S); }
}

// ---- the Egyptian block ------------------------------------------------------
// A flat-roofed block on [x0, x1) x [z0, z1) rising from y0 for h rows (solid,
// or walls two voxels thick round a paved floor), battered (inset by one every
// `batter` rows: Retold's sloping walls), a darker socle, pale corner torus
// mouldings, under the top a torus roll, a thin `band` (ochre dashes by
// default, 'team' for a dark lapis line in the owner's colour, null none) and
// an optional painted `frieze` (muted). On top the gorge (cavetto) cornice:
// the wall's top row fluted, the lip flaring one voxel out, and inside the
// lip the flat plaster roof with the thin team line (`rim`) one voxel in.
// Returns the row above the roof (an upper storey starts on the roof row, the result - 1).
// the base course height of a ground block (voxels): its socle rows and the
// plinth ring round them are left as voxels under the battered skin
const BASE_H = 2;
const LAPIS = 0x34558a, RED_M = 0x9c4a32, OCHRE_M = 0xc4923c, GORGE = 0xcdb184, GORGE_L = 0xd9bf93, ROLL = 0xbfa47a;
// the cornice lip: a pale limestone, the brightest line on a block, framing the darker roof deck
const LIP = masonry([0xf4ecda, 0xefe6d2, 0xf6efdf], [0xebe1cc, 0xf1e8d6, 0xe8ddc7], { len: 6, course: 3, bed: 0.95, head: 0.96, grime: 0, seed: 12 });
// pale separators between the paint blocks (ink ones read as rows of eyes)
const FRIEZE_SEP = 0xe6d8b8;
const FRIEZE = [FRIEZE_SEP, RED_M, RED_M, FRIEZE_SEP, LAPIS, LAPIS, FRIEZE_SEP, OCHRE_M, OCHRE_M];
// value steps, so the parts of a compound read apart: a pale limestone for the
// chief block, a warm ochre sandstone for enclosure walls, a dark mud brick
// for the lesser buildings, a cool grey flagstone for courtyards
// the Barracks' ochre sandstone: the same warm ochre in calm horizontal
// courses (low joint contrast, one tone family), so a battered pylon face
// reads as one tapering stone surface, not blotches
const OCHRE_P = coursed([0xcf9856, 0xc8914f, 0xd49e5e], { course: 3, len: 8, bed: 0.91, head: 0.94, seed: 27 });
const OCHRE_W = masonry([0xcd9450, 0xc38a48, 0xd49c58], [0xbd8444, 0xc8904c, 0xb47c3e], { len: 8, course: 3, bed: 0.82, head: 0.88, grime: 3, seed: 21 });
const MUDB = masonry([0xa47448, 0x9a6b40, 0xad7c4f], [0x93653c, 0x9f7046, 0xa8784c], { len: 4, course: 2, bed: 0.84, head: 0.9, grime: 2, seed: 23 });
const MUDROOF = (x, y, z) => { const c = pick(hash3(x >> 1, y, z >> 1, 24), [0xb99468, 0xb08b60, 0xc09c70]); return (x % 5 === 0 || z % 5 === 0) ? shade(c, 0.93) : c; };
const FLAG = (x, y, z) => {
  const u = Math.floor((x + ((z >> 2) & 1) * 3) / 5), v = z >> 2;
  let c = pick(hash3(u, v, 9, 29), [0xa89d88, 0x9e937e, 0xb2a790, 0x978b76]);
  if ((x + ((z >> 2) & 1) * 3) % 5 === 0 || z % 4 === 0) c = shade(c, 0.8);
  return c;
};
const TURQ = 0x2f9c94, TURQ_L = 0x52b8ad, RED_B = 0xb03a26, OCHRE_B = 0xe0a83a;
// wide painted bands round a block's outer shell: rows (top first) of colours
// or (x, y, z) => colour, applied to every exposed voxel of rows yTop.. inside
// the given box (the skin carries them onto battered faces)
function bands(m, x0, z0, x1, z1, yTop, rows) {
  rows.forEach((c, j) => {
    const y = yTop - j;
    if (c === null) return;
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      if (!m.has(x, y, z)) continue;
      if (m.has(x + 1, y, z) && m.has(x - 1, y, z) && m.has(x, y, z + 1) && m.has(x, y, z - 1)) continue;
      const v = m.get(x, y, z);
      if (v.team) continue;
      m.set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
    }
  });
}
function bandColor(kind, x, z) {
  if (kind === 'team') return TEAM;
  if (kind === 'teamb') return TEAMB;
  // painted bands: a continuous line with every fifth voxel a darker tone of
  // the same paint (never ink: lone dark voxels under a cornice read as eyes)
  if (kind === 'ochre') return (x + z) % 5 === 0 ? shade(OCHRE_M, 0.78) : OCHRE_M;
  if (kind === 'red') return (x + z) % 5 === 0 ? shade(RED_M, 0.78) : RED_M;
  if (kind === 'lapis') return (x + z) % 5 === 0 ? shade(LAPIS, 0.78) : LAPIS;
  return null;
}
function block(m, x0, z0, x1, z1, y0, h, { wall = SAND, socle = 1, frieze = 0, band = 'ochre', cornice = true, roofC = PLASTER, rim = true, batter = 0, parapet = true, solid = true, rimC = LIP, flute = true, torus = true, gorge = null, lipOut = 1, plinth = true, flare = false, rimTeam = TEAM } = {}) {
  const [gA, gB] = gorge || [GORGE, GORGE_L];
  if (parapet === false) cornice = false;
  const baseH = y0 === 1 && plinth && h >= 6 ? BASE_H : 0;
  if (batter && m.blocks) m.blocks.push({ x0, z0, x1, z1, y0, h, b: batter, base: baseH });
  if (y0 === 1 && plinth && m.feet) m.feet.push({ x0, z0, x1, z1, hb: Math.max(1, baseH) });
  if (band === true) band = 'team';
  if (band === false) band = null;
  const top = y0 + h;
  let inset = 0;
  const ft = cornice ? 1 : 0;          // the torus roll row under the cornice
  for (let y = y0; y < top; y++) {
    inset = batter ? Math.floor((y - y0) / batter) : 0;
    const a0 = x0 + inset, a1 = x1 - inset, b0 = z0 + inset, b1 = z1 - inset;
    const t = top - 1 - y;
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const dEdge = Math.min(x - a0, a1 - 1 - x, z - b0, b1 - 1 - z);
      if (!solid && dEdge > 1) continue;
      let c = null;
      if (y - y0 < Math.max(socle, baseH)) c = baseH ? PLINTH(x, y, z) : SAND_D(x, y, z);
      else if (ft && t === 0) c = ROLL;
      else if (band && t === ft) c = bandColor(band, x, z);
      else if (frieze && t > ft && t <= ft + frieze) {
        const u = (x + z) % FRIEZE.length;
        c = (t === ft + frieze && frieze > 1) ? (u % 3 === 0 ? RED_M : OCHRE_M) : FRIEZE[u];
      }
      if (c === null) c = typeof wall === 'function' ? wall(x, y, z) : wall;
      const corner = (x === a0 || x === a1 - 1) && (z === b0 || z === b1 - 1);
      if (torus && corner && y - y0 >= socle && t > ft + (band ? 1 : 0) + frieze - 1 && t > 0 && wall !== LIME) c = LIME(x, y, z);
      m.set(x, y, z, dEdge > 1 ? SAND_D(x, y, z) : c);
    }
  }
  if (!solid) m.box(x0 + 2, y0, z0 + 2, x1 - x0 - 4, 1, z1 - z0 - 4, PAVE);
  const a0 = x0 + inset, a1 = x1 - inset, b0 = z0 + inset, b1 = z1 - inset;
  if (!cornice) {
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const e = Math.min(x - a0, a1 - 1 - x, z - b0, b1 - 1 - z);
      m.set(x, top, z, e === 0 ? rimC : roofC);
      if (e === 1 && rim) m.set(x, top, z, rimTeam);
    }
    m.lastTop = { c0: a0, c1: a1, d0: b0, d1: b1, y: top };
    return top + 1;
  }
  // the gorge: the top row of the wall fluted (the cavetto's foot), then the
  // lip flaring one voxel out, the roof inside it with the thin team line
  for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
    const e = Math.min(x - a0, a1 - 1 - x, z - b0, b1 - 1 - z);
    m.set(x, top, z, e === 0 ? (flute && ((x + z) & 1) ? gA : gB) : SAND_D(x, top, z));
  }
  // a deep cornice (lipOut 2): the cavetto flares one voxel out at the wall's
  // top row in a shadowed gorge, the lip two voxels out above it, so the roof
  // edge throws a dark line round the block and stands off its neighbours
  if (lipOut > 1) {
    for (let x = a0 - 1; x <= a1; x++) for (let z = b0 - 1; z <= b1; z++) {
      const e = Math.min(x - a0 + 1, a1 - x, z - b0 + 1, b1 - z);
      if (e === 0) m.set(x, top, z, shade(flute && ((x + z) & 1) ? gA : gB, 0.86));
    }
  }
  // a flared cavetto (flare): a second gorge row two voxels out over the
  // first, fluted and lit, the lip slab flush with it above, so from above
  // the cornice reads as a two-row stepped flare under a pale lip, not a slab
  let ly = top + 1, lo = lipOut;
  if (flare && lipOut > 1) {
    for (let x = a0 - 2; x <= a1 + 1; x++) for (let z = b0 - 2; z <= b1 + 1; z++) {
      const e = Math.min(x - a0 + 2, a1 + 1 - x, z - b0 + 2, b1 + 1 - z);
      const g = flute && ((x + z) & 1) ? gA : gB;
      m.set(x, top + 1, z, e === 0 ? g : e === 1 ? shade(g, 0.9) : SAND_D(x, top + 1, z));
    }
    ly = top + 2;
  }
  const c0 = a0 - lo, c1 = a1 + lo, d0 = b0 - lo, d1 = b1 + lo;
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
    const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
    m.set(x, ly, z, e === 0 ? rimC : (e === 1 && rim) ? rimTeam : roofC);
  }
  m.lastTop = { c0, c1, d0, d1, y: ly };
  return ly + 1;
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
// a canvas awning (the camps' work-yard cloth): a smooth sheet of canvas
// (drawn by skin() as a curved surface, not voxel slats) from the wall at the
// top of row yTop, sloping `drop` voxels down to the front `depth` voxels
// out, bellied a little along its run and sagging one voxel in the middle of
// every span between the front posts (`posts`, positions along a). Stripes
// run one way only, wall to front (cream / faded terracotta, `sw` wide); a
// voxel hem hangs under the front edge, scalloped (two voxels deep at the
// middle of every scallop); voxel posts carry the front edge.
const CANVAS = [0xe6d9bd, 0xe1d3b5, 0xeadfc6];
const CANVAS_T = [0xb7735a, 0xae6c53, 0xbb7860];
const CANVAS_HEM = 0x9a5a44;
function clothAwning(m, face, f, a0, a1, yTop, depth, drop, { posts = null, sw = 2, sag = 1, belly = 0.6, ground = 1, stripes = [CANVAS, CANVAS_T], hem = CANVAS_HEM, post = POLE } = {}) {
  const P = posts || [a0, a1 - 1];
  const C = { face, f, a0, a1, yTop, depth, drop, P, sw, sag, belly, stripes };
  // the sheet's height at (a, d): a along the wall, d out from the wall face
  // (0 .. depth), continuous; posts stand at cell centres
  C.y = (a, d) => {
    const u = Math.max(0, Math.min(1, d / depth));
    let sp = 0;
    for (let i = 0; i + 1 < P.length; i++) {
      const p0 = P[i] + 0.5, p1 = P[i + 1] + 0.5;
      if (a >= p0 && a <= p1) { sp = Math.sin(Math.PI * (a - p0) / (p1 - p0)); break; }
    }
    return yTop + 1 - drop * u - belly * Math.sin(Math.PI * u) - sag * sp * Math.pow(u, 0.7);
  };
  m.cloths.push(C);
  const put = (a, y, d, c) => {
    if (face === '+z') m.set(a, y, f + d, c);
    else if (face === '-z') m.set(a, y, f - d, c);
    else if (face === '+x') m.set(f + d, y, a, c);
    else m.set(f - d, y, a, c);
  };
  // the hem: a rolled edge under the front, scalloped
  for (let a = a0; a < a1; a++) {
    const ye = Math.ceil(C.y(a + 0.5, depth) - 0.05) - 1, k = (a - a0) % 4;
    put(a, ye, depth, hem);
    if (k === 1 || k === 2) put(a, ye - 1, depth, shade(hem, 0.92));
  }
  // the front posts, each poking a voxel through the cloth
  for (const a of P) {
    const ye = Math.ceil(C.y(a + 0.5, depth));
    for (let y = ground; y <= ye; y++) put(a, y, depth, post);
  }
  // the batten the cloth is nailed to along the wall
  for (let a = a0; a < a1; a++) put(a, yTop, 1, DARKWOOD);
}
// a palm: a ringed trunk curving toward (lx, lz) and a crown of long arching
// fronds: a midrib with sparse leaflets hanging from it, the tips drooping
const FROND_D = (x, y, z) => pick(hash3(x, y, z, 38), [0x3c6e28, 0x467a2e, 0x355f24]);
function palm(m, x, y, z, h = 22, { lx = 1, lz = 0, fronds = 9, len = 8, dates = true } = {}) {
  let px = x, pz = z;
  for (let j = 0; j < h; j++) {
    const t = j / h;
    px = x + Math.round(lx * 3 * t * t);
    pz = z + Math.round(lz * 3 * t * t);
    const ring = (j % 3 === 0);
    const c = ring ? 0x5e4630 : PALM_T(px, y + j, pz);
    m.set(px, y + j, pz, c); m.set(px + 1, y + j, pz, c); m.set(px, y + j, pz + 1, c); m.set(px + 1, y + j, pz + 1, c);
    if (j < 2) { m.set(px - 1, y + j, pz, c); m.set(px + 2, y + j, pz + 1, c); m.set(px, y + j, pz - 1, c); m.set(px + 1, y + j, pz + 2, c); }
  }
  const cy = y + h, cx = px + 1, cz = pz + 1;
  m.box(cx - 1, cy, cz - 1, 2, 2, 2, 0x6e7a30);
  if (dates) { m.set(cx - 2, cy - 1, cz, 0xb8742a); m.set(cx - 2, cy - 2, cz, 0x9a5a22); m.set(cx + 1, cy - 1, cz - 2, 0xb8742a); m.set(cx, cy - 1, cz + 1, 0x9a5a22); }
  for (let k = 0; k < fronds; k++) {
    const ang = (k / fronds) * Math.PI * 2 + 0.3 + hash3(x, k, z, 3) * 0.4;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const L = len + Math.round((hash3(x, k, z, 5) - 0.5) * 3);
    const up = 2.6 + hash3(x, k, z, 7) * 1.4;
    const sx = -dz, sz = dx;
    for (let s = 0; s <= L * 2; s++) {
      const t = s / (L * 2);
      const fx = cx + dx * t * L, fz = cz + dz * t * L, fy = cy + 1 + up * t * 2 - (up + 5.5) * t * t * 1.6;
      const X = Math.round(fx - 0.5), Y = Math.round(fy), Z = Math.round(fz - 0.5);
      m.set(X, Y, Z, k & 1 ? FROND_D : FROND);
      // leaflets hang below the midrib on both sides, longest mid-frond
      if (s % 3 === 1 && t > 0.2 && t < 0.9) {
        m.set(Math.round(fx - 0.5 + sx), Y - 1, Math.round(fz - 0.5 + sz), FROND);
        m.set(Math.round(fx - 0.5 - sx), Y - 1, Math.round(fz - 0.5 - sz), FROND);
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
// a smooth frustum round (cx, cz) from (y0, r0) to (y1, r1) (shapes.js polys):
// `color(segment, band)`
function frustum(m, cx, cz, y0, y1, r0, r1, color, { segs = 24, bands = 1 } = {}) {
  for (let k = 0; k < bands; k++) {
    const ya = y0 + (y1 - y0) * k / bands, yb = y0 + (y1 - y0) * (k + 1) / bands;
    const ra = r0 + (r1 - r0) * k / bands, rb = r0 + (r1 - r0) * (k + 1) / bands;
    for (let s = 0; s < segs; s++) {
      const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
      const p = (b, y, r) => [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r];
      const sl = (r0 - r1) / (y1 - y0);
      const n = (b) => { const v = [Math.cos(b), sl, Math.sin(b)]; const l = Math.hypot(...v); return v.map((q) => q / l); };
      poly(m, [p(b0, ya, ra), p(b1, ya, ra), p(b1, yb, rb), p(b0, yb, rb)], color(s, k), { normals: [n(b0), n(b1), n(b1), n(b0)], shade: [0.94, 0.94, 1, 1] });
    }
  }
}
// a domed granary silo (the granary's, the TC's; building_05), built in the
// scene's masonry language: a round dark stone plinth; a drum of plastered
// mud brick laid in courses (each course a row of bricks in a running bond,
// head joints a shade darker, the bed joints recessed so every course throws
// a line), its tone a dirty plaster that lightens upward, stained in patches
// and worn dark over the bottom courses; squared timber posts standing proud
// round it, each footed on the plinth in a dark block and capped over the
// timber band that rings the drum's top; a corbelled beehive dome of stepped
// courses (a riser and a lit tread per course, the plaster cleaner toward the
// top); and the loading mouth: a raised plaster lip round a dark recessed
// opening with a heap of grain inside. A voxel core keeps it solid for the
// AO and the construction stages. Returns { cx, cz, top, lip, rm, R } for
// ladders.
const SILO_BRICK = [0xeac396, 0xe0b889, 0xefcb9e, 0xdbb082, 0xe6c090];
const SILO_DOME = [0xe0c798, 0xd7bc8b, 0xe5cfa3];
const SILO_WOOD = [0x6e4e30, 0x634528, 0x765536];
const SILO_CAP = 0x46301c;
// a ring of quads round (cx, cz): radius r0 at y0 to r1 at y1, `col(s)`
function ringWall(m, cx, cz, y0, y1, r0, r1, segs, col, { inward = false, sh = [0.92, 1] } = {}) {
  const sl = (r0 - r1) / Math.max(1e-6, y1 - y0);
  for (let s = 0; s < segs; s++) {
    const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
    const p = (b, y, r) => [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r];
    const n = (b) => { const v = [Math.cos(b), sl, Math.sin(b)]; const l = Math.hypot(...v); return v.map((q) => (inward ? -q : q) / l).map((q, i) => (inward && i === 1 ? -q : q)); };
    poly(m, [p(b0, y0, r0), p(b1, y0, r0), p(b1, y1, r1), p(b0, y1, r1)], col(s), { normals: [n(b0), n(b1), n(b1), n(b0)], shade: [sh[0], sh[0], sh[1], sh[1]] });
  }
}
// a flat ring (r0 < r1) at height y facing up
function ringTread(m, cx, cz, y, r0, r1, segs, col) {
  for (let s = 0; s < segs; s++) {
    const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
    const p = (b, r) => [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r];
    if (r0 <= 1e-3) poly(m, [p(b0, r1), p(b1, r1), [cx, y, cz]], col(s), { out: [0, 1, 0] });
    else poly(m, [p(b0, r0), p(b1, r0), p(b1, r1), p(b0, r1)], col(s), { out: [0, 1, 0] });
  }
}
// an upright squared timber at angle a, its centre at radius rc, y0..y1
function post(m, cx, cz, a, rc, y0, y1, w, d, c) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const P = (u, v, y) => [cx + ca * (rc + v) - sa * u, y, cz + sa * (rc + v) + ca * u];
  const hw = w / 2, hd = d / 2;
  const q = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (let i = 0; i < 4; i++) {
    const [u0, v0] = q[i], [u1, v1] = q[(i + 1) % 4];
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    const out = [ca * mv - sa * mu, 0, sa * mv + ca * mu];
    const f = i === 2 ? 1 : i === 0 ? 0.7 : 0.85;
    poly(m, [P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1)], shade(c, f), { out });
  }
  poly(m, [P(-hw, -hd, y1), P(hw, -hd, y1), P(hw, hd, y1), P(-hw, hd, y1)], shade(c, 1.08), { out: [0, 1, 0] });
}
// a squared timber from point a to point b (voxel space), w thick
function beam(m, a, b, w, c) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d); if (L < 1e-6) return;
  const D = d.map((q) => q / L);
  let u = [D[2], 0, -D[0]]; let lu = Math.hypot(...u);
  if (lu < 1e-6) { u = [1, 0, 0]; lu = 1; }
  u = u.map((q) => q / lu);
  const v = [D[1] * u[2] - D[2] * u[1], D[2] * u[0] - D[0] * u[2], D[0] * u[1] - D[1] * u[0]];
  const h = w / 2;
  const P = (o, su, sv) => [o[0] + (u[0] * su + v[0] * sv) * h, o[1] + (u[1] * su + v[1] * sv) * h, o[2] + (u[2] * su + v[2] * sv) * h];
  const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [s0, t0] = q[i], [s1, t1] = q[(i + 1) % 4];
    const mu = (s0 + s1) / 2, mv = (t0 + t1) / 2;
    const out = [u[0] * mu + v[0] * mv, u[1] * mu + v[1] * mv, u[2] * mu + v[2] * mv];
    const f = out[1] > 0.3 ? 1.08 : out[1] < -0.3 ? 0.7 : 0.9;
    poly(m, [P(a, s0, t0), P(a, s1, t1), P(b, s1, t1), P(b, s0, t0)], shade(c, f), { out });
  }
  for (const [o, sg] of [[a, -1], [b, 1]]) poly(m, [P(o, -1, -1), P(o, 1, -1), P(o, 1, 1), P(o, -1, 1)], shade(c, 0.85), { out: D.map((q) => q * sg) });
}
// a ladder from foot f to head g (voxel space), its rails `span` apart across
// the horizontal perpendicular, a rung every `step` along it
function ladder(m, f, g, { span = 1.6, step = 1.3, c = 0x8a6a48 } = {}) {
  const d = [g[0] - f[0], g[2] - f[2]]; const l = Math.hypot(...d) || 1;
  const px = (-d[1] / l) * span / 2, pz = (d[0] / l) * span / 2;
  for (const sg of [-1, 1]) beam(m, [f[0] + px * sg, f[1], f[2] + pz * sg], [g[0] + px * sg, g[1], g[2] + pz * sg], 0.42, c);
  const L = Math.hypot(g[0] - f[0], g[1] - f[1], g[2] - f[2]);
  for (let t = step; t < L - 0.3; t += step) {
    const k = t / L, o = [f[0] + (g[0] - f[0]) * k, f[1] + (g[1] - f[1]) * k, f[2] + (g[2] - f[2]) * k];
    beam(m, [o[0] - px * 1.1, o[1], o[2] - pz * 1.1], [o[0] + px * 1.1, o[1], o[2] + pz * 1.1], 0.3, shade(c, 0.9));
  }
}
function silo(m, cx, cz, y, R, H, { ribs = 8, dome = 0.7 } = {}) {
  const segs = Math.max(36, Math.round(R * 9));
  const yP = y + 1.4;                     // the plinth's top
  const yH = y + H;                       // the drum's top (the band's foot)
  // the voxel core (solid for the AO and the stages)
  lathe(m, cx, cz, y, Math.floor(yH), () => R * 0.8, CLAY);
  // the plinth: a round dark stone step a voxel out, its tread lit
  const plin = (s) => shade(PLINTH(s, 1, 7), 0.95 + 0.06 * hash3(s >> 1, 2, 3, 62));
  ringWall(m, cx, cz, y - 0.2, yP, R + 1.05, R + 0.95, segs, plin);
  ringTread(m, cx, cz, yP, R - 0.2, R + 0.95, segs, (s) => shade(plin(s), 1.12));
  // the drum: courses of plastered brick
  const course = 1.5, joint = 0.16;
  const nC = Math.max(3, Math.round((yH - yP) / course));
  const ch = (yH - yP) / nC;
  const belly = (t) => R * (0.97 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
  const per = 4;                          // segments per brick
  for (let k = 0; k < nC; k++) {
    const ya = yP + k * ch, yb = ya + ch;
    const t0 = k / nC, t1 = (k + 1) / nC;
    const ra = belly(t0), rb = belly(t1);
    const tone = (s) => {
      const blk = Math.floor((s + (k & 1) * 2) / per);
      let c = pick(hash3(blk, k, 7, 58), SILO_BRICK);
      c = shade(c, 0.9 + 0.12 * t1);                                         // lighter upward
      if (hash3(Math.floor(s / 7), Math.floor(k / 2), 1, 59) < 0.2) c = shade(c, 0.9);   // stains
      if (k < 2) c = shade(c, k === 0 ? 0.76 : 0.86);                        // the worn foot
      if ((s + (k & 1) * 2) % per === 0) c = shade(c, 0.86);                 // head joint
      return c;
    };
    // the recessed bed joint, then the brick face
    ringWall(m, cx, cz, ya, ya + joint, ra - 0.1, ra - 0.1, segs, (s) => shade(tone(s), 0.72), { sh: [1, 1] });
    ringTread(m, cx, cz, ya + joint, ra - 0.1, ra, segs, (s) => shade(tone(s), 0.82));
    ringWall(m, cx, cz, ya + joint, yb, ra, rb, segs, tone, { sh: [0.94, 1] });
  }
  // the timber band round the drum's top
  const Rt = belly(1);
  ringWall(m, cx, cz, yH, yH + 1.3, Rt + 0.55, Rt + 0.55, segs, (s) => pick(hash3(s >> 2, 4, 1, 63), SILO_WOOD), { sh: [0.8, 1.05] });
  ringTread(m, cx, cz, yH, Rt - 0.1, Rt + 0.55, segs, () => SILO_CAP);
  ringTread(m, cx, cz, yH + 1.3, Rt - 0.4, Rt + 0.55, segs, (s) => shade(SILO_WOOD[s % 3], 1.15));
  // the posts, footed on the plinth, capped over the band
  for (let i = 0; i < ribs; i++) {
    const a = ((i + 0.5) / ribs) * Math.PI * 2;
    const c = SILO_WOOD[i % SILO_WOOD.length];
    post(m, cx, cz, a, R + 0.45, yP, yH + 1.3, 0.7, 0.65, c);
    post(m, cx, cz, a, R + 0.55, yP, yP + 0.7, 1.25, 1.0, SILO_CAP);        // the foot block
    post(m, cx, cz, a, Rt + 0.55, yH + 1.3, yH + 1.9, 1.1, 0.9, SILO_CAP);   // the end cap
  }
  // the corbelled dome: stepped courses from the band to the mouth
  const rm = Math.max(1.6, R * 0.4), ri = rm - 0.5;
  const nD = Math.max(5, Math.round(R * dome * 2));
  const Hd = R * dome * 1.1;
  let yy = yH + 1.3, rPrev = Rt - 0.4;
  for (let j = 0; j < nD; j++) {
    const t = (j + 1) / nD;
    const r = rm + 0.35 + (Rt - 0.75 - rm) * Math.pow(Math.max(0, 1 - t * t), 0.6);
    const h = Hd / nD;
    const toneD = (s) => {
      const blk = Math.floor((s + (j & 1) * 2) / per);
      let c = shade(SILO_DOME[(j + (hash3(blk, j, 3, 64) < 0.5 ? 0 : 1)) % SILO_DOME.length], 0.9 + 0.12 * t);
      if (hash3(Math.floor(s / 6), j, 2, 65) < 0.18) c = shade(c, 0.92);
      if ((s + (j & 1) * 2) % per === 0) c = shade(c, 0.9);
      return c;
    };
    if (j > 0) ringTread(m, cx, cz, yy, r, rPrev, segs, (s) => shade(toneD(s), 1.1));
    ringWall(m, cx, cz, yy, yy + h, r, r, segs, toneD, { sh: [0.84, 1] });
    yy += h; rPrev = r;
  }
  const top = yy;
  // the mouth: the lip, its rolled top, the dark throat and the grain inside
  ringTread(m, cx, cz, top, rm + 0.25, rPrev, segs, (s) => shade(SILO_DOME[s % 3], 1.06));
  ringWall(m, cx, cz, top, top + 0.45, rm + 0.25, rm + 0.1, segs, () => 0xd9c49a, { sh: [0.85, 1] });
  ringWall(m, cx, cz, top + 0.45, top + 0.8, rm + 0.3, rm + 0.3, segs, () => 0xcbb285, { sh: [0.85, 1] });
  ringTread(m, cx, cz, top + 0.45, rm + 0.1, rm + 0.3, segs, () => 0xb89f74);
  ringTread(m, cx, cz, top + 0.8, ri, rm + 0.3, segs, () => 0xf0e3c6);
  ringWall(m, cx, cz, top - 0.6, top + 0.8, ri, ri, segs, () => 0x3a2c1e, { inward: true, sh: [0.45, 0.75] });
  ringWall(m, cx, cz, top - 0.1, top + 0.5, ri * 0.98, ri * 0.4, segs, (s) => GRAIN(s, 0, 1), { sh: [0.8, 1.05] });
  ringTread(m, cx, cz, top + 0.5, 0, ri * 0.4, segs, (s) => GRAIN(s, 1, 2));
  return { cx, cz, top, lip: top + 0.8, rm, R };
}
// a log: a cylinder of bark along x or z, end grain at both ends
function log(m, x0, y, z0, len, along = 'z', r = 1) {
  for (let s = 0; s < len; s++) for (let a = 0; a <= r; a++) for (let b = 0; b <= r; b++) {
    const end = s === 0 || s === len - 1;
    const c = end ? ENDGRAIN : BARK(s, y + b, a);
    if (along === 'z') m.set(x0 + a, y + b, z0 + s, c); else m.set(x0 + s, y + b, z0 + a, c);
  }
}
// a big log (3 x 3 section, the corners a darker bark so it reads round) with
// lighter end caps: a pale sapwood ring round a darker heart
const RINGCAP = (x, y, z) => pick(hash3(x, y, z, 69), [0xe0c48e, 0xd8bb84, 0xe6cb98]);
function bigLog(m, x0, y, z0, len, along = 'z') {
  for (let s = 0; s < len; s++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
    const corner = (a !== 1) && (b !== 1), mid = a === 1 && b === 1;
    const end = s === 0 || s === len - 1;
    let c;
    if (end) c = corner ? 0x6c4a2c : mid ? 0xa8773f : RINGCAP(s, y + b, a);
    else c = corner ? shade(BARK(s, y + b, a), 0.82) : BARK(s, y + b, a);
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
    const c = j === 2 || j === 7 ? GILT : TEAMB;
    across ? m.set(x + i - 1 + 1, y + h - j, z + (face === '+z' ? 1 : -1), c) : m.set(x + (face === '+x' ? 1 : -1), y + h - j, z + i, c);
  }
}

// ---- statues -------------------------------------------------------------------
// Statue palette: a blue-black basalt (so it stays stone, not olive, under the
// warm shade) and pure-yellow golds that AgX keeps gold; lapis, turquoise and
// limestone inlay for the collar, nemes stripes, eyes and cartouches.
const ST_SKIN = (x, y, z) => pick(hash3(x, y, z, 72), [0x28303c, 0x232b36, 0x2e3644, 0x252d39]);
const SG = 0xa87400, SG_L = 0xd09a00, SG_D = 0x6a4600;   // deep: AgX washes bright yellows to cream in the sun
const ST_LAPIS = 0x2454b4, ST_TURQ = 0x1f9e90, ST_WHITE = 0xeee6d2, ST_RED = 0xb8301e;
const goldOf = (g) => (g === GILT ? SG : g === GILT_L ? SG_L : g === GILT_D ? SG_D : g);

// A standing (striding, kneeling, mummiform or robed) god or king facing +z on
// (cx, y, cz), modelled on a 24-unit canon scaled by h / 24 voxels. Every part
// is a sampled solid (elliptic frusta, ellipsoids, tapered capsules, boxes)
// tested at voxel centres, so limbs can run on the diagonal (arms crossed over
// the chest) and heads get real shapes: a jackal's snout and tapering ears, a
// falcon's hooked beak, a striped nemes flaring to the shoulders. A separate
// broad collar is laid one voxel proud of the chest, the waist steps in under
// a gold belt over a pleated kilt. Figures under 14 voxels use figureBlocky.
// skin: basalt or gilt; head: human | falcon | jackal; crown: nemes | disc | atef | tall | horns | set | vulture | none
// arms: side | staff | crossed | bowls | wings | embrace; pose: stride | stand | kneel | mummy | dress
function figure(m, cx, y, cz, o = {}) {
  const { h = 24 } = o;
  if (h < 14) return figureBlocky(m, cx, y, cz, o);
  const { kiltFront = TEAMB, head = 'human', crown = 'nemes', arms = 'side', pose = 'stride', dir = 1 } = o;
  const skin = o.skin === undefined || o.skin === BASALT ? ST_SKIN : goldOf(o.skin);
  const gilt = typeof skin === 'number' && (skin === SG || skin === SG_L);   // a gold body: accents in lapis
  const gold = goldOf(o.gold ?? GILT);
  const kilt = o.kilt === undefined ? gold : goldOf(o.kilt);
  const s = h / 24;
  const V = new Map();
  const K = (X, Y, Z) => ((X + 512) * 2048 + (Y + 512)) * 2048 + (Z + 512);
  const put = (X, Y, Z, c) => V.set(K(X, Y, Z), [X, Y, Z, c]);
  const canon = (X, Y, Z) => [(X + 0.5 - cx) / s, (Y + 0.5 - y) / s, (Z + 0.5 - cz) * dir / s];
  const fill = (u0, u1, v0, v1, w0, w1, inside, col) => {
    const X0 = Math.floor(cx + u0 * s) - 1, X1 = Math.ceil(cx + u1 * s) + 1;
    const Y0 = Math.max(Math.floor(y + v0 * s) - 1, y), Y1 = Math.ceil(y + v1 * s) + 1;
    const za = cz + w0 * s * dir, zb = cz + w1 * s * dir;
    const Z0 = Math.floor(Math.min(za, zb)) - 1, Z1 = Math.ceil(Math.max(za, zb)) + 1;
    for (let X = X0; X <= X1; X++) for (let Y = Y0; Y <= Y1; Y++) for (let Z = Z0; Z <= Z1; Z++) {
      const [u, v, w] = canon(X, Y, Z);
      const r = inside(u, v, w);
      if (r === false) continue;
      const c = typeof col === 'function' ? col(u, v, w, X, Y, Z, r) : col;
      if (c !== null && c !== undefined) put(X, Y, Z, c);
    }
  };
  const e = 0.3 / s;   // half a voxel's slack so thin parts never vanish between voxel centres
  const ell = (uc, wc, v0, v1, rx0, rz0, rx1, rz1, col) => {
    const R = Math.max(rx0, rx1) + e, Q = Math.max(rz0, rz1) + e;
    fill(uc - R, uc + R, v0, v1, wc - Q, wc + Q, (u, v, w) => {
      if (v < v0 || v >= v1) return false;
      const t = (v - v0) / (v1 - v0), rx = rx0 + (rx1 - rx0) * t + e, rz = rz0 + (rz1 - rz0) * t + e;
      return ((u - uc) / rx) ** 2 + ((w - wc) / rz) ** 2 <= 1 ? t : false;
    }, col);
  };
  const blob = (uc, vc, wc, rx, ry, rz, col, keep = null) => fill(uc - rx - e, uc + rx + e, vc - ry - e, vc + ry + e, wc - rz - e, wc + rz + e,
    (u, v, w) => (((u - uc) / (rx + e)) ** 2 + ((v - vc) / (ry + e)) ** 2 + ((w - wc) / (rz + e)) ** 2 <= 1 && (!keep || keep(u, v, w)) ? 0 : false), col);
  // a tapered capsule from a to b; col(u, v, w, X, Y, Z, t) sees t along it
  const seg = (a, b, r0, r1, col) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-6, R = Math.max(r0, r1) + 0.7 / s;
    fill(Math.min(a[0], b[0]) - R, Math.max(a[0], b[0]) + R, Math.min(a[1], b[1]) - R, Math.max(a[1], b[1]) + R, Math.min(a[2], b[2]) - R, Math.max(a[2], b[2]) + R, (u, v, w) => {
      const t = Math.max(0, Math.min(1, ((u - a[0]) * d[0] + (v - a[1]) * d[1] + (w - a[2]) * d[2]) / L2));
      const q = Math.hypot(u - a[0] - d[0] * t, v - a[1] - d[1] * t, w - a[2] - d[2] * t);
      return q * s <= Math.max((r0 + (r1 - r0) * t) * s, 0.62) ? t : false;
    }, col);
  };
  const box = (u0, u1, v0, v1, w0, w1, col) => {
    const gu = Math.max(0, (1 / s - (u1 - u0)) / 2), gv = Math.max(0, (1 / s - (v1 - v0)) / 2), gw = Math.max(0, (1 / s - (w1 - w0)) / 2);
    fill(u0 - gu, u1 + gu, v0 - gv, v1 + gv, Math.min(w0, w1) - gw, Math.max(w0, w1) + gw,
      (u, v, w) => (u >= u0 - gu && u < u1 + gu && v >= v0 - gv && v < v1 + gv && w >= Math.min(w0, w1) - gw && w < Math.max(w0, w1) + gw ? 0 : false), col);
  };
  const base = (c, X, Y, Z) => (typeof c === 'function' ? c(X, Y, Z) : c);
  const sk = (u, v, w, X, Y, Z) => base(skin, X, Y, Z);
  const accent = gilt ? ST_LAPIS : gold;              // jewellery on the body
  // bands along a capsule (staves, flail strands): gold / lapis
  const banded = (n, c1 = gold, c2 = ST_LAPIS) => (u, v, w, X, Y, Z, t) => (Math.floor(t * n) & 1 ? c2 : c1);
  // an arm with an armlet high on the upper arm and a bracelet at the wrist
  const arm = (S, E, W, rU = 0.86, rF = 0.66) => {
    seg(S, E, rU, rU * 0.86, sk);
    seg(E, W, rU * 0.84, rF, (u, v, w, X, Y, Z, t) => (t > 0.74 && t < 0.88 ? accent : base(skin, X, Y, Z)));
    blob(W[0], W[1], W[2], rF + 0.05, rF + 0.08, rF + 0.05, sk);
  };
  const kn = pose === 'kneel' ? -7.4 : 0;
  const U = (p) => [p[0], p[1] + kn, p[2]];   // upper-body points drop when kneeling

  // ---- the lower body
  const pleat = (u, v, w, X, Y, Z) => {
    const c0 = base(kilt, X, Y, Z);
    if (v < (pose === 'kneel' ? 1.7 : 8.95)) return typeof c0 === 'number' && (c0 === SG || c0 === SG_L) ? SG_L : shade(c0, 1.06);
    const a = Math.atan2(u, w);
    return Math.floor((a + Math.PI) / (2 * Math.PI) * 16) & 1 ? shade(c0, 0.8) : c0;
  };
  if (pose === 'mummy') {
    // the wrapped Osiride body: feet on a block, gold bands, the shroud tapering in to the ankles
    box(-1.7, 1.7, 0, 0.8, -1.2, 2.2, sk);
    ell(0, 0.1, 0.6, 13.6, 1.7, 1.35, 2.5, 1.55, (u, v, w, X, Y, Z) => ((v % 3.1) < 0.55 && v > 1.5 ? gold : base(skin, X, Y, Z)));
    ell(0, 0.05, 13.6, 17.2, 2.5, 1.55, 3.2, 1.6, sk);
  } else if (pose === 'dress') {
    // a sheath dress from the bust to the ankles, flaring a little at the hem
    box(-1.5, -0.3, 0, 0.7, -0.6, 2.0, sk); box(0.3, 1.5, 0, 0.7, -0.6, 2.0, sk);
    ell(0, 0.15, 0.6, 9.5, 2.25, 1.6, 2.4, 1.6, (u, v, w, X, Y, Z) => (v < 1.2 ? SG_L : pleat(u, v + 9, w, X, Y, Z)));
    ell(0, 0.1, 9.5, 13.0, 2.45, 1.6, 2.2, 1.4, (u, v, w, X, Y, Z) => pleat(u, v, w, X, Y, Z));
    ell(0, 0.05, 13.0, 17.2, 2.2, 1.4, 3.0, 1.5, (u, v, w, X, Y, Z) => (v < 15.6 ? pleat(u, v, w, X, Y, Z) : base(skin, X, Y, Z)));
  } else if (pose === 'kneel') {
    // kneeling on the heels: shins folded back on the plinth, thighs forward to the knees
    for (const sx of [-1, 1]) {
      seg([sx * 1.3, 0.95, 3.0], [sx * 1.3, 0.85, -1.6], 0.95, 0.8, sk);
      seg([sx * 1.25, 2.7, -0.1], [sx * 1.3, 2.1, 3.1], 1.2, 1.0, sk);
    }
    ell(0, 0.5, 1.3, 5.3, 3.0, 2.4, 2.5, 1.65, pleat);
  } else {
    const f = pose === 'stride' ? 2.0 : 0;
    for (const sx of [-1, 1]) {
      const ff = sx < 0 ? f : 0;
      const A = [sx * 1.35, 0.9, 0.25 + ff], Kn = [sx * 1.35, 5.6, 0.2 + ff * 0.55], H = [sx * 1.25, 10.2, 0.1];
      box(sx * 1.35 - 0.78, sx * 1.35 + 0.78, 0, 0.85, A[2] - 1.0, A[2] + 1.95, sk);   // the foot
      seg(A, Kn, 0.62, 0.86, sk);
      seg(Kn, H, 0.88, 1.22, sk);
    }
    ell(0, 0.2, 8.4, 12.9, 3.15, 2.05, 2.45, 1.55, pleat);   // the pleated shendyt, flaring at the hem
    if (kiltFront !== null) {
      // the stiff front apron: the owner's colour framed in gold
      box(-0.95, 0.95, 8.0, 12.5, 1.2, 2.45, (u, v, w) => (Math.abs(u) > 0.62 || v < 8.45 ? SG_L : kiltFront));
    }
  }
  if (pose !== 'mummy' && pose !== 'dress') {
    // the waist steps in above the kilt, then the torso widens to the shoulders
    ell(0, 0.05, 13.3 + kn, 17.2 + kn, 2.15, 1.35, 3.2, 1.55, sk);
  }
  if (pose !== 'mummy') ell(0, 0.08, 12.55 + kn, 13.45 + kn, 2.55, 1.65, 2.5, 1.62, (u, v, w) => (w > 1.25 && Math.abs(u) < 0.45 ? ST_LAPIS : gold)); // the belt
  ell(0, 0.05, 17.2 + kn, 18.7 + kn, 3.2, 1.55, 2.0, 1.25, sk);
  for (const sx of [-1, 1]) blob(sx * 3.05, 17.3 + kn, 0.05, 1.15, 1.05, 1.15, sk);

  // ---- the broad collar (wesekh): rings of gold, lapis and turquoise round
  // the neck, laid one voxel proud of the chest, shoulders and back
  {
    const ny = 19.3 + kn, rings = [[1.55, null], [2.15, SG_L], [2.65, ST_LAPIS], [3.15, gold], [3.75, 'drop']];
    const ring = (u, v, w) => {
      if (v < 15.4 + kn || v > ny) return null;
      const d = Math.hypot(u, (v - ny) * 1.3, w * 1.05);
      for (const [r, c] of rings) if (d < r) return c === 'drop' ? (Math.floor(Math.atan2(u, w) * 6) & 1 ? gold : ST_LAPIS) : c;
      return null;
    };
    const add = [];
    for (const [X, Y, Z] of V.values()) {
      const [u, v, w] = canon(X, Y, Z);
      const c = ring(u, v, w);
      if (!c) continue;
      put(X, Y, Z, c);
      for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, dir], [1, 0, 0], [-1, 0, 0], [0, 0, -dir]]) if (!V.has(K(X + dx, Y + dy, Z + dz))) add.push([X + dx, Y + dy, Z + dz, c]);
    }
    for (const [X, Y, Z, c] of add) put(X, Y, Z, c);
  }

  // ---- arms and regalia
  if (arms === 'crossed') {
    // Osiris' pose: forearms crossed high on the chest, the crook (heka) and
    // the flail (nekhakha) in gold banded with lapis, held up over the shoulders
    arm(U([-3.15, 17.2, 0.1]), U([-3.45, 13.9, 0.9]), U([1.0, 16.3, 2.45]));
    arm(U([3.15, 17.2, 0.1]), U([3.45, 13.9, 0.9]), U([-1.0, 15.3, 2.8]));
    const cg = gilt ? SG_D : gold;
    // both held tight to the chest: the shafts end at the shoulders, the
    // crook's hook curling out over the right shoulder, the flail's three
    // strands hanging down over the left one (nothing stands up by the head)
    seg(U([0.3, 14.2, 2.75]), U([2.1, 18.5, 2.3]), 0.4, 0.4, cg);
    seg(U([2.1, 18.5, 2.3]), U([2.75, 19.25, 2.2]), 0.36, 0.36, cg);
    seg(U([2.75, 19.25, 2.2]), U([3.5, 19.05, 2.15]), 0.36, 0.36, cg);
    seg(U([3.5, 19.05, 2.15]), U([3.75, 18.2, 2.1]), 0.36, 0.32, cg);
    seg(U([-0.4, 14.0, 3.05]), U([-2.05, 18.3, 2.5]), 0.4, 0.4, cg);
    blob(...U([-2.1, 18.45, 2.5]), 0.46, 0.46, 0.46, SG_L);
    for (const tip of [[-2.9, 16.4, 2.2], [-3.35, 16.7, 2.6], [-2.5, 16.2, 3.0]]) seg(U([-2.15, 18.3, 2.5]), U(tip), 0.32, 0.28, banded(3, SG_L, cg));
  } else if (arms === 'side' || arms === 'staff' || arms === 'embrace') {
    arm([-3.15, 17.2 + kn, 0.1], [-3.45, 13.5 + kn, 0.25], [-3.45, 10.4 + kn, 0.5]);
    if (arms === 'side') arm([3.15, 17.2 + kn, 0.1], [3.45, 13.5 + kn, 0.25], [3.45, 10.4 + kn, 0.5]);
    else if (arms === 'staff') {
      // the forearm forward, the was-sceptre upright in the fist
      arm([3.15, 17.2 + kn, 0.1], [3.45, 13.8 + kn, 0.2], [3.5, 14.0 + kn, 2.75]);
      seg([3.5, 0.3, 2.95], [3.5, 26.6, 2.95], 0.34, 0.34, (u, v, w, X, Y, Z, t) => (t > 0.5 && t < 0.54 ? ST_LAPIS : gilt ? SG_D : gold));
      seg([3.5, 26.6, 2.95], [3.5, 27.3, 4.4], 0.34, 0.26, gilt ? SG_D : gold);
      seg([3.5, 0.3, 2.95], [3.0, 0, 2.95], 0.26, 0.26, gold); seg([3.5, 0.3, 2.95], [4.0, 0, 2.95], 0.26, 0.26, gold);
    } else arm([3.15, 17.2 + kn, 0.1], [3.45, 14.6 + kn, -0.3], [5.2, 15.4 + kn, -1.5]);
  } else if (arms === 'bowls') {
    // forearms forward offering a gold bowl
    arm(U([-3.15, 17.2, 0.1]), U([-3.3, 14.0, 1.0]), U([-1.9, 14.3, 3.3]));
    arm(U([3.15, 17.2, 0.1]), U([3.3, 14.0, 1.0]), U([1.9, 14.3, 3.3]));
    ell(0, 3.6, 14.3 + kn, 15.7 + kn, 1.6, 1.15, 2.3, 1.55, (u, v, w) => (v > 15.25 + kn && Math.hypot(u / 2.3, (w - 3.6) / 1.55) < 0.62 ? SG_D : SG_L));
  } else if (arms === 'wings') {
    // Isis: arms out and down, long feathered wings hanging from them
    arm(U([-3.15, 17.2, 0.1]), U([-4.6, 15.6, 0.3]), U([-6.0, 13.6, 0.9]));
    arm(U([3.15, 17.2, 0.1]), U([4.6, 15.6, 0.3]), U([6.0, 13.6, 0.9]));
    fill(-8.8, 8.8, 2 + kn, 18.2 + kn, -0.7, 0.55, (u, v, w) => {
      const a = Math.abs(u) - 3.4;
      if (a < 0 || a > 5.2 || w < -0.65 || w > 0.5) return false;
      const top = 17.8 + kn - a * 0.38, bot = 12.6 + kn - a * 1.75;
      return v <= top && v >= bot ? (top - v) : false;
    }, (u, v, w, X, Y, Z, dt) => {
      const a = Math.abs(u) - 3.4;
      if (dt < 0.6) return SG_L;                                   // the leading edge
      if (dt < 2.6) return (Math.floor(a * 2.2) + Math.floor(v * 2.2)) & 1 ? ST_LAPIS : gold; // scale-like coverts
      return Math.floor(a * 1.8) & 1 ? SG_D : gold;                 // long primaries
    });
  }

  // ---- neck and head (hy: the chin)
  seg([0, 18.3 + kn, 0.15], [0, 20.1 + kn, 0.3], 0.84, 0.8, sk);
  const hy = 19.7 + kn;
  // a striped tripartite wig (falcon, jackal and goddess heads): lappets down
  // in front of the shoulders and a mass behind, gold and lapis
  // mostly lapis with thin gold stripes, so it stays one mass apart from the gold collar and face
  const wigCol = (u, v, w) => (((Math.floor(v * 1.6) % 3) + 3) % 3 === 0 ? gold : ST_LAPIS);
  const wig = () => {
    blob(0, hy + 1.5, -0.55, 1.8, 2.35, 1.35, wigCol);
    // lappets ending on the collar's upper edge (not over it), a gold tip band
    for (const sx of [-1, 1]) box(sx > 0 ? 1.2 : -2.1, sx > 0 ? 2.1 : -1.2, hy - 1.7, hy + 2.3, -0.4, 1.45, (u, v, w) => (v < hy - 1.25 ? SG_L : wigCol(u, v, w)));
  };
  if (crown === 'disc' || crown === 'horns' || crown === 'set' || crown === 'vulture' || (head !== 'human' && crown !== 'nemes')) wig();
  if (head === 'falcon') {
    // Horus' head: gold feathers on a stone body (a stone beak on a gilt one),
    // a strong hooked beak, ringed eyes and the dark malar stripe under them
    const fh = gilt ? sk : gold, dk = gilt ? ST_SKIN : INK;
    blob(0, hy + 1.95, 0.2, 1.45, 1.8, 1.55, fh);
    seg([0, hy + 2.35, 1.2], [0, hy + 2.05, 3.35], 0.62, 0.42, dk);         // the beak
    seg([0, hy + 2.05, 3.35], [0, hy + 1.0, 3.15], 0.4, 0.26, dk);          // its hooked tip
    seg([0, hy + 2.7, 1.25], [0, hy + 2.55, 2.0], 0.5, 0.4, SG_L);          // the cere
    for (const sx of [-1, 1]) {
      box(sx > 0 ? 0.55 : -1.35, sx > 0 ? 1.35 : -0.55, hy + 2.15, hy + 2.95, 0.95, 1.6, ST_WHITE);  // eyes
      box(sx > 0 ? 0.75 : -1.15, sx > 0 ? 1.15 : -0.75, hy + 2.3, hy + 2.8, 1.25, 1.7, dk);         // pupils
      box(sx > 0 ? 0.8 : -1.2, sx > 0 ? 1.2 : -0.8, hy + 0.7, hy + 2.15, 1.0, 1.5, dk);            // the malar stripe
    }
  } else if (head === 'jackal') {
    blob(0, hy + 2.2, -0.05, 1.32, 1.55, 1.5, sk);
    seg([0, hy + 2.15, 0.9], [0, hy + 1.45, 4.7], 0.98, 0.5, sk);          // the long snout
    seg([0, hy + 0.95, 1.1], [0, hy + 1.05, 3.9], 0.5, 0.36, sk);           // the lower jaw
    blob(0, hy + 1.6, 4.7, 0.42, 0.4, 0.36, gilt ? INK : SG_D);             // the nose
    for (const sx of [-1, 1]) {
      box(sx > 0 ? 0.45 : -1.1, sx > 0 ? 1.1 : -0.45, hy + 2.45, hy + 3.0, 1.0, 1.55, SG_L);   // gold eyes
    }
    // tall flat ears tapering to points, standing forward of the wig, the
    // hollow front face gilt inside a stone rim
    const eb = hy + 2.9, eh = 4.0;
    fill(-2.4, 2.4, eb - 0.1, eb + eh + 0.2, -1.1, 0.4, (u, v, w) => {
      const t = (v - eb) / eh;
      if (t < 0 || t > 1 || w < -0.85 || w > 0.15) return false;
      return Math.abs(Math.abs(u) - (0.95 + 0.3 * t)) <= 0.85 * (1 - t) + 0.08 ? t : false;
    }, (u, v, w, X, Y, Z, t) => (w > -0.25 && Math.abs(Math.abs(u) - (0.95 + 0.3 * t)) < 0.85 * (1 - t) - 0.32 ? SG_L : base(skin, X, Y, Z)));
  } else {
    blob(0, hy + 1.9, 0.35, 1.4, 1.9, 1.55, sk);
    box(-0.3, 0.3, hy + 1.3, hy + 2.5, 1.6, 2.15, sk);                        // nose
    for (const sx of [-1, 1]) box(sx > 0 ? 0.35 : -0.95, sx > 0 ? 0.95 : -0.35, hy + 2.35, hy + 2.7, 1.4, 1.95, gilt ? ST_LAPIS : SG_D);  // kohl-lined eyes, inlaid dark (white eyes stared like a robot's)
    if (pose !== 'dress') seg([0, hy + 0.45, 1.45], [0, hy - 0.95, 1.7], 0.4, 0.33, banded(5, gold, ST_LAPIS));          // the false beard
  }
  const uraeus = (vb, wb) => { seg([0, vb, wb], [0, vb + 0.95, wb + 0.25], 0.34, 0.3, SG_L); blob(0, vb + 1.0, wb + 0.3, 0.32, 0.3, 0.3, ST_RED); };
  if (crown === 'nemes') {
    // the striped royal headcloth: a cap over the brow, wings flaring out to
    // the shoulders behind the face, lappets down the chest, a tail behind
    const nem = (u, v, w) => (v > hy + 3.2 && v < hy + 3.7 && w > 0.4 ? SG_L : v < hy - 2.75 ? SG_L : (Math.floor((v - hy) * 1.3) & 1 ? ST_LAPIS : gold));
    blob(0, hy + 2.35, 0.05, 1.72, 2.05, 1.85, nem, (u, v, w) => !(w > 0.5 && v < hy + 3.2 && Math.abs(u) < 1.3));
    fill(-3.1, 3.1, hy - 1.7, hy + 3.0, -1.35, 0.95, (u, v, w) => {
      const au = Math.abs(u);
      return au >= 1.25 && au <= 1.6 + (hy + 3.0 - v) * 0.33 && v >= hy - 1.7 && v <= hy + 3.0 && w >= -1.35 && w <= 0.95 ? 0 : false;
    }, nem);
    for (const sx of [-1, 1]) box(sx > 0 ? 1.3 : -2.25, sx > 0 ? 2.25 : -1.3, hy - 3.4, hy + 0.6, 0.45, 2.0, nem);
    seg([0, hy + 1.6, -1.5], [0, hy - 2.6, -1.75], 0.78, 0.6, nem);
    uraeus(hy + 3.4, 1.75);
  } else if (crown === 'disc') {
    uraeus(hy + 3.3, 1.35);
  } else if (crown === 'atef' || crown === 'tall') {
    // the white crown in gold: a tall bulb with a knob, lapis band at the brow;
    // the atef adds two striped plumes and ram's horns
    ell(0, 0.0, hy + 2.9, hy + 8.6, 1.5, 1.45, 0.6, 0.6, (u, v) => (v < hy + 3.5 ? ST_LAPIS : gold));
    blob(0, hy + 8.75, 0, 0.62, 0.55, 0.62, SG_L);
    if (crown === 'atef') for (const sx of [-1, 1]) {
      box(sx > 0 ? 1.4 : -2.05, sx > 0 ? 2.05 : -1.4, hy + 3.4, hy + 8.9, -0.35, 0.35, (u, v) => (Math.floor(v * 1.4) & 1 ? ST_LAPIS : gold));
      seg([sx * 1.2, hy + 3.3, 0.4], [sx * 2.7, hy + 3.0, 0.9], 0.4, 0.22, SG_D);
    }
    uraeus(hy + 3.2, 1.45);
  } else if (crown === 'horns') {
    // Isis: the modius, cow horns cupping a sun disc
    ell(0, -0.1, hy + 3.4, hy + 4.4, 1.25, 1.25, 1.3, 1.3, SG_L);
    for (const sx of [-1, 1]) {
      const p = [[0.6, 4.3], [2.0, 4.9], [2.5, 6.4], [2.1, 7.9], [1.5, 8.6]];
      for (let i = 0; i < p.length - 1; i++) seg([sx * p[i][0], hy + p[i][1], -0.1], [sx * p[i + 1][0], hy + p[i + 1][1], -0.1], 0.36, 0.32, gold);
    }
    uraeus(hy + 3.1, 1.45);
  } else if (crown === 'vulture') {
    ell(0, -0.1, hy + 3.4, hy + 4.6, 1.2, 1.2, 1.3, 1.3, (u, v) => (v > hy + 4.2 ? SG_L : ST_LAPIS));
    uraeus(hy + 3.1, 1.45);
  } else if (crown === 'set') {
    blob(0, hy + 3.55, -0.1, 1.1, 0.35, 1.1, SG_L);   // a gold fillet over the brow
  }

  for (const [X, Y, Z, c] of V.values()) m.set(X, Y, Z, c);
  if (crown === 'disc') sunDisc(m, cx, y + (hy + 6.1) * s, Math.floor(cz - 0.35 * s * dir), 2.8 * s, SG);
  else if (crown === 'horns') sunDisc(m, cx, y + (hy + 6.6) * s, Math.floor(cz - 0.1 * s * dir), 1.85 * s, SG);
}
// A statue drawn at half voxels inside a full-voxel building (the Town
// Center's and the Temple's gods): the figure goes into its own model at
// twice the resolution, recorded on m.fine, and geo() meshes it at VOX / 2 and
// merges it into the building's mesh at the same place. (cx, y, cz) and o.h
// are in the building's voxels. Construction stages leave it out (it stands
// when the building is finished).
function fineFigure(m, cx, y, cz, o = {}) {
  const sub = new Rec(m.W * 2, m.D * 2);
  figure(sub, cx * 2, y * 2, cz * 2, { ...o, h: (o.h ?? 24) * 2 });
  (m.fine ??= []).push({ m: sub, k: 2 });
}
// A statue and its black-and-gold plinth (monPlinth: a raised cartouche on
// every face, the owner's line under a gold cornice, a notched die) drawn at
// half voxels inside a full-voxel building, on the box [x0, x1) x [z0, z1)
// from y0, h voxels high (building voxels); the figure stands centred on it.
function fineStatue(m, x0, z0, x1, z1, y0, h, o = {}, seed = 0) {
  const sub = new Rec(m.W * 2, m.D * 2);
  const py = monPlinth(sub, x0 * 2, z0 * 2, x1 * 2, z1 * 2, y0 * 2, h * 2 - 3, { seed });
  const pd = monDie(sub, x0 * 2 + 3, z0 * 2 + 3, x1 * 2 - 3, z1 * 2 - 3, py, 2);
  cleanStatue(sub, x0 + x1, pd, z0 + z1 - 1, toClean(o));
  (m.fine ??= []).push({ m: sub, k: 2 });
}
// The old box-built figure, kept for tiny statues (under 14 voxels, e.g. the
// Wonder's door kings) where sampled solids would come out as lumps.
function figureBlocky(m, cx, y, cz, o = {}) {
  const { h = 24, skin = BASALT, gold = GILT, kilt = GILT, kiltFront = TEAMB, head = 'human', crown = 'nemes', arms = 'side', pose = 'stride', dir = 1 } = o;
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
    B(-2, hy, -1.3, 2, hy + 3.8, 1.8, skin);              // the face
    B(-0.5, hy + 1.2, 1.8, 0.5, hy + 2.4, 2.5, skin);      // nose
    B(-1.4, hy + 2.4, 1.7, -0.6, hy + 3, 1.9, gold); B(0.6, hy + 2.4, 1.7, 1.4, hy + 3, 1.9, gold);   // kohl-lined eyes
  }
  if (crown === 'nemes') {
    B(-2.3, hy + 1.6, -1.6, 2.3, hy + 4.4, 1.2, gold);
    B(-2.3, hy + 2.6, -1.6, 2.3, hy + 3.0, 1.2, INK);
    B(-2.4, hy - 2.6, 0.6, -1.4, hy + 2, 1.9, gold); B(1.4, hy - 2.6, 0.6, 2.4, hy + 2, 1.9, gold);  // lappets
    B(-2.4, hy - 1.2, 0.6, -1.4, hy - 0.8, 1.9, INK); B(1.4, hy - 1.2, 0.6, 2.4, hy - 0.8, 1.9, INK);
    B(-0.4, hy + 3.6, 1.2, 0.4, hy + 4.4, 1.9, gold);      // uraeus
  } else if (crown === 'disc') {
    // the sun disc (Ra): a round red disc rimmed in gold, standing behind the head
    sunDisc(m, cx, y + (hy + 7.2) * s, Math.floor(cz - 0.4 * s * dir), 4.0 * s, gold);
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
    sunDisc(m, cx, y + (hy + 6.8) * s, Math.floor(cz - 0.2 * s * dir), 2.9 * s, gold);
  } else if (crown === 'set') {
    B(-2.2, hy - 2.5, -1.3, 2.2, hy + 2.6, 0.6, gold);
    B(-1.4, hy + 3, -0.6, 1.4, hy + 4, 0.8, gold);
  } else if (crown === 'vulture') {
    B(-2.3, hy + 1.4, -1.6, 2.3, hy + 4.0, 1.3, gold);
    B(-2.5, hy - 3.6, -0.6, -1.5, hy + 2, 1.5, gold); B(1.5, hy - 3.6, -0.6, 2.5, hy + 2, 1.5, gold);
    B(-1.2, hy + 4, -0.8, 1.2, hy + 5, 1.0, gold);
  }
}
// a sun disc in the XY plane, two voxels deep: sampled at voxel centres round
// the true centre (xc, yc), a thin gold rim round a red face, so it reads as a
// disc and not as a voxel cross
function sunDisc(m, xc, yc, zc, r, gold = GILT) {
  for (let X = Math.floor(xc - r - 1); X <= Math.ceil(xc + r + 1); X++) for (let Y = Math.floor(yc - r - 1); Y <= Math.ceil(yc + r + 1); Y++) {
    const d = Math.hypot(X + 0.5 - xc, Y + 0.5 - yc);
    if (d > r) continue;
    const rim = d > r - 0.85;
    m.set(X, Y, zc, rim ? gold : 0xc8402a);
    m.set(X, Y, zc - 1, rim ? GILT_D : 0xa83420);
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
    if (!v || v.glow || v.clean || y < 1) continue;
    if (v.team) {
      let c = v.bright ? (hash3(x, y, z, 97) < 0.5 ? 0xf6f6f6 : 0xe6e6e6) : (hash3(x, y, z, 97) < 0.5 ? 0x6e665a : 0x655e53);
      if (!v.bright) v.team = 0.62;     // a muted tint: the owner's colour as a dark lapis line
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

// ---- smooth battered walls ----------------------------------------------------
// Voxels draw a battered wall as stairs (a ledge every `batter` rows) that
// read as a ziggurat; Retold's walls slope. skin() covers every battered
// face of every block with a smooth sloping plane through the steps' outer
// edges, one quad per voxel cell coloured by the masonry voxel behind it
// (so courses, bands, friezes, doors frames and slits carry through), with
// holes where the wall is recessed (doors) and gaps where something stands
// against it (porches, lintels, beams, adjoining blocks). The quads go into
// m.skin and are merged into the finished model (team voxels keep their tint).
function skin(m) {
  const S2 = m.skin = { pos: [], nor: [], col: [], team: [] };
  const _k = new THREE_Color();
  const emit = (pts, nrm, c, team) => {
    for (const i of [0, 1, 2, 0, 2, 3]) { S2.pos.push(...pts[i]); S2.nor.push(...nrm); S2.col.push(...c); S2.team.push(team); }
  };
  for (const B of m.blocks) {
    const { x0, z0, x1, z1, y0, h, b } = B;
    const top = y0 + h;
    const sl = (y) => (y - y0) / b;
    const K = Math.floor((h - 1) / b);
    for (const face of ['+z', '-z', '+x', '-x']) {
      const alongX = face[1] === 'z';
      const pos = face === '+z' || face === '+x';
      const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;            // the cell range along the face
      const outer0 = pos ? (alongX ? z1 : x1) : (alongX ? z0 : x0);  // the base face coordinate
      const sg = pos ? 1 : -1;
      const P = (u, y, d) => (alongX ? [u, y, d] : [d, y, u]);
      const plane = (y) => outer0 + sg * (1 - sl(y));
      const L = (y) => lo - 1 + sl(y), R = (y) => hi + 1 - sl(y);
      const nl = Math.hypot(1, 1 / b);
      const nrm = alongX ? [0, (1 / b) / nl, sg / nl] : [sg / nl, (1 / b) / nl, 0];
      // a ground block's first row is left as voxels: the dark base course
      // (its socle and the plinth ring round it) stands under the slope
      // what the skin does over the cell (uc, y): 1 = the sloping plane in
      // the outer voxel's colour; 2 = a one-voxel recess (a slit, a niche, a
      // relief panel: the outer voxel cut away, the one behind it kept), drawn
      // as the same plane one voxel deeper with reveals round it, so a cut
      // into a battered face is a clean sloping slot, never a stepped bite;
      // 0 = nothing (a door's hole, or something standing against the wall)
      const cellAt = (uc, y) => {
        const k = Math.floor((y - y0) / b);
        const fv = pos ? outer0 - 1 - k : outer0 + k;
        const at = (d) => (alongX ? m.get(uc, y, d) : m.get(d, y, uc));
        if (at(fv + sg) || at(fv + 2 * sg)) return [0];
        const v = at(fv);
        if (v) return [1, v];
        for (let d = 1; d <= 4; d++) { const vb = at(fv - d * sg); if (vb) return [2, vb, d]; }
        return [0];
      };
      const col = (v, f) => { _k.setHex(v.c); return [_k.r * f, _k.g * f, _k.b * f]; };
      const yS = y0 + (B.base || 0);
      for (let y = yS; y < top; y++) {
        const k = Math.floor((y - y0) / b);
        const faceVox = pos ? outer0 - 1 - k : outer0 + k;          // the step's outer voxel (depth coord)
        const a0 = lo + k, a1 = hi - k;
        for (let u = Math.floor(L(y)); u < Math.ceil(R(y)); u++) {
          const ub0 = Math.max(u, L(y)), ub1 = Math.min(u + 1, R(y));
          const ut0 = Math.max(u, L(y + 1)), ut1 = Math.min(u + 1, R(y + 1));
          if (ub1 - ub0 <= 1e-6 && ut1 - ut0 <= 1e-6) continue;
          const uc = Math.max(a0, Math.min(a1 - 1, u));
          const [st, v, dd] = cellAt(uc, y);
          if (!st) continue;
          const j = 1 + (hash3(uc, y, faceVox, 7) - 0.5) * 0.04;
          const yb = y, yt = y + 1;
          if (st === 1) {
            emit([P(ub0, yb, plane(yb)), P(ub1, yb, plane(yb)), P(ut1, yt, plane(yt)), P(ut0, yt, plane(yt))], nrm, col(v, j), v.team ? v.team : 0);
            continue;
          }
          // the recess: only on whole interior cells
          if (u !== uc) continue;
          const dp = (yy) => plane(yy) - sg * dd;
          emit([P(u, yb, dp(yb)), P(u + 1, yb, dp(yb)), P(u + 1, yt, dp(yt)), P(u, yt, dp(yt))], nrm, col(v, j), v.team ? v.team : 0);
          // reveals where a skinned cell borders it
          const nb = (uu, yy) => (uu < a0 || uu >= a1 || yy < yS || yy >= top ? [0] : cellAt(uu, yy));
          const ax = alongX ? [1, 0, 0] : [0, 0, 1];
          for (const [du, ub] of [[-1, u + 0.02], [1, u + 0.98]]) {
            const [ns, nv] = nb(u + du, y);
            if (ns !== 1) continue;
            emit([P(ub, yb, plane(yb)), P(ub, yt, plane(yt)), P(ub, yt, dp(yt)), P(ub, yb, dp(yb))], ax.map((a) => -a * du), col(nv, dd > 1 ? 0.42 : 0.6), 0);
          }
          const [bs, bv] = nb(u, y - 1);
          if (bs === 1) emit([P(u, yb + 0.02, plane(yb)), P(u + 1, yb + 0.02, plane(yb)), P(u + 1, yb + 0.02, dp(yb)), P(u, yb + 0.02, dp(yb))], [0, 1, 0], col(bv, 0.86), 0);
          const [ts, tv] = nb(u, y + 1);
          if (ts === 1) emit([P(u, yt - 0.02, plane(yt)), P(u + 1, yt - 0.02, plane(yt)), P(u + 1, yt - 0.02, dp(yt)), P(u, yt - 0.02, dp(yt))], [0, -1, 0], col(tv, 0.45), 0);
        }
      }
      // a curved cavetto (B.cav, see pylon()): the gorge as one smooth
      // concave sheet flaring from the wall's top up and out to the lip's
      // outer edge, fluted, darkening into its throat
      if (B.cav) {
        const e0 = 1 - sl(top), e1 = B.cav.lipOut - K;
        const [gA, gB] = B.cav.gorge;
        const NR = 4;
        const eAt = (s) => e0 + (e1 - e0) * s * s;
        for (let r = 0; r < NR; r++) {
          const sa = r / NR, sb = (r + 1) / NR;
          const ea = eAt(sa), eb = eAt(sb);
          const ya = top + 2 * sa, yb2 = top + 2 * sb;
          const len = Math.hypot(eb - ea, yb2 - ya);
          const ne = (yb2 - ya) / len, ny = -(eb - ea) / len;
          const n3 = alongX ? [0, ny, sg * ne] : [sg * ne, ny, 0];
          const La = lo - ea, Ra = hi + ea, Lb = lo - eb, Rb = hi + eb;
          for (let u = Math.floor(Lb); u < Math.ceil(Rb); u++) {
            const a0c = Math.max(u, La), a1c = Math.min(u + 1, Ra), b0c = Math.max(u, Lb), b1c = Math.min(u + 1, Rb);
            if (a1c - a0c <= 1e-6 && b1c - b0c <= 1e-6) continue;
            _k.setHex(((u & 1) ? gA : gB));
            const f = 0.74 + 0.09 * r;
            emit([P(a0c, ya, outer0 + sg * ea), P(a1c, ya, outer0 + sg * ea), P(b1c, yb2, outer0 + sg * eb), P(b0c, yb2, outer0 + sg * eb)], n3, [_k.r * f, _k.g * f, _k.b * f], 0);
          }
        }
      }
      // the torus roll under the cavetto: a half-round moulding along the
      // face's top row
      if (B.roll) {
        const yc = top - 0.5, r = 0.5, NS = 4;
        const Lc = L(yc) - 0.5, Rc = R(yc) + 0.5;
        for (let i = 0; i < NS; i++) {
          const ta = Math.PI * i / NS, tb = Math.PI * (i + 1) / NS, tm = (ta + tb) / 2;
          const pt = (u, t) => P(u, yc - r * Math.cos(t), plane(yc) + sg * r * Math.sin(t));
          const n3 = alongX ? [0, -Math.cos(tm), sg * Math.sin(tm)] : [sg * Math.sin(tm), -Math.cos(tm), 0];
          _k.setHex(B.roll === true ? ROLL_L : B.roll);
          emit([pt(Lc, ta), pt(Rc, ta), pt(Rc, tb), pt(Lc, tb)], n3, [_k.r, _k.g, _k.b], 0);
        }
      }
      // the cap between the skin's top edge and the top row's face, under the cornice
      const vg = alongX ? m.get(Math.floor((lo + hi) / 2), top, pos ? outer0 - 1 - K : outer0 + K) : m.get(pos ? outer0 - 1 - K : outer0 + K, top, Math.floor((lo + hi) / 2));
      _k.setHex(vg ? vg.c : GORGE);
      const dTop = pos ? outer0 - K : outer0 + K;
      emit([P(L(top), top, plane(top)), P(R(top), top, plane(top)), P(hi - K, top, dTop), P(lo + K, top, dTop)], [0, 1, 0], [_k.r * 0.9, _k.g * 0.9, _k.b * 0.9], 0);
    }
    // the corner torus (B.roll): a round moulding running up each battered
    // edge, a 270-degree roll round the hip line from the base course to the
    // horizontal roll under the cavetto, so every corner is one straight bead
    if (B.roll) {
      const sl = (y) => (y - y0) / b, r = 0.55, NS = 6;
      _k.setHex(B.roll === true ? ROLL_L : B.roll);
      const c = [_k.r, _k.g, _k.b];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const X = (y) => (sx > 0 ? x1 : x0) + sx * (1 - sl(y));
        const Z = (y) => (sz > 0 ? z1 : z0) + sz * (1 - sl(y));
        const dir = (t) => [Math.sin(t) * sx, -Math.cos(t) * sz];      // t 0: back along the x face; 3pi/2: along the z face
        const ya = y0 + (B.base || 0), yb = top - 0.5;
        for (let i = 0; i < NS; i++) {
          const ta = 1.5 * Math.PI * i / NS, tb = 1.5 * Math.PI * (i + 1) / NS;
          const [dax, daz] = dir(ta), [dbx, dbz] = dir(tb), [dmx, dmz] = dir((ta + tb) / 2);
          emit([[X(ya) + r * dax, ya, Z(ya) + r * daz], [X(ya) + r * dbx, ya, Z(ya) + r * dbz], [X(yb) + r * dbx, yb, Z(yb) + r * dbz], [X(yb) + r * dax, yb, Z(yb) + r * daz]], [dmx, 0.12, dmz], c, 0);
        }
      }
    }
  }
}
// the pale roll of a torus moulding (pylon())
const ROLL_L = 0xeadcbc;
// the canvas sheets (clothAwning): a heightfield of half-voxel quads,
// two-sided (the underside a hair lower), coloured per stripe
function clothSkin(m) {
  const S2 = m.skin;
  const _k = new THREE_Color();
  for (const C of m.cloths) {
    const { face, f, a0, a1, depth, sw, stripes } = C;
    const sg = face[0] === '+' ? 1 : -1, alongX = face[1] === 'z';
    const wall = f + (sg > 0 ? 1 : 0);                  // the wall's outer plane
    const P = (a, d, y) => { const D = wall + sg * d; return alongX ? [a, y, D] : [D, y, a]; };
    const N = 2, du = 1 / N;
    for (let a = a0; a < a1; a += du) for (let d = 0; d < depth - 1e-6; d += du) {
      const ac = Math.floor(a);
      const tones = stripes[Math.floor((ac - a0) / sw) % stripes.length];
      const c = tones[Math.floor(hash3(ac, Math.floor(d), f, 67) * tones.length) % tones.length];
      const q = [[a, d], [a + du, d], [a + du, d + du], [a, d + du]].map(([u, v]) => P(u, v, C.y(u, v)));
      // the normal of the quad (up-facing)
      const ux = q[2][0] - q[0][0], uy = q[2][1] - q[0][1], uz = q[2][2] - q[0][2];
      const vx = q[3][0] - q[1][0], vy = q[3][1] - q[1][1], vz = q[3][2] - q[1][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz) || 1;
      _k.setHex(c);
      const col = [_k.r, _k.g, _k.b];
      const emit = (pts, nrm, cc) => { for (const i of [0, 1, 2, 0, 2, 3]) { S2.pos.push(...pts[i]); S2.nor.push(...nrm); S2.col.push(...cc); S2.team.push(0); } };
      emit(q, [nx / nl, ny / nl, nz / nl], col);
      emit(q.map(([x, y, z]) => [x, y - 0.06, z]), [-nx / nl, -ny / nl, -nz / nl], col.map((v) => v * 0.8));
    }
  }
}
// winding: every quad is emitted in the order the mesher expects (counter-
// clockwise seen from outside, before the index flip in Group.add); flip the
// quads whose geometric normal disagrees with the outward normal
function fixWinding(S2) {
  for (let i = 0; i < S2.pos.length; i += 9) {
    const p = S2.pos;
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * S2.nor[i] + ny * S2.nor[i + 1] + nz * S2.nor[i + 2] < 0) {
      for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    }
  }
}
// Append m.skin to a geometry (as shapes.js withExtras, with the team weight)
function withSkin(geo, m, size, pivot) {
  const S2 = m.skin;
  if (!S2 || !S2.pos.length) return geo;
  fixWinding(S2);
  const a = geo.attributes;
  const nv = a.position.count, ne = S2.pos.length / 3;
  const cat = (attr, extra, w) => {
    const out = new Float32Array((nv + ne) * w);
    out.set(attr.array.subarray(0, nv * w), 0);
    out.set(extra, nv * w);
    return new THREE_BufferAttribute(out, w);
  };
  const pos = S2.pos.map((v, i) => (v - pivot[i % 3]) * size);
  const g = new THREE_BufferGeometry();
  g.setAttribute('position', cat(a.position, pos, 3));
  g.setAttribute('normal', cat(a.normal, S2.nor, 3));
  g.setAttribute('color', cat(a.color, S2.col, 3));
  g.setAttribute('team', cat(a.team, S2.team, 1));
  g.setAttribute('glow', cat(a.glow, new Array(ne).fill(0), 1));
  const oi = geo.index.array;
  const idx = new Uint32Array(oi.length + ne);
  idx.set(oi, 0);
  for (let i = 0; i < ne; i++) idx[oi.length + i] = nv + i;
  g.setIndex(new THREE_IndexAttribute(idx, 1));
  return g;
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
// A lot: no square slab; the ground voxels are laid by settle() once the
// building stands (`ground` tints the apron: sand, earth).
function lot(W, D, ground = SANDGROUND) {
  const m = new Rec(W, D);
  m.ground = ground;
  return m;
}
// A ragged patch of ground voxels (a yard, a threshing floor, paving): the
// rectangle with its outer two voxels eaten away by noise.
function patch(m, x0, z0, x1, z1, color, { rag = 2, seed = 0 } = {}) {
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const e = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z);
    if (e < rag && hash3(x, seed, z, 131) > 0.3 + 0.7 * ((e + 1) / (rag + 1)) * 0.9) continue;
    m.set(x, 0, z, color);
  }
}
// Settle the building into the ground: a packed-earth apron under and round
// everything that stands (ragged, fading out in 3 voxels, a darker sand
// splash against the walls), worn paths from every ground-level door out to
// the lot edge (registered by door()), so no square plinth shows.
const SPLASH = (x, y, z) => pick(hash3(x, y, z, 27), [0xa58662, 0x9f805c, 0xaa8b67]);
const WORN = (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 28), [0xb3936b, 0xab8c65, 0xb89870, 0xa68761]);
// The plinth line: a clean one-voxel step of darker stone round the foot of
// every ground-level block (block() records them), not in front of doors, so
// each building stands on a crisp edge between its pale walls and the ground.
function plinths(m) {
  for (const { x0, z0, x1, z1, hb = 1 } of m.feet) {
    const ring = (x, z) => { m.set(x, 0, z, PLINTH); for (let y = 1; y <= hb; y++) if (!m.has(x, y, z)) m.set(x, y, z, PLINTH); };
    for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) {
      const ex = x === x0 - 1 || x === x1, ez = z === z0 - 1 || z === z1;
      if (!ex && !ez) continue;
      if (x < 0 || z < 0 || x >= m.W || z >= m.D || m.has(x, 1, z)) continue;
      // the wall cell it rests against (a corner: skip; a door: the cell is cut)
      if (ex && ez) { ring(x, z); continue; }
      const ix = x === x0 - 1 ? x0 : x === x1 ? x1 - 1 : x, iz = z === z0 - 1 ? z0 : z === z1 ? z1 - 1 : z;
      if (!m.has(ix, 1, iz) || !m.has(ix, 2, iz)) continue;
      ring(x, z);
    }
  }
}
// Settle the building into the ground: a clean apron of packed earth a value
// darker than the walls (and the terrain) under and one voxel round whatever
// stands, straight-edged so the footprint reads, and worn paths from every
// ground-level door out to the lot edge (registered by door()).
function settle(m) {
  const W = m.W, D = m.D;
  plinths(m);
  const stand = new Set();
  for (const [x, y, z] of m.coords) if (y >= 1 && y <= 2 && m.has(x, y, z)) stand.add(x * 4096 + z);
  const R = 2;
  const dist = (x, z) => {
    let best = 99;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      if (stand.has((x + dx) * 4096 + (z + dz))) best = Math.min(best, Math.max(Math.abs(dx), Math.abs(dz)));
    }
    return best;
  };
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    if (m.has(x, 0, z)) continue;
    const d = dist(x, z);
    if (d <= 1) m.set(x, 0, z, SPLASH);
  }
  // worn paths out of the doors
  for (const p of m.paths) {
    const { face, a0, a1, f } = p;
    const n = OUT_N[face];
    const along = n[0] !== 0 ? 'x' : 'z';
    const lim = along === 'x' ? (n[0] > 0 ? W : -1) : (n[2] > 0 ? D : -1);
    for (let s = 1; ; s++) {
      const c = f + s * (along === 'x' ? n[0] : n[2]);
      if (c === lim) break;
      const rem = Math.abs(lim - c);
      for (let a = a0; a < a1; a++) {
        const h = hash3(a, s, c, 133);
        if (rem <= 2 && h < 0.6 - rem * 0.15) continue;
        const [x, z] = along === 'x' ? [c, a] : [a, c];
        if (m.has(x, 1, z)) continue;
        m.set(x, 0, z, WORN);
      }
    }
  }
}

// ---- dressing ----------------------------------------------------------------
const MUDCAP = (x, y, z) => pick(hash3(x, y, z, 17), [0xc9a274, 0xc29a6b, 0xcfa97c]);
const MUDCAP_D = 0xa9845a;
const WICKER = (x, y, z) => pick(hash3(x, y, z, 18), [0xb08f58, 0xa3834f, 0xbb9a62]);
const STRIPE_M = 0xb2654c;      // a faded red stripe (TC, camps: not the market's colour)
const STRIPE_T = 0xc9a77a;      // tan
// palm-log beam ends poking one voxel out of a face at row y, every `step`
function beams(m, face, a0, a1, y, step = 3) {
  const n = OUT_N[face];
  for (let u = a0; u < a1; u += step) {
    const p = outer(m, face, u, y, lim(m));
    if (p) m.set(p[0] + n[0], y, p[2] + n[2], (u & 1) ? DARKWOOD : 0x6a4a2c);
  }
}
// a palm-thatch lean-to on poles
function leanTo(m, face, f, a0, a1, yTop, depth, drop) {
  awning(m, face, f, a0, a1, yTop, depth, drop, [THATCH, (x, y, z) => shade(THATCH(x, y, z), 0.84)], { sw: 1, valance: true });
}
// a low mud-brick wall along an axis-aligned polyline, its cap worn, `gaps`
// = cells left open ([x, z])
function mudFence(m, pts, h = 3, { gaps = [], wall = MUD } = {}) {
  const gap = new Set(gaps.map(([x, z]) => x * 4096 + z));
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
    const n = Math.max(Math.abs(xb - xa), Math.abs(zb - za));
    for (let s = 0; s <= n; s++) {
      const x = xa + Math.sign(xb - xa) * s, z = za + Math.sign(zb - za) * s;
      if (gap.has(x * 4096 + z)) continue;
      const hh = h - (hash3(x, h, z, 19) < 0.18 ? 1 : 0);
      for (let y = 1; y <= hh; y++) m.set(x, y, z, y === hh ? MUDCAP : wall);
    }
  }
}
// a cluster of clay jars round (x, z)
function pots(m, x, z, n = 3, seed = 0) {
  const at = [[0, 0, 1], [2.3, 0.7, 0], [0.7, 2.4, 0], [2.8, 2.8, 0], [-1.6, 1.8, 0]];
  const cols = [0xb8683e, 0xc8a070, 0xa65a34, 0xd2b07c];
  for (let i = 0; i < Math.min(n, at.length); i++) {
    const [dx, dz, big] = at[i];
    jar(m, x + dx, 1, z + dz, cols[(i + seed) % cols.length], big === 1 && n >= 3);
  }
}
// a wicker basket heaped with goods (2 x 2 or 3 x 3)
function basket(m, x, z, kind, w = 2, y = 1) { goodsBox(m, x, y, z, w, w, kind, 2, 0xa3834f); }
// a cowhide shield (5 tall, 3 wide) leaning flat on a face at (u, y0)
function shield(m, face, u, y0) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  const n = OUT_N[face];
  const rows = ['.W.', 'WBW', 'WWB', 'BWW', 'WWW'];
  rows.forEach((row, j) => {
    for (let i = 0; i < 3; i++) {
      if (row[i] === '.') continue;
      const p = outer(m, face, u + i * dir, y0 + 4 - j, lim(m));
      if (!p) continue;
      m.set(p[0] + n[0], p[1], p[2] + n[2], row[i] === 'W' ? 0xe8e0cc : 0x6a4a30);
    }
  });
}
// a weapon rack along x at z: two posts, a bar, spears and a pair of shields
function rack(m, x0, z, len = 7) {
  for (const x of [x0, x0 + len - 1]) m.box(x, 1, z, 1, 6, 1, POLE);
  for (let x = x0; x < x0 + len; x++) m.set(x, 6, z, DARKWOOD);
  for (let x = x0 + 1; x < x0 + len - 1; x += 2) { m.box(x, 1, z + 1, 1, 10, 1, 0x8b6139); m.set(x, 11, z + 1, STEEL); m.set(x, 12, z + 1, STEEL); }
}
// a practice dummy: a post with a cross-arm and a straw head
function dummy(m, x, z) {
  m.box(x, 1, z, 1, 8, 1, POLE); m.box(x - 2, 6, z, 5, 1, 1, POLE);
  m.box(x - 1, 3, z - 1, 3, 4, 3, THATCH); m.box(x, 8, z, 1, 2, 1, THATCH);
}

// House (3 x 3 tiles; Retold building_03 / building_04): coursed sandstone
// boxes of different heights, each standing on a dark base course, under a
// deep cavetto cornice (the gorge flaring to a pale lip round the dark roof
// deck and its team line), a framed doorway (jambs proud of the wall, a
// lintel and a small cornice over it, a dark wooden leaf), grouped slit
// windows under lintels, palm-log beam ends, and the house's own feature: a
// striped cloth awning on poles over its jars and baskets. Three plans after
// building_04: a main block with a lower side room (awning on the side
// room's front); a main block with an upper room on its roof and a projecting
// door portal; an L of a tall back block and a low front room round a small
// walled yard. age 1 (Archaic): mud brick with a mud gorge and palm-thatch
// roofs under poles; age 2+: coursed sandstone with plaster decks.
// a clean low yard wall along an axis-aligned polyline: coursed, an even
// height, a pale coping one voxel wider, `gaps` = cells left open ([x, z])
function yardWall(m, pts, h, wall, cap, gaps = []) {
  const gap = new Set(gaps.map(([x, z]) => x * 4096 + z));
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, za] = pts[i], [xb, zb] = pts[i + 1];
    const n = Math.max(Math.abs(xb - xa), Math.abs(zb - za));
    for (let s = 0; s <= n; s++) {
      const x = xa + Math.sign(xb - xa) * s, z = za + Math.sign(zb - za) * s;
      if (gap.has(x * 4096 + z)) continue;
      m.set(x, 1, z, PLINTH);
      for (let y = 2; y < h; y++) m.set(x, y, z, wall);
      m.set(x, h, z, cap);
    }
  }
}
function house(v, age) {
  const m = lot(24, 24);
  const arch = age === 1;
  const W = arch ? MUD : WASH;
  // battered walls (a step in every 4 rows under the skin, so the slope reads
  // from the RTS camera), a team band under a flared two-row cavetto cornice
  const bo = { wall: W, roofC: arch ? THATCH : PLASTER, band: arch ? null : 'teamb', batter: 4, rimC: arch ? MUDCAP : LIP, gorge: arch ? [MUDCAP_D, 0xb8925f] : null, torus: !arch, lipOut: 2, flare: true, rimTeam: arch ? TEAM : TEAMB };
  const poles = (T) => { if (!arch) return; for (let x = T.c0 + 2; x < T.c1 - 1; x += 3) for (let z = T.d0 - 1; z <= T.d1; z++) m.set(x, T.y + 1, z, (z + x) % 4 ? DARKWOOD : 0x6a4a2c); };
  // high windows: three slits under one lintel just below the band
  const hw = (face, u, yTop) => win(m, face, u, yTop - 3, { n: 3, h: 3 });
  if (v === 0) {
    // the main block and a lower side room on the east
    block(m, 3, 3, 14, 15, 1, 12, bo); poles(m.lastTop);
    block(m, 14, 6, 21, 15, 1, 8, { ...bo, lipOut: 1 }); poles(m.lastTop);
    door(m, '+z', 5, 3, 1, 6);
    hw('+z', 8, 10);
    hw('+x', 13, 7);
    hw('-z', 11, 10); hw('-x', 6, 10);
    // the awning on the side room's front over the jars and a crate
    clothAwning(m, '+z', 13, 14, 21, 6, 5, 2, { sw: 1, sag: 0.7, belly: 0.4 });
    pots(m, 15.5, 17.5, 2, 1); crate(m, 18, 1, 17, 3, 3, 3);
  } else if (v === 1) {
    // the main block, an upper room on its roof, a projecting door portal
    const t = block(m, 3, 3, 17, 14, 1, 10, bo); poles(m.lastTop);
    block(m, 5, 4, 12, 10, t - 1, 5, { ...bo, batter: 0, lipOut: 1 }); poles(m.lastTop);
    block(m, 12, 14, 18, 19, 1, 8, { ...bo, batter: 0, lipOut: 1 });
    door(m, '+z', 14, 3, 1, 5);
    win(m, '+z', 6, t, { n: 3, h: 3 });
    hw('+x', 11, 9);
    hw('-z', 14, 9); hw('-x', 6, 9);
    clothAwning(m, '+z', 12, 3, 11, 6, 5, 2, { sw: 1, sag: 0.7, belly: 0.4 });
    basket(m, 4, 17, 'orange'); jar(m, 8.5, 1, 18.5, 0xb8683e);
  } else {
    // an L: a tall back block and a low front room round a small walled yard
    block(m, 3, 3, 21, 12, 1, 11, bo); poles(m.lastTop);
    block(m, 3, 12, 11, 21, 1, 8, { ...bo, lipOut: 1 }); poles(m.lastTop);
    door(m, '+z', 15, 3, 1, 6);
    hw('+z', 5, 7);
    hw('+x', 9, 9);
    hw('-z', 17, 10); hw('-z', 9, 10); hw('-x', 14, 7); hw('-x', 5, 10);
    yardWall(m, [[11, 21], [21, 21], [21, 12]], 4, W, arch ? MUDCAP : LIME, [[15, 21], [16, 21], [17, 21]]);
    clothAwning(m, '+x', 10, 13, 19, 6, 4, 2, { sw: 1, sag: 0.7, belly: 0.4 });
    pots(m, 12.5, 14.5, 3, 2); basket(m, 18, 14, 'green');
  }
  return m;
}

// Granary (3 x 3; building_05): the flat-roofed store at the back left in
// coursed sandstone with a deep cavetto cornice, a roof hatch and a ladder up
// its front, the door beside it; two big domed brick silos in a row along its
// east side (the silhouette), plank gangways from the store's roof up to their
// loading mouths, a crate of grain and a barrel in front.
function granary() {
  const m = lot(24, 24);
  const t = block(m, 1, 2, 11, 21, 1, 11, { wall: SAND, roofC: MUDROOF, rimC: LIME, gorge: [0x8a5e38, 0x946640], torus: false, lipOut: 2, batter: 6, band: null });
  const T = m.lastTop;
  // the roof hatch with a timber frame
  for (let x = T.c0 + 3; x < T.c0 + 6; x++) for (let z = T.d0 + 9; z < T.d0 + 13; z++) m.set(x, t - 1, z, DARK);
  for (let x = T.c0 + 2; x < T.c0 + 7; x++) for (const z of [T.d0 + 8, T.d0 + 13]) m.set(x, t, z, 0x8a6a48);
  for (let z = T.d0 + 8; z < T.d0 + 14; z++) for (const x of [T.c0 + 2, T.c0 + 6]) m.set(x, t, z, 0x8a6a48);
  // the door and a slit window on the front
  door(m, '+z', 3, 2, 1, 5);
  slit(m, '+z', 4, 9, 2, 1);
  // the silos
  const A = silo(m, 17.5, 6.5, 1, 4.8, 14, { dome: 0.85 });
  const B = silo(m, 17.5, 17.5, 1, 4.6, 12, { dome: 0.85 });
  // a ladder from the store's roof up to each silo's loading mouth
  for (const S0 of [A, B]) ladder(m, [T.c1 - 2.2, t, S0.cz], [S0.cx - S0.rm - 0.7, S0.lip + 0.6, S0.cz]);
  // the ladder leaning on the front up to the roof
  ladder(m, [8.5, 0.6, 23.6], [8.5, t + 0.8, 21.4]);
  // a crate of grain and a barrel by the door
  goodsBox(m, 10, 1, 21, 3, 3, 'grain', 2, 0x8a6236);
  barrel(m, 1.5, 1, 22.5, 4, 1.4);
  return m;
}

// the camps' painted frieze under a flared cornice (rows top first): lapis,
// a pale fillet, red, a pale fillet
const CAMP_FRIEZE = [(x, y, z) => ((x + z) % 5 === 0 ? shade(LAPIS, 0.8) : LAPIS), FRIEZE_SEP, (x, y, z) => ((x + z) % 5 === 0 ? shade(RED_M, 0.8) : RED_M), FRIEZE_SEP];
// Lumber Camp (3 x 3; building_06): a steeply battered block under a flared
// cavetto with a painted lapis / red frieze, a canvas awning sloping from its
// east face to a row of posts (sagging between them, a scalloped hem) over
// the camp's stock: a stack of big logs showing their pale ring ends, a
// saw-pit in front with a log on trestles and a pit saw through it, crates,
// a barrel, a spare log behind (no tall frame: the block is the silhouette).
function lumberCamp() {
  const m = lot(24, 24);
  block(m, 2, 3, 13, 15, 1, 13, { wall: WASH, roofC: MUDROOF, rimC: LIME, gorge: [0xc9ab7c, 0xd6ba8c], torus: false, lipOut: 2, batter: 5, band: null, flare: true });
  // the painted frieze under the cornice: lapis, a pale fillet, red, pale
  bands(m, 0, 0, 16, 18, 13, CAMP_FRIEZE);
  door(m, '+z', 6, 3, 1, 6);
  slit(m, '+x', 7, 6, 2, 1);
  // the canvas from the block's east face over the stock
  const yTop = 10, f = 12 - Math.floor((yTop - 1) / 5);
  clothAwning(m, '+x', f, 4, 19, yTop, 22 - f, 2.5, { posts: [4, 11, 18], sw: 2, belly: 0.5, sag: 1.2 });
  // the stock: big logs stacked 3-2 along z under the canvas, their pale
  // ring ends out at the open side, facing the street
  for (const [row, xs] of [[0, [13, 16, 19]], [1, [14, 17]]]) for (const x of xs) bigLog(m, x, 1 + row * 3, 6 + row, 10 - row, 'z');
  // chocks at the stack's foot
  for (const x of [12, 22]) m.set(x, 1, 14, DARKWOOD);
  // crates by the door
  crate(m, 10, 1, 18, 3, 3, 3, 0xb08850);
  crate(m, 10, 4, 18, 3, 2, 3, 0xa27c48);
  crate(m, 1, 1, 18, 3, 3, 3, 0xb08850);
  barrel(m, 4.5, 1, 22, 4, 1.4);
  // the saw-pit in front: a dark pit in a timber kerb, a trimmed log on
  // bearers across it, the pit saw standing through the log, a tiller handle
  // across its top, sawdust by the pit
  for (let x = 14; x < 23; x++) for (let z = 18; z < 24; z++) {
    const rim = x === 14 || x === 22 || z === 18 || z === 23;
    m.set(x, 0, z, rim ? PLANK(x, 0, z) : (x === 15 || x === 21 || z === 19 || z === 22) ? 0x2e241c : DARK);
  }
  for (const x of [15, 21]) for (let z = 19; z < 23; z++) m.set(x, 1, z, DARKWOOD);
  log(m, 13, 2, 20, 11, 'x', 1);
  for (const x of [17, 18]) for (let y = 1; y < 8; y++) m.set(x, y, 20, (y === 1 || x === 18) ? 0x4e4a45 : 0x77726a);
  for (let z = 19; z < 22; z++) m.set(17, 8, z, POLE);
  for (const [x, z] of [[17, 23], [19, 23], [13, 21], [23, 20]]) if (!m.has(x, 0, z)) m.set(x, 0, z, 0xd9c08a);
  // no tall frame (Retold's camp has none): a spare log on chocks behind
  // the stack, under the block's height
  log(m, 13, 2, 1, 10, 'x', 1);
  for (const x of [14, 21]) m.set(x, 1, 1, DARKWOOD);
  return m;
}

// Mining Camp (3 x 3; building_07): a flat-roofed battered block under a
// flared cavetto with a team rim, pale limestone corner piers, a painted
// frieze of lapis / red / ochre panels between pale fillets under the
// cornice and a turquoise dado over the base course, a framed door (proud
// jambs, lintel, a small cornice, the gilt winged sun) on the front; two
// canvas awnings on light palm-log posts, the west one over a timber bin of
// gold ore built against the wall, the east one over a stone water trough on
// a footing course against the wall; crates, barrels and lumps of gold ore
// in front. No tall frame: the block is the silhouette, as in Retold.
const MINE_PAT = (x, y, z) => { const u = (x + z) % 7; return u === 0 || u === 4 ? FRIEZE_SEP : u < 4 ? (u === 2 ? OCHRE_M : LAPIS) : RED_M; };
const MINE_FRIEZE = [FRIEZE_SEP, MINE_PAT, MINE_PAT, FRIEZE_SEP, (x, y, z) => ((x + z) % 5 === 0 ? shade(RED_M, 0.82) : RED_M)];
const PALMPOST = (x, y, z) => ((y & 1) ? 0xb08a5c : 0xa07c50);
function oreLump(m, x, z, s = 0) {
  const R = [0x8c7a5a, 0x7d6c50, 0x96845f];
  m.box(x, 1, z, 2, 1, 2, (xx, yy, zz) => (hash3(xx, yy, zz, 90 + s) < 0.45 ? GOLDORE(xx, yy, zz) : pick(hash3(xx, yy, zz, 91), R)));
  m.set(x + (s & 1), 2, z + ((s >> 1) & 1), GOLDORE);
}
function miningCamp() {
  const m = lot(24, 24);
  block(m, 5, 3, 17, 13, 1, 12, { wall: WASH, roofC: MUDROOF, rimC: LIME, gorge: [0xc9ab7c, 0xd6ba8c], torus: true, lipOut: 2, batter: 6, band: null, flare: true });
  // the painted frieze under the cornice (rows 11..8), the dado over the base
  bands(m, 0, 0, 24, 24, 11, MINE_FRIEZE);
  bands(m, 0, 0, 24, 24, 3, [(x, y, z) => ((x + z) % 4 === 0 ? FRIEZE_SEP : TURQ)]);
  door(m, '+z', 11, 4, 1, 5, { deep: 3 });
  slit(m, '-z', 13, 6, 3, 1); slit(m, '-z', 9, 6, 3, 1); slit(m, '-x', 8, 6, 3, 1);
  // the front-left awning over the ore bin, the east one over the trough,
  // on light palm-log posts
  const yTop = 10, inset = Math.floor((yTop - 1) / 6);
  clothAwning(m, '+z', 12 - inset, 1, 10, yTop, 5, 3, { sw: 2, sag: 0.9, post: PALMPOST });
  clothAwning(m, '+x', 16 - inset, 4, 12, yTop, 6, 4, { sw: 2, sag: 0.8, post: PALMPOST });
  // the ore bin against the front wall: a dark timber sill, plank sides with
  // corner posts, heaped gold ore
  for (let x = 2; x < 9; x++) for (let z = 13; z < 19; z++) {
    m.set(x, 1, z, DARKWOOD);
    const rim = x === 2 || x === 8 || z === 13 || z === 18, corner = (x === 2 || x === 8) && (z === 13 || z === 18);
    for (let y = 2; y < 5; y++) {
      if (corner) m.set(x, y, z, DARKWOOD);
      else if (rim) m.set(x, y, z, y === 4 ? shade(PLANK(x, y, z), 1.08) : PLANK(x, y, z));
      else if (y === 4) m.set(x, y, z, GOLDORE);
      else m.set(x, y, z, 0x5a4630);
    }
    if (!rim && hash3(x, 5, z, 5) < 0.65) m.set(x, 5, z, GOLDORE);
  }
  for (let x = 4; x < 7; x++) for (let z = 15; z < 18; z++) if (hash3(x, 6, z, 8) < 0.6) m.set(x, 6, z, GOLDORE);
  // the water trough against the east wall: a darker footing course a voxel
  // proud, sandstone sides, a limestone coping, the water a voxel down
  for (let x = 17; x < 22; x++) for (let z = 4; z < 12; z++) m.set(x, 1, z, SAND_D);
  for (let x = 17; x < 21; x++) for (let z = 5; z < 11; z++) {
    const rim = x === 17 || x === 20 || z === 5 || z === 10;
    m.set(x, 2, z, rim ? SAND(x, 2, z) : WATER);
    if (rim) m.set(x, 3, z, LIME(x, 3, z));
  }
  barrel(m, 22, 1, 6.5, 5, 1.9);
  // crates right of the door, one stacked, a barrel, a crate of ore
  crate(m, 17, 1, 14, 3, 3, 3, 0xb08850);
  crate(m, 17, 4, 14, 3, 2, 3, 0xa27c48);
  barrel(m, 21.5, 1, 15.5, 5, 1.9);
  goodsBox(m, 16, 1, 18, 4, 4, 'gold', 2, 0x8a6236);
  // lumps of gold ore on the ground in front of the bin
  oreLump(m, 3, 20, 0); oreLump(m, 9, 19, 1); oreLump(m, 6, 21, 2); oreLump(m, 11, 21, 3);
  return m;
}

// Town Center (7 x 7; building_02, building_01): a walled sandstone compound
// (battered enclosure walls with a gorge coping, corner piers), a battered
// pylon gateway with painted reliefs and a gilt winged sun, the two-storey
// hall with a lapis band and a latticed door, the east block, the front
// room, faded striped awnings, a big and a small domed silo, a courtyard
// with a fire pit, a basin, jars, crates, a palm, and the gilt falcon-headed
// Ra statue (the bright team kilt) on a plinth at the front-left corner.
function townCenter() {
  const N = 56;
  const m = lot(N, N);
  // the courtyard: cool grey flagstones, a value apart from every wall
  patch(m, 6, 6, 50, 50, FLAG, { rag: 1, seed: 1 });
  // the enclosure walls (battered, warm ochre sandstone, a pale coping) with
  // the gate gap on the front
  const wo = { wall: OCHRE_W, batter: 4, band: null, rim: false, torus: false, socle: 1, rimC: LIME, gorge: [0xb98a52, 0xc4965c] };
  block(m, 4, 4, 52, 7, 1, 6, wo);
  block(m, 4, 4, 7, 52, 1, 6, wo);
  block(m, 49, 4, 52, 52, 1, 6, wo);
  block(m, 4, 49, 18, 52, 1, 6, wo);
  block(m, 38, 49, 52, 52, 1, 6, wo);
  for (const [px, pz] of [[2, 2], [48, 2], [48, 48]]) block(m, px, pz, px + 6, pz + 6, 1, 9, { wall: OCHRE_W, batter: 5, band: null, torus: false, rimC: LIME });
  // the gateway: two battered sandstone pylons with wide painted bands (red,
  // ochre, turquoise between ink rules) over relief panels, a gate block
  // between them with a deep black passage and a dark leaf, the lintel bridge
  // with the gilt winged sun
  const PB = [INK, RED_B, RED_B, INK, OCHRE_B, OCHRE_B, INK, TURQ, TURQ, INK];
  for (const [x0, x1] of [[14, 25], [31, 42]]) {
    block(m, x0, 44, x1, 54, 1, 20, { batter: 8, band: null, frieze: 0, lipOut: 2 });
    bands(m, x0, 44, x1, 54, 19, PB);
  }
  for (let x = 24; x < 32; x++) for (let z = 46; z < 52; z++) for (let y = 1; y < 14; y++) m.set(x, y, z, y === 1 ? SAND_D(x, y, z) : SAND(x, y, z));
  for (let x = 23; x < 33; x++) for (let z = 46; z < 53; z++) for (let y = 14; y < 18; y++) m.set(x, y, z, y === 17 ? LIME(x, y, z) : y === 14 ? LIME_S : y === 16 ? TURQ : SAND(x, y, z));
  for (let x = 22; x < 34; x++) for (let z = 45; z < 54; z++) { const e = Math.min(x - 22, 33 - x, z - 45, 53 - z); m.set(x, 18, z, e === 0 ? LIME(x, 18, z) : PLASTER(x, 18, z)); }
  door(m, '+z', 26, 4, 1, 11, { deep: 4, frame: LIME, lintel: false });
  for (let y = 1; y < 11; y++) for (let x = 26; x < 30; x++) m.set(x, y, 47, x === 27 || x === 28 ? REVEAL : shade(DOOR(x, y, 47), 0.5));
  paint(m, '+z', 24, 16, ['GG.GGG.GG', '.GGGRGGG.'], { G: GILT, R: RED });
  for (const px of [16, 34]) {
    paint(m, '+z', px + 1, 9, ['.O.', 'OOO', '.O.', 'BOB', 'B.B', 'B.B', 'K.K'], { O: OCHRE, B: TURQ, K: INK });
    paint(m, '+z', px + 5, 9, ['K', '.', 'R', 'K', '.', 'B', 'K'], { K: INK, R: RED, B: TURQ });
  }
  // the main hall (two storeys, pale limestone, a pale tiled roof inside the
  // team rim) at the back left, its deep latticed door on the courtyard
  const t1 = block(m, 8, 8, 30, 27, 1, 15, { wall: LIME, batter: 6, band: null, roofC: ROOFTILE, lipOut: 2, rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2] });
  block(m, 13, 11, 25, 21, t1 - 1, 6, { wall: LIME, batter: 4, band: null, roofC: ROOFTILE, lipOut: 2, rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2] });
  door(m, '+z', 23, 4, 1, 8, { lattice: true, sun: true, deep: 3, frame: SAND });
  slit(m, '+z', 11, 9, 3, 1); slit(m, '+z', 18, 9, 3, 1); slit(m, '+x', 13, 9, 3, 1); slit(m, '+x', 20, 9, 3, 1);
  beams(m, '+x', 11, 25, 13, 3);
  clothAwning(m, '+z', 25, 9, 16, 11, 7, 4, { sw: 1, stripes: [CANVAS_T, CANVAS, CANVAS], sag: 0.8 });
  // the east block (dark mud brick, a pale lip) with an awning over its door
  const mb = { wall: MUDB, batter: 6, band: null, roofC: MUDROOF, rimC: LIME, lipOut: 2, gorge: [0x8a5e38, 0x946640], torus: false };
  block(m, 35, 8, 48, 22, 1, 12, mb);
  door(m, '+z', 39, 4, 1, 7, { deep: 3 });
  slit(m, '+x', 12, 6, 3, 1); slit(m, '+x', 17, 6, 3, 1);
  clothAwning(m, '-x', 36, 11, 20, 9, 5, 3, { sw: 1, stripes: [CANVAS_T, CANVAS, CANVAS], sag: 0.8 });
  // the front-right room (mud brick)
  block(m, 36, 29, 47, 39, 1, 10, mb);
  door(m, '+z', 42, 3, 1, 6, { deep: 3 });
  slit(m, '+x', 31, 6, 2, 1); slit(m, '+x', 35, 6, 2, 1);
  beams(m, '+x', 30, 38, 8, 3);
  // the big domed silo (front left) and a smaller one
  silo(m, 14.5, 36.5, 1, 6, 13);
  silo(m, 23.5, 31.5, 1, 3.6, 9);
  // the courtyard: a fire pit, a basin, jars, crates, a palm
  m.box(27, 1, 34, 5, 1, 5, LIME); m.box(28, 1, 35, 3, 1, 3, DARK);
  m.set(29, 2, 36, FIRE[3], FG); m.set(28, 2, 36, FIRE[1], FG); m.set(29, 2, 35, FIRE[2], FG); m.set(30, 2, 37, FIRE[0], FG); m.set(29, 3, 36, FIRE[2], FG);
  for (let x = 33; x < 38; x++) for (let z = 25; z < 29; z++) m.set(x, 1, z, x === 33 || x === 37 || z === 25 || z === 28 ? LIME : WATER);
  jar(m, 32.5, 1, 31.5, 0xb8683e, true);
  goodsBox(m, 40, 1, 40, 4, 3, 'grain');
  palm(m, 8, 1, 28, 21, { lx: 0.3, lz: 1, len: 7 });
  // outside the walls: pots by the gate, a basket, a cart wheel
  // the Ra statue on its plinth at the front-left corner (outside the wall line)
  // (half voxels: a gold-feathered falcon head with a dark hooked beak, the
  // sun disc, a striped wig, a broad collar, crook and flail crossed on the
  // chest, a pleated gold kilt under a belt, a cartouche on every plinth face)
  fineStatue(m, 2, 45, 12, 54, 1, 9, { h: 25, skin: BASALT, gold: GILT_L, kilt: GILT, kiltFront: TEAMB, head: 'falcon', crown: 'disc', arms: 'crossed', pose: 'stride' }, 1);
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
  // the reliefs: a painted procession band (ink figures on ochre, red and
  // lapis glyphs) on the faces of both tiers
  const RELIEF = (x, y, z, e) => {
    const u = (x + z) % 8;
    return u === 0 ? INK : u === 2 || u === 5 ? RED : u === 3 ? BLUEP : OCHRE;
  };
  const tier = (x0, z0, x1, z1, y0, h, band) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const e = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z);
      m.set(x, y, z, y === y0 + h - 1 ? (e === 0 ? LIME(x, y, z) : PAVE(x, y, z)) : (y === y0 + h - 2 && e === 0 ? band(x, y, z) : SAND(x, y, z)));
    }
  };
  tier(1, 2, 39, 38, 1, 3, () => TEAM);
  tier(5, 5, 35, 33, 4, 3, RELIEF);
  // the ramp up the front (z 33 -> 46), with low side walls
  for (let z = 33; z < 47; z++) {
    const yTop = Math.max(1, Math.round(6 - ((z - 33) * 5) / 13));
    for (let x = 15; x < 25; x++) for (let y = 1; y <= yTop; y++) m.set(x, y, z, y === yTop ? LIME(x, y, z) : SAND(x, y, z));
    for (const x of [14, 25]) for (let y = 1; y <= yTop + 1; y++) m.set(x, y, z, y === yTop + 1 ? LIME_S : SAND_D(x, y, z));
  }
  // the kiosk (building_08): a square colonnade of twelve clean sandstone
  // papyrus columns round [9, 31) x [8, 30), 3 x 3 voxels each on a 6-voxel
  // pitch, so every gap is an even 3-voxel dark slot (the front middle one is
  // the entrance, on the ramp's axis, the dark naos door behind it). Each
  // column: a dark foot, a plain shaft with faint drum joints, one lapis band
  // at the neck, a flared limestone bell capital and a dark abacus under the
  // architrave. Above: one tidy 2-row painted strip (a red fillet, lapis
  // panels), a torus roll, the cavetto gorge flaring one voxel out with its
  // shadowed underside, and the lip slab with the team line round a darker deck.
  const fl = 7;
  const colH = 13;
  const K0 = 9, K1 = 31, L0 = 8, L1 = 30;           // the kiosk's outer bounds (x, z)
  const pitch = [10, 16, 22, 28];                   // column starts along x
  const pitchZ = [9, 15, 21, 27];                   // column starts along z
  const SHAFT = [0xe2c491, 0xd3b27e];               // the faces, the arrises
  const LAPIS_N = 0x2f5f9e;
  const column = (x0, z0) => {
    for (let r = 0; r < colH; r++) {
      const y = fl + r;
      // the bell capital flares to 5 x 5 (corners clipped on its lower row)
      const flare = r === colH - 3 || r === colH - 2;
      const ext = flare ? 1 : 0;
      for (let i = -ext; i < 3 + ext; i++) for (let k = -ext; k < 3 + ext; k++) {
        const X = x0 + i, Z = z0 + k;
        const edgeI = i < 0 || i > 2, edgeK = k < 0 || k > 2;
        if (r === colH - 3 && edgeI && edgeK) continue;
        let c;
        if (r === 0) c = SAND_D(X, y, Z);                                   // the foot
        else if (r === colH - 1) c = (i === 1 && k === 1) ? SAND_D(X, y, Z) : shade(0xc9a874, 0.86);  // the abacus
        else if (flare) c = r === colH - 2 ? (edgeI || edgeK ? 0xefe2c4 : 0xe8d9b8) : (edgeI || edgeK ? 0xe3d3b0 : 0xd8c6a0);
        else if (r === colH - 4) c = LAPIS_N;                                // the neck band
        else {
          c = (i === 1 || k === 1) ? SHAFT[0] : SHAFT[1];                 // rounded: darker arrises
          if (r % 4 === 0) c = shade(c, 0.93);                               // drum joints
        }
        m.set(X, y, Z, c);
      }
    }
  };
  for (const x of pitch) { column(x, pitchZ[0]); column(x, pitchZ[3]); }
  for (const z of [pitchZ[1], pitchZ[2]]) { column(pitch[0], z); column(pitch[3], z); }
  // the floor under the roof in a darker flagging, so the slots read dark
  for (let x = K0; x < K1; x++) for (let z = L0; z < L1; z++) m.set(x, fl - 1, z, shade(PAVE(x, fl - 1, z), 0.8));
  // the naos inside, in a darker sandstone, with its door on the entrance axis
  const NAOS = (x, y, z) => shade(SAND_D(x, y, z), 0.82);
  block(m, 14, 13, 26, 24, fl, 11, { wall: NAOS, socle: 1, frieze: 0, band: null, parapet: false, rim: false, roofC: NAOS, rimC: NAOS, plinth: false, torus: false });
  door(m, '+z', 19, 3, fl, 7, { sun: false, lintel: true });
  // the architrave: one 2-row painted strip under the cornice (a red fillet,
  // then lapis panels split by pale separators every fourth voxel)
  const ay = fl + colH;
  for (let x = K0; x < K1; x++) for (let z = L0; z < L1; z++) {
    const e = Math.min(x - K0, K1 - 1 - x, z - L0, L1 - 1 - z);
    if (e > 3) { m.set(x, ay + 1, z, shade(0xb39a74, 0.72)); continue; }   // the coffered ceiling
    const u = (e === 0 && (z === L0 || z === L1 - 1)) ? x : z;
    m.set(x, ay, z, e === 0 ? RED_M : SAND_D(x, ay, z));
    m.set(x, ay + 1, z, e === 0 ? ((u % 4 === 0) ? FRIEZE_SEP : LAPIS) : SAND_D(x, ay + 1, z));
  }
  // the cornice: a torus roll flush with the strip, the gorge foot (fluted),
  // the gorge flaring one voxel out (its underside throws the shadow line),
  // then the lip slab with the team line and the deck
  for (let x = K0; x < K1; x++) for (let z = L0; z < L1; z++) {
    const e = Math.min(x - K0, K1 - 1 - x, z - L0, L1 - 1 - z);
    m.set(x, ay + 2, z, e === 0 ? ROLL : SAND_D(x, ay + 2, z));
    m.set(x, ay + 3, z, e === 0 ? (((x + z) & 1) ? GORGE : GORGE_L) : SAND_D(x, ay + 3, z));
  }
  const ROOFDECK = (x, y, z) => { const c = pick(hash3(x >> 1, y, z >> 1, 77), [0xc9b593, 0xc2ae8b, 0xcdb998]); return ((x - K0) % 6 === 4 || (z - L0) % 6 === 4) ? shade(c, 0.9) : c; };
  for (let x = K0 - 1; x <= K1; x++) for (let z = L0 - 1; z <= L1; z++) {
    const e = Math.min(x - K0 + 1, K1 - x, z - L0 + 1, L1 - z);
    m.set(x, ay + 4, z, e === 0 ? shade(((x + z) & 1) ? GORGE : GORGE_L, 0.84) : SAND_D(x, ay + 4, z));
    m.set(x, ay + 5, z, e === 0 ? LIP(x, ay + 5, z) : e === 1 ? TEAM : ROOFDECK(x, ay + 5, z));
  }
  // a low parapet step round the deck, inside the team line
  for (let x = K0 + 1; x < K1 - 1; x++) for (let z = L0 + 1; z < L1 - 1; z++) {
    const e = Math.min(x - K0 - 1, K1 - 2 - x, z - L0 - 1, L1 - 2 - z);
    if (e === 1) m.set(x, ay + 6, z, LIP(x, ay + 6, z));
  }
  // the god statue on its plinth at the front left (on tier 1)
  const G = {
    // crook and flail held to the chest (no tall sceptre: from above it read as a banner pole)
    // dark stone and gold like the Monuments (a gilt body read as sand in the sun)
    ra: { head: 'falcon', crown: 'disc', arms: 'crossed', skin: BASALT, kilt: GILT },
    isis: { head: 'human', crown: 'horns', arms: 'wings', skin: BASALT, kilt: GILT, pose: 'dress' },
    set: { head: 'jackal', crown: 'set', arms: 'crossed', skin: BASALT, kilt: GILT },
  }[god];
  // stout (h 30: the body reads as a statue from the RTS camera, not a pole),
  // the team colour only as a dark apron, not a bright banner-like panel
  fineStatue(m, 2, 30, 11, 38, 4, 7, { h: 30, gold: GILT_L, kiltFront: TEAM, pose: 'stride', ...G }, 2);
  pottedPalm(m, 33, 4, 35);
  // the temple's second tall element: a pair of limestone obelisks at the
  // ramp foot on stepped bases, smoothly tapering, gold pyramidions
  for (const ox of [10, 28]) smallObelisk(m, ox + 1, 43, 1, 20);
  return m;
}

// Barracks (5 x 5; building_09): thick, steeply battered ranges round an open
// drill yard, a raised two-step gatehouse with a latticed door, and the
// barracks' colour: tall team banners on poles at the yard piers and on the
// gatehouse, two weapon racks of spears, cowhide shields on the walls, a
// practice dummy, an archery butt, barrels.
function barracks() {
  const W = 40;
  const m = lot(W, W, EARTH);
  patch(m, 11, 15, 33, 38, EARTH, { seed: 5 });
  // back range, west range, a lower east range
  const RNG = { wall: OCHRE_P, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null };
  const tb = block(m, 2, 2, 38, 14, 1, 12, RNG);
  const tw = block(m, 2, 13, 12, 36, 1, 11, RNG);
  const te = block(m, 30, 13, 38, 28, 1, 9, RNG);
  barracksRoofs(m, tb, tw, te);
  // the raised gatehouse in the middle of the back range
  const tg = block(m, 14, 6, 27, 17, 1, 16, { wall: LIME, roofC: ROOFTILE, rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2], lipOut: 2, batter: 5, band: 'lapis', frieze: 1 });
  block(m, 17, 8, 24, 14, tg - 1, 4, { batter: 0, band: null });
  door(m, '+z', 18, 5, 1, 9, { lattice: true, sun: false, deep: 3 });
  // the yard's front: a pylon gateway (two battered pylons, a gate block
  // between them under a lintel with a cavetto cornice and a gilt winged sun,
  // heavy cedar double doors with bronze straps set in the doorway)
  const PY = { wall: OCHRE_P, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 7, band: 'red' };
  for (const [x0, x1] of [[5, 16], [25, 36]]) {
    block(m, x0, 28, x1, 38, 1, 21, PY);
    // two vertical flagpole niches cut into the front face (a shadowed slot
    // following the batter), the team banner's pole standing in the outer one
    for (const u of [x0 + 2, x1 - 3]) {
      for (let y = 2; y < 17; y++) {
        const q = outer(m, '+z', u, y, lim(m));
        if (!q) continue;
        m.remove(q[0], q[1], q[2]);
        m.set(q[0], q[1], q[2] - 1, y === 2 ? 0x6e5236 : 0x86643e);
      }
      if (u === (x0 < 20 ? x0 + 2 : x1 - 3)) banner(m, u, 1, 38, 31);
    }
    // an incised relief between the niches: a striding figure with a raised
    // arm (a king smiting) cut in a darker sand, a white crown and a red kilt
    const mid = Math.floor((x0 + x1) / 2) - 2;
    // a dressed panel (smooth pale sandstone inside a dark incised frame) so
    // the figure reads as a carved relief, not a stain in the masonry
    const fig = ['.L...', '.LL.D', '.DD.D', 'DDDDD', '.DD..', '.DD..', '.RR..', '.RRR.', '.D.D.', 'D...D', 'D...D'];
    const panel = ['FFFFFFF'];
    for (const r of fig) panel.push('F' + r.replace(/\./g, 'P') + 'F');
    panel.push('FFFFFFF');
    paint(m, '+z', mid - 1, 17, panel, { L: 0xf1e8d2, D: 0x7a4a2a, R: RED_M, P: 0xddb37c, F: 0x9a6a3a });
  }
  // link walls from the pylons back to the ranges
  block(m, 30, 27, 38, 32, 1, 9, { wall: OCHRE_P, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  // the gate block: limestone, its own cornice (the lintel's cavetto) a step
  // below the pylons' tops
  block(m, 15, 32, 26, 38, 1, 18, { wall: LIME, roofC: ROOFTILE, rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2], lipOut: 2, batter: 0, band: 'lapis' });
  // close the slot the pylons' batter opens beside the gate block (their
  // inner faces stand flush against it up to its cornice), so no dark wedge
  // of stepped voxels shows between a pylon and the gate
  for (let y = 1; y < 20; y++) for (const x of [13, 14, 26, 27]) for (let z = 30; z < 38; z++) {
    const ins = Math.floor((y - 1) / 7);
    if (z > 37 - ins || m.get(x, y, z)) continue;
    if ((x < 20 ? m.get(x - 1, y, z) || m.get(x + 1, y, z) : m.get(x + 1, y, z) || m.get(x - 1, y, z))) m.set(x, y, z, OCHRE_P(x, y, z));
  }
  door(m, '+z', 17, 7, 1, 9, { deep: 1, frame: LIME, sun: false });
  // the cedar leaves: vertical planks, a dark meeting seam, bronze straps
  // with rivets every third course
  const CEDAR = [0x9c5a32, 0x8a4c2a];
  for (let x = 17; x < 24; x++) for (let y = 1; y < 10; y++) {
    const q = outer(m, '+z', x, y, lim(m));
    if (!q) continue;
    let c = CEDAR[x & 1];
    if (x === 20) c = REVEAL2;
    else if (y === 2 || y === 3 || y === 6 || y === 7) c = (x === 18 || x === 22) && (y === 3 || y === 7) ? 0x8f6a2c : 0xe0b452;
    m.set(q[0], q[1], q[2], c);
  }
  // the winged sun disc on the lintel face, spanning the gate
  paint(m, '+z', 15, 15, ['GLLLRRRLLLG', 'TTLLRRRLLTT', '.TTTGGGTTT.', '...TTGTT...'], { G: GILT, L: LAPIS, T: TURQ, R: RED });
  // in the yard: barrels and a shield stand by the walls, a practice dummy,
  // an archery butt
  barrel(m, 14.5, 1, 20.5, 5, 1.7); barrel(m, 14.5, 1, 24.5, 5, 1.7);
  crate(m, 26, 1, 18, 3, 3, 3);
  dummy(m, 18, 26);
  lathe(m, 27.5, 23.5, 1, 6, () => 2.2, (x, y, z) => (y === 3 ? RED : THATCH(x, y, z)));
  return m;
}

// The Barracks' roof decks are not empty tile grids: a raised clerestory
// strip on the back range either side of the gatehouse (a pale-lipped
// ochre clerestory with dark light slots between piers), a stairwell hut with
// a dark doorway on the west range, a striped sunshade on poles over jars
// and a basket on the east range, storage jars by the clerestory.
function barracksRoofs(m, tb, tw, te) {
  const CL = { wall: OCHRE_P, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, band: null, plinth: false, socle: 0, rim: false, cornice: false };
  // the clerestory: a long narrow raised strip down the back range's spine,
  // dark light slots between piers along both long faces
  for (const [x0, x1] of [[4, 14], [27, 37]]) {
    block(m, x0, 6, x1, 10, tb, 3, CL);
    for (let x = x0 + 1; x < x1 - 1; x += 2) for (let y = tb; y < tb + 2; y++) {
      m.set(x, y, 9, REVEAL); m.set(x, y, 6, REVEAL);
    }
  }
  sack(m, 6, tb, 11); goodsBox(m, 31, tb, 11, 3, 2, 'grain', 2);
  // the stairwell hut on the west range, its dark doorway to the yard
  block(m, 4, 19, 9, 24, tw, 5, CL);
  for (let z = 20; z < 22; z++) for (let y = tw; y < tw + 4; y++) { m.set(8, y, z, REVEAL); m.set(7, y, z, REVEAL2); }
  for (let z = 19; z < 23; z++) m.set(9, tw + 4, z, LIME(9, tw + 4, z));
  crate(m, 6, tw, 28, 3, 3, 3); sack(m, 5, tw, 32);
  // a striped sunshade on four poles over the east range's deck, goods under it
  const sy = te + 5;
  for (const [px, pz] of [[31, 16], [36, 16], [31, 25], [36, 25]]) for (let y = te; y < sy + (pz === 16 ? 1 : 0); y++) m.set(px, y, pz, POLE(px, y, pz));
  for (let x = 30; x < 38; x++) for (let z = 15; z < 27; z++) {
    const y = sy + (z < 21 ? 1 : 0);
    const st = (x >> 1) & 1 ? CANVAS_T : CANVAS;
    m.set(x, y, z, st[(x + z) % st.length]);
  }
  for (let x = 30; x < 38; x++) if (x & 1) m.set(x, sy - 1, 26, CANVAS_HEM);
  goodsBox(m, 32, te, 18, 3, 3, 'grain', 2); sack(m, 32, te, 22); crate(m, 34, te, 22, 2, 2, 2);
}

// Migdol Stronghold (6 x 6; building_10): a tall battered square limestone
// keep with a tiled roof inside a team rim, four taller corner turrets with
// L-shaped team rims, groups of slit windows, a projecting gate front with a
// deep gate, a gilt winged scarab over it, latticed windows, a cart wheel.
function migdol() {
  const N = 56;
  const m = lot(N, N);
  patch(m, 4, 4, 52, 56, PAVE, { seed: 6 });
  const top = block(m, 8, 7, 48, 47, 1, 34, { wall: LIME, batter: 7, band: 'team', frieze: 1, roofC: ROOFTILE });
  // a stepped crown on the roof
  block(m, 16, 15, 40, 39, top - 1, 2, { wall: LIME, roofC: ROOFTILE, band: null, rim: false });
  // the corner turrets
  const TS = 12;
  for (const [x, z] of [[3, 2], [N - 3 - TS, 2], [3, 52 - TS], [N - 3 - TS, 52 - TS]]) {
    const tt = block(m, x, z, x + TS, z + TS, 1, 39, { wall: LIME, batter: 12, band: 'team', frieze: 1, roofC: ROOFTILE, rim: true });
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
    // the stronghold's colour: a team pennant on each front turret
    if (!north) banner(m, x + TS / 2, tt - 1, z + TS / 2, 12, '+z');
  }
  // slit windows on the keep between the turrets
  for (const face of ['+x', '-z', '-x']) for (const u of [19, 22, 34, 37]) slit(m, face, u, 27, 5, 1);
  // the gate front: a projecting battered block with the deep gate
  block(m, 17, 44, 39, 52, 1, 26, { wall: LIME, band: 'team', frieze: 1, roofC: ROOFTILE, batter: 9 });
  door(m, '+z', 24, 8, 1, 14, { sun: false });
  paint(m, '+z', 23, 21, ['GGG...R...GGG', '.GGGG.R.GGGG.', '...GGGGGGG...', '.....G.G.....'], { G: GILT, R: RED });
  for (const px of [19, 36]) for (let y = 4; y < 22; y += 3) slit(m, '+z', px, y, 1, 1, { lintel: false, sill: false });
  // latticed windows on the keep's front, either side of the gate block
  for (const wx of [11, 14, 41, 44]) for (let y = 14; y < 24; y++) for (let i = 0; i < 2; i++) {
    const p = outer(m, '+z', wx + i, y, lim(m));
    if (p) m.set(p[0], p[1], p[2], ((y + i) & 1) ? 0x6e4a2c : DARK);
  }
  wheel(m, 15, 1, 54, 3, 'z');
  return m;
}

// A pylon tower (pylon()): a battered block whose slope is one clean voxel
// step every `b` rows under the smooth skin, a round torus moulding up every
// corner and along the top, a curved cavetto flaring `lipOut` voxels out to a
// pale lip with the team line inside a one-voxel parapet over a recessed
// roof deck. The voxel gorge rows block() lays are cut away (the skin draws
// the curve over the wall's top). Returns the deck's y + 1.
function pylon(m, x0, z0, x1, z1, h, { wall = SAND, b = 9, band = 'team', gorge = [GORGE, GORGE_L], lipOut = 3, roofC = PLASTER, frieze = 0 } = {}) {
  block(m, x0, z0, x1, z1, 1, h, { wall, batter: b, band, lipOut, flare: true, gorge, torus: true, rimC: LIME, roofC, frieze });
  const B = m.blocks[m.blocks.length - 1];
  B.cav = { lipOut, gorge }; B.roll = true;
  const top = 1 + h, K = Math.floor((h - 1) / b);
  const a0 = x0 + K, a1 = x1 - K, b0 = z0 + K, b1 = z1 - K;
  for (let y = top; y <= top + 1; y++) for (let x = a0 - lipOut; x < a1 + lipOut; x++) for (let z = b0 - lipOut; z < b1 + lipOut; z++) {
    if (x < a0 || x >= a1 || z < b0 || z >= b1) m.remove(x, y, z);
  }
  // the lip: pale, its edge row a voxel higher as a parapet, the team line
  // inside it on the deck
  const T = m.lastTop;
  for (let x = T.c0; x < T.c1; x++) for (let z = T.d0; z < T.d1; z++) {
    const e = Math.min(x - T.c0, T.c1 - 1 - x, z - T.d0, T.d1 - 1 - z);
    if (e === 0) { m.set(x, T.y, z, LIME); m.set(x, T.y + 1, z, LIP); }
    else if (e === 1) m.set(x, T.y, z, LIME_S);
    else if (e === 2) m.set(x, T.y, z, TEAM);
  }
  return T.y + 2;
}
// a relief panel sunk one voxel into a face: rows (top first) of palette
// keys, '.' the panel's dressed ground, framed by a dark incised border; on a
// battered face the skin draws it as a clean recessed field with reveals
function recessPanel(m, face, u0, yTop, rows, pal, { ground = 0xe2c999, frame = 0x8f6a40 } = {}) {
  const dir = face === '+z' || face === '-x' ? 1 : -1;
  const n = OUT_N[face];
  const w = rows[0].length;
  const R = frame === null ? rows : ['F'.repeat(w + 2), ...rows.map((r) => 'F' + r + 'F'), 'F'.repeat(w + 2)];
  R.forEach((row, j) => {
    const y = yTop - j;
    for (let i = 0; i < row.length; i++) {
      const p = outer(m, face, u0 + i * dir, y, lim(m));
      if (!p) continue;
      const q = [p[0] - n[0], p[1], p[2] - n[2]];
      if (!m.has(...q)) continue;
      m.remove(p[0], p[1], p[2]);
      const ch = row[i];
      m.set(q[0], q[1], q[2], ch === '.' ? ground : ch === 'F' ? frame : pal[ch]);
    }
  });
}
const RELIEF = { L: 0xf1e8d2, D: 0x6e4226, R: RED_B, G: GILT_D, B: LAPIS, O: OCHRE_M };
// a lioness-headed goddess (Sekhmet, who keeps the siege engines) striding
// with a sceptre; a blue ankh; a column of glyphs (sun, water, reed)
const PANEL_GOD = ['......', '..OO..', '.OOO..', '..OB..', '.BDDB.', '.DDDDG', 'D.DD.G', 'D.RR.G', '..RR.G', '..RR.G', '..D.DG', '.D..DG', '.D..D.', '......'];
const PANEL_ANKH = ['......', '..BB..', '.B..B.', '.B..B.', '..BB..', 'BBBBBB', '..BB..', '..BB..', '..BB..', '..BB..', '..BB..', '.BBBB.', '......'];
const PANEL_GLYPH = ['.RR.', 'RRRR', '.RR.', '....', 'B.B.', '.B.B', '....', '.D..', '.DD.', '.D..'];

// Siege Works (7 x 7; building_11): two flat-roofed stone pylon towers, the
// front one stepped forward and to the side (they never touch), each a clean
// battered block with torus corners, a curved cavetto, a parapet over the
// team line, sunk relief panels, a lotus
// frieze low round both; a limestone gate block projects from the front
// tower with its own cornice, a tall framed doorway under a lintel and a
// winged sun, its path clear; a long striped awning from the back tower down
// onto a colonnade of square pillars with painted feet, whose roof has a
// cornice lip and parapet; wheels, barrels, crates and a catapult arm.
function siegeWorks() {
  const W = 56;
  const m = lot(W, W);
  patch(m, 4, 24, 54, 55, EARTH, { seed: 7 });
  const SW = coursed([0xeadcbc, 0xdccaa4, 0xe4d4b2], { len: 8, bed: 0.9, seed: 13 });
  const LOTUS = [(x, y, z) => RED_M, (x, y, z) => { const u = (x + z) % 4; return u === 0 ? FRIEZE_SEP : u === 2 ? GREENP : LAPIS; }, (x, y, z) => RED_M];
  // the back tower (taller) and the front tower
  const tA = pylon(m, 6, 3, 26, 21, 30, { wall: SW });
  const tB = pylon(m, 29, 24, 54, 42, 26, { wall: SW });
  bands(m, 6, 3, 26, 21, 9, LOTUS);
  bands(m, 29, 24, 54, 42, 9, LOTUS);
  // relief panels on every face
  recessPanel(m, '+x', 16, 27, PANEL_GOD, RELIEF);                 // back tower east
  recessPanel(m, '+z', 17, 22, PANEL_GLYPH, RELIEF);               // back tower front, beside the awning
  recessPanel(m, '-x', 8, 27, PANEL_ANKH, RELIEF);
  recessPanel(m, '-z', 19, 27, PANEL_ANKH, RELIEF);
  // a pair of tall flagpole niches either side of the gate, cut through the
  // frieze
  for (const u of [33, 49]) recessPanel(m, '+z', u, 24, Array(21).fill('..'), RELIEF, { ground: 0xb39466, frame: null });
  recessPanel(m, '+x', 37, 24, PANEL_ANKH, RELIEF);                // front tower east
  recessPanel(m, '-z', 45, 24, PANEL_GOD, RELIEF);
  recessPanel(m, '-x', 29, 24, PANEL_GOD, RELIEF);
  // the roof decks: a stair hatch with a dark opening on each
  for (const [hx, hz, ty] of [[10, 7, tA - 1], [44, 28, tB - 1]]) {
    block(m, hx, hz, hx + 6, hz + 5, ty, 4, { wall: SW, batter: 0, band: null, lipOut: 1, rim: false, rimC: LIME, plinth: false, socle: 0, torus: false, roofC: PLASTER });
    for (let y = ty; y < ty + 3; y++) for (let x = hx + 2; x < hx + 4; x++) m.set(x, y, hz + 5 - 1, REVEAL);
  }
  // the gate block before the front tower: limestone, its own cornice a
  // step below the tower's, a lapis band, the tall doorway framed by jambs
  // and a lintel, a winged sun over it
  block(m, 38, 37, 46, 45, 1, 19, { wall: LIME, batter: 0, lipOut: 2, band: 'lapis', rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2], roofC: PLASTER });
  door(m, '+z', 40, 4, 1, 12, { deep: 3, frame: SAND, lintel: true });
  paint(m, '+z', 38, 17, ['GLLLRLLLG', '.TTLRLTT.', '...TGT...'], { G: GILT, L: LAPIS, T: TURQ, R: RED });
  // the colonnade at the front left: square pillars with painted feet under
  // an architrave, a cavetto row and a lip with a parapet
  const cy = 14;
  const colsAt = [[3, 47], [9, 47], [15, 47], [3, 41], [3, 35], [3, 29], [9, 29], [15, 29]];
  for (const [x, z] of colsAt) {
    for (let y = 1; y < cy; y++) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
      const c = y < 4 ? (y === 3 ? OCHRE : GREENP) : y === 4 ? RED_M : y >= cy - 2 ? (y === cy - 1 ? LIME_S : LAPIS) : LIME(x + i, y, z + k);
      m.set(x + i, y, z + k, c);
    }
  }
  const [r0x, r1x, r0z, r1z] = [2, 19, 28, 51];
  for (let x = r0x - 2; x < r1x + 2; x++) for (let z = r0z - 2; z < r1z + 2; z++) {
    const e = Math.min(x - r0x, r1x - 1 - x, z - r0z, r1z - 1 - z);      // -2 .. at the lip, 0 the architrave's edge
    if (e >= 0) m.set(x, cy, z, e === 0 ? FRIEZE[(x + z) % FRIEZE.length] : LIME_S);
    if (e >= -1) m.set(x, cy + 1, z, e === -1 ? (((x + z) & 1) ? GORGE : GORGE_L) : SAND_D(x, cy + 1, z));
    m.set(x, cy + 2, z, e === -2 ? LIME : e === -1 ? LIME_S : e === 0 ? TEAM : PLASTER(x, cy + 2, z));
    if (e === -2) m.set(x, cy + 3, z, LIP);
  }
  // the long striped awning from the back tower's front down onto the
  // colonnade's parapet
  clothAwning(m, '+z', 18, 9, 17, 24, 9, 6, { sw: 1, stripes: [CANVAS_T, CANVAS, CANVAS], sag: 0.8, ground: cy + 3, posts: [9, 16] });
  // the yard: wheels, barrels, crates, a catapult arm; the gate's path clear
  wheel(m, 24, 1, 34, 4, 'x'); wheel(m, 51, 1, 48, 3, 'z'); wheel(m, 25, 1, 44, 3, 'x');
  barrel(m, 31.5, 1, 47.5, 5, 1.8); barrel(m, 52.5, 1, 52.5, 5, 1.8); barrel(m, 12.5, 1, 38.5, 5, 1.7);
  crate(m, 8, 1, 33, 3, 3, 3); crate(m, 21, 1, 49, 3, 3, 3); crate(m, 21, 4, 49, 3, 2, 3, 0xa27c48);
  m.line(26, 1, 53, 35, 6, 53, 0x7a5230); m.line(26, 2, 53, 35, 7, 53, 0x7a5230); m.line(26, 1, 54, 35, 6, 54, 0x7a5230);
  lathe(m, 36, 53.5, 6, 9, (y) => 2.2 - (y - 6) * 0.4, 0x6e4a2c, { hollow: 0.8, inner: 0x5a3b22 });
  void tA; void tB;
  return m;
}

// Obelisk (1 x 1, drawn over 1.5 x 1.5 like the sentry tower; building_12):
// a landmark read at a glance. A stepped plinth: a dark base course and a
// 10-wide sandstone tier with a limestone tread, an 8-wide tier carrying a
// painted hieroglyph band, a fluted cavetto row and a limestone cornice lip
// overhanging it by a voxel (a team line round its top), a limestone die.
// On it the shaft: one smoothly tapering square needle (a battered block
// under skin(), 6 voxels wide at the foot, ~3 at the top) in coursed
// sandstone, a team ring at its foot, a deep gold recessed panel down each
// face carved with registers of lapis / dark gold hieroglyphs, a gilt trim
// band where the panels stop, a second under the tip, and a clean smooth
// electrum pyramidion.
// deep golds: under the sun's tonemapping a pale gilt washes out to sand, so
// the obelisk's gold is a saturated, darker leaf (lit faces still read gold)
const OB_GOLD = 0xd6aa00, OB_GOLD_L = 0xf4cc00, OB_GOLD_D = 0x8e6800, OB_PANEL = 0xe6b800, OB_INK = 0x3a2606;
function obelisk() {
  const m = lot(12, 12, SANDGROUND);
  const ring = (y, a, b, f) => { for (let x = a; x < b; x++) for (let z = a; z < b; z++) m.set(x, y, z, f(x, z, Math.min(x - a, b - 1 - x, z - a, b - 1 - z))); };
  // the plinth: two tiers and a cornice lip
  ring(1, 1, 11, (x, z) => PLINTH(x, 1, z));
  ring(2, 1, 11, (x, z) => SAND(x, 2, z));
  ring(3, 1, 11, (x, z, e) => (e === 0 ? LIME(x, 3, z) : SAND_D(x, 3, z)));
  ring(4, 2, 10, (x, z) => SAND(x, 4, z));
  // the hieroglyph band: cartouche-like panels of lapis and red signs on ochre between pale frames
  const HB = [LIME_S, OCHRE_M, LAPIS, OCHRE_M, RED_M, OCHRE_M, LAPIS, LIME_S];
  ring(5, 2, 10, (x, z, e) => (e === 0 ? HB[(x === 2 || x === 9) ? z - 2 : x - 2] : SAND_D(x, 5, z)));
  ring(6, 2, 10, (x, z, e) => (e === 0 ? (((x + z) & 1) ? GORGE : GORGE_L) : SAND_D(x, 6, z)));
  ring(7, 1, 11, (x, z, e) => (e === 1 ? TEAM : LIP(x, 7, z)));
  ring(8, 3, 9, (x, z) => LIME(x, 8, z));
  // the shaft: voxels x/z 4..8 to y 28, 5..7 above, skinned as one taper
  const Y0 = 9, H = 28, B = 20, TOP = Y0 + H;
  m.blocks.push({ x0: 4, z0: 4, x1: 8, z1: 8, y0: Y0, h: H, b: B, base: 0 });
  const P0 = 11, P1 = 27;           // the recessed panels' rows
  const glyph = (x, y, z) => {
    const r = (y - P0) % 4;
    if (r === 0) return OB_GOLD_D;                                      // the register rule
    const g = Math.floor((y - P0) / 4), s = (x + z) & 1;
    const sign = [[1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1]][g % 4];
    return sign[r - 1] && ((r + s + g) & 1) ? (g & 1 ? LAPIS : OB_INK) : OB_PANEL;
  };
  for (let y = Y0; y < TOP; y++) {
    const k = y - Y0 >= B ? 1 : 0;
    const a = 4 + k, b = 8 - k;
    for (let x = a; x < b; x++) for (let z = a; z < b; z++) {
      const core = x > a && x < b - 1 && z > a && z < b - 1;
      const panel = k === 0 && y >= P0 && y < P1;
      if (panel && !core && !((x === a || x === b - 1) && (z === a || z === b - 1))) continue;   // cut: the recess
      let c;
      if (core) c = panel ? glyph(x, y, z) : SAND_D(x, y, z);
      else if (y === Y0) c = TEAM;
      else if (y === P1 || y === TOP - 2) c = OB_GOLD;
      else c = SAND(x, y, z);
      m.set(x, y, z, c);
    }
  }
  // the pyramidion: an electrum voxel core under a smooth four-sided cap
  for (let x = 5; x < 7; x++) for (let z = 5; z < 7; z++) m.set(x, TOP, z, OB_GOLD);
  const hw = 2 + 1 - H / B, cx = 6, cz = 6, ap = [cx, TOP + 3.4, cz];   // hw: the skin's half-width at TOP
  const sq = [[cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw]];
  const lit = [OB_GOLD_L, OB_GOLD, OB_GOLD, OB_GOLD_L];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = sq[i], [bx, bz] = sq[(i + 1) % 4];
    const mx = (ax + bx) / 2 - cx, mz = (az + bz) / 2 - cz;
    poly(m, [[ax, TOP, az], [bx, TOP, bz], ap], lit[i], { out: [mx, 0.6, mz] });
  }
  poly(m, sq.map(([x, z]) => [x, TOP, z]), OB_GOLD_D, { out: [0, -1, 0] });
  return m;
}

// a small processional obelisk (the temple's ramp pair, the wonder's door
// pair): a stepped two-tier base, a 2 x 2 voxel shaft skinned as one smooth
// taper (4 voxels at the foot to ~1.5 under the tip) with a team ring at the
// foot and a gold band under the tip, and a smooth gold pyramidion. (cx, cz):
// the shaft's centre (a voxel corner).
function smallObelisk(m, cx, cz, y0, h = 20) {
  m.box(cx - 3, y0, cz - 3, 6, 1, 6, SAND_D);
  m.box(cx - 2, y0 + 1, cz - 2, 4, 1, 4, LIME);
  const Y0 = y0 + 2, B = 16, TOP = Y0 + h;
  m.blocks.push({ x0: cx - 1, z0: cz - 1, x1: cx + 1, z1: cz + 1, y0: Y0, h, b: B, base: 0 });
  for (let y = Y0; y < TOP; y++) for (let x = cx - 1; x < cx + 1; x++) for (let z = cz - 1; z < cz + 1; z++) {
    m.set(x, y, z, y === Y0 ? TEAM : y === TOP - 2 ? OB_GOLD : LIME(x, y, z));
  }
  const hw = 1 + 1 - h / B, ap = [cx, TOP + 2.2, cz];
  const sq = [[cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw]];
  const lit = [OB_GOLD_L, OB_GOLD, OB_GOLD, OB_GOLD_L];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = sq[i], [bx, bz] = sq[(i + 1) % 4];
    poly(m, [[ax, TOP, az], [bx, TOP, bz], ap], lit[i], { out: [(ax + bx) / 2 - cx, 0.6, (az + bz) / 2 - cz] });
  }
  poly(m, sq.map(([x, z]) => [x, TOP, z]), OB_GOLD_D, { out: [0, -1, 0] });
}

// Monuments (building_13..17): dark basalt statues with gold regalia on
// black-and-gold plinths. 1 to Villagers (kneeling with an offering bowl),
// 2 to Soldiers (Osiride: mummiform, crook and flail), 3 to Priests (striding
// in a nemes), 4 to Pharaohs (a king and queen), 5 to the Gods (falcon Ra,
// jackal Set, winged Isis; Eye of Horus panels and glowing sun bowls at the
// corners). Modelled at half voxels (1/16 tile: `fine: 2` in TYPES) so the
// statues get snouts, pointed ears, a striped nemes and crossed regalia.
// Each plinth face carries a raised gold cartouche (limestone field, lapis and
// red signs, the shen bar under it); the owner's colour runs as one line
// under the cornice.
const CART_GLYPHS = [
  ['.r.', 'rrr', '.r.'],               // the sun disc
  ['.b.', 'b.b', '.b.', 'bbb', '.b.'], // an ankh
  ['b.b', '.b.'],                      // water
  ['k.k', 'kkk', '.k.'],               // a scarab
  ['.b.', 'bb.', '.b.', '.b.'],        // a reed
];
// a voxel on face f of the box [x0, x1) x [z0, z1): a = along the face (left
// to right seen from outside), out = 0 the face itself, 1 one voxel proud
function faceXZ(f, x0, z0, x1, z1, a, out) {
  if (f === '+z') return [x0 + a, z1 - 1 + out];
  if (f === '-z') return [x1 - 1 - a, z0 - out];
  if (f === '+x') return [x1 - 1 + out, z1 - 1 - a];
  return [x0 - out, z0 + a];
}
// a raised cartouche centred at a0 (along the face), rows r0 .. r0 + ch
function cartouche(m, f, x0, z0, x1, z1, y0, a0, r0, cw, ch, seed = 0) {
  const at = (a, r, c, out = 1) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, out); m.set(x, y0 + r, z, c); };
  const ax = a0 - (cw - 1) / 2;
  // the shen bar it stands on
  for (let i = -1; i <= cw; i++) at(Math.round(ax + i), r0, SG_D);
  // a tall oval: straight sides, rounded ends two rows deep
  const rad = (cw - 1) / 2, top = r0 + ch, ry = 2.2, cyT = top - ry + 0.5, cyB = r0 + 1 + ry - 0.5;
  for (let r = r0 + 1; r <= top; r++) for (let i = 0; i < cw; i++) {
    const du = (i - rad) / (rad + 0.45);
    const dv = r > cyT ? (r - cyT) / ry : r < cyB ? (cyB - r) / ry : 0;
    const d = Math.hypot(du, dv);
    if (d > 1) continue;
    const edge = i === 0 || i === cw - 1 || r === top || r === r0 + 1 || Math.hypot((i - rad) / (rad - 0.55), dv * ry / (ry - 0.9)) > 1;
    at(Math.round(ax + i), r, edge ? SG_L : 0xe8dcb8);
  }
  // signs stacked down the field
  let r = top - 2, k = seed;
  for (let n = 0; n < 6; n++) {
    const g = CART_GLYPHS[k % CART_GLYPHS.length];
    if (r - g.length + 1 < r0 + 2) break;
    g.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch2 = row[i]; if (ch2 === '.') continue;
        at(Math.round(ax + (cw - row.length) / 2 + i), r - j, ch2 === 'r' ? ST_RED : ch2 === 'b' ? ST_LAPIS : 0x2a2420);
      }
    });
    r -= g.length + 1; k += 2;
  }
}
// the Eye of Horus in gold inside a framed panel, flush on the face
function eyePanel(m, f, x0, z0, x1, z1, y0, a0, r0) {
  const EYE = [
    '....GGGGGGGG....',
    '..GG........GG..',
    '.G...LLLLL....G.',
    'GGGGGLLKKLLGGGGG',
    '.....LLLLL......',
    '......G...G.....',
    '.....G.....G....',
    '....G.......GG..',
  ];
  const at = (a, r, c) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, 0); m.set(x, y0 + r, z, c); };
  const W = EYE[0].length + 4, H = EYE.length + 4;
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    const a = a0 - W / 2 + i;
    const edge = i === 0 || j === 0 || i === W - 1 || j === H - 1;
    let c = edge ? SG : 0x1e242c;
    const ch = (EYE[H - 3 - j] || '')[i - 2];
    if (!edge && ch && ch !== '.') c = ch === 'K' ? 0x141414 : ch === 'L' ? ST_WHITE : SG_L;
    at(Math.round(a), r0 + j, c);
  }
}
// a black granite plinth in Retold's manner, drawn as a few clean courses: a
// foot course one voxel proud, a smooth granite body with a band of gold
// hieroglyphs on a lapis ground sunk a voxel into every face (or an Eye of
// Horus panel), the owner's colour as one continuous line under a gold torus
// roll, then a cavetto cornice flaring out two voxels in two fluted rows
// (gold / granite flutes in a regular rhythm) to a gold-edged lip. Returns the
// deck top.
const PL_GRAN = 0x2b313a, PL_GRAN_D = 0x22272f;
const BAND_GLYPHS5 = [
  ['.g.', 'g.g', '.g.', 'ggg', '.g.'],   // ankh
  ['ggg', '.g.', 'ggg', '.g.', '.g.'],   // djed
  ['gg.', '.g.', '.g.', '.g.', 'g.g'],   // was sceptre
  ['...', 'ggg', 'g.g', 'ggg', '...'],   // sun disc
];
const BAND_GLYPHS3 = [['ggg', 'g.g', 'ggg'], ['.g.', '.g.', '.g.']];
function glyphBand(m, f, x0, z0, x1, z1, y0, r0, r1, seed = 0) {
  // sunk band over rows r0 .. r1 (inclusive), a = 2 .. L - 3 along the face
  const L = f === '+z' || f === '-z' ? x1 - x0 : z1 - z0;
  const at = (a, r, c, out) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, out); m.set(x, y0 + r, z, c); };
  const rem = (a, r) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, 0); m.remove(x, y0 + r, z); };
  const a0 = 2, a1 = L - 3, rows = r1 - r0 + 1;
  const G = rows - 2 >= 5 ? BAND_GLYPHS5 : BAND_GLYPHS3, gh = G[0].length;
  const n = Math.max(1, Math.floor((a1 - a0 + 1 - 1) / 4)), span = n * 4 - 1;
  const ga = a0 + Math.floor((a1 - a0 + 1 - span) / 2), gr = r0 + Math.floor((rows - gh) / 2);
  for (let a = a0; a <= a1; a++) for (let r = r0; r <= r1; r++) {
    rem(a, r);
    let c = ST_LAPIS;
    const i = a - ga, j = r - gr;
    if (i >= 0 && i < span && (i % 4) < 3 && j >= 0 && j < gh) {
      const g = G[(Math.floor(i / 4) + seed) % G.length];
      if (g[gh - 1 - j][i % 4] === 'g') c = SG_L;
    }
    at(a, r, c, -1);
  }
}
function monPlinth(m, x0, z0, x1, z1, y0, h, { faces = {}, seed = 0 } = {}) {
  const rTeam = h - 4, rTorus = h - 3;
  // the foot course, one voxel proud
  for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) m.set(x, y0, z, PL_GRAN_D);
  // the body: solid granite, the owner's line, the torus roll
  for (let r = 1; r < rTorus; r++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const edge = x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1;
    m.set(x, y0 + r, z, !edge ? DARK2 : r === rTeam ? TEAM : PL_GRAN);
  }
  for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) m.set(x, y0 + rTorus, z, SG);
  // the cavetto: two fluted rows flaring out one then two voxels, a gold lip
  for (const [r, o] of [[h - 2, 1], [h - 1, 2], [h, 2]]) {
    for (let x = x0 - o; x < x1 + o; x++) for (let z = z0 - o; z < z1 + o; z++) {
      const ring = x === x0 - o || x === x1 + o - 1 || z === z0 - o || z === z1 + o - 1;
      if (r === h) { m.set(x, y0 + r, z, ring ? SG_L : x === x0 - o + 1 || x === x1 + o - 2 || z === z0 - o + 1 || z === z1 + o - 2 ? SG : PL_GRAN); continue; }
      if (!ring) { m.set(x, y0 + r, z, PL_GRAN); continue; }
      const a = x === x0 - o || x === x1 + o - 1 ? z - z0 : x - x0;   // position along the face
      const corner = (x === x0 - o || x === x1 + o - 1) && (z === z0 - o || z === z1 + o - 1);
      m.set(x, y0 + r, z, corner ? SG : ((a % 3) + 3) % 3 === 0 ? SG : PL_GRAN);
    }
  }
  for (const f of ['+z', '-z', '+x', '-x']) {
    const L = f === '+z' || f === '-z' ? x1 - x0 : z1 - z0;
    const kind = faces[f] ?? 'band';
    if (kind === 'eye') {
      eyePanel(m, f, x0, z0, x1, z1, y0, L / 2, 2);
      if (L >= 40) for (const k of [-1, 1]) {
        // short glyph bands either side of the eye
        const a = Math.round((L - 1) / 2 + k * 15);
        glyphBandAt(m, f, x0, z0, x1, z1, y0, a - 4, a + 4, 2, rTeam - 2, seed + (k > 0 ? 1 : 0));
      }
    } else glyphBand(m, f, x0, z0, x1, z1, y0, 2, rTeam - 2, seed + f.length + (f[1] === 'x' ? 1 : 0));
  }
  return y0 + h + 1;
}
// a sunk glyph panel over a = a0 .. a1 only (beside the Eye of Horus panels)
function glyphBandAt(m, f, x0, z0, x1, z1, y0, a0, a1, r0, r1, seed) {
  const at = (a, r, c, out) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, out); m.set(x, y0 + r, z, c); };
  const rem = (a, r) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, 0); m.remove(x, y0 + r, z); };
  const rows = r1 - r0 + 1, G = BAND_GLYPHS5, gh = 5;
  const n = Math.max(1, Math.floor((a1 - a0) / 4)), span = n * 4 - 1;
  const ga = a0 + Math.floor((a1 - a0 + 1 - span) / 2);
  for (let a = a0; a <= a1; a++) for (let r = r0; r <= r1; r++) {
    rem(a, r);
    let c = ST_LAPIS;
    const i = a - ga;
    // glyphs stacked down the panel, a gap row between
    const j = (r1 - 1) - r, k = Math.floor(j / (gh + 1)), jj = j % (gh + 1);
    if (i >= 0 && i < span && (i % 4) < 3 && j >= 0 && jj < gh && r > r0) {
      const g = G[(Math.floor(i / 4) + k + seed) % G.length];
      if (g[jj][i % 4] === 'g') c = SG_L;
    }
    at(a, r, c, -1);
  }
}
// a die on the deck: a plain granite block with a 1-voxel gold edge on top
function monDie(m, x0, z0, x1, z1, y0, h) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) m.set(x, y, z, PL_GRAN);
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) m.set(x, y0 + h, z, x === x0 || z === z0 || x === x1 - 1 || z === z1 - 1 ? SG : PL_GRAN);
  return y0 + h + 1;
}
// A Monument statue built from a few large clean volumes (the Monuments to
// Villagers, Soldiers, Priests and the Pharaoh): one flat blue-black granite
// for the whole body, gold only as continuous one-voxel bands (diadem,
// collar rings, belt, armlets, bracelets) and in a striped nemes whose stripes
// run in a fixed rhythm (two gold rows, one lapis row) over the cap, the wings
// and the lappets. Axis-aligned boxes on a fixed canon (fine voxels, ~46
// high standing), so every plane is flat: a flat-faced head with a one-voxel
// nose, inlaid eyes and the false beard, a stepped torso (waist, chest,
// shoulders), arms as blocks (at the sides, crossed on the chest, or forward
// holding gold offering pots), a stepped kilt with the owner's apron. Voxels
// are marked clean so weathering leaves no speckle. (cx, cz): the body's
// centre (a voxel corner in x), facing +z, standing on y0.
// pose: stride | stand | kneel | mummy; head: nemes | double (the white and
// red crown of the Two Lands) ; arms: side | crossed | pots
const COLUMN_GLYPHS = [
  ['.gg.', 'g..g', '.gg.', 'gggg', '.gg.'],   // ankh
  ['gggg', '.gg.', 'gggg', '.gg.', '.gg.'],   // djed
  ['.gg.', 'gggg', 'gggg', '.gg.'],           // sun disc
];
const GRAN = 0x2a3039, GRAN_D = 0x1c2027, CG = 0xc89000, CG_L = 0xe0a800;
// figure()'s options in cleanStatue()'s terms (the Town Center's and the
// Temple's gods)
function toClean(o) {
  const head = o.head === 'falcon' || o.head === 'jackal' ? o.head : (o.crown ?? 'nemes') === 'nemes' ? 'nemes' : o.crown === 'tall' || o.crown === 'atef' ? 'double' : 'wig';
  const crown = o.crown === 'disc' || o.crown === 'horns' ? o.crown : o.crown === 'vulture' ? 'modius' : null;
  const arms = o.arms === 'bowls' ? 'pots' : o.arms === 'wings' ? 'wings' : o.arms === 'side' || o.arms === 'embrace' ? 'side' : 'crossed';
  return { pose: o.pose ?? 'stride', head, crown, arms, kilt: o.kilt === undefined || o.kilt === BASALT ? GRAN : CG, kiltFront: o.kiltFront === undefined ? TEAMB : o.kiltFront };
}
function cleanStatue(m, cx, y0, cz, o = {}) {
  const { pose = 'stride', head = 'nemes', arms = 'side', kiltFront = TEAMB } = o;
  const kilt = o.kilt ?? GRAN;
  const set = (x, y, z, c) => { m.set(cx + x, y0 + y, cz + z, c); const v = m.get(cx + x, y0 + y, cz + z); if (v) v.clean = 1; };
  const B = (xa, xb, ya, yb, za, zb, c) => {
    for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) for (let z = za; z < zb; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  };
  const S = (hw, ya, yb, za, zb, c) => B(-hw, hw, ya, yb, za, zb, c);
  const M = (xa, xb, ya, yb, za, zb, c) => { B(xa, xb, ya, yb, za, zb, c); B(-xb, -xa, ya, yb, za, zb, c); };   // mirrored pair
  const kn = pose === 'kneel' ? -16 : 0;
  const stripe = (x, y) => ((((y - kn) % 3) + 3) % 3 === 0 ? ST_LAPIS : CG);

  // ---- the lower body
  if (pose === 'mummy') {
    S(5, 0, 2, -3, 5, GRAN);                                   // the feet block
    for (let y = 2; y < 33; y++) S(5 + Math.floor((y - 2) / 10), y, y + 1, -3, 4, GRAN);   // the shroud
    // the inscribed column down the front (Retold's gold panel): a gold
    // field framed one voxel proud, dark signs cut down it (ankh, djed, sun)
    B(-3, 3, 5, 26, 4, 5, (x, y) => {
      if (x === -3 || x === 2 || y === 5 || y === 25) return CG_L;
      const k = 24 - y, n = Math.floor(k / 6), j = k % 6, g = COLUMN_GLYPHS[n % 3];
      if (k < 1 || j === 0 || j > g.length) return CG;
      return g[j - 1][x + 2] === 'g' ? GRAN_D : CG;
    });
  } else if (pose === 'dress') {
    // a sheath dress from the bust to the ankles: one tapering granite
    // column (feet showing under the hem), a gold hem line
    M(1, 5, 0, 2, -2, 5, GRAN);
    for (let y = 2; y < 26; y++) S(5 + Math.floor((y - 2) / 9), y, y + 1, -3, 3, y === 3 ? CG : GRAN);
  } else if (pose === 'kneel') {
    M(1, 6, 0, 3, -7, 3, GRAN);                                // shins folded back
    M(1, 6, 3, 7, -4, 8, GRAN);                                // thighs forward to the knees
    S(7, 5, 9, -4, 4, kilt);                                   // the kilt over the lap
    S(7, 9, 10, -4, 4, CG);                                    // the belt
  } else {
    const f = pose === 'stride' ? 3 : 0;
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? -6 : 1, xb = xa + 5;
      const lean = (y) => (sx < 0 ? Math.round(f * (19 - y) / 19) : 0);
      B(xa, xb, 0, 2, -3 + lean(0), 5 + lean(0), GRAN);       // the foot
      for (let y = 2; y < 18; y++) B(xa, xb, y, y + 1, -2 + lean(y), 3 + lean(y), y === 4 && o.anklets ? CG : GRAN);
    }
    for (let y = 17; y < 25; y++) S(y < 21 ? 8 : 7, y, y + 1, -4, 4, kilt);   // the kilt, stepping in at the waist
    if (kiltFront !== null) B(-2, 2, 17, 25, 4, 5, kiltFront); // the owner's apron
    S(7, 25, 26, -4, 4, CG);                                   // the belt
  }
  // ---- the torso: waist, chest, shoulders
  if (pose !== 'mummy') {
    S(6, 26 + kn, 29 + kn, -3, 3, GRAN);
    S(7, 29 + kn, 33 + kn, -3, 4, GRAN);
  }
  S(9, 33 + kn, 35 + kn, -3, 4, GRAN);
  S(8, 35 + kn, 36 + kn, -3, 4, GRAN);
  // ---- the broad collar: three continuous one-voxel rings on the chest
  for (let y = 29 + kn; y < 36 + kn; y++) for (let x = -8; x < 8; x++) {
    const d = Math.hypot(x + 0.5, (36 + kn - y) * 1.2);
    const c = d < 3.4 ? null : d < 4.5 ? CG : d < 5.6 ? ST_LAPIS : d < 6.7 ? CG : null;
    if (c) set(x, y, 4, c);
  }
  // ---- arms
  if (arms === 'side') {
    M(8, 11, 19, 35, -2, 2, GRAN);                             // straight arms hanging at the sides
    M(8, 11, 31, 32, -2, 2, CG);                               // armlets
    M(8, 11, 23, 24, -2, 2, CG);                               // bracelets
  } else if (arms === 'crossed') {
    // forearms crossed on the chest as two plain blocks, the fists forward
    if (pose !== 'mummy') M(9, 12, 28, 35, -2, 2, GRAN);       // upper arms
    B(-5, 9, 27 + kn, 30 + kn, 4, 6, GRAN);
    B(-9, 5, 30 + kn, 33 + kn, 4, 6, GRAN);
    B(-8, -5, 27 + kn, 31 + kn, 4, 7, GRAN);                   // fists
    B(5, 8, 30 + kn, 34 + kn, 4, 7, GRAN);
    B(-4, -3, 27 + kn, 30 + kn, 4, 6, CG);                     // bracelets
    B(3, 4, 30 + kn, 33 + kn, 4, 6, CG);
  } else if (arms === 'wings') {
    // Isis: arms stretched out level from the shoulders, a wing hanging
    // under each as one flat panel: lapis coverts under the arm, a gold
    // line, then long primaries in gold / lapis stripes two voxels wide,
    // the lower edge sweeping down toward the hand
    M(9, 19, 31, 34, -1, 2, GRAN);
    M(15, 16, 31, 34, -1, 2, CG);                              // bracelets
    for (let x = 9; x < 19; x++) {
      const bot = 21 - Math.floor((x - 9) * 0.9);
      for (let y = bot; y < 31; y++) {
        const c = y >= 28 ? ST_LAPIS : y === 27 ? CG_L : (Math.floor((x - 9) / 2) & 1 ? ST_LAPIS : CG);
        set(x, y, 0, c); set(-1 - x, y, 0, c);
      }
    }
  } else if (arms === 'pots') {
    M(9, 12, 10, 20, -2, 2, GRAN);                             // upper arms
    M(9, 12, 7, 10, -2, 7, GRAN);                              // forearms forward
    M(9, 12, 15, 16, -2, 2, CG);                               // armlets
    // a round gold offering pot in each hand
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? -13 : 8;
      B(xa, xa + 5, 10, 14, 4, 9, (x, y, z) => {
        const ix = x - xa, iz = z - 4, cxn = (ix === 0 || ix === 4) && (iz === 0 || iz === 4);
        if (cxn) return null;
        if (y === 13 && ix > 0 && ix < 4 && iz > 0 && iz < 4) return GRAN_D;   // the mouth
        return y === 13 ? CG_L : CG;
      });
      B(xa + 1, xa + 4, 14, 15, 5, 8, (x, y, z) => (x === xa + 2 && z === 6 ? null : CG_L));   // the rim
    }
  }
  // ---- neck and head: a flat face
  S(2, 36 + kn, 38 + kn, -1, 2, GRAN);
  const human = head === 'nemes' || head === 'double' || head === 'wig';
  if (human) {
    S(4, 38 + kn, 46 + kn, -3, 4, GRAN);
    B(-1, 1, 41 + kn, 44 + kn, 4, 5, GRAN);                    // the nose
    B(-3, -1, 44 + kn, 45 + kn, 3, 4, CG); B(1, 3, 44 + kn, 45 + kn, 3, 4, CG);   // inlaid eyes
    B(-1, 1, 40 + kn, 41 + kn, 3, 4, GRAN_D);                  // the mouth
    if (pose !== 'dress') {
      B(-1, 1, 34 + kn, 38 + kn, 3, 5, GRAN);                  // the false beard
      B(-1, 1, 34 + kn, 35 + kn, 3, 5, CG);
    }
  }
  // the tripartite wig of gods and queens: striped lappets down the chest, a
  // striped mass behind and over the ears
  if (head === 'wig' || head === 'falcon' || head === 'jackal') {
    const Y = kn;
    B(-5, 5, 37 + Y, 47 + Y, -4, -2, stripe);
    B(-5, -4, 38 + Y, 47 + Y, -4, 2, stripe); B(4, 5, 38 + Y, 47 + Y, -4, 2, stripe);
    M(4, 7, 30 + Y, 42 + Y, 1, 4, stripe);
    M(4, 7, 30 + Y, 31 + Y, 1, 4, CG);
    if (head === 'wig') S(5, 46 + Y, 47 + Y, -4, 4, CG);       // a gold fillet
  }
  if (head === 'falcon') {
    // Horus / Ra: a gold falcon's head as one block, a dark hooked beak, dark
    // eyes with the falcon's stripe running down under them
    const Y = kn;
    S(4, 38 + Y, 46 + Y, -3, 4, CG);
    S(3, 46 + Y, 47 + Y, -2, 3, CG);
    B(-1, 1, 41 + Y, 44 + Y, 4, 7, GRAN_D);                    // the beak
    B(-1, 1, 40 + Y, 41 + Y, 6, 7, GRAN_D);                    // its hooked tip
    M(1, 3, 43 + Y, 44 + Y, 3, 4, GRAN_D);                     // eyes
    M(2, 3, 41 + Y, 43 + Y, 3, 4, GRAN_D);                     // the malar stripe
  } else if (head === 'jackal') {
    // a jackal's head in granite: a long square snout, tall pointed ears gilt inside
    const Y = kn;
    S(4, 38 + Y, 46 + Y, -3, 4, GRAN);
    B(-2, 2, 39 + Y, 43 + Y, 4, 7, GRAN);
    B(-1, 1, 39 + Y, 42 + Y, 7, 9, GRAN);                      // the muzzle
    B(-1, 1, 41 + Y, 42 + Y, 9, 10, GRAN_D);                   // the nose
    M(2, 4, 44 + Y, 45 + Y, 3, 4, CG);                         // gold eyes
    for (let y = 46; y < 54; y++) {                            // the ears
      const w = y < 49 ? 3 : y < 52 ? 2 : 1, xa = 1 + Math.floor((y - 46) / 4);
      M(xa, xa + w, y + Y, y + Y + 1, -1, 1, GRAN);
      if (w > 1 && y < 52) M(xa + (w > 2 ? 1 : 0), xa + w - (w > 2 ? 1 : 0), y + Y, y + Y + 1, 1, 2, CG);
    }
  }
  if (o.crown === 'disc') {
    // Ra's sun disc: a flat red disc with a one-voxel gold rim behind the head, a uraeus
    const Y = kn, cy = 52.5, r = 5.2;
    for (let x = -6; x < 6; x++) for (let y = 46; y < 59; y++) {
      const d = Math.hypot(x + 0.5, y + 0.5 - cy);
      if (d <= r) { set(x, y + Y, -2, d > r - 1.1 ? CG : ST_RED); set(x, y + Y, -3, d > r - 1.1 ? CG : ST_RED); }
    }
    B(-1, 1, 46 + Y, 49 + Y, 1, 2, CG);
  } else if (o.crown === 'horns') {
    // Isis: a gold modius, cow horns cupping a red sun disc
    const Y = kn;
    S(3, 47 + Y, 49 + Y, -3, 3, CG);
    const H = [[3, 49], [4, 49], [5, 50], [5, 51], [5, 52], [5, 53], [4, 54]];
    for (const [x, y] of H) { set(x, y + Y, 0, CG); set(-1 - x, y + Y, 0, CG); set(x, y + Y, -1, CG); set(-1 - x, y + Y, -1, CG); }
    for (let x = -4; x < 4; x++) for (let y = 49; y < 57; y++) if (Math.hypot(x + 0.5, y + 0.5 - 53) <= 3.4) set(x, y + Y, -1, ST_RED);
    B(-1, 1, 46 + Y, 48 + Y, 4, 5, CG);
  } else if (o.crown === 'modius') {
    const Y = kn;
    S(4, 47 + Y, 49 + Y, -3, 3, CG);
    S(4, 48 + Y, 49 + Y, -3, 3, (x) => ((x & 1) ? ST_LAPIS : CG));
    B(-1, 1, 46 + Y, 48 + Y, 4, 5, CG);
  }
  if (head === 'nemes') {
    const Y = kn;
    B(-5, 5, 46 + Y, 47 + Y, -4, 5, CG);                       // the brow band
    B(-5, 5, 47 + Y, 48 + Y, -4, 4, stripe);                   // the cap
    B(-5, 5, 48 + Y, 49 + Y, -4, 4, CG);
    B(-5, -4, 38 + Y, 46 + Y, -4, 3, stripe); B(4, 5, 38 + Y, 46 + Y, -4, 3, stripe);   // over the ears
    B(-5, 5, 37 + Y, 46 + Y, -4, -3, stripe);                  // the back
    B(-2, 2, 31 + Y, 37 + Y, -4, -2, stripe);                  // the tail
    for (let y = 36; y < 46; y++) {                            // the wings flaring to the shoulders
      const w = 5 + Math.floor((46 - y) / 3);
      M(5, w, y + Y, y + Y + 1, -3, 2, stripe);
    }
    M(4, 7, 30 + Y, 41 + Y, 2, 5, stripe);                     // the lappets down the chest
    M(4, 7, 30 + Y, 31 + Y, 2, 5, CG);
    B(-1, 1, 47 + Y, 49 + Y, 5, 6, CG);                        // the uraeus
  } else if (head === 'double') {
    // the red crown (deshret) with its tall back plate, the white crown
    // (hedjet) rising out of it to a knob, a gold diadem and the red crown's curl
    const Y = kn;
    S(5, 46 + Y, 47 + Y, -4, 5, CG);
    S(5, 47 + Y, 50 + Y, -4, 4, ST_RED);
    S(5, 50 + Y, 56 + Y, -4, -2, ST_RED);
    // the white crown: a tall smooth bulb tapering to a round knob
    for (let y = 50; y < 62; y++) {
      const hw = y < 56 ? 3 : y < 59 ? 2 : y === 59 ? 1 : 2;
      if (y === 61) { S(1, y + Y, y + Y + 1, -2, 0, ST_WHITE); continue; }
      S(hw, y + Y, y + Y + 1, -1 - hw, -1 + hw, ST_WHITE);
    }
    B(2, 3, 47 + Y, 52 + Y, 4, 5, CG);                         // the curl
    B(1, 2, 52 + Y, 53 + Y, 4, 5, CG);
    B(-1, 1, 47 + Y, 49 + Y, 5, 6, CG);                        // the uraeus
  }
}
function monument(kind, god = 'ra') {
  if (kind <= 3) {
    const m = lot(32, 32, EARTH);
    const py = monPlinth(m, 6, 6, 26, 26, 1, 14, { seed: kind });
    const pd = monDie(m, 9, 9, 23, 23, py, 2);
    const o = [
      null,
      { pose: 'kneel', arms: 'pots', head: 'nemes', kiltFront: null },
      { pose: 'mummy', arms: 'crossed', head: 'double' },
      { pose: 'stride', arms: 'side', head: 'nemes', kilt: CG, anklets: 1 },
    ][kind];
    cleanStatue(m, 16, pd, kind === 1 ? 17 : 15, o);
    return m;
  }
  if (kind === 4) {
    const m = lot(48, 48, EARTH);
    const py = monPlinth(m, 5, 6, 43, 42, 1, 14, { faces: { '+z': 'cart2', '-z': 'cart2' }, seed: 4 });
    const pd = monDie(m, 9, 11, 39, 37, py, 3);
    cleanStatue(m, 15, pd, 24, { pose: 'stand', head: 'nemes', arms: 'crossed', kilt: CG });
    cleanStatue(m, 33, pd, 24, { pose: 'dress', head: 'wig', crown: 'modius', arms: 'side', kiltFront: null });
    return m;
  }
  const m = lot(64, 64, EARTH);
  const py = monPlinth(m, 12, 12, 52, 52, 1, 18, { faces: { '+z': 'eye', '-z': 'eye', '+x': 'eye', '-x': 'eye' }, seed: 5 });
  const pd = monDie(m, 20, 20, 44, 44, py, 7);   // pd = 28: the coarse statue lands on it exactly
  const G = {
    ra: { head: 'falcon', crown: 'disc', arms: 'staff', pose: 'stride' },
    set: { head: 'jackal', crown: 'set', arms: 'staff', pose: 'stand' },
    isis: { head: 'human', crown: 'horns', arms: 'wings', pose: 'dress' },
  }[god];
  // the god drawn on a coarser grid (voxels 4/3 the plinth's), so it stands
  // over the big plinth at Retold's scale with the same clean canon
  const k = 0.75, sub = new Rec(m.W, m.D);
  cleanStatue(sub, 24, Math.round(pd * k), 23, toClean({ kilt: GILT, ...G, arms: G.arms === 'staff' ? 'crossed' : G.arms }));
  (m.fine ??= []).push({ m: sub, k });
  // the sun bowls at the corners, glowing
  for (const [x, z] of [[5, 5], [58, 5], [5, 58], [58, 58]]) {
    lathe(m, x + 0.5, z + 0.5, 1, 6, (y) => (y <= 2 ? 2.8 : 4.4), SG_D, { hollow: 1.6, inner: FIRE[2] });
    lathe(m, x + 0.5, z + 0.5, 1, 4, () => 2.4, FIRE[3], { hollow: 0 });
  }
  for (const v of m.coords) { const p = m.get(...v); if (p && (p.c === FIRE[2] || p.c === FIRE[3])) p.glow = FG.glow; }
  return m;
}

// Armory (4 x 4; building_18): an L of flat-roofed blocks with team rims, an
// open forge under a dark striped awning on a timber frame, a stepped
// chimney furnace with glowing coals, a trough, a gilt ankh, crates.
function armory() {
  const m = lot(32, 32);
  patch(m, 17, 3, 31, 23, EARTH, { seed: 4 });
  block(m, 2, 4, 19, 16, 1, 13, { wall: WASH, roofC: MUDROOF, rimC: LIME, gorge: [0x8a5e38, 0x946640], torus: false, lipOut: 2, batter: 6, band: 'lapis', frieze: 1 });
  block(m, 27, 4, 31, 22, 1, 10, { wall: MUDB, roofC: MUDROOF, rimC: LIME, gorge: [0x8a5e38, 0x946640], torus: false, lipOut: 2, batter: 0, band: null });
  door(m, '+z', 8, 4, 1, 8);
  slit(m, '+z', 4, 7, 3, 1); slit(m, '+z', 15, 7, 3, 1);
  // the forge frame: posts and beams, the dark striped awning over it
  for (const [x, z] of [[19, 4], [19, 18]]) m.box(x, 1, z, 1, 12, 1, POLE);
  for (let x = 19; x < 27; x++) for (const z of [4, 10, 16]) m.set(x, 12, z, DARKWOOD);
  awning(m, '+x', 17, 5, 21, 12, 10, 3, [0x3a3f52, 0x4d5470, 0x2e3244, 0x4d5470], { sw: 1, posts: false, valance: true });
  // the forge pit with coals and an anvil
  for (let x = 21; x < 26; x++) for (let z = 8; z < 14; z++) m.set(x, 0, z, (x + z) & 1 ? FIRE[0] : 0x2a1a12, (x + z) & 1 ? { glow: 0.3 } : undefined);
  m.box(22, 1, 15, 3, 2, 2, IRON); m.box(21, 3, 15, 5, 1, 2, IRON);
  // the chimney furnace in the yard
  for (let y = 1; y < 25; y++) {
    const w = y < 5 ? 7 : y < 12 ? 5 : 4;
    const o = (7 - w) / 2;
    for (let x = 0; x < w; x++) for (let z = 0; z < w; z++) {
      const X = Math.floor(9 + o + x), Z = Math.floor(19 + o + z);
      const edge = x === 0 || x === w - 1 || z === 0 || z === w - 1;
      m.set(X, y, Z, edge ? (y >= 22 ? (y === 22 ? LIME(X, y, Z) : 0x3a3330) : y === 4 || y === 11 ? LIME(X, y, Z) : OCHRE_W(X, y, Z)) : (y === 24 ? FIRE[1] : DARK));
    }
  }
  m.set(11, 24, 21, FIRE[3], FG); m.set(12, 24, 21, FIRE[2], FG); m.set(11, 25, 21, FIRE[1], FG);
  for (let x = 11; x < 14; x++) for (let y = 1; y < 3; y++) m.set(x, y, 26, y === 1 ? FIRE[2] : FIRE[0], FG);
  // a stone trough and the ankh
  for (let x = 16; x < 21; x++) for (let z = 21; z < 25; z++) for (let y = 1; y < 3; y++) {
    const rim = x === 16 || x === 20 || z === 21 || z === 24;
    m.set(x, y, z, rim || y === 1 ? LIME(x, y, z) : WATER);
  }
  paint(m, '+z', 4, 7, ['.G.', 'G.G', '.G.', 'GGG', '.G.', '.G.'], { G: GILT });
  for (let y = 1; y < 6; y++) m.set(7, y, 27, GILT); m.box(6, 4, 27, 3, 1, 1, GILT); m.set(6, 6, 27, GILT); m.set(8, 6, 27, GILT); m.set(7, 7, 27, GILT);
  rack(m, 1, 18, 6);
  shield(m, '+z', 12, 3); shield(m, '+z', 15, 3);
  return m;
}

// Market (4 x 4; building_19): a long battered hall with an ochre band and a
// projecting door portal, a stone pier, and the market's colour: three stalls
// of bright team / white striped awnings over counters of produce, with
// baskets, jars, crates and sacks spilling into the street.
function market() {
  const m = lot(32, 32);
  patch(m, 1, 16, 31, 31, PAVE, { seed: 2 });
  block(m, 2, 2, 24, 15, 1, 14, { wall: LIME, roofC: ROOFTILE, rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2], lipOut: 2, batter: 6, band: 'ochre', frieze: 1 });
  door(m, '+z', 11, 3, 1, 8);
  // the market's tall element: a columned portico before the door, two
  // painted papyrus columns carrying a roof that stands above the hall's
  const py = 19;
  for (const cx of [8, 15]) for (let y = 1; y < py; y++) for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
    const r = y - 1, capital = y >= py - 3;
    let c = r === 0 ? SAND_D(cx + i, y, 18 + k) : r <= 2 ? OCHRE : capital ? (y === py - 1 ? LIME(cx + i, y, 18 + k) : y === py - 2 ? RED : ((i + k) & 1 ? GREENP : BLUEP)) : r % 5 === 0 ? BLUEP : r % 5 === 1 ? RED : LIME(cx + i, y, 18 + k);
    m.set(cx + i, y, 18 + k, c);
    if (capital && y === py - 1) for (const [a, b] of [[-1, 1], [3, 1], [1, -1], [1, 3]]) m.set(cx + a, y, 18 + b, GREENP);
  }
  for (let x = 6; x < 20; x++) for (let z = 14; z < 22; z++) {
    const e = Math.min(x - 6, 19 - x, z - 14, 21 - z);
    m.set(x, py, z, e === 0 ? LIME_S : (((x + z) % 6) < 3 ? RED : BLUEP));
    m.set(x, py + 1, z, e === 0 ? LIME(x, py + 1, z) : PLASTER(x, py + 1, z));
    if (e === 0) m.set(x, py + 2, z, LIME(x, py + 2, z)); else if (e === 1) m.set(x, py + 2, z, TEAM);
  }
  slit(m, '+x', 5, 9, 3, 1); slit(m, '+x', 10, 9, 3, 1);
  block(m, 24, 15, 29, 21, 1, 12, { batter: 0, band: null, rim: false });
  const st = [TEAMB, CLOTH];
  const counter = (x0, x1, z0, z1, goods) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = 1; y < 4; y++) m.set(x, y, z, (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1) ? PLANK(x, y, z) : DARKWOOD);
    const n = goods.length;
    goods.forEach((g, i) => { const a = x0 + Math.round(((x1 - x0) * i) / n), b = x0 + Math.round(((x1 - x0) * (i + 1)) / n); goodsBox(m, a, 4, z0, b - a, z1 - z0, g, 1, 0x7a5430); });
  };
  // stall 1: the front left, the awning from the hall's front wall
  awning(m, '+z', 13, 1, 9, 11, 14, 6, st, { sw: 1 });
  counter(2, 9, 23, 27, ['orange', 'melon']);
  // stall 2: the front right, from the pier
  awning(m, '+z', 20, 16, 30, 10, 9, 3, st, { sw: 1 });
  counter(17, 28, 25, 28, ['green', 'date', 'fish']);
  // stall 3: on the east side, from the hall's east wall
  awning(m, '+x', 22, 3, 14, 11, 9, 4, st, { sw: 1 });
  counter(25, 30, 4, 13, ['grain', 'date']);
  jar(m, 14.5, 1, 21.5, 0xc8a070, true); basket(m, 0, 21, 'orange');
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
  patch(m, 22, 44, 42, 64, PAVE, { seed: 8 });
  // the plinth: two steps
  block(m, 8, 4, 58, 44, 1, 8, { wall: LIME, frieze: 0, roofC: LIME, rim: false, parapet: false });
  block(m, 12, 6, 54, 40, 9, 4, { wall: LIME, frieze: 0, roofC: LIME, rim: false, parapet: false, band: false });
  // the sphinx: a lion lying toward +z on the plinth, the head in a striped nemes
  const sy = 14;
  const SPH = (x, y, z) => pick(hash3(x, y >> 1, z, 81), [0xe8dcc0, 0xdfd1b2, 0xece2ca, 0xd6c6a4]);
  const SPH_D = (x, y, z) => shade(SPH(x, y, z), 0.86);
  const X0 = 33;
  for (let z = 8; z < 32; z++) {
    const t = (z - 8) / 24;
    const wx = 7.5 - 1.2 * Math.sin(t * Math.PI);            // the waist narrows
    const hy = 7 + 4 * t;                                     // rising to the shoulders
    for (let x = X0 - 9; x < X0 + 9; x++) for (let y = sy; y < sy + 12; y++) {
      const dx = (x + 0.5 - X0) / wx, dy = (y + 0.5 - sy) / hy;
      if (dx * dx + dy * dy <= 1) m.set(x, y, z, SPH(x, y, z));
    }
  }
  // haunches (folded hind legs) and the tail curled along the right flank
  for (const sx of [-1, 1]) for (let z = 9; z < 22; z++) for (let y = sy; y < sy + 6; y++) for (let k = 0; k < 3; k++) {
    const x = X0 + sx * (7 + k);
    const dz = (z - 15) / 7, dy = (y - sy) / 6;
    if (dz * dz + dy * dy <= 1) m.set(sx > 0 ? x - 1 : x, y, z, SPH_D(x, y, z));
  }
  for (let z = 10; z < 24; z++) m.set(X0 + 9, sy + 1, z, SPH_D(X0 + 9, sy, z));
  // the forelegs stretched forward with paws
  for (const x0 of [X0 - 8, X0 + 3]) for (let z = 26; z < 45; z++) for (let y = sy; y < sy + 4; y++) for (let x = x0; x < x0 + 5; x++) {
    if (y === sy + 3 && (x === x0 || x === x0 + 4)) continue;
    m.set(x, y, z, z >= 42 && (x - x0) % 2 === 1 && y < sy + 2 ? SPH_D(x, y, z) : SPH(x, y, z));
  }
  // the chest
  for (let x = X0 - 6; x < X0 + 6; x++) for (let z = 28; z < 35; z++) for (let y = sy; y < sy + 17; y++) {
    if (z === 34 && y < sy + 4) continue;
    m.set(x, y, z, SPH(x, y, z));
  }
  // the nemes: a trapezoid of stripes over the shoulders, lappets down the chest
  for (let y = sy + 12; y < sy + 27; y++) {
    const r = y - sy - 12;
    const half = r < 6 ? 8 : Math.max(4, 8 - (r - 6) * 0.45);
    for (let x = Math.round(X0 - half); x < Math.round(X0 + half); x++) for (let z = 27; z < 35; z++) {
      const inner = x >= X0 - 4 && x < X0 + 4 && z >= 33;
      if (inner && y < sy + 25) continue;              // the face is cut in below
      m.set(x, y, z, (y & 1) ? 0xd8c69e : 0xbfa57a);
    }
  }
  for (const lx of [X0 - 6, X0 + 4]) for (let y = sy + 8; y < sy + 18; y++) for (let x = lx; x < lx + 2; x++) m.set(x, y, 35, (y & 1) ? 0xd8c69e : 0xbfa57a);
  // the face, the uraeus, the beard
  for (let x = X0 - 4; x < X0 + 4; x++) for (let y = sy + 15; y < sy + 25; y++) m.set(x, y, 35, SPH(x, y, 35));
  for (let x = X0 - 3; x < X0 + 3; x++) for (let y = sy + 16; y < sy + 25; y++) m.set(x, y, 36, SPH(x, y, 36));
  m.set(X0 - 3, sy + 21, 37, INK); m.set(X0 + 2, sy + 21, 37, INK);
  m.box(X0 - 1, sy + 18, 37, 2, 3, 1, SPH); m.box(X0 - 1, sy + 16, 37, 2, 1, 1, 0xb08a64);
  m.box(X0 - 1, sy + 11, 36, 2, 5, 1, SPH_D);
  m.box(X0 - 1, sy + 25, 36, 2, 2, 1, GILT);
  // a gilded shrine with a pharaoh figure between the paws
  plinth(m, 30, 36, 36, 42, sy, 4, { face: GILT_D, frame: GILT, team: true });
  figure(m, 33, sy + 5, 39, { h: 9, skin: GILT, gold: GILT_L, kilt: GILT, kiltFront: TEAMB, arms: 'crossed', pose: 'stand', crown: 'nemes' });
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
  for (const ox of [25, 37]) smallObelisk(m, ox + 1, 54, 1, 27);
  // column drums before the gate
  for (const [x, z] of [[18, 58], [44, 58], [20, 62], [42, 62]]) {
    lathe(m, x, z, 1, 10, () => 1.9, (xx, y, zz) => (y > 7 ? GREENP : y % 3 === 0 ? RED : LIME(xx, y, zz)));
    lathe(m, x, z, 10, 11, () => 2.6, GREENP);
  }
  return m;
}

// Sentry Tower (1 x 1 in the sim, drawn 2 x 2; building_01): a tall square
// coursed sandstone tower on a dark base course, a team rim under a deep
// cavetto cornice, a painted frieze, a three-slit window group under it on
// every face, a framed door.
function tower() {
  const m = lot(12, 12);
  block(m, 1, 1, 11, 11, 1, 30, { wall: WASH, batter: 12, frieze: 2, lipOut: 2 });
  door(m, '+z', 4, 3, 1, 6);
  // a window group under the frieze on every face (no lone slits lower
  // down: a slit between the windows and the door would make a face)
  for (const [face, u] of [['+z', 3], ['+x', 8], ['-z', 8], ['-x', 3]]) win(m, face, u, 23, { n: 3, h: 3 });
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

// Street clutter (render-only dressing for scenes, 2 x 2 tiles: what sits
// between the buildings of a Retold town): 0 a cluster of jars and a basket,
// 1 stacked crates and sacks, 2 a mud-brick wall run with a gap, 3 a hand
// cart with sacks, 4 a mud-brick pen corner with a jar, 5 a reed sunshade
// over a mat of goods, 6 a palm-log woodpile, 7 a shaded well with a basin.
function clutter(v) {
  const m = lot(16, 16, EARTH);
  if (v === 0) { pots(m, 4.5, 5.5, 5, v); basket(m, 9, 9, 'date'); jar(m, 11.5, 1, 5.5, 0xc8a070); }
  else if (v === 1) { crate(m, 3, 1, 4, 3, 3, 3); crate(m, 6, 1, 5, 3, 3, 3, 0xa77a48); crate(m, 4, 4, 5, 3, 3, 3); sack(m, 9, 1, 9); sack(m, 5, 1, 10); basket(m, 10, 4, 'orange'); }
  else if (v === 2) { mudFence(m, [[0, 7], [15, 7]], 4, { gaps: [[7, 7], [8, 7]] }); jar(m, 3.5, 1, 9.5, 0xb8683e); }
  else if (v === 3) {
    m.box(4, 3, 5, 8, 1, 5, PLANK); m.box(4, 4, 5, 8, 1, 1, PLANK); m.box(4, 4, 9, 8, 1, 1, PLANK);
    wheel(m, 8, 0, 4, 3, 'x'); wheel(m, 8, 0, 10, 3, 'x');
    m.line(12, 3, 7, 15, 1, 7, POLE); sack(m, 5, 4, 6); sack(m, 8, 4, 6); basket(m, 6, 12, 'melon');
  } else if (v === 4) { mudFence(m, [[1, 14], [1, 1], [14, 1]], 4); pots(m, 3.5, 3.5, 2, 3); m.box(6, 1, 4, 3, 1, 2, THATCH); }
  else if (v === 5) {
    for (const [x, z] of [[2, 3], [12, 3], [2, 12], [12, 12]]) m.box(x, 1, z, 1, 9, 1, POLE);
    m.box(1, 10, 2, 13, 1, 12, THATCH);
    for (let x = 3; x < 12; x++) for (let z = 5; z < 11; z++) m.set(x, 0, z, (x + z) % 3 ? 0xb8503c : 0xd9a640);
    basket(m, 4, 6, 'orange'); basket(m, 7, 6, 'green'); basket(m, 9, 8, 'date'); jar(m, 5, 1, 10, 0xc8a070);
  } else if (v === 6) {
    for (const [row, n] of [[0, 4], [1, 3], [2, 2]]) for (let i = 0; i < n; i++) log(m, 3 + i * 2 + row, 1 + row * 2, 3, 10 - row, 'z', 1);
    m.line(12, 1, 4, 12, 7, 6, POLE); crate(m, 12, 1, 10, 2, 2, 2);
  } else {
    lathe(m, 7, 7, 1, 4, () => 3.2, LIME, { hollow: 1.2, inner: WATER });
    for (const x of [3, 10]) m.box(x, 1, 6, 1, 9, 1, POLE);
    m.box(3, 10, 6, 8, 1, 1, DARKWOOD); m.box(6, 5, 6, 2, 3, 1, 0x8a6236);
    for (let x = 10; x < 14; x++) for (let z = 10; z < 13; z++) m.set(x, 1, z, x === 10 || x === 13 || z === 10 || z === 12 ? LIME : WATER);
    pots(m, 3, 12, 2, 1);
  }
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
  farm: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => farm(), stages: false, settle: false },
  temple: { w: 5, h: 6, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => temple(['ra', 'isis', 'set'][v]) },
  eg_barracks: { w: 5, h: 5, variants: ['0'], ages: [1], build: () => barracks() },
  migdol: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => migdol() },
  siege_works: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => siegeWorks() },
  armory: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => armory() },
  market: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => market() },
  obelisk: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => obelisk(), draw: 1.5 },
  monument_villagers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(1), fine: 2 },
  monument_soldiers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(2), fine: 2 },
  monument_priests: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(3), fine: 2 },
  monument_pharaohs: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => monument(4), fine: 2 },
  monument_gods: { w: 4, h: 4, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => monument(5, ['ra', 'isis', 'set'][v]), fine: 2 },
  lighthouse: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => lighthouse() },
  sentry_tower: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => tower(), draw: 1.5 },
  wonder: { w: 8, h: 8, variants: ['0'], ages: [1], build: () => wonder() },
  palm: { w: 1, h: 1, variants: ['0', '1', '2'], ages: [1], build: (v) => palmProp(v), stages: false, settle: false },
  clutter: { w: 2, h: 2, variants: ['0', '1', '2', '3', '4', '5', '6', '7'], ages: [1], build: (v) => clutter(v), stages: false },
};

// --preview <type>[:variant] --preview-out <file.json>: dump one model's
// voxels (half-voxel insets included, scaled) as [x, y, z, size, rgb] for a
// quick offline look (no export)
if (argOf('preview', '')) {
  const [pt, pv] = argOf('preview', '').split(':');
  const full = TYPES[pt].build(+(pv || 0), 1);
  const out = [];
  const dump = (mm, k) => { for (const [x, y, z] of mm.coords) { const v = mm.get(x, y, z); if (v) out.push([x / k, y / k, z / k, 1 / k, v.team ? 0x2850c8 : v.c]); } };
  dump(full, 1);
  for (const f of full.fine || []) dump(f.m, f.k);
  fs.writeFileSync(argOf('preview-out', 'preview.json'), JSON.stringify(out));
  console.log(`preview ${pt}: ${out.length} voxels`);
  process.exit(0);
}
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
// concatenate two indexed geometries with the same attributes
function mergeGeo(a, b) {
  const g = new THREE_BufferGeometry();
  const na = a.attributes.position.count;
  for (const k of ['position', 'normal', 'color', 'team', 'glow']) {
    const A = a.attributes[k], B = b.attributes[k], w = A.itemSize;
    const out = new Float32Array((na + B.count) * w);
    out.set(A.array.subarray(0, na * w), 0);
    out.set(B.array.subarray(0, B.count * w), na * w);
    g.setAttribute(k, new THREE_BufferAttribute(out, w));
  }
  const ia = a.index.array, ib = b.index.array, idx = new Uint32Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + na;
  g.setIndex(new THREE_IndexAttribute(idx, 1));
  return g;
}
const geo = (m, seed = 7, vox = VOX) => {
  const pivot = [m.W / 2, 0.8, m.D / 2];   // the ground row sinks to 0.025 above the terrain: a decal, no plinth
  let out = withSkin(S.withExtras(buildVoxelGeometry(m, { size: vox, pivot, jitter: 0.05, seed }), m, vox, pivot, { maxY: m.extraMaxY ?? Infinity }), m, vox, pivot);
  // half-voxel insets (fineFigure): sub-voxel u lands at parent voxel u / k
  for (const f of m.fine || []) out = mergeGeo(out, buildVoxelGeometry(f.m, { size: vox / f.k, pivot: pivot.map((v) => v * f.k), jitter: 0.03, seed }));
  return out;
};
const t0 = Date.now();
for (const [type, T] of Object.entries(TYPES)) {
  if (ONLY && !ONLY.has(type)) continue;
  g.extra.types[type] = { w: T.w, h: T.h, variants: T.variants, ages: T.ages, stages: T.stages !== false };
  T.variants.forEach((vn, vi) => {
    T.ages.forEach((age, ai) => {
      const full = T.build(vi, age);
      if (T.settle !== false) settle(full);
      weather(full);
      skin(full);
      clothSkin(full);
      g.add(`${type}/${vn}/a${age}`, geo(full, 11 + vi * 3 + age, VOX / (T.fine || 1)));
      if (vi === 0 && ai === 0 && T.stages !== false) {
        for (const k of g.extra.stage_keys) {
          const sm = stage(full, k);
          sm.W = full.W; sm.D = full.D;
          gs.add(`${type}/s${k}`, geo(sm, 11 + age, VOX / (T.fine || 1)));
        }
      }
    });
  });
}
g.write();
gs.write();
console.log(`egypt: ${Object.keys(g.extra.types).length} types in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
