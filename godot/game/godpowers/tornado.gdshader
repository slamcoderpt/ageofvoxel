// Horus' Tornado: the sand funnel (egypt_fx.gd builds a ring mesh, UV = (height 0..1, angle)).
// Sandy dust spiralling up (streaks scrolled round and up by time), denser at its silhouette
// and its foot, a darker core layer inside, swaying with height; blended over the world.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float time = 0.0;
uniform float k = 0.0;
uniform float H = 16.0;
uniform float sway = 1.0;
uniform bool core = false;
uniform vec3 sand = vec3(0.52, 0.40, 0.26);
uniform vec3 dark = vec3(0.24, 0.18, 0.12);

varying float v_h;
varying float v_a;
varying vec3 v_n;
varying vec3 v_w;

void vertex() {
	v_h = UV.x;
	v_a = UV.y;
	float h = UV.x * H;
	// billows: the wall bulges and pinches as the dust boils round
	float bil = vn2(vec2(UV.y * 1.6 - time * 2.4 + h * 0.3, h * 0.45 - time * 0.8));
	VERTEX.xz *= 0.88 + 0.26 * bil;
	// the column sways and snakes with height
	VERTEX.x += sin(time * 0.9 + h * 0.18) * h * 0.06 * sway;
	VERTEX.z += cos(time * 0.7 + h * 0.15) * h * 0.05 * sway;
	v_n = normalize(vec3(VERTEX.x, 0.0, VERTEX.z) + 1e-5);
	v_w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 V = normalize(CAMERA_POSITION_WORLD - v_w);
	vec3 Vh = normalize(vec3(V.x, 0.0, V.z) + 1e-5);
	float side = 1.0 - abs(dot(v_n, Vh));
	float a = v_a / 6.2831853;
	float spin = time * (core ? 0.9 : 0.55);
	float s1 = vn2(vec2(a * 18.0 - spin * 18.0 + v_h * 9.0, v_h * 6.0 - time * 1.4));
	float s2 = vn2(vec2(a * 41.0 - spin * 30.0 + v_h * 20.0, v_h * 14.0 - time * 2.6));
	float streak = smoothstep(0.35, 0.85, s1 * 0.65 + s2 * 0.45);
	float dens = (core ? 0.7 : 0.38) + (core ? 0.35 : 0.6) * streak;
	dens *= mix(0.55, 1.0, side);
	dens *= smoothstep(0.0, 0.05, v_h) * (1.0 - smoothstep(0.82, 1.0, v_h));
	dens *= 1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.25, v_h)); // the dense foot
	vec3 c = mix(dark, sand, 0.25 + 0.6 * streak + 0.25 * v_h) * (0.85 + 0.3 * side);
	if (core) c *= 0.7;
	ALBEDO = c;
	ALPHA = clamp(dens * k, 0.0, 0.95);
}
