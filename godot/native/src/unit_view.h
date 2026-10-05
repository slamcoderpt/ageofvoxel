// AovUnitView: the render-side half of the units and combat pieces
// (game/units, game/combat). Visual only: it reads the sim (never writes it)
// and turns it into MultiMesh buffers, one call per frame, so GDScript never
// loops over entities:
//
//   - every unit's rig posed by the port of src/units/anim.js pose() and the
//     root / part transforms of src/units/index.js render() (crowd yaw and
//     melee press, slot jitter, death topple and flattening, corpse sink,
//     god power tumble, the combat stagger lean), one buffer per (type, part);
//   - contact shadows (index.js _initContactShadows), health bars
//     (combat/Overlays.js), arrows in flight, their streaks and stuck arrows
//     (combat/Projectiles.js), dropped gear (combat/Debris.js: the battle
//     scene's drops from the sim, plus BattleFX.dropGear on each death);
//   - hit sparks, dust puffs and chips of combat/BattleFX.js hit() / death()
//     and core/fx/Particles.js emit(), driven by the sim's unit:damaged and
//     entity:died events (a subscriber stamps them with the sim time) and
//     evaluated in closed form from a per-event hash, so a capture after a
//     fast-forward shows exactly the sparks still alive at that moment. The
//     view's randomness never touches the sim RNG.
//
// Buffer layout (every buffer): MultiMesh TRANSFORM_3D + colors + custom
// data, 20 floats per instance, padded with zeros to a power-of-two
// capacity; the result says how many instances are live.
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/plane.hpp>
#include <godot_cpp/variant/transform3d.hpp>

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "aov_sim.h"

namespace godot {

class AovUnitView : public RefCounted {
	GDCLASS(AovUnitView, RefCounted)

public:
	struct Part {
		std::string name;
		int channel = -1;  // pose channel (anim name), -1 = never rotated
		int parent = -1;
		Vector3 joint;     // world units (joint * voxel)
		bool coat = false;
		int rule = 0;      // show rule (see unit_view.cpp)
		int rule_v = 0, rule_n = 0; // (R_VARY: shown when the unit's id hashes to rule_v of rule_n)
		bool weapon = false; // anim channel 'weapon' (dropped by the dead)
		bool has_rest = false; Basis rest; // rig "rest" [x, y, z] (radians): a fixed turn after the pose (Egyptian heads tilt to the camera)
	};
	struct Rig {
		int kind = 0; // K_HUMAN, K_ARCHER, K_BEAST, K_HORSE, K_CENTAUR, K_MEDUSA, K_FLYER, K_SIEGE
		int pose = 0; // a variant of the kind (rig "pose": spear, slash, sling, serpent, chariot, staff)
		float gait = 1, stride = 1; // four-legged walk frequency / amplitude (x the horse's)
		float hover = 0;            // flyers: height above the ground (rig voxels)
		bool graze = true;          // four-legged idle: dips the head to graze now and then
		bool upright = false;       // (the Egyptian Priest) the staff stays upright in the hand: the weapon counters the arm's and torso's pitch / roll
		float stance = 0;           // (Egyptian men) idle in a relaxed stride (x this; robes less), not stiffly upright
		float voxel = 0.07f;
		bool has_shield = false, has_armR = false;
		std::vector<Part> parts;
		int first = 0; // index of the first part buffer
	};
	struct Buf {
		std::vector<float> d;
		int n = 0;
		void clear() { d.clear(); n = 0; }
		void push(const Transform3D &t, float r, float g, float b, float a, float c0, float c1, float c2, float c3);
	};
	struct HitRec {
		double time;
		float x, y, z, bx, bz;
		float tr, tg, tb; // target team colour (linear)
		uint32_t seed;
		uint32_t seq;  // arrival order (scars are stamped once per record)
		float rot;     // death: facing
		uint8_t kind; // 0 melee, 1 arrow, 2 building, 3 death, 4 melee scuff, 5 charge scuff
		uint8_t big;
		float scale;  // death: body size
	};
	struct DropRec { uint8_t kind; float x, z, rot, tilt, roll, lift; int owner; double die; };

private:
	Ref<AovSim> sim_ref_;
	std::vector<Rig> rigs_;
	std::vector<Buf> part_bufs_;
	std::vector<Buf> part_bufs_lod_; // units past the LOD distance (lod_mesh twins, same part order)
	Buf shadows_, bars_, arrows_, streaks_, sparks_, dust_, chips_;
	Buf drops_[4];
	std::vector<float> press_, yaw_; // per unit id, visual crowd variety (index.js update)
	std::vector<uint8_t> seen_;
	std::shared_ptr<std::vector<HitRec>> hits_;
	std::shared_ptr<std::vector<DropRec>> dropped_;
	int local_player_ = 1;
	std::shared_ptr<uint32_t> seq_;
	// BattleFX ground scars: churned earth and blood per terrain column
	std::vector<int> cell_of_;           // column -> cell index + 1 (0 = none)
	std::vector<int> cell_key_;
	std::vector<float> cell_pos_, cell_val_; // xyz, (dirt, blood)
	uint32_t scarred_seq_ = 0;
	size_t scene_scars_ = 0;
	int64_t last_scan_ = -1;
	double scar_clock_ = -1, scar_upload_ = -1;
	Buf scars_;

	void scar(double x, double z, double radius, double dirt, double blood, uint32_t seed);
	void stamp(const HitRec &h);
	void scan(double now, bool particles);

	std::unordered_map<int32_t, int> rig_override_; // unit id -> rig index (render-only stand-ins)
	static Rig parse_rig(const Dictionary &R, int type);
	void pose_unit(int row, int ri, float out[][3], float &bob, float &fwd);
	void emit_fx(const HitRec &h, double now);
	static PackedFloat32Array pack(const Buf &b);

protected:
	static void _bind_methods();

public:
	// rigs: one entry per unit type index: {kind, voxel, parts: [{name, anim, joint, parentIdx, coat}]}
	void setup(const Ref<AovSim> &sim, const Array &rigs);
	// One call per frame: poses every visible unit and fills every buffer.
	// Returns {parts: Array[PackedFloat32Array], part_counts, shadows, shadow_count,
	// bars, bar_count, arrows, arrow_count, streaks, streak_count, sparks,
	// spark_count, dust, dust_count, chips, chip_count, drops: Array[4], drop_counts}.
	// frustum: Camera3D.get_frustum() (world planes, normals outward) to skip
	// posing units off screen, or an empty Array to pose every unit.
	// lod_origin / lod_dist (performance): units farther than lod_dist from
	// lod_origin (the camera) go to parts_lod (drawn with the lod_mesh twins)
	// instead of parts; lod_dist <= 0 keeps every unit at full detail. The
	// result also has parts_lod, part_counts_lod, unit_count (posed) and
	// lod_count.
	Dictionary update(double dt, double alpha, int64_t local_player, const Array &frustum, const Vector3 &lod_origin, double lod_dist);
	// Render-only rigs (game/units: the Egyptian myth units before the sim has
	// their types): add_rig appends a rig (same dictionary as setup's) after
	// the sim types and returns its index; its part buffers follow the existing
	// ones in parts / parts_lod. set_rig_override draws (and poses) that unit
	// with the rig instead of its type's; rig < 0 clears it.
	int64_t add_rig(const Dictionary &rig);
	void set_rig_override(int64_t unit_id, int64_t rig);
	// Unit LOD mesh (unit_lod.cpp): the coarser voxel twin of one exported
	// unit part (Mesh.surface_get_arrays(0)), factor^3 voxels per cell; the
	// same vertex format. shadow_only: whole cells, greedy-merged faces, for
	// shadow-only casters. Empty Array if the input is not a voxel model.
	static Array lod_mesh(const Array &arrays, int64_t factor, bool shadow_only);
};

} // namespace godot
