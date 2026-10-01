// Scripted opponent (port of src/combat/EnemyAI.js): keeps villagers busy
// (balancing food / wood / gold, farms when the berries run out), trains
// more, builds houses, a military academy and a temple, trains an army and
// minotaurs, advances to the Classical Age and sends attack waves at the
// nearest enemy building. Deterministic (sim rng only). One instance per AI
// player (Combat::ais).
#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

namespace aov {

class Sim;

// One launched attack wave (debug / report record, never read by the sim).
struct WaveLog {
	double t;            // launch time
	int32_t target;      // building id it was sent at
	double tx, tz;       // that building's centre
	std::vector<int32_t> units;
};

// AI difficulty (Godot-only, set by the match setup: AovSim.setup_match /
// set_ai {difficulty}). MODERATE is the browser's EnemyAI unchanged (the
// defaults below); the others change how fast it grows and fights:
// villager cap and training rate, when it builds its academy / temple /
// a second academy, the academy queue, the first wave, wave size and
// growth, the interval between waves (aggression), how often and how
// eagerly it casts god powers, when it advances; Titan also gathers 20 %
// faster and starts with a bonus stockpile (Player::gather_mult, the
// match setup). All deterministic: the same seeded RNG, no extra draws.
enum AIDifficulty : int8_t { AI_DEFAULT = -1, AI_EASY = 0, AI_MODERATE = 1, AI_HARD = 2, AI_TITAN = 3 };
const char *ai_difficulty_name(int d);
int ai_difficulty_of(const char *name); // "easy" .. "titan"; anything else: AI_DEFAULT

struct AIParams {
	double think = 1;         // s between decisions
	int max_villagers = 22;   // trains villagers up to this many
	int villager_queue = 2;   // at the Town Center
	int academy_at = 10;      // villagers before the military academy
	int temple_at = 14;       // ... the temple
	int academy2_at = 0;      // ... a second academy (0: never)
	int army_queue = 3;       // per academy
	int wave_size = 8;        // first wave
	int wave_grow = 4;        // men added per wave
	int wave_max = 40;
	double first_wave = 240;  // s
	double aggression = 1;    // waves every 120 / aggression s
	double power_every = 2;   // s between god power decisions (0: never casts)
	int storm_min = 6;        // enemy men a Lightning Storm must catch
	double age_after = 0;     // earliest time it advances to the Classical Age
	int worshippers = 3;      // villagers kept worshipping at the temple (favor)
	int house_margin = 4;     // builds a house when the free population is below this
	bool army_while_saving = false; // keeps training soldiers while it saves for the next age
	double food_share = 0;    // workers on food (0: the browser's 0.5 / 0.3 / 0.2 split)
	double gold_share = 0.2;  // ... on gold (with food_share)
	double bank_cap = 1e9;    // gold / wood beyond this: fewer workers on it
	double gather_mult = 1;   // Titan's economy bonus (Player::gather_mult)
	double bonus_res = 0;     // Titan: added to each starting resource (food, wood, gold)
	// fortifications (Godot-only, sim/fortify; enemy_ai_fort.cpp)
	int towers_max = 1;       // towers it builds (by its Town Center, then its gold and wood)
	int tower_at = 16;        // villagers before the first tower
	bool tower_upgrade = true; // researches Watch Tower in the Classical Age
	bool walls = false;       // walls its base in (a ring with gates) from wall_at
	double wall_at = 1e9;     // s
	int wall_builders = 0;    // villagers kept on the ring while it goes up
	bool wall_upgrade = false; // researches Stone Wall in the Classical Age
	int repairers = 2;        // villagers sent to repair a damaged fortification
	bool tower_fear = true;   // a weak wave keeps out of enemy tower range
	bool breach_focus = true; // wall breakers close together hit one piece
};
AIParams ai_params(int difficulty);

// What the AI did with fortifications (AovSim.get_ai().fort; never read by the sim).
struct AIFortStats {
	int towers = 0;       // towers placed
	int wall_lines = 0;   // ring lines placed
	int wall_tiles = 0;   // wall tiles placed
	int gates = 0;        // gates converted
	int upgrades = 0;     // fortification techs started
	int repairs = 0;      // repair orders given
	int focus = 0;        // wall breakers turned onto their group's chosen piece
	int avoided = 0;      // wave targets skipped / waves held for enemy towers
	int retreats = 0;     // weak waves pulled back out of tower range
	int reopened = 0;     // own ring found closed and reopened
	int patched = 0;      // ring tiles walled later (where trees / berries stood)
	int dropped = 0;      // ring foundations nobody could reach, pulled down
	int sieges = 0;       // groups of our men found walled off from their target and set on one wall piece
	int sieged = 0;       // ... men so ordered
	int breached = 0;     // wall pieces a siege picked that fell
	int retargets = 0;    // walled-off groups with no piece to get at sent at another enemy building they can reach
	int regroups = 0;     // walled-off groups of bowmen alone sent home (to march with the next wave)
	int storehouses = 0;  // storehouses placed by a far wood line / mine (Godot AI economy)
	int upgrade_holds = 0; // thinks the academies waited for a fortification tech's wood / gold
	double ring_at = -1, ring_done_at = -1;
};

// A gate opening left in the AI's wall ring: filled with a segment and
// turned into a gate once the ring stands.
struct AIGateGap {
	int tx0, tz0, tx1, tz1; // the gap's tiles (a line of 3)
	int state = 0;          // 0 open, 1 filled (segment rising), 2 gate, 3 given up (left open), 4 walled (no gate fits)
	int32_t seg = 0;        // the filling segment
	double retry_t = 0;     // state 3: when the opening is tried again (Godot AI: no hole left in the ring for good)
};

class EnemyAI {
public:
	Sim *sim = nullptr;
	int owner = 2;
	bool enabled = true;
	double timer = 0;
	int wave_size = 8;
	double next_wave_at = 240; // s of game time before the first wave may launch
	double aggression = 1;
	std::vector<WaveLog> waves; // every wave launched (AovSim.get_ai().waves)
	double power_timer = 0;     // s until the next god power decision
	int casts[3] = { 0, 0, 0 }; // powers cast, by PowerId (AovSim.get_ai().casts)
	int difficulty = AI_DEFAULT;
	AIParams par;               // ai_params(difficulty)
	// set the difficulty (params, wave size / timing, aggression); the
	// player's gather bonus is the match setup's (it owns the Player)
	void set_difficulty(int d);

	AIFortStats fort;           // (AovSim.get_ai().fort)
	// Godot-only (stress scene): towers and a finished wall ring with gates
	// round its Town Center at once (paid); returns the pieces placed
	int fortify_now(int towers);
	const std::vector<AIGateGap> &gate_gaps() const { return gaps_; }
	int ring_state() const { return ring_state_; }
	int ring_radius() const { return ring_r_; }
	int ring_lines_left() const { return (int)ring_lines_.size(); }
	double ring_line_wood() const { return line_wood_; }
	double ring_line_gold() const { return line_gold_; }
	int ring_unbuilt() const; // pieces of the ring still going up

	EnemyAI() = default;
	EnemyAI(Sim *s, int owner_) : sim(s), owner(owner_) {}
	void update(double dt);

private:
	bool assign(int vrow, int res, int tc_row, const std::vector<int> &buildings);
	int pick_builder(const std::vector<int> &vills) const;
	int find_target(int tc_row) const; // building row or -1
	bool try_build(int type, int builder_row, int tc_row);
	bool find_spot(int type, int tc_row, int &tx, int &tz);
	bool gap_ok(int tx, int tz, int w, int h) const;
	void use_powers(const std::vector<int> &army, const std::vector<int> &buildings);
	std::vector<uint8_t> reach_; // scratch: cells in reach of our army / base
	void storehouses(int tc, const std::vector<int> &vills, const std::vector<int> &buildings); // Godot-only
	double store_t_ = 0;        // s until the next storehouse check
	std::vector<std::pair<int32_t, double>> farm_tries_; // Godot-only: farm foundation -> first time a villager was sent to finish it

	// fortifications (Godot-only, enemy_ai_fort.cpp)
	void fortify(int tc, const std::vector<int> &vills, const std::vector<int> &army, const std::vector<int> &buildings, bool saving);
	bool build_tower(int tc, const std::vector<int> &vills, bool instant);
	bool tower_spot(int tc, int k, int &tx, int &tz) const;
	bool plan_ring(int tc);
	bool place_ring_line(bool instant, const std::vector<int> &builders);
	void ring_gates(bool instant);
	void ring_builders(const std::vector<int> &vills);
	void check_ring_open(int tc);
	void repair(const std::vector<int> &vills, const std::vector<int> &buildings);
	void upgrade(const std::vector<int> &buildings, bool saving);
	void focus_breach(const std::vector<int> &army);
	void siege(const std::vector<int> &army, int tc);
	double siege_t_ = 0;          // s until the next siege check
	std::vector<int32_t> siege_picks_; // wall pieces a siege set our men on (kept till they fall)
	struct SiegeWatch { int32_t id; double hp, since; };
	std::vector<SiegeWatch> siege_watch_; // ... their hp and since when it has not gone down
	std::vector<std::pair<int32_t, double>> siege_ban_; // pieces given up (no man could get at them) -> until
	bool hole_wait_ = false;      // a hole in the ring waits for wood / gold (the academies wait)
	bool upgrade_wait_ = false;   // a fortification tech waits for wood / gold (the academies wait)
	double upgrade_wait_t_ = 0;   // s it has waited for the current tech
	void avoid_towers();
	int towers_covering(double x, double z, double margin) const; // enemy towers in range of a point
	bool reserved(int tx, int tz, int w, int h) const; // a rect on a gate opening or its approach
	int pick_target(int tc, int men, bool overdue); // find_target with tower fear (-1: hold the wave)
	bool wall_saving(int army) const; // the next ring line or tower waits for wood the army would spend
	double line_wood_ = 0, line_gold_ = 0; // what the next ring line costs (0: none waiting)
	double line_wait_since_ = -1; // when the next ring line started waiting for wood / gold (-1: not waiting)
	bool want_gold_ = false;    // a tower waits for gold (more hands on gold)
	bool tower_wait_ = false;   // a tower waits for wood / gold
	int tower_fail_ = 0;        // thinks a tower was paid for but found no spot
	int ring_state_ = 0;        // 0 none, 1 lines going up, 2 gates, 3 done
	int ring_cx_ = 0, ring_cz_ = 0, ring_r_ = 0;
	std::vector<std::array<int, 4>> ring_lines_; // tile ends of each line still to place
	std::vector<std::array<int, 4>> ring_plan_;  // every line of the ring (holes left by trees / berries are patched)
	size_t patch_next_ = 0;
	void patch_ring();
	std::vector<int32_t> ring_ids_; // pieces of the ring
	std::vector<std::pair<int32_t, int>> stuck_sites_; // ring foundation -> thinks its builders stood short of it
	std::vector<AIGateGap> gaps_;
	double ring_check_t_ = 0;
	size_t fear_wave_ = 0;      // waves before this one already weighed for a retreat
	struct FoeTower { double x, z, reach; int need; };
	std::vector<FoeTower> foe_towers_; // enemy towers standing (refreshed each think)
	std::vector<int32_t> breach_picks_; // enemy wall pieces our breakers were turned on (kept till they fall)
};

} // namespace aov
