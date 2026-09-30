// Entity store: struct-of-arrays per kind with stable ids (port of
// src/core/EntityStore.js, designed for 4000+ units).
//
// - Ids come from one counter shared by all kinds (like the JS nextId), are
//   never reused, and map to a row through `id_slot` / `id_kind`.
// - Each kind's rows are dense and in id (= insertion) order, which is the
//   JS Map iteration order, so systems iterate `for (int i = 0; i < n; i++)`
//   and visit entities in the same order as the browser.
// - remove() only flags the row (`removed = 1`, id unmapped); rows are
//   compacted (order kept) by compact(), which the sim calls once per tick
//   right before Movement rebuilds the spatial hash, so row indices stored in
//   the hash stay valid for every system until the next rebuild. Loops must
//   skip `removed` rows.
// - Pieces add their per-entity fields as columns to the X-macro lists
//   below (prefix private ones with the piece name, like e.combat_* in JS);
//   push/compact handle every column automatically.
#pragma once
#include <cmath>
#include <cstdint>
#include <vector>

#include "players.h"

namespace aov {

// One queued unit of a building's training queue (b.queue[i]).
struct TrainItem {
	uint8_t type = 0;
	double t = 0, total = 0;
	bool free = false; // the Town Center's free villager (Economy::rescue): nothing to refund
};
using TrainQueue = std::vector<TrainItem>;

enum Kind : uint8_t { K_NONE = 0, K_UNIT = 1, K_BUILDING = 2, K_RESOURCE = 3 };

// Order types (u.order.type). Handlers are registered in Commands.
enum OrderType : uint8_t { O_IDLE, O_MOVE, O_GATHER, O_DROPOFF, O_WORSHIP, O_BUILD, O_ATTACK, O_TYPE_COUNT };
inline const char *order_name(int t) {
	static const char *n[] = { "idle", "move", "gather", "dropoff", "worship", "build", "attack" };
	return t >= 0 && t < O_TYPE_COUNT ? n[t] : "?";
}

// Animation states (u.anim.state / want). A_NONE = no request (want = null).
enum AnimState : uint8_t { A_IDLE, A_WALK, A_GATHER, A_BUILD, A_WORSHIP, A_ATTACK, A_DIE, A_NONE = 255 };
inline const char *anim_name(int a) {
	static const char *n[] = { "idle", "walk", "gather", "build", "worship", "attack", "die" };
	return a >= 0 && a <= A_DIE ? n[a] : "";
}

// unit flag bits exported to GDScript (get_units().flags)
enum UnitFlag : uint8_t { UF_MOVING = 1, UF_DEAD = 2, UF_ARRIVED = 4, UF_CARRY = 8, UF_LINE = 16 };

// X(type, name, default)
#define AOV_UNIT_COLUMNS(X)                                                    \
	X(int32_t, id, 0)                                                          \
	X(uint8_t, type, 0)                                                        \
	X(uint8_t, owner, 0)                                                       \
	X(uint8_t, dead, 0)                                                        \
	X(uint8_t, removed, 0)                                                     \
	X(double, x, 0)                                                            \
	X(double, z, 0)                                                            \
	X(double, prev_x, 0)                                                       \
	X(double, prev_z, 0)                                                       \
	X(double, rot, 0)                                                          \
	X(double, prev_rot, 0)                                                     \
	X(double, hp, 0)                                                           \
	X(double, max_hp, 0)                                                       \
	X(double, speed, 0)                                                        \
	X(double, speed_mul, 1)                                                    \
	X(double, radius, 0.3)                                                     \
	X(double, sight, 0)                                                        \
	/* movement (core/movement) */                                             \
	X(uint8_t, moving, 0)                                                      \
	X(uint8_t, arrived, 0)                                                     \
	X(int32_t, path, -1)      /* PathPool handle, -1 = null */                 \
	X(int32_t, path_idx, 0)                                                    \
	X(uint8_t, has_goal, 0)   /* u.moveGoal != null */                         \
	X(double, goal_x, 0)                                                       \
	X(double, goal_z, 0)                                                       \
	X(double, goal_range, 0)                                                   \
	X(uint8_t, goal_has_rect, 0)                                               \
	X(double, goal_rtx, 0)                                                     \
	X(double, goal_rtz, 0)                                                     \
	X(double, goal_rw, 0)                                                      \
	X(double, goal_rh, 0)                                                      \
	X(double, stuck_t, 0)                                                      \
	X(int32_t, repaths, 0)                                                     \
	X(uint8_t, repath_pending, 0) /* deferred by the re-path budget */        \
	/* order (core/commands): generic fields, meaning per order type */       \
	X(uint8_t, order_type, O_IDLE)                                             \
	X(int32_t, order_target, 0)   /* targetId */                               \
	X(double, order_x, 0)                                                      \
	X(double, order_z, 0)                                                      \
	X(int32_t, order_a, 0)        /* e.g. attack: buildingId */                \
	X(int32_t, order_b, 0)        /* e.g. resume order type + 1 */             \
	X(int32_t, order_c, 0)        /* e.g. resume target id */                  \
	/* animation state (units) */                                              \
	X(uint8_t, anim_state, A_IDLE)                                             \
	X(uint8_t, anim_want, A_NONE)                                              \
	X(double, anim_t, 0)                                                       \
	X(double, anim_attack_t, 1)                                                \
	X(double, anim_die_t, 0)                                                   \
	X(double, hit_t, NAN)         /* units_hitT, NaN = undefined */             \
	X(int32_t, hit_n, 0)                                                       \
	X(double, last_hp, NAN)       /* units_hp, NaN = undefined */               \
	X(double, flash_t, 0)                                                      \
	/* economy / combat shared basics */                                       \
	X(uint8_t, carry_type, 255)   /* ResKind, 255 = null */                    \
	X(double, carry_amount, 0)                                                 \
	X(double, attack_cd, 0)                                                    \
	X(uint8_t, combat_line, 0)    /* u.combat_line set (holdLines, spread) */  \
	/* combat (sim/combat): the JS u.combat_* fields */                        \
	X(double, combat_leash, 0)                                                 \
	X(double, combat_reach, 0)                                                 \
	X(double, line_cx, 0)         /* combat_line {cx, cz, nx, nz, d0} */       \
	X(double, line_cz, 0)                                                      \
	X(double, line_nx, 0)                                                      \
	X(double, line_nz, 0)                                                      \
	X(double, line_d0, 0)                                                      \
	X(double, died_at, NAN)       /* combat_diedAt, NaN = undefined */         \
	X(double, hit_time, NAN)      /* combat_hitT (game time of the last hit) */ \
	X(double, stag_t, NAN)        /* combat_stagT (stagger start) */           \
	X(double, stag_k, 1)          /* combat_stagK */                           \
	X(double, melee_t, NAN)       /* combat_meleeT (last melee blow taken) */  \
	X(uint8_t, kit, 255)          /* units_kit (battle scene), 255 = unset */  \
	/* combat, Godot-only: an attack that resumes a move when the fight is */ \
	/* over (Combat::engage); cleared by every Commands::set */               \
	X(uint8_t, am_resume, 0)      /* AmResume: 0 none, 1 move */               \
	X(double, am_x, 0)            /* the destination to resume */             \
	X(double, am_z, 0)                                                         \
	X(double, am_lost, 0)         /* s the foe has been out of sight */        \
	/* god powers (sim/godpowers): thrown units, u.gp_air + airY / airRx / airRz */ \
	X(double, air_y, 0)                                                        \
	X(double, air_rx, 0)                                                       \
	X(double, air_rz, 0)                                                       \
	X(uint8_t, gp_state, 0)       /* 0 no gp_air, 1 airborne, 2 done */        \
	X(int32_t, gp_storm, -1)      /* gp_air.vortex: index into GodPowers::storms */ \
	X(uint8_t, gp_flung, 0)                                                    \
	X(double, gp_vx, 0)                                                        \
	X(double, gp_vy, 0)                                                        \
	X(double, gp_vz, 0)                                                        \
	X(double, gp_wx, 0)                                                        \
	X(double, gp_wz, 0)                                                        \
	X(double, gp_t0, 0)                                                        \
	X(double, gp_ht, 0)                                                        \
	X(double, gp_orb, 0)                                                       \
	X(double, gp_hold, 0)                                                      \
	X(double, gp_tilt, 0)                                                      \
	X(double, gp_wf, 0)                                                        \
	X(double, gp_ph, 0)                                                        \
	X(double, gp_yaw, 0)                                                       \
	X(double, gp_hit_t, NAN)      /* gp_hitT (lightning strike) */             \
	/* economy (sim/economy): the JS u.econ object; econ_phase EP_NONE = null */ \
	X(uint8_t, econ_phase, 0)     /* EconPhase */                              \
	X(int32_t, econ_res, 0)       /* resId (0 = null) */                       \
	X(uint8_t, econ_res_type, 255) /* resType (ResKind, 255 = undefined) */    \
	X(int32_t, econ_drop, 0)      /* dropId */                                 \
	X(int32_t, econ_temple, 0)    /* templeId */                               \
	X(int32_t, econ_tries, 0)                                                  \
	X(double, econ_throw_cd, 0)                                                \
	X(uint8_t, econ_hunt, 0)      /* huntAt set */                             \
	X(double, econ_hunt_x, 0)                                                  \
	X(double, econ_hunt_z, 0)

#define AOV_BUILDING_COLUMNS(X)                                                \
	X(int32_t, id, 0)                                                          \
	X(uint8_t, type, 0)                                                        \
	X(uint8_t, owner, 0)                                                       \
	X(uint8_t, dead, 0)                                                        \
	X(uint8_t, removed, 0)                                                     \
	X(int32_t, tx, 0)                                                          \
	X(int32_t, tz, 0)                                                          \
	X(int32_t, w, 1)                                                           \
	X(int32_t, h, 1)                                                           \
	X(double, x, 0)                                                            \
	X(double, z, 0)                                                            \
	X(double, rot, 0)                                                          \
	X(double, hp, 0)                                                           \
	X(double, max_hp, 0)                                                       \
	X(double, radius, 0)                                                       \
	X(uint8_t, built, 1)                                                       \
	X(double, progress, 1)                                                     \
	X(uint8_t, def_flags, 0)  /* BuildingDefFlag bits (smart orders) */       \
	X(double, sight, 0)                                                        \
	/* combat: Town Center arrows, last hit */                                 \
	X(double, attack_cd, 0)                                                    \
	X(double, hit_time, NAN)                                                   \
	/* buildings piece (sim/buildings): visual variant, house yaw/setback */  \
	X(int32_t, bld_variant, -1)                                                \
	X(double, bld_yaw, 0)                                                      \
	X(double, bld_setback, 0)                                                  \
	/* economy: training queue, rally point, farm, stockpiles */             \
	X(TrainQueue, queue, TrainQueue())                                         \
	X(uint8_t, rally, 0)                                                       \
	X(double, rally_x, 0)                                                      \
	X(double, rally_z, 0)                                                      \
	X(int32_t, rally_target, 0)                                                \
	X(double, econ_rows, 0)       /* farm rows harvested (b.econ_rows) */      \
	X(int32_t, farmer, 0)         /* farm: b.farmer */                         \
	X(double, stock_grain, 0)     /* b.econ_stock (STOCK_ORDER) */             \
	X(double, stock_fruit, 0)                                                  \
	X(double, stock_meat, 0)                                                   \
	X(double, stock_fish, 0)                                                   \
	X(double, stock_wood, 0)                                                   \
	X(double, stock_gold, 0)

enum BuildingDefFlag : uint8_t { BF_WORSHIP = 1, BF_FARM = 2, BF_DROPOFF = 4 };
enum EconPhase : uint8_t { EP_NONE, EP_TO_RES, EP_GATHERING, EP_TO_DROP, EP_TO_TEMPLE };
enum StockKind : uint8_t { ST_GRAIN, ST_FRUIT, ST_MEAT, ST_FISH, ST_WOOD, ST_GOLD, ST_COUNT };

#define AOV_RESOURCE_COLUMNS(X)                                                \
	X(int32_t, id, 0)                                                          \
	X(uint8_t, type, 0)      /* ResourceType */                                \
	X(uint8_t, removed, 0)                                                     \
	X(uint8_t, res_type, 0)  /* ResKind */                                     \
	X(double, amount, 0)                                                       \
	X(double, max_amount, 0)                                                   \
	X(int32_t, tx, 0)                                                          \
	X(int32_t, tz, 0)                                                          \
	X(int32_t, w, 1)                                                           \
	X(int32_t, h, 1)                                                           \
	X(double, x, 0)                                                            \
	X(double, z, 0)                                                            \
	X(double, radius, 0.5)                                                     \
	X(int32_t, variant, 0)                                                     \
	X(double, econ_unreach_t, NAN) /* r.econ_unreachT, NaN = undefined */       \
	/* animals (sim/economy/wildlife): huntable deer/boar are resources too */ \
	X(double, rot, 0)                                                          \
	X(double, prev_x, 0)                                                       \
	X(double, prev_z, 0)                                                       \
	X(double, prev_rot, 0)                                                     \
	X(double, hp, 1)                                                           \
	X(double, max_hp, 1)                                                       \
	X(uint8_t, alive, 0)                                                       \
	X(double, flash_t, 0)                                                      \
	X(int32_t, an_home, -1)       /* econ_home: index into Wildlife::homes */  \
	X(uint8_t, an_goal, 0)        /* econ_goal != null */                      \
	X(double, an_goal_x, 0)                                                    \
	X(double, an_goal_z, 0)                                                    \
	X(double, an_wait, 0)                                                      \
	X(double, an_flee, 0)                                                      \
	X(double, an_threat_x, 0)                                                  \
	X(double, an_threat_z, 0)                                                  \
	X(double, an_dead_t, 0)                                                    \
	X(double, an_graze, 0)                                                     \
	X(uint32_t, an_seed, 0)                                                    \
	X(uint8_t, an_moving, 0)                                                   \
	X(double, an_speed, 0)

// Gaia resources: port of src/terrain/resourceDefs.js, plus the huntable
// animals of src/economy/Wildlife.js (ANIMAL_DEFS), which are resource
// entities too (kind 'resource', resType food) but never block tiles.
enum ResourceType : uint8_t { R_TREE, R_GOLD, R_BERRY, R_DEER, R_BOAR, R_TYPE_COUNT };
inline bool is_animal_type(int t) { return t == R_DEER || t == R_BOAR; }
struct ResourceDef { const char *key, *name; ResKind res_type; double amount; int w, h; };
inline const ResourceDef &resource_def(int t) {
	static const ResourceDef D[R_TYPE_COUNT] = {
		{ "tree", "Tree", RES_WOOD, 100, 1, 1 },
		{ "gold", "Gold Mine", RES_GOLD, 2000, 3, 3 },
		{ "berry", "Berry Bush", RES_FOOD, 125, 1, 1 },
		{ "deer", "Deer", RES_FOOD, 100, 1, 1 },
		{ "boar", "Boar", RES_FOOD, 250, 1, 1 },
	};
	return D[t];
}
int resource_type_of(const char *key); // -1 if unknown

#define AOV_DECL_COL(T, n, d) std::vector<T> n;
#define AOV_PUSH_COL(T, n, d) n.push_back((T)(d));
#define AOV_MOVE_COL(T, n, d) n[wr_] = n[rd_];
#define AOV_RESIZE_COL(T, n, d) n.resize(sz);
#define AOV_CLEAR_COL(T, n, d) n.clear();

#define AOV_DEFINE_STORE(Name, COLS)                                           \
	struct Name {                                                              \
		COLS(AOV_DECL_COL)                                                     \
		int size() const { return (int)id.size(); }                            \
		int push() {                                                           \
			COLS(AOV_PUSH_COL)                                                 \
			return size() - 1;                                                 \
		}                                                                      \
		void clear() { COLS(AOV_CLEAR_COL) }                                   \
		/* drop removed rows keeping order; calls moved(new_row, id) */         \
		template <class F> void compact(F moved) {                            \
			int n_ = size(), wr_ = 0;                                          \
			for (int rd_ = 0; rd_ < n_; rd_++) {                               \
				if (removed[rd_]) continue;                                    \
				if (wr_ != rd_) { COLS(AOV_MOVE_COL) }                         \
				moved(wr_, id[wr_]);                                           \
				wr_++;                                                         \
			}                                                                  \
			size_t sz = (size_t)wr_;                                           \
			COLS(AOV_RESIZE_COL)                                               \
		}                                                                      \
	};

AOV_DEFINE_STORE(UnitStore, AOV_UNIT_COLUMNS)
AOV_DEFINE_STORE(BuildingStore, AOV_BUILDING_COLUMNS)
AOV_DEFINE_STORE(ResourceStore, AOV_RESOURCE_COLUMNS)

class EventBus;

class Entities {
public:
	UnitStore units;
	BuildingStore buildings;
	ResourceStore resources;
	int32_t next_id = 1;
	std::vector<int32_t> id_slot; // id -> row in its kind's store, -1 = gone
	std::vector<uint8_t> id_kind; // id -> Kind (kept after removal)
	EventBus *events = nullptr;
	int removed_pending = 0;

	void reset(EventBus *ev);
	// Allocate a row + id (fields at their defaults); call added() once filled.
	int new_unit();
	int new_building();
	int new_resource();
	void added(int32_t id); // emits entity:added
	void remove(int32_t id); // emits entity:removed (no-op if already gone)
	bool compact();          // true if rows moved

	Kind kind(int32_t id) const { return id > 0 && id < (int32_t)id_kind.size() ? (Kind)id_kind[id] : K_NONE; }
	int slot(int32_t id) const { return id > 0 && id < (int32_t)id_slot.size() ? id_slot[id] : -1; }
	int unit_slot(int32_t id) const { return kind(id) == K_UNIT ? slot(id) : -1; }
	int building_slot(int32_t id) const { return kind(id) == K_BUILDING ? slot(id) : -1; }
	int resource_slot(int32_t id) const { return kind(id) == K_RESOURCE ? slot(id) : -1; }
	bool exists(int32_t id) const { return slot(id) >= 0; }
	int count_units(bool alive_only = false) const;

private:
	int32_t alloc_id(Kind k, int row);
};

} // namespace aov
