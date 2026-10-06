// AovGodpowerView: the render-side half of the god powers piece
// (game/godpowers). Visual only: it reads the sim (never writes it, never
// draws from the sim RNG) and turns sim/godpowers state into GPU buffers,
// one call per frame, so GDScript never loops over bolts, particles or units.
// Port of the render half of src/godpowers (effects.js BoltRenderer.render
// and the visual lists of index.js: debris, sparks, smoke, flames):
//
//   - ribbons: camera-facing ribbon geometry (ArrayMesh arrays) per material
//     group: ground bolts (boltLines: fractal leader, forks, sub-forks,
//     feelers, ground arcs), cloud crawlers (skyLines), zaps on struck men,
//     the storm's spiralling energy bands (two palettes), the violet trails of
//     the men carried round the funnel, meteor fire trails, spark streaks;
//   - instance buffers (20 floats: TRANSFORM_3D + colour + custom data):
//     lit voxel debris (strike craters, char rims, the funnel's pulled earth,
//     turf and leaves), glowing embers, glow sprites (impact balls, stems,
//     meteor cores, blast glows), depth-tested back lights (zaps, flyers),
//     ground decals (scorches, flash discs, ground flashes, ember cracks,
//     shock rings, meteor warning rings, drop shadows under flyers), smoke and
//     flame puffs (the JS game.fx emits, in closed form);
//   - lights (strike / fire / storm point lights, the shadow spot), the
//     strike light pools and the storm state for the grade pass.
//
// Everything is a function of the sim time (captures of a paused sim are
// exact): bolt channels come from their seeds, crater debris and sparks are
// stepped at the sim's 30 Hz from their strike (as index.js updates them)
// and evaluated in closed form otherwise.
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/vector3.hpp>

#include <cstdint>
#include <unordered_map>
#include <vector>

#include "aov_sim.h"

namespace godot {

class AovGodpowerView : public RefCounted {
	GDCLASS(AovGodpowerView, RefCounted)

public:
	struct P { double x, y, z; float m = 1, wm = 1; };
	struct Line {
		std::vector<P> pts;
		double w, i, taper, fade;
		bool halo;
		int grp = -1; // ribbon group override (-1: the emit_lines group)
	};
	// G_GOLD .. G_ARC: the Egyptian powers (godpower_view_egypt.cpp): gold bolts and beams, rain
	// streaks, sand ribbons, the Son of Osiris' deep-gold chain lightning, Prosperity's gold light,
	// Thoth's Meteor's emissive fire trail (G_LAVA: its orange kept by the grade)
	enum Group { G_BOLT, G_SKY, G_ZAP, G_BAND, G_BAND2, G_TRAIL, G_FIRE, G_SPARK, G_BLOOM, G_GOLD, G_RAIN, G_SAND, G_ARC, G_GILD, G_LAVA, G_COUNT };
	enum Inst { I_DEBRIS, I_EMBER, I_GLOW, I_RIM, I_DECAL_MIX, I_DECAL_ADD, I_DECAL_MUL, I_PUFF, I_FLAME, I_COUNT };

	struct Ribbon {
		std::vector<float> v, c0, c1, c2;
		std::vector<int32_t> idx;
		void clear() { v.clear(); c0.clear(); c1.clear(); c2.clear(); idx.clear(); }
	};
	struct Buf {
		std::vector<float> d;
		int n = 0;
		void clear() { d.clear(); n = 0; }
	};
	struct Debris {
		double x, y, z, vx, vy, vz, rx, ry, rz, wx, wy, wz, s;
		uint32_t color;
		bool ember, blue, settled;
		double cool, t0, die;
		double px, py, pz; // before the last step (interpolation)
		int64_t tick;      // last tick stepped
	};
	struct Spark {
		double x, y, z, vx, vy, vz, t0, life, dim, heat;
		double px, py, pz;
		int64_t tick;
	};
	struct BandDef { int layer, hero; double a0, sp, span, h0, climb, dr, ya; int yf; double ph, pf, rate, w, i; };
	struct PullDef { double a, w, rate, ph, dr, s, sy; uint32_t col; bool glow; double rx, rz; };
	struct Drift { uint64_t key; double x, z, t0, v; }; // a tornado's sand drift
	struct StormVis {
		bool init = false;
		double rb, rt, H, base;
		std::vector<double> gh;
		std::vector<BandDef> bands;
		std::vector<PullDef> pull;
		double hot_a = 0, hot_w = 0;
	};

private:
	Ref<AovSim> sim_ref_;
	Ribbon rib_[G_COUNT];
	Buf inst_[I_COUNT];
	std::unordered_map<uint64_t, std::vector<Line>> bolt_cache_;
	std::unordered_map<uint64_t, std::vector<Line>> zap_cache_;
	std::unordered_map<uint64_t, bool> spawned_; // scorch key -> particles spawned
	std::vector<Debris> debris_;
	std::vector<Spark> sparks_;
	std::vector<StormVis> storms_;
	std::vector<Drift> drifts_;
	double last_time_ = -1;
	std::vector<float> lights_, pools_;

	double h_at(double x, double z) const;
	void emit_lines(Group g, const std::vector<Line> &lines, double alpha, double ox = 0, double oy = 0, double oz = 0,
			double rot = 0, double sy = 1);
	void inst(Inst k, const Basis &b, double x, double y, double z, float r, float g, float bl, float a, float c0 = 0,
			float c1 = 0, float c2 = 0, float c3 = 0);
	void glow(bool depth, double x, double y, double z, double sx, double sy, double r, double g, double b, double o, double tight);
	void decal(Inst k, double x, double y, double z, double size, double rot, float r, float g, float b, float a, float kind,
			float p1 = 0, float p2 = 0, float p3 = 0);
	void cube(Inst k, double x, double y, double z, double rx, double ry, double rz, double sx, double sy, double sz, float r,
			float g, float b, float flag = 0); // flag: INSTANCE_CUSTOM.y (I_EMBER: 1 emissive)
	void light(double x, double y, double z, uint32_t hex, double intensity, double dist, double decay);
	void puff(bool add, double te, uint32_t seed, double now, double x, double y, double z, int count, uint32_t color,
			double size, double life, double speed, double up, double gravity, double grow, double spread,
			float soft = 0); // soft: puff.gdshader's round ragged puff (I_PUFF only) instead of the voxel square
	void spawn_strike(double x, double y, double z, uint32_t seed, double t0, bool blast);
	void step_particles(double now);
	void init_storm(StormVis &v, double x, double z, double t0, double radius);
	// the Egyptian powers (godpower_view_egypt.cpp)
	bool egypt_active() const;
	void egypt_fx(double now, double ua, const Vector3 &cam, int &li, Dictionary &eg);
	void thoth_fx(double now, int &li); // Thoth's Meteor: its meteors, blasts and glowing craters
	static Array pack_ribbon(const Ribbon &r, bool spark);
	static PackedFloat32Array pack_buf(const Buf &b);

protected:
	static void _bind_methods();

public:
	void setup(const Ref<AovSim> &sim);
	// One call per frame. cam: camera position (world). Returns {time,
	// ribbons: Array[G_COUNT] of mesh arrays (or null when empty),
	// inst: Array[I_COUNT] of PackedFloat32Array, counts: PackedInt32Array,
	// lights: PackedFloat32Array (9 each: x, y, z, r, g, b, intensity,
	// distance, decay; linear colour), spot: [x, y, z, intensity] (intensity
	// 0 = off), pools: PackedFloat32Array (4 each: x, z, intensity, radius),
	// flash, storm: {k, x, z, y, rb, id} of the strongest storm (k 0 = none),
	// storms: Array of {id, x, y, z, k, rb, rt, H, hot_a, hot_w, t0}}.
	Dictionary update(double alpha, bool paused, const Vector3 &cam);
	// Static data of a storm (index from update().storms[].id): {gh:
	// PackedFloat32Array (256 smoothed ground heights round the foot ring),
	// rb, rt, H, base, rain: PackedFloat32Array (3 each: x, z, seed)}.
	Dictionary storm_static(int64_t id);
};

} // namespace godot
