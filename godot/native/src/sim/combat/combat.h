// Combat piece, simulation half: port of the update() side of src/combat/
// (index.js, Projectiles.js, EnemyAI.js): the 'attack' order, auto-targeting
// of idle soldiers, melee / splash / ranged damage with class bonuses and
// armor, projectiles (ballistic arrows, damage on arrival), death, Town
// Center arrows, phalanx lines (holdLines) and the enemy AI (one EnemyAI per
// AI player, any number of players). Bit-exact with the browser
// (scripts/check-sim.mjs).
//
// Public API (like the JS game.combat):
//   combat.damage(target_id, amount, Hitter, kind)   JS damage(target, amount, attacker, kind)
//   combat.kill(id, killer_id)
//   combat.find_enemy_near(x, z, owner, radius[, pred]) -> unit row or -1
//   combat.ai(owner) / combat.add_ai(owner)
//
// Attack orders use the generic order columns: order_target = targetId,
// order_x = repath timer, order_a = buildingId (0 = undefined), order_b bits:
// ATK_THEN_BUILDINGS (thenBuildings), ATK_AUTO (auto).
//
// Godot-only (Sim::godot_rules; the browser is frozen):
// - Attack-move, order O_ATTACK_MOVE: order_x / order_z = destination,
//   order_b bits AM_*. The unit walks there (a formation move: same slots and
//   group path as Commands::move); every AM_SCAN_TICKS ticks (staggered by id)
//   and on arrival it looks for a foe within its sight: enemy military units
//   first (myth units and heroes count as military), then villagers, then
//   buildings, nearest first; if one is found it engages it (engage()).
//   While it fights a villager or a building it turns on a soldier that
//   comes into sight. A hit from any side engages the attacker. On arrival
//   with nothing in sight it goes idle, or, with AM_THEN_BUILDINGS (the
//   enemy AI's waves), attacks the nearest enemy building like the
//   browser's wave order. Villagers given one simply move.
// - A unit on a plain move (not a villager) that is hit by an enemy unit
//   within its sight, ahead of it or beside it (dot(move dir, dir to the
//   attacker) > RETALIATE_DOT), stops and fights back; one hit from behind
//   (it is moving away: a retreat) is ignored and it keeps going. The men
//   on a plain move within RALLY_RADIUS of it for whom the attacker is also
//   ahead or beside turn with it (rally_to: one hash query per retaliation).
// - engage(): an O_ATTACK that remembers what to resume (units.am_resume /
//   am_x / am_z / am_flags; ATK_AUTO only for a move, so the AI does not
//   redraft the men of an attack-move into a new wave). The fight ends when
//   the foe dies or has been beyond the unit's sight for AM_LOST_TIME s;
//   then an attack-move picks its next foe in sight or walks on; a move
//   takes on an enemy within NEXT_FOE_RADIUS that is fighting (the
//   attacker's comrades) unless it is behind, else walks on. Any new order (Commands::set) forgets the resume.
//
// Visual-only parts of the JS stay with the renderer (game/combat): hit
// sparks, dust, ground scars, dropped gear (BattleFX / Debris), health bars
// and selection rings (Overlays), and the stagger lean (combat.lean), which
// the renderer computes from stag_t / stag_k. Arrows that miss (target died)
// are kept here as `stuck` so the renderer can draw them.
#pragma once
#include <cstdint>
#include <functional>
#include <vector>

#include "enemy_ai.h"

namespace aov {

class Sim;
struct Order;

constexpr double CORPSE_HOLD = 30;   // s the fallen lie at dieT <= 2 before the units piece lets them fade
constexpr double STAGGER = 0.5;      // s a man struck reels back (renderer)
constexpr double STUCK_TIME = 9;     // s an arrow stays stuck in the ground
constexpr int STUCK_MAX = 400;

enum AttackFlag : int32_t { ATK_THEN_BUILDINGS = 1, ATK_AUTO = 2, ATK_BREACH = 4, ATK_BROKE_IN = 8 };
// (Godot-only, fortify: ATK_BREACH = breaking a wall now, order_a = the real
// target, a building or a unit; ATK_BROKE_IN = the target was walled off on this order: when it is dead
// and no foe is in sight, the man attacks the nearest enemy building within
// twice his sight)
enum AttackMoveFlag : int32_t { AM_THEN_BUILDINGS = 1 };
enum AmResume : uint8_t { AMR_NONE = 0, AMR_MOVE = 1, AMR_ATTACK_MOVE = 2 };
constexpr int AM_SCAN_TICKS = 8;        // attack-move re-acquire period (ticks, staggered per unit)
constexpr double AM_LOST_TIME = 2;      // s a foe may stay out of sight before the fight is dropped
constexpr double RETALIATE_DOT = -0.25; // moving units fight back unless hit from behind
constexpr double RALLY_RADIUS = 4;      // the men beside one who fights back join him
constexpr double NEXT_FOE_RADIUS = 4;   // a fighting enemy this close keeps a man in the fight
enum DamageKind : uint8_t { DK_DEFAULT = 0, DK_ARROW = 1, DK_MELEE = 2 };

// The JS `attacker` argument of combat.damage: a unit, a building, or a
// pseudo attacker ({owner, id: 0} for god powers, {owner} for an arrow whose
// shooter is gone; myth_class: {def: {class: 'myth'}} for the meteor).
struct Hitter {
	int32_t id = 0;
	uint8_t kind = 0; // K_UNIT / K_BUILDING, 0 = pseudo
	int row = -1;
	int owner = 0;
	bool myth_class = false;
	bool none = false; // attacker undefined (scene kills)
	static Hitter pseudo(int owner, bool myth = false) { Hitter h; h.owner = owner; h.myth_class = myth; return h; }
};

struct Projectile {
	double sx, sy, sz, x, y, z, px, py, pz;
	double tx = 0, ty = 0, tz = 0;
	bool has_t = false, lost = false;
	int32_t target, attacker;
	int owner;
	double damage, t, dur, arc, dist;
	// Godot-only (sim/techs, Ballistics): tiles the arrow follows its target
	// from the aim point (< 0: homing, the browser's arrows); off = the
	// target is beyond that (a miss)
	double track = -1, aim_x = 0, aim_z = 0;
	bool off = false;
};
struct StuckArrow { double x, y, z, dx, dy, dz, t; };
// Scene dressing for the renderer (BattleFX.scar / Debris.drop calls of the
// battle scene): their parameters come from the sim rng, so they are drawn here.
struct Scar { double x, z, radius, dirt, blood; };
enum DropKind : uint8_t { DROP_SHIELD, DROP_HELMET, DROP_SPEAR, DROP_STUB };
struct Drop { uint8_t kind; double x, z, rot; int owner; double tilt, roll, lift, life; };

class Combat {
public:
	Sim *sim = nullptr;
	std::vector<Projectile> projectiles;
	std::vector<StuckArrow> stuck;
	std::vector<Scar> scars;
	std::vector<Drop> drops;
	std::vector<EnemyAI> ais; // ais[0] = the ENEMY's (combat.ai)
	double scan_timer = 0;

	void init(Sim *s);
	void update(double dt);

	EnemyAI &ai() { return ais[0]; }
	EnemyAI &add_ai(int owner);

	double range_of(int urow) const;
	void approach(int urow, int32_t target_id);
	// findEnemyNear(e, radius, pred): nearest living enemy unit row (-1 none)
	int find_enemy_near(double x, double z, int owner, double radius, const std::function<bool(int)> &pred = nullptr);
	int pick_target(int urow, double radius);
	int find_enemy_building_near(double x, double z, int owner, double radius) const; // building row
	void damage(int32_t target_id, double amount, const Hitter &a, uint8_t kind = DK_DEFAULT);
	void kill(int32_t id, const Hitter &killer);
	Hitter hitter_of(int32_t id) const; // entity -> Hitter (pseudo {owner: 0} if gone)
	void fire(int32_t attacker_id, int32_t target_id, double damage, double from_y);
	void hold_lines();
	void update_projectiles(double dt);

private:
	std::vector<int32_t> attackers_; // targetId -> units attacking it (refreshed every scan)
	std::vector<int32_t> touched_;
	int attackers_of(int32_t id) const { return id > 0 && id < (int32_t)attackers_.size() ? attackers_[id] : 0; }
	void add_attacker(int32_t id);
	void clear_attackers();
	bool start_attack(int urow, const Order &o);
	bool start_attack_move(int urow, const Order &o);
	// attack-move target choice (see above): entity id or 0
	int32_t am_pick(int urow, int *rank_out = nullptr);
	int am_rank(int32_t id) const; // 0 military, 1 villager, 2 building, 3 none
	void update_attack_move(int urow);
	void engage(int urow, int32_t target_id, uint8_t resume);
	void resume(int urow);
	void rally_to(int urow, int32_t attacker_id, double ax, double az);
	std::vector<int> rally_;
	bool hit_ahead(int urow, double ax, double az) const;
	static bool ahead(double mx, double mz, double tx, double tz);
};

} // namespace aov
