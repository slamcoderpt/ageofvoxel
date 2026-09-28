// Port of src/buildings/town.js: a planned Greek town (Hippodamian grid)
// round a start position, used by the town / coast / hud (and stress)
// scenes. All coordinates are tile offsets from the start tile (the Town
// Center's centre). Buildings face +z; each row fronts onto a street to its
// +z. A slot that does not fit is nudged a tile or dropped.
#include <algorithm>
#include <cmath>

#include "../sim.h"
#include "buildings.h"

namespace aov {

namespace {
struct R4 { int x0, z0, x1, z1; }; // inclusive
const R4 AGORA{ -6, -6, 6, 6 };
const R4 TEMENOS{ -6, -20, 6, -8 };
const R4 SANCTUM{ -4, -19, 4, -9 }; // the upper step of the temenos
const R4 STREETS[] = {
	{ -25, -1, 22, 1 }, // main street, east-west, 3 wide
	{ -1, -7, 1, 18 },  // north-south: temenos gate to the fields
	{ -25, -9, -7, -8 }, // lane in front of row B
	{ -25, 7, -2, 8 },   // lane in front of row C
	{ -8, -9, -7, 16 },  // west cross street
};
const int TEMPLE[2] = { -2, -17 };
const int BARRACKS[2] = { -14, 10 };
const int STORE[2] = { 18, -5 };  // wood yard at the eastern forest edge
const int STORE2[2] = { 13, -5 }; // by the gold mine
const int HOUSES[][2] = {
	{ -12, -5 }, { -17, -5 }, { -22, -5 },   // row A, north side of the main street
	{ -12, -12 }, { -17, -12 }, { -22, -12 }, // row B
	{ -12, 3 }, { -17, 3 }, { -22, 3 },       // row C, south side
	{ -20, 10 },                              // row D, beside the academy
	{ -6, 15 }, { 3, 13 },                    // along the south street
};
const int HOUSE2[2] = { -6, 10 }; // being built, on the south street corner
const int FARMS[][2] = { { 9, 3 }, { 14, 3 }, { 9, 9 } };
} // namespace

Buildings::Town Buildings::layout_town(int owner, const Start &start) {
	GameMap &map = sim->map();
	Entities &E = sim->entities;
	const int sx = start.tx, sz = start.tz;
	struct Rect { int tx, tz, w, h; };
	auto rect = [&](const R4 &r) { return Rect{ sx + r.x0, sz + r.z0, r.x1 - r.x0 + 1, r.z1 - r.z0 + 1 }; };

	// clear straggler trees from everything the plan covers (not mines or bushes)
	auto clear_trees = [&](int tx, int tz, int w, int h) {
		const ResourceStore &R = E.resources;
		std::vector<int32_t> ids;
		for (int i = 0; i < R.size(); i++) {
			if (R.removed[i] || R.res_type[i] != RES_WOOD) continue;
			const double rtx = R.x[i] - R.w[i] / 2.0, rtz = R.z[i] - R.h[i] / 2.0;
			if (rtx < tx + w && rtx + R.w[i] > tx && rtz < tz + h && rtz + R.h[i] > tz) ids.push_back(R.id[i]);
		}
		for (int32_t id : ids) sim->remove_resource(id);
	};
	auto clear_rect4 = [&](const R4 &r) { Rect q = rect(r); clear_trees(q.tx, q.tz, q.w, q.h); };
	clear_rect4(AGORA);
	clear_rect4(TEMENOS);
	for (const R4 &s : STREETS) clear_rect4(s);
	for (const auto &h : HOUSES) clear_trees(sx + h[0] - 1, sz + h[1] - 1, 6, 5);
	clear_trees(sx + HOUSE2[0] - 1, sz + HOUSE2[1] - 1, 6, 5);
	clear_trees(sx + BARRACKS[0], sz + BARRACKS[1], 5, 5);
	for (const int *s : { STORE, STORE2 }) clear_trees(sx + s[0] - 2, sz + s[1] - 2, 7, 6);

	Town T;
	// Town Center on the agora
	const int tcb = spawn(B_TOWN_CENTER, owner, sx - 3, sz - 3, true, false);
	T.tc = E.buildings.id[tcb];
	const int L0 = map.tile_rect_stats(sx - 3, sz - 3, 7, 7).min;

	// temenos: a two-step paved platform, only where the ground is flat and dry
	{
		const Rect q = rect(TEMENOS);
		const GameMap::RectStats st = map.tile_rect_stats(q.tx, q.tz, q.w, q.h);
		bool walk = true;
		for (int z = q.tz; z < q.tz + q.h && walk; z++)
			for (int x = q.tx; x < q.tx + q.w; x++)
				if (!map.is_terrain_passable(x, z) || in_footprint(x, z)) { walk = false; break; }
		if (walk && !st.water && st.max - st.min <= 2 && st.min >= L0 - 1) {
			map.flatten_tiles(q.tx, q.tz, q.w, q.h, L0 + 1, PAVED);
			const Rect i = rect(SANCTUM);
			map.flatten_tiles(i.tx, i.tz, i.w, i.h, L0 + 2, PAVED);
		}
	}

	auto try_at = [&](int type, int dx, int dz, bool built, int nudge) -> int32_t {
		for (int r = 0; r <= nudge; r++) {
			const int offs[8][2] = { { 0, r }, { r, 0 }, { -r, 0 }, { 0, -r }, { r, r }, { -r, r }, { r, -r }, { -r, -r } };
			const int n = r == 0 ? 1 : 8;
			for (int k = 0; k < n; k++) {
				const int tx = sx + dx + (r == 0 ? 0 : offs[k][0]), tz = sz + dz + (r == 0 ? 0 : offs[k][1]);
				if (!can_place(type, tx, tz)) continue;
				return E.buildings.id[spawn(type, owner, tx, tz, built, false)];
			}
		}
		return 0;
	};
	// fallback for the key buildings: spiral out from the planned spot
	auto spiral = [&](int type, const int *p) {
		int32_t id = try_at(type, p[0], p[1], true, 1);
		return id ? id : try_at(type, p[0], p[1], true, 6);
	};

	T.temple = spiral(B_TEMPLE, TEMPLE);
	T.store2 = spiral(B_STOREHOUSE, STORE2);
	T.store = spiral(B_STOREHOUSE, STORE);
	T.barracks = spiral(B_BARRACKS, BARRACKS);
	for (const auto &h : HOUSES)
		if (int32_t id = try_at(B_HOUSE, h[0], h[1], true, 1)) T.houses.push_back(id);
	for (const auto &f : FARMS)
		if (int32_t id = try_at(B_FARM, f[0], f[1], true, 1)) T.farms.push_back(id);
	T.house2 = try_at(B_HOUSE, HOUSE2[0], HOUSE2[1], false, 1);
	if (T.house2) {
		BuildingStore &B = E.buildings;
		const int b = E.building_slot(T.house2);
		B.progress[b] = 0.55;
		B.hp[b] = B.max_hp[b] * (0.1 + 0.9 * 0.55);
	}

	// ---- ground: agora, streets, forecourts, courtyards
	auto paint = [&](int x, int z, int g, bool grass_only) {
		if (!map.is_terrain_passable(x, z) || in_footprint(x, z)) return;
		const int cur = ground_at(x, z);
		if (cur < 0 || cur == FARM || cur == SAND || cur == ROCK) return;
		if (grass_only && cur != GRASS && cur != DRYGRASS) return;
		if (map.tile_rect_stats(x, z, 1, 1).water) return;
		map.paint_tiles(x, z, 1, 1, g);
	};
	auto fill = [&](const R4 &r, int g) {
		for (int z = r.z0; z <= r.z1; z++)
			for (int x = r.x0; x <= r.x1; x++) paint(sx + x, sz + z, g, false);
	};
	fill(AGORA, PAVED);
	for (const R4 &s : STREETS) fill(s, PAVED);
	// worn-earth shoulders along the streets where they meet grass, ragged
	for (const R4 &s : STREETS) {
		const bool along = s.x1 - s.x0 > s.z1 - s.z0;
		for (int a = along ? s.x0 : s.z0; a <= (along ? s.x1 : s.z1); a++) {
			const int sides[2] = { along ? s.z0 - 1 : s.x0 - 1, along ? s.z1 + 1 : s.x1 + 1 };
			for (int side : sides) {
				const int x = along ? a : side, z = along ? side : a;
				if (hash3(sx + x, 12, sz + z, 49) < 0.45) paint(sx + x, sz + z, DIRT, true);
			}
		}
	}
	// every house and storehouse: a paved forecourt onto its street, and a
	// packed-earth side court (the courtyard prop sits on it)
	const BuildingStore &B = E.buildings;
	std::vector<int32_t> lots = T.houses;
	lots.push_back(T.store);
	lots.push_back(T.store2);
	lots.push_back(T.house2);
	for (int32_t id : lots) {
		const int b = E.building_slot(id);
		if (!id || b < 0) continue;
		for (int x = B.tx[b] - 1; x <= B.tx[b] + B.w[b]; x++) paint(x, B.tz[b] + B.h[b], PAVED, false);
		for (int z = B.tz[b]; z < B.tz[b] + B.h[b]; z++) paint(B.tx[b] + B.w[b], z, DIRT, true);
	}
	// work yards round the storehouses
	for (int32_t id : { T.store, T.store2 }) {
		const int b = E.building_slot(id);
		if (!id || b < 0) continue;
		for (int z = B.tz[b] - 1; z < B.tz[b] + B.h[b]; z++)
			for (int x = B.tx[b] - 1; x <= B.tx[b] + B.w[b]; x++) paint(x, z, DIRT, true);
	}
	// the academy's drill ground in front
	if (T.barracks) {
		const int b = E.building_slot(T.barracks);
		for (int x = B.tx[b] - 1; x <= B.tx[b] + B.w[b]; x++) paint(x, B.tz[b] + B.h[b], DIRT, true);
	}
	return T;
}

} // namespace aov
