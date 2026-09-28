// Arrow streaks (combat/Projectiles.js trails): a thin camera-facing ribbon
// from the tail to the head of each arrow, fading along the trail.
// Instance: origin = head, COLOR.rgb = tail position.
shader_type spatial;
render_mode unshaded, fog_disabled, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, skip_vertex_transform;

varying vec2 v_uv;

void vertex() {
	vec3 head = MODEL_MATRIX[3].xyz;
	vec3 tail = COLOR.rgb;
	float along = VERTEX.x + 0.5;
	vec3 p = mix(tail, head, along);
	vec3 dir = head - tail;
	vec3 side = normalize(cross(dir + vec3(1e-4), CAMERA_POSITION_WORLD - p));
	p += side * VERTEX.y * mix(0.012, 0.06, along * along);
	v_uv = vec2(along, VERTEX.y * 2.0);
	VERTEX = (VIEW_MATRIX * vec4(p, 1.0)).xyz;
	NORMAL = vec3(0.0, 0.0, 1.0);
}

void fragment() {
	float k = v_uv.x;
	float core = 1.0 - smoothstep(0.0, 1.0, abs(v_uv.y));
	float a = pow(k, 1.3) * core;
	ALBEDO = mix(vec3(0.85, 0.8, 0.7), vec3(1.0, 0.97, 0.9), k);
	ALPHA = a * 0.7;
}
