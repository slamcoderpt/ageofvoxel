import { AGES } from '../core/constants.js';

// Economy piece: gathering & drop-off, farms, worship/favor, population,
// training queues and age advancement.
// Public API:
//   economy.train(building, unitType) -> { ok, reason }
//   economy.cancelTrain(building, index)
//   economy.advanceAge(owner) -> { ok, reason }
//   economy.nextAgeCost(owner)
//   economy.nearestResource(x, z, resType, maxDist)
//   economy.nearestDropoff(owner, x, z, resType)
// Orders handled: 'gather', 'dropoff', 'worship'.

export const AGE_COSTS = [null, { food: 400 }, { food: 800, gold: 500 }, { food: 1000, gold: 1000 }];
export const AGE_TIME = [0, 30, 40, 50];
const POP_MAX = 300;
const FARM_RATE = 0.55;

export class Economy {
  constructor(game) {
    this.game = game;
    const cmd = game.commands;
    cmd.register('gather', { start: (u, o) => this.startGather(u, o) });
    cmd.register('dropoff', {
      start: (u, o) => {
        const b = game.entities.get(o.targetId);
        if (!b || !b.def.dropoff) return false;
        u.econ = { phase: 'toDrop', dropId: b.id, resId: null, resType: u.carry.type, tries: 0 };
        game.movement.moveTo(u, b.x, b.z, { goalRect: b });
        return true;
      },
    });
    cmd.register('worship', {
      start: (u, o) => {
        const b = game.entities.get(o.targetId);
        if (!b || !b.def.worship || !u.def.gatherer) return false;
        u.econ = { phase: 'toTemple', templeId: b.id, tries: 0 };
        game.movement.moveTo(u, b.x, b.z, { goalRect: b });
        return true;
      },
    });
    this.favorAcc = {};
  }

  // ---- orders ---------------------------------------------------------
  startGather(u, o) {
    const game = this.game;
    const t = game.entities.get(o.targetId);
    if (!t || !u.def.gatherer) return false;
    let resType;
    if (t.kind === 'resource') resType = t.resType;
    else if (t.kind === 'building' && t.def.farm && t.built && t.owner === u.owner) {
      if (t.farmer && t.farmer !== u.id && game.entities.get(t.farmer)?.order?.targetId === t.id) return false;
      t.farmer = u.id;
      resType = 'food';
    } else return false;
    if (u.carry.amount > 0 && u.carry.type !== resType) u.carry = { type: null, amount: 0 };
    u.econ = { phase: 'toRes', resId: t.id, resType, dropId: null, tries: 0 };
    if (t.def.farm) game.movement.moveTo(u, t.x + ((u.id % 3) - 1) * 0.6, t.z);
    else game.movement.moveTo(u, t.x, t.z, { goalRect: t });
    return true;
  }

  nearestResource(x, z, resType, maxDist = 14, exclude = null) {
    let best = null, bd = maxDist * maxDist;
    for (const r of this.game.entities.resources()) {
      if (r.resType !== resType || r === exclude || r.amount <= 0) continue;
      const d = (r.x - x) ** 2 + (r.z - z) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  nearestDropoff(owner, x, z, resType) {
    let best = null, bd = Infinity;
    for (const b of this.game.entities.buildings()) {
      if (b.owner !== owner || !b.built || !b.def.dropoff || !b.def.dropoff.includes(resType)) continue;
      const d = (b.x - x) ** 2 + (b.z - z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ---- training ---------------------------------------------------------
  train(b, type) {
    const game = this.game;
    const p = game.players[b.owner];
    const def = game.units.defs[type];
    if (!def || !b.built || !b.def.trains?.includes(type)) return { ok: false, reason: 'Cannot train here' };
    if ((def.minAge ?? 0) > p.age) return { ok: false, reason: `Requires ${AGES[def.minAge]} Age` };
    if (b.queue.length >= 10) return { ok: false, reason: 'Queue full' };
    this.recount();
    if (p.pop + def.pop > p.popCap) return { ok: false, reason: 'Need more houses' };
    if (!p.pay(def.cost)) return { ok: false, reason: 'Not enough resources' };
    b.queue.push({ type, t: 0, total: def.trainTime });
    p.pop += def.pop;
    game.events.emit('resources:changed', b.owner);
    return { ok: true };
  }

  cancelTrain(b, i) {
    const item = b.queue[i];
    if (!item) return;
    b.queue.splice(i, 1);
    this.game.players[b.owner].refund(this.game.units.defs[item.type].cost);
  }

  nextAgeCost(owner) { return AGE_COSTS[this.game.players[owner].age + 1] || null; }

  advanceAge(owner) {
    const p = this.game.players[owner];
    if (p.advancing) return { ok: false, reason: 'Already advancing' };
    const cost = AGE_COSTS[p.age + 1];
    if (!cost) return { ok: false, reason: 'Final age reached' };
    const hasTC = [...this.game.entities.buildings()].some((b) => b.owner === owner && b.built && b.def.ageUp);
    if (!hasTC) return { ok: false, reason: 'Need a Town Center' };
    if (!p.pay(cost)) return { ok: false, reason: 'Not enough resources' };
    p.advancing = { t: 0, total: AGE_TIME[p.age + 1] };
    return { ok: true };
  }

  spawnFromBuilding(b, type) {
    const game = this.game;
    const fx = b.x, fz = b.tz + b.h + 0.6;
    let tile = game.pathfinder.nearestWalkable(Math.floor(fx), Math.floor(fz), 10);
    if (!tile) tile = [Math.floor(fx), Math.floor(fz)];
    const u = game.units.spawn(type, b.owner, tile[0] + 0.5, tile[1] + 0.5, { rot: 0 });
    if (b.rally) {
      const t = b.rally.targetId ? game.entities.get(b.rally.targetId) : null;
      if (t && t.kind === 'resource' && u.def.gatherer) game.commands.order(u, { type: 'gather', targetId: t.id });
      else game.commands.order(u, { type: 'move', x: b.rally.x, z: b.rally.z });
    }
    game.events.emit('unit:trained', u);
    return u;
  }

  // Recompute population (living units + queued) and population cap.
  recount() {
    const game = this.game;
    for (const id in game.players) { game.players[id].pop = 0; game.players[id].popCap = 0; }
    for (const u of game.entities.units()) if (!u.dead) game.players[u.owner].pop += u.def.pop;
    for (const b of game.entities.buildings()) {
      if (b.built && b.def.pop) game.players[b.owner].popCap += b.def.pop;
      for (const q of b.queue) game.players[b.owner].pop += game.units.defs[q.type].pop;
    }
    for (const id in game.players) game.players[id].popCap = Math.min(POP_MAX, game.players[id].popCap);
  }

  // ---- simulation -------------------------------------------------------
  update(dt) {
    const game = this.game;
    const worshippers = {};
    for (const u of game.entities.units()) {
      if (u.dead || !u.order) continue;
      const ot = u.order.type;
      if (ot === 'gather' || ot === 'dropoff') this.updateGatherer(u, dt);
      else if (ot === 'worship') {
        const t = game.entities.get(u.econ?.templeId);
        if (!t || t.removed) { game.commands.idle(u); continue; }
        if (u.moving) continue;
        if (game.movement.distanceTo(u, t) > 1.4) {
          if (++u.econ.tries > 5) { game.commands.idle(u); continue; }
          game.movement.moveTo(u, t.x, t.z, { goalRect: t });
          continue;
        }
        u.rot = Math.atan2(t.x - u.x, t.z - u.z);
        u.anim.want = 'worship';
        if (t.built) worshippers[u.owner] = (worshippers[u.owner] || 0) + 1;
      }
    }
    // favor
    for (const id in game.players) {
      const n = worshippers[id] || 0;
      if (n) game.players[id].res.favor = Math.min(200, game.players[id].res.favor + 0.1 * Math.pow(n, 0.85) * dt);
    }
    // training queues
    for (const b of game.entities.buildings()) {
      if (!b.built || !b.queue.length) continue;
      const q = b.queue[0];
      q.t += dt;
      if (q.t >= q.total) {
        b.queue.shift();
        game.players[b.owner].pop -= game.units.defs[q.type].pop; // re-counted below
        this.spawnFromBuilding(b, q.type);
      }
    }
    this.recount();
    // age advancement
    for (const id in game.players) {
      const p = game.players[id];
      if (!p.advancing) continue;
      p.advancing.t += dt;
      if (p.advancing.t >= p.advancing.total) {
        p.advancing = null;
        p.age = Math.min(AGES.length - 1, p.age + 1);
        game.events.emit('age:advanced', { owner: p.id, age: p.age });
      }
    }
  }

  updateGatherer(u, dt) {
    const game = this.game, mv = game.movement;
    const e = u.econ;
    if (!e) { game.commands.idle(u); return; }
    const cap = u.def.carryCap || 10;
    if (e.phase === 'toRes' || e.phase === 'gathering') {
      let t = game.entities.get(e.resId);
      if (!t || t.removed || (t.kind === 'resource' && t.amount <= 0)) {
        t = this.nearestResource(u.x, u.z, e.resType, 14);
        if (!t) {
          if (u.carry.amount > 0) return this.goDrop(u);
          game.commands.idle(u); return;
        }
        e.resId = t.id; e.phase = 'toRes'; e.tries = 0;
        mv.moveTo(u, t.x, t.z, { goalRect: t });
        return;
      }
      if (u.moving) return;
      const reach = t.def?.farm ? 0.05 : 1.1;
      if (mv.distanceTo(u, t) > reach) {
        if (++e.tries > 6) {
          // unreachable: try a different node
          const alt = this.nearestResource(u.x, u.z, e.resType, 14, t);
          if (!alt) { game.commands.idle(u); return; }
          e.resId = alt.id; e.tries = 0;
          mv.moveTo(u, alt.x, alt.z, { goalRect: alt });
          return;
        }
        if (t.def?.farm) mv.moveTo(u, t.x + ((u.id % 3) - 1) * 0.6, t.z);
        else mv.moveTo(u, t.x, t.z, { goalRect: t });
        return;
      }
      e.phase = 'gathering';
      e.tries = 0;
      if (!t.def?.farm) u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      u.anim.want = 'gather';
      const rate = (t.def?.farm ? FARM_RATE : u.def.gatherRate[e.resType]) * dt;
      u.carry.type = e.resType;
      u.carry.amount = Math.min(cap, u.carry.amount + rate);
      if (t.kind === 'resource') {
        t.amount -= rate;
        if (t.amount <= 0) game.terrain.removeResource(t);
      }
      if (u.carry.amount >= cap) this.goDrop(u);
    } else if (e.phase === 'toDrop') {
      let d = game.entities.get(e.dropId);
      if (!d || d.removed) { this.goDrop(u); d = game.entities.get(e.dropId); if (!d) return; }
      if (u.moving) return;
      if (mv.distanceTo(u, d) > 1.5) {
        if (++e.tries > 6) { game.commands.idle(u); return; }
        mv.moveTo(u, d.x, d.z, { goalRect: d });
        return;
      }
      const p = game.players[u.owner];
      if (u.carry.amount > 0 && u.carry.type) {
        p.res[u.carry.type] += Math.floor(u.carry.amount * 100) / 100;
        game.events.emit('resources:changed', u.owner);
      }
      u.carry = { type: null, amount: 0 };
      if (u.order.type === 'dropoff' || !e.resId) { game.commands.idle(u); return; }
      e.phase = 'toRes'; e.tries = 0;
      const t = game.entities.get(e.resId);
      if (t && !t.removed) {
        if (t.def?.farm) mv.moveTo(u, t.x + ((u.id % 3) - 1) * 0.6, t.z);
        else mv.moveTo(u, t.x, t.z, { goalRect: t });
      }
    }
  }

  goDrop(u) {
    const game = this.game;
    const d = this.nearestDropoff(u.owner, u.x, u.z, u.carry.type);
    if (!d) { game.commands.idle(u); return; }
    u.econ.phase = 'toDrop';
    u.econ.dropId = d.id;
    u.econ.tries = 0;
    game.movement.moveTo(u, d.x, d.z, { goalRect: d });
  }
}
