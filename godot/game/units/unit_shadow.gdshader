// Sun shadow caster of a unit part: drawn only into the sun's shadow map
// with the same instance transforms as the part itself (a coarse shadow-only
// voxel twin for near units, the part's box for far ones: a crowd of 2000
// casts a few hundred triangles per man instead of thousands).
//
// Compact shadows: the late-afternoon sun (~33 deg) lays a man's shadow 1.5
// body lengths long, and in a packed melee those streaks merge into dark
// stripes across the dirt and the neighbours. Every caster vertex is squashed
// towards the ground under it (the sim's voxel levels, ground_tex), so each
// figure casts a crisp shadow of about one body length that starts at its
// feet; the shadow is closer to its caster, so the soft-shadow penumbra is
// tighter too. Only the shadow pass sees this; the unit itself is unchanged.
// Corpses that have faded past half stop casting (the vertex collapses).
shader_type spatial;
render_mode unshaded, cull_disabled, world_vertex_coords;

// the sim's height levels: int32 little-endian bytes as RGBA8
uniform sampler2D ground_tex : filter_nearest, repeat_disable;
uniform float cell = 0.5;          // world size of one level column (VOXEL)
uniform float floor_level = -1e6;  // water level - 0.3 (map.height_at clamp)
uniform float squash = 0.7;       // caster height kept above the ground

float ground_at(vec2 xz) {
	ivec2 sz = textureSize(ground_tex, 0);
	ivec2 c = clamp(ivec2(floor(xz / cell)), ivec2(0), sz - 1);
	vec4 b = floor(texelFetch(ground_tex, c, 0) * 255.0 + 0.5);
	float hi = b.a >= 128.0 ? b.a - 256.0 : b.a;
	float lvl = b.r + b.g * 256.0 + b.b * 65536.0 + hi * 16777216.0;
	return max(lvl, floor_level) * cell;
}

void vertex() {
	if (COLOR.a < 0.5) {
		VERTEX = vec3(0.0);
	} else {
		float g = ground_at(VERTEX.xz);
		float up = VERTEX.y - g;
		if (up > 0.0) {
			VERTEX.y = g + up * squash;
		}
	}
}

void fragment() {
	ALBEDO = vec3(0.0);
}
