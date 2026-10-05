// Civilizations (Godot-only, behind Sim::godot_rules; the browser build has
// the Greeks alone): a civilization per player, chosen at match setup by the
// major god (zeus / hades / poseidon -> Greek; ra / isis / set -> Egyptian),
// and the Egyptians of Age of Mythology: Retold (reference/egypt/EGYPT.md).
// See godot/PORTING.md "Civilizations, the Egyptians".
//
// - Player::civ (core/players.h): CIV_GREEK (the default, what every player
//   is with the rules off) or CIV_EGYPT. Types are per civ: the Greek unit
//   and building types (the browser's, plus the Godot-only Armory, Market,
//   walls and towers) and the Egyptian ones (units/defs.h from U_LABORER,
//   buildings/defs.h from B_GRANARY). A player builds and trains only his
//   civ's types; Town Center, House, Farm, Temple, Armory, Market, walls,
//   gates and towers are both civs' (an Egyptian one costs gold, never wood).
// - Egyptian economy: Laborers (gather x0.9, build x0.75, never worship, a
//   cap of 100), separate drop sites (Granary food, Lumber Camp wood, Mining
//   Camp gold; the Town Center takes all), favor only from the five
//   Monuments (built in order, one each, a constant trickle), free Houses /
//   drop sites / Armory / Market, gold Town Center / Farm / Temple /
//   Barracks / Migdol / Siege Works / towers / walls.
// - The Pharaoh (one, free, 0 pop, respawns at the starting Town Center 90 s
//   after he dies) empowers the building he is ordered onto (O_EMPOWER):
//   +75 % build / train / research speed (not Laborers, not age-ups), +20 %
//   resources on each drop at a drop site, +20 % Monument favor, x0.75
//   reload on a building that shoots, +75 % Obelisk LOS. He and the Priests
//   heal (10 / 7.5 hp/s, half on a busy target); Ra's Priests empower at 60 %.
// - Mapping Retold onto this sim (the browser's stats are AoM-scaled: hp and
//   damage as AoM, distances x0.6, speeds x~0.65): hp and damage as Retold,
//   speed x0.65 (a worker: x the Greek villager's ratio, 2.7 / 4.0), range and
//   LOS x0.6 (DIST_SCALE), reload x1.15 (the browser's soldiers reload ~15 %
//   slower than Retold's), armor: this sim's one value per unit becomes, for
//   Egyptian units, a hack and a pierce armor = Retold's x0.75 (a hoplite's
//   0.30 is Retold's ~40 % hack), crush (siege) vs units = Retold's 99 % crush
//   armor; Egyptian buildings with no Greek counterpart: Retold hp x1.25
//   (Town Center / Temple / Academy ratio 3000 / 2400 = 1500 / 1200),
//   footprint ~x1.2-1.5 (Monuments 2x2 / 3x3, Migdol 6x6, Siege Works 5x5),
//   Retold armor (hack / pierce / crush); shared types keep
//   the Greek building's hp, size and base time (Retold gives both civs the
//   same) and take the Egyptian cost.
//
// Deterministic: no rng draw; iteration in row (= id) order.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "../buildings/defs.h"
#include "../units/defs.h"

namespace aov {

class Sim;
struct Start;

enum Civ : uint8_t { CIV_GREEK = 0, CIV_EGYPT = 1, CIV_COUNT };
const char *civ_key(int civ);  // "greek" / "egyptian"
const char *civ_name(int civ); // "Greeks" / "Egyptians"
int civ_of_key(const std::string &key);  // "greek" | "egyptian" (also "egypt", "egyptians"), -1 unknown
int civ_of_god(const std::string &god);  // zeus / hades / poseidon -> GREEK, ra / isis / set -> EGYPT, -1 unknown (any case)
const char *const *civ_major_gods(int civ); // nullptr-terminated, lower case

// the civ a type belongs to: CIV_GREEK / CIV_EGYPT, -1 = both (shared types)
int unit_civ(int type);
int building_civ(int type);
inline bool civ_has_unit(int civ, int type) { const int c = unit_civ(type); return c < 0 || c == civ; }
inline bool civ_has_building(int civ, int type) { const int c = building_civ(type); return c < 0 || c == civ; }

// ---- Egyptian numbers that do not fit UnitDef ----------------------------------
struct EgyptUnit {
	double pierce_armor;      // UnitDef.armor is the hack armor
	double crush_vs_building; // siege: crush damage per hit on a building (0 = the def's damage, the building factor)
	double vs_buildings;      // multiplier vs buildings (War Elephant x4), 0 = none
	double decay;             // hp lost per second (Mercenaries), 0 = none
	int limit;                // living + queued per player, 0 = none
	double heal;              // hp / s healing allies (Priest, Pharaoh), 0 = none
	const char *stand_in;     // a Greek type the renderer may draw until its model exists
	const char *retold;       // Retold's line as EGYPT.md gives it
	const char *mapping;      // how it maps here
};
const EgyptUnit *egypt_unit(int type); // nullptr for a Greek type

// Priest and Pharaoh grow with each age (EGYPT.md 1.5, 1.6), mapped (range / LOS x0.6)
struct HeroAge { double hp[4], damage[4], range[4], sight[4]; };
const HeroAge *hero_age(int type); // U_PRIEST / U_PHARAOH, else nullptr

// ---- buildings per civ ------------------------------------------------------------
struct CivArmor { double hack, pierce, crush; bool retold; }; // retold false: the browser's flat factor
Cost civ_building_cost(int civ, int type);  // with the rules on
double civ_building_hp(int civ, int type);  // with the rules on
CivArmor civ_building_armor(int type);      // Egyptian types: Retold's; others: retold = false
const char *building_stand_in(int type);    // a Greek building type the renderer may draw until its model exists
// the build menu of a civ (rules on), in menu order, -1 terminated
const int *civ_build_menu(int civ);
// the unit types a building of `civ` can train (rules on), -1 terminated
const int *civ_trains(int civ, int btype);
// which builders: villager -> Greek / shared, laborer -> Egyptian / shared but the
// Obelisk, priest -> the Obelisk alone
bool unit_can_build(int utype, int btype);

// Monuments: favor per minute (Retold), in build order
constexpr double MONUMENT_FAVOR_MIN[5] = { 4.5, 6, 7.5, 9, 12 };
constexpr int MONUMENT_COUNT = 5;
inline int monument_index(int btype) { return is_monument(btype) ? btype - B_MONUMENT_VILLAGERS : -1; }

constexpr double LABORER_GATHER = 0.9;   // x a Greek villager's rate (farms too)
constexpr double LABORER_BUILD = 0.75;   // work rate on a site (x4/3 the build time)
constexpr int LABORER_CAP = 100;
constexpr double EMPOWER_SPEED = 0.75;   // +75 % build / train / research
constexpr double EMPOWER_DROP = 0.20;    // +20 % resources dropped
constexpr double EMPOWER_FAVOR = 0.20;   // +20 % Monument favor
constexpr double EMPOWER_RELOAD = 0.75;  // x0.75 reload (shooting buildings)
constexpr double EMPOWER_LOS = 0.75;     // +75 % Obelisk LOS
constexpr double EMPOWER_REACH = 2.0;    // tiles from the building's rect
constexpr double RA_PRIEST_EMPOWER = 0.6;
constexpr double PHARAOH_RESPAWN = 90;
constexpr double HEAL_RANGE = 10 * 0.6;  // Retold 10 x DIST_SCALE
constexpr double ISIS_OBELISK_BUILD = 1.4;
constexpr double FAVOR_CAP = 200;        // the Greek favor cap of this sim
constexpr double SIEGE_CRUSH_ARMOR = 0.05; // a browser building's crush armor vs siege (Retold buildings: 5-10 %)

struct CivStart { int32_t tc = 0, pharaoh = 0, priest = 0; std::vector<int32_t> workers; };

// ---- the system ------------------------------------------------------------------------
class Civs {
public:
	Sim *sim = nullptr;
	// per player: the Pharaoh's respawn (game time, < 0 = none pending), the starting Town Center
	double respawn_at[MAX_PLAYERS];
	int32_t home_tc[MAX_PLAYERS] = {};
	double favor_made[MAX_PLAYERS] = {}; // favor from Monuments this game (checks, readout)
	bool had_pharaoh[MAX_PLAYERS] = {};
	double drop_bonus[MAX_PLAYERS] = {}; // resources the empowered drop sites added this game  // a Pharaoh of his has existed (only then does one respawn)

	void init(Sim *s);
	void update(double dt); // rules on: empower, Monument favor, healing, Mercenary decay, Pharaoh respawn, hero ages

	int civ(int owner) const;
	bool rules() const;
	// may `owner` place `btype` here and now (civ, age, Monument order / limit); reason when not
	bool can_build(int owner, int btype, std::string *why = nullptr) const;
	// may building row b train utype for its owner? 0 yes, 1 not on its civ's list for that
	// building, 2 a condition (a Temple for the TC's Priests, a unit limit); reason when not
	int train_check(int brow, int utype, std::string *why = nullptr) const;
	// Egyptian start: Town Center, Laborers (villagers - 2, Retold's 3 of 5), the Pharaoh, a Priest
	CivStart egypt_start(int owner, const Start &st, int villagers);
	int32_t spawn_pharaoh(int owner); // at his home (else any) Town Center; 0 = none
	int count_type(int owner, int type, bool queued = true) const;
	bool has_built(int owner, int btype) const;

	// hooks (rules on)
	double work_rate(int urow, int brow) const;    // a builder's share on a site
	double empower(int brow) const;                // 0 .. 1.2: the building's empowerment
	double build_mult(int brow) const { return 1 + EMPOWER_SPEED * empower(brow); }
	double train_mult(int brow, int utype) const;  // not Laborers
	double research_mult(int brow) const { return 1 + EMPOWER_SPEED * empower(brow); }
	double drop_mult(int brow) const { return 1 + EMPOWER_DROP * empower(brow); }
	double reload_mult(int brow) const { const double e = empower(brow); return e > 0 ? 1 - (1 - EMPOWER_RELOAD) * e : 1; }
	double farm_mult(int utype) const { return utype == U_LABORER ? LABORER_GATHER : 1; }
	double base_hack(int urow) const;
	double base_pierce(int urow) const;
	double base_damage(int urow) const;            // the def's, or the hero's for his owner's age
	double range_add(int urow) const;              // the hero's range for the age - the def's
	double monument_favor_rate(int owner) const;   // favor / s now
	bool can_empower(int urow) const;              // Pharaoh, Ra's Priests
	double empower_strength(int urow) const;

private:
	void on_age(int owner);
	void hero_age_stats(int urow, int from_age, int to_age);
};

} // namespace aov
