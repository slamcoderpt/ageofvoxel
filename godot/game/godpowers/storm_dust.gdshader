// Dust wall at the funnel's foot (effects.js dustMat): earth and grass torn up
// and whirled round, alpha-blended, lit violet from inside.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float time = 0.0;
uniform float k = 0.0;
uniform float flash = 0.0;
uniform float uH = 4.2;
varying vec3 v_n;

void vertex() { v_n = normalize(vec3(VERTEX.x, 0.0, VERTEX.z)); }

float fbm(vec2 p) { return vn2(p) * 0.5 + vn2(p * 2.1 + 5.2) * 0.3 + vn2(p * 4.3 + 1.7) * 0.2; }

void fragment() {
	float vH = UV.x, y = vH * uH, x = UV.y * 12.0;
	vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 v = normalize(INV_VIEW_MATRIX[3].xyz - wp);
	float facing = dot(v_n.xz, normalize(v.xz + 1e-5));
	float n = fbm(vec2(x * 0.7 + y * 1.4 - time * 3.0, y * 0.9 - time * 0.8));
	float n2 = fbm(vec2(x * 1.9 - time * 5.0 + y * 2.0, y * 2.2));
	float prof = smoothstep(0.0, 0.05, vH) * pow(max(0.0, 1.0 - vH), 1.2);
	float cov = smoothstep(0.25, 0.7, n) * prof * (0.6 + 0.4 * n2);
	cov *= mix(0.06, 1.0, pow(1.0 - abs(facing), 2.0));
	vec3 dust = vec3(0.2, 0.15, 0.17);
	vec3 lit = vec3(0.42, 0.22, 0.75) * (0.4 + 0.7 * (1.0 - smoothstep(0.0, 0.6, vH)));
	vec3 col = mix(dust, lit, 0.3 + 0.35 * n2) * (1.0 + 0.6 * flash);
	ALBEDO = col * 0.35;
	ALPHA = clamp(cov * 1.6 * k, 0.0, 0.9);
}
