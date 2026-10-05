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
##     [--params "egt_row=house/0/a2,house/1/a2"]  # a framed row of the given model keys instead
##     [--params "egt_yaw=208"]           # the framing camera's yaw (degrees, default 28: the front)
##     [--params "egt_static=1"]          # render-only even when the sim has the types
##     [--params "egt_sand=0"]            # keep the map's ground (no sand)
##     [--params "egt_details=1"]         # keep the map's ground details (pebbles, tufts)

## [type, tile x, tile z (top-left, relative to the town centre), extra]:
## a settlement, not a catalogue: houses in touching rows along paved lanes,
## the Town Center on its plaza at the end of the main street, the temple up
## a processional way, the military quarter east, the camps by their fields.
const LAYOUT := [
	["town_center", -3, -3, {}],
	["temple", -2, -15, {}],
	["obelisk", -4, -6, {}], ["obelisk", 3, -6, {}], ["obelisk", -5, 4, {}], ["obelisk", 5, 4, {}],
	# the west quarter: two rows of houses on their lanes, a lane's width apart
	# so every house stands on its own plinth line
	["house", -19, -8, {"variant": 1}], ["house", -15, -8, {"variant": 0}], ["house", -11, -8, {"variant": 2}],
	["house", -15, -2, {"variant": 2}], ["house", -11, -2, {"variant": 0}], ["house", -7, -2, {"variant": 1}],
	["house", -13, -12, {"variant": 0}], ["house", -9, -12, {"variant": 1}],
	["granary", -19, -2, {}], ["lumber_camp", -24, -9, {}],
	["farm", -24, 2, {}], ["farm", -19, 8, {}], ["farm", -24, 7, {}],
	# the south quarter on the main street: the market, houses, the monuments
	["market", -12, 8, {}], ["house", -7, 9, {"variant": 1}], ["house", 4, 9, {"variant": 2}], ["house", 8, 9, {"variant": 0}],
	["armory", -2, 9, {}],
	["monument_villagers", -9, 15, {}], ["monument_soldiers", -6, 15, {}], ["monument_priests", -3, 15, {}],
	["monument_pharaohs", 1, 15, {}], ["monument_gods", 5, 15, {}],
	# the military quarter east
	["eg_barracks", 7, -8, {}], ["siege_works", 13, -9, {}], ["migdol", 15, -1, {}], ["mining_camp", 22, 7, {}],
	["house", 7, -2, {"variant": 2}], ["house", 11, -2, {"variant": 1}], ["house", 12, 9, {"variant": 1}],
	["lighthouse", -14, -16, {}], ["wonder", -25, -20, {}],
]
## palms at the edges of the quarters (not over the lanes: their shadows would
## lie across the buildings)
const PALMS := [[-17, -12], [-5, -16], [11, -12], [4, -17], [-15, 12], [12, 13], [22, -8], [-26, -1],
	[-16, 4], [20, 13], [-19, -12], [19, -3], [-17, 13], [2, 21]]
## street clutter between the buildings, sparse: [tile x, tile z (centre), variant, yaw]
## (clutter variants, export-egypt.mjs: 0 jars, 1 crates + sacks, 2 mud-brick
## wall run, 3 hand cart, 4 pen corner, 5 reed sunshade stall, 6 woodpile, 7 well)
const CLUTTER := [
	[-5.5, -4.0, 3, 0.0], [-7.0, 6.5, 5, 0.0], [3.5, 7.2, 3, 1.57], [-21.0, 0.3, 7, 0.0],
	[6.0, -10.0, 2, 0.0], [-11.0, 13.0, 2, 1.57], [3.5, 13.2, 4, 1.57], [16.5, 10.5, 3, 0.0],
]
## paved lanes (tile rects relative to the centre: x, z, w, h), the rest worn earth
const LANES := [
	[-16, 4, 33, 3],      # the main street before the Town Center
	[-5, 4, 11, 4],       # the plaza
	[-2, -9, 4, 6],       # the processional way to the temple
	[-16, -5, 13, 2],     # the west lanes
	[-16, 1, 9, 2],
	[4, -4, 2, 8],        # the east lane
	[6, -3, 12, 1],
]

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
	if use_sim:
		sim.set_player_civ(1, "egyptian")
	if age > 1:
		sim.set_player_age(1, age)
	view.force_owner[1] = true
	var lots := []
	var row_keys := str(game.args.get("egt_row", ""))
	if row_keys != "":
		# a framed row of given model keys side by side (look reviews):
		# egt_row=house/0/a2,house/1/a2,granary/0/a1
		var x := -6
		for k in row_keys.split(","):
			var parts := k.split("/")
			var t := parts[1] if parts[0] == "s" and parts.size() > 1 else parts[0]   # s/<type>/sK: a stage
			var T: Dictionary = EgyptBuildingsRef.types().get(t, {"w": 3, "h": 3})
			lots.append([t, x, 0, {"key": k}])
			x += int(T.w) + 1
		states = true
	elif states:
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
	# the ground, painted after the spawns (a spawn lays its own square of
	# dirt): worn earth everywhere (SAND reads as beach on low ground: the
	# terrain blends it to grass above the shore), paved lanes between
	if AovArgs.flag(game.args, "egt_sand", true) and sim.has_method("paint_ground"):
		sim.paint_ground(cx - 30, cz - 26, 60, 50, 1)        # DIRT
		if not states:
			for r in LANES:
				sim.paint_ground(cx + int(r[0]), cz + int(r[1]), int(r[2]), int(r[3]), 4)   # PAVED
		else:
			sim.paint_ground(cx - 32, cz - 5, 64, 7, 4)
	if not states and EgyptBuildingsRef.types().has("clutter"):
		for c in CLUTTER:
			var q := Vector2(cx + float(c[0]), cz + float(c[1]))
			if focus_size > 0.0 and q.distance_to(focus) < focus_size * 0.5 + 1.0:
				continue
			statics.append({"type": "clutter", "owner": 1, "x": q.x, "z": q.y, "variant": int(c[2]), "yaw": float(c[3])})
	for k in PALMS.size():
		var p: Array = PALMS[k]
		if focus_size > 0.0 and Vector2(cx + p[0] + 0.5, cz + p[1] + 0.5).distance_to(focus) < focus_size * 0.5 + 4.0:
			continue   # keep the framed building clear
		statics.append({"type": "palm", "owner": 1, "x": cx + p[0] + 0.5, "z": cz + p[1] + 0.5, "variant": k % 3, "yaw": float(k) * 1.3})
	view.set_static(statics)
	# Retold's town ground is clean sand: hide the map's pebbles and tufts
	# (terrain.gd ground details) so only the buildings carry detail
	var terrain = game.pieces.get("terrain")
	if terrain != null and not AovArgs.flag(game.args, "egt_details", false) and terrain.get("_det_root") != null:
		terrain._det_root.visible = false
	if row_keys != "" and lots.size() > 0 and not game.args.has("cam"):
		var x0 := float(cx - 6)
		var x1 := float(cx + int(lots[-1][1]) + int(EgyptBuildingsRef.types().get(lots[-1][0], {"w": 3}).w))
		var span := x1 - x0
		focus = Vector2((x0 + x1) * 0.5, cz + 1.5)
		game.args["cam"] = "%f,%f,%f,%f,%f" % [focus.x, focus.y, maxf(8.0, 2.0 + span * 0.7), 44.0, float(game.args.get("egt_yaw", 28.0))]
	ctx["focus"] = focus
	if focus_size == 0.0 and not states and not game.args.has("cam"):
		# the whole settlement, like reference/egypt/building_01
		game.args["cam"] = "%f,%f,%f,%f,%f" % [cx - 1.0, cz + 0.5, 44.0, 50.0, 30.0]
	if focus_size > 0.0 and not game.args.has("cam"):
		# frame one building like Retold's building views (high, close)
		game.args["cam"] = "%f,%f,%f,%f,%f" % [focus.x, focus.y, maxf(14.0, 5.0 + focus_size * 2.0), 44.0, float(game.args.get("egt_yaw", 28.0))]
	print("egypt_town: %d buildings (%s), age %d, god %s, focus %s, sand %s" % [lots.size(), "sim" if use_sim else "render-only", age, god, focus_type if focus_type != "" else "town", sim.has_method("paint_ground")])
	return ctx

const EgyptBuildingsRef = preload("res://game/buildings/egypt_buildings.gd")
