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
	// a tiny voxel, not a flat square: lit top-left bevel, dark lower-right edge
	vec2 q = UV;
	float edge = min(min(q.x, q.y), min(1.0 - q.x, 1.0 - q.y));
	float lit = q.x + q.y < 0.9 ? 1.18 : 0.78;
	ALBEDO = v_col.rgb * mix(0.45, lit, smoothstep(0.06, 0.16, edge));
	ALPHA = v_col.a;
}
