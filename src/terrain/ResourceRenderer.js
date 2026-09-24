import * as THREE from 'three';
import { buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { hash2 } from '../core/rng.js';
import { makeTree, makeGoldMine, makeBerryBush, PROP_VOXEL } from './models.js';

const CHUNK = 16; // tiles per instancing bucket (keeps frustum culling useful)

// Instanced rendering for resource props (trees, gold mines, berry bushes).
// Buckets instances by (model, map chunk) and rebuilds a bucket when an
// entity in it is added/removed.
export class ResourceRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'resources';
    this.material = voxelMaterialFor(0xffffff);
    this.geos = new Map();
    this.buckets = new Map(); // key -> { ents: Set, mesh, dirty }
    game.events.on('entity:added', (e) => { if (e.kind === 'resource') this._touch(e, true); });
    game.events.on('entity:removed', (e) => { if (e.kind === 'resource') this._touch(e, false); });
  }

  modelKey(e) { return e.type === 'tree' ? `tree${e.variant % 10}` : e.type; }

  geometry(key) {
    if (!this.geos.has(key)) {
      let m, pivot;
      if (key.startsWith('tree')) { m = makeTree(+key.slice(4)); pivot = [1, 0, 1]; }
      else if (key === 'gold') { m = makeGoldMine(); pivot = [8, 0, 8]; }
      else { m = makeBerryBush(); pivot = [2.5, 0, 2.5]; }
      this.geos.set(key, buildVoxelGeometry(m, { size: PROP_VOXEL, pivot, jitter: 0.1 }));
    }
    return this.geos.get(key);
  }

  _touch(e, add) {
    const k = `${this.modelKey(e)}|${Math.floor(e.tx / CHUNK)}|${Math.floor(e.tz / CHUNK)}`;
    let b = this.buckets.get(k);
    if (!b) { b = { key: this.modelKey(e), ents: new Set(), mesh: null, dirty: true }; this.buckets.set(k, b); }
    if (add) b.ents.add(e); else b.ents.delete(e);
    b.dirty = true;
  }

  render() {
    const map = this.game.map;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of this.buckets.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      if (b.mesh) { this.group.remove(b.mesh); b.mesh.dispose(); b.mesh = null; }
      if (!b.ents.size) continue;
      const mesh = new THREE.InstancedMesh(this.geometry(b.key), this.material, b.ents.size);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let i = 0;
      for (const e of b.ents) {
        const h = hash2(e.tx, e.tz, 77);
        const rot = e.type === 'gold' ? 0 : Math.floor(h * 4) * Math.PI / 2;
        const sc = e.type === 'tree' ? 0.85 + hash2(e.tx, e.tz, 5) * 0.35 : 1;
        q.setFromAxisAngle(up, rot);
        s.set(sc, sc * (0.9 + hash2(e.tx, e.tz, 9) * 0.2), sc);
        p.set(e.x, map.heightAt(e.x, e.z) - 0.05, e.z);
        m4.compose(p, q, s);
        mesh.setMatrixAt(i, m4);
        const t = e.type === 'tree' ? 0.88 + hash2(e.tx, e.tz, 13) * 0.24 : 1;
        col.setRGB(t, t * (0.97 + hash2(e.tx, e.tz, 3) * 0.06), t * 0.95);
        mesh.setColorAt(i, col);
        i++;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      b.mesh = mesh;
      this.group.add(mesh);
    }
  }
}
