import { Projectiles } from './Projectiles.js';
import { Overlays } from './Overlays.js';
import { EnemyAI } from './EnemyAI.js';
import { BattleFX } from './BattleFX.js';
import { ENEMY } from '../core/constants.js';

// Combat piece: 'attack' orders, auto-targeting, melee & ranged damage,
// projectiles, death, hit feedback, health bars, selection rings, enemy AI.
// Public API:
//   combat.damage(target, amount, attacker)
//   combat.kill(entity, killer)
//   combat.findEnemyNear(entity, radius)
//   combat.fx   (BattleFX: ground scars, dust, hit sparks)
export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = new Projectiles(game, this);
    this.overlays = new Overlays(game);
    this.fx = new BattleFX(game);
    this.attackers = new Map(); // targetId -> number of units attacking it (refreshed every scan)
    this.ai = new EnemyAI(game, ENEMY);
    this.scanTimer = 0;
    game.commands.register('attack', {
      start: (u, o) => {
        const t = game.entities.get(o.targetId);
        if (!t || t.dead || !u.def.attack || !game.isEnemy(u.owner, t.owner)) return false;
        o.repath = 0;
        this.approach(u, t);
        return true;
      },
    });
  }

  rangeOf(u) { return u.def.attack?.range ?? 0.5; }

  approach(u, t) {
    const range = this.rangeOf(u);
    if (t.kind === 'building') this.game.movement.moveTo(u, t.x, t.z, { goalRect: t, range });
    else this.game.movement.moveTo(u, t.x, t.z, { range: range + u.radius + t.radius * 0.8 });
  }

  findEnemyNear(e, radius, pred) {
    let best = null, bd = radius * radius;
    const game = this.game;
    game.movement.hash.forEachNear(e.x, e.z, radius, (o) => {
      if (o.dead || !game.isEnemy(e.owner, o.owner)) return;
      if (pred && !pred(o)) return;
      const d = (o.x - e.x) ** 2 + (o.z - e.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }

  // Target choice that spreads attackers across the enemy line instead of
  // piling onto the nearest unit: distance, plus a crowding penalty, minus a
  // preference for classes this unit has a bonus against (cavalry hunt archers).
  pickTarget(u, radius) {
    const game = this.game;
    const melee = !u.def.attack?.projectile;
    const bonus = u.def.bonus;
    let best = null, bs = Infinity;
    game.movement.hash.forEachNear(u.x, u.z, radius, (o) => {
      if (o.dead || !game.isEnemy(u.owner, o.owner)) return;
      const d = Math.hypot(o.x - u.x, o.z - u.z);
      if (d > radius) return;
      const n = this.attackers.get(o.id) || 0;
      const cap = o.def.myth ? 4 : o.def.class === 'cavalry' ? 3 : 2;
      let s = d + (melee ? 1.8 * Math.max(0, n + 1 - cap) + 0.35 * n : 0.25 * n);
      if (bonus && bonus[o.def.class]) s -= melee ? 2.5 : 1.0;
      if (o.def.gatherer) s += 3;
      if (s < bs) { bs = s; best = o; }
    });
    if (best) this.attackers.set(best.id, (this.attackers.get(best.id) || 0) + 1);
    return best;
  }

  findEnemyBuildingNear(e, radius) {
    let best = null, bd = radius * radius;
    for (const b of this.game.entities.buildings()) {
      if (!this.game.isEnemy(e.owner, b.owner)) continue;
      const d = (b.x - e.x) ** 2 + (b.z - e.z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  damage(target, amount, attacker, kind) {
    if (!target || target.dead || target.removed) return;
    const game = this.game;
    let dmg = amount;
    const bonus = attacker?.def?.bonus;
    if (bonus && target.def?.class && bonus[target.def.class]) dmg *= bonus[target.def.class];
    if (target.kind === 'building') dmg *= attacker?.def?.class === 'myth' ? 1.2 : 0.35;
    dmg *= 1 - (target.def?.armor ?? 0);
    target.hp -= dmg;
    target.flashT = 0.18;
    target.combat_hitT = game.time;
    this.fx.hit(target, attacker, kind || (attacker?.kind === 'unit' && attacker.def?.attack && !attacker.def.attack.projectile ? 'melee' : 'arrow'));
    game.events.emit('unit:damaged', { target, attacker, amount: dmg });
    // retaliate
    if (target.kind === 'unit' && attacker && attacker.id && !attacker.dead && target.def.attack) {
      const ot = target.order?.type;
      if (ot === 'idle' || (ot === 'move' && target.owner === ENEMY)) game.commands.order(target, { type: 'attack', targetId: attacker.id, auto: true });
      else if (target.def.gatherer && ot !== 'attack' && target.owner === ENEMY && game.rng.chance(0.3)) game.commands.order(target, { type: 'attack', targetId: attacker.id, auto: true });
    }
    if (target.hp <= 0) this.kill(target, attacker);
  }

  kill(e, killer) {
    const game = this.game;
    if (e.dead) return;
    e.hp = 0;
    if (e.kind === 'unit') {
      e.dead = true;
      e.order = { type: 'idle' };
      game.movement.stop(e);
      e.anim.dieT = 0;
      e.carry = { type: null, amount: 0 };
      this.fx.death(e);
    } else if (e.kind === 'building') {
      e.dead = true;
      game.buildings.destroy(e);
    }
    game.events.emit('entity:died', e, killer);
  }

  update(dt) {
    const game = this.game;
    this.scanTimer -= dt;
    const scan = this.scanTimer <= 0;
    if (scan) {
      this.scanTimer = 0.5;
      this.attackers.clear();
      for (const u of game.entities.units())
        if (!u.dead && u.order?.type === 'attack') this.attackers.set(u.order.targetId, (this.attackers.get(u.order.targetId) || 0) + 1);
    }
    for (const u of game.entities.units()) {
      if (u.dead || !u.def.attack) continue;
      u.attackCd = Math.max(0, u.attackCd - dt);
      const ot = u.order?.type;
      // auto-acquire for idle soldiers
      if (ot === 'idle' && scan && !u.def.gatherer) {
        const e = this.pickTarget(u, u.sight);
        if (e) game.commands.order(u, { type: 'attack', targetId: e.id, auto: true });
        continue;
      }
      if (ot !== 'attack') continue;
      let t = game.entities.get(u.order.targetId);
      // soldiers attacking a building switch to nearby enemy units
      if (scan && t && t.kind === 'building' && !u.def.gatherer) {
        const e = this.findEnemyNear(u, 6);
        if (e) { u.order.targetId = e.id; t = e; }
      }
      if (!t || t.dead || t.removed) {
        const e = !u.def.gatherer ? this.pickTarget(u, u.sight) : null;
        if (e) { u.order.targetId = e.id; this.approach(u, e); }
        else if (u.order.thenBuildings) {
          const b = this.findEnemyBuildingNear(u, 200);
          if (b) { u.order.targetId = b.id; this.approach(u, b); } else game.commands.idle(u);
        } else game.commands.idle(u);
        continue;
      }
      const range = this.rangeOf(u);
      const dist = game.movement.distanceTo(u, t) - u.radius;
      if (dist > range + 0.25) {
        u.order.repath = (u.order.repath || 0) - dt;
        if (!u.moving || u.order.repath <= 0) { this.approach(u, t); u.order.repath = 0.6; }
        if (scan && u.def.class === 'cavalry' && u.moving) this.fx.scuff(u, true);
        continue;
      }
      if (u.moving) game.movement.stop(u);
      u.rot = Math.atan2(t.x - u.x, t.z - u.z);
      u.anim.want = 'attack';
      if (scan && !u.def.attack.projectile) this.fx.scuff(u, false);
      if (u.attackCd <= 0) {
        const a = u.def.attack;
        u.attackCd = a.cooldown;
        u.anim.attackT = 0;
        if (a.projectile) this.projectiles.fire(u, t, a.damage, { fromY: 1.3 });
        else {
          this.damage(t, a.damage, u);
          if (a.splash) {
            game.movement.hash.forEachNear(t.x, t.z, a.splash, (o) => {
              if (o !== t && !o.dead && game.isEnemy(u.owner, o.owner) && Math.hypot(o.x - t.x, o.z - t.z) < a.splash) this.damage(o, a.damage * 0.5, u);
            });
            this.fx.slam(t.x, t.z, a.splash);
          }
        }
      }
    }
    // buildings that shoot (Town Center)
    for (const b of game.entities.buildings()) {
      const a = b.def.attack;
      if (!a || !b.built) continue;
      b.attackCd = Math.max(0, (b.attackCd || 0) - dt);
      if (b.attackCd > 0) continue;
      const e = this.findEnemyNear(b, a.range + b.w / 2);
      if (e) { b.attackCd = a.cooldown; this.projectiles.fire(b, e, a.damage, { fromY: 4 }); }
    }
    this.projectiles.update(dt);
    this.fx.update(dt);
    this.ai.update(dt);
  }

  render(dt, alpha) {
    this.projectiles.render();
    this.fx.render();
    this.overlays.render(alpha);
  }

  resize(w, h) { this.fx.resize(w, h); }
}
