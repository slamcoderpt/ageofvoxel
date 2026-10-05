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
//   cap of 100, carry 15 food / 10 wood / 10 gold as Retold, LABORER_CARRY), separate drop sites (Granary food, Lumber Camp wood, Mining
//   Camp gold; the Town Center takes all), favor only from the five
//   Monuments (built in order, one each, a constant trickle), free Houses /
//   drop sites / Armory / Market, gold Town Center / Farm / Temple /
//   Barracks / Migdol / Siege Works / towers / walls.
// - The Pharaoh (one, free, 0 pop, respawns at the starting Town Center 90 s
//   after he dies) empowers the building he is ordered onto (O_EMPOWER):
//   +75 % build / train / research speed (not Laborers, not age-ups), +20 %
//   resources on each drop at a drop site, +20 % Monument favor (Isis +100 %), x0.75
//   reload on a building that shoots, +75 % Obelisk LOS. He and the Priests
//   heal (10 / 7.5 hp/s, half on a busy target); Ra's Priests empower at 60 %.
// - Major gods' Monument auras: Ra's Mandjet, Isis' Divine Shield (and her
//   Monuments' healing), Set's Devotees (constants below, Civs::auras).
// - Mapping Retold onto this sim (the browser's stats are AoM-scaled: hp and
//   damage as AoM, distances x0.6, speeds x~0.65): hp and damage as Retold,
//   speed x0.65 (a worker: x the Greek villager's ratio, 2.7 / 4.0), range and
//   LOS x0.6 (DIST_SCALE), reload x1.15 (the browser's soldiers reload ~15 %
//   slower than Retold's; every Egyptian unit, the Laborer too: ROF 1 ->
//   1.15 s, while the Greek villager keeps the browser's 1.5 s), armor: this sim's one value per unit becomes, for
//   Egyptian units, a hack and a pierce armor = Retold's x0.75 (a hoplite's
//   0.30 is Retold's ~40 % hack), crush (siege) vs units = Retold's 99 % crush
//   armor; Egyptian buildings with no Greek counterpart: Retold hp x1.25
//   (Town Center / Temple / Academy ratio 3000 / 2400 = 1500 / 1200),
//   footprint ~x1.2-1.5 (Monuments 2x2 / 3x3, Migdol 6x6, Siege Works 5x5),
//   Retold armor (hack / pierce / crush); shared types keep
//   the Greek building's hp and size (Retold gives both civs the same), take the
//   Egyptian cost and Retold's base build time where this sim's Greek one differs
//   (civ_build_time: Town Center, Farm, tower). Set's Animals of Set: below.
//   Population: the browser halves Retold's human-soldier pop, rounding up (Retold
//   hoplite / toxotes 2 -> 1, hippikon 3 -> 2; the villager keeps 1; both civs share
//   Retold's caps: TC 15, House 10, POP_MAX 300), so the Egyptian ones do too:
//   Spearman / Axeman / Slinger / Priest 2 -> 1, Chariot Archer / Camel Rider /
//   Siege Tower 3 -> 2, War Elephant / Catapult 5 -> 3; the Laborer 1, Mercenaries and
//   the Pharaoh 0 as Retold; the Animals of Set keep Retold's 1-2 (summoned for favor,
//   as the myth units, whose pop this sim does not halve). Ranged units stand and
//   shoot (no kiting) whatever the civ: at equal cost infantry that reaches them
//   wins (toxotes vs hoplites, Slingers or Chariot Archers vs Spearmen / Axemen).
//   Building limits (civ_building_limit, Retold): one of each Monument, 15 Migdols.
//   The shared types' Retold limits (House 16, Sentry Tower 30, one TC in the
//   Archaic Age) are not applied: this sim's Greeks have none and keep playing as today.
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
std::string unit_plural(int type);     // "Laborers", "Mercenaries", "Mercenary Cavalry"

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
// the most of a type a civ may own (standing + foundations), 0 = no limit (rules on)
int civ_building_limit(int civ, int btype);
constexpr int MIGDOL_LIMIT = 15;
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
// Carry capacity (Retold, EGYPT.md 1.2): a Laborer carries 15 food, 10 wood,
// 10 gold; a Greek villager 10 of each (units/defs.h carry_cap). The +5 per
// wood / gold tech and +15 food with Husbandry are not in this game (no
// gather techs exist here for either civ: Husbandry, Hand Axe, Pickaxe ...).
constexpr double LABORER_CARRY[3] = { 15, 10, 10 }; // food, wood, gold
// What a unit carries of resource rt (RES_FOOD..RES_GOLD) before it walks to
// drop it: the def's carry_cap (10 if none), the Laborer's per resource.
inline double unit_carry_cap(int utype, int rt) {
	if (utype == U_LABORER && rt >= RES_FOOD && rt <= RES_GOLD) return LABORER_CARRY[rt];
	const double c = unit_def(utype).carry_cap;
	return c != 0 ? c : 10;
}
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
// major gods' passive bonuses (EGYPT.md 4)
constexpr double RA_BERRIES = 1.30, RA_CAMEL_HP = 1.15, SET_INFANTRY_SPEED = 1.05, SET_MILITARY_GOLD = 0.75, ISIS_TECH_COST = 0.90;
constexpr int ISIS_TC_POP = 5;
// major gods' Monument auras (EGYPT.md 1.4 and 4; Retold metres x DIST_SCALE 0.6,
// measured from the Monument's footprint)
constexpr double MANDJET_RANGE = 30 * 0.6;     // Ra: a Pharaoh-empowered Monument empowers every own building
constexpr double MANDJET_STRENGTH = 0.6;       //   (other Monuments too) within 18 tiles at 60 %; no stacking
constexpr double SHIELD_RANGE = 25 * 0.6;      // Isis' Divine Shield: no enemy god power within 15 tiles of a Monument,
constexpr double SHIELD_RANGE_EMPOWERED = 50 * 0.6; //   30 when empowered; an empowered one heals units in 30 tiles
constexpr double ISIS_MONUMENT_HEAL = 1.0;     //   at 1 hp/s (half if busy, stacks across Monuments)
constexpr double ISIS_EMPOWER_FAVOR = 1.0;     //   and its favor is +100 % (not +20 %)
constexpr double DEVOTEES_RANGE = 30 * 0.6;    // Set's Devotees: Barracks / Migdol within 18 tiles of a Monument (EGYPT.md
constexpr double DEVOTEES_COST = 0.90;         //   gives no distance: Mandjet's 30 m) train at -10 % cost; no stacking
constexpr double LABORER_VS_TOWER = 4;         // Retold: Laborers x4 vs towers
// Egyptian starting stockpile (Retold 200 f / 100 w / 50 g / 0 favor) against the
// Greek one of this sim's "standard" (300 / 300 / 200 / 20): the setup's stockpile
// x these factors ("low" / "standard" / "high"); "deathmatch" keeps its 10000s
constexpr double EGYPT_START_RES[4] = { 200.0 / 300, 100.0 / 300, 50.0 / 200, 0 };
constexpr double FAVOR_CAP = 200;        // the Greek favor cap of this sim
constexpr double SIEGE_CRUSH_ARMOR = 0.05; // a browser building's crush armor vs siege (Retold buildings: 5-10 %)

// ---- Set's Animals of Set (EGYPT.md 1.5, 1.6, 3.2, 4 Set; the Retold wiki's Animal of Set
// tables for the numbers EGYPT.md leaves out) ------------------------------------------------
// - Set's Pharaoh summons them for favor (Civs::summon): one at a time per Pharaoh, a few
//   seconds each, while he keeps doing whatever he does (no order: a queue of his own);
//   which ones grows with the age (Archaic Baboon; Classical Gazelle, Hyena; Heroic
//   Giraffe, Crocodile; Mythic Hippopotamus, Rhinoceros, Elephant).
// - Each age-up gives 3 at the Temple (Classical 2 Gazelles + 1 Hyena, Heroic 2 Giraffes +
//   1 Crocodile, Mythic 2 Hippos + 1 Rhino; none built: the home Town Center).
// - Set's Priests convert a wild animal (O_CONVERT, range 10 x0.6): this sim's deer and boar
//   become a Deer / Boar of Set after Retold's 35 / 50 s, keeping 75 % of their food.
// - An Animal of Set that dies leaves a carcass with its food (Laborers butcher it); in the
//   Archaic Age they hit at 10 % (Retold); x0.5 vs buildings (the Elephant x1.5); Laborers
//   shoot them with their anti-animal bow (12 pierce, range 12 x0.6, ROF 2 x1.15).
struct SetAnimal {
	int age;              // summon age (-1: not summoned: converted only)
	double food;          // the carcass it leaves
	int wild;             // converted from (R_DEER / R_BOAR), -1 none
};
const SetAnimal *set_animal(int type); // nullptr: not an Animal of Set
constexpr int SET_SUMMONS[] = { U_BABOON, U_GAZELLE_OF_SET, U_HYENA_OF_SET, U_GIRAFFE_OF_SET, U_CROCODILE_OF_SET,
	U_HIPPO_OF_SET, U_RHINO_OF_SET, U_ELEPHANT_OF_SET, -1 };
// the age-up gift at the Temple, per age reached (1 Classical .. 3 Mythic), -1 terminated
const int *set_age_animals(int age);
int converted_type(int wild_res_type);        // R_DEER -> U_DEER_OF_SET, R_BOAR -> U_BOAR_OF_SET, -1 none
constexpr double CONVERT_RANGE = 10 * 0.6;    // Retold 10 x DIST_SCALE
constexpr double CONVERT_FOOD = 0.75;         // a converted animal keeps 75 % of its food
constexpr double SET_ANIMAL_ARCHAIC = 0.1;    // Archaic: -90 % attack
constexpr int SUMMON_QUEUE = 5;               // per Pharaoh
constexpr double LABORER_BOW_DAMAGE = 12;     // Laborers vs animals: 12 pierce,
constexpr double LABORER_BOW_RANGE = 12 * 0.6; //   range 12,
constexpr double LABORER_BOW_RELOAD = 2 * 1.15; //   ROF 2
// Egyptian costs of the fortification stages where Retold gives them their own (fortify.h FT_*)
Cost civ_fort_tech_cost(int civ, int tech);
// Egyptian base build times of the shared types where Retold differs from this sim's Greek
// one (Town Center 150, Farm 10, Sentry Tower 60); 0 = the def's
double civ_build_time(int civ, int btype);

struct Summon { int owner; int32_t pharaoh; uint8_t type; double t, total; Cost paid; };

struct CivStart { int32_t tc = 0, pharaoh = 0, priest = 0, baboon = 0; std::vector<int32_t> workers; };
struct SceneCtx;
SceneCtx egypt_scene_setup(Sim &sim); // the "egypt" scene (egypt_scene.cpp; scenes::setup dispatches)
SceneCtx egypt_set_scene_setup(Sim &sim); // the "egypt_set" scene: Set's Animals of Set

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
	double isis_healed[MAX_PLAYERS] = {}; // hp Isis' empowered Monuments healed this game (checks, readout)
	double devotee_saved[MAX_PLAYERS] = {}; // resources Set's Devotees saved this game
	int shield_refused[MAX_PLAYERS] = {}; // enemy god powers Isis' shields refused (per shield owner)
	int summoned[MAX_PLAYERS] = {};       // Animals of Set summoned by the Pharaoh this game
	int converted[MAX_PLAYERS] = {};      // wild animals Set's Priests converted
	int age_gift[MAX_PLAYERS] = {};       // Animals of Set the age-ups gave
	double carcass_food[MAX_PLAYERS] = {}; // food the dead Animals of Set left
	std::vector<Summon> summons;          // queued summons, in order (the head of each Pharaoh's runs)
	// per building row, rebuilt each tick: the Monument (id) whose Mandjet empowers it (0 = none)
	std::vector<int32_t> mandjet_by;

	void init(Sim *s);
	void update(double dt); // rules on: empower, Monument favor, healing, Mercenary decay, Pharaoh respawn, hero ages

	int civ(int owner) const;
	bool rules() const;
	bool god_is(int owner, const char *god) const; // the owner's major god (lower case)
	// the owner's cost of a building (civ_building_cost plus the major god: Set's
	// Barracks / Siege Works / Migdol -25 % gold, Isis' Obelisk 5 gold)
	Cost cost(int owner, int btype) const;
	int pop_bonus(int owner, int btype) const;      // Isis: a Town Center +5
	double gather_bonus(int urow, int res_type_node) const; // Ra: Laborers on berries +30 %
	double tech_cost_mult(int owner) const;         // Isis: techs -10 % food / wood / gold
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
	// the major gods' Monument auras
	double rect_dist(int brow, double x, double z) const; // from a point to the building's footprint (0 inside)
	double shield_radius(int brow) const;          // Isis' Monument: 15 / 30 tiles (0: not a shield)
	// Divine Shield: may `caster` cast a god power at (x, z)? false: the shielding Monument's id in *by
	bool shield_allows(int caster, double x, double z, std::string *why = nullptr, int32_t *by = nullptr) const;
	// Devotees: the cost factor of a unit trained at building row b (1, or 0.9 for Set's Barracks / Migdol near a Monument)
	double train_cost_mult(int brow, int utype) const;
	int32_t devotee_monument(int brow) const;      // the Monument giving Devotees to that building, 0 none
	double empower_favor(int owner) const;         // +20 % (Isis +100 %) per unit of empowerment
	double empower_strength(int urow) const;

	// Set's Animals of Set
	bool can_summon(int owner, int type, std::string *why = nullptr) const; // age, god, favor, pop
	bool summon(int urow, int type, std::string *why = nullptr);  // Set's Pharaoh: queue a summon (pays)
	int summon_pop(int owner) const;              // pop of the queued summons (Economy::recount)
	bool can_convert(int urow) const;             // a Priest of Set
	bool laborer_bow(int urow, int32_t target) const; // a Laborer shooting an Animal of Set
	// the age changed outside an age-up (AovSim.set_player_age): the per-age steps
	void age_set(int owner, int from, int to);
	std::vector<int32_t> age_gift_spawn(int owner, int age); // the 3 animals at the Temple

private:
	void on_age(int owner);
	void update_set(double dt);                   // summons, conversions
	void hero_age_stats(int urow, int from_age, int to_age);
	void auras(double dt);                         // Mandjet, Isis' Monument healing
};

} // namespace aov
