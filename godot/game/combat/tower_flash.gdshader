// Tower fire flashes (mode 0 of the tower fire sprites) (game/combat/tower_fire.gd): camera-facing quads.
// Instance: origin = position, COLOR = rgb + alpha,
// INSTANCE_CUSTOM = (size in world units, min size in px at 1080p, seed, age 0..1).
// mode 0 (blend_add material): a hot flash / glint, white core in a warm glow
// with four short rays (age < 0: a plain glow dot); mode 1 (blend_mix material): a soft ragged puff of
// pale dust or bow smoke that grows and thins with age.
shader_type spatial;
render_mode unshaded, blend_add, fog_disabled, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

const int mode = 0;

varying vec4 v_col;
varying float v_seed;
varying float v_age;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float wpp = -c.z / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y * 0.5);
	float r = max(INSTANCE_CUSTOM.x, INSTANCE_CUSTOM.y * VIEWPORT_SIZE.y / 1080.0 * wpp);
	v_col = COLOR;
	v_seed = INSTANCE_CUSTOM.z;
	v_age = INSTANCE_CUSTOM.w;
	c.z += mode == 0 ? 0.3 : -0.1;   // flashes draw over the stone they leave from
	VERTEX = c + vec3(VERTEX.xy * r * 2.0, 0.0);
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	vec2 p = UV - 0.5;
	float d = length(p) * 2.0;
	if (mode == 0) {
		float ang = atan(p.y, p.x) + v_seed * 6.28;
		// age < 0: a plain glow dot (the tracer behind an arrow), no rays
		float rays = v_age < 0.0 ? 0.0 : pow(abs(cos(ang * 2.0)), 24.0) * smoothstep(1.0, 0.1, d);
		float core = smoothstep(0.22, 0.0, d);
		float glow = exp(-d * d * 3.0) * smoothstep(1.0, 0.7, d);
		vec3 col = v_col.rgb * (glow * 1.1 + rays * 0.9) + vec3(1.0, 0.9, 0.7) * core * 0.9;
		float a = v_col.a * clamp(glow + rays + core, 0.0, 1.0);
		if (a < 0.004) discard;
		ALBEDO = col * 0.75;   // the grade's exposure (2.1) does the rest: keep it warm, not blown white
		ALPHA = clamp(a, 0.0, 1.0);
	} else {
		float ang = atan(p.y, p.x);
		float rr = d * (1.0 + 0.16 * sin(ang * 3.0 + v_seed * 6.28) + 0.09 * sin(ang * 5.0 - v_seed * 9.0));
		float a = v_col.a * smoothstep(1.0, 0.25 + 0.4 * v_age, rr);
		if (a < 0.01) discard;
		ALBEDO = v_col.rgb * (0.85 + 0.35 * (0.5 - p.y));
		ALPHA = a;
	}
}
