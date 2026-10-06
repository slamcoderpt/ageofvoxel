// The Egyptian gods' powers (Godot-only, behind Sim::godot_rules; see godpowers.h and
// godot/PORTING.md "The Egyptian gods"). Retold's numbers (reference/egypt/EGYPT.md 4, 5):
//   Archaic (the major god's): Ra's Rain, Isis' Prosperity, Set's Vision
//   Classical: Bast's Eclipse, Ptah's Shifting Sands, Anubis' Plague of Serpents
//   Heroic: Sobek's Locust Swarm, Sekhmet's Citadel, Nephthys' Ancestors
//   Mythic: Osiris' Son of Osiris, Horus' Tornado, Thoth's Meteor
// Retold's power model: favor cost + ramp per cast, a recharge after each cast, no uses limit.
// Deterministic: placements draw from a local RNG seeded by (tick, owner, power), never the
// sim RNG; iteration in row (= id) order; no wall clock.
#include <algorithm>
#include <cmath>
#include <cstring>

#include "../core/jsmath.h"
#include "../sim.h"
#include "godpowers.h"

namespace aov {

static const double PI = 3.141592653589793;

namespace {
// lower-case god name of a power def ("Ra" -> "ra")
std::string god_key(int id) {
	std::string g = power_def(id).god;
	for (char &c : g) c = (char)std::tolower((unsigned char)c);
	return g;
}
uint32_t mix(uint32_t a, uint32_t b, uint32_t c) {
	uint32_t h = a * 0x9E3779B1u ^ (b + 0x7F4A7C15u) * 0x85EBCA77u ^ (c + 0x165667B1u) * 0xC2B2AE3Du;
	h ^= h >> 15;
	h *= 0x2C1B3C6Du;
	h ^= h >> 12;
	return h;
}
// Retold's crush armor of a unit (EGYPT.md conventions: human units 99 %, myth 80 %, siege 85 %)
double crush_armor(int type) {
	const UnitDef &d = unit_def(type);
	if (d.cls == CLS_SIEGE) return SIEGE_UNIT_CRUSH_ARMOR;
	if (d.cls == CLS_MYTH) return MYTH_CRUSH_ARMOR;
	return UNIT_CRUSH_ARMOR;
}
} // namespace

void GodPowers::init_egypt() {
	std::memset(casts, 0, sizeof(casts));
	for (int o = 0; o < MAX_PLAYERS; o++) {
		rain[o] = prosperity[o] = TimedPower();
		power_damage[o] = farm_damage[o] = building_damage[o] = 0;
		teleported[o] = spawned[o] = thrown[o] = meteors_landed[o] = 0;
		rain_food[o] = prosperity_gold[o] = 0;
		minions_raised[o] = eggs_hatched[o] = chained[o] = 0;
	}
	eclipse = TimedPower();
	visions.clear();
	sands.clear();
	serpents.clear();
	ancestors.clear();
	swarms.clear();
	citadels.clear();
	citadel_fx.clear();
	sons.clear();
	tornadoes.clear();
	thoth.clear();
	rises.clear();
	arcs.clear();
	dots.clear();
	auras.clear();
	stings.clear();
	ability_fx.clear();
	eggs.clear();
	ability_cd.clear();
	speed_k.clear();
	slowed.clear();
	uncontrolled.clear();
	last_reason.clear();
	any_myth_ = false;
	myth_scan_ = 0;
	Sim *s = sim;
	s->events.on(EV_UNIT_DAMAGED, [this](const Event &e) {
		if (sim->godot_rules) on_myth_damaged(e);
	});
	s->events.on(EV_ENTITY_DIED, [this](const Event &e) {
		if (sim->godot_rules && e.kind == K_UNIT) on_myth_died(e.id, e.x, e.z);
	});
}

// ---- which powers, what they cost ----------------------------------------------------------

bool GodPowers::has_power(int owner, int id) const {
	if (id < 0 || id >= GP_COUNT) return false;
	if (!sim->godot_rules) return id < GP_GREEK_COUNT; // (the browser: everyone, the Greek three)
	if (owner <= 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists) return id < GP_GREEK_COUNT;
	const Player &p = sim->players[owner];
	if (p.civ != CIV_EGYPT) return id < GP_GREEK_COUNT;
	if (id < GP_GREEK_COUNT) return false;
	const PowerDef &d = power_def(id);
	const std::string g = god_key(id);
	if (d.age == 0) {
		std::string m = p.god;
		for (char &c : m) c = (char)std::tolower((unsigned char)c);
		return m == g;
	}
	return p.age >= d.age && sim->techs.minor[owner][d.age] == g;
}

std::string GodPowers::power_lock(int owner, int id) const {
	const PowerDef &d = power_def(id);
	const Player *p = owner > 0 && owner < MAX_PLAYERS && sim->players[owner].exists ? &sim->players[owner] : nullptr;
	if (!p) return "No such player";
	if (p->civ != CIV_EGYPT || !is_egypt_power(id)) return std::string("A power of ") + d.god;
	if (d.age > 0 && p->age < d.age) return std::string("Requires the ") + AGES[d.age] + " Age and " + d.god;
	return std::string("Requires ") + d.god;
}

double GodPowers::power_cost(int owner, int id) const {
	const PowerDef &d = power_def(id);
	const double base = d.cost.v[RES_FAVOR];
	if (!is_egypt_power(id) || owner <= 0 || owner >= MAX_PLAYERS) return base;
	if (id == GP_VISION && sim->techs.vision_recharge(owner) < 1) return base; // (Clairvoyance: recasts free of the ramp)
	return base + d.ramp * casts[owner][id];
}

double GodPowers::power_cooldown_of(int owner, int id) const {
	double c = power_def(id).cooldown;
	if (id == GP_VISION) c *= sim->techs.vision_recharge(owner); // (Clairvoyance: -50 %)
	return c;
}

std::vector<int> GodPowers::player_powers(int owner) const {
	std::vector<int> out;
	for (int i = 0; i < GP_COUNT; i++)
		if (has_power(owner, i)) out.push_back(i);
	return out;
}

int GodPowers::nearest_own(int owner, int type, bool building, double x, double z, double r) const {
	const Entities &E = sim->entities;
	int best = -1;
	double bd = r;
	if (building) {
		const BuildingStore &B = E.buildings;
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || !B.built[b] || B.owner[b] != owner || B.type[b] != type) continue;
			const double d = sim->civs.rect_dist(b, x, z);
			if (d <= bd) { bd = d; best = b; }
		}
	} else {
		const UnitStore &U = E.units;
		for (int u = 0; u < U.size(); u++) {
			if (U.removed[u] || U.dead[u] || U.owner[u] != owner || U.type[u] != type) continue;
			const double d = jsm::hypot(U.x[u] - x, U.z[u] - z);
			if (d <= bd) { bd = d; best = u; }
		}
	}
	return best;
}

// is (x, z) in sight of one of owner's (or his allies') units or buildings? (the fog is the
// local player's only, so Shifting Sands asks the sim's sight radii directly)
static bool in_sight(const Sim &S, int owner, double x, double z) {
	const UnitStore &U = S.entities.units;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.dead[r] || !S.is_ally(owner, U.owner[r])) continue;
		const double dx = U.x[r] - x, dz = U.z[r] - z;
		if (dx * dx + dz * dz <= U.sight[r] * U.sight[r]) return true;
	}
	const BuildingStore &B = S.entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !S.is_ally(owner, B.owner[b])) continue;
		const double sr = B.sight[b] + std::max(B.w[b], B.h[b]) * 0.5;
		const double dx = B.x[b] - x, dz = B.z[b] - z;
		if (dx * dx + dz * dz <= sr * sr) return true;
	}
	return false;
}

CastCheck GodPowers::cast_check(int owner, int id, double x, double z, double x2, double z2) const {
	const CastCheck c = can_cast(owner, id);
	if (!c.ok) return c;
	if (!is_egypt_power(id)) return c;
	const PowerDef &d = power_def(id);
	if (d.target == PT_GLOBAL) return c;
	if (std::isnan(x) || std::isnan(z)) return { false, "No target" };
	if (d.target == PT_OWN_TC && nearest_own(owner, B_TOWN_CENTER, true, x, z, 1.5) < 0) return { false, "Target one of your Town Centers" };
	if (d.target == PT_OWN_TC) {
		const int b = nearest_own(owner, B_TOWN_CENTER, true, x, z, 1.5);
		if (is_citadel(b)) return { false, "Already a Citadel Center" };
	}
	if (d.target == PT_OWN_PHARAOH && nearest_own(owner, U_PHARAOH, false, x, z, 3) < 0) return { false, "Target your Pharaoh" };
	if (id == GP_SHIFTING_SANDS) {
		if (std::isnan(x2) || std::isnan(z2)) return { false, "Choose where the sands take your units" };
		if (jsm::hypot(x2 - x, z2 - z) < SANDS_MIN_DIST) return { false, "The destination must be at least 40 m away" };
		if (!in_sight(*sim, owner, x2, z2)) return { false, "The destination must be visible" };
	}
	return c;
}

bool GodPowers::cast2(int owner, int id, double x, double z, double x2, double z2) {
	if (!is_egypt_power(id)) return cast(owner, id, x, z);
	return cast_egypt(owner, id, x, z, x2, z2, true);
}

// ---- casting ---------------------------------------------------------------------------------

bool GodPowers::cast_egypt(int owner, int id, double x, double z, double x2, double z2, bool two) {
	Sim &S = *sim;
	last_reason.clear();
	const PowerDef &d = power_def(id);
	if (d.target != PT_GLOBAL) {
		if (!S.map().clamp_to_map(x, z)) { last_reason = "No target"; return false; } // (bounds: as the Greek powers)
		if (two && !S.map().clamp_to_map(x2, z2)) { last_reason = "No target"; return false; }
	} else if (std::isnan(x) || std::isnan(z)) {
		x = z = 0; // (a global power needs no point)
	}
	if (!two) x2 = z2 = NAN;
	if (id == GP_LOCUST_SWARM && (std::isnan(x2) || std::isnan(z2))) {
		// no direction given: away from the caster's nearest building (into the enemy's land)
		const BuildingStore &B = S.entities.buildings;
		int best = -1;
		double bd = 1e18;
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || B.owner[b] != owner) continue;
			const double dd = (B.x[b] - x) * (B.x[b] - x) + (B.z[b] - z) * (B.z[b] - z);
			if (dd < bd) { bd = dd; best = b; }
		}
		double dx = 1, dz = 0;
		if (best >= 0 && bd > 0.01) {
			const double l = std::sqrt(bd);
			dx = (x - B.x[best]) / l;
			dz = (z - B.z[best]) / l;
		}
		x2 = x + dx * 10;
		z2 = z + dz * 10;
	}
	const CastCheck c = cast_check(owner, id, x, z, x2, z2);
	if (!c.ok) { last_reason = c.reason; return false; }
	if (d.target != PT_GLOBAL) { // (Isis' Divine Shield, as the Greek powers)
		int32_t by = 0;
		if (!S.civs.shield_allows(owner, x, z, nullptr, &by)) {
			const int m = S.entities.building_slot(by);
			if (m >= 0) S.civs.shield_refused[S.entities.buildings.owner[m]]++;
			last_reason = "Blocked by a Divine Shield";
			return false;
		}
	}
	const double now = S.time;
	S.players[owner].res[RES_FAVOR] -= power_cost(owner, id);
	casts[owner][id]++;
	cooldowns[owner][id] = now + power_cooldown_of(owner, id);
	const uint32_t seed = mix((uint32_t)S.tick_count, (uint32_t)owner, (uint32_t)id);
	switch (id) {
		case GP_RAIN: rain[owner] = { owner, now, now + d.duration }; break;
		case GP_PROSPERITY: prosperity[owner] = { owner, now, now + d.duration }; break;
		case GP_ECLIPSE: eclipse = { owner, now, now + d.duration }; break;
		case GP_VISION: {
			visions.push_back({ owner, x, z, now, d.duration, VISION_R0 });
			S.techs.reveals.push_back({ owner, x, z, VISION_R0, now + d.duration });
			break;
		}
		case GP_SHIFTING_SANDS: sands.push_back({ owner, x, z, x2, z2, now, d.delay, d.radius }); break;
		case GP_PLAGUE_OF_SERPENTS: {
			SpawnCast sc;
			sc.owner = owner;
			sc.id = id;
			sc.x = x;
			sc.z = z;
			sc.t0 = now;
			sc.total = SERPENTS;
			serpents.push_back(sc);
			break;
		}
		case GP_ANCESTORS: {
			SpawnCast sc;
			sc.owner = owner;
			sc.id = id;
			sc.x = x;
			sc.z = z;
			sc.t0 = now;
			sc.total = MINIONS;
			sc.die_at = now + MINION_LIFE * S.techs.minion_life(owner);
			ancestors.push_back(sc);
			break;
		}
		case GP_LOCUST_SWARM: {
			double dx = x2 - x, dz = z2 - z;
			const double l = jsm::hypot(dx, dz);
			if (l < 1e-6) { dx = 1; dz = 0; }
			else { dx /= l; dz /= l; }
			// five swarms side by side across the heading, the middle one ahead
			for (int k = 0; k < SWARMS; k++) {
				const double lat = (k - (SWARMS - 1) / 2.0) * 2.2, fwd = -std::abs(k - (SWARMS - 1) / 2.0) * 0.9;
				Swarm w;
				w.owner = owner;
				w.x0 = x - dz * lat + dx * fwd;
				w.z0 = z + dx * lat + dz * fwd;
				S.map().clamp_to_map(w.x0, w.z0); // (bounds: a swarm starts on the map)
				w.dx = dx;
				w.dz = dz;
				w.t0 = now;
				w.dur = d.duration;
				w.radius = d.radius;
				w.seed = mix(seed, (uint32_t)k, 77);
				swarms.push_back(w);
			}
			break;
		}
		case GP_CITADEL: {
			const int b = nearest_own(owner, B_TOWN_CENTER, true, x, z, 1.5);
			BuildingStore &B = S.entities.buildings;
			citadels.push_back(B.id[b]);
			B.max_hp[b] += CITADEL_HP;
			B.hp[b] += CITADEL_HP;
			B.sight[b] += CITADEL_SIGHT;
			citadel_fx.push_back({ B.id[b], B.x[b], B.z[b], now });
			S.economy.recount();
			break;
		}
		case GP_SON_OF_OSIRIS: {
			const int r = nearest_own(owner, U_PHARAOH, false, x, z, 3);
			UnitStore &U = S.entities.units;
			const double ux = U.x[r], uz = U.z[r], rot = U.rot[r];
			const int32_t pid = U.id[r];
			S.entities.remove(pid); // (he becomes the demigod; a new Pharaoh respawns, sim/civ)
			const int u = S.units.spawn(U_SON_OF_OSIRIS, owner, ux, uz, rot);
			if (u >= 0) {
				sons.push_back({ owner, U.id[u], ux, uz, now });
				rises.push_back({ 5, ux, uz, now, owner, U.id[u] });
			}
			break;
		}
		case GP_TORNADO: {
			Tornado t;
			t.owner = owner;
			t.cx = t.x = x;
			t.cz = t.z = z;
			t.t0 = now;
			t.dur = d.duration;
			t.a0 = (seed % 6283) / 1000.0;
			t.next = TORNADO_EVERY;
			tornadoes.push_back(t);
			S.techs.reveals.push_back({ owner, x, z, TORNADO_LOS, now + d.duration });
			break;
		}
		case GP_THOTH_METEOR: {
			ThothCast t;
			t.owner = owner;
			t.cx = x;
			t.cz = z;
			t.t0 = now;
			t.radius = d.radius;
			thoth.push_back(t);
			S.techs.reveals.push_back({ owner, x, z, d.radius, now + d.duration });
			break;
		}
		default: break;
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

// ---- hooks -------------------------------------------------------------------------------------

double GodPowers::gather_mult(int r, bool farm, int res, int) const {
	const UnitStore &U = sim->entities.units;
	const int o = U.owner[r];
	if (o <= 0 || o >= MAX_PLAYERS) return 1;
	const double now = sim->time;
	if (farm && rain[o].until > now) return RAIN_FARM;
	if (!farm && res == RES_GOLD && prosperity[o].until > now) return PROSPERITY_GOLD;
	return 1;
}

static bool eclipse_unit(const GodPowers &G, const Sim &S, int r) {
	if (!(G.eclipse.until > S.time)) return false;
	const UnitStore &U = S.entities.units;
	return U.owner[r] == G.eclipse.owner && unit_def(U.type[r]).cls == CLS_MYTH;
}

double GodPowers::damage_mult(int r) const { return eclipse_unit(*this, *sim, r) ? ECLIPSE_DAMAGE : 1; }
double GodPowers::armor_add(int r) const { return eclipse_unit(*this, *sim, r) ? ECLIPSE_ARMOR : 0; }
double GodPowers::favor_mult(int owner) const { return eclipse.until > sim->time && eclipse.owner == owner ? ECLIPSE_FAVOR : 1; }

bool GodPowers::is_citadel(int b) const {
	if (citadels.empty() || b < 0) return false;
	const int32_t id = sim->entities.buildings.id[b];
	return std::find(citadels.begin(), citadels.end(), id) != citadels.end();
}

double GodPowers::work_mult(int b) const { return is_citadel(b) ? CITADEL_WORK : 1; }
double GodPowers::age_mult(int owner) const {
	if (citadels.empty()) return 1;
	const Entities &E = sim->entities;
	for (int32_t id : citadels) {
		const int b = E.building_slot(id);
		if (b >= 0 && !E.buildings.dead[b] && E.buildings.owner[b] == owner) return CITADEL_WORK;
	}
	return 1;
}
int GodPowers::pop_bonus(int b) const { return is_citadel(b) ? CITADEL_POP : 0; }
double GodPowers::building_attack_mult(int b) const { return is_citadel(b) ? CITADEL_ATTACK : 1; }

void GodPowers::extra_arrows(int b, int target, double damage) {
	if (!is_citadel(b)) return;
	// the third arrow: at another enemy in range if there is one, else the same
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	const UnitStore &U = S.entities.units;
	const BuildingDef &d = building_def(B.type[b]);
	const int e = S.combat.find_enemy_near(B.x[b], B.z[b], B.owner[b], d.attack_range + B.w[b] / 2.0,
			[&](int o) { return o != target; });
	S.combat.fire(B.id[b], U.id[e >= 0 ? e : target], damage * CITADEL_ATTACK, 4);
}

bool GodPowers::is_uncontrolled(int32_t unit) const {
	return std::find(uncontrolled.begin(), uncontrolled.end(), unit) != uncontrolled.end();
}

// exact damage from a god power, counted for the checks; Farms x farm_mult, the caster's
// own (and his allies') x own_mult
void GodPowers::power_hit(int owner, int32_t target, double amount, double farm_mult, double own_mult) {
	Sim &S = *sim;
	Entities &E = S.entities;
	const int t = E.slot(target);
	const int k = E.kind(target);
	if (t < 0 || amount <= 0) return;
	int towner = 0;
	if (k == K_UNIT) {
		if (E.units.dead[t]) return;
		towner = E.units.owner[t];
	} else if (k == K_BUILDING) {
		if (E.buildings.dead[t]) return;
		towner = E.buildings.owner[t];
		if (building_def(E.buildings.type[t]).farm) amount *= farm_mult;
	} else
		return;
	if (S.is_ally(owner, towner)) amount *= own_mult;
	if (amount <= 0) return;
	S.combat.damage(target, amount, Hitter::pseudo(owner), DK_DIVINE);
	if (owner > 0 && owner < MAX_PLAYERS) {
		power_damage[owner] += amount;
		if (k == K_BUILDING) {
			building_damage[owner] += amount;
			if (building_def(E.buildings.type[t]).farm) farm_damage[owner] += amount;
		}
	}
}

// ---- the tick ----------------------------------------------------------------------------------

void GodPowers::update_egypt(double dt) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	const double now = S.time;

	// Vision: the reveal grows 15 m/s from 10 m to 70 m
	for (VisionCast &v : visions) {
		v.r = std::min(power_def(GP_VISION).radius, VISION_R0 + VISION_GROW * (now - v.t0));
		for (Reveal &r : S.techs.reveals)
			if (r.owner == v.owner && r.x == v.x && r.z == v.z) r.r = v.r;
	}
	visions.erase(std::remove_if(visions.begin(), visions.end(), [&](const VisionCast &v) { return now - v.t0 > v.dur; }), visions.end());

	// Shifting Sands: after 3 s every own / allied unit in the circle goes, formation kept
	for (SandsCast &c : sands) {
		if (c.done || now - c.t0 < c.delay) continue;
		c.done = true;
		std::vector<int> rows;
		for (int r = 0; r < U.size(); r++) {
			if (U.removed[r] || U.dead[r] || !S.is_ally(c.owner, U.owner[r]) || U.type[r] == U_ROC) continue;
			if (jsm::hypot(U.x[r] - c.sx, U.z[r] - c.sz) <= c.radius) rows.push_back(r);
		}
		for (int r : rows) {
			double nx = c.dx + (U.x[r] - c.sx), nz = c.dz + (U.z[r] - c.sz);
			S.map().clamp_to_map(nx, nz);
			if (!S.map().walkable_at(nx, nz)) {
				int tx, tz;
				if (!S.pathfinder.nearest_walkable((int)std::floor(nx), (int)std::floor(nz), 6, tx, tz)) continue;
				nx = tx + 0.5;
				nz = tz + 0.5;
			}
			S.movement.stop(r);
			U.x[r] = U.prev_x[r] = nx;
			U.z[r] = U.prev_z[r] = nz;
			S.commands.idle(r);
			c.moved++;
			if (c.owner > 0 && c.owner < MAX_PLAYERS) teleported[c.owner]++;
		}
	}
	sands.erase(std::remove_if(sands.begin(), sands.end(), [&](const SandsCast &c) { return c.done && now - c.t0 > c.delay + 3; }), sands.end());

	// Plague of Serpents / Ancestors: the spawns on their schedule
	auto spawn_wave = [&](SpawnCast &c, int type, int count) {
		RNG rng(mix((uint32_t)(c.t0 * 1000), (uint32_t)c.spawned, (uint32_t)c.owner * 31 + type));
		const double R = power_def(c.id).radius;
		for (int k = 0; k < count && c.spawned < c.total; k++) {
			double px = c.x, pz = c.z;
			for (int tries = 0; tries < 8; tries++) {
				const double a = rng.range(0, PI * 2), rr = std::sqrt(rng.next()) * R;
				px = c.x + jsm::cos(a) * rr;
				pz = c.z + jsm::sin(a) * rr;
				if (S.map().walkable_at(px, pz)) break;
			}
			const int u = S.units.spawn(type, c.owner, px, pz, rng.range(0, PI * 2));
			c.spawned++;
			if (u < 0) continue;
			c.units.push_back(U.id[u]);
			if (type == U_SERPENT) uncontrolled.push_back(U.id[u]);
			rises.push_back({ (uint8_t)(type == U_SERPENT ? 0 : 1), U.x[u], U.z[u], now, c.owner, U.id[u] });
			if (c.owner > 0 && c.owner < MAX_PLAYERS) spawned[c.owner]++;
		}
	};
	for (SpawnCast &c : serpents) {
		const int due = std::min(c.total, SERPENT_WAVE * (1 + (int)std::floor((now - c.t0) / SERPENT_EVERY + 1e-9)));
		if (c.spawned < due) spawn_wave(c, U_SERPENT, due - c.spawned);
	}
	for (SpawnCast &c : ancestors) {
		const int due = std::min(c.total, 1 + (int)std::floor((now - c.t0) / power_def(GP_ANCESTORS).interval + 1e-9));
		if (c.spawned < due) spawn_wave(c, U_MINION, due - c.spawned);
		if (now >= c.die_at) { // they all fall 60 s after the cast
			for (int32_t id : c.units) {
				const int r = E.unit_slot(id);
				if (r >= 0 && !U.dead[r]) S.combat.kill(id, Hitter());
			}
			c.units.clear();
			c.die_at = 1e18;
		}
	}
	ancestors.erase(std::remove_if(ancestors.begin(), ancestors.end(), [&](const SpawnCast &c) { return c.spawned >= c.total && c.units.empty(); }), ancestors.end());
	// the Serpents guard where they rose: attack enemy units near it, walk back when idle
	if (!uncontrolled.empty() && S.tick_count % 10 == 0) {
		for (SpawnCast &c : serpents)
			for (int32_t id : c.units) {
				const int r = E.unit_slot(id);
				if (r < 0 || U.dead[r]) continue;
				if (U.order_type[r] == O_ATTACK) continue;
				const int e = S.combat.find_enemy_near(c.x, c.z, U.owner[r], power_def(GP_PLAGUE_OF_SERPENTS).radius + SERPENT_GUARD);
				if (e >= 0) S.commands.order(r, Order::with_target(O_ATTACK, U.id[e]));
				else if (!U.moving[r] && jsm::hypot(U.x[r] - c.x, U.z[r] - c.z) > power_def(GP_PLAGUE_OF_SERPENTS).radius + 1)
					S.commands.order(r, Order::move(c.x, c.z));
			}
		uncontrolled.erase(std::remove_if(uncontrolled.begin(), uncontrolled.end(), [&](int32_t id) {
			const int r = E.unit_slot(id);
			return r < 0 || U.dead[r];
		}), uncontrolled.end());
		for (SpawnCast &c : serpents)
			c.units.erase(std::remove_if(c.units.begin(), c.units.end(), [&](int32_t id) { const int r = E.unit_slot(id); return r < 0 || U.dead[r]; }), c.units.end());
		serpents.erase(std::remove_if(serpents.begin(), serpents.end(), [&](const SpawnCast &c) { return c.spawned >= c.total && c.units.empty(); }), serpents.end());
	}

	// Locust Swarm: five swarms drift on; every 0.25 s each stings what is under it
	for (Swarm &w : swarms) {
		if (w.done) continue;
		const double age = now - w.t0;
		if (age > w.dur) { w.done = true; continue; }
		w.acc += dt;
		if (w.acc + 1e-9 < SWARM_TICK) continue;
		const double step = w.acc;
		w.acc = 0;
		const double x = w.x0 + w.dx * SWARM_SPEED * age, z = w.z0 + w.dz * SWARM_SPEED * age;
		{ // (bounds: a swarm that drifts off the map is gone)
			double cx = x, cz = z;
			S.map().clamp_to_map(cx, cz);
			if (std::abs(cx - x) > 0.5 || std::abs(cz - z) > 0.5) { w.done = true; continue; }
		}
		const double dmg = SWARM_DPS * step * (S.players[w.owner].age >= 3 ? 1.2 : 1); // (Mythic +20 %)
		std::vector<int32_t> hit;
		S.movement.hash.for_each_near(x, z, w.radius + 1, [&](int r) {
			if (r >= U.size() || U.removed[r] || U.dead[r] || U.type[r] == U_ROC) return;
			if (jsm::hypot(U.x[r] - x, U.z[r] - z) <= w.radius) hit.push_back(U.id[r]);
		});
		std::sort(hit.begin(), hit.end());
		for (int32_t id : hit) power_hit(w.owner, id, dmg, 1, SWARM_OWN);
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b]) continue;
			if (sim->civs.rect_dist(b, x, z) <= w.radius) power_hit(w.owner, B.id[b], dmg, SWARM_FARM, SWARM_OWN);
		}
		ResourceStore &R = E.resources;
		for (int r = 0; r < R.size(); r++) {
			if (R.removed[r] || R.type[r] != R_BERRY || R.amount[r] <= 0) continue;
			if (jsm::hypot(R.x[r] - x, R.z[r] - z) <= w.radius) R.amount[r] = std::max(0.0, R.amount[r] - dmg * SWARM_FARM);
		}
	}
	swarms.erase(std::remove_if(swarms.begin(), swarms.end(), [](const Swarm &w) { return w.done; }), swarms.end());

	// the Citadel: drop the ids of Town Centers that fell
	if (!citadels.empty())
		citadels.erase(std::remove_if(citadels.begin(), citadels.end(), [&](int32_t id) {
			const int b = E.building_slot(id);
			return b < 0 || B.dead[b];
		}), citadels.end());
	citadel_fx.erase(std::remove_if(citadel_fx.begin(), citadel_fx.end(), [&](const CitadelCast &c) { return now - c.t0 > 6; }), citadel_fx.end());
	sons.erase(std::remove_if(sons.begin(), sons.end(), [&](const SonCast &c) { return now - c.t0 > 6; }), sons.end());

	// Tornado: along an Archimedean spiral (r = b a, anticlockwise) at a steady speed
	for (Tornado &t : tornadoes) {
		if (t.done) continue;
		const double age = now - t.t0;
		if (age > t.dur) { t.done = true; continue; }
		const double sarc = TORNADO_SPEED * age; // arc length ~ b a^2 / 2
		const double a = std::sqrt(2 * sarc / TORNADO_SPIRAL), rr = TORNADO_SPIRAL * a;
		double nx = t.cx + jsm::cos(t.a0 + a) * rr, nz = t.cz - jsm::sin(t.a0 + a) * rr; // (z flipped: anticlockwise seen from above)
		S.map().clamp_to_map(nx, nz);
		t.x = nx;
		t.z = nz;
		for (Reveal &v : S.techs.reveals)
			if (v.owner == t.owner && v.r == TORNADO_LOS && v.until == t.t0 + t.dur) { v.x = nx; v.z = nz; }
		t.next -= dt;
		if (t.next > 1e-9) continue;
		t.next += TORNADO_EVERY;
		const double R = power_def(GP_TORNADO).radius;
		auto fall = [&](double d) { return d <= TORNADO_FULL ? 1.0 : std::max(0.0, 1 - (d - TORNADO_FULL) / (R - TORNADO_FULL)); };
		std::vector<int> rows;
		S.movement.hash.for_each_near(nx, nz, R + 1, [&](int r) {
			if (r >= U.size() || U.removed[r] || U.dead[r] || U.type[r] == U_ROC) return;
			if (jsm::hypot(U.x[r] - nx, U.z[r] - nz) <= R) rows.push_back(r);
		});
		std::sort(rows.begin(), rows.end());
		for (int r : rows) {
			const double f = fall(jsm::hypot(U.x[r] - nx, U.z[r] - nz));
			if (f <= 0) continue;
			const double hack = std::min(ARMOR_CAP, unit_def(U.type[r]).armor + S.techs.mods[U.owner[r]].hack[U.type[r]]);
			const double dmg = f * (TORNADO_HACK * (1 - hack) + TORNADO_CRUSH * (1 - crush_armor(U.type[r])));
			const int32_t id = U.id[r];
			const bool own = S.is_ally(t.owner, U.owner[r]);
			power_hit(t.owner, id, dmg, 1, TORNADO_OWN);
			const int r2 = E.unit_slot(id);
			if (r2 < 0 || U.dead[r2]) continue;
			if (!own) {
				auto it = std::lower_bound(slowed.begin(), slowed.end(), std::make_pair(id, -1e18));
				if (it != slowed.end() && it->first == id) it->second = now + TORNADO_SLOW_TIME;
				else slowed.insert(it, { id, now + TORNADO_SLOW_TIME });
				if (f >= 1 && U.gp_state[r2] != 1) {
					knock(r2, nx, nz, 1.2);
					if (t.owner > 0 && t.owner < MAX_PLAYERS) thrown[t.owner]++;
				}
			}
		}
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b]) continue;
			const double dd = sim->civs.rect_dist(b, nx, nz);
			if (dd > R) continue;
			const double f = fall(dd);
			const CivArmor ar = civ_building_armor(B.type[b]);
			const double hack = ar.retold ? ar.hack : 0.5, crush = ar.retold ? ar.crush : SIEGE_CRUSH_ARMOR;
			power_hit(t.owner, B.id[b], f * (TORNADO_HACK * (1 - hack) + TORNADO_CRUSH * (1 - crush)), TORNADO_FARM, TORNADO_OWN);
		}
	}
	tornadoes.erase(std::remove_if(tornadoes.begin(), tornadoes.end(), [](const Tornado &t) { return t.done; }), tornadoes.end());
	if (!slowed.empty())
		slowed.erase(std::remove_if(slowed.begin(), slowed.end(), [&](const std::pair<int32_t, double> &p) { return p.second < now; }), slowed.end());

	// Thoth's Meteor: the first on the centre after 3 s, then one a second on the densest targets
	for (ThothCast &t : thoth) {
		if (t.done) continue;
		while (t.launched < THOTH_METEORS) {
			const double land = t.launched == 0 ? THOTH_FIRST : THOTH_REST + (t.launched - 1) * THOTH_STEP;
			const double fall = power_def(GP_METEOR).delay; // (the Greek meteor's fall: 1.8 s)
			if (now - t.t0 < land - fall) break;
			double tx = t.cx, tz = t.cz;
			if (t.launched > 0) {
				// the densest spot: the enemy unit / building with the most enemies in the blast
				// round it (a spot already struck counts half)
				double best = -1;
				auto score_at = [&](double px, double pz) {
					double sc = 0;
					S.movement.hash.for_each_near(px, pz, THOTH_AREA, [&](int r) {
						if (r < U.size() && !U.removed[r] && !U.dead[r] && S.is_enemy(t.owner, U.owner[r]) &&
								jsm::hypot(U.x[r] - px, U.z[r] - pz) <= THOTH_AREA) sc += 1;
					});
					for (int b = 0; b < B.size(); b++)
						if (!B.removed[b] && !B.dead[b] && S.is_enemy(t.owner, B.owner[b]) && sim->civs.rect_dist(b, px, pz) <= THOTH_AREA) sc += 2;
					for (size_t k = 0; k < t.hit_x.size(); k++)
						if (jsm::hypot(t.hit_x[k] - px, t.hit_z[k] - pz) < THOTH_AREA * 0.6) sc *= 0.5;
					return sc;
				};
				for (int r = 0; r < U.size(); r++) {
					if (U.removed[r] || U.dead[r] || !S.is_enemy(t.owner, U.owner[r])) continue;
					if (jsm::hypot(U.x[r] - t.cx, U.z[r] - t.cz) > t.radius) continue;
					const double sc = score_at(U.x[r], U.z[r]);
					if (sc > best) { best = sc; tx = U.x[r]; tz = U.z[r]; }
				}
				for (int b = 0; b < B.size(); b++) {
					if (B.removed[b] || B.dead[b] || !S.is_enemy(t.owner, B.owner[b])) continue;
					if (jsm::hypot(B.x[b] - t.cx, B.z[b] - t.cz) > t.radius) continue;
					const double sc = score_at(B.x[b], B.z[b]);
					if (sc > best) { best = sc; tx = B.x[b]; tz = B.z[b]; }
				}
				if (best < 0) { // nothing to hit: anywhere in the circle
					RNG rng(mix((uint32_t)(t.t0 * 1000), (uint32_t)t.launched, 911));
					const double a = rng.range(0, PI * 2), rr = std::sqrt(rng.next()) * t.radius;
					tx = t.cx + jsm::cos(a) * rr;
					tz = t.cz + jsm::sin(a) * rr;
				}
			}
			t.hit_x.push_back(tx);
			t.hit_z.push_back(tz);
			const double y = S.map().height_at(tx, tz);
			Meteor m;
			m.owner = t.owner;
			m.x = tx;
			m.z = tz;
			m.t0 = now;
			m.delay = fall;
			m.radius = THOTH_AREA;
			const double sa = 0.6 + 0.35 * jsm::sin(t.launched * 2.1);
			m.sx = tx + 16 * sa;
			m.sy = y + 30;
			m.sz = tz - 14;
			m.kind = 1;
			meteors.push_back(m);
			t.launched++;
		}
		if (t.launched >= THOTH_METEORS && now - t.t0 > power_def(GP_THOTH_METEOR).duration) t.done = true;
	}
	thoth.erase(std::remove_if(thoth.begin(), thoth.end(), [](const ThothCast &t) { return t.done; }), thoth.end());

	// what the renderer still draws
	rises.erase(std::remove_if(rises.begin(), rises.end(), [&](const RiseFx &f) { return now - f.t0 > 4; }), rises.end());
	arcs.erase(std::remove_if(arcs.begin(), arcs.end(), [&](const Arc &a) { return now - a.t0 > 0.5; }), arcs.end());
	speeds();
}

void GodPowers::impact_thoth(const Meteor &m) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	const double x = m.x, z = m.z, y = S.map().height_at(x, z);
	const uint32_t seed = (uint32_t)(int64_t)(S.tick_count * 7919 + 177 + (int64_t)(x * 31));
	scorches.push_back({ x, y, z, S.time, seed, m.radius * 2.2, true });
	std::vector<int> rows;
	S.movement.hash.for_each_near(x, z, m.radius + 1, [&](int r) {
		if (r < U.size() && !U.removed[r] && !U.dead[r] && U.type[r] != U_ROC && jsm::hypot(U.x[r] - x, U.z[r] - z) <= m.radius) rows.push_back(r);
	});
	std::sort(rows.begin(), rows.end());
	for (int r : rows) {
		const int32_t id = U.id[r];
		const double dmg = THOTH_CRUSH * (1 - crush_armor(U.type[r])) + THOTH_DIVINE;
		power_hit(m.owner, id, dmg, 1, THOTH_OWN);
		const int r2 = E.unit_slot(id);
		if (r2 >= 0 && !U.dead[r2]) {
			knock(r2, x, z, 1.5 * (1 - 0.6 * jsm::hypot(U.x[r2] - x, U.z[r2] - z) / m.radius));
			if (m.owner > 0 && m.owner < MAX_PLAYERS) thrown[m.owner]++;
		}
	}
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b]) continue;
		if (sim->civs.rect_dist(b, x, z) > m.radius) continue;
		const CivArmor ar = civ_building_armor(B.type[b]);
		const double crush = ar.retold ? ar.crush : SIEGE_CRUSH_ARMOR;
		power_hit(m.owner, B.id[b], THOTH_CRUSH * (1 - crush) + THOTH_DIVINE, THOTH_OWN, THOTH_OWN);
	}
	fires.push_back({ x, y, z, m.radius * 0.6, S.time, 12 });
	if (m.owner > 0 && m.owner < MAX_PLAYERS) meteors_landed[m.owner]++;
}

// Eclipse (+15 % for the caster's myth units) and Tornado (-35 % for 6 s) change speeds: the
// factor applied to each unit is kept, and re-based when what it should be changes
void GodPowers::speeds() {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const bool ecl = eclipse.until > S.time;
	if (!ecl && slowed.empty() && speed_k.empty()) return;
	std::vector<std::pair<int32_t, double>> want;
	if (ecl)
		for (int r = 0; r < U.size(); r++)
			if (!U.removed[r] && !U.dead[r] && U.owner[r] == eclipse.owner && unit_def(U.type[r]).cls == CLS_MYTH) want.push_back({ U.id[r], ECLIPSE_SPEED });
	for (const auto &p : slowed) {
		auto it = std::lower_bound(want.begin(), want.end(), std::make_pair(p.first, -1e18));
		if (it != want.end() && it->first == p.first) it->second *= TORNADO_SLOW;
		else want.insert(it, { p.first, TORNADO_SLOW });
	}
	// re-base: old factor -> new factor (units gone are dropped)
	std::vector<std::pair<int32_t, double>> next;
	size_t i = 0, j = 0;
	while (i < speed_k.size() || j < want.size()) {
		int32_t id;
		double from = 1, to = 1;
		if (j >= want.size() || (i < speed_k.size() && speed_k[i].first < want[j].first)) { id = speed_k[i].first; from = speed_k[i].second; i++; }
		else if (i >= speed_k.size() || want[j].first < speed_k[i].first) { id = want[j].first; to = want[j].second; j++; }
		else { id = want[j].first; from = speed_k[i].second; to = want[j].second; i++; j++; }
		const int r = E.unit_slot(id);
		if (r < 0) continue;
		if (from != to) U.speed[r] *= to / from;
		if (to != 1) next.push_back({ id, to });
	}
	speed_k.swap(next);
}

} // namespace aov
