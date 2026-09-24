// Uniform-grid spatial hash for fast neighbour queries. Rebuilt every tick
// for units (cheap for a few thousand entities).
export class SpatialHash {
  constructor(worldSize, cell = 4) {
    this.cell = cell;
    this.n = Math.ceil(worldSize / cell);
    this.cells = new Array(this.n * this.n);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
  }
  clear() { for (const c of this.cells) c.length = 0; }
  _i(x, z) {
    const cx = Math.max(0, Math.min(this.n - 1, Math.floor(x / this.cell)));
    const cz = Math.max(0, Math.min(this.n - 1, Math.floor(z / this.cell)));
    return cz * this.n + cx;
  }
  insert(e) { this.cells[this._i(e.x, e.z)].push(e); }
  // Calls fn(e) for every entity whose cell overlaps the query circle.
  forEachNear(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.n - 1, Math.floor((x + r) / c));
    const z0 = Math.max(0, Math.floor((z - r) / c)), z1 = Math.min(this.n - 1, Math.floor((z + r) / c));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cz * this.n + cx];
        for (let i = 0; i < cell.length; i++) fn(cell[i]);
      }
  }
  near(x, z, r, pred) {
    const out = [];
    const r2 = r * r;
    this.forEachNear(x, z, r, (e) => {
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz <= r2 && (!pred || pred(e))) out.push(e);
    });
    return out;
  }
}
