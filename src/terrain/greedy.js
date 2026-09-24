import * as THREE from 'three';
import { hash3 } from '../core/rng.js';

// Greedy voxel mesher for props (same vertex layout as core buildVoxelGeometry:
// position, normal, color with baked AO, team, glow). Coplanar exposed faces
// with the same colour and light AO are merged into larger quads, which
// cuts a tree from ~1.5k to ~0.9k triangles. Faces in dark creases
// stay 1x1 so the contact shading is kept.
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const _c = new THREE.Color();

export function buildGreedyGeometry(model, opts = {}) {
  const size = opts.size ?? 0.1;
  const pivot = opts.pivot ?? [0, 0, 0];
  const jitter = opts.jitter ?? 0.07;
  const seed = opts.seed ?? 7;
  const vox = new Map();
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  const K = (x, y, z) => `${x},${y},${z}`;
  for (const [k, v] of model.vox) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    vox.set(K(x, y, z), v);
    const p = [x, y, z];
    for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
  }
  const occ = (p) => (vox.has(K(p[0], p[1], p[2])) ? 1 : 0);
  const pos = [], nor = [], col = [], team = [], glow = [], idx = [];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, w = (d + 2) % 3;
    const nu = mx[u] - mn[u] + 1, nw = mx[w] - mn[w] + 1;
    for (const s of [1, -1]) {
      const n = [0, 0, 0]; n[d] = s;
      for (let sl = mn[d]; sl <= mx[d]; sl++) {
        // build the mask for this slice
        const mask = new Array(nu * nw).fill(null);
        for (let j = 0; j < nw; j++)
          for (let i = 0; i < nu; i++) {
            const p = [0, 0, 0]; p[d] = sl; p[u] = mn[u] + i; p[w] = mn[w] + j;
            const v = vox.get(K(p[0], p[1], p[2]));
            if (!v) continue;
            const q = p.slice(); q[d] += s;
            if (occ(q)) continue;
            // AO at the 4 corners (du, dw) in {-1,+1}^2, order (-,-), (+,-), (+,+), (-,+)
            const ao = [];
            for (const [cu, cw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              const a1 = q.slice(); a1[u] += cu;
              const a2 = q.slice(); a2[w] += cw;
              const a3 = q.slice(); a3[u] += cu; a3[w] += cw;
              const o1 = occ(a1), o2 = occ(a2), o3 = occ(a3);
              ao.push(o1 && o2 ? 0 : 3 - (o1 + o2 + o3));
            }
            // faces with only light occlusion (AO 2..3) merge; the merged quad takes
            // its corner AO from the corner faces (the tiny 2-vs-3 steps inside are
            // smoothed over). Darker creases stay per-voxel.
            const lit = Math.min(ao[0], ao[1], ao[2], ao[3]) >= (opts.minMergeAO ?? 2);
            mask[j * nu + i] = { v, ao, key: lit ? `${v.c}|${v.team}|${v.glow}` : null, p };
          }
        // greedy merge
        for (let j = 0; j < nw; j++)
          for (let i = 0; i < nu; i++) {
            const m = mask[j * nu + i];
            if (!m) continue;
            let wdt = 1, hgt = 1;
            if (m.key) {
              while (i + wdt < nu && mask[j * nu + i + wdt] && mask[j * nu + i + wdt].key === m.key) wdt++;
              outer: while (j + hgt < nw) {
                for (let k = 0; k < wdt; k++) {
                  const o = mask[(j + hgt) * nu + i + k];
                  if (!o || o.key !== m.key) break outer;
                }
                hgt++;
              }
            }
            const ao = [m.ao[0], mask[j * nu + i + wdt - 1].ao[1], mask[(j + hgt - 1) * nu + i + wdt - 1].ao[2], mask[(j + hgt - 1) * nu + i].ao[3]];
            for (let jj = 0; jj < hgt; jj++) for (let ii = 0; ii < wdt; ii++) mask[(j + jj) * nu + i + ii] = null;
            emit(m, ao, i, j, wdt, hgt);
          }
        function emit(m, ao, i, j, wdt, hgt) {
          const base = pos.length / 3;
          const jit = 1 + (hash3(m.p[0], m.p[1], m.p[2], seed) - 0.5) * 2 * jitter;
          _c.setHex(m.v.c);
          const r = Math.min(1, _c.r * jit), g = Math.min(1, _c.g * jit), b = Math.min(1, _c.b * jit);
          const cs = [[i, j], [i + wdt, j], [i + wdt, j + hgt], [i, j + hgt]];
          for (let k = 0; k < 4; k++) {
            const P = [0, 0, 0];
            P[d] = sl + (s > 0 ? 1 : 0);
            P[u] = mn[u] + cs[k][0];
            P[w] = mn[w] + cs[k][1];
            pos.push((P[0] - pivot[0]) * size, (P[1] - pivot[1]) * size, (P[2] - pivot[2]) * size);
            nor.push(n[0], n[1], n[2]);
            const a = AO_CURVE[ao[k]];
            col.push(r * a, g * a, b * a);
            team.push(m.v.team);
            glow.push(m.v.glow);
          }
          // (u, w, d) is right-handed, so corners run CCW seen from +d
          const flipDiag = ao[0] + ao[2] < ao[1] + ao[3];
          const tri = flipDiag ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
          if (s < 0) for (let t = 0; t < 6; t += 3) { const tmp = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = tmp; }
          for (const t of tri) idx.push(base + t);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('team', new THREE.Float32BufferAttribute(team, 1));
  geo.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
