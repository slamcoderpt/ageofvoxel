import * as THREE from 'three';
import { hash2 } from '../core/rng.js';
import { makeTree, PROP_VOXEL } from '../terrain/models.js';

// Canopy occlusion map: a low-res top-down texture over the whole map that
// the lighting shader patches sample by world XZ.
//   R = forest density (0 clearing .. 1 closed canopy), blurred over ~2 tiles
//   G = ground height (world units) under that texel
// With it, every voxel surface knows how far it sits below the local canopy:
// the interiors and undersides of tree crowns and the forest floor under the
// canopy edge fall into deep, cool shade, while crown tops and clearings keep
// the sun. Rebuilt lazily when trees are added or cut down.
const RES = 2; // texels per tile

export const canopyUniforms = {
  uCanopy: { value: null },
  uCanopyInvSize: { value: 1 / 128 },
  uCanopyOn: { value: 0 },
  // Canopy envelope: a finer top-down heightfield of the forest's upper
  // surface (world y of the highest leaf voxel in each column, the ground
  // where there is no tree), rasterised from the real tree models. The
  // lighting patches march it like a horizon map, so every leaf face and
  // every patch of ground between trees knows how much sky its neighbouring
  // crowns hide: crown skirts and the gaps between crowns go dark, caps and
  // clearings keep the sky.
  uCanopyTop: { value: null },
};
const RES_TOP = 4; // envelope texels per tile

// per tree variant: the column tops of the model, as [dx, dz, top] in world
// units relative to the trunk pivot (before instance rotation and scale)
const columnCache = new Map();
function treeColumns(variant) {
  let c = columnCache.get(variant);
  if (c) return c;
  const m = makeTree(variant);
  const tops = new Map();
  for (const k of m.vox.keys()) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    const ck = x * 4096 + z;
    const t = tops.get(ck);
    if (t === undefined || y > t[2]) tops.set(ck, [x, z, y]);
  }
  c = [];
  // pivot [1, 0, 1] (see terrain/ResourceRenderer.js); centre of the column
  for (const [x, z, y] of tops.values()) c.push([(x + 0.5 - 1) * PROP_VOXEL, (z + 0.5 - 1) * PROP_VOXEL, (y + 1) * PROP_VOXEL]);
  columnCache.set(variant, c);
  return c;
}

export class CanopyMap {
  constructor(game) {
    this.game = game;
    this.dirty = true;
    this.cooldown = 0;
    this.tex = null;
    game.events.on('entity:added', (e) => { if (e.kind === 'resource') this.dirty = true; });
    game.events.on('entity:removed', (e) => { if (e.kind === 'resource') this.dirty = true; });
  }

  update() {
    if (this.cooldown > 0) this.cooldown--;
    if (!this.dirty || this.cooldown > 0) return;
    const map = this.game.map;
    if (!map || !this.game.entities) return;
    this.dirty = false;
    this.cooldown = 30;
    this._build(map);
  }

  _build(map) {
    const N = map.size * RES, ws = map.worldSize;
    const cell = ws / N;
    const cov = new Float32Array(N * N);
    // splat each tree crown as a soft disc
    const R = 1.7 / cell; // crown radius in texels
    const ri = Math.ceil(R + 1);
    for (const e of this.game.entities.resources()) {
      if (e.type !== 'tree' || e.dead) continue;
      const cx = e.x / cell - 0.5, cz = e.z / cell - 0.5;
      const x0 = Math.floor(cx), z0 = Math.floor(cz);
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++) {
          const x = x0 + dx, z = z0 + dz;
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const d = Math.hypot(x - cx, z - cz) / R;
          if (d >= 1) continue;
          const w = 1 - d * d;
          cov[z * N + x] += w * 0.8;
        }
    }
    // separable box blur x2 (~gaussian), then soft saturate
    const tmp = new Float32Array(N * N);
    const blur = (src, dst, r) => {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < N) { s += src[z * N + xx]; n++; } }
        dst[z * N + x] = s / n;
      }
      for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const zz = z + k; if (zz >= 0 && zz < N) { s += dst[zz * N + x]; n++; } }
        src[z * N + x] = s / n;
      }
    };
    blur(cov, tmp, 2);
    blur(cov, tmp, 1);
    const data = new Uint16Array(N * N * 4);
    const h = THREE.DataUtils.toHalfFloat;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const d = 1 - Math.exp(-cov[i] * 1.6);
      const gy = map.heightAt((x + 0.5) * cell, (z + 0.5) * cell);
      data[i * 4] = h(d); data[i * 4 + 1] = h(gy); data[i * 4 + 2] = 0; data[i * 4 + 3] = h(1);
    }
    if (!this.tex || this.tex.image.width !== N) {
      this.tex?.dispose();
      this.tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
      this.tex.magFilter = THREE.LinearFilter;
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      this.tex.image.data = data;
    }
    this.tex.needsUpdate = true;
    this._buildTop(map);
    canopyUniforms.uCanopy.value = this.tex;
    canopyUniforms.uCanopyInvSize.value = 1 / ws;
    canopyUniforms.uCanopyOn.value = 1;
  }

  // Canopy envelope heightfield (see canopyUniforms.uCanopyTop).
  _buildTop(map) {
    const N = map.size * RES_TOP, ws = map.worldSize;
    const cell = ws / N;
    const top = new Float32Array(N * N);
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) top[z * N + x] = map.heightAt((x + 0.5) * cell, (z + 0.5) * cell);
    for (const e of this.game.entities.resources()) {
      if (e.type !== 'tree' || e.dead) continue;
      // same instance transform as terrain/ResourceRenderer.js
      const rot = Math.floor(hash2(e.tx, e.tz, 77) * 4) * Math.PI / 2;
      const sc = 0.85 + hash2(e.tx, e.tz, 5) * 0.35;
      const sy = sc * (0.9 + hash2(e.tx, e.tz, 9) * 0.2);
      const base = map.heightAt(e.x, e.z) - 0.05;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (const [dx, dz, ty] of treeColumns((e.variant ?? 0) % 10)) {
        const lx = dx * sc, lz = dz * sc;
        const wx = e.x + lx * cr + lz * sr, wz = e.z - lx * sr + lz * cr;
        const tx = Math.floor(wx / cell), tz = Math.floor(wz / cell);
        if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
        const i = tz * N + tx, h = base + ty * sy;
        if (h > top[i]) top[i] = h;
      }
    }
    const data = new Uint16Array(N * N);
    for (let i = 0; i < N * N; i++) data[i] = THREE.DataUtils.toHalfFloat(top[i]);
    if (!this.topTex || this.topTex.image.width !== N) {
      this.topTex?.dispose();
      this.topTex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
      this.topTex.magFilter = THREE.LinearFilter;
      this.topTex.minFilter = THREE.LinearFilter;
      this.topTex.wrapS = this.topTex.wrapT = THREE.ClampToEdgeWrapping;
    } else {
      this.topTex.image.data = data;
    }
    this.topTex.needsUpdate = true;
    canopyUniforms.uCanopyTop.value = this.topTex;
  }
}
