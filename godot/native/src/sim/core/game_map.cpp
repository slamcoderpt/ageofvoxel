#include "game_map.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <queue>

#include "constants.h"
#include "jsmath.h"
#include "rng.h"

namespace aov {

GameMap::GameMap(int size_tiles, uint32_t seed_) : size(size_tiles), seed(seed_) {
	cps = (int)js_round(TILE / VOXEL);
	cols = size * cps;
	heights.assign((size_t)cols * cols, 0);
	ground.assign((size_t)cols * cols, 0);
	passable.assign((size_t)size * size, 0);
	blocked.assign((size_t)size * size, 0);
}

int GameMap::level(int cx, int cz) const {
	cx = std::max(0, std::min(cols - 1, cx));
	cz = std::max(0, std::min(cols - 1, cz));
	return heights[(size_t)cz * cols + cx];
}

double GameMap::height_at(double x, double z) const {
	int l = level((int)std::floor(x / VOXEL), (int)std::floor(z / VOXEL));
	return std::max((double)l, water_level - 0.3) * VOXEL;
}

double GameMap::smooth_height_at(double x, double z) const {
	double fx = x / VOXEL - 0.5, fz = z / VOXEL - 0.5;
	int x0 = (int)std::floor(fx), z0 = (int)std::floor(fz);
	double ax = fx - x0, az = fz - z0;
	auto h = [&](int a, int b) { return std::max((double)level(a, b), water_level - 0.3); };
	double top = h(x0, z0) * (1 - ax) + h(x0 + 1, z0) * ax;
	double bot = h(x0, z0 + 1) * (1 - ax) + h(x0 + 1, z0 + 1) * ax;
	return (top * (1 - az) + bot * az + 0.5) * VOXEL;
}

double GameMap::water_y() const { return (water_level - 0.3) * VOXEL; }

bool GameMap::is_walkable(int tx, int tz) const {
	if (!in_tiles(tx, tz)) return false;
	int i = tz * size + tx;
	return passable[i] == 1 && blocked[i] == 0;
}

bool GameMap::is_terrain_passable(int tx, int tz) const {
	return in_tiles(tx, tz) && passable[tz * size + tx] == 1;
}

void GameMap::block(int tx, int tz, int w, int h, int id, int delta) {
	pass_version++;
	for (int z = tz; z < tz + h; z++)
		for (int x = tx; x < tx + w; x++) {
			if (!in_tiles(x, z)) continue;
			int i = z * size + x;
			blocked[i] = (uint16_t)std::max(0, (int)blocked[i] + delta);
			if (delta > 0) blockers[i] = id;
			else if (blocked[i] == 0) blockers.erase(i);
		}
}

void GameMap::compute_passability(int tx0, int tz0, int tx1, int tz1) {
	pass_version++;
	int c = cps;
	for (int tz = std::max(0, tz0); tz < std::min(size, tz1); tz++)
		for (int tx = std::max(0, tx0); tx < std::min(size, tx1); tx++) {
			int mn = 1000000000, mx = -1000000000;
			bool water = false;
			for (int dz = -1; dz <= c; dz++)
				for (int dx = -1; dx <= c; dx++) {
					int l = level(tx * c + dx, tz * c + dz);
					bool inner = dx >= 0 && dz >= 0 && dx < c && dz < c;
					if (inner && l < water_level) water = true;
					mn = std::min(mn, l);
					mx = std::max(mx, l);
				}
			passable[tz * size + tx] = (!water && mx - mn <= 2) ? 1 : 0;
		}
}

GameMap::RectStats GameMap::tile_rect_stats(int tx, int tz, int w, int h) const {
	RectStats st{ 1000000000, -1000000000, 0, false };
	double sum = 0;
	int n = 0;
	for (int cz = tz * cps; cz < (tz + h) * cps; cz++)
		for (int cx = tx * cps; cx < (tx + w) * cps; cx++) {
			int l = level(cx, cz);
			st.min = std::min(st.min, l);
			st.max = std::max(st.max, l);
			sum += l;
			n++;
			if (l < water_level) st.water = true;
		}
	st.avg = sum / n;
	return st;
}

int GameMap::flatten_tiles(int tx, int tz, int w, int h, int lvl, int ground_type) {
	RectStats st = tile_rect_stats(tx, tz, w, h);
	int L = lvl != INT32_MIN ? lvl : (int)js_round(st.avg);
	int c = cps;
	for (int cz = tz * c - 1; cz < (tz + h) * c + 1; cz++)
		for (int cx = tx * c - 1; cx < (tx + w) * c + 1; cx++) {
			if (!in_cols(cx, cz)) continue;
			int i = c_idx(cx, cz);
			bool inner = cx >= tx * c && cz >= tz * c && cx < (tx + w) * c && cz < (tz + h) * c;
			if (inner) {
				heights[i] = (int16_t)L;
				if (ground_type >= 0) ground[i] = (uint8_t)ground_type;
			} else if (std::abs(heights[i] - L) > 1) {
				heights[i] = (int16_t)(heights[i] > L ? L + 1 : L - 1);
			}
		}
	compute_passability(tx - 2, tz - 2, tx + w + 2, tz + h + 2);
	mark_dirty(tx * c - 2, tz * c - 2, (tx + w) * c + 2, (tz + h) * c + 2);
	return L;
}

void GameMap::paint_tiles(int tx, int tz, int w, int h, int ground_type) {
	int c = cps;
	for (int cz = tz * c; cz < (tz + h) * c; cz++)
		for (int cx = tx * c; cx < (tx + w) * c; cx++)
			if (in_cols(cx, cz)) ground[c_idx(cx, cz)] = (uint8_t)ground_type;
	mark_dirty(tx * c, tz * c, (tx + w) * c, (tz + h) * c);
}

std::vector<Front> stress_fronts(const std::vector<Start> &starts) {
	std::vector<Front> out;
	size_t n = starts.size();
	for (size_t i = 0; i < n; i++) {
		const Start &a = starts[i], &b = starts[(i + 1) % n];
		out.push_back({ a.owner, b.owner, (a.tx + b.tx) / 2.0, (a.tz + b.tz) / 2.0 });
	}
	return out;
}

static const double PI = 3.141592653589793;

namespace {

// Godot-only pass (not in the browser's generateMap): make every start
// reachable on foot from the first one. The forest noise can close a band of
// trees across the whole map and a lake can cut it in two (skirmish seeds 1,
// 13, 16, 32, 37 of the first 40), and then attack waves walk to the nearest
// tile they can reach and stand there for the rest of the match. For each
// start that is cut off, the cheapest 4-connected route to the first start's
// region is found (open ground 1, a tree 6, water / cliff 25; mines and
// bushes are never crossed); the trees on and next to it are felled (a lane
// three tiles wide) and impassable stretches are graded into a ramp /
// causeway between the passable ground on either side. Repeats until every
// start is connected. Returns the number of trees felled; a map that is
// already connected is left untouched (so it stays identical to the JS).
struct ConnectResult { int felled = 0, graded = 0; };

ConnectResult connect_starts(GameMap &map, const std::vector<Start> &starts, std::vector<ResourceSpawn> &resources, std::vector<uint8_t> &occupied) {
	ConnectResult out;
	const int N = map.size;
	if (starts.size() < 2) return out;
	// tile -> resource index (every tile of a footprint)
	std::vector<int32_t> res_at((size_t)N * N, -1);
	std::vector<uint8_t> removed(resources.size(), 0);
	auto dims = [](const ResourceSpawn &r) { return r.type == "gold" ? 3 : 1; };
	for (size_t k = 0; k < resources.size(); k++) {
		const int d = dims(resources[k]);
		for (int z = resources[k].tz; z < resources[k].tz + d; z++)
			for (int x = resources[k].tx; x < resources[k].tx + d; x++)
				if (map.in_tiles(x, z)) res_at[(size_t)z * N + x] = (int32_t)k;
	}
	auto walk = [&](int i) { return map.passable[i] == 1 && !occupied[i]; };
	const int DX[4] = { 1, -1, 0, 0 }, DZ[4] = { 0, 0, 1, -1 };
	std::vector<uint8_t> comp;
	auto flood = [&]() {
		comp.assign((size_t)N * N, 0);
		const int s0 = starts[0].tz * N + starts[0].tx;
		std::vector<int> q{ s0 };
		comp[s0] = 1;
		for (size_t h = 0; h < q.size(); h++) {
			const int i = q[h], x = i % N, z = i / N;
			for (int k = 0; k < 4; k++) {
				const int nx = x + DX[k], nz = z + DZ[k];
				if (!map.in_tiles(nx, nz)) continue;
				const int j = nz * N + nx;
				if (comp[j] || !walk(j)) continue;
				comp[j] = 1;
				q.push_back(j);
			}
		}
	};
	for (int iter = 0; iter < 8 * (int)starts.size(); iter++) {
		flood();
		int src = -1;
		for (size_t k = 1; k < starts.size() && src < 0; k++) {
			const int i = starts[k].tz * N + starts[k].tx;
			if (!comp[i]) src = i;
		}
		if (src < 0) break;
		// Dijkstra from the cut-off start to the first start's region
		std::vector<double> dist((size_t)N * N, INFINITY);
		std::vector<int32_t> parent((size_t)N * N, -1);
		typedef std::pair<double, int> QE;
		std::priority_queue<QE, std::vector<QE>, std::greater<QE>> pq;
		dist[src] = 0;
		pq.push({ 0, src });
		int goal = -1;
		while (!pq.empty()) {
			const QE e = pq.top();
			pq.pop();
			const int i = e.second;
			if (e.first > dist[i]) continue;
			if (comp[i]) { goal = i; break; }
			const int x = i % N, z = i / N;
			for (int k = 0; k < 4; k++) {
				const int nx = x + DX[k], nz = z + DZ[k];
				if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue;
				const int j = nz * N + nx;
				double c;
				if (walk(j)) c = 1;
				else if (occupied[j]) {
					const int r = res_at[j];
					if (r < 0 || resources[r].type != "tree") continue;
					c = 6;
				} else c = 25;
				if (dist[i] + c < dist[j]) {
					dist[j] = dist[i] + c;
					parent[j] = i;
					pq.push({ dist[j], j });
				}
			}
		}
		if (goal < 0) break;
		std::vector<int> path; // src ... goal
		for (int i = goal; i >= 0; i = parent[i]) path.push_back(i);
		std::reverse(path.begin(), path.end());
		// fell the trees on the route and beside it
		for (int i : path)
			for (int dz = -1; dz <= 1; dz++)
				for (int dx = -1; dx <= 1; dx++) {
					const int x = i % N + dx, z = i / N + dz;
					if (!map.in_tiles(x, z)) continue;
					const int r = res_at[(size_t)z * N + x];
					if (r < 0 || removed[r] || resources[r].type != "tree") continue;
					removed[r] = 1;
					res_at[(size_t)z * N + x] = -1;
					occupied[(size_t)z * N + x] = 0;
					out.felled++;
				}
		// grade each impassable stretch into a ramp between the ground on either side
		auto level_of = [&](int i) { return (int)js_round(map.tile_rect_stats(i % N, i / N, 1, 1).avg); };
		for (size_t k = 0; k < path.size(); k++) {
			if (map.passable[path[k]] == 1) continue;
			size_t e = k;
			while (e + 1 < path.size() && map.passable[path[e + 1]] != 1) e++;
			const size_t j0 = k >= 3 ? k - 3 : 0, j1 = std::min(path.size() - 1, e + 3);
			const int a = std::max(map.water_level, level_of(path[j0])), b = std::max(map.water_level, level_of(path[j1]));
			for (size_t q = j0; q <= j1; q++) {
				const int L = std::max(map.water_level, (int)js_round(a + (double)(b - a) * (double)(q - j0) / (double)std::max<size_t>(1, j1 - j0)));
				map.flatten_tiles(path[q] % N - 1, path[q] / N - 1, 3, 3, L);
				out.graded++;
			}
			k = e;
		}
	}
	if (out.felled) {
		std::vector<ResourceSpawn> keep;
		for (size_t k = 0; k < resources.size(); k++)
			if (!removed[k]) keep.push_back(resources[k]);
		resources.swap(keep);
	}
	if (out.graded) map.compute_passability();
	map.changes.clear(); // (generation, not an edit: the renderer builds the whole map)
	return out;
}

// Godot-only pass: a woodline for every start. The browser's generator puts
// the start forest 16-21 tiles out, a long walk for the first villagers, so
// each start also gets a cluster of trees whose centres lie 8.5-13.5 tiles
// from the Town Center's centre: a band about 9 tiles along and 3 deep
// (WOOD_MIN..WOOD_MAX trees), ragged at its ends. Its direction is the one
// closest to the start forest's (a0) that stays 50 degrees clear of the start
// gold and berries and 40 degrees clear of the Town Center's south door
// (where villagers spawn and walk out). A tile must be open passable ground
// with no mine or bush in its 3x3; a candidate is rejected if it would cut
// any tile off from the start (flood fill before / after: only the trees'
// own tiles may leave the region), so paths, the gold and the berries stay
// reachable. Deterministic (its own RNG from the seed, drawn in start order).
constexpr int WOOD_MIN = 16, WOOD_MAX = 28;

int place_woodlines(GameMap &map, uint32_t seed, const std::vector<Start> &starts, const std::vector<double> &forest_dir,
		std::vector<ResourceSpawn> &resources, std::vector<uint8_t> &occupied) {
	const int N = map.size;
	RNG wr(seed * 2246822519u + 0x9e37u);
	// tiles next to a mine or a bush (keep a lane round them)
	std::vector<uint8_t> near_node((size_t)N * N, 0);
	for (const ResourceSpawn &r : resources) {
		if (r.type == "tree") continue;
		const int d = r.type == "gold" ? 3 : 1;
		for (int z = r.tz - 1; z <= r.tz + d; z++)
			for (int x = r.tx - 1; x <= r.tx + d; x++)
				if (map.in_tiles(x, z)) near_node[(size_t)z * N + x] = 1;
	}
	const int DX[4] = { 1, -1, 0, 0 }, DZ[4] = { 0, 0, 1, -1 };
	std::vector<uint8_t> seen;
	std::vector<int> q;
	auto flood = [&](int from) {
		seen.assign((size_t)N * N, 0);
		q.clear();
		if (map.passable[from] != 1 || occupied[from]) return 0;
		q.push_back(from);
		seen[from] = 1;
		for (size_t h = 0; h < q.size(); h++) {
			const int i = q[h], x = i % N, z = i / N;
			for (int k = 0; k < 4; k++) {
				const int nx = x + DX[k], nz = z + DZ[k];
				if (!map.in_tiles(nx, nz)) continue;
				const int j = nz * N + nx;
				if (seen[j] || map.passable[j] != 1 || occupied[j]) continue;
				seen[j] = 1;
				q.push_back(j);
			}
		}
		return (int)q.size();
	};
	auto adiff = [](double a, double b) {
		double d = std::fmod(std::fabs(a - b), PI * 2);
		return d > PI ? PI * 2 - d : d;
	};
	int placed_total = 0;
	for (size_t si = 0; si < starts.size(); si++) {
		const Start &s = starts[si];
		const double a0 = forest_dir[si];
		const double gold_a = a0 + PI * 0.75, berry_a = a0 - PI * 0.7, door_a = PI * 0.5; // +z: the TC's south side
		// 24 directions, best first: nearest the start forest's
		std::vector<std::pair<double, double>> dirs; // (score, angle)
		const double off = wr.range(-0.13, 0.13);
		for (int k = 0; k < 24; k++) {
			const double a = a0 + off + (k - 12) * (PI * 2 / 24);
			if (adiff(a, gold_a) < 0.87 || adiff(a, berry_a) < 0.87 || adiff(a, door_a) < 0.7) continue;
			dirs.push_back({ adiff(a, a0), a });
		}
		std::stable_sort(dirs.begin(), dirs.end(), [](const auto &p, const auto &q2) { return p.first < q2.first; });
		const int from = s.tz * N + s.tx;
		for (const auto &dir : dirs) {
			const double a = dir.second, ca = jsm::cos(a), sa = jsm::sin(a);
			std::vector<int> tiles;
			for (int dz = -14; dz <= 14; dz++)
				for (int dx = -14; dx <= 14; dx++) {
					const int x = s.tx + dx, z = s.tz + dz;
					if (!map.in_tiles(x, z) || x < 1 || z < 1 || x >= N - 1 || z >= N - 1) continue;
					const double r = std::sqrt((double)dx * dx + (double)dz * dz);
					const double along = -dx * sa + dz * ca;  // tangential offset
					const double out = dx * ca + dz * sa;     // radial, in the band's direction
					if (out <= 0 || r < 8.5 || r > 13.5 || std::fabs(along) > 5) continue;
					// ragged ends: thin the band's last tiles with a hash of the tile
					if (std::fabs(along) > 3.5 && hash2(x, z, (int32_t)(seed & 0x7fffffff)) < 0.45) continue;
					const size_t i = (size_t)z * N + x;
					if (map.passable[i] != 1 || occupied[i] || near_node[i]) continue;
					tiles.push_back((int)i);
				}
			if ((int)tiles.size() < WOOD_MIN) continue;
			if ((int)tiles.size() > WOOD_MAX) {
				// keep the ones nearest the band's middle circle (r = 11)
				std::stable_sort(tiles.begin(), tiles.end(), [&](int i1, int i2) {
					const double r1 = std::fabs(jsm::hypot(i1 % N - s.tx, i1 / N - s.tz) - 11), r2 = std::fabs(jsm::hypot(i2 % N - s.tx, i2 / N - s.tz) - 11);
					return r1 < r2;
				});
				tiles.resize(WOOD_MAX);
			}
			const int before = flood(from);
			if (!before) break;
			for (int i : tiles) occupied[i] = 1;
			const int after = flood(from);
			if (after != before - (int)tiles.size()) {
				for (int i : tiles) occupied[i] = 0; // it would wall something in: next direction
				continue;
			}
			std::sort(tiles.begin(), tiles.end()); // row order, like the generator's own trees
			for (int i : tiles) resources.push_back({ "tree", i % N, i / N, wr.int_(0, 9) });
			placed_total += (int)tiles.size();
			break;
		}
	}
	return placed_total;
}

} // namespace

MapGenResult generate_map(uint32_t seed, int size, const std::string &preset, int players, bool godot_passes) {
	MapGenResult R;
	R.map = GameMap(size, seed);
	GameMap &map = R.map;
	RNG rng(seed);
	Noise2D n1(seed * 7u + 1u), n2(seed * 13u + 5u), n3(seed * 31u + 9u);
	const int C = map.cols, cps = map.cps, W = map.water_level;
	auto &starts = R.starts;
	const bool stress = preset == "stress";
	if (stress) {
		double Rr = size * 0.34;
		for (int i = 0; i < players; i++) {
			double a = PI * 0.75 + ((double)i / players) * PI * 2;
			starts.push_back({ i + 1, (int)js_round(size / 2.0 + std::cos(a) * Rr), (int)js_round(size / 2.0 + std::sin(a) * Rr) });
		}
	} else if (preset == "coast") {
		starts.push_back({ 1, (int)js_round(size * 0.36), (int)js_round(size * 0.5) });
		starts.push_back({ 2, (int)js_round(size * 0.2), (int)js_round(size * 0.15) });
	} else {
		starts.push_back({ 1, (int)js_round(size * 0.27), (int)js_round(size * 0.7) });
		starts.push_back({ 2, (int)js_round(size * 0.73), (int)js_round(size * 0.3) });
	}

	// --- heights
	for (int cz = 0; cz < C; cz++)
		for (int cx = 0; cx < C; cx++) {
			double u = (double)cx / C, v = (double)cz / C;
			double h = 3.5 + n1.fbm(u * 4, v * 4, 4) * 7 - 2.5;
			double plateau = n2.fbm(u * 3 + 10, v * 3 + 3, 3);
			if (plateau > 0.62) h += std::min(1.0, (plateau - 0.62) * 25) * 6;
			if (preset == "skirmish") {
				double lake = n3.fbm(u * 2.5 + 4, v * 2.5 + 8, 3);
				if (lake > 0.63) h -= (lake - 0.63) * 70;
			} else if (preset == "battle" || stress) {
				h = 3.5 + (h - 3.5) * 0.45;
			} else if (preset == "coast") {
				double shore = 0.6 + (n3.fbm(v * 3, 1.7, 3) - 0.5) * 0.25;
				double d = u - shore;
				if (d > 0) h -= d * 90;
				else if (d > -0.05 && n2.noise(v * 12, 3) > 0.55) h += 5;
			}
			for (const Start &s : starts) {
				double dx = (double)cx / cps - s.tx, dz = (double)cz / cps - s.tz;
				double d = std::sqrt(dx * dx + dz * dz);
				double Rs = stress ? 26 : 15;
				if (d < Rs + 8) {
					double t = std::min(1.0, std::max(0.0, (d - Rs) / 8));
					double target = 4.2;
					h = target + (h - target) * (t * t);
				}
			}
			map.heights[(size_t)cz * C + cx] = (int16_t)(int32_t)std::floor(h);
		}

	// --- ground types
	static const int N4[4][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
	for (int cz = 0; cz < C; cz++)
		for (int cx = 0; cx < C; cx++) {
			size_t i = (size_t)cz * C + cx;
			int l = map.heights[i];
			uint8_t g = GRASS;
			double u = (double)cx / C, v = (double)cz / C;
			if (n2.fbm(u * 9 + 50, v * 9 + 20, 3) > 0.6) g = DRYGRASS;
			if (n3.fbm(u * 14 + 3, v * 14 + 70, 3) > 0.66) g = DIRT;
			int mx = 0;
			for (auto &o : N4) mx = std::max(mx, std::abs(map.level(cx + o[0], cz + o[1]) - l));
			if (mx >= 3) g = ROCK;
			if (l >= 10) g = ROCK;
			if (l <= W + 1) {
				bool near_water = l < W;
				for (int dz = -3; dz <= 3 && !near_water; dz++)
					for (int dx = -3; dx <= 3 && !near_water; dx++)
						if (map.level(cx + dx, cz + dz) < W) near_water = true;
				if (near_water) g = SAND;
			}
			map.ground[i] = g;
		}

	map.compute_passability();

	// --- resources
	auto &resources = R.resources;
	std::vector<uint8_t> occupied((size_t)size * size, 0);
	auto near_start = [&](int tx, int tz, double r) {
		for (const Start &s : starts)
			if (std::pow(s.tx - tx, 2) + std::pow(s.tz - tz, 2) < r * r) return true;
		return false;
	};
	std::vector<Front> fronts = stress ? stress_fronts(starts) : std::vector<Front>();
	auto near_front = [&](int tx, int tz) {
		for (const Front &f : fronts)
			if (std::pow(f.tx - tx, 2) + std::pow(f.tz - tz, 2) < 24 * 24) return true;
		return false;
	};
	auto place = [&](const char *type, int tx, int tz, int w, int h, int variant) {
		for (int z = tz; z < tz + h; z++)
			for (int x = tx; x < tx + w; x++)
				if (!map.in_tiles(x, z) || !map.is_terrain_passable(x, z) || occupied[(size_t)z * size + x]) return false;
		for (int z = tz; z < tz + h; z++)
			for (int x = tx; x < tx + w; x++) occupied[(size_t)z * size + x] = 1;
		resources.push_back({ type, tx, tz, variant });
		return true;
	};

	Noise2D forest(seed * 101u + 3u);
	for (int tz = 1; tz < size - 1; tz++)
		for (int tx = 1; tx < size - 1; tx++) {
			if (near_start(tx, tz, stress ? 28 : 17)) continue;
			if (stress && near_front(tx, tz)) continue;
			if (preset == "battle" && std::pow(tx - size / 2.0, 2) + std::pow(tz - size / 2.0, 2) < 26 * 26) continue;
			double f = forest.fbm((double)tx / size * 7, (double)tz / size * 7, 4);
			double edge = std::min(std::min(tx, tz), std::min(size - 1 - tx, size - 1 - tz)) < 4 ? 0.12 : 0;
			if (f + edge > 0.6 && rng.chance(0.82)) {
				int var = rng.int_(0, 9);
				place("tree", tx, tz, 1, 1, var);
			} else if (rng.chance(0.006)) {
				int var = rng.int_(0, 9);
				place("tree", tx, tz, 1, 1, var);
			}
		}
	std::vector<double> forest_dir; // each start forest's direction (the woodline pass)
	for (const Start &s : starts) {
		double a0 = rng.range(0, PI * 2);
		forest_dir.push_back(a0);
		for (int k = 0; k < 90; k++) {
			double a = a0 + rng.range(-0.7, 0.7);
			double r = rng.range(16, 21);
			int x = (int)js_round(s.tx + std::cos(a) * r), z = (int)js_round(s.tz + std::sin(a) * r);
			int var = rng.int_(0, 9);
			place("tree", x, z, 1, 1, var);
		}
		double ga = a0 + PI * 0.75;
		place("gold", (int)js_round(s.tx + std::cos(ga) * 12) - 1, (int)js_round(s.tz + std::sin(ga) * 12) - 1, 3, 3, 0);
		double ba = a0 - PI * 0.7;
		int bx = (int)js_round(s.tx + std::cos(ba) * 10), bz = (int)js_round(s.tz + std::sin(ba) * 10);
		for (int k = 0; k < 7; k++) place("berry", bx + (k % 3) * 2 - 2, bz + (k / 3) * 2 - 2, 1, 1, 0);
	}
	for (int k = 0; k < 6; k++) {
		int tx = rng.int_(8, size - 10);
		int tz = rng.int_(8, size - 10);
		if (!near_start(tx, tz, 22)) place("gold", tx, tz, 3, 3, 0);
	}
	// --- Godot-only from here on (the browser's generateMap stops above)
	if (!godot_passes) return R;
	const ConnectResult cr = connect_starts(map, starts, resources, occupied);
	R.felled = cr.felled;
	R.graded = cr.graded;
	R.woodline = place_woodlines(map, seed, starts, forest_dir, resources, occupied);
	return R;
}

} // namespace aov
