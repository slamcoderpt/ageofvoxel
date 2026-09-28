// Ground scars (BattleFX.js _initScars): churned earth and blood stamped onto
// the voxel columns where units fight and fall, pixel-crisp, lit and
// shadowed like the terrain. One 0.5 x 0.5 cell per column; instance:
// origin = column top centre, INSTANCE_CUSTOM.xy = (dirt, blood).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_disabled;

varying vec2 v_xz;
varying vec2 v_scar;

float scar_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void vertex() {
	v_xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
	v_scar = INSTANCE_CUSTOM.xy;
}

void fragment() {
	vec2 tx = floor(v_xz * 8.0);
	vec2 tc = floor(v_xz * 4.0);
	float h3 = scar_hash(tx + 41.9);
	float hc = scar_hash(tc), hb = scar_hash(tc + 5.1);
	float cover = v_scar.x - 0.25 * hc;
	float blood = v_scar.y - 0.3 * hb;
	vec3 c;
	if (blood > 0.25) c = mix(vec3(0.09, 0.008, 0.006), vec3(0.16, 0.014, 0.01), h3);
	else if (cover > 0.2) c = mix(vec3(0.2, 0.13, 0.065), vec3(0.12, 0.075, 0.035), clamp(cover, 0.0, 1.0)) * (0.9 + 0.2 * h3);
	else discard;
	ALBEDO = c;
	ROUGHNESS = 0.95;
}
