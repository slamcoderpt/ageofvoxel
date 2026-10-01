// Fortifications, simulation half (Godot-only, behind Sim::godot_rules; the
// browser build has none): Greek walls, gates and towers in the spirit of
// Age of Mythology: Retold. See godot/PORTING.md "Walls, gates, towers".
//
// Pieces are ordinary building rows (types B_WALL, B_WALL_PILLAR, B_GATE,
// B_TOWER in buildings/defs.h), so construction by villagers (several
// builders speed it up: rate x n^0.75), repair (a build order on a damaged
// piece: free), damage, death, fog sight and selection all go through the
// existing systems. What is special lives here:
//
// - Walls: place_wall(owner, a, b) lays a 4-connected line of tiles from tile
//   a to tile b (no diagonal gap a unit could slip through), skipping tiles
//   already holding the owner's wall (joints) and stopping at blocked tiles
//   (each blocked stretch is a gap). Every run of new tiles gets a pillar
//   (B_WALL_PILLAR, 1x1) at both ends (not next to an existing joint), at
//   corners whose both arms are 2+ tiles long and every WALL_PILLAR_EVERY
//   tiles; the tiles between pillars become straight segments (B_WALL, a 1 x
//   n rect, n <= WALL_SEGMENT_MAX). A piece blocks its tiles like any
//   building, for everyone, so every pathing mode (single A*, the group
//   fields of formation moves, attack-move, the movement step) goes round
//   it; destroying a piece unblocks its tiles. Cost and build time are per
//   tile (WALL_TILE_COST, WALL_TILE_TIME), hp per tile from the wall stage.
//   The map generator's passes (connected starts, woodlines) run before any
//   wall exists, so they never see one.
// - Gates: convert_to_gate(segment) turns a finished straight segment into
//   a gate (B_GATE, same id and rect, GATE_COST, hp x GATE_HP_MULT). Its
//   tiles stay blocked, and GameMap::gate_pass lets the gate owner's units
//   and his allies' through (Pathfinder::pass_owner, the movement step);
//   enemies path round it as round a wall. A locked gate (set_gate_locked)
//   lets nobody through. fort_open (0..1) is the leaves' state for the
//   renderer: they open while a unit allowed through is within GATE_OPEN_R.
// - Towers: B_TOWER (2x2) shoots arrows (Combat::fire, homing projectiles) at
//   the nearest enemy unit in range, no garrison needed; its numbers come
//   from the owner's tower stage: Sentry Tower, Watch Tower (Classical),
//   Guard Tower (Heroic), Ballista Tower (Mythic), each researched at a
//   tower (research(tower, tech)) and applied to all his towers (hp scaled
//   with the new max). Wall stages (Wooden, Stone (Classical), Fortified
//   (Heroic), Citadel (Mythic) Wall) are researched at any wall piece.
// - Combat rules: arrows of buildings never hurt a friend (Combat::damage);
//   pieces have their own armor (armor_mult: arrows barely scratch a wall);
//   walls are never picked as targets by attack-move scans, wave targets or
//   the "then buildings" sweep, but a unit whose attack target is walled off
//   (its path does not reach: units.path_blocked) attacks the nearest enemy
//   wall piece within BREACH_RADIUS (breach_target), then goes back.
//
// Stone does not exist in this game: walls and towers cost wood + gold.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "../buildings/defs.h"

namespace aov {

class Sim;
struct Hitter;

enum FortTech : uint8_t {
	FT_NONE = 0,
	FT_STONE_WALL, FT_FORTIFIED_WALL, FT_CITADEL_WALL,   // wall stages 1..3
	FT_WATCH_TOWER, FT_GUARD_TOWER, FT_BALLISTA_TOWER,   // tower stages 1..3
	FT_COUNT
};
struct FortTechDef {
	const char *key, *name;
	Cost cost;
	double time;
	int min_age;
	int line;  // 0 walls, 1 towers
	int level; // the stage it gives (1..3)
};
const FortTechDef &fort_tech_def(int t); // t in 1..FT_COUNT-1
int fort_tech_of(const char *key);       // 0 if unknown

constexpr int FORT_LEVELS = 4;
struct WallStage { const char *name; double tile_hp; };
struct TowerStage { const char *name; double hp, range, damage, cooldown, sight; };
const WallStage &wall_stage(int level);
const TowerStage &tower_stage(int level);

constexpr int WALL_SEGMENT_MAX = 4;   // tiles of a segment between two pillars
constexpr int WALL_PILLAR_EVERY = 5;  // a pillar at least every 5 tiles
constexpr int WALL_LINE_MAX = 96;     // tiles in one place_wall line
constexpr double WALL_TILE_TIME = 3;  // s per tile for one builder
constexpr double PILLAR_HP_MULT = 1.5;
constexpr double GATE_HP_MULT = 1.25;
constexpr double GATE_OPEN_R = 2.5;   // tiles from the gate's rect
constexpr double BREACH_RADIUS = 6;   // tiles from the blocked attacker
constexpr double TOWER_ARROW_Y = 5.2; // projectile start above the ground

struct FortResult { bool ok = false; std::string reason; };

// one tile of a wall line plan
enum WallTileState : uint8_t { WT_BAD = 0, WT_NEW = 1, WT_JOINT = 2 };
struct WallPiece { int type, tx, tz, w, h; };
struct WallPlan {
	std::vector<int> tiles;        // tx, tz pairs in line order
	std::vector<uint8_t> state;    // WallTileState per tile
	std::vector<WallPiece> pieces; // what place_wall would spawn
	int new_tiles = 0;
	Cost cost;
	bool valid = false;
	std::string reason;
};

class Fortify {
public:
	Sim *sim = nullptr;
	int wall_level[MAX_PLAYERS] = {};
	int tower_level[MAX_PLAYERS] = {};
	int walls = 0, gates = 0, towers = 0; // living pieces, counted each update (fast skips)

	void init(Sim *s);
	void update(double dt);

	WallPlan plan_wall(int owner, int tx0, int tz0, int tx1, int tz1) const;
	// pay, spawn the foundations, send the builders (rows) to the first piece;
	// ids of the new pieces (empty + reason when refused)
	std::vector<int32_t> place_wall(int owner, int tx0, int tz0, int tx1, int tz1, const std::vector<int> &builders, FortResult &res);
	FortResult convert_to_gate(int32_t id);
	FortResult set_gate_locked(int32_t id, bool locked);
	FortResult research(int32_t building_id, int tech);
	bool cancel_research(int32_t building_id);
	// state of a tech for an owner: 0 done, 1 available, 2 needs the previous
	// stage, 3 needs an age, 4 being researched
	int tech_state(int owner, int tech) const;

	// stats of a piece for its owner's stage
	double piece_max_hp(int type, int owner, int tiles) const;
	double armor_mult(int brow, const Hitter &a, uint8_t kind) const;
	int32_t breach_target(int urow) const; // the enemy wall piece to break (0 none)
	void on_destroy(int brow);              // Buildings::destroy: clears a gate's pass mask
	uint8_t gate_mask(int owner) const;    // owners allowed through his gates
	// render helpers: connection bits of a piece (1 -z, 2 +x, 4 +z, 8 -x:
	// a neighbour tile holds the same owner's wall piece) and its axis
	// (0 along x, 1 along z)
	uint8_t connections(int brow) const;
	uint8_t axis(int brow) const;

private:
	int spawn_piece(int type, int owner, int tx, int tz, int w, int h);
	void set_level(int owner, int line, int level);
	bool tile_ok(int tx, int tz) const;
	int own_piece_at(int tx, int tz, int owner) const; // building row or -1
	double gate_scan_t_ = 0;
};

} // namespace aov
