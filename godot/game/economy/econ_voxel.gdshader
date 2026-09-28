// Voxel material of the economy props (port of the EconomyRenderer
// material): albedo from CUSTOM0 (sRGB, jitter + AO baked), team tint from
// CUSTOM1.r, glow from CUSTOM1.g; per instance (MultiMesh custom data)
// rgb = linear team colour, a = brightness tint (1 = none; animals flash > 1).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_tint;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_albedo = srgb_to_linear(CUSTOM0.rgb);
	v_team = CUSTOM1.r;
	v_glow = CUSTOM1.g;
	v_team_col = INSTANCE_CUSTOM.rgb;
	v_tint = INSTANCE_CUSTOM.a;
}

void fragment() {
	vec3 c = v_albedo * mix(vec3(1.0), v_team_col, v_team) * v_tint;
	ALBEDO = c;
	ROUGHNESS = 0.85;
	METALLIC = 0.0;
	EMISSION = c * v_glow * 2.5;
}
