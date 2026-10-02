extends RefCounted
## The "aifort" capture scene (enemy AI piece, Godot-only; registered by
## main.gd): a two-player match of AIs (Hard vs Titan by default) played
## headless in the setup for `aifort_t` minutes, so the frame shows what the
## AI does with fortifications on its own (native/src/sim/combat/enemy_ai_fort.cpp):
## its wall ring with gates round the town, towers by the Town Center and the
## resources, and, when a wave is at a wall, the breach. The camera goes to
## the wall piece under the heaviest attack, else to player 1's town.
##
##   node scripts/godot-shoot.mjs --scene aifort [--params "aifort_t=16&aifort_ai=hard,titan&aifort_focus=town"]

const FPS := 30

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var ais := str(game.args.get("aifort_ai", "hard,titan")).split(",")
	var ps := []
	for i in 2:
		ps.append({"id": i + 1, "name": "AI %d" % (i + 1), "human": false, "ai": ais[mini(i, ais.size() - 1)], "team": 0})
	var r: Dictionary = sim.setup_match({"seed": sim.get_seed(), "map_size": sim.get_map_size(), "preset": "skirmish", "resources": "standard", "players": ps})
	if not bool(r.get("ok", false)):
		push_error("aifort: setup_match: %s" % r.get("error", "?"))
		return {}
	sim.set_victory_enabled(false)
	var minutes := float(game.args.get("aifort_t", 16))
	var ticks := int(minutes * 60 * FPS)
	# last minute: remember which wall pieces get hit (unit:damaged on a piece)
	var hits := {}
	var t := 0
	while t < ticks:
		var n := mini(300, ticks - t)
		sim.tick(n)
		t += n
		var ev: Array = sim.take_events()
		if ticks - t < 60 * FPS:
			for e in ev:
				if str(e.type) == "unit:damaged" and int(e.kind) == 2:
					hits[int(e.id)] = int(hits.get(int(e.id), 0)) + 1
	var W: Dictionary = sim.get_walls()
	var focus := Vector2.ZERO
	var best := 0
	if str(game.args.get("aifort_focus", "breach")) == "breach":
		for i in int(W.count):
			var k := int(hits.get(int(W.ids[i]), 0))
			if k > best:
				best = k
				focus = Vector2(W.rect[i * 4] + W.rect[i * 4 + 2] * 0.5, W.rect[i * 4 + 1] + W.rect[i * 4 + 3] * 0.5)
	if best == 0:
		var B: Dictionary = sim.get_buildings()
		var names: PackedStringArray = sim.building_type_names()
		var who := int(game.args.get("aifort_owner", 1))
		for i in int(B.count):
			if int(B.owner[i]) == who and names[B.type[i]] == "town_center":
				focus = Vector2(B.rect[i * 4] + B.rect[i * 4 + 2] * 0.5, B.rect[i * 4 + 1] + B.rect[i * 4 + 3] * 0.5)
	for o in [1, 2]:
		var f: Dictionary = sim.get_ai(o).get("fort", {})
		f.erase("gaps")
		print("aifort: p%d %s %s" % [o, sim.get_ai(o).get("difficulty", ""), JSON.stringify(f)])
	print("aifort: %.1f min, focus %s (%d hits on that piece in the last minute)" % [minutes, focus, best])
	return {"focus": focus}
