import * as THREE from 'three';
import { buildVoxelGeometry, makeVoxelMaterial, voxelMaterialFor } from '../core/voxel.js';
import { UNIT_DEFS } from './defs.js';
import { RIGS } from './models.js';
import { pose } from './anim.js';

// Units piece: unit entities, rigs, instanced rendering, animation state.
// Public API:
//   units.spawn(type, owner, x, z, { rot }) -> entity
//   units.portraitObject(type, owner) -> THREE.Group (for HUD portraits)
//
// Animation: other systems request a state for this tick by setting
// u.anim.want = 'gather' | 'build' | 'attack' | 'worship'. Walking and dying
// are derived automatically. Combat sets u.anim.attackT (seconds since the
// last strike) and u.flashT (hit flash).
const CORPSE_TIME = 6;

export class Units {
  constructor(game) {
    this.game = game;
    this.defs = UNIT_DEFS;
    this.group = new THREE.Group();
    this.group.name = 'units';
    game.scene.add(this.group);
    this.material = makeVoxelMaterial({ instanced: true });
    this.rigs = new Map(); // type -> { parts: [{name, geo, joint, parent, mesh, cap}], kind, voxel }
    for (const type of Object.keys(RIGS)) this._buildRig(type);
    this._m = new THREE.Matrix4();
    this._root = new THREE.Matrix4();
    this._tmp = new THREE.Matrix4();
    this._e = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  _buildRig(type) {
    const R = RIGS[type];
    const parts = R.build().map((p) => ({
      name: p.name, joint: p.joint, parent: p.parent,
      geo: buildVoxelGeometry(p.model, { size: R.voxel, pivot: p.pivot, jitter: 0.05 }),
      mesh: null, cap: 0,
    }));
    const rig = { type, parts, kind: R.anim, voxel: R.voxel, rot: {}, world: parts.map(() => new THREE.Matrix4()) };
    for (const p of parts) {
      rig.rot[p.name] = [0, 0, 0];
      p.parentIdx = p.parent ? parts.findIndex((q) => q.name === p.parent) : -1;
    }
    this.rigs.set(type, rig);
  }

  _ensureCapacity(part, n) {
    if (part.mesh && part.cap >= n) return;
    const cap = Math.max(64, part.cap * 2, n);
    if (part.mesh) { this.group.remove(part.mesh); part.mesh.dispose(); }
    const mesh = new THREE.InstancedMesh(part.geo, this.material, cap);
    const team = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const flash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    team.setUsage(THREE.DynamicDrawUsage); flash.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.team = team; mesh.userData.flash = flash;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // instanced attributes live on a per-mesh geometry clone that shares buffers
    const g = new THREE.BufferGeometry();
    for (const k in part.geo.attributes) g.setAttribute(k, part.geo.attributes[k]);
    g.setIndex(part.geo.index);
    g.boundingSphere = part.geo.boundingSphere;
    g.setAttribute('instTeam', team);
    g.setAttribute('instFlash', flash);
    mesh.geometry = g;
    part.mesh = mesh;
    part.cap = cap;
    this.group.add(mesh);
  }

  spawn(type, owner, x, z, { rot = 0 } = {}) {
    const def = UNIT_DEFS[type];
    if (!def) throw new Error(`Unknown unit ${type}`);
    return this.game.entities.add({
      kind: 'unit', type, owner, def,
      x, z, prevX: x, prevZ: z, rot, prevRot: rot,
      hp: def.hp, maxHp: def.hp, speed: def.speed, radius: def.radius, sight: def.sight,
      order: { type: 'idle' }, moving: false, path: null,
      anim: { state: 'idle', t: this.game.rng.range(0, 10), want: null, attackT: 1, dieT: 0 },
      carry: { type: null, amount: 0 },
      attackCd: 0, flashT: 0,
    });
  }

  // ---- simulation -------------------------------------------------------
  update(dt) {
    const game = this.game;
    for (const u of [...game.entities.units()]) {
      const a = u.anim;
      a.t += dt;
      if (u.flashT > 0) u.flashT = Math.max(0, u.flashT - dt);
      a.attackT = (a.attackT ?? 1) + dt;
      if (u.dead) {
        a.state = 'die';
        a.dieT += dt;
        if (a.dieT > CORPSE_TIME) game.entities.remove(u);
        continue;
      }
      a.state = u.moving ? 'walk' : a.want || 'idle';
      a.want = null;
    }
  }

  // ---- rendering --------------------------------------------------------
  render(dt, alpha) {
    const game = this.game;
    const fog = game.fog;
    // bucket visible units per rig
    const buckets = new Map();
    for (const u of game.entities.units()) {
      if (u.owner !== game.localPlayer && !fog.isVisible(u.x, u.z)) continue;
      let b = buckets.get(u.type);
      if (!b) buckets.set(u.type, (b = []));
      b.push(u);
    }
    for (const [type, rig] of this.rigs) {
      const list = buckets.get(type) || [];
      for (const p of rig.parts) {
        this._ensureCapacity(p, list.length);
        p.mesh.count = list.length;
      }
      if (!list.length) continue;
      const V = rig.voxel;
      const world = rig.world;
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        const x = u.prevX + (u.x - u.prevX) * alpha;
        const z = u.prevZ + (u.z - u.prevZ) * alpha;
        let dr = u.rot - (u.prevRot ?? u.rot);
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        const rot = (u.prevRot ?? u.rot) + dr * alpha;
        const { bob } = pose(rig.kind, u, rig.rot);
        let y = game.map.heightAt(x, z);
        // root transform (with death topple + sink)
        this._q.setFromEuler(this._e.set(0, rot, 0));
        this._root.compose(this._v.set(x, y + bob * V, z), this._q, this._s.set(1, 1, 1));
        if (u.dead) {
          const k = Math.min(1, u.anim.dieT / 0.6);
          const sink = Math.max(0, u.anim.dieT - CORPSE_TIME + 2) * 0.5;
          this._tmp.makeRotationX(-k * Math.PI / 2 * 0.95);
          this._root.multiply(this._tmp);
          this._root.premultiply(this._tmp.makeTranslation(0, -sink, 0));
        }
        const pc = game.players[u.owner].color;
        this._c.setHex(pc);
        const flash = Math.min(1, u.flashT * 4) * 0.8;
        for (let pi = 0; pi < rig.parts.length; pi++) {
          const p = rig.parts[pi];
          const parent = p.parentIdx >= 0 ? world[p.parentIdx] : this._root;
          const r = rig.rot[p.name];
          this._q.setFromEuler(this._e.set(r[0], r[1], r[2]));
          let sc = 1;
          if (p.name === 'carry') sc = u.carry && u.carry.amount > 0 ? 1 : 0;
          this._m.compose(this._v.set(p.joint[0] * V, p.joint[1] * V, p.joint[2] * V), this._q, this._s.set(sc, sc, sc));
          const m = world[pi].multiplyMatrices(parent, this._m);
          p.mesh.setMatrixAt(i, m);
          p.mesh.userData.team.setXYZ(i, this._c.r, this._c.g, this._c.b);
          p.mesh.userData.flash.setX(i, flash);
          if (p.name === 'carry') {
            const ct = u.carry?.type;
            const col = ct === 'gold' ? [2.2, 1.7, 0.3] : ct === 'food' ? [1.9, 0.6, 0.5] : [1, 1, 1];
            p.mesh.setColorAt(i, this._c.setRGB(col[0], col[1], col[2]));
            this._c.setHex(pc);
          }
        }
      }
      for (const p of rig.parts) {
        p.mesh.instanceMatrix.needsUpdate = true;
        p.mesh.userData.team.needsUpdate = true;
        p.mesh.userData.flash.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // Unit height in world units (for health bars etc.)
  heightOf(u) {
    return { villager: 1.7, hoplite: 1.9, toxotes: 1.7, hippikon: 2.3, minotaur: 3.0 }[u.type] ?? 1.8;
  }

  portraitObject(type, owner = 1) {
    const rig = this.rigs.get(type);
    const g = new THREE.Group();
    const mat = voxelMaterialFor(this.game.players[owner].color, { fog: false });
    const world = new Map();
    const V = rig.voxel;
    for (const p of rig.parts) {
      if (p.name === 'carry') continue;
      const m = new THREE.Matrix4().makeTranslation(p.joint[0] * V, p.joint[1] * V, p.joint[2] * V);
      if (p.parent) m.premultiply(world.get(p.parent));
      world.set(p.name, m);
      const mesh = new THREE.Mesh(p.geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      g.add(mesh);
    }
    return g;
  }
}

export { UNIT_DEFS };
