import * as THREE from 'three';
import { VoxelModel, TEAM, buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';
import { BUILDING_VOXEL } from './defs.js';
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

function stall(m, kind) {
  for (const [x, z] of [[0, 0], [7, 0], [0, 3], [7, 3]]) m.box(x, 0, z, 1, 6, 1, WOOD);
  m.box(0, 2, 2, 8, 1, 2, 0x9b7040);                 // counter
  m.box(1, 0, 3, 6, 2, 1, 0x7a5230);
  // striped awning sloping down to the front
  for (let x = -1; x < 9; x++) {
    const c = (x & 1) ? TEAM : 0xf2ede2;
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
      ['well', [[w + 2, h + 1], [w + 1, h + 2], [w + 2, h - 1], [-3, h + 1]]],
      ['statue', [[-3, -2], [-3, 0], [w + 1, -3], [-2, -3]]],
      ['stall_food', [[-4, 2], [-3, 2], [-4, 4], [w + 2, 2]]],
      ['stall_pots', [[-4, 4], [-3, 4], [-4, 0], [w + 2, 4]]],
      ['stall_cloth', [[1, h + 3], [2, -3], [w + 2, 0], [-4, 6]]],
      ['amphorae', [[-2, h + 1], [-2, 1], [w + 1, 1]]],
      ['crates', [[-3, h], [w + 1, h - 2], [-2, 6]]],
      ['cypress', [[-2, -2], [-1, -2]]], ['cypress', [[w + 1, -2], [w, -2]]],
      ['cypress', [[-2, h + 2], [-3, h + 2]]], ['cypress', [[w + 1, h + 3], [w + 2, h + 3]]],
      ['hoplite', [[w + 3, h + 3], [w + 1, h + 4]]],
      ['planter', [[2, h + 1]]], ['planter', [[4, h + 1]]],
    ];
    case 'house': return [
      [['amphorae', 'crates', 'planter', 'olive'][v], [[w, h - 1], [-1, h - 1], [w, 0]]],
      [v & 1 ? 'cypress' : 'planter', [[-1, 0], [w, 1], [1, h]]],
    ];
    case 'storehouse': return [['crates', [[w, 1], [-1, 1], [1, h]]], ['amphorae', [[w, 2], [-1, 2]]]];
    case 'temple': return [
      ['pillar', [[-1, h - 1]]], ['pillar', [[w, h - 1]]],
      ['cypress', [[-1, 0], [-1, 1]]], ['cypress', [[w, 0], [w, 1]]],
      ['hoplite', [[w, h + 1], [-1, h + 1], [w + 1, 2]]],
      ['planter', [[1, h]]], ['planter', [[3, h]]],
    ];
    case 'barracks': return [['pillar', [[-1, h - 1]]], ['pillar', [[w, h - 1]]], ['hoplite', [[w, 1], [-1, 1]]]];
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
    const free = (x, z, w, h) => {
      for (let k = z; k < z + h; k++) for (let i = x; i < x + w; i++)
        if (used.has(k * 4096 + i) || !map.isWalkable(i, k) || inBuilding(i, k)) return false;
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
          if (!free(x, z, p.w, p.h)) continue;
          for (let k = z; k < z + p.h; k++) for (let i = x; i < x + p.w; i++) used.add(k * 4096 + i);
          const square = p.w === p.h && kind !== 'statue' && kind !== 'hoplite';
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
