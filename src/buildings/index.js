import * as THREE from 'three';
import { buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { GROUND } from '../core/GameMap.js';
import { BUILDING_DEFS, BUILDING_VOXEL } from './defs.js';
import { BUILDING_MODELS, BUILDING_VARIANTS, HOUSE_PLANS } from './models.js';
import { constructionModel, CONSTRUCTION_STAGES } from './construction.js';
import { hash3 } from '../core/rng.js';
import { Placement } from './placement.js';
import { Props } from './props.js';
import { withExtras } from './shapes.js';
import { layoutTown } from './town.js';

// Buildings piece: spawning, construction ('build' order), destruction,
// rendering and the placement flow.
// Public API:
//   buildings.spawn(type, owner, tx, tz, { built = true }) -> entity
//   buildings.canPlace(type, tx, tz) -> bool
//   buildings.placement.begin(type, builders)   (UI)
//   buildings.destroy(b)
//   buildings.geometry(type)                     (for portraits / ghosts)
//   buildings.layoutTown(owner, start)           (scenes: a planned Greek town)
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
    this.props = new Props(game);

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

  geometry(type, variant = 0) {
    const k = `${type}:${variant}`;
    if (!this.geos.has(k)) {
      const def = BUILDING_DEFS[type];
      const model = BUILDING_MODELS[type](variant);
      const pivot = [def.w * 2, 0, def.h * 2];
      const geo = withExtras(buildVoxelGeometry(model, { size: BUILDING_VOXEL, pivot, jitter: 0.06 }), model, BUILDING_VOXEL, pivot);
      // chimney flue (voxel coords) for the smoke, relative to the pivot
      if (model.chimney) geo.userData.chimney = model.chimney.map((c, i) => (c - pivot[i]) * BUILDING_VOXEL);
      this.geos.set(k, geo);
    }
    return this.geos.get(k);
  }

  // Where a house mesh stands: detached plans (not the row plots, which
  // join wall to wall) sit a little off the plot grid and a few degrees off
  // square, so a street does not read as a stamped row.
  housePose(b) {
    const row = [2, 3].includes(this.variantOf(b) % HOUSE_PLANS);
    const j = row ? 0 : hash3(b.tx, 29, b.tz, 95) - 0.5, k = row ? 0 : hash3(b.tx, 31, b.tz, 96) - 0.5;
    return { x: b.x + k * 0.45, z: b.z - this.houseSetback(b), yaw: this.houseYaw(b) + j * 0.14 };
  }

  // Hearth smoke: every finished house breathes a thin column of pale grey
  // voxel puffs from its chimney that drifts downwind and thins out.
  // Simulated in the fixed tick so paused captures show it.
  chimneySmoke(dt) {
    const game = this.game;
    this.smokeT = (this.smokeT || 0) + dt;
    if (this.smokeT < 0.1) return;
    this.smokeT -= 0.1;
    this.smokeN = (this.smokeN || 0) + 1;
    for (const b of game.entities.buildings()) {
      if (b.type !== 'house' || !b.built || b.dead) continue;
      if (b.owner !== game.localPlayer && !game.fog.isExplored(b.x, b.z)) continue;
      const c = this.geometry('house', this.variantOf(b)).userData.chimney;
      if (!c) continue;
      // each hearth puffs at its own rhythm, some cold for a while
      if (hash3(b.tx, this.smokeN >> 7, b.tz, 97) < 0.2) continue;
      const p = this.housePose(b);
      const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      const x = p.x + c[0] * cs + c[2] * sn, z = p.z - c[0] * sn + c[2] * cs;
      const y = game.map.heightAt(b.x, b.z) + c[1];
      game.fx.emit({ x, y, z, count: 1, color: 0xcfcbc3, colorVar: 0.08, size: 0.17, life: 3.0, speed: 0.1, up: 0.75, gravity: 0.05, drag: 0.25, spread: 0.04, grow: 3 });
    }
  }

  // Geometry of a construction stage (0..CONSTRUCTION_STAGES-1).
  stageGeometry(type, variant, stage) {
    const k = `${type}:${variant}:s${stage}`;
    if (!this.geos.has(k)) {
      const def = BUILDING_DEFS[type];
      const model = constructionModel(type, variant, stage, def.w, def.h);
      const pivot = [def.w * 2, 0, def.h * 2];
      this.geos.set(k, withExtras(buildVoxelGeometry(model, { size: BUILDING_VOXEL, pivot, jitter: 0.06 }), model, BUILDING_VOXEL, pivot, { maxY: model.extraMaxY }));
    }
    return this.geos.get(k);
  }

  // A planned town (agora, streets, house rows, temenos) round a start
  // position; see town.js.
  layoutTown(owner, start) { return layoutTown(this.game, owner, start); }

  // Visual variant, fixed per building. Starts from a tile hash, then steps
  // away from the variants of same-type neighbours so a street of houses
  // never repeats one silhouette side by side.
  variantOf(b) {
    if (b.bld_variant !== undefined) return b.bld_variant;
    const n = BUILDING_VARIANTS[b.type] || 1;
    let v = 0;
    if (n > 1) {
      // least-used variant among this owner's same-type buildings nearby
      // (closest ones weigh most), ties broken by a tile hash, so a town
      // shows every plan before it repeats one
      const score = new Array(n).fill(0);
      for (const o of this.game.entities.buildings()) {
        if (o === b || o.type !== b.type || o.bld_variant === undefined) continue;
        const d = Math.hypot(o.x - b.x, o.z - b.z);
        if (d >= 30) continue;
        const wgt = 1 + (30 - d) / 30;
        for (let c = 0; c < n; c++) {
          if (c === o.bld_variant) { score[c] += 2 * wgt; continue; }
          if (b.type !== 'house') continue;
          // same plan in another tint counts most of the way, a roof of
          // the same tint a little, so plans and tints both spread
          if (c % HOUSE_PLANS === o.bld_variant % HOUSE_PLANS) score[c] += 0.7 * wgt;
          if (Math.floor(c / HOUSE_PLANS) === Math.floor(o.bld_variant / HOUSE_PLANS)) score[c] += 0.35 * wgt;
        }
      }
      const start = Math.floor(hash3(b.tx, 7, b.tz, 31) * n) % n;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const c = (start + i) % n;
        if (score[c] < best - 1e-6) { best = score[c]; v = c; }
      }
    }
    b.bld_variant = v;
    return v;
  }

  // Houses stand square to the street grid; the planned town sets each
  // house's facing (bld_yaw), elsewhere it comes from a tile hash.
  houseYaw(b) {
    if (b.bld_yaw === undefined) {
      // most houses front their street square on; some turn a side to it
      const h = hash3(b.tx, 23, b.tz, 94);
      b.bld_yaw = h < 0.6 ? 0 : h < 0.82 ? Math.PI / 2 : -Math.PI / 2;
    }
    return b.bld_yaw;
  }

  // How far a house stands back from its street front, in tiles (visual
  // only; kept small so the plot never reaches the alley's far side).
  houseSetback(b) {
    if (b.bld_setback === undefined) b.bld_setback = Math.floor(hash3(b.tx, 19, b.tz, 93) * 3) * 0.2;
    return b.bld_setback;
  }

  // Paint a paved plaza (irregular disc) around a building, skipping tiles
  // that are blocked, water or other buildings' footprints.
  pavePlaza(tx, tz, w, h, r) {
    const map = this.game.map;
    const cx = tx + w / 2, cz = tz + h / 2;
    const R = Math.max(w, h) / 2 + r;
    for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++)
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        const d = Math.hypot(dx, dz) + (hash3(x, 3, z, 41) - 0.5) * 1.6;
        if (d > R) continue;
        if (!map.isWalkable(x, z)) continue;
        let taken = false;
        for (const o of this.game.entities.buildings())
          if (x >= o.tx && x < o.tx + o.w && z >= o.tz && z < o.tz + o.h) { taken = true; break; }
        if (!taken) map.paintTiles(x, z, 1, 1, GROUND.PAVED);
      }
  }

  groundAt(tx, tz) {
    const map = this.game.map, c = map.cps;
    return map.inCols(tx * c, tz * c) ? map.ground[map.cIdx(tx * c, tz * c)] : -1;
  }

  // Worn-earth yard around a building: only over grass, never over paving,
  // farms or other footprints.
  yard(tx, tz, w, h, r) {
    const map = this.game.map;
    for (let z = tz - r; z < tz + h + r; z++)
      for (let x = tx - r; x < tx + w + r; x++) {
        // rounded, ragged edge rather than a speckle
        const ex = Math.max(tx - x, x - (tx + w - 1), 0), ez = Math.max(tz - z, z - (tz + h - 1), 0);
        if (Math.hypot(ex, ez) + hash3(x, 5, z, 43) * 1.4 > r + 0.3) continue;
        if (!map.isWalkable(x, z)) continue;
        const g = this.groundAt(x, z);
        if (g !== GROUND.GRASS && g !== GROUND.DRYGRASS) continue;
        if (this.inFootprint(x, z)) continue;
        map.paintTiles(x, z, 1, 1, GROUND.DIRT);
      }
  }

  inFootprint(x, z) {
    for (const o of this.game.entities.buildings())
      if (x >= o.tx && x < o.tx + o.w && z >= o.tz && z < o.tz + o.h) return true;
    return false;
  }

  // A 2-tile paved street from a building's door (+z side) to the nearest
  // town centre of the same owner: out from the door, then along x, then
  // along z to the plaza. Tiles that are blocked, farmed or inside another
  // footprint are skipped, so a street simply ducks under obstacles.
  paveStreet(b) {
    const map = this.game.map;
    let tc = null, best = Infinity;
    for (const o of this.game.entities.buildings()) {
      if (o.type !== 'town_center' || o.owner !== b.owner || o === b) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d < best) { best = d; tc = o; }
    }
    if (!tc || best > 26) return;
    const paint = (x, z) => {
      for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const X = x + ox, Z = z + oz;
        if (!map.isWalkable(X, Z) || this.inFootprint(X, Z)) continue;
        const g = this.groundAt(X, Z);
        if (g === GROUND.FARM || g === GROUND.SAND || g === GROUND.ROCK || g < 0) continue;
        map.paintTiles(X, Z, 1, 1, GROUND.PAVED);
      }
    };
    // door point: middle of the front edge, one tile out
    let x = Math.floor(b.tx + b.w / 2) - 1, z = b.tz + b.h;
    // target: nearest point on the TC plaza edge
    const gx = Math.max(tc.tx - 1, Math.min(tc.tx + tc.w - 1, x));
    const gz = Math.max(tc.tz - 1, Math.min(tc.tz + tc.h - 1, z));
    // leave the door by 2 tiles, then run along x, then z
    const z1 = gz > z ? z + 2 : z;
    for (; z < z1; z++) paint(x, z);
    const sx = Math.sign(gx - x);
    for (; x !== gx; x += sx) paint(x, z);
    const sz = Math.sign(gz - z);
    for (; z !== gz; z += sz) paint(x, z);
    paint(x, z);
  }

  // Cobbled roads leaving a town centre's plaza in the four directions, with
  // worn-earth shoulders, so the town sits on a street grid instead of being
  // one paved blob on grass. Roads stop at water/cliffs and skip blocked
  // tiles (trees, mines) and existing footprints.
  paveRoads(tc) {
    const map = this.game.map;
    const cx = Math.floor(tc.tx + tc.w / 2) - 1, cz = Math.floor(tc.tz + tc.h / 2) - 1;
    const set = (x, z, g) => {
      if (!map.isWalkable(x, z) || this.inFootprint(x, z)) return;
      const cur = this.groundAt(x, z);
      if (cur < 0 || cur === GROUND.FARM || cur === GROUND.SAND || cur === GROUND.ROCK) return;
      if (g === GROUND.DIRT && cur === GROUND.PAVED) return;
      map.paintTiles(x, z, 1, 1, g);
    };
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const len = 20 + Math.floor(hash3(tc.tx + dx, 11, tc.tz + dz, 47) * 6);
      let wob = 0;
      for (let i = 0; i < len; i++) {
        if (i % 5 === 4) wob = Math.max(-1, Math.min(1, wob + (hash3(i, dx, dz, 48) < 0.5 ? -1 : 1)));
        const ox = dz !== 0 ? wob : 0, oz = dx !== 0 ? wob : 0;
        const x = cx + dx * i + ox, z = cz + dz * i + oz;
        const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;   // perpendicular
        const tail = i > len - 4;                           // road frays out
        for (let k = -1; k <= 2; k++) {
          const X = x + px * k, Z = z + pz * k;
          const edge = k === -1 || k === 2;
          if (edge) { if (hash3(X, 12, Z, 49) < 0.75) set(X, Z, GROUND.DIRT); }
          else set(X, Z, tail && hash3(X, 13, Z, 50) < 0.5 ? GROUND.DIRT : GROUND.PAVED);
        }
      }
    }
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

  // `site: false` skips the automatic ground dressing (plaza, yard, street
  // to the Town Center, roads) for callers that lay the ground out
  // themselves (the planned town in town.js).
  spawn(type, owner, tx, tz, { built = true, site = true } = {}) {
    const def = BUILDING_DEFS[type];
    if (!def) throw new Error(`Unknown building ${type}`);
    const game = this.game, map = game.map;
    game.terrain.clearRect(tx, tz, def.w, def.h);
    map.flattenTiles(tx, tz, def.w, def.h, null, def.farm ? GROUND.FARM : type === 'town_center' || type === 'temple' ? GROUND.PAVED : GROUND.DIRT);
    if (!site) { /* ground laid out by the caller */ }
    else if (type === 'town_center') this.pavePlaza(tx, tz, def.w, def.h, 5.5);
    else if (type === 'temple') this.pavePlaza(tx, tz, def.w, def.h, 3);
    // houses and storehouses sit on their own worn-earth lot (no paving),
    // so the paved streets between them read as streets, not one slab
    const lot = type === 'house' || type === 'storehouse';
    if (site && !def.farm) this.yard(tx, tz, def.w, def.h, type === 'town_center' ? 0 : type === 'temple' ? 2 : lot ? 1 : 1.6);
    // houses and storehouses: a paved forecourt across the front (+z)
    if (site && lot) {
      for (let x = tx; x < tx + def.w; x++) {
        if (!map.isWalkable(x, tz + def.h) || this.inFootprint(x, tz + def.h)) continue;
        const g = this.groundAt(x, tz + def.h);
        if (g === GROUND.FARM || g === GROUND.SAND || g === GROUND.ROCK || g < 0) continue;
        map.paintTiles(x, tz + def.h, 1, 1, GROUND.PAVED);
      }
    }
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
    if (site && !def.farm && type !== 'town_center') this.paveStreet(b);
    if (site && type === 'town_center') this.paveRoads(b);
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
    this.chimneySmoke(dt);
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
        const mesh = new THREE.Mesh(this.geometry(b.type, this.variantOf(b)), voxelMaterialFor(game.players[b.owner].color, { roughness: 0.93 }));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        m.add(mesh);
        m.userData.mesh = mesh;
        m.userData.variant = this.variantOf(b);
        this.group.add(m);
        this.meshes.set(b.id, m);
      }
      const y = game.map.heightAt(b.x, b.z);
      m.position.set(b.x, y, b.z);
      if (b.type === 'house') {
        // detached plans (not the row plots, which join wall to wall) sit a
        // little off the plot grid and a few degrees off square, so a street
        // does not read as a stamped row
        const p = this.housePose(b);
        m.rotation.y = p.yaw;
        m.position.x = p.x;
        m.position.z = p.z;
      }
      const visible = b.owner === game.localPlayer || game.fog.isExplored(b.x, b.z);
      m.visible = visible;
      const mesh = m.userData.mesh;
      const v = m.userData.variant;
      const geo = b.built ? this.geometry(b.type, v)
        : this.stageGeometry(b.type, v, Math.min(CONSTRUCTION_STAGES - 1, Math.floor(b.progress * CONSTRUCTION_STAGES)));
      if (mesh.geometry !== geo) mesh.geometry = geo;
    }
    this.props.render();
    this.placement.render();
  }
}

export { BUILDING_DEFS };
