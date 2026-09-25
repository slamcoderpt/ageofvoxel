import * as THREE from 'three';
import { VoxelModel, buildVoxelGeometry, makeVoxelMaterial } from '../core/voxel.js';

// Ballistic projectiles (arrows). Simulated in the fixed tick; damage is
// applied on arrival if the target is still alive. Each arrow drags a faint
// streak so volleys read from RTS distance; arrows whose target died stick in
// the ground for a while.
const MAX = 2048;
const STUCK_TIME = 9;

export class Projectiles {
  constructor(game, combat) {
    this.game = game;
    this.combat = combat;
    this.list = [];
    this.stuck = [];
    const m = new VoxelModel().box(0, 0, 0, 1, 1, 7, 0x7a5230).set(0, 0, 7, 0xb8bec4).set(0, 0, 8, 0xb8bec4)
      .box(0, 0, 0, 1, 1, 2, 0xf0ece0).set(-1, 0, 0, 0xf0ece0).set(1, 0, 0, 0xf0ece0);
    const geo = buildVoxelGeometry(m, { size: 0.08, pivot: [0.5, 0.5, 4], ao: false });
    const mat = makeVoxelMaterial({ instanced: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);

    // --- streaks (camera-facing ribbons from tail to head)
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    this.aHead = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aTail = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aHead', this.aHead);
    g.setAttribute('aTail', this.aTail);
    g.instanceCount = 0;
    this.trails = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 aHead; attribute vec3 aTail; varying vec2 vUv;
        void main(){
          float along = position.x + 0.5;
          vec3 p = mix(aTail, aHead, along);
          vec3 dir = aHead - aTail;
          vec3 side = normalize(cross(dir + vec3(1e-4), cameraPosition - p));
          p += side * position.y * mix(0.015, 0.075, along);
          vUv = vec2(along, position.y * 2.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        void main(){
          float a = pow(vUv.x, 1.6) * (1.0 - abs(vUv.y)) * 0.55;
          gl_FragColor = vec4(vec3(1.0, 0.96, 0.86) * 1.4, a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 15;
    this.trails.userData.noAO = true;
    game.scene.add(this.trails);

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._z = new THREE.Vector3(0, 0, 1);
  }

  fire(attacker, target, damage, { fromY = 1.4 } = {}) {
    const map = this.game.map;
    const sx = attacker.x, sz = attacker.z;
    const sy = map.heightAt(sx, sz) + fromY;
    const dist = Math.hypot(target.x - sx, target.z - sz);
    this.list.push({
      sx, sy, sz, x: sx, y: sy, z: sz, px: sx, py: sy, pz: sz,
      targetId: target.id, attackerId: attacker.id, owner: attacker.owner, damage,
      t: 0, dur: 0.4 + dist * 0.065, arc: 0.6 + dist * 0.16,
    });
  }

  posAt(p, k, out) {
    out.x = p.sx + (p.tx - p.sx) * k;
    out.z = p.sz + (p.tz - p.sz) * k;
    out.y = p.sy + (p.ty - p.sy) * k + Math.sin(k * Math.PI) * p.arc;
    return out;
  }

  update(dt) {
    const game = this.game;
    const out = [];
    for (const p of this.list) {
      p.t += dt;
      const tgt = game.entities.get(p.targetId);
      if (tgt && !tgt.dead) {
        p.tx = tgt.x; p.tz = tgt.z;
        p.ty = game.map.heightAt(tgt.x, tgt.z) + (tgt.kind === 'building' ? 1.5 : 1.0);
      } else if (p.tx !== undefined && !p.lost) {
        // target died mid-flight: the arrow falls to the ground where it was
        p.lost = true;
        p.ty = game.map.heightAt(p.tx, p.tz) + 0.15;
      }
      if (p.tx === undefined) continue;
      const k = Math.min(1, p.t / p.dur);
      p.px = p.x; p.py = p.y; p.pz = p.z;
      this.posAt(p, k, p);
      if (k >= 1) {
        if (tgt && !tgt.dead) this.combat.damage(tgt, p.damage, game.entities.get(p.attackerId) || { owner: p.owner }, 'arrow');
        else if (this.stuck.length < 400) this.stuck.push({ x: p.x, y: p.y, z: p.z, dx: p.x - p.px, dy: p.y - p.py, dz: p.z - p.pz, t: 0 });
        continue;
      }
      out.push(p);
    }
    this.list = out;
    if (this.stuck.length) {
      for (const s of this.stuck) s.t += dt;
      if (this.stuck[0].t > STUCK_TIME) this.stuck = this.stuck.filter((s) => s.t <= STUCK_TIME);
    }
  }

  render() {
    const n = Math.min(this.list.length, MAX);
    const tail = { x: 0, y: 0, z: 0 };
    let t = 0;
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      this._d.set(p.x - p.px, p.y - p.py, p.z - p.pz);
      if (this._d.lengthSq() < 1e-8) this._d.set(0, 0, 1);
      this._q.setFromUnitVectors(this._z, this._d.normalize());
      this._m.compose(this._v.set(p.x, p.y, p.z), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      if (p.tx !== undefined) {
        const k = Math.min(1, p.t / p.dur);
        this.posAt(p, Math.max(0, k - 0.16), tail);
        this.aHead.setXYZ(t, p.x - this._d.x * 0.3, p.y - this._d.y * 0.3, p.z - this._d.z * 0.3);
        this.aTail.setXYZ(t, tail.x, tail.y, tail.z);
        t++;
      }
    }
    let m = n;
    for (const s of this.stuck) {
      if (m >= MAX) break;
      this._d.set(s.dx, s.dy, s.dz);
      if (this._d.lengthSq() < 1e-8) this._d.set(0, -1, 0);
      this._q.setFromUnitVectors(this._z, this._d.normalize());
      const sink = Math.max(0, s.t - STUCK_TIME + 1.5) * 0.3;
      this._m.compose(this._v.set(s.x + this._d.x * 0.2, s.y + this._d.y * 0.2 - sink, s.z + this._d.z * 0.2), this._q, this._s);
      this.mesh.setMatrixAt(m++, this._m);
    }
    this.mesh.count = m;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.trails.geometry.instanceCount = t;
    this.aHead.needsUpdate = this.aTail.needsUpdate = true;
  }
}
