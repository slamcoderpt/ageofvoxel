// Fog of war for the local player, as one full-screen pass (the JS
// applyFogOfWar() patch on every world material, done once in screen space):
// the depth buffer gives each pixel's world position, the sim's fog grid
// (0 unexplored, 128 explored, 255 visible, bilinear + a small blur) gives
// the JS factor f = smoothstep(0, .5, v) * (.45 + .55 * smoothstep(.5, 1, v)),
// and the pixel becomes colour * f + dark * (1 - f), where dark is black seen
// through the scene's depth haze (the browser multiplies before THREE.Fog).
// Drawn last in the transparent pass, before the lighting piece's grade.
shader_type spatial;
render_mode unshaded, blend_mix, depth_test_disabled, depth_draw_never, cull_disabled, fog_disabled, shadows_disabled;

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform sampler2D fog_tex : filter_linear, repeat_disable;
uniform float world_size = 128.0;
uniform float blur = 1.1;              // tiles
uniform vec3 dark : source_color = vec3(0.0);
uniform vec3 haze : source_color = vec3(0.776, 0.808, 0.827);
uniform float haze_density = 0.55;
uniform float haze_begin = 40.0;
uniform float haze_end = 150.0;
uniform float ground_y = 0.0;          // haze distance: to this plane (smooth, no silhouettes)

void vertex() {
	POSITION = vec4(VERTEX.xy * 2.0, 0.0, 1.0);
}

float fog_at(vec2 xz) {
	vec2 uv = xz / world_size;
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
	float d = blur / world_size;
	float v = texture(fog_tex, uv).r * 0.36;
	v += (texture(fog_tex, uv + vec2(d, 0.0)).r + texture(fog_tex, uv - vec2(d, 0.0)).r
		+ texture(fog_tex, uv + vec2(0.0, d)).r + texture(fog_tex, uv - vec2(0.0, d)).r) * 0.11;
	v += (texture(fog_tex, uv + vec2(d, d)).r + texture(fog_tex, uv - vec2(d, d)).r
		+ texture(fog_tex, uv + vec2(d, -d)).r + texture(fog_tex, uv - vec2(d, -d)).r) * 0.05;
	return v;
}

void fragment() {
	float depth = textureLod(depth_tex, SCREEN_UV, 0.0).r;
	float f = 0.0;
	float dist = 1e6;
	{
		// the unexplored reads as one smooth dark sheet under the haze: its
		// haze distance is along the view ray to the ground plane
		vec4 fp = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, 1.0, 1.0);
		vec3 dir = normalize((INV_VIEW_MATRIX * vec4(fp.xyz / fp.w, 0.0)).xyz);
		vec3 eye = INV_VIEW_MATRIX[3].xyz;
		if (dir.y < -1e-4) dist = (eye.y - ground_y) / -dir.y;
	}
	// Forward+/Mobile: reversed Z, NDC z in [0, 1], the sky clears to 0.
	// Compatibility (GLES3 / WebGL2, the web export): standard Z, NDC z is
	// depth * 2 - 1, the sky clears to 1.
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
	bool geometry = depth < 1.0;
	vec3 ndc = vec3(SCREEN_UV, depth) * 2.0 - 1.0;
#else
	bool geometry = depth > 0.0;
	vec3 ndc = vec3(SCREEN_UV * 2.0 - 1.0, depth);
#endif
	if (geometry) {
		vec4 vp = INV_PROJECTION_MATRIX * vec4(ndc, 1.0);
		vp.xyz /= vp.w;
		vec3 wp = (INV_VIEW_MATRIX * vec4(vp.xyz, 1.0)).xyz;
		float v = fog_at(wp.xz);
		f = smoothstep(0.0, 0.5, v) * (0.45 + 0.55 * smoothstep(0.5, 1.0, v));
	}
	if (f >= 0.999) discard;
	// past the far haze (sky, water beyond the map) the browser tops out at
	// its far frame colour: cap the haze there
	float a = haze_density * min(0.6, clamp((dist - haze_begin) / max(haze_end - haze_begin, 1.0), 0.0, 1.0));
	ALBEDO = mix(dark, haze, a);
	ALPHA = 1.0 - f;
}
