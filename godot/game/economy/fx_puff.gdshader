// Economy dust puffs (AovEconView puffs buffer): soft camera-facing discs,
// lit from above so they sit in the scene's light and shadow. The instance
// basis carries the size, COLOR.rgb the sRGB dust colour, COLOR.a the opacity.
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, diffuse_lambert, specular_disabled, shadows_disabled;

varying vec3 v_col;
varying float v_a;
varying float v_seed;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	float s = length(MODEL_MATRIX[1].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0] * s, INV_VIEW_MATRIX[1] * s, INV_VIEW_MATRIX[2] * s, MODEL_MATRIX[3]);
	v_col = srgb_to_linear(COLOR.rgb);
	v_a = COLOR.a;
	v_seed = fract(dot(MODEL_MATRIX[3].xz, vec2(0.37, 0.61)));
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p);
	// lumpy edge so a puff reads as dust, not a disc
	float ang = atan(p.y, p.x);
	float edge = 0.78 + 0.12 * sin(ang * 3.0 + v_seed * 20.0) + 0.08 * sin(ang * 5.0 - v_seed * 13.0);
	float a = smoothstep(edge, edge * 0.35, d);
	ALBEDO = v_col;
	ALPHA = a * v_a;
	NORMAL = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	ROUGHNESS = 1.0;
}
