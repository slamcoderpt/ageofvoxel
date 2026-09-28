// Economy activity chips (AovEconView chips buffer): wood chips, ore and gold
// glints, straw chaff, leaves, water drops. One unit cube per instance; the
// instance basis carries yaw and size, COLOR.rgb the sRGB colour,
// INSTANCE_CUSTOM.r a glow (gold glints), INSTANCE_CUSTOM.g the tumble angle.
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

varying vec3 v_col;
varying float v_glow;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	float a = INSTANCE_CUSTOM.g;
	float c = cos(a), s = sin(a);
	VERTEX = vec3(VERTEX.x, VERTEX.y * c - VERTEX.z * s, VERTEX.y * s + VERTEX.z * c);
	NORMAL = vec3(NORMAL.x, NORMAL.y * c - NORMAL.z * s, NORMAL.y * s + NORMAL.z * c);
	v_col = srgb_to_linear(COLOR.rgb);
	v_glow = INSTANCE_CUSTOM.r;
}

void fragment() {
	ALBEDO = v_col;
	ROUGHNESS = mix(0.85, 0.35, v_glow);
	METALLIC = 0.0;
	EMISSION = v_col * v_glow * 1.6;
}
