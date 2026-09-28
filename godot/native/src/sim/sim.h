// The deterministic simulation (no Godot dependency: plain C++17, so it can
// be unit-tested and benchmarked without the engine). Port of the update()
// half of the browser game: src/core/Game.js tick() and every piece's
// update(dt). AovSim (../aov_sim.h) exposes it to GDScript.
//
// Layout mirrors the JS pieces: sim/core (map, rng, entities, players,
// events, spatial hash, pathfinding, movement, commands; later fog,
// victory), sim/units, sim/buildings, sim/combat (incl. the enemy AI),
// sim/economy, sim/godpowers, sim/scenes.
//
// Determinism: everything is ported JS-exact (doubles, the JS Math
// functions via core/jsmath.h, the same iteration orders), so a C++ run
// matches the browser run bit for bit (scripts/check-sim.mjs).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "core/commands.h"
#include "core/constants.h"
#include "core/entities.h"
#include "core/events.h"
#include "core/game_map.h"
#include "core/movement.h"
#include "core/pathfinding.h"
#include "core/players.h"
#include "core/profile.h"
#include "core/rng.h"
#include "units/units.h"

namespace aov {

class Sim {
public:
	Profile prof;
	MapGenResult world; // map + starts + initial resource spawns
	RNG rng{ 1 };
	uint32_t seed = 1;
	int64_t tick_count = 0;
	double time = 0; // seconds of game time

	EventBus events;
	Entities entities;
	Player players[MAX_PLAYERS];
	int local_player = PLAYER;
	PathPool paths;
	Pathfinder pathfinder;
	Movement movement;
	Commands commands;
	Units units;

	GameMap &map() { return world.map; }
	const GameMap &map() const { return world.map; }

	// Game constructor + init(): players Gaia / You / Enemy, the map, the
	// systems, then the map's initial resources (terrain.spawnResource).
	void new_game(uint32_t seed_, int map_size, const std::string &preset, int n_players);
	// One fixed 1/30 s step: game.tick() with the systems in the JS simOrder.
	void tick(double dt = SIM_DT);

	Player *player(int id) { return id >= 0 && id < MAX_PLAYERS && players[id].exists ? &players[id] : nullptr; }
	Player &add_player(int id, const std::string &name, bool is_ai);
	static bool is_enemy(int a, int b) { return a != b && a != GAIA && b != GAIA; }

	// terrain piece, sim side (src/terrain/index.js): Gaia resource nodes
	int32_t spawn_resource(int type, int tx, int tz, int variant = 0);
	void remove_resource(int32_t id);
	void clear_rect(int tx, int tz, int w, int h);

	// src/core/scenes/helpers.js spawnBlock (loose block formation centred on
	// x, z, facing rot); returns unit ids.
	std::vector<int32_t> spawn_block(int type, int owner, int count, double x, double z, int cols = 0, double spacing = 1.0,
			double rot = 0, double jitter = 0.15);

	// FNV-1a over every unit's id, position, rotation, hp and state bits
	// (determinism / parity checks, same as scripts/check-sim.mjs).
	uint32_t units_hash() const;
};

} // namespace aov
