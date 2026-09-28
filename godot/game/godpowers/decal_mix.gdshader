// Ground decals, alpha-blended (a flat quad laid on the ground; the instance
// basis carries yaw and size). INSTANCE_CUSTOM.x = kind:
//   0 scorch (effects.js makeScorchTexture, procedural): soot flung out in
//     rays, a charred core, blocky soot clods; COLOR.a = opacity,
//     custom.y = per-scorch variation.
//   1 strike flash disc (discMat): white-hot core, hard violet rim, charred
//     cracked collar; COLOR.a = uO, custom.y = uK (age 0..1).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

varying vec4 v_col;
varying vec4 v_c;

void vertex() {
	v_col = COLOR;
	v_c = INSTANCE_CUSTOM;
	// (Godot) pulled toward the camera along the view ray: the same pixels, but
	// the flat decal is no longer swallowed by voxel-step bumps in the ground
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wp += normalize(CAMERA_POSITION_WORLD - wp) * 0.6;
	POSITION = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(wp, 1.0));
}

float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 lin(vec3 c) { return pow(c / 255.0, vec3(2.2)); }

// premultiplied "over"
void over(inout vec3 P, inout float A, vec3 c, float a) {
	P = c * a + P * (1.0 - a);
	A = a + A * (1.0 - a);
}

void fragment() {
	vec2 q = UV - 0.5;           // -0.5..0.5 (the canvas centre is 0)
	float r = length(q);
	float ang = atan(q.y, q.x) + 3.14159265;
	if (v_c.x < 0.5) {
		float seed = v_c.y * 97.0;
		vec3 P = vec3(0.0);
		float A = 0.0;
		// blast streaks: 46 rays of soot, wedge-shaped from r0 out to r1
		float n = 46.0;
		float fs = ang / 6.2831853 * n;
		for (int k = -1; k <= 1; k++) {
			float i = floor(fs) + float(k);
			float ii = mod(i, n);
			float ai = (i + 0.5 + (h1(ii + seed) - 0.5) * 0.9) / n * 6.2831853;
			float r0 = 0.12, r1 = 0.3 + 0.19 * h1(ii * 3.1 + seed);
			float w = 0.03 + 0.06 * h1(ii * 7.3 + seed);
			float f = clamp((r - r0) / (r1 - r0), 0.0, 1.0);
			float da = abs(ang - ai);
			float wid = w * (1.0 - f);
			if (r > r0 && r < r1 && da < wid) over(P, A, lin(mix(vec3(12.0, 10.0, 9.0), vec3(20.0, 16.0, 12.0), f)), 0.45 * (1.0 - f));
		}
		// charred core: radial gradient
		float t = clamp(r / 0.5, 0.0, 1.0);
		vec4 g;
		if (t < 0.28) g = mix(vec4(4.0, 3.0, 3.0, 1.0), vec4(8.0, 7.0, 6.0, 0.97), t / 0.28);
		else if (t < 0.5) g = mix(vec4(8.0, 7.0, 6.0, 0.97), vec4(18.0, 14.0, 11.0, 0.7), (t - 0.28) / 0.22);
		else if (t < 0.78) g = mix(vec4(18.0, 14.0, 11.0, 0.7), vec4(26.0, 20.0, 15.0, 0.22), (t - 0.5) / 0.28);
		else g = mix(vec4(26.0, 20.0, 15.0, 0.22), vec4(34.0, 27.0, 20.0, 0.0), (t - 0.78) / 0.22);
		over(P, A, lin(g.rgb), g.a);
		// (Godot) a blotchy charcoal-grey ash edge round the char (neutral grey,
		// unlike the maroon-brown debris), under the hot cracks
		if (v_c.z < 0.5) {
			vec2 ac = floor(UV * 30.0);
			float an = h2(ac + seed * 1.3);
			float ring = smoothstep(0.14, 0.2, r) * (1.0 - smoothstep(0.27, 0.36, r + 0.05 * (h1(floor(ang * 7.0) + seed) - 0.5)));
			float ash = ring * step(0.35, an) * (0.45 + 0.3 * an);
			over(P, A, lin(mix(vec3(40.0, 40.0, 42.0), vec3(62.0, 61.0, 62.0), an)), ash);
			// a thin charred line between the ash and the hot core
			float cl = exp(-pow((r - 0.155) / 0.02, 2.0));
			over(P, A, lin(vec3(6.0, 4.0, 4.0)), cl * 0.9);
		}
		// blocky soot clods (voxel-scale squares)
		vec2 cell = floor(UV * 42.0);
		float hc = h2(cell + seed);
		float cr = length((cell + 0.5) / 42.0 - 0.5);
		if (cr > 0.18 && cr < 0.46 && hc < 0.09) over(P, A, lin(vec3(10.0, 8.0, 7.0)), 0.3 + 0.5 * h2(cell * 1.7 + seed));
		ALBEDO = A > 0.0 ? P / A : vec3(0.0);
		ALPHA = A * v_col.a;
	} else {
		vec2 p = q * 2.0;
		float d = length(p);
		float uK = v_c.y;
		float rr = 0.13 + 0.12 * uK;
		float an = atan(p.y, p.x);
		float crack = 0.75 + 0.25 * sin(an * 13.0 + 2.0 * sin(an * 5.0));
		float core = 1.0 - smoothstep(rr - 0.05, rr, d);
		float rim = exp(-pow((d - rr) / 0.03, 2.0));
		float coll = smoothstep(rr, rr + 0.02, d) * (1.0 - smoothstep(rr + 0.22 * crack, rr + 0.42 * crack, d));
		vec3 hot = mix(vec3(4.0, 3.8, 4.2), vec3(1.8, 0.7, 3.2), smoothstep(0.0, rr, d) * 0.6 + 0.3 * uK);
		vec3 c = hot * core;
		c = mix(c, vec3(0.03, 0.02, 0.05), coll * (1.0 - core));
		c = mix(c, vec3(2.4, 1.2, 4.4), rim);
		float rim2 = exp(-pow((d - rr - 0.36 * crack) / 0.018, 2.0)) * (1.0 - uK);
		c = mix(c, vec3(1.8, 0.8, 3.6), rim2);
		float a = max(core, max(max(rim, rim2), coll * 0.9)) * v_col.a;
		ALBEDO = c;
		ALPHA = clamp(a, 0.0, 1.0);
	}
}
