// AovEconView: the render-side half of the economy piece (game/economy).
// Visual only: it reads the sim (never writes it) and turns it into
// MultiMesh buffers, one call per frame, so GDScript never loops over
// entities. Port of src/economy/EconomyView.js render() + drawLoads():
//
//   - animals and carcasses, thrown spears, fish shoals (and the leaping
//     fish), fishing boats, crops on farms with the harvest front, stockpiles
//     beside drop-off buildings (stockSlots), oversized loads on walking
//     villagers, the scenes' field dressing (economy.decor);
//
// plus Godot-only activity effects (the browser has none), evaluated in
// closed form from the sim time and per-unit hashes so a capture after a
// fast-forward is deterministic, and never touching the sim RNG:
//
//   - chips: wood chips and bark off each axe strike, ore and gold glints
//     off each pick strike (timed to the units piece's gather swing), straw
//     chaff off the farmers' sickles, leaves off picked berry bushes, water
//     drops off leaping fish and hauled nets;
//   - puffs: soft dust at axe / pick strikes, hoof dust behind running game;
//   - rings: ripples over the shoals, splash rings where fish leap, net
//     ripples beside fishing boats and wakes behind moving boats.
//
// Buffer layouts: props 16 floats per instance (TRANSFORM_3D + custom data:
// linear team rgb, brightness tint), fx 20 floats (TRANSFORM_3D + colour +
// custom data), each padded with zeros to a power-of-two capacity (>= 32).
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/plane.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/transform3d.hpp>

#include <array>
#include <string>
#include <unordered_map>
#include <vector>

#include "aov_sim.h"

namespace godot {

class AovEconView : public RefCounted {
	GDCLASS(AovEconView, RefCounted)

public:
	struct Buf {
		std::vector<float> d;
		int n = 0;
		int stride = 16;
		void clear() { d.clear(); n = 0; }
	};
	struct Slot { float x, z, rot, y; };

private:
	Ref<AovSim> sim_ref_;
	std::vector<Buf> props_;                      // one per key (setup order)
	std::unordered_map<std::string, int> key_idx_;
	Buf chips_, puffs_, rings_;
	std::unordered_map<int32_t, std::vector<Slot>> slots_; // building id -> stockSlots
	int k_deer = -1, k_boar = -1, k_spear = -1, k_fish = -1, k_boat = -1, k_sheaf = -1, k_wheat[3] = { -1, -1, -1 };
	int k_load[5] = { -1, -1, -1, -1, -1 }; // log, ore, sheaf, basket, haunch (by load kind)
	int k_stock[6][3];
	std::vector<Plane> planes_; // this frame's camera frustum (empty: no culling)

	void draw(int k, double x, double y, double z, double yaw, double pitch = 0, double roll = 0, double sx = 1, double sy = 1,
			double sz = 1, float tr = 1, float tg = 1, float tb = 1, float tint = 1);
	void fx(Buf &b, double x, double y, double z, double size, float r, float g, float bl, float a, float c0 = 0, float c1 = 0,
			float c2 = 0, float c3 = 0, double yaw = 0);
	const std::vector<Slot> &stock_slots(int row);
	static PackedFloat32Array pack(const Buf &b);

protected:
	static void _bind_methods();

public:
	// keys: the "economy/<key>" model names in MultiMesh order.
	void setup(const Ref<AovSim> &sim, const PackedStringArray &keys);
	// One call per frame. Returns {props: Array[PackedFloat32Array], counts:
	// PackedInt32Array, chips, chip_count, puffs, puff_count, rings, ring_count}.
	// frustum (performance): Camera3D.get_frustum(); props whose bounding
	// sphere (with a margin for the shadows they cast into view) is off
	// screen are skipped, in the main and the shadow passes alike. Empty:
	// every prop.
	Dictionary update(double alpha, bool paused, int64_t local_player, const Array &frustum);
};

} // namespace godot
