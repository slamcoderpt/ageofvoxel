#!/usr/bin/env node
// Parity check of the C++ sim core (godot/native/src/sim) against the JS
// modules it ports: map + initial resources, entity store, units (spawn,
// anim state, _spread, corpse clearing), A* pathfinding, Movement and
// Commands (move / formation move / smart / idle), the economy (gathering,
// farms, hunting, fishing, worship, training, age) and buildings
// (placement, construction, builders moving on), and the scene setups
// (town, economy, ...: op 'scene' / 'after'). Each scenario spawns
// armies on a scene map (seeds and presets of the scenes), gives orders,
// steps the fixed 30 Hz tick and compares every unit's id, x, z, rot, hp,
// flags, order and anim state bit for bit at every checkpoint.
//
//   node scripts/check-sim.mjs [--only name,name] [--godot godot] [--keep]
//
// The JS side runs the real src/core modules headless (no renderer): the
// Units piece is used through its prototype (spawn / update / _spread),
// resources are spawned like terrain.spawnResource, and the real Economy and
// Buildings pieces run on a THREE.Scene that is never drawn (combat, the
// enemy AI and god powers are not ported yet, so they are left out on both
// sides). Checkpoints also compare players, buildings and resources. The C++ side is
// godot/game/core/simcheck.gd. Exit code 1 on any difference.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMap } from '../src/core/GameMap.js';
import { EventBus } from '../src/core/EventBus.js';
import { EntityStore } from '../src/core/EntityStore.js';
import { RNG } from '../src/core/rng.js';
import { Pathfinder } from '../src/core/pathfinding.js';
import { Movement } from '../src/core/Movement.js';
import { Commands } from '../src/core/Commands.js';
import { GAIA } from '../src/core/constants.js';
import { RESOURCE_DEFS } from '../src/terrain/resourceDefs.js';
import { Units } from '../src/units/index.js';
import { UNIT_DEFS } from '../src/units/defs.js';
import * as THREE from 'three';
import { Player } from '../src/core/Players.js';
import { PLAYER, ENEMY } from '../src/core/constants.js';
import { Economy } from '../src/economy/index.js';
import { Buildings } from '../src/buildings/index.js';
import { SCENES } from '../src/core/scenes/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const GODOT = opt('godot', 'godot');
const ONLY = opt('only', '');
const KEEP = argv.includes('--keep');

const ORDERS = ['idle', 'move', 'gather', 'dropoff', 'worship', 'build', 'attack'];
const ANIMS = ['idle', 'walk', 'gather', 'build', 'worship', 'attack', 'die'];

// ---- JS headless game -------------------------------------------------------
function makeGame({ seed, size, preset, players }) {
  const game = { time: 0, tickCount: 0 };
  game.events = new EventBus();
  game.entities = new EntityStore(game.events);
  game.rng = new RNG(seed);
  const gen = generateMap({ seed, size, preset, players });
  game.map = gen.map;
  game.starts = gen.starts;
  game.pathfinder = new Pathfinder(game.map);
  game.movement = new Movement(game);
  game.commands = new Commands(game);
  game.units = Object.create(Units.prototype);
  game.units.game = game;
  game.units.defs = UNIT_DEFS;
  game.isEnemy = (a, b) => a !== b && a !== GAIA && b !== GAIA;
  game.players = {
    [GAIA]: new Player(GAIA, { name: 'Gaia' }),
    [PLAYER]: new Player(PLAYER, { name: 'You' }),
    [ENEMY]: new Player(ENEMY, { name: 'Enemy', isAI: true }),
  };
  game.localPlayer = PLAYER;
  game.addPlayer = (id, opts = {}) => (game.players[id] ||= new Player(id, opts));
  for (let id = 3; id <= players; id++) game.addPlayer(id, { name: `AI ${id}`, isAI: true }); // as simcheck.gd
  game.scene = new THREE.Scene();
  game.fx = { emit() {} };
  game.combat = { ai: { enabled: false }, ais: [], addAI() {} };
  game.terrain = {
    spawnResource(type, tx, tz, opts = {}) {
      const def = RESOURCE_DEFS[type];
      const e = game.entities.add({
        kind: 'resource', type, owner: GAIA, def, resType: def.resType, amount: def.amount, maxAmount: def.amount,
        tx, tz, w: def.w, h: def.h, x: tx + def.w / 2, z: tz + def.h / 2, rot: 0, hp: 1, maxHp: 1,
        radius: Math.max(def.w, def.h) / 2, variant: opts.variant ?? 0,
      });
      game.map.block(tx, tz, def.w, def.h, e.id);
      return e;
    },
    removeResource(e) {
      if (e.removed) return;
      game.map.unblock(e.tx, e.tz, e.w, e.h);
      game.entities.remove(e);
    },
    clearRect(tx, tz, w, h) {
      for (const e of [...game.entities.resources()])
        if (e.tx < tx + w && e.tx + e.w > tx && e.tz < tz + h && e.tz + e.h > tz) this.removeResource(e);
    },
  };
  game.buildings = new Buildings(game);
  game.economy = new Economy(game);
  for (const r of gen.resources) game.terrain.spawnResource(r.type, r.tx, r.tz, r);
  game.tick = (dt = 1 / 30) => {
    game.time += dt;
    game.tickCount++;
    game.economy.update(dt);
    game.buildings.update(dt);
    game.units.update(dt);
    game.movement.update(dt);
  };
  game.fastForward = (seconds) => { const n = Math.round(seconds / (1 / 30)); for (let i = 0; i < n; i++) game.tick(1 / 30); };
  return game;
}

// helpers.js spawnBlock
function spawnBlock(game, type, owner, count, x, z, { cols = 0, spacing = 1.0, rot = 0, jitter = 0.15 } = {}) {
  const out = [];
  cols = cols || Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const ox = (col - (cols - 1) / 2) * spacing + game.rng.range(-jitter, jitter);
    const oz = (row - (rows - 1) / 2) * spacing + game.rng.range(-jitter, jitter);
    let wx = x + ox * c + oz * s, wz = z - ox * s + oz * c;
    const w = game.pathfinder.nearestWalkable(Math.floor(wx), Math.floor(wz), 6);
    if (w && !game.map.isWalkable(Math.floor(wx), Math.floor(wz))) { wx = w[0] + 0.5; wz = w[1] + 0.5; }
    out.push(game.units.spawn(type, owner, wx, wz, { rot }));
  }
  return out;
}

function unitsDump(game) {
  const out = [];
  for (const u of game.entities.units()) {
    out.push(u.id, u.x, u.z, u.rot, u.hp, (u.moving ? 1 : 0) | (u.dead ? 2 : 0) | (u.arrived ? 4 : 0),
      ORDERS.indexOf(u.order?.type ?? 'idle'), ANIMS.indexOf(u.anim.state));
  }
  return out;
}

// src/buildings/placement.js confirm() for any owner
function placeBuilding(game, type, owner, tx, tz, builders) {
  const def = game.buildings.defs[type];
  const player = game.players[owner];
  if (!game.buildings.canPlace(type, tx, tz) || !player.canAfford(def.cost)) return null;
  if (!player.pay(def.cost)) return null;
  const b = game.buildings.spawn(type, owner, tx, tz, { built: false });
  for (const u of builders) {
    const prev = u.order?.type === 'build' ? u.order.resume : u.order;
    game.commands.order(u, { type: 'build', targetId: b.id });
    if (u.order.type === 'build' && prev && (prev.type === 'gather' || prev.type === 'worship'))
      u.order.resume = { type: prev.type, targetId: prev.targetId, resType: u.econ?.resType };
  }
  return b;
}

function econDump(game) {
  const out = [];
  for (const id in game.players) {
    const p = game.players[id];
    out.push(p.res.food, p.res.wood, p.res.gold, p.res.favor, p.pop, p.popCap, p.age);
  }
  for (const b of game.entities.buildings()) out.push(b.id, b.hp, b.progress, b.built ? 1 : 0, b.queue.length, b.econ_rows || 0);
  for (const r of game.entities.resources()) out.push(r.id, r.amount, r.x, r.z);
  return out;
}

function hashDump(d) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { v >>>= 0; for (let k = 0; k < 4; k++) { h ^= (v >>> (k * 8)) & 255; h = Math.imul(h, 16777619) >>> 0; } };
  const dv = new DataView(new ArrayBuffer(8));
  const mixd = (x) => { dv.setFloat64(0, x, true); mix(dv.getUint32(0, true)); mix(dv.getUint32(4, true)); };
  for (let i = 0; i < d.length; i += 8) {
    mix(d[i]); mixd(d[i + 1]); mixd(d[i + 2]); mixd(d[i + 3]); mixd(d[i + 4]); mix(d[i + 5]); mix(d[i + 6]); mix(d[i + 7]);
  }
  return h.toString(16).padStart(8, '0');
}

function runJS(sc) {
  const game = makeGame(sc);
  const groups = {};
  const ids = (spec) => spec.split(',').flatMap((g) => groups[g] || []).map((id) => game.entities.get(id)).filter(Boolean);
  const checkpoints = [];
  let sceneCtx = {};
  const t0 = performance.now();
  for (const op of sc.ops) {
    switch (op.op) {
      case 'block':
        groups[op.as] = spawnBlock(game, op.type, op.owner, op.count, op.x, op.z, op).map((u) => u.id); break;
      case 'spawn':
        groups[op.as] = [game.units.spawn(op.type, op.owner, op.x, op.z, { rot: op.rot ?? 0 }).id]; break;
      case 'move': game.commands.move(ids(op.group), op.x, op.z); break;
      case 'smart': game.commands.smart(ids(op.group), op.x, op.z, op.target ? game.entities.get(op.target) : null); break;
      case 'order': for (const u of ids(op.group)) game.commands.order(u, { type: op.type, x: op.x ?? 0, z: op.z ?? 0 }); break;
      case 'moveTo': for (const u of ids(op.group)) game.movement.moveTo(u, op.x, op.z, { range: op.range ?? 0 }); break;
      case 'kill': {
        const list = ids(op.group).slice(0, op.count ?? Infinity);
        for (const u of list) { if (u.dead) continue; u.dead = true; u.hp = 0; game.movement.stop(u); }
        break;
      }
      case 'clearRect':
        for (const e of [...game.entities.resources()])
          if (e.tx < op.tx + op.w && e.tx + e.w > op.tx && e.tz < op.tz + op.h && e.tz + e.h > op.tz) { game.map.unblock(e.tx, e.tz, e.w, e.h); game.entities.remove(e); }
        break;
      case 'run':
        for (let i = 0; i < op.ticks; i++) {
          game.tick();
          if (game.tickCount % (sc.every ?? 15) === 0) {
            const units = unitsDump(game);
            checkpoints.push({ tick: game.tickCount, hash: hashDump(units), units, econ: econDump(game) });
          }
        }
        break;
      case 'units':
        groups[op.as] = [...game.entities.units()].filter((u) => u.type === op.type && u.owner === op.owner && !u.dead).map((u) => u.id); break;
      case 'buildings':
        groups[op.as] = [...game.entities.buildings()].filter((b) => b.type === op.type && b.owner === op.owner).map((b) => b.id); break;
      case 'setRes': Object.assign(game.players[op.owner].res, op.res); break;
      case 'train': for (const b of ids(op.group)) for (let i = 0; i < (op.count ?? 1); i++) game.economy.train(b, op.type); break;
      case 'cancel': for (const b of ids(op.group)) game.economy.cancelTrain(b, op.index ?? 0); break;
      case 'age': game.economy.advanceAge(op.owner); break;
      case 'place': { const b = placeBuilding(game, op.type, op.owner, op.tx, op.tz, ids(op.group ?? '')); groups[op.as] = b ? [b.id] : []; break; }
      case 'destroy': for (const b of ids(op.group)) game.buildings.destroy(b); break;
      case 'gather': {
        const r = game.economy.nearestResource(op.x, op.z, op.resType, 30);
        if (r) for (const u of ids(op.group)) game.commands.order(u, { type: 'gather', targetId: r.id });
        break;
      }
      case 'scene': sceneCtx = SCENES.get(op.name).setup(game) || {}; break;
      case 'after': SCENES.get(op.name).after?.(game, sceneCtx); break;
      default: throw new Error(`unknown op ${op.op}`);
    }
  }
  return { checkpoints, ms: (performance.now() - t0) / Math.max(1, game.tickCount) };
}

// ---- scenarios --------------------------------------------------------------
function scenarios() {
  const out = [];
  const starts = (seed, size, preset, players) => generateMap({ seed, size, preset, players }).starts;
  {
    // skirmish seed 3: armies cross the map through forest and collide; villagers
    // walk round trees; half an army dies (corpse clearing, removal after 26 s)
    const [a, b] = starts(3, 128, 'skirmish', 2);
    const A = { x: a.tx + 0.5, z: a.tz + 0.5 }, B = { x: b.tx + 0.5, z: b.tz + 0.5 };
    out.push({ name: 'skirmish', seed: 3, size: 128, preset: 'skirmish', players: 2, ops: [
      { op: 'block', as: 'v1', type: 'villager', owner: 1, count: 8, x: A.x, z: A.z + 5, spacing: 1.1 },
      { op: 'block', as: 'h1', type: 'hoplite', owner: 1, count: 16, x: A.x + 6, z: A.z, cols: 4, spacing: 1.0, rot: Math.PI / 4 },
      { op: 'block', as: 'h2', type: 'hoplite', owner: 2, count: 12, x: B.x, z: B.z - 6, spacing: 1.05 },
      { op: 'block', as: 't2', type: 'toxotes', owner: 2, count: 8, x: B.x - 5, z: B.z - 5 },
      { op: 'block', as: 'c2', type: 'hippikon', owner: 2, count: 4, x: B.x + 5, z: B.z - 3, spacing: 1.6 },
      { op: 'block', as: 'm2', type: 'minotaur', owner: 2, count: 2, x: B.x + 2, z: B.z + 4, spacing: 2.2 },
      { op: 'move', group: 'h1', x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 },
      { op: 'smart', group: 'h2,t2,c2,m2', x: (A.x + B.x) / 2 + 1, z: (A.z + B.z) / 2 - 1 },
      { op: 'moveTo', group: 'v1', x: A.x - 14, z: A.z + 12 },
      { op: 'run', ticks: 450 },
      { op: 'kill', group: 'h2', count: 6 },
      { op: 'order', group: 'v1', type: 'move', x: A.x + 3, z: A.z - 9 },
      { op: 'move', group: 'h1,m2', x: B.x, z: B.z },
      { op: 'run', ticks: 420 },
      { op: 'order', group: 'h1', type: 'idle' },
      { op: 'run', ticks: 480 },
    ] });
  }
  {
    // town seed 7: a crowd of villagers and soldiers, repeated formation moves
    const [a] = starts(7, 128, 'skirmish', 2);
    const A = { x: a.tx + 0.5, z: a.tz + 0.5 };
    out.push({ name: 'town', seed: 7, size: 128, preset: 'skirmish', players: 2, ops: [
      { op: 'block', as: 'v', type: 'villager', owner: 1, count: 28, x: A.x, z: A.z + 4, spacing: 1.2 },
      { op: 'block', as: 's', type: 'hoplite', owner: 1, count: 6, x: A.x + 5.5, z: A.z + 1, cols: 3, rot: Math.PI / 4 },
      { op: 'move', group: 'v', x: A.x + 12, z: A.z - 10 },
      { op: 'run', ticks: 240 },
      { op: 'move', group: 'v,s', x: A.x - 10, z: A.z + 14 },
      { op: 'run', ticks: 120 },
      { op: 'smart', group: 's', x: A.x + 2, z: A.z + 2 },
      { op: 'run', ticks: 360 },
    ] });
  }
  {
    // battle seed 19: two armies charge into each other (separation + spread)
    const cx = 64, cz = 64;
    out.push({ name: 'battle', seed: 19, size: 128, preset: 'battle', players: 2, ops: [
      { op: 'block', as: 'rh', type: 'hoplite', owner: 2, count: 40, x: cx - 8, z: cz - 8, cols: 8, spacing: 1.05, rot: Math.PI / 4 },
      { op: 'block', as: 'rt', type: 'toxotes', owner: 2, count: 16, x: cx - 13, z: cz - 13, cols: 8, rot: Math.PI / 4 },
      { op: 'block', as: 'rm', type: 'cyclops', owner: 2, count: 2, x: cx - 10, z: cz - 5, spacing: 2.4 },
      { op: 'block', as: 'bh', type: 'hoplite', owner: 1, count: 40, x: cx + 8, z: cz + 8, cols: 8, spacing: 1.05, rot: Math.PI * 1.25 },
      { op: 'block', as: 'bc', type: 'hippikon', owner: 1, count: 10, x: cx + 13, z: cz + 3, cols: 5, spacing: 1.6 },
      { op: 'spawn', as: 'hero', type: 'hero', owner: 1, x: cx + 11, z: cz + 11 },
      { op: 'move', group: 'rh,rm', x: cx + 2, z: cz + 2 },
      { op: 'move', group: 'bh,bc,hero', x: cx - 2, z: cz - 2 },
      { op: 'run', ticks: 300 },
      { op: 'kill', group: 'rh', count: 12 },
      { op: 'kill', group: 'bh', count: 8 },
      { op: 'order', group: 'rt', type: 'move', x: cx, z: cz },
      { op: 'run', ticks: 600 },
    ] });
  }
  {
    // coast seed 5: orders into the sea (goal replaced by the nearest walkable tile)
    const [a, b] = starts(5, 128, 'coast', 2);
    const A = { x: a.tx + 0.5, z: a.tz + 0.5 };
    out.push({ name: 'coast', seed: 5, size: 128, preset: 'coast', players: 2, ops: [
      { op: 'block', as: 'v', type: 'villager', owner: 1, count: 12, x: A.x, z: A.z + 4 },
      { op: 'block', as: 'h', type: 'hoplite', owner: 1, count: 9, x: A.x + 5, z: A.z },
      { op: 'move', group: 'v', x: 120, z: 64 },
      { op: 'move', group: 'h', x: 64, z: 125 },
      { op: 'run', ticks: 450 },
      { op: 'smart', group: 'v,h', x: b.tx + 0.5, z: b.tz + 0.5 },
      { op: 'run', ticks: 450 },
    ] });
  }
  // scene setups (C++ sim/scenes vs src/core/scenes + EconomyScene.js), then the
  // economy and buildings running them: gathering, farms, hunting, fishing,
  // worship, training, construction
  out.push({ name: 'town-scene', seed: 7, size: 128, preset: 'skirmish', players: 2, every: 30, ops: [
    { op: 'scene', name: 'town' }, { op: 'run', ticks: 900 }, { op: 'run', ticks: 900 },
  ] });
  out.push({ name: 'econ-scene', seed: 3, size: 128, preset: 'skirmish', players: 2, every: 30, ops: [
    { op: 'scene', name: 'economy' }, { op: 'run', ticks: 450 }, { op: 'after', name: 'economy' }, { op: 'run', ticks: 3600 },
  ] });
  out.push({ name: 'coast-scene', seed: 5, size: 128, preset: 'coast', players: 2, every: 30, ops: [
    { op: 'scene', name: 'coast' }, { op: 'run', ticks: 900 },
  ] });
  out.push({ name: 'hud-scene', seed: 7, size: 128, preset: 'skirmish', players: 2, every: 30, ops: [
    { op: 'scene', name: 'hud' }, { op: 'run', ticks: 900 },
  ] });
  {
    // placement, construction and builders moving on, training queues and
    // cancel, age advancement, destruction, gather orders
    const [a] = starts(3, 128, 'skirmish', 2);
    out.push({ name: 'econ-ops', seed: 3, size: 128, preset: 'skirmish', players: 2, every: 30, ops: [
      { op: 'scene', name: 'skirmish' },
      { op: 'units', as: 'v', type: 'villager', owner: 1 },
      { op: 'buildings', as: 'tc', type: 'town_center', owner: 1 },
      { op: 'setRes', owner: 1, res: { food: 2000, wood: 2000, gold: 2000, favor: 50 } },
      { op: 'gather', group: 'v', x: a.tx, z: a.tz, resType: 'wood' },
      { op: 'run', ticks: 120 },
      { op: 'train', group: 'tc', type: 'villager', count: 4 },
      { op: 'cancel', group: 'tc', index: 3 },
      { op: 'age', owner: 1 },
      { op: 'place', as: 'h1', type: 'house', owner: 1, tx: a.tx + 6, tz: a.tz - 9, group: 'v' },
      { op: 'place', as: 'f1', type: 'farm', owner: 1, tx: a.tx - 12, tz: a.tz + 5, group: '' },
      { op: 'run', ticks: 900 },
      { op: 'units', as: 'v2', type: 'villager', owner: 1 },
      { op: 'place', as: 'h2', type: 'storehouse', owner: 1, tx: a.tx + 9, tz: a.tz + 6, group: 'v2' },
      { op: 'place', as: 'f2', type: 'farm', owner: 1, tx: a.tx - 7, tz: a.tz + 9, group: 'v2' },
      { op: 'run', ticks: 900 },
      { op: 'destroy', group: 'h1' },
      { op: 'run', ticks: 600 },
    ] });
  }
  for (const [name, per] of [['stress', 330], ['stress4k', 700]]) {
    // stress seed 23, 6 players on 256 tiles: ~2000 (4200) units converge on the centre
    const st = starts(23, 256, 'stress', 6);
    const ops = [];
    const nh = Math.round(per * 0.45);
    for (const s of st) {
      const x = s.tx + 0.5, z = s.tz + 0.5;
      const dx = 128 - x, dz = 128 - z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      const bx = x + ux * 10, bz = z + uz * 10;
      const rot = Math.atan2(ux, uz);
      ops.push({ op: 'block', as: `v${s.owner}`, type: 'villager', owner: s.owner, count: 60, x: x - ux * 4, z: z - uz * 4, spacing: 1.1 });
      ops.push({ op: 'block', as: `h${s.owner}`, type: 'hoplite', owner: s.owner, count: nh, x: bx, z: bz, cols: 15, spacing: 1.1, rot });
      ops.push({ op: 'block', as: `c${s.owner}`, type: 'hippikon', owner: s.owner, count: 40, x: bx - ux * 10, z: bz - uz * 10, cols: 10, spacing: 1.6, rot });
      ops.push({ op: 'block', as: `t${s.owner}`, type: 'toxotes', owner: s.owner, count: per - 60 - nh - 40 - 8, x: bx - ux * 16, z: bz - uz * 16, cols: 12, rot });
      ops.push({ op: 'block', as: `m${s.owner}`, type: 'minotaur', owner: s.owner, count: 8, x: bx - ux * 6 + uz * 12, z: bz - uz * 6 - ux * 12, cols: 4, spacing: 2.2, rot });
    }
    for (const s of st) ops.push({ op: 'move', group: `h${s.owner},c${s.owner},m${s.owner}`, x: 128 + (s.tx - 128) * 0.12, z: 128 + (s.tz - 128) * 0.12 });
    for (const s of st) ops.push({ op: 'smart', group: `t${s.owner}`, x: 128 + (s.tx - 128) * 0.3, z: 128 + (s.tz - 128) * 0.3 });
    ops.push({ op: 'run', ticks: 450 });
    for (const s of st) ops.push({ op: 'kill', group: `h${s.owner}`, count: 30 });
    for (const s of st) ops.push({ op: 'move', group: `v${s.owner}`, x: 128, z: 128 });
    ops.push({ op: 'run', ticks: 450 });
    out.push({ name, seed: 23, size: 256, preset: 'stress', players: 6, every: 30, ops });
    // the same with shared group paths (opt-in, not JS-exact): timing and arrival only
    if (name === 'stress4k') out.push({ name: 'stress4k-group', seed: 23, size: 256, preset: 'stress', players: 6, every: 30, groupPaths: 24, repathBudget: 24, exact: false, ops });
  }
  return out;
}

// ---- compare ----------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aov-simcheck-'));
let bad = 0;
for (const sc of scenarios()) {
  if (ONLY && !ONLY.split(',').includes(sc.name)) continue;
  const inFile = path.join(tmp, `${sc.name}.json`), outFile = path.join(tmp, `${sc.name}.out.json`);
  // doubles go to Godot as exact bit patterns ("f64:<hex LE>"): its JSON
  // parser is not correctly rounded (off by an ulp on some inputs)
  const exact = (k, v) => (typeof v === 'number' && !Number.isInteger(v)
    ? (() => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return `f64:${b.toString('hex')}`; })() : v);
  fs.writeFileSync(inFile, JSON.stringify(sc, exact));
  const js = sc.exact === false ? null : runJS(sc);
  let log;
  try {
    log = execFileSync(GODOT, ['--headless', '--path', path.join(ROOT, 'godot'), '-s', 'res://game/core/simcheck.gd', '--',
      `--scenario=${inFile}`, `--out=${outFile}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.log(`FAIL ${sc.name}: godot exited ${e.status}\n${e.stdout}\n${e.stderr}`);
    bad++;
    continue;
  }
  const cpp = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  if (!js) {
    console.log(`run  ${sc.name.padEnd(9)} (not JS-exact by design) ${log.trim().split('\n').filter((l) => l.startsWith('simcheck:')).join(' | ')}`);
    continue;
  }
  const perf = (log.match(/sim ([\d.]+ ms\/tick \(max [\d.]+ at tick \d+\)), slowest order op ([\d.]+ ms)/) || []).slice(1).join(', orders max ');
  let diff = null;
  const n = Math.max(js.checkpoints.length, cpp.checkpoints.length);
  for (let i = 0; i < n && !diff; i++) {
    const a = js.checkpoints[i], b = cpp.checkpoints[i];
    if (!a || !b || a.tick !== b.tick) { diff = { tick: a?.tick ?? b?.tick, why: 'checkpoint count' }; break; }
    const ua = a.units, ub = b.units;
    if (a.hash !== b.hash || ua.length !== ub.length) {
      for (let k = 0; k < Math.max(ua.length, ub.length); k += 8) {
        const ra = ua.slice(k, k + 8), rb = (ub.slice ? ub.slice(k, k + 8) : []);
        if (ra.length !== rb.length || ra.some((v, j) => v !== rb[j])) {
          diff = { tick: a.tick, why: `unit row ${k / 8}`, js: ra, cpp: rb };
          break;
        }
      }
      if (!diff) diff = { tick: a.tick, why: `hash js ${a.hash} c++ ${b.hash}` };
    }
    // players [res x4, pop, popCap, age]*, buildings [id, hp, progress, built, queue, rows]*, resources [id, amount, x, z]*
    const ea = a.econ || [], eb = b.econ || [];
    if (!diff && (ea.length !== eb.length || ea.some((v, j) => v !== eb[j]))) {
      let k = 0;
      while (k < Math.min(ea.length, eb.length) && ea[k] === eb[k]) k++;
      diff = { tick: a.tick, why: `econ state at ${k} of ${ea.length} (js) / ${eb.length} (c++)`, econ: true, js: ea.slice(Math.max(0, k - 4), k + 6), cpp: eb.slice(Math.max(0, k - 4), k + 6) };
    }
  }
  const last = js.checkpoints[js.checkpoints.length - 1];
  const units = last ? last.units.length / 8 : 0;
  if (diff) {
    bad++;
    console.log(`DIFF ${sc.name.padEnd(9)} first at tick ${diff.tick}: ${diff.why}`);
    if (diff.js) console.log(`     ${diff.econ ? '[... around the first difference]' : '[id, x, z, rot, hp, flags, order, anim]'}\n     js  ${JSON.stringify(diff.js)}\n     c++ ${JSON.stringify(diff.cpp)}`);
  } else {
    console.log(`ok   ${sc.name.padEnd(9)} seed ${String(sc.seed).padEnd(3)} ${sc.preset.padEnd(9)} ${String(units).padStart(5)} units  ${js.checkpoints.length} checkpoints up to tick ${last?.tick}, all bit-exact  (js ${js.ms.toFixed(2)} ms/tick, c++ ${perf})`);
  }
}
if (!KEEP) fs.rmSync(tmp, { recursive: true, force: true });
else console.log(`kept ${tmp}`);
process.exit(bad ? 1 : 0);
