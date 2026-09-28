// Flying chips (core/fx/Particles.js solid pool): small flat squares of
// bronze, cloth, blood and earth thrown up by blows. Instance: origin =
// position, COLOR = rgb + alpha, INSTANCE_CUSTOM.x = size.
shader_type spatial;
render_mode unshaded, fog_disabled, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec4 v_col;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float size = INSTANCE_CUSTOM.x * 0.5;
	v_col = COLOR;
	VERTEX = c + vec3(VERTEX.xy * size, 0.0);
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	ALBEDO = v_col.rgb;
	ALPHA = v_col.a;
}
