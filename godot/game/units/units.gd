extends Node3D
## Units renderer (port of the render side of src/units/index.js + anim.js).
##
## Every unit is its exported voxel part rig (VoxelModels.rig), one
## MultiMesh per (type, part). The poses (src/units/anim.js pose(): walk,
## gather, build, worship, the per-style attacks, hit reactions, deaths, idle
## fidgets and battle-line guards), the root transform (crowd yaw and melee
## press, slot jitter, death topple / flattening / corpse sink, god power
## tumble, the combat stagger lean), the conditional parts (tools, loads,
## per-soldier kit) and the per-instance colours (crushed team dye, corpses
## drained to grey, hit flash, corpse fade) are computed in C++ by
## AovUnitView (native/src/unit_view.cpp) in one call per frame, which
## returns ready MultiMesh buffers: no per-unit script work.
##
## Shading: unit.gdshader (voxel albedo x team x coat tint, team lift and rim,
## hit flash, corpses desaturated, dithered fade) with unit_outline.gdshader
## as next pass (the dark inverted-hull silhouette). A contact shadow disc
## sits under every unit.
##
## Public API: `view` (the AovUnitView, shared with game/combat) and `last`
## (this frame's AovUnitView.update() result: combat draws arrows, bars,
## sparks, dust and debris from it).

const STRIDE := 20

var game: Node = null
var view = null            # AovUnitView
var last: Dictionary = {}
var _types: PackedStringArray
var _mms: Array[MultiMesh] = []   # flat, in AovUnitView part order
var _shadow_mm: MultiMesh
var _aabb: AABB

static func make_mm(mesh: Mesh, aabb: AABB) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = mesh
	mm.custom_aabb = aabb
	mm.instance_count = 0
	return mm

## Upload one AovUnitView buffer (zero-padded to a power-of-two capacity).
static func upload(mm: MultiMesh, buf: PackedFloat32Array, n: int) -> void:
	var cap := buf.size() / STRIDE
	if n == 0 and mm.instance_count == 0:
		return
	if mm.instance_count != cap:
		mm.instance_count = cap
	mm.buffer = buf
	mm.visible_instance_count = n

func setup(g: Node) -> void:
	game = g
	_types = game.sim.unit_type_names()
	var size := float(game.sim.get_map_size())
	_aabb = AABB(Vector3(-16, -40, -16), Vector3(size + 32, 160, size + 32))
	var mat := ShaderMaterial.new()
	mat.shader = load("res://game/units/unit.gdshader")
	var outline := ShaderMaterial.new()
	outline.shader = load("res://game/units/unit_outline.gdshader")
	mat.next_pass = outline
	var rigs := []
	for t in _types:
		var rig := VoxelModels.rig(t)
		rigs.append(rig)
		if rig.is_empty():
			continue
		for p in rig.parts:
			var mm := make_mm(VoxelModels.mesh("units", str(p.mesh)), _aabb)
			var mmi := MultiMeshInstance3D.new()
			mmi.name = "%s_%s" % [t, p.name]
			mmi.multimesh = mm
			mmi.material_override = mat
			add_child(mmi)
			_mms.append(mm)
	# contact shadows
	var plane := PlaneMesh.new()
	plane.size = Vector2(1, 1)
	_shadow_mm = make_mm(plane, _aabb)
	var smi := MultiMeshInstance3D.new()
	smi.name = "ContactShadows"
	smi.multimesh = _shadow_mm
	smi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var smat := ShaderMaterial.new()
	smat.shader = load("res://game/units/contact_shadow.gdshader")
	smat.render_priority = -1
	smi.material_override = smat
	add_child(smi)
	view = ClassDB.instantiate("AovUnitView")
	view.setup(game.sim, rigs)

func frame(dt: float, alpha: float) -> void:
	var cam := get_viewport().get_camera_3d()
	last = view.update(dt, alpha, 1, cam.get_frustum() if cam else [])
	var bufs: Array = last.parts
	var counts: PackedInt32Array = last.part_counts
	for i in _mms.size():
		upload(_mms[i], bufs[i], counts[i])
	upload(_shadow_mm, last.shadows, last.shadow_count)
