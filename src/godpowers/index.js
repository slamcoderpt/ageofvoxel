import { BoltRenderer } from './effects.js';
import { RNG, hash2 } from '../core/rng.js';

// God powers: favor-costed abilities cast on a target point.
// Public API:
//   godpowers.powers                      -> definitions
//   godpowers.canCast(owner, id) -> { ok, reason }
//   godpowers.cast(owner, id, x, z) -> bool
//   godpowers.cooldownLeft(owner, id)
// Sim state (read by effects.js): storms, bolts, scorches, zaps, meteors, fires, debris.
// Knockback: a strike throws nearby units; while airborne a unit carries
// u.airY (height above ground) and u.airRx/u.airRz (tumble, local frame),
// which the units renderer applies to its root transform.
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
    this.debris = [];
    this.sparks = [];
    this.airborne = [];
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
    this.zaps.push({ u: o, x: o.x, y: game.map.heightAt(o.x, o.z), z: o.z, h: (h || 1.8) * 0.8, t0: game.time, life: 0.7, seed: (game.tickCount * 131 + o.id * 17) >>> 0 });
  }

  // Throw a unit away from (x, z). Deterministic (hash of id + tick).
  knock(o, x, z, power) {
    if (o.kind !== 'unit') return;
    const game = this.game;
    let dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz);
    if (d < 0.08) { const a = hash2(o.id, game.tickCount, 7) * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); d = 1; }
    else { dx /= d; dz /= d; }
    const heavy = (o.maxHp ?? 100) > 300 ? 0.3 : 1;
    const f = power * (1 - Math.min(1, d / 3) * 0.55) * heavy * (0.8 + hash2(o.id, game.tickCount, 3) * 0.4);
    const a = o.gp_air || (o.gp_air = {});
    a.done = false;
    a.vx = dx * 3.4 * f; a.vz = dz * 3.4 * f; a.vy = 5.5 + 5 * f;
    // tumble backwards, away from the blast (axis perpendicular to the throw, in the unit's frame)
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    const spin = (7 + 6 * hash2(o.id, 11)) * f;
    a.wx = lz * spin; a.wz = -lx * spin;
    o.airY = Math.max(o.airY || 0, 0.02);
    o.airRx = o.airRx || 0; o.airRz = o.airRz || 0;
    if (!this.airborne.includes(o)) this.airborne.push(o);
  }

  // Voxel chunks of earth, turf and soot blown out of a strike crater, plus a few glowing embers.
  throwDebris(x, y, z, n, power = 1, seed = 1) {
    const vr = new RNG(seed);
    const COLS = [0x5b4430, 0x6e5238, 0x4a3726, 0x4e7a2e, 0x3f6526, 0x1c1814, 0x2a2420, 0x7a7468];
    const now = this.game.time;
    for (let i = 0; i < n; i++) {
      const a = vr.range(0, Math.PI * 2), sp = vr.range(1.5, 5.5) * power;
      const ember = i < Math.ceil(n * 0.2);
      this.debris.push({
        x: x + Math.cos(a) * 0.3, y: y + 0.2, z: z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp, vy: vr.range(4, 10) * power, vz: Math.sin(a) * sp,
        rx: vr.range(0, 6), ry: vr.range(0, 6), rz: vr.range(0, 6),
        wx: vr.range(-12, 12), wy: vr.range(-8, 8), wz: vr.range(-12, 12),
        s: ember ? vr.range(0.1, 0.18) : vr.range(0.12, 0.34), color: vr.pick(COLS),
        ember, cool: vr.range(1.2, 2.6), t0: now, settled: false, die: now + vr.range(7, 11),
      });
    }
    if (this.debris.length > 460) this.debris.splice(0, this.debris.length - 460);
  }

  // White-hot sparks flung out of the impact (drawn as velocity streaks).
  throwSparks(x, y, z, n, seed) {
    const vr = new RNG(seed ^ 0x5bd1e995), now = this.game.time;
    for (let i = 0; i < n; i++) {
      const a = vr.range(0, Math.PI * 2), sp = vr.range(4, 11);
      this.sparks.push({ x, y: y + 0.25, z, vx: Math.cos(a) * sp, vy: vr.range(3, 10), vz: Math.sin(a) * sp, t0: now, life: vr.range(0.35, 0.8) });
    }
    if (this.sparks.length > 240) this.sparks.splice(0, this.sparks.length - 240);
  }

  // Charred clods heaped round the crater lip (already at rest).
  charRim(x, y, z, seed) {
    const vr = new RNG(seed ^ 0x27d4eb2d), now = this.game.time, map = this.game.map;
    const COLS = [0x16120f, 0x201a15, 0x2c241c, 0x3a2e22];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + vr.range(-0.25, 0.25), r = vr.range(0.75, 1.3), s = vr.range(0.16, 0.3);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      this.debris.push({ x: px, y: map.heightAt(px, pz) + s * 0.45, z: pz, vx: 0, vy: 0, vz: 0, rx: 0, ry: vr.range(0, 6), rz: 0, wx: 0, wy: 0, wz: 0,
        s, color: vr.pick(COLS), ember: false, cool: 0, t0: now, settled: true, die: now + vr.range(9, 12) });
    }
  }

  strike(owner, x, z, damage, splash, target) {
    const game = this.game;
    const y = game.map.heightAt(x, z);
    const seed = (game.tickCount * 7919 + this.bolts.length * 31 + (x * 13 | 0)) >>> 0;
    this.bolts.push({ x, y, z, t0: game.time, life: 0.75, seed });
    this.scorches.push({ x, y, z, t0: game.time, seed });
    const thrown = game.movement.hash.near(x, z, Math.max(2.6, splash + 0.8), (o) => !o.dead && game.isEnemy(owner, o.owner));
    if (target) { game.combat.damage(target, damage, { owner, id: 0 }); this.zap(target); }
    if (splash > 0) {
      for (const o of game.movement.hash.near(x, z, splash, (o) => !o.dead && o !== target && game.isEnemy(owner, o.owner))) {
        game.combat.damage(o, damage * 0.4, { owner, id: 0 });
        this.zap(o);
      }
    }
    for (const o of thrown) this.knock(o, x, z, o === target ? 1.1 : 0.8);
    this.throwDebris(x, y, z, 26, 1, seed);
    this.charRim(x, y, z, seed);
    this.throwSparks(x, y, z, 26, seed);
    // the storm perimeter answers each strike: arcs flare on the side it hit
    for (const s of this.storms) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.radius * 1.3) continue;
      const a0 = Math.atan2(z - s.z, x - s.x);
      for (let k = 0; k < 3; k++) {
        this.bolts.push({ kind: 'rim', x: s.x, z: s.z, r: s.radius, a0: a0 + this.vrng.range(-0.9, 0.9), span: this.vrng.range(0.25, 0.6) * (this.vrng.chance(0.5) ? 1 : -1), t0: game.time, life: this.vrng.range(0.2, 0.4), seed: (this.vrng.next() * 1e9) >>> 0 });
      }
    }
    // white-hot sparks, blue electric motes, earth and smoke
    game.fx.emit({ x, y: y + 0.3, z, count: 30, color: 0xcfe2ff, size: 0.2, life: 0.5, speed: 9, up: 6, gravity: -16, additive: true, drag: 0.5 });
    game.fx.emit({ x, y: y + 0.6, z, count: 10, color: 0x3d6cdf, size: 0.4, life: 0.7, speed: 3.5, up: 2.5, gravity: -2, additive: true, spread: 0.6 });
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
      this.knock(o, x, z, 1.5 * (1 - d * 0.6));
    }
    this.throwDebris(x, y, z, 60, 1.5, seed);
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
      // static crawling along the storm perimeter
      for (let k = 0; k < 2; k++) {
        if (!vr.chance(0.55)) continue;
        this.bolts.push({ kind: 'rim', x: s.x, z: s.z, r: s.radius, a0: vr.range(0, Math.PI * 2), span: vr.range(0.18, 0.5) * (vr.chance(0.5) ? 1 : -1), t0: game.time, life: vr.range(0.12, 0.3), seed: (vr.next() * 1e9) >>> 0 });
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
    // lightning craters smoke: a dark column that thins out over a few seconds
    for (const s of this.scorches) {
      const age = game.time - s.t0;
      if (s.blast || age > 5) continue;
      const k = 1 - age / 5;
      if (vr.chance(0.25 + 0.6 * k)) game.fx.emit({ x: s.x + vr.range(-0.4, 0.4), y: s.y + 0.3, z: s.z + vr.range(-0.4, 0.4), count: 1, color: vr.chance(0.5) ? 0x2a2826 : 0x3d3a38, size: 0.55 + 0.35 * k, life: 2.2, speed: 0.25, up: 1.6, gravity: 0.9, grow: 1.8, spread: 0.3 });
    }
    this.updateDebris(dt);
    for (const p of this.sparks) {
      p.vy -= 20 * dt;
      p.vx *= 1 - 1.2 * dt; p.vz *= 1 - 1.2 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const g = game.map.heightAt(p.x, p.z) + 0.05;
      if (p.y < g) { p.y = g; p.vy = Math.abs(p.vy) * 0.35; p.vx *= 0.6; p.vz *= 0.6; }
    }
    this.sparks = this.sparks.filter((p) => game.time - p.t0 < p.life);
    this.updateAirborne(dt);
    this.storms = this.storms.filter((s) => !s.done);
    this.meteors = this.meteors.filter((m) => !m.done);
    this.fires = this.fires.filter((f) => !f.done);
    this.bolts = this.bolts.filter((b) => game.time - b.t0 < b.life + 0.05);
    this.zaps = this.zaps.filter((z) => game.time - z.t0 < z.life);
    this.scorches = this.scorches.filter((s) => game.time - s.t0 < 14);
  }

  updateDebris(dt) {
    const game = this.game, now = game.time;
    for (const d of this.debris) {
      if (d.settled) continue;
      d.vy -= 22 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      const g = game.map.heightAt(d.x, d.z) + d.s * 0.45;
      if (d.y <= g) {
        d.y = g;
        if (d.vy < -3) { d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.wx *= 0.5; d.wz *= 0.5; }
        else { d.settled = true; d.rx = Math.round(d.rx / (Math.PI / 2)) * (Math.PI / 2); d.rz = Math.round(d.rz / (Math.PI / 2)) * (Math.PI / 2); }
      }
    }
    this.debris = this.debris.filter((d) => now < d.die);
  }

  updateAirborne(dt) {
    const game = this.game, map = game.map;
    for (const u of this.airborne) {
      const a = u.gp_air;
      a.vy -= 18 * dt;
      u.airY += a.vy * dt;
      const nx = u.x + a.vx * dt, nz = u.z + a.vz * dt;
      if (map.isWalkable(Math.floor(nx), Math.floor(nz))) { u.x = nx; u.z = nz; } else { a.vx = 0; a.vz = 0; }
      u.airRx += a.wx * dt; u.airRz += a.wz * dt;
      if (u.airY <= 0 && a.vy < 0) {
        u.airY = 0; u.airRx = 0; u.airRz = 0; a.done = true;
        game.fx.emit({ x: u.x, y: map.heightAt(u.x, u.z) + 0.1, z: u.z, count: 6, color: 0x6b5a44, size: 0.35, life: 0.8, speed: 1.4, up: 0.8, gravity: -2, grow: 1.2 });
      }
    }
    this.airborne = this.airborne.filter((u) => !u.gp_air.done && game.entities.get(u.id));
  }

  render() {
    this.fx.render(this, this.game.time);
  }
}
