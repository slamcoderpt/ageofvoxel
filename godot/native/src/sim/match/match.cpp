// Match setup (see match.h).
#include "match.h"

#include <algorithm>

#include "../scenes/scenes.h"
#include "../sim.h"

namespace aov {

bool match_resources(const std::string &key, double out[4]) {
	// the same numbers as the setup screen's RESOURCES (game/menu/setup/match_settings.gd)
	static const struct { const char *key; double v[4]; } T[] = {
		{ "low", { 150, 150, 100, 0 } },
		{ "standard", { 300, 300, 200, 20 } },
		{ "high", { 1000, 1000, 750, 50 } },
		{ "deathmatch", { 10000, 10000, 10000, 100 } },
	};
	for (const auto &t : T)
		if (key == t.key) {
			for (int k = 0; k < 4; k++) out[k] = t.v[k];
			return true;
		}
	return false;
}

MatchResult Sim::setup_match(const MatchConfig &cfg) {
	MatchResult res;
	const int n = (int)cfg.players.size();
	if (n < 1 || n > MAX_PLAYERS - 1) {
		res.error = "a match takes 1..6 players";
		return res;
	}
	if ((int)world.starts.size() < n) {
		res.error = "the map has " + std::to_string(world.starts.size()) + " starts for " + std::to_string(n) + " players";
		return res;
	}
	// owners: as given, else the next free id
	std::vector<int> ids(n, 0);
	bool used[MAX_PLAYERS] = {};
	for (int i = 0; i < n; i++) {
		const int id = cfg.players[i].id;
		if (id >= 1 && id < MAX_PLAYERS && !used[id]) { ids[i] = id; used[id] = true; }
	}
	for (int i = 0; i < n; i++)
		if (!ids[i])
			for (int id = 1; id < MAX_PLAYERS; id++)
				if (!used[id]) { ids[i] = id; used[id] = true; break; }
	// teams (<= 0: his own, numbered past any real team)
	std::vector<int> teams(n);
	for (int i = 0; i < n; i++) teams[i] = cfg.players[i].team > 0 ? cfg.players[i].team : 100 + ids[i];
	// seats: team mates side by side round the ring
	std::vector<int> order; // cfg indices in seat order
	std::vector<int> team_order;
	for (int i = 0; i < n; i++)
		if (std::find(team_order.begin(), team_order.end(), teams[i]) == team_order.end()) team_order.push_back(teams[i]);
	for (int t : team_order)
		for (int i = 0; i < n; i++)
			if (teams[i] == t) order.push_back(i);
	res.slot.assign(n, 0);
	std::vector<Start> starts;
	for (int k = 0; k < n; k++) {
		const int i = order[k];
		res.slot[i] = k;
		Start s = world.starts[k];
		s.owner = ids[i];
		starts.push_back(s);
	}
	std::sort(starts.begin(), starts.end(), [](const Start &a, const Start &b) { return a.owner < b.owner; });
	world.starts = starts;

	// players
	for (int id = 1; id < MAX_PLAYERS; id++) players[id] = Player();
	for (int i = 0; i < MAX_PLAYERS; i++) team[i] = i;
	double stock[4];
	if (!match_resources(cfg.resources, stock)) match_resources("standard", stock);
	local_player = 0;
	for (int i = 0; i < n; i++) {
		const MatchPlayer &mp = cfg.players[i];
		const int id = ids[i];
		Player &p = players[id];
		p.init(id, mp.name, !mp.human);
		p.human = mp.human;
		if (mp.color >= 0) p.color = (uint32_t)mp.color;
		if (!mp.god.empty()) p.god = mp.god;
		// (Godot-only, sim/civ: the civilization comes with the major god; the browser's game is all Greek)
		if (godot_rules) {
			const int c = mp.civ >= 0 ? mp.civ : civ_of_god(p.god);
			p.civ = (uint8_t)(c < 0 ? CIV_GREEK : c);
		}
		team[id] = teams[i];
		const int d = mp.human ? AI_DEFAULT : std::max(0, std::min(3, mp.difficulty));
		p.difficulty = d;
		const AIParams par = ai_params(d);
		p.gather_mult = par.gather_mult;
		for (int k = 0; k < 4; k++) p.res[k] = stock[k] + (k < 3 ? par.bonus_res : 0);
		if (p.civ == CIV_EGYPT) p.res[RES_FAVOR] = 0; // (sim/civ: Retold's Egyptians start without favor: no worship, Monuments)
		if (mp.human && !local_player) local_player = id;
	}
	if (!local_player) local_player = ids[0];
	res.local = local_player;
	fog.owner = local_player;

	// starts, then the AIs (one per AI seat, cfg order)
	res.tcs.assign(n, 0);
	for (int i = 0; i < n; i++) {
		const Start *st = nullptr;
		for (const Start &s : world.starts)
			if (s.owner == ids[i]) st = &s;
		int32_t tc = 0;
		if (players[ids[i]].civ == CIV_EGYPT) tc = civs.egypt_start(ids[i], *st, cfg.villagers).tc; // (sim/civ: 3 Laborers, the Pharaoh, a Priest)
		else tc = scenes::standard_start(*this, ids[i], *st, cfg.villagers).tc;
		res.tcs[i] = tc;
		if (ids[i] == local_player) {
			const int b = entities.building_slot(tc);
			if (b >= 0) {
				res.focus_x = entities.buildings.x[b];
				res.focus_z = entities.buildings.z[b];
			}
		}
	}
	combat.ais.clear();
	bool enemy_ai = false;
	for (int i = 0; i < n; i++) enemy_ai |= ids[i] == ENEMY && !cfg.players[i].human;
	if (!enemy_ai) combat.add_ai(ENEMY).enabled = false; // combat.ai() is the ENEMY's (placeholder: no such AI seat)
	for (int i = 0; i < n; i++) {
		if (cfg.players[i].human) continue;
		EnemyAI &ai = ids[i] == ENEMY ? (combat.ais.insert(combat.ais.begin(), EnemyAI(this, ENEMY)), combat.ais.front()) : combat.add_ai(ids[i]);
		ai.set_difficulty(players[ids[i]].difficulty);
		ai.enabled = true;
	}
	victory.init(this);
	victory.enabled = true;
	res.ok = true;
	return res;
}

} // namespace aov
