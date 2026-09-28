// Animated water, port of src/terrain/Water.js: layered wave normals,
// depth-tinted colour (turquoise shallows -> teal -> deep blue), shoreline
// foam bands, caustics, fresnel sky reflection and a sun glint. Depth comes
// from a texture baked from the smoothed seabed (AovSim.get_water_depth()).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_back, shadows_disabled;

uniform float u_time = 0.0;
uniform float world_size = 128.0;
uniform sampler2D depth_tex : filter_linear, repeat_disable;
uniform vec3 sun_dir = vec3(-0.6, 0.47, 0.4);
uniform vec3 shallow_col : source_color = vec3(0.373, 0.847, 0.761); // 0x5fd8c2
uniform vec3 mid_col : source_color = vec3(0.122, 0.604, 0.651);     // 0x1f9aa6
uniform vec3 deep_col : source_color = vec3(0.059, 0.302, 0.439);    // 0x0f4d70
uniform vec3 sky_col : source_color = vec3(0.749, 0.878, 1.0);       // 0xbfe0ff
// The browser's water ShaderMaterial skips tone mapping; Godot tone maps every
// pass, so the colour is pre-boosted to land near the browser's on screen.
uniform float out_gain = 1.0;
uniform float out_sat = 1.0;

varying vec3 v_world;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.15; }
vec2 wave(vec2 p, vec2 d, float f, float s, float t) { float ph = dot(p, d) * f + t * s; return d * cos(ph) * f; }
float caustic(vec2 p, float t) {
	vec2 q = p + vec2(vnoise(p * 0.7 + t * 0.3), vnoise(p * 0.7 - t * 0.27 + 5.0)) * 1.6;
	float a = abs(sin(q.x * 2.3 + t * 0.9) + sin(q.y * 2.1 - t * 0.7) + sin((q.x + q.y) * 1.6 + t * 0.5));
	return pow(clamp(1.0 - a * 0.5, 0.0, 1.0), 3.0);
}

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float dy = sin(wp.x * 0.35 + u_time * 1.3) * 0.03 + cos(wp.z * 0.42 + u_time * 1.1) * 0.03;
	VERTEX.y += dy;
	v_world = wp + vec3(0.0, dy, 0.0);
}

void fragment() {
	float uTime = u_time;
	vec2 p = v_world.xz;
	vec2 uv = p / world_size;
	float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
	float depth = mix(3.0, texture(depth_tex, uv).r * 255.0 / 40.0, inside);
	vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.9, 1.4, uTime) * 0.05
			+ wave(p, normalize(vec2(-0.4, 1.0)), 1.7, 2.0, uTime) * 0.035
			+ wave(p, normalize(vec2(0.7, -0.8)), 3.1, 2.9, uTime) * 0.02;
	vec2 np = p * 1.3 + vec2(uTime * 0.25, uTime * 0.18);
	float e = 0.08;
	float n0 = fbm(np), nx = fbm(np + vec2(e, 0.0)), nz = fbm(np + vec2(0.0, e));
	vec2 np2 = p * 3.1 - vec2(uTime * 0.31, -uTime * 0.22);
	float m0 = vnoise(np2), mx = vnoise(np2 + vec2(e, 0.0)), mz = vnoise(np2 + vec2(0.0, e));
	g += vec2(nx - n0, nz - n0) / e * 0.09 + vec2(mx - m0, mz - m0) / e * 0.035;
	float calm = mix(0.45, 1.0, smoothstep(0.0, 1.5, depth));
	vec3 n = normalize(vec3(-g.x * calm, 1.0, -g.y * calm));
	vec3 v = normalize(CAMERA_POSITION_WORLD - v_world);
	float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
	float d1 = smoothstep(0.0, 0.9, depth), d2 = smoothstep(0.7, 3.2, depth);
	vec3 base = mix(mix(shallow_col, mid_col, d1), deep_col, d2);
	float big = fbm(p * 0.06 + uTime * 0.01);
	base *= 0.9 + big * 0.22;
	vec3 c = mix(base, sky_col, fres * 0.55 + 0.05);
	float cau = caustic(p * 1.1, uTime) * (1.0 - smoothstep(0.1, 1.4, depth)) * smoothstep(0.02, 0.15, depth);
	c += vec3(0.75, 0.95, 0.9) * cau * 0.35;
	vec3 h = normalize(normalize(sun_dir) + v);
	float spec = pow(max(dot(n, h), 0.0), 180.0) * 2.2;
	float sheen = pow(max(dot(n, h), 0.0), 18.0) * 0.12;
	c += vec3(1.0, 0.95, 0.82) * (spec + sheen);
	float fn = fbm(p * 2.2 + vec2(uTime * 0.2, -uTime * 0.15));
	float bands = sin(depth * 16.0 + uTime * 2.2 + fn * 4.0) * 0.5 + 0.5;
	float band_mask = 1.0 - smoothstep(0.08, 0.55, depth);
	float foam = smoothstep(0.72, 0.95, bands) * band_mask * smoothstep(0.35, 0.6, fn + 0.15);
	float edge = 1.0 - smoothstep(0.0, 0.1 + fn * 0.08, depth);
	foam = max(foam, edge * smoothstep(0.25, 0.55, fn + 0.1));
	float swell = sin(dot(p, normalize(vec2(1.0, 0.3))) * 0.9 + uTime * 1.4 + big * 3.0);
	c *= 1.0 + swell * 0.035 * smoothstep(0.8, 2.5, depth);
	foam = clamp(foam, 0.0, 1.0);
	c = mix(c, vec3(0.95, 0.98, 1.0), foam * 0.85);
	float alpha = mix(0.3, 0.94, smoothstep(0.0, 1.6, depth));
	alpha = max(alpha, foam * 0.92);
	float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = max(mix(vec3(lum), c, out_sat), vec3(0.0)) * out_gain;
	ALBEDO = c;
	ALPHA = alpha;
}
