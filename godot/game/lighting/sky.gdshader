// Sky (port of src/lighting/Sky.js): gradient dome with a soft sun glow.
// Seen only where the camera looks past the map (the RTS view rarely does).
// Ambient light does not come from here: lighting.gd builds the JS
// HemisphereLight out of an ambient colour and two unshadowed lights.
shader_type sky;
render_mode use_debanding;

uniform vec3 top_color : source_color = vec3(0.184, 0.451, 0.847);     // 0x2f73d8
uniform vec3 horizon_color : source_color = vec3(0.812, 0.894, 0.969); // 0xcfe4f7
uniform vec3 bottom_color : source_color = vec3(0.608, 0.722, 0.627);  // 0x9bb8a0
uniform vec3 sun_color : source_color = vec3(1.0, 0.949, 0.816);       // 0xfff2d0
uniform vec3 sun_dir = vec3(-0.6, 0.47, 0.4);

void sky() {
	vec3 d = normalize(EYEDIR);
	{
		float h = d.y;
		vec3 c = h > 0.0 ? mix(horizon_color, top_color, pow(clamp(h, 0.0, 1.0), 0.55))
			: mix(horizon_color, bottom_color, clamp(-h * 4.0, 0.0, 1.0));
		float s = max(dot(d, normalize(sun_dir)), 0.0);
		c += sun_color * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
		COLOR = c;
	}
}
