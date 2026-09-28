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

const PIECE_ORDER := ["lighting", "terrain", "buildings", "units", "economy", "combat", "godpowers", "ui"]
const SIM_DT := 1.0 / 30.0

var args := {}
var scene_def := {}
var sim: Object = null           # AovSim (C++)
var camera: AovCameraRig
var pieces := {}                 # name -> Node
var ctx := {}                    # the scene setup's result
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

func _ready() -> void:
	AovScenes.set_setup("models", preload("res://game/core/model_gallery.gd").setup)
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
	var scene_name := str(args.get("scene", "skirmish"))
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
	sim.new_game(seed, map_size, scene_def.preset, players)
	sim.take_events()  # the initial resources' entity:added (pieces read the world in setup)
	print("aov: scene=%s seed=%d map=%d preset=%s players=%d  %s  map_hash=%08x" % [
		scene_name, seed, map_size, scene_def.preset, players, sim.version(), sim.map_hash()])

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
		if not ResourceLoader.exists(path):
			continue
		var script: Script = load(path)
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
	for p in pieces:
		if pieces[p].has_method("setup"):
			pieces[p].setup(self)

	var setup := AovScenes.get_setup(scene_name)
	if setup.is_valid():
		ctx = setup.call(self)
	elif sim.has_scene_setup(scene_name):
		# deterministic setups ported to C++ (native/src/sim/scenes: skirmish,
		# town, coast, hud; economy registers itself from game/economy)
		ctx = sim.setup_scene(scene_name)
	if not ctx.has("focus"):
		var s: Dictionary = sim.get_starts()[0]
		ctx["focus"] = Vector2(s.tx + 0.5, s.tz + 0.5)

	var ff := float(scene_def.fast_forward)
	if ff > 0:
		fast_forward(ff)
	if sim.has_scene_setup(scene_name):
		sim.scene_after(scene_name)  # the scene's after() (JS main.js runs it after the fast-forward)

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

## Step the fixed-rate sim n seconds without rendering (scene fast-forward).
func fast_forward(seconds: float) -> void:
	sim.tick(int(round(seconds * 30.0)))

func _process(delta: float) -> void:
	if sim == null or camera == null:
		return
	if not paused:
		_acc += delta * time_scale
		var steps := 0
		while _acc >= SIM_DT and steps < 8:
			sim.tick(1)
			_acc -= SIM_DT
			steps += 1
		if steps == 8:
			_acc = 0.0
	alpha = 1.0 if paused else _acc / SIM_DT  # paused: show the last tick (JS Game.frame)
	events = sim.take_events()
	for p in pieces:
		if pieces[p].has_method("frame"):
			pieces[p].frame(delta, alpha)
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
		var out := str(args.out)
		if not out.is_absolute_path():
			out = OS.get_environment("AOV_CWD").path_join(out) if OS.get_environment("AOV_CWD") != "" else ProjectSettings.globalize_path("res://").path_join(out)
		DirAccess.make_dir_recursive_absolute(out.get_base_dir())
		var err := img.save_png(out)
		var st := image_stats(img)
		print("AOV_CAPTURE %s" % JSON.stringify({"out": out, "width": img.get_width(), "height": img.get_height(),
			"mean": snappedf(st.mean, 0.01), "std": snappedf(st.std, 0.01), "tick": sim.get_tick(), "errors": errors}))
		if err != OK:
			push_error("save_png failed: %s" % error_string(err))
			code = 2
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

func _fail(msg: String) -> void:
	errors.append(msg)
	push_error(msg)
	printerr("AOV_ERROR ", msg)
	get_tree().quit.call_deferred(1)
