// Minimap unit dots, drawn by one MultiMeshInstance2D with no per-unit
// script work: each instance reads its unit's position / owner / flags /
// type / selection straight from data textures built from the sim's packed
// arrays (AovSim.get_units()), and hides itself when dead or (for other
// players) outside the local player's current sight.
shader_type canvas_item;

uniform sampler2D pos_tex : filter_nearest;    // RG32F: x, z per unit row
uniform sampler2D owner_tex : filter_nearest;  // R8 owner
uniform sampler2D flags_tex : filter_nearest;  // R8 flags (2 = dead)
uniform sampler2D type_tex : filter_nearest;   // R8 unit type index
uniform sampler2D sel_tex : filter_nearest;    // R8 255 = selected
uniform sampler2D fog_tex : filter_nearest;    // R8 fog (255 visible), map tiles
uniform float map_size = 128.0;
uniform bool fog_on = false;
uniform int local_player = 1;
uniform int count = 0;
uniform vec3 colors[8];                         // player colours (sRGB)
uniform float big[16];                          // 1 for myth units (larger dot)

varying vec4 v_col;
varying float v_edge;

void vertex() {
	int i = INSTANCE_ID;
	vec2 p = texelFetch(pos_tex, ivec2(i, 0), 0).rg;
	int owner = int(texelFetch(owner_tex, ivec2(i, 0), 0).r * 255.0 + 0.5);
	int flags = int(texelFetch(flags_tex, ivec2(i, 0), 0).r * 255.0 + 0.5);
	int type = int(texelFetch(type_tex, ivec2(i, 0), 0).r * 255.0 + 0.5);
	bool sel = texelFetch(sel_tex, ivec2(i, 0), 0).r > 0.5;
	bool dead = (flags & 2) != 0;
	bool show = i < count && !dead;
	if (show && fog_on && owner != local_player) {
		ivec2 t = clamp(ivec2(floor(p)), ivec2(0), ivec2(int(map_size) - 1));
		show = texelFetch(fog_tex, t, 0).r > 0.9;
	}
	float r = big[clamp(type, 0, 15)] > 0.5 ? 1.6 : 1.1;
	float R = r + 0.5;
	v_edge = 0.5 / (2.0 * R);
	vec3 c = owner == local_player ? vec3(0.435, 0.690, 1.0) : colors[clamp(owner, 0, 7)];
	if (sel) c = vec3(1.0);
	v_col = vec4(c, 1.0);
	VERTEX = show ? p + VERTEX * 2.0 * R : vec2(-1.0e5);
}

void fragment() {
	vec2 e = min(UV, 1.0 - UV);
	float inner = step(v_edge, min(e.x, e.y));
	COLOR = mix(vec4(0.0, 0.0, 0.0, 0.8), v_col, inner);
}
