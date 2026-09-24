import * as THREE from 'three';
import { SIM_DT, PLAYER, ENEMY, GAIA } from './constants.js';
import { EventBus } from './EventBus.js';
import { EntityStore } from './EntityStore.js';
import { Player } from './Players.js';
import { RNG } from './rng.js';
import { generateMap } from './GameMap.js';
import { Pathfinder } from './pathfinding.js';
import { Movement } from './Movement.js';
import { Commands } from './Commands.js';
import { Input } from './Input.js';
import { CameraController } from './CameraController.js';
import { FogOfWar } from './FogOfWar.js';
import { Particles } from './fx/Particles.js';
import { pickGround, worldToScreen } from './picking.js';

import { Lighting } from '../lighting/index.js';
import { Terrain } from '../terrain/index.js';
import { Buildings } from '../buildings/index.js';
import { Units } from '../units/index.js';
import { Economy } from '../economy/index.js';
import { Combat } from '../combat/index.js';
import { GodPowers } from '../godpowers/index.js';
import { UI } from '../ui/index.js';

// The Game wires every piece together and owns the fixed-step loop.
//
// Piece contract: each piece is a class constructed with (game) that may
// implement:
//   update(dt)            fixed-step simulation (SIM_DT), deterministic
//   render(dt, alpha)     once per displayed frame (visual only)
//   resize(w, h)
// Sim update order is the array in this.simOrder; render order this.renderOrder.
export class Game {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts; // { seed, preset, mapSize, post, timeScale, harness }
    this.events = new EventBus();
    this.entities = new EntityStore(this.events);
    this.rng = new RNG(opts.seed ?? 1);  // sim randomness (deterministic)
    this.time = 0;
    this.tickCount = 0;
    this.timeScale = opts.timeScale ?? 1;
    this.paused = false;
    this.alpha = 0;
    this.acc = 0;
    this.players = {
      [GAIA]: new Player(GAIA, { name: 'Gaia' }),
      [PLAYER]: new Player(PLAYER, { name: 'You' }),
      [ENEMY]: new Player(ENEMY, { name: 'Enemy', isAI: true }),
    };
    this.localPlayer = PLAYER;
    this.errors = [];
  }

  init() {
    const o = this.opts;
    // world data
    const gen = generateMap({ seed: o.seed ?? 1, size: o.mapSize ?? 128, preset: o.preset ?? 'skirmish' });
    this.map = gen.map;
    this.starts = gen.starts;
    this.pathfinder = new Pathfinder(this.map);

    // rendering scaffolding
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.5, 900);
    this.lighting = new Lighting(this, { post: o.post ?? 'high', preserveDrawingBuffer: !!o.harness });
    this.renderer = this.lighting.renderer;
    this.container.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);
    this.cameraCtl = new CameraController(this, this.camera);
    this.fog = new FogOfWar(this);
    this.fx = new Particles(this);

    // simulation core
    this.movement = new Movement(this);
    this.commands = new Commands(this);

    // pieces
    this.terrain = new Terrain(this);
    this.buildings = new Buildings(this);
    this.units = new Units(this);
    this.economy = new Economy(this);
    this.combat = new Combat(this);
    this.godpowers = new GodPowers(this);
    this.ui = new UI(this);

    for (const r of gen.resources) this.terrain.spawnResource(r.type, r.tx, r.tz, r);

    this.simOrder = [this.economy, this.buildings, this.combat, this.godpowers, this.units, this.movement, this.fx, this.fog];
    this.renderOrder = [this.lighting, this.terrain, this.buildings, this.units, this.combat, this.godpowers, this.ui];

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---- loop ---------------------------------------------------------------
  tick(dt = SIM_DT) {
    this.time += dt;
    this.tickCount++;
    for (const s of this.simOrder) s.update?.(dt);
  }

  fastForward(seconds) {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n; i++) this.tick(SIM_DT);
    this.acc = 0;
  }

  start() {
    let last = performance.now();
    const loop = (now) => {
      const realDt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      try {
        this.frame(realDt);
      } catch (err) {
        this.errors.push(String(err && err.stack || err));
        console.error(err);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(realDt) {
    if (this.frozen) return; // harness: keep the last frame (preserveDrawingBuffer)
    if (!this.paused) {
      this.acc += realDt * this.timeScale;
      let steps = 0;
      const maxSteps = Math.max(8, Math.ceil(this.timeScale * 4));
      while (this.acc >= SIM_DT && steps < maxSteps) {
        this.tick(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
    }
    this.alpha = this.paused ? 1 : Math.min(1, this.acc / SIM_DT);
    this.cameraCtl.update(realDt);
    for (const r of this.renderOrder) r.render?.(realDt, this.alpha);
    this.lighting.draw();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lighting.resize(w, h);
    this.fx.resize(h);
    for (const r of this.renderOrder) if (r !== this.lighting) r.resize?.(w, h);
  }

  // ---- helpers shared by pieces ---------------------------------------------
  player(id) { return this.players[id]; }
  pickGround(clientX, clientY) { return pickGround(this, clientX, clientY); }
  worldToScreen(x, y, z) { return worldToScreen(this, x, y, z); }
  isEnemy(a, b) { return a !== b && a !== GAIA && b !== GAIA; }

  // Snapshot of gameplay stats (used by smoke tests & debugging).
  stats() {
    const p = this.players[PLAYER], e = this.players[ENEMY];
    const units = [...this.entities.units()];
    return {
      time: this.time,
      ticks: this.tickCount,
      player: { ...p.res, pop: p.pop, popCap: p.popCap, age: p.age },
      enemy: { ...e.res, pop: e.pop, popCap: e.popCap, age: e.age },
      units: units.length,
      buildings: this.entities.count('building'),
      resources: this.entities.count('resource'),
      unitPositions: units.map((u) => [u.id, +u.x.toFixed(2), +u.z.toFixed(2)]),
      errors: this.errors.slice(),
    };
  }
}
