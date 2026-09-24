import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';
import { BUILDING_MODELS } from './models.js';

// Construction stages. A building under construction is shown as its model
// clipped at a rising layer (stone courses going up), wrapped in timber
// scaffolding one storey above the work, with stacked marble blocks and
// timber at the site. Stage 0 is the staked-out foundation.
export const CONSTRUCTION_STAGES = 8;

const POLE = (x, y, z) => (hash3(x, y, z, 21) < 0.5 ? 0x8a6a48 : 0x7d5f40);
const PLANK = (x, y, z) => (hash3(x, y, z, 22) < 0.5 ? 0xb39470 : 0xa68863);
const ROPE = 0xcdb98a;
const BLOCK = (x, y, z) => (hash3(x, y, z, 23) < 0.5 ? 0xe9e3d6 : 0xd9d2c2);
const LOG = 0x7a5230;

// Model that remembers the coordinates it was given, so it can be clipped
// and hollowed afterwards.
class RecordingModel extends VoxelModel {
  constructor() { super(); this.coords = []; }
  set(x, y, z, color, opts) {
    if (!this.has(x, y, z)) this.coords.push([x, y, z]);
    return super.set(x, y, z, color, opts);
  }
}

const infoCache = new Map();
function modelInfo(type, variant) {
  const k = `${type}:${variant}`;
  if (!infoCache.has(k)) {
    const full = BUILDING_MODELS[type](variant, new RecordingModel());
    const ub = { min: [1e9, 0, 1e9], max: [-1e9, 0, -1e9] };
    for (const [x, y, z] of full.coords) {
      if (y < 3 || !full.has(x, y, z)) continue;
      ub.min[0] = Math.min(ub.min[0], x); ub.max[0] = Math.max(ub.max[0], x + 1);
      ub.min[2] = Math.min(ub.min[2], z); ub.max[2] = Math.max(ub.max[2], z + 1);
    }
    infoCache.set(k, { full, top: full.bounds().max[1], upper: ub });
  }
  return infoCache.get(k);
}

// The finished model clipped below `cut`, with solid interiors hollowed out
// above the floor so the rising walls read as walls, not a solid block.
function clippedModel(full, cut) {
  const m = new VoxelModel();
  for (const [x, y, z] of full.coords) {
    if (y >= cut) continue;
    const v = full.get(x, y, z);
    if (!v) continue;
    // interior voxels (hidden in the finished building) are dropped above
    // the floor course, so the open top of the work shows walls, not a slab
    if (y >= 2 && full.has(x + 1, y, z) && full.has(x - 1, y, z) && full.has(x, y, z + 1) && full.has(x, y, z - 1) &&
        full.has(x + 1, y, z + 1) && full.has(x - 1, y, z - 1) && full.has(x + 1, y, z - 1) && full.has(x - 1, y, z + 1) &&
        full.has(x, y - 1, z)) continue;
    m.set(x, y, z, v.team ? TEAM : v.c, v.glow ? { glow: v.glow } : undefined);
  }
  return m;
}

export function constructionModel(type, variant, stage, w, h) {
  const N = CONSTRUCTION_STAGES;
  const { full, top, upper } = modelInfo(type, variant);
  const cut = stage <= 0 ? 1 : Math.max(2, Math.round(1 + (top - 1) * Math.pow(stage / N, 0.9)));
  const m = clippedModel(full, cut);
  const W = w * 4, D = h * 4;
  const clampX = (v) => Math.max(0, Math.min(W - 1, v));
  const clampZ = (v) => Math.max(0, Math.min(D - 1, v));
  const x0 = clampX(upper.min[0] - 1), x1 = clampX(upper.max[0]);
  const z0 = clampZ(upper.min[2] - 1), z1 = clampZ(upper.max[2]);

  if (stage <= 0) {
    // surveyor's stakes and rope outlining the walls
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) m.box(x, 1, z, 1, 3, 1, POLE);
    for (let x = x0; x <= x1; x++) { m.set(x, 2, z0, ROPE); m.set(x, 2, z1, ROPE); }
    for (let z = z0; z <= z1; z++) { m.set(x0, 2, z, ROPE); m.set(x1, 2, z, ROPE); }
  } else {
    const sTop = Math.min(top + 1, cut + 3);
    const poleXs = [], poleZs = [];
    for (let x = x0; x < x1 - 2; x += 5) poleXs.push(x);
    poleXs.push(x1);
    for (let z = z0; z < z1 - 2; z += 5) poleZs.push(z);
    poleZs.push(z1);
    // standards (vertical poles) around the perimeter
    for (const x of poleXs) { m.box(x, 1, z0, 1, sTop, 1, POLE); m.box(x, 1, z1, 1, sTop, 1, POLE); }
    for (const z of poleZs) { m.box(x0, 1, z, 1, sTop, 1, POLE); m.box(x1, 1, z, 1, sTop, 1, POLE); }
    // ledgers every 6 layers and a plank walkway at the working level
    const walk = Math.max(2, cut - 1);
    const levels = new Set([walk]);
    for (let y = 6; y < walk - 2; y += 6) levels.add(y);
    for (const y of levels) {
      for (let x = x0; x <= x1; x++) { m.set(x, y, z0, PLANK); m.set(x, y, z1, PLANK); }
      for (let z = z0; z <= z1; z++) { m.set(x0, y, z, PLANK); m.set(x1, y, z, PLANK); }
    }
    for (let x = x0; x <= x1; x++) { m.set(x, walk, z1 + 1 < D ? z1 + 1 : z1, PLANK); }
    for (let z = z0; z <= z1; z++) { m.set(x1 + 1 < W ? x1 + 1 : x1, walk, z, PLANK); }
    // diagonal braces on the two faces the camera sees
    for (let i = 0; i + 1 < poleXs.length; i += 2) {
      const a = poleXs[i], b = poleXs[i + 1];
      for (let y = 1; y + 5 <= sTop; y += 12) m.line(a, y, z1, b, y + 5, z1, POLE);
    }
    for (let i = 1; i + 1 < poleZs.length; i += 2) {
      const a = poleZs[i], b = poleZs[i + 1];
      for (let y = 1; y + 5 <= sTop; y += 12) m.line(x1, y, a, x1, y + 5, b, POLE);
    }
    // a hoist: a tall pole with a jib and a hanging marble block
    if (stage < N - 1) {
      const hx = x0, hz = z1;
      m.box(hx, 1, hz, 1, sTop + 4, 1, POLE);
      m.line(hx, sTop + 4, hz, hx + 4, sTop + 4, hz, POLE);
      m.box(hx + 4, sTop + 1, hz, 1, 3, 1, ROPE);
      m.box(hx + 3, sTop - 1, hz, 2, 2, 1, BLOCK);
    }
  }
  // building materials stacked at the front corner of the site
  const px = Math.max(0, W - 4), pz = Math.max(0, D - 3);
  const ground = (x, z) => { let y = 0; while (m.has(x, y, z) && y < 6) y++; return y; };
  if (stage < N - 1) {
    const g = ground(px, pz);
    m.box(px, g, pz, 2, 1, 2, BLOCK);
    if (stage < N - 3) m.box(px, g + 1, pz, 2, 1, 1, BLOCK);
    const g2 = ground(1, D - 2);
    m.box(1, g2, D - 2, 3, 1, 1, LOG);
    if (stage < N - 2) m.box(1, g2 + 1, D - 2, 2, 1, 1, LOG);
  }
  return m;
}
