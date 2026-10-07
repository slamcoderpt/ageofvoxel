// Ground decals, additive (HDR light laid on the ground). INSTANCE_CUSTOM.x:
//   0 ember cracks (makeEmberTexture, procedural): branching glowing cracks
//     round a hot centre, tinted COLOR.rgb * COLOR.a;
//   1 strike ground flash (groundFlashMat): COLOR.a = uO;
//   2 shock ring (bandRingGeometry 0.75..1 + shockMat): COLOR.rgb * COLOR.a,
//     custom.y = inner radius fraction;
//   3 meteor warning ring (ringMat dash): custom.y inner fraction, custom.z time.
//   4 (Godot) impact ring: a crisp hot band at the quad's edge with a soft
//     glow inside it, broken up by crackle; COLOR.rgb * COLOR.a,
//     custom.y = band width (fraction of the radius), custom.z = seed.
//   (the Egyptian powers, godpower_view_egypt.cpp)
//   5 glyph ring: a band of hieroglyph-like voxel signs between two bright
//     rims; custom.y = the band's inner radius (fraction), custom.z = phase
//     (the signs turn and flicker with it)
//   6 swirl: soft spiral arms turning in to the centre; custom.y = where the
//     arms fade in (fraction of the radius), custom.z = phase
//   7 the Eye of Horus (wedjat): almond eye, pupil, brow, the cheek drop and
//     the curled tail, with a soft glow round its strokes
//   8 a soft pool of light: COLOR.rgb * COLOR.a, a smooth falloff to the edge
//     (no hard-coded hue, unlike 1)
//   9 lava (Thoth's Meteor's craters): a molten heart, jagged cracks running out from it over
//     the bowl and up the lip, the plate cracks round the crater glowing near it; custom.y =
//     heat 0..1 (white-yellow heart and orange cracks when fresh, a dull red when cool),
//     custom.z = seed (the same seed as its decal_mix kind 5)
//   10 the Eclipse's mark (round 19): one hard-edged disc, a faint fill (custom.y) inside a
//     crisp bright rim with a hot white core, a thin inner ring, a soft halo just outside;
//     COLOR.rgb * COLOR.a, custom.z = phase (a slow shimmer along the rim)
//   11 a serpent's emergence cracks glowing (emerge_cracks, as decal_mix kind 6) and the
//     hole's heart; custom.y = seed, custom.z = grow
// custom.w < -0.5: emissive, the colour kept by the grade (a negative blue: see
//   flame.gdshader and game/lighting/grade_effect.gd)
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform float time = 0.0;
varying vec4 v_col;
varying vec4 v_c;

void vertex() {
	v_col = COLOR;
	v_c = INSTANCE_CUSTOM;
	// (Godot) pulled toward the camera along the view ray: the same pixels, but
	// the flat decal is no longer swallowed by voxel-step bumps in the ground
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	// (the Plague of Serpents' marks are pulled only a little: a serpent's coils and the sand
	// voxels heaped round them lie a few tenths over the ground and must stay in front)
	wp += normalize(CAMERA_POSITION_WORLD - wp) * ((INSTANCE_CUSTOM.x > 10.5 && INSTANCE_CUSTOM.x < 11.5) ? 0.1 : 0.8);
	POSITION = PROJECTION_MATRIX * (VIEW_MATRIX * vec4(wp, 1.0));
}

float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float vn1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float plates(vec2 p, float seed) { // as decal_mix.gdshader
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
// the lava's colour by temperature T (0 dull red .. 1 white-yellow), linear, before the grade's x2.1
vec3 lava(float T) {
	vec3 c = mix(vec3(0.12, 0.006, 0.0), vec3(0.3, 0.03, 0.0), smoothstep(0.0, 0.35, T));
	c = mix(c, vec3(0.5, 0.1, 0.0), smoothstep(0.35, 0.7, T));
	return mix(c, vec3(1.0, 0.5, 0.0), smoothstep(0.7, 1.0, T));
}

float cracks(vec2 q, float seed) {
	float r = length(q);                  // 0..0.5
	float ang = atan(q.y, q.x);
	float v = 0.9 * pow(max(0.0, 1.0 - r / 0.1), 1.5);
	for (int k = 0; k < 6; k++) {
		float fk = float(k);
		float a0 = fk / 6.0 * 6.2831853 + (h1(fk + seed) - 0.5) * 0.6;
		float len = 0.14 + 0.12 * h1(fk * 3.7 + seed);
		float th = a0 + (vn1(r * 28.0 + fk * 5.0 + seed) - 0.5) * 1.1 * clamp(r * 8.0, 0.0, 1.0);
		float da = abs(mod(ang - th + 3.14159265, 6.2831853) - 3.14159265) * r;
		float w = 0.04 * (1.0 - 0.7 * r / len);
		float line = (1.0 - smoothstep(w * 0.5, w, da)) * step(r, len);
		v = max(v, line);
		// one branch off each crack
		float rb = len * (0.35 + 0.3 * h1(fk * 9.1 + seed));
		float ab = th + (h1(fk * 4.3 + seed) > 0.5 ? 0.7 : -0.7);
		float rr = r - rb;
		if (rr > 0.0 && rr < len * 0.5) {
			float thb = ab + (vn1(r * 30.0 + fk * 11.0) - 0.5) * 0.8;
			float db = abs(mod(ang - thb + 3.14159265, 6.2831853) - 3.14159265) * r;
			v = max(v, 1.0 - smoothstep(0.008, 0.016, db));
		}
	}
	return v;
}

void fragment() {
	vec2 q = UV - 0.5;
	vec2 p = q * 2.0;
	float d = length(p);
	int kind = int(v_c.x + 0.5);
	vec3 c = vec3(0.0);
	if (kind == 0) {
		c = v_col.rgb * cracks(q, v_c.y * 31.0) * v_col.a;
	} else if (kind == 1) {
		float an = atan(p.y, p.x);
		float rays = 0.65 + 0.35 * pow(abs(sin(an * 5.0 + 1.3) * sin(an * 3.0 + 0.4)), 0.5);
		c = vec3(1.2, 1.15, 1.25) * exp(-pow(d * 4.0, 2.5)) * 1.6 + vec3(0.55, 0.12, 1.5) * exp(-d * d * 9.0) * 0.4 * rays;
		c *= (1.0 - smoothstep(0.8, 1.0, d)) * v_col.a;
	} else if (kind == 2) {
		float r0 = v_c.y;
		float b = (d - (r0 + 1.0) * 0.5) / ((1.0 - r0) * 0.5);
		if (abs(b) <= 1.0) c = v_col.rgb * exp(-pow(b - 0.4, 2.0) * 22.0) * v_col.a;
	} else if (kind == 4) {
		float wb = v_c.y, seed = v_c.z * 71.0;
		float an = atan(p.y, p.x) + 3.14159265;
		float wob = (vn1(an * 9.0 + seed) - 0.5) * wb * 0.6;
		float b = (d - (0.9 - wb * 0.5) - wob) / (wb * 0.5);
		float crackle = 0.55 + 0.45 * vn1(an * 23.0 + seed * 3.0);
		float band = exp(-b * b * 2.2) * crackle;
		float edge = exp(-pow(b - 0.2, 2.0) * 14.0) * (0.7 + 0.3 * crackle);
		float inner = exp(-max(0.0, (0.9 - d)) * 9.0) * 0.06 * step(d, 0.9);
		c = v_col.rgb * (band * 0.8 + edge * 0.9 + inner) * v_col.a;
		c += vec3(1.0) * edge * 0.35 * v_col.a * dot(v_col.rgb, vec3(0.2));
		c *= 1.0 - smoothstep(0.97, 1.0, d);
	} else if (kind == 5) {
		float r0 = v_c.y, ph = v_c.z;
		float an = atan(p.y, p.x) + 3.14159265 + ph * 0.35;
		float b = (d - r0) / (1.0 - r0);               // 0 inner rim .. 1 outer rim
		float rims = exp(-pow(b / 0.06, 2.0)) + exp(-pow((b - 1.0) / 0.06, 2.0));
		float n = 40.0;
		float cell = floor(an / 6.2831853 * n);
		float fa = fract(an / 6.2831853 * n);
		// a 3 x 3 voxel sign per cell (a hash picks its bits), a gap between cells
		vec2 g = vec2(floor(fa * 4.0), floor((b - 0.18) / 0.64 * 3.0));
		float sign_ = 0.0;
		if (fa < 0.78 && b > 0.18 && b < 0.82) {
			float bit = h1(cell * 7.0 + g.x * 3.0 + g.y * 11.0 + 0.5);
			sign_ = step(0.45, bit);
		}
		float flick = 0.75 + 0.25 * sin(ph * 6.0 + cell * 1.7);
		float glow = exp(-pow((b - 0.5) / 0.7, 2.0)) * 0.12;
		c = v_col.rgb * (rims * 0.9 + sign_ * flick * 0.85 + glow) * v_col.a;
		c *= step(r0 - 0.08, d) * (1.0 - smoothstep(0.98, 1.0, d));
	} else if (kind == 6) {
		float r0 = v_c.y, ph = v_c.z;
		float an = atan(p.y, p.x);
		float arm = sin(4.0 * (an + 2.2 * log(max(d, 0.02))) + ph * 5.0);
		float arms = pow(max(0.0, arm), 3.0);
		float fadein = smoothstep(r0 - 0.12, r0, d) * smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.88, 1.0, d));
		float grit = 0.6 + 0.4 * vn1(an * 12.0 + d * 30.0 - ph * 3.0);
		c = v_col.rgb * arms * fadein * grit * v_col.a;
	} else if (kind == 7) {
		vec2 e = p * vec2(1.0, -1.0) * 1.15;          // y up on the decal
		float s = 0.0;
		// almond eye outline
		vec2 q2 = (e - vec2(0.0, 0.08)) / vec2(0.55, 0.22);
		float ell = abs(length(q2) - 1.0) * 0.22;
		s = max(s, 1.0 - smoothstep(0.02, 0.045, ell));
		// pupil
		s = max(s, 1.0 - smoothstep(0.13, 0.16, length(e - vec2(0.02, 0.08))));
		// brow
		float bx = clamp(e.x, -0.62, 0.62);
		float by = 0.42 - 0.12 * bx * bx;
		s = max(s, (1.0 - smoothstep(0.035, 0.06, abs(e.y - by))) * step(abs(e.x), 0.62));
		// the line from the outer corner back
		s = max(s, (1.0 - smoothstep(0.03, 0.05, abs(e.y - 0.08))) * step(0.55, e.x) * step(e.x, 0.95));
		// the cheek drop below the eye
		s = max(s, (1.0 - smoothstep(0.03, 0.05, abs(e.x + 0.02))) * step(-0.62, e.y) * step(e.y, -0.12));
		// the curled tail: an arc from under the eye to a spiral end
		vec2 tc = e - vec2(0.36, -0.42);
		float tr = abs(length(tc) - 0.26);
		float ta = atan(tc.y, tc.x);
		s = max(s, (1.0 - smoothstep(0.025, 0.05, tr)) * step(-2.6, ta) * step(ta, 1.6));
		s = max(s, 1.0 - smoothstep(0.05, 0.08, length(e - vec2(0.36 + 0.26 * cos(-2.6), -0.42 + 0.26 * sin(-2.6)))));
		float halo = exp(-d * d * 3.0) * 0.12;
		c = v_col.rgb * (s * 1.1 + halo) * v_col.a;
	} else if (kind == 9) {
		float heat = v_c.y, seed = v_c.z * 37.0;
		float an = atan(p.y, p.x);
		float wob = (h1(floor((an + 3.1416) * 4.0) + seed) - 0.5) * 0.05;
		float R = 0.42 + wob;
		float fl = 0.85 + 0.15 * vn1(time * 2.3 + seed) * vn1(an * 3.0 + time * 0.7);
		// the molten heart
		float heart = exp(-pow(d / (0.07 + 0.06 * heat), 2.0));
		float T = heart * (0.55 + 0.45 * heat);
		float g = heart * (0.6 + 0.6 * heat);
		// jagged cracks from the heart over the bowl and up the lip
		float cr = 0.0;
		for (int k = 0; k < 9; k++) {
			float fk = float(k);
			float a0 = fk / 9.0 * 6.2831853 + (h1(fk + seed) - 0.5) * 0.5;
			float len = R * (0.75 + 0.45 * h1(fk * 3.7 + seed));
			float th = a0 + (vn1(d * 14.0 + fk * 5.0 + seed) - 0.5) * 0.7;
			float da = abs(mod(an - th + 3.14159265, 6.2831853) - 3.14159265) * d;
			float w = 0.03 * (1.0 - 0.6 * d / len) + 0.006;
			float line = (1.0 - smoothstep(w * 0.4, w, da)) * (1.0 - smoothstep(len * 0.8, len, d));
			// a branch off each
			float rb = len * (0.4 + 0.25 * h1(fk * 9.1 + seed));
			float thb = th + (h1(fk * 4.3 + seed) > 0.5 ? 0.6 : -0.6) * smoothstep(rb, rb + 0.1, d);
			float db = abs(mod(an - thb + 3.14159265, 6.2831853) - 3.14159265) * d;
			float lb = (1.0 - smoothstep(0.007, 0.016, db)) * step(rb, d) * (1.0 - smoothstep(rb + 0.08, rb + 0.16, d));
			cr = max(cr, max(line, lb * 0.8));
		}
		float crT = cr * (1.0 - 0.75 * smoothstep(0.0, R * 1.1, d)) * (0.35 + 0.65 * heat);
		T = max(T, crT);
		g = max(g, cr * (0.5 + 0.5 * heat) * (1.0 - 0.5 * smoothstep(0.0, R, d)));
		// the plate cracks near the crater still glowing while it is hot
		float pe = plates(p * 3.0, seed);
		float pc = (1.0 - smoothstep(0.03, 0.065, pe)) * step(R + 0.03, d) * (1.0 - smoothstep(R + 0.05, R + 0.05 + 0.3 * heat, d));
		g = max(g, pc * 0.45 * heat);
		T = max(T, pc * 0.25 * heat);
		// a soft warm haze over the bowl
		float haze = exp(-pow(d / R, 2.0) * 2.0) * 0.12 * (0.4 + 0.6 * heat);
		c = (lava(T) * g * fl + lava(0.3) * haze) * v_col.a;
		c *= 1.0 - smoothstep(0.9, 1.0, d);
	} else if (kind == 10) {
		float fill = v_c.y, ph = v_c.z;
		float aa = max(fwidth(d) * 1.5, 0.004);
		float inside = 1.0 - smoothstep(0.95 - aa, 0.95, d);
		float rim = smoothstep(0.87 - aa, 0.87, d) * inside;
		float core = smoothstep(0.905 - aa, 0.905, d) * (1.0 - smoothstep(0.925, 0.925 + aa, d));
		float inner = 1.0 - smoothstep(0.006, 0.006 + aa, abs(d - 0.72));
		float halo = exp(-pow((d - 0.95) / 0.035, 2.0)) * step(0.95, d);
		float an = atan(p.y, p.x);
		float shim = 0.85 + 0.15 * sin(an * 9.0 + ph * 2.0);
		c = v_col.rgb * (fill * inside + rim * 1.5 * shim + inner * 0.55 + halo * 0.45) * v_col.a;
		c += vec3(1.0) * core * 0.35 * v_col.a;
		c *= 1.0 - smoothstep(0.99, 1.0, d);
	} else if (kind == 11) {
		// a serpent's emergence cracks glowing (the same cracks as decal_mix kind 6)
		float cr = emerge_cracks(p, v_c.y * 41.0, v_c.z);
		float hole = exp(-pow(d / 0.16, 2.0));
		c = v_col.rgb * (cr * (1.0 - smoothstep(0.08, 0.8, d)) + hole * 0.8) * v_col.a;   // (the outer cracks stay dark)
		c *= 1.0 - smoothstep(0.9, 1.0, d);
	} else if (kind == 8) {
		c = v_col.rgb * v_col.a * (exp(-d * d * 3.5) - 0.03) * (1.0 - smoothstep(0.85, 1.0, d));
		c = max(c, vec3(0.0));
	} else {
		float r0 = v_c.y, t = v_c.z;
		float b = (d - (r0 + 1.0) * 0.5) / ((1.0 - r0) * 0.5);
		if (abs(b) <= 1.0) {
			float ang = atan(p.y, p.x) + 3.14159;
			float ft = floor(t * 24.0);
			float seg = floor(ang * 20.0 + t * 6.0);
			float crackle = 0.55 + 0.45 * h1(seg + ft);
			float edge = exp(-b * b * 18.0) * crackle;
			float dash = step(0.5, fract(ang * 7.6394 - t * 0.4)) * exp(-pow(b + 0.7, 2.0) * 30.0) * 0.6;
			c = v_col.rgb * (edge * 0.7 + exp(-b * b * 3.0) * 0.18 + dash) * v_col.a;
		}
	}
	if (v_c.w < -0.5) c.b = -8.0 * max(c.r, c.g);
	ALBEDO = c;
	ALPHA = 1.0;
}
