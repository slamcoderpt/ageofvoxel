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
	if (sim->godot_rules) {
		update_teams(alive);
		return;
	}
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
	decide(loser == PLAYER ? ENEMY : PLAYER, loser);
}

void Victory::update_teams(const bool *alive) {
	const int L = sim->local_player;
	for (int id = 1; id < MAX_PLAYERS; id++) {
		if (!sim->players[id].exists) continue;
		if (alive[id]) had[id] = true;
		if (had[id] && !alive[id] && !out[id]) {
			out[id] = true;
			Event e;
			e.type = EV_PLAYER_DEFEATED;
			e.owner = id;
			e.amount = sim->time;
			sim->events.emit(e);
		}
	}
	// teams still standing: a player on them who has a Town Center, or never had one yet
	int standing[MAX_PLAYERS], ns = 0;
	bool any_out = false;
	auto team_standing = [&](int t) {
		for (int id = 1; id < MAX_PLAYERS; id++)
			if (sim->players[id].exists && sim->team_of(id) == t && had[id] && !out[id]) return true;
		return false;
	};
	for (int id = 1; id < MAX_PLAYERS; id++) {
		if (!sim->players[id].exists || !had[id]) continue;
		const int t = sim->team_of(id);
		if (!team_standing(t)) { any_out = true; continue; }
		bool seen = false;
		for (int k = 0; k < ns; k++) seen |= standing[k] == t;
		if (!seen) standing[ns++] = t;
	}
	if (!any_out) return;
	const bool local_out = sim->players[L].exists && had[L] && !team_standing(sim->team_of(L));
	if (ns > 1 && !local_out) return;
	// the loser reported: the local player when his team fell, else the first player out
	int lose = 0;
	if (local_out) lose = L;
	else
		for (int id = 1; id < MAX_PLAYERS && !lose; id++)
			if (out[id]) lose = id;
	int win = 0;
	winner_team = 0;
	if (ns >= 1 && !local_out) {
		winner_team = standing[0];
		if (sim->players[L].exists && sim->team_of(L) == winner_team) win = L;
		else
			for (int id = 1; id < MAX_PLAYERS && !win; id++)
				if (sim->players[id].exists && sim->team_of(id) == winner_team) win = id;
	} else if (ns >= 1) {
		// the local team fell: the strongest standing team (the first) is reported
		winner_team = standing[0];
		for (int id = 1; id < MAX_PLAYERS && !win; id++)
			if (sim->players[id].exists && sim->team_of(id) == winner_team && !out[id]) win = id;
	}
	if (!win) // everyone fell on the same tick: the first player not on the loser's team
		for (int id = 1; id < MAX_PLAYERS && !win; id++)
			if (sim->players[id].exists && !sim->is_ally(id, lose)) win = id;
	decide(win, lose);
}

void Victory::decide(int winner_, int loser_) {
	winner = winner_;
	loser = loser_;
	if (!winner_team && winner) winner_team = sim->team_of(winner);
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
