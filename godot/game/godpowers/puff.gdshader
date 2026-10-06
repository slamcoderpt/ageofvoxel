// Smoke puffs (Particles.js solid pool): camera-facing voxel squares,
// COLOR.rgb linear colour, COLOR.a opacity; the instance basis is the size.
// INSTANCE_CUSTOM.y > 0.5: soft smoke (Thoth's Meteor): a round puff with a ragged,
// fading edge and a lighter top instead of the hard square.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
varying vec4 v_col;
varying vec2 v_c;
void vertex() {
	float s = length(MODEL_MATRIX[0].xyz);
	vec4 mv = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	mv.xy += VERTEX.xy * s;
	POSITION = PROJECTION_MATRIX * mv;
	v_col = COLOR;
	v_c = INSTANCE_CUSTOM.xy;
}
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
void fragment() {
	vec2 p = UV - 0.5;
	if (v_c.y > 0.5) {
		vec2 o = vec2(v_c.x * 17.0, v_c.x * 9.0);
		float n = vn(p * 5.0 + o) * 0.6 + vn(p * 11.0 + o * 1.7) * 0.4;
		float d = length(p) * 2.0 + (n - 0.5) * 0.45;
		float a = 1.0 - smoothstep(0.35, 0.95, d);
		if (a <= 0.01) discard;
		ALBEDO = v_col.rgb * (0.8 + 0.45 * n + 0.35 * clamp(-p.y * 1.5, -0.3, 0.6));
		ALPHA = v_col.a * a;
	} else {
		if (max(abs(p.x), abs(p.y)) > 0.45) discard;
		ALBEDO = v_col.rgb;
		ALPHA = v_col.a;
	}
}
