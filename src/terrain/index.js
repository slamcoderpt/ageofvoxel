import { GAIA } from '../core/constants.js';
import { TerrainMesh } from './TerrainMesh.js';
import { Water } from './Water.js';
import { ResourceRenderer } from './ResourceRenderer.js';
import { RESOURCE_DEFS } from './resourceDefs.js';

// Terrain piece: voxel ground, water, and gaia resource props.
// Public API:
//   terrain.spawnResource(type, tx, tz, { variant }) -> entity
//   terrain.removeResource(e)
export class Terrain {
  constructor(game) {
    this.game = game;
    this.mesh = new TerrainMesh(game);
    game.scene.add(this.mesh.group);
    this.water = new Water(game);
    game.scene.add(this.water.mesh);
    this.props = new ResourceRenderer(game);
    game.scene.add(this.props.group);
    game.map.onChange = (r) => {
      this.mesh.markDirtyCols(r.cx0, r.cz0, r.cx1, r.cz1);
      // props sitting on changed terrain need their height refreshed
      for (const b of this.props.buckets.values()) b.dirty = true;
    };
  }

  spawnResource(type, tx, tz, opts = {}) {
    const def = RESOURCE_DEFS[type];
    if (!def) throw new Error(`Unknown resource ${type}`);
    const e = this.game.entities.add({
      kind: 'resource', type, owner: GAIA, def,
      resType: def.resType, amount: def.amount, maxAmount: def.amount,
      tx, tz, w: def.w, h: def.h,
      x: tx + def.w / 2, z: tz + def.h / 2, rot: 0,
      hp: 1, maxHp: 1, radius: Math.max(def.w, def.h) / 2,
      variant: opts.variant ?? 0,
    });
    this.game.map.block(tx, tz, def.w, def.h, e.id);
    return e;
  }

  removeResource(e) {
    if (e.removed) return;
    this.game.map.unblock(e.tx, e.tz, e.w, e.h);
    this.game.entities.remove(e);
  }

  // Remove all resources overlapping a tile rect (used when placing buildings in scenes).
  clearRect(tx, tz, w, h) {
    for (const e of [...this.game.entities.resources()]) {
      if (e.tx < tx + w && e.tx + e.w > tx && e.tz < tz + h && e.tz + e.h > tz) this.removeResource(e);
    }
  }

  render() {
    if (this.mesh.dirty.size) this.mesh.rebuildDirty();
    this.water.update(this.game.time);
    this.props.render();
  }
}
