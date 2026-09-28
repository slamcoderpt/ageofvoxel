// The storm wall (effects.js wallMat): a volumetric sheet of energy standing
// on the funnel, brightest at its foot, torn by turbulent streaks spiralling
// up it, glowing on the silhouette, surging where the latest bolt fell.
// UV = (height fraction, angle).
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float time = 0.0;
uniform float k = 0.0;
uniform float flash = 0.0;
uniform float hot_a = 0.0;
uniform float hot_w = 0.0;
uniform float uH = 11.0;
varying vec3 v_n;

void vertex() { v_n = normalize(vec3(VERTEX.x, 0.0, VERTEX.z)); }

float fbm(vec2 p) { return vn2(p) * 0.55 + vn2(p * 2.13 + 5.2) * 0.3 + vn2(p * 4.7 + 1.7) * 0.15; }
float hotAt(float a) {
	float da = abs(mod(a - hot_a + 3.14159265, 6.2831853) - 3.14159265);
	return hot_w * (exp(-da * da * 6.0) + 0.3 * exp(-da * da * 0.9));
}

void fragment() {
	float h = UV.x, vA = UV.y, y = h * uH, x = vA * 17.5;
	vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 v = normalize(INV_VIEW_MATRIX[3].xyz - wp);
	vec2 vh = normalize(v.xz + 1e-5);
	float facing = dot(v_n.xz, vh);
	float ndv = abs(facing);
	float fres = pow(1.0 - ndv, 1.4);
	float body = fres * fres;
	float front = mix(1.0, 0.22, smoothstep(-0.1, 0.75, facing));
	float t1 = fbm(vec2(x * 0.5 + y * 1.1 - time * 3.2, y * 0.35 - time * 1.1));
	float t2 = fbm(vec2(x * 0.8 + y * 1.6 - time * 4.4 + 9.0, y * 0.6 - time * 1.7));
	float s1 = smoothstep(0.5, 0.8, t1), s2 = smoothstep(0.56, 0.85, t2);
	float fil = pow(max(0.0, 1.0 - abs(t1 - 0.62) / 0.05), 3.0) * step(abs(t1 - 0.62), 0.05);
	float hot = hotAt(vA);
	float gfl = 0.85 + 0.15 * h1(floor(time * 20.0) * 1.7) + 0.35 * flash;
	float foot = exp(-y / 0.28) * smoothstep(0.0, 0.04, y) * (0.6 + 0.4 * fres);
	float top = 1.0 - smoothstep(0.45 + 0.3 * t2, 1.0, h);
	float sheet = smoothstep(0.0, 0.12, h) * pow(max(0.0, 1.0 - h), 0.9) * top;
	vec3 cFoot = mix(vec3(0.7, 0.25, 1.8), vec3(1.2, 0.95, 1.95), fres);
	vec3 cLow = vec3(0.55, 0.3, 1.5), cHigh = vec3(0.3, 0.08, 0.85);
	vec3 cBody = mix(cLow, cHigh, smoothstep(0.1, 0.9, h));
	float wisp = smoothstep(0.55, 0.75, t1) * (1.0 - smoothstep(0.75, 0.95, t1));
	float edgeOnly = smoothstep(0.35, 0.85, fres);
	vec3 col = cFoot * foot * (0.4 + 0.9 * smoothstep(0.4, 0.7, t2)) * (0.6 + 0.8 * fres) * (0.8 + 1.2 * hot)
		+ cBody * sheet * body * (0.9 * s1 + 0.6 * s2) * (0.85 + 1.0 * hot)
		+ vec3(1.4, 1.1, 2.6) * wisp * sheet * edgeOnly * 1.1
		+ vec3(1.2, 1.0, 2.2) * fil * sheet * fres * 1.6;
	ALBEDO = col * front * gfl * k;
	ALPHA = 1.0;
}
