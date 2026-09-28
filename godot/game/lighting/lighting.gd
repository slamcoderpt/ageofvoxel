extends Node3D
## PLACEHOLDER lighting written by the foundation (the lighting piece replaces
## it with the port of src/lighting: soft sun shadows, hemisphere + fill, sky
## dome, haze, GTAO/bloom/grade, quality levels). Same sun direction as the
## browser: towards the sun = normalize(-0.6, 0.47, 0.4).

const SUN_DIR := Vector3(-0.6, 0.47, 0.4)
const HAZE := Color8(0xc6, 0xce, 0xd3)

var game: Node = null
var sun: DirectionalLight3D

func setup(g: Node) -> void:
	game = g
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color = Color8(0xff, 0xd9, 0xa0)
	sun.light_energy = 2.2
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 160.0
	sun.shadow_opacity = 0.88
	add_child(sun)
	sun.basis = Basis.looking_at(-SUN_DIR.normalized(), Vector3.UP)

	var fill := DirectionalLight3D.new()
	fill.name = "Fill"
	fill.light_color = Color8(0xa4, 0xc0, 0xe0)
	fill.light_energy = 0.2
	add_child(fill)
	fill.basis = Basis.looking_at(-Vector3(0.6, 0.5, -0.5).normalized(), Vector3.UP)

	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = HAZE
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color8(0x9e, 0xc4, 0xea).lerp(Color8(0x6e, 0x6a, 0x52), 0.4)
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.0
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_light_color = HAZE
	env.fog_depth_begin = 80.0
	env.fog_depth_end = 400.0
	var we := WorldEnvironment.new()
	we.name = "Environment"
	we.environment = env
	add_child(we)
