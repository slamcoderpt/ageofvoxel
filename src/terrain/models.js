import { VoxelModel } from '../core/voxel.js';
import { hash3, RNG } from '../core/rng.js';

// Voxel models for terrain props: trees (10 variants), gold mine, berry bush.
// All models are built in voxel units; the renderer scales them.
export const PROP_VOXEL = 0.18;

const LEAF_OLIVE = [0x5d8a2e, 0x6f9b36, 0x4f7a26];
const LEAF_OAK = [0x3f7a24, 0x4f8f2c, 0x5fa032];
const LEAF_CYPRESS = [0x2f5e22, 0x3a6c28, 0x27511c];
const LEAF_PINE = [0x2d6a3a, 0x3a7d44, 0x245a30];
const BARK = 0x6b4a2e;

function leafColor(pal, seed) {
  return (x, y, z) => {
    const h = hash3(x, y, z, seed);
    // lighter on top, darker underneath
    return h < 0.33 ? pal[0] : h < 0.8 ? pal[1] : pal[2];
  };
}

function trunk(m, h, r = 0) {
  if (r === 0) m.box(0, 0, 0, 2, h, 2, BARK);
  else m.cylinder(0.5, 0, 0.5, r, h, BARK);
  m.box(-1, 0, 0, 1, 1, 2, BARK).box(2, 0, 0, 1, 1, 2, BARK).box(0, 0, -1, 2, 1, 1, BARK).box(0, 0, 2, 2, 1, 1, BARK);
}

export function makeTree(variant) {
  const m = new VoxelModel();
  const rng = new RNG(1000 + variant * 77);
  if (variant < 4) {
    // broadleaf / oak: clustered blobs
    const h = 9 + rng.int(0, 4);
    trunk(m, h);
    const pal = variant % 2 ? LEAF_OAK : LEAF_OLIVE;
    const blobs = 4 + rng.int(0, 3);
    m.ellipsoid(1, h + 3, 1, 6, 4, 6, leafColor(pal, variant));
    for (let i = 0; i < blobs; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(2, 4.5);
      m.ellipsoid(1 + Math.cos(a) * r, h + rng.range(1, 5), 1 + Math.sin(a) * r, rng.range(2.5, 4), rng.range(2, 3), rng.range(2.5, 4), leafColor(pal, variant + i));
    }
    // a couple of branch stubs
    m.line(1, h - 3, 1, 4, h, 2, BARK).line(0, h - 2, 1, -3, h + 1, 0, BARK);
  } else if (variant < 7) {
    // Mediterranean cypress: tall narrow flame shape
    const h = 3;
    trunk(m, h + 2);
    const H = 20 + rng.int(0, 6);
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = Math.max(0.6, 3.2 * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - t * 0.35));
      m.cylinder(0.5, h + y, 0.5, r, 1, leafColor(LEAF_CYPRESS, variant + y));
    }
  } else {
    // pine: stacked cones
    const h = 7 + rng.int(0, 3);
    trunk(m, h + 6);
    const tiers = 4;
    for (let t = 0; t < tiers; t++) {
      const base = h + t * 4;
      const r0 = 6 - t * 1.3;
      for (let y = 0; y < 5; y++) m.cylinder(0.5, base + y, 0.5, Math.max(0.7, r0 - y * 1.1), 1, leafColor(LEAF_PINE, variant * 9 + t));
    }
    m.box(0, h + tiers * 4 + 1, 0, 2, 2, 2, LEAF_PINE[0]);
  }
  return m;
}

export function makeGoldMine() {
  const m = new VoxelModel();
  const rng = new RNG(555);
  const rock = (x, y, z) => { const h = hash3(x, y, z, 3); return h < 0.5 ? 0x8b8378 : h < 0.85 ? 0x9f978a : 0x756e64; };
  // rocky mound ~ 3x3 tiles (16 voxels of 0.18 ~ 2.9 units)
  m.ellipsoid(8, 1, 8, 8, 4, 7, rock);
  m.ellipsoid(5, 3, 6, 4, 4, 4, rock);
  m.ellipsoid(11, 3, 10, 4, 3, 4, rock);
  m.carve(-2, -6, -2, 20, 6, 20);
  // gold veins and nuggets
  for (let i = 0; i < 60; i++) {
    const x = rng.int(1, 15), z = rng.int(1, 15);
    for (let y = 12; y >= 0; y--) {
      if (m.has(x, y, z)) { m.set(x, y + (rng.chance(0.5) ? 1 : 0), z, rng.chance(0.3) ? 0xffe066 : 0xf2b92b, { glow: 0.12 }); break; }
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = rng.int(0, 16), z = rng.int(0, 16);
    m.box(x, 0, z, 2, 1 + rng.int(0, 1), 2, 0xf5c542, { glow: 0.15 });
  }
  return m;
}

export function makeBerryBush() {
  const m = new VoxelModel();
  const rng = new RNG(99);
  m.ellipsoid(2.5, 2, 2.5, 3, 2.5, 3, (x, y, z) => (hash3(x, y, z, 8) < 0.5 ? 0x3f7f2a : 0x4f9433));
  m.carve(-2, -4, -2, 10, 4, 10);
  for (let i = 0; i < 14; i++) {
    const x = rng.int(0, 5), y = rng.int(1, 4), z = rng.int(0, 5);
    // push berries to the surface
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (m.has(x, y, z) && !m.has(x + dx, y, z + dz)) { m.set(x + dx, y, z + dz, rng.chance(0.5) ? 0xd9302f : 0xb3202a); break; }
    }
  }
  return m;
}
