extends Node3D
## Greek Armory and Market (buildings piece, Godot-only; Age of Mythology:
## Retold's Greek Armory and Market, reference/techs/building_01..06).
## Models: the "techbuildings" group (scripts/export-techbuildings.mjs:
## 1/8-tile voxels plus the town's smooth tile roofs, pivot at the 4 x 4
## footprint centre, front to +z), one look per owner's age:
##   <type>/a1   Archaic and Classical: terracotta roofs
##   <type>/a2   Heroic: pale green glazed roofs, team finials
##   <type>/a3   Mythic: marble roofs, team finials, gilt acroteria, marble trims
##   <type>/s<k> under construction, k = floor(progress * 8) (0 = staked lot)
## <type> = "armory" (hall with a team band and cross gables, open plank
## lean-to smithy with a chimney, round smelting furnace with a glowing mouth,
## a shield rack, trough, low yard wall) or "market" (two-storey stoa, columned wing, terrace with an
## iron balustrade and outside stair, a court of goods, three stalls with
## team-striped awnings and produce).
## buildings.gd hands it the sim's rows of those types (`from_buildings`, once
## a frame) and skips them itself; one MeshInstance3D per building
## (building.gdshader, team colour, AO baked by building_ao.gd), hidden
## outside player 1's explored area. `set_static(entries)` draws render-only
## ones (the techbuildings scene while the sim has no such types):
## [{type, owner, x, z (footprint centre), key | age, built, progress}].
## `model_override[id] = "armory/a2"` draws one sim building in another look.
##
##   TechBuildings.handles("market")            -> true
##   TechBuildings.model_key("armory", true, 1.0, 2)  -> "armory/a2"

const BuildingAO = preload("res://game/buildings/building_ao.gd")
const GROUP := "techbuildings"
const STAGES := 8
const LOCAL_PLAYER := 1

var game: Node = null
var model_override := {}   # building id -> model key (scenes)
var _colors: Array = []
var _mats := {}
var _nodes := {}           # id -> {mi, key}
var _static: Array = []    # MeshInstance3D
var _fog_version := -1
var _ok := false

func setup(g: Node, team_colors: Array) -> void:
	game = g
	_colors = team_colors
	_ok = FileAccess.file_exists("res://assets/models/%s.json" % GROUP)   # the models load on first use

static func handles(type_name: String) -> bool:
	return type_name == "armory" or type_name == "market"

## The model of a building of `type`: its construction stage, else its owner's age look.
static func model_key(type_name: String, built: bool, progress: float, age: int) -> String:
	if not built:
		return "%s/s%d" % [type_name, clampi(floori(progress * STAGES), 0, STAGES - 1)]
	return "%s/a%d" % [type_name, clampi(age, 1, 3)]

## A finished building's mesh (for portraits / placement ghosts): `age` 1..3.
static func mesh_for(type_name: String, age := 1) -> Mesh:
	return BuildingAO.mesh(GROUP, model_key(type_name, true, 1.0, age))

func _material(owner: int) -> ShaderMaterial:
	if not _mats.has(owner):
		var c: int = _colors[owner] if owner < _colors.size() else 0xffffff
		_mats[owner] = BuildingAO.material(Color.hex((c << 8) | 0xff))
	return _mats[owner]

func _age(owner: int, cache: Dictionary) -> int:
	if not cache.has(owner):
		cache[owner] = int(game.sim.get_player(owner).get("age", 1))
	return cache[owner]

## The armory / market rows of AovSim.get_buildings() (buildings.gd, once a frame).
func from_buildings(B: Dictionary, names: PackedStringArray) -> void:
	if not _ok:
		return
	var n: int = B.count
	var types: PackedByteArray = B.type
	var seen := {}
	var ages := {}
	var fv: int = game.sim.fog_version()
	var fog_changed := fv != _fog_version
	_fog_version = fv
	for i in n:
		var type := names[types[i]]
		if not handles(type):
			continue
		var id: int = B.ids[i]
		seen[id] = true
		var owner := int(B.owner[i])
		var key := model_key(type, B.built[i] != 0, float(B.progress[i]), _age(owner, ages))
		if model_override.has(id):
			key = str(model_override[id])
		var e: Dictionary = _nodes.get(id, {})
		if e.is_empty():
			var rect: PackedInt32Array = B.rect
			var c := Vector2(rect[i * 4] + rect[i * 4 + 2] * 0.5, rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5)
			var mi := MeshInstance3D.new()
			mi.name = "B%d_%s" % [id, type]
			mi.material_override = _material(owner)
			mi.position = Vector3(c.x, game.sim.height_at(c.x, c.y), c.y)
			add_child(mi)
			e = {"mi": mi, "key": ""}
			_nodes[id] = e
			fog_changed = true
		if e.key != key:
			e.key = key
			e.mi.mesh = BuildingAO.mesh(GROUP, key)
		if fog_changed:
			e.mi.visible = owner == LOCAL_PLAYER or game.sim.is_explored(e.mi.position.x, e.mi.position.z)
	for id in _nodes.keys():
		if not seen.has(id):
			_nodes[id].mi.queue_free()
			_nodes.erase(id)

## Render-only buildings: [{type, owner, x, z, key? | age?, built?, progress?, yaw?}].
func set_static(entries: Array) -> void:
	for mi in _static:
		mi.queue_free()
	_static.clear()
	if not _ok:
		return
	for en in entries:
		var key: String = en.get("key", model_key(en.type, en.get("built", true), float(en.get("progress", 1.0)), int(en.get("age", 1))))
		var mi := MeshInstance3D.new()
		mi.name = "static_" + key.replace("/", "_")
		mi.mesh = BuildingAO.mesh(GROUP, key)
		mi.material_override = _material(int(en.get("owner", 1)))
		var x := float(en.x)
		var z := float(en.z)
		mi.position = Vector3(x, game.sim.height_at(x, z), z)
		mi.rotation.y = float(en.get("yaw", 0.0))
		add_child(mi)
		_static.append(mi)
