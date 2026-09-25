import * as THREE from 'three';
import { VOXEL } from '../core/constants.js';
import { makeNoise2D, hash2 } from '../core/rng.js';
import { applyFogOfWar } from '../core/FogOfWar.js';
import { topColor, sideColor, seabedColor, cliffColor } from './palette.js';
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
    this.shore = new Uint8Array(this.map.cols * this.map.cols); // 1 smooth shore, +2 sand within 3 columns
    this._computeShore(0, 0, this.map.cols - 1, this.map.cols - 1);
    this.onChunkRebuilt = null; // (chx, chz, CH) -> void, used by ground details
    for (let i = 0; i < this.chunks.length; i++) this.dirty.add(i);
    this.rebuildDirty();
  }

  get chunkSize() { return CH; }

  // Shore columns: underwater, at the water line, low beach sand, and low
  // grass within 3 columns of the sand (so the grass rolls down onto the beach
  // instead of ending in a staircase). Cached in a mask, refreshed on change.
  _computeShore(ax, az, bx, bz) {
    const map = this.map, C = map.cols, W = map.waterLevel;
    ax = Math.max(0, ax); az = Math.max(0, az); bx = Math.min(C - 1, bx); bz = Math.min(C - 1, bz);
    for (let cz = az; cz <= bz; cz++)
      for (let cx = ax; cx <= bx; cx++) {
        const i = cz * C + cx, l = map.heights[i], g = map.ground[i];
        let s = l <= W || (l <= W + 2 && g === GROUND.SAND);
        let near = g === GROUND.SAND, nearWide = near;
        for (let dz = -5; dz <= 5 && !nearWide; dz++)
          for (let dx = -5; dx <= 5; dx++) {
            const x = cx + dx, z = cz + dz;
            if (x < 0 || z < 0 || x >= C || z >= C) continue;
            const j = z * C + x;
            if (map.ground[j] === GROUND.SAND && map.heights[j] <= W + 2) {
              nearWide = true;
              if (Math.abs(dx) <= 3 && Math.abs(dz) <= 3) near = true;
              break;
            }
          }
        if (!near && nearWide) {
          for (let dz = -3; dz <= 3 && !near; dz++)
            for (let dx = -3; dx <= 3 && !near; dx++) {
              const x = cx + dx, z = cz + dz;
              if (x >= 0 && z >= 0 && x < C && z < C && map.ground[z * C + x] === GROUND.SAND && map.heights[z * C + x] <= W + 2) near = true;
            }
        }
        if (!s && nearWide && l <= W + 3 && (g === GROUND.GRASS || g === GROUND.DRYGRASS || g === GROUND.DIRT)) s = true;
        this.shore[i] = (s ? 1 : 0) | (near ? 2 : 0);
      }
  }

  isShore(cx, cz) {
    const C = this.map.cols;
    if (cx < 0 || cz < 0 || cx >= C || cz >= C) return false;
    return (this.shore[cz * C + cx] & 1) === 1;
  }

  // Smoothed level (in voxel levels, float) at column corner (ix, iz), which is
  // the corner shared by columns (ix-1..ix, iz-1..iz). Only meaningful next to
  // shore columns.
  cornerLevel(ix, iz) {
    const map = this.map, W = map.waterLevel, C = map.cols;
    const shore = this.shore;
    const shoreL = (x, z) => {
      x = Math.max(0, Math.min(C - 1, x)); z = Math.max(0, Math.min(C - 1, z));
      const i = z * C + x;
      return shore[i] & 1 ? map.heights[i] : null;
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
    this._computeShore(cx0 - 6, cz0 - 6, cx1 + 6, cz1 + 6);
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
    // axis-aligned box (no bottom face): cliff relief, grass overhangs, rubble
    const box = (ax, ay, az, bx, by, bz, c, cTop) => {
      const t = cTop || c;
      quad([[ax, by, bz], [bx, by, bz], [bx, by, az], [ax, by, az]], [0, 1, 0], t, null);
      quad([[bx, ay, az], [bx, by, az], [bx, by, bz], [bx, ay, bz]], [1, 0, 0], c, null);
      quad([[ax, ay, bz], [ax, by, bz], [ax, by, az], [ax, ay, az]], [-1, 0, 0], c, null);
      quad([[bx, ay, bz], [bx, by, bz], [ax, by, bz], [ax, ay, bz]], [0, 0, 1], c, null);
      quad([[ax, ay, az], [ax, by, az], [bx, by, az], [bx, ay, az]], [0, 0, -1], c, null);
    };
    const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    // contact shadow on ground at the foot of tall walls: darkens a corner
    // when a column within 1 (strong) or 2 (soft) columns stands >= 2 levels higher
    const wallShade = (ix, iz, lvl) => {
      let f = 1;
      for (let dz = -2; dz <= 1; dz++)
        for (let dx = -2; dx <= 1; dx++) {
          const rise = L(ix + dx, iz + dz) - lvl;
          if (rise < 2) continue;
          const near = dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0;
          f = Math.min(f, near ? (rise >= 4 ? 0.62 : 0.74) : 0.86);
        }
      return f;
    };
    // talus: in the inner corner of a stepped cliff (higher neighbours on two
    // perpendicular sides) pile a fallen rock mass of uneven height, so a
    // diagonal cliff edge reads as broken rock instead of an even staircase
    const talus = (cx, cz, l, baseY) => {
      const hx = Math.max(L(cx + 1, cz), L(cx - 1, cz)) - l, hz = Math.max(L(cx, cz + 1), L(cx, cz - 1)) - l;
      const rise = Math.min(hx, hz);
      if (rise < 2 || baseY < (W - 0.1) * VOXEL) return;
      const sx = L(cx + 1, cz) > L(cx - 1, cz) ? 1 : -1, sz = L(cx, cz + 1) > L(cx, cz - 1) ? 1 : -1;
      const V = VOXEL, X = cx * V, Z = cz * V;
      const r1 = hash2(cx, cz, 301), r2 = hash2(cx, cz, 302), r3 = hash2(cx, cz, 303);
      const topY = l * V + rise * V * (0.3 + r1 * 0.55);
      const tk = 0.82 + r2 * 0.3;
      const c = [0.6 * tk, 0.56 * tk, 0.5 * tk];
      // main block hugs the corner, second smaller block steps down away from it
      const w1 = V * (0.6 + r2 * 0.4), w2 = V * (0.55 + r3 * 0.45);
      const ax = sx > 0 ? X + V - w1 : X, az = sz > 0 ? Z + V - w2 : Z;
      box(ax, baseY, az, ax + w1, topY, az + w2, mul(c, 0.88), c);
      const h2 = baseY + (topY - baseY) * (0.35 + r3 * 0.3);
      const bx = sx > 0 ? X + V - w1 - 0.18 : X + w1 - 0.04, bz = sz > 0 ? Z + V - w2 * 0.8 : Z + 0.04;
      box(bx, baseY, bz, bx + 0.22, h2, bz + w2 * 0.75, mul(c, 0.8), mul(c, 0.95));
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
          // dry-land colour follows the smoothed height (with a noisy contour),
          // not the per-column ground type, so the grass/sand edge curves
          const soft = (this.shore[cz * C + cx] & 2) && (g === GROUND.SAND || g === GROUND.GRASS || g === GROUND.DRYGRASS || g === GROUND.DIRT);
          const cols = cs.map(([ix, iz], k) => {
            let top;
            if (soft) {
              const edge = W + 0.85 + (this.noise.fbm(ix * 0.11 + 33, iz * 0.11 + 71, 2) - 0.5) * 1.4;
              const gs = Math.min(1, Math.max(0, (hs[k] - edge) / 0.5 + 0.5));
              const sa = topColor(GROUND.SAND, ix, iz, l, this.noise);
              if (gs <= 0) top = sa;
              else {
                const gr = topColor(g === GROUND.SAND ? GROUND.GRASS : g, ix, iz, l, this.noise);
                top = [sa[0] + (gr[0] - sa[0]) * gs, sa[1] + (gr[1] - sa[1]) * gs, sa[2] + (gr[2] - sa[2]) * gs];
              }
            } else top = topColor(g, ix, iz, l, this.noise);
            const d = surf - hs[k];
            const sb = seabedColor(ix, iz, d, this.noise);
            // blend from dry ground to wet sand to seabed around the water line
            const t = Math.min(1, Math.max(0, (d + 0.25) / 0.55));
            const ws = d < 0.3 ? wallShade(ix, iz, Math.floor(hs[k] + 0.5)) : 1;
            return [(top[0] + (sb[0] - top[0]) * t) * ws, (top[1] + (sb[1] - top[1]) * t) * ws, (top[2] + (sb[2] - top[2]) * t) * ws];
          });
          // no stepped AO on the smoothed surface: it would print the underlying
          // staircase as a sawtooth of dark corners (walls still shade via wallShade)
          const useAO = null;
          quad(cs.map(([ix, iz], k) => [ix * V, hs[k] * V, iz * V]), cs.map(([ix, iz]) => cornerNormal(ix, iz)), cols, useAO);
          talus(cx, cz, l, Math.min(...hs) * V - 0.03);
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
        const crisp = g === GROUND.PAVED || g === GROUND.FARM || g === GROUND.ROCK;
        const colJit = 1 + (hash2(cx, cz, 57) - 0.5) * 0.07; // faint voxel grain
        const c = crisp ? mul(topColor(g, cx, cz, l, this.noise), wallShade(cx, cz, l) * 0.5 + wallShade(cx + 1, cz + 1, l) * 0.5)
          : [[cx, cz + 1], [cx + 1, cz + 1], [cx + 1, cz], [cx, cz]].map(([ix, iz]) => {
            const t = topColor(g, ix, iz, l, this.noise), k = colJit * wallShade(ix, iz, l);
            return [t[0] * k, t[1] * k, t[2] * k];
          });
        // vertex order: (0,1)->(1,1)->(1,0)->(0,0) in (x,z), normal +y
        quad([[X, y, Z + V], [X + V, y, Z + V], [X + V, y, Z], [X, y, Z]], [0, 1, 0], c, ao);
        talus(cx, cz, l, y);
        if (g === GROUND.ROCK) {
          // weathered outcrops: low raised slabs breaking up bare rock tops
          const r = hash2(cx, cz, 311);
          if (r < 0.2) {
            const tc = Array.isArray(c[0]) ? c[0] : c;
            const w = 0.25 + hash2(cx, cz, 312) * 0.25, d = 0.25 + hash2(cx, cz, 313) * 0.25;
            const ox = hash2(cx, cz, 314) * (V - w), oz = hash2(cx, cz, 315) * (V - d);
            const hh = 0.06 + r * 0.6;
            box(X + ox, y - 0.02, Z + oz, X + ox + w, y + hh, Z + oz + d, mul(tc, 0.78), mul(tc, 1.08));
          }
        }
        const sides = [
          [1, 0, [1, 0, 0]], [-1, 0, [-1, 0, 0]], [0, 1, [0, 0, 1]], [0, -1, [0, 0, -1]],
        ];
        for (const [dx, dz, n] of sides) {
          const nl = L(cx + dx, cz + dz);
          const shoreN = this.isShore(cx + dx, cz + dz);
          if (nl >= l && !shoreN) continue;
          // skirt under the smoothed shore surface (mostly hidden, prevents cracks)
          const bottom = shoreN ? Math.min(nl, l) - 4 : nl;
          const drop = l - Math.max(nl, shoreN ? W - 1 : nl);
          const u = dx !== 0 ? cz : cx; // horizontal voxel coordinate along the face
          for (let k = l - 1; k >= bottom; k--) {
            const depth = l - 1 - k;
            const yy = k * VOXEL;
            let sc = k < W - 1 ? seabedColor(cx, cz, surf - k, this.noise)
              : drop >= 2 || g === GROUND.ROCK ? cliffColor(g, depth, drop, u, k, cx, cz, this.noise)
              : sideColor(g, shoreN ? Math.min(depth, 1) : depth, cx, k, cz);
            if (depth === 0 && drop < 2) sc = mul(sc, 1.05); // brighten the lip
            // ambient occlusion toward the foot of the wall (per-vertex gradient)
            const baseK = shoreN ? Math.max(nl, W - 1) : nl;
            const up = k - baseK; // rows above the foot
            const aoAt = (h) => (h >= 2.2 ? 1 : 0.58 + 0.42 * Math.max(0, h) / 2.2);
            const scB = mul(sc, aoAt(up)), scT = mul(sc, aoAt(up + 1));
            let p;
            if (dx === 1) p = [[X + V, yy, Z], [X + V, yy + V, Z], [X + V, yy + V, Z + V], [X + V, yy, Z + V]];
            else if (dx === -1) p = [[X, yy, Z + V], [X, yy + V, Z + V], [X, yy + V, Z], [X, yy, Z]];
            else if (dz === 1) p = [[X + V, yy, Z + V], [X + V, yy + V, Z + V], [X, yy + V, Z + V], [X, yy, Z + V]];
            else p = [[X, yy, Z], [X, yy + V, Z], [X + V, yy + V, Z], [X + V, yy, Z]];
            quad(p, n, [scB, scT, scT, scB], null);
          }
          if (drop >= 2 && l - 1 >= W) this._cliffDetail(box, mul, g, l, Math.max(nl, W - 1), dx, dz, cx, cz, u, shoreN ? this.surfaceY(cx + dx, cz + dz) - 0.04 : nl * VOXEL);
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

  // Relief on one cliff face of column (cx, cz), facing (dx, dz), from level
  // `base` up to `l`: a grass lip overhanging the edge with hanging tufts and
  // roots, jutting rock ledges along the strata, and rubble / boulders
  // piled at the foot. All positions come from hashes, so it is stable.
  _cliffDetail(box, mul, g, l, base, dx, dz, cx, cz, u, bot) {
    const V = VOXEL, X = cx * V, Z = cz * V, top = l * V;
    // face plane coordinate and a mapping from (along, out) to world x/z
    const fx = dx === 1 ? X + V : X, fz = dz === 1 ? Z + V : Z;
    const place = (a0, a1, o0, o1, y0, y1, c, ct) => {
      // a: 0..1 along the face, o: outward distance from the face plane
      if (dx !== 0) {
        const xa = fx + dx * o0, xb = fx + dx * o1;
        box(Math.min(xa, xb), y0, Z + a0 * V, Math.max(xa, xb), y1, Z + a1 * V, c, ct);
      } else {
        const za = fz + dz * o0, zb = fz + dz * o1;
        box(X + a0 * V, y0, Math.min(za, zb), X + a1 * V, y1, Math.max(za, zb), c, ct);
      }
    };
    const h = (s) => hash2(cx * 4 + dx + 7, cz * 4 + dz + 3, s);
    const grassy = g === GROUND.GRASS || g === GROUND.DRYGRASS || (g === GROUND.ROCK && h(1) > 0.55);
    const drop = l - base;
    if (grassy) {
      // grass lip: a turf slab slightly proud of the top, overhanging the edge
      const gc = topColor(g === GROUND.ROCK ? GROUND.GRASS : g, cx, cz, l, this.noise);
      const lipC = mul(gc, 0.78), lipT = mul(gc, 0.98);
      const over = 0.06 + h(2) * 0.08;
      place(-0.02, 1.02, -0.02, over, top - 0.1 - h(3) * 0.06, top + 0.035, lipC, lipT);
      // hanging tufts / roots
      const nd = 1 + Math.floor(h(4) * 2.5);
      for (let i = 0; i < nd; i++) {
        const a = 0.08 + hash2(cx + i * 17, cz - i * 5, 71 + dx * 3 + dz) * 0.7;
        const w = 0.09 + hash2(cx - i, cz + i * 3, 72) * 0.14;
        const len = 0.14 + hash2(cx + i, cz + i, 73) * Math.min(0.55, drop * V * 0.3);
        const root = hash2(cx * 3 + i, cz, 74) > 0.62;
        const c = root ? [0.29, 0.21, 0.14] : mul(gc, 0.72);
        place(a, Math.min(1, a + w), 0, over * 0.7, top - 0.1 - len, top - 0.05, c);
      }
    }
    // jutting rock ledges along the strata (tall walls only)
    if (drop >= 3) {
      const n = Math.floor(h(5) * 2.2);
      for (let i = 0; i < n; i++) {
        const ky = base + 1 + Math.floor(hash2(cx + i * 9, cz, 76 + dx) * (drop - 2));
        const a = hash2(cx, cz + i * 7, 77 + dz) * 0.6;
        const w = 0.3 + hash2(cx + i, cz * 2, 78) * 0.55;
        const hgt = V * (0.5 + hash2(cx * 2, cz + i, 79) * 1.2);
        const out = 0.05 + hash2(cx - i, cz, 80) * 0.11;
        const c = cliffColor(GROUND.ROCK, 5, drop, u, ky, cx, cz, this.noise);
        place(a, Math.min(1.02, a + w), -0.02, out, ky * V, Math.min(top - 0.12, ky * V + hgt), mul(c, 1.06), mul(c, 1.14));
      }
    }
    // rubble and boulders at the foot, stepping up unevenly against the wall
    if (bot > (this.map.waterLevel - 0.1) * V) {
      const nr = Math.floor(h(6) * (drop >= 4 ? 3.2 : 2.2));
      for (let i = 0; i < nr; i++) {
        const big = hash2(cx + i, cz - i, 81) > 0.72;
        const s = big ? 0.28 + hash2(cx, cz + i, 82) * 0.3 : 0.1 + hash2(cx + i, cz, 83) * 0.14;
        const a = hash2(cx * 5 + i, cz, 84 + dx) * (1 - s * 0.9);
        const o = hash2(cx, cz * 5 + i, 85 + dz) * 0.25;
        const hh = s * (0.6 + hash2(cx + i * 3, cz + i, 86) * 0.8) * (big ? Math.min(2.4, drop * 0.35) : 1);
        const tk = 0.8 + hash2(cx + i, cz, 87) * 0.35, warm = hash2(cx, cz + i, 88) * 0.06;
        const tone = [(0.62 + warm) * tk, (0.57 + warm * 0.5) * tk, 0.5 * tk];
        place(a, a + s / V, o - 0.02, o + s, bot, bot + Math.min(hh, Math.max(0.1, top - bot - 0.25)), mul(tone, 0.9), tone);
      }
    }
  }
}

export { GROUND };
