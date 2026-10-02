// Godot-only (behind Sim::godot_rules): the enemy AI's research (sim/techs).
// In the Classical Age, once its academy stands, it has armory_at villagers
// and its fortifications are done (its wall ring closed, its
// towers placed: the wood and gold they need is short), it builds an Armory and researches the Classical Armory line
// there (Copper Weapons, Copper Armor, Copper Shields: what its hoplites,
// toxotes and hippikons fight with), one at a time, only when it can pay the
// tech (and the Armory); short of it, its academies wait for it up to TECH_WAIT s (as for a
// fortification tech), then it is bought whenever there is enough to spare
// (TECH_KEEP left over). Never while it saves for the next age. Every
// difficulty but Easy does it.
// Deterministic: no rng draw, buildings in row order.
#include "enemy_ai.h"

#include "../sim.h"

namespace aov {

static const double TECH_KEEP = 150; // food / wood / gold left over once the wait is over
static const double TECH_WAIT = 45;  // s the academies wait for one tech's resources
static const int AI_TECHS[] = { T_COPPER_WEAPONS, T_COPPER_ARMOR, T_COPPER_SHIELDS, -1 };

void EnemyAI::research(int tc, const std::vector<int> &vills, const std::vector<int> &buildings, bool saving) {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	Player &p = S.players[owner];
	tech_wait_ = false;
	if (par.armory_at <= 0 || p.age < 1 || saving) return;
	int armory = -1, academy = -1;
	bool armory_any = false;
	for (int b : buildings) {
		if (B.type[b] == B_ARMORY) {
			armory_any = true;
			if (armory < 0 && B.built[b]) armory = b;
		}
		if (academy < 0 && B.type[b] == B_BARRACKS && B.built[b]) academy = b;
	}
	if (!armory_any) {
		if ((par.walls && ring_state_ != 3) || fort.towers < par.towers_max) return; // (the fortifications first)
		if (academy < 0 || (int)vills.size() < par.armory_at) return;
		if (!p.can_afford(building_def(B_ARMORY).cost)) { // (its 150 wood: the academies wait for it too)
			if (tech_wait_t_ < TECH_WAIT) {
				tech_wait_ = true;
				tech_wait_t_ += par.think;
				techs.holds++;
			}
			return;
		}
		if (try_build(B_ARMORY, pick_builder(vills), tc)) {
			techs.armories++;
			tech_wait_t_ = 0;
		}
		return;
	}
	if (armory < 0 || !B.tech_queue[armory].empty()) return;
	for (const int *t = AI_TECHS; *t >= 0; t++) {
		if (S.techs.state(owner, *t) != TS_AVAILABLE) continue;
		const Cost c = S.techs.cost_for(owner, *t);
		const bool waiting = tech_wait_t_ < TECH_WAIT;
		for (int k = 0; k < RES_COUNT; k++)
			if (c.has[k] && p.res[k] < c.v[k] + (waiting || k == RES_FAVOR ? 0 : TECH_KEEP)) {
				if (waiting) {
					tech_wait_ = true;
					tech_wait_t_ += par.think;
					techs.holds++;
				}
				return; // (in order: the next one waits)
			}
		if (S.techs.research(B.id[armory], *t).ok) {
			techs.started++;
			tech_wait_t_ = 0;
		}
		return;
	}
}

} // namespace aov
