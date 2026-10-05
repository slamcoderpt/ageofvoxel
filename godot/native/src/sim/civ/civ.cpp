// Civilizations and the Egyptians (see civ.h).
#include "civ.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>

#include "../core/jsmath.h"
#include "../fortify/fortify.h"
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
		{ 0.2625, 0, 0, 0, LABORER_CAP, 0, "villager",
			"Laborer: 50 f, 1 pop, 17 s, 55 hp, 6 hack, ROF 1 (reload 1.15 s, the villager 1.5); 12 pierce vs animals (range 12, ROF 2), x4 vs towers, armor 25/35/99, speed 3.8, LOS 14; carries 15 food / 10 wood / 10 gold; gathers 10 % slower, builds 25 % slower, never worships; cap 100",
			"hp, damage as Retold; train 17 x 10/15 (the Greek villager here trains in 10 s for Retold's 15); speed x the villager's 2.7/4.0; LOS x0.6; armor x0.75 as the soldiers (hack 0.1875 / pierce 0.2625); the anti-animal bow vs Animals of Set: 12 per 2.3 s at 7.2 (wild deer / boar: this sim's hunting spear, as the villager's); gather = the villager's x0.9; carry 15 food / 10 wood / 10 gold as Retold (the villager's 10 of each; the +5 / +15 carry techs are not in this game); build work rate 0.75; pop 1 as Retold (the villager's 1)" },
		{ 0.075, 0, 0, 0, 0, 0, "hoplite",
			"Spearman: 50 f + 25 g, 2 pop, 12.5 s, 85 hp, 6 hack, x2 vs cavalry, armor 40/10/99, speed 5.0, LOS 16",
			"armor x0.75 (hack 0.30 / pierce 0.075), speed x0.65, reach 0.75 x0.8, reload x1.15, LOS x0.6; pop 2 -> 1 (Retold's halved, rounded up, as this sim's hoplite / toxotes 2 -> 1, hippikon 3 -> 2)" },
		{ 0.075, 0, 0, 0, 0, 0, "hoplite",
			"Axeman: 40 f + 30 g, 2 pop, 11.5 s, 85 hp, 5 hack, x4 vs infantry, armor 40/10/99, speed 4.3, LOS 16",
			"as the Spearman (pop 2 -> 1)" },
		{ 0.30, 0, 0, 0, 0, 0, "toxotes",
			"Slinger: 55 w + 25 g, 2 pop, 13.5 s, 60 hp, 4 pierce, range 17, x2.25 vs ranged soldiers, armor 15/40/99, speed 4.0, LOS 19",
			"range / LOS x0.6; 'ranged soldiers' = the archer class (toxotes, slinger); armor x0.75; pop 2 -> 1; stands and shoots as every ranged unit here (no kiting), so infantry that reaches it wins at equal cost (as the toxotes vs the hoplite)" },
		{ 0.15, 0, 0, 0, 0, 0, "hippikon",
			"Chariot Archer: 100 w + 40 g, 3 pop, 8 s, 95 hp, 11 pierce, range 19, ROF 1.5, x1.5 vs infantry, armor 15/20/99, speed 5.0, LOS 21",
			"a ranged cavalry unit: class cavalry (spearmen and camels counter it), arrows; reload 1.5 x1.15; pop 3 -> 2 (as the hippikon)" },
		{ 0.30, 0, 0, 0, 0, 0, "hippikon",
			"Camel Rider: 50 f + 70 g, 3 pop, 6.5 s, 135 hp, 8 hack, x2 vs cavalry, x1.25 vs ranged soldiers, armor 15/40/99, speed 6.0, LOS 16",
			"both multipliers kept (cavalry x2, archer class x1.25); pop 3 -> 2 (as the hippikon)" },
		{ 0.375, 0, 4, 0, 0, 0, "cyclops",
			"War Elephant: 180 f + 70 g, 5 pop, 14 s, 450 hp, 22 hack (small splash), ROF 1.4, x4 vs buildings, x1.5 vs ranged soldiers, armor 25/50/99, speed 2.9, size 1.49",
			"splash 0.8 tiles (Retold's 'small'), x4 on the building factor (0.35, or Retold armor); pop 5 -> 3 (halved, rounded up)" },
		{ 0.675, 59.1, 0, 0, 0, 0, "hippikon",
			"Siege Tower: 200 w + 100 g, 3 pop, 15 s, 400 hp, 180 crush ram vs buildings (ROF 3.5, range 3) + 3 arrows x 3 pierce vs units (range 12), armor 5/90/85, speed 2.9",
			"one attack (this sim has one per unit): 9 vs units, 59.1 crush per 1.15 s hit vs buildings (= Retold's 180 / 3.5 s), reach 1.8 (Retold's ram 3 x0.6); crush ignores the building's flat 0.35 factor, takes its crush armor; pop 3 -> 2" },
		{ 0.675, 200, 0, 0, 0, 0, "cyclops",
			"Catapult: 200 w + 200 g, 5 pop, 26.5 s, 115 hp, 200 crush + 40 pierce, area 8, range 10-28, ROF 4, armor 30/90/85, speed 2.4, LOS 36, x2.5 vs ships",
			"vs units 42 (40 pierce + 200 crush x Retold's 1 % human crush vulnerability), no area (no splash on this sim's projectiles), no minimum range; 200 crush vs buildings; pop 5 -> 3" },
		{ 0.1125, 0, 0, 2.5, 12, 0, "hoplite",
			"Mercenary: 90 g, 0 pop, 1 s, 90 hp losing 2.5 hp/s, 7 hack, x1.5 vs cavalry, armor 35/15/99, speed 4.3, limit 12, at the Town Center",
			"decay as Retold; limit counts living + queued; 0 pop as Retold" },
		{ 0.2625, 0, 0, 4, 8, 0, "hippikon",
			"Mercenary Cavalry: 120 g, 0 pop, 2 s, 160 hp losing 4 hp/s, 8 hack, x1.5 vs ranged soldiers, armor 20/35/99, speed 5.3, LOS 12, limit 8, Heroic",
			"decay as Retold" },
		{ 0.0075, 0, 0, 0, 0, 7.5, "villager",
			"Priest: 100 g, 2 pop, 10 s, 80 hp (88 / 100 / 116), 0.5 attack (2.2 / 2.5 / 2.9), range 5 (12 / 16 / 20), x5 vs myth, armor 10/1/99, heals 7.5 hp/s at 10, builds Obelisks",
			"hp / damage / range / LOS per age as Retold (range, LOS x0.6); heal range 6; heals half on a busy target; Heka's divine damage: the x5 vs myth only; pop 2 -> 1 (as the soldiers)" },
		{ 0.225, 0, 0, 0, 1, 10, "hero",
			"Pharaoh: free, 0 pop, 100 hp (110 / 125 / 145), 3 attack (13.2 / 15 / 17.4), range 3 (12 / 18 / 20), x2.5 vs myth, armor 15/30/99, heals 10 hp/s, empowers, respawns at the TC after 90 s",
			"per age as the Priest; empower in sim/civ (O_EMPOWER)" },
		{ 0.0375, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Baboon of Set: 3 favor, 3 s, 1 pop, 20 hp, 3 hack (0.3 Archaic), ROF 1, armor 35/5/99, speed 3.3, LOS 16, food 93.75; Set's starting scout, the Archaic summon",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Gazelle of Set: 3 favor, 3 s, 1 pop, 15 hp, 3.5 hack, ROF 1.1, armor 35/0/99, speed 4, LOS 14, food 150; Classical summon, 2 at the Temple on reaching Classical",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0.225, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Hyena of Set: 4 favor, 4 s, 1 pop, 45 hp, 7 hack, ROF 1.8, armor 20/30/99, speed 4, LOS 14, food 93.75; Classical summon, 1 at the Temple on reaching Classical",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0.0375, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Giraffe of Set: 5 favor, 4 s, 1 pop, 25 hp, 5 hack, ROF 1.4, armor 35/5/99, speed 4, LOS 14, food 300; Heroic summon, 2 at the Temple on reaching Heroic",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0.225, 0, 0.5, 0, 0, 0, "petsuchos",
			"Crocodile of Set: 6 favor, 4 s, 1 pop, 70 hp, 9 hack, ROF 1.3, armor 10/30/99, speed 3.3, LOS 14, food 187.5; Heroic summon, 1 at the Temple on reaching Heroic",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0.15, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Hippopotamus of Set: 7 favor, 6 s, 2 pop, 100 hp, 6 hack, ROF 1, armor 10/20/99, speed 4, LOS 14, food 375; Mythic summon, 2 at the Temple on reaching Mythic",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0.30, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Rhinoceros of Set: 9 favor, 6 s, 2 pop, 135 hp, 8 hack, ROF 1.1, armor 30/40/99, speed 4, LOS 14, food 487.5; Mythic summon, 1 at the Temple on reaching Mythic",
			"hp, damage as Retold (x0.1 in the Archaic Age); class animal; speed x0.65, LOS x0.6, reload x1.15, armor x0.75; x0.5 vs buildings; dies into a carcass with its food; pop as Retold (summoned for favor like the myth units, whose pop this sim does not halve)" },
		{ 0.30, 0, 1.5, 0, 0, 0, "war_elephant",
			"Elephant of Set: 14 favor, 8 s, 2 pop, 270 hp, 10 hack, ROF 1.4, x1.5 vs buildings, armor 20/40/99, speed 3.3, LOS 14, food 675; Mythic summon (Retold)",
			"as the other Animals of Set but x1.5 vs buildings; reach 0.8 (size 1.49)" },
		{ 0, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Deer of Set: a wild Deer a Priest of Set converted (35 s at range 10); 1 pop, 15 hp, 3 hack, ROF 1.1, armor 35/0/99, speed 4, LOS 14; keeps 75 % of the Deer's food",
			"as the Animals of Set; food 75 = 75 % of this sim's deer (100)" },
		{ 0.225, 0, 0.5, 0, 0, 0, "baboon_of_set",
			"Boar of Set: a wild Boar a Priest of Set converted (50 s at range 10); 2 pop, 70 hp, 6 hack, ROF 1, armor 20/30/99, speed 5, LOS 14; keeps 75 % of the Boar's food",
			"as the Animals of Set; food 187.5 = 75 % of this sim's boar (250)" },
	};
	return is_egypt_unit(type) ? &T[type - U_LABORER] : nullptr;
}

std::string unit_plural(int type) {
	const std::string n = unit_def(type).name;
	if (is_set_animal(type)) { // "Baboons of Set", "Hippopotami of Set"
		std::string k = n.substr(0, n.size() - 7);
		if (type == U_HIPPO_OF_SET) return "Hippopotami of Set";
		if (k.size() && k.back() == 's') k += "es";
		else k += "s";
		return k + " of Set";
	}
	if (type == U_MERCENARY_CAVALRY) return n; // (a collective)
	if (n.size() > 1 && n.back() == 'y' && !std::strchr("aeiou", n[n.size() - 2])) return n.substr(0, n.size() - 1) + "ies";
	if (n.size() && (n.back() == 's' || n.back() == 'x')) return n + "es";
	return n + "s";
}

const HeroAge *hero_age(int type) {
	static const HeroAge PRIEST = { { 80, 88, 100, 116 }, { 0.5, 2.2, 2.5, 2.9 }, { 3.0, 7.2, 9.6, 12 }, { 8.4, 8.4, 10.8, 13.2 } };
	static const HeroAge PHARAOH = { { 100, 110, 125, 145 }, { 3, 13.2, 15, 17.4 }, { 1.8, 7.2, 10.8, 12 }, { 10.8, 10.8, 14.4, 15.6 } };
	return type == U_PRIEST ? &PRIEST : type == U_PHARAOH ? &PHARAOH : nullptr;
}

// ---- Set's Animals of Set -----------------------------------------------------------------

const SetAnimal *set_animal(int type) {
	// summon age, food (Retold's Amount; converted: 75 % of this sim's wild animal), converted from
	static const SetAnimal T[] = {
		{ 0, 93.75, -1 },  // Baboon
		{ 1, 150, -1 },    // Gazelle
		{ 1, 93.75, -1 },  // Hyena
		{ 2, 300, -1 },    // Giraffe
		{ 2, 187.5, -1 },  // Crocodile
		{ 3, 375, -1 },    // Hippopotamus
		{ 3, 487.5, -1 },  // Rhinoceros
		{ 3, 675, -1 },    // Elephant
		{ -1, 100 * CONVERT_FOOD, R_DEER },
		{ -1, 250 * CONVERT_FOOD, R_BOAR },
	};
	return is_set_animal(type) ? &T[type - U_BABOON] : nullptr;
}

const int *set_age_animals(int age) {
	static const int NONE[] = { -1 };
	static const int A[4][4] = { { -1 }, { U_GAZELLE_OF_SET, U_GAZELLE_OF_SET, U_HYENA_OF_SET, -1 },
		{ U_GIRAFFE_OF_SET, U_GIRAFFE_OF_SET, U_CROCODILE_OF_SET, -1 }, { U_HIPPO_OF_SET, U_HIPPO_OF_SET, U_RHINO_OF_SET, -1 } };
	return age >= 1 && age <= 3 ? A[age] : NONE;
}

int converted_type(int wild) { return wild == R_DEER ? U_DEER_OF_SET : wild == R_BOAR ? U_BOAR_OF_SET : -1; }

Cost civ_fort_tech_cost(int civ, int tech) {
	if (civ == CIV_EGYPT) switch (tech) { // (EGYPT.md 2: Retold's Egyptian prices)
		case FT_STONE_WALL: return Cost(); // (given free in the Classical Age: civ_wall_piece_cost)
		case FT_WATCH_TOWER: return Cost(0, 50, 100, 0);
		case FT_FORTIFIED_WALL: return Cost(500, 0, 400, 0);
		case FT_CITADEL_WALL: return Cost(800, 0, 500, 0);
		default: break;
	}
	return fort_tech_def(tech).cost;
}

double civ_fort_tech_time(int civ, int tech) {
	if (civ == CIV_EGYPT && tech == FT_CITADEL_WALL) return 50; // (EGYPT.md 2: Citadel Wall 50 s)
	return fort_tech_def(tech).time;
}

Cost civ_wall_piece_cost(int civ, int type, int tiles) {
	if (civ != CIV_EGYPT) return Cost();
	if (type == B_WALL_PILLAR) return Cost(0, 0, 3, 0);
	return Cost(0, 0, tiles >= WALL_SEGMENT_MAX ? 15 : tiles >= 2 ? 9 : 6, 0);
}

int civ_building_min_age(int civ, int btype) {
	const int a = building_def(btype).min_age;
	if (civ != CIV_EGYPT) return a;
	if (btype == B_TOWER) return std::max(a, EGYPT_TOWER_AGE);
	if (is_wall_piece(btype) || btype == B_GATE) return std::max(a, EGYPT_WALL_AGE);
	return a;
}

double civ_build_time(int civ, int btype) {
	if (civ != CIV_EGYPT) return 0;
	switch (btype) { // Retold's base times (a Laborer: x4/3: 200 / 13.33 / 80 s)
		case B_TOWN_CENTER: return 150;
		case B_FARM: return 10;
		case B_TOWER: return 60;
		default: return 0;
	}
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

int civ_building_limit(int civ, int btype) {
	if (civ != CIV_EGYPT) return 0;
	if (is_monument(btype)) return 1;
	if (btype == B_MIGDOL) return MIGDOL_LIMIT;
	return 0;
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
		isis_healed[i] = 0;
		devotee_saved[i] = 0;
		shield_refused[i] = 0;
	}
	mandjet_by.clear();
	summons.clear();
	for (int i = 0; i < MAX_PLAYERS; i++) summoned[i] = converted[i] = age_gift[i] = 0, carcass_food[i] = 0;
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
	// Set's Priests convert a wild animal (EGYPT.md 1.6): walk into range 6, then channel
	s->commands.register_handler(O_CONVERT, [this](int r, const Order &o) {
		if (!rules() || !can_convert(r)) return false;
		Entities &E = sim->entities;
		const int a = E.resource_slot(o.target);
		const ResourceStore &R = E.resources;
		if (a < 0 || R.removed[a] || !is_animal_type(R.type[a]) || !R.alive[a]) return false;
		UnitStore &U = E.units;
		U.order_x[r] = 0; // progress (s)
		U.order_c[r] = 0;
		sim->movement.move_to(r, R.x[a], R.z[a], nullptr, CONVERT_RANGE - 0.5);
		return true;
	});
	// an Animal of Set that dies leaves a carcass with its food (Retold: hunt for the Laborers)
	s->events.on(EV_ENTITY_DIED, [this](const Event &e) {
		if (!rules() || e.kind != K_UNIT) return;
		const int r = sim->entities.unit_slot(e.id);
		if (r < 0) return;
		const UnitStore &U = sim->entities.units;
		const SetAnimal *sa = set_animal(U.type[r]);
		if (!sa) return;
		const int wild = U.type[r] == U_BOAR_OF_SET || unit_def(U.type[r]).pop > 1 ? R_BOAR : R_DEER;
		const int32_t cid = sim->economy.wildlife.spawn(wild, U.x[r], U.z[r], -1, U.rot[r]);
		const int c = sim->entities.resource_slot(cid);
		if (c < 0) return;
		ResourceStore &R = sim->entities.resources;
		R.alive[c] = 0;
		R.hp[c] = 0;
		R.amount[c] = R.max_amount[c] = sa->food;
		if (U.owner[r] > 0 && U.owner[r] < MAX_PLAYERS) carcass_food[U.owner[r]] += sa->food;
	});
	// Retold's Egyptian base build times for the shared types that differ (fort_build_time: the row's own)
	s->events.on(EV_BUILDING_PLACED, [this](const Event &e) {
		if (!rules()) return;
		const int b = sim->entities.building_slot(e.id);
		if (b < 0) return;
		BuildingStore &B = sim->entities.buildings;
		const double t = civ_build_time(civ(B.owner[b]), B.type[b]);
		if (t > 0) B.fort_build_time[b] = t;
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
	if (civ(owner) == CIV_EGYPT && god_is(owner, "set")) age_gift_spawn(owner, age);
	if (civ(owner) == CIV_EGYPT && age >= EGYPT_WALL_AGE) sim->fortify.grant_level(owner, 0, 1); // (Stone Wall from the Classical Age)
}

void Civs::age_set(int owner, int from, int to) {
	if (!rules() || owner <= 0 || owner >= MAX_PLAYERS || from == to) return;
	UnitStore &U = sim->entities.units;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && U.owner[r] == owner && hero_age(U.type[r])) hero_age_stats(r, from, to);
	if (civ(owner) == CIV_EGYPT && god_is(owner, "set"))
		for (int a = from + 1; a <= to; a++) age_gift_spawn(owner, a);
	if (civ(owner) == CIV_EGYPT && to >= EGYPT_WALL_AGE) sim->fortify.grant_level(owner, 0, 1);
}

std::vector<int32_t> Civs::age_gift_spawn(int owner, int age) {
	std::vector<int32_t> out;
	const BuildingStore &B = sim->entities.buildings;
	int at = -1; // the first standing Temple, else the home (any) Town Center
	for (int b = 0; b < B.size() && at < 0; b++)
		if (!B.removed[b] && !B.dead[b] && B.built[b] && B.owner[b] == owner && B.type[b] == B_TEMPLE) at = b;
	if (at < 0) {
		at = sim->entities.building_slot(home_tc[owner]);
		if (at >= 0 && (B.dead[at] || B.owner[at] != owner)) at = -1;
		for (int b = 0; b < B.size() && at < 0; b++)
			if (!B.removed[b] && !B.dead[b] && B.built[b] && B.owner[b] == owner && B.type[b] == B_TOWN_CENTER) at = b;
	}
	if (at < 0) return out;
	for (const int *t = set_age_animals(age); *t >= 0; t++) {
		const int r = sim->economy.spawn_from_building(at, *t);
		if (r >= 0) {
			out.push_back(sim->entities.units.id[r]);
			age_gift[owner]++;
		}
	}
	return out;
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
	const int min_age = civ_building_min_age(c, btype); // (the Egyptians' Classical towers and walls)
	if (age < min_age) return no(std::string("Requires ") + AGES[min_age] + " Age");
	const int lim = civ_building_limit(c, btype);
	if (lim > 1) { // (the Monuments' one each: below, with their order)
		const BuildingStore &B = sim->entities.buildings;
		int n = 0;
		for (int b = 0; b < B.size(); b++)
			if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner && B.type[b] == btype) n++;
		if (n >= lim) return no(std::string("Limit of ") + std::to_string(lim) + " " + building_def(btype).name + "s");
	}
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
	if (eu && eu->limit > 0 && count_type(owner, utype) >= eu->limit) return no(2, std::string("Limit of ") + std::to_string(eu->limit) + " " + (eu->limit > 1 ? unit_plural(utype) : std::string(unit_def(utype).name)));
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
	if (god_is(owner, "set")) { // (Retold: Set also starts with a Baboon of Set, the scout animal)
		const std::vector<int32_t> bb = sim->spawn_block(U_BABOON, owner, 1, fx + 4.4, fz + 0.4, 1, 1.1);
		out.baboon = bb.empty() ? 0 : bb[0];
	}
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
	if (!h) return unit_def(t).attack.damage * (is_set_animal(t) && sim->players[U.owner[r]].age <= 0 ? SET_ANIMAL_ARCHAIC : 1);
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
		rate += MONUMENT_FAVOR_MIN[monument_index(B.type[b])] / 60 * (1 + empower_favor(owner) * B.civ_empower[b]);
	}
	return rate;
}

double Civs::empower_favor(int owner) const { return god_is(owner, "isis") ? ISIS_EMPOWER_FAVOR : EMPOWER_FAVOR; }

// ---- the major gods' Monument auras ------------------------------------------------------------

double Civs::rect_dist(int b, double x, double z) const {
	const BuildingStore &B = sim->entities.buildings;
	const double x0 = B.tx[b], z0 = B.tz[b], x1 = x0 + B.w[b], z1 = z0 + B.h[b];
	const double dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
	const double dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0;
	return jsm::hypot(dx, dz);
}

double Civs::shield_radius(int b) const {
	const BuildingStore &B = sim->entities.buildings;
	if (b < 0 || b >= B.size() || B.removed[b] || B.dead[b] || !B.built[b] || !is_monument(B.type[b])) return 0;
	const int o = B.owner[b];
	if (civ(o) != CIV_EGYPT || !god_is(o, "isis")) return 0;
	return B.civ_empower[b] > 0 ? SHIELD_RANGE_EMPOWERED : SHIELD_RANGE;
}

bool Civs::shield_allows(int caster, double x, double z, std::string *why, int32_t *by) const {
	if (why) why->clear();
	if (by) *by = 0;
	if (!rules()) return true;
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		const double r = shield_radius(b);
		if (r <= 0 || !sim->is_enemy(B.owner[b], caster)) continue;
		if (rect_dist(b, x, z) <= r) {
			if (why) *why = "Blocked by a Divine Shield";
			if (by) *by = B.id[b];
			return false;
		}
	}
	return true;
}

// footprint to footprint: a Monument's centre to the building's rect, less the Monument's half size
static double mon_dist(const Civs &C, const BuildingStore &B, int m, int b) {
	return std::max(0.0, C.rect_dist(b, B.x[m], B.z[m]) - 0.5 * std::min(B.w[m], B.h[m]));
}

int32_t Civs::devotee_monument(int b) const {
	const BuildingStore &B = sim->entities.buildings;
	if (!rules() || b < 0 || b >= B.size() || B.removed[b]) return 0;
	const int o = B.owner[b];
	if ((B.type[b] != B_EG_BARRACKS && B.type[b] != B_MIGDOL) || civ(o) != CIV_EGYPT || !god_is(o, "set")) return 0;
	int32_t best = 0;
	double bd = 1e9;
	for (int m = 0; m < B.size(); m++) {
		if (B.removed[m] || B.dead[m] || !B.built[m] || B.owner[m] != o || !is_monument(B.type[m])) continue;
		const double d = mon_dist(*this, B, m, b);
		if (d <= DEVOTEES_RANGE && d < bd) {
			bd = d;
			best = B.id[m];
		}
	}
	return best;
}

double Civs::train_cost_mult(int b, int) const { return devotee_monument(b) ? DEVOTEES_COST : 1; }

void Civs::auras(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	mandjet_by.assign(B.size(), 0);
	// 1. Ra's Mandjet: a Monument the Pharaoh himself empowers (full strength) lends
	// 60 % to every other own building (Monuments too, not Farms) in 18 tiles; no
	// stacking (the strongest empowerment wins), no chaining
	std::vector<int> src;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && !B.dead[b] && B.built[b] && is_monument(B.type[b]) && B.civ_empower[b] >= 1 &&
				civ(B.owner[b]) == CIV_EGYPT && god_is(B.owner[b], "ra"))
			src.push_back(b);
	for (int m : src) {
		const int o = B.owner[m];
		for (int b = 0; b < B.size(); b++) {
			if (b == m || B.removed[b] || B.dead[b] || B.owner[b] != o || building_def(B.type[b]).farm) continue;
			if (mon_dist(*this, B, m, b) > MANDJET_RANGE || B.civ_empower[b] >= MANDJET_STRENGTH) continue;
			B.civ_empower[b] = MANDJET_STRENGTH;
			mandjet_by[b] = B.id[m];
		}
	}
	// 2. Isis: an empowered Monument heals her units and her allies' in 30 tiles at
	// 1 hp/s (half if busy, not siege); several Monuments stack
	for (int m = 0; m < B.size(); m++) {
		if (shield_radius(m) != SHIELD_RANGE_EMPOWERED) continue;
		const int o = B.owner[m];
		const double half = 0.5 * std::max(B.w[m], B.h[m]);
		sim->movement.hash.for_each_near(B.x[m], B.z[m], SHIELD_RANGE_EMPOWERED + half + 2, [&](int r) {
			if (r >= U.size() || U.removed[r] || U.dead[r] || !sim->is_ally(o, U.owner[r])) return;
			if (U.hp[r] >= U.max_hp[r] || unit_def(U.type[r]).cls == CLS_SIEGE) return;
			if (std::max(0.0, rect_dist(m, U.x[r], U.z[r]) - U.radius[r]) > SHIELD_RANGE_EMPOWERED) return;
			const bool busy = U.moving[r] || U.order_type[r] != O_IDLE;
			const double before = U.hp[r];
			U.hp[r] = std::min(U.max_hp[r], U.hp[r] + ISIS_MONUMENT_HEAL * (busy ? 0.5 : 1) * dt);
			isis_healed[o] += U.hp[r] - before;
		});
	}
}

// ---- Set's Animals of Set ----------------------------------------------------------------------

bool Civs::can_summon(int owner, int type, std::string *why) const {
	auto no = [&](const std::string &m) { if (why) *why = m; return false; };
	if (why) why->clear();
	if (!rules()) return no("Not in this game");
	const SetAnimal *sa = set_animal(type);
	if (!sa || sa->age < 0) return no("Cannot be summoned");
	if (owner <= 0 || owner >= MAX_PLAYERS || civ(owner) != CIV_EGYPT || !god_is(owner, "set")) return no("Only Set's Pharaoh summons Animals of Set");
	const Player &p = sim->players[owner];
	if (p.age < sa->age) return no(std::string("Requires ") + AGES[sa->age] + " Age");
	if (p.pop + unit_def(type).pop > p.pop_cap) return no("Need more houses");
	if (!p.can_afford(unit_def(type).cost)) return no("Not enough favor");
	return true;
}

bool Civs::summon(int r, int type, std::string *why) {
	UnitStore &U = sim->entities.units;
	if (r < 0 || r >= U.size() || U.removed[r] || U.dead[r] || U.type[r] != U_PHARAOH) {
		if (why) *why = "Only the Pharaoh summons";
		return false;
	}
	const int owner = U.owner[r];
	sim->economy.recount();
	if (!can_summon(owner, type, why)) return false;
	int queued = 0;
	for (const Summon &q : summons)
		if (q.pharaoh == U.id[r]) queued++;
	if (queued >= SUMMON_QUEUE) {
		if (why) *why = "Queue full";
		return false;
	}
	Player &p = sim->players[owner];
	const Cost c = unit_def(type).cost;
	p.pay(c);
	p.pop += unit_def(type).pop;
	summons.push_back({ owner, U.id[r], (uint8_t)type, 0, unit_def(type).train_time, c });
	Event e;
	e.type = EV_RESOURCES_CHANGED;
	e.owner = owner;
	sim->events.emit(e);
	return true;
}

int Civs::summon_pop(int owner) const {
	int n = 0;
	for (const Summon &q : summons)
		if (q.owner == owner) n += unit_def(q.type).pop;
	return n;
}

bool Civs::can_convert(int r) const {
	const UnitStore &U = sim->entities.units;
	return U.type[r] == U_PRIEST && civ(U.owner[r]) == CIV_EGYPT && god_is(U.owner[r], "set");
}

bool Civs::laborer_bow(int r, int32_t tid) const {
	const UnitStore &U = sim->entities.units;
	if (U.type[r] != U_LABORER) return false;
	const int t = sim->entities.unit_slot(tid);
	return t >= 0 && is_set_animal(U.type[t]);
}

void Civs::update_set(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	// 1. summons: the head of each Pharaoh's queue runs (he goes on with whatever he does)
	std::vector<int32_t> running;
	for (size_t i = 0; i < summons.size();) {
		Summon &q = summons[i];
		const int r = E.unit_slot(q.pharaoh);
		if (r < 0 || U.dead[r] || U.removed[r]) { // he fell: the queue is lost, its favor back
			sim->players[q.owner].refund(q.paid);
			summons.erase(summons.begin() + i);
			continue;
		}
		if (std::find(running.begin(), running.end(), q.pharaoh) != running.end()) { i++; continue; }
		running.push_back(q.pharaoh);
		q.t += dt;
		if (q.t < q.total) { i++; continue; }
		int tx, tz; // beside him
		const double a = U.rot[r] + 1.9;
		const double fx = U.x[r] + jsm::sin(a) * 1.2, fz = U.z[r] + jsm::cos(a) * 1.2;
		if (!sim->pathfinder.nearest_walkable((int)std::floor(fx), (int)std::floor(fz), 6, tx, tz)) {
			tx = (int)std::floor(U.x[r]);
			tz = (int)std::floor(U.z[r]);
		}
		const int type = q.type, owner = q.owner;
		summons.erase(summons.begin() + i);
		const int u = sim->units.spawn(type, owner, tx + 0.5, tz + 0.5, U.rot[r]);
		if (u >= 0) {
			summoned[owner]++;
			Event e;
			e.type = EV_UNIT_TRAINED;
			e.kind = K_UNIT;
			e.id = U.id[u];
			e.owner = owner;
			e.a = type;
			e.x = U.x[u];
			e.z = U.z[u];
			sim->events.emit(e);
		}
	}
	// 2. conversions: a Priest of Set in range of his wild animal channels; the animal becomes his
	ResourceStore &R = E.resources;
	Movement &mv = sim->movement;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.dead[r] || U.order_type[r] != O_CONVERT) continue;
		const int32_t aid = U.order_target[r];
		const int a = E.resource_slot(aid);
		if (a < 0 || R.removed[a] || !R.alive[a] || !is_animal_type(R.type[a])) {
			sim->commands.idle(r);
			continue;
		}
		const double d = jsm::hypot(R.x[a] - U.x[r], R.z[a] - U.z[r]) - R.radius[a];
		if (d > CONVERT_RANGE) { // (the animal grazed off: after it, the progress kept)
			if (!U.moving[r]) {
				mv.move_to(r, R.x[a], R.z[a], nullptr, CONVERT_RANGE - 1.5);
				if (!U.moving[r] && ++U.order_c[r] > 40) sim->commands.idle(r); // (unreachable)
			}
			continue;
		}
		U.order_c[r] = 0;
		if (U.moving[r]) mv.stop(r);
		U.rot[r] = jsm::atan2(R.x[a] - U.x[r], R.z[a] - U.z[r]);
		U.anim_want[r] = A_WORSHIP;
		const int type = converted_type(R.type[a]);
		U.order_x[r] += dt;
		if (type < 0 || U.order_x[r] < unit_def(type).train_time) continue;
		const int owner = U.owner[r];
		const double x = R.x[a], z = R.z[a], rot = R.rot[a];
		sim->remove_resource(aid);
		const int u = sim->units.spawn(type, owner, x, z, rot);
		if (u >= 0) {
			converted[owner]++;
			Event e;
			e.type = EV_UNIT_TRAINED;
			e.kind = K_UNIT;
			e.id = U.id[u];
			e.owner = owner;
			e.a = type;
			e.other = aid;
			e.x = x;
			e.z = z;
			sim->events.emit(e);
		}
		// (other Priests on it go idle next tick: the animal is gone)
		sim->commands.idle(r);
	}
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
	update_set(dt); // (Set: summons, conversions)

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
	auras(dt); // (Ra's Mandjet adds to the empowerment; Isis' Monuments heal)
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
