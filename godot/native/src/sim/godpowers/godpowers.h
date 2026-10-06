// God powers, simulation half: port of the sim side of src/godpowers/index.js:
// favor costs and cooldowns, Zeus's Lightning Storm (a whirlwind that strikes
// enemy units at random, snatches men off their feet, carries them round
// the funnel and flings them out) and Bolt (one strike that slays a
// target), Hephaestus's Meteor, lightning damage and splash, units thrown by
// a strike (knockback, tumbling, landing). Bit-exact with the browser
// (scripts/check-sim.mjs).
//
// Thrown units carry air_y (height above the ground) and air_rx / air_rz
// (tumble) in their unit columns, read by the units renderer.
//
// The lists the renderer draws from (bolts, scorches, zaps, meteors, fires)
// are kept here with their seeds; the voxel debris, sparks, smoke and the
// bolt channels (boltLines) are visual and belong to game/godpowers.
// Deviation: cosmetic randomness (sky bolts) uses its own RNG like the JS
// vrng, but the JS also draws it for smoke and flames, so sky-bolt timing
// differs from the browser. It never touches the sim.
#pragma once
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "../core/players.h"
#include "../core/rng.h"

namespace aov {

class Sim;
struct Event;

// GP_RAIN .. GP_THOTH_METEOR: the Egyptian gods' powers (Godot-only, behind Sim::godot_rules;
// egypt_powers.cpp, EGYPT.md 4, 5 with Retold's numbers; see PORTING.md "The Egyptian gods").
// With the rules on a player casts only his gods' powers (has_power): a Greek the three
// Greek ones (as today), an Egyptian his major god's Archaic power and the power of each
// minor god he took, from that god's age. Retold's model for them: a favor cost that ramps
// by `ramp` with every cast, a recharge (cooldown) after each cast, no limit of uses.
enum PowerId : uint8_t { GP_LIGHTNING_STORM, GP_BOLT, GP_METEOR,
	GP_RAIN, GP_PROSPERITY, GP_VISION, GP_ECLIPSE, GP_SHIFTING_SANDS, GP_PLAGUE_OF_SERPENTS, GP_LOCUST_SWARM,
	GP_CITADEL, GP_ANCESTORS, GP_SON_OF_OSIRIS, GP_TORNADO, GP_THOTH_METEOR, GP_COUNT };
constexpr int GP_GREEK_COUNT = 3;
inline bool is_egypt_power(int id) { return id >= GP_RAIN && id < GP_COUNT; }
// how a power is aimed: a point; global (the point is ignored); two points (from, to: Shifting
// Sands' destination, Locust Swarm's direction); an own Town Center; an own Pharaoh
enum PowerTarget : uint8_t { PT_POINT, PT_GLOBAL, PT_TWO_POINTS, PT_OWN_TC, PT_OWN_PHARAOH };

struct PowerDef {
	const char *key, *name, *god;
	Cost cost;
	double cooldown, radius, duration, interval, damage, splash, delay;
	const char *hotkey, *desc;
	// (the Egyptian powers) favor added per cast, the god's age, the aim
	double ramp = 0;
	int age = 0;
	uint8_t target = PT_POINT;
	const char *retold = "", *mapping = "";
};

// ---- the Egyptian powers' numbers (Retold metres x DIST_SCALE 0.6, speeds x0.65) ----------
constexpr double RAIN_FARM = 2.5;            // Rain: the caster's farming +150 % for 50 s
constexpr double PROSPERITY_GOLD = 1.5;      // Prosperity: gold mining +50 % for 75 s
constexpr double VISION_R0 = 10 * 0.6, VISION_GROW = 15 * 0.6; // Vision: 10 m growing 15 m/s to 70 m
constexpr double ECLIPSE_DAMAGE = 1.2, ECLIPSE_SPEED = 1.15, ECLIPSE_ARMOR = 0.10, ECLIPSE_FAVOR = 1.5, ECLIPSE_RECHARGE = 0.4;
constexpr double SANDS_MIN_DIST = 40 * 0.6;  // Shifting Sands: the destination at least 40 m away
constexpr int SERPENTS = 14, SERPENT_WAVE = 2; // Plague of Serpents: 2 at once, then 2 every 3 s
constexpr double SERPENT_EVERY = 3, SERPENT_GUARD = 6;
constexpr int SWARMS = 5;                    // Locust Swarm: 5 swarms at 3 m/s for 20 s,
constexpr double SWARM_SPEED = 3 * 0.65, SWARM_DPS = 3.5, SWARM_FARM = 6, SWARM_OWN = 0.1, SWARM_TICK = 0.25; // 3.5 divine/s in 6 m
constexpr double CITADEL_HP = 1200, CITADEL_ATTACK = 1.2, CITADEL_SIGHT = 1 * 0.6, CITADEL_WORK = 1.25;
constexpr int CITADEL_POP = 10;
constexpr int MINIONS = 13;                  // Ancestors: 13 Minions over 13 s, dead 60 s after the cast
constexpr double MINION_LIFE = 60;
constexpr double TORNADO_HACK = 25, TORNADO_CRUSH = 100, TORNADO_EVERY = 0.5, TORNADO_FULL = 5 * 0.6, TORNADO_SLOW = 0.65,
	TORNADO_SLOW_TIME = 6, TORNADO_SPEED = 2.5, TORNADO_SPIRAL = 1.2, TORNADO_OWN = 0.1, TORNADO_FARM = 0.1, TORNADO_LOS = 20 * 0.6;
constexpr int THOTH_METEORS = 12;            // Thoth's Meteor: 12 meteors in a 25 m circle,
constexpr double THOTH_FIRST = 3, THOTH_REST = 6, THOTH_STEP = 1.0, THOTH_AREA = 8 * 0.6, THOTH_CRUSH = 580, THOTH_DIVINE = 40, THOTH_OWN = 0.1;
constexpr double UNIT_CRUSH_ARMOR = 0.99, MYTH_CRUSH_ARMOR = 0.80, SIEGE_UNIT_CRUSH_ARMOR = 0.85; // Retold's crush armor of units
// DoTs (sim/godpowers egypt_myth.cpp): exact damage per second
enum DotKind : uint8_t { DOT_POISON, DOT_VENOM, DOT_STING, DOT_CURSE };
const PowerDef &power_def(int id);
int power_of(const char *key); // -1 if unknown

struct Storm {
	int owner;
	double x, z, t0, duration, radius, next, sky;
	bool done = false;
};
struct Bolt { double x, y, z, t0, life; uint32_t seed; bool sky; };
struct Scorch { double x, y, z, t0; uint32_t seed; double size; bool blast; };
struct Zap { int32_t unit; double x, y, z, t0, life; uint32_t seed; };
struct Meteor { int owner; double x, z, t0, delay, radius, sx, sy, sz; bool done = false; int kind = 0; /* 1: Thoth's */ };
struct Fire { double x, y, z, r, t0, dur; bool done = false; };

struct CastCheck { bool ok; std::string reason; };

// ---- the Egyptian powers' state (also what game/godpowers draws) ---------------------------
struct TimedPower { int owner = 0; double t0 = 0, until = 0; };      // Rain, Prosperity, Eclipse
struct VisionCast { int owner; double x, z, t0, dur, r; };
struct SandsCast { int owner; double sx, sz, dx, dz, t0, delay, radius; bool done = false; int moved = 0; };
struct SpawnCast { int owner; int id; double x, z, t0; int spawned = 0, total = 0; double die_at = -1; std::vector<int32_t> units; };
struct Swarm { int owner; double x0, z0, dx, dz, t0, dur, radius, acc = 0; uint32_t seed; bool done = false; };
struct CitadelCast { int32_t building; double x, z, t0; };
struct SonCast { int owner; int32_t unit; double x, z, t0; };
struct Tornado { int owner; double cx, cz, t0, dur, x, z, a0, next = 0; bool done = false; };
struct ThothCast { int owner; double cx, cz, t0, radius; int launched = 0; std::vector<double> hit_x, hit_z; bool done = false; };
struct RiseFx { uint8_t kind; double x, z, t0; int owner; int32_t unit; }; // 0 serpent, 1 minion, 2 egg, 3 hatch, 4 caustic burst, 5 son
struct Arc { double x0, y0, z0, x1, y1, z1, t0; uint32_t seed; };    // the Son of Osiris' chain lightning
struct Dot { int32_t target; int owner; double dps, until, acc; uint8_t kind; };
struct Aura { int32_t unit; int owner; double radius, dps, until, acc; uint8_t kind; }; // 0 whirlwind, 1 spin
struct Sting { int32_t unit; int owner; double at; int left; };
struct AbilityFx { uint8_t kind; int32_t unit, target; double x0, z0, x1, z1, t0, dur; }; // 0 jump, 1 whirlwind, 2 spin, 3 sting, 4 curse, 5 beam
struct Egg { int32_t egg; int owner; double hatch_at; };

class GodPowers {
public:
	Sim *sim = nullptr;
	std::vector<Storm> storms; // never shrunk (thrown units refer to their storm by index)
	std::vector<Bolt> bolts;
	std::vector<Scorch> scorches;
	std::vector<Zap> zaps;
	std::vector<Meteor> meteors;
	std::vector<Fire> fires;
	std::vector<int32_t> airborne; // unit ids
	double cooldowns[MAX_PLAYERS][GP_COUNT] = {};
	RNG vrng{ 8675309 };
	// (the Egyptian powers, egypt_powers.cpp)
	int casts[MAX_PLAYERS][GP_COUNT] = {};
	TimedPower rain[MAX_PLAYERS], prosperity[MAX_PLAYERS], eclipse;
	std::vector<VisionCast> visions;
	std::vector<SandsCast> sands;
	std::vector<SpawnCast> serpents, ancestors;
	std::vector<Swarm> swarms;
	std::vector<int32_t> citadels; // Town Centers made Citadel Centers (ids)
	std::vector<CitadelCast> citadel_fx;
	std::vector<SonCast> sons;
	std::vector<Tornado> tornadoes;
	std::vector<ThothCast> thoth;
	std::vector<RiseFx> rises;
	std::vector<Arc> arcs;
	// (the myth units' abilities, egypt_myth.cpp)
	std::vector<Dot> dots;
	std::vector<Aura> auras;
	std::vector<Sting> stings;
	std::vector<AbilityFx> ability_fx;
	std::vector<Egg> eggs;
	std::vector<std::pair<int32_t, double>> ability_cd; // unit id -> ability ready at (sorted by id)
	std::vector<std::pair<int32_t, double>> speed_k;    // unit id -> speed factor applied (sorted by id)
	std::vector<std::pair<int32_t, double>> slowed;     // unit id -> slowed until (Tornado)
	std::vector<int32_t> uncontrolled;                  // the Serpents (no orders from their owner)
	std::string last_reason;                            // why the last cast was refused
	// counters for the checks (egypt_gods_check.gd)
	double power_damage[MAX_PLAYERS] = {}, farm_damage[MAX_PLAYERS] = {}, building_damage[MAX_PLAYERS] = {};
	int teleported[MAX_PLAYERS] = {}, spawned[MAX_PLAYERS] = {}, thrown[MAX_PLAYERS] = {}, meteors_landed[MAX_PLAYERS] = {};
	double rain_food[MAX_PLAYERS] = {}, prosperity_gold[MAX_PLAYERS] = {};
	int minions_raised[MAX_PLAYERS] = {}, eggs_hatched[MAX_PLAYERS] = {}, chained[MAX_PLAYERS] = {};

	void init(Sim *s);
	double cooldown_left(int owner, int id) const;
	CastCheck can_cast(int owner, int id) const;
	// (the Egyptian gods) does the player have this power (civ, gods, age)? its favor cost now
	bool has_power(int owner, int id) const;
	double power_cost(int owner, int id) const;
	double power_cooldown_of(int owner, int id) const; // the recharge after a cast (Clairvoyance)
	std::vector<int> player_powers(int owner) const;   // in hotkey order
	// a two-point cast (Shifting Sands: from -> to; Locust Swarm: at -> direction); cast() of
	// such a power without one: Locust Swarm heads away from the caster's nearest building,
	// Shifting Sands is refused
	bool cast2(int owner, int id, double x, double z, double x2, double z2);
	// would a cast at (x, z) work? (the target checks of the aimed powers)
	CastCheck cast_check(int owner, int id, double x, double z, double x2 = NAN, double z2 = NAN) const;
	// hooks (rules on)
	double gather_mult(int urow, bool farm, int res, int node_type) const; // Rain, Prosperity
	double damage_mult(int urow) const;   // Eclipse
	double armor_add(int urow) const;     // Eclipse
	double favor_mult(int owner) const;   // Eclipse
	double work_mult(int brow) const;     // the Citadel
	double age_mult(int owner) const;     // the Citadel (the owner's age-up)
	int pop_bonus(int brow) const;        // the Citadel
	double building_attack_mult(int brow) const;
	void extra_arrows(int brow, int target_row, double damage);
	bool is_citadel(int brow) const;
	bool is_uncontrolled(int32_t unit) const;
	void add_dot(int32_t target, int owner, double dps, double dur, uint8_t kind);
	double ability_ready(int32_t unit) const; // game time its ability is ready (0 = now)
	// Bounds: a target off the map is clamped onto its edge tile
	// (GameMap::clamp_to_map, a target on the map is untouched); a NaN target
	// is refused (false, no favor paid, no cooldown).
	bool cast(int owner, int id, double x, double z);
	void update(double dt);

	// findTarget(owner, x, z, r, random, grounded): unit row or -1
	int find_target(int owner, double x, double z, double r, bool random = false, bool grounded = false);
	void strike(int owner, double x, double z, double damage, double splash, int target_row);
	void knock(int row, double x, double z, double power);

private:
	void zap(int row);
	// the Egyptian powers (egypt_powers.cpp) and the myth units' abilities (egypt_myth.cpp)
	bool cast_egypt(int owner, int id, double x, double z, double x2, double z2, bool two);
	void init_egypt();
	std::string power_lock(int owner, int id) const;
	void update_egypt(double dt);
	void update_myth(double dt);
	void on_myth_damaged(const Event &e);
	void on_myth_died(int32_t id, double x, double z);
	void impact_thoth(const Meteor &m);
	void power_hit(int owner, int32_t target, double amount, double farm_mult = 1, double own_mult = 0.1);
	int nearest_own(int owner, int btype_or_utype, bool building, double x, double z, double r) const;
	void set_ability_cd(int32_t unit, double at);
	void speeds();
	bool any_myth_ = false;
	int myth_scan_ = 0;
	void impact_meteor(const Meteor &m);
	void vortex(int storm, double dt);
	void update_airborne(double dt);
	void add_airborne(int row);
	std::vector<int> near(double x, double z, double r, int owner, int32_t exclude_id = 0); // living enemy unit rows
};

} // namespace aov
