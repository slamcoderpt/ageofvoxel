// Egyptian buildings (egypt_buildings.gd): building.gdshader's albedo, team
// tint, baked AO and glow, lit so that sandstone in shade stays sandstone.
// The scene's shade light is cool (the hemisphere's sky half, the blue fill
// light, the blue-grey ambient): on pale sand walls it reads slate / ice
// blue and the shaded faces stop reading as the lit stone. Here the sun is
// lit as usual (Lambert, its cast shadows), but every cool light and the
// ambient are re-coloured to a warm umber of the same luminance, lifted by
// shade_gain so a face in shade sits at ~60-70 % of the lit value, and a
// warm bounce off the sand (strongest at the foot, fading by bounce_h tiles
// up, on faces that look sideways or down) is added. Greek buildings keep
// building.gdshader.
shader_type spatial;
render_mode cull_back, ambient_light_disabled, specular_disabled;

uniform vec3 team_color : source_color = vec3(1.0);
uniform bool use_instance_team = false;
uniform float roughness_value : hint_range(0.0, 1.0) = 0.93;
uniform float ao_strength : hint_range(0.0, 1.0) = 0.9;
uniform float ao_power = 0.9;
uniform float ao_up = 0.2;
uniform float pale_scale : hint_range(0.5, 1.0) = 0.87;
uniform float pale_from = 0.5;
uniform float pale_to = 0.85;
uniform float glow_gain = 1.1;
// shade
uniform vec3 shade_color : source_color = vec3(1.0, 0.86, 0.68);  // warm umber / ochre (sRGB, normalised to luminance 1)
uniform float shade_warm : hint_range(0.0, 1.0) = 1.0;  // 0 = the scene's cool shade light, 1 = all warm
uniform float shade_gain = 1.25;     // on the re-coloured shade light
uniform vec3 ambient_lin = vec3(0.083, 0.116, 0.150);   // the Environment's ambient (lighting.gd: avg x HEMI / PI)
uniform vec3 bounce_color : source_color = vec3(1.0, 0.78, 0.52);
uniform float bounce = 0.10;         // sand bounce at the foot (x albedo)
uniform float bounce_h = 1.1;        // fades out this many model units (tiles) up
// gilt: voxels painted a blue-free yellow gold (the statues' regalia, the
// obelisks' pyramidia) are lit as metal: darker in shade, a tinted sun
// highlight on faces turned between the sun and the eye
uniform float gold_shade = 0.5;      // x the shade light on gilt
uniform float gold_spec = 0.8;       // the highlight's strength (x albedo, so it stays gold)
uniform float gold_shine = 6.0;      // its exponent
uniform float gold_diffuse = 0.8;    // x the plain sun term on gilt (the rest comes from the highlight)

varying vec3 v_albedo;
varying float v_team;
varying float v_glow;
varying vec3 v_team_col;
varying float v_flash;
varying float v_ao;
varying float v_low;
varying float v_gold;
varying float v_keep;

vec3 srgb_to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float lum(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 warm() {
	vec3 w = srgb_to_linear(shade_color);
	return w / max(lum(w), 1e-4);
}

void vertex() {
	vec3 s = CUSTOM0.rgb;
	float mx = max(max(s.r, s.g), s.b);
	s *= mix(1.0, pale_scale, smoothstep(pale_from, pale_to, mx));
	v_albedo = srgb_to_linear(s);
	v_team = CUSTOM1.r;
	// gilt: no blue, green well under red but not a red (lapis, team, sand and red ochre all fail)
	vec3 a = v_albedo;
	v_gold = step(a.b, a.r * 0.06) * step(a.r * 0.3, a.g) * step(a.g, a.r * 0.8) * step(0.03, a.r) * (1.0 - step(0.01, CUSTOM1.r));
	v_glow = CUSTOM1.g;
	v_keep = CUSTOM1.a;
	v_ao = 1.0 - ao_strength * mix(1.0, ao_up, max(NORMAL.y, 0.0)) * pow(clamp(CUSTOM1.b, 0.0, 1.0), ao_power);
	// sand bounce: low on the model, on faces turned sideways or down
	v_low = (1.0 - smoothstep(0.0, bounce_h, VERTEX.y)) * (1.0 - max(NORMAL.y, 0.0));
	if (use_instance_team) {
		v_team_col = INSTANCE_CUSTOM.rgb;
		v_flash = INSTANCE_CUSTOM.a;
	} else {
		v_team_col = team_color;
		v_flash = 0.0;
	}
}

void fragment() {
	vec3 c = v_albedo * mix(vec3(1.0), v_team_col, v_team);
	ALBEDO = c * v_ao;
	ROUGHNESS = roughness_value;
	METALLIC = 0.0;
	// the ambient, warmed (render_mode ambient_light_disabled drops the cool one)
	// team voxels keep the cool shade light (the owner's colour stays a lapis / maroon line, not brown)
	float sw = shade_warm * (1.0 - v_team);
	vec3 amb = mix(ambient_lin, lum(ambient_lin) * warm() * shade_gain, sw) * mix(1.0, gold_shade, v_gold);
	vec3 b = srgb_to_linear(bounce_color) * bounce * v_low;
	EMISSION = c * v_ao * (amb + b) + c * v_glow * glow_gain + vec3(1.0, 0.95, 0.85) * v_flash;
	// a fire voxel (glow >= 0.85: the Lighthouse's beacon) keeps its own
	// orange through the grade (grade_effect.gd: a negative blue, -8 x the
	// brightest channel, skips the chroma limiter that turns orange pink)
	if (v_glow > 0.85) EMISSION.b = -8.0 * max(EMISSION.r, EMISSION.g);
	// true gilt (export-egypt.mjs m.keep: the Obelisk's cap and collar) keeps
	// its lit gold through the grade the same way: a negative blue far beyond
	// the pixel's own light (its albedo has no blue), so the grade takes the
	// pixel's lit (r, g) as is instead of greying it to sand
	if (v_keep > 0.5) EMISSION.b = -80.0;
}

void light() {
	float ndl = max(dot(NORMAL, LIGHT), 0.0);
	vec3 lc = LIGHT_COLOR / PI;
	// the sun is the only warm light (red > blue); the fill and the hemisphere
	// halves (the ground half has a negative energy) are cool
	if (abs(lc.b) > abs(lc.r)) {
		lc = mix(lc, lum(lc) * warm() * shade_gain, shade_warm * (1.0 - v_team));
		DIFFUSE_LIGHT += lc * ATTENUATION * ndl * mix(1.0, gold_shade, v_gold);
	} else {
		vec3 hv = normalize(LIGHT + VIEW);
		float sp = pow(max(dot(NORMAL, hv), 0.0), gold_shine) * gold_spec * v_gold;
		DIFFUSE_LIGHT += lc * ATTENUATION * (ndl * mix(1.0, gold_diffuse, v_gold) + sp * step(0.0, dot(NORMAL, LIGHT)));
	}
}
