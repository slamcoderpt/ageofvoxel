extends RefCounted
## The wall_angles capture scene (Godot-only): the town scene with sim walls
## (sim/fortify place_wall lines, built by villagers before the first frame)
## dragged out from a point of open ground at 0, 22, 45 and 67 degrees off the
## grid (one per quadrant), and one
## line dragged straight across a house (refused: a wall never goes over a
## building). For checking how diagonal walls read: long runs, not a row of
## pillars.

const Walls := preload("res://game/buildings/walls.gd")

static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var ctx: Dictionary = sim.setup_scene("town", game.scene_opts())
	sim.set_player_resources(1, {"food": 50000, "wood": 50000, "gold": 50000, "favor": 0})
	var B: Dictionary = sim.get_buildings()
	var tc := Vector2(-1, -1)
	var house := Rect2i()
	var names: Array = sim.building_type_names()
	for i in int(B.count):
		if int(B.owner[i]) != 1:
			continue
		var r := Rect2i(B.rect[i * 4], B.rect[i * 4 + 1], B.rect[i * 4 + 2], B.rect[i * 4 + 3])
		var tn := str(names[int(B.type[i])]) if int(B.type[i]) < names.size() else ""
		if tn == "town_center":
			tc = Vector2(r.position.x + r.size.x * 0.5, r.position.y + r.size.y * 0.5)
		elif tn == "house" and house.size.x == 0:
			house = r
	# the open ground nearest the Town Center that takes the whole fan (the
	# fewest tiles the sim would refuse)
	var n: int = sim.get_map_size()
	var fan := func(o: Vector2) -> Array:
		var out := []
		for deg in [0.0, 67.5, 135.0, 202.5]:   # (0, 67.5, 45, 22.5 degrees off the grid)
			var a := deg_to_rad(deg)
			out.append([o + Vector2(cos(a), sin(a)) * 3.0, o + Vector2(cos(a), sin(a)) * 13.0])
		return out
	var o := tc + Vector2(14, -10)
	var best := 1e9
	for z in range(16, n - 16, 2):
		for x in range(16, n - 16, 2):
			var c := Vector2(x + 0.5, z + 0.5)
			var d := c.distance_to(tc)
			if d < 14.0:
				continue
			var bad := 0
			for ln in fan.call(c):
				var P: Dictionary = sim.plan_wall(1, ln[0], ln[1])
				for st in P.state:
					bad += int(st == 0)
			var score := bad * 1000.0 + d
			if score < best:
				best = score
				o = c
	var lines: Array = fan.call(o)
	if house.size.x > 0:
		var hz := house.position.y + house.size.y * 0.5
		lines.append([Vector2(house.position.x - 5.5, hz), Vector2(house.end.x + 5.5, hz)])
	var vills := []
	for k in 30:
		var id: int = sim.spawn_unit("villager", 1, o.x + cos(k * 0.7) * 1.6, o.y + sin(k * 0.7) * 1.6, 0.0)
		if id > 0:
			vills.append(id)
	for q in lines.size():
		var r: Dictionary = sim.place_wall(1, lines[q][0], lines[q][1], PackedInt32Array(vills))
		if not bool(r.get("ok", false)):
			print("wall_angles: line %d refused: %s" % [q, r.get("reason", "")])
	sim.tick(1)
	Walls._build_all(sim, vills, 300 * 30)
	sim.order_move(PackedInt32Array(vills), tc.x, tc.y + 6.0)
	sim.tick(90)
	ctx["focus"] = o
	print("wall_angles: from %s, house %s" % [o, house])
	return ctx
