// Deterministic scene setups (port of src/core/scenes/helpers.js, the
// skirmish / town / coast / hud entries of src/core/scenes/index.js and
// src/economy/EconomyScene.js). They run in C++ because they draw from the
// sim's seeded RNG (spawnBlock jitter, unit anim clocks) and must interleave
// with the sim exactly like the browser for the parity checks.
//
//   Scenes::setup(sim, "economy") -> SceneCtx (focus + the ids the scene's
//   after() and the GDScript side need); Scenes::after(sim, "economy", ctx)
//   after the fast-forward (main.gd calls both through AovSim).
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace aov {

class Sim;
struct Start;

// A snapshot of an entity the scene refers to later (the JS keeps the object,
// which still has its position after it is removed).
struct SceneRef {
	int32_t id = 0;
	double x = 0, z = 0;
	int tx = 0, tz = 0, w = 0, h = 0;
	int res_type = 255; // resources: ResKind; farms: food
	bool farm = false;
	explicit operator bool() const { return id != 0; }
};

struct SceneCtx {
	bool ok = false;
	double focus_x = 0, focus_z = 0;
	// economy scene
	bool fields = false;
	int fields_x0 = 0, fields_z0 = 0, fields_cols = 0;
	SceneRef tc, granary, gold, gold_store, store, wood, near_berry;
	std::vector<SceneRef> farms;
	std::vector<double> hunt_spot; // [x, z] or empty
	// hud scene: selection and control groups for the UI
	std::vector<int32_t> select, army, villagers;
};

namespace scenes {

// helpers.js
int32_t place_near(Sim &sim, int type, int owner, double cx, double cz, bool built = true, int max_r = 6, int gap = 1, double progress = -1);
std::vector<int32_t> assign_gatherers(Sim &sim, const std::vector<int32_t> &villagers, int res, double nx, double nz, int32_t *first = nullptr);
int32_t nearest_resource_any(Sim &sim, int res, double x, double z); // helpers.nearestResource
struct StartResult { int32_t tc; std::vector<int32_t> villagers; };
StartResult standard_start(Sim &sim, int owner, const Start &start, int villagers = 5);
struct TownResult { int32_t tc; std::vector<int32_t> villagers, army; };
TownResult build_town(Sim &sim, int owner, const Start &start, int villagers = 24, int soldiers = 6);

// URL-style scene parameters (the stress scene's ?units=N)
struct SceneOpts {
	int units = 2000;
};

bool has(const std::string &name);
SceneCtx setup(Sim &sim, const std::string &name, const SceneOpts &opts = SceneOpts());
void after(Sim &sim, const std::string &name, const SceneCtx &ctx);

// combat scenes (scenes/battle.cpp): src/combat/BattleScene.js (with
// src/units/battleHost.js), the godpower entry of src/core/scenes/index.js,
// src/core/scenes/stress.js
SceneCtx battle_setup(Sim &sim);
void battle_after(Sim &sim, const SceneCtx &ctx);
SceneCtx godpower_setup(Sim &sim);
SceneCtx stress_setup(Sim &sim, int units);

} // namespace scenes
} // namespace aov
