import { PLAYER, ENEMY } from '../constants.js';
import { battleScene } from '../../combat/BattleScene.js';
import { economyScene } from '../../economy/EconomyScene.js';
import { standardStart, buildTown, spawnBlock, placeNear, nearestResource, assignGatherers } from './helpers.js';

// Scene registry for the deterministic screenshot harness.
//
// URL: /?scene=<name>[&seed=N][&live=1][&hud=0|1][&post=high|low|off][&timescale=N][&fog=0|1]
//
// A scene describes: map preset + seed, a setup(game) that spawns and orders
// entities, how many seconds to fast-forward, and a camera. After setup and
// fast-forward the harness pauses the sim (unless live) and, once a few frames
// have rendered, sets window.__sceneReady = true.
//
// Fields: preset, seed, mapSize, hud (bool), revealAll (bool), ai (bool),
//         live (bool), fastForward (s), camera {x,z,distance,pitch,yaw} or
//         camera(game) -> that object, setup(game) -> any.
export const SCENES = new Map();
export function registerScene(name, def) { SCENES.set(name, { name, ...def }); }

// ---------------------------------------------------------------------------
registerScene('skirmish', {
  description: 'Default playable match: you vs. the AI.',
  preset: 'skirmish', seed: 3, hud: true, revealAll: false, ai: true, live: true, fastForward: 0,
  setup(game) {
    const [p, e] = game.starts;
    const me = standardStart(game, PLAYER, p, 5);
    standardStart(game, ENEMY, e, 5);
    game.combat.ai.enabled = true;
    return { focus: me.tc };
  },
  camera: (game, ctx) => ({ x: ctx.focus.x + 2, z: ctx.focus.z + 4, distance: 44 }),
});

registerScene('town', {
  description: 'A developed Greek town in full swing.',
  preset: 'skirmish', seed: 7, hud: false, revealAll: true, ai: false, fastForward: 30,
  setup(game) {
    const [p, e] = game.starts;
    const t = buildTown(game, PLAYER, p, { villagers: 28, soldiers: 6 });
    standardStart(game, ENEMY, e, 3);
    game.players[PLAYER].age = 1;
    return { focus: t.tc };
  },
  camera: (game, ctx) => ({ x: ctx.focus.x + 1, z: ctx.focus.z + 1, distance: 50, pitch: 50 }),
});

// The battle scene lives with the combat piece (src/combat/BattleScene.js).
registerScene('battle', battleScene);

registerScene('godpower', {
  description: "Zeus's Lightning Storm striking an enemy army.",
  preset: 'battle', seed: 19, hud: false, revealAll: true, ai: false, fastForward: 0,
  setup(game) {
    const cx = 60, cz = 62;
    const red = [
      ...spawnBlock(game, 'hoplite', ENEMY, 24, cx, cz, { cols: 6, spacing: 1.05, rot: Math.PI / 4 }),
      ...spawnBlock(game, 'toxotes', ENEMY, 10, cx - 4, cz - 4, { cols: 5, spacing: 1.0, rot: Math.PI / 4 }),
      ...spawnBlock(game, 'minotaur', ENEMY, 2, cx + 3, cz - 3, { spacing: 2.2, rot: Math.PI / 4 }),
    ];
    placeNear(game, 'barracks', ENEMY, cx - 9, cz - 3, { maxR: 4 });
    placeNear(game, 'house', ENEMY, cx - 3, cz - 10, { maxR: 4 });
    placeNear(game, 'house', ENEMY, cx + 4, cz - 10, { maxR: 4 });
    const blue = spawnBlock(game, 'hoplite', PLAYER, 9, cx + 10, cz + 10, { cols: 3, spacing: 1.0, rot: Math.PI + Math.PI / 4 });
    for (const u of red) game.commands.order(u, { type: 'move', x: u.x + 3, z: u.z + 3 });
    game.players[PLAYER].res.favor = 100;
    game.fastForward(0.5);
    game.godpowers.cast(PLAYER, 'lightning_storm', cx, cz);
    game.fastForward(2.4);
    // step until a fresh bolt is on screen so the capture always shows one
    for (let i = 0; i < 60; i++) {
      const fresh = game.godpowers.bolts.some((b) => game.time - b.t0 < 0.12);
      if (fresh) break;
      game.tick();
    }
    void blue;
    return { focus: { x: cx, z: cz } };
  },
  camera: { x: 61, z: 63, distance: 36, pitch: 50 },
});

registerScene('coast', {
  description: 'A seaside town with beach, cliffs and animated water.',
  preset: 'coast', seed: 5, hud: false, revealAll: true, ai: false, fastForward: 20,
  setup(game) {
    const [p] = game.starts;
    const t = buildTown(game, PLAYER, p, { villagers: 16, soldiers: 3 });
    // shoreline focus: find the first water column east of the town
    const map = game.map;
    let sx = p.tx + 10;
    while (sx < map.size - 1 && !map.isWaterCol(sx * map.cps, p.tz * map.cps)) sx++;
    return { focus: { x: (t.tc.x + sx) / 2 + 3, z: t.tc.z + 2 } };
  },
  camera: (game, ctx) => ({ x: ctx.focus.x, z: ctx.focus.z, distance: 56, pitch: 46, yaw: 20 }),
});

// The economy scene lives with the economy piece (src/economy/EconomyScene.js).
registerScene('economy', economyScene);

registerScene('hud', {
  description: 'The town with the full HUD visible and a villager selected.',
  preset: 'skirmish', seed: 7, hud: true, revealAll: false, ai: false, fastForward: 30,
  setup(game) {
    const [p, e] = game.starts;
    const t = buildTown(game, PLAYER, p, { villagers: 20, soldiers: 5 });
    standardStart(game, ENEMY, e, 3);
    const pl = game.players[PLAYER];
    Object.assign(pl.res, { food: 845, wood: 612, gold: 430, favor: 37 });
    game.economy.train(t.tc, 'villager');
    game.economy.train(t.tc, 'villager');
    return { focus: t.tc, select: t.villagers.slice(0, 1) };
  },
  after(game, ctx) {
    game.ui.selection.set(ctx.select.map((u) => u.id));
  },
  camera: (game, ctx) => ({ x: ctx.focus.x + 2, z: ctx.focus.z + 5, distance: 44 }),
});
