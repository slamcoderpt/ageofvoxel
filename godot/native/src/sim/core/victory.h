// Match end (port of src/core/Victory.js): a player loses when all of their
// Town Centers are destroyed (foundations count). Only players who have
// owned a Town Center can lose, so scenes without Town Centers never end.
// Enabled per scene (the skirmish). On the result it sets sim.paused and
// emits game:over (owner = winner, a = loser, amount = time).
#pragma once

namespace aov {

class Sim;

class Victory {
public:
	Sim *sim = nullptr;
	bool enabled = false;
	bool decided = false;
	int winner = 0, loser = 0;
	double at = 0;
	bool had[8] = {};
	double timer = 0;

	void init(Sim *s);
	void update(double dt);
};

} // namespace aov
