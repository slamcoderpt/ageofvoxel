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
uniform float dye_gain = 0.85;
uniform float team_lift = 0.32;
// material grade: the figures hold more saturation and contrast than the dirt
// they stand on, so each silhouette separates under the cloud shadows
uniform float saturation = 1.3;
uniform float contrast = 1.18;

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
	{
		float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
		c = max(mix(vec3(l), c, saturation), vec3(0.0));
		// contrast around a mid grey in linear light (darks deeper, lights kept)
		c *= pow(l / 0.18, contrast - 1.0);
	}
	// the dead drain to a cool, pale-ish grey
	float dl = dot(c, vec3(0.3, 0.59, 0.11));
	c = mix(c, vec3(dl) * vec3(0.94, 0.97, 1.04), v_dead * 0.5);
	ALBEDO = c;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
	// team colour holds its saturation in shade, plus a lit rim on edge-on faces
	float rim = pow(1.0 - clamp(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.0, 1.0), 1.6);
	vec3 team_sat = c * v_team * v_team_col * (1.0 - v_dead * 0.75);
	vec3 em = c * v_glow * 2.5;
	em += team_sat * (team_lift + rim * 0.45);
	// rim light: warm on skin, bronze and cloth, the unit's own dye on team parts
	// (white on red reads pink), so outlines lift off the ground in shade
	vec3 rim_col = mix(c * vec3(1.0, 0.93, 0.8), team_sat * 1.2, v_team);
	em += rim_col * rim * 0.4 * (1.0 - v_dead);
	// hit flash: the man struck flares white-hot to orange, off every team
	// colour (the old team-tinted flash made blue soldiers look lit up)
	float hit_k = min(v_flash * 20.0, 1.0);
	vec3 hot = vec3(1.0, 0.52, 0.16);
	em += (c * vec3(1.0, 0.85, 0.7) * 0.3 + hot * c.r * 0.6 + hot * 0.05) * (0.75 + 0.5 * rim) * hit_k;
	em += vec3(1.0, 0.72, 0.4) * max(v_flash - 0.05, 0.0); // god-power blasts
	EMISSION = em;
}
