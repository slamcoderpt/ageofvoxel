// Port of src/core/FogOfWar.js (sim side; see fog.h).
#include "fog.h"

#include <algorithm>
#include <cmath>

#include "../sim.h"

namespace aov {

void FogOfWar::init(Sim *s) {
	sim = s;
	n = s->map().size;
	state.assign((size_t)n * n, 0);
	reveal_all = false;
	timer = 0;
	owner = PLAYER;
	version++;
}

void FogOfWar::set_reveal_all(bool v) {
	reveal_all = v;
	recompute();
}

bool FogOfWar::is_visible(double x, double z) const {
	if (reveal_all) return true;
	const int tx = (int)std::floor(x), tz = (int)std::floor(z);
	if (tx < 0 || tz < 0 || tx >= n || tz >= n) return false;
	return state[(size_t)tz * n + tx] == 2;
}

bool FogOfWar::is_explored(double x, double z) const {
	if (reveal_all) return true;
	const int tx = (int)std::floor(x), tz = (int)std::floor(z);
	if (tx < 0 || tz < 0 || tx >= n || tz >= n) return false;
	return state[(size_t)tz * n + tx] >= 1;
}

void FogOfWar::update(double dt) {
	timer -= dt;
	if (timer > 0) return;
	timer = 0.25;
	recompute();
}

void FogOfWar::recompute() {
	for (auto &v : state)
		if (v == 2) v = 1;
	version++;
	if (reveal_all) {
		std::fill(state.begin(), state.end(), 2);
		return;
	}
	auto stamp = [&](double x, double z, double sight) {
		const double r = sight != 0 ? sight : 8;
		const int cx = (int)std::floor(x), cz = (int)std::floor(z);
		const double r2 = r * r;
		const int ri = (int)std::floor(r);
		for (int dz = -ri; dz <= ri; dz++) {
			const int zz = cz + dz;
			if (zz < 0 || zz >= n) continue;
			for (int dx = -ri; dx <= ri; dx++) {
				if (dx * dx + dz * dz > r2) continue;
				const int xx = cx + dx;
				if (xx >= 0 && xx < n) state[(size_t)zz * n + xx] = 2;
			}
		}
	};
	const UnitStore &U = sim->entities.units;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && U.owner[r] == owner && !U.dead[r]) stamp(U.x[r], U.z[r], U.sight[r]);
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && B.owner[b] == owner && !B.dead[b]) stamp(B.x[b], B.z[b], B.sight[b]);
}

} // namespace aov
