import * as THREE from 'three';
import { VoxelModel, TEAM, buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';
import { BUILDING_VOXEL } from './defs.js';
import { GROUND } from '../core/GameMap.js';
import { withExtras } from './shapes.js';
import {
  WOOD, DARKWOOD, STONE, MARBLE, MARBLE_SHADE, BRONZE, GOLD, FIRE, LEAF,
  amphora, pithos, potPlant, cypress, olive, statue, hopliteStatue, roofTile, shade,
} from './models.js';

// Town dressing: visual-only props (well, market stalls, statues on plinths,
// fire pillars, amphorae, crates, cypresses, planters) anchored around built
// buildings so a town reads as lived in rather than a ring of copies.
// Props never block movement. Each building offers candidate spots (tile
// offsets from its footprint); a prop takes the first spot whose tiles are
// free (walkable, outside every building footprint, unused by another prop).
// The layout is recomputed when buildings appear or disappear.

const V = 4; // voxels per tile

// ---- prop models (built at BUILDING_VOXEL, origin at the footprint corner)
const PROPS = {
  well: {
    w: 2, h: 2,
    build(m) {
      m.cylinder(3.5, 0, 3.5, 3, 3, STONE);
      for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
        const d = Math.hypot(x - 3.5, z - 3.5);
        if (d < 2.3) { m.remove(x, 1, z); m.remove(x, 2, z); m.set(x, 0, z, 0x2f5d7a, { glow: 0.05 }); }
        else if (d < 3.4) m.set(x, 3, z, MARBLE);
      }
      m.box(1, 4, 3, 1, 5, 1, WOOD); m.box(6, 4, 3, 1, 5, 1, WOOD);
      m.box(0, 9, 3, 8, 1, 1, DARKWOOD);
      m.box(3, 5, 3, 1, 4, 1, 0xcdb98a); m.box(3, 4, 3, 2, 1, 1, 0x7a5230);
      for (let x = 0; x < 8; x++) { m.set(x, 10, 2, roofTile(x, 10, 2, true)); m.set(x, 10, 4, roofTile(x, 10, 4, true)); m.set(x, 11, 3, 0x8e3e22); }
      pithos(m, 6, 0, 6, 0xb8683e);
    },
  },
  // market stalls: timber frame, striped team awning, goods on the counter
  stall_food: { w: 2, h: 1, build: (m) => stall(m, 'food') },
  stall_pots: { w: 2, h: 1, build: (m) => stall(m, 'pots') },
  stall_cloth: { w: 2, h: 1, build: (m) => stall(m, 'cloth') },
  // market hall: an open timber frame on a paved floor, no tiled roof -
  // posts on stone bases, tie beams, a ridge beam and open slatted rafters
  // with striped cloths thrown over some bays, counters with goods beneath
  market: { w: 3, h: 2, build: (m) => market(m) },
  // potter's workshop yard: a domed clay kiln with a glowing stoke hole, a
  // wheel under a small shed, rows of drying pots, a fence round it
  kiln: { w: 2, h: 2, build: (m) => kiln(m) },
  statue: { w: 2, h: 2, build(m) { m.box(0, 0, 0, 8, 1, 8, MARBLE_SHADE); statue(m, 2, 1, 2, { bolt: true }); } },
  hoplite: { w: 1, h: 1, build(m) { hopliteStatue(m, 0, 0, 0); } },
  pillar: {
    w: 1, h: 1,
    build(m) {
      m.box(0, 0, 0, 4, 1, 4, MARBLE_SHADE);
      m.box(1, 1, 1, 2, 7, 2, MARBLE); m.box(1, 3, 1, 2, 1, 2, 0xa8372a); m.box(1, 4, 1, 2, 1, 2, 0xd2a847);
      m.box(0, 8, 0, 4, 1, 4, BRONZE);
      m.box(1, 9, 1, 2, 1, 2, FIRE, { glow: 0.4 });
      m.set(1, 10, 2, 0xffd27a, { glow: 0.4 });
    },
  },
  amphorae: {
    w: 1, h: 1,
    build(m) {
      pithos(m, 0, 0, 0, 0xb8683e); pithos(m, 2, 0, 2, 0xa65a34);
      amphora(m, 3, 0, 0, 0xc47440); amphora(m, 0, 0, 3, 0x9c5530);
      m.box(1, 0, 3, 1, 1, 1, 0xb8683e); // one lying on its side
    },
  },
  crates: {
    w: 1, h: 1,
    build(m) {
      m.box(0, 0, 0, 2, 2, 2, 0x9b7040); m.box(2, 0, 1, 2, 2, 2, 0xa27a48); m.box(0, 2, 0, 2, 1, 2, 0x8a6236);
      m.box(1, 2, 1, 2, 2, 2, 0xa27a48);
      m.box(0, 0, 3, 2, 1, 1, 0xd8c79a); m.set(3, 0, 3, 0xd8c79a); // grain sacks
    },
  },
  cypress: { w: 1, h: 1, build(m) { cypress(m, 1, 0, 1, 16); m.box(1, 0, 1, 1, 1, 1, 0x5a3e26); } },
  olive: { w: 1, h: 1, build(m) { olive(m, 1, 0, 1); } },
  // post-and-rail timber fence, 3 tiles long (along x; fence_z along z)
  fence_x: { w: 3, h: 1, ground: true, build: (m) => fence(m, 12, 'x') },
  fence_z: { w: 1, h: 3, ground: true, build: (m) => fence(m, 12, 'z') },
  // low rubble garden wall with a pale coping, 3 tiles long
  wall_x: { w: 3, h: 1, ground: true, build: (m) => lowWall(m, 12, 'x') },
  wall_z: { w: 1, h: 3, ground: true, build: (m) => lowWall(m, 12, 'z') },
  // fenced kitchen garden: wattle fence, rows of greens on dark soil,
  // a gap for the gate and a water jar
  garden: {
    w: 2, h: 2, ground: true,
    build(m) {
      for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) m.set(x, 0, z, (x + z) & 1 ? 0x5b4630 : 0x4e3b28);
      for (let z = 1; z < 7; z += 2) for (let x = 1; x < 7; x++) {
        const h = hash3(x, 4, z, 81);
        m.set(x, 1, z, h < 0.5 ? 0x5f8a2e : h < 0.8 ? 0x77a13a : 0x9bb84a);
        if (h < 0.25) m.set(x, 2, z, 0x6f9a36);
        if (h > 0.9) m.set(x, 1, z, 0xc0392b);
      }
      fence(m, 8, 'x', 0, 0); fence(m, 8, 'x', 0, 7); fence(m, 8, 'z', 0, 0); fence(m, 8, 'z', 7, 0);
      m.carve(3, 1, 7, 2, 3, 1);
      m.box(3, 0, 7, 2, 1, 1, 0x5b4630);
      pithos(m, 6, 1, 5, 0xa65a34);
    },
  },
  // big storage jars: two man-high pithoi with painted bands and a small one
  pithoi: {
    w: 2, h: 1,
    build(m) {
      bigJar(m, 0, 0, 0, 0xb8683e); bigJar(m, 4, 0, 1, 0xa65a34);
      amphora(m, 7, 0, 3, 0xc47440);
    },
  },
  // a painted marble maiden (kore) on a tall plinth
  kore: {
    w: 1, h: 1,
    build(m) {
      m.box(0, 0, 0, 4, 1, 4, MARBLE_SHADE);
      m.box(1, 1, 1, 2, 4, 2, MARBLE); m.box(0, 5, 0, 4, 1, 4, MARBLE_SHADE);
      m.box(1, 6, 1, 2, 4, 2, 0xa8372a);                    // painted peplos
      m.box(1, 6, 1, 2, 1, 2, 0xd2a847);                    // gilt hem
      m.box(1, 10, 1, 2, 2, 2, 0xe8e0d0);                   // shoulders / head
      m.set(1, 12, 1, 0x3a2a20).set(2, 12, 1, 0x3a2a20).set(1, 12, 2, 0x3a2a20).set(2, 12, 2, 0x3a2a20);   // hair
      m.set(0, 9, 1, 0xe8e0d0).set(3, 8, 2, 0xe8e0d0);
    },
  },
  // flower bed in a stone kerb
  flowers: {
    w: 2, h: 1, ground: true,
    build(m) {
      m.box(0, 0, 0, 8, 1, 4, MARBLE_SHADE); m.box(1, 0, 1, 6, 1, 2, 0x5b4630);
      for (let x = 1; x < 7; x++) for (let z = 1; z < 3; z++) {
        const h = hash3(x, 6, z, 82);
        m.set(x, 1, z, h < 0.3 ? LEAF : h < 0.5 ? 0xd9467a : h < 0.7 ? 0xf1c40f : h < 0.85 ? 0x9b59b6 : 0xf2ede2);
      }
    },
  },
  // a house's walled side court (1 x 3 tiles on the house's +x side): a low
  // whitewashed wall down the outer edge and across the front with a gate,
  // packed earth, an olive or a cypress, storage jars and a bench
  court_a: { w: 1, h: 3, build: (m) => court(m, 0) },
  court_b: { w: 1, h: 3, build: (m) => court(m, 1) },
  court_c: { w: 1, h: 3, build: (m) => court(m, 2) },
  court_d: { w: 1, h: 3, build: (m) => court(m, 3) },
  // altar before a temple: stepped marble base, red-painted die, fire
  altar: {
    w: 1, h: 1,
    build(m) {
      // 8 voxels wide, centred on the tile (spills half a tile each side)
      m.box(-2, 0, 0, 8, 1, 4, MARBLE_SHADE);
      m.box(-1, 1, 0, 6, 2, 3, MARBLE);
      m.box(-1, 2, 0, 6, 1, 3, 0xa8372a);
      m.box(-2, 3, 0, 8, 1, 3, MARBLE);
      m.box(1, 4, 1, 2, 1, 1, FIRE, { glow: 0.5 });
      m.set(1, 5, 1, 0xffd27a, { glow: 0.5 }).set(2, 4, 1, 0xffb347, { glow: 0.5 });
      m.set(-2, 4, 1, MARBLE).set(5, 4, 1, MARBLE);          // horns of the altar
    },
  },
  // temenos boundary wall (sits on paving, unlike garden walls)
  twall_x: { w: 3, h: 1, build: (m) => peribolos(m, 12, 'x') },
  twall_z: { w: 1, h: 3, build: (m) => peribolos(m, 12, 'z') },
  // temenos colonnade (sides and back): a stepped stylobate, square-set
  // marble columns with capitals, an architrave and a painted frieze
  tcol_x: { w: 3, h: 1, build: (m) => colonnade(m, 12, 'x') },
  tcol_z: { w: 1, h: 3, build: (m) => colonnade(m, 12, 'z') },
  planter: {
    w: 1, h: 1,
    build(m) {
      m.box(0, 0, 0, 4, 2, 4, MARBLE_SHADE); m.box(1, 1, 1, 2, 1, 2, 0x5b4630);
      for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
        const h = hash3(x, 2, z, 61);
        m.set(x, 2, z, h < 0.35 ? LEAF : h < 0.6 ? 0xc0392b : h < 0.8 ? 0x9b59b6 : 0xf1c40f);
      }
    },
  },
};

// Low whitewashed garden wall: plaster on a grey footing with a thin red
// painted band, square piers every three voxels and a terracotta coping.
function fence(m, len, axis, ox = 0, oz = 0) {
  const put = (a, y, c) => (axis === 'x' ? m.set(ox + a, y, oz, c) : m.set(ox, y, oz + a, c));
  for (let a = 0; a < len; a++) {
    const pier = a % 4 === 0 || a === len - 1;
    const wash = hash3(a >> 1, 1, ox + oz, 84) < 0.5 ? 0xf1ede4 : 0xe8e2d6;
    put(a, 0, 0xb3ab9a); put(a, 1, 0xa8452f); put(a, 2, wash);
    if (pier) { put(a, 3, wash); put(a, 4, 0xdcd5c4); } else put(a, 3, (a & 1) ? 0xdcd5c4 : 0xd2cbb9);
  }
}

function court(m, kind) {
  for (let z = 0; z < 12; z++) for (let x = 0; x < 3; x++) m.set(x, 0, z, hash3(x, 0, z, 85) < 0.5 ? 0x9a7d5a : 0x8f7352);
  // outer edge: a whitewashed wall (kinds 0-2) or a wattle fence (kind 3)
  for (let z = 0; z < 12; z++) {
    if (kind === 3) {
      m.set(3, 0, z, 0x7a5230); m.set(3, 1, z, (z & 1) ? 0x9b7a4c : 0x8a6a40); m.set(3, 2, z, (z & 1) ? 0x8a6a40 : 0x9b7a4c);
      if (z % 3 === 0) m.set(3, 3, z, 0x6a462a);
      continue;
    }
    const wash = hash3(z >> 1, 2, kind, 86) < 0.5 ? 0xf1ede4 : 0xe8e2d6;
    const h = kind === 2 ? 2 : 3;
    m.set(3, 0, z, 0xb3ab9a); m.set(3, 1, z, 0xa8452f);
    for (let y = 2; y <= h; y++) m.set(3, y, z, hash3(z, y, kind, 87) < 0.2 ? 0xd5c9ae : wash);
    m.set(3, h + 1, z, z % 4 === 0 ? 0xcf6a3c : 0xdcd5c4);
  }
  // front: a gate between two piers, only on the walled kinds
  if (kind < 2) for (let x = 0; x < 3; x++) {
    if (x === 1) continue;
    m.set(x, 0, 11, 0xb3ab9a); m.set(x, 1, 11, 0xa8452f); m.set(x, 2, 11, 0xefe9de); m.set(x, 3, 11, 0xefe9de); m.set(x, 4, 11, 0xdcd5c4);
  }
  if (kind === 0) {
    // kitchen garden: rows of greens and onions in dark soil, a bench
    for (let z = 1; z < 8; z++) for (let x = 0; x < 3; x++) {
      m.set(x, 0, z, 0x5b4630);
      if (z & 1) m.set(x, 1, z, hash3(x, 1, z, 88) < 0.5 ? 0x5e8c3a : 0x6e9a42);
    }
    m.box(0, 1, 9, 1, 1, 2, 0xcfc7b4);
    amphora(m, 2, 1, 9, 0xc47440);
  } else if (kind === 1) {
    cypress(m, 1, 1, 2, 14);
    m.box(0, 1, 6, 1, 1, 3, 0xcfc7b4);                           // stone bench
    amphora(m, 2, 1, 8, 0xa65a34); amphora(m, 2, 1, 6, 0xc47440);
  } else if (kind === 2) {
    // straw bee skeps on a plank stand, a fig tree
    m.box(0, 1, 1, 3, 1, 5, 0x7a5230);
    for (const z of [1, 3]) { m.box(0, 2, z, 2, 2, 2, 0xc9a55a); m.set(0, 4, z, 0xb89448); m.set(0, 2, z + 1, 0x3a2e22); }
    // a washing line between two posts with cloths drying, a stone bench
    m.box(1, 1, 6, 1, 5, 1, 0x6a462a); m.box(1, 1, 10, 1, 5, 1, 0x6a462a);
    m.box(1, 5, 7, 1, 1, 3, 0xcdb98a);
    m.box(1, 3, 7, 1, 2, 1, 0xefe8d6); m.box(1, 4, 9, 1, 1, 1, 0x3f6aa6); m.set(1, 3, 9, 0x3f6aa6);
    m.box(0, 1, 8, 1, 1, 2, 0xcfc7b4);
  } else {
    // hen coop: a low timber hutch under a thatch lean-to, hay, hens
    m.box(0, 1, 1, 3, 2, 3, 0x8a6a40); m.box(1, 1, 3, 1, 1, 1, 0x2a211b);
    m.box(0, 3, 0, 3, 1, 5, 0xc9a55a);
    m.box(0, 1, 6, 2, 1, 2, 0xd9bf6a); m.set(0, 2, 6, 0xd9bf6a);
    m.set(1, 1, 9, 0xf2ede2).set(1, 2, 9, 0xf2ede2).set(1, 2, 10, 0xc0392b);
    m.set(2, 1, 7, 0x9b6a3c).set(2, 2, 7, 0x9b6a3c);
    pithos(m, 0, 1, 9, 0xb8683e);
  }
}

function market(m) {
  const L = 12, D = 8;
  m.box(0, 0, 0, L, 1, D, (x, y, z) => ((x + z) & 1 ? 0xd6cfbf : 0xcbc3b0));
  const PX = [0, 6, 11];
  for (const x of PX) for (const z of [0, D - 1]) { m.set(x, 1, z, 0x9a9382); m.box(x, 2, z, 1, 8, 1, WOOD); }
  // wall plates along the long sides, tie beams across at every post
  for (const z of [0, D - 1]) m.box(0, 10, z, L, 1, 1, DARKWOOD);
  for (const x of PX) m.box(x, 10, 0, 1, 1, D, DARKWOOD);
  // king posts and a ridge beam, rafters every other voxel, one purlin
  for (const x of PX) m.box(x, 11, 3, 1, 2, 2, WOOD);
  m.box(0, 13, 3, L, 1, 2, DARKWOOD);
  const slope = [[0, 10], [1, 11], [2, 12]];   // [z, y] on the back slope
  for (let x = 0; x < L; x += 2) for (const [z, y] of slope) { m.set(x, y + 1, z, WOOD); m.set(x, y + 1, D - 1 - z, WOOD); }
  for (const zz of [1, D - 2]) m.box(0, 12, zz, L, 1, 1, DARKWOOD);
  // striped cloths over some bays: the front left bay in team stripes, the
  // back right bay in ochre stripes; the rest of the frame stays open
  const cloth = (x0, x1, front, c) => {
    for (let x = x0; x <= x1; x++) for (const [z, y] of slope) {
      const zz = front ? D - 1 - z : z;
      m.set(x, y + 2, zz, (x & 1) ? c : 0xf2ede2);
    }
    for (let x = x0; x <= x1; x++) m.set(x, 11, front ? D : -1, (x & 1) ? c : 0xf2ede2);
  };
  cloth(0, 5, true, TEAM);
  cloth(6, 11, false, 0xc98a2e);
  // counters and goods
  m.box(1, 1, 5, 4, 2, 1, 0x7a5230); m.box(1, 3, 5, 4, 1, 1, 0x9b7040);
  const goods = [0xc0392b, 0x6f9a36, 0xe0b93a, 0x6b3a6e, 0xd35400];
  for (let x = 1; x < 5; x++) m.set(x, 4, 5, goods[x % goods.length]);
  m.box(7, 1, 2, 4, 2, 1, 0x7a5230); m.box(7, 3, 2, 4, 1, 1, 0x9b7040);
  for (let x = 7; x < 11; x += 2) amphora(m, x, 4, 2, x & 2 ? 0xa65a34 : 0xc47440);
  pithos(m, 9, 1, 5, 0xb8683e); amphora(m, 10, 1, 6, 0xa65a34); amphora(m, 2, 1, 2, 0xc47440);
  m.box(3, 1, 1, 2, 1, 2, 0xb08850); m.set(3, 2, 1, 0xc0392b).set(4, 2, 2, 0xe0b93a);
  // hanging cloths from the tie beam
  for (let z = 2; z < 6; z++) if (z !== 4) m.box(6, 7, z, 1, 3, 1, [0xc0392b, 0x2e6fb0, 0xd49a3a][z % 3]);
}

function kiln(m) {
  for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) m.set(x, 0, z, hash3(x, 0, z, 112) < 0.5 ? 0x9a7d5a : 0x8f7352);
  // beehive kiln of mud brick with a dark stoke hole and fire
  for (let y = 1; y < 7; y++) {
    const r = y < 4 ? 2.4 : y === 4 ? 2.1 : y === 5 ? 1.6 : 0.9;
    for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) if (Math.hypot(x - 2, z - 2) <= r)
      m.set(x, y, z, hash3(x, y, z, 113) < 0.5 ? 0xb07a52 : 0xa06c46);
  }
  m.set(2, 7, 2, 0x3a3430);
  m.box(2, 1, 4, 1, 2, 1, 0xff9a3a, { glow: 0.6 });
  m.box(1, 1, 5, 3, 1, 1, 0x7a5a40);
  // potter's wheel under a small plank shade
  for (const [x, z] of [[5, 0], [7, 0], [5, 3], [7, 3]]) m.box(x, 1, z, 1, 4, 1, WOOD);
  m.box(4, 5, 0, 5, 1, 4, 0x8a6a40);
  m.box(6, 1, 1, 1, 1, 1, 0x5a3e26); m.box(6, 2, 1, 1, 1, 1, 0xb07a52);
  // drying pots on a board
  m.box(4, 1, 6, 4, 1, 1, 0x7a5230);
  for (let x = 4; x < 8; x++) amphora(m, x, 2, 6, x & 1 ? 0xc98c5e : 0xb8683e);
  m.set(0, 1, 7, 0x6a462a).set(0, 2, 7, 0x6a462a).set(1, 1, 7, 0x6a462a);   // fuel stack
}

// temenos boundary: a low marble kerb with square piers and a coping,
// running along the platform edge
function peribolos(m, len, axis) {
  const put = (a, y, c) => (axis === 'x' ? m.set(a, y, 1, c) : m.set(1, y, a, c));
  for (let a = 0; a < len; a++) {
    const pier = a % 4 === 0;
    put(a, 0, 0xcfc6b2); put(a, 1, (a & 1) ? 0xe9e3d6 : 0xe2dccd);
    if (pier) { put(a, 2, 0xece6da); put(a, 3, 0xd8d0bf); } else put(a, 2, 0xd8d0bf);
  }
}

function colonnade(m, len, axis) {
  const put = (a, y, k, c) => (axis === 'x' ? m.set(a, y, k, c) : m.set(k, y, a, c));
  for (let a = 0; a < len; a++) {
    for (let k = 0; k < 4; k++) put(a, 0, k, hash3(a >> 1, 0, k, 114) < 0.5 ? 0x8d8676 : 0x9a9382);
    for (let k = 0; k < 4; k++) put(a, 1, k, (a + k) & 1 ? 0xd8d0bf : 0xcfc7b4);
    for (let k = 0; k < 4; k++) {
      put(a, 10, k, k === 0 || k === 3 ? 0xe2dccd : 0xece6da);
      put(a, 11, k, k === 0 || k === 3 ? ((a & 3) === 1 ? 0xd2a847 : (a & 1) ? 0x2d4b82 : 0x34528a) : 0xe2dccd);
      put(a, 12, k, (a + k) & 1 ? 0xd6cfbf : 0xcdc5b3);
    }
    // columns: 2x2 shafts every 4 voxels with a base and a spreading capital
    const c = a % 4;
    if (c === 1 || c === 2) for (const k of [1, 2]) {
      put(a, 2, k, 0xd6cfbf);
      for (let y = 3; y < 9; y++) put(a, y, k, (a + k + y) & 1 ? 0xf2ede3 : 0xe9e3d6);
    }
    if (c === 1 || c === 2) for (let k = 0; k < 4; k++) put(a, 9, k, 0xe2dccd);
  }
}

function lowWall(m, len, axis) {
  const put = (a, y, k, c) => (axis === 'x' ? m.set(a, y, 1 + k, c) : m.set(1 + k, y, a, c));
  for (let a = 0; a < len; a++) for (let k = 0; k < 2; k++) {
    put(a, 0, k, 0xb3ab9a);
    for (let y = 1; y < 3; y++) put(a, y, k, hash3(a >> 1, y, k, 83) < 0.5 ? 0xf1ede4 : 0xe9e3d7);
    put(a, 3, k, (a & 3) === 0 ? 0xcfc7b4 : 0xdcd5c4);
  }
}

function bigJar(m, x, y, z, c) {
  m.box(x + 1, y, z + 1, 1, 1, 1, shade(c, 0.7));
  m.box(x, y + 1, z, 3, 1, 3, shade(c, 0.85));
  m.box(x, y + 2, z, 3, 1, 3, 0x2b2420);
  m.box(x, y + 3, z, 3, 1, 3, c);
  m.box(x, y + 4, z, 3, 1, 3, shade(c, 0.92));
  m.set(x + 1, y + 5, z + 1, shade(c, 0.8));
  m.set(x + 1, y + 6, z + 1, 0x8a8070);   // stone lid
}

function stall(m, kind) {
  for (const [x, z] of [[0, 0], [7, 0], [0, 3], [7, 3]]) m.box(x, 0, z, 1, 6, 1, WOOD);
  m.box(0, 2, 2, 8, 1, 2, 0x9b7040);                 // counter
  m.box(1, 0, 3, 6, 2, 1, 0x7a5230);
  // striped awning sloping down to the front
  // awning stripes: only the cloth seller flies the owner's colour
  const stripe = kind === 'food' ? 0xa8372a : kind === 'pots' ? 0xc98a2e : TEAM;
  for (let x = -1; x < 9; x++) {
    const c = (x & 1) ? stripe : 0xf2ede2;
    m.set(x, 7, 0, c).set(x, 7, 1, c).set(x, 6, 2, c).set(x, 6, 3, c).set(x, 5, 4, c);
  }
  if (kind === 'food') {
    const goods = [0xc0392b, 0x6f9a36, 0xe0b93a, 0x6b3a6e, 0xd35400];
    for (let x = 1; x < 7; x++) { m.set(x, 3, 3, goods[x % goods.length]); if (x & 1) m.set(x, 3, 2, goods[(x + 2) % goods.length]); }
    m.box(0, 0, 5, 2, 1, 2, 0xb08850); m.set(0, 1, 5, 0xc0392b).set(1, 1, 6, 0xe0b93a);
  } else if (kind === 'pots') {
    for (let x = 1; x < 7; x += 2) amphora(m, x, 3, 3, x & 2 ? 0xa65a34 : 0xc47440);
    pithos(m, 5, 0, 5, 0xb8683e); amphora(m, 1, 0, 5);
  } else {
    const cloth = [0xc0392b, 0xf2ede2, 0x2e6fb0, 0xd49a3a];
    for (let x = 1; x < 7; x++) m.box(x, 3, 2, 1, 1, 2, cloth[x % cloth.length]);
    for (let x = 1; x < 7; x += 2) m.box(x, 4, 1, 1, 2, 1, cloth[(x + 1) % cloth.length]);
    m.box(5, 0, 5, 2, 1, 2, 0x9b7040);
  }
}

// ---- anchors: candidate spots per building type, as [prop, dx, dz] in tiles
// relative to the footprint's min corner. A '|'-separated list of spots means
// "first free one wins".
function anchorsFor(b) {
  const w = b.w, h = b.h, v = Math.floor(hash3(b.tx, 5, b.tz, 71) * 4);
  switch (b.type) {
    // the agora: an open timber market hall on the front-left corner, a
    // tile clear of the Town Center, with its stalls in a row on the lane
    // below it; the well front-right, a statue on the north-east corner;
    // the front and sides of the Town Center stay open paving
    case 'town_center': return [
      ['market', [[-3, h + 1], [-3, h]]],
      ['stall_food', [[-3, h + 4], [-3, h + 3]]], ['stall_cloth', [[0, h + 4], [0, h + 3]]],
      ['well', [[w + 1, h], [w + 1, h - 1]]],
      ['statue', [[w + 1, -3], [w + 1, -2]]],
      ['cypress', [[-2, -2], [-1, -2]]], ['cypress', [[w + 1, 0], [w, -2]]],
    ];
    // each house keeps its dressing inside its own walled side court; the
    // front onto the street stays clear
    case 'house': return [
      [['court_a', 'court_b', 'court_c', 'court_d'][(v + (b.bld_variant | 0)) & 3], [[w, 0]]],
      ['wall_x', [[0, -1]]],
      ...(v & 2 ? [['cypress', [[-1, 0]]]] : []),
    ];
    // storehouse goods stay inside a fenced work yard beside and behind it
    case 'storehouse': return [
      ['fence_z', [[w + 1, -1]]], ['fence_z', [[-2, -1]]],
      ['crates', [[w, 0], [-1, 0]]], ['pithoi', [[-1, -1], [w - 1, -1]]],
      ['kiln', [[-4, 0], [w + 2, 0], [-4, 2]]],
    ];
    case 'temple': if (b.bld_temenos) return temenosAnchors(b);
      return [
      ['kore', [[-1, h]]], ['kore', [[w, h]]],
      ['pillar', [[-1, h - 2]]], ['pillar', [[w, h - 2]]],
      ['cypress', [[-1, 0], [-1, 1]]], ['cypress', [[w, 0], [w, 1]]],
      ['statue', [[w + 1, h - 1], [-3, h - 1], [w + 1, 2]]],
      ['flowers', [[0, h + 1]]], ['flowers', [[3, h + 1]]],
      ['hoplite', [[w, h + 1], [-1, h + 1]]],
    ];
    case 'barracks': return [
      ['pillar', [[-1, h - 1]]], ['pillar', [[w, h - 1]]], ['hoplite', [[w, 1], [-1, 1]]],
      ['fence_x', [[0, h + 1], [1, -1]]], ['fence_z', [[w + 1, 0], [-2, 0]]],
    ];
    default: return [];
  }
}

// A temple on a planned temenos: an open forecourt before the steps with the
// altar on the axis, fire pillars and statues flanking the approach, rows of
// cypresses down the sides, and a low boundary wall with a gate on the axis.
function temenosAnchors(b) {
  const w = b.w, h = b.h;
  const [ex, ez, ew, eh] = b.bld_temenos;
  const out = [
    ['altar', [[Math.floor(w / 2), h + 2]]],
    ['pillar', [[-1, h]]], ['pillar', [[w, h]]],
    ['statue', [[-3, h + 1]]], ['statue', [[w + 1, h + 1]]],
  ];
  for (const z of [0, 2, 4]) out.push(['cypress', [[-2, z]]], ['cypress', [[w + 1, z]]]);
  // boundary: back and sides in 3-tile runs, the front split by the gate
  const x0 = ex - b.tx, z0 = ez - b.tz, x1 = x0 + ew - 1, z1 = z0 + eh - 1;
  for (let x = x0; x + 2 <= x1; x += 3) out.push(['tcol_x', [[x, z0]]]);
  for (let z = z0 + 1; z + 2 <= z1 - 3; z += 3) out.push(['tcol_z', [[x0, z]]], ['tcol_z', [[x1, z]]]);
  for (let z = z0 + 1; z + 2 <= z1; z += 3) out.push(['twall_z', [[x0, z]]], ['twall_z', [[x1, z]]]);
  const gate0 = Math.floor(w / 2) - 2, gate1 = Math.floor(w / 2) + 2;   // 3-tile gate on the axis
  for (let x = x0; x + 2 < gate0 + 1; x += 3) out.push(['twall_x', [[x, z1]]]);
  for (let x = x1 - 2; x > gate1 - 1; x -= 3) out.push(['twall_x', [[x, z1]]]);
  return out;
}

export class Props {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'building-props';
    game.scene.add(this.group);
    this.geos = new Map();
    this.items = [];
    this.dirty = true;
    const mark = (e) => { if (!e || e.kind === 'building') this.dirty = true; };
    game.events.on('building:placed', mark);
    game.events.on('building:completed', mark);
    game.events.on('entity:removed', mark);
  }

  geometry(kind) {
    if (!this.geos.has(kind)) {
      const p = PROPS[kind];
      const m = new VoxelModel();
      p.build(m);
      const pivot = [p.w * V / 2, 0, p.h * V / 2];
      this.geos.set(kind, withExtras(buildVoxelGeometry(m, { size: BUILDING_VOXEL, pivot, jitter: 0.06 }), m, BUILDING_VOXEL, pivot));
    }
    return this.geos.get(kind);
  }

  layout() {
    const game = this.game, map = game.map;
    const blds = [...game.entities.buildings()];
    const used = new Set();
    const inBuilding = (x, z) => blds.some((o) => x >= o.tx && x < o.tx + o.w && z >= o.tz && z < o.tz + o.h);
    const c = map.cps;
    const groundAt = (x, z) => (map.inCols(x * c, z * c) ? map.ground[map.cIdx(x * c, z * c)] : -1);
    // `ground` props (fences, walls, gardens, beds) stay off streets and fields
    const free = (x, z, w, h, ground) => {
      for (let k = z; k < z + h; k++) for (let i = x; i < x + w; i++) {
        if (used.has(k * 4096 + i) || !map.isWalkable(i, k) || inBuilding(i, k)) return false;
        if (ground) { const g = groundAt(i, k); if (g === GROUND.PAVED || g === GROUND.FARM || g < 0) return false; }
      }
      return true;
    };
    const out = [];
    // big buildings first so the town centre gets its plaza furniture
    const order = blds.filter((b) => b.built && !b.removed)
      .sort((a, b) => (b.w * b.h - a.w * a.h) || (a.id - b.id));
    for (const b of order) {
      for (const [kind, spots] of anchorsFor(b)) {
        const p = PROPS[kind];
        for (const [dx, dz] of spots) {
          const x = b.tx + dx, z = b.tz + dz;
          if (!free(x, z, p.w, p.h, p.ground)) continue;
          for (let k = z; k < z + p.h; k++) for (let i = x; i < x + p.w; i++) used.add(k * 4096 + i);
          const square = p.w === p.h && !p.ground && kind !== 'statue' && kind !== 'hoplite' && kind !== 'kore';
          const rot = square ? Math.floor(hash3(x, 9, z, 73) * 4) * (Math.PI / 2) : 0;
          out.push({ kind, owner: b.owner, x: x + p.w / 2, z: z + p.h / 2, rot });
          break;
        }
      }
    }
    return out;
  }

  rebuild() {
    this.dirty = false;
    for (const it of this.items) this.group.remove(it.mesh);
    const game = this.game;
    this.items = this.layout().map((it) => {
      const mesh = new THREE.Mesh(this.geometry(it.kind), voxelMaterialFor(game.players[it.owner].color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(it.x, game.map.heightAt(it.x, it.z), it.z);
      mesh.rotation.y = it.rot;
      this.group.add(mesh);
      return { ...it, mesh };
    });
  }

  render() {
    if (this.dirty) this.rebuild();
    const game = this.game;
    for (const it of this.items)
      it.mesh.visible = it.owner === game.localPlayer || game.fog.isExplored(it.x, it.z);
  }
}

export const PROP_KINDS = Object.keys(PROPS);
void shade; void GOLD; void MARBLE;
