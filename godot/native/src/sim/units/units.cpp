#include "units.h"

#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

int Units::spawn(int type, int owner, double x, double z, double rot) {
	const UnitDef &def = unit_def(type);
	const double anim_t = sim->rng.range(0, 10); // consumed like the JS object literal
	Entities &E = sim->entities;
	int r = E.new_unit();
	UnitStore &U = E.units;
	U.type[r] = (uint8_t)type;
	U.owner[r] = (uint8_t)owner;
	U.x[r] = U.prev_x[r] = x;
	U.z[r] = U.prev_z[r] = z;
	U.rot[r] = U.prev_rot[r] = rot;
	U.hp[r] = U.max_hp[r] = def.hp;
	U.speed[r] = def.speed;
	U.radius[r] = def.radius;
	U.sight[r] = def.sight;
	U.anim_t[r] = anim_t;
	E.added(U.id[r]);
	return E.unit_slot(U.id[r]);
}

void Units::update(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const int n = U.size(); // snapshot: units spawned during the loop wait a tick
	for (int r = 0; r < n; r++) {
		if (U.removed[r]) continue;
		U.anim_t[r] += dt;
		if (U.flash_t[r] > 0) U.flash_t[r] = std::max(0.0, U.flash_t[r] - dt);
		U.anim_attack_t[r] += dt;
		if (!std::isnan(U.hit_t[r])) U.hit_t[r] += dt;
		if (!std::isnan(U.last_hp[r]) && U.hp[r] < U.last_hp[r] - 0.01 && !U.dead[r]) {
			U.hit_t[r] = 0;
			U.hit_n[r]++;
		}
		U.last_hp[r] = U.hp[r];
		if (U.dead[r]) {
			U.anim_state[r] = A_DIE;
			U.anim_die_t[r] += dt;
			if (U.anim_die_t[r] > CORPSE_TIME) E.remove(U.id[r]);
			continue;
		}
		U.anim_state[r] = U.moving[r] ? A_WALK : (U.anim_want[r] != A_NONE ? U.anim_want[r] : A_IDLE);
		U.anim_want[r] = A_NONE;
	}
	ScopedTimer t(sim->prof.enabled ? &sim->prof.sub["units.spread"] : nullptr);
	spread(dt);
}

void Units::spread(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const GameMap &map = sim->map();
	const SpatialHash &hash = sim->movement.hash;
	if (hash.n == 0) return;
	const double max_step = SPREAD_SPEED * dt;
	const int n = U.size();
	for (int r = 0; r < n; r++) {
		if (U.removed[r]) continue;
		if (U.dead[r]) { clear_corpse(r, dt); continue; }
		if (U.moving[r]) continue;
		const int ot = U.order_type[r];
		if (unit_def(U.type[r]).gatherer && ot != O_IDLE && ot != O_ATTACK) continue;
		const double rad = U.radius[r] != 0 ? U.radius[r] : 0.3;
		const double ux = U.x[r], uz = U.z[r];
		const bool uline = U.combat_line[r];
		const int32_t uid = U.id[r];
		double sx = 0, sz = 0;
		sim->movement.hash.count_query(ux, uz, rad + 2);
		hash.for_each_near(ux, uz, rad + 2, [&](int o) {
			if (o == r || U.dead[o]) return;
			const double ro = U.radius[o] != 0 ? U.radius[o] : 0.3;
			const double want = rad + ro + (uline && U.combat_line[o] ? 1.3 : SPREAD_GAP) * std::min(rad, ro);
			const double dx = ux - U.x[o], dz = uz - U.z[o];
			const double d2 = dx * dx + dz * dz;
			if (d2 >= want * want) return;
			const double d = std::sqrt(d2);
			const double w = (U.moving[o] ? 0.4 : 1) * std::min(2.0, ro / rad);
			const double k = ((want - d) / want) * w;
			if (d < 1e-4) {
				sx += (uid % 2 ? 1 : -1) * k;
				sz += (uid % 3 ? 1 : -1) * k;
			} else {
				sx += (dx / d) * k;
				sz += (dz / d) * k;
			}
		});
		if (sx == 0 && sz == 0) continue;
		double vx = sx * 5 * dt, vz = sz * 5 * dt;
		const double m = jsm::hypot(vx, vz);
		if (m > max_step) {
			vx *= max_step / m;
			vz *= max_step / m;
		}
		const double nx = U.x[r] + vx, nz = U.z[r] + vz;
		if (map.is_walkable((int)std::floor(nx), (int)std::floor(nz))) {
			U.x[r] = nx;
			U.z[r] = nz;
		}
	}
}

void Units::clear_corpse(int r, double dt) {
	UnitStore &U = sim->entities.units;
	const double rad = (U.radius[r] != 0 ? U.radius[r] : 0.3) * 1.4;
	const double ux = U.x[r], uz = U.z[r];
	const int32_t uid = U.id[r];
	double sx = 0, sz = 0;
	sim->movement.hash.count_query(ux, uz, rad + 1.5);
	sim->movement.hash.for_each_near(ux, uz, rad + 1.5, [&](int o) {
		if (o == r || U.dead[o]) return;
		const double want = rad + (U.radius[o] != 0 ? U.radius[o] : 0.3) * 1.2;
		const double dx = ux - U.x[o], dz = uz - U.z[o];
		const double d = jsm::hypot(dx, dz);
		if (d >= want) return;
		const double k = (want - d) / want;
		if (d < 1e-4) {
			sx += (uid % 2 ? 1 : -1) * k;
			sz += (uid % 3 ? 1 : -1) * k;
		} else {
			sx += (dx / d) * k;
			sz += (dz / d) * k;
		}
	});
	if (sx == 0 && sz == 0) return;
	const double m = jsm::hypot(sx, sz), step = std::min(m, 1.0) * CORPSE_CLEAR * dt;
	const double nx = U.x[r] + (sx / m) * step, nz = U.z[r] + (sz / m) * step;
	if (sim->map().is_walkable((int)std::floor(nx), (int)std::floor(nz))) {
		U.prev_x[r] = U.x[r] = nx;
		U.prev_z[r] = U.z[r] = nz;
	}
}

} // namespace aov
