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
function coursed(tones, { course = 3, len = 6, head = 0.94, bed = 0.84, seed = 41 } = {}) {
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
function brick(tones, { course = 2, len = 6, head = 0.95 } = {}) {
  const seq = [0, 1, 0, 2];
  return (x, y, z) => {
    const row = Math.floor(Math.max(0, y - 1) / course);
    const c = tones[seq[row % 4] % tones.length];
    const u = x + z + (row & 1) * (len >> 1) + 512;
    return head !== 1 && u % len === 0 ? shade(c, head) : c;
  };
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
function grimed(c, x, y, z, r, drips = true) {
  if (r < 0) return c;
  let f = r < GRIME.length ? GRIME[r] : 1;
  const drip = hash3(x, 3, z, 88);
  if (drips && drip < 0.28 && r < 8) f *= 0.86 + r * 0.012;
  return f === 1 ? c : shade(c, f);
}
// a house block on [x0, x1) x [z0, z1) from y0, h wall rows, battered a
// voxel every `batter` rows (registered for skin()); sets m.lastTop to the
// lip ring and the deck (roofParapet() builds on it) and returns the row
// above the deck
function hbox(m, x0, z0, x1, z1, y0, h, { wall = EWHITE, roof = EDECK, batter = 0, grime = true, band = 'lapis', lipC = LIP, rim = true, pRows = 1, cav = true, torus = null } = {}) {
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
  const [gA, gB] = !band ? HGORGE_MUD.slice(1, 3) : band === 'red' ? [BAND_R, BAND_B] : band === 'ochre' ? [BAND_Y, BAND_R] : [BAND_B, BAND_R];
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
function house(v, age) {
  // round 27: every house is a small cube (or two) in clean brick courses,
  // a painted band under a flush parapet with a pale coping and the owner's
  // line, a sunk roof terrace a step darker than the walls, a malqaf
  // (wind-catcher) on most; no overhanging slabs, no lids on piers. Each
  // plan has its own massing and its trade's goods on the ground.
  const m = lot(24, 24);
  const arch = age === 1;
  // round 28: the main cube battered (a voxel in five rows), every block
  // under a cavetto cornice (hbox); the low wings stand plumb
  const white = arch ? { wall: EMUD, roof: THATCH, lipC: MUDCAP, band: null, batter: 5 } : { wall: EWHITE, batter: 5 };
  const mud = arch ? white : { wall: EMUD, band: 'red' };
  const CAP = arch ? MUDCAP : LIME;
  // round 28: doors and windows lie in the wall plane (nothing proud: on a
  // battered wall a projecting lintel or sill pokes through the smooth
  // skin as a pale tooth): the opening cut in, its frame, lintel and sill
  // painted on the face; drawn before the goods so no ray lands on a prop
  const onFace = (face, u, y, c) => { const p = outer(m, face, u, y, lim(m)); if (p) m.set(p[0], p[1], p[2], c); };
  const fdir = (face) => (face === '+z' || face === '-x' ? 1 : -1);
  const dr = (face, u, w, h, open = false) => {
    door(m, face, u, w, 1, h, { deep: 3, leaf: !open, leafShade: 0.45, lintel: false, frame: arch ? MUDCAP_D : HACC, proud: false });
    for (let i = -1; i <= w; i++) onFace(face, u + i * fdir(face), 1 + h + 1, arch ? MUDCAP_D : TEAM);
  };
  const hw = (face, u, y0) => {
    const d = fdir(face);
    for (let k = 0; k < 3; k++) slit(m, face, u + 2 * k * d, y0, 2, 1, { lintel: false, sill: false });
    for (let i = -1; i <= 5; i++) { onFace(face, u + i * d, y0 + 2, arch ? MUDCAP_D : LIME_S); onFace(face, u + i * d, y0 - 1, arch ? MUDCAP_D : LIME_S); }
  };
  const malqaf = (x, z, y, w, d, h, wall) => windCatcher(m, x, z, y, w, d, h, wall);
  if (v === 0) {
    // the weaver's courtyard house: a two-storey cube at the back with a
    // wind-catcher, a low mud-brick wing, a walled court in front with a
    // gate and an upright loom
    const t = hbox(m, 3, 3, 14, 12, 1, 12, white); const T = m.lastTop;
    malqaf(T.c0 + 2, T.d0 + 2, t, 4, 3, 6, white.wall);
    hbox(m, 14, 4, 21, 12, 1, 7, mud);
    dr('+z', 7, 3, 6);
    hw('+z', 7, 9); hw('-x', 7, 8); hw('-z', 7, 8); hw('+z', 17, 4);
    for (let x = 4; x < 21; x++) for (let z = 13; z < 21; z++) m.set(x, 0, z, PAVE);
    yardWall(m, [[3, 13], [3, 21], [21, 21], [21, 13]], 5, white.wall, CAP, [[11, 21], [12, 21], [13, 21]]);
    for (const x of [10, 14]) for (let y = 1; y <= 6; y++) m.set(x, y, 21, y === 1 ? PLINTH : HACC);
    for (let x = 10; x <= 14; x++) { m.set(x, 7, 21, TEAM); m.set(x, 8, 21, CAP); }
    palm(m, 6, 1, 17, 14, { lx: 0, lz: 1, len: 6, fronds: 8 });
    goodsMat(m, 12, 14, 21, 19);
    sack(m, 13, 1, 15); sack(m, 17, 1, 15); basket(m, 8, 16, 'date', 3);
  } else if (v === 1) {
    // the potter's workshop: one deep sandstone cube whose front is a
    // portico cut into it (three painted papyrus columns under the flush
    // band), the wheel and drying bench in its shade; the kiln, amphorae
    // and a woodpile outside
    const o = arch ? white : { wall: ESAND, band: 'lapis' };
    hbox(m, 3, 3, 17, 17, 1, 9, { ...o, batter: 0 });
    for (let x = 4; x < 16; x++) for (let z = 12; z < 17; z++) for (let y = 1; y < 7; y++) m.remove(x, y, z);
    for (let x = 4; x < 16; x++) for (let y = 1; y < 7; y++) m.set(x, y, 11, y > 4 ? REVEAL2 : shade(o.wall(x, y, 11), 0.62));
    for (let x = 4; x < 16; x++) for (let z = 12; z < 17; z++) m.set(x, 0, z, PAVE);
    for (const x of [5, 9, 13]) {
      if (arch) { for (let y = 1; y < 7; y++) for (let i = 0; i < 2; i++) m.set(x + i, y, 15, PALM_T(x, y, 15)); }
      else hcolumn(m, x, 15, 1, 7);
    }
    for (let x = 5; x < 9; x++) for (let z = 12; z < 14; z++) for (let y = 1; y < 3; y++) m.set(x, y, z, PLANK(x, y, z));
    jar(m, 6, 3, 13, 0xc8a070);
    lathe(m, 12, 13, 1, 3, () => 1.2, DARKWOOD); lathe(m, 12, 13, 3, 4, () => 1.8, 0x7a5634); lathe(m, 12, 13, 4, 6, (y) => (y === 4 ? 0.9 : 0.6), CLAY);
    // the kiln: a tall mud-brick beehive with a glowing stoke hole
    const kx = 20.5, kz = 7;
    beehive(m, 20, 7, [3, 3, 3, 3, 3, 3, 2, 2, 2, 1, 1]);
    for (let y = 1; y < 4; y++) { pset(m, 20, y, 10, MOUTH); pset(m, 20, y, 9, REVEAL); }
    pset(m, 20, 1, 9, FIRE[2]); m.get(20, 1, 9).glow = 0.6; pset(m, 20, 2, 9, FIRE[1]); m.get(20, 2, 9).glow = 0.6;
    woodPile(m, 18, 13, 4);
    // the day's firing on a mat: three amphorae a voxel apart, a neat
    // stack of mud bricks for the kiln
    goodsMat(m, 3, 18, 23, 23);
    for (let i = 0; i < 3; i++) amphora(m, 5 + i * 4, 1, 20, i);
    brickStack(m, 16, 1, 19, 6, 3, 4);
  } else if (v === 2) {
    // the farmer's tower house: a tall narrow cube with a wind-catcher, a
    // low mud-brick store against it with a roof terrace; the threshing
    // floor outside: a gold grain heap, linen sacks, a basket
    const t = hbox(m, 3, 4, 12, 13, 1, 15, white); const T = m.lastTop;
    malqaf(T.c0 + 2, T.d0 + 2, t, 4, 3, 7, white.wall);
    hbox(m, 12, 6, 20, 13, 1, 7, { ...mud, pRows: 2 });
    dr('+z', 6, 3, 7);
    hw('+z', 6, 11); hw('-x', 8, 10); hw('-x', 8, 5); hw('-z', 7, 10); hw('+x', 8, 11);
    grainHeap(m, 19, 18.5, 3, 5);
    sackStack(m, 3, 1, 15, 2);
    basket(m, 12, 19, 'grain', 2);
  } else if (v === 3) {
    // the baker's house: a whitewashed cube with a roof terrace shaded by a
    // palm-frond mat on four poles, the bread oven, fuel and baskets of
    // loaves in the yard
    const t = hbox(m, 8, 3, 21, 15, 1, 10, { ...white, pRows: 2 }); const T = m.lastTop;
    // the roof room at the back of the terrace (its doorway onto the
    // terrace), dates drying on a mat in front of it
    hbox(m, T.c0 + 2, T.d0 + 2, T.c0 + 9, T.d0 + 7, t, 5, { ...white, grime: false, band: null });
    dr('+z', 11, 3, 6);
    hw('+z', 16, 6); hw('-x', 7, 6); hw('+x', 8, 6); hw('-z', 13, 6);
    for (const x of [T.c0 + 5, T.c0 + 6]) for (let y = t; y < t + 4; y++) { m.remove(x, y, T.d0 + 6); m.set(x, y, T.d0 + 5, REVEAL); }
    for (let x = T.c1 - 7; x < T.c1 - 3; x++) for (let z = T.d0 + 3; z < T.d0 + 8; z++) m.set(x, t, z, (x === T.c1 - 7 || x === T.c1 - 4 || z === T.d0 + 3 || z === T.d0 + 7) ? FROND_DRY(x, t, z) : PROD.date(x, t, z));
    oven(m, 4, 8);
    woodPile(m, 1, 12, 5);
    goodsMat(m, 2, 18, 13, 23); basket(m, 3, 19, 'date', 3); basket(m, 8, 19, 'grain', 3);
    goodsMat(m, 14, 18, 23, 22); pots(m, 16, 20, 2, 3);
  } else if (v === 4) {
    // the jar merchant: a wide low cube with a wind-catcher at one end, his
    // amphorae in a timber rack and a row of painted storage jars in front
    const t = hbox(m, 2, 4, 22, 13, 1, 8, white); const T = m.lastTop;
    malqaf(T.c1 - 7, T.d0 + 2, t, 4, 3, 6, white.wall);
    dr('+z', 6, 3, 6);
    hw('+x', 8, 4); hw('-x', 8, 4); hw('-z', 7, 4); hw('-z', 16, 4); hw('+z', 15, 4);
    // the amphora rack: two posts and a rail behind three amphorae on a
    // plank sill; two big blue-banded jars on a mat
    for (let x = 12; x < 24; x++) for (const z of [17, 18, 19]) pset(m, x, 0, z, z === 18 ? 0x8e6a42 : 0x6e4e30);
    for (let i = 0; i < 3; i++) amphora(m, 14 + i * 4, 1, 18, i);
    for (const x of [12, 23]) for (let y = 1; y < 8; y++) m.set(x, y, 16, POLE(x, y, 16));
    for (let x = 12; x <= 23; x++) m.set(x, 8, 16, DARKWOOD);
    goodsMat(m, 1, 16, 12, 23);
    jar(m, 3, 1, 19, 0xd8c8a0, true); jar(m, 9, 1, 19, 0xb8683e, true);
  } else {
    // two cubes: a tall white one with a wind-catcher, a low mud-brick one
    // whose terrace is reached by an outside stair; round mud grain bins
    const t = hbox(m, 3, 3, 12, 13, 1, 13, white); const T = m.lastTop;
    malqaf(T.c0 + 3, T.d0 + 2, t, 4, 3, 6, white.wall);
    hbox(m, 12, 5, 21, 14, 1, 7, { ...mud, pRows: 2 }); const U = m.lastTop;
    dr('+z', 6, 3, 7);
    dr('+x', 9, 3, 5, true);
    hw('+z', 6, 9); hw('-x', 7, 9); hw('-z', 7, 9);
    for (let x = U.c1 - 3; x < U.c1; x++) for (let y = U.y; y <= U.y + 2; y++) m.remove(x, y, U.d1 - 1), m.remove(x, y, U.d1 - 2);
    for (let x = U.c1 - 3; x < U.c1; x++) for (const z of [U.d1 - 1, U.d1 - 2]) m.set(x, U.y, z, EDECK(x, U.y, z));
    outStair(m, 12, 14, 2, 8, 1, EMUD, CAP);
    // two square mud grain bins under plastered caps, a stack of mud
    // bricks for the next one, an amphora: each a voxel apart
    for (const X of [4, 10]) {
      for (let r = 0; r < 5; r++) prow(m, X, 1 + r, 19, 2, r === 0 ? 0x7a5636 : r & 1 ? 0x9c7049 : 0x936843, true);
      prow(m, X, 6, 19, 2, 0xc29a6b, true); prow(m, X, 7, 19, 1, 0xcfa97c, true); pset(m, X, 8, 19, 0x6a4a2c);
    }
    brickStack(m, 14, 1, 18, 6, 3, 4); amphora(m, 22, 1, 19, 3);
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
    bands(m, x0, 44, x1, 54, 19, PB);
  }
  for (let x = 24; x < 32; x++) for (let z = 46; z < 52; z++) for (let y = 1; y < 14; y++) m.set(x, y, z, y === 1 ? SAND_D(x, y, z) : SAND(x, y, z));
  for (let x = 23; x < 33; x++) for (let z = 46; z < 53; z++) for (let y = 14; y < 18; y++) m.set(x, y, z, y === 17 ? LIME(x, y, z) : y === 14 ? LIME_S : y === 16 ? TURQ : SAND(x, y, z));
  for (let x = 22; x < 34; x++) for (let z = 45; z < 54; z++) { const e = Math.min(x - 22, 33 - x, z - 45, 53 - z); m.set(x, 18, z, e === 0 ? LIME(x, 18, z) : PLASTER(x, 18, z)); }
  door(m, '+z', 26, 4, 1, 11, { deep: 4, frame: LIME, lintel: false });
  for (let y = 1; y < 11; y++) for (let x = 26; x < 30; x++) m.set(x, y, 47, x === 27 || x === 28 ? REVEAL : shade(DOOR(x, y, 47), 0.5));
  // the flagstaffs against the pylons' fronts, the owner's pennants above the cornices
  banner(m, 17, 1, 54, 30, '+z'); banner(m, 38, 1, 54, 30, '+z');
  paint(m, '+z', 24, 16, ['GG.GGG.GG', '.GGGRGGG.'], { G: GILT, R: RED });
  for (const px of [16, 34]) {
    paint(m, '+z', px + 1, 9, ['.O.', 'OOO', '.O.', 'BOB', 'B.B', 'B.B', 'K.K'], { O: OCHRE, B: TURQ, K: INK });
    paint(m, '+z', px + 5, 9, ['K', '.', 'R', 'K', '.', 'B', 'K'], { K: INK, R: RED, B: TURQ });
  }
  // the sanctuary: three receding tiers, each under its own cornice
  inner(m, (s) => {
    const g = [0x34588a, 0x3f6596];
    const t1 = block(s, 8, 8, 30, 27, 1, 9, { wall: LIME, batter: 6, band: 'red', roofC: PLASTER, lipOut: 2, rimC: LIME, gorge: g });
    const t2 = block(s, 12, 10, 26, 23, t1 - 1, 6, { wall: SAND, batter: 0, band: 'lapis', roofC: PLASTER, lipOut: 2, rimC: LIME, gorge: [RED_M, 0xa8563a] });
    block(s, 15, 12, 23, 20, t2 - 1, 5, { wall: LIME, batter: 0, band: 'team', roofC: PLASTER, lipOut: 1, rimC: LIME, gorge: g, torus: false });
    door(s, '+z', 17, 4, 1, 8, { lattice: true, sun: true, deep: 3, frame: SAND });
    door(s, '+z', 17, 4, t1, 4, { leaf: false, deep: 2, frame: LIME });
    slit(s, '+z', 11, 4, 3, 1); slit(s, '+z', 26, 4, 3, 1); slit(s, '+x', 13, 4, 3, 1); slit(s, '+x', 20, 4, 3, 1);
    // painted reliefs either side of the door: an offering king, a god
    paint(s, '+z', 12, 8, ['.O.', 'OOO', '.O.', 'BOB', 'B.B', 'K.K'], { O: OCHRE, B: LAPIS, K: INK });
    paint(s, '+z', 23, 8, ['.R.', 'OOO', '.O.', 'BOB', 'B.B', 'K.K'], { O: OCHRE, B: TURQ, K: INK, R: RED });
  });
  // the colonnaded hall: a low flat roof on papyrus columns, an ochre back
  // wall, the portico deep in shadow
  inner(m, (s) => {
    const X0 = 34, X1 = 49, Z0 = 8, Z1 = 25, H = 10;
    block(s, 37, Z0, X1, 17, 1, H - 1, { wall: OCHRE_P, batter: 0, band: null, parapet: false, torus: false });
    door(s, '+z', 41, 3, 1, 6, { deep: 2 });
    paint(s, '+z', 38, 7, ['BRB', 'O.O', 'BRB'], { O: OCHRE, B: LAPIS, R: RED });
    paint(s, '+z', 45, 7, ['BRB', 'O.O', 'BRB'], { O: OCHRE, B: LAPIS, R: RED });
    for (const x of [35, 39, 43, 46]) tcColumn(s, x, Z1 - 3, 1, H);
    for (const z of [Z0 + 3, Z0 + 8]) tcColumn(s, X0 + 1, z, 1, H);
    // the architrave: a painted beam round the edge (red / lapis blocks), the
    // gorge flaring a voxel out above it, the mud roof inside a pale lip
    // (round 27: flush, no overhanging slab: the painted architrave, the
    // reed-mat deck sunk inside a two-voxel pale coping)
    const R = bandRows('lapis');
    for (let x = X0; x < X1; x++) for (let z = Z0; z < Z1; z++) {
      const e = Math.min(x - X0, X1 - 1 - x, z - Z0, Z1 - 1 - z);
      s.set(x, H - 1, z, e === 0 ? R[0] : SAND_D(x, H - 1, z));
      s.set(x, H, z, e === 0 ? R[2](x, H, z) : e === 1 ? LIP(x, H, z) : TC_HALLROOF(x, H, z));
      if (e <= 1) s.set(x, H + 1, z, LIP(x, H + 1, z));
    }
  });
  // the granary: a big domed silo at the front left with a ladder and sacks
  // (silo(), ladder() lay mesh polygons on m itself, so not through inner())
  silo(m, 15.5, 36.5, 1, 6, 11);
  ladder(m, [22.6, 1, 38.4], [21.4, 11.6, 37.6]);
  sack(m, 22, 1, 30); sack(m, 22, 1, 34);
  // the small domed silo turret on the front-right corner of the wall
  silo(m, 50.5, 50.5, 1, 3.8, 8);
  // the courtyard: a fire pit, a basin, jars, a palm
  m.box(27, 1, 34, 5, 1, 5, LIME); m.box(28, 1, 35, 3, 1, 3, DARK);
  m.set(29, 2, 36, FIRE[3], FG); m.set(28, 2, 36, FIRE[1], FG); m.set(29, 2, 35, FIRE[2], FG); m.set(30, 2, 37, FIRE[0], FG); m.set(29, 3, 36, FIRE[2], FG);
  for (let x = 31; x < 35; x++) for (let z = 21; z < 25; z++) m.set(x, 1, z, x === 31 || x === 34 || z === 21 || z === 24 ? LIME : WATER);
  goodsBox(m, 42, 1, 38, 4, 3, 'grain'); crate(m, 47, 1, 37, 3, 3, 3); sack(m, 38, 1, 39);
  palm(m, 8, 1, 28, 21, { lx: 0.3, lz: 1, len: 7 });
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
    // round 27: a two-voxel parapet with a pale coping and the owner's
    // line round a sunk mud-plaster deck (no pale lid)
    m.set(x, ay + 5, z, e <= 1 ? LIP(x, ay + 5, z) : EDECK(x, ay + 5, z));
    if (e <= 1) m.set(x, ay + 6, z, e === 1 ? TEAM : LIP(x, ay + 6, z));
  }
  void ROOFDECK;
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
  const RNG = { wall: OCHRE_P, rimC: LIME, gorge: [0x34588a, 0x3f6596], torus: false, lipOut: 2, batter: 5, band: null };
  const tb = block(m, 2, 2, 38, 14, 1, 12, RNG);
  const tw = block(m, 2, 13, 12, 36, 1, 11, RNG);
  const te = block(m, 30, 13, 38, 28, 1, 9, RNG);
  barracksRoofs(m, tb, tw, te);
  // the raised gatehouse in the middle of the back range
  const tg = block(m, 14, 6, 27, 17, 1, 16, { wall: LIME, roofC: ROOFTILE, rimC: LIME, gorge: [0x34588a, 0x3f6596], lipOut: 2, batter: 5, band: 'lapis', frieze: 1 });
  block(m, 17, 8, 24, 14, tg - 1, 4, { batter: 0, band: null });
  door(m, '+z', 18, 5, 1, 9, { lattice: true, sun: false, deep: 3 });
  // the yard's front: a pylon gateway (two battered pylons, a gate block
  // between them under a lintel with a cavetto cornice and a gilt winged sun,
  // heavy cedar double doors with bronze straps set in the doorway)
  const PY = { wall: OCHRE_P, rimC: LIME, gorge: [0x34588a, 0x3f6596], torus: false, lipOut: 2, batter: 7, band: 'red' };
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
  block(m, 30, 27, 38, 32, 1, 9, { wall: OCHRE_P, rimC: LIME, gorge: [0x34588a, 0x3f6596], torus: false, lipOut: 2, batter: 5, band: null });
  // the gate block: limestone, its own cornice (the lintel's cavetto) a step
  // below the pylons' tops
  block(m, 15, 32, 26, 38, 1, 18, { wall: LIME, roofC: ROOFTILE, rimC: LIME, gorge: [0x34588a, 0x3f6596], lipOut: 2, batter: 0, band: 'lapis' });
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
  const CL = { wall: OCHRE_P, rimC: LIME, gorge: [0x34588a, 0x3f6596], torus: false, band: null, plinth: false, socle: 0, rim: false, cornice: false };
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
function pylon(m, x0, z0, x1, z1, h, { wall = SAND, b = 9, band = 'team', gorge = [GORGE, GORGE_L], lipOut = 2, roofC = PLASTER, frieze = 0 } = {}) {
  block(m, x0, z0, x1, z1, 1, h, { wall, batter: b, band, lipOut, flare: true, gorge, torus: true, rimC: LIME, roofC, frieze, style: 'cornice' });
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
    // round 27: a two-voxel parapet with a pale coping round a sunk deck
    if (e <= 1) { m.set(x, T.y, z, LIME); m.set(x, T.y + 1, z, LIP); }
    else if (e === 2) m.set(x, T.y, z, LIME_S);
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
  return { pose: o.pose ?? 'stride', head, crown, arms, god, kilt: o.kilt === undefined || o.kilt === BASALT ? GRAN : CG, kiltFront: o.kiltFront === undefined ? TEAMB : o.kiltFront };
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
  const stripe = o.wig === 'gold' ? (x, y) => ((y - kn) & 1 ? CG_D : CG) : (x, y) => ((y - kn) & 1 ? LAPIS_S : CG);

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
      B(-hw, hw, y, y + 1, -4, zf, (x) => (y === 21 ? KD : ((x - (y >> 1) + 64) % 4 === 0 ? KD : KL)));
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
    const c = d < r[0] || d >= r[5] ? null : d < r[1] ? CG_L : d < r[2] ? LAPIS_S : d < r[3] ? CG : d < r[4] ? LAPIS_S : ((x + 64) & 1 ? CG_L : CG_D);
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
    for (let x = 7; x < 19; x++) {
      const top = Math.round(yArm(Math.min(x, 16))) + (x < 9 ? 1 : 2);
      const bot = Math.round(9 + (x - 6) * 0.25) - ((x & 1) ? 0 : 1);
      for (let y = bot; y <= top; y++) for (const z of [-2, -1]) {
        const d = top - y;
        const c = d === 0 ? CG_L : d <= 3 ? ((d === 2 && (x & 1)) ? CG_L : ST_LAPIS) : d === 4 ? CG_L : y === bot ? CG_D : ((x - 6) % 3 === 2 ? CG_D : CG);
        P(x, y + kn, z, c);
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
    // a face that reads from the RTS camera: a lighter face plane, a nose
    // ridge a voxel proud, lapis brows, ivory eyes with dark pupils and the
    // kohl line running out to the temples, a dark mouth line
    S(4, 38 + kn, 46 + kn, -3, 4, (x, y, z) => (z === 3 ? GRAN_F : GRAN));
    B(-1, 1, 41 + kn, 45 + kn, 4, 5, GRAN_F);                  // the nose ridge
    B(-1, 1, 41 + kn, 42 + kn, 4, 5, GRAN);                    // its tip
    M(1, 4, 45 + kn, 46 + kn, 3, 4, o.god ? CG_L : LAPIS_S);   // the brows (a goddess': gold)
    M(1, 3, 43 + kn, 44 + kn, 3, 4, IVORY);                    // the eyes
    M(1, 2, 43 + kn, 44 + kn, 3, 4, KOHL);                     // pupils
    M(3, 4, 43 + kn, 44 + kn, 3, 4, o.god ? CG_L : LAPIS_S);   // the kohl line
    B(-2, 2, 39 + kn, 40 + kn, 3, 4, GRAN_D);                  // the mouth
    if (o.god) {
      // a goddess' face that reads at RTS zoom: the eye whites two rows
      // deep under gold brows, the lips a short warm line
      M(1, 3, 44 + kn, 45 + kn, 3, 4, IVORY);
      M(1, 2, 44 + kn, 45 + kn, 3, 4, KOHL);
      B(-1, 1, 39 + kn, 40 + kn, 3, 4, 0x4a2420);
    }
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
    S(3, 38 + Y, 40 + Y, -3, 3, SG);                           // the throat
    S(4, 40 + Y, 46 + Y, -3, 4, SG);                           // the head
    S(3, 46 + Y, 47 + Y, -2, 3, SG_L);                         // the domed crown
    S(2, 47 + Y, 48 + Y, -1, 2, SG_L);
    // the beak: a diagonal hook, each step a voxel further out and a
    // voxel lower, three rows deep at the root and one at the tip
    // (horn-brown, so it reads apart from the black eyes and stripes)
    const HORN = 0x4e3a22;
    B(-1, 1, 42 + Y, 45 + Y, 4, 5, HORN);                      // the root
    B(-1, 1, 44 + Y, 45 + Y, 4, 5, IVORY);                     // the cere
    B(-1, 1, 41 + Y, 44 + Y, 5, 6, HORN);
    B(-1, 1, 40 + Y, 42 + Y, 6, 7, GRAN_D);
    B(-1, 1, 39 + Y, 40 + Y, 6, 7, GRAN_D);                    // the hooked tip
    B(-1, 1, 41 + Y, 42 + Y, 4, 5, CG_D);                      // the gape under it
    M(2, 3, 43 + Y, 45 + Y, 3, 4, GRAN_D);                     // the eyes, front
    M(2, 3, 44 + Y, 45 + Y, 3, 4, IVORY);                      // glints
    M(3, 4, 43 + Y, 45 + Y, 2, 3, GRAN_D);                     // and round the side
    M(2, 4, 45 + Y, 46 + Y, 3, 4, SG_L);                       // gold brows
    M(2, 3, 41 + Y, 43 + Y, 3, 4, GRAN_D);                     // the malar stripe, a teardrop
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
  // the gods (round 18) in a lighter blue-grey slate with a real mid-tone
  // between the near-black recesses and the gold, so their forms read
  if (o.god) for (const [x, y, z] of touched) {
    const v = m.get(x, y, z), c = v && GOD_SLATE.get(v.c);
    if (c !== undefined) v.c = c;
  }
}
// (blue-grey: anything with green in it turns olive under the warm light)
const GOD_SLATE = new Map([
  [0x1b1f26, 0x1f2432], [0x2a3039, 0x353d50], [0x30363f, 0x3d465a], [0x262b33, 0x2f3646],
  [0x4b5563, 0x58637a], [0x343d47, 0x4b556c], [0x1c2027, 0x151820],
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
function monument(kind, god = 'ra') {
  if (kind <= 3) {
    const m = lot(32, 32, EARTH);
    const py = monPlinth(m, 6, 6, 26, 26, 1, 14, { seed: kind });
    const pd = monDie(m, 9, 9, 23, 23, py, 2);
    const o = [
      null,
      { pose: 'kneel', arms: 'pots', head: 'nemes', kiltFront: null },
      { pose: 'mummy', arms: 'crossed', head: 'double' },
      { pose: 'stride', arms: 'side', head: 'nemes', kilt: CG, anklets: 1, pillar: [-6, 6, 38] },
    ][kind];
    cleanStatue(m, 16, pd, kind === 1 ? 17 : 15, o);
    return m;
  }
  if (kind === 4) {
    const m = lot(48, 48, EARTH);
    const py = monPlinth(m, 5, 6, 43, 42, 1, 14, { faces: { '+z': 'cart2', '-z': 'cart2' }, seed: 4 });
    const pd = monDie(m, 9, 11, 39, 37, py, 3);
    // building_16: the king striding, fists at his sides, in the nemes and a
    // gold white crown; the queen in a gold sheath dress and vulture wig, her
    // near hand on his arm; one back pillar joining them
    cleanStatue(m, 15, pd, 24, { pose: 'stride', head: 'nemes', crown: 'hedjet', arms: 'side', kilt: CG, anklets: 1, pillar: [-6, 25, 38] });
    cleanStatue(m, 34, pd, 24, { pose: 'dress', head: 'wig', wig: 'gold', arms: 'embrace', kiltFront: null });
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
  cleanStatue(sub, 24, Math.round(pd * k), 23, toClean({ kilt: GILT, ...G }));
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

// Armory (4 x 4; building_18), round 19: ONE smithy. A continuous battered
// mud-brick hall (the main body) under a curved cavetto painted in lapis /
// red / ochre leaves over an ochre torus roll, a bright team band and a frieze
// under it, a whitewashed attic on its roof (Retold's stepped roof); the
// forge shed is an L of the same brick off its east end (a back wall and a
// pier), a timber lean-to seated on a ledger pegged to the hall's wall and on
// the pier's coping, a striped cloth laid on the rafters; the furnace is
// built against the hall's front, its stone chimney rising up the wall
// through the cornice and over the roof. The forge's parts stand apart at RTS
// zoom: a glowing hearth under the lean-to, a steel anvil on a stump, a stone
// quench trough of water. Each material has its own texture and value: brick
// (mid red-brown, big bricks, dark mortar), whitewash (pale, smooth), stone
// (pale grey ashlar, sooted up the stack), wood (dark brown, grain).
const FBRICK = (x, y, z) => {
  const row = Math.floor(Math.max(0, y - 1) / 3);
  const u = x + z + (row & 1) * 3 + 256;
  const blk = Math.floor(u / 6);
  let c = pick(hash3(blk, row, (x - z) >> 3, 301), [0xb08356, 0xa77b50, 0xb88b5c]);
  if ((y - 1) % 3 === 0) c = shade(c, 0.66);
  else if (u % 6 === 0) c = shade(c, 0.7);
  return c;
};
const PLAST_W = (x, y, z) => shade(hash3(x >> 2, y >> 2, z >> 2, 302) < 0.5 ? 0xefe4cc : 0xebdfc5, 0.995 + 0.01 * hash3(x, y, z, 303));
const STONE_F = (x, y, z) => {
  const row = Math.floor(Math.max(0, y - 1) / 4);
  const u = x + z + (row & 1) * 3 + 256;
  let c = pick(hash3(Math.floor(u / 5), row, 7, 304), [0xd6cdb9, 0xcbc1ab, 0xdfd6c4]);
  if ((y - 1) % 4 === 0) c = shade(c, 0.8);
  else if (u % 5 === 0) c = shade(c, 0.84);
  if (y > 15) c = shade(c, Math.max(0.42, 1 - (y - 15) * 0.07));   // soot up the stack
  return c;
};
const WOODG = (x, y, z) => pick(hash3(x >> 2, y, z, 305), [0x6a4428, 0x5c3b22, 0x734a2c]);
const ANVIL = 0x3a3e42, ANVIL_T = 0x6c7278;
const CAV = [BLUEP, BLUEP, 0xf2e8d0, RED_B, RED_B, 0xf2e8d0, OCHRE_B, OCHRE_B, 0xf2e8d0];
function armory() {
  const m = lot(32, 32);
  patch(m, 18, 6, 31, 27, EARTH, { seed: 4 });
  // the hall: one battered brick body, the cornice as a curved painted cavetto
  // over a torus (skin()), the voxel gorge rows outside the wall cut away
  const h = 14, b = 5, lipOut = 2;
  block(m, 2, 3, 21, 17, 1, h, { wall: FBRICK, batter: b, band: 'teamb', frieze: 0, lipOut, flare: true, gorge: [LAPIS, RED_M], torus: true, rimC: LIME, roofC: PLASTER });
  const B = m.blocks[m.blocks.length - 1];
  B.cav = { lipOut, gorge: CAV, lift: 2.0 }; B.roll = OCHRE_M; B.skip = { '+z': [6, 10] };
  const top = 1 + h, K = Math.floor((h - 1) / b);
  const a0 = 2 + K, a1 = 21 - K, b0 = 3 + K, b1 = 17 - K;
  for (let y = top; y <= top + 1; y++) for (let x = a0 - lipOut; x < a1 + lipOut; x++) for (let z = b0 - lipOut; z < b1 + lipOut; z++) {
    if (x < a0 || x >= a1 || z < b0 || z >= b1) m.remove(x, y, z);
  }
  // the roof: a pale lip with a parapet, a shadowed line inside, a plaster deck (no team outline)
  const T = m.lastTop;
  for (let x = T.c0; x < T.c1; x++) for (let z = T.d0; z < T.d1; z++) {
    const e = Math.min(x - T.c0, T.c1 - 1 - x, z - T.d0, T.d1 - 1 - z);
    // the coping painted as the cornice's top: a continuous band of lapis /
    // red / ochre leaves, the pale lip outside it (no team outline on the roof)
    if (e === 0) m.set(x, T.y, z, LIP);
    else if (e === 1) m.set(x, T.y, z, [BLUEP, BLUEP, BLUEP, RED_B, RED_B, RED_B, OCHRE_B, OCHRE_B, OCHRE_B][(x + z) % 9]);
    else if (e === 2) m.set(x, T.y, z, LIME_S);
  }
  // the whitewashed attic on the roof's west half, its own small cornice
  block(m, 3, 4, 12, 12, T.y, 5, { wall: PLAST_W, batter: 0, band: 'ochre', frieze: 0, lipOut: 1, rimC: LIME, roofC: PLASTER, rim: false, plinth: false });
  door(m, '+z', 13, 3, 1, 7, { sun: true });
  slit(m, '+z', 17, 8, 3, 1);
  // the forge shed: a back wall and a pier in the same brick, one L with the hall
  const shed = { wall: FBRICK, batter: 4, band: 'ochre', frieze: 0, lipOut: 1, gorge: [0x963f2a, 0xa5492f], rimC: LIME, roofC: MUDROOF, rim: false };
  block(m, 19, 3, 30, 7, 1, 8, shed);
  block(m, 26, 6, 30, 18, 1, 8, shed);
  // the lean-to: a ledger beam pegged along the hall's east wall, rafters
  // from it down onto the pier's coping (y 10), the cloth laid on them
  const ry = (x) => (x >= 26 ? 11 : Math.round(13 - ((x - 19) * 2) / 7));
  for (let z = 7; z < 19; z++) m.set(19, 12, z, WOODG);
  for (const z of [8, 11, 14, 17]) for (let x = 19; x < 30; x++) m.set(x, ry(x), z, DARKWOOD);
  for (let x = 20; x < 29; x++) for (let z = 10; z < 19; z++) {
    if (z === 11 || z === 14 || z === 17) { m.set(x, ry(x) + 1, z, (z & 1) ? 0x5f6a8a : 0xd8ccb0); continue; }
    m.set(x, ry(x) + 1, z, ((z >> 1) & 1) ? 0xd8ccb0 : 0x5f6a8a);
  }
  for (let x = 20; x < 26; x += 2) m.set(x, ry(x), 18, 0x5f6a8a);   // the front hem
  // the hearth under the lean-to: a stone kerb round glowing coals, bellows
  for (let x = 21; x < 26; x++) for (let z = 9; z < 15; z++) {
    const kerb = x === 21 || x === 25 || z === 9 || z === 14;
    if (kerb) m.set(x, 1, z, STONE_F); else if (hash3(x, 1, z, 306) < 0.45) m.set(x, 1, z, hash3(x, 2, z, 307) < 0.5 ? FIRE[1] : FIRE[2], { glow: 0.5 }); else m.set(x, 1, z, 0x2a1a12);
  }
  m.box(22, 1, 7, 3, 2, 2, 0x6e4a30); m.set(23, 3, 7, WOODG); m.set(23, 1, 9, DARKWOOD);
  // the anvil: a dark stump, a steel body with a bright face and a horn
  m.box(21, 1, 18, 2, 2, 2, WOODG);
  for (let x = 20; x < 24; x++) for (let z = 18; z < 20; z++) m.set(x, 3, z, ANVIL);
  for (let x = 20; x < 24; x++) for (let z = 18; z < 20; z++) m.set(x, 4, z, ANVIL_T);
  m.set(24, 4, 18, ANVIL_T); m.set(24, 4, 19, ANVIL_T);
  m.set(23, 1, 20, DARKWOOD); m.set(23, 2, 20, DARKWOOD); m.set(23, 3, 20, ANVIL);   // a hammer leaning on it
  // the quench trough: a limestone box of water before the shed
  for (let x = 25; x < 31; x++) for (let z = 19; z < 23; z++) for (let y = 1; y < 3; y++) {
    const rim = x === 25 || x === 30 || z === 19 || z === 22;
    m.set(x, y, z, rim || y === 1 ? STONE_F : WATER);
  }
  // the furnace against the hall's front, its chimney up the wall and over the roof
  for (let x = 4; x < 12; x++) for (let z = 14; z < 22; z++) for (let y = 1; y < 6; y++) m.set(x, y, z, y === 5 ? LIME : STONE_F);
  for (let x = 6; x < 10; x++) for (let z = 14; z < 20; z++) for (let y = 6; y < 22; y++) {
    const edge = x === 6 || x === 9 || z === 16 || z === 19;
    if (z < 16) { m.set(x, y, z, STONE_F); continue; }
    if (!edge && y === 21) continue;
    m.set(x, y, z, !edge && y === 20 ? FIRE[0] : edge ? (y === 21 ? 0x3a3330 : STONE_F) : DARK, !edge && y === 20 ? { glow: 0.3 } : undefined);
  }
  // the fire mouth: cut two voxels into the front under a limestone lintel, coals glowing
  for (let x = 6; x < 10; x++) for (let y = 1; y < 4; y++) { m.remove(x, y, 21); m.set(x, y, 20, y === 1 ? FIRE[1] : FIRE[0], { glow: y === 1 ? 0.5 : 0.25 }); }
  for (let x = 5; x < 11; x++) m.set(x, 4, 21, LIME);
  // a bold gilt ankh on a limestone step by the furnace
  m.box(0, 1, 23, 5, 1, 3, LIME);
  for (let y = 2; y < 6; y++) for (let z = 24; z < 26; z++) m.set(2, y, z, GILT);
  for (let x = 0; x < 5; x++) for (let z = 24; z < 26; z++) m.set(x, 6, z, GILT);
  for (const [x, y] of [[1, 7], [3, 7], [1, 8], [3, 8], [2, 9]]) for (let z = 24; z < 26; z++) m.set(x, y, z, GILT);
  shield(m, '+z', 27, 3);
  barrel(m, 21.5, 1, 23.5); crate(m, 27, 1, 24, 3, 3, 3); crate(m, 1, 1, 19, 2, 2, 2);
  return m;
}

// Market (4 x 4; building_19): a long battered hall with an ochre band and a
// projecting door portal, a stone pier, and the market's colour: three stalls
// of bright team / white striped awnings over counters of produce, with
// baskets, jars, crates and sacks spilling into the street.
function market() {
  const m = lot(32, 32);
  patch(m, 1, 16, 31, 31, PAVE, { seed: 2 });
  block(m, 2, 2, 24, 15, 1, 14, { wall: LIME, roofC: HROOF_C, rimC: LIME, gorge: [GORGE, GORGE_L], lipOut: 2, flare: true, batter: 6, band: 'red', frieze: 1 });
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
    if (e === 0) m.set(x, py + 2, z, LIME(x, py + 2, z));
  }
  slit(m, '+x', 5, 9, 3, 1); slit(m, '+x', 10, 9, 3, 1);
  block(m, 24, 15, 29, 21, 1, 12, { wall: OCHRE_W, batter: 0, band: 'lapis', rim: false, rimC: LIME, roofC: HROOF_C, gorge: [0x963f2a, 0xa5492f] });
  banner(m, 18, 22, 20, 8, "+z");   // the owner's pennant on the portico roof
  const counter = (x0, x1, z0, z1, goods) => {
    for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) for (let y = 1; y < 4; y++) m.set(x, y, z, (x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1) ? PLANK(x, y, z) : DARKWOOD);
    const n = goods.length;
    goods.forEach((g, i) => { const a = x0 + Math.round(((x1 - x0) * i) / n), b = x0 + Math.round(((x1 - x0) * (i + 1)) / n); goodsBox(m, a, 4, z0, b - a, z1 - z0, g, 1, 0x7a5430); });
  };
  // the stalls' canopies: flat cloths on thin poles at chest height (a
  // voxel of sag, a hem along the front), the goods under them in view;
  // each stall its own dyed linen (madder red, a woad green, saffron), so
  // no stall repeats the next and none is the houses' or the owner's blue
  const MRED = [0xb0482e, 0xa8432a, 0xb84f33], MGRN = [0x4f8a5a, 0x4a8455, 0x56925f], MSAF = [0xd69a36, 0xce9230, 0xdca23e];
  const canopy = { stripes: [MRED, CANVAS], sw: 2, sag: 0.6, belly: 0.3, hem: 0x7e3020 };
  // stall 1: the front left, from the hall's front wall
  clothAwning(m, '+z', 13, 1, 8, 8, 13, 1.5, { ...canopy, posts: [1, 7] });
  counter(2, 9, 23, 27, ['orange', 'melon']);
  // stall 2: the front right, from the pier
  clothAwning(m, '+z', 20, 16, 30, 8, 9, 1.5, { ...canopy, stripes: [MGRN, CANVAS], hem: 0x2f5a38, posts: [16, 22, 29] });
  counter(17, 28, 25, 28, ['green', 'date', 'fish']);
  // stall 3: on the east side, from the hall's east wall
  clothAwning(m, '+x', 22, 3, 14, 8, 9, 1.5, { ...canopy, stripes: [MSAF, CANVAS], hem: 0x9a6a20, posts: [3, 13] });
  counter(25, 30, 4, 13, ['grain', 'date']);
  jar(m, 14.5, 1, 21.5, 0xc8a070, true); basket(m, 0, 21, 'orange');
  return m;
}

// Lighthouse (3 x 3; building_20, Mythic; round 21): the Pharos in three
// crisp stages on a dark plinth course. The square shaft tapers all the way
// up in four 7-row tiers (a voxel in per side each tier, a pale limestone
// string course on every ledge), each face framed by pale corner piers and
// a centre pilaster with warm sandstone panels between them, the masonry
// banded in courses of four tones (every three rows a lighter or darker
// course), slit windows framed by a lintel and sill in every panel, two team
// bands at the foot, a stair to a framed door. On top a gallery slab with a
// crenellated parapet and corner posts; the octagonal stage (true diagonal
// facets, pale arrises, a team band, a window on each flat face) under its
// own overhanging slab and crenellated parapet; a round drum, then the
// colonnaded lantern: eight slim columns round a bright emissive fire on a
// pale floor, an entablature and one ribbed pointed cap with a gilt finial.
// Every part rests on the one below (no stubs). Fire bowls at the foot.
const PHAROS_T = [0xe6cd9c, 0xd2b482, 0xdcc190, 0xc6a672];
const PHAROS = (x, y, z) => {
  const row = Math.floor(Math.max(0, y - 1) / 3);
  const seq = [0, 1, 2, 1, 0, 3];
  const u = x + z + (row & 1) * 3 + 256;
  let c = PHAROS_T[seq[row % seq.length]];
  c = shade(c, 0.975 + 0.05 * hash3(Math.floor(u / 6), row, (x - z) >> 3, 211));
  if ((y - 1) % 3 === 0) c = shade(c, 0.9);
  else if (u % 6 === 0) c = shade(c, 0.92);
  return c;
};
const PIER = (x, y, z) => { const c = LIME(x, y, z); return (y - 1) % 3 === 0 ? shade(c, 0.95) : c; };
// the beacon: glow 0.95 marks a fire voxel, which egypt_building.gdshader
// passes through the grade in its own colour (yellow core, orange, embers)
const BEACON = [0xffd040, 0xffa020, 0xf07010, 0xc84808];
function lighthouse() {
  const m = lot(24, 24);
  const C = 12;
  // the plinth course: three rows of dark stone, a voxel out from the shaft
  for (let x = C - 9; x < C + 9; x++) for (let z = C - 9; z < C + 9; z++) for (let y = 1; y < 4; y++) m.set(x, y, z, PLINTH);
  // the shaft: tiers of 7 rows, half-width 7, 6, 5, 4 (+1 for the piers)
  const T0 = 4, TH = 7, tiers = [7, 6, 5, 4];
  const top = T0 + TH * tiers.length;          // the gallery slab row
  const isPier = (a, hw) => a < -hw + 2 || a >= hw - 2;
  const isPil = (a, hw, y, front) => (a === -1 || a === 0) && !(front && y < T0 + 9);
  const slits = [];
  tiers.forEach((hw, ti) => {
    const y0 = T0 + ti * TH;
    for (let y = y0; y < y0 + TH; y++) {
      const coping = y === y0 + TH - 1;
      const team = y === 5 || y === 7;
      for (let x = C - hw - 1; x < C + hw + 1; x++) for (let z = C - hw - 1; z < C + hw + 1; z++) {
        const ox = x < C - hw || x >= C + hw, oz = z < C - hw || z >= C + hw;
        const ax = x - C, az = z - C;
        let c = null;
        if (!ox && !oz) {
          const e = Math.min(x - (C - hw), C + hw - 1 - x, z - (C - hw), C + hw - 1 - z);
          c = e > 0 ? SAND_D : PHAROS;
        } else if (ox && oz) c = PIER;                                       // the corner arris of the pier
        else {
          const a = ox ? az : ax;                                            // along the face
          const front = oz && z >= C + hw;
          if (isPier(a, hw)) c = PIER;
          else if (isPil(a, hw, y, front)) c = PIER;
          else continue;                                                     // the panel stays recessed
        }
        if (coping) c = LIME;
        if (team && (ox || oz || Math.min(x - (C - hw), C + hw - 1 - x, z - (C - hw), C + hw - 1 - z) === 0)) c = TEAM;
        m.set(x, y, z, c);
      }
    }
    // a slit window in each panel, mid-tier
    const sa = hw >= 5 ? [-3, 2] : [-2, 1];
    for (const a of sa) slits.push([hw, a, y0 + 2]);
  });
  for (const [hw, a, y0] of slits) for (const face of ['+z', '-z', '+x', '-x']) {
    if (face === '+z' && y0 < T0 + 9) continue;          // the door's tier
    const n = OUT_N[face];
    const cell = (k) => face[1] === 'z' ? [C + a, C + (n[2] > 0 ? hw - 1 - k : -hw + k)] : [C + (n[0] > 0 ? hw - 1 - k : -hw + k), C + a];
    const [fx, fz] = cell(0), [bx, bz] = cell(1);
    for (let y = y0; y < y0 + 3; y++) { m.remove(fx, y, fz); m.set(bx, y, bz, y === y0 + 2 ? REVEAL2 : REVEAL); }
    m.set(fx, y0 + 3, fz, LIME); m.set(fx, y0 - 1, fz, LIME_S);
  }
  door(m, '+z', 10, 4, T0, 6);
  for (let s = 0; s < 3; s++) m.box(10, 1, 21 + s, 4, 3 - s, 1, LIME);
  // the gallery: a slab a voxel over the top tier's piers, a crenellated
  // parapet on its edge (a low wall, merlons on alternate voxels), corner posts
  const G = 6;
  for (let x = C - G; x < C + G; x++) for (let z = C - G; z < C + G; z++) {
    const e = Math.min(x - (C - G), C + G - 1 - x, z - (C - G), C + G - 1 - z);
    m.set(x, top, z, e === 0 ? LIME_S : e === 1 ? TEAM : LIME);
    if (e !== 0) continue;
    m.set(x, top + 1, z, PIER);
    const corner = (x === C - G || x === C + G - 1) && (z === C - G || z === C + G - 1);
    if (corner) { m.box(x, top + 2, z, 1, 3, 1, PIER); m.set(x, top + 5, z, GILT); }
    else if (((x + z) & 1) === 0) m.set(x, top + 2, z, PIER);
  }
  // the octagonal stage: half-width 4, the corners cut on the diagonal
  const inOct = (x, z, R, L) => { const dx = Math.abs(x + 0.5 - C), dz = Math.abs(z + 0.5 - C); return dx < R && dz < R && dx + dz <= L; };
  const o0 = top + 1, OH = 8, o1 = o0 + OH;
  for (let y = o0; y < o1; y++) for (let x = C - 4; x < C + 4; x++) for (let z = C - 4; z < C + 4; z++) {
    if (!inOct(x, z, 4, 5.5)) continue;
    const edge = !inOct(x + 1, z, 4, 5.5) || !inOct(x - 1, z, 4, 5.5) || !inOct(x, z + 1, 4, 5.5) || !inOct(x, z - 1, 4, 5.5);
    const diag = Math.abs(x + 0.5 - C) + Math.abs(z + 0.5 - C) === 5;   // the diagonal facets' arrises
    let c = !edge ? SAND_D : diag ? PIER : PHAROS;
    if (y === o0 + 1 && edge) c = TEAM;
    if (y === o1 - 1 && edge) c = LIME;
    m.set(x, y, z, c);
  }
  // a window on each flat face of the octagon (two voxels wide, four tall, under a lintel)
  for (const face of ['+z', '-z', '+x', '-x']) {
    const n = OUT_N[face];
    for (const a of [-1, 0]) {
      const at = (k) => face[1] === 'z' ? [C + a, C + (n[2] > 0 ? 3 - k : -4 + k)] : [C + (n[0] > 0 ? 3 - k : -4 + k), C + a];
      const [fx, fz] = at(0), [bx, bz] = at(1);
      for (let y = o0 + 2; y < o0 + 6; y++) { m.remove(fx, y, fz); m.set(bx, y, bz, y === o0 + 5 ? REVEAL2 : REVEAL); }
      m.set(fx, o0 + 6, fz, LIME);
    }
  }
  // its slab (a voxel out, the same octagon) and crenellated parapet
  const inO5 = (x, z) => inOct(x, z, 5, 7.5);
  for (let x = C - 5; x < C + 5; x++) for (let z = C - 5; z < C + 5; z++) {
    if (!inO5(x, z)) continue;
    const edge = !inO5(x + 1, z) || !inO5(x - 1, z) || !inO5(x, z + 1) || !inO5(x, z - 1);
    m.set(x, o1, z, edge ? LIME_S : LIME);
    if (!edge) continue;
    m.set(x, o1 + 1, z, PIER);
    if (((x + z) & 1) === 0) m.set(x, o1 + 2, z, PIER);
  }
  // the drum, the lantern floor
  const d0 = o1 + 1;
  lathe(m, C, C, d0, d0 + 2, () => 2.9, (x, y, z) => (y === d0 ? TEAM : PHAROS(x, y, z)));
  lathe(m, C, C, d0 + 2, d0 + 3, () => 3.4, (x, y, z) => { const d = Math.hypot(x + 0.5 - C, z + 0.5 - C); return d > 2.9 ? LIME_S : LIME; });
  // the colonnade: eight slim columns (base, shaft, capital) round the fire
  const L0 = d0 + 3, LH = 6;
  const cols = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cols.push([sx * 2.5, sz * 1.5], [sx * 1.5, sz * 2.5]);
  for (const [dx, dz] of cols) {
    const x = Math.floor(C + dx), z = Math.floor(C + dz);
    for (let y = L0; y < L0 + LH; y++) m.set(x, y, z, y === L0 + LH - 1 ? GILT_D : y === L0 ? LIME_S : 0xf3ead6);
  }
  // the fire: a bright emissive core (the beacon) on a bed of embers
  for (let x = C - 2; x < C + 2; x++) for (let z = C - 2; z < C + 2; z++) {
    const dx = Math.abs(x + 0.5 - C), dz = Math.abs(z + 0.5 - C);
    if (dx > 1.5 || dz > 1.5) continue;
    const core = dx < 1 && dz < 1;
    m.set(x, L0, z, core ? BEACON[2] : BEACON[3], { glow: 0.95 });
    m.set(x, L0 + 1, z, core ? BEACON[0] : BEACON[1], { glow: 0.95 });
    m.set(x, L0 + 2, z, core ? BEACON[0] : BEACON[1], { glow: 0.95 });
    if (core) { m.set(x, L0 + 3, z, BEACON[0], { glow: 0.95 }); m.set(x, L0 + 4, z, BEACON[1], { glow: 0.95 }); }
  }
  // the entablature, the cornice, one ribbed pointed cap, the finial
  const E = L0 + LH;
  lathe(m, C, C, E, E + 1, () => 3.3, (x, y, z) => (Math.hypot(x + 0.5 - C, z + 0.5 - C) > 2.6 ? LIME_S : LIME(x, y, z)));
  for (let x = C - 4; x < C + 4; x++) for (let z = C - 4; z < C + 4; z++) if (inOct(x, z, 4, 5.5)) m.set(x, E + 1, z, inOct(x, z, 3, 4) ? LIME(x, E + 1, z) : PIER);
  // the cap: concentric octagons a voxel in per row, ribbed light / shadow
  // on the diagonal facets, then a gilt point
  const RIB = (x, y, z) => { const dx = Math.abs(x + 0.5 - C), dz = Math.abs(z + 0.5 - C); return Math.abs(dx - dz) < 1.1 ? 0xcfc2a4 : 0xebe2cc; };
  [[4, 5.5], [3, 4], [2, 2.5]].forEach(([R, L], i) => {
    for (let x = C - R; x < C + R; x++) for (let z = C - R; z < C + R; z++) if (inOct(x, z, R, L)) m.set(x, E + 2 + i, z, RIB);
  });
  m.box(C - 1, E + 5, C - 1, 2, 1, 2, 0xd8ccb0);
  m.box(C - 1, E + 6, C - 1, 2, 1, 2, GILT_D);
  m.set(C - 1, E + 7, C - 1, GILT); m.set(C - 1, E + 8, C - 1, GILT_L);
  brazier(m, 2, 1, 22, 3); brazier(m, 22, 1, 22, 3);
  // the fire bowls' flames burn in their own orange too (glow 0.95)
  for (const v of m.coords) { const p = m.get(...v); if (p && p.glow && v[1] < 10) { p.glow = 0.95; p.c = v[1] === 4 ? BEACON[3] : v[1] === 5 ? BEACON[1] : BEACON[0]; } }
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
const SPX_ST = [0xae9a74, 0xcbba95, 0xd9caa8, 0xe3d6b8];   // deep, shade, base, light
const SPX_GOLD = [0x7a5200, 0x9c6800, 0xb88400, 0xd09c18];
const SPX_LAP = [0x203a66, 0x2b4a7c, 0x34558c, 0x4a6aa4];
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
    if (v >= -3.4 && v < 0 && au >= 2.6 && au < 6.8 - 0.25 * (-v) && pz > zc - 4.4 && pz < zf - 2.0) return 'nemes';
    // the neck under the chin
    if (au < 2.6 && v >= -4 && v < 0.2 && pz > 26 && pz < zf - 1.0) return 'body';
    // the lappets: two striped bands hanging in front of the chest
    if (au >= 2.9 && au < 4.9 && v >= -5.4 && v < 0.5 && pz > zf - 1.9 && pz < zf - 0.45 - (v < -4.6 ? 0.3 : 0)) return au < 3.25 || au > 4.55 ? 'gold' : 'nemes';
    // the false beard: plaited, a little forward at its foot
    if (au < 0.72 + (v < -2.6 ? 0.12 : 0) && v >= -3.1 && v < 0.3 && pz > zf - 1.4 && pz < zf - 0.25 + (v < -2.4 ? 0.2 : 0)) return 'beard';
    return null;
  }
  function lionPart(px, py, pz) {
    const u = px - X0;
    // ---- the lion
    // the chest and neck rising under the head
    if (ell(px, py, pz, X0, sy + 4.0, 28.4, 6.0, 7.6, 3.6)) return 'body';
    // the body: a flat-based loaf; the back line climbs from the rump to the shoulders
    if (pz >= 7.4 && pz < 28) {
      const H = sy + 9.4 * sm(7.0, 11.5, pz) + 1.0 * sm(11.5, 22, pz) + 1.4 * sm(20, 27, pz) + 0.4;
      const Wb = 6.2 - 0.8 * sm(12, 18, pz) + 1.2 * sm(19, 26, pz);
      const end = pz < 11.5 ? Math.sqrt(Math.max(0, 1 - ((11.5 - pz) / 4.1) ** 2)) : 1;
      if (sup(u / (Wb * Math.max(0.35, end)), (py - sy) / (H - sy), 2.4)) return 'body';
    }
    // haunches (the folded hind legs) and the hind paws tucked forward
    for (const s of [-1, 1]) {
      if (ell(px, py, pz, X0 + s * 4.7, sy + 3.4, 14.0, 3.2, 5.8, 6.6)) return 'body';
      if (s * u > 5.2 && s * u < 8.0 && py < sy + 1.7 && pz > 15.5 && pz < 21.8 - 0.2 * (py - sy)) return pz > 21.0 && ((s * u - 5.2) % 0.85) < 0.3 ? 'groove' : 'body';
      // the shoulder and upper foreleg
      if (ell(px, py, pz, X0 + s * 4.9, sy + 4.4, 26.0, 2.8, 5.6, 3.7)) return 'body';
      // the forearm reaching out, a little lower toward the paw
      const lc = X0 + s * 5.25, lu = px - lc;
      if (pz >= 26 && pz < 37.4) {
        const lh = 4.4 - 1.0 * sm(26, 29, pz), lw = 2.0;
        if (sup(lu / lw, (py - sy) / lh, 2.2)) return 'body';
      }
      // the paw: broad, rounded at the front, the toes grooved
      if (pz >= 37.0 && pz < 39.9) {
        const r = pz > 38.8 ? Math.sqrt(Math.max(0, 1 - ((pz - 38.8) / 1.1) ** 2)) : 1;
        if (sup(lu / (2.25 * Math.max(0.45, r)), (py - sy) / (2.5 * Math.max(0.55, r)), 2.4)) {
          const g = (lu + 2.25) % 1.12;
          return pz > 38.3 && g < 0.34 && Math.abs(lu) < 1.9 ? 'groove' : 'body';
        }
      }
    }
    // the tail: from the rump along the right flank to a tuft
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, a = 1 - t;
      const tx = a * a * (X0 + 3.0) + 2 * a * t * (X0 + 8.6) + t * t * (X0 + 8.3);
      const tz = a * a * 8.6 + 2 * a * t * 8.2 + t * t * 20.5;
      const r = t > 0.9 ? 0.85 : 0.5;
      const ty = sy + r;
      if ((px - tx) ** 2 + (py - ty) ** 2 + (pz - tz) ** 2 <= r * r) return 'body';
    }
    return null;
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
