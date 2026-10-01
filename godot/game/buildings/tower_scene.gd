extends RefCounted
## The "towers" capture scene (buildings piece, Godot-only; registered by
## buildings.gd): the town scene's town with a row of four towers on its
## south side, one per upgrade stage (Sentry, Watch, Guard, Ballista, west
## to east: towers.gd `level_override`), and an enemy squad in front of them
## that the towers shoot at (the sim's own tower arrows, Combat::fire). The
## sim is stepped here until arrows are in flight and one has just been
## loosed, so the paused capture shows the loose flash, arrows in the air and
## the strikes.
##
##   node scripts/godot-shoot.mjs --scene towers [--params "towers_t=6"]
##   (towers_t: seconds of fighting at least before the frame is chosen)

const FPS := 30

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var ctx: Dictionary = sim.setup_scene("town", game.scene_opts())
	var B: Dictionary = sim.get_buildings()
	var rect: PackedInt32Array = B.rect
	var x0 := 1 << 20
	var z1 := -(1 << 20)
	var x1 := -(1 << 20)
	for i in int(B.count):
		if int(B.owner[i]) != 1:
			continue
		x0 = mini(x0, rect[i * 4])
		x1 = maxi(x1, rect[i * 4] + rect[i * 4 + 2] - 1)
		z1 = maxi(z1, rect[i * 4 + 1] + rect[i * 4 + 3] - 1)
	var size: int = sim.get_map_size()
	var cx := (x0 + x1) / 2
	var row := mini(size - 20, z1 + int(game.args.get("towers_row", 6)))
	var spacing := int(game.args.get("towers_gap", 5))
	# clear the ground in front of the town: the tower row and the field
	sim.clear_rect(cx - 2 * spacing - 4, row - 1, 4 * spacing + 8, 14)
	sim.set_player_resources(1, {"food": 50000, "wood": 50000, "gold": 50000, "favor": 0})
	var view = game.pieces.buildings.towers
	var ids := []
	# towers_states=1: the states row instead (construction 0..3, damage 1..2,
	# an upgrade under way), stage by stage
	var states: Array = []
	if AovArgs.flag(game.args, "towers_states", false):
		states = ["0/s0", "1/s1", "2/s2", "3/s3", "0/d1", "1/d2", "2/d1", "3/d2", "1+upgrade", "0/s2"]
		spacing = 3
		sim.clear_rect(cx - 16, row - 1, 34, 14)
	var n := 4 if states.is_empty() else states.size()
	for k in n:
		if not states.is_empty():
			var tx2: int = cx - 15 + k * spacing
			if sim.can_place("tower", tx2, row):
				var id2: int = sim.spawn_building("tower", 1, tx2, row, true)
				view.model_override[id2] = states[k]
			continue
		var tx: int = cx - 2 * spacing + k * spacing
		var tz := row
		var id := 0
		for dz in 4:
			if sim.can_place("tower", tx, tz + dz):
				id = sim.spawn_building("tower", 1, tx, tz + dz, true)
				break
		if id > 0:
			ids.append(id)
			view.level_override[id] = k
	# the enemy squad, in range of the middle towers
	var ex := cx - 1.5
	var ez := row + 17.0
	var squad = sim.spawn_block("hoplite", 2, 8, ex, ez, 4, 1.1, PI)
	# they march on the town, so the towers take them under fire one after
	# the other (the middle ones first), not in one volley
	sim.order_attack_move(squad, cx - 1.5, row - 6.0)
	# step until the towers have shot a while and an arrow has just left one
	var t_min := float(game.args.get("towers_t", 3.0))
	var ticks := 0
	while ticks < 30 * FPS and not ids.is_empty():
		sim.tick(1)
		ticks += 1
		if ticks < int(t_min * FPS):
			continue
		if _fresh_arrow(sim, ids):
			break
	if AovArgs.flag(game.args, "towers_debug", false):
		var P: PackedFloat32Array = sim.get_combat().projectiles
		for k in P.size() / 16:
			print("  arrow from %.1f,%.1f,%.1f at %.1f,%.1f,%.1f t %.2f / %.2f" % [P[k * 16 + 6], P[k * 16 + 7], P[k * 16 + 8], P[k * 16], P[k * 16 + 1], P[k * 16 + 2], P[k * 16 + 12], P[k * 16 + 13]])
	ctx["focus"] = Vector2(cx + 0.5, row + 2.0)
	ctx["towers"] = ids
	print("towers: %d towers at row %d, %d enemies, %.1f s of fire" % [ids.size(), row, squad.size(), ticks / float(FPS)])
	return ctx

## True when an arrow left one of the towers in the last tick or two and
## another is in mid flight.
static func _fresh_arrow(sim, ids: Array) -> bool:
	var C: Dictionary = sim.get_combat()
	var P: PackedFloat32Array = C.projectiles
	var B: Dictionary = sim.get_buildings()
	var centres := []
	for i in int(B.count):
		if ids.has(int(B.ids[i])):
			var r: PackedInt32Array = B.rect
			centres.append(Vector2(r[i * 4] + r[i * 4 + 2] * 0.5, r[i * 4 + 1] + r[i * 4 + 3] * 0.5))
	var fresh := false
	var mid := false
	for k in P.size() / 16:
		var o := k * 16
		var s := Vector2(P[o + 6], P[o + 8])
		for c in centres:
			if c.distance_to(s) < 0.01:
				var f: float = P[o + 12] / maxf(P[o + 13], 1e-3)
				if P[o + 12] < 0.07:
					fresh = true
				elif f > 0.3 and f < 0.75:
					mid = true
	return fresh and mid
