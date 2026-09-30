// Match end (port of src/core/Victory.js): a player loses when all of their
// Town Centers are destroyed (foundations count). Only players who have
// owned a Town Center can lose, so scenes without Town Centers never end.
// Enabled per scene (the skirmish). On the result it sets sim.paused and
// emits game:over (owner = winner, a = loser, amount = time).
//
// Godot-only (sim.godot_rules): victory is per team (Sim::team, set by the
// match setup) and any number of players. A player is out once he has
// owned a Town Center and has none left (player:defeated, owner = him); a
// team is out when all its players who ever had one are out. The match is
// decided when a single team is left standing (it wins), or when the local
// player's team is out (defeat, even if others fight on). winner = the
// local player when he is on the winning team, else the winning team's
// lowest id; winner_team = its team. The browser's rule (players 1 and 2
// only) applies with the rules off; with every player on his own team and
// two players both give the same result.
#pragma once

namespace aov {

class Sim;

class Victory {
public:
	Sim *sim = nullptr;
	bool enabled = false;
	bool decided = false;
	int winner = 0, loser = 0;
	int winner_team = 0;   // Godot-only: the winning team (Sim::team)
	bool out[8] = {};      // Godot-only: players defeated so far
	double at = 0;
	bool had[8] = {};
	double timer = 0;

	void init(Sim *s);
	void update(double dt);

private:
	void decide(int winner_, int loser_);
	void update_teams(const bool *alive);
};

} // namespace aov
