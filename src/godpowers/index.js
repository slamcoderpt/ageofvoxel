import { BoltRenderer, boltLines } from './effects.js';
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
    name: 'Lightning Storm', god: 'Zeus', cost: { favor: 40 }, cooldown: 45, radius: 7.5, duration: 9,
    interval: 0.3, damage: 70, splash: 1.8, hotkey: 'Z',
    desc: 'Calls down a whirling storm that strikes enemy units in the area with lightning and hurls them into the air.',
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
    this.struck = []; // units in a lightning hit state (u.gp_hit white flash -> u.gp_char)
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

  findTarget(owner, x, z, r, random = false, grounded = false) {
    const game = this.game;
    // (grounded: skip men carried up the whirl - a bolt earthing right under
    // a flying man bleached him white in its point light)
    const cands = game.movement.hash.near(x, z, r, (o) => !o.dead && game.isEnemy(owner, o.owner) && !(grounded && o.gp_air && !o.gp_air.done));
    if (!cands.length) return null;
    if (random) return cands[Math.floor(game.rng.next() * cands.length)];
    cands.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
    return cands[0];
  }

  zap(o) {
    const game = this.game;
    const h = game.units?.heightOf ? game.units.heightOf(o) : 1.2;
    // (the struck unit's own hit flash comes from combat.damage; the blue
    // strike light does the rest)
    this.zaps.push({ u: o, x: o.x, y: game.map.heightAt(o.x, o.z), z: o.z, h: (h || 1.8) * 0.8, t0: game.time, life: 0.4, seed: (game.tickCount * 131 + o.id * 17) >>> 0 });
    // hit state: a white-hot flash for a few frames, then the man is charred
    if (o.kind === 'unit') { o.gp_hitT = game.time; if (!this.struck.includes(o)) this.struck.push(o); }
  }

  // Throw a unit away from (x, z). Deterministic (hash of id + tick).
  knock(o, x, z, power) {
    if (o.kind !== 'unit') return;
    if (o.gp_air && !o.gp_air.done && o.gp_air.vortex && !o.gp_air.flung) return;
    const game = this.game;
    let dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz);
    if (d < 0.08) { const a = hash2(o.id, game.tickCount, 7) * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); d = 1; }
    else { dx /= d; dz /= d; }
    const heavy = (o.maxHp ?? 100) > 300 ? 0.3 : 1;
    const f = power * (1 - Math.min(1, d / 3) * 0.55) * heavy * (0.8 + hash2(o.id, game.tickCount, 3) * 0.4);
    const a = o.gp_air || (o.gp_air = {});
    a.done = false; a.vortex = null; a.trail = a.trail || [];
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
  throwDebris(x, y, z, n, power = 1, seed = 1, blue = false) {
    const vr = new RNG(seed);
    const COLS = [0x5b4430, 0x6e5238, 0x4a3726, 0x4e7a2e, 0x3f6526, 0x1c1814, 0x2a2420, 0x7a7468];
    const now = this.game.time;
    for (let i = 0; i < n; i++) {
      const a = vr.range(0, Math.PI * 2), sp = vr.range(1.5, 5.5) * power;
      const ember = i < Math.ceil(n * (blue ? 0.2 : 0.4));
      this.debris.push({
        x: x + Math.cos(a) * 0.3, y: y + 0.2, z: z + Math.sin(a) * 0.3,
        vx: Math.cos(a) * sp, vy: vr.range(4, 10) * power, vz: Math.sin(a) * sp,
        rx: vr.range(0, 6), ry: vr.range(0, 6), rz: vr.range(0, 6),
        wx: vr.range(-12, 12), wy: vr.range(-8, 8), wz: vr.range(-12, 12),
        s: ember ? vr.range(0.1, 0.18) : vr.range(0.12, 0.34), color: vr.pick(COLS),
        ember, blue, cool: blue ? vr.range(0.3, 0.6) : vr.range(1.2, 2.6), t0: now, settled: false, die: now + (blue ? vr.range(3, 5) : vr.range(7, 11)),
      });
    }
    if (this.debris.length > 460) this.debris.splice(0, this.debris.length - 460);
  }

  // White-hot sparks flung out of the impact (drawn as velocity streaks).
  throwSparks(x, y, z, n, seed, power = 1, dim = 1, warm = false) {
    const vr = new RNG(seed ^ 0x5bd1e995), now = this.game.time;
    for (let i = 0; i < n; i++) {
      // mostly a tight fountain over the crater, a few flung wide
      const a = vr.range(0, Math.PI * 2), wide = vr.chance(0.25), sp = (wide ? vr.range(6, 11) : vr.range(1.5, 5)) * power;
      // each spark starts a few ms into its flight (the discharge is already
      // throwing them as the first stroke lands), so the burst reads at once
      const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = vr.range(6, 13) * power, t = vr.range(0.02, 0.12);
      this.sparks.push({ x: x + vx * t, y: y + 0.25 + vy * t - 10 * t * t, z: z + vz * t, vx, vy: vy - 20 * t, vz, t0: now - t, life: vr.range(0.45, 0.9) * (0.6 + 0.4 * power), dim, warm: warm && i % 5 < 2, heat: vr.range(0.75, 1.1) });
    }
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400);
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
    // the channel (with its forks) is laid out now, so the forks that earth
    // themselves leave their own small scorch
    const lines = boltLines(seed, x, y, z, (px, pz) => game.map.heightAt(px, pz));
    this.bolts.push({ x, y, z, t0: game.time, life: 0.75, seed, lines });
    this.scorches.push({ x, y, z, t0: game.time, seed });
    for (const e of lines.ends) this.scorches.push({ x: e.x, y: e.y, z: e.z, t0: game.time, seed: seed ^ ((e.x * 97) | 0), size: 1.5 + e.w });
    const thrown = game.movement.hash.near(x, z, Math.max(2.6, splash + 0.8), (o) => !o.dead && game.isEnemy(owner, o.owner));
    // combat's white hit flash is an emissive lift; under the storm-dimmed
    // light it greys struck men out, so lightning hits keep only a trace of it
    // (the blue zap rim marks who was struck)
    const hit = (o, dmg) => { game.combat.damage(o, dmg, { owner, id: 0 }); if (o.flashT > 0.03) o.flashT = 0.03; this.zap(o); };
    if (target) hit(target, damage);
    if (splash > 0) {
      for (const o of game.movement.hash.near(x, z, splash, (o) => !o.dead && o !== target && game.isEnemy(owner, o.owner))) hit(o, damage * 0.4);
    }
    for (const o of thrown) this.knock(o, x, z, o === target ? 1.1 : 0.8);
    // voxel chunks of earth blown up out of the crater (lit by the strike),
    // a ring of charred clods, one fountain of hot sparks and a smoke puff
    this.throwDebris(x, y, z, 18, 1.1, seed, true);
    this.charRim(x, y, z, seed);
    this.throwSparks(x, y, z, 24, seed, 1.0);
    game.fx.emit({ x, y: y + 0.2, z, count: 5, color: 0x2a2622, size: 0.42, life: 1.0, speed: 2.0, up: 1.2, gravity: 0.6, grow: 1.5, spread: 0.35 });
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
        const t = this.findTarget(s.owner, s.x, s.z, s.radius * 0.78, true, true);
        if (t) this.strike(s.owner, t.x, t.z, s.def.damage, s.def.splash, t);
        else {
          const a = game.rng.range(0, Math.PI * 2), r = Math.sqrt(game.rng.next()) * s.radius * 0.7;
          this.strike(s.owner, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 0, s.def.splash, null);
        }
      }
      this.vortex(s, dt);
      // cosmetic cloud-to-cloud lightning
      s.sky -= dt;
      if (s.sky <= 0) {
        s.sky = vr.range(0.25, 0.7);
        const a = vr.range(0, Math.PI * 2), r = s.radius * vr.range(0.9, 1.6);
        const y = game.map.heightAt(s.x, s.z) + vr.range(20, 24);
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
      // tongues of flame licking up out of the crater and the wreck, a hot
      // yellow heart, and a thick column of black smoke
      for (let j = 0; j < 5; j++) {
        const a = vr.range(0, Math.PI * 2), r = Math.sqrt(vr.next()) * f.r * 0.8;
        const fx = f.x + Math.cos(a) * r, fz = f.z + Math.sin(a) * r, fy = game.map.heightAt(fx, fz);
        game.fx.emit({ x: fx, y: fy + 0.3 + vr.range(0, 2.4) * (1 - r / f.r), z: fz, count: Math.ceil(5 * k), color: j & 1 ? 0xff7a20 : 0xff5a10, size: 1.35, life: 0.9, speed: 0.35, up: 3.6, gravity: 2.2, additive: true, grow: -0.55, spread: 0.45 });
      }
      game.fx.emit({ x: f.x + vr.range(-1, 1), y: f.y + 0.4, z: f.z + vr.range(-1, 1), count: Math.ceil(2 * k), color: 0xffc050, size: 0.8, life: 0.6, speed: 0.3, up: 3.8, gravity: 2, additive: true, grow: -0.6, spread: 0.6 });
      if (vr.chance(0.7 * k)) game.fx.emit({ x: f.x + vr.range(-1.5, 1.5), y: f.y + 2.2, z: f.z + vr.range(-1.5, 1.5), count: 1, color: vr.chance(0.5) ? 0x1e1b1a : 0x2e2a28, size: 1.6, life: 3.2, speed: 0.3, up: 2.4, gravity: 0.5, grow: 2.4 });
    }
    // lightning craters smoke: a dark column that thins out over a few seconds
    for (const s of this.scorches) {
      const age = game.time - s.t0;
      if (s.blast || s.size || age > 5) continue;
      const k = 1 - age / 5;
      if (vr.chance(0.04 + 0.12 * k)) game.fx.emit({ x: s.x + vr.range(-0.4, 0.4), y: s.y + 0.3, z: s.z + vr.range(-0.4, 0.4), count: 1, color: vr.chance(0.5) ? 0x2a2826 : 0x34302d, size: 0.4 + 0.25 * k, life: 1.6, speed: 0.25, up: 1.3, gravity: 0.9, grow: 1.5, spread: 0.3 });
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
    this.updateStruck();
    this.storms = this.storms.filter((s) => !s.done);
    this.meteors = this.meteors.filter((m) => !m.done);
    this.fires = this.fires.filter((f) => !f.done);
    this.bolts = this.bolts.filter((b) => game.time - b.t0 < b.life + 0.05);
    this.zaps = this.zaps.filter((z) => game.time - z.t0 < z.life);
    this.scorches = this.scorches.filter((s) => game.time - s.t0 < 14);
  }

  // The storm is a whirlwind: enemy men inside it are snatched off their feet
  // (deterministic, game.rng), carried round with the spin while they climb,
  // tumbling, and then flung outward along the spin. Heavy myth units hold.
  vortex(s, dt) {
    const game = this.game, age = game.time - s.t0;
    if (age < 0.35 || age > s.duration - 1.2) return;
    const ramp = Math.min(1, (age - 0.35) / 0.6);
    const cands = game.movement.hash.near(s.x, s.z, s.radius * 0.95, (o) => !o.dead && o.kind === 'unit' && game.isEnemy(s.owner, o.owner));
    for (const u of cands) {
      if ((u.maxHp ?? 100) > 300) continue;
      if (u.gp_air && !u.gp_air.done) continue;
      if (game.rng.next() > 1.2 * dt * ramp) continue;
      const a = u.gp_air || (u.gp_air = {});
      a.done = false;
      a.vortex = s;
      a.t0 = game.time;
      // each man is carried to his own height and orbit up the funnel, so
      // the caught read as separate figures strung up the whirl, not a heap
      a.hT = 1.8 + game.rng.next() * 7.8;
      a.orb = 0.42 + game.rng.next() * 0.34;
      a.hold = 2.2 + game.rng.next() * 2.2;
      a.flung = false;
      a.vx = 0; a.vz = 0; a.vy = 2.5 + game.rng.next() * 1.5;
      // carried men lean and sway (a bounded tilt, so the silhouette stays a
      // man, not a spinning blur); the full tumble comes when they are flung
      a.tilt = 0.35 + game.rng.next() * 0.45; a.wf = 2 + game.rng.next() * 2.5; a.ph = game.rng.next() * 6.28;
      const sp = 3 + game.rng.next() * 5;
      a.wx = (game.rng.next() - 0.5) * sp; a.wz = (game.rng.next() - 0.5) * sp;
      a.yaw = (3 + game.rng.next() * 3);
      a.trail = [];
      u.airY = Math.max(u.airY || 0, 0.02); u.airRx = u.airRx || 0; u.airRz = u.airRz || 0;
      if (!this.airborne.includes(u)) this.airborne.push(u);
      if (game.commands?.order) game.commands.order(u, { type: 'idle' });
    }
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

  // Lightning hit state on struck units (read by the units renderer):
  // u.gp_hit is an emissive white-hot flash for the first ~0.15 s, u.gp_char
  // a dark charred tint that follows it (the living recover after a few s).
  updateStruck() {
    const now = this.game.time;
    for (const u of this.struck) {
      const age = now - u.gp_hitT;
      u.gp_hit = age < 0.05 ? 0.4 : Math.max(0, 0.4 * (1 - (age - 0.05) / 0.1));
      const on = Math.min(1, Math.max(0, (age - 0.05) / 0.25));
      const off = u.dead ? 1 : 1 - Math.min(1, Math.max(0, (age - 4) / 3));
      u.gp_char = 0.5 * on * off;
      if (age > 7.5 && !u.dead || age > 30 || !this.game.entities.get(u.id)) { u.gp_hit = 0; u.gp_char = 0; u.gp_done = true; }
    }
    this.struck = this.struck.filter((u) => !u.gp_done || (u.gp_done = false));
  }

  updateAirborne(dt) {
    const game = this.game, map = game.map;
    for (const u of this.airborne) {
      const a = u.gp_air;
      const s = a.vortex;
      if (s && !a.flung) {
        // carried round the funnel: pulled toward the man's own orbit (it
        // widens as he climbs with the flaring funnel), swept along the spin
        // (counter-clockwise seen from above), buoyed toward his own height,
        // then flung out along the spin
        let dx = u.x - s.x, dz = u.z - s.z, d = Math.hypot(dx, dz);
        if (d < 0.05) { dx = 1; dz = 0; d = 1; } else { dx /= d; dz /= d; }
        const tx = -dz, tz = dx;
        const hf = Math.min(1, (u.airY || 0) / 11);
        const orbit = s.radius * 0.85 * (1 + 0.39 * Math.pow(hf, 1.7)) * a.orb;
        const vt = 4.2 + 1.8 * (a.orb ?? 0.55), vr = (orbit - d) * 1.8;
        a.vx += ((tx * vt + dx * vr) - a.vx) * Math.min(1, 3 * dt);
        a.vz += ((tz * vt + dz * vr) - a.vz) * Math.min(1, 3 * dt);
        const want = Math.max(-1.5, Math.min(4.6, ((a.hT ?? 4) - u.airY) * 1.4));
        a.vy += (want - a.vy) * Math.min(1, 2.2 * dt);
        u.rot = (u.rot || 0) + a.yaw * dt;
        const ca = game.time - a.t0;
        u.airRx = (a.tilt ?? 0.4) * Math.sin(ca * (a.wf ?? 3) + (a.ph ?? 0));
        u.airRz = (a.tilt ?? 0.4) * 0.8 * Math.cos(ca * (a.wf ?? 3) * 0.7 + (a.ph ?? 0));
        if (ca > a.hold || s.done) {
          a.flung = true;
          a.vx = tx * 6.5 + dx * 5; a.vz = tz * 6.5 + dz * 5; a.vy = 3.5;
          a.wx *= 1.6; a.wz *= 1.6;
        }
      } else {
        a.vy -= 18 * dt;
        u.airRx += a.wx * dt; u.airRz += a.wz * dt;
      }
      u.airY += a.vy * dt;
      const nx = u.x + a.vx * dt, nz = u.z + a.vz * dt;
      if (map.isWalkable(Math.floor(nx), Math.floor(nz))) { u.x = nx; u.z = nz; } else { a.vx = 0; a.vz = 0; }
      // motion trail (sim state, so paused captures show it): the man's
      // waist over the last ~0.4 s
      const tr = a.trail || (a.trail = []);
      tr.push(u.x, map.heightAt(u.x, u.z) + u.airY + 0.7, u.z);
      if (tr.length > 36) tr.splice(0, tr.length - 36);
      if (u.airY <= 0 && a.vy < 0) {
        u.airY = 0; u.airRx = 0; u.airRz = 0; a.done = true; a.vortex = null; a.trail = [];
        game.fx.emit({ x: u.x, y: map.heightAt(u.x, u.z) + 0.1, z: u.z, count: 6, color: 0x6b5a44, size: 0.35, life: 0.8, speed: 1.4, up: 0.8, gravity: -2, grow: 1.2 });
      }
    }
    this.airborne = this.airborne.filter((u) => !u.gp_air.done && game.entities.get(u.id));
  }

  render() {
    this.fx.render(this, this.game.time);
  }
}
