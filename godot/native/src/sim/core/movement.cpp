#include "movement.h"

#include <algorithm>
#include <cmath>

#include "../sim.h"
#include "jsmath.h"

namespace aov {

static const double PI = 3.141592653589793; // Math.PI

void Movement::init(Sim *s) {
	sim = s;
	hash.init(s->map().world_size(), 3);
	repaths_this_tick = 0;
}

void Movement::release_path(int r) {
	UnitStore &U = sim->entities.units;
	if (U.path[r] >= 0) {
		sim->paths.release(U.path[r]);
		U.path[r] = -1;
	}
}

bool Movement::move_to(int r, double x, double z, const GoalRect *rect, double range) {
	UnitStore &U = sim->entities.units;
	if (U.path[r] < 0) U.path[r] = sim->paths.alloc();
	auto &path = sim->paths.at(U.path[r]);
	sim->pathfinder.find_path(U.x[r], U.z[r], x, z, rect, path);
	U.path_idx[r] = 0;
	U.has_goal[r] = 1;
	U.goal_x[r] = x;
	U.goal_z[r] = z;
	U.goal_range[r] = range;
	U.goal_has_rect[r] = rect ? 1 : 0;
	if (rect) {
		U.goal_rtx[r] = rect->tx;
		U.goal_rtz[r] = rect->tz;
		U.goal_rw[r] = rect->w;
		U.goal_rh[r] = rect->h;
	}
	U.moving[r] = path.size() > 0;
	U.arrived[r] = !U.moving[r];
	U.stuck_t[r] = 0;
	U.repaths[r] = 0;
	U.repath_pending[r] = 0;
	if (U.moving[r] && within_goal(r)) {
		U.moving[r] = 0;
		U.arrived[r] = 1;
	}
	return U.moving[r] || U.arrived[r];
}

void Movement::stop(int r) {
	UnitStore &U = sim->entities.units;
	U.moving[r] = 0;
	release_path(r);
	U.arrived[r] = 0;
	U.repath_pending[r] = 0;
}

bool Movement::within_goal(int r) const {
	const UnitStore &U = sim->entities.units;
	if (!U.has_goal[r]) return true;
	const double x = U.x[r], z = U.z[r];
	if (U.goal_has_rect[r]) {
		double dx = std::max(std::max(U.goal_rtx[r] - x, 0.0), x - (U.goal_rtx[r] + U.goal_rw[r]));
		double dz = std::max(std::max(U.goal_rtz[r] - z, 0.0), z - (U.goal_rtz[r] + U.goal_rh[r]));
		double rad = U.radius[r] != 0 ? U.radius[r] : 0.3;
		return jsm::hypot(dx, dz) <= std::max(0.75, U.goal_range[r]) + rad;
	}
	if (U.goal_range[r] > 0) return jsm::hypot(U.goal_x[r] - x, U.goal_z[r] - z) <= U.goal_range[r];
	return false;
}

double Movement::distance_to(int r, int32_t id) const {
	const Entities &E = sim->entities;
	const UnitStore &U = E.units;
	const double x = U.x[r], z = U.z[r];
	auto rect = [&](double tx, double tz, double w, double h) {
		double dx = std::max(std::max(tx - x, 0.0), x - (tx + w));
		double dz = std::max(std::max(tz - z, 0.0), z - (tz + h));
		return jsm::hypot(dx, dz);
	};
	int s = E.slot(id);
	if (s < 0) return 1e30;
	switch (E.kind(id)) {
		case K_BUILDING: return rect(E.buildings.tx[s], E.buildings.tz[s], E.buildings.w[s], E.buildings.h[s]);
		case K_RESOURCE: return rect(E.resources.tx[s], E.resources.tz[s], E.resources.w[s], E.resources.h[s]);
		case K_UNIT: {
			double rad = U.radius[s] != 0 ? U.radius[s] : 0.3;
			return std::max(0.0, jsm::hypot(U.x[s] - x, U.z[s] - z) - rad);
		}
		default: return 1e30;
	}
}

void Movement::repath(int r) {
	UnitStore &U = sim->entities.units;
	repaths_this_tick++;
	U.repath_pending[r] = 0;
	GoalRect gr{ U.goal_rtx[r], U.goal_rtz[r], U.goal_rw[r], U.goal_rh[r] };
	if (U.path[r] < 0) U.path[r] = sim->paths.alloc();
	auto &path = sim->paths.at(U.path[r]);
	sim->pathfinder.find_path(U.x[r], U.z[r], U.goal_x[r], U.goal_z[r], U.goal_has_rect[r] ? &gr : nullptr, path);
	U.path_idx[r] = 0;
	if (path.empty()) {
		U.moving[r] = 0;
		U.arrived[r] = 1;
	}
}

void Movement::update(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const GameMap &map = sim->map();
	// rows only move here, right before the hash is rebuilt (see entities.h)
	if (E.removed_pending) {
		for (int r = 0; r < U.size(); r++)
			if (U.removed[r]) release_path(r);
		E.compact();
	}
	const int n = U.size();
	for (int r = 0; r < n; r++) {
		U.prev_x[r] = U.x[r];
		U.prev_z[r] = U.z[r];
		U.prev_rot[r] = U.rot[r];
	}
	hash.rebuild(n, U.x.data(), U.z.data(), [&](int r) { return !U.dead[r] && !U.removed[r]; });
	repaths_this_tick = 0;
	const bool budgeted = repath_budget > 0;

	for (int r = 0; r < n; r++) {
		if (U.dead[r] || U.removed[r]) continue;
		// a finished 'move' order returns the unit to idle (so it can auto-engage)
		if (!U.moving[r] && U.order_type[r] == O_MOVE) sim->commands.set_idle_fields(r);
		double vx = 0, vz = 0;
		const double speed = U.speed[r] * U.speed_mul[r];
		if (U.repath_pending[r] && U.moving[r] && (!budgeted || repaths_this_tick < repath_budget)) repath(r);
		if (U.moving[r] && U.path[r] >= 0) {
			if (within_goal(r)) {
				U.moving[r] = 0;
				U.arrived[r] = 1;
			} else {
				const auto &path = sim->paths.at(U.path[r]);
				const Vec2d *wp = &path[U.path_idx[r]];
				double dx = wp->x - U.x[r], dz = wp->z - U.z[r], d = jsm::hypot(dx, dz);
				const bool last = U.path_idx[r] == (int)path.size() - 1;
				if (!last && d < 0.5) {
					U.path_idx[r]++;
					wp = &path[U.path_idx[r]];
					dx = wp->x - U.x[r];
					dz = wp->z - U.z[r];
					d = jsm::hypot(dx, dz);
				}
				if (last && d < 0.12) {
					U.moving[r] = 0;
					U.arrived[r] = 1;
				} else {
					const double s = std::min(speed, d / dt);
					vx = (dx / d) * s;
					vz = (dz / d) * s;
				}
			}
		}
		// separation
		const double rad = U.radius[r] != 0 ? U.radius[r] : 0.3;
		const double ux = U.x[r], uz = U.z[r];
		const bool umoving = U.moving[r];
		const int32_t uid = U.id[r];
		double sx = 0, sz = 0;
		hash.count_query(ux, uz, rad + 1);
		hash.for_each_near(ux, uz, rad + 1, [&](int o) {
			if (o == r || U.dead[o]) return;
			const double dx = ux - U.x[o], dz = uz - U.z[o];
			const double min = rad + (U.radius[o] != 0 ? U.radius[o] : 0.3);
			const double d2 = dx * dx + dz * dz;
			if (d2 >= min * min) return;
			double d = std::sqrt(d2);
			if (d == 0) d = 0.001;
			const double push = (min - d) / min;
			const double w = umoving ? 1.0 : (U.moving[o] ? 1.6 : 0.8);
			sx += (d2 == 0 ? (uid % 2 ? 1 : -1) : dx / d) * push * w;
			sz += (d2 == 0 ? (uid % 3 ? 1 : -1) : dz / d) * push * w;
		});
		vx += sx * 4;
		vz += sz * 4;
		if (vx == 0 && vz == 0) continue;
		const double nx = U.x[r] + vx * dt, nz = U.z[r] + vz * dt;
		if (map.is_walkable((int)std::floor(nx), (int)std::floor(nz))) { U.x[r] = nx; U.z[r] = nz; }
		else if (map.is_walkable((int)std::floor(nx), (int)std::floor(U.z[r]))) U.x[r] = nx;
		else if (map.is_walkable((int)std::floor(U.x[r]), (int)std::floor(nz))) U.z[r] = nz;
		else if (!map.is_walkable((int)std::floor(U.x[r]), (int)std::floor(U.z[r]))) { U.x[r] = nx; U.z[r] = nz; } // escape if embedded
		if (U.moving[r]) {
			const double want = jsm::atan2(vx, vz);
			double dr = want - U.rot[r];
			while (dr > PI) dr -= PI * 2;
			while (dr < -PI) dr += PI * 2;
			U.rot[r] += dr * std::min(1.0, dt * 12);
			// stuck detection
			const double moved = jsm::hypot(U.x[r] - U.prev_x[r], U.z[r] - U.prev_z[r]);
			if (moved < speed * dt * 0.25) U.stuck_t[r] += dt;
			else U.stuck_t[r] = std::max(0.0, U.stuck_t[r] - dt);
			if (U.stuck_t[r] > 1.2) {
				U.stuck_t[r] = 0;
				if (++U.repaths[r] > 3) {
					U.moving[r] = 0;
					U.arrived[r] = 1;
				} else if (!budgeted || repaths_this_tick < repath_budget) {
					repath(r);
				} else {
					U.repath_pending[r] = 1;
				}
			}
		}
	}
}

} // namespace aov
