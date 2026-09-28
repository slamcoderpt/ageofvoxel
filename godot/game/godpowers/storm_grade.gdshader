// Storm grade, multiplicative pass (dst * m): see storm_grade.gdshaderinc.
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_grade.gdshaderinc"
void fragment() {
	vec3 add;
	ALBEDO = grade(SCREEN_UV, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX, add);
	ALPHA = 1.0;
}
