#include "commands.h"

#include <algorithm>
#include <cmath>

#include "../sim.h"
#include "jsmath.h"

namespace aov {

void Commands::init(Sim *s) {
	sim = s;
	for (int i = 0; i < O_TYPE_COUNT; i++) {
		start_[i] = nullptr;
		cancel_[i] = nullptr;
	}
	register_handler(O_IDLE, [this](int r, const Order &) { sim->movement.stop(r); return true; });
	register_handler(O_MOVE, [this](int r, const Order &o) { sim->movement.move_to(r, o.x, o.z); return true; });
}

void Commands::register_handler(OrderType t, StartFn start, CancelFn cancel) {
	start_[t] = std::move(start);
	cancel_[t] = std::move(cancel);
}

Order Commands::get(int r) const {
	const UnitStore &U = sim->entities.units;
	Order o;
	o.type = U.order_type[r];
	o.target = U.order_target[r];
	o.x = U.order_x[r];
	o.z = U.order_z[r];
	o.a = U.order_a[r];
	o.b = U.order_b[r];
	o.c = U.order_c[r];
	return o;
}

void Commands::set(int r, const Order &o) {
	UnitStore &U = sim->entities.units;
	U.order_type[r] = o.type;
	U.order_target[r] = o.target;
	U.order_x[r] = o.x;
	U.order_z[r] = o.z;
	U.order_a[r] = o.a;
	U.order_b[r] = o.b;
	U.order_c[r] = o.c;
	U.am_resume[r] = 0; // (a new order ends any fight-then-resume, see Combat::engage)
}

bool Commands::order(int r, const Order &o) {
	UnitStore &U = sim->entities.units;
	if (r < 0 || U.removed[r] || U.dead[r]) return false;
	if (!has_handler(o.type)) return false; // JS: console.warn('No handler for order')
	const Order prev = get(r);
	set(r, o);
	if (prev.type != o.type && cancel_[prev.type]) cancel_[prev.type](r, prev);
	const bool ok = start_[o.type](r, o);
	if (!ok) {
		set(r, Order::idle());
		start_[O_IDLE](r, Order::idle());
	}
	return ok;
}

void Commands::move(const std::vector<int> &rows, double x, double z, uint8_t type, int32_t b) {
	UnitStore &U = sim->entities.units;
	std::vector<int> list;
	list.reserve(rows.size());
	for (int r : rows)
		if (r >= 0 && !U.removed[r] && !U.dead[r]) list.push_back(r);
	if (list.empty()) return;
	const int n = (int)list.size();
	const int cols = (int)std::ceil(std::sqrt((double)n));
	const double spacing = 1.15;
	double cx = 0, cz = 0;
	for (int r : list) { cx += U.x[r]; cz += U.z[r]; }
	cx /= n;
	cz /= n;
	const double ang = jsm::atan2(x - cx, z - cz);
	const double ca = jsm::cos(ang), sa = jsm::sin(ang);
	std::stable_sort(list.begin(), list.end(), [&](int a, int b) { return U.id[a] < U.id[b]; });
	const double nrows = std::ceil((double)n / cols);
	Pathfinder &pf = sim->pathfinder;
	const bool field = pf.group_min > 0 && n >= pf.group_min;
	if (field) {
		std::vector<Vec2d> starts;
		starts.reserve(n);
		for (int r : list) starts.push_back({ U.x[r], U.z[r] });
		pf.begin_group_field(x, z, starts);
	}
	for (int i = 0; i < n; i++) {
		const int r = list[i];
		const int col = i % cols, row = (int)std::floor((double)i / cols);
		const double big = U.radius[r] > 0.5 ? 1.8 : 1;
		const double ox = (col - (cols - 1) / 2.0) * spacing * big;
		const double oz = -(row - (nrows - 1) / 2) * spacing * big;
		const double wx = x + ox * ca + oz * sa, wz = z - ox * sa + oz * ca;
		Order o = Order::move(n == 1 ? x : wx, n == 1 ? z : wz);
		o.type = type;
		o.b = b;
		order(r, o);
	}
	if (field) pf.end_group_field();
}

void Commands::smart(const std::vector<int> &rows, double x, double z, int32_t target_id) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	std::vector<int> movers;
	const Kind tk = E.kind(target_id);
	const int ts = E.slot(target_id);
	bool tdead = true;
	int towner = 0;
	if (ts >= 0) {
		if (tk == K_UNIT) { tdead = U.dead[ts]; towner = U.owner[ts]; }
		else if (tk == K_BUILDING) { tdead = E.buildings.dead[ts]; towner = E.buildings.owner[ts]; }
		else if (tk == K_RESOURCE) { tdead = false; towner = GAIA; }
	}
	auto try_order = [&](int r, OrderType t) {
		if (!has_handler(t)) return false; // piece not ported yet: move there instead
		order(r, Order::with_target(t, target_id));
		return true;
	};
	int owner = -1;
	for (int r : rows) {
		if (r < 0 || U.removed[r] || U.dead[r]) continue;
		if (owner < 0) owner = U.owner[r];
		const UnitDef &d = unit_def(U.type[r]);
		if (ts >= 0 && !tdead && target_id != U.id[r]) {
			if (tk == K_RESOURCE && d.gatherer && try_order(r, O_GATHER)) continue;
			if (towner != U.owner[r] && towner != GAIA && d.has_attack && try_order(r, O_ATTACK)) continue;
			if (tk == K_BUILDING && towner == U.owner[r] && d.builder) {
				const BuildingStore &B = E.buildings;
				if (!B.built[ts]) { if (try_order(r, O_BUILD)) continue; }
				else if (B.def_flags[ts] & BF_WORSHIP) { if (try_order(r, O_WORSHIP)) continue; }
				else if (B.def_flags[ts] & BF_FARM) { if (try_order(r, O_GATHER)) continue; }
				else if (U.carry_amount[r] > 0 && (B.def_flags[ts] & BF_DROPOFF)) { if (try_order(r, O_DROPOFF)) continue; }
			}
		}
		movers.push_back(r);
	}
	if (!movers.empty()) move(movers, x, z);
	Event e;
	e.type = EV_COMMAND_SMART;
	e.owner = owner < 0 ? 0 : owner;
	e.other = target_id;
	e.x = x;
	e.z = z;
	e.a = (int)rows.size();
	sim->events.emit(e);
}

} // namespace aov
