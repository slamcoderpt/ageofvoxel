// Grid A* over the tile grid (8-connected, no corner cutting) with
// line-of-sight smoothing: bit-exact port of src/core/pathfinding.js
// (Float32 g-costs, the same binary heap and tie order, the same smoothing).
//
// Scaling additions (results identical to the JS):
// - Search results are cached by (start tile, goal tile, goal rect) while
//   the map's passability is unchanged (GameMap::pass_version): the output
//   of findPath depends on the start / goal points only through their tiles,
//   so units of a group standing on the same tile share one search.
// - Group fields (opt-in, NOT bit-exact with the JS): for a formation move of
//   `group_min` or more units, Commands builds one Dijkstra field from the
//   destination (stopping once every mover's tile is settled) and each unit
//   follows its parent chain, smoothed like A*, then steps to its own slot.
//   One search instead of one per unit (600 units: ~500 ms -> a few ms).
//   A slot out of sight of the destination gets a short A* leg; when the
//   destination is walled off from the movers (a clearing in a forest), the
//   group heads for the nearest tile they can reach, formation shifted with
//   it. Units the field cannot serve fall back to their own A*. Off by default
//   (group_min = 0) so the sim stays bit-exact with the browser; the UI turns
//   it on for interactive play (AovSim.set_group_paths).
// - Waypoint lists live in a PathPool (reused vectors, handle per unit), not
//   in per-unit heap objects.
#pragma once
#include <cstdint>
#include <unordered_map>
#include <vector>

#include "game_map.h"

namespace aov {

struct Profile;

struct Vec2d { double x, z; };

struct GoalRect {
	double tx = 0, tz = 0, w = 0, h = 0;
};

class PathPool {
public:
	std::vector<std::vector<Vec2d>> paths;
	std::vector<int32_t> free_list;
	int32_t alloc() {
		if (!free_list.empty()) {
			int32_t h = free_list.back();
			free_list.pop_back();
			paths[h].clear();
			return h;
		}
		paths.emplace_back();
		return (int32_t)paths.size() - 1;
	}
	void release(int32_t h) {
		if (h < 0) return;
		paths[h].clear();
		free_list.push_back(h);
	}
	std::vector<Vec2d> &at(int32_t h) { return paths[h]; }
	const std::vector<Vec2d> &at(int32_t h) const { return paths[h]; }
	void reset() { paths.clear(); free_list.clear(); }
	int live() const { return (int)(paths.size() - free_list.size()); }
};

class Pathfinder {
public:
	GameMap *map = nullptr;
	Profile *prof = nullptr;
	int max_nodes = 12000;
	bool use_cache = true;
	// counters (reset by the caller when it wants per-tick numbers)
	int64_t calls = 0, searches = 0, cache_hits = 0, expanded_total = 0;

	void init(GameMap *m, Profile *p);
	// Gates (Godot-only, sim/fortify): the owner whose units the next
	// find_path / begin_group_field is for; that owner's (and his allies')
	// gate tiles are walkable for it (GameMap::walkable_for). -1 = nobody
	// passes gates. Callers set it before each search (Movement: the unit's
	// owner); with no gate on the map it changes nothing.
	int pass_owner = -1;
	// did the last find_path reach its goal (or stand on it)? false when the
	// goal is cut off (a wall ring, an island): the fortify breach rule.
	bool last_found = true;
	// JS nearestWalkable: returns false if none within maxR (gates count as blocked)
	bool nearest_walkable(int tx, int tz, int max_r, int &ox, int &oz) const { return nearest_impl(tx, tz, max_r, ox, oz, false); }
	// JS findPath: fills `out` with world waypoints (excluding the start);
	// empty if already there / unreachable goal.
	void find_path(double sx, double sz, double gx, double gz, const GoalRect *rect, std::vector<Vec2d> &out);
	bool line_walkable(int a, int b) const;

	// --- group fields (see above)
	int group_min = 0;       // 0 = off (JS-exact)
	int field_max_nodes = 90000;
	int64_t field_builds = 0, field_paths = 0, field_fallbacks = 0;
	// Build a field towards world point (gx, gz) covering the given start
	// points; while active, find_path() without a rect serves from it.
	void begin_group_field(double gx, double gz, const std::vector<Vec2d> &starts);
	void end_group_field() { field_active_ = false; }

private:
	struct Heap {
		std::vector<int32_t> items;
		std::vector<double> keys;
		void clear() { items.clear(); keys.clear(); }
		size_t size() const { return items.size(); }
		void push(int32_t item, double key);
		int32_t pop();
	};
	struct Key {
		int32_t st, gt;
		uint8_t has_rect;
		int8_t po; // pass_owner while the map has gates, else -1
		double rtx, rtz, rw, rh;
		bool operator==(const Key &o) const {
			return st == o.st && gt == o.gt && has_rect == o.has_rect && po == o.po && rtx == o.rtx && rtz == o.rtz && rw == o.rw && rh == o.rh;
		}
	};
	struct KeyHash {
		size_t operator()(const Key &k) const;
	};
	struct Result {
		std::vector<int32_t> pts; // smoothed tile indices
		bool found;
	};
	std::vector<float> g_;
	std::vector<int32_t> parent_;
	std::vector<uint32_t> stamp_, closed_;
	uint32_t cur_stamp_ = 0;
	Heap heap_;
	std::vector<int32_t> tiles_;
	std::unordered_map<Key, Result, KeyHash> cache_;
	uint32_t cache_version_ = 0xffffffffu;

	// walkability for the current search: gates open to pass_owner
	bool walk(int x, int z) const { return pass_owner < 0 || map->gate_tiles == 0 ? map->is_walkable(x, z) : map->walkable_for(x, z, pass_owner); }
	bool nearest_impl(int tx, int tz, int max_r, int &ox, int &oz, bool gates) const;
	void search(int stx, int stz, int gtx, int gtz, const GoalRect *rect, Result &res);
	void smooth(const std::vector<int32_t> &tiles, std::vector<int32_t> &pts) const;
	bool start_tile(double sx, double sz, int &stx, int &stz) const;
	bool field_path(double sx, double sz, double gx, double gz, std::vector<Vec2d> &out);

	int run_field(int goal, const std::vector<int32_t> &want);
	bool field_active_ = false;
	double field_shift_x_ = 0, field_shift_z_ = 0;
	int field_goal_ = -1;
	uint32_t field_stamp_cur_ = 0;
	std::vector<double> fdist_;
	std::vector<int32_t> fparent_;
	std::vector<uint32_t> fstamp_, fclosed_;
	std::vector<int32_t> ftiles_, fpts_;
};

} // namespace aov
