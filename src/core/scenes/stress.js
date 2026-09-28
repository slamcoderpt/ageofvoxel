import { PLAYER } from '../constants.js';
import { stressFronts } from '../GameMap.js';
import { buildTown } from './helpers.js';

// Stress-test scene: 6 players (?players=2..6) on a 256-tile map
// (?mapsize=N), each with a town (Town Center, houses, storehouses, farms,
// temple, academy), villagers gathering, and an army split over the two fronts
// it shares with its ring neighbours: hoplites in front, cavalry and myth
// units behind, archers at the back, every soldier ordered onto a man of the
// opposing block, so all six fronts fight at once. Every player runs an
// EnemyAI (villagers, houses, training; idle soldiers are sent at the nearest
// enemy building). ?units=N is the total across players (default 2000),
// 30% villagers (at least 5 each), 70% soldiers. Fog of war is on for
// player 1 (the local player), as in a real match; ?fog=0 reveals all.
// The profiler is on (game.prof); scripts/stress.mjs steps it and records
// per-system ms per tick.
const MYTH = ['minotaur', 'centaur', 'cyclops', 'medusa'];

function armyTypes(n) {
  const nMyth = n >= 8 ? Math.max(1, Math.round(n * 0.1)) : 0;
  const nCav = Math.round(n * 0.2), nArch = Math.round(n * 0.25);
  const nHop = Math.max(0, n - nMyth - nCav - nArch);
  const out = [];
  for (let i = 0; i < nHop; i++) out.push('hoplite');
  for (let i = 0; i < nCav; i++) out.push('hippikon');
  for (let i = 0; i < nMyth; i++) out.push(MYTH[i % MYTH.length]);
  for (let i = 0; i < nArch; i++) out.push('toxotes');
  return out; // front rank first
}

// One army block facing the enemy across a front: its front rank `gap` tiles
// from the front's centre, on the side of its own town.
function spawnArmyBlock(game, owner, types, front, towards, gap = 4) {
  const [dx, dz] = towards; // unit vector from this block to the enemy
  const sx = -dz, sz = dx;  // along the line
  const n = types.length;
  const cols = Math.min(n, Math.max(6, Math.ceil(Math.sqrt(n * 3))));
  const sp = 1.2;
  const rot = Math.atan2(dx, dz);
  const out = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const lateral = (col - (cols - 1) / 2) * sp + game.rng.range(-0.15, 0.15);
    const back = gap + row * sp + game.rng.range(-0.15, 0.15);
    let x = front.tx + 0.5 + sx * lateral - dx * back, z = front.tz + 0.5 + sz * lateral - dz * back;
    if (!game.map.isWalkable(Math.floor(x), Math.floor(z))) {
      const w = game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 8);
      if (w) { x = w[0] + 0.5; z = w[1] + 0.5; }
    }
    out.push(game.units.spawn(types[i], owner, x, z, { rot }));
  }
  return out;
}

export const stressScene = {
  description: 'Scalability stress test: 6 players, towns, economies and armies all fighting (?units=N).',
  preset: 'stress', seed: 23, mapSize: 256, players: 6,
  hud: true, revealAll: false, ai: true, live: true, victory: false, prof: true, fastForward: 0,
  setup(game) {
    const params = new URLSearchParams(location.search);
    const total = Math.max(12, Math.round(+(params.get('units') ?? 2000)) || 2000);
    const starts = game.starts;
    const P = starts.length;
    for (const s of starts) {
      const p = game.addPlayer(s.owner, { name: s.owner === PLAYER ? 'You' : `AI ${s.owner}`, isAI: true });
      p.isAI = true; // every seat is driven by an EnemyAI here, the local player too
      Object.assign(p.res, { food: 3000, wood: 3000, gold: 3000, favor: 100 });
      p.age = 1;
      if (s.owner !== game.combat.ai.owner) game.combat.addAI(s.owner);
    }
    // soldiers go for enemy buildings as soon as their fight is over
    for (const ai of game.combat.ais) ai.nextWaveAt = 0;

    // towns and villagers
    const per = starts.map((s, i) => Math.floor(total / P) + (i < total % P ? 1 : 0));
    const towns = starts.map((s, i) => {
      const vill = Math.max(5, Math.round(per[i] * 0.3));
      return { ...buildTown(game, s.owner, s, { villagers: vill, soldiers: 0 }), owner: s.owner, armyN: Math.max(0, per[i] - vill) };
    });

    // armies: half of each army on each of its two fronts
    const fronts = stressFronts(starts);
    const blocks = new Map(); // front index -> { [owner]: units }
    const byOwner = new Map(starts.map((s) => [s.owner, s]));
    towns.forEach((t, i) => {
      const types = armyTypes(t.armyN);
      // front i is shared with the next player, front i-1 with the previous one
      // (two players share a single front)
      const mine = P === 2 ? [0] : [(i - 1 + P) % P, i];
      const halves = P === 2 ? [types] : [types.filter((_, k) => k % 2 === 0), types.filter((_, k) => k % 2 === 1)];
      mine.forEach((fi, h) => {
        const f = fronts[fi];
        const me = byOwner.get(t.owner);
        let dx = f.tx - me.tx, dz = f.tz - me.tz;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        const us = spawnArmyBlock(game, t.owner, halves[h], f, [dx, dz]);
        if (!blocks.has(fi)) blocks.set(fi, {});
        blocks.get(fi)[t.owner] = us;
      });
    });
    // every soldier onto a man of the opposing block (spread along its line)
    for (const [fi, sides] of blocks) {
      const f = fronts[fi];
      const a = sides[f.a] || [], b = sides[f.b] || [];
      for (const [mine, theirs] of [[a, b], [b, a]]) {
        if (!theirs.length) continue;
        mine.forEach((u, k) => {
          const t = theirs[Math.floor((k * theirs.length) / mine.length)];
          game.commands.order(u, { type: 'attack', targetId: t.id });
        });
      }
    }
    const f0 = fronts[0];
    return { focus: { x: f0.tx, z: f0.tz }, total, fronts: fronts.length, towns: towns.length };
  },
  camera: (game, ctx) => ({ x: ctx.focus.x, z: ctx.focus.z, distance: 52, pitch: 52 }),
};
