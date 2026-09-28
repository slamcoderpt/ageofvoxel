// AovBuildingAO (buildings piece, render side only; never touches the sim):
// bakes a wide-radius ambient occlusion into an exported building / prop
// mesh, the part of the browser's GTAO the mesher's corner AO cannot give:
// the dark gaps between colonnade columns, the recess under a portico or
// eave, and the contact darkening where a wall meets the ground (the model's
// y = 0 plane counts as solid). See building_ao.cpp.
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>

namespace godot {

class AovBuildingAO : public RefCounted {
	GDCLASS(AovBuildingAO, RefCounted)

protected:
	static void _bind_methods();

public:
	// arrays: Mesh surface arrays (VERTEX, NORMAL, INDEX used). Returns one
	// byte per vertex, 0 = open sky, 255 = fully occluded within `radius`.
	static PackedByteArray bake(const Array &arrays, double radius, bool ground);
};

} // namespace godot
