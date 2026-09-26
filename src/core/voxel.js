import * as THREE from 'three';
import { hash3 } from './rng.js';
import { addShaderPatch, prependVertex, injectVertex, prependFragment, injectFragment } from './shaderPatch.js';
import { applyFogOfWar } from './FogOfWar.js';

// ---------------------------------------------------------------------------
// VoxelModel: a sparse voxel set described in code. Shared by buildings,
// units and terrain props.
//
//   const m = new VoxelModel();
//   m.box(0, 0, 0, 8, 1, 8, 0xd8cfb8);          // x, y, z, w, h, d, color
//   m.box(1, 1, 1, 6, 6, 6, TEAM);              // team-coloured voxels
//   m.cylinder(4, 7, 4, 3, 2, 0xb84a2c);        // cx, y, cz, radius, height
//   const geo = buildVoxelGeometry(m, { size: 0.25, pivot: [4, 0, 4] });
//
// Colors are sRGB hex ints or a function (x, y, z) => hex.
// ---------------------------------------------------------------------------

export const TEAM = -1; // special colour: tinted by the owner's player colour
const TEAM_BASE = 0xf2f2f2;

const OFF = 512;
const key = (x, y, z) => ((x + OFF) << 20) | ((y + OFF) << 10) | (z + OFF);
const unkey = (k) => [((k >> 20) & 1023) - OFF, ((k >> 10) & 1023) - OFF, (k & 1023) - OFF];

export class VoxelModel {
  constructor() {
    this.vox = new Map(); // key -> { c: hex, team: 0|1, glow: 0..1 }
  }
  set(x, y, z, color, opts) {
    if (typeof color === 'function') color = color(x, y, z);
    if (color === null || color === undefined) return this;
    const team = color === TEAM ? 1 : 0;
    this.vox.set(key(x, y, z), { c: team ? TEAM_BASE : color, team, glow: opts?.glow || 0 });
    return this;
  }
  get(x, y, z) { return this.vox.get(key(x, y, z)); }
  has(x, y, z) { return this.vox.has(key(x, y, z)); }
  remove(x, y, z) { this.vox.delete(key(x, y, z)); return this; }
  box(x, y, z, w, h, d, color, opts) {
    for (let k = z; k < z + d; k++)
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) this.set(i, j, k, color, opts);
    return this;
  }
  carve(x, y, z, w, h, d) {
    for (let k = z; k < z + d; k++)
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++) this.remove(i, j, k);
    return this;
  }
  // hollow box (walls only), open top
  shell(x, y, z, w, h, d, color, opts) {
    for (let k = z; k < z + d; k++)
      for (let j = y; j < y + h; j++)
        for (let i = x; i < x + w; i++)
          if (i === x || k === z || i === x + w - 1 || k === z + d - 1) this.set(i, j, k, color, opts);
    return this;
  }
  cylinder(cx, y, cz, r, h, color, opts) {
    const r2 = (r + 0.35) * (r + 0.35);
    for (let k = Math.floor(cz - r); k <= Math.ceil(cz + r); k++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        const dx = i - cx, dz = k - cz;
        if (dx * dx + dz * dz <= r2) for (let j = y; j < y + h; j++) this.set(i, j, k, color, opts);
      }
    return this;
  }
  ellipsoid(cx, cy, cz, rx, ry, rz, color, opts) {
    for (let k = Math.floor(cz - rz); k <= Math.ceil(cz + rz); k++)
      for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++)
        for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
          const dx = (i - cx) / (rx + 0.3), dy = (j - cy) / (ry + 0.3), dz = (k - cz) / (rz + 0.3);
          if (dx * dx + dy * dy + dz * dz <= 1) this.set(i, j, k, color, opts);
        }
    return this;
  }
  sphere(cx, cy, cz, r, color, opts) { return this.ellipsoid(cx, cy, cz, r, r, r, color, opts); }
  // Pitched roof along x (ridge parallel to x) over [x, x+w) x [z, z+d)
  roofX(x, y, z, w, d, color, opts) {
    const half = Math.ceil(d / 2);
    for (let s = 0; s < half; s++) this.box(x, y + s, z + s, w, 1, d - 2 * s, color, opts);
    return this;
  }
  roofZ(x, y, z, w, d, color, opts) {
    const half = Math.ceil(w / 2);
    for (let s = 0; s < half; s++) this.box(x + s, y + s, z, w - 2 * s, 1, d, color, opts);
    return this;
  }
  line(x0, y0, z0, x1, y1, z1, color, opts) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0;
      this.set(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), Math.round(z0 + (z1 - z0) * t), color, opts);
    }
    return this;
  }
  // Copy another model into this one with an offset.
  merge(other, ox = 0, oy = 0, oz = 0) {
    for (const [k, v] of other.vox) {
      const [x, y, z] = unkey(k);
      this.vox.set(key(x + ox, y + oy, z + oz), v);
    }
    return this;
  }
  bounds() {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const k of this.vox.keys()) {
      const p = unkey(k);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a] + 1); }
    }
    return { min: mn, max: mx };
  }
  get count() { return this.vox.size; }
}

// ---------------------------------------------------------------------------
// Mesher: emits only exposed faces, with per-voxel colour jitter and
// per-vertex ambient occlusion baked into vertex colours.
// ---------------------------------------------------------------------------
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const _c = new THREE.Color();

export function buildVoxelGeometry(model, opts = {}) {
  const size = opts.size ?? 0.1;
  const pivot = opts.pivot ?? [0, 0, 0];
  const jitter = opts.jitter ?? 0.07;
  const ao = opts.ao ?? true;
  const seed = opts.seed ?? 7;
  const pos = [], nor = [], col = [], team = [], glow = [], idx = [];
  const occ = (x, y, z) => (model.vox.has(key(x, y, z)) ? 1 : 0);
  for (const [k, v] of model.vox) {
    const [x, y, z] = unkey(k);
    // per-voxel colour variation (in sRGB, then converted to linear)
    const j = 1 + (hash3(x, y, z, seed) - 0.5) * 2 * jitter;
    _c.setHex(v.c);
    const r = Math.min(1, _c.r * j), g = Math.min(1, _c.g * j), b = Math.min(1, _c.b * j);
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const [nx, ny, nz] = F.n;
      if (occ(x + nx, y + ny, z + nz)) continue;
      const base = pos.length / 3;
      const aos = [];
      for (let ci = 0; ci < 4; ci++) {
        const [cx, cy, cz] = F.c[ci];
        pos.push((x + cx - pivot[0]) * size, (y + cy - pivot[1]) * size, (z + cz - pivot[2]) * size);
        nor.push(nx, ny, nz);
        let a = 3;
        if (ao) {
          // the two in-plane axes
          const ax = [0, 1, 2].filter((q) => F.n[q] === 0);
          const cc = [cx, cy, cz];
          const s1 = [x + nx, y + ny, z + nz], s2 = [x + nx, y + ny, z + nz], cr = [x + nx, y + ny, z + nz];
          const d0 = cc[ax[0]] ? 1 : -1, d1 = cc[ax[1]] ? 1 : -1;
          s1[ax[0]] += d0; s2[ax[1]] += d1; cr[ax[0]] += d0; cr[ax[1]] += d1;
          const o1 = occ(...s1), o2 = occ(...s2), o3 = occ(...cr);
          a = o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
        }
        aos.push(a);
        const s = AO_CURVE[a];
        col.push(r * s, g * s, b * s);
        team.push(v.team);
        glow.push(v.glow);
      }
      if (aos[0] + aos[2] > aos[1] + aos[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
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

// ---------------------------------------------------------------------------
// Standard voxel material: vertex colours, team tint, emissive glow voxels,
// fog of war. For InstancedMesh pass { instanced: true } and give the mesh an
// InstancedBufferAttribute 'instTeam' (vec3) and optionally 'instFlash' (float).
// For plain meshes pass { teamColor: 0x2f6bff }.
// ---------------------------------------------------------------------------
export function makeVoxelMaterial({ teamColor = 0xffffff, instanced = false, roughness = 0.82, fog = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0.0 });
  const teamUniform = { value: new THREE.Color(teamColor) };
  mat.userData.teamColor = teamUniform;
  addShaderPatch(mat, instanced ? 'voxelTeamInst' : 'voxelTeam', (shader) => {
    shader.uniforms.uTeamColor = teamUniform;
    prependVertex(shader, `attribute float team;\nattribute float glow;\nvarying float vTeam;\nvarying float vGlow;\nvarying vec3 vTeamCol;\nvarying float vFlash;\nuniform vec3 uTeamColor;\n${instanced ? 'attribute vec3 instTeam;\nattribute float instFlash;' : ''}`);
    injectVertex(shader, '#include <color_vertex>', `vTeam = team; vGlow = glow;\n${instanced ? 'vTeamCol = instTeam; vFlash = instFlash;' : 'vTeamCol = uTeamColor; vFlash = 0.0;'}`);
    prependFragment(shader, 'varying float vTeam;\nvarying float vGlow;\nvarying vec3 vTeamCol;\nvarying float vFlash;');
    injectFragment(shader, '#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vTeamCol, vTeam);');
    injectFragment(shader, '#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * vGlow * 2.5 + vec3(1.0, 0.95, 0.85) * vFlash;');
  });
  if (fog) applyFogOfWar(mat);
  return mat;
}

// Cache materials per owner colour so buildings share programs & uniforms.
const matCache = new Map();
export function voxelMaterialFor(color, opts = {}) {
  const k = `${color}|${opts.roughness ?? ''}|${opts.fog ?? true}`;
  if (!matCache.has(k)) matCache.set(k, makeVoxelMaterial({ teamColor: color, ...opts }));
  return matCache.get(k);
}
