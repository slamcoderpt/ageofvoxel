// Drop shadows under men thrown into the air: a soft dark blot multiplied
// into the frame, COLOR.a = its depth (tighter and darker the lower he flies).
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
varying float v_d;
void vertex() { v_d = COLOR.a; }
void fragment() {
	float d = length(UV - 0.5) * 2.0;
	float a = (1.0 - smoothstep(0.35, 1.0, d)) * v_d;
	ALBEDO = vec3(1.0 - a);
	ALPHA = 1.0;
}
