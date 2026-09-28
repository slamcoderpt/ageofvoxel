// HUD panel (port of hud.css .gild / .resrow / .plate / .menubar / .tray):
// a chamfered rect (the CSS clip-path) with a teal gradient fill, the diagonal
// grain, the cast-bronze border-image (var(--metal) 1) on chosen sides, the
// inset frame lines (--frame: 1px dark, 1px gold .55, 1px dark, inset 22px
// shade) and an outer drop shadow. The control's rect includes `margin` px of
// room for the shadow on every side; all sizes in CSS px.
shader_type canvas_item;

uniform vec2 size = vec2(100.0);          // the panel box (without margin)
uniform float margin = 16.0;
uniform vec4 chamfer = vec4(0.0);          // tl, tr, br, bl
uniform vec4 border = vec4(3.0);           // top, right, bottom, left metal widths
uniform int bg_mode = 0;                   // 0 vertical 3-stop, 1 radial 3-stop
uniform vec4 bg0 : source_color = vec4(0.071, 0.227, 0.275, 1.0);
uniform vec4 bg1 : source_color = vec4(0.039, 0.141, 0.173, 1.0);
uniform vec4 bg2 : source_color = vec4(0.024, 0.090, 0.114, 1.0);
uniform float bg_mid = 0.55;
uniform vec2 radial_center = vec2(0.5, 0.0);  // in 0..1 of the box
uniform vec2 radial_radius = vec2(1.3, 1.0);  // in box units (CSS 130% 100%)
uniform float frame = 1.0;
uniform float frame_glow = 22.0;
uniform float grain = 1.0;
uniform vec2 shadow_offset = vec2(0.0, 6.0);
uniform float shadow_blur = 18.0;
uniform float shadow_alpha = 0.5;
uniform float chamfer_rim = 1.5;           // bronze line along the chamfer cuts

const vec3 M0 = vec3(0.953, 0.847, 0.576);  // #f3d893
const vec3 M1 = vec3(0.702, 0.541, 0.271);  // #b38a45
const vec3 M2 = vec3(0.431, 0.310, 0.133);  // #6e4f22
const vec3 M3 = vec3(0.788, 0.635, 0.345);  // #c9a258

vec3 metal(float t) {
	if (t < 0.38) return mix(M0, M1, t / 0.38);
	if (t < 0.62) return mix(M1, M2, (t - 0.38) / 0.24);
	return mix(M2, M3, (t - 0.62) / 0.38);
}

// signed distance to the chamfered box (negative inside), offset inward by
// per-edge insets (top, right, bottom, left, chamfer)
float sd_box(vec2 p, vec4 ins, float cins) {
	float d = max(max(ins.w - p.x, ins.x - p.y), max(p.x - (size.x - ins.y), p.y - (size.y - ins.z)));
	const float R2 = 0.70710678;
	if (chamfer.x > 0.0) d = max(d, (chamfer.x + cins / R2 - (p.x + p.y)) * R2);
	if (chamfer.y > 0.0) d = max(d, (chamfer.y + cins / R2 - ((size.x - p.x) + p.y)) * R2);
	if (chamfer.z > 0.0) d = max(d, (chamfer.z + cins / R2 - ((size.x - p.x) + (size.y - p.y))) * R2);
	if (chamfer.w > 0.0) d = max(d, (chamfer.w + cins / R2 - (p.x + (size.y - p.y))) * R2);
	return d;
}

void fragment() {
	vec2 full = size + vec2(margin * 2.0);
	vec2 p = UV * full - vec2(margin);
	float d = sd_box(p, vec4(0.0), 0.0);
	// outer drop shadow
	float ds = sd_box(p - shadow_offset, vec4(0.0), 0.0);
	float sh = shadow_alpha * (1.0 - smoothstep(-shadow_blur * 0.35, shadow_blur * 0.75, ds));
	float inside = clamp(0.5 - d, 0.0, 1.0);

	// background
	vec2 q = p / size;
	vec3 bg;
	float bga;
	if (bg_mode == 1) {
		float t = length((q - radial_center) / radial_radius);
		bg = t < bg_mid ? mix(bg0.rgb, bg1.rgb, t / bg_mid) : mix(bg1.rgb, bg2.rgb, clamp((t - bg_mid) / (1.0 - bg_mid), 0.0, 1.0));
		bga = t < bg_mid ? mix(bg0.a, bg1.a, t / bg_mid) : mix(bg1.a, bg2.a, clamp((t - bg_mid) / (1.0 - bg_mid), 0.0, 1.0));
	} else {
		float t = clamp(q.y, 0.0, 1.0);
		bg = t < bg_mid ? mix(bg0.rgb, bg1.rgb, t / bg_mid) : mix(bg1.rgb, bg2.rgb, (t - bg_mid) / (1.0 - bg_mid));
		bga = t < bg_mid ? mix(bg0.a, bg1.a, t / bg_mid) : mix(bg1.a, bg2.a, (t - bg_mid) / (1.0 - bg_mid));
	}
	// grain: repeating-linear-gradient(120deg, rgba(255,255,255,.016) 0 2px, transparent 2px 6px),
	//        repeating-linear-gradient(30deg, rgba(0,0,0,.06) 0 1px, transparent 1px 5px)
	if (grain > 0.0) {
		float g1 = mod(dot(p, vec2(0.8660254, 0.5)), 6.0);
		float g2 = mod(dot(p, vec2(0.5, -0.8660254)), 5.0);
		bg = mix(bg, vec3(1.0), 0.016 * 1.6 * grain * (1.0 - smoothstep(1.6, 2.4, g1)));
		bg = mix(bg, vec3(0.0), 0.06 * grain * (1.0 - smoothstep(0.7, 1.3, g2)));
	}
	// subtle vertical sheen so a flat fill reads as a lacquered surface
	bg *= 1.0 + 0.05 * (1.0 - smoothstep(0.0, 0.35, q.y));

	// padding box (inside the metal border)
	float di = sd_box(p, border, min(chamfer_rim, max(max(border.x, border.y), max(border.z, border.w))));
	vec3 col = bg;
	float a = bga;
	if (frame > 0.0) {
		float k = -di; // px inside the padding box
		float glow = 0.45 * (1.0 - smoothstep(0.0, frame_glow, k));
		col = mix(col, vec3(0.0), glow * frame);
		if (k < 3.0) {
			vec3 line = k < 1.0 ? vec3(0.016, 0.043, 0.055) : k < 2.0 ? mix(col, vec3(0.847, 0.706, 0.424), 0.55) : vec3(0.016, 0.043, 0.055);
			col = mix(col, line, frame);
		}
	}
	// metal border band: 0 < inside-distance and padding-box outside
	float band = clamp(0.5 + di, 0.0, 1.0);
	if (band > 0.0) {
		// which edge: nearest of the plain sides picks the border-image slice
		float et = p.y, er = size.x - p.x, eb = size.y - p.y, el = p.x;
		vec3 m;
		float bw;
		float mn = 1e9;
		if (border.x > 0.0 && et / border.x < mn) { mn = et / border.x; m = M0; bw = border.x; }
		if (border.z > 0.0 && eb / border.z < mn) { mn = eb / border.z; m = M3; bw = border.z; }
		if (border.w > 0.0 && el / border.w < mn) { mn = el / border.w; m = metal(q.y); bw = border.w; }
		if (border.y > 0.0 && er / border.y < mn) { mn = er / border.y; m = metal(q.y); bw = border.y; }
		if (mn > 1e8) { m = metal(q.y); bw = chamfer_rim; mn = 0.5; }
		// a cast bevel: bright outer lip, darker inner lip
		float across = clamp(mn, 0.0, 1.0);
		m *= mix(1.12, 0.82, across);
		col = mix(col, m, band);
		a = mix(a, 1.0, band);
	}
	// thin dark hairline right at the outer edge
	col = mix(col, vec3(0.016, 0.043, 0.055), (1.0 - smoothstep(0.0, 1.0, -d)) * 0.8);

	vec4 panel = vec4(col, a * inside);
	vec4 shadow = vec4(0.0, 0.0, 0.0, sh);
	COLOR = vec4(mix(shadow.rgb, panel.rgb, panel.a), panel.a + shadow.a * (1.0 - panel.a));
	COLOR.rgb = COLOR.a > 0.0 ? COLOR.rgb : vec3(0.0);
}
