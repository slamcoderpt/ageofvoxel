extends Node3D
## Lighting and post (port of src/lighting: index.js, Sky.js, PostFX.js).
## Owns the WorldEnvironment, the sun and fill lights, shadows, ambient
## (hemisphere) light, sky, aerial haze, SSAO and the final tone map + grade.
## Other pieces never touch environment or viewport render settings.
##
## Args: --quality=high|medium|low (like ?quality=), --post=high|low|off
## (like ?post=: off = plain AgX tonemap, no grade, no AO).
##
## Public API (for scenes, god powers, ui):
##   sun: DirectionalLight3D, fill: DirectionalLight3D, env: Environment
##   grade: the tone map / grade CompositorEffect (null without post): its
##          properties (exposure, saturation, vignette, top_haze, ...) are the
##          JS grade uniforms and can be eased per frame
##   set_quality(q: String)          high | medium | low, live
##   SUN_DIR                         towards the sun (normalized in use)
##
## Light units: three.js (r155+) divides direct and ambient light by PI in its
## Lambert BRDF, Godot does not, so every JS intensity is divided by PI here and
## the JS exposure (2.45, PBR Neutral) is applied in the grade pass.

const Settings := preload("res://game/ui/settings.gd")
const GradeEffect := preload("res://game/lighting/grade_effect.gd")
const SkyShader := preload("res://game/lighting/sky.gdshader")

## towards the sun, ~31 deg elevation: golden late afternoon (JS sunDir)
const SUN_DIR := Vector3(-0.6, 0.47, 0.4)
const HAZE := Color8(0xc6, 0xce, 0xd3)  # cool, low-contrast air
const HAZE_NEAR := 0.9  # x camera distance (JS hazeNear)
const HAZE_FAR := 2.6
const HEMI := 1.05  # hemisphere intensity (JS)

## Medium and low render the 3D world below native resolution, so they keep
## the 4096 shadow map (at 2048 with 2 cascades the flat ground showed diagonal
## shadow-acne stripes) and use FXAA instead of MSAA: MSAA together with a 3D
## scale below 1 broke the fog-of-war pass (the whole world drew as unexplored).
const QUALITY := {
	"high": {"msaa": Viewport.MSAA_4X, "ao": true, "shadow": 4096, "splits": 4, "soft": RenderingServer.SHADOW_QUALITY_SOFT_HIGH, "scale": 1.0},
	"medium": {"msaa": Viewport.MSAA_DISABLED, "fxaa": true, "ao": true, "shadow": 4096, "splits": 2, "soft": RenderingServer.SHADOW_QUALITY_SOFT_LOW, "scale": 0.75},
	"low": {"msaa": Viewport.MSAA_DISABLED, "fxaa": true, "ao": false, "shadow": 4096, "splits": 2, "soft": RenderingServer.SHADOW_QUALITY_HARD, "scale": 0.6},
}

var game: Node = null
var sun: DirectionalLight3D
var fill: DirectionalLight3D
var env: Environment
var grade = null  # GradeEffect
var quality := "high"
var post := "high"
var _fow := false
var _sky_mat: ShaderMaterial
var hemi_lights: Array[DirectionalLight3D] = []

func setup(g: Node) -> void:
	game = g
	var args: Dictionary = g.args if "args" in g else {}
	post = str(args.get("post", "high"))
	# the Compatibility renderer (web) has no compositor effects
	if RenderingServer.get_rendering_device() == null and post != "off":
		post = "low_compat"
	var sd: Dictionary = g.scene_def if "scene_def" in g and g.scene_def is Dictionary else {}
	_fow = AovArgs.flag(args, "fog", not bool(sd.get("reveal_all", false)))
	var sdir := SUN_DIR.normalized()

	# Sun: golden late-afternoon light (~5000K); it carries all of the frame's
	# warmth (the grade adds none).
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = Color8(0xff, 0xd9, 0xa0)
	sun.light_energy = 5.2 / PI
	sun.shadow_enabled = true
	# cast shadows are not opaque slabs: some sun still reaches them (JS
	# shadow.intensity 0.88; a little more leak here stands in for the JS warm
	# ground bounce): shade stays light and warm, cobbles readable
	sun.shadow_opacity = 0.8
	sun.shadow_bias = 0.03
	sun.shadow_normal_bias = 0.6
	sun.shadow_blur = 1.4
	# PCSS: the penumbra widens with the caster's distance (the JS cheap PCSS:
	# crisp contact at wall bases, soft roof-edge shadows)
	sun.light_angular_distance = 1.0
	sun.directional_shadow_blend_splits = true
	sun.directional_shadow_fade_start = 0.9
	sun.directional_shadow_split_1 = 0.12
	sun.directional_shadow_split_2 = 0.3
	sun.directional_shadow_split_3 = 0.55
	add_child(sun)
	sun.basis = Basis.looking_at(-sdir, Vector3.UP)

	# soft cool bounce from the opposite side, no shadows
	fill = DirectionalLight3D.new()
	fill.name = "Fill"
	fill.light_color = Color8(0xa4, 0xc0, 0xe0)
	fill.light_energy = 0.3 / PI
	fill.light_specular = 0.0
	add_child(fill)
	fill.basis = Basis.looking_at(-Vector3(0.6, 0.5, -0.5).normalized(), Vector3.UP)

	_sky_mat = ShaderMaterial.new()
	_sky_mat.shader = SkyShader
	_sky_mat.set_shader_parameter("sun_dir", sdir)
	var sky := Sky.new()
	sky.sky_material = _sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_32  # nothing reads it (no sky ambient or reflections)

	env = Environment.new()
	env.sky = sky
	# with fog of war on, everything beyond the explored map reads black (AoM)
	env.background_mode = Environment.BG_COLOR if _fow else Environment.BG_SKY
	env.background_color = Color.BLACK
	# Hemisphere light (JS HemisphereLight 0x9ec4ea / 0x6e6a52, 0.85):
	# irradiance(n) = mix(ground, sky, 0.5 n.y + 0.5) = avg + (sky - ground) / 2 * n.y.
	# The constant half is the ambient colour; the n.y half is an unshadowed
	# light straight down (and a negative one straight up for faces turned to
	# the ground). Works the same in every renderer, SSAO darkens the ambient.
	var hs := Color8(0x9e, 0xc4, 0xea).srgb_to_linear()
	var hg := Color8(0x6e, 0x6a, 0x52).srgb_to_linear()
	var avg := (hs + hg) * 0.5
	var half := Color((hs.r - hg.r) * 0.5, (hs.g - hg.g) * 0.5, (hs.b - hg.b) * 0.5)
	var hk := maxf(half.r, maxf(half.g, half.b))
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(avg.r, avg.g, avg.b).linear_to_srgb()
	env.ambient_light_energy = HEMI / PI
	for i in 2:
		var h := DirectionalLight3D.new()
		h.name = "HemiSky" if i == 0 else "HemiGround"
		h.light_color = Color(half.r / hk, half.g / hk, half.b / hk).linear_to_srgb()
		h.light_energy = hk * HEMI / PI * (1.0 if i == 0 else -1.0)
		h.light_specular = 0.0
		h.sky_mode = DirectionalLight3D.SKY_MODE_LIGHT_ONLY
		add_child(h)
		h.basis = Basis.looking_at(Vector3.DOWN if i == 0 else Vector3.UP, Vector3.FORWARD)
		hemi_lights.append(h)
	env.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED

	# Aerial haze: starts just past the view centre (updated per frame from the
	# camera distance) so the top of an RTS frame recedes while the town stays clean.
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_color = HAZE
	env.fog_light_energy = 1.0
	env.fog_density = 0.55
	env.fog_sun_scatter = 0.0
	env.fog_sky_affect = 0.0
	env.fog_depth_curve = 1.0
	env.fog_depth_begin = 80.0
	env.fog_depth_end = 400.0

	# Ambient occlusion (the JS GTAO: radius 1.6, blended 0.6 into the whole colour)
	env.ssao_radius = 1.6
	env.ssao_intensity = 2.8
	env.ssao_power = 1.6
	env.ssao_detail = 0.6
	env.ssao_horizon = 0.06
	env.ssao_sharpness = 0.98
	env.ssao_light_affect = 0.45
	env.ssao_ao_channel_affect = 0.0

	# JS bloom is 0.05 strength above 0.98: effectively off. Emissive glow
	# voxels stay crisp; no Godot glow (it would land after the grade).
	env.glow_enabled = false

	if post == "high" or post == "low":
		grade = GradeEffect.new()
		var comp := Compositor.new()
		comp.compositor_effects = [grade]
		env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
		env.tonemap_exposure = 1.0
		env.tonemap_white = 1.0
		var we := WorldEnvironment.new()
		we.name = "Environment"
		we.environment = env
		we.compositor = comp
		add_child(we)
	else:
		env.tonemap_mode = Environment.TONE_MAPPER_AGX
		env.tonemap_exposure = 2.0
		env.adjustment_enabled = true
		env.adjustment_saturation = 0.9
		var we2 := WorldEnvironment.new()
		we2.name = "Environment"
		we2.environment = env
		add_child(we2)

	# interactive play remembers the Graphics choice (settings card);
	# captures and benches (--out / --quit) always start from --quality or high
	var q := "high"
	if not args.has("out") and not AovArgs.flag(args, "quit", false):
		q = str(Settings.read("graphics", "quality", "high"))
	set_quality(str(args.get("quality", q)))
	frame(0.0, 1.0)

## Switch quality level live: MSAA, AO, shadow map size and filter, 3D resolution.
func set_quality(q: String) -> void:
	if not QUALITY.has(q):
		q = "high"
	quality = q
	var Q: Dictionary = QUALITY[q]
	var vp := get_viewport()
	if vp:
		vp.msaa_3d = Q.msaa
		vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if Q.get("fxaa", false) else Viewport.SCREEN_SPACE_AA_DISABLED
		vp.use_debanding = true
		# 3D resolution (the HUD stays sharp): medium and low render the world
		# below native resolution, the big saving on HiDPI / Retina screens.
		# FSR 1 upscales on Forward+; the web's Compatibility renderer only
		# has bilinear.
		vp.scaling_3d_scale = Q.scale
		var fsr := RenderingServer.get_current_rendering_method() == "forward_plus"
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if fsr and Q.scale < 1.0 else Viewport.SCALING_3D_MODE_BILINEAR
	RenderingServer.directional_shadow_atlas_set_size(Q.shadow, true)
	RenderingServer.directional_soft_shadow_filter_set_quality(Q.soft)
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if Q.splits == 4 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.light_angular_distance = 1.0 if Q.soft != RenderingServer.SHADOW_QUALITY_HARD else 0.0
	# (post=low: no AO, as the JS PostFX without GTAO)
	env.ssao_enabled = Q.ao and post == "high"

## Per frame: shadow range and haze follow the camera distance.
func frame(_dt: float, _alpha: float) -> void:
	var cam = game.camera if game else null
	if cam == null:
		return
	var dist: float = cam.distance
	# the shadow must reach the far (top) edge of an RTS frame; splits keep the
	# focal area sharp
	sun.directional_shadow_max_distance = maxf(60.0, dist * 2.6 + 30.0)
	# aerial perspective, as THREE.Fog(near, far) in the JS render()
	env.fog_depth_begin = dist * HAZE_NEAR
	env.fog_depth_end = dist * HAZE_FAR + 30.0
