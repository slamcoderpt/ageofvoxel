// Full-frame storm grade (effects.js stormGradeMat), drawn after the opaque
// world and before the additive effects. Each pixel's view ray is
// intersected with the ground plane under the storm (as in the browser), so
// the darkening, the drifting cloud shadows, the violet spill round the wall
// and the light pools under each bolt are placed in world space and relight
// the albedo of the grass, units and walls near the strike.
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float plane_y = 0.0;
uniform vec2 center = vec2(0.0);
uniform float radius = 10.0;
uniform float k = 0.0;
uniform float flash = 0.0;
uniform float time = 0.0;
uniform vec4 pools[6];
uniform vec3 pool_col = vec3(1.2, 0.98, 1.8);

void vertex() {
	POSITION = vec4(VERTEX.xy, 0.5, 1.0);
}

// returns the multiplier m, and the additive haze in add
vec3 grade(vec2 suv, mat4 inv_proj, mat4 inv_view, out vec3 add) {
	vec4 vp = inv_proj * vec4(suv * 2.0 - 1.0, 0.5, 1.0);
	vec3 d = mat3(inv_view) * (vp.xyz / vp.w);
	vec3 o = inv_view[3].xyz;
	vec2 g = d.y < -1e-4 ? o.xz + d.xz * ((plane_y - o.y) / d.y) : o.xz + normalize(d.xz + 1e-5) * 300.0;
	float r = length(g - center) / radius;
	float inside = 1.0 - smoothstep(0.85, 1.12, r);
	float near = 1.0 - smoothstep(1.0, 3.2, r);
	vec2 q = g * 0.06 + vec2(time * 0.12, time * 0.05);
	float n = vn2(q) * 0.6 + vn2(q * 2.7 + 7.1) * 0.4;
	float shade = smoothstep(0.3, 0.75, n);
	// (Godot: the storm floor a touch brighter than the browser's, the lit
	// stage the army reads against)
	vec3 inC = mix(vec3(1.0, 0.97, 1.0), vec3(0.9, 0.84, 1.0), smoothstep(0.6, 1.0, r)) * (0.94 + 0.08 * shade) * 1.08;
	vec3 midC = vec3(0.4, 0.4, 0.6) * (0.8 + 0.3 * shade);
	vec3 m = mix(vec3(0.42, 0.43, 0.5), midC, near);
	m = mix(m, inC, inside);
	m += vec3(0.04, 0.07, 0.16) * flash * (0.3 + 0.7 * inside);
	float reach = exp(-max(0.0, r - 0.9) * 0.75) * (1.0 - inside * 0.6);
	m += vec3(0.3, 0.3, 0.75) * min(1.2, flash) * reach * 0.3 + vec3(0.05, 0.04, 0.18) * reach * k * 0.6;
	float vg = length((suv * 2.0 - 1.0) * vec2(0.9, 1.0));
	m *= 1.0 - 0.5 * smoothstep(0.55, 1.45, vg);
	m = mix(vec3(1.0), m, k);
	float pool = 0.0;
	for (int i = 0; i < 6; i++) {
		vec4 P = pools[i];
		if (P.z <= 0.0) continue;
		float dd = length(g - P.xy) / P.w;
		pool += P.z * (exp(-dd * dd * 2.2) * 0.85 + exp(-dd * dd * 0.6) * 0.15);
	}
	float dr = (r - 1.0) * radius;
	float ang = atan(g.y - center.y, g.x - center.x);
	float rn = 0.6 + 0.4 * vn2(vec2(ang * 9.0 - time * 2.0, time * 0.7));
	float spill = (dr < 0.0 ? exp(dr / 0.7) : exp(-dr / 1.8) * 0.9) * rn * k;
	add = vec3(0.05, 0.09, 0.22) * pool * 0.4 + vec3(0.05, 0.02, 0.13) * spill * (dr < 0.0 ? 0.35 : 0.9);
	return m + pool_col * pool + vec3(0.32, 0.1, 1.05) * spill * (dr < 0.0 ? 0.6 : 1.1);
}
