// Fortifications: walls, gates, towers (Godot-only, see fortify.h).
#include "fortify.h"

#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

// ---- data ---------------------------------------------------------------

const FortTechDef &fort_tech_def(int t) {
	// clang-format off
	static const FortTechDef D[FT_COUNT] = {
		{ "", "", Cost(), 0, 0, 0, 0 },
		{ "stone_wall", "Stone Wall", Cost(0, 150, 100, 0), 40, 1, 0, 1 },
		{ "fortified_wall", "Fortified Wall", Cost(0, 250, 200, 0), 50, 2, 0, 2 },
		{ "citadel_wall", "Citadel Wall", Cost(0, 400, 300, 0), 60, 3, 0, 3 },
		{ "watch_tower", "Watch Tower", Cost(0, 100, 100, 0), 30, 1, 1, 1 },
		{ "guard_tower", "Guard Tower", Cost(0, 200, 200, 0), 40, 2, 1, 2 },
		{ "ballista_tower", "Ballista Tower", Cost(0, 300, 300, 0), 50, 3, 1, 3 },
	};
	// clang-format on
	return D[t > 0 && t < FT_COUNT ? t : 0];
}

int fort_tech_of(const char *key) {
	for (int t = 1; t < FT_COUNT; t++)
		if (std::string(fort_tech_def(t).key) == key) return t;
	return 0;
}

const WallStage &wall_stage(int level) {
	static const WallStage S[FORT_LEVELS] = {
		{ "Wooden Wall", 200 }, { "Stone Wall", 450 }, { "Fortified Wall", 700 }, { "Citadel Wall", 1000 },
	};
	return S[std::max(0, std::min(FORT_LEVELS - 1, level))];
}

const TowerStage &tower_stage(int level) {
	// name, hp, range, damage, cooldown, sight
	static const TowerStage S[FORT_LEVELS] = {
		{ "Sentry Tower", 750, 10, 6, 1.5, 12 },
		{ "Watch Tower", 1000, 11, 8, 1.5, 13 },
		{ "Guard Tower", 1400, 12, 10, 1.4, 14 },
		{ "Ballista Tower", 1800, 13, 16, 2.0, 15 },
	};
	return S[std::max(0, std::min(FORT_LEVELS - 1, level))];
}

// ---- setup ----------------------------------------------------------------

void Fortify::init(Sim *s) {
	sim = s;
	for (int i = 0; i < MAX_PLAYERS; i++) wall_level[i] = tower_level[i] = 0;
	walls = gates = towers = 0;
	gate_scan_t_ = 0;
	// every fortification row gets its stage's hp, however it was spawned
	// (place_wall, Buildings::place of a tower, AovSim.spawn_building)
	s->events.on(EV_BUILDING_PLACED, [this](const Event &e) {
		Entities &E = sim->entities;
		const int b = E.building_slot(e.id);
		if (b < 0) return;
		BuildingStore &B = E.buildings;
		if (!is_fort_type(B.type[b])) return;
		B.max_hp[b] = piece_max_hp(B.type[b], B.owner[b], B.w[b] * B.h[b]);
		B.hp[b] = B.built[b] ? B.max_hp[b] : std::max(1.0, B.max_hp[b] * 0.1);
		if (B.type[b] == B_TOWER) B.sight[b] = tower_stage(tower_level[B.owner[b]]).sight;
		else if (B.fort_build_time[b] <= 0) B.fort_build_time[b] = WALL_TILE_TIME * B.w[b] * B.h[b];
	});
}

double Fortify::piece_max_hp(int type, int owner, int tiles) const {
	const int o = owner >= 0 && owner < MAX_PLAYERS ? owner : 0;
	const double th = wall_stage(wall_level[o]).tile_hp;
	switch (type) {
		case B_WALL: return th * tiles;
		case B_WALL_PILLAR: return th * PILLAR_HP_MULT;
		case B_GATE: return th * tiles * GATE_HP_MULT;
		case B_TOWER: return tower_stage(tower_level[o]).hp;
		default: return building_def(type).hp;
	}
}

uint8_t Fortify::gate_mask(int owner) const {
	uint8_t m = 0;
	for (int o = 1; o < MAX_PLAYERS; o++)
		if (sim->players[o].exists && sim->is_ally(owner, o)) m |= (uint8_t)(1u << o);
	return m;
}

// ---- walls ----------------------------------------------------------------

bool Fortify::tile_ok(int tx, int tz) const {
	const GameMap &map = sim->map();
	if (!map.is_walkable(tx, tz)) return false; // terrain, resources, buildings
	if (sim->buildings.in_footprint(tx, tz)) return false; // (farms are walkable)
	const GameMap::RectStats st = map.tile_rect_stats(tx, tz, 1, 1);
	return !st.water && st.max - st.min <= 3;
}

int Fortify::own_piece_at(int tx, int tz, int owner) const {
	const GameMap &map = sim->map();
	if (!map.in_tiles(tx, tz)) return -1;
	const auto it = map.blockers.find(map.t_idx(tx, tz));
	if (it == map.blockers.end()) return -1;
	const int b = sim->entities.building_slot(it->second);
	if (b < 0) return -1;
	const BuildingStore &B = sim->entities.buildings;
	if (B.removed[b] || B.dead[b] || !is_wall_piece(B.type[b]) || B.owner[b] != owner) return -1;
	return b;
}

WallPlan Fortify::plan_wall(int owner, int tx0, int tz0, int tx1, int tz1, bool through_buildings) const {
	WallPlan P;
	const GameMap &map = sim->map();
	if (owner < 1 || owner >= MAX_PLAYERS || !sim->players[owner].exists) {
		P.reason = "No such player";
		return P;
	}
	tx0 = std::max(0, std::min(map.size - 1, tx0));
	tz0 = std::max(0, std::min(map.size - 1, tz0));
	tx1 = std::max(0, std::min(map.size - 1, tx1));
	tz1 = std::max(0, std::min(map.size - 1, tz1));
	// the 4-connected line: one step in x or z at a time (no diagonal gap)
	{
		const int dx = std::abs(tx1 - tx0), dz = std::abs(tz1 - tz0);
		const int sx = tx1 > tx0 ? 1 : -1, sz = tz1 > tz0 ? 1 : -1;
		int x = tx0, z = tz0, ix = 0, iz = 0;
		P.tiles.push_back(x);
		P.tiles.push_back(z);
		while ((ix < dx || iz < dz) && (int)P.tiles.size() / 2 < WALL_LINE_MAX) {
			if ((long long)(1 + 2 * ix) * dz < (long long)(1 + 2 * iz) * dx) { x += sx; ix++; }
			else { z += sz; iz++; }
			P.tiles.push_back(x);
			P.tiles.push_back(z);
		}
	}
	const int n = (int)P.tiles.size() / 2;
	P.state.resize(n);
	for (int i = 0; i < n; i++) {
		const int x = P.tiles[i * 2], z = P.tiles[i * 2 + 1];
		P.state[i] = own_piece_at(x, z, owner) >= 0 ? WT_JOINT : tile_ok(x, z) ? WT_NEW : WT_BAD;
		if (P.state[i] == WT_NEW) P.new_tiles++;
		else if (P.state[i] == WT_BAD && sim->buildings.in_footprint(x, z)) P.on_building++;
	}
	// runs of new tiles -> pillars and straight segments
	auto tx = [&](int i) { return P.tiles[i * 2]; };
	auto tz = [&](int i) { return P.tiles[i * 2 + 1]; };
	auto dir = [&](int a, int b) { return tx(b) != tx(a) ? (tx(b) > tx(a) ? 0 : 2) : (tz(b) > tz(a) ? 1 : 3); };
	for (int a = 0; a < n;) {
		if (P.state[a] != WT_NEW) { a++; continue; }
		int b = a;
		while (b < n && P.state[b] == WT_NEW) b++;
		const int k = b - a;
		const bool joint0 = a > 0 && P.state[a - 1] == WT_JOINT, joint1 = b < n && P.state[b] == WT_JOINT;
		std::vector<uint8_t> pil((size_t)k, 0);
		// ends (a run touching the owner's wall joins it without a pillar of its own)
		if (!joint0) pil[0] = 1;
		if (!joint1) pil[k - 1] = 1;
		// corners whose two arms are both 2+ tiles
		for (int i = 1; i < k - 1; i++) {
			const int din = dir(a + i - 1, a + i), dout = dir(a + i, a + i + 1);
			if (din == dout) continue;
			int arm_in = 1, arm_out = 1;
			for (int j = i - 1; j > 0 && dir(a + j - 1, a + j) == din; j--) arm_in++;
			for (int j = i + 1; j < k - 1 && dir(a + j, a + j + 1) == dout; j++) arm_out++;
			if (arm_in >= 2 && arm_out >= 2) pil[i] = 1;
		}
		// even spacing between fixed pillars (or joints): at most
		// WALL_SEGMENT_MAX + 1 tiles apart as the crow flies (a straight run:
		// segments of <= WALL_SEGMENT_MAX; a line dragged at an angle is a
		// staircase of tiles, and counting its tiles would stud it with a
		// pillar every 3.5 tiles of wall)
		{
			std::vector<int> fixed;
			fixed.push_back(joint0 ? -1 : 0);
			for (int i = 1; i < k - 1; i++)
				if (pil[i]) fixed.push_back(i);
			const int last = joint1 ? k : k - 1;
			if (last > fixed.back()) fixed.push_back(last);
			for (size_t f = 0; f + 1 < fixed.size(); f++) {
				const int p0 = fixed[f], g = fixed[f + 1] - p0 - 1;
				const int t0 = a + p0, t1 = a + fixed[f + 1]; // (a joint: the owner's piece just outside the run)
				const double span = std::sqrt((double)(tx(t1) - tx(t0)) * (tx(t1) - tx(t0)) + (double)(tz(t1) - tz(t0)) * (tz(t1) - tz(t0)));
				const int gs = (int)std::ceil(span - 1e-9) - 1; // (a straight run: span = g + 1)
				if (gs <= WALL_SEGMENT_MAX) continue;
				const int m = (gs - WALL_SEGMENT_MAX + WALL_PILLAR_EVERY - 1) / WALL_PILLAR_EVERY;
				for (int q = 1; q <= m; q++) {
					const int at = p0 + (int)js_round((double)q * (g + 1) / (m + 1));
					if (at >= 0 && at < k) pil[at] = 1;
				}
			}
		}
		// pieces
		for (int i = 0; i < k;) {
			const int t = a + i;
			if (pil[i]) {
				P.pieces.push_back({ B_WALL_PILLAR, tx(t), tz(t), 1, 1 });
				i++;
				continue;
			}
			int j = i + 1, d = -1;
			while (j < k && !pil[j] && j - i < WALL_SEGMENT_MAX) {
				const int dj = dir(a + j - 1, a + j);
				if (d < 0) d = dj;
				else if (dj != d) break;
				j++;
			}
			int x0 = tx(t), z0 = tz(t), x1 = x0, z1 = z0;
			for (int q = i; q < j; q++) {
				x0 = std::min(x0, tx(a + q));
				z0 = std::min(z0, tz(a + q));
				x1 = std::max(x1, tx(a + q));
				z1 = std::max(z1, tz(a + q));
			}
			P.pieces.push_back({ B_WALL, x0, z0, x1 - x0 + 1, z1 - z0 + 1 });
			i = j;
		}
		a = b;
	}
	const int pciv = sim->civs.civ(owner);
	const Cost tc = civ_building_cost(pciv, B_WALL); // (sim/civ: an Egyptian wall costs gold, no wood)
	P.cost = Cost(0, tc.v[RES_WOOD] * P.new_tiles, tc.v[RES_GOLD] * P.new_tiles, 0);
	if (pciv == CIV_EGYPT) { // (sim/civ: Retold's Egyptian segment prices, civ_wall_piece_cost)
		double g = 0;
		for (const auto &pc : P.pieces) g += civ_wall_piece_cost(pciv, pc.type, std::max(pc.w, pc.h)).v[RES_GOLD];
		P.cost = Cost(0, 0, g, 0);
	}
	if (pciv == CIV_EGYPT && sim->players[owner].age < EGYPT_WALL_AGE) P.reason = std::string("Requires ") + AGES[EGYPT_WALL_AGE] + " Age";
	else if (P.on_building > 0 && !through_buildings) P.reason = "A building is in the way";
	else if (P.pieces.empty()) P.reason = "Cannot build a wall there";
	else if (!sim->players[owner].can_afford(P.cost)) P.reason = "Not enough resources";
	else P.valid = true;
	return P;
}

int Fortify::spawn_piece(int type, int owner, int tx, int tz, int w, int h) {
	Entities &E = sim->entities;
	GameMap &map = sim->map();
	const BuildingDef &def = building_def(type);
	const int b = E.new_building();
	BuildingStore &B = E.buildings;
	B.type[b] = (uint8_t)type;
	B.owner[b] = (uint8_t)owner;
	B.tx[b] = tx;
	B.tz[b] = tz;
	B.w[b] = w;
	B.h[b] = h;
	B.x[b] = tx + w / 2.0;
	B.z[b] = tz + h / 2.0;
	B.built[b] = 0;
	B.progress[b] = 0;
	B.sight[b] = def.sight;
	B.radius[b] = std::max(w, h) / 2.0;
	B.def_flags[b] = 0;
	B.bld_variant[b] = 0;
	B.fort_build_time[b] = WALL_TILE_TIME * w * h;
	const int32_t id = B.id[b];
	E.added(id);
	map.block(tx, tz, w, h, id);
	// nudge any units standing on it off (as Buildings::spawn)
	UnitStore &U = E.units;
	for (int u = 0; u < U.size(); u++) {
		if (U.removed[u]) continue;
		if (U.x[u] >= tx && U.x[u] < tx + w && U.z[u] >= tz && U.z[u] < tz + h) {
			int wx, wz;
			if (sim->pathfinder.nearest_walkable((int)std::floor(U.x[u]), (int)std::floor(U.z[u]), 8, wx, wz)) {
				U.x[u] = U.prev_x[u] = wx + 0.5;
				U.z[u] = U.prev_z[u] = wz + 0.5;
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
	sim->events.emit(e); // (the handler in init() sets the stage's hp)
	return b;
}

std::vector<int32_t> Fortify::place_wall(int owner, int tx0, int tz0, int tx1, int tz1, const std::vector<int> &builders, FortResult &res, bool through_buildings) {
	std::vector<int32_t> ids;
	res = FortResult();
	if (!sim->godot_rules) {
		res.reason = "Walls need the Godot rules";
		return ids;
	}
	WallPlan P = plan_wall(owner, tx0, tz0, tx1, tz1, through_buildings);
	if (!P.valid) {
		res.reason = P.reason;
		return ids;
	}
	Player &p = sim->players[owner];
	if (!p.pay(P.cost)) {
		res.reason = "Not enough resources";
		return ids;
	}
	for (const WallPiece &w : P.pieces) ids.push_back(sim->entities.buildings.id[spawn_piece(w.type, owner, w.tx, w.tz, w.w, w.h)]);
	// the builders start at the line's first piece; Buildings::complete sends
	// them on to the nearest unfinished piece, then back to their work
	UnitStore &U = sim->entities.units;
	for (int u : builders) {
		if (u < 0 || u >= U.size() || U.removed[u] || U.dead[u] || U.owner[u] != owner || !unit_def(U.type[u]).builder) continue;
		int ptype = -1;
		int32_t ptarget = 0;
		if (U.order_type[u] == O_BUILD) {
			if (U.order_b[u]) { ptype = U.order_b[u] - 1; ptarget = U.order_c[u]; }
		} else {
			ptype = U.order_type[u];
			ptarget = U.order_target[u];
		}
		sim->commands.order(u, Order::with_target(O_BUILD, ids[0]));
		if (U.order_type[u] == O_BUILD && (ptype == O_GATHER || ptype == O_WORSHIP)) {
			U.order_b[u] = ptype + 1;
			U.order_c[u] = ptarget;
			U.order_a[u] = U.econ_res_type[u] == RES_NONE ? 0 : U.econ_res_type[u] + 1;
		}
	}
	res.ok = true;
	return ids;
}

// ---- gates ----------------------------------------------------------------

FortResult Fortify::convert_to_gate(int32_t id) {
	FortResult r;
	Entities &E = sim->entities;
	const int b = E.building_slot(id);
	BuildingStore &B = E.buildings;
	if (b < 0 || B.dead[b] || B.type[b] != B_WALL) { r.reason = "Only a wall segment can become a gate"; return r; }
	if (!B.built[b]) { r.reason = "Finish the wall first"; return r; }
	Player *p = sim->player(B.owner[b]);
	if (!p) { r.reason = "No owner"; return r; }
	if (!p->pay(civ_building_cost(sim->civs.civ(B.owner[b]), B_GATE))) { r.reason = "Not enough resources"; return r; } // (sim/civ: Egyptian: gold)
	const double frac = B.max_hp[b] > 0 ? B.hp[b] / B.max_hp[b] : 1;
	B.type[b] = B_GATE;
	B.max_hp[b] = piece_max_hp(B_GATE, B.owner[b], B.w[b] * B.h[b]);
	B.hp[b] = std::max(1.0, B.max_hp[b] * frac);
	B.sight[b] = building_def(B_GATE).sight;
	B.fort_locked[b] = 0;
	B.fort_open[b] = 0;
	sim->map().set_gate_mask(B.tx[b], B.tz[b], B.w[b], B.h[b], gate_mask(B.owner[b]));
	Event e;
	e.type = EV_GATE_CHANGED;
	e.kind = K_BUILDING;
	e.id = id;
	e.owner = B.owner[b];
	e.a = 0;
	e.x = B.x[b];
	e.z = B.z[b];
	sim->events.emit(e);
	r.ok = true;
	return r;
}

FortResult Fortify::set_gate_locked(int32_t id, bool locked) {
	FortResult r;
	Entities &E = sim->entities;
	const int b = E.building_slot(id);
	BuildingStore &B = E.buildings;
	if (b < 0 || B.dead[b] || B.type[b] != B_GATE) { r.reason = "Not a gate"; return r; }
	B.fort_locked[b] = locked ? 1 : 0;
	sim->map().set_gate_mask(B.tx[b], B.tz[b], B.w[b], B.h[b], locked ? 0 : gate_mask(B.owner[b]));
	Event e;
	e.type = EV_GATE_CHANGED;
	e.kind = K_BUILDING;
	e.id = id;
	e.owner = B.owner[b];
	e.a = locked ? 1 : 2;
	e.x = B.x[b];
	e.z = B.z[b];
	sim->events.emit(e);
	r.ok = true;
	return r;
}

void Fortify::on_destroy(int b) {
	const BuildingStore &B = sim->entities.buildings;
	if (b < 0 || b >= B.size() || B.type[b] != B_GATE) return;
	sim->map().set_gate_mask(B.tx[b], B.tz[b], B.w[b], B.h[b], 0);
}

// ---- research -------------------------------------------------------------

int Fortify::tech_state(int owner, int tech) const {
	if (tech <= 0 || tech >= FT_COUNT || owner < 0 || owner >= MAX_PLAYERS) return 2;
	const FortTechDef &d = fort_tech_def(tech);
	const int level = d.line ? tower_level[owner] : wall_level[owner];
	if (d.level <= level) return 0;
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner && B.fort_tech[b] == tech) return 4;
	if (d.level > level + 1) return 2;
	if (sim->players[owner].age < d.min_age) return 3;
	return 1;
}

FortResult Fortify::research(int32_t id, int tech) {
	FortResult r;
	Entities &E = sim->entities;
	const int b = E.building_slot(id);
	BuildingStore &B = E.buildings;
	if (tech <= 0 || tech >= FT_COUNT) { r.reason = "Unknown technology"; return r; }
	const FortTechDef &d = fort_tech_def(tech);
	if (b < 0 || B.dead[b] || !B.built[b]) { r.reason = "Cannot research here"; return r; }
	if (d.line == 1 ? B.type[b] != B_TOWER : !is_wall_piece(B.type[b])) { r.reason = d.line ? "Research it at a tower" : "Research it at a wall"; return r; }
	if (B.fort_tech[b]) { r.reason = "Already researching"; return r; }
	const int owner = B.owner[b];
	switch (tech_state(owner, tech)) {
		case 0: r.reason = "Already researched"; return r;
		case 2: r.reason = "Research the previous stage first"; return r;
		case 3: r.reason = std::string("Requires ") + AGES[d.min_age] + " Age"; return r;
		case 4: r.reason = "Already being researched"; return r;
		default: break;
	}
	if (!sim->players[owner].pay(civ_fort_tech_cost(sim->civs.civ(owner), tech))) { r.reason = "Not enough resources"; return r; } // (sim/civ: the Egyptians' own prices)
	B.fort_tech[b] = (uint8_t)tech;
	B.fort_tech_t[b] = 0;
	B.fort_tech_total[b] = civ_fort_tech_time(sim->civs.civ(owner), tech); // (sim/civ: Egyptian Citadel 50 s)
	r.ok = true;
	return r;
}

bool Fortify::cancel_research(int32_t id) {
	Entities &E = sim->entities;
	const int b = E.building_slot(id);
	BuildingStore &B = E.buildings;
	if (b < 0 || !B.fort_tech[b]) return false;
	sim->players[B.owner[b]].refund(civ_fort_tech_cost(sim->civs.civ(B.owner[b]), B.fort_tech[b])); // (sim/civ)
	B.fort_tech[b] = 0;
	B.fort_tech_t[b] = B.fort_tech_total[b] = 0;
	return true;
}

void Fortify::set_level(int owner, int line, int level) {
	if (owner < 0 || owner >= MAX_PLAYERS) return;
	int &lv = line ? tower_level[owner] : wall_level[owner];
	if (level <= lv) return;
	lv = level;
	BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || B.owner[b] != owner) continue;
		const bool mine = line ? B.type[b] == B_TOWER : is_wall_piece(B.type[b]);
		if (!mine) continue;
		const double old = B.max_hp[b];
		B.max_hp[b] = piece_max_hp(B.type[b], owner, B.w[b] * B.h[b]);
		if (old > 0) B.hp[b] = B.hp[b] * B.max_hp[b] / old;
		if (B.type[b] == B_TOWER) B.sight[b] = tower_stage(level).sight;
	}
}

// ---- combat ---------------------------------------------------------------

double Fortify::armor_mult(int b, const Hitter &a, uint8_t kind) const {
	const Entities &E = sim->entities;
	const int type = E.buildings.type[b];
	bool arrow = kind == DK_ARROW || a.kind == K_BUILDING, myth = a.myth_class, pseudo = a.kind == 0;
	if (a.kind == K_UNIT && a.row >= 0 && a.row < E.units.size()) {
		const UnitDef &d = unit_def(E.units.type[a.row]);
		arrow = arrow || d.attack.projectile;
		myth = myth || d.cls == CLS_MYTH;
	}
	if (myth || (pseudo && !arrow)) return 1.0; // myth units and god powers: full damage
	if (type == B_TOWER) return arrow ? 0.4 : 0.8;
	return arrow ? 0.15 : 0.6; // wall pieces: arrows barely scratch them
}

int32_t Fortify::breach_target(int r) const {
	const Entities &E = sim->entities;
	const UnitStore &U = E.units;
	const BuildingStore &B = E.buildings;
	const double x = U.x[r], z = U.z[r];
	const int owner = U.owner[r];
	int best = -1;
	double bd = BREACH_RADIUS * BREACH_RADIUS;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !is_wall_piece(B.type[b]) || !sim->is_enemy(owner, B.owner[b])) continue;
		const double ex = std::max(std::max(B.tx[b] - x, 0.0), x - (B.tx[b] + B.w[b]));
		const double ez = std::max(std::max(B.tz[b] - z, 0.0), z - (B.tz[b] + B.h[b]));
		const double d = ex * ex + ez * ez;
		if (d < bd) {
			bd = d;
			best = b;
		}
	}
	return best >= 0 ? B.id[best] : 0;
}

// ---- render helpers -----------------------------------------------------

uint8_t Fortify::connections(int b) const {
	const BuildingStore &B = sim->entities.buildings;
	const int o = B.owner[b], tx = B.tx[b], tz = B.tz[b], w = B.w[b], h = B.h[b];
	uint8_t m = 0;
	for (int x = tx; x < tx + w; x++) {
		if (own_piece_at(x, tz - 1, o) >= 0) m |= 1;
		if (own_piece_at(x, tz + h, o) >= 0) m |= 4;
	}
	for (int z = tz; z < tz + h; z++) {
		if (own_piece_at(tx + w, z, o) >= 0) m |= 2;
		if (own_piece_at(tx - 1, z, o) >= 0) m |= 8;
	}
	return m;
}

uint8_t Fortify::axis(int b) const {
	const BuildingStore &B = sim->entities.buildings;
	if (B.w[b] != B.h[b]) return B.w[b] > B.h[b] ? 0 : 1;
	const uint8_t c = connections(b);
	return (c & (1 | 4)) && !(c & (2 | 8)) ? 1 : 0;
}

// ---- tick -------------------------------------------------------------------

void Fortify::update(double dt) {
	if (!sim->godot_rules) return;
	Entities &E = sim->entities;
	BuildingStore &B = E.buildings;
	UnitStore &U = E.units;
	walls = gates = towers = 0;
	gate_scan_t_ -= dt;
	const bool rescan = gate_scan_t_ <= 0;
	if (rescan) gate_scan_t_ = 1;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !is_fort_type(B.type[b])) continue;
		const int type = B.type[b], owner = B.owner[b];
		if (type == B_TOWER) towers++;
		else walls++;
		if (!B.built[b]) continue;
		// research
		if (B.fort_tech[b]) {
			B.fort_tech_t[b] += dt;
			if (B.fort_tech_t[b] >= B.fort_tech_total[b]) {
				const int tech = B.fort_tech[b];
				const FortTechDef &d = fort_tech_def(tech);
				B.fort_tech[b] = 0;
				B.fort_tech_t[b] = B.fort_tech_total[b] = 0;
				set_level(owner, d.line, d.level);
				Event e;
				e.type = EV_TECH_RESEARCHED;
				e.kind = K_BUILDING;
				e.id = B.id[b];
				e.owner = owner;
				e.a = tech;
				e.x = B.x[b];
				e.z = B.z[b];
				sim->events.emit(e);
			}
		}
		if (type == B_TOWER) {
			// arrows at the nearest enemy unit in range (find_enemy_near: enemies only)
			const TowerStage &st = tower_stage(tower_level[owner]);
			B.attack_cd[b] = std::max(0.0, B.attack_cd[b] - dt);
			if (B.attack_cd[b] > 0) continue;
			const int e = sim->combat.find_enemy_near(B.x[b], B.z[b], owner, st.range + B.w[b] / 2.0);
			if (e >= 0) {
				B.attack_cd[b] = st.cooldown;
				if (B.civ_empower[b] > 0) B.attack_cd[b] *= sim->civs.reload_mult(b); // (sim/civ: empowered, x0.75)
				sim->combat.fire(B.id[b], U.id[e], st.damage, TOWER_ARROW_Y);
			}
		} else if (type == B_GATE) {
			gates++;
			const uint8_t mask = B.fort_locked[b] ? 0 : gate_mask(owner);
			if (rescan) sim->map().set_gate_mask(B.tx[b], B.tz[b], B.w[b], B.h[b], mask); // (teams)
			bool want = false;
			if (mask) {
				const double cx = B.x[b], cz = B.z[b];
				const double R = std::max(B.w[b], B.h[b]) / 2.0 + GATE_OPEN_R;
				const double x0 = B.tx[b] - GATE_OPEN_R, x1 = B.tx[b] + B.w[b] + GATE_OPEN_R;
				const double z0 = B.tz[b] - GATE_OPEN_R, z1 = B.tz[b] + B.h[b] + GATE_OPEN_R;
				sim->movement.hash.for_each_near(cx, cz, R + 1, [&](int o) {
					if (want || o >= U.size() || U.removed[o] || U.dead[o] || !((mask >> U.owner[o]) & 1)) return;
					if (U.x[o] >= x0 && U.x[o] <= x1 && U.z[o] >= z0 && U.z[o] <= z1) want = true;
				});
			}
			const double step = dt * 2.5; // the leaves swing in 0.4 s
			B.fort_open[b] = want ? std::min(1.0, B.fort_open[b] + step) : std::max(0.0, B.fort_open[b] - step);
		}
	}
	sim->pathfinder.regions = walls > 0; // (walled-off goals fail fast, pathfinding.h)
}

} // namespace aov
