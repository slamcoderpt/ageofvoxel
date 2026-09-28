extends Node3D
## First-pass terrain renderer (foundation; the terrain piece replaces it with
## the full port of src/terrain: smoothed shores, talus, cliff relief, water
## shader, ground details, the chunk-bucketed ResourceRenderer).
##
## Heightfield: chunks of CHUNK x CHUNK terrain columns meshed in C++ by
## AovSim.build_terrain_mesh() (palette.js colours, per-vertex AO, wall foot
## AO), rebuilt only where AovSim.take_map_changes() reports edits.
## Water: a flat plane at map.waterY(). Resources: one MultiMesh per exported
## model from AovSim.get_resources(), rebuilt when resources are added or
## removed (entity events of kind 3 in game.events).

const VOXEL := 0.5
const CHUNK := 32  # columns per chunk side (16 tiles)

var game: Node = null
var _chunks := {}          # Vector2i -> MeshInstance3D
var _material: StandardMaterial3D
var _res_root: Node3D

func setup(g: Node) -> void:
	game = g
	_material = StandardMaterial3D.new()
	_material.vertex_color_use_as_albedo = true
	_material.vertex_color_is_srgb = false  # the mesher writes linear colours (JS toLin)
	_material.roughness = 0.95
	var t0 := Time.get_ticks_msec()
	var C: int = game.sim.get_map_cols()
	var n := ceili(float(C) / CHUNK)
	for cz in n:
		for cx in n:
			_build_chunk(Vector2i(cx, cz))
	game.sim.take_map_changes()  # the initial map is fully built
	_build_water()
	_res_root = Node3D.new()
	_res_root.name = "Resources"
	add_child(_res_root)
	_build_resources()
	print("terrain: %d chunks (%dx%d columns) in %d ms" % [n * n, C, C, Time.get_ticks_msec() - t0])

func frame(_dt: float, _alpha: float) -> void:
	var rects: PackedInt32Array = game.sim.take_map_changes()
	if not rects.is_empty():
		var dirty := {}
		for i in range(0, rects.size(), 4):
			# a column edit changes the AO / walls of its neighbours: pad by one
			for cz in range(floori((rects[i + 1] - 1) / float(CHUNK)), floori(rects[i + 3] / float(CHUNK)) + 1):
				for cx in range(floori((rects[i] - 1) / float(CHUNK)), floori(rects[i + 2] / float(CHUNK)) + 1):
					dirty[Vector2i(cx, cz)] = true
		for k in dirty:
			_build_chunk(k)
	for e in game.events:
		if int(e.kind) == 3 and (e.type == "entity:added" or e.type == "entity:removed"):
			_build_resources()
			break

func _build_chunk(k: Vector2i) -> void:
	var C: int = game.sim.get_map_cols()
	if k.x < 0 or k.y < 0 or k.x * CHUNK >= C or k.y * CHUNK >= C:
		return
	var arrays: Array = game.sim.build_terrain_mesh(k.x * CHUNK, k.y * CHUNK, (k.x + 1) * CHUNK, (k.y + 1) * CHUNK)
	var mi: MeshInstance3D = _chunks.get(k)
	if mi == null:
		mi = MeshInstance3D.new()
		mi.name = "Chunk_%d_%d" % [k.x, k.y]
		mi.material_override = _material
		add_child(mi)
		_chunks[k] = mi
	if arrays[Mesh.ARRAY_VERTEX] == null:
		mi.mesh = null
		return
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mi.mesh = am

func _build_water() -> void:
	var ws: float = game.sim.get_map_size()
	var water := MeshInstance3D.new()
	water.name = "Water"
	var pm := PlaneMesh.new()
	# the sea runs far past the map rim, as in src/terrain/Water.js (ws * 5, centred)
	pm.size = Vector2(ws * 5.0, ws * 5.0)
	water.mesh = pm
	water.position = Vector3(ws / 2, (game.sim.get_water_level() - 0.3) * VOXEL, ws / 2)
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.18, 0.42, 0.52, 0.78)
	wm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	wm.roughness = 0.15
	water.material_override = wm
	add_child(water)

static func _hash(x: int, z: int) -> float:
	var h := (x * 374761393 + z * 668265263) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	h ^= h >> 16
	return float(h & 0xffffff) / 16777216.0

## Resources as one MultiMesh per exported model; a quarter-turn per tile hash.
func _build_resources() -> void:
	for c in _res_root.get_children():
		c.queue_free()
	var sim: Object = game.sim
	var R: Dictionary = sim.get_resources()
	var names: PackedStringArray = R.type_names
	var types: PackedByteArray = R.type
	var tiles: PackedInt32Array = R.tile
	var variants: PackedInt32Array = R.variant
	var by_key := {}
	for i in int(R.count):
		var type := names[types[i]]
		var key: String = "tree%d" % (variants[i] % 10) if type == "tree" else type
		var size := 3.0 if type == "gold" else 1.0
		var tx := tiles[i * 2]
		var tz := tiles[i * 2 + 1]
		var x := tx + size / 2
		var z := tz + size / 2
		var rot := floorf(_hash(tx, tz + 7) * 4.0) * PI / 2
		if not by_key.has(key):
			by_key[key] = []
		by_key[key].append(Transform3D(Basis(Vector3.UP, rot), Vector3(x, sim.height_at(x, z), z)))
	for key in by_key:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = VoxelModels.mesh("resources", key)
		mm.instance_count = by_key[key].size()
		for i in mm.instance_count:
			mm.set_instance_transform(i, by_key[key][i])
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Res_" + key
		mmi.multimesh = mm
		mmi.material_override = VoxelModels.material()
		_res_root.add_child(mmi)
