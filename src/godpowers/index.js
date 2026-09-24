import { BoltRenderer } from './effects.js';
import { RNG } from '../core/rng.js';

// God powers: favor-costed abilities cast on a target point.
// Public API:
//   godpowers.powers                      -> definitions
//   godpowers.canCast(owner, id) -> { ok, reason }
//   godpowers.cast(owner, id, x, z) -> bool
//   godpowers.cooldownLeft(owner, id)
// Sim state (read by effects.js): storms, bolts, scorches, zaps, meteors, fires.
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
  meteor: {
    name: 'Meteor', god: 'Hephaestus', cost: { favor: 30 }, cooldown: 30, radius: 4.5, damage: 260, delay: 1.8, hotkey: 'C',
    desc: 'A blazing meteor falls from the heavens, smashing units and buildings where it lands.',
  },
};

export class GodPowers {
  constructor(game) {
    this.game = game;
    this.powers = POWERS;
    this.storms = [];
    this.bolts = [];
    this.scorches = [];
    this.zaps = [];
    this.meteors = [];
    this.fires = [];
    this.cooldowns = {}; // `${owner}:${id}` -> time ready
    this.vrng = new RNG(8675309); // visual-only randomness (never touches game.rng)
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
      this.storms.push({ owner, x, z, t0: game.time, duration: def.duration, radius: def.radius, next: 0.4, sky: 0.2, def });
    } else if (id === 'bolt') {
      const target = this.findTarget(owner, x, z, def.radius + 1.5);
      this.strike(owner, target ? target.x : x, target ? target.z : z, def.damage, 0, target);
    } else if (id === 'meteor') {
      const y = game.map.heightAt(x, z);
      this.meteors.push({ owner, x, z, t0: game.time, delay: def.delay, radius: def.radius, def, sx: x + 16, sy: y + 30, sz: z - 14 });
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

  zap(o) {
    const game = this.game;
    const h = game.units?.heightOf ? game.units.heightOf(o) : 1.2;
    this.zaps.push({ x: o.x, y: game.map.heightAt(o.x, o.z), z: o.z, h: (h || 1.8) * 0.8, t0: game.time, life: 0.7, seed: (game.tickCount * 131 + o.id * 17) >>> 0 });
  }

  strike(owner, x, z, damage, splash, target) {
    const game = this.game;
    const y = game.map.heightAt(x, z);
    const seed = (game.tickCount * 7919 + this.bolts.length * 31 + (x * 13 | 0)) >>> 0;
    this.bolts.push({ x, y, z, t0: game.time, life: 0.5, seed });
    this.scorches.push({ x, y, z, t0: game.time, seed });
    if (target) { game.combat.damage(target, damage, { owner, id: 0 }); this.zap(target); }
    if (splash > 0) {
      for (const o of game.movement.hash.near(x, z, splash, (o) => !o.dead && o !== target && game.isEnemy(owner, o.owner))) {
        game.combat.damage(o, damage * 0.4, { owner, id: 0 });
        this.zap(o);
      }
    }
    // white-hot sparks, blue electric motes, earth and smoke
    game.fx.emit({ x, y: y + 0.3, z, count: 55, color: 0xe4f0ff, size: 0.3, life: 0.55, speed: 9, up: 6, gravity: -16, additive: true, drag: 0.5 });
    game.fx.emit({ x, y: y + 0.6, z, count: 24, color: 0x5d8cff, size: 0.55, life: 0.8, speed: 3.5, up: 2.5, gravity: -2, additive: true, spread: 0.6 });
    game.fx.emit({ x, y: y + 0.2, z, count: 8, color: 0x5a5550, size: 0.45, life: 1.4, speed: 1.6, up: 1.5, gravity: 0.6, grow: 1.6 });
    game.fx.emit({ x, y: y + 0.2, z, count: 14, color: 0x5d4a33, size: 0.2, life: 1.0, speed: 4.5, up: 6, gravity: -16 });
    game.fx.emit({ x, y: y + 0.2, z, count: 10, color: 0xff9a3a, size: 0.22, life: 1.2, speed: 1.2, up: 2.5, gravity: 1.5, additive: true, spread: 0.5 });
  }

  impactMeteor(m) {
    const game = this.game, def = m.def;
    const { x, z, owner } = m;
    const y = game.map.heightAt(x, z);
    const seed = (game.tickCount * 7919 + 77) >>> 0;
    this.scorches.push({ x, y, z, t0: game.time, seed, size: m.radius * 2.4, blast: true });
    const hitU = game.movement.hash.near(x, z, m.radius, (o) => !o.dead && game.isEnemy(owner, o.owner));
    for (const o of hitU) {
      const d = Math.hypot(o.x - x, o.z - z) / m.radius;
      game.combat.damage(o, def.damage * (1 - d * 0.5), { owner, id: 0 });
    }
    for (const b of [...game.entities.buildings()]) {
      if (b.dead || !game.isEnemy(owner, b.owner)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < m.radius + Math.max(b.def?.w ?? 2, b.def?.h ?? 2) / 2) game.combat.damage(b, def.damage * 1.5, { owner, id: 0, def: { class: 'myth' } });
    }
    game.fx.emit({ x, y: y + 0.6, z, count: 90, color: 0xffb040, size: 0.55, life: 0.8, speed: 11, up: 7, gravity: -10, additive: true, spread: 0.8 });
    game.fx.emit({ x, y: y + 1.0, z, count: 30, color: 0xff5a18, size: 1.4, life: 0.7, speed: 4, up: 3, gravity: 1, additive: true, grow: 1.5, spread: 1 });
    game.fx.emit({ x, y: y + 0.4, z, count: 40, color: 0x4a3a2a, size: 0.3, life: 1.4, speed: 8, up: 10, gravity: -18, spread: 1 });
    game.fx.emit({ x, y: y + 0.5, z, count: 30, color: 0x3c3632, size: 1.4, life: 3.0, speed: 2.5, up: 2.2, gravity: 0.8, grow: 3, spread: 1.5 });
    this.fires.push({ x, y, z, r: m.radius * 0.7, t0: game.time, dur: 6 });
  }

  update(dt) {
    const game = this.game, vr = this.vrng;
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
      // cosmetic cloud-to-cloud lightning
      s.sky -= dt;
      if (s.sky <= 0) {
        s.sky = vr.range(0.25, 0.7);
        const a = vr.range(0, Math.PI * 2), r = s.radius * vr.range(0.9, 1.6);
        const y = game.map.heightAt(s.x, s.z) + vr.range(13, 16);
        this.bolts.push({ kind: 'sky', x: s.x + Math.cos(a) * r, y, z: s.z + Math.sin(a) * r, t0: game.time, life: 0.35, seed: (vr.next() * 1e9) >>> 0 });
      }
    }
    for (const m of this.meteors) {
      const t = game.time - m.t0;
      const k = Math.min(1, t / m.delay);
      const y = game.map.heightAt(m.x, m.z);
      const px = m.sx + (m.x - m.sx) * k, py = m.sy + (y - m.sy) * k, pz = m.sz + (m.z - m.sz) * k;
      game.fx.emit({ x: px, y: py, z: pz, count: 6, color: 0xff8a30, size: 0.9, life: 0.5, speed: 0.6, up: 0.3, gravity: 0, additive: true, grow: 1.2, spread: 0.5 });
      game.fx.emit({ x: px, y: py, z: pz, count: 3, color: 0x3a3430, size: 1.0, life: 1.4, speed: 0.4, up: 0.3, gravity: 0.4, grow: 2.5, spread: 0.6 });
      if (t >= m.delay) { m.done = true; this.impactMeteor(m); }
    }
    for (const f of this.fires) {
      const age = game.time - f.t0;
      if (age > f.dur) { f.done = true; continue; }
      const k = 1 - age / f.dur;
      const a = vr.range(0, Math.PI * 2), r = Math.sqrt(vr.next()) * f.r;
      const fx = f.x + Math.cos(a) * r, fz = f.z + Math.sin(a) * r, fy = game.map.heightAt(fx, fz);
      game.fx.emit({ x: fx, y: fy + 0.3, z: fz, count: Math.ceil(3 * k), color: 0xff7a20, size: 0.7, life: 0.7, speed: 0.3, up: 2.2, gravity: 2, additive: true, grow: -0.6, spread: 0.3 });
      if (vr.chance(0.3 * k)) game.fx.emit({ x: fx, y: fy + 1, z: fz, count: 1, color: 0x2e2a28, size: 1.1, life: 2.2, speed: 0.3, up: 1.6, gravity: 0.5, grow: 2 });
    }
    // lightning scorch smoulders briefly
    for (const s of this.scorches) {
      const age = game.time - s.t0;
      if (!s.blast && age < 1.5 && vr.chance(0.35)) game.fx.emit({ x: s.x, y: s.y + 0.2, z: s.z, count: 1, color: 0x4a4644, size: 0.4, life: 1.4, speed: 0.2, up: 1.2, gravity: 0.6, grow: 1.4 });
    }
    this.storms = this.storms.filter((s) => !s.done);
    this.meteors = this.meteors.filter((m) => !m.done);
    this.fires = this.fires.filter((f) => !f.done);
    this.bolts = this.bolts.filter((b) => game.time - b.t0 < b.life + 0.05);
    this.zaps = this.zaps.filter((z) => game.time - z.t0 < z.life);
    this.scorches = this.scorches.filter((s) => game.time - s.t0 < 14);
  }

  render() {
    this.fx.render(this, this.game.time);
  }
}
