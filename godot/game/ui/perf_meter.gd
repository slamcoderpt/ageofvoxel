extends Control
## F3 performance meter (port of src/ui/PerfMeter.js): frame rate, frame time,
## the worst frame, CPU ms per frame in the game's own frame() work, sim ms per
## tick, draw calls, primitives, 3D render resolution and graphics quality,
## sampled over half-second windows. F3 toggles it; the choice is remembered
## (user://settings.cfg, like the browser's localStorage aov.perf).
## --fps=1|0 forces it. Captures (--out / --quit) never show it.
##
## Lives in the HUD CanvasLayer, so it is laid out in the HUD's CSS px
## (1920x1080 layout, scaled with the window) like the browser's .perf box:
## right 12px, top 38%, 136px wide.

const S := preload("res://game/ui/hud_style.gd")
const Settings := preload("res://game/ui/settings.gd")

var game: Node = null
var _history: Array[float] = []
var _rows: Array = []
var _fps := 0.0
var _win_start := 0
var _frames := 0
var _worst := 0.0
var _calls := 0.0
var _prims := 0.0
var _last := 0

func setup(g: Node) -> void:
	game = g
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var capture: bool = g.args.has("out") or AovArgs.flag(g.args, "quit", false)
	var on: bool = bool(Settings.read("ui", "perf", true))
	if g.args.has("fps"):
		on = AovArgs.flag(g.args, "fps", on)
	visible = on and not capture
	set_process(not capture)
	set_process_unhandled_key_input(not capture)
	_win_start = Time.get_ticks_usec()

func _unhandled_key_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo and e.keycode == KEY_F3:
		visible = not visible
		Settings.write("ui", "perf", visible)
		get_viewport().set_input_as_handled()

func _process(_delta: float) -> void:
	var now := Time.get_ticks_usec()
	if _last > 0:
		_worst = maxf(_worst, (now - _last) / 1000.0)
	_last = now
	_frames += 1
	# draws and primitives of the frame just rendered, summed over the window
	_calls += Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)
	_prims += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
	var span := (now - _win_start) / 1000.0
	if span < 500.0:
		return
	var n := maxf(1.0, float(_frames))
	_fps = _frames * 1000.0 / span
	_history.append(_fps)
	if _history.size() > 60:
		_history.pop_front()
	if visible:
		var vp := get_viewport()
		var win := vp.get_visible_rect().size
		var sc: float = vp.scaling_3d_scale
		var ticks: int = game.sim_ticks
		_rows = [
			["frame", "%.1f ms" % (span / n)],
			["worst", "%.1f ms" % _worst],
			["cpu", "%.1f ms" % (game.frame_us / 1000.0 / n)],
			["sim", ("%.2f ms/tick" % (game.sim_us / 1000.0 / ticks)) if ticks > 0 else "paused"],
			["draws", str(int(round(_calls / n)))],
			["tris", "%.2f M" % (_prims / n / 1e6)],
			["res", "%d×%d @%sx" % [int(win.x * sc), int(win.y * sc), _num(DisplayServer.screen_get_scale())]],
			["quality", str(game.pieces["lighting"].quality) if game.pieces.has("lighting") else "?"],
		]
		queue_redraw()
	game.sim_us = 0
	game.sim_ticks = 0
	game.frame_us = 0
	_win_start = now
	_frames = 0
	_worst = 0.0
	_calls = 0.0
	_prims = 0.0

static func _num(v: float) -> String:
	return str(int(v)) if is_equal_approx(v, round(v)) else "%.2f" % v

func _box() -> Rect2:
	var h := 7.0 + 26.0 + 3.0 + 28.0 + 5.0 + _rows.size() * 16.2 + 4.0 + 13.0 + 6.0
	return Rect2(size.x - 12.0 - 136.0, round(size.y * 0.38), 136.0, h)

func _draw() -> void:
	if _rows.is_empty():
		return
	var r := _box()
	# panel: the HUD's dark teal with a bronze hairline (hud.css --panel / --frame)
	draw_rect(r, Color(8 / 255.0, 30 / 255.0, 37 / 255.0, 0.92))
	draw_rect(r, Color(216 / 255.0, 180 / 255.0, 108 / 255.0, 0.55), false, 1.0)
	draw_rect(r.grow(1.0), Color(0, 0, 0, 0.6), false, 1.0)
	var title := S.font("title")
	var sans := S.font("sans")
	var x := r.position.x + 8.0
	var y := r.position.y + 7.0 + 22.0
	var col := Color("#7fd07a") if _fps >= 55.0 else (Color("#e8c35a") if _fps >= 30.0 else Color("#e8705a"))
	var fs := ("%.1f" % _fps) if _fps < 10.0 else str(int(round(_fps)))
	S.text(self, title, Vector2(x, y), fs, 22, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	S.text(self, title, Vector2(x + S.text_width(title, fs, 22) + 4.0, y), "FPS", 11, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6, 0.9)
	# graph: one bar per half second, lines at 30 and 60
	var g := Rect2(x, y + 6.0, 120.0, 28.0)
	for f in [30.0, 60.0]:
		var ly: float = g.end.y - f / 75.0 * g.size.y
		draw_line(Vector2(g.position.x, ly), Vector2(g.end.x, ly), Color(1, 1, 1, 0.15), 1.0)
	var step := g.size.x / 59.0
	for i in _history.size():
		var f: float = _history[i]
		var bh := minf(g.size.y, f / 75.0 * g.size.y)
		var bc := Color("#7fd07a") if f >= 55.0 else (Color("#e8c35a") if f >= 30.0 else Color("#e8705a"))
		draw_rect(Rect2(g.position.x + i * step, g.end.y - bh, maxf(1.0, step - 0.5), bh), bc)
	var ry := g.end.y + 5.0 + 12.0
	for row in _rows:
		S.text(self, sans, Vector2(x, ry), str(row[0]), 12, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.5)
		S.text(self, sans, Vector2(x, ry), str(row[1]), 12, S.INK, HORIZONTAL_ALIGNMENT_RIGHT, 120.0, 0.5)
		ry += 16.2
	S.text(self, sans, Vector2(x, ry + 4.0), "F3 hide", 10, Color(S.MUTED, 0.7), HORIZONTAL_ALIGNMENT_RIGHT, 120.0, 0.0)
