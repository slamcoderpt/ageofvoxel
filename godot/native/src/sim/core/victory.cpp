// Port of src/core/Victory.js (see victory.h).
#include "victory.h"

#include "../sim.h"

namespace aov {

void Victory::init(Sim *s) {
	*this = Victory();
	sim = s;
}

void Victory::update(double dt) {
	if (!enabled || decided) return;
	timer -= dt;
	if (timer > 0) return;
	timer = 0.5;
	bool alive[8] = {};
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && B.type[b] == B_TOWN_CENTER && !B.dead[b]) alive[B.owner[b]] = true;
	const int ids[2] = { PLAYER, ENEMY };
	int lost[2], nl = 0;
	for (int id : ids) {
		if (alive[id]) had[id] = true;
		if (had[id] && !alive[id]) lost[nl++] = id;
	}
	if (!nl) return;
	// both gone on the same tick counts as a defeat for the local player
	loser = lost[0];
	for (int i = 0; i < nl; i++)
		if (lost[i] == sim->local_player) loser = sim->local_player;
	winner = loser == PLAYER ? ENEMY : PLAYER;
	at = sim->time;
	decided = true;
	sim->paused = true;
	Event e;
	e.type = EV_GAME_OVER;
	e.owner = winner;
	e.a = loser;
	e.amount = at;
	sim->events.emit(e);
}

} // namespace aov
