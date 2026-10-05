// Port of src/combat/index.js and Projectiles.js (see combat.h).
#include "combat.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static const double PI = 3.141592653589793;
static const double WALLED_REPATH = 2;          // Godot-only (fortify): s between searches of a man walled off from his target (a unit)
static const double WALLED_REPATH_BUILDING = 4; // ... from a building (it does not move: only a wall falling changes the answer)

void Combat::init(Sim *s) {
	sim = s;
	projectiles.clear();
	stuck.clear();
	scars.clear();
	drops.clear();
	ais.clear();
	ais.emplace_back(s, ENEMY);
	scan_timer = 0;
	attackers_.clear();
	touched_.clear();
	s->commands.register_handler(O_ATTACK, [this](int r, const Order &o) { return start_attack(r, o); });
	s->commands.register_handler(O_ATTACK_MOVE, [this](int r, const Order &o) { return start_attack_move(r, o); });
}

EnemyAI &Combat::add_ai(int owner) {
	ais.emplace_back(sim, owner);
	return ais.back();
}

bool Combat::start_attack(int r, const Order &o) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const int s = E.slot(o.target);
	const Kind k = E.kind(o.target);
	if (s < 0 || (k != K_UNIT && k != K_BUILDING)) return false;
	const bool dead = k == K_UNIT ? U.dead[s] : E.buildings.dead[s];
	const int owner = k == K_UNIT ? U.owner[s] : E.buildings.owner[s];
	if (dead || !unit_def(U.type[r]).has_attack || !sim->is_enemy(U.owner[r], owner)) return false;
	U.order_x[r] = 0; // o.repath
	approach(r, o.target);
	return true;
}

// ---- Godot-only: attack-move, fight back while moving (see combat.h) ------

bool Combat::start_attack_move(int r, const Order &o) {
	const UnitDef &d = unit_def(sim->entities.units.type[r]);
	if (!d.has_attack || d.gatherer) sim->commands.set(r, Order::move(o.x, o.z)); // villagers just walk there
	sim->movement.move_to(r, o.x, o.z);
	return true;
}

int Combat::am_rank(int32_t id) const {
	const Entities &E = sim->entities;
	const int s = E.slot(id);
	if (s < 0) return 3;
	if (E.kind(id) == K_UNIT) return unit_def(E.units.type[s]).gatherer ? 1 : 0;
	return E.kind(id) == K_BUILDING ? 2 : 3;
}

int32_t Combat::am_pick(int r, int *rank_out) {
	CallTimer tm(&sim->prof, "amPick");
	const Entities &E = sim->entities;
	const UnitStore &U = E.units;
	const double x = U.x[r], z = U.z[r], R = U.sight[r], R2 = R * R;
	const int owner = U.owner[r];
	int best = -1, brank = 3;
	double bd = INFINITY;
	sim->movement.hash.count_query(x, z, R);
	sim->movement.hash.for_each_near(x, z, R, [&](int o) {
		if (U.dead[o] || U.gp_state[o] == 1 || !sim->is_enemy(owner, U.owner[o])) return;
		const double dx = U.x[o] - x, dz = U.z[o] - z, d = dx * dx + dz * dz;
		if (d > R2) return;
		const int rank = unit_def(U.type[o]).gatherer ? 1 : 0;
		if (rank < brank || (rank == brank && d < bd)) {
			brank = rank;
			bd = d;
			best = o;
		}
	});
	if (best >= 0) {
		if (rank_out) *rank_out = brank;
		return U.id[best];
	}
	const BuildingStore &B = E.buildings;
	int bb = -1;
	bd = INFINITY;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !sim->is_enemy(owner, B.owner[b])) continue;
		if (is_wall_piece(B.type[b])) continue; // (walls are only attacked when they block the way: fortify breach rule)
		if (std::abs(B.x[b] - x) > R + B.w[b] || std::abs(B.z[b] - z) > R + B.h[b]) continue;
		const double ex = std::max(std::max(B.tx[b] - x, 0.0), x - (B.tx[b] + B.w[b]));
		const double ez = std::max(std::max(B.tz[b] - z, 0.0), z - (B.tz[b] + B.h[b]));
		const double d = ex * ex + ez * ez;
		if (d <= R2 && d < bd) {
			bd = d;
			bb = b;
		}
	}
	if (rank_out) *rank_out = bb >= 0 ? 2 : 3;
	return bb >= 0 ? B.id[bb] : 0;
}

void Combat::engage(int r, int32_t tid, uint8_t resume) {
	UnitStore &U = sim->entities.units;
	const double x = U.order_x[r], z = U.order_z[r];
	const int32_t flags = U.order_b[r];
	Order o = Order::with_target(O_ATTACK, tid);
	o.b = resume == AMR_MOVE ? ATK_AUTO : 0;
	if (!sim->commands.order(r, o)) { // (should not happen: the callers checked the target) walk on
		Order back = Order::move(x, z);
		if (resume == AMR_ATTACK_MOVE) {
			back.type = O_ATTACK_MOVE;
			back.b = flags;
		}
		sim->commands.order(r, back);
		return;
	}
	U.am_resume[r] = resume;
	U.am_x[r] = x;
	U.am_z[r] = z;
	U.am_flags[r] = flags;
	U.am_lost[r] = 0;
}

void Combat::resume(int r) {
	UnitStore &U = sim->entities.units;
	if (U.am_resume[r] == AMR_ATTACK_MOVE) {
		const int32_t e = am_pick(r);
		if (e) { // the next foe in sight
			U.order_target[r] = e;
			U.order_a[r] = 0;
			U.order_x[r] = 0;
			U.am_lost[r] = 0;
			approach(r, e);
			return;
		}
		Order o = Order::move(U.am_x[r], U.am_z[r]);
		o.type = O_ATTACK_MOVE;
		o.b = U.am_flags[r];
		sim->commands.order(r, o);
		return;
	}
	// the fight goes on while an enemy close by (not behind, on the way to
	// the destination) is fighting: the attacker's comrades
	const double wx = U.am_x[r] - U.x[r], wz = U.am_z[r] - U.z[r];
	const int e = find_enemy_near(U.x[r], U.z[r], U.owner[r], NEXT_FOE_RADIUS, [&](int o) {
		if (U.order_type[o] != O_ATTACK) return false;
		return ahead(wx, wz, U.x[o] - U.x[r], U.z[o] - U.z[r]);
	});
	if (e >= 0) {
		U.order_target[r] = U.id[e];
		U.order_a[r] = 0;
		U.order_x[r] = 0;
		U.am_lost[r] = 0;
		approach(r, U.id[e]);
		return;
	}
	sim->commands.order(r, Order::move(U.am_x[r], U.am_z[r]));
}

void Combat::update_attack_move(int r) {
	UnitStore &U = sim->entities.units;
	const bool arrived = !U.moving[r];
	if (!arrived && (sim->tick_count + U.id[r]) % AM_SCAN_TICKS != 0) return;
	const int32_t e = am_pick(r);
	if (e) {
		engage(r, e, AMR_ATTACK_MOVE);
		return;
	}
	if (!arrived) return;
	if (U.order_b[r] & AM_THEN_BUILDINGS) {
		const int b = find_enemy_building_near(U.x[r], U.z[r], U.owner[r], 200);
		if (b >= 0) {
			Order o = Order::with_target(O_ATTACK, sim->entities.buildings.id[b]);
			o.b = ATK_THEN_BUILDINGS;
			sim->commands.order(r, o);
			return;
		}
	}
	sim->commands.idle(r);
}

// The men marching next to a unit that turns to fight back turn with it
// (same owner, on a plain move, the attacker ahead of or beside them too and
// in their sight): one hash query per retaliation, nothing per tick.
void Combat::rally_to(int r, int32_t attacker_id, double ax, double az) {
	UnitStore &U = sim->entities.units;
	const int owner = U.owner[r];
	rally_.clear();
	sim->movement.hash.count_query(U.x[r], U.z[r], RALLY_RADIUS);
	sim->movement.hash.for_each_near(U.x[r], U.z[r], RALLY_RADIUS, [&](int o) {
		if (o == r || U.dead[o] || U.owner[o] != owner || U.order_type[o] != O_MOVE) return;
		const UnitDef &d = unit_def(U.type[o]);
		if (d.gatherer || !d.has_attack || U.combat_leash[o] != 0) return;
		const double dx = U.x[o] - U.x[r], dz = U.z[o] - U.z[r];
		if (dx * dx + dz * dz > RALLY_RADIUS * RALLY_RADIUS) return;
		if (jsm::hypot(ax - U.x[o], az - U.z[o]) <= U.sight[o] && hit_ahead(o, ax, az)) rally_.push_back(o);
	});
	for (int o : rally_) engage(o, attacker_id, AMR_MOVE);
}

// Is the point (ax, az) ahead of or beside unit r's direction of travel?
bool Combat::hit_ahead(int r, double ax, double az) const {
	const UnitStore &U = sim->entities.units;
	double wx = U.goal_x[r], wz = U.goal_z[r];
	if (U.path[r] >= 0) {
		const auto &path = sim->paths.at(U.path[r]);
		if (U.path_idx[r] >= 0 && U.path_idx[r] < (int)path.size()) {
			wx = path[U.path_idx[r]].x;
			wz = path[U.path_idx[r]].z;
		}
	}
	return ahead(wx - U.x[r], wz - U.z[r], ax - U.x[r], az - U.z[r]);
}

// dot(normalised move direction m, normalised direction t) > RETALIATE_DOT
bool Combat::ahead(double mx, double mz, double tx, double tz) {
	const double lm = std::sqrt(mx * mx + mz * mz), lt = std::sqrt(tx * tx + tz * tz);
	if (lm < 1e-6 || lt < 1e-6) return true;
	return (mx * tx + mz * tz) / (lm * lt) > RETALIATE_DOT;
}

void Combat::add_attacker(int32_t id) {
	if (id <= 0) return;
	if (id >= (int32_t)attackers_.size()) attackers_.resize((size_t)id + 1024, 0);
	if (attackers_[id]++ == 0) touched_.push_back(id);
}

void Combat::clear_attackers() {
	for (int32_t id : touched_) attackers_[id] = 0;
	touched_.clear();
}

// combat_reach: extra reach for spearmen holding a line (BattleScene)
double Combat::range_of(int r) const {
	const UnitStore &U = sim->entities.units;
	const UnitDef &d = unit_def(U.type[r]);
	const double base = (d.has_attack ? d.attack.range : 0.5) + U.combat_reach[r];
	return sim->godot_rules ? base + sim->techs.range_add(r) : base; // (Godot-only: Sarissa, Sylvan Lore, Face of the Gorgon)
}

void Combat::approach(int r, int32_t tid) {
	Entities &E = sim->entities;
	const int s = E.slot(tid);
	if (s < 0) return;
	const double range = range_of(r);
	if (E.kind(tid) == K_BUILDING) {
		const BuildingStore &B = E.buildings;
		GoalRect g{ (double)B.tx[s], (double)B.tz[s], (double)B.w[s], (double)B.h[s] };
		sim->movement.move_to(r, B.x[s], B.z[s], &g, range);
	} else if (E.kind(tid) == K_UNIT) {
		const UnitStore &U = E.units;
		sim->movement.move_to(r, U.x[s], U.z[s], nullptr, range + U.radius[r] + U.radius[s] * 0.8);
	}
}

int Combat::find_enemy_near(double x, double z, int owner, double radius, const std::function<bool(int)> &pred) {
	CallTimer tm(&sim->prof, "findEnemyNear");
	const UnitStore &U = sim->entities.units;
	int best = -1;
	double bd = radius * radius;
	sim->movement.hash.count_query(x, z, radius);
	sim->movement.hash.for_each_near(x, z, radius, [&](int o) {
		if (U.dead[o] || !sim->is_enemy(owner, U.owner[o])) return;
		if (pred && !pred(o)) return;
		const double dx = U.x[o] - x, dz = U.z[o] - z;
		const double d = dx * dx + dz * dz;
		if (d < bd) {
			bd = d;
			best = o;
		}
	});
	return best;
}

// Target choice that spreads attackers across the enemy line instead of
// piling onto the nearest unit: distance, plus a crowding penalty, minus a
// preference for classes this unit has a bonus against.
int Combat::pick_target(int r, double radius) {
	CallTimer tm(&sim->prof, "pickTarget");
	const UnitStore &U = sim->entities.units;
	const UnitDef &ud = unit_def(U.type[r]);
	const bool melee = !ud.attack.projectile;
	const double ux = U.x[r], uz = U.z[r];
	const int owner = U.owner[r];
	int best = -1;
	double bs = INFINITY;
	sim->movement.hash.count_query(ux, uz, radius);
	sim->movement.hash.for_each_near(ux, uz, radius, [&](int o) {
		if (U.dead[o] || !sim->is_enemy(owner, U.owner[o])) return;
		const double d = jsm::hypot(U.x[o] - ux, U.z[o] - uz);
		if (d > radius) return;
		const UnitDef &od = unit_def(U.type[o]);
		const int n = attackers_of(U.id[o]);
		const int cap = od.myth ? 4 : od.cls == CLS_CAVALRY ? 3 : 2;
		double s = d + (melee ? 1.8 * std::max(0, n + 1 - cap) + 0.35 * n : 0.25 * n);
		if (ud.bonus[od.cls] != 0) s -= melee ? 2.5 : 1.0;
		if (od.gatherer) s += 3;
		if (s < bs) {
			bs = s;
			best = o;
		}
	});
	if (best >= 0) add_attacker(U.id[best]);
	return best;
}

int Combat::find_enemy_building_near(double x, double z, int owner, double radius) const {
	const BuildingStore &B = sim->entities.buildings;
	int best = -1;
	double bd = radius * radius;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || !sim->is_enemy(owner, B.owner[b])) continue;
		if (is_wall_piece(B.type[b])) continue; // (Godot-only pieces: not a wave's target)
		const double dx = B.x[b] - x, dz = B.z[b] - z;
		const double d = dx * dx + dz * dz;
		if (d < bd) {
			bd = d;
			best = b;
		}
	}
	return best;
}

Hitter Combat::hitter_of(int32_t id) const {
	const Entities &E = sim->entities;
	const int s = E.slot(id);
	Hitter h;
	if (s < 0) return h;
	h.id = id;
	h.kind = E.kind(id);
	h.row = s;
	h.owner = h.kind == K_UNIT ? E.units.owner[s] : h.kind == K_BUILDING ? E.buildings.owner[s] : GAIA;
	return h;
}

void Combat::damage(int32_t tid, double amount, const Hitter &a, uint8_t kind) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	const int t = E.slot(tid);
	const Kind tk = E.kind(tid);
	if (t < 0 || (tk != K_UNIT && tk != K_BUILDING)) return;
	if (tk == K_UNIT ? U.dead[t] : B.dead[t]) return;
	const UnitDef *ad = a.kind == K_UNIT ? &unit_def(U.type[a.row]) : nullptr;
	const UnitDef *td = tk == K_UNIT ? &unit_def(U.type[t]) : nullptr;
	double dmg = amount;
	if (ad && td && ad->bonus[td->cls] != 0) dmg *= ad->bonus[td->cls];
	if (sim->godot_rules && ad) dmg *= sim->techs.vs_mult(a.row, tk, t); // (Godot-only: Burning Pitch, Olympian Weapons)
	bool siege = false; // (Godot-only, sim/civ: Egyptian siege's crush vs a building)
	if (tk == K_BUILDING) {
		const EgyptUnit *eu = sim->godot_rules && ad ? egypt_unit(U.type[a.row]) : nullptr;
		if (eu && eu->crush_vs_building > 0) {
			// the crush part of the attack (with the attack upgrades' factor), less the building's crush armor
			const CivArmor ar = civ_building_armor(B.type[t]);
			siege = true;
			dmg = eu->crush_vs_building * (amount / ad->attack.damage) * (1 - (ar.retold ? ar.crush : SIEGE_CRUSH_ARMOR));
		} else if (sim->godot_rules && rules_armored(B.type[t])) dmg *= sim->techs.building_armor_mult(a, kind, B.type[t]); // (Godot-only: Retold's Armory / Market / Temple armor, sim/techs; the Egyptian buildings', sim/civ)
		else dmg *= (ad && ad->cls == CLS_MYTH) || a.myth_class ? 1.2 : 0.35;
		if (eu && eu->vs_buildings > 0) dmg *= eu->vs_buildings; // (War Elephant x4)
		if (eu && U.type[a.row] == U_LABORER && B.type[t] == B_TOWER) dmg *= LABORER_VS_TOWER; // (sim/civ: Retold's Laborer x4 vs towers)
	}
	if (sim->godot_rules) {
		// Godot-only: a building's arrows (Town Center, towers) never hurt a
		// friend, whatever happened in flight; walls / towers have their own armor
		const int towner = tk == K_UNIT ? U.owner[t] : B.owner[t];
		if (a.kind == K_BUILDING && !sim->is_enemy(a.owner, towner)) return;
		if (tk == K_BUILDING && is_fort_type(B.type[t]) && !siege) dmg *= sim->fortify.armor_mult(t, a, kind);
	}
	if (sim->godot_rules) {
		// Godot-only (sim/techs): hack / pierce armor from the Armory, then
		// divine damage, which no armor reduces (Phobos' Spear of Panic)
		dmg *= 1 - (td ? sim->techs.unit_armor(t, a, kind) : 0);
		if (ad) {
			const double dv = sim->techs.divine(a.row);
			if (dv != 0) dmg += dv * (tk == K_BUILDING ? 0.35 : 1);
		}
	} else
		dmg *= 1 - (td ? td->armor : 0);
	const double time = sim->time;
	if (tk == K_UNIT) {
		U.hp[t] -= dmg;
		// a white hit flash long enough to read at RTS distance (units piece fades it)
		U.flash_t[t] = td->myth ? 0.14 : kind == DK_ARROW || (ad && ad->attack.projectile) ? 0.12 : 0.22;
		U.hit_time[t] = time;
		// melee blows shove the man struck back a step and make him reel
		const bool has_pos = a.kind == K_UNIT || a.kind == K_BUILDING;
		const bool a_proj = a.kind == K_BUILDING || (ad && ad->attack.projectile); // (Town Center: an 'arrow' attack)
		if (has_pos && kind != DK_ARROW && !td->myth && !a_proj) {
			const double ax = U.x[a.row], az = U.z[a.row];
			const double dx = U.x[t] - ax, dz = U.z[t] - az;
			double d = jsm::hypot(dx, dz);
			if (d == 0 || std::isnan(d)) d = 1;
			const double push = (ad->myth ? 0.45 : 0.05 + 0.12 * sim->rng.next()) * (td->cls == CLS_CAVALRY ? 0.4 : 1);
			const double nx = U.x[t] + (dx / d) * push, nz = U.z[t] + (dz / d) * push;
			if (sim->map().walkable_at(nx, nz)) {
				U.x[t] = nx;
				U.z[t] = nz;
			}
			U.stag_t[t] = time;
			U.stag_k[t] = ad->myth ? 1.5 : 0.6 + 0.5 * sim->rng.next();
		}
		// BattleFX.hit: the melee contact time (battle scene capture beat, hit pop)
		const bool melee = kind == DK_MELEE || (kind == DK_DEFAULT && ad && !ad->attack.projectile);
		if (melee) U.melee_t[t] = time;
		if (sim->godot_rules && kind == DK_ARROW) sim->techs.on_arrow_hit(a, t); // (Godot-only: Shafts of Plague, Sun Ray)
	} else {
		B.hp[t] -= dmg;
		B.hit_time[t] = time;
	}
	Event ev;
	ev.type = EV_UNIT_DAMAGED;
	ev.kind = tk;
	ev.id = tid;
	ev.other = a.id;
	ev.owner = a.owner;
	ev.amount = dmg;
	ev.x = tk == K_UNIT ? U.x[t] : B.x[t];
	ev.z = tk == K_UNIT ? U.z[t] : B.z[t];
	sim->events.emit(ev);
	// retaliate
	if (tk == K_UNIT && a.id && td->has_attack) {
		const bool a_dead = a.kind == K_UNIT ? U.dead[a.row] : B.dead[a.row];
		if (!a_dead) {
			const double ax = a.kind == K_UNIT ? U.x[a.row] : B.x[a.row], az = a.kind == K_UNIT ? U.z[a.row] : B.z[a.row];
			const int ot = U.order_type[t];
			const Player *tp = sim->player(U.owner[t]);
			const bool ai = tp && tp->is_ai;
			const bool leashed = U.combat_leash[t] != 0 && jsm::hypot(ax - U.x[t], az - U.z[t]) > U.combat_leash[t] + 1;
			Order o = Order::with_target(O_ATTACK, a.id);
			o.b = ATK_AUTO;
			const bool godot = sim->godot_rules;
			if (leashed) { /* holding the line: ignore distant attackers */ }
			else if (ot == O_IDLE) sim->commands.order(t, o);
			else if (ot == O_ATTACK_MOVE) {
				if (a.kind == K_UNIT) engage(t, a.id, AMR_ATTACK_MOVE);
			} else if (godot && ot == O_MOVE && !td->gatherer) {
				// Godot-only: fight back unless hit from behind (a retreat), then walk on
				if (a.kind == K_UNIT && jsm::hypot(ax - U.x[t], az - U.z[t]) <= U.sight[t] && hit_ahead(t, ax, az)) {
					engage(t, a.id, AMR_MOVE);
					rally_to(t, a.id, ax, az);
				}
			} else if (ot == O_MOVE && ai) sim->commands.order(t, o);
			else if (td->gatherer && ot != O_ATTACK && ai && sim->rng.chance(0.3)) sim->commands.order(t, o);
		}
	}
	if ((tk == K_UNIT ? U.hp[t] : B.hp[t]) <= 0) kill(tid, a);
}

void Combat::kill(int32_t id, const Hitter &killer) {
	Entities &E = sim->entities;
	const int s = E.slot(id);
	const Kind k = E.kind(id);
	if (s < 0) return;
	Event ev;
	ev.type = EV_ENTITY_DIED;
	ev.kind = k;
	ev.id = id;
	ev.other = killer.id;
	if (k == K_UNIT) {
		UnitStore &U = E.units;
		if (U.dead[s]) return;
		U.hp[s] = 0;
		U.dead[s] = 1;
		U.died_at[s] = sim->time;
		sim->commands.set(s, Order::idle()); // (direct: no cancel handler, as the JS)
		sim->movement.stop(s);
		U.anim_die_t[s] = 0;
		U.carry_type[s] = RES_NONE;
		U.carry_amount[s] = 0;
		ev.owner = U.owner[s];
		ev.x = U.x[s];
		ev.z = U.z[s];
	} else if (k == K_BUILDING) {
		BuildingStore &B = E.buildings;
		if (B.dead[s]) return;
		B.hp[s] = 0;
		B.dead[s] = 1;
		ev.owner = B.owner[s];
		ev.x = B.x[s];
		ev.z = B.z[s];
		sim->buildings.destroy(id);
	} else
		return;
	sim->events.emit(ev);
}

void Combat::fire(int32_t attacker_id, int32_t target_id, double dmg, double from_y) {
	const Entities &E = sim->entities;
	const int as = E.slot(attacker_id), ts = E.slot(target_id);
	if (as < 0 || ts < 0) return;
	const bool ab = E.kind(attacker_id) == K_BUILDING, tb = E.kind(target_id) == K_BUILDING;
	Projectile p;
	p.sx = ab ? E.buildings.x[as] : E.units.x[as];
	p.sz = ab ? E.buildings.z[as] : E.units.z[as];
	p.sy = sim->map().height_at(p.sx, p.sz) + from_y;
	const double tx = tb ? E.buildings.x[ts] : E.units.x[ts], tz = tb ? E.buildings.z[ts] : E.units.z[ts];
	p.dist = jsm::hypot(tx - p.sx, tz - p.sz);
	p.x = p.px = p.sx;
	p.y = p.py = p.sy;
	p.z = p.pz = p.sz;
	p.target = target_id;
	p.attacker = attacker_id;
	p.owner = ab ? E.buildings.owner[as] : E.units.owner[as];
	p.damage = dmg;
	p.t = 0;
	p.dur = 0.4 + p.dist * 0.065;
	p.arc = 0.6 + p.dist * 0.16;
	if (sim->godot_rules) {
		// Godot-only (sim/techs): building arrows get the Armory's weapons; arrow
		// speed (Enyo's Bow); an arrow of a soldier or a building follows a
		// moving target only `track` tiles from where it stood (Ballistics)
		const Hitter h = hitter_of(attacker_id);
		if (ab) p.damage *= sim->techs.building_attack(p.owner);
		const double sp = sim->techs.arrow_speed(h);
		if (sp != 1) p.dur = 0.4 + p.dist * 0.065 / sp;
		if (!tb) {
			p.track = sim->techs.arrow_track(h);
			p.aim_x = tx;
			p.aim_z = tz;
		}
	}
	projectiles.push_back(p);
}

void Combat::update_projectiles(double dt) {
	const Entities &E = sim->entities;
	const GameMap &map = sim->map();
	std::vector<Projectile> list;
	list.swap(projectiles);
	std::vector<Projectile> out;
	out.reserve(list.size());
	for (Projectile &p : list) {
		p.t += dt;
		const int ts = E.slot(p.target);
		const Kind tk = E.kind(p.target);
		const bool alive = ts >= 0 && (tk == K_UNIT ? !E.units.dead[ts] : tk == K_BUILDING ? !E.buildings.dead[ts] : true);
		if (alive) {
			const bool b = tk == K_BUILDING;
			p.tx = b ? E.buildings.x[ts] : tk == K_UNIT ? E.units.x[ts] : E.resources.x[ts];
			p.tz = b ? E.buildings.z[ts] : tk == K_UNIT ? E.units.z[ts] : E.resources.z[ts];
			if (p.track >= 0) { // (Godot-only, sim/techs: the arrow follows the target only so far)
				const double dx = p.tx - p.aim_x, dz = p.tz - p.aim_z, d = std::sqrt(dx * dx + dz * dz);
				p.off = d > p.track + (tk == K_UNIT ? E.units.radius[ts] : 0); // (a body this wide still takes it)
				if (p.off) {
					p.tx = p.aim_x + dx * p.track / d;
					p.tz = p.aim_z + dz * p.track / d;
				}
			}
			p.ty = map.height_at(p.tx, p.tz) + (b ? 1.5 : 1.0);
			p.has_t = true;
		} else if (p.has_t && !p.lost) {
			// target died mid-flight: the arrow falls to the ground where it was
			p.lost = true;
			p.ty = map.height_at(p.tx, p.tz) + 0.15;
		}
		if (!p.has_t) continue;
		const double k = std::min(1.0, p.t / p.dur);
		p.px = p.x;
		p.py = p.y;
		p.pz = p.z;
		p.x = p.sx + (p.tx - p.sx) * k;
		p.z = p.sz + (p.tz - p.sz) * k;
		p.y = p.sy + (p.ty - p.sy) * k + jsm::sin(k * PI) * p.arc;
		if (k >= 1) {
			if (alive && p.off) { // (Godot-only: the target outran the arrow, which lands where it was aimed)
				p.y = map.height_at(p.x, p.z) + 0.15;
				if ((int)stuck.size() < STUCK_MAX) stuck.push_back({ p.x, p.y, p.z, p.x - p.px, p.y - p.py, p.z - p.pz, 0 });
				continue;
			}
			if (alive) {
				Hitter h = hitter_of(p.attacker);
				if (!h.id) h = Hitter::pseudo(p.owner);
				damage(p.target, p.damage, h, DK_ARROW);
			} else if ((int)stuck.size() < STUCK_MAX)
				stuck.push_back({ p.x, p.y, p.z, p.x - p.px, p.y - p.py, p.z - p.pz, 0 });
			continue;
		}
		out.push_back(p);
	}
	projectiles.swap(out);
	if (!stuck.empty()) {
		for (auto &s : stuck) s.t += dt;
		if (stuck[0].t > STUCK_TIME)
			stuck.erase(std::remove_if(stuck.begin(), stuck.end(), [](const StuckArrow &s) { return s.t > STUCK_TIME; }), stuck.end());
	}
}

// Phalanx discipline (set up by the battle scene): a man with combat_line
// never steps past his army's side of the seam.
void Combat::hold_lines() {
	UnitStore &U = sim->entities.units;
	const GameMap &map = sim->map();
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || !U.combat_line[r] || U.dead[r]) continue;
		const double d = (U.x[r] - U.line_cx[r]) * U.line_nx[r] + (U.z[r] - U.line_cz[r]) * U.line_nz[r];
		if (d >= U.line_d0[r]) continue;
		const double nx = U.x[r] + (U.line_d0[r] - d) * U.line_nx[r], nz = U.z[r] + (U.line_d0[r] - d) * U.line_nz[r];
		if (map.walkable_at(nx, nz)) {
			U.x[r] = nx;
			U.z[r] = nz;
		}
	}
}

void Combat::update(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	const double time = sim->time;
	scan_timer -= dt;
	const bool scan = scan_timer <= 0;
	if (scan) {
		scan_timer = 0.5;
		clear_attackers();
		for (int r = 0; r < U.size(); r++)
			if (!U.removed[r] && !U.dead[r] && U.order_type[r] == O_ATTACK) add_attacker(U.order_target[r]);
	}
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r]) continue;
		if (U.dead[r]) {
			// keep the fallen on the field (lying pose) for a while
			if (!std::isnan(U.died_at[r]) && time - U.died_at[r] < CORPSE_HOLD) U.anim_die_t[r] = std::min(U.anim_die_t[r], 2.0);
			continue;
		}
		const UnitDef &def = unit_def(U.type[r]);
		if (!def.has_attack) continue;
		U.attack_cd[r] = std::max(0.0, U.attack_cd[r] - dt);
		const int ot = U.order_type[r];
		// auto-acquire for idle soldiers
		if (ot == O_IDLE && scan && !def.gatherer && !(sim->godot_rules && U.civ_heal[r])) { // (sim/civ: a Priest healing keeps at it)
			const int e = pick_target(r, U.combat_leash[r] != 0 ? U.combat_leash[r] : U.sight[r]);
			if (e >= 0) {
				Order o = Order::with_target(O_ATTACK, U.id[e]);
				o.b = ATK_AUTO;
				sim->commands.order(r, o);
			}
			continue;
		}
		if (ot == O_ATTACK_MOVE) {
			update_attack_move(r);
			continue;
		}
		if (ot != O_ATTACK) continue;
		int32_t tid = U.order_target[r];
		int ts = E.slot(tid);
		Kind tk = E.kind(tid);
		if (ts >= 0 && tk != K_UNIT && tk != K_BUILDING) ts = -1;
		// attack-move: a man busy with a villager or a building turns on soldiers that come into sight
		if (U.am_resume[r] == AMR_ATTACK_MOVE && ts >= 0 && (sim->tick_count + U.id[r]) % AM_SCAN_TICKS == 0 && am_rank(tid) > 0) {
			int rank = 3;
			const int32_t e = am_pick(r, &rank);
			if (e && rank < am_rank(tid)) {
				U.order_target[r] = tid = e;
				U.order_a[r] = 0;
				U.am_lost[r] = 0;
				ts = E.slot(e);
				tk = E.kind(e);
				approach(r, e);
			}
		}
		// soldiers attacking a building switch to nearby enemy units
		if (scan && ts >= 0 && tk == K_BUILDING && !def.gatherer) {
			int e = find_enemy_near(U.x[r], U.z[r], U.owner[r], 6);
			// (Godot-only, fortify: a man breaking a wall does not turn on a
			// foe behind it, a villager repairing it: he cannot reach him)
			if (e >= 0 && (U.order_b[r] & ATK_BREACH) && is_wall_piece(B.type[ts])) {
				Pathfinder &pf = sim->pathfinder;
				const int N = sim->map().size, keep = pf.pass_owner;
				const int ax = sim->map().tile_clamp(U.x[r]), az = sim->map().tile_clamp(U.z[r]);
				const int bx = sim->map().tile_clamp(U.x[e]), bz = sim->map().tile_clamp(U.z[e]);
				pf.pass_owner = U.owner[r];
				if (sim->map().walkable_for(ax, az, U.owner[r]) && !pf.line_walkable(az * N + ax, bz * N + bx)) e = -1;
				pf.pass_owner = keep;
			}
			if (e >= 0) {
				// (remember the building, so the attack goes back to it afterwards;
				// a man breaking a wall keeps his real target, Godot-only fortify)
				if (!(is_wall_piece(B.type[ts]) && (U.order_b[r] & ATK_BREACH))) U.order_a[r] = tid;
				tid = U.order_target[r] = U.id[e];
				ts = e;
				tk = K_UNIT;
			}
		}
		const bool tdead = ts < 0 || (tk == K_UNIT ? U.dead[ts] : B.dead[ts]);
		if (tdead && U.am_resume[r]) {
			resume(r);
			continue;
		}
		if (tdead) {
			const int32_t back_id = U.order_a[r];
			// (order_a is a building id, or, Godot-only, the unit a wall breaker
			// was sent to kill)
			const Kind bk = back_id ? E.kind(back_id) : K_NONE;
			const int bs = bk == K_BUILDING || bk == K_UNIT ? E.slot(back_id) : -1;
			const bool back_alive = bs >= 0 && (bk == K_UNIT ? !U.dead[bs] : !B.dead[bs]);
			const bool breach_back = (U.order_b[r] & ATK_BREACH) && back_alive;
			const int e = !def.gatherer && !breach_back ? pick_target(r, U.combat_leash[r] != 0 ? U.combat_leash[r] : U.sight[r]) : -1;
			if (breach_back) {
				// Godot-only (fortify): the wall is down: back to the real target
				U.order_b[r] &= ~ATK_BREACH;
				if (bk == K_UNIT) U.order_a[r] = 0;
				U.order_target[r] = back_id;
				U.order_x[r] = 0;
				approach(r, back_id);
			} else if (e >= 0) {
				U.order_target[r] = U.id[e];
				approach(r, U.id[e]);
			} else if (back_alive) {
				if (bk == K_UNIT) U.order_a[r] = 0;
				U.order_b[r] &= ~ATK_BREACH;
				U.order_target[r] = back_id;
				approach(r, back_id);
			} else if (U.order_b[r] & ATK_THEN_BUILDINGS) {
				const int b = find_enemy_building_near(U.x[r], U.z[r], U.owner[r], 200);
				if (b >= 0) {
					U.order_target[r] = B.id[b];
					approach(r, B.id[b]);
				} else
					sim->commands.idle(r);
			} else if (U.order_b[r] & ATK_BROKE_IN) {
				// Godot-only (fortify): men sent into a walled town that have
				// nothing left to kill turn on its buildings close by
				const int b = find_enemy_building_near(U.x[r], U.z[r], U.owner[r], U.sight[r] * 2);
				if (b >= 0) {
					U.order_target[r] = B.id[b];
					U.order_a[r] = 0;
					approach(r, B.id[b]);
				} else
					sim->commands.idle(r);
			} else
				sim->commands.idle(r);
			continue;
		}
		const double range = range_of(r);
		const double dist = sim->movement.distance_to(r, tid) - U.radius[r];
		if (U.am_resume[r]) { // a foe out of sight for a while: walk on
			if (dist > U.sight[r]) {
				U.am_lost[r] += dt;
				if (U.am_lost[r] > AM_LOST_TIME) {
					resume(r);
					continue;
				}
			} else
				U.am_lost[r] = 0;
		}
		if (dist > range + 0.25) {
			// Godot-only (fortify): the target is walled off and the man has
			// stopped at the end of his path: break through the nearest enemy wall
			if (sim->godot_rules && sim->fortify.walls > 0 && U.path_blocked[r]) U.order_b[r] |= ATK_BROKE_IN; // (walled off)
			if (sim->godot_rules && sim->fortify.walls > 0 && !U.moving[r] && U.path_blocked[r]) {
				const int32_t w = sim->fortify.breach_target(r);
				if (w && w != tid) {
					// (back to the real target afterwards: a building or a unit;
					// a man already at a wall, or one that left his building for
					// a unit close by, keeps the target he had)
					if (tk == K_BUILDING ? !is_wall_piece(B.type[ts]) : U.order_a[r] == 0) U.order_a[r] = tid;
					U.order_b[r] |= ATK_BREACH;
					U.order_target[r] = w;
					U.am_lost[r] = 0;
					approach(r, w);
					U.order_x[r] = 0.6;
					continue;
				}
			}
			U.order_x[r] -= dt; // o.repath
			// (Godot-only: a man walled off from his target searches again
			// every WALLED_REPATH s, not every tick at the end of his path /
			// every 0.6 s on his way to the wall: the answer is the same)
			const bool walled = sim->godot_rules && U.path_blocked[r];
			if ((!U.moving[r] && !walled) || U.order_x[r] <= 0) {
				approach(r, tid);
				U.order_x[r] = sim->godot_rules && U.path_blocked[r] ? (tk == K_BUILDING ? WALLED_REPATH_BUILDING : WALLED_REPATH) : 0.6;
			}
			continue;
		}
		if (U.moving[r]) sim->movement.stop(r);
		const double tx = tk == K_UNIT ? U.x[ts] : B.x[ts], tz = tk == K_UNIT ? U.z[ts] : B.z[ts];
		U.rot[r] = jsm::atan2(tx - U.x[r], tz - U.z[r]);
		U.anim_want[r] = A_ATTACK;
		if (U.attack_cd[r] <= 0) {
			const UnitAttack &a = def.attack;
			U.attack_cd[r] = a.cooldown * (0.85 + 0.3 * sim->rng.next());
			// (Godot-only, sim/techs: the owner's upgrades on damage, reload, splash)
			const bool tech = sim->godot_rules;
			if (tech) U.attack_cd[r] *= sim->techs.reload_mult(r);
			const double a_damage = tech ? sim->techs.unit_damage(r) : a.damage;
			const double a_splash = tech ? a.splash + sim->techs.splash_add(r) : a.splash;
			U.anim_attack_t[r] = 0;
			if (a.projectile) fire(U.id[r], tid, a_damage, 1.3);
			else {
				Hitter h = hitter_of(U.id[r]);
				damage(tid, a_damage, h);
				if (a_splash > 0) {
					const double cx = tk == K_UNIT ? U.x[ts] : B.x[ts], cz = tk == K_UNIT ? U.z[ts] : B.z[ts];
					const int owner = U.owner[r];
					sim->movement.hash.count_query(cx, cz, a_splash);
					sim->movement.hash.for_each_near(cx, cz, a_splash, [&](int o) {
						if (tk == K_UNIT && o == ts) return;
						if (U.dead[o] || !sim->is_enemy(owner, U.owner[o])) return;
						if (jsm::hypot(U.x[o] - cx, U.z[o] - cz) < a_splash) damage(U.id[o], a_damage * 0.5, h);
					});
				}
			}
		}
	}
	// buildings that shoot (Town Center)
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b]) continue;
		const BuildingDef &d = building_def(B.type[b]);
		if (!d.has_attack || !B.built[b]) continue;
		B.attack_cd[b] = std::max(0.0, B.attack_cd[b] - dt);
		if (B.attack_cd[b] > 0) continue;
		const int e = find_enemy_near(B.x[b], B.z[b], B.owner[b], d.attack_range + B.w[b] / 2.0);
		if (e >= 0) {
			B.attack_cd[b] = d.attack_cooldown;
			if (sim->godot_rules && B.civ_empower[b] > 0) B.attack_cd[b] *= sim->civs.reload_mult(b); // (sim/civ: empowered, x0.75)
			fire(B.id[b], U.id[e], d.attack_damage, 4);
		}
	}
	hold_lines();
	{
		ScopedTimer t(sim->prof.enabled ? &sim->prof.sub["combat.projectiles"] : nullptr);
		update_projectiles(dt);
	}
	for (size_t i = 0; i < ais.size(); i++) {
		ScopedTimer t(sim->prof.enabled ? &sim->prof.ai[std::to_string(ais[i].owner)] : nullptr);
		ais[i].update(dt);
	}
}

} // namespace aov
