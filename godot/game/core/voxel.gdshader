// Standard voxel material (port of makeVoxelMaterial in src/core/voxel.js):
// albedo from CUSTOM0 (sRGB, jitter + AO baked), team tint from CUSTOM1.r,
// emissive glow from CUSTOM1.g. Team colour: the team_color uniform, or with
// use_instance_team the MultiMesh per-instance custom data (rgb = team colour,
// a = hit flash 0..1).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec3 team_color : source_color = vec3(1.0);
uniform bool use_instance_team = false;
uniform float roughness_value : hint_range(0.0, 1.0) = 0.82;

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_flash;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_albedo = srgb_to_linear(CUSTOM0.rgb);
	v_team = CUSTOM1.r;
	v_glow = CUSTOM1.g;
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
	ALBEDO = c;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
	EMISSION = c * v_glow * 2.5 + vec3(1.0, 0.95, 0.85) * v_flash;
}
