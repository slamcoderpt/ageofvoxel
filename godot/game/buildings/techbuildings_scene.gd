extends RefCounted
## The "techbuildings" capture scene (buildings piece, Godot-only; registered
## by buildings.gd): the town scene's Greek town with an Armory and a Market
## (game/buildings/tech_buildings.gd) side by side on cleared ground at the
## edge of the town, the camera close and high like Retold's building views
## (reference/techs/building_01, building_04). Built by the sim when it has
## the "armory" / "market" types (spawn_building), else drawn render-only
## (tech_buildings.gd set_static) on the same lots.
##
##   node scripts/godot-shoot.mjs --scene techbuildings
##     [--params "techb_age=2"]       # 1 Classical, 2 Heroic, 3 Mythic look
##     [--params "techb_states=1"]    # a row: every age look and construction stages
##     [--params "techb_static=1"]    # render-only even when the sim has the types

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var ctx: Dictionary = sim.setup_scene("town", game.scene_opts())
	var B: Dictionary = sim.get_buildings()
	var rect: PackedInt32Array = B.rect
	var x0 := 1 << 20
	var x1 := -(1 << 20)
	var z1 := -(1 << 20)
	for i in int(B.count):
		if int(B.owner[i]) != 1:
			continue
		x0 = mini(x0, rect[i * 4])
		x1 = maxi(x1, rect[i * 4] + rect[i * 4 + 2] - 1)
		z1 = maxi(z1, rect[i * 4 + 1] + rect[i * 4 + 3] - 1)
	var size: int = sim.get_map_size()
	var cx := (x0 + x1) / 2
	var row := mini(size - 12, z1 + int(game.args.get("techb_row", 3)))
	var age := clampi(int(game.args.get("techb_age", 1)), 1, 3)
	var states := AovArgs.flag(game.args, "techb_states", false)
	var names: PackedStringArray = sim.building_type_names()
	var use_sim := names.has("armory") and names.has("market") and not AovArgs.flag(game.args, "techb_static", false)
	if age > 1:
		sim.set_player_age(1, age)
	var view = game.pieces.buildings.techb
	# lots: [type, tile x, model key or ""]
	var lots := []
	if states:
		for k in [["armory", "armory/a1"], ["armory", "armory/a2"], ["armory", "armory/a3"],
				["market", "market/a1"], ["market", "market/a2"], ["market", "market/a3"],
				["armory", "armory/s0"], ["armory", "armory/s3"], ["market", "market/s5"]]:
			lots.append(k)
	else:
		lots = [["armory", ""], ["market", ""]]
	var gap := 5
	var tx0: int = cx - (lots.size() * gap) / 2 + 1
	sim.clear_rect(tx0 - 2, row - 2, lots.size() * gap + 4, 9)
	var statics := []
	for k in lots.size():
		var tx: int = tx0 + k * gap
		var type: String = lots[k][0]
		var key: String = lots[k][1]
		if use_sim and sim.can_place(type, tx, row):
			var id: int = sim.spawn_building(type, 1, tx, row, true)
			if id > 0 and key != "":
				view.model_override[id] = key
			if id > 0:
				continue
		var e := {"type": type, "owner": 1, "x": tx + 2.0, "z": row + 2.0, "age": age}
		if key != "":
			e["key"] = key
		statics.append(e)
	view.set_static(statics)
	ctx["focus"] = Vector2(tx0 + lots.size() * gap * 0.5 - 0.5, row + 2.0)
	print("techbuildings: %d lots at row %d (x %d), %s, age look %d" % [lots.size(), row, tx0, "sim" if use_sim else "render-only", age])
	return ctx
