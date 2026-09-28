extends Node
## Performance piece: the render benchmark (the Godot counterpart of
## scripts/bench.mjs) and the per-frame render timing overlay numbers.
##
##   godot --path godot --rendering-driver vulkan -- --scene=stress --units=2000 --fog=0
##         --width=1280 --height=720 --renderbench=30 [--rb_warmup=10] [--rb_live=0|1]
##         [--rb_json=out.json]
## (or node scripts/godot-renderbench.mjs, which wraps xvfb + lavapipe).
##
## Like bench.mjs it pauses the sim (unless --rb_live=1), renders --rb_warmup
## frames, then times --renderbench frames with vsync off and no fps cap:
## wall ms per frame (frame-to-frame, CPU + the software GPU, which Godot
## waits on within its frames in flight), the CPU ms spent in the pieces'
## frame(), the viewport's measured CPU / GPU render time, draw calls,
## primitives and objects in the frame. Prints `AOV_RENDERBENCH {json}` and
## quits. Without --renderbench this piece does nothing.

var game: Node = null
var _n := 0
var _warm := 10
var _live := false
var _frame := 0
var _last_us := 0
var _walls: Array[float] = []
var _cpu: Array[float] = []
var _gpu: Array[float] = []
var _info := {}
var _cpu0 := -1.0
var _cpu_s := 0.0

## Process CPU seconds (user + system, all threads: lavapipe rasterises on
## worker threads), from /proc (Linux); -1 elsewhere. Wall time on a shared
## machine swings with the other load; CPU time is the steadier cost.
static func proc_cpu_s() -> float:
	var f := FileAccess.open("/proc/self/stat", FileAccess.READ)
	if f == null:
		return -1.0
	var st := f.get_line()  # (procfs reports size 0: read a line, not the "whole file")
	var rest := st.substr(st.rfind(")") + 2).split(" ")
	return (float(rest[11]) + float(rest[12])) / 100.0

func setup(g: Node) -> void:
	game = g
	_n = int(g.args.get("renderbench", 0))
	if _n <= 0:
		set_process(false)
		return
	_warm = int(g.args.get("rb_warmup", 10))
	_live = AovArgs.flag(g.args, "rb_live", false)
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	Engine.max_fps = 0
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	var dog := Timer.new()
	dog.wait_time = float(g.args.get("timeout", 900))
	dog.one_shot = true
	dog.timeout.connect(func() -> void:
		printerr("AOV_ERROR renderbench watchdog after %ss" % dog.wait_time)
		get_tree().quit(4))
	add_child(dog)
	dog.start()
	# run after every other piece's _process (main.gd drives frame())
	process_priority = 1000
	# experiments: --rb_hide=units,terrain hides those pieces' nodes
	# (or piece/Child, e.g. terrain/Resources)
	for p in str(g.args.get("rb_hide", "")).split(",", false):
		var parts: PackedStringArray = p.split("/")
		var nd: Node = g.pieces.get(parts[0])
		if nd and parts.size() > 1:
			nd = nd.get_node_or_null(NodePath("/".join(parts.slice(1))))
		if nd is Node3D:
			nd.visible = false
	# experiments: --rb_off=shadow,msaa,ao,post switches one render feature off
	var off := str(g.args.get("rb_off", "")).split(",", false)
	var L: Node = g.pieces.get("lighting")
	if L:
		if off.has("shadow"): L.sun.shadow_enabled = false
		if off.has("msaa"): get_viewport().msaa_3d = Viewport.MSAA_DISABLED
		if off.has("ao"): L.env.ssao_enabled = false
		if off.has("post") and L.grade: L.grade.enabled = false

func frame(_dt: float, _alpha: float) -> void:
	if _n > 0 and not _live:
		game.paused = true

func _process(_delta: float) -> void:
	var now := Time.get_ticks_usec()
	var vp := get_viewport().get_viewport_rid()
	if _frame == _warm:
		_cpu0 = proc_cpu_s()
	if _frame > _warm and _walls.size() < _n:
		_walls.append((now - _last_us) / 1000.0)
		_cpu.append(RenderingServer.viewport_get_measured_render_time_cpu(vp) + RenderingServer.get_frame_setup_time_cpu())
		_gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(vp))
	_last_us = now
	_frame += 1
	if _walls.size() == _n and _info.is_empty():
		_cpu_s = (proc_cpu_s() - _cpu0) / _n if _cpu0 >= 0.0 else -1.0
		_info = {
			"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
			"objects": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
		}
		for t in [["visible", RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE], ["shadow", RenderingServer.VIEWPORT_RENDER_INFO_TYPE_SHADOW]]:
			_info[t[0]] = {
				"draw_calls": RenderingServer.viewport_get_render_info(vp, t[1], RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME),
				"primitives": RenderingServer.viewport_get_render_info(vp, t[1], RenderingServer.VIEWPORT_RENDER_INFO_PRIMITIVES_IN_FRAME),
				"objects": RenderingServer.viewport_get_render_info(vp, t[1], RenderingServer.VIEWPORT_RENDER_INFO_OBJECTS_IN_FRAME),
			}
		_info["passes"] = gpu_passes()
		_report()

## GPU time between the renderer's captured timestamps (ms), last frame.
static func gpu_passes() -> Array:
	var rd := RenderingServer.get_rendering_device()
	var out := []
	if rd == null:
		return out
	var n := rd.get_captured_timestamps_count()
	for i in range(1, n):
		out.append([rd.get_captured_timestamp_name(i),
			snappedf((rd.get_captured_timestamp_gpu_time(i) - rd.get_captured_timestamp_gpu_time(i - 1)) / 1000000.0, 0.1)])
	return out

static func _stats(a: Array[float]) -> Dictionary:
	var s := a.duplicate()
	s.sort()
	var sum := 0.0
	for v in s:
		sum += v
	return {"mean": snappedf(sum / maxf(1, s.size()), 0.01), "median": snappedf(s[s.size() / 2], 0.01),
		"p95": snappedf(s[mini(s.size() - 1, int(s.size() * 0.95))], 0.01), "min": snappedf(s[0], 0.01)}

func _report() -> void:
	var u: Dictionary = game.pieces.units.last if game.pieces.has("units") else {}
	var drawn := 0
	if u.has("part_counts"):
		drawn = int(u.get("unit_count", 0))
	var res := {
		"scene": str(game.args.get("scene", "")), "units": game.sim.get_unit_count(),
		"size": [get_viewport().get_visible_rect().size.x, get_viewport().get_visible_rect().size.y],
		"frames": _n, "live": _live, "wall_ms": _stats(_walls), "render_cpu_ms": _stats(_cpu), "gpu_ms": _stats(_gpu),
		"cpu_ms_per_frame": snappedf(_cpu_s * 1000.0, 0.1),
		"units_posed": drawn, "units_lod": int(u.get("lod_count", 0)),
	}
	res.merge(_info)
	print("AOV_RENDERBENCH %s" % JSON.stringify(res))
	var jp := str(game.args.get("rb_json", ""))
	if jp != "":
		var f := FileAccess.open(jp, FileAccess.WRITE)
		if f:
			f.store_string(JSON.stringify(res, "  "))
	get_tree().quit(0)
