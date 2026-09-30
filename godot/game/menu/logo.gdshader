// Main-menu logo: text drawn in pure white is shaded as engraved gold (a
// bright top, a dark band below the middle, a warm bottom lip, like Retold's
// cast logo) with a slow light sweep; other colours (the dark outline and
// shadow) pass through unchanged. All positions are the control's local px.
shader_type canvas_item;

uniform float y0 = 0.0;      // top of the capitals
uniform float y1 = 60.0;     // baseline
uniform float shine_x = -1000.0;

varying vec2 lp;

void vertex() {
	lp = VERTEX;
}

vec3 metal(float t) {
	vec3 a = vec3(1.0, 0.957, 0.812);   // #fff4cf
	vec3 b = vec3(0.910, 0.761, 0.431); // #e8c26e
	vec3 c = vec3(0.560, 0.392, 0.157); // #8f6428
	vec3 d = vec3(0.851, 0.678, 0.353); // #d9ad5a
	vec3 e = vec3(0.969, 0.882, 0.627); // #f7e1a0
	if (t < 0.42) return mix(a, b, t / 0.42);
	if (t < 0.56) return mix(b, c, (t - 0.42) / 0.14);
	if (t < 0.8) return mix(c, d, (t - 0.56) / 0.24);
	return mix(d, e, (t - 0.8) / 0.2);
}

void fragment() {
	vec4 c = texture(TEXTURE, UV) * COLOR;
	if (COLOR.r > 0.99 && COLOR.g > 0.99 && COLOR.b > 0.99) {
		float t = clamp((lp.y - y0) / max(1.0, y1 - y0), 0.0, 1.0);
		vec3 g = metal(t);
		float s = (lp.x + (lp.y - y0) * 0.45) - shine_x;
		g += vec3(1.0, 0.94, 0.78) * exp(-s * s / 500.0) * 0.55;
		c.rgb = g;
	}
	COLOR = c;
}
