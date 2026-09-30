// Port of src/economy/Wildlife.js: huntable animals. Each animal is a
// resource entity (resType food, never blocking tiles) so the gather order,
// right-click and AI treat it as a food node: while alive it is hunted
// (spears thrown from range), once dead it is a carcass butchered like any
// other node.
#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"
#include "economy.h"

namespace aov {

static const double PI = 3.141592653589793;

const AnimalDef &animal_def(int t) {
	// ANIMAL_DEFS: hp, speed, fleeSpeed, flees, radius (amounts in resource_def)
	static const AnimalDef deer{ 8, 1.0, 4.2, true, 0.5 };
	static const AnimalDef boar{ 22, 0.7, 2.2, false, 0.55 };
	return t == R_BOAR ? boar : deer;
}

void Wildlife::init(Sim *s) {
	sim = s;
	spawned = false;
	homes.clear();
	animals.clear();
}

int32_t Wildlife::spawn(int type, double x, double z, int home, double rot) {
	const ResourceDef &rd = resource_def(type);
	const AnimalDef &ad = animal_def(type);
	Entities &E = sim->entities;
	int r = E.new_resource();
	ResourceStore &R = E.resources;
	R.type[r] = (uint8_t)type;
	R.res_type[r] = rd.res_type;
	R.amount[r] = R.max_amount[r] = rd.amount;
	R.w[r] = 1;
	R.h[r] = 1;
	R.x[r] = R.prev_x[r] = x;
	R.z[r] = R.prev_z[r] = z;
	R.tx[r] = (int32_t)std::floor(x - 0.5); // (the JS keeps x - 0.5; rects use x - w / 2)
	R.tz[r] = (int32_t)std::floor(z - 0.5);
	R.rot[r] = R.prev_rot[r] = rot;
	R.hp[r] = R.max_hp[r] = ad.hp;
	R.radius[r] = ad.radius;
	R.alive[r] = 1;
	R.flash_t[r] = 0;
	if (home < 0) {
		homes.push_back({ x, z, -1 });
		home = (int)homes.size() - 1;
	}
	R.an_home[r] = home;
	R.an_goal[r] = 0;
	R.an_wait[r] = 0;
	R.an_flee[r] = 0;
	R.an_dead_t[r] = 0;
	R.an_graze[r] = 0;
	const int32_t id = R.id[r];
	R.an_seed[r] = (uint32_t)((uint64_t)(uint32_t)id * 2654435761ull);
	E.added(id);
	animals.push_back(id);
	return id;
}

std::vector<int32_t> Wildlife::spawn_herd(int type, double x, double z, int n) {
	std::vector<int32_t> out;
	Mulberry32 rnd((uint32_t)(js_int32(std::floor(x * 131 + z * 977)) ^ 0x5eed));
	homes.push_back({ x, z, -1 });
	const int home = (int)homes.size() - 1;
	for (int i = 0; i < n; i++) {
		const double a = rnd.next() * PI * 2, r = 0.6 + rnd.next() * 2.2;
		double px, pz;
		if (walkable_near(x + jsm::cos(a) * r, z + jsm::sin(a) * r, px, pz)) out.push_back(spawn(type, px, pz, home, rnd.next() * PI * 2));
	}
	return out;
}

bool Wildlife::walkable_near(double x, double z, double &ox, double &oz) const {
	int wx, wz;
	const int fx = (int)std::floor(x), fz = (int)std::floor(z);
	if (!sim->pathfinder.nearest_walkable(fx, fz, 6, wx, wz)) return false;
	if (wx == fx && wz == fz) {
		ox = x;
		oz = z;
	} else {
		ox = wx + 0.5;
		oz = wz + 0.5;
	}
	return true;
}

void Wildlife::populate() {
	if (spawned) return;
	spawned = true;
	Mulberry32 rnd((uint32_t)js_int32((double)sim->map().seed * 7919 + 17));
	static const struct { int type; double dist; int n; } HERDS[3] = { { R_DEER, 17, 6 }, { R_DEER, 26, 5 }, { R_BOAR, 22, 2 } };
	for (const Start &s : sim->world.starts) {
		const double base = rnd.next() * PI * 2;
		for (int i = 0; i < 3; i++) {
			const double a = base + i * 2.1 + rnd.next() * 0.6;
			double px, pz;
			if (walkable_near(s.tx + jsm::cos(a) * HERDS[i].dist, s.tz + jsm::sin(a) * HERDS[i].dist, px, pz))
				spawn_herd(HERDS[i].type, px, pz, HERDS[i].n);
		}
	}
}

void Wildlife::hit(int a, double dmg, double ax, double az) {
	ResourceStore &R = sim->entities.resources;
	if (a < 0 || !R.alive[a] || R.removed[a]) return;
	R.hp[a] -= dmg;
	R.flash_t[a] = 0.25;
	if (R.hp[a] <= 0) {
		R.hp[a] = 0;
		R.alive[a] = 0;
		R.an_dead_t[a] = 0;
		R.an_goal[a] = 0;
		return; // (JS emits animal:killed; nothing in the sim listens)
	}
	if (animal_def(R.type[a]).flees) {
		R.an_flee[a] = 2.2;
		R.an_threat_x[a] = ax;
		R.an_threat_z[a] = az;
		// the whole herd startles
		for (int32_t id : animals) {
			const int o = sim->entities.resource_slot(id);
			if (o < 0 || o == a || !R.alive[o] || R.an_home[o] != R.an_home[a]) continue;
			R.an_flee[o] = std::max(R.an_flee[o], 1.4);
			R.an_threat_x[o] = ax;
			R.an_threat_z[o] = az;
		}
	} else {
		R.rot[a] = jsm::atan2(ax - R.x[a], az - R.z[a]);
	}
}

double Wildlife::rand(int a) {
	ResourceStore &R = sim->entities.resources;
	Mulberry32 m(R.an_seed[a]);
	const double v = m.next();
	R.an_seed[a] = m.a;
	return v;
}

void Wildlife::update(double dt) {
	if (!spawned) populate();
	const GameMap &map = sim->map();
	ResourceStore &R = sim->entities.resources;
	const std::vector<int32_t> list = animals; // (nothing is added or removed while iterating, but be safe)
	for (int32_t id : list) {
		const int a = sim->entities.resource_slot(id);
		if (a < 0) continue;
		R.prev_x[a] = R.x[a];
		R.prev_z[a] = R.z[a];
		R.prev_rot[a] = R.rot[a];
		if (R.flash_t[a] > 0) R.flash_t[a] = std::max(0.0, R.flash_t[a] - dt);
		if (!R.alive[a]) {
			R.an_dead_t[a] += dt;
			continue;
		}
		const AnimalDef &def = animal_def(R.type[a]);
		// settle out of anything placed on top of us
		if (!map.walkable_at(R.x[a], R.z[a])) {
			double px, pz;
			if (walkable_near(R.x[a], R.z[a], px, pz)) {
				R.x[a] = R.prev_x[a] = px;
				R.z[a] = R.prev_z[a] = pz;
			}
		}
		double speed = 0, gx = 0, gz = 0;
		if (R.an_flee[a] > 0) {
			R.an_flee[a] -= dt;
			const double dx = R.x[a] - R.an_threat_x[a], dz = R.z[a] - R.an_threat_z[a];
			double d = jsm::hypot(dx, dz);
			if (d == 0 || std::isnan(d)) d = 1;
			gx = R.x[a] + (dx / d) * 3;
			gz = R.z[a] + (dz / d) * 3;
			speed = def.flee_speed;
			if (R.an_flee[a] <= 0) {
				homes.push_back({ R.x[a], R.z[a], R.an_home[a] });
				R.an_home[a] = (int)homes.size() - 1;
				R.an_goal[a] = 0;
			}
		} else {
			if (!R.an_goal[a]) {
				R.an_wait[a] -= dt;
				R.an_graze[a] = std::min(1.0, R.an_graze[a] + dt * 2);
				if (R.an_wait[a] <= 0) {
					const double r = rand(a);
					const Home &hh = homes[R.an_home[a]];
					const Home &h = hh.shared >= 0 ? homes[hh.shared] : hh;
					const double ang = r * PI * 2, rad = 0.6 + rand(a) * 3.2;
					R.an_goal[a] = 1;
					R.an_goal_x[a] = h.x + jsm::cos(ang) * rad;
					R.an_goal_z[a] = h.z + jsm::sin(ang) * rad;
				}
			} else {
				R.an_graze[a] = std::max(0.0, R.an_graze[a] - dt * 3);
				gx = R.an_goal_x[a];
				gz = R.an_goal_z[a];
				speed = def.speed;
				if (jsm::hypot(gx - R.x[a], gz - R.z[a]) < 0.2) {
					R.an_goal[a] = 0;
					R.an_wait[a] = 2 + rand(a) * 6;
					speed = 0;
				}
			}
		}
		if (speed > 0) {
			const double dx = gx - R.x[a], dz = gz - R.z[a], d = jsm::hypot(dx, dz);
			if (d > 0.01) {
				const double step = std::min(d, speed * dt);
				const double nx = R.x[a] + (dx / d) * step, nz = R.z[a] + (dz / d) * step;
				if (map.walkable_at(nx, nz)) {
					R.x[a] = nx;
					R.z[a] = nz;
				} else {
					R.an_goal[a] = 0;
					R.an_wait[a] = 0.5;
					if (R.an_flee[a] > 0) {
						const double tx = nx + (rand(a) - 0.5) * 6;
						const double tz = nz + (rand(a) - 0.5) * 6;
						R.an_threat_x[a] = tx;
						R.an_threat_z[a] = tz;
					}
				}
				// turn smoothly toward travel direction
				const double want = jsm::atan2(dx, dz);
				double dr = want - R.rot[a];
				while (dr > PI) dr -= PI * 2;
				while (dr < -PI) dr += PI * 2;
				R.rot[a] += std::max(-8 * dt, std::min(8 * dt, dr));
			}
		}
		R.an_moving[a] = speed > 0;
		R.an_speed[a] = speed;
		R.tx[a] = (int32_t)std::floor(R.x[a] - 0.5);
		R.tz[a] = (int32_t)std::floor(R.z[a] - 0.5);
	}
}

} // namespace aov
