// AovSim: the GDScript-facing handle on the C++ simulation.
// Game code creates one (AovSim.new()), calls new_game(), then tick() at
// 30 Hz and reads state through the packed-array getters once per frame.
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/string.hpp>

#include "sim/sim.h"

namespace godot {

class AovSim : public RefCounted {
	GDCLASS(AovSim, RefCounted)

	aov::Sim sim_;

protected:
	static void _bind_methods();

public:
	String version() const;

	void new_game(int64_t seed, int64_t map_size, const String &preset, int64_t players);
	void tick(int64_t n);
	int64_t get_tick() const { return sim_.tick_count; }
	double get_time() const { return sim_.time; }
	int64_t get_seed() const { return sim_.seed; }

	// --- map
	int64_t get_map_size() const { return sim_.world.map.size; }
	int64_t get_map_cols() const { return sim_.world.map.cols; }
	int64_t get_water_level() const { return sim_.world.map.water_level; }
	PackedInt32Array get_heights() const;  // cols*cols voxel levels, row-major (z, x)
	PackedByteArray get_ground() const;    // cols*cols Ground enum
	PackedByteArray get_passable() const;  // size*size
	double height_at(double x, double z) const { return sim_.world.map.height_at(x, z); }
	double smooth_height_at(double x, double z) const { return sim_.world.map.smooth_height_at(x, z); }
	Array get_starts() const;              // [{owner, tx, tz}]
	Array get_resource_spawns() const;     // [{type, tx, tz, variant}]
	PackedInt32Array take_map_changes();   // dirty column rects (cx0,cz0,cx1,cz1)*, cleared on read
	int64_t map_hash() const;

	// --- profiling / stats (scripts/godot-stress.mjs)
	void set_profiling(bool on) { sim_.prof.enabled = on; }
	bool is_profiling() const { return sim_.prof.enabled; }
	Dictionary get_profile() const;  // {total, sys:{}, sub:{}, ai:{}, calls:{name:[n, ms]}} of the last tick
	Dictionary get_stats() const;    // {alive, dead, moving, buildings, projectiles}              // FNV-1a over heights+ground+resources (determinism checks)
};

} // namespace godot
