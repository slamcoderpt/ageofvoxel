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
	sim.techs.auto_minor(PLAYER); // (his minor gods for the ages set above: Bast, Sobek, Horus; their myth units at the Temple)
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

// The "egypt_set" scene (godot --path godot -- --scene=egypt_set): player 1 an Egyptian
// of Set reaching the Heroic Age at his Temple: the age-ups' Gazelles, Hyena, Giraffes
// and Crocodile there, the Pharaoh beside it summoning Baboons and a Hyena, a Priest
// converting a deer herd, Laborers butchering a Gazelle of Set that fell (its carcass
// at a Granary), and a Greek player 2 at the second start.
SceneCtx egypt_set_scene_setup(Sim &sim) {
	SceneCtx ctx;
	const auto &starts = sim.world.starts;
	if (!sim.godot_rules || starts.size() < 2) return ctx;
	Player &p = sim.players[PLAYER];
	p.civ = CIV_EGYPT;
	p.god = "Set";
	p.age = 0;
	p.res[RES_FOOD] = 1200;
	p.res[RES_WOOD] = 600;
	p.res[RES_GOLD] = 1000;
	p.res[RES_FAVOR] = 120;
	const CivStart st = sim.civs.egypt_start(PLAYER, starts[0], 5);
	scenes::standard_start(sim, ENEMY, starts[1], 5);
	const BuildingStore &B = sim.entities.buildings;
	const int tcb = sim.entities.building_slot(st.tc);
	const double tx = B.x[tcb], tz = B.z[tcb];
	for (int i = 0; i < 4; i++) scenes::place_near(sim, B_HOUSE, PLAYER, tx - 9 + i * 4, tz - 9, true, 6, 1);
	sim.clear_rect((int)tx + 4, (int)tz - 5, 22, 22); // (an open ground before the Temple)
	const int32_t temple = scenes::place_near(sim, B_TEMPLE, PLAYER, tx + 12, tz + 2, true, 8, 1);
	const int tb = sim.entities.building_slot(temple);
	const double mx = tb >= 0 ? B.x[tb] : tx + 12, mz = tb >= 0 ? B.z[tb] : tz + 2;
	sim.economy.recount();
	// the age-ups at the Temple (Classical, Heroic)
	sim.civs.age_set(PLAYER, 0, 2);
	p.age = 2;
	// the Pharaoh by the Temple, summoning while he walks
	UnitStore &U = sim.entities.units;
	const int ph = sim.entities.unit_slot(st.pharaoh);
	if (ph >= 0) {
		U.x[ph] = U.prev_x[ph] = mx - 4;
		U.z[ph] = U.prev_z[ph] = mz + 5;
		sim.commands.move({ ph }, mx + 2, mz + 7);
		sim.civs.summon(ph, U_BABOON);
		sim.civs.summon(ph, U_HYENA_OF_SET);
		sim.civs.summon(ph, U_CROCODILE_OF_SET);
	}
	// a Priest converting a deer herd past the Temple
	const std::vector<int32_t> herd = sim.economy.wildlife.spawn_herd(R_DEER, mx + 7, mz + 8, 4);
	const std::vector<int32_t> pr = sim.spawn_block(U_PRIEST, PLAYER, 1, mx + 2, mz + 8, 1, 1.1);
	if (!herd.empty() && !pr.empty()) sim.commands.order(sim.entities.unit_slot(pr[0]), Order::with_target(O_CONVERT, herd[0]));
	// a fallen Gazelle of Set by a Granary, its carcass butchered by Laborers
	const int32_t gran = scenes::place_near(sim, B_GRANARY, PLAYER, tx - 4, tz + 10, true, 6, 1);
	const int gs = sim.entities.building_slot(gran);
	if (gs >= 0) {
		const std::vector<int32_t> gz = sim.spawn_block(U_GAZELLE_OF_SET, PLAYER, 1, B.x[gs] + 3.5, B.z[gs] + 1, 1, 1.1);
		if (!gz.empty()) sim.combat.kill(gz[0], Hitter());
		const int32_t carcass = gz.empty() || sim.economy.wildlife.animals.empty() ? 0 : sim.economy.wildlife.animals.back(); // (its carcass)
		const std::vector<int32_t> lab = sim.spawn_block(U_LABORER, PLAYER, 3, B.x[gs] + 2, B.z[gs] + 3, 3, 1.1);
		if (carcass)
			for (int32_t id : lab) sim.commands.order(sim.entities.unit_slot(id), Order::with_target(O_GATHER, carcass));
	}
	ctx.tc.id = st.tc;
	ctx.tc.x = tx;
	ctx.tc.z = tz;
	ctx.tc.tx = B.tx[tcb];
	ctx.tc.tz = B.tz[tcb];
	ctx.tc.w = B.w[tcb];
	ctx.tc.h = B.h[tcb];
	ctx.focus_x = mx + 1;
	ctx.focus_z = mz + 6;
	ctx.ok = true;
	return ctx;
}

} // namespace aov
