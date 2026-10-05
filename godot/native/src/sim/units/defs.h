// Unit definitions: port of src/units/defs.js. Distances in tiles, speeds in
// tiles/second. Type ids index UNIT_DEFS (same order as the JS object).
#pragma once
#include <cstdint>
#include <cstring>

#include "../core/players.h"

namespace aov {

// CLS_SIEGE and the types from U_LABORER on are Godot-only (sim/civ: the
// Egyptians of Age of Mythology: Retold, only with Sim::godot_rules; see
// civ/civ.h for how Retold's numbers map onto these stats).
enum UnitClass : uint8_t { CLS_VILLAGER, CLS_INFANTRY, CLS_ARCHER, CLS_CAVALRY, CLS_MYTH, CLS_HERO, CLS_SIEGE, CLS_COUNT };
enum UnitType : uint8_t { U_VILLAGER, U_HOPLITE, U_TOXOTES, U_HIPPIKON, U_MINOTAUR, U_HERO, U_CYCLOPS, U_CENTAUR, U_MEDUSA,
	// Egyptian (Godot-only, sim/civ)
	U_LABORER, U_SPEARMAN, U_AXEMAN, U_SLINGER, U_CHARIOT_ARCHER, U_CAMEL_RIDER, U_WAR_ELEPHANT, U_SIEGE_TOWER, U_CATAPULT,
	U_MERCENARY, U_MERCENARY_CAVALRY, U_PRIEST, U_PHARAOH, U_BABOON,
	U_TYPE_COUNT };
constexpr int U_GREEK_COUNT = U_LABORER; // the browser's types (Greek); the rest are Egyptian
inline bool is_egypt_unit(int t) { return t >= U_LABORER && t < U_TYPE_COUNT; }

struct UnitAttack {
	double damage = 0, range = 0, cooldown = 0, splash = 0;
	bool projectile = false; // 'arrow'
};

struct UnitDef {
	const char *key, *name;
	UnitClass cls;
	double hp, speed, radius, sight;
	int pop;
	Cost cost;
	double train_time;
	const char *hotkey;
	bool gatherer, builder, myth, hero;
	int min_age;
	bool has_attack;
	UnitAttack attack;
	double armor;
	double bonus[CLS_COUNT]; // damage multiplier vs class (0 = none)
	double gather_rate[3];   // food, wood, gold (villager)
	double carry_cap;
};

constexpr double UNIT_VOXEL = 0.1;

inline const UnitDef *unit_defs() {
	// clang-format off
	static const UnitDef D[U_TYPE_COUNT] = {
		{ "villager", "Villager", CLS_VILLAGER, 75, 2.7, 0.32, 8, 1, Cost(50, 0, 0, 0), 10, "Q", true, true, false, false, 0,
			true, { 3, 0.5, 1.5, 0, false }, 0, { 0 }, { 0.75, 0.6, 0.55 }, 10 },
		{ "hoplite", "Hoplite", CLS_INFANTRY, 120, 2.5, 0.42, 8, 1, Cost(50, 0, 40, 0), 12, "Q", false, false, false, false, 0,
			true, { 9, 0.6, 1.2, 0, false }, 0.3, { 0, 0, 0, 1.5, 0, 0 }, { 0 }, 0 },
		{ "toxotes", "Toxotes", CLS_ARCHER, 65, 2.6, 0.36, 13, 1, Cost(40, 50, 0, 0), 12, "W", false, false, false, false, 0,
			true, { 7, 11, 1.7, 0, true }, 0.1, { 0, 1.2, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "hippikon", "Hippikon", CLS_CAVALRY, 160, 4.3, 0.6, 10, 2, Cost(60, 0, 70, 0), 15, "E", false, false, false, false, 0,
			true, { 8, 0.8, 1.3, 0, false }, 0.2, { 0, 0, 1.6, 0, 0, 0 }, { 0 }, 0 },
		{ "minotaur", "Minotaur", CLS_MYTH, 480, 2.9, 0.85, 10, 3, Cost(0, 0, 150, 20), 20, "Q", false, false, true, false, 1,
			true, { 24, 1.0, 1.9, 1.4, false }, 0.35, { 0, 1.3, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "hero", "Achilles", CLS_HERO, 900, 3.1, 0.55, 11, 3, Cost(150, 0, 150, 0), 30, "T", false, false, false, true, 0,
			true, { 28, 0.8, 1.0, 0, false }, 0.4, { 0, 0, 0, 0, 3, 0 }, { 0 }, 0 },
		{ "cyclops", "Cyclops", CLS_MYTH, 720, 2.6, 1.05, 10, 5, Cost(180, 0, 0, 30), 28, "W", false, false, true, false, 1,
			true, { 30, 1.2, 2.3, 1.6, false }, 0.35, { 0, 1.4, 0, 1.2, 0, 0 }, { 0 }, 0 },
		{ "centaur", "Centaur", CLS_MYTH, 340, 4.1, 0.7, 14, 3, Cost(0, 120, 0, 20), 22, "E", false, false, true, false, 1,
			true, { 12, 12, 1.5, 0, true }, 0.2, { 0, 1.2, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "medusa", "Medusa", CLS_MYTH, 300, 2.4, 0.6, 14, 4, Cost(0, 0, 160, 30), 26, "R", false, false, true, false, 1,
			true, { 15, 12, 2.0, 0, true }, 0.25, { 0, 0, 0, 0, 1.3, 0 }, { 0 }, 0 },
		// ---- Egyptian (Godot-only, sim/civ; Retold's numbers mapped as civ/civ.h says).
		// armor here is the hack armor; the pierce armor is in civ.h (egypt_unit)
		// bonus: villager, infantry, archer, cavalry, myth, hero, siege
		{ "laborer", "Laborer", CLS_VILLAGER, 55, 2.565, 0.32, 8.4, 1, Cost(50, 0, 0, 0), 11.33, "Q", true, true, false, false, 0,
			true, { 6, 0.5, 1.5, 0, false }, 0, { 0 }, { 0.675, 0.54, 0.495 }, 10 },
		{ "spearman", "Spearman", CLS_INFANTRY, 85, 3.25, 0.42, 9.6, 2, Cost(50, 0, 25, 0), 12.5, "Q", false, false, false, false, 1,
			true, { 6, 0.6, 1.15, 0, false }, 0.30, { 0, 0, 0, 2.0, 0, 0, 0 }, { 0 }, 0 },
		{ "axeman", "Axeman", CLS_INFANTRY, 85, 2.795, 0.42, 9.6, 2, Cost(40, 0, 30, 0), 11.5, "W", false, false, false, false, 1,
			true, { 5, 0.6, 1.15, 0, false }, 0.30, { 0, 4.0, 0, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "slinger", "Slinger", CLS_ARCHER, 60, 2.6, 0.36, 11.4, 2, Cost(0, 55, 25, 0), 13.5, "E", false, false, false, false, 1,
			true, { 4, 10.2, 1.15, 0, true }, 0.1125, { 0, 0, 2.25, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "chariot_archer", "Chariot Archer", CLS_CAVALRY, 95, 3.25, 0.7, 12.6, 3, Cost(0, 100, 40, 0), 8, "Q", false, false, false, false, 2,
			true, { 11, 11.4, 1.725, 0, true }, 0.1125, { 0, 1.5, 0, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "camel_rider", "Camel Rider", CLS_CAVALRY, 135, 3.9, 0.6, 9.6, 3, Cost(50, 0, 70, 0), 6.5, "W", false, false, false, false, 2,
			true, { 8, 0.8, 1.15, 0, false }, 0.1125, { 0, 0, 1.25, 2.0, 0, 0, 0 }, { 0 }, 0 },
		{ "war_elephant", "War Elephant", CLS_CAVALRY, 450, 1.885, 1.0, 9.6, 5, Cost(180, 0, 70, 0), 14, "E", false, false, false, false, 2,
			true, { 22, 1.0, 1.61, 0.8, false }, 0.1875, { 0, 0, 1.5, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "siege_tower", "Siege Tower", CLS_SIEGE, 400, 1.885, 1.1, 12, 3, Cost(0, 200, 100, 0), 15, "Q", false, false, false, false, 2,
			true, { 9, 1.8, 1.15, 0, false }, 0.0375, { 0 }, { 0 }, 0 },
		{ "catapult", "Catapult", CLS_SIEGE, 115, 1.56, 0.9, 21.6, 5, Cost(0, 200, 200, 0), 26.5, "W", false, false, false, false, 3,
			true, { 42, 16.8, 4.6, 0, true }, 0.225, { 0 }, { 0 }, 0 },
		{ "mercenary", "Mercenary", CLS_INFANTRY, 90, 2.795, 0.42, 9.6, 0, Cost(0, 0, 90, 0), 1, "W", false, false, false, false, 0,
			true, { 7, 0.6, 1.15, 0, false }, 0.2625, { 0, 0, 0, 1.5, 0, 0, 0 }, { 0 }, 0 },
		{ "mercenary_cavalry", "Mercenary Cavalry", CLS_CAVALRY, 160, 3.445, 0.6, 7.2, 0, Cost(0, 0, 120, 0), 2, "E", false, false, false, false, 2,
			true, { 8, 0.8, 1.15, 0, false }, 0.15, { 0, 0, 1.5, 0, 0, 0, 0 }, { 0 }, 0 },
		{ "priest", "Priest", CLS_HERO, 80, 2.47, 0.34, 8.4, 2, Cost(0, 0, 100, 0), 10, "R", false, true, false, true, 0,
			true, { 0.5, 3.0, 0.92, 0, true }, 0.075, { 0, 0, 0, 0, 5.0, 0, 0 }, { 0 }, 0 },
		{ "pharaoh", "Pharaoh", CLS_HERO, 100, 2.6, 0.4, 10.8, 0, Cost(), 0, "", false, false, false, true, 0,
			true, { 3, 1.8, 1.15, 0, true }, 0.1125, { 0, 0, 0, 0, 2.5, 0, 0 }, { 0 }, 0 },
		// Set's starting scout (an Animal of Set: this sim has no animal class, infantry)
		{ "baboon_of_set", "Baboon of Set", CLS_INFANTRY, 20, 2.145, 0.3, 12, 1, Cost(0, 0, 0, 3), 0, "", false, false, false, false, 0,
			true, { 3, 0.6, 1.15, 0, false }, 0, { 0 }, { 0 }, 0 },
	};
	// clang-format on
	return D;
}

inline const UnitDef &unit_def(int type) { return unit_defs()[type]; }
inline int unit_type_of(const char *key) {
	for (int i = 0; i < U_TYPE_COUNT; i++)
		if (std::strcmp(unit_defs()[i].key, key) == 0) return i;
	return -1;
}

} // namespace aov
