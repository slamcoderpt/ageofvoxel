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
};

} // namespace aov
