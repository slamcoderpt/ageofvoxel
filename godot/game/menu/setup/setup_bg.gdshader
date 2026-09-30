// Menu backdrop (after the Retold lobby): a near-black slate with a faint
// teal cast, a soft vertical light falloff, a fine stone grain, faint
// horizontal sheen bands and a sparse star dust in the title band.
shader_type canvas_item;

uniform vec2 size = vec2(1920.0, 1080.0);   // CSS px of the rect

float hash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void fragment() {
	vec2 p = UV * size;
	vec3 top = vec3(0.075, 0.085, 0.090);
	vec3 bot = vec3(0.035, 0.042, 0.046);
	vec3 col = mix(top, bot, smoothstep(0.0, 1.0, UV.y));
	// large soft clouds of lighter slate
	float n = vnoise(p / 260.0) * 0.6 + vnoise(p / 90.0) * 0.3 + vnoise(p / 23.0) * 0.1;
	col *= 0.86 + 0.28 * n;
	// fine grain
	col *= 0.96 + 0.08 * hash(floor(p));
	// a faint teal cast toward the centre
	float r = length((UV - vec2(0.45, 0.4)) * vec2(1.4, 1.0));
	col += vec3(0.0, 0.018, 0.022) * (1.0 - smoothstep(0.0, 0.9, r));
	// vignette
	vec2 e = UV - 0.5;
	col *= 1.0 - 0.45 * dot(e, e);
	// star dust in the title band
	vec2 cell = floor(p / 7.0);
	float s = hash(cell);
	if (s > 0.993 && p.y < 110.0) {
		vec2 c = (cell + 0.5) * 7.0;
		float d = length(p - c);
		col += vec3(0.55, 0.58, 0.6) * (1.0 - smoothstep(0.0, 1.3, d)) * (1.0 - p.y / 110.0) * fract(s * 97.0);
	}
	COLOR = vec4(col, 1.0);
}
