class_name VoxelModels
extends RefCounted
## Loads the models exported from the browser build by
## scripts/export-models.mjs (godot/assets/models/<group>.json + .bin.gz) as
## ArrayMeshes. Vertex layout (see the exporter header):
##   VERTEX, NORMAL        float32
##   CUSTOM0 (RGBA8 unorm) sRGB albedo with the per-voxel jitter and baked AO
##   CUSTOM1 (RGBA8 unorm) r = team mask, g = glow
## Shade them with voxel.gdshader (VoxelModels.material()).
##
##   var mesh := VoxelModels.mesh("resources", "tree3")
##   var rig := VoxelModels.rig("hoplite")   # parts, joints, parents (units.json)
##   for p in rig.parts: VoxelModels.mesh("units", p.mesh)
##   var far := VoxelModels.coarse(mesh)        # 2x2x2 voxels per cell (unit LOD)
##   var caster := VoxelModels.coarse(mesh, 2, true)  # merged, for shadow-only twins

const DIR := "res://assets/models/"
const FORMAT := 2

static var _groups := {}   # group -> {man: Dictionary, bin: PackedByteArray}
static var _meshes := {}   # "group/name" -> ArrayMesh
static var _material: ShaderMaterial = null
static var _coarse := {}   # "group/name#factor" -> Mesh

## The coarse voxel twin of an exported model (performance: far unit LOD,
## cheap shadow casters): factor^3 voxels merged per cell, same vertex
## format, built in C++ (AovUnitView.lod_mesh, native/src/unit_lod.cpp),
## cached. shadow_only: whole cells and greedy-merged faces in one colour
## (for SHADOWS_ONLY instances). Returns the mesh itself if it is not a
## voxel model.
static func coarse(mesh: Mesh, factor: int = 2, shadow_only: bool = false) -> Mesh:
	var key := "%s#%d%s" % [mesh.resource_name, factor, "s" if shadow_only else ""]
	if _coarse.has(key):
		return _coarse[key]
	var out: Mesh = mesh
	if ClassDB.class_exists("AovUnitView"):
		var arrays: Array = ClassDB.class_call_static("AovUnitView", "lod_mesh", mesh.surface_get_arrays(0), factor, shadow_only)
		if not arrays.is_empty():
			var am := ArrayMesh.new()
			var flags := (Mesh.ARRAY_CUSTOM_RGBA8_UNORM << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT) \
				| (Mesh.ARRAY_CUSTOM_RGBA8_UNORM << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT)
			am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, flags)
			am.resource_name = key
			out = am
	_coarse[key] = out
	return out

static func group(g: String) -> Dictionary:
	if _groups.has(g):
		return _groups[g]
	var man_text := FileAccess.get_file_as_string(DIR + g + ".json")
	if man_text.is_empty():
		push_error("VoxelModels: missing %s%s.json (run: node scripts/export-models.mjs)" % [DIR, g])
		return {}
	var man: Dictionary = JSON.parse_string(man_text)
	if int(man.get("format", 0)) != FORMAT:
		push_error("VoxelModels: %s.json has format %s, expected %d (re-run scripts/export-models.mjs)" % [g, man.get("format"), FORMAT])
	var gz := FileAccess.get_file_as_bytes(DIR + str(man.bin))
	var bin := gz.decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP)
	if bin.size() != int(man.bytes):
		push_error("VoxelModels: %s: %d bytes, manifest says %d" % [man.bin, bin.size(), int(man.bytes)])
	var e := {"man": man, "bin": bin}
	_groups[g] = e
	return e

static func names(g: String) -> Array:
	var e := group(g)
	return e.man.models.keys() if e else []

static func info(g: String, model_name: String) -> Dictionary:
	var e := group(g)
	return e.man.models.get(model_name, {}) if e else {}

## Unit rig metadata: {voxel, anim, style, parts: [{name, anim, joint:[x,y,z] (voxels),
## parent, parentIdx, coat, portrait, conditional, mesh}]}. World offset of a
## joint = joint * voxel, relative to the parent's joint (or the feet).
static func rig(unit_type: String) -> Dictionary:
	var e := group("units")
	return e.man.rigs.get(unit_type, {}) if e else {}

static func mesh(g: String, model_name: String) -> ArrayMesh:
	var key := g + "/" + model_name
	if _meshes.has(key):
		return _meshes[key]
	var e := group(g)
	if e.is_empty() or not e.man.models.has(model_name):
		push_error("VoxelModels: no model %s" % key)
		return null
	var m: Dictionary = e.man.models[model_name]
	var bin: PackedByteArray = e.bin
	var nv := int(m.vertices)
	var ni := int(m.indices)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = bin.slice(int(m.position), int(m.position) + nv * 12).to_vector3_array()
	arrays[Mesh.ARRAY_NORMAL] = bin.slice(int(m.normal), int(m.normal) + nv * 12).to_vector3_array()
	arrays[Mesh.ARRAY_CUSTOM0] = bin.slice(int(m.color), int(m.color) + nv * 4)
	arrays[Mesh.ARRAY_CUSTOM1] = bin.slice(int(m.extra), int(m.extra) + nv * 4)
	arrays[Mesh.ARRAY_INDEX] = bin.slice(int(m.index), int(m.index) + ni * 4).to_int32_array()
	var am := ArrayMesh.new()
	add_voxel_surface(am, arrays)
	am.resource_name = key
	_meshes[key] = am
	return am

## Adds a voxel surface (VERTEX, NORMAL, CUSTOM0 / CUSTOM1 as RGBA8 bytes,
## INDEX) to am. Compatibility renderer (the web export): Godot 4.5's GLES3
## backend binds an RGBA8 custom attribute with ONE component
## (drivers/gles3/storage/mesh_storage.cpp: size = bytes / sizeof(float)), so
## every model would come out red; there CUSTOM0 / CUSTOM1 are uploaded as
## RGBA float instead (same values in the shaders).
static func add_voxel_surface(am: ArrayMesh, arrays: Array) -> void:
	var c := Mesh.ARRAY_CUSTOM_RGBA8_UNORM
	if _float_custom():
		c = Mesh.ARRAY_CUSTOM_RGBA_FLOAT
		arrays[Mesh.ARRAY_CUSTOM0] = _rgba8_to_float(arrays[Mesh.ARRAY_CUSTOM0])
		arrays[Mesh.ARRAY_CUSTOM1] = _rgba8_to_float(arrays[Mesh.ARRAY_CUSTOM1])
	var flags := (c << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT) | (c << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT)
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, flags)

## Surface 0 of a voxel mesh with CUSTOM0 / CUSTOM1 as RGBA8 bytes, whatever
## the renderer (input of AovUnitView.lod_mesh).
static func voxel_arrays(mesh: Mesh) -> Array:
	var arrays := mesh.surface_get_arrays(0)
	for k in [Mesh.ARRAY_CUSTOM0, Mesh.ARRAY_CUSTOM1]:
		if arrays[k] is PackedFloat32Array:
			var f: PackedFloat32Array = arrays[k]
			var img := Image.create_from_data(f.size() / 4, 1, false, Image.FORMAT_RGBAF, f.to_byte_array())
			img.convert(Image.FORMAT_RGBA8)
			arrays[k] = img.get_data()
	return arrays

static var _float_custom_mode := -1

static func _float_custom() -> bool:
	if _float_custom_mode < 0:
		_float_custom_mode = 1 if RenderingServer.get_current_rendering_method() == "gl_compatibility" \
			and DisplayServer.get_name() != "headless" else 0
	return _float_custom_mode == 1

static func _rgba8_to_float(b: PackedByteArray) -> PackedFloat32Array:
	if b.size() < 4:
		return PackedFloat32Array()
	var img := Image.create_from_data(b.size() / 4, 1, false, Image.FORMAT_RGBA8, b)
	img.convert(Image.FORMAT_RGBAF)   # x / 255, no colour-space change
	return img.get_data().to_float32_array()

## Shared voxel material (team colour from the `team_color` uniform, or per
## instance from MultiMesh custom data when use_instance_team is set).
static func material() -> ShaderMaterial:
	if _material == null:
		_material = ShaderMaterial.new()
		_material.shader = load("res://game/core/voxel.gdshader")
	return _material

static func team_material(color: Color, instanced := false) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load("res://game/core/voxel.gdshader")
	m.set_shader_parameter("team_color", color)
	m.set_shader_parameter("use_instance_team", instanced)
	return m
