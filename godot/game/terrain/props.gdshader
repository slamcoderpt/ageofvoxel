// Voxel material for instanced terrain props (trees, gold, berries, ground
// details): game/core/voxel.gdshader plus the per-instance tint of the JS
// InstancedMesh.setColorAt (MultiMesh colours, linear, multiply the albedo).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform float roughness_value : hint_range(0.0, 1.0) = 0.82;

varying vec3 v_albedo;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_albedo = srgb_to_linear(CUSTOM0.rgb) * COLOR.rgb;
}

void fragment() {
	ALBEDO = v_albedo;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
}
