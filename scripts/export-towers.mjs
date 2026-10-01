#!/usr/bin/env node
// Greek towers for the Godot port, one model per upgrade stage (Age of
// Mythology: Retold: reference/walls/tower_05 the wooden sentry tower,
// tower_02 / tower_03 the stone watch and guard towers, tower_01 the fully
// upgraded tower with the bronze-green roof). Godot-only (the browser build
// has no towers), authored in the voxel format and palette of
// src/buildings/models.js and scripts/export-walls.mjs, meshed by the same
// mesher (buildVoxelGeometry: per-voxel jitter, baked AO), written as the
// "towers" model group:
//
//   node scripts/export-towers.mjs [--out godot/assets/models]   (~3 s, deterministic)
//
// Voxel = 1/8 tile (0.125 world units, the walls' resolution). The sim's
// tower is 2 x 2 tiles: every model is pivoted at the footprint centre on
// the ground (x, z in [-8, 8)), the door looks +z. Read by
// godot/game/buildings/towers.gd. Names (L = the sim's tower level,
// AovSim.get_fortify(owner).tower_level / get_walls().level):
//   L0 sentry    wooden sentry tower: four timber legs, X braces, a ladder, a
//                plank platform with a team-trimmed railing, a low plank roof, pennant
//   L1 watch     stone shaft with corner pilasters, door, ivy, a lantern room with
//                paired windows, a red tile gable roof with the team ridge
//   L2 guard     taller, a second ledge, deep panels, terracotta roof with
//                flared eaves, team-bordered banners on the lantern's sides
//   L3 ballista  the guard tower in its last dress: bronze-green roof, green
//                door, gilt acroteria and a gilt lion medallion, a ballista on the
//                lantern sill
//   <L>/s0..s3   construction: 0 = the staked foundation, 1..3 = rising in scaffolding
//   <L>/d1, d2   damage: d1 chipped and cracked; d2 the roof broken off, rubble
//   upgrade      timber scaffolding round the upper tower (drawn while a tower
//                stage is being researched)
// The manifest has `levels: [{name, arrow_y, top}]` (world units).
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

const VOX = 0.125;
const STAGES = 4;
const FORMAT = 2;

// ---- palette (src/buildings/models.js, scripts/export-walls.mjs) -------------
const pick = (h, cols) => cols[Math.min(cols.length - 1, Math.floor(h * cols.length))];
const shade = (c, f) => {
  const r = Math.round(((c >> 16) & 255) * f), g = Math.round(((c >> 8) & 255) * f), b = Math.round((c & 255) * f);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
};
function masonry(tonesA, tonesB, { len = 6, course = 3, bed = 0.84, head = 0.9, grime = 3, seed = 3 } = {}) {
  return (x, y, z) => {
    const row = Math.floor((y + 64) / course);
    const u = x + z + (row & 1) * (len >> 1) + 256;
    const blk = Math.floor(u / len);
    const h = hash3(blk, row, (x - z) >> 4, seed);
    const fam = hash3(row, 1, (x - z) >> 4, seed + 1) < 0.5 ? tonesA : tonesB;
    let c = pick(h, fam);
    if ((y + 64) % course === 0) c = shade(c, bed);
    else if (u % len === 0) c = shade(c, head);
    if (y < grime) c = shade(c, 0.88 + 0.03 * Math.max(0, y));
    return c;
  };
}
// the walls' limestone ashlar, a touch warmer on the towers' panels
const ASHLAR = masonry([0xdcd3bf, 0xd0c6b0, 0xe4dcca], [0xc8bea8, 0xd5ccb8, 0xbdb39d], { len: 5, course: 2, bed: 0.86, head: 0.9, grime: 5, seed: 41 });
const PANEL = masonry([0xdcd2bc, 0xd2c7b0, 0xe3dac6], [0xcbc0a8, 0xd5cbb5, 0xc2b79f], { len: 4, course: 2, bed: 0.84, head: 0.9, grime: 4, seed: 43 });
const QUOIN = masonry([0xe8e3d7, 0xded8ca, 0xf0ece2], [0xe2dccf, 0xd8d1c2, 0xebe6db], { len: 4, course: 4, bed: 0.82, head: 0.95, grime: 5, seed: 31 });
const BASE_STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 21); return h < 0.4 ? 0x8d8676 : h < 0.8 ? 0x7f786a : 0x9a9382; };
const DARK_BLOCK = masonry([0x6f695f, 0x625d54, 0x7a7468], [0x5a554d, 0x686258, 0x746e63], { len: 4, course: 3, bed: 0.8, head: 0.88, grime: 0, seed: 17 });
const MARBLE = (x, y, z) => { const h = hash3(x, y, z, 1); return h < 0.62 ? 0xf1ede4 : h < 0.9 ? 0xe7e2d6 : 0xddd6c7; };
const CORNICE = (x, y, z) => (hash3(x >> 1, y, z >> 1, 44) < 0.5 ? 0xe9e4d8 : 0xdfd9cb);
const DENTIL_D = 0x5a5246;
const GILT = 0xc9a24a;
const GILT_D = 0xa8843a;
const SOFFIT = 0x4a3d33;
const FRIEZE_GROUND = 0x2b2a31;   // the walls' dark meander ground
const KEY6 = ['#.####', '#...#.', '###.#.', '....#.', '#####.'];
const DARK = 0x221c18;            // the dark inside of a window
const DARK2 = 0x2e2620;
const IRON = 0x3a3632;
const CRACK = 0x4a443b;
const LEAF = (x, y, z) => pick(hash3(x, y, z, 12), [0x3d6b2f, 0x4a7b36, 0x55863b, 0x416f31, 0x5e8f3f]);
const RUBBLE = (x, y, z) => pick(hash3(x, y, z, 91), [0xcfc8b7, 0xbdb5a2, 0xa9a190, 0xd8d2c4, 0x968f80]);
const DIRT = (x, y, z) => pick(hash3(x, y, z, 25), [0x8a7458, 0x7e6a50, 0x94805f, 0x857055]);
const POLE = (x, y, z) => (hash3(x, y, z, 21) < 0.5 ? 0x8a6a48 : 0x7d5f40);
const PLANK = (x, y, z) => (hash3(x, y, z, 22) < 0.5 ? 0xb39470 : 0xa68863);
const ROPE = 0xcdb98a;
const CLOTH = (x, y, z) => (hash3(x, y >> 1, z, 64) < 0.5 ? 0xece4d0 : 0xe2d9c3);
// timber: weathered logs (sentry tower), sawn planks
const LOG = (x, y, z) => pick(hash3(x, y >> 1, z, 81), [0x7a5634, 0x6e4d2e, 0x84603b, 0x735131]);
const LOG_D = (x, y, z) => pick(hash3(x, y >> 1, z, 82), [0x5e4127, 0x553b23, 0x664629]);
const BOARD = (x, y, z) => { const p = (x + z + 64) >> 1; return pick(hash3(p, y >> 2, 5, 83), [0xa98457, 0x9c794f, 0xb38e60, 0x94714a]); };
const DECK = (x, y, z) => pick(hash3(x >> 1, y, z, 84), [0xb08b5c, 0xa58152, 0xba9666]);
// door planks: brown wood (watch, guard) or bronze-green (the last stage)
const DOOR_WOOD = (x, y, z) => pick(hash3((x + 64) >> 1, y >> 3, z, 61), [0x8a4f2a, 0x7d4624, 0x96582f, 0x844b27, 0x9a5c33]);
const DOOR_GREEN = (x, y, z) => pick(hash3((x + 64) >> 1, y >> 3, z, 62), [0x7fa886, 0x739c7a, 0x88b28f, 0x6c9273, 0x93b996]);
// roof tiles per stage: courses of tones, darker ribs between the tile rows
const ROOFS = {
  red: { tones: [0xa8452a, 0x9c3f27, 0xb44d2f, 0x933a24, 0xae4a2c], rib: 0.82, eave: 0x7e3420 },
  terra: { tones: [0xd06a3a, 0xc46136, 0xda7442, 0xbb5a32, 0xd57040, 0xc9663a], rib: 0.84, eave: 0x9a4a2a },
  bronze: { tones: [0x8fb08e, 0x84a684, 0x9aba97, 0x7c9d7d, 0xa3c19f, 0x88aa89], rib: 0.8, eave: 0x5f7d63 },
};

// Records the coordinates it was given, so stages and damage can be cut from it.
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
// a square ring of side 2h round the centre (x, z in [-h, h)), at height y
function ring(m, y, h, color) {
  for (let x = -h; x < h; x++) for (let z = -h; z < h; z++) {
    if (x === -h || x === h - 1 || z === -h || z === h - 1) m.set(x, y, z, color);
  }
}
const slab = (m, y, h, color) => m.box(-h, y, -h, 2 * h, 1, 2 * h, color);

// ---- the stone towers (L1..L3) ------------------------------------------------
// Profile (y, voxels): skirt -6..-1, dark base blocks 0..3 (pilaster feet with
// a team band on top), shaft 4..T-1 (corner pilasters 3 x 3 on a 12 x 12
// outline, recessed ashlar panels between, a ledge over the door, guard /
// ballista a second ledge), a team band under the upper cornice, the
// cornice T..T+2 (dentils, a projecting slab), the lantern room T+3..T+3+LH-1
// (corner columns, paired windows on every face, dark inside), its
// architrave, then the gable roof (ridge along z, pediments to +z / -z).
function stoneTower(m, o) {
  const T = o.T, LH = 12;
  const doorCol = o.door === 'green' ? DOOR_GREEN : DOOR_WOOD;
  const R = ROOFS[o.roof];
  // skirt and base blocks
  m.box(-7, -6, -7, 14, 6, 14, BASE_STONE);
  m.box(-7, 0, -7, 14, 1, 14, BASE_STONE);
  const isPil = (x, z) => (x < -3 || x >= 3) && (z < -3 || z >= 3);
  const deep = o.deep ? 2 : 1;   // panel recess
  for (let y = 1; y < T; y++) {
    for (let x = -6; x < 6; x++) for (let z = -6; z < 6; z++) {
      const edge = Math.min(x + 6, 5 - x, z + 6, 5 - z);
      if (isPil(x, z)) {
        // pilasters: dark blocks at the foot, a team band, quoined above
        let c;
        if (y <= 4) c = (x === -7 || x === 6 || z === -7 || z === 6) ? DARK_BLOCK(x, y, z) : DARK_BLOCK(x, y, z);
        else if (y === 5 || y === 6) c = edge === 0 ? TEAM : QUOIN(x, y, z);
        else if (y === T - 2) c = edge === 0 ? TEAM : QUOIN(x, y, z);
        else c = QUOIN(x, y, z);
        m.set(x, y, z, c);
      } else if (edge >= deep) {
        m.set(x, y, z, y <= 2 ? DARK_BLOCK(x, y, z) : PANEL(x, y, z));
      }
    }
    // the pilasters' feet stand out one voxel at the corners
    if (y <= 4) for (const x of [-7, 6]) for (const z of [-7, -6, -5, -4, 3, 4, 5, 6]) {
      m.set(x, y, z, DARK_BLOCK(x, y, z)); m.set(z, y, x, DARK_BLOCK(z, y, x));
    }
  }
  // a dark slot up the deep panels (guard / ballista: the open frame of tower_03)
  if (o.deep) {
    for (let y = 18; y < T - 6; y++) for (let u = -1; u < 1; u++) {
      for (const f of [-5, 4]) { m.set(u, y, f, DARK2); m.set(f, y, u, DARK2); }
    }
  }
  // the door on +z, with a marble frame and a lintel, iron studs
  const dz = 5 - deep;
  for (let y = 1; y < 12; y++) for (let x = -2; x < 2; x++) {
    let c = doorCol(x, y, dz);
    if (y === 4 || y === 9) c = shade(c, 0.78);
    if (x === -1 && (y === 6 || y === 7)) c = GILT_D;   // ring handles
    if (x === 0 && (y === 6 || y === 7)) c = GILT_D;
    m.set(x, y, dz, c);
    for (let z = dz + 1; z < 6; z++) m.remove(x, y, z);
  }
  for (let y = 1; y < 13; y++) for (const x of [-3, 2]) for (let z = dz; z < 6; z++) m.set(x, y, z, MARBLE);
  for (let x = -3; x < 3; x++) for (let z = dz; z < 7; z++) m.set(x, 12, z, CORNICE);
  // ledges: a marble band round the shaft over the door (and higher on the guard towers)
  const ledges = o.deep ? [13, T - 12] : [13];
  for (const ly of ledges) {
    ring(m, ly, 7, CORNICE);
    for (let x = -6; x < 6; x++) for (let z = -6; z < 6; z++) if (!isPil(x, z) && Math.min(x + 6, 5 - x, z + 6, 5 - z) === 0) m.set(x, ly, z, CORNICE);
  }
  // ivy up the front-left pilaster (tower_02, tower_03)
  if (o.ivy) {
    for (let y = 1; y < o.ivy; y++) {
      for (let u = -7; u <= -3; u++) {
        const h = hash3(u, y, 3, 55);
        const reach = 1 - y / o.ivy;
        if (h < 0.35 + 0.4 * reach) m.set(u, y, 6, LEAF);          // on the +z face
        if (hash3(u, y, 7, 56) < 0.3 + 0.4 * reach) m.set(-7, y, u + 9, LEAF);   // round the corner on -x
      }
    }
  }
  // guard / ballista: the walls' team meander on a dark band under the cornice
  // (scripts/export-walls.mjs pillar_gate), gilt fillets above and below
  if (o.frieze) {
    for (let r = -1; r < 6; r++) {
      const y = T - 6 + r;
      for (let x = -6; x < 6; x++) for (let z = -6; z < 6; z++) {
        const edge = Math.min(x + 6, 5 - x, z + 6, 5 - z);
        if (edge > 1) continue;
        if (edge === 1) { m.set(x, y, z, PANEL(x, y, z)); continue; }
        const u = z === 5 ? x : z === -6 ? -x : x === 5 ? -z : z;
        let c;
        if (r === -1 || r === 5) c = GILT;
        else c = KEY6[r][((u % 6) + 6) % 6] === '#' ? TEAM : FRIEZE_GROUND;
        m.set(x, y, z, c);
      }
    }
  }
  // the upper cornice: dentils, a projecting slab, a step
  for (let x = -7; x < 7; x++) for (let z = -7; z < 7; z++) {
    const out = x === -7 || x === 6 || z === -7 || z === 6;
    m.set(x, T, z, out ? ((((x + z) % 2) + 2) % 2 ? DENTIL_D : CORNICE(x, T, z)) : PANEL(x, T, z));
  }
  slab(m, T + 1, 8, CORNICE);
  slab(m, T + 2, 7, MARBLE);
  // the lantern room: corner columns, wall panels, two windows per face
  const L0 = T + 3, L1 = L0 + LH;   // [L0, L1)
  m.box(-5, L0, -5, 10, LH, 10, DARK);   // the dark inside
  // each face an arcade of two tall arched openings (3 wide) between the
  // corner pilasters and a central mullion (tower_01, tower_02)
  for (let y = L0; y < L1; y++) {
    for (let x = -6; x < 6; x++) for (let z = -6; z < 6; z++) {
      const edge = Math.min(x + 6, 5 - x, z + 6, 5 - z);
      if (edge > 0) continue;
      const corner = (x < -4 || x >= 4) && (z < -4 || z >= 4);
      const u = (z === -6 || z === 5) ? x : z;
      const inA = u >= -4 && u <= -2, inB = u >= 1 && u <= 3;
      const mid = u === -3 || u === 2;
      const open = (inA || inB) && ((y >= L0 + 1 && y < L1 - 3) || (y === L1 - 3 && mid));
      if (corner) m.set(x, y, z, y === L0 ? CORNICE : (y === L1 - 1 ? GILT_D : QUOIN(x, y, z)));
      else if (open) m.remove(x, y, z);
      else if (y === L0) m.set(x, y, z, CORNICE);
      else if (u === -1 || u === 0) m.set(x, y, z, MARBLE);
      else m.set(x, y, z, ASHLAR(x, y, z));
    }
  }
  // the pilasters stand proud of the arcade by one voxel
  for (let y = L0 + 1; y < L1; y++) for (const a of [-7, 6]) for (const b of [-6, 5]) {
    m.set(a, y, b, QUOIN(a, y, b)); m.set(b, y, a, QUOIN(b, y, a));
  }
  // window sills and the architrave
  for (let x = -7; x < 7; x++) for (let z = -7; z < 7; z++) {
    const out = x === -7 || x === 6 || z === -7 || z === 6;
    if (out) m.set(x, L1, z, CORNICE);
    else m.set(x, L1, z, MARBLE);
  }
  for (let x = -7; x < 7; x++) for (let z = -7; z < 7; z++) {
    const out = x === -7 || x === 6 || z === -7 || z === 6;
    m.set(x, L1 + 1, z, out ? (((x + z) & 1) ? SOFFIT : CORNICE(x, L1 + 1, z)) : MARBLE(x, L1 + 1, z));
  }
  // the gable roof, ridge along z, pediments at +z / -z, eaves over x
  const RB = L1 + 2;
  const halfW = o.flare ? 9 : 8;            // roof half width (x), flared on the guard towers
  const halfD = 8;                          // along z
  const rise = (d) => Math.floor(d * 0.62); // pitch
  for (let x = -halfW; x < halfW; x++) {
    const d = Math.min(x + halfW, halfW - 1 - x);   // 0 at the eaves
    const top = RB + rise(d);
    for (let z = -halfD; z < halfD; z++) {
      const pedFace = z === -halfD || z === halfD - 1;
      for (let y = RB; y <= top; y++) {
        let c;
        if (y === top) {
          const row = ((d >> 1) & 1);
          c = pick(hash3(x, z >> 1, d, 71), R.tones);
          if (((x + 64) & 1) === 0) c = shade(c, R.rib);           // the tile rows' cover joints
          if (((z + 64) % 3) === 0) c = shade(c, 0.92 + row * 0.02); // courses
          if (d === 0) c = R.eave;
          // the team ridge (tower_02: a blue cap the length of the roof)
          if (x === -1 || x === 0) c = TEAM;
        } else if (pedFace) {
          c = MARBLE(x, y, z);
        } else c = SOFFIT;
        m.set(x, y, z, c);
      }
      // flared eaves: the tile edge kicks out and down one voxel
      if (o.flare && d === 0) m.set(x, RB - 1, z, R.eave);
    }
  }
  // the pediments: a raking cornice, the tympanum, a medallion
  for (const zf of [-halfD + 1, halfD - 2]) {
    const sgn = zf > 0 ? 1 : -1;
    for (let x = -halfW + 1; x < halfW - 1; x++) {
      const d = Math.min(x + halfW, halfW - 1 - x);
      const top = RB + rise(d) - 1;
      for (let y = RB; y <= top; y++) m.set(x, y, zf + sgn, y === RB ? CORNICE : (y === top ? CORNICE : MARBLE));
    }
    const my = RB + 2;
    const med = o.lion ? GILT : MARBLE;
    m.set(-1, my, zf + 2 * sgn, med); m.set(0, my, zf + 2 * sgn, med);
    m.set(-1, my + 1, zf + 2 * sgn, med); m.set(0, my + 1, zf + 2 * sgn, med);
    if (o.lion) { m.set(-1, my, zf + 2 * sgn, GILT_D); }
  }
  const apex = RB + rise(halfW - 1);
  if (o.acroteria) {
    for (const z of [-halfD, halfD - 1]) {
      m.set(-1, apex + 1, z, GILT); m.set(0, apex + 1, z, GILT); m.set(-1, apex + 2, z, GILT_D); m.set(0, apex + 2, z, GILT);
      for (const x of [-halfW, halfW - 1]) { m.set(x, RB + 1, z, GILT); m.set(x, RB + 2, z, GILT_D); }
    }
  }
  // banners on the lantern's two sides (tower_03, tower_01): cream cloth,
  // team border, hung from the eaves
  if (o.banners) {
    for (const xs of [-7, 6]) {
      const xb = xs < 0 ? -7 : 6;
      for (let y = L0 - 2; y < L1 + 1; y++) for (let z = -3; z < 3; z++) {
        const border = z === -3 || z === 2 || y === L0 - 2 || y === L1;
        const tail = y === L0 - 2 && (z === -1 || z === 0);   // a notch in the hem
        if (tail) continue;
        const emblem = (z === -1 || z === 0) && (y === L0 + 4 || y === L0 + 5);
        m.set(xb + (xs < 0 ? -1 : 1), y, z, border ? CLOTH : (emblem ? GILT : TEAM));
      }
      for (let z = -4; z < 4; z++) m.set(xb + (xs < 0 ? -1 : 1), L1 + 1, z, IRON);   // the rod
    }
  }
  // the ballista on the front sill (the last stage): a bow and its stock
  if (o.ballista) {
    const y = L0;
    for (let x = -4; x < 4; x++) m.set(x, y + 1, 8, x === -4 || x === 3 ? IRON : LOG(x, y + 1, 8));
    m.box(-1, y, 6, 2, 1, 4, LOG_D);
    m.set(-1, y + 1, 9, IRON); m.set(0, y + 1, 9, IRON);
  }
  return { top: apex + 3, arrowY: (L0 + 4) * VOX };
}

// ---- the wooden sentry tower (L0) --------------------------------------------
// tower_05: a stilted lookout. Four logs on stone pads, X braces, a ladder
// up the front, a plank platform at y 32 (4 world units), a boarded railing
// with a team rail on top, posts up to a low plank roof trimmed in team
// colour and a pennant.
function sentryTower(m) {
  const P = 32, TOPR = 41, ROOF = 49;
  // stone pads
  for (const cx of [-6, 4]) for (const cz of [-6, 4]) {
    m.box(cx - 1, -4, cz - 1, 4, 4, 4, BASE_STONE);
    m.box(cx - 1, 0, cz - 1, 4, 1, 4, BASE_STONE);
  }
  // legs, 2 x 2 logs, battered: one voxel in from the foot to the platform
  for (let y = 1; y < ROOF; y++) {
    const inset = 0;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x0 = sx < 0 ? -6 + inset : 4 - inset, z0 = sz < 0 ? -6 + inset : 4 - inset;
      for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) m.set(x0 + i, y, z0 + k, (i + k) & 1 ? LOG(x0 + i, y, z0 + k) : LOG_D(x0 + i, y, z0 + k));
    }
  }
  // girts and X braces on all four faces
  const brace = (a0, y0, a1, y1, face, axisX) => {
    const n = Math.max(Math.abs(a1 - a0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = Math.round(a0 + (a1 - a0) * t), y = Math.round(y0 + (y1 - y0) * t);
      if (axisX) m.set(a, y, face, LOG_D); else m.set(face, y, a, LOG_D);
    }
  };
  for (const face of [-6, 5]) for (const axisX of [true, false]) {
    for (const [y0, y1] of [[3, 15], [16, 30]]) {
      brace(-4, y0, 3, y1, face, axisX);
      brace(3, y0, -4, y1, face, axisX);
    }
    for (const y of [15, 16]) for (let a = -5; a < 5; a++) axisX ? m.set(a, y, face, LOG(a, y, face)) : m.set(face, y, a, LOG(face, y, a));
  }
  // the ladder up the front (+z), beside the legs
  for (let y = 1; y < P; y++) {
    m.set(-2, y, 7, LOG_D); m.set(1, y, 7, LOG_D);
    if (y % 3 === 0) { m.set(-1, y, 7, LOG); m.set(0, y, 7, LOG); }
  }
  // platform: joists, a deck that overhangs, the boarded railing
  slab(m, P, 8, DECK);
  for (let x = -8; x < 8; x++) for (const z of [-8, 7]) m.set(x, P - 1, z, LOG_D);
  for (let z = -8; z < 8; z++) for (const x of [-8, 7]) m.set(x, P - 1, z, LOG_D);
  m.carve(-2, P, 6, 2, 1, 2);   // the hatch over the ladder
  for (let y = P + 1; y < TOPR; y++) {
    for (let x = -8; x < 8; x++) for (let z = -8; z < 8; z++) {
      if (!(x === -8 || x === 7 || z === -8 || z === 7)) continue;
      const corner = (x === -8 || x === 7) && (z === -8 || z === 7);
      const u = (z === -8 || z === 7) ? x : z;
      let c = corner ? LOG_D(x, y, z) : BOARD(x, y, z);
      if (!corner && y >= TOPR - 3 && ((u + 64) % 4 === 1)) c = null;   // loopholes under the rail
      if (c !== null) m.set(x, y, z, c);
    }
  }
  // the team rail along the top of the railing (tower_05's blue trim)
  ring(m, TOPR, 8, TEAM);
  // posts to the roof at the corners
  for (const x of [-8, 7]) for (const z of [-8, 7]) for (let y = TOPR + 1; y < ROOF; y++) m.set(x, y, z, LOG_D);
  // a low hipped plank roof, team-trimmed eaves
  for (let s = 0; s < 6; s++) {
    const h = 9 - s;
    for (let x = -h; x < h; x++) for (let z = -h; z < h; z++) {
      const edge = x === -h || x === h - 1 || z === -h || z === h - 1;
      if (!edge && s < 5) continue;
      m.set(x, ROOF + s, z, s === 0 ? TEAM : BOARD(x, ROOF + s, z));
    }
  }
  // a pennant pole on the roof
  for (let y = ROOF + 6; y < ROOF + 16; y++) m.set(0, y, 0, LOG_D);
  for (let j = 0; j < 5; j++) for (let k = 0; k < (j < 3 ? 3 : 2); k++) m.set(1 + j, ROOF + 15 - k, 0, TEAM);
  // a crate and a quiver rack on the deck (read through the loopholes)
  m.box(-6, P + 1, -6, 2, 2, 2, PLANK);
  return { top: ROOF + 16, arrowY: (P + 7) * VOX };
}

// ---- construction stages and damage -------------------------------------------
function bboxOf(full) {
  const b = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, top: 0 };
  for (const [x, y, z] of full.coords) {
    if (y < 0 || !full.has(x, y, z)) continue;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
    b.top = Math.max(b.top, y + 1);
  }
  return b;
}
// a timber scaffold round the tower from y0 to y1: standards at the corners
// and the middle of each side, plank walks every 8 rows, braces
function scaffold(m, y0, y1, h = 8) {
  const xs = [-h, -1, h - 1];
  for (const x of xs) for (const z of [-h, h - 1]) m.box(x, y0, z, 1, y1 - y0, 1, POLE);
  for (const z of [-1]) for (const x of [-h, h - 1]) m.box(x, y0, z, 1, y1 - y0, 1, POLE);
  for (let y = y0 + 6; y < y1; y += 8) {
    for (let a = -h; a < h; a++) {
      m.set(a, y, -h, PLANK); m.set(a, y, h - 1, PLANK); m.set(-h, y, a, PLANK); m.set(h - 1, y, a, PLANK);
    }
  }
  for (let y = y0 + 1; y + 6 < y1; y += 8) {
    m.line(-h, y, h - 1, -1, y + 6, h - 1, POLE);
    m.line(h - 1, y, h - 1, -1, y + 6, h - 1, POLE);
    m.line(-h, y, -h, -h, y + 6, -1, POLE);
  }
  // a pennant on the highest standard, a rope hoist
  m.set(-h, y1, h - 1, TEAM); m.set(-h + 1, y1, h - 1, TEAM); m.set(-h + 1, y1 - 1, h - 1, TEAM);
  for (let y = y0 + 2; y < y1 - 1; y++) m.set(h - 1, y, h, ROPE);
}
function stage(full, k) {
  const b = bboxOf(full);
  const m = new VoxelModel();
  const cut = k <= 0 ? 0 : Math.round(3 + (b.top - 14) * (k / STAGES));
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v) continue;
    if (y < 0) { copyVox(m, v, x, y, z); continue; }
    if (k <= 0 || y >= cut) continue;
    copyVox(m, v, x, y, z);
  }
  if (k <= 0) {
    // the staked foundation (place_01): a dirt and stone bed, stakes, team pennants, a rope
    for (let x = -7; x < 7; x++) for (let z = -7; z < 7; z++) m.set(x, 0, z, (x * 3 + z) % 5 ? DIRT : BASE_STONE);
    for (const x of [-8, -1, 7]) for (const z of [-8, -1, 7]) {
      if (x === -1 && z === -1) continue;
      m.box(x, 1, z, 1, 7, 1, POLE);
      if ((x === -8 || x === 7) && (z === -8 || z === 7)) { m.set(x + (x < 0 ? 1 : -1), 7, z, TEAM); m.set(x + (x < 0 ? 1 : -1), 6, z, TEAM); m.set(x + (x < 0 ? 2 : -2), 7, z, TEAM); }
    }
    for (let a = -8; a < 8; a++) { m.set(a, 4, -8, ROPE); m.set(a, 4, 7, ROPE); m.set(-8, 4, a, ROPE); m.set(7, 4, a, ROPE); }
    m.box(4, 1, 8, 3, 1, 2, RUBBLE);
    return m;
  }
  scaffold(m, 1, cut + 3);
  m.box(-6, 0, 8, 3, 1, 2, RUBBLE); m.box(3, 0, -10, 2, 2, 2, PLANK);
  return m;
}
function damage(full, d, seed = 5) {
  const b = bboxOf(full);
  const m = new VoxelModel();
  const cutAt = new Map();
  const colKey = (x, z) => `${x >> 1},${z >> 1}`;
  const roofLine = b.top - Math.round((b.top - 10) * 0.22);
  for (const [x, y, z] of full.coords) {
    const kk = colKey(x, z);
    if (cutAt.has(kk)) continue;
    let c = 1e9;
    const h = hash3(x >> 1, 7, z >> 1, seed + d);
    if (d === 1 && h < 0.3) c = b.top - 2;
    if (d === 2) c = Math.round(roofLine - 2 - (hash3(x >> 2, 9, z >> 2, seed) * 0.6 + h * 0.4) * 12);
    cutAt.set(kk, c);
  }
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v) continue;
    if (y >= cutAt.get(colKey(x, z))) continue;
    const exposed = !full.has(x + 1, y, z) || !full.has(x - 1, y, z) || !full.has(x, y, z + 1) || !full.has(x, y, z - 1);
    if (exposed && y > 3 && hash3(x, y, z, seed + 30) < (d === 1 ? 0.05 : 0.1)) continue;
    copyVox(m, v, x, y, z);
    if (exposed && !v.team && hash3(x, y >> 1, z, seed + 31) < (d === 1 ? 0.006 : 0.016)) m.set(x, y, z, CRACK);
  }
  // cracks: random walks down the four faces
  for (let i = 0; i < (d === 1 ? 3 : 6); i++) {
    const face = i % 4;
    let a = Math.floor(hash3(i, 1, d, seed) * 10) - 5;
    let y = Math.floor(b.top * (0.35 + 0.4 * hash3(i, 2, d, seed)));
    for (let s = 0; s < (d === 1 ? 10 : 16) && y > 2; s++, y--) {
      const [x, z] = face === 0 ? [a, 5] : face === 1 ? [5, a] : face === 2 ? [a, -6] : [-6, a];
      if (m.has(x, y, z)) m.set(x, y, z, CRACK);
      a += hash3(i, s, d, seed + 3) < 0.33 ? -1 : hash3(i, s, d, seed + 4) < 0.5 ? 1 : 0;
    }
  }
  if (d === 2) {
    for (let x = -9; x < 9; x++) for (let z = -9; z < 9; z++) {
      if (Math.max(Math.abs(x + 0.5), Math.abs(z + 0.5)) < 7) continue;
      const h = hash3(x, 3, z, seed + 50);
      if (h < 0.35) m.set(x, 0, z, RUBBLE);
      if (h < 0.1) m.set(x, 1, z, RUBBLE);
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
const g = new Group('towers');
g.extra.voxel = VOX;
g.extra.stages = STAGES;
g.extra.levels = [];
const geo = (m, seed = 7) => buildVoxelGeometry(m, { size: VOX, pivot: [0, 0, 0], jitter: 0.05, seed });
const LEVELS = [
  ['sentry', (m) => sentryTower(m)],
  ['watch', (m) => stoneTower(m, { T: 34, roof: 'red', door: 'wood', ivy: 24 })],
  ['guard', (m) => stoneTower(m, { T: 37, roof: 'terra', door: 'wood', ivy: 18, deep: true, flare: true, banners: true, frieze: true })],
  ['ballista', (m) => stoneTower(m, { T: 38, roof: 'bronze', door: 'green', ivy: 14, deep: true, flare: true, banners: true, frieze: true, lion: true, acroteria: true, ballista: true })],
];
LEVELS.forEach(([name, build], L) => {
  const full = new Rec();
  const info = build(full);
  g.extra.levels.push({ name, arrow_y: Math.round(info.arrowY * 1000) / 1000, top: info.top * VOX });
  g.add(`${L}`, geo(full, 7 + L));
  for (let k = 0; k < STAGES; k++) g.add(`${L}/s${k}`, geo(stage(full, k), 7 + L));
  for (const d of [1, 2]) g.add(`${L}/d${d}`, geo(damage(full, d, 5 + L), 7 + L));
});
{
  const m = new VoxelModel();
  scaffold(m, 26, 64, 9);
  g.add('upgrade', geo(m, 3));
}
g.write();
