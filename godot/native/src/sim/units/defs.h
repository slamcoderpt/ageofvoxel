// Unit definitions: port of src/units/defs.js. Distances in tiles, speeds in
// tiles/second. Type ids index UNIT_DEFS (same order as the JS object).
#pragma once
#include <cstdint>
#include <cstring>

#include "../core/players.h"

namespace aov {

enum UnitClass : uint8_t { CLS_VILLAGER, CLS_INFANTRY, CLS_ARCHER, CLS_CAVALRY, CLS_MYTH, CLS_HERO, CLS_COUNT };
enum UnitType : uint8_t { U_VILLAGER, U_HOPLITE, U_TOXOTES, U_HIPPIKON, U_MINOTAUR, U_HERO, U_CYCLOPS, U_CENTAUR, U_MEDUSA, U_TYPE_COUNT };

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
