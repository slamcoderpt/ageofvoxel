extends SceneTree
## Parity tool, C++ side (driven by scripts/check-mapgen.mjs and
## scripts/check-sim.mjs, which run the same things on the JS modules and
## compare exactly). Run headless:
##
##   godot --headless --path godot -s res://game/core/simcheck.gd -- --mapdump=out.json \
##         --seed=3 --size=128 --preset=skirmish --players=2
##   godot --headless --path godot -s res://game/core/simcheck.gd -- --scenario=in.json --out=out.json
##
## mapdump: heights (int16 LE), ground, passable and walkable (after the
## initial resources block their tiles) as base64, plus resources / starts.
## scenario: {seed, size, preset, players, every, ops: [...]} (see
## check-sim.mjs); writes {checkpoints: [{tick, hash, units: [id, x, z, rot,
## hp, flags, order, anim]*}]} with full-precision doubles.

func _initialize() -> void:
	var args := AovArgs.parse()
	if not ClassDB.class_exists("AovSim"):
		printerr("AOV_ERROR AovSim missing (build godot/native, then godot --headless --path godot --import)")
		quit(1)
		return
	var code := 0
	if args.has("mapdump"):
		code = _mapdump(args)
	elif args.has("scenario"):
		code = _scenario(args)
	else:
		printerr("simcheck: pass --mapdump=FILE or --scenario=FILE --out=FILE")
		code = 1
	quit(code)

func _write(path: String, data: Variant) -> int:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		printerr("simcheck: cannot write %s" % path)
		return 1
	f.store_string(JSON.stringify(data, "", false, true))
	f.close()
	return 0

func _mapdump(a: Dictionary) -> int:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.new_game(int(a.get("seed", 1)), int(a.get("size", 128)), str(a.get("preset", "skirmish")), int(a.get("players", 2)))
	var hs: PackedInt32Array = sim.get_heights()
	var hb := PackedByteArray()
	hb.resize(hs.size() * 2)
	for i in hs.size():
		hb.encode_s16(i * 2, hs[i])
	var res := []
	for r in sim.get_resource_spawns():
		res.append([r.type, r.tx, r.tz, r.variant])
	var starts := []
	for s in sim.get_starts():
		starts.append([s.owner, s.tx, s.tz])
	return _write(str(a.mapdump), {
		"size": sim.get_map_size(), "cols": sim.get_map_cols(), "waterLevel": sim.get_water_level(),
		"heights": Marshalls.raw_to_base64(hb), "ground": Marshalls.raw_to_base64(sim.get_ground()),
		"passable": Marshalls.raw_to_base64(sim.get_passable()), "walkable": Marshalls.raw_to_base64(sim.get_walkable()),
		"resources": res, "starts": starts, "hash": "%08x" % sim.map_hash()})

func _scenario(a: Dictionary) -> int:
	var sc: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(str(a.scenario)))
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.new_game(int(sc.seed), int(sc.size), str(sc.preset), int(sc.players))
	sim.set_record_events(false)
	if sc.has("groupPaths"):
		sim.set_group_paths(int(sc.groupPaths))
	if sc.has("repathBudget"):
		sim.set_repath_budget(int(sc.repathBudget))
	for pid in range(3, int(sc.players) + 1):
		sim.add_player(pid, "AI %d" % pid, true)
	var groups := {}
	var every := int(sc.get("every", 15))
	var checkpoints := []
	var t0 := Time.get_ticks_usec()
	var tick_ms := 0.0
	var max_tick := 0.0
	var max_at := 0
	var order_ms := 0.0
	for op in sc.ops:
		var op_t0 := Time.get_ticks_usec()
		match str(op.op):
			"block":
				groups[op["as"]] = sim.spawn_block(op.type, int(op.owner), int(op.count), _f(op.x), _f(op.z),
					int(op.get("cols", 0)), _f(op.get("spacing", 1.0)), _f(op.get("rot", 0.0)), _f(op.get("jitter", 0.15)))
			"spawn":
				groups[op["as"]] = PackedInt32Array([sim.spawn_unit(op.type, int(op.owner), _f(op.x), _f(op.z), _f(op.get("rot", 0.0)))])
			"move":
				sim.order_move(_ids(groups, op.group), _f(op.x), _f(op.z))
			"smart":
				sim.smart(_ids(groups, op.group), _f(op.x), _f(op.z), int(op.get("target", 0)))
			"order":
				for id in _ids(groups, op.group):
					sim.order(id, {"type": op.type, "x": _f(op.get("x", 0.0)), "z": _f(op.get("z", 0.0))})
			"moveTo":
				for id in _ids(groups, op.group):
					sim.move_to(id, _f(op.x), _f(op.z), _f(op.get("range", 0.0)))
			"kill":
				var ids := _ids(groups, op.group)
				for i in mini(int(op.get("count", ids.size())), ids.size()):
					sim.kill_unit(ids[i])
			"clearRect":
				sim.clear_rect(int(op.tx), int(op.tz), int(op.w), int(op.h))
			"scene":
				sim.setup_scene(str(op.name), {"units": int(op.get("units", 2000))})
			"ai":
				var set := {}
				if op.has("enabled"):
					set["enabled"] = bool(op.enabled)
				if op.has("nextWaveAt"):
					set["next_wave_at"] = _f(op.nextWaveAt)
				for pid in range(1, 7):
					if not op.has("owner") or int(op.owner) == pid:
						sim.set_ai(pid, set)
			"attack":
				var t := _ids(groups, op.target)
				if t.size():
					for id in _ids(groups, op.group):
						sim.order(id, {"type": "attack", "target": t[0], "auto": bool(op.get("auto", false)),
							"then_buildings": bool(op.get("thenBuildings", false))})
			"cast":
				sim.cast_power(int(op.owner), str(op.power), _f(op.x), _f(op.z))
			"after":
				sim.scene_after(str(op.name))
			"units":
				var U: Dictionary = sim.get_units()
				var t := Array(sim.unit_type_names()).find(str(op.type))
				var ids := PackedInt32Array()
				for i in int(U.count):
					if U.type[i] == t and U.owner[i] == int(op.owner) and (U.flags[i] & 2) == 0:
						ids.append(U.ids[i])
				groups[op["as"]] = ids
			"buildings":
				var B: Dictionary = sim.get_buildings()
				var t := Array(sim.building_type_names()).find(str(op.type))
				var ids := PackedInt32Array()
				for i in int(B.count):
					if B.type[i] == t and B.owner[i] == int(op.owner):
						ids.append(B.ids[i])
				groups[op["as"]] = ids
			"setRes":
				var res := {}
				for k in op.res:
					res[k] = _f(op.res[k])
				sim.set_player_resources(int(op.owner), res)
			"train":
				for id in _ids(groups, op.group):
					for i in int(op.get("count", 1)):
						sim.train(id, str(op.type))
			"cancel":
				for id in _ids(groups, op.group):
					sim.cancel_train(id, int(op.get("index", 0)))
			"age":
				sim.advance_age(int(op.owner))
			"place":
				var id: int = sim.place_building(str(op.type), int(op.owner), int(op.tx), int(op.tz), _ids(groups, str(op.get("group", ""))))
				groups[op["as"]] = PackedInt32Array([id]) if id else PackedInt32Array()
			"destroy":
				for id in _ids(groups, op.group):
					sim.destroy_building(id)
			"gather":
				var r: int = sim.nearest_resource(_f(op.x), _f(op.z), str(op.resType), 30.0)
				if r:
					sim.order_gather(_ids(groups, op.group), r)
			"run":
				for i in int(op.ticks):
					var s := Time.get_ticks_usec()
					sim.tick(1)
					var dt := (Time.get_ticks_usec() - s) / 1000.0
					tick_ms += dt
					if dt > max_tick:
						max_tick = dt
						max_at = sim.get_tick()
					if sim.get_tick() % every == 0:
						checkpoints.append({"tick": sim.get_tick(), "hash": "%08x" % sim.units_hash(), "units": sim.get_units_f64(), "econ": sim.get_econ_f64()})
			_:
				printerr("simcheck: unknown op %s" % op.op)
				return 1
		if str(op.op) in ["move", "smart", "order", "moveTo"]:
			order_ms = maxf(order_ms, (Time.get_ticks_usec() - op_t0) / 1000.0)
	var st: Dictionary = sim.get_stats()
	print("simcheck: %d ticks, %d units, sim %.2f ms/tick (max %.2f at tick %d), slowest order op %.1f ms, wall %.0f ms, paths: %d calls, %d searches, %d cache hits" % [
		sim.get_tick(), sim.get_unit_count(), tick_ms / maxf(1, sim.get_tick()), max_tick, max_at, order_ms, (Time.get_ticks_usec() - t0) / 1000.0,
		st.path_calls, st.path_searches, st.path_cache_hits])
	if st.group_fields > 0:
		print("simcheck: group fields %d, field paths %d, fallbacks %d; moving at end %d of %d alive" % [
			st.group_fields, st.group_field_paths, st.group_field_fallbacks, st.moving, st.alive])
	return _write(str(a.out), {"checkpoints": checkpoints, "stats": st, "msPerTick": tick_ms / maxf(1, sim.get_tick())})

## Scenario doubles arrive as "f64:<hex>" (exact bits; see check-sim.mjs).
static func _f(v: Variant) -> float:
	if v is String and v.begins_with("f64:"):
		return v.substr(4).hex_decode().decode_double(0)
	return float(v)

func _ids(groups: Dictionary, spec: String) -> PackedInt32Array:
	var out := PackedInt32Array()
	for g in spec.split(","):
		if g != "":
			out.append_array(groups.get(g, PackedInt32Array()))
	return out
