// Locomotion: path following + steering (separation, sliding along blocked
// tiles, stuck detection with re-pathing). Bit-exact port of
// src/core/Movement.js over the SoA unit store. Other systems ask units to
// move with move_to() and poll units.moving / units.arrived.
//
// Scaling: the spatial hash is flat (see spatial_hash.h), separation walks
// the cells inline, paths come from the cached pathfinder, and stuck
// re-paths can be staggered with `repath_budget` (max re-paths per tick,
// 0 = unlimited, the JS behaviour): over budget, a unit keeps following its
// old path and re-paths on a later tick (deterministic, in row order).
#pragma once
#include <cstdint>

#include "pathfinding.h"
#include "spatial_hash.h"

namespace aov {

class Sim;

class Movement {
public:
	Sim *sim = nullptr;
	SpatialHash hash;
	int repath_budget = 0;
	int repaths_this_tick = 0;

	void init(Sim *s);
	// JS moveTo(u, x, z, {goalRect, range}); returns u.moving || u.arrived
	bool move_to(int row, double x, double z, const GoalRect *rect = nullptr, double range = 0);
	void stop(int row);
	bool within_goal(int row) const;
	// JS distanceTo(u, e): to a building / resource footprint edge, or a unit's radius
	double distance_to(int row, int32_t id) const;
	void release_path(int row);
	void update(double dt);

private:
	void repath(int row);
};

} // namespace aov
