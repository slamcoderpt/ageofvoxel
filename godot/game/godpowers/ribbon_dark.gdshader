// God power ribbons drawn DARK (alpha-blended, not added): the same camera-facing strips as
// ribbon.gdshader (CUSTOM0 = side, half-width, intensity, core flag; CUSTOM1.xyz = tangent),
// painted, not added. The Son of Osiris' chain lightning lays one under each bolt, its strands
// and its impact rays (a gold body in a dark edge that its white-hot core stands on): additive
// light alone on bright desert sand only lightens the sand (round 24). CUSTOM0.z = opacity, CUSTOM0.w = 1 a hard-edged strip: a body painted in `inner`
// (the bolt's saturated gold, painted rather than added so the sand under it cannot bleach it,
// and marked emissive so the grade keeps it)
// inside a dark `tint` edge / 0 a soft dark strip.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, world_vertex_coords, fog_disabled, shadows_disabled;

uniform vec3 tint = vec3(0.05, 0.03, 0.06);
uniform vec3 inner = vec3(0.36, 0.165, 0.0);
uniform float body = 0.36;   // the gold body's half-width, as a fraction of the strip's
uniform float screen = 1.0;

varying float v_side;
varying float v_i;
varying float v_hard;

void vertex() {
	vec3 wp = VERTEX;
	vec3 cp = INV_VIEW_MATRIX[3].xyz;
	vec3 t = normalize(CUSTOM1.xyz + vec3(0.0, 1e-7, 0.0));
	vec3 v = normalize(cp - wp);
	vec3 s = cross(t, v);
	float l = length(s);
	s = l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
	float dist = distance(cp, wp);
	float sc = mix(1.0, clamp(dist / 36.0, 0.05, 3.0), screen);
	VERTEX = wp + s * CUSTOM0.x * CUSTOM0.y * sc;
	v_side = CUSTOM0.x;
	v_i = CUSTOM0.z;
	v_hard = CUSTOM0.w;
}

void fragment() {
	float e = abs(v_side);
	float g = v_hard > 0.5 ? 1.0 - smoothstep(0.82, 0.98, e) : exp(-e * e * 3.0);
	float b = v_hard > 0.5 ? 1.0 - smoothstep(body - 0.08, body + 0.06, e) : 0.0;
	ALBEDO = mix(tint, inner, b);
	// the gold body is marked emissive (a negative blue, as ribbon.gdshader's `emit`): the grade
	// (game/lighting/grade_effect.gd) then keeps its saturated gold instead of graying it to ochre
	if (b > 0.5) ALBEDO.b = -8.0 * max(ALBEDO.r, ALBEDO.g);
	ALPHA = clamp(g * v_i, 0.0, 1.0);
}
