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
	ClassDB::bind_method(D_METHOD("set_census", "on"), &AovSim::set_census);
	ClassDB::bind_method(D_METHOD("take_census"), &AovSim::take_census);
	ClassDB::bind_method(D_METHOD("units_hash"), &AovSim::units_hash);
	ClassDB::bind_method(D_METHOD("get_units_f64"), &AovSim::get_units_f64);
	ClassDB::bind_method(D_METHOD("get_walkable"), &AovSim::get_walkable);
	ClassDB::bind_method(D_METHOD("build_terrain_mesh", "cx0", "cz0", "cx1", "cz1"), &AovSim::build_terrain_mesh);
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
	d["projectiles"] = 0;
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
	int r = sim_.entities.unit_slot((int32_t)id);
	if (r < 0) return;
	auto &U = sim_.entities.units;
	if (U.dead[r]) return;
	U.dead[r] = 1;
	U.hp[r] = 0;
	sim_.movement.stop(r);
	aov::Event e;
	e.type = aov::EV_ENTITY_DIED;
	e.kind = aov::K_UNIT;
	e.id = (int32_t)id;
	e.other = (int32_t)killer;
	e.owner = U.owner[r];
	e.x = U.x[r];
	e.z = U.z[r];
	sim_.events.emit(e);
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

Dictionary AovSim::get_units() const {
	const aov::UnitStore &U = sim_.entities.units;
	const int n = U.size();
	int live = 0;
	for (int r = 0; r < n; r++) live += !U.removed[r];
	PackedInt32Array ids, target;
	PackedFloat32Array pos, prev, rot, prot, hp, mhp, at, atk, die, hit, flash, gy;
	PackedByteArray type, owner, anim, order, flags, carry;
	ids.resize(live); target.resize(live);
	pos.resize(live * 2); prev.resize(live * 2);
	rot.resize(live); prot.resize(live); hp.resize(live); mhp.resize(live); at.resize(live); atk.resize(live); die.resize(live);
	hit.resize(live); flash.resize(live); gy.resize(live);
	type.resize(live); owner.resize(live); anim.resize(live); order.resize(live); flags.resize(live); carry.resize(live);
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
