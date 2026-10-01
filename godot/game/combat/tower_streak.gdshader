// Tower arrow trails (game/combat/tower_fire.gd): one segment of the trail
// a tower's arrow draws along its arc, a camera-facing ribbon that widens and
// brightens towards the head (a hot warm-white core in an amber edge, so the
// shot reads against grass, stone and sky at RTS distance).
// Instance: origin = the segment's head end, COLOR.rgb = its tail end,
// INSTANCE_CUSTOM = (trail coordinate at the tail, at the head (0 = the
// trail's end, 1 = the arrow), half width at the head in world units, min
// half width in px at 1080p).
shader_type spatial;
render_mode unshaded, fog_disabled, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec2 v_uv;

void vertex() {
	vec3 head = MODEL_MATRIX[3].xyz;
	vec3 tail = COLOR.rgb;
	float along = VERTEX.x + 0.5;
	vec3 p = mix(tail, head, along);
	float k = mix(INSTANCE_CUSTOM.x, INSTANCE_CUSTOM.y, along);
	vec3 vp = (VIEW_MATRIX * vec4(p, 1.0)).xyz;
	float wpp = -vp.z / (PROJECTION_MATRIX[1][1] * VIEWPORT_SIZE.y * 0.5);
	float w = max(INSTANCE_CUSTOM.z * mix(0.25, 1.0, k), INSTANCE_CUSTOM.w * VIEWPORT_SIZE.y / 1080.0 * wpp * mix(0.35, 1.0, k));
	vec3 dir = head - tail;
	vec3 side = normalize(cross(dir + vec3(1e-5), CAMERA_POSITION_WORLD - p));
	p += side * VERTEX.y * 2.0 * w;
	v_uv = vec2(k, VERTEX.y * 2.0);
	VERTEX = (VIEW_MATRIX * vec4(p, 1.0)).xyz;
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	float k = v_uv.x;
	float y = abs(v_uv.y);
	float edge = 1.0 - smoothstep(0.55, 1.0, y);
	float core = 1.0 - smoothstep(0.0, 0.45, y);
	float a = edge * pow(clamp(k, 0.0, 1.0), 0.9);
	if (a < 0.01) discard;
	vec3 amber = vec3(1.0, 0.36, 0.04);
	vec3 hot = vec3(1.0, 0.93, 0.75);
	ALBEDO = mix(amber, hot, core * (0.25 + 0.6 * k)) * 0.42;   // the grade's exposure does the rest
	ALPHA = clamp(a * (0.7 + 0.3 * core), 0.0, 1.0);
}
