// Port of src/economy/Fishing.js: fish shoals in shallow water near the
// shore and fishing boats that sail out, cast their nets over a shoal and
// bring the catch back to a dock point beside the owner's nearest food
// drop-off. Boats and shoals are not entities (like the JS).
#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"
#include "economy.h"

namespace aov {

static const double PI = 3.141592653589793;

void Fishing::init(Sim *s) {
	sim = s;
	shoals.clear();
	boats.clear();
	next_id = 1;
	spawned = false;
}

bool Fishing::is_water(double x, double z) const {
	const GameMap &m = sim->map();
	return m.level_at(x, z) < m.water_level; // (off the map: the edge column, as the JS level())
}

bool Fishing::is_open(double x, double z, double r) const {
	if (!is_water(x, z)) return false;
	for (int i = 0; i < 8; i++) {
		const double a = (i / 8.0) * PI * 2;
		if (!is_water(x + jsm::cos(a) * r, z + jsm::sin(a) * r)) return false;
	}
	return true;
}

int Fishing::spawn_shoal(double x, double z, double amount) {
	Shoal s{ next_id++, x, z, amount, amount, std::fmod(x * 7.1 + z * 3.3, 6.28) };
	shoals.push_back(s);
	return (int)shoals.size() - 1;
}

void Fishing::populate() {
	if (spawned) return;
	spawned = true;
	const GameMap &m = sim->map();
	Mulberry32 rnd((uint32_t)js_int32((double)m.seed * 104729 + 3));
	struct Cand { double x, z, k; };
	std::vector<Cand> cand;
	for (int tz = 2; tz < m.size - 2; tz += 2)
		for (int tx = 2; tx < m.size - 2; tx += 2) {
			const double x = tx + 0.5, z = tz + 0.5;
			if (!is_open(x, z, 1.4)) continue;
			bool near = false;
			for (int i = 0; i < 12 && !near; i++) {
				const double a = (i / 12.0) * PI * 2;
				if (!is_water(x + jsm::cos(a) * 4.5, z + jsm::sin(a) * 4.5)) near = true;
			}
			if (near) cand.push_back({ x, z, rnd.next() });
		}
	std::stable_sort(cand.begin(), cand.end(), [](const Cand &a, const Cand &b) { return a.k < b.k; });
	for (const Cand &c : cand) {
		if (shoals.size() >= 26) break;
		bool close = false;
		for (const Shoal &s : shoals) {
			const double dx = s.x - c.x, dz = s.z - c.z;
			if (dx * dx + dz * dz < 64) { close = true; break; }
		}
		if (close) continue;
		spawn_shoal(c.x, c.z);
	}
}

int Fishing::spawn_boat(int owner, double x, double z, double rot) {
	Boat b;
	b.id = next_id++;
	b.owner = owner;
	b.x = b.prev_x = x;
	b.z = b.prev_z = z;
	b.rot = b.prev_rot = rot;
	boats.push_back(b);
	return (int)boats.size() - 1;
}

int Fishing::nearest_shoal(double x, double z, int exclude) const {
	int best = -1;
	double bd = INFINITY;
	for (int i = 0; i < (int)shoals.size(); i++) {
		const Shoal &s = shoals[i];
		if (s.amount <= 0 || i == exclude) continue;
		// spread boats: penalise shoals other boats already work
		int crowd = 0;
		for (const Boat &b : boats) crowd += b.shoal == i;
		const double dx = s.x - x, dz = s.z - z;
		const double d = dx * dx + dz * dz + crowd * 60;
		if (d < bd) { bd = d; best = i; }
	}
	return best;
}

bool Fishing::find_dock(int owner, double x, double z, double &ox, double &oz, int32_t &building) const {
	const BuildingStore &B = sim->entities.buildings;
	bool found = false;
	double bd = INFINITY;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.owner[b] != owner || !B.built[b] || !building_def(B.type[b]).drops(RES_FOOD)) continue;
		for (int r = 2; r <= 22; r += 1)
			for (int i = 0; i < 24; i++) {
				const double a = (i / 24.0) * PI * 2;
				const double px = B.x[b] + jsm::cos(a) * r, pz = B.z[b] + jsm::sin(a) * r;
				if (!is_open(px, pz, 0.8)) continue;
				const double d = r * 3 + jsm::hypot(px - x, pz - z) * 0.2;
				if (d < bd) {
					bd = d;
					ox = px;
					oz = pz;
					building = B.id[b];
					found = true;
				}
			}
	}
	return found;
}

void Fishing::update(double dt) {
	if (!spawned) populate();
	for (Shoal &s : shoals) s.phase += dt;
	for (Boat &b : boats) {
		b.prev_x = b.x;
		b.prev_z = b.z;
		b.prev_rot = b.rot;
		b.t += dt;
		if (b.state == BS_IDLE) {
			b.wait -= dt;
			if (b.wait > 0) continue;
			if (b.carry >= BOAT_CAP * 0.5) { b.state = BS_TO_DOCK; continue; }
			b.shoal = nearest_shoal(b.x, b.z);
			if (b.shoal >= 0) b.state = BS_TO_SHOAL;
			else b.wait = 3;
		} else if (b.state == BS_TO_SHOAL) {
			if (b.shoal < 0 || shoals[b.shoal].amount <= 0) { b.state = BS_IDLE; continue; }
			// park on the rim of the shoal, each boat at its own angle
			const double ang = b.id * 2.4;
			const Shoal &s = shoals[b.shoal];
			const double px = s.x + jsm::cos(ang) * 1.3, pz = s.z + jsm::sin(ang) * 1.3;
			if (sail(b, px, pz, dt)) { b.state = BS_FISHING; b.t = 0; }
		} else if (b.state == BS_FISHING) {
			if (b.shoal < 0 || shoals[b.shoal].amount <= 0) { b.state = b.carry > 0 ? BS_TO_DOCK : BS_IDLE; continue; }
			Shoal &s = shoals[b.shoal];
			const double take = std::min(std::min(FISH_RATE * dt, s.amount), BOAT_CAP - b.carry);
			b.carry += take;
			s.amount -= take;
			// slowly swing around the anchor
			b.rot += jsm::sin(b.t * 0.4 + b.id) * 0.1 * dt;
			if (b.carry >= BOAT_CAP) b.state = BS_TO_DOCK;
		} else if (b.state == BS_TO_DOCK) {
			if (!b.dock || sim->entities.slot(b.dock_building) < 0) b.dock = find_dock(b.owner, b.x, b.z, b.dock_x, b.dock_z, b.dock_building);
			if (!b.dock) { b.state = BS_IDLE; b.wait = 5; continue; }
			if (sail(b, b.dock_x, b.dock_z, dt)) {
				Player &p = sim->players[b.owner];
				p.res[RES_FOOD] += std::floor(b.carry * 100) / 100;
				const int d = sim->entities.building_slot(b.dock_building);
				if (d >= 0) sim->entities.buildings.stock_fish[d] += b.carry;
				b.carry = 0;
				Event e;
				e.type = EV_RESOURCES_CHANGED;
				e.owner = b.owner;
				sim->events.emit(e);
				b.state = BS_IDLE;
				b.wait = 1.2;
			}
		}
	}
}

// Steer toward (x, z) over open water. Returns true on arrival.
bool Fishing::sail(Boat &b, double x, double z, double dt) {
	const double dx = x - b.x, dz = z - b.z, d = jsm::hypot(dx, dz);
	if (d < 0.6) return true;
	const double want = jsm::atan2(dx, dz);
	const double look = std::min(1.8, d);
	static const double OFFS[] = { 0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, 2.8 };
	bool have = false;
	double heading = 0;
	for (double off : OFFS) {
		const double h = want + off;
		if (is_open(b.x + jsm::sin(h) * look, b.z + jsm::cos(h) * look, 0.6)) { heading = h; have = true; break; }
	}
	if (!have) {
		// wedged: accept arrival if we are close, otherwise nudge backwards
		if (d < 3) return true;
		heading = b.rot + PI;
	}
	double dr = heading - b.rot;
	while (dr > PI) dr -= PI * 2;
	while (dr < -PI) dr += PI * 2;
	b.rot += std::max(-2.5 * dt, std::min(2.5 * dt, dr));
	const double sp = BOAT_SPEED * (0.4 + 0.6 * std::max(0.0, jsm::cos(dr)));
	const double nx = b.x + jsm::sin(b.rot) * sp * dt, nz = b.z + jsm::cos(b.rot) * sp * dt;
	if (is_water(nx, nz) && sim->map().in_world(nx, nz)) { b.x = nx; b.z = nz; } // (bounds: a boat never sails off the map)
	return false;
}

} // namespace aov
