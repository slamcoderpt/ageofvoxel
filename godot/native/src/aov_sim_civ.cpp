// AovSim: the civilizations' API (sim/civ, Godot-only). Kept apart from
// aov_sim.cpp; see godot/PORTING.md "Civilizations, the Egyptians".
#include "aov_sim.h"

#include <godot_cpp/core/class_db.hpp>

using namespace godot;

void AovSim::_bind_civ_methods() {
	ClassDB::bind_method(D_METHOD("civ_names"), &AovSim::civ_names);
	ClassDB::bind_method(D_METHOD("get_civ", "civ"), &AovSim::get_civ);
	ClassDB::bind_method(D_METHOD("set_player_civ", "owner", "civ"), &AovSim::set_player_civ);
	ClassDB::bind_method(D_METHOD("get_build_menu", "owner"), &AovSim::get_build_menu);
	ClassDB::bind_method(D_METHOD("can_build", "owner", "type"), &AovSim::can_build);
	ClassDB::bind_method(D_METHOD("get_trains", "building"), &AovSim::get_trains);
	ClassDB::bind_method(D_METHOD("order_empower", "ids", "building"), &AovSim::order_empower);
	ClassDB::bind_method(D_METHOD("get_civ_state", "owner"), &AovSim::get_civ_state);
	ClassDB::bind_method(D_METHOD("get_civ_fx"), &AovSim::get_civ_fx);
}

static Dictionary civ_cost_dict(const aov::Cost &c) {
	Dictionary d;
	for (int k = 0; k < aov::RES_COUNT; k++)
		if (c.has[k]) d[aov::res_name(k)] = c.v[k];
	return d;
}

static PackedFloat32Array four(const double v[4]) {
	PackedFloat32Array a;
	for (int i = 0; i < 4; i++) a.push_back((float)v[i]);
	return a;
}

void AovSim::civ_unit_def(int t, Dictionary &d) const {
	const int c = aov::unit_civ(t);
	d["civ"] = c < 0 ? "" : aov::civ_key(c);
	const aov::EgyptUnit *e = aov::egypt_unit(t);
	d["hack_armor"] = aov::unit_def(t).armor;
	d["pierce_armor"] = e ? e->pierce_armor : aov::unit_def(t).armor;
	if (!e) return;
	d["stand_in"] = e->stand_in;
	d["retold"] = e->retold;
	d["mapping"] = e->mapping;
	if (e->limit) d["limit"] = e->limit;
	if (e->heal > 0) d["heal"] = e->heal;
	if (e->decay > 0) d["decay"] = e->decay;
	if (e->crush_vs_building > 0) d["crush_vs_buildings"] = e->crush_vs_building;
	if (e->vs_buildings > 0) d["vs_buildings"] = e->vs_buildings;
	if (t == aov::U_LABORER) {
		d["build_rate"] = aov::LABORER_BUILD;
		d["gather_mult"] = aov::LABORER_GATHER;
	}
	if (const aov::HeroAge *h = aov::hero_age(t)) {
		Dictionary a;
		a["hp"] = four(h->hp);
		a["damage"] = four(h->damage);
		a["range"] = four(h->range);
		a["sight"] = four(h->sight);
		d["by_age"] = a;
	}
	d["empowers"] = t == aov::U_PHARAOH ? 1.0 : t == aov::U_PRIEST ? aov::RA_PRIEST_EMPOWER : 0.0; // (the Priest: Ra's only)
}

void AovSim::civ_building_def(int t, int civ, Dictionary &d) const {
	const int bc = aov::building_civ(t);
	d["civ"] = bc < 0 ? "" : aov::civ_key(bc); // "" = both civs'
	d["for_civ"] = aov::civ_key(civ);
	if (const char *s = aov::building_stand_in(t)) d["stand_in"] = s;
	const aov::CivArmor ar = aov::civ_building_armor(t);
	if (ar.retold) {
		Dictionary a;
		a["hack"] = ar.hack;
		a["pierce"] = ar.pierce;
		a["crush"] = ar.crush;
		d["armor"] = a;
	}
	if (aov::is_monument(t)) {
		d["monument"] = aov::monument_index(t) + 1;
		d["favor_per_min"] = aov::MONUMENT_FAVOR_MIN[aov::monument_index(t)];
	}
	Dictionary by;
	for (int c = 0; c < aov::CIV_COUNT; c++) {
		if (!aov::civ_has_building(c, t)) continue;
		Dictionary e;
		e["cost"] = civ_cost_dict(aov::civ_building_cost(c, t));
		PackedStringArray tr;
		for (const int *u = aov::civ_trains(c, t); *u >= 0; u++) tr.push_back(aov::unit_def(*u).key);
		e["trains"] = tr;
		// one builder's time: a Laborer works at 0.75 (the Obelisk: a Priest, 1)
		e["build_time"] = aov::building_def(t).build_time / (c == aov::CIV_EGYPT && t != aov::B_OBELISK ? aov::LABORER_BUILD : 1.0);
		by[aov::civ_key(c)] = e;
	}
	d["by_civ"] = by;
}

PackedStringArray AovSim::civ_names() const {
	PackedStringArray out;
	for (int c = 0; c < aov::CIV_COUNT; c++) out.push_back(aov::civ_key(c));
	return out;
}

Dictionary AovSim::get_civ(const String &civ) const {
	Dictionary d;
	const int c = aov::civ_of_key(civ.utf8().get_data());
	if (c < 0) return d;
	d["key"] = aov::civ_key(c);
	d["name"] = aov::civ_name(c);
	PackedStringArray gods, menu, units, blds;
	for (const char *const *g = aov::civ_major_gods(c); *g; g++) gods.push_back(*g);
	for (const int *b = aov::civ_build_menu(c); *b >= 0; b++) menu.push_back(aov::building_def(*b).key);
	for (int u = 0; u < aov::U_TYPE_COUNT; u++)
		if (aov::unit_civ(u) == c) units.push_back(aov::unit_def(u).key);
	for (int b = 0; b < aov::B_TYPE_COUNT; b++)
		if (aov::civ_has_building(c, b)) blds.push_back(aov::building_def(b).key);
	d["gods"] = gods;
	d["build_menu"] = menu;
	d["units"] = units;
	d["buildings"] = blds;
	d["worker"] = c == aov::CIV_EGYPT ? "laborer" : "villager";
	return d;
}

bool AovSim::set_player_civ(int64_t owner, const String &civ) {
	const int c = aov::civ_of_key(civ.utf8().get_data());
	if (c < 0 || owner <= 0 || owner >= aov::MAX_PLAYERS || !sim_.players[owner].exists) return false;
	sim_.players[owner].civ = (uint8_t)c;
	return true;
}

PackedStringArray AovSim::get_build_menu(int64_t owner) const {
	PackedStringArray out;
	for (const int *b = aov::civ_build_menu(sim_.civs.civ((int)owner)); *b >= 0; b++) out.push_back(aov::building_def(*b).key);
	return out;
}

Dictionary AovSim::can_build(int64_t owner, const String &type) const {
	Dictionary d;
	std::string why;
	const bool ok = sim_.civs.can_build((int)owner, aov::building_type_of(type.utf8().get_data()), &why);
	d["ok"] = ok;
	d["reason"] = String(why.c_str());
	return d;
}

Array AovSim::get_trains(int64_t building) const {
	Array out;
	const int b = sim_.entities.building_slot((int32_t)building);
	if (b < 0) return out;
	const aov::BuildingStore &B = sim_.entities.buildings;
	const int c = sim_.civs.civ(B.owner[b]);
	for (const int *u = aov::civ_trains(c, B.type[b]); *u >= 0; u++) {
		Dictionary e;
		std::string why;
		const int k = sim_.civs.train_check(b, *u, &why);
		e["type"] = aov::unit_def(*u).key;
		e["ok"] = k == 0;
		e["reason"] = String(why.c_str());
		out.push_back(e);
	}
	return out;
}

void AovSim::order_empower(const PackedInt32Array &ids, int64_t building) {
	for (int64_t i = 0; i < ids.size(); i++) {
		const int r = sim_.entities.unit_slot(ids[i]);
		if (r >= 0) sim_.commands.order(r, aov::Order::with_target(aov::O_EMPOWER, (int32_t)building));
	}
}

Dictionary AovSim::get_civ_state(int64_t owner) const {
	Dictionary d;
	const int o = (int)owner;
	if (o <= 0 || o >= aov::MAX_PLAYERS || !sim_.players[o].exists) return d;
	const aov::Civs &C = sim_.civs;
	const aov::BuildingStore &B = sim_.entities.buildings;
	const aov::UnitStore &U = sim_.entities.units;
	d["civ"] = aov::civ_key(C.civ(o));
	Array mons, emp;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || B.owner[b] != o) continue;
		if (aov::is_monument(B.type[b])) {
			Dictionary m;
			m["id"] = B.id[b];
			m["type"] = aov::building_def(B.type[b]).key;
			m["built"] = (bool)B.built[b];
			m["empower"] = B.civ_empower[b];
			mons.push_back(m);
		}
		if (B.civ_empower[b] > 0) {
			Dictionary e;
			e["id"] = B.id[b];
			e["type"] = aov::building_def(B.type[b]).key;
			e["strength"] = B.civ_empower[b];
			emp.push_back(e);
		}
	}
	d["monuments"] = mons;
	d["empowered"] = emp;
	d["favor_per_min"] = C.monument_favor_rate(o) * 60;
	d["favor_made"] = C.favor_made[o];
	d["drop_bonus"] = C.drop_bonus[o];
	int32_t ph = 0;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.owner[r] == o && U.type[r] == aov::U_PHARAOH) ph = U.id[r];
	d["pharaoh"] = ph;
	d["respawn_in"] = C.respawn_at[o] >= 0 ? C.respawn_at[o] - sim_.time : -1.0;
	d["laborers"] = C.count_type(o, aov::U_LABORER);
	d["laborer_cap"] = aov::LABORER_CAP;
	d["home_tc"] = C.home_tc[o];
	return d;
}

Dictionary AovSim::get_civ_fx() const {
	Dictionary d;
	const aov::UnitStore &U = sim_.entities.units;
	PackedInt32Array heals, emp_ids;
	PackedFloat32Array emp_k;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.dead[r]) continue;
		if (U.civ_heal[r]) {
			heals.push_back(U.id[r]);
			heals.push_back(U.civ_heal[r]);
		}
		if (U.order_type[r] == aov::O_EMPOWER && !U.moving[r]) {
			const int b = sim_.entities.building_slot(U.order_target[r]);
			if (b >= 0 && sim_.entities.buildings.civ_empower[b] > 0) {
				emp_ids.push_back(U.id[r]);
				emp_ids.push_back(U.order_target[r]);
				emp_k.push_back((float)sim_.entities.buildings.civ_empower[b]);
			}
		}
	}
	d["heals"] = heals;
	d["empowers"] = emp_ids;
	d["empower_strength"] = emp_k;
	return d;
}
