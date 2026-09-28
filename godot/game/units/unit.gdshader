// Unit parts (port of the units material of src/units/index.js: voxel.js +
// the unitFade / unitTeamLift patches). Per vertex: CUSTOM0 = sRGB albedo
// (jitter + AO baked), CUSTOM1.r = team mask, CUSTOM1.g = glow. Per instance
// (AovUnitView buffers): COLOR.rgb = coat / corpse tint, COLOR.a = fade
// (corpses dither out), INSTANCE_CUSTOM.rgb = linear team colour,
// INSTANCE_CUSTOM.a = floor(dead * 100) + hit flash (0..0.99).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform float roughness_value : hint_range(0.0, 1.0) = 0.82;
// dye brightness: keeps the lit team colour below the tone map's highlight
// desaturation, so red reads red rather than pink
uniform float dye_gain = 1.0;
uniform float team_lift = 0.45;

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_flash;
varying float v_dead;
varying float v_fade;
varying vec3 v_tint;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_albedo = srgb_to_linear(CUSTOM0.rgb);
	v_team = CUSTOM1.r;
	v_glow = CUSTOM1.g;
	v_team_col = INSTANCE_CUSTOM.rgb;
	v_dead = floor(INSTANCE_CUSTOM.a + 0.001) / 100.0;
	v_flash = INSTANCE_CUSTOM.a - floor(INSTANCE_CUSTOM.a + 0.001);
	v_fade = COLOR.a;
	v_tint = COLOR.rgb;
}

float bayer4(vec2 fc) {
	vec2 q = mod(floor(fc), 4.0);
	vec2 lo = mod(q, 2.0), hi = floor(q * 0.5);
	return (4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0) + 0.5) / 16.0;
}

void fragment() {
	if (v_fade < 0.999 && bayer4(FRAGCOORD.xy) > v_fade) discard;
	vec3 c = v_albedo * mix(vec3(1.0), v_team_col * dye_gain, v_team) * v_tint;
	// the dead drain to a cool, pale-ish grey
	float dl = dot(c, vec3(0.3, 0.59, 0.11));
	c = mix(c, vec3(dl) * vec3(0.94, 0.97, 1.04), v_dead * 0.5);
	ALBEDO = c;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
	// team colour holds its saturation in shade, plus a lit rim on edge-on faces
	float rim = pow(1.0 - clamp(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.0, 1.0), 1.6);
	vec3 team_sat = c * v_team * v_team_col * (1.0 - v_dead * 0.75);
	vec3 em = c * v_glow * 2.5 + vec3(1.0, 0.95, 0.85) * v_flash;
	em += team_sat * (team_lift + rim * 0.45);
	em += c * vec3(1.0, 0.93, 0.8) * rim * 0.35 * (1.0 - v_dead);
	// hit flash: the man struck blazes in his own army's colour
	float hit_k = min(v_flash * 20.0, 1.0);
	em += c * v_team_col * v_team_col * (0.26 + 0.2 * rim) * hit_k;
	EMISSION = em;
}
