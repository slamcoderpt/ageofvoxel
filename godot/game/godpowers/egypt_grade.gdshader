// The Egyptian powers' full-frame grade, multiplicative (dst * m), drawn after the opaque
// world like the storm grade (game/godpowers/egypt_fx.gd):
//   eclipse_k  Bast's Eclipse: the world sunk in a deep blue dusk, darker towards the frame's
//              edges, a faint rose band low on the frame where the corona's light spills
//   rain_k     Ra's Rain: a cool grey-green wash with cloud shadows drifting over the ground
//              (world space: each pixel's view ray meets the ground plane plane_y)
shader_type spatial;
render_mode unshaded, blend_mul, depth_draw_never, depth_test_disabled, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float eclipse_k = 0.0;
uniform float rain_k = 0.0;
uniform float plane_y = 0.0;
uniform float time = 0.0;

void vertex() {
	POSITION = vec4(VERTEX.xy, 0.5, 1.0);
}

void fragment() {
	vec2 suv = SCREEN_UV;
	float vg = length((suv * 2.0 - 1.0) * vec2(0.9, 1.0));
	vec3 m = vec3(1.0);
	if (rain_k > 0.0) {
		vec4 vp = INV_PROJECTION_MATRIX * vec4(suv * 2.0 - 1.0, 0.5, 1.0);
		vec3 d = mat3(INV_VIEW_MATRIX) * (vp.xyz / vp.w);
		vec3 o = INV_VIEW_MATRIX[3].xyz;
		vec2 g = d.y < -1e-4 ? o.xz + d.xz * ((plane_y - o.y) / d.y) : o.xz + normalize(d.xz + 1e-5) * 300.0;
		vec2 q = g * 0.035 + vec2(time * 0.05, time * 0.02);
		float n = vn2(q) * 0.6 + vn2(q * 2.3 + 3.7) * 0.4;
		float shade = smoothstep(0.35, 0.8, n);
		vec3 wet = vec3(0.74, 0.8, 0.82) * (1.0 - 0.18 * shade) * (1.0 - 0.22 * smoothstep(0.6, 1.4, vg));
		m *= mix(vec3(1.0), wet, rain_k);
	}
	if (eclipse_k > 0.0) {
		vec3 dusk = vec3(0.30, 0.34, 0.62) * (1.0 - 0.5 * smoothstep(0.45, 1.35, vg));
		float rose = exp(-pow((suv.y - 0.08) / 0.18, 2.0)) * 0.25;
		dusk += vec3(0.32, 0.08, 0.22) * rose;
		m *= mix(vec3(1.0), dusk, eclipse_k);
	}
	ALBEDO = m;
	ALPHA = 1.0;
}
