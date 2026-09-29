extends SceneTree
## AI-vs-AI skirmish check: the real main scene (skirmish, every piece
## loaded), an EnemyAI for player 1 too, the sim stepped fast until Victory
## decides the match. Logs every attack wave (size, target, where its men
## are over time, whether it reached the target) and every god power cast,
## then one summary line:
##
##   godot --headless --path godot -s res://game/core/aivai.gd -- --scene=skirmish --seed=5 [--minutes=60] [--quiet=1] [--verbose=1]
##
## Prints "AIVAI_RESULT {json}"; exits 0 when the match was decided with no
## script errors, 1 otherwise. A wave "arrived" when half of its men got
## within ARRIVE tiles of the building it was sent at.

const ARRIVE := 16.0
const STEP := 15            # sim ticks per frame (0.5 s)

var main: Node = null
var started := false
var t0 := 0
var max_ticks := 0
var quiet := false
var verbose := false        # --verbose=1: dump the men of a wave still short of its target after 100 s
var waves := {}             # "owner:index" -> {owner, t, size, target, x, z, units, arrived, best, fought}
var casts := {}             # owner -> {power: n}
var free_vills := {}        # owner -> n
var last_log := 0.0
var trained := {}           # owner -> villagers trained

func _initialize() -> void:
	t0 = Time.get_ticks_msec()
	var a := AovArgs.parse()
	max_ticks = int(float(a.get("minutes", 60)) * 60.0 * 30.0)
	quiet = AovArgs.flag(a, "quiet", false)
	verbose = AovArgs.flag(a, "verbose", false)
	main = load("res://game/main.tscn").instantiate()
	root.add_child(main)

func _process(_delta: float) -> bool:
	if main == null or main.sim == null:
		return false
	var sim: Object = main.sim
	if not started:
		started = true
		sim.add_ai(1)
		main.paused = true  # this script steps the sim
		print("AIVAI start seed=%d players=%s" % [sim.get_seed(), sim.get_player_ids()])
		return false
	_read_events(sim)
	var v: Dictionary = sim.get_victory()
	if v.decided or sim.get_tick() >= max_ticks:
		_finish(sim, v)
		return true
	sim.tick(STEP)
	_track(sim)
	return false

func _read_events(sim: Object) -> void:
	for e in main.events:
		match str(e.type):
			"godpower:cast":
				var pn: String = sim.power_names()[int(e.a)]
				var o := int(e.owner)
				if not casts.has(o): casts[o] = {}
				casts[o][pn] = int(casts[o].get(pn, 0)) + 1
				if not quiet:
					print("AIVAI t=%6.1f p%d casts %s at (%.1f, %.1f)" % [sim.get_time(), o, pn, e.x, e.z])

func _track(sim: Object) -> void:
	var u: Dictionary = sim.get_units()
	var idx := {}
	for i in int(u.count):
		idx[int(u.ids[i])] = i
	for o in [1, 2]:
		var ai: Dictionary = sim.get_ai(o)
		var list: Array = ai.get("waves", [])
		for k in list.size():
			var key := "%d:%d" % [o, k]
			if not waves.has(key):
				var w: Dictionary = list[k]
				waves[key] = {"owner": o, "t": float(w.t), "size": (w.units as PackedInt32Array).size(), "target": int(w.target),
					"x": float(w.x), "z": float(w.z), "units": w.units, "arrived": -1.0, "best": 1e9, "done": false}
				if not quiet:
					print("AIVAI t=%6.1f p%d wave %d launched: %d men -> building %d at (%.0f, %.0f)" % [sim.get_time(), o, k, waves[key].size, w.target, w.x, w.z])
	var now: float = sim.get_time()
	var log_now := now - last_log >= 20.0
	if log_now:
		last_log = now
	if log_now and not quiet:
		var names: PackedStringArray = sim.unit_type_names()
		for o in [1, 2]:
			var nv := 0
			var army := {}
			for i in int(u.count):
				if int(u.owner[i]) != o or (u.flags[i] & 2): continue
				if names[u.type[i]] == "villager":
					nv += 1
				else:
					var on := int(u.order[i])
					army[on] = int(army.get(on, 0)) + 1
			var p: Dictionary = sim.get_player(o)
			print("AIVAI t=%6.1f p%d: %d villagers, army orders %s, food %d wood %d gold %d favor %d, pop %d/%d age %d" % [now, o, nv, army,
				p.food, p.wood, p.gold, p.favor, p.pop, p.pop_cap, p.age])
	for key in waves:
		var w: Dictionary = waves[key]
		if w.done:
			continue
		var alive := 0
		var near := 0
		var sx := 0.0
		var sz := 0.0
		var orders := {}
		for id in w.units:
			if not idx.has(id):
				continue
			var i: int = idx[id]
			if u.flags[i] & 2:
				continue
			alive += 1
			var x: float = u.pos[i * 2]
			var z: float = u.pos[i * 2 + 1]
			sx += x
			sz += z
			if Vector2(x - w.x, z - w.z).length() <= ARRIVE:
				near += 1
			var on := int(u.order[i])
			orders[on] = int(orders.get(on, 0)) + 1
		if alive > 0:
			var d := Vector2(sx / alive - w.x, sz / alive - w.z).length()
			w.best = minf(w.best, d)
		if w.arrived < 0 and alive > 0 and near * 2 >= alive:
			w.arrived = now
			if not quiet:
				print("AIVAI t=%6.1f p%d wave %s ARRIVED (%d/%d near the target, %.0f s after launch)" % [now, w.owner, key, near, w.size, now - w.t])
		if log_now and not quiet:
			var c := Vector2(sx / maxi(1, alive), sz / maxi(1, alive))
			print("AIVAI t=%6.1f p%d wave %s: %d/%d alive, centre (%.0f, %.0f) %.0f tiles from target, %d near, orders %s" % [
				now, w.owner, key, alive, w.size, c.x, c.y, Vector2(c.x - w.x, c.y - w.z).length(), near, orders])
		if log_now and verbose and alive > 0 and near * 2 < alive and now - w.t > 100.0 and now - w.t < 125.0:
			for id in w.units:
				if idx.has(id) and not (u.flags[idx[id]] & 2):
					var d: Dictionary = sim.get_unit(id)
					var tid := int(d.get("target", 0))
					var tk := int(sim.entity_kind(tid))
					var td: Dictionary = sim.get_unit(tid) if tk == 1 else (sim.get_building(tid) if tk == 2 else {})
					print("AIVAI    stalled man %d: %s\n        target kind %d: %s" % [id, d, tk, td])
		if alive == 0 or now - w.t > 240.0:
			w.done = true

func _finish(sim: Object, v: Dictionary) -> void:
	var per := {}
	for o in [1, 2]:
		var launched := 0
		var arrived := 0
		var sizes := []
		for key in waves:
			var w: Dictionary = waves[key]
			if w.owner != o: continue
			launched += 1
			sizes.append("%d%s(best %.0f)" % [w.size, "+" if w.arrived >= 0 else "-", w.best])
			if w.arrived >= 0: arrived += 1
		per[str(o)] = {"waves": launched, "arrived": arrived, "sizes": sizes, "casts": casts.get(o, {})}
	var res := {"seed": sim.get_seed(), "decided": bool(v.decided), "winner": int(v.get("winner", 0)), "time": float(sim.get_time()),
		"errors": main.errors.size(), "wall_s": (Time.get_ticks_msec() - t0) / 1000.0, "players": per}
	print("AIVAI_RESULT %s" % JSON.stringify(res))
	quit(0 if v.decided and main.errors.is_empty() else 1)
