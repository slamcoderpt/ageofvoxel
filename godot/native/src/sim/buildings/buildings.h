// Buildings piece, simulation half: port of the sim side of
// src/buildings/ (index.js, placement.js confirm, town.js): spawning (with
// the ground dressing: plaza, yard, forecourt, street to the Town Center,
// roads), placement validation, foundations, construction by builders
// (O_BUILD), builders moving on when a site is finished, destruction, and
// the planned Greek town of the town / coast / hud scenes. Bit-exact with
// the browser (scripts/check-sim.mjs).
//
// The visual variant (variantOf), house yaw and setback (houseYaw /
// houseSetback) are computed here at spawn, in id order like the JS first
// render, and exported by get_buildings(); game/buildings/buildings.gd
// draws the exported models.
//
// A build order may carry the order the builder had before placement sent it
// (order.resume): order_b = resume type + 1 (0 = none), order_c = resume
// target id, order_a = resume resType + 1 (0 = undefined).
#pragma once
#include <cstdint>
#include <vector>

#include "defs.h"

namespace aov {

class Sim;
struct Start;

class Buildings {
public:
	Sim *sim = nullptr;

	void init(Sim *s);
	// buildings.spawn(type, owner, tx, tz, {built, site}) -> row
	int spawn(int type, int owner, int tx, int tz, bool built = true, bool site = true);
	bool can_place(int type, int tx, int tz) const;
	// placement.confirm(): pay, spawn a foundation, order the builders
	// (remembering a gather / worship order to resume). Returns the id or 0.
	int32_t place(int type, int owner, int tx, int tz, const std::vector<int> &builder_rows);
	void destroy(int32_t id);
	void update(double dt);
	void complete(int row);
	int32_t nearest_site(int urow, double max_dist) const;
	bool resume(int urow, int type, int32_t target, int res_type);

	// ground dressing (index.js)
	void pave_plaza(int tx, int tz, int w, int h, double r);
	int ground_at(int tx, int tz) const;
	void yard(int tx, int tz, int w, int h, double r);
	bool in_footprint(int x, int z) const;
	void pave_street(int row);
	void pave_roads(int row);

	// town.js layoutTown(owner, start)
	struct Town {
		int32_t tc = 0, temple = 0, barracks = 0, store = 0, store2 = 0, house2 = 0;
		std::vector<int32_t> houses, farms;
	};
	Town layout_town(int owner, const Start &start);

private:
	int variant_of(int row);
};

} // namespace aov
