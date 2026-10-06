extends RefCounted
## The "egypt_powers" capture scene (gods piece, Godot-only; registered by godpowers.gd):
## an Egyptian player 1 (the major god and minor gods the power needs, Mythic Age) with a
## small town, a Greek player 2 with a town and an army, and one Egyptian god power cast,
## the sim stepped `t` seconds into it (the capture is of the paused sim: exact).
##
##   node scripts/godot-shoot.mjs --scene egypt_powers --params "power=tornado&t=6"
##
## power = rain | prosperity | vision | eclipse | shifting_sands | plague_of_serpents |
##         locust_swarm | citadel | ancestors | son_of_osiris | tornado | thoth_meteor
##         (and two that are not powers: rebirth = a Phoenix falls and leaves its egg,
##         roc = a Roc boarding spearmen (roc_load), roc_unload = it sets them down)
## The Tornado and Thoth's Meteor strike a grove: the trees they cross lie flattened.
## t = seconds into the cast (default: each power's showpiece moment), ep_dist / ep_pitch /
## ep_yaw / ep_ax / ep_az: framing.

const SETUPS := {
	# power: [major god, [classical, heroic, mythic], default t, camera distance, pitch, yaw]
	"rain": ["ra", ["bast", "sobek", "horus"], 6.0, 46.0, 46.0, 28.0],
	"prosperity": ["isis", ["bast", "sobek", "thoth"], 4.0, 28.0, 46.0, 20.0],
	"vision": ["set", ["ptah", "sekhmet", "horus"], 3.2, 66.0, 56.0, 20.0],
	"eclipse": ["ra", ["bast", "sobek", "horus"], 4.0, 30.0, 40.0, 28.0],
	"shifting_sands": ["set", ["ptah", "sekhmet", "horus"], 2.4, 46.0, 50.0, 0.0],
	"plague_of_serpents": ["isis", ["anubis", "nephthys", "thoth"], 8.0, 26.0, 46.0, 24.0],
	"locust_swarm": ["ra", ["bast", "sobek", "horus"], 5.0, 34.0, 48.0, 24.0],
	"citadel": ["ra", ["ptah", "sekhmet", "osiris"], 1.2, 34.0, 40.0, 30.0],
	"ancestors": ["isis", ["bast", "nephthys", "osiris"], 7.0, 32.0, 44.0, 26.0],
	"son_of_osiris": ["ra", ["bast", "sobek", "osiris"], 1.05, 24.0, 36.0, 24.0],
	"tornado": ["set", ["ptah", "sekhmet", "horus"], 6.0, 40.0, 44.0, 24.0],
	"thoth_meteor": ["isis", ["anubis", "nephthys", "thoth"], 8.6, 48.0, 50.0, 24.0],
	"rebirth": ["isis", ["anubis", "nephthys", "thoth"], 5.0, 14.0, 36.0, 24.0],
	"roc": ["ra", ["bast", "sobek", "horus"], 1.6, 18.0, 38.0, 24.0],
	"roc_unload": ["ra", ["bast", "sobek", "horus"], 1.0, 20.0, 40.0, 24.0],
}

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var power := str(game.args.get("power", "tornado"))
	if not SETUPS.has(power):
		push_error("egypt_powers: unknown power %s" % power)
		power = "tornado"
	var st: Array = SETUPS[power]
	var s: Dictionary = sim.get_starts()[0]
	var cx := float(s.tx) + 0.5
	var cz := float(s.tz) + 0.5
	sim.clear_rect(int(cx) - 34, int(cz) - 30, 68, 60)
	if sim.has_method("paint_ground"):
		sim.paint_ground(int(cx) - 30, int(cz) - 26, 60, 52, 1)   # desert earth under the Egyptian side
	sim.set_player_god(1, st[0])
	sim.set_player_age(1, 0)
	for a in 3:
		sim.set_minor_god(1, a + 1, st[1][a])
	sim.set_player_age(1, 3)
	sim.set_player_age(2, 3)
	sim.set_player_resources(1, {"food": 5000, "wood": 5000, "gold": 5000, "favor": 200})
	var ids := {}
	var b := func(type: String, owner: int, dx: float, dz: float) -> int:
		return int(sim.spawn_building(type, owner, cx + dx, cz + dz, true, false))
	var u := func(type: String, owner: int, dx: float, dz: float, rot := 0.0) -> int:
		return int(sim.spawn_unit(type, owner, cx + dx, cz + dz, rot))
	# player 1's town (west), player 2's (east)
	var tc: int = b.call("town_center", 1, -14, -4)
	b.call("temple", 1, -22, 6)
	b.call("granary", 1, -6, 6)
	b.call("house", 1, -24, -10)
	b.call("house", 1, -20, -14)
	b.call("monument_villagers", 1, -12, 8)
	b.call("monument_soldiers", 1, -9, 10)
	var farms := []
	for i in 6:
		farms.append(b.call("farm", 1, -18 + (i % 3) * 4, 12 + (i / 3) * 4))
	var mine := int(sim.spawn_resource("gold", int(cx) - 6, int(cz) - 16))
	b.call("mining_camp", 1, -10, -16)
	var ph: int = u.call("pharaoh", 1, -8.0, 1.0, 1.2)
	sim.tick(1)
	for i in farms.size():
		var l: int = u.call("laborer", 1, -18.0 + (i % 3) * 4, 10.5 + (i / 3) * 4)
		sim.tick(1)
		sim.order_gather(PackedInt32Array([l]), farms[i])
	for i in 6:
		var l: int = u.call("laborer", 1, -8.0 + (i % 3) * 0.9, -13.0 + (i / 3) * 0.9)
		sim.tick(1)
		sim.order_gather(PackedInt32Array([l]), mine)
	# the Greek town and army
	b.call("town_center", 2, 16, -6)
	b.call("house", 2, 10, 4)
	b.call("house", 2, 14, 6)
	b.call("barracks", 2, 22, 4)
	var gfarms := []
	for i in 4:
		gfarms.append(b.call("farm", 2, 6 + (i % 2) * 4, -16 + (i / 2) * 4))
	for i in gfarms.size():
		var v: int = u.call("villager", 2, 6.0 + (i % 2) * 4, -18.0 + (i / 2) * 4)
		sim.tick(1)
		sim.order_gather(PackedInt32Array([v]), gfarms[i])
	var army := []
	for i in 18:
		army.append(u.call("hoplite" if i % 3 else "toxotes", 2, 4.0 + (i % 6) * 1.1, -2.0 + (i / 6) * 1.2, -PI * 0.5))
	var focus := Vector2(cx, cz)
	var x2 := NAN
	var z2 := NAN
	var tx := cx + 7.0
	var tz := cz - 1.0
	match power:
		"rain", "prosperity", "eclipse":
			focus = Vector2(cx - 14, cz + 2) if power != "prosperity" else Vector2(cx - 8, cz - 15)
			if power == "eclipse":
				for i in 6:
					u.call("sphinx", 1, -4.0 + (i % 3) * 1.8, 1.0 + (i / 3) * 1.8, PI * 0.5)
				focus = Vector2(cx - 2, cz + 2)
		"vision":
			tx = cx + 16
			tz = cz - 4
			focus = Vector2(cx + 6, cz)
			game.args["fog"] = "true"
		"shifting_sands":
			for i in 10:
				u.call("spearman" if i % 2 else "axeman", 1, -16.0 + (i % 5) * 1.1, 0.0 + (i / 5) * 1.1, PI * 0.5)
			tx = cx - 14
			tz = cz + 0.5
			x2 = cx + 12
			z2 = cz - 9
			u.call("priest", 1, 13.0, -7.0)   # (his eyes there: the destination must be visible)
			focus = Vector2(cx - 1, cz - 4)
		"plague_of_serpents", "ancestors":
			if power == "plague_of_serpents":   # (on open ground south of the Greek line: they rise in the clear, then go for it)
				tx = cx + 2
				tz = cz + 9
			focus = Vector2(tx, tz)
		"locust_swarm":
			tx = cx + 2
			tz = cz - 14
			x2 = cx + 20
			z2 = cz - 14
			focus = Vector2(cx + 9, cz - 12)
		"citadel":
			var t: Dictionary = sim.get_building(tc)
			tx = float(t.x)
			tz = float(t.z)
			focus = Vector2(tx, tz)
		"son_of_osiris":
			var p: Dictionary = sim.get_unit(ph)
			tx = float(p.x)
			tz = float(p.z)
			focus = Vector2(tx, tz)
		"tornado":
			tx = cx + 12
			tz = cz + 2
			focus = Vector2(tx, tz - 2)
		"thoth_meteor":
			tx = cx + 13
			tz = cz - 4
			focus = Vector2(tx, tz)
		"rebirth":
			tx = cx - 4
			tz = cz - 8
			focus = Vector2(tx, tz)
		"roc", "roc_unload":
			tx = cx - 3
			tz = cz - 7
			focus = Vector2(tx, tz)
	if power == "tornado" or power == "thoth_meteor":
		# a grove on its path (sim/godpowers flatten_trees: they fall, the wood stays)
		var gc := Vector2i(int(tx) + 2, int(tz) + 2) if power == "tornado" else Vector2i(int(tx) + 2, int(tz) - 2)
		for gz in range(-5, 6):
			for gx in range(-5, 6):
				if gc.x + gx < int(cx) + 11:
					continue   # (clear of the Greek army)
				if posmod(gx * 7 + gz * 13, 5) != 0 and Vector2(gc.x + gx, gc.y + gz).distance_to(Vector2(tx, tz)) > 1.5:
					sim.spawn_resource("tree", gc.x + gx, gc.y + gz, posmod(gx * 3 + gz * 5, 10))
	sim.set_player_resources(1, {"favor": 400})
	var ok: bool
	if power == "rebirth":
		var px: int = u.call("phoenix", 1, tx - cx, tz - cz, 0.6)
		sim.tick(1)
		sim.kill_unit(px)
		ok = true
	elif power == "roc" or power == "roc_unload":
		var roc: int = u.call("roc", 1, tx - cx, tz - cz, 0.8)
		var men := PackedInt32Array()
		for i in 8:
			men.append(u.call("spearman", 1, tx - cx - 4.0 + (i % 4) * 0.9, tz - cz + 3.0 + (i / 4) * 0.9, -0.8))
		sim.tick(1)
		ok = int(sim.roc_load(roc, men)) == 8
		if power == "roc_unload":
			sim.tick(30 * 5)
			ok = ok and sim.roc_unload(roc, tx - 7.0, tz + 3.0)
			focus = Vector2(tx - 6.0, tz + 3.0)
			sim.tick(30 * 6)
	elif is_nan(x2):
		ok = sim.cast_power(1, power, tx, tz)
	else:
		ok = sim.cast_power2(1, power, tx, tz, x2, z2)
	if not ok:
		push_error("egypt_powers: %s refused: %s" % [power, sim.last_cast_reason()])
	if power == "son_of_osiris":
		# his foes stand in his reach as he rises, so the chain lightning crackles from the first
		# bolt on (spawned before the capture tick: they are in every frame)
		# (a loose arc 7 to 8 tiles out, about 2.3 tiles apart: each jump of the chain is in the
		# clear, and all of them are within the 4.8 tiles of the middle one he is ordered on)
		var hops := []
		for i in 5:
			var an := -0.6 + i * 0.3
			hops.append(u.call("hoplite", 2, focus.x - cx + cos(an) * (7.5 + (i % 2) * 0.8), focus.y - cz + sin(an) * (7.5 + (i % 2) * 0.8), -PI * 0.5))
		sim.tick(1)
		var U: Dictionary = sim.get_units()
		var names: PackedStringArray = sim.unit_type_names()
		for k in U.ids.size():
			if int(U.owner[k]) == 1 and names[U.type[k]] == "son_of_osiris":
				sim.order(int(U.ids[k]), {"type": "attack", "target": hops[2]})
		focus += Vector2(3.5, 0.0)   # (framed between him and them)
	var t := float(game.args.get("t", st[2]))
	sim.tick(int(round(t * 30.0)))
	focus += Vector2(float(game.args.get("ep_ax", 0.0)), float(game.args.get("ep_az", 0.0)))
	if not game.args.has("cam"):
		game.args["cam"] = "%f,%f,%f,%f,%f" % [focus.x, focus.y, float(game.args.get("ep_dist", st[3])),
			float(game.args.get("ep_pitch", st[4])), float(game.args.get("ep_yaw", st[5]))]
	print("egypt_powers: %s cast %s, %.1f s in" % [power, "ok" if ok else "REFUSED", t])
	return {"focus": focus}
