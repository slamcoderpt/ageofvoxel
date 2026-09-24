import { VOXEL, TILE } from './constants.js';
import { makeNoise2D, RNG } from './rng.js';

// Ground types stored per terrain column. The terrain piece maps these to
// colors/materials; gameplay only cares about height, water and passability.
export const GROUND = {
  GRASS: 0,
  DIRT: 1,
  SAND: 2,
  ROCK: 3,
  PAVED: 4,   // town plaza stone
  FARM: 5,    // tilled soil
  DRYGRASS: 6,
};

// The map: a heightfield of terrain columns (VOXEL wide) plus a coarser tile
// grid (TILE wide, 2x2 columns) used by pathfinding and building placement.
export class GameMap {
  constructor(sizeTiles, seed = 1) {
    this.size = sizeTiles;                 // tiles per side
    this.cps = Math.round(TILE / VOXEL);   // columns per tile side (2)
    this.cols = sizeTiles * this.cps;      // columns per side
    this.seed = seed;
    this.heights = new Int16Array(this.cols * this.cols);  // in voxel levels
    this.ground = new Uint8Array(this.cols * this.cols);
    this.waterLevel = 2;                   // columns with level < waterLevel are underwater
    this.passable = new Uint8Array(sizeTiles * sizeTiles);  // terrain-only passability
    this.blocked = new Uint16Array(sizeTiles * sizeTiles);  // occupancy refcount (buildings, trees, mines)
    this.blockers = new Map();             // tile index -> entity id (last blocker), for picking
    this.dirtyRegions = [];                // column rects changed since the terrain last rebuilt
    this.onChange = null;                  // callback(rect) set by Game
  }

  get worldSize() { return this.size * TILE; }
  cIdx(cx, cz) { return cz * this.cols + cx; }
  tIdx(tx, tz) { return tz * this.size + tx; }
  inCols(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.cols; }
  inTiles(tx, tz) { return tx >= 0 && tz >= 0 && tx < this.size && tz < this.size; }

  level(cx, cz) {
    cx = Math.max(0, Math.min(this.cols - 1, cx));
    cz = Math.max(0, Math.min(this.cols - 1, cz));
    return this.heights[cz * this.cols + cx];
  }
  groundAt(cx, cz) { return this.ground[this.cIdx(cx, cz)]; }
  // World-space top of the column under (x,z).
  heightAt(x, z) {
    const l = this.level(Math.floor(x / VOXEL), Math.floor(z / VOXEL));
    return Math.max(l, this.waterLevel - 0.3) * VOXEL;
  }
  // Smoothed height for things that should glide rather than step (camera).
  smoothHeightAt(x, z) {
    const fx = x / VOXEL - 0.5, fz = z / VOXEL - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0;
    const h = (a, b) => Math.max(this.level(a, b), this.waterLevel - 0.3);
    const top = h(x0, z0) * (1 - ax) + h(x0 + 1, z0) * ax;
    const bot = h(x0, z0 + 1) * (1 - ax) + h(x0 + 1, z0 + 1) * ax;
    return (top * (1 - az) + bot * az + 0.5) * VOXEL;
  }
  waterY() { return (this.waterLevel - 0.3) * VOXEL; }
  isWaterCol(cx, cz) { return this.level(cx, cz) < this.waterLevel; }

  tileOf(x, z) { return [Math.floor(x / TILE), Math.floor(z / TILE)]; }
  tileCenter(tx, tz) { return [(tx + 0.5) * TILE, (tz + 0.5) * TILE]; }

  isWalkable(tx, tz) {
    if (!this.inTiles(tx, tz)) return false;
    const i = tz * this.size + tx;
    return this.passable[i] === 1 && this.blocked[i] === 0;
  }
  isTerrainPassable(tx, tz) {
    return this.inTiles(tx, tz) && this.passable[tz * this.size + tx] === 1;
  }

  block(tx, tz, w, h, id = 0, delta = 1) {
    for (let z = tz; z < tz + h; z++)
      for (let x = tx; x < tx + w; x++) {
        if (!this.inTiles(x, z)) continue;
        const i = z * this.size + x;
        this.blocked[i] = Math.max(0, this.blocked[i] + delta);
        if (delta > 0) this.blockers.set(i, id);
        else if (this.blocked[i] === 0) this.blockers.delete(i);
      }
  }
  unblock(tx, tz, w, h) { this.block(tx, tz, w, h, 0, -1); }

  // Recompute terrain passability for a tile rect (inclusive-exclusive).
  computePassability(tx0 = 0, tz0 = 0, tx1 = this.size, tz1 = this.size) {
    const c = this.cps;
    for (let tz = Math.max(0, tz0); tz < Math.min(this.size, tz1); tz++)
      for (let tx = Math.max(0, tx0); tx < Math.min(this.size, tx1); tx++) {
        let mn = 1e9, mx = -1e9, water = false;
        for (let dz = -1; dz <= c; dz++)
          for (let dx = -1; dx <= c; dx++) {
            const cx = tx * c + dx, cz = tz * c + dz;
            const l = this.level(cx, cz);
            const inner = dx >= 0 && dz >= 0 && dx < c && dz < c;
            if (inner && l < this.waterLevel) water = true;
            if (l < mn) mn = l;
            if (l > mx) mx = l;
          }
        this.passable[tz * this.size + tx] = !water && mx - mn <= 2 ? 1 : 0;
      }
  }

  // Tile-rect average level (for building placement checks).
  tileRectStats(tx, tz, w, h) {
    let mn = 1e9, mx = -1e9, sum = 0, n = 0, water = false;
    for (let cz = tz * this.cps; cz < (tz + h) * this.cps; cz++)
      for (let cx = tx * this.cps; cx < (tx + w) * this.cps; cx++) {
        const l = this.level(cx, cz);
        mn = Math.min(mn, l); mx = Math.max(mx, l); sum += l; n++;
        if (l < this.waterLevel) water = true;
      }
    return { min: mn, max: mx, avg: sum / n, water };
  }

  // Flatten the columns of a tile rect (with a 1-column skirt) to one level.
  flattenTiles(tx, tz, w, h, level = null, groundType = null) {
    const st = this.tileRectStats(tx, tz, w, h);
    const L = level ?? Math.round(st.avg);
    const c = this.cps;
    for (let cz = tz * c - 1; cz < (tz + h) * c + 1; cz++)
      for (let cx = tx * c - 1; cx < (tx + w) * c + 1; cx++) {
        if (!this.inCols(cx, cz)) continue;
        const i = this.cIdx(cx, cz);
        const inner = cx >= tx * c && cz >= tz * c && cx < (tx + w) * c && cz < (tz + h) * c;
        if (inner) {
          this.heights[i] = L;
          if (groundType !== null) this.ground[i] = groundType;
        } else if (Math.abs(this.heights[i] - L) > 1) {
          this.heights[i] = this.heights[i] > L ? L + 1 : L - 1;
        }
      }
    this.computePassability(tx - 2, tz - 2, tx + w + 2, tz + h + 2);
    this.markDirty(tx * c - 2, tz * c - 2, (tx + w) * c + 2, (tz + h) * c + 2);
    return L;
  }

  paintTiles(tx, tz, w, h, groundType) {
    const c = this.cps;
    for (let cz = tz * c; cz < (tz + h) * c; cz++)
      for (let cx = tx * c; cx < (tx + w) * c; cx++)
        if (this.inCols(cx, cz)) this.ground[this.cIdx(cx, cz)] = groundType;
    this.markDirty(tx * c, tz * c, (tx + w) * c, (tz + h) * c);
  }

  markDirty(cx0, cz0, cx1, cz1) {
    const r = { cx0, cz0, cx1, cz1 };
    this.dirtyRegions.push(r);
    if (this.onChange) this.onChange(r);
  }
}

// ---------------------------------------------------------------------------
// Map generation. Deterministic for a given (seed, preset).
// Returns { map, starts: [{owner, tx, tz}], resources: [{type, tx, tz, variant}] }
// ---------------------------------------------------------------------------
export function generateMap({ seed = 1, size = 128, preset = 'skirmish' } = {}) {
  const map = new GameMap(size, seed);
  const rng = new RNG(seed);
  const n1 = makeNoise2D(seed * 7 + 1);
  const n2 = makeNoise2D(seed * 13 + 5);
  const n3 = makeNoise2D(seed * 31 + 9);
  const C = map.cols, cps = map.cps;
  const W = map.waterLevel;

  const starts = [];
  if (preset === 'coast') {
    starts.push({ owner: 1, tx: Math.round(size * 0.36), tz: Math.round(size * 0.5) });
    starts.push({ owner: 2, tx: Math.round(size * 0.2), tz: Math.round(size * 0.15) });
  } else {
    starts.push({ owner: 1, tx: Math.round(size * 0.27), tz: Math.round(size * 0.7) });
    starts.push({ owner: 2, tx: Math.round(size * 0.73), tz: Math.round(size * 0.3) });
  }

  // --- heights --------------------------------------------------------------
  for (let cz = 0; cz < C; cz++)
    for (let cx = 0; cx < C; cx++) {
      const u = cx / C, v = cz / C;
      let h = 3.5 + n1.fbm(u * 4, v * 4, 4) * 7 - 2.5;           // rolling base
      const plateau = n2.fbm(u * 3 + 10, v * 3 + 3, 3);
      if (plateau > 0.62) h += Math.min(1, (plateau - 0.62) * 25) * 6; // cliffs/plateaus
      if (preset === 'skirmish') {
        const lake = n3.fbm(u * 2.5 + 4, v * 2.5 + 8, 3);
        if (lake > 0.63) h -= (lake - 0.63) * 70;
      } else if (preset === 'battle') {
        h = 3.5 + (h - 3.5) * 0.45;
      } else if (preset === 'coast') {
        // Sea on the +x side with an irregular shoreline and headland cliffs.
        const shore = 0.6 + (n3.fbm(v * 3, 1.7, 3) - 0.5) * 0.25;
        const d = u - shore;
        if (d > 0) h -= d * 90;
        else if (d > -0.05 && n2.noise(v * 12, 3) > 0.55) h += 5; // cliffy headlands
      }
      // flatten starting areas
      for (const s of starts) {
        const dx = cx / cps - s.tx, dz = cz / cps - s.tz;
        const d = Math.sqrt(dx * dx + dz * dz);
        const R = 15;
        if (d < R + 8) {
          const t = Math.min(1, Math.max(0, (d - R) / 8));
          const target = 4.2;
          h = target + (h - target) * (t * t);
        }
      }
      // edges fall away gently so the map rim reads well
      map.heights[cz * C + cx] = Math.floor(h);
    }

  // --- ground types -------------------------------------------------------
  for (let cz = 0; cz < C; cz++)
    for (let cx = 0; cx < C; cx++) {
      const i = cz * C + cx;
      const l = map.heights[i];
      let g = GROUND.GRASS;
      const u = cx / C, v = cz / C;
      const dry = n2.fbm(u * 9 + 50, v * 9 + 20, 3);
      if (dry > 0.6) g = GROUND.DRYGRASS;
      const dirt = n3.fbm(u * 14 + 3, v * 14 + 70, 3);
      if (dirt > 0.66) g = GROUND.DIRT;
      // steepness -> rock
      let mx = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        mx = Math.max(mx, Math.abs(map.level(cx + dx, cz + dz) - l));
      if (mx >= 3) g = GROUND.ROCK;
      if (l >= 10) g = GROUND.ROCK;
      // sand near water
      if (l <= W + 1) {
        let nearWater = l < W;
        for (let dz = -3; dz <= 3 && !nearWater; dz++)
          for (let dx = -3; dx <= 3 && !nearWater; dx++)
            if (map.level(cx + dx, cz + dz) < W) nearWater = true;
        if (nearWater) g = GROUND.SAND;
      }
      map.ground[i] = g;
    }

  map.computePassability();

  // --- resources ------------------------------------------------------------
  const resources = [];
  const occupied = new Uint8Array(size * size);
  const nearStart = (tx, tz, r) => starts.some((s) => (s.tx - tx) ** 2 + (s.tz - tz) ** 2 < r * r);
  const place = (type, tx, tz, w = 1, h = 1, extra = {}) => {
    for (let z = tz; z < tz + h; z++)
      for (let x = tx; x < tx + w; x++) {
        if (!map.inTiles(x, z) || !map.isTerrainPassable(x, z) || occupied[z * size + x]) return false;
      }
    for (let z = tz; z < tz + h; z++) for (let x = tx; x < tx + w; x++) occupied[z * size + x] = 1;
    resources.push({ type, tx, tz, ...extra });
    return true;
  };

  // forests
  const forest = makeNoise2D(seed * 101 + 3);
  for (let tz = 1; tz < size - 1; tz++)
    for (let tx = 1; tx < size - 1; tx++) {
      if (nearStart(tx, tz, 17)) continue;
      if (preset === 'battle' && (tx - size / 2) ** 2 + (tz - size / 2) ** 2 < 26 * 26) continue;
      const f = forest.fbm(tx / size * 7, tz / size * 7, 4);
      const edge = Math.min(tx, tz, size - 1 - tx, size - 1 - tz) < 4 ? 0.12 : 0;
      if (f + edge > 0.6 && rng.chance(0.82)) place('tree', tx, tz, 1, 1, { variant: rng.int(0, 9) });
      else if (rng.chance(0.006)) place('tree', tx, tz, 1, 1, { variant: rng.int(0, 9) });
    }
  // start-area resources: forest line, gold, berries
  for (const s of starts) {
    const a0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 90; k++) {
      const a = a0 + rng.range(-0.7, 0.7);
      const r = rng.range(16, 21);
      place('tree', Math.round(s.tx + Math.cos(a) * r), Math.round(s.tz + Math.sin(a) * r), 1, 1, { variant: rng.int(0, 9) });
    }
    const ga = a0 + Math.PI * 0.75;
    place('gold', Math.round(s.tx + Math.cos(ga) * 12) - 1, Math.round(s.tz + Math.sin(ga) * 12) - 1, 3, 3);
    const ba = a0 - Math.PI * 0.7;
    const bx = Math.round(s.tx + Math.cos(ba) * 10), bz = Math.round(s.tz + Math.sin(ba) * 10);
    for (let k = 0; k < 7; k++) place('berry', bx + (k % 3) * 2 - 2, bz + Math.floor(k / 3) * 2 - 2);
  }
  // scattered gold
  for (let k = 0; k < 6; k++) {
    const tx = rng.int(8, size - 10), tz = rng.int(8, size - 10);
    if (!nearStart(tx, tz, 22)) place('gold', tx, tz, 3, 3);
  }

  return { map, starts, resources };
}
