extends RefCounted
## Building / prop meshes with a wide-radius AO baked in (buildings piece).
## VoxelModels.mesh(group, name) with AovBuildingAO.bake()'s per-vertex
## occlusion written into CUSTOM1.b (0 open .. 255 occluded; the exported
## models leave it 0), shaded by building.gdshader. Baked once per model on
## first use and cached. Without the extension class (an old web build) the
## plain mesh is returned and the shader simply adds no occlusion.
##
##   const BuildingAO = preload("res://game/buildings/building_ao.gd")
##   mi.mesh = BuildingAO.mesh("buildings", "temple/0")
##   mi.material_override = BuildingAO.material(team_colour)

const RADIUS := 1.6   # world units, the browser's GTAO radius

static var _meshes := {}
static var _shader: Shader = null

static func mesh(g: String, model_name: String) -> Mesh:
	var key := g + "/" + model_name
	if _meshes.has(key):
		return _meshes[key]
	var src: Mesh = VoxelModels.mesh(g, model_name)
	var out: Mesh = src
	if src != null and ClassDB.class_exists("AovBuildingAO"):
		var arrays := VoxelModels.voxel_arrays(src)
		var occ: PackedByteArray = ClassDB.class_call_static("AovBuildingAO", "bake", arrays, RADIUS, true)
		var c1: PackedByteArray = arrays[Mesh.ARRAY_CUSTOM1]
		if occ.size() * 4 == c1.size():
			for i in occ.size():
				c1[i * 4 + 2] = occ[i]
			arrays[Mesh.ARRAY_CUSTOM1] = c1
			var am := ArrayMesh.new()
			VoxelModels.add_voxel_surface(am, arrays)
			am.resource_name = key + "#ao"
			out = am
	_meshes[key] = out
	return out

static func material(color: Color, instanced := false) -> ShaderMaterial:
	if _shader == null:
		_shader = load("res://game/buildings/building.gdshader")
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter("team_color", color)
	m.set_shader_parameter("use_instance_team", instanced)
	return m
