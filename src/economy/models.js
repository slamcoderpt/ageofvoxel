import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';

// Voxel models owned by the economy piece: huntable animals, fish, fishing
// boats, thrown spears, farm crops, field dressing and stockpile props.
// Every model faces +z (rot 0 = looking down +z), origin at ground centre.
export const ECON_VOXEL = 0.1;

const pick = (a, b, s) => (x, y, z) => (hash3(x, y, z, s) < 0.5 ? a : b);

// ---- animals ----------------------------------------------------------------
export function deerModel() {
  const m = new VoxelModel();
  const HIDE = pick(0xa8703e, 0x9a6434, 21), BELLY = 0xe8d8b8, DARK = 0x5a3a20, HOOF = 0x2e2218;
  // legs (slender), hooves
  for (const [x, z] of [[-2, -5], [1, -5], [-2, 4], [1, 4]]) {
    m.box(x, 0, z, 1, 1, 1, HOOF).box(x, 1, z, 1, 6, 1, HIDE);
  }
  // body
  m.ellipsoid(-0.5, 9, 0, 2.6, 2.4, 6.2, HIDE);
  m.box(-2, 7, -4, 3, 1, 8, BELLY);
  // white rump + tail
  m.box(-2, 8, -7, 3, 3, 1, BELLY).set(-1, 11, -7, DARK);
  // neck + head
  m.box(-1, 10, 5, 2, 5, 2, HIDE).box(-1, 11, 6, 2, 4, 1, HIDE);
  m.box(-2, 14, 6, 3, 3, 4, HIDE).box(-1, 14, 10, 2, 2, 1, BELLY).set(-1, 15, 11, HOOF);
  m.set(-2, 16, 8, DARK).set(0, 16, 8, DARK); // eyes
  m.set(-3, 17, 7, HIDE).set(1, 17, 7, HIDE); // ears
  // antlers
  const A = 0xd9c9a4;
  m.line(-2, 17, 7, -4, 21, 6, A).line(0, 17, 7, 2, 21, 6, A);
  m.line(-3, 19, 7, -4, 20, 9, A).line(1, 19, 7, 2, 20, 9, A);
  m.set(-5, 22, 5, A).set(3, 22, 5, A);
  return m;
}

export function boarModel() {
  const m = new VoxelModel();
  const HIDE = pick(0x4a3a30, 0x3b2e26, 23), BRISTLE = 0x2a201a, SNOUT = 0xb07a6a, TUSK = 0xf2ead8;
  for (const [x, z] of [[-3, -5], [1, -5], [-3, 3], [1, 3]]) m.box(x, 0, z, 2, 4, 2, BRISTLE);
  m.ellipsoid(-1, 7, -0.5, 3.6, 3.4, 6.5, HIDE);
  m.box(-1, 10, -5, 1, 2, 10, BRISTLE); // mane ridge
  m.box(-3, 5, 6, 5, 4, 3, HIDE); // head
  m.box(-2, 5, 9, 3, 2, 1, SNOUT);
  m.set(-3, 6, 9, TUSK).set(1, 6, 9, TUSK).set(-3, 7, 10, TUSK).set(1, 7, 10, TUSK);
  m.set(-3, 8, 8, 0x111111).set(1, 8, 8, 0x111111);
  m.set(-3, 9, 7, BRISTLE).set(1, 9, 7, BRISTLE);
  m.set(-1, 8, -7, BRISTLE).set(-1, 7, -8, BRISTLE); // tail
  return m;
}

// ---- fishing -------------------------------------------------------------------
export function fishModel() {
  const m = new VoxelModel();
  const S = pick(0x9fb8c8, 0x8aa6b8, 31);
  m.box(0, 0, -2, 1, 2, 5, S).set(0, 2, 0, 0x6a8494).set(0, -1, 0, 0xdde8ee);
  m.box(0, -1, -4, 1, 1, 1, S).box(0, 2, -4, 1, 1, 1, S).set(0, 0, -3, S).set(0, 1, -3, S);
  m.set(0, 1, 2, 0x111111);
  return m;
}

// A Greek fishing boat: planked hull, eye on the bow, mast with a team sail
// and a net heaped on the deck.
export function boatModel() {
  const m = new VoxelModel();
  const HULL = pick(0x7a5230, 0x6a4526, 41), RAIL = 0x4a3020, DECK = 0xa88258;
  const L = 34;
  for (let z = 0; z < L; z++) {
    const t = z / (L - 1);
    const half = Math.round(5 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)));
    if (half <= 0) continue;
    m.box(-half, 1, z - L / 2, half * 2, 3, 1, HULL);
    m.box(-half + 1, 0, z - L / 2, Math.max(1, half * 2 - 2), 1, 1, RAIL);
    m.box(-half + 1, 3, z - L / 2, Math.max(1, half * 2 - 2), 1, 1, DECK);
    m.set(-half, 4, z - L / 2, RAIL).set(half - 1, 4, z - L / 2, RAIL);
  }
  // bow & stern posts
  m.box(-1, 3, L / 2 - 2, 2, 4, 1, RAIL).box(-1, 6, L / 2 - 1, 2, 1, 1, RAIL);
  m.box(-1, 3, -L / 2, 2, 5, 1, RAIL).box(-1, 7, -L / 2 - 1, 2, 1, 1, RAIL);
  // painted eyes on the bow
  m.set(-4, 3, L / 2 - 5, 0xf2ead8).set(3, 3, L / 2 - 5, 0xf2ead8);
  m.set(-5, 3, L / 2 - 5, 0x1a1a1a).set(4, 3, L / 2 - 5, 0x1a1a1a);
  // mast + yard + sail
  m.box(-1, 4, 2, 1, 22, 1, RAIL);
  m.box(-8, 24, 2, 16, 1, 1, RAIL);
  for (let y = 12; y < 24; y++)
    for (let x = -7; x <= 6; x++) {
      const stripe = (y + 100) % 4 < 2;
      m.set(x, y, 3 + (y < 16 ? 1 : 0), stripe ? TEAM : 0xefe6d0);
    }
  // net heap + baskets of fish
  m.box(-3, 4, -9, 5, 2, 5, pick(0x9a9070, 0x7d7458, 43)).box(-2, 6, -8, 3, 1, 3, 0x8a8062);
  m.box(1, 4, 8, 3, 2, 3, 0xa57a3e).box(2, 6, 9, 1, 1, 1, 0x9fb8c8);
  // steering oar
  m.line(3, 6, -L / 2 + 2, 6, 0, -L / 2 - 3, RAIL);
  return m;
}

// ---- hunting ---------------------------------------------------------------------
export function spearModel() {
  const m = new VoxelModel();
  m.box(0, 0, -7, 1, 1, 13, 0x7a5a38);
  m.box(0, 0, 6, 1, 1, 2, 0xbfc4c8).set(0, 0, 8, 0xdfe4e8);
  return m;
}

export function meatModel() {
  const m = new VoxelModel();
  m.box(0, 0, 0, 4, 2, 3, pick(0xa8323a, 0x8c2630, 51)).box(1, 2, 1, 2, 1, 1, 0xe8d8c8);
  return m;
}

// ---- crops (0.1 voxels; one row of plants 1 tile long) ------------------------------
export function wheatRowModel(stage) {
  const m = new VoxelModel();
  const STALK = pick(0xb8b050, 0xa4a044, 61), EAR = pick(0xf0d060, 0xdcb444, 62), LEAF = pick(0x6f9a36, 0x5f8a2e, 63), YOUNG = pick(0x7fb040, 0x6a9c34, 65);
  for (let x = 0; x < 10; x++)
    for (let z = -1; z <= 0; z++) {
      const h = hash3(x, stage, z, 64);
      if (stage === 0) {
        // stubble: short cut stalks & straw on the soil
        if (h < 0.55) m.set(x, 0, z, h < 0.3 ? 0xc8b070 : 0xa89858);
        continue;
      }
      if (stage === 1) {
        // young green crop, leafy tufts
        const top = 2 + Math.floor(h * 3);
        for (let y = 0; y < top; y++) m.set(x, y, z, y === top - 1 ? YOUNG : LEAF);
        if (h > 0.6) m.set(x, top - 1, z + (h > 0.8 ? 1 : -1), YOUNG);
        continue;
      }
      // ripe wheat: tall straw with heavy golden ears that spill over
      const top = 5 + Math.floor(h * 3);
      for (let y = 0; y < top; y++) m.set(x, y, z, y < 2 ? LEAF : STALK);
      m.set(x, top, z, EAR).set(x, top + 1, z, EAR);
      if (h > 0.55) m.set(x, top, z + (h > 0.78 ? 1 : -1), EAR);
    }
  return m;
}

// ---- field dressing & stockpiles ------------------------------------------------------
export function fenceModel() {
  // 1 tile of rustic post-and-rail fence along x
  const m = new VoxelModel();
  const W = pick(0x7a5634, 0x6a4a2c, 71);
  m.box(0, 0, 0, 1, 6, 1, W);
  m.box(0, 4, 0, 10, 1, 1, W).box(0, 2, 0, 10, 1, 1, W);
  return m;
}
export function hayModel() {
  const m = new VoxelModel();
  const H = pick(0xe0c878, 0xcfb466, 72);
  m.cylinder(3, 0, 3, 3, 5, H).box(0, 2, 2, 7, 1, 2, 0xa88a48);
  return m;
}
export function sheafModel() {
  const m = new VoxelModel();
  const H = pick(0xe8c860, 0xd6b24c, 73);
  m.box(0, 0, 0, 3, 7, 3, H).box(-1, 7, -1, 5, 2, 5, H).box(0, 3, 0, 3, 1, 3, 0x9a7a3a);
  return m;
}
export function crateModel(fill) {
  const m = new VoxelModel();
  const W = pick(0x9a7040, 0x86602f, 74);
  m.box(0, 0, 0, 6, 4, 6, W).carve(1, 2, 1, 4, 2, 4);
  m.box(0, 3, 0, 6, 1, 1, 0x6a4a28).box(0, 3, 5, 6, 1, 1, 0x6a4a28);
  const F = fill === 'grapes' ? pick(0x5a2a6a, 0x6e3a7e, 75) : fill === 'apples' ? pick(0xc0282e, 0x9a2028, 76) : fill === 'fish' ? pick(0x9fb8c8, 0x7f98a8, 77) : pick(0xe8c860, 0xd6b24c, 78);
  m.box(1, 2, 1, 4, 2, 4, F).box(2, 4, 2, 2, 1, 2, F);
  return m;
}
export function sackModel() {
  const m = new VoxelModel();
  const S = pick(0xd8c8a0, 0xc8b890, 79);
  m.box(0, 0, 0, 4, 4, 3, S).box(1, 4, 1, 2, 1, 1, S).set(1, 5, 1, 0x8a6a40);
  return m;
}
export function amphoraModel() {
  const m = new VoxelModel();
  const C = pick(0xc0643a, 0xa85430, 80);
  m.box(1, 0, 1, 1, 1, 1, C).box(0, 1, 0, 3, 4, 3, C).box(1, 5, 1, 1, 2, 1, C).box(0, 5, 1, 3, 1, 1, 0x3a2a20);
  return m;
}
export function logPileModel() {
  const m = new VoxelModel();
  const B = pick(0x6b4428, 0x5a3820, 81), END = 0xc9a26a;
  const rows = [[0, 0], [2, 0], [4, 0], [6, 0], [1, 2], [3, 2], [5, 2], [2, 4], [4, 4]];
  for (const [x, y] of rows) {
    m.box(x, y, 0, 2, 2, 14, B);
    m.box(x, y, -1, 2, 2, 1, END).box(x, y, 14, 2, 2, 1, END);
  }
  return m;
}
export function goldPileModel() {
  const m = new VoxelModel();
  const G = pick(0xf2c230, 0xd9a520, 82);
  m.ellipsoid(3, 0, 3, 3.4, 2.4, 3.4, G, { glow: 0.1 });
  m.set(3, 3, 3, 0xffe070, { glow: 0.3 }).set(1, 2, 4, 0xffe070, { glow: 0.3 });
  for (let x = 0; x < 7; x++) for (let z = 0; z < 7; z++) m.remove(x, -1, z);
  return m;
}
export function cartModel() {
  const m = new VoxelModel();
  const W = pick(0x8a6038, 0x7a5430, 83);
  m.box(-4, 4, -6, 9, 1, 12, W).shell(-4, 5, -6, 9, 3, 12, W);
  m.box(-3, 5, -5, 7, 3, 10, pick(0xe8c860, 0xd6b24c, 84)).box(-2, 8, -3, 5, 1, 6, 0xe0c060);
  // two big spoked wheels standing in the yz plane
  for (const x of [-5, 5])
    for (let y = 0; y <= 6; y++)
      for (let z = -3; z <= 3; z++) {
        const d = Math.hypot(y - 3, z);
        if (d > 2.4 && d < 3.5) m.set(x, y, z, 0x4a3420);
        else if (d < 0.8 || (d < 3 && (y === 3 || z === 0))) m.set(x, y, z, 0x5a4028);
      }
  m.line(0, 4, 6, 0, 3, 12, W);
  return m;
}
