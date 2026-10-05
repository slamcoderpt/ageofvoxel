// Silhouette outline of the unit parts (index.js outlineMat): every part is
// drawn again as a dark inverted hull, back faces pushed out along their
// normals, so each soldier is ringed by a thin dark line. Next pass of
// unit.gdshader; shares its instance data (COLOR.a = corpse fade).
shader_type spatial;
render_mode cull_front, unshaded, shadows_disabled, ambient_light_disabled;

uniform float width = 0.045;
uniform vec3 line_color : source_color = vec3(0.078, 0.051, 0.031);
varying float v_fade;

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
	VERTEX += dir * width * k;
	v_fade = COLOR.a;
}

float bayer4(vec2 fc) {
	vec2 q = mod(floor(fc), 4.0);
	vec2 lo = mod(q, 2.0), hi = floor(q * 0.5);
	return (4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0) + 0.5) / 16.0;
}

void fragment() {
	if (v_fade < 0.999 && bayer4(FRAGCOORD.xy) > v_fade) discard;
	ALBEDO = line_color;
}
