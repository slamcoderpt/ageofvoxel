import * as THREE from 'three';
import { buildVoxelGeometry, makeVoxelMaterial } from '../core/voxel.js';

// Immediate-mode instanced renderer for economy props. Each frame the economy
// calls begin(), then draw(key, ...) for every visible prop, then end().
// Geometry is built lazily per key from a factory registered with define().
export class EconomyRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'economy';
    game.scene.add(this.group);
    this.material = makeVoxelMaterial({ instanced: true });
    this.batches = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  // factory() -> { model, size, pivot }
  define(key, factory, { shadow = true } = {}) {
    this.batches.set(key, { factory, geo: null, mesh: null, cap: 0, n: 0, shadow });
  }

  _ensure(b, n) {
    if (!b.geo) {
      const { model, size, pivot } = b.factory();
      b.geo = buildVoxelGeometry(model, { size, pivot, jitter: 0.06 });
    }
    if (b.mesh && b.cap >= n) return;
    const cap = Math.max(32, b.cap * 2, n);
    if (b.mesh) { this.group.remove(b.mesh); b.mesh.dispose(); }
    const g = new THREE.BufferGeometry();
    for (const k in b.geo.attributes) g.setAttribute(k, b.geo.attributes[k]);
    g.setIndex(b.geo.index);
    g.boundingSphere = b.geo.boundingSphere;
    const team = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    const flash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    team.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('instTeam', team);
    g.setAttribute('instFlash', flash);
    const mesh = new THREE.InstancedMesh(g, this.material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.team = team;
    b.mesh = mesh;
    b.cap = cap;
    this.group.add(mesh);
  }

  begin() { for (const b of this.batches.values()) b.n = 0; }

  draw(key, x, y, z, rotY = 0, o = null) {
    const b = this.batches.get(key);
    if (!b) return;
    this._ensure(b, b.n + 1);
    const s = o?.scale ?? 1;
    this._q.setFromEuler(this._e.set(o?.pitch ?? 0, rotY, o?.roll ?? 0));
    this._m.compose(this._v.set(x, y, z), this._q, this._s.set(o?.sx ?? s, o?.sy ?? s, o?.sz ?? s));
    b.mesh.setMatrixAt(b.n, this._m);
    if (o?.team !== undefined) this._c.setHex(o.team); else this._c.setRGB(1, 1, 1);
    b.mesh.userData.team.setXYZ(b.n, this._c.r, this._c.g, this._c.b);
    const t = o?.tint ?? 1;
    b.mesh.instanceColor.setXYZ(b.n, t, t * (o?.tintG ?? 1), t * (o?.tintB ?? 1));
    b.n++;
  }

  // Draw with an explicit matrix (for props that need custom transforms).
  drawMatrix(key, m, team = 0xffffff) {
    const b = this.batches.get(key);
    if (!b) return;
    this._ensure(b, b.n + 1);
    b.mesh.setMatrixAt(b.n, m);
    this._c.setHex(team);
    b.mesh.userData.team.setXYZ(b.n, this._c.r, this._c.g, this._c.b);
    b.mesh.instanceColor.setXYZ(b.n, 1, 1, 1);
    b.n++;
  }

  end() {
    for (const b of this.batches.values()) {
      if (!b.mesh) continue;
      b.mesh.count = b.n;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor.needsUpdate = true;
      b.mesh.userData.team.needsUpdate = true;
    }
  }
}
