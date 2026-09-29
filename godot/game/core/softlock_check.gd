extends SceneTree
## Scripted check of the free-villager rule (Economy::rescue): in the real
## skirmish (main scene, headless), kill every villager of the player and
## of the AI, drop their food below a villager's cost, then run the match
## and count the villagers each Town Center trains for free.
##
##   godot --headless --path godot -s res://game/core/softlock_check.gd -- --scene=skirmish
##
## Prints "SOFTLOCK ok|FAIL <step>" and "SOFTLOCK_RESULT {json}"; exits with
## the number of failed steps.

var main: Node
var sim: Object
var fails: Array = []
var passes := 0
var free_called := {1: 0, 2: 0}
var feed_seen := false

func _initialize() -> void:
	main = load("res://game/main.tscn").instantiate()
	root.add_child(main)
	_run.call_deferred()

func _check(name: String, ok: bool, detail := "") -> void:
	if ok:
		passes += 1
		print("SOFTLOCK ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("SOFTLOCK FAIL %s %s" % [name, detail])

func _villagers(owner: int) -> Array:
	var u: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in int(u.count):
		if int(u.owner[i]) == owner and not (u.flags[i] & 2) and names[u.type[i]] == "villager":
			out.append(int(u.ids[i]))
	return out

func _tc(owner: int) -> int:
	var b: Dictionary = sim.get_buildings()
	for i in int(b.count):
		if int(b.owner[i]) == owner and b.type_names[b.type[i]] == "town_center":
			return int(b.ids[i])
	return 0

func _free_in_queue(owner: int) -> int:
	var n := 0
	for it in sim.get_building(_tc(owner)).get("queue", []):
		if bool(it.get("free", false)): n += 1
	return n

## Step the sim n seconds, a frame per second so main.gd drains the events
## into the pieces (the ui feed) and this script counts them.
func _step(seconds: int) -> void:
	for s in seconds:
		sim.tick(30)
		await process_frame
		for e in main.events:
			var t := str(e.type)
			if t == "villager:free":
				free_called[int(e.owner)] += 1
		for f in main.pieces.ui.feed_items:
			if str(f.text).begins_with("Your Town Center calls"):
				feed_seen = true

func _run() -> void:
	for i in 3:
		await process_frame
	sim = main.sim
	main.paused = true  # this script steps the sim
	sim.add_ai(1)       # both seats played by the AI, so both rescues are exercised against a live opponent
	sim.set_ai(1, {"enabled": false})
	await _step(5)

	# 1. a player who can still afford a villager gets nothing for free
	for id in _villagers(1): sim.kill_unit(id)
	sim.set_player_resources(1, {"food": 120.0})
	await _step(3)
	_check("no free villager while one is affordable", free_called[1] == 0 and _free_in_queue(1) == 0)
	# a villager already paid for and queued: no free one either, even broke
	var r: Dictionary = sim.train(_tc(1), "villager")
	sim.set_player_resources(1, {"food": 10.0})
	await _step(3)
	_check("no free villager while one is queued", r.ok and free_called[1] == 0 and _free_in_queue(1) == 0, "queue %d" % sim.get_building(_tc(1)).queue.size())
	await _step(15)  # the paid villager comes out
	for id in _villagers(1): sim.kill_unit(id)
	sim.set_player_resources(1, {"food": 10.0})

	# 2. the soft-lock: no villager alive or queued, food below the cost
	for id in _villagers(2): sim.kill_unit(id)
	var q2: Array = sim.get_building(_tc(2)).get("queue", [])
	for i in range(q2.size() - 1, -1, -1):
		sim.cancel_train(_tc(2), i)  # (the AI keeps two villagers queued)
	sim.set_player_resources(2, {"food": 5.0})
	var v1_0 := _villagers(1).size()
	var v2_0 := _villagers(2).size()
	await _step(2)
	_check("free villager queued (player)", _free_in_queue(1) == 1 and free_called[1] == 1, "free in queue %d" % _free_in_queue(1))
	_check("free villager queued (AI)", _free_in_queue(2) == 1 and free_called[2] == 1, "free in queue %d" % _free_in_queue(2))
	var p1: Dictionary = sim.get_player(1)
	_check("free villager costs nothing", absf(float(p1.food) - 10.0) < 0.01, "food %.1f" % p1.food)
	# no stacking while it trains
	var max_free := 0
	for s in 6:
		await _step(1)
		max_free = maxi(max_free, maxi(_free_in_queue(1), _free_in_queue(2)))
	_check("free villagers never stack", max_free == 1 and free_called[1] == 1 and free_called[2] == 1, "max %d in a queue" % max_free)
	await _step(10)
	_check("exactly one free villager trained (player)", _villagers(1).size() == v1_0 + 1 and free_called[1] == 1, "%d villagers" % _villagers(1).size())
	_check("exactly one free villager trained (AI)", _villagers(2).size() >= v2_0 + 1 and free_called[2] == 1, "%d villagers" % _villagers(2).size())
	_check("HUD feed line for the player", feed_seen)
	# the rescued player is not rescued again while its villager lives (still broke)
	sim.set_player_resources(1, {"food": 10.0})
	await _step(20)
	_check("no second free villager while one lives", free_called[1] == 1, "%d calls" % free_called[1])
	# cancelling the free villager refunds nothing, and it is offered again
	for id in _villagers(1): sim.kill_unit(id)
	sim.set_player_resources(1, {"food": 10.0})
	await _step(2)
	var before := float(sim.get_player(1).food)
	sim.cancel_train(_tc(1), 0)
	_check("cancel refunds nothing", absf(float(sim.get_player(1).food) - before) < 0.01)
	await _step(2)
	_check("offered again after a cancel, still one", _free_in_queue(1) == 1 and free_called[1] == 3, "%d calls" % free_called[1])
	print("SOFTLOCK_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails, "free_calls": free_called}))
	quit(fails.size())
