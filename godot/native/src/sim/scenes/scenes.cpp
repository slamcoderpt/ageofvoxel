// Port of the scene setups (see scenes.h).
#include "scenes.h"

#include <algorithm>
#include <cmath>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {
namespace scenes {

static const double PI = 3.141592653589793;

static SceneRef ref_of(Sim &sim, int32_t id) {
	SceneRef r;
	Entities &E = sim.entities;
	const int s = E.slot(id);
	if (!id || s < 0) return r;
	r.id = id;
	if (E.kind(id) == K_BUILDING) {
		const BuildingStore &B = E.buildings;
		r.x = B.x[s]; r.z = B.z[s]; r.tx = B.tx[s]; r.tz = B.tz[s]; r.w = B.w[s]; r.h = B.h[s];
		r.farm = building_def(B.type[s]).farm;
		r.res_type = r.farm ? RES_FOOD : 255;
	} else if (E.kind(id) == K_RESOURCE) {
		const ResourceStore &R = E.resources;
		r.x = R.x[s]; r.z = R.z[s]; r.tx = R.tx[s]; r.tz = R.tz[s]; r.w = R.w[s]; r.h = R.h[s];
		r.res_type = R.res_type[s];
	} else if (E.kind(id) == K_UNIT) {
		r.x = E.units.x[s]; r.z = E.units.z[s];
	}
	return r;
}

static bool gap_ok(Sim &sim, int tx, int tz, const BuildingDef &def, int gap) {
	const BuildingStore &B = sim.entities.buildings;
	for (int z = tz - gap; z < tz + def.h + gap; z++)
		for (int x = tx - gap; x < tx + def.w + gap; x++) {
			if (!sim.map().in_tiles(x, z)) return false;
			for (int b = 0; b < B.size(); b++)
				if (!B.removed[b] && x >= B.tx[b] && x < B.tx[b] + B.w[b] && z >= B.tz[b] && z < B.tz[b] + B.h[b]) return false;
		}
	return true;
}

// Place a building near (cx, cz) (its centre), spiralling outwards until it
// fits with a one-tile gap. Returns the id or 0.
int32_t place_near(Sim &sim, int type, int owner, double cx, double cz, bool built, int max_r, int gap, double progress) {
	const BuildingDef &def = building_def(type);
	for (int r = 0; r <= max_r; r++)
		for (int dz = -r; dz <= r; dz++)
			for (int dx = -r; dx <= r; dx++) {
				if (std::max(std::abs(dx), std::abs(dz)) != r) continue;
				const int tx = (int)js_round(cx - def.w / 2.0) + dx, tz = (int)js_round(cz - def.h / 2.0) + dz;
				if (!sim.buildings.can_place(type, tx, tz)) continue;
				if (gap && !gap_ok(sim, tx, tz, def, gap)) continue;
				const int b = sim.buildings.spawn(type, owner, tx, tz, built);
				BuildingStore &B = sim.entities.buildings;
				if (!built && progress >= 0) {
					B.progress[b] = progress;
					B.hp[b] = B.max_hp[b] * (0.1 + 0.9 * progress);
				}
				return B.id[b];
			}
	return 0;
}

// Send villagers to gather the nearest nodes of a resource type.
std::vector<int32_t> assign_gatherers(Sim &sim, const std::vector<int32_t> &villagers, int res, double nx, double nz, int32_t *first) {
	const ResourceStore &R = sim.entities.resources;
	struct N { int32_t id; double d; };
	std::vector<N> nodes;
	for (int i = 0; i < R.size(); i++) {
		if (R.removed[i] || R.res_type[i] != res) continue;
		const double dx = R.x[i] - nx, dz = R.z[i] - nz;
		nodes.push_back({ R.id[i], dx * dx + dz * dz });
	}
	std::stable_sort(nodes.begin(), nodes.end(), [](const N &a, const N &b) { return a.d < b.d; });
	for (size_t i = 0; i < villagers.size(); i++) {
		if (nodes.empty()) break;
		const size_t k = res == RES_GOLD ? 0 : std::min(nodes.size() - 1, i);
		const int u = sim.entities.unit_slot(villagers[i]);
		if (u >= 0) sim.commands.order(u, Order::with_target(O_GATHER, nodes[k].id));
	}
	if (first) *first = nodes.empty() ? 0 : nodes[0].id;
	std::vector<int32_t> out;
	for (const N &n : nodes) out.push_back(n.id);
	return out;
}

int32_t nearest_resource_any(Sim &sim, int res, double x, double z) {
	const ResourceStore &R = sim.entities.resources;
	int32_t best = 0;
	double bd = INFINITY;
	for (int i = 0; i < R.size(); i++) {
		if (R.removed[i] || R.res_type[i] != res) continue;
		const double dx = R.x[i] - x, dz = R.z[i] - z;
		const double d = dx * dx + dz * dz;
		if (d < bd) { bd = d; best = R.id[i]; }
	}
	return best;
}

StartResult standard_start(Sim &sim, int owner, const Start &start, int villagers) {
	const int b = sim.buildings.spawn(B_TOWN_CENTER, owner, start.tx - 3, start.tz - 3, true);
	const BuildingStore &B = sim.entities.buildings;
	StartResult r;
	r.tc = B.id[b];
	r.villagers = sim.spawn_block(U_VILLAGER, owner, villagers, B.x[b], B.tz[b] + B.h[b] + 1.5, 0, 1.1);
	return r;
}

TownResult build_town(Sim &sim, int owner, const Start &start, int villagers, int soldiers) {
	const Buildings::Town T = sim.buildings.layout_town(owner, start);
	const int sx = start.tx, sz = start.tz;
	const int32_t wood = nearest_resource_any(sim, RES_WOOD, sx, sz);
	const int32_t gold = nearest_resource_any(sim, RES_GOLD, sx, sz);
	const int32_t berry = nearest_resource_any(sim, RES_FOOD, sx, sz);
	const SceneRef tc = ref_of(sim, T.tc);
	TownResult out;
	out.tc = T.tc;
	out.villagers = sim.spawn_block(U_VILLAGER, owner, villagers, tc.x, tc.tz + tc.h + 2, 0, 1.2);
	size_t i = 0;
	auto take = [&](int n) {
		std::vector<int32_t> v;
		for (int k = 0; k < n; k++, i++)
			if (i < out.villagers.size()) v.push_back(out.villagers[i]);
		return v;
	};
	const int nW = (int)js_round(villagers * 0.3), nG = (int)js_round(villagers * 0.2), nB = (int)js_round(villagers * 0.15);
	auto near = [&](int32_t id) { const SceneRef r = id ? ref_of(sim, id) : tc; return r; };
	{ SceneRef n = near(wood); assign_gatherers(sim, take(nW), RES_WOOD, n.x, n.z); }
	{ SceneRef n = near(gold); assign_gatherers(sim, take(nG), RES_GOLD, n.x, n.z); }
	{ SceneRef n = near(berry); assign_gatherers(sim, take(nB), RES_FOOD, n.x, n.z); }
	for (int32_t f : T.farms) {
		std::vector<int32_t> v = take(1);
		if (!v.empty()) sim.commands.order(sim.entities.unit_slot(v[0]), Order::with_target(O_GATHER, f));
	}
	if (T.temple)
		for (int32_t v : take(3)) sim.commands.order(sim.entities.unit_slot(v), Order::with_target(O_WORSHIP, T.temple));
	if (T.house2)
		for (int32_t v : take(2)) sim.commands.order(sim.entities.unit_slot(v), Order::with_target(O_BUILD, T.house2));
	// the rest idle in the plaza
	if (soldiers) out.army = sim.spawn_block(U_HOPLITE, owner, soldiers, tc.x + 5.5, tc.z + 1, 3, 1.0, PI / 4);
	return out;
}

// ---- the economy scene (src/economy/EconomyScene.js) ------------------------

namespace {

struct Block { int x0, z0, cols; };

// Find a (cols*4)x12 tile block near the town centre where every farm fits.
bool find_field_block(Sim &sim, const SceneRef &tc, int cols, Block &out) {
	bool found = false;
	double bs = -INFINITY;
	for (int dz = -18; dz <= 18; dz++)
		for (int dx = -18; dx <= 18; dx++) {
			const int x0 = (int)js_round(tc.x) + dx, z0 = (int)js_round(tc.z) + dz;
			// keep a road between the fields and the town centre
			if (x0 < tc.tx + tc.w + 2 && x0 + cols * 4 > tc.tx - 2 && z0 < tc.tz + tc.h + 2 && z0 + 12 > tc.tz - 2) continue;
			int ok = 0;
			for (int j = 0; j < 3; j++)
				for (int i = 0; i < cols; i++)
					if (sim.buildings.can_place(B_FARM, x0 + i * 4, z0 + j * 4)) ok++;
			if (ok < cols * 3) continue;
			const double cx = x0 + cols * 2 - tc.x, cz = z0 + 6 - tc.z;
			// prefer close to the TC and toward the camera side (+x +z)
			const double s = -jsm::hypot(cx, cz) + (cx + cz) * 0.35;
			if (s > bs) { bs = s; out = { x0, z0, cols }; found = true; }
		}
	return found;
}

bool nearest_water(Sim &sim, double x, double z, int max_r, double &ox, double &oz) {
	for (int r = 4; r <= max_r; r++)
		for (int i = 0; i < 48; i++) {
			const double a = (i / 48.0) * PI * 2;
			const double px = x + jsm::cos(a) * r, pz = z + jsm::sin(a) * r;
			if (sim.economy.fishing.is_open(px, pz, 1.2)) { ox = px; oz = pz; return true; }
		}
	return false;
}

bool open_ground(Sim &sim, double x, double z, double &ox, double &oz) {
	int wx, wz;
	if (!sim.pathfinder.nearest_walkable((int)std::floor(x), (int)std::floor(z), 8, wx, wz)) return false;
	ox = wx + 0.5;
	oz = wz + 0.5;
	return true;
}

void decor(Sim &sim, const char *key, double x, double z, double rot = 0, double scale = 1) {
	sim.economy.decor.push_back({ key, x, z, rot, scale, 0 });
}

// Fences around the block (with gates), hay, sheaves and a cart by the granary.
void dress_fields(Sim &sim, int x0, int z0, int W, int H, const SceneRef &granary) {
	for (int i = 0; i < W; i++) {
		if (i == (W >> 1) - 1 || i == W >> 1) continue; // gates in the middle of each side
		decor(sim, "fence", x0 + i, z0 - 0.35);
		decor(sim, "fence", x0 + i, z0 + H + 0.35);
	}
	for (int i = 0; i < H; i++) {
		if (i == (H >> 1) - 1 || i == H >> 1) continue;
		decor(sim, "fence", x0 - 0.35, z0 + i + 1, PI / 2);
		decor(sim, "fence", x0 + W + 0.35, z0 + i + 1, PI / 2);
	}
	if (granary) {
		const double gx = granary.x, gz = granary.z;
		decor(sim, "cart", gx + 0.2, gz + 2.1, PI / 2 + 0.3);
		decor(sim, "hay", gx - 1.9, gz + 1.9, 0.4);
		decor(sim, "hay", gx - 2.0, gz + 1.1, 1.3, 0.85);
		decor(sim, "sheaf", gx + 2.0, gz + 1.9, 0.2);
		decor(sim, "sheaf", gx + 1.6, gz + 2.2, 0.9);
	}
	// hay bales at the outer corners
	decor(sim, "hay", x0 - 1.2, z0 - 1.2, 0.3);
	decor(sim, "hay", x0 + W + 1.2, z0 + H + 1.1, 1.1);
	decor(sim, "crate_apples", x0 + W + 1.1, z0 - 1.1, 0.5);
	decor(sim, "crate_grain", x0 - 1.1, z0 + H + 1.2, 0.2);
}

// A worn, slightly wandering dirt track between two points (column
// resolution), painted only over grass.
void paint_path(GameMap &map, double x0, double z0, double x1, double z1, double width = 1.1) {
	const int c = map.cps;
	const double len = jsm::hypot(x1 - x0, z1 - z0);
	if (len < 0.5) return;
	const double nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
	const int steps = (int)std::ceil(len * c * 2);
	int bx0 = INT32_MAX, bz0 = INT32_MAX, bx1 = INT32_MIN, bz1 = INT32_MIN;
	for (int i = 0; i <= steps; i++) {
		const double t = (double)i / steps;
		const double wob = jsm::sin(t * PI) * jsm::sin(t * 7.3 + x0 * 0.7) * 0.6;
		const double px = x0 + (x1 - x0) * t + nx * wob, pz = z0 + (z1 - z0) * t + nz * wob;
		const double hw = width * (0.8 + 0.3 * jsm::sin(t * 11 + z0));
		const int r = (int)std::ceil(hw * c);
		const double ccx = px * c, ccz = pz * c;
		for (int dz = -r; dz <= r; dz++)
			for (int dx = -r; dx <= r; dx++) {
				const int cx = (int)std::floor(ccx) + dx, cz = (int)std::floor(ccz) + dz;
				if (!map.in_cols(cx, cz)) continue;
				if (jsm::hypot(cx + 0.5 - ccx, cz + 0.5 - ccz) > hw * c) continue;
				const int i2 = map.c_idx(cx, cz), g = map.ground[i2];
				if (g != GRASS && g != DRYGRASS) continue;
				if (map.level(cx, cz) < map.water_level) continue;
				map.ground[i2] = DIRT;
				bx0 = std::min(bx0, cx); bz0 = std::min(bz0, cz); bx1 = std::max(bx1, cx + 1); bz1 = std::max(bz1, cz + 1);
			}
	}
	if (bx1 > bx0) map.mark_dirty(bx0, bz0, bx1, bz1);
}

// Mining camp dressing: ore baskets, a crate of ore and a cart by the face.
void dress_yard(Sim &sim, const SceneRef &store, const SceneRef &gold) {
	if (!store || !gold) return;
	const double dx = store.x - gold.x, dz = store.z - gold.z;
	double d = jsm::hypot(dx, dz);
	if (d == 0) d = 1;
	const double mx = gold.x + (dx / d) * 2.2, mz = gold.z + (dz / d) * 2.2;
	decor(sim, "crate_gold", mx + (dz / d) * 1.3, mz - (dx / d) * 1.3, 0.4, 1.3);
	decor(sim, "goldpile", mx - (dz / d) * 1.4, mz + (dx / d) * 1.4, 1.1, 1.1);
	decor(sim, "sack", mx + (dz / d) * 1.9, mz - (dx / d) * 0.6, 2.2, 1.2);
}

void set_stock(Sim &sim, int32_t id, std::initializer_list<std::pair<int, double>> kv) {
	const int b = sim.entities.building_slot(id);
	if (b < 0) return;
	BuildingStore &B = sim.entities.buildings;
	double *st[ST_COUNT] = { &B.stock_grain[b], &B.stock_fruit[b], &B.stock_meat[b], &B.stock_fish[b], &B.stock_wood[b], &B.stock_gold[b] };
	for (double *p : st) *p = 0;
	for (const auto &p : kv) *st[p.first] = p.second;
}

void place_unit(Sim &sim, int32_t id, double x, double z) {
	const int u = sim.entities.unit_slot(id);
	if (u < 0) return;
	UnitStore &U = sim.entities.units;
	U.x[u] = U.prev_x[u] = x;
	U.z[u] = U.prev_z[u] = z;
}

SceneCtx economy_setup(Sim &sim) {
	SceneCtx ctx;
	const Start p = sim.world.starts[0], e = sim.world.starts[1];
	Economy &econ = sim.economy;
	GameMap &map = sim.map();
	const StartResult st = standard_start(sim, PLAYER, p, 6);
	const SceneRef tc = ref_of(sim, st.tc);
	ctx.tc = tc;

	// ---- the field block: 4x3 (or 3x3) farms around a granary
	Block fb;
	const bool fields = find_field_block(sim, tc, 4, fb) || find_field_block(sim, tc, 3, fb);
	std::vector<int32_t> farms;
	SceneRef granary;
	if (fields) {
		map.paint_tiles(fb.x0 - 1, fb.z0 - 1, fb.cols * 4 + 2, 14, DIRT);
		for (int j = 0; j < 3; j++)
			for (int i = 0; i < fb.cols; i++) {
				const int tx = fb.x0 + i * 4, tz = fb.z0 + j * 4;
				if (i == 1 && j == 1) {
					granary = ref_of(sim, sim.entities.buildings.id[sim.buildings.spawn(B_STOREHOUSE, PLAYER, tx, tz + 1, true)]);
					continue;
				}
				if (sim.buildings.can_place(B_FARM, tx, tz)) farms.push_back(sim.entities.buildings.id[sim.buildings.spawn(B_FARM, PLAYER, tx, tz, true)]);
			}
		dress_fields(sim, fb.x0, fb.z0, fb.cols * 4, 12, granary);
	}
	// farms mid-harvest, each at a different point of the cycle
	for (size_t i = 0; i < farms.size(); i++) {
		const int b = sim.entities.building_slot(farms[i]);
		sim.entities.buildings.econ_rows[b] = std::fmod(i * 7.3, (double)FARM_ROWS) + FARM_ROWS * (double)(i % 3);
	}
	const std::vector<int32_t> farmers = sim.spawn_block(U_VILLAGER, PLAYER, (int)farms.size(), fields ? fb.x0 + fb.cols * 2 : tc.x,
			fields ? fb.z0 + 6 : tc.z, 0, 1.2);
	for (size_t i = 0; i < farms.size(); i++) {
		const int b = sim.entities.building_slot(farms[i]);
		double fx, fz;
		econ.farm_spot(b, fx, fz);
		place_unit(sim, farmers[i], fx, fz);
		const int u = sim.entities.unit_slot(farmers[i]);
		if (i % 3 == 1) {
			sim.entities.units.carry_type[u] = RES_FOOD;
			sim.entities.units.carry_amount[u] = 7;
		}
		sim.commands.order(u, Order::with_target(O_GATHER, farms[i]));
	}

	// ---- wood, gold and berries around the town centre
	const SceneRef wood = ref_of(sim, nearest_resource_any(sim, RES_WOOD, tc.x, tc.z));
	const SceneRef store = ref_of(sim, place_near(sim, B_STOREHOUSE, PLAYER, tc.x + (wood.x - tc.x) * 0.7, tc.z + (wood.z - tc.z) * 0.7, true, 5));
	place_near(sim, B_HOUSE, PLAYER, tc.x - 8, tc.z - 5, true, 3);
	place_near(sim, B_HOUSE, PLAYER, tc.x - 8, tc.z, true, 3);
	const std::vector<int32_t> extra = sim.spawn_block(U_VILLAGER, PLAYER, 10, tc.x, tc.tz + tc.h + 2, 0, 1.1);
	std::vector<int32_t> all = st.villagers;
	all.insert(all.end(), extra.begin(), extra.end());
	auto slice = [&](size_t a, size_t b) {
		std::vector<int32_t> v;
		for (size_t k = a; k < b && k < all.size(); k++) v.push_back(all[k]);
		return v;
	};
	const SceneRef &store_or_tc = store ? store : tc;
	assign_gatherers(sim, slice(0, 6), RES_WOOD, store_or_tc.x, store_or_tc.z);
	const SceneRef gold = ref_of(sim, nearest_resource_any(sim, RES_GOLD, tc.x, tc.z));
	// the mining camp sits on the camera side of the ore
	SceneRef gold_store;
	if (gold) {
		static const double OFF[5][2] = { { -4.5, 3.5 }, { -5, 1 }, { -3, 4.5 }, { 0, 5 }, { -5.5, -1 } };
		for (const auto &o : OFF) {
			gold_store = ref_of(sim, place_near(sim, B_STOREHOUSE, PLAYER, gold.x + o[0], gold.z + o[1], true, 1));
			if (gold_store) break;
		}
	}
	if (gold && !gold_store) gold_store = ref_of(sim, place_near(sim, B_STOREHOUSE, PLAYER, tc.x + (gold.x - tc.x) * 0.6, tc.z + (gold.z - tc.z) * 0.6, true, 4));
	{
		const SceneRef &n = gold_store ? gold_store : tc;
		assign_gatherers(sim, slice(6, 10), RES_GOLD, n.x, n.z);
	}
	// miners start at the face on the near side, already swinging
	if (gold) {
		const std::vector<int32_t> miners = slice(6, 10);
		for (size_t i = 0; i < miners.size(); i++) {
			const double a = PI * (0.15 + i * 0.28), r = 1.7;
			double wx, wz;
			if (open_ground(sim, gold.x + jsm::cos(a) * r, gold.z + jsm::sin(a) * r, wx, wz)) place_unit(sim, miners[i], wx, wz);
		}
	}
	SceneRef near_berry;
	{
		const ResourceStore &R = sim.entities.resources;
		struct Bd { int32_t id; double d; };
		std::vector<Bd> berries;
		for (int i = 0; i < R.size(); i++) {
			if (R.removed[i] || R.type[i] != R_BERRY) continue;
			const double dx = R.x[i] - tc.x, dz = R.z[i] - tc.z;
			berries.push_back({ R.id[i], dx * dx + dz * dz });
		}
		std::stable_sort(berries.begin(), berries.end(), [](const Bd &a, const Bd &b) { return a.d < b.d; });
		if (!berries.empty()) near_berry = ref_of(sim, berries[0].id);
	}
	{
		const SceneRef &n = near_berry ? near_berry : tc;
		assign_gatherers(sim, slice(10, 13), RES_FOOD, n.x, n.z);
	}
	const int32_t house = place_near(sim, B_HOUSE, PLAYER, tc.x + 8, tc.z - 5, false, 3, 1, 0.05);
	if (house && all.size() > 13) sim.commands.order(sim.entities.unit_slot(all[13]), Order::with_target(O_BUILD, house));
	assign_gatherers(sim, slice(14, 16), RES_WOOD, store_or_tc.x, store_or_tc.z);
	const int tcb = sim.entities.building_slot(tc.id);
	BuildingStore &B = sim.entities.buildings;
	if (gold) {
		B.rally[tcb] = 1;
		B.rally_x[tcb] = gold.x;
		B.rally_z[tcb] = gold.z;
		B.rally_target[tcb] = gold.id;
	}
	econ.train(tcb, U_VILLAGER);
	// pre-stocked yards so storehouses look lived-in
	if (store) set_stock(sim, store.id, { { ST_WOOD, 260 } });
	if (gold_store) set_stock(sim, gold_store.id, { { ST_GOLD, 180 } });
	if (granary) set_stock(sim, granary.id, { { ST_GRAIN, 300 }, { ST_FRUIT, 60 } });
	set_stock(sim, tc.id, { { ST_GRAIN, 80 }, { ST_MEAT, 60 }, { ST_WOOD, 40 } });

	// ---- hunting: a deer herd and a boar out past the houses
	econ.wildlife.spawned = true; // this scene places its own game
	double hx = 0, hz = 0;
	bool hunt = (fields && open_ground(sim, fb.x0 + fb.cols * 4 + 3.2, fb.z0 + 7, hx, hz)) || open_ground(sim, tc.x - 5, tc.z + 13, hx, hz) ||
			open_ground(sim, tc.x + 12, tc.z - 10, hx, hz);
	if (hunt) {
		ctx.hunt_spot = { hx, hz };
		const std::vector<int32_t> herd = econ.wildlife.spawn_herd(R_DEER, hx, hz, 7);
		ResourceStore &R = sim.entities.resources;
		int h0 = herd.empty() ? -1 : sim.entities.resource_slot(herd[0]);
		// one deer already down: hunters butcher it at the edge of the fields
		if (h0 >= 0) {
			econ.wildlife.hit(h0, 99, tc.x, tc.z);
			R.amount[h0] = R.max_amount[h0] = 160;
		}
		const std::vector<int32_t> hunters = sim.spawn_block(U_VILLAGER, PLAYER, 3, h0 >= 0 ? R.x[h0] - 1 : hx, h0 >= 0 ? R.z[h0] : hz, 0, 1.0);
		static const double LOADS[3] = { 0, 4.5, 8.5 };
		for (size_t i = 0; i < hunters.size(); i++) {
			if (h0 < 0) break;
			const int u = sim.entities.unit_slot(hunters[i]);
			sim.commands.order(u, Order::with_target(O_GATHER, herd[0]));
			sim.entities.units.carry_type[u] = RES_FOOD; // out of step with each other
			sim.entities.units.carry_amount[u] = LOADS[i % 3];
		}
		double bx, bz;
		if (open_ground(sim, hx + 2, hz + 6, bx, bz)) econ.wildlife.spawn_herd(R_BOAR, bx, bz, 1);
	}

	// ---- fishing: a harbour storehouse on the nearest shore, boats on the shoals
	Fishing &fish = econ.fishing;
	double wx = 0, wz = 0;
	const bool water = nearest_water(sim, tc.x, tc.z, 40, wx, wz);
	if (water) {
		const double dx = tc.x - wx, dz = tc.z - wz;
		double d = jsm::hypot(dx, dz);
		if (d == 0) d = 1;
		int32_t dock = 0;
		for (int k = 3; k < 9 && !dock; k++) dock = place_near(sim, B_STOREHOUSE, PLAYER, wx + (dx / d) * k, wz + (dz / d) * k, true, 1);
		if (dock) set_stock(sim, dock, { { ST_FISH, 140 }, { ST_MEAT, 50 } });
	}
	double shx, shz;
	int32_t shb;
	if (fish.find_dock(PLAYER, water ? wx : tc.x, water ? wz : tc.z, shx, shz, shb)) {
		const double dx = shx - tc.x, dz = shz - tc.z;
		double d = jsm::hypot(dx, dz);
		if (d == 0) d = 1;
		int placed = 0;
		for (int k = 0; k < 60 && placed < 4; k++) {
			const double ang = jsm::atan2(dz, dx) + ((k % 9) - 4) * 0.12;
			const double r = d + 5 + std::floor(k / 9.0) * 2;
			const double sx = tc.x + jsm::cos(ang) * r, sz = tc.z + jsm::sin(ang) * r;
			if (!fish.is_open(sx, sz, 1.4)) continue;
			bool close = false;
			for (const Shoal &s : fish.shoals)
				if (jsm::hypot(s.x - sx, s.z - sz) < 4.5) { close = true; break; }
			if (close) continue;
			fish.spawn_shoal(sx, sz, 400);
			placed++;
		}
		fish.populate(); // plus shoals elsewhere on the map
		static const double BOATS[4][2] = { { 1.5, 0 }, { -1.2, 1.2 }, { 0.4, -1.8 }, { -2, -1 } };
		for (int i = 0; i < 4; i++) {
			Boat &b = fish.boats[fish.spawn_boat(PLAYER, shx + BOATS[i][0], shz + BOATS[i][1], i * 2)];
			if (!fish.is_water(b.x, b.z)) { b.x = b.prev_x = shx; b.z = b.prev_z = shz; }
			if (i == 2) b.carry = 12;
		}
	}

	// worn dirt paths: town centre <-> fields, mine, woodline, berries, hunt
	auto tc_edge = [&](double x, double z, double &ex, double &ez) {
		ex = std::max(tc.tx - 0.5, std::min(tc.tx + tc.w + 0.5, x));
		ez = std::max(tc.tz - 0.5, std::min(tc.tz + tc.h + 0.5, z));
	};
	auto trail = [&](const SceneRef &b, double w) {
		if (!b) return;
		double ex, ez;
		tc_edge(b.x, b.z, ex, ez);
		paint_path(map, ex, ez, b.x, b.z, w);
	};
	if (fields) {
		const double gz = fb.z0 + 6;
		paint_path(map, tc.tx + tc.w, tc.z, fb.x0 - 0.5, gz, 1.4);
		paint_path(map, fb.x0 + fb.cols * 2, fb.z0 + 12.5, fb.x0 + fb.cols * 2 - 3, fb.z0 + 17, 1.0);
	}
	trail(gold_store, 1.3);
	if (gold && gold_store) paint_path(map, gold_store.x, gold_store.z, gold.x, gold.z, 1.2);
	trail(store, 1.2);
	if (wood && store) paint_path(map, store.x, store.z, wood.x, wood.z, 0.9);
	trail(near_berry, 1.0);
	if (hunt && fields) paint_path(map, fb.x0 + fb.cols * 4 + 0.5, fb.z0 + 6, hx, hz, 0.9);
	dress_yard(sim, gold_store, gold);

	standard_start(sim, ENEMY, e, 6);
	sim.combat.ai().enabled = true;
	sim.combat.ai().next_wave_at = 1e9; // keep the economy scene peaceful

	// frame the town centre, the mine and the field block tightly
	const double fcx = fields ? fb.x0 + fb.cols * 2 : tc.x + 8, fcz = fields ? fb.z0 + 6 : tc.z + 4;
	ctx.ok = true;
	ctx.focus_x = tc.x * 0.4 + fcx * 0.6 + 1;
	ctx.focus_z = tc.z * 0.45 + fcz * 0.55;
	ctx.fields = fields;
	if (fields) { ctx.fields_x0 = fb.x0; ctx.fields_z0 = fb.z0; ctx.fields_cols = fb.cols; }
	ctx.granary = granary;
	for (int32_t f : farms) ctx.farms.push_back(ref_of(sim, f));
	ctx.gold = gold;
	ctx.gold_store = gold_store;
	ctx.store = store;
	ctx.wood = wood;
	ctx.near_berry = near_berry;
	return ctx;
}

// After the fast-forward: put a few porters mid-trip with full loads.
void economy_after(Sim &sim, const SceneCtx &ctx) {
	struct Trip { SceneRef res, drop; double k, dx, dz; };
	std::vector<Trip> trips;
	auto leg = [&](const SceneRef &res, const SceneRef &drop, double k, double dx = 0, double dz = 0) {
		if (res && drop) trips.push_back({ res, drop, k, dx, dz });
	};
	std::vector<SceneRef> farms_w;
	for (const SceneRef &f : ctx.farms)
		if (ctx.fields && f.tx == ctx.fields_x0) farms_w.push_back(f);
	leg(farms_w.empty() ? SceneRef() : farms_w.front(), ctx.tc, 0.55, 0, 0.4);
	leg(farms_w.empty() ? SceneRef() : farms_w.back(), ctx.tc, 0.35, 0.3, 0);
	SceneRef far_e;
	for (const SceneRef &f : ctx.farms)
		if (ctx.fields && f.tz == ctx.fields_z0 + 8) far_e = f;
	leg(far_e, ctx.granary, 0.5);
	leg(ctx.gold, ctx.gold_store, 0.45, 0.4, 0.3);
	leg(ctx.gold, ctx.tc, 0.6, -0.3, 0);
	leg(ctx.wood, ctx.store, 0.5);
	leg(ctx.wood, ctx.tc, 0.55, 0.2, 0.5);
	leg(ctx.near_berry, ctx.tc, 0.5);
	for (const Trip &t : trips) {
		const double ex = std::max(t.drop.tx - 0.4, std::min(t.drop.tx + t.drop.w + 0.4, t.res.x));
		const double ez = std::max(t.drop.tz - 0.4, std::min(t.drop.tz + t.drop.h + 0.4, t.res.z));
		double wx, wz;
		if (!open_ground(sim, t.res.x + (ex - t.res.x) * t.k + t.dx, t.res.z + (ez - t.res.z) * t.k + t.dz, wx, wz)) continue;
		const int u = sim.units.spawn(U_VILLAGER, PLAYER, wx, wz, 0);
		if (u < 0) continue;
		// (set up by hand: a farm already has its farmer, so a gather order
		// onto it would be refused)
		const int res_type = t.res.farm ? RES_FOOD : t.res.res_type;
		UnitStore &U = sim.entities.units;
		Order o = Order::with_target(O_GATHER, t.res.id);
		sim.commands.set(u, o);
		sim.economy.set_econ(u, EP_TO_DROP, t.res.id, res_type, t.drop.id, 0.4);
		U.carry_type[u] = (uint8_t)res_type;
		U.carry_amount[u] = unit_def(U_VILLAGER).carry_cap;
		GoalRect g{ (double)t.drop.tx, (double)t.drop.tz, (double)t.drop.w, (double)t.drop.h };
		sim.movement.move_to(u, t.drop.x, t.drop.z, &g);
	}
	sim.fast_forward(0.3);
}

} // namespace

bool has(const std::string &n) {
	return n == "skirmish" || n == "town" || n == "coast" || n == "hud" || n == "economy" || n == "battle" || n == "godpower" ||
			n == "stress" || n == "egypt" || n == "egypt_set"; // (egypt, egypt_set: Godot-only, sim/civ/egypt_scene.cpp)
}

SceneCtx setup(Sim &sim, const std::string &name, const SceneOpts &opts) {
	if (name == "battle") return battle_setup(sim);
	if (name == "godpower") return godpower_setup(sim);
	if (name == "stress") return stress_setup(sim, opts.units, opts.fort);
	if (name == "egypt") return egypt_scene_setup(sim);
	if (name == "egypt_set") return egypt_set_scene_setup(sim);
	SceneCtx ctx;
	const auto &starts = sim.world.starts;
	if (starts.size() < 2) return ctx;
	const Start p = starts[0], e = starts[1];
	if (name == "skirmish") {
		const StartResult me = standard_start(sim, PLAYER, p, 5);
		standard_start(sim, ENEMY, e, 5);
		sim.combat.ai().enabled = true;
		const SceneRef tc = ref_of(sim, me.tc);
		ctx.tc = tc;
		ctx.focus_x = tc.x;
		ctx.focus_z = tc.z;
		ctx.ok = true;
	} else if (name == "town") {
		const TownResult t = build_town(sim, PLAYER, p, 28, 6);
		standard_start(sim, ENEMY, e, 3);
		sim.players[PLAYER].age = 1;
		ctx.tc = ref_of(sim, t.tc);
		ctx.focus_x = ctx.tc.x;
		ctx.focus_z = ctx.tc.z;
		ctx.villagers = t.villagers;
		ctx.army = t.army;
		ctx.ok = true;
	} else if (name == "coast") {
		const TownResult t = build_town(sim, PLAYER, p, 16, 3);
		// shoreline focus: find the first water column east of the town
		const GameMap &map = sim.map();
		int sx = p.tx + 10;
		while (sx < map.size - 1 && !(map.level(sx * map.cps, p.tz * map.cps) < map.water_level)) sx++;
		ctx.tc = ref_of(sim, t.tc);
		ctx.focus_x = (ctx.tc.x + sx) / 2 + 3;
		ctx.focus_z = ctx.tc.z + 2;
		ctx.ok = true;
	} else if (name == "hud") {
		const TownResult t = build_town(sim, PLAYER, p, 20, 5);
		standard_start(sim, ENEMY, e, 3);
		Player &pl = sim.players[PLAYER];
		pl.res[RES_FOOD] = 845;
		pl.res[RES_WOOD] = 612;
		pl.res[RES_GOLD] = 430;
		pl.res[RES_FAVOR] = 37;
		const int tcb = sim.entities.building_slot(t.tc);
		sim.economy.train(tcb, U_VILLAGER);
		sim.economy.train(tcb, U_VILLAGER);
		ctx.tc = ref_of(sim, t.tc);
		ctx.focus_x = ctx.tc.x;
		ctx.focus_z = ctx.tc.z;
		if (!t.villagers.empty()) ctx.select = { t.villagers[0] };
		ctx.villagers = t.villagers;
		ctx.army = t.army;
		ctx.ok = true;
	} else if (name == "economy") {
		ctx = economy_setup(sim);
	}
	return ctx;
}

void after(Sim &sim, const std::string &name, const SceneCtx &ctx) {
	if (name == "economy" && ctx.ok) economy_after(sim, ctx);
	if (name == "battle" && ctx.ok) battle_after(sim, ctx);
}

} // namespace scenes
} // namespace aov
