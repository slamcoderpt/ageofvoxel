extends Node3D
## Economy renderer (port of src/economy/EconomyView.js + EconomyRenderer.js):
## animals and carcasses, thrown spears, fish shoals and fishing boats, crops
## on farms (with the harvest front sweeping the rows), stockpiles beside
## the drop-off buildings, oversized loads on walking villagers and the
## scenes' field dressing: one MultiMesh per exported "economy/<key>" model.
##
## Plus Godot-only activity effects (the browser has none): wood chips and
## sawdust off the axes, ore, gold glints and dust off the picks (timed to
## the units' gather swing), straw chaff off the sickles, leaves off the
## berry bushes, hoof dust behind running game, ripples over the shoals,
## splashes and drops where fish leap, net ripples and boat wakes. And the
## crops sway in a wind wave rolling across the fields (econ_voxel.gdshader).
##
## Every buffer is built in C++ by AovEconView (native/src/econ_view.cpp) in
## one call per frame: no per-entity script work. The sim side is
## native/src/sim/economy. Also registers the "economy" scene setup
## (EconomyScene.js, run in C++).
##
## Public API: `view` (the AovEconView).

const PROP_STRIDE := 16
const FX_STRIDE := 20
const KEYS := ["deer", "boar", "spear", "fish", "boat", "wheat0", "wheat1", "wheat2", "fence", "hay", "sheaf", "sack",
	"amphora", "logs", "goldpile", "cart", "crate_grain", "crate_apples", "crate_grapes", "crate_fish", "crate_gold",
	"load_sheaf", "load_ore", "load_log", "load_haunch", "load_basket"]
const CROPS := ["wheat0", "wheat1", "wheat2"]

var game: Node = null
var view = null   # AovEconView
var _mms: Array[MultiMesh] = []
var _chips: MultiMesh
var _puffs: MultiMesh
var _rings: MultiMesh

func _init() -> void:
	# a static function: a lambda would keep this node alive in AovScenes'
	# static registry past its free (use-after-free at engine shutdown)
	AovScenes.set_setup("economy", _economy_setup)

## The "economy" scene (src/economy/EconomyScene.js), ported to C++
## (native/src/sim/scenes); its after() runs from main.gd.
static func _economy_setup(g: Node) -> Dictionary:
	return g.sim.setup_scene("economy")

func _mm(mesh: Mesh, colors: bool, aabb: AABB) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.use_custom_data = true
	mm.mesh = mesh
	mm.custom_aabb = aabb
	mm.instance_count = 0
	return mm

func _instance(mm: MultiMesh, mat: Material, node_name: String, shadow: bool) -> void:
	var mmi := MultiMeshInstance3D.new()
	mmi.name = node_name
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)

func setup(g: Node) -> void:
	game = g
	var size := float(game.sim.get_map_size())
	var aabb := AABB(Vector3(-16, -40, -16), Vector3(size + 32, 160, size + 32))
	var mat := ShaderMaterial.new()
	mat.shader = load("res://game/economy/econ_voxel.gdshader")
	var crop_mat := ShaderMaterial.new()
	crop_mat.shader = mat.shader
	crop_mat.set_shader_parameter("sway", 0.035)
	crop_mat.set_shader_parameter("crop_ao", 0.32)
	for key in KEYS:
		var mm := _mm(VoxelModels.mesh("economy", key), false, aabb)
		_mms.append(mm)
		_instance(mm, crop_mat if key in CROPS else mat, "Econ_" + key, key != "wheat0")

	var chip_mat := ShaderMaterial.new()
	chip_mat.shader = load("res://game/economy/fx_chip.gdshader")
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	_chips = _mm(box, true, aabb)
	_instance(_chips, chip_mat, "EconFx_chips", false)

	var puff_mat := ShaderMaterial.new()
	puff_mat.shader = load("res://game/economy/fx_puff.gdshader")
	puff_mat.render_priority = 2
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	_puffs = _mm(quad, true, aabb)
	_instance(_puffs, puff_mat, "EconFx_puffs", false)

	var ring_mat := ShaderMaterial.new()
	ring_mat.shader = load("res://game/economy/fx_ring.gdshader")
	ring_mat.render_priority = 3   # after the water surface
	var plane := PlaneMesh.new()
	plane.size = Vector2(2, 2)
	_rings = _mm(plane, true, aabb)
	_instance(_rings, ring_mat, "EconFx_rings", false)

	view = ClassDB.instantiate("AovEconView")
	view.setup(game.sim, PackedStringArray(KEYS))

## Upload one AovEconView buffer (zero-padded to a power-of-two capacity).
static func _upload(mm: MultiMesh, buf: PackedFloat32Array, n: int, stride: int) -> void:
	if n == 0 and mm.visible_instance_count == 0:
		return
	var cap := buf.size() / stride
	if mm.instance_count != cap:
		mm.instance_count = cap
	mm.buffer = buf
	mm.visible_instance_count = n

func frame(_dt: float, alpha: float) -> void:
	# (performance: props off screen are culled in C++, shadow margin included)
	var cam := get_viewport().get_camera_3d()
	var d: Dictionary = view.update(alpha, game.paused, 1, cam.get_frustum() if cam else [])
	var props: Array = d.props
	var counts: PackedInt32Array = d.counts
	for k in _mms.size():
		_upload(_mms[k], props[k], counts[k], PROP_STRIDE)
	_upload(_chips, d.chips, d.chip_count, FX_STRIDE)
	_upload(_puffs, d.puffs, d.puff_count, FX_STRIDE)
	_upload(_rings, d.rings, d.ring_count, FX_STRIDE)
