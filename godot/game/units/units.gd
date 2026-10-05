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
## sits under every unit. Sun shadows: unit_shadow.gdshader squashes every
## caster towards the ground under it (--unit_shadow_squash, default 0.7), so
## a man casts a compact, crisp shadow of about one body length instead of a
## long low-sun streak across his neighbours. Performance: the full voxel
## meshes cast nothing; near units cast their coarse shadow-only voxel twin
## (factor 2), far (LOD) units a box per part, same instance buffers,
## and far units use coarse voxel twins (unit LOD, see _lod_mms).
##
## Public API: `view` (the AovUnitView, shared with game/combat) and `last`
## (this frame's AovUnitView.update() result: combat draws arrows, bars,
## sparks, dust and debris from it), `draw_as(unit_id, type)` (draw and pose
## one unit with another rig, e.g. an Egyptian myth unit the sim has no type
## for yet, on a stand-in sim unit; see egypt_units_scene.gd).
##
## The Egyptian units and myth units (Godot-only) are the "egypt_units" model
## group (scripts/export-egypt-units.mjs); VoxelModels.rig() finds them by the
## sim's type key like the Greek ones.

const STRIDE := 20

var game: Node = null
var view = null            # AovUnitView
var last: Dictionary = {}
var _types: PackedStringArray
var _mms: Array[MultiMesh] = []   # flat, in AovUnitView part order
## shadow casters: coarse shadow-only voxel twins (near) / a box per part
## (far, LOD), same instance buffers as
## _mms, drawn only into the shadow map; the full part meshes cast nothing
var _shadow_mms: Array[MultiMesh] = []
## unit LOD (performance): units farther than lod_distance() from the camera
## are drawn with AovUnitView.lod_mesh() twins (2x2x2 voxels per cell, 2-4x
## fewer triangles), from AovUnitView's parts_lod buffers; --unit_lod=0 turns
## it off, --unit_lod=PX sets the on-screen voxel size (px) below which a
## unit switches (default 2.5: at 1280x720 and the stress camera nearly every
## unit, zoomed in none)
var _lod_mms: Array[MultiMesh] = []
var _shadow_lod_mms: Array[MultiMesh] = []
var lod_px := 2.5
var _shadow_mm: MultiMesh
var _aabb: AABB
## ground heights for the shadow casters' squash (unit_shadow.gdshader):
## the sim's voxel levels as int32 bytes, re-uploaded every GROUND_REFRESH s
## (buildings flatten tiles) instead of per-unit data
const GROUND_REFRESH := 1.5
var _shadow_mat: ShaderMaterial
var _ground_tex: ImageTexture
var _ground_t := 0.0

func _upload_ground() -> void:
	var cols := int(game.sim.get_map_cols())
	var h: PackedInt32Array = game.sim.get_heights()
	var img := Image.create_from_data(cols, cols, false, Image.FORMAT_RGBA8, h.to_byte_array())
	if _ground_tex == null or _ground_tex.get_width() != cols:
		_ground_tex = ImageTexture.create_from_image(img)
		_shadow_mat.set_shader_parameter("ground_tex", _ground_tex)
		_shadow_mat.set_shader_parameter("cell", float(game.sim.get_map_size()) / cols)
		_shadow_mat.set_shader_parameter("floor_level", float(game.sim.get_water_level()) - 0.3)
	else:
		_ground_tex.update(img)

## A 12-triangle box around a part mesh (its shadow caster proxy), cached.
static var _boxes := {}
static func box_mesh(mesh: Mesh) -> ArrayMesh:
	var key := mesh.resource_name
	if _boxes.has(key):
		return _boxes[key]
	var b := mesh.get_aabb()
	var v := PackedVector3Array()
	for i in 8:
		v.append(b.position + b.size * Vector3(i & 1, (i >> 1) & 1, (i >> 2) & 1))
	var idx := PackedInt32Array([0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1,
		2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = v
	arrays[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	am.resource_name = key + "#box"
	_boxes[key] = am
	return am

func _add_mm(nm: String, mesh: Mesh, mat: Material, cast: int) -> MultiMesh:
	var mm := make_mm(mesh, _aabb)
	var mmi := MultiMeshInstance3D.new()
	mmi.name = nm
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = cast
	add_child(mmi)
	return mm

## Camera distance past which a unit's 0.07 voxels are under lod_px pixels
## (0 = LOD off).
func lod_distance(cam: Camera3D) -> float:
	if lod_px <= 0.0 or cam == null:
		return 0.0
	var h := get_viewport().get_visible_rect().size.y
	return 0.07 * h / (2.0 * tan(deg_to_rad(cam.fov) * 0.5) * lod_px)

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
	lod_px = float(game.args.get("unit_lod", lod_px))
	_types = game.sim.unit_type_names()
	var size := float(game.sim.get_map_size())
	_aabb = AABB(Vector3(-16, -40, -16), Vector3(size + 32, 160, size + 32))
	var mat := ShaderMaterial.new()
	_mat = mat
	mat.shader = load("res://game/units/unit.gdshader")
	var outline := ShaderMaterial.new()
	outline.shader = load("res://game/units/unit_outline.gdshader")
	mat.next_pass = outline
	var shadow_mat := ShaderMaterial.new()
	shadow_mat.shader = load("res://game/units/unit_shadow.gdshader")
	shadow_mat.set_shader_parameter("squash", float(game.args.get("unit_shadow_squash", 0.7)))
	_shadow_mat = shadow_mat
	_upload_ground()
	var rigs := []
	for t in _types:
		var rig := VoxelModels.rig(t)
		if rig.is_empty():
			# (sim/civ) an Egyptian type with no model yet: its Greek stand-in's rig
			var si := str(game.sim.get_unit_def(t).get("stand_in", ""))
			if si != "":
				rig = VoxelModels.rig(si)
		rigs.append(rig)
		if rig.is_empty():
			continue
		_add_rig_mms(t, rig)
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
	AovScenes.set_setup("egypt_units", preload("res://game/units/egypt_units_scene.gd").scene_setup)

var _mat: ShaderMaterial
var _extra_rigs := {}   # type name -> AovUnitView rig index (draw_as)

## The MultiMeshes of one rig's parts, appended in AovUnitView part order.
func _add_rig_mms(t: String, rig: Dictionary) -> void:
	for p in rig.parts:
		var pm := VoxelModels.mesh("units", str(p.mesh))
		_mms.append(_add_mm("%s_%s" % [t, p.name], pm, _mat, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF))
		# near units cast their coarse voxel silhouette (a box per part is far
		# fatter than a shield or an arm and smears the crowd's shadows)
		_shadow_mms.append(_add_mm("%s_%s_shadow" % [t, p.name], VoxelModels.coarse(pm, 2, true), _shadow_mat, GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY))
		# far units: the coarse voxel twin (small rigs only: big ones are few and their voxels already large)
		var lm: Mesh = VoxelModels.coarse(pm) if float(rig.voxel) < 0.1 else pm
		_lod_mms.append(_add_mm("%s_%s_lod" % [t, p.name], lm, _mat, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF))
		_shadow_lod_mms.append(_add_mm("%s_%s_lod_shadow" % [t, p.name], box_mesh(pm), _shadow_mat, GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY))

## Draw (and pose) unit `unit_id` with the rig of `type_name` (a sim type or
## any rig in units.json / egypt_units.json) instead of its own type's.
## Render-only: the sim still runs the unit as its own type. False if there
## is no such rig (or the library predates AovUnitView.add_rig).
func draw_as(unit_id: int, type_name: String) -> bool:
	if view == null or not view.has_method("add_rig"):
		return false
	var ri := int(_extra_rigs.get(type_name, -1))
	if ri < 0:
		var k := _types.find(type_name)
		var rig := VoxelModels.rig(type_name)
		if rig.is_empty():
			return false
		if k >= 0 and not VoxelModels.rig(_types[k]).is_empty():
			ri = k
		else:
			ri = int(view.add_rig(rig))
			_add_rig_mms(type_name, rig)
		_extra_rigs[type_name] = ri
	view.set_rig_override(unit_id, ri)
	return true

func frame(dt: float, alpha: float) -> void:
	_ground_t += dt
	if _ground_t >= GROUND_REFRESH:
		_ground_t = 0.0
		_upload_ground()
	var cam := get_viewport().get_camera_3d()
	last = view.update(dt, alpha, 1, cam.get_frustum() if cam else [],
		cam.global_position if cam else Vector3(), lod_distance(cam))
	var bufs: Array = last.parts
	var counts: PackedInt32Array = last.part_counts
	var lbufs: Array = last.parts_lod
	var lcounts: PackedInt32Array = last.part_counts_lod
	for i in _mms.size():
		upload(_mms[i], bufs[i], counts[i])
		upload(_shadow_mms[i], bufs[i], counts[i])
		upload(_lod_mms[i], lbufs[i], lcounts[i])
		upload(_shadow_lod_mms[i], lbufs[i], lcounts[i])
	upload(_shadow_mm, last.shadows, last.shadow_count)
