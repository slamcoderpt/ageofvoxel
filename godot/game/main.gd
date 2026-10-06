extends Node3D
## Entry point (port of src/main.js). Reads the user args after "--", builds
## the scene, runs the loop and, for captures, saves a PNG and quits.
##
##   godot --path godot -- --scene=town [--seed=N] [--units=N] [--players=N]
##         [--mapsize=N] [--live=0|1] [--hud=0|1] [--fog=0|1]
##         [--cam=x,z[,distance[,pitch[,yaw]]]] [--width=W --height=H]
##         [--out=shots/town.png] [--frames=N] [--quit]
##   godot --headless --path godot -- --scene=stress --units=2000 --bench [--ticks=600 --warmup=150 --json=out.json]
##
## Pieces: every res://game/<piece>/<piece>.gd that exists is instanced in
## PIECE_ORDER as a child node; setup(game) is called once the sim world
## exists, frame(dt, alpha) once per displayed frame (visual only). Pieces
## read sim state from `game.sim` (AovSim) through its packed-array getters.

const PIECE_ORDER := ["lighting", "terrain", "buildings", "units", "economy", "combat", "godpowers", "ui", "perf", "menu"]
const SIM_DT := 1.0 / 30.0
const MatchRules := preload("res://game/core/match_rules.gd")

var args := {}
var scene_def := {}
var sim: Object = null           # AovSim (C++)
var camera: AovCameraRig
var pieces := {}                 # name -> Node
var ctx := {}                    # the scene setup's result
var match_settings := {}         # the setup screen's match (MatchRules.settings(args)), {} without one
var live := false
var paused := true
var time_scale := 1.0
var alpha := 0.0                 # interpolation factor between the last two ticks
var _acc := 0.0
var _frames := 0
var _capture_frames := 4
var _capture_done := false
var errors: Array[String] = []
## Sim events of this frame (AovSim.take_events(), drained once per frame by
## main.gd before the pieces' frame()): [{type: "entity:added", id, kind, ...}].
## Pieces read this; never call sim.take_events() yourself.
var events: Array = []
## The loading screen of a flow switch (game/menu/loading.gd, under the tree
## root): while it is up the scene is built in stages, one drawn frame each,
## so its bar moves; main and its pieces do not process until the build is
## done. null for a command-line run (captures, checks): built at once.
var loading: Node = null
## The in-game menu (game/menu/game_menu.gd: Resume / Options / Quit to Main
## Menu), in every scene with the in-game UI and no "screen" of its own
## (the setup scene); null without one.
var game_menu: Node = null
const GAME_MENU := "res://game/menu/game_menu.gd"
var building := false
const STAGE_TEXT := {"lighting": "Lighting the sky", "terrain": "Raising the terrain", "buildings": "Building the towns",
	"units": "Mustering the armies", "economy": "Planting forests and herds", "combat": "Arming the soldiers",
	"godpowers": "Invoking the gods", "ui": "Preparing the command panel", "perf": "Tuning", "menu": "Setting the stage"}
## Share of the bar each stage fills (measured build times on lavapipe, rounded).
const STAGE_WEIGHT := {"newgame": 3.0, "terrain": 3.0, "economy": 1.5, "units": 1.0, "ui": 1.0, "menu": 2.0, "match": 1.0, "ff": 2.0}
var _stage_total := 1.0
var _stage_done := 0.0
var _stage_t0 := 0
var _stage_log: Array = []

## One build stage of a loaded scene: log the last one's time, advance the
## bar and let a frame draw (a no-op without a loading screen).
func _stage(key: String, text: String) -> void:
	if loading == null:
		return
	var now := Time.get_ticks_msec()
	_stage_log.append("%s %d" % [key, now - _stage_t0])
	_stage_t0 = now
	_stage_done += float(STAGE_WEIGHT.get(key, 0.5))
	if is_instance_valid(loading):
		loading.progress(_stage_done / _stage_total, text)
	await get_tree().process_frame

func _ready() -> void:
	AovScenes.set_setup("models", preload("res://game/core/model_gallery.gd").setup)
	AovScenes.set_setup("aifort", preload("res://game/core/aifort_scene.gd").scene_setup)
	args = AovArgs.parse()
	if args.has("out") or AovArgs.flag(args, "quit", false) or AovArgs.flag(args, "bench", false):
		# a script error leaves the engine running: never hang a capture / bench
		var dog := Timer.new()
		dog.wait_time = float(args.get("timeout", 600))
		dog.one_shot = true
		dog.timeout.connect(func() -> void:
			printerr("AOV_ERROR watchdog: no result after %ss" % dog.wait_time)
			get_tree().quit(4))
		add_child(dog)
		dog.start()
	# no --scene: the main menu when launched to play (game/menu), the skirmish
	# for a capture / bench / --quit run without one (as before the menu existed)
	var headless_run := args.has("out") or AovArgs.flag(args, "quit", false) or AovArgs.flag(args, "bench", false)
	if not headless_run:
		loading = get_tree().root.get_node_or_null("AovLoading")
		if loading != null and (loading.is_queued_for_deletion() or bool(loading.get("finished"))):
			loading = null
	time_scale = float(args.get("timescale", 1.0))  # (set early: checks read it as soon as the scene exists)
	var scene_name := str(args.get("scene", "skirmish" if headless_run else "menu"))
	scene_def = AovScenes.get_def(scene_name)
	if scene_def.is_empty():
		_fail("Unknown scene \"%s\". Known: %s" % [scene_name, ", ".join(AovScenes.names())])
		return
	if not ClassDB.class_exists("AovSim"):
		_fail("AovSim class missing: the GDExtension did not load (build it: cd godot/native && scons -j2; then import once: godot --headless --path godot --import)")
		return

	var w := int(args.get("width", 0))
	var h := int(args.get("height", 0))
	if w > 0 and h > 0 and DisplayServer.get_name() != "headless":
		get_window().size = Vector2i(w, h)

	sim = ClassDB.instantiate("AovSim")
	var seed := int(args.get("seed", scene_def.seed))
	var map_size := int(args.get("mapsize", scene_def.map_size))
	var players := int(scene_def.players)
	if AovScenes.SCENES[scene_name].has("players") and args.has("players"):
		players = clampi(int(args.players), 2, 6)
	# a match from the setup screen (`match` arg): its map preset and players (game/core/match_rules.gd)
	var preset := str(scene_def.preset)
	match_settings = MatchRules.settings(args)
	if not match_settings.is_empty():
		preset = MatchRules.preset(match_settings, preset)
		players = MatchRules.player_count(match_settings)
	# --godot_rules=0: the browser's rules only (no AI god powers, no free villager), for A/B runs
	sim.set_godot_rules(AovArgs.flag(args, "godot_rules", true))
	if loading != null:
		building = true
		process_mode = Node.PROCESS_MODE_DISABLED  # no piece frame() / input before every setup() ran
		_stage_t0 = Time.get_ticks_msec()
		_stage_total = 0.0
		for k in ["newgame", "match", "ff"]:
			_stage_total += float(STAGE_WEIGHT[k])
		for p in PIECE_ORDER:
			if ResourceLoader.exists("res://game/%s/%s.gd" % [p, p]) and not p in scene_def.get("skip_pieces", []):
				_stage_total += float(STAGE_WEIGHT.get(p, 0.5))
	sim.new_game(seed, map_size, preset, players)
	sim.take_events()  # the initial resources' entity:added (pieces read the world in setup)
	print("aov: scene=%s seed=%d map=%d preset=%s players=%d  %s  map_hash=%08x" % [
		scene_name, seed, map_size, preset, players, sim.version(), sim.map_hash()])

	# the JS main.js: combat.ai.enabled = !!scene.ai; victory.enabled = !!scene.victory (before the setup)
	sim.set_ai_enabled(bool(scene_def.ai))
	sim.set_victory_enabled(bool(scene_def.victory))
	if loading != null:
		loading.map_ready(sim)
	await _stage("newgame", STAGE_TEXT.get(PIECE_ORDER[0], "Building"))

	if AovArgs.flag(args, "bench", false):
		sim.set_record_events(false)
		var bench := preload("res://game/core/bench.gd").new()
		add_child(bench)
		bench.run(self)
		return

	camera = AovCameraRig.new()
	camera.name = "Camera"
	camera.sim = sim
	add_child(camera)
	camera.make_current()

	for p in PIECE_ORDER:
		var path := "res://game/%s/%s.gd" % [p, p]
		if not ResourceLoader.exists(path) or p in scene_def.get("skip_pieces", []):
			continue  # (skip_pieces: a scene without some pieces, the menu has no in-game UI)
		var script: Script = load(path)
		# a piece whose script fails to load (a parse error) is skipped and reported,
		# so it cannot take every other piece and the scene's screen down with it
		if script == null or not script.can_instantiate():
			errors.append("piece %s: failed to load %s" % [p, path])
			push_error("aov: piece %s failed to load (%s), skipped" % [p, path])
			continue
		var node: Node = script.new()
		node.name = p.capitalize().replace(" ", "")
		add_child(node)
		pieces[p] = node
	# Sim debug view (unit markers, --simdemo armies): on while the units
	# piece has no renderer yet, or with --simdebug=1.
	if AovArgs.flag(args, "simdebug", not pieces.has("units")) or AovArgs.flag(args, "simdemo", false):
		var dbg: Node = preload("res://game/core/sim_debug.gd").new()
		dbg.name = "SimDebug"
		add_child(dbg)
		pieces["sim_debug"] = dbg
	var keys := pieces.keys()
	for i in keys.size():
		var p: String = keys[i]
		if pieces[p].has_method("setup"):
			pieces[p].setup(self)
		var nxt: String = keys[i + 1] if i + 1 < keys.size() else ""
		await _stage(p, STAGE_TEXT.get(nxt, "Seating the players"))
	if pieces.has("ui") and not scene_def.has("screen") and ResourceLoader.exists(GAME_MENU):  # (not under a scene's own screen)
		game_menu = load(GAME_MENU).new()
		game_menu.name = "GameMenu"
		add_child(game_menu)
		game_menu.setup(self)
	# a scene's "screen": that UI over the world, on its own layer (--scene=setup)
	if scene_def.has("screen"):
		var screen_layer := CanvasLayer.new()
		screen_layer.layer = 20
		add_child(screen_layer)
		screen_layer.add_child(load(str(scene_def.screen)).new())

	var setup := AovScenes.get_setup(scene_name)
	if not match_settings.is_empty():
		ctx = MatchRules.apply(sim, match_settings)  # players, teams, AI difficulty, resources, starts
		if loading != null:
			loading.seat(sim)
	elif setup.is_valid():
		ctx = setup.call(self)
	elif sim.has_scene_setup(scene_name):
		# deterministic setups ported to C++ (native/src/sim/scenes: skirmish,
		# town, coast, hud; economy registers itself from game/economy)
		ctx = sim.setup_scene(scene_name, scene_opts())
	# fog of war for player 1 (the JS game.fog.setRevealAll(!bool('fog', !scene.revealAll)))
	sim.set_fog_reveal_all(not AovArgs.flag(args, "fog", not bool(scene_def.reveal_all)))
	if not ctx.has("focus"):
		var s: Dictionary = sim.get_starts()[0]
		ctx["focus"] = Vector2(s.tx + 0.5, s.tz + 0.5)

	await _stage("match", "Letting time run" if float(scene_def.fast_forward) > 0 else "Taking the field")
	var ff := float(scene_def.fast_forward)
	if ff > 0:
		fast_forward(ff)
	if sim.has_scene_setup(scene_name):
		sim.scene_after(scene_name)  # the scene's after() (JS main.js runs it after the fast-forward)
	sim.fog_recompute()

	var cam: Dictionary = AovScenes.DEFAULT_CAMERA.duplicate()
	cam.merge(scene_def.camera, true)
	if not cam.has("x"):
		cam["x"] = ctx.focus.x + float(cam.get("focus_dx", 0.0))
		cam["z"] = ctx.focus.y + float(cam.get("focus_dz", 0.0))
	camera.set_view(cam)
	if args.has("cam"):
		var c := str(args.cam).split(",")
		var v := {"x": float(c[0]), "z": float(c[1])}
		if c.size() > 2 and float(c[2]) != 0.0: v["distance"] = float(c[2])
		if c.size() > 3 and float(c[3]) != 0.0: v["pitch"] = float(c[3])
		if c.size() > 4: v["yaw"] = float(c[4])
		camera.set_view(v)

	live = AovArgs.flag(args, "live", bool(scene_def.live))
	paused = not live
	time_scale = float(args.get("timescale", 1.0))
	var capturing := args.has("out") or AovArgs.flag(args, "quit", false)
	if capturing:
		camera.user_control = false
		camera.edge_scroll = false
	_capture_frames = int(args.get("frames", 4))
	if loading != null:
		await _stage("ff", "Taking the field")
		print("aov: built %s under the loading screen: %s ms" % [scene_name, ", ".join(_stage_log)])
		building = false
		process_mode = Node.PROCESS_MODE_INHERIT
		if is_instance_valid(loading):
			loading.finish()
		loading = null

## Esc in a match (game/ui/ui.gd, with nothing to cancel): the in-game menu.
func open_game_menu() -> void:
	if game_menu != null and not building:
		game_menu.open()

## URL-style parameters the C++ scene setups read (the stress scene's units=N).
func scene_opts() -> Dictionary:
	return {"units": maxi(12, int(round(float(args.get("units", scene_def.get("units", 2000)))))),
		"fort": AovArgs.flag(args, "fort", true)}  # (stress: the towns' walls and towers, Godot rules only)

## Step the fixed-rate sim n seconds without rendering (scene fast-forward).
func fast_forward(seconds: float) -> void:
	sim.tick(int(round(seconds * 30.0)))

## Cost counters for the F3 meter (game/ui/perf_meter.gd): sim time and
## ticks since it last read them, and the CPU time of the pieces' frame().
var sim_us := 0
var sim_ticks := 0
var frame_us := 0

func _process(delta: float) -> void:
	if sim == null or camera == null:
		return
	var f0 := Time.get_ticks_usec()
	if not paused:
		_acc += delta * time_scale
		var steps := 0
		while _acc >= SIM_DT and steps < 8:
			var t0 := Time.get_ticks_usec()
			sim.tick(1)
			sim_us += Time.get_ticks_usec() - t0
			sim_ticks += 1
			_acc -= SIM_DT
			steps += 1
		if steps == 8:
			_acc = 0.0
		if sim.is_paused():
			paused = true  # the match is decided (Victory): the JS game.paused
	alpha = 1.0 if paused else _acc / SIM_DT  # paused: show the last tick (JS Game.frame)
	events = sim.take_events()
	for p in pieces:
		if pieces[p].has_method("frame"):
			pieces[p].frame(delta, alpha)
	frame_us += Time.get_ticks_usec() - f0
	_frames += 1
	if _frames == _capture_frames and not _capture_done and (args.has("out") or AovArgs.flag(args, "quit", false)):
		_capture_done = true
		_capture.call_deferred()

func _capture() -> void:
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	elif args.has("out"):
		_fail("--out needs a rendering display (xvfb-run + vulkan), not --headless")
		return
	var code := 0
	if args.has("out"):
		var img := get_viewport().get_texture().get_image()
		# Guard against a frame read back with a wrong row pitch (a critic once got a
		# 1420-wide capture that was all diagonal scanline smear): in a sheared image
		# neighbouring rows no longer match, so the vertical gradient dwarfs the
		# horizontal one (a real frame ~0.8-1.2, a 4 px pitch error ~2.3). Re-read
		# the next frames; give up loudly rather than save garbage.
		var shear := shear_ratio(img)
		var tries := 0
		while shear > 1.6 and tries < 6:
			tries += 1
			printerr("AOV_CAPTURE_RETRY sheared frame (v/h %.2f), reading the next one" % shear)
			await RenderingServer.frame_post_draw
			img = get_viewport().get_texture().get_image()
			shear = shear_ratio(img)
		var out := str(args.out)
		if not out.is_absolute_path():
			out = OS.get_environment("AOV_CWD").path_join(out) if OS.get_environment("AOV_CWD") != "" else ProjectSettings.globalize_path("res://").path_join(out)
		DirAccess.make_dir_recursive_absolute(out.get_base_dir())
		# written beside the target and renamed into place, so two captures aimed at the same
		# path (agents sharing shots/godot/<scene>.png) never interleave into a torn file
		var tmp := "%s.%d.tmp.png" % [out.get_basename(), OS.get_process_id()]
		var err := img.save_png(tmp)
		if err == OK:
			err = DirAccess.rename_absolute(tmp, out)
		if err != OK:
			DirAccess.remove_absolute(tmp)
		var st := image_stats(img)
		print("AOV_CAPTURE %s" % JSON.stringify({"out": out, "width": img.get_width(), "height": img.get_height(),
			"mean": snappedf(st.mean, 0.01), "std": snappedf(st.std, 0.01), "shear": snappedf(shear, 0.01), "tick": sim.get_tick(), "errors": errors}))
		if err != OK:
			push_error("save_png failed: %s" % error_string(err))
			code = 2
		elif shear > 1.6:
			push_error("capture looks sheared (row pitch?): vertical / horizontal gradient %.2f" % shear)
			code = 3
		if args.has("width") and (img.get_width() != int(args.width) or img.get_height() != int(args.height)):
			printerr("AOV_CAPTURE_WARN capture is %dx%d, asked for %sx%s" % [img.get_width(), img.get_height(), args.width, args.height])
		elif st.mean < 8.0 or st.std < 4.0:
			push_error("capture looks blank (mean %.1f, std %.1f)" % [st.mean, st.std])
			code = 3
	if not errors.is_empty():
		code = max(code, 1)
	get_tree().quit(code)

## Luminance mean / std over a 160x90 downscale (same check as shoot.mjs).
static func image_stats(img: Image) -> Dictionary:
	var s := img.duplicate() as Image
	s.convert(Image.FORMAT_RGB8)
	s.resize(160, 90, Image.INTERPOLATE_BILINEAR)
	var d := s.get_data()
	var n := d.size() / 3
	var sum := 0.0
	var sum2 := 0.0
	for i in n:
		var l := (d[i * 3] + d[i * 3 + 1] + d[i * 3 + 2]) / 3.0
		sum += l
		sum2 += l * l
	var mean := sum / n
	return {"mean": mean, "std": sqrt(maxf(0.0, sum2 / n - mean * mean))}

## Mean |vertical| / mean |horizontal| luminance step over a full-resolution
## sample of the frame (every 3rd row / column): ~1 for a real frame, > 2 when
## the rows were read back with a wrong pitch (diagonal scanline smear).
static func shear_ratio(img: Image) -> float:
	var s := img.duplicate() as Image
	s.convert(Image.FORMAT_RGB8)
	var w := s.get_width()
	var h := s.get_height()
	var d := s.get_data()
	var sh := 0.0
	var sv := 0.0
	for y in range(0, h - 1, 3):
		for x in range(0, w - 1, 3):
			var i := (y * w + x) * 3
			var l := d[i] + d[i + 1] + d[i + 2]
			var j := i + 3
			var k := i + w * 3
			sh += absi(l - (d[j] + d[j + 1] + d[j + 2]))
			sv += absi(l - (d[k] + d[k + 1] + d[k + 2]))
	return sv / maxf(sh, 1.0)

func _fail(msg: String) -> void:
	errors.append(msg)
	push_error(msg)
	printerr("AOV_ERROR ", msg)
	get_tree().quit.call_deferred(1)
