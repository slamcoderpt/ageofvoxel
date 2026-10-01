extends Node3D
## Greek towers (buildings piece, Godot-only; Age of Mythology: Retold's
## Greek towers, reference/walls/tower_01..05). Models: the "towers" group
## (scripts/export-towers.mjs: 1/8-tile voxels, pivot at the 2 x 2 footprint
## centre, door to +z), one per upgrade stage = the owner's tower level
## (`get_walls().level` for kind 3, else `get_fortify(owner).tower_level`):
##   0 Sentry Tower    wooden stilted lookout, team rail and roof trim (tower_05)
##   1 Watch Tower     slim stone shaft, lamp-lit lantern, red gable roof, team ridge (tower_02)
##   2 Guard Tower     corbelled machicolations, crenellated gallery with archers,
##                     terracotta pyramid roof, team banners (tower_03)
##   3 Ballista Tower  open-frame shaft, overhanging fighting platform with archers and
##                     a ballista, columned pavilion, bronze-green pedimented roof (tower_01)
## States: under construction `<L>/s<k>` (k = floor(progress * 4)), damaged
## `<L>/d1` below 2/3 hp and `<L>/d2` below 1/3; while a tower stage is being
## researched at a tower the `upgrade` scaffold stands round its top. The
## door faces +z, like the other buildings' fronts.
## One MeshInstance3D per tower (building.gdshader, team colour, AO baked by
## building_ao.gd); hidden outside player 1's explored area like the other
## buildings. The tower fire (muzzle flash, volley, impact) is
## game/combat/tower_fire.gd.
##
## `level_override[id] = L` draws one tower at another stage than its
## owner's (the towers capture scene: every stage side by side);
## `model_override[id] = "<L>/s<k>" | "<L>/d<k>" | "<L>+upgrade"` one state.

const BuildingAO = preload("res://game/buildings/building_ao.gd")
const GROUP := "towers"
const LOCAL_PLAYER := 1

var game: Node = null
var level_override := {}     # building id -> level (scenes)
var model_override := {}     # building id -> model key, e.g. "2/s1", "3/d2", "1+upgrade" (scenes)
var _mats := {}
var _colors: Array = []
var _nodes := {}             # id -> {mi, up, key, owner}
var _fog_version := -1
var _ok := false
var _tower_type := -1
var _levels: Array = []      # manifest: [{name, arrow_y, top}]

func setup(g: Node, team_colors: Array) -> void:
	game = g
	_colors = team_colors
	var man: Dictionary = VoxelModels.group(GROUP).get("man", {})
	_ok = not man.is_empty()
	if _ok:
		_levels = man.get("levels", [])
	var names: PackedStringArray = game.sim.building_type_names()
	_tower_type = names.find("tower")

static func handles(type_name: String) -> bool:
	return type_name == "tower"

## The stage name of a level ("sentry", "watch", "guard", "ballista").
func level_name(level: int) -> String:
	if level >= 0 and level < _levels.size():
		return str(_levels[level].name)
	return ""

## World height of the lantern / platform the arrows leave from.
func arrow_y(level: int) -> float:
	if level >= 0 and level < _levels.size():
		return float(_levels[level].arrow_y)
	return 5.2

func _material(owner: int) -> ShaderMaterial:
	if not _mats.has(owner):
		var c: int = _colors[owner] if owner < _colors.size() else 0xffffff
		_mats[owner] = BuildingAO.material(Color.hex((c << 8) | 0xff))
	return _mats[owner]

## Per tower id: {level, tech} from get_walls() when the sim exports towers there.
func _fort_state() -> Dictionary:
	var out := {}
	if not game.sim.has_method("get_walls"):
		return out
	var W: Dictionary = game.sim.get_walls()
	var n := int(W.get("count", 0))
	if n == 0:
		return out
	var ids: PackedInt32Array = W.ids
	var kind = W.get("kind")
	var level = W.get("level")
	var tech = W.get("tech")
	for i in n:
		if kind != null and int(kind[i]) != 3:
			continue
		out[ids[i]] = {"level": int(level[i]) if level != null else 0, "tech": int(tech[i]) if tech != null else 0}
	return out

func _owner_level(owner: int, cache: Dictionary) -> int:
	if cache.has(owner):
		return cache[owner]
	var lv := 0
	if game.sim.has_method("get_fortify"):
		lv = int(game.sim.get_fortify(owner).get("tower_level", 0))
	cache[owner] = lv
	return lv

## The tower rows of AovSim.get_buildings() (buildings.gd, once a frame).
func from_buildings(B: Dictionary, names: PackedStringArray) -> void:
	if not _ok:
		return
	var n: int = B.count
	var types: PackedByteArray = B.type
	var seen := {}
	var fort := {}
	var lv_cache := {}
	var have_fort := false
	var fv: int = game.sim.fog_version()
	var fog_changed := fv != _fog_version
	_fog_version = fv
	for i in n:
		if types[i] != _tower_type:
			continue
		if not have_fort:
			fort = _fort_state()
			have_fort = true
		var id: int = B.ids[i]
		seen[id] = true
		var owner := int(B.owner[i])
		var f: Dictionary = fort.get(id, {})
		var level := int(f.get("level", -1))
		if level < 0:
			level = _owner_level(owner, lv_cache)
		level = clampi(int(level_override.get(id, level)), 0, maxi(0, _levels.size() - 1))
		var key := "%d" % level
		if not B.built[i]:
			key += "/s%d" % clampi(floori(float(B.progress[i]) * 4.0), 0, 3)
		elif float(B.max_hp[i]) > 0.0:
			var hf := float(B.hp[i]) / float(B.max_hp[i])
			if hf < 1.0 / 3.0:
				key += "/d2"
			elif hf < 2.0 / 3.0:
				key += "/d1"
		var upgrading: bool = B.built[i] and int(f.get("tech", 0)) > 0 and _is_tower_tech(int(f.get("tech", 0)))
		if model_override.has(id):
			key = str(model_override[id])
			upgrading = key.ends_with("+upgrade")
			key = key.trim_suffix("+upgrade")
		var e: Dictionary = _nodes.get(id, {})
		if e.is_empty():
			var rect: PackedInt32Array = B.rect
			var c := Vector2(rect[i * 4] + rect[i * 4 + 2] * 0.5, rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5)
			var mi := MeshInstance3D.new()
			mi.name = "T%d" % id
			mi.material_override = _material(owner)
			mi.position = Vector3(c.x, game.sim.height_at(c.x, c.y), c.y)
			add_child(mi)
			var up := MeshInstance3D.new()
			up.name = "upgrade"
			up.material_override = mi.material_override
			up.visible = false
			mi.add_child(up)
			e = {"mi": mi, "up": up, "key": "", "level": -1}
			_nodes[id] = e
			fog_changed = true
		if e.key != key:
			e.key = key
			e.mi.mesh = BuildingAO.mesh(GROUP, key)
		e.level = level
		if upgrading and e.up.mesh == null:
			e.up.mesh = BuildingAO.mesh(GROUP, "upgrade")
		e.up.visible = upgrading
		if fog_changed:
			e.mi.visible = owner == LOCAL_PLAYER or game.sim.is_explored(e.mi.position.x, e.mi.position.z)
	for id in _nodes.keys():
		if not seen.has(id):
			_nodes[id].mi.queue_free()
			_nodes.erase(id)

## The level a drawn tower shows (-1: not drawn), for the tower fire.
func shown_level(id: int) -> int:
	var e: Dictionary = _nodes.get(id, {})
	return int(e.level) if not e.is_empty() else -1

func shown_visible(id: int) -> bool:
	var e: Dictionary = _nodes.get(id, {})
	return not e.is_empty() and e.mi.visible

static var _tower_techs := {}
func _is_tower_tech(tech: int) -> bool:
	# get_walls().tech = fort_tech_names() index + 1
	if _tower_techs.is_empty() and game.sim.has_method("fort_tech_names"):
		var nm: PackedStringArray = game.sim.fort_tech_names()
		for k in nm.size():
			_tower_techs[k + 1] = nm[k].ends_with("_tower")
	return bool(_tower_techs.get(tech, false))
