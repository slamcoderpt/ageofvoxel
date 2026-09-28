// Camera-facing additive glow sprite (effects.js glowSprite). The instance
// basis carries the size (x, y), COLOR.rgb the colour * opacity,
// INSTANCE_CUSTOM.x the tightness (0 soft, 1 pin, 2 white-hot ball).
varying vec3 v_col;
varying float v_tight;

void vertex() {
	vec2 sc = vec2(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz));
	vec4 mv = VIEW_MATRIX * vec4(MODEL_MATRIX[3].xyz, 1.0);
	mv.xy += VERTEX.xy * sc;
	POSITION = PROJECTION_MATRIX * mv;
	v_col = COLOR.rgb;
	v_tight = INSTANCE_CUSTOM.x;
}

void fragment() {
	float d = length(UV - 0.5) * 2.0;
	float a = v_tight > 1.5 ? exp(-pow(d * 2.8, 3.0)) * 1.2 + exp(-d * d * 16.0) * 0.18
		: mix(exp(-d * d * 5.0) * 0.8 + exp(-d * d * 40.0) * 1.2, exp(-d * d * 90.0) * 1.4 + exp(-d * d * 9.0) * 0.18, v_tight);
	a *= 1.0 - smoothstep(0.85, 1.0, d);
	ALBEDO = v_col * a;
	ALPHA = 1.0;
}
