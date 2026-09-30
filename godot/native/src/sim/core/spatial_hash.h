// Uniform-grid spatial hash over unit rows (port of src/core/SpatialHash.js).
// Rebuilt once per tick by Movement (living units only), stored flat
// (counting sort into one index array, no per-cell vectors), cells in row
// order so a query visits units in the same order as the JS closure did.
// It holds unit ROWS (not ids): valid until the next rebuild, since the
// entity store only compacts right before it. Positions are read live, like
// the JS hash that held object references.
//
// Bounds: a point off the map hashes into the nearest edge cell, and a query
// square is clipped to the grid (core/bounds.h cell_span); a query wholly off
// the grid visits nothing. (Before, for_each_near_xz clamped only one end of
// each range, so a query centre far off the map in x read start[] far out of
// range: the segfault of a unit spawned at x = 1e9.)
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "bounds.h"

namespace aov {

class SpatialHash {
public:
	double cell = 4;
	int n = 0;
	std::vector<int32_t> start; // n*n + 1
	std::vector<int32_t> items; // unit rows
	std::vector<double> px, pz, pr; // per item: position mirror, effective radius (0 -> 0.3)
	std::vector<int32_t> slot_of;   // row -> item index, -1 not hashed
	// census (scripts/godot-stress.mjs "census"), counted while `census` is on
	bool census = false;
	int64_t queries = 0, cells_scanned = 0, visited = 0;

	void init(double world_size, double cell_) {
		cell = cell_;
		n = (int)std::ceil(world_size / cell_);
		start.assign((size_t)n * n + 1, 0);
		items.clear();
	}
	int cell_of(double x, double z) const {
		return floor_clamp(z / cell, 0, n - 1) * n + floor_clamp(x / cell, 0, n - 1);
	}
	// rows: candidate rows in order; include(row) filters; X/Z arrays give positions.
	template <class Inc>
	void rebuild(int rows, const double *X, const double *Z, const double *R, Inc include) {
		std::fill(start.begin(), start.end(), 0);
		tmp_.resize(rows);
		int count = 0;
		for (int r = 0; r < rows; r++) {
			if (!include(r)) { tmp_[r] = -1; continue; }
			int c = cell_of(X[r], Z[r]);
			tmp_[r] = c;
			start[c + 1]++;
			count++;
		}
		for (int c = 0; c < n * n; c++) start[c + 1] += start[c];
		items.resize(count);
		px.resize(count);
		pz.resize(count);
		pr.resize(count);
		slot_of.assign(rows, -1);
		fill_.assign(start.begin(), start.end() - 1);
		for (int r = 0; r < rows; r++)
			if (tmp_[r] >= 0) {
				const int k = fill_[tmp_[r]]++;
				items[k] = r;
				slot_of[r] = k;
				px[k] = X[r];
				pz[k] = Z[r];
				pr[k] = R[r] != 0 ? R[r] : 0.3;
			}
	}
	// refresh the position mirror from the live arrays (rows moved since the rebuild)
	void sync(const double *X, const double *Z) {
		for (size_t k = 0; k < items.size(); k++) {
			px[k] = X[items[k]];
			pz[k] = Z[items[k]];
		}
	}
	// a hashed row moved: keep the mirror exact
	void moved(int row, double x, double z) {
		if (row >= 0 && row < (int)slot_of.size() && slot_of[row] >= 0) {
			px[slot_of[row]] = x;
			pz[slot_of[row]] = z;
		}
	}
	// fn(row, x, z, radius) for every unit whose cell overlaps the query
	// square, from the mirror (same units, same order as for_each_near)
	template <class F>
	void for_each_near_xz(double x, double z, double r, F fn) const {
		int x0, x1, z0, z1;
		if (!cell_span(x - r, x + r, cell, n, x0, x1) || !cell_span(z - r, z + r, cell, n, z0, z1)) return;
		const int32_t *it = items.data();
		const double *X = px.data(), *Z = pz.data(), *R = pr.data();
		for (int cz = z0; cz <= z1; cz++)
			for (int k = start[cz * n + x0], e = start[cz * n + x1 + 1]; k < e; k++) fn(it[k], X[k], Z[k], R[k]);
	}
	// fn(row) for every unit whose cell overlaps the query square (JS forEachNear)
	template <class F>
	void for_each_near(double x, double z, double r, F fn) const {
		int x0, x1, z0, z1;
		if (!cell_span(x - r, x + r, cell, n, x0, x1) || !cell_span(z - r, z + r, cell, n, z0, z1)) return;
		for (int cz = z0; cz <= z1; cz++)
			for (int cx = x0; cx <= x1; cx++) {
				int ci = cz * n + cx;
				for (int k = start[ci], e = start[ci + 1]; k < e; k++) fn(items[k]);
			}
	}
	void count_query(double x, double z, double r) {
		if (!census) return;
		queries++;
		int x0, x1, z0, z1;
		if (!cell_span(x - r, x + r, cell, n, x0, x1) || !cell_span(z - r, z + r, cell, n, z0, z1)) return;
		for (int cz = z0; cz <= z1; cz++)
			for (int cx = x0; cx <= x1; cx++) {
				cells_scanned++;
				visited += start[cz * n + cx + 1] - start[cz * n + cx];
			}
	}

private:
	std::vector<int32_t> tmp_, fill_;
};

} // namespace aov
