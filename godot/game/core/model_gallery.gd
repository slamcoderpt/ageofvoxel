extends RefCounted
## Setup of the Godot-only "models" scene: every exported model (units in rest
## pose assembled from their rigs, buildings, props, resources, economy and
## combat models) on the flat start area of a battle map, so a capture checks
## scripts/export-models.mjs and VoxelModels end to end.
##   node scripts/godot-shoot.mjs --scene models

const TEAM_BLUE := Color8(0x2f, 0x6b, 0xff)

static func setup(game: Node) -> Dictionary:
	var root := Node3D.new()
	root.name = "ModelGallery"
	game.add_child(root)
	var s: Dictionary = game.sim.get_starts()[0]
	var cx: float = s.tx
	var cz: float = s.tz
	var sim: Object = game.sim
	var mat := VoxelModels.team_material(TEAM_BLUE)
	var put := func(mesh: Mesh, x: float, z: float, basis := Basis()) -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.material_override = mat
		mi.transform = Transform3D(basis, Vector3(x, sim.height_at(x, z), z))
		root.add_child(mi)
		return mi
	# row 1 (front): units, facing the camera (+z)
	var x := cx - 12.0
	for t in VoxelModels.group("units").man.rigs:
		_add_unit(root, mat, t, Vector3(x, sim.height_at(x, cz + 6), cz + 6))
		x += 2.6
	# row 2: buildings (variant 0)
	x = cx - 14.0
	for b in ["house", "storehouse", "farm", "temple", "barracks", "town_center"]:
		var name: String = str(b) + "/0"
		var info := VoxelModels.info("buildings", name)
		var w: float = info.aabb[3] - info.aabb[0]
		put.call(VoxelModels.mesh("buildings", name), x + w / 2, cz - 2)
		x += w + 1.0
	# row 3: resources, economy and combat props
	x = cx - 14.0
	for n in VoxelModels.names("resources"):
		if n.ends_with("_shape"):
			continue
		put.call(VoxelModels.mesh("resources", n), x, cz + 10)
		x += 1.6
	x = cx - 14.0
	for n in VoxelModels.names("economy"):
		put.call(VoxelModels.mesh("economy", n), x, cz + 12.5)
		x += 1.2
	for n in VoxelModels.names("combat"):
		put.call(VoxelModels.mesh("combat", n), x, cz + 12.5)
		x += 1.2
	# row 4 (back): town props
	x = cx - 16.0
	for n in VoxelModels.names("props"):
		var info := VoxelModels.info("props", n)
		var w: float = info.aabb[3] - info.aabb[0]
		put.call(VoxelModels.mesh("props", n), x + w / 2, cz - 9)
		x += w + 0.6
	return {"focus": Vector2(cx, cz + 3)}

## Rest pose: world(part) = world(parent) * translate(joint * voxel); only the
## parts a portrait shows (the default gear).
static func _add_unit(root: Node3D, mat: Material, unit_type: String, pos: Vector3) -> void:
	var rig := VoxelModels.rig(unit_type)
	var V: float = rig.voxel
	var world: Array[Transform3D] = []
	for p in rig.parts:
		var local := Transform3D(Basis(), Vector3(p.joint[0], p.joint[1], p.joint[2]) * V)
		var parent := Transform3D(Basis(), pos) if int(p.parentIdx) < 0 else world[int(p.parentIdx)]
		var w := parent * local
		world.append(w)
		if p.conditional and not p.portrait:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = VoxelModels.mesh("units", p.mesh)
		mi.material_override = mat
		mi.transform = w
		root.add_child(mi)
