import { PLAYER, ENEMY } from '../core/constants.js';
import { placeNear } from '../core/scenes/helpers.js';

// The 'battle' harness scene (registered by src/core/scenes/index.js): two
// full Greek armies meeting on open ground, captured a few seconds into the
// clash. Battle lines run across the screen; blue holds the near side, red
// the far side. Each army: a three-rank hoplite phalanx, a minotaur pushing
// through, a toxotes screen loosing volleys from behind, and a cavalry wing
// sweeping round the flank to ride down the enemy archers.

const S = Math.SQRT1_2;
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
  const W = 22;
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < W; i++) {
      const u = at('hoplite', (i - (W - 1) / 2) * 1.12 + J() + (r % 2) * 0.3, 1.3 + r * 1.2 + J() * 0.4);
      u.combat_leash = r === 0 ? 2.9 : 1.6;
      u.combat_reach = 1.05;
      (r === 0 ? units.front : units.rear).push(u);
    }
  // archer screen: two loose ranks well behind the phalanx
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 15; i++) at('toxotes', (i - 7) * 1.25 + J() + r * 0.6 - 1.5, 9.4 + r * 1.2 + J());
  // cavalry wing on this army's right flank, already wheeling in
  for (let r = 0; r < 3; r++)
    for (let i = 0; i < 4; i++) at('hippikon', 14.5 + i * 1.5 + J(), 5.0 + r * 1.6 + J());
  // a minotaur anchoring each end of the line; they meet the enemy's
  for (const a of [-13.4, 13.4]) at('minotaur', a, 1.3).combat_leash = 3;
  // the front rank arrives bloodied; the ranks behind are still fresh
  for (const u of units.front) u.hp = u.maxHp * rng.range(0.6, 0.97);
  // blows fall out of step, not in one synchronised wave
  for (const list of [units.hoplite, units.minotaur, units.toxotes]) for (const u of list) u.attackCd = rng.range(0, u.def.attack.cooldown);
  for (const u of units.rear) if (rng.chance(0.3)) u.hp = u.maxHp * rng.range(0.6, 0.95);
  for (const u of units.minotaur) u.hp = u.maxHp * rng.range(0.6, 0.9);
  return units;
}

export const battleScene = {
  description: 'Two Greek armies clash on open ground.',
  preset: 'battle', seed: 11, hud: false, revealAll: true, ai: false, fastForward: 6.5,
  setup(game) {
    const cx = 64, cz = 64;
    const blue = army(game, PLAYER, 1, cx, cz);
    const red = army(game, ENEMY, -1, cx, cz);
    const charge = (own, foe) => {
      // each rider picks a different archer on the near end of the enemy screen
      const w = own.hippikon[0];
      const near = [...foe.toxotes].sort((p, q) => Math.hypot(p.x - w.x, p.z - w.z) - Math.hypot(q.x - w.x, q.z - w.z));
      own.hippikon.forEach((u, i) => game.commands.order(u, { type: 'attack', targetId: near[i % near.length].id }));
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
    return { focus: { x: cx, z: cz } };
  },
  camera: { x: 64.2, z: 63.0, distance: 45, pitch: 54 },
};
