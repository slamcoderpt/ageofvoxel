// AovSim: the GDScript-facing handle on the C++ simulation.
// Game code creates one (AovSim.new()), calls new_game(), then tick() at
// 30 Hz and reads state through the packed-array getters once per frame
// (never per entity). Commands forward to the sim; the method list is in
// godot/PORTING.md ("AovSim API").
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_float64_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>
#include <godot_cpp/variant/string.hpp>
#include <godot_cpp/variant/vector2.hpp>

#include "sim/sim.h"

namespace godot {

class AovSim : public RefCounted {
	GDCLASS(AovSim, RefCounted)

	aov::Sim sim_;

protected:
	static void _bind_methods();
	static void _bind_civ_methods(); // aov_sim_civ.cpp
	void civ_unit_def(int type, Dictionary &d) const;
	void civ_building_def(int type, int civ, Dictionary &d) const;

public:
	aov::Sim &sim() { return sim_; }
	String version() const;

	void new_game(int64_t seed, int64_t map_size, const String &preset, int64_t players);
	void tick(int64_t n);
	int64_t get_tick() const { return sim_.tick_count; }
	double get_time() const { return sim_.time; }
	int64_t get_seed() const { return sim_.seed; }

	// --- map
	int64_t get_map_size() const { return sim_.world.map.size; }
	int64_t get_map_cols() const { return sim_.world.map.cols; }
	int64_t get_water_level() const { return sim_.world.map.water_level; }
	PackedInt32Array get_heights() const;  // cols*cols voxel levels, row-major (z, x)
	PackedByteArray get_ground() const;    // cols*cols Ground enum
	PackedByteArray get_passable() const;  // size*size terrain-only passability
	PackedByteArray get_walkable() const;  // size*size: passable and not blocked (what A* uses)
	double height_at(double x, double z) const { return sim_.world.map.height_at(x, z); }
	double smooth_height_at(double x, double z) const { return sim_.world.map.smooth_height_at(x, z); }
	Array get_starts() const;              // [{owner, tx, tz}]
	Array get_resource_spawns() const;     // [{type, tx, tz, variant}]
	Dictionary get_mapgen_info() const;    // the Godot-only map passes: {felled, graded, woodline}
	PackedInt32Array take_map_changes();   // dirty column rects (cx0,cz0,cx1,cz1)*, cleared on read
	int64_t map_hash() const;
	// Terrain piece (terrain_mesher.cpp, TerrainMesh.js): mesh of a column rect
	// [cx0,cx1)x[cz0,cz1) as Mesh.ARRAY_MAX arrays (vertex, normal, color, index);
	// water depth bake (cols*cols bytes, metres*40); ground detail instances.
	Array build_terrain_mesh(int64_t cx0, int64_t cz0, int64_t cx1, int64_t cz1) const;
	PackedByteArray get_water_depth() const;
	Array build_ground_details(int64_t cx0, int64_t cz0, int64_t cx1, int64_t cz1) const;

	// --- players (0 = Gaia, 1..6)
	void add_player(int64_t id, const String &name, bool is_ai);
	Dictionary get_player(int64_t id) const; // {id, name, is_ai, color, food, wood, gold, favor, pop, pop_cap, age}
	PackedInt32Array get_player_ids() const;
	bool is_enemy(int64_t a, int64_t b) const { return sim_.is_enemy((int)a, (int)b); }
	bool is_ally(int64_t a, int64_t b) const { return sim_.is_ally((int)a, (int)b); }
	int64_t get_team(int64_t id) const { return sim_.team_of((int)id); }
	int64_t get_local_player() const { return sim_.local_player; }

	// --- match setup (sim/match; Godot-only; keys in PORTING.md "Match rules")
	// setup_match(cfg) after new_game(cfg.seed, cfg.map_size, cfg.preset, players.size());
	// start_match(cfg) does both. -> {ok, error, local, focus: Vector2, tcs, slots}
	Dictionary setup_match(const Dictionary &cfg);
	Dictionary start_match(const Dictionary &cfg);

	// --- entities
	PackedStringArray unit_type_names() const;
	Dictionary get_unit_def(const String &type) const;
	int64_t spawn_unit(const String &type, int64_t owner, double x, double z, double rot);
	PackedInt32Array spawn_block(const String &type, int64_t owner, int64_t count, double x, double z, int64_t cols, double spacing, double rot, double jitter);
	int64_t spawn_resource(const String &type, int64_t tx, int64_t tz, int64_t variant);
	void remove_resource(int64_t id) { sim_.remove_resource((int32_t)id); }
	void clear_rect(int64_t tx, int64_t tz, int64_t w, int64_t h) { sim_.clear_rect((int)tx, (int)tz, (int)w, (int)h); }
	// Godot-only scene tool (the egypt_town capture): paint the ground kind
	// (core/game_map.h Ground: 2 sand, 4 paved...) of a tile rect, render only
	// (no walkability change); the terrain re-meshes the dirty columns.
	void paint_ground(int64_t tx, int64_t tz, int64_t w, int64_t h, int64_t ground) { sim_.map().paint_tiles((int)tx, (int)tz, (int)w, (int)h, (int)ground); }
	void kill_unit(int64_t id, int64_t killer); // combat.kill
	int64_t entity_kind(int64_t id) const { return sim_.entities.slot((int32_t)id) >= 0 ? sim_.entities.kind((int32_t)id) : 0; }
	int64_t get_unit_count() const { return sim_.entities.count_units(); }
	Dictionary get_units() const;     // packed arrays, one entry per unit (see PORTING.md)
	Dictionary get_buildings() const;
	Dictionary get_resources() const;
	Dictionary get_unit(int64_t id) const; // one unit's fields (UI / debugging, not per frame)
	PackedInt32Array units_near(double x, double z, double r, int64_t owner) const; // living units, owner -1 = any

	// --- commands
	bool order(int64_t id, const Dictionary &order); // {type: "idle"|"move"|..., target, x, z}
	void order_move(const PackedInt32Array &ids, double x, double z); // formation move
	void order_idle(const PackedInt32Array &ids);
	void order_attack_move(const PackedInt32Array &ids, double x, double z); // formation attack-move (Godot-only)
	void smart(const PackedInt32Array &ids, double x, double z, int64_t target_id);
	bool move_to(int64_t id, double x, double z, double range);
	PackedVector2Array find_path(double sx, double sz, double gx, double gz);
	void set_repath_budget(int64_t n) { sim_.movement.repath_budget = (int)n; }
	void set_path_cache(bool on) { sim_.pathfinder.use_cache = on; }
	// Formation moves of >= min_units share one Dijkstra field (0 = off, JS-exact; see pathfinding.h)
	void set_group_paths(int64_t min_units) { sim_.pathfinder.group_min = (int)min_units; }

	// --- buildings (sim/buildings; see PORTING.md "AovSim API")
	PackedStringArray building_type_names() const;
	Dictionary get_building_def(const String &type, int64_t owner = 0) const; // owner > 0: his civ's cost / trains (sim/civ)
	int64_t spawn_building(const String &type, int64_t owner, int64_t tx, int64_t tz, bool built, bool site);
	bool can_place(const String &type, int64_t tx, int64_t tz) const;
	int64_t place_building(const String &type, int64_t owner, int64_t tx, int64_t tz, const PackedInt32Array &builders);
	void destroy_building(int64_t id);
	Dictionary get_building(int64_t id) const; // one building incl. its queue and rally point

	// --- fortifications (sim/fortify, Godot-only; PORTING.md "Walls, gates, towers")
	// a, b: world points (their tiles are the line's ends)
	Dictionary plan_wall(int64_t owner, const Vector2 &a, const Vector2 &b) const; // ghost: {valid, reason, tiles, state, pieces, cost, new_tiles}
	Dictionary place_wall(int64_t owner, const Vector2 &a, const Vector2 &b, const PackedInt32Array &builders); // {ok, reason, ids}
	Dictionary convert_to_gate(int64_t id);               // {ok, reason}
	Dictionary set_gate_locked(int64_t id, bool locked);  // {ok, reason}
	// research(building, key): a fortification stage (sim/fortify) or an
	// Armory / Market / Temple tech (sim/techs) -> {ok, reason};
	// cancel_research(building, tech = "": the last queued) refunds it
	Dictionary research(int64_t building, const String &tech);
	bool cancel_research(int64_t building, const String &tech);
	PackedStringArray fort_tech_names() const;
	Dictionary get_walls() const;                // every wall piece, gate and tower (packed, see PORTING.md)
	Dictionary get_fortify(int64_t owner) const; // stages, tower numbers, techs and their state

	// --- research, techs, market (sim/techs, Godot-only; PORTING.md "Research, Armory, Market, Temple techs")
	PackedStringArray tech_names() const;                  // every Armory / Market / Temple tech key (TechId order)
	Dictionary get_tech_def(const String &tech) const;     // static data (Retold numbers, effects, mapping)
	Array get_techs(int64_t building) const;               // the building's techs with their state for its owner
	Array get_owner_techs(int64_t owner, const String &building_type) const; // same by building type (UI menus)
	Dictionary get_player_techs(int64_t owner) const;      // done, queues, minor gods, fees, flags
	Array get_research(int64_t building) const;            // the building's research queue
	Dictionary set_minor_god(int64_t owner, int64_t age, const String &god); // "" = not chosen
	bool grant_tech(int64_t owner, const String &tech);    // free and instant (scenes, checks)
	Dictionary get_unit_stats(int64_t id) const;           // a unit's numbers with its owner's techs
	Dictionary get_market(int64_t owner) const;            // prices, buy / sell rates for that owner, fee
	Dictionary market_buy(int64_t market, const String &res);  // {ok, reason, gold, amount}
	Dictionary market_sell(int64_t market, const String &res);
	Dictionary tribute(int64_t from, int64_t to, const String &res, double amount); // {ok, reason, fee}
	void set_tech_rules(const Dictionary &opts);           // {heroic_needs_armory: bool}
	Dictionary get_tech_rules() const;

	// --- economy (sim/economy)
	Dictionary train(int64_t building, const String &unit_type);
	void cancel_train(int64_t building, int64_t index);
	Dictionary advance_age(int64_t owner);
	Dictionary next_age_cost(int64_t owner) const;
	void set_rally(int64_t building, double x, double z, int64_t target_id);
	void clear_rally(int64_t building);
	int64_t nearest_resource(double x, double z, const String &res_type, double max_dist);
	int64_t nearest_dropoff(int64_t owner, double x, double z, const String &res_type);
	void order_gather(const PackedInt32Array &ids, int64_t target);
	void order_build(const PackedInt32Array &ids, int64_t target);
	void order_worship(const PackedInt32Array &ids, int64_t target);
	void order_dropoff(const PackedInt32Array &ids, int64_t target);
	void set_player_resources(int64_t owner, const Dictionary &res);
	void set_player_age(int64_t owner, int64_t age);
	PackedInt32Array spawn_herd(const String &type, double x, double z, int64_t n);
	int64_t spawn_boat(int64_t owner, double x, double z, double rot);
	int64_t spawn_shoal(double x, double z, double amount);
	Dictionary get_economy() const; // animals, spears, shoals, boats (packed arrays)
	Dictionary get_decor() const;   // scene field dressing: {count, keys, xform: [x, z, rot, scale, y]*}

	// --- combat (sim/combat)
	void damage(int64_t target, double amount, int64_t attacker); // combat.damage (attacker 0 = none)
	void set_ai_enabled(bool on);                  // combat.ai.enabled (the ENEMY's EnemyAI)
	void add_ai(int64_t owner);                    // combat.addAI(owner)
	Dictionary get_ai(int64_t owner) const;        // {enabled, wave_size, next_wave_at} or {}
	void set_ai(int64_t owner, const Dictionary &d); // enabled / next_wave_at / wave_size / aggression
	Dictionary get_combat() const;                 // projectiles, stuck arrows, scene scars / dropped gear
	void set_unit_combat(int64_t id, const Dictionary &d); // leash, reach, line {cx, cz, nx, nz, d0} | null, kit
	// --- god powers (sim/godpowers)
	PackedStringArray power_names() const;
	Dictionary get_power_def(const String &power) const;
	Dictionary can_cast(int64_t owner, const String &power) const; // {ok, reason}
	bool cast_power(int64_t owner, const String &power, double x, double z);
	double power_cooldown(int64_t owner, const String &power) const;
	Dictionary get_godpowers() const; // storms, bolts, scorches, zaps, meteors, fires (packed)
	// --- fog of war (player 1) and victory
	void set_fog_reveal_all(bool on) { sim_.fog.set_reveal_all(on); }
	void fog_recompute() { sim_.fog.recompute(); }
	PackedByteArray get_fog() const;  // size*size: 0 unexplored, 128 explored, 255 visible (JS fog texture)
	int64_t fog_version() const { return sim_.fog.version; }
	bool is_explored(double x, double z) const { return sim_.fog.is_explored(x, z); }
	bool is_visible(double x, double z) const { return sim_.fog.is_visible(x, z); }
	void set_victory_enabled(bool on) { sim_.victory.enabled = on; }
	// Godot-only rules (AI god powers, free villager; see Sim::godot_rules).
	// Kept across new_game(); the parity tools turn them off.
	void set_godot_rules(bool on) { sim_.godot_rules = on; }
	bool get_godot_rules() const { return sim_.godot_rules; }
	Dictionary get_victory() const;   // {decided, winner, loser, time}
	bool is_paused() const { return sim_.paused; }
	void set_paused(bool on) { sim_.paused = on; }

	// --- deterministic scene setups (sim/scenes)
	bool has_scene_setup(const String &name) const;
	Dictionary setup_scene(const String &name, const Dictionary &opts); // -> ctx {focus: Vector2, ...}; opts {units}
	void scene_after(const String &name);        // the scene's after(), once the fast-forward is done

	// --- civilizations (sim/civ, Godot-only; PORTING.md "Civilizations, the Egyptians")
	PackedStringArray civ_names() const;                      // "greek", "egyptian"
	Dictionary get_civ(const String &civ) const;              // {key, name, gods, build_menu, units, buildings}
	bool set_player_civ(int64_t owner, const String &civ);    // scenes / checks (the match sets it from the god)
	PackedStringArray get_build_menu(int64_t owner) const;    // the owner's civ's build menu
	Dictionary can_build(int64_t owner, const String &type) const; // {ok, reason}: civ, age, Monument order
	Array get_trains(int64_t building) const;                 // [{type, ok, reason}] for its owner
	void order_empower(const PackedInt32Array &ids, int64_t building); // Pharaoh / Ra's Priests
	Dictionary get_civ_state(int64_t owner) const;            // monuments, favor rate, empowered, Pharaoh, Laborers
	Dictionary get_civ_fx() const;                            // heals [healer, target]*, empowers [unit, building, strength]*, mandjet [monument, building]*
	Dictionary shield_check(int64_t caster, double x, double z) const; // {ok, reason, by}: Isis' Divine Shield at a god power's target

	// --- events: [{type: "entity:added", id, kind, other, owner, a, x, z, amount}], cleared on read
	Array take_events();
	void set_record_events(bool on) { sim_.events.record = on; }

	// --- profiling / stats (scripts/godot-stress.mjs)
	void set_profiling(bool on) { sim_.prof.enabled = on; }
	bool is_profiling() const { return sim_.prof.enabled; }
	Dictionary get_profile() const;  // {total, sys:{}, sub:{}, ai:{}, calls:{name:[n, ms]}} of the last tick
	Dictionary get_stats() const;    // {alive, dead, moving, buildings, projectiles, resources, paths, path_searches, path_cache_hits}
	void set_census(bool on);
	Dictionary take_census();        // spatial-hash {queries, cellsScanned, entitiesVisited} since the last call
	int64_t units_hash() const { return sim_.units_hash(); }
	// Full-precision dump for parity checks: [id, x, z, rot, hp, flags, order, anim] per unit
	PackedFloat64Array get_units_f64() const;
	// Economy / buildings / combat state for parity checks: per player [res x4, pop, pop_cap, age],
	// per building [id, hp, progress, built, queue length, farm rows], per resource [id, amount, x, z]
	PackedFloat64Array get_econ_f64() const;
};

} // namespace godot
