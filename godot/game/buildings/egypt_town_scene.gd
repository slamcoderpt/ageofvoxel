extends RefCounted
## The "egypt_town" capture scene (buildings piece, Godot-only; registered by
## buildings.gd): an Egyptian town with every Egyptian building
## (game/buildings/egypt_buildings.gd) laid out on the flat start of a battle
## map, on sand, with palms, like reference/egypt/building_01. Player 1 is
## made Egyptian (AovSim.set_player_civ) and the sim's types are spawned when
## the sim has them; the rest (lighthouse, wonder, palms, or every building on
## an older library) is drawn render-only (egypt_buildings.gd set_static).
##
##   node scripts/godot-shoot.mjs --scene egypt_town                       # the whole town
##     [--params "egt_focus=migdol"]      # frame one building like Retold's building views
##     [--params "egt_god=isis"]          # the major god (temple, Monument to the Gods): ra | isis | set
##     [--params "egt_age=1"]             # the owner's age (houses: 1 mud brick + thatch, 2+ whitewashed)
##     [--params "egt_states=1"]          # a row of construction stages (s0 s2 s4 s6) and looks instead
##     [--params "egt_static=1"]          # render-only even when the sim has the types
##     [--params "egt_sand=0"]            # keep the map's ground (no sand)

## [type, tile x, tile z (top-left, relative to the town centre), extra]
const LAYOUT := [
	["town_center", -3, -3, {}],
	["house", -11, -6, {"variant": 0}], ["house", -11, -1, {"variant": 1}], ["house", -7, -9, {"variant": 2}],
	["house", 6, -8, {"variant": 1}], ["house", 6, 6, {"variant": 0}], ["house", -8, 6, {"variant": 2}],
	["granary", -15, 3, {}], ["lumber_camp", -19, -6, {}], ["mining_camp", 18, -1, {}],
	["farm", -20, 3, {}], ["farm", -20, 8, {}],
	["temple", -2, -13, {}],
	["eg_barracks", 10, 6, {}], ["migdol", 12, -13, {}], ["siege_works", 17, 5, {}],
	["armory", -6, 11, {}], ["market", 0, 11, {}],
	["monument_villagers", -14, 14, {}], ["monument_soldiers", -11, 14, {}], ["monument_priests", -8, 15, {}],
	["monument_pharaohs", 5, 13, {}], ["monument_gods", 9, 13, {}],
	["obelisk", -5, 4, {}], ["obelisk", 4, -10, {}], ["obelisk", 4, 4, {}],
	["lighthouse", -13, -14, {}], ["wonder", -24, -18, {}],
]
const PALMS := [[-16, -11], [-17, -2], [-4, -15], [10, -6], [3, -16], [-14, 10], [15, 13], [22, -8], [-23, -1], [-1, 8],
	[9, 2], [-6, -5], [21, 13], [-12, -16], [16, -3], [-18, 12], [2, 18], [13, -15]]

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var ctx := {}
	var view = game.pieces.buildings.egypt
	var s: Dictionary = sim.get_starts()[0]
	var cx := int(s.tx)
	var cz := int(s.tz)
	var god := str(game.args.get("egt_god", "ra")).to_lower()
	var age := clampi(int(game.args.get("egt_age", 3)), 1, 4)
	var states := AovArgs.flag(game.args, "egt_states", false)
	var names: PackedStringArray = sim.building_type_names()
	var use_sim: bool = names.has("granary") and sim.has_method("set_player_civ") and not AovArgs.flag(game.args, "egt_static", false)
	# clear the trees and mines round the town
	sim.clear_rect(cx - 30, cz - 26, 60, 50)
	if AovArgs.flag(game.args, "egt_sand", true) and sim.has_method("paint_ground"):
		# (SAND reads as beach on low ground: the terrain blends it to grass above
		# the shore, so the desert is worn earth with a paved town core)
		sim.paint_ground(cx - 28, cz - 24, 56, 46, 1)        # DIRT
		sim.paint_ground(cx - 16, cz - 16, 34, 34, 4)        # PAVED
	if use_sim:
		sim.set_player_civ(1, "egyptian")
	if age > 1:
		sim.set_player_age(1, age)
	view.force_owner[1] = true
	var lots := []
	if states:
		var row := [["town_center", "s/town_center/s0"], ["town_center", "s/town_center/s2"], ["town_center", "s/town_center/s4"],
			["town_center", "s/town_center/s6"], ["town_center", ""], ["house", "house/0/a1"], ["house", "house/1/a1"], ["house", "house/2/a2"],
			["temple", "s/temple/s4"], ["migdol", "s/migdol/s6"], ["monument_gods", "monument_gods/isis/a1"], ["monument_gods", "monument_gods/set/a1"]]
		var x := -30
		for r in row:
			var T: Dictionary = EgyptBuildingsRef.types().get(r[0], {"w": 3, "h": 3})
			lots.append([r[0], x, -3, {"key": r[1]} if r[1] != "" else {}])
			x += int(T.w) + 1
	else:
		lots = LAYOUT
	var statics := []
	var focus_type := str(game.args.get("egt_focus", ""))
	var focus := Vector2(cx + 0.5, cz + 2.0)
	var focus_size := 0.0
	for l in lots:
		var type: String = l[0]
		var T: Dictionary = EgyptBuildingsRef.types().get(type, {})
		if T.is_empty():
			continue
		var tx: int = cx + int(l[1])
		var tz: int = cz + int(l[2])
		var ex: Dictionary = l[3]
		var w := int(T.w)
		var h := int(T.h)
		var center := Vector2(tx + w * 0.5, tz + h * 0.5)
		if focus_type != "" and type == focus_type and focus_size == 0.0:
			focus = center
			focus_size = maxf(w, h)
		if use_sim and names.has(type) and not ex.has("key"):
			var id: int = sim.spawn_building(type, 1, tx, tz, true)
			if id > 0:
				continue
		var e := {"type": type, "owner": 1, "x": center.x, "z": center.y, "age": age, "god": god, "variant": int(ex.get("variant", 0))}
		if ex.has("key"):
			e["key"] = ex.key
		statics.append(e)
	for k in PALMS.size():
		var p: Array = PALMS[k]
		if focus_size > 0.0 and Vector2(cx + p[0] + 0.5, cz + p[1] + 0.5).distance_to(focus) < focus_size * 0.5 + 4.0:
			continue   # keep the framed building clear
		statics.append({"type": "palm", "owner": 1, "x": cx + p[0] + 0.5, "z": cz + p[1] + 0.5, "variant": k % 3, "yaw": float(k) * 1.3})
	view.set_static(statics)
	ctx["focus"] = focus
	if focus_size > 0.0 and not game.args.has("cam"):
		# frame one building like Retold's building views (high, close)
		game.args["cam"] = "%f,%f,%f,%f,%f" % [focus.x, focus.y, 5.0 + focus_size * 2.6, 44.0, 28.0]
	print("egypt_town: %d buildings (%s), age %d, god %s, focus %s, sand %s" % [lots.size(), "sim" if use_sim else "render-only", age, god, focus_type if focus_type != "" else "town", sim.has_method("paint_ground")])
	return ctx

const EgyptBuildingsRef = preload("res://game/buildings/egypt_buildings.gd")
