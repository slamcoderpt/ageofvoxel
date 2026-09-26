import * as THREE from 'three';

// Contact occlusion map: a top-down texture over a window around the view.
//   R = soft occupancy of things standing on the ground (building and prop
//       footprints, units), blurred so it fades out ~1 tile from each base
//   G = ground height under that texel (height * HSCALE / 255, RGBA8)
// The lighting shader patches use it for short-range "sitting in the ground"
// darkening that screen-space AO is too weak to give at RTS distance:
//  - terrain gets a dark halo round every building, prop and unit,
//  - voxel surfaces get a dark band a few voxels high where they meet the
//    ground (wall bases, plinths, unit feet).
// Rebuilt every few frames (units move) and when the view pans.
const RES = 3;       // texels per world unit
const SPAN = 96;     // window size in world units
const HSCALE = 8;    // ground height encoding (G channel = height * HSCALE / 255)

export const contactUniforms = {
  uContact: { value: null },
  uContactOrigin: { value: new THREE.Vector2(0, 0) },
  uContactInvSize: { value: 1 / SPAN },
  uContactOn: { value: 0 },
};

const _box = new THREE.Box3();
const _m = new THREE.Matrix4();

export class ContactMap {
  constructor(game) {
    this.game = game;
    this.N = SPAN * RES;
    this.cov = new Float32Array(this.N * this.N);
    this.tmp = new Float32Array(this.N * this.N);
    this.data = new Uint8Array(this.N * this.N * 4);
    this.tex = new THREE.DataTexture(this.data, this.N, this.N, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.frame = 0;
    this.ox = NaN; this.oz = NaN;
  }

  update() {
    const map = this.game.map, t = this.game.cameraCtl?.target;
    if (!map || !t || !this.game.entities) return;
    // window origin snapped to whole tiles
    const ox = Math.round(t.x - SPAN / 2), oz = Math.round(t.z - SPAN / 2);
    const moved = ox !== this.ox || oz !== this.oz;
    if (!moved && this.frame++ % 24 !== 0) return;
    this.ox = ox; this.oz = oz;
    this._build(map, moved || this.frame % 240 === 1);
  }

  _rect(x0, z0, x1, z1, v) {
    const N = this.N, cov = this.cov;
    const a = Math.max(0, Math.floor((x0 - this.ox) * RES)), b = Math.min(N - 1, Math.ceil((x1 - this.ox) * RES) - 1);
    const c = Math.max(0, Math.floor((z0 - this.oz) * RES)), d = Math.min(N - 1, Math.ceil((z1 - this.oz) * RES) - 1);
    for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) { const i = z * N + x; if (cov[i] < v) cov[i] = v; }
  }

  _disc(cx, cz, r, v) {
    const N = this.N, cov = this.cov;
    const px = (cx - this.ox) * RES, pz = (cz - this.oz) * RES, R = r * RES;
    const x0 = Math.max(0, Math.floor(px - R)), x1 = Math.min(N - 1, Math.ceil(px + R));
    const z0 = Math.max(0, Math.floor(pz - R)), z1 = Math.min(N - 1, Math.ceil(pz + R));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz) / R;
      if (d >= 1) continue;
      const w = v * (1 - d * d);
      const i = z * N + x;
      if (cov[i] < w) cov[i] = w;
    }
  }

  // world-space box of a mesh (or of each instance), splatted if it stands on the ground
  _splatBox(box, map) {
    const h = box.max.y - box.min.y;
    if (h < 0.3) return;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const gy = map.heightAt(cx, cz);
    if (box.min.y > gy + 0.6) return;
    this._rect(box.min.x, box.min.z, box.max.x, box.max.z, 1);
  }

  _splatGroup(group, map) {
    if (!group) return;
    const x0 = this.ox - 4, x1 = this.ox + SPAN + 4, z0 = this.oz - 4, z1 = this.oz + SPAN + 4;
    group.updateMatrixWorld();
    group.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData.noAO) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, _m);
          _m.premultiply(o.matrixWorld);
          _box.copy(g.boundingBox).applyMatrix4(_m);
          if (_box.max.x < x0 || _box.min.x > x1 || _box.max.z < z0 || _box.min.z > z1) continue;
          this._splatBox(_box, map);
        }
      } else {
        _box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
        if (_box.max.x < x0 || _box.min.x > x1 || _box.max.z < z0 || _box.min.z > z1) return;
        this._splatBox(_box, map);
      }
    });
  }

  _build(map, heights) {
    const N = this.N, cov = this.cov, tmp = this.tmp;
    cov.fill(0);
    const scene = this.game.scene;
    for (const c of scene.children) {
      if (c.name === 'buildings' || c.name === 'building-props') this._splatGroup(c, map);
    }
    for (const u of this.game.entities.units()) {
      if (u.dead) continue;
      this._disc(u.x, u.z, 0.42, 0.85);
    }
    for (const e of this.game.entities.resources()) {
      if (e.dead || e.type === 'tree') continue;
      this._disc(e.x, e.z, 0.8, 0.7);
    }
    // separable box blur x2 (~gaussian, ~1 world unit reach)
    const blur = (r) => {
      for (let z = 0; z < N; z++) {
        const row = z * N;
        for (let x = 0; x < N; x++) {
          let s = 0, n = 0;
          for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < N) { s += cov[row + xx]; n++; } }
          tmp[row + x] = s / n;
        }
      }
      for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const zz = z + k; if (zz >= 0 && zz < N) { s += tmp[zz * N + x]; n++; } }
        cov[z * N + x] = s / n;
      }
    };
    blur(2);
    blur(2);
    // RGBA8: R = occupancy, G = ground height * HSCALE (0.125 unit steps)
    const data = this.data;
    for (let i = 0, n = N * N; i < n; i++) data[i * 4] = Math.min(255, cov[i] * 255 + 0.5);
    if (heights) {
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const hy = map.heightAt(this.ox + (x + 0.5) / RES, this.oz + (z + 0.5) / RES);
        data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(hy * HSCALE)));
        data[i * 4 + 3] = 255;
      }
    }
    this.tex.needsUpdate = true;
    contactUniforms.uContact.value = this.tex;
    contactUniforms.uContactOrigin.value.set(this.ox, this.oz);
    contactUniforms.uContactOn.value = 1;
  }
}
