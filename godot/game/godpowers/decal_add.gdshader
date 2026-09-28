// Ground decals, additive (HDR light laid on the ground). INSTANCE_CUSTOM.x:
//   0 ember cracks (makeEmberTexture, procedural): branching glowing cracks
//     round a hot centre, tinted COLOR.rgb * COLOR.a;
//   1 strike ground flash (groundFlashMat): COLOR.a = uO;
//   2 shock ring (bandRingGeometry 0.75..1 + shockMat): COLOR.rgb * COLOR.a,
//     custom.y = inner radius fraction;
//   3 meteor warning ring (ringMat dash): custom.y inner fraction, custom.z time.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform float time = 0.0;
varying vec4 v_col;
varying vec4 v_c;

void vertex() {
	v_col = COLOR;
	v_c = INSTANCE_CUSTOM;
}

float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float vn1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }

float cracks(vec2 q, float seed) {
	float r = length(q);                  // 0..0.5
	float ang = atan(q.y, q.x);
	float v = 0.9 * max(0.0, 1.0 - r / 0.2) * 0.8;
	for (int k = 0; k < 6; k++) {
		float fk = float(k);
		float a0 = fk / 6.0 * 6.2831853 + (h1(fk + seed) - 0.5) * 0.6;
		float len = 0.14 + 0.12 * h1(fk * 3.7 + seed);
		float th = a0 + (vn1(r * 28.0 + fk * 5.0 + seed) - 0.5) * 1.1 * clamp(r * 8.0, 0.0, 1.0);
		float da = abs(mod(ang - th + 3.14159265, 6.2831853) - 3.14159265) * r;
		float w = 0.024 * (1.0 - 0.6 * r / len);
		float line = (1.0 - smoothstep(w * 0.5, w, da)) * step(r, len);
		v = max(v, line);
		// one branch off each crack
		float rb = len * (0.35 + 0.3 * h1(fk * 9.1 + seed));
		float ab = th + (h1(fk * 4.3 + seed) > 0.5 ? 0.7 : -0.7);
		float rr = r - rb;
		if (rr > 0.0 && rr < len * 0.5) {
			float thb = ab + (vn1(r * 30.0 + fk * 11.0) - 0.5) * 0.8;
			float db = abs(mod(ang - thb + 3.14159265, 6.2831853) - 3.14159265) * r;
			v = max(v, 1.0 - smoothstep(0.004, 0.009, db));
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
	ALBEDO = c;
	ALPHA = 1.0;
}
