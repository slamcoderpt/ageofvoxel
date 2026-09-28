// God power ribbons (effects.js ribbonVS + makeRibbonMaterial, sparkMat):
// camera-facing strips built by AovGodpowerView. CUSTOM0 = (side -1/1,
// half-width at 36 units from the camera, intensity, core 1 / halo 0),
// CUSTOM1.xyz = tangent, CUSTOM2.rgb = spark colour (spark mode, where
// CUSTOM0.z is 0 at the head and 1 at the tail). Additive HDR light.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, world_vertex_coords, fog_disabled, shadows_disabled;

uniform vec3 halo = vec3(0.05, 0.33, 1.0);
uniform vec3 core = vec3(1.0);
uniform vec3 edge = vec3(0.15, 0.05, 1.0);
uniform float gain = 1.35;
uniform float screen = 1.0;
uniform bool spark = false;

varying float v_side;
varying float v_i;
varying float v_core;
varying vec3 v_col;

void vertex() {
	vec3 wp = VERTEX;
	vec3 cp = INV_VIEW_MATRIX[3].xyz;
	vec3 t = normalize(CUSTOM1.xyz + vec3(0.0, 1e-7, 0.0));
	vec3 v = normalize(cp - wp);
	vec3 s = cross(t, v);
	float l = length(s);
	s = l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
	float dist = distance(cp, wp);
	float sc = spark ? clamp(dist / 36.0, 0.3, 3.0) : mix(1.0, clamp(dist / 36.0, 0.05, 3.0), screen);
	VERTEX = wp + s * CUSTOM0.x * CUSTOM0.y * sc;
	v_side = CUSTOM0.x;
	v_i = CUSTOM0.z;
	v_core = CUSTOM0.w;
	v_col = CUSTOM2.rgb;
}

void fragment() {
	float e = abs(v_side);
	vec3 col;
	float a = 1.0;
	if (spark) {
		float g = exp(-e * e * 3.5);
		float tail = pow(max(0.0, 1.0 - v_i), 1.6);
		col = v_col * g * tail;
	} else {
		if (v_core > 0.5) {
			float hot = 1.0 - smoothstep(0.38, 0.6, e);
			float rim = exp(-e * e * 2.5) * (1.0 - hot);
			col = core * hot * gain + halo * rim * 1.6;
		} else {
			float g = exp(-e * e * 4.5);
			col = mix(edge, halo, exp(-e * e * 9.0)) * g;
		}
		a = clamp(v_i, 0.0, 4.0);
	}
	ALBEDO = col * a;
	ALPHA = 1.0;
}
