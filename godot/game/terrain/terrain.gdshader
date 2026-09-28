// Terrain chunk material: linear vertex colours from the C++ mesher (palette,
// AO, wall shade baked) plus the ground breakup the browser layers on the
// terrain material (src/lighting/MaterialPatches.js patchGround / atmPale):
// pale neutral stone pulled toward warm sandstone, and upward-facing paving
// turned into worn irregular cobbles with dark joints and soft wear patches.
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform float roughness_value = 0.93;
uniform float pave = 1.0;          // uPave
uniform float pave_alb = 0.5;      // uPaveAlb
uniform float pave_scale = 4.2;    // uPaveScale, cobbles per world unit
uniform float pave_joint = 0.3;    // uPaveJoint
uniform float pale = 0.8;          // uPale
uniform vec3 sand = vec3(1.0, 0.85, 0.61);  // uSand
uniform float sand_amt = 0.9;      // uSandAmt

varying vec3 v_world;
varying vec3 v_wnormal;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float vn(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
// irregular cobbles: x = stone id hash, y = distance to the nearest joint
vec2 cobble(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	float d1 = 8.0, d2 = 8.0;
	vec2 id = vec2(0.0);
	for (int y = -1; y <= 1; y++)
		for (int x = -1; x <= 1; x++) {
			vec2 g = vec2(float(x), float(y));
			vec2 o = g + 0.15 + 0.7 * h22(i + g) - f;
			float d = dot(o, o);
			if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
		}
	return vec2(h2(id * 1.37 + 3.1), sqrt(d2) - sqrt(d1));
}
vec3 pale_stone(vec3 a) {
	float mx = max(a.r, max(a.g, a.b)), mn = min(a.r, min(a.g, a.b));
	float sat = (mx - mn) / max(mx, 1e-3);
	float p = smoothstep(0.42, 0.75, mx) * (1.0 - smoothstep(0.12, 0.3, sat));
	float warmable = p * step(a.b, max(a.r, a.g) + 0.01);
	float l = dot(a, vec3(0.2126, 0.7152, 0.0722));
	vec3 s = l * sand / dot(sand, vec3(0.2126, 0.7152, 0.0722));
	a = mix(a, s, warmable * sand_amt);
	return a * mix(vec3(1.0), pale * vec3(1.02, 1.0, 0.96), p);
}

void vertex() {
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnormal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 a0 = COLOR.rgb;
	vec3 a = a0;
	float mx = max(a0.r, max(a0.g, a0.b)), mn = min(a0.r, min(a0.g, a0.b));
	float sat = (mx - mn) / max(mx, 1e-3);
	// terrain paving is a pale warm grey (linear sat ~0.3-0.4); beach sand
	// (~0.6) and dirt are more saturated, grass is green-dominant
	float pm = smoothstep(0.36, 0.48, mx) * (1.0 - smoothstep(0.44, 0.52, sat)) * step(a0.g, a0.r + 0.01)
			* smoothstep(0.6, 0.9, normalize(v_wnormal).y) * pave;
	a = pale_stone(a);
	if (pm > 0.0) {
		vec2 wp = v_world.xz;
		vec2 cb = cobble(wp * vec2(1.0, 1.2) * pave_scale);
		float fw = max(fwidth(cb.y), 1e-3);
		float joint = 1.0 - smoothstep(0.05 - fw * 0.5, 0.16 + fw, cb.y);
		float bevel = smoothstep(0.0, 0.42, cb.y);
		float stone = 0.84 + 0.26 * cb.x;
		float mott = vn(wp * 0.35) * 0.6 + vn(wp * 1.1 + 7.3) * 0.4;
		vec3 dirt = mix(vec3(0.84, 0.8, 0.74), vec3(1.05, 1.02, 0.97), mott);
		vec3 tint = mix(vec3(1.03, 0.99, 0.92), vec3(0.95, 0.97, 1.02), h2(vec2(cb.x, 5.1)));
		vec3 pav = a * pave_alb * dirt * mix(vec3(1.0), tint * stone * (0.9 + 0.1 * bevel), 0.85);
		pav *= 1.0 - pave_joint * joint;
		a = mix(a, pav, pm);
	}
	ALBEDO = a;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
}
