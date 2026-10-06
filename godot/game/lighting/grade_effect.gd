@tool
extends CompositorEffect
## Tone mapping + colour grade (port of the FinalPass in src/lighting/PostFX.js)
## as one compute pass over the HDR colour buffer, after transparents and
## before Godot's own tonemap pass (set to LINEAR, exposure 1, so it only
## encodes to sRGB). Steps, as the browser:
##  1. exposure (JS toneMappingExposure 2.45; 2.1 here, where the terrain and
##     voxel albedos differ a little) and Khronos PBR Neutral
##     tone mapping (Godot has no Neutral; ACES / AgX bleach the sandstone),
##  2. the display-space grade: olive foliage, chroma limit, saturation, mid
##     S-curve, cool shade, highlight shoulder, black floor, foliage luminance
##     compression, cool sky fill in the shade, top-edge aerial haze, vignette,
##  3. plus the sandstone tint MaterialPatches.js gives pale neutral stone
##     (done here on the graded pixel, since the voxel shader is core's).
## Forward+ / Mobile only (CompositorEffect); the Compatibility renderer (web)
## falls back to the Environment's AgX tonemap (lighting.gd).
## Push constants stay within 128 bytes (the Vulkan minimum).
## Uniforms are plain properties so scenes and god powers can ease them.

var exposure := 2.1
var grade_exposure := 0.93
var chroma_limit := 0.42
var saturation := 0.84
var green_shift := 0.45
var green_desat := 0.14
var mid_contrast := 0.24
var knee := 0.68
var shoulder := 3.8
var top_haze := 0.26
var leaf_lum := Vector3(0.09, 0.68, 0.57)
var leaf_chroma := 0.16
var floor_value := 0.1
var vignette := 0.0
var sand_amt := 0.35
var pale := 0.75
var top_haze_color := Vector3(0.7, 0.78, 0.85)
var split_cool := Vector3(0.93, 1.0, 1.08)
var sand := Vector3(1.0, 0.85, 0.61)

var rd: RenderingDevice
var shader: RID
var pipeline: RID

const SRC := """
#version 450
layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;
layout(rgba16f, set = 0, binding = 0) uniform image2D color_image;
layout(push_constant, std430) uniform Params {
	vec4 size_exp;      // w, h, exposure, grade exposure
	vec4 a;             // chroma limit, saturation, green shift, green desat
	vec4 b;             // mid contrast, knee, shoulder, top haze
	vec4 leaf;          // leaf lum xyz, leaf chroma
	vec4 c;             // floor, vignette, sand amount, pale scale
	vec4 haze_color;
	vec4 split_cool;
	vec4 sand;
} p;

const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
const vec3 SHADOW_TINT = vec3(0.99, 0.97, 0.98); // near neutral: shade reads warm-olive
const vec3 BLACK_FLOOR = vec3(0.03, 0.036, 0.026);

vec3 neutral(vec3 color) {
	const float start = 0.8 - 0.04;
	const float desat = 0.15;
	float x = min(color.r, min(color.g, color.b));
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max(color.r, max(color.g, color.b));
	if (peak < start) return color;
	const float d = 1.0 - start;
	float np = 1.0 - d * d / (peak + d - start);
	color *= np / peak;
	float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
	return mix(color, np * vec3(1.0), g);
}
vec3 to_srgb(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void main() {
	ivec2 px = ivec2(gl_GlobalInvocationID.xy);
	ivec2 size = ivec2(p.size_exp.xy);
	if (px.x >= size.x || px.y >= size.y) return;
	vec4 t = imageLoad(color_image, px);
	vec2 uv = vec2((float(px.x) + 0.5) / float(size.x), 1.0 - (float(px.y) + 0.5) / float(size.y));
	// (game/godpowers) emissive light: an effect that wants its own colour kept (fire, lava)
	// writes a negative blue, -8 x its own brightest channel, so f is about how bright its light
	// is here and em how much of the pixel's light is its; (r, g, 0) is then the colour, which
	// skips the chroma limiter / saturation / curves below (they turn a saturated orange pink)
	// and whitens to a yellow-white when very hot. Every pixel with blue >= 0 is graded as before.
	float em = 0.0;
	vec3 emit = vec3(0.0);
	if (t.b < 0.0) {
		float f = -t.b / 8.0;
		em = smoothstep(0.2, 0.75, f / max(max(t.r, t.g), 1e-4));
		vec3 e = vec3(max(t.r, 0.0), max(t.g, 0.0), 0.0) * p.size_exp.z;
		float pk = max(e.r, e.g);
		if (pk > 0.76) {
			float np = 1.0 - 0.0576 / (pk + 0.24 - 0.76);
			e *= np / pk;
			e = mix(e, np * vec3(1.0, 0.86, 0.55), 1.0 - 1.0 / (0.15 * (pk - np) + 1.0));
		}
		emit = to_srgb(e) * p.size_exp.w;
	}

	vec3 hdr = max(t.rgb, 0.0) * p.size_exp.z;
	// --- pale stone: pale neutral surfaces (plaza paving, marble, plaster) are
	// pulled down before tone mapping (the JS uPale / uPaveAlb albedo scales) so
	// sunlit paving keeps its texture and cast shadows on it read clearly
	{
		float mx = max(hdr.r, max(hdr.g, hdr.b)), mn = min(hdr.r, min(hdr.g, hdr.b));
		float sat = (mx - mn) / max(mx, 1e-4);
		float pw = (1.0 - smoothstep(0.1, 0.3, sat)) * smoothstep(0.3, 1.1, dot(hdr, LW));
		hdr *= mix(1.0, p.c.w, pw);
	}
	vec3 c = to_srgb(neutral(hdr)) * p.size_exp.w;

	// --- sandstone: pale neutral stone leans warm cream (MaterialPatches atmPale)
	{
		float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
		float sat = (mx - mn) / max(mx, 1e-3);
		float pale = smoothstep(0.45, 0.8, mx) * (1.0 - smoothstep(0.1, 0.26, sat)) * step(c.b, max(c.r, c.g) + 0.01);
		float l = dot(c, LW);
		vec3 sd = l * p.sand.rgb / dot(p.sand.rgb, LW);
		c = mix(c, sd, pale * p.c.z);
	}
	// --- foliage: push green towards yellow-olive
	float g = clamp((c.g - max(c.r, c.b)) / max(c.g, 1e-3), 0.0, 1.0);
	g = smoothstep(0.05, 0.7, g);
	c.r = mix(c.r, max(c.r, c.g * 0.86), g * p.a.z);
	c.b = mix(c.b, c.b * 0.8, g * p.a.z);
	float l = dot(c, LW);
	c = mix(c, vec3(l), g * p.a.w);
	// --- chroma limiter for warm / foliage hues
	float mx = max(c.r, c.g), ch = (mx - c.b) / max(mx, 1e-3);
	float over = smoothstep(0.35, 0.85, ch) * step(c.b, min(c.r, c.g) + 0.02);
	l = dot(c, LW);
	c = mix(c, vec3(l), over * p.a.x);
	// --- global saturation
	l = dot(c, LW);
	c = mix(vec3(l), c, p.a.y);
	// --- mid S-curve around the pivot (lit stone up, shade down)
	l = dot(c, LW);
	float ls = clamp(l + p.b.x * (l - 0.4) * l * (1.0 - l) * 2.0, 0.0, 2.0);
	c *= ls / max(l, 1e-4);
	// --- cool shadows, multiplicative
	l = dot(c, LW);
	c *= mix(vec3(1.0), SHADOW_TINT, 1.0 - smoothstep(0.04, 0.42, l));
	// --- highlight shoulder
	l = dot(c, LW);
	if (l > p.b.y) { float e = l - p.b.y; c *= (p.b.y + e / (1.0 + e * p.b.z)) / l; }
	// --- deep shade floor
	c += BLACK_FLOOR * pow(1.0 - clamp(l, 0.0, 1.0), 12.0);
	// --- measured range: compress foliage, soft floor elsewhere
	{
		c = clamp(c, 0.0, 1.0);
		float mxc = max(c.r, max(c.g, c.b)), mnc = min(c.r, min(c.g, c.b)), dc = mxc - mnc;
		float sc = dc / max(mxc, 1e-4);
		float hc = mxc == c.r ? mod((c.g - c.b) / max(dc, 1e-4), 6.0) : (mxc == c.g ? (c.b - c.r) / max(dc, 1e-4) + 2.0 : (c.r - c.g) / max(dc, 1e-4) + 4.0);
		hc /= 6.0;
		float wf = smoothstep(0.13, 0.18, hc) * (1.0 - smoothstep(0.44, 0.5, hc)) * smoothstep(0.16, 0.28, sc);
		float l0 = dot(c, LW);
		float lf = p.leaf.x + p.leaf.y * l0;
		float k = p.leaf.z - 0.06;
		if (lf > k) { float e = lf - k; lf = k + e / (1.0 + e * 8.0); }
		float lg = sqrt(l0 * l0 + p.c.x * p.c.x);
		float lt = mix(lg, lf, wf);
		float shd = 1.0 - smoothstep(0.1, 0.42, lt);
		c *= mix(vec3(1.0), p.split_cool.rgb, shd) / mix(1.0, dot(p.split_cool.rgb, LW), shd);
		c *= lt / max(l0, 1e-4);
		c = max(mix(vec3(lt), c, 1.0 + p.leaf.w * wf), 0.0);
	}
	// --- top-edge aerial haze
	float th = smoothstep(0.42, 1.0, uv.y); th *= th * p.b.w;
	l = dot(c, LW);
	c = mix(c, vec3(l), th * 1.2);
	c = mix(c, p.haze_color.rgb, th);
	// --- optional vignette
	vec2 d = uv - 0.5;
	float v = smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
	c *= 1.0 - v * p.c.y * vec3(0.85, 1.0, 1.15);

	c = mix(c, emit, em);
	imageStore(color_image, px, vec4(to_linear(clamp(c, 0.0, 1.0)), t.a));
}
"""

func _init() -> void:
	effect_callback_type = EFFECT_CALLBACK_TYPE_POST_TRANSPARENT
	rd = RenderingServer.get_rendering_device()
	RenderingServer.call_on_render_thread(_init_compute)

func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE and rd != null and shader.is_valid():
		rd.free_rid(shader)  # frees the pipeline with it

func _init_compute() -> void:
	if rd == null:
		return
	var src := RDShaderSource.new()
	src.language = RenderingDevice.SHADER_LANGUAGE_GLSL
	src.source_compute = SRC
	var spirv := rd.shader_compile_spirv_from_source(src)
	if spirv.compile_error_compute != "":
		push_error("AovGradeEffect: " + spirv.compile_error_compute)
		return
	shader = rd.shader_create_from_spirv(spirv)
	if shader.is_valid():
		pipeline = rd.compute_pipeline_create(shader)

func _v4(v: Vector3, w := 0.0) -> Array:
	return [v.x, v.y, v.z, w]

func _render_callback(type: int, render_data: RenderData) -> void:
	if rd == null or type != EFFECT_CALLBACK_TYPE_POST_TRANSPARENT or not pipeline.is_valid():
		return
	var buffers := render_data.get_render_scene_buffers() as RenderSceneBuffersRD
	if buffers == null:
		return
	var size := buffers.get_internal_size()
	if size.x == 0 or size.y == 0:
		return
	var pc := PackedFloat32Array([size.x, size.y, exposure, grade_exposure,
		chroma_limit, saturation, green_shift, green_desat,
		mid_contrast, knee, shoulder, top_haze,
		leaf_lum.x, leaf_lum.y, leaf_lum.z, leaf_chroma,
		floor_value, vignette, sand_amt, pale])
	pc.append_array(PackedFloat32Array(_v4(top_haze_color) + _v4(split_cool) + _v4(sand)))
	var bytes := pc.to_byte_array()
	var gx := (size.x - 1) / 8 + 1
	var gy := (size.y - 1) / 8 + 1
	for view in buffers.get_view_count():
		var img := buffers.get_color_layer(view)
		var u := RDUniform.new()
		u.uniform_type = RenderingDevice.UNIFORM_TYPE_IMAGE
		u.binding = 0
		u.add_id(img)
		var uset := UniformSetCacheRD.get_cache(shader, 0, [u])
		var cl := rd.compute_list_begin()
		rd.compute_list_bind_compute_pipeline(cl, pipeline)
		rd.compute_list_bind_uniform_set(cl, uset, 0)
		rd.compute_list_set_push_constant(cl, bytes, bytes.size())
		rd.compute_list_dispatch(cl, gx, gy, 1)
		rd.compute_list_end()
