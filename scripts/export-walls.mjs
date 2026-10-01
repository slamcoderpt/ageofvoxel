#!/usr/bin/env node
// Greek stone walls, pillars and gates for the Godot port (Age of Mythology:
// Retold's Greek stone wall: reference/walls/walls_01, walls_02, gate_01..04,
// combat_01, place_01). These models are Godot-only (the browser build has no
// walls), authored here in the same voxel format and palette as
// src/buildings/models.js and meshed by the same mesher (buildVoxelGeometry:
// per-voxel jitter, baked AO), written as the "walls" model group:
//
//   node scripts/export-walls.mjs [--out godot/assets/models]   (~3 s, deterministic)
//
// Voxel = 1/8 tile (0.125 world units: twice the buildings' resolution, so a
// crenellation, the meander and the dentils read at RTS distance). Every
// model is pivoted at the centre of its tile (x, z) on the ground (y = 0);
// walls run along +x, the faces look +z / -z. Read by
// godot/game/buildings/walls.gd. Names:
//   seg/<v>[/s<k>|/d<k>]   one straight tile of wall (x in [-0.5, 0.5)), 3 variants
//   arm[/s<k>|/d<k>]       half a tile, from the tile centre to +x (ends, corners, joins)
//   core[/s<k>|/d<k>]      the wall's cross-section round the tile centre (diagonal joins)
//   pillar[/s<k>|/d<k>]    square pillar on a joint, an end or a run (1.5 tiles across)
//   pillar_flag            the same with a flag pole and three pennants
//   pillar_gate[/s<k>|/d<k>]  a gate tower: the pillar next to a gate (1.75 tiles, taller, flag)
//   gate<L>[/s<k>|/d<k>]   a gate L tiles long (1..5) along x: the paved threshold and sill
//   gate<L>/leaf[/d<k>]    one door leaf, hinge at x = 0, closing towards +x
//   s0..s3                 construction: 0 = the staked-out foundation (stakes, team pennants),
//                          1..3 = the stone rising inside timber scaffolding
//   d1, d2                 damage: d1 = merlons knocked off, cracks, chips;
//                          d2 = the top broken in a jagged line, deep cracks, rubble at the foot
// The manifest also has `gates: {L: {opening}}` and `gate_tower: {half, top, over}` (voxels).
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

// ---- palette (src/buildings/models.js) --------------------------------------
const pick = (h, cols) => cols[Math.min(cols.length - 1, Math.floor(h * cols.length))];
const shade = (c, f) => {
  const r = Math.round(((c >> 16) & 255) * f), g = Math.round(((c >> 8) & 255) * f), b = Math.round((c & 255) * f);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
};
// dressed ashlar in running bond: two stone families, darker bed joints
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
// Retold's Greek stone wall: pale grey-beige limestone ashlar
const ASHLAR = (seed) => masonry([0xdcd3bf, 0xd0c6b0, 0xe4dcca], [0xc8bea8, 0xd5ccb8, 0xbdb39d], { len: 5, course: 2, bed: 0.86, head: 0.9, grime: 5, seed });
const QUOIN = masonry([0xe8e3d7, 0xdeD8ca, 0xf0ece2], [0xe2dccf, 0xd8d1c2, 0xebe6db], { len: 4, course: 4, bed: 0.82, head: 0.95, grime: 5, seed: 31 });
const BASE_STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 21); return h < 0.4 ? 0x8d8676 : h < 0.8 ? 0x7f786a : 0x9a9382; };
const PLINTH = masonry([0xa69f8f, 0x9b9484, 0xb0a998], [0x958e7e, 0xa39b8a, 0x8c8575], { len: 8, course: 3, bed: 0.78, head: 0.86, grime: 0, seed: 17 });
const MARBLE = (x, y, z) => { const h = hash3(x, y, z, 1); return h < 0.62 ? 0xf1ede4 : h < 0.9 ? 0xe7e2d6 : 0xddd6c7; };
const CORNICE = (x, y, z) => (hash3(x >> 1, y, z >> 1, 44) < 0.5 ? 0xe9e4d8 : 0xdfd9cb);
const PAVE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 8); return h < 0.4 ? 0xc9c0ab : h < 0.8 ? 0xbeb5a0 : 0xd2cab7; };
const DENTIL_D = 0x5a5246;
const FRIEZE_GROUND = 0x2b2a31;   // the dark ground of the meander band
const GILT = 0xc9a24a;            // painted gold fillets
const GILT_D = 0xa8843a;
const POLE = (x, y, z) => (hash3(x, y, z, 21) < 0.5 ? 0x8a6a48 : 0x7d5f40);
const PLANK = (x, y, z) => (hash3(x, y, z, 22) < 0.5 ? 0xb39470 : 0xa68863);
const ROPE = 0xcdb98a;
const DIRT = (x, y, z) => pick(hash3(x, y, z, 25), [0x8a7458, 0x7e6a50, 0x94805f, 0x857055]);
const DOOR_WOOD = (x, y, z) => {
  // vertical planks 2 voxels wide, each its own tone
  const p = Math.floor((x + 64) / 2);
  return pick(hash3(p, y >> 3, 0, 61), [0x8a4f2a, 0x7d4624, 0x96582f, 0x844b27, 0x9a5c33]);
};
const IRON = 0x3a3632;
const CRACK = 0x4a443b;
const RUBBLE = (x, y, z) => pick(hash3(x, y, z, 91), [0xcfc8b7, 0xbdb5a2, 0xa9a190, 0xd8d2c4, 0x968f80]);
const SHAFT = 0x6d5a45;

// The Greek key (meander), rows from the bottom, true = team: two hooks
// interlocking, period 8 on the walls (a tile is 8 voxels, so the key runs
// on unbroken from tile to tile), period 6 on the 12-voxel pillars.
const KEY8 = ['#.######', '#.....#.', '####..#.', '......#.', '#######.'];
const KEY6 = ['#.####', '#...#.', '###.#.', '....#.', '#####.'];
const meander = (u, r) => KEY8[r][((u % 8) + 8) % 8] === '#';
const meander6 = (u, r) => KEY6[r][((u % 6) + 6) % 6] === '#';
// Palmettes / lotus band (pillars): a fan every 6 voxels.
const PALM = ['..#..', '.###.', '#.#.#', '.#.#.', '..#..'];
const palmette = (u, r) => PALM[r][((u % 5) + 5) % 5] === '#';

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

// ---- the wall's cross-section -------------------------------------------------
// Profile (y): skirt -6..-1 (hangs into slopes), plinth 0..2 (8 thick, the
// top course a team ledge), body 3..11 (6 thick), gilt fillet 12, meander
// 13..17 (team on dark), dentils 18, cornice 19 (8 thick, the walkway floor),
// parapets 20 (2 thick each side), merlons 21..23 with a team cap.
export const WALL = { top: 24, body: [3, 11], frieze: 13, cornice: 19 };
function wallSection(m, x0, x1, { seed = 3, merlonAt = null } = {}) {
  const stone = ASHLAR(seed);
  const isMerlon = merlonAt || ((x) => { const k = ((x % 4) + 4) % 4; return k === 0 || k === 3; });
  for (let x = x0; x < x1; x++) {
    m.box(x, -6, -4, 1, 6, 8, BASE_STONE);
    m.box(x, 0, -4, 1, 2, 8, PLINTH);
    for (let z = -4; z < 4; z++) m.set(x, 2, z, z === -4 || z === 3 ? TEAM : PLINTH(x, 2, z));
    m.box(x, 3, -3, 1, 9, 6, stone);
    for (let z = -3; z < 3; z++) m.set(x, 12, z, z === -3 || z === 2 ? GILT : stone(x, 12, z));
    for (let r = 0; r < 5; r++) {
      const y = 13 + r;
      for (let z = -3; z < 3; z++) {
        const face = z === -3 || z === 2;
        // the far face reads the key mirrored, like the near one seen from behind
        const u = z === 2 ? x : -x - 1;
        m.set(x, y, z, face ? (meander(u, r) ? TEAM : FRIEZE_GROUND) : stone(x, y, z));
      }
    }
    for (let z = -4; z < 4; z++) {
      const out = z === -4 || z === 3;
      m.set(x, 18, z, out ? (((x % 2) + 2) % 2 ? DENTIL_D : CORNICE(x, 18, z)) : stone(x, 18, z));
    }
    for (let z = -4; z < 4; z++) m.set(x, 19, z, z <= -3 || z >= 2 ? CORNICE : PAVE);
    for (const z of [-4, -3, 2, 3]) m.set(x, 20, z, MARBLE);
    if (isMerlon(x)) {
      for (const z of [-4, -3, 2, 3]) {
        m.set(x, 21, z, MARBLE); m.set(x, 22, z, MARBLE);
        m.set(x, 23, z, z === -4 || z === 3 ? TEAM : MARBLE);   // team on the outer edge
      }
    }
  }
}
// the same cross-section round the tile centre, merlons at its two corners
function core(m) {
  wallSection(m, -3, 3, { merlonAt: (x) => x === -3 || x === 2 });
  // and the same across z so a diagonal join has stone on every side
  for (let z = -3; z < 3; z++) {
    m.box(-4, -6, z, 8, 6, 1, BASE_STONE);
  }
}

// ---- pillar -------------------------------------------------------------------
// 12 x 12 (x, z in [-6, 6)), a stepped plinth, quoined corners, team stripes,
// a palmette frieze, dentils and a projecting cornice, a hollow crenellated top.
export const PILLAR = { half: 5, top: 30 };
function pillar(m, { half = 5, seed = 7, top = 30, flag = false, frieze = 'palm' } = {}) {
  const stone = ASHLAR(seed);
  const H = half;
  const faceDist = (x, z) => Math.min(x + H, H - 1 - x, z + H, H - 1 - z);
  const faceU = (x, z) => (z === -H || z === H - 1 ? (z === H - 1 ? x : -x) : (x === H - 1 ? -z : z));
  for (let x = -H - 1; x < H + 1; x++) for (let z = -H - 1; z < H + 1; z++) m.box(x, -6, z, 1, 6, 1, BASE_STONE);
  // plinth: a wider course, then the base proper
  m.box(-H - 1, 0, -H - 1, 2 * H + 2, 2, 2 * H + 2, PLINTH);
  m.box(-H, 2, -H, 2 * H, 2, 2 * H, PLINTH);
  for (let x = -H; x < H; x++) for (let z = -H; z < H; z++) {
    const d = faceDist(x, z);
    for (let y = 4; y < top - 12; y++) {
      let c = stone(x, y, z);
      if (d === 0) {
        const corner = (x === -H || x === H - 1) && (z === -H || z === H - 1);
        const nearCorner = Math.min(Math.abs(x + H), Math.abs(H - 1 - x)) < 2 && Math.min(Math.abs(z + H), Math.abs(H - 1 - z)) < 2;
        if (corner || nearCorner) c = QUOIN(x, y, z);
        if (y === 4 || y === top - 13) c = TEAM;
      }
      m.set(x, y, z, c);
    }
  }
  // gilt fillet + frieze (5 rows) + fillet
  const fy = top - 12;
  for (let x = -H; x < H; x++) for (let z = -H; z < H; z++) {
    const d = faceDist(x, z);
    // pillars: gold palmettes between team fillets (walls_02); gate towers:
    // the team meander between gold fillets (gate_03)
    const palm = frieze === 'palm';
    m.set(x, fy, z, d === 0 ? (palm ? TEAM : GILT) : stone(x, fy, z));
    for (let r = 0; r < 5; r++) {
      const u = faceU(x, z);
      const on = palm ? palmette(u, r) : meander6(u, r);
      m.set(x, fy + 1 + r, z, d === 0 ? (on ? (palm ? GILT : TEAM) : FRIEZE_GROUND) : stone(x, fy + 1 + r, z));
    }
    m.set(x, fy + 6, z, d === 0 ? (palm ? TEAM : GILT_D) : stone(x, fy + 6, z));
  }
  // dentils (projecting 1), cornice (projecting 1, 2 courses)
  const dy = fy + 7;
  for (let x = -H - 1; x < H + 1; x++) for (let z = -H - 1; z < H + 1; z++) {
    const out = x === -H - 1 || x === H || z === -H - 1 || z === H;
    m.set(x, dy, z, out ? ((((x + z) % 2) + 2) % 2 ? DENTIL_D : CORNICE(x, dy, z)) : stone(x, dy, z));
    m.set(x, dy + 1, z, CORNICE);
    m.set(x, dy + 2, z, out ? CORNICE : PAVE);
  }
  // hollow parapet with merlons, team caps
  const py = dy + 3;
  for (let x = -H - 1; x < H + 1; x++) for (let z = -H - 1; z < H + 1; z++) {
    const ring = Math.min(x + H + 1, H - x, z + H + 1, H - z);
    if (ring > 1) continue;
    m.set(x, py, z, MARBLE);
    const along = (x === -H - 1 || x === H || x === -H || x === H - 1) ? z : x;
    const k = (((along + H + 1) % 4) + 4) % 4;
    if (k < 2) { m.set(x, py + 1, z, MARBLE); m.set(x, py + 2, z, TEAM); }
  }
  if (flag) {
    // a pole at the back corner, leaning a little, three team pennants
    const px = H - 3, pz = -H + 2;
    for (let y = py; y < py + 22; y++) m.set(px + (y > py + 14 ? 1 : 0), y, pz, SHAFT);
    for (let i = 0; i < 3; i++) {
      const y0 = py + 20 - i * 3;
      for (let j = 0; j < 6 - i; j++) {
        const hgt = Math.max(1, 2 - Math.floor(j / 3));
        for (let k = 0; k < hgt; k++) m.set(px + 2 + j, y0 - k, pz, TEAM);
      }
    }
    m.set(px + 1, py + 22, pz, GILT);
  }
  return m;
}

// ---- gate -----------------------------------------------------------------------
// A gate is L tiles of the wall line (1..5) along x between two gate towers
// (`pillar_gate`: 14 x 14, taller than a pillar, the meander frieze, a
// flag), which stand on the tiles either side and overhang the gate's rect
// by GATE_TOWER.over voxels, so the opening is L * 8 - 2 * over. The frame
// is the paved threshold with a timber sill; the two door leaves are their
// own model so they can swing.
export const GATE_TOWER = { half: 7, top: 34, over: 3 };
const gateOpening = (L) => L * 8 - 2 * GATE_TOWER.over;
function gateFrame(m, L) {
  const R = L * 4;
  for (let x = -R; x < R; x++) {
    m.box(x, -6, -4, 1, 6, 8, BASE_STONE);
    for (let z = -4; z < 4; z++) m.set(x, 0, z, z === -4 || z === 3 ? PLINTH(x, 0, z) : PAVE(x, 0, z));
  }
  const O = gateOpening(L);
  for (let x = -O / 2; x < O / 2; x++) m.set(x, 1, 0, shade(DOOR_WOOD(x, 1, 0), 0.75));
  return m;
}
// one door leaf: hinge at x = 0, O / 2 voxels towards +x, 2 thick (z -1..0), 20 high
function gateLeaf(m, L) {
  const w = gateOpening(L) / 2;
  for (let x = 0; x < w; x++) for (let z = -1; z < 1; z++) for (let y = 1; y < 21; y++) {
    let col = DOOR_WOOD(x, y, z);
    if (y === 1 || y === 7 || y === 13) col = IRON;                    // iron bands
    if (y >= 15 && y <= 19) {                                          // meander trim
      col = meander(z === 0 ? x : w - 1 - x, y - 15) ? TEAM : FRIEZE_GROUND;
    }
    if (y === 14 || y === 20) col = GILT_D;
    if (x === w - 1 && y < 14) col = shade(DOOR_WOOD(x, y, z), 0.7);   // the meeting stile
    if (x === 0 && y < 14) col = IRON;                                  // hinge post
    m.set(x, y, z, col);
  }
  // studs on both faces
  for (let x = 1; x < w - 1; x += 2) for (const y of [4, 10]) for (const z of [-2, 1]) m.set(x, y, z, IRON);
  return m;
}
// a battered leaf: planks split and missing, the trim hanging
function leafDamage(full, d) {
  const m = new VoxelModel();
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v) continue;
    const plank = x >> 1;
    const h = hash3(plank, y >> 2, 3, 70 + d);
    if (d === 2 && y > 6 + Math.floor(hash3(plank, 1, 1, 77) * 14)) continue;
    if (h < (d === 1 ? 0.08 : 0.2)) continue;
    copyVox(m, v, x, y, z);
    if (hash3(x, y, z, 78) < (d === 1 ? 0.06 : 0.12)) m.set(x, y, z, CRACK);
  }
  return m;
}

// ---- construction and damage ------------------------------------------------------
function bboxOf(full) {
  const b = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9, top: 0 };
  for (const [x, y, z] of full.coords) {
    if (y < 0 || !full.has(x, y, z)) continue;
    b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
    b.top = Math.max(b.top, y + 1);
  }
  return b;
}
// stage 0: the staked-out foundation (place_01): a dirt and stone bed, stakes
// round it with team pennants; 1..3: the courses rising inside a timber
// scaffold (combat_01), the parapet only on the finished wall.
function stage(full, k, { flags = true } = {}) {
  const b = bboxOf(full);
  const m = new VoxelModel();
  const cut = k <= 0 ? 0 : Math.round(3 + (b.top - 9) * (k / STAGES));
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v) continue;
    if (y < 0) { copyVox(m, v, x, y, z); continue; }
    if (k <= 0) continue;
    if (y >= cut) continue;
    copyVox(m, v, x, y, z);
  }
  const { x0, x1, z0, z1 } = b;
  if (k <= 0) {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) m.set(x, 0, z, (x + z) % 5 ? DIRT : BASE_STONE);
    const sx = [];
    for (let x = x0; x <= x1; x += 4) sx.push(x);
    if (sx[sx.length - 1] !== x1) sx.push(x1);
    for (const x of sx) for (const z of [z0, z1]) {
      m.box(x, 1, z, 1, 6, 1, POLE);
      if (flags && (x === x0 || x === x1 || x0 === x1)) {
        m.set(x + (x === x1 ? -1 : 1), 6, z, TEAM); m.set(x + (x === x1 ? -1 : 1), 5, z, TEAM);
        m.set(x + (x === x1 ? -2 : 2), 6, z, TEAM);
      }
    }
    for (let x = x0; x <= x1; x++) { m.set(x, 3, z0, ROPE); m.set(x, 3, z1, ROPE); }
    return m;
  }
  // scaffold: standards just outside both faces every 4 voxels, ledgers every
  // 5 rows, a plank walk at the working level, braces on the faces
  const sTop = Math.min(b.top + 2, cut + 4);
  const zs = [z0 - 1, z1 + 1];
  const xs = [];
  for (let x = x0; x <= x1; x += 4) xs.push(x);
  if (xs[xs.length - 1] !== x1) xs.push(x1);
  for (const x of xs) for (const z of zs) m.box(x, 1, z, 1, sTop, 1, POLE);
  const ext = x1 - x0 > 10;   // a pillar: scaffold on the other two sides as well
  if (ext) for (let z = z0; z <= z1; z += 4) for (const x of [x0 - 1, x1 + 1]) m.box(x, 1, z, 1, sTop, 1, POLE);
  const walk = Math.max(3, cut);
  const levels = [walk];
  for (let y = 5; y < walk - 2; y += 5) levels.push(y);
  for (const y of levels) {
    for (let x = x0 - 1; x <= x1 + 1; x++) for (const z of zs) m.set(x, y, z, PLANK);
    if (ext) for (let z = z0 - 1; z <= z1 + 1; z++) for (const x of [x0 - 1, x1 + 1]) m.set(x, y, z, PLANK);
  }
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let y = 1; y + 4 <= sTop; y += 10) m.line(xs[i], y, z1 + 1, xs[i + 1], y + 4, z1 + 1, POLE);
  }
  // a pennant on the scaffold's highest standard
  m.set(xs[0], sTop, zs[1], TEAM); m.set(xs[0] + 1, sTop, zs[1], TEAM); m.set(xs[0] + 1, sTop - 1, zs[1], TEAM);
  // blocks waiting at the foot
  m.box(x0, 0, z1 + 2, 2, 1, 2, RUBBLE);
  return m;
}
// d1: merlons knocked off, cracks running down the faces, chipped arrises;
// d2: the top broken in a jagged line, deep cracks, rubble at the foot.
function damage(full, d, seed = 5) {
  const b = bboxOf(full);
  const m = new VoxelModel();
  const cutAt = new Map();
  const colKey = (x, z) => `${x >> 1},${z >> 1}`;
  for (const [x, y, z] of full.coords) {
    const kk = colKey(x, z);
    if (cutAt.has(kk)) continue;
    let c = b.top;
    const h = hash3(x >> 1, 7, z >> 1, seed + d);
    if (d === 1 && h < 0.45) c = b.top - 3;
    if (d === 2) {
      const n = hash3(x >> 2, 9, z >> 2, seed) * 0.6 + h * 0.4;
      c = Math.round(b.top - 4 - n * 11);
    }
    cutAt.set(kk, c);
  }
  for (const [x, y, z] of full.coords) {
    const v = full.get(x, y, z);
    if (!v) continue;
    if (y >= cutAt.get(colKey(x, z))) continue;
    // chips: surface voxels on the arrises
    const exposed = !full.has(x + 1, y, z) || !full.has(x - 1, y, z) || !full.has(x, y, z + 1) || !full.has(x, y, z - 1);
    if (exposed && y > 3 && hash3(x, y, z, seed + 30) < (d === 1 ? 0.04 : 0.09)) continue;
    copyVox(m, v, x, y, z);
  }
  // cracks: random walks down the faces from the broken top
  const nCracks = Math.max(1, Math.round(((b.x1 - b.x0 + 1) / 6) * (d === 1 ? 1 : 1.8)));
  for (let i = 0; i < nCracks; i++) {
    let x = b.x0 + Math.floor(hash3(i, 1, d, seed) * (b.x1 - b.x0 + 1));
    const zFace = hash3(i, 2, d, seed) < 0.6 ? b.z1 - (b.z1 - b.z0 > 8 ? 0 : 1) : b.z0 + (b.z1 - b.z0 > 8 ? 0 : 1);
    let y = Math.min(b.top - 2, cutAt.get(colKey(x, zFace)) - 1);
    const len = d === 1 ? 7 : 12;
    for (let s = 0; s < len && y > 2; s++) {
      for (const z of [zFace, zFace + (zFace > 0 ? 0 : 0)]) if (m.has(x, y, z)) m.set(x, y, z, CRACK);
      // a deep crack is open: remove the face voxel and darken the one behind
      if (d === 2 && s % 3 === 1 && m.has(x, y, zFace)) {
        m.remove(x, y, zFace);
        const zi = zFace > 0 ? zFace - 1 : zFace + 1;
        if (m.has(x, y, zi)) m.set(x, y, zi, CRACK);
      }
      y -= 1;
      x += hash3(i, s, d, seed + 3) < 0.33 ? -1 : hash3(i, s, d, seed + 4) < 0.5 ? 1 : 0;
    }
  }
  if (d === 2) {
    // rubble on both sides of the foot
    for (let x = b.x0 - 1; x <= b.x1 + 1; x++) for (const z0 of [b.z0 - 2, b.z1 + 1]) for (let dz = 0; dz < 2; dz++) {
      const h = hash3(x, 3, z0 + dz, seed + 50);
      if (h < 0.45) m.set(x, 0, z0 + dz, RUBBLE);
      if (h < 0.15) m.set(x, 1, z0 + dz, RUBBLE);
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
const g = new Group('walls');
g.extra.voxel = VOX;
g.extra.stages = STAGES;
g.extra.wall = WALL;
g.extra.pillar = PILLAR;
g.extra.gates = {};
const geo = (m, seed = 7) => buildVoxelGeometry(m, { size: VOX, pivot: [0, 0, 0], jitter: 0.05, seed });
// a model with its construction stages and damage states
function addFamily(name, build, { stages = true, dmg = true, seed = 7 } = {}) {
  const full = build(new Rec());
  g.add(name, geo(full, seed));
  if (stages) for (let k = 0; k < STAGES; k++) g.add(`${name}/s${k}`, geo(stage(full, k), seed));
  if (dmg) for (const d of [1, 2]) g.add(`${name}/d${d}`, geo(damage(full, d, seed), seed));
}
for (let v = 0; v < 3; v++) {
  addFamily(`seg/${v}`, (m) => { wallSection(m, -4, 4, { seed: 3 + v * 13 }); return m; }, { stages: v === 0, dmg: true, seed: 7 + v });
}
// half a tile: the merlon pattern continues the straight tiles' (merlon at
// local 0 and 3), so arms and segments line up wherever they meet
addFamily('arm', (m) => { wallSection(m, 0, 4, { seed: 3 }); return m; });
addFamily('core', (m) => { core(m); return m; });
addFamily('pillar', (m) => pillar(m, {}), { seed: 9 });
g.add('pillar_flag', geo(pillar(new Rec(), { flag: true }), 9));
addFamily('pillar_gate', (m) => pillar(m, { half: GATE_TOWER.half, seed: 11, top: GATE_TOWER.top, flag: true, frieze: 'key' }), { seed: 11 });
g.extra.gate_tower = GATE_TOWER;
for (const L of [1, 2, 3, 4, 5]) {
  g.extra.gates[L] = { opening: gateOpening(L) };
  addFamily(`gate${L}`, (m) => gateFrame(m, L), { seed: 11 });
  const leaf = gateLeaf(new Rec(), L);
  g.add(`gate${L}/leaf`, geo(leaf, 12));
  for (const d of [1, 2]) g.add(`gate${L}/leaf/d${d}`, geo(leafDamage(leaf, d), 12));
}
g.write();
