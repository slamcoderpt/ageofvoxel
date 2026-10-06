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
uniform float saturation = 1.45;
uniform float contrast = 1.3;

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_flash;
varying float v_dead;
varying float v_fade;
varying vec3 v_tint;
// Egyptian meshes (export-egypt-units.mjs: CUSTOM1.a = an outline width factor)
varying float v_eg;
// Egyptian dye: the player colour taken down to a mineral pigment (blue reads
// lapis 0x2f4fa8, not a pure 0000ff), shaded by the face it is on, and lit
// by the scene rather than glowing, so cloth reads as cloth beside skin and gold
uniform float eg_dye_k = 0.33;
uniform vec3 eg_dye_base = vec3(0.07, 0.1, 0.075);
uniform float eg_team_lift = 0.06;
// a warm fill on the Egyptian figures' own colours, so a bare chest turned
// from the sun stays warm brown skin rather than a grey-olive block
uniform float eg_fill = 0.2;

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
	v_eg = CUSTOM1.a > 0.002 ? 1.0 : 0.0;
}

float bayer4(vec2 fc) {
	vec2 q = mod(floor(fc), 4.0);
	vec2 lo = mod(q, 2.0), hi = floor(q * 0.5);
	return (4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0) + 0.5) / 16.0;
}

void fragment() {
	if (v_fade < 0.999 && bayer4(FRAGCOORD.xy) > v_fade) discard;
	vec3 dye = v_team_col * dye_gain;
	float eg_team = v_eg * v_team;
	if (v_eg > 0.5) {
		float peak = max(max(v_team_col.r, v_team_col.g), v_team_col.b);
		dye = eg_dye_base * peak + v_team_col * eg_dye_k;
		// one step darker on the undersides and a half step on the sides
		float wy = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).y;
		dye *= wy < -0.5 ? 0.62 : (wy < 0.5 ? 0.84 : 1.0);
	}
	vec3 c = v_albedo * mix(vec3(1.0), dye, v_team) * v_tint;
	{
		float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
		c = max(mix(vec3(l), c, mix(saturation, 0.95, eg_team)), vec3(0.0));
		// contrast around a mid grey in linear light (darks deeper, lights kept)
		c *= pow(l / 0.18, mix(contrast, 1.0, eg_team) - 1.0);
	}
	// the dead drain to a cool, pale-ish grey
	float dl = dot(c, vec3(0.3, 0.59, 0.11));
	c = mix(c, vec3(dl) * vec3(0.94, 0.97, 1.04), v_dead * 0.5);
	// (round 20) Egyptian fire voxels (glow 0.75..0.85: the Phoenix's flame
	// feathers) burn mostly with their own light (a dim lit albedo, so the
	// emission is most of the pixel) and keep their orange through the grade
	// (the negative-blue marker below, as egypt_building.gdshader's fire)
	bool eg_fire = v_eg > 0.5 && v_glow > 0.75 && v_glow < 0.85;
	ALBEDO = eg_fire ? c * 0.3 : c;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
	// team colour holds its saturation in shade, plus a lit rim on edge-on faces
	float rim = pow(1.0 - clamp(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.0, 1.0), 1.6);
	vec3 team_sat = c * v_team * mix(v_team_col, normalize(dye + 1e-4) * 0.9, v_eg) * (1.0 - v_dead * 0.75);
	vec3 em = c * (eg_fire ? 1.1 : v_glow * 2.5);
	em += c * vec3(1.0, 0.9, 0.8) * eg_fill * v_eg * (1.0 - v_team) * (1.0 - v_dead);
	em += team_sat * (mix(team_lift, eg_team_lift, v_eg) + rim * mix(0.45, 0.2, v_eg));
	// rim light: warm on skin, bronze and cloth, the unit's own dye on team parts
	// (white on red reads pink), so outlines lift off the ground in shade
	vec3 rim_col = mix(c * vec3(1.0, 0.93, 0.8), team_sat * 1.2, v_team);
	// (round 12) a softer rim on the Egyptian figures' own colours: at 0.4 the
	// lit edge of every brown limb flared salmon-pink
	em += rim_col * rim * mix(0.4, mix(0.18, 0.4, v_team), v_eg) * (1.0 - v_dead);
	// hit flash: the man struck flares white-hot to orange, off every team
	// colour (the old team-tinted flash made blue soldiers look lit up)
	float hit_k = min(v_flash * 20.0, 1.0);
	vec3 hot = vec3(1.0, 0.52, 0.16);
	// Only skin, bronze and wood flare: warm light on the dye itself reads
	// violet on blue and pink on red, and the impact burst over him already
	// carries the strike.
	em += (c * vec3(1.0, 0.85, 0.7) * 0.3 + hot * c.r * 0.6 + hot * 0.05) * (0.75 + 0.5 * rim) * hit_k * (1.0 - 0.9 * v_team);
	em += vec3(1.0, 0.72, 0.4) * max(v_flash - 0.05, 0.0); // god-power blasts
	EMISSION = em;
	if (eg_fire) EMISSION.b = -8.0 * max(EMISSION.r, EMISSION.g);
}
