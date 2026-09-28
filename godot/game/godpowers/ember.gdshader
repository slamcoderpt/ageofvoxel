// Glowing ember cubes and motes: unlit HDR colour (COLOR.rgb, linear).
shader_type spatial;
render_mode unshaded, fog_disabled, shadows_disabled;
varying vec3 v_col;
void vertex() { v_col = COLOR.rgb; }
void fragment() { ALBEDO = v_col; }
