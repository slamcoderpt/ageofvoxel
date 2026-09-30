// The main menu's evening sky (menu scene only; game/menu/menu.gd puts it on
// the lighting piece's Sky): a deep blue zenith going warm and gold towards
// the horizon, the setting sun's broad glow behind the town, and soft
// streaks of cloud lit from below. Seen above the hazy far edge of the map.
shader_type sky;
render_mode use_debanding;

uniform vec3 top_color : source_color = vec3(0.16, 0.30, 0.58);
uniform vec3 mid_color : source_color = vec3(0.86, 0.56, 0.42);
uniform vec3 horizon_color : source_color = vec3(0.98, 0.84, 0.64);
uniform vec3 sun_color : source_color = vec3(1.0, 0.80, 0.52);
uniform vec3 cloud_color : source_color = vec3(1.0, 0.78, 0.58);
uniform vec3 sun_dir = vec3(-0.9, 0.1, -0.3);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
	float v = 0.0, a = 0.5;
	for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
	return v;
}

void sky() {
	vec3 d = normalize(EYEDIR);
	vec3 sd = normalize(sun_dir);
	float h = max(d.y, 0.0);
	vec3 c = mix(horizon_color, mid_color, smoothstep(0.0, 0.05, h));
	c = mix(c, top_color, smoothstep(0.03, 0.2, h));
	float s = max(dot(d, sd), 0.0);
	// the sun's glow: a wide warm bloom, a brighter core and the disc
	c += sun_color * (pow(s, 5.0) * 0.45 + pow(s, 60.0) * 0.8 + smoothstep(0.9994, 0.9997, s) * 1.6);
	// streaks of cloud in a band above the horizon, brighter towards the sun
	vec2 uv = d.xz / max(d.y + 0.12, 0.05);
	float cl = fbm(uv * vec2(0.55, 1.6) + vec2(3.0, 7.0));
	cl = smoothstep(0.52, 0.8, cl) * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.25, 0.5, h));
	vec3 cc = mix(cloud_color * 0.85, sun_color * 1.25, pow(s, 6.0));
	c = mix(c, cc, cl * 0.55);
	if (d.y < 0.0) c = horizon_color;
	COLOR = c;
}
