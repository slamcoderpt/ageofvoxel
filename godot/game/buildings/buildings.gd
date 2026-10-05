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
const Walls = preload("res://game/buildings/walls.gd")
const Towers = preload("res://game/buildings/towers.gd")
const TowerScene = preload("res://game/buildings/tower_scene.gd")
const TechBuildings = preload("res://game/buildings/tech_buildings.gd")
const EgyptBuildings = preload("res://game/buildings/egypt_buildings.gd")

var game: Node = null
var _nodes := {}      # id -> {mi: MeshInstance3D, key: String}
var _mats := {}       # owner -> ShaderMaterial
var _names: PackedStringArray
var _props: Node3D = null
var _sig := -1          # buildings signature (ids + built), props re-layout on change
var _model_of := {}     # type -> the model type drawn (sim/civ: an Egyptian type with no model yet -> its Greek stand-in; "" = a placeholder block)
var _fog_version := -1
var walls: Node3D = null   # walls.gd: walls and gates (sim types "*wall*" / "*gate*", or walls.set_static())
var towers: Node3D = null  # towers.gd: the sim's "tower" rows, one model per upgrade stage
var techb: Node3D = null   # tech_buildings.gd: the Armory and the Market ("armory" / "market" rows, set_static())
var egypt: Node3D = null   # egypt_buildings.gd: every Egyptian owner's building with a model (egypt.owns()), set_static()

func setup(g: Node) -> void:
	game = g
	_names = game.sim.building_type_names()
	_props = preload("res://game/buildings/town_props.gd").new()
	_props.name = "props"
	add_child(_props)
	_props.setup(game, PLAYER_COLORS)
	walls = Walls.new()
	walls.name = "walls"
	add_child(walls)
	walls.setup(game, PLAYER_COLORS)
	AovScenes.set_setup("walls", Walls.scene_setup)
	AovScenes.set_setup("wall_angles", preload("res://game/buildings/wall_angles_scene.gd").scene_setup)
	towers = Towers.new()
	towers.name = "towers"
	add_child(towers)
	towers.setup(game, PLAYER_COLORS)
	AovScenes.set_setup("towers", TowerScene.scene_setup)
	techb = TechBuildings.new()
	techb.name = "techbuildings"
	add_child(techb)
	techb.setup(game, PLAYER_COLORS)
	AovScenes.set_setup("techbuildings", preload("res://game/buildings/techbuildings_scene.gd").scene_setup)
	egypt = EgyptBuildings.new()
	egypt.name = "egypt"
	add_child(egypt)
	egypt.setup(game, PLAYER_COLORS)
	techb.egypt = egypt
	AovScenes.set_setup("egypt_town", preload("res://game/buildings/egypt_town_scene.gd").scene_setup)

func _material(owner: int) -> ShaderMaterial:
	if not _mats.has(owner):
		var c: int = PLAYER_COLORS[owner] if owner < PLAYER_COLORS.size() else 0xffffff
		var m := BuildingAO.material(Color.hex((c << 8) | 0xff))
		_mats[owner] = m
	return _mats[owner]

func frame(dt: float, _alpha: float) -> void:
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
	var civs: PackedByteArray = B.get("civ", PackedByteArray())
	egypt.begin_frame()
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
		var mtype := _model_type(type)
		var v := maxi(0, variant[i])
		if mtype != type:
			v = 0
		var key := "%s/%d" % [mtype, v]
		var group := "buildings"
		if not built[i]:
			key = "%s/%d/%d" % [mtype, v, mini(STAGES - 1, floori(progress[i] * STAGES))]
			group = "construction"
		if egypt.owns(type, civs[i] if i < civs.size() else 0, owners[i]):
			continue   # egypt_buildings.gd
		if Walls.handles(type):
			continue   # walls.gd
		if Towers.handles(type):
			continue   # towers.gd
		if TechBuildings.handles(type):
			continue   # tech_buildings.gd
		var e: Dictionary = _nodes.get(id, {})
		if mtype == "":
			key = "block/%d" % built[i]   # (sim/civ) a placeholder block: no model, no stand-in
			group = "placeholder"
		elif e.is_empty() and VoxelModels.info(group, key).is_empty():
			continue   # a type with no exported model (yet)
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
			e.mi.mesh = _placeholder(rect[i * 4 + 2], rect[i * 4 + 3], type, built[i] != 0) if group == "placeholder" else BuildingAO.mesh(group, key)
			e.mi.material_override = null if group == "placeholder" else _material(owners[i])
	for id in _nodes.keys():
		if not seen.has(id):
			_nodes[id].mi.queue_free()
			_nodes.erase(id)
	walls.from_buildings(B, _names)
	walls.frame(dt)
	towers.from_buildings(B, _names)
	techb.from_buildings(B, _names)
	egypt.from_buildings(B, _names)
	if sig != _sig:
		_sig = sig
		_props.rebuild(_prop_buildings(B))
	else:
		_props.update_fog()

## (sim/civ) The model type drawn for a sim type: its own when exported, else
## the stand-in its def names (an Egyptian type before its model exists), else
## "" (a placeholder block). Kept per type.
func _model_type(type: String) -> String:
	if _model_of.has(type):
		return _model_of[type]
	var m := type
	if VoxelModels.info("buildings", type + "/0").is_empty():
		m = str(game.sim.get_building_def(type).get("stand_in", ""))
		if m != "" and VoxelModels.info("buildings", m + "/0").is_empty():
			m = ""
	_model_of[type] = m
	return m

## (sim/civ) A sandstone block on the footprint (Monuments: a stepped plinth
## and a dark statue block, the Obelisk a tall gilt-tipped needle): reads as
## "an Egyptian building with no model yet", never as a Greek one.
func _placeholder(w: int, h: int, type: String, done: bool) -> Mesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sand := Color(0.83, 0.72, 0.52)
	var dark := Color(0.2, 0.18, 0.16)
	var gold := Color(0.85, 0.68, 0.25)
	var boxes := []
	if type == "obelisk":
		boxes = [[Vector3(0.7, 0.3, 0.7), 0.0, sand], [Vector3(0.36, 3.2, 0.36), 0.3, sand], [Vector3(0.22, 0.4, 0.22), 3.5, gold]]
	elif type.begins_with("monument"):
		boxes = [[Vector3(w * 0.9, 0.35, h * 0.9), 0.0, sand], [Vector3(w * 0.6, 0.3, h * 0.6), 0.35, gold], [Vector3(w * 0.35, 1.2 + w * 0.4, h * 0.35), 0.65, dark]]
	else:
		boxes = [[Vector3(w * 0.9, 1.6, h * 0.9), 0.0, sand]]
	var k := 1.0 if done else 0.35
	for b in boxes:
		var size: Vector3 = b[0]
		var c: Color = b[2]
		var mesh := BoxMesh.new()
		mesh.size = Vector3(size.x, size.y * k, size.z)
		var arr := mesh.get_mesh_arrays()
		var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var norms: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
		for j in idx:
			st.set_color(c)
			st.set_normal(norms[j])
			st.add_vertex(verts[j] + Vector3(0, float(b[1]) * k + size.y * k * 0.5, 0))
	var out := st.commit()
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.9
	out.surface_set_material(0, mat)
	return out

## The building list the prop layout needs, with the temple's temenos rect
## (town.js sets bld_temenos when it laid the two-step platform out; the sim
## does not export it, so it is recognised here: the planned rect north of a
## Town Center of the same owner, paved and flattened one level above it).
func _prop_buildings(B: Dictionary) -> Array:
	var out := []
	var rect: PackedInt32Array = B.rect
	var tcs := []
	var civs: PackedByteArray = B.get("civ", PackedByteArray())
	for i in B.count:
		if egypt.owns(_names[B.type[i]], civs[i] if i < civs.size() else 0, B.owner[i]):
			continue   # no Greek town dressing round an Egyptian building
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
