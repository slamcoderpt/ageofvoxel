// Port of src/buildings/index.js (sim side) and placement.js confirm().
#include "buildings.h"

#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

void Buildings::init(Sim *s) {
	sim = s;
	s->commands.register_handler(O_BUILD, [this](int r, const Order &o) {
		Entities &E = sim->entities;
		const int b = E.building_slot(o.target);
		const BuildingStore &B = E.buildings;
		if (b < 0 || B.owner[b] != E.units.owner[r]) return false;
		if (B.built[b] && !(sim->godot_rules && !B.dead[b] && B.hp[b] < B.max_hp[b])) return false; // (Godot-only: repair)
		GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
		sim->movement.move_to(r, B.x[b], B.z[b], &g);
		return true;
	});
}

int Buildings::ground_at(int tx, int tz) const {
	const GameMap &m = sim->map();
	const int c = m.cps;
	return m.in_cols(tx * c, tz * c) ? m.ground[m.c_idx(tx * c, tz * c)] : -1;
}

bool Buildings::in_footprint(int x, int z) const {
	const BuildingStore &B = sim->entities.buildings;
	for (int o = 0; o < B.size(); o++)
		if (!B.removed[o] && x >= B.tx[o] && x < B.tx[o] + B.w[o] && z >= B.tz[o] && z < B.tz[o] + B.h[o]) return true;
	return false;
}

// Paint a paved plaza (irregular disc) around a building, skipping tiles
// that are blocked, water or other buildings' footprints.
void Buildings::pave_plaza(int tx, int tz, int w, int h, double r) {
	GameMap &map = sim->map();
	const double cx = tx + w / 2.0, cz = tz + h / 2.0;
	const double R = std::max(w, h) / 2.0 + r;
	for (int z = (int)std::floor(cz - R); z <= (int)std::ceil(cz + R); z++)
		for (int x = (int)std::floor(cx - R); x <= (int)std::ceil(cx + R); x++) {
			const double dx = x + 0.5 - cx, dz = z + 0.5 - cz;
			const double d = jsm::hypot(dx, dz) + (hash3(x, 3, z, 41) - 0.5) * 1.6;
			if (d > R) continue;
			if (!map.is_walkable(x, z)) continue;
			if (!in_footprint(x, z)) map.paint_tiles(x, z, 1, 1, PAVED);
		}
}

// Worn-earth yard around a building: only over grass, never over paving,
// farms or other footprints. (JS quirk kept: with a fractional radius the
// loops run over fractional tiles, which are never walkable, so the yard is
// a no-op; that is the Military Academy's 1.6.)
void Buildings::yard(int tx, int tz, int w, int h, double r) {
	if (r != std::floor(r)) return;
	const int ri = (int)r;
	GameMap &map = sim->map();
	for (int z = tz - ri; z < tz + h + ri; z++)
		for (int x = tx - ri; x < tx + w + ri; x++) {
			// rounded, ragged edge rather than a speckle
			const int ex = std::max(std::max(tx - x, x - (tx + w - 1)), 0), ez = std::max(std::max(tz - z, z - (tz + h - 1)), 0);
			if (jsm::hypot(ex, ez) + hash3(x, 5, z, 43) * 1.4 > r + 0.3) continue;
			if (!map.is_walkable(x, z)) continue;
			const int g = ground_at(x, z);
			if (g != GRASS && g != DRYGRASS) continue;
			if (in_footprint(x, z)) continue;
			map.paint_tiles(x, z, 1, 1, DIRT);
		}
}

// A 2-tile paved street from a building's door (+z side) to the nearest
// town centre of the same owner.
void Buildings::pave_street(int b) {
	GameMap &map = sim->map();
	const BuildingStore &B = sim->entities.buildings;
	int tc = -1;
	double best = INFINITY;
	for (int o = 0; o < B.size(); o++) {
		if (B.removed[o] || B.type[o] != B_TOWN_CENTER || B.owner[o] != B.owner[b] || o == b) continue;
		const double d = jsm::hypot(B.x[o] - B.x[b], B.z[o] - B.z[b]);
		if (d < best) { best = d; tc = o; }
	}
	if (tc < 0 || best > 26) return;
	auto paint = [&](int x, int z) {
		static const int OFF[4][2] = { { 0, 0 }, { 1, 0 }, { 0, 1 }, { 1, 1 } };
		for (const auto &o : OFF) {
			const int X = x + o[0], Z = z + o[1];
			if (!map.is_walkable(X, Z) || in_footprint(X, Z)) continue;
			const int g = ground_at(X, Z);
			if (g == FARM || g == SAND || g == ROCK || g < 0) continue;
			map.paint_tiles(X, Z, 1, 1, PAVED);
		}
	};
	// door point: middle of the front edge, one tile out
	int x = (int)std::floor(B.tx[b] + B.w[b] / 2.0) - 1, z = B.tz[b] + B.h[b];
	// target: nearest point on the TC plaza edge
	const int gx = std::max(B.tx[tc] - 1, std::min(B.tx[tc] + B.w[tc] - 1, x));
	const int gz = std::max(B.tz[tc] - 1, std::min(B.tz[tc] + B.h[tc] - 1, z));
	// leave the door by 2 tiles, then run along x, then z
	const int z1 = gz > z ? z + 2 : z;
	for (; z < z1; z++) paint(x, z);
	const int sx = (gx > x) - (gx < x);
	for (; x != gx; x += sx) paint(x, z);
	const int sz = (gz > z) - (gz < z);
	for (; z != gz; z += sz) paint(x, z);
	paint(x, z);
}

// Cobbled roads leaving a town centre's plaza in the four directions, with
// worn-earth shoulders.
void Buildings::pave_roads(int t) {
	GameMap &map = sim->map();
	const BuildingStore &B = sim->entities.buildings;
	const int ttx = B.tx[t], ttz = B.tz[t];
	const int cx = (int)std::floor(ttx + B.w[t] / 2.0) - 1, cz = (int)std::floor(ttz + B.h[t] / 2.0) - 1;
	auto set = [&](int x, int z, int g) {
		if (!map.is_walkable(x, z) || in_footprint(x, z)) return;
		const int cur = ground_at(x, z);
		if (cur < 0 || cur == FARM || cur == SAND || cur == ROCK) return;
		if (g == DIRT && cur == PAVED) return;
		map.paint_tiles(x, z, 1, 1, g);
	};
	static const int DIRS[4][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
	for (const auto &dd : DIRS) {
		const int dx = dd[0], dz = dd[1];
		const int len = 20 + (int)std::floor(hash3(ttx + dx, 11, ttz + dz, 47) * 6);
		int wob = 0;
		for (int i = 0; i < len; i++) {
			if (i % 5 == 4) wob = std::max(-1, std::min(1, wob + (hash3(i, dx, dz, 48) < 0.5 ? -1 : 1)));
			const int ox = dz != 0 ? wob : 0, oz = dx != 0 ? wob : 0;
			const int x = cx + dx * i + ox, z = cz + dz * i + oz;
			const int px = dz != 0 ? 1 : 0, pz = dx != 0 ? 1 : 0; // perpendicular
			const bool tail = i > len - 4;                            // road frays out
			for (int k = -1; k <= 2; k++) {
				const int X = x + px * k, Z = z + pz * k;
				const bool edge = k == -1 || k == 2;
				if (edge) {
					if (hash3(X, 12, Z, 49) < 0.75) set(X, Z, DIRT);
				} else set(X, Z, tail && hash3(X, 13, Z, 50) < 0.5 ? DIRT : PAVED);
			}
		}
	}
}

bool Buildings::can_place(int type, int tx, int tz) const {
	if (type < 0 || type >= B_TYPE_COUNT) return false;
	const BuildingDef &def = building_def(type);
	const GameMap &map = sim->map();
	for (int z = tz; z < tz + def.h; z++)
		for (int x = tx; x < tx + def.w; x++)
			if (!map.is_walkable(x, z)) return false;
	const GameMap::RectStats st = map.tile_rect_stats(tx, tz, def.w, def.h);
	if (st.water || st.max - st.min > 3) return false;
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && B.tx[b] < tx + def.w && B.tx[b] + B.w[b] > tx && B.tz[b] < tz + def.h && B.tz[b] + B.h[b] > tz) return false;
	return true;
}

int Buildings::variant_of(int b) {
	BuildingStore &B = sim->entities.buildings;
	if (B.bld_variant[b] >= 0) return B.bld_variant[b];
	const int n = building_def(B.type[b]).variants;
	int v = 0;
	if (n > 1) {
		// least-used variant among this owner's same-type buildings nearby
		// (closest ones weigh most), ties broken by a tile hash
		std::vector<double> score((size_t)n, 0.0);
		for (int o = 0; o < B.size(); o++) {
			if (B.removed[o] || o == b || B.type[o] != B.type[b] || B.bld_variant[o] < 0) continue;
			const double d = jsm::hypot(B.x[o] - B.x[b], B.z[o] - B.z[b]);
			if (d >= 30) continue;
			const double wgt = 1 + (30 - d) / 30;
			const int ov = B.bld_variant[o];
			for (int c = 0; c < n; c++) {
				if (c == ov) { score[c] += 2 * wgt; continue; }
				if (B.type[b] != B_HOUSE) continue;
				if (c % HOUSE_PLANS == ov % HOUSE_PLANS) score[c] += 0.7 * wgt;
				if (c / HOUSE_PLANS == ov / HOUSE_PLANS) score[c] += 0.35 * wgt;
			}
		}
		const int start = (int)std::floor(hash3(B.tx[b], 7, B.tz[b], 31) * n) % n;
		double best = INFINITY;
		for (int i = 0; i < n; i++) {
			const int c = (start + i) % n;
			if (score[c] < best - 1e-6) { best = score[c]; v = c; }
		}
	}
	B.bld_variant[b] = v;
	return v;
}

int Buildings::spawn(int type, int owner, int tx, int tz, bool built, bool site) {
	const BuildingDef &def = building_def(type);
	GameMap &map = sim->map();
	Entities &E = sim->entities;
	sim->clear_rect(tx, tz, def.w, def.h);
	map.flatten_tiles(tx, tz, def.w, def.h, INT32_MIN, def.farm ? FARM : type == B_TOWN_CENTER || type == B_TEMPLE ? PAVED : DIRT);
	if (!site) { /* ground laid out by the caller */ }
	else if (type == B_TOWN_CENTER) pave_plaza(tx, tz, def.w, def.h, 5.5);
	else if (type == B_TEMPLE) pave_plaza(tx, tz, def.w, def.h, 3);
	// houses and storehouses sit on their own worn-earth lot (no paving)
	const bool lot = type == B_HOUSE || type == B_STOREHOUSE;
	if (site && !def.farm) yard(tx, tz, def.w, def.h, type == B_TOWN_CENTER ? 0 : type == B_TEMPLE ? 2 : lot ? 1 : 1.6);
	// houses and storehouses: a paved forecourt across the front (+z)
	if (site && lot) {
		for (int x = tx; x < tx + def.w; x++) {
			if (!map.is_walkable(x, tz + def.h) || in_footprint(x, tz + def.h)) continue;
			const int g = ground_at(x, tz + def.h);
			if (g == FARM || g == SAND || g == ROCK || g < 0) continue;
			map.paint_tiles(x, tz + def.h, 1, 1, PAVED);
		}
	}
	const int b = E.new_building();
	BuildingStore &B = E.buildings;
	B.type[b] = (uint8_t)type;
	B.owner[b] = (uint8_t)owner;
	B.tx[b] = tx;
	B.tz[b] = tz;
	B.w[b] = def.w;
	B.h[b] = def.h;
	B.x[b] = tx + def.w / 2.0;
	B.z[b] = tz + def.h / 2.0;
	B.rot[b] = 0;
	B.hp[b] = built ? def.hp : std::max(1.0, def.hp * 0.1);
	B.max_hp[b] = def.hp;
	B.built[b] = built;
	B.progress[b] = built ? 1 : 0;
	B.sight[b] = def.sight;
	B.radius[b] = std::max(def.w, def.h) / 2.0;
	B.def_flags[b] = (def.worship ? BF_WORSHIP : 0) | (def.farm ? BF_FARM : 0) | (def.dropoff ? BF_DROPOFF : 0);
	const int32_t id = B.id[b];
	variant_of(b);
	if (type == B_HOUSE) {
		const double hh = hash3(tx, 17, tz, 91);
		const int q = hh < 0.5 ? 0 : hh < 0.72 ? 1 : hh < 0.92 ? -1 : 2;
		B.bld_yaw[b] = q * 3.141592653589793 / 2 + (hash3(tx, 18, tz, 92) - 0.5) * 0.09;
		B.bld_setback[b] = std::floor(hash3(tx, 19, tz, 93) * 3) * 0.2;
	}
	E.added(id);
	if (!def.walkable) map.block(tx, tz, def.w, def.h, id);
	if (site && !def.farm && type != B_TOWN_CENTER) pave_street(b);
	if (site && type == B_TOWN_CENTER) pave_roads(b);
	// nudge any units standing inside the footprint out of it
	UnitStore &U = E.units;
	if (!def.walkable)
		for (int u = 0; u < U.size(); u++) {
			if (U.removed[u]) continue;
			if (U.x[u] >= tx && U.x[u] < tx + def.w && U.z[u] >= tz && U.z[u] < tz + def.h) {
				int wx, wz;
				if (sim->pathfinder.nearest_walkable((int)std::floor(U.x[u]), (int)std::floor(U.z[u]), 8, wx, wz)) {
					U.x[u] = wx + 0.5;
					U.z[u] = wz + 0.5;
				}
			}
		}
	Event e;
	e.type = EV_BUILDING_PLACED;
	e.kind = K_BUILDING;
	e.id = id;
	e.owner = owner;
	e.a = type;
	e.x = B.x[b];
	e.z = B.z[b];
	sim->events.emit(e);
	if (built) {
		e.type = EV_BUILDING_COMPLETED;
		sim->events.emit(e);
	}
	return b;
}

int32_t Buildings::place(int type, int owner, int tx, int tz, const std::vector<int> &builders) {
	if (type < 0 || type >= B_TYPE_COUNT || owner < 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists) return 0;
	const BuildingDef &def = building_def(type);
	Player &p = sim->players[owner];
	if (!can_place(type, tx, tz) || !p.can_afford(def.cost)) return 0;
	if (sim->godot_rules && p.age < def.min_age) return 0; // (Godot-only: the fortifications' ages)
	if (!sim->godot_rules && is_tech_building(type)) return 0; // (Godot-only: Armory, Market)
	if (!p.pay(def.cost)) return 0;
	const int b = spawn(type, owner, tx, tz, false);
	const int32_t id = sim->entities.buildings.id[b];
	UnitStore &U = sim->entities.units;
	for (int u : builders) {
		if (u < 0 || U.removed[u] || U.dead[u]) continue;
		// remember what the builder was doing, so it goes back to it afterwards
		int ptype = -1;
		int32_t ptarget = 0;
		if (U.order_type[u] == O_BUILD) {
			if (U.order_b[u]) { ptype = U.order_b[u] - 1; ptarget = U.order_c[u]; }
		} else {
			ptype = U.order_type[u];
			ptarget = U.order_target[u];
		}
		sim->commands.order(u, Order::with_target(O_BUILD, id));
		if (U.order_type[u] == O_BUILD && (ptype == O_GATHER || ptype == O_WORSHIP)) {
			U.order_b[u] = ptype + 1;
			U.order_c[u] = ptarget;
			U.order_a[u] = U.econ_res_type[u] == RES_NONE ? 0 : U.econ_res_type[u] + 1;
		}
	}
	return id;
}

void Buildings::destroy(int32_t id) {
	Entities &E = sim->entities;
	const int b = E.building_slot(id);
	if (b < 0) return;
	const BuildingStore &B = E.buildings;
	sim->fortify.on_destroy(b); // (gates: clear the pass mask; Godot-only pieces)
	if (!building_def(B.type[b]).walkable) sim->map().unblock(B.tx[b], B.tz[b], B.w[b], B.h[b]);
	// dust clouds (game.fx.emit): visual, but they draw from game.rng, so the
	// draws are consumed here to keep the stream in step with the browser
	for (int i = 0; i < 6; i++) {
		sim->rng.range(-B.w[b] / 3.0, B.w[b] / 3.0);
		sim->rng.range(-B.h[b] / 3.0, B.h[b] / 3.0);
	}
	E.remove(id);
}

// ---- simulation: construction ------------------------------------------------

void Buildings::update(double dt) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	Movement &mv = sim->movement;
	// tally builders per site, in first-seen order (the JS Map)
	std::vector<std::pair<int32_t, int>> builders, repairs;
	const int n = U.size();
	for (int u = 0; u < n; u++) {
		if (U.removed[u] || U.dead[u] || U.order_type[u] != O_BUILD) continue;
		const int32_t bid = U.order_target[u];
		const int b = E.building_slot(bid);
		// Godot-only: a build order on a damaged finished building repairs it
		const bool repair = b >= 0 && B.built[b] && sim->godot_rules && !B.dead[b] && B.hp[b] < B.max_hp[b];
		if (b < 0 || (B.built[b] && !repair)) {
			sim->commands.idle(u);
			continue;
		}
		if (U.moving[u]) continue;
		if (mv.distance_to(u, bid) > 1.3) {
			GoalRect g{ (double)B.tx[b], (double)B.tz[b], (double)B.w[b], (double)B.h[b] };
			mv.move_to(u, B.x[b], B.z[b], &g);
			continue;
		}
		U.rot[u] = jsm::atan2(B.x[b] - U.x[u], B.z[b] - U.z[u]);
		U.anim_want[u] = A_BUILD;
		auto &list = repair ? repairs : builders;
		bool found = false;
		for (auto &kv : list)
			if (kv.first == bid) { kv.second++; found = true; break; }
		if (!found) list.push_back({ bid, 1 });
	}
	// repair (Godot-only): free, half the build rate, more hands faster (the same n^0.75)
	for (const auto &kv : repairs) {
		const int b = E.building_slot(kv.first);
		if (b < 0) continue;
		const double bt = B.fort_build_time[b] > 0 ? B.fort_build_time[b] : building_def(B.type[b]).build_time;
		B.hp[b] = std::min(B.max_hp[b], B.hp[b] + B.max_hp[b] / std::max(1.0, bt) * REPAIR_RATE * jsm::pow(kv.second, 0.75) * dt);
	}
	for (const auto &kv : builders) {
		const int b = E.building_slot(kv.first);
		if (b < 0) continue;
		// (fortify: a wall piece's time scales with its length; 0 = the def's)
		const double bt = B.fort_build_time[b] > 0 ? B.fort_build_time[b] : building_def(B.type[b]).build_time;
		const double rate = (1 / bt) * jsm::pow(kv.second, 0.75);
		const double before = B.progress[b];
		B.progress[b] = std::min(1.0, B.progress[b] + rate * dt);
		B.hp[b] = std::min(B.max_hp[b], B.hp[b] + (B.progress[b] - before) * B.max_hp[b] * 0.9);
		if (B.progress[b] >= 1) complete(b);
	}
}

void Buildings::complete(int b) {
	Entities &E = sim->entities;
	BuildingStore &B = E.buildings;
	UnitStore &U = E.units;
	B.built[b] = 1;
	B.progress[b] = 1;
	B.hp[b] = std::max(B.hp[b], B.max_hp[b]);
	const int32_t bid = B.id[b];
	Event e;
	e.type = EV_BUILDING_COMPLETED;
	e.kind = K_BUILDING;
	e.id = bid;
	e.owner = B.owner[b];
	e.a = B.type[b];
	e.x = B.x[b];
	e.z = B.z[b];
	sim->events.emit(e);
	// builders move on: one of them works a new farm, the rest help on the
	// nearest unfinished site of their own, else go back to what they were
	// doing before they were sent to build, else stand idle
	bool farmer = !building_def(B.type[b]).farm;
	const int n = U.size();
	for (int u = 0; u < n; u++) {
		if (U.removed[u] || U.dead[u] || U.order_type[u] != O_BUILD || U.order_target[u] != bid) continue;
		const int rtype = U.order_b[u] - 1, rres = U.order_a[u] - 1;
		const int32_t rtarget = U.order_c[u];
		if (!farmer && sim->commands.order(u, Order::with_target(O_GATHER, bid))) {
			farmer = true;
			continue;
		}
		const int32_t site = nearest_site(u, 12);
		if (site) {
			sim->commands.order(u, Order::with_target(O_BUILD, site));
			if (rtype >= 0) {
				U.order_b[u] = rtype + 1;
				U.order_c[u] = rtarget;
				U.order_a[u] = rres + 1;
			}
			continue;
		}
		if (rtype >= 0 && resume(u, rtype, rtarget, rres)) continue;
		sim->commands.idle(u);
	}
}

int32_t Buildings::nearest_site(int u, double max_dist) const {
	const UnitStore &U = sim->entities.units;
	const BuildingStore &B = sim->entities.buildings;
	int32_t best = 0;
	double bd = max_dist * max_dist;
	for (int o = 0; o < B.size(); o++) {
		if (B.removed[o] || B.built[o] || B.dead[o] || B.owner[o] != U.owner[u]) continue;
		const double dx = B.x[o] - U.x[u], dz = B.z[o] - U.z[u];
		const double d = dx * dx + dz * dz;
		if (d < bd) { bd = d; best = B.id[o]; }
	}
	return best;
}

bool Buildings::resume(int u, int type, int32_t target, int res_type) {
	Entities &E = sim->entities;
	const int s = E.slot(target);
	bool dead = false;
	if (s >= 0) {
		if (E.kind(target) == K_UNIT) dead = E.units.dead[s];
		else if (E.kind(target) == K_BUILDING) dead = E.buildings.dead[s];
	}
	if (s >= 0 && !dead && sim->commands.order(u, Order::with_target((OrderType)type, target))) return true;
	if (type != O_GATHER || res_type < 0 || res_type == RES_NONE) return false;
	const UnitStore &U = E.units;
	const int32_t alt = sim->economy.nearest_resource(U.x[u], U.z[u], res_type, 16);
	return alt && sim->commands.order(u, Order::with_target(O_GATHER, alt));
}

} // namespace aov
