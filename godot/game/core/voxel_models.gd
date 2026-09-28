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

const DIR := "res://assets/models/"
const FORMAT := 2

static var _groups := {}   # group -> {man: Dictionary, bin: PackedByteArray}
static var _meshes := {}   # "group/name" -> ArrayMesh
static var _material: ShaderMaterial = null

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
	var flags := (Mesh.ARRAY_CUSTOM_RGBA8_UNORM << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT) \
		| (Mesh.ARRAY_CUSTOM_RGBA8_UNORM << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT)
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, flags)
	am.resource_name = key
	_meshes[key] = am
	return am

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
