// AovSim: the gods' API (Godot-only): the Egyptian gods' powers, minor gods and myth
// units (sim/godpowers egypt_powers.cpp / egypt_myth.cpp, sim/techs). Kept apart from
// aov_sim.cpp; see godot/PORTING.md "The Egyptian gods".
#include "aov_sim.h"

#include <godot_cpp/core/class_db.hpp>

#include <cctype>

using namespace godot;

void AovSim::_bind_gods_methods() {
	ClassDB::bind_method(D_METHOD("player_powers", "owner"), &AovSim::player_powers);
	ClassDB::bind_method(D_METHOD("get_power_info", "owner", "power"), &AovSim::get_power_info);
	ClassDB::bind_method(D_METHOD("cast_check", "owner", "power", "x", "z"), &AovSim::cast_check);
	ClassDB::bind_method(D_METHOD("cast_power2", "owner", "power", "x", "z", "x2", "z2"), &AovSim::cast_power2);
	ClassDB::bind_method(D_METHOD("last_cast_reason"), &AovSim::last_cast_reason);
	ClassDB::bind_method(D_METHOD("get_gods", "owner"), &AovSim::get_gods);
	ClassDB::bind_method(D_METHOD("minor_gods_of", "major", "age"), &AovSim::minor_gods_of);
	ClassDB::bind_method(D_METHOD("get_egypt_powers"), &AovSim::get_egypt_powers);
	ClassDB::bind_method(D_METHOD("get_power_stats", "owner"), &AovSim::get_power_stats);
	ClassDB::bind_method(D_METHOD("is_uncontrolled", "unit"), &AovSim::is_uncontrolled);
	ClassDB::bind_method(D_METHOD("ability_ready", "unit"), &AovSim::ability_ready);
	ClassDB::bind_method(D_METHOD("set_player_god", "owner", "god"), &AovSim::set_player_god);
	ClassDB::bind_method(D_METHOD("roc_load", "roc", "units"), &AovSim::roc_load);
	ClassDB::bind_method(D_METHOD("roc_unload", "roc", "x", "z"), &AovSim::roc_unload);
	ClassDB::bind_method(D_METHOD("get_roc", "roc"), &AovSim::get_roc);
}

bool AovSim::set_player_god(int64_t owner, const String &god) {
	const std::string g = god.utf8().get_data();
	const int c = aov::civ_of_god(g);
	if (c < 0 || owner <= 0 || owner >= aov::MAX_PLAYERS || !sim_.players[owner].exists) return false;
	std::string n = g;
	if (!n.empty()) n[0] = (char)std::toupper((unsigned char)n[0]);
	sim_.players[owner].god = n;
	sim_.players[owner].civ = (uint8_t)c;
	return true;
}

static const char *TARGETS[] = { "point", "global", "two_points", "own_tc", "own_pharaoh" };

PackedStringArray AovSim::player_powers(int64_t owner) const {
	PackedStringArray out;
	for (int id : sim_.godpowers.player_powers((int)owner)) out.push_back(aov::power_def(id).key);
	return out;
}

Dictionary AovSim::get_power_info(int64_t owner, const String &power) const {
	const int id = aov::power_of(power.utf8().get_data());
	Dictionary d;
	if (id < 0) return d;
	const aov::PowerDef &p = aov::power_def(id);
	const aov::GodPowers &G = sim_.godpowers;
	const int o = (int)owner;
	d["key"] = p.key;
	d["name"] = p.name;
	d["god"] = p.god;
	d["favor"] = p.cost.v[aov::RES_FAVOR];
	d["cost"] = G.power_cost(o, id);
	d["ramp"] = p.ramp;
	d["age"] = p.age;
	d["target"] = TARGETS[p.target];
	d["cooldown"] = G.power_cooldown_of(o, id);
	d["radius"] = p.radius;
	d["duration"] = p.duration;
	d["damage"] = p.damage;
	d["hotkey"] = p.hotkey;
	d["desc"] = p.desc;
	d["retold"] = p.retold;
	d["mapping"] = p.mapping;
	d["egypt"] = aov::is_egypt_power(id);
	d["has"] = G.has_power(o, id);
	const aov::CastCheck c = G.can_cast(o, id);
	d["can"] = c.ok;
	d["reason"] = String(c.reason.c_str());
	d["cooldown_left"] = G.cooldown_left(o, id);
	d["casts"] = o > 0 && o < aov::MAX_PLAYERS ? G.casts[o][id] : 0;
	return d;
}

Dictionary AovSim::cast_check(int64_t owner, const String &power, double x, double z) const {
	const aov::CastCheck c = sim_.godpowers.cast_check((int)owner, aov::power_of(power.utf8().get_data()), x, z);
	Dictionary d;
	d["ok"] = c.ok;
	d["reason"] = String(c.reason.c_str());
	return d;
}

bool AovSim::cast_power2(int64_t owner, const String &power, double x, double z, double x2, double z2) {
	return sim_.godpowers.cast2((int)owner, aov::power_of(power.utf8().get_data()), x, z, x2, z2);
}

PackedStringArray AovSim::minor_gods_of(const String &major, int64_t age) const {
	PackedStringArray out;
	for (const char *const *m = aov::minor_gods_of(major.utf8().get_data(), (int)age); *m; m++) out.push_back(*m);
	return out;
}

Dictionary AovSim::get_gods(int64_t owner) const {
	Dictionary d;
	const int o = (int)owner;
	if (o <= 0 || o >= aov::MAX_PLAYERS || !sim_.players[o].exists) return d;
	const aov::Player &p = sim_.players[o];
	d["major"] = String(p.god.c_str());
	d["civ"] = aov::civ_key(p.civ);
	Dictionary minor, offered;
	for (int a = 1; a <= 3; a++) {
		minor[a] = String(sim_.techs.minor[o][a].c_str());
		offered[a] = minor_gods_of(String(p.god.c_str()), a);
	}
	d["minor"] = minor;
	d["offered"] = offered;
	d["powers"] = player_powers(owner);
	return d;
}

static PackedFloat32Array f32(std::initializer_list<double> v) {
	PackedFloat32Array a;
	for (double x : v) a.push_back((float)x);
	return a;
}

Dictionary AovSim::get_egypt_powers() const {
	const aov::GodPowers &G = sim_.godpowers;
	const aov::Sim &S = sim_;
	Dictionary d;
	d["time"] = S.time;
	Array timed; // [{kind, owner, t0, until}]
	for (int o = 1; o < aov::MAX_PLAYERS; o++) {
		if (G.rain[o].until > S.time - 3) { Dictionary e; e["kind"] = "rain"; e["owner"] = o; e["t0"] = G.rain[o].t0; e["until"] = G.rain[o].until; timed.push_back(e); }
		if (G.prosperity[o].until > S.time - 3) { Dictionary e; e["kind"] = "prosperity"; e["owner"] = o; e["t0"] = G.prosperity[o].t0; e["until"] = G.prosperity[o].until; timed.push_back(e); }
	}
	if (G.eclipse.until > S.time - 3) { Dictionary e; e["kind"] = "eclipse"; e["owner"] = G.eclipse.owner; e["t0"] = G.eclipse.t0; e["until"] = G.eclipse.until; e["x"] = G.eclipse.x; e["z"] = G.eclipse.z; timed.push_back(e); }
	d["timed"] = timed;
	PackedFloat32Array vis, snd, sw, cit, son, tor, ar, rs, afx, dt;
	PackedInt32Array rs_units, afx_units, dt_units;
	for (const aov::VisionCast &v : G.visions) for (float x : f32({ (double)v.owner, v.x, v.z, v.t0, v.dur, v.r })) vis.push_back(x);
	for (const aov::SandsCast &c : G.sands) for (float x : f32({ (double)c.owner, c.sx, c.sz, c.dx, c.dz, c.t0, c.delay, c.radius })) snd.push_back(x);
	for (const aov::Swarm &w : G.swarms) {
		const double age = S.time - w.t0;
		for (float x : f32({ (double)w.owner, w.x0 + w.dx * aov::SWARM_SPEED * age, w.z0 + w.dz * aov::SWARM_SPEED * age, w.dx, w.dz, w.t0, w.dur, w.radius, (double)(w.seed & 0xffffff) }))
			sw.push_back(x);
	}
	for (const aov::CitadelCast &c : G.citadel_fx) for (float x : f32({ (double)c.building, c.x, c.z, c.t0 })) cit.push_back(x);
	for (const aov::SonCast &c : G.sons) for (float x : f32({ (double)c.unit, c.x, c.z, c.t0 })) son.push_back(x);
	for (const aov::Tornado &t : G.tornadoes) for (float x : f32({ (double)t.owner, t.cx, t.cz, t.t0, t.dur, t.x, t.z, t.a0 })) tor.push_back(x);
	for (const aov::Arc &a : G.arcs) for (float x : f32({ a.x0, a.y0, a.z0, a.x1, a.y1, a.z1, a.t0, (double)(a.seed & 0xffffff) })) ar.push_back(x);
	for (const aov::RiseFx &f : G.rises) {
		for (float x : f32({ (double)f.kind, f.x, f.z, f.t0, (double)f.owner })) rs.push_back(x);
		rs_units.push_back(f.unit);
	}
	for (const aov::AbilityFx &f : G.ability_fx) {
		for (float x : f32({ (double)f.kind, f.x0, f.z0, f.x1, f.z1, f.t0, f.dur })) afx.push_back(x);
		afx_units.push_back(f.unit);
		afx_units.push_back(f.target);
	}
	for (const aov::Dot &o : G.dots) {
		for (float x : f32({ (double)o.kind, o.until })) dt.push_back(x);
		dt_units.push_back(o.target);
	}
	PackedInt32Array cits;
	for (int32_t id : G.citadels) cits.push_back(id);
	Array thoth;
	for (const aov::ThothCast &t : G.thoth) {
		Dictionary e;
		e["owner"] = t.owner;
		e["x"] = t.cx;
		e["z"] = t.cz;
		e["t0"] = t.t0;
		e["radius"] = t.radius;
		e["launched"] = t.launched;
		thoth.push_back(e);
	}
	Array spawns; // Plague of Serpents / Ancestors casts in progress
	for (int k = 0; k < 2; k++)
		for (const aov::SpawnCast &c : k ? G.ancestors : G.serpents) {
			Dictionary e;
			e["kind"] = k ? "ancestors" : "serpents";
			e["owner"] = c.owner;
			e["x"] = c.x;
			e["z"] = c.z;
			e["t0"] = c.t0;
			e["spawned"] = c.spawned;
			e["total"] = c.total;
			e["radius"] = aov::power_def(c.id).radius;
			e["die_at"] = c.die_at;
			spawns.push_back(e);
		}
	d["visions"] = vis;       // 6 each: owner, x, z, t0, dur, r
	d["sands"] = snd;         // 8 each: owner, sx, sz, dx, dz, t0, delay, radius
	d["swarms"] = sw;         // 9 each: owner, x, z (now), dx, dz, t0, dur, radius, seed
	d["citadel_fx"] = cit;    // 4 each: building, x, z, t0
	d["citadels"] = cits;     // Town Centers made Citadel Centers
	d["sons"] = son;          // 4 each: unit, x, z, t0
	d["tornadoes"] = tor;     // 8 each: owner, cx, cz, t0, dur, x, z (now), a0
	d["arcs"] = ar;           // 8 each: x0, y0, z0, x1, y1, z1, t0, seed
	d["rises"] = rs;          // 5 each: kind (0 serpent, 1 minion, 2 egg, 3 hatch, 4 caustic, 5 son), x, z, t0, owner
	d["rise_units"] = rs_units;
	d["ability_fx"] = afx;    // 7 each: kind (0 jump, 1 whirlwind, 2 spin, 3 sting, 4 curse, 5 beam), x0, z0, x1, z1, t0, dur
	d["ability_units"] = afx_units; // 2 each: unit, target
	d["dots"] = dt;           // 2 each: kind (0 poison, 1 venom, 2 sting, 3 curse), until
	d["dot_units"] = dt_units;
	d["thoth"] = thoth;
	d["spawns"] = spawns;
	return d;
}

int64_t AovSim::roc_load(int64_t roc, const PackedInt32Array &units) {
	std::vector<int32_t> ids;
	for (int64_t i = 0; i < units.size(); i++) ids.push_back(units[i]);
	return sim_.godpowers.roc_load((int32_t)roc, ids);
}

bool AovSim::roc_unload(int64_t roc, double x, double z) { return sim_.godpowers.roc_unload((int32_t)roc, x, z); }

// {cargo: [type names], boarding: [ids], mode: 0 flying / 1 loading / 2 unloading, slots}
Dictionary AovSim::get_roc(int64_t roc) const {
	Dictionary d;
	Array cargo, boarding;
	int mode = 0;
	if (const aov::RocState *s = sim_.godpowers.roc_state((int32_t)roc)) {
		for (const aov::Cargo &c : s->cargo) cargo.push_back(String(aov::unit_def(c.type).key));
		for (int32_t id : s->boarding) boarding.push_back(id);
		mode = s->mode;
	}
	d["cargo"] = cargo;
	d["boarding"] = boarding;
	d["mode"] = mode;
	d["slots"] = aov::ROC_SLOTS;
	return d;
}

Dictionary AovSim::get_power_stats(int64_t owner) const {
	const aov::GodPowers &G = sim_.godpowers;
	const aov::Techs &T = sim_.techs;
	Dictionary d;
	const int o = (int)owner;
	if (o <= 0 || o >= aov::MAX_PLAYERS) return d;
	d["power_damage"] = G.power_damage[o];
	d["farm_damage"] = G.farm_damage[o];
	d["building_damage"] = G.building_damage[o];
	d["teleported"] = G.teleported[o];
	d["spawned"] = G.spawned[o];
	d["thrown"] = G.thrown[o];
	d["meteors_landed"] = G.meteors_landed[o];
	d["minions_raised"] = G.minions_raised[o];
	d["eggs_hatched"] = G.eggs_hatched[o];
	d["chained"] = G.chained[o];
	d["flattened"] = G.flattened[o];
	d["rain_until"] = G.rain[o].until;
	d["prosperity_until"] = G.prosperity[o].until;
	d["eclipse_owner"] = G.eclipse.owner;
	d["eclipse_until"] = G.eclipse.until;
	d["trickled"] = T.trickled[o];
	d["refunded"] = T.refunded[o];
	d["stolen"] = T.stolen[o];
	d["valley_copies"] = T.valley_copies[o];
	d["dots"] = (int)G.dots.size();
	d["auras"] = (int)G.auras.size();
	d["eggs"] = (int)G.eggs.size();
	d["uncontrolled"] = (int)G.uncontrolled.size();
	Array cd;
	for (int i = 0; i < aov::GP_COUNT; i++) cd.push_back(G.casts[o][i]);
	d["casts"] = cd;
	return d;
}
