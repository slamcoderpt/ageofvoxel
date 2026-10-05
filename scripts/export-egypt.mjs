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
const PLASTER = (x, y, z) => { const c = pick(hash3(x >> 1, y, z >> 1, 13), [0xa99880, 0xa39279, 0xae9d85, 0x9d8c74]); return (x % 5 === 0 || z % 5 === 0) ? shade(c, 0.9) : c; };
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
  constructor(W, D) { super(); this.coords = []; this.W = W; this.D = D; this.paths = []; this.blocks = []; this.feet = []; }
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
function block(m, x0, z0, x1, z1, y0, h, { wall = SAND, socle = 1, frieze = 0, band = 'ochre', cornice = true, roofC = PLASTER, rim = true, batter = 0, parapet = true, solid = true, rimC = LIP, flute = true, torus = true, gorge = null, lipOut = 1, plinth = true } = {}) {
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
      if (e === 1 && rim) m.set(x, top, z, TEAM);
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
  const c0 = a0 - lipOut, c1 = a1 + lipOut, d0 = b0 - lipOut, d1 = b1 + lipOut;
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
    const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
    m.set(x, top + 1, z, e === 0 ? rimC : (e === 1 && rim) ? TEAM : roofC);
  }
  m.lastTop = { c0, c1, d0, d1, y: top + 1 };
  return top + 2;
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
// a domed clay silo (the granary's, the TC's): a smooth bellied body of lime-
// washed clay with dark wooden ribs, a dome with a rim band and a small capped
// neck. A voxel core inside keeps it solid for the AO, the construction cut
// and the stages (which show the core rising).
const SILO_T = [0xe2c896, 0xdcc08c, 0xe8d0a0];
const SILO_RIB = 0x8a6844;
function silo(m, cx, cz, y, R, H, { ribs = 8, dome = 0.7 } = {}) {
  lathe(m, cx, cz, y, y + H, () => R * 0.8, CLAY);
  const segs = ribs * 4;
  const col = (s, k) => (s % 4 === 0 ? SILO_RIB : SILO_T[(k + (s >> 2)) % SILO_T.length]);
  const prof = [0.86, 0.95, 1.0, 1.0, 0.97, 0.92];
  for (let i = 0; i + 1 < prof.length; i++) {
    frustum(m, cx, cz, y + (H * i) / (prof.length - 1), y + (H * (i + 1)) / (prof.length - 1), R * prof[i], R * prof[i + 1], (s) => col(s, i), { segs });
  }
  // the band at the dome's foot
  frustum(m, cx, cz, y + H, y + H + 0.7, R * 0.95, R * 0.95, () => SILO_RIB, { segs });
  // the dome: rings of quads up to the neck
  const Rd = R * 0.93, Hd = R * dome;
  const rings = 6, neck = Math.max(1.2, R * 0.26);
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * Math.PI / 2, a1 = ((i + 1) / rings) * Math.PI / 2;
    const r0 = Math.max(neck, Math.cos(a0) * Rd), r1 = Math.max(neck, Math.cos(a1) * Rd);
    const y0 = y + H + 0.7 + Math.sin(a0) * Hd, y1 = y + H + 0.7 + Math.sin(a1) * Hd;
    if (r0 <= neck + 1e-6) break;
    frustum(m, cx, cz, y0, y1, r0, r1, (s) => (s % 4 === 0 ? SILO_RIB : SILO_T[(i + 1 + (s >> 2)) % SILO_T.length]), { segs });
  }
  const ny = y + H + 0.7 + Hd;
  frustum(m, cx, cz, ny - 0.3, ny + 0.9, neck + 0.5, neck + 0.4, () => 0xcfb084, { segs: 16 });
  S.cylinder(m, cx, ny + 0.9, cz, neck + 0.6, 0.5, 0x9a7a52, { segs: 16, cap: true });
  lathe(m, cx, cz, y + H, Math.floor(ny), (yy) => Math.max(0, Rd * 0.85 * Math.sqrt(Math.max(0, 1 - ((yy - y - H) / Hd) ** 2)) - 0.6), CLAY);
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
    const c = j === 2 || j === 7 ? GILT : TEAMB;
    across ? m.set(x + i - 1 + 1, y + h - j, z + (face === '+z' ? 1 : -1), c) : m.set(x + (face === '+x' ? 1 : -1), y + h - j, z + i, c);
  }
}

// ---- statues -------------------------------------------------------------------
// A standing (or kneeling) figure facing +z on (cx, y, cz) (cx, cz on voxel
// boundaries), modelled on a 24-voxel-high canon scaled by h / 24.
// skin: basalt or gilt; head: human | falcon | jackal | cow; crown: nemes | disc | atef | horns | none
// arms: side | staff | crossed | bowls | wings; pose: stride | stand | kneel | mummy | dress
function figure(m, cx, y, cz, o = {}) {
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
      for (let y = y0 + (B.base || 0); y < top; y++) {
        const k = Math.floor((y - y0) / b);
        const faceVox = pos ? outer0 - 1 - k : outer0 + k;          // the step's outer voxel (depth coord)
        const a0 = lo + k, a1 = hi - k;
        for (let u = Math.floor(L(y)); u < Math.ceil(R(y)); u++) {
          const ub0 = Math.max(u, L(y)), ub1 = Math.min(u + 1, R(y));
          const ut0 = Math.max(u, L(y + 1)), ut1 = Math.min(u + 1, R(y + 1));
          if (ub1 - ub0 <= 1e-6 && ut1 - ut0 <= 1e-6) continue;
          const uc = Math.max(a0, Math.min(a1 - 1, u));
          const at = (d) => (alongX ? m.get(uc, y, d) : m.get(d, y, uc));
          // something standing against the wall here (a porch, a lintel, a beam): no skin
          if (at(faceVox + sg) || at(faceVox + 2 * sg)) continue;
          const v = at(faceVox);
          if (!v) continue;                                          // a recess (a door)
          const j = 1 + (hash3(uc, y, faceVox, 7) - 0.5) * 0.04;
          _k.setHex(v.c);
          const c = [_k.r * j, _k.g * j, _k.b * j];
          const yb = y, yt = y + 1;
          emit([P(ub0, yb, plane(yb)), P(ub1, yb, plane(yb)), P(ut1, yt, plane(yt)), P(ut0, yt, plane(yt))], nrm, c, v.team ? v.team : 0);
        }
      }
      // the cap between the skin's top edge and the top row's face, under the cornice
      const vg = alongX ? m.get(Math.floor((lo + hi) / 2), top, pos ? outer0 - 1 - K : outer0 + K) : m.get(pos ? outer0 - 1 - K : outer0 + K, top, Math.floor((lo + hi) / 2));
      _k.setHex(vg ? vg.c : GORGE);
      const dTop = pos ? outer0 - K : outer0 + K;
      emit([P(L(top), top, plane(top)), P(R(top), top, plane(top)), P(hi - K, top, dTop), P(lo + K, top, dTop)], [0, 1, 0], [_k.r * 0.9, _k.g * 0.9, _k.b * 0.9], 0);
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
const AWN_H = [CLOTH, STRIPE_R];
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
  const bo = { wall: W, roofC: arch ? THATCH : PLASTER, band: arch ? null : 'ochre', batter: 6, rimC: arch ? MUDCAP : LIP, gorge: arch ? [MUDCAP_D, 0xb8925f] : null, torus: !arch, lipOut: 2 };
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
    awning(m, '+z', 13, 14, 21, 6, 5, 2, AWN_H, { sw: 1 });
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
    awning(m, '+z', 12, 3, 11, 6, 5, 2, AWN_H, { sw: 1 });
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
    awning(m, '+x', 10, 13, 19, 6, 4, 2, AWN_H, { sw: 1 });
    pots(m, 12.5, 14.5, 3, 2); basket(m, 18, 14, 'green');
  }
  return m;
}

// Granary (3 x 3; building_05): a low battered store with a roof hatch and a
// ladder, two big domed clay silos with wooden ribs (the silhouette), a
// threshing floor with a grain heap, sacks and a winnowing basket.
function granary() {
  const m = lot(24, 24);
  const t = block(m, 2, 2, 14, 12, 1, 9, { wall: WASH, roofC: MUDROOF, rimC: LIME, gorge: [0x8a5e38, 0x946640], torus: false, lipOut: 2, batter: 5, band: null });
  const T = m.lastTop;
  for (let x = T.c0 + 3; x < T.c0 + 7; x++) for (let z = T.d0 + 3; z < T.d0 + 6; z++) m.set(x, t - 1, z, DARK);   // the roof hatch
  for (let x = T.c0 + 2; x < T.c0 + 8; x++) for (const z of [T.d0 + 2, T.d0 + 6]) m.set(x, t, z, 0x8a6a48);
  for (let z = T.d0 + 2; z < T.d0 + 7; z++) for (const x of [T.c0 + 2, T.c0 + 7]) m.set(x, t, z, 0x8a6a48);
  // the ladder leaning on the front
  for (let y = 1; y < t + 1; y++) { const z = 13 + Math.floor((t - y) / 4); m.set(3, y, z, POLE); m.set(6, y, z, POLE); if (y % 3 === 0) { m.set(4, y, z, POLE); m.set(5, y, z, POLE); } }
  silo(m, 18.5, 8.5, 1, 5.4, 14, { dome: 0.85 });
  silo(m, 10.5, 18.5, 1, 4.8, 12, { dome: 0.85 });
  door(m, '-x', 4, 3, 1, 6);
  // the threshing floor and its grain heap
  patch(m, 15, 15, 24, 24, WORN, { seed: 3 });
  lathe(m, 20, 20, 1, 4, (y) => 3.4 - (y - 1) * 1.1, GRAIN);
  m.line(16, 1, 22, 18, 5, 19, POLE);
  sack(m, 15, 1, 15);
  return m;
}

// Lumber Camp (3 x 3; building_06): a steeply battered block with a thin
// lapis band, a faded striped cloth on poles over a big log pile, a sawhorse,
// a stump with an axe, crates and barrels.
function lumberCamp() {
  const m = lot(24, 24);
  const t = block(m, 2, 3, 13, 15, 1, 12, { wall: WASH, roofC: MUDROOF, rimC: LIME, gorge: [0x8a5e38, 0x946640], torus: false, lipOut: 2, batter: 5, band: null });
  door(m, '+z', 6, 3, 1, 6);
  slit(m, '+x', 7, 7, 2, 1);
  // the cloth from the block's east face over the log pile
  const yTop = t - 5, f = 12 - Math.floor((yTop - 1) / 5);
  awning(m, '+x', f, 6, 17, yTop, 22 - f, 4, [STRIPE_M, CLOTH, CLOTH, STRIPE_T, CLOTH], { sw: 1 });
  // the log pile (along z) under it, stacked 4-3-2
  for (const [row, n] of [[0, 4], [1, 3], [2, 2]]) for (let i = 0; i < n; i++) log(m, 13 + i * 2 + row, 1 + row * 2, 6, 12 - row, 'z', 1);
  log(m, 15, 1, 21, 8, 'x', 1);
  // a sawhorse with a log on it
  for (const x of [17, 21]) { m.line(x, 1, 18, x, 4, 19, POLE); m.line(x, 1, 20, x, 4, 19, POLE); }
  log(m, 16, 4, 19, 7, 'x', 1);
  // the camp's tall element: a timber sheerlegs (an A-frame hoist) over the
  // pile with a log slung from its head
  for (const x of [14, 22]) m.line(x, 1, 2, 18, 22, 2, POLE);
  m.box(17, 22, 1, 3, 1, 3, DARKWOOD);
  for (let y = 12; y < 22; y++) m.set(18, y, 2, 0xcdb98a);
  log(m, 15, 10, 2, 7, 'x', 1);
  return m;
}

// Mining Camp (3 x 3; building_07): a battered block, a cloth on poles over
// bins of gold ore, a sledge of quarried stone, a trough, baskets of ore,
// a rack of picks.
function miningCamp() {
  const m = lot(24, 24);
  const t = block(m, 8, 3, 18, 14, 1, 12, { wall: WASH, roofC: MUDROOF, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  door(m, '+z', 11, 4, 1, 7);
  const yTop = t - 5, f = 8 + Math.floor((yTop - 1) / 5);
  awning(m, '-x', f, 5, 15, yTop, f - 1, 3, [CLOTH, STRIPE_T, CLOTH], { sw: 2 });
  // ore bins under the awning
  for (let x = 1; x < 7; x++) for (let z = 7; z < 15; z++) for (let y = 1; y < 4; y++) {
    const rim = x === 1 || x === 6 || z === 7 || z === 14;
    if (rim) m.set(x, y, z, PLANK(x, y, z)); else if (y === 3) m.set(x, y, z, GOLDORE);
  }
  for (let x = 2; x < 6; x++) for (let z = 8; z < 14; z++) if (hash3(x, 4, z, 5) < 0.5) m.set(x, 4, z, GOLDORE);
  // a stone trough on the east
  for (let x = 19; x < 23; x++) for (let z = 6; z < 13; z++) for (let y = 1; y < 3; y++) {
    const rim = x === 19 || x === 22 || z === 6 || z === 12;
    m.set(x, y, z, rim || y === 1 ? LIME(x, y, z) : WATER);
  }
  // a sledge with two quarried blocks
  for (const z of [18, 21]) for (let x = 13; x < 22; x++) m.set(x, 1, z, x === 13 ? DARKWOOD : POLE);
  m.box(14, 2, 17, 4, 3, 5, LIME); m.box(18, 2, 17, 3, 2, 5, SAND);
  // the camp's tall element: a timber headframe over the ore bins, a pulley
  // wheel at its head and a bucket of ore on the rope
  for (const z of [6, 15]) m.box(3, 1, z, 1, 22, 1, POLE);
  for (let z = 6; z < 16; z++) m.set(3, 22, z, DARKWOOD);
  m.line(3, 14, 6, 3, 21, 10, POLE); m.line(3, 14, 15, 3, 21, 11, POLE);
  wheel(m, 4, 19, 10, 2, 'z');
  for (let y = 9; y < 21; y++) m.set(4, y, 10, 0xcdb98a);
  m.box(3, 6, 9, 3, 3, 3, PLANK); m.box(4, 9, 10, 1, 1, 1, GOLDORE);
  // a rack of picks against the block
  for (let i = 0; i < 3; i++) { m.line(9 + i * 2, 1, 15, 9 + i * 2, 6, 14, 0x7a5230); m.set(8 + i * 2, 6, 14, STEEL); m.set(10 + i * 2, 6, 14, STEEL); }
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
  awning(m, '+z', 25, 9, 16, 11, 7, 4, [STRIPE_M, CLOTH, CLOTH], { sw: 1 });
  // the east block (dark mud brick, a pale lip) with an awning over its door
  const mb = { wall: MUDB, batter: 6, band: null, roofC: MUDROOF, rimC: LIME, lipOut: 2, gorge: [0x8a5e38, 0x946640], torus: false };
  block(m, 35, 8, 48, 22, 1, 12, mb);
  door(m, '+z', 39, 4, 1, 7, { deep: 3 });
  slit(m, '+x', 12, 6, 3, 1); slit(m, '+x', 17, 6, 3, 1);
  awning(m, '-x', 36, 11, 20, 9, 5, 3, [STRIPE_M, CLOTH, CLOTH], { sw: 1 });
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
  const py = plinth(m, 2, 45, 12, 54, 1, 7, { face: SAND, frame: LIME, team: true });
  figure(m, 7, py, 49.5, { h: 34, skin: GILT, gold: GILT_L, kilt: CLOTH, kiltFront: TEAMB, head: 'falcon', crown: 'disc', arms: 'staff', pose: 'stride' });
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
        // the temple's colour: papyrus capitals in green and lapis under a red
        // band, shafts banded lapis / red with a column of glyphs, ochre feet
        const front = i === w - 1 || k === w - 1;
        if (capital) c = r === colH - 1 ? LIME(X, y, Z) : r === colH - 2 ? RED : ((i + k) & 1 ? GREENP : BLUEP);
        else if (r === 0) c = SAND_D(X, y, Z);
        else if (r <= 2) c = OCHRE;
        else if (r % 4 === 0) c = BLUEP;
        else if (r % 4 === 1) c = RED;
        else if (front && (i + k) % 2 === 1) c = (r & 1) ? INK : OCHRE;
        m.set(X, y, Z, c);
      }
    }
  };
  for (const x of cols) { column(x, colsZ[0]); column(x, colsZ[3]); }
  for (const z of [colsZ[1], colsZ[2]]) { column(cols[0], z); column(cols[3], z); }
  // screen walls between the columns (half height, with painted reliefs), open in the front middle
  const screen = (xa, xb, za, zb) => {
    for (let x = xa; x < xb; x++) for (let z = za; z < zb; z++) for (let y = fl; y < fl + 5; y++) m.set(x, y, z, y === fl + 4 ? LIME(x, y, z) : y === fl + 3 ? RED_M : (y === fl + 1 || y === fl + 2) && (x + z) % 3 === 0 ? (((x + z) & 1) ? BLUEP : OCHRE) : SAND(x, y, z));
  };
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
  figure(m, 6.5, py, 34, { h: 26, gold: GILT_L, kiltFront: TEAMB, pose: 'stride', ...G });
  pottedPalm(m, 33, 4, 35);
  // the temple's second tall element: a pair of gilt-tipped obelisks at the ramp foot
  for (const ox of [10, 28]) {
    m.box(ox - 1, 1, 42, 4, 2, 4, LIME);
    for (let y = 3; y < 28; y++) {
      const w = y < 25 ? 2 : 1, o = y < 25 ? 0 : 0.5;
      for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) if (w === 2 || (i === 0 && k === 0)) m.set(ox + i, y, 43 + k, y >= 24 ? GILT : (y % 5 === 0 ? INK : SAND(ox + i, y, 43 + k)));
      void o;
    }
  }
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
  block(m, 2, 2, 38, 14, 1, 12, { wall: OCHRE_W, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  block(m, 2, 13, 12, 36, 1, 11, { wall: OCHRE_W, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  block(m, 30, 13, 38, 28, 1, 9, { wall: OCHRE_W, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  // the raised gatehouse in the middle of the back range
  const tg = block(m, 14, 6, 27, 17, 1, 16, { wall: LIME, roofC: ROOFTILE, rimC: LIME, gorge: [0xd2c4a4, 0xdccfb2], lipOut: 2, batter: 5, band: 'red', frieze: 1 });
  block(m, 17, 8, 24, 14, tg - 1, 4, { batter: 0, band: null });
  door(m, '+z', 18, 5, 1, 9, { lattice: true, sun: true, deep: 3 });
  // corner piers at the yard entrance with the banners
  block(m, 8, 33, 15, 40, 1, 12, { wall: OCHRE_W, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  block(m, 30, 27, 37, 34, 1, 12, { wall: OCHRE_W, rimC: LIME, gorge: [0xb98a52, 0xc4965c], torus: false, lipOut: 2, batter: 5, band: null });
  banner(m, 15, 1, 38, 30);
  banner(m, 37, 1, 31, 30, '+x');
  banner(m, 27, 1, 17, 32);
  banner(m, 12, 1, 15, 28);
  slit(m, '+x', 20, 6, 3, 1); slit(m, '+x', 25, 6, 3, 1); slit(m, '+z', 5, 6, 3, 1); slit(m, '+z', 34, 6, 3, 1);
  // two weapon racks in the yard, a practice dummy, an archery butt
  rack(m, 18, 29, 8); rack(m, 21, 23, 7);
  dummy(m, 15, 26);
  lathe(m, 27.5, 21.5, 1, 6, () => 2.2, (x, y, z) => (y === 3 ? RED : THATCH(x, y, z)));
  return m;
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

// Siege Works (5 x 5; building_11): two flat-roofed stone towers, a long
// striped awning from one down to a low colonnade with painted column feet,
// wheels, barrels, crates and a catapult arm.
function siegeWorks() {
  const W = 56;
  const m = lot(W, W);
  patch(m, 6, 30, 54, 55, EARTH, { seed: 7 });
  // two tall flat-roofed workshop towers on the east, the second stepped forward
  block(m, 22, 4, 40, 22, 1, 28, { wall: LIME, batter: 7, band: 'team' });
  block(m, 36, 14, 53, 33, 1, 25, { wall: LIME, batter: 7, band: 'ochre' });
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
  const st = [STRIPE_T, CLOTH, STRIPE_M, CLOTH];
  awning(m, '-x', 22, 5, 22, 24, 6, 8, st, { posts: false, valance: false });
  for (let z = 5; z < 23; z++) for (let x = 13; x < 16; x++) m.set(x, 16 - (x - 13), z, st[Math.floor((z - 5) / 2) % st.length]);
  // the yard: wheels, barrels, crates, a catapult arm and a siege-tower frame
  wheel(m, 30, 1, 40, 4, 'x'); wheel(m, 38, 1, 44, 4, 'z'); wheel(m, 26, 1, 47, 3, 'x');
  crate(m, 10, 1, 34, 3, 3, 3);
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
      { pose: 'stride', arms: 'side', crown: 'nemes', kilt: GILT, kiltFront: TEAMB, h: 22 },
    ][kind];
    figure(m, 8, py, 8, { skin: BASALT, gold: GILT, ...o });
    return m;
  }
  const m = lot(kind === 5 ? 32 : 24, kind === 5 ? 32 : 24, EARTH);
  if (kind === 4) {
    const py = plinth(m, 3, 3, 21, 21, 1, 6, { face: BASALT, frame: GILT });
    const py2 = plinth(m, 5, 5, 19, 19, py, 2, { face: BASALT, frame: GILT, team: false });
    figure(m, 9, py2, 12, { h: 24, skin: BASALT, gold: GILT, kilt: GILT, kiltFront: TEAMB, crown: 'atef', arms: 'side', pose: 'stand' });
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
  figure(m, 16, py2, 16, { h: 30, skin: BASALT, gold: GILT_L, kilt: GILT, kiltFront: TEAMB, ...G });
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
  obelisk: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => obelisk() },
  monument_villagers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(1) },
  monument_soldiers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(2) },
  monument_priests: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(3) },
  monument_pharaohs: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => monument(4) },
  monument_gods: { w: 4, h: 4, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => monument(5, ['ra', 'isis', 'set'][v]) },
  lighthouse: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => lighthouse() },
  sentry_tower: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => tower(), draw: 1.5 },
  wonder: { w: 8, h: 8, variants: ['0'], ages: [1], build: () => wonder() },
  palm: { w: 1, h: 1, variants: ['0', '1', '2'], ages: [1], build: (v) => palmProp(v), stages: false, settle: false },
  clutter: { w: 2, h: 2, variants: ['0', '1', '2', '3', '4', '5', '6', '7'], ages: [1], build: (v) => clutter(v), stages: false },
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
  const pivot = [m.W / 2, 0.8, m.D / 2];   // the ground row sinks to 0.025 above the terrain: a decal, no plinth
  return withSkin(S.withExtras(buildVoxelGeometry(m, { size: VOX, pivot, jitter: 0.05, seed }), m, VOX, pivot, { maxY: m.extraMaxY ?? Infinity }), m, VOX, pivot);
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
