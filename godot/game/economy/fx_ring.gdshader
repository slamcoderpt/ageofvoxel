// Economy water rings (AovEconView rings buffer): ripples over shoals, fish
// splashes, net ripples and boat wakes. A flat 2x2 plane per instance (the
// basis scale is the radius), COLOR.rgb foam colour (sRGB), COLOR.a opacity,
// INSTANCE_CUSTOM.r the band width (fraction of the radius).
shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, diffuse_lambert, specular_schlick_ggx, shadows_disabled;

varying vec3 v_col;
varying float v_a;
varying float v_band;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_col = srgb_to_linear(COLOR.rgb);
	v_a = COLOR.a;
	v_band = max(0.05, INSTANCE_CUSTOM.r);
}

void fragment() {
	float d = length(UV * 2.0 - 1.0);
	float outer = smoothstep(1.0, 1.0 - v_band * 0.45, d);
	float inner = smoothstep(1.0 - v_band * 1.6, 1.0 - v_band * 0.55, d);
	ALBEDO = v_col;
	ALPHA = outer * inner * v_a;
	ROUGHNESS = 0.3;
}
