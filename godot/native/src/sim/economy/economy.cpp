// Port of src/economy/index.js (see economy.h).
#include "economy.h"

#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static const double PI = 3.141592653589793;

const Cost &age_cost(int age) {
	static const Cost none;
	static const Cost C[4] = { Cost(), Cost(400, 0, 0, 0), Cost(800, 0, 500, 0), Cost(1000, 0, 1000, 0) };
	return age >= 1 && age <= 3 ? C[age] : none;
}

void Economy::init(Sim *s) {
	sim = s;
	spears.clear();
	decor.clear();
	const int size = s->map().size;
	ncell = (size + CELL - 1) / CELL;
	for (auto &c : cells) c.assign((size_t)ncell * ncell, {});
	cell_of.clear();
	dropoffs.assign(MAX_PLAYERS, {});
	wildlife.init(s);
	fishing.init(s);
	Commands &cmd = s->commands;
	cmd.register_handler(O_GATHER, [this](int r, const Order &o) { return start_gather(r, o); });
	cmd.register_handler(O_DROPOFF, [this](int r, const Order &o) {
		Entities &E = sim->entities;
		const int b = E.building_slot(o.target);
		if (b < 0 || !building_def(E.buildings.type[b]).dropoff) return false;
		UnitStore &U = E.units;
		set_econ(r, EP_TO_DROP, 0, U.carry_type[r], E.buildings.id[b], 0);
		U.econ_throw_cd[r] = NAN; // (not part of this econ object)
		const BuildingStore &B = E.buildings;
		GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
		sim->movement.move_to(r, B.x[b], B.z[b], &g);
		return true;
	});
	cmd.register_handler(O_WORSHIP, [this](int r, const Order &o) {
		Entities &E = sim->entities;
		const int b = E.building_slot(o.target);
		UnitStore &U = E.units;
		if (b < 0 || !building_def(E.buildings.type[b]).worship || !unit_def(U.type[r]).gatherer) return false;
		set_econ(r, EP_TO_TEMPLE, 0, RES_NONE, 0, NAN);
		U.econ_temple[r] = E.buildings.id[b];
		const BuildingStore &B = E.buildings;
		GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
		sim->movement.move_to(r, B.x[b], B.z[b], &g);
		return true;
	});
	// index maintenance
	s->events.on(EV_ENTITY_ADDED, [this](const Event &e) {
		if (e.kind == K_RESOURCE && !is_animal_type(e.a)) index_add(e.id);
		else if (e.kind == K_BUILDING && building_def(e.a).dropoff && e.owner >= 0 && e.owner < MAX_PLAYERS) dropoffs[e.owner].push_back(e.id);
	});
	s->events.on(EV_ENTITY_REMOVED, [this](const Event &e) {
		if (e.kind == K_RESOURCE) {
			if (is_animal_type(e.a)) {
				auto &A = wildlife.animals;
				A.erase(std::remove(A.begin(), A.end(), e.id), A.end());
			} else index_remove(e.id, resource_def(e.a).res_type);
		} else if (e.kind == K_BUILDING && e.owner >= 0 && e.owner < MAX_PLAYERS) {
			auto &D = dropoffs[e.owner];
			D.erase(std::remove(D.begin(), D.end(), e.id), D.end());
		}
	});
}

void Economy::index_add(int32_t id) {
	const ResourceStore &R = sim->entities.resources;
	const int s = sim->entities.resource_slot(id);
	if (s < 0) return;
	const int kind = R.res_type[s];
	if (kind > RES_GOLD) return;
	const int cx = std::max(0, std::min(ncell - 1, (int)std::floor(R.x[s] / CELL)));
	const int cz = std::max(0, std::min(ncell - 1, (int)std::floor(R.z[s] / CELL)));
	const int c = cz * ncell + cx;
	cells[kind][c].push_back(id);
	if ((int)cell_of.size() <= id) cell_of.resize((size_t)id + 1, -1);
	cell_of[id] = c;
}

void Economy::index_remove(int32_t id, int kind) {
	if (kind > RES_GOLD || id >= (int)cell_of.size() || cell_of[id] < 0) return;
	auto &v = cells[kind][cell_of[id]];
	v.erase(std::remove(v.begin(), v.end(), id), v.end());
	cell_of[id] = -1;
}

bool Economy::is_animal(int32_t id) const {
	const int s = sim->entities.resource_slot(id);
	return s >= 0 && is_animal_type(sim->entities.resources.type[s]);
}

void Economy::set_econ(int r, EconPhase phase, int32_t res, int res_type, int32_t drop, double throw_cd) {
	UnitStore &U = sim->entities.units;
	U.econ_phase[r] = phase;
	U.econ_res[r] = res;
	U.econ_res_type[r] = (uint8_t)res_type;
	U.econ_drop[r] = drop;
	U.econ_temple[r] = 0;
	U.econ_tries[r] = 0;
	U.econ_throw_cd[r] = throw_cd;
	U.econ_hunt[r] = 0;
}

void Economy::farm_spot(int b, double &x, double &z) const {
	const BuildingStore &B = sim->entities.buildings;
	const double H = B.econ_rows[b];
	const double row = std::fmod(std::floor(H), (double)FARM_ROWS), f = H - std::floor(H);
	const bool back = std::fmod(std::floor(H / FARM_ROWS), 2.0) == 1;
	x = B.tx[b] + 0.7 + (back ? 1 - f : f) * (B.w[b] - 1.4);
	z = B.tz[b] + 0.55 + (row + 0.5) * ((B.h[b] - 1.1) / FARM_ROWS);
}

bool Economy::in_farm(int u, int b) const {
	const UnitStore &U = sim->entities.units;
	const BuildingStore &B = sim->entities.buildings;
	return U.x[u] > B.tx[b] + 0.2 && U.x[u] < B.tx[b] + B.w[b] - 0.2 && U.z[u] > B.tz[b] + 0.2 && U.z[u] < B.tz[b] + B.h[b] - 0.2;
}

bool Economy::start_gather(int r, const Order &o) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const Kind k = E.kind(o.target);
	const int s = E.slot(o.target);
	if (s < 0 || !unit_def(U.type[r]).gatherer) return false;
	int res;
	if (k == K_RESOURCE) res = E.resources.res_type[s];
	else if (k == K_BUILDING && building_def(E.buildings.type[s]).farm && E.buildings.built[s] && E.buildings.owner[s] == U.owner[r]) {
		BuildingStore &B = E.buildings;
		const int32_t f = B.farmer[s];
		if (f && f != U.id[r]) {
			const int fr = E.unit_slot(f);
			if (fr >= 0 && U.order_target[fr] == B.id[s]) return false;
		}
		B.farmer[s] = U.id[r];
		res = RES_FOOD;
	} else return false;
	if (U.carry_amount[r] > 0 && U.carry_type[r] != res) {
		U.carry_type[r] = RES_NONE;
		U.carry_amount[r] = 0;
	}
	set_econ(r, EP_TO_RES, o.target, res, 0, 0.4);
	approach(r, o.target);
	return true;
}

void Economy::approach(int r, int32_t id) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	Movement &mv = sim->movement;
	const int s = E.slot(id);
	if (s < 0) return;
	if (E.kind(id) == K_BUILDING) {
		const BuildingStore &B = E.buildings;
		if (building_def(B.type[s]).farm) {
			double x, z;
			farm_spot(s, x, z);
			mv.move_to(r, x, z);
		} else {
			GoalRect g{ (double)B.tx[s], (double)B.tz[s], (double)B.w[s], (double)B.h[s] };
			mv.move_to(r, B.x[s], B.z[s], &g);
		}
		return;
	}
	const ResourceStore &R = E.resources;
	if (is_animal_type(R.type[s]) && R.alive[s]) {
		mv.move_to(r, R.x[s], R.z[s], nullptr, HUNT_RANGE - 0.4);
		U.econ_hunt[r] = 1;
		U.econ_hunt_x[r] = R.x[s];
		U.econ_hunt_z[r] = R.z[s];
	} else {
		GoalRect g{ R.x[s] - R.w[s] / 2.0, R.z[s] - R.h[s] / 2.0, (double)R.w[s], (double)R.h[s] };
		mv.move_to(r, R.x[s], R.z[s], &g);
	}
}

int32_t Economy::nearest_resource(double x, double z, int res, double max_dist, int32_t exclude) {
	ScopedTimer tm(sim->prof.enabled ? &sim->prof.calls["nearestResource"].second : nullptr);
	if (sim->prof.enabled) sim->prof.calls["nearestResource"].first++;
	const ResourceStore &R = sim->entities.resources;
	const double now = sim->time;
	double bd = max_dist * max_dist;
	int32_t best = 0;
	auto consider = [&](int32_t id) {
		const int s = sim->entities.resource_slot(id);
		if (s < 0 || R.res_type[s] != res || id == exclude || R.amount[s] <= 0) return;
		if (!std::isnan(R.econ_unreach_t[s]) && now - R.econ_unreach_t[s] < UNREACH_FORGET) return;
		const double dx = R.x[s] - x, dz = R.z[s] - z;
		const double d = dx * dx + dz * dz;
		if (d < bd || (d == bd && best && id < best)) {
			bd = d;
			best = id;
		}
	};
	if (res >= 0 && res <= RES_GOLD) {
		const int c0x = std::max(0, (int)std::floor((x - max_dist) / CELL)), c1x = std::min(ncell - 1, (int)std::floor((x + max_dist) / CELL));
		const int c0z = std::max(0, (int)std::floor((z - max_dist) / CELL)), c1z = std::min(ncell - 1, (int)std::floor((z + max_dist) / CELL));
		for (int cz = c0z; cz <= c1z; cz++)
			for (int cx = c0x; cx <= c1x; cx++)
				for (int32_t id : cells[res][cz * ncell + cx]) consider(id);
	}
	if (res == RES_FOOD)
		for (int32_t id : wildlife.animals) consider(id);
	return best;
}

int32_t Economy::nearest_dropoff(int owner, double x, double z, int res) {
	ScopedTimer tm(sim->prof.enabled ? &sim->prof.calls["nearestDropoff"].second : nullptr);
	if (sim->prof.enabled) sim->prof.calls["nearestDropoff"].first++;
	if (owner < 0 || owner >= MAX_PLAYERS) return 0;
	const BuildingStore &B = sim->entities.buildings;
	double bd = INFINITY;
	int32_t best = 0;
	for (int32_t id : dropoffs[owner]) {
		const int s = sim->entities.building_slot(id);
		if (s < 0 || !B.built[s] || !building_def(B.type[s]).drops(res)) continue;
		const double dx = B.x[s] - x, dz = B.z[s] - z;
		const double d = dx * dx + dz * dz;
		if (d < bd || (d == bd && best && id < best)) {
			bd = d;
			best = id;
		}
	}
	return best;
}

// ---- training ------------------------------------------------------------------

Result Economy::train(int b, int type) {
	BuildingStore &B = sim->entities.buildings;
	if (b < 0 || B.removed[b] || type < 0 || type >= U_TYPE_COUNT) return { false, "Cannot train here" };
	Player &p = sim->players[B.owner[b]];
	const UnitDef &def = unit_def(type);
	if (!B.built[b] || !building_def(B.type[b]).trains_type(type)) return { false, "Cannot train here" };
	if (def.min_age > p.age) return { false, std::string("Requires ") + AGES[def.min_age] + " Age" };
	if (B.queue[b].size() >= 10) return { false, "Queue full" };
	recount();
	if (p.pop + def.pop > p.pop_cap) return { false, "Need more houses" };
	if (!p.pay(def.cost)) return { false, "Not enough resources" };
	B.queue[b].push_back({ (uint8_t)type, 0, def.train_time });
	p.pop += def.pop;
	Event e;
	e.type = EV_RESOURCES_CHANGED;
	e.owner = B.owner[b];
	sim->events.emit(e);
	return { true, "" };
}

void Economy::cancel_train(int b, int i) {
	BuildingStore &B = sim->entities.buildings;
	if (b < 0 || B.removed[b] || i < 0 || i >= (int)B.queue[b].size()) return;
	const int type = B.queue[b][i].type;
	B.queue[b].erase(B.queue[b].begin() + i);
	sim->players[B.owner[b]].refund(unit_def(type).cost);
}

bool Economy::next_age_cost(int owner, Cost &out) const {
	const Player &p = sim->players[owner];
	if (p.age + 1 > 3) return false;
	out = age_cost(p.age + 1);
	return true;
}

Result Economy::advance_age(int owner) {
	if (owner < 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists) return { false, "No such player" };
	Player &p = sim->players[owner];
	if (p.advancing) return { false, "Already advancing" };
	if (p.age + 1 > 3) return { false, "Final age reached" };
	const Cost &cost = age_cost(p.age + 1);
	const BuildingStore &B = sim->entities.buildings;
	bool has_tc = false;
	for (int b = 0; b < B.size() && !has_tc; b++)
		if (!B.removed[b] && B.owner[b] == owner && B.built[b] && building_def(B.type[b]).age_up) has_tc = true;
	if (!has_tc) return { false, "Need a Town Center" };
	if (!p.pay(cost)) return { false, "Not enough resources" };
	p.advancing = true;
	p.advancing_t = 0;
	p.advancing_total = AGE_TIME[p.age + 1];
	return { true, "" };
}

int Economy::spawn_from_building(int b, int type) {
	Entities &E = sim->entities;
	const BuildingStore &B = E.buildings;
	const double fx = B.x[b], fz = B.tz[b] + B.h[b] + 0.6;
	int tx, tz;
	if (!sim->pathfinder.nearest_walkable((int)std::floor(fx), (int)std::floor(fz), 10, tx, tz)) {
		tx = (int)std::floor(fx);
		tz = (int)std::floor(fz);
	}
	const int owner = B.owner[b];
	const bool rally = B.rally[b];
	const double rx = B.rally_x[b], rz = B.rally_z[b];
	const int32_t rt = B.rally_target[b];
	int u = sim->units.spawn(type, owner, tx + 0.5, tz + 0.5, 0);
	if (rally) {
		const int ts = rt ? E.resource_slot(rt) : -1;
		if (ts >= 0 && unit_def(type).gatherer) sim->commands.order(u, Order::with_target(O_GATHER, rt));
		else sim->commands.order(u, Order::move(rx, rz));
	}
	Event e;
	e.type = EV_UNIT_TRAINED;
	e.kind = K_UNIT;
	e.id = E.units.id[u];
	e.owner = owner;
	e.a = type;
	e.x = E.units.x[u];
	e.z = E.units.z[u];
	sim->events.emit(e);
	return u;
}

// Recompute population (living units + queued) and population cap.
void Economy::recount() {
	for (auto &p : sim->players) {
		p.pop = 0;
		p.pop_cap = 0;
	}
	const UnitStore &U = sim->entities.units;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r]) sim->players[U.owner[r]].pop += unit_def(U.type[r]).pop;
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b]) continue;
		Player &p = sim->players[B.owner[b]];
		const BuildingDef &d = building_def(B.type[b]);
		if (B.built[b] && d.pop) p.pop_cap += d.pop;
		for (const TrainItem &q : B.queue[b]) p.pop += unit_def(q.type).pop;
	}
	for (auto &p : sim->players) p.pop_cap = std::min(POP_MAX, p.pop_cap);
}

// ---- simulation ------------------------------------------------------------------

void Economy::update(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	Movement &mv = sim->movement;
	wildlife.update(dt);
	fishing.update(dt);
	update_spears(dt);
	int worshippers[MAX_PLAYERS] = { 0 };
	const int n = U.size();
	for (int r = 0; r < n; r++) {
		if (U.removed[r] || U.dead[r]) continue;
		const int ot = U.order_type[r];
		if (ot == O_GATHER || ot == O_DROPOFF) update_gatherer(r, dt);
		else if (ot == O_WORSHIP) {
			const int32_t tid = U.econ_phase[r] == EP_NONE ? 0 : U.econ_temple[r];
			const int t = E.building_slot(tid);
			if (t < 0) {
				sim->commands.idle(r);
				continue;
			}
			if (U.moving[r]) continue;
			if (mv.distance_to(r, tid) > 1.4) {
				if (++U.econ_tries[r] > 5) {
					sim->commands.idle(r);
					continue;
				}
				const BuildingStore &B = E.buildings;
				GoalRect g{ (double)B.tx[t], (double)B.tz[t], (double)B.w[t], (double)B.h[t] };
				mv.move_to(r, B.x[t], B.z[t], &g);
				continue;
			}
			U.rot[r] = jsm::atan2(E.buildings.x[t] - U.x[r], E.buildings.z[t] - U.z[r]);
			U.anim_want[r] = A_WORSHIP;
			if (E.buildings.built[t]) worshippers[U.owner[r]]++;
		}
	}
	// favor
	for (int id = 0; id < MAX_PLAYERS; id++) {
		Player &p = sim->players[id];
		if (!p.exists) continue;
		const int k = worshippers[id];
		if (k) p.res[RES_FAVOR] = std::min(200.0, p.res[RES_FAVOR] + 0.1 * jsm::pow(k, 0.85) * dt);
	}
	// training queues
	BuildingStore &B = E.buildings;
	const int nb = B.size();
	for (int b = 0; b < nb; b++) {
		if (B.removed[b] || !B.built[b] || B.queue[b].empty()) continue;
		TrainItem &q = B.queue[b][0];
		q.t += dt;
		if (q.t >= q.total) {
			const int type = q.type;
			B.queue[b].erase(B.queue[b].begin());
			sim->players[B.owner[b]].pop -= unit_def(type).pop; // re-counted below
			spawn_from_building(b, type);
		}
	}
	recount();
	// age advancement
	for (int id = 0; id < MAX_PLAYERS; id++) {
		Player &p = sim->players[id];
		if (!p.exists || !p.advancing) continue;
		p.advancing_t += dt;
		if (p.advancing_t >= p.advancing_total) {
			p.advancing = false;
			p.age = std::min(3, p.age + 1);
			Event e;
			e.type = EV_AGE_ADVANCED;
			e.owner = id;
			e.a = p.age;
			sim->events.emit(e);
		}
	}
}

void Economy::update_gatherer(int r, double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	ResourceStore &R = E.resources;
	BuildingStore &B = E.buildings;
	Movement &mv = sim->movement;
	if (U.econ_phase[r] == EP_NONE) { // !u.econ
		sim->commands.idle(r);
		return;
	}
	const UnitDef &ud = unit_def(U.type[r]);
	const double cap = ud.carry_cap != 0 ? ud.carry_cap : 10;
	const int ph = U.econ_phase[r];
	if (ph == EP_TO_RES || ph == EP_GATHERING) {
		int32_t tid = U.econ_res[r];
		Kind tk = E.kind(tid);
		int t = E.slot(tid);
		if (t < 0 || (tk == K_RESOURCE && R.amount[t] <= 0)) {
			tid = nearest_resource(U.x[r], U.z[r], U.econ_res_type[r], 14);
			if (!tid) {
				if (U.carry_amount[r] > 0) return go_drop(r);
				sim->commands.idle(r);
				return;
			}
			U.econ_res[r] = tid;
			U.econ_phase[r] = EP_TO_RES;
			U.econ_tries[r] = 0;
			approach(r, tid);
			return;
		}
		const bool animal = tk == K_RESOURCE && is_animal_type(R.type[t]);
		// ---- hunting a live animal: close to throwing range, then spear it
		if (animal && R.alive[t]) {
			const double d = jsm::hypot(R.x[t] - U.x[r], R.z[t] - U.z[r]);
			if (d > HUNT_RANGE) {
				const bool moved = !U.econ_hunt[r] || jsm::hypot(U.econ_hunt_x[r] - R.x[t], U.econ_hunt_z[r] - R.z[t]) > 1.2;
				if (!U.moving[r] || moved) {
					if (!U.moving[r] && ++U.econ_tries[r] > 40) {
						R.econ_unreach_t[t] = sim->time;
						sim->commands.idle(r);
						return;
					}
					approach(r, tid);
				}
				return;
			}
			if (U.moving[r]) mv.stop(r);
			U.econ_phase[r] = EP_GATHERING;
			U.rot[r] = jsm::atan2(R.x[t] - U.x[r], R.z[t] - U.z[r]);
			U.anim_want[r] = A_ATTACK;
			U.econ_throw_cd[r] -= dt;
			if (U.econ_throw_cd[r] <= 0) {
				U.econ_throw_cd[r] = SPEAR_CD;
				U.anim_attack_t[r] = 0;
				throw_spear(r, t);
			}
			return;
		}
		if (U.moving[r]) return;
		const bool farm = tk == K_BUILDING && building_def(B.type[t]).farm;
		const bool in_reach = farm ? in_farm(r, t) : mv.distance_to(r, tid) <= 1.1;
		if (!in_reach) {
			if (++U.econ_tries[r] > 6) {
				// unreachable: remember that, and try a different node
				if (!farm && tk == K_RESOURCE) R.econ_unreach_t[t] = sim->time;
				const int32_t alt = farm ? 0 : nearest_resource(U.x[r], U.z[r], U.econ_res_type[r], 14, tid);
				if (!alt) {
					sim->commands.idle(r);
					return;
				}
				U.econ_res[r] = alt;
				U.econ_tries[r] = 0;
				approach(r, alt);
				return;
			}
			approach(r, tid);
			return;
		}
		U.econ_phase[r] = EP_GATHERING;
		U.econ_tries[r] = 0;
		if (farm) {
			// follow the harvest front along the row
			double fx, fz;
			farm_spot(t, fx, fz);
			if (jsm::hypot(fx - U.x[r], fz - U.z[r]) > 1.25) {
				mv.move_to(r, fx, fz);
				return;
			}
			const bool back = std::fmod(std::floor(B.econ_rows[t] / FARM_ROWS), 2.0) == 1;
			U.rot[r] = back ? -PI / 2 : PI / 2;
		} else {
			const double tx = tk == K_RESOURCE ? R.x[t] : B.x[t], tz = tk == K_RESOURCE ? R.z[t] : B.z[t];
			U.rot[r] = jsm::atan2(tx - U.x[r], tz - U.z[r]);
		}
		U.anim_want[r] = A_GATHER;
		const int rt = U.econ_res_type[r];
		double base;
		if (farm) base = FARM_RATE;
		else if (animal) base = ud.gather_rate[RES_FOOD] * 1.35;
		else base = rt <= RES_GOLD ? ud.gather_rate[rt] : NAN;
		const double rate = base * dt;
		U.carry_type[r] = (uint8_t)rt;
		U.carry_amount[r] = std::min(cap, U.carry_amount[r] + rate);
		if (farm) B.econ_rows[t] = B.econ_rows[t] + rate / FOOD_PER_ROW;
		if (tk == K_RESOURCE) {
			R.amount[t] -= rate;
			if (R.amount[t] <= 0) {
				if (animal) E.remove(tid);
				else sim->remove_resource(tid);
			}
		}
		if (U.carry_amount[r] >= cap) go_drop(r);
	} else if (ph == EP_TO_DROP) {
		int d = E.building_slot(U.econ_drop[r]);
		if (d < 0) {
			go_drop(r);
			d = E.building_slot(U.econ_drop[r]);
			if (d < 0) return;
		}
		if (U.moving[r]) return;
		if (mv.distance_to(r, B.id[d]) > 1.5) {
			if (++U.econ_tries[r] > 6) {
				sim->commands.idle(r);
				return;
			}
			GoalRect g{ (double)B.tx[d], (double)B.tz[d], (double)B.w[d], (double)B.h[d] };
			mv.move_to(r, B.x[d], B.z[d], &g);
			return;
		}
		Player &p = sim->players[U.owner[r]];
		const int ct = U.carry_type[r];
		if (U.carry_amount[r] > 0 && ct != RES_NONE) {
			p.res[ct] += std::floor(U.carry_amount[r] * 100) / 100;
			int kind;
			if (ct == RES_WOOD) kind = ST_WOOD;
			else if (ct == RES_GOLD) kind = ST_GOLD;
			else {
				const int32_t src = U.econ_res[r];
				const int ss = E.slot(src);
				if (ss >= 0 && E.kind(src) == K_BUILDING && building_def(B.type[ss]).farm) kind = ST_GRAIN;
				else if (ss >= 0 && E.kind(src) == K_RESOURCE && is_animal_type(R.type[ss])) kind = ST_MEAT;
				else kind = ST_FRUIT;
			}
			double *stock[ST_COUNT] = { &B.stock_grain[d], &B.stock_fruit[d], &B.stock_meat[d], &B.stock_fish[d], &B.stock_wood[d], &B.stock_gold[d] };
			*stock[kind] += U.carry_amount[r];
			Event e;
			e.type = EV_RESOURCES_CHANGED;
			e.owner = U.owner[r];
			sim->events.emit(e);
		}
		U.carry_type[r] = RES_NONE;
		U.carry_amount[r] = 0;
		if (U.order_type[r] == O_DROPOFF || !U.econ_res[r]) {
			sim->commands.idle(r);
			return;
		}
		U.econ_phase[r] = EP_TO_RES;
		U.econ_tries[r] = 0;
		if (E.slot(U.econ_res[r]) >= 0) approach(r, U.econ_res[r]);
	}
}

void Economy::throw_spear(int u, int a) {
	const UnitStore &U = sim->entities.units;
	const ResourceStore &R = sim->entities.resources;
	const GameMap &map = sim->map();
	Spear s;
	s.y0 = map.height_at(U.x[u], U.z[u]) + 1.5;
	const double d = jsm::hypot(R.x[a] - U.x[u], R.z[a] - U.z[u]);
	s.dur = 0.25 + d * 0.09;
	// lead the target a little
	s.x1 = R.x[a] + (R.x[a] - R.prev_x[a]) * s.dur * 30;
	s.z1 = R.z[a] + (R.z[a] - R.prev_z[a]) * s.dur * 30;
	s.x0 = U.x[u];
	s.z0 = U.z[u];
	s.y1 = map.height_at(s.x1, s.z1) + 0.5;
	s.t = 0;
	s.target = R.id[a];
	s.from = U.id[u];
	s.hit = false;
	spears.push_back(s);
}

void Economy::update_spears(double dt) {
	Entities &E = sim->entities;
	for (int i = (int)spears.size() - 1; i >= 0; i--) {
		Spear &s = spears[i];
		s.t += dt;
		if (s.t >= s.dur && !s.hit) {
			s.hit = true;
			const int t = E.resource_slot(s.target);
			const int u = E.unit_slot(s.from);
			const ResourceStore &R = E.resources;
			if (t >= 0 && R.alive[t] && jsm::hypot(R.x[t] - s.x1, R.z[t] - s.z1) < 1.6)
				wildlife.hit(t, SPEAR_DMG, u >= 0 ? E.units.x[u] : s.x0, u >= 0 ? E.units.z[u] : s.z0);
		}
		if (s.t > s.dur + 1.2) spears.erase(spears.begin() + i);
	}
}

void Economy::go_drop(int r) {
	UnitStore &U = sim->entities.units;
	const int32_t d = nearest_dropoff(U.owner[r], U.x[r], U.z[r], U.carry_type[r]);
	if (!d) {
		sim->commands.idle(r);
		return;
	}
	U.econ_phase[r] = EP_TO_DROP;
	U.econ_drop[r] = d;
	U.econ_tries[r] = 0;
	const BuildingStore &B = sim->entities.buildings;
	const int b = sim->entities.building_slot(d);
	GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
	sim->movement.move_to(r, B.x[b], B.z[b], &g);
}

} // namespace aov
