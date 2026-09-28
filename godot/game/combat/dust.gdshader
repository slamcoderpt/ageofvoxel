// Dust puffs (BattleFX.js dust): soft ragged-edged sprites of trampled
// ochre earth, pushed a little behind the figures. Instance: origin =
// position, COLOR = rgb + alpha, INSTANCE_CUSTOM.x = size, .y = seed.
shader_type spatial;
render_mode unshaded, fog_disabled, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec4 v_col;
varying float v_seed;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float size = INSTANCE_CUSTOM.x * 0.55;
	v_col = COLOR;
	v_seed = INSTANCE_CUSTOM.y;
	c.z -= 0.45;
	VERTEX = c + vec3(VERTEX.xy * size, 0.0);
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	vec2 p = UV - 0.5;
	float ang = atan(p.y, p.x);
	float r = length(p) * (1.0 + 0.18 * sin(ang * 3.0 + v_seed * 6.28) + 0.1 * sin(ang * 5.0 - v_seed * 11.0));
	float a = v_col.a * smoothstep(0.5, 0.12, r);
	if (a < 0.01) discard;
	ALBEDO = v_col.rgb * (0.82 + 0.4 * (0.5 - p.y));
	ALPHA = a;
}
