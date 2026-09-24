import * as THREE from 'three';
import { VOXEL } from '../core/constants.js';
import { makeNoise2D, hash2 } from '../core/rng.js';
import { applyFogOfWar } from '../core/FogOfWar.js';
import { topColor, sideColor, seabedColor } from './palette.js';
import { GROUND } from '../core/GameMap.js';

const CH = 32; // columns per chunk side
const AO = [0.55, 0.72, 0.87, 1.0];
const toLin = (c) => Math.pow(c, 2.2);

// Chunked heightfield voxel mesh. Only exposed faces are emitted; top faces
// get per-vertex AO from neighbouring columns, cliff sides get per-voxel
// strata colours.
//
// Columns at or below the water line ("shore" columns, level <= waterLevel)
// are not stepped: their tops form one smooth sloping surface whose corner
// heights are a 4x4 average of the neighbouring shore columns. That turns the
// seabed and the wet beach into a continuous slope instead of stairs seen
// through the water. Land columns next to them extend their cliff sides a few
// levels further down so no gaps open under the smoothed surface.
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
    this.onChunkRebuilt = null; // (chx, chz, CH) -> void, used by ground details
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.rebuildDirty();
  }

  get chunkSize() { return CH; }

  // Shore columns: underwater, at the water line, or low beach sand.
  isShore(cx, cz) {
    const map = this.map, C = map.cols;
    if (cx < 0 || cz < 0 || cx >= C || cz >= C) return false;
    const i = cz * C + cx, l = map.heights[i];
    return l <= map.waterLevel || (l <= map.waterLevel + 2 && map.ground[i] === GROUND.SAND);
  }

  // Smoothed level (in voxel levels, float) at column corner (ix, iz), which is
  // the corner shared by columns (ix-1..ix, iz-1..iz). Only meaningful next to
  // shore columns.
  cornerLevel(ix, iz) {
    const map = this.map, W = map.waterLevel, C = map.cols;
    const shoreL = (x, z) => {
      x = Math.max(0, Math.min(C - 1, x)); z = Math.max(0, Math.min(C - 1, z));
      const i = z * C + x, l = map.heights[i];
      return l <= W || (l <= W + 2 && map.ground[i] === GROUND.SAND) ? l : null;
    };
    // 4x4 tent-weighted average; land columns in the kernel count as the
    // highest nearby shore level so the beach meets the land edge evenly
    let s = 0, n = 0, localMax = -1e9;
    const ls = [];
    for (let dz = -2; dz <= 1; dz++)
      for (let dx = -2; dx <= 1; dx++) {
        const l = shoreL(ix + dx, iz + dz);
        if (l !== null) localMax = Math.max(localMax, l);
        ls.push(l);
      }
    if (localMax === -1e9) return W;
    let q = 0;
    for (let dz = -2; dz <= 1; dz++)
      for (let dx = -2; dx <= 1; dx++) {
        let l = ls[q++];
        if (l === null) {
          const x = Math.max(0, Math.min(C - 1, ix + dx)), z = Math.max(0, Math.min(C - 1, iz + dz));
          l = Math.min(map.heights[z * C + x], localMax);
        }
        const w = (dx === -1 || dx === 0 ? 2 : 1) * (dz === -1 || dz === 0 ? 2 : 1);
        s += l * w; n += w;
      }
    let h = n ? s / n : W;
    // never rise above a touching land column (its side skirt hides anything lower)
    for (let dz = -1; dz <= 0; dz++)
      for (let dx = -1; dx <= 0; dx++) {
        const x = Math.max(0, Math.min(C - 1, ix + dx)), z = Math.max(0, Math.min(C - 1, iz + dz));
        if (shoreL(x, z) === null) h = Math.min(h, map.heights[z * C + x]);
      }
    return h;
  }

  // Smoothed column-centre depth below the water surface in world units
  // (<= 0 above water). Used to bake the water depth texture.
  surfaceY(cx, cz) {
    if (!this.isShore(cx, cz)) return this.map.level(cx, cz) * VOXEL;
    return (this.cornerLevel(cx, cz) + this.cornerLevel(cx + 1, cz) + this.cornerLevel(cx, cz + 1) + this.cornerLevel(cx + 1, cz + 1)) * 0.25 * VOXEL;
  }

  markDirtyCols(cx0, cz0, cx1, cz1) {
    for (let cz = Math.floor((cz0 - 3) / CH); cz <= Math.floor((cz1 + 3) / CH); cz++)
      for (let cx = Math.floor((cx0 - 3) / CH); cx <= Math.floor((cx1 + 3) / CH); cx++)
        if (cx >= 0 && cz >= 0 && cx < this.nChunks && cz < this.nChunks) this.dirty.add(cz * this.nChunks + cx);
  }

  rebuildDirty() {
    for (const i of this.dirty) {
      const old = this.chunks[i];
      if (old) { this.group.remove(old); old.geometry.dispose(); }
      const chx = i % this.nChunks, chz = Math.floor(i / this.nChunks);
      const mesh = this.buildChunk(chx, chz);
      this.chunks[i] = mesh;
      if (mesh) this.group.add(mesh);
      if (this.onChunkRebuilt) this.onChunkRebuilt(chx, chz, CH);
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
        const nk = Array.isArray(n[0]) ? n[k] : n;
        nor.push(nk[0], nk[1], nk[2]);
        const a = ao ? AO[ao[k]] : 1;
        const ck = Array.isArray(c[0]) ? c[k] : c;
        col.push(toLin(ck[0]) * a, toLin(ck[1]) * a, toLin(ck[2]) * a);
      }
      if (ao && ao[0] + ao[2] < ao[1] + ao[3]) idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
      else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const x0 = chx * CH, z0 = chz * CH;
    const x1 = Math.min(C, x0 + CH), z1 = Math.min(C, z0 + CH);

    // smoothed corner levels for this chunk (+2 margin for normals)
    const CW = CH + 5, cOff = 2;
    const corner = new Float32Array(CW * CW);
    for (let j = 0; j < CW; j++)
      for (let i = 0; i < CW; i++) corner[j * CW + i] = this.cornerLevel(x0 - cOff + i, z0 - cOff + j);
    const CL = (ix, iz) => corner[(iz - z0 + cOff) * CW + (ix - x0 + cOff)];
    const cornerNormal = (ix, iz) => {
      const gx = (CL(ix + 1, iz) - CL(ix - 1, iz)) * 0.5, gz = (CL(ix, iz + 1) - CL(ix, iz - 1)) * 0.5;
      const len = Math.hypot(gx, 1, gz);
      return [-gx / len, 1 / len, -gz / len];
    };
    const surf = W - 0.3; // water surface in levels

    for (let cz = z0; cz < z1; cz++)
      for (let cx = x0; cx < x1; cx++) {
        const l = L(cx, cz);
        const g = map.ground[cz * C + cx];
        const y = l * VOXEL;
        const X = cx * VOXEL, Z = cz * VOXEL, V = VOXEL;
        const occ = (dx, dz) => (L(cx + dx, cz + dz) > l ? 1 : 0);
        const cornerAO = (sx, sz) => {
          const s1 = occ(sx, 0), s2 = occ(0, sz), cr = occ(sx, sz);
          return s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
        };
        const ao = [cornerAO(-1, 1), cornerAO(1, 1), cornerAO(1, -1), cornerAO(-1, -1)];

        if (this.isShore(cx, cz)) {
          // --- smooth shore / seabed column ---
          const cs = [[cx, cz + 1], [cx + 1, cz + 1], [cx + 1, cz], [cx, cz]];
          const hs = cs.map(([ix, iz]) => CL(ix, iz));
          const cols = cs.map(([ix, iz], k) => {
            const top = topColor(g, ix, iz, l, this.noise);
            const d = surf - hs[k];
            const sb = seabedColor(ix, iz, d, this.noise);
            // blend from dry ground to wet sand to seabed around the water line
            const t = Math.min(1, Math.max(0, (d + 0.25) / 0.55));
            return [top[0] + (sb[0] - top[0]) * t, top[1] + (sb[1] - top[1]) * t, top[2] + (sb[2] - top[2]) * t];
          });
          const useAO = l >= W ? ao : null;
          quad(cs.map(([ix, iz], k) => [ix * V, hs[k] * V, iz * V]), cs.map(([ix, iz]) => cornerNormal(ix, iz)), cols, useAO);
          // skirts where the smooth surface meets lower stepped columns or the map rim
          const edges = [
            [1, 0, [1, 0, 0], 2, 1, X + V, Z, X + V, Z + V],
            [-1, 0, [-1, 0, 0], 0, 3, X, Z + V, X, Z],
            [0, 1, [0, 0, 1], 1, 0, X + V, Z + V, X, Z + V],
            [0, -1, [0, 0, -1], 3, 2, X, Z, X + V, Z],
          ];
          for (const [dx, dz, n, ka, kb, ax, az, bx, bz] of edges) {
            const nx = cx + dx, nz = cz + dz;
            if (this.isShore(nx, nz)) continue;
            const nl = L(nx, nz);
            const ya = hs[ka] * V, yb = hs[kb] * V, yl = nl * V;
            if (Math.max(ya, yb) <= yl) continue;
            const sc = nl < 0 ? seabedColor(cx, cz, 3, this.noise) : sideColor(GROUND.SAND, 0, cx, l, cz);
            quad([[ax, Math.min(yl, ya), az], [ax, ya, az], [bx, yb, bz], [bx, Math.min(yl, yb), bz]], n, sc, null);
          }
          continue;
        }

        // --- regular stepped land column ---
        // colours are sampled at the four corners so neighbouring columns of
        // the same ground blend smoothly (no per-column checkerboard); paved
        // slabs and farm furrows keep their crisp per-column pattern
        const crisp = g === GROUND.PAVED || g === GROUND.FARM;
        const colJit = 1 + (hash2(cx, cz, 57) - 0.5) * 0.07; // faint voxel grain
        const c = crisp ? topColor(g, cx, cz, l, this.noise)
          : [[cx, cz + 1], [cx + 1, cz + 1], [cx + 1, cz], [cx, cz]].map(([ix, iz]) => {
            const t = topColor(g, ix, iz, l, this.noise), k = colJit;
            return [t[0] * k, t[1] * k, t[2] * k];
          });
        // vertex order: (0,1)->(1,1)->(1,0)->(0,0) in (x,z), normal +y
        quad([[X, y, Z + V], [X + V, y, Z + V], [X + V, y, Z], [X, y, Z]], [0, 1, 0], c, ao);
        const sides = [
          [1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]],
        ];
        for (const [dx, dz, n] of sides) {
          const nl = L(cx + dx, cz + dz);
          const shoreN = this.isShore(cx + dx, cz + dz);
          if (nl >= l && !shoreN) continue;
          // skirt under the smoothed shore surface (mostly hidden, prevents cracks)
          const bottom = shoreN ? Math.min(nl, l) - 4 : nl;
          for (let k = l - 1; k >= bottom; k--) {
            const depth = l - 1 - k;
            const yy = k * VOXEL;
            let sc = k < W - 1 ? seabedColor(cx, cz, surf - k, this.noise) : sideColor(g, shoreN ? Math.min(depth, 1) : depth, cx, k, cz);
            // darken the lowest voxel row (contact shadow) and brighten the lip
            const shade = k === nl && !shoreN ? 0.78 : depth === 0 ? 1.05 : 1.0;
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

export { GROUND };
