// Flames and hot sparks (Particles.js additive pool): soft discs.
// INSTANCE_CUSTOM.y > 0.5: emissive fire (Thoth's Meteor): the disc also writes a negative
// blue, the mark game/lighting/grade_effect.gd reads to keep its orange instead of grading it
// (the grade's warm-chroma limiter turns a bright additive orange pink).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
varying vec4 v_col;
varying float v_emit;
varying float v_tall;
void vertex() {
	// (the basis' x / y lengths: a tongue of fire may be taller than wide)
	vec2 s = vec2(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz));
	vec4 mv = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	mv.xy += VERTEX.xy * s + vec2(0.0, max(0.0, s.y - s.x) * 0.4);
	POSITION = PROJECTION_MATRIX * mv;
	v_col = COLOR;
	v_emit = INSTANCE_CUSTOM.y;
	v_tall = step(s.x * 1.2, s.y);
}
void fragment() {
	vec2 q = UV - 0.5;
	// a tongue (taller than wide) narrows to a tip at the top
	float d = length(vec2(q.x / mix(1.0, 0.35, clamp(-q.y * 2.0, 0.0, 1.0) * v_tall), q.y));
	float a = v_col.a * smoothstep(0.5, 0.0, d);
	ALBEDO = v_col.rgb * a;
	if (v_emit > 0.5) ALBEDO.b = -8.0 * max(ALBEDO.r, ALBEDO.g);
	ALPHA = a;
}
