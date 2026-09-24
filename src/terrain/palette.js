import { GROUND } from '../core/GameMap.js';
import { hash2 } from '../core/rng.js';

// Ground palette (sRGB hex). Two tones per ground type are blended by
// low-frequency noise, then each voxel gets a small random jitter.
export const GROUND_COLORS = {
  [GROUND.GRASS]: [0x44722a, 0x789838],
  [GROUND.DRYGRASS]: [0x7f913c, 0xa19f50],
  [GROUND.DIRT]: [0x9a7447, 0xb58b58],
  [GROUND.SAND]: [0xd9c48c, 0xe8d7a3],
  [GROUND.ROCK]: [0x857b6c, 0xa39985],
  [GROUND.PAVED]: [0xc9bea3, 0xd9d0b8],
  [GROUND.FARM]: [0x6d4a2c, 0x80593a],
};

export const SIDE_DIRT = [0x8a6540, 0x9c7549];
export const SIDE_ROCK = [0x746a5e, 0x958a7a];
export const UNDERWATER = [0xb9a674, 0xc9b78a]; // sand cliff sides

function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return [(ar + (br - ar) * t) / 255, (ag + (bg - ag) * t) / 255, (ab + (bb - ab) * t) / 255];
}

// Returns sRGB [r,g,b] 0..1 for the top face of a column.
// Colour comes from layered noise (large meadow patches, medium clumps) with
// only a faint per-column jitter, so ground reads as soft patches instead of
// a checkerboard.
export function topColor(ground, cx, cz, level, noise) {
  const pair = GROUND_COLORS[ground] || GROUND_COLORS[GROUND.GRASS];
  let t = noise.fbm(cx * 0.03, cz * 0.03, 3);
  t = Math.min(1, Math.max(0, (t - 0.28) * 2.1));
  const mid = noise.fbm(cx * 0.13 + 40, cz * 0.13, 2) - 0.5;
  const j = (hash2(cx, cz, 11) - 0.5) * 0.12 + mid * 0.16;
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
    // warm sun-bleached streaks and darker lush hollows
    const warm = Math.max(0, noise.fbm(cx * 0.06 + 90, cz * 0.06 + 13, 3) - 0.55) * 2.2;
    r += warm * 0.12; g += warm * 0.05; b -= warm * 0.02;
    const lush = Math.max(0, 0.42 - noise.fbm(cx * 0.08 + 7, cz * 0.08 + 61, 2)) * 1.6;
    r -= lush * 0.1; g -= lush * 0.05; b -= lush * 0.03;
    // bare earth showing through in small spots
    const bare = noise.noise(cx * 0.21 + 300, cz * 0.21 + 11);
    if (bare > 0.8) {
      const k = Math.min(1, (bare - 0.8) * 7) * 0.55;
      r += (0.6 - r) * k; g += (0.5 - g) * k; b += (0.31 - b) * k;
    }
  } else if (ground === GROUND.ROCK) {
    // weathered stone: strong grain, lichen and moss in the hollows
    const g2 = (hash2(cx * 3, cz * 5, 19) - 0.5) * 0.18;
    r *= 1 + g2; g *= 1 + g2; b *= 1 + g2;
    const moss = noise.fbm(cx * 0.12 + 70, cz * 0.12 + 5, 2);
    if (moss > 0.58) { const k = Math.min(1, (moss - 0.58) * 4) * 0.45; r += (0.38 - r) * k; g += (0.48 - g) * k; b += (0.24 - b) * k; }
  } else if (ground === GROUND.SAND) {
    // ripples
    const rip = Math.sin(cx * 0.9 + noise.noise(cx * 0.1, cz * 0.1) * 6) * 0.025;
    r += rip; g += rip; b += rip;
  }
  // higher ground slightly lighter for readability
  const lift = 1 + Math.min(0.08, Math.max(-0.06, (level - 4) * 0.012));
  return [clamp01((r + j * r) * lift), clamp01((g + j * g) * lift), clamp01((b + j * b) * lift)];
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Seabed colour at a column corner; d = depth below the water surface in
// voxel levels (negative above water). Wet sand at the water line, pale sand in
// the shallows (reads turquoise through the water), then seagrass and rock.
const SEABED = [
  [-0.3, 0xcdb88a], [0.0, 0xa89066], [0.4, 0xd8c897], [2.0, 0xc4b889], [4.0, 0x8d9a72], [7.0, 0x5f6f5a], [12.0, 0x3f5250],
];
export function seabedColor(ix, iz, d, noise) {
  let i = 0;
  while (i < SEABED.length - 2 && d > SEABED[i + 1][0]) i++;
  const [d0, c0] = SEABED[i], [d1, c1] = SEABED[i + 1];
  const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  let [r, g, b] = lerpHex(c0, c1, t);
  if (d > 0.6) {
    // patches of seagrass and darker stones
    const weed = noise.fbm(ix * 0.09 + 500, iz * 0.09 + 200, 3);
    if (weed > 0.55) {
      const k = Math.min(1, (weed - 0.55) * 5) * 0.55 * Math.min(1, (d - 0.6) / 1.5);
      r += (0.33 - r) * k; g += (0.45 - g) * k; b += (0.27 - b) * k;
    }
    const st = noise.noise(ix * 0.35 + 40, iz * 0.35 + 900);
    if (st > 0.78) { const k = 0.8 + (1 - st) * 0.6; r *= k; g *= k; b *= k; }
  }
  const j = 1 + (hash2(ix, iz, 71) - 0.5) * 0.05;
  return [r * j, g * j, b * j];
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
  let strata = ((cy % 3) === 0 ? 0.9 : 1.0);
  if (pair === SIDE_ROCK) {
    // blocky boulders: each 2x2 block of cliff voxels shares a tone, with dark cracks between
    const blk = hash2((cx + cz) >> 1, cy >> 1, 41);
    strata *= 0.84 + blk * 0.26;
    if (hash2(cx * 5 + cz, cy, 43) > 0.9) strata *= 0.75;
  }
  const [r, g, b] = lerpHex(pair[0], pair[1], hash2(cx, cz + cy * 13, 3));
  return [r * strata * (1 + j), g * strata * (1 + j), b * strata * (1 + j)];
}
