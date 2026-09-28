// The deterministic simulation (no Godot dependency: plain C++17, so it can
// be unit-tested and benchmarked without the engine). Port of the update()
// half of the browser game: src/core/Game.js tick() and every piece's
// update(dt). AovSim (../aov_sim.h) exposes it to GDScript.
//
// Layout mirrors the JS pieces: sim/core (map, rng, entities, movement,
// pathfinding, commands, fog, victory), sim/units, sim/buildings,
// sim/combat (incl. the enemy AI), sim/economy, sim/godpowers, sim/scenes.
#pragma once
#include <chrono>
#include <cstdint>
#include <map>
#include <string>

#include "core/constants.h"
#include "core/game_map.h"
#include "core/rng.h"

namespace aov {

// Per-tick timing, filled while `enabled` (the JS Profiler's prof.last):
// ms per system of the sim order, per AI player, sub-steps, and counted calls
// (findPath, nearestResource, ...). Systems time themselves with ScopedTimer.
struct Profile {
	bool enabled = false;
	double total = 0;
	std::map<std::string, double> sys, sub, ai;
	std::map<std::string, std::pair<int64_t, double>> calls; // name -> (count, ms)
	void clear() { total = 0; sys.clear(); sub.clear(); ai.clear(); calls.clear(); }
};

using Clock = std::chrono::steady_clock;
inline double ms_since(Clock::time_point t0) {
	return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}
struct ScopedTimer {
	double *out;
	Clock::time_point t0;
	explicit ScopedTimer(double *o) : out(o), t0(o ? Clock::now() : Clock::time_point()) {}
	~ScopedTimer() { if (out) *out += ms_since(t0); }
};

class Sim {
public:
	Profile prof;
	MapGenResult world;  // map + starts + initial resource spawns
	RNG rng{ 1 };
	uint32_t seed = 1;
	int64_t tick_count = 0;
	double time = 0; // seconds of game time

	GameMap &map() { return world.map; }

	void new_game(uint32_t seed_, int map_size, const std::string &preset, int players) {
		seed = seed_;
		rng = RNG(seed_);
		tick_count = 0;
		time = 0;
		world = generate_map(seed_, map_size, preset, players);
	}

	// One fixed 1/30 s step. Systems are added here in the JS simOrder.
	void tick() {
		Clock::time_point t0;
		if (prof.enabled) { prof.clear(); t0 = Clock::now(); }
		// for each system in sim order:
		//   { ScopedTimer t(prof.enabled ? &prof.sys["movement"] : nullptr); movement.update(SIM_DT); }
		tick_count++;
		time += SIM_DT;
		if (prof.enabled) prof.total = ms_since(t0);
	}
};

} // namespace aov
