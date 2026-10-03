#!/usr/bin/env node
// The Greek Armory and Market for the Godot port (Age of Mythology: Retold:
// reference/techs/building_01..03 the Armory in the Classical / Heroic /
// Mythic ages, building_04..06 the Market). Godot-only (the browser build
// has neither), authored in the voxel format, palette and smooth tile roofs
// of src/buildings/models.js + shapes.js (the same gableRoof / shedRoof /
// roundColumn), meshed by the browser's mesher (buildVoxelGeometry: jitter,
// baked AO) plus the smooth parts (withExtras), written as the
// "techbuildings" model group:
//
//   node scripts/export-techbuildings.mjs [--out godot/assets/models]   (~3 s, deterministic)
//
// Voxel = 1/8 tile (0.125 world units, twice the buildings' resolution, like
// walls and towers: weapons, shields, fruit and awning stripes need it). Both
// buildings are 4 x 4 tiles (TECHS.md): a model spans x, z in [0, 32), pivoted
// at the footprint centre on the ground; the front looks +z, the default camera
// sees the +z front and the +x side. Read by godot/game/buildings/tech_buildings.gd.
// Names (T = armory | market, A = the owner's age look):
//   T/a1       Classical (and Archaic): terracotta tile roofs
//   T/a2       Heroic: pale green glazed tile roofs, team finials
//   T/a3       Mythic: marble tile roofs, team finials, gilt acroteria, marble trims
//   T/s0..s7   construction (floor(progress * 8)), cut from T/a1: 0 = the
//              staked-out foundation, 1..7 = the work rising in a timber scaffold
// Armory: a long whitewashed hall with a team band and two cross gables,
//   a timber porch, the open-fronted plank lean-to smithy (rafters, a dark
//   underside, an open truss, the hearth and its stone chimney, an anvil),
//   the round stone smelting furnace in the yard (glowing mouth and throat),
//   a stone trough, a shield rack with two team hoplite shields, three
//   barrels, one continuous low yard wall: few, big pieces (no prop scatter).
// Market: a two-storey stoa with a team band, a low columned wing tucked
//   under a projecting cornice, a terrace with an iron balustrade and an
//   outside stair, an open court with crates, painted amphorae and barrels,
//   and three stalls with team-striped awnings over counters of red fruit,
//   greens, lemons and grapes. No antefixes on the eaves (palmettes on the
//   stoa's ridge only).
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('out', 'godot/assets/models'));
const src = (p) => import(path.join(ROOT, 'src', p));
const { VoxelModel, TEAM, buildVoxelGeometry } = await src('core/voxel.js');
const { hash3 } = await src('core/rng.js');
const S = await src('buildings/shapes.js');
const { TILES, gableRoof, shedRoof, roundColumn, ridgeCap, mix, poly } = S;

const VOX = 0.125;
const N = 32;            // voxels per side (4 tiles)
const STAGES = 8;
const FORMAT = 2;

// ---- palette (src/buildings/models.js, scripts/export-towers.mjs) -------------
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
// whitewashed limestone ashlar (the town's hall walls), long low courses
const LIME = masonry([0xf2eee4, 0xe9e4d8, 0xdfd9cb], [0xe6e0d3, 0xdad3c4, 0xeee9df], { len: 9, course: 3, bed: 0.8, head: 0.88, grime: 4, seed: 5 });
// a greyer dressed stone (the armory hall: Retold's is grey-white)
const ARM_WALL = masonry([0xe4e0d6, 0xd9d4c8, 0xcfc9bc], [0xd2ccbf, 0xc6bfb1, 0xdcd7cc], { len: 7, course: 3, bed: 0.76, head: 0.86, grime: 5, seed: 7 });
const MARBLE = (x, y, z) => { const h = hash3(x, y, z, 1); return h < 0.62 ? 0xf3efe6 : h < 0.9 ? 0xe9e4d8 : 0xdfd8c9; };
const MARBLE_SHADE = 0xd6cfbf;
const MARBLE_DARK = 0xbdb5a3;
const BASE_STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 21); return h < 0.4 ? 0x8d8676 : h < 0.8 ? 0x7f786a : 0x9a9382; };
const DARK_BLOCK = masonry([0x6f695f, 0x625d54, 0x7a7468], [0x5a554d, 0x686258, 0x746e63], { len: 5, course: 3, bed: 0.8, head: 0.88, grime: 0, seed: 17 });
const PAVE = (x, y, z) => {
  const u = Math.floor((x + ((z >> 2) & 1) * 2) / 4), v = z >> 2;
  let c = pick(hash3(u, v, 3, 8), [0xcfc6b1, 0xc4bba5, 0xd8d0bd, 0xbdb39c]);
  if ((x + ((z >> 2) & 1) * 2) % 4 === 0 || z % 4 === 0) c = shade(c, 0.86);
  return c;
};
const DIRT = (x, y, z) => pick(hash3(x, y, z, 25), [0x9c8766, 0x917c5d, 0xa69171, 0x8e7a5b, 0xa08b6a]);
const SOOT_DIRT = (x, y, z) => pick(hash3(x, y, z, 26), [0x5f5446, 0x6a5d4c, 0x564c40, 0x74664f]);
const GRAVEL = (x, y, z) => pick(hash3(x, y, z, 27), [0xa69a84, 0x9a8e78, 0xb1a690, 0x8f846f]);
const WOOD = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0x7a5230 : 0x8b6139);
const DARKWOOD = 0x5a3b22;
const POST = (x, y, z) => (hash3(x, y >> 1, z, 31) < 0.5 ? 0x6e4a2c : 0x7a5434);
const PLANK = (x, y, z) => pick(hash3((x + z) >> 1, y >> 2, 5, 22), [0xa98457, 0x9c794f, 0xb38e60, 0x94714a]);
const BOARD_G = (x, y, z) => pick(hash3((x + z) >> 1, y >> 2, 7, 23), [0x8f7d66, 0x85735d, 0x9a8870, 0x7b6a55]);   // weathered grey boards
const DOOR = (x, y, z) => pick(hash3((x + z + 64) >> 1, y >> 3, 3, 61), [0x7d4624, 0x8a4f2a, 0x6f3e20, 0x844b27]);
const DARK = 0x221c18;
const DARK2 = 0x2e2620;
const IRON = 0x3d3b39;
const IRON_L = 0x67696c;
const STEEL = 0x9ea4aa;
const STEEL_L = 0xc3c8cd;
const BRONZE = 0xb48a3c;
const BRONZE_D = 0x8a6a2c;
const GILT = 0xd2a847;
const SOFFIT = 0x4a3d33;
const WATER = 0x4f86a8;
const WATER_L = 0x6fa2c0;
const CLOTH = (x, y, z) => (hash3(x, y, z, 64) < 0.5 ? 0xf1ece0 : 0xe8e2d4);
const SACK = (x, y, z) => pick(hash3(x, y, z, 65), [0xc9b48a, 0xbfa97f, 0xd2bd94]);
const ROPE = 0xcdb98a;
const LEAF = (x, y, z) => pick(hash3(x, y, z, 12), [0x3d6b2f, 0x4a7b36, 0x55863b, 0x416f31, 0x5e8f3f]);
const POLE = (x, y, z) => (hash3(x, y, z, 21) < 0.5 ? 0x8a6a48 : 0x7d5f40);
const BLOCK = (x, y, z) => (hash3(x, y, z, 23) < 0.5 ? 0xe9e3d6 : 0xd9d2c2);
const FIRE = [0xc8400c, 0xe06010, 0xf08a20, 0xffb040];
const FG = { glow: 0.45 };         // the grade turns strong emission pastel: fire glows a little, stays orange
const COAL = { glow: 0.25 };
const CLAY = (x, y, z) => pick(hash3(x, y >> 1, z, 33), [0xd8d0c0, 0xcfc6b4, 0xe0d9cb, 0xc8bfad]);   // the furnace's lime-washed clay
const TERRA = (x, y, z) => pick(hash3(x, y, z, 34), [0xb8683e, 0xa95e37, 0xc27443]);
const PROD = {
  apple: (x, y, z) => pick(hash3(x, y, z, 41), [0xc8352a, 0xd94a30, 0xb02a22, 0xe0603a]),
  green: (x, y, z) => pick(hash3(x, y, z, 42), [0x5f9a3a, 0x4f8a30, 0x72aa48, 0x87b856]),
  lemon: (x, y, z) => pick(hash3(x, y, z, 43), [0xe8c840, 0xdcb830, 0xf0d860]),
  grape: (x, y, z) => pick(hash3(x, y, z, 44), [0x6a3a7a, 0x5a2e6a, 0x7a4a8a]),
  orange: (x, y, z) => pick(hash3(x, y, z, 45), [0xe58a2a, 0xd87a20, 0xf09a3a]),
  fish: (x, y, z) => pick(hash3(x, y, z, 46), [0xa9b4bc, 0x97a3ac, 0xbcc6cc]),
};

// roof tiles at 1/8 voxel: the building palettes (shapes.js TILES) with their
// course, tile and rib sizes doubled so tiles are the same size as the town's
// no antefixes along the eaves (they read as a row of spikes at this size): the
// palmettes sit only on the ridges (ridgeCrest)
const dbl = (t, extra = {}) => ({ ...t, plane: { ribGap: 3, ribW: 0.68, ribH: 0.84, bandEvery: 0, weather: 0.3, lip: 0.4, antefix: null, fascia: 1.1, ...extra } });
const ROOF = {
  a1: dbl(TILES.warm),
  a2: dbl({ tones: [0xa9c4ae, 0x9db9a2, 0xb6cfba, 0x93b098], butt: 0x5f7a66, fascia: 0xf1ece2, ridge: 0x7f9a86, soffit: 0x3f4640, antefix: 0xf3efe6 }, { weather: 0.2 }),
  a3: dbl({ tones: [0xe8e7de, 0xdcdcd2, 0xf1f0ea, 0xd0d4ca], butt: 0x8b918a, fascia: 0xf4f1ea, ridge: 0xb9bdb4, soffit: 0x57524c, antefix: 0xf7f4ec }, { weather: 0.15 }),
};
// wooden plank roofs (the armory's lean-to): boards running down the slope
const PLANKS = { tones: [0x86664a, 0x7e6044, 0x8d6c4e, 0x806246], butt: 0x4f3a28, fascia: 0x4a3626, ridge: 0x5e4630, soffit: 0x241c16, antefix: null,
  plane: { ribGap: 2.6, ribW: 0.32, ribH: 0.36, bandEvery: 0, weather: 0.15, lip: 0.15, fascia: 0.9, antefix: null } };
const roofOpts = { course: 2.2, tileW: 2.8 };

// Records the coordinates it was given (construction stages are cut from it).
class Rec extends VoxelModel {
  constructor() { super(); this.coords = []; }
  set(x, y, z, color, opts) {
    if (typeof color === 'function') color = color(x, y, z);
    if (color === null || color === undefined) return this;
    if (!this.has(x, y, z)) this.coords.push([x, y, z]);
    return super.set(x, y, z, color, opts);
  }
}
const copyVox = (dst, v, x, y, z) => dst.set(x, y, z, v.team ? TEAM : v.c, v.glow ? { glow: v.glow } : undefined);

// ---- props --------------------------------------------------------------------
// a voxel solid of revolution round (cx, cz) (cell centres), radius r(y)
function lathe(m, cx, cz, y0, y1, r, color, { hollow = 0, inner = null } = {}) {
  for (let y = y0; y < y1; y++) {
    const R = r(y);
    const R2 = (R + 0.2) * (R + 0.2), I2 = hollow > 0 ? Math.max(0, R - hollow) ** 2 : -1;
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) for (let z = Math.floor(cz - R - 1); z <= Math.ceil(cz + R + 1); z++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      if (d2 < I2) { if (inner) m.set(x, y, z, inner); continue; }
      m.set(x, y, z, color);
    }
  }
}
// a smooth frustum round (cx, cz) from (y0, r0) to (y1, r1) (shapes.js polys):
// `color(segment, band)`, `bands` rings up the side; `inward` faces the inside
function frustum(m, cx, cz, y0, y1, r0, r1, color, { segs = 20, bands = 1, inward = false } = {}) {
  for (let k = 0; k < bands; k++) {
    const ya = y0 + (y1 - y0) * k / bands, yb = y0 + (y1 - y0) * (k + 1) / bands;
    const ra = r0 + (r1 - r0) * k / bands, rb = r0 + (r1 - r0) * (k + 1) / bands;
    for (let s = 0; s < segs; s++) {
      const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
      const p = (b, y, r) => [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r];
      const sl = (r0 - r1) / (y1 - y0);
      const n = (b) => { const v = [Math.cos(b), sl, Math.sin(b)]; const l = Math.hypot(...v); const f = inward ? -1 : 1; return v.map((q) => (q / l) * f); };
      poly(m, [p(b0, ya, ra), p(b1, ya, ra), p(b1, yb, rb), p(b0, yb, rb)], color(s, k), { normals: [n(b0), n(b1), n(b1), n(b0)], shade: [0.93, 0.93, 1, 1] });
    }
  }
}
// a flat smooth ring at y between radii r0 (outer) and r1 (inner), facing up
function annulus(m, cx, cz, y, r0, r1, color, segs = 20) {
  for (let s = 0; s < segs; s++) {
    const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
    const p = (b, r) => [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r];
    poly(m, [p(b0, r0), p(b1, r0), p(b1, r1), p(b0, r1)], color, { out: [0, 1, 0] });
  }
}
// a barrel: staves round (cx, cz) with two iron hoops, a darker lid
function barrel(m, cx, y, cz, h = 5, r = 1.6) {
  lathe(m, cx, cz, y, y + h, (yy) => r - (yy === y || yy === y + h - 1 ? 0.35 : 0), (x, yy, z) => (yy === y + 1 || yy === y + h - 2 ? IRON : pick(hash3(x, yy >> 1, z, 51), [0xa8723e, 0x9a6836, 0xb47c46])));
  lathe(m, cx, cz, y + h, y + h + 1, () => r - 0.6, 0x8c5c32);
}
// an amphora: a belly, a neck and a lip, optionally painted (black-figure band)
function amphora(m, cx, y, cz, c = 0xb8683e, painted = false) {
  const prof = [0.9, 1.4, 1.7, 1.7, 1.5, 1.0, 0.6, 0.6, 0.9];
  prof.forEach((r, i) => lathe(m, cx, cz, y + i, y + i + 1, () => r, (x, yy, z) => {
    if (painted && (i === 2 || i === 3)) return ((x + z) & 1) ? 0x2a2420 : c;
    if (painted && i === 4) return 0x2a2420;
    return shade(c, 0.9 + 0.04 * i);
  }));
}
// a crate: plank sides with a darker frame
function crate(m, x, y, z, w, h, d, c = 0x9b7040) {
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) {
    const ex = i === 0 || i === w - 1, ey = j === 0 || j === h - 1, ez = k === 0 || k === d - 1;
    const edge = (ex && ey) || (ey && ez) || (ex && ez);
    m.set(x + i, y + j, z + k, edge ? shade(c, 0.72) : ((i + j + k) % 3 === 0 ? shade(c, 0.9) : c));
  }
}
// a round hoplite shield standing on its rim, its face looking `face`
// ('+x' or '+z'): team face, a pale rim, a bronze boss
function shield(m, x, y, z, face = '+x', r = 3.5) {
  const R = Math.ceil(r);
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
    const d = Math.hypot(a, b);
    if (d > r) continue;
    const c = d > r - 0.6 ? 0xefe9dc : d < 0.75 ? BRONZE : TEAM;
    const back = 0x6e4a2c;
    if (face === '+x') { m.set(x, y + R + b, z + a, c); m.set(x - 1, y + R + b, z + a, back); }
    else { m.set(x + a, y + R + b, z, c); m.set(x + a, y + R + b, z - 1, back); }
  }
}
// a spear standing upright: shaft, a bronze butt-spike and a steel head
function spear(m, x, y, z, h = 14) {
  m.set(x, y, z, BRONZE_D);
  for (let yy = y + 1; yy < y + h - 2; yy++) m.set(x, yy, z, (yy & 3) === 0 ? 0x6e4a2c : 0x8b6139);
  m.set(x, y + h - 2, z, STEEL); m.set(x, y + h - 1, z, STEEL_L);
}
// a sword hanging point down from a rack bar at y (blade along -y)
function sword(m, x, y, z) {
  m.set(x, y + 1, z, BRONZE); m.set(x, y, z, 0x4a3020);
  m.set(x - 1, y - 1, z, BRONZE_D); m.set(x, y - 1, z, BRONZE_D); m.set(x + 1, y - 1, z, BRONZE_D);
  for (let yy = y - 2; yy > y - 7; yy--) m.set(x, yy, z, yy === y - 6 ? STEEL_L : STEEL);
}
// an anvil on a stump
function anvil(m, x, y, z, along = 'x') {
  lathe(m, x + 1, z + 1, y, y + 3, () => 1.6, (xx, yy, zz) => (yy === y + 2 ? 0xb08a5c : WOOD(xx, yy, zz)));
  const put = (i, j, k, c) => (along === 'x' ? m.set(x + i, y + 3 + j, z + k, c) : m.set(x + k, y + 3 + j, z + i, c));
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) put(i, 0, k, IRON);
  for (let i = -1; i < 4; i++) for (let k = 0; k < 2; k++) put(i, 1, k, i === 3 ? IRON_L : IRON);
  for (let k = 0; k < 2; k++) put(4, 1, k, IRON_L);
  for (let i = -1; i < 4; i++) for (let k = 0; k < 2; k++) put(i, 2, k, (i + k) & 1 ? IRON_L : 0x55575a);
  put(5, 2, 0, IRON_L); put(5, 2, 1, IRON_L); put(6, 2, 0, IRON_L);     // the horn
  // a hammer lying on the face
  put(0, 3, 0, 0x2f2d2b); put(1, 3, 0, 0x2f2d2b); put(1, 3, 1, 0x7a5230); put(1, 3, 2, 0x7a5230);
}
// a produce crate on a counter: the crate rim with a heap of fruit above it
function produce(m, x, y, z, w, d, kind) {
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
    const rim = i === 0 || i === w - 1 || k === 0 || k === d - 1;
    m.set(x + i, y, z + k, rim ? 0x8a6236 : PROD[kind](x + i, y, z + k));
    if (!rim) m.set(x + i, y + 1, z + k, PROD[kind](x + i, y + 1, z + k));
    if (!rim && i > 1 && i < w - 2 && k > 1 && k < d - 2 && hash3(x + i, y, z + k, 47) < 0.7) m.set(x + i, y + 2, z + k, PROD[kind](x + i, y + 2, z + k));
  }
}

// ---- walls --------------------------------------------------------------------
// A wall block [x0, x1) x [z0, z1) from y0 to y1: a stone socle, the team band
// between two pale fillets, dressed stone above. Hollow (one voxel walls).
function hall(m, x0, z0, x1, z1, y0, y1, { wall = ARM_WALL, band = [5, 7], socle = 2 } = {}) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) {
    const edge = x === x0 || x === x1 - 1 || z === z0 || z === z1 - 1;
    if (!edge) continue;
    let c;
    if (y < y0 + socle) c = DARK_BLOCK(x, y, z);
    else if (y >= band[0] && y < band[1]) c = TEAM;
    else if (y === band[0] - 1 || y === band[1]) c = MARBLE_SHADE;
    else c = wall(x, y, z);
    m.set(x, y, z, c);
  }
  // a floor slab inside, so the open top of a construction stage is not see-through
  m.box(x0 + 1, y0, z0 + 1, x1 - x0 - 2, 1, z1 - z0 - 2, PAVE);
}
// a window in a wall at the outer plane (face '+z' at z, '+x' at x): a dark
// opening with a marble sill and lintel, a wooden shutter on one side
function windowOn(m, face, a, y, plane, w = 2, h = 3) {
  const put = (u, yy, out, c) => (face === '+z' ? m.set(a + u, yy, plane + out, c) : face === '-z' ? m.set(a + u, yy, plane - out, c) : m.set(plane + out, yy, a + u, c));
  for (let u = 0; u < w; u++) for (let yy = y; yy < y + h; yy++) put(u, yy, 0, yy === y + h - 1 ? DARK2 : DARK);
  for (let u = -1; u <= w; u++) { put(u, y - 1, 0, MARBLE_SHADE); put(u, y - 1, 1, MARBLE_SHADE); put(u, y + h, 0, MARBLE); }
}

// ---- the Armory ---------------------------------------------------------------
// building_01..03. Lot x, z in [0, 32), front +z. Few, big, clearly modelled
// pieces so it reads as a forge at game zoom (no scatter of small props):
//   hall      x 1..22 (walls x 5..22, a timber porch x 1..5), z 3..15, walls to y 20,
//             a gable along x with two raised cross gables (ridge along z),
//             its +x gable end in masonry
//   lean-to   x 22..31, z 4..17: the open-fronted smithy, a plank gable roof
//             (ridge along x) on posts, a dark underside and rafters, an open
//             truss at the +x end; the hearth with a stone chimney through
//             the roof, one anvil
//   yard      z 16..31: the furnace, the trough, a shield rack with two
//             hoplite shields, three barrels, one continuous low yard wall
function armory(age, m = new Rec()) {
  const T = ROOF[`a${age}`];
  // ground: packed earth, a gravel ring round the furnace, soot under the smithy
  const FX = 12, FZ = 24;
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    const dfx = x + 0.5 - FX, dfz = z + 0.5 - FZ;
    let c = DIRT(x, 0, z);
    if (dfx * dfx + dfz * dfz < 72) c = GRAVEL(x, 0, z);
    if (x >= 22 && z >= 4 && z < 17) c = SOOT_DIRT(x, 0, z);
    m.set(x, 0, z, c);
  }
  // the hall: a stone socle course on a footing, the walls to y H
  const H = 20, C = H + 4;
  m.box(4, 1, 2, 19, 1, 14, BASE_STONE);
  hall(m, 5, 3, 22, 15, 2, H, { band: [5, 7] });
  // porch: paved floor, two timber posts on stone bases, the beam
  m.box(1, 1, 3, 4, 1, 12, BASE_STONE);
  for (const z of [3, 13]) { m.box(1, 2, z, 2, 1, 2, BASE_STONE); m.box(1, 3, z, 2, H - 4, 2, POST); m.box(1, H - 1, z, 2, 1, 2, DARKWOOD); }
  m.box(1, H - 1, 3, 2, 1, 12, DARKWOOD);
  // front (+z, plane z 14): a double door in a marble frame, windows
  for (let x = 14; x < 18; x++) for (let y = 3; y < 13; y++) m.set(x, y, 14, y === 6 || y === 10 || x === 16 ? shade(DOOR(x, y, 14), 0.75) : DOOR(x, y, 14));
  for (let x = 13; x < 19; x++) { m.set(x, 13, 14, MARBLE); m.set(x, 13, 15, MARBLE_SHADE); }
  for (let y = 3; y < 13; y++) { m.set(13, y, 14, MARBLE_SHADE); m.set(18, y, 14, MARBLE_SHADE); }
  windowOn(m, '+z', 8, 12, 14); windowOn(m, '-z', 10, 12, 3); windowOn(m, '-z', 17, 12, 3);
  // eave course: a marble cornice under the roof
  for (let x = 5; x < 22; x++) for (const z of [3, 14]) m.set(x, H - 1, z, MARBLE_SHADE);
  for (let z = 3; z < 15; z++) for (const x of [5, 21]) m.set(x, H - 1, z, MARBLE_SHADE);
  // main roof (ridge along x) over the porch and the hall
  const main = gableRoof(m, { wx0: 1, wx1: 22, wz0: 3, wz1: 15, top: H, axis: 'x', pitch: 0.55, ov: 1.5, ovG: 1, tiles: T, ends: 'wall', fill: 0xe2ddd1, seed: 71, ...roofOpts });
  // the +x gable end in dressed stone (one voxel proud of the smooth gable
  // triangle, so it reads as wall, not as a pale plane), a dark vent in it
  for (let z = 3; z < 15; z++) {
    const yt = H + 0.55 * (6 - Math.abs(z + 0.5 - 9)) - 0.6;
    for (let y = H - 1; y < yt; y++) m.set(22, y, z, y === H - 1 ? MARBLE_SHADE : ARM_WALL(22, y, z));
  }
  for (let z = 8; z < 10; z++) for (let y = H + 1; y < H + 3; y++) m.set(22, y, z, DARK);
  void main;
  // two raised cross gables (ridge along z), pedimented front and back: a
  // clerestory course on the main walls, then the gable
  for (const [cx0, cx1, seed] of [[6, 13, 73], [14, 21, 75]]) {
    for (let x = cx0; x < cx1; x++) for (let y = H; y < C; y++) for (const z of [2, 15]) m.set(x, y, z, y === H ? MARBLE_SHADE : ARM_WALL(x, y, z));
    for (let z = 2; z < 16; z++) for (let y = H; y < C; y++) for (const x of [cx0, cx1 - 1]) m.set(x, y, z, ARM_WALL(x, y, z));
    for (let x = cx0; x < cx1; x++) for (let z = 3; z < 15; z++) m.set(x, C - 1, z, 0xd6d0c2);
    windowOn(m, '+z', cx0 + 2, H + 1, 15, 3, 2);
    const r = gableRoof(m, { wx0: cx0, wx1: cx1, wz0: 2, wz1: 16, top: C, axis: 'z', pitch: 0.75, ov: 1.5, ovG: 1.2, tiles: T, ends: 'pediment',
      tymp: age >= 2 ? 0x2f4570 : 0x8e3a2c, rakeH: 1.2, acro: age >= 3, acroK: 1.6, seed, ...roofOpts });
    if (age >= 2) {
      // team finials (Retold's blue ridge ornaments) at both apexes
      const mx = Math.floor((cx0 + cx1) / 2) - 1, fy = Math.floor(r.ridgeY) + 1;
      for (const z of [1, 16]) { m.set(mx, fy, z, TEAM); m.set(mx + 1, fy, z, TEAM); m.set(mx, fy + 1, z, TEAM); m.set(mx + 1, fy + 1, z, TEAM); m.set(mx, fy + 2, z, TEAM); }
    }
  }
  // three barrels in one group by the hall front (building_01)
  for (const [x, z, h] of [[3.0, 17.6, 5], [6.2, 17.4, 5], [4.6, 20.4, 4]]) barrel(m, x, 1, z, h, 1.5);

  // ---- the lean-to smithy (x 22..31, z 4..17): open to the front and the +x end
  const LT = 11, LP = 0.55;                                 // eave-wall height, pitch
  const lyRoof = (z) => LT + LP * (6.5 - Math.abs(z + 0.5 - 10.5));   // roof plane over cell z
  m.box(23, 1, 4, 8, LT - 1, 1, BOARD_G);                   // back wall of boards
  for (let y = 3; y < LT; y += 4) m.box(23, y, 5, 8, 1, 1, DARKWOOD);
  // posts on stone bases (front row and the open end), the eave beams
  for (const [x, z] of [[22, 16], [26, 16], [30, 16], [30, 4], [30, 10]]) { m.set(x, 1, z, BASE_STONE); m.box(x, 2, z, 1, LT - 2, 1, POST); }
  m.box(22, LT - 1, 16, 9, 1, 1, DARKWOOD);                 // front beam
  m.box(22, LT - 1, 4, 9, 1, 1, DARKWOOD);                  // back beam
  // rafters under the roof (rising from both beams to the ridge) and the
  // open truss at the +x end: tie beam, king post, raking rafters
  for (const x of [23, 25, 27, 29, 30]) for (let z = 4; z < 17; z++) {
    const y = Math.floor(lyRoof(z) - 1.6);
    m.set(x, y, z, DARKWOOD);
    if (x === 30) m.set(x, y - 1, z, POST(x, y - 1, z));
  }
  m.box(30, LT - 1, 4, 1, 1, 13, DARKWOOD);
  for (let y = LT; y < Math.floor(lyRoof(10) - 1.6); y++) m.set(30, y, 10, POST(30, y, 10));
  gableRoof(m, { wx0: 22, wx1: 31, wz0: 4, wz1: 17, top: LT, axis: 'x', pitch: LP, ov: 1.4, ovG: 0.8, tiles: PLANKS, ends: 'open', seed: 77, course: 20, tileW: 1.6 });
  // the forge hearth against the back wall: a stone block, glowing coals, and
  // a stone chimney up through the roof (a clear silhouette above the lean-to)
  m.box(23, 1, 5, 5, 4, 4, DARK_BLOCK);
  m.box(23, 5, 8, 5, 1, 1, MARBLE_SHADE);
  for (let x = 24; x < 27; x++) for (let z = 6; z < 8; z++) m.set(x, 5, z, hash3(x, 5, z, 3) < 0.5 ? FIRE[2] : FIRE[1], FG);
  const CH = (x, y, z) => (y >= 19 ? shade(CLAY(x, y, z), 0.62) : y >= 17 ? shade(CLAY(x, y, z), 0.8) : CLAY(x, y, z));
  m.box(24, 5, 5, 3, 15, 3, CH);
  m.box(23, 20, 4, 5, 1, 5, MARBLE_SHADE);                  // the chimney cap
  m.box(24, 21, 5, 3, 1, 3, 0x2a2420);
  // one anvil on its stump in the open front
  anvil(m, 25, 1, 11, 'x');
  if (age >= 3) m.box(30, LT - 1, 4, 1, 1, 13, MARBLE_SHADE);   // a marble tie beam (building_03)

  // ---- the yard
  // the smelting furnace (building_01's centrepiece): a two-step stone plinth,
  // a smooth tapering lime-washed bottle kiln with a collar and a lip, a dark
  // throat with glowing coals deep inside, a stone fire mouth to the front
  // the plinth: two smooth stone drums (big dressed blocks round the ring)
  const PL = [0x6f695f, 0x625d54, 0x7a7468, 0x686258];
  frustum(m, FX, FZ, 1, 3, 6.4, 6.4, (s, k) => pick(hash3(s, k, 3, 36), PL), { segs: 24, bands: 2 });
  annulus(m, FX, FZ, 3, 6.4, 5.6, 0x8a8478, 24);
  frustum(m, FX, FZ, 3, 4, 5.6, 5.6, (s) => shade(pick(hash3(s, 7, 4, 36), PL), 1.2), { segs: 24 });
  annulus(m, FX, FZ, 4, 5.6, 4.0, 0x948d80, 24);
  const KILN = [0xe6d9c0, 0xdccdb2, 0xebe0ca, 0xd6c6aa];
  frustum(m, FX, FZ, 4, 9, 4.6, 4.0, (s, k) => shade(pick(hash3(s, k, 1, 35), KILN), 0.96));
  frustum(m, FX, FZ, 9, 15, 4.0, 2.5, (s, k) => shade(pick(hash3(s, k, 2, 35), KILN), k > 3 ? 0.78 - 0.06 * (k - 3) : 1), { bands: 5 });
  frustum(m, FX, FZ, 15, 15.8, 2.5, 3.0, () => MARBLE_SHADE);
  frustum(m, FX, FZ, 15.8, 17, 3.0, 3.0, (s) => (s & 1 ? 0xcfc6b4 : 0xc6bca8));
  annulus(m, FX, FZ, 17, 3.0, 2.0, 0x8a8172);
  frustum(m, FX, FZ, 13, 17, 2.0, 2.0, () => 0x2a2420, { inward: true });   // the dark throat
  for (let x = FX - 2; x < FX + 2; x++) for (let z = FZ - 2; z < FZ + 2; z++) {
    if (Math.hypot(x + 0.5 - FX, z + 0.5 - FZ) > 1.9) continue;
    m.set(x, 13, z, hash3(x, 13, z, 9) < 0.5 ? FIRE[3] : FIRE[2], FG);
    m.set(x, 12, z, FIRE[1], FG);
  }
  // the fire mouth: one stone block on the +z face with a marble lintel, coals inside
  for (let x = FX - 3; x < FX + 3; x++) for (let y = 1; y < 10; y++) for (let z = FZ + 3; z < FZ + 6; z++) {
    const open = x >= FX - 2 && x < FX + 2 && y >= 4 && y < 8;
    if (open) { if (z === FZ + 3) m.set(x, y, z, y < 6 ? FIRE[(x + y) & 1] : FIRE[0], y < 6 ? FG : COAL); continue; }
    m.set(x, y, z, y === 9 ? MARBLE_SHADE : shade(DARK_BLOCK(x, y, z), 1.1));
  }
  // the water trough: a stone trough with a plank rim (building_01, right of the furnace)
  for (let x = 20; x < 27; x++) for (let z = 23; z < 27; z++) {
    const rim = x === 20 || x === 26 || z === 23 || z === 26;
    m.set(x, 1, z, BASE_STONE);
    m.set(x, 2, z, rim ? 0xb4ab98 : WATER);
    if (rim) m.set(x, 3, z, 0xc4bba5);
  }
  // the shield rack: two posts and a bar along the smithy's front, two big
  // hoplite shields hanging on it, faces to the front: a bronze rim, the team
  // field, a raised bronze boss, a wooden back
  for (const x of [17, 31]) { m.set(x, 1, 19, BASE_STONE); m.box(x, 2, 19, 1, 10, 1, POST); }
  m.box(17, 11, 19, 15, 1, 1, DARKWOOD);
  for (const x0 of [18, 25]) bigShield(m, x0, 4, 21);
  // one continuous low yard wall along the front and the east edge: three
  // courses of block, a flat pale coping, a gap for the cart track
  const yardWall = (x, z) => {
    for (let y = 1; y < 3; y++) m.set(x, y, z, shade(DARK_BLOCK(x, y, z), 1.15));
    m.set(x, 3, z, 0xcfc8b8);
  };
  for (let x = 21; x < 32; x++) yardWall(x, 31);
  for (let z = 21; z < 31; z++) yardWall(31, z);
  if (age >= 3) {
    // marble trims: corner pilasters on the hall
    for (const [x, z] of [[5, 14], [21, 14], [5, 3], [21, 3]]) for (let y = 2; y < 17; y++) if (y < 5 || y > 7) m.set(x, y, z, MARBLE);
  }
  return m;
}
// a hanging hoplite shield (aspis), 7 x 7 voxels drawn as pixel art so its
// round outline stays clean: a bronze rim, the team field, a raised boss;
// face +z at plane z, lower-left corner (x0, y0), a wooden back and a strap
// up to the rack bar (y 11, plane z - 2)
const ASPIS = ['..RRR..', '.RTTTR.', 'RTTTTTR', 'RTTBTTR', 'RTTTTTR', '.RTTTR.', '..RRR..'];
function bigShield(m, x0, y0, z) {
  ASPIS.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    const x = x0 + i, y = y0 + 6 - j;
    m.set(x, y, z - 1, 0x5e3f26);
    m.set(x, y, z, ch === 'R' ? 0xa8742c : ch === 'B' ? 0xc8962e : TEAM);
    if (ch === 'B') m.set(x, y, z + 1, 0xc8962e);
  }));
  for (let y = y0 + 7; y < 11; y++) m.set(x0 + 3, y, z - 1, DARKWOOD);
  m.set(x0 + 3, 10, z - 2, DARKWOOD);
}

// ---- the Market ---------------------------------------------------------------
// building_04..06. Lot x, z in [0, 32), front +z.
//   stoa      x 1..19, z 1..11: two storeys (walls to y 27), team band at the
//             foot and under the upper floor, a gable along x (pedimented ends)
//   wing      x 0..10, z 11..23: one storey, columns on the front, a gable
//             along z with a pediment to the front
//   terrace   x 19..27, z 1..10: one storey to y 13, a deck with an iron
//             balustrade, barrels; an outside stair x 27..31 down to z 14
//   court     the open middle: crates, painted amphorae, barrels
//   stalls    front-left (x 10..19, z 23..31), front-right (x 19..28, z 23..31),
//             east (x 24..32, z 13..22): counters, produce, posts, a small tile
//             roof, the team-striped awning sloping out
function market(age, m = new Rec()) {
  const T = ROOF[`a${age}`];
  // ground: a paved court, packed earth at the edges
  for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
    const inner = x >= 1 && x < 31 && z >= 1 && z < 31;
    m.set(x, 0, z, inner ? PAVE(x, 0, z) : DIRT(x, 0, z));
  }
  // ---- stoa
  m.box(0, 1, 0, 20, 1, 12, BASE_STONE);
  hall(m, 1, 1, 19, 11, 2, 27, { wall: LIME, band: [4, 6] });
  // the upper floor: a cornice and the second team band
  for (let x = 1; x < 19; x++) for (const z of [0, 11]) m.set(x, 14, z, MARBLE_SHADE);
  for (let z = 0; z < 12; z++) for (const x of [0, 19]) m.set(x, 14, z, MARBLE_SHADE);
  for (let x = 1; x < 19; x++) for (let z = 1; z < 11; z++) {
    const e = x === 1 || x === 18 || z === 1 || z === 10;
    if (e) { m.set(x, 16, z, TEAM); m.set(x, 17, z, MARBLE_SHADE); }
  }
  // windows: ground floor and upper floor, a door to the court
  for (const x of [11, 15]) windowOn(m, '+z', x, 8, 10);
  for (const x of [3, 8, 13]) windowOn(m, '+z', x, 20, 10, 2, 3);
  windowOn(m, '+x', 3, 20, 18); windowOn(m, '+x', 7, 20, 18);
  for (let x = 13; x < 16; x++) for (let y = 3; y < 7; y++) m.set(x, y, 10, DOOR(x, y, 10));
  for (const x of [3, 9, 15]) windowOn(m, '-z', x, 20, 1);
  for (let x = 1; x < 19; x++) for (const z of [1, 10]) m.set(x, 26, z, MARBLE_SHADE);
  const stoaRoof = gableRoof(m, { wx0: 1, wx1: 19, wz0: 1, wz1: 11, top: 27, axis: 'x', pitch: 0.6, ov: 1.8, ovG: 1.2, tiles: T, ends: 'pediment',
    tymp: age >= 2 ? 0x2f4570 : 0x8e3a2c, rakeH: 1.2, acro: age >= 3, acroK: 1.7, seed: 81, ...roofOpts });
  ridgeCrest(m, 2.5, 18, stoaRoof.ridgeY + 0.6, stoaRoof.um, T.antefix ?? 0xf3efe6);
  // ---- wing (columned porch): low enough that its ridge runs in under the
  // stoa's projecting first-floor cornice, which hides the roof junction
  m.box(0, 1, 11, 11, 1, 13, BASE_STONE);
  m.box(1, 2, 11, 9, 1, 12, MARBLE_SHADE);
  for (let z = 11; z < 23; z++) for (let y = 3; y < 11; y++) m.set(1, y, z, y < 5 ? DARK_BLOCK(1, y, z) : y === 5 || y === 6 ? TEAM : LIME(1, y, z));
  for (const x of [2.5, 8.5]) roundColumn(m, x, 3, 21.5, 1.0, 8);
  roundColumn(m, 8.5, 3, 15.5, 1.0, 8);
  m.box(1, 11, 11, 10, 1, 12, MARBLE_SHADE);
  gableRoof(m, { wx0: 1, wx1: 11, wz0: 11, wz1: 23, top: 12, axis: 'z', pitch: 0.45, ov: 1.4, ovG: 1.2, tiles: T, ends: 'pediment',
    tymp: age >= 2 ? 0x2f4570 : 0x8e3a2c, rakeH: 1.0, acro: age >= 3, acroK: 1.3, seed: 83, ...roofOpts });
  // the projecting cornice over the junction: two voxels deep, the full front
  for (let x = 0; x < 20; x++) for (const z of [11, 12]) { m.set(x, 15, z, z === 12 ? MARBLE_SHADE : MARBLE(x, 15, z)); }
  for (let x = 0; x < 20; x++) m.set(x, 16, 11, MARBLE_SHADE);
  // goods under the porch
  barrel(m, 4, 3, 19, 4, 1.5); barrel(m, 4.5, 3, 15.5, 4, 1.5);
  amphora(m, 6.5, 3, 21.5, 0xe8e2d4, true);
  // ---- terrace block (deck at y 10)
  m.box(19, 1, 0, 9, 1, 11, BASE_STONE);
  hall(m, 19, 1, 27, 10, 2, 10, { wall: LIME, band: [4, 6] });
  for (let x = 20; x < 23; x++) for (let y = 3; y < 8; y++) m.set(x, y, 9, y >= 7 && (x === 20 || x === 22) ? LIME(x, y, 9) : DARK);   // an arched store door
  m.box(19, 10, 1, 9, 1, 10, (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 19), [0xc9bfa9, 0xbfb59e, 0xd2c8b3]));   // the deck
  for (let x = 19; x < 28; x++) m.set(x, 9, 10, MARBLE_SHADE);
  // the iron balustrade: posts every 2 voxels with knob finials, a top rail
  for (let x = 19; x < 27; x++) {
    if ((x & 1) === 1) { m.set(x, 11, 10, IRON); m.set(x, 12, 10, IRON); m.set(x, 14, 10, 0x55524e); }
    m.set(x, 13, 10, IRON);
  }
  for (let z = 2; z < 11; z++) { if ((z & 1) === 0) { m.set(19, 11, z, IRON); m.set(19, 12, z, IRON); } m.set(19, 13, z, IRON); }
  barrel(m, 21.5, 11, 3.5, 4, 1.5); barrel(m, 24.5, 11, 2.8, 4, 1.4);
  crate(m, 23, 11, 6, 3, 3, 3);
  // ---- the outside stair (x 27..31) rising to the back onto the deck, an iron rail
  for (let z = 1; z < 12; z++) {
    const top = Math.min(10, 12 - z);       // z 11 -> y 1, z 2 -> y 10
    for (let x = 27; x < 31; x++) for (let y = 1; y <= top; y++) {
      const tread = y === top;
      m.set(x, y, z, tread ? (x === 30 ? MARBLE_SHADE : MARBLE(x, y, z)) : (x === 30 ? LIME(x, y, z) : DARK_BLOCK(x, y, z)));
    }
    if (z % 2 === 0) { m.set(30, top + 1, z, IRON); m.set(30, top + 2, z, IRON); }
    m.set(30, top + 3, z, IRON);
  }
  // ---- the court: crates, amphorae, barrels, sacks
  crate(m, 12, 1, 13, 4, 4, 4, 0x9b7040); crate(m, 13, 5, 14, 3, 2, 3, 0xa27a48);
  crate(m, 17, 1, 17, 3, 3, 3, 0x8e6a3c);
  amphora(m, 20.5, 1, 13.5, 0xe8e2d4, true);
  amphora(m, 20.5, 1, 17.5, 0xb8683e);
  amphora(m, 18, 1, 12.5, 0xd8cfbf, true);
  barrel(m, 23.5, 1, 11.5, 4, 1.4);
  barrel(m, 13.5, 1, 19.5, 4, 1.5);
  for (const [x, z] of [[19, 19], [20, 20], [19, 21]]) { m.box(x, 1, z, 2, 2, 2, SACK); m.set(x, 3, z, ROPE); }
  // ---- the stalls
  stall(m, T, 'z', 10, 18, 28, age, ['apple', 'green', 'grape'], 85);
  stall(m, T, 'z', 21, 29, 28, age, ['orange', 'apple', 'lemon'], 87);
  stall(m, T, 'x', 12, 20, 28, age, ['apple', 'lemon', 'green'], 89);
  // a pot and a barrel by the front stall (building_05)
  amphora(m, 7.5, 1, 29.5, 0xb8683e); barrel(m, 19.6, 1, 30.2, 3, 1.3);
  if (age >= 3) {
    // marble trims: pilasters at the stoa's corners
    for (const [x, z] of [[18, 10], [18, 1], [1, 1]]) for (let y = 7; y < 26; y++) if (y < 14 || y > 17) m.set(x, y, z, MARBLE);
  }
  return m;
}
// A market stall facing `face` ('z': a front stall across [a0, a1) along x,
// its front edge at f (z); 'x': an east stall across [a0, a1) along z, its
// front at x = f). Back posts and a small tile gable over the back half, the
// counter (a plank box with a team skirt) in front with three produce crates,
// the striped team awning sloping out from the roof's front eave to past the counter.
function stall(m, T0, face, a0, a1, f, age, goods, seed) {
  const T = { ...T0, plane: { ...T0.plane, ribGap: 0, lip: 0.22 } };   // plain tile courses on the small roofs (ribs read as teeth)
  const put = (a, y, d, c, o) => (face === 'z' ? m.set(a, y, f - d, c, o) : m.set(f - d, y, a, c, o));   // d = depth from the front edge
  const W = a1 - a0;
  // the stone base and the counter (depth -3..0, in front of the awning's lip)
  for (let a = a0; a < a1; a++) for (let d = -3; d < 8; d++) put(a, 1, d, d === -3 ? MARBLE_SHADE : 0xc4bba5);
  for (let a = a0; a < a1; a++) for (let d = -3; d < 1; d++) for (let y = 2; y < 6; y++) {
    const edge = d === -3 || d === 0 || a === a0 || a === a1 - 1;
    if (!edge && y < 5) continue;
    let c = PLANK(a, y, d);
    if (d === -3 && (y === 3 || y === 4)) c = TEAM;      // the dyed skirt across the counter front
    if (y === 5) c = 0x8a6236;
    put(a, y, d, c);
  }
  // three produce crates on the counter, heaped up
  goods.forEach((k, i) => {
    const sa = a0 + Math.round((W * i) / 3), sb = a0 + Math.round((W * (i + 1)) / 3);
    for (let a = sa; a < sb; a++) for (let d = -3; d < 1; d++) {
      const rim = d === -3 || d === 0 || a === sa;
      put(a, 6, d, rim ? 0x7a5430 : PROD[k](a, 6, d));
      if (!rim && (a > sa + 0 || hash3(a, 7, d, seed) < 0.6)) put(a, 7, d, PROD[k](a, 7, d));
      if (rim && d === 0 && hash3(a, 7, d, seed) < 0.5) put(a, 7, d, PROD[k](a, 7, d));
      if (!rim && d === -1 && a > sa && hash3(a, 8, d, seed) < 0.7) put(a, 8, d, PROD[k](a, 8, d));
    }
  });
  // posts: two at the front of the counter, two at the back
  for (const a of [a0, a1 - 1]) {
    for (let y = 6; y < 11; y++) put(a, y, -1, POST(a, y, -1));
    for (let y = 2; y < 14; y++) put(a, y, 6, POST(a, y, 6));
  }
  // a back screen of boards with a shelf of jars
  for (let a = a0 + 1; a < a1 - 1; a++) for (let y = 2; y < 9; y++) put(a, y, 6, BOARD_G(a, y, 6));
  for (let a = a0 + 1; a < a1 - 1; a += 2) put(a, 9, 6, TERRA(a, 9, 6));
  // the small tile roof over the back half (smooth gable, ridge across the stall)
  const ry = 14;
  if (face === 'z') {
    gableRoof(m, { wx0: a0, wx1: a1, wz0: f - 7, wz1: f - 4, top: ry, axis: 'x', pitch: 0.55, ov: 0.6, ovG: 0.4, tiles: T, ends: 'wall', fill: 0x8a6a48, seed, ...roofOpts });
  } else {
    gableRoof(m, { wx0: f - 7, wx1: f - 4, wz0: a0, wz1: a1, top: ry, axis: 'z', pitch: 0.55, ov: 0.6, ovG: 0.4, tiles: T, ends: 'wall', fill: 0x8a6a48, seed, ...roofOpts });
  }
  for (let a = a0; a < a1; a++) for (const d of [4, 6]) put(a, ry - 1, d, DARKWOOD);
  for (let d = 4; d < 7; d++) for (const a of [a0, a1 - 1]) put(a, ry - 1, d, DARKWOOD);
  // the awning: team and white stripes across the stall, from under the
  // roof's front eave (depth 4, y 13) sloping down to its lip over the
  // counter (depth -1, y 10), a scalloped valance hanging under the lip
  for (let a = a0 - 1; a <= a1; a++) {
    const stripe = ((a - a0 + 1) >> 1) & 1;
    const c = stripe ? TEAM : CLOTH(a, 0, 0);
    for (let s = 0; s < 6; s++) {
      const d = 4 - s, y = 13 - Math.floor(s * 0.6 + 0.5);
      put(a, y, d, c);
      if (s > 0 && Math.floor(s * 0.6 + 0.5) !== Math.floor((s - 1) * 0.6 + 0.5)) put(a, y + 1, d, c);
    }
    if ((a & 1) === 0) put(a, 9, -1, c);          // a scalloped valance
  }
  // age 2+: a team finial on each gable end
  if (age >= 2) for (const a of [a0, a1 - 1]) { put(a, ry + 2, 4, TEAM); put(a, ry + 3, 4, TEAM); }
}

// palmette cresting along a ridge running along x from xa to xb at height y
// over z = zc: small upright pointed tiles facing front and back, every 3 voxels
function ridgeCrest(m, xa, xb, y, zc, color) {
  for (let x = xa; x <= xb + 1e-6; x += 3) {
    const w = 0.55, h = 0.75;
    for (const s of [1, -1]) {
      const z = zc + s * 0.06;
      poly(m, [[x - w, y, z], [x + w, y, z], [x + w, y + h, z], [x - w, y + h, z]], s > 0 ? color : shade(color, 0.82), { out: [0, 0, s] });
      poly(m, [[x - w, y + h, z], [x + w, y + h, z], [x, y + h + 0.6, z]], s > 0 ? color : shade(color, 0.82), { out: [0, 0, s] });
    }
  }
}

// ---- weathering, team cloth -------------------------------------------------
function weather(m) {
  const updates = [];
  for (const [x, y, z] of m.coords) {
    const v = m.get(x, y, z);
    if (!v || v.glow || y < 1) continue;
    if (v.team) {
      // dyed cloth and paint: a faint per-voxel tone, the foot of a hanging darker
      let c = hash3(x, y, z, 97) < 0.5 ? 0xf6f6f6 : 0xe4e4e4;
      if (!m.has(x, y - 1, z)) c = shade(c, 0.88);
      v.c = c;
      continue;
    }
    const ex = !m.has(x + 1, y, z) || !m.has(x - 1, y, z);
    const ez = !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    const up = !m.has(x, y + 1, z);
    const under = !m.has(x, y - 1, z);
    let f = 1;
    if (ex && ez) f *= hash3(x, y, z, 93) < 0.15 ? 0.86 : 1.08;
    else if (up && (ex || ez)) f *= 1.06;
    if (under && (ex || ez)) f *= 0.8;
    if ((ex || ez) && y < 5) f *= 0.9 + 0.02 * y;            // splash zone near the ground
    if (f !== 1) updates.push([v, f]);
  }
  for (const [v, f] of updates) {
    let c = shade(v.c, f);
    if (f > 1) { const r = Math.min((c >> 16) & 255, 248), g = Math.min((c >> 8) & 255, 244), b = Math.min(c & 255, 236); c = (r << 16) | (g << 8) | b; }
    v.c = c;
  }
}

// ---- construction stages (src/buildings/construction.js at this resolution) --
function stage(full, k) {
  let top = 0;
  const ub = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  for (const [x, y, z] of full.coords) {
    if (!full.has(x, y, z)) continue;
    top = Math.max(top, y + 1);
    if (y >= 4) { ub.x0 = Math.min(ub.x0, x); ub.x1 = Math.max(ub.x1, x); ub.z0 = Math.min(ub.z0, z); ub.z1 = Math.max(ub.z1, z); }
  }
  const cut = k <= 0 ? 1 : Math.max(2, Math.round(1 + (top - 1) * Math.pow(k / STAGES, 0.9)));
  const m = new VoxelModel();
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v || y >= cut) continue;
    if (y === 0 || k > 0) copyVox(m, v, x, y, z);
  }
  // smooth parts (roofs) appear once the work has risen past them
  if (full.extra) { m.extra = full.extra; m.extraMaxY = k >= STAGES - 1 ? Infinity : cut; }
  const cl = (v) => Math.max(0, Math.min(N - 1, v));
  const x0 = cl(ub.x0 - 1), x1 = cl(ub.x1 + 1), z0 = cl(ub.z0 - 1), z1 = cl(ub.z1 + 1);
  if (k <= 0) {
    // the staked-out lot: stakes with team pennants at the corners, a rope, a bed of earth
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) >> 1, z1], [x1, (z0 + z1) >> 1]]) {
      m.box(x, 1, z, 1, 6, 1, POLE);
      m.set(x, 6, z, TEAM); m.set(x + (x > 16 ? -1 : 1), 6, z, TEAM); m.set(x + (x > 16 ? -1 : 1), 5, z, TEAM);
    }
    for (let x = x0; x <= x1; x++) { m.set(x, 3, z0, ROPE); m.set(x, 3, z1, ROPE); }
    for (let z = z0; z <= z1; z++) { m.set(x0, 3, z, ROPE); m.set(x1, 3, z, ROPE); }
    for (let x = 3; x < 29; x++) for (let z = 3; z < 29; z++) if (hash3(x, 1, z, 4) < 0.08) m.set(x, 1, z, DIRT);
  } else {
    const sTop = Math.min(top + 2, cut + 5);
    const xs = [], zs = [];
    for (let x = x0; x < x1 - 4; x += 8) xs.push(x);
    xs.push(x1);
    for (let z = z0; z < z1 - 4; z += 8) zs.push(z);
    zs.push(z1);
    for (const x of xs) for (const z of [z0, z1]) m.box(x, 1, z, 1, sTop, 1, POLE);
    for (const z of zs) for (const x of [x0, x1]) m.box(x, 1, z, 1, sTop, 1, POLE);
    const walk = Math.max(3, cut - 1);
    const levels = new Set([walk]);
    for (let y = 9; y < walk - 3; y += 9) levels.add(y);
    for (const y of levels) {
      for (let x = x0; x <= x1; x++) { m.set(x, y, z0, PLANK); m.set(x, y, z1, PLANK); }
      for (let z = z0; z <= z1; z++) { m.set(x0, y, z, PLANK); m.set(x1, y, z, PLANK); }
    }
    for (let i = 0; i + 1 < xs.length; i++) for (let y = 1; y + 8 <= sTop; y += 18) m.line(xs[i], y, z1, xs[i + 1], y + 8, z1, POLE);
    for (let i = 0; i + 1 < zs.length; i++) for (let y = 1; y + 8 <= sTop; y += 18) m.line(x1, y, zs[i], x1, y + 8, zs[i + 1], POLE);
    // a hoist with a marble block on the rope, a team pennant on the top standard
    if (k < STAGES - 1) {
      m.box(x0, 1, z1, 1, sTop + 6, 1, POLE);
      m.line(x0, sTop + 6, z1, x0 + 6, sTop + 6, z1, POLE);
      m.box(x0 + 6, sTop + 2, z1, 1, 4, 1, ROPE);
      m.box(x0 + 5, sTop, z1, 3, 2, 2, BLOCK);
    }
    m.set(x1, sTop, z1, TEAM); m.set(x1 - 1, sTop, z1, TEAM); m.set(x1 - 1, sTop - 1, z1, TEAM);
    // stacked blocks and timber at the site
    if (k < STAGES - 1) {
      m.box(N - 6, 1, N - 4, 4, 2, 3, BLOCK);
      if (k < STAGES - 3) m.box(N - 5, 3, N - 4, 3, 2, 3, BLOCK);
      m.box(1, 1, N - 3, 7, 1, 2, WOOD);
      if (k < STAGES - 2) m.box(2, 2, N - 3, 5, 1, 2, WOOD);
    }
  }
  return m;
}

// ---- writer (the format of scripts/export-models.mjs) ---------------------------
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

fs.mkdirSync(OUT, { recursive: true });
const g = new Group('techbuildings');
g.extra.voxel = VOX;
g.extra.stages = STAGES;
g.extra.types = { armory: { w: 4, h: 4 }, market: { w: 4, h: 4 } };
const PIVOT = [N / 2, 0, N / 2];
const geo = (m, seed = 7) => S.withExtras(buildVoxelGeometry(m, { size: VOX, pivot: PIVOT, jitter: 0.05, seed }), m, VOX, PIVOT, { maxY: m.extraMaxY ?? Infinity });
for (const [type, build] of [['armory', armory], ['market', market]]) {
  for (const age of [1, 2, 3]) {
    const full = build(age);
    weather(full);
    g.add(`${type}/a${age}`, geo(full, 11 + age));
    // construction stages from the Classical look only (they differ by age only in the roof, the last thing built)
    if (age === 1) for (let k = 0; k < STAGES; k++) g.add(`${type}/s${k}`, geo(stage(full, k), 11 + age));
  }
}
g.write();
