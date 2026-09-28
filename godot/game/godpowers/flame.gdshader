// Flames and hot sparks (Particles.js additive pool): soft discs.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
varying vec4 v_col;
void vertex() {
	float s = length(MODEL_MATRIX[0].xyz);
	vec4 mv = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	mv.xy += VERTEX.xy * s;
	POSITION = PROJECTION_MATRIX * mv;
	v_col = COLOR;
}
void fragment() {
	float d = length(UV - 0.5);
	float a = v_col.a * smoothstep(0.5, 0.0, d);
	ALBEDO = v_col.rgb * a;
	ALPHA = a;
}
