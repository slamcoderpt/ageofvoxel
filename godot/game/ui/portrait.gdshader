// HUD portrait material: the voxel albedo (same attributes as
// game/core/voxel.gdshader) lit exactly like src/core/portrait.js, i.e. a
// three.js MeshStandardMaterial (roughness 0.82) under
// HemisphereLight(0xdfeaff, 0x5a4a30, 2.2) + DirectionalLight(0xfff0d0, 3.2)
// from (3, 5, 4), rendered linear with no tone mapping and then gamma 1/2.2.
// Unshaded so Godot's own lights / tonemapper cannot blow the marble out;
// the output is pre-compensated for the viewport's linear -> sRGB write.
shader_type spatial;
render_mode unshaded, cull_back;

uniform vec3 team_color : source_color = vec3(1.0);
uniform float exposure = 1.0;

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	v_albedo = srgb_to_linear(CUSTOM0.rgb);
	v_team = CUSTOM1.r;
	v_glow = CUSTOM1.g;
}

const float INV_PI = 0.31830988618;
const vec3 SKY = vec3(0.7379, 0.8228, 1.0);     // 0xdfeaff, linear
const vec3 GROUND = vec3(0.1022, 0.0685, 0.0290); // 0x5a4a30, linear
const vec3 SUN = vec3(1.0, 0.8714, 0.6308) * 3.2; // 0xfff0d0 * 3.2, linear

void fragment() {
	vec3 albedo = v_albedo * mix(vec3(1.0), team_color, v_team);
	vec3 n = normalize(NORMAL);
	vec3 v = normalize(VIEW);
	vec3 up = normalize((VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
	vec3 l = normalize((VIEW_MATRIX * vec4(3.0, 5.0, 4.0, 0.0)).xyz);
	float a = 0.82 * 0.82;
	float a2 = a * a;
	// hemisphere (indirect diffuse)
	vec3 hemi = mix(GROUND, SKY, 0.5 * dot(n, up) + 0.5) * 2.2;
	float nv = clamp(dot(n, v), 1e-4, 1.0);
	vec3 col = hemi * albedo * INV_PI * 0.95;
	// sun (direct diffuse + GGX specular, F0 0.04)
	float nl = clamp(dot(n, l), 0.0, 1.0);
	vec3 h = normalize(l + v);
	float nh = clamp(dot(n, h), 0.0, 1.0);
	float vh = clamp(dot(v, h), 0.0, 1.0);
	float F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
	float d = a2 / (3.14159265 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
	float gl = nv * sqrt(nl * nl * (1.0 - a2) + a2);
	float gv = nl * sqrt(nv * nv * (1.0 - a2) + a2);
	float vis = 0.5 / max(gl + gv, 1e-5);
	vec3 irr = SUN * nl;
	col += irr * (albedo * INV_PI * (1.0 - F) + vec3(F * vis * d));
	col += albedo * v_glow * 2.5;
	col *= exposure;
	// three: linear render target, then pow(1/2.2) on readback; undo Godot's sRGB write
	vec3 g = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
	ALBEDO = srgb_to_linear(g);
}
