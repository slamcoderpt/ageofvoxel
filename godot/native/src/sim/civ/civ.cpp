// Civilizations and the Egyptians (see civ.h).
#include "civ.h"

#include <algorithm>
#include <cctype>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static std::string lower_str(std::string s) {
	for (char &c : s) c = (char)std::tolower((unsigned char)c);
	return s;
}

const char *civ_key(int civ) { return civ == CIV_EGYPT ? "egyptian" : "greek"; }
const char *civ_name(int civ) { return civ == CIV_EGYPT ? "Egyptians" : "Greeks"; }

int civ_of_key(const std::string &key) {
	const std::string k = lower_str(key);
	if (k == "greek" || k == "greeks") return CIV_GREEK;
	if (k == "egyptian" || k == "egyptians" || k == "egypt") return CIV_EGYPT;
	return -1;
}

const char *const *civ_major_gods(int civ) {
	static const char *const G[] = { "zeus", "hades", "poseidon", nullptr };
	static const char *const E[] = { "ra", "isis", "set", nullptr };
	return civ == CIV_EGYPT ? E : G;
}

int civ_of_god(const std::string &god) {
	const std::string g = lower_str(god);
	for (int c = 0; c < CIV_COUNT; c++)
		for (const char *const *p = civ_major_gods(c); *p; p++)
			if (g == *p) return c;
	return -1;
}

int unit_civ(int type) { return type < 0 || type >= U_TYPE_COUNT ? -1 : is_egypt_unit(type) ? CIV_EGYPT : CIV_GREEK; }

int building_civ(int type) {
	if (type < 0 || type >= B_TYPE_COUNT) return -1;
	if (is_egypt_building(type)) return CIV_EGYPT;
	if (type == B_STOREHOUSE || type == B_BARRACKS) return CIV_GREEK;
	return -1; // Town Center, House, Farm, Temple, walls, gate, tower, Armory, Market
}

// ---- Egyptian units --------------------------------------------------------------------

const EgyptUnit *egypt_unit(int type) {
	// pierce armor, crush vs buildings, x vs buildings, decay, limit, heal, stand-in, Retold, mapping
	static const EgyptUnit T[U_TYPE_COUNT - U_LABORER] = {
		{ 0, 0, 0, 0, LABORER_CAP, 0, "villager",
			"Laborer: 50 f, 1 pop, 17 s, 55 hp, 6 hack, armor 25/35/99, speed 3.8, LOS 14; gathers 10 % slower, builds 25 % slower, never worships; cap 100",
			"hp, damage as Retold; train 17 x 10/15 (the Greek villager here trains in 10 s for Retold's 15); speed x the villager's 2.7/4.0; LOS x0.6; armor 0 like this sim's villager; gather = the villager's x0.9; build work rate 0.75" },
		{ 0.075, 0, 0, 0, 0, 0, "hoplite",
			"Spearman: 50 f + 25 g, 2 pop, 12.5 s, 85 hp, 6 hack, x2 vs cavalry, armor 40/10/99, speed 5.0, LOS 16",
			"armor x0.75 (hack 0.30 / pierce 0.075), speed x0.65, reach 0.75 x0.8, reload x1.15, LOS x0.6" },
		{ 0.075, 0, 0, 0, 0, 0, "hoplite",
			"Axeman: 40 f + 30 g, 2 pop, 11.5 s, 85 hp, 5 hack, x4 vs infantry, armor 40/10/99, speed 4.3, LOS 16",
			"as the Spearman" },
		{ 0.30, 0, 0, 0, 0, 0, "toxotes",
			"Slinger: 55 w + 25 g, 2 pop, 13.5 s, 60 hp, 4 pierce, range 17, x2.25 vs ranged soldiers, armor 15/40/99, speed 4.0, LOS 19",
			"range / LOS x0.6; 'ranged soldiers' = the archer class (toxotes, slinger); armor x0.75" },
		{ 0.15, 0, 0, 0, 0, 0, "hippikon",
			"Chariot Archer: 100 w + 40 g, 3 pop, 8 s, 95 hp, 11 pierce, range 19, ROF 1.5, x1.5 vs infantry, armor 15/20/99, speed 5.0, LOS 21",
			"a ranged cavalry unit: class cavalry (spearmen and camels counter it), arrows; reload 1.5 x1.15" },
		{ 0.30, 0, 0, 0, 0, 0, "hippikon",
			"Camel Rider: 50 f + 70 g, 3 pop, 6.5 s, 135 hp, 8 hack, x2 vs cavalry, x1.25 vs ranged soldiers, armor 15/40/99, speed 6.0, LOS 16",
			"both multipliers kept (cavalry x2, archer class x1.25)" },
		{ 0.375, 0, 4, 0, 0, 0, "cyclops",
			"War Elephant: 180 f + 70 g, 5 pop, 14 s, 450 hp, 22 hack (small splash), ROF 1.4, x4 vs buildings, x1.5 vs ranged soldiers, armor 25/50/99, speed 2.9, size 1.49",
			"splash 0.8 tiles (Retold's 'small'), x4 on the building factor (0.35, or Retold armor)" },
		{ 0.675, 59.1, 0, 0, 0, 0, "hippikon",
			"Siege Tower: 200 w + 100 g, 3 pop, 15 s, 400 hp, 180 crush ram vs buildings (ROF 3.5, range 3) + 3 arrows x 3 pierce vs units (range 12), armor 5/90/85, speed 2.9",
			"one attack (this sim has one per unit): 9 vs units, 59.1 crush per 1.15 s hit vs buildings (= Retold's 180 / 3.5 s), reach 1.8 (Retold's ram 3 x0.6); crush ignores the building's flat 0.35 factor, takes its crush armor" },
		{ 0.675, 200, 0, 0, 0, 0, "cyclops",
			"Catapult: 200 w + 200 g, 5 pop, 26.5 s, 115 hp, 200 crush + 40 pierce, area 8, range 10-28, ROF 4, armor 30/90/85, speed 2.4, LOS 36, x2.5 vs ships",
			"vs units 42 (40 pierce + 200 crush x Retold's 1 % human crush vulnerability), no area (no splash on this sim's projectiles), no minimum range; 200 crush vs buildings" },
		{ 0.1125, 0, 0, 2.5, 12, 0, "hoplite",
			"Mercenary: 90 g, 0 pop, 1 s, 90 hp losing 2.5 hp/s, 7 hack, x1.5 vs cavalry, armor 35/15/99, speed 4.3, limit 12, at the Town Center",
			"decay as Retold; limit counts living + queued" },
		{ 0.2625, 0, 0, 4, 8, 0, "hippikon",
			"Mercenary Cavalry: 120 g, 0 pop, 2 s, 160 hp losing 4 hp/s, 8 hack, x1.5 vs ranged soldiers, armor 20/35/99, speed 5.3, LOS 12, limit 8, Heroic",
			"decay as Retold" },
		{ 0.0075, 0, 0, 0, 0, 7.5, "villager",
			"Priest: 100 g, 2 pop, 10 s, 80 hp (88 / 100 / 116), 0.5 attack (2.2 / 2.5 / 2.9), range 5 (12 / 16 / 20), x5 vs myth, armor 10/1/99, heals 7.5 hp/s at 10, builds Obelisks",
			"hp / damage / range / LOS per age as Retold (range, LOS x0.6); heal range 6; heals half on a busy target; Heka's divine damage: the x5 vs myth only" },
		{ 0.225, 0, 0, 0, 1, 10, "hero",
			"Pharaoh: free, 0 pop, 100 hp (110 / 125 / 145), 3 attack (13.2 / 15 / 17.4), range 3 (12 / 18 / 20), x2.5 vs myth, armor 15/30/99, heals 10 hp/s, empowers, respawns at the TC after 90 s",
			"per age as the Priest; empower in sim/civ (O_EMPOWER)" },
	};
	return is_egypt_unit(type) ? &T[type - U_LABORER] : nullptr;
}

const HeroAge *hero_age(int type) {
	static const HeroAge PRIEST = { { 80, 88, 100, 116 }, { 0.5, 2.2, 2.5, 2.9 }, { 3.0, 7.2, 9.6, 12 }, { 8.4, 8.4, 10.8, 13.2 } };
	static const HeroAge PHARAOH = { { 100, 110, 125, 145 }, { 3, 13.2, 15, 17.4 }, { 1.8, 7.2, 10.8, 12 }, { 10.8, 10.8, 14.4, 15.6 } };
	return type == U_PRIEST ? &PRIEST : type == U_PHARAOH ? &PHARAOH : nullptr;
}

// ---- buildings per civ -------------------------------------------------------------------

Cost civ_building_cost(int civ, int type) {
	if (civ != CIV_EGYPT) return rules_building_cost(type);
	switch (type) {
		case B_TOWN_CENTER: return Cost(0, 0, 550, 0);
		case B_HOUSE: case B_ARMORY: case B_MARKET: return Cost();
		case B_FARM: return Cost(0, 0, 70, 0);
		case B_TEMPLE: return Cost(0, 0, 150, 0);
		case B_TOWER: return Cost(0, 0, 200, 0);
		default: break;
	}
	Cost c = building_def(type).cost; // walls, gates (and the Egyptian types: their def): wood -> gold
	if (c.has[RES_WOOD]) {
		c.v[RES_GOLD] += c.v[RES_WOOD];
		c.has[RES_GOLD] = c.v[RES_GOLD] != 0;
		c.v[RES_WOOD] = 0;
		c.has[RES_WOOD] = false;
	}
	return c;
}

double civ_building_hp(int, int type) { return rules_building_hp(type); }

CivArmor civ_building_armor(int type) {
	switch (type) {
		case B_GRANARY: case B_LUMBER_CAMP: case B_MINING_CAMP: case B_EG_BARRACKS: case B_SIEGE_WORKS: return { 0.40, 0.90, 0.05, true };
		case B_MIGDOL: return { 0.50, 0.90, 0.05, true };
		case B_OBELISK: return { 0.05, 0.90, 0.05, true };
		default: break;
	}
	if (is_monument(type)) return { 0.05, 0.90, 0.05, true };
	if (retold_armored(type)) return { RETOLD_BLD_HACK, RETOLD_BLD_PIERCE, RETOLD_BLD_CRUSH, true };
	return { 0, 0, 0, false };
}

const char *building_stand_in(int type) {
	switch (type) {
		case B_GRANARY: case B_LUMBER_CAMP: case B_MINING_CAMP: return "storehouse";
		case B_MONUMENT_VILLAGERS: case B_MONUMENT_SOLDIERS: case B_MONUMENT_PRIESTS: case B_OBELISK: return "wall_pillar";
		case B_MONUMENT_PHARAOHS: case B_MONUMENT_GODS: return "tower";
		case B_EG_BARRACKS: case B_SIEGE_WORKS: return "barracks";
		case B_MIGDOL: return "town_center";
		default: return nullptr;
	}
}

const int *civ_build_menu(int civ) {
	static const int G[] = { B_HOUSE, B_FARM, B_STOREHOUSE, B_TEMPLE, B_BARRACKS, B_ARMORY, B_MARKET, B_TOWER, B_WALL, B_TOWN_CENTER, -1 };
	static const int E[] = { B_HOUSE, B_GRANARY, B_LUMBER_CAMP, B_MINING_CAMP, B_FARM, B_MONUMENT_VILLAGERS, B_MONUMENT_SOLDIERS,
		B_MONUMENT_PRIESTS, B_MONUMENT_PHARAOHS, B_MONUMENT_GODS, B_TEMPLE, B_EG_BARRACKS, B_ARMORY, B_MARKET, B_MIGDOL, B_SIEGE_WORKS,
		B_TOWER, B_WALL, B_TOWN_CENTER, B_OBELISK, -1 };
	return civ == CIV_EGYPT ? E : G;
}

const int *civ_trains(int civ, int btype) {
	static const int NONE[] = { -1 };
	static const int E_TC[] = { U_LABORER, U_MERCENARY, U_MERCENARY_CAVALRY, U_PRIEST, -1 };
	static const int E_TEMPLE[] = { U_PRIEST, -1 };
	static const int E_BARRACKS[] = { U_SPEARMAN, U_AXEMAN, U_SLINGER, -1 };
	static const int E_MIGDOL[] = { U_CHARIOT_ARCHER, U_CAMEL_RIDER, U_WAR_ELEPHANT, -1 };
	static const int E_SIEGE[] = { U_SIEGE_TOWER, U_CATAPULT, -1 };
	static int greek[B_TYPE_COUNT][U_TYPE_COUNT + 1];
	static bool greek_ready = false;
	if (civ == CIV_EGYPT) {
		switch (btype) {
			case B_TOWN_CENTER: return E_TC;
			case B_TEMPLE: return E_TEMPLE;
			case B_EG_BARRACKS: return E_BARRACKS;
			case B_MIGDOL: return E_MIGDOL;
			case B_SIEGE_WORKS: return E_SIEGE;
			default: return NONE;
		}
	}
	if (btype < 0 || btype >= B_TYPE_COUNT) return NONE;
	if (!greek_ready) { // the Greek lists with the rules on (sim/techs rules_trains)
		for (int b = 0; b < B_TYPE_COUNT; b++) {
			int n = 0;
			for (int u = 0; u < U_GREEK_COUNT; u++)
				if (rules_trains(b, u)) greek[b][n++] = u;
			greek[b][n] = -1;
		}
		greek_ready = true;
	}
	return greek[btype];
}

bool unit_can_build(int utype, int btype) {
	if (utype == U_PRIEST) return btype == B_OBELISK;
	if (utype == U_LABORER) return btype != B_OBELISK && civ_has_building(CIV_EGYPT, btype);
	if (utype == U_VILLAGER) return civ_has_building(CIV_GREEK, btype);
	return unit_def(utype).builder;
}

// ---- the system ---------------------------------------------------------------------------

void Civs::init(Sim *s) {
	sim = s;
	for (int i = 0; i < MAX_PLAYERS; i++) {
		respawn_at[i] = -1;
		home_tc[i] = 0;
		favor_made[i] = 0;
		had_pharaoh[i] = false;
		drop_bonus[i] = 0;
	}
	s->commands.register_handler(O_EMPOWER, [this](int r, const Order &o) {
		if (!rules() || !can_empower(r)) return false;
		Entities &E = sim->entities;
		const int b = E.building_slot(o.target);
		const BuildingStore &B = E.buildings;
		if (b < 0 || B.dead[b] || !sim->is_ally(B.owner[b], E.units.owner[r]) || building_def(B.type[b]).farm) return false;
		GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
		sim->movement.move_to(r, B.x[b], B.z[b], &g);
		return true;
	});
	s->events.on(EV_ENTITY_ADDED, [this](const Event &e) {
		if (!rules() || e.kind != K_UNIT || !hero_age(e.a)) return;
		const int r = sim->entities.unit_slot(e.id);
		const int o = e.owner;
		if (r < 0 || o <= 0 || o >= MAX_PLAYERS) return;
		if (e.a == U_PHARAOH) had_pharaoh[o] = true;
		if (sim->players[o].age > 0) hero_age_stats(r, 0, sim->players[o].age);
	});
	// major gods' unit bonuses at spawn: Ra's Migdol units +15 % hp, Set's Barracks units +5 % speed
	s->events.on(EV_ENTITY_ADDED, [this](const Event &e) {
		if (!rules() || e.kind != K_UNIT || !is_egypt_unit(e.a)) return;
		const int r = sim->entities.unit_slot(e.id);
		if (r < 0) return;
		UnitStore &U = sim->entities.units;
		const int t = e.a, o = e.owner;
		if ((t == U_CHARIOT_ARCHER || t == U_CAMEL_RIDER || t == U_WAR_ELEPHANT) && god_is(o, "ra")) {
			U.max_hp[r] *= RA_CAMEL_HP;
			U.hp[r] *= RA_CAMEL_HP;
		}
		if ((t == U_SPEARMAN || t == U_AXEMAN || t == U_SLINGER) && god_is(o, "set")) U.speed[r] *= SET_INFANTRY_SPEED;
	});
	s->events.on(EV_AGE_ADVANCED, [this](const Event &e) {
		if (rules()) on_age(e.owner);
	});
}

bool Civs::rules() const { return sim->godot_rules; }

bool Civs::god_is(int owner, const char *god) const {
	return owner > 0 && owner < MAX_PLAYERS && sim->players[owner].exists && lower_str(sim->players[owner].god) == god;
}

Cost Civs::cost(int owner, int btype) const {
	const int c = civ(owner);
	Cost k = civ_building_cost(c, btype);
	if (c != CIV_EGYPT) return k;
	if (god_is(owner, "set") && (btype == B_EG_BARRACKS || btype == B_SIEGE_WORKS || btype == B_MIGDOL)) k.v[RES_GOLD] *= SET_MILITARY_GOLD;
	if (god_is(owner, "isis") && btype == B_OBELISK) k.v[RES_GOLD] = 5;
	return k;
}

int Civs::pop_bonus(int owner, int btype) const {
	return btype == B_TOWN_CENTER && civ(owner) == CIV_EGYPT && god_is(owner, "isis") ? ISIS_TC_POP : 0;
}

double Civs::gather_bonus(int u, int node_type) const {
	const UnitStore &U = sim->entities.units;
	return U.type[u] == U_LABORER && node_type == R_BERRY && god_is(U.owner[u], "ra") ? RA_BERRIES : 1;
}

double Civs::tech_cost_mult(int owner) const { return civ(owner) == CIV_EGYPT && god_is(owner, "isis") ? ISIS_TECH_COST : 1; }

int Civs::civ(int owner) const {
	return owner > 0 && owner < MAX_PLAYERS && sim->players[owner].exists ? sim->players[owner].civ : CIV_GREEK;
}

void Civs::hero_age_stats(int r, int from, int to) {
	const HeroAge *h = hero_age(sim->entities.units.type[r]);
	if (!h || from == to) return;
	from = std::max(0, std::min(3, from));
	to = std::max(0, std::min(3, to));
	UnitStore &U = sim->entities.units;
	const double k = h->hp[to] / h->hp[from];
	U.max_hp[r] *= k;
	if (!U.dead[r]) U.hp[r] *= k;
	U.sight[r] += h->sight[to] - h->sight[from];
}

void Civs::on_age(int owner) {
	if (owner <= 0 || owner >= MAX_PLAYERS) return;
	UnitStore &U = sim->entities.units;
	const int age = sim->players[owner].age;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && U.owner[r] == owner && hero_age(U.type[r])) hero_age_stats(r, age - 1, age);
}

int Civs::count_type(int owner, int type, bool queued) const {
	const UnitStore &U = sim->entities.units;
	int n = 0;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.owner[r] == owner && U.type[r] == type) n++;
	if (queued) {
		const BuildingStore &B = sim->entities.buildings;
		for (int b = 0; b < B.size(); b++)
			if (!B.removed[b] && B.owner[b] == owner)
				for (const TrainItem &q : B.queue[b])
					if (q.type == type) n++;
	}
	return n;
}

bool Civs::has_built(int owner, int btype) const {
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner && B.type[b] == btype && B.built[b]) return true;
	return false;
}

bool Civs::can_build(int owner, int btype, std::string *why) const {
	auto no = [&](const std::string &s) { if (why) *why = s; return false; };
	if (why) why->clear();
	if (btype < 0 || btype >= B_TYPE_COUNT) return no("Unknown building");
	const int c = civ(owner);
	if (!civ_has_building(c, btype)) return no(std::string("The ") + civ_name(c) + " cannot build a " + building_def(btype).name);
	if (!rules()) return true;
	const int age = owner > 0 && owner < MAX_PLAYERS ? sim->players[owner].age : 0;
	if (age < building_def(btype).min_age) return no(std::string("Requires ") + AGES[building_def(btype).min_age] + " Age");
	const int mi = monument_index(btype);
	if (mi >= 0) {
		// one of each, in order: every earlier Monument must stand (a foundation will do, Retold)
		const BuildingStore &B = sim->entities.buildings;
		bool have[MONUMENT_COUNT] = {};
		for (int b = 0; b < B.size(); b++)
			if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner && is_monument(B.type[b])) have[monument_index(B.type[b])] = true;
		if (have[mi]) return no(std::string("Only one ") + building_def(btype).name);
		for (int k = 0; k < mi; k++)
			if (!have[k]) return no(std::string("Requires the ") + building_def(B_MONUMENT_VILLAGERS + k).name);
	}
	return true;
}

int Civs::train_check(int b, int utype, std::string *why) const {
	auto no = [&](int k, const std::string &s) { if (why) *why = s; return k; };
	if (why) why->clear();
	const BuildingStore &B = sim->entities.buildings;
	if (b < 0 || b >= B.size() || utype < 0 || utype >= U_TYPE_COUNT) return no(1, "Cannot train here");
	const int owner = B.owner[b], c = civ(owner);
	bool listed = false;
	for (const int *t = civ_trains(c, B.type[b]); *t >= 0; t++)
		if (*t == utype) listed = true;
	if (!listed) return no(1, civ_has_unit(c, utype) ? "Cannot train here" : std::string("The ") + civ_name(c) + " cannot train a " + unit_def(utype).name);
	if (c != CIV_EGYPT) return 0;
	if (utype == U_PRIEST && B.type[b] == B_TOWN_CENTER && !has_built(owner, B_TEMPLE)) return no(2, "Requires a Temple");
	const EgyptUnit *eu = egypt_unit(utype);
	if (eu && eu->limit > 0 && count_type(owner, utype) >= eu->limit) return no(2, std::string("Limit of ") + std::to_string(eu->limit) + " " + unit_def(utype).name + (eu->limit > 1 ? "s" : ""));
	return 0;
}

CivStart Civs::egypt_start(int owner, const Start &st, int villagers) {
	CivStart out;
	const int b = sim->buildings.spawn(B_TOWN_CENTER, owner, st.tx - 3, st.tz - 3, true);
	const BuildingStore &B = sim->entities.buildings;
	out.tc = B.id[b];
	home_tc[owner] = out.tc;
	const double fx = B.x[b], fz = B.tz[b] + B.h[b] + 1.5;
	out.workers = sim->spawn_block(U_LABORER, owner, std::max(1, villagers - 2), fx, fz, 0, 1.1);
	const std::vector<int32_t> ph = sim->spawn_block(U_PHARAOH, owner, 1, fx - 2.6, fz + 0.4, 1, 1.1);
	const std::vector<int32_t> pr = sim->spawn_block(U_PRIEST, owner, 1, fx + 2.6, fz + 0.4, 1, 1.1);
	out.pharaoh = ph.empty() ? 0 : ph[0];
	out.priest = pr.empty() ? 0 : pr[0];
	return out;
}

int32_t Civs::spawn_pharaoh(int owner) {
	const BuildingStore &B = sim->entities.buildings;
	int b = sim->entities.building_slot(home_tc[owner]);
	if (b >= 0 && (B.dead[b] || B.owner[b] != owner || !B.built[b])) b = -1;
	for (int o = 0; o < B.size() && b < 0; o++)
		if (!B.removed[o] && !B.dead[o] && B.owner[o] == owner && B.type[o] == B_TOWN_CENTER && B.built[o]) b = o;
	if (b < 0) return 0;
	const int r = sim->economy.spawn_from_building(b, U_PHARAOH);
	return r >= 0 ? sim->entities.units.id[r] : 0;
}

// ---- hooks ----------------------------------------------------------------------------------

double Civs::work_rate(int u, int b) const {
	const int t = sim->entities.units.type[u];
	if (t == U_LABORER) return LABORER_BUILD;
	if (t == U_PRIEST && sim->entities.buildings.type[b] == B_OBELISK) {
		const int o = sim->entities.units.owner[u];
		return o > 0 && o < MAX_PLAYERS && lower_str(sim->players[o].god) == "isis" ? ISIS_OBELISK_BUILD : 1;
	}
	return 1;
}

double Civs::empower(int b) const {
	const BuildingStore &B = sim->entities.buildings;
	return b >= 0 && b < B.size() ? B.civ_empower[b] : 0;
}

double Civs::train_mult(int b, int utype) const {
	if (utype == U_LABORER) return 1; // (Retold: not Laborers, Caravans, Fishing Ships)
	return 1 + EMPOWER_SPEED * empower(b);
}

bool Civs::can_empower(int u) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[u], o = U.owner[u];
	if (t == U_PHARAOH) return true;
	return t == U_PRIEST && o > 0 && o < MAX_PLAYERS && lower_str(sim->players[o].god) == "ra";
}

double Civs::empower_strength(int u) const { return sim->entities.units.type[u] == U_PHARAOH ? 1.0 : RA_PRIEST_EMPOWER; }

double Civs::base_hack(int r) const { return unit_def(sim->entities.units.type[r]).armor; }

double Civs::base_pierce(int r) const {
	const int t = sim->entities.units.type[r];
	const EgyptUnit *e = egypt_unit(t);
	return e ? e->pierce_armor : unit_def(t).armor;
}

double Civs::base_damage(int r) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[r];
	const HeroAge *h = hero_age(t);
	if (!h) return unit_def(t).attack.damage;
	return h->damage[std::max(0, std::min(3, sim->players[U.owner[r]].age))];
}

double Civs::range_add(int r) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[r];
	const HeroAge *h = hero_age(t);
	if (!h) return 0;
	return h->range[std::max(0, std::min(3, sim->players[U.owner[r]].age))] - unit_def(t).attack.range;
}

double Civs::monument_favor_rate(int owner) const {
	const BuildingStore &B = sim->entities.buildings;
	double rate = 0;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !B.built[b] || B.owner[b] != owner || !is_monument(B.type[b])) continue;
		rate += MONUMENT_FAVOR_MIN[monument_index(B.type[b])] / 60 * (1 + EMPOWER_FAVOR * B.civ_empower[b]);
	}
	return rate;
}

// ---- tick ------------------------------------------------------------------------------------

void Civs::update(double dt) {
	if (!rules()) return;
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	Movement &mv = sim->movement;
	const double now = sim->time;
	bool any_egypt = false;
	for (int o = 1; o < MAX_PLAYERS; o++) any_egypt |= sim->players[o].exists && sim->players[o].civ == CIV_EGYPT;
	if (!any_egypt) return; // (a Greek game: nothing to do; Egyptian units of a test still need an Egyptian owner)

	// 1. empowerment: a Pharaoh (or Ra's Priest) standing at the building he was sent to
	for (int b = 0; b < B.size(); b++) B.civ_empower[b] = 0;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.dead[r] || U.order_type[r] != O_EMPOWER) continue;
		const int32_t bid = U.order_target[r];
		const int b = E.building_slot(bid);
		if (b < 0 || B.dead[b]) {
			sim->commands.idle(r);
			continue;
		}
		if (U.moving[r]) continue;
		if (mv.distance_to(r, bid) > EMPOWER_REACH) {
			if (++U.order_c[r] > 6) { // (unreachable)
				sim->commands.idle(r);
				continue;
			}
			GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
			mv.move_to(r, B.x[b], B.z[b], &g);
			continue;
		}
		U.rot[r] = jsm::atan2(B.x[b] - U.x[r], B.z[b] - U.z[r]);
		U.anim_want[r] = A_WORSHIP;
		B.civ_empower[b] = std::max(B.civ_empower[b], empower_strength(r)); // (several empowerers do not stack, Retold)
	}
	// Obelisk LOS
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && B.type[b] == B_OBELISK) B.sight[b] = building_def(B_OBELISK).sight * (1 + EMPOWER_LOS * B.civ_empower[b]);

	// 2. Monument favor (Egyptians: no worship)
	for (int o = 1; o < MAX_PLAYERS; o++) {
		Player &p = sim->players[o];
		if (!p.exists || p.civ != CIV_EGYPT) continue;
		const double rate = monument_favor_rate(o);
		if (rate <= 0) continue;
		const double before = p.res[RES_FAVOR];
		p.res[RES_FAVOR] = std::min(FAVOR_CAP, p.res[RES_FAVOR] + rate * dt * sim->techs.favor_mult(o));
		favor_made[o] += p.res[RES_FAVOR] - before;
	}

	// 3. healing: an idle Priest / Pharaoh heals the most hurt ally in reach
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r]) continue;
		U.civ_heal[r] = 0;
		const EgyptUnit *eu = egypt_unit(U.type[r]);
		if (!eu || eu->heal <= 0 || U.dead[r] || U.moving[r] || U.order_type[r] != O_IDLE) continue;
		const int owner = U.owner[r];
		const double ux = U.x[r], uz = U.z[r];
		int best = -1;
		double bf = 2, bd = 0;
		mv.hash.for_each_near(ux, uz, HEAL_RANGE + 1, [&](int o) {
			if (o == r || o >= U.size() || U.removed[o] || U.dead[o] || !sim->is_ally(owner, U.owner[o])) return;
			if (U.hp[o] >= U.max_hp[o] || unit_def(U.type[o]).cls == CLS_SIEGE) return;
			const double d = jsm::hypot(U.x[o] - ux, U.z[o] - uz) - U.radius[o];
			if (d > HEAL_RANGE) return;
			const double f = U.hp[o] / U.max_hp[o];
			if (f < bf || (f == bf && (d < bd || (d == bd && U.id[o] < U.id[best])))) {
				bf = f;
				bd = d;
				best = o;
			}
		});
		if (best < 0) continue;
		const bool busy = U.moving[best] || U.order_type[best] != O_IDLE;
		U.hp[best] = std::min(U.max_hp[best], U.hp[best] + eu->heal * (busy ? 0.5 : 1) * dt);
		U.civ_heal[r] = U.id[best];
		U.rot[r] = jsm::atan2(U.x[best] - ux, U.z[best] - uz);
		U.anim_want[r] = A_WORSHIP;
	}

	// 4. Mercenaries expire
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.dead[r]) continue;
		const EgyptUnit *eu = egypt_unit(U.type[r]);
		if (!eu || eu->decay <= 0) continue;
		U.hp[r] -= eu->decay * dt;
		if (U.hp[r] <= 0) sim->combat.kill(U.id[r], Hitter());
	}

	// 5. the Pharaoh comes back at the Town Center PHARAOH_RESPAWN s after he fell
	bool has_pharaoh[MAX_PLAYERS] = {};
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.type[r] == U_PHARAOH) has_pharaoh[U.owner[r]] = true;
	for (int o = 1; o < MAX_PLAYERS; o++) {
		const Player &p = sim->players[o];
		if (!p.exists || p.civ != CIV_EGYPT || has_pharaoh[o]) {
			if (has_pharaoh[o]) respawn_at[o] = -1;
			continue;
		}
		if (!had_pharaoh[o]) continue;
		if (respawn_at[o] < 0) respawn_at[o] = now + PHARAOH_RESPAWN;
		else if (now >= respawn_at[o] && spawn_pharaoh(o)) respawn_at[o] = -1;
	}
}

} // namespace aov
