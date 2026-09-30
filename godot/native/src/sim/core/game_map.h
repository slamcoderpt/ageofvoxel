// The map: a heightfield of terrain columns (VOXEL wide) plus a coarser tile
// grid (TILE wide, 2x2 columns). Port of src/core/GameMap.js; generate_map()
// runs the browser's generateMap() bit for bit, then Godot-only passes (the
// browser build is frozen): every start connected on foot to the others and
// a woodline 8-14 tiles from every Town Center (scripts/check-mapgen.mjs
// compares the first part with the JS and checks the passes).
#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include "bounds.h"

namespace aov {

enum Ground : uint8_t { GRASS = 0, DIRT = 1, SAND = 2, ROCK = 3, PAVED = 4, FARM = 5, DRYGRASS = 6 };

struct MapChange { int cx0, cz0, cx1, cz1; };

class GameMap {
public:
	int size = 0;  // tiles per side
	int cps = 2;   // columns per tile side
	int cols = 0;  // columns per side
	uint32_t seed = 1;
	int water_level = 2; // columns with level < water_level are underwater
	std::vector<int16_t> heights; // cols*cols, in voxel levels
	std::vector<uint8_t> ground;  // cols*cols
	std::vector<uint8_t> passable; // size*size terrain-only passability
	std::vector<uint16_t> blocked; // size*size occupancy refcount
	std::unordered_map<int, int> blockers; // tile index -> entity id
	std::vector<MapChange> changes; // dirty column rects since the renderer last drained them
	uint32_t pass_version = 0; // bumped whenever walkability may change (block / passability): path cache key

	GameMap() = default;
	GameMap(int size_tiles, uint32_t seed);

	double world_size() const { return size; }
	int c_idx(int cx, int cz) const { return cz * cols + cx; }
	int t_idx(int tx, int tz) const { return tz * size + tx; }
	bool in_cols(int cx, int cz) const { return cx >= 0 && cz >= 0 && cx < cols && cz < cols; }
	bool in_tiles(int tx, int tz) const { return tx >= 0 && tz >= 0 && tx < size && tz < size; }
	int level(int cx, int cz) const;
	// ---- bounds (see core/bounds.h and PORTING.md "Map bounds"): the world
	// is [0, size) x [0, size); these never index out of range, whatever the
	// coordinate (off-map, huge, infinite, NaN).
	// inside the map (NaN: false)
	bool in_world(double x, double z) const { return x >= 0 && z >= 0 && x < size && z < size; }
	// a world coordinate's tile, clamped onto the map (NaN -> 0)
	int tile_clamp(double v) const { return floor_clamp(v, 0, size - 1); }
	// is_walkable(floor(x), floor(z)) for a world point (off-map / NaN: false)
	bool walkable_at(double x, double z) const {
		if (!in_world(x, z)) return false;
		const int i = (int)z * size + (int)x;
		return passable[i] == 1 && blocked[i] == 0;
	}
	// the column level under a world point (clamped to the edge column, like level())
	int level_at(double x, double z) const;
	// Move a world point onto the map: a point inside is left exactly as is,
	// a coordinate off the map goes to the centre of the edge tile (0.5 or
	// size - 0.5). false (point untouched) when x or z is NaN: callers reject.
	bool clamp_to_map(double &x, double &z) const {
		if (std::isnan(x) || std::isnan(z)) return false;
		if (!(x >= 0 && x < size)) x = x < 0 ? 0.5 : size - 0.5;
		if (!(z >= 0 && z < size)) z = z < 0 ? 0.5 : size - 0.5;
		return true;
	}
	// a w x h tile rect lies wholly on the map (overflow-safe)
	bool rect_in_tiles(long long tx, long long tz, int w, int h) const {
		return tx >= 0 && tz >= 0 && tx + w <= size && tz + h <= size;
	}
	double height_at(double x, double z) const;
	double smooth_height_at(double x, double z) const;
	double water_y() const;
	bool is_walkable(int tx, int tz) const;
	bool is_terrain_passable(int tx, int tz) const;
	void block(int tx, int tz, int w, int h, int id = 0, int delta = 1);
	void unblock(int tx, int tz, int w, int h) { block(tx, tz, w, h, 0, -1); }
	void compute_passability(int tx0, int tz0, int tx1, int tz1);
	void compute_passability() { compute_passability(0, 0, size, size); }
	struct RectStats { int min, max; double avg; bool water; };
	RectStats tile_rect_stats(int tx, int tz, int w, int h) const;
	int flatten_tiles(int tx, int tz, int w, int h, int level = INT32_MIN, int ground_type = -1);
	void paint_tiles(int tx, int tz, int w, int h, int ground_type);
	void mark_dirty(int cx0, int cz0, int cx1, int cz1) { changes.push_back({ cx0, cz0, cx1, cz1 }); }
};

struct Start { int owner, tx, tz; };
struct ResourceSpawn { std::string type; int tx, tz, variant; };
struct Front { int a, b; double tx, tz; };

struct MapGenResult {
	GameMap map;
	std::vector<Start> starts;
	std::vector<ResourceSpawn> resources;
	// Godot-only passes (see generate_map): trees felled / tiles graded to
	// connect the starts (0 on a map that was already connected)
	int felled = 0, graded = 0;
	int woodline = 0; // trees of the start woodlines (appended after the generator's resources)
};

std::vector<Front> stress_fronts(const std::vector<Start> &starts);
// preset: skirmish | battle | coast | stress | (anything else: plain).
// godot_passes = false: the browser's generateMap() only (bit-exact, for
// scripts/check-mapgen.mjs / check-sim.mjs).
MapGenResult generate_map(uint32_t seed = 1, int size = 128, const std::string &preset = "skirmish", int players = 2, bool godot_passes = true);

} // namespace aov
