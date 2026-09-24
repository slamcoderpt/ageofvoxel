import * as THREE from 'three';
import { VOXEL } from '../core/constants.js';
import { GROUND } from '../core/GameMap.js';
import { hash2, makeNoise2D } from '../core/rng.js';
import { buildVoxelGeometry, voxelMaterialFor } from '../core/voxel.js';
import { makeGrassTuft, makeFlowers, makePebbles, DETAIL_VOXEL } from './models.js';

// Scattered ground detail: grass tufts (denser in lush hollows and around
// trees), flower patches in clusters, pebbles on dirt / rock / sand. Instanced
// per terrain chunk and per model; rebuilt lazily (on the next render) when
// the terrain chunk under it changes, so buildings flattening the ground clear
// their footprint.
const TUFTS = 5, FLOWERS = 4, PEBBLES = 3;

export class GroundDetails {
  constructor(game, terrainMesh) {
    this.game = game;
    this.map = game.map;
    this.tm = terrainMesh;
    this.noise = makeNoise2D(this.map.seed * 5 + 91);
    this.group = new THREE.Group();
    this.group.name = 'ground-details';
    this.material = voxelMaterialFor(0xffffff);
    this.geos = [];
    for (let i = 0; i < TUFTS; i++) this.geos.push(this._geo(makeGrassTuft(i), 1));
    for (let i = 0; i < FLOWERS; i++) this.geos.push(this._geo(makeFlowers(i), 2));
    for (let i = 0; i < PEBBLES; i++) this.geos.push(this._geo(makePebbles(i), 3));
    this.chunks = new Map(); // chunk index -> [meshes]
    this.dirty = new Set();
    const n = terrainMesh.nChunks;
    for (let i = 0; i < n * n; i++) this.dirty.add(i);
    terrainMesh.onChunkRebuilt = (chx, chz) => this.dirty.add(chz * n + chx);
  }

  _geo(model, seed) { return buildVoxelGeometry(model, { size: DETAIL_VOXEL, pivot: [0, 0, 0], jitter: 0.08, seed }); }

  render() {
    if (!this.dirty.size) return;
    for (const i of this.dirty) this._build(i);
    this.dirty.clear();
  }

  _treeAt(tx, tz) {
    const id = this.map.blockers.get(this.map.tIdx(tx, tz));
    const e = id !== undefined ? this.game.entities.get(id) : null;
    return !!e && e.type === 'tree';
  }

  _build(ci) {
    const old = this.chunks.get(ci);
    if (old) for (const m of old) { this.group.remove(m); m.dispose(); }
    this.chunks.delete(ci);
    const map = this.map, C = map.cols, W = map.waterLevel, cps = map.cps;
    const n = this.tm.nChunks, CH = this.tm.chunkSize;
    const chx = ci % n, chz = Math.floor(ci / n);
    const x0 = chx * CH, z0 = chz * CH, x1 = Math.min(C, x0 + CH), z1 = Math.min(C, z0 + CH);
    const lists = this.geos.map(() => []);
    const N = this.noise;
    for (let cz = z0; cz < z1; cz++)
      for (let cx = x0; cx < x1; cx++) {
        const i = cz * C + cx;
        const l = map.heights[i];
        if (l <= W) continue;
        const g = map.ground[i];
        const tx = Math.floor(cx / cps), tz = Math.floor(cz / cps);
        const blocked = map.blocked[map.tIdx(tx, tz)] > 0;
        const tree = blocked && this._treeAt(tx, tz);
        if (blocked && !tree) continue;
        // keep off cliff lips: all four neighbours must be the same height
        let flat = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.level(cx + dx, cz + dz) !== l) { flat = false; break; }
        const h = hash2(cx, cz, 401), h2 = hash2(cx, cz, 402);
        let pick = -1;
        if (g === GROUND.GRASS || g === GROUND.DRYGRASS) {
          // tufts gather in clumps (noise), thicker in lush hollows and under trees
          const lush = N.fbm(cx * 0.08 + 7, cz * 0.08 + 61, 2);
          const clump = N.fbm(cx * 0.22 + 31, cz * 0.22 + 17, 2);
          let p = Math.max(0, clump - 0.42) * 1.8 + Math.max(0, 0.5 - lush) * 0.6 + (tree ? 0.3 : 0) + 0.03;
          const fl = N.fbm(cx * 0.05 + 200, cz * 0.05 + 30, 3);
          if (!tree && fl > 0.58 && h2 < (fl - 0.58) * 1.8) {
            const kind = Math.floor(N.noise(cx * 0.02 + 5, cz * 0.02 + 9) * FLOWERS * 1.999) % FLOWERS;
            pick = TUFTS + kind;
          } else if (h < p) {
            pick = g === GROUND.DRYGRASS && h2 < 0.5 ? 3 + Math.floor(h2 * 8) % 2 : Math.floor(h2 * 3);
          } else if (h > 0.996) pick = TUFTS + FLOWERS + Math.floor(h2 * PEBBLES);
        } else if (g === GROUND.DIRT || g === GROUND.ROCK || g === GROUND.SAND) {
          if (h < (g === GROUND.SAND ? 0.012 : 0.035)) pick = TUFTS + FLOWERS + Math.floor(h2 * PEBBLES);
          else if (g === GROUND.DIRT && h > 0.94) pick = 3 + Math.floor(h2 * 2);
        }
        if (pick < 0 || (!flat && pick < TUFTS + FLOWERS && h2 > 0.5)) continue;
        lists[pick].push(cx, cz, l);
      }
    const meshes = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (let k = 0; k < lists.length; k++) {
      const L = lists[k];
      if (!L.length) continue;
      const cnt = L.length / 3;
      const mesh = new THREE.InstancedMesh(this.geos[k], this.material, cnt);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.userData.noAO = false;
      for (let j = 0; j < cnt; j++) {
        const cx = L[j * 3], cz = L[j * 3 + 1], l = L[j * 3 + 2];
        const a = hash2(cx, cz, 403), b = hash2(cx, cz, 404), c = hash2(cx, cz, 405);
        q.setFromAxisAngle(up, a * Math.PI * 2);
        const sc = 0.75 + b * 0.6;
        s.set(sc, sc * (0.85 + c * 0.4), sc);
        p.set((cx + 0.3 + a * 0.4) * VOXEL, l * VOXEL, (cz + 0.3 + c * 0.4) * VOXEL);
        m4.compose(p, q, s);
        mesh.setMatrixAt(j, m4);
        const t = 0.88 + b * 0.22;
        col.setRGB(t, t, t * 0.96);
        mesh.setColorAt(j, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
      meshes.push(mesh);
    }
    this.chunks.set(ci, meshes);
  }
}
