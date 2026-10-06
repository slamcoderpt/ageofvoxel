extends RefCounted
## The "egypt_units" capture scene (units piece, Godot-only; registered by
## units.gd): every Egyptian unit and myth unit of Age of Mythology: Retold
## (reference/egypt/unit_01..13, myth_01..14) in this game's voxel look
## (scripts/export-egypt-units.mjs, the "egypt_units" model group), on worn
## desert ground. Player 1 is Egyptian (AovSim.set_player_civ) and the sim's
## Egyptian types are spawned as themselves; a myth unit the sim has no type
## for yet is a stand-in sim unit (a Greek myth unit) drawn and posed with its
## own rig (units.gd draw_as). Every unit is a live sim unit: the setup steps
## the sim so walkers walk, workers gather and build, armies fight and die.
##
##   node scripts/godot-shoot.mjs --scene egypt_units                    # the lineup: humans, cavalry and siege, myth units
##     [--params "eu_group=foot"]      # a block of foot soldiers (axemen, spearmen, slingers ...) like unit_02
##     [--params "eu_group=mounted"]   # chariot archers, camel riders, war elephants (unit_01 / unit_13)
##     [--params "eu_group=myth"]      # the myth units in a lineup
##     [--params "eu_group=battle"]    # an Egyptian army against Greeks, mid-fight
##     [--params "eu_group=eco"]       # Laborers gathering, carrying and building, Priests, the Pharaoh
##     [--params "eu_focus=anubite"]   # four of one type from four sides, framed close (the wiki "views")
##     [--params "eu_state=walk"]      # lineup / focus: idle (default) | walk | attack | die
##     [--params "eu_t=3"]             # seconds the sim runs after the setup (battle: 5, eco: 9)
##     [--params "eu_one=axeman&eu_turn=30"]  # one unit framed close, turned from the camera (model checks)
##     [--params "eu_zoom=0.6"]        # scale the camera distance of any group
##     [--params "eu_ax=0.5&eu_az=-1&eu_pitch=30"]  # shift the framed point (world x / z), camera pitch

const HUMANS := ["laborer", "spearman", "axeman", "slinger", "mercenary", "priest", "pharaoh"]
const MOUNTED := ["chariot_archer", "camel_rider", "war_elephant", "mercenary_cavalry", "catapult", "siege_tower"]
const MYTH := ["anubite", "avenger", "mummy", "minion", "son_of_osiris", "scorpion_man", "sphinx", "petsuchos", "scarab", "wadjet", "phoenix", "roc", "baboon_of_set"]
## the sim unit a render-only myth unit rides on (until the sim has its type)
const STAND_IN := {"anubite": "minotaur", "avenger": "minotaur", "mummy": "medusa", "minion": "minotaur", "son_of_osiris": "hero",
	"scorpion_man": "minotaur", "sphinx": "minotaur", "petsuchos": "medusa", "scarab": "cyclops", "wadjet": "medusa",
	"phoenix": "centaur", "roc": "centaur"}
## lineup spacing (world units) by size
const GAP := {"war_elephant": 4.2, "siege_tower": 3.4, "catapult": 3.4, "chariot_archer": 3.6, "camel_rider": 2.8, "mercenary_cavalry": 2.6,
	"sphinx": 3.6, "petsuchos": 3.8, "scarab": 3.2, "scorpion_man": 3.4, "wadjet": 3.6, "phoenix": 3.6, "roc": 4.6, "son_of_osiris": 2.4,
	"avenger": 2.2, "anubite": 2.0,
	# men with long hafts stand a spear's length apart, so in a focus view no
	# man's spear or shield crosses his neighbour's body
	"spearman": 2.6, "mercenary": 2.6, "axeman": 2.3, "priest": 2.2, "pharaoh": 2.3, "slinger": 2.0, "laborer": 1.9}

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var units = game.pieces.units
	var s: Dictionary = sim.get_starts()[0]
	var cx := float(s.tx) + 0.5
	var cz := float(s.tz) + 0.5
	var group := str(game.args.get("eu_group", "all"))
	var focus_type := str(game.args.get("eu_focus", ""))
	var state := str(game.args.get("eu_state", "idle"))
	var yaw := deg_to_rad(float(game.args.get("eu_yaw", 28.0)))
	var names: PackedStringArray = sim.unit_type_names()
	sim.clear_rect(int(cx) - 30, int(cz) - 26, 60, 52)
	if sim.has_method("paint_ground"):
		sim.paint_ground(int(cx) - 28, int(cz) - 24, 56, 48, 1)        # DIRT (worn desert earth)
		sim.paint_ground(int(cx) - 10, int(cz) - 6, 20, 12, 4)         # a paved square
	if sim.has_method("set_player_civ"):
		sim.set_player_civ(1, "egyptian")
	sim.set_player_age(1, 4)
	# lineup axes: rows face the camera (rot = yaw), "lat" runs along a row
	var front := Vector2(sin(yaw), cos(yaw))
	var lat := Vector2(cos(yaw), -sin(yaw))
	var at := func(l: float, d: float) -> Vector2: return Vector2(cx, cz) + lat * l + front * d
	var spawned := []   # [id, type]
	var spawn := func(type: String, owner: int, p: Vector2, rot: float) -> int:
		var id := 0
		if names.has(type):
			id = int(sim.spawn_unit(type, owner, p.x, p.y, rot))
		else:
			var si := str(STAND_IN.get(type, "minotaur"))
			id = int(sim.spawn_unit(si, owner, p.x, p.y, rot))
			if id > 0 and not units.draw_as(id, type):
				print("egypt_units: no rig for %s" % type)
		if id > 0:
			spawned.append([id, type])
		return id
	var focus := Vector2(cx, cz)
	var cam_dist := 30.0
	var cam_pitch := 44.0
	var one := str(game.args.get("eu_one", ""))
	if one != "":
		# one man framed close, turned eu_turn degrees from facing the camera (model checks)
		spawn.call(one, 1, Vector2(cx, cz), yaw + deg_to_rad(float(game.args.get("eu_turn", 0.0))))
		cam_dist = 4.0 + float(GAP.get(one, 1.0)) * 1.5
		cam_pitch = 40.0
	elif focus_type != "":
		# four of one type from four sides (Retold's wiki "views"), each turned
		# three-quarters so the side and back views still show a face edge and
		# the body, not just a haft
		var size := float(GAP.get(focus_type, 1.6))
		for k in 4:
			var ang: float = yaw + float([0.0, PI * 0.38, PI * 0.82, -PI * 0.4][k])
			var p: Vector2 = at.call(float([-1.0, 1.0, 0.0, 0.0][k]) * size * 0.9, float([0.0, 0.0, -1.0, 1.0][k]) * size * 0.75)
			spawn.call(focus_type, 1, p, ang)
		cam_dist = 5.5 + size * 3.2
		cam_pitch = 40.0
	elif group == "foot":
		var rows := [["axeman", "axeman", "axeman", "axeman"], ["spearman", "spearman", "spearman", "spearman", "spearman"],
			["slinger", "slinger", "slinger", "mercenary", "mercenary"], ["priest", "pharaoh", "priest"]]
		for r in rows.size():
			var row: Array = rows[r]
			for k in row.size():
				# a man's width plus his haft and shield apart, rows staggered, so
				# each soldier stands on his own ground
				spawn.call(row[k], 1, at.call((k - (row.size() - 1) * 0.5) * 2.0 + (r % 2) * 0.7, 3.6 - r * 2.3), yaw)
		cam_dist = 18.0
		cam_pitch = 42.0
	elif group == "mounted":
		var row1 := ["chariot_archer", "war_elephant", "chariot_archer"]
		var row2 := ["camel_rider", "camel_rider", "mercenary_cavalry", "camel_rider"]
		for k in row1.size():
			spawn.call(row1[k], 1, at.call((k - 1) * 4.4, -2.2), yaw + 0.7)
		for k in row2.size():
			spawn.call(row2[k], 1, at.call((k - 1.5) * 2.8, 2.4), yaw + 0.7)
		cam_dist = 20.0
	elif group == "myth":
		_lineup(spawn, at, MYTH.slice(0, 6), 2.5, yaw)
		_lineup(spawn, at, MYTH.slice(6), -2.5, yaw)
		cam_dist = 26.0
	elif group == "battle":
		# an Egyptian army (left) charges a Greek one (right)
		var eg := ["spearman", "spearman", "spearman", "axeman", "axeman", "axeman", "slinger", "slinger", "camel_rider", "chariot_archer",
			"war_elephant", "anubite", "avenger", "petsuchos", "scorpion_man", "priest", "pharaoh"]
		var gr := ["hoplite", "hoplite", "hoplite", "hoplite", "hoplite", "hoplite", "toxotes", "toxotes", "toxotes", "hippikon", "hippikon",
			"minotaur"]
		var ids_eg := PackedInt32Array()
		var ids_gr := PackedInt32Array()
		for k in eg.size():
			var id: int = spawn.call(eg[k], 1, at.call(-5.0 - float(k % 4) * 1.6, float(k / 4) * 1.8 - 3.5), yaw + PI * 0.5)
			if id > 0: ids_eg.append(id)
		for k in gr.size():
			var id: int = spawn.call(gr[k], 2, at.call(5.0 + float(k % 4) * 1.5, float(k / 4) * 1.8 - 3.0), yaw - PI * 0.5)
			if id > 0: ids_gr.append(id)
		var c: Vector2 = at.call(0.0, 0.0)
		sim.order_attack_move(ids_eg, c.x + lat.x * 6.0, c.y + lat.y * 6.0)
		sim.order_attack_move(ids_gr, c.x - lat.x * 6.0, c.y - lat.y * 6.0)
		cam_dist = 22.0
		if not game.args.has("eu_t"):
			game.args["eu_t"] = 5.0
	elif group == "eco":
		var tc := int(sim.spawn_building("town_center", 1, int(cx) + 4, int(cz) - 9, true))
		void_ref(tc)
		var trees := []
		for k in 5:
			var r = sim.spawn_resource("tree", int(cx) - 9 + (k % 3), int(cz) - 3 + k, k % 4)
			trees.append(r)
		var mine = sim.spawn_resource("gold", int(cx) - 6, int(cz) + 4, 0)
		var lab := PackedInt32Array()
		for k in 6:
			# the two builders start on the camera's side of the site, so they
			# hammer at its near face (unit_11), not hidden behind its beams
			var p: Vector2 = at.call(-4.0 + k * 0.8, 1.0 + (k % 2))
			if k >= 4:
				p = Vector2(float(int(cx) + 2), float(int(cz) + 3)) + front * 2.6 + lat * (float(k - 4) * 1.6 - 0.8)
			var id: int = spawn.call("laborer", 1, p, yaw)
			if id > 0: lab.append(id)
		if lab.size() >= 6:
			sim.order_gather(PackedInt32Array([lab[0], lab[1]]), int(trees[1]))
			sim.order_gather(PackedInt32Array([lab[2], lab[3]]), int(mine))
			var site := int(sim.place_building("house", 1, int(cx) + 1, int(cz) + 2, PackedInt32Array([lab[4], lab[5]])))
			void_ref(site)
		spawn.call("priest", 1, at.call(3.0, 3.5), yaw)
		spawn.call("pharaoh", 1, at.call(4.5, 3.0), yaw)
		spawn.call("priest", 1, at.call(6.0, 3.5), yaw)
		cam_dist = 20.0
		if not game.args.has("eu_t"):
			game.args["eu_t"] = 9.0
	else:
		_lineup(spawn, at, HUMANS, 5.0, yaw)
		_lineup(spawn, at, MOUNTED, 0.5, yaw)
		_lineup(spawn, at, MYTH, -5.5, yaw)
		cam_dist = 34.0
		cam_pitch = 46.0
	# states for the lineups: walk on the spot, attack a dummy, fall
	cam_dist *= float(game.args.get("eu_zoom", 1.0))
	if group in ["all", "foot", "mounted", "myth"] or focus_type != "" or one != "":
		match state:
			"walk":
				for e in spawned:
					var u: Dictionary = sim.get_unit(int(e[0]))
					sim.order_move(PackedInt32Array([int(e[0])]), float(u.x) - front.x * 40.0, float(u.z) - front.y * 40.0)
			"attack":
				for e in spawned:
					var u: Dictionary = sim.get_unit(int(e[0]))
					var tgt := int(sim.spawn_unit("hippikon", 2, float(u.x) + front.x * 1.6, float(u.z) + front.y * 1.6, yaw + PI))
					if tgt > 0:
						sim.order(int(e[0]), {"type": "attack", "target": tgt})
			"die":
				for e in spawned:
					sim.kill_unit(int(e[0]), 0)
	var t := float(game.args.get("eu_t", 2.0 if state != "idle" else 0.5))
	sim.tick(int(round(t * 30.0)))
	if state == "walk":
		# keep the walkers framed: the camera follows their mean position
		var m := Vector2()
		for e in spawned:
			var u: Dictionary = sim.get_unit(int(e[0]))
			m += Vector2(float(u.x), float(u.z))
		if spawned.size() > 0:
			focus = m / spawned.size()
	# eu_ax / eu_az: shift the framed point (world units), eu_pitch: camera pitch
	focus += Vector2(float(game.args.get("eu_ax", 0.0)), float(game.args.get("eu_az", 0.0)))
	cam_pitch = float(game.args.get("eu_pitch", cam_pitch))
	if not game.args.has("cam"):
		game.args["cam"] = "%f,%f,%f,%f,%f" % [focus.x, focus.y, cam_dist, cam_pitch, rad_to_deg(yaw)]
	print("egypt_units: %d units (%s%s), state %s, %.1f s" % [spawned.size(), group, (" focus " + focus_type) if focus_type != "" else "", state, t])
	return {"focus": focus}

static func _lineup(spawn: Callable, at: Callable, types: Array, depth: float, yaw: float) -> void:
	var widths := []
	var total := 0.0
	for t in types:
		var w: float = float(GAP.get(t, 1.6))
		widths.append(w)
		total += w
	var l := -total * 0.5
	for k in types.size():
		spawn.call(types[k], 1, at.call(l + float(widths[k]) * 0.5, depth), yaw + 0.6)
		l += float(widths[k])

static func void_ref(_v) -> void:
	pass
