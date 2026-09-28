// Minimap ground (Minimap.js drawBase + the fog-of-war mask): the tile-res
// terrain image, smoothed when scaled up, under a tile-res fog mask
// (unexplored stays faintly readable, explored-but-unseen half dark).
shader_type canvas_item;

uniform sampler2D fog_tex : filter_linear;
uniform bool fog_on = false;
uniform bool show_terrain = true;

void fragment() {
	vec4 c = texture(TEXTURE, UV);
	if (!show_terrain) c = vec4(0.047, 0.129, 0.161, 1.0);
	if (fog_on) {
		float f = texture(fog_tex, UV).r; // 0 unexplored, .5 explored, 1 visible
		float a = f < 0.5 ? mix(175.0, 95.0, f * 2.0) : mix(95.0, 0.0, (f - 0.5) * 2.0);
		c.rgb = mix(c.rgb, vec3(6.0, 8.0, 14.0) / 255.0, a / 255.0);
	}
	// a faint inner vignette so the map sits inside its frame
	vec2 e = min(UV, 1.0 - UV);
	c.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.06, min(e.x, e.y)));
	COLOR = c;
}
