// Storm grade, additive pass: a faint cool lift under the strikes and the
// violet spill round the wall. See storm_grade.gdshaderinc.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_grade.gdshaderinc"
void fragment() {
	vec3 add;
	grade(SCREEN_UV, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX, add);
	ALBEDO = add;
	ALPHA = 1.0;
}
