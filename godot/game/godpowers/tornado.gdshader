// Horus' Tornado: the sand funnel (egypt_fx.gd builds the ring meshes, UV = (height 0..1, angle)).
// A value structure, not a haze: a dense, dark brown-grey body (mode 1, the side facing the
// camera; mode 0 its inner wall, seen down the open top) wrapped by a few broad spiral bands
// of lighter and darker dust that climb round it as it spins, thinning only at its silhouette
// to bright, back-lit edges; mode 2 is a thin sheath of wisps that shows only near that
// silhouette (never a veil over what stands behind it), mode 3 the dense dust skirt rolling
// out round its foot with a crisp, lumpy outer edge. Unshaded and blended over the world;
// colours are kept dark because the grade (grade_effect.gd) multiplies by its exposure 2.1.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;
#include "res://game/godpowers/storm_common.gdshaderinc"

uniform float time = 0.0;
uniform float k = 0.0;
uniform float H = 16.0;
uniform float sway = 1.0;
uniform int mode = 1;            // 0 inner wall, 1 body, 2 wisps, 3 skirt
uniform vec3 core_col = vec3(0.115, 0.076, 0.040);  // the shaded body: brown-grey
uniform vec3 band_col = vec3(0.250, 0.170, 0.092);  // the lit dust bands
uniform vec3 rim_col = vec3(0.580, 0.440, 0.260);   // back-lit edges
uniform vec3 deep_col = vec3(0.050, 0.034, 0.020);  // the dark spiral lanes
uniform vec3 sun_dir = vec3(-0.62, 0.62, -0.48);

varying float v_h;
varying float v_a;
varying vec3 v_n;
varying vec3 v_w;

// the column's sway at height h (shared by every layer so they stay together)
vec2 sway_at(float h) {
	return vec2(sin(time * 0.9 + h * 0.18) * h * 0.06, cos(time * 0.7 + h * 0.15) * h * 0.05) * sway;
}

void vertex() {
	v_h = UV.x;
	v_a = UV.y;
	float h = mode == 3 ? 0.0 : UV.x * H;
	if (mode == 3) {
		// the skirt: lumps roll round and outward; its outer edge (UV.x = 1) bulges and pinches
		float lump = vn2(vec2(UV.y * 2.2 - time * 1.9, UV.x * 2.0 - time * 0.6));
		VERTEX.xz *= 1.0 + (0.08 + 0.22 * UV.x) * (lump - 0.5);
		VERTEX.y *= 0.8 + 0.4 * lump;
	} else {
		// billows: the wall bulges and pinches as the dust boils round (broad, not stringy)
		float bil = vn2(vec2(UV.y * 1.3 - time * 2.4 + h * 0.25, h * 0.35 - time * 0.8));
		VERTEX.xz *= (mode == 2 ? 0.94 : 0.92) + 0.16 * bil;
	}
	VERTEX.xz += sway_at(h);
	v_n = normalize(vec3(VERTEX.x - sway_at(h).x, 0.0, VERTEX.z - sway_at(h).y) + 1e-5);
	v_w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	// (the ring meshes wind clockwise seen from outside: their outer side is the back face)
	bool outer = !FRONT_FACING;
	if ((mode == 0 && outer) || (mode != 0 && mode != 3 && !outer)) discard;
	vec3 V = normalize(CAMERA_POSITION_WORLD - v_w);
	vec3 Vh = normalize(vec3(V.x, 0.0, V.z) + 1e-5);
	float side = 1.0 - abs(dot(v_n, Vh));          // 0 facing the camera .. 1 at the silhouette
	float sun = clamp(dot(v_n, normalize(vec3(sun_dir.x, 0.0, sun_dir.z))) * 0.5 + 0.5, 0.0, 1.0);
	float h = v_h * H;
	float a = v_a;
	float spin = time * 4.6;
	// broad dust texture (no fine streaks: those read as a smeared texture)
	float n1 = vn2(vec2(a * 1.9 - spin * 0.3 + h * 0.2, h * 0.28 - time * 0.5));
	float n2 = vn2(vec2(a * 4.8 - spin * 0.75 + h * 0.5, h * 0.7 - time * 1.1));
	vec3 c;
	float al;
	if (mode == 3) {
		// the skirt: dense rolling dust, lit on top, a lumpy, defined outer rim
		float u = v_h;
		float swirl = 0.5 + 0.5 * sin(a * 3.0 + u * 7.0 - time * 3.4 + n1 * 2.0);
		float lane = smoothstep(0.35, 0.75, swirl);
		c = mix(core_col * 1.3, band_col * 1.25, lane * 0.7 + 0.3 * n2);
		c = mix(c, deep_col * 1.4, (1.0 - u) * 0.5);
		c = mix(c, rim_col * 0.9, smoothstep(0.7, 0.92, u) * 0.55);       // its sunlit outer roll           // shaded where it hugs the foot
		c *= 0.8 + 0.45 * sun;
		float edge = 1.0 - smoothstep(0.82 + 0.1 * n1, 0.97 + 0.03 * n1, u);
		al = (1.0 - 0.15 * u) * edge;
		al *= outer ? 1.0 : 0.6;
	} else {
		// the spiral: four broad bands climb round the funnel as it spins, a finer set between
		float ph = a * 4.0 - h * 0.95 - spin + n1 * 1.2;
		float band = 0.5 + 0.5 * sin(ph);
		float fine = 0.5 + 0.5 * sin(a * 11.0 - h * 2.1 - spin * 1.6 + n2 * 2.0);
		float lit_band = smoothstep(0.6, 0.9, band);
		float lane = 1.0 - smoothstep(0.08, 0.32, band);
		// value: a dark body, lit bands with dark lanes between, the sun's side brighter,
		// bright back-lit edges
		c = mix(core_col, band_col, lit_band * (0.75 + 0.25 * n2));
		c = mix(c, deep_col, lane * 0.9);
		c *= 0.78 + 0.4 * fine * (0.6 + 0.4 * n2);
		c *= 0.55 + 0.85 * sun;
		float rim = smoothstep(0.5, 0.96, side);
		c = mix(c, rim_col * (0.8 + 0.25 * n2) * (0.85 + 0.25 * lit_band), rim * 0.9);
		c *= 0.92 + 0.18 * v_h;                                  // a touch lighter aloft
		if (mode == 0) c = mix(deep_col, core_col, 0.4 + 0.4 * n1);
		// opacity: near opaque body, thinning only right at the silhouette
		if (mode == 2) {
			// wisps: only near the silhouette, in broken tufts (no veil over the world)
			float tuft = smoothstep(0.45, 0.8, n2 * 0.6 + n1 * 0.5);
			al = smoothstep(0.6, 0.95, side) * tuft * 0.55;
			c = rim_col * (0.8 + 0.3 * n1);
		} else {
			// (fully opaque inside: a dark colour at 85 % still lets the bright sand through)
			al = mix(1.0, 0.5, smoothstep(0.86, 1.0, side));
			if (mode == 0) al = 1.0;
		}
		// the top opens into a ragged rim; the foot sinks into the skirt
		float top = 1.0 - smoothstep(0.93 + 0.05 * n1, 1.0, v_h);
		al *= top * smoothstep(0.0, 0.04, v_h);
	}
	ALBEDO = c;
	ALPHA = clamp(al * min(k * 1.3, 1.0), 0.0, 1.0);
}
