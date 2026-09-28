// Ground shockwave round the funnel's foot (effects.js groundRingMat): a
// scoured band of dark soil, grass flattened in curved streaks swept round
// with the spin, dust rings rolling outward, a charred edge just outside the
// kill radius and torn glowing wisps of static on it. UV = (r / rb, angle).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float time = 0.0;
uniform float k = 0.0;
uniform float flash = 0.0;

void fragment() {
	float r = UV.x, vA = UV.y;
	float sw = vA - 1.4 * r;
	float st = vn2(vec2(sw * 38.0, r * 2.2)) * 0.65 + vn2(vec2(sw * 90.0, r * 5.0)) * 0.35;
	float grass = smoothstep(0.45, 0.8, st) * smoothstep(0.92, 1.08, r) * (1.0 - smoothstep(1.3, 1.7, r));
	float scour = exp(-pow((r - 1.02) / 0.07, 2.0));
	float dust = 0.0;
	for (int i = 0; i < 2; i++) {
		float ph = fract(time * 0.55 + float(i) * 0.5);
		float rr = 1.02 + ph * 0.65;
		float n = 0.6 + 0.4 * vn2(vec2(vA * 9.0 + float(i) * 3.0, time * 1.5));
		dust += exp(-pow((r - rr) / (0.05 + 0.1 * ph), 2.0)) * (1.0 - ph) * n;
	}
	vec3 cGrass = vec3(0.34, 0.36, 0.2), cSoil = vec3(0.09, 0.07, 0.06), cDust = vec3(0.3, 0.25, 0.3);
	vec3 col = cGrass;
	float cov = grass * 0.5;
	col = mix(col, cSoil, scour); cov = max(cov, scour * 0.6);
	col = mix(col, cDust + vec3(0.12, 0.05, 0.25) * (1.0 + flash), min(1.0, dust)); cov = max(cov, min(0.7, dust * 0.75));
	cov *= 1.0 - smoothstep(1.45, 1.75, r);
	cov *= smoothstep(0.84, 0.94, r);
	col *= 0.45 * (1.0 + 0.5 * flash);
	float scorch = smoothstep(1.125, 1.14, r) * (1.0 - smoothstep(1.17, 1.26, r)) * (0.75 + 0.25 * vn2(vec2(vA * 40.0, 1.0)));
	col = mix(col, vec3(0.02, 0.015, 0.02), scorch); cov = max(cov, scorch * 0.8);
	float tear = smoothstep(0.45, 0.8, vn2(vec2(vA * 16.0 - time * 3.0, time * 0.8)));
	float line = exp(-pow((r - 1.1 + 0.05 * vn2(vec2(vA * 30.0, time * 2.0))) / 0.05, 2.0)) * tear;
	col = mix(col, vec3(2.6, 1.7, 4.2), line); cov = max(cov, line * 0.9);
	ALBEDO = col;
	ALPHA = clamp(cov * k, 0.0, 1.0);
}
