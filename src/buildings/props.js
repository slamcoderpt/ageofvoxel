import * as THREE from 'three';
import { VoxelModel, TEAM, buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';
import { BUILDING_VOXEL } from './defs.js';
import { GROUND } from '../core/GameMap.js';
import {
  WOOD, DARKWOOD, STONE, MARBLE, MARBLE_SHADE, BRONZE, GOLD, FIRE, LEAF,
  amphora, pithos, cypress, olive, statue, hopliteStatue, roofTile, shade,
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
  statue: { w: 2, h: 2, build(m) { m.box(0, 0, 0, 8, 1, 8, MARBLE_SHADE); statue(m, 2, 1, 2, { bolt: true }); } },
  hoplite: { w: 1, h: 1, build(m) { hopliteStatue(m, 0, 0, 0); } },
  pillar: {
    w: 1, h: 1,
    build(m) {
      m.box(0, 0, 0, 4, 1, 4, MARBLE_SHADE);
      m.box(1, 1, 1, 2, 7, 2, MARBLE); m.box(1, 3, 1, 2, 1, 2, TEAM);
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

function fence(m, len, axis, ox = 0, oz = 0) {
  const put = (a, y, c) => (axis === 'x' ? m.set(ox + a, y, oz, c) : m.set(ox, y, oz + a, c));
  for (let a = 0; a < len; a++) {
    const post = a % 3 === 0 || a === len - 1;
    if (post) { put(a, 0, 0x6a4a2c); put(a, 1, 0x6a4a2c); put(a, 2, 0x6a4a2c); put(a, 3, 0x5a3e24); }
    else { put(a, 1, (a & 1) ? 0x8b6139 : 0x7a5230); put(a, 3, (a & 1) ? 0x7a5230 : 0x8b6139); }
  }
}

function lowWall(m, len, axis) {
  const put = (a, y, k, c) => (axis === 'x' ? m.set(a, y, 1 + k, c) : m.set(1 + k, y, a, c));
  for (let a = 0; a < len; a++) for (let k = 0; k < 2; k++) {
    for (let y = 0; y < 3; y++) {
      const h = hash3(a >> 1, y, k, 83);
      put(a, y, k, h < 0.35 ? 0xa39a86 : h < 0.7 ? 0x958c78 : 0xb2a993);
    }
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
    case 'town_center': return [
      ['pillar', [[-1, h], [-1, h + 1]]], ['pillar', [[w, h], [w, h + 1]]],
      // the market sits out on the plaza, two tiles clear of the walls
      ['stall_food', [[-5, h + 2], [-4, h + 3], [w + 3, -2]]],
      ['stall_pots', [[-2, h + 3], [-5, h + 4], [w + 3, 0]]],
      ['stall_cloth', [[-5, -3], [w + 3, 2], [-6, 2]]],
      ['well', [[w + 3, h + 2], [w + 2, h + 3], [-4, -1]]],
      ['statue', [[-4, 1], [-4, 3], [w + 2, -4]]],
      ['pithoi', [[-3, h + 1], [w + 1, h + 1]]],
      ['kore', [[1, h + 1]]], ['kore', [[w - 2, h + 1]]],
      ['flowers', [[2, h + 2]]], ['flowers', [[w + 1, -2], [-3, -2]]],
      ['cypress', [[-2, -2], [-1, -2]]], ['cypress', [[w + 1, -2], [w, -2]]],
      ['hoplite', [[w + 3, h + 4], [w + 1, h + 4]]],
    ];
    case 'house': {
      const side = v & 1 ? [w + 1, 0] : [-3, 0];
      return [
        ['garden', [side, v & 1 ? [-3, 0] : [w + 1, 0], [0, -3]]],
        ['pithoi', [[w, h - 1], [-2, h - 1], [w, h]]],
        [v & 2 ? 'wall_x' : 'fence_x', [[0, -1], [0, h + 2]]],
        [['flowers', 'amphorae', 'crates', 'flowers'][v], [[0, h], [1, h], [-2, h]]],
        [v & 1 ? 'cypress' : 'olive', [[-1, 0], [w, 1], [w, -1]]],
      ];
    }
    case 'storehouse': return [
      ['crates', [[w, 1], [-1, 1], [1, h]]], ['pithoi', [[w, 2], [-2, 2], [0, h]]],
      ['fence_z', [[w + 1, -1], [-2, -1]]], ['amphorae', [[w, 0], [-1, 0]]],
    ];
    case 'temple': return [
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
      this.geos.set(kind, buildVoxelGeometry(m, { size: BUILDING_VOXEL, pivot: [p.w * V / 2, 0, p.h * V / 2], jitter: 0.06 }));
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
