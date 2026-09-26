import { GAIA } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';

// Huntable animals. Each animal is a 'resource' entity (resType 'food') so the
// existing gather order, right-click and AI all treat it as a food node:
// while alive it is hunted (spears thrown from range), once dead it is a
// carcass that is butchered like any other node.
//   wildlife.spawn(type, x, z, { home })   -> entity
//   wildlife.spawnHerd(type, x, z, n)      -> entities
//   wildlife.hit(animal, damage, attacker)
export const ANIMAL_DEFS = {
  deer: { name: 'Deer', resType: 'food', amount: 100, hp: 8, speed: 1.0, fleeSpeed: 4.2, flees: true, w: 1, h: 1, animal: true, radius: 0.5 },
  boar: { name: 'Boar', resType: 'food', amount: 250, hp: 22, speed: 0.7, fleeSpeed: 2.2, flees: false, w: 1, h: 1, animal: true, radius: 0.55 },
};

export class Wildlife {
  constructor(game) {
    this.game = game;
    this.animals = new Set();
    this.spawned = false;
    game.events.on('entity:removed', (e) => this.animals.delete(e));
  }

  spawn(type, x, z, { home = null, rot = 0 } = {}) {
    const game = this.game;
    const def = ANIMAL_DEFS[type];
    const e = game.entities.add({
      kind: 'resource', type, owner: GAIA, def,
      resType: def.resType, amount: def.amount, maxAmount: def.amount,
      tx: x - 0.5, tz: z - 0.5, w: 1, h: 1, x, z, prevX: x, prevZ: z, rot, prevRot: rot,
      hp: def.hp, maxHp: def.hp, radius: def.radius, alive: true, flashT: 0,
      econ_home: home || { x, z }, econ_goal: null, econ_wait: 0, econ_flee: 0, econ_threat: null,
      econ_deadT: 0, econ_graze: 0, econ_seed: 0,
    });
    e.econ_seed = (e.id * 2654435761) >>> 0;
    // Animals are drawn by the economy piece, not the terrain prop renderer.
    game.terrain.props?._touch?.(e, false);
    this.animals.add(e);
    return e;
  }

  spawnHerd(type, x, z, n) {
    const out = [];
    const rnd = mulberry32(Math.floor(x * 131 + z * 977) ^ 0x5eed);
    const home = { x, z };
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = 0.6 + rnd() * 2.2;
      const p = this.walkableNear(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (p) out.push(this.spawn(type, p[0], p[1], { home, rot: rnd() * Math.PI * 2 }));
    }
    return out;
  }

  walkableNear(x, z) {
    const w = this.game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 6);
    if (!w) return null;
    if (w[0] === Math.floor(x) && w[1] === Math.floor(z)) return [x, z];
    return [w[0] + 0.5, w[1] + 0.5];
  }

  // Default herds around every start position (deterministic from the seed).
  populate() {
    if (this.spawned) return;
    this.spawned = true;
    const game = this.game;
    const rnd = mulberry32((game.map.seed ?? 1) * 7919 + 17);
    for (const s of game.starts || []) {
      const base = rnd() * Math.PI * 2;
      const herds = [['deer', 17, 6], ['deer', 26, 5], ['boar', 22, 2]];
      herds.forEach(([type, dist, n], i) => {
        const a = base + i * 2.1 + rnd() * 0.6;
        const p = this.walkableNear(s.tx + Math.cos(a) * dist, s.tz + Math.sin(a) * dist);
        if (p) this.spawnHerd(type, p[0], p[1], n);
      });
    }
  }

  hit(a, dmg, attacker) {
    if (!a.alive || a.removed) return;
    a.hp -= dmg;
    a.flashT = 0.25;
    if (a.hp <= 0) {
      a.hp = 0;
      a.alive = false;
      a.econ_deadT = 0;
      a.econ_goal = null;
      this.game.events.emit('animal:killed', { animal: a, by: attacker });
      return;
    }
    if (a.def.flees) {
      a.econ_flee = 2.2;
      a.econ_threat = { x: attacker.x, z: attacker.z };
      // the whole herd startles
      for (const o of this.animals) {
        if (o === a || !o.alive || o.econ_home !== a.econ_home) continue;
        o.econ_flee = Math.max(o.econ_flee, 1.4);
        o.econ_threat = { x: attacker.x, z: attacker.z };
      }
    } else {
      a.rot = Math.atan2(attacker.x - a.x, attacker.z - a.z);
    }
  }

  update(dt) {
    if (!this.spawned) this.populate();
    const map = this.game.map;
    for (const a of this.animals) {
      a.prevX = a.x; a.prevZ = a.z; a.prevRot = a.rot;
      if (a.flashT > 0) a.flashT = Math.max(0, a.flashT - dt);
      if (!a.alive) { a.econ_deadT += dt; continue; }
      const def = a.def;
      // settle out of anything placed on top of us
      if (!map.isWalkable(Math.floor(a.x), Math.floor(a.z))) {
        const p = this.walkableNear(a.x, a.z);
        if (p) { a.x = a.prevX = p[0]; a.z = a.prevZ = p[1]; }
      }
      let speed = 0, gx = 0, gz = 0;
      if (a.econ_flee > 0) {
        a.econ_flee -= dt;
        const dx = a.x - a.econ_threat.x, dz = a.z - a.econ_threat.z;
        const d = Math.hypot(dx, dz) || 1;
        gx = a.x + (dx / d) * 3; gz = a.z + (dz / d) * 3;
        speed = def.fleeSpeed;
        if (a.econ_flee <= 0) { a.econ_home = { x: a.x, z: a.z, shared: a.econ_home }; a.econ_goal = null; }
      } else {
        if (!a.econ_goal) {
          a.econ_wait -= dt;
          a.econ_graze = Math.min(1, a.econ_graze + dt * 2);
          if (a.econ_wait <= 0) {
            const r = this.rand(a);
            const h = a.econ_home.shared || a.econ_home;
            const ang = r * Math.PI * 2, rad = 0.6 + this.rand(a) * 3.2;
            a.econ_goal = { x: h.x + Math.cos(ang) * rad, z: h.z + Math.sin(ang) * rad };
          }
        } else {
          a.econ_graze = Math.max(0, a.econ_graze - dt * 3);
          gx = a.econ_goal.x; gz = a.econ_goal.z;
          speed = def.speed;
          if (Math.hypot(gx - a.x, gz - a.z) < 0.2) { a.econ_goal = null; a.econ_wait = 2 + this.rand(a) * 6; speed = 0; }
        }
      }
      if (speed > 0) {
        const dx = gx - a.x, dz = gz - a.z, d = Math.hypot(dx, dz);
        if (d > 0.01) {
          const step = Math.min(d, speed * dt);
          const nx = a.x + (dx / d) * step, nz = a.z + (dz / d) * step;
          if (map.isWalkable(Math.floor(nx), Math.floor(nz))) { a.x = nx; a.z = nz; }
          else { a.econ_goal = null; a.econ_wait = 0.5; if (a.econ_flee > 0) a.econ_threat = { x: nx + (this.rand(a) - 0.5) * 6, z: nz + (this.rand(a) - 0.5) * 6 }; }
          // turn smoothly toward travel direction
          const want = Math.atan2(dx, dz);
          let dr = want - a.rot;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          a.rot += Math.max(-8 * dt, Math.min(8 * dt, dr));
        }
      }
      a.econ_moving = speed > 0;
      a.econ_speed = speed;
      a.tx = a.x - 0.5; a.tz = a.z - 0.5;
    }
  }

  // Per-animal deterministic random stream.
  rand(a) {
    let t = (a.econ_seed = (a.econ_seed + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
