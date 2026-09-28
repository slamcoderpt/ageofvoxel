#include "aov_sim.h"

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/dictionary.hpp>

using namespace godot;

void AovSim::_bind_methods() {
	ClassDB::bind_method(D_METHOD("version"), &AovSim::version);
	ClassDB::bind_method(D_METHOD("new_game", "seed", "map_size", "preset", "players"), &AovSim::new_game, DEFVAL(128), DEFVAL("skirmish"), DEFVAL(2));
	ClassDB::bind_method(D_METHOD("tick", "n"), &AovSim::tick, DEFVAL(1));
	ClassDB::bind_method(D_METHOD("get_tick"), &AovSim::get_tick);
	ClassDB::bind_method(D_METHOD("get_time"), &AovSim::get_time);
	ClassDB::bind_method(D_METHOD("get_seed"), &AovSim::get_seed);
	ClassDB::bind_method(D_METHOD("get_map_size"), &AovSim::get_map_size);
	ClassDB::bind_method(D_METHOD("get_map_cols"), &AovSim::get_map_cols);
	ClassDB::bind_method(D_METHOD("get_water_level"), &AovSim::get_water_level);
	ClassDB::bind_method(D_METHOD("get_heights"), &AovSim::get_heights);
	ClassDB::bind_method(D_METHOD("get_ground"), &AovSim::get_ground);
	ClassDB::bind_method(D_METHOD("get_passable"), &AovSim::get_passable);
	ClassDB::bind_method(D_METHOD("height_at", "x", "z"), &AovSim::height_at);
	ClassDB::bind_method(D_METHOD("smooth_height_at", "x", "z"), &AovSim::smooth_height_at);
	ClassDB::bind_method(D_METHOD("get_starts"), &AovSim::get_starts);
	ClassDB::bind_method(D_METHOD("get_resource_spawns"), &AovSim::get_resource_spawns);
	ClassDB::bind_method(D_METHOD("take_map_changes"), &AovSim::take_map_changes);
	ClassDB::bind_method(D_METHOD("map_hash"), &AovSim::map_hash);
	ClassDB::bind_method(D_METHOD("set_profiling", "on"), &AovSim::set_profiling);
	ClassDB::bind_method(D_METHOD("is_profiling"), &AovSim::is_profiling);
	ClassDB::bind_method(D_METHOD("get_profile"), &AovSim::get_profile);
	ClassDB::bind_method(D_METHOD("get_stats"), &AovSim::get_stats);
}

String AovSim::version() const { return "aov-sim 0.1 (godot-cpp 4.5)"; }

void AovSim::new_game(int64_t seed, int64_t map_size, const String &preset, int64_t players) {
	sim_.new_game((uint32_t)seed, (int)map_size, std::string(preset.utf8().get_data()), (int)players);
}

void AovSim::tick(int64_t n) {
	for (int64_t i = 0; i < n; i++) sim_.tick();
}

PackedInt32Array AovSim::get_heights() const {
	const auto &h = sim_.world.map.heights;
	PackedInt32Array out;
	out.resize((int64_t)h.size());
	int32_t *w = out.ptrw();
	for (size_t i = 0; i < h.size(); i++) w[i] = h[i];
	return out;
}

static PackedByteArray bytes_of(const std::vector<uint8_t> &v) {
	PackedByteArray out;
	out.resize((int64_t)v.size());
	if (!v.empty()) memcpy(out.ptrw(), v.data(), v.size());
	return out;
}

PackedByteArray AovSim::get_ground() const { return bytes_of(sim_.world.map.ground); }
PackedByteArray AovSim::get_passable() const { return bytes_of(sim_.world.map.passable); }

Array AovSim::get_starts() const {
	Array out;
	for (const auto &s : sim_.world.starts) {
		Dictionary d;
		d["owner"] = s.owner;
		d["tx"] = s.tx;
		d["tz"] = s.tz;
		out.push_back(d);
	}
	return out;
}

Array AovSim::get_resource_spawns() const {
	Array out;
	for (const auto &r : sim_.world.resources) {
		Dictionary d;
		d["type"] = String(r.type.c_str());
		d["tx"] = r.tx;
		d["tz"] = r.tz;
		d["variant"] = r.variant;
		out.push_back(d);
	}
	return out;
}

PackedInt32Array AovSim::take_map_changes() {
	auto &ch = sim_.world.map.changes;
	PackedInt32Array out;
	for (const auto &c : ch) {
		out.push_back(c.cx0);
		out.push_back(c.cz0);
		out.push_back(c.cx1);
		out.push_back(c.cz1);
	}
	ch.clear();
	return out;
}

int64_t AovSim::map_hash() const {
	uint32_t h = 2166136261u;
	auto mix = [&](uint32_t v) {
		for (int k = 0; k < 4; k++) {
			h ^= (v >> (k * 8)) & 255u;
			h *= 16777619u;
		}
	};
	const auto &m = sim_.world.map;
	for (int16_t v : m.heights) mix((uint32_t)(int32_t)v);
	for (uint8_t v : m.ground) mix(v);
	for (const auto &r : sim_.world.resources) {
		mix((uint32_t)r.type[0]);
		mix((uint32_t)r.tx);
		mix((uint32_t)r.tz);
		mix((uint32_t)r.variant);
	}
	return h;
}

static Dictionary dict_of(const std::map<std::string, double> &m) {
	Dictionary d;
	for (const auto &kv : m) d[String(kv.first.c_str())] = kv.second;
	return d;
}

Dictionary AovSim::get_profile() const {
	const auto &p = sim_.prof;
	Dictionary d;
	d["total"] = p.total;
	d["sys"] = dict_of(p.sys);
	d["sub"] = dict_of(p.sub);
	d["ai"] = dict_of(p.ai);
	Dictionary calls;
	for (const auto &kv : p.calls) {
		Array a;
		a.push_back(kv.second.first);
		a.push_back(kv.second.second);
		calls[String(kv.first.c_str())] = a;
	}
	d["calls"] = calls;
	return d;
}

Dictionary AovSim::get_stats() const {
	Dictionary d;
	d["alive"] = 0;
	d["dead"] = 0;
	d["moving"] = 0;
	d["buildings"] = 0;
	d["projectiles"] = 0;
	return d;
}
