// Shadow caster proxy of a unit part (performance piece): the part's box,
// drawn only into the sun's shadow map with the same instance transforms as
// the part itself, so a crowd of 2000 casts 12 triangles per part instead of
// the full voxel mesh (a few hundred). Corpses that have faded past half
// stop casting (the vertex collapses; no fragment work in the depth pass).
shader_type spatial;
render_mode unshaded, cull_disabled;

void vertex() {
	if (COLOR.a < 0.5) {
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	ALBEDO = vec3(0.0);
}
