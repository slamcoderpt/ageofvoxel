// Uniform-grid spatial hash over unit rows (port of src/core/SpatialHash.js).
// Rebuilt once per tick by Movement (living units only), stored flat
// (counting sort into one index array, no per-cell vectors), cells in row
// order so a query visits units in the same order as the JS closure did.
// It holds unit ROWS (not ids): valid until the next rebuild, since the
// entity store only compacts right before it. Positions are read live, like
// the JS hash that held object references.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

namespace aov {

class SpatialHash {
public:
	double cell = 4;
	int n = 0;
	std::vector<int32_t> start; // n*n + 1
	std::vector<int32_t> items; // unit rows
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
		int cx = std::max(0, std::min(n - 1, (int)std::floor(x / cell)));
		int cz = std::max(0, std::min(n - 1, (int)std::floor(z / cell)));
		return cz * n + cx;
	}
	// rows: candidate rows in order; include(row) filters; X/Z arrays give positions.
	template <class Inc>
	void rebuild(int rows, const double *X, const double *Z, Inc include) {
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
		fill_.assign(start.begin(), start.end() - 1);
		for (int r = 0; r < rows; r++)
			if (tmp_[r] >= 0) items[fill_[tmp_[r]]++] = r;
	}
	// fn(row) for every unit whose cell overlaps the query square (JS forEachNear)
	template <class F>
	void for_each_near(double x, double z, double r, F fn) const {
		const double c = cell;
		int x0 = std::max(0, (int)std::floor((x - r) / c)), x1 = std::min(n - 1, (int)std::floor((x + r) / c));
		int z0 = std::max(0, (int)std::floor((z - r) / c)), z1 = std::min(n - 1, (int)std::floor((z + r) / c));
		for (int cz = z0; cz <= z1; cz++)
			for (int cx = x0; cx <= x1; cx++) {
				int ci = cz * n + cx;
				for (int k = start[ci], e = start[ci + 1]; k < e; k++) fn(items[k]);
			}
	}
	void count_query(double x, double z, double r) {
		if (!census) return;
		queries++;
		const double c = cell;
		int x0 = std::max(0, (int)std::floor((x - r) / c)), x1 = std::min(n - 1, (int)std::floor((x + r) / c));
		int z0 = std::max(0, (int)std::floor((z - r) / c)), z1 = std::min(n - 1, (int)std::floor((z + r) / c));
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
