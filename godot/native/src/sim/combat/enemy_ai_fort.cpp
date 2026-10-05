// The enemy AI's use of fortifications (Godot-only, behind Sim::godot_rules;
// the browser's EnemyAI has none). See enemy_ai.h (AIParams: towers_max ..
// tower_fear) and godot/PORTING.md "Enemy AI: fortifications".
//
// Building: towers by its Town Center (towards the nearest enemy), then by
// its gold mine and its wood line; at Hard / Titan a wall ring round its
// town (a square with clipped corners just outside its buildings, a line at a time as it can
// pay, villagers kept on it), a 3-tile opening left on each straight side,
// filled and turned into a gate once the ring stands; tower and wall stages
// researched as the ages allow; damaged pieces (and buildings) repaired when
// no foe is near. Every 20 s it checks its men can still walk out of the
// ring (a gate given up, a building in an opening) and opens it if not.
//
// Attacking: the sim's breach rule sends each walled-off man at the wall
// piece nearest to him; the AI turns each group of breakers onto one piece
// (the weakest / closest of those they picked), so a wave makes one hole
// instead of scratching every piece. A wave that would face more towers than
// it can take picks a target outside their range, or waits for more men
// (never past an overdue interval), and a wave worn down inside tower range
// falls back home to join the next one. Tower fear ends at FEAR_UNTIL, so
// AI-vs-AI matches cannot stall behind towers. Deterministic: no rng draws,
// every loop in row order.
#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"
#include "enemy_ai.h"

namespace aov {

static const double PI = 3.141592653589793;
static const int RING_MIN = 15, RING_MAX = 22; // half-width of the ring (tiles; archers shoot 12 over a wall)
static const double RING_ENEMY_SHARE = 0.36;   // ... at most this share of the way to the nearest other Town Center
static const int GATE_LEN = 3;
static const double REPAIR_BELOW = 0.7;        // hp share under which a piece is repaired
static const double REPAIR_SAFE = 8;           // no foe this close to it
static const double FEAR_UNTIL = 1500;         // s: tower fear ends (no stalemate behind towers)
static const double FOCUS_CLUSTER = 16;        // breakers this close form one group
static const double FOCUS_REACH = 12;          // ... and are turned onto its piece from this close
static const double RING_CHECK_EVERY = 20;     // s between walk-out checks
static const double LINE_PATIENCE = 40;        // s a ring line waits for wood before the academies wait for it
static const double UPGRADE_KEEP_WOOD = 30;    // wood / gold left over after a fortification tech
static const double UPGRADE_KEEP_GOLD = 20;
static const double UPGRADE_WAIT = 90;         // s the academies wait for each tech's wood / gold
static const int PATCH_HOLE = 12;              // a patch of up to this many tiles is a hole (no reserve kept, the academies wait)
static const double PATCH_SAFE = 8;            // no foe this close to a hole when it is walled up
static const double GAP_RETRY = 60;            // s before an opening left open is tried again
static const double SIEGE_EVERY = 2;           // s between siege checks
static const double SIEGE_CLUSTER = 14;        // our men this close form one group
static const double SIEGE_SCAN = 40;           // enemy wall pieces this close to a walled-off group are weighed
static const double SIEGE_FAR = 90;            // ... pieces this close are tried for one they can walk up to
static const size_t SIEGE_TRIES = 48;          // pieces tried, best first (most of a ring backed by a forest fails at once: a region cut)
static const int64_t SIEGE_BUDGET = 24000;     // A* expansions the tries may spend per check
static const int SIEGE_NODES = 40000;          // A* expansions of a siege's search for a piece
static const double SIEGE_STALL = 30;          // s a picked piece may go unhurt before it is given up
static const double SIEGE_BAN = 120;           // ... for this long
static const size_t SIEGE_ALT_TRIES = 8;       // other buildings tried when no piece can be got at
static const int SIEGE_ON = 12;                // men set on one piece at most (a pillar has room for about that many)
static const double SIEGE_COVER = 9;           // bowmen at a breach shoot the foes this close to the piece
static const double SIEGE_HOME = 25;           // men this close to our Town Center are at home

namespace {
// the corners' cut (a square ring with its corners clipped by a short
// diagonal, like reference/walls/walls_01's closed squares)
int corner(int R) { return std::max(1, R / 8); }
// men a wave needs per enemy tower in range, by its stage
int men_per_tower(int level) { return 4 + 2 * std::max(0, std::min(3, level)); }
double box_dist(const BuildingStore &B, int b, double x, double z) {
	const double ex = std::max(std::max(B.tx[b] - x, 0.0), x - (B.tx[b] + B.w[b]));
	const double ez = std::max(std::max(B.tz[b] - z, 0.0), z - (B.tz[b] + B.h[b]));
	return std::sqrt(ex * ex + ez * ez);
}
// Would breaking piece b open a way through (open ground on both faces,
// across the wall)? A piece of a staircase (a ring's clipped corner, a
// diagonal line) only leaves a corner gap no one walks through.
bool breach_opens(const Sim &S, int b, int owner) {
	const BuildingStore &B = S.entities.buildings;
	const GameMap &map = S.map();
	auto open = [&](int x, int z) { return map.in_tiles(x, z) && map.walkable_for(x, z, owner); };
	const int tx = B.tx[b], tz = B.tz[b], w = B.w[b], h = B.h[b];
	if (w >= h)
		for (int x = tx; x < tx + w; x++)
			if (open(x, tz - 1) && open(x, tz + h)) return true;
	if (h >= w)
		for (int z = tz; z < tz + h; z++)
			if (open(tx - 1, z) && open(tx + w, z)) return true;
	return false;
}
} // namespace

// Send villager u to build / repair building id, keeping his gather or
// worship order to go back to (as Fortify::place_wall does).
static void send_build(Sim &S, int u, int32_t id) {
	UnitStore &U = S.entities.units;
	int ptype = -1;
	int32_t ptarget = 0;
	if (U.order_type[u] == O_GATHER || U.order_type[u] == O_WORSHIP) {
		ptype = U.order_type[u];
		ptarget = U.order_target[u];
	}
	S.commands.order(u, Order::with_target(O_BUILD, id));
	if (U.order_type[u] == O_BUILD && ptype >= 0) {
		U.order_b[u] = ptype + 1;
		U.order_c[u] = ptarget;
		U.order_a[u] = U.econ_res_type[u] == RES_NONE ? 0 : U.econ_res_type[u] + 1;
	}
}

// ---- the think step ---------------------------------------------------------

void EnemyAI::fortify(int tc, const std::vector<int> &vills, const std::vector<int> &army, const std::vector<int> &buildings, bool saving) {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	Player &p = S.players[owner];
	foe_towers_.clear();
	if (S.fortify.towers > 0)
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || B.type[b] != B_TOWER || !B.built[b] || !sim->is_enemy(owner, B.owner[b])) continue;
			const int lv = S.fortify.tower_level[B.owner[b]];
			foe_towers_.push_back({ B.x[b], B.z[b], tower_stage(lv).range + 1, men_per_tower(lv) });
		}
	int towers = 0, rising = 0;
	bool academy = false;
	for (int b : buildings) {
		if (B.type[b] == B_TOWER) {
			towers++;
			rising += !B.built[b];
		}
		academy = academy || (B.type[b] == B_BARRACKS && B.built[b]);
	}
	const int nv = (int)vills.size();
	// towers, one at a time, once the army has its academy
	want_gold_ = tower_wait_ = false;
	if (towers < par.towers_max && !rising && academy && nv >= par.tower_at && (!saving || par.army_while_saving)) {
		const Cost &c = building_def(B_TOWER).cost;
		want_gold_ = p.res[RES_GOLD] < c.v[RES_GOLD] + 20;
		if (p.res[RES_WOOD] >= c.v[RES_WOOD] + 60 && p.res[RES_GOLD] >= c.v[RES_GOLD] + 20) {
			if (!build_tower(tc, vills, false)) tower_fail_++;
		} else
			tower_wait_ = tower_fail_ < 30; // (no spot found 30 times: stop holding the army for it)
	}
	// the wall ring
	if (par.walls && ring_state_ == 0 && academy && S.time >= par.wall_at) {
		ring_state_ = plan_ring(tc) ? 1 : 3;
		if (ring_state_ == 1) fort.ring_at = S.time;
	}
	if (ring_state_ == 1) {
		// (its first tower comes first)
		if (!ring_lines_.empty() && (!saving || par.army_while_saving) && (towers > 0 || par.towers_max <= 0)) {
			std::vector<int> none;
			place_ring_line(false, none);
		}
		ring_builders(vills);
		if (ring_lines_.empty()) {
			bool done = true;
			for (int32_t id : ring_ids_) {
				const int b = S.entities.building_slot(id);
				if (b >= 0 && !B.dead[b] && !B.built[b]) done = false;
			}
			if (done) ring_state_ = 2;
		}
	}
	if (ring_state_ == 3) {
		// an opening left open (its segment broken, ground taken) is tried
		// again a while later, once no foe is at it
		for (AIGateGap &g : gaps_) {
			if (g.state == 2) { // (its gate broken: built again later)
				const int b = S.entities.building_slot(g.seg);
				if (b < 0 || B.dead[b] || B.type[b] != B_GATE) {
					g.state = 3;
					g.retry_t = S.time + GAP_RETRY;
				}
			}
			if (g.state == 3 && S.time >= g.retry_t) {
				g.retry_t = S.time + GAP_RETRY;
				if (S.combat.find_enemy_near((g.tx0 + g.tx1) * 0.5 + 0.5, (g.tz0 + g.tz1) * 0.5 + 0.5, owner, 14) < 0) {
					g.state = 0;
					ring_state_ = 2;
				}
			}
		}
	}
	if (ring_state_ == 2) ring_gates(false);
	if (ring_state_ >= 2) patch_ring(); // (a line a think)
	if (ring_state_ >= 1 && !ring_ids_.empty()) {
		ring_check_t_ -= par.think;
		if (ring_check_t_ <= 0) {
			ring_check_t_ = RING_CHECK_EVERY;
			ScopedTimer t(S.prof.enabled ? &S.prof.sub["ai.ring_check"] : nullptr);
			check_ring_open(tc);
		}
	}
	upgrade(buildings, saving);
	repair(vills, buildings);
	if (par.breach_focus) focus_breach(army);
	siege(army, tc);
	avoid_towers();
}

// ---- towers -----------------------------------------------------------------

// Spot k: 0 by the Town Center towards the nearest enemy, 1 between it and
// its gold mine, 2 ... its wood line, then round the Town Center.
bool EnemyAI::tower_spot(int tc, int k, int &otx, int &otz) const {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	const double cx = B.x[tc], cz = B.z[tc];
	double dx = 1, dz = 0, best = INFINITY;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || B.type[b] != B_TOWN_CENTER || B.owner[b] == owner || !sim->is_enemy(owner, B.owner[b])) continue;
		const double d = jsm::hypot(B.x[b] - cx, B.z[b] - cz);
		if (d > 0 && d < best) {
			best = d;
			dx = (B.x[b] - cx) / d;
			dz = (B.z[b] - cz) / d;
		}
	}
	double ax = cx + dx * 7, az = cz + dz * 7;
	auto near_res = [&](int res, double maxd, double pull) {
		const int32_t r = S.economy.nearest_resource(cx, cz, res, maxd);
		const int s = r ? S.entities.resource_slot(r) : -1;
		if (s < 0) return false;
		const ResourceStore &R = S.entities.resources;
		const double rx = R.x[s], rz = R.z[s], d = jsm::hypot(cx - rx, cz - rz);
		if (d < 1) return false;
		ax = rx + (cx - rx) / d * pull;
		az = rz + (cz - rz) / d * pull;
		return true;
	};
	if (k == 1 && !near_res(RES_GOLD, 22, 3.5)) { ax = cx - dz * 8; az = cz + dx * 8; }
	if (k == 2 && !near_res(RES_WOOD, 20, 3)) { ax = cx + dz * 8; az = cz - dx * 8; }
	if (k >= 3) {
		const double a = jsm::atan2(dz, dx) + PI * 0.5 * (k - 2);
		ax = cx + jsm::cos(a) * 9;
		az = cz + jsm::sin(a) * 9;
	}
	for (int r = 0; r <= 7; r++) {
		const int steps = r == 0 ? 1 : 16;
		for (int i = 0; i < steps; i++) {
			const double a = PI * 2 * i / steps;
			const int tx = (int)std::floor(ax + jsm::cos(a) * r) - 1, tz = (int)std::floor(az + jsm::sin(a) * r) - 1;
			if (!S.buildings.can_place(B_TOWER, tx, tz) || !gap_ok(tx, tz, 2, 2) || reserved(tx, tz, 2, 2)) continue;
			bool spaced = true;
			for (int b = 0; b < B.size() && spaced; b++)
				if (!B.removed[b] && !B.dead[b] && B.type[b] == B_TOWER && B.owner[b] == owner && jsm::hypot(B.x[b] - (tx + 1), B.z[b] - (tz + 1)) < 6) spaced = false;
			if (!spaced) continue;
			otx = tx;
			otz = tz;
			return true;
		}
	}
	return false;
}

bool EnemyAI::build_tower(int tc, const std::vector<int> &vills, bool instant) {
	Sim &S = *sim;
	Player &p = S.players[owner];
	const Cost &c = building_def(B_TOWER).cost;
	const int builder = instant ? -1 : pick_builder(vills);
	if ((!instant && builder < 0) || !p.can_afford(c)) return false;
	int tx = 0, tz = 0;
	bool found = false;
	for (int k = fort.towers; k < fort.towers + 4 && !found; k++) found = tower_spot(tc, k, tx, tz);
	if (!found) return false;
	p.pay(c);
	const int b = S.buildings.spawn(B_TOWER, owner, tx, tz, instant);
	if (b < 0) return false;
	fort.towers++;
	if (!instant) send_build(S, builder, S.entities.buildings.id[b]);
	return true;
}

// ---- the wall ring ----------------------------------------------------------

bool EnemyAI::reserved(int tx, int tz, int w, int h) const {
	// the lines of the ring still to be laid (and a tile round them): no
	// farm or house where the wall will run
	for (const std::array<int, 4> &l : ring_lines_) {
		const int x0 = std::min(l[0], l[2]) - 1, x1 = std::max(l[0], l[2]) + 1, z0 = std::min(l[1], l[3]) - 1, z1 = std::max(l[1], l[3]) + 1;
		if (tx <= x1 && tx + w - 1 >= x0 && tz <= z1 && tz + h - 1 >= z0) return true;
	}
	for (const AIGateGap &g : gaps_) {
		if (g.state == 2 || g.state == 4) continue;
		// the opening and 2 tiles in front of and behind it
		const int x0 = std::min(g.tx0, g.tx1) - (g.tz0 == g.tz1 ? 0 : 2), x1 = std::max(g.tx0, g.tx1) + (g.tz0 == g.tz1 ? 0 : 2);
		const int z0 = std::min(g.tz0, g.tz1) - (g.tz0 == g.tz1 ? 2 : 0), z1 = std::max(g.tz0, g.tz1) + (g.tz0 == g.tz1 ? 2 : 0);
		if (tx <= x1 && tx + w - 1 >= x0 && tz <= z1 && tz + h - 1 >= z0) return true;
	}
	return false;
}

// A square ring with clipped corners round the Town Center just outside the town (RING_MIN ..
// RING_MAX, never more than RING_ENEMY_SHARE of the way to another Town
// Center), split into lines, a gate opening in each straight side.
bool EnemyAI::plan_ring(int tc) {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	const GameMap &map = S.map();
	const int cx = (int)std::floor(B.x[tc]), cz = (int)std::floor(B.z[tc]);
	double dmin = INFINITY, ex = 1, ez = 0;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || B.type[b] != B_TOWN_CENTER || B.owner[b] == owner) continue;
		const double d = jsm::hypot(B.x[b] - B.x[tc], B.z[b] - B.z[tc]);
		if (d < dmin) {
			dmin = d;
			if (sim->is_enemy(owner, B.owner[b]) || ex == 1) {
				ex = (B.x[b] - B.x[tc]) / std::max(1.0, d);
				ez = (B.z[b] - B.z[tc]) / std::max(1.0, d);
			}
		}
	}
	const int rmax = std::min(RING_MAX, std::isfinite(dmin) ? (int)std::floor(dmin * RING_ENEMY_SHARE) : RING_MAX);
	if (rmax < RING_MIN) return false;
	// the smallest ring holding every building of ours (2 tiles to spare)
	auto inside = [&](int R, int dx, int dz) {
		const int c = corner(R);
		return std::abs(dx) <= R - 2 && std::abs(dz) <= R - 2 && std::abs(dx) + std::abs(dz) <= 2 * R - c - 3;
	};
	int R = RING_MIN;
	for (; R < rmax; R++) {
		bool ok = true;
		for (int b = 0; b < B.size() && ok; b++) {
			if (B.removed[b] || B.dead[b] || B.owner[b] != owner || is_fort_type(B.type[b])) continue;
			for (int k = 0; k < 4 && ok; k++) {
				const int x = B.tx[b] + (k & 1 ? B.w[b] - 1 : 0), z = B.tz[b] + (k & 2 ? B.h[b] - 1 : 0);
				ok = inside(R, x - cx, z - cz);
			}
		}
		if (ok) break;
	}
	const int c = corner(R), lo = 1, hi = map.size - 2;
	auto cl = [&](int v) { return std::max(lo, std::min(hi, v)); };
	// vertices, clockwise from the north (-z) side's west end
	const int V[8][2] = {
		{ cx - R + c, cz - R }, { cx + R - c, cz - R }, { cx + R, cz - R + c }, { cx + R, cz + R - c },
		{ cx + R - c, cz + R }, { cx - R + c, cz + R }, { cx - R, cz + R - c }, { cx - R, cz - R + c },
	};
	int P[8][2];
	for (int i = 0; i < 8; i++) {
		P[i][0] = cl(V[i][0]);
		P[i][1] = cl(V[i][1]);
	}
	ring_cx_ = cx;
	ring_cz_ = cz;
	ring_r_ = R;
	ring_lines_.clear();
	gaps_.clear();
	// start with the side facing the nearest other town, then clockwise
	const double na[4][2] = { { 0, -1 }, { 1, 0 }, { 0, 1 }, { -1, 0 } };
	int first = 0;
	double bd = -2;
	for (int s = 0; s < 4; s++) {
		const double d = na[s][0] * ex + na[s][1] * ez;
		if (d > bd) {
			bd = d;
			first = s;
		}
	}
	auto open_tile = [&](int x, int z) { return map.in_tiles(x, z) && map.is_walkable(x, z) && !S.buildings.in_footprint(x, z); };
	for (int k = 0; k < 4; k++) {
		const int s = (first + k) % 4, a = s * 2, b = a + 1, n = (b + 1) % 8;
		const int ax = P[a][0], az = P[a][1], bx = P[b][0], bz = P[b][1];
		const bool along_x = az == bz;
		const bool clamped = along_x ? (V[a][1] != az) : (V[a][0] != ax);
		const int len = along_x ? std::abs(bx - ax) : std::abs(bz - az);
		const int dir = along_x ? (bx > ax ? 1 : -1) : (bz > az ? 1 : -1);
		// the gate opening: the middle of the side, slid along it to open ground
		int gs = -1;
		if (!clamped && len >= GATE_LEN + 6) {
			const int mid = len / 2 - GATE_LEN / 2;
			static const int SLIDE[7] = { 0, 3, -3, 6, -6, 9, -9 };
			for (int sl : SLIDE) {
				const int g = mid + sl;
				if (g < 3 || g + GATE_LEN > len - 2) continue;
				bool ok = true;
				for (int t = 0; t < GATE_LEN && ok; t++)
					for (int o = -2; o <= 2 && ok; o++) {
						const int along = (along_x ? ax : az) + dir * (g + t);
						const int x = along_x ? along : ax + o, z = along_x ? az + o : along;
						ok = open_tile(x, z);
					}
				if (ok) {
					gs = g;
					break;
				}
			}
		}
		auto at = [&](int t, int &x, int &z) {
			x = along_x ? ax + dir * t : ax;
			z = along_x ? az : az + dir * t;
		};
		if (gs >= 0) {
			int x0, z0, x1, z1;
			at(gs - 1, x1, z1);
			ring_lines_.push_back({ ax, az, x1, z1 });
			at(gs + GATE_LEN, x0, z0);
			ring_lines_.push_back({ x0, z0, bx, bz });
			AIGateGap g;
			at(gs, g.tx0, g.tz0);
			at(gs + GATE_LEN - 1, g.tx1, g.tz1);
			gaps_.push_back(g);
		} else
			ring_lines_.push_back({ ax, az, bx, bz });
		// the corner cut to the next side
		ring_lines_.push_back({ bx, bz, P[n][0], P[n][1] });
	}
	ring_plan_ = ring_lines_;
	patch_next_ = 0;
	return true;
}

bool EnemyAI::place_ring_line(bool instant, const std::vector<int> &builders) {
	Sim &S = *sim;
	Player &p = S.players[owner];
	if (S.civs.civ(owner) == CIV_EGYPT && p.age < EGYPT_WALL_AGE) return false; // (sim/civ: Egyptian walls from the Classical Age; the ring waits)
	while (!ring_lines_.empty()) {
		const std::array<int, 4> l = ring_lines_.front();
		const WallPlan plan = S.fortify.plan_wall(owner, l[0], l[1], l[2], l[3], true);
		if (plan.pieces.empty() || plan.new_tiles == 0) {
			ring_lines_.erase(ring_lines_.begin()); // nothing to lay there (blocked ground, already walled)
			continue;
		}
		const double rw = instant ? 0 : 40, rg = instant ? 0 : 15; // keep something for the army
		line_wood_ = plan.cost.v[RES_WOOD] + rw;
		line_gold_ = plan.cost.v[RES_GOLD] + rg;
		if (p.res[RES_WOOD] < line_wood_ || p.res[RES_GOLD] < line_gold_) {
			if (line_wait_since_ < 0) line_wait_since_ = S.time;
			return false;
		}
		line_wood_ = line_gold_ = 0;
		line_wait_since_ = -1;
		FortResult res;
		const std::vector<int32_t> ids = S.fortify.place_wall(owner, l[0], l[1], l[2], l[3], builders, res, true);
		ring_lines_.erase(ring_lines_.begin());
		if (!res.ok) continue;
		fort.wall_lines++;
		fort.wall_tiles += plan.new_tiles;
		for (int32_t id : ids) {
			ring_ids_.push_back(id);
			if (instant) {
				const int b = S.entities.building_slot(id);
				if (b >= 0) S.buildings.complete(b);
			}
		}
		return true;
	}
	return false;
}

// Keep par.wall_builders villagers on the ring's unfinished pieces.
void EnemyAI::ring_builders(const std::vector<int> &vills) {
	Sim &S = *sim;
	const UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	std::vector<int> sites;
	for (int32_t id : ring_ids_) {
		const int b = S.entities.building_slot(id);
		if (b >= 0 && !B.dead[b] && !B.built[b]) sites.push_back(b);
	}
	if (sites.empty()) return;
	int on = 0;
	std::vector<int32_t> short_of;
	for (int v : vills) {
		if (U.order_type[v] != O_BUILD) continue;
		const int b = S.entities.building_slot(U.order_target[v]);
		if (b < 0 || !is_wall_piece(B.type[b])) continue;
		on++;
		// standing still short of a foundation: it cannot be reached
		if (!B.built[b] && !U.moving[v] && box_dist(B, b, U.x[v], U.z[v]) > 1.6) short_of.push_back(B.id[b]);
	}
	// a foundation nobody can reach (water, trees, a farm round it) is
	// pulled down after a few thinks and its tiles paid back, so the
	// builders go on to the rest of the ring
	std::vector<std::pair<int32_t, int>> next;
	for (int32_t id : short_of) {
		bool seen = false;
		for (auto &kv : next) seen = seen || kv.first == id;
		if (seen) continue;
		int n = 1;
		for (const auto &kv : stuck_sites_)
			if (kv.first == id) n = kv.second + 1;
		next.push_back({ id, n });
	}
	stuck_sites_.clear();
	for (const auto &kv : next) {
		if (kv.second < 6) {
			stuck_sites_.push_back(kv);
			continue;
		}
		const int b = S.entities.building_slot(kv.first);
		if (b < 0) continue;
		const Cost &tc = building_def(B_WALL).cost;
		const int tiles = B.w[b] * B.h[b];
		S.players[owner].refund(Cost(0, tc.v[RES_WOOD] * tiles, tc.v[RES_GOLD] * tiles, 0));
		S.buildings.destroy(kv.first);
		fort.dropped++;
		on--;
	}
	for (int v : vills) {
		if (on >= par.wall_builders) break;
		if (U.order_type[v] != O_GATHER || U.econ_phase[v] == EP_NONE || (U.econ_res_type[v] != RES_WOOD && U.econ_res_type[v] != RES_GOLD)) continue;
		int best = -1;
		double bd = INFINITY;
		for (int b : sites) {
			const double d = box_dist(B, b, U.x[v], U.z[v]);
			if (d < bd) {
				bd = d;
				best = b;
			}
		}
		send_build(S, v, B.id[best]);
		on++;
	}
}

// Fill the openings and turn each into a gate: any number at once, but never
// the last one our men can still walk through while the others are rising.
void EnemyAI::ring_gates(bool instant) {
	Sim &S = *sim;
	BuildingStore &B = S.entities.buildings;
	Player &p = S.players[owner];
	const Cost &gc = building_def(B_GATE).cost;
	bool all = true;
	for (AIGateGap &g : gaps_) {
		if (g.state >= 2) continue;
		all = false;
		if (g.state == 1) {
			const int b = S.entities.building_slot(g.seg);
			if (b < 0 || B.dead[b] || B.type[b] != B_WALL) {
				g.state = 3; // broken before it became a gate: left open
				g.retry_t = S.time + GAP_RETRY;
				continue;
			}
			if (!B.built[b]) {
				if (!instant) {
					// one villager on it
					const UnitStore &U = S.entities.units;
					bool any = false;
					for (int u = 0; u < U.size() && !any; u++)
						any = !U.removed[u] && !U.dead[u] && U.owner[u] == owner && U.order_type[u] == O_BUILD && U.order_target[u] == g.seg;
					if (!any) {
						std::vector<int> vills;
						for (int u = 0; u < U.size(); u++)
							if (!U.removed[u] && !U.dead[u] && U.owner[u] == owner && unit_def(U.type[u]).gatherer) vills.push_back(u);
						const int v = pick_builder(vills);
						if (v >= 0) send_build(S, v, g.seg);
					}
				}
				continue;
			}
			if (S.fortify.convert_to_gate(g.seg).ok) {
				g.state = 2;
				fort.gates++;
			}
			continue; // (else waits for the gold)
		}
		// state 0: another way out must stay (an opening still open, a gate, an opening given up)
		// (or, the last one, once nothing else is rising: closed for its few seconds of building)
		int ways = 0, rising = 0;
		for (const AIGateGap &o : gaps_) {
			ways += &o != &g && (o.state == 0 || o.state == 2 || o.state == 3);
			rising += o.state == 1;
		}
		if (ways == 0 && rising > 0) continue;
		// fill it if the gate can be paid for too (the line runs from the
		// pillar before the opening to the one after it, so those are joints
		// and the opening becomes one segment; where the ring beside it did
		// not come up to it, pillars close the ends)
		const int sx = (g.tx1 > g.tx0) - (g.tx1 < g.tx0), sz = (g.tz1 > g.tz0) - (g.tz1 < g.tz0);
		const int fx0 = g.tx0 - sx, fz0 = g.tz0 - sz, fx1 = g.tx1 + sx, fz1 = g.tz1 + sz;
		const WallPlan plan = S.fortify.plan_wall(owner, fx0, fz0, fx1, fz1, true);
		if (plan.pieces.empty()) {
			g.state = 3; // (nothing can stand there: left open)
			g.retry_t = S.time + GAP_RETRY;
			continue;
		}
		if (p.res[RES_WOOD] < plan.cost.v[RES_WOOD] + gc.v[RES_WOOD] || p.res[RES_GOLD] < plan.cost.v[RES_GOLD] + gc.v[RES_GOLD]) continue;
		FortResult res;
		const std::vector<int32_t> ids = S.fortify.place_wall(owner, fx0, fz0, fx1, fz1, {}, res, true);
		if (!res.ok || ids.empty()) {
			g.state = 3;
			g.retry_t = S.time + GAP_RETRY;
			continue;
		}
		fort.wall_tiles += plan.new_tiles;
		g.seg = 0;
		for (int32_t id : ids) {
			ring_ids_.push_back(id);
			const int b = S.entities.building_slot(id);
			if (b >= 0 && !g.seg && B.type[b] == B_WALL && std::max(B.w[b], B.h[b]) >= 2) g.seg = id;
			if (instant && b >= 0) S.buildings.complete(b);
		}
		g.state = g.seg ? 1 : 4; // (4: walled, no gate there)
		if (instant && g.seg && S.fortify.convert_to_gate(g.seg).ok) {
			g.state = 2;
			fort.gates++;
		}
	}
	if (all) {
		ring_state_ = 3;
		fort.ring_done_at = S.time;
	}
}

// The ring stands: lay its lines again, one per think, so tiles that were
// trees, a berry bush or a farm when the line went up, and pieces the enemy
// broke (once no foe is near), are walled now (only the new tiles are paid
// and built; place_wall skips the standing pieces).
void EnemyAI::patch_ring() {
	Sim &S = *sim;
	hole_wait_ = false;
	if (ring_plan_.empty()) return;
	Player &p = S.players[owner];
	for (size_t k = 0; k < ring_plan_.size(); k++) {
		const std::array<int, 4> &l = ring_plan_[patch_next_ % ring_plan_.size()];
		patch_next_++;
		const WallPlan plan = S.fortify.plan_wall(owner, l[0], l[1], l[2], l[3], true);
		if (plan.pieces.empty() || plan.new_tiles == 0) continue;
		// (not under the enemy's nose: a breach is walled up once the fight
		// at it has moved on; foes elsewhere along the line do not matter)
		bool foe = false;
		for (size_t t = 0; t < plan.state.size() && !foe; t++)
			if (plan.state[t] == WT_NEW) foe = S.combat.find_enemy_near(plan.tiles[t * 2] + 0.5, plan.tiles[t * 2 + 1] + 0.5, owner, PATCH_SAFE) >= 0;
		if (foe) continue;
		// (a hole of a few tiles (a broken segment, a felled tree) is closed
		// with the last wood / gold)
		const bool hole = plan.new_tiles <= PATCH_HOLE;
		if (p.res[RES_WOOD] < plan.cost.v[RES_WOOD] + (hole ? 0 : 40) || p.res[RES_GOLD] < plan.cost.v[RES_GOLD] + (hole ? 0 : 15)) {
			hole_wait_ = hole; // (the academies wait for the few logs a hole takes)
			return;
		}
		FortResult res;
		const UnitStore &U = S.entities.units;
		std::vector<int> vills;
		for (int u = 0; u < U.size(); u++)
			if (!U.removed[u] && !U.dead[u] && U.owner[u] == owner && unit_def(U.type[u]).gatherer) vills.push_back(u);
		const int v = pick_builder(vills);
		std::vector<int> builders;
		if (v >= 0) builders.push_back(v);
		const std::vector<int32_t> ids = S.fortify.place_wall(owner, l[0], l[1], l[2], l[3], builders, res, true);
		if (!res.ok) return;
		fort.wall_tiles += plan.new_tiles;
		fort.patched += plan.new_tiles;
		for (int32_t id : ids) ring_ids_.push_back(id);
		return;
	}
}

// Can our men still walk out of the ring? If not (every opening given up,
// a building in one), the first straight segment with open ground on both
// sides becomes a gate (or, short of gold, is pulled down).
void EnemyAI::check_ring_open(int tc) {
	Sim &S = *sim;
	BuildingStore &B = S.entities.buildings;
	for (const AIGateGap &g : gaps_)
		if (g.state == 1) return; // (an opening is being filled: closed for a moment)
	Pathfinder &pf = S.pathfinder;
	int sx, sz;
	if (!pf.nearest_walkable((int)std::floor(B.x[tc]), (int)std::floor(B.z[tc]), 5, sx, sz)) return;
	const GameMap &map = S.map();
	const int R = ring_r_ + 4;
	const int dirs[4][2] = { { 0, -1 }, { 1, 0 }, { 0, 1 }, { -1, 0 } };
	const int keep = pf.pass_owner;
	pf.pass_owner = owner;
	bool open = false, tried = false;
	std::vector<Vec2d> path;
	for (int k = 0; k < 4 && !open; k++) {
		const int gx = ring_cx_ + dirs[k][0] * R, gz = ring_cz_ + dirs[k][1] * R;
		if (gx < 1 || gz < 1 || gx > map.size - 2 || gz > map.size - 2) continue; // (that side is the map's edge)
		int wx, wz;
		if (!pf.nearest_walkable(gx, gz, 3, wx, wz)) continue;
		tried = true;
		pf.find_path(sx + 0.5, sz + 0.5, wx + 0.5, wz + 0.5, nullptr, path);
		open = pf.last_found;
	}
	pf.pass_owner = keep;
	if (open || !tried) return;
	for (int32_t id : ring_ids_) {
		const int b = S.entities.building_slot(id);
		if (b < 0 || B.dead[b] || !B.built[b] || B.type[b] != B_WALL || std::max(B.w[b], B.h[b]) < 2) continue;
		const bool along_x = B.w[b] > B.h[b];
		const int mx = B.tx[b] + B.w[b] / 2, mz = B.tz[b] + B.h[b] / 2;
		const int ax = along_x ? mx : B.tx[b] - 1, az = along_x ? B.tz[b] - 1 : mz;
		const int bx = along_x ? mx : B.tx[b] + B.w[b], bz = along_x ? B.tz[b] + B.h[b] : mz;
		if (!map.is_walkable(ax, az) || !map.is_walkable(bx, bz)) continue;
		if (!S.fortify.convert_to_gate(id).ok) S.buildings.destroy(id);
		fort.reopened++;
		return;
	}
}

// An army of 8+ and a ring line waiting for wood or gold: the academies
// wait too (Hard / Titan would otherwise pour every log into men
// and never close the ring).
bool EnemyAI::wall_saving(int army) const {
	// (whether it is short or not: the academies would spend it before the
	// line is laid later in the same think)
	const bool line_wait = ring_state_ == 1 && !ring_lines_.empty() && line_wood_ > 0;
	// a line kept waiting LINE_PATIENCE s: the academies wait for it with
	// any army (a wave out leaves few men at home, and the ring would wait
	// for good while every log goes into soldiers)
	const bool overdue = line_wait && line_wait_since_ >= 0 && sim->time - line_wait_since_ >= LINE_PATIENCE;
	return hole_wait_ || overdue || (army >= 8 && (tower_wait_ || upgrade_wait_ || line_wait));
}

int EnemyAI::ring_unbuilt() const {
	const BuildingStore &B = sim->entities.buildings;
	int n = 0;
	for (int32_t id : ring_ids_) {
		const int b = sim->entities.building_slot(id);
		n += b >= 0 && !B.dead[b] && !B.built[b];
	}
	return n;
}

// ---- upkeep -------------------------------------------------------------------

void EnemyAI::upgrade(const std::vector<int> &buildings, bool saving) {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	Player &p = S.players[owner];
	upgrade_wait_ = false;
	if (saving) return;
	for (int line = 1; line >= 0; line--) {
		if (line == 1 ? !par.tower_upgrade : !par.wall_upgrade) continue;
		int tech = 0;
		for (int t = 1; t < FT_COUNT && !tech; t++)
			if (fort_tech_def(t).line == line && S.fortify.tech_state(owner, t) == 1) tech = t;
		if (!tech) continue;
		int at = -1;
		for (int b : buildings)
			if (B.built[b] && !B.fort_tech[b] && (line == 1 ? B.type[b] == B_TOWER : is_wall_piece(B.type[b]))) { at = b; break; }
		if (at < 0) continue;
		const Cost c = civ_fort_tech_cost(S.civs.civ(owner), tech); // (sim/civ: the Egyptians' own prices)
		if (p.res[RES_WOOD] < c.v[RES_WOOD] + UPGRADE_KEEP_WOOD || p.res[RES_GOLD] < c.v[RES_GOLD] + UPGRADE_KEEP_GOLD) {
			// (Godot AI: the academies wait a while for it, more hands on
			// gold; then it is bought whenever there is enough to spare)
			if (upgrade_wait_t_ < UPGRADE_WAIT) {
				upgrade_wait_ = true;
				upgrade_wait_t_ += par.think;
				fort.upgrade_holds++;
				want_gold_ = want_gold_ || p.res[RES_GOLD] < c.v[RES_GOLD] + UPGRADE_KEEP_GOLD;
			}
			return; // (one tech at a time: the tower's first)
		}
		if (S.fortify.research(B.id[at], tech).ok) {
			fort.upgrades++;
			upgrade_wait_t_ = 0;
		}
		return;
	}
}

void EnemyAI::repair(const std::vector<int> &vills, const std::vector<int> &buildings) {
	Sim &S = *sim;
	const UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	if (par.repairers <= 0) return;
	int on = 0;
	for (int v : vills) {
		if (U.order_type[v] != O_BUILD) continue;
		const int b = S.entities.building_slot(U.order_target[v]);
		on += b >= 0 && B.built[b];
	}
	if (on >= par.repairers) return;
	// the most damaged piece (fortifications and the Town Center first) with no foe at hand
	int best = -1;
	double bs = REPAIR_BELOW;
	for (int b : buildings) {
		if (!B.built[b] || B.max_hp[b] <= 0) continue;
		double share = B.hp[b] / B.max_hp[b];
		if (!is_fort_type(B.type[b]) && B.type[b] != B_TOWN_CENTER) share += 0.15;
		if (share >= bs) continue;
		if (S.combat.find_enemy_near(B.x[b], B.z[b], owner, REPAIR_SAFE + B.radius[b]) >= 0) continue;
		bs = share;
		best = b;
	}
	if (best < 0) return;
	const int32_t id = B.id[best];
	while (on < par.repairers) {
		int v = -1;
		double vd = INFINITY;
		for (int u : vills) {
			if (U.order_type[u] != O_GATHER && U.order_type[u] != O_IDLE) continue;
			if (U.order_type[u] == O_GATHER && U.econ_res_type[u] == RES_FOOD) continue; // (farmers stay)
			const double d = box_dist(B, best, U.x[u], U.z[u]);
			if (d < vd) {
				vd = d;
				v = u;
			}
		}
		if (v < 0) break;
		send_build(S, v, id);
		fort.repairs++;
		on++;
	}
}

// ---- attacking fortifications ----------------------------------------------------

int EnemyAI::towers_covering(double x, double z, double margin) const {
	int need = 0;
	for (const FoeTower &t : foe_towers_) {
		const double dx = t.x - x, dz = t.z - z, r = t.reach + margin;
		if (dx * dx + dz * dz <= r * r) need += t.need;
	}
	return need;
}

// The wave's target: the nearest enemy building (not a wall) whose towers
// it can take (men >= men_per_tower each); none: the nearest one if the wave
// is overdue, else -1 (hold the wave for more men).
int EnemyAI::pick_target(int tc, int men, bool overdue) {
	Sim &S = *sim;
	const bool fear = par.tower_fear && S.time < FEAR_UNTIL && !foe_towers_.empty();
	const int nearest = find_target(tc);
	if (!fear || nearest < 0 || towers_covering(S.entities.buildings.x[nearest], S.entities.buildings.z[nearest], 1) <= men) return nearest;
	const BuildingStore &B = S.entities.buildings;
	int best = -1;
	double bd = INFINITY;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !sim->is_enemy(owner, B.owner[b]) || is_wall_piece(B.type[b])) continue;
		const double dx = B.x[b] - B.x[tc], dz = B.z[b] - B.z[tc];
		const double d = dx * dx + dz * dz;
		if (d >= bd || towers_covering(B.x[b], B.z[b], 1) > men) continue;
		bd = d;
		best = b;
	}
	fort.avoided++;
	if (best >= 0) return best;
	return overdue ? nearest : -1;
}

// A wave worn down inside enemy tower range falls back home (once per wave).
void EnemyAI::avoid_towers() {
	Sim &S = *sim;
	if (!par.tower_fear || S.time >= FEAR_UNTIL || foe_towers_.empty() || waves.empty() || fear_wave_ >= waves.size()) return;
	const WaveLog &w = waves.back();
	if (S.time - w.t < 20) return;
	const UnitStore &U = S.entities.units;
	std::vector<int> men;
	double sx = 0, sz = 0;
	for (int32_t id : w.units) {
		const int r = S.entities.unit_slot(id);
		if (r < 0 || U.dead[r] || U.removed[r] || U.owner[r] != owner) continue;
		if (U.order_type[r] != O_ATTACK && U.order_type[r] != O_ATTACK_MOVE) continue;
		men.push_back(r);
		sx += U.x[r];
		sz += U.z[r];
	}
	if (men.empty()) {
		fear_wave_ = waves.size();
		return;
	}
	const int n = (int)men.size();
	const double mx = sx / n, mz = sz / n;
	const int need = towers_covering(mx, mz, 2);
	if (need == 0 || n >= need || n * 2 > (int)w.units.size()) return;
	// (keep fighting if they are nearly through: the target in reach)
	const int ts = S.entities.building_slot(w.target);
	if (ts >= 0 && !S.entities.buildings.dead[ts] && jsm::hypot(S.entities.buildings.x[ts] - mx, S.entities.buildings.z[ts] - mz) < 5) return;
	int tc = -1;
	const BuildingStore &B = S.entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner && B.type[b] == B_TOWN_CENTER) { tc = b; break; }
	if (tc < 0) return;
	S.commands.move(men, B.x[tc] + 4, B.z[tc] + 4, O_MOVE);
	fear_wave_ = waves.size();
	fort.retreats++;
}

// Breakers close together (FOCUS_CLUSTER) all go for one of the pieces the
// sim's breach rule gave them: the weakest, closest to the group; once
// picked, a piece stays the group's until it falls (breach_picks_); men
// within FOCUS_REACH of it walk along the wall to it.
void EnemyAI::focus_breach(const std::vector<int> &army) {
	Sim &S = *sim;
	if (S.fortify.walls == 0) {
		breach_picks_.clear();
		return;
	}
	UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	// forget the pieces that fell
	breach_picks_.erase(std::remove_if(breach_picks_.begin(), breach_picks_.end(), [&](int32_t id) {
		const int b = S.entities.building_slot(id);
		return b < 0 || B.dead[b];
	}), breach_picks_.end());
	std::vector<int> br;
	for (int u : army) {
		if (U.order_type[u] != O_ATTACK || !(U.order_b[u] & ATK_BREACH)) continue;
		const int b = S.entities.building_slot(U.order_target[u]);
		if (b >= 0 && !B.dead[b] && is_wall_piece(B.type[b])) br.push_back(u);
	}
	if (br.size() < 2) return;
	std::vector<uint8_t> done(br.size(), 0);
	std::vector<size_t> group;
	for (size_t i = 0; i < br.size(); i++) {
		if (done[i]) continue;
		group.clear();
		double sx = 0, sz = 0;
		for (size_t j = i; j < br.size(); j++) {
			if (done[j] || jsm::hypot(U.x[br[j]] - U.x[br[i]], U.z[br[j]] - U.z[br[i]]) > FOCUS_CLUSTER) continue;
			done[j] = 1;
			group.push_back(j);
			sx += U.x[br[j]];
			sz += U.z[br[j]];
		}
		if (group.size() < 2) continue;
		const double mx = sx / group.size(), mz = sz / group.size();
		int32_t pick = 0;
		// a piece picked before, still standing, that one of them is on
		for (int32_t id : breach_picks_)
			for (size_t j : group)
				if (!pick && U.order_target[br[j]] == id) pick = id;
		if (!pick) {
			double ps = INFINITY;
			for (size_t j : group) {
				const int32_t id = U.order_target[br[j]];
				const int b = S.entities.building_slot(id);
				int on = 0;
				for (size_t k : group) on += U.order_target[br[k]] == id;
				// hp left, worse the further from the group; pieces already
				// being hit by many count as weaker
				const double score = B.hp[b] * (1 + box_dist(B, b, mx, mz) / 4) / (1 + 2.0 * on / group.size());
				if (score < ps) {
					ps = score;
					pick = id;
				}
			}
			breach_picks_.push_back(pick);
		}
		const int pb = S.entities.building_slot(pick);
		for (size_t j : group) {
			const int u = br[j];
			if (U.order_target[u] == pick || box_dist(B, pb, U.x[u], U.z[u]) > FOCUS_REACH) continue;
			U.order_target[u] = pick;
			U.am_lost[u] = 0;
			S.combat.approach(u, pick);
			U.order_x[u] = 0.6;
			fort.focus++;
		}
	}
}

// Our men out attacking (not at home) are grouped (SIEGE_CLUSTER); a group
// whose nearest enemy building cannot be walked to (pass_owner = us: enemy
// gates closed, our allies' open) and that stands by an enemy wall is set on
// one piece of it: the weakest, closest to the group and to that building,
// one they can walk up to (the piece picked before stays the group's till it
// falls). Each man keeps the building as his real target (order_a,
// ATK_BREACH): the sim sends him back to it once the piece is down, through
// the hole. A man fighting an enemy unit at hand keeps fighting. A group
// with an open way (a gap, an allied gate) is left to walk it.
void EnemyAI::siege(const std::vector<int> &army, int tc) {
	Sim &S = *sim;
	UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	// forget the pieces that fell (and count the ones that fell to us)
	siege_picks_.erase(std::remove_if(siege_picks_.begin(), siege_picks_.end(), [&](int32_t id) {
		const int b = S.entities.building_slot(id);
		if (b < 0 || B.dead[b]) fort.breached++;
		return b < 0 || B.dead[b];
	}), siege_picks_.end());
	siege_t_ -= par.think;
	if (siege_t_ > 0 || S.fortify.walls == 0) return;
	siege_t_ = SIEGE_EVERY;
	// a picked piece whose hp has not gone down for SIEGE_STALL s (our men
	// cannot get at it: crowded out, ground taken round it) is given up for
	// SIEGE_BAN s; the next check picks another
	siege_ban_.erase(std::remove_if(siege_ban_.begin(), siege_ban_.end(), [&](const std::pair<int32_t, double> &kv) { return S.time >= kv.second; }), siege_ban_.end());
	auto banned = [&](int32_t id) {
		for (const auto &kv : siege_ban_)
			if (kv.first == id) return true;
		return false;
	};
	siege_watch_.erase(std::remove_if(siege_watch_.begin(), siege_watch_.end(), [&](const SiegeWatch &w) {
		return std::find(siege_picks_.begin(), siege_picks_.end(), w.id) == siege_picks_.end();
	}), siege_watch_.end());
	for (int32_t id : siege_picks_) {
		const int b = S.entities.building_slot(id);
		if (b < 0) continue;
		bool seen = false;
		for (SiegeWatch &w : siege_watch_) {
			if (w.id != id) continue;
			seen = true;
			if (B.hp[b] < w.hp - 1) {
				w.hp = B.hp[b];
				w.since = S.time;
			} else if (S.time - w.since > SIEGE_STALL && !banned(id))
				siege_ban_.push_back({ id, S.time + SIEGE_BAN });
		}
		if (!seen) siege_watch_.push_back({ id, B.hp[b], S.time });
	}
	siege_picks_.erase(std::remove_if(siege_picks_.begin(), siege_picks_.end(), [&](int32_t id) { return banned(id); }), siege_picks_.end());
	breach_picks_.erase(std::remove_if(breach_picks_.begin(), breach_picks_.end(), [&](int32_t id) { return banned(id); }), breach_picks_.end());
	std::vector<int> men;
	for (int u : army) {
		if (U.order_type[u] != O_ATTACK && U.order_type[u] != O_ATTACK_MOVE) continue;
		if (jsm::hypot(U.x[u] - B.x[tc], U.z[u] - B.z[tc]) < SIEGE_HOME) continue;
		men.push_back(u);
	}
	if (men.empty()) return;
	ScopedTimer tm(S.prof.enabled ? &S.prof.sub["ai.siege"] : nullptr);
	Pathfinder &pf = S.pathfinder;
	const int keep = pf.pass_owner;
	const GameMap &map = S.map();
	// can man u walk straight to unit e (no wall between them)?
	auto in_line = [&](int u, int e) {
		const int ax = map.tile_clamp(U.x[u]), az = map.tile_clamp(U.z[u]), bx = map.tile_clamp(U.x[e]), bz = map.tile_clamp(U.z[e]);
		if (!map.walkable_for(ax, az, owner)) return true;
		pf.pass_owner = owner;
		const bool ok = pf.line_walkable(az * map.size + ax, bz * map.size + bx);
		pf.pass_owner = keep;
		return ok;
	};
	std::vector<uint8_t> done(men.size(), 0);
	std::vector<int> group;
	std::vector<Vec2d> path;
	struct Cand { int b; double score; };
	std::vector<Cand> cands;
	bool searched = false, searched_alt = false;
	for (size_t i = 0; i < men.size(); i++) {
		if (done[i]) continue;
		group.clear();
		double sx = 0, sz = 0;
		for (size_t j = i; j < men.size(); j++) {
			if (done[j] || jsm::hypot(U.x[men[j]] - U.x[men[i]], U.z[men[j]] - U.z[men[i]]) > SIEGE_CLUSTER) continue;
			done[j] = 1;
			group.push_back(men[j]);
			sx += U.x[men[j]];
			sz += U.z[men[j]];
		}
		if (group.size() < 2) continue;
		const double mx = sx / group.size(), mz = sz / group.size();
		// (only a group held up by a wall: one of them walled off from his
		// target, or at a wall piece; marching men need no search)
		bool held = false;
		for (int u : group) {
			const int32_t cur = U.order_type[u] == O_ATTACK ? U.order_target[u] : 0;
			const int cb = cur && S.entities.kind(cur) == K_BUILDING ? S.entities.building_slot(cur) : -1;
			held = held || U.path_blocked[u] || (cb >= 0 && is_wall_piece(B.type[cb]));
		}
		if (!held) continue;
		// an enemy wall about?
		bool wall_near = false;
		for (int b = 0; b < B.size() && !wall_near; b++)
			wall_near = !B.removed[b] && !B.dead[b] && is_wall_piece(B.type[b]) && sim->is_enemy(owner, B.owner[b]) && box_dist(B, b, mx, mz) <= SIEGE_SCAN;
		if (!wall_near) continue;
		// the building they are after: the one most of them are attacking
		// (a breaker's real target), else the nearest enemy one (not a wall)
		int tb = -1, votes = 0;
		for (int u : group) {
			int32_t id = U.order_type[u] == O_ATTACK ? U.order_target[u] : 0;
			if (id && (U.order_b[u] & ATK_BREACH)) id = U.order_a[u];
			const int b = id && S.entities.kind(id) == K_BUILDING ? S.entities.building_slot(id) : -1;
			if (b < 0 || B.dead[b] || is_wall_piece(B.type[b]) || b == tb) continue;
			int n = 0;
			for (int v : group) {
				int32_t vid = U.order_type[v] == O_ATTACK ? U.order_target[v] : 0;
				if (vid && (U.order_b[v] & ATK_BREACH)) vid = U.order_a[v];
				n += vid == id;
			}
			if (n > votes) {
				votes = n;
				tb = b;
			}
		}
		double td = INFINITY;
		const bool voted = tb >= 0;
		for (int b = 0; b < B.size() && !voted; b++) {
			if (B.removed[b] || B.dead[b] || is_wall_piece(B.type[b]) || !sim->is_enemy(owner, B.owner[b])) continue;
			const double d = box_dist(B, b, mx, mz);
			if (d < td) {
				td = d;
				tb = b;
			}
		}
		if (tb < 0) continue;
		int stx, stz;
		if (!pf.nearest_walkable((int)std::floor(mx), (int)std::floor(mz), 4, stx, stz)) continue;
		pf.pass_owner = owner;
		const GoalRect tr{ (double)B.tx[tb], (double)B.tz[tb], (double)B.w[tb], (double)B.h[tb] };
		pf.find_path(stx + 0.5, stz + 0.5, B.x[tb], B.z[tb], &tr, path);
		const bool open = pf.last_found;
		pf.pass_owner = keep;
		if (open) continue; // (a way in: they walk it)
		// (bowmen alone cannot break a wall, and it is repaired under their
		// arrows: they go home to march with the next wave)
		int melee = 0;
		for (int u : group) melee += !unit_def(U.type[u]).attack.projectile;
		if (melee == 0) {
			S.commands.move(group, B.x[tc] + 4, B.z[tc] + 4, O_MOVE);
			fort.regroups++;
			continue;
		}
		// most of them on a piece picked before, still standing: keep it (no search)
		int pick = -1;
		for (int32_t id : siege_picks_) {
			int on = 0;
			for (int u : group) on += U.order_type[u] == O_ATTACK && U.order_target[u] == id;
			const int b = S.entities.building_slot(id);
			if (on * 2 >= (int)group.size() && b >= 0 && !B.dead[b]) {
				pick = b;
				break;
			}
		}
		if (pick < 0) {
			// (one group's search per check: the others wait for the next)
			if (searched) continue;
			searched = true;
			// the pieces about them: weakest, closest to them and to the building
			cands.clear();
			for (int b = 0; b < B.size(); b++) {
				if (B.removed[b] || B.dead[b] || !is_wall_piece(B.type[b]) || !sim->is_enemy(owner, B.owner[b])) continue;
				const double d = box_dist(B, b, mx, mz);
				if (d > SIEGE_FAR || !breach_opens(S, b, owner) || banned(B.id[b])) continue;
				double score = B.hp[b] * (1 + d / 6) + 25 * box_dist(B, tb, B.x[b], B.z[b]);
				for (int32_t id : siege_picks_)
					if (id == B.id[b]) score *= 0.4; // (stick to the piece already under attack)
				cands.push_back({ b, score });
			}
			std::stable_sort(cands.begin(), cands.end(), [](const Cand &a, const Cand &b) { return a.score < b.score; });
			// the first they can walk up to (a wide search: the way round a
			// forest to the wall's outer face can be long; most of a ring
			// backed by a forest fails at once, a region cut)
			pf.pass_owner = owner;
			const int keep_nodes = pf.max_nodes;
			pf.max_nodes = std::max(keep_nodes, SIEGE_NODES);
			const int64_t exp0 = pf.expanded_total;
			for (size_t k = 0; k < cands.size() && k < SIEGE_TRIES && pick < 0 && pf.expanded_total - exp0 < SIEGE_BUDGET; k++) {
				const int b = cands[k].b;
				const GoalRect r{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
				pf.find_path(stx + 0.5, stz + 0.5, B.x[b], B.z[b], &r, path);
				if (pf.last_found) pick = b;
			}
			pf.max_nodes = keep_nodes;
			pf.pass_owner = keep;
		}
		if (pick < 0) {
			// no piece they can get at (a ring backed by forest, crowded,
			// repaired under their blows): another enemy building they can
			// walk to, the Town Center first, the nearest after it (no
			// stalemate before an unreachable barracks)
			if (searched_alt) continue;
			searched_alt = true;
			cands.clear();
			for (int b = 0; b < B.size(); b++) {
				if (B.removed[b] || B.dead[b] || is_wall_piece(B.type[b]) || b == tb || !sim->is_enemy(owner, B.owner[b])) continue;
				cands.push_back({ b, (B.type[b] == B_TOWN_CENTER ? 0 : 1000) + box_dist(B, b, mx, mz) });
			}
			std::stable_sort(cands.begin(), cands.end(), [](const Cand &a, const Cand &b) { return a.score < b.score; });
			int alt = -1;
			pf.pass_owner = owner;
			const int64_t exp0 = pf.expanded_total;
			for (size_t k = 0; k < cands.size() && k < SIEGE_ALT_TRIES && alt < 0 && pf.expanded_total - exp0 < SIEGE_BUDGET; k++) {
				const int b = cands[k].b;
				const GoalRect r{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
				pf.find_path(stx + 0.5, stz + 0.5, B.x[b], B.z[b], &r, path);
				if (pf.last_found) alt = b;
			}
			pf.pass_owner = keep;
			if (alt < 0) continue;
			int turned = 0;
			for (int u : group) {
				if (!U.path_blocked[u] && !(U.order_type[u] == O_ATTACK && U.order_target[u] == B.id[tb])) continue;
				Order o = Order::with_target(O_ATTACK, B.id[alt]);
				o.b = ATK_THEN_BUILDINGS;
				turned += S.commands.order(u, o);
			}
			fort.retargets += turned > 0;
			continue;
		}
		const int32_t pid = B.id[pick];
		if (std::find(siege_picks_.begin(), siege_picks_.end(), pid) == siege_picks_.end()) siege_picks_.push_back(pid);
		if (std::find(breach_picks_.begin(), breach_picks_.end(), pid) == breach_picks_.end()) breach_picks_.push_back(pid);
		// the archers shoot the foes at the piece (its repairers, men behind
		// it: arrows go over a wall) or the piece itself; the rest break it
		const int foe = S.combat.find_enemy_near(B.x[pick], B.z[pick], owner, SIEGE_COVER);
		const int32_t foe_id = foe >= 0 ? U.id[foe] : 0;
		// (at most SIEGE_ON men on the piece: the others are left to what
		// they are doing; a man is turned only if he is stuck at the wall:
		// walled off, or on another piece / a building behind it)
		int on = 0;
		for (int u : group) on += U.order_type[u] == O_ATTACK && U.order_target[u] == pid;
		int turned = 0;
		for (int u : group) {
			const bool archer = unit_def(U.type[u]).attack.projectile;
			// (a foe in bow range now: no walk after a man behind the wall)
			const bool shoot = archer && foe_id && jsm::hypot(U.x[foe] - U.x[u], U.z[foe] - U.z[u]) <= S.combat.range_of(u) + 0.5;
			const int32_t want = shoot ? foe_id : pid;
			if (U.order_type[u] == O_ATTACK && (U.order_target[u] == pid || U.order_target[u] == want)) continue;
			const int32_t cur = U.order_type[u] == O_ATTACK ? U.order_target[u] : 0;
			const int cb = cur && S.entities.kind(cur) == K_BUILDING ? S.entities.building_slot(cur) : -1;
			const bool stuck = U.path_blocked[u] || (cb >= 0 && (is_wall_piece(B.type[cb]) || cur == B.id[tb]));
			if (!stuck) continue;
			if (want == pid && on >= SIEGE_ON) continue;
			// (a man fighting an enemy unit he can get at keeps fighting)
			if (U.order_type[u] == O_ATTACK && S.entities.kind(U.order_target[u]) == K_UNIT) {
				const int e = S.entities.unit_slot(U.order_target[u]);
				if (e >= 0 && !U.dead[e] && jsm::hypot(U.x[e] - U.x[u], U.z[e] - U.z[u]) < S.combat.range_of(u) + 3 && (archer || in_line(u, e))) continue;
			}
			on += want == pid;
			Order o = Order::with_target(O_ATTACK, want);
			if (want == pid) {
				o.a = B.id[tb];
				o.b = ATK_BREACH | ATK_THEN_BUILDINGS;
			} else
				o.b = ATK_THEN_BUILDINGS;
			if (S.commands.order(u, o)) turned++;
		}
		if (turned) {
			fort.sieges++;
			fort.sieged += turned;
		}
	}
}

// ---- the stress scene: a fortified town at once -------------------------------------

int EnemyAI::fortify_now(int towers) {
	Sim &S = *sim;
	if (!S.godot_rules) return 0;
	const BuildingStore &B = S.entities.buildings;
	int tc = -1;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner && B.type[b] == B_TOWN_CENTER) { tc = b; break; }
	if (tc < 0) return 0;
	const int before = (int)ring_ids_.size() + fort.towers;
	if (plan_ring(tc)) {
		fort.ring_at = S.time;
		std::vector<int> none;
		while (!ring_lines_.empty())
			if (!place_ring_line(true, none) && !ring_lines_.empty()) break; // (out of resources)
		ring_state_ = 2;
		ring_gates(true);
		if (ring_state_ != 3) ring_state_ = 2;
	}
	std::vector<int> none;
	for (int k = 0; k < towers; k++) build_tower(tc, none, true);
	return (int)ring_ids_.size() + fort.towers - before;
}

} // namespace aov
