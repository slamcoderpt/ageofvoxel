// Smoke puffs (Particles.js solid pool): camera-facing voxel squares,
// COLOR.rgb linear colour, COLOR.a opacity; the instance basis is the size.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
varying vec4 v_col;
void vertex() {
	float s = length(MODEL_MATRIX[0].xyz);
	vec4 mv = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	mv.xy += VERTEX.xy * s;
	POSITION = PROJECTION_MATRIX * mv;
	v_col = COLOR;
}
void fragment() {
	vec2 p = UV - 0.5;
	if (max(abs(p.x), abs(p.y)) > 0.45) discard;
	ALBEDO = v_col.rgb;
	ALPHA = v_col.a;
}
