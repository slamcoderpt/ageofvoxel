import * as THREE from 'three';
import { VOXEL } from '../core/constants.js';
import { makeNoise2D } from '../core/rng.js';
import { applyFogOfWar } from '../core/FogOfWar.js';
import { topColor, sideColor, UNDERWATER } from './palette.js';
import { GROUND } from '../core/GameMap.js';

const CH = 32; // columns per chunk side
const AO = [0.55, 0.72, 0.87, 1.0];
const toLin = (c) => Math.pow(c, 2.2);

// Chunked heightfield voxel mesh. Only exposed faces are emitted; top faces
// get per-vertex AO from neighbouring columns, cliff sides get per-voxel
// strata colours.
export class TerrainMesh {
  constructor(game) {
    this.game = game;
    this.map = game.map;
    this.noise = makeNoise2D(this.map.seed * 3 + 17);
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    applyFogOfWar(this.material);
    this.nChunks = Math.ceil(this.map.cols / CH);
    this.chunks = new Array(this.nChunks * this.nChunks).fill(null);
    this.dirty = new Set();
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.rebuildDirty();
  }

  markDirtyCols(cx0, cz0, cx1, cz1) {
    for (let cz = Math.floor((cz0 - 1) / CH); cz <= Math.floor((cz1 + 1) / CH); cz++)
      for (let cx = Math.floor((cx0 - 1) / CH); cx <= Math.floor((cx1 + 1) / CH); cx++)
        if (cx >= 0 && cz >= 0 && cx < this.nChunks && cz < this.nChunks) this.dirty.add(cz * this.nChunks + cx);
  }

  rebuildDirty() {
    for (const i of this.dirty) {
      const old = this.chunks[i];
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      const mesh = this.buildChunk(i % this.nChunks, Math.floor(i / this.nChunks));
      this.chunks[i] = mesh;
      if (mesh) this.group.add(mesh);
    }
    this.dirty.clear();
  }

  buildChunk(chx, chz) {
    const map = this.map, C = map.cols, W = map.waterLevel;
    const pos = [], nor = [], col = [], idx = [];
    const L = (x, z) => (x < 0 || z < 0 || x >= C || z >= C ? -4 : map.heights[z * C + x]);
    const quad = (p, n, c, ao) => {
      const b = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        pos.push(p[k][0], p[k][1], p[k][2]);
        nor.push(n[0], n[1], n[2]);
        const a = ao ? AO[ao[k]] : 1;
        const ck = Array.isArray(c[0]) ? c[k] : c;
        col.push(toLin(ck[0]) * a, toLin(ck[1]) * a, toLin(ck[2]) * a);
      }
      if (ao && ao[0] + ao[2] < ao[1] + ao[3]) idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
      else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const x0 = chx * CH, z0 = chz * CH;
    const x1 = Math.min(C, x0 + CH), z1 = Math.min(C, z0 + CH);
    for (let cz = z0; cz < z1; cz++)
      for (let cx = x0; cx < x1; cx++) {
        const l = L(cx, cz);
        const g = map.ground[cz * C + cx];
        const y = l * VOXEL;
        const X = cx * VOXEL, Z = cz * VOXEL, V = VOXEL;
        // top face
        let c = l < W ? underwater(cx, cz, l, W) : topColor(g, cx, cz, l, this.noise);
        const occ = (dx, dz) => (L(cx + dx, cz + dz) > l ? 1 : 0);
        const cornerAO = (sx, sz) => {
          const s1 = occ(sx, 0), s2 = occ(0, sz), cr = occ(sx, sz);
          return s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
        };
        // vertex order: (0,1)->(1,1)->(1,0)->(0,0) in (x,z), normal +y
        const ao = [cornerAO(-1, 1), cornerAO(1, 1), cornerAO(1, -1), cornerAO(-1, -1)];
        quad([[X, y, Z + V], [X + V, y, Z + V], [X + V, y, Z], [X, y, Z]], [0, 1, 0], c, ao);
        // sides
        const sides = [
          [1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]],
        ];
        for (const [dx, dz, n] of sides) {
          const nl = L(cx + dx, cz + dz);
          if (nl >= l) continue;
          for (let k = l - 1; k >= nl; k--) {
            const depth = l - 1 - k;
            const yy = k * VOXEL;
            let sc = k < W - 1 ? underwater(cx, cz, k, W) : sideColor(g, depth, cx, k, cz);
            // darken the lowest voxel row (contact shadow) and brighten the lip
            const shade = k === nl ? 0.78 : depth === 0 ? 1.05 : 1.0;
            sc = [sc[0] * shade, sc[1] * shade, sc[2] * shade];
            let p;
            if (dx === 1) p = [[X + V, yy, Z], [X + V, yy + V, Z], [X + V, yy + V, Z + V], [X + V, yy, Z + V]];
            else if (dx === -1) p = [[X, yy, Z + V], [X, yy + V, Z + V], [X, yy + V, Z], [X, yy, Z]];
            else if (dz === 1) p = [[X + V, yy, Z + V], [X + V, yy + V, Z + V], [X, yy + V, Z + V], [X, yy, Z + V]];
            else p = [[X, yy, Z], [X, yy + V, Z], [X + V, yy + V, Z], [X + V, yy, Z]];
            quad(p, n, sc, null);
          }
        }
      }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = `chunk_${chx}_${chz}`;
    return mesh;
  }
}

function underwater(cx, cz, l, W) {
  const d = W - l;
  const k = Math.max(0.55, 1 - d * 0.08);
  const [a, b] = UNDERWATER;
  const t = ((cx * 31 + cz * 17) % 7) / 7;
  const r = (((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t) / 255;
  const g = (((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t) / 255;
  const bl = ((a & 255) * (1 - t) + (b & 255) * t) / 255;
  return [r * k, g * k, bl * k];
}
export { GROUND };
