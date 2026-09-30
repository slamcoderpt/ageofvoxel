// The feature card's sky (hero_art.gd): a crimson storm (storm = 1) or a gold
// dusk (storm = 0); cloud banks lit from beneath, the bolt's glow in them.
shader_type sky;

uniform float storm = 1.0;
uniform float flash = 1.0;
uniform float gain = 0.35;
uniform vec3 bolt_dir = vec3(0.4, 0.45, -0.8);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
	float s = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
	return s;
}

void sky() {
	vec3 d = EYEDIR;
	float h = d.y;
	// storm: hot orange at the horizon, crimson, then bruised violet overhead
	vec3 s_hor = vec3(0.9, 0.22, 0.05), s_mid = vec3(0.22, 0.025, 0.05), s_top = vec3(0.02, 0.008, 0.04);
	// dusk: gold, rose, deep blue
	vec3 d_hor = vec3(2.2, 1.2, 0.45), d_mid = vec3(0.9, 0.38, 0.3), d_top = vec3(0.12, 0.12, 0.3);
	vec3 hor = mix(d_hor, s_hor, storm), mid = mix(d_mid, s_mid, storm), top = mix(d_top, s_top, storm);
	vec3 col = mix(hor, mid, smoothstep(0.0, 0.1, h));
	col = mix(col, top, smoothstep(0.08, 0.34, h));
	// cloud banks: dark bodies, lit edges
	vec2 uv = d.xz / (max(h, 0.02) + 0.18) * 1.6;
	float c = fbm(uv + vec2(0.0, 3.0));
	float c2 = fbm(uv * 2.3 - vec2(4.0, 1.0));
	float body = smoothstep(0.38, 0.62, c) * smoothstep(-0.02, 0.1, h);
	vec3 cloud = mix(vec3(0.1, 0.04, 0.06), vec3(0.07, 0.02, 0.05), storm) * (0.5 + 1.0 * c2);
	vec3 edge = mix(vec3(1.6, 0.8, 0.35), vec3(1.4, 0.35, 0.18), storm) * smoothstep(0.55, 0.42, c) * smoothstep(0.36, 0.46, c);
	col = mix(col, cloud, body * mix(0.6, 0.92, storm)) + edge * (1.0 - smoothstep(0.1, 0.5, h)) * 0.8;
	// the bolt lights the clouds round it
	float g = max(dot(d, normalize(bolt_dir)), 0.0);
	col += vec3(0.55, 0.65, 1.0) * (pow(g, 60.0) * 0.8 + pow(g, 12.0) * 0.1) * storm * flash * (0.5 + body);
	// below the horizon: the haze of the plain
	col = mix(col, hor * 0.5, smoothstep(0.0, -0.08, h));
	COLOR = col * gain;
}
