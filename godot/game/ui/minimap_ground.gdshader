// Minimap ground (Minimap.js groundTile + drawBase, plus the fog-of-war mask).
// Each tile's colour is computed here from the sim's columns, exactly like
// groundTile: water (deep / shallow) or the ground type's colour, times a
// brightness from the height and a relief shade from the NW neighbour. The
// resource layer (res_tex, the sprite's texture too; alpha = resource present) paints over
// it. Tiles are blended bilinearly, like the browser's smoothed canvas
// upscale; the fog mask is tile-res and smoothed too (unexplored stays faintly
// readable, explored-but-unseen half dark).
shader_type canvas_item;

uniform sampler2D ground_tex : filter_nearest;    // cols x cols, ground type (R8)
uniform sampler2D res_tex : filter_nearest;       // tiles x tiles, resources (a = present)
uniform sampler2D height_tex : filter_nearest;    // cols x cols, int32 LE as RGBA8
uniform int cps = 2;       // columns per tile
uniform int tiles = 128;   // map size in tiles
uniform int water = 0;     // water level
uniform sampler2D fog_tex : filter_linear;
uniform bool fog_on = false;
uniform bool show_terrain = true;

int height_at(ivec2 c) {
	uvec4 b = uvec4(round(texelFetch(height_tex, c, 0) * 255.0));
	uint v = b.r | (b.g << 8u) | (b.b << 16u) | (b.a << 24u);
	return int(v);
}

vec3 ground_rgb(int g) {
	if (g == 6) return vec3(150.0, 160.0, 72.0);
	if (g == 1) return vec3(150.0, 115.0, 75.0);
	if (g == 2) return vec3(215.0, 196.0, 140.0);
	if (g == 3) return vec3(140.0, 134.0, 124.0);
	if (g == 4) return vec3(200.0, 190.0, 165.0);
	if (g == 5) return vec3(110.0, 76.0, 46.0);
	return vec3(96.0, 150.0, 58.0);
}

vec3 tile_rgb(ivec2 t) {
	t = clamp(t, ivec2(0), ivec2(tiles - 1));
	vec4 r = texelFetch(res_tex, t, 0);
	if (r.a > 0.5) return r.rgb;
	ivec2 c = t * cps;
	int l = height_at(c);
	vec3 rgb;
	if (l < water) rgb = l < water - 2 ? vec3(34.0, 90.0, 150.0) : vec3(60.0, 150.0, 170.0);
	else rgb = ground_rgb(int(round(texelFetch(ground_tex, c, 0).r * 255.0)));
	int lw = (t.x > 0 && t.y > 0) ? height_at(c - ivec2(cps)) : l;
	float shade = clamp(float(l - lw) * 0.09, -0.22, 0.22);
	float k = (0.84 + clamp(float(l - 4) * 0.03, -0.2, 0.25)) * (1.0 + shade);
	return min(round(rgb * k), vec3(255.0)) / 255.0;
}

void fragment() {
	vec2 p = UV * float(tiles) - 0.5;
	ivec2 t0 = ivec2(floor(p));
	vec2 f = fract(p);
	vec3 a = mix(tile_rgb(t0), tile_rgb(t0 + ivec2(1, 0)), f.x);
	vec3 b = mix(tile_rgb(t0 + ivec2(0, 1)), tile_rgb(t0 + ivec2(1, 1)), f.x);
	vec4 c = vec4(mix(a, b, f.y), 1.0);
	if (!show_terrain) c = vec4(0.047, 0.129, 0.161, 1.0);
	if (fog_on) {
		float fv = texture(fog_tex, UV).r; // 0 unexplored, .5 explored, 1 visible
		float al = fv < 0.5 ? mix(175.0, 95.0, fv * 2.0) : mix(95.0, 0.0, (fv - 0.5) * 2.0);
		c.rgb = mix(c.rgb, vec3(6.0, 8.0, 14.0) / 255.0, al / 255.0);
	}
	// a faint inner vignette so the map sits inside its frame
	vec2 e = min(UV, 1.0 - UV);
	c.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.06, min(e.x, e.y)));
	COLOR = c;
}
