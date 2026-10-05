#include "aov_sim.h"

#include <algorithm>
#include <cctype>

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/dictionary.hpp>

using namespace godot;

void AovSim::_bind_methods() {
	ClassDB::bind_method(D_METHOD("version"), &AovSim::version);
	_bind_civ_methods(); // (aov_sim_civ.cpp: sim/civ)
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
	ClassDB::bind_method(D_METHOD("get_mapgen_info"), &AovSim::get_mapgen_info);
	ClassDB::bind_method(D_METHOD("take_map_changes"), &AovSim::take_map_changes);
	ClassDB::bind_method(D_METHOD("map_hash"), &AovSim::map_hash);
	ClassDB::bind_method(D_METHOD("set_profiling", "on"), &AovSim::set_profiling);
	ClassDB::bind_method(D_METHOD("is_profiling"), &AovSim::is_profiling);
	ClassDB::bind_method(D_METHOD("get_profile"), &AovSim::get_profile);
	ClassDB::bind_method(D_METHOD("get_stats"), &AovSim::get_stats);
	ClassDB::bind_method(D_METHOD("set_census", "on"), &AovSim::set_census);
	ClassDB::bind_method(D_METHOD("take_census"), &AovSim::take_census);
	ClassDB::bind_method(D_METHOD("units_hash"), &AovSim::units_hash);
	ClassDB::bind_method(D_METHOD("get_units_f64"), &AovSim::get_units_f64);
	ClassDB::bind_method(D_METHOD("get_econ_f64"), &AovSim::get_econ_f64);
	ClassDB::bind_method(D_METHOD("get_walkable"), &AovSim::get_walkable);
	ClassDB::bind_method(D_METHOD("build_terrain_mesh", "cx0", "cz0", "cx1", "cz1"), &AovSim::build_terrain_mesh);
	ClassDB::bind_method(D_METHOD("get_water_depth"), &AovSim::get_water_depth);
	ClassDB::bind_method(D_METHOD("build_ground_details", "cx0", "cz0", "cx1", "cz1"), &AovSim::build_ground_details);
	// players
	ClassDB::bind_method(D_METHOD("add_player", "id", "name", "is_ai"), &AovSim::add_player, DEFVAL(""), DEFVAL(true));
	ClassDB::bind_method(D_METHOD("get_player", "id"), &AovSim::get_player);
	ClassDB::bind_method(D_METHOD("get_player_ids"), &AovSim::get_player_ids);
	ClassDB::bind_method(D_METHOD("is_ally", "a", "b"), &AovSim::is_ally);
	ClassDB::bind_method(D_METHOD("get_team", "id"), &AovSim::get_team);
	ClassDB::bind_method(D_METHOD("get_local_player"), &AovSim::get_local_player);
	ClassDB::bind_method(D_METHOD("setup_match", "cfg"), &AovSim::setup_match);
	ClassDB::bind_method(D_METHOD("start_match", "cfg"), &AovSim::start_match);
	ClassDB::bind_method(D_METHOD("is_enemy", "a", "b"), &AovSim::is_enemy);
	// entities
	ClassDB::bind_method(D_METHOD("unit_type_names"), &AovSim::unit_type_names);
	ClassDB::bind_method(D_METHOD("get_unit_def", "type"), &AovSim::get_unit_def);
	ClassDB::bind_method(D_METHOD("spawn_unit", "type", "owner", "x", "z", "rot"), &AovSim::spawn_unit, DEFVAL(0.0));
	ClassDB::bind_method(D_METHOD("spawn_block", "type", "owner", "count", "x", "z", "cols", "spacing", "rot", "jitter"), &AovSim::spawn_block,
			DEFVAL(0), DEFVAL(1.0), DEFVAL(0.0), DEFVAL(0.15));
	ClassDB::bind_method(D_METHOD("spawn_resource", "type", "tx", "tz", "variant"), &AovSim::spawn_resource, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("remove_resource", "id"), &AovSim::remove_resource);
	ClassDB::bind_method(D_METHOD("clear_rect", "tx", "tz", "w", "h"), &AovSim::clear_rect);
	ClassDB::bind_method(D_METHOD("paint_ground", "tx", "tz", "w", "h", "ground"), &AovSim::paint_ground); // (Godot-only scene tool)
	ClassDB::bind_method(D_METHOD("kill_unit", "id", "killer"), &AovSim::kill_unit, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("entity_kind", "id"), &AovSim::entity_kind);
	ClassDB::bind_method(D_METHOD("get_unit_count"), &AovSim::get_unit_count);
	ClassDB::bind_method(D_METHOD("get_units"), &AovSim::get_units);
	ClassDB::bind_method(D_METHOD("get_buildings"), &AovSim::get_buildings);
	ClassDB::bind_method(D_METHOD("get_resources"), &AovSim::get_resources);
	ClassDB::bind_method(D_METHOD("get_unit", "id"), &AovSim::get_unit);
	ClassDB::bind_method(D_METHOD("units_near", "x", "z", "r", "owner"), &AovSim::units_near, DEFVAL(-1));
	// commands
	ClassDB::bind_method(D_METHOD("order", "id", "order"), &AovSim::order);
	ClassDB::bind_method(D_METHOD("order_move", "ids", "x", "z"), &AovSim::order_move);
	ClassDB::bind_method(D_METHOD("order_idle", "ids"), &AovSim::order_idle);
	ClassDB::bind_method(D_METHOD("order_attack_move", "ids", "x", "z"), &AovSim::order_attack_move);
	ClassDB::bind_method(D_METHOD("smart", "ids", "x", "z", "target_id"), &AovSim::smart, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("move_to", "id", "x", "z", "range"), &AovSim::move_to, DEFVAL(0.0));
	ClassDB::bind_method(D_METHOD("find_path", "sx", "sz", "gx", "gz"), &AovSim::find_path);
	ClassDB::bind_method(D_METHOD("set_repath_budget", "n"), &AovSim::set_repath_budget);
	ClassDB::bind_method(D_METHOD("set_path_cache", "on"), &AovSim::set_path_cache);
	ClassDB::bind_method(D_METHOD("set_group_paths", "min_units"), &AovSim::set_group_paths);
	// buildings
	ClassDB::bind_method(D_METHOD("building_type_names"), &AovSim::building_type_names);
	ClassDB::bind_method(D_METHOD("get_building_def", "type", "owner"), &AovSim::get_building_def, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("spawn_building", "type", "owner", "tx", "tz", "built", "site"), &AovSim::spawn_building, DEFVAL(true), DEFVAL(true));
	ClassDB::bind_method(D_METHOD("can_place", "type", "tx", "tz"), &AovSim::can_place);
	ClassDB::bind_method(D_METHOD("place_building", "type", "owner", "tx", "tz", "builders"), &AovSim::place_building, DEFVAL(PackedInt32Array()));
	ClassDB::bind_method(D_METHOD("destroy_building", "id"), &AovSim::destroy_building);
	ClassDB::bind_method(D_METHOD("get_building", "id"), &AovSim::get_building);
	// fortifications (Godot-only)
	ClassDB::bind_method(D_METHOD("plan_wall", "owner", "a", "b"), &AovSim::plan_wall);
	ClassDB::bind_method(D_METHOD("place_wall", "owner", "a", "b", "builders"), &AovSim::place_wall, DEFVAL(PackedInt32Array()));
	ClassDB::bind_method(D_METHOD("convert_to_gate", "id"), &AovSim::convert_to_gate);
	ClassDB::bind_method(D_METHOD("set_gate_locked", "id", "locked"), &AovSim::set_gate_locked);
	ClassDB::bind_method(D_METHOD("research", "building", "tech"), &AovSim::research);
	ClassDB::bind_method(D_METHOD("cancel_research", "building", "tech"), &AovSim::cancel_research, DEFVAL(String()));
	// research, techs, market (sim/techs)
	ClassDB::bind_method(D_METHOD("tech_names"), &AovSim::tech_names);
	ClassDB::bind_method(D_METHOD("get_tech_def", "tech"), &AovSim::get_tech_def);
	ClassDB::bind_method(D_METHOD("get_techs", "building"), &AovSim::get_techs);
	ClassDB::bind_method(D_METHOD("get_owner_techs", "owner", "building_type"), &AovSim::get_owner_techs);
	ClassDB::bind_method(D_METHOD("get_player_techs", "owner"), &AovSim::get_player_techs);
	ClassDB::bind_method(D_METHOD("get_research", "building"), &AovSim::get_research);
	ClassDB::bind_method(D_METHOD("set_minor_god", "owner", "age", "god"), &AovSim::set_minor_god);
	ClassDB::bind_method(D_METHOD("grant_tech", "owner", "tech"), &AovSim::grant_tech);
	ClassDB::bind_method(D_METHOD("get_unit_stats", "id"), &AovSim::get_unit_stats);
	ClassDB::bind_method(D_METHOD("get_market", "owner"), &AovSim::get_market, DEFVAL(1));
	ClassDB::bind_method(D_METHOD("market_buy", "market", "res"), &AovSim::market_buy);
	ClassDB::bind_method(D_METHOD("market_sell", "market", "res"), &AovSim::market_sell);
	ClassDB::bind_method(D_METHOD("tribute", "from", "to", "res", "amount"), &AovSim::tribute);
	ClassDB::bind_method(D_METHOD("set_tech_rules", "opts"), &AovSim::set_tech_rules);
	ClassDB::bind_method(D_METHOD("get_tech_rules"), &AovSim::get_tech_rules);
	ClassDB::bind_method(D_METHOD("fort_tech_names"), &AovSim::fort_tech_names);
	ClassDB::bind_method(D_METHOD("get_walls"), &AovSim::get_walls);
	ClassDB::bind_method(D_METHOD("get_fortify", "owner"), &AovSim::get_fortify);
	// economy
	ClassDB::bind_method(D_METHOD("train", "building", "unit_type"), &AovSim::train);
	ClassDB::bind_method(D_METHOD("cancel_train", "building", "index"), &AovSim::cancel_train);
	ClassDB::bind_method(D_METHOD("advance_age", "owner"), &AovSim::advance_age);
	ClassDB::bind_method(D_METHOD("next_age_cost", "owner"), &AovSim::next_age_cost);
	ClassDB::bind_method(D_METHOD("set_rally", "building", "x", "z", "target_id"), &AovSim::set_rally, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("clear_rally", "building"), &AovSim::clear_rally);
	ClassDB::bind_method(D_METHOD("nearest_resource", "x", "z", "res_type", "max_dist"), &AovSim::nearest_resource, DEFVAL(14.0));
	ClassDB::bind_method(D_METHOD("nearest_dropoff", "owner", "x", "z", "res_type"), &AovSim::nearest_dropoff);
	ClassDB::bind_method(D_METHOD("order_gather", "ids", "target"), &AovSim::order_gather);
	ClassDB::bind_method(D_METHOD("order_build", "ids", "target"), &AovSim::order_build);
	ClassDB::bind_method(D_METHOD("order_worship", "ids", "target"), &AovSim::order_worship);
	ClassDB::bind_method(D_METHOD("order_dropoff", "ids", "target"), &AovSim::order_dropoff);
	ClassDB::bind_method(D_METHOD("set_player_resources", "owner", "res"), &AovSim::set_player_resources);
	ClassDB::bind_method(D_METHOD("set_player_age", "owner", "age"), &AovSim::set_player_age);
	ClassDB::bind_method(D_METHOD("spawn_herd", "type", "x", "z", "n"), &AovSim::spawn_herd);
	ClassDB::bind_method(D_METHOD("spawn_boat", "owner", "x", "z", "rot"), &AovSim::spawn_boat, DEFVAL(0.0));
	ClassDB::bind_method(D_METHOD("spawn_shoal", "x", "z", "amount"), &AovSim::spawn_shoal, DEFVAL(300.0));
	ClassDB::bind_method(D_METHOD("get_economy"), &AovSim::get_economy);
	ClassDB::bind_method(D_METHOD("get_decor"), &AovSim::get_decor);
	// scenes
	ClassDB::bind_method(D_METHOD("has_scene_setup", "name"), &AovSim::has_scene_setup);
	ClassDB::bind_method(D_METHOD("setup_scene", "name", "opts"), &AovSim::setup_scene, DEFVAL(Dictionary()));
	// combat, god powers, fog, victory
	ClassDB::bind_method(D_METHOD("damage", "target", "amount", "attacker"), &AovSim::damage, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("set_ai_enabled", "on"), &AovSim::set_ai_enabled);
	ClassDB::bind_method(D_METHOD("add_ai", "owner"), &AovSim::add_ai);
	ClassDB::bind_method(D_METHOD("get_ai", "owner"), &AovSim::get_ai);
	ClassDB::bind_method(D_METHOD("set_ai", "owner", "settings"), &AovSim::set_ai);
	ClassDB::bind_method(D_METHOD("get_combat"), &AovSim::get_combat);
	ClassDB::bind_method(D_METHOD("set_unit_combat", "id", "settings"), &AovSim::set_unit_combat);
	ClassDB::bind_method(D_METHOD("power_names"), &AovSim::power_names);
	ClassDB::bind_method(D_METHOD("get_power_def", "power"), &AovSim::get_power_def);
	ClassDB::bind_method(D_METHOD("can_cast", "owner", "power"), &AovSim::can_cast);
	ClassDB::bind_method(D_METHOD("cast_power", "owner", "power", "x", "z"), &AovSim::cast_power);
	ClassDB::bind_method(D_METHOD("power_cooldown", "owner", "power"), &AovSim::power_cooldown);
	ClassDB::bind_method(D_METHOD("get_godpowers"), &AovSim::get_godpowers);
	ClassDB::bind_method(D_METHOD("set_fog_reveal_all", "on"), &AovSim::set_fog_reveal_all);
	ClassDB::bind_method(D_METHOD("fog_recompute"), &AovSim::fog_recompute);
	ClassDB::bind_method(D_METHOD("get_fog"), &AovSim::get_fog);
	ClassDB::bind_method(D_METHOD("fog_version"), &AovSim::fog_version);
	ClassDB::bind_method(D_METHOD("is_explored", "x", "z"), &AovSim::is_explored);
	ClassDB::bind_method(D_METHOD("is_visible", "x", "z"), &AovSim::is_visible);
	ClassDB::bind_method(D_METHOD("set_victory_enabled", "on"), &AovSim::set_victory_enabled);
	ClassDB::bind_method(D_METHOD("set_godot_rules", "on"), &AovSim::set_godot_rules);
	ClassDB::bind_method(D_METHOD("get_godot_rules"), &AovSim::get_godot_rules);
	ClassDB::bind_method(D_METHOD("get_victory"), &AovSim::get_victory);
	ClassDB::bind_method(D_METHOD("is_paused"), &AovSim::is_paused);
	ClassDB::bind_method(D_METHOD("set_paused", "on"), &AovSim::set_paused);
	ClassDB::bind_method(D_METHOD("scene_after", "name"), &AovSim::scene_after);
	// events
	ClassDB::bind_method(D_METHOD("take_events"), &AovSim::take_events);
	ClassDB::bind_method(D_METHOD("set_record_events", "on"), &AovSim::set_record_events);
}

String AovSim::version() const { return "aov-sim 0.2 (godot-cpp 4.5)"; }

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

Dictionary AovSim::get_mapgen_info() const {
	Dictionary d;
	d["felled"] = sim_.world.felled;
	d["graded"] = sim_.world.graded;
	d["woodline"] = sim_.world.woodline;
	d["balanced"] = sim_.world.balanced;
	return d;
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
	Dictionary by;
	for (const auto &kv : p.calls_by) {
		Array a;
		a.push_back(kv.second.first);
		a.push_back(kv.second.second);
		by[String(kv.first.c_str())] = a;
	}
	d["callsBy"] = by; // "findPath@combat": [n, ms] (the JS prof.last.callsBy)
	return d;
}

Dictionary AovSim::get_stats() const {
	const aov::UnitStore &U = sim_.entities.units;
	int alive = 0, dead = 0, moving = 0;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r]) continue;
		if (U.dead[r]) dead++;
		else {
			alive++;
			if (U.moving[r]) moving++;
		}
	}
	int buildings = 0, resources = 0;
	for (int r = 0; r < sim_.entities.buildings.size(); r++) buildings += !sim_.entities.buildings.removed[r];
	for (int r = 0; r < sim_.entities.resources.size(); r++) resources += !sim_.entities.resources.removed[r];
	Dictionary d;
	d["alive"] = alive;
	d["dead"] = dead;
	d["moving"] = moving;
	d["buildings"] = buildings;
	d["projectiles"] = (int64_t)sim_.combat.projectiles.size();
	d["resources"] = resources;
	d["paths"] = sim_.paths.live();
	d["path_calls"] = sim_.pathfinder.calls;
	d["path_searches"] = sim_.pathfinder.searches;
	d["path_cache_hits"] = sim_.pathfinder.cache_hits;
	d["path_expanded"] = sim_.pathfinder.expanded_total;
	d["group_fields"] = sim_.pathfinder.field_builds;
	d["group_field_paths"] = sim_.pathfinder.field_paths;
	d["group_field_fallbacks"] = sim_.pathfinder.field_fallbacks;
	return d;
}

void AovSim::set_census(bool on) {
	auto &h = sim_.movement.hash;
	h.census = on;
	h.queries = h.cells_scanned = h.visited = 0;
}

Dictionary AovSim::take_census() {
	auto &h = sim_.movement.hash;
	Dictionary d;
	d["queries"] = h.queries;
	d["cellsScanned"] = h.cells_scanned;
	d["entitiesVisited"] = h.visited;
	h.queries = h.cells_scanned = h.visited = 0;
	return d;
}

PackedByteArray AovSim::get_walkable() const {
	const aov::GameMap &m = sim_.world.map;
	PackedByteArray out;
	out.resize((int64_t)m.size * m.size);
	uint8_t *w = out.ptrw();
	for (int tz = 0; tz < m.size; tz++)
		for (int tx = 0; tx < m.size; tx++) w[tz * m.size + tx] = m.is_walkable(tx, tz) ? 1 : 0;
	return out;
}

// ---- players ---------------------------------------------------------------

void AovSim::add_player(int64_t id, const String &name, bool is_ai) {
	if (id < 0 || id >= aov::MAX_PLAYERS) return;
	sim_.add_player((int)id, std::string(name.utf8().get_data()), is_ai);
}

Dictionary AovSim::get_player(int64_t id) const {
	Dictionary d;
	if (id < 0 || id >= aov::MAX_PLAYERS || !sim_.players[id].exists) return d;
	const aov::Player &p = sim_.players[id];
	d["id"] = p.id;
	d["name"] = String(p.name.c_str());
	d["is_ai"] = p.is_ai;
	d["god"] = String(p.god.c_str());
	d["color"] = (int64_t)p.color;
	for (int k = 0; k < aov::RES_COUNT; k++) d[aov::res_name(k)] = p.res[k];
	d["pop"] = p.pop;
	d["pop_cap"] = p.pop_cap;
	d["age"] = p.age;
	d["age_name"] = aov::AGES[p.age & 3];
	d["advancing"] = p.advancing;
	d["advance_t"] = p.advancing_t;
	d["advance_total"] = p.advancing_total;
	d["team"] = sim_.team_of((int)id);
	d["human"] = p.human;
	d["difficulty"] = String(aov::ai_difficulty_name(p.difficulty));
	d["gather_mult"] = p.gather_mult;
	d["civ"] = aov::civ_key(p.civ); // (Godot-only, sim/civ)
	d["civ_id"] = p.civ;
	return d;
}

// ---- match setup -----------------------------------------------------------

static aov::MatchConfig match_config(const Dictionary &cfg) {
	aov::MatchConfig c;
	c.seed = (uint32_t)(int64_t)cfg.get("seed", 1);
	c.map_size = (int)(int64_t)cfg.get("map_size", 128);
	c.preset = std::string(String(cfg.get("preset", "skirmish")).utf8().get_data());
	c.resources = std::string(String(cfg.get("resources", "standard")).utf8().get_data());
	c.villagers = (int)(int64_t)cfg.get("villagers", 5);
	const Array ps = cfg.get("players", Array());
	for (int64_t i = 0; i < ps.size(); i++) {
		const Dictionary p = ps[i];
		aov::MatchPlayer mp;
		mp.id = (int)(int64_t)p.get("id", 0);
		mp.name = std::string(String(p.get("name", "")).utf8().get_data());
		mp.human = (bool)p.get("human", false);
		const Variant ai = p.get("ai", "moderate");
		if (ai.get_type() == Variant::STRING || ai.get_type() == Variant::STRING_NAME) {
			const int d = aov::ai_difficulty_of(String(ai).utf8().get_data());
			mp.difficulty = d < 0 ? aov::AI_MODERATE : d;
		} else mp.difficulty = (int)(int64_t)ai;
		mp.team = (int)(int64_t)p.get("team", 0);
		mp.color = (int64_t)p.get("color", -1);
		mp.god = std::string(String(p.get("god", "Zeus")).utf8().get_data());
		if (!mp.god.empty()) mp.god[0] = (char)std::toupper((unsigned char)mp.god[0]);
		if (p.has("civ")) mp.civ = aov::civ_of_key(String(p["civ"]).utf8().get_data()); // (sim/civ; default: from the god)
		c.players.push_back(mp);
	}
	return c;
}

static Dictionary match_result(const aov::MatchResult &r) {
	Dictionary d;
	d["ok"] = r.ok;
	d["error"] = String(r.error.c_str());
	d["local"] = r.local;
	d["focus"] = Vector2((real_t)r.focus_x, (real_t)r.focus_z);
	PackedInt32Array tcs, slots;
	for (int32_t t : r.tcs) tcs.push_back(t);
	for (int s : r.slot) slots.push_back(s);
	d["tcs"] = tcs;
	d["slots"] = slots;
	return d;
}

Dictionary AovSim::setup_match(const Dictionary &cfg) {
	return match_result(sim_.setup_match(match_config(cfg)));
}

Dictionary AovSim::start_match(const Dictionary &cfg) {
	const aov::MatchConfig c = match_config(cfg);
	sim_.new_game(c.seed, c.map_size, c.preset, (int)c.players.size());
	return match_result(sim_.setup_match(c));
}

PackedInt32Array AovSim::get_player_ids() const {
	PackedInt32Array out;
	for (int i = 0; i < aov::MAX_PLAYERS; i++)
		if (sim_.players[i].exists) out.push_back(i);
	return out;
}

// ---- entities --------------------------------------------------------------

PackedStringArray AovSim::unit_type_names() const {
	PackedStringArray out;
	for (int i = 0; i < aov::U_TYPE_COUNT; i++) out.push_back(aov::unit_def(i).key);
	return out;
}

Dictionary AovSim::get_unit_def(const String &type) const {
	Dictionary d;
	int t = aov::unit_type_of(type.utf8().get_data());
	if (t < 0) return d;
	const aov::UnitDef &u = aov::unit_def(t);
	static const char *cls[] = { "villager", "infantry", "archer", "cavalry", "myth", "hero", "siege" };
	d["type"] = t;
	d["key"] = u.key;
	d["name"] = u.name;
	d["class"] = cls[u.cls];
	d["hp"] = u.hp;
	d["speed"] = u.speed;
	d["radius"] = u.radius;
	d["sight"] = u.sight;
	d["pop"] = u.pop;
	Dictionary cost;
	for (int k = 0; k < aov::RES_COUNT; k++)
		if (u.cost.has[k]) cost[aov::res_name(k)] = u.cost.v[k];
	d["cost"] = cost;
	d["train_time"] = u.train_time;
	d["hotkey"] = u.hotkey;
	d["gatherer"] = u.gatherer;
	d["builder"] = u.builder;
	d["myth"] = u.myth;
	d["hero"] = u.hero;
	d["min_age"] = sim_.godot_rules ? aov::rules_min_age(t) : u.min_age; // (Godot-only: the Medusa is Mythic, sim/techs)
	if (sim_.godot_rules && aov::myth_unit_god(t)) d["god"] = aov::myth_unit_god(t);
	Dictionary atk;
	atk["damage"] = u.attack.damage;
	atk["range"] = u.attack.range;
	atk["cooldown"] = u.attack.cooldown;
	atk["splash"] = u.attack.splash;
	atk["projectile"] = u.attack.projectile ? "arrow" : "";
	d["attack"] = atk;
	d["armor"] = u.armor;
	civ_unit_def(t, d); // (Godot-only, sim/civ: civ, hack / pierce armor, stand-in, Retold, per age)
	return d;
}

// Map bounds (PORTING.md "Map bounds", aov::Units::spawn): a point on the
// map spawns there as given; a point off the map (negative, >= map size,
// infinite) is clamped onto the map and the unit goes to the nearest walkable
// tile within 8 tiles of that edge point; when there is none, or x / z is
// NaN, nothing spawns and the id is 0. -1 = unknown unit type.
int64_t AovSim::spawn_unit(const String &type, int64_t owner, double x, double z, double rot) {
	int t = aov::unit_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_unit: unknown unit type " + type);
		return -1;
	}
	if (!sim_.godot_rules && aov::is_egypt_unit(t)) return 0; // (Godot-only types, sim/civ)
	int r = sim_.units.spawn(t, (int)owner, x, z, rot);
	return r < 0 ? 0 : sim_.entities.units.id[r];
}

// (each unit of the block follows spawn_unit's bounds policy; a unit that
// could not be placed is left out of the ids)
PackedInt32Array AovSim::spawn_block(const String &type, int64_t owner, int64_t count, double x, double z, int64_t cols, double spacing, double rot, double jitter) {
	PackedInt32Array out;
	int t = aov::unit_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_block: unknown unit type " + type);
		return out;
	}
	if (!sim_.godot_rules && aov::is_egypt_unit(t)) return out; // (Godot-only types, sim/civ)
	for (int32_t id : sim_.spawn_block(t, (int)owner, (int)count, x, z, (int)cols, spacing, rot, jitter)) out.push_back(id);
	return out;
}

int64_t AovSim::spawn_resource(const String &type, int64_t tx, int64_t tz, int64_t variant) {
	int t = aov::resource_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_resource: unknown resource type " + type);
		return -1;
	}
	const aov::ResourceDef &def = aov::resource_def(t);
	if (!sim_.map().rect_in_tiles(tx, tz, def.w, def.h)) return 0; // (bounds: the node must lie on the map)
	return sim_.spawn_resource(t, (int)tx, (int)tz, (int)variant);
}

void AovSim::kill_unit(int64_t id, int64_t killer) {
	if (sim_.entities.slot((int32_t)id) < 0) return;
	sim_.combat.kill((int32_t)id, sim_.combat.hitter_of((int32_t)killer));
}

template <class T, class PA>
static PA packed_rows(const std::vector<uint8_t> &removed, const std::vector<T> &col) {
	PA out;
	int64_t n = 0;
	for (uint8_t rm : removed) n += !rm;
	out.resize(n);
	auto *w = out.ptrw();
	int64_t k = 0;
	for (size_t i = 0; i < col.size(); i++)
		if (!removed[i]) w[k++] = col[i];
	return out;
}

// What a villager carries as the EconomyView draws it (drawLoads): 0 wood,
// 1 gold, 2 grain, 3 fruit, 4 meat, 255 nothing.
static uint8_t load_kind(const aov::Entities &E, int r) {
	const aov::UnitStore &U = E.units;
	const int c = U.carry_type[r];
	if (c == aov::RES_NONE || U.carry_amount[r] <= 0) return 255;
	if (c == aov::RES_WOOD) return 0;
	if (c == aov::RES_GOLD) return 1;
	if (c != aov::RES_FOOD) return 255;
	const int32_t src = U.econ_phase[r] != aov::EP_NONE ? U.econ_res[r] : 0;
	const int s = E.slot(src);
	if (s >= 0 && E.kind(src) == aov::K_BUILDING && aov::building_def(E.buildings.type[s]).farm) return 2;
	if (s >= 0 && E.kind(src) == aov::K_RESOURCE) {
		const int t = E.resources.type[s];
		if (aov::is_animal_type(t)) return 4;
		if (t == aov::R_BERRY) return 3;
	}
	if (U.econ_phase[r] != aov::EP_NONE && U.econ_hunt[r]) return 4;
	return 2;
}

Dictionary AovSim::get_units() const {
	const aov::UnitStore &U = sim_.entities.units;
	const int n = U.size();
	int live = 0;
	for (int r = 0; r < n; r++) live += !U.removed[r];
	PackedInt32Array ids, target;
	PackedFloat32Array pos, prev, rot, prot, hp, mhp, at, atk, die, hit, flash, gy;
	PackedByteArray type, owner, anim, order, flags, carry, load, task;
	PackedFloat32Array carry_amt;
	ids.resize(live); target.resize(live);
	pos.resize(live * 2); prev.resize(live * 2);
	rot.resize(live); prot.resize(live); hp.resize(live); mhp.resize(live); at.resize(live); atk.resize(live); die.resize(live);
	hit.resize(live); flash.resize(live); gy.resize(live);
	type.resize(live); owner.resize(live); anim.resize(live); order.resize(live); flags.resize(live); carry.resize(live);
	load.resize(live); carry_amt.resize(live); task.resize(live);
	uint8_t *wld = load.ptrw(), *wtk = task.ptrw();
	float *wcam = carry_amt.ptrw();
	const aov::Entities &E = sim_.entities;
	int32_t *wid = ids.ptrw(), *wtg = target.ptrw();
	float *wp = pos.ptrw(), *wpp = prev.ptrw(), *wr = rot.ptrw(), *wpr = prot.ptrw(), *wh = hp.ptrw(), *wmh = mhp.ptrw(), *wat = at.ptrw(),
		  *watk = atk.ptrw(), *wdie = die.ptrw(), *whit = hit.ptrw(), *wfl = flash.ptrw(), *wgy = gy.ptrw();
	const aov::GameMap &map = sim_.world.map;
	uint8_t *wty = type.ptrw(), *wow = owner.ptrw(), *wan = anim.ptrw(), *wor = order.ptrw(), *wfg = flags.ptrw(), *wca = carry.ptrw();
	int k = 0;
	for (int r = 0; r < n; r++) {
		if (U.removed[r]) continue;
		wid[k] = U.id[r];
		wtg[k] = U.order_target[r];
		wp[k * 2] = (float)U.x[r];
		wp[k * 2 + 1] = (float)U.z[r];
		wpp[k * 2] = (float)U.prev_x[r];
		wpp[k * 2 + 1] = (float)U.prev_z[r];
		wr[k] = (float)U.rot[r];
		wpr[k] = (float)U.prev_rot[r];
		wh[k] = (float)U.hp[r];
		wmh[k] = (float)U.max_hp[r];
		wat[k] = (float)U.anim_t[r];
		watk[k] = (float)U.anim_attack_t[r];
		wdie[k] = (float)U.anim_die_t[r];
		whit[k] = std::isnan(U.hit_t[r]) ? -1.f : (float)U.hit_t[r];
		wfl[k] = (float)U.flash_t[r];
		wgy[k] = (float)map.height_at(U.x[r], U.z[r]);
		wty[k] = U.type[r];
		wow[k] = U.owner[r];
		wan[k] = U.anim_state[r];
		wor[k] = U.order_type[r];
		wfg[k] = (uint8_t)((U.moving[r] ? aov::UF_MOVING : 0) | (U.dead[r] ? aov::UF_DEAD : 0) | (U.arrived[r] ? aov::UF_ARRIVED : 0) |
				(U.carry_amount[r] > 0 ? aov::UF_CARRY : 0) | (U.combat_line[r] ? aov::UF_LINE : 0));
		wca[k] = U.carry_type[r];
		wcam[k] = (float)U.carry_amount[r];
		wld[k] = load_kind(E, r);
		wtk[k] = U.econ_phase[r] != aov::EP_NONE ? U.econ_res_type[r] : 255;
		k++;
	}
	Dictionary d;
	d["count"] = live;
	d["ids"] = ids;
	d["pos"] = pos;
	d["prev_pos"] = prev;
	d["rot"] = rot;
	d["prev_rot"] = prot;
	d["type"] = type;
	d["owner"] = owner;
	d["hp"] = hp;
	d["max_hp"] = mhp;
	d["anim"] = anim;
	d["anim_t"] = at;
	d["attack_t"] = atk;
	d["die_t"] = die;
	d["hit_t"] = hit;
	d["flash_t"] = flash;
	d["ground_y"] = gy;
	d["order"] = order;
	d["target"] = target;
	d["flags"] = flags;
	d["carry"] = carry;
	d["carry_amount"] = carry_amt;
	d["load"] = load;
	d["task"] = task; // the resource kind being gathered (u.econ.resType), 255 none
	// combat / god power state for the renderer (times are game times, -1 = never)
	PackedFloat32Array air, stag, melee, gphit, hitt;
	PackedByteArray kit;
	air.resize(live * 3); stag.resize(live * 2); melee.resize(live); gphit.resize(live); hitt.resize(live); kit.resize(live);
	float *wair = air.ptrw(), *wst = stag.ptrw(), *wme = melee.ptrw(), *wgp = gphit.ptrw(), *wht = hitt.ptrw();
	uint8_t *wkit = kit.ptrw();
	auto tv = [](double v) { return std::isnan(v) ? -1.f : (float)v; };
	k = 0;
	for (int r = 0; r < n; r++) {
		if (U.removed[r]) continue;
		wair[k * 3] = (float)U.air_y[r];
		wair[k * 3 + 1] = (float)U.air_rx[r];
		wair[k * 3 + 2] = (float)U.air_rz[r];
		wst[k * 2] = tv(U.stag_t[r]);
		wst[k * 2 + 1] = (float)U.stag_k[r];
		wme[k] = tv(U.melee_t[r]);
		wgp[k] = tv(U.gp_hit_t[r]);
		wht[k] = tv(U.hit_time[r]);
		wkit[k] = U.kit[r];
		k++;
	}
	d["air"] = air;        // 3 per unit: airY, airRx, airRz (thrown by a god power)
	d["stagger"] = stag;   // 2 per unit: combat_stagT, combat_stagK (lean = combat.lean)
	d["melee_t"] = melee;  // combat_meleeT
	d["gp_hit_t"] = gphit; // gp_hitT (lightning strike: white flash, then charred)
	d["hit_time"] = hitt;  // combat_hitT (health bars)
	d["kit"] = kit;        // units_kit (battle scene), 255 unset
	return d;
}

Dictionary AovSim::get_buildings() const {
	const aov::BuildingStore &B = sim_.entities.buildings;
	Dictionary d;
	PackedInt32Array rect;
	for (int r = 0; r < B.size(); r++) {
		if (B.removed[r]) continue;
		rect.push_back(B.tx[r]);
		rect.push_back(B.tz[r]);
		rect.push_back(B.w[r]);
		rect.push_back(B.h[r]);
	}
	d["count"] = (int64_t)rect.size() / 4;
	d["ids"] = packed_rows<int32_t, PackedInt32Array>(B.removed, B.id);
	d["type"] = packed_rows<uint8_t, PackedByteArray>(B.removed, B.type);
	d["owner"] = packed_rows<uint8_t, PackedByteArray>(B.removed, B.owner);
	d["rect"] = rect;
	d["hp"] = packed_rows<double, PackedFloat32Array>(B.removed, B.hp);
	d["max_hp"] = packed_rows<double, PackedFloat32Array>(B.removed, B.max_hp);
	d["built"] = packed_rows<uint8_t, PackedByteArray>(B.removed, B.built);
	d["progress"] = packed_rows<double, PackedFloat32Array>(B.removed, B.progress);
	d["variant"] = packed_rows<int32_t, PackedInt32Array>(B.removed, B.bld_variant);
	d["yaw"] = packed_rows<double, PackedFloat32Array>(B.removed, B.bld_yaw);
	d["setback"] = packed_rows<double, PackedFloat32Array>(B.removed, B.bld_setback);
	d["farm_rows"] = packed_rows<double, PackedFloat32Array>(B.removed, B.econ_rows);
	// fortify (Godot-only): gate leaves 0 closed .. 1 open, gate locked (get_walls() has the rest)
	d["fort_open"] = packed_rows<double, PackedFloat32Array>(B.removed, B.fort_open);
	d["fort_locked"] = packed_rows<uint8_t, PackedByteArray>(B.removed, B.fort_locked);
	// civ (Godot-only, sim/civ): the Pharaoh's empowerment (0 .. 1), the owner's civilization (0 Greek, 1 Egyptian)
	d["empower"] = packed_rows<double, PackedFloat32Array>(B.removed, B.civ_empower);
	PackedByteArray bciv;
	for (int r = 0; r < B.size(); r++)
		if (!B.removed[r]) bciv.push_back(sim_.civs.civ(B.owner[r]));
	d["civ"] = bciv;
	PackedFloat32Array stock, rally;
	PackedByteArray qlen;
	for (int r = 0; r < B.size(); r++) {
		if (B.removed[r]) continue;
		const double st[6] = { B.stock_grain[r], B.stock_fruit[r], B.stock_meat[r], B.stock_fish[r], B.stock_wood[r], B.stock_gold[r] };
		for (double v : st) stock.push_back((float)v);
		qlen.push_back((uint8_t)std::min<size_t>(255, B.queue[r].size()));
		rally.push_back(B.rally[r] ? 1.f : 0.f);
		rally.push_back((float)B.rally_x[r]);
		rally.push_back((float)B.rally_z[r]);
	}
	d["stock"] = stock; // 6 per building: grain, fruit, meat, fish, wood, gold
	d["queue_len"] = qlen;
	d["rally"] = rally; // 3 per building: set, x, z
	PackedStringArray names;
	for (int i = 0; i < aov::B_TYPE_COUNT; i++) names.push_back(aov::building_def(i).key);
	d["type_names"] = names;
	return d;
}

Dictionary AovSim::get_resources() const {
	const aov::ResourceStore &R = sim_.entities.resources;
	Dictionary d;
	PackedInt32Array tile;
	for (int r = 0; r < R.size(); r++) {
		if (R.removed[r]) continue;
		tile.push_back(R.tx[r]);
		tile.push_back(R.tz[r]);
	}
	d["count"] = (int64_t)tile.size() / 2;
	d["ids"] = packed_rows<int32_t, PackedInt32Array>(R.removed, R.id);
	d["type"] = packed_rows<uint8_t, PackedByteArray>(R.removed, R.type);
	d["tile"] = tile;
	d["amount"] = packed_rows<double, PackedFloat32Array>(R.removed, R.amount);
	d["variant"] = packed_rows<int32_t, PackedInt32Array>(R.removed, R.variant);
	d["max_amount"] = packed_rows<double, PackedFloat32Array>(R.removed, R.max_amount);
	PackedStringArray names;
	for (int i = 0; i < aov::R_TYPE_COUNT; i++) names.push_back(aov::resource_def(i).key);
	d["type_names"] = names;
	return d;
}

Dictionary AovSim::get_unit(int64_t id) const {
	Dictionary d;
	int r = sim_.entities.unit_slot((int32_t)id);
	if (r < 0) return d;
	const aov::UnitStore &U = sim_.entities.units;
	d["id"] = U.id[r];
	d["type"] = aov::unit_def(U.type[r]).key;
	d["owner"] = U.owner[r];
	d["x"] = U.x[r];
	d["z"] = U.z[r];
	d["rot"] = U.rot[r];
	d["hp"] = U.hp[r];
	d["max_hp"] = U.max_hp[r];
	d["dead"] = (bool)U.dead[r];
	d["moving"] = (bool)U.moving[r];
	d["arrived"] = (bool)U.arrived[r];
	d["order"] = aov::order_name(U.order_type[r]);
	d["target"] = U.order_target[r];
	d["resume"] = U.am_resume[r]; // Godot-only fight-then-walk-on (Combat::engage): 0 none, 1 move, 2 attack-move
	d["anim"] = aov::anim_name(U.anim_state[r]);
	d["repaths"] = U.repaths[r];
	PackedVector2Array path;
	if (U.path[r] >= 0) {
		const auto &p = sim_.paths.at(U.path[r]);
		for (size_t i = (size_t)U.path_idx[r]; i < p.size(); i++) path.push_back(Vector2((real_t)p[i].x, (real_t)p[i].z));
	}
	d["path"] = path;
	if (U.has_goal[r]) d["goal"] = Vector2((real_t)U.goal_x[r], (real_t)U.goal_z[r]);
	return d;
}

PackedInt32Array AovSim::units_near(double x, double z, double r, int64_t owner) const {
	PackedInt32Array out;
	const aov::UnitStore &U = sim_.entities.units;
	const double r2 = r * r;
	// the hash is rebuilt each tick; units spawned since are checked linearly
	for (int i = 0; i < U.size(); i++) {
		if (U.removed[i] || U.dead[i]) continue;
		if (owner >= 0 && U.owner[i] != owner) continue;
		const double dx = U.x[i] - x, dz = U.z[i] - z;
		if (dx * dx + dz * dz <= r2) out.push_back(U.id[i]);
	}
	return out;
}

// ---- commands --------------------------------------------------------------

static std::vector<int> rows_of(const aov::Entities &E, const PackedInt32Array &ids) {
	std::vector<int> rows;
	rows.reserve(ids.size());
	for (int64_t i = 0; i < ids.size(); i++) {
		int r = E.unit_slot(ids[i]);
		if (r >= 0) rows.push_back(r);
	}
	return rows;
}

bool AovSim::order(int64_t id, const Dictionary &o) {
	int r = sim_.entities.unit_slot((int32_t)id);
	if (r < 0) return false;
	String t = o.get("type", "idle");
	aov::Order ord;
	int type = -1;
	for (int i = 0; i < aov::O_TYPE_COUNT; i++)
		if (t == aov::order_name(i)) type = i;
	if (type < 0) {
		ERR_PRINT("AovSim.order: unknown order type " + t);
		return false;
	}
	ord.type = (uint8_t)type;
	ord.target = (int32_t)(int64_t)o.get("target", 0);
	ord.x = o.get("x", 0.0);
	ord.z = o.get("z", 0.0);
	ord.a = (int32_t)(int64_t)o.get("a", 0);
	ord.b = (int32_t)(int64_t)o.get("b", 0);
	ord.c = (int32_t)(int64_t)o.get("c", 0);
	if (type == aov::O_ATTACK) { // {auto, then_buildings} (the JS order flags)
		if ((bool)o.get("auto", false)) ord.b |= aov::ATK_AUTO;
		if ((bool)o.get("then_buildings", false)) ord.b |= aov::ATK_THEN_BUILDINGS;
	}
	return sim_.commands.order(r, ord);
}

void AovSim::order_move(const PackedInt32Array &ids, double x, double z) { sim_.commands.move(rows_of(sim_.entities, ids), x, z); }
void AovSim::order_idle(const PackedInt32Array &ids) { sim_.commands.stop(rows_of(sim_.entities, ids)); }
void AovSim::order_attack_move(const PackedInt32Array &ids, double x, double z) {
	sim_.commands.move(rows_of(sim_.entities, ids), x, z, aov::O_ATTACK_MOVE);
}
void AovSim::smart(const PackedInt32Array &ids, double x, double z, int64_t target_id) {
	sim_.commands.smart(rows_of(sim_.entities, ids), x, z, (int32_t)target_id);
}

bool AovSim::move_to(int64_t id, double x, double z, double range) {
	int r = sim_.entities.unit_slot((int32_t)id);
	if (r < 0) return false;
	return sim_.movement.move_to(r, x, z, nullptr, range);
}

PackedVector2Array AovSim::find_path(double sx, double sz, double gx, double gz) {
	std::vector<aov::Vec2d> pts;
	sim_.pathfinder.pass_owner = -1; // (nobody's gates open)
	sim_.pathfinder.find_path(sx, sz, gx, gz, nullptr, pts);
	PackedVector2Array out;
	for (const auto &p : pts) out.push_back(Vector2((real_t)p.x, (real_t)p.z));
	return out;
}

// ---- events ----------------------------------------------------------------

Array AovSim::take_events() {
	Array out;
	for (const aov::Event &e : sim_.events.outbox) {
		Dictionary d;
		d["type"] = aov::event_name(e.type);
		d["id"] = e.id;
		d["kind"] = e.kind;
		d["other"] = e.other;
		d["owner"] = e.owner;
		d["a"] = e.a;
		d["x"] = e.x;
		d["z"] = e.z;
		d["amount"] = e.amount;
		out.push_back(d);
	}
	sim_.events.outbox.clear();
	return out;
}

PackedFloat64Array AovSim::get_units_f64() const {
	const aov::UnitStore &U = sim_.entities.units;
	PackedFloat64Array out;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r]) continue;
		double v[8] = { (double)U.id[r], U.x[r], U.z[r], U.rot[r], U.hp[r],
			(double)(U.moving[r] | (U.dead[r] << 1) | (U.arrived[r] << 2)), (double)U.order_type[r], (double)U.anim_state[r] };
		for (double d : v) out.push_back(d);
	}
	return out;
}

// ---- buildings -------------------------------------------------------------

static int res_kind_of(const String &s) {
	for (int k = 0; k < aov::RES_COUNT; k++)
		if (s == aov::res_name(k)) return k;
	return -1;
}

static Dictionary cost_dict(const aov::Cost &c) {
	Dictionary d;
	for (int k = 0; k < aov::RES_COUNT; k++)
		if (c.has[k]) d[aov::res_name(k)] = c.v[k];
	return d;
}

static Dictionary result_dict(const aov::Result &r) {
	Dictionary d;
	d["ok"] = r.ok;
	d["reason"] = String(r.reason.c_str());
	return d;
}

PackedStringArray AovSim::building_type_names() const {
	PackedStringArray out;
	for (int i = 0; i < aov::B_TYPE_COUNT; i++) out.push_back(aov::building_def(i).key);
	return out;
}

Dictionary AovSim::get_building_def(const String &type, int64_t owner) const {
	Dictionary d;
	const int t = aov::building_type_of(type.utf8().get_data());
	if (t < 0) return d;
	const aov::BuildingDef &b = aov::building_def(t);
	// (Godot-only, sim/civ: an owner's civ costs and trains; owner 0: the type's own civ, Greek for a shared one)
	const int civ = owner > 0 ? sim_.civs.civ((int)owner) : std::max(0, aov::building_civ(t));
	d["type"] = t;
	d["key"] = b.key;
	d["name"] = b.name;
	d["w"] = b.w;
	d["h"] = b.h;
	// (Godot-only, sim/techs: Retold's Temple cost / hp, its myth units)
	d["hp"] = sim_.godot_rules ? aov::rules_building_hp(t) : b.hp;
	d["cost"] = cost_dict(sim_.godot_rules ? (owner > 0 ? sim_.civs.cost((int)owner, t) : aov::civ_building_cost(civ, t)) : b.cost);
	d["build_time"] = b.build_time;
	d["pop"] = b.pop;
	d["sight"] = b.sight;
	PackedStringArray drop, trains;
	for (int k = 0; k < 3; k++)
		if (b.drops(k)) drop.push_back(aov::res_name(k));
	if (sim_.godot_rules) {
		for (const int *u = aov::civ_trains(civ, t); *u >= 0; u++) trains.push_back(aov::unit_def(*u).key);
	} else
		for (int i = 0; i < 4 && b.trains[i] >= 0; i++) trains.push_back(aov::unit_def(b.trains[i]).key);
	d["dropoff"] = drop;
	d["trains"] = trains;
	d["age_up"] = b.age_up;
	d["farm"] = b.farm;
	d["walkable"] = b.walkable;
	d["worship"] = b.worship;
	d["hotkey"] = b.hotkey;
	d["min_age"] = b.min_age;
	d["variants"] = b.variants;
	civ_building_def(t, civ, d); // (Godot-only, sim/civ)
	return d;
}

int64_t AovSim::spawn_building(const String &type, int64_t owner, int64_t tx, int64_t tz, bool built, bool site) {
	const int t = aov::building_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_building: unknown building type " + type);
		return 0;
	}
	if (!sim_.godot_rules && aov::is_egypt_building(t)) return 0; // (Godot-only types, sim/civ)
	// bounds: a footprint not wholly on the map is refused (0), like can_place
	if (!sim_.map().rect_in_tiles(tx, tz, aov::building_def(t).w, aov::building_def(t).h)) return 0;
	const int b = sim_.buildings.spawn(t, (int)owner, (int)tx, (int)tz, built, site);
	return sim_.entities.buildings.id[b];
}

// (tile arguments are range-checked in 64 bits before the int casts: a
// footprint off the map is never placeable)
static bool tile_arg_ok(int64_t tx, int64_t tz) { return tx > -65536 && tz > -65536 && tx < 65536 && tz < 65536; }

bool AovSim::can_place(const String &type, int64_t tx, int64_t tz) const {
	if (!tile_arg_ok(tx, tz)) return false;
	return sim_.buildings.can_place(aov::building_type_of(type.utf8().get_data()), (int)tx, (int)tz);
}

int64_t AovSim::place_building(const String &type, int64_t owner, int64_t tx, int64_t tz, const PackedInt32Array &builders) {
	if (!tile_arg_ok(tx, tz)) return 0;
	return sim_.buildings.place(aov::building_type_of(type.utf8().get_data()), (int)owner, (int)tx, (int)tz, rows_of(sim_.entities, builders));
}

void AovSim::destroy_building(int64_t id) { sim_.buildings.destroy((int32_t)id); }

Dictionary AovSim::get_building(int64_t id) const {
	Dictionary d;
	const int b = sim_.entities.building_slot((int32_t)id);
	if (b < 0) return d;
	const aov::BuildingStore &B = sim_.entities.buildings;
	d["id"] = B.id[b];
	d["type"] = aov::building_def(B.type[b]).key;
	d["owner"] = B.owner[b];
	d["tx"] = B.tx[b];
	d["tz"] = B.tz[b];
	d["w"] = B.w[b];
	d["h"] = B.h[b];
	d["x"] = B.x[b];
	d["z"] = B.z[b];
	d["hp"] = B.hp[b];
	d["max_hp"] = B.max_hp[b];
	d["built"] = (bool)B.built[b];
	d["progress"] = B.progress[b];
	d["variant"] = B.bld_variant[b];
	Array q;
	for (const aov::TrainItem &it : B.queue[b]) {
		Dictionary e;
		e["type"] = aov::unit_def(it.type).key;
		e["t"] = it.t;
		e["total"] = it.total;
		e["free"] = it.free;
		q.push_back(e);
	}
	d["queue"] = q;
	if (B.rally[b]) {
		Dictionary r;
		r["x"] = B.rally_x[b];
		r["z"] = B.rally_z[b];
		r["target"] = B.rally_target[b];
		d["rally"] = r;
	}
	d["farm_rows"] = B.econ_rows[b];
	d["farmer"] = B.farmer[b];
	d["research"] = get_research(id); // (Godot-only, sim/techs)
	return d;
}

// ---- fortifications (sim/fortify, Godot-only) -------------------------------

static Dictionary fort_result(const aov::FortResult &r) {
	Dictionary d;
	d["ok"] = r.ok;
	d["reason"] = String(r.reason.c_str());
	return d;
}

// a world coordinate's tile, NaN / huge values clamped (plan_wall clamps onto the map)
static int fort_tile(double v) { return std::isnan(v) ? 0 : (int)std::floor(std::max(-1e6, std::min(1e6, v))); }

Dictionary AovSim::plan_wall(int64_t owner, const Vector2 &a, const Vector2 &b) const {
	const aov::WallPlan P = sim_.fortify.plan_wall((int)owner, fort_tile(a.x), fort_tile(a.y), fort_tile(b.x), fort_tile(b.y));
	Dictionary d;
	d["valid"] = P.valid;
	d["reason"] = String(P.reason.c_str());
	PackedInt32Array tiles, pieces;
	PackedByteArray state;
	for (int v : P.tiles) tiles.push_back(v);
	for (uint8_t v : P.state) state.push_back(v);
	for (const aov::WallPiece &w : P.pieces) {
		pieces.push_back(w.type);
		pieces.push_back(w.tx);
		pieces.push_back(w.tz);
		pieces.push_back(w.w);
		pieces.push_back(w.h);
	}
	d["tiles"] = tiles;   // tx, tz pairs in line order
	d["state"] = state;   // per tile: 0 blocked, 1 new wall, 2 joins an existing piece of his
	d["pieces"] = pieces; // 5 each: building type index (wall / wall_pillar), tx, tz, w, h
	d["new_tiles"] = P.new_tiles;
	d["on_building"] = P.on_building; // tiles under a building (refused: "A building is in the way")
	d["cost"] = cost_dict(P.cost);
	return d;
}

Dictionary AovSim::place_wall(int64_t owner, const Vector2 &a, const Vector2 &b, const PackedInt32Array &builders) {
	aov::FortResult r;
	const std::vector<int32_t> ids = sim_.fortify.place_wall((int)owner, fort_tile(a.x), fort_tile(a.y), fort_tile(b.x), fort_tile(b.y),
			rows_of(sim_.entities, builders), r);
	Dictionary d = fort_result(r);
	PackedInt32Array out;
	for (int32_t id : ids) out.push_back(id);
	d["ids"] = out;
	return d;
}

Dictionary AovSim::convert_to_gate(int64_t id) { return fort_result(sim_.fortify.convert_to_gate((int32_t)id)); }
Dictionary AovSim::set_gate_locked(int64_t id, bool locked) { return fort_result(sim_.fortify.set_gate_locked((int32_t)id, locked)); }

Dictionary AovSim::research(int64_t building, const String &tech) {
	const std::string key = tech.utf8().get_data();
	const int t = aov::fort_tech_of(key.c_str());
	if (t) return fort_result(sim_.fortify.research((int32_t)building, t));
	const int g = aov::tech_of(key.c_str()); // (sim/techs)
	if (g < 0) return fort_result({ false, "Unknown technology" });
	const aov::TechResult r = sim_.techs.research((int32_t)building, g);
	return fort_result({ r.ok, r.reason });
}

bool AovSim::cancel_research(int64_t building, const String &tech) {
	const int b = sim_.entities.building_slot((int32_t)building);
	if (b < 0) return false;
	const aov::BuildingStore &B = sim_.entities.buildings;
	const std::string key = tech.utf8().get_data();
	if (B.fort_tech[b] && (key.empty() || aov::fort_tech_of(key.c_str()) == B.fort_tech[b])) return sim_.fortify.cancel_research((int32_t)building);
	int index = -1;
	if (!key.empty()) {
		const int g = aov::tech_of(key.c_str());
		const aov::TechQueue &q = B.tech_queue[b];
		for (size_t i = 0; i < q.size(); i++)
			if ((int)q[i].tech == g) index = (int)i;
		if (index < 0) return false;
	}
	return sim_.techs.cancel((int32_t)building, index);
}

PackedStringArray AovSim::fort_tech_names() const {
	PackedStringArray out;
	for (int t = 1; t < aov::FT_COUNT; t++) out.push_back(aov::fort_tech_def(t).key);
	return out;
}

Dictionary AovSim::get_walls() const {
	const aov::BuildingStore &B = sim_.entities.buildings;
	const aov::Fortify &F = sim_.fortify;
	PackedInt32Array ids, rect;
	PackedByteArray kind, owner, built, axis, conn, level, locked, tech;
	PackedFloat32Array hp, max_hp, progress, open, tech_t;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || !aov::is_fort_type(B.type[b])) continue;
		const int t = B.type[b], o = B.owner[b];
		ids.push_back(B.id[b]);
		kind.push_back(t == aov::B_WALL_PILLAR ? 0 : t == aov::B_WALL ? 1 : t == aov::B_GATE ? 2 : 3);
		owner.push_back(o);
		rect.push_back(B.tx[b]);
		rect.push_back(B.tz[b]);
		rect.push_back(B.w[b]);
		rect.push_back(B.h[b]);
		hp.push_back((float)B.hp[b]);
		max_hp.push_back((float)B.max_hp[b]);
		built.push_back(B.built[b]);
		progress.push_back((float)B.progress[b]);
		axis.push_back(F.axis(b));
		conn.push_back(F.connections(b));
		level.push_back((uint8_t)(t == aov::B_TOWER ? F.tower_level[o] : F.wall_level[o]));
		open.push_back((float)B.fort_open[b]);
		locked.push_back(B.fort_locked[b]);
		tech.push_back(B.fort_tech[b]);
		tech_t.push_back(B.fort_tech_total[b] > 0 ? (float)(B.fort_tech_t[b] / B.fort_tech_total[b]) : 0.f);
	}
	Dictionary d;
	d["count"] = ids.size();
	d["ids"] = ids;
	d["kind"] = kind;         // 0 pillar, 1 wall segment, 2 gate, 3 tower
	d["owner"] = owner;
	d["rect"] = rect;         // 4 each: tx, tz, w, h
	d["hp"] = hp;
	d["max_hp"] = max_hp;
	d["built"] = built;
	d["progress"] = progress;
	d["axis"] = axis;         // 0 runs along x, 1 along z
	d["conn"] = conn;         // bits: 1 -z, 2 +x, 4 +z, 8 -x neighbour is his wall piece
	d["level"] = level;       // the owner's wall / tower stage 0..3
	d["open"] = open;         // gates: leaves 0 closed .. 1 open
	d["locked"] = locked;     // gates
	d["tech"] = tech;         // research in progress: index into fort_tech_names() + 1, 0 none
	d["tech_t"] = tech_t;     // its progress 0..1
	return d;
}

Dictionary AovSim::get_fortify(int64_t owner) const {
	const aov::Fortify &F = sim_.fortify;
	const int o = owner >= 0 && owner < aov::MAX_PLAYERS ? (int)owner : 0;
	Dictionary d;
	d["wall_level"] = F.wall_level[o];
	d["wall_name"] = aov::wall_stage(F.wall_level[o]).name;
	d["wall_tile_hp"] = aov::wall_stage(F.wall_level[o]).tile_hp;
	d["tower_level"] = F.tower_level[o];
	d["tower_name"] = aov::tower_stage(F.tower_level[o]).name;
	const aov::TowerStage &ts = aov::tower_stage(F.tower_level[o]);
	Dictionary tw;
	tw["hp"] = ts.hp;
	tw["range"] = ts.range;
	tw["damage"] = ts.damage;
	tw["cooldown"] = ts.cooldown;
	tw["sight"] = ts.sight;
	d["tower"] = tw;
	Array techs;
	static const char *STATES[] = { "done", "available", "needs_previous", "needs_age", "researching" };
	for (int t = 1; t < aov::FT_COUNT; t++) {
		const aov::FortTechDef &td = aov::fort_tech_def(t);
		Dictionary e;
		e["key"] = td.key;
		e["name"] = td.name;
		e["line"] = td.line ? "tower" : "wall";
		e["level"] = td.level;
		e["min_age"] = td.min_age;
		e["time"] = td.time;
		e["cost"] = cost_dict(td.cost);
		e["state"] = STATES[F.tech_state(o, t)];
		techs.push_back(e);
	}
	d["techs"] = techs;
	d["walls"] = F.walls;
	d["gates"] = F.gates;
	d["towers"] = F.towers;
	return d;
}

// ---- research, techs, market (sim/techs, Godot-only) -------------------------

static const char *tech_effect_name(int k) {
	static const char *n[] = { "none", "attack", "hack_armor", "pierce_armor", "hp", "speed", "range", "sight", "regen", "reload",
		"splash", "divine", "vs_buildings", "vs_myth", "arrow_speed", "track", "poison", "frenzy", "pious", "heal_aura",
		"temple_heal", "favor", "market_fee", "tribute_fee", "omniscience", "queue_view", "armory_discount", "reveal" };
	return k >= 0 && k < aov::TE_COUNT ? n[k] : "?";
}

static PackedStringArray unit_mask_names(aov::UnitMask m) {
	PackedStringArray out;
	for (int u = 0; u < aov::U_TYPE_COUNT; u++)
		if ((m >> u) & 1) out.push_back(aov::unit_def(u).key);
	return out;
}

static Dictionary tech_static(int t) {
	const aov::TechDef &d = aov::tech_def(t);
	Dictionary e;
	e["key"] = d.key;
	e["name"] = d.name;
	e["building"] = aov::building_def(aov::tech_home_building(d.home)).key;
	e["also"] = d.also >= 0 ? String(aov::building_def(d.also).key) : String();
	e["age"] = d.age;
	e["age_name"] = aov::AGES[d.age];
	e["base_cost"] = cost_dict(d.cost);
	e["time"] = d.time;
	e["requires"] = d.requires >= 0 ? String(aov::tech_def(d.requires).key) : String();
	e["god"] = d.god ? String(d.god) : String();
	e["major_god"] = d.major;
	e["generic"] = d.god == nullptr;
	e["missing"] = d.missing ? String(d.missing) : String();
	e["text"] = d.text;
	e["mapping"] = d.mapping;
	Array effs;
	for (const aov::TechEffect &f : d.eff) {
		if (f.kind == aov::TE_NONE) continue;
		Dictionary x;
		x["kind"] = tech_effect_name(f.kind);
		x["units"] = unit_mask_names(f.units);
		x["buildings"] = f.buildings;
		x["value"] = f.v;
		x["retold"] = f.retold;
		effs.push_back(x);
	}
	e["effects"] = effs;
	e["id"] = t;
	e["event_a"] = aov::TECH_EVENT_BASE + t;
	return e;
}

PackedStringArray AovSim::tech_names() const {
	PackedStringArray out;
	for (int t = 0; t < aov::T_COUNT; t++) out.push_back(aov::tech_def(t).key);
	return out;
}

Dictionary AovSim::get_tech_def(const String &tech) const {
	const int t = aov::tech_of(tech.utf8().get_data());
	return t < 0 ? Dictionary() : tech_static(t);
}

// one tech's entry for an owner (static data + state, the price he would pay, progress)
static Dictionary tech_entry(const aov::Sim &S, int owner, int t) {
	Dictionary e = tech_static(t);
	std::string why;
	const int st = S.techs.state(owner, t, &why);
	e["state"] = aov::tech_state_name(st);
	e["reason"] = String(why.c_str());
	e["cost"] = cost_dict(S.techs.cost_for(owner, t));
	int32_t at = 0;
	int idx = -1;
	if (S.techs.queued_at(owner, t, &at, &idx)) {
		const int b = S.entities.building_slot(at);
		const aov::TechItem &it = S.entities.buildings.tech_queue[b][idx];
		e["at"] = at;
		e["queue_index"] = idx;
		e["progress"] = it.total > 0 ? it.t / it.total : 0.0;
	}
	return e;
}

// (sim/civ) a building's tech list holds its owner's civ's techs only (a Greek
// Temple never lists Hands of the Pharaoh, an Egyptian one no Greek god tech)
static bool civ_tech_of(const aov::Sim &s, int t, int owner) {
	const int c = aov::tech_civ(t);
	return c < 0 || c == s.civs.civ(owner);
}
#define civ_tech(t, owner) civ_tech_of(sim_, (t), (owner))

Array AovSim::get_owner_techs(int64_t owner, const String &building_type) const {
	Array out;
	const int bt = aov::building_type_of(building_type.utf8().get_data());
	if (bt < 0 || owner <= 0 || owner >= aov::MAX_PLAYERS) return out;
	for (int t = 0; t < aov::T_COUNT; t++)
		if (sim_.techs.researches_at(bt, t) && civ_tech(t, (int)owner)) out.push_back(tech_entry(sim_, (int)owner, t));
	return out;
}

Array AovSim::get_techs(int64_t building) const {
	Array out;
	const int b = sim_.entities.building_slot((int32_t)building);
	if (b < 0) return out;
	const aov::BuildingStore &B = sim_.entities.buildings;
	const int type = B.type[b], owner = B.owner[b];
	if (aov::is_fort_type(type)) {
		// the fortification stages researched here, in the same shape
		static const char *STATES[] = { "done", "available", "locked_prereq", "locked_age", "researching" };
		const aov::Fortify &F = sim_.fortify;
		for (int t = 1; t < aov::FT_COUNT; t++) {
			const aov::FortTechDef &td = aov::fort_tech_def(t);
			if (td.line == 1 ? type != aov::B_TOWER : !aov::is_wall_piece(type)) continue;
			Dictionary e;
			e["key"] = td.key;
			e["name"] = td.name;
			e["building"] = td.line ? "tower" : "wall";
			e["age"] = td.min_age;
			e["age_name"] = aov::AGES[td.min_age];
			e["cost"] = cost_dict(td.cost);
			e["base_cost"] = cost_dict(td.cost);
			e["time"] = td.time;
			e["requires"] = td.level > 1 ? String(aov::fort_tech_def(t - 1).key) : String();
			e["generic"] = true;
			e["fort"] = true;
			e["state"] = STATES[F.tech_state(owner, t)];
			if (B.fort_tech[b] == t) e["progress"] = B.fort_tech_total[b] > 0 ? B.fort_tech_t[b] / B.fort_tech_total[b] : 0.0;
			out.push_back(e);
		}
		return out;
	}
	for (int t = 0; t < aov::T_COUNT; t++)
		if (sim_.techs.researches_at(type, t) && civ_tech(t, owner)) out.push_back(tech_entry(sim_, owner, t));
	return out;
}

Array AovSim::get_research(int64_t building) const {
	Array out;
	const int b = sim_.entities.building_slot((int32_t)building);
	if (b < 0) return out;
	const aov::BuildingStore &B = sim_.entities.buildings;
	if (B.fort_tech[b]) {
		Dictionary e;
		e["key"] = aov::fort_tech_def(B.fort_tech[b]).key;
		e["name"] = aov::fort_tech_def(B.fort_tech[b]).name;
		e["t"] = B.fort_tech_t[b];
		e["total"] = B.fort_tech_total[b];
		e["progress"] = B.fort_tech_total[b] > 0 ? B.fort_tech_t[b] / B.fort_tech_total[b] : 0.0;
		out.push_back(e);
	}
	for (const aov::TechItem &it : B.tech_queue[b]) {
		Dictionary e;
		e["key"] = aov::tech_def(it.tech).key;
		e["name"] = aov::tech_def(it.tech).name;
		e["t"] = it.t;
		e["total"] = it.total;
		e["progress"] = it.total > 0 ? it.t / it.total : 0.0;
		Dictionary paid;
		for (int k = 0; k < aov::RES_COUNT; k++)
			if (it.paid[k] != 0) paid[aov::res_name(k)] = it.paid[k];
		e["paid"] = paid;
		out.push_back(e);
	}
	return out;
}

Dictionary AovSim::get_player_techs(int64_t owner) const {
	Dictionary d;
	if (owner <= 0 || owner >= aov::MAX_PLAYERS || !sim_.players[owner].exists) return d;
	const aov::Techs &T = sim_.techs;
	const int o = (int)owner;
	PackedStringArray done;
	for (int t = 0; t < aov::T_COUNT; t++)
		if (T.is_done(o, t)) done.push_back(aov::tech_def(t).key);
	d["done"] = done;
	Array queue;
	const aov::BuildingStore &B = sim_.entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || B.owner[b] != o) continue;
		for (size_t i = 0; i < B.tech_queue[b].size(); i++) {
			const aov::TechItem &it = B.tech_queue[b][i];
			Dictionary e;
			e["key"] = aov::tech_def(it.tech).key;
			e["building"] = B.id[b];
			e["index"] = (int)i;
			e["progress"] = it.total > 0 ? it.t / it.total : 0.0;
			queue.push_back(e);
		}
	}
	d["queue"] = queue;
	Dictionary gods;
	for (int a = 1; a <= 3; a++) gods[a] = String(T.minor[o][a].c_str());
	d["minor_gods"] = gods;
	d["god"] = String(sim_.players[o].god.c_str());
	const aov::TechMods &m = T.mods[o];
	d["market_fee"] = T.fee(o);
	d["tribute_fee"] = T.tribute_fee(o);
	d["favor_mult"] = T.favor_mult(o);
	d["building_attack"] = T.building_attack(o);
	d["building_sight"] = m.b_sight;
	d["omniscience"] = m.omniscience;
	d["queue_view"] = m.queue_view;
	d["armory_discount"] = m.armory_discount;
	d["has_market"] = T.has_market(o);
	return d;
}

Dictionary AovSim::set_minor_god(int64_t owner, int64_t age, const String &god) {
	const aov::TechResult r = sim_.techs.set_minor_god((int)owner, (int)age, god.utf8().get_data());
	return fort_result({ r.ok, r.reason });
}

bool AovSim::grant_tech(int64_t owner, const String &tech) {
	const int t = aov::tech_of(tech.utf8().get_data());
	if (t < 0 || owner <= 0 || owner >= aov::MAX_PLAYERS || !sim_.players[owner].exists) return false;
	sim_.techs.grant((int)owner, t);
	return sim_.techs.is_done((int)owner, t);
}

Dictionary AovSim::get_unit_stats(int64_t id) const {
	Dictionary d;
	const int r = sim_.entities.unit_slot((int32_t)id);
	if (r < 0) return d;
	const aov::UnitStats s = sim_.techs.stats(r);
	d["damage"] = s.damage;
	d["hp"] = s.hp;
	d["max_hp"] = s.max_hp;
	d["speed"] = s.speed;
	d["range"] = s.range;
	d["sight"] = s.sight;
	d["hack_armor"] = s.hack_armor;
	d["pierce_armor"] = s.pierce_armor;
	d["reload"] = s.reload;
	d["splash"] = s.splash;
	d["divine"] = s.divine;
	d["regen"] = s.regen;
	d["vs_buildings"] = s.vs_buildings;
	d["vs_myth"] = s.vs_myth;
	d["track"] = s.track;
	d["arrow_speed"] = s.arrow_speed;
	d["poisoned"] = sim_.entities.units.tech_poison_t[r];
	return d;
}

Dictionary AovSim::get_market(int64_t owner) const {
	Dictionary d;
	const aov::Techs &T = sim_.techs;
	const int o = (int)owner;
	for (int k = 0; k < aov::RES_COUNT; k++) {
		if (k == aov::RES_GOLD) continue;
		Dictionary e;
		const bool tr = aov::market_tradable(k);
		e["tradable"] = tr;
		if (tr) {
			e["price"] = T.price[k];
			e["buy"] = T.buy_price(o, k);
			e["sell"] = T.sell_price(o, k);
		}
		d[aov::res_name(k)] = e;
	}
	d["fee"] = T.fee(o);
	d["tribute_fee"] = T.tribute_fee(o);
	d["lot"] = aov::MARKET_LOT;
	d["base"] = aov::MARKET_BASE;
	d["step"] = aov::MARKET_STEP;
	d["drift"] = aov::MARKET_DRIFT;
	d["min"] = aov::MARKET_MIN;
	d["max"] = aov::MARKET_MAX;
	d["has_market"] = o > 0 && o < aov::MAX_PLAYERS && T.has_market(o);
	return d;
}

static Dictionary trade_dict(const aov::TradeResult &r) {
	Dictionary d;
	d["ok"] = r.ok;
	d["reason"] = String(r.reason.c_str());
	d["gold"] = r.gold;
	d["amount"] = r.amount;
	return d;
}

Dictionary AovSim::market_buy(int64_t market, const String &res) { return trade_dict(sim_.techs.buy((int32_t)market, res_kind_of(res))); }
Dictionary AovSim::market_sell(int64_t market, const String &res) { return trade_dict(sim_.techs.sell((int32_t)market, res_kind_of(res))); }

Dictionary AovSim::tribute(int64_t from, int64_t to, const String &res, double amount) {
	const aov::TradeResult r = sim_.techs.tribute((int)from, (int)to, res_kind_of(res), amount);
	Dictionary d;
	d["ok"] = r.ok;
	d["reason"] = String(r.reason.c_str());
	d["amount"] = r.amount;
	d["fee"] = r.gold;
	return d;
}

void AovSim::set_tech_rules(const Dictionary &opts) {
	if (opts.has("heroic_needs_armory")) sim_.techs.heroic_needs_armory = (bool)opts["heroic_needs_armory"];
}

Dictionary AovSim::get_tech_rules() const {
	Dictionary d;
	d["heroic_needs_armory"] = sim_.techs.heroic_needs_armory;
	d["researched"] = sim_.techs.researched;
	d["reveals"] = (int)sim_.techs.reveals.size();
	d["reveal_radius"] = aov::REVEAL_RADIUS;
	return d;
}

// ---- economy ---------------------------------------------------------------

Dictionary AovSim::train(int64_t building, const String &unit_type) {
	const int b = sim_.entities.building_slot((int32_t)building);
	const int t = aov::unit_type_of(unit_type.utf8().get_data());
	if (b < 0 || t < 0) return result_dict({ false, "Cannot train here" });
	return result_dict(sim_.economy.train(b, t));
}

void AovSim::cancel_train(int64_t building, int64_t index) {
	sim_.economy.cancel_train(sim_.entities.building_slot((int32_t)building), (int)index);
}

Dictionary AovSim::advance_age(int64_t owner) { return result_dict(sim_.economy.advance_age((int)owner)); }

Dictionary AovSim::next_age_cost(int64_t owner) const {
	aov::Cost c;
	if (owner < 0 || owner >= aov::MAX_PLAYERS || !sim_.economy.next_age_cost((int)owner, c)) return Dictionary();
	return cost_dict(c);
}

void AovSim::set_rally(int64_t building, double x, double z, int64_t target_id) {
	const int b = sim_.entities.building_slot((int32_t)building);
	if (b < 0 || !sim_.map().clamp_to_map(x, z)) return; // (bounds: an off-map point goes onto the edge; NaN is ignored)
	aov::BuildingStore &B = sim_.entities.buildings;
	B.rally[b] = 1;
	B.rally_x[b] = x;
	B.rally_z[b] = z;
	B.rally_target[b] = (int32_t)target_id;
}

void AovSim::clear_rally(int64_t building) {
	const int b = sim_.entities.building_slot((int32_t)building);
	if (b >= 0) sim_.entities.buildings.rally[b] = 0;
}

int64_t AovSim::nearest_resource(double x, double z, const String &res_type, double max_dist) {
	const int k = res_kind_of(res_type);
	return k < 0 ? 0 : sim_.economy.nearest_resource(x, z, k, max_dist);
}

int64_t AovSim::nearest_dropoff(int64_t owner, double x, double z, const String &res_type) {
	const int k = res_kind_of(res_type);
	return k < 0 ? 0 : sim_.economy.nearest_dropoff((int)owner, x, z, k);
}

void AovSim::order_gather(const PackedInt32Array &ids, int64_t target) {
	for (int r : rows_of(sim_.entities, ids)) sim_.commands.order(r, aov::Order::with_target(aov::O_GATHER, (int32_t)target));
}
void AovSim::order_build(const PackedInt32Array &ids, int64_t target) {
	for (int r : rows_of(sim_.entities, ids)) sim_.commands.order(r, aov::Order::with_target(aov::O_BUILD, (int32_t)target));
}
void AovSim::order_worship(const PackedInt32Array &ids, int64_t target) {
	for (int r : rows_of(sim_.entities, ids)) sim_.commands.order(r, aov::Order::with_target(aov::O_WORSHIP, (int32_t)target));
}
void AovSim::order_dropoff(const PackedInt32Array &ids, int64_t target) {
	for (int r : rows_of(sim_.entities, ids)) sim_.commands.order(r, aov::Order::with_target(aov::O_DROPOFF, (int32_t)target));
}

void AovSim::set_player_resources(int64_t owner, const Dictionary &res) {
	if (owner < 0 || owner >= aov::MAX_PLAYERS || !sim_.players[owner].exists) return;
	for (int k = 0; k < aov::RES_COUNT; k++)
		if (res.has(aov::res_name(k))) sim_.players[owner].res[k] = (double)res[aov::res_name(k)];
}

void AovSim::set_player_age(int64_t owner, int64_t age) {
	if (owner < 0 || owner >= aov::MAX_PLAYERS || !sim_.players[owner].exists) return;
	sim_.players[owner].age = (int)std::max<int64_t>(0, std::min<int64_t>(3, age));
}

PackedInt32Array AovSim::spawn_herd(const String &type, double x, double z, int64_t n) {
	PackedInt32Array out;
	const int t = aov::resource_type_of(type.utf8().get_data());
	if (!aov::is_animal_type(t)) {
		ERR_PRINT("AovSim.spawn_herd: not an animal: " + type);
		return out;
	}
	if (!sim_.map().clamp_to_map(x, z)) return out; // (bounds: the herd centre goes onto the map; NaN spawns none)
	for (int32_t id : sim_.economy.wildlife.spawn_herd(t, x, z, (int)n)) out.push_back(id);
	return out;
}

int64_t AovSim::spawn_boat(int64_t owner, double x, double z, double rot) {
	if (!sim_.map().clamp_to_map(x, z)) return 0; // (bounds: clamped onto the map, NaN refused)
	return sim_.economy.fishing.boats[sim_.economy.fishing.spawn_boat((int)owner, x, z, rot)].id;
}

int64_t AovSim::spawn_shoal(double x, double z, double amount) {
	if (!sim_.map().clamp_to_map(x, z)) return 0; // (bounds: clamped onto the map, NaN refused)
	return sim_.economy.fishing.shoals[sim_.economy.fishing.spawn_shoal(x, z, amount)].id;
}

Dictionary AovSim::get_economy() const {
	const aov::Economy &ec = sim_.economy;
	const aov::ResourceStore &R = sim_.entities.resources;
	Dictionary d;
	{
		PackedInt32Array ids;
		PackedByteArray type, alive, moving;
		PackedFloat32Array pos, prev, rot, prot, flash, speed, graze, dead_t, amount, max_amount, ground;
		const aov::GameMap &map = sim_.world.map;
		for (int32_t id : ec.wildlife.animals) {
			const int a = sim_.entities.resource_slot(id);
			if (a < 0) continue;
			ids.push_back(id);
			type.push_back(R.type[a] == aov::R_BOAR ? 1 : 0);
			alive.push_back(R.alive[a]);
			moving.push_back(R.an_moving[a]);
			pos.push_back((float)R.x[a]);
			pos.push_back((float)R.z[a]);
			prev.push_back((float)R.prev_x[a]);
			prev.push_back((float)R.prev_z[a]);
			rot.push_back((float)R.rot[a]);
			prot.push_back((float)R.prev_rot[a]);
			flash.push_back((float)R.flash_t[a]);
			speed.push_back((float)R.an_speed[a]);
			graze.push_back((float)R.an_graze[a]);
			dead_t.push_back((float)R.an_dead_t[a]);
			amount.push_back((float)R.amount[a]);
			max_amount.push_back((float)R.max_amount[a]);
			ground.push_back((float)map.height_at(R.x[a], R.z[a]));
		}
		Dictionary an;
		an["count"] = ids.size();
		an["ids"] = ids;
		an["type"] = type; // 0 deer, 1 boar
		an["alive"] = alive;
		an["moving"] = moving;
		an["pos"] = pos;
		an["prev_pos"] = prev;
		an["rot"] = rot;
		an["prev_rot"] = prot;
		an["flash_t"] = flash;
		an["speed"] = speed;
		an["graze"] = graze;
		an["dead_t"] = dead_t;
		an["amount"] = amount;
		an["max_amount"] = max_amount;
		an["ground_y"] = ground;
		d["animals"] = an;
	}
	{
		PackedFloat32Array sp;
		for (const aov::Spear &s : ec.spears) {
			const double v[8] = { s.x0, s.z0, s.y0, s.x1, s.z1, s.y1, s.t, s.dur };
			for (double x : v) sp.push_back((float)x);
		}
		d["spears"] = sp; // 8 per spear: x0, z0, y0, x1, z1, y1, t, dur
	}
	{
		PackedFloat32Array sh;
		for (const aov::Shoal &s : ec.fishing.shoals) {
			const double v[6] = { (double)s.id, s.x, s.z, s.amount, s.max_amount, s.phase };
			for (double x : v) sh.push_back((float)x);
		}
		d["shoals"] = sh; // 6 per shoal: id, x, z, amount, max_amount, phase
	}
	{
		PackedFloat32Array bo;
		for (const aov::Boat &b : ec.fishing.boats) {
			const double v[10] = { (double)b.id, (double)b.owner, b.x, b.z, b.prev_x, b.prev_z, b.rot, b.prev_rot, (double)b.state, b.carry };
			for (double x : v) bo.push_back((float)x);
		}
		d["boats"] = bo; // 10 per boat: id, owner, x, z, prev_x, prev_z, rot, prev_rot, state (0 idle 1 to shoal 2 fishing 3 to dock), carry
	}
	return d;
}

Dictionary AovSim::get_decor() const {
	Dictionary d;
	PackedStringArray keys;
	PackedFloat32Array xf;
	for (const aov::Decor &e : sim_.economy.decor) {
		keys.push_back(e.key.c_str());
		xf.push_back((float)e.x);
		xf.push_back((float)e.z);
		xf.push_back((float)e.rot);
		xf.push_back((float)e.scale);
		xf.push_back((float)e.y);
	}
	d["count"] = keys.size();
	d["keys"] = keys;
	d["xform"] = xf;
	return d;
}

// ---- scenes ----------------------------------------------------------------

bool AovSim::has_scene_setup(const String &name) const { return aov::scenes::has(name.utf8().get_data()); }

static PackedInt32Array ids_of(const std::vector<int32_t> &v) {
	PackedInt32Array out;
	for (int32_t id : v) out.push_back(id);
	return out;
}

Dictionary AovSim::setup_scene(const String &name, const Dictionary &opts) {
	aov::scenes::SceneOpts so;
	if (opts.has("units")) so.units = (int)(int64_t)opts["units"];
	if (opts.has("fort")) so.fort = opts["fort"];
	sim_.scene = aov::scenes::setup(sim_, name.utf8().get_data(), so);
	const aov::SceneCtx &c = sim_.scene;
	Dictionary d;
	if (!c.ok) return d;
	d["focus"] = Vector2((real_t)c.focus_x, (real_t)c.focus_z);
	d["tc"] = c.tc.id;
	if (c.fields) {
		PackedInt32Array f;
		f.push_back(c.fields_x0);
		f.push_back(c.fields_z0);
		f.push_back(c.fields_cols);
		d["fields"] = f;
	}
	if (!c.hunt_spot.empty()) d["hunt_spot"] = Vector2((real_t)c.hunt_spot[0], (real_t)c.hunt_spot[1]);
	d["select"] = ids_of(c.select);
	d["army"] = ids_of(c.army);
	d["villagers"] = ids_of(c.villagers);
	return d;
}

void AovSim::scene_after(const String &name) { aov::scenes::after(sim_, name.utf8().get_data(), sim_.scene); }

PackedFloat64Array AovSim::get_econ_f64() const {
	PackedFloat64Array out;
	for (const aov::Player &p : sim_.players) {
		if (!p.exists) continue;
		for (double v : p.res) out.push_back(v);
		out.push_back(p.pop);
		out.push_back(p.pop_cap);
		out.push_back(p.age);
	}
	const aov::BuildingStore &B = sim_.entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b]) continue;
		const double v[6] = { (double)B.id[b], B.hp[b], B.progress[b], (double)B.built[b], (double)B.queue[b].size(), B.econ_rows[b] };
		for (double x : v) out.push_back(x);
	}
	const aov::ResourceStore &R = sim_.entities.resources;
	for (int r = 0; r < R.size(); r++) {
		if (R.removed[r]) continue;
		const double v[4] = { (double)R.id[r], R.amount[r], R.x[r], R.z[r] };
		for (double x : v) out.push_back(x);
	}
	// combat: arrows in flight, god power state (thrown units' height), AI wave state
	out.push_back((double)sim_.combat.projectiles.size());
	for (const aov::Projectile &p : sim_.combat.projectiles) {
		out.push_back(p.target);
		out.push_back(p.x);
		out.push_back(p.y);
		out.push_back(p.z);
	}
	out.push_back((double)sim_.godpowers.airborne.size());
	for (int32_t id : sim_.godpowers.airborne) {
		out.push_back(id);
		const int u = sim_.entities.unit_slot(id);
		out.push_back(u >= 0 ? sim_.entities.units.air_y[u] : 0);
	}
	for (const aov::EnemyAI &ai : sim_.combat.ais) {
		out.push_back(ai.owner);
		out.push_back(ai.wave_size);
		out.push_back(ai.next_wave_at);
	}
	return out;
}

// ---- combat ----------------------------------------------------------------

void AovSim::damage(int64_t target, double amount, int64_t attacker) {
	aov::Hitter h = sim_.combat.hitter_of((int32_t)attacker);
	if (!h.id) h.none = true;
	sim_.combat.damage((int32_t)target, amount, h);
}

void AovSim::set_ai_enabled(bool on) { sim_.combat.ai().enabled = on; }
void AovSim::add_ai(int64_t owner) { sim_.combat.add_ai((int)owner); }

Dictionary AovSim::get_ai(int64_t owner) const {
	Dictionary d;
	for (const aov::EnemyAI &ai : sim_.combat.ais) {
		if (ai.owner != owner) continue;
		d["enabled"] = ai.enabled;
		d["wave_size"] = ai.wave_size;
		d["next_wave_at"] = ai.next_wave_at;
		d["aggression"] = ai.aggression;
		d["difficulty"] = String(aov::ai_difficulty_name(ai.difficulty));
		Array waves;
		for (const aov::WaveLog &w : ai.waves) {
			Dictionary wd;
			wd["t"] = w.t;
			wd["target"] = w.target;
			wd["x"] = w.tx;
			wd["z"] = w.tz;
			PackedInt32Array ids;
			for (int32_t id : w.units) ids.push_back(id);
			wd["units"] = ids;
			waves.push_back(wd);
		}
		d["waves"] = waves;
		Dictionary casts;
		for (int k = 0; k < aov::GP_COUNT; k++) casts[aov::power_def(k).key] = ai.casts[k];
		d["casts"] = casts;
		// Godot-only: what it researched (combat/enemy_ai_techs.cpp)
		Dictionary tk;
		tk["armories"] = ai.techs.armories;
		tk["started"] = ai.techs.started;
		tk["holds"] = ai.techs.holds;
		tk["markets"] = ai.techs.markets;
		tk["age_holds"] = ai.techs.age_holds;
		tk["sold"] = ai.techs.sold;
		tk["bought"] = ai.techs.bought;
		tk["gold_in"] = ai.techs.gold_in;
		tk["gold_out"] = ai.techs.gold_out;
		tk["classical_at"] = ai.techs.age_at[1];
		tk["heroic_at"] = ai.techs.age_at[2];
		tk["mythic_at"] = ai.techs.age_at[3];
		tk["last_tech"] = ai.techs.last_tech >= 0 ? String(aov::tech_def(ai.techs.last_tech).key) : String();
		tk["tech_level"] = ai.par.tech_level;
		tk["max_age"] = ai.par.max_age;
		tk["saving_for"] = ai.saving_for(); // -1 none, 1000 + building type, 2000 + age, else a TechId
		d["techs"] = tk;
		// Godot-only: what it did with fortifications (combat/enemy_ai_fort.cpp)
		Dictionary f;
		f["towers"] = ai.fort.towers;
		f["wall_lines"] = ai.fort.wall_lines;
		f["wall_tiles"] = ai.fort.wall_tiles;
		f["gates"] = ai.fort.gates;
		f["upgrades"] = ai.fort.upgrades;
		f["repairs"] = ai.fort.repairs;
		f["focus"] = ai.fort.focus;
		f["avoided"] = ai.fort.avoided;
		f["retreats"] = ai.fort.retreats;
		f["reopened"] = ai.fort.reopened;
		f["patched"] = ai.fort.patched;
		f["dropped"] = ai.fort.dropped;
		f["sieges"] = ai.fort.sieges;
		f["sieged"] = ai.fort.sieged;
		f["breached"] = ai.fort.breached;
		f["upgrade_holds"] = ai.fort.upgrade_holds;
		f["storehouses"] = ai.fort.storehouses;
		f["regroups"] = ai.fort.regroups;
		f["retargets"] = ai.fort.retargets;
		f["ring_at"] = ai.fort.ring_at;
		f["ring_done_at"] = ai.fort.ring_done_at;
		f["ring_state"] = ai.ring_state();
		f["ring_r"] = ai.ring_radius();
		f["lines_left"] = ai.ring_lines_left();
		f["line_cost"] = Vector2(ai.ring_line_wood(), ai.ring_line_gold());
		f["unbuilt"] = ai.ring_unbuilt();
		Array gaps;
		for (const aov::AIGateGap &g : ai.gate_gaps()) {
			Dictionary gd;
			gd["a"] = Vector2i(g.tx0, g.tz0);
			gd["b"] = Vector2i(g.tx1, g.tz1);
			gd["state"] = g.state;
			gd["seg"] = g.seg;
			gaps.push_back(gd);
		}
		f["gaps"] = gaps;
		d["fort"] = f;
		break;
	}
	return d;
}

void AovSim::set_ai(int64_t owner, const Dictionary &d) {
	for (aov::EnemyAI &ai : sim_.combat.ais) {
		if (ai.owner != owner) continue;
		if (d.has("enabled")) ai.enabled = d["enabled"];
		if (d.has("wave_size")) ai.wave_size = (int)(int64_t)d["wave_size"];
		if (d.has("next_wave_at")) ai.next_wave_at = d["next_wave_at"];
		if (d.has("aggression")) ai.aggression = d["aggression"];
		if (d.has("difficulty")) {
			const int df = aov::ai_difficulty_of(String(d["difficulty"]).utf8().get_data());
			ai.set_difficulty(df);
			aov::Player &p = sim_.players[owner];
			p.difficulty = df;
			p.gather_mult = aov::ai_params(df).gather_mult;
		}
		// Godot-only fortification knobs (checks): wall ring from this time, a fortified town now
		if (d.has("wall_at")) {
			ai.par.walls = true;
			ai.par.wall_at = d["wall_at"];
			if (ai.par.wall_builders <= 0) ai.par.wall_builders = 3;
		}
		if (d.has("towers_max")) ai.par.towers_max = (int)(int64_t)d["towers_max"];
		if (d.has("armory_at")) ai.par.armory_at = (int)(int64_t)d["armory_at"]; // (0: no Armory, no research)
		// (research knobs, checks: enemy_ai_techs.cpp)
		if (d.has("max_age")) ai.par.max_age = (int)(int64_t)d["max_age"];
		if (d.has("market_age")) ai.par.market_age = (int)(int64_t)d["market_age"];
		if (d.has("tech_level")) ai.par.tech_level = (int)(int64_t)d["tech_level"];
		if (d.has("trade_glut")) ai.par.trade_glut = d["trade_glut"];
		if (d.has("breach_focus")) ai.par.breach_focus = d["breach_focus"];
		if (d.has("fort") && !(bool)d["fort"]) { // no fortifications at all (A/B checks)
			ai.par.towers_max = 0;
			ai.par.walls = false;
			ai.par.repairers = 0;
			ai.par.tower_upgrade = ai.par.wall_upgrade = false;
		}
		if (d.has("fortify_now")) ai.fortify_now((int)(int64_t)d["fortify_now"]);
		return;
	}
}

void AovSim::set_unit_combat(int64_t id, const Dictionary &d) {
	const int r = sim_.entities.unit_slot((int32_t)id);
	if (r < 0) return;
	aov::UnitStore &U = sim_.entities.units;
	if (d.has("leash")) U.combat_leash[r] = d["leash"];
	if (d.has("reach")) U.combat_reach[r] = d["reach"];
	if (d.has("kit")) U.kit[r] = (uint8_t)(int64_t)d["kit"];
	if (d.has("line")) {
		const Variant v = d["line"];
		if (v.get_type() == Variant::DICTIONARY) {
			const Dictionary l = v;
			U.combat_line[r] = 1;
			U.line_cx[r] = l.get("cx", 0.0);
			U.line_cz[r] = l.get("cz", 0.0);
			U.line_nx[r] = l.get("nx", 0.0);
			U.line_nz[r] = l.get("nz", 0.0);
			U.line_d0[r] = l.get("d0", 0.0);
		} else
			U.combat_line[r] = 0;
	}
}

Dictionary AovSim::get_combat() const {
	const aov::Combat &C = sim_.combat;
	Dictionary d;
	PackedFloat32Array pr, st, sc, dr;
	PackedInt32Array pt;
	for (const aov::Projectile &p : C.projectiles) {
		// 16 floats: x, y, z, px, py, pz, sx, sy, sz, tx, ty, tz, t, dur, arc, dist (tx.. valid once has_t)
		const double v[16] = { p.x, p.y, p.z, p.px, p.py, p.pz, p.sx, p.sy, p.sz, p.tx, p.ty, p.tz, p.t, p.dur, p.arc, p.dist };
		for (double x : v) pr.push_back((float)x);
		pt.push_back(p.target);
		pt.push_back(p.has_t ? 1 : 0);
	}
	for (const aov::StuckArrow &s : C.stuck) {
		const double v[7] = { s.x, s.y, s.z, s.dx, s.dy, s.dz, s.t };
		for (double x : v) st.push_back((float)x);
	}
	for (const aov::Scar &s : C.scars) {
		const double v[5] = { s.x, s.z, s.radius, s.dirt, s.blood };
		for (double x : v) sc.push_back((float)x);
	}
	for (const aov::Drop &g : C.drops) {
		const double v[9] = { (double)g.kind, g.x, g.z, g.rot, (double)g.owner, g.tilt, g.roll, g.lift, g.life };
		for (double x : v) dr.push_back((float)x);
	}
	d["projectiles"] = pr;     // 16 floats each (see above)
	d["projectile_info"] = pt; // 2 ints each: target id, has target position
	d["stuck"] = st;           // 7 floats each: x, y, z, dx, dy, dz, t (arrows in the ground)
	d["scars"] = sc;           // 5 floats each: x, z, radius, dirt, blood (BattleFX.scar of the scene)
	d["drops"] = dr;           // 9 floats each: kind (shield, helmet, spear, stub), x, z, rot, owner, tilt, roll, lift, die time
	return d;
}

// ---- god powers ---------------------------------------------------------------

PackedStringArray AovSim::power_names() const {
	PackedStringArray out;
	for (int i = 0; i < aov::GP_COUNT; i++) out.push_back(aov::power_def(i).key);
	return out;
}

Dictionary AovSim::get_power_def(const String &power) const {
	const int id = aov::power_of(power.utf8().get_data());
	Dictionary d;
	if (id < 0) return d;
	const aov::PowerDef &p = aov::power_def(id);
	d["key"] = p.key;
	d["name"] = p.name;
	d["god"] = p.god;
	d["favor"] = p.cost.v[aov::RES_FAVOR];
	d["cooldown"] = p.cooldown;
	d["radius"] = p.radius;
	d["duration"] = p.duration;
	d["damage"] = p.damage;
	d["hotkey"] = p.hotkey;
	d["desc"] = p.desc;
	return d;
}

Dictionary AovSim::can_cast(int64_t owner, const String &power) const {
	const aov::CastCheck c = sim_.godpowers.can_cast((int)owner, aov::power_of(power.utf8().get_data()));
	Dictionary d;
	d["ok"] = c.ok;
	d["reason"] = String(c.reason.c_str());
	return d;
}

bool AovSim::cast_power(int64_t owner, const String &power, double x, double z) {
	return sim_.godpowers.cast((int)owner, aov::power_of(power.utf8().get_data()), x, z);
}

double AovSim::power_cooldown(int64_t owner, const String &power) const {
	return sim_.godpowers.cooldown_left((int)owner, aov::power_of(power.utf8().get_data()));
}

Dictionary AovSim::get_godpowers() const {
	const aov::GodPowers &G = sim_.godpowers;
	Dictionary d;
	PackedFloat32Array storms, bolts, scorches, zaps, meteors, fires;
	PackedInt32Array bolt_seeds, scorch_seeds, zap_units;
	for (const aov::Storm &s : G.storms) {
		if (s.done) continue;
		const double v[6] = { (double)s.owner, s.x, s.z, s.t0, s.duration, s.radius };
		for (double x : v) storms.push_back((float)x);
	}
	for (const aov::Bolt &b : G.bolts) {
		const double v[6] = { b.x, b.y, b.z, b.t0, b.life, b.sky ? 1.0 : 0.0 };
		for (double x : v) bolts.push_back((float)x);
		bolt_seeds.push_back((int32_t)b.seed);
	}
	for (const aov::Scorch &s : G.scorches) {
		const double v[6] = { s.x, s.y, s.z, s.t0, s.size, s.blast ? 1.0 : 0.0 };
		for (double x : v) scorches.push_back((float)x);
		scorch_seeds.push_back((int32_t)s.seed);
	}
	for (const aov::Zap &z : G.zaps) {
		const double v[5] = { z.x, z.y, z.z, z.t0, z.life };
		for (double x : v) zaps.push_back((float)x);
		zap_units.push_back(z.unit);
		zap_units.push_back((int32_t)z.seed);
	}
	for (const aov::Meteor &m : G.meteors) {
		const double v[9] = { (double)m.owner, m.x, m.z, m.t0, m.delay, m.radius, m.sx, m.sy, m.sz };
		for (double x : v) meteors.push_back((float)x);
	}
	for (const aov::Fire &f : G.fires) {
		const double v[6] = { f.x, f.y, f.z, f.r, f.t0, f.dur };
		for (double x : v) fires.push_back((float)x);
	}
	d["time"] = sim_.time;
	d["storms"] = storms;         // 6 each: owner, x, z, t0, duration, radius
	d["bolts"] = bolts;           // 6 each: x, y (ground; sky bolts: cloud height), z, t0, life, sky
	d["bolt_seeds"] = bolt_seeds; // boltLines(seed, ...) seeds (uint32 bits)
	d["scorches"] = scorches;     // 6 each: x, y, z, t0, size (0 = default), blast
	d["scorch_seeds"] = scorch_seeds;
	d["zaps"] = zaps;             // 5 each: x, y, z, t0, life
	d["zap_units"] = zap_units;   // 2 each: unit id, seed
	d["meteors"] = meteors;       // 9 each: owner, x, z, t0, delay, radius, sx, sy, sz
	d["fires"] = fires;           // 6 each: x, y, z, r, t0, dur
	return d;
}

// ---- fog / victory ------------------------------------------------------------

PackedByteArray AovSim::get_fog() const {
	PackedByteArray out;
	const auto &s = sim_.fog.state;
	out.resize((int64_t)s.size());
	uint8_t *w = out.ptrw();
	for (size_t i = 0; i < s.size(); i++) w[i] = s[i] == 2 ? 255 : s[i] == 1 ? 128 : 0;
	return out;
}

Dictionary AovSim::get_victory() const {
	const aov::Victory &v = sim_.victory;
	Dictionary d;
	d["enabled"] = v.enabled;
	d["decided"] = v.decided;
	d["winner"] = v.winner;
	d["loser"] = v.loser;
	d["winner_team"] = v.winner_team ? v.winner_team : (v.winner ? sim_.team_of(v.winner) : 0);
	d["time"] = v.at;
	return d;
}
