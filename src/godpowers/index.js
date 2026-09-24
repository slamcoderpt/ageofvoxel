import { BoltRenderer } from './effects.js';

// God powers: favor-costed abilities cast on a target point.
// Public API:
//   godpowers.powers                      -> definitions
//   godpowers.canCast(owner, id) -> { ok, reason }
//   godpowers.cast(owner, id, x, z) -> bool
//   godpowers.cooldownLeft(owner, id)
export const POWERS = {
  lightning_storm: {
    name: 'Lightning Storm', god: 'Zeus', cost: { favor: 40 }, cooldown: 45, radius: 11, duration: 9,
    interval: 0.3, damage: 70, splash: 1.8, hotkey: 'Z',
    desc: 'Calls down a storm that strikes enemy units in the area with lightning.',
  },
  bolt: {
    name: 'Bolt', god: 'Zeus', cost: { favor: 15 }, cooldown: 12, radius: 1.5, damage: 400, hotkey: 'X',
    desc: 'A single bolt that slays one target.',
  },
};

export class GodPowers {
  constructor(game) {
    this.game = game;
    this.powers = POWERS;
    this.storms = [];
    this.bolts = [];
    this.scorches = [];
    this.cooldowns = {}; // `${owner}:${id}` -> time ready
    this.fx = new BoltRenderer(game);
  }

  cooldownLeft(owner, id) { return Math.max(0, (this.cooldowns[`${owner}:${id}`] ?? 0) - this.game.time); }

  canCast(owner, id) {
    const p = this.game.players[owner], def = POWERS[id];
    if (!def) return { ok: false, reason: 'Unknown power' };
    if (this.cooldownLeft(owner, id) > 0) return { ok: false, reason: 'Recharging' };
    if (!p.canAfford(def.cost)) return { ok: false, reason: 'Not enough favor' };
    return { ok: true };
  }

  cast(owner, id, x, z) {
    const game = this.game, def = POWERS[id];
    if (!this.canCast(owner, id).ok) return false;
    game.players[owner].pay(def.cost);
    this.cooldowns[`${owner}:${id}`] = game.time + def.cooldown;
    if (id === 'lightning_storm') {
      this.storms.push({ owner, x, z, t0: game.time, duration: def.duration, radius: def.radius, next: 0.4, def });
    } else if (id === 'bolt') {
      const target = this.findTarget(owner, x, z, def.radius + 1.5);
      this.strike(owner, target ? target.x : x, target ? target.z : z, def.damage, 0, target);
    }
    game.events.emit('godpower:cast', { power: id, owner, x, z });
    return true;
  }

  findTarget(owner, x, z, r, random = false) {
    const game = this.game;
    const cands = game.movement.hash.near(x, z, r, (o) => !o.dead && game.isEnemy(owner, o.owner));
    if (!cands.length) return null;
    if (random) return cands[Math.floor(game.rng.next() * cands.length)];
    cands.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
    return cands[0];
  }

  strike(owner, x, z, damage, splash, target) {
    const game = this.game;
    const y = game.map.heightAt(x, z);
    this.bolts.push({ x, y, z, t0: game.time, life: 0.45, seed: (game.tickCount * 7919 + this.bolts.length * 31) >>> 0 });
    this.scorches.push({ x, y, z, t0: game.time, seed: this.bolts[this.bolts.length - 1].seed });
    if (target) game.combat.damage(target, damage, { owner, id: 0 });
    if (splash > 0) {
      for (const o of game.movement.hash.near(x, z, splash, (o) => !o.dead && o !== target && game.isEnemy(owner, o.owner)))
        game.combat.damage(o, damage * 0.4, { owner, id: 0 });
    }
    game.fx.emit({ x, y: y + 0.3, z, count: 40, color: 0xcfe0ff, size: 0.35, life: 0.6, speed: 7, up: 5, gravity: -14, additive: true });
    game.fx.emit({ x, y: y + 0.2, z, count: 14, color: 0x6a6258, size: 0.8, life: 1.6, speed: 1.5, up: 1.4, gravity: 0.5, grow: 2.5 });
    game.fx.emit({ x, y: y + 0.2, z, count: 10, color: 0x5d4a33, size: 0.18, life: 0.9, speed: 4, up: 5, gravity: -16 });
  }

  update(dt) {
    const game = this.game;
    for (const s of this.storms) {
      if (game.time - s.t0 > s.duration) { s.done = true; continue; }
      s.next -= dt;
      if (s.next <= 0) {
        s.next = s.def.interval * (0.6 + game.rng.next() * 0.8);
        const t = this.findTarget(s.owner, s.x, s.z, s.radius, true);
        if (t) this.strike(s.owner, t.x, t.z, s.def.damage, s.def.splash, t);
        else {
          const a = game.rng.range(0, Math.PI * 2), r = Math.sqrt(game.rng.next()) * s.radius;
          this.strike(s.owner, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 0, s.def.splash, null);
        }
      }
    }
    this.storms = this.storms.filter((s) => !s.done);
    this.bolts = this.bolts.filter((b) => game.time - b.t0 < b.life + 0.05);
    this.scorches = this.scorches.filter((s) => game.time - s.t0 < 14);
  }

  render() {
    this.fx.render(this.bolts, this.storms, this.scorches, this.game.time);
  }
}
