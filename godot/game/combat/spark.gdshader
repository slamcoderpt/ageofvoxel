// Hit sparks (BattleFX.js sparks): HDR-bright additive streaks drawn over
// the figures, thin at the tail and fat and white-hot at the head, stretched
// along their screen velocity; a slow spark is a hot pinpoint with a small
// curved slash. Instance: origin = position, COLOR = rgb * brightness,
// alpha; INSTANCE_CUSTOM = (size, velocity xyz).
// Burst mode (INSTANCE_CUSTOM.x < 0, an impact where a blow lands):
// INSTANCE_CUSTOM = (-scale, age 0..1, ray seed, 0): a 20-30 px (at 1080p)
// star that pops open, a white-hot core in an orange-yellow glow with 5 rays.
shader_type spatial;
render_mode unshaded, fog_disabled, blend_premul_alpha, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec4 v_col;
varying float v_len;   // 0 = slow spark
varying float v_wpx;
varying float v_burst;  // > 0: impact burst, = age 0..1
varying float v_seed;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float wpp = -c.z / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y * 0.5);
	float size = INSTANCE_CUSTOM.x * 0.55;           // point sprite size, world units
	vec3 vel = (VIEW_MATRIX * vec4(INSTANCE_CUSTOM.yzw, 0.0)).xyz;
	vec2 sv = vel.xy;
	float sl = length(sv) * 0.06;
	v_col = COLOR;
	v_burst = 0.0;
	if (INSTANCE_CUSTOM.x < 0.0) {
		float t = INSTANCE_CUSTOM.y;
		v_burst = max(t, 1e-3);
		v_seed = INSTANCE_CUSTOM.z;
		// pops open over the first 15%, then holds and fades; at least
		// 22 px radius at 1080p however far the camera sits
		float pop = mix(0.55, 1.0, smoothstep(0.0, 0.15, t)) * (1.0 + 0.15 * t);
		float r = max(-INSTANCE_CUSTOM.x * 0.9, 22.0 * VIEWPORT_SIZE.y / 1080.0 * wpp) * pop;
		VERTEX = c + vec3(VERTEX.xy * r * 2.0, 0.05);
		NORMAL = vec3(0.0, 0.0, 1.0);
		v_len = 0.0;
		v_wpx = 1.0;
	} else {
	float ps_px = size / wpp;
	v_wpx = clamp(ps_px / 36.0, 1.0, 1.8);
	if (dot(INSTANCE_CUSTOM.yzw, INSTANCE_CUSTOM.yzw) < 0.04 || sl < 1e-4) {
		v_len = 0.0;
		// a hot pinpoint in a soft glow (the browser's bloom on the flash)
		float r = max(size * 0.9, 7.0 * wpp);
		VERTEX = c + vec3(VERTEX.x * r * 2.0, VERTEX.y * r * 2.0, 0.0);
	} else {
		float len = clamp(sl, 0.15 * size, 0.7 * size);
		vec2 d = normalize(sv);
		vec2 n = vec2(-d.y, d.x);
		float w = 8.5 * wpp * v_wpx;
		v_len = 1.0;
		VERTEX = c + vec3(d * VERTEX.x * len + n * VERTEX.y * w, 0.0);
	}
	}
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	vec2 uv = UV - 0.5;
	vec3 col;
	float a;
	if (v_burst > 0.0) {
		float t = v_burst;
		float d = length(uv) * 2.0;            // 0 centre .. 1 quad edge
		float ang = atan(uv.y, uv.x) + v_seed * 6.2832;
		// five uneven rays, thinning as they reach out
		float ray = pow(max(cos(ang * 5.0), 0.0), 12.0) * (0.7 + 0.3 * cos(ang * 3.0 + 1.7));
		float ray_len = mix(0.95, 0.7, t);
		float rays = ray * smoothstep(ray_len, 0.15, d) * (1.0 - t);
		float core_r = mix(0.3, 0.12, t);
		float core = smoothstep(core_r, core_r * 0.35, d);
		// the grade compresses bright warm light towards white, so the burst is
		// layered: an HDR white-hot core in a bright yellow glow, inside a
		// mid-bright orange halo that keeps its hue through the tone map
		float inner = exp(-d * d * mix(12.0, 20.0, t));
		float halo = exp(-d * d * mix(3.5, 6.0, t)) * (1.0 - smoothstep(0.75, 1.0, d));
		float fade = 1.0 - t * t;
		vec3 hot = vec3(3.0, 2.5, 1.6);
		vec3 yellow = vec3(2.0, 1.15, 0.35);
		vec3 orange = v_col.rgb;
		col = orange * halo + yellow * inner + yellow * 0.8 * rays + hot * core;
		a = clamp(max(max(core, inner), max(halo * 0.8, rays)), 0.0, 1.0) * v_col.a;
		if (a * fade < 0.01) discard;
		ALBEDO = col * fade * v_col.a;
		// the halo and core cover what is under them (so the orange is not
		// lost in pale dirt), the rays and the yellow glow add on top
		ALPHA = clamp(core * 0.9 + max(halo * 0.7, inner * 0.95), 0.0, 1.0) * fade * v_col.a;
	} else {
	if (v_len < 0.5) {
		float d = length(uv) * 2.0;
		// impact flash: a white-hot core fading through yellow to an orange
		// fringe (COLOR carries the warm glow tint, never a team colour)
		float pin = smoothstep(0.34, 0.04, d);
		float glow = exp(-d * d * 9.0);
		a = v_col.a * max(pin, glow);
		vec3 fringe = v_col.rgb * vec3(1.0, 0.8, 0.55);
		col = mix(fringe, v_col.rgb, smoothstep(0.9, 0.3, d));
		col = mix(col, vec3(3.2, 2.9, 2.4), pin);
	} else {
		float t = UV.x;                         // 0 tail .. 1 head
		float across = abs(uv.y) * 8.5 * v_wpx; // pixels from the centre line
		float w = mix(1.2, 3.2, t) * v_wpx;
		a = v_col.a * (1.0 - smoothstep(w, w + 1.0, across)) * (0.35 + 0.65 * t);
		col = mix(v_col.rgb, vec3(3.0, 2.7, 2.0), t * t * t);
	}
	if (a < 0.02) discard;
	ALBEDO = col * a;
	// premultiplied: streaks stay additive, a flash also covers what is under
	// it, so its warm core never mixes with blue armour into lavender
	ALPHA = v_len < 0.5 ? min(a * 1.2, 1.0) : 0.0;
	}
}
