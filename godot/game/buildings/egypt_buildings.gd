extends Node3D
## Egyptian buildings (buildings piece, Godot-only; Age of Mythology: Retold's
## Egyptians, reference/egypt/building_01..23, EGYPT.md section 2).
## Models: the "egypt" group (finished looks) and "egypt_stages" (construction),
## both by scripts/export-egypt.mjs: 1/8-tile voxels, pivot at the footprint
## centre, the front to +z. The manifest's "types" gives each model type its
## footprint (tiles), variants and age looks:
##   <type>/<variant>/a<age>   finished (the highest age look <= the owner's age)
##   <type>/s<k>               under construction, k = floor(progress * 8)
##                             rounded down to the exported keys (0, 2, 4, 6)
## Model types are the sim's building keys (sim/civ, buildings/defs.h): the
## Egyptian-only ones (granary, lumber_camp, mining_camp, monument_villagers,
## monument_soldiers, monument_priests, monument_pharaohs, monument_gods,
## obelisk, eg_barracks, migdol, siege_works) and, for an Egyptian owner, the
## shared ones (town_center, house, farm, temple, armory, market); plus
## render-only lighthouse, wonder, sentry_tower, palm and clutter (street
## dressing: jars, crates, mud-brick walls, carts, stalls; set_static).
## Variants: house = (the sim's variant + 3 x a lot hash) % 6; temple and monument_gods = the
## owner's major god (ra / isis / set). A building whose sim footprint is not
## the model's is scaled uniformly to fit.
## buildings.gd asks `owns(type, civ, owner)` per row and skips those rows;
## tech_buildings.gd skips Egyptian Armories / Markets the same way. One
## MeshInstance3D per building (building.gdshader, team colour, AO baked by
## building_ao.gd), hidden outside player 1's explored area.
## `force_owner[owner] = true` draws every building of that owner (of a type
## with a model) Egyptian (capture scenes, before a player is Egyptian in the sim).
##
##   EgyptBuildings.model_type("eg_barracks")             -> "eg_barracks"
##   EgyptBuildings.model_key("house", 4, true, 1.0, 2, "ra")  -> "house/1/a2"

const BuildingAO = preload("res://game/buildings/building_ao.gd")
const GROUP := "egypt"
const STAGE_GROUP := "egypt_stages"
const STAGES := 8
const LOCAL_PLAYER := 1
const GODS := ["ra", "isis", "set"]

var game: Node = null
var force_owner := {}      # owner -> true: draw that owner's buildings Egyptian
var model_override := {}   # building id -> model key (scenes)
var _colors: Array = []
var _mats := {}
var _nodes := {}           # id -> {mi, key}
var _static: Array = []    # MeshInstance3D
var _fog_version := -1
var _players := {}         # owner -> {civ, god, age} (refreshed each frame)

static var _types := {}    # the manifest's types (loaded once)
static var _stage_keys: Array = [0, 2, 4, 6]
static var _shader: Shader = null

func setup(g: Node, team_colors: Array) -> void:
	game = g
	_colors = team_colors

## The manifest types: {type: {w, h, variants, ages, stages}}; empty without the models.
static func types() -> Dictionary:
	if _types.is_empty() and FileAccess.file_exists("res://assets/models/%s.json" % GROUP):
		var man: Dictionary = VoxelModels.group(GROUP).get("man", {})
		_types = man.get("types", {})
		_stage_keys = man.get("stage_keys", [0, 2, 4, 6])
	return _types

## The model type for a sim building key ("" = none).
static func model_type(type_name: String) -> String:
	var t := types()
	return type_name if t.has(type_name) else ""

## Is this sim row drawn here? civ: the row's civ (1 = Egyptian, from get_buildings().civ).
func owns(type_name: String, civ: int, owner: int) -> bool:
	if model_type(type_name) == "":
		return false
	if civ == 1 or force_owner.has(owner):
		return true
	# Egyptian-only keys are always drawn here (a sim without the civ column)
	return type_name in ["granary", "lumber_camp", "mining_camp", "obelisk", "eg_barracks", "migdol", "siege_works"] \
		or type_name.begins_with("monument_")

## The model key: the stage while building, else variant + age look.
static func model_key(type_name: String, variant: int, built: bool, progress: float, age: int, god := "") -> String:
	var T: Dictionary = types().get(type_name, {})
	if T.is_empty():
		return ""
	if not built and bool(T.get("stages", true)):
		var k := clampi(floori(progress * STAGES), 0, STAGES - 1)
		var best := 0
		for s in _stage_keys:
			if int(s) <= k:
				best = int(s)
		return "s/%s/s%d" % [type_name, best]
	var vars: Array = T.get("variants", ["0"])
	var vname := str(vars[0])
	if type_name == "temple" or type_name == "monument_gods":
		var g := god.to_lower()
		vname = g if vars.has(g) else str(vars[0])
	else:
		vname = str(vars[posmod(variant, vars.size())])
	var look := 1
	for a in T.get("ages", [1]):
		if int(a) <= maxi(1, age):
			look = maxi(look, int(a))
	return "%s/%s/a%d" % [type_name, vname, look]

## A mesh for a key from model_key ("s/..." keys are construction stages).
static func mesh_for_key(key: String) -> Mesh:
	if key.begins_with("s/"):
		return BuildingAO.mesh(STAGE_GROUP, key.substr(2))
	return BuildingAO.mesh(GROUP, key)

## Round 48: the footing drawn under a building (export-egypt.mjs apron():
## a stone skirt round the walls, a trodden-earth footprint fraying out past
## the lot, debris, pots, shrubs): "apron/<type>/<variant>", "" when the
## models have none. Stages use the first variant's.
static func apron_key(key: String) -> String:
	var stage := key.begins_with("s/")
	var p := (key.substr(2) if stage else key).split("/")
	if p.size() < 2:
		return ""
	var v := p[1]
	if stage:
		v = str(types().get(p[0], {}).get("variants", ["0"])[0])
	var ak := "apron/%s/%s" % [p[0], v]
	return ak if not VoxelModels.info(GROUP, ak).is_empty() else ""

## Put (or swap) the footing child under a building's MeshInstance3D.
func _set_apron(mi: MeshInstance3D, key: String, salt: int) -> void:
	var ak := apron_key(key)
	var ap: MeshInstance3D = mi.get_node_or_null("apron")
	if ak == "":
		if ap != null:
			ap.queue_free()
		return
	if ap == null:
		ap = MeshInstance3D.new()
		ap.name = "apron"
		ap.material_override = mi.material_override
		ap.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		# overlapping footings of neighbours: a hair apart so they never flicker
		ap.position.y = float(posmod(salt * 7919, 9)) * 0.0009
		mi.add_child(ap)
	ap.mesh = BuildingAO.mesh(GROUP, ak)

## A finished building's mesh (portraits / placement ghosts).
static func mesh_for(type_name: String, age := 1, god := "ra", variant := 0) -> Mesh:
	var key := model_key(type_name, variant, true, 1.0, age, god)
	return null if key == "" else mesh_for_key(key)

## Uniform scale that fits the model's footprint into the sim's w x h tiles.
static func fit_scale(type_name: String, w: float, h: float) -> float:
	var T: Dictionary = types().get(type_name, {})
	if T.is_empty() or w <= 0.0 or h <= 0.0:
		return 1.0
	var mw := float(T.get("w", w))
	var mh := float(T.get("h", h))
	if is_equal_approx(mw, w) and is_equal_approx(mh, h):
		return 1.0
	return minf(w / mw, h / mh)

func _material(owner: int) -> ShaderMaterial:
	if not _mats.has(owner):
		var c: int = _colors[owner] if owner < _colors.size() else 0xffffff
		_mats[owner] = material(Color.hex((c << 8) | 0xff))
	return _mats[owner]

## building_ao.gd's material on egypt_building.gdshader (warm shade: the
## scene's cool shade light re-coloured to umber, a sand bounce at the foot).
static func material(color: Color) -> ShaderMaterial:
	if _shader == null:
		_shader = load("res://game/buildings/egypt_building.gdshader")
	var m := ShaderMaterial.new()
	m.shader = _shader
	m.set_shader_parameter("team_color", color)
	return m

func _player(owner: int) -> Dictionary:
	if not _players.has(owner):
		var p: Dictionary = game.sim.get_player(owner)
		_players[owner] = {"age": int(p.get("age", 1)), "god": str(p.get("god", "")).to_lower(),
			"civ": str(p.get("civ", ""))}
	return _players[owner]

## Called by buildings.gd once a frame before it walks the rows.
func begin_frame() -> void:
	_players.clear()

## The rows of AovSim.get_buildings() drawn here (buildings.gd, once a frame).
func from_buildings(B: Dictionary, names: PackedStringArray) -> void:
	if types().is_empty():
		return
	var n: int = B.count
	var tps: PackedByteArray = B.type
	var civs: PackedByteArray = B.get("civ", PackedByteArray())
	var seen := {}
	var fv: int = game.sim.fog_version()
	var fog_changed := fv != _fog_version
	_fog_version = fv
	for i in n:
		var type := names[tps[i]]
		var owner := int(B.owner[i])
		var civ := int(civs[i]) if i < civs.size() else 0
		if not owns(type, civ, owner):
			continue
		var id: int = B.ids[i]
		seen[id] = true
		var P := _player(owner)
		var vv := int(B.variant[i])
		if type == "house":
			# six house plans from the sim's three variants: the lot picks the half
			var rr: PackedInt32Array = B.rect
			vv += 3 * ((((rr[i * 4] * 92837111) ^ (rr[i * 4 + 1] * 689287499)) >> 4) & 1)
		var key := model_key(type, vv, B.built[i] != 0, float(B.progress[i]), int(P.age), str(P.god))
		if model_override.has(id):
			key = str(model_override[id])
		var e: Dictionary = _nodes.get(id, {})
		if e.is_empty():
			var rect: PackedInt32Array = B.rect
			var w := float(rect[i * 4 + 2])
			var h := float(rect[i * 4 + 3])
			var c := Vector2(rect[i * 4] + w * 0.5, rect[i * 4 + 1] + h * 0.5)
			var mi := MeshInstance3D.new()
			mi.name = "B%d_eg_%s" % [id, type]
			mi.material_override = _material(owner)
			mi.position = Vector3(c.x, game.sim.height_at(c.x, c.y), c.y)
			var s := fit_scale(type, w, h)
			mi.scale = Vector3(s, s, s)
			if type == "house":
				mi.rotation.y = float(B.yaw[i])
				mi.position.z -= float(B.setback[i])
			add_child(mi)
			e = {"mi": mi, "key": ""}
			_nodes[id] = e
			fog_changed = true
		if e.key != key:
			e.key = key
			e.mi.mesh = mesh_for_key(key)
			_set_apron(e.mi, key, id)
		if fog_changed:
			e.mi.visible = owner == LOCAL_PLAYER or game.sim.is_explored(e.mi.position.x, e.mi.position.z)
	for id in _nodes.keys():
		if not seen.has(id):
			_nodes[id].mi.queue_free()
			_nodes.erase(id)

## Render-only buildings: [{type, owner, x, z (footprint centre), key? | variant?, age?, god?, built?, progress?, yaw?, scale?}].
func set_static(entries: Array) -> void:
	for mi in _static:
		mi.queue_free()
	_static.clear()
	if types().is_empty():
		return
	for en in entries:
		var key: String = en.get("key", model_key(str(en.type), int(en.get("variant", 0)), en.get("built", true),
			float(en.get("progress", 1.0)), int(en.get("age", 1)), str(en.get("god", "ra"))))
		if key == "":
			continue
		var mi := MeshInstance3D.new()
		mi.name = "static_eg_" + key.replace("/", "_")
		mi.mesh = mesh_for_key(key)
		mi.material_override = _material(int(en.get("owner", 1)))
		var x := float(en.x)
		var z := float(en.z)
		mi.position = Vector3(x, game.sim.height_at(x, z), z)
		mi.rotation.y = float(en.get("yaw", 0.0))
		var s := float(en.get("scale", 1.0))
		mi.scale = Vector3(s, s, s)
		add_child(mi)
		_static.append(mi)
		if not en.get("bare", false):
			_set_apron(mi, key, _static.size())
