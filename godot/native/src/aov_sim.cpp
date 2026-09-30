#include "aov_sim.h"

#include <algorithm>

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
	ClassDB::bind_method(D_METHOD("smart", "ids", "x", "z", "target_id"), &AovSim::smart, DEFVAL(0));
	ClassDB::bind_method(D_METHOD("move_to", "id", "x", "z", "range"), &AovSim::move_to, DEFVAL(0.0));
	ClassDB::bind_method(D_METHOD("find_path", "sx", "sz", "gx", "gz"), &AovSim::find_path);
	ClassDB::bind_method(D_METHOD("set_repath_budget", "n"), &AovSim::set_repath_budget);
	ClassDB::bind_method(D_METHOD("set_path_cache", "on"), &AovSim::set_path_cache);
	ClassDB::bind_method(D_METHOD("set_group_paths", "min_units"), &AovSim::set_group_paths);
	// buildings
	ClassDB::bind_method(D_METHOD("building_type_names"), &AovSim::building_type_names);
	ClassDB::bind_method(D_METHOD("get_building_def", "type"), &AovSim::get_building_def);
	ClassDB::bind_method(D_METHOD("spawn_building", "type", "owner", "tx", "tz", "built", "site"), &AovSim::spawn_building, DEFVAL(true), DEFVAL(true));
	ClassDB::bind_method(D_METHOD("can_place", "type", "tx", "tz"), &AovSim::can_place);
	ClassDB::bind_method(D_METHOD("place_building", "type", "owner", "tx", "tz", "builders"), &AovSim::place_building, DEFVAL(PackedInt32Array()));
	ClassDB::bind_method(D_METHOD("destroy_building", "id"), &AovSim::destroy_building);
	ClassDB::bind_method(D_METHOD("get_building", "id"), &AovSim::get_building);
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
	return d;
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
	static const char *cls[] = { "villager", "infantry", "archer", "cavalry", "myth", "hero" };
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
	d["min_age"] = u.min_age;
	Dictionary atk;
	atk["damage"] = u.attack.damage;
	atk["range"] = u.attack.range;
	atk["cooldown"] = u.attack.cooldown;
	atk["splash"] = u.attack.splash;
	atk["projectile"] = u.attack.projectile ? "arrow" : "";
	d["attack"] = atk;
	d["armor"] = u.armor;
	return d;
}

int64_t AovSim::spawn_unit(const String &type, int64_t owner, double x, double z, double rot) {
	int t = aov::unit_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_unit: unknown unit type " + type);
		return -1;
	}
	int r = sim_.units.spawn(t, (int)owner, x, z, rot);
	return sim_.entities.units.id[r];
}

PackedInt32Array AovSim::spawn_block(const String &type, int64_t owner, int64_t count, double x, double z, int64_t cols, double spacing, double rot, double jitter) {
	PackedInt32Array out;
	int t = aov::unit_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_block: unknown unit type " + type);
		return out;
	}
	for (int32_t id : sim_.spawn_block(t, (int)owner, (int)count, x, z, (int)cols, spacing, rot, jitter)) out.push_back(id);
	return out;
}

int64_t AovSim::spawn_resource(const String &type, int64_t tx, int64_t tz, int64_t variant) {
	int t = aov::resource_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_resource: unknown resource type " + type);
		return -1;
	}
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
	d["resume"] = U.am_resume[r]; // Godot-only fight-then-walk-on (Combat::engage): 0 none, 1 move
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

Dictionary AovSim::get_building_def(const String &type) const {
	Dictionary d;
	const int t = aov::building_type_of(type.utf8().get_data());
	if (t < 0) return d;
	const aov::BuildingDef &b = aov::building_def(t);
	d["type"] = t;
	d["key"] = b.key;
	d["name"] = b.name;
	d["w"] = b.w;
	d["h"] = b.h;
	d["hp"] = b.hp;
	d["cost"] = cost_dict(b.cost);
	d["build_time"] = b.build_time;
	d["pop"] = b.pop;
	d["sight"] = b.sight;
	PackedStringArray drop, trains;
	for (int k = 0; k < 3; k++)
		if (b.drops(k)) drop.push_back(aov::res_name(k));
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
	return d;
}

int64_t AovSim::spawn_building(const String &type, int64_t owner, int64_t tx, int64_t tz, bool built, bool site) {
	const int t = aov::building_type_of(type.utf8().get_data());
	if (t < 0) {
		ERR_PRINT("AovSim.spawn_building: unknown building type " + type);
		return 0;
	}
	const int b = sim_.buildings.spawn(t, (int)owner, (int)tx, (int)tz, built, site);
	return sim_.entities.buildings.id[b];
}

bool AovSim::can_place(const String &type, int64_t tx, int64_t tz) const {
	return sim_.buildings.can_place(aov::building_type_of(type.utf8().get_data()), (int)tx, (int)tz);
}

int64_t AovSim::place_building(const String &type, int64_t owner, int64_t tx, int64_t tz, const PackedInt32Array &builders) {
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
	if (b < 0) return;
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
	for (int32_t id : sim_.economy.wildlife.spawn_herd(t, x, z, (int)n)) out.push_back(id);
	return out;
}

int64_t AovSim::spawn_boat(int64_t owner, double x, double z, double rot) {
	return sim_.economy.fishing.boats[sim_.economy.fishing.spawn_boat((int)owner, x, z, rot)].id;
}

int64_t AovSim::spawn_shoal(double x, double z, double amount) {
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
	d["time"] = v.at;
	return d;
}
