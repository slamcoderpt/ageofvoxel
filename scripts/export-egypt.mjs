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
// Round 34: every stone palette is laid as deliberate ashlar, never per-voxel
// noise. A course is `course` rows: its bottom row one even mortar line (a
// shade darker, the same all round the building), the rows above it the
// stone, each block `len` voxels long in a running bond (half a block offset
// course to course) with a one-voxel head joint, its top row a hair lighter
// (the block's lit upper arris), and ONE tone per block: the palette's mean
// tone nudged by at most +-`spread` (per block, never per voxel). Every
// colour a palette hands out is remembered in ASH (colour -> palette, factor)
// so recourse() can re-lay a finished model's battered faces in face-local
// coordinates (no joints stepping sideways a voxel at every batter step) and
// grimed() keeps the link for its darkened foot rows.
const ASH = new Map();
const meanTone = (tones) => {
  let r = 0, g = 0, b = 0;
  for (const t of tones) { r += (t >> 16) & 255; g += (t >> 8) & 255; b += t & 255; }
  const n = tones.length;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
};
function ashlar(tones, { course = 4, len = 7, head = 0.9, bed = 0.86, spread = 0.03, hi = 1.025, grime = 0, seed = 41 } = {}) {
  const base = meanTone(tones);
  const fn = (x, y, z) => {
    const yy = Math.max(0, y - 1);
    const row = Math.floor(yy / course), k = yy % course;
    const u = x + z + (row & 1) * (len >> 1) + 512;
    const blk = Math.floor(u / len);
    let f;
    if (k === 0 && course > 1) f = bed;
    else {
      f = 1 + (hash3(blk, row, 7, seed) - 0.5) * 2 * spread;
      if (u % len === 0) f *= head;
      else if (k === course - 1 && course > 2) f *= hi;
    }
    if (grime && y < grime) f *= 0.9 + 0.025 * Math.max(0, y);
    const c = shade(base, f);
    if (!ASH.has(c)) ASH.set(c, { fn, f: 1 });
    return c;
  };
  fn.ash = true;
  fn.course = course; fn.len = len;
  return fn;
}
function masonry(tonesA, tonesB, { len = 8, course = 4, bed = 0.84, head = 0.9, grime = 4, seed = 3 } = {}) {
  return ashlar([...tonesA, ...tonesB], { len, course, bed: Math.max(bed, 0.84), head: Math.max(head, 0.9), grime, seed, spread: 0.025 });
}
// Coursed: the stone courses read from the RTS camera (Retold's house and
// camp walls: pale sandstone blocks in visible courses): see ashlar().
function coursed(tones, { course = 4, len = 7, head = 0.86, bed = 0.8, seed = 41 } = {}) {
  return ashlar(tones, { course, len, head: Math.max(head, 0.82), bed: Math.max(bed, 0.76), seed });
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
  let c = pick(big, [0xb59165, 0xae8b5f, 0xba966a]);   // round 26: a warm mud plaster a step under the walls
  if (hash3(x >> 1, y, z >> 1, 17) < 0.06) c = shade(c, 0.94);
  return shade(c, 0.99 + 0.02 * hash3(x, y, z, 18));
};
const ROOFTILE = (x, y, z) => { const c = pick(hash3(x >> 2, y, z >> 2, 14), [0xb39066, 0xad8a60, 0xb8956b]); return (x % 4 === 0 || z % 4 === 0) ? shade(c, 0.92) : c; };
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
// round 28 goods: deliberately modelled props on a clean grid. Each is built
// from square voxel rows (no lathe circles: at 1-2 voxel radii they melt into
// lumps), flat-toned by row (a darker foot, the lit shoulder lighter), marked
// clean so weather() leaves its colours alone, and laid out with a one-voxel
// gap round it so every prop keeps its own edge.
function pset(m, x, y, z, c) { m.set(x, y, z, c); const v = m.get(x, y, z); if (v) v.clean = 1; }
// a square row of half-width r round (X, Z), its four corners cut when `cut`
function prow(m, X, y, Z, r, c, cut = false) {
  for (let i = -r; i <= r; i++) for (let k = -r; k <= r; k++) {
    if (cut && Math.abs(i) === r && Math.abs(k) === r) continue;
    pset(m, X + i, y, Z + k, typeof c === 'function' ? c(i, k) : c);
  }
}
const MOUTH = 0x1c1714;
const JAR_RIM = 0xe9dcc0;
// a clay jar centred on (cx, cz): small (3 x 3, 4 high: foot, belly, a
// shoulder round its dark mouth) or a big storage jar (5 x 5, 7 high, a blue
// band round the belly, a pale rim round the mouth)
function jar(m, cx, y, cz, c = 0xb8683e, big = false) {
  const X = Math.floor(cx), Z = Math.floor(cz);
  if (big) {
    prow(m, X, y, Z, 1, shade(c, 0.74));
    for (let r = 1; r <= 4; r++) prow(m, X, y + r, Z, 2, r === 3 ? 0x2f5fa8 : r === 1 ? shade(c, 0.88) : r === 4 ? shade(c, 1.06) : c, true);
    prow(m, X, y + 5, Z, 1, shade(c, 1.1), true);
    prow(m, X, y + 6, Z, 1, (i, k) => (i === 0 && k === 0 ? MOUTH : JAR_RIM));
  } else {
    prow(m, X, y, Z, 1, shade(c, 0.78), true);
    prow(m, X, y + 1, Z, 1, c);
    prow(m, X, y + 2, Z, 1, shade(c, 1.06));
    prow(m, X, y + 3, Z, 1, (i, k) => (i === 0 && k === 0 ? MOUTH : shade(c, 1.14)), true);
  }
}
// a linen grain sack standing on its foot (3 x 3 from (x, z)): square body,
// a gathered shoulder, a brown cord tying the neck and the cloth's two ears
// fanned over it
const LINEN = [0xc6baa0, 0xdcd2ba, 0xebe4d2, 0xf5f0e4];
const CORD = 0x5e3c22;
function sack(m, x, y, z, big = false) {
  const X = x + 1, Z = z + 1, h = big ? 4 : 3;
  for (let r = 0; r < h; r++) prow(m, X, y + r, Z, 1, r === 0 ? LINEN[0] : LINEN[1]);
  prow(m, X, y + h, Z, 1, LINEN[2], true);
  pset(m, X, y + h + 1, Z, CORD);
  for (const i of [-1, 0, 1]) pset(m, X + i, y + h + 2, Z, LINEN[3]);
}
// a sack lying along +x (5 x 3, 2 high, its gathered neck and a fanned tuft
// at the +x end; no dark cord here, which reads as a log's end grain)
function lyingSack(m, x, y, z) {
  for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) {
    pset(m, x + i, y, z + k, LINEN[1]);
    if (!((i === 0 || i === 4) && (k === 0 || k === 2))) pset(m, x + i, y + 1, z + k, k === 1 ? LINEN[3] : LINEN[2]);
  }
  pset(m, x + 5, y, z + 1, LINEN[0]); pset(m, x + 6, y, z + 1, LINEN[3]); pset(m, x + 6, y, z, LINEN[2]); pset(m, x + 6, y, z + 2, LINEN[2]);
}
// lying sacks stacked like bricks on a plank pallet: `n` along z (a voxel
// apart), n - 1 bridging them, n - 2 on top; the pallet one voxel wider
function sackStack(m, x0, y, z0, n = 3) {
  for (let x = x0 - 1; x <= x0 + 7; x++) for (let z = z0 - 1; z <= z0 + n * 4 - 1; z++) pset(m, x, y, z, (z - z0) % 2 ? 0x8e6a42 : 0x6e4e30);
  for (let t = 0; t < n; t++) for (let i = 0; i + t < n; i++) lyingSack(m, x0, y + 1 + t * 2, z0 + t * 2 + i * 4);
}
// an amphora centred on (cx, cz), 8 high in red terracotta: a pointed foot,
// a square belly, a lit shoulder, one voxel of neck and a pale square rim
// round the dark mouth
const AMPH_RIM = 0xd99a6a;
function amphora(m, cx, y, cz, c = 1) {
  const base = [0xa8482a, 0xb5542e, 0xae4e2c, 0x9c4428][c % 4];
  const X = Math.floor(cx), Z = Math.floor(cz);
  pset(m, X, y, Z, shade(base, 0.66));
  prow(m, X, y + 1, Z, 1, shade(base, 0.8), true);
  prow(m, X, y + 2, Z, 1, shade(base, 0.92));
  prow(m, X, y + 3, Z, 1, base);
  prow(m, X, y + 4, Z, 1, shade(base, 1.08));
  prow(m, X, y + 5, Z, 1, shade(base, 1.16), true);
  pset(m, X, y + 6, Z, shade(base, 0.84));
  prow(m, X, y + 7, Z, 1, (i, k) => (i === 0 && k === 0 ? MOUTH : AMPH_RIM));
}
// a neat stack of sun-dried mud bricks (w along x, d along z, n courses):
// courses alternate light and dark, bricks two voxels long with a dark joint
// (stretchers along x, then headers along z), every second course one voxel
// shorter at each end so the stack steps in
const MBRICK = [0x8e5a34, 0x784a2a];
function brickStack(m, x0, y, z0, w, d, n = 4) {
  for (let c = 0; c < n; c++) {
    const ins = c >> 1, tone = shade(MBRICK[c & 1], c === n - 1 ? 1.08 : 1);
    for (let i = ins; i < w - ins; i++) for (let k = 0; k < d; k++) {
      const u = c & 1 ? k + 1 : i - ins + ((c >> 1) & 1);
      pset(m, x0 + i, y + c, z0 + k, u % 3 === 2 ? shade(tone, 0.72) : tone);
    }
  }
}
// a reed mat on the ground under a group of goods: one flat tone, a darker
// border, so the group stands on a clean rectangle
function goodsMat(m, x0, z0, x1, z1) {
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) pset(m, x, 0, z, (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1) ? 0x7d6440 : 0xa88a58);
}
const STRAW = [0xc8922c, 0xa87622];
function wovenBasket(m, x0, z0, w, kind, y = 1) {
  // a squat straw basket, its corners cut round, woven rows light / dark,
  // its goods heaped over the rim in a low mound (one flat tone, the crest lit)
  const good = PROD[kind](x0, 7, z0);
  for (let i = 0; i < w; i++) for (let k = 0; k < w; k++) {
    const ei = i === 0 || i === w - 1, ek = k === 0 || k === w - 1;
    if (ei && ek) continue;
    const rim = ei || ek;
    pset(m, x0 + i, y, z0 + k, STRAW[1]);
    pset(m, x0 + i, y + 1, z0 + k, rim ? STRAW[0] : good);
    if (!rim && w > 3 && !((i === 1 || i === w - 2) && (k === 1 || k === w - 2))) pset(m, x0 + i, y + 2, z0 + k, shade(good, 1.08));
    else if (!rim && w === 3) pset(m, x0 + i, y + 2, z0 + k, shade(good, 1.08));
  }
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
function door(m, face, u0, w, y0, h, { lintel = true, sun = false, lattice = false, frame = LIME, deep = 2, leaf = true, proud = true, leafShade = 0.62, lintelC = null } = {}) {
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
    let c = leaf ? shade(DOOR(q[0], q[1], q[2]), leafShade) : REVEAL;
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
    if (p) m.set(p[0] + n[0], p[1], p[2] + n[2], i === -2 || i === w + 1 ? LIME_S : (lintelC ?? frame));
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
const LAPIS = 0x34558a, RED_M = 0x9c4a32, OCHRE_M = 0xc4923c, GORGE = 0x34588a, GORGE_L = 0x3f6596, ROLL = 0xbfa47a;
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
const OCHRE_P = coursed([0xb98450, 0xb27d4a, 0xc08a56], { course: 3, len: 8, bed: 0.91, head: 0.94, seed: 27 });
const OCHRE_W = masonry([0xb98248, 0xb07a42, 0xc08a50], [0xaa743e, 0xb47e46, 0xa26e38], { len: 8, course: 3, bed: 0.82, head: 0.88, grime: 3, seed: 21 });
const MUDB = masonry([0xa47448, 0x9a6b40, 0xad7c4f], [0x93653c, 0x9f7046, 0xa8784c], { len: 4, course: 2, bed: 0.84, head: 0.9, grime: 2, seed: 23 });
const MUDROOF = (x, y, z) => { const c = pick(hash3(x >> 1, y, z >> 1, 24), [0x9f7a52, 0x99744d, 0xa5805a]); return (x % 5 === 0 || z % 5 === 0) ? shade(c, 0.93) : c; };
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
function block(m, x0, z0, x1, z1, y0, h, { wall = SAND, socle = 1, frieze = 0, band = 'ochre', cornice = true, roofC = PLASTER, rim = false, batter = 0, parapet = true, solid = true, rimC = LIP, flute = true, torus = true, gorge = null, lipOut = 1, plinth = true, flare = null, rimTeam = TEAM, grime = true, style = 'parapet' } = {}) {
  const [gA, gB] = gorge || [GORGE, GORGE_L];
  // round 27: no overhanging roof slabs. A 'parapet' block (the default) runs
  // its roof flush: a painted band under a thick parapet whose coping is the
  // lightest line on the block, the deck sunk a row inside it; a deep cornice
  // (lipOut > 1 / flare) is a stepped cavetto one voxel out under the
  // parapet, never a lid. 'cornice' keeps the old flared lip (pylon()).
  if (style === 'parapet' && cornice && parapet !== false) return pblock(m, x0, z0, x1, z1, y0, h, { wall, socle, frieze, band, roofC, rim, batter, solid, rimC, torus, gA, gB, cav: (flare === null ? lipOut > 1 : flare) || lipOut > 1, plinth, rimTeam, grime });
  // round 25: every deep cornice flares (two dark painted gorge rows under the lip)
  if (flare === null) flare = lipOut > 1;
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
      // round 25: grime at a ground block's foot (over the base course)
      if (grime && y0 === 1 && dEdge <= 1) c = grimed(c, x, y, z, y - y0 - baseH + 2);
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
// Round 27 parapet block (see block()): walls in courses (batter registered
// for skin()), then under the top, top first: the painted band (two rows of
// the band's paint, a row of alternating red / yellow blocks: 'lapis' /
// 'team' bands; a red band gets a lapis accent), the frieze rows under it;
// a stepped cavetto (cav: a gorge row on the wall plane, a second one voxel
// out, paired flutes, no 1-voxel checker) or none; the parapet two voxels
// thick, one wall row and a coping in the lightest limestone (its inner ring
// the owner's line when rim), the deck one row down inside it.
const BAND_Y = 0xe0a83a, BAND_R = 0xb03a26, BAND_B = 0x2f5fa8;
function bandRows(kind) {
  const alt = (a, b, n = 3) => (x, y, z) => ((Math.floor((x + z + 512) / n) & 1) ? a : b);
  if (kind === 'red') return [BAND_R, BAND_R, alt(BAND_B, BAND_Y)];
  if (kind === 'ochre') return [BAND_Y, BAND_Y, alt(BAND_R, BAND_B)];
  if (kind === 'team') return [TEAM, FRIEZE_SEP, alt(BAND_R, BAND_Y)];
  if (kind === 'teamb') return [TEAMB, FRIEZE_SEP, alt(BAND_R, BAND_Y)];
  return [BAND_B, BAND_B, alt(BAND_R, BAND_Y)];
}
function pblock(m, x0, z0, x1, z1, y0, h, o) {
  const { wall, socle, frieze, roofC, rim, batter, solid, rimC, torus, gA, gB, cav, plinth, rimTeam, grime } = o;
  const band = o.band === null || o.band === false ? 'lapis' : o.band === true ? 'team' : o.band;
  const rows = bandRows(band);
  const baseH = y0 === 1 && plinth && h >= 6 ? BASE_H : 0;
  if (batter && m.blocks) m.blocks.push({ x0, z0, x1, z1, y0, h, b: batter, base: baseH });
  if (y0 === 1 && plinth && m.feet) m.feet.push({ x0, z0, x1, z1, hb: Math.max(1, baseH) });
  const top = y0 + h;
  const nb = h >= 8 ? rows.length : 1;
  let inset = 0;
  for (let y = y0; y < top; y++) {
    inset = batter ? Math.floor((y - y0) / batter) : 0;
    const a0 = x0 + inset, a1 = x1 - inset, b0 = z0 + inset, b1 = z1 - inset;
    const t = top - 1 - y;
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const dEdge = Math.min(x - a0, a1 - 1 - x, z - b0, b1 - 1 - z);
      if (!solid && dEdge > 1) continue;
      if (dEdge > 1) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
      let c = null;
      if (y - y0 < Math.max(socle, baseH)) c = baseH ? PLINTH(x, y, z) : SAND_D(x, y, z);
      else if (t < nb) { const r = rows[t]; c = typeof r === 'function' ? r(x, y, z) : r; }
      else if (frieze && t >= nb && t < nb + frieze) {
        const u = (x + z) % FRIEZE.length;
        c = FRIEZE[u];
      }
      if (c === null) {
        c = typeof wall === 'function' ? wall(x, y, z) : wall;
        const corner = (x === a0 || x === a1 - 1) && (z === b0 || z === b1 - 1);
        if (torus && corner && y - y0 >= socle && wall !== LIME) c = LIME(x, y, z);
        if (grime && y0 === 1) c = grimed(c, x, y, z, y - y0 - baseH + 2, false);
      }
      m.set(x, y, z, c);
    }
  }
  if (!solid) m.box(x0 + 2, y0, z0 + 2, x1 - x0 - 4, 1, z1 - z0 - 4, PAVE);
  const a0 = x0 + inset, a1 = x1 - inset, b0 = z0 + inset, b1 = z1 - inset;
  const fl = (x, z) => ((((x + z + 512) >> 1) & 1) ? gA : gB);
  let yp = top;
  if (cav) {
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const e = Math.min(x - a0, a1 - 1 - x, z - b0, b1 - 1 - z);
      m.set(x, top, z, e === 0 ? shade(fl(x, z), 0.78) : SAND_D(x, top, z));
    }
    for (let x = a0 - 1; x <= a1; x++) for (let z = b0 - 1; z <= b1; z++) {
      const e = Math.min(x - a0 + 1, a1 - x, z - b0 + 1, b1 - z);
      if (e === 0) m.set(x, top + 1, z, fl(x, z));
    }
    yp = top + 1;
  }
  const P = cav ? 1 : 0;
  const c0 = a0 - P, c1 = a1 + P, d0 = b0 - P, d1 = b1 + P;
  // the parapet: a wall row (flush) and the coping, two voxels thick; the
  // deck inside one row under the coping
  const pw = (x, y, z) => (typeof wall === 'function' ? wall(x, y, z) : wall);
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
    const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
    if (e <= 1) {
      if (!cav) m.set(x, yp, z, pw(x, yp, z));
      else if (e === 1) m.set(x, yp, z, LIP(x, yp, z));
      m.set(x, yp + 1, z, e === 1 && rim ? rimTeam : rimC);
    } else m.set(x, yp, z, roofC);
  }
  m.lastTop = { c0, c1, d0, d1, y: yp };
  return yp + 1;
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
    if (ex && ez) f *= 1.04;     // round 34: an even lit arris, no random dark corner voxels
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
          const j = 1;     // round 34: no per-cell tint (the ashlar carries the variation, per block)
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
            emit([P(ub, yb, plane(yb)), P(ub, yt, plane(yt)), P(ub, yt, dp(yt)), P(ub, yb, dp(yb))], ax.map((a) => -a * du), col(nv, dd > 2 ? 0.24 : dd > 1 ? 0.42 : 0.6), 0);
          }
          const [bs, bv] = nb(u, y - 1);
          if (bs === 1) emit([P(u, yb + 0.02, plane(yb)), P(u + 1, yb + 0.02, plane(yb)), P(u + 1, yb + 0.02, dp(yb)), P(u, yb + 0.02, dp(yb))], [0, 1, 0], col(bv, 0.86), 0);
          const [ts, tv] = nb(u, y + 1);
          if (ts === 1) emit([P(u, yt - 0.02, plane(yt)), P(u + 1, yt - 0.02, plane(yt)), P(u + 1, yt - 0.02, dp(yt)), P(u, yt - 0.02, dp(yt))], [0, -1, 0], col(tv, dd > 2 ? 0.26 : 0.45), 0);
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
            if (B.skip && B.skip[face] && u >= B.skip[face][0] && u < B.skip[face][1]) continue;
            const G = B.cav.gorge;
            _k.setHex(G.length > 2 ? G[((u % G.length) + G.length) % G.length] : ((u & 1) ? gA : gB));
            const f = (0.74 + 0.09 * r) * (B.cav.lift || 1);
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
          const sk = B.skip && B.skip[face];
          for (const [ua, ub] of sk ? [[Lc, sk[0]], [sk[1], Rc]] : [[Lc, Rc]]) emit([pt(ua, ta), pt(ub, ta), pt(ub, tb), pt(ua, tb)], n3, [_k.r, _k.g, _k.b], 0);
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
      const sl = (y) => (y - y0) / b, r = 0.4, NS = 6;
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
    const step = full.stageStep ?? (small ? 6 : 8);   // (a fine model sets its own pole and deck spacing)
    for (let x = x0; x < x1 - 3; x += step) xs.push(x);
    xs.push(x1);
    for (let z = z0; z < z1 - 3; z += step) zs.push(z);
    zs.push(z1);
    for (const x of xs) for (const z of [z0, z1]) m.box(x, 1, z, 1, sTop, 1, POLE);
    for (const z of zs) for (const x of [x0, x1]) m.box(x, 1, z, 1, sTop, 1, POLE);
    const walk = Math.max(3, cut - 1);
    const levels = new Set([walk]);
    for (let y = full.stageStep ?? 8; y < walk - 3; y += full.stageStep ?? 8) levels.add(y);
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
// a cluster of small clay jars on a grid round (x, z), a voxel apart
function pots(m, x, z, n = 3, seed = 0) {
  const at = [[0, 0], [4, 0], [2, 4], [6, 4], [-2, 4]];
  const cols = [0xb8683e, 0xc8a070, 0xa65a34, 0xd2b07c];
  for (let i = 0; i < Math.min(n, at.length); i++) jar(m, x + at[i][0], 1, z + at[i][1], cols[(i + seed) % cols.length]);
}
// a wicker basket heaped with goods (2 x 2 or 3 x 3)
function basket(m, x, z, kind, w = 2, y = 1) { wovenBasket(m, x, z, Math.max(3, w + 1), kind, y); }
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

// House (3 x 3 tiles; Retold building_03 / building_04; round 23): coursed
// whitewash (age 2+) or mud brick (Archaic) boxes on a dark base course,
// battered, under a two-row painted cavetto cornice (the gorge in a muted
// Egyptian blue or an ochre red, fluted) and a pale lip, the roof deck plain
// plaster with no outline on its top face; the owner's colour is the
// weathered line of every door lintel. Doorways are dark holes three voxels deep (near-black
// reveals, a dark leaf or an open black passage) in proud limestone frames.
// Six plans of different footprints and heights, so a quarter of houses never
// reads as one stamped tile (the renderer picks the plan from the sim's
// variant and the lot):
//   0  a main block and a lower side room under a palm-trunk awning
//   1  a roof terrace: a parapet round the roof, a stair hutch with its door
//   2  an L round a walled yard, a wind-catcher on the tall back block
//   3  a narrow tall tower house, a cloth awning over its jars in front
//   4  a wide low house, stacked jars on a rack on its roof, a palm awning
//   5  two blocks side by side, an outside stair up to the low one's
//      parapeted terrace, a wind-catcher on the tall one
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
// the painted gorges: a muted Egyptian blue and an ochre red (flute pairs)
const GORGE_BLUE = [0x6584ac, 0x7090b6];
const GORGE_RED = [0xb86c48, 0xc47c56];
const GORGE_MUD = [MUDCAP_D, 0xb8925f];
// dried palm fronds (the awnings' mats, the roof shades)
const FROND_DRY = (x, y, z) => pick(hash3(x, y, z, 71), [0xb09a60, 0xa08a52, 0xbca86c, 0x96804a, 0x8a7444]);
// a palm-trunk awning against a wall: ringed palm-trunk posts at the front
// (`posts`: positions along a), a palm-log beam on them, palm-log rafters
// from the wall out to the beam every second voxel, a mat of dried fronds on
// the rafters with a ragged fringe hanging over the front. f = the wall's
// last voxel on that face at row yTop.
function palmAwning(m, face, f, a0, a1, yTop, depth, { posts = null, ground = 1 } = {}) {
  const P = posts || [a0, a1 - 1];
  const put = (a, y, d, c) => {
    if (face === '+z') m.set(a, y, f + d, c);
    else if (face === '-z') m.set(a, y, f - d, c);
    else if (face === '+x') m.set(f + d, y, a, c);
    else m.set(f - d, y, a, c);
  };
  for (const a of P) for (let y = ground; y <= yTop; y++) put(a, y, depth, y % 3 === 0 ? 0x5e4630 : PALM_T(a, y, depth));
  for (let a = a0 - 1; a <= a1; a++) put(a, yTop + 1, depth, (a & 1) ? 0x7a5a38 : 0x6a4c2e);
  for (let a = a0; a < a1; a += 2) for (let d = 1; d < depth; d++) put(a, yTop + 1, d, (d & 1) ? 0x7a5a38 : 0x6a4c2e);
  for (let a = a0 - 1; a <= a1; a++) for (let d = 1; d <= depth + 1; d++) put(a, yTop + 2, d, FROND_DRY(a, yTop, d));
  for (let a = a0 - 1; a <= a1; a++) {
    if (hash3(a, yTop, depth, 72) < 0.7) put(a, yTop + 1, depth + 1, FROND_DRY(a, yTop + 1, depth + 1));
  }
}
// a parapet round a roof deck (m.lastTop): `h` rows of wall on the deck's
// outer ring, a pale coping, `gaps` = runs left open along +z ([a0, a1))
function roofParapet(m, T, h, wall, cap, gaps = []) {
  for (let x = T.c0; x < T.c1; x++) for (let z = T.d0; z < T.d1; z++) {
    const e = Math.min(x - T.c0, T.c1 - 1 - x, z - T.d0, T.d1 - 1 - z);
    if (e !== 0) continue;
    if (z === T.d1 - 1 && gaps.some(([a, b]) => x >= a && x < b)) continue;
    for (let y = T.y + 1; y < T.y + h; y++) m.set(x, y, z, wall);
    m.set(x, T.y + h, z, cap);
  }
}
// a wind-catcher (malqaf) on a roof: a narrow whitewashed shaft rising `h`
// over the deck at row y, its mouth (a dark opening in a palm-wood frame)
// near the top facing +z, a lean roof sloping from the mouth back
function windCatcher(m, x, z, y, w, d, h, wall) {
  // round 27: a clean shaft (no overhanging cap): its roof slopes down from
  // the high front, where the dark mouth opens to the wind under a pale
  // coping, to the back; the owner's line on the coping
  for (let k = 0; k < d; k++) {
    const hk = h - Math.floor((k * 2) / Math.max(1, d - 1));       // front h, back h - 2
    for (let yy = y; yy < y + hk; yy++) for (let i = 0; i < w; i++) m.set(x + i, yy, z + k, wall(x + i, yy, z + k));
    for (let i = 0; i < w; i++) m.set(x + i, y + hk, z + k, k === d - 1 ? LIP(x + i, y + hk, z + k) : LIME_S);
  }
  for (let i = 0; i < w; i++) m.set(x + i, y + h, z + d - 1, i === 0 || i === w - 1 ? LIP(x + i, y + h, z + d - 1) : TEAM);
  for (let yy = y + h - 3; yy < y + h; yy++) for (let i = 1; i < w - 1; i++) {
    m.set(x + i, yy, z + d - 1, REVEAL);
    if (d > 2) m.set(x + i, yy, z + d - 2, REVEAL2);
  }
}
// stacked storage jars on a roof: a reed mat, a bottom tier of `n` big
// jars touching in a row along x, a tier of n - 1 nested in the gaps on
// their shoulders
function jarStack(m, x0, y, z, n, cols) {
  for (let x = x0 - 1; x < x0 + n * 5 + 1; x++) for (let zz = z - 3; zz <= z + 3; zz++) m.set(x, y, zz, FROND_DRY(x, y, zz));
  for (let i = 0; i < n; i++) jar(m, x0 + 2.5 + i * 5, y + 1, z, cols[i % cols.length], true);
  for (let i = 0; i + 1 < n; i++) jar(m, x0 + 5 + i * 5, y + 7, z, cols[(i + 1) % cols.length]);
}
// an outside stair of mud brick up a wall: steps of `run` voxels along x
// from (x0, z0) rising one row each, `w` wide in z, a low pale kerb
function outStair(m, x0, z0, w, rise, dir, wall, cap) {
  for (let s = 0; s < rise; s++) {
    const x = x0 + s * dir;
    for (let k = 0; k < w; k++) {
      for (let y = 1; y <= s + 1; y++) m.set(x, y, z0 + k, y === s + 1 ? cap : wall);
    }
  }
}
// ---- houses (round 24) ---------------------------------------------------------
// (round 25 supersedes the wall treatment below: see '---- houses (round 25)')
// Six house plans that each read as their own function from the RTS camera,
// in materials that stand off the sand: a bright lime whitewash or a warm
// ochre plaster over a dark mud-brick dado, vertical walls (no batter: the
// battered pylon look belongs to the temples, barracks and camps), a
// painted band (two clean stripes, red over green or blue over red, a pale
// fillet between) under a strong cavetto cornice (a shadowed row, then two rows of painted
// leaves flaring one and two voxels out, a pale limestone lip), the roofs
// whitewashed or mud-plastered (never sand coloured), no outline on the
// deck. Archaic (age 1): the same plans in raw mud brick under thatch.
// (a touch cool in the albedo against the warm sun and shade light; the
// grade's sandstone pass still creams it, so the houses separate from the
// sand by value and paint: the white roofs above it, the ochre walls, dark
// dados and mud roofs below it)
const HWHITE = coursed([0xe2eaf5, 0xd8e0ec, 0xdfe7f2], { len: 7, bed: 0.94, head: 0.96, seed: 81 });
const HOCHRE = coursed([0xd3874a, 0xc97f43, 0xda8f52], { len: 7, bed: 0.9, head: 0.94, seed: 82 });
const HROOF_W = (x, y, z) => { const c = pick(hash3(x >> 1, y, z >> 1, 83), [0xbe9c70, 0xb8966a, 0xc3a176]); return (x % 6 === 0 || z % 6 === 0) ? shade(c, 0.95) : c; };
// the ochre houses' roofs: a dark mud plaster with reed-mat patches, a
// value under the sand so the deck reads against the ground from above
const HROOF_M = (x, y, z) => {
  if (hash3(x >> 2, y, z >> 2, 84) < 0.22) return FROND_DRY(x, y, z);
  const c = pick(hash3(x >> 1, y, z >> 1, 85), [0x8f6a4c, 0x86634a, 0x967252]);
  return (x % 5 === 0 || z % 5 === 0) ? shade(c, 0.92) : c;
};
const H_PALE = 0xe6edf6;
const H_R = 0xb03a26, H_G = 0x3a8a58, H_B = 0x2f5fa8;
// the cornice leaves: blue on the white houses, green and red on the ochre
// ones, a pale rib between every two
const HLEAF = [H_B, H_B, H_PALE];
const HLEAF_O = [H_G, H_G, H_PALE, H_R, H_R, H_PALE];
const HLEAF_MUD = [MUDCAP_D, MUDCAP_D, 0xc9a274, 0x9a7650, 0x9a7650, 0xc9a274];
// ---- houses (round 25) ---------------------------------------------------------
// Every house block is battered (the walls step a voxel inward every
// `batter` rows and skin() lays a smooth sloping plane over the steps, as on
// the temples), grimed at its foot (the bottom rows darken towards the
// ground, with drips: wall-to-ground contact), its corners picked out by a
// torus moulding in the house accent (an ochre red: the corner columns and
// the roll under the cornice; the door frames take the same red), then a
// thick cavetto cornice three rows deep in dark painted leaves (lapis and
// red ochre, darkest at the foot, flaring one, two and three voxels out)
// under a pale limestone lip, the roof deck a cool pale plaster (lighter and
// bluer than the sand, so every roof separates from the ground from above).
// Two wall finishes: whitewash and a darker red-brown mud plaster.
// Function props (kilns, grain heaps, looms, jars, ovens) stand on the
// ground outside the walls, never on the roofs.
const HACC = 0xa8432a;                         // the accent: ochre red (torus, door frames)
const HACC_D = 0x8a3622;
const HG_B = 0x30568c, HG_R = 0x9a3f28;        // the cornice leaves (shaded darker per row)
const HGORGE = [HG_B, HG_B, HG_R, HG_R];
const HGORGE_MUD = [0x7d5a3a, 0x7d5a3a, 0x94402a, 0x94402a];
const HMUDW = coursed([0xa8764c, 0xa06f47, 0xb07e54], { len: 6, bed: 0.88, head: 0.92, seed: 86 });
// the cool pale roof plaster (a faint slab grid)
const HROOF_C = (x, y, z) => { const c = pick(hash3(x >> 2, y, z >> 2, 87), [0xb59165, 0xaf8b5f, 0xba966b]); return (x % 5 === 0 || z % 5 === 0) ? shade(c, 0.94) : c; };
// ---- round 27 walls: flat brick coursing ------------------------------------
// two or three close tones by course (A B A C, `course` rows each), no
// per-voxel speckle; the head joints a faint shade every `len` voxels in a
// running bond, so a wall reads as horizontal courses, never a checker
function brick(tones, { course = 2, len = 6, head = 0.95, bed = 0.88 } = {}) {
  // round 47: a darker bed joint under every course (the walls read as laid
  // block, not plastic); a course is three rows (two-row courses with a dark
  // bed under each read as stripes)
  return ashlar(tones, { course: course === 2 ? 3 : course, len, head, bed, hi: 1, spread: 0.025, seed: 61 });
}
// a whitewashed limestone house wall (light, faintly cool so the grade's
// sandstone pass leaves it cream, not tan)
const EWHITE = brick([0xe9e4d6, 0xe1dbcb, 0xe5dfd0], { len: 7, head: 0.96 });
// a mud-brick wall: a clearly darker warm brown, the bricks shown by their
// head joints in a running bond
const EMUD = brick([0x9c7049, 0x936843, 0x8a613e], { course: 2, len: 5, head: 0.9 });
// a sandstone wall (camps, workshops): a mid ochre-sand
const ESAND = brick([0xd2ae78, 0xc9a56f, 0xcca974], { len: 7, head: 0.95 });
// roof decks: one mid plaster value, a step under the light walls and above
// the mud ones, with a few reed mats; never as light as the coping
const EDECK = (x, y, z) => {
  if (hash3(x >> 2, y, z >> 2, 93) < 0.12) return pick(hash3(x, y, z >> 1, 94), [0xa38b58, 0x9a8352]);
  return pick(hash3(x >> 3, y, z >> 3, 95), [0xbc9c6e, 0xb79769, 0xc0a173]);
};
// grime at a wall's foot: r = rows above the ground block's first row
const GRIME = [0.5, 0.62, 0.74, 0.84, 0.92, 0.97];
// (round 34: no per-column drip streaks by default, they broke the courses
// into vertical noise; a grimed ashlar colour keeps its link in ASH)
function grimed(c, x, y, z, r, drips = false) {
  if (r < 0) return c;
  let f = r < GRIME.length ? GRIME[r] : 1;
  const drip = hash3(x, 3, z, 88);
  if (drips && drip < 0.28 && r < 8) f *= 0.86 + r * 0.012;
  if (f === 1) return c;
  const out = shade(c, f);
  const e = ASH.get(c);
  if (e && !ASH.has(out)) ASH.set(out, { fn: e.fn, f: e.f * f });
  return out;
}
// Round 34: re-lay every ashlar voxel of a finished model on the face it
// shows, in that face's own coordinates (u = x on a face looking along z,
// u = z on one looking along x), so a battered wall's joints stay plumb
// through every batter step instead of stepping a voxel sideways (the
// diagonal "staircases" the old x + z bond drew over the skin)
function recourse(m) {
  for (const [x, y, z] of m.coords) {
    const v = m.get(x, y, z);
    if (!v || v.team || v.glow || v.clean) continue;
    const e = ASH.get(v.c);
    if (!e) continue;
    const ez = !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    const ex = !m.has(x + 1, y, z) || !m.has(x - 1, y, z);
    if (!ez && !ex) continue;
    const c = ez ? e.fn(x, y, 0) : e.fn(0, y, z);
    v.c = e.f === 1 ? c : shade(c, e.f);
  }
}
// Round 47: wear on the dressed faces. A few whole blocks of every ashlar
// face are set back a voxel (the outer voxel cut away, the one behind it
// darkened: a recessed / robbed block, drawn by skin() as a clean sunk cell
// on a battered face), a few more lose a corner voxel (a chipped arris).
// Chosen per block (course x block in the face's own coordinates), so a
// recess is always one whole block between its joints; only where the wall
// is at least three voxels deep, never at a corner, a foot or a painted row.
function chip(m, { rate = 0.035, nick = 0.05 } = {}) {
  const cut = [], dark = [];
  for (const [x, y, z] of m.coords) {
    if (y < 3) continue;
    const v = m.get(x, y, z);
    if (!v || v.team || v.glow || v.clean) continue;
    const e = ASH.get(v.c);
    if (!e || !e.fn.course || e.fn.course < 3) continue;
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !m.has(x + dx, y, z + dz));
    if (open.length !== 1) continue;
    const [dx, dz] = open[0];
    if (!m.has(x - dx, y, z - dz) || !m.has(x - 2 * dx, y, z - 2 * dz)) continue;
    if (!m.has(x, y + 1, z) || !m.has(x, y - 1, z)) continue;
    const { course, len } = e.fn;
    const yy = y - 1, row = Math.floor(yy / course), k = yy % course;
    if (k === 0) continue;                                    // the bed joint stays
    const u = (dz ? x : z) + (row & 1) * (len >> 1) + 512;
    const blk = Math.floor(u / len), ui = u % len;
    if (ui === 0) continue;                                   // the head joint stays
    const face = dx * 3 + dz + 7;
    const h = hash3(blk, row, face * 131 + (dz ? z : x), 4711);
    if (h < rate) cut.push([x, y, z, dx, dz, e]);
    else if (h < rate + nick && k === course - 1 && ui === 1) dark.push([x, y, z, dx, dz, e]);
  }
  for (const [x, y, z, dx, dz, e] of [...cut, ...dark]) {
    const b = m.get(x - dx, y, z - dz);
    if (!b) continue;
    m.remove(x, y, z);
    b.c = shade(e.fn(dz ? x : 0, y, dz ? 0 : z), 0.7);
    b.clean = 1;
  }
}
// a house block on [x0, x1) x [z0, z1) from y0, h wall rows, battered a
// voxel every `batter` rows (registered for skin()); sets m.lastTop to the
// lip ring and the deck (roofParapet() builds on it) and returns the row
// above the deck
function hbox(m, x0, z0, x1, z1, y0, h, { wall = EWHITE, roof = EDECK, batter = 0, grime = true, band = 'lapis', lipC = LIP, rim = true, pRows = 1, cav = true, torus = null, gorge = null } = {}) {
  // round 28: a battered block (a voxel in every `batter` rows, smoothed by
  // skin()) under an Egyptian cavetto cornice: a torus roll on the wall's
  // top row, the gorge (two rows of 2-voxel painted flutes, the lower on the
  // wall plane in shade, the upper one voxel out), a pale coping over it
  // (its inner ring the owner's line) and the deck sunk inside, a step
  // darker than the walls. cav: false keeps round 27's flush parapet.
  const top = y0 + h;
  if (y0 === 1 && m.feet) m.feet.push({ x0, z0, x1, z1, hb: 1 });
  if (batter && m.blocks) m.blocks.push({ x0, z0, x1, z1, y0, h, b: batter, base: 0 });
  const rows = !band ? [] : cav ? [torus ?? (band === 'red' ? LIP : HACC), ...bandRows(band).slice(0, h >= 8 ? 1 : 0)] : bandRows(band);
  const nb = cav ? rows.length : h >= 6 ? rows.length : Math.min(1, rows.length);
  let I = 0;
  for (let y = y0; y < top; y++) {
    I = batter ? Math.floor((y - y0) / batter) : 0;
    const a0 = x0 + I, a1 = x1 - I, b0 = z0 + I, b1 = z1 - I;
    const t = top - 1 - y;
    const r = grime && y0 === 1 ? y - y0 : -1;
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const edge = x === a0 || x === a1 - 1 || z === b0 || z === b1 - 1;
      if (!edge) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
      let c;
      if (t < nb) { const q = rows[t]; c = typeof q === 'function' ? q(x, y, z) : q; }
      else c = grimed(wall(x, y, z), x, y, z, r, false);
      m.set(x, y, z, c);
    }
  }
  let c0 = x0 + I, c1 = x1 - I, d0 = z0 + I, d1 = z1 - I;
  if (!cav) {
    for (let k = 0; k <= pRows; k++) {
      const y = top + k;
      for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
        const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
        if (e <= 1) m.set(x, y, z, k < pRows ? wall(x, y, z) : (e === 1 && rim ? TEAM : lipC));
        else if (k === 0) m.set(x, y, z, roof);
      }
    }
    m.lastTop = { c0, c1, d0, d1, y: top };
    return top + 1;
  }
  const [gA, gB] = gorge ? gorge : !band ? HGORGE_MUD.slice(1, 3) : band === 'red' ? [BAND_R, BAND_B] : band === 'ochre' ? [BAND_Y, BAND_R] : [BAND_B, BAND_R];
  const fl = (x, z) => ((((x + z + 512) >> 1) & 1) ? gA : gB);
  // the gorge's lower row on the wall plane (shaded), the deck's bed inside
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
    const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
    m.set(x, top, z, e === 0 ? shade(fl(x, z), 0.72) : SAND_D(x, top, z));
  }
  // the gorge's upper row one voxel out, the parapet and the coping on it;
  // cells outside the wall are laid only where nothing stands (a cornice
  // never cuts into the taller block it abuts)
  c0--; c1++; d0--; d1++;
  const soft = (x, y, z, c) => { if (!m.has(x, y, z)) m.set(x, y, z, c); };
  for (let k = 1; k <= pRows + 1; k++) {
    const y = top + k;
    for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) {
      const e = Math.min(x - c0, c1 - 1 - x, z - d0, d1 - 1 - z);
      if (e > 1) { if (k === 1) m.set(x, y, z, roof); continue; }
      const c = k === pRows + 1 ? (e === 1 && rim ? TEAM : lipC) : k === 1 && e === 0 ? fl(x, z) : wall(x, y, z);
      if (e === 0) soft(x, y, z, c); else m.set(x, y, z, c);
    }
  }
  m.lastTop = { c0, c1, d0, d1, y: top + 1 };
  return top + 2;
}
// a slim painted papyrus column (2 x 2) from y0 to y1 - 1: white shaft with
// red and blue rings, a green and blue flared capital, a pale abacus
function hcolumn(m, x, z, y0, y1) {
  for (let y = y0; y < y1; y++) for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
    const r = y - y0, t = y1 - 1 - y;
    let c = r === 0 ? MUDB(x + i, y, z + k) : t === 0 ? LIME(x + i, y, z + k) : t <= 2 ? ((i + k) & 1 ? H_G : H_B) : r % 4 === 1 ? H_R : r % 4 === 3 ? H_B : HWHITE(x + i, y, z + k);
    m.set(x + i, y, z + k, c);
  }
  for (const [a, b] of [[-1, 0], [-1, 1], [2, 0], [2, 1], [0, -1], [1, -1], [0, 2], [1, 2]]) { m.set(x + a, y1 - 2, z + b, H_G); m.set(x + a, y1 - 1, z + b, LIME); }
}
// an upright loom in a yard (the weaver's house): two posts, a top and a
// bottom beam along x from x0 (w wide) at z, pale warp threads, a length of
// woven cloth in red, blue and linen bands on the lower half
function loom(m, x0, z, w = 7, h = 9) {
  for (const x of [x0, x0 + w - 1]) for (let y = 1; y <= h; y++) m.set(x, y, z, POLE);
  for (let x = x0 - 1; x <= x0 + w; x++) { m.set(x, h + 1, z, DARKWOOD); m.set(x, 2, z, DARKWOOD); }
  const bands = [0xe9e0cc, 0xb03a26, 0xe9e0cc, 0x2f5fa8, 0xe9e0cc, 0xb03a26];
  for (let x = x0 + 1; x < x0 + w - 1; x++) for (let y = 3; y <= h; y++) {
    if (y <= 3 + bands.length - 1) m.set(x, y, z, bands[y - 3]);
    else if (x & 1) m.set(x, y, z, 0xd8ccb0);
  }
  // the weaver's stool and a basket of thread
  m.box(x0 + 2, 1, z + 2, 2, 1, 2, PLANK);
  basket(m, x0 + w + 1, z + 1, 'grain', 2);
}
// a heap of threshed grain on a reed mat (a cone of radius r), a winnowing
// basket, sacks and a wooden scoop
function grainHeap(m, cx, cz, r = 3.2, h = 5) {
  // round 28: a clean stepped mound on a round mat, two flat golds (the lit
  // crest of every terrace lighter), no speckle
  for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d > r + 0.7) continue;
    pset(m, x, 0, z, d > r - 0.3 ? 0x7d6440 : 0xa88a58);
    const hh = Math.round(h * (1 - d / (r + 0.4)));
    for (let y = 1; y <= hh; y++) pset(m, x, y, z, y === hh ? 0xe8c96e : 0xc9a24e);
  }
}
// a neat woodpile of squared palm logs along z (len long): two 2 x 2 logs a
// voxel apart, a third on top, pale end grain at both ends, flat bark sides
function woodPile(m, x0, z0, len) {
  for (const [x, y] of [[x0, 1], [x0 + 3, 1], [x0 + 1, 3]]) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < len; k++) {
    const end = k === 0 || k === len - 1;
    pset(m, x + i, y + j, z0 + k, end ? (i + j === 1 ? 0xb08a58 : ENDGRAIN) : j === 1 ? 0x86603c : 0x6c4a2c);
  }
}
// a stepped mud-brick beehive (round 28: square courses, corners cut, two
// flat mud tones by course, a pale plastered cap, a dark smoke hole), from
// the radii of its courses bottom first; returns the top row
function beehive(m, X, Z, radii) {
  radii.forEach((r, i) => prow(m, X, 1 + i, Z, r, i === 0 ? 0x6e4e30 : i === radii.length - 1 ? 0xc29a6b : i & 1 ? 0x936843 : 0x9c7049, r > 1));
  pset(m, X, radii.length, Z, 0x2a1e16);
  return radii.length;
}
// a bread oven: a small beehive with a glowing mouth on +z
function oven(m, cx, cz) {
  const X = Math.floor(cx), Z = Math.floor(cz);
  beehive(m, X, Z, [2, 2, 2, 2, 1, 1]);
  for (const y of [1, 2]) { pset(m, X, y, Z + 2, MOUTH); pset(m, X, y, Z + 1, y === 1 ? FIRE[2] : FIRE[1]); m.get(X, y, Z + 1).glow = 0.6; }
}
// ---- houses (round 46) ----------------------------------------------------------
// Four looks, not one module: each plan has its own footprint, height and
// roof, and one of three wall tints that stand apart from each other and
// from the sand by value and hue: a bright cool whitewash under a lapis
// cornice (the courtyard house, the baker's), a saturated ochre plaster
// under a red and green cornice (the potter's, the merchant's), a dark
// mud brick with a plain mud gorge and mud coping, no paint at all (the
// tower house, the terrace house, whose upper room is whitewashed). Only
// one plan carries a wind-catcher; the terrace roofs are reached by outside
// stairs, shaded by striped cloth or a frond mat on poles. Each house keeps
// ONE group of goods on the ground, its trade (a loom, a kiln, a grain heap,
// an oven, jars, a grain bin), never a general scatter of crates and sacks.
const HT_WHITE = brick([0xf6f4ee, 0xf0eee6, 0xf3f1ea], { len: 7, head: 0.97 });
const HT_OCHRE = brick([0xb4632a, 0xac5d27, 0xba692f], { len: 6, head: 0.92 });
const HT_MUD = brick([0x845834, 0x7c5231, 0x8b5e39], { course: 2, len: 5, head: 0.86 });
const HT_MUDP = brick([0xb48c5c, 0xab8456, 0xba9262], { course: 2, len: 5, head: 0.9 });
const HT_GREEN = [0x3a8a58, 0x2f7048];
// the ochre houses' coping: a red-ochre plaster, not the pale limestone lip
const HT_OCAP = (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 463), [0xa4502a, 0x9c4c28, 0xaa562e]);
// a frond mat on four poles over a roof terrace ([x0, x1) x [z0, z1), the
// deck at row y, the mat h rows above it)
function roofShade(m, x0, z0, x1, z1, y, h) {
  for (const [x, z] of [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]) for (let yy = y; yy < y + h; yy++) m.set(x, yy, z, PALM_T(x, yy, z));
  for (let x = x0 - 1; x <= x1; x++) for (let z = z0 - 1; z <= z1; z++) {
    const e = Math.min(x - x0 + 1, x1 - x, z - z0 + 1, z1 - z);
    if (e === 0 && hash3(x, y, z, 462) < 0.35) continue;      // a ragged edge
    m.set(x, y + h, z, (x - x0) % 3 === 0 ? 0x6a4c2e : FROND_DRY(x, y + h, z));
  }
}
function house(v, age) {
  const m = lot(24, 24);
  const arch = age === 1;
  // the three looks (age 1: all in raw mud brick under thatch, two tones)
  const W = arch ? { wall: HT_MUDP, roof: THATCH, lipC: MUDCAP, band: null, frame: MUDCAP_D, cap: MUDCAP, line: MUDCAP_D }
    : { wall: HT_WHITE, roof: EDECK, band: 'lapis', frame: HACC, cap: LIME, line: LIME_S };
  const O = arch ? { wall: EMUD, roof: THATCH, lipC: MUDCAP, band: null, frame: MUDCAP_D, cap: MUDCAP, line: MUDCAP_D }
    : { wall: HT_OCHRE, roof: TC_MAT, band: 'red', gorge: HT_GREEN, frame: HACC_D, cap: HT_OCAP, lipC: HT_OCAP, rim: false, line: LIME_S };
  const M = { wall: HT_MUD, roof: arch ? THATCH : HROOF_M, lipC: MUDCAP, band: null, frame: MUDCAP_D, cap: MUDCAP, line: MUDCAP_D, rim: arch };
  const onFace = (face, u, y, c) => { const p = outer(m, face, u, y, lim(m)); if (p) m.set(p[0], p[1], p[2], c); };
  const fdir = (face) => (face === '+z' || face === '-x' ? 1 : -1);
  // a door cut into the wall plane, its frame painted, the owner's line over it
  const dr = (S, face, u, w, h, open = false) => {
    door(m, face, u, w, 1, h, { deep: 3, leaf: !open, leafShade: 0.45, lintel: false, frame: S.frame, proud: false });
    for (let i = -1; i <= w; i++) onFace(face, u + i * fdir(face), 1 + h + 1, arch ? S.line : TEAM);
  };
  // a row of three window slits between two painted rules
  const hw = (S, face, u, y0, n = 3) => {
    const d = fdir(face);
    for (let k = 0; k < n; k++) slit(m, face, u + 2 * k * d, y0, 2, 1, { lintel: false, sill: false });
    for (let i = -1; i <= 2 * n - 1; i++) { onFace(face, u + i * d, y0 + 2, S.line); onFace(face, u + i * d, y0 - 1, S.line); }
  };
  if (v === 0) {
    // the weaver's courtyard house (whitewash): a two-storey block at the
    // back, a low wing beside it, a walled court in front entered through a
    // painted gate, the upright loom in the court
    hbox(m, 3, 3, 14, 12, 1, 12, { ...W, batter: 4 });
    hbox(m, 14, 5, 21, 12, 1, 6, { ...W, batter: 4 });
    dr(W, '+z', 7, 3, 6);
    hw(W, '+z', 7, 9); hw(W, '-x', 6, 8); hw(W, '-z', 6, 8); hw(W, '+z', 16, 4, 2);
    for (let x = 4; x < 21; x++) for (let z = 13; z < 21; z++) m.set(x, 0, z, PAVE);
    yardWall(m, [[3, 13], [3, 21], [21, 21], [21, 13]], 4, W.wall, W.cap, [[11, 21], [12, 21], [13, 21]]);
    for (const x of [10, 14]) for (let y = 1; y <= 6; y++) m.set(x, y, 21, y === 1 ? PLINTH : W.frame);
    for (let x = 10; x <= 14; x++) { m.set(x, 7, 21, arch ? MUDCAP_D : TEAM); m.set(x, 8, 21, W.cap); }
    loom(m, 13, 15, 6, 7);
  } else if (v === 1) {
    // the potter's workshop (ochre): one deep square block whose front is a
    // portico of three painted columns, the wheel in its shade; the kiln
    // outside, two amphorae of the day's firing by it
    hbox(m, 3, 3, 17, 17, 1, 9, O);
    for (let x = 4; x < 16; x++) for (let z = 12; z < 17; z++) for (let y = 1; y < 7; y++) m.remove(x, y, z);
    for (let x = 4; x < 16; x++) for (let y = 1; y < 7; y++) m.set(x, y, 11, y > 4 ? REVEAL2 : shade(O.wall(x, y, 11), 0.62));
    for (let x = 4; x < 16; x++) for (let z = 12; z < 17; z++) m.set(x, 0, z, PAVE);
    for (const x of [5, 9, 13]) {
      if (arch) { for (let y = 1; y < 7; y++) for (let i = 0; i < 2; i++) m.set(x + i, y, 15, PALM_T(x, y, 15)); }
      else hcolumn(m, x, 15, 1, 7);
    }
    hw(O, '-x', 6, 6); hw(O, '-z', 6, 6);
    lathe(m, 12, 13, 1, 3, () => 1.2, DARKWOOD); lathe(m, 12, 13, 3, 4, () => 1.8, 0x7a5634); lathe(m, 12, 13, 4, 6, (y) => (y === 4 ? 0.9 : 0.6), CLAY);
    beehive(m, 20, 7, [3, 3, 3, 3, 3, 3, 2, 2, 2, 1, 1]);
    for (let y = 1; y < 4; y++) { pset(m, 20, y, 10, MOUTH); pset(m, 20, y, 9, REVEAL); }
    pset(m, 20, 1, 9, FIRE[2]); m.get(20, 1, 9).glow = 0.6; pset(m, 20, 2, 9, FIRE[1]); m.get(20, 2, 9).glow = 0.6;
    amphora(m, 19.5, 1, 14.5, 0); amphora(m, 19.5, 1, 19.5, 2);
  } else if (v === 2) {
    // the tower house (mud brick): a narrow battered tower three storeys
    // tall, a low store against it whose roof terrace is reached by an
    // outside stair and shaded by a frond mat on poles; the threshing floor
    // in front, one heap of grain
    hbox(m, 3, 3, 11, 11, 1, 17, { ...M, batter: 6 });
    hbox(m, 11, 5, 20, 13, 1, 7, { ...M, batter: 4 }); const U = m.lastTop;
    dr(M, '+z', 5, 3, 6);
    hw(M, '+z', 5, 10, 2); hw(M, '+z', 5, 14, 2); hw(M, '-x', 5, 11, 2); hw(M, '-z', 6, 12, 2);
    outStair(m, 21, 14, 2, 8, -1, HT_MUD, MUDCAP);
    roofShade(m, U.c0 + 2, U.d0 + 2, U.c1 - 2, U.d1 - 2, U.y, 5);
    grainHeap(m, 7, 18.5, 3, 4);
  } else if (v === 3) {
    // the baker's house (whitewash): a wide block with a roof room at the
    // back of its terrace, a blue and white striped cloth over the shop
    // front on three poles, the bread oven at the corner
    const t = hbox(m, 5, 3, 21, 13, 1, 10, { ...W, batter: 5 }); const T = m.lastTop;
    hbox(m, T.c0 + 2, T.d0 + 2, T.c0 + 9, T.d0 + 7, t, 5, { ...W, grime: false });
    dr(W, '+z', 11, 3, 5);
    hw(W, '-x', 6, 6); hw(W, '+x', 7, 6); hw(W, '-z', 9, 6);
    if (arch) palmAwning(m, '+z', 12, 6, 20, 6, 5, { posts: [6, 13, 19] });
    else clothAwning(m, '+z', 12, 6, 20, 8, 6, 3, { posts: [6, 13, 19], sw: 2, sag: 0.6, belly: 0.4, stripes: [MKT_AW, MKT_AWW], hem: 0x1f3c78 });
    oven(m, 3, 19);
    basket(m, 14, 15, 'date', 3);
  } else if (v === 4) {
    // the jar merchant (ochre): a long low house, the one wind-catcher of
    // the set at its end, a frond awning on palm posts over a row of jars
    const t = hbox(m, 2, 6, 22, 14, 1, 7, { ...O, batter: 4 }); const T = m.lastTop;
    windCatcher(m, T.c1 - 7, T.d0 + 2, t, 4, 3, 7, O.wall);
    dr(O, '+z', 5, 3, 4);
    hw(O, '-x', 8, 4); hw(O, '+x', 8, 4); hw(O, '-z', 6, 4); hw(O, '-z', 14, 4);
    palmAwning(m, '+z', 13, 10, 21, 6, 5, { posts: [10, 15, 20] });
    jar(m, 12, 1, 16, 0xd8c8a0, true); jar(m, 17.5, 1, 16, 0xb8683e, true);
  } else {
    // the terrace house: a wide mud-brick ground floor, a whitewashed upper
    // room set back on its left half, the rest an open terrace reached by
    // an outside stair along the front; a mud grain bin by the door
    hbox(m, 3, 4, 21, 15, 1, 7, { ...M, batter: 4 }); const U = m.lastTop;
    hbox(m, U.c0 + 2, U.d0 + 2, U.c0 + 10, U.d1 - 3, U.y, 7, { ...W, grime: false });
    dr(M, '+z', 6, 3, 5);
    hw(W, '+z', U.c0 + 4, U.y + 3, 2); hw(M, '-x', 7, 4); hw(M, '-z', 6, 4);
    outStair(m, 22, 16, 2, 8, -1, HT_MUD, MUDCAP);
    for (let r = 0; r < 5; r++) prow(m, 4, 1 + r, 20, 2, r === 0 ? 0x5e4028 : r & 1 ? 0x8a5d38 : 0x815634, true);
    prow(m, 4, 6, 20, 2, 0xc29a6b, true); prow(m, 4, 7, 20, 1, 0xcfa97c, true); pset(m, 4, 8, 20, 0x6a4a2c);
  }
  return m;
}

// Granary (3 x 3; building_05): the flat-roofed store at the back left in
// battered mud brick under a painted cavetto and a parapet, a framed roof
// hatch, the door in its front, the owner's line on the coping; two big domed brick silos in a
// row along its east side (the silhouette). Round 29: as in building_05 the
// store's faces stay clear so the painted frieze runs unbroken round it: no
// roof banner, no gangways from the roof to the silos, the one ladder
// leaning on the west wall with its feet on the ground; the goods are one
// clean group each: an open crate of grain beside the
// door, a clay jar at each front corner.
function granary() {
  const m = lot(24, 24);
  const t = block(m, 1, 2, 11, 21, 1, 9, { wall: EMUD, roofC: EDECK, rimC: LIME, gorge: [BAND_B, BAND_R], torus: false, lipOut: 2, batter: 4, band: 'ochre', grime: false, rim: true });
  const T = m.lastTop;
  // the roof hatch with a timber frame
  for (let x = T.c0 + 3; x < T.c0 + 6; x++) for (let z = T.d0 + 9; z < T.d0 + 13; z++) m.set(x, t - 1, z, DARK);
  for (let x = T.c0 + 2; x < T.c0 + 7; x++) for (const z of [T.d0 + 8, T.d0 + 13]) m.set(x, t, z, 0x8a6a48);
  for (let z = T.d0 + 8; z < T.d0 + 14; z++) for (const x of [T.c0 + 2, T.c0 + 6]) m.set(x, t, z, 0x8a6a48);
  // the door in the middle of the front, framed in timber and kept under
  // the painted band (rows 7..9) so the frieze runs unbroken over it
  door(m, '+z', 5, 2, 1, 4, { frame: 0x7a5a3c, proud: false, lintel: false });
  // the silos
  silo(m, 17.5, 6.5, 1, 4.8, 14, { dome: 0.85 });
  silo(m, 17.5, 17.5, 1, 4.6, 12, { dome: 0.85 });
  // the ladder leaning on the west wall up to the roof, its feet on the ground
  ladder(m, [0.2, 0.6, 9.5], [2.2, t + 0.8, 9.5]);
  // an open crate of grain right of the door, a clay jar at each front
  // corner (square rows, a dark mouth: no round barrel lumps)
  goodsBox(m, 8, 1, 21, 4, 3, 'grain', 2, 0x8a6236);
  for (const x of [9, 10]) pset(m, x, 3, 22, 0xe8c96e);
  jar(m, 2, 1, 22, 0xb8683e); jar(m, 13, 1, 22, 0xa85c36);
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
// round 30 props: a few clean primitives, each voxel one flat colour (pset,
// so weather() leaves them alone), dark bark against pale cut ends and pale
// sand, a voxel of sand round every prop and the door's path left clear.
const LC_BARK = 0x5a3920, LC_BARK_D = 0x432a17, LC_BARK_L = 0x6e4829;
const LC_END = 0xf2e0b4, LC_RING = 0xdcb67a, LC_HEART = 0xb07a40;
const LC_LEG = 0x3a2414, LC_PLANK = 0xc29058, LC_PLANK_L = 0xd6a96c;
const LC_STEEL = 0x4f565d, LC_EDGE = 0xe8ecf0, LC_HAFT = 0x7a4c24;
// a round log of 4 x 4 section with its corners cut (so the silhouette and
// the cut end read round) along x or z: the bark darker on the lower side,
// lit along the top; both ends a pale cut disc round a warm 2 x 2 heart
function cleanLog(m, x0, y, z0, len, along = 'z') {
  for (let s = 0; s < len; s++) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    if ((a === 0 || a === 3) && (b === 0 || b === 3)) continue;
    const end = s === 0 || s === len - 1, heart = a > 0 && a < 3 && b > 0 && b < 3;
    const c = end ? (heart ? LC_HEART : LC_END) : b === 3 ? LC_BARK_L : b === 0 ? LC_BARK_D : LC_BARK;
    if (along === 'z') pset(m, x0 + a, y + b, z0 + s, c); else pset(m, x0 + s, y + b, z0 + a, c);
  }
}
// a clean crate (n >= 4): flat boards inside a darker frame on every edge,
// a dark diagonal brace across the front (+z) face
function cleanCrate(m, x, y, z, n, c = 0xb48a52) {
  const e = shade(c, 0.66), br = shade(c, 0.8);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const ex = i === 0 || i === n - 1, ey = j === 0 || j === n - 1, ez = k === 0 || k === n - 1;
    let col = (ex && ey) || (ey && ez) || (ex && ez) ? e : c;
    if (col === c && k === n - 1 && i === j) col = br;
    pset(m, x + i, y + j, z + k, col);
  }
}
function lumberCamp() {
  const m = lot(24, 24);
  block(m, 2, 3, 13, 15, 1, 13, { wall: ESAND, roofC: EDECK, rimC: LIME, gorge: [0x963f2a, 0xa5492f], torus: false, lipOut: 2, batter: 5, band: null, flare: true });
  // the door, centred on the front and clear of every prop (its worn path
  // runs straight out to the lot edge)
  door(m, '+z', 6, 4, 1, 6);
  slit(m, '+x', 7, 6, 2, 1);
  // the canvas from the block's east face over the stock
  const yTop = 10, f = 12 - Math.floor((yTop - 1) / 5);
  clothAwning(m, '+x', f, 4, 19, yTop, 22 - f, 2.5, { posts: [4, 11, 18], sw: 2, belly: 0.5, sag: 1.2 });
  // the stock (building_06): round logs stacked 3 over 2 along z under the
  // canvas, a voxel of shade between neighbours so every pale cut end reads
  // as its own disc, the upper logs bedded in the gaps
  // (the lower ends out past the canvas's edge into the sun)
  for (const x of [13, 18]) cleanLog(m, x, 1, 6, 14, 'z');
  cleanLog(m, 15, 4, 7, 12, 'z');
  cleanLog(m, 20, 4, 8, 10, 'z');
  // the sawhorse (front left, west of the door's path): splayed dark legs
  // at each end, a pale two-board plank along the top, the saw lying on it
  // (a grey blade with a bright toothed edge, a dark haft across its end)
  for (const z of [18, 22]) {
    pset(m, 0, 1, z, LC_LEG); pset(m, 3, 1, z, LC_LEG);
    for (const y of [2, 3]) { pset(m, 1, y, z, LC_LEG); pset(m, 2, y, z, LC_LEG); }
  }
  for (let z = 17; z <= 23; z++) for (const x of [1, 2]) pset(m, x, 4, z, z === 17 || z === 23 ? LC_PLANK : LC_PLANK_L);
  for (let z = 19; z <= 22; z++) { pset(m, 1, 5, z, LC_STEEL); pset(m, 2, 5, z, LC_EDGE); }
  pset(m, 1, 5, 23, LC_HAFT); pset(m, 2, 5, 23, LC_HAFT); pset(m, 1, 6, 23, LC_HAFT);
  // the stump (between the door's path and the stock's ends, low):
  // bark sides, a pale cut top round a warm heart, an axe planted in it (a
  // dark steel head with a bright edge biting the top, the haft rising and
  // leaning back)
  const SX = 11, SZ = 22;
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    const corner = i !== 0 && k !== 0;
    for (let y = 1; y <= 2; y++) pset(m, SX + i, y, SZ + k, corner ? LC_BARK_D : LC_BARK);
    pset(m, SX + i, 3, SZ + k, i === 0 && k === 0 ? LC_HEART : corner ? LC_RING : LC_END);
  }
  pset(m, SX, 4, SZ + 1, LC_EDGE); pset(m, SX, 4, SZ, LC_STEEL); pset(m, SX, 5, SZ, LC_STEEL); pset(m, SX, 5, SZ + 1, LC_STEEL);
  for (let y = 5; y <= 8; y++) pset(m, SX, y, y < 7 ? SZ - 1 : SZ - 2, LC_HAFT);
  // a clean barrel at the front right corner (square rows, corners cut:
  // staves, a dark iron hoop, a pale lid) and the crates at the back
  for (let y = 1; y <= 4; y++) for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    if (i !== 0 && k !== 0) continue;
    pset(m, 22 + i, y, 22 + k, y === 2 ? 0x3e3a36 : y === 4 && i === 0 && k === 0 ? 0xd2a66c : y === 4 ? 0xa8743e : 0x8e5c30);
  }
  cleanCrate(m, 18, 1, 0, 4);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) pset(m, 19 + i, 5 + j, 1 + k, j === 1 ? 0xc49a60 : 0xae8450);
  return m;
}

// Mining Camp (3 x 3; building_07; round 31): one solid stone house, not a
// stack of slabs: a slightly battered sandstone block (a voxel in 7 rows,
// smoothed by skin()) in strong block courses (dark bed and head joints)
// from a dark base course to a single thin lapis stripe at its top, then the
// Egyptian cavetto (two rows of paired sandstone flutes, the lower in shade
// on the wall plane, the upper a voxel out) carrying one thick limestone
// roof slab flush with the upper flutes, two rows deep, its coping ring
// round a sunk cream deck with the owner's line on the coping's inner edge
// (Retold's blue inset). Two flat, taut canvas awnings (no belly, no sag: a
// straight slope from a batten on the wall to the front edge) on dark posts
// at their outer corners, the front-left one over a dark timber ore bin
// heaped with gold ore, the east one over a stone water trough. The props
// each in their own colour and value, flat voxels (pset, never weathered):
// gold-yellow nuggets (a little self-lit so the grade keeps them yellow),
// dark crates with light / dark plank rows, round terracotta pots, a hooped
// barrel; the door's path left clear.
const MC_FLUTE = [0xd9ba86, 0xc29c66];
const MC_BIN = 0x6a4426, MC_BIN_L = 0x7d5432, MC_BIN_D = 0x3a2414;
const MC_GOLD = [0xe8c400, 0xd8b000, 0xf6dc00], MC_GOLD_S = 0xae8a00, MC_GOLD_D = 0x6e5200;
const MC_CRATE = 0x50301a, MC_CRATE_L = 0x845a32, MC_CRATE_E = 0x2e1a0c;
// the camp's sandstone: warm blocks in strong courses (dark bed joints,
// darker head joints) so every course reads from the RTS camera
const MC_WALL = coursed([0xc8945a, 0xae7c48, 0xd2a068], { course: 3, len: 6, bed: 0.6, head: 0.7, seed: 133 });
// gold: a light yellow with no blue (lit as metal by egypt_building.gdshader,
// read by value against the dark bin)
const gset = pset;
// a terracotta pot (5 x 5 belly, corners cut): a dark foot, the belly, a lit
// shoulder, a narrow neck round a dark mouth
function mcPot(m, X, Z, c = 0xb5552e) {
  prow(m, X, 1, Z, 1, shade(c, 0.7));
  prow(m, X, 2, Z, 2, shade(c, 0.86), true);
  prow(m, X, 3, Z, 2, c, true);
  prow(m, X, 4, Z, 2, shade(c, 1.12), true);
  prow(m, X, 5, Z, 1, (i, k) => (i === 0 && k === 0 ? MOUTH : shade(c, 1.2)), true);
}
const MC_DECK = (x, y, z) => (hash3(x >> 2, y, z >> 2, 131) < 0.5 ? 0xd8c39a : 0xd2bc92);
// a dark crate (w x h x d): every edge a near-black frame, the faces light and
// dark plank rows in turn, the lid's boards the other way
function mcCrate(m, x, y, z, w, h, d) {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) {
    const ex = i === 0 || i === w - 1, ey = j === 0 || j === h - 1, ez = k === 0 || k === d - 1;
    if (!ex && !ey && !ez) continue;
    let c = (ex && ey) || (ey && ez) || (ex && ez) ? MC_CRATE_E : (j & 1) ? MC_CRATE_L : MC_CRATE;
    if (j === h - 1 && !ex && !ez) c = (i & 1) ? MC_CRATE_L : MC_CRATE;   // the lid's boards
    pset(m, x + i, y + j, z + k, c);
  }
}
// a gold nugget (2 x 2 x 2 from (x, z), a knob on top): bright yellow tops,
// an ochre side, a dark foot
function mcNugget(m, x, z, s = 0) {
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
    gset(m, x + i, 1, z + k, (i + k + s) & 1 ? MC_GOLD_S : MC_GOLD_D);
    gset(m, x + i, 2, z + k, MC_GOLD[(i + 2 * k + s) % 2]);
  }
  gset(m, x + (s & 1), 3, z + ((s >> 1) & 1), MC_GOLD[2]);
}
function miningCamp() {
  const m = lot(24, 24);
  const X0 = 5, Z0 = 3, X1 = 17, Z1 = 13, Y0 = 1, H = 12, B = 7, top = Y0 + H;
  if (m.feet) m.feet.push({ x0: X0, z0: Z0, x1: X1, z1: Z1, hb: 1 });
  m.blocks.push({ x0: X0, z0: Z0, x1: X1, z1: Z1, y0: Y0, h: H, b: B, base: 0 });
  let I = 0;
  for (let y = Y0; y < top; y++) {
    I = Math.floor((y - Y0) / B);
    const a0 = X0 + I, a1 = X1 - I, b0 = Z0 + I, b1 = Z1 - I, t = top - 1 - y;
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const edge = x === a0 || x === a1 - 1 || z === b0 || z === b1 - 1;
      if (!edge) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
      let c;
      if (y === Y0) c = SAND_D(x, y, z);                                   // the dark base course
      else if (t === 0) c = (x + z) % 6 === 0 ? shade(LAPIS, 0.8) : LAPIS;  // the thin painted stripe
      else c = grimed(MC_WALL(x, y, z), x, y, z, y - Y0, false);
      m.set(x, y, z, c);
    }
  }
  const c0 = X0 + I, c1 = X1 - I, d0 = Z0 + I, d1 = Z1 - I;
  const fl = (x, z) => MC_FLUTE[((x + z + 512) >> 1) & 1];
  const ring = (x, z, p) => Math.min(x - (c0 - p), (c1 - 1 + p) - x, z - (d0 - p), (d1 - 1 + p) - z);
  // the cavetto: the lower row on the wall plane in shade, the upper a voxel out
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) m.set(x, top, z, ring(x, z, 0) === 0 ? shade(fl(x, z), 0.74) : SAND_D(x, top, z));
  for (let x = c0 - 1; x <= c1; x++) for (let z = d0 - 1; z <= d1; z++) {
    const e = ring(x, z, 1);
    m.set(x, top + 1, z, e === 0 ? fl(x, z) : SAND_D(x, top + 1, z));
  }
  // the roof slab flush with the cavetto's upper row (so the flutes read as
  // its flared underside), two rows deep: the deck sunk inside the coping
  // ring, the owner's line on the ring's inner edge
  for (let x = c0 - 1; x <= c1; x++) for (let z = d0 - 1; z <= d1; z++) {
    const e = ring(x, z, 1);
    m.set(x, top + 2, z, e <= 1 ? LIME(x, top + 2, z) : MC_DECK(x, top + 2, z));
    if (e <= 2) m.set(x, top + 3, z, e === 2 ? TEAM : LIP(x, top + 3, z));
  }
  m.lastTop = { c0: c0 - 1, c1: c1 + 1, d0: d0 - 1, d1: d1 + 1, y: top + 2 };
  // the door: a dark sandstone frame under a timber lintel (no pale
  // limestone frame to break the wall's courses)
  door(m, '+z', 11, 4, 1, 5, { deep: 3, frame: SAND_D, lintel: false });
  for (let x = 9; x <= 16; x++) pset(m, x, 6, Z1, x === 9 || x === 16 ? MC_BIN : MC_BIN_D);
  slit(m, '-z', 11, 6, 3, 1); slit(m, '-x', 8, 6, 3, 1);   // one slit a face (a pair reads as eyes)
  // the awnings: flat taut canvas (belly 0, sag 0) under the stripe, on dark
  // posts at the outer corners
  const yTop = 8, inset = Math.floor((yTop - Y0) / B);
  const AW = { sw: 2, sag: 0, belly: 0, post: MC_BIN_D };
  clothAwning(m, '+z', Z1 - 1 - inset, 1, 10, yTop, 6, 2, AW);
  clothAwning(m, '+x', X1 - 1 - inset, 4, 12, yTop, 6, 2, AW);
  // the ore bin against the front wall: dark planks (two boards a side split
  // by a darker line), near-black corner posts, heaped bright gold ore
  for (let x = 2; x < 9; x++) for (let z = 13; z < 19; z++) {
    pset(m, x, 1, z, MC_BIN_D);
    const rim = x === 2 || x === 8 || z === 13 || z === 18, corner = (x === 2 || x === 8) && (z === 13 || z === 18);
    for (let y = 2; y < 5; y++) {
      if (corner) pset(m, x, y, z, MC_BIN_D);
      else if (rim) pset(m, x, y, z, y === 3 ? MC_BIN_D : y === 4 ? MC_BIN_L : MC_BIN);
      else if (y === 4) gset(m, x, y, z, MC_GOLD_S); else pset(m, x, y, z, MC_BIN_D);
    }
    if (!rim) gset(m, x, 5, z, MC_GOLD[(x * 3 + z) % 2]);
  }
  for (let x = 4; x < 7; x++) for (let z = 15; z < 17; z++) gset(m, x, 6, z, (x + z) % 3 === 0 ? MC_GOLD[2] : MC_GOLD[0]);
  // the water trough against the east wall: a darker footing course a voxel
  // proud, sandstone sides, a limestone coping, the water a voxel down
  for (let x = 17; x < 22; x++) for (let z = 4; z < 12; z++) m.set(x, 1, z, SAND_D);
  for (let x = 17; x < 21; x++) for (let z = 5; z < 11; z++) {
    const rim = x === 17 || x === 20 || z === 5 || z === 10;
    m.set(x, 2, z, rim ? SAND(x, 2, z) : WATER);
    if (rim) m.set(x, 3, z, LIME(x, 3, z));
  }
  // a hooped barrel by the trough (square rows, corners cut: staves, two dark
  // iron hoops, a pale lid)
  for (let y = 1; y <= 5; y++) for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    if (i !== 0 && k !== 0 && y !== 3) continue;
    pset(m, 22 + i, y, 13 + k, y === 2 || y === 4 ? 0x2e2a26 : y === 5 ? (i === 0 && k === 0 ? 0xd2a66c : 0xa8743e) : 0x8e5c30);
  }
  // dark crates right of the door; terracotta pots at the front
  // right; gold nuggets on the sand in front of the bin
  mcCrate(m, 15, 1, 15, 3, 4, 4);
  mcCrate(m, 15, 1, 20, 5, 3, 3);
  mcPot(m, 21, 17, 0xb5552e);
  jar(m, 21, 1, 22, 0xa84a26);
  mcNugget(m, 3, 20, 0); mcNugget(m, 7, 20, 1); mcNugget(m, 5, 22, 2);
  return m;
}

// Town Center (7 x 7; building_02, building_01; round 26): a walled
// compound whose every structure has its own height, silhouette and use, so
// the eye reads them apart from the RTS camera:
// - the gateway (the tallest and the strongest colour): two battered
//   pylons with wide painted bands and reliefs, the gate block with a deep
//   passage and the gilt winged sun;
// - the sanctuary (centre back): a stepped temple of three receding tiers,
//   each under its own flared cavetto cornice (red, lapis, the owner's band),
//   a latticed door and a dark shrine opening above it;
// - the colonnaded hall (back right): a low pillared hall, its reed-mat
//   roof carried on a row of painted papyrus columns along the front and the
//   courtyard side, a deep shadowed portico in front of an ochre back wall,
//   the open court before it (jars, a goods box) so the columns show;
// - the granary: a big domed brick silo at the front left (ladder, sacks)
//   and a small domed silo turret on the front-right corner of the wall;
// - the sandstone falcon-headed Ra statue with gold regalia and the owner's
//   kilt on a sandstone plinth at the front-left corner.
// Roofs are a warm mud plaster a step under the walls (never the brightest
// thing); the hall's and the silos' a darker mud, so each roof reads apart.
// Interior buildings are drawn in their own scratch model (inner()) so their
// doors and slits never cut through the enclosure wall in front of them
// (voxels only: poly() meshes such as silo() go on the lot model itself).
const TC_SAND = [0x9a7448, 0xc8a26c, 0xdcb984, 0xeacc96];   // the statue's sandstone ramp: deep, shade, base, light
function tcSandstone(c, x, y, z) {
  if ([GRAN_R, GRAN_D, 0x151820, 0x1f2432, PL_GRAN_D].includes(c)) return TC_SAND[0];
  if ([GRAN_H, GRAN_F, 0x58637a, 0x4b556c].includes(c)) return TC_SAND[3];
  if ([GRAN, GRAN_G, GRAN_G2, 0x353d50, 0x3d465a, 0x2f3646].includes(c)) return hash3(x, y, z, 311) < 0.2 ? TC_SAND[1] : TC_SAND[2];
  if (c === PL_GRAN) return shade(TC_SAND[1], 0.92 + 0.06 * hash3(x >> 1, y, z >> 1, 312));
  if (c === DARK2) return TC_SAND[0];
  return c;
}
function inner(m, fn) {
  const s = new Rec(m.W, m.D);
  s.blocks = m.blocks; s.feet = m.feet; s.paths = m.paths; s.cloths = m.cloths;
  const r = fn(s);
  for (const [x, y, z] of s.coords) {
    const v = s.get(x, y, z);
    if (!v) continue;
    m.set(x, y, z, v.c);
    Object.assign(m.get(x, y, z), v);
  }
  if (s.fine) (m.fine ??= []).push(...s.fine);
  return r;
}
// a painted papyrus column (2 x 2) from y0 to y1 - 1 in sandstone: a dark
// foot, a sandstone shaft with red and lapis binding bands, a green bell
// capital flaring a voxel each way under a pale abacus
function tcColumn(m, x, z, y0, y1) {
  for (let y = y0; y < y1; y++) for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
    const r = y - y0, t = y1 - 1 - y;
    const c = r === 0 ? PLINTH(x + i, y, z + k) : t === 0 ? LIME(x + i, y, z + k) : t <= 2 ? ((i + k) & 1 ? H_G : 0x2f7048) : t === 3 ? RED_B : t === 4 ? LAPIS : r === 1 ? LIME_S : SAND(x + i, y, z + k);
    m.set(x + i, y, z + k, c);
  }
  for (const [a, b] of [[-1, 0], [-1, 1], [2, 0], [2, 1], [0, -1], [1, -1], [0, 2], [1, 2]]) { m.set(x + a, y1 - 2, z + b, H_G); m.set(x + a, y1 - 1, z + b, LIME); }
}
// the hall's roof: a reed-mat deck laid in strips across the beams (palm
// ribs every third row), a different material from every plaster roof
const TC_HALLROOF = (x, y, z) => { const c = pick(hash3(x, y, z >> 1, 313), [0xa08a58, 0x968050, 0xaa9462, 0x8c7648]); return z % 3 === 0 ? shade(c, 0.8) : c; };
// Round 35: a roof read as a laid deck, not a blank slab. (x0, z0, x1, z1) is
// the coping's outer rectangle, `y` the deck row; the ring e < cw is the
// coping one row up (its inner row repainted `line`, a lapis line, unless it
// is the owner's line), the deck's outer row (e === cw) a red-orange `band`,
// and the field inside it sunk one more row and laid in slabs `g` voxels
// square: one tone per slab, a darker seam between slabs.
const TCF_TONES = [0xd8c39a, 0xd0b98e, 0xdccaa4, 0xcbb489];
const TCF_SLAB = (g) => (x, y, z) => {
  const c = pick(hash3(Math.floor(x / g), y, Math.floor(z / g), 351), TCF_TONES);
  return (((x % g) + g) % g === 0 || ((z % g) + g) % g === 0) ? shade(c, 0.78) : c;
};
function roofField(m, x0, z0, x1, z1, y, { cw = 2, g = 4, line = LAPIS, band = 0xc8562e, field = null } = {}) {
  const f = field || TCF_SLAB(g);
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const e = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z);
    if (e < cw) {
      const v = m.get(x, y + 1, z);
      if (e === cw - 1 && line != null && v && !v.team) pset(m, x, y + 1, z, line);
    } else if (e === cw) pset(m, x, y, z, band);
    else { m.remove(x, y, z); pset(m, x, y - 1, z, f(x - x0, y - 1, z - z0)); }
  }
}
// the hall's sunk deck: reed mats in a basket weave (the strips of each 4 x 4
// mat run along x or z in turn) between dark palm-trunk beams on the seams
const TC_MAT = (x, y, z) => {
  const g = 4, u = ((x % g) + g) % g, w = ((z % g) + g) % g;
  if (u === 0 || w === 0) return 0x6a4a2c;
  const along = (Math.floor(x / g) + Math.floor(z / g)) & 1;
  const s = along ? w : u;
  return s === 2 ? 0x9a8250 : (s & 1) ? 0xb8a068 : 0xc8b07a;
};
// Round 35 courtyard props (flat colour, clean, a voxel apart): a crate (n
// cube) with near-black edge slats round pale boards, the boards light and
// mid by row (the lid's the other way); a tall amphora with a narrow neck
// shading from dark terracotta at the foot to cream at the shoulder, a dark
// painted band round its belly; a wooden pallet
const TCK_L = 0xd6a866, TCK_M = 0xb7874c, TCK_D = 0x3e2614;
function tcCrate(m, x, y, z, n = 5) {
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const ex = i === 0 || i === n - 1, ey = j === 0 || j === n - 1, ez = k === 0 || k === n - 1;
    if (!ex && !ey && !ez) continue;
    let c = (ex + ey + ez >= 2) ? TCK_D : (j & 1) ? TCK_L : TCK_M;
    if (j === n - 1 && !ex && !ez) c = (i & 1) ? TCK_L : TCK_M;
    pset(m, x + i, y + j, z + k, c);
  }
}
const TCA = [0x8a3418, 0xa4441f, 0xbc5e2c, 0xd28a4e, 0xe4b67c, 0xeed6a8];
function tcAmphora(m, X, y, Z) {
  // 12 high: a pointed foot, a round belly five wide, a dark painted band,
  // the shoulder narrowing to a one-voxel neck two high, a flared rim
  prow(m, X, y, Z, 0, TCA[0]);
  prow(m, X, y + 1, Z, 1, TCA[0], true);
  prow(m, X, y + 2, Z, 1, TCA[1]);
  prow(m, X, y + 3, Z, 2, TCA[1], true);
  prow(m, X, y + 4, Z, 2, TCA[2], true);
  prow(m, X, y + 5, Z, 2, 0x3a1c10, true);
  prow(m, X, y + 6, Z, 2, TCA[3], true);
  prow(m, X, y + 7, Z, 1, TCA[4]);
  prow(m, X, y + 8, Z, 1, TCA[5], true);
  pset(m, X, y + 9, Z, TCA[4]); pset(m, X, y + 10, Z, TCA[5]);
  prow(m, X, y + 11, Z, 1, (i, k) => (i === 0 && k === 0 ? MOUTH : TCA[5]));
  // two handles: a voxel out from the neck on each side, joined to the rim
  for (const d of [-1, 1]) { pset(m, X + d, y + 9, Z, TCA[3]); }
}
// an open sack of grain (4 x 4 from (x, z), corners cut): tan burlap with a
// darker foot, a pale rolled rim, golden grain heaped in the mouth
const TCS = [0x7e6238, 0xa88a5a, 0xb99c6a, 0xeadcb8, 0xe6be52, 0xf2d478];
function tcSack(m, x, y, z, h = 4) {
  const cell = (r, c) => { for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) {
    if ((i === 0 || i === 3) && (k === 0 || k === 3)) continue;
    pset(m, x + i, y + r, z + k, typeof c === 'function' ? c(i, k) : c);
  } };
  cell(0, TCS[0]);
  for (let r = 1; r < h - 1; r++) cell(r, (i, k) => (i === 0 || k === 0 ? TCS[1] : TCS[2]));
  cell(h - 1, (i, k) => (i >= 1 && i <= 2 && k >= 1 && k <= 2 ? TCS[4] : TCS[3]));
  pset(m, x + 1, y + h, z + 1, TCS[5]); pset(m, x + 2, y + h, z + 2, TCS[4]);
}
function tcPallet(m, x0, z0, w, d) {
  for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) pset(m, x, 1, z, (x - x0) % 2 ? 0x8a6238 : 0x5a3c22);
}
function townCenter() {
  const N = 56;
  const m = lot(N, N);
  // the courtyard: cool grey flagstones, a value apart from every wall
  patch(m, 6, 6, 50, 50, FLAG, { rag: 1, seed: 1 });
  // the enclosure walls (battered, warm ochre sandstone, a gorge coping) with
  // the gate gap on the front; squat piers at the two back corners
  const wo = { wall: OCHRE_W, batter: 4, band: null, rim: false, torus: false, socle: 1, rimC: LIME, gorge: [0x34588a, 0x3f6596], roofC: MUDROOF };
  block(m, 4, 4, 52, 7, 1, 5, wo);
  block(m, 4, 4, 7, 52, 1, 5, wo);
  block(m, 49, 4, 52, 49, 1, 5, wo);
  block(m, 4, 49, 18, 52, 1, 4, wo);
  block(m, 38, 49, 48, 52, 1, 4, wo);
  for (const [px, pz] of [[2, 2], [48, 2]]) block(m, px, pz, px + 6, pz + 6, 1, 7, { wall: OCHRE_W, batter: 5, band: null, torus: false, rimC: LIME, roofC: MUDROOF });
  // the gateway: two battered sandstone pylons with wide painted bands (red,
  // ochre, turquoise between ink rules) over relief panels, a gate block
  // between them with a deep black passage and a dark leaf, the lintel bridge
  // with the gilt winged sun; a team pennant on a staff before each pylon
  const PB = [INK, RED_B, RED_B, INK, OCHRE_B, OCHRE_B, INK, TURQ, TURQ, INK];
  for (const [x0, x1] of [[14, 25], [31, 42]]) {
    block(m, x0, 44, x1, 54, 1, 20, { batter: 8, band: null, frieze: 0, lipOut: 2 });
    const T = m.lastTop;
    bands(m, x0, 44, x1, 54, 19, PB);
    roofField(m, T.c0, T.d0, T.c1, T.d1, T.y);
  }
  for (let x = 24; x < 32; x++) for (let z = 46; z < 52; z++) for (let y = 1; y < 14; y++) m.set(x, y, z, y === 1 ? SAND_D(x, y, z) : SAND(x, y, z));
  for (let x = 23; x < 33; x++) for (let z = 46; z < 53; z++) for (let y = 14; y < 18; y++) m.set(x, y, z, y === 17 ? LIME(x, y, z) : y === 14 ? LIME_S : y === 16 ? TURQ : SAND(x, y, z));
  for (let x = 22; x < 34; x++) for (let z = 45; z < 54; z++) {
    const e = Math.min(x - 22, 33 - x, z - 45, 53 - z);
    m.set(x, 18, z, e <= 1 ? LIP(x, 18, z) : PLASTER(x, 18, z));
    if (e <= 1) m.set(x, 19, z, LIME(x, 19, z));
  }
  roofField(m, 22, 45, 34, 54, 18, { g: 3 });
  door(m, '+z', 26, 4, 1, 11, { deep: 4, frame: LIME, lintel: false });
  for (let y = 1; y < 11; y++) for (let x = 26; x < 30; x++) m.set(x, y, 47, x === 27 || x === 28 ? REVEAL : shade(DOOR(x, y, 47), 0.5));
  // the flagstaffs against the pylons' fronts, the owner's pennants above the cornices
  banner(m, 17, 1, 54, 30, '+z'); banner(m, 38, 1, 54, 30, '+z');
  paint(m, '+z', 24, 16, ['GG.GGG.GG', '.GGGRGGG.'], { G: GILT, R: RED });
  for (const px of [16, 34]) {
    paint(m, '+z', px + 1, 9, ['.O.', 'OOO', '.O.', 'BOB', 'B.B', 'B.B', 'K.K'], { O: OCHRE, B: TURQ, K: INK });
    paint(m, '+z', px + 5, 9, ['K', '.', 'R', 'K', '.', 'B', 'K'], { K: INK, R: RED, B: TURQ });
  }
  // round 46: ONE axis from the gate to the palace, no stacked tiers: the
  // palace across the back of the court on the gate's axis, a single
  // limestone storey under a lapis cornice and frieze with one ochre roof
  // room on its middle, fronted by a portico of six painted columns under a
  // flat roof, its doorway on the axis; the court before it open, flagged
  // grey, a fire altar on the axis; the granary silo in the front left
  // corner the only other mass
  inner(m, (s) => {
    const g = [0x34588a, 0x3f6596];
    const t1 = block(s, 10, 8, 46, 24, 1, 12, { wall: LIME, batter: 0, band: 'lapis', frieze: 2, roofC: PLASTER, lipOut: 2, rimC: LIME, gorge: g });
    roofField(s, s.lastTop.c0, s.lastTop.d0, s.lastTop.c1, s.lastTop.d1, s.lastTop.y);
    block(s, 21, 10, 35, 20, t1 - 1, 6, { wall: OCHRE_P, batter: 0, band: 'team', roofC: PLASTER, lipOut: 1, rimC: LIME, gorge: [RED_M, 0xa8563a], torus: false });
    roofField(s, s.lastTop.c0, s.lastTop.d0, s.lastTop.c1, s.lastTop.d1, s.lastTop.y, { line: RED_B, band: OCHRE_B, g: 3 });
    door(s, '+z', 26, 4, 1, 8, { lattice: true, sun: true, deep: 3, frame: SAND });
    slit(s, '+z', 14, 4, 3, 1); slit(s, '+z', 41, 4, 3, 1); slit(s, '-x', 14, 5, 3, 1); slit(s, '+x', 14, 5, 3, 1);
    // the portico before the palace front (z 24 .. 30): six columns, a
    // painted architrave and a reed-mat roof under a pale lip
    // (round 47: a taller portico of lotus columns, 3 x 3 shafts painted at
    // the foot and neck under open green and lapis bells, as the market's)
    const X0 = 10, X1 = 46, Z0 = 24, Z1 = 31, H = 13;
    for (const x of [13, 18, 23, 33, 38, 43]) lotusColumn(s, x, Z1 - 3, 1, H);
    const R = bandRows('lapis');
    for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) {
      const e = Math.min(x - X0, X1 - 1 - x, z - Z0 + 3, Z1 - 1 - z);
      s.set(x, H - 1, z, e === 0 ? R[0] : SAND_D(x, H - 1, z));
      s.set(x, H, z, e === 0 ? R[2](x, H, z) : e === 1 ? LIP(x, H, z) : TC_HALLROOF(x, H, z));
      if (e <= 1) s.set(x, H + 1, z, LIP(x, H + 1, z));
    }
    roofField(s, X0, Z0 - 3, X1, Z1, H, { field: TC_MAT });
  });
  // round 47: a free colonnade down the court's west side, five lotus
  // columns carrying an architrave painted in lapis and red with a pale lip
  inner(m, (s) => {
    const CX = 11, Zs = [32, 36, 40, 44], TOP = 13;
    for (const z of Zs) lotusColumn(s, CX, z, 1, TOP);
    for (let z = Zs[0] - 2; z <= Zs[Zs.length - 1] + 2; z++) for (let i = -1; i <= 1; i++) {
      s.set(CX + i, TOP, z, SAND_D(CX + i, TOP, z));
      s.set(CX + i, TOP + 1, z, i === 0 ? LIP(CX + i, TOP + 1, z) : (((z >> 1) & 1) ? LAPIS : RED_M));
    }
  });
  // the granary: a big domed silo at the front right with a ladder
  // (silo(), ladder() lay mesh polygons on m itself, so not through inner())
  silo(m, 40.5, 38.5, 1, 6, 11);
  ladder(m, [33.4, 1, 40.4], [34.6, 11.6, 39.6]);
  // the court's one prop group: a fire altar on the axis before the portico
  m.box(25, 1, 34, 7, 2, 5, LIME); m.box(26, 2, 35, 5, 1, 3, DARK);
  m.set(28, 3, 36, FIRE[3], FG); m.set(27, 3, 36, FIRE[1], FG); m.set(29, 3, 35, FIRE[2], FG); m.set(28, 4, 36, FIRE[2], FG); m.set(28, 3, 37, FIRE[0], FG);
  // the stores by the silo: two tall amphorae and a grain sack
  tcAmphora(m, 44, 1, 30); tcAmphora(m, 31, 1, 44); tcSack(m, 46, 1, 34, 3);
  // the Ra statue on its plinth at the front-left corner, in sandstone with
  // gold regalia and the owner's kilt (building_02)
  fineStatue(m, 2, 45, 12, 54, 1, 9, { h: 25, skin: BASALT, gold: GILT_L, kilt: GILT, kiltFront: TEAMB, head: 'falcon', crown: 'disc', arms: 'crossed', pose: 'stride' }, 1);
  const st = m.fine[m.fine.length - 1].m;
  for (const [x, y, z] of st.coords) {
    const v = st.get(x, y, z);
    if (v && !v.team) v.c = tcSandstone(v.c, x, y, z);
  }
  return m;
}

// Temple (5 x 6; round 46): one approach axis from the front (+z) to the
// back, so it reads at a glance as an Egyptian temple: a pair of gilt-tipped
// obelisks on the ground before a pale limestone PYLON (two battered towers
// with a painted relief of the god and a cartouche band, the owner's
// pennants on masts in their faces, a lower gate block between them with a
// deep doorway under a winged sun), then an open court floored in cool grey
// flags behind low enclosure walls with the major god's statue on the axis
// facing the gate, then a COLUMNED HALL in warm ochre sandstone (a portico
// of four painted papyrus columns either side of the axis under a lapis
// cornice), then the SANCTUARY, a narrower limestone block rising behind it
// with a gilt band and a team line. Every mass has its own value: the pylon
// lightest, the hall a warm mid ochre, the court floor grey, the podium dark.
function temple(god) {
  const W = 40, D = 48;
  const m = lot(W, D);
  const AX = 20;                                     // the axis (x)
  const Y = 3;                                       // the podium's floor row
  // the podium: two courses of dark ashlar, a pale lip, the owner's line
  for (let x = 2; x < 38; x++) for (let z = 2; z < 44; z++) {
    const e = Math.min(x - 2, 37 - x, z - 2, 43 - z);
    m.set(x, 1, z, PLINTH(x, 1, z));
    m.set(x, 2, z, e === 0 ? LIME(x, 2, z) : e === 1 ? TEAM : FLAG(x, 2, z));
  }
  // the stair up the front on the axis, framed by two low limestone walls
  for (let z = 44; z < 47; z++) for (let x = AX - 6; x < AX + 6; x++) {
    const yT = z === 44 ? 2 : 1;
    for (let y = 1; y <= yT; y++) m.set(x, y, z, LIME(x, y, z));
  }
  const COLUMN = (x0, z0, y0, colH, ring = LAPIS) => {
    // a 3 x 3 papyrus column: a dark foot, a pale shaft, red and lapis neck
    // rings, a green bell capital flaring to 5 x 5, a dark abacus
    for (let r = 0; r < colH; r++) {
      const y = y0 + r;
      const flare = r === colH - 3 || r === colH - 2;
      const ext = flare ? 1 : 0;
      for (let i = -ext; i < 3 + ext; i++) for (let k = -ext; k < 3 + ext; k++) {
        const Xv = x0 + i, Zv = z0 + k;
        const edgeI = i < 0 || i > 2, edgeK = k < 0 || k > 2;
        if (r === colH - 3 && edgeI && edgeK) continue;
        let c;
        if (r === 0) c = PLINTH(Xv, y, Zv);
        else if (r === colH - 1) c = shade(0xc9a874, 0.86);
        else if (flare) c = r === colH - 2 ? (edgeI || edgeK ? H_G : 0x2f7048) : (edgeI || edgeK ? 0x2f7048 : H_G);
        else if (r === colH - 4) c = ring;
        else if (r === colH - 5) c = RED_B;
        else c = (i === 1 || k === 1) ? 0xeee4cc : 0xd9cba8;
        m.set(Xv, y, Zv, c);
      }
    }
  };
  // ---- the sanctuary (z 3 .. 15): the tallest block behind the hall, in
  // limestone, a gilt band and the owner's line under its cornice, the
  // shrine door on the axis
  // a flat top flush with the coping (no sunk deck: a ring of coping round a
  // dark slot read as one more roof frame)
  const flatTop = (c = LIME_S) => { const T = m.lastTop; for (let x = T.c0 + 2; x < T.c1 - 2; x++) for (let z = T.d0 + 2; z < T.d1 - 2; z++) m.set(x, T.y + 1, z, typeof c === 'function' ? c(x, T.y + 1, z) : c); };
  block(m, 10, 3, 30, 15, Y, 19, { wall: LIME, band: 'team', frieze: 0, roofC: LIME_S, rimC: LIME, lipOut: 2, plinth: false, gorge: [0x34588a, 0x3f6596], torus: false });
  flatTop(TCF_SLAB(4));
  bands(m, 10, 3, 30, 15, Y + 16, [GILT_D, GILT, GILT_D]);
  door(m, '+z', AX - 2, 4, Y, 9, { deep: 3, frame: GILT_D, lintel: false, leaf: true });
  // ---- the columned hall (z 15 .. 27): an open hypostyle of three rows of
  // papyrus columns carrying ochre architraves along the rows, roofed over
  // the side aisles in slabs, the central aisle on the axis left open to the
  // sky so the god at the sanctuary door is seen from above between the
  // columns; low ochre screen walls between the outer columns
  const HC = 14;                                     // column height
  const colX = [6, 11, 25, 30];                      // outer aisles; the axis aisle 14 .. 25 open
  const rowZ = [16, 20, 24];
  for (const z of rowZ) for (const x of colX) COLUMN(x, z, Y, HC);
  const AY = Y + HC;                                  // the architrave row
  for (const z of rowZ) for (let x = 5; x < 35; x++) {
    if (x >= 15 && x < 25 && z !== 24) continue;    // the axis aisle stays open but for the front beam
    for (let k = 0; k < 3; k++) { m.set(x, AY, z + k, k === 1 ? OCHRE_M : SAND_D(x, AY, z + k)); m.set(x, AY + 1, z + k, (x + z) % 4 === 0 ? LAPIS : RED_M); }
  }
  // roof slabs over the side aisles (between the architraves), a pale lip
  for (const [x0, x1] of [[5, 15], [25, 35]]) for (let x = x0; x < x1; x++) for (let z = 16; z < 27; z++) {
    if (!m.has(x, AY + 1, z)) m.set(x, AY + 1, z, EDECK(x, AY + 1, z));
    const e = Math.min(x - x0, x1 - 1 - x, z - 16, 26 - z);
    m.set(x, AY + 2, z, e === 0 ? LIP(x, AY + 2, z) : e === 1 && (x === x0 + 1 || x === x1 - 2) ? TEAM : EDECK(x, AY + 2, z));
  }
  // screen walls between the outer columns on the hall's sides, half height
  for (const x of [5, 6, 33, 34]) for (let z = 16; z < 27; z++) for (let y = Y; y < Y + 6; y++) if (!m.has(x, y, z)) m.set(x, y, z, y === Y + 5 ? LIME(x, y, z) : y === Y + 4 ? RED_M : SAND_D(x, y, z));
  // ---- round 47: the PYLON (z 30 .. 44), the temple's face: two tall
  // trapezoidal towers battered a voxel in every four rows on all sides
  // (smoothed by skin(), a torus roll up every edge), each under a curved
  // cavetto flaring three voxels out over the owner's band; a painted
  // register of hieroglyphs between ink rules wrapped round each tower's
  // foot and a second one high on its flanks and back, the god in a sunk
  // relief on each front; four tall flagpoles with long team streamers
  // standing before the towers; the gate block between them set back two
  // voxels, its own cornice, a two-step recessed doorway (a rebate, then the
  // deep door) under a gilt winged sun. The court in front of the hall is
  // gone: the pylon stands straight before the columned hall.
  const PZ0 = 30, PZ1 = 44, PH = 22;
  let PRT = 0;
  for (const [x0, x1] of [[0, 17], [23, 40]]) {
    PRT = pylon(m, x0, PZ0, x1, PZ1, PH, { wall: LIME, b: 4, band: 'team', gorge: [0x34588a, 0x3f6596, 0x2f6f5a, 0x3f6596], lipOut: 3, roofC: LIME_S, y0: Y });
    glyphRegister(m, x0, PZ0, x1, PZ1, Y + 1, ['+z', '-z', '+x', '-x'], x0);
    glyphRegister(m, x0, PZ0, x1, PZ1, Y + 13, x0 ? ['+x', '-z'] : ['-x', '-z'], x0 + 3);
  }
  // the gate block, set back two voxels from the towers' feet, filling only
  // where the towers' battered flanks leave room
  for (let x = 14; x < 26; x++) for (let z = PZ0 + 3; z < PZ1 - 2; z++) for (let y = Y; y < Y + 16; y++) {
    if (m.has(x, y, z)) continue;
    m.set(x, y, z, y === Y + 15 ? LIP(x, y, z) : y === Y + 14 ? (((x + z) & 1) ? GORGE : GORGE_L) : y === Y + 13 ? LAPIS : y === Y + 12 ? GILT : y === Y ? SAND_D(x, y, z) : LIME(x, y, z));
  }
  for (let x = 13; x < 27; x++) for (let z = PZ0 + 2; z < PZ1 - 1; z++) {
    const e = Math.min(x - 13, 26 - x, z - PZ0 - 2, PZ1 - 2 - z);
    if (e === 0 && !m.has(x, Y + 15, z)) m.set(x, Y + 15, z, LIP(x, Y + 15, z));
  }
  // the rebate: the doorway's outer frame cut a voxel into the gate's face
  for (let x = AX - 4; x < AX + 4; x++) for (let y = Y; y < Y + 12; y++) {
    m.remove(x, y, PZ1 - 3);
    m.set(x, y, PZ1 - 4, y === Y ? SAND_D(x, y, PZ1 - 4) : (x === AX - 4 || x === AX + 3) ? shade(LIME(x, y, PZ1 - 4), 0.72) : shade(LIME(x, y, PZ1 - 4), 0.84));
  }
  door(m, '+z', AX - 2, 4, Y, 9, { deep: 5, frame: GILT_D, lintel: false, leaf: true, leafShade: 0.5 });
  paint(m, '+z', AX - 4, Y + 11, ['GG.GG.GG', '.GGRRGG.'], { G: GILT, R: RED });
  // the god in a sunk relief on each tower's front, over the foot register
  const PG = PANEL_GOD.slice(1, 12);
  recessPanel(m, '+z', 5, Y + 17, PG, RELIEF);
  recessPanel(m, '+z', 29, Y + 17, PG, RELIEF);
  // the flagpoles: a cedar mast on each tower's roof at its inner front
  // corner, a gilt tip and a long team streamer flying outward, so the
  // towers' faces stay clear (masts standing before the faces read as
  // scaffolding against the batter)
  {
    const K = Math.floor((PH - 1) / 4), RT = PRT - 1;
    for (const [x, dir] of [[17 - K - 2, -1], [23 + K + 1, 1]]) {
      const z = PZ1 - K - 2, top = RT + 12;
      for (let y = RT; y <= top; y++) pset(m, x, y, z, POLE(x, y, z));
      pset(m, x, top + 1, z, GILT);
      for (let k = 1; k <= 8; k++) for (let r = 0; r < (k < 6 ? 2 : 1); r++) m.set(x + dir * k, top - 1 - r - (k >> 2), z, k === 8 ? GILT : TEAMB);
    }
  }
  // ---- the god's statue at the sanctuary door on the axis, facing the gate
  // down the open aisle of the hall
  const G = {
    ra: { head: 'falcon', crown: 'disc', arms: 'side', kilt: GILT },
    isis: { head: 'human', crown: 'horns', arms: 'wings', kilt: GILT, pose: 'dress' },
    set: { head: 'jackal', crown: 'set', arms: 'side', kilt: GILT },
  }[god];
  // (at third voxels, two thirds the Town Center's statue: taller than the
  // columns, under the sanctuary's cornice, so it crowns the axis without
  // hiding the hall)
  {
    const k = 3, x0 = AX - 4, x1 = AX + 4, z0 = 16, z1 = 22;
    const sub = new Rec(m.W * k, m.D * k);
    const py = monPlinth(sub, x0 * k, z0 * k, x1 * k, z1 * k, Y * k, 2 * k, { seed: 2 });
    const pd = monDie(sub, x0 * k + 3, z0 * k + 3, x1 * k - 3, z1 * k - 3, py, 2);
    cleanStatue(sub, Math.round(((x0 + x1) * k) / 2), pd, Math.round(((z0 + z1) * k) / 2) - 1, toClean({ gold: GILT_L, kiltFront: TEAM, pose: 'stride', sand: true, ...G }));
    (m.fine ??= []).push({ m: sub, k });
  }
  const st = m.fine[m.fine.length - 1].m;
  for (const [x, y, z] of st.coords) {
    const v = st.get(x, y, z);
    if (v && !v.team) v.c = tcSandstone(v.c, x, y, z);
  }
  // ---- the obelisk pair before the pylon, on the ground either side of the
  // stair: box-built (no smooth batter, which drew them as pale spikes), a
  // dark die with the owner's band, a 3 x 3 granite-pink shaft stepping to
  // 2 x 2 two thirds up, a column of painted signs down its front, a gilt
  // pyramidion kept gold through the grade (m.keep)
  const tob = (cx, cz, h) => {
    for (let x = cx - 2; x < cx + 3; x++) for (let z = cz - 2; z < cz + 3; z++) { m.set(x, 1, z, PLINTH(x, 1, z)); m.set(x, 2, z, (x === cx - 2 || x === cx + 2 || z === cz - 2 || z === cz + 2) ? TEAM : LIME(x, 2, z)); }
    const SH = (x, y, z) => pick(hash3(x, y >> 2, z, 464), [0xd9b79a, 0xd2b093, 0xdcbca0]);
    const h2 = Math.round(h * 0.66);
    for (let y = 3; y < 3 + h; y++) {
      const r = y - 3, n = r < h2 ? 3 : 2, o = r < h2 ? -1 : 0;
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
        const x = cx + o + i, z = cz + o + k;
        const front = k === n - 1 && i === (n === 3 ? 1 : 0);
        const sign = front && r > 1 && r < h - 2 ? [RED_B, null, LAPIS, null, INK, null][r % 6] : null;
        m.set(x, y, z, sign ?? (i === n - 1 || k === n - 1 ? SH(x, y, z) : shade(SH(x, y, z), 0.9)));
      }
    }
    const T = 3 + h;
    m.box(cx, T, cz, 2, 1, 2, OB_GOLD); m.set(cx, T + 1, cz, OB_GOLD_L); m.set(cx + 1, T + 1, cz + 1, OB_GOLD);
    (m.keep ??= []).push([cx - 1, T - 1, cz - 1, cx + 3, T + 3, cz + 3]);
  };
  tob(5, 46, 20); tob(34, 46, 20);
  return m;
}

// Barracks (5 x 5; building_09; round 33): ONE dominant form, a battered
// sandstone barrack hall across the back of the lot under a single cavetto
// cornice band and one flat roof, a lower attic step on that roof (the only
// two pale copings on the building, as Retold's two-step gatehouse); in
// front of it a low drill yard closed by plain thin walls with no cornice,
// entered between two gate piers carrying the team banners. The walls are
// regular horizontal ashlar courses in close sandstone tones (no relief
// panels, no blotches); the strong colour is kept for one painted lintel
// band (a winged sun on lapis over a red / blue / green frieze) over the
// hall's door, so the entrance is the focal point. In the yard: a spear rack
// with cowhide shields, a practice dummy, a straw archery butt, barrels.
const BK_WALL = coursed([0xd8b27c, 0xcfa872, 0xd4ad77], { course: 4, len: 8, bed: 0.77, head: 0.84, seed: 141 });
const BK_BASE = 0x8e6c48, BK_TOP = 0xe2c38f;
const BK_FLUTE = [0xd9ba86, 0xc29c66];
const BK_DECK = (x, y, z) => (hash3(x >> 2, y, z >> 2, 143) < 0.5 ? 0xcdb48a : 0xc8ae84);
// a battered ashlar mass on [X0, X1) x [Z0, Z1) from Y0, H rows, a voxel in
// every B rows (smoothed by skin()), a dark base course; returns the top ring
function bkMass(m, X0, Z0, X1, Z1, Y0, H, B, { top: topC = null } = {}) {
  if (Y0 === 1 && m.feet) m.feet.push({ x0: X0, z0: Z0, x1: X1, z1: Z1, hb: 1 });
  if (B) m.blocks.push({ x0: X0, z0: Z0, x1: X1, z1: Z1, y0: Y0, h: H, b: B, base: 0 });
  const top = Y0 + H;
  let I = 0;
  for (let y = Y0; y < top; y++) {
    I = B ? Math.floor((y - Y0) / B) : 0;
    const a0 = X0 + I, a1 = X1 - I, b0 = Z0 + I, b1 = Z1 - I;
    for (let x = a0; x < a1; x++) for (let z = b0; z < b1; z++) {
      const edge = x === a0 || x === a1 - 1 || z === b0 || z === b1 - 1;
      let c;
      if (y === top - 1 && topC) c = topC;                      // a plain lighter top row (the yard walls)
      else if (!edge) c = shade(BK_WALL(x, y, z), 0.9);
      else if (y === 1) c = BK_BASE;                            // the dark base course
      else {
        c = BK_WALL(x, y, z);
        if (hash3(x >> 3, y >> 2, z >> 3, 147) < 0.05) c = shade(c, 0.96);   // sparse, low-contrast block wobble
        c = grimed(c, x, y, z, y - 2, false);
      }
      m.set(x, y, z, c);
    }
  }
  return { c0: X0 + I, c1: X1 - I, d0: Z0 + I, d1: Z1 - I, top };
}
// a hooped barrel (square rows, corners cut): staves, dark hoops, a pale lid
function bkBarrel(m, X, Z) {
  for (let y = 1; y <= 5; y++) for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    if (i !== 0 && k !== 0 && y !== 3) continue;
    pset(m, X + i, y, Z + k, y === 2 || y === 4 ? 0x2e2a26 : y === 5 ? (i === 0 && k === 0 ? 0xd2a66c : 0xa8743e) : 0x8e5c30);
  }
}
function barracks() {
  const W = 40;
  const m = lot(W, W, EARTH);
  patch(m, 7, 20, 33, 35, SANDGROUND, { seed: 5 });
  // the hall: one battered mass, one cavetto, one slab
  const R = bkMass(m, 4, 3, 36, 21, 1, 16, 6);
  const { c0, c1, d0, d1, top } = R;
  const ring = (x, z, p) => Math.min(x - (c0 - p), (c1 - 1 + p) - x, z - (d0 - p), (d1 - 1 + p) - z);
  const fl = (x, z) => BK_FLUTE[((x + z + 512) >> 1) & 1];
  for (let x = c0; x < c1; x++) for (let z = d0; z < d1; z++) m.set(x, top, z, ring(x, z, 0) === 0 ? shade(fl(x, z), 0.74) : BK_DECK(x, top, z));
  for (let x = c0 - 1; x <= c1; x++) for (let z = d0 - 1; z <= d1; z++) m.set(x, top + 1, z, ring(x, z, 1) === 0 ? fl(x, z) : BK_DECK(x, top + 1, z));
  // the roof slab: a limestone coping ring (the owner's line on its inner
  // edge) round a sunk plaster deck
  for (let x = c0 - 1; x <= c1; x++) for (let z = d0 - 1; z <= d1; z++) {
    const e = ring(x, z, 1);
    m.set(x, top + 2, z, e <= 1 ? LIME(x, top + 2, z) : BK_DECK(x, top + 2, z));
    if (e <= 2) m.set(x, top + 3, z, e === 2 ? TEAM : LIP(x, top + 3, z));
  }
  // round 34: the roof carries detail instead of one blank slab. The deck is
  // laid in big flagstones (one tone each, a darker seam between them); at
  // the back west corner a small stair kiosk (the old attic step cut down to
  // a stair head: coursed walls, its own pale coping with the owner's line,
  // a dark doorway facing the yard under a timber lintel); beside it an open
  // stair hatch with a ladder's rails rising out of it; along the east half
  // two water jars against the back parapet, a straw mat of drying grain
  // and two linen sacks.
  const DY = top + 2;
  const flag = (x, z) => {
    const fx = Math.floor((x + 1) / 6), fz = Math.floor((z + 2) / 5);
    const seam = (x + 1) % 6 === 0 || (z + 2) % 5 === 0;
    const c = shade(0xccb388, 0.975 + 0.05 * hash3(fx, fz, 3, 149));
    return seam ? shade(0xccb388, 0.84) : c;
  };
  for (let x = c0 - 1; x <= c1; x++) for (let z = d0 - 1; z <= d1; z++) if (ring(x, z, 1) > 1) m.set(x, DY, z, flag(x, z));
  // the stair kiosk
  const K0 = c0 + 2, K1 = K0 + 8, L0 = d0 + 2, L1 = L0 + 6, KH = 5, ky = DY + 1;
  for (let y = ky; y < ky + KH; y++) for (let x = K0; x < K1; x++) for (let z = L0; z < L1; z++) {
    const edge = x === K0 || x === K1 - 1 || z === L0 || z === L1 - 1;
    m.set(x, y, z, edge ? BK_WALL(x, y, z) : shade(BK_WALL(x, y, z), 0.9));
  }
  for (let x = K0 - 1; x <= K1; x++) for (let z = L0 - 1; z <= L1; z++) {
    const e = Math.min(x - K0 + 1, K1 - x, z - L0 + 1, L1 - z);
    m.set(x, ky + KH, z, e === 0 ? LIP(x, ky + KH, z) : e === 1 ? TEAM : BK_DECK(x, ky + KH, z));
  }
  for (let x = K0 + 3; x < K0 + 5; x++) for (let y = ky; y < ky + 3; y++) { m.set(x, y, L1 - 1, 0x2a1d14); m.set(x, y, L1 - 2, 0x2a1d14); }
  for (let x = K0 + 2; x < K0 + 6; x++) pset(m, x, ky + 3, L1, 0x6e4a2c);
  // the open hatch with a ladder: a dark well framed by a pale kerb
  const H0 = K1 + 2, H1 = H0 + 4, J0 = d0 + 2, J1 = J0 + 3;
  for (let x = H0 - 1; x <= H1; x++) for (let z = J0 - 1; z <= J1; z++) {
    const inner = x >= H0 && x < H1 && z >= J0 && z < J1;
    if (inner) { m.set(x, DY, z, 0x231910); m.set(x, DY - 1, z, 0x1c140c); }
    else pset(m, x, DY + 1, z, 0xe6d3ac);
  }
  for (const x of [H0, H1 - 1]) for (let y = DY; y <= DY + 3; y++) pset(m, x, y, J0 + 1, 0x7a5230);
  pset(m, H0 + 1, DY + 2, J0 + 1, 0x8b6139); pset(m, H0 + 2, DY + 2, J0 + 1, 0x8b6139);
  // two water jars against the back parapet, east half
  for (const jx of [c1 - 8, c1 - 4]) jar(m, jx, DY + 1, d0 + 3, 0xa4552e);
  // a straw mat of drying grain and two linen sacks, east front
  const M0 = c1 - 14, M1 = M0 + 7, N0 = d1 - 6, N1 = N0 + 4;
  for (let x = M0; x < M1; x++) for (let z = N0; z < N1; z++) {
    const rim = x === M0 || x === M1 - 1 || z === N0 || z === N1 - 1;
    pset(m, x, DY + 1, z, rim ? 0x9c7a44 : 0xe2c470);
  }
  sack(m, c1 - 5, DY + 1, d1 - 8);
  sack(m, c1 - 5, DY + 1, d1 - 5);
  // the door: centred, deep, dark cedar leaves in a sandstone frame, the
  // painted lintel band over it (the only strong colour on the walls)
  door(m, '+z', 17, 6, 1, 10, { deep: 3, frame: shade(0xd2aa76, 0.86), lintel: false, proud: true });
  paint(m, '+z', 13, 16, [
    'RRRRRRRRRRRRRR',
    'LLLLLLLLLLLLLL',
    'LGGGGGRRGGGGGL',
    'LLLGGGRRGGGLLL',
    'GBRGBRGBRGBRGB',
  ], { R: RED_M, L: LAPIS, G: GILT, B: 0x3f7a5a });
  for (let x = 13; x < 27; x++) { const p = outer(m, '+z', x, 17, lim(m)); if (p) m.set(p[0], p[1], p[2], LIME(p[0], p[1], p[2])); }
  // a paved way from the gate to the door
  patch(m, 15, 21, 25, 40, PAVE, { rag: 1, seed: 9 });
  // a row of three high slits in the back face, one in each end face
  for (const u of [14, 20, 26]) slit(m, '-z', u, 9, 4, 1);
  slit(m, '-x', 11, 9, 4, 1); slit(m, '+x', 11, 9, 4, 1);
  // the yard: thin plain walls (a lighter top row, no cornice, no paint)
  const YH = 6;
  bkMass(m, 4, 20, 7, 38, 1, YH, 0, { top: BK_TOP });
  bkMass(m, 33, 20, 36, 38, 1, YH, 0, { top: BK_TOP });
  bkMass(m, 7, 35, 14, 38, 1, YH, 0, { top: BK_TOP });
  bkMass(m, 26, 35, 33, 38, 1, YH, 0, { top: BK_TOP });
  // the gate piers: the walls' ends two rows taller, the same plain top
  for (const x0 of [13, 24]) bkMass(m, x0, 35, x0 + 3, 38, 1, YH + 2, 0, { top: BK_TOP });
  // the team banners on poles at the yard's two front corners, clear of the door
  banner(m, 5, YH + 1, 37, 20, '+z');
  banner(m, 34, YH + 1, 37, 20, '+z');
  // the spear rack along the west wall's inner face with two cowhide shields
  rack(m, 8, 31, 8);
  for (const sx of [9, 13]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const c = i === 1 && j === 1 ? 0xb08a3c : (i + j) % 3 === 0 ? 0x6a4428 : 0xeee2c8;
    pset(m, sx + i, 2 + j, 33, c);
  }
  // a practice dummy, a straw archery butt with a red ring, barrels by the hall
  dummy(m, 21, 28);
  lathe(m, 29.5, 27.5, 1, 6, () => 2.2, (x, y, z) => (y === 3 ? RED : THATCH(x, y, z)));
  bkBarrel(m, 9, 23); bkBarrel(m, 31, 23);
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
    const tt = block(m, x, z, x + TS, z + TS, 1, 39, { wall: LIME, batter: 12, band: 'team', frieze: 1, roofC: ROOFTILE });
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
function pylon(m, x0, z0, x1, z1, h, { wall = SAND, b = 9, band = 'team', gorge = [GORGE, GORGE_L], lipOut = 2, roofC = PLASTER, frieze = 0, y0 = 1 } = {}) {
  block(m, x0, z0, x1, z1, y0, h, { wall, batter: b, band, lipOut, flare: true, gorge, torus: true, rimC: LIME, roofC, frieze, style: 'cornice' });
  const B = m.blocks[m.blocks.length - 1];
  B.cav = { lipOut, gorge }; B.roll = true;
  const top = y0 + h, K = Math.floor((h - 1) / b);
  const a0 = x0 + K, a1 = x1 - K, b0 = z0 + K, b1 = z1 - K;
  for (let y = top; y <= top + 1; y++) for (let x = a0 - lipOut; x < a1 + lipOut; x++) for (let z = b0 - lipOut; z < b1 + lipOut; z++) {
    if (x < a0 || x >= a1 || z < b0 || z >= b1) m.remove(x, y, z);
  }
  // the lip: pale, its edge row a voxel higher as a parapet, the team line
  // inside it on the deck
  const T = m.lastTop;
  for (let x = T.c0; x < T.c1; x++) for (let z = T.d0; z < T.d1; z++) {
    const e = Math.min(x - T.c0, T.c1 - 1 - x, z - T.d0, T.d1 - 1 - z);
    // round 27: a two-voxel parapet with a pale coping round a sunk deck
    if (e <= 1) { m.set(x, T.y, z, LIME); m.set(x, T.y + 1, z, LIP); }
    else if (e === 2) m.set(x, T.y, z, LIME_S);
  }
  return T.y + 2;
}
// Round 47: a painted register of hieroglyphs round a (battered) block on
// [x0, x1) x [z0, z1): from y0 an ink rule, three rows of signs (3 wide, a
// voxel apart, in ink, red, lapis and green on the stone), an ink rule;
// painted on each listed face's outermost voxels (skin() carries the colours
// onto the slope), only over dressed stone (never a door, panel or band)
const GLYPHS = [
  ['.R.', 'RRR', '.R.'],    // sun
  ['B.B', '.B.', 'B.B'],    // water
  ['.G.', '.G.', 'GG.'],    // reed
  ['.B.', 'BBB', '.B.'],    // ankh
  ['KK.', '.KK', '.K.'],    // falcon
  ['KKK', 'K.K', '.R.'],    // eye
  ['G.G', '.G.', '.G.'],    // papyrus
  ['RRR', '...', 'KKK'],    // bread over the mat
];
const GLYPH_C = { R: 0x9a3626, B: 0x2c4f8c, G: 0x2a2420, K: 0x2a2420 };
function glyphRegister(m, x0, z0, x1, z1, y0, faces, seed = 0) {
  for (const f of faces) {
    const alongX = f === '+z' || f === '-z';
    const lo = alongX ? x0 : z0, hi = alongX ? x1 : z1;
    for (let u = lo; u < hi; u++) for (let r = 0; r < 5; r++) {
      const y = y0 + r;
      const p = outer(m, f, u, y, lim(m));
      if (!p) continue;
      const v = m.get(p[0], p[1], p[2]);
      if (!v || v.team || v.glow || !ASH.has(v.c)) continue;
      // the sign cell along the face, counted from the face's start
      const a = u - lo - 1;
      let c = null;
      if (r === 0 || r === 4) c = INK;
      else if (a >= 0 && a % 5 < 3) {
        const g = GLYPHS[(Math.floor(a / 5) * 5 + seed + (alongX ? 0 : 3)) % GLYPHS.length];
        const ch = g[3 - r][(f === '+z' || f === '-x') ? a % 5 : 2 - (a % 5)];
        if (ch !== '.') c = GLYPH_C[ch];
      }
      if (c !== null) pset(m, p[0], p[1], p[2], c);
    }
  }
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
  block(m, 38, 37, 46, 45, 1, 19, { wall: LIME, batter: 0, lipOut: 2, band: 'lapis', rimC: LIME, gorge: [0x34588a, 0x3f6596], roofC: PLASTER });
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
  // round 27: the roof flush with the pillars' outer faces (no overhanging
  // slab): a painted architrave (lapis, red / yellow), a two-voxel parapet
  // with a pale coping and the owner's line round a sunk deck
  const AR = bandRows('lapis');
  for (let x = r0x; x < r1x; x++) for (let z = r0z; z < r1z; z++) {
    const e = Math.min(x - r0x, r1x - 1 - x, z - r0z, r1z - 1 - z);
    m.set(x, cy, z, e === 0 ? AR[0] : LIME_S);
    m.set(x, cy + 1, z, e === 0 ? AR[2](x, cy + 1, z) : SAND_D(x, cy + 1, z));
    m.set(x, cy + 2, z, e <= 1 ? LIP(x, cy + 2, z) : EDECK(x, cy + 2, z));
    if (e <= 1) m.set(x, cy + 3, z, e === 1 ? TEAM : LIP(x, cy + 3, z));
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

// Obelisk (1 x 1, drawn over 1.5 x 1.5 like the sentry tower; building_12).
// Round 36: modelled at third voxels (`fine: 3` in TYPES, 1/24 tile) so the
// needle can be slim: one monolith 12 fine voxels across at the foot,
// tapering steadily (a voxel each side every 50 rows, smoothed by skin()) to
// ~7.5 under the tip, 114 rows tall (1 : 9.5), on a low stepped plinth (a
// dark base course, a sandstone tier with a limestone tread, a tier with
// painted lapis / ochre / red panels under a lapis-and-ochre fluted cavetto
// and a limestone lip with the owner's line, a limestone die). The shaft is
// warm sandstone in tall faint courses; down the middle of every face runs a
// flush inscription column on pale limestone between two ochre rules:
// ordered glyphs, one per register, in one lapis + ochre palette (a
// cartouche, a falcon, an ankh, a sun disc, a reed, water, an eye, a seated
// god...). A gold collar under the tip and an electrum pyramidion, its sunlit
// faces a pale gilt, the shaded ones a deep gold, so the cap catches the
// light. The owner's colour rings the shaft's foot.
// deep golds: under the sun's tonemapping a pale gilt washes out to sand, so
// the obelisk's gold is a saturated, darker leaf (lit faces still read gold)
const OB_GOLD = 0xd6aa00, OB_GOLD_L = 0xf4cc00, OB_GOLD_D = 0x8e6800, OB_PANEL = 0xe6b800, OB_INK = 0x3a2606;
const OB_CAP = 0xd8b400, OB_CAP_L = 0xe6c400, OB_CAP_D = 0xa88a00;   // the cap's leaf: darker still, so egypt_building.gdshader's gilt highlight stays gold, not cream
const OBS = 0xd9bc8a, OBS_J = 0xc9ab79, OBF = 0xf2e7cf, OBG_B = 0x2c4f8c, OBG_O = 0xa8621a, OBG_R = 0xa8452c;
// the glyphs, 4 wide (b lapis, o ochre, r red), top row first
const OB_GLYPHS = [
  ['.oo.', 'o..o', 'obbo', 'o..o', 'orro', 'o..o', '.oo.', 'oooo'],   // a cartouche on its shen bar
  ['.b..', 'bbb.', 'obbb', '.bbb', '..bb', '.o.o'],                   // a falcon
  ['.bb.', 'b..b', '.bb.', 'bbbb', '.bb.', '.bb.'],                   // an ankh
  ['.rr.', 'rrrr', 'rrrr', '.rr.'],                                    // the sun disc
  ['..b.', '.bb.', '..b.', '.bb.', '..b.', '..b.'],                   // a reed
  ['bbbb', '....', 'bbbb'],                                            // water
  ['.bb.', 'bobb', '.bb.', '..b.', '.bb.'],                            // the eye
  ['.oo.', '.o..', 'oooo', 'oo..', 'oooo'],                            // a seated god
];
function obelisk() {
  const m = lot(36, 36, SANDGROUND);
  const ring = (y, a, b, f) => { for (let x = a; x < b; x++) for (let z = a; z < b; z++) pset(m, x, y, z, f(x, z, Math.min(x - a, b - 1 - x, z - a, b - 1 - z))); };
  // the plinth: base course, a sandstone tier with a limestone tread, the
  // painted tier under a cavetto and a lip, a limestone die
  const PB = 0x6e5840, ST = 0xd8b985, ST_D = 0xc4a271, LM = 0xeee3c9, LM_D = 0xdccfb2;
  ring(1, 5, 31, () => PB);
  for (let y = 2; y <= 4; y++) ring(y, 6, 30, (x, z, e) => (e > 0 ? ST_D : y === 3 && ((x + z) % 9 === 0) ? ST_D : ST));
  ring(5, 6, 30, (x, z, e) => (e === 0 ? LM : ST_D));
  // the painted tier: on each face a row of panels (lapis, ochre, red) between limestone frames
  const PAN = [LM_D, OBG_B, OBG_B, LM_D, OBG_O, OBG_O, LM_D, OBG_R, OBG_R, LM_D, OBG_O, OBG_O, LM_D, OBG_B, OBG_B, LM_D, OBG_O, OBG_O, LM_D, OBG_B];
  for (let y = 6; y <= 10; y++) ring(y, 8, 28, (x, z, e) => {
    if (e > 0) return ST_D;
    if (y === 6 || y === 10) return LM;
    const a = (x === 8 || x === 27) ? z - 8 : x - 8;
    return y === 7 && PAN[a] !== LM_D ? shade(PAN[a], 0.85) : PAN[a];
  });
  // the fluted cavetto (lapis and ochre flutes) and the lip with the owner's line
  for (let y = 11; y <= 12; y++) ring(y, 8 - (y - 11), 28 + (y - 11), (x, z, e) => (e > 0 ? ST_D : (((x + z) >> 1) & 1) ? OBG_B : 0x3d65a0));
  ring(13, 6, 30, (x, z, e) => (e === 2 ? TEAM : e === 0 ? LM : LM_D));
  ring(14, 9, 27, (x, z, e) => (e === 0 ? LM : LM_D));
  ring(15, 10, 26, (x, z, e) => (e === 0 ? LM : LM_D));
  // the shaft: voxels 13..23 from y 16, 114 rows, a voxel in each 50 rows
  const Y0 = 16, H = 114, B = 50, TOP = Y0 + H;
  m.blocks.push({ x0: 13, z0: 13, x1: 23, z1: 23, y0: Y0, h: H, b: B, base: 0 });
  // the inscription: rows G0 .. G1 on columns 16..19 (ochre rules on 15 and 20)
  const G0 = Y0 + 7, G1 = Y0 + 96;
  const glyphAt = new Map();   // row -> [glyph index, row in glyph]
  for (let y = G1 - 2, g = 0; ; g++) {
    const G = OB_GLYPHS[g % OB_GLYPHS.length];
    if (y - G.length + 1 < G0 + 1) break;
    for (let r = 0; r < G.length; r++) glyphAt.set(y - r, G[r]);
    y -= G.length + 2;
  }
  const faceCol = (c, y) => {
    if (y < G0 || y > G1) return null;
    if (c === 15 || c === 20) return OBG_O;
    if (c < 16 || c > 19) return null;
    if (y === G0 || y === G1) return OBG_O;
    const row = glyphAt.get(y);
    const ch = row ? row[c - 16] : '.';
    return ch === 'b' ? OBG_B : ch === 'o' ? OBG_O : ch === 'r' ? OBG_R : OBF;
  };
  for (let y = Y0; y < TOP; y++) {
    const k = Math.floor((y - Y0) / B);
    const a = 13 + k, b = 23 - k;
    const joint = (y - Y0) % 19 === 18;
    for (let x = a; x < b; x++) for (let z = a; z < b; z++) {
      let c = joint ? OBS_J : OBS;
      if (y === Y0) c = TEAM;
      else if (y >= TOP - 4) c = y === TOP - 4 || y === TOP - 1 ? OB_CAP_D : OB_CAP;
      else {
        const onZ = z === a || z === b - 1, onX = x === a || x === b - 1;
        const fc = onZ && !onX ? faceCol(x, y) : onX && !onZ ? faceCol(z, y) : null;
        if (fc !== null) c = fc;
      }
      pset(m, x, y, z, c);
    }
  }
  // the pyramidion: a stepped gold core under a smooth four-sided cap
  const hw = 6 - H / B, cx = 18, cz = 18, ap = [cx, TOP + 8.5, cz];   // hw: the skin's half-width at TOP
  for (let i = 0; i < 4; i++) for (let x = 15 + i; x < 21 - i; x++) for (let z = 15 + i; z < 21 - i; z++) pset(m, x, TOP + 2 * i, z, OB_CAP);
  const sq = [[cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw]];
  // faces -z, +x, +z, -x: the sun is from the south-east of the default view
  const lit = [OB_CAP, OB_CAP_L, OB_CAP_L, OB_CAP];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = sq[i], [bx, bz] = sq[(i + 1) % 4];
    const mx = (ax + bx) / 2 - cx, mz = (az + bz) / 2 - cz;
    poly(m, [[ax, TOP, az], [bx, TOP, bz], ap], lit[i], { out: [mx, 0.6, mz] });
  }
  poly(m, sq.map(([x, z]) => [x, TOP, z]), OB_GOLD_D, { out: [0, -1, 0] });
  m.keep = [[10, TOP - 4, 10, 26, TOP + 9, 26]];   // the collar and the cap keep their gold (geo())
  m.stageStep = 16;   // scaffolding at fine voxels: poles and decks 2 / 3 tile apart
  return m;
}

// a small processional obelisk (the temple's ramp pair, the wonder's door
// pair): a stepped two-tier base, a 2 x 2 voxel shaft skinned as one smooth
// taper (4 voxels at the foot to ~1.5 under the tip) with a team ring at the
// foot and a gold band under the tip, and a smooth gold pyramidion. (cx, cz):
// the shaft's centre (a voxel corner).
function smallObelisk(m, cx, cz, y0, h = 20, { small = false } = {}) {
  // (small: one 4 x 4 die two courses high instead of the 6 x 6 / 4 x 4 steps)
  if (small) { m.box(cx - 2, y0, cz - 2, 4, 1, 4, SAND_D); m.box(cx - 2, y0 + 1, cz - 2, 4, 1, 4, LIME); }
  else {
    m.box(cx - 3, y0, cz - 3, 6, 1, 6, SAND_D);
    m.box(cx - 2, y0 + 1, cz - 2, 4, 1, 4, LIME);
  }
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
  // (round 41) a clean one-voxel gold line drawing on the dark panel (no
  // white fill): the brow, the almond eye with the pupil touching both lids
  // and lapis whites, the cosmetic line running out to the temple, the
  // straight drop and the spiral tail under it
  const EYE = [
    '...GGGGGGGGGGGG...',
    '..................',
    '......GGGGGG......',
    '....GG..GG..GG....',
    '..GG...GGGG...GGGG',
    '....GG..GG..GG....',
    '......GGGGGG......',
    '.....G......G.....',
    '.....G.......G.GG.',
    '....GG........GG.G',
  ];
  // a gold frame, one dark column either side of the drawing and a dark row
  // over it (ten rows fit under the owner's line)
  const at = (a, r, c) => { const [x, z] = faceXZ(f, x0, z0, x1, z1, a, 0); m.set(x, y0 + r, z, c); };
  const W = EYE[0].length + 4, H = EYE.length + 3;
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    const a = a0 - W / 2 + i;
    const edge = i === 0 || j === 0 || i === W - 1 || j === H - 1;
    let c = edge ? SG_L : 0x1e242c;
    const ch = (EYE[H - 3 - j] || '')[i - 2];
    if (!edge && ch && ch !== '.') c = SG_L;
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
      eyePanel(m, f, x0, z0, x1, z1, y0, L / 2, 1);   // (round 41: a row lower, clear of the cornice's shadow)
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
function monDie(m, x0, z0, x1, z1, y0, h, { lite = false } = {}) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) m.set(x, y, z, PL_GRAN);
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) m.set(x, y0 + h, z, x === x0 || z === z0 || x === x1 - 1 || z === z1 - 1 ? SG : PL_GRAN);
  if (lite) {
    // (round 41, the Monument to the Gods) the die in gilt: gold sides under a
    // bright gold top course, a dark foot line; its top a pale limestone deck
    // inside a gold rim and a ring of dark / gold ticks (Retold's die), so
    // the statue's feet stand out against it
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const edge = x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1;
      if (edge) m.set(x, y, z, y === y0 ? PL_GRAN_D : y === y0 + h - 1 ? SG_L : SG);
    }
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      const e = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z);
      const along = (x - x0 + z - z0) & 1;
      m.set(x, y0 + h, z, e === 0 ? SG_L : e === 1 ? (along ? SG : PL_GRAN_D) : 0xd8cbac);
    }
  }
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
// golds deep enough that AgX keeps them gold in the sun (brighter ones wash to
// cream / tan), a desaturated lapis for inlay (no pure-blue stickers), ivory eyes
const GRAN = 0x2a3039, GRAN_D = 0x1c2027, GRAN_F = 0x343d47, CG = 0x9c6800, CG_L = 0xb88400, CG_D = 0x664200;
const LAPIS_S = 0x34558c, KOHL = 0x1a2a4a, IVORY = 0xe8dcc0;
// figure()'s options in cleanStatue()'s terms (the Town Center's and the
// Temple's gods)
function toClean(o) {
  const head = o.head === 'falcon' || o.head === 'jackal' ? o.head : (o.crown ?? 'nemes') === 'nemes' ? 'nemes' : o.crown === 'tall' || o.crown === 'atef' ? 'double' : 'wig';
  const crown = o.crown === 'disc' || o.crown === 'horns' ? o.crown : o.crown === 'vulture' ? 'modius' : null;
  const arms = o.arms === 'bowls' ? 'pots' : o.arms === 'wings' ? 'wings' : o.arms === 'staff' ? 'staff' : o.arms === 'side' || o.arms === 'embrace' ? 'side' : 'crossed';
  // the gods (falcon, jackal, Isis' horns) in the lighter slate stone (round 18)
  const god = head === 'falcon' || head === 'jackal' || crown === 'horns';
  return { pose: o.pose ?? 'stride', head, crown, arms, god, sand: o.sand, kilt: o.kilt === undefined || o.kilt === BASALT ? GRAN : CG, kiltFront: o.kiltFront === undefined ? TEAMB : o.kiltFront };
}
function cleanStatue(m, cx, y0, cz, o = {}) {
  const { pose = 'stride', head = 'nemes', arms = 'side', kiltFront = TEAMB } = o;
  const kilt = o.kilt ?? GRAN;
  const touched = [];
  const set = (x, y, z, c) => {
    m.set(cx + x, y0 + y, cz + z, c);
    const v = m.get(cx + x, y0 + y, cz + z);
    if (v) { v.clean = 1; touched.push([cx + x, y0 + y, cz + z]); }
  };
  const B = (xa, xb, ya, yb, za, zb, c) => {
    for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) for (let z = za; z < zb; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  };
  const S = (hw, ya, yb, za, zb, c) => B(-hw, hw, ya, yb, za, zb, c);
  const M = (xa, xb, ya, yb, za, zb, c) => { B(xa, xb, ya, yb, za, zb, c); B(-xb, -xa, ya, yb, za, zb, c); };   // mirrored pair
  // the back pillar (o.pillar = [x0, x1, top]): a granite slab behind the
  // figure(s) from the base to the shoulders, a gold top line, an inscribed
  // gold column down its back; the figure is cut against it
  if (o.pillar) {
    const [pa, pb, pt] = o.pillar;
    B(pa, pb, 0, pt, -8, -3, (x, y, z) => (y === pt - 1 ? CG_L : z === -8 && Math.abs(x - Math.round((pa + pb) / 2) + 0.5) < 2 && y > 3 && y < pt - 3 ? ((y % 3) ? CG : LAPIS_S) : GRAN));
  }
  // kn lifts the torso and head: down for the kneeling figure, up for the
  // standing ones, whose legs and kilt are drawn longer (a head about a
  // seventh of the figure, not a mannequin's quarter)
  const kn = pose === 'kneel' ? -16 : pose === 'stride' || pose === 'stand' ? 6 : pose === 'dress' ? 4 : 0;
  // one-voxel bands, gold and lapis alternating (a gold wig: gold / dark gold)
  // (o.sand: an umber headdress with a gold line every third row, so it
  // reads as one darker shape framing the gilt falcon head, not a noise of
  // one-voxel stripes)
  // (o.basalt, round 37: wide bands, three gold rows and two lapis, so the
  // nemes frames the face instead of swallowing it)
  // (o.lite, round 41: the gods' wigs mostly lapis, a gold row in three, so
  // the gilt falcon head and the gold-edged jackal head stand out against them)
  const stripe = o.wig === 'gold' ? (x, y) => ((y - kn) & 1 ? CG_D : CG) : o.lite ? (x, y) => ((y - kn + 60) % 3 === 0 ? CG : LAPIS_S) : o.basalt ? (x, y) => ((y - kn + 60) % 5 < 3 ? CG : LAPIS_S) : o.sand ? (x, y) => ((y - kn + 60) % 3 === 0 ? CG : LAPIS_S) : (x, y) => ((y - kn) & 1 ? LAPIS_S : CG);

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
    // a queen's sheath dress (building_16): bare granite feet and shins, a
    // gold dress clinging from the ankles to under the bust (hips swelling,
    // a waist, a gold hem), the shins together
    M(1, 4, 0, 1, -2, 5, GRAN);                                // the feet
    M(1, 4, 1, 2, -2, 3, GRAN);                                // insteps
    for (let x = 1; x < 4; x += 2) { set(x, 0, 4, GRAN_D); set(-1 - x, 0, 4, GRAN_D); }   // toes
    M(1, 4, 2, 9, -2, 2, GRAN);                                // the shins
    M(1, 4, 4, 10, -3, -2, GRAN);                              // calves
    if (o.anklets !== 0) M(1, 4, 2, 3, -2, 2, CG_L);           // anklets
    for (let y = 9; y < 30 + kn; y++) {
      const hw = y < 14 ? 4 : y < 20 ? 5 : y < 29 ? 6 : 5, zb = y < 20 ? -3 : -4, zf = y < 14 ? 2 : 3;
      B(-hw, hw, y, y + 1, zb, zf + 1, () => (y === 9 ? CG_L : y === 10 ? CG_D : CG));
    }
  } else if (pose === 'kneel') {
    M(1, 6, 0, 3, -7, 3, GRAN);                                // shins folded back
    M(1, 6, 3, 7, -4, 8, GRAN);                                // thighs forward to the knees
    S(7, 5, 9, -4, 4, (x) => (((x + 64) >> 1) & 1 ? GRAN_D : kilt));   // the pleated kilt over the lap
    S(7, 9, 10, -4, 5, CG_L);                                  // the belt
  } else {
    // the legs in the canonical stride (building_15 / _16): the left leg
    // (+x: the figure faces +z) set a full foot forward and leaning, the
    // right one upright; each a long foot with an instep and toes, a narrow
    // ankle, a shin with the calf bulging back, a knee cap, a fuller thigh
    const f = pose === 'stride' ? 7 : 0;
    for (const sx of [-1, 1]) {
      const fw = sx > 0 ? f : 0;
      const L = (y) => Math.round(fw * Math.max(0, 23 - y) / 23);
      const X = (a, b, y, ya, yb, za, zb, c) => (sx > 0 ? B(a, b, ya, yb, za + L(y), zb + L(y), c) : B(-b, -a, ya, yb, za + L(y), zb + L(y), c));
      X(1, 5, 0, 0, 1, -3, 6, GRAN);                           // the foot
      X(1, 5, 0, 1, 2, -3, 3, GRAN);                           // the instep
      for (let x = 1; x < 5; x += 2) X(x, x + 1, 0, 0, 1, 5, 6, GRAN_D);   // toes
      X(2, 4, 2, 2, 4, -2, 1, GRAN);                           // the ankle
      if (o.anklets) X(1, 5, 3, 3, 4, -3, 2, CG_L);           // an anklet, proud
      for (let y = 4; y < 13; y++) X(1, 4, y, y, y + 1, -2, 2, GRAN);           // the shin
      for (let y = 6; y < 11; y++) X(1, 4, y, y, y + 1, -3, -2, GRAN);          // the calf
      for (let y = 13; y < 15; y++) X(1, 5, y, y, y + 1, -2, 2, GRAN);          // the knee
      X(2, 4, 14, 13, 15, 2, 3, GRAN);                         // the knee cap
      for (let y = 15; y < 23; y++) X(1, 6, y, y, y + 1, -3, 3, GRAN);          // the thigh
    }
    // the shendyt (a gold kilt): a trapezoid flaring from the waist to the
    // hem, its diagonal pleats in one-voxel lines, a dark hem line; the front
    // apron a voxel proud, tapering, banded light / dark gold with a thin
    // lapis edge, the belt and its buckle over it
    const gk = kilt !== GRAN, KL = gk ? CG : GRAN, KD = gk ? CG_D : GRAN_D;
    for (let y = 21; y < 31; y++) {
      const hw = y >= 27 ? 6 : 7, zf = 5;
      B(-hw, hw, y, y + 1, -4, zf, (x) => (y === 21 ? KD : (!o.sand && (x - (y >> 1) + 64) % 4 === 0) ? KD : KL));   // (o.sand: plain, no pleat lines)
    }
    if (kiltFront !== null) for (let y = 21; y < 31; y++) {
      const hw = y >= 27 ? 2 : 3, zf = 5;
      B(-hw, hw, y, y + 1, zf, zf + 1, (x) => (x === -hw || x === hw - 1 || y === 21 ? CG_D : CG_L));
    }
    S(6, 31, 32, -4, 5, CG_L);                                 // the belt
    B(-2, 2, 31, 32, 5, 6, (x) => (x === -2 || x === 1 ? CG_L : LAPIS_S));   // the buckle
  }
  // ---- the torso
  const male = pose === 'stride' || pose === 'stand';
  if (male) {
    // tapering from the shoulders to a waist: the waist, the ribs, the chest
    // with the pectorals a voxel proud and a shadow line under them, square
    // shoulders with the deltoids rounded over the arm
    S(5, 26 + kn, 28 + kn, -3, 3, GRAN);
    S(6, 28 + kn, 30 + kn, -3, 4, GRAN);
    S(7, 30 + kn, 34 + kn, -3, 4, GRAN);
    S(8, 34 + kn, 35 + kn, -3, 4, GRAN);
    S(7, 35 + kn, 36 + kn, -3, 3, GRAN);
    B(-6, -1, 30 + kn, 32 + kn, 4, 5, GRAN); B(1, 6, 30 + kn, 32 + kn, 4, 5, GRAN);   // pectorals
    B(-1, 1, 27 + kn, 28 + kn, 2, 3, GRAN_D);                            // the navel
  } else if (pose === 'dress') {
    S(6, 30 + kn, 34 + kn, -3, 4, GRAN);
    S(7, 34 + kn, 35 + kn, -3, 4, GRAN);
    S(6, 35 + kn, 36 + kn, -3, 3, GRAN);
    B(-5, -1, 29 + kn, 31 + kn, 4, 5, CG); B(1, 5, 29 + kn, 31 + kn, 4, 5, CG);    // the bust under the dress
    S(5, 31 + kn, 32 + kn, -3, 4, CG_L);                                 // the dress's top edge
  } else {
    if (pose !== 'mummy') {
      S(6, 26 + kn, 29 + kn, -3, 3, GRAN);
      S(7, 29 + kn, 33 + kn, -3, 4, GRAN);
    }
    S(9, 33 + kn, 35 + kn, -3, 4, GRAN);
    S(8, 35 + kn, 36 + kn, -3, 4, GRAN);
  }
  // ---- the broad collar: one-voxel rings, gold and lapis alternating, a
  // bead row at the rim
  for (let y = 30 + kn; y < 36 + kn; y++) for (let x = -8; x < 8; x++) {
    const d = Math.hypot(x + 0.5, (36.3 + kn - y) * 1.25);
    const r = [2.4, 3.3, 4.2, 5.1, 6.0, 6.8];
    const c = d < r[0] || d >= r[5] ? null : o.sand ? (d < r[3] ? CG_L : d < r[4] ? LAPIS_S : CG) : d < r[1] ? CG_L : d < r[2] ? LAPIS_S : d < r[3] ? CG : d < r[4] ? LAPIS_S : ((x + 64) & 1 ? CG_L : CG_D);
    if (c) set(x, y, male || pose === 'dress' ? 4 : 4, c);
  }
  // ---- arms
  if (arms === 'side') {
    // hanging free of the body (air between the arm and the waist / kilt):
    // a rounded deltoid, the upper arm, a narrower elbow, the forearm, a
    // clenched fist holding a gold cloth roll (its end showing in front, the
    // knuckles in a dark line), a gold armlet and bracelet
    const xa = male ? 8 : 7, w = male ? 3 : 2;
    M(xa, xa + w, 33 + kn, 35 + kn, -2, 3, GRAN);                        // the deltoid
    M(xa, xa + w - 1, 35 + kn, 36 + kn, -2, 2, GRAN);
    M(xa, xa + w, 27 + kn, 33 + kn, -2, 2, GRAN);                        // the upper arm
    M(xa, xa + w, 21 + kn, 27 + kn, -1, 2, GRAN);                        // the forearm
    M(xa, xa + w, 20 + kn, 21 + kn, -1, 1, GRAN);                        // the wrist
    if (male) {
      M(xa, xa + w, 16 + kn, 20 + kn, -2, 2, GRAN);                      // the fist
      M(xa, xa + w, 17 + kn, 18 + kn, 1, 2, GRAN_D);                     // the knuckles' line
      M(xa + 1, xa + 2, 16 + kn, 18 + kn, 2, 3, CG_L);                   // the roll's end
    } else M(xa, xa + w, 15 + kn, 20 + kn, -1, 1, GRAN);                 // the open hand
    M(xa, xa + w, 30 + kn, 31 + kn, -2, 2, CG_L);                        // armlets
    M(xa, xa + w, 21 + kn, 22 + kn, -1, 2, CG_L);                        // bracelets
  } else if (arms === 'embrace') {
    // the queen: the far arm hanging, the near one (-x) reaching across to
    // the king's arm, the hand resting on it in front
    B(7, 9, 33 + kn, 35 + kn, -2, 3, GRAN); B(7, 9, 21 + kn, 33 + kn, -2, 2, GRAN); B(7, 9, 15 + kn, 21 + kn, -1, 1, GRAN);
    B(7, 9, 30 + kn, 31 + kn, -2, 2, CG_L); B(7, 9, 21 + kn, 22 + kn, -1, 2, CG_L);
    B(-9, -7, 33 + kn, 35 + kn, -2, 3, GRAN);                            // the near shoulder
    B(-9, -7, 28 + kn, 33 + kn, -1, 3, GRAN);                            // the upper arm, angled forward
    B(-10, -8, 26 + kn, 29 + kn, 1, 4, GRAN);                            // the elbow
    B(-12, -9, 25 + kn, 27 + kn, 2, 4, GRAN);                            // the forearm across
    B(-10, -9, 25 + kn, 27 + kn, 2, 4, CG_L);                            // the bracelet
    B(-13, -11, 24 + kn, 27 + kn, 2, 4, GRAN);                           // the hand on his arm
  } else if (arms === 'staff') {
    // a god (round 18): both arms one continuous limb from a rounded
    // shoulder cap over the torso's corner, the upper arm against the chest
    // side, the elbow, the forearm, the fist. The near (right, -x) arm bent
    // forward, its fist holding the was-sceptre upright (a forked foot on the
    // plinth, a gold shaft, the angled animal head above the god's head); the
    // far (left, +x) arm hanging, the fist holding an ankh by its loop
    M(6, 10, 32 + kn, 35 + kn, -3, 3, GRAN);                             // shoulder caps
    M(6, 9, 35 + kn, 36 + kn, -2, 2, GRAN);
    M(7, 10, 26 + kn, 32 + kn, -2, 2, GRAN);                             // upper arms
    M(7, 10, 29 + kn, 30 + kn, -2, 2, CG_L);                             // armlets
    // the far arm, hanging: the forearm, wrist, fist, bracelet
    B(7, 10, 20 + kn, 26 + kn, -2, 2, GRAN);
    B(7, 10, 19 + kn, 20 + kn, -1, 1, GRAN);
    B(7, 10, 15 + kn, 19 + kn, -2, 2, GRAN);
    B(7, 10, 17 + kn, 18 + kn, 1, 2, GRAN_D);                            // knuckles
    B(7, 10, 20 + kn, 21 + kn, -2, 2, CG_L);
    // the ankh hanging from it by the loop (two voxels deep, in gold)
    for (const z of [-1, 0]) {
      set(7, 14 + kn, z, CG_L); set(9, 14 + kn, z, CG_L);                // the loop's sides
      set(7, 13 + kn, z, CG_L); set(9, 13 + kn, z, CG_L);
      for (let x = 6; x < 11; x++) set(x, 12 + kn, z, CG_L);             // the bar
      for (let y = 7; y < 12; y++) set(8, y + kn, z, CG_L);              // the stem
      for (let x = 7; x < 10; x++) set(x, 6 + kn, z, CG_L);              // its foot
    }
    // the near arm, bent forward at the elbow: the forearm level, the fist
    // forward round the sceptre, a bracelet
    B(-10, -7, 23 + kn, 27 + kn, -2, 3, GRAN);                           // the elbow
    B(-10, -7, 23 + kn, 26 + kn, 3, 6, GRAN);                            // the forearm
    B(-10, -7, 23 + kn, 26 + kn, 3, 4, CG_L);                            // the bracelet
    B(-11, -7, 22 + kn, 27 + kn, 6, 9, GRAN);                            // the fist
    B(-11, -10, 23 + kn, 26 + kn, 8, 9, GRAN_D);                         // the knuckles' line
    // the was-sceptre through the fist: a 2 x 2 gold shaft from the plinth
    // to above the head, the forked foot, the head angled forward with a snout
    const top = 53 + kn;
    for (let y = 2; y < top; y++) if (y < 22 + kn || y >= 27 + kn) B(-10, -8, y, y + 1, 7, 9, CG);
    B(-10, -8, 0, 2, 6, 7, CG_L); B(-10, -8, 0, 2, 9, 10, CG_L); B(-10, -8, 1, 2, 7, 9, CG_L);   // the fork
    B(-10, -8, top, top + 2, 6, 10, CG_L);                               // the head, forward
    B(-10, -8, top - 1, top, 10, 11, CG_L);                              // its snout, hooked down
    B(-10, -8, top + 2, top + 3, 6, 8, CG);                              // the ears behind
  } else if (arms === 'crossed') {
    // forearms crossed on the chest as two plain blocks, the fists forward;
    // the upper arms join the torso under rounded shoulder caps (round 18:
    // no gap, no floating pillars)
    if (pose !== 'mummy') {
      M(6, 10, 32 + kn, 35 + kn, -3, 3, GRAN);
      M(6, 9, 35 + kn, 36 + kn, -2, 2, GRAN);
      B(7, 10, 27 + kn, 32 + kn, -2, 2, GRAN); B(-10, -7, 30 + kn, 32 + kn, -2, 2, GRAN);
      B(7, 10, 30 + kn, 31 + kn, -2, 2, CG_L);
      B(7, 10, 27 + kn, 30 + kn, 2, 6, GRAN);                  // the elbows, turning forward
      B(-10, -7, 30 + kn, 33 + kn, 2, 6, GRAN);
    }
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
    // (round 18: one continuous limb, no gap at the shoulder) a rounded
    // shoulder cap over the torso's corner, the arm running out and down on
    // the diagonal (a 3 x 3 section swept from the shoulder to the wrist), a
    // gold bracelet, a clenched fist; the wing hanging behind the arm from
    // its whole length: a gold leading edge, lapis coverts with gold
    // scallops, a gold line, long gold primaries split by dark lines, the
    // tips stepping down toward the body
    const P = (x, y, z, c) => { set(x, y, z, c); set(-1 - x, y, z, c); };
    M(5, 9, 32 + kn, 36 + kn, -3, 3, GRAN);
    M(5, 8, 36 + kn, 37 + kn, -2, 2, GRAN);
    const yArm = (x) => 33 - (x - 8) * 8 / 7;
    for (let s = 0; s <= 14; s++) {
      const t = s / 14, ax = Math.round(8 + 7 * t), ay = Math.round(33 - 8 * t), az = Math.round(2 * t);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) P(ax + i, ay + j + kn, az + k, s === 11 || s === 12 ? CG_L : GRAN);
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 3; k++) P(15 + i, 22 + j + kn, 2 + k, GRAN);   // the fists
    for (let i = 0; i < 3; i++) P(15 + i, 23 + kn, 5, GRAN_D);                                                           // knuckles
    // (round 41) the wing in four horizontal rows of feathers under a gold
    // leading edge: lapis coverts, white secondaries, gold tertials, then the
    // long lapis primaries split by gold quills; each row's lower edge
    // scalloped (the feathers two voxels wide, alternate ones a voxel longer)
    // so the rows read as feathers, not one hanging cloth
    for (let x = 7; x < 19; x++) {
      const top = Math.round(yArm(Math.min(x, 16))) + (x < 9 ? 1 : 2);
      const bot = Math.round(9 + (x - 6) * 0.25) - ((x & 1) ? 0 : 1);
      const sc = (x >> 1) & 1;                                   // the scallop: every other feather a voxel longer
      for (let y = bot; y <= top; y++) for (const z of [-2, -1]) {
        const d = top - y - sc;
        let c;
        if (top - y === 0) c = CG_L;                              // the leading edge
        else if (d < 3) c = d === 2 ? ((x & 1) ? CG_L : ST_LAPIS) : ST_LAPIS;   // coverts, gold-tipped
        else if (d < 6) c = d === 5 ? CG_L : ST_WHITE;            // white secondaries
        else if (d < 9) c = d === 8 ? CG_D : ((x & 1) ? CG_L : CG);   // gold tertials
        else c = y === bot ? CG_L : (x % 3 === 0 ? CG_L : ST_LAPIS);   // lapis primaries, gold quills and tips
        P(x, y + kn, z, c);
      }
    }
  } else if (arms === 'pots') {
    // (round 37) the kneeling offerer of building_13: the arms hang free of
    // the body (a voxel of air at the waist), bend at the elbow and run
    // forward and down along the thighs, the open palms turned up in front
    // of the knees, a gold offering pot standing on each palm, the fingers'
    // tips curled up round its foot
    M(8, 11, 17, 19, -2, 3, GRAN);                   // the shoulder caps
    M(8, 11, 11, 17, -2, 2, GRAN);                   // upper arms, hanging
    M(8, 11, 14, 15, -2, 2, CG_L);                   // armlets
    M(8, 11, 9, 11, -2, 3, GRAN);                    // the elbows
    M(8, 11, 8, 10, 3, 5, GRAN);                     // forearms, forward and down
    M(8, 11, 7, 9, 5, 7, GRAN);
    M(8, 11, 7, 9, 6, 7, CG_L);                      // bracelets
    M(6, 11, 7, 8, 7, 12, GRAN);                     // the open palms
    M(6, 11, 8, 9, 11, 12, GRAN_F);                  // finger tips, curled up
    M(10, 11, 8, 9, 7, 11, GRAN_F);                  // the thumb's edge
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? -10 : 6;                             // the pot over the palm's centre
      B(xa, xa + 4, 8, 13, 7, 11, (x, y, z) => {
        const ix = x - xa, iz = z - 7, cxn = (ix === 0 || ix === 3) && (iz === 0 || iz === 3);
        const yy = y;
        if (cxn && (yy === 8 || yy === 12)) return null;       // the rounded foot and shoulder
        if (yy === 12 && ix > 0 && ix < 3 && iz > 0 && iz < 3) return GRAN_D;   // the mouth
        return yy === 12 || yy === 10 ? CG_L : CG;
      });
    }
  }
  // ---- neck and head: a flat face
  S(2, 36 + kn, 38 + kn, -1, 2, GRAN);
  const human = head === 'nemes' || head === 'double' || head === 'wig';
  if (human) {
    // a face that reads from the RTS camera: a lighter face plane, a nose
    // ridge a voxel proud, lapis brows, ivory eyes with dark pupils and the
    // kohl line running out to the temples, a dark mouth line
    S(4, 38 + kn, 46 + kn, -3, 4, (x, y, z) => (z === 3 ? GRAN_F : GRAN));
    if (o.basalt) {
      // (round 37) a carved face in three values that reads at RTS zoom: a
      // brow ridge a voxel proud, the eyes set in a shadowed socket under it,
      // a straight nose proud from the brow to a lit tip over a shadowed
      // nostril line, lit cheek planes, full lips over a dark mouth line, a
      // short beard flush under the chin (no stub)
      B(-4, 4, 45 + kn, 46 + kn, 4, 5, GRAN_F);                // the brow ridge
      B(-4, 4, 44 + kn, 45 + kn, 3, 4, GRAN_R);                // the sockets' shadow
      M(1, 4, 43 + kn, 44 + kn, 3, 4, IVORY);                  // the eyes, three wide
      M(1, 2, 43 + kn, 44 + kn, 3, 4, KOHL);                   // pupils
      M(3, 4, 43 + kn, 44 + kn, 3, 4, GRAN_R);                 // the outer corner
      B(-1, 1, 41 + kn, 45 + kn, 4, 5, GRAN_F);                // the nose
      B(-1, 1, 41 + kn, 42 + kn, 5, 6, BAS_H);                 // its lit tip
      B(-1, 1, 40 + kn, 41 + kn, 4, 5, GRAN_R);                // the nostrils' shadow
      M(2, 4, 41 + kn, 43 + kn, 3, 4, BAS_H);                  // cheek planes
      M(1, 2, 41 + kn, 43 + kn, 3, 4, GRAN);                   // the cheek's fold by the nose
      B(-2, 2, 40 + kn, 41 + kn, 4, 5, GRAN_F);                // the upper lip
      B(-2, 2, 39 + kn, 40 + kn, 3, 4, GRAN_R);                // the mouth
      B(-1, 1, 35 + kn, 38 + kn, 3, 5, GRAN);                  // the beard
      B(-1, 1, 35 + kn, 36 + kn, 3, 5, CG);
    }
    if (!o.basalt) {
    B(-1, 1, 41 + kn, 45 + kn, 4, 5, GRAN_F);                  // the nose ridge
    B(-1, 1, 41 + kn, 42 + kn, 4, 5, GRAN);                    // its tip
    M(1, 4, 45 + kn, 46 + kn, 3, 4, o.god ? CG_L : LAPIS_S);   // the brows (a goddess': gold)
    M(1, 3, 43 + kn, 44 + kn, 3, 4, IVORY);                    // the eyes
    M(1, 2, 43 + kn, 44 + kn, 3, 4, KOHL);                     // pupils
    M(3, 4, 43 + kn, 44 + kn, 3, 4, o.god ? CG_L : LAPIS_S);   // the kohl line
    if (!o.lite) B(-2, 2, 39 + kn, 40 + kn, 3, 4, GRAN_D);     // the mouth (o.lite: the lips alone)
    if (o.god) {
      // a goddess' face that reads at RTS zoom: the eye whites two rows
      // deep under gold brows, the lips a short warm line
      M(1, 3, 44 + kn, 45 + kn, 3, 4, IVORY);
      M(1, 2, 44 + kn, 45 + kn, 3, 4, KOHL);
      B(-1, 1, 39 + kn, 40 + kn, 3, 4, o.lite ? 0x7a3c30 : 0x4a2420);
    }
    if (pose !== 'dress') {
      B(-1, 1, 34 + kn, 38 + kn, 3, 5, GRAN);                  // the false beard
      B(-1, 1, 34 + kn, 35 + kn, 3, 5, CG);
    }
    }
  }
  // the tripartite wig of gods and queens: striped lappets down the chest, a
  // striped mass behind and over the ears
  if (head === 'wig' || head === 'falcon' || head === 'jackal') {
    const Y = kn;
    B(-5, 5, 37 + Y, 47 + Y, -4, -2, stripe);
    B(-5, -4, 38 + Y, 47 + Y, -4, 2, stripe); B(4, 5, 38 + Y, 47 + Y, -4, 2, stripe);
    M(4, 6, 31 + Y, 42 + Y, 2, 4, stripe);
    M(4, 6, 31 + Y, 32 + Y, 2, 4, CG_L);
    if (head === 'wig') {
      // the crown of the wig domed over the head, a gold fillet
      S(5, 46 + Y, 47 + Y, -4, 4, CG_L);
      S(4, 47 + Y, 48 + Y, -4, 3, stripe);
      S(3, 48 + Y, 49 + Y, -3, 2, stripe);
      S(2, 49 + Y, 50 + Y, -2, 1, stripe);
      if (o.wig === 'gold') {
        // the vulture headdress: wings down over the wig's sides, a vulture head at the brow
        M(4, 6, 40 + Y, 47 + Y, -3, 3, (x, y) => ((y & 1) ? CG : CG_D));
        B(-1, 1, 45 + Y, 48 + Y, 4, 5, CG_L);
      }
    }
  }
  if (head === 'falcon') {
    // Horus / Ra (round 18: a real falcon's profile): a gold head narrowing
    // to the throat with a domed crown, a dark beak three voxels out from
    // the face stepping down and out to a hooked tip, a pale cere
    // at its root; large dark eyes with a glint under gold brows, the
    // falcon's dark malar stripe running down each cheek
    const Y = kn;
    // (the head's golds are outside polishStatue's ramp, so the face stays
    // one clean gold plane behind the dark beak and eyes, not shaded dark)
    // (o.sand, the Temple's sandstone god: a warm ochre-gilt head, a step
    // apart from the limestone-and-gold striped wig round it)
    const HD = o.sand ? SAND_HEAD : SG, HD_L = o.sand ? SAND_HEAD_L : SG_L;
    S(3, 38 + Y, 40 + Y, -3, 3, HD);                           // the throat
    S(4, 40 + Y, 46 + Y, -3, 4, HD);                           // the head
    S(3, 46 + Y, 47 + Y, -2, 3, HD_L);                         // the domed crown
    S(2, 47 + Y, 48 + Y, -1, 2, HD_L);
    // the beak: a diagonal hook, each step a voxel further out and a
    // voxel lower, three rows deep at the root and one at the tip
    // (horn-brown, so it reads apart from the black eyes and stripes)
    const HORN = 0x4e3a22, DK = o.sand ? SAND_INK : GRAN_D;
    if (o.sand) {
      // the Temple's god (round 32): a short hooked beak (a skull-like long
      // beak and big pale-ringed eyes read as an elephant from the front):
      // the horn root under a pale cere, one step out and down, the dark
      // hooked tip; the eye a single dark row under the brow with the
      // falcon's tear-mark running down the cheek
      B(-1, 1, 43 + Y, 45 + Y, 4, 5, SAND_BEAK);               // the root
      B(-1, 1, 44 + Y, 45 + Y, 4, 5, HD_L);                    // the cere, gilt
      B(-1, 1, 42 + Y, 44 + Y, 5, 6, SAND_BEAK);
      B(-1, 1, 41 + Y, 43 + Y, 6, 7, DK);                      // the hooked tip
      M(2, 4, 43 + Y, 45 + Y, 3, 4, DK);                       // the eyes, round
      M(3, 4, 43 + Y, 45 + Y, 2, 3, DK);                       // round the side
      M(3, 4, 40 + Y, 43 + Y, 3, 4, DK);                       // the tear-mark
    } else {
      B(-1, 1, 42 + Y, 45 + Y, 4, 5, HORN);                      // the root
      B(-1, 1, 44 + Y, 45 + Y, 4, 5, IVORY);                     // the cere
      B(-1, 1, 41 + Y, 44 + Y, 5, 6, HORN);
      B(-1, 1, 40 + Y, 42 + Y, 6, 7, DK);
      B(-1, 1, 39 + Y, 40 + Y, 6, 7, DK);                    // the hooked tip
      B(-1, 1, 41 + Y, 42 + Y, 4, 5, CG_D);                      // the gape under it
      M(2, 3, 43 + Y, 45 + Y, 3, 4, DK);                     // the eyes, front
      M(2, 3, 44 + Y, 45 + Y, 3, 4, IVORY);                      // glints
      M(3, 4, 43 + Y, 45 + Y, 2, 3, DK);                     // and round the side
      M(2, 4, 45 + Y, 46 + Y, 3, 4, HD_L);                       // gold brows
      M(2, 3, 41 + Y, 43 + Y, 3, 4, DK);                     // the malar stripe, a teardrop
      if (o.lite) {
        // (round 41) the beak's upper edge stepped in gold to the dark tip
        B(-1, 1, 43 + Y, 44 + Y, 5, 6, CG_L);
        B(-1, 1, 41 + Y, 42 + Y, 6, 7, CG_L);
        S(4, 46 + Y, 47 + Y, -3, -2, CG_L);                      // the crown's back edge
      }
    }
  } else if (head === 'jackal') {
    // a jackal's head (round 18: Anubis' profile): a narrow skull, a long
    // muzzle six voxels out from the face, tapering, with a lighter bridge,
    // a dark mouth line and a black nose; gold-ringed eyes; tall pointed
    // ears two voxels deep, gilt inside, leaning out; the wig hugging the skull
    const Y = kn;
    S(3, 38 + Y, 47 + Y, -3, 3, GRAN);                         // the skull
    S(2, 47 + Y, 48 + Y, -2, 2, GRAN);
    M(3, 5, 38 + Y, 46 + Y, -4, 2, stripe);                    // the wig against it
    B(-2, 2, 39 + Y, 44 + Y, 3, 5, GRAN);                      // the muzzle's root
    B(-1, 1, 40 + Y, 43 + Y, 5, 9, GRAN);                      // the muzzle
    B(-1, 1, 43 + Y, 44 + Y, 3, 7, GRAN_F);                    // the bridge, light
    B(-1, 1, 42 + Y, 43 + Y, 7, 9, GRAN_F);
    B(-1, 1, 41 + Y, 43 + Y, 9, 10, GRAN_D);                   // the nose
    B(-1, 1, 40 + Y, 41 + Y, 5, 9, GRAN_D);                    // the mouth line
    B(-1, 1, 39 + Y, 40 + Y, 3, 7, GRAN);                      // the lower jaw
    M(1, 3, 44 + Y, 45 + Y, 2, 3, CG_L);                       // gold-ringed eyes
    M(1, 2, 44 + Y, 45 + Y, 2, 3, KOHL);
    for (let y = 47; y < 56; y++) {                            // the ears
      const w = y < 53 ? 2 : 1, xa = 1 + Math.floor((y - 47) / 5);
      M(xa, xa + w, y + Y, y + Y + 1, -1, 1, GRAN);
      if (y > 47 && y < 53) M(xa, xa + 1, y + Y, y + Y + 1, 1, 2, CG);
      // (round 41, o.lite) a one-voxel gold step on the ears' outer edge and tips
      if (o.lite) M(xa + w - 1, xa + w, y + Y, y + Y + 1, -1, 1, CG_L);
    }
    if (o.lite) {
      // the gold outline over the skull and along the muzzle's bridge to the nose
      S(2, 47 + Y, 48 + Y, -2, 2, CG_L);
      B(-1, 1, 43 + Y, 44 + Y, 3, 7, CG_L);
      B(-1, 1, 42 + Y, 43 + Y, 7, 9, CG_L);
    }
  }
  if (o.crown === 'disc') {
    // Ra's sun disc: a flat red disc with a one-voxel gold rim behind the head, a uraeus
    const Y = kn, cy = 52.5, r = 5.2;
    for (let x = -6; x < 6; x++) for (let y = 46; y < 59; y++) {
      const d = Math.hypot(x + 0.5, y + 0.5 - cy);
      const red = o.sand ? SAND_DISC : ST_RED;
      const rim = o.lite ? CG_L : CG;
      if (d <= r) { set(x, y + Y, -2, d > r - 1.1 ? rim : red); set(x, y + Y, -3, d > r - 1.1 ? rim : red); }
    }
    if (!o.sand) B(-1, 1, 46 + Y, 49 + Y, 1, 2, CG);
    else {
      // the uraeus reared on the disc's foot, a voxel proud of it: a coil on
      // the crown, the body rising, the hood flaring three wide with a
      // limestone belly line, the head bent forward over the brow
      B(-2, 2, 47 + Y, 48 + Y, -1, 1, CG_L);                   // the coil
      B(-1, 1, 48 + Y, 51 + Y, -1, 0, CG);                     // the body
      B(-2, 2, 51 + Y, 55 + Y, -1, 0, (x, y) => (x === 0 || x === -1) && y < 54 + Y ? SAND_LIME : CG_L);   // the hood
      B(-1, 1, 55 + Y, 56 + Y, -1, 1, CG_L);                   // the head, forward
      B(-1, 1, 54 + Y, 55 + Y, 0, 1, SAND_INK);                // its eyes
    }
  } else if (o.crown === 'horns') {
    // Isis: a gold modius, cow horns cupping a red sun disc
    const Y = kn;
    S(3, 47 + Y, 49 + Y, -3, 3, CG);
    const H = [[3, 49], [4, 49], [5, 50], [5, 51], [5, 52], [5, 53], [4, 54]];
    const HC = o.lite ? CG_L : CG;
    for (const [x, y] of H) { set(x, y + Y, 0, HC); set(-1 - x, y + Y, 0, HC); set(x, y + Y, -1, HC); set(-1 - x, y + Y, -1, HC); }
    if (o.lite) S(3, 48 + Y, 49 + Y, -3, 3, CG_L);
    for (let x = -4; x < 4; x++) for (let y = 49; y < 57; y++) if (Math.hypot(x + 0.5, y + 0.5 - 53) <= 3.4) set(x, y + Y, -1, ST_RED);
    B(-1, 1, 46 + Y, 48 + Y, 4, 5, CG);
  } else if (o.crown === 'modius') {
    const Y = kn;
    S(4, 47 + Y, 49 + Y, -3, 3, CG);
    S(4, 48 + Y, 49 + Y, -3, 3, (x) => ((x & 1) ? ST_LAPIS : CG));
    B(-1, 1, 46 + Y, 48 + Y, 4, 5, CG);
  }
  if (o.crown === 'hedjet') {
    // the king's tall white crown cast in gold (building_16), rising out of
    // the nemes to a round knob
    // (round sections: a radius tapering from the brow to the knob)
    for (let y = 49; y < 62; y++) {
      const r = y < 59 ? 3.6 - (y - 49) * 0.15 : y === 59 ? 1.2 : 1.9;
      for (let x = -4; x < 4; x++) for (let z = -4; z < 4; z++) if (Math.hypot(x + 0.5, z + 0.5) <= r) set(x, y + kn, z, CG);
    }
  }
  if (head === 'nemes') {
    const Y = kn;
    B(-5, 5, 46 + Y, 47 + Y, -4, 5, CG);                       // the brow band
    B(-5, 5, 47 + Y, 48 + Y, -4, 4, stripe);                   // the cap, domed over the crown
    B(-4, 4, 48 + Y, 49 + Y, -4, 4, CG);
    B(-3, 3, 49 + Y, 50 + Y, -3, 3, stripe);
    B(-5, -4, 38 + Y, 46 + Y, -4, 3, stripe); B(4, 5, 38 + Y, 46 + Y, -4, 3, stripe);   // over the ears
    B(-5, 5, 37 + Y, 46 + Y, -4, -3, stripe);                  // the back
    B(-2, 2, 31 + Y, 37 + Y, -4, -2, stripe);                  // the tail
    for (let y = 36; y < 46; y++) {                            // the wings flaring to the shoulders
      const w = 5 + Math.floor((46 - y) / 3);
      M(5, w, y + Y, y + Y + 1, -3, 1, stripe);
    }
    M(4, 6, 32 + Y, 41 + Y, 4, 5, stripe);                     // the lappets down the chest, thin
    M(4, 6, 41 + Y, 42 + Y, 3, 5, stripe);
    M(4, 6, 32 + Y, 33 + Y, 4, 5, CG_L);
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
  polishStatue(m, touched);
  // o.basalt (round 37, the Monuments): a mid grey-green basalt in place of
  // the near-black granite, so arms, torso and knees read apart; every face
  // turned to the sky one step lighter (a lit bevel on each block's top)
  if (o.basalt) for (const [x, y, z] of touched) {
    const v = m.get(x, y, z);
    if (!v || v.team) continue;
    const g = OS_GOLD.get(v.c);                               // (round 38) the Osiris' yellower kept gilt
    if (g !== undefined) { v.c = g; continue; }
    const c = BASALT_STONE.get(v.c);
    if (c === undefined) continue;
    v.c = !m.has(x, y + 1, z) && c !== BAS_D ? BAS_H : c;
  }
  // the gods (round 18) in a lighter blue-grey slate with a real mid-tone
  // between the near-black recesses and the gold, so their forms read
  // (round 41, o.lite: the Monument to the Gods) a light cool slate with a
  // blue-white highlight, the near-black kept to the line accents; the gilt
  // on the Osiris' yellower ramp (kept through the grade by m.keep)
  if (o.lite) for (const [x, y, z] of touched) {
    const v = m.get(x, y, z);
    if (!v || v.team) continue;
    const c = OS_GOLD.get(v.c) ?? GOD_LITE.get(v.c);
    if (c !== undefined) v.c = c;
  }
  if (o.god && !o.sand && !o.lite) for (const [x, y, z] of touched) {
    const v = m.get(x, y, z), c = v && GOD_SLATE.get(v.c);
    if (c !== undefined) v.c = c;
  }
  // o.sand (round 32, the Temple's god): the lapis inlay as limestone, so the
  // nemes / wig and collar stripe gold on pale stone, and the granite as the
  // Town Center statue's sandstone ramp (tcSandstone); the dark kept to the
  // small line accents (eyes, beak tip, knuckles)
  if (o.sand) for (const [x, y, z] of touched) {
    const v = m.get(x, y, z);
    if (!v || v.team) continue;
    const l = SAND_LAPIS.get(v.c) ?? SAND_STONE.get(v.c);
    if (l !== undefined) v.c = l;
  }
}
// the Monuments' basalt (cleanStatue o.basalt, round 37): the granite ramp
// mapped to a mid grey-green (kept close to grey: warm light turns green olive)
// (round 38: a step darker and blue-grey, not sage: the grey-green came out
// olive under the warm light and read as one dull tone with the gold)
const BAS_D = 0x1a1d24, BAS_H = 0x606a78;
const BASALT_STONE = new Map([
  [0x1b1f26, 0x262b34], [0x2a3039, 0x363d48], [0x30363f, 0x3a414c], [0x262b33, 0x323843],
  [0x4b5563, BAS_H], [0x343d47, 0x48505d], [0x1c2027, BAS_D], [BAS_H, BAS_H],
]);
// the Temple's sandstone god (cleanStatue o.sand): an ochre-gilt falcon
// head (a pale one with dark eyes read as a skull), a dark brown ink for the eyes /
// beak tip, a soft ochre-red disc, a warm umber in place of the lapis inlay
// (the wig and collar stripe gold / umber, framing the pale head), and the
// granite ramp mapped to three clean sandstone steps (no random speckle)
const SAND_HEAD = 0xa86c1c, SAND_HEAD_L = 0xc08428, SAND_BEAK = 0x3c3834, SAND_INK = 0x3a2616, SAND_DISC = 0xb4552e, SAND_LIME = 0xeadcb8;
const SAND_LAPIS = new Map([[0x34558c, 0x7a4a26], [0x263f6a, 0x5e381c], [0x4c6ca6, 0x8e5a30], [0x2454b4, 0x7a4a26]]);
const SAND_STONE = new Map([
  [0x1b1f26, 0xb08a58], [0x2a3039, 0xd2ae78], [0x30363f, 0xd2ae78], [0x262b33, 0xd2ae78],
  [0x4b5563, 0xe4c48e], [0x343d47, 0xe4c48e], [0x1c2027, 0x8a6640],
]);
// (blue-grey: anything with green in it turns olive under the warm light)
const GOD_SLATE = new Map([
  [0x1b1f26, 0x1f2432], [0x2a3039, 0x353d50], [0x30363f, 0x3d465a], [0x262b33, 0x2f3646],
  [0x4b5563, 0x58637a], [0x343d47, 0x4b556c], [0x1c2027, 0x151820],
]);
const GOD_LITE = new Map([
  [0x1b1f26, 0x2e3546], [0x2a3039, 0x4a5570], [0x30363f, 0x505c78], [0x262b33, 0x45506a],
  [0x4b5563, 0x7a8cae], [0x343d47, 0x5e6c8a], [0x1c2027, 0x161a24],
]);
// The statues' material ramp (round 17): every statue voxel takes one of
// two or three value steps of its material from its exposure, so the black
// granite reads as polished stone and the gold as metal: a highlight on
// edges turned to the sky (an open top and an open side) and on vertical
// corners, a darker step in recesses (every open face looking into a
// concave corner: between the arms and the body, under the pectorals, the
// belt and the kilt's hem, between the legs, against the back pillar) and
// on faces turned down, and a faint grain of two granite tones. Line colours
// (GRAN_D, CG_D, kohl, ivory) stay as drawn.
const GRAN_R = 0x1b1f26, GRAN_G = 0x30363f, GRAN_G2 = 0x262b33, GRAN_H = 0x4b5563;
const CG_H = 0xd8a414, LAPIS_R = 0x263f6a, LAPIS_H = 0x4c6ca6;
const STATUE_RAMP = new Map([
  [GRAN, [GRAN_R, GRAN, GRAN_H]], [GRAN_F, [GRAN, GRAN_F, GRAN_H]],
  [CG, [CG_D, CG, CG_L]], [CG_L, [CG, CG_L, CG_H]], [LAPIS_S, [LAPIS_R, LAPIS_S, LAPIS_H]],
]);
const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function polishStatue(m, pts) {
  const seen = new Set(), out = [];
  for (const [x, y, z] of pts) {
    const k = `${x},${y},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const v = m.get(x, y, z);
    if (!v || v.team) continue;
    const ramp = STATUE_RAMP.get(v.c);
    if (!ramp) continue;
    const open = DIRS6.filter(([a, b, c]) => !m.has(x + a, y + b, z + c));
    if (!open.length) continue;
    const ox = open.some((d) => d[0]), oz = open.some((d) => d[2]), up = open.some((d) => d[1] > 0), dn = open.some((d) => d[1] < 0);
    // a face is in a recess when the cell before it has solid on two or more of its four sides
    const concave = open.every(([a, b, c]) => {
      let n = 0;
      for (const [p, q, r] of DIRS6) {
        if ((p && a) || (q && b) || (r && c)) continue;
        if (m.has(x + a + p, y + b + q, z + c + r)) n++;
      }
      return n >= 2;
    });
    let i = 1;
    if (concave) i = 0;
    else if (up && (ox || oz)) i = 2;
    else if (ox && oz && !dn) i = 2;
    else if (dn && !up && !ox && !oz) i = 0;
    else if (up && v.c === CG_L) i = 0;                          // sunlit gold tops a step down, so they stay gold, not cream
    else if (!m.has(x, y, z + 1)) {
      // a front face: shaded across the form like a polished cylinder (the
      // sun from -x): a highlight stripe on the lit third, the far side a step
      // darker as it turns away
      let x0 = x, x1 = x;
      while (m.has(x0 - 1, y, z) && x - x0 < 12) x0--;
      while (m.has(x1 + 1, y, z) && x1 - x < 12) x1++;
      const n = x1 - x0 + 1, t = (x - x0) / Math.max(1, n - 1);
      if (n >= 4) { if (t >= 0.78) i = 0; else if (t > 0.12 && t < 0.42) i = 2; }
    }
    let c = ramp[i];
    if (i === 1 && v.c === GRAN) { const h = hash3(x, y, z, 77); c = h < 0.18 ? GRAN_G : h < 0.3 ? GRAN_G2 : GRAN; }
    out.push([v, c]);
  }
  for (const [v, c] of out) v.c = c;
}
// The Monument to Soldiers' Osiris (round 38, building_14): its own figure,
// not cleanStatue's mummy, built so stone, gold and paint read apart at RTS
// zoom. Dark diorite for the body and face (the granite ramp mapped to
// DIORITE after polishStatue), true gilt for the regalia (m.keep in
// monument()), lapis only inside the gold. Mummiform: the feet block, the
// shroud tapering out to square shoulders; the forearms crossed in an X on
// the chest, the fists by the opposite shoulders holding the gold crook
// (its hook over the figure's left shoulder) and the flail (three beaded
// strands over the right); a lapis-and-gold broad collar in horizontal
// bands narrowing to a U with a bead fringe, over the shoulders' tops too; a gold column down
// the shroud with four distinct signs on the gold (a red sun disc, a dark
// ankh, a lapis djed, lapis water) kept below the crossed arms; a carved
// face (a lighter face plane, dark sockets with gold kohl wings out to the
// temples, a proud nose with a lit tip, a mouth line) with a narrow braided
// gold false beard; striped lappets; the Atef: a ribbed white bulb on a gold
// diadem with the uraeus, gold ram horns, and two tall gold feathers
// banded in lapis, their tips curling out: a stepped, symmetric crown.
// (cx, cz): the body's centre (a voxel corner in x), facing +z, on y0.
const DIORITE = new Map([
  [GRAN_R, 0x14161b], [GRAN, 0x23272f], [GRAN_G, 0x282d35], [GRAN_G2, 0x1f232a],
  [GRAN_H, 0x56606e], [GRAN_F, 0x363c46], [GRAN_D, 0x0e1013],
]);
// the gilt, yellower than CG (kept gold through the grade, CG reads orange)
const OS_GOLD = new Map([[CG_D, 0x7a5a00], [CG, 0xb08800], [CG_L, 0xcca400], [CG_H, 0xe0b810]]);
const OS_GLYPHS = [
  ['.rrrr.', 'rrrrrr', 'rrrrrr', '.rrrr.'],                       // the sun disc
  ['..kk..', '.k..k.', '..kk..', 'kkkkkk', '..kk..'],             // the ankh
  ['bbbbbb', '.bbbb.', 'bbbbbb', '..bb..'],                        // the djed
  ['b.b.b.', '.b.b.b'],                                            // water
];
function osirisStatue(m, cx, y0, cz) {
  const touched = [];
  const set = (x, y, z, c) => {
    if (c == null) return;
    m.set(cx + x, y0 + y, cz + z, c);
    const v = m.get(cx + x, y0 + y, cz + z);
    if (v) { v.clean = 1; touched.push([cx + x, y0 + y, cz + z]); }
  };
  const B = (xa, xb, ya, yb, za, zb, c) => {
    for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) for (let z = za; z < zb; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  };
  const S = (hw, ya, yb, za, zb, c) => B(-hw, hw, ya, yb, za, zb, c);
  const M = (xa, xb, ya, yb, za, zb, c) => { B(xa, xb, ya, yb, za, zb, c); B(-xb, -xa, ya, yb, za, zb, c); };
  const P = (x, y, z, c) => { set(x, y, z, c); set(-1 - x, y, z, c); };
  const stripe = (x, y) => ((y + 60) % 4 === 3 ? LAPIS_S : CG);   // wide gold bands, a lapis line every fourth row

  // ---- the shroud: the feet block, tapering out to the shoulders
  S(5, 0, 2, -4, 5, GRAN);
  for (let y = 2; y < 26; y++) S(y < 11 ? 5 : y < 19 ? 6 : 7, y, y + 1, -3, 4, GRAN);
  S(7, 26, 32, -3, 5, GRAN);                                 // the chest, a voxel proud
  S(9, 32, 35, -3, 5, GRAN);                                 // square shoulders
  S(8, 35, 36, -3, 4, GRAN);
  // ---- the inscribed column: a gold band down the shroud, a lighter
  // border, four signs on the gold
  B(-4, 4, 0, 20, 4, 5, (x, y) => (x === -4 || x === 3 || y === 0 || y === 19 ? CG_L : CG));
  let r = 18;
  for (const g of OS_GLYPHS) {
    g.forEach((row, j) => {
      for (let i = 0; i < 6; i++) {
        const ch = row[i]; if (ch === '.') continue;
        set(-3 + i, r - j, 4, ch === 'r' ? ST_RED : ch === 'b' ? LAPIS_S : GRAN_D);
      }
    });
    r -= g.length + 1;
  }
  // ---- the broad collar: horizontal bands on the chest narrowing to a
  // U (gold, lapis, gold, lapis, gold, a fringe of gold drops), the same
  // bands running back over the shoulders' tops
  const COL = [CG_L, LAPIS_S, CG, LAPIS_S, CG_L];
  for (let y = 30; y < 36; y++) {
    const hw = [5, 6, 7, 8, 9, 9][y - 30];
    for (let x = -hw; x < hw; x++) {
      if (y >= 34 && Math.abs(x + 0.5) < 2.5) continue;      // the neck's opening
      set(x, y, 4, y === 30 ? ((x + 64) & 1 ? CG_L : null) : COL[35 - y]);
    }
  }
  for (let x = -9; x < 9; x++) for (let z = 0; z < 5; z++) {
    if (Math.abs(x + 0.5) < 2.5 && z < 2) continue;
    set(x, 35, z, COL[4 - z]);
  }
  // ---- the arms: upper arms down the sides, the elbows turning forward,
  // the forearms crossed in an X over the chest (two voxels deep, the -x one
  // in front), the fists by the opposite shoulders, gold bracelets
  M(7, 10, 18, 35, -2, 3, GRAN);
  M(7, 10, 30, 31, -2, 3, CG_L);                             // armlets
  M(7, 10, 16, 19, 2, 5, GRAN);                              // the elbows, turning forward
  for (const side of [1, -1]) {
    const zf = side > 0 ? 5 : 6;
    for (let s = 0; s <= 24; s++) {
      const t = s / 24, ax = (8.5 - 12 * t) * side - 0.5, ay = 17.5 + 9.5 * t;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const x = Math.round(ax + i), y = Math.round(ay + j);
        for (let z = zf; z < zf + 2; z++) set(x, y, z, t > 0.8 && t < 0.9 ? CG_L : GRAN);
      }
    }
    const fx = side > 0 ? -6 : 2;                            // the fist
    B(fx, fx + 4, 25, 29, zf, zf + 2, GRAN);
    B(fx, fx + 4, 26, 27, zf + 1, zf + 2, GRAN_D);           // the knuckles' line
  }
  // the crook (heka) through the fist at -x: a lapis-banded gold shaft from
  // under the fist up and out over the figure's left shoulder, the hook
  // curling out and down beside the lappet
  for (let y = 23; y < 38; y++) {
    if (y >= 25 && y < 29) continue;                          // inside the fist
    set(-4 - Math.round(Math.max(0, y - 28) * 0.4), y, 6, y % 3 === 0 ? LAPIS_S : CG);
  }
  for (const [x, y] of [[-8, 38], [-9, 39], [-10, 39], [-11, 38], [-11, 37]]) set(x, y, 6, CG_L);
  // the flail (nekhakha) through the fist at +x: the shaft out over the
  // right shoulder, three beaded strands falling from its tip over it
  for (let y = 24; y < 37; y++) {
    if (y >= 25 && y < 29) continue;
    set(3 + Math.round(Math.max(0, y - 28) * 0.4), y, 7, y % 3 === 0 ? LAPIS_S : CG);
  }
  B(6, 10, 37, 38, 5, 8, CG_L);                              // the strands' cap
  for (let k = 0; k < 3; k++) for (let y = 32 + k; y < 37; y++) set(7 + k, y, 5, (y + k) % 2 ? CG_L : LAPIS_S);
  // ---- the neck and the head: a narrow face in the dark stone
  S(2, 36, 38, -2, 2, GRAN);
  S(5, 38, 48, -3, 4, (x, y, z) => (z === 3 ? GRAN_F : GRAN));   // the face plane a step lighter than the stone
  M(1, 3, 45, 46, 3, 4, GRAN_D);                             // the eyes: dark sockets
  M(3, 5, 45, 46, 3, 4, CG);                                 // the kohl wing, out to the temple
  M(4, 5, 44, 45, 3, 4, CG_D);                               // its tail
  B(-1, 1, 43, 47, 4, 5, GRAN_F);                            // the nose, proud
  B(-1, 1, 42, 43, 4, 5, GRAN_H);                            // its lit tip
  B(-2, 2, 41, 42, 3, 4, GRAN_F);                            // the upper lip
  B(-2, 2, 40, 41, 3, 4, GRAN_D);                            // the mouth
  // the false beard: narrow, braided gold, from the chin to the collar,
  // the tip turned forward
  B(-1, 1, 37, 39, 3, 5, CG);
  for (let y = 33; y < 37; y++) B(-1, 1, y, y + 1, 5, 6, (y & 1) ? CG_L : CG_D);
  B(-1, 1, 33, 34, 6, 7, CG_L);
  // ---- the headcloth: striped lappets framing the face down to the
  // shoulders, the back of the head
  M(5, 7, 36, 48, -3, 3, stripe);
  B(-7, 7, 37, 48, -4, -3, stripe);
  // ---- the Atef crown
  S(6, 48, 49, -4, 4, CG_L);                                 // the diadem
  B(-1, 1, 48, 51, 4, 5, CG);                                // the uraeus, rearing
  B(-1, 1, 50, 51, 5, 6, CG_L);
  for (const [x, y] of [[6, 49], [7, 49], [8, 49]]) for (const z of [-1, 0]) P(x, y, z, CG);   // ram horns, level
  // the white bulb: round sections tapering to a knob, faint reed ribs
  for (let y = 49; y < 66; y++) {
    const rr = y < 55 ? 3.5 : y < 60 ? 3.5 - (y - 54) * 0.35 : y < 63 ? 1.6 : y === 63 ? 1.1 : 1.6;
    for (let x = -5; x < 5; x++) for (let z = -5; z < 5; z++) {
      if (Math.hypot(x + 0.5, z) > rr) continue;
      set(x, y, z, y >= 64 ? CG_L : ((x + 64) % 3 === 0 ? 0xd6ccb4 : ST_WHITE));
    }
  }
  // the feathers: gold plates hugging the bulb's sides, following its taper,
  // banded in lapis, the tips turned out a voxel
  for (let y = 49; y < 64; y++) {
    const rr = y < 55 ? 3.5 : y < 60 ? 3.5 - (y - 54) * 0.35 : 1.6;
    const xa = Math.floor(rr - 0.5) + 1;
    for (let x = xa; x < xa + 2; x++) for (const z of [-1, 0]) P(x, y, z, (y - 49) % 4 === 3 ? LAPIS_S : (x === xa ? CG : CG_L));
  }
  for (const z of [-1, 0]) { P(3, 64, z, CG_L); P(4, 64, z, CG_L); }
  polishStatue(m, touched);
  for (const [x, y, z] of touched) {
    const v = m.get(x, y, z);
    if (!v || v.team) continue;
    const c = DIORITE.get(v.c) ?? OS_GOLD.get(v.c);
    if (c !== undefined) v.c = c;
  }
}
// The Monument to Priests' striding king (round 39, building_15): its own
// figure, not cleanStatue()'s stride, built in clean readable parts so the
// pharaoh reads at thumbnail size. Dark basalt body (the granite ramp mapped
// to BASALT_STONE after polishStatue), true gilt regalia (OS_GOLD, m.keep in
// monument()), lapis only inside the gold. The left foot forward, the arms
// hanging free at the sides with gold armlets and bracelets, the fists
// closed. A pleated shendyt: an A-line kilt of vertical pleat lines (a dark
// gold line every third column) under a gold / lapis / gold belt with a
// buckle, a team-colour apron down the front in a gold frame. A broad wesekh
// collar: a plate a voxel proud on the chest in four concentric bands round
// the neck (gold, lapis, gold, lapis) and a fringe of alternating drops. The
// nemes: one trapezoid flaring from the brow to the shoulders behind the
// face, striped in alternating single rows of gold and lapis, on a plain
// gold brow band with the uraeus rearing at its centre (a gold coil, a lapis
// hood, a gold head); two lappets hanging straight down in front of the
// shoulders as clean striped columns to gold tips; a striped queue behind.
// The face, a lighter plane: a brow ridge a voxel proud over dark eye
// sockets with gold kohl tails, a proud nose with a lit tip, a lip over a dark
// mouth line, a narrow chin; under it the false beard, a separate narrow
// gold block a voxel in front of the face, ribbed, tied to the chin.
// (cx, cz): the body's centre (a voxel corner in x), facing +z, on y0.
// o.crown 'hedjet' (the Monument to Pharaohs' king, building_16): a tall
// gilt white crown rising from the nemes cap to a knob.
function pharaohStatue(m, cx, y0, cz, o = {}) {
  const touched = [];
  const set = (x, y, z, c) => {
    if (c == null) return;
    m.set(cx + x, y0 + y, cz + z, c);
    const v = m.get(cx + x, y0 + y, cz + z);
    if (v) { v.clean = 1; touched.push([cx + x, y0 + y, cz + z]); }
  };
  const B = (xa, xb, ya, yb, za, zb, c) => {
    for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) for (let z = za; z < zb; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  };
  const S = (hw, ya, yb, za, zb, c) => B(-hw, hw, ya, yb, za, zb, c);
  const M = (xa, xb, ya, yb, za, zb, c) => { B(xa, xb, ya, yb, za, zb, c); B(-xb, -xa, ya, yb, za, zb, c); };
  const stripe = (x, y) => ((y + 64) & 1 ? CG_L : LAPIS_S);   // the nemes: one gold row, one lapis row

  // ---- the feet and legs: the left foot (+x) forward
  B(1, 4, 0, 1, 0, 8, GRAN); B(1, 4, 1, 2, 0, 5, GRAN);     // the forward foot, toes lower
  B(-4, -1, 0, 1, -5, 2, GRAN); B(-4, -1, 1, 2, -5, -1, GRAN);
  for (let y = 2; y < 21; y++) {
    const t = (21 - y) / 19, w = y >= 12 ? 1 : 0;            // the thighs a voxel wider
    const zf = Math.round(0.5 + 2 * t - 1.5), zb = Math.round(0.5 - 3 * t - 1.5);
    const c = y === 3 ? CG_L : GRAN;                          // anklets
    B(1, 4 + w, y, y + 1, zf, zf + 3, c);
    B(-4 - w, -1, y, y + 1, zb, zb + 3, c);
  }
  // ---- the shendyt: an A-line kilt, vertical pleats, a framed team apron
  for (let y = 19; y < 29; y++) {
    const hw = y < 24 ? 7 : 6, zf = y < 24 ? 5 : 4;
    B(-hw, hw, y, y + 1, -4, zf, (x, yy, z) => {
      if (yy === 19) return CG;                                // the hem
      const side = x === -hw || x === hw - 1;
      const k = side ? z : x;
      return (k + 64) % 3 === 2 ? CG_D : CG_L;                // a pleat line every third column
    });
    B(-2, 2, y, y + 1, zf, zf + 1, (x) => (x === -2 || x === 1 || y === 19 ? CG_L : TEAMB));
  }
  // the belt: gold, lapis, gold, a buckle proud at the front
  for (let y = 29; y < 32; y++) S(6, y, y + 1, -4, 4, y === 30 ? LAPIS_S : CG_L);
  B(-1, 1, 29, 32, 4, 5, CG_L);
  // ---- the torso: a narrow waist, the chest, square shoulders
  S(5, 32, 37, -3, 3, GRAN);
  S(6, 37, 43, -3, 3, GRAN);
  S(7, 43, 45, -3, 3, GRAN);
  S(9, 45, 48, -3, 3, GRAN);
  // ---- the arms hanging free at the sides, closed fists, gold armlets and bracelets
  M(7, 10, 28, 45, -2, 1, GRAN);
  M(7, 10, 22, 28, -2, 2, GRAN);                              // the fists
  M(7, 10, 23, 24, 1, 2, GRAN_D);                             // the knuckles' line
  M(7, 11, 40, 42, -3, 2, CG_L);                              // armlets, proud
  M(7, 11, 29, 31, -3, 2, CG_L);                              // bracelets
  // ---- the wesekh: concentric bands round the neck on a plate a voxel proud
  const COL = [CG_L, LAPIS_S, CG_L, ST_RED];                  // gold, lapis, gold, carnelian: apart from the nemes
  for (let y = 37; y < 48; y++) for (let x = -9; x < 9; x++) {
    const r = Math.hypot((x + 0.5) * 0.8, 48 - y);
    if (r < 2.6 || r >= 8.6) continue;
    const hw = y < 43 ? 6 : y < 45 ? 7 : 9;
    if (Math.abs(x + 0.5) > hw) continue;
    const b = Math.floor((r - 2.6) / 1.2);
    set(x, y, 3, b < 4 ? COL[b] : ((x + 64) & 1 ? CG_L : null));   // a fringe of drops
  }
  // ---- the neck
  S(2, 48, 50, -2, 2, GRAN);
  B(-2, 2, 38, 47, -6, -4, stripe);                           // the nemes' queue behind
  // ---- the head (round 40): the face, the nemes and its lappets, the
  // uraeus, the false beard and the crown at double density (fineHead)
  fineHead(m, cx, y0, cz, { kind: 'king', crown: o.crown });
  basaltFinish(m, touched);
}
// The heads of the striding king and the queen (round 40, building_15 /
// building_16): drawn at double density (a k = 2 inset on m.fine, so a head
// voxel is 1/32 tile) with final colours, since the statue's polish passes
// run on the parent voxels only. Local coordinates are the statue's own x2
// (x a corner at the body's centre, facing +z); the chin's bottom row is
// y = 98 (the parent's row 49), the face's front plane z = 7.
// The face: a polished basalt ramp, lighter towards the brow and a top-light
// step on every face open to the sky, a dark step under every overhang; a
// brow ridge a voxel proud (lit top, shadow under), almond eyes recessed a
// voxel in black kohl lids with ivory whites and a dark iris and a kohl tail
// to the temple, a narrow nose (two voxels wide, a lit tip), a mouth line
// between lit lips, lit cheekbones. The king: the nemes in three gold rows
// to one lapis, flaring from a gold brow band to the shoulders, a rounded
// striped cap, the uraeus (gold coil, lapis hood in gold, gold head), two
// striped lappets to gold tips, a plaited gold false beard on a tie a voxel
// in front of the collar; o.crown 'hedjet': the white crown in fluted gilt
// with a lapis band at its foot and a knob. The queen: a tripartite gold wig
// in vertical strands of two golds, its two front locks to the collar ending
// in a lapis and gold band, a lapis diadem studded with gold, the uraeus.
const HF = { D: 0x343b47, B: 0x5c6676, M: 0x687384, L: 0x8692a2, H: 0xa2aebc };
const KOHL_B = 0x0e1014, IRIS = 0x1a1612, EYE_W = 0xe4dccb;
const HG = { D: 0x7a5a00, M: 0xb08800, L: 0xcca400, H: 0xe0b810 };
function headSub(m) {
  let f = (m.fine ??= []).find((e) => e.k === 2 && e.head);
  if (!f) { f = { m: new Rec(m.W * 2, m.D * 2), k: 2, head: 1, jitter: 0.006 }; m.fine.push(f); }   // polished: almost no per-voxel tint
  return f.m;
}
function fineHead(m, cx, y0, cz, o = {}) {
  const sub = headSub(m), queen = o.kind === 'queen';
  const OX = cx * 2, OY = y0 * 2 + (o.dy ?? 0), OZ = cz * 2;
  const set = (x, y, z, c) => { if (c != null) sub.set(OX + x, OY + y, OZ + z, c); };
  const B = (xa, xb, ya, yb, za, zb, c) => {
    for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) for (let z = za; z < zb; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  };
  const M = (xa, xb, ya, yb, za, zb, c) => { B(xa, xb, ya, yb, za, zb, c); B(-xb, -xa, ya, yb, za, zb, typeof c === 'function' ? (x, y, z) => c(-1 - x, y, z) : c); };
  const ax = (x) => Math.abs(x + 0.5);
  // ---- the headdress behind the face
  if (!queen) {
    const band = (y) => ((y - 96) & 3) === 3 ? LAPIS_S : HG.L;            // three gold rows, one lapis
    for (let y = 92; y < 118; y++) {
      const hw = Math.round(10 + Math.max(0, 118 - y) * 5 / 24);
      B(-hw, hw, y, y + 1, -10, 5, (x) => (ax(x) > hw - 1 ? (band(y) === LAPIS_S ? LAPIS_R : HG.M) : band(y)));
    }
    for (let y = 118; y < 128; y++) {                                 // the cap, rounded over the crown
      const i = y - 118, hw = [10, 10, 10, 10, 9, 9, 8, 8, 6, 4][i], zf = 8 - (i >> 1), zb = -10 + (i >> 1);
      B(-hw, hw, y, y + 1, zb, i < 2 ? 8 : zf, i < 2 ? (i === 0 ? HG.M : HG.L) : band(y));   // the brow band, then stripes
    }
    // the lappets: straight striped columns in front of the shoulders to gold tips
    M(8, 13, 80, 116, 1, 7, (x, y, z) => (y < 84 ? (y === 80 ? HG.M : HG.H) : x === 12 || z === 1 ? (band(y) === LAPIS_S ? LAPIS_R : HG.M) : band(y)));
    // the false beard: a plaited gold block on a tie a voxel in front of the collar
    B(-2, 2, 95, 98, 5, 9, HG.M);
    for (let y = 84; y < 96; y++) B(-2, 2, y, y + 1, 8, 10, (x, yy, z) => (y === 84 ? HG.D : (y >> 1) & 1 ? HG.L : HG.M));
    B(-2, 2, 84, 85, 8, 10, HG.M);
    // the uraeus: a gold coil up the band, a lapis hood edged in gold, a gold head
    B(-1, 1, 116, 121, 8, 10, HG.H);
    B(-3, 3, 121, 125, 8, 10, (x, y) => (x === -3 || x === 2 || y === 124 ? HG.H : LAPIS_S));
    B(-1, 1, 125, 128, 8, 11, HG.H);
    if (o.crown === 'hedjet') {
      // the white crown in fluted gilt: a tall bulb tapering to a knob, a lapis band at its foot
      for (let y = 124; y < 156; y++) {
        const rr = y < 132 ? 7.6 : y < 146 ? 7.6 - (y - 132) * 0.2 : y < 151 ? 4.8 * Math.sqrt(Math.max(0, 1 - ((y - 146) / 6) ** 2)) + 0.6 : 2.6 - Math.abs(y - 153) * 0.5;
        for (let x = -9; x < 9; x++) for (let z = -11; z < 8; z++) {
          if (Math.hypot(x + 0.5, (z + 1.5) * 0.92) > rr) continue;
          const a = Math.atan2(z + 1.5, x + 0.5);
          set(x, y, z, y < 128 ? (y === 127 ? HG.L : LAPIS_S) : y >= 149 ? HG.H : (Math.floor((a + Math.PI) / (Math.PI / 9)) & 1 ? HG.L : HG.M));
        }
      }
    }
  } else {
    // the tripartite wig: strands of two golds behind the face, rounded over the crown
    const strand = (x) => ((x + 64) & 1 ? HG.L : HG.M);
    for (let y = 88; y < 128; y++) {
      const hw = y >= 127 ? 4 : y >= 126 ? 6 : y >= 125 ? 7 : y >= 123 ? 8 : y >= 104 ? 9 : 9 + Math.round((104 - y) / 8);   // a dome over the crown, flaring to the shoulders
      const zf = y < 118 ? 3 : y < 120 ? 8 : 7 - ((y - 120) >> 1), zb = y >= 121 ? -9 + ((y - 120) >> 1) : -9;
      B(-hw, hw, y, y + 1, zb, zf, (x) => (y >= 118 && y < 120 ? (y === 118 ? HG.L : (x + 64) % 3 === 1 ? HG.H : LAPIS_S) : strand(x)));
    }
    // the two front locks, to the collar, ending in a lapis and gold band
    M(7, 11, 76, 118, 0, 5, (x, y) => (y < 78 ? HG.H : y < 80 ? LAPIS_S : y < 81 ? HG.H : strand(x)));
    // the uraeus at the brow
    B(-1, 1, 118, 122, 9, 10, HG.H);
    B(-2, 2, 122, 125, 9, 10, (x, y) => (x === -2 || x === 1 || y === 124 ? HG.H : LAPIS_S));
    B(-1, 1, 125, 127, 9, 11, HG.H);
  }
  // the neck in the face's stone (the parent's dark neck read as a hole under the chin)
  B(-4, 4, 86, 100, -4, 4, HF.B);
  // ---- the face: a front map (z, colour) per (x, y), filled back to z = -6
  const hwOf = queen ? (y) => (y < 100 ? 0 : y < 101 ? 4 : y < 103 ? 5 : y < 105 ? 6 : 7)
    : (y) => (y < 100 ? 4 : y < 102 ? 5 : y < 104 ? 6 : y < 108 ? 7 : 8);
  const TOP = 118, F = new Map(), k = (x, y) => `${x},${y}`;
  for (let y = 98; y < TOP; y++) {
    const hw = hwOf(y);
    for (let x = -hw; x < hw; x++) F.set(k(x, y), { z: 7 - (ax(x) >= hw - 1.5 ? 1 : 0) - (ax(x) >= hw - 0.5 ? 1 : 0), c: 'skin' });
  }
  const at = (xr, y, z, c) => {                                  // mirrored about the centre
    for (const x of [xr, -1 - xr]) { const e = F.get(k(x, y)); if (e) { if (z != null) e.z = z; if (c) e.c = c; } }
  };
  const ey = 110, e0 = queen ? 1 : 2;
  // the brow ridge, proud
  if (!queen) for (let xr = 0; xr < e0 + 5; xr++) at(xr, ey + 3, 8);
  else for (let xr = e0 + 1; xr < e0 + 5; xr++) at(xr, ey + 3 - (xr === e0 + 4 ? 1 : 0), null, 'lid');   // her brows painted, arched down to the temple
  // the eyes, almond: a black kohl upper lid running out to a tail at the
  // temple, one row of ivory white with the dark iris rising into the lid, a
  // shaded lower lid; a lid fold of plain stone up to the brow
  for (let i = 0; i < 6; i++) at(e0 + i, ey + 1, null, KOHL_B);
  ['W', 'W', 'I', 'W', 'K', 'K'].forEach((t, i) => at(e0 + i, ey, null, t === 'K' ? KOHL_B : t === 'I' ? IRIS : EYE_W));
  for (let i = 1; i < 4; i++) at(e0 + i, ey - 1, null, 'lid');
  // the nose, narrow: a bridge between the eyes, a lit tip, the wings
  for (let y = queen ? ey - 4 : ey - 5; y <= ey + 2; y++) at(0, y, 8);
  if (!queen) { at(0, ey - 6, 9); at(0, ey - 5, 9); at(1, ey - 6, 8, 'shade'); } else at(1, ey - 4, null, 'lid');
  // the mouth: a dark line between lit lips; lit cheekbones
  const mw = queen ? 2 : 3;
  for (let xr = 0; xr < mw; xr++) { at(xr, ey - 8, queen ? null : 6, queen ? 0x3a2a2e : HF.D); at(xr, ey - 7, null, 'lit'); }   // her mouth a fine line, lips not cut
  for (let xr = 0; xr < mw - 1; xr++) at(xr, ey - 9, null, 'lit');
  const skin = [];
  for (const [key, e] of F) {
    const [x, y] = key.split(',').map(Number);
    for (let z = -6; z <= e.z; z++) {
      const c = z === e.z ? e.c : 'skin';
      if (typeof c === 'number') set(x, y, z, c);
      else { set(x, y, z, HF.B); skin.push([OX + x, OY + y, OZ + z, c]); }
    }
  }
  // the polished ramp: lighter towards the brow, a top light, shade under overhangs
  for (const [X, Y, Z, tag] of skin) {
    const v = sub.get(X, Y, Z);
    if (!v) continue;
    const up = !sub.has(X, Y + 1, Z), dn = !sub.has(X, Y - 1, Z), fr = !sub.has(X, Y, Z + 1);
    const sd = !sub.has(X + 1, Y, Z) || !sub.has(X - 1, Y, Z);
    let c = sd && !fr ? HF.B : HF.M;                               // the front planes one value, the turned sides a step down
    if (tag === 'lit') c = HF.L;
    if (tag === 'shade') c = HF.D;
    if (tag === 'lid') c = HF.B;
    if (up && fr) c = Z - OZ >= 9 ? HF.H : HF.L;                   // a top light; the nose tip the brightest
    else if (dn && fr && !up && tag !== 'lit') c = Z - OZ >= 8 ? HF.D : sub.has(X, Y + 1, Z + 1) ? HF.B : c;   // under the nose dark, under the brow a step
    v.c = c;
  }
}
// The queen of the Monument to Pharaohs (round 40, building_16): a slim
// basalt figure in a gold sheath dress pleated in vertical stripes of two
// golds (a darker hem), a lapis and gold belt band with a knot and two lapis
// sash ends, a gold bodice over the bust, a wesekh of lapis and gold, bare
// basalt shoulders and arms with gold armlets and bracelets; the far arm at
// her side, the near arm bent so her hand rests on the king's upper arm;
// the head by fineHead() (the queen's wig, face and uraeus).
function queenStatue(m, cx, y0, cz) {
  const touched = [];
  const set = (x, y, z, c) => {
    if (c == null) return;
    m.set(cx + x, y0 + y, cz + z, c);
    const v = m.get(cx + x, y0 + y, cz + z);
    if (v) { v.clean = 1; touched.push([cx + x, y0 + y, cz + z]); }
  };
  const B = (xa, xb, ya, yb, za, zb, c) => {
    for (let x = xa; x < xb; x++) for (let y = ya; y < yb; y++) for (let z = za; z < zb; z++) set(x, y, z, typeof c === 'function' ? c(x, y, z) : c);
  };
  const S = (hw, ya, yb, za, zb, c) => B(-hw, hw, ya, yb, za, zb, c);
  // ---- the feet and shins, the left foot (+x) a little forward
  B(-3, -1, 0, 1, -2, 4, GRAN); B(1, 3, 0, 1, -1, 5, GRAN);
  for (let y = 1; y < 11; y++) { B(-3, -1, y, y + 1, -2, 1, y === 3 ? CG_L : GRAN); B(1, 3, y, y + 1, -1, 2, y === 3 ? CG_L : GRAN); }
  // ---- the sheath dress: vertical pleats in two golds, a darker hem
  const pleat = (hw, zb, zf) => (x, y, z) => {
    if (y === 10) return CG;
    const side = x === -hw || x === hw - 1;
    return ((side ? z : x) + 64) % 3 === 2 ? CG_D : CG_L;          // a dark pleat line every third column (CG_D: the polish keeps it)
  };
  for (let y = 10; y < 29; y++) {
    const hw = y < 17 ? 4 : 5, zf = y < 17 ? 3 : 4;
    B(-hw, hw, y, y + 1, -3, zf, pleat(hw, -3, zf));
  }
  // the sash ends hanging from the knot
  B(-1, 1, 20, 29, 4, 5, (x, y) => (y < 21 ? CG_L : LAPIS_S));
  // ---- the belt: gold, lapis studded with gold, gold; a knot proud at the front
  for (let y = 29; y < 32; y++) S(5, y, y + 1, -4, 5, (x) => (y === 30 ? ((x + 64) % 3 === 1 ? CG_L : LAPIS_S) : CG_L));
  B(-1, 1, 29, 32, 5, 6, CG_L);
  // ---- the bodice over the bust, then bare shoulders
  for (let y = 32; y < 37; y++) S(5, y, y + 1, -3, 4, pleat(5, -3, 4));
  S(5, 37, 42, -3, 3, GRAN);
  S(6, 42, 44, -3, 3, GRAN);
  // ---- the wesekh: lapis and gold bands round the neck, a fringe of drops
  const COL = [LAPIS_S, CG_L, LAPIS_S, CG_L];
  for (let y = 36; y < 44; y++) for (let x = -6; x < 6; x++) {
    const r = Math.hypot((x + 0.5) * 0.85, 44 - y);
    if (r < 2.2 || r >= 7.0) continue;
    if (Math.abs(x + 0.5) > (y < 42 ? 5 : 6)) continue;
    const b = Math.floor((r - 2.2) / 1.1);
    set(x, y, 3, b < 4 ? COL[b] : ((x + 64) & 1 ? CG_L : null));
  }
  // ---- the neck
  S(2, 44, 47, -2, 2, GRAN);
  // ---- the arms: the far one at her side, the near one bent to the king's arm
  B(5, 7, 23, 42, -2, 1, GRAN); B(5, 7, 21, 23, -2, 1, GRAN);
  B(5, 7, 26, 27, -3, 2, CG_L); B(5, 7, 38, 39, -3, 2, CG_L);
  B(-7, -5, 34, 42, -2, 1, GRAN); B(-7, -5, 38, 39, -3, 2, CG_L);
  B(-10, -7, 33, 35, -2, 1, GRAN); B(-8, -7, 33, 35, -3, 2, CG_L);
  B(-12, -9, 32, 36, 1, 2, GRAN);                                   // the hand on his arm
  // ---- the head, at double density
  fineHead(m, cx, y0, cz, { kind: 'queen', dy: -6 });
  basaltFinish(m, touched);
}
// The statues' plain stone (round 39): one mid basalt, a lit step on faces
// open to the sky (polishStatue's grain and its per-row cylinder shading read
// as checker noise on the bare torso and legs); the gold and the face plane
// polished, then mapped to BASALT_STONE / OS_GOLD.
function basaltFinish(m, touched) {
  const plain = touched.filter(([x, y, z]) => m.get(x, y, z)?.c === GRAN);
  polishStatue(m, touched);
  for (const [x, y, z] of plain) {
    const v = m.get(x, y, z);
    if (!v) continue;
    const ox = !m.has(x + 1, y, z) || !m.has(x - 1, y, z), oz = !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    v.c = !m.has(x, y + 1, z) ? 0x5c6674 : ox && oz ? 0x4e5765 : 0x404855;   // lit tops, lit vertical arrises, a mid basalt
  }
  for (const [x, y, z] of touched) {
    const v = m.get(x, y, z);
    if (!v || v.team) continue;
    const c = BASALT_STONE.get(v.c) ?? OS_GOLD.get(v.c);
    if (c !== undefined) v.c = c;
  }
}
function monument(kind, god = 'ra') {
  if (kind <= 3) {
    const m = lot(32, 32, EARTH);
    const py = monPlinth(m, 6, 6, 26, 26, 1, 14, { seed: kind });
    const pd = monDie(m, 9, 9, 23, 23, py, 2);
    const o = [
      null,
      { pose: 'kneel', arms: 'pots', head: 'nemes', kiltFront: null, basalt: 1 },
      { pose: 'mummy', arms: 'crossed', head: 'double', basalt: 1 },
      { pose: 'stride', arms: 'side', head: 'nemes', kilt: CG, anklets: 1, pillar: [-6, 6, 38], basalt: 1 },
    ][kind];
    if (kind === 2) {
      // round 38: the Osiris in its own diorite / gilt / lapis build; its
      // gold keeps its colour through the grade (geo() m.keep)
      osirisStatue(m, 16, pd, 15);
      m.keep = [[3, pd, 6, 29, pd + 68, 27]];
      return m;
    }
    if (kind === 3) {
      // round 39: the striding king in its own clean build (nemes, wesekh,
      // pleated shendyt, a carved face and a separate false beard)
      pharaohStatue(m, 16, pd, 15);
      m.keep = [[3, pd, 3, 29, pd + 68, 29]];
      return m;
    }
    cleanStatue(m, 16, pd, kind === 1 ? 17 : 15, o);
    m.keep = [[3, pd, 3, 29, pd + 68, 29]];                   // the regalia keep their gold (round 38)
    return m;
  }
  if (kind === 4) {
    const m = lot(48, 48, EARTH);
    const py = monPlinth(m, 5, 6, 43, 42, 1, 14, { faces: { '+z': 'cart2', '-z': 'cart2' }, seed: 4 });
    const pd = monDie(m, 9, 11, 39, 37, py, 3);
    // building_16: the king striding, fists at his sides, in the nemes and a
    // gold white crown; the queen in a gold sheath dress and vulture wig, her
    // near hand on his arm; one back pillar joining them
    // round 39: the king in pharaohStatue()'s clean build (nemes, wesekh,
    // pleated shendyt), with the gilt white crown
    pharaohStatue(m, 15, pd, 24, { crown: 'hedjet' });
    queenStatue(m, 34, pd, 24);                               // round 40: her own build, the heads at double density
    m.keep = [[2, pd, 4, 46, pd + 82, 44]];
    return m;
  }
  const m = lot(64, 64, EARTH);
  const py = monPlinth(m, 12, 12, 52, 52, 1, 18, { faces: { '+z': 'eye', '-z': 'eye', '+x': 'eye', '-x': 'eye' }, seed: 5 });
  const pd = monDie(m, 20, 20, 44, 44, py, 7, { lite: true });   // pd = 28: the coarse statue lands on it exactly
  const G = {
    ra: { head: 'falcon', crown: 'disc', arms: 'staff', pose: 'stride' },
    set: { head: 'jackal', crown: 'set', arms: 'staff', pose: 'stand' },
    isis: { head: 'human', crown: 'horns', arms: 'wings', pose: 'dress' },
  }[god];
  // the god drawn on a coarser grid (voxels 4/3 the plinth's), so it stands
  // over the big plinth at Retold's scale with the same clean canon
  const k = 0.75, sub = new Rec(m.W, m.D);
  cleanStatue(sub, 24, Math.round(pd * k), 23, { ...toClean({ kilt: GILT, ...G }), lite: 1 });
  m.keep = [[0, 0, 0, 64, 120, 64]];             // round 41: the statue's and the plinth's gilt stay gold
  (m.fine ??= []).push({ m: sub, k });
  // the sun bowls at the corners (round 18: no flat discs): a short gold
  // foot, a bowl flaring out, a thick rolled rim beaded light / dark gold,
  // a bed of embers sunk a voxel inside it (orange flecks in dark red coals)
  // and a flame rising from the middle, tapering. Deep oranges with a low
  // glow: the emission adds the colour again, and bright yellows wash to
  // pink / cream under the grade
  const EMB = 0x4a1606, FL = [0x982004, 0xb83008, 0xd85410];   // saturated reds to orange (orange-yellows take the shader's gilt shading)
  const fire = new Map([[FL[0], 0.1], [FL[1], 0.1], [FL[2], 0.12]]);
  for (const [x, z] of [[5, 5], [58, 5], [5, 58], [58, 58]]) {
    const cx = x + 0.5, cz = z + 0.5;
    lathe(m, cx, cz, 1, 2, () => 1.8, SG_D);
    lathe(m, cx, cz, 2, 3, () => 2.6, SG);
    lathe(m, cx, cz, 3, 5, (y) => (y === 3 ? 3.5 : 4.2), SG, { hollow: 1.2, inner: EMB });
    lathe(m, cx, cz, 5, 6, () => 4.8, (X, Y, Z) => (((X + Z) & 1) ? SG_L : SG_D), { hollow: 1.1 });
    lathe(m, cx, cz, 4, 5, () => 3.3, (X, Y, Z) => (hash3(X, Y, Z, 91) < 0.4 ? FL[1] : hash3(X, Y, Z, 92) < 0.4 ? FL[0] : EMB));
    lathe(m, cx, cz, 5, 7, () => 1.7, (X, Y, Z) => (Math.abs(X + 0.5 - cx) + Math.abs(Z + 0.5 - cz) < 1.2 ? FL[2] : FL[1]));
    lathe(m, cx, cz, 7, 10, () => 1.0, FL[2]);
    m.set(x, 10, z, FL[2]); m.set(x - 1, 8, z, FL[1]); m.set(x + 1, 9, z, FL[1]); m.set(x + 1, 6, z - 1, FL[0]); m.set(x - 1, 6, z + 1, FL[0]);
  }
  for (const v of m.coords) { const p = m.get(...v); if (p && fire.has(p.c)) p.glow = fire.get(p.c); }
  return m;
}

// Armory (4 x 4; building_18), round 42: the smithy rebuilt at half voxels
// (`fine: 2` in TYPES, 1/16 tile) so its courses, trim and tools keep crisp
// edges, and laid out by VALUE, one material per mass, so it never reads as
// one sand pile: the hall in pale limestone under the team band and the
// painted frieze the neighbours carry (no winged sun: it read as a red
// zigzag); the forge shed (a back wall and a pier) a step darker in ochre
// sandstone with a lapis band; the lean-to cloth cool indigo / pale blue
// stripes running wall to front; the furnace and its tall tapering chimney
// in near-black soot-stained mud brick, darkening up the stack, a fire mouth
// of glowing coals at its foot, a glowing throat at its top and smoke puffs
// drifting off it (a k = 1 inset on m.fine, so construction stages carry
// none); and before the shed, on a cool grey flagged yard, ONE work area: an
// open hearth (a dark kerb round a bed of coals glowing hotter to the
// middle, flame tongues, bellows), a black steel anvil on a stump with a
// hot billet and a hammer, and a pale limestone quench trough of water. The
// fire voxels keep their saturation through the grade (m.keep).
const SOOT = (x, y, z) => {
  const row = Math.floor(Math.max(0, y - 1) / 3);
  const u = x + z + (row & 1) * 3 + 512;
  let c = pick(hash3(Math.floor(u / 6), row, 3, 311), [0x5a4334, 0x523d30, 0x614939]);
  if ((y - 1) % 3 === 0) c = shade(c, 0.72);
  else if (u % 6 === 0) c = shade(c, 0.76);
  return shade(c, Math.max(0.48, 1 - Math.max(0, y - 10) * 0.011));   // the soot thickens up the stack
};
const KERB = (x, y, z) => (y === 3 ? 0x6b5d50 : ((x + z) & 3) === 0 ? 0x3a3029 : 0x463a31);
const ANV = 0x24272b, ANV_T = 0x6c747c, STUMP = 0x4a2e1a;
const COAL = [0x8a2004, 0xb83006, 0xe05008];          // ember red to hot orange (keep: no grade chroma limit)
const AWN_I = [0x2b4176, 0x283d70, 0x2f467e], AWN_P = [0xc3cedb, 0xbec9d6, 0xc9d4e0];
const SMOKE = [0x77706a, 0x8c8781, 0xa29e99, 0xb5b2ad, 0xc4c2be];
const ANKH_G = 0xd9a406;                              // a gold the keep flag recognises (low blue)
function armory() {
  const m = lot(64, 64, EARTH);
  m.stageStep = 12;
  // the flagged work yard before the shed (cool grey, so the tools stand off the ground)
  patch(m, 27, 36, 64, 64, FLAG, { seed: 4, rag: 3 });
  // the hall: pale limestone, battered, the team band and a painted frieze under a blue cavetto
  block(m, 3, 5, 41, 31, 1, 28, { wall: LIME, batter: 10, band: 'team', frieze: 2, lipOut: 2, flare: true, rimC: LIME, roofC: PLASTER });
  let T = m.lastTop;
  roofField(m, T.c0, T.d0, T.c1, T.d1, T.y);
  // the stepped roof: a limestone attic on the hall's west half, its own lapis band
  block(m, 8, 9, 25, 23, T.y, 10, { wall: LIME, batter: 0, band: 'lapis', frieze: 1, lipOut: 1, rimC: LIME, roofC: PLASTER, plinth: false });
  T = m.lastTop;
  roofField(m, T.c0, T.d0, T.c1, T.d1, T.y, { g: 3 });
  door(m, '+z', 25, 6, 1, 14, { frame: LIME });
  slit(m, '+z', 35, 13, 6, 1);
  // the forge shed: a back wall and a pier in ochre sandstone, a step darker than the hall
  const shed = { wall: OCHRE_W, batter: 8, band: 'lapis', frieze: 0, lipOut: 1, rimC: LIME, roofC: MUDROOF };
  block(m, 40, 5, 61, 13, 1, 18, shed);
  block(m, 53, 11, 61, 37, 1, 18, shed);
  // the lean-to: rafters from a ledger on the hall's east wall down onto the
  // pier's coping, the striped cloth laid over them
  const yTop = 26, depth = 17, drop = 6, f = 38;
  const ry = (d) => Math.floor(yTop + 1 - (drop * d) / depth - 0.5 * Math.sin((Math.PI * d) / depth)) - 1;
  for (const z of [14, 20, 26, 32]) for (let d = 1; d <= depth; d++) m.set(f + d, ry(d), z, DARKWOOD);
  clothAwning(m, '+x', f, 12, 37, yTop, depth, drop, { posts: [], sw: 3, sag: 0, belly: 0.5, stripes: [AWN_I, AWN_P], hem: 0x1e2c52 });
  rack(m, 43, 14, 9);
  // the furnace before the hall's west end and its chimney: soot-black mud
  // brick, a pale coping on the furnace, the stack tapering in three stages
  for (let x = 5; x < 21; x++) for (let z = 33; z < 47; z++) for (let y = 1; y < 13; y++) m.set(x, y, z, y === 12 ? LIME_S : SOOT);
  const cTop = 52;
  for (let y = 13; y < cTop; y++) {
    const i = Math.floor((y - 13) / 15);
    for (let x = 8 + i; x < 18 - i; x++) for (let z = 34 + i; z < 44 - i; z++) m.set(x, y, z, SOOT);
  }
  // the stack's mouth: a dark lip, a glowing throat a voxel down
  for (let x = 9; x < 17; x++) for (let z = 35; z < 43; z++) {
    const rim = x === 9 || x === 16 || z === 35 || z === 42;
    if (rim) m.set(x, cTop, z, 0x221a15);
    else { m.remove(x, cTop - 1, z); m.set(x, cTop - 2, z, x > 10 && x < 15 && z > 36 && z < 41 ? COAL[2] : COAL[1], { glow: 0.9 }); }
  }
  for (const [x, z] of [[12, 38], [13, 39], [12, 39]]) m.set(x, cTop - 1, z, COAL[2], { glow: 0.95 });
  // the fire mouth in the furnace's front: cut three deep under a limestone lintel, coals glowing
  for (let x = 10; x < 16; x++) for (let y = 1; y < 7; y++) {
    for (let d = 0; d < 3; d++) m.remove(x, y, 46 - d);
    m.set(x, y, 43, y <= 2 ? COAL[2] : y <= 4 ? COAL[1] : COAL[0], { glow: y <= 2 ? 0.95 : 0.7 });
    if (y === 1) for (let d = 0; d < 3; d++) m.set(x, 1, 46 - d, d === 0 ? COAL[1] : COAL[2], { glow: 0.85 });
  }
  for (let x = 9; x < 17; x++) { m.set(x, 7, 46, LIME); m.set(x, 7, 47, LIME); }
  // a bold gilt ankh on a limestone step by the furnace
  m.box(0, 1, 49, 9, 2, 5, LIME);
  const A = (x, y, z) => m.box(x, y, z, 2, 2, 2, ANKH_G);
  for (let y = 3; y < 11; y += 2) A(3, y, 50);
  for (let x = 0; x < 9; x += 2) if (x < 8) A(x + 0.5 | 0, 11, 50);
  for (const [x, y] of [[1, 13], [5, 13], [1, 15], [5, 15], [3, 17]]) A(x, y, 50);
  // the work area: ONE group before the shed. The open hearth: a dark kerb
  // round a bed of coals glowing hotter to the middle, flame tongues over it
  const hx = 40.5, hz = 46;
  for (let x = 35; x < 46; x++) for (let z = 41; z < 51; z++) {
    const kerb = x === 35 || x === 45 || z === 41 || z === 50;
    for (let y = 1; y < 4; y++) {
      if (kerb) pset(m, x, y, z, KERB(x, y, z));
      else if (y < 3) pset(m, x, y, z, 0x2a1e18);
      else {
        const d = Math.max(Math.abs(x + 0.5 - hx) / 4.5, Math.abs(z + 0.5 - hz) / 4);
        m.set(x, y, z, d < 0.45 ? COAL[2] : d < 0.8 ? COAL[1] : COAL[0], { glow: d < 0.45 ? 0.95 : d < 0.8 ? 0.8 : 0.55 });
      }
    }
  }
  for (const [x, y, z] of [[40, 4, 46], [41, 4, 45], [39, 4, 45], [40, 4, 44], [42, 4, 47], [40, 5, 45], [41, 5, 46], [40, 6, 45], [39, 4, 47]]) m.set(x, y, z, COAL[2], { glow: 1 });
  // the bellows on its west side: leather between two boards, a nozzle into the kerb
  for (let x = 29; x < 34; x++) for (let z = 43; z < 49; z++) {
    pset(m, x, 1, z, 0x4a3020);
    if (x > 29 && z > 43 && z < 48) pset(m, x, 2, z, 0x7a4c2c);
    pset(m, x, 3, z, x === 29 ? 0x4a3020 : 0x5c3a22);
  }
  for (let x = 33; x < 35; x++) pset(m, x, 2, 45, IRON);
  // the anvil: a black steel body on a dark stump, a bright worn face, a
  // horn, a glowing billet on it and a hammer laid by
  m.box(50, 1, 43, 5, 4, 5, STUMP);
  for (let x = 50; x < 55; x++) for (let z = 43; z < 48; z++) if (x === 50 || x === 54 || z === 43 || z === 47) pset(m, x, 4, z, 0x5e3c22);
  for (let x = 50; x < 55; x++) for (let z = 44; z < 47; z++) pset(m, x, 5, z, ANV);
  for (let x = 51; x < 54; x++) for (let z = 44; z < 47; z++) for (const y of [6, 7]) pset(m, x, y, z, ANV);
  for (let x = 48; x < 56; x++) for (let z = 44; z < 47; z++) { pset(m, x, 8, z, ANV); pset(m, x, 9, z, ANV_T); }
  for (const z of [44, 45, 46]) pset(m, 56, 9, z, z === 45 ? ANV_T : ANV);
  pset(m, 57, 9, 45, ANV); pset(m, 58, 9, 45, ANV); pset(m, 56, 8, 45, ANV);
  m.set(50, 10, 45, COAL[2], { glow: 0.9 }); m.set(51, 10, 45, COAL[2], { glow: 0.9 }); m.set(52, 10, 45, COAL[1], { glow: 0.7 });
  for (let x = 51; x < 56; x++) pset(m, x, 10, 47, 0x6a4428);
  for (const y of [10, 11]) for (const z of [46, 47]) pset(m, 55, y, z, ANV);
  // the quench trough: a pale limestone box brimming with water
  for (let x = 44; x < 59; x++) for (let z = 53; z < 60; z++) for (let y = 1; y < 5; y++) {
    const rim = x === 44 || x === 58 || z === 53 || z === 59;
    if (rim) pset(m, x, y, z, y === 4 ? 0xf3ead8 : 0xe2d6bd);
    else if (y < 3) pset(m, x, y, z, 0xc9bca2);
    else if (y === 3) pset(m, x, y, z, 0x2c6890);
  }
  // a few stores at the lot's edges, clear of the work area
  crate(m, 1, 1, 56, 5, 5, 5); crate(m, 2, 6, 57, 3, 3, 3);
  crate(m, 22, 1, 56, 4, 4, 4, 0x8a6236);
  // the fires keep their colour through the grade, the ankh its gold
  m.keep = [[28, 0, 40, 60, 14, 52], [4, 0, 30, 22, 60, 50], [0, 0, 48, 10, 20, 56]];
  // smoke off the stack: puffs growing and paling as they drift east (an
  // inset, so stages carry none)
  const sub = new Rec(m.W, m.D);
  const puffs = [[13, cTop + 4, 39, 2.6], [14.5, cTop + 9, 38.5, 3.2], [17, cTop + 15, 38, 3.8], [20.5, cTop + 22, 37.5, 4.3], [25, cTop + 29, 37, 4.0]];
  puffs.forEach(([cx, cy, cz, R], i) => {
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
      const dy = y + 0.5 - cy;
      if (Math.abs(dy) > R) continue;
      const r = Math.sqrt(R * R - dy * dy);
      lathe(sub, cx, cz, y, y + 1, () => r, dy > R * 0.35 ? shade(SMOKE[i], 1.08) : dy < -R * 0.35 ? (i === 0 ? 0x8a5c40 : shade(SMOKE[i], 0.9)) : SMOKE[i]);
    }
  });
  (m.fine ??= []).push({ m: sub, k: 1, jitter: 0.01 });
  return m;
}

// Market (4 x 4; building_19), round 43: ONE building at half voxels
// (`fine: 2` in TYPES, 1/16 tile). A solid, slightly battered mud-brick hall
// (MKT_MUD, big brick courses) under a cavetto cornice that flares three
// voxels out in steps over a lapis band and a painted frieze; on the front
// axis a taller limestone entrance block with the owner's band, its porch cut
// into it: two lotus columns (plain pale shafts, paint only at the base and
// the neck, a capital flaring to a five-wide lotus in green and lapis petals)
// before the single doorway. Along the east side ONE row of three stalls under
// one shared cloth (blue / white stripes, the reference's), posts at the
// stall ends, a counter of produce under each, crates and pots between them.
const MKT_MUD = masonry([0xc28a52, 0xb8804a, 0xca935a], [0xad7843, 0xb7824c, 0xa4723f], { len: 10, course: 3, bed: 0.84, head: 0.9, grime: 3, seed: 43 });
const MKT_AW = [0x2f5aa8, 0x2c56a2, 0x3460ae], MKT_AWW = [0xe9e6dc, 0xe2dfd4, 0xeeebe2];
const MKT_COL = 0xeee3c9, MKT_COL_S = 0xd6c8a6, MKT_PET = 0x4f8a5a, MKT_PET_L = 0x67a46e;
function lotusColumn(m, cx, cz, y0, top) {
  // cx, cz: the shaft's centre cell; a 3 x 3 shaft from y0 + 2 to the neck
  const neck = top - 6;
  for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) {
    const corner = Math.abs(i) === 2 && Math.abs(k) === 2;
    if (!corner) pset(m, cx + i, y0, cz + k, MKT_COL_S);                     // the round base disc
  }
  for (let y = y0 + 1; y < neck; y++) for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
    // paint only at the foot: a red and a lapis ring; the shaft plain, its
    // corners a shade darker so it reads round
    let c = y === y0 + 1 ? RED : y === y0 + 2 ? BLUEP : (Math.abs(i) + Math.abs(k) === 2 ? MKT_COL_S : MKT_COL);
    pset(m, cx + i, y, cz + k, c);
  }
  // the neck: three tied bands (lapis, red, lapis)
  [BLUEP, RED, BLUEP].forEach((c, j) => { for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) pset(m, cx + i, neck + j, cz + k, c); });
  // the lotus: sepals out on the four faces, then the open bell five wide,
  // petals alternating green and lapis round its rim, pale inside
  const yb = neck + 3;
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) pset(m, cx + i, yb, cz + k, MKT_COL);
  for (const [i, k] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) pset(m, cx + i, yb, cz + k, MKT_PET);
  for (let y = yb + 1; y <= yb + 2; y++) for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) {
    const rim = Math.abs(i) === 2 || Math.abs(k) === 2;
    if (y === yb + 1 && Math.abs(i) === 2 && Math.abs(k) === 2) continue;
    const u = i + k + 8;
    pset(m, cx + i, y, cz + k, !rim ? MKT_COL : y === yb + 2 ? ((u & 1) ? MKT_PET_L : 0xe0c070) : ((u & 1) ? MKT_PET : BLUEP));
  }
  return yb + 3;   // the abacus row
}
function market() {
  const m = lot(64, 64, EARTH);
  m.stageStep = 12;
  // the street before the door, paved
  patch(m, 12, 44, 38, 64, PAVE, { seed: 2, rag: 3 });
  // the hall: one battered mud-brick block, a deep stepped cavetto (three
  // voxels out) over a lapis band and a painted frieze, a pale lip
  block(m, 4, 6, 44, 40, 1, 24, { wall: MKT_MUD, batter: 10, band: 'lapis', frieze: 2, style: 'cornice', lipOut: 3, flare: true, rimC: LIME, roofC: PLASTER, rim: true });
  let T = m.lastTop;
  // a pale parapet ring on the lip, the deck inside it laid in slabs
  for (let x = T.c0; x < T.c1; x++) for (let z = T.d0; z < T.d1; z++) {
    const e = Math.min(x - T.c0, T.c1 - 1 - x, z - T.d0, T.d1 - 1 - z);
    if (e === 1) pset(m, x, T.y + 1, z, LIME(x, T.y + 1, z));
  }
  roofField(m, T.c0 + 2, T.d0 + 2, T.c1 - 2, T.d1 - 2, T.y, { g: 4 });
  // high slit windows on the front and the east face
  for (const u of [9, 38]) slit(m, '+z', u, 12, 5, 2);
  for (const u of [33, 13]) slit(m, '+x', u, 14, 4, 2);
  // the entrance block on the front axis: limestone, taller than the hall,
  // the owner's band under its own cavetto
  block(m, 13, 34, 35, 47, 1, 31, { wall: LIME, batter: 0, band: 'team', frieze: 1, lipOut: 2, flare: true, rimC: LIME, roofC: PLASTER });
  T = m.lastTop;
  roofField(m, T.c0, T.d0, T.c1, T.d1, T.y, { g: 3 });
  // the porch cut into it: open on the front, painted inside (a dado and a
  // register band), the doorway in its back wall, the lintel over it
  const P0 = 16, P1 = 32, PZ0 = 40, PT = 21;
  for (let x = P0; x < P1; x++) for (let z = PZ0; z < 47; z++) for (let y = 1; y < PT; y++) m.remove(x, y, z);
  for (let x = P0; x < P1; x++) for (let z = PZ0; z < 47; z++) pset(m, x, 0, z, (x + z) & 1 ? 0xd8cbb0 : 0xcdbf9f);
  const inner = (x, y, z) => (y <= 3 ? 0xa8462e : y >= PT - 4 && y <= PT - 3 ? ((Math.floor((x + z) / 2) & 1) ? BLUEP : 0xe0b048) : y === PT - 2 ? RED : 0xefe4cb);
  for (let y = 1; y < PT; y++) {
    for (let x = P0; x < P1; x++) pset(m, x, y, PZ0 - 1, inner(x, y, PZ0 - 1));
    for (let z = PZ0; z < 47; z++) { pset(m, P0 - 1, y, z, inner(P0 - 1, y, z)); pset(m, P1, y, z, inner(P1, y, z)); }
  }
  door(m, '+z', 22, 4, 1, 13, { frame: LIME, proud: false, lintelC: GILT });
  // the two lotus columns in the porch mouth, the lintel resting on them
  for (const cx of [20, 27]) lotusColumn(m, cx, 44, 1, PT);
  // the stalls: one row along the east side under one shared blue / white
  // cloth from a batten on the hall's wall, posts at the stall ends
  const f = 42, yTop = 17, depth = 15, drop = 6;
  const posts = [8, 18, 28, 38];
  clothAwning(m, '+x', f, 7, 40, yTop, depth, drop, { posts, sw: 2, sag: 0.5, belly: 0.3, stripes: [MKT_AW, MKT_AWW], hem: 0x1f3c78 });
  // a counter of produce under each stall, its front at the cloth's edge
  const counter = (x0, x1, z0, z1, goods) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = 1; y < 4; y++) pset(m, x, y, z, (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1) ? PLANK(x, y, z) : DARKWOOD);
    const n = goods.length;
    goods.forEach((g, i) => { const a = z0 + Math.round(((z1 - z0) * i) / n), b = z0 + Math.round(((z1 - z0) * (i + 1)) / n); goodsBox(m, x0, 4, a, x1 - x0, b - a, g, 1, 0x7a5430); });
  };
  counter(53, 62, 10, 17, ['orange', 'melon']);
  counter(53, 62, 20, 27, ['green', 'date']);
  counter(53, 62, 30, 37, ['grain', 'fish']);
  // pots and crates behind the counters, by the wall
  jar(m, 47.5, 1, 11.5, 0xb8683e, true); jar(m, 49.5, 1, 15.5, 0xc8a070, false);
  crate(m, 45, 1, 21, 5, 5, 5); jar(m, 49.5, 1, 25.5, 0xb8683e, false);
  sack(m, 46, 1, 31); jar(m, 48.5, 1, 35.5, 0xb8683e, true);
  // in front of the stalls, between the posts: baskets and big jars
  jar(m, 61.5, 1, 18.5, 0xc8a070, false); basket(m, 59, 38, 'orange');
  // a stack of crates at the row's back end, a crate and a sack at its
  // front end; a big jar by the porch, amphorae on its west side
  crate(m, 50, 1, 1, 6, 6, 6); crate(m, 57, 1, 1, 5, 5, 5); crate(m, 51, 7, 2, 4, 4, 4);
  crate(m, 54, 1, 42, 4, 4, 4); sack(m, 59, 1, 42);
  jar(m, 37.5, 1, 50.5, 0xb8683e, true); amphora(m, 11.5, 1, 49.5, 1); amphora(m, 8.5, 1, 52.5, 2);
  return m;
}

// Lighthouse (3 x 3; building_20, Mythic), round 44: the Pharos as three
// DIFFERENT stages at half voxels (`fine: 2` in TYPES, 1/16 tile), each
// parted from the next by a projecting cavetto cornice (a dark fluted gorge
// row, a lit gorge row a voxel further out, a pale lip slab over them):
//  - the base: a wide square shaft battered in a voxel every 13 rows, pale
//    limestone ashlar in 4-row courses (a dark bed joint under every course,
//    staggered head joints, one tone per block plus a faint per-voxel drift),
//    long / short quoins on the corners, two team bands at the foot, framed
//    slit windows, the door with its gilt winged sun over a stair, and a
//    painted band (lapis, a red / gold block row, lapis) under its cornice;
//    four small gilt Tritons on the gallery's corners;
//  - the middle: a narrower octagon in a warmer honey sandstone, pale
//    arrises on its eight corners, a team band, a window on each flat face,
//    its own painted band and an octagonal cavetto;
//  - the top: a round drum (lapis and gold rings), the colonnaded lantern
//    (eight columns round an emissive fire), an entablature and a ribbed
//    dome with a gilt finial.
// A baked sun split (sunPass) darkens the stone of the faces turned from
// the scene's sun (+x, -z) and lifts the lit ones (-x, +z), so the tower
// reads as a solid with a light and a shadow side, not one flat cream value.
const PH_BASE = [0xeee0c2, 0xe6d6b4, 0xf2e6cc, 0xe2d0aa];
const PH_MID = [0xdcb47a, 0xd2a96e, 0xe2bc84, 0xcca268];
const PH_DRUM = [0xece0c6, 0xe4d6b8, 0xf0e6d0];
const PH_QUOIN = [0xf8f0de, 0xf4ead4];
// one ashlar voxel: u runs along the face, so the bond follows each face
function phStone(tones, x, y, z, u, { course = 4, len = 8, seed = 0 } = {}) {
  const row = Math.floor(y / course), k = ((y % course) + course) % course;
  const uu = u + (row & 1) * (len >> 1) + 1024;
  const blk = Math.floor(uu / len);
  const c = tones[Math.min(tones.length - 1, Math.floor(hash3(blk, row, seed, 301) * tones.length))];
  let f = (0.975 + 0.05 * hash3(blk, row, seed, 302)) * (0.985 + 0.03 * hash3(x, y, z, 303));
  if (k === 0) f *= 0.8;                 // the bed joint: a dark course line all round
  else if (uu % len === 0) f *= 0.87;    // the head joint
  else if (k === course - 1) f *= 1.03;  // the course's lit upper arris
  return shade(c, f);
}
const PH_GOLD = 0xd6aa00, PH_GOLD_L = 0xf4cc00, PH_GOLD_D = 0x8e6800;
const BEACON = [0xffd040, 0xffa020, 0xf07010, 0xc84808];
function lighthouse() {
  const m = lot(48, 48);
  m.stageStep = 16;
  const C = 24;
  const stone = new Map();   // key -> colour of every voxel the sun pass may shade
  const key = (x, y, z) => `${x},${y},${z}`;
  const st = (x, y, z, c) => { m.set(x, y, z, c); stone.set(key(x, y, z), c); };
  const ring = (x, z, h) => Math.min(x - (C - h), C + h - 1 - x, z - (C - h), C + h - 1 - z);
  // the podium: three rows of dark plinth stone, then a pale step course
  for (let x = C - 20; x < C + 20; x++) for (let z = C - 20; z < C + 20; z++) for (let y = 1; y < 4; y++) m.set(x, y, z, PLINTH(x, y, z));
  for (let x = C - 19; x < C + 19; x++) for (let z = C - 19; z < C + 19; z++) for (let y = 4; y < 6; y++) {
    const e = ring(x, z, 19);
    if (e > 0) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
    st(x, y, z, y === 5 ? shade(LIME(x, y, z), 1.02) : LIME_S);
  }
  // ---- the base: a wide battered square shaft --------------------------
  const B0 = 6, B1 = 58;                       // rows B0 .. B1 - 1
  const bhw = (y) => 17 - Math.floor((y - 4) / 8);    // a voxel in on every second bed joint
  for (let y = B0; y < B1; y++) {
    const hw = bhw(y), t = B1 - 1 - y;
    for (let x = C - hw; x < C + hw; x++) for (let z = C - hw; z < C + hw; z++) {
      const e = ring(x, z, hw);
      if (e > 0) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
      const onX = x === C - hw || x === C + hw - 1, onZ = z === C - hw || z === C + hw - 1;
      const u = onZ && !onX ? x : z;
      const a = Math.abs((onZ && !onX ? x : z) + 0.5 - C);       // distance from the face's axis
      // the quoins: long / short blocks alternating course by course
      const qrow = Math.floor(y / 4) & 1;
      const quoin = a > hw - (qrow ? 4 : 2.5);
      let c = quoin ? phStone(PH_QUOIN, x, y, z, u, { len: 5, seed: 7 }) : phStone(PH_BASE, x, y, z, u, { seed: 3 });
      // two team bands at the foot, a pale string course between them
      if (y === B0 + 2 || y === B0 + 4) c = TEAM;
      else if (y === B0 + 3) c = shade(LIME(x, y, z), 1.02);
      // the painted band under the cornice: lapis, red / gold blocks, lapis
      else if (t === 0) c = (Math.floor((u + 512) / 2) & 1) ? LAPIS : shade(LAPIS, 0.84);
      else if (t === 1) c = (Math.floor((u + 512) / 3) & 1) ? BAND_R : BAND_Y;
      else if (t === 2) c = LAPIS;
      else if (t === 3) c = FRIEZE_SEP;
      if (typeof c === 'number' && c >= 0 && t > 3 && !(y >= B0 + 2 && y <= B0 + 4)) st(x, y, z, c); else m.set(x, y, z, c);
    }
  }
  // windows: two columns of slits on every face, the front's low ones left
  // to the door
  for (const face of ['+z', '-z', '+x', '-x']) {
    const dir = face === '+z' || face === '-x' ? 1 : -1;
    for (const off of [-8, 6]) {
      const u = dir > 0 ? C + off : C - off - 1;
      for (const y0 of [19, 39, 47]) {
        if (face === '+z' && y0 === 19) continue;
        slit(m, face, u, y0, 6, 2);
      }
    }
  }
  door(m, '+z', C - 4, 8, B0, 13, { frame: LIME, sun: true, deep: 3 });
  // the stair down from the podium to the ground
  for (let s = 0; s < 5; s++) for (let x = C - 5; x < C + 5; x++) for (let y = 1; y < 6 - s; y++) m.set(x, y, C + 19 + s, x === C - 5 || x === C + 4 ? LIME_S : (y === 5 - s ? LIME(x, y, C + 19 + s) : SAND_D(x, y, C + 19 + s)));
  // ---- cornice 1: a square cavetto, the gallery deck and its rail -----
  const top0 = bhw(B1 - 1);                   // 12
  const flute = (x, z) => ((Math.floor((x + z + 512) / 2) & 1) ? GORGE : GORGE_L);
  for (let x = C - top0 - 1; x < C + top0 + 1; x++) for (let z = C - top0 - 1; z < C + top0 + 1; z++) {
    const e = ring(x, z, top0 + 1);
    m.set(x, B1, z, e === 0 ? shade(flute(x, z), 0.72) : SAND_D(x, B1, z));
  }
  for (let x = C - top0 - 2; x < C + top0 + 2; x++) for (let z = C - top0 - 2; z < C + top0 + 2; z++) {
    const e = ring(x, z, top0 + 2);
    m.set(x, B1 + 1, z, e === 0 ? flute(x, z) : e === 1 ? shade(flute(x, z), 0.85) : SAND_D(x, B1 + 1, z));
  }
  const G = top0 + 3, gy = B1 + 2;           // the gallery deck, a voxel past the gorge
  for (let x = C - G; x < C + G; x++) for (let z = C - G; z < C + G; z++) {
    const e = ring(x, z, G);
    m.set(x, gy, z, e === 0 ? 0xfaf3e2 : e === 1 ? 0xf2e8d2 : e === 2 ? TEAM : PLASTER(x, gy, z));
    if (e === 0) m.set(x, gy + 1, z, (x + z) & 1 ? 0xf0e6cf : 0xe8dcc2);    // a low solid rail (no merlons)
  }
  // the gilt Tritons on the gallery's corners: a pale socle, a gilt figure
  // (body, shoulders, a head) raising a conch
  m.keep = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x0 = sx < 0 ? C - G + 1 : C + G - 3, z0 = sz < 0 ? C - G + 1 : C + G - 3;
    m.box(x0, gy + 1, z0, 2, 2, 2, LIME);
    m.box(x0, gy + 3, z0, 2, 4, 2, PH_GOLD);
    m.box(x0, gy + 7, z0, 2, 1, 2, PH_GOLD_L);
    m.set(x0 + (sx < 0 ? 0 : 1), gy + 8, z0 + (sz < 0 ? 0 : 1), PH_GOLD_D);
    m.set(x0 + (sx < 0 ? 1 : 0), gy + 8, z0 + (sz < 0 ? 1 : 0), PH_GOLD_L);
    m.set(x0 + (sx < 0 ? 1 : 0), gy + 9, z0 + (sz < 0 ? 1 : 0), PH_GOLD_L);
    m.keep.push([x0, gy + 3, z0, x0 + 2, gy + 10, z0 + 2]);
  }
  // ---- the middle: an octagon in honey sandstone ------------------------
  const inOct = (x, z, R) => { const dx = Math.abs(x + 0.5 - C), dz = Math.abs(z + 0.5 - C); return dx < R && dz < R && dx + dz <= R * 1.42; };
  const O0 = gy + 1, O1 = O0 + 26;
  const oR = () => 9;
  for (let y = O0; y < O1; y++) {
    const R = oR(y), t = O1 - 1 - y;
    for (let x = C - R; x < C + R; x++) for (let z = C - R; z < C + R; z++) {
      if (!inOct(x, z, R)) continue;
      const edge = !inOct(x + 1, z, R) || !inOct(x - 1, z, R) || !inOct(x, z + 1, R) || !inOct(x, z - 1, R);
      if (!edge) { m.set(x, y, z, SAND_D(x, y, z)); continue; }
      const dx = Math.abs(x + 0.5 - C), dz = Math.abs(z + 0.5 - C);
      const diagF = dx + dz > R * 1.42 - 1.6;
      const flatX = dx > R - 1, flatZ = dz > R - 1;
      const arris = diagF && (flatX || flatZ);
      const u = flatZ && !diagF ? x : flatX && !diagF ? z : x - z * Math.sign(x + 0.5 - C) * Math.sign(z + 0.5 - C);
      let c = arris ? phStone(PH_QUOIN, x, y, z, u, { len: 4, seed: 8 }) : phStone(PH_MID, x, y, z, u, { len: 7, seed: 5 });
      if (y === O0 + 2) c = TEAM;
      else if (y === O0 + 1 || y === O0 + 3) c = shade(LIME(x, y, z), 1.02);
      else if (t === 0) c = (Math.floor((u + 512) / 2) & 1) ? LAPIS : shade(LAPIS, 0.84);
      else if (t === 1) c = (Math.floor((u + 512) / 3) & 1) ? BAND_Y : BAND_R;
      else if (t === 2) c = LAPIS;
      if (y > O0 + 3 && t > 2) st(x, y, z, c); else m.set(x, y, z, c);
    }
  }
  // a window on each flat face of the octagon (two wide, six tall, a lintel)
  for (const face of ['+z', '-z', '+x', '-x']) {
    const dir = face === '+z' || face === '-x' ? 1 : -1;
    slit(m, face, dir > 0 ? C - 1 : C, O0 + 8, 7, 2);
  }
  // ---- cornice 2: the octagonal cavetto and upper deck ------------------
  const Rt = oR(O1 - 1);
  for (const [dy, R, f] of [[0, Rt + 1, 0.72], [1, Rt + 2, 1]]) {
    for (let x = C - R; x < C + R; x++) for (let z = C - R; z < C + R; z++) {
      if (!inOct(x, z, R)) continue;
      const edge = !inOct(x + 1, z, R) || !inOct(x - 1, z, R) || !inOct(x, z + 1, R) || !inOct(x, z - 1, R);
      m.set(x, O1 + dy, z, edge ? shade(flute(x, z), f) : SAND_D(x, O1 + dy, z));
    }
  }
  const R3 = Rt + 3, uy = O1 + 2;
  for (let x = C - R3; x < C + R3; x++) for (let z = C - R3; z < C + R3; z++) {
    if (!inOct(x, z, R3)) continue;
    const edge = !inOct(x + 1, z, R3) || !inOct(x - 1, z, R3) || !inOct(x, z + 1, R3) || !inOct(x, z - 1, R3);
    m.set(x, uy, z, edge ? 0xfaf3e2 : PLASTER(x, uy, z));
    if (edge) m.set(x, uy + 1, z, (x + z) & 1 ? 0xf0e6cf : 0xe8dcc2);
  }
  // ---- the top: a round drum, the lantern, the dome --------------------
  const D0 = uy + 1, D1 = D0 + 8;
  lathe(m, C, C, D0, D1, () => 6.6, (x, y, z) => {
    if (y === D0 + 1) return LAPIS;
    if (y === D0 + 2) return (Math.floor((x + z + 512) / 2) & 1) ? BAND_Y : LAPIS;
    if (y === D0 + 3) return LAPIS;
    const a = Math.atan2(z + 0.5 - C, x + 0.5 - C);
    return phStone(PH_DRUM, x, y, z, Math.round(a * 7), { len: 5, seed: 9 });
  });
  for (const v of m.coords) if (v[1] >= D0 + 4 && v[1] < D1) { const p = m.get(...v); if (p && !p.team) stone.set(key(...v), p.c); }
  // the drum's cornice: a lit ring a voxel out, the lantern floor
  lathe(m, C, C, D1, D1 + 1, () => 7.4, (x, y, z) => (Math.hypot(x + 0.5 - C, z + 0.5 - C) > 6.6 ? shade(GORGE_L, 1) : SAND_D(x, y, z)));
  lathe(m, C, C, D1 + 1, D1 + 2, () => 7.9, (x, y, z) => (Math.hypot(x + 0.5 - C, z + 0.5 - C) > 7.0 ? 0xfaf3e2 : 0xd8cbb0));
  const L0 = D1 + 2, LH = 12;
  // eight 2 x 2 columns round the fire: a base, a pale shaft, a gilt capital
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * Math.PI / 4;
    const x = Math.round(C + Math.cos(a) * 5.6 - 1), z = Math.round(C + Math.sin(a) * 5.6 - 1);
    for (let y = L0; y < L0 + LH; y++) {
      const c = y === L0 ? LIME_S : y >= L0 + LH - 2 ? (y === L0 + LH - 1 ? 0xf6eedb : GILT) : (y - L0) % 4 === 0 ? 0xe2d6bc : 0xf3ead6;
      m.box(x, y, z, 2, 1, 2, c);
    }
  }
  // the fire: a bright emissive core (the beacon) on a bed of embers
  for (let x = C - 4; x < C + 4; x++) for (let z = C - 4; z < C + 4; z++) {
    const d = Math.hypot(x + 0.5 - C, z + 0.5 - C);
    if (d > 3.3) continue;
    const h = Math.round(8 - d * 1.6);
    for (let y = 0; y < Math.max(1, h); y++) {
      const c = y === 0 ? (d > 2 ? BEACON[3] : BEACON[2]) : d < 1.5 && y < h - 1 ? BEACON[0] : y >= h - 1 ? BEACON[2] : BEACON[1];
      m.set(x, L0 + y, z, c, { glow: 0.95 });
    }
  }
  // the entablature: a pale architrave, a lapis frieze, a lit lip
  const E = L0 + LH;
  lathe(m, C, C, E, E + 1, () => 7.2, (x, y, z) => (Math.hypot(x + 0.5 - C, z + 0.5 - C) > 6.4 ? 0xf2e8d2 : 0xd8cbb0));
  lathe(m, C, C, E + 1, E + 2, () => 7.2, (x, y, z) => (Math.floor((Math.atan2(z + 0.5 - C, x + 0.5 - C) + 4) * 6) & 1 ? LAPIS : BAND_Y));
  lathe(m, C, C, E + 2, E + 3, () => 7.8, 0xfaf3e2);
  // the ribbed dome: rings a step in per row, eight darker ribs, a gilt finial
  const CONE = [7.6, 6.4, 5.6, 4.8, 4.0, 3.2, 2.4, 1.6];
  CONE.forEach((r, i) => lathe(m, C, C, E + 3 + i, E + 4 + i, () => r, (x, y, z) => (Math.hypot(x + 0.5 - C, z + 0.5 - C) > r - 0.9 ? (i === 0 ? 0xe2d6bc : 0xf2eada) : 0xd8cbb0)));
  const F = E + 3 + CONE.length;
  m.box(C - 1, F, C - 1, 2, 1, 2, PH_GOLD_D);
  m.box(C - 2, F + 1, C - 2, 4, 2, 4, PH_GOLD);
  m.box(C - 1, F + 3, C - 1, 2, 2, 2, PH_GOLD_L);
  m.box(C - 1, F + 5, C - 1, 1, 2, 1, PH_GOLD_L);
  m.keep.push([C - 2, F, C - 2, C + 2, F + 7, C + 2]);
  // ---- the fire bowls before the podium -------------------------------
  for (const bx of [1, 44]) {
    m.box(bx, 1, 44, 3, 8, 3, LIME);
    m.box(bx, 8, 44, 3, 1, 3, LIME_S);
    m.box(bx - 1, 9, 43, 5, 1, 5, PH_GOLD_D);
    for (let x = bx - 1; x < bx + 4; x++) for (let z = 43; z < 48; z++) {
      const rim = x === bx - 1 || x === bx + 3 || z === 43 || z === 47;
      if (rim) { m.set(x, 10, z, PH_GOLD); continue; }
      const core = x === bx + 1 && z === 45;
      m.set(x, 10, z, BEACON[2], { glow: 0.95 });
      m.set(x, 11, z, core ? BEACON[0] : BEACON[1], { glow: 0.95 });
      if (core || ((x + z) & 1)) m.set(x, 12, z, core ? BEACON[0] : BEACON[2], { glow: 0.95 });
      if (core) m.set(x, 13, z, BEACON[1], { glow: 0.95 });
    }
    m.keep.push([bx - 1, 9, 43, bx + 4, 11, 48]);
  }
  // ---- the sun pass: a lit side and a shadow side ---------------------
  // the scene's sun comes from -x / +z (shadows fall to +x / -z): the stone
  // of a face turned to it is lifted, the stone turned away pressed down,
  // an edge voxel takes the mean of its two faces
  for (const [k, c0] of stone) {
    const [x, y, z] = k.split(',').map(Number);
    const p = m.get(x, y, z);
    if (!p || p.c !== c0 || p.team || p.glow) continue;
    const nx = (m.has(x + 1, y, z) ? 0 : 1) - (m.has(x - 1, y, z) ? 0 : 1);
    const nz = (m.has(x, y, z + 1) ? 0 : 1) - (m.has(x, y, z - 1) ? 0 : 1);
    if (nx === 0 && nz === 0) continue;
    const d = -nx + nz;
    const f = d >= 2 ? 1.08 : d === 1 ? 1.05 : d === 0 ? 0.88 : d === -1 ? 0.7 : 0.66;
    p.c = shade(c0, f);
  }
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

// The Wonder's sphinx (round 22), drawn at a third of a voxel into its own
// model on m.fine (k = 3), so the face and the nemes have room: a lion lying
// toward +z with a flat-based loaf body (a clear back line rising from the
// rump to the shoulders), haunches bulging at the flanks, the hind paws
// tucked forward, the forelegs reaching straight out to paws with toe
// grooves, the tail curled along the right flank; a human head with a face
// carved in relief (brow ridge and painted brows, ivory eyes with pupils and
// kohl wings, a nose ridge to a tip with nostrils, lips, a chin, the false
// beard) under a gold diadem and uraeus, in a nemes striped gold and lapis
// whose wings frame the face and flare to the shoulders and whose lappets
// hang in front of the chest. Built as signed shapes sampled at the fine
// voxel centres (coarse coordinates), then shaded: tops a step lighter,
// undersides and recesses darker, the sunward (-x) flank lighter.
const SPX_ST = [0x8e7a56, 0xae9b74, 0xcbb994, 0xe0d2b2];   // round 45: wider steps, so the lion's masses read   // deep, shade, base, light
const SPX_GOLD = [0x7a5200, 0x9c6800, 0xb88400, 0xd09c18];
const SPX_LAP = [0x203a66, 0x2b4a7c, 0x34558c, 0x4a6aa4];
const SPX_CREASE = [0x5a4a34, 0x705c42, 0x8a7656];   // the cut lines between the lion's masses (deep, shade, lit)
const SPX_IVORY = 0xf0e8d4, SPX_KOHL = 0x1a2a4a, SPX_BROW = 0x9c8662, SPX_LIP = 0xb88a6c, SPX_LIPD = 0x7a4a3a, SPX_GROOVE = 0x8c7a58;
function sphinx(m, X0, sy) {
  const k = 3, sub = new Rec(m.W * k, m.D * k);
  // the head is drawn in its own space scaled by HS round the chin and the face plane
  const HS = 0.86, chinY = sy + 10.4, zf = 33.4, zc = zf - 3.8;
  const sm = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
  const ell = (px, py, pz, cx, cy, cz, rx, ry, rz) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 + ((pz - cz) / rz) ** 2 <= 1;
  const sup = (a, b, e = 2.6) => Math.abs(a) ** e + Math.abs(b) ** e <= 1;
  // material per sample: null (air) or [tag, ...]
  function sample(px, py, pz) {
    if (py < sy) return null;
    const head = headPart((px - X0) / HS, (py - chinY) / HS, zf + (pz - zf) / HS);
    return head ?? lionPart(px, py, pz);
  }
  function headPart(u, v, pz) {
    const au = Math.abs(u);
    // ---- the head: face, nemes, beard
    const hw = 2.3 + 0.95 * sm(0, 2.6, v);                  // the face's half width: a narrow chin widening to the cheeks
    if (v >= -0.2 && v < 7.7 && au < hw) {
      let zs = zf - 0.11 * u * u - (v < 1.0 ? 0.35 * (1 - v) : 0);
      const eu = au - 1.45, ev = v - 5.0;                    // eye-local
      let tag = 'face';
      if (Math.abs(eu) < 1.05 && Math.abs(ev) < 0.5) zs -= 0.34;                // the eye socket
      if (Math.abs(eu) < 0.82 && Math.abs(ev) < 0.34) tag = Math.abs(eu) < 0.34 ? 'pupil' : 'eye';
      else if (ev >= 0.34 && ev < 0.68 && eu > -1.0 && eu < 1.0 + 0.4) tag = 'kohl';    // the kohl line over the eye
      else if (ev >= -0.34 && ev < 0.0 && eu >= 0.82 && eu < 1.6) tag = 'kohl';         // its wing to the temple
      if (ev >= 0.68 && ev < 1.1 && Math.abs(eu + 0.05) < 1.12) { zs += 0.36; tag = 'brow'; }   // the brow ridge
      if (v >= 2.1 && v < 5.6) {                               // the nose ridge, widening and rising to the tip
        const t = (5.6 - v) / 3.5, nw = 0.36 + 0.42 * t;
        if (au < nw) { zs = Math.max(zs, zf + 0.12 + 0.75 * t); tag = 'face'; }
        if (v < 2.45 && au >= 0.3 && au < 0.8) { zs = Math.max(zs, zf + 0.12); tag = 'nostril'; }
      }
      if (v >= 0.85 && v < 1.95 && au < 1.15 - (v < 1.2 ? 0.15 : 0)) {          // the lips
        zs = Math.max(zs, zf + (v >= 1.2 && v < 1.5 ? -0.05 : 0.25) - 0.06 * u * u);
        tag = v >= 1.2 && v < 1.5 ? 'mouth' : 'lip';
      }
      if (v >= 6.95 && v < 7.7) { zs = zf + 0.3 - 0.08 * u * u; tag = 'gold'; }  // the diadem band
      if (pz < zs && pz > zc - 3.6) return tag;
    }
    // the uraeus: a rearing cobra at the forehead
    if (au < 0.42 && v >= 6.6 && v < 8.9 && pz >= zf - 0.2 && pz < zf + 0.75 + (v > 8.2 ? 0.35 : 0)) return 'gold';
    // the nemes cap: a dome over the brow, the stripes running round it
    if (v >= 7.6 && Math.abs(u / 4.6) ** 3 + Math.abs((v - 7.2) / 4.0) ** 3 + Math.abs((pz - zc + 0.4) / 4.3) ** 3 <= 1) return 'cap';
    // the wings: framing the face, flaring from the temples to the shoulders
    const W = v >= 7.6 ? 0 : v >= 0 ? 4.5 + 2.3 * (1 - v / 7.6) : 6.8;
    if (v >= 0 && v < 7.6 && au < W && pz > zc - 4.4 && pz < zf - 0.45) {
      if (au >= hw || pz < zf - 1.2 - 0.11 * u * u) return au < hw + 0.34 && pz > zf - 0.85 ? 'gold' : 'nemes';
    }
    // round 45: the wings fall on down over the shoulders, a striped flap
    // draped on each shoulder that leans back as it falls, a gold hem at its
    // edge; the back of the headdress is closed, its queue lies on the spine
    // (lionPart)
    if (v >= -3.4 && v < 0 && au >= 2.6 && au < 6.8 - 0.25 * (-v) && pz > zc - 4.4 && pz < zf - 2.0) return 'nemes';
    if (v >= -8.4 && v < -3.4 && au >= 2.4 && au < 6.85 - 0.12 * (-v)) {
      const back = zc - 4.4 - 0.55 * (-3.4 - v), front = zf - 2.0 - 0.35 * (-3.4 - v);
      if (pz > back && pz < front) return au > 6.85 - 0.12 * (-v) - 0.4 || pz < back + 0.4 ? 'gold' : 'drape';
    }
    if (au < 4.4 && v >= -1.2 && v < 7.7 && pz > zc - 4.9 && pz <= zc - 3.4) return 'nemes';   // the closed back of the headdress
    // the neck under the chin
    if (au < 2.6 && v >= -4 && v < 0.2 && pz > 26 && pz < zf - 1.0) return 'body';
    // the lappets: two striped bands hanging in front of the chest
    if (au >= 2.9 && au < 4.9 && v >= -5.4 && v < 0.5 && pz > zf - 1.9 && pz < zf - 0.45 - (v < -4.6 ? 0.3 : 0)) return au < 3.25 || au > 4.55 ? 'gold' : 'nemes';
    // the false beard: plaited, a little forward at its foot
    if (au < 0.72 + (v < -2.6 ? 0.12 : 0) && v >= -3.1 && v < 0.3 && pz > zf - 1.4 && pz < zf - 0.25 + (v < -2.4 ? 0.2 : 0)) return 'beard';
    return null;
  }
  // ---- the lion (round 45): carved the way the Egyptians carved it, as a
  // block with its anatomy in relief, not as voxel onions (building_21): a
  // long body block whose back runs dead level from the rump to the
  // shoulders, its arrises rounded tight and the rump rounded off in plan
  // and profile; on each flank the folded hind leg as a raised haunch panel
  // with its paw tucked forward along the ground, and the shoulder as a
  // raised panel over the elbow; two shoulder blades standing proud of the
  // spine; the forelegs as straight square-cut forearms to a wrist and broad
  // paws with three toe notches cut through their tops and fronts; the tail
  // curling up over the rump to a tuft lying on the back. Creases (tagged
  // 'crease', the darkest stone) are cut round every raised panel, behind
  // the shoulder blades, at the wrists and under the whole statue where it
  // sits on the deck.
  const BT = sy + 8.4, BW = 5.0, ZR = 8.0, ZF = 30.5;   // the level spine, the body's half width, the rump end, the chest
  const eV = (px, py, pz, cx, cy, cz, rx, ry, rz, p = 2) => Math.abs((px - cx) / rx) ** p + Math.abs((py - cy) / ry) ** p + Math.abs((pz - cz) / rz) ** p;
  const e2 = (a, b, p = 2) => Math.abs(a) ** p + Math.abs(b) ** p;
  // the body's half width at (py, pz) (0 outside): a p = 5 section, the rump rounded
  function bodyW(py, pz) {
    if (pz < ZR || pz > ZF) return 0;
    const f = pz < ZR + 3.4 ? Math.sqrt(Math.max(0, 1 - ((ZR + 3.4 - pz) / 3.4) ** 2)) : 1;
    const h = (BT - sy) * (0.62 + 0.38 * f), t = (py - sy) / h;
    if (t < 0 || t > 1) return 0;
    return BW * Math.max(0.25, f) * (1 - t ** 5) ** 0.2;
  }
  // the tail: a cubic from the rump's foot up over its top to the right of the spine
  const TAIL = [[X0 + 1.4, sy + 2.6, 8.6], [X0 + 4.4, sy + 4.6, 5.9], [X0 + 4.9, sy + 10.2, 8.2], [X0 + 3.9, BT + 0.45, 12.4]];
  const tailPts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = 1 - t, w = [a * a * a, 3 * a * a * t, 3 * a * t * t, t * t * t];
    tailPts.push([0, 1, 2].map((c) => w.reduce((s, wi, n) => s + wi * TAIL[n][c], 0)));
  }
  function lionPart(px, py, pz) {
    const u = px - X0, au = Math.abs(u), s = u < 0 ? -1 : 1;
    const lift = py - sy;
    // the tail and its tuft (they lie on the body)
    for (const [tx, ty, tz] of tailPts) if ((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2 <= 0.3) return 'body';
    const [ex, ey, ez] = tailPts[tailPts.length - 1];
    if (eV(px, py, pz, ex - 0.2, ey + 0.1, ez + 0.6, 0.85, 0.7, 1.15) <= 1) return 'tuft';
    // the nemes queue: a striped tail of the headdress lying on the spine
    // between the shoulder blades, narrowing to a gold tip
    if (au < 1.15 - 0.04 * (26.8 - pz) && pz >= 20.2 && pz < 26.8 && py >= BT - 0.4 && py < BT + 0.75) return pz < 20.9 ? 'gold' : 'queue';
    // the forelegs
    const lc = X0 + s * 5.2 + 1 / 6, lu = px - lc;      // the foreleg's axis (on a fine voxel centre)
    if (pz >= 36.0 && pz < 38.9) {
      // the paw: broad, its front corners rounded, the knuckles falling to the front
      const r = pz > 37.4 ? (pz - 37.4) / 1.5 : 0;
      const hh = 2.6 - 0.8 * sm(37.6, 38.9, pz);
      if (e2(lu / 2.5, r, 3) <= 1 && e2(lu / 2.5, lift / hh, 4) <= 1) {
        if (lift < 1 / 3) return 'crease';
        const rel = Math.floor(px * 3) - Math.floor(lc * 3);
        if ((rel === -4 || rel === 0 || rel === 4) && pz > 37.6) return lift > hh - 0.75 ? null : 'crease';   // the toe notches
        if (pz < 36.4 && lift > 0.9) return 'crease';                                                      // the wrist
        return 'body';
      }
    }
    if (pz >= ZF - 3.5 && pz < 36.4) {
      // the forearm, square cut, tapering a little to the wrist, off the shoulder panel
      const t = sm(29, 35.8, pz), hw = 1.75 - 0.15 * t, hh = 3.4 - 0.9 * t;
      if (e2(lu / hw, lift / hh, 4) <= 1) return lift < 1 / 3 ? 'crease' : 'body';
    }
    // the hind paw tucked forward along the ground in front of the haunch
    const hc = X0 + s * 5.9 + 1 / 6, hu = px - hc;
    if (pz >= 14.0 && pz < 21.6) {
      const r = pz > 20.2 ? (pz - 20.2) / 1.4 : 0;
      const hh = 1.9 - 0.5 * sm(20.4, 21.6, pz);
      if (e2(hu / 1.4, r, 3) <= 1 && e2(hu / 1.4, lift / hh, 4) <= 1) {
        if (lift < 1 / 3) return 'crease';
        const rel = Math.floor(px * 3) - Math.floor(hc * 3);
        if ((rel === -2 || rel === 2) && pz > 20.5) return lift > hh - 0.6 ? null : 'crease';
        return 'body';
      }
    }
    // the chest under the head
    const chest = eV(px, py, pz, X0, sy + 5.0, 28.6, 4.6, 7.2, 3.0) <= 1;
    // the body block, with the raised panels on its flanks and the blades on its back
    const w = bodyW(py, pz);
    const eH = e2((py - (sy + 4.0)) / 3.7, (pz - 13.4) / 4.6, 2.2);          // the haunch panel
    const eS = e2((py - (sy + 4.6)) / 3.9, (pz - 25.6) / 3.3, 2.2);          // the shoulder panel
    const eB = e2((au - 2.7) / 1.3, (pz - 23.6) / 2.7, 2.2);                  // the shoulder blade
    const panel = eH <= 1 ? 0.8 * Math.min(1, (1 - eH) * 4) : eS <= 1 ? 0.8 * Math.min(1, (1 - eS) * 4) : 0;
    const inPanelW = w > 0 && au < w + panel + 0.01;
    const blade = eB <= 1 && py >= BT - 0.5 && py < BT + 0.75 * Math.min(1, (1 - eB) * 3);
    if (!(inPanelW || blade || chest)) return null;
    if (lift < 1 / 3) return 'crease';
    // the cut round each panel, on the flank just outside it
    if (!blade && !chest && ((eH > 1 && eH < 1.4) || (eS > 1 && eS < 1.38)) && au > w - 0.8) return 'crease';
    if (!blade && eB > 1 && eB < 1.45 && py >= BT - 0.6) return 'crease';
    // three stone values on the flank: the raised panels and blades a step
    // lighter (worn smooth), the belly a step darker, the block between
    if (blade || (panel > 0 && au > w - 0.05)) return 'panel';
    if (lift < 1.7 && !chest) return 'belly';
    return 'body';
  }
  // sample the box round the sphinx
  const x0 = (X0 - 9) * k, x1 = (X0 + 9) * k, y0 = sy * k, y1 = (sy + 25) * k, z0 = 6 * k, z1 = 40 * k;
  const NX = x1 - x0, NY = y1 - y0, NZ = z1 - z0;
  const grid = new Array(NX * NY * NZ);
  const id = (i, j, l) => (i * NY + j) * NZ + l;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let l = 0; l < NZ; l++) {
    grid[id(i, j, l)] = sample((x0 + i + 0.5) / k, (y0 + j + 0.5) / k, (z0 + l + 0.5) / k);
  }
  const at = (i, j, l) => (i < 0 || j < 0 || l < 0 || i >= NX || j >= NY || l >= NZ ? (j < 0 ? 'deck' : null) : grid[id(i, j, l)]);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let l = 0; l < NZ; l++) {
    const tag = grid[id(i, j, l)];
    if (!tag) continue;
    const open = DIRS6.filter(([a, b, c]) => !at(i + a, j + b, l + c));
    if (!open.length) continue;
    const up = open.some((d) => d[1] > 0), dn = open.some((d) => d[1] < 0), west = open.some((d) => d[0] < 0), east = open.some((d) => d[0] > 0);
    // recesses: an open face whose cell has solid round it on 3+ of its 4 sides
    const concave = open.some(([a, b, c]) => {
      let n = 0;
      for (const [p, q, r] of DIRS6) {
        if ((p && a) || (q && b) || (r && c)) continue;
        if (at(i + a + p, j + b + q, l + c + r)) n++;
      }
      return n >= 3;
    });
    // the light: a normal smoothed over the 5^3 neighbourhood (so the voxel
    // steps of a curved flank shade as one surface, not as contour rings)
    // against the sun from -x, high and a little in front
    let nx = 0, ny = 0, nz = 0;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
      if (at(i + a, j + b, l + c)) { nx -= a; ny -= b; nz -= c; }
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lit = (-0.45 * nx + 0.8 * ny + 0.4 * nz) / nl;
    let s = lit > 0.62 ? 3 : lit > 0.18 ? 2 : lit > -0.3 ? 1 : 0;   // ramp index: 0 deep, 1 shade, 2 base, 3 light
    if (concave && s > 0) s--;
    const X = x0 + i, Y = y0 + j, Z = z0 + l;
    let c;
    if (tag === 'body' || tag === 'face') c = SPX_ST[s];
    else if (tag === 'panel') c = SPX_ST[Math.min(3, s + 1)];
    else if (tag === 'belly') c = SPX_ST[Math.max(0, s - 1)];
    else if (tag === 'crease') c = SPX_CREASE[s > 1 ? 1 : 0];
    else if (tag === 'tuft') c = SPX_CREASE[s > 1 ? 2 : 1];
    else if (tag === 'drape') {
      // the flap's stripes run with its fall: bands across it, counted down from the head
      c = (Math.floor(j / 2) % 2 ? SPX_LAP : SPX_GOLD)[Math.max(1, s)];
    } else if (tag === 'queue') c = (Math.floor(l / 2) % 2 ? SPX_LAP : SPX_GOLD)[Math.max(1, s)];
    else if (tag === 'cap') {
      // the cap's stripes fan out from the brow (Tutankhamun's mask)
      const hu = ((X + 0.5) / k - X0) / HS, hv = ((Y + 0.5) / k - chinY) / HS;
      c = (Math.floor(Math.atan2(hu, hv - 4.5) / 0.2 + 100) % 2 ? SPX_LAP : SPX_GOLD)[Math.max(1, s)];
    } else if (tag === 'nemes') {
      c = (Math.floor(j / 2) % 2 ? SPX_LAP : SPX_GOLD)[Math.max(1, s)];
    } else if (tag === 'beard') {
      c = (j % 2 ? SPX_LAP : SPX_GOLD)[Math.max(1, s)];
    } else if (tag === 'gold') c = SPX_GOLD[Math.max(1, s)];
    else if (tag === 'eye') c = SPX_IVORY;
    else if (tag === 'pupil' || tag === 'kohl') c = SPX_KOHL;
    else if (tag === 'brow') c = up ? SPX_ST[3] : SPX_BROW;
    else if (tag === 'lip') c = SPX_LIP;
    else if (tag === 'mouth') c = SPX_LIPD;
    else if (tag === 'nostril') c = SPX_ST[0];
    else if (tag === 'groove') c = SPX_GROOVE;
    else c = SPX_ST[s];
    sub.set(X, Y, Z, c);
  }
  // the gilded naos between the paws (building_21): a gold shrine on a dark
  // gold foot, the owner's band, a lapis niche with a gold king in it, glyph
  // columns down its sides, a flared gold cap; its top stays under the chin
  const sx0 = X0 * k - 6, sx1 = X0 * k + 6, sz0 = 106, sz1 = 116, Y = sy * k;
  const KING = ['..GGGG..', '.GGGGGG.', '.GgGGgG.', '..GGGG..', 'GGGGGGGG', 'G.GGGG.G', 'G.GGGG.G', '..GGGG..', '.GGGGGG.', '.GG..GG.', '.GG..GG.', 'GGG..GGG'];
  const SH = 22;
  for (let y = Y; y < Y + SH; y++) for (let x = sx0 - 1; x <= sx1; x++) for (let z = sz0 - 1; z <= sz1; z++) {
    const r = y - Y, edgeX = x === sx0 || x === sx1 - 1, edgeZ = z === sz0 || z === sz1 - 1;
    const out1 = x < sx0 || x >= sx1 || z < sz0 || z >= sz1;
    if (r < 2) { sub.set(x, y, z, SPX_GOLD[1]); continue; }
    if (r >= SH - 3) { if (r === SH - 1 || !out1) sub.set(x, y, z, r === SH - 1 ? SPX_GOLD[3] : SPX_GOLD[2]); else if (r === SH - 2) sub.set(x, y, z, SPX_GOLD[2]); continue; }
    if (out1) continue;
    let c = r < 4 ? TEAM : edgeX || edgeZ || r === 4 || r === SH - 4 ? SPX_GOLD[2] : SPX_GOLD[1];
    // the glyph columns on the sides: lapis signs on the gold
    if ((x === sx0 || x === sx1 - 1) && !edgeZ && r >= 6 && r < SH - 5) {
      const g = BAND_GLYPHS5[Math.floor((r - 6) / 6) % BAND_GLYPHS5.length], jj = (r - 6) % 6, ii = z - sz0 - 3;
      if (jj < 5 && ii >= 0 && ii < 3 && g[4 - jj][ii] === 'g') c = SPX_LAP[2];
    }
    sub.set(x, y, z, c);
  }
  // the niche: lapis, two voxels deep, the king in gold on it
  for (let y = Y + 5; y < Y + SH - 4; y++) for (let x = X0 * k - 4; x < X0 * k + 4; x++) {
    sub.remove(x, y, sz1 - 1);
    const i = x - (X0 * k - 4), jrow = Y + SH - 5 - y;
    const ch = jrow < KING.length && i >= 0 && i < 9 ? KING[jrow][i] : '.';
    if (ch === 'G') sub.set(x, y, sz1 - 1, SPX_GOLD[3]);
    else if (ch === 'g') sub.set(x, y, sz1 - 1, SPX_GOLD[0]);
    else sub.set(x, y, sz1 - 2, SPX_LAP[2]);
  }
  (m.fine ??= []).push({ m: sub, k });
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
  block(m, 12, 6, 54, 40, 9, 8, { wall: LIME, frieze: 0, roofC: LIME, rim: false, parapet: false });
  // the deck's flanks (building_21): a row of gold panels, each with a lapis
  // sign (an ankh or a djed), between two lapis lines
  const DK = { G: CG_L, g: CG, L: LAPIS_S, D: CG_D, T: TEAM };
  for (const [face, u0, len] of [['+x', 39, 33], ['-x', 7, 33]]) {
    const rows = ['L'.repeat(len), '', '', '', '', '', 'L'.repeat(len)];
    for (let r = 1; r < 6; r++) {
      let row = '';
      for (let i = 0; i < len; i++) {
        const c = i % 6, panel = c >= 1 && c <= 4;
        const g = ['.gg.', 'g..g', '.gg.', 'gggg', '.gg.'][r - 1];
        const g2 = ['gggg', '.gg.', 'gggg', '.gg.', '.gg.'][r - 1];
        row += !panel ? '.' : (Math.floor(i / 6) % 2 ? g2 : g)[c - 1] === 'g' ? 'L' : 'G';
      }
      rows[r] = row;
    }
    paint(m, face, u0, 16, rows, DK);
  }
  // round 45: the decks are not plain planes: each step's top laid in
  // staggered flags with darker joints, the upper deck under a raised
  // coping ring (the lightest line on the building) with a shadowed gutter
  // inside it and gilt-capped offering stands in its corners (building_21)
  const JOINT = 0xb09f7c, GUTTER = 0xa08e6c, FLAG = [0xcdc2aa, 0xd8cdb4, 0xc4b89c];
  const flags = (y, x0, z0, x1, z1, skip) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
      if (skip && skip(x, z) || !m.get(x, y, z)) continue;
      const row = Math.floor((z - z0) / 4), joint = (z - z0) % 4 === 0 || (x - x0 + (row % 2) * 3) % 6 === 0;
      m.set(x, y, z, joint ? JOINT : FLAG[Math.floor(hash3(Math.floor((x - x0 + (row % 2) * 3) / 6), y, row, 45) * 3)]);
    }
  };
  flags(8, 8, 4, 58, 44, (x, z) => x >= 12 && x < 54 && z >= 6 && z < 40);
  flags(17, 13, 7, 53, 39);
  for (let x = 12; x < 54; x++) for (let z = 6; z < 40; z++) {
    const d = Math.min(x - 12, 53 - x, z - 6, 39 - z);
    if (d === 0) m.set(x, 18, z, LIP(x, 18, z));
    else if (d === 1) m.set(x, 17, z, GUTTER);
  }
  for (const [x, z] of [[14, 8], [50, 8], [14, 35], [50, 35]]) {
    m.box(x, 18, z, 2, 2, 2, LIME);
    m.box(x, 20, z, 2, 1, 2, CG_L);
    m.set(x, 19, z, LAPIS_S); m.set(x + 1, 19, z + 1, LAPIS_S);
  }
  // the sphinx (round 22: a third-voxel model on a deck raised so it stands
  // clear over the gate, see sphinx())
  const sy = 18, X0 = 33;
  sphinx(m, X0, sy);
  // the pylon gate (two towers + the door block)
  // round 22: the reliefs in deep golds that stay gold under the grade, the
  // hieroglyphs as a framed register of vertical columns (building_21): gold
  // panels between dark-gold rules, one sign over another in lapis and red,
  // a lapis rule over and under the register; no black
  const RL = { G: CG_L, g: CG, D: CG_D, L: LAPIS_S, R: RED_M, T: TEAM, S: 0xb8301e };
  const SIGNS = [
    ['.g.', 'g.g', '.g.', 'ggg', '.g.'],   // ankh
    ['ggg', '.g.', 'ggg', '.g.', '.g.'],   // djed
    ['gg.', '.g.', '.g.', '.g.', 'g.g'],   // was sceptre
    ['...', 'ggg', 'g.g', 'ggg', '...'],   // sun disc
    ['g.g', 'ggg', '.g.', 'ggg', 'g.g'],   // scarab
    ['.g.', 'gg.', 'gg.', 'gg.', '.g.'],   // feather
  ];
  const register = (x0, w, yTop, n, seed) => {
    // n columns of 3, a dark-gold rule between: width 4n + 1
    const rows = [];
    const rule = 'L'.repeat(4 * n + 1);
    rows.push(rule);
    for (let r = 0; r < 5; r++) {
      let row = '';
      for (let c = 0; c < n; c++) {
        row += 'D';
        const sign = SIGNS[(c * 2 + seed) % SIGNS.length], rr = r;
        const ink = (c + seed) % 3 === 2 ? 'R' : 'L';
        for (let i = 0; i < 3; i++) row += rr < 5 && sign[rr][i] === 'g' ? ink : 'G';
      }
      rows.push(row + 'D');
    }
    rows.push(rule);
    paint(m, '+z', x0 + Math.floor((w - (4 * n + 1)) / 2), yTop, rows, RL);
  };
  for (const [x0, x1] of [[10, 28], [36, 54]]) {
    block(m, x0, 44, x1, 52, 1, 26, { wall: LIME, frieze: 2, batter: 13 });
    // the gold reliefs: two gods with a sun disc and a sceptre, a cartouche
    // column between them, the register of glyph columns over them
    const mid = Math.floor((x0 + x1) / 2);
    const god = ['..SS..', '.SSSS.', '..GG..', '.GGGG.', 'GGGGGG', 'G.GG.G', 'G.GG.G', 'g.GG.G', '..GG.G', '..gg.G', '.GGGG.', '.G..G.', 'GG..GG'];
    const GOD = { ...RL, G: CG, g: CG_D };   // the figures a step darker than the panels, so they stand off the pale stone
    paint(m, '+z', mid - 7, 16, god, GOD);
    paint(m, '+z', mid + 2, 16, god, GOD);
    paint(m, '+z', mid - 1, 15, ['DDD', 'DGD', 'DLD', 'DGD', 'DRD', 'DGD', 'DLD', 'DGD', 'DRD', 'DGD', 'DDD'], RL);
    register(x0 + 1, x1 - x0 - 2, 24, 4, x0 & 3);
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
  // round 27: goods that read from the RTS camera, each kind in its own
  // colour on a mat: linen sacks (near white), amphorae (red terracotta),
  // blue-banded storage jars (cream), straw baskets (yellow) heaped with
  // dates, melons or oranges, a heap of grain (gold), timber crates
  const m = lot(16, 16, EARTH);
  const mat = (x0, z0, x1, z1) => { for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) m.set(x, 0, z, (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1) ? 0x8a7444 : FROND_DRY(x, 0, z)); };
  if (v === 0) {
    // the potter's pitch: amphorae in a row, two banded jars, a basket
    mat(1, 2, 15, 14);
    for (let i = 0; i < 3; i++) amphora(m, 3 + i * 4, 1, 4, i);
    jar(m, 4, 1, 10, 0xd8c8a0, true); jar(m, 9, 1, 9, 0xc8a070); jar(m, 9, 1, 13, 0xb8683e);
    basket(m, 11, 9, 'date', 3);
  } else if (v === 1) {
    // a sack pile on a pallet, two crates beside it
    sackStack(m, 2, 1, 3, 2);
    crate(m, 11, 1, 3, 3, 3, 3, 0xb08850); crate(m, 11, 4, 3, 3, 2, 3, 0xa27c48);
    basket(m, 11, 9, 'orange', 3);
  } else if (v === 2) { mudFence(m, [[0, 7], [15, 7]], 4, { gaps: [[7, 7], [8, 7]] }); amphora(m, 3.5, 1, 10.5, 0); sack(m, 10, 1, 9); }
  else if (v === 3) {
    // a hand cart loaded with linen sacks
    m.box(4, 3, 5, 8, 1, 5, PLANK); m.box(4, 4, 5, 8, 1, 1, PLANK); m.box(4, 4, 9, 8, 1, 1, PLANK);
    wheel(m, 8, 0, 4, 3, 'x'); wheel(m, 8, 0, 10, 3, 'x');
    m.line(12, 3, 7, 15, 1, 7, POLE); sack(m, 4, 4, 6); sack(m, 8, 4, 6); basket(m, 5, 12, 'melon', 3);
  } else if (v === 4) { mudFence(m, [[1, 14], [1, 1], [14, 1]], 4); jar(m, 4, 1, 4, 0xd8c8a0, true); brickStack(m, 8, 1, 3, 5, 3, 4); }
  else if (v === 5) {
    // a heap of grain on a mat with the winnowing baskets round it
    grainHeap(m, 8, 7, 3.4, 5);
    basket(m, 1, 12, 'grain', 3); basket(m, 11, 12, 'date', 3); sack(m, 12, 1, 2);
  } else if (v === 6) {
    woodPile(m, 1, 3, 10); woodPile(m, 7, 3, 10);
    m.line(14, 1, 4, 14, 7, 6, POLE); crate(m, 13, 1, 10, 2, 2, 2);
  } else if (v === 8) {
    // round 36: a quarry pile by the obelisk: dressed blocks stacked in a
    // clear stepped pyramid (pale limestone and warm sandstone alternating,
    // each block one flat tone with a lit top and darker arrises), one more
    // block on two log rollers before it, a mallet leaning on it
    const blk = (x0, y0, z0, w, h, d, c) => {
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) {
        const ex = i === 0 || i === w - 1, ey = j === h - 1, ez = k === 0 || k === d - 1;
        pset(m, x0 + i, y0 + j, z0 + k, ey ? ((ex || ez) ? shade(c, 0.94) : shade(c, 1.06)) : (ex && ez) ? shade(c, 0.8) : c);
      }
    };
    const QL = 0xe6d6b0, QS = 0xb98450;
    blk(1, 1, 2, 4, 3, 6, QL); blk(6, 1, 2, 4, 3, 6, QS); blk(11, 1, 2, 4, 3, 6, QL);
    blk(3, 4, 3, 4, 3, 5, QS); blk(8, 4, 3, 4, 3, 5, QL);
    blk(5, 7, 4, 5, 3, 4, QS);
    // the block on its rollers, the rollers' pale cut ends
    for (const x of [4, 10]) for (let z = 10; z < 15; z++) pset(m, x, 1, z, z === 10 || z === 14 ? ENDGRAIN : 0x5e3f24);
    blk(3, 2, 11, 9, 3, 3, QL);
    // a mallet against it
    m.line(13, 1, 12, 13, 4, 12, POLE); pset(m, 12, 4, 12, 0x6c4a2c); pset(m, 13, 5, 12, 0x6c4a2c); pset(m, 14, 4, 12, 0x6c4a2c);
  } else {
    lathe(m, 7, 7, 1, 4, () => 3.2, LIME, { hollow: 1.2, inner: WATER });
    for (const x of [3, 10]) m.box(x, 1, 6, 1, 9, 1, POLE);
    m.box(3, 10, 6, 8, 1, 1, DARKWOOD); m.box(6, 5, 6, 2, 3, 1, 0x8a6236);
    for (let x = 10; x < 14; x++) for (let z = 10; z < 13; z++) m.set(x, 1, z, x === 10 || x === 13 || z === 10 || z === 12 ? LIME : WATER);
    amphora(m, 3.5, 1, 12.5, 2);
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
      if (a.keep) ext[i * 4 + 3] = u8(a.keep.getX(i));
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
  house: { w: 3, h: 3, variants: ['0', '1', '2', '3', '4', '5'], ages: [1, 2], build: (v, a) => house(v, a) },
  granary: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => granary() },
  lumber_camp: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => lumberCamp() },
  mining_camp: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => miningCamp() },
  farm: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => farm(), stages: false, settle: false, chip: false },
  temple: { w: 5, h: 6, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => temple(['ra', 'isis', 'set'][v]) },
  eg_barracks: { w: 5, h: 5, variants: ['0'], ages: [1], build: () => barracks() },
  migdol: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => migdol() },
  siege_works: { w: 7, h: 7, variants: ['0'], ages: [1], build: () => siegeWorks() },
  armory: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => armory(), fine: 2 },
  market: { w: 4, h: 4, variants: ['0'], ages: [1], build: () => market(), fine: 2 },
  obelisk: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => obelisk(), draw: 1.5, fine: 3, chip: false },
  monument_villagers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(1), fine: 2, chip: false },
  monument_soldiers: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(2), fine: 2, chip: false },
  monument_priests: { w: 2, h: 2, variants: ['0'], ages: [1], build: () => monument(3), fine: 2, chip: false },
  monument_pharaohs: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => monument(4), fine: 2, chip: false },
  monument_gods: { w: 4, h: 4, variants: ['ra', 'isis', 'set'], ages: [1], build: (v) => monument(5, ['ra', 'isis', 'set'][v]), fine: 2, chip: false },
  lighthouse: { w: 3, h: 3, variants: ['0'], ages: [1], build: () => lighthouse(), fine: 2 },
  sentry_tower: { w: 1, h: 1, variants: ['0'], ages: [1], build: () => tower(), draw: 1.5 },
  wonder: { w: 8, h: 8, variants: ['0'], ages: [1], build: () => wonder() },
  palm: { w: 1, h: 1, variants: ['0', '1', '2'], ages: [1], build: (v) => palmProp(v), stages: false, settle: false, chip: false },
  clutter: { w: 2, h: 2, variants: ['0', '1', '2', '3', '4', '5', '6', '7', '8'], ages: [1], build: (v) => clutter(v), stages: false, chip: false },
};

// --preview <type>[:variant] --preview-out <file.json>: dump one model's
// voxels (half-voxel insets included, scaled) as [x, y, z, size, rgb] for a
// quick offline look (no export)
if (argOf('preview', '')) {
  const [pt, pv, pa] = argOf('preview', '').split(':');
  const full = TYPES[pt].build(+(pv || 0), +(pa || 1));
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
  let out = withSkin(S.withExtras(buildVoxelGeometry(m, { size: vox, pivot, jitter: 0.012, seed }), m, vox, pivot, { maxY: m.extraMaxY ?? Infinity }), m, vox, pivot);
  // half-voxel insets (fineFigure): sub-voxel u lands at parent voxel u / k
  for (const f of m.fine || []) out = mergeGeo(out, buildVoxelGeometry(f.m, { size: vox / f.k, pivot: pivot.map((v) => v * f.k), jitter: f.jitter ?? 0.03, seed }));
  // round 36: true gilt (m.keep: voxel-space boxes, e.g. the Obelisk's cap):
  // the gold vertices inside are flagged (extra byte 3), and
  // egypt_building.gdshader lets them skip the display grade's chroma
  // limiter, which otherwise greys any saturated gold to sand
  if (m.keep) {
    const P = out.attributes.position, C = out.attributes.color, keep = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) {
      const vx = P.getX(i) / vox + pivot[0], vy = P.getY(i) / vox + pivot[1], vz = P.getZ(i) / vox + pivot[2];
      const gold = C.getZ(i) < C.getX(i) * 0.06 && C.getY(i) < C.getX(i) * 0.8;
      if (gold && m.keep.some((b) => vx >= b[0] - 0.01 && vx <= b[3] + 0.01 && vy >= b[1] - 0.01 && vy <= b[4] + 0.01 && vz >= b[2] - 0.01 && vz <= b[5] + 0.01)) keep[i] = 1;
    }
    out.setAttribute('keep', new THREE_BufferAttribute(keep, 1));
  }
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
      recourse(full);
      if (T.chip !== false) chip(full);
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
