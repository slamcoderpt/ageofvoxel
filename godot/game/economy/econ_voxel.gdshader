// Voxel material of the economy props (port of the EconomyRenderer
// material): albedo from CUSTOM0 (sRGB, jitter + AO baked), team tint from
// CUSTOM1.r, glow from CUSTOM1.g; per instance (MultiMesh custom data)
// rgb = linear team colour, a = brightness tint (1 = none; animals flash > 1).
// sway > 0 (the crops): the stalks lean in a slow wind wave that rolls
// across the fields, bending more towards the ears; the base stays planted.
// crop_ao: the rows darken towards the soil like a dense stand of stalks.
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform float sway = 0.0;
uniform float crop_ao = 0.0;

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_tint;
varying float v_h;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_albedo = srgb_to_linear(CUSTOM0.rgb);
	v_team = CUSTOM1.r;
	v_glow = CUSTOM1.g;
	v_team_col = INSTANCE_CUSTOM.rgb;
	v_tint = INSTANCE_CUSTOM.a;
	v_h = VERTEX.y;
	if (sway > 0.0) {
		vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float k = clamp(VERTEX.y / 0.9, 0.0, 1.2);
		k *= k;
		float gust = sin(TIME * 0.9 + wp.x * 0.31 + wp.z * 0.17) * 0.6 + sin(TIME * 2.3 + wp.x * 1.1 - wp.z * 0.7) * 0.25;
		VERTEX.x += sway * k * (0.45 + gust);
		VERTEX.z += sway * k * 0.35 * gust;
		VERTEX.y -= sway * k * 0.25 * abs(gust);
	}
}

void fragment() {
	vec3 c = v_albedo * mix(vec3(1.0), v_team_col, v_team) * v_tint;
	if (crop_ao > 0.0) {
		c *= mix(1.0 - crop_ao, 1.0, smoothstep(0.0, 0.55, v_h));
	}
	ALBEDO = c;
	ROUGHNESS = 0.85;
	METALLIC = 0.0;
	EMISSION = c * v_glow * 2.5;
}
