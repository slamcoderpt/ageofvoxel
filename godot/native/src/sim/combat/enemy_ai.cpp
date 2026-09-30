// Port of src/combat/EnemyAI.js (see enemy_ai.h).
#include "enemy_ai.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static const double PI = 3.141592653589793;

// god powers (Godot-only: the browser's EnemyAI never casts)
static const double POWER_EVERY = 2;      // s between decisions
static const double REACH_ARMY = 12;      // enemies this close to one of our soldiers are in reach
static const double REACH_BASE = 16;      // ... or this close to one of our buildings' centre
static const int STORM_MIN = 6;           // enemy units a Lightning Storm must catch
static const int METEOR_BUILDINGS = 2;    // enemy buildings a Meteor must hit
static const int METEOR_UNITS = 8;        // ... or enemy units
static const double BOLT_SPARE_FAVOR = 70; // Bolt a plain (non-myth) unit only with this much favor
static const int MAX_CENTRES = 64;        // candidate strike points tried per power
static const double STRAY_DIST = 30;      // idle soldiers this far from our Town Center rejoin the attack
static const int OVERDUE_MIN = 6;         // men an overdue wave needs at least

const char *ai_difficulty_name(int d) {
	static const char *n[] = { "easy", "moderate", "hard", "titan" };
	return d >= 0 && d < 4 ? n[d] : "";
}

int ai_difficulty_of(const char *name) {
	for (int d = 0; d < 4; d++)
		if (std::string(name) == ai_difficulty_name(d)) return d;
	return AI_DEFAULT;
}

AIParams ai_params(int d) {
	AIParams p; // AI_DEFAULT / AI_MODERATE: the browser's EnemyAI
	if (d == AI_EASY) {
		p.think = 2;
		p.max_villagers = 14;
		p.villager_queue = 1;
		p.academy_at = 12;
		p.temple_at = 13;
		p.army_queue = 1;
		p.wave_size = 5;
		p.wave_grow = 2;
		p.wave_max = 16;
		p.first_wave = 420;
		p.aggression = 0.6;
		p.power_every = 30;
		p.storm_min = 12;
		p.worshippers = 1;
		p.age_after = 720;
	} else if (d == AI_HARD) {
		p.max_villagers = 30;
		p.academy_at = 8;
		p.temple_at = 12;
		p.academy2_at = 20;
		p.army_queue = 4;
		p.wave_size = 8;
		p.wave_grow = 5;
		p.wave_max = 44;
		p.first_wave = 240;
		p.aggression = 1.15;
		p.storm_min = 5;
		p.worshippers = 4;
		p.house_margin = 6;
		p.food_share = 0.55;
		p.gold_share = 0.17;
		p.bank_cap = 600;
		p.army_while_saving = true;
	} else if (d == AI_TITAN) {
		p.think = 0.75;
		p.max_villagers = 34;
		p.villager_queue = 3;
		p.academy_at = 8;
		p.temple_at = 11;
		p.academy2_at = 16;
		p.army_queue = 5;
		p.wave_size = 10;
		p.wave_grow = 6;
		p.wave_max = 50;
		p.first_wave = 240;
		p.aggression = 1.3;
		p.power_every = 1;
		p.storm_min = 4;
		p.worshippers = 5;
		p.house_margin = 8;
		p.food_share = 0.58;
		p.gold_share = 0.16;
		p.bank_cap = 450;
		p.army_while_saving = true;
		p.gather_mult = 1.2;
		p.bonus_res = 150;
	}
	return p;
}

void EnemyAI::set_difficulty(int d) {
	difficulty = d;
	par = ai_params(d);
	wave_size = par.wave_size;
	next_wave_at = par.first_wave;
	aggression = par.aggression;
}

void EnemyAI::update(double dt) {
	if (!enabled) return;
	timer -= dt;
	if (timer > 0) return;
	timer = par.think;
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
	if (S.godot_rules) {
		power_timer -= par.think;
		if (par.power_every > 0 && power_timer <= 0) {
			power_timer = difficulty == AI_DEFAULT ? POWER_EVERY : par.power_every;
			use_powers(army, buildings);
		}
	}
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
	if (!saving && nv < par.max_villagers && (int)B.queue[tc].size() < par.villager_queue) S.economy.train(tc, U_VILLAGER);
	int counts[3] = { 0, 0, 0 };
	std::vector<int> by_type[3];
	for (int v : vills)
		if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] < 3) {
			counts[U.econ_res_type[v]]++;
			by_type[U.econ_res_type[v]].push_back(v);
		}
	int workers = 0;
	for (int v : vills) workers += U.order_type[v] == O_IDLE || U.order_type[v] == O_GATHER;
	// shares of the workers per resource (food, wood, gold): the browser's 0.5 / 0.3 / 0.2;
	// a harder AI weighs food (villagers, soldiers, the next age) and stops
	// piling up what it cannot spend
	double sh[3] = { 0.5, 0.3, 0.2 };
	if (par.food_share > 0) {
		sh[RES_FOOD] = par.food_share;
		sh[RES_GOLD] = p.res[RES_GOLD] > par.bank_cap ? 0.08 : par.gold_share;
		if (p.res[RES_WOOD] > par.bank_cap) sh[RES_WOOD] = 0.15;
		sh[RES_WOOD] = std::min(sh[RES_WOOD], 1 - sh[RES_FOOD] - sh[RES_GOLD]);
		sh[RES_FOOD] = 1 - sh[RES_WOOD] - sh[RES_GOLD];
	}
	const int target[3] = { (int)std::ceil(workers * sh[0]), (int)std::floor(workers * sh[1]), (int)std::floor(workers * sh[2]) };
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
	if (p.pop_cap - p.pop < par.house_margin && p.pop_cap < 300 && !building(B_HOUSE)) try_build(B_HOUSE, pick_builder(vills), tc);
	// 3. military
	int academy = -1, temple_any = -1, temple = -1, academy2 = -1;
	for (int b : buildings) {
		if (academy >= 0 && academy2 < 0 && B.type[b] == B_BARRACKS) academy2 = b;
		if (academy < 0 && B.type[b] == B_BARRACKS) academy = b;
		if (temple_any < 0 && B.type[b] == B_TEMPLE) temple_any = b;
		if (temple < 0 && B.type[b] == B_TEMPLE && B.built[b]) temple = b;
	}
	if (academy < 0 && nv >= par.academy_at) try_build(B_BARRACKS, pick_builder(vills), tc);
	if (temple_any < 0 && nv >= par.temple_at) try_build(B_TEMPLE, pick_builder(vills), tc);
	if (par.academy2_at > 0 && academy >= 0 && academy2 < 0 && temple_any >= 0 && nv >= par.academy2_at && !building(B_BARRACKS))
		try_build(B_BARRACKS, pick_builder(vills), tc);
	static const int PICK[4] = { U_HOPLITE, U_TOXOTES, U_HOPLITE, U_HIPPIKON };
	if (academy >= 0 && B.built[academy] && (int)B.queue[academy].size() < par.army_queue && (!saving || par.army_while_saving))
		S.economy.train(academy, PICK[(int64_t)std::floor(S.time / 7) % 4]);
	if (academy2 >= 0 && B.built[academy2] && (int)B.queue[academy2].size() < par.army_queue && (!saving || par.army_while_saving))
		S.economy.train(academy2, PICK[((int64_t)std::floor(S.time / 7) + 1) % 4]);
	if (temple >= 0 && p.age >= 1 && B.queue[temple].size() < 1) S.economy.train(temple, U_MINOTAUR);
	// worshippers
	if (temple >= 0) {
		int worshipping = 0;
		for (int v : vills) worshipping += U.order_type[v] == O_WORSHIP;
		if (worshipping < par.worshippers) {
			for (int v : vills)
				if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] == RES_GOLD) {
					S.commands.order(v, Order::with_target(O_WORSHIP, B.id[temple]));
					break;
				}
		}
	}
	// 4. age up
	if (!p.advancing && p.age < 1 && has_age_cost && S.time >= par.age_after && (p.res[RES_FOOD] > 500 || (nv >= 16 && p.can_afford(age_cost)))) S.economy.advance_age(owner);

	// 5. attack waves
	std::vector<int> idle_army;
	for (int u : army)
		if (U.order_type[u] == O_IDLE || (U.order_type[u] == O_ATTACK && (U.order_b[u] & ATK_AUTO))) idle_army.push_back(u);
	// Godot-only: a wave overdue by a whole interval (the army cannot grow to
	// wave_size: a starved economy, a population cap) goes with what there is
	const bool overdue = S.godot_rules && S.time >= next_wave_at + 120 / aggression && (int)idle_army.size() >= OVERDUE_MIN;
	if (S.time >= next_wave_at && ((int)idle_army.size() >= wave_size || overdue)) {
		const int t = find_target(tc);
		if (t >= 0) {
			const int32_t tid = B.id[t];
			WaveLog w{ S.time, tid, B.x[t], B.z[t], {} };
			for (int u : idle_army) w.units.push_back(U.id[u]);
			waves.push_back(std::move(w));
			if (S.godot_rules) // Godot-only: attack-move there, fighting what they meet on the way
				S.commands.move(idle_army, B.x[t], B.z[t], O_ATTACK_MOVE, AM_THEN_BUILDINGS);
			else
				for (int u : idle_army) {
					Order o = Order::with_target(O_ATTACK, tid);
					o.b = ATK_THEN_BUILDINGS;
					S.commands.order(u, o);
				}
			wave_size = std::min(par.wave_max, wave_size + par.wave_grow);
			next_wave_at = S.time + 120 / aggression;
		}
	} else if (S.godot_rules) {
		// Godot-only: men of a wave left idle far from home (a Lightning Storm
		// drops the men it throws idle) press on instead of standing about
		std::vector<int> strays;
		for (int u : idle_army)
			if (U.order_type[u] == O_IDLE && jsm::hypot(U.x[u] - B.x[tc], U.z[u] - B.z[tc]) > STRAY_DIST) strays.push_back(u);
		const int t = strays.empty() ? -1 : find_target(tc);
		if (t >= 0) S.commands.move(strays, B.x[t], B.z[t], O_ATTACK_MOVE, AM_THEN_BUILDINGS);
	}
}

// God powers, through the same GodPowers::can_cast / cast as the player's
// HUD (favor costs and cooldowns included). Every POWER_EVERY s, among the
// enemy units near our army or base: a Lightning Storm on the densest
// cluster (at least STORM_MIN men inside the strike radius), else a Meteor
// on a clump of enemy buildings near our army or a big enemy army, else a
// Bolt on the most valuable single target (a myth unit or hero first; a
// plain unit only when favor is plentiful). Deterministic: no random draws,
// ties go to the first candidate in row order.
void EnemyAI::use_powers(const std::vector<int> &army, const std::vector<int> &buildings) {
	Sim &S = *sim;
	GodPowers &G = S.godpowers;
	const bool storm_ok = G.can_cast(owner, GP_LIGHTNING_STORM).ok, meteor_ok = G.can_cast(owner, GP_METEOR).ok,
			   bolt_ok = G.can_cast(owner, GP_BOLT).ok;
	if (!storm_ok && !meteor_ok && !bolt_ok) return;
	const UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	const GameMap &map = S.map();
	// reach: coarse cells (4 tiles) near our soldiers and buildings
	const int CELL = 4, M = (map.size + CELL - 1) / CELL;
	reach_.assign((size_t)M * M, 0);
	auto mark = [&](double x, double z, double r) {
		int c0x, c1x, c0z, c1z;
		if (!cell_span(x - r, x + r, CELL, M, c0x, c1x) || !cell_span(z - r, z + r, CELL, M, c0z, c1z)) return;
		for (int cz = c0z; cz <= c1z; cz++)
			for (int cx = c0x; cx <= c1x; cx++) {
				const double dx = (cx + 0.5) * CELL - x, dz = (cz + 0.5) * CELL - z;
				if (dx * dx + dz * dz <= (r + CELL * 0.71) * (r + CELL * 0.71)) reach_[(size_t)cz * M + cx] = 1;
			}
	};
	for (int u : army) mark(U.x[u], U.z[u], REACH_ARMY);
	for (int b : buildings) mark(B.x[b], B.z[b], REACH_BASE);
	auto in_reach = [&](double x, double z) {
		if (!(x >= 0 && z >= 0 && x < M * CELL && z < M * CELL)) return false; // (checked before the cast)
		return reach_[(size_t)(int)(z / CELL) * M + (int)(x / CELL)] != 0;
	};
	// enemy units in reach (on the ground: men carried up a storm are spoken for)
	std::vector<int> foes;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.gp_state[r] != 1 && sim->is_enemy(owner, U.owner[r]) && in_reach(U.x[r], U.z[r])) foes.push_back(r);
	// the densest cluster of `foes` within radius r: count, centre
	auto cluster = [&](double r, double &ox, double &oz) {
		int best = 0;
		const double r2 = r * r;
		const size_t n = foes.size(), step = std::max<size_t>(1, n / MAX_CENTRES);
		for (size_t i = 0; i < n; i += step) {
			const double cx = U.x[foes[i]], cz = U.z[foes[i]];
			int k = 0;
			double sx = 0, sz = 0;
			for (int o : foes) {
				const double dx = U.x[o] - cx, dz = U.z[o] - cz;
				if (dx * dx + dz * dz <= r2) {
					k++;
					sx += U.x[o];
					sz += U.z[o];
				}
			}
			if (k <= best) continue;
			// re-centre on the men caught, keep it if it catches as many
			const double mx = sx / k, mz = sz / k;
			int km = 0;
			for (int o : foes) {
				const double dx = U.x[o] - mx, dz = U.z[o] - mz;
				km += dx * dx + dz * dz <= r2;
			}
			best = std::max(k, km);
			ox = km >= k ? mx : cx;
			oz = km >= k ? mz : cz;
		}
		return best;
	};
	const int storm_min = difficulty == AI_DEFAULT ? STORM_MIN : par.storm_min;
	if (storm_ok && (int)foes.size() >= storm_min) {
		double x = 0, z = 0;
		// the storm strikes men within 0.78 of its radius (GodPowers::update)
		if (cluster(power_def(GP_LIGHTNING_STORM).radius * 0.78, x, z) >= storm_min && G.cast(owner, GP_LIGHTNING_STORM, x, z)) {
			casts[GP_LIGHTNING_STORM]++;
			return;
		}
	}
	if (meteor_ok) {
		const double R = power_def(GP_METEOR).radius;
		// a clump of enemy buildings our army stands by
		int best = 0;
		double bx = 0, bz = 0;
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || !sim->is_enemy(owner, B.owner[b]) || !in_reach(B.x[b], B.z[b])) continue;
			int k = 0;
			for (int o = 0; o < B.size(); o++) {
				if (B.removed[o] || B.dead[o] || !sim->is_enemy(owner, B.owner[o])) continue;
				const BuildingDef &od = building_def(B.type[o]);
				if (jsm::hypot(B.x[o] - B.x[b], B.z[o] - B.z[b]) < R + std::max(od.w, od.h) / 2.0) k++;
			}
			if (k > best) {
				best = k;
				bx = B.x[b];
				bz = B.z[b];
			}
		}
		double ux = 0, uz = 0;
		const int men = (int)foes.size() >= METEOR_UNITS ? cluster(R * 0.8, ux, uz) : 0;
		const bool on_men = men >= METEOR_UNITS, on_town = best >= METEOR_BUILDINGS;
		if ((on_men || on_town) && G.cast(owner, GP_METEOR, on_men ? ux : bx, on_men ? uz : bz)) {
			casts[GP_METEOR]++;
			return;
		}
	}
	if (bolt_ok && !foes.empty()) {
		// value: myth units and heroes first (by hp left), then the dearest unit
		int best = -1;
		double bv = 0;
		const bool spare = S.players[owner].res[RES_FAVOR] >= BOLT_SPARE_FAVOR;
		for (int o : foes) {
			const UnitDef &d = unit_def(U.type[o]);
			double v;
			if (d.myth || d.hero) v = 10000 + U.hp[o];
			else if (spare && !d.gatherer) v = d.cost.v[RES_FOOD] + d.cost.v[RES_WOOD] + d.cost.v[RES_GOLD] + d.cost.v[RES_FAVOR] * 3;
			else continue;
			if (v > bv) {
				bv = v;
				best = o;
			}
		}
		// (the bolt picks the unit nearest the point: cast right on the target)
		if (best >= 0 && G.cast(owner, GP_BOLT, U.x[best], U.z[best])) casts[GP_BOLT]++;
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
		if (B.removed[b] || !sim->is_enemy(owner, B.owner[b])) continue;
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
