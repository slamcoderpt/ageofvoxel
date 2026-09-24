import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';

// Greek voxel buildings described in code. Footprint origin is (0,0,0); the
// model spans [0, w*4) x [0, h*4) voxels. The front (door) faces +z, which is
// towards the default camera.

const MARBLE = (x, y, z) => (hash3(x, y, z, 1) < 0.7 ? 0xece6d6 : 0xdcd4c0);
const MARBLE_SHADE = 0xcfc6b0;
const STONE = (x, y, z) => { const h = hash3(x, y, z, 2); return h < 0.45 ? 0xb8ad96 : h < 0.85 ? 0xa89d86 : 0xc6bca6; };
const PLASTER = (x, y, z) => (hash3(x, y, z, 4) < 0.8 ? 0xeee2c6 : 0xe2d4b4);
const ROOF = (x, y, z) => ((y + (x >> 1)) % 2 === 0 ? 0xb9532e : (hash3(x, y, z, 5) < 0.5 ? 0xc8663a : 0xa84a2a));
const WOOD = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0x7a5230 : 0x8b6139);
const DARK = 0x2e2118;
const BRONZE = 0xc99a3c;
const GOLD = 0xf2c14e;
const FIRE = 0xffa53a;

function steps(m, x, z, w, d, n, color = STONE) {
  for (let i = 0; i < n; i++) m.box(x + i, i, z + i, w - 2 * i, 1, d - 2 * i, color);
  return n;
}

function column(m, x, y, z, h) {
  m.box(x - 1, y, z - 1, 3, 1, 3, MARBLE_SHADE);           // base
  m.box(x, y + 1, z, 1, h - 2, 1, MARBLE);                 // shaft
  // fluting suggestion: slightly thicker shaft using a 2x2 core
  m.box(x, y + 1, z, 2, h - 2, 2, MARBLE);
  m.box(x - 1, y + h - 1, z - 1, 4, 1, 4, MARBLE_SHADE);   // capital
}

function colonnade(m, x0, z0, w, d, y, h, spacing = 3) {
  for (let x = x0; x <= x0 + w - 2; x += spacing) { column(m, x, y, z0, h); column(m, x, y, z0 + d - 2, h); }
  for (let z = z0 + spacing; z <= z0 + d - 2 - spacing; z += spacing) { column(m, x0, y, z, h); column(m, x0 + w - 2, y, z, h); }
}

// Gable roof with the ridge along z (pediments on the front/back faces).
// o = overhang in voxels. Returns the y just above the ridge.
function gableZ(m, x, y, z, w, d, o = 1, pediment = TEAM) {
  let s = 0;
  for (; ; s++) {
    const xl = x + s - o, xr = x + w - 1 - s + o;
    if (xl > xr) break;
    m.box(xl, y + s, z - o, 1, 1, d + 2 * o, ROOF);
    m.box(xr, y + s, z - o, 1, 1, d + 2 * o, ROOF);
    const inner = xr - xl - 1;
    if (inner > 0) {
      m.box(xl + 1, y + s, z, inner, 1, 1, s < 1 ? MARBLE : pediment);
      m.box(xl + 1, y + s, z + d - 1, inner, 1, 1, s < 1 ? MARBLE : pediment);
      m.box(xl + 1, y + s, z + 1, inner, 1, d - 2, ROOF);
    }
  }
  return y + s;
}

// Gable roof with the ridge along x.
function gableX(m, x, y, z, w, d, o = 1, gable = PLASTER) {
  let s = 0;
  for (; ; s++) {
    const zl = z + s - o, zr = z + d - 1 - s + o;
    if (zl > zr) break;
    m.box(x - o, y + s, zl, w + 2 * o, 1, 1, ROOF);
    m.box(x - o, y + s, zr, w + 2 * o, 1, 1, ROOF);
    const inner = zr - zl - 1;
    if (inner > 0) {
      m.box(x, y + s, zl + 1, 1, 1, inner, gable);
      m.box(x + w - 1, y + s, zl + 1, 1, 1, inner, gable);
      m.box(x + 1, y + s, zl + 1, w - 2, 1, inner, ROOF);
    }
  }
  return y + s;
}

function brazier(m, x, y, z) {
  m.box(x, y, z, 2, 2, 2, BRONZE);
  m.box(x, y + 2, z, 2, 1, 2, FIRE, { glow: 1 });
  m.set(x, y + 3, z, 0xffd27a, { glow: 1 });
}

function banner(m, x, y, z, h = 5, axis = 'x') {
  m.box(x, y, z, 1, h + 2, 1, WOOD);
  if (axis === 'x') m.box(x + 1, y + 2, z, 2, h, 1, TEAM);
  else m.box(x, y + 2, z + 1, 1, h, 2, TEAM);
  m.set(x, y + h + 2, z, GOLD);
}

export function townCenterModel() {
  const m = new VoxelModel();
  const S = 28;
  let y = steps(m, 0, 0, S, S, 2);
  // paved terrace
  m.box(2, y - 1, 2, S - 4, 1, S - 4, (x, yy, z) => ((x + z) % 4 === 0 ? 0xc3b89f : 0xd3c9b0));
  // inner hall
  m.box(6, y, 6, 16, 11, 16, PLASTER);
  m.box(6, y, 6, 16, 1, 16, STONE);
  // doors & windows on all sides
  m.carve(12, y, 21, 4, 6, 1).box(12, y, 21, 4, 6, 1, DARK);
  m.box(11, y + 6, 21, 6, 1, 1, MARBLE_SHADE);
  for (const x of [8, 18]) m.box(x, y + 5, 21, 2, 3, 1, DARK);
  for (const z of [9, 16]) { m.box(6, y + 5, z, 1, 3, 2, DARK); m.box(21, y + 5, z, 1, 3, 2, DARK); }
  // outer colonnade
  colonnade(m, 3, 3, S - 5, S - 5, y, 11, 4);
  // entablature with team frieze
  m.box(2, y + 11, 2, S - 4, 1, S - 4, MARBLE);
  m.box(2, y + 12, 2, S - 4, 1, S - 4, (x, yy, z) => ((x + z) % 3 === 0 ? MARBLE_SHADE : TEAM));
  m.box(2, y + 13, 2, S - 4, 1, S - 4, MARBLE);
  // main roof
  const top = gableZ(m, 3, y + 14, 3, S - 6, S - 6, 1);
  // small upper lantern / acroterion
  m.box(12, top, 12, 4, 2, 4, MARBLE);
  m.box(13, top + 2, 13, 2, 2, 2, GOLD, { glow: 0.2 });
  // braziers & banners at the entrance
  brazier(m, 4, y, 25); brazier(m, 22, y, 25);
  banner(m, 9, y, 26, 6, 'x'); banner(m, 18, y, 26, 6, 'x');
  return m;
}

export function houseModel() {
  const m = new VoxelModel();
  m.box(0, 0, 0, 12, 1, 12, STONE);
  m.box(1, 1, 1, 10, 7, 9, PLASTER);
  m.box(1, 1, 1, 10, 1, 9, STONE);
  // corner posts
  for (const [x, z] of [[1, 1], [10, 1], [1, 9], [10, 9]]) m.box(x, 1, z, 1, 7, 1, WOOD);
  // door + window
  m.box(4, 1, 9, 3, 4, 1, DARK); m.box(4, 5, 9, 3, 1, 1, WOOD);
  m.box(8, 4, 9, 1, 2, 1, DARK); m.box(1, 4, 5, 1, 2, 2, DARK); m.box(10, 4, 4, 1, 2, 2, DARK);
  // team band under the eaves
  m.box(1, 7, 1, 10, 1, 9, (x, y, z) => ((x + z) % 2 ? TEAM : PLASTER));
  gableX(m, 1, 8, 0, 10, 11, 1);
  // little porch awning & amphora
  m.box(3, 5, 10, 5, 1, 2, WOOD);
  m.box(9, 1, 10, 1, 2, 1, 0xb36a3a).set(9, 3, 10, 0x8f522c);
  return m;
}

export function storehouseModel() {
  const m = new VoxelModel();
  m.box(0, 0, 0, 12, 1, 12, STONE);
  // back wall + posts, open front
  m.box(1, 1, 1, 10, 6, 1, WOOD);
  m.box(1, 1, 1, 1, 6, 9, WOOD);
  m.box(10, 1, 1, 1, 6, 9, WOOD);
  for (const x of [1, 5, 10]) m.box(x, 1, 10, 1, 6, 1, WOOD);
  gableX(m, 0, 7, 0, 12, 12, 0);
  m.box(0, 7, 5, 12, 1, 2, TEAM);
  // goods: crates, log pile, gold sacks
  m.box(2, 1, 3, 2, 2, 2, 0x9b7040).box(2, 3, 3, 2, 1, 2, 0x8a6236);
  m.box(4, 1, 3, 2, 2, 2, 0xa27a48);
  for (let i = 0; i < 3; i++) m.box(6, 1 + i, 3 + i % 2, 4, 1, 1, 0x6e4526);
  m.box(7, 1, 7, 2, 2, 2, GOLD, { glow: 0.1 });
  m.box(3, 1, 7, 2, 1, 2, 0xd8c79a);
  return m;
}

export function farmModel() {
  const m = new VoxelModel();
  const S = 16;
  // fence
  for (let i = 0; i < S; i += 1) {
    const post = i % 3 === 0 ? 2 : 1;
    m.box(i, 0, 0, 1, post, 1, WOOD).box(i, 0, S - 1, 1, post, 1, WOOD);
    m.box(0, 0, i, 1, post, 1, WOOD).box(S - 1, 0, i, 1, post, 1, WOOD);
  }
  // crop rows
  for (let z = 2; z < S - 2; z += 2)
    for (let x = 2; x < S - 2; x++) {
      const h = hash3(x, 0, z, 9);
      if (h < 0.85) m.set(x, 0, z, h < 0.4 ? 0x7fa73a : 0x98b845);
      if (h < 0.35) m.set(x, 1, z, 0xd9c35a);
    }
  return m;
}

export function templeModel() {
  const m = new VoxelModel();
  const W = 20, D = 24;
  let y = steps(m, 0, 0, W, D, 3, MARBLE_SHADE);
  // cella
  m.box(5, y, 6, 10, 10, 13, MARBLE);
  m.box(8, y, 18, 4, 7, 1, DARK);
  // peristyle
  colonnade(m, 3, 3, W - 5, D - 5, y, 11, 3);
  m.box(3, y + 11, 3, W - 6, 1, D - 6, MARBLE);
  m.box(3, y + 12, 3, W - 6, 1, D - 6, (x, yy, z) => ((x + z) % 2 === 0 ? TEAM : GOLD));
  gableZ(m, 3, y + 13, 3, W - 6, D - 6, 1);
  // golden statue of the god on the front steps & sacred braziers
  m.box(9, y, 21, 2, 1, 2, MARBLE_SHADE);
  m.box(9, y + 1, 21, 2, 4, 2, GOLD, { glow: 0.25 });
  m.box(9, y + 5, 21, 2, 2, 2, GOLD, { glow: 0.25 });
  brazier(m, 2, y, 21); brazier(m, 16, y, 21);
  return m;
}

export function barracksModel() {
  const m = new VoxelModel();
  const S = 20;
  m.box(0, 0, 0, S, 1, S, STONE);
  // courtyard walls
  m.box(0, 1, 0, S, 4, 2, STONE);
  m.box(0, 1, 0, 2, 4, S, STONE);
  m.box(S - 2, 1, 0, 2, 4, S, STONE);
  m.box(0, 1, S - 2, 7, 4, 2, STONE);
  m.box(13, 1, S - 2, 7, 4, 2, STONE);
  // crenellations
  for (let i = 0; i < S; i += 2) { m.set(i, 5, 0, STONE); m.set(0, 5, i, STONE); m.set(S - 1, 5, i, STONE); }
  // main hall at the back
  m.box(2, 1, 2, 16, 8, 7, PLASTER);
  m.box(8, 1, 8, 4, 5, 1, DARK);
  for (let x = 3; x < 18; x += 3) m.box(x, 1, 9, 1, 8, 1, MARBLE);
  m.box(2, 9, 2, 16, 1, 8, TEAM);
  gableX(m, 2, 10, 1, 16, 9, 1);
  // gate towers with banners
  m.box(5, 1, S - 3, 3, 8, 3, STONE); m.box(12, 1, S - 3, 3, 8, 3, STONE);
  m.box(5, 9, S - 3, 3, 1, 3, ROOF); m.box(12, 9, S - 3, 3, 1, 3, ROOF);
  banner(m, 6, 10, S - 2, 4, 'x'); banner(m, 13, 10, S - 2, 4, 'x');
  // weapon rack & training dummy in the courtyard
  m.box(3, 1, 12, 1, 4, 1, WOOD).box(6, 1, 12, 1, 4, 1, WOOD).box(3, 4, 12, 4, 1, 1, WOOD);
  for (const x of [4, 5]) m.box(x, 1, 12, 1, 5, 1, 0x9aa0a6);
  m.box(15, 1, 13, 1, 4, 1, WOOD).box(14, 4, 13, 3, 1, 1, WOOD).box(15, 5, 13, 1, 2, 1, 0xc9b27a);
  return m;
}

export const BUILDING_MODELS = {
  town_center: townCenterModel,
  house: houseModel,
  storehouse: storehouseModel,
  farm: farmModel,
  temple: templeModel,
  barracks: barracksModel,
};
