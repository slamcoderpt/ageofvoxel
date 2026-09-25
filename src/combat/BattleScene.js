import { PLAYER, ENEMY } from '../core/constants.js';
import { placeNear } from '../core/scenes/helpers.js';
import { fieldHeroesAndMyth, engageHeroesAndMyth } from '../units/battleHost.js';

// The 'battle' harness scene (registered by src/core/scenes/index.js): two
// full Greek armies meeting on open ground, captured a few seconds into the
// clash. Battle lines run across the screen; blue holds the near side, red
// the far side. Each army: a three-rank hoplite phalanx, a minotaur pushing
// through, a toxotes screen loosing volleys from behind, and a cavalry wing
// sweeping round the flank to ride down the enemy archers.

const S = Math.SQRT1_2;
// half the gap between the two front ranks (centre to centre), in tiles
const SEAM = 1.6;
// a: along the front (screen right is +a); d: depth (towards the camera is +d)
const P = (cx, cz, a, d) => [cx + (a + d) * S, cz + (d - a) * S];

function place(game, type, owner, x, z, rot) {
  const w = game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 6);
  if (w && !game.map.isWalkable(Math.floor(x), Math.floor(z))) { x = w[0] + 0.5; z = w[1] + 0.5; }
  return game.units.spawn(type, owner, x, z, { rot });
}

// Lateral coordinate along the battle front (see P).
const lat = (u, cx, cz) => ((u.x - cx) - (u.z - cz)) * S;

function army(game, owner, side, cx, cz) {
  const rng = game.rng;
  const rot = side > 0 ? -3 * Math.PI / 4 : Math.PI / 4; // face the enemy
  const J = () => rng.range(-0.12, 0.12);
  const units = { hoplite: [], toxotes: [], hippikon: [], minotaur: [], front: [], rear: [] };
  const at = (type, a, d) => {
    const [x, z] = P(cx, cz, a * side, d * side);
    const u = place(game, type, owner, x, z, rot + rng.range(-0.1, 0.1));
    units[type].push(u);
    return u;
  };
  // phalanx: three ranks in step. The front ranks start a couple of paces
  // apart and close to spear reach; the fronts then hold, leaving a clear seam
  // between red and blue where the blows land.
  // The front two ranks are ragged: men step up, give ground, turn to the
  // man beside them, and a few slots are already empty (see fallen()).
  // Open order, as in Retold: a body-width of ground between men so every
  // figure reads on its own, and a seam of open turf between the fronts.
  const W = 13, GAP = 1.5;
  units.gaps = [];
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < W - r * 2; i++) {
      const a = (i - (W - r * 2 - 1) / 2) * GAP + J() + (r % 2) * 0.55;
      // an open ring at the centre of the line where the two heroes duel:
      // the one place in the frame the eye goes first
      if (Math.abs(a) < [2.6, 1.9, 1.0][r]) continue;
      if (r < 2 && rng.chance(r === 0 ? 0.08 : 0.05)) { units.gaps.push([a, 1.3 + r * 1.45]); continue; }
      const loose = r === 0 ? 1 : r === 1 ? 0.5 : 0;
      const d = 1.3 + r * 1.45 + loose * (rng.chance(0.2) ? rng.range(0.3, 0.6) : rng.range(-0.15, 0.2)) + J() * 0.4;
      const u = at('hoplite', a + loose * rng.range(-0.25, 0.25), Math.max(SEAM + 0.05, d + 0.15));
      u.combat_leash = r === 0 ? 3.4 : 1.6;
      u.combat_reach = 1.55;
      // nobody crosses the seam: the fronts stay a pace and a half apart
      u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: SEAM + r * 1.1 };
      (r === 0 ? units.front : units.rear).push(u);
    }
  // archer screen: two loose ranks well behind the phalanx
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 8; i++) at('toxotes', (i - 3.5) * 1.8 + J() + r * 0.9 - 1.0, 9.0 + r * 1.5 + J());
  // both cavalry wings on the same (screen-right) flank, riding at each
  // other past the end of the infantry line: a second clash that never
  // crosses the phalanx seam
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 3 - r; i++) {
      const u = at('hippikon', side * (14.5 + i * 2.1 + r * 1.0 + J()), 2.2 + r * 2.2 + J());
      u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: SEAM - 0.3 + rng.range(0, 0.9) };
      u.combat_leash = 4;
    }
  // a minotaur anchoring the left end of the line
  at('minotaur', -10.8, 1.3).combat_leash = 2;
  // the front rank arrives bloodied; the ranks behind are still fresh
  for (const u of units.front) u.hp = u.maxHp * rng.range(0.6, 0.97);
  // blows fall out of step, not in one synchronised wave
  for (const list of [units.hoplite, units.minotaur, units.toxotes]) for (const u of list) u.attackCd = rng.range(0, u.def.attack.cooldown);
  for (const u of units.rear) if (rng.chance(0.3)) u.hp = u.maxHp * rng.range(0.6, 0.95);
  for (const u of units.minotaur) u.hp = u.maxHp * rng.range(0.6, 0.9);
  return units;
}

// The dead of the first clash: bodies in the strip between the fronts and in
// the empty slots of the ranks, with their shields and spears dropped round
// them, plus spears snapped off or stuck in the turf.
function fallen(game, units, owner, side, cx, cz) {
  const rng = game.rng, fx = game.combat.fx;
  const body = (type, a, d) => {
    const [x, z] = P(cx, cz, a * side, d * side);
    const u = place(game, type, owner, x, z, rng.range(0, Math.PI * 2));
    game.combat.kill(u);
    u.anim.dieT = 2;
    return u;
  };
  // the dead of the first clash lie in heaps where the fighting was hottest,
  // two or three men across one another in the strip between the fronts
  for (let h = 0; h < 3; h++) {
    const ha = (rng.chance(0.5) ? 1 : -1) * rng.range(3, 9.5), hd = rng.range(0.25, 0.9);
    const n = 2;
    for (let i = 0; i < n; i++) body('hoplite', ha + rng.range(-0.45, 0.45), hd + rng.range(-0.3, 0.3));
    const [x, z] = P(cx, cz, ha * side, hd * side);
    fx.scar(x, z, 1.1, 0.6, 0.8);
  }
  for (let i = 0; i < 2; i++) body('hoplite', (rng.chance(0.5) ? 1 : -1) * rng.range(3, 9.5), rng.range(0.2, 0.9));
  for (const [a, d] of units.gaps) body('hoplite', a + rng.range(-0.2, 0.2), d + rng.range(-0.2, 0.3));
  // riders and archers cut down where the cavalry wing hit the archer screen
  for (let i = 0; i < 1; i++) body('hippikon', side * rng.range(16, 18), rng.range(3, 5));
  // loose gear in the strip between the lines
  for (let i = 0; i < 6; i++) {
    const [x, z] = P(cx, cz, (rng.chance(0.5) ? 1 : -1) * rng.range(2.6, 10) * side, rng.range(-0.2, 0.9) * side);
    const k = rng.next();
    if (k < 0.35) fx.debris.drop('shield', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(-0.1, 0.3), roll: rng.range(-0.1, 0.1), life: 60 });
    else if (k < 0.6) fx.debris.drop('stub', x, z, { rot: rng.range(0, 6.28), owner, life: 60 });
    else if (k < 0.8) fx.debris.drop('spear', x, z, { rot: rng.range(0, 6.28), owner, life: 60 });
    else fx.debris.drop('spear', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(0.9, 1.2), lift: 0.45, life: 60 });
  }
}

// Trampled ground: the turf between and under the fronts is churned to dark
// earth, heaviest along the seam, ragged at the edges, blood where men fell.
function churn(game, cx, cz) {
  const rng = game.rng, fx = game.combat.fx;
  for (let a = -10; a <= 10; a += 0.5) {
    for (const d of [-0.7, 0.7]) {
      if (rng.chance(0.3)) continue;
      const [x, z] = P(cx, cz, a + rng.range(-0.25, 0.25), d + rng.range(-0.5, 0.5));
      fx.scar(x, z, rng.range(0.7, 1.3), d === 0 ? rng.range(0.7, 1.0) : rng.range(0.35, 0.7), rng.chance(0.15) ? rng.range(0.3, 0.7) : 0);
    }
  }
  for (let i = 0; i < 25; i++) {
    const [x, z] = P(cx, cz, rng.range(-11, 11), (rng.chance(0.5) ? 1 : -1) * rng.range(1, 4.2));
    fx.scar(x, z, rng.range(0.4, 1.0), rng.range(0.2, 0.5), 0);
  }
}

export const battleScene = {
  description: 'Two Greek armies clash on open ground.',
  preset: 'battle', seed: 11, hud: false, revealAll: true, ai: false, fastForward: 6.5,
  setup(game) {
    const cx = 64, cz = 64;
    const blue = army(game, PLAYER, 1, cx, cz);
    const red = army(game, ENEMY, -1, cx, cz);
    const myth = [...fieldHeroesAndMyth(game, PLAYER, 1, (a, d) => P(cx, cz, a, d), -3 * Math.PI / 4), ...fieldHeroesAndMyth(game, ENEMY, -1, (a, d) => P(cx, cz, a, d), Math.PI / 4)];
    // Composition: the two heroes meet in the open ring at the centre of the
    // line (the focal point of the frame); each cyclops holds the right end of
    // its own line opposite the enemy minotaur instead of wading into the
    // enemy ranks, so no giant stands in the wrong army's colour.
    for (const u of myth) {
      const side = u.owner === PLAYER ? 1 : -1;
      const hold = (a, d, d0) => {
        const [x, z] = P(cx, cz, a * side, d * side);
        u.x = u.prevX = x; u.z = u.prevZ = z;
        u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0 };
      };
      if (u.type === 'hero') { hold(0.25, 1.3, 1.0); u.combat_leash = 2.5; u.combat_reach = 0.9; }
      else if (u.type === 'cyclops') { hold(10.8, 1.9, SEAM + 0.2); u.combat_leash = 3; }
    }
    const charge = (own, foe) => {
      // each rider squares up to an enemy rider across the flank
      own.hippikon.forEach((u, i) => game.commands.order(u, { type: 'attack', targetId: foe.hippikon[i % foe.hippikon.length].id, auto: true }));
      // each front-ranker squares up to the man opposite; ranks behind hold
      const foeFront = foe.front.map((f) => [lat(f, cx, cz), f]);
      for (const u of own.front) {
        const l = lat(u, cx, cz);
        let best = null, bd = Infinity;
        for (const [fl, f] of foeFront) if (Math.abs(fl - l) < bd) { bd = Math.abs(fl - l); best = f; }
        if (best) game.commands.order(u, { type: 'attack', targetId: best.id, auto: true });
      }
      for (const u of own.minotaur) {
        const t = game.combat.findEnemyNear(u, 8, (o) => o.def.myth);
        if (t) game.commands.order(u, { type: 'attack', targetId: t.id, auto: true });
      }
    };
    // the red outpost the blue army is marching on
    const bp = (type, a, d) => { const [x, z] = P(cx, cz, a, d); return placeNear(game, type, ENEMY, x, z, { maxR: 3 }); };
    bp('barracks', -9, -17);
    bp('house', 3, -17.5);
    bp('house', 10, -16.5);
    bp('temple', 19, -17.5);
    charge(blue, red);
    charge(red, blue);
    fallen(game, blue, PLAYER, 1, cx, cz);
    fallen(game, red, ENEMY, -1, cx, cz);
    churn(game, cx, cz);
    engageHeroesAndMyth(game, myth);
    return { focus: { x: cx, z: cz } };
  },
  camera: { x: 64.2, z: 63.4, distance: 41, pitch: 54 },
};
