import { VOXEL } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';

// Fishing: fish shoals in shallow water near the shore and fishing boats that
// sail out, cast their nets over a shoal, and bring the catch back to a dock
// point beside the owner's nearest drop-off building.
//   fishing.spawnShoal(x, z, amount)
//   fishing.spawnBoat(owner, x, z) -> boat
//   fishing.shoals, fishing.boats
const BOAT_SPEED = 2.4;
const BOAT_CAP = 20;
const FISH_RATE = 0.9; // food / second while the net is out

export class Fishing {
  constructor(game) {
    this.game = game;
    this.shoals = [];
    this.boats = [];
    this.nextId = 1;
    this.spawned = false;
  }

  isWater(x, z) {
    const m = this.game.map;
    return m.isWaterCol(Math.floor(x / VOXEL), Math.floor(z / VOXEL));
  }
  // open water with a margin all around (for hulls)
  isOpen(x, z, r = 0.9) {
    if (!this.isWater(x, z)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (!this.isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  }

  spawnShoal(x, z, amount = 300) {
    const s = { id: this.nextId++, x, z, amount, maxAmount: amount, phase: (x * 7.1 + z * 3.3) % 6.28 };
    this.shoals.push(s);
    return s;
  }

  // Shoals along every shoreline: open water 1.5..5 tiles from land.
  populate() {
    if (this.spawned) return;
    this.spawned = true;
    const m = this.game.map;
    const rnd = mulberry32((m.seed ?? 1) * 104729 + 3);
    const cand = [];
    for (let tz = 2; tz < m.size - 2; tz += 2)
      for (let tx = 2; tx < m.size - 2; tx += 2) {
        const x = tx + 0.5, z = tz + 0.5;
        if (!this.isOpen(x, z, 1.4)) continue;
        let near = false;
        for (let i = 0; i < 12 && !near; i++) {
          const a = (i / 12) * Math.PI * 2;
          if (!this.isWater(x + Math.cos(a) * 4.5, z + Math.sin(a) * 4.5)) near = true;
        }
        if (near) cand.push([x, z, rnd()]);
      }
    cand.sort((a, b) => a[2] - b[2]);
    for (const [x, z] of cand) {
      if (this.shoals.length >= 26) break;
      if (this.shoals.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 64)) continue;
      this.spawnShoal(x, z);
    }
  }

  spawnBoat(owner, x, z, rot = 0) {
    const b = {
      id: this.nextId++, owner, x, z, prevX: x, prevZ: z, rot, prevRot: rot,
      state: 'idle', shoal: null, carry: 0, dock: null, t: 0, wait: 0,
    };
    this.boats.push(b);
    return b;
  }

  nearestShoal(x, z, exclude = null) {
    let best = null, bd = Infinity;
    for (const s of this.shoals) {
      if (s.amount <= 0 || s === exclude) continue;
      // spread boats: penalise shoals other boats already work
      const crowd = this.boats.filter((b) => b.shoal === s).length;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2 + crowd * 60;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Water point next to the owner's nearest food drop-off.
  findDock(owner, x, z) {
    const game = this.game;
    let best = null, bd = Infinity;
    for (const b of game.entities.buildings()) {
      if (b.owner !== owner || !b.built || !b.def.dropoff?.includes('food')) continue;
      for (let r = 2; r <= 22; r += 1)
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const px = b.x + Math.cos(a) * r, pz = b.z + Math.sin(a) * r;
          if (!this.isOpen(px, pz, 0.8)) continue;
          const d = r * 3 + Math.hypot(px - x, pz - z) * 0.2;
          if (d < bd) { bd = d; best = { x: px, z: pz, building: b.id }; }
        }
    }
    return best;
  }

  update(dt) {
    if (!this.spawned) this.populate();
    const game = this.game;
    for (const s of this.shoals) s.phase += dt;
    for (const b of this.boats) {
      b.prevX = b.x; b.prevZ = b.z; b.prevRot = b.rot;
      b.t += dt;
      if (b.state === 'idle') {
        b.wait -= dt;
        if (b.wait > 0) continue;
        if (b.carry >= BOAT_CAP * 0.5) { b.state = 'toDock'; continue; }
        b.shoal = this.nearestShoal(b.x, b.z);
        if (b.shoal) b.state = 'toShoal'; else b.wait = 3;
      } else if (b.state === 'toShoal') {
        if (!b.shoal || b.shoal.amount <= 0) { b.state = 'idle'; continue; }
        // park on the rim of the shoal, each boat at its own angle
        const ang = b.id * 2.4;
        const px = b.shoal.x + Math.cos(ang) * 1.3, pz = b.shoal.z + Math.sin(ang) * 1.3;
        if (this.sail(b, px, pz, dt)) { b.state = 'fishing'; b.t = 0; }
      } else if (b.state === 'fishing') {
        const s = b.shoal;
        if (!s || s.amount <= 0) { b.state = b.carry > 0 ? 'toDock' : 'idle'; continue; }
        const take = Math.min(FISH_RATE * dt, s.amount, BOAT_CAP - b.carry);
        b.carry += take; s.amount -= take;
        // slowly swing around the anchor
        b.rot += Math.sin(b.t * 0.4 + b.id) * 0.1 * dt;
        if (b.carry >= BOAT_CAP) b.state = 'toDock';
      } else if (b.state === 'toDock') {
        if (!b.dock || !game.entities.get(b.dock.building)) b.dock = this.findDock(b.owner, b.x, b.z);
        if (!b.dock) { b.state = 'idle'; b.wait = 5; continue; }
        if (this.sail(b, b.dock.x, b.dock.z, dt)) {
          const p = game.players[b.owner];
          p.res.food += Math.floor(b.carry * 100) / 100;
          const dropB = game.entities.get(b.dock.building);
          if (dropB) dropB.econ_stock = { ...(dropB.econ_stock || {}), fish: (dropB.econ_stock?.fish || 0) + b.carry };
          b.carry = 0;
          game.events.emit('resources:changed', b.owner);
          b.state = 'idle'; b.wait = 1.2;
        }
      }
    }
  }

  // Steer toward (x, z) over open water. Returns true on arrival.
  sail(b, x, z, dt) {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz);
    if (d < 0.6) return true;
    const want = Math.atan2(dx, dz);
    const look = Math.min(1.8, d);
    let heading = null;
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, 2.8]) {
      const h = want + off;
      if (this.isOpen(b.x + Math.sin(h) * look, b.z + Math.cos(h) * look, 0.6)) { heading = h; break; }
    }
    if (heading === null) {
      // wedged: accept arrival if we are close, otherwise nudge backwards
      if (d < 3) return true;
      heading = b.rot + Math.PI;
    }
    let dr = heading - b.rot;
    while (dr > Math.PI) dr -= Math.PI * 2;
    while (dr < -Math.PI) dr += Math.PI * 2;
    b.rot += Math.max(-2.5 * dt, Math.min(2.5 * dt, dr));
    const sp = BOAT_SPEED * (0.4 + 0.6 * Math.max(0, Math.cos(dr)));
    const nx = b.x + Math.sin(b.rot) * sp * dt, nz = b.z + Math.cos(b.rot) * sp * dt;
    if (this.isWater(nx, nz)) { b.x = nx; b.z = nz; }
    return false;
  }
}
