// Ra's Rain: the rainbow (an arc ribbon, egypt_fx.gd). UV.x along the arc (0..1), UV.y across
// it (0 outer red .. 1 inner violet); additive, soft at both edges and fading into the ground
// at its feet. k = strength.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform float k = 0.0;

vec3 spectrum(float t) {
	// red, orange, yellow, green, blue, violet
	vec3 c = vec3(1.0, 0.1, 0.08);
	c = mix(c, vec3(1.0, 0.5, 0.05), smoothstep(0.08, 0.25, t));
	c = mix(c, vec3(1.0, 0.95, 0.2), smoothstep(0.25, 0.42, t));
	c = mix(c, vec3(0.2, 1.0, 0.3), smoothstep(0.42, 0.6, t));
	c = mix(c, vec3(0.15, 0.4, 1.0), smoothstep(0.6, 0.78, t));
	c = mix(c, vec3(0.55, 0.2, 1.0), smoothstep(0.78, 0.95, t));
	return c;
}

void fragment() {
	float across = UV.y;
	float edge = smoothstep(0.0, 0.18, across) * smoothstep(1.0, 0.82, across);
	float feet = smoothstep(0.0, 0.16, UV.x) * smoothstep(1.0, 0.84, UV.x);
	vec3 c = spectrum(across) * edge * feet * k * 0.34;
	ALBEDO = c;
	ALPHA = 1.0;
}
