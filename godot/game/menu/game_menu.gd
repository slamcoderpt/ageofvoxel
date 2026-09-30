extends CanvasLayer
## The in-game menu (Esc / F10 in a match, after Age of Mythology: Retold's
## game menu): the match pauses under a dim veil and one framed panel in the
## HUD style offers Resume, Options (the main menu's Options dialog:
## graphics, display, performance meter) and Quit to Main Menu (through the
## loading screen, game/menu/flow.gd). Esc closes it (or Options first);
## keyboard / joypad navigable like the main menu's controls.
##
## main.gd hosts one per match scene (a scene with the in-game UI):
##   game.open_game_menu()   # what game/ui/ui.gd calls on Esc with nothing to cancel
##   game.game_menu.visible  # open?

const S := preload("res://game/ui/hud_style.gd")
const Tile := preload("res://game/menu/tile.gd")
const Options := preload("res://game/menu/options.gd")
const Flow := preload("res://game/menu/flow.gd")
const PANEL := preload("res://game/ui/panel.gdshader")

const W := 520.0
const H := 470.0

var game: Node = null
var kb_mode := false          # the tiles' focus ring (the Tile contract: menu.kb_mode)
var buttons := {}             # "resume" | "options" | "quit" -> Tile
var options: Control
var _root: Control
var _veil: Control
var _box: Control
var _panel: ColorRect
var _css := Vector2(1920, 1080)
var _was_paused := false
var _leaving := false

func _init() -> void:
	layer = 60
	visible = false
	process_mode = Node.PROCESS_MODE_ALWAYS

func setup(g: Node) -> void:
	game = g
	_root = Control.new()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_veil = Control.new()
	_veil.mouse_filter = Control.MOUSE_FILTER_STOP   # the world and the HUD take no clicks while open
	_veil.draw.connect(func() -> void:
		_veil.draw_rect(Rect2(Vector2.ZERO, _veil.size), Color(0.0, 0.02, 0.03, 0.62)))
	_root.add_child(_veil)
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
	_root.add_child(_panel)
	_box = Control.new()
	_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_box.draw.connect(_draw_box)
	_root.add_child(_box)
	var y := 130.0
	for b in [["resume", "RESUME"], ["options", "OPTIONS"], ["quit", "QUIT TO MAIN MENU"]]:
		var t := Tile.new()
		t.style = "bar"
		t.title = b[1]
		t.menu = self
		t.position = Vector2(56, y)
		t.size = Vector2(W - 112, 66)
		t.pressed.connect(_on_pressed.bind(b[0]))
		_box.add_child(t)
		buttons[b[0]] = t
		y += 88.0
	var order := ["resume", "options", "quit"]
	for i in order.size():
		var t: Tile = buttons[order[i]]
		t.focus_neighbor_top = buttons[order[(i + order.size() - 1) % order.size()]].get_path()
		t.focus_neighbor_bottom = buttons[order[(i + 1) % order.size()]].get_path()
	options = Options.new()
	options.menu = self
	options.visible = false
	_root.add_child(options)
	options.build()
	options.closed.connect(func() -> void:
		if visible:
			buttons.options.grab_focus())
	get_viewport().size_changed.connect(_layout)
	_layout()

func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	var sc := clampf(vs.y / 1080.0, 0.4, 3.0)
	transform = Transform2D().scaled(Vector2(sc, sc))
	_css = vs / sc
	for c in [_root, _veil, options]:
		c.position = Vector2.ZERO
		c.size = _css
	var p := (_css - Vector2(W, H)) * 0.5
	_box.position = p
	_box.size = Vector2(W, H)
	_panel.position = p - Vector2(24, 24)
	_panel.size = Vector2(W, H) + Vector2(48, 48)
	_veil.queue_redraw()
	_box.queue_redraw()

func open() -> void:
	if visible or _leaving or game == null:
		return
	_was_paused = bool(game.paused)
	game.paused = true
	visible = true
	options.visible = false
	_layout()
	buttons.resume.grab_focus()

func close() -> void:
	if not visible:
		return
	options.visible = false
	visible = false
	var f := get_viewport().gui_get_focus_owner()
	if f != null:
		f.release_focus()
	# a decided match stays paused (the result card), as does one the player paused
	var decided: bool = game.sim != null and bool(game.sim.is_paused())
	game.paused = _was_paused or decided

func _on_pressed(what: String) -> void:
	if _leaving:
		return
	match what:
		"resume":
			close()
		"options":
			options.open()
		"quit":
			_leaving = true
			Flow.to_main_menu(get_tree())

func _input(e: InputEvent) -> void:
	if e is InputEventMouseMotion and (e as InputEventMouseMotion).relative.length() > 2.0:
		kb_mode = false
	if not (e is InputEventKey or e is InputEventJoypadButton):
		return
	if not e.is_pressed() or e.is_echo():
		if visible and e is InputEventKey:
			get_viewport().set_input_as_handled()
		return
	var cancel := e.is_action_pressed("ui_cancel") or (e is InputEventKey and (e as InputEventKey).keycode == KEY_F10)
	if not visible:
		if e is InputEventKey and (e as InputEventKey).keycode == KEY_F10:
			open()
			get_viewport().set_input_as_handled()
		return
	if cancel:
		if options.visible:
			options.close()
		else:
			close()
		get_viewport().set_input_as_handled()
		return
	for a in ["ui_up", "ui_down", "ui_left", "ui_right", "ui_focus_next", "ui_focus_prev"]:
		if e.is_action_pressed(a):
			kb_mode = true
			return  # the GUI moves the focus
	if e.is_action_pressed("ui_accept"):
		return  # the focused tile presses
	# no hotkey reaches the HUD under the menu
	get_viewport().set_input_as_handled()

func _draw_box() -> void:
	S.text(_box, S.font("bold"), Vector2(0, 50), "GAME PAUSED", 15, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, W, 0.8, 4.0)
	S.text(_box, S.font("title"), Vector2(0, 92), "GAME MENU", 32, S.GOLD, HORIZONTAL_ALIGNMENT_CENTER, W, 0.9, 2.0)
	var cy := 108.0
	S.hgrad(_box, Rect2(60, cy, W * 0.5 - 76, 1.4), [[0.0, Color(S.GOLD, 0.0)], [1.0, Color(S.GOLD, 0.8)]])
	S.hgrad(_box, Rect2(W * 0.5 + 16, cy, W * 0.5 - 76, 1.4), [[0.0, Color(S.GOLD, 0.8)], [1.0, Color(S.GOLD, 0.0)]])
	S.boss(_box, Vector2(W * 0.5, cy + 0.7), 4.5)
	S.text(_box, S.font("sans"), Vector2(0, H - 34), "Esc returns to the match", 16, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, W, 0.8)
