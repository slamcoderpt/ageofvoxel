// Zeus's bolt on the feature card (hero_art.gd): a white-hot core in a blue
// halo across the ribbon (UV.x), over-bright for the glow.
shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

uniform float intensity = 5.0;

void fragment() {
	float x = abs(UV.x * 2.0 - 1.0);
	float core = smoothstep(1.0, 0.35, x);
	float halo = pow(1.0 - x, 3.0);
	vec3 c = vec3(1.0, 0.98, 1.0) * core * intensity * 1.6 + vec3(0.3, 0.45, 1.0) * halo * intensity * 0.3;
	ALBEDO = c;
}
