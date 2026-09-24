import * as THREE from 'three';
import { buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { GROUND } from '../core/GameMap.js';
import { BUILDING_DEFS, BUILDING_VOXEL } from './defs.js';
import { BUILDING_MODELS } from './models.js';
import { Placement } from './placement.js';

// Buildings piece: spawning, construction ('build' order), destruction,
// rendering and the placement flow.
// Public API:
//   buildings.spawn(type, owner, tx, tz, { built = true }) -> entity
//   buildings.canPlace(type, tx, tz) -> bool
//   buildings.placement.begin(type, builders)   (UI)
//   buildings.destroy(b)
//   buildings.geometry(type)                     (for portraits / ghosts)
export class Buildings {
  constructor(game) {
    this.game = game;
    this.defs = BUILDING_DEFS;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    game.scene.add(this.group);
    this.geos = new Map();
    this.meshes = new Map(); // entity id -> Object3D
    this.placement = new Placement(game, this);

    game.commands.register('build', {
      start: (u, o) => {
        const b = game.entities.get(o.targetId);
        if (!b || b.kind !== 'building' || b.built || b.owner !== u.owner) return false;
        game.movement.moveTo(u, b.x, b.z, { goalRect: b });
        return true;
      },
    });
    game.events.on('entity:removed', (e) => {
      if (e.kind !== 'building') return;
      const m = this.meshes.get(e.id);
      if (m) { this.group.remove(m); this.meshes.delete(e.id); }
    });
  }

  geometry(type) {
    if (!this.geos.has(type)) {
      const def = BUILDING_DEFS[type];
      const model = BUILDING_MODELS[type]();
      const geo = buildVoxelGeometry(model, { size: BUILDING_VOXEL, pivot: [def.w * 2, 0, def.h * 2], jitter: 0.06 });
      this.geos.set(type, geo);
    }
    return this.geos.get(type);
  }

  canPlace(type, tx, tz) {
    const def = BUILDING_DEFS[type];
    const map = this.game.map;
    for (let z = tz; z < tz + def.h; z++)
      for (let x = tx; x < tx + def.w; x++) if (!map.isWalkable(x, z)) return false;
    const st = map.tileRectStats(tx, tz, def.w, def.h);
    if (st.water || st.max - st.min > 3) return false;
    for (const b of this.game.entities.buildings())
      if (b.tx < tx + def.w && b.tx + b.w > tx && b.tz < tz + def.h && b.tz + b.h > tz) return false;
    // don't build on top of units
    return true;
  }

  spawn(type, owner, tx, tz, { built = true } = {}) {
    const def = BUILDING_DEFS[type];
    if (!def) throw new Error(`Unknown building ${type}`);
    const game = this.game, map = game.map;
    game.terrain.clearRect(tx, tz, def.w, def.h);
    map.flattenTiles(tx, tz, def.w, def.h, null, def.farm ? GROUND.FARM : type === 'town_center' || type === 'temple' ? GROUND.PAVED : GROUND.DIRT);
    if (type === 'town_center') map.paintTiles(tx - 1, tz - 1, def.w + 2, def.h + 2, GROUND.PAVED), map.paintTiles(tx, tz, def.w, def.h, GROUND.PAVED);
    const b = game.entities.add({
      kind: 'building', type, owner, def,
      tx, tz, w: def.w, h: def.h,
      x: tx + def.w / 2, z: tz + def.h / 2, rot: 0,
      hp: built ? def.hp : Math.max(1, def.hp * 0.1), maxHp: def.hp,
      built, progress: built ? 1 : 0,
      queue: [], rally: null, sight: def.sight,
      radius: Math.max(def.w, def.h) / 2,
    });
    if (!def.walkable) map.block(tx, tz, def.w, def.h, b.id);
    // nudge any units standing inside the footprint out of it
    for (const u of game.entities.units()) {
      if (u.x >= tx && u.x < tx + def.w && u.z >= tz && u.z < tz + def.h && !def.walkable) {
        const w = game.pathfinder.nearestWalkable(Math.floor(u.x), Math.floor(u.z), 8);
        if (w) { u.x = w[0] + 0.5; u.z = w[1] + 0.5; }
      }
    }
    game.events.emit('building:placed', b);
    if (built) game.events.emit('building:completed', b);
    return b;
  }

  destroy(b) {
    const game = this.game;
    if (b.removed) return;
    if (!b.def.walkable) game.map.unblock(b.tx, b.tz, b.w, b.h);
    for (let i = 0; i < 6; i++)
      game.fx.emit({ x: b.x + game.rng.range(-b.w / 3, b.w / 3), y: game.map.heightAt(b.x, b.z) + 1, z: b.z + game.rng.range(-b.h / 3, b.h / 3), count: 14, color: 0xb9ab8f, size: 0.9, life: 2.2, speed: 1.5, up: 1.5, gravity: 0.3, grow: 2 });
    game.entities.remove(b);
  }

  // ---- simulation: construction ------------------------------------------
  update(dt) {
    const game = this.game;
    // tally builders per site
    const builders = new Map();
    for (const u of game.entities.units()) {
      if (u.dead || !u.order || u.order.type !== 'build') continue;
      const b = game.entities.get(u.order.targetId);
      if (!b || b.removed || b.built) { game.commands.idle(u); continue; }
      if (u.moving) continue;
      if (game.movement.distanceTo(u, b) > 1.3) {
        if (!u.moving) game.movement.moveTo(u, b.x, b.z, { goalRect: b });
        continue;
      }
      u.rot = Math.atan2(b.x - u.x, b.z - u.z);
      u.anim.want = 'build';
      builders.set(b, (builders.get(b) || 0) + 1);
    }
    for (const [b, n] of builders) {
      const rate = (1 / b.def.buildTime) * Math.pow(n, 0.75);
      const before = b.progress;
      b.progress = Math.min(1, b.progress + rate * dt);
      b.hp = Math.min(b.maxHp, b.hp + (b.progress - before) * b.maxHp * 0.9);
      if (b.progress >= 1) this.complete(b);
    }
  }

  complete(b) {
    const game = this.game;
    b.built = true;
    b.progress = 1;
    b.hp = Math.max(b.hp, b.maxHp);
    game.events.emit('building:completed', b);
    for (const u of game.entities.units()) {
      if (u.order?.type === 'build' && u.order.targetId === b.id) {
        if (b.def.farm) game.commands.order(u, { type: 'gather', targetId: b.id });
        else game.commands.idle(u);
      }
    }
  }

  // ---- rendering ---------------------------------------------------------
  render() {
    const game = this.game;
    for (const b of game.entities.buildings()) {
      let m = this.meshes.get(b.id);
      if (!m) {
        m = new THREE.Group();
        const mesh = new THREE.Mesh(this.geometry(b.type), voxelMaterialFor(game.players[b.owner].color));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        m.add(mesh);
        m.userData.mesh = mesh;
        // construction foundation
        const f = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.1, 0.12, b.h - 0.1), voxelMaterialFor(0xffffff));
        f.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(f.geometry.attributes.position.count * 3).fill(0.45), 3));
        f.geometry.setAttribute('team', new THREE.Float32BufferAttribute(new Array(f.geometry.attributes.position.count).fill(0), 1));
        f.geometry.setAttribute('glow', new THREE.Float32BufferAttribute(new Array(f.geometry.attributes.position.count).fill(0), 1));
        f.receiveShadow = true;
        m.add(f);
        m.userData.foundation = f;
        this.group.add(m);
        this.meshes.set(b.id, m);
      }
      const y = game.map.heightAt(b.x, b.z);
      m.position.set(b.x, y, b.z);
      const visible = b.owner === game.localPlayer || game.fog.isExplored(b.x, b.z);
      m.visible = visible;
      const mesh = m.userData.mesh;
      if (b.built) {
        mesh.scale.y = 1;
        m.userData.foundation.visible = false;
      } else {
        mesh.scale.y = Math.max(0.04, b.progress);
        m.userData.foundation.visible = true;
        m.userData.foundation.position.y = 0.06;
      }
    }
    this.placement.render();
  }
}

export { BUILDING_DEFS };
