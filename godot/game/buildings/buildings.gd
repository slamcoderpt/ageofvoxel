extends Node3D
## Buildings renderer (port of the render side of src/buildings/index.js):
## one MeshInstance3D per building from the exported models
## (VoxelModels "buildings/<type>/<variant>", or while under construction
## "construction/<type>/<variant>/<stage 0..7>" with stage =
## floor(progress * 8)), on the terrain at the footprint centre, in the
## owner's team colour. Houses turn by their yaw and stand back by their
## setback (both computed in C++ at spawn like the JS houseYaw /
## houseSetback, exported by AovSim.get_buildings()). The sim side
## (placement, construction, destruction, the planned town) is
## native/src/sim/buildings. Town props (src/buildings/props.js) are not
## ported yet.

const PLAYER_COLORS := [0xbbbbbb, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818]
const STAGES := 8

var game: Node = null
var _nodes := {}      # id -> {mi: MeshInstance3D, key: String}
var _mats := {}       # owner -> ShaderMaterial
var _names: PackedStringArray

func setup(g: Node) -> void:
	game = g
	_names = game.sim.building_type_names()

func _material(owner: int) -> ShaderMaterial:
	if not _mats.has(owner):
		var c: int = PLAYER_COLORS[owner] if owner < PLAYER_COLORS.size() else 0xffffff
		var m := VoxelModels.team_material(Color.hex((c << 8) | 0xff))
		m.set_shader_parameter("roughness_value", 0.93)
		_mats[owner] = m
	return _mats[owner]

func frame(_dt: float, _alpha: float) -> void:
	var B: Dictionary = game.sim.get_buildings()
	var n: int = B.count
	var ids: PackedInt32Array = B.ids
	var types: PackedByteArray = B.type
	var owners: PackedByteArray = B.owner
	var rect: PackedInt32Array = B.rect
	var built: PackedByteArray = B.built
	var progress: PackedFloat32Array = B.progress
	var variant: PackedInt32Array = B.variant
	var yaw: PackedFloat32Array = B.yaw
	var setback: PackedFloat32Array = B.setback
	var seen := {}
	for i in n:
		var id: int = ids[i]
		seen[id] = true
		var type := _names[types[i]]
		var v := maxi(0, variant[i])
		var key := "%s/%d" % [type, v]
		var group := "buildings"
		if not built[i]:
			key = "%s/%d/%d" % [type, v, mini(STAGES - 1, floori(progress[i] * STAGES))]
			group = "construction"
		var e: Dictionary = _nodes.get(id, {})
		if e.is_empty():
			var mi := MeshInstance3D.new()
			mi.name = "B%d_%s" % [id, type]
			mi.material_override = _material(owners[i])
			add_child(mi)
			var x := rect[i * 4] + rect[i * 4 + 2] * 0.5
			var z := rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5
			mi.position = Vector3(x, game.sim.height_at(x, z), z)
			if type == "house":
				mi.rotation.y = yaw[i]
				mi.position.z -= setback[i]
			e = {"mi": mi, "key": ""}
			_nodes[id] = e
		if e.key != group + "/" + key:
			e.key = group + "/" + key
			e.mi.mesh = VoxelModels.mesh(group, key)
	for id in _nodes.keys():
		if not seen.has(id):
			_nodes[id].mi.queue_free()
			_nodes.erase(id)
