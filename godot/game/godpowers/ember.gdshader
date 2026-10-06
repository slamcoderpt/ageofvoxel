// Glowing ember cubes and motes: unlit HDR colour (COLOR.rgb, linear).
// INSTANCE_CUSTOM.y > 0.5: emissive (Thoth's Meteor's lava): (r, g) kept by the grade
// (a negative blue, see flame.gdshader / game/lighting/grade_effect.gd).
shader_type spatial;
render_mode unshaded, fog_disabled, shadows_disabled;
varying vec3 v_col;
varying float v_emit;
void vertex() { v_col = COLOR.rgb; v_emit = INSTANCE_CUSTOM.y; }
void fragment() {
	ALBEDO = v_col;
	if (v_emit > 0.5) ALBEDO.b = -8.0 * max(v_col.r, v_col.g);
}
