extends SceneTree
## Scripted check of the Godot-only combat-while-moving rules (combat.h):
## in the real skirmish (main scene, headless, enemy AI off), small armies are
## spawned on open ground far from both towns and stepped tick by tick:
##
##   1. a group on a plain move whose path runs past enemies that attack it
##      from the front stops, fights back, then walks on and arrives;
##   2. a group on a plain move away from chasing cavalry keeps running (a
##      retreat: nobody turns round before arriving);
##
##   godot --headless --path godot -s res://game/core/attackmove_check.gd -- --scene=skirmish
##
## Prints "ATTACKMOVE PASS|FAIL <case>" and "ATTACKMOVE_RESULT {json}";
## exits with the number of failed cases.

var main: Node
var sim: Object
var fails: Array = []
var passes := 0
var result := {}
var spawned: Array = []

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
	print("ATTACKMOVE %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

## An open strip w x h tiles (all walkable) at least `far` tiles from every start.
func _open_area(w: int, h: int, far: float, skip: Array) -> Vector2:
	var n := int(sim.get_map_size())
	var walk: PackedByteArray = sim.get_walkable()
	var starts: Array = sim.get_starts()
	for cz in range(h, n - h, 3):
		for cx in range(w, n - w, 3):
			var c := Vector2(cx + 0.5, cz + 0.5)
			var ok := true
			for s in starts:
				if c.distance_to(Vector2(float(s.tx), float(s.tz))) < far:
					ok = false
			for o in skip:
				if c.distance_to(o) < w:
					ok = false
			if not ok:
				continue
			for z in range(cz - h / 2, cz + h / 2 + 1):
				for x in range(cx - w / 2, cx + w / 2 + 1):
					if walk[z * n + x] == 0:
						ok = false
						break
				if not ok:
					break
			if ok:
				return c
	return Vector2(-1, -1)

func _spawn(type: String, owner: int, count: int, x: float, z: float, cols := 4) -> Array:
	var ids := []
	for i in count:
		var id := int(sim.spawn_unit(type, owner, x + (i % cols) * 1.1, z + (i / cols) * 1.1, 0.0))
		ids.append(id)
		spawned.append(id)
	return ids

func _alive(ids: Array) -> Array:
	return ids.filter(func(id): var u: Dictionary = sim.get_unit(id); return not u.is_empty() and not u.dead)

func _clear() -> void:
	for id in spawned:
		sim.kill_unit(id)
	spawned = []
	sim.tick(2)

func _near(ids: Array, p: Vector2, r: float) -> int:
	var n := 0
	for id in _alive(ids):
		var u: Dictionary = sim.get_unit(id)
		if Vector2(u.x, u.z).distance_to(p) <= r and str(u.order) == "idle":
			n += 1
	return n

func _run() -> void:
	for i in 3:
		await process_frame
	sim = main.sim
	main.paused = true   # this script steps the sim
	sim.set_ai_enabled(false)
	sim.set_victory_enabled(false)
	# every case on the same open strip (the dead of the last case are cleared first)
	var c := _open_area(40, 10, 30.0, [])
	print("ATTACKMOVE area %s" % c)
	if c.x < 0:
		_check("open area", false)
		quit(1)
		return

	# 1. plain move past enemies that attack from the front -------------------------
	var ours := _spawn("hoplite", 1, 8, c.x - 18, c.y - 1)
	var dest := Vector2(c.x + 18, c.y)
	# idle enemy hoplites 3 tiles off the path, halfway: they charge the column head-on
	var foes := _spawn("hoplite", 2, 3, c.x, c.y + 3, 3)
	sim.tick(1)
	sim.order_move(PackedInt32Array(ours), dest.x, dest.y)
	var fought := 0
	var resumed := 0
	var t_all_dead := -1.0
	for t in 30 * 60:
		sim.tick(1)
		for id in _alive(ours):
			var u: Dictionary = sim.get_unit(id)
			if str(u.order) == "attack" and int(u.resume) == 1:
				fought = maxi(fought, 1)
		if OS.get_environment("AM_DEBUG") != "" and t % 15 == 0:
			var line := "t=%.1f" % (t / 30.0)
			for id in ours + foes:
				var u: Dictionary = sim.get_unit(id)
				line += " %d:%s%s(%.0f,%.0f)%d" % [id, str(u.order).substr(0, 3), str(u.resume), u.x, u.z, int(u.hp)] if not u.dead else " %d:X" % id
			print(line)
		if t_all_dead < 0 and _alive(foes).is_empty():
			t_all_dead = t / 30.0
		if t_all_dead >= 0:
			for id in _alive(ours):
				if str(sim.get_unit(id).order) == "move":
					resumed += 1
			if _near(ours, dest, 4.0) == _alive(ours).size():
				break
	var arrived := _near(ours, dest, 4.0)
	var n_alive := _alive(ours).size()
	_check("1 plain move: fights back from the front, then walks on", fought > 0 and t_all_dead >= 0 and n_alive > 0 and arrived == n_alive and resumed > 0,
		{"fought": fought > 0, "foes_dead_at_s": t_all_dead, "alive": n_alive, "arrived": arrived})
	_clear()

	# 2. plain move away from chasing cavalry: a retreat --------------------------------
	ours = _spawn("hoplite", 1, 6, c.x - 14, c.y - 1, 3)
	dest = Vector2(c.x + 18, c.y)
	foes = _spawn("hippikon", 2, 2, c.x - 19, c.y, 2)
	sim.tick(1)
	sim.order_move(PackedInt32Array(ours), dest.x, dest.y)
	for i in foes.size():
		sim.order(foes[i], {"type": "attack", "target": ours[i]})
	var turned := 0
	var hits := 0
	var hp0 := 0.0
	for id in ours: hp0 += float(sim.get_unit(id).hp)
	for t in 30 * 30:
		sim.tick(1)
		var moving := 0
		for id in _alive(ours):
			var u: Dictionary = sim.get_unit(id)
			var o := str(u.order)
			if o == "move":
				moving += 1
			elif o == "attack" and Vector2(u.x, u.z).distance_to(dest) > 4.0:
				turned += 1   # (at the destination a man may fight: he is idle there)
		if moving == 0:
			break
	var hp1 := 0.0
	for id in _alive(ours): hp1 += float(sim.get_unit(id).hp)
	arrived = 0
	for id in _alive(ours):
		var u: Dictionary = sim.get_unit(id)
		if Vector2(u.x, u.z).distance_to(dest) <= 4.0: arrived += 1
	n_alive = _alive(ours).size()
	_check("2 plain move away from a chaser keeps running", turned == 0 and hp1 < hp0 and arrived == n_alive and n_alive > 0,
		{"turned_ticks": turned, "hp_lost": snappedf(hp0 - hp1, 0.1), "alive": n_alive, "arrived": arrived})
	_clear()

	print("ATTACKMOVE_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails, "cases": result}))
	quit(fails.size())
