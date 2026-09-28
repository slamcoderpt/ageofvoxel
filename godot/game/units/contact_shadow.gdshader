// Contact shadow under every unit (index.js _initContactShadows): a dark,
// soft-edged disc so each man in a crowd sits on his own patch of earth.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec3 tint : source_color = vec3(0.047, 0.031, 0.016);
uniform float opacity = 0.42;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float d = length(p);
	float a = d >= 1.0 ? 0.0 : (d < 0.45 ? 1.0 : pow(1.0 - (d - 0.45) / 0.55, 1.6));
	ALBEDO = tint;
	ALPHA = a * opacity;
}
