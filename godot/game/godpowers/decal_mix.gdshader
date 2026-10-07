// Ground decals, alpha-blended (a flat quad laid on the ground; the instance
// basis carries yaw and size). INSTANCE_CUSTOM.x = kind:
//   0 scorch (effects.js makeScorchTexture, procedural): soot flung out in
//     rays, a charred core, blocky soot clods; COLOR.a = opacity,
//     custom.y = per-scorch variation.
//   1 strike flash disc (discMat): white-hot core, hard violet rim, charred
//     cracked collar; COLOR.a = uO, custom.y = uK (age 0..1).
//   (the Egyptian powers, godpower_view_egypt.cpp)
//   2 sand swirl: sand streaks spiralling into the centre (Shifting Sands, the
//     Tornado's foot, the Sphinx's whirlwind); custom.y = phase, custom.z = 0
//     golden sand / 1 a darker dust
//   3 sand drift: a soft heaped patch of sand with wind ripples (left on the
//     Tornado's track); custom.y = seed
//   4 gilt glyph ring (Prosperity): a band of hieroglyph-like voxel signs in
//     painted gold between two gold rims, outlined in dark bronze, gilt dust
//     and glittering flecks inside; custom.y = the band's inner radius
//     (fraction), custom.z = phase. Painted, not added: an additive gold on
//     bright sand only lightens the sand (and AgX turns it salmon)
//   5 meteor crater (Thoth's Meteor): a charred basalt bowl with radial ridges inside a raised
//     dark lip, soot rays flung out over the ground and the ground round it baked and cracked
//     into plates (dark crack lines); custom.y = seed, custom.z = age 0 fresh .. 1 old (the
//     soot greys); the glowing lava is decal_add kind 9 drawn over it
//   6 a serpent's emergence (Plague of Serpents): a dark pit, churned dark ochre sand round it,
//     jagged radial cracks (emerge_cracks, glowing: decal_add kind 11); custom.y = seed,
//     custom.z = grow 0..1
//   7 the serpents' vortex: spiral arms, a deep emerald heart paling to light green at the edge;
//     custom.y = phase
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

varying vec4 v_col;
// (flat: INSTANCE_CUSTOM is per instance; interpolated, it picks up 1-ulp jitter that the sin hashes
// below blow up into a per-pixel dither over everything seeded by custom.y)
varying flat vec4 v_c;

void vertex() {
	v_col = COLOR;
	v_c = INSTANCE_CUSTOM;
	// (Godot) pulled toward the camera along the view ray: the same pixels, but
	// the flat decal is no longer swallowed by voxel-step bumps in the ground
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	// (the Plague of Serpents' marks are pulled only a little: a serpent's coils and the sand
	// voxels heaped round them lie a few tenths over the ground and must stay in front)
	wp += normalize(CAMERA_POSITION_WORLD - wp) * ((INSTANCE_CUSTOM.x > 5.5 && INSTANCE_CUSTOM.x < 7.5) ? 0.1 : 0.6);
	POSITION = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(wp, 1.0));
}

float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// distance to the nearest cell edge of a jittered grid (F2 - F1 in a cheap form)
float plates(vec2 p, float seed) {
	vec2 i = floor(p), f = fract(p);
	float d1 = 8.0, d2 = 8.0;
	for (int y = -1; y <= 1; y++)
		for (int x = -1; x <= 1; x++) {
			vec2 g = vec2(float(x), float(y));
			vec2 o = 0.15 + 0.7 * h22(i + g + seed);
			float d = length(g + o - f);
			if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
		}
	return d2 - d1;
}
vec3 lin(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
float vn1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }

// the Plague of Serpents' emergence cracks (decal_mix kind 6 and decal_add kind 11 share it):
// jagged cracks running out from the hole a serpent burst from, one branch off each, and short
// splits between them; p in -1..1, grow 0..1 (the cracks race out in the first half second)
float emerge_cracks(vec2 p, float seed, float grow) {
	float d = length(p);
	float an = atan(p.y, p.x);
	float v = 0.0;
	for (int k = 0; k < 11; k++) {
		float fk = float(k);
		float a0 = fk / 11.0 * 6.2831853 + (h1(fk + seed) - 0.5) * 0.45;
		float len = (0.55 + 0.4 * h1(fk * 3.7 + seed)) * grow;
		float th = a0 + (vn1(d * 9.0 + fk * 5.0 + seed) - 0.5) * 0.55;
		float da = abs(mod(an - th + 3.14159265, 6.2831853) - 3.14159265) * d;
		float w = 0.075 * (1.0 - 0.7 * d / max(len, 0.01)) + 0.012;
		float line = (1.0 - smoothstep(w * 0.45, w, da)) * (1.0 - smoothstep(len * 0.85, len, d)) * step(0.1, d);
		float rb = len * (0.35 + 0.3 * h1(fk * 9.1 + seed));
		float thb = th + (h1(fk * 4.3 + seed) > 0.5 ? 0.55 : -0.55) * smoothstep(rb, rb + 0.08, d);
		float db = abs(mod(an - thb + 3.14159265, 6.2831853) - 3.14159265) * d;
		float lb = (1.0 - smoothstep(0.01, 0.022, db)) * step(rb, d) * (1.0 - smoothstep(rb + 0.12, rb + 0.22, d));
		v = max(v, max(line, lb * 0.85));
	}
	return v;
}

// premultiplied "over"
void over(inout vec3 P, inout float A, vec3 c, float a) {
	P = c * a + P * (1.0 - a);
	A = a + A * (1.0 - a);
}

void fragment() {
	vec2 q = UV - 0.5;           // -0.5..0.5 (the canvas centre is 0)
	float r = length(q);
	float ang = atan(q.y, q.x) + 3.14159265;
	if (v_c.x > 6.5) {
		// 7 the serpents' vortex (Plague of Serpents): spiral arms turning in to a deep emerald
		// heart, paling to a light green at the edge; custom.y = phase
		vec2 p = q * 2.0;
		float d = length(p);
		float an = atan(p.y, p.x);
		float ph = v_c.y;
		float arm = sin(4.0 * (an + 2.4 * log(max(d, 0.02))) + ph * 5.0);
		float arms = smoothstep(-0.35, 0.85, arm);
		float t = smoothstep(0.0, 0.95, d);
		vec3 core = lin(vec3(6.0, 52.0, 30.0)), mid = lin(vec3(28.0, 118.0, 58.0)), edge = lin(vec3(150.0, 214.0, 136.0));
		vec3 cc = t < 0.5 ? mix(core, mid, t * 2.0) : mix(mid, edge, t * 2.0 - 1.0);
		float grain = h2(floor(UV * 72.0) + 3.1);
		vec3 col = mix(cc * 0.55, cc * 1.18, arms) * (0.92 + 0.16 * grain);
		float a = mix(0.95, 0.16, pow(t, 0.8)) * mix(0.62, 1.0, arms);
		a *= smoothstep(0.0, 0.04, d + 0.04) * (1.0 - smoothstep(0.86, 1.0, d));
		ALBEDO = col;
		ALPHA = clamp(a * v_col.a, 0.0, 1.0);
	} else if (v_c.x > 5.5) {
		// 6 a serpent's emergence (Plague of Serpents): the dark hole it burst from, churned dark
		// ochre sand heaped round it, jagged cracks running out over the ground; custom.y = seed,
		// custom.z = grow 0..1 (the cracks race out)
		vec2 p = q * 2.0;
		float d = length(p);
		float seed = v_c.y * 41.0, grow = v_c.z;
		float an = atan(p.y, p.x);
		vec3 P = vec3(0.0);
		float A = 0.0;
		vec2 cell = floor(UV * 56.0);
		float hc = h2(cell + seed);
		// the churned ring of displaced sand (under the voxel heap) and a scuffed halo past it
		float wob = (vn1(an * 3.0 + seed) - 0.5) * 0.08;
		float churn = (1.0 - smoothstep(0.42 + wob, 0.62 + wob, d)) * smoothstep(0.08, 0.14, d);
		over(P, A, lin(mix(vec3(118.0, 82.0, 44.0), vec3(150.0, 108.0, 60.0), hc)), churn * (0.62 + 0.3 * hc));
		float scuff = (1.0 - smoothstep(0.5, 0.85, d)) * smoothstep(0.38, 0.52, d) * (0.6 + 0.4 * vn1(an * 7.0 + seed * 2.0));
		over(P, A, lin(vec3(150.0, 110.0, 64.0)), scuff * 0.4);
		// the cracks: solid near-black clefts with a dark ochre shoulder, darkest near the hole
		float cr = emerge_cracks(p, seed, grow);
		float crc = smoothstep(0.5, 0.9, cr);                       // the cleft itself (hard-edged)
		over(P, A, lin(vec3(92.0, 62.0, 32.0)), smoothstep(0.05, 0.5, cr) * 0.75);
		over(P, A, lin(mix(vec3(10.0, 7.0, 4.0), vec3(34.0, 23.0, 12.0), smoothstep(0.25, 0.9, d))), crc);
		// the pit: it fills everything inside the heap of sand (d < 0.27, the heap's inner slope
		// lies at 0.8 of 3.1), opaque, so neither the vortex under it nor the ground shows through.
		// A funnel: the bare dark ochre lip, sloping walls in shadow, the near-black throat. The quad
		// is yawed so +x points away from the camera: the far wall faces the eye and catches a
		// little light, the near wall is hidden under its own lip (darker, narrower)
		float edgeR = 0.27 + 0.022 * (vn1(an * 5.0 + seed) - 0.5) + 0.012 * (vn1(an * 17.0 + seed * 3.0) - 0.5);
		float far = 0.5 + 0.5 * cos(an);                            // 1 the far wall .. 0 the near one
		float pit = 1.0 - smoothstep(edgeR - 0.012, edgeR, d);
		const float throatR = 0.1;
		vec2 tc = p + vec2(0.04, 0.0);                              // the throat sits nearer the camera
		float u = clamp((length(tc) - throatR) / max(edgeR - throatR, 0.01), 0.0, 1.0); // 0 throat .. 1 lip
		float streak = vn1(an * 22.0 + seed * 1.7) * 0.6 + 0.4 * h2(floor(vec2(an * 9.0, d * 30.0)) + seed);
		vec3 wall = mix(vec3(16.0, 11.0, 6.0), mix(vec3(36.0, 24.0, 13.0), vec3(96.0, 66.0, 34.0), far * far), pow(u, 1.2));
		wall *= 0.82 + 0.3 * streak;
		vec3 pc = mix(vec3(4.0, 3.0, 2.0), wall, smoothstep(throatR * 0.5, throatR * 1.4, length(tc)));
		over(P, A, lin(pc), pit);
		// a broken rim of darker crumbs round the lip, and a lit crest on the far side
		float lip = exp(-pow((d - edgeR) / 0.022, 2.0));
		over(P, A, lin(mix(vec3(52.0, 34.0, 18.0), vec3(120.0, 86.0, 46.0), far * 0.8)), lip * (0.7 + 0.3 * h2(floor(vec2(an * 14.0, 0.0)) + seed)));
		ALBEDO = A > 0.0 ? P / A : vec3(0.0);
		ALPHA = clamp(A * v_col.a * (1.0 - smoothstep(0.92, 1.0, d)), 0.0, 1.0);
	} else if (v_c.x > 4.5) {
		vec2 p = q * 2.0;
		float d = length(p);
		float seed = v_c.y * 37.0, age = v_c.z;
		float an = atan(p.y, p.x);
		float wob = (h1(floor((an + 3.1416) * 4.0) + seed) - 0.5) * 0.05;
		float R = 0.42 + wob;                          // the bowl's edge
		vec3 P = vec3(0.0);
		float A = 0.0;
		// the baked ground: ash-grey, blotchy, thinning outward
		vec2 cell = floor(UV * 40.0);
		float hc = h2(cell + seed);
		float bake = (1.0 - smoothstep(0.5, 1.0, d)) * (0.55 + 0.2 * hc);
		over(P, A, lin(mix(vec3(58.0, 52.0, 46.0), vec3(84.0, 76.0, 66.0), hc)), bake);
		// soot rays flung out from the lip
		float n = 30.0;
		float fs = (an + 3.1416) / 6.2831853 * n;
		float ii = floor(fs), fr = fract(fs) - 0.5;
		float rl = R + 0.15 + 0.35 * h1(ii * 3.1 + seed);
		float rw = (0.18 + 0.25 * h1(ii * 7.3 + seed)) * (1.0 - smoothstep(R, rl, d));
		if (d > R && abs(fr) < rw) over(P, A, lin(vec3(22.0, 19.0, 17.0)), 0.55 * (1.0 - smoothstep(R, rl, d)));
		// the cracked plates: dark lines over the baked ground
		float pe = plates(p * 3.0, seed);
		float crack = (1.0 - smoothstep(0.05, 0.1, pe)) * (1.0 - smoothstep(0.7, 0.98, d)) * step(R + 0.03, d);
		over(P, A, lin(vec3(14.0, 11.0, 10.0)), 0.9 * crack);
		// the raised lip: a dark ring, lighter on its crest
		float lip = exp(-pow((d - R - 0.035) / 0.06, 2.0));
		over(P, A, lin(mix(vec3(40.0, 35.0, 31.0), vec3(92.0, 82.0, 72.0), 0.5 * h1(floor((an + 3.1416) * 18.0) + seed))), lip * 0.95);
		// the bowl: charred basalt with radial ridges, darkest at the heart
		if (d < R) {
			float ridge = 0.5 + 0.5 * sin(an * 14.0 + h1(floor(d * 9.0) + seed) * 2.0 + seed);
			vec3 bc = mix(vec3(10.0, 9.0, 9.0), vec3(34.0, 30.0, 28.0), ridge * smoothstep(0.05, R, d));
			over(P, A, lin(bc), 1.0);
		}
		P = mix(P, P * vec3(1.05, 1.05, 1.08) + 0.004, age); // the soot greys as it cools
		ALBEDO = A > 0.0 ? P / A : vec3(0.0);
		ALPHA = clamp(A * v_col.a * (1.0 - smoothstep(0.96, 1.0, d)), 0.0, 1.0);
	} else if (v_c.x > 1.5) {
		vec2 p = q * 2.0;
		float d = length(p);
		vec3 sandc = mix(lin(vec3(226.0, 196.0, 140.0)), lin(vec3(150.0, 122.0, 86.0)), v_c.z);
		vec3 deepc = mix(lin(vec3(196.0, 156.0, 96.0)), lin(vec3(104.0, 84.0, 60.0)), v_c.z);
		if (v_c.x < 2.5) {
			float an = atan(p.y, p.x);
			float sw = sin(5.0 * (an + 2.6 * log(max(d, 0.03))) + v_c.y * 6.0);
			float streak = smoothstep(-0.2, 0.9, sw);
			float grain = h2(floor(UV * 64.0) + floor(v_c.y * 7.0));
			float a = (0.35 + 0.55 * streak) * (1.0 - smoothstep(0.55, 1.0, d)) * (0.85 + 0.15 * grain);
			ALBEDO = mix(deepc, sandc, streak * 0.8 + 0.2 * grain);
			ALPHA = clamp(a * v_col.a, 0.0, 1.0);
		} else if (v_c.x > 3.5) {
			float r0 = v_c.y, ph = v_c.z;
			float an = atan(p.y, p.x) + 3.14159265 + ph * 0.35;
			float b = (d - r0) / (1.0 - r0);               // 0 inner rim .. 1 outer rim
			// (unshaded, so the grade's exposure x2.1 lands on it whole: kept below the tone curve's
			// knee, where it stays saturated, instead of a bright gold the curve bleaches to cream)
			vec3 goldc = vec3(0.38, 0.165, 0.0), lightc = vec3(0.4, 0.215, 0.004), bronze = vec3(0.03, 0.012, 0.0);
			vec3 P = vec3(0.0);
			float A = 0.0;
			// gilt dust inside the ring, blotchy, thinning outward
			vec2 cell = floor(UV * 48.0);
			float hc = h2(cell + 3.7);
			float dust = (1.0 - smoothstep(r0 * 0.4, r0 * 0.98, d)) * (0.18 + 0.22 * hc);
			over(P, A, mix(goldc, lightc, hc), dust);
			if (d < r0 * 0.95 && hc > 0.93) over(P, A, lightc, 0.9 * (0.6 + 0.4 * sin(ph * 30.0 + hc * 40.0)));
			// the band: bronze outline rims, gold rims over them, signs between
			float rimw = 0.07;
			float outl = max(exp(-pow(b / (rimw * 1.9), 2.0)), exp(-pow((b - 1.0) / (rimw * 1.9), 2.0)));
			float rims = max(exp(-pow(b / rimw, 2.0)), exp(-pow((b - 1.0) / rimw, 2.0)));
			float n = 40.0;
			float cl = floor(an / 6.2831853 * n);
			float fa = fract(an / 6.2831853 * n);
			vec2 g = vec2(floor(fa * 4.0), floor((b - 0.18) / 0.64 * 3.0));
			float sg = 0.0, sgo = 0.0;
			if (b > 0.1 && b < 0.9 && fa < 0.86) sgo = 1.0;
			if (fa < 0.78 && b > 0.18 && b < 0.82) sg = step(0.45, h1(cl * 7.0 + g.x * 3.0 + g.y * 11.0 + 0.5));
			float band = step(-0.12, b) * step(b, 1.12);
			over(P, A, bronze, band * max(outl, sgo * 0.7) * 0.92);
			float flick = 0.8 + 0.2 * sin(ph * 6.0 + cl * 1.7);
			over(P, A, mix(goldc, lightc, 0.35 * flick), band * max(rims, sg) * 0.97);
			ALBEDO = A > 0.0 ? P / A : vec3(0.0);
			ALPHA = clamp(A * v_col.a * (1.0 - smoothstep(0.98, 1.0, d)), 0.0, 1.0);
		} else {
			float seed = v_c.y * 53.0;
			float blob = 1.0 - smoothstep(0.35 + 0.25 * h1(floor(atan(p.y, p.x) * 3.0) + seed), 1.0, d);
			float rip = 0.5 + 0.5 * sin((p.x * 0.8 + p.y * 0.6) * 26.0 + h1(seed) * 6.0);
			ALBEDO = mix(deepc, sandc, 0.55 + 0.35 * rip);
			ALPHA = clamp(blob * 0.85 * v_col.a, 0.0, 1.0);
		}
	} else if (v_c.x < 0.5) {
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
