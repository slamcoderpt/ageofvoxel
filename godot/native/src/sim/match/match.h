// Match setup (Godot-only: the skirmish setup screen's rules). A match is a
// map (preset, size, seed) plus 2..6 players, each human or AI (with a
// difficulty), on a team, with a colour and a god, and a starting stockpile.
// Sim::setup_match(cfg) runs right after Sim::new_game(cfg.seed,
// cfg.map_size, cfg.preset, cfg.players.size()) and:
//   - seats the players on the generator's starts, team mates side by side
//     (teams in order of first appearance, players in order within a team),
//     then renumbers world.starts so starts[i].owner = i + 1;
//   - sets Sim::team (a player whose team is <= 0 gets one of his own), the
//     players' names, colours, AI flag and difficulty, and the stockpile
//     (low / standard / high / deathmatch, plus the Titan bonus);
//   - gives every player the standard start (Town Center + villagers);
//   - makes one EnemyAI per AI seat with its difficulty, turns Victory on
//     and points the fog at the local player (the first human) and allies.
// AovSim.setup_match(Dictionary) / start_match(Dictionary) are the bindings
// (keys in PORTING.md, "Match rules").
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace aov {

struct MatchPlayer {
	int id = 0;              // owner 1..6 (0: the next free one)
	std::string name;
	bool human = false;
	int difficulty = 1;      // AIDifficulty (AI seats): 0 easy .. 3 titan
	int team = 0;            // <= 0: a team of his own
	int64_t color = -1;      // 0xRRGGBB (-1: PLAYER_COLORS[id])
	std::string god = "Zeus";
	int civ = -1;            // (Godot-only, sim/civ) CIV_GREEK / CIV_EGYPT; -1: from the god
};

struct MatchConfig {
	uint32_t seed = 1;
	int map_size = 128;
	std::string preset = "skirmish";
	std::string resources = "standard"; // low | standard | high | deathmatch
	int villagers = 5;                   // at each start
	std::vector<MatchPlayer> players;
};

struct MatchResult {
	bool ok = false;
	std::string error;
	int local = 1;               // the local player (first human; 1 without one)
	double focus_x = 0, focus_z = 0; // the local player's Town Center
	std::vector<int32_t> tcs;    // Town Center id per player, in cfg order
	std::vector<int> slot;       // generator start index per player, in cfg order
};

// Starting stockpile of a resources key (food, wood, gold, favor); false: unknown key
bool match_resources(const std::string &key, double out[4]);

} // namespace aov
