extends SceneTree
## Scripted check of the map bounds policy (PORTING.md "Map bounds"): in the
## real skirmish (main scene, headless, renderers running), every sim entry
## point that takes a world position or a tile is fed points off the map
## (negative, beyond the size, huge, infinite, NaN), then the match runs
## with the enemy AI on:
##
##   1. spawn_unit off the map: clamped onto the map, on the nearest walkable
##      tile near the edge point; NaN (and an edge with no walkable tile
##      within 8 tiles) spawns nothing and returns id 0; points on the map are
##      used exactly as given (the x = 1e9 spawn is the old segfault:
##      SpatialHash::for_each_near_xz read start[] out of range);
##   2. spawn_block off the map: every unit on the map;
##   3. move / formation move / attack-move / smart / move_to / order() to
##      off-map points: the goals are clamped onto the map, NaN is refused;
##   4. buildings: can_place / place_building / spawn_building off the map
##      refused, spawn_resource too;
##   5. god powers (Lightning Storm, Bolt, Meteor) at off-map points: cast on
##      the edge tile, NaN refused with no favor paid;
##   6. rally points off the map clamped; the accessors (height_at,
##      smooth_height_at, is_explored, is_visible, nearest_resource,
##      units_near, find_path, spawn_herd / boat / shoal) survive any input;
##   7. 90 s of play (AI on, the storms throwing the men spawned at the map's
##      corner): no unit ever leaves the map.
##
##   godot --headless --path godot -s res://game/core/bounds_check.gd -- --scene=skirmish
##
## Prints "BOUNDS PASS|FAIL <case>" and "BOUNDS_RESULT {json}"; exits with
## the number of failed cases.

const SEARCH := 8  # aov::Units::SPAWN_SEARCH

var main: Node
var sim: Object
var n := 0
var fails: Array = []
var passes := 0
var result := {}

func _initialize() -> void:
	main = load("res://game/main.tscn").instantiate()
	root.add_child(main)
	_run.call_deferred()

func _check(name: String, ok: bool, detail := {}) -> void:
	if ok:
		passes += 1
	else:
		fails.append(name)
	result[name] = detail.merged({"ok": ok})
	print("BOUNDS %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

func _on_map(x: float, z: float) -> bool:
	return x >= 0.0 and z >= 0.0 and x < n and z < n   # NaN: false

func _walkable(x: float, z: float) -> bool:
	if not _on_map(x, z):
		return false
	return sim.get_walkable()[int(z) * n + int(x)] != 0

## GameMap::clamp_to_map
func _clamp(v: float) -> float:
	if v >= 0.0 and v < n:
		return v
	return 0.5 if v < 0.0 else n - 0.5

## a walkable 5 x 4 block near the map's centre (the group of case 3 starts there)
func _open_spot() -> Vector2:
	var walk: PackedByteArray = sim.get_walkable()
	for r in range(0, n / 2 - 6):
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dz)) != r:
					continue
				var x0 := n / 2 + dx
				var z0 := n / 2 + dz
				var ok := true
				for z in range(z0, z0 + 4):
					for x in range(x0, x0 + 5):
						if walk[z * n + x] == 0:
							ok = false
				if ok:
					return Vector2(x0 + 0.5, z0 + 0.5)
	return Vector2(n * 0.5, n * 0.5)

func _ring_has_walkable(tx: int, tz: int, r: int) -> bool:
	var walk: PackedByteArray = sim.get_walkable()
	for z in range(tz - r, tz + r + 1):
		for x in range(tx - r, tx + r + 1):
			if x >= 0 and z >= 0 and x < n and z < n and walk[z * n + x] != 0:
				return true
	return false

## every living unit on the map (and finite)
func _all_on_map() -> Dictionary:
	var u: Dictionary = sim.get_units()
	var off := 0
	var first := ""
	for i in int(u.count):
		var x: float = u.pos[i * 2]
		var z: float = u.pos[i * 2 + 1]
		if not _on_map(x, z):
			# (pos is Float32: a man hugging the far edge at 127.99999 reads 128.0; ask for the doubles)
			var d: Dictionary = sim.get_unit(int(u.ids[i]))
			x = d.x
			z = d.z
		if not _on_map(x, z):
			off += 1
			if first == "":
				first = "%d at (%s, %s)" % [u.ids[i], x, z]
	return {"units": int(u.count), "off": off, "first": first}

func _run() -> void:
	for i in 3:
		await process_frame
	sim = main.sim
	main.paused = true   # this script steps the sim
	sim.set_ai_enabled(false)
	sim.set_victory_enabled(false)
	n = int(sim.get_map_size())
	var big := 1e9

	# 1. spawn_unit -------------------------------------------------------------------
	var pts := [
		[-5.0, 40.0], [-0.001, 40.0], [n + 0.0, 40.0], [n + 12.0, 40.0], [40.0, -5.0], [40.0, n + 3.0],
		[-1000.0, -1000.0], [big, 40.0], [-1e7, 40.0], [40.0, big], [-big, -big], [1e300, 1e300],
		[INF, 40.0], [-INF, 60.0], [40.0, INF], [INF, -INF],
	]
	var bad := []
	var spawned := []
	for p in pts:
		var id := int(sim.spawn_unit("hoplite", 1, p[0], p[1], 0.0))
		var u: Dictionary = sim.get_unit(id) if id > 0 else {}
		var cx := _clamp(p[0])
		var cz := _clamp(p[1])
		var expect := _ring_has_walkable(int(cx), int(cz), SEARCH)
		var ok := false
		if not expect:
			ok = id == 0
		elif id > 0:
			var x: float = u.x
			var z: float = u.z
			# the clamped point when its tile is walkable, else the centre of a walkable tile within SEARCH
			ok = _walkable(x, z) and absf(x - cx) <= SEARCH + 1 and absf(z - cz) <= SEARCH + 1
			if _walkable(cx, cz):
				ok = ok and x == cx and z == cz
			spawned.append(id)
		if not ok:
			bad.append({"at": str(p), "id": id, "unit": [u.get("x"), u.get("z")]})
	for p in [[NAN, 40.0], [40.0, NAN], [NAN, NAN]]:
		var id := int(sim.spawn_unit("hoplite", 1, p[0], p[1], 0.0))
		if id != 0:
			bad.append({"at": str(p), "id": id})
	# on the map: exactly as given, even an unwalkable tile (the browser's rule)
	var inside := [[0.0, 0.0], [n - 0.001, n - 0.001], [n * 0.5 + 0.25, n * 0.5 + 0.75]]
	for p in inside:
		var id := int(sim.spawn_unit("hoplite", 1, p[0], p[1], 0.0))
		var u: Dictionary = sim.get_unit(id)
		if id <= 0 or u.x != p[0] or u.z != p[1]:
			bad.append({"inside": str(p), "id": id})
		else:
			spawned.append(id)
	# NaN / inf rotation is harmless
	var rid := int(sim.spawn_unit("hoplite", 1, 64.5, 64.5, NAN))
	if rid <= 0 or is_nan(float(sim.get_unit(rid).rot)):
		bad.append({"rot": "nan", "id": rid})
	# an off-map point whose edge has no walkable tile within SEARCH: refused
	var rejected := _rejection_case()
	if rejected.has("bad"):
		bad.append(rejected)
	sim.tick(1)
	await process_frame
	sim.tick(30)
	var on := _all_on_map()
	_check("1 spawn_unit off the map: clamped to a walkable edge tile, NaN refused", bad.is_empty() and on.off == 0,
		{"points": pts.size() + 3, "bad": bad, "off_map": on.off, "rejection": rejected})

	# 2. spawn_block ------------------------------------------------------------------
	bad = []
	for p in [[-20.0, 30.0], [n + 20.0, 90.0], [big, -big], [INF, INF], [NAN, 5.0]]:
		var ids: PackedInt32Array = sim.spawn_block("toxotes", 2, 9, p[0], p[1], 3, 1.2, 0.0, 0.15)
		for id in ids:
			var u: Dictionary = sim.get_unit(id)
			if not _on_map(u.x, u.z):
				bad.append({"at": str(p), "id": id, "unit": [u.x, u.z]})
		if is_nan(p[1]) or is_nan(p[0]):
			if ids.size() != 0:
				bad.append({"at": str(p), "nan_spawned": ids.size()})
		elif ids.size() == 0 and _ring_has_walkable(int(_clamp(p[0])), int(_clamp(p[1])), SEARCH):
			bad.append({"at": str(p), "none": true})
		spawned.append_array(Array(ids))
	_check("2 spawn_block off the map: every unit on the map", bad.is_empty(), {"bad": bad})

	# 3. orders to off-map points -----------------------------------------------------
	bad = []
	var group := []
	var c := _open_spot()
	for i in 12:
		group.append(int(sim.spawn_unit("hoplite", 1, c.x + (i % 4) * 1.1, c.y + (i / 4) * 1.1, 0.0)))
	var targets := [[-30.0, 50.0], [n + 40.0, 50.0], [50.0, -big], [big, big], [-INF, INF], [0.0, -0.0001]]
	for t in targets:
		for kind in ["move", "attack_move", "smart"]:
			var ids := PackedInt32Array(group)
			if kind == "move":
				sim.order_move(ids, t[0], t[1])
			elif kind == "attack_move":
				sim.order_attack_move(ids, t[0], t[1])
			else:
				sim.smart(ids, t[0], t[1], 0)
			for id in group:
				var u: Dictionary = sim.get_unit(id)
				var g = u.get("goal")
				if g != null and not _on_map(g.x, g.y):
					bad.append({"kind": kind, "to": str(t), "goal": str(g)})
			sim.tick(3)
	# one unit: move_to and order({type, x, z})
	var one: int = group[0]
	sim.move_to(one, -77.0, big, 0.0)
	var g1 = sim.get_unit(one).get("goal")
	if g1 == null or not _on_map(g1.x, g1.y):
		bad.append({"kind": "move_to", "goal": str(g1)})
	for kind in ["move", "attack_move"]:
		sim.order(one, {"type": kind, "x": -INF, "z": 1e12})
		var u: Dictionary = sim.get_unit(one)
		var g = u.get("goal")
		if g == null or not _on_map(g.x, g.y) or str(u.order) != kind:
			bad.append({"kind": "order " + kind, "goal": str(u.get("goal")), "order": u.order})
	# NaN: refused, the order in hand is kept
	sim.order_move(PackedInt32Array(group), 70.0, 70.0)
	var before := str(sim.get_unit(one).get("goal"))
	sim.order_move(PackedInt32Array(group), NAN, 10.0)
	sim.order_attack_move(PackedInt32Array(group), 10.0, NAN)
	sim.smart(PackedInt32Array(group), NAN, NAN, 0)
	var nan_ok: bool = sim.order(one, {"type": "move", "x": NAN, "z": 3.0}) == false
	sim.move_to(group[1], NAN, NAN, 0.0)
	if not nan_ok or str(sim.get_unit(one).get("goal")) != before or str(sim.get_unit(one).order) != "move":
		bad.append({"kind": "nan", "goal": str(sim.get_unit(one).get("goal")), "before": before})
	# the group walks to the (clamped) far edge and arrives there, on the map
	sim.order_move(PackedInt32Array(group), -500.0, c.y)
	var goals := {}
	for id in group:
		goals[id] = sim.get_unit(id).get("goal")
	for t in 30 * 60:
		sim.tick(1)
		if t % 60 == 0:
			await process_frame
	var near_edge := 0
	for id in group:
		var u: Dictionary = sim.get_unit(id)
		if not u.dead and goals[id] != null and Vector2(u.x, u.z).distance_to(goals[id]) < 4.0 and goals[id].x < SEARCH * 2 + 1:
			near_edge += 1
	on = _all_on_map()
	_check("3 move / attack-move / formation / smart / move_to to off-map points: goals clamped, NaN refused",
		bad.is_empty() and on.off == 0 and near_edge >= 6, {"bad": bad, "off_map": on.off, "first_off": on.first, "reached_edge": near_edge})

	# 4. buildings and resources ------------------------------------------------------
	bad = []
	var tiles := [[-3, 40], [-1, 40], [n - 1, 40], [n, 40], [40, n - 2], [40, -100000], [1000000, 5],
		[2147483647, 2147483647], [-2147483648, 0], [1 << 40, 3], [-(1 << 40), -(1 << 40)]]
	sim.set_player_resources(1, {"food": 5000, "wood": 5000, "gold": 5000, "favor": 100})
	for t in tiles:
		for type in ["house", "town_center", "farm"]:
			if sim.can_place(type, t[0], t[1]):
				bad.append({"can_place": type, "at": str(t)})
			if int(sim.place_building(type, 1, t[0], t[1], PackedInt32Array())) != 0:
				bad.append({"place": type, "at": str(t)})
			if int(sim.spawn_building(type, 1, t[0], t[1], true, true)) != 0:
				bad.append({"spawn_building": type, "at": str(t)})
		if not (t[0] >= 0 and t[1] >= 0 and t[0] < n and t[1] < n) and int(sim.spawn_resource("tree", t[0], t[1], 0)) != 0:
			bad.append({"spawn_resource": str(t)})
	_check("4 buildings / resources off the map refused", bad.is_empty(), {"bad": bad})

	# 5. god powers at off-map points -------------------------------------------------
	bad = []
	for o in [3, 4]:
		sim.add_player(o, "P%d" % o, true)
	var gtargets := [[-50.0, -50.0], [big, 40.0], [INF, -INF]]
	var powers: PackedStringArray = sim.power_names()
	for pi in powers.size():
		for k in gtargets.size():
			var owner: int = [1, 3, 4][k]
			sim.set_player_resources(owner, {"favor": 100})
			var t = gtargets[k]
			var f0 := float(sim.get_player(owner).favor)
			var nan_cast: bool = sim.cast_power(owner, powers[pi], NAN, 30.0)
			if nan_cast or float(sim.get_player(owner).favor) != f0:
				bad.append({"nan": powers[pi], "owner": owner})
			if not sim.cast_power(owner, powers[pi], t[0], t[1]):
				bad.append({"cast": powers[pi], "at": str(t), "reason": sim.can_cast(owner, powers[pi]).reason})
		var gp: Dictionary = sim.get_godpowers()
		for arr_name in ["storms", "meteors"]:
			var a: PackedFloat32Array = gp[arr_name]
			var stride := 6 if arr_name == "storms" else 9
			for i in range(0, a.size(), stride):
				if not _on_map(a[i + 1], a[i + 2]):
					bad.append({arr_name: [a[i + 1], a[i + 2]]})
		var b: PackedFloat32Array = gp.bolts
		for i in range(0, b.size(), 6):
			# (sky bolts are drawn round the storm; Float32: the far edge may read n)
			if not (b[i] >= 0.0 and b[i + 2] >= 0.0 and b[i] <= n and b[i + 2] <= n) and b[i + 5] == 0.0:
				bad.append({"bolt": [b[i], b[i + 2]]})
		for t in 20:
			sim.tick(1)
	_check("5 god powers at off-map points: cast on the edge, NaN refused", bad.is_empty(), {"bad": bad})

	# 6. rally points and accessors ---------------------------------------------------
	bad = []
	var tc := 0
	var bl: Dictionary = sim.get_buildings()
	for i in int(bl.count):
		if int(bl.owner[i]) == 1 and bl.type_names[bl.type[i]] == "town_center":
			tc = int(bl.ids[i])
			break
	for p in [[-40.0, 9.0], [big, -big], [INF, 3.0]]:
		sim.set_rally(tc, p[0], p[1], 0)
		var r = sim.get_building(tc).get("rally")
		if r == null or not _on_map(r.x, r.z):
			bad.append({"rally": str(p), "got": str(r)})
	var r0 := str(sim.get_building(tc).get("rally"))
	sim.set_rally(tc, NAN, 5.0, 0)
	if str(sim.get_building(tc).get("rally")) != r0:
		bad.append({"rally_nan": str(sim.get_building(tc).get("rally"))})
	sim.set_player_resources(1, {"food": 5000})
	sim.train(tc, "villager")
	var odd := [[-1.0, -1.0], [big, big], [-big, 3.0], [INF, NAN], [NAN, NAN], [-INF, -INF], [n + 0.5, n * 0.5]]
	for p in odd:
		var h: float = sim.height_at(p[0], p[1])
		var hs: float = sim.smooth_height_at(p[0], p[1])
		sim.is_explored(p[0], p[1])
		sim.is_visible(p[0], p[1])
		sim.nearest_resource(p[0], p[1], "wood", 14.0)
		sim.nearest_resource(p[0], p[1], "food", 1e9)
		sim.units_near(p[0], p[1], 5.0)
		sim.find_path(p[0], p[1], p[1], p[0])
		sim.find_path(60.0, 60.0, p[0], p[1])
		if is_nan(h) or is_inf(h):
			bad.append({"height_at": str(p), "h": h})
		if not is_nan(p[0]) and not is_nan(p[1]) and (is_nan(hs) or is_inf(hs)):
			bad.append({"smooth_height_at": str(p), "h": hs})
		for id in sim.spawn_herd("deer", p[0], p[1], 3):
			spawned.append(int(id))
		sim.spawn_boat(1, p[0], p[1], 0.0)
		sim.spawn_shoal(p[0], p[1], 100.0)
	var econ: Dictionary = sim.get_economy()
	var an: PackedFloat32Array = econ.animals.pos
	for i in range(0, an.size(), 2):
		if not _on_map(an[i], an[i + 1]):
			bad.append({"animal": [an[i], an[i + 1]]})
	var boats: PackedFloat32Array = econ.boats
	for i in range(0, boats.size(), 10):
		if not _on_map(boats[i + 2], boats[i + 3]):
			bad.append({"boat": [boats[i + 2], boats[i + 3]]})
	_check("6 rally points clamped, accessors safe on any input", bad.is_empty(), {"bad": bad})

	# 7. play on: AI on, storms on the corner crowd, no unit leaves the map -----------
	sim.set_ai_enabled(true)
	sim.set_player_resources(3, {"favor": 100})
	sim.cast_power(3, "lightning_storm", -10.0, -10.0)   # the men spawned at (-1000, -1000) stand in that corner
	var worst := 0
	var first := ""
	for t in 30 * 90:
		sim.tick(1)
		if t % 30 == 0:
			var cm := _all_on_map()
			if cm.off > worst:
				worst = cm.off
				first = cm.first
			await process_frame
	on = _all_on_map()
	_check("7 90 s of play: no unit off the map", worst == 0 and on.off == 0,
		{"units": on.units, "worst_off": worst, "first_off": first, "time": snappedf(float(sim.get_time()), 0.1)})

	result["passes"] = passes
	result["fails"] = fails
	print("BOUNDS_RESULT " + JSON.stringify(result))
	quit(fails.size())

## A separate AovSim: find an off-map point whose edge tile has no walkable
## tile within SEARCH (open sea along a coast map's edge) and check that
## spawn_unit refuses it (id 0).
func _rejection_case() -> Dictionary:
	var s2 = ClassDB.instantiate("AovSim")
	for preset in ["coast", "skirmish", "battle"]:
		for seed in [1, 2, 3, 4, 5, 6, 7, 8]:
			s2.new_game(seed, 128, preset, 2)
			var m := int(s2.get_map_size())
			var walk: PackedByteArray = s2.get_walkable()
			for e in range(0, m, 4):
				for side in 4:
					var tx: int = [e, e, 0, m - 1][side]
					var tz: int = [0, m - 1, e, e][side]
					var any := false
					for z in range(maxi(0, tz - SEARCH), mini(m, tz + SEARCH + 1)):
						for x in range(maxi(0, tx - SEARCH), mini(m, tx + SEARCH + 1)):
							if walk[z * m + x] != 0:
								any = true
								break
						if any:
							break
					if any:
						continue
					var px: float = [tx + 0.5, tx + 0.5, -20.0, m + 20.0][side]
					var pz: float = [-20.0, m + 20.0, tz + 0.5, tz + 0.5][side]
					var count0 := int(s2.get_unit_count())
					var id := int(s2.spawn_unit("hoplite", 1, px, pz, 0.0))
					var d := {"preset": preset, "seed": seed, "at": [px, pz], "id": id}
					if id != 0 or int(s2.get_unit_count()) != count0:
						d["bad"] = true
					return d
	return {"skipped": "no edge without a walkable tile within %d found" % SEARCH}
