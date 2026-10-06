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
		// ---- the Egyptian gods (egypt_powers.cpp; EGYPT.md 4, 5). cost = Retold's favor (+ ramp per
		// cast), cooldown = the recharge, radius in tiles (Retold m x0.6), hotkey by age: Z Archaic,
		// C Classical, V Heroic, B Mythic
		{ "rain", "Rain", "Ra", Cost(0, 0, 0, 30), 90, 0, 50, 0, 0, 0, 0, "Z",
			"For 50 seconds your Laborers farm 150% faster.", 15, 0, PT_GLOBAL,
			"30 favor, recharge 90 s, ramp +15; 50 s: the caster's Laborers farm +150 %, Fishing Ships +50 %",
			"every farmer of the caster x2.5 on Farms (no Fishing Ships for the Egyptians here)" },
		{ "prosperity", "Prosperity", "Isis", Cost(0, 0, 0, 60), 120, 0, 75, 0, 0, 0, 0, "Z",
			"For 75 seconds your Laborers mine gold 50% faster.", 10, 0, PT_GLOBAL,
			"60 favor, recharge 120 s, ramp +10; 75 s: Laborers mine gold +50 %, Caravans +20 % gold (update 19.16313)",
			"every gold gatherer of the caster x1.5 (no Caravans here)" },
		{ "vision", "Vision", "Set", Cost(0, 0, 0, 40), 240, 42, 20, 0, 0, 0, 0, "Z",
			"Reveals a circle anywhere on the map for 20 seconds, growing to 70 m.", 5, 0, PT_POINT,
			"40 favor, recharge 240 s, ramp +5; reveals 70 m (from 10 m, +15 m/s) for 20 s to the caster and allies",
			"radius 6 tiles growing 9 tiles/s to 42 tiles (x0.6)" },
		{ "eclipse", "Eclipse", "Bast", Cost(0, 0, 0, 90), 150, 0, 55, 0, 0, 0, 0, "C",
			"For 55 seconds the sky darkens: your myth units deal +20% damage, move 15% faster, take 10% less damage and recharge their abilities 60% faster; Monuments give +50% favor.",
			25, 1, PT_GLOBAL,
			"90 favor, recharge 150 s, ramp +25; 55 s, whole map; myth units +20 % damage, -60 % ability recharge, +15 % speed, -10 % vulnerability; Monuments +50 % favor; one Eclipse at a time",
			"-10 % vulnerability: +0.10 armor; ability recharge x0.4" },
		{ "shifting_sands", "Shifting Sands", "Ptah", Cost(0, 0, 0, 40), 180, 6, 0, 0, 0, 0, 3, "C",
			"After 3 seconds, teleports your units in a small circle to a visible point at least 40 m away.", 20, 1, PT_TWO_POINTS,
			"40 favor, recharge 180 s, ramp +20; after 3 s all own and allied units (not ships, Titans) in 10 m go to a visible point at least 40 m away",
			"radius 6 tiles, destination >= 24 tiles away and in sight of one of the caster's or his allies' units or buildings; formation kept" },
		{ "plague_of_serpents", "Plague of Serpents", "Anubis", Cost(0, 0, 0, 60), 180, 8.4, 18, 3, 0, 0, 0, "C",
			"Fourteen serpents rise from the sand around the target, two at a time, and attack nearby enemies.", 10, 1, PT_POINT,
			"60 favor, recharge 180 s, ramp +10; 14 Serpents within 14 m: 2 at once, then 2 every 3 s; uncontrolled, they guard the spot, attack enemies, ignore buildings, live until killed",
			"radius 8.4 tiles; a Serpent attacks enemy units within 6 tiles of where it rose and walks back" },
		{ "locust_swarm", "Locust Swarm", "Sobek", Cost(0, 0, 0, 75), 150, 3.6, 20, 0, 3.5, 0, 0, "V",
			"Sends five locust swarms across the land for 20 seconds; they devour Farms and berry bushes and sting everything in their path.", 10, 2, PT_TWO_POINTS,
			"75 favor, recharge 150 s, ramp +10; 5 swarms in a direction at 3 m/s for 20 s, each 3.5 divine/s in 6 m, x6 vs Farms and berry bushes, x0.1 vs own units, kills livestock; Mythic +20 %",
			"speed 1.8 tiles/s, radius 3.6 tiles; the swarms side by side 2.2 tiles apart; berry bushes lose 21 food/s per swarm; (no livestock here)" },
		{ "citadel", "Citadel", "Sekhmet", Cost(0, 0, 0, 150), 120, 0, 0, 0, 0, 0, 0, "V",
			"Turns one of your Town Centers into a Citadel Center: +1200 hp, stronger arrows, +10 population, and it works 25% faster.", 50, 2, PT_OWN_TC,
			"150 favor, recharge 120 s, ramp +50, instant; a Town Center becomes a Citadel Center: +1200 hp, +2 attack, +1 arrow, +1 LOS, +10 pop, +10 % hack armor, +25 % work rate",
			"arrows x1.2 (+2 of Retold's 10) and one more arrow a volley; +0.6 LOS; trains, researches and ages x1.25; +10 % hack armor (building_hack_mult)" },
		{ "ancestors", "Ancestors", "Nephthys", Cost(0, 0, 0, 100), 180, 9.6, 13, 1, 0, 0, 0, "V",
			"Over 13 seconds raises 13 Minions around the target; they serve you for 60 seconds.", 5, 2, PT_POINT,
			"100 favor, recharge 180 s, ramp +5; over 13 s 13 controllable Minions within 16 m, all dead 60 s after the cast",
			"radius 9.6 tiles; one Minion a second (Atef Crown: they live 120 s)" },
		{ "son_of_osiris", "Son of Osiris", "Osiris", Cost(0, 0, 0, 350), 240, 0, 0, 0, 0, 0, 0, "B",
			"Your Pharaoh becomes the Son of Osiris, a demigod who hurls chain lightning. A new Pharaoh appears later.", 50, 3, PT_OWN_PHARAOH,
			"350 favor, recharge 240 s, ramp +50; a Pharaoh becomes the Son of Osiris at full hp; a new Pharaoh appears at the Town Center later",
			"the Pharaoh nearest the target (within 3 tiles); the new one after the 90 s respawn" },
		{ "tornado", "Tornado", "Horus", Cost(0, 0, 0, 350), 240, 9, 20, 0.5, 25, 0, 0, "B",
			"A whirlwind spirals out from the target for 20 seconds, wrecking buildings and slowing and flinging units.", 5, 3, PT_POINT,
			"350 favor, recharge 240 s, ramp +5; 20 s spiralling anticlockwise out from the target, 25 hack + 100 crush every 0.5 s, full within 5 m falling off to 15 m, x0.1 vs Farms; slows 35 % for 6 s; 20 m LOS; a little friendly fire",
			"an Archimedean spiral at 2.5 tiles/s; full within 3 tiles, falling to 0 at 9; units' crush armor 99 % (myth 80 %, siege 85 %); own units x0.1; units within 3 tiles flung" },
		{ "thoth_meteor", "Meteor", "Thoth", Cost(0, 0, 0, 350), 240, 15, 18, 1, 580, 4.8, 3, "B",
			"Twelve meteors fall in a large circle over 18 seconds, on the densest targets; each smashes everything within 8 m.", 5, 3, PT_POINT,
			"350 favor, recharge 240 s, ramp +5, 18 s, 25 m circle; 12 meteors, the first in the centre after 3 s, the other 11 from 3 s later on the densest targets; each 580 crush + 40 divine in 8 m, x0.1 vs own units and Farms, knockback",
			"circle 15 tiles, area 4.8 tiles, one meteor a second from 6 s; units' crush armor 99 % (myth 80 %, siege 85 %), buildings their own (Retold) or 5 %" },
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
	init_egypt();
}

double GodPowers::cooldown_left(int owner, int id) const {
	if (owner < 0 || owner >= MAX_PLAYERS || id < 0 || id >= GP_COUNT) return 0;
	return std::max(0.0, cooldowns[owner][id] - sim->time);
}

CastCheck GodPowers::can_cast(int owner, int id) const {
	if (id < 0 || id >= GP_COUNT) return { false, "Unknown power" };
	const Player *p = const_cast<Sim *>(sim)->player(owner);
	if (!p) return { false, "No such player" };
	if (!has_power(owner, id)) return { false, power_lock(owner, id) }; // (Godot-only: his gods' powers)
	if (cooldown_left(owner, id) > 0) return { false, "Recharging" };
	if (is_egypt_power(id)) {
		if (p->res[RES_FAVOR] < power_cost(owner, id)) return { false, "Not enough favor" };
		if (id == GP_ECLIPSE && eclipse.until > sim->time) return { false, "An Eclipse is already darkening the sky" };
		return { true, "" };
	}
	if (!p->can_afford(power_def(id).cost)) return { false, "Not enough favor" };
	return { true, "" };
}

bool GodPowers::cast(int owner, int id, double x, double z) {
	if (is_egypt_power(id)) return cast_egypt(owner, id, x, z, NAN, NAN, false); // (Godot-only, egypt_powers.cpp)
	if (!can_cast(owner, id).ok) return false;
	Sim &S = *sim;
	if (!S.map().clamp_to_map(x, z)) return false; // bounds: off-map target -> the edge tile, NaN refused (nothing paid)
	if (S.godot_rules) { // (Godot-only, sim/civ: Isis' Divine Shield; refused, nothing paid)
		if (!local_block(x, z).empty()) return false; // (sim/godpowers: a live Tornado / Thoth's Meteor blocks it here)
		int32_t by = 0;
		if (!S.civs.shield_allows(owner, x, z, nullptr, &by)) {
			const int m = S.entities.building_slot(by);
			if (m >= 0) S.civs.shield_refused[S.entities.buildings.owner[m]]++;
			return false;
		}
	}
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
		if (dx * dx + dz * dz <= r2 && !U.dead[o] && U.id[o] != exclude_id && sim->is_enemy(owner, U.owner[o]) &&
				!(sim->godot_rules && power_immune(o))) // (Godot-only: the Roc / Son of Osiris)
			out.push_back(o);
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
	S.map().clamp_to_map(x, z); // (a storm by the map's edge strikes the edge tile, never off the map)
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
	if (m.kind == 1) { impact_thoth(m); return; } // (Godot-only: Thoth's Meteor, egypt_powers.cpp)
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
		if (B.removed[b] || B.dead[b] || !sim->is_enemy(m.owner, B.owner[b])) continue;
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
	if (S.godot_rules) {
		update_egypt(dt); // (Godot-only: the Egyptian powers, egypt_powers.cpp)
		update_myth(dt);  // (the Egyptian myth units' abilities, egypt_myth.cpp)
	}
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
		if (map.walkable_at(nx, nz)) {
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
