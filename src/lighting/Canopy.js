import * as THREE from 'three';

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
};

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
    canopyUniforms.uCanopy.value = this.tex;
    canopyUniforms.uCanopyInvSize.value = 1 / ws;
    canopyUniforms.uCanopyOn.value = 1;
  }
}
