// The "egypt" scene (Godot-only, sim/civ; godot --path godot -- --scene=egypt):
// player 1 an Egyptian (Ra) in the Mythic Age at the first start: his Town
// Center, Laborers gathering at a Lumber Camp (empowered by the Pharaoh), a
// Mining Camp and a Granary, Houses, the five Monuments, an Obelisk, a
// Temple, a Barracks and a Migdol; his army in ranks before the Town Center
// with two Priests healing wounded Spearmen; a Greek player 2 at the second
// start. Needs the rules on (an empty context otherwise).
#include "../scenes/scenes.h"
#include "../sim.h"

namespace aov {

SceneCtx egypt_scene_setup(Sim &sim) {
	SceneCtx ctx;
	const auto &starts = sim.world.starts;
	if (!sim.godot_rules || starts.size() < 2) return ctx;
	Player &p = sim.players[PLAYER];
	p.civ = CIV_EGYPT;
	p.god = "Ra";
	p.age = 3;
	p.res[RES_FOOD] = 1800;
	p.res[RES_WOOD] = 600;
	p.res[RES_GOLD] = 1400;
	p.res[RES_FAVOR] = 0;
	const CivStart st = sim.civs.egypt_start(PLAYER, starts[0], 5);
	scenes::standard_start(sim, ENEMY, starts[1], 5);
	const int tcb = sim.entities.building_slot(st.tc);
	const BuildingStore &B = sim.entities.buildings;
	const double tx = B.x[tcb], tz = B.z[tcb];
	// drop sites by the nearest woods, mine and berries; Laborers on them
	const int32_t wood = scenes::nearest_resource_any(sim, RES_WOOD, tx, tz);
	const int32_t gold = scenes::nearest_resource_any(sim, RES_GOLD, tx, tz);
	const int32_t food = scenes::nearest_resource_any(sim, RES_FOOD, tx, tz);
	auto near_of = [&](int32_t id, double &x, double &z) {
		const int s = sim.entities.resource_slot(id);
		x = s >= 0 ? sim.entities.resources.x[s] : tx;
		z = s >= 0 ? sim.entities.resources.z[s] : tz;
		// two thirds of the way from the TC to the node
		x = tx + (x - tx) * 0.72;
		z = tz + (z - tz) * 0.72;
	};
	double x, z;
	near_of(wood, x, z);
	const int32_t lumber = scenes::place_near(sim, B_LUMBER_CAMP, PLAYER, x, z, true, 6, 1);
	std::vector<int32_t> lw = sim.spawn_block(U_LABORER, PLAYER, 5, x, z + 1.5, 0, 1.1);
	scenes::assign_gatherers(sim, lw, RES_WOOD, x, z);
	near_of(gold, x, z);
	scenes::place_near(sim, B_MINING_CAMP, PLAYER, x, z, true, 6, 1);
	std::vector<int32_t> lg = sim.spawn_block(U_LABORER, PLAYER, 4, x, z + 1.5, 0, 1.1);
	scenes::assign_gatherers(sim, lg, RES_GOLD, x, z);
	near_of(food, x, z);
	scenes::place_near(sim, B_GRANARY, PLAYER, x, z, true, 6, 1);
	scenes::assign_gatherers(sim, st.workers, RES_FOOD, x, z);
	if (lumber && st.pharaoh) sim.commands.order(sim.entities.unit_slot(st.pharaoh), Order::with_target(O_EMPOWER, lumber));
	// the town round the Town Center (place_near finds free lots)
	const double ring = 13;
	scenes::place_near(sim, B_TEMPLE, PLAYER, tx, tz - ring, true, 8, 1);
	scenes::place_near(sim, B_EG_BARRACKS, PLAYER, tx + ring, tz - 4, true, 8, 1);
	scenes::place_near(sim, B_MIGDOL, PLAYER, tx - ring - 2, tz - 5, true, 8, 1);
	for (int i = 0; i < 8; i++) scenes::place_near(sim, B_HOUSE, PLAYER, tx - 15 + i * 4, tz - 10 - (i % 2) * 4, true, 6, 1);
	for (int k = 0; k < MONUMENT_COUNT; k++)
		scenes::place_near(sim, B_MONUMENT_VILLAGERS + k, PLAYER, tx + 9 + k * 3.2, tz + 10, true, 6, 1);
	scenes::place_near(sim, B_OBELISK, PLAYER, tx - 6, tz + 6, true, 6, 1);
	// the army in ranks south of the Town Center
	const double ax = tx, az = tz + 9;
	const struct { int type, n; double dx, dz; } RANKS[] = {
		{ U_SPEARMAN, 6, -6, 0 }, { U_AXEMAN, 6, 0, 0 }, { U_SLINGER, 6, 6, 0 },
		{ U_CHARIOT_ARCHER, 3, -6, 4 }, { U_CAMEL_RIDER, 3, 0, 4 }, { U_WAR_ELEPHANT, 2, 6, 4.5 },
	};
	for (const auto &rk : RANKS) {
		const std::vector<int32_t> ids = sim.spawn_block(rk.type, PLAYER, rk.n, ax + rk.dx, az + rk.dz, 3, rk.type == U_WAR_ELEPHANT ? 2.6 : 1.5);
		ctx.army.insert(ctx.army.end(), ids.begin(), ids.end());
	}
	// two Priests by the first rank, its men wounded
	sim.spawn_block(U_PRIEST, PLAYER, 2, ax - 6, az - 2.2, 2, 1.6);
	UnitStore &U = sim.entities.units;
	for (int i = 0; i < 3 && i < (int)ctx.army.size(); i++) {
		const int r = sim.entities.unit_slot(ctx.army[i]);
		if (r >= 0) U.hp[r] = U.max_hp[r] * (0.35 + 0.15 * i);
	}
	ctx.tc.id = st.tc;
	ctx.tc.x = tx;
	ctx.tc.z = tz;
	ctx.tc.tx = B.tx[tcb];
	ctx.tc.tz = B.tz[tcb];
	ctx.tc.w = B.w[tcb];
	ctx.tc.h = B.h[tcb];
	ctx.focus_x = ax;
	ctx.focus_z = az - 3;
	ctx.ok = true;
	return ctx;
}

} // namespace aov
