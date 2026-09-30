// Scripted opponent (port of src/combat/EnemyAI.js): keeps villagers busy
// (balancing food / wood / gold, farms when the berries run out), trains
// more, builds houses, a military academy and a temple, trains an army and
// minotaurs, advances to the Classical Age and sends attack waves at the
// nearest enemy building. Deterministic (sim rng only). One instance per AI
// player (Combat::ais).
#pragma once
#include <cstdint>
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
};
AIParams ai_params(int difficulty);

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
};

} // namespace aov
