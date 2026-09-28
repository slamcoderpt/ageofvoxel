// Buildings and town props: voxel.gdshader (makeVoxelMaterial) plus the
// occlusion the browser gets from GTAO (PostFX.js, blended at 0.6): a
// wide-radius AO baked per vertex by AovBuildingAO (CUSTOM1.b, see
// building_ao.gd: gaps between columns, under porticoes and eaves, the foot
// of every wall where it meets the ground), multiplied into the albedo like
// the browser multiplies its AO into the frame. Pale albedo (marble,
// whitewash, cream) is pulled down a little so lit faces keep their jitter
// instead of clipping to white after the grade's exposure, and glowing
// voxels (fire pillars, lanterns, the kiln) emit less than voxel.gdshader.
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec3 team_color : source_color = vec3(1.0);
uniform bool use_instance_team = false;
uniform float roughness_value : hint_range(0.0, 1.0) = 0.93;
uniform float ao_strength : hint_range(0.0, 1.0) = 0.9;
uniform float ao_power = 0.9;
uniform float ao_up = 0.2;   // factor on faces looking up (roof tiles, steps: open to the sky light GTAO sees)
uniform float pale_scale : hint_range(0.5, 1.0) = 0.87;   // sRGB factor on the palest colours
uniform float pale_from = 0.5;
uniform float pale_to = 0.85;
uniform float glow_gain = 1.1;   // voxel.gdshader: 2.5; lower so fire / lantern tops keep their facets after the grade

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_flash;
varying float v_ao;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	vec3 s = CUSTOM0.rgb;
	float mx = max(max(s.r, s.g), s.b);
	s *= mix(1.0, pale_scale, smoothstep(pale_from, pale_to, mx));
	v_albedo = srgb_to_linear(s);
	v_team = CUSTOM1.r;
	v_glow = CUSTOM1.g;
	v_ao = 1.0 - ao_strength * mix(1.0, ao_up, max(NORMAL.y, 0.0)) * pow(clamp(CUSTOM1.b, 0.0, 1.0), ao_power);
	if (use_instance_team) {
		v_team_col = INSTANCE_CUSTOM.rgb;
		v_flash = INSTANCE_CUSTOM.a;
	} else {
		v_team_col = team_color;
		v_flash = 0.0;
	}
}

void fragment() {
	vec3 c = v_albedo * mix(vec3(1.0), v_team_col, v_team);
	ALBEDO = c * v_ao;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
	EMISSION = c * v_glow * glow_gain + vec3(1.0, 0.95, 0.85) * v_flash;
}
