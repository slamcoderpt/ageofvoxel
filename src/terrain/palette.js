import { GROUND } from '../core/GameMap.js';
import { hash2 } from '../core/rng.js';

// Ground palette (sRGB hex). Two tones per ground type are blended by
// low-frequency noise, then each voxel gets a small random jitter.
export const GROUND_COLORS = {
  [GROUND.GRASS]: [0x44722a, 0x789838],
  [GROUND.DRYGRASS]: [0x7f913c, 0xa19f50],
  [GROUND.DIRT]: [0x9a7447, 0xb58b58],
  [GROUND.SAND]: [0xd9c48c, 0xe8d7a3],
  [GROUND.ROCK]: [0x807b6b, 0xa29c86],
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
    // weathered limestone in irregular slabs (noise-warped 3x3 cells) with
    // dark joints, warm dirt pockets, moss and patches of wiry grass
    const wx = cx + noise.noise(cx * 0.19 + 11, cz * 0.19) * 2.4;
    const wz = cz + noise.noise(cx * 0.19 + 77, cz * 0.19 + 5) * 2.4;
    const sx = Math.floor(wx / 3), sz = Math.floor(wz / 3);
    const slab = hash2(sx, sz, 19);
    const k = 0.84 + slab * 0.28;
    r *= k; g *= k; b *= k;
    const fx = wx / 3 - sx, fz = wz / 3 - sz;
    if (fx < 0.2 || fz < 0.2) { r *= 0.8; g *= 0.79; b *= 0.78; } // joints
    const g2 = (hash2(cx * 3, cz * 5, 19) - 0.5) * 0.08;
    r *= 1 + g2; g *= 1 + g2; b *= 1 + g2;
    const soil = noise.fbm(cx * 0.07 + 140, cz * 0.07 + 40, 3);
    if (soil > 0.4) {
      // dirt pockets fading into dry grass
      const kd = Math.min(1, (soil - 0.4) * 5);
      const grassy = Math.min(1, Math.max(0, (soil - 0.47) * 5));
      const tr = 0.56 + (0.4 - 0.56) * grassy, tg = 0.44 + (0.52 - 0.44) * grassy, tb = 0.29 + (0.19 - 0.29) * grassy;
      const kk = kd * (0.75 + hash2(cx, cz, 23) * 0.25);
      r += (tr - r) * kk; g += (tg - g) * kk; b += (tb - b) * kk;
    }
    // wiry grass reclaiming the plateau in drifts
    const drift = noise.fbm(cx * 0.16 + 400, cz * 0.16 + 120, 2);
    if (drift > 0.52) {
      const kg = Math.min(1, (drift - 0.52) * 6) * (0.7 + hash2(cx, cz, 29) * 0.3);
      r += (0.46 - r) * kg; g += (0.54 - g) * kg; b += (0.22 - b) * kg;
    }
    const moss = noise.fbm(cx * 0.12 + 70, cz * 0.12 + 5, 2);
    if (moss > 0.6) { const km = Math.min(1, (moss - 0.6) * 4) * 0.4; r += (0.36 - r) * km; g += (0.45 - g) * km; b += (0.22 - b) * km; }
  } else if (ground === GROUND.SAND) {
    // ripples
    const rip = Math.sin(cx * 0.9 + noise.noise(cx * 0.1, cz * 0.1) * 6) * 0.025;
    r += rip; g += rip; b += rip;
  }
  // higher ground slightly lighter for readability
  const lift = 1 + Math.min(ground === GROUND.ROCK ? 0.02 : 0.08, Math.max(-0.06, (level - 4) * 0.012));
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

// Cliff wall colour for one voxel of a side face.
//   ground: ground type of the column on top; depth: rows below the lip (0 =
//   the lip row); drop: height of the wall in levels; u: horizontal voxel
//   coordinate along the face; k: absolute voxel level (for strata).
// Tall walls get a grass lip, a root-laced topsoil row, then horizontal strata
// of sandstone / grey limestone / ochre earth / dark shale broken into
// irregular blocks with dark joints. Short 1-level steps stay grass + earth.
const STRATA_LIGHT = [0xbfa67e, 0xa99f8e, 0xc7b08a];
const STRATA_DARK = [0x8c6a47, 0x6f665c, 0x7d5d42];
const EARTH = 0x6b4c31, ROOT = 0x4a3524, MOSS = 0x55702e;
export function cliffColor(ground, depth, drop, u, k, cx, cz, noise) {
  const grassy = ground === GROUND.GRASS || ground === GROUND.DRYGRASS;
  const j = 1 + (hash2(u * 7 + k, cx * 3 + cz - k, 31) - 0.5) * 0.1;
  if (depth === 0 && (grassy || (ground === GROUND.ROCK && hash2(u, k, 5) > 0.6))) {
    const c = GROUND_COLORS[grassy ? ground : GROUND.GRASS][0];
    const [r, g, b] = lerpHex(c, c, 0);
    return [r * 0.95 * j, g * 0.95 * j, b * 0.95 * j];
  }
  if (ground === GROUND.SAND) {
    const [r, g, b] = lerpHex(UNDERWATER[0], UNDERWATER[1], hash2(cx, cz + k * 13, 3));
    const s = (k % 2 === 0 ? 0.93 : 1.0) * j;
    return [r * s, g * s, b * s];
  }
  if (drop <= 2 && ground !== GROUND.ROCK) {
    // short step: topsoil
    const [r, g, b] = lerpHex(SIDE_DIRT[0], SIDE_DIRT[1], hash2(u, k * 13, 3));
    const s = (depth === 1 ? 0.88 : 1.0) * j;
    return [r * s, g * s, b * s];
  }
  if (depth === 1 && grassy) {
    // topsoil with roots and moss drips from the lip
    const h = hash2(u, k, 61);
    const hex = h < 0.28 ? MOSS : h < 0.5 ? ROOT : EARTH;
    const [r, g, b] = lerpHex(hex, hex, 0);
    return [r * j, g * j, b * j];
  }
  // strata: bands follow absolute height, gently undulating along the wall
  const wob = noise ? noise.noise(cx * 0.045 + 3, cz * 0.045 + 9) * 2.2 : 0;
  const band = Math.floor((k + wob) / 2 + 100);
  const set = band % 2 === 0 ? STRATA_LIGHT : STRATA_DARK;
  const tone = set[Math.floor(hash2(band, 3, 91) * 3) % 3];
  // blocks of 2-4 voxels per band with staggered joints
  const bw = 2 + Math.floor(hash2(band, 7, 93) * 3);
  const uu = u + Math.floor(hash2(band, 11, 95) * 4);
  const blk = Math.floor(uu / bw);
  let s = 0.9 + hash2(blk, band, 97) * 0.16;
  if (uu - blk * bw === 0 && hash2(blk, band, 99) > 0.5) s *= 0.78; // vertical joint
  if ((k + wob) / 2 + 100 - band < 0.26) s *= 0.8; // bedding plane
  if (hash2(u * 5 + k, cz + cx, 43) > 0.93) s *= 0.7; // pits
  let [r, g, b] = lerpHex(tone, tone, 0);
  // moss creeping down from the top on grassy cliffs
  if (grassy && depth <= 3 && hash2(u, k, 67) < 0.35 - depth * 0.1) { r += (0.34 - r) * 0.55; g += (0.44 - g) * 0.55; b += (0.2 - b) * 0.55; }
  return [r * s * j, g * s * j, b * s * j];
}
