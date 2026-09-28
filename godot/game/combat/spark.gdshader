// Hit sparks (BattleFX.js sparks): HDR-bright additive streaks drawn over
// the figures, thin at the tail and fat and white-hot at the head, stretched
// along their screen velocity; a slow spark is a hot pinpoint with a small
// curved slash. Instance: origin = position, COLOR = rgb * brightness,
// alpha; INSTANCE_CUSTOM = (size, velocity xyz).
shader_type spatial;
render_mode unshaded, fog_disabled, blend_add, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec4 v_col;
varying float v_len;   // 0 = slow spark
varying float v_wpx;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float wpp = -c.z / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y * 0.5);
	float size = INSTANCE_CUSTOM.x * 0.55;           // point sprite size, world units
	vec3 vel = (VIEW_MATRIX * vec4(INSTANCE_CUSTOM.yzw, 0.0)).xyz;
	vec2 sv = vel.xy;
	float sl = length(sv) * 0.06;
	v_col = COLOR;
	float ps_px = size / wpp;
	v_wpx = clamp(ps_px / 36.0, 1.0, 1.8);
	if (dot(INSTANCE_CUSTOM.yzw, INSTANCE_CUSTOM.yzw) < 0.04 || sl < 1e-4) {
		v_len = 0.0;
		// a hot pinpoint in a soft glow (the browser's bloom on the flash)
		float r = max(size * 0.9, 14.0 * wpp);
		VERTEX = c + vec3(VERTEX.x * r * 2.0, VERTEX.y * r * 2.0, 0.0);
	} else {
		float len = clamp(sl, 0.15 * size, 0.7 * size);
		vec2 d = normalize(sv);
		vec2 n = vec2(-d.y, d.x);
		float w = 8.5 * wpp * v_wpx;
		v_len = 1.0;
		VERTEX = c + vec3(d * VERTEX.x * len + n * VERTEX.y * w, 0.0);
	}
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	vec2 uv = UV - 0.5;
	vec3 col;
	float a;
	if (v_len < 0.5) {
		float d = length(uv) * 2.0;
		float pin = smoothstep(0.12, 0.0, d);
		float glow = exp(-d * d * 5.0) * 0.9;
		a = v_col.a * max(pin, glow);
		col = mix(v_col.rgb, vec3(2.6, 2.4, 2.1), pin * 0.6);
	} else {
		float t = UV.x;                         // 0 tail .. 1 head
		float across = abs(uv.y) * 8.5 * v_wpx; // pixels from the centre line
		float w = mix(1.2, 3.2, t) * v_wpx;
		a = v_col.a * (1.0 - smoothstep(w, w + 1.0, across)) * (0.35 + 0.65 * t);
		col = mix(v_col.rgb, vec3(3.0, 2.7, 2.0), t * t * t);
	}
	if (a < 0.02) discard;
	ALBEDO = col * a;
}
