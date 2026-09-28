// God powers, simulation half: port of the sim side of src/godpowers/index.js:
// favor costs and cooldowns, Zeus's Lightning Storm (a whirlwind that strikes
// enemy units at random, snatches men off their feet, carries them round
// the funnel and flings them out) and Bolt (one strike that slays a
// target), Hephaestus's Meteor, lightning damage and splash, units thrown by
// a strike (knockback, tumbling, landing). Bit-exact with the browser
// (scripts/check-sim.mjs).
//
// Thrown units carry air_y (height above the ground) and air_rx / air_rz
// (tumble) in their unit columns, read by the units renderer.
//
// The lists the renderer draws from (bolts, scorches, zaps, meteors, fires)
// are kept here with their seeds; the voxel debris, sparks, smoke and the
// bolt channels (boltLines) are visual and belong to game/godpowers.
// Deviation: cosmetic randomness (sky bolts) uses its own RNG like the JS
// vrng, but the JS also draws it for smoke and flames, so sky-bolt timing
// differs from the browser. It never touches the sim.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "../core/players.h"
#include "../core/rng.h"

namespace aov {

class Sim;

enum PowerId : uint8_t { GP_LIGHTNING_STORM, GP_BOLT, GP_METEOR, GP_COUNT };

struct PowerDef {
	const char *key, *name, *god;
	Cost cost;
	double cooldown, radius, duration, interval, damage, splash, delay;
	const char *hotkey, *desc;
};
const PowerDef &power_def(int id);
int power_of(const char *key); // -1 if unknown

struct Storm {
	int owner;
	double x, z, t0, duration, radius, next, sky;
	bool done = false;
};
struct Bolt { double x, y, z, t0, life; uint32_t seed; bool sky; };
struct Scorch { double x, y, z, t0; uint32_t seed; double size; bool blast; };
struct Zap { int32_t unit; double x, y, z, t0, life; uint32_t seed; };
struct Meteor { int owner; double x, z, t0, delay, radius, sx, sy, sz; bool done = false; };
struct Fire { double x, y, z, r, t0, dur; bool done = false; };

struct CastCheck { bool ok; std::string reason; };

class GodPowers {
public:
	Sim *sim = nullptr;
	std::vector<Storm> storms; // never shrunk (thrown units refer to their storm by index)
	std::vector<Bolt> bolts;
	std::vector<Scorch> scorches;
	std::vector<Zap> zaps;
	std::vector<Meteor> meteors;
	std::vector<Fire> fires;
	std::vector<int32_t> airborne; // unit ids
	double cooldowns[MAX_PLAYERS][GP_COUNT] = {};
	RNG vrng{ 8675309 };

	void init(Sim *s);
	double cooldown_left(int owner, int id) const;
	CastCheck can_cast(int owner, int id) const;
	bool cast(int owner, int id, double x, double z);
	void update(double dt);

	// findTarget(owner, x, z, r, random, grounded): unit row or -1
	int find_target(int owner, double x, double z, double r, bool random = false, bool grounded = false);
	void strike(int owner, double x, double z, double damage, double splash, int target_row);
	void knock(int row, double x, double z, double power);

private:
	void zap(int row);
	void impact_meteor(const Meteor &m);
	void vortex(int storm, double dt);
	void update_airborne(double dt);
	void add_airborne(int row);
	std::vector<int> near(double x, double z, double r, int owner, int32_t exclude_id = 0); // living enemy unit rows
};

} // namespace aov
