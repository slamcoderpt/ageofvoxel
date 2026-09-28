#include "pathfinding.h"

#include <algorithm>
#include <cmath>

#include "constants.h"
#include "profile.h"

namespace aov {

static const double SQRT2 = 1.4142135623730951; // Math.SQRT2

void Pathfinder::init(GameMap *m, Profile *p) {
	map = m;
	prof = p;
	size_t n = (size_t)m->size * m->size;
	g_.assign(n, 0.f);
	parent_.assign(n, 0);
	stamp_.assign(n, 0);
	closed_.assign(n, 0);
	cur_stamp_ = 0;
	cache_.clear();
	cache_version_ = 0xffffffffu;
	calls = searches = cache_hits = expanded_total = 0;
	fdist_.assign(n, 0);
	fparent_.assign(n, -1);
	fstamp_.assign(n, 0);
	fclosed_.assign(n, 0);
	field_stamp_cur_ = 0;
	field_active_ = false;
	field_builds = field_paths = field_fallbacks = 0;
}

void Pathfinder::Heap::push(int32_t item, double key) {
	size_t i = items.size();
	items.push_back(item);
	keys.push_back(key);
	while (i > 0) {
		size_t p = (i - 1) >> 1;
		if (keys[p] <= key) break;
		items[i] = items[p];
		keys[i] = keys[p];
		i = p;
	}
	items[i] = item;
	keys[i] = key;
}

int32_t Pathfinder::Heap::pop() {
	int32_t top = items[0];
	int32_t last = items.back();
	double lk = keys.back();
	items.pop_back();
	keys.pop_back();
	if (!items.empty()) {
		size_t i = 0, n = items.size();
		while (true) {
			size_t l = 2 * i + 1, r = l + 1, m = i;
			double mk = lk;
			if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
			if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
			if (m == i) break;
			items[i] = items[m];
			keys[i] = keys[m];
			i = m;
		}
		items[i] = last;
		keys[i] = lk;
	}
	return top;
}

size_t Pathfinder::KeyHash::operator()(const Key &k) const {
	uint64_t h = (uint64_t)(uint32_t)k.st * 0x9E3779B97F4A7C15ull ^ ((uint64_t)(uint32_t)k.gt << 1) ^ k.has_rect;
	if (k.has_rect) {
		auto mix = [&](double d) { h = (h ^ std::hash<double>()(d)) * 0x100000001B3ull; };
		mix(k.rtx); mix(k.rtz); mix(k.rw); mix(k.rh);
	}
	return (size_t)(h ^ (h >> 29));
}

bool Pathfinder::nearest_walkable(int tx, int tz, int max_r, int &ox, int &oz) const {
	const GameMap &m = *map;
	if (prof && prof->enabled) prof->calls["nearestWalkable"].first++; // counted like the JS profiler (not timed)
	if (m.is_walkable(tx, tz)) { ox = tx; oz = tz; return true; }
	for (int r = 1; r <= max_r; r++) {
		bool any = false;
		int bx = 0, bz = 0, bd = 1000000000;
		for (int dz = -r; dz <= r; dz++)
			for (int dx = -r; dx <= r; dx++) {
				if (std::max(std::abs(dx), std::abs(dz)) != r) continue;
				if (m.is_walkable(tx + dx, tz + dz)) {
					int d = dx * dx + dz * dz;
					if (d < bd) { bd = d; bx = tx + dx; bz = tz + dz; any = true; }
				}
			}
		if (any) { ox = bx; oz = bz; return true; }
	}
	return false;
}

bool Pathfinder::line_walkable(int a, int b) const {
	const GameMap &m = *map;
	const int N = m.size;
	int x0 = a % N, z0 = a / N;
	const int x1 = b % N, z1 = b / N;
	const int dx = std::abs(x1 - x0), dz = std::abs(z1 - z0);
	const int sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
	int err = dx - dz;
	while (true) {
		if (!m.is_walkable(x0, z0)) return false;
		if (x0 == x1 && z0 == z1) return true;
		int e2 = 2 * err;
		if (e2 > -dz && e2 < dx) {
			if (!m.is_walkable(x0 + sx, z0) || !m.is_walkable(x0, z0 + sz)) return false;
		}
		if (e2 > -dz) { err -= dz; x0 += sx; }
		if (e2 < dx) { err += dx; z0 += sz; }
	}
}

void Pathfinder::search(int stx, int stz, int gtx, int gtz, const GoalRect *rect, Result &res) {
	searches++;
	const GameMap &m = *map;
	const int N = m.size;
	auto is_goal = [&](int x, int z) {
		if (rect) return x >= rect->tx - 1 && z >= rect->tz - 1 && x <= rect->tx + rect->w && z <= rect->tz + rect->h;
		return x == gtx && z == gtz;
	};
	auto h = [&](int x, int z) {
		double dx = std::abs(x - gtx), dz = std::abs(z - gtz);
		return (dx + dz) + (SQRT2 - 2) * std::min(dx, dz);
	};
	const uint32_t stamp = ++cur_stamp_;
	float *g = g_.data();
	int32_t *parent = parent_.data();
	uint32_t *st = stamp_.data(), *closed = closed_.data();
	heap_.clear();
	const int s = stz * N + stx;
	g[s] = 0;
	parent[s] = -1;
	st[s] = stamp;
	heap_.push(s, h(stx, stz));
	int found = -1, best_idx = s, expanded = 0;
	double best_h = h(stx, stz);
	static const int DX[8] = { 1, -1, 0, 0, 1, 1, -1, -1 };
	static const int DZ[8] = { 0, 0, 1, -1, 1, -1, 1, -1 };
	static const double COST[8] = { 1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2 };
	while (heap_.size()) {
		const int cur = heap_.pop();
		if (closed[cur] == stamp) continue;
		closed[cur] = stamp;
		const int cx = cur % N, cz = cur / N;
		if (is_goal(cx, cz)) { found = cur; break; }
		double hc = h(cx, cz);
		if (hc < best_h) { best_h = hc; best_idx = cur; }
		if (++expanded > max_nodes) break;
		for (int d = 0; d < 8; d++) {
			const int dx = DX[d], dz = DZ[d];
			const int nx = cx + dx, nz = cz + dz;
			if (!m.is_walkable(nx, nz)) continue;
			if (dx && dz && (!m.is_walkable(cx + dx, cz) || !m.is_walkable(cx, cz + dz))) continue;
			const int ni = nz * N + nx;
			if (closed[ni] == stamp) continue;
			const double ng = (double)g[cur] + COST[d];
			if (st[ni] != stamp || ng < (double)g[ni]) {
				st[ni] = stamp;
				g[ni] = (float)ng;
				parent[ni] = cur;
				heap_.push(ni, ng + h(nx, nz) * 1.001);
			}
		}
	}
	expanded_total += expanded;
	const int end = found >= 0 ? found : best_idx;
	tiles_.clear();
	for (int i = end; i != -1; i = parent[i]) tiles_.push_back(i);
	std::reverse(tiles_.begin(), tiles_.end());
	smooth(tiles_, res.pts);
	res.found = found >= 0;
}

void Pathfinder::smooth(const std::vector<int32_t> &tiles, std::vector<int32_t> &pts) const {
	pts.clear();
	int anchor = 0;
	for (int i = 2; i < (int)tiles.size(); i++) {
		if (!line_walkable(tiles[anchor], tiles[i])) {
			pts.push_back(tiles[i - 1]);
			anchor = i - 1;
		}
	}
	if (tiles.size() > 1) pts.push_back(tiles.back());
}

bool Pathfinder::start_tile(double sx, double sz, int &stx, int &stz) const {
	const GameMap &m = *map;
	const int N = m.size;
	stx = std::max(0, std::min(N - 1, (int)std::floor(sx / TILE)));
	stz = std::max(0, std::min(N - 1, (int)std::floor(sz / TILE)));
	if (!m.is_walkable(stx, stz)) {
		int wx, wz;
		if (nearest_walkable(stx, stz, 4, wx, wz)) { stx = wx; stz = wz; }
	}
	return m.is_walkable(stx, stz);
}

// Dijkstra from `goal` (8-connected, no corner cutting, the A* step costs)
// until every tile of `want` (sorted) is settled; returns how many were not.
int Pathfinder::run_field(int goal, const std::vector<int32_t> &want) {
	const GameMap &m = *map;
	const int N = m.size;
	const uint32_t stamp = ++field_stamp_cur_;
	int pending = (int)want.size();
	double *dist = fdist_.data();
	int32_t *parent = fparent_.data();
	uint32_t *st = fstamp_.data(), *closed = fclosed_.data();
	heap_.clear();
	dist[goal] = 0;
	parent[goal] = -1;
	st[goal] = stamp;
	heap_.push(goal, 0);
	static const int DX[8] = { 1, -1, 0, 0, 1, 1, -1, -1 };
	static const int DZ[8] = { 0, 0, 1, -1, 1, -1, 1, -1 };
	static const double COST[8] = { 1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2 };
	int expanded = 0;
	while (heap_.size() && pending > 0) {
		const int cur = heap_.pop();
		if (closed[cur] == stamp) continue;
		closed[cur] = stamp;
		if (std::binary_search(want.begin(), want.end(), cur)) pending--;
		if (++expanded > field_max_nodes) break;
		const int cx = cur % N, cz = cur / N;
		for (int d = 0; d < 8; d++) {
			const int dx = DX[d], dz = DZ[d];
			const int nx = cx + dx, nz = cz + dz;
			if (!m.is_walkable(nx, nz)) continue;
			if (dx && dz && (!m.is_walkable(cx + dx, cz) || !m.is_walkable(cx, cz + dz))) continue;
			const int ni = nz * N + nx;
			if (closed[ni] == stamp) continue;
			const double nd = dist[cur] + COST[d];
			if (st[ni] != stamp || nd < dist[ni]) {
				st[ni] = stamp;
				dist[ni] = nd;
				parent[ni] = cur;
				heap_.push(ni, nd);
			}
		}
	}
	expanded_total += expanded;
	return pending;
}

void Pathfinder::begin_group_field(double gx, double gz, const std::vector<Vec2d> &starts) {
	field_active_ = false;
	field_shift_x_ = field_shift_z_ = 0;
	const GameMap &m = *map;
	const int N = m.size;
	int gtx = std::max(0, std::min(N - 1, (int)std::floor(gx / TILE)));
	int gtz = std::max(0, std::min(N - 1, (int)std::floor(gz / TILE)));
	if (!m.is_walkable(gtx, gtz)) {
		int wx, wz;
		if (!nearest_walkable(gtx, gtz, 16, wx, wz)) return;
		gtx = wx;
		gtz = wz;
	}
	field_builds++;
	std::vector<int32_t> want;
	for (const Vec2d &p : starts) {
		int tx, tz;
		if (start_tile(p.x, p.z, tx, tz)) want.push_back(tz * N + tx);
	}
	std::sort(want.begin(), want.end());
	want.erase(std::unique(want.begin(), want.end()), want.end());
	int goal = gtz * N + gtx;
	if (run_field(goal, want) > 0 && !heap_.size() && [&] {
			int lost = 0;
			for (int32_t t : want) lost += fclosed_[t] != field_stamp_cur_;
			return lost * 2 > (int)want.size(); // most of the group, not a few stragglers
		}()) {
		// The destination's walkable region is closed off from (some of) the
		// movers (a clearing inside a forest, an island): send the group to the
		// tile nearest the destination that the unreached movers can reach
		// (explored from their side), formation shifted with it.
		std::vector<int32_t> lost;
		for (int32_t t : want)
			if (fclosed_[t] != field_stamp_cur_) lost.push_back(t);
		const uint32_t stamp = ++field_stamp_cur_;
		uint32_t *closed = fclosed_.data();
		std::vector<int32_t> queue(lost.begin(), lost.end());
		for (int32_t t : queue) closed[t] = stamp;
		int best = lost[0];
		double bd = 1e300;
		for (size_t qi = 0; qi < queue.size() && (int)qi < field_max_nodes; qi++) {
			const int cur = queue[qi];
			const int cx = cur % N, cz = cur / N;
			const double d = (double)(cx - gtx) * (cx - gtx) + (double)(cz - gtz) * (cz - gtz);
			if (d < bd) { bd = d; best = cur; }
			for (int dz = -1; dz <= 1; dz++)
				for (int dx = -1; dx <= 1; dx++) {
					if (!dx && !dz) continue;
					const int nx = cx + dx, nz = cz + dz;
					if (!m.is_walkable(nx, nz)) continue;
					if (dx && dz && (!m.is_walkable(cx + dx, cz) || !m.is_walkable(cx, cz + dz))) continue;
					const int ni = nz * N + nx;
					if (closed[ni] == stamp) continue;
					closed[ni] = stamp;
					queue.push_back(ni);
				}
		}
		field_shift_x_ = (best % N - gtx) * TILE;
		field_shift_z_ = (best / N - gtz) * TILE;
		goal = best;
		run_field(goal, want);
	}
	field_goal_ = goal;
	field_active_ = true;
}

bool Pathfinder::field_path(double sx, double sz, double gx, double gz, std::vector<Vec2d> &out) {
	const GameMap &m = *map;
	const int N = m.size;
	int stx, stz;
	if (!start_tile(sx, sz, stx, stz)) return false;
	const int s = stz * N + stx;
	if (fclosed_[s] != field_stamp_cur_) return false; // not reached by the field
	// the unit's own slot (moved with the destination when that was replaced)
	gx += field_shift_x_;
	gz += field_shift_z_;
	int gtx = std::max(0, std::min(N - 1, (int)std::floor(gx / TILE)));
	int gtz = std::max(0, std::min(N - 1, (int)std::floor(gz / TILE)));
	if (!m.is_walkable(gtx, gtz)) {
		int wx, wz;
		if (!nearest_walkable(gtx, gtz, 16, wx, wz)) return false;
		gtx = wx;
		gtz = wz;
		gx = (gtx + 0.5) * TILE;
		gz = (gtz + 0.5) * TILE;
	}
	const int slot = gtz * N + gtx;
	out.clear();
	if (s == slot) {
		out.push_back({ gx, gz });
		return true;
	}
	ftiles_.clear();
	for (int i = s; i != -1; i = fparent_[i]) ftiles_.push_back(i);
	if (slot != field_goal_) {
		if (line_walkable(field_goal_, slot)) ftiles_.push_back(slot);
		else {
			// slot behind an obstacle as seen from the destination: a short A*
			// from the destination tile to the slot finishes the chain
			Result leg;
			const int keep = max_nodes;
			max_nodes = 800; // slots sit round the destination: a leg is short or impossible
			search(field_goal_ % N, field_goal_ / N, gtx, gtz, nullptr, leg);
			max_nodes = keep;
			ftiles_.insert(ftiles_.end(), tiles_.begin() + 1, tiles_.end());
			if (!leg.found) {
				// slot walled off: stop on the nearest tile to it, like A* would
				const int e = ftiles_.back();
				gx = (e % N + 0.5) * TILE;
				gz = (e / N + 0.5) * TILE;
			}
		}
	}
	smooth(ftiles_, fpts_);
	for (int32_t i : fpts_) out.push_back({ (i % N + 0.5) * TILE, (i / N + 0.5) * TILE });
	if (!out.empty()) out.back() = { gx, gz };
	field_paths++;
	return true;
}

void Pathfinder::find_path(double sx, double sz, double gx, double gz, const GoalRect *rect, std::vector<Vec2d> &out) {
	Clock::time_point t0;
	const bool timed = prof && prof->enabled;
	if (timed) t0 = Clock::now();
	calls++;
	out.clear();
	if (field_active_ && !rect) {
		if (field_path(sx, sz, gx, gz, out)) {
			if (timed) {
				auto &c = prof->calls["findPath"];
				c.first++;
				c.second += ms_since(t0);
			}
			return;
		}
		field_fallbacks++;
	}
	const GameMap &m = *map;
	const int N = m.size;
	int stx = (int)std::floor(sx / TILE), stz = (int)std::floor(sz / TILE);
	stx = std::max(0, std::min(N - 1, stx));
	stz = std::max(0, std::min(N - 1, stz));
	if (!m.is_walkable(stx, stz)) {
		int wx, wz;
		if (nearest_walkable(stx, stz, 4, wx, wz)) { stx = wx; stz = wz; }
	}
	int gtx, gtz;
	bool ok = true;
	if (rect) {
		gtx = (int)std::floor(rect->tx + rect->w / 2);
		gtz = (int)std::floor(rect->tz + rect->h / 2);
	} else {
		gtx = (int)std::floor(gx / TILE);
		gtz = (int)std::floor(gz / TILE);
		gtx = std::max(0, std::min(N - 1, gtx));
		gtz = std::max(0, std::min(N - 1, gtz));
		if (!m.is_walkable(gtx, gtz)) {
			int wx, wz;
			if (!nearest_walkable(gtx, gtz, 16, wx, wz)) ok = false;
			else {
				gtx = wx;
				gtz = wz;
				gx = (gtx + 0.5) * TILE;
				gz = (gtz + 0.5) * TILE;
			}
		}
	}
	if (ok) {
		bool at_goal = rect ? (stx >= rect->tx - 1 && stz >= rect->tz - 1 && stx <= rect->tx + rect->w && stz <= rect->tz + rect->h)
							: (stx == gtx && stz == gtz);
		if (at_goal) {
			if (!rect) out.push_back({ gx, gz });
		} else {
			const Result *r;
			Result local;
			if (use_cache) {
				if (cache_version_ != m.pass_version || cache_.size() > 16384) {
					cache_.clear();
					cache_version_ = m.pass_version;
				}
				Key k{ stz * N + stx, gtz * N + gtx, (uint8_t)(rect ? 1 : 0), rect ? rect->tx : 0, rect ? rect->tz : 0, rect ? rect->w : 0, rect ? rect->h : 0 };
				auto it = cache_.find(k);
				if (it != cache_.end()) {
					cache_hits++;
					r = &it->second;
				} else {
					Result &slot = cache_[k];
					search(stx, stz, gtx, gtz, rect, slot);
					r = &slot;
				}
			} else {
				search(stx, stz, gtx, gtz, rect, local);
				r = &local;
			}
			out.reserve(r->pts.size());
			for (int32_t i : r->pts) out.push_back({ (i % N + 0.5) * TILE, (i / N + 0.5) * TILE });
			if (r->found && !rect && !out.empty()) out.back() = { gx, gz };
		}
	}
	if (timed) {
		auto &c = prof->calls["findPath"];
		c.first++;
		c.second += ms_since(t0);
	}
}

} // namespace aov
