// Silhouette outline of the unit parts (index.js outlineMat): every part is
// drawn again as a dark inverted hull, back faces pushed out along their
// normals, so each soldier is ringed by a thin dark line. Next pass of
// unit.gdshader; shares its instance data (COLOR.a = corpse fade).
shader_type spatial;
render_mode cull_front, unshaded, shadows_disabled, ambient_light_disabled;

uniform float width = 0.045;
uniform vec3 line_color : source_color = vec3(0.078, 0.051, 0.031);
// the line of meshes with a width factor (the Egyptian units): a dark sienna,
// so a thin line round an arm or a kilt reads as shade, not a black cut-out edge
uniform vec3 eg_line_color : source_color = vec3(0.29, 0.14, 0.06);
// (round 12) one line treatment for every Egyptian unit: the line is the
// surface's own colour taken down (eg_line_k of its linear albedo, the team
// voxels in their dye, over a little of the sienna), a contact shade rather
// than a drawn edge: deep brown round skin, a warm grey round white linen,
// so a priest's robe and face get the same clean, thin line as a bare worker
uniform float eg_line_k = 0.24;
uniform float eg_line_sienna = 0.35;
varying float v_fade;
varying float v_eg;
varying vec3 v_line;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// CUSTOM1.b (Egyptian unit meshes, export-egypt-units.mjs): a per-corner push
// direction, every copy of a corner moved alike so the hull stays closed (no
// stair-stepped fringes along the voxel edges); 0 = along the face normal.
// CUSTOM1.a: this mesh's width factor (0 = 1).
void vertex() {
	vec3 dir = NORMAL;
	float code = floor(CUSTOM1.b * 255.0 + 0.5);
	if (code > 0.5) {
		code -= 1.0;
		dir = vec3(mod(code, 3.0), mod(floor(code / 3.0), 3.0), floor(code / 9.0)) - 1.0;
	}
	float k = CUSTOM1.a > 0.002 ? CUSTOM1.a : 1.0;
	v_eg = CUSTOM1.a > 0.002 ? 1.0 : 0.0;
	VERTEX += dir * width * k;
	v_fade = COLOR.a;
	vec3 alb = srgb_to_linear(CUSTOM0.rgb);
	vec3 dye = INSTANCE_CUSTOM.rgb * 0.22;
	alb = mix(alb, alb * dye, CUSTOM1.r);
	v_line = alb * eg_line_k * COLOR.rgb + eg_line_color * eg_line_sienna * 0.12;
}

float bayer4(vec2 fc) {
	vec2 q = mod(floor(fc), 4.0);
	vec2 lo = mod(q, 2.0), hi = floor(q * 0.5);
	return (4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0) + 0.5) / 16.0;
}

void fragment() {
	if (v_fade < 0.999 && bayer4(FRAGCOORD.xy) > v_fade) discard;
	ALBEDO = v_eg > 0.5 ? v_line : line_color;
}
