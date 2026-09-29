// Port of the sim side of src/godpowers/index.js (see godpowers.h).
#include "godpowers.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static const double PI = 3.141592653589793;

const PowerDef &power_def(int id) {
	// hotkeys Z / C / V (Godot: the browser's Bolt key X is the Stop command)
	// clang-format off
	static const PowerDef D[GP_COUNT] = {
		{ "lightning_storm", "Lightning Storm", "Zeus", Cost(0, 0, 0, 40), 45, 7.5, 9, 0.3, 70, 1.8, 0, "Z",
			"Calls down a whirling storm that strikes enemy units in the area with lightning and hurls them into the air." },
		{ "bolt", "Bolt", "Zeus", Cost(0, 0, 0, 15), 12, 1.5, 0, 0, 400, 0, 0, "C", "A single bolt that slays one target." },
		{ "meteor", "Meteor", "Hephaestus", Cost(0, 0, 0, 30), 30, 4.5, 0, 0, 260, 0, 1.8, "V",
			"A blazing meteor falls from the heavens, smashing units and buildings where it lands." },
	};
	// clang-format on
	return D[id];
}

int power_of(const char *key) {
	for (int i = 0; i < GP_COUNT; i++)
		if (std::strcmp(power_def(i).key, key) == 0) return i;
	return -1;
}

void GodPowers::init(Sim *s) {
	sim = s;
	storms.clear();
	bolts.clear();
	scorches.clear();
	zaps.clear();
	meteors.clear();
	fires.clear();
	airborne.clear();
	std::memset(cooldowns, 0, sizeof(cooldowns));
	vrng = RNG(8675309);
}

double GodPowers::cooldown_left(int owner, int id) const {
	if (owner < 0 || owner >= MAX_PLAYERS || id < 0 || id >= GP_COUNT) return 0;
	return std::max(0.0, cooldowns[owner][id] - sim->time);
}

CastCheck GodPowers::can_cast(int owner, int id) const {
	if (id < 0 || id >= GP_COUNT) return { false, "Unknown power" };
	const Player *p = const_cast<Sim *>(sim)->player(owner);
	if (!p) return { false, "No such player" };
	if (cooldown_left(owner, id) > 0) return { false, "Recharging" };
	if (!p->can_afford(power_def(id).cost)) return { false, "Not enough favor" };
	return { true, "" };
}

bool GodPowers::cast(int owner, int id, double x, double z) {
	if (!can_cast(owner, id).ok) return false;
	Sim &S = *sim;
	const PowerDef &def = power_def(id);
	S.players[owner].pay(def.cost);
	cooldowns[owner][id] = S.time + def.cooldown;
	if (id == GP_LIGHTNING_STORM) {
		Storm s;
		s.owner = owner;
		s.x = x;
		s.z = z;
		s.t0 = S.time;
		s.duration = def.duration;
		s.radius = def.radius;
		s.next = 0.4;
		s.sky = 0.2;
		storms.push_back(s);
	} else if (id == GP_BOLT) {
		const int t = find_target(owner, x, z, def.radius + 1.5);
		const UnitStore &U = S.entities.units;
		strike(owner, t >= 0 ? U.x[t] : x, t >= 0 ? U.z[t] : z, def.damage, 0, t);
	} else if (id == GP_METEOR) {
		const double y = S.map().height_at(x, z);
		Meteor m;
		m.owner = owner;
		m.x = x;
		m.z = z;
		m.t0 = S.time;
		m.delay = def.delay;
		m.radius = def.radius;
		m.sx = x + 16;
		m.sy = y + 30;
		m.sz = z - 14;
		meteors.push_back(m);
	}
	Event e;
	e.type = EV_GODPOWER_CAST;
	e.owner = owner;
	e.a = id;
	e.x = x;
	e.z = z;
	S.events.emit(e);
	return true;
}

// hash.near(x, z, r, (o) => !o.dead && isEnemy(owner, o.owner) [&& o !== exclude])
std::vector<int> GodPowers::near(double x, double z, double r, int owner, int32_t exclude_id) {
	const UnitStore &U = sim->entities.units;
	std::vector<int> out;
	const double r2 = r * r;
	sim->movement.hash.count_query(x, z, r);
	sim->movement.hash.for_each_near(x, z, r, [&](int o) {
		const double dx = U.x[o] - x, dz = U.z[o] - z;
		if (dx * dx + dz * dz <= r2 && !U.dead[o] && U.id[o] != exclude_id && Sim::is_enemy(owner, U.owner[o])) out.push_back(o);
	});
	return out;
}

int GodPowers::find_target(int owner, double x, double z, double r, bool random, bool grounded) {
	const UnitStore &U = sim->entities.units;
	std::vector<int> cands = near(x, z, r, owner);
	// (grounded: skip men carried up the whirl)
	if (grounded) cands.erase(std::remove_if(cands.begin(), cands.end(), [&](int o) { return U.gp_state[o] == 1; }), cands.end());
	if (cands.empty()) return -1;
	if (random) return cands[(size_t)std::floor(sim->rng.next() * cands.size())];
	int best = cands[0];
	double bd = (U.x[best] - x) * (U.x[best] - x) + (U.z[best] - z) * (U.z[best] - z);
	for (int o : cands) {
		const double d = (U.x[o] - x) * (U.x[o] - x) + (U.z[o] - z) * (U.z[o] - z);
		if (d < bd) {
			bd = d;
			best = o;
		}
	}
	return best;
}

void GodPowers::zap(int o) {
	Sim &S = *sim;
	UnitStore &U = S.entities.units;
	Zap z;
	z.unit = U.id[o];
	z.x = U.x[o];
	z.y = S.map().height_at(U.x[o], U.z[o]);
	z.z = U.z[o];
	z.t0 = S.time;
	z.life = 0.4;
	z.seed = (uint32_t)(int64_t)(S.tick_count * 131 + (int64_t)U.id[o] * 17);
	zaps.push_back(z);
	// hit state: a white-hot flash for a few frames, then the man is charred (renderer)
	U.gp_hit_t[o] = S.time;
}

void GodPowers::add_airborne(int row) {
	const int32_t id = sim->entities.units.id[row];
	if (std::find(airborne.begin(), airborne.end(), id) == airborne.end()) airborne.push_back(id);
}

// Throw a unit away from (x, z). Deterministic (hash of id + tick).
void GodPowers::knock(int o, double x, double z, double power) {
	Sim &S = *sim;
	UnitStore &U = S.entities.units;
	if (U.gp_state[o] == 1 && U.gp_storm[o] >= 0 && !U.gp_flung[o]) return;
	const int32_t tick = (int32_t)S.tick_count;
	double dx = U.x[o] - x, dz = U.z[o] - z, d = jsm::hypot(dx, dz);
	if (d < 0.08) {
		const double a = hash2(U.id[o], tick, 7) * PI * 2;
		dx = jsm::cos(a);
		dz = jsm::sin(a);
		d = 1;
	} else {
		dx /= d;
		dz /= d;
	}
	const double heavy = U.max_hp[o] > 300 ? 0.3 : 1;
	const double f = power * (1 - std::min(1.0, d / 3) * 0.55) * heavy * (0.8 + hash2(U.id[o], tick, 3) * 0.4);
	U.gp_state[o] = 1;
	U.gp_storm[o] = -1;
	U.gp_vx[o] = dx * 3.4 * f;
	U.gp_vz[o] = dz * 3.4 * f;
	U.gp_vy[o] = 5.5 + 5 * f;
	// tumble backwards, away from the blast (axis perpendicular to the throw, in the unit's frame)
	const double c = jsm::cos(U.rot[o]), s = jsm::sin(U.rot[o]);
	const double lx = c * dx - s * dz, lz = s * dx + c * dz;
	const double spin = (7 + 6 * hash2(U.id[o], 11)) * f;
	U.gp_wx[o] = lz * spin;
	U.gp_wz[o] = -lx * spin;
	U.air_y[o] = std::max(U.air_y[o], 0.02);
	add_airborne(o);
}

void GodPowers::strike(int owner, double x, double z, double damage, double splash, int target) {
	Sim &S = *sim;
	UnitStore &U = S.entities.units;
	const double y = S.map().height_at(x, z);
	const uint32_t seed = (uint32_t)(int64_t)(S.tick_count * 7919 + (int64_t)bolts.size() * 31 + js_int32(x * 13));
	bolts.push_back({ x, y, z, S.time, 0.75, seed, false });
	scorches.push_back({ x, y, z, S.time, seed, 0, false });
	const int32_t target_id = target >= 0 ? U.id[target] : 0;
	const std::vector<int> thrown = near(x, z, std::max(2.6, splash + 0.8), owner);
	// combat's white hit flash is an emissive lift; lightning hits keep only a trace of it
	auto hit = [&](int o, double dmg) {
		S.combat.damage(U.id[o], dmg, Hitter::pseudo(owner));
		if (U.flash_t[o] > 0.03) U.flash_t[o] = 0.03;
		zap(o);
	};
	if (target >= 0) hit(target, damage);
	if (splash > 0)
		for (int o : near(x, z, splash, owner, target_id)) hit(o, damage * 0.4);
	for (int o : thrown) knock(o, x, z, U.id[o] == target_id ? 1.1 : 0.8);
}

void GodPowers::impact_meteor(const Meteor &m) {
	Sim &S = *sim;
	UnitStore &U = S.entities.units;
	const PowerDef &def = power_def(GP_METEOR);
	const double x = m.x, z = m.z;
	const double y = S.map().height_at(x, z);
	const uint32_t seed = (uint32_t)(int64_t)(S.tick_count * 7919 + 77);
	scorches.push_back({ x, y, z, S.time, seed, m.radius * 2.4, true });
	for (int o : near(x, z, m.radius, m.owner)) {
		const double d = jsm::hypot(U.x[o] - x, U.z[o] - z) / m.radius;
		S.combat.damage(U.id[o], def.damage * (1 - d * 0.5), Hitter::pseudo(m.owner));
		knock(o, x, z, 1.5 * (1 - d * 0.6));
	}
	BuildingStore &B = S.entities.buildings;
	const int nb = B.size();
	for (int b = 0; b < nb; b++) {
		if (B.removed[b] || B.dead[b] || !Sim::is_enemy(m.owner, B.owner[b])) continue;
		const double d = jsm::hypot(B.x[b] - x, B.z[b] - z);
		const BuildingDef &bd = building_def(B.type[b]);
		if (d < m.radius + std::max(bd.w, bd.h) / 2.0) S.combat.damage(B.id[b], def.damage * 1.5, Hitter::pseudo(m.owner, true));
	}
	fires.push_back({ x, y, z, m.radius * 0.7, S.time, 6 });
}

void GodPowers::update(double dt) {
	Sim &S = *sim;
	const PowerDef &storm_def = power_def(GP_LIGHTNING_STORM);
	for (size_t i = 0; i < storms.size(); i++) {
		if (storms[i].done) continue;
		if (S.time - storms[i].t0 > storms[i].duration) {
			storms[i].done = true;
			continue;
		}
		storms[i].next -= dt;
		if (storms[i].next <= 0) {
			storms[i].next = storm_def.interval * (0.6 + S.rng.next() * 0.8);
			const Storm s = storms[i];
			const int t = find_target(s.owner, s.x, s.z, s.radius * 0.78, true, true);
			if (t >= 0) strike(s.owner, S.entities.units.x[t], S.entities.units.z[t], storm_def.damage, storm_def.splash, t);
			else {
				const double a = S.rng.range(0, PI * 2), r = std::sqrt(S.rng.next()) * s.radius * 0.7;
				strike(s.owner, s.x + jsm::cos(a) * r, s.z + jsm::sin(a) * r, 0, storm_def.splash, -1);
			}
		}
		vortex((int)i, dt);
		// cosmetic cloud-to-cloud lightning (visual RNG)
		Storm &s = storms[i];
		s.sky -= dt;
		if (s.sky <= 0) {
			s.sky = vrng.range(0.25, 0.7);
			const double a = vrng.range(0, PI * 2), r = s.radius * vrng.range(0.9, 1.6);
			const double y = S.map().height_at(s.x, s.z) + vrng.range(20, 24);
			bolts.push_back({ s.x + jsm::cos(a) * r, y, s.z + jsm::sin(a) * r, S.time, 0.35, (uint32_t)(vrng.next() * 1e9), true });
		}
	}
	for (size_t i = 0; i < meteors.size(); i++) {
		if (meteors[i].done) continue;
		if (S.time - meteors[i].t0 >= meteors[i].delay) {
			meteors[i].done = true;
			const Meteor m = meteors[i];
			impact_meteor(m);
		}
	}
	for (Fire &f : fires)
		if (S.time - f.t0 > f.dur) f.done = true;
	update_airborne(dt);
	const double now = S.time;
	meteors.erase(std::remove_if(meteors.begin(), meteors.end(), [](const Meteor &m) { return m.done; }), meteors.end());
	fires.erase(std::remove_if(fires.begin(), fires.end(), [](const Fire &f) { return f.done; }), fires.end());
	bolts.erase(std::remove_if(bolts.begin(), bolts.end(), [&](const Bolt &b) { return !(now - b.t0 < b.life + 0.05); }), bolts.end());
	zaps.erase(std::remove_if(zaps.begin(), zaps.end(), [&](const Zap &z) { return !(now - z.t0 < z.life); }), zaps.end());
	scorches.erase(std::remove_if(scorches.begin(), scorches.end(), [&](const Scorch &s) { return !(now - s.t0 < 14); }), scorches.end());
	// storms stay in the vector (thrown units refer to them by index); drop them all once none is live or referenced
	bool live = false;
	for (const Storm &s : storms) live = live || !s.done;
	if (!live && airborne.empty()) storms.clear();
}

// The storm is a whirlwind: enemy men inside it are snatched off their feet
// (deterministic, sim rng), carried round with the spin while they climb,
// tumbling, and then flung outward along the spin. Heavy myth units hold.
void GodPowers::vortex(int si, double dt) {
	Sim &S = *sim;
	UnitStore &U = S.entities.units;
	const Storm s = storms[si];
	const double age = S.time - s.t0;
	if (age < 0.35 || age > s.duration - 1.2) return;
	const double ramp = std::min(1.0, (age - 0.35) / 0.6);
	RNG &rng = S.rng;
	for (int u : near(s.x, s.z, s.radius * 0.95, s.owner)) {
		if (U.max_hp[u] > 300) continue;
		if (U.gp_state[u] == 1) continue;
		if (rng.next() > 1.2 * dt * ramp) continue;
		U.gp_state[u] = 1;
		U.gp_storm[u] = si;
		U.gp_t0[u] = S.time;
		// each man is carried to his own height and orbit up the funnel
		U.gp_ht[u] = 1.8 + rng.next() * 7.8;
		U.gp_orb[u] = 0.42 + rng.next() * 0.34;
		U.gp_hold[u] = 2.2 + rng.next() * 2.2;
		U.gp_flung[u] = 0;
		U.gp_vx[u] = 0;
		U.gp_vz[u] = 0;
		U.gp_vy[u] = 2.5 + rng.next() * 1.5;
		U.gp_tilt[u] = 0.35 + rng.next() * 0.45;
		U.gp_wf[u] = 2 + rng.next() * 2.5;
		U.gp_ph[u] = rng.next() * 6.28;
		const double sp = 3 + rng.next() * 5;
		U.gp_wx[u] = (rng.next() - 0.5) * sp;
		U.gp_wz[u] = (rng.next() - 0.5) * sp;
		U.gp_yaw[u] = 3 + rng.next() * 3;
		U.air_y[u] = std::max(U.air_y[u], 0.02);
		add_airborne(u);
		S.commands.order(u, Order::idle());
	}
}

void GodPowers::update_airborne(double dt) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const GameMap &map = S.map();
	for (int32_t id : airborne) {
		const int u = E.unit_slot(id);
		if (u < 0) continue;
		const int si = U.gp_storm[u];
		if (si >= 0 && !U.gp_flung[u]) {
			const Storm &s = storms[si];
			double dx = U.x[u] - s.x, dz = U.z[u] - s.z, d = jsm::hypot(dx, dz);
			if (d < 0.05) {
				dx = 1;
				dz = 0;
				d = 1;
			} else {
				dx /= d;
				dz /= d;
			}
			const double tx = -dz, tz = dx;
			const double hf = std::min(1.0, U.air_y[u] / 11);
			const double orbit = s.radius * 0.85 * (1 + 0.39 * jsm::pow(hf, 1.7)) * U.gp_orb[u];
			const double vt = 4.2 + 1.8 * U.gp_orb[u], vr = (orbit - d) * 1.8;
			U.gp_vx[u] += ((tx * vt + dx * vr) - U.gp_vx[u]) * std::min(1.0, 3 * dt);
			U.gp_vz[u] += ((tz * vt + dz * vr) - U.gp_vz[u]) * std::min(1.0, 3 * dt);
			const double want = std::max(-1.5, std::min(4.6, (U.gp_ht[u] - U.air_y[u]) * 1.4));
			U.gp_vy[u] += (want - U.gp_vy[u]) * std::min(1.0, 2.2 * dt);
			U.rot[u] = U.rot[u] + U.gp_yaw[u] * dt;
			const double ca = S.time - U.gp_t0[u];
			U.air_rx[u] = U.gp_tilt[u] * jsm::sin(ca * U.gp_wf[u] + U.gp_ph[u]);
			U.air_rz[u] = U.gp_tilt[u] * 0.8 * jsm::cos(ca * U.gp_wf[u] * 0.7 + U.gp_ph[u]);
			if (ca > U.gp_hold[u] || s.done) {
				U.gp_flung[u] = 1;
				U.gp_vx[u] = tx * 6.5 + dx * 5;
				U.gp_vz[u] = tz * 6.5 + dz * 5;
				U.gp_vy[u] = 3.5;
				U.gp_wx[u] *= 1.6;
				U.gp_wz[u] *= 1.6;
			}
		} else {
			U.gp_vy[u] -= 18 * dt;
			U.air_rx[u] += U.gp_wx[u] * dt;
			U.air_rz[u] += U.gp_wz[u] * dt;
		}
		U.air_y[u] += U.gp_vy[u] * dt;
		const double nx = U.x[u] + U.gp_vx[u] * dt, nz = U.z[u] + U.gp_vz[u] * dt;
		if (map.is_walkable((int)std::floor(nx), (int)std::floor(nz))) {
			U.x[u] = nx;
			U.z[u] = nz;
		} else {
			U.gp_vx[u] = 0;
			U.gp_vz[u] = 0;
		}
		if (U.air_y[u] <= 0 && U.gp_vy[u] < 0) {
			U.air_y[u] = 0;
			U.air_rx[u] = 0;
			U.air_rz[u] = 0;
			U.gp_state[u] = 2;
			U.gp_storm[u] = -1;
		}
	}
	airborne.erase(std::remove_if(airborne.begin(), airborne.end(), [&](int32_t id) {
		const int u = E.unit_slot(id);
		return u < 0 || U.gp_state[u] != 1;
	}), airborne.end());
}

} // namespace aov
