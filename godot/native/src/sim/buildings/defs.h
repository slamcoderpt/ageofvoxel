// Greek building definitions: port of src/buildings/defs.js. Footprints are
// in tiles; models are built at BUILDING_VOXEL (4 voxels per tile). Type ids
// index building_defs() in the JS object's key order.
//   trains:  unit types this building can queue (the economy runs the queue)
//   dropoff: resource kinds villagers may return here (bit per ResKind)
//   pop:     population capacity provided
//   worship: villagers can worship here to generate favor
//   farm:    infinite food node gathered by one villager (walkable)
#pragma once
#include <cstdint>
#include <cstring>

#include "../core/players.h"
#include "../units/defs.h"

namespace aov {

// B_WALL .. B_TOWER are Godot-only fortifications (sim/fortify, Age of
// Mythology: Retold): wall segments (a straight run of 1-4 tiles, rect w x h
// set per piece), wall pillars (1x1, at ends, corners and every 5 tiles),
// gates (a converted segment) and the sentry tower. Their hp, build time and
// numbers depend on the owner's wall / tower stage (fortify.h); the values
// here are stage 0, per tile for walls.
// B_ARMORY and B_MARKET are Godot-only too (sim/techs, Retold's Greek
// Armory and Market: 150 wood, 40 s, 1200 hp, 4x4, Classical Age): the
// Armory researches the weapon / armor / shield lines, the Market trades
// food and wood for gold and researches its economic techs.
// B_GRANARY .. B_SIEGE_WORKS are Godot-only too (sim/civ: the Egyptian
// buildings of Retold; only an Egyptian player places them). The shared
// types (Town Center, House, Farm, Temple, Armory, Market, walls, towers)
// are both civilizations': their cost per civ is civ_building_cost().
enum BuildingType : uint8_t { B_TOWN_CENTER, B_HOUSE, B_STOREHOUSE, B_FARM, B_TEMPLE, B_BARRACKS, B_WALL, B_WALL_PILLAR, B_GATE, B_TOWER, B_ARMORY, B_MARKET,
	// Egyptian (Godot-only, sim/civ)
	B_GRANARY, B_LUMBER_CAMP, B_MINING_CAMP,
	B_MONUMENT_VILLAGERS, B_MONUMENT_SOLDIERS, B_MONUMENT_PRIESTS, B_MONUMENT_PHARAOHS, B_MONUMENT_GODS,
	B_OBELISK, B_EG_BARRACKS, B_MIGDOL, B_SIEGE_WORKS,
	B_TYPE_COUNT };
inline bool is_egypt_building(int t) { return t >= B_GRANARY && t < B_TYPE_COUNT; }
inline bool is_monument(int t) { return t >= B_MONUMENT_VILLAGERS && t <= B_MONUMENT_GODS; }
inline bool is_wall_piece(int t) { return t == B_WALL || t == B_WALL_PILLAR || t == B_GATE; }
inline bool is_fort_type(int t) { return t >= B_WALL && t <= B_TOWER; }
inline bool is_tech_building(int t) { return t == B_ARMORY || t == B_MARKET; } // (Godot-only, sim/techs)

constexpr double BUILDING_VOXEL = 0.25;
constexpr int HOUSE_PLANS = 4;   // src/buildings/models.js
constexpr int HOUSE_TINTS = 4;   // HOUSE_ROOFS.length

struct BuildingDef {
	const char *key, *name;
	int w, h;
	double hp;
	Cost cost;
	double build_time;
	int pop;
	double sight;
	uint8_t dropoff; // bit (1 << ResKind)
	int trains[4];   // unit types, -1 terminated
	bool age_up, farm, walkable, worship;
	bool has_attack;
	double attack_damage, attack_range, attack_cooldown; // projectile 'arrow'
	const char *hotkey;
	int min_age;
	int variants; // BUILDING_VARIANTS (visual plans)
	bool trains_type(int t) const {
		for (int i = 0; i < 4 && trains[i] >= 0; i++)
			if (trains[i] == t) return true;
		return false;
	}
	bool drops(int res) const { return res >= 0 && res < 8 && (dropoff >> res) & 1; }
};

inline const BuildingDef *building_defs() {
	constexpr uint8_t FWG = (1 << RES_FOOD) | (1 << RES_WOOD) | (1 << RES_GOLD);
	// clang-format off
	static const BuildingDef D[B_TYPE_COUNT] = {
		{ "town_center", "Town Center", 7, 7, 3000, Cost(0, 400, 200, 0), 60, 15, 14, FWG, { U_VILLAGER, -1 }, true, false, false, false,
			true, 6, 10, 1.6, "T", 0, 1 },
		{ "house", "House", 3, 3, 600, Cost(0, 50, 0, 0), 15, 10, 6, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "E", 0, HOUSE_TINTS * HOUSE_PLANS },
		{ "storehouse", "Storehouse", 3, 3, 800, Cost(0, 50, 0, 0), 15, 0, 6, FWG, { -1 }, false, false, false, false,
			false, 0, 0, 0, "S", 0, 1 },
		{ "farm", "Farm", 4, 4, 300, Cost(0, 100, 0, 0), 12, 0, 4, 0, { -1 }, false, true, true, false,
			false, 0, 0, 0, "F", 0, 1 },
		{ "temple", "Temple", 5, 6, 1500, Cost(0, 150, 50, 0), 40, 0, 10, 0, { U_MINOTAUR, -1 }, false, false, false, true,
			false, 0, 0, 0, "R", 0, 1 },
		{ "barracks", "Military Academy", 5, 5, 1500, Cost(0, 150, 0, 0), 30, 0, 8, 0, { U_HOPLITE, U_TOXOTES, U_HIPPIKON, -1 }, false, false, false, false,
			false, 0, 0, 0, "B", 0, 1 },
		// fortifications (Godot-only; costs per tile for walls; stone is gold here)
		{ "wall", "Wooden Wall", 1, 1, 200, Cost(0, 4, 2, 0), 3, 0, 3, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "W", 0, 1 },
		{ "wall_pillar", "Wall Pillar", 1, 1, 300, Cost(0, 4, 2, 0), 3, 0, 3, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "W", 0, 1 },
		{ "gate", "Gate", 1, 1, 240, Cost(0, 30, 20, 0), 3, 0, 4, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "G", 0, 1 },
		{ "tower", "Sentry Tower", 2, 2, 750, Cost(0, 120, 60, 0), 30, 0, 12, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "Y", 0, 1 },
		// research and trade (Godot-only, sim/techs; Retold: LOS 9)
		{ "armory", "Armory", 4, 4, 1200, Cost(0, 150, 0, 0), 40, 0, 9, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "U", 1, 1 },
		{ "market", "Market", 4, 4, 1200, Cost(0, 150, 0, 0), 40, 0, 9, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "K", 1, 1 },
		// ---- Egyptian (Godot-only, sim/civ; Retold's numbers mapped as civ/civ.h
		// says: hp x1.25, footprint ~x1.2-1.5 (the Greek counterpart's where there
		// is one: drop sites = Storehouse, Barracks = Academy), LOS x0.6, Retold's
		// base build time, which the Laborer's 0.75 work rate turns into Retold's x4/3)
		{ "granary", "Granary", 3, 3, 500, Cost(), 15, 0, 6, 1 << RES_FOOD, { -1 }, false, false, false, false,
			false, 0, 0, 0, "D", 0, 1 },
		{ "lumber_camp", "Lumber Camp", 3, 3, 500, Cost(), 15, 0, 6, 1 << RES_WOOD, { -1 }, false, false, false, false,
			false, 0, 0, 0, "L", 0, 1 },
		{ "mining_camp", "Mining Camp", 3, 3, 500, Cost(), 15, 0, 6, 1 << RES_GOLD, { -1 }, false, false, false, false,
			false, 0, 0, 0, "M", 0, 1 },
		{ "monument_villagers", "Monument to Villagers", 2, 2, 562.5, Cost(50, 0, 50, 0), 20, 0, 5.4, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "O", 0, 1 },
		{ "monument_soldiers", "Monument to Soldiers", 2, 2, 562.5, Cost(100, 0, 100, 0), 30, 0, 5.4, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "O", 0, 1 },
		{ "monument_priests", "Monument to Priests", 2, 2, 750, Cost(200, 0, 200, 0), 40, 0, 5.4, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "O", 0, 1 },
		{ "monument_pharaohs", "Monument to Pharaohs", 3, 3, 1000, Cost(300, 0, 300, 0), 50, 0, 5.4, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "O", 0, 1 },
		{ "monument_gods", "Monument to Gods", 3, 3, 1500, Cost(600, 0, 600, 0), 60, 0, 5.4, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "O", 0, 1 },
		{ "obelisk", "Obelisk", 1, 1, 62.5, Cost(0, 0, 10, 0), 12, 0, 19.2, 0, { -1 }, false, false, false, false,
			false, 0, 0, 0, "J", 0, 1 },
		{ "eg_barracks", "Barracks", 5, 5, 1500, Cost(0, 0, 75, 0), 25, 0, 8, 0, { U_SPEARMAN, U_AXEMAN, U_SLINGER, -1 }, false, false, false, false,
			false, 0, 0, 0, "B", 1, 1 },
		{ "migdol", "Migdol Stronghold", 6, 6, 4062.5, Cost(0, 0, 500, 0), 115, 0, 18, 0, { U_CHARIOT_ARCHER, U_CAMEL_RIDER, U_WAR_ELEPHANT, -1 }, false, false, false, false,
			true, 10.35, 12, 1.6, "I", 2, 1 },
		{ "siege_works", "Siege Works", 5, 5, 1500, Cost(0, 0, 75, 0), 40, 0, 8, 0, { U_SIEGE_TOWER, U_CATAPULT, -1 }, false, false, false, false,
			false, 0, 0, 0, "H", 2, 1 },
	};
	// clang-format on
	return D;
}

inline const BuildingDef &building_def(int type) { return building_defs()[type]; }
inline int building_type_of(const char *key) {
	for (int i = 0; i < B_TYPE_COUNT; i++)
		if (std::strcmp(building_defs()[i].key, key) == 0) return i;
	return -1;
}

// src/buildings/defs.js BUILD_MENU
constexpr int BUILD_MENU[] = { B_HOUSE, B_FARM, B_STOREHOUSE, B_TEMPLE, B_BARRACKS, B_TOWN_CENTER };

} // namespace aov
