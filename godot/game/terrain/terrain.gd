extends Node3D
## PLACEHOLDER terrain renderer written by the foundation so captures show the
## generated heightfield. The terrain piece replaces it with the real port of
## src/terrain (chunked voxel mesh with per-vertex AO, ground palette noise,
## water shader, resources, ground details).
##
## One block column per map column (VOXEL = 0.5 world units, level * 0.5
## high), top colour from the ground type (palette.js GROUND_COLORS), exposed
## side faces, and a flat water plane at map.waterY().

const VOXEL := 0.5
const GROUND_COLORS := {
	0: [Color8(0x44, 0x72, 0x2a), Color8(0x78, 0x98, 0x38)],  # grass
	1: [Color8(0x9a, 0x74, 0x47), Color8(0xb5, 0x8b, 0x58)],  # dirt
	2: [Color8(0xd9, 0xc4, 0x8c), Color8(0xe8, 0xd7, 0xa3)],  # sand
	3: [Color8(0x80, 0x7b, 0x6b), Color8(0xa2, 0x9c, 0x86)],  # rock
	4: [Color8(0xc9, 0xbe, 0xa3), Color8(0xd9, 0xd0, 0xb8)],  # paved
	5: [Color8(0x6d, 0x4a, 0x2c), Color8(0x80, 0x59, 0x3a)],  # farm
	6: [Color8(0x7f, 0x91, 0x3c), Color8(0xa1, 0x9f, 0x50)],  # dry grass
}
const SIDE_DIRT := Color8(0x8a, 0x65, 0x40)
const SIDE_ROCK := Color8(0x74, 0x6a, 0x5e)

var game: Node = null

func setup(g: Node) -> void:
	game = g
	build()

static func _hash(x: int, z: int) -> float:
	var h := (x * 374761393 + z * 668265263) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	h ^= h >> 16
	return float(h & 0xffffff) / 16777216.0

func build() -> void:
	for c in get_children():
		c.queue_free()
	var sim: Object = game.sim
	var C: int = sim.get_map_cols()
	var W: int = sim.get_water_level()
	var hs: PackedInt32Array = sim.get_heights()
	var gr: PackedByteArray = sim.get_ground()
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var quad := func(a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3, col: Color) -> void:
		var base := verts.size()
		verts.append(a); verts.append(b); verts.append(c); verts.append(d)
		for k in 4:
			norms.append(n)
			cols.append(col)
		# clockwise front faces (Godot)
		idx.append(base); idx.append(base + 2); idx.append(base + 1)
		idx.append(base); idx.append(base + 3); idx.append(base + 2)
	for cz in C:
		for cx in C:
			var i := cz * C + cx
			var l := hs[i]
			var y := l * VOXEL
			var x0 := cx * VOXEL
			var z0 := cz * VOXEL
			var x1 := x0 + VOXEL
			var z1 := z0 + VOXEL
			var pair: Array = GROUND_COLORS.get(gr[i], GROUND_COLORS[0])
			var top: Color = pair[0].lerp(pair[1], _hash(cx >> 3, cz >> 3) * 0.6 + _hash(cx, cz) * 0.4)
			quad.call(Vector3(x0, y, z0), Vector3(x0, y, z1), Vector3(x1, y, z1), Vector3(x1, y, z0), Vector3.UP, top)
			var side := SIDE_ROCK if gr[i] == 3 else SIDE_DIRT
			# +x, -x, +z, -z neighbours lower than this column: emit the drop
			for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
				var nx: int = cx + d[0]
				var nz: int = cz + d[1]
				var nl := -4
				if nx >= 0 and nz >= 0 and nx < C and nz < C:
					nl = hs[nz * C + nx]
				if nl >= l:
					continue
				var yb := nl * VOXEL
				var shade := side.darkened(0.12 if l - nl > 2 else 0.0)
				if d[0] == 1:
					quad.call(Vector3(x1, yb, z0), Vector3(x1, y, z0), Vector3(x1, y, z1), Vector3(x1, yb, z1), Vector3.RIGHT, shade)
				elif d[0] == -1:
					quad.call(Vector3(x0, yb, z1), Vector3(x0, y, z1), Vector3(x0, y, z0), Vector3(x0, yb, z0), Vector3.LEFT, shade)
				elif d[1] == 1:
					quad.call(Vector3(x1, yb, z1), Vector3(x1, y, z1), Vector3(x0, y, z1), Vector3(x0, yb, z1), Vector3.BACK, shade)
				else:
					quad.call(Vector3(x0, yb, z0), Vector3(x0, y, z0), Vector3(x1, y, z0), Vector3(x1, yb, z0), Vector3.FORWARD, shade)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = norms
	arrays[Mesh.ARRAY_COLOR] = cols
	arrays[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.vertex_color_is_srgb = true
	mat.roughness = 0.95
	var mi := MeshInstance3D.new()
	mi.name = "Heightfield"
	mi.mesh = am
	mi.material_override = mat
	add_child(mi)
	# water
	var ws: float = sim.get_map_size()
	var water := MeshInstance3D.new()
	water.name = "Water"
	var pm := PlaneMesh.new()
	pm.size = Vector2(ws, ws)
	water.mesh = pm
	water.position = Vector3(ws / 2, (W - 0.3) * VOXEL, ws / 2)
	var wm := StandardMaterial3D.new()
	wm.albedo_color = Color(0.18, 0.42, 0.52, 0.78)
	wm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	wm.roughness = 0.15
	water.material_override = wm
	add_child(water)
	_build_resources()
	print("terrain: %d columns, %d vertices" % [C * C, verts.size()])

## Initial resource spawns (trees, gold mines, berry bushes) as one MultiMesh
## per exported model; a quarter-turn per tile hash. Placeholder for the
## instanced, chunk-bucketed ResourceRenderer port.
func _build_resources() -> void:
	var sim: Object = game.sim
	var by_key := {}
	for r in sim.get_resource_spawns():
		var key: String = "tree%d" % (int(r.variant) % 10) if r.type == "tree" else str(r.type)
		var size := 3.0 if r.type == "gold" else 1.0
		var x: float = r.tx + size / 2
		var z: float = r.tz + size / 2
		var rot := floorf(_hash(r.tx, r.tz + 7) * 4.0) * PI / 2
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
		add_child(mmi)
