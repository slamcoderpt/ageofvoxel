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

enum AttackFlag : int32_t { ATK_THEN_BUILDINGS = 1, ATK_AUTO = 2 };
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
};

} // namespace aov
