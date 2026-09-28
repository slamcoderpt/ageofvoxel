// Port of src/combat/EnemyAI.js (see enemy_ai.h).
#include "enemy_ai.h"

#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static const double PI = 3.141592653589793;

void EnemyAI::update(double dt) {
	if (!enabled) return;
	timer -= dt;
	if (timer > 0) return;
	timer = 1.0;
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	Player &p = S.players[owner];
	std::vector<int> vills, army, buildings;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.owner[r] != owner || U.dead[r]) continue;
		(unit_def(U.type[r]).gatherer ? vills : army).push_back(r);
	}
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && B.owner[b] == owner && !B.dead[b]) buildings.push_back(b);
	int tc = -1;
	for (int b : buildings)
		if (B.type[b] == B_TOWN_CENTER && B.built[b]) { tc = b; break; }
	if (tc < 0) return;
	const int nv = (int)vills.size();

	// saving food for the Classical Age (minotaurs need it)
	Cost age_cost;
	const bool has_age_cost = S.economy.next_age_cost(owner, age_cost);
	const bool saving = p.age < 1 && !p.advancing && has_age_cost && nv >= 16 && S.time >= 300 && S.time < 540 && !p.can_afford(age_cost);
	// 1. villagers
	if (!saving && nv < 22 && B.queue[tc].size() < 2) S.economy.train(tc, U_VILLAGER);
	int counts[3] = { 0, 0, 0 };
	std::vector<int> by_type[3];
	for (int v : vills)
		if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] < 3) {
			counts[U.econ_res_type[v]]++;
			by_type[U.econ_res_type[v]].push_back(v);
		}
	int workers = 0;
	for (int v : vills) workers += U.order_type[v] == O_IDLE || U.order_type[v] == O_GATHER;
	const int target[3] = { (int)std::ceil(workers * 0.5), (int)std::floor(workers * 0.3), (int)std::floor(workers * 0.2) };
	// ['food', 'wood', 'gold'].sort(...)[0]: the most under-staffed, ties to the first
	auto need = [&]() {
		int best = 0;
		for (int k = 1; k < 3; k++)
			if (counts[k] - target[k] < counts[best] - target[best]) best = k;
		return best;
	};
	for (int v : vills) {
		if (U.order_type[v] != O_IDLE) continue;
		const int want = need();
		if (assign(v, want, tc, buildings)) counts[want]++;
		else if (assign(v, RES_WOOD, tc, buildings)) counts[RES_WOOD]++;
	}
	// rebalance: move one worker per tick from the most over-staffed resource
	const int lack = need();
	if (counts[lack] < target[lack]) {
		int over = 0;
		for (int k = 1; k < 3; k++)
			if (counts[k] - target[k] > counts[over] - target[over]) over = k;
		if (over != lack && counts[over] > target[over]) {
			for (int v : by_type[over])
				if (!(U.carry_amount[v] != 0) || U.carry_amount[v] < 3) {
					assign(v, lack, tc, buildings);
					break;
				}
		}
	}

	// 2. houses
	auto building = [&](int t) {
		for (int b : buildings)
			if (B.type[b] == t && !B.built[b]) return true;
		return false;
	};
	if (p.pop_cap - p.pop < 4 && p.pop_cap < 300 && !building(B_HOUSE)) try_build(B_HOUSE, pick_builder(vills), tc);
	// 3. military
	int academy = -1, temple_any = -1, temple = -1;
	for (int b : buildings) {
		if (academy < 0 && B.type[b] == B_BARRACKS) academy = b;
		if (temple_any < 0 && B.type[b] == B_TEMPLE) temple_any = b;
		if (temple < 0 && B.type[b] == B_TEMPLE && B.built[b]) temple = b;
	}
	if (academy < 0 && nv >= 10) try_build(B_BARRACKS, pick_builder(vills), tc);
	if (temple_any < 0 && nv >= 14) try_build(B_TEMPLE, pick_builder(vills), tc);
	if (academy >= 0 && B.built[academy] && B.queue[academy].size() < 3 && !saving) {
		static const int PICK[4] = { U_HOPLITE, U_TOXOTES, U_HOPLITE, U_HIPPIKON };
		S.economy.train(academy, PICK[(int64_t)std::floor(S.time / 7) % 4]);
	}
	if (temple >= 0 && p.age >= 1 && B.queue[temple].size() < 1) S.economy.train(temple, U_MINOTAUR);
	// worshippers
	if (temple >= 0) {
		int worshipping = 0;
		for (int v : vills) worshipping += U.order_type[v] == O_WORSHIP;
		if (worshipping < 3) {
			for (int v : vills)
				if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] == RES_GOLD) {
					S.commands.order(v, Order::with_target(O_WORSHIP, B.id[temple]));
					break;
				}
		}
	}
	// 4. age up
	if (!p.advancing && p.age < 1 && has_age_cost && (p.res[RES_FOOD] > 500 || (nv >= 16 && p.can_afford(age_cost)))) S.economy.advance_age(owner);

	// 5. attack waves
	std::vector<int> idle_army;
	for (int u : army)
		if (U.order_type[u] == O_IDLE || (U.order_type[u] == O_ATTACK && (U.order_b[u] & ATK_AUTO))) idle_army.push_back(u);
	if (S.time >= next_wave_at && (int)idle_army.size() >= wave_size) {
		const int t = find_target(tc);
		if (t >= 0) {
			const int32_t tid = B.id[t];
			for (int u : idle_army) {
				Order o = Order::with_target(O_ATTACK, tid);
				o.b = ATK_THEN_BUILDINGS;
				S.commands.order(u, o);
			}
			wave_size = std::min(40, wave_size + 4);
			next_wave_at = S.time + 120 / aggression;
		}
	}
}

// Send a villager to gather a resource type; food falls back to farms.
bool EnemyAI::assign(int v, int res, int tc, const std::vector<int> &buildings) {
	Sim &S = *sim;
	Entities &E = S.entities;
	const BuildingStore &B = E.buildings;
	const int32_t r = S.economy.nearest_resource(B.x[tc], B.z[tc], res, res == RES_GOLD ? 45 : 34);
	if (r) return S.commands.order(v, Order::with_target(O_GATHER, r));
	if (res != RES_FOOD) return false;
	for (int b : buildings) {
		if (!building_def(B.type[b]).farm || !B.built[b]) continue;
		const int fs = B.farmer[b] ? E.unit_slot(B.farmer[b]) : -1;
		if (fs >= 0 && E.units.order_target[fs] == B.id[b]) continue;
		return S.commands.order(v, Order::with_target(O_GATHER, B.id[b]));
	}
	for (int b : buildings)
		if (building_def(B.type[b]).farm && !B.built[b]) return false;
	return try_build(B_FARM, v, tc);
}

int EnemyAI::pick_builder(const std::vector<int> &vills) const {
	const UnitStore &U = sim->entities.units;
	for (int v : vills)
		if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] == RES_WOOD) return v;
	for (int v : vills)
		if (U.order_type[v] == O_IDLE) return v;
	return vills.empty() ? -1 : vills[0];
}

int EnemyAI::find_target(int tc) const {
	const BuildingStore &B = sim->entities.buildings;
	int best = -1;
	double bd = INFINITY;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || !Sim::is_enemy(owner, B.owner[b])) continue;
		const double dx = B.x[b] - B.x[tc], dz = B.z[b] - B.z[tc];
		const double d = dx * dx + dz * dz;
		if (d < bd) {
			bd = d;
			best = b;
		}
	}
	return best;
}

bool EnemyAI::try_build(int type, int builder, int tc) {
	Sim &S = *sim;
	Player &p = S.players[owner];
	const BuildingDef &def = building_def(type);
	if (builder < 0 || !p.can_afford(def.cost)) return false;
	int tx, tz;
	if (!find_spot(type, tc, tx, tz)) return false;
	p.pay(def.cost);
	const int b = S.buildings.spawn(type, owner, tx, tz, false);
	S.commands.order(builder, Order::with_target(O_BUILD, S.entities.buildings.id[b]));
	return true;
}

bool EnemyAI::find_spot(int type, int tc, int &otx, int &otz) {
	Sim &S = *sim;
	const BuildingDef &def = building_def(type);
	const BuildingStore &B = S.entities.buildings;
	const double cx = std::floor(B.x[tc]), cz = std::floor(B.z[tc]);
	for (int r = 6; r < 24; r += 1) {
		for (int k = 0; k < 16; k++) {
			const double a = S.rng.range(0, PI * 2);
			const int tx = (int)js_round(cx + jsm::cos(a) * r - def.w / 2.0), tz = (int)js_round(cz + jsm::sin(a) * r - def.h / 2.0);
			// leave a one-tile gap around buildings so paths stay open
			if (S.buildings.can_place(type, tx, tz) && gap_ok(tx, tz, def.w, def.h)) {
				otx = tx;
				otz = tz;
				return true;
			}
		}
	}
	return false;
}

bool EnemyAI::gap_ok(int tx, int tz, int w, int h) const {
	const GameMap &map = sim->map();
	for (int z = tz - 1; z <= tz + h; z++)
		for (int x = tx - 1; x <= tx + w; x++)
			if (!map.is_walkable(x, z)) return false;
	return true;
}

} // namespace aov
