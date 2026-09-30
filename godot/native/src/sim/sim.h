// The deterministic simulation (no Godot dependency: plain C++17, so it can
// be unit-tested and benchmarked without the engine). Port of the update()
// half of the browser game: src/core/Game.js tick() and every piece's
// update(dt). AovSim (../aov_sim.h) exposes it to GDScript.
//
// Layout mirrors the JS pieces: sim/core (map, rng, entities, players,
// events, spatial hash, pathfinding, movement, commands, fog, victory),
// sim/units, sim/buildings, sim/combat (incl. the enemy AI),
// sim/economy, sim/godpowers, sim/scenes.
//
// Determinism: everything is ported JS-exact (doubles, the JS Math
// functions via core/jsmath.h, the same iteration orders), so a C++ run
// matches the browser run bit for bit (scripts/check-sim.mjs).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "combat/combat.h"
#include "core/commands.h"
#include "core/constants.h"
#include "core/entities.h"
#include "core/events.h"
#include "core/fog.h"
#include "core/game_map.h"
#include "core/movement.h"
#include "core/pathfinding.h"
#include "core/players.h"
#include "core/profile.h"
#include "core/rng.h"
#include "core/victory.h"
#include "buildings/buildings.h"
#include "economy/economy.h"
#include "godpowers/godpowers.h"
#include "match/match.h"
#include "scenes/scenes.h"
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
	// set by Victory when the match is decided (the JS game.paused): the
	// game loop stops ticking; tick() itself never checks it (fast-forward)
	bool paused = false;
	// Godot-only rules on top of the browser's game (the browser build is
	// frozen): the map passes (connected starts, start woodlines; read by
	// new_game), the enemy AI's god powers, the free villager (Economy::rescue).
	// Off only for the parity tools (scripts/check-sim.mjs via simcheck.gd),
	// which compare against the browser.
	bool godot_rules = true;

	EventBus events;
	Entities entities;
	Player players[MAX_PLAYERS];
	int local_player = PLAYER;
	PathPool paths;
	Pathfinder pathfinder;
	Movement movement;
	Commands commands;
	Units units;
	Economy economy;
	Buildings buildings;
	Combat combat;
	GodPowers godpowers;
	FogOfWar fog;
	Victory victory;
	SceneCtx scene; // the last scene setup's context (AovSim.setup_scene)

	GameMap &map() { return world.map; }
	const GameMap &map() const { return world.map; }

	// Game constructor + init(): players Gaia / You / Enemy, the map, the
	// systems, then the map's initial resources (terrain.spawnResource).
	void new_game(uint32_t seed_, int map_size, const std::string &preset, int n_players);
	// One fixed 1/30 s step: game.tick() with the systems in the JS simOrder.
	void tick(double dt = SIM_DT);
	// game.fastForward(seconds): Math.round(seconds / SIM_DT) ticks
	void fast_forward(double seconds);

	Player *player(int id) { return id >= 0 && id < MAX_PLAYERS && players[id].exists ? &players[id] : nullptr; }
	Player &add_player(int id, const std::string &name, bool is_ai);
	// Teams (Godot-only, set by the match setup, match.cpp): team[id] of each
	// owner; new_game gives every player a team of its own (team[id] = id),
	// which is the browser's rule (everyone else is an enemy).
	int team[MAX_PLAYERS] = { 0, 1, 2, 3, 4, 5, 6 };
	int team_of(int id) const { return id >= 0 && id < MAX_PLAYERS ? team[id] : id; }
	bool is_enemy(int a, int b) const { return a != b && a != GAIA && b != GAIA && team_of(a) != team_of(b); }
	// same owner, or both on one team (Gaia is nobody's ally)
	bool is_ally(int a, int b) const { return a == b || (a != GAIA && b != GAIA && team_of(a) == team_of(b)); }
	// The match setup (sim/match/match.cpp, AovSim.setup_match): players,
	// teams, colours, AI difficulty, starting resources and every start.
	// Call right after new_game(cfg.seed, cfg.map_size, cfg.preset, n).
	MatchResult setup_match(const MatchConfig &cfg);

	// terrain piece, sim side (src/terrain/index.js): Gaia resource nodes
	int32_t spawn_resource(int type, int tx, int tz, int variant = 0);
	// terrain.removeResource(e): unblocks its tiles (an animal, whose rect is
	// fractional, only unblocks when x - 0.5 happens to be a whole tile, as in JS)
	void remove_resource(int32_t id);
	// terrain.clearRect: every resource (animals too) overlapping the tile rect
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
