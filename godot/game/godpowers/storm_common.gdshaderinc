// Shared noise for the storm shaders (effects.js GLSL helpers).
float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float vn1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float hs2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn2(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hs2(i), hs2(i + vec2(1.0, 0.0)), f.x), mix(hs2(i + vec2(0.0, 1.0)), hs2(i + vec2(1.0, 1.0)), f.x), f.y);
}
