extends SceneTree
## Scripted check of the Godot-only fortifications (native/src/sim/fortify,
## PORTING.md "Walls, gates, towers"), headless, on AovSim matches of three
## human seats (players 1 and 3 one team, player 2 the enemy; no AI):
##
##   plan       a wall line is 4-connected, pillars at the ends / corners,
##              segments of <= 4 tiles, cost per tile
##   build      villagers build a closed 13 x 13 ring; more builders build faster
##   keepout    enemy units ordered into the ring stay out under every mode:
##              single A* moves, formation moves (own A* each), formation moves
##              on one group field, attack-move, right-click; find_path stops outside
##   gate       a segment converted to a gate admits the owner's and his ally's
##              units and refuses the enemy's; its leaves open for them; locked,
##              it keeps out even its owner
##   repair     villagers repair a damaged wall for free, more hands faster
##   breach     enemy soldiers attacking a house inside the ring break a wall
##              piece; the broken piece's tiles are walkable again and the
##              whole army walks in and razes the house (none waits idle
##              outside); the same with a villager inside a fresh ring as
##              the target: they break in and kill him
##   towers     a tower built by villagers shoots enemies in range, never an ally
##              or its owner's units; Town Center arrows never hit an ally
##   upgrades   Watch / Guard / Ballista Tower (each needs its age) raise range,
##              damage and hp; Stone Wall raises wall hp
##   determinism two identical runs (ring, gate, tower, an enemy attack) end bit-equal
##   rules_off  with set_godot_rules(false) no wall can be placed
##
##   godot --headless --path godot -s res://game/core/walls_check.gd [-- --only=plan,build,... --seed=7]
##
## Prints "WALLS PASS|FAIL <case> {detail}" and "WALLS_RESULT {json}"; exit = failures.

const FPS := 30
var fails: Array = []
var passes := 0
var result := {}
var only: Array = []
var seed_arg := 7

func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7).split(",")
		elif a.begins_with("--seed="):
			seed_arg = int(a.substr(7))
	_run.call_deferred()

func _want(name: String) -> bool:
	return only.is_empty() or name in only

func _check(name: String, ok: bool, detail := {}) -> void:
	if ok:
		passes += 1
	else:
		fails.append(name)
	result[name] = detail.merged({"ok": ok})
	print("WALLS %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

# ---- helpers ------------------------------------------------------------------

func _new_sim(seed := 7) -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := []
	for i in 3:
		ps.append({"id": i + 1, "name": "P%d" % (i + 1), "human": true, "team": 1 if i != 1 else 2})
	var r: Dictionary = sim.start_match({"seed": seed, "map_size": 160, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
		return null
	sim.set_victory_enabled(false)
	sim.set_fog_reveal_all(true)
	return sim

## Centre tile of a square of side `w` of passable terrain at least `far`
## tiles from every start; its trees / mines are cleared.
func _open_area(sim: Object, w: int, far: float) -> Vector2i:
	var c := _find_area(sim, w, far)
	if c.x >= 0:
		sim.clear_rect(c.x - w / 2, c.y - w / 2, w + 1, w + 1)
	return c

func _find_area(sim: Object, w: int, far: float) -> Vector2i:
	var n := int(sim.get_map_size())
	var walk: PackedByteArray = sim.get_passable()
	var starts: Array = sim.get_starts()
	var h := w / 2
	for cz in range(h + 2, n - h - 2, 2):
		for cx in range(h + 2, n - h - 2, 2):
			var ok := true
			for s in starts:
				if Vector2(cx, cz).distance_to(Vector2(float(s.tx), float(s.tz))) < far:
					ok = false
					break
			if not ok:
				continue
			for z in range(cz - h, cz + h + 1):
				for x in range(cx - h, cx + h + 1):
					if walk[z * n + x] == 0:
						ok = false
						break
				if not ok:
					break
			if ok:
				return Vector2i(cx, cz)
	return Vector2i(-1, -1)

func _spawn(sim: Object, type: String, owner: int, count: int, x: float, z: float, cols := 5) -> Array:
	var ids := []
	for i in count:
		ids.append(int(sim.spawn_unit(type, owner, x + (i % cols) * 1.0, z + (i / cols) * 1.0, 0.0)))
	return ids

func _ring_lines(c: Vector2i, r: int) -> Array:
	var x0 := c.x - r
	var x1 := c.x + r
	var z0 := c.y - r
	var z1 := c.y + r
	return [[Vector2i(x0, z0), Vector2i(x1, z0)], [Vector2i(x1, z0), Vector2i(x1, z1)],
		[Vector2i(x1, z1), Vector2i(x0, z1)], [Vector2i(x0, z1), Vector2i(x0, z0)]]

func _w(t: Vector2i) -> Vector2:
	return Vector2(t.x + 0.5, t.y + 0.5)

func _walls(sim: Object) -> Dictionary:
	return sim.get_walls()

func _piece(sim: Object, id: int) -> Dictionary:
	var W := _walls(sim)
	for i in int(W.count):
		if int(W.ids[i]) == id:
			return {"i": i, "kind": int(W.kind[i]), "hp": float(W.hp[i]), "max_hp": float(W.max_hp[i]), "built": int(W.built[i]),
				"rect": [int(W.rect[i * 4]), int(W.rect[i * 4 + 1]), int(W.rect[i * 4 + 2]), int(W.rect[i * 4 + 3])],
				"open": float(W.open[i]), "level": int(W.level[i]), "locked": int(W.locked[i])}
	return {}

func _unbuilt(sim: Object, owner: int) -> Array:
	var W := _walls(sim)
	var out := []
	for i in int(W.count):
		if int(W.owner[i]) == owner and int(W.built[i]) == 0:
			out.append(int(W.ids[i]))
	return out

## Step until every piece of `owner` is built; idle builders are sent to the
## nearest unfinished piece (what a player does). Returns seconds taken (-1: timeout).
func _build_all(sim: Object, owner: int, vills: Array, max_s: float) -> float:
	var t := 0.0
	while t < max_s:
		var left := _unbuilt(sim, owner)
		if left.is_empty():
			return t
		if int(t * FPS) % FPS == 0:
			for v in vills:
				var u: Dictionary = sim.get_unit(v)
				if u.is_empty() or u.dead or str(u.order) == "build":
					continue
				var best := -1
				var bd := 1e9
				for id in left:
					var b: Dictionary = sim.get_building(id)
					var d := Vector2(b.x, b.z).distance_to(Vector2(u.x, u.z))
					if d < bd:
						bd = d
						best = id
				if best > 0:
					sim.order_build(PackedInt32Array([v]), best)
		sim.tick(1)
		t += 1.0 / FPS
	return -1.0

## living units of `ids` strictly inside the ring around c (radius r)
func _inside(sim: Object, ids: Array, c: Vector2i, r: int) -> int:
	var n := 0
	for id in ids:
		var u: Dictionary = sim.get_unit(id)
		if u.is_empty() or u.dead:
			continue
		if u.x >= c.x - r + 1 and u.x < c.x + r and u.z >= c.y - r + 1 and u.z < c.y + r:
			n += 1
	return n

func _alive(sim: Object, ids: Array) -> Array:
	return ids.filter(func(id): var u: Dictionary = sim.get_unit(id); return not u.is_empty() and not u.dead)

func _kill(sim: Object, ids: Array) -> void:
	for id in ids:
		sim.kill_unit(id)

## the units' max distance to point p
func _spread(sim: Object, ids: Array, p: Vector2) -> float:
	var m := 0.0
	for id in _alive(sim, ids):
		var u: Dictionary = sim.get_unit(id)
		m = maxf(m, Vector2(u.x, u.z).distance_to(p))
	return m

func _res(sim: Object, owner: int) -> Vector2:
	var p: Dictionary = sim.get_player(owner)
	return Vector2(float(p.wood), float(p.gold))

func _tc(sim: Object, owner: int) -> Dictionary:
	var b: Dictionary = sim.get_buildings()
	for i in int(b.count):
		if int(b.owner[i]) == owner and b.type_names[b.type[i]] == "town_center":
			return {"id": int(b.ids[i]), "x": b.rect[i * 4] + b.rect[i * 4 + 2] * 0.5, "z": b.rect[i * 4 + 1] + b.rect[i * 4 + 3] * 0.5}
	return {}

# ---- the ring scenario (shared by most cases) ---------------------------------

var S: Object
var C := Vector2i(-1, -1)
const R := 6
var ring_ids: Array = []
var vills: Array = []

func _setup_ring() -> bool:
	S = _new_sim(seed_arg)
	if S == null:
		return false
	C = _open_area(S, 30, 26.0)
	print("WALLS area %s" % C)
	if C.x < 0:
		return false
	vills = _spawn(S, "villager", 1, 8, C.x - 3, C.y - R - 4, 8)
	S.tick(1)
	return true

func _run() -> void:
	if not _setup_ring():
		_check("setup", false, {"area": str(C)})
		_finish()
		return
	if _want("plan") or _want("build") or not only.is_empty():
		_case_plan()
	_case_build()
	if _want("keepout"):
		_case_keepout()
	if _want("gate"):
		_case_gate()
	if _want("repair"):
		_case_repair()
	if _want("breach"):
		_case_breach()
	if _want("towers") or _want("upgrades"):
		_case_towers()
	if _want("determinism"):
		_case_determinism()
	if _want("rules_off"):
		_case_rules_off()
	_finish()

func _finish() -> void:
	result["passes"] = passes
	result["fails"] = fails
	print("WALLS_RESULT %s" % JSON.stringify(result))
	quit(fails.size())

# plan ---------------------------------------------------------------------------

func _case_plan() -> void:
	var a := Vector2(C.x - 10 + 0.5, C.y + 0.5)
	# a diagonal line: 4-connected (every step one tile in x or z)
	var p: Dictionary = S.plan_wall(1, a, a + Vector2(7, 5))
	var t: PackedInt32Array = p.tiles
	var conn := true
	for i in range(1, t.size() / 2):
		if absi(t[i * 2] - t[i * 2 - 2]) + absi(t[i * 2 + 1] - t[i * 2 - 1]) != 1:
			conn = false
	# a straight line of 14: pillars at both ends, segments <= 4
	var q: Dictionary = S.plan_wall(1, a, a + Vector2(13, 0))
	var pcs: PackedInt32Array = q.pieces
	var names: PackedStringArray = S.building_type_names()
	var kinds := []
	var max_seg := 0
	var covered := 0
	for i in pcs.size() / 5:
		kinds.append(names[pcs[i * 5]])
		covered += pcs[i * 5 + 3] * pcs[i * 5 + 4]
		if names[pcs[i * 5]] == "wall":
			max_seg = maxi(max_seg, pcs[i * 5 + 3] * pcs[i * 5 + 4])
	var ends: bool = kinds.size() > 1 and kinds[0] == "wall_pillar" and kinds[kinds.size() - 1] == "wall_pillar"
	# an L: a pillar on the corner
	var l1: Dictionary = S.plan_wall(1, a, a + Vector2(6, 0))
	var cost: Dictionary = q.cost
	# a 45-degree line of 12 (24 tiles of staircase): pillars spaced as the
	# crow flies (every 5 tiles or so of wall), not every 5 tiles of the staircase
	var dg: Dictionary = S.plan_wall(1, a, a + Vector2(12, 12))
	var dpc: PackedInt32Array = dg.pieces
	var dpil := 0
	for i in dpc.size() / 5:
		dpil += int(names[dpc[i * 5]] == "wall_pillar")
	# a line across a building (the Town Center) is refused, the building's tiles counted
	var tc := _tc(S, 1)
	var thr: Dictionary = S.plan_wall(1, Vector2(float(tc.x) - 7.0, float(tc.z)), Vector2(float(tc.x) + 7.0, float(tc.z)))
	var thr_r: Dictionary = S.place_wall(1, Vector2(float(tc.x) - 7.0, float(tc.z)), Vector2(float(tc.x) + 7.0, float(tc.z)))
	var refused: bool = not bool(thr.valid) and int(thr.get("on_building", 0)) > 0 and str(thr.reason) == "A building is in the way" \
		and not bool(thr_r.get("ok", true))
	_check("plan", conn and t.size() / 2 == 13 and ends and max_seg <= 4 and max_seg >= 2 and covered == 14
			and int(q.new_tiles) == 14 and int(cost.get("wood", 0)) == 14 * 4 and int(cost.get("gold", 0)) == 14 * 2 and bool(q.valid) and bool(l1.valid)
			and dpil >= 3 and dpil <= 5 and refused,
		{"diag_tiles": t.size() / 2, "four_connected": conn, "kinds": kinds, "max_segment": max_seg, "cost": cost,
			"diag45_pillars": dpil, "across_building": {"valid": thr.valid, "on_building": thr.get("on_building"), "reason": thr.reason}})

# build --------------------------------------------------------------------------

func _case_build() -> void:
	var res0 := _res(S, 1)
	var placed := 0
	var first: Dictionary = {}
	for ln in _ring_lines(C, R):
		var r: Dictionary = S.place_wall(1, _w(ln[0]), _w(ln[1]), PackedInt32Array(vills))
		if bool(r.ok):
			placed += r.ids.size()
			if first.is_empty():
				first = r
	var res1 := _res(S, 1)
	var W := _walls(S)
	ring_ids = Array(W.ids)
	# the corners are pillars
	var corners := 0
	for i in int(W.count):
		var rx: int = W.rect[i * 4]
		var rz: int = W.rect[i * 4 + 1]
		if int(W.kind[i]) == 0 and (rx == C.x - R or rx == C.x + R) and (rz == C.y - R or rz == C.y + R):
			corners += 1
	# the ring blocks even as foundations
	var walk: PackedByteArray = S.get_walkable()
	var n := int(S.get_map_size())
	var ring_tiles := {}
	for k in range(-R, R + 1):
		for tt in [Vector2i(C.x + k, C.y - R), Vector2i(C.x + k, C.y + R), Vector2i(C.x - R, C.y + k), Vector2i(C.x + R, C.y + k)]:
			ring_tiles[tt] = true
	var blocked := 0
	for tt in ring_tiles:
		if walk[tt.y * n + tt.x] == 0:
			blocked += 1
	var secs := _build_all(S, 1, vills, 400.0)
	var all_built := _unbuilt(S, 1).is_empty()
	var hp_ok := true
	W = _walls(S)
	for i in int(W.count):
		if absf(float(W.hp[i]) - float(W.max_hp[i])) > 0.01:
			hp_ok = false
	# several builders build faster: one villager vs four on equal 4-tile segments
	var fa := Vector2(C.x - 12 + 0.5, C.y + R + 4 + 0.5)   # (south of the ring, inside the cleared square)
	var solo := _spawn(S, "villager", 1, 1, fa.x, fa.y + 2)
	var team := _spawn(S, "villager", 1, 4, fa.x + 14, fa.y + 2)
	S.tick(1)
	var a: Dictionary = S.place_wall(1, fa, fa + Vector2(3, 0), PackedInt32Array(solo))   # pillar + 2 + pillar = 4 tiles
	var b: Dictionary = S.place_wall(1, fa + Vector2(14, 0), fa + Vector2(17, 0), PackedInt32Array(team))
	var ta := -1.0
	var tb := -1.0
	for t in 120 * FPS:
		S.tick(1)
		var da := true
		for id in a.ids:
			if int(_piece(S, id).get("built", 0)) == 0:
				da = false
		var db := true
		for id in b.ids:
			if int(_piece(S, id).get("built", 0)) == 0:
				db = false
		if da and ta < 0:
			ta = t / float(FPS)
		if db and tb < 0:
			tb = t / float(FPS)
		if ta >= 0 and tb >= 0:
			break
	for id in a.ids + b.ids:
		S.destroy_building(id)
	_kill(S, solo + team)
	S.tick(2)
	var tiles := 4 * (2 * R)
	var paid := res0 - res1
	_check("build", placed > 0 and corners == 4 and blocked == tiles and all_built and hp_ok and secs > 0
			and is_equal_approx(paid.x, tiles * 4.0) and is_equal_approx(paid.y, tiles * 2.0) and ta > 0 and tb > 0 and tb < ta * 0.7,
		{"pieces": placed, "corner_pillars": corners, "blocked_tiles": blocked, "of": tiles, "build_s": secs, "paid": [paid.x, paid.y],
			"one_builder_s": ta, "four_builders_s": tb})

# keep out -----------------------------------------------------------------------

func _case_keepout() -> void:
	var centre := Vector2(C.x + 0.5, C.y + 0.5)
	var modes := {}
	var all_ok := true
	S.set_group_paths(0)
	for mode in ["single", "formation", "group_field", "attack_move", "smart"]:
		var foes := _spawn(S, "hoplite" if mode != "single" else "toxotes", 2, 30 if mode != "single" else 6, C.x - 4, C.y + R + 6, 6)
		S.tick(1)
		if mode == "group_field":
			S.set_group_paths(10)
		match mode:
			"single":
				for id in foes:
					S.order(id, {"type": "move", "x": centre.x, "z": centre.y})
			"formation", "group_field":
				S.order_move(PackedInt32Array(foes), centre.x, centre.y)
			"attack_move":
				S.order_attack_move(PackedInt32Array(foes), centre.x, centre.y)
			"smart":
				S.smart(PackedInt32Array(foes), centre.x, centre.y, 0)
		var worst := 0
		for t in 45 * FPS:
			S.tick(1)
			if t % 15 == 0:
				worst = maxi(worst, _inside(S, foes, C, R))
		worst = maxi(worst, _inside(S, foes, C, R))
		var stats: Dictionary = S.get_stats()
		modes[mode] = {"inside": worst, "nearest": snappedf(_closest(S, foes, centre), 0.1), "fields": int(stats.get("group_fields", 0))}
		if worst != 0:
			all_ok = false
		S.set_group_paths(0)
		_kill(S, foes)
		S.tick(2)
	# find_path from outside to the centre ends outside the ring
	var path: PackedVector2Array = S.find_path(C.x + 0.5, C.y + R + 8.5, centre.x, centre.y)
	var end: Vector2 = path[path.size() - 1] if path.size() > 0 else Vector2(-1, -1)
	var end_out: bool = not (end.x >= C.x - R + 1 and end.x < C.x + R and end.y >= C.y - R + 1 and end.y < C.y + R)
	# the ring pieces are all still standing (nobody attacked them on a move)
	_check("keepout", all_ok and end_out and _walls(S).count >= ring_ids.size(), {"modes": modes, "find_path_end": [end.x, end.y]})

func _closest(sim: Object, ids: Array, p: Vector2) -> float:
	var m := 1e9
	for id in _alive(sim, ids):
		var u: Dictionary = sim.get_unit(id)
		m = minf(m, Vector2(u.x, u.z).distance_to(p))
	return m

# gate ---------------------------------------------------------------------------

var gate_id := 0

func _south_segment() -> int:
	var W := _walls(S)
	for i in int(W.count):
		if int(W.kind[i]) == 1 and int(W.rect[i * 4 + 1]) == C.y + R and int(W.rect[i * 4 + 2]) >= 2:
			return int(W.ids[i])
	return 0

func _case_gate() -> void:
	var seg := _south_segment()
	var res0 := _res(S, 1)
	var r: Dictionary = S.convert_to_gate(seg)
	gate_id = seg if bool(r.ok) else 0
	var paid := res0 - _res(S, 1)
	var g: Dictionary = _piece(S, gate_id)
	var centre := Vector2(C.x + 0.5, C.y + 0.5)
	var detail := {"convert": r, "paid": [paid.x, paid.y], "kind": g.get("kind", -1)}
	var ok: bool = bool(r.ok) and int(g.get("kind", -1)) == 2
	var rejected: Dictionary = S.convert_to_gate(ring_ids[0] if _piece(S, ring_ids[0]).get("kind", -1) == 0 else 0)
	ok = ok and not bool(rejected.ok)
	# closed while nobody is near
	S.tick(30)
	var open0 := float(_piece(S, gate_id).get("open", 1))
	# owner, ally, enemy: the same move to the centre, from outside the south side
	var counts := {}
	var opened := 0.0
	for who in [[1, "owner"], [3, "ally"], [2, "enemy"]]:
		var ids := _spawn(S, "hoplite", who[0], 10, C.x - 2, C.y + R + 5, 5)
		S.tick(1)
		S.order_move(PackedInt32Array(ids), centre.x, centre.y)
		var peak := 0.0
		for t in 40 * FPS:
			S.tick(1)
			peak = maxf(peak, float(_piece(S, gate_id).get("open", 0)))
		counts[who[1]] = _inside(S, ids, C, R)
		if who[0] != 2:
			opened = maxf(opened, peak)
		detail["open_" + who[1]] = snappedf(peak, 0.01)
		# send the friends back out of the ring, the enemy away
		_kill(S, ids)
		S.tick(2)
	detail["inside"] = counts
	S.tick(60)
	var open_after := float(_piece(S, gate_id).get("open", 1))
	# locked: even the owner stays out
	var lk: Dictionary = S.set_gate_locked(gate_id, true)
	var mine := _spawn(S, "hoplite", 1, 10, C.x - 2, C.y + R + 5, 5)
	S.tick(1)
	S.order_move(PackedInt32Array(mine), centre.x, centre.y)
	var locked_peak := 0.0
	for t in 30 * FPS:
		S.tick(1)
		locked_peak = maxf(locked_peak, float(_piece(S, gate_id).get("open", 0)))
	var locked_in := _inside(S, mine, C, R)
	S.set_gate_locked(gate_id, false)
	# unlocked again: they walk in (a new order, the old path was refused)
	S.order_move(PackedInt32Array(mine), centre.x, centre.y)
	S.tick(30 * FPS)
	var unlocked_in := _inside(S, mine, C, R)
	_kill(S, mine)
	S.tick(2)
	detail.merge({"open_idle": open0, "open_after": open_after, "lock": lk, "locked_inside": locked_in, "locked_open": locked_peak,
		"unlocked_inside": unlocked_in})
	ok = ok and open0 == 0.0 and counts.owner >= 8 and counts.ally >= 8 and counts.enemy == 0 and opened >= 1.0 and open_after == 0.0
	ok = ok and bool(lk.ok) and locked_in == 0 and locked_peak == 0.0 and unlocked_in >= 8
	ok = ok and is_equal_approx(paid.x, 30.0) and is_equal_approx(paid.y, 20.0)
	_check("gate", ok, detail)

# repair -------------------------------------------------------------------------

func _case_repair() -> void:
	# two equal segments (not the gate): one repaired by one villager, one by four
	var W := _walls(S)
	var segs := []
	for i in int(W.count):
		if int(W.kind[i]) == 1 and int(W.rect[i * 4 + 2]) * int(W.rect[i * 4 + 3]) == 3 and int(W.rect[i * 4 + 1]) == C.y - R and segs.size() < 2:
			segs.append(int(W.ids[i]))
	var detail := {"segments": segs}
	if segs.size() < 2:
		_check("repair", false, detail)
		return
	var times := []
	var res0 := _res(S, 1)
	for k in 2:
		var id: int = segs[k]
		var p: Dictionary = _piece(S, id)
		S.damage(id, p.max_hp * 0.6 / 0.35, 0)   # (buildings take 0.35 of a plain hit)
		var hurt := float(_piece(S, id).get("hp", 0))
		var b: Dictionary = S.get_building(id)
		var who := _spawn(S, "villager", 1, 1 if k == 0 else 4, b.x - 1, b.z - 3, 4)
		S.tick(1)
		S.smart(PackedInt32Array(who), b.x, b.z, id)
		var orders := str(S.get_unit(who[0]).order)
		var t := 0
		while t < 120 * FPS:
			S.tick(1)
			t += 1
			if float(_piece(S, id).get("hp", 0)) >= p.max_hp - 0.01:
				break
		times.append(t / float(FPS))
		detail["seg%d" % k] = {"hurt": snappedf(hurt, 0.1), "max": p.max_hp, "order": orders, "hp": snappedf(float(_piece(S, id).get("hp", 0)), 0.1)}
		_kill(S, who)
		S.tick(2)
	var paid := res0 - _res(S, 1)
	detail["seconds"] = times
	detail["paid"] = [paid.x, paid.y]
	_check("repair", times[0] < 119 and times[1] < times[0] * 0.75 and paid == Vector2.ZERO and detail.seg0.order == "build", detail)

# breach -------------------------------------------------------------------------

func _case_breach() -> void:
	# (1) a house inside the ring; enemy soldiers told to attack it break a
	# piece and then the whole army goes in and razes the house
	var house := int(S.spawn_building("house", 1, C.x - 1, C.y - 1, true, false))
	var pieces_before := {}
	var W0 := _walls(S)
	for i in int(W0.count):
		pieces_before[int(W0.ids[i])] = [int(W0.rect[i * 4]), int(W0.rect[i * 4 + 1]), int(W0.rect[i * 4 + 2]), int(W0.rect[i * 4 + 3])]
	var foes := _spawn(S, "hoplite", 2, 12, C.x - 3, C.y - R - 6, 6)
	S.tick(1)
	for id in foes:
		S.order(id, {"type": "attack", "target": house})
	var rb := _breach_run(S, C, R, foes, house, false)
	# the broken piece's tiles are walkable again
	var W := _walls(S)
	var alive := {}
	for i in int(W.count):
		alive[int(W.ids[i])] = true
	var walk: PackedByteArray = S.get_walkable()
	var n := int(S.get_map_size())
	var walk_ok: bool = rb.broke_at_s > 0
	for id in pieces_before:
		if alive.has(id):
			continue
		var rc: Array = pieces_before[id]
		for z in range(rc[1], rc[1] + rc[3]):
			for x in range(rc[0], rc[0] + rc[2]):
				if walk[z * n + x] == 0:
					walk_ok = false
	_kill(S, foes)
	S.tick(2)
	rb["tiles_walkable"] = walk_ok
	# (2) the target is a unit: a villager inside a fresh closed ring; the
	# army breaks a piece, goes in to him and kills him (nobody waits outside)
	var ru := {}
	var sim := _new_sim(seed_arg + 9)
	var c := _open_area(sim, 30, 26.0)
	var bv := _spawn(sim, "villager", 1, 8, c.x - 3, c.y - R - 4, 8)
	sim.tick(1)
	for ln in _ring_lines(c, R):
		sim.place_wall(1, _w(ln[0]), _w(ln[1]), PackedInt32Array(bv))
	var built := _build_all(sim, 1, bv, 400.0)
	_kill(sim, bv)
	var victim := _spawn(sim, "villager", 1, 1, c.x + 0.5, c.y + 0.5)
	var ufoes := _spawn(sim, "hoplite", 2, 12, c.x - 3, c.y - R - 6, 6)
	sim.tick(1)
	for id in ufoes:
		sim.order(id, {"type": "attack", "target": victim[0]})
	ru = _breach_run(sim, c, R, ufoes, victim[0], true)
	ru["ring_built_s"] = built
	var ok_b: bool = rb.broke_at_s > 0 and walk_ok and rb.target_dead and rb.idle_outside_max == 0 and rb.inside_at_end * 4 >= rb.alive_at_end * 3
	var ok_u: bool = built > 0 and ru.broke_at_s > 0 and ru.target_dead and ru.idle_outside_max == 0 and ru.went_for_target * 4 >= ru.alive_at_break * 3
	_check("breach", ok_b and ok_u, {"building": rb, "unit": ru})

## Steps the breach scenario until the target is dead (240 s at most).
## idle_outside_max: most attackers idle outside the ring at one time while
## the target lived (the bar: 0); went_for_target: attackers that, after the
## first piece fell, attacked the target itself (or were inside); inside /
## alive at the end.
func _breach_run(sim: Object, c: Vector2i, r: int, foes: Array, target: int, is_unit: bool) -> Dictionary:
	var n0 := int(_walls(sim).count)
	var broke_t := -1.0
	var idle_out := 0
	var went := {}
	var alive_at_break := 0
	var dead := false
	var t_dead := -1.0
	for t in 240 * FPS:
		sim.tick(1)
		if t % 15 != 0:
			continue
		if broke_t < 0 and int(_walls(sim).count) < n0:
			broke_t = t / float(FPS)
			alive_at_break = _alive(sim, foes).size()
		var tg: Dictionary = sim.get_unit(target) if is_unit else sim.get_building(target)
		dead = tg.is_empty() or bool(tg.get("dead", false))
		if dead:
			t_dead = t / float(FPS)
			break
		var io := 0
		for id in _alive(sim, foes):
			var u: Dictionary = sim.get_unit(id)
			var ins: bool = u.x >= c.x - r + 1 and u.x < c.x + r and u.z >= c.y - r + 1 and u.z < c.y + r
			if str(u.order) == "idle" and not ins:
				io += 1
			if broke_t > 0 and (ins or int(u.get("target", 0)) == target):
				went[id] = true
		idle_out = maxi(idle_out, io)
	var left := _alive(sim, foes)
	return {"broke_at_s": broke_t, "target_dead": dead, "dead_at_s": t_dead, "idle_outside_max": idle_out,
		"went_for_target": went.size(), "alive_at_break": alive_at_break, "alive_at_end": left.size(), "inside_at_end": _inside(sim, foes, c, r)}

# towers + upgrades --------------------------------------------------------------

func _case_towers() -> void:
	var sim := _new_sim(seed_arg + 4)
	var c := _open_area(sim, 30, 26.0)
	var tvills := _spawn(sim, "villager", 1, 4, c.x - 2, c.y + 4, 4)
	sim.tick(1)
	var tower := int(sim.place_building("tower", 1, c.x - 1, c.y - 1, PackedInt32Array(tvills)))
	var tb: Dictionary = sim.get_building(tower)
	var built_s := -1.0
	for t in 120 * FPS:
		sim.tick(1)
		if bool(sim.get_building(tower).get("built", false)):
			built_s = t / float(FPS)
			break
	_kill(sim, tvills)
	sim.tick(2)
	sim.take_events()
	var tx := c.x + 0.0
	var tz := c.y + 0.0
	# an enemy in range, an ally and an own villager right next to it, an enemy out of range
	var foe := _spawn(sim, "villager", 2, 1, tx + 6, tz)
	var far := _spawn(sim, "villager", 2, 1, tx + 16, tz)
	var friends := _spawn(sim, "villager", 3, 3, tx - 3, tz + 2, 3) + _spawn(sim, "villager", 1, 2, tx + 2, tz - 3, 2)
	# Town Center arrows: an ally and an enemy beside player 1's Town Center
	var tc := _tc(sim, 1)
	var tc_ally := _spawn(sim, "villager", 3, 3, tc.x + 5, tc.z + 5, 3)
	var tc_foe := _spawn(sim, "villager", 2, 2, tc.x - 6, tc.z + 5, 2)
	var hits_foe := 0
	var hits_friend := 0
	var tc_hits_ally := 0
	var tc_hits_foe := 0
	var amounts := []
	var friend_ids := {}
	for id in friends + tc_ally:
		friend_ids[id] = true
	var killed := -1.0
	for t in 60 * FPS:
		sim.tick(1)
		for e in sim.take_events():
			if e.type != "unit:damaged":
				continue
			if int(e.other) == tower:
				if friend_ids.has(int(e.id)):
					hits_friend += 1
				else:
					hits_foe += 1
					amounts.append(float(e.amount))
			elif int(e.other) == int(tc.id):
				if friend_ids.has(int(e.id)):
					tc_hits_ally += 1
				else:
					tc_hits_foe += 1
		if killed < 0 and _alive(sim, foe).is_empty():
			killed = t / float(FPS)
	var far_alive := _alive(sim, far).size()
	var friends_hp := true
	for id in friends + tc_ally:
		var u: Dictionary = sim.get_unit(id)
		if u.is_empty() or u.dead or float(u.hp) < float(u.max_hp):
			friends_hp = false
	var f0: Dictionary = sim.get_fortify(1)
	if _want("towers"):
		_check("towers", built_s > 0 and killed > 0 and hits_foe > 0 and hits_friend == 0 and far_alive == 1 and friends_hp
				and tc_hits_ally == 0 and tc_hits_foe > 0,
			{"built_s": built_s, "killed_in_s": killed, "tower_hits_enemy": hits_foe, "tower_hits_friend": hits_friend,
				"out_of_range_alive": far_alive, "friends_unhurt": friends_hp, "tc_hits_ally": tc_hits_ally, "tc_hits_enemy": tc_hits_foe,
				"arrow": amounts[0] if amounts.size() > 0 else 0, "stage": f0.tower_name})
	_kill(sim, far + friends + tc_ally + tc_foe)
	sim.tick(2)
	if not _want("upgrades"):
		return
	# upgrades: each stage needs its age; numbers go up
	var detail := {}
	var r0: Dictionary = sim.research(tower, "watch_tower")
	detail["archaic_refused"] = r0.reason
	var stages := [f0.tower]
	var hp_seen := [float(_piece(sim, tower).max_hp)]
	var arrows := [amounts[0] if amounts.size() > 0 else 0.0]
	var ok := not bool(r0.ok)
	var skip: Dictionary = sim.research(tower, "guard_tower")
	ok = ok and not bool(skip.ok)
	for step in [[1, "watch_tower"], [2, "guard_tower"], [3, "ballista_tower"]]:
		sim.set_player_age(1, step[0])
		var rr: Dictionary = sim.research(tower, step[1])
		ok = ok and bool(rr.ok)
		for t in 70 * FPS:
			sim.tick(1)
			if int(sim.get_fortify(1).tower_level) >= step[0]:
				break
		var f: Dictionary = sim.get_fortify(1)
		stages.append(f.tower)
		hp_seen.append(float(_piece(sim, tower).max_hp))
		ok = ok and int(f.tower_level) == step[0]
		# one arrow at a fresh enemy just inside the new range
		var probe := _spawn(sim, "villager", 2, 1, tx + 1.0 + float(f.tower.range) - 0.6, tz + 0.5)
		sim.take_events()
		var got := 0.0
		for t in 10 * FPS:
			sim.tick(1)
			for e in sim.take_events():
				if e.type == "unit:damaged" and int(e.other) == tower and got == 0.0:
					got = float(e.amount)
			if got > 0:
				break
		arrows.append(got)
		_kill(sim, probe)
		sim.tick(2)
	for i in range(1, stages.size()):
		ok = ok and float(stages[i].range) > float(stages[i - 1].range) and float(stages[i].damage) > float(stages[i - 1].damage)
		ok = ok and hp_seen[i] > hp_seen[i - 1] and arrows[i] > arrows[i - 1]
	# wall stage: Stone Wall at a wall piece raises its hp
	var wv := _spawn(sim, "villager", 1, 2, c.x - 6, c.y - 8, 2)
	sim.tick(1)
	var w: Dictionary = sim.place_wall(1, Vector2(c.x - 8.5, c.y - 6.5), Vector2(c.x - 3.5, c.y - 6.5), PackedInt32Array(wv))
	_build_all(sim, 1, wv, 120.0)
	var wid: int = int(w.ids[0]) if w.ids.size() > 0 else 0
	var whp0 := float(_piece(sim, wid).get("max_hp", 0))
	var rw: Dictionary = sim.research(wid, "stone_wall")
	for t in 50 * FPS:
		sim.tick(1)
		if int(sim.get_fortify(1).wall_level) >= 1:
			break
	var whp1 := float(_piece(sim, wid).get("max_hp", 0))
	ok = ok and bool(rw.ok) and whp1 > whp0 * 2.0 and str(sim.get_fortify(1).wall_name) == "Stone Wall"
	detail.merge({"stages": stages.map(func(s): return [s.range, s.damage, s.hp]), "tower_max_hp": hp_seen, "arrow_damage": arrows,
		"wall_hp": [whp0, whp1], "stone_wall": rw})
	_check("upgrades", ok, detail)

# determinism --------------------------------------------------------------------

func _scenario(seed: int) -> String:
	var sim := _new_sim(seed)
	var c := _open_area(sim, 30, 26.0)
	var v := _spawn(sim, "villager", 1, 6, c.x - 3, c.y - 10, 6)
	sim.tick(1)
	for ln in _ring_lines(Vector2i(c.x, c.y), 5):
		sim.place_wall(1, _w(ln[0]), _w(ln[1]), PackedInt32Array(v))
	var tw := int(sim.place_building("tower", 1, c.x - 1, c.y - 1, PackedInt32Array()))
	_build_all(sim, 1, v, 300.0)
	sim.order_build(PackedInt32Array(v), tw)
	sim.tick(40 * FPS)
	var W: Dictionary = sim.get_walls()
	for i in int(W.count):
		if int(W.kind[i]) == 1 and int(W.rect[i * 4 + 1]) == c.y + 5:
			sim.convert_to_gate(int(W.ids[i]))
			break
	var foes := _spawn(sim, "hoplite", 2, 16, c.x - 3, c.y + 12, 4)
	var mine := _spawn(sim, "hoplite", 1, 6, c.x - 3, c.y - 12, 3)
	sim.tick(1)
	sim.order_attack_move(PackedInt32Array(foes), c.x + 0.5, c.y + 0.5)
	sim.order_move(PackedInt32Array(mine), c.x + 0.5, c.y + 0.5)
	for id in foes.slice(0, 4):
		sim.order(id, {"type": "attack", "target": tw})
	sim.tick(90 * FPS)
	W = sim.get_walls()
	return "%d|%d|%s|%s|%s" % [sim.units_hash(), int(W.count), str(W.hp), str(W.open), str(sim.get_player(1))]

func _case_determinism() -> void:
	var a := _scenario(3)
	var b := _scenario(3)
	_check("determinism", a == b and a.length() > 10, {"hash_a": a.substr(0, 40), "equal": a == b})

# rules off ----------------------------------------------------------------------

func _case_rules_off() -> void:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(false)
	sim.new_game(5, 128, "skirmish", 2)
	var st: Array = sim.get_starts()
	var p := Vector2(float(st[0].tx) + 12.5, float(st[0].tz) + 0.5)
	var r: Dictionary = sim.place_wall(1, p, p + Vector2(6, 0), PackedInt32Array())
	_check("rules_off", not bool(r.ok) and int(sim.get_walls().count) == 0, {"reason": r.reason})
