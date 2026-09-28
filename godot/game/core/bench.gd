extends Node
## Headless sim benchmark behind --bench (driven by scripts/godot-stress.mjs;
## mirrors the in-page part of scripts/stress.mjs). Steps the C++ sim directly:
## --warmup ticks, then --ticks recorded ticks with the profiler on, and writes
## per-tick totals / per-system ms / AI ms / sub-steps / counted calls / unit
## counts as JSON to --json (or prints it after "AOV_BENCH ").

func run(game: Node) -> void:
	var a: Dictionary = game.args
	var sim: Object = game.sim
	var ticks := int(a.get("ticks", 600))
	var warmup := int(a.get("warmup", 150))
	var scene_name := str(game.scene_def.name)
	var setup := AovScenes.get_setup(scene_name)
	if setup.is_valid():
		setup.call(game)
	elif sim.has_scene_setup(scene_name):
		sim.setup_scene(scene_name, game.scene_opts())
	# fog of war as in the scene (stress: on for player 1, ?fog=0 reveals all)
	sim.set_fog_reveal_all(not AovArgs.flag(a, "fog", not bool(game.scene_def.reveal_all)))
	var ff := float(game.scene_def.fast_forward)
	if ff > 0:
		game.fast_forward(ff)
	sim.set_profiling(true)
	var start: Dictionary = sim.get_stats()
	sim.tick(warmup)
	var T := {"wall": [], "total": [], "sys": {}, "ai": [], "aiMax": [], "sub": {}, "calls": {}, "callsBy": {},
		"alive": [], "dead": [], "moving": [], "projectiles": [], "heap": []}
	for i in ticks:
		var t0 := Time.get_ticks_usec()
		sim.tick(1)
		T.wall.append((Time.get_ticks_usec() - t0) / 1000.0)
		var r: Dictionary = sim.get_profile()
		T.total.append(r.total)
		for k in r.sys:
			if not T.sys.has(k):
				var arr := []
				arr.resize(ticks)
				arr.fill(0.0)
				T.sys[k] = arr
			T.sys[k][i] = r.sys[k]
		var ai := 0.0
		var ai_max := 0.0
		for k in r.ai:
			ai += r.ai[k]
			ai_max = maxf(ai_max, r.ai[k])
		T.ai.append(ai)
		T.aiMax.append(ai_max)
		for k in r.sub:
			if not T.sub.has(k):
				var arr := []
				arr.resize(ticks)
				arr.fill(0.0)
				T.sub[k] = arr
			T.sub[k][i] = r.sub[k]
		for k in r.calls:
			for suffix in [".n", ".ms"]:
				if not T.calls.has(k + suffix):
					var arr := []
					arr.resize(ticks)
					arr.fill(0.0)
					T.calls[k + suffix] = arr
			T.calls[k + ".n"][i] = r.calls[k][0]
			T.calls[k + ".ms"][i] = r.calls[k][1]
		var by: Dictionary = r.get("callsBy", {})
		for k in by:
			for suffix in [".n", ".ms"]:
				if not T.callsBy.has(k + suffix):
					var arr := []
					arr.resize(ticks)
					arr.fill(0.0)
					T.callsBy[k + suffix] = arr
			T.callsBy[k + ".n"][i] = by[k][0]
			T.callsBy[k + ".ms"][i] = by[k][1]
		var c: Dictionary = sim.get_stats()
		T.alive.append(c.alive)
		T.dead.append(c.dead)
		T.moving.append(c.moving)
		T.projectiles.append(c.projectiles)
		T.heap.append(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0)
	# spatial-hash census over 60 more ticks (stress.mjs counts the same)
	sim.set_census(true)
	sim.set_profiling(false)
	const CT := 60
	sim.tick(CT)
	var census: Dictionary = sim.take_census()
	for k in census:
		census[k] = float(census[k]) / CT  # per tick, as stress.mjs
	sim.set_census(false)
	var res := {"start": start, "end": sim.get_stats(), "heap0": T.heap[0] if T.heap.size() else 0.0,
		"census": census, "T": T, "fogFrames": [], "allFrames": [],
		"isolated": true, "timerRes": 1.0, "map": sim.get_map_size(), "players": sim.get_starts().size(),
		"errors": game.errors}
	var text := JSON.stringify(res)
	if game.args.has("json"):
		var f := FileAccess.open(str(game.args.json), FileAccess.WRITE)
		f.store_string(text)
		f.close()
		print("AOV_BENCH written %s" % game.args.json)
	else:
		print("AOV_BENCH ", text)
	get_tree().quit(0 if game.errors.is_empty() else 1)
