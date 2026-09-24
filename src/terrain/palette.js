import { GROUND } from '../core/GameMap.js';
import { hash2 } from '../core/rng.js';

// Ground palette (sRGB hex). Two tones per ground type are blended by
// low-frequency noise, then each voxel gets a small random jitter.
export const GROUND_COLORS = {
  [GROUND.GRASS]: [0x4f9a2e, 0x7cb640],
  [GROUND.DRYGRASS]: [0x86a83c, 0xa7b04e],
  [GROUND.DIRT]: [0x9a7447, 0xb58b58],
  [GROUND.SAND]: [0xd9c48c, 0xe8d7a3],
  [GROUND.ROCK]: [0x8d877c, 0xa7a194],
  [GROUND.PAVED]: [0xc9bea3, 0xd9d0b8],
  [GROUND.FARM]: [0x6d4a2c, 0x80593a],
};

export const SIDE_DIRT = [0x8a6540, 0x9c7549];
export const SIDE_ROCK = [0x7f786e, 0x979086];
export const UNDERWATER = [0xb9a674, 0xc9b78a];

function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return [(ar + (br - ar) * t) / 255, (ag + (bg - ag) * t) / 255, (ab + (bb - ab) * t) / 255];
}

// Returns sRGB [r,g,b] 0..1 for the top face of a column.
export function topColor(ground, cx, cz, level, noise) {
  const pair = GROUND_COLORS[ground] || GROUND_COLORS[GROUND.GRASS];
  let t = noise.fbm(cx * 0.045, cz * 0.045, 3);
  t = Math.min(1, Math.max(0, (t - 0.3) * 2.2));
  const j = (hash2(cx, cz, 11) - 0.5) * 0.16 + (noise.noise(cx * 0.3 + 40, cz * 0.3) - 0.5) * 0.12;
  let [r, g, b] = lerpHex(pair[0], pair[1], t);
  if (ground === GROUND.PAVED) {
    // stone slabs 2x2 columns with darker grout lines
    const slab = hash2(cx >> 1, cz >> 1, 5);
    const k = 0.9 + slab * 0.15;
    r *= k; g *= k; b *= k;
  } else if (ground === GROUND.FARM) {
    const furrow = (cz & 1) === 0 ? 0.85 : 1.05;
    r *= furrow; g *= furrow; b *= furrow;
  } else if (ground === GROUND.GRASS || ground === GROUND.DRYGRASS) {
    // occasional flowers / light tufts
    const f = hash2(cx, cz, 23);
    if (f > 0.9975) return [0.95, 0.86, 0.4];
    if (f > 0.9955) return [0.9, 0.9, 0.95];
    if (f > 0.994) return [0.85, 0.45, 0.6];
  }
  // higher ground slightly lighter for readability
  const lift = 1 + Math.min(0.08, Math.max(-0.06, (level - 4) * 0.012));
  return [Math.min(1, (r + j * r) * lift), Math.min(1, (g + j * g) * lift), Math.min(1, (b + j * b) * lift)];
}

export function sideColor(ground, depth, cx, cy, cz) {
  const j = (hash2(cx * 7 + cy, cz * 3 - cy, 31) - 0.5) * 0.14;
  let pair;
  if (ground === GROUND.ROCK || depth > 2) pair = SIDE_ROCK;
  else if (depth === 0 && (ground === GROUND.GRASS || ground === GROUND.DRYGRASS)) {
    const c = GROUND_COLORS[ground][0];
    const [r, g, b] = lerpHex(c, c, 0);
    return [r * 0.92 * (1 + j), g * 0.92 * (1 + j), b * 0.92 * (1 + j)];
  } else if (ground === GROUND.SAND) pair = UNDERWATER;
  else pair = SIDE_DIRT;
  const strata = ((cy % 3) === 0 ? 0.92 : 1.0);
  const [r, g, b] = lerpHex(pair[0], pair[1], hash2(cx, cz + cy * 13, 3));
  return [r * strata * (1 + j), g * strata * (1 + j), b * strata * (1 + j)];
}
