// The Egyptian gods' myth units' abilities (Godot-only, behind Sim::godot_rules; see
// godpowers.h, units/defs.h, civ.cpp egypt_unit and godot/PORTING.md "The Egyptian gods").
// Retold (EGYPT.md 5), Retold metres x0.6:
//   Anubite      Jump: leaps onto an enemy 4-11 m away (2.4-6.6 tiles) for 15 hack, recharge 12 s
//   Wadjet       Venomous: +2.5 divine / s for 5 s on the units it hits (not siege)
//   Sphinx       Whirlwind: 30 hack over 2 s to adjacent enemies in 2.5 m (1.5 tiles), recharge 15 s
//   Petsuchos    its hits Illuminate the target: a 25 m (15-tile) reveal for 6 s
//   Scarab       Causticity: dying, 70 divine to enemies within 6 m (3.6 tiles)
//   Scorpion Man Sting: the 3 nearest enemies in 2 m (1.2 tiles), 3 stings, each 4 divine + 1 / s
//                for 6 s, recharge 16 s
//   Mummy        Reincarnation: a curse in 2 m round its target (range 12 m), 2 pierce + 4 divine / s
//                for 15 s; a cursed human / myth unit that dies rises as the Mummy owner's Minion,
//                recharge 18 s
//   Avenger      Spin: 100 hack over 5 s to adjacent enemies in 4 m (2.4 tiles), recharge 10 s
//   Phoenix      Rebirth: dying, it leaves a Phoenix Egg that hatches a Phoenix after 50 s
//   Son of Osiris chain lightning: the bolt jumps on to 3 more enemies within 8 m (4.8 tiles)
// Bast's Eclipse cuts the recharges by 60 %. An ability fires when the unit is fighting (an
// attack order on a unit) and its foe is in reach. Deterministic: no RNG; rows in id order.
#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"
#include "godpowers.h"

namespace aov {

namespace {
constexpr double JUMP_MIN = 4 * 0.6, JUMP_MAX = 11 * 0.6, JUMP_JACKAL = 3 * 0.6, JUMP_DAMAGE = 15, JUMP_CD = 12, JUMP_TIME = 0.45;
constexpr double VENOM_DPS = 2.5, VENOM_TIME = 5;
constexpr double WHIRL_RADIUS = 2.5 * 0.6, WHIRL_DAMAGE = 30, WHIRL_TIME = 2, WHIRL_CD = 15;
constexpr double ILLUMINATE_RADIUS = 25 * 0.6, ILLUMINATE_TIME = 6;
constexpr double CAUSTIC_RADIUS = 6 * 0.6, CAUSTIC_DAMAGE = 70;
constexpr double STING_RADIUS = 2 * 0.6, STING_DAMAGE = 4, STING_DOT = 1, STING_DOT_TIME = 6, STING_CD = 16, STING_GAP = 0.5;
constexpr int STING_TARGETS = 3, STINGS = 3;
constexpr double CURSE_RADIUS = 2 * 0.6, CURSE_HIT = 2, CURSE_DPS = 4, CURSE_TIME = 15, CURSE_CD = 18, CURSE_RANGE = 12 * 0.6;
constexpr double SPIN_RADIUS = 4 * 0.6, SPIN_DAMAGE = 100, SPIN_TIME = 5, SPIN_CD = 10;
constexpr double EGG_TIME = 50;
constexpr double CHAIN_RADIUS = 8 * 0.6;
constexpr int CHAIN_JUMPS = 3;
constexpr double AURA_TICK = 0.25, DOT_TICK = 0.5;
constexpr double PI_4 = 0.7853981633974483;
} // namespace

double GodPowers::ability_ready(int32_t unit) const {
	auto it = std::lower_bound(ability_cd.begin(), ability_cd.end(), std::make_pair(unit, -1e18));
	return it != ability_cd.end() && it->first == unit ? it->second : 0;
}

void GodPowers::set_ability_cd(int32_t unit, double at) {
	auto it = std::lower_bound(ability_cd.begin(), ability_cd.end(), std::make_pair(unit, -1e18));
	if (it != ability_cd.end() && it->first == unit) it->second = at;
	else ability_cd.insert(it, { unit, at });
}

void GodPowers::add_dot(int32_t target, int owner, double dps, double dur, uint8_t kind) {
	const double until = sim->time + dur;
	if (kind == DOT_BEAM_P || kind == DOT_BEAM_D) { // (each beam burns on its own: two Petsuchoi, two burns)
		dots.push_back({ target, owner, dps, until, 0, kind, sim->time });
		return;
	}
	for (Dot &d : dots)
		if (d.target == target && d.kind == kind && d.owner == owner) { // (a new hit restarts it)
			d.until = std::max(d.until, until);
			d.dps = std::max(d.dps, dps);
			return;
		}
	dots.push_back({ target, owner, dps, until, 0, kind, sim->time });
}

// the hack (or pierce) armor of a unit row as this sim reads it (techs included)
static double armor_of(const Sim &S, int r, bool pierce) {
	const UnitStore &U = S.entities.units;
	const int t = U.type[r], o = U.owner[r];
	const double base = pierce && is_egypt_unit(t) ? S.civs.base_pierce(r) : unit_def(t).armor;
	const double add = pierce ? S.techs.mods[o].pierce[t] : S.techs.mods[o].hack[t];
	return S.godpowers.armor_after(r, std::min(ARMOR_CAP, base + add));
}

static bool organic(int type) {
	const UnitDef &d = unit_def(type);
	return d.cls != CLS_SIEGE && type != U_PHOENIX_EGG;
}

void GodPowers::on_myth_damaged(const Event &e) {
	if (e.kind != K_UNIT || e.other <= 0) return;
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const int a = E.unit_slot(e.other);
	if (a < 0) return;
	const int at = U.type[a], owner = U.owner[a];
	if (!is_egypt_myth(at)) return;
	const int v = E.unit_slot(e.id);
	if (v < 0 || U.dead[v]) return;
	if (at == U_WADJET && organic(U.type[v])) add_dot(e.id, owner, VENOM_DPS * damage_mult(a), VENOM_TIME, DOT_VENOM); // (Eclipse: abilities too)
	if (at == U_PETSUCHOS) { // Illuminate (merged with a live reveal of his nearby, as Sun Ray)
		bool merged = false;
		for (Reveal &r : S.techs.reveals)
			if (r.owner == owner && r.r == ILLUMINATE_RADIUS && jsm::hypot(r.x - U.x[v], r.z - U.z[v]) < 3) {
				r.until = S.time + ILLUMINATE_TIME;
				r.x = U.x[v];
				r.z = U.z[v];
				merged = true;
			}
		if (!merged) S.techs.reveals.push_back({ owner, U.x[v], U.z[v], ILLUMINATE_RADIUS, S.time + ILLUMINATE_TIME });
		ability_fx.push_back({ 5, e.other, e.id, U.x[a], U.z[a], U.x[v], U.z[v], S.time, 0.6 });
		// the rest of the sun beam (Retold: 10 P + 30 P over 1 s + 2 D + 8 D over 1 s): the 10 P was
		// this hit; the attack upgrades / Eclipse (k) and the class multiplier (x2.5 vs myth, x0.5 vs
		// heroes) on every part, pierce through the target's pierce armor, divine through none
		const double k = S.techs.unit_damage(a) / BEAM_HIT;
		const UnitDef &vd = unit_def(U.type[v]);
		const double bonus = unit_def(at).bonus[vd.cls] != 0 ? unit_def(at).bonus[vd.cls] : 1;
		const double pv = 1 - armor_of(S, v, true);
		add_dot(e.id, owner, BEAM_P_DOT * k * bonus * pv / BEAM_DOT_TIME, BEAM_DOT_TIME, DOT_BEAM_P);
		add_dot(e.id, owner, BEAM_D_DOT * k * bonus / BEAM_DOT_TIME, BEAM_DOT_TIME, DOT_BEAM_D);
		S.combat.damage(e.id, BEAM_D * k * bonus, Hitter::pseudo(owner), DK_DIVINE);
		if (U.dead[v]) return;
	}
	if (at == U_SON_OF_OSIRIS) { // chain lightning: on to the 3 nearest other enemies near the target
		std::vector<std::pair<double, int>> c;
		const double x = U.x[v], z = U.z[v];
		S.movement.hash.for_each_near(x, z, CHAIN_RADIUS, [&](int r) {
			if (r >= U.size() || r == v || U.removed[r] || U.dead[r] || !S.is_enemy(owner, U.owner[r])) return;
			const double d = jsm::hypot(U.x[r] - x, U.z[r] - z);
			if (d <= CHAIN_RADIUS) c.push_back({ d + U.id[r] * 1e-9, r });
		});
		std::sort(c.begin(), c.end());
		double px = x, pz = z;
		const double base = S.techs.unit_damage(a);
		for (int k = 0; k < (int)c.size() && k < CHAIN_JUMPS; k++) {
			const int r = c[k].second;
			const double mult = unit_def(U.type[r]).cls == CLS_MYTH ? unit_def(U_SON_OF_OSIRIS).bonus[CLS_MYTH] : 1;
			const double nx = U.x[r], nz = U.z[r];
			arcs.push_back({ px, S.map().height_at(px, pz) + 1.2, pz, nx, S.map().height_at(nx, nz) + 1.2, nz, S.time,
				(uint32_t)(S.tick_count * 131 + U.id[r] * 7) });
			S.combat.damage(U.id[r], base * mult, Hitter::pseudo(owner), DK_DIVINE);
			if (owner > 0 && owner < MAX_PLAYERS) chained[owner]++;
			px = nx;
			pz = nz;
		}
		arcs.push_back({ U.x[a], S.map().height_at(U.x[a], U.z[a]) + 2.0, U.z[a], x, S.map().height_at(x, z) + 1.2, z, S.time,
			(uint32_t)(S.tick_count * 977 + e.id) });
	}
}

void GodPowers::on_myth_died(int32_t id, double x, double z) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const int r = E.unit_slot(id);
	if (r < 0) return;
	const int t = U.type[r], owner = U.owner[r];
	// a cursed unit rises as the Mummy's owner's Minion
	for (const Dot &d : dots) {
		if (d.target != id || d.kind != DOT_CURSE || d.until < S.time) continue;
		const UnitDef &ud = unit_def(t);
		if (ud.hero || ud.cls == CLS_SIEGE || t == U_MINION || t == U_PHOENIX_EGG) break;
		const int m = S.units.spawn(U_MINION, d.owner, x, z, U.rot[r]);
		if (m >= 0) {
			rises.push_back({ 1, x, z, S.time, d.owner, U.id[m] });
			if (d.owner > 0 && d.owner < MAX_PLAYERS) minions_raised[d.owner]++;
		}
		break;
	}
	if (t == U_SCARAB) { // Causticity
		std::vector<int32_t> hit;
		S.movement.hash.for_each_near(x, z, CAUSTIC_RADIUS + 1, [&](int o) {
			if (o < U.size() && o != r && !U.removed[o] && !U.dead[o] && S.is_enemy(owner, U.owner[o]) && jsm::hypot(U.x[o] - x, U.z[o] - z) <= CAUSTIC_RADIUS)
				hit.push_back(U.id[o]);
		});
		std::sort(hit.begin(), hit.end());
		for (int32_t h : hit) S.combat.damage(h, CAUSTIC_DAMAGE, Hitter::pseudo(owner), DK_DIVINE);
		rises.push_back({ 4, x, z, S.time, owner, id });
	}
	if (t == U_PHOENIX) { // Rebirth
		const int g = S.units.spawn(U_PHOENIX_EGG, owner, x, z, U.rot[r]);
		if (g >= 0) {
			eggs.push_back({ U.id[g], owner, S.time + EGG_TIME });
			uncontrolled.push_back(U.id[g]);
			rises.push_back({ 2, x, z, S.time, owner, U.id[g] });
		}
	}
}

void GodPowers::update_myth(double dt) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const double now = S.time;
	// which units have abilities: rescanned every 30 ticks (a Greek game pays one scan a second),
	// and at once when a new entity appears while none is known (the first myth unit trained or
	// summoned uses its ability the same tick: an Anubite 5 tiles from his foe still leaps)
	const bool fresh = !any_myth_ && E.next_id != myth_seen_id_;
	myth_seen_id_ = E.next_id;
	if (myth_scan_-- <= 0 || fresh) {
		myth_scan_ = 30;
		any_myth_ = false;
		for (int r = 0; r < U.size() && !any_myth_; r++)
			if (!U.removed[r] && !U.dead[r] && is_egypt_myth(U.type[r])) any_myth_ = true;
	}
	if (any_myth_) {
		for (int r = 0; r < U.size(); r++) {
			if (U.removed[r] || U.dead[r]) continue;
			const int t = U.type[r];
			if (t != U_ANUBITE && t != U_SPHINX && t != U_SCORPION_MAN && t != U_MUMMY && t != U_AVENGER) continue;
			if (U.order_type[r] != O_ATTACK) continue;
			const int32_t id = U.id[r];
			if (ability_ready(id) > now) continue;
			const int v = E.unit_slot(U.order_target[r]);
			if (v < 0 || U.dead[v] || E.kind(U.order_target[r]) != K_UNIT) continue;
			const int owner = U.owner[r];
			const double d = jsm::hypot(U.x[v] - U.x[r], U.z[v] - U.z[r]);
			const double reach = U.radius[r] + U.radius[v] + unit_def(t).attack.range + 0.3;
			const double cdk = eclipse.until > now && eclipse.owner == owner ? ECLIPSE_RECHARGE : 1;
			if (t == U_ANUBITE) {
				const double mx = JUMP_MAX + (S.techs.is_done(owner, T_FEET_OF_THE_JACKAL) ? JUMP_JACKAL : 0);
				if (d < JUMP_MIN || d > mx) continue;
				// leap to the foe's near side; the blow lands with him
				const double k = (d - U.radius[v] - U.radius[r] - 0.1) / d;
				double nx = U.x[r] + (U.x[v] - U.x[r]) * k, nz = U.z[r] + (U.z[v] - U.z[r]) * k;
				if (!S.map().walkable_at(nx, nz)) continue;
				ability_fx.push_back({ 0, id, U.id[v], U.x[r], U.z[r], nx, nz, now, JUMP_TIME });
				S.movement.stop(r);
				U.x[r] = nx;
				U.z[r] = nz;
				U.rot[r] = jsm::atan2(U.x[v] - nx, U.z[v] - nz);
				S.combat.damage(U.id[v], JUMP_DAMAGE * damage_mult(r) * (1 - armor_of(S, v, false)), Hitter::pseudo(owner), DK_DIVINE);
				set_ability_cd(id, now + JUMP_CD * cdk);
				continue;
			}
			if (t == U_MUMMY) {
				if (d > CURSE_RANGE + U.radius[v]) continue;
				const double cx = U.x[v], cz = U.z[v];
				std::vector<int32_t> hit;
				S.movement.hash.for_each_near(cx, cz, CURSE_RADIUS + 1, [&](int o) {
					if (o >= U.size() || U.removed[o] || U.dead[o] || !S.is_enemy(owner, U.owner[o])) return;
					const UnitDef &od = unit_def(U.type[o]);
					if (od.cls == CLS_SIEGE || od.cls == CLS_ANIMAL) return;
					if (jsm::hypot(U.x[o] - cx, U.z[o] - cz) <= CURSE_RADIUS + U.radius[o]) hit.push_back(U.id[o]);
				});
				std::sort(hit.begin(), hit.end());
				for (int32_t h : hit) {
					const int o = E.unit_slot(h);
					add_dot(h, owner, CURSE_DPS * damage_mult(r), CURSE_TIME, DOT_CURSE);
					S.combat.damage(h, CURSE_HIT * damage_mult(r) * (1 - armor_of(S, o, true)), Hitter::pseudo(owner), DK_DIVINE);
				}
				ability_fx.push_back({ 4, id, U.id[v], U.x[r], U.z[r], cx, cz, now, 1.2 });
				set_ability_cd(id, now + CURSE_CD * cdk);
				continue;
			}
			if (d > reach) continue; // (the melee abilities: in reach of his foe)
			if (t == U_SPHINX) {
				auras.push_back({ id, owner, WHIRL_RADIUS, WHIRL_DAMAGE / WHIRL_TIME, now + WHIRL_TIME, 0, 0 });
				ability_fx.push_back({ 1, id, 0, U.x[r], U.z[r], U.x[r], U.z[r], now, WHIRL_TIME });
				set_ability_cd(id, now + WHIRL_CD * cdk);
			} else if (t == U_AVENGER) {
				auras.push_back({ id, owner, SPIN_RADIUS, SPIN_DAMAGE / SPIN_TIME, now + SPIN_TIME, 0, 1 });
				ability_fx.push_back({ 2, id, 0, U.x[r], U.z[r], U.x[r], U.z[r], now, SPIN_TIME });
				set_ability_cd(id, now + SPIN_CD * cdk);
			} else if (t == U_SCORPION_MAN) {
				stings.push_back({ id, owner, now, STINGS });
				ability_fx.push_back({ 3, id, U.id[v], U.x[r], U.z[r], U.x[v], U.z[v], now, STING_GAP * STINGS });
				set_ability_cd(id, now + STING_CD * cdk);
			}
		}
	}
	// whirlwinds and spins: their damage every 0.25 s to the enemies round the unit
	for (Aura &a : auras) {
		const int r = E.unit_slot(a.unit);
		if (r < 0 || U.dead[r]) { a.until = -1; continue; }
		a.acc += dt;
		if (a.acc + 1e-9 < AURA_TICK && now < a.until) continue;
		const double step = std::min(a.acc, std::max(0.0, a.until - (now - a.acc)));
		a.acc = 0;
		std::vector<int32_t> hit;
		const double x = U.x[r], z = U.z[r];
		S.movement.hash.for_each_near(x, z, a.radius + 1.5, [&](int o) {
			if (o >= U.size() || U.removed[o] || U.dead[o] || !S.is_enemy(a.owner, U.owner[o])) return;
			if (jsm::hypot(U.x[o] - x, U.z[o] - z) <= a.radius + U.radius[o] + U.radius[r]) hit.push_back(U.id[o]);
		});
		std::sort(hit.begin(), hit.end());
		for (int32_t h : hit) {
			const int o = E.unit_slot(h);
			S.combat.damage(h, a.dps * step * damage_mult(r) * (1 - armor_of(S, o, false)), Hitter::pseudo(a.owner), DK_DIVINE);
		}
	}
	auras.erase(std::remove_if(auras.begin(), auras.end(), [&](const Aura &a) { return a.until <= now; }), auras.end());
	// stings: 3 at 0.5 s, each on the 3 nearest enemies round the Scorpion Man
	for (Sting &s : stings) {
		const int r = E.unit_slot(s.unit);
		if (r < 0 || U.dead[r]) { s.left = 0; continue; }
		if (now < s.at) continue;
		s.at += STING_GAP;
		s.left--;
		std::vector<std::pair<double, int32_t>> c;
		const double x = U.x[r], z = U.z[r];
		S.movement.hash.for_each_near(x, z, STING_RADIUS + 2, [&](int o) {
			if (o >= U.size() || U.removed[o] || U.dead[o] || !S.is_enemy(s.owner, U.owner[o])) return;
			const double d = jsm::hypot(U.x[o] - x, U.z[o] - z) - U.radius[o] - U.radius[r];
			if (d <= STING_RADIUS) c.push_back({ d + U.id[o] * 1e-9, U.id[o] });
		});
		std::sort(c.begin(), c.end());
		for (int k = 0; k < (int)c.size() && k < STING_TARGETS; k++) {
			S.combat.damage(c[k].second, STING_DAMAGE * damage_mult(r), Hitter::pseudo(s.owner), DK_DIVINE);
			add_dot(c[k].second, s.owner, STING_DOT * damage_mult(r), STING_DOT_TIME, DOT_STING);
		}
	}
	stings.erase(std::remove_if(stings.begin(), stings.end(), [](const Sting &s) { return s.left <= 0; }), stings.end());
	// damage over time: applied every 0.5 s (and as it ends)
	for (Dot &d : dots) {
		const int r = E.unit_slot(d.target);
		if (r < 0 || U.dead[r]) { d.until = -1; continue; }
		const double live = std::max(0.0, std::min(now, d.until) - std::max(now - dt, d.from)); // (exactly until - from in all)
		d.acc += live;
		if (d.acc + 1e-9 >= DOT_TICK || (now >= d.until && d.acc > 0)) {
			const double amount = d.dps * d.acc;
			d.acc = 0;
			S.combat.damage(d.target, amount, Hitter::pseudo(d.owner), DK_DIVINE);
		}
	}
	dots.erase(std::remove_if(dots.begin(), dots.end(), [&](const Dot &d) { return d.until < now && d.acc <= 0; }), dots.end());
	// (the Son of Osiris heals allies at 15 hp/s through the civ heal loop, sim/civ EgyptUnit.heal;
	// he cannot be healed and has no regeneration of his own: EGYPT.md 3.1)
	update_rocs(dt);
	// Phoenix Eggs hatch
	for (Egg &g : eggs) {
		const int r = E.unit_slot(g.egg);
		if (r < 0 || U.dead[r]) { g.hatch_at = -1; continue; }
		if (now < g.hatch_at) continue;
		const double x = U.x[r], z = U.z[r], rot = U.rot[r];
		E.remove(g.egg);
		const int p = S.units.spawn(U_PHOENIX, g.owner, x, z, rot);
		if (p >= 0) {
			rises.push_back({ 3, x, z, now, g.owner, U.id[p] });
			if (g.owner > 0 && g.owner < MAX_PLAYERS) eggs_hatched[g.owner]++;
		}
		g.hatch_at = -1;
	}
	eggs.erase(std::remove_if(eggs.begin(), eggs.end(), [](const Egg &g) { return g.hatch_at < 0; }), eggs.end());
	ability_fx.erase(std::remove_if(ability_fx.begin(), ability_fx.end(), [&](const AbilityFx &f) { return now - f.t0 > f.dur + 0.5; }), ability_fx.end());
	if (ability_cd.size() > 256)
		ability_cd.erase(std::remove_if(ability_cd.begin(), ability_cd.end(), [&](const std::pair<int32_t, double> &p) {
			const int r = E.unit_slot(p.first);
			return r < 0 || U.dead[r] || p.second < now;
		}), ability_cd.end());
}

// ---- the Roc: a flying transport for 20 units (Retold). Boarding units walk to it; it lands
// (ROC_LAND s, still) and takes those in reach. A carried unit leaves the world (its row is
// removed, its pop still counts: Economy::recount); unloading lands the Roc where told and
// sets them down round it as new units of their type with the same share of their hp. A Roc
// that falls takes its riders with it.
const RocState *GodPowers::roc_state(int32_t roc) const {
	for (const RocState &s : rocs)
		if (s.roc == roc) return &s;
	return nullptr;
}

static bool roc_carries(int type) {
	const UnitDef &d = unit_def(type);
	return type != U_ROC && type != U_PHOENIX && type != U_PHOENIX_EGG && type != U_SERPENT && d.cls != CLS_SIEGE;
}

int GodPowers::roc_load(int32_t roc, const std::vector<int32_t> &units) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const int r = E.unit_slot(roc);
	if (!S.godot_rules || r < 0 || U.dead[r] || U.type[r] != U_ROC) return 0;
	RocState *st = nullptr;
	for (RocState &s : rocs)
		if (s.roc == roc) st = &s;
	if (!st) {
		rocs.push_back({ roc, {}, {}, 0, 0, 0, 0, 0 });
		st = &rocs.back();
	}
	int n = 0;
	for (int32_t id : units) {
		const int u = E.unit_slot(id);
		if (u < 0 || U.dead[u] || U.owner[u] != U.owner[r] || !roc_carries(U.type[u]) || is_uncontrolled(id)) continue;
		if ((int)(st->cargo.size() + st->boarding.size()) >= ROC_SLOTS) break;
		if (std::find(st->boarding.begin(), st->boarding.end(), id) != st->boarding.end()) continue;
		st->boarding.push_back(id);
		S.commands.order(u, Order::move(U.x[r], U.z[r]));
		n++;
	}
	if (n > 0) {
		S.commands.idle(r); // it lands where it is
		st->mode = 1;
		st->land_until = S.time + ROC_LAND;
	}
	return n;
}

bool GodPowers::roc_unload(int32_t roc, double x, double z) {
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const int r = E.unit_slot(roc);
	if (!S.godot_rules || r < 0 || U.dead[r] || U.type[r] != U_ROC) return false;
	for (RocState &s : rocs) {
		if (s.roc != roc || s.cargo.empty()) continue;
		s.boarding.clear();
		s.mode = 2;
		if (std::isnan(x) || std::isnan(z)) { x = U.x[r]; z = U.z[r]; }
		S.map().clamp_to_map(x, z);
		s.ux = x;
		s.uz = z;
		s.land_until = 0;
		if (jsm::hypot(U.x[r] - x, U.z[r] - z) > 1) S.commands.order(r, Order::move(x, z));
		else S.commands.idle(r);
		return true;
	}
	return false;
}

void GodPowers::update_rocs(double dt) {
	if (rocs.empty()) return;
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	const double now = S.time;
	for (RocState &s : rocs) {
		const int r = E.unit_slot(s.roc);
		if (r < 0 || U.dead[r]) { // it fell: its riders with it
			s.cargo.clear();
			s.boarding.clear();
			s.roc = 0;
			continue;
		}
		s.boarding.erase(std::remove_if(s.boarding.begin(), s.boarding.end(), [&](int32_t id) {
			const int u = E.unit_slot(id);
			return u < 0 || U.dead[u];
		}), s.boarding.end());
		const double rx = U.x[r], rz = U.z[r];
		// it comes down while loading, or once at its unloading point; up again otherwise
		const bool down = !U.moving[r] && (s.mode == 1 || (s.mode == 2 && s.land_until > 0));
		s.land_k = std::max(0.0, std::min(1.0, s.land_k + (down ? dt : -dt) / ROC_LAND));
		{
			const double f = s.land_k * s.land_k * (3 - 2 * s.land_k);
			U.air_y[r] = -ROC_DROP * f; // (the renderer lowers it from its hover)
		}
		if (s.mode == 1) {
			if (U.moving[r]) { s.land_until = now + ROC_LAND; } // (moved off: lands again)
			for (size_t i = 0; i < s.boarding.size();) {
				const int u = E.unit_slot(s.boarding[i]);
				const double d = jsm::hypot(U.x[u] - rx, U.z[u] - rz);
				if (s.land_k >= 1 && d <= ROC_REACH + U.radius[u] + U.radius[r]) {
					s.cargo.push_back({ U.type[u], U.owner[u], U.max_hp[u] > 0 ? U.hp[u] / U.max_hp[u] : 1 });
					E.remove(s.boarding[i]);
					s.boarding.erase(s.boarding.begin() + (long)i);
					continue;
				}
				if (!U.moving[u] && S.tick_count % 10 == 0 && d > ROC_REACH) S.commands.order(u, Order::move(rx, rz));
				i++;
			}
			if (s.boarding.empty()) s.mode = 0;
		} else if (s.mode == 2) {
			if (U.moving[r]) continue;
			if (s.land_until == 0) s.land_until = now + ROC_LAND; // arrived (or stopped): land
			if (s.land_k < 1) continue;
			// set them down in rings round the Roc
			int k = 0;
			for (const Cargo &c : s.cargo) {
				double px = rx, pz = rz;
				for (int tries = 0; tries < 12; tries++, k++) {
					const double ring = 1.2 + 0.9 * std::floor(k / 8.0), a = (k % 8) * (PI_4) + std::floor(k / 8.0) * 0.4;
					px = rx + jsm::cos(a) * ring;
					pz = rz + jsm::sin(a) * ring;
					S.map().clamp_to_map(px, pz);
					if (S.map().walkable_at(px, pz)) break;
				}
				k++;
				const int u = S.units.spawn(c.type, c.owner, px, pz, U.rot[r]);
				if (u >= 0) U.hp[u] = std::max(1.0, U.max_hp[u] * c.hp_frac);
			}
			s.cargo.clear();
			s.mode = 0;
		}
	}
	rocs.erase(std::remove_if(rocs.begin(), rocs.end(), [&](const RocState &s) {
		const bool done = s.roc == 0 || (s.cargo.empty() && s.boarding.empty() && s.mode == 0 && s.land_k <= 0);
		if (done && s.roc != 0) {
			const int r = E.unit_slot(s.roc);
			if (r >= 0) U.air_y[r] = 0;
		}
		return done;
	}), rocs.end());
}

} // namespace aov
