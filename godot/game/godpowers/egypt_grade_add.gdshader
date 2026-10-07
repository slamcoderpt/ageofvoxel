// The Eclipse's additive half (egypt_grade.gdshader is the multiply): a faint moonlit blue
// lift so the shade under the eclipse reads blue-grey (Retold's power_05: dark blue shadows on
// pale blue ground), not black. Linear HDR, before the lighting grade's exposure.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;

uniform float eclipse_k = 0.0;

void vertex() {
	POSITION = vec4(VERTEX.xy, 0.5, 1.0);
}

void fragment() {
	float vg = length((SCREEN_UV * 2.0 - 1.0) * vec2(0.9, 1.0));
	ALBEDO = vec3(0.012, 0.04, 0.12) * eclipse_k * (1.0 - 0.3 * smoothstep(0.5, 1.4, vg));
	ALPHA = 1.0;
}
