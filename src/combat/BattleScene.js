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
// half the gap between the two shield walls (centre to centre), in tiles:
// the walls hold well back and leave a strip of churned no-man's-land
const SEAM = 2.7;
// Single combats fought out in the open strip, staggered along the front:
// [a along the front, depth shift of the pair towards blue (+) or red (-)].
const DUELS = [[-8.3, 0.35], [-5.8, -0.3], [-3.5, 0.15], [3.6, -0.35], [6.0, 0.3], [8.5, -0.1]];
// a: along the front (screen right is +a); d: depth (towards the camera is +d)
const P = (cx, cz, a, d) => [cx + (a + d) * S, cz + (d - a) * S];

function place(game, type, owner, x, z, rot) {
  const w = game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 6);
  if (w && !game.map.isWalkable(Math.floor(x), Math.floor(z))) { x = w[0] + 0.5; z = w[1] + 0.5; }
  return game.units.spawn(type, owner, x, z, { rot });
}


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
      // the man who stepped out of the wall to fight leaves his slot open
      if (r === 0 && DUELS.some(([da]) => Math.abs(da * side - a) < 0.75)) continue;
      if (r < 2 && rng.chance(r === 0 ? 0.08 : 0.05)) { units.gaps.push([a, 1.3 + r * 1.45]); continue; }
      const loose = r === 0 ? 1 : r === 1 ? 0.5 : 0;
      const d = SEAM + 0.1 + r * 1.45 + loose * (rng.chance(0.2) ? rng.range(0.3, 0.6) : rng.range(0, 0.25)) + J() * 0.4;
      const u = at('hoplite', a + loose * rng.range(-0.25, 0.25), Math.max(SEAM + 0.05, d));
      // the walls hold: shields up, spears levelled, watching the duels
      // (the units piece gives idle men on a line a guard stance)
      u.combat_leash = 1.2;
      u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: SEAM + r * 1.1 };
      (r === 0 ? units.front : units.rear).push(u);
    }
  // archer screen: a loose, ragged skirmish line behind the phalanx (men
  // step up to shoot, others hang back; a few slots empty), in bow range
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 8; i++) {
      if (rng.chance(0.12)) continue;
      const u = at('toxotes', (i - 3.5) * 1.8 + r * 0.9 - 1.0 + rng.range(-0.45, 0.45), 7.6 + r * 1.4 + rng.range(-0.5, 0.5));
      u.rot += rng.range(-0.25, 0.25);
    }
  // both cavalry wings on the same (screen-right) flank, riding at each
  // other past the end of the infantry line: a second clash that never
  // crosses the phalanx seam
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 3 - r; i++) {
      const u = at('hippikon', side * (14.5 + i * 2.1 + r * 1.0 + J()), 2.2 + r * 2.2 + J());
      u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: 0.55 + rng.range(0, 0.5) };
      u.combat_leash = 4;
    }
  // a minotaur anchoring the left end of the line
  at('minotaur', -10.8, 1.2).combat_leash = 2;
  // The walls must still stand when the frame is taken: the whole volley of
  // both archer screens falls on them for the full fast-forward, so the
  // scene makes them hardier (scene-only). Bars appear once a man is hurt.
  for (const u of units.hoplite) { u.maxHp *= 3; u.hp = u.maxHp; }
  for (const u of units.front) u.hp = u.maxHp * rng.range(0.9, 1);
  // blows fall out of step, not in one synchronised wave
  for (const list of [units.hoplite, units.minotaur, units.toxotes]) for (const u of list) u.attackCd = rng.range(0, u.def.attack.cooldown);
  for (const u of units.rear) if (rng.chance(0.3)) u.hp = u.maxHp * rng.range(0.6, 0.95);
  for (const u of units.minotaur) u.hp = u.maxHp * rng.range(0.6, 0.9);
  return units;
}

// The dead of the first clash, in the open strip between the walls where the
// duels are fought: men of both armies lying where they fell (rolled on their
// side, shields and spears dropped beside them), plus the bodies in the empty
// slots of the ranks and loose gear in the churned earth.
function fallen(game, units, owner, side, cx, cz) {
  const rng = game.rng, fx = game.combat.fx;
  const body = (type, a, d) => {
    const [x, z] = P(cx, cz, a * side, d * side);
    const u = place(game, type, owner, x, z, rng.range(0, Math.PI * 2));
    game.combat.kill(u);
    u.anim.dieT = 2;
    return u;
  };
  // in the strip, between the duels (never under a pair still fighting)
  const free = (a) => Math.abs(a) > 2.4 && DUELS.every(([da]) => Math.abs(da * side - a) > 1.1) && Math.abs(a) < 10.2;
  let n = 0;
  for (let k = 0; k < 40 && n < 6; k++) {
    const a = rng.range(-10, 10);
    if (!free(a)) continue;
    // mostly on the enemy's half: they fell pressing forward
    body('hoplite', a, rng.range(-1.6, 0.9));
    n++;
  }
  for (const [a, d] of units.gaps) body('hoplite', a + rng.range(-0.2, 0.2), d + rng.range(-0.2, 0.3));
  // a rider cut down where the cavalry wings met
  body('hippikon', side * rng.range(16, 18), rng.range(3, 5));
  // loose gear in the strip between the lines
  for (let i = 0; i < 10; i++) {
    const [x, z] = P(cx, cz, (rng.chance(0.5) ? 1 : -1) * rng.range(2.4, 10.5) * side, rng.range(-1.8, 1.8) * side);
    const k = rng.next();
    if (k < 0.45) fx.debris.drop('shield', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(-0.1, 0.3), roll: rng.range(-0.1, 0.1), life: 60 });
    else if (k < 0.65) fx.debris.drop('stub', x, z, { rot: rng.range(0, 6.28), owner, life: 60 });
    else if (k < 0.8) fx.debris.drop('helmet', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(-0.5, 0.5), roll: rng.range(1.2, 1.7), lift: 0.12, life: 60 });
    else fx.debris.drop('spear', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(0.9, 1.2), lift: 0.45, life: 60 });
  }
}

// Single combats in the open strip: one man from each wall squares up to the
// man opposite, staggered forward and back along the front, blows falling out
// of step, so every pair reads as its own fight (lunge, block, reel).
function duels(game, cx, cz) {
  const rng = game.rng;
  for (const [a, o] of DUELS) {
    const pair = [];
    for (const side of [1, -1]) {
      const owner = side > 0 ? PLAYER : ENEMY;
      const lat = a + rng.range(-0.15, 0.15);
      const [x, z] = P(cx, cz, lat, o + side * 0.72);
      const u = place(game, 'hoplite', owner, x, z, side > 0 ? -3 * Math.PI / 4 : Math.PI / 4);
      // champions: they must still be on their feet, trading blows, when the
      // frame is taken (a scene-only hardiness, shown as a part-full bar)
      u.maxHp *= 4;
      u.hp = u.maxHp * rng.range(0.4, 0.8);
      u.combat_leash = 1.4;
      u.combat_reach = 0.3;
      // each man holds his own half of the pair's ground
      u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: side * o + 0.5 };
      u.attackCd = rng.range(0, u.def.attack.cooldown);
      pair.push(u);
    }
    game.commands.order(pair[0], { type: 'attack', targetId: pair[1].id, auto: true });
    game.commands.order(pair[1], { type: 'attack', targetId: pair[0].id, auto: true });
  }
}

// No-man's-land: the turf between the two walls is trampled to bare, dark
// earth, heaviest in the middle, ragged at the edges, blood where men fell;
// lighter scuffing under the ranks.
function churn(game, cx, cz) {
  const rng = game.rng, fx = game.combat.fx;
  for (let a = -11; a <= 11; a += 0.45) {
    for (let d = -SEAM + 0.2; d <= SEAM - 0.2; d += 0.55) {
      const edge = Math.abs(d) / SEAM; // 0 mid-strip .. 1 at the walls
      const end = Math.max(0, (Math.abs(a) - 9) / 2); // ragged ends
      if (rng.chance(0.08 + edge * 0.35 + end * 0.6)) continue;
      const [x, z] = P(cx, cz, a + rng.range(-0.25, 0.25), d + rng.range(-0.3, 0.3));
      fx.scar(x, z, rng.range(0.6, 1.0), rng.range(0.75, 1.0) * (1 - 0.35 * edge), rng.chance(0.07) ? rng.range(0.3, 0.6) : 0);
    }
  }
  for (let i = 0; i < 25; i++) {
    const [x, z] = P(cx, cz, rng.range(-11, 11), (rng.chance(0.5) ? 1 : -1) * rng.range(SEAM, SEAM + 3.5));
    fx.scar(x, z, rng.range(0.4, 0.9), rng.range(0.2, 0.45), 0);
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
      else if (u.type === 'cyclops') { hold(10.8, 1.9, 1.2); u.combat_leash = 5; }
    }
    const charge = (own, foe) => {
      // each rider squares up to an enemy rider across the flank

      // the walls hold; the fighting in the strip is done by the duellists.
      // The archers shoot over the duels into the enemy wall, each at his
      // own man, so the volleys spread instead of converging on one body.
      const near = (u, list) => {
        let best = null, bd = Infinity;
        for (const o of list) { const d = Math.hypot(o.x - u.x, o.z - u.z) + game.rng.range(0, 1.5); if (d < bd) { bd = d; best = o; } }
        return best;
      };
      for (const u of own.hippikon) { const t = near(u, foe.hippikon); if (t) game.commands.order(u, { type: 'attack', targetId: t.id, auto: true }); }
      for (const u of own.toxotes) { const t = near(u, foe.hoplite); if (t) game.commands.order(u, { type: 'attack', targetId: t.id, auto: true }); }
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
    duels(game, cx, cz);
    engageHeroesAndMyth(game, myth);
    // the big fights, set explicitly: hero against hero at the centre, and at
    // each end of the line the minotaur against the cyclops opposite it
    const heroes = myth.filter((u) => u.type === 'hero');
    const cyc = myth.filter((u) => u.type === 'cyclops');
    for (const h of heroes) { h.combat_line.d0 = 0.75; h.combat_leash = 3; }
    if (heroes.length === 2) {
      game.commands.order(heroes[0], { type: 'attack', targetId: heroes[1].id, auto: true });
      game.commands.order(heroes[1], { type: 'attack', targetId: heroes[0].id, auto: true });
    }
    for (const m of [...blue.minotaur, ...red.minotaur]) {
      const c = cyc.find((o) => o.owner !== m.owner);
      if (c) { game.commands.order(m, { type: 'attack', targetId: c.id, auto: true }); game.commands.order(c, { type: 'attack', targetId: m.id, auto: true }); m.combat_leash = 5; }
    }
    return { focus: { x: cx, z: cz } };
  },
  // Capture on a beat, not between blows: step the (deterministic) sim a tick
  // at a time, up to a second and a half, until several duellists are
  // mid-hit (white flash, chips and sparks in the air).
  after(game) {
    const hot = () => {
      let n = 0;
      for (const u of game.entities.units()) if (!u.dead && u.flashT > 0.1 && u.def.class === 'infantry') n++;
      return n;
    };
    for (let i = 0; i < 45 && hot() < 3; i++) game.fastForward(1 / 30);
  },
  camera: { x: 64.2, z: 63.4, distance: 41, pitch: 54 },
};
