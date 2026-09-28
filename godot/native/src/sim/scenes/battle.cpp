// Combat scene setups (see scenes.h): the battle harness scene
// (src/combat/BattleScene.js with src/units/battleHost.js), the godpower
// scene (src/core/scenes/index.js) and the stress scene
// (src/core/scenes/stress.js). Deterministic: every draw from the sim rng is
// made in the JS order, visual ones included (ground scars, dropped gear),
// whose results are kept for the renderer (Combat::scars / drops).
#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <string>

#include "../core/jsmath.h"
#include "../sim.h"
#include "scenes.h"

namespace aov {
namespace scenes {

static const double PI = 3.141592653589793;
static const double S = 0.7071067811865476; // Math.SQRT1_2

namespace {

// ---- battle -----------------------------------------------------------------
// a: along the front (screen right is +a); d: depth (towards the camera is +d)
struct XZ { double x, z; };
inline XZ P(double cx, double cz, double a, double d) { return { cx + (a + d) * S, cz + (d - a) * S }; }

constexpr double COL = 3.0;
constexpr double FRONT = 0.42;
constexpr double SECOND = 1.85;
constexpr double THIRD = 3.7;
constexpr double END = 11.5;
constexpr double GIANT = 17;
inline bool hero_ring(double a, double d) { return std::abs(a) < 2.0 && std::abs(d) < 1.0; }

struct AD { double a, d; };

std::vector<AD> duel_slots(RNG &rng) {
	std::vector<AD> out;
	for (double a = -END + 1.7; a < END - 1.5; a += COL) {
		const double aa = a + rng.range(-0.15, 0.15), dd = rng.range(-0.3, 0.3);
		if (hero_ring(aa, dd)) continue;
		out.push_back({ aa, dd });
	}
	return out;
}

int place_unit(Sim &sim, int type, int owner, double x, double z, double rot) {
	int wx, wz;
	if (sim.pathfinder.nearest_walkable((int)std::floor(x), (int)std::floor(z), 6, wx, wz) &&
			!sim.map().is_walkable((int)std::floor(x), (int)std::floor(z))) {
		x = wx + 0.5;
		z = wz + 0.5;
	}
	return sim.units.spawn(type, owner, x, z, rot);
}

void set_line(Sim &sim, int r, double cx, double cz, double side, double d0) {
	UnitStore &U = sim.entities.units;
	U.combat_line[r] = 1;
	U.line_cx[r] = cx;
	U.line_cz[r] = cz;
	U.line_nx[r] = S * side;
	U.line_nz[r] = S * side;
	U.line_d0[r] = d0;
}

struct Army { std::vector<int32_t> hoplite, toxotes, hippikon, minotaur, reserve, second; };

// One army behind the front rank (see BattleScene.js army()).
Army army(Sim &sim, int owner, double side, double cx, double cz, std::vector<AD> &ranks) {
	RNG &rng = sim.rng;
	UnitStore &U = sim.entities.units;
	const double rot = side > 0 ? -3 * PI / 4 : PI / 4;
	Army units;
	auto at = [&](int type, double a, double d) {
		const XZ p = P(cx, cz, a * side, d * side);
		const double r = rot + rng.range(-0.05, 0.05);
		const int u = place_unit(sim, type, owner, p.x, p.z, r);
		const int32_t id = U.id[u];
		if (type == U_HOPLITE) units.hoplite.push_back(id);
		else if (type == U_TOXOTES) units.toxotes.push_back(id);
		else if (type == U_HIPPIKON) units.hippikon.push_back(id);
		else if (type == U_MINOTAUR) units.minotaur.push_back(id);
		return u;
	};
	// second rank: a full pace behind the fighters, half a file over, holding
	for (double a = -END + 1.7 + COL / 2; a < END - 2.2; a += COL) {
		if (rng.chance(0.25)) continue;
		const double aa = a + rng.range(-0.12, 0.12);
		if (std::abs(aa) < 2.2) continue;
		const double dd = SECOND + rng.range(-0.1, 0.15);
		const int u = at(U_HOPLITE, aa, dd);
		U.combat_leash[u] = 0.2;
		U.kit[u] = rng.chance(0.3) ? 1 : 0;
		set_line(sim, u, cx, cz, side, SECOND - 0.3);
		U.max_hp[u] *= 3;
		U.hp[u] = U.max_hp[u];
		units.second.push_back(U.id[u]);
		ranks.push_back({ aa * side, dd * side });
	}
	// third rank: a loose reserve standing ready behind the second
	for (int i = 0; i < 8; i++) {
		const double a = (i - 3.5) * 2.9 + rng.range(-0.15, 0.15);
		const double d = THIRD + rng.range(-0.12, 0.12);
		const int u = at(U_HOPLITE, a, d);
		U.combat_leash[u] = 0.2;
		set_line(sim, u, cx, cz, side, THIRD - 0.5);
		units.reserve.push_back(U.id[u]);
		ranks.push_back({ a * side, d * side });
	}
	// archers in two loose files of four behind the reserve
	for (int i = 0; i < 8; i++) {
		const double knot = (i < 4 ? -6.5 : 6.5) * side;
		const double a = knot + (i % 4 - 1.5) * 1.9 + rng.range(-0.15, 0.15);
		const double d = 6.4 + (i % 2) * 0.5 + rng.range(-0.1, 0.1);
		const int u = at(U_TOXOTES, a, d);
		U.combat_reach[u] = 16;
		U.combat_leash[u] = 0.5;
		U.max_hp[u] *= 4;
		U.hp[u] = U.max_hp[u];
	}
	// cavalry held in reserve on the right
	for (int i = 0; i < 4; i++) {
		const double a = 12.5 + i * 2.6 + rng.range(-0.1, 0.1);
		const double d = 7.2 + rng.range(-0.1, 0.1);
		const int u = at(U_HIPPIKON, a, d);
		set_line(sim, u, cx, cz, side, 6.8);
		U.combat_leash[u] = 0.3;
		U.max_hp[u] *= 4;
		U.hp[u] = U.max_hp[u];
	}
	// the minotaur fights the enemy cyclops out on the left flank
	const int mino = at(U_MINOTAUR, -GIANT, 1.8);
	U.combat_leash[mino] = 2;
	U.combat_reach[mino] = 1.6;
	set_line(sim, mino, cx, cz, side, 1.7);
	for (int32_t id : units.reserve) {
		const int u = sim.entities.unit_slot(id);
		U.max_hp[u] *= 3;
		U.hp[u] = U.max_hp[u];
	}
	for (const auto *list : { &units.hoplite, &units.minotaur, &units.toxotes })
		for (int32_t id : *list) {
			const int u = sim.entities.unit_slot(id);
			U.attack_cd[u] = rng.range(0, unit_def(U.type[u]).attack.cooldown);
		}
	for (int32_t id : units.minotaur) {
		const int u = sim.entities.unit_slot(id);
		U.hp[u] = U.max_hp[u] * rng.range(0.6, 0.9);
	}
	return units;
}

// battleHost.js fieldHeroesAndMyth
std::vector<int32_t> field_heroes_and_myth(Sim &sim, int owner, double side, double cx, double cz, double rot) {
	std::vector<int32_t> out;
	UnitStore &U = sim.entities.units;
	auto put = [&](int type, double a, double d, double leash = -1, double reach = -1) {
		XZ p = P(cx, cz, a * side, d * side);
		if (!sim.map().is_walkable((int)std::floor(p.x), (int)std::floor(p.z))) {
			int wx, wz;
			if (sim.pathfinder.nearest_walkable((int)std::floor(p.x), (int)std::floor(p.z), 6, wx, wz)) {
				p.x = wx + 0.5;
				p.z = wz + 0.5;
			}
		}
		const int u = sim.units.spawn(type, owner, p.x, p.z, rot);
		if (leash >= 0) U.combat_leash[u] = leash;
		if (reach >= 0) U.combat_reach[u] = reach;
		U.attack_cd[u] = sim.rng.range(0, unit_def(type).attack.cooldown);
		out.push_back(U.id[u]);
	};
	put(U_HERO, side > 0 ? -3.5 : 3.5, 0.9, 4, 0.4);
	put(U_CYCLOPS, 6.5, 1.2, 4, 0.3);
	put(U_MEDUSA, -13, 7.2);
	for (int i = 0; i < 4; i++) put(U_CENTAUR, -17.5 + (i % 2) * 1.8, 7.5 + i * 1.3);
	return out;
}

void order_attack(Sim &sim, int32_t id, int32_t target, bool automatic) {
	const int r = sim.entities.unit_slot(id);
	if (r < 0) return;
	Order o = Order::with_target(O_ATTACK, target);
	if (automatic) o.b = ATK_AUTO;
	sim.commands.order(r, o);
}

void fallen(Sim &sim, double cx, double cz, std::vector<AD> &taken) {
	RNG &rng = sim.rng;
	UnitStore &U = sim.entities.units;
	auto clear = [&](double a, double d, double r) {
		for (const AD &t : taken)
			if (!(jsm::hypot(t.a - a, (t.d - d) * 1.3) > r)) return false;
		return true;
	};
	auto body = [&](int type, int owner, double a, double d) {
		taken.push_back({ a, d });
		const XZ p = P(cx, cz, a, d);
		const double rot = rng.range(0, PI * 2);
		const int u = place_unit(sim, type, owner, p.x, p.z, rot);
		sim.combat.kill(U.id[u], Hitter());
		U.anim_die_t[u] = 2;
	};
	int n = 0;
	std::vector<double> seam;
	for (double a = -END + 1.7 + COL / 2; a < END - 1.5; a += COL)
		if (!hero_ring(a, 0)) seam.push_back(a);
	for (size_t i = 0; i < seam.size() && n < 6; i++) {
		if (i % 3 == 2) continue;
		const double a = seam[i] + rng.range(-0.35, 0.35), d = rng.range(-0.6, 0.6);
		const int owner = n % 2 ? ENEMY : PLAYER;
		const int type = rng.chance(0.12) ? U_TOXOTES : U_HOPLITE;
		body(type, owner, a, d);
		n++;
	}
	for (int k = 0; k < 400 && n < 8; k++) {
		const double a = rng.range(-END + 1, END - 1);
		const double sgn = rng.chance(0.5) ? 1 : -1;
		const double d = sgn * rng.range(1.0, 1.4);
		if (hero_ring(a, d) || !clear(a, d, 1.1)) continue;
		body(U_HOPLITE, d > 0 ? PLAYER : ENEMY, a, d);
		n++;
	}
	// loose gear in the trampled ground behind both fronts
	for (int i = 0, got = 0; i < 120 && got < 2; i++) {
		const double a = rng.range(-END + 1, END - 1);
		const double sgn = rng.chance(0.5) ? 1 : -1;
		const double d = sgn * rng.range(0.9, 2.6);
		if (!clear(a, d, 0.75)) continue;
		got++;
		const XZ p = P(cx, cz, a, d);
		const int owner = d > 0 ? PLAYER : ENEMY;
		const double k = rng.next();
		Drop g{};
		g.x = p.x;
		g.z = p.z;
		g.owner = owner;
		g.life = sim.time + 60; // (die time)
		if (k < 0.5) {
			g.kind = DROP_SHIELD;
			g.rot = rng.range(0, 6.28);
			g.tilt = rng.range(-0.1, 0.3);
			g.roll = rng.range(-0.1, 0.1);
		} else if (k < 0.8) {
			g.kind = DROP_HELMET;
			g.rot = rng.range(0, 6.28);
			g.tilt = rng.range(-0.5, 0.5);
			g.roll = rng.range(1.2, 1.7);
			g.lift = 0.12;
		} else {
			g.kind = k < 0.9 ? DROP_SPEAR : DROP_STUB;
			g.rot = rng.range(0, 6.28);
			g.tilt = rng.range(-0.05, 0.05);
		}
		sim.combat.drops.push_back(g);
	}
}

struct Spot { double a, d, r0; };
void churn(Sim &sim, double cx, double cz, const std::vector<Spot> &spots) {
	RNG &rng = sim.rng;
	auto scar = [&]() {
		const double r = rng.range(0.6, 1.0);
		const double dirt = rng.range(0.6, 0.95);
		return std::array<double, 2>{ r, dirt };
	};
	for (const Spot &s : spots)
		for (int i = 0; i < 5; i++) {
			const double a = s.a + rng.range(-0.7, 0.7) * s.r0;
			const double d = s.d + rng.range(-0.6, 0.6) * s.r0;
			const XZ p = P(cx, cz, a, d);
			const auto v = scar();
			sim.combat.scars.push_back({ p.x, p.z, v[0] * s.r0, v[1], 0 });
		}
	for (int i = 0; i < 24; i++) {
		const double a = rng.range(-END - 1, END + 1);
		const double d = rng.range(-3.8, 3.8);
		const XZ p = P(cx, cz, a, d);
		const double r = rng.range(0.35, 0.7);
		const double dirt = rng.range(0.3, 0.6);
		sim.combat.scars.push_back({ p.x, p.z, r, dirt, 0 });
	}
}

// The fight has trampled the meadow flat: a broad band of bare earth under
// the duel line inside a fringe of trodden dry grass.
void trample(Sim &sim, double cx, double cz) {
	GameMap &map = sim.map();
	const double V = map.world_size() / map.cols;
	auto soft = [&](int i, int j, double f, int s) {
		const double X = i * f, Z = j * f;
		const double x0 = std::floor(X), z0 = std::floor(Z), ax = X - x0, az = Z - z0;
		const double sx = ax * ax * (3 - 2 * ax), sz = az * az * (3 - 2 * az);
		auto h = [&](double a, double b) { return hash2((int32_t)a, (int32_t)b, s); };
		return (h(x0, z0) * (1 - sx) + h(x0 + 1, z0) * sx) * (1 - sz) + (h(x0, z0 + 1) * (1 - sx) + h(x0 + 1, z0 + 1) * sx) * sz;
	};
	const double R = GIANT + 5;
	const int c0x = (int)std::floor((cx - R) / V), c1x = (int)std::ceil((cx + R) / V), c0z = (int)std::floor((cz - R) / V),
			  c1z = (int)std::ceil((cz + R) / V);
	for (int j = c0z; j <= c1z; j++)
		for (int i = c0x; i <= c1x; i++) {
			if (!map.in_cols(i, j)) continue;
			const int k = map.c_idx(i, j);
			const int g = map.ground[k];
			if (g != GRASS && g != DRYGRASS && g != DIRT) continue;
			const double x = (i + 0.5) * V - cx, z = (j + 0.5) * V - cz;
			const double a = (x - z) * S, d = (x + z) * S;
			const double n = soft(i, j, 0.18, 611) - 0.5, n2 = soft(i, j, 0.5, 612) - 0.5;
			const double ea = std::max(0.0, std::abs(a) - (GIANT + 1.5));
			const double w = 3.4 + n * 2.4 + n2 * 0.8 - ea * 0.9;
			const double ad = std::abs(d - 0.2);
			if (ad < w && !(n2 > 0.36 && ad > 1.8)) map.ground[k] = DIRT;
			else if (ad < w + 1.6 + n2 * 1.2 && g == GRASS) map.ground[k] = DRYGRASS;
		}
	map.mark_dirty(c0x - 1, c0z - 1, c1x + 1, c1z + 1);
}

// Single combats on the duel field: a man from each army squares up to his
// opposite number on a diagonal, blows out of step.
void duels(Sim &sim, double cx, double cz, const std::vector<AD> &slots) {
	RNG &rng = sim.rng;
	UnitStore &U = sim.entities.units;
	int k = 0;
	for (const AD &s : slots) {
		int32_t pair[2];
		const double skew = (k++ % 2 ? 1 : -1) * 0.12;
		for (int si = 0; si < 2; si++) {
			const double side = si == 0 ? 1 : -1;
			const int owner = side > 0 ? PLAYER : ENEMY;
			const double lat = s.a + side * skew + rng.range(-0.1, 0.1);
			const XZ p = P(cx, cz, lat, s.d + side * FRONT);
			const int u = place_unit(sim, U_HOPLITE, owner, p.x, p.z, side > 0 ? -3 * PI / 4 : PI / 4);
			U.kit[u] = (uint8_t)((k + (side > 0 ? 0 : 1)) % 2);
			U.max_hp[u] *= 4;
			U.hp[u] = U.max_hp[u] * (rng.chance(0.25) ? rng.range(0.35, 0.5) : rng.range(0.7, 1.0));
			U.combat_leash[u] = 2.2;
			U.combat_reach[u] = 0.3;
			set_line(sim, u, cx, cz, side, side * s.d + FRONT - 0.12);
			U.attack_cd[u] = rng.range(0, unit_def(U_HOPLITE).attack.cooldown);
			pair[si] = U.id[u];
		}
		order_attack(sim, pair[0], pair[1], true);
		order_attack(sim, pair[1], pair[0], true);
	}
}

// battleHost.js engageHeroesAndMyth: each hero, cyclops and medusa picks a fight
void engage_heroes_and_myth(Sim &sim, const std::vector<int32_t> &list) {
	UnitStore &U = sim.entities.units;
	for (int32_t id : list) {
		const int u = sim.entities.unit_slot(id);
		const UnitDef &d = unit_def(U.type[u]);
		int t = -1;
		if (U.type[u] == U_HERO)
			t = sim.combat.find_enemy_near(U.x[u], U.z[u], U.owner[u], 9, [&](int o) {
				const UnitDef &od = unit_def(U.type[o]);
				return od.myth || od.hero;
			});
		if (t < 0) t = sim.combat.find_enemy_near(U.x[u], U.z[u], U.owner[u], d.attack.projectile ? 13 : 9);
		if (t >= 0) order_attack(sim, id, U.id[t], true);
	}
}

} // namespace

SceneCtx battle_setup(Sim &sim) {
	const double cx = 64, cz = 64;
	UnitStore &U = sim.entities.units;
	trample(sim, cx, cz);
	std::vector<AD> ranks;
	const Army blue = army(sim, PLAYER, 1, cx, cz, ranks);
	const Army red = army(sim, ENEMY, -1, cx, cz, ranks);
	std::vector<int32_t> myth = field_heroes_and_myth(sim, PLAYER, 1, cx, cz, -3 * PI / 4);
	const std::vector<int32_t> myth_red = field_heroes_and_myth(sim, ENEMY, -1, cx, cz, PI / 4);
	myth.insert(myth.end(), myth_red.begin(), myth_red.end());
	// the two heroes meet in the open ring at the centre of the field; each
	// cyclops holds the right end of its own line opposite the enemy minotaur
	for (int32_t id : myth) {
		const int u = sim.entities.unit_slot(id);
		const double side = U.owner[u] == PLAYER ? 1 : -1;
		auto hold = [&](double a, double d, double d0) {
			const XZ p = P(cx, cz, a * side, d * side);
			U.x[u] = U.prev_x[u] = p.x;
			U.z[u] = U.prev_z[u] = p.z;
			set_line(sim, u, cx, cz, side, d0);
		};
		if (U.type[u] == U_HERO) {
			hold(0.25, 0.6, 0.45);
			U.combat_leash[u] = 2.5;
			U.combat_reach[u] = 1.7;
		} else if (U.type[u] == U_CYCLOPS) {
			hold(GIANT, 2.0, 1.8);
			U.combat_leash[u] = 5;
			U.combat_reach[u] = 1.6;
		}
	}
	auto near = [&](int u, const std::vector<int32_t> &list) {
		int32_t best = 0;
		double bd = INFINITY;
		for (int32_t oid : list) {
			const int o = sim.entities.unit_slot(oid);
			const double d = jsm::hypot(U.x[o] - U.x[u], U.z[o] - U.z[u]) + sim.rng.range(0, 1.5);
			if (d < bd) {
				bd = d;
				best = oid;
			}
		}
		return best;
	};
	// archers loose over the duels at the enemy archers, each at his own man
	auto charge = [&](const Army &own, const Army &foe) {
		for (int32_t id : own.toxotes) {
			const int32_t t = near(sim.entities.unit_slot(id), foe.toxotes);
			if (t) order_attack(sim, id, t, true);
		}
	};
	// the red outpost the blue army is marching on
	auto bp = [&](int type, double a, double d) {
		const XZ p = P(cx, cz, a, d);
		place_near(sim, type, ENEMY, p.x, p.z, true, 3);
	};
	bp(B_BARRACKS, -9, -17);
	bp(B_HOUSE, 3, -17.5);
	bp(B_HOUSE, 10, -16.5);
	bp(B_TEMPLE, 19, -17.5);
	charge(blue, red);
	charge(red, blue);
	const std::vector<AD> slots = duel_slots(sim.rng);
	// keep bodies clear of the duels, the hero ring and the giants
	std::vector<AD> taken;
	for (const AD &s : slots) {
		taken.push_back({ s.a, s.d + FRONT });
		taken.push_back({ s.a, s.d - FRONT });
	}
	taken.insert(taken.end(), ranks.begin(), ranks.end());
	for (const AD &t : std::vector<AD>{ { 0, 0 }, { -GIANT, 0 }, { GIANT, 0 }, { -GIANT + 1, 1.5 }, { GIANT - 1, -1.5 } }) taken.push_back(t);
	fallen(sim, cx, cz, taken);
	std::vector<Spot> spots;
	for (const AD &s : slots) spots.push_back({ s.a, s.d, 1.1 });
	spots.push_back({ 0, 0.3, 1.8 });
	spots.push_back({ -GIANT, 0.3, 1.8 });
	spots.push_back({ GIANT, 0.3, 1.8 });
	churn(sim, cx, cz, spots);
	duels(sim, cx, cz, slots);
	engage_heroes_and_myth(sim, myth);
	std::vector<int32_t> heroes, cyc;
	for (int32_t id : myth) {
		const int u = sim.entities.unit_slot(id);
		if (U.type[u] == U_HERO) heroes.push_back(id);
		if (U.type[u] == U_CYCLOPS) cyc.push_back(id);
	}
	for (int32_t id : heroes) {
		const int u = sim.entities.unit_slot(id);
		U.line_d0[u] = 0.45;
		U.combat_leash[u] = 3;
	}
	if (heroes.size() == 2) {
		order_attack(sim, heroes[0], heroes[1], true);
		order_attack(sim, heroes[1], heroes[0], true);
	}
	std::vector<int32_t> minos = blue.minotaur;
	minos.insert(minos.end(), red.minotaur.begin(), red.minotaur.end());
	for (int32_t mid : minos) {
		const int m = sim.entities.unit_slot(mid);
		for (int32_t cid : cyc) {
			const int c = sim.entities.unit_slot(cid);
			if (U.owner[c] == U.owner[m]) continue;
			order_attack(sim, mid, cid, true);
			order_attack(sim, cid, mid, true);
			U.combat_leash[m] = 2;
			break;
		}
	}
	SceneCtx ctx;
	ctx.ok = true;
	ctx.focus_x = cx;
	ctx.focus_z = cz;
	return ctx;
}

// Capture on a beat, not between blows: step the sim a tick at a time, up to
// a second and a half, until several men along the field have just been struck.
void battle_after(Sim &sim, const SceneCtx &) {
	for (int i = 0; i < 10; i++) sim.fast_forward(1.0 / 30);
	const UnitStore &U = sim.entities.units;
	auto hot = [&]() {
		int fresh = 0, n = 0;
		for (int r = 0; r < U.size(); r++) {
			if (U.removed[r] || U.dead[r]) continue;
			const UnitDef &d = unit_def(U.type[r]);
			if (d.hero || d.myth) continue;
			const double s = sim.time - (std::isnan(U.melee_t[r]) ? -99 : U.melee_t[r]);
			if (s < 0.12) fresh++;
			if (s < 0.4) n++;
		}
		return fresh >= 3 && n >= 6;
	};
	for (int i = 0; i < 150 && !hot(); i++) sim.fast_forward(1.0 / 30);
}

// ---- godpower -----------------------------------------------------------------
SceneCtx godpower_setup(Sim &sim) {
	const double cx = 60, cz = 62;
	std::vector<int32_t> red = sim.spawn_block(U_HOPLITE, ENEMY, 24, cx, cz, 6, 1.05, PI / 4);
	const std::vector<int32_t> t = sim.spawn_block(U_TOXOTES, ENEMY, 10, cx - 4, cz - 4, 5, 1.0, PI / 4);
	const std::vector<int32_t> m = sim.spawn_block(U_MINOTAUR, ENEMY, 2, cx + 3, cz - 3, 0, 2.2, PI / 4);
	red.insert(red.end(), t.begin(), t.end());
	red.insert(red.end(), m.begin(), m.end());
	place_near(sim, B_BARRACKS, ENEMY, cx - 9, cz - 3, true, 4);
	place_near(sim, B_HOUSE, ENEMY, cx - 3, cz - 10, true, 4);
	place_near(sim, B_HOUSE, ENEMY, cx + 4, cz - 10, true, 4);
	sim.spawn_block(U_HOPLITE, PLAYER, 9, cx + 10, cz + 10, 3, 1.0, PI + PI / 4);
	UnitStore &U = sim.entities.units;
	for (int32_t id : red) {
		const int u = sim.entities.unit_slot(id);
		sim.commands.order(u, Order::move(U.x[u] + 3, U.z[u] + 3));
	}
	sim.players[PLAYER].res[RES_FAVOR] = 100;
	sim.godpowers.cast(PLAYER, GP_METEOR, cx - 9, cz - 3);
	sim.fast_forward(0.5);
	sim.godpowers.cast(PLAYER, GP_LIGHTNING_STORM, cx, cz);
	sim.fast_forward(2.4);
	// step until a fresh bolt is on screen so the capture always shows one
	for (int i = 0; i < 60; i++) {
		bool fresh = false;
		for (const Bolt &b : sim.godpowers.bolts)
			if (!b.sky && sim.time - b.t0 < 0.12 && jsm::hypot(b.x - cx, b.z - cz) < 6) fresh = true;
		if (fresh) break;
		sim.tick();
	}
	SceneCtx ctx;
	ctx.ok = true;
	ctx.focus_x = cx;
	ctx.focus_z = cz;
	return ctx;
}

// ---- stress -----------------------------------------------------------------
namespace {

const int MYTH[4] = { U_MINOTAUR, U_CENTAUR, U_CYCLOPS, U_MEDUSA };

std::vector<int> army_types(int n) {
	const int n_myth = n >= 8 ? std::max(1, (int)js_round(n * 0.1)) : 0;
	const int n_cav = (int)js_round(n * 0.2), n_arch = (int)js_round(n * 0.25);
	const int n_hop = std::max(0, n - n_myth - n_cav - n_arch);
	std::vector<int> out;
	for (int i = 0; i < n_hop; i++) out.push_back(U_HOPLITE);
	for (int i = 0; i < n_cav; i++) out.push_back(U_HIPPIKON);
	for (int i = 0; i < n_myth; i++) out.push_back(MYTH[i % 4]);
	for (int i = 0; i < n_arch; i++) out.push_back(U_TOXOTES);
	return out; // front rank first
}

// One army block facing the enemy across a front, its front rank `gap` tiles
// from the front's centre on the side of its own town.
std::vector<int32_t> spawn_army_block(Sim &sim, int owner, const std::vector<int> &types, const Front &front, double dx, double dz, double gap = 4) {
	const double sx = -dz, sz = dx;
	const int n = (int)types.size();
	const int cols = std::min(n, std::max(6, (int)std::ceil(std::sqrt((double)n * 3))));
	const double sp = 1.2;
	const double rot = jsm::atan2(dx, dz);
	std::vector<int32_t> out;
	for (int i = 0; i < n; i++) {
		const int col = i % cols, row = i / cols;
		const double lateral = (col - (cols - 1) / 2.0) * sp + sim.rng.range(-0.15, 0.15);
		const double back = gap + row * sp + sim.rng.range(-0.15, 0.15);
		double x = front.tx + 0.5 + sx * lateral - dx * back, z = front.tz + 0.5 + sz * lateral - dz * back;
		if (!sim.map().is_walkable((int)std::floor(x), (int)std::floor(z))) {
			int wx, wz;
			if (sim.pathfinder.nearest_walkable((int)std::floor(x), (int)std::floor(z), 8, wx, wz)) {
				x = wx + 0.5;
				z = wz + 0.5;
			}
		}
		const int u = sim.units.spawn(types[i], owner, x, z, rot);
		out.push_back(sim.entities.units.id[u]);
	}
	return out;
}

} // namespace

// 6 players (2..6) on a 256-tile map, each with a town, villagers gathering
// and an army split over the two fronts it shares with its ring neighbours,
// every soldier ordered onto a man of the opposing block; every player runs
// an EnemyAI. `total` units across players, 30 % villagers (at least 5 each).
SceneCtx stress_setup(Sim &sim, int units) {
	const int total = std::max(12, units);
	const std::vector<Start> starts = sim.world.starts;
	const int P = (int)starts.size();
	for (const Start &s : starts) {
		Player &p = sim.add_player(s.owner, s.owner == PLAYER ? "You" : "AI " + std::to_string(s.owner), true);
		p.is_ai = true; // every seat is driven by an EnemyAI here, the local player too
		p.res[RES_FOOD] = 3000;
		p.res[RES_WOOD] = 3000;
		p.res[RES_GOLD] = 3000;
		p.res[RES_FAVOR] = 100;
		p.age = 1;
		if (s.owner != sim.combat.ai().owner) sim.combat.add_ai(s.owner);
	}
	// soldiers go for enemy buildings as soon as their fight is over
	for (EnemyAI &ai : sim.combat.ais) ai.next_wave_at = 0;
	// towns and villagers
	std::vector<int> army_n(P);
	for (int i = 0; i < P; i++) {
		const int per = total / P + (i < total % P ? 1 : 0);
		const int vill = std::max(5, (int)js_round(per * 0.3));
		build_town(sim, starts[i].owner, starts[i], vill, 0);
		army_n[i] = std::max(0, per - vill);
	}
	// armies: half of each army on each of its two fronts
	const std::vector<Front> fronts = stress_fronts(starts);
	std::vector<int> block_order;                              // Map insertion order of front indices
	std::map<int, std::map<int, std::vector<int32_t>>> blocks; // front index -> owner -> units
	for (int i = 0; i < P; i++) {
		const std::vector<int> types = army_types(army_n[i]);
		std::vector<int> mine;
		std::vector<std::vector<int>> halves;
		if (P == 2) {
			mine = { 0 };
			halves = { types };
		} else {
			mine = { (i - 1 + P) % P, i };
			halves.resize(2);
			for (size_t k = 0; k < types.size(); k++) halves[k % 2].push_back(types[k]);
		}
		for (size_t h = 0; h < mine.size(); h++) {
			const int fi = mine[h];
			const Front &f = fronts[fi];
			const Start &me = starts[i];
			double dx = f.tx - me.tx, dz = f.tz - me.tz;
			double d = jsm::hypot(dx, dz);
			if (d == 0) d = 1;
			dx /= d;
			dz /= d;
			std::vector<int32_t> us = spawn_army_block(sim, me.owner, halves[h], f, dx, dz);
			if (!blocks.count(fi)) block_order.push_back(fi);
			blocks[fi][me.owner] = us;
		}
	}
	// every soldier onto a man of the opposing block (spread along its line)
	for (int fi : block_order) {
		const Front &f = fronts[fi];
		auto &sides = blocks[fi];
		const std::vector<int32_t> a = sides.count(f.a) ? sides[f.a] : std::vector<int32_t>();
		const std::vector<int32_t> b = sides.count(f.b) ? sides[f.b] : std::vector<int32_t>();
		for (int pass = 0; pass < 2; pass++) {
			const std::vector<int32_t> &mine = pass == 0 ? a : b, &theirs = pass == 0 ? b : a;
			if (theirs.empty()) continue;
			for (size_t k = 0; k < mine.size(); k++) {
				const int32_t t = theirs[(size_t)std::floor((double)(k * theirs.size()) / mine.size())];
				order_attack(sim, mine[k], t, false);
			}
		}
	}
	SceneCtx ctx;
	ctx.ok = true;
	ctx.focus_x = fronts.empty() ? starts[0].tx : fronts[0].tx;
	ctx.focus_z = fronts.empty() ? starts[0].tz : fronts[0].tz;
	return ctx;
}

} // namespace scenes
} // namespace aov
