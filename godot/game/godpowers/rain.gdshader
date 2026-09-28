// Rain streaks over the storm (effects.js rainMat): line segments falling
// through an 18-unit column, additive, brightening with each flash.
// UV = (end 0 head / 1 tail, seed).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform float time = 0.0;
uniform float k = 0.0;
uniform float flash = 0.0;
varying float v_a;

void vertex() {
	float H = 18.0;
	float aEnd = UV.x, aSeed = UV.y;
	float y = mod(aSeed * H * 7.13 - time * 26.0, H);
	VERTEX += vec3(0.0, y + aEnd * 1.1, 0.0) + vec3(0.35, 0.0, 0.25) * aEnd;
	v_a = (1.0 - aEnd * 0.8) * smoothstep(0.0, 2.0, y) * smoothstep(H, H - 4.0, y);
}

void fragment() {
	ALBEDO = vec3(0.5, 0.6, 0.8) * (0.1 + flash * 0.22) * v_a * k;
	ALPHA = 1.0;
}
