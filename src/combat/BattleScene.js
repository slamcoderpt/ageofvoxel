import { PLAYER, ENEMY } from '../core/constants.js';
import { placeNear } from '../core/scenes/helpers.js';
import { GROUND } from '../core/GameMap.js';
import { hash2 } from '../core/rng.js';
import { fieldHeroesAndMyth, engageHeroesAndMyth } from '../units/battleHost.js';

// The 'battle' harness scene (registered by src/core/scenes/index.js): two
// full Greek armies meeting on open ground, captured a few seconds into the
// clash. The armies run across the screen; blue holds the near side, red
// the far side. Between them, a field of staggered single combats in open
// order (as in Retold) with the dead lying in the turf between the fights;
// behind each, a loose line of reserves, an archer screen loosing volleys,
// a cavalry wing on the flank and a giant at each end of the line.

const S = Math.SQRT1_2;
// a: along the front (screen right is +a); d: depth (towards the camera is +d)
const P = (cx, cz, a, d) => [cx + (a + d) * S, cz + (d - a) * S];
// The two fronts have met and stopped at a visible seam: a line of single
// combats (a pair every couple of paces, the two men a long spear-thrust
// apart so from the camera each foe stands clear of the other with a strip
// of ground between them), a second rank a full pace behind its own front,
// shields up and set half a file over so every man shows between the two
// in front of him, and a loose third rank in reserve. Units never overlap.
const COL = 1.9;
const FRONT = 1.1;    // depth of each duellist from the seam (gap = 2x)
const SECOND = 3.5;   // depth of the second rank
const THIRD = 5.8;    // depth of the reserve
const HERO_RING = (a, d) => Math.abs(a) < 2.0 && Math.abs(d) < 1.4;
// the two ends of the line belong to the giants (minotaur vs cyclops)
const END = 14;
function duelSlots(rng) {
  const out = [];
  for (let a = -END + 1.7; a < END - 1.5; a += COL) {
    const aa = a + rng.range(-0.25, 0.25), dd = rng.range(-0.2, 0.2);
    if (HERO_RING(aa, dd)) continue;
    out.push([aa, dd]);
  }
  return out;
}

function place(game, type, owner, x, z, rot) {
  const w = game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 6);
  if (w && !game.map.isWalkable(Math.floor(x), Math.floor(z))) { x = w[0] + 0.5; z = w[1] + 0.5; }
  return game.units.spawn(type, owner, x, z, { rot });
}

// One army behind the front rank: a second rank shouldered up close behind
// the duellists (spears levelled over their shoulders at the enemy front),
// a ragged third rank still pushing up from behind, two knots of archers
// loosing over the melee, a cavalry wing on the flank and a minotaur at the
// left end of the line.
function army(game, owner, side, cx, cz, ranks) {
  const rng = game.rng;
  const rot = side > 0 ? -3 * Math.PI / 4 : Math.PI / 4; // face the enemy
  const units = { hoplite: [], toxotes: [], hippikon: [], minotaur: [], reserve: [], second: [] };
  const at = (type, a, d) => {
    const [x, z] = P(cx, cz, a * side, d * side);
    const u = place(game, type, owner, x, z, rot + rng.range(-0.15, 0.15));
    units[type].push(u);
    return u;
  };
  // second rank: a full pace behind the fighters, half a file over, holding
  // (shields up, spears ready; they do not step into the duels)
  for (let a = -END + 1.7 + COL / 2; a < END - 2.2; a += COL) {
    if (rng.chance(0.15)) continue;
    const aa = a + rng.range(-0.2, 0.2);
    if (Math.abs(aa) < 2.2) continue;
    const dd = SECOND + rng.range(-0.15, 0.3);
    const u = at('hoplite', aa, dd);
    u.combat_leash = 0.2;
    u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: SECOND - 0.3 };
    u.maxHp *= 3; u.hp = u.maxHp * rng.range(0.75, 1);
    units.second.push(u);
    ranks.push([aa * side, dd * side]);
  }
  // third rank: a loose reserve standing ready behind the second
  for (let i = 0; i < 9; i++) {
    const a = (i - 4) * 2.9 + rng.range(-0.4, 0.4);
    const d = THIRD + rng.range(-0.2, 0.8);
    const u = at('hoplite', a, d);
    u.combat_leash = 0.2;
    u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: THIRD - 0.5 };
    units.reserve.push(u);
    ranks.push([a * side, d * side]);
  }
  // archers in two loose knots, duelling the enemy archers over the melee
  for (let i = 0; i < 8; i++) {
    const knot = i < 4 ? -7.5 : 5.5;
    const u = at('toxotes', knot + (i % 4 - 1.5) * 1.5 + rng.range(-0.4, 0.4), 7.4 + Math.floor((i % 4) / 2) * 1.3 + rng.range(-0.4, 0.4));
    u.combat_reach = 13;
    u.combat_leash = 0.5;
    u.maxHp *= 4; u.hp = u.maxHp * rng.range(0.8, 1);
  }
  // cavalry wing on the (screen-right) flank, riding at the enemy riders
  for (let i = 0; i < 4; i++) {
    const u = at('hippikon', side * (END + 3 + (i % 2) * 2.2 + rng.range(-0.3, 0.3)), 1.4 + Math.floor(i / 2) * 2.2 + rng.range(-0.3, 0.3));
    u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: 0.6 + rng.range(0, 0.4) };
    u.combat_leash = 4;
  }
  at('minotaur', -END, 1.2).combat_leash = 2;
  // the rear ranks take the enemy archers' volleys for the whole
  // fast-forward: scene-only hardiness so they still stand
  for (const u of units.reserve) { u.maxHp *= 3; u.hp = u.maxHp * rng.range(0.7, 1); }
  for (const list of [units.hoplite, units.minotaur, units.toxotes]) for (const u of list) u.attackCd = rng.range(0, u.def.attack.cooldown);
  for (const u of units.minotaur) u.hp = u.maxHp * rng.range(0.6, 0.9);
  return units;
}

// Single combats on the duel field: a man from each army squares up to his
// opposite number on a diagonal (from the camera they stand side by side with
// daylight between them), blows out of step. Returns the pair centres.
function duels(game, cx, cz, slots) {
  const rng = game.rng;
  let k = 0;
  const pairs = [];
  for (const [a, o] of slots) {
    const pair = [];
    const skew = (k++ % 2 ? 1 : -1) * 0.22;
    // a few pairs are a spearman against a rider cut off from the flank
    for (const side of [1, -1]) {
      const owner = side > 0 ? PLAYER : ENEMY;
      const lat = a + side * skew + rng.range(-0.1, 0.1);
      const [x, z] = P(cx, cz, lat, o + side * FRONT);
      const u = place(game, 'hoplite', owner, x, z, side > 0 ? -3 * Math.PI / 4 : Math.PI / 4);
      // champions: still on their feet, trading blows, when the frame is
      // taken (scene-only hardiness), visibly hurt
      // (a few badly hurt, the rest fresh: only the hurt show health bars)
      u.maxHp *= 4;
      u.hp = u.maxHp * (rng.chance(0.15) ? rng.range(0.3, 0.45) : rng.range(0.65, 1.0));
      u.combat_leash = 2.2;
      // spear's length: they fight across the seam without closing into
      // one another, and never step past their own side of it
      u.combat_reach = 0.85;
      u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0: side * o + FRONT - 0.08 };
      u.attackCd = rng.range(0, u.def.attack.cooldown);
      pair.push(u);
    }
    game.commands.order(pair[0], { type: 'attack', targetId: pair[1].id, auto: true });
    game.commands.order(pair[1], { type: 'attack', targetId: pair[0].id, auto: true });
    pairs.push([a, o]);
  }
  return pairs;
}

// The dead of the first clash: men of both armies lying in the open turf
// between the duels, each on his own patch of ground (never under a pair
// still fighting), with dropped shields and helmets nearby.
function fallen(game, cx, cz, taken) {
  const rng = game.rng, fx = game.combat.fx;
  const clear = (a, d, r) => taken.every(([ta, td]) => Math.hypot(ta - a, (td - d) * 1.3) > r);
  const body = (type, owner, a, d) => {
    taken.push([a, d]);
    const [x, z] = P(cx, cz, a, d);
    const u = place(game, type, owner, x, z, rng.range(0, Math.PI * 2));
    game.combat.kill(u);
    u.anim.dieT = 2;
    return u;
  };
  let n = 0;
  for (let k = 0; k < 600 && n < 10; k++) {
    // the dead lie just behind the duel line, on their own side of it,
    // between the duellists and the second rank
    const a = rng.range(-END + 1, END - 1), d = (rng.chance(0.5) ? 1 : -1) * rng.range(2.0, 2.7);
    if (HERO_RING(a, d) || !clear(a, d, 1.15)) continue;
    const owner = d > 0 ? PLAYER : ENEMY;
    body(rng.chance(0.12) ? 'toxotes' : 'hoplite', owner, a, d);
    n++;
  }
  // a rider cut down where the cavalry wings met
  body('hippikon', ENEMY, END + 5, 3.4);
  body('hippikon', PLAYER, END + 2.5, -0.8);
  // loose gear in the trampled ground behind both fronts: shields, helmets,
  // spears and broken shafts dropped as the ranks pushed over them
  for (let i = 0, got = 0; i < 120 && got < 12; i++) {
    const a = rng.range(-END + 1, END - 1), d = (rng.chance(0.5) ? 1 : -1) * rng.range(1.6, 4.2);
    if (!clear(a, d, 0.75)) continue;
    got++;
    const [x, z] = P(cx, cz, a, d);
    const owner = d > 0 ? PLAYER : ENEMY;
    const k = rng.next();
    if (k < 0.4) fx.debris.drop('shield', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(-0.1, 0.3), roll: rng.range(-0.1, 0.1), life: 60 });
    else if (k < 0.6) fx.debris.drop('helmet', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(-0.5, 0.5), roll: rng.range(1.2, 1.7), lift: 0.12, life: 60 });
    else fx.debris.drop(k < 0.85 ? 'spear' : 'stub', x, z, { rot: rng.range(0, 6.28), owner, tilt: rng.range(-0.05, 0.05), life: 60 });
  }
}

// Trampled ground: bare earth round every duel and body (a ring of dirt under
// each fight, blood where men fell), torn turf between them; the grass shows
// through between fights instead of one brown strip.
function churn(game, cx, cz, spots) {
  const rng = game.rng, fx = game.combat.fx;
  for (const [a, d, r0] of spots) {
    for (let i = 0; i < 5; i++) {
      const [x, z] = P(cx, cz, a + rng.range(-0.7, 0.7) * r0, d + rng.range(-0.6, 0.6) * r0);
      fx.scar(x, z, rng.range(0.6, 1.0) * r0, rng.range(0.6, 0.95), 0);
    }
  }
  for (let i = 0; i < 24; i++) {
    const [x, z] = P(cx, cz, rng.range(-END - 1, END + 1), rng.range(-3.8, 3.8));
    fx.scar(x, z, rng.range(0.35, 0.7), rng.range(0.3, 0.6), 0);
  }
}

// The fight has trampled the meadow flat: a broad band of bare, pale earth
// under the duel line (ragged at the edges, a few torn grass islands left in
// it) inside a fringe of trodden dry grass. The figures stand on a light,
// quiet ground instead of dark, busy tufts, so every silhouette separates.
function trample(game, cx, cz) {
  const map = game.map, V = map.worldSize / map.cols;
  const soft = (x, z, f, s) => {
    // cheap smooth value noise from the hash lattice
    const X = x * f, Z = z * f, x0 = Math.floor(X), z0 = Math.floor(Z), ax = X - x0, az = Z - z0;
    const sx = ax * ax * (3 - 2 * ax), sz = az * az * (3 - 2 * az);
    const h = (i, j) => hash2(i, j, s);
    return (h(x0, z0) * (1 - sx) + h(x0 + 1, z0) * sx) * (1 - sz) + (h(x0, z0 + 1) * (1 - sx) + h(x0 + 1, z0 + 1) * sx) * sz;
  };
  const R = END + 8;
  const c0x = Math.floor((cx - R) / V), c1x = Math.ceil((cx + R) / V), c0z = Math.floor((cz - R) / V), c1z = Math.ceil((cz + R) / V);
  for (let j = c0z; j <= c1z; j++) for (let i = c0x; i <= c1x; i++) {
    if (!map.inCols(i, j)) continue;
    const k = map.cIdx(i, j), g = map.ground[k];
    if (g !== GROUND.GRASS && g !== GROUND.DRYGRASS && g !== GROUND.DIRT) continue;
    const x = (i + 0.5) * V - cx, z = (j + 0.5) * V - cz;
    const a = (x - z) * S, d = (x + z) * S;
    const n = soft(i, j, 0.18, 611) - 0.5, n2 = soft(i, j, 0.5, 612) - 0.5;
    // the band narrows past the giants at the two ends of the line
    const ea = Math.max(0, Math.abs(a) - (END + 1.5));
    const w = 3.4 + n * 2.4 + n2 * 0.8 - ea * 0.9;
    const ad = Math.abs(d - 0.2);
    if (ad < w && !(n2 > 0.36 && ad > 1.8)) map.ground[k] = GROUND.DIRT;
    else if (ad < w + 1.6 + n2 * 1.2 && g === GROUND.GRASS) map.ground[k] = GROUND.DRYGRASS;
  }
  map.markDirty(c0x - 1, c0z - 1, c1x + 1, c1z + 1);
}

export const battleScene = {
  description: 'Two Greek armies clash on open ground.',
  preset: 'battle', seed: 11, hud: false, revealAll: true, ai: false, fastForward: 6.5,
  setup(game) {
    const cx = 64, cz = 64;
    // Scene-only grade for the battle close-up (the lighting piece's default
    // grade is tuned for towns and plazas): less toe lift and a later, softer
    // highlight shoulder, so darks stay dark, team colours and hit sparks stay
    // saturated and bright, and the melee does not read milky. Only this
    // scene's uniforms change; ?post=off is unaffected.
    const gu = game.lighting?.post?.grade?.uniforms;
    const grade = { uToeLift: 0.05, uKnee: 0.72, uShoulder: 1.3, uSaturation: 1.06, uContrast: 1.14, uChromaLimit: 0.2 };
    if (gu) for (const k in grade) if (gu[k]) gu[k].value = grade[k];
    trample(game, cx, cz);
    const ranks = [];
    const blue = army(game, PLAYER, 1, cx, cz, ranks);
    const red = army(game, ENEMY, -1, cx, cz, ranks);
    const myth = [...fieldHeroesAndMyth(game, PLAYER, 1, (a, d) => P(cx, cz, a, d), -3 * Math.PI / 4), ...fieldHeroesAndMyth(game, ENEMY, -1, (a, d) => P(cx, cz, a, d), Math.PI / 4)];
    // the two heroes meet in the open ring at the centre of the field; each
    // cyclops holds the right end of its own line opposite the enemy minotaur
    for (const u of myth) {
      const side = u.owner === PLAYER ? 1 : -1;
      const hold = (a, d, d0) => {
        const [x, z] = P(cx, cz, a * side, d * side);
        u.x = u.prevX = x; u.z = u.prevZ = z;
        u.combat_line = { cx, cz, nx: S * side, nz: S * side, d0 };
      };
      if (u.type === 'hero') { hold(0.25, 1.3, 1.0); u.combat_leash = 2.5; u.combat_reach = 0.9; }
      else if (u.type === 'cyclops') { hold(END, 1.9, 1.2); u.combat_leash = 5; }
    }
    const near = (u, list) => {
      let best = null, bd = Infinity;
      for (const o of list) { const d = Math.hypot(o.x - u.x, o.z - u.z) + game.rng.range(0, 1.5); if (d < bd) { bd = d; best = o; } }
      return best;
    };
    const charge = (own, foe) => {
      for (const u of own.hippikon) { const t = near(u, foe.hippikon); if (t) game.commands.order(u, { type: 'attack', targetId: t.id, auto: true }); }
      // archers loose over the duels at the enemy archers, each at his own man
      for (const u of own.toxotes) { const t = near(u, foe.toxotes); if (t) game.commands.order(u, { type: 'attack', targetId: t.id, auto: true }); }
    };
    // the red outpost the blue army is marching on
    const bp = (type, a, d) => { const [x, z] = P(cx, cz, a, d); return placeNear(game, type, ENEMY, x, z, { maxR: 3 }); };
    bp('barracks', -9, -17);
    bp('house', 3, -17.5);
    bp('house', 10, -16.5);
    bp('temple', 19, -17.5);
    charge(blue, red);
    charge(red, blue);
    const slots = duelSlots(game.rng);
    // keep bodies clear of the duels, the hero ring and the giants
    const taken = [...slots.flatMap(([a, d]) => [[a, d + FRONT], [a, d - FRONT]]), ...ranks, [0, 0], [-END, 0], [END, 0], [-END + 1, 1.5], [END - 1, -1.5]];
    fallen(game, cx, cz, taken);
    churn(game, cx, cz, [...slots.map(([a, d]) => [a, d, 1.1]), [0, 0.3, 1.8], [-END, 0.3, 1.8], [END, 0.3, 1.8]]);
    duels(game, cx, cz, slots);
    engageHeroesAndMyth(game, myth);
    const heroes = myth.filter((u) => u.type === 'hero');
    const cyc = myth.filter((u) => u.type === 'cyclops');
    for (const h of heroes) { h.combat_line.d0 = 1.0; h.combat_leash = 3; }
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
  // at a time, up to a second and a half, until several men along the field
  // have just been struck (sparks in the air, dust at their feet).
  after(game) {
    for (let i = 0; i < 10; i++) game.fastForward(1 / 30);
    const hot = () => {
      let n = 0;
      for (const u of game.entities.units()) if (!u.dead && game.time - (u.combat_hitT ?? -99) < 0.1 && !u.def.attack?.projectile) n++;
      return n;
    };
    for (let i = 0; i < 90 && hot() < 7; i++) game.fastForward(1 / 30);
  },
  camera: { x: 64.2, z: 63.4, distance: 42, pitch: 54 },
};
