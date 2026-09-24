import { SpatialHash } from './SpatialHash.js';

// Locomotion: path following + simple steering (separation, sliding along
// blocked tiles, stuck detection with re-pathing). Other systems ask units to
// move with game.movement.moveTo() and poll u.moving / u.arrived.
export class Movement {
  constructor(game) {
    this.game = game;
    this.hash = new SpatialHash(game.map.worldSize, 3);
  }

  moveTo(u, x, z, { goalRect = null, range = 0 } = {}) {
    const pf = this.game.pathfinder;
    u.path = pf.findPath(u.x, u.z, x, z, { goalRect });
    u.pathIdx = 0;
    u.moveGoal = { x, z, range, goalRect };
    u.moving = u.path.length > 0;
    u.arrived = !u.moving;
    u.stuckT = 0;
    u.repaths = 0;
    if (u.moving && this.withinGoal(u)) { u.moving = false; u.arrived = true; }
    return u.moving || u.arrived;
  }

  stop(u) {
    u.moving = false;
    u.path = null;
    u.arrived = false;
  }

  withinGoal(u) {
    const g = u.moveGoal;
    if (!g) return true;
    if (g.goalRect) {
      const r = g.goalRect;
      const dx = Math.max(r.tx - u.x, 0, u.x - (r.tx + r.w));
      const dz = Math.max(r.tz - u.z, 0, u.z - (r.tz + r.h));
      return Math.hypot(dx, dz) <= Math.max(0.75, g.range) + (u.radius || 0.3);
    }
    if (g.range > 0) return Math.hypot(g.x - u.x, g.z - u.z) <= g.range;
    return false;
  }

  // Distance from a unit to an entity's edge (buildings/resources use their footprint).
  distanceTo(u, e) {
    if (e.w && e.tx !== undefined) {
      const dx = Math.max(e.tx - u.x, 0, u.x - (e.tx + e.w));
      const dz = Math.max(e.tz - u.z, 0, u.z - (e.tz + e.h));
      return Math.hypot(dx, dz);
    }
    return Math.max(0, Math.hypot(e.x - u.x, e.z - u.z) - (e.radius || 0.3));
  }

  update(dt) {
    const game = this.game, map = game.map, hash = this.hash;
    hash.clear();
    for (const u of game.entities.units()) {
      u.prevX = u.x; u.prevZ = u.z; u.prevRot = u.rot;
      if (!u.dead) hash.insert(u);
    }
    for (const u of game.entities.units()) {
      if (u.dead) continue;
      // a finished 'move' order returns the unit to idle (so it can auto-engage)
      if (!u.moving && u.order?.type === 'move') u.order = { type: 'idle' };
      let vx = 0, vz = 0;
      const speed = u.speed * (u.speedMul ?? 1);
      if (u.moving && u.path) {
        if (this.withinGoal(u)) { u.moving = false; u.arrived = true; }
        else {
          let wp = u.path[u.pathIdx];
          let dx = wp.x - u.x, dz = wp.z - u.z, d = Math.hypot(dx, dz);
          const last = u.pathIdx === u.path.length - 1;
          if (!last && d < 0.5) {
            u.pathIdx++;
            wp = u.path[u.pathIdx]; dx = wp.x - u.x; dz = wp.z - u.z; d = Math.hypot(dx, dz);
          }
          if (last && d < 0.12) {
            u.moving = false; u.arrived = true;
          } else {
            const s = Math.min(speed, d / dt);
            vx = (dx / d) * s; vz = (dz / d) * s;
          }
        }
      }
      // separation
      const r = u.radius || 0.3;
      let sx = 0, sz = 0;
      hash.forEachNear(u.x, u.z, r + 1, (o) => {
        if (o === u || o.dead) return;
        const dx = u.x - o.x, dz = u.z - o.z;
        const min = r + (o.radius || 0.3);
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) return;
        const d = Math.sqrt(d2) || 0.001;
        const push = (min - d) / min;
        // stationary workers are pushed less so they keep their spot
        const w = u.moving ? 1.0 : (o.moving ? 1.6 : 0.8);
        sx += (d2 === 0 ? (u.id % 2 ? 1 : -1) : dx / d) * push * w;
        sz += (d2 === 0 ? (u.id % 3 ? 1 : -1) : dz / d) * push * w;
      });
      vx += sx * 4; vz += sz * 4;
      if (vx === 0 && vz === 0) continue;
      const nx = u.x + vx * dt, nz = u.z + vz * dt;
      if (map.isWalkable(Math.floor(nx), Math.floor(nz))) { u.x = nx; u.z = nz; }
      else if (map.isWalkable(Math.floor(nx), Math.floor(u.z))) u.x = nx;
      else if (map.isWalkable(Math.floor(u.x), Math.floor(nz))) u.z = nz;
      else if (!map.isWalkable(Math.floor(u.x), Math.floor(u.z))) { u.x = nx; u.z = nz; } // escape if embedded
      if (u.moving) {
        const want = Math.atan2(vx, vz);
        let dr = want - u.rot;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        u.rot += dr * Math.min(1, dt * 12);
        // stuck detection
        const moved = Math.hypot(u.x - u.prevX, u.z - u.prevZ);
        if (moved < speed * dt * 0.25) u.stuckT += dt; else u.stuckT = Math.max(0, u.stuckT - dt);
        if (u.stuckT > 1.2) {
          u.stuckT = 0;
          if (++u.repaths > 3) { u.moving = false; u.arrived = true; }
          else {
            const g = u.moveGoal;
            u.path = game.pathfinder.findPath(u.x, u.z, g.x, g.z, { goalRect: g.goalRect });
            u.pathIdx = 0;
            if (!u.path.length) { u.moving = false; u.arrived = true; }
          }
        }
      }
    }
  }
}
