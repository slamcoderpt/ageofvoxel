import * as THREE from 'three';
import { VoxelModel, buildVoxelGeometry, makeVoxelMaterial } from '../core/voxel.js';

// Ballistic projectiles (arrows). Simulated in the fixed tick; damage is
// applied on arrival if the target is still alive.
export class Projectiles {
  constructor(game, combat) {
    this.game = game;
    this.combat = combat;
    this.list = [];
    const m = new VoxelModel().box(0, 0, 0, 1, 1, 7, 0x7a5230).set(0, 0, 7, 0xb8bec4).set(0, 0, 8, 0xb8bec4)
      .box(0, 0, 0, 1, 1, 2, 0xf0ece0).set(-1, 0, 0, 0xf0ece0).set(1, 0, 0, 0xf0ece0);
    const geo = buildVoxelGeometry(m, { size: 0.07, pivot: [0.5, 0.5, 4], ao: false });
    const mat = makeVoxelMaterial({ instanced: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, 2048);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
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
      t: 0, dur: 0.35 + dist * 0.06, arc: 0.6 + dist * 0.12,
    });
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
      }
      if (p.tx === undefined) continue;
      const k = Math.min(1, p.t / p.dur);
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.x = p.sx + (p.tx - p.sx) * k;
      p.z = p.sz + (p.tz - p.sz) * k;
      p.y = p.sy + (p.ty - p.sy) * k + Math.sin(k * Math.PI) * p.arc;
      if (k >= 1) {
        if (tgt && !tgt.dead) this.combat.damage(tgt, p.damage, game.entities.get(p.attackerId) || { owner: p.owner });
        continue;
      }
      out.push(p);
    }
    this.list = out;
  }

  render() {
    const n = Math.min(this.list.length, 2048);
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      this._d.set(p.x - p.px, p.y - p.py, p.z - p.pz);
      if (this._d.lengthSq() < 1e-8) this._d.set(0, 0, 1);
      this._q.setFromUnitVectors(this._z, this._d.normalize());
      this._m.compose(this._v.set(p.x, p.y, p.z), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
