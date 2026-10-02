// Research, technologies and trade (Godot-only, behind Sim::godot_rules; the
// browser build has none): the Greek tech tree of Age of Mythology: Retold
// for the Armory, the Market and the Temple (reference/techs/TECHS.md), the
// Market's resource exchange and tribute. See godot/PORTING.md "Research,
// Armory, Market, Temple techs".
//
// - Research queue: every building row has a `tech_queue` (entities.h,
//   TechItem). research(building, tech) checks the building (type, built,
//   alive, queue < TECH_QUEUE_MAX), the tech's state for the owner (one-time,
//   one copy queued at a time, age, prerequisite, god) and pays the cost when
//   it is queued; the head of the queue progresses (Forge of Olympus: +50 %
//   at an Armory); cancel(building, i) refunds exactly what was paid. While
//   a building researches, its training queue waits (the same production
//   queue in Retold), and a Market whose research queue is full cannot
//   trade (Retold). Done -> the owner's `done` bits, his modifiers are
//   recomputed and applied to every unit he owns (hp scaled with the new
//   max, speed, sight), and to every unit he trains later (EV_ENTITY_ADDED),
//   event tech:researched (a = TECH_EVENT_BASE + TechId, id = the building).
//   A destroyed building loses its queue (no refund). The fortifications'
//   stages (sim/fortify) keep their own one-slot research and are listed
//   through the same AovSim API (get_techs, research, cancel_research).
// - Modifiers (TechMods, per player and unit type) are read by the systems
//   that own each stat, only with the rules on: combat (attack, hack /
//   pierce armor, reload, range, splash, divine damage, multipliers vs
//   buildings / myth units, arrow speed and tracking, building arrows),
//   economy (favor rate), fog (building sight, Omniscience, Sun Ray
//   reveals) and this class (regeneration, healing, poison, timed buffs).
// - Market: a price per tradable resource (food, wood; favor is not traded,
//   as in Retold) shared by every player; buying 100 costs
//   floor(price x (1 + fee)) gold, selling 100 gives floor(price x (1 -
//   fee)); each buy raises the price by MARKET_STEP, each sale lowers it,
//   clamped to [MARKET_MIN, MARKET_MAX] (the readout truncates, as Retold's
//   130 / 70, 122 / 77, 115 / 85), and it drifts back towards
//   MARKET_BASE at MARKET_DRIFT points per second. fee = 30 %, 22.5 % with
//   Tax Collectors, 15 % with Ambassadors.
// - Tribute (Retold: only while the sender owns a finished Market): the
//   receiver gets the amount, the sender pays it plus the fee (20 %, 10 %
//   with Tax Collectors, 0 with Ambassadors).
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
struct Hitter;

enum TechId : uint8_t {
	// Armory, generic line
	T_COPPER_WEAPONS, T_BRONZE_WEAPONS, T_IRON_WEAPONS,
	T_COPPER_ARMOR, T_BRONZE_ARMOR, T_IRON_ARMOR,
	T_COPPER_SHIELDS, T_BRONZE_SHIELDS, T_IRON_SHIELDS,
	T_BALLISTICS, T_BURNING_PITCH,
	// Armory, Greek god techs
	T_PHOBOS, T_DEIMOS, T_ENYO, T_SARISSA, T_AEGIS, T_SUN_RAY, T_SHAFTS_OF_PLAGUE,
	T_FORGE_OF_OLYMPUS, T_OLYMPIAN_WEAPONS, T_HARVEST_OF_SOULS,
	// Market
	T_TAX_COLLECTORS, T_AMBASSADORS, T_COINAGE,
	// Temple
	T_OMNISCIENCE, T_OLYMPIAN_PARENTAGE, T_LABYRINTH_OF_MINOS, T_WINGED_MESSENGER, T_SYLVAN_LORE,
	T_WILL_OF_KRONOS, T_CALL_OF_LYKAION, T_HYMN_OF_THE_WILDWOOD, T_ORACLE, T_TEMPLE_OF_HEALING,
	T_GOLDEN_APPLES, T_ROAR_OF_ORTHUS, T_DIONYSIA, T_CHTHONIC_RITES, T_HALLOWED_WOODLANDS,
	T_FACE_OF_THE_GORGON, T_MONSTROUS_RAGE, T_HAND_OF_TALOS, T_SHOULDER_OF_TALOS, T_FLAMES_OF_TYPHON,
	T_ENCHANTED_HYMN, T_PIOUS_SACRIFICE, T_IRON_GRIP,
	T_COUNT,
	T_NONE = 255
};

enum TechEffectKind : uint8_t {
	TE_NONE,
	TE_ATTACK,        // + v x base attack damage (additive between techs)
	TE_HACK_ARMOR,    // + v armor (fraction) vs melee blows
	TE_PIERCE_ARMOR,  // + v armor vs arrows (units' and buildings')
	TE_HP,            // + v x base hp
	TE_SPEED,         // + v x base speed
	TE_RANGE,         // + v tiles of attack range
	TE_SIGHT,         // + v tiles of sight (units; buildings with `buildings`)
	TE_REGEN,         // + v hp / s
	TE_RELOAD,        // x v attack cooldown (multiplicative)
	TE_SPLASH,        // + v tiles of melee splash radius
	TE_DIVINE,        // + v damage per hit that no armor reduces
	TE_VS_BUILDINGS,  // + v to the damage multiplier vs buildings
	TE_VS_MYTH,       // + v to the damage multiplier vs myth units
	TE_ARROW_SPEED,   // + v x projectile speed (shorter flight)
	TE_TRACK,         // + v tiles an arrow follows a moving target (Ballistics)
	TE_POISON,        // arrows poison: POISON_DPS for POISON_TIME s
	TE_FRENZY,        // Harvest of Souls: after a kill +15 % damage, -20 % reload for 5 s
	TE_PIOUS,         // Pious Sacrifice: an infantry death speeds nearby soldiers' reload
	TE_HEAL_AURA,     // heroes heal own units within HYMN_RADIUS at v hp / s
	TE_TEMPLE_HEAL,   // temples heal up to 3 units within TEMPLE_HEAL_RADIUS at v hp / s
	TE_FAVOR,         // + v x favor rate (worship)
	TE_MARKET_FEE,    // + v to the market fee (negative)
	TE_TRIBUTE_FEE,   // + v to the tribute fee (negative)
	TE_OMNISCIENCE,   // the line of sight of every enemy unit and building
	TE_QUEUE_VIEW,    // Oracle: enemy training / research queues readable (UI)
	TE_ARMORY_DISCOUNT, // Forge of Olympus: Armory techs -75 % f/w/g, +50 % research speed
	TE_REVEAL,        // Sun Ray: an arrow reveals REVEAL_RADIUS round its hit for REVEAL_TIME s
	TE_COUNT
};

// unit type masks (bit per UnitType)
constexpr uint16_t UM(int t) { return (uint16_t)(1u << t); }
constexpr uint16_t M_VILLAGER = UM(U_VILLAGER);
constexpr uint16_t M_HOPLITE = UM(U_HOPLITE), M_TOXOTES = UM(U_TOXOTES), M_HIPPIKON = UM(U_HIPPIKON);
constexpr uint16_t M_HUMAN = M_HOPLITE | M_TOXOTES | M_HIPPIKON; // "human soldier"
constexpr uint16_t M_HERO = UM(U_HERO);
constexpr uint16_t M_MYTH = UM(U_MINOTAUR) | UM(U_CYCLOPS) | UM(U_CENTAUR) | UM(U_MEDUSA);
constexpr uint16_t M_ALL = (uint16_t)((1u << U_TYPE_COUNT) - 1);

struct TechEffect {
	uint8_t kind = TE_NONE;
	uint16_t units = 0;     // unit types it applies to
	bool buildings = false; // also the owner's shooting buildings / all buildings (sight)
	double v = 0;           // the value applied in this sim
	double retold = 0;      // Retold's number when it differs (distances scaled by DIST_SCALE), else = v
};

enum TechHome : uint8_t { TH_ARMORY, TH_MARKET, TH_TEMPLE };

struct TechDef {
	const char *key, *name;
	uint8_t home;      // TechHome
	int also;          // another building type that researches it (-1)
	int age;           // 0 Archaic .. 3 Mythic
	Cost cost;
	double time;
	int requires;      // TechId or -1
	const char *god;   // nullptr = generic; else the (minor, or `major`) god
	bool major;
	TechEffect eff[4];
	const char *missing; // nullptr, or the unit that does not exist in this game (the tech cannot be researched)
	const char *text;    // the effect as Retold states it
	const char *mapping; // how it maps onto this sim's stats ("" = as stated)
};
const TechDef &tech_def(int t);
int tech_of(const char *key); // -1 if unknown
int tech_home_building(int home); // B_ARMORY / B_MARKET / B_TEMPLE

constexpr int TECH_EVENT_BASE = 100; // tech:researched a = TECH_EVENT_BASE + TechId (fort stages: 1..6)
constexpr int TECH_QUEUE_MAX = 5;
// Retold distances (range, sight, radii) -> tiles here: this sim's ranges and
// sights are ~0.6 of Retold's (toxotes range 11 vs 18, sight 13 vs 22)
constexpr double DIST_SCALE = 0.6;
constexpr double ARROW_TRACK_BASE = 1.0; // tiles a human archer's / building's arrow follows a moving target
constexpr double POISON_DPS = 0.25, POISON_TIME = 6;
constexpr double FRENZY_TIME = 5, FRENZY_DAMAGE = 1.15, FRENZY_RELOAD = 0.8;
constexpr double PIOUS_TIME = 5, PIOUS_STEP = 0.1, PIOUS_RADIUS = 5 * DIST_SCALE;
constexpr int PIOUS_MAX = 5;
constexpr double HYMN_RADIUS = 5 * DIST_SCALE;
constexpr double TEMPLE_HEAL_RADIUS = 15 * DIST_SCALE;
constexpr int TEMPLE_HEAL_UNITS = 3;
constexpr double REVEAL_RADIUS = 25 * DIST_SCALE, REVEAL_TIME = 6, REVEAL_MERGE = 3; // Sun Ray: Retold's area 25 (a radius) x DIST_SCALE = 15 tiles
constexpr double ARMOR_CAP = 0.95;

// market
constexpr int MARKET_LOT = 100;
constexpr double MARKET_BASE = 100, MARKET_MIN = 25, MARKET_MAX = 1000;
constexpr double MARKET_STEP = 2;    // price points per lot bought / sold
constexpr double MARKET_DRIFT = 0.2; // price points per second back towards MARKET_BASE
constexpr double MARKET_FEE = 0.30;
constexpr double TRIBUTE_FEE = 0.20;
inline bool market_tradable(int res) { return res == RES_FOOD || res == RES_WOOD; }

// state of a tech for a player
enum TechState : uint8_t { TS_AVAILABLE, TS_LOCKED_AGE, TS_LOCKED_PREREQ, TS_LOCKED_GOD, TS_RESEARCHING, TS_QUEUED, TS_DONE, TS_UNAVAILABLE };
const char *tech_state_name(int s);

// Godot-only (rules on): the Temple trains the Greek myth units of Retold's
// minor gods that this game has models for: Minotaur (Athena), Cyclops
// (Ares), Centaur (Hermes) from the Classical Age, Medusa (Hera) from the
// Mythic Age (the browser's Temple trains the Minotaur alone, every unit's
// min_age is Classical). With a minor god chosen for that age
// (set_minor_god) only his unit; none chosen: every one (as the techs).
constexpr int RULES_TEMPLE_TRAINS[] = { U_MINOTAUR, U_CYCLOPS, U_CENTAUR, U_MEDUSA, -1 };
const char *myth_unit_god(int type); // "athena" / "ares" / "hermes" / "hera", nullptr = not a minor god's unit
int rules_min_age(int type);         // the unit's age with the rules on (Medusa: Mythic)
bool rules_trains(int building_type, int type); // the building's trains list with the rules on

// Retold's armor of the Armory, the Market and the Temple (TECHS.md: 40 %
// hack / 90 % pierce / 5 % crush), with the rules on in place of the
// browser's flat building factor (0.35, myth units 1.2)
constexpr double RETOLD_BLD_HACK = 0.40, RETOLD_BLD_PIERCE = 0.90, RETOLD_BLD_CRUSH = 0.05;
inline bool retold_armored(int building_type) { return building_type == B_ARMORY || building_type == B_MARKET || building_type == B_TEMPLE; }
// Retold's Temple with the rules on: 150 wood + 150 gold, 1200 hp (the browser: 150 + 50, 1500)
inline Cost rules_building_cost(int type) { return type == B_TEMPLE ? Cost(0, 150, 150, 0) : building_def(type).cost; }
inline double rules_building_hp(int type) { return type == B_TEMPLE ? 1200 : building_def(type).hp; }

// the Greek minor gods by age (index 1..3), Retold + the Demeter pack
const char *const *minor_gods(int age); // nullptr-terminated

struct TechMods {
	double attack[U_TYPE_COUNT] = {}, hack[U_TYPE_COUNT] = {}, pierce[U_TYPE_COUNT] = {}, hp[U_TYPE_COUNT] = {};
	double speed[U_TYPE_COUNT] = {}, range[U_TYPE_COUNT] = {}, sight[U_TYPE_COUNT] = {}, regen[U_TYPE_COUNT] = {};
	double reload[U_TYPE_COUNT], splash[U_TYPE_COUNT] = {}, divine[U_TYPE_COUNT] = {};
	double vs_buildings[U_TYPE_COUNT] = {}, vs_myth[U_TYPE_COUNT] = {}, arrow_speed[U_TYPE_COUNT] = {}, track[U_TYPE_COUNT] = {};
	bool poison[U_TYPE_COUNT] = {}, frenzy[U_TYPE_COUNT] = {}, reveal[U_TYPE_COUNT] = {};
	bool pious = false;
	double heal_aura = 0, temple_heal = 0;
	// buildings: arrows (Town Center, towers), sight
	double b_attack = 0, b_arrow_speed = 0, b_track = 0, b_sight = 0;
	double favor = 0, market_fee = 0, tribute_fee = 0;
	bool omniscience = false, queue_view = false, armory_discount = false;
	TechMods() { for (double &r : reload) r = 1; }
};

struct TechResult { bool ok = false; std::string reason; };
struct TradeResult { bool ok = false; std::string reason; double gold = 0, amount = 0; };

// a unit's current numbers with its owner's techs (the readout and the check)
struct UnitStats { double damage, hp, max_hp, speed, range, sight, hack_armor, pierce_armor, reload, splash, divine, regen, vs_buildings, vs_myth, track, arrow_speed; };

struct Reveal { int owner; double x, z, r, until; };

class Techs {
public:
	Sim *sim = nullptr;
	uint64_t done[MAX_PLAYERS] = {};
	TechMods mods[MAX_PLAYERS];
	std::string minor[MAX_PLAYERS][4]; // chosen minor god per age ("" = not chosen: every god's techs open)
	double price[RES_COUNT] = { MARKET_BASE, MARKET_BASE, MARKET_BASE, MARKET_BASE };
	std::vector<Reveal> reveals;
	// Retold: an Armory or a Market is needed for the Heroic Age (on by
	// default with the rules; set_tech_rules turns it off). The enemy AI
	// stops at the Classical Age, and builds an Armory there (enemy_ai_techs)
	bool heroic_needs_armory = true;
	int researched = 0; // techs completed this game (all players)

	void init(Sim *s);
	void update(double dt);

	bool is_done(int owner, int t) const { return owner >= 0 && owner < MAX_PLAYERS && t >= 0 && t < T_COUNT && ((done[owner] >> t) & 1); }
	int state(int owner, int t, std::string *reason = nullptr) const;
	bool researches_at(int building_type, int t) const;
	Cost cost_for(int owner, int t) const; // discounts, Omniscience's price
	double time_for(int owner, int t) const;
	TechResult research(int32_t building_id, int t);
	bool cancel(int32_t building_id, int index = -1); // -1 = the last queued
	int queued_at(int owner, int t, int32_t *building = nullptr, int *index = nullptr) const; // 0 no, 1 head (researching), 2 waiting
	// grant without cost / time (scenes, checks): applies the effects at once
	void grant(int owner, int t);
	TechResult set_minor_god(int owner, int age, const std::string &god);
	// may `owner` train myth unit `type` (his minor god for its age)? reason when not
	bool god_allows_unit(int owner, int type, std::string *reason = nullptr) const;
	// the multiplier on a blow / arrow against an Armory / Market / Temple (Retold armor)
	double building_armor_mult(const Hitter &a, uint8_t kind) const;

	// market and tribute
	double buy_price(int owner, int res) const;  // gold for MARKET_LOT
	double sell_price(int owner, int res) const; // gold for MARKET_LOT
	double fee(int owner) const;
	double tribute_fee(int owner) const;
	TradeResult buy(int32_t market_id, int res);
	TradeResult sell(int32_t market_id, int res);
	TradeResult tribute(int from, int to, int res, double amount);
	bool has_market(int owner) const;

	// combat / economy / fog hooks (only called with the rules on)
	double unit_damage(int urow) const;        // the unit's attack damage per blow / arrow
	double reload_mult(int urow) const;
	double range_add(int urow) const;
	double splash_add(int urow) const;
	double unit_armor(int trow, const Hitter &a, uint8_t kind) const;
	double vs_mult(int arow, int target_kind, int target_row) const;
	double divine(int arow) const;
	double building_attack(int owner) const { return 1 + mods[owner].b_attack; }
	double arrow_speed(const Hitter &a) const;     // projectile speed multiplier
	double arrow_track(const Hitter &a) const;     // tiles; < 0 = homing (myth units, heroes)
	void on_arrow_hit(const Hitter &a, int trow);  // poison, Sun Ray reveal
	double favor_mult(int owner) const { return 1 + mods[owner].favor; }
	double building_sight_add(int owner) const { return mods[owner].b_sight; }
	bool omniscient(int fog_owner) const;          // the fog owner or an ally has Omniscience
	bool training_paused(int brow) const;          // the building is researching
	UnitStats stats(int urow) const;

private:
	void finish(int brow, int t);
	void recompute(int owner);
	void apply_unit(int urow, const TechMods &old, const TechMods &cur);
	void on_died(int32_t id, int32_t killer, double x, double z);
	int pop_of_enemies(int owner) const;
	bool any_heal_ = false, any_poison_ = false;
};

} // namespace aov
