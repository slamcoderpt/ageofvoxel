// Health bars (combat/Overlays.js): camera-facing quads a fixed number of
// pixels tall (and `width` pixels long), with a crisp 1 px dark frame, drawn
// over everything. Instance: origin = bar centre, INSTANCE_CUSTOM.x = health
// fraction, .y = width in pixels; COLOR.rgb = fill colour.
shader_type spatial;
render_mode unshaded, fog_disabled, blend_mix, depth_test_disabled, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

uniform float bar_px = 7.0;
varying float v_fill;
varying vec2 v_px;
varying vec3 v_col;

void vertex() {
	vec3 c = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float wpp = -c.z / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y * 0.5);
	float w = wpp * INSTANCE_CUSTOM.y;
	float h = wpp * bar_px;
	v_fill = INSTANCE_CUSTOM.x;
	v_px = vec2(INSTANCE_CUSTOM.y, bar_px);
	v_col = COLOR.rgb;
	VERTEX = c + vec3(VERTEX.x * w, VERTEX.y * h, 0.0);
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	vec2 px = vec2(1.0 - UV.x, 1.0 - UV.y) * v_px;
	float edge = min(min(px.x, v_px.x - px.x), min(px.y, v_px.y - px.y));
	vec3 c;
	if (edge < 1.0) {
		c = vec3(0.02, 0.018, 0.015);
	} else {
		float f = (px.x - 1.0) / (v_px.x - 2.0);
		float yy = (px.y - 1.0) / max(1.0, v_px.y - 2.0);
		float lit = 0.82 + 0.2 * yy + (yy > 0.65 ? 0.18 : 0.0);
		c = f < v_fill ? v_col * lit : vec3(0.86, 0.1, 0.07) * lit;
		if (abs(f - v_fill) * (v_px.x - 2.0) < 0.6) c = vec3(0.02);
	}
	ALBEDO = c;
	ALPHA = edge < 1.0 ? 0.95 : 1.0;
}
