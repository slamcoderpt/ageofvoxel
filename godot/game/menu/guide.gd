extends Control
## Main-menu "How to Play" sheet: the goal of a skirmish and the controls
## (mouse, hotkeys, camera), in the same framed panel as Options (options.gd)
## over a dim veil. One BACK button holds the focus; Esc / B or a click on the
## veil closes it.

const S := preload("res://game/ui/hud_style.gd")
const Tile := preload("res://game/menu/tile.gd")
const PANEL := preload("res://game/ui/panel.gdshader")

signal closed

var menu: Node
var _box: Control
var _panel: ColorRect
var _back: Button
const W := 900.0
const H := 600.0

## [key, action]: the left column is the mouse and camera, the right the keys.
const MOUSE := [
	["Left click", "Select a unit or building"],
	["Drag", "Select everyone in the box"],
	["Double-click", "Select all of that kind on screen"],
	["Right click", "Move, gather, build or attack"],
	["A + click", "Attack-move: fight on the way"],
	["Wheel", "Zoom the camera"],
	["[  ]", "Turn the camera"],
	["Home", "Reset the camera"],
]
const KEYS := [
	[".", "Next idle villager"],
	["H", "Jump to your Town Center"],
	["Q E F S R B", "Build (villagers selected)"],
	["X", "Stop"],
	["Ctrl + 1-9", "Assign a control group"],
	["1-9", "Recall a control group"],
	["Z  C  V", "Lightning Storm, Bolt, Meteor"],
	["F1  ·  Esc", "Hide the HUD  ·  Cancel"],
]

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
	_back = Tile.new()
	_back.style = "bar"
	_back.title = "BACK"
	_back.menu = menu
	_back.position = Vector2(W * 0.5 - 130, H - 84)
	_back.size = Vector2(260, 60)
	_back.pressed.connect(close)
	_box.add_child(_back)
	resized.connect(_layout)
	_layout()

func _layout() -> void:
	var p := (size - Vector2(W, H)) * 0.5
	_box.position = p
	_box.size = Vector2(W, H)
	_panel.position = p - Vector2(24, 24)
	_panel.size = Vector2(W, H) + Vector2(48, 48)
	queue_redraw()
	_box.queue_redraw()

func open() -> void:
	visible = true
	_back.grab_focus()

func close() -> void:
	visible = false
	closed.emit()

func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		if not Rect2(_box.position, _box.size).has_point(e.position):
			close()
			accept_event()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.0, 0.02, 0.03, 0.55))

func _draw_box() -> void:
	var f := S.font("title")
	S.text(_box, f, Vector2(0, 62), "HOW TO PLAY", 32, S.GOLD, HORIZONTAL_ALIGNMENT_CENTER, W, 0.9, 2.0)
	var cy := 80.0
	S.hgrad(_box, Rect2(80, cy, W * 0.5 - 96, 1.4), [[0.0, Color(S.GOLD, 0.0)], [1.0, Color(S.GOLD, 0.8)]])
	S.hgrad(_box, Rect2(W * 0.5 + 16, cy, W * 0.5 - 96, 1.4), [[0.0, Color(S.GOLD, 0.8)], [1.0, Color(S.GOLD, 0.0)]])
	S.boss(_box, Vector2(W * 0.5, cy + 0.7), 4.5)
	S.text(_box, S.font("sans"), Vector2(0, 118), "Gather, build your town, raise an army and destroy the enemy Town Center.", 19, S.INK, HORIZONTAL_ALIGNMENT_CENTER, W, 0.8)
	_column(Vector2(48, 164), "MOUSE AND CAMERA", MOUSE, 150.0)
	_column(Vector2(W * 0.5 + 16, 164), "HOTKEYS", KEYS, 150.0)
	_box.draw_line(Vector2(W * 0.5, 170), Vector2(W * 0.5, H - 110), Color(S.BRONZE, 0.4), 1.0)

func _column(p: Vector2, head: String, rows: Array, kw: float) -> void:
	S.text(_box, S.font("title7"), p, head, 14, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8, 2.5)
	var y := p.y + 20.0
	for row in rows:
		# the key on a small bronze-rimmed plate, then what it does
		var k := str(row[0])
		var bw := minf(kw, S.text_width(S.font("bold"), k, 15) + 20.0)
		var br := Rect2(p.x, y, bw, 26)
		_box.draw_rect(br.grow(1), Color(0, 0, 0, 0.6))
		S.vgrad(_box, br, [[0.0, Color("#1b3640")], [1.0, Color("#0b1a1f")]])
		_box.draw_rect(br, Color(S.BRONZE_HI, 0.7), false, 1.0)
		S.text(_box, S.font("bold"), Vector2(br.position.x, y + 19), k, 15, S.INK, HORIZONTAL_ALIGNMENT_CENTER, bw, 0.8)
		S.text(_box, S.font("sans"), Vector2(p.x + kw + 12, y + 19), str(row[1]), 17, Color(S.INK, 0.9), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
		y += 36.0
