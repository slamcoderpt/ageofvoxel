extends Control
## Main-menu Options dialog: Graphics quality (the gear card's High / Medium /
## Low: applied live through the lighting piece and remembered in
## user://settings.cfg, the same key the in-game card writes), window mode and
## the F3 performance meter. A dim veil over the menu, one framed panel in the
## HUD style, keyboard / joypad navigable; Esc or Back closes it.

const S := preload("res://game/ui/hud_style.gd")
const Tile := preload("res://game/menu/tile.gd")
const Settings := preload("res://game/ui/settings.gd")
const PANEL := preload("res://game/ui/panel.gdshader")

signal closed

var menu: Node
var _box: Control
var _panel: ColorRect
var _rows := {}      # key -> [Tile]
var _back: Button
const W := 700.0
const H := 470.0

func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP

func build() -> void:
	_panel = ColorRect.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = PANEL
	m.set_shader_parameter("margin", 24.0)
	m.set_shader_parameter("chamfer", Vector4(14, 14, 14, 14))
	m.set_shader_parameter("border", Vector4(3, 3, 3, 3))
	m.set_shader_parameter("bg_mode", 1)
	m.set_shader_parameter("bg0", Color("#15303a"))
	m.set_shader_parameter("bg1", Color("#0b1a20"))
	m.set_shader_parameter("bg2", Color("#050c0f"))
	m.set_shader_parameter("radial_center", Vector2(0.5, 0.0))
	m.set_shader_parameter("radial_radius", Vector2(1.2, 1.1))
	m.set_shader_parameter("shadow_alpha", 0.7)
	m.set_shader_parameter("shadow_blur", 30.0)
	m.set_shader_parameter("size", Vector2(W, H))
	_panel.material = m
	add_child(_panel)
	_box = Control.new()
	_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_box)
	_box.draw.connect(_draw_box)
	var y := 128.0
	_row("quality", "Graphics", [["high", "High"], ["medium", "Medium"], ["low", "Low"]], y)
	_row("window", "Display", [["windowed", "Windowed"], ["fullscreen", "Fullscreen"]], y + 84)
	_row("perf", "Performance meter", [["off", "Off"], ["on", "On"]], y + 168)
	_back = Tile.new()
	_back.style = "bar"
	_back.title = "BACK"
	_back.menu = menu
	_back.position = Vector2(W * 0.5 - 130, H - 92)
	_back.size = Vector2(260, 60)
	_back.pressed.connect(close)
	_box.add_child(_back)
	_refresh()
	resized.connect(_layout)
	_layout()

func _row(key: String, label: String, choices: Array, y: float) -> void:
	var tiles: Array = []
	var x := 300.0
	var w := (W - 48.0 - x) / choices.size() - 8.0
	for c in choices:
		var t := Tile.new()
		t.style = "seg"
		t.title = str(c[1]).to_upper()
		t.menu = menu
		t.position = Vector2(x, y - 24)
		t.size = Vector2(w, 46)
		t.set_meta("value", c[0])
		t.pressed.connect(_choose.bind(key, str(c[0])))
		_box.add_child(t)
		tiles.append(t)
		x += w + 8.0
	_rows[key] = {"label": label, "y": y, "tiles": tiles}

func _layout() -> void:
	var p := (size - Vector2(W, H)) * 0.5
	_box.position = p
	_box.size = Vector2(W, H)
	_panel.position = p - Vector2(24, 24)
	_panel.size = Vector2(W, H) + Vector2(48, 48)
	queue_redraw()
	_box.queue_redraw()

func current(key: String) -> String:
	match key:
		"quality":
			var l: Node = menu.game.pieces.get("lighting") if menu and menu.game else null
			return str(l.quality) if l else str(Settings.read("graphics", "quality", "high"))
		"window":
			var mode := DisplayServer.window_get_mode()
			return "fullscreen" if mode == DisplayServer.WINDOW_MODE_FULLSCREEN or mode == DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN else "windowed"
		"perf":
			return "on" if bool(Settings.read("ui", "perf", true)) else "off"
	return ""

func _choose(key: String, v: String) -> void:
	match key:
		"quality":
			if menu and menu.game and menu.game.pieces.has("lighting"):
				menu.game.pieces["lighting"].set_quality(v)
			Settings.write("graphics", "quality", v)
		"window":
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if v == "fullscreen" else DisplayServer.WINDOW_MODE_WINDOWED)
		"perf":
			Settings.write("ui", "perf", v == "on")
	_refresh()

func _refresh() -> void:
	for key in _rows:
		var cur := current(key)
		for t in _rows[key].tiles:
			t.selected = str(t.get_meta("value")) == cur
	_box.queue_redraw()

func open() -> void:
	visible = true
	_refresh()
	var first: Array = _rows["quality"].tiles
	for t in first:
		if t.selected:
			t.grab_focus()
			return
	first[0].grab_focus()

func close() -> void:
	visible = false
	closed.emit()

func _gui_input(e: InputEvent) -> void:
	# a click on the veil outside the panel closes the dialog
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		if not Rect2(_box.position, _box.size).has_point(e.position):
			close()
			accept_event()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.0, 0.02, 0.03, 0.55))

func _draw_box() -> void:
	var f := S.font("title")
	S.text(_box, f, Vector2(0, 62), "OPTIONS", 32, S.GOLD, HORIZONTAL_ALIGNMENT_CENTER, W, 0.9, 2.0)
	var cy := 80.0
	S.hgrad(_box, Rect2(60, cy, W * 0.5 - 76, 1.4), [[0.0, Color(S.GOLD, 0.0)], [1.0, Color(S.GOLD, 0.8)]])
	S.hgrad(_box, Rect2(W * 0.5 + 16, cy, W * 0.5 - 76, 1.4), [[0.0, Color(S.GOLD, 0.8)], [1.0, Color(S.GOLD, 0.0)]])
	S.boss(_box, Vector2(W * 0.5, cy + 0.7), 4.5)
	for key in _rows:
		var row: Dictionary = _rows[key]
		S.text(_box, S.font("bold"), Vector2(56, row.y + 6), str(row.label), 21, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
		_box.draw_line(Vector2(48, row.y + 38), Vector2(W - 48, row.y + 38), Color(S.BRONZE, 0.35), 1.0)
	S.text(_box, S.font("sans"), Vector2(0, H - 112), "Graphics applies at once and is remembered for your matches.", 16, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, W, 0.8)
