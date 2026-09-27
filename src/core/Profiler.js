// Simulation / render profiler. Off by default: Game.tick() and Game.frame()
// only take the timed path when game.prof is set (?prof=1, or a scene with
// `prof: true` such as the stress scene), so normal play pays one null check
// per tick and per frame.
//
// Per sim tick (game.prof.last):
//   { tick, total, sys: { economy, buildings, combat, ... },   ms per system in game.simOrder
//     ai: { <owner>: ms },                                       each EnemyAI instance (inside combat)
//     sub: { 'combat.projectiles', 'combat.fx', 'units.spread' }, selected sub-steps
//     calls: { findPath: [n, ms], nearestWalkable: [n, ms], pickTarget: [n, ms],
//              findEnemyNear: [n, ms], nearestResource: [n, ms], nearestDropoff: [n, ms] },
//     callsBy: { 'findPath@combat': [n, ms], ... } }                the same, split by calling system
// Per rendered frame (game.prof.lastFrame):
//   { total, camera, pieces: { lighting, terrain, buildings, units, ... }, draw }  CPU ms
// game.prof.sums accumulates every tick since the last reset() (for the F3 meter).
export class Profiler {
  constructor(game) {
    this.game = game;
    this.last = null;
    this.lastFrame = null;
    this.names = new Map();
    this.cur = null;
    this.sys = '';
    this.wrapped = new WeakSet();
    this.reset();
    const nameOf = (piece) => Object.keys(game).find((k) => game[k] === piece && k !== 'prof') || piece.constructor.name;
    for (const s of game.simOrder) this.names.set(s, nameOf(s));
    for (const r of game.renderOrder) this.names.set(r, nameOf(r));
    // counted + timed calls (instance wrappers; nothing changes when off)
    this.wrapCall(game.pathfinder, 'findPath');
    this.wrapCall(game.pathfinder, 'nearestWalkable');
    this.wrapCall(game.combat, 'pickTarget');
    this.wrapCall(game.combat, 'findEnemyNear');
    this.wrapCall(game.economy, 'nearestResource');
    this.wrapCall(game.economy, 'nearestDropoff');
    this.wrapSub(game.combat.projectiles, 'update', 'combat.projectiles');
    this.wrapSub(game.combat.fx, 'update', 'combat.fx');
    this.wrapSub(game.units, '_spread', 'units.spread');
  }

  reset() { this.sums = { ticks: 0, total: 0, sys: {} }; }

  wrapCall(obj, key) {
    const orig = obj[key];
    const self = this;
    obj[key] = function (...a) {
      const c = self.cur;
      if (!c) return orig.apply(this, a);
      const t = performance.now();
      try { return orig.apply(this, a); } finally {
        const ms = performance.now() - t;
        const e = (c.calls[key] ||= [0, 0]);
        e[0]++; e[1] += ms;
        const b = (c.callsBy[`${key}@${self.sys}`] ||= [0, 0]);
        b[0]++; b[1] += ms;
      }
    };
  }

  wrapSub(obj, key, label) {
    const orig = obj[key];
    const self = this;
    obj[key] = function (...a) {
      const c = self.cur;
      if (!c) return orig.apply(this, a);
      const t = performance.now();
      try { return orig.apply(this, a); } finally { c.sub[label] = (c.sub[label] || 0) + performance.now() - t; }
    };
  }

  // AI instances can be added after the profiler (scenes add them in setup).
  wrapAIs() {
    for (const ai of this.game.combat.ais) {
      if (this.wrapped.has(ai)) continue;
      this.wrapped.add(ai);
      const orig = ai.update, self = this, owner = ai.owner;
      ai.update = function (...a) {
        const c = self.cur;
        if (!c) return orig.apply(this, a);
        const t = performance.now();
        try { return orig.apply(this, a); } finally { c.ai[owner] = (c.ai[owner] || 0) + performance.now() - t; }
      };
    }
  }

  tick(dt) {
    const game = this.game;
    this.wrapAIs();
    const rec = { tick: game.tickCount, total: 0, sys: {}, ai: {}, sub: {}, calls: {}, callsBy: {} };
    this.cur = rec;
    const t0 = performance.now();
    try {
      for (const s of game.simOrder) {
        const name = this.names.get(s);
        this.sys = name;
        const t = performance.now();
        s.update?.(dt);
        rec.sys[name] = performance.now() - t;
      }
    } finally {
      rec.total = performance.now() - t0;
      this.cur = null;
    }
    this.last = rec;
    const S = this.sums;
    S.ticks++; S.total += rec.total;
    for (const k in rec.sys) S.sys[k] = (S.sys[k] || 0) + rec.sys[k];
  }

  frame(realDt, alpha) {
    const game = this.game;
    const rec = { total: 0, pieces: {}, draw: 0 };
    const t0 = performance.now();
    for (const r of game.renderOrder) {
      const t = performance.now();
      r.render?.(realDt, alpha);
      rec.pieces[this.names.get(r)] = performance.now() - t;
    }
    const t = performance.now();
    game.lighting.draw();
    rec.draw = performance.now() - t;
    rec.total = performance.now() - t0;
    this.lastFrame = rec;
  }
}
