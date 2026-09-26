import { TILE } from './constants.js';

// Grid A* over the tile grid (8-connected, no corner cutting) with
// line-of-sight smoothing. Returns an array of world-space waypoints
// [{x, z}, ...] (excluding the start), or [] if already there.
//
// opts.goalRect = {tx, tz, w, h}: succeed on any walkable tile touching the
// rect (used to approach buildings, trees and mines). Without it, a blocked
// goal tile is replaced by the nearest walkable tile.

class Heap {
  constructor() { this.items = []; this.keys = []; }
  get size() { return this.items.length; }
  push(item, key) {
    const it = this.items, ks = this.keys;
    let i = it.length; it.push(item); ks.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= key) break;
      it[i] = it[p]; ks[i] = ks[p]; i = p;
    }
    it[i] = item; ks[i] = key;
  }
  pop() {
    const it = this.items, ks = this.keys;
    const top = it[0];
    const last = it.pop(), lk = ks.pop();
    if (it.length) {
      let i = 0; const n = it.length;
      while (true) {
        let l = 2 * i + 1, r = l + 1, m = i, mk = lk;
        if (l < n && ks[l] < mk) { m = l; mk = ks[l]; }
        if (r < n && ks[r] < mk) { m = r; mk = ks[r]; }
        if (m === i) break;
        it[i] = it[m]; ks[i] = ks[m]; i = m;
      }
      it[i] = last; ks[i] = lk;
    }
    return top;
  }
}

export class Pathfinder {
  constructor(map) {
    this.map = map;
    const n = map.size * map.size;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.curStamp = 0;
    this.maxNodes = 12000;
  }

  nearestWalkable(tx, tz, maxR = 12) {
    const m = this.map;
    if (m.isWalkable(tx, tz)) return [tx, tz];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (m.isWalkable(tx + dx, tz + dz)) {
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = [tx + dx, tz + dz]; }
          }
        }
      if (best) return best;
    }
    return null;
  }

  findPath(sx, sz, gx, gz, opts = {}) {
    const m = this.map, N = m.size;
    let [stx, stz] = m.tileOf(sx, sz);
    stx = Math.max(0, Math.min(N - 1, stx)); stz = Math.max(0, Math.min(N - 1, stz));
    if (!m.isWalkable(stx, stz)) {
      const w = this.nearestWalkable(stx, stz, 4);
      if (w) [stx, stz] = w;
    }
    const rect = opts.goalRect;
    let gtx, gtz;
    if (rect) {
      gtx = Math.floor(rect.tx + rect.w / 2); gtz = Math.floor(rect.tz + rect.h / 2);
    } else {
      [gtx, gtz] = m.tileOf(gx, gz);
      gtx = Math.max(0, Math.min(N - 1, gtx)); gtz = Math.max(0, Math.min(N - 1, gtz));
      if (!m.isWalkable(gtx, gtz)) {
        const w = this.nearestWalkable(gtx, gtz, 16);
        if (!w) return [];
        [gtx, gtz] = w;
        [gx, gz] = m.tileCenter(gtx, gtz);
      }
    }
    const isGoal = rect
      ? (x, z) => x >= rect.tx - 1 && z >= rect.tz - 1 && x <= rect.tx + rect.w && z <= rect.tz + rect.h
      : (x, z) => x === gtx && z === gtz;

    if (isGoal(stx, stz)) return rect ? [] : [{ x: gx, z: gz }];

    const stamp = ++this.curStamp;
    const g = this.g, parent = this.parent, st = this.stamp, closed = this.closed;
    const heap = new Heap();
    const h = (x, z) => {
      const dx = Math.abs(x - gtx), dz = Math.abs(z - gtz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const s = stz * N + stx;
    g[s] = 0; parent[s] = -1; st[s] = stamp;
    heap.push(s, h(stx, stz));
    let found = -1, bestIdx = s, bestH = h(stx, stz), expanded = 0;
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      const cx = cur % N, cz = (cur / N) | 0;
      if (isGoal(cx, cz)) { found = cur; break; }
      const hc = h(cx, cz);
      if (hc < bestH) { bestH = hc; bestIdx = cur; }
      if (++expanded > this.maxNodes) break;
      for (const [dx, dz, cost] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (!m.isWalkable(nx, nz)) continue;
        if (dx && dz && (!m.isWalkable(cx + dx, cz) || !m.isWalkable(cx, cz + dz))) continue;
        const ni = nz * N + nx;
        if (closed[ni] === stamp) continue;
        const ng = g[cur] + cost;
        if (st[ni] !== stamp || ng < g[ni]) {
          st[ni] = stamp; g[ni] = ng; parent[ni] = cur;
          heap.push(ni, ng + h(nx, nz) * 1.001);
        }
      }
    }
    const end = found >= 0 ? found : bestIdx;
    const tiles = [];
    for (let i = end; i !== -1; i = parent[i]) tiles.push(i);
    tiles.reverse();
    // smooth with line of sight
    const pts = [];
    let anchor = 0;
    for (let i = 2; i < tiles.length; i++) {
      if (!this.lineWalkable(tiles[anchor], tiles[i])) {
        pts.push(tiles[i - 1]);
        anchor = i - 1;
      }
    }
    if (tiles.length > 1) pts.push(tiles[tiles.length - 1]);
    const out = pts.map((i) => {
      const [x, z] = m.tileCenter(i % N, (i / N) | 0);
      return { x, z };
    });
    if (found >= 0 && !rect && out.length) out[out.length - 1] = { x: gx, z: gz };
    return out;
  }

  // Supercover line walk between two tile indices.
  lineWalkable(a, b) {
    const N = this.map.size;
    let x0 = a % N, z0 = (a / N) | 0;
    const x1 = b % N, z1 = (b / N) | 0;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    while (true) {
      if (!this.map.isWalkable(x0, z0)) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz && e2 < dx) {
        // diagonal step: require both orthogonal neighbours to be free
        if (!this.map.isWalkable(x0 + sx, z0) || !this.map.isWalkable(x0, z0 + sz)) return false;
      }
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
  }
}

export function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
export { TILE };
