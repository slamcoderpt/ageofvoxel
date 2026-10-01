extends SceneTree
## Scripted check of the enemy AI's use of fortifications (Godot-only,
## native/src/sim/combat/enemy_ai_fort.cpp, PORTING.md "Enemy AI:
## fortifications"), headless, on AovSim matches of AIs:
##
##   build    a Hard AI left in peace 20 minutes towers its Town Center and resources
##            (2+ towers within 26 tiles of its Town Center), walls its town in
##            (a closed ring of its pieces round the Town Center) with gates
##            (1+, one per straight side the ground allows), its men still walk out (villagers gathering outside the
##            ring); Moderate builds towers but no wall, Easy at most one tower
##   upgrade  in the Classical Age it researches Watch Tower and Stone Wall
##   repair   a ring piece and a tower knocked down to 30 % are repaired
##   breach   a wave of 24 sent at a walled town (fortify_now) breaks in and
##            hits the Town Center; with the group's focus its hits gather on
##            few pieces (the two most hit take >= 50 %, 15 points more than
##            with each man on his nearest piece) and the first piece falls
##            no later
##   gap      with the piece that wave broke pulled down beforehand (an
##            opening), the wave walks in through it: no piece destroyed, the
##            Town Center reached sooner
##   fear     a small wave does not walk into three towers: it is held or
##            sent elsewhere (avoided > 0) and loses at most 2 men to them
##   determinism two identical Hard-vs-Titan runs end bit-equal
##   matches  AI vs AI with walls (Hard vs Hard, Titan vs Hard) end within
##            the cap (no stalemate behind walls)
##
##   godot --headless --path godot -s res://game/core/aifort_check.gd [-- --only=build,breach,... --seed=1 --minutes=50]
##
## Prints "AIFORT PASS|FAIL <case> {detail}" and "AIFORT_RESULT {json}"; exit = failures.

const MC := preload("res://game/core/match_check.gd")
const FPS := 30
var fails: Array = []
var passes := 0
var result := {}
var only: Array = []
var seed_arg := 1
var max_minutes := 50.0

func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7).split(",")
		elif a.begins_with("--seed="):
			seed_arg = int(a.substr(7))
		elif a.begins_with("--minutes="):
			max_minutes = float(a.substr(10))
	_run.call_deferred()

func _want(name: String) -> bool:
	return only.is_empty() or name in only

func _check(name: String, ok: bool, detail := {}) -> void:
	if ok:
		passes += 1
	else:
		fails.append(name)
	result[name] = detail.merged({"ok": ok})
	print("AIFORT %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

func _run() -> void:
	var t0 := Time.get_ticks_msec()
	if _want("build") or _want("upgrade") or _want("repair"):
		_case_build()
	if _want("breach"):
		_case_breach(false)
	if _want("gap"):
		_case_breach(true)
	if _want("fear"):
		_case_fear()
	if _want("determinism"):
		_case_determinism()
	if _want("matches"):
		_case_matches()
	result["passes"] = passes
	result["fails"] = fails
	result["wall_s"] = (Time.get_ticks_msec() - t0) / 1000.0
	print("AIFORT_RESULT %s" % JSON.stringify(result))
	quit(fails.size())

# ---- helpers ------------------------------------------------------------------

func _sim(ais: Array, seed := seed_arg, resources := "standard") -> Object:
	var ps := []
	for a in ais:
		ps.append({"ai": a})
	var sim: Object = MC.new_sim(MC.cfg(seed, 128, "skirmish", ps, resources))
	sim.set_fog_reveal_all(true)
	return sim

func _tc(sim: Object, owner: int) -> Vector2:
	var t: Dictionary = MC.tc_of(sim, owner)
	return Vector2(float(t.get("x", 0)), float(t.get("z", 0))) if not t.is_empty() else Vector2(-1, -1)

func _fort(sim: Object, owner: int) -> Dictionary:
	return sim.get_ai(owner).get("fort", {})

## pieces of an owner: [{id, kind, rect: Rect2i, hp, max_hp, built}]
func _pieces(sim: Object, owner: int) -> Array:
	var W: Dictionary = sim.get_walls()
	var out := []
	for i in int(W.count):
		if int(W.owner[i]) != owner:
			continue
		out.append({"id": int(W.ids[i]), "kind": int(W.kind[i]), "rect": Rect2i(W.rect[i * 4], W.rect[i * 4 + 1], W.rect[i * 4 + 2], W.rect[i * 4 + 3]),
			"hp": float(W.hp[i]), "max_hp": float(W.max_hp[i]), "built": bool(W.built[i])})
	return out

## Is the ring closed round point c for walls only (pieces of `owner`)? A
## flood over the tiles from c that stops at the owner's wall pieces and at
## unwalkable ground must stay within `r` tiles (gates count as walls).
func _ring_closed(sim: Object, owner: int, c: Vector2, r: int) -> bool:
	var n: int = sim.get_map_size()
	var walk: PackedByteArray = sim.get_walkable()
	var wall := {}
	for p in _pieces(sim, owner):
		if p.kind == 3:
			continue
		var R: Rect2i = p.rect
		for z in range(R.position.y, R.end.y):
			for x in range(R.position.x, R.end.x):
				wall[z * n + x] = true
	# from the walkable tiles round the Town Center; walls and unwalkable
	# ground (trees, mines, buildings) stop the flood: the opening must be closed
	# by something (the AI leaves gaps where trees stand, as players do)
	var seen := {}
	var q: Array = []
	for dz in range(-4, 5):
		for dx in range(-4, 5):
			var s0 := Vector2i(int(c.x) + dx, int(c.y) + dz)
			if walk[s0.y * n + s0.x] != 0 and not seen.has(s0.y * n + s0.x):
				seen[s0.y * n + s0.x] = true
				q.append(s0)
	while not q.is_empty():
		var t: Vector2i = q.pop_back()
		if absi(t.x - int(c.x)) > r or absi(t.y - int(c.y)) > r:
			return false
		for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
			var u: Vector2i = t + d
			if u.x < 0 or u.y < 0 or u.x >= n or u.y >= n:
				continue
			var i := u.y * n + u.x
			if seen.has(i) or wall.has(i) or walk[i] == 0:
				continue
			seen[i] = true
			q.append(u)
	return true

# ---- build / upgrade / repair -----------------------------------------------------------

func _case_build() -> void:
	var sim := _sim(["hard", "easy"])
	sim.set_ai(2, {"enabled": false})
	sim.set_victory_enabled(false)
	sim.tick(20 * 60 * FPS)
	var f := _fort(sim, 1)
	var tc := _tc(sim, 1)
	var towers := 0
	var gates := 0
	var walls := 0
	var far := 0.0
	for p in _pieces(sim, 1):
		if p.kind == 3:
			towers += int(p.built)
			far = maxf(far, (Vector2(p.rect.get_center()) - tc).length())
		elif p.kind == 2:
			gates += 1
		else:
			walls += 1
	var closed := _ring_closed(sim, 1, tc, 40)
	# men outside the ring (gatherers walk out through the gates)
	var U: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := 0
	var R := float(f.get("ring_r", 0))
	for i in int(U.count):
		if int(U.owner[i]) == 1 and names[U.type[i]] == "villager" and not (int(U.flags[i]) & 2):
			var d := Vector2(U.pos[i * 2], U.pos[i * 2 + 1]) - tc
			if maxf(absf(d.x), absf(d.y)) > R + 1:
				out += 1
	var ok := towers >= 2 and far <= 26 and walls >= 10 and gates >= 1 and closed and int(f.ring_state) == 3 and out >= 1
	var g: Dictionary = f.duplicate()
	g.erase("gaps")
	_check("build", ok, {"towers": towers, "tower_max_dist": snappedf(far, 0.1), "wall_pieces": walls, "gates": gates, "closed": closed,
		"villagers_outside": out, "fort": g})
	# upgrades: put it in the Classical Age with stock, a few minutes on
	if _want("upgrade"):
		sim.set_player_age(1, 1)
		sim.set_player_resources(1, {"food": 3000, "wood": 3000, "gold": 3000, "favor": 50})
		sim.tick(3 * 60 * FPS)
		var fz: Dictionary = sim.get_fortify(1)
		_check("upgrade", int(fz.tower_level) >= 1 and int(fz.wall_level) >= 1,
			{"tower": fz.tower_name, "wall": fz.wall_name, "upgrades": _fort(sim, 1).upgrades})
	if _want("repair"):
		var wall_id := 0
		var tower_id := 0
		for p in _pieces(sim, 1):
			if p.built and p.kind == 1 and wall_id == 0:
				wall_id = p.id
			if p.built and p.kind == 3 and tower_id == 0:
				tower_id = p.id
		for id in [wall_id, tower_id]:
			for k in 40:
				var b: Dictionary = sim.get_building(id)
				if b.is_empty() or float(b.hp) < float(b.max_hp) * 0.3:
					break
				sim.damage(id, float(b.max_hp) * 0.1)
		var r0 := int(_fort(sim, 1).repairs)
		sim.tick(90 * FPS)
		var hw: Dictionary = sim.get_building(wall_id)
		var ht: Dictionary = sim.get_building(tower_id)
		var sw := float(hw.hp) / float(hw.max_hp) if not hw.is_empty() else 0.0
		var st := float(ht.hp) / float(ht.max_hp) if not ht.is_empty() else 0.0
		_check("repair", sw > 0.6 and st > 0.6 and int(_fort(sim, 1).repairs) > r0,
			{"wall_hp": snappedf(sw, 0.01), "tower_hp": snappedf(st, 0.01), "repairs": int(_fort(sim, 1).repairs) - r0})
	# Moderate: towers, no walls; Easy: one tower at most
	var ok2 := true
	var det := {}
	for d in ["moderate", "easy"]:
		var s2 := _sim([d, "easy"])
		s2.set_ai(2, {"enabled": false})
		s2.set_victory_enabled(false)
		s2.tick(14 * 60 * FPS)
		var f2 := _fort(s2, 1)
		det[d] = {"towers": f2.towers, "wall_tiles": f2.wall_tiles}
		ok2 = ok2 and int(f2.wall_tiles) == 0 and (int(f2.towers) <= 1 if d == "easy" else int(f2.towers) >= 1)
	_check("difficulty", ok2, det)

# ---- breach / gap -----------------------------------------------------------------

func _case_breach(gap: bool) -> void:
	var name := "gap" if gap else "breach"
	var a := _breach_run(0, true)
	if gap:
		# the piece the wave broke above pulled down before it comes: it walks
		# in through the opening (at most a touch on the pieces beside it)
		# and reaches the Town Center sooner
		var c := _breach_run(int(a.first_piece), true)
		_check(name, int(c.tc_hits) > 0 and int(c.pieces_destroyed) == 0 and float(c.tc_s) < float(a.tc_s),
			{"opened": a.first_piece, "with_opening": c, "walled": {"tc_s": a.tc_s}})
		return
	# the same wave without the focus (each man on his nearest piece)
	var b := _breach_run(0, false)
	# (a wave that meets the wall at one piece needs no focus: one or two pieces hit is the goal)
	var ok := int(a.tc_hits) > 0 and int(a.pieces_destroyed) >= 1 and float(a.top2_share) >= 0.5 \
		and (int(a.pieces_hit) <= 2 or (int(a.focus) > 0 and float(a.top2_share) >= float(b.top2_share) + 0.15)) \
		and int(a.first_down_s) <= int(b.first_down_s)
	_check(name, ok, {"focus": a, "nearest": b})

## Player 2 walled in at once (fortify_now), player 1 sends a wave of 24
## hoplites at it; stats of the hits player 1's men land on the wall pieces
## (`open`: that piece pulled down first, an opening).
func _breach_run(open: int, focus: bool) -> Dictionary:
	var sim := _sim(["hard", "hard"], seed_arg)
	sim.set_victory_enabled(false)
	sim.set_player_resources(2, {"food": 2000, "wood": 2000, "gold": 2000, "favor": 0})
	sim.set_ai(2, {"fortify_now": 0, "enabled": false})
	sim.set_player_resources(1, {"food": 2000, "wood": 0, "gold": 0, "favor": 0}) # (no god power, no wall of its own)
	var tc2 := _tc(sim, 2)
	var tc1 := _tc(sim, 1)
	var pieces := _pieces(sim, 2)
	if open:
		sim.destroy_building(open)
	var dir := (tc2 - tc1).normalized()
	sim.spawn_block("hoplite", 1, 24, tc1.x + dir.x * 8, tc1.y + dir.y * 8, 6, 1.2, 0.0, 0.1)
	sim.set_ai(1, {"next_wave_at": 0, "wave_size": 20, "fort": false, "breach_focus": focus})
	var ids := {}
	for p in pieces:
		if p.id != open and p.kind != 3:
			ids[p.id] = true
	var hit := {}
	var died := 0
	var first_down := -1
	var first_piece := 0
	var tc_hit := 0
	var tc_s := 999.0
	var tc2_id := int(MC.tc_of(sim, 2).get("id", 0))
	var t := 0
	while t < 5 * 60 * FPS:
		sim.tick(30)
		t += 30
		for e in sim.take_events():
			var ty := str(e.type)
			if ty == "unit:damaged" and int(e.owner) == 1:
				if ids.has(int(e.id)):
					hit[int(e.id)] = int(hit.get(int(e.id), 0)) + 1
				elif int(e.id) == tc2_id:
					tc_hit += 1
					tc_s = minf(tc_s, t / float(FPS))
			elif ty == "entity:died" and ids.has(int(e.id)):
				died += 1
				if first_down < 0:
					first_down = t / FPS
					first_piece = int(e.id)
		if tc_hit > 20:
			break
	var v: Array = hit.values()
	v.sort()
	v.reverse()
	var total := 0
	for k in v:
		total += int(k)
	var top2 := (int(v[0]) + (int(v[1]) if v.size() > 1 else 0)) if not v.is_empty() else 0
	return {"pieces_hit": hit.size(), "hits": v, "top2_share": snappedf(float(top2) / maxf(1.0, total), 0.01), "pieces_destroyed": died,
		"first_down_s": first_down if first_down >= 0 else 999, "first_piece": first_piece, "tc_hits": tc_hit, "tc_s": tc_s,
		"focus": _fort(sim, 1).focus, "s": t / FPS}

# ---- tower fear ---------------------------------------------------------------------

func _case_fear() -> void:
	var sim := _sim(["hard", "hard"], seed_arg, "deathmatch")
	sim.set_victory_enabled(false)
	sim.set_ai(2, {"enabled": false})
	var tc1 := _tc(sim, 1)
	var tc2 := _tc(sim, 2)
	# three towers round player 2's Town Center (built), nothing else in front
	var placed := 0
	for k in 12:
		if placed >= 3:
			break
		var a := TAU * k / 12.0
		var tx := int(tc2.x + cos(a) * 5) - 1
		var tz := int(tc2.y + sin(a) * 5) - 1
		if sim.can_place("tower", tx, tz):
			sim.spawn_building("tower", 2, tx, tz, true)
			placed += 1
	var dir := (tc2 - tc1).normalized()
	var men: PackedInt32Array = sim.spawn_block("hoplite", 1, 6, tc1.x + dir.x * 8, tc1.y + dir.y * 8, 3, 1.2, 0.0, 0.1)
	sim.set_ai(1, {"next_wave_at": 0, "wave_size": 6, "fort": false})
	var lost := 0
	var tower_ids := {}
	for p in _pieces(sim, 2):
		if p.kind == 3:
			tower_ids[p.id] = true
	var t := 0
	while t < 3 * 60 * FPS:
		sim.tick(30)
		t += 30
		for e in sim.take_events():
			if str(e.type) == "entity:died" and int(e.id) in men and tower_ids.has(int(e.other)):
				lost += 1
	var f := _fort(sim, 1)
	_check("fear", placed == 3 and int(f.avoided) + int(f.retreats) > 0 and lost <= 2,
		{"towers": placed, "avoided": f.avoided, "retreats": f.retreats, "men_lost_to_towers": lost, "waves": (sim.get_ai(1).waves as Array).size()})

# ---- determinism ----------------------------------------------------------------------

func _det_run() -> Array:
	var sim := _sim(["hard", "titan"], seed_arg + 1)
	sim.set_victory_enabled(false)
	sim.tick(14 * 60 * FPS)
	var W: Dictionary = sim.get_walls()
	return [sim.units_hash(), int(W.count), Array(W.ids).hash(), Array(W.hp).hash(), JSON.stringify(_fort(sim, 1)), JSON.stringify(_fort(sim, 2))]

func _case_determinism() -> void:
	var a := _det_run()
	var b := _det_run()
	_check("determinism", a == b, {"a": [a[0], a[1]], "b": [b[0], b[1]]})

# ---- AI vs AI: no stalemate behind walls -------------------------------------------------

func _case_matches() -> void:
	var ok := true
	var det := []
	for m in [["hard", "hard", seed_arg], ["titan", "hard", seed_arg + 1], ["hard", "titan", seed_arg + 2]]:
		var sim := _sim([m[0], m[1]], m[2])
		var ticks := int(max_minutes * 60 * FPS)
		while sim.get_tick() < ticks and not sim.get_victory().decided:
			sim.tick(300)
			sim.take_events()
		var v: Dictionary = sim.get_victory()
		var f1 := _fort(sim, 1)
		var f2 := _fort(sim, 2)
		det.append({"p1": m[0], "p2": m[1], "seed": m[2], "decided": v.decided, "winner": v.get("winner", 0), "minutes": snappedf(sim.get_time() / 60.0, 0.1),
			"walls": [f1.wall_tiles, f2.wall_tiles], "gates": [f1.gates, f2.gates], "towers": [f1.towers, f2.towers], "focus": [f1.focus, f2.focus],
			"retreats": [f1.retreats, f2.retreats]})
		print("AIFORT   match %s" % JSON.stringify(det.back()))
		ok = ok and bool(v.decided)
	_check("matches", ok, {"matches": det})
