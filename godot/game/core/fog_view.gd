class_name AovFogView
extends MeshInstance3D
## Fog-of-war shading for the local player (the JS applyFogOfWar + FogOfWar
## texture): one full-screen quad under the camera running
## fog_of_war.gdshader. The sim's fog grid (AovSim.get_fog(), size*size bytes)
## is uploaded only when AovSim.fog_version() changes (a few times a second);
## nothing per entity. Hidden while the whole map is visible (reveal_all), so
## harness scenes with the map revealed pay nothing. Enemy units / buildings
## in the fog are hidden by their own renderers.

const Shader_ := preload("res://game/core/fog_of_war.gdshader")
# JS render(): THREE.Fog(dist * hazeNear, dist * hazeFar + 30), as the
# lighting piece's depth haze (lighting.gd HAZE_NEAR / HAZE_FAR)
const HAZE_NEAR := 0.9
const HAZE_FAR := 2.6

var sim: Object
var cam: Camera3D
var _mat: ShaderMaterial
var _tex: ImageTexture
var _ver := -1
var _n := 0

func _init(p_sim: Object, p_cam: Camera3D) -> void:
	sim = p_sim
	cam = p_cam
	name = "FogOfWar"
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	mesh = q
	_mat = ShaderMaterial.new()
	_mat.shader = Shader_
	_mat.render_priority = Material.RENDER_PRIORITY_MAX
	# black under the haze, graded to the browser's unexplored (22, 31, 25)
	_mat.set_shader_parameter("dark", Color(0.032, 0.043, 0.04))
	# the haze over it, dimmed to the browser's far unexplored (59, 69, 69)
	_mat.set_shader_parameter("haze", Color(0.30, 0.305, 0.30))
	material_override = _mat
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	visible = false

func update() -> void:
	if sim == null:
		return
	var v := int(sim.fog_version())
	if v != _ver:
		_ver = v
		var n := int(sim.get_map_size())
		var data: PackedByteArray = sim.get_fog()
		if data.size() != n * n:
			visible = false
			return
		visible = data.count(255) != data.size()
		if not visible:
			return
		var img := Image.create_from_data(n, n, false, Image.FORMAT_L8, data)
		if _tex == null or n != _n:
			_n = n
			_tex = ImageTexture.create_from_image(img)
			_mat.set_shader_parameter("fog_tex", _tex)
			_mat.set_shader_parameter("world_size", float(n))
		else:
			_tex.update(img)
	if visible and cam:
		var d := float(cam.get("distance")) if cam.get("distance") != null else 42.0
		_mat.set_shader_parameter("haze_begin", d * HAZE_NEAR)
		_mat.set_shader_parameter("haze_end", d * HAZE_FAR + 30.0)
		var t = cam.get("target")
		if t is Vector3:
			_mat.set_shader_parameter("ground_y", t.y)
