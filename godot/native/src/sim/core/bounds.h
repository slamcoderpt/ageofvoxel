// Map bounds: the one place a world coordinate becomes a grid index.
//
// Policy (PORTING.md "Map bounds"): the world is [0, size) x [0, size) in
// tiles. Every grid the sim keeps (map columns and tiles, fog, spatial hash,
// resource index, AI reach cells, A* arrays) is indexed through these
// helpers or GameMap's (in_world, walkable_at, level_at, tile_clamp,
// clamp_to_map), so an off-map, huge, infinite or NaN coordinate never
// becomes an out-of-range index or an undefined float -> int conversion.
// Both helpers clamp in double before the cast; for an in-range value they
// give exactly (int)std::floor(v), so in-map results (and parity with the
// browser) are unchanged.
#pragma once
#include <cmath>

namespace aov {

// floor(v) clamped to [lo, hi] (NaN -> lo).
inline int floor_clamp(double v, int lo, int hi) {
	const double f = std::floor(v);
	if (!(f >= lo)) return lo;
	if (f > hi) return hi;
	return (int)f;
}

// Cells [a, b] covered by the interval [lo, hi] on a grid of n cells of
// size `cell` (cell 0 starts at 0): false when the interval misses the grid
// altogether (or is NaN), so the caller loops over nothing.
inline bool cell_span(double lo, double hi, double cell, int n, int &a, int &b) {
	const double fa = std::floor(lo / cell), fb = std::floor(hi / cell);
	if (!(fb >= 0 && fa <= n - 1)) return false;
	a = fa > 0 ? (int)fa : 0;
	b = fb < n - 1 ? (int)fb : n - 1;
	return true;
}

} // namespace aov
