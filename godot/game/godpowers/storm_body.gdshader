// The funnel's body (effects.js bodyMat): a semi-opaque shell of dark storm
// cloud, thin where seen face-on, dense on the silhouette, lit violet from
// inside near the foot and flashing with the strikes. Two instances: the far
// wall (front = false, drawn before the men inside) and the near wall.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float time = 0.0;
uniform float k = 0.0;
uniform float flash = 0.0;
uniform float uH = 11.0;
uniform bool front = false;
varying vec3 v_n;

void vertex() { v_n = normalize(vec3(VERTEX.x, 0.0, VERTEX.z)); }

float fbm(vec2 p) { return vn2(p) * 0.5 + vn2(p * 2.03 + 5.2) * 0.28 + vn2(p * 4.1 + 1.7) * 0.14 + vn2(p * 8.3 + 3.1) * 0.08; }

void fragment() {
	float h = UV.x, y = h * uH, x = UV.y * 7.0;
	vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 v = normalize(INV_VIEW_MATRIX[3].xyz - wp);
	float facing = dot(v_n.xz, normalize(v.xz + 1e-5));
	// near wall faces the camera, the far wall faces away
	if (front != (facing > 0.0)) discard;
	float fres = pow(1.0 - abs(facing), 1.3);
	float b = fbm(vec2(x * 0.42 + y * 0.55 - time * 1.5, y * 0.32 - time * 0.45));
	float st = fbm(vec2(x * 1.3 + y * 1.9 - time * 3.4, y * 0.5 - time * 1.2));
	float dens = (0.55 + 0.45 * smoothstep(0.2, 0.62, b)) * (0.8 + 0.2 * st);
	float prof = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.62, 1.0, h));
	float faceA = front ? 0.0 : 0.08;
	float edgeA = front ? 1.5 : 1.2;
	float cov = dens * prof * mix(faceA, edgeA, fres * fres);
	vec3 dark = mix(vec3(0.08, 0.06, 0.13), vec3(0.11, 0.09, 0.18), smoothstep(0.1, 0.8, h));
	float inner = (front ? 0.35 : 1.0) * exp(-y / 2.4);
	vec3 col = dark + vec3(0.22, 0.08, 0.46) * inner * (0.5 + 0.5 * b)
		+ vec3(0.13, 0.1, 0.22) * smoothstep(0.5, 0.85, b) * (0.5 + 0.5 * fres)
		+ vec3(0.18, 0.14, 0.36) * min(1.2, flash) * (0.35 + 0.65 * st) * (0.4 + 0.6 * fres);
	ALBEDO = col * 0.22;
	ALPHA = clamp(cov * k, 0.0, 0.95);
}
