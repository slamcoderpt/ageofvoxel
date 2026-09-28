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
## native/src/sim/buildings. Town props (src/buildings/props.js) are in
## town_props.gd (MultiMesh per prop kind), laid out again only when the set
## of buildings or their built flags change. Buildings and props outside
## player 1's explored area are hidden (rechecked on fog_version changes).

const PLAYER_COLORS := [0xbbbbbb, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818]
const STAGES := 8
const BuildingAO = preload("res://game/buildings/building_ao.gd")

var game: Node = null
var _nodes := {}      # id -> {mi: MeshInstance3D, key: String}
var _mats := {}       # owner -> ShaderMaterial
var _names: PackedStringArray
var _props: Node3D = null
var _sig := -1          # buildings signature (ids + built), props re-layout on change
var _fog_version := -1

func setup(g: Node) -> void:
	game = g
	_names = game.sim.building_type_names()
	_props = preload("res://game/buildings/town_props.gd").new()
	_props.name = "props"
	add_child(_props)
	_props.setup(game, PLAYER_COLORS)

func _material(owner: int) -> ShaderMaterial:
	if not _mats.has(owner):
		var c: int = PLAYER_COLORS[owner] if owner < PLAYER_COLORS.size() else 0xffffff
		var m := BuildingAO.material(Color.hex((c << 8) | 0xff))
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
	var sig := n
	var fog_changed := false
	var fv: int = game.sim.fog_version()
	if fv != _fog_version:
		_fog_version = fv
		fog_changed = true
	for i in n:
		var id: int = ids[i]
		seen[id] = true
		sig = (sig * 31 + id * 2 + built[i]) & 0x3fffffff
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
			fog_changed = true
		if fog_changed:
			e.mi.visible = owners[i] == 1 or game.sim.is_explored(e.mi.position.x, e.mi.position.z)
		if e.key != group + "/" + key:
			e.key = group + "/" + key
			e.mi.mesh = BuildingAO.mesh(group, key)
	for id in _nodes.keys():
		if not seen.has(id):
			_nodes[id].mi.queue_free()
			_nodes.erase(id)
	if sig != _sig:
		_sig = sig
		_props.rebuild(_prop_buildings(B))
	else:
		_props.update_fog()

## The building list the prop layout needs, with the temple's temenos rect
## (town.js sets bld_temenos when it laid the two-step platform out; the sim
## does not export it, so it is recognised here: the planned rect north of a
## Town Center of the same owner, paved and flattened one level above it).
func _prop_buildings(B: Dictionary) -> Array:
	var out := []
	var rect: PackedInt32Array = B.rect
	var tcs := []
	for i in B.count:
		var b := {"id": B.ids[i], "type": _names[B.type[i]], "owner": B.owner[i],
			"tx": rect[i * 4], "tz": rect[i * 4 + 1], "w": rect[i * 4 + 2], "h": rect[i * 4 + 3],
			"built": B.built[i] != 0, "variant": B.variant[i], "temenos": null}
		out.append(b)
		if b.type == "town_center":
			tcs.append(b)
	var heights: PackedInt32Array = PackedInt32Array()
	var ground: PackedByteArray = PackedByteArray()
	var cols: int = game.sim.get_map_cols()
	var cps: int = cols / game.sim.get_map_size()
	for b in out:
		if b.type != "temple":
			continue
		if heights.is_empty():
			heights = game.sim.get_heights()
			ground = game.sim.get_ground()
		for tc in tcs:
			if tc.owner != b.owner:
				continue
			var t := [tc.tx + 3 - 6, tc.tz + 3 - 20, 13, 13]   # town.cpp TEMENOS
			if b.tx < t[0] or b.tz < t[1] or b.tx + b.w > t[0] + t[2] or b.tz + b.h > t[1] + t[3]:
				continue
			if t[0] < 0 or t[1] < 0 or (t[0] + t[2]) * cps > cols or (t[1] + t[3]) * cps > cols:
				continue
			var l0: int = heights[(tc.tz * cps) * cols + tc.tx * cps]
			var ok := true
			for c in [[t[0], t[1]], [t[0] + t[2] - 1, t[1]], [t[0], t[1] + t[3] - 1], [t[0] + t[2] - 1, t[1] + t[3] - 1]]:
				var k: int = (c[1] * cps) * cols + c[0] * cps
				if heights[k] != l0 + 1 or ground[k] != 4:
					ok = false
					break
			if ok:
				b.temenos = t
				break
	return out
