// Units piece, simulation half (port of the update() side of
// src/units/index.js): spawning, the per-tick animation state machine
// (anim state from moving / anim_want, attack and hit timers, death and
// corpse removal) and local avoidance for standing units (_spread,
// _clearCorpse). Rendering (rigs, poses, instancing) is game/units.
//
// Other systems request an animation for this tick by setting
// units.anim_want[row] = A_GATHER | A_BUILD | A_ATTACK | A_WORSHIP.
// The visual-only crowd variety of the JS (units_press / units_yaw) is left
// to the renderer: it depends only on per-unit hashes, the anim clock and
// the target, all readable from the packed arrays.
#pragma once
#include <cstdint>

#include "defs.h"

namespace aov {

class Sim;

constexpr double CORPSE_TIME = 26;
constexpr double FADE_START = 22.5;
constexpr double SPREAD_GAP = 1.35;
constexpr double SPREAD_SPEED = 2.0;
constexpr double CORPSE_CLEAR = 0.5;

class Units {
public:
	Sim *sim = nullptr;
	void init(Sim *s) { sim = s; }
	// JS units.spawn(type, owner, x, z, {rot}); returns the row (id in units.id)
	int spawn(int type, int owner, double x, double z, double rot = 0);
	void update(double dt);
	void spread(double dt);

private:
	void clear_corpse(int row, double dt);
};

} // namespace aov
