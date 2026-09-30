extends SceneTree
## The match setup screen through the real input path (mouse events at the
## drawn widgets' hit zones, keys): player count, colour swap, team, AI
## difficulty, free for all, the pantheon picker (locked gods refuse), the
## map chooser (maps that do not take the player count are locked), remove /
## add AI players, Esc, then Play: the match loads with the settings in its
## args (M.from_args), and a second run checks Leave goes to the main menu.
##
##   godot --headless --path godot -s res://game/menu/setup/setup_check.gd -- --scene=setup
##
## Prints "SETUP ok|FAIL <step>" per step and "SETUP_RESULT {json}"; exits
## with the number of failed steps (99 on a timeout).

const M := preload("res://game/menu/setup/match_settings.gd")

var screen: Control
var fails: Array = []
var passes := 0

func _initialize() -> void:
	var dog := Timer.new()
	dog.wait_time = 240
	dog.one_shot = true
	dog.autostart = true
	dog.timeout.connect(func() -> void:
		printerr("SETUP timeout")
		quit(99))
	root.add_child.call_deferred(dog)
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

func _check(name: String, ok: bool, detail := "") -> void:
	if ok:
		passes += 1
		print("SETUP ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("SETUP FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _find_screen(n: Node) -> Control:
	if n is Control and n.get_script() and str(n.get_script().resource_path).ends_with("menu/setup/setup.gd"):
		return n
	for c in n.get_children():
		var r := _find_screen(c)
		if r:
			return r
	return null

## Window position of a zone's centre (layer 0 = the screen, 1 = lists / modals).
func _zone_pos(layer: int, id: String, arg = null) -> Variant:
	for z in screen._zones[layer]:
		if z.id != id:
			continue
		if arg != null:
			var a = z.arg
			if typeof(a) == TYPE_DICTIONARY:
				if a.id != arg[0] or int(a.row) != int(arg[1]):
					continue
			elif a != arg:
				continue
		return screen.get_global_transform_with_canvas() * (z.rect as Rect2).get_center()
	return null

func _click_at(p: Vector2) -> void:
	var m := InputEventMouseMotion.new()
	m.position = p
	m.global_position = p
	Input.warp_mouse(p)
	Input.parse_input_event(m)
	await _frames(1)
	for pressed in [true, false]:
		var e := InputEventMouseButton.new()
		e.position = p
		e.global_position = p
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = pressed
		Input.parse_input_event(e)
		await _frames(1)
	await _frames(2)

func _click(layer: int, id: String, arg = null) -> bool:
	var p = _zone_pos(layer, id, arg)
	if p == null:
		return false
	await _click_at(p)
	return true

## Open dropdown (id, row) and pick the item whose value is v.
func _pick(id: String, row: int, v) -> bool:
	var zp = _zone_pos(0, "dd", [id, row])
	if not await _click(0, "dd", [id, row]):
		return false
	print("DBG pick ", id, " at ", zp, " open=", screen._open.get("id", "-"), " vp=", root.size, " scale=", screen.scale)
	if screen._open.is_empty():
		return false
	var idx := -1
	for i in screen._open.items.size():
		if screen._open.items[i].value == v:
			idx = i
	if idx < 0:
		return false
	return await _click(1, "item", idx)

func _key(k: Key) -> void:
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = k
		e.physical_keycode = k
		e.pressed = pressed
		Input.parse_input_event(e)
		await _frames(1)

func _run() -> void:
	await _frames(8)
	screen = _find_screen(root)
	_check("screen", screen != null)
	if screen == null:
		return _done()
	var s: Dictionary = screen.settings
	_check("defaults", s.players.size() == 2 and s.map == "aegean_hills", "%d players, %s" % [s.players.size(), s.map])
	_check("count 4", await _pick("count", 0, 4) and s.players.size() == 4, str(s.players.size()))
	_check("map fits the count", M.map_supports(s.map, 4) and s.map != "aegean_hills" and screen._note != "", "%s: %s" % [s.map, screen._note])
	_check("colour swap", await _pick("color", 1, 1) and int(s.players[1].color) == 1 and int(s.players[0].color) == 2,
		"%d %d" % [s.players[0].color, s.players[1].color])
	_check("team", await _pick("team", 2, 1) and int(s.players[2].team) == 1, str(s.players[2].team))
	_check("difficulty", await _pick("difficulty", 3, "titan") and s.players[3].ai == "titan", str(s.players[3].ai))
	_check("resources", await _pick("resources", 0, "high") and s.resources == "high")
	_check("speed", await _pick("speed", 0, 1.5) and float(s.speed) == 1.5)
	_check("size", await _pick("size", 0, 160) and int(s.map_size) == 160)
	var seed0 := int(s.seed)
	_check("reseed", await _click(0, "reseed") and int(s.seed) != seed0, "%d -> %d" % [seed0, s.seed])
	await _click(0, "toggle", "free_for_all")
	_check("free for all", bool(s.free_for_all) and _zone_pos(0, "dd", ["team", 1]) == null)
	await _click(0, "toggle", "free_for_all")
	# pantheon picker
	await _click(0, "god", 0)
	_check("god modal", screen._modal == "god")
	await _click(1, "god_pick", "hades")
	_check("locked god refused", screen._god_pick == "zeus")
	await _click(1, "god_confirm")
	_check("god confirm", screen._modal == "" and s.players[0].god == "zeus")
	# map chooser
	await _click(0, "select_map")
	_check("map modal", screen._modal == "map")
	_check("2-player map locked", _zone_pos(1, "map_pick", "marathon") == null)
	await _click(1, "map_pick", "random")
	_check("random map", s.map == "random" and screen._modal == "")
	# rows
	await _click(0, "remove", 3)
	_check("remove", s.players.size() == 3)
	await _click(0, "add")
	_check("add", s.players.size() == 4 and s.players[3].human == false)
	# Esc closes an open list
	await _click(0, "dd", ["team", 1])
	await _key(KEY_ESCAPE)
	_check("esc closes", screen._open.is_empty() and screen.is_inside_tree())
	# Play
	await _click(0, "play")
	await _frames(20)
	var main := current_scene
	var a: Dictionary = AovArgs.override
	var m := M.from_args(a)
	_check("play args", str(a.get("scene", "")) == "skirmish" and m.get("players", []).size() == 4 and m.map != "random",
		"scene=%s map=%s seed=%s" % [a.get("scene"), m.get("map"), a.get("seed")])
	_check("match loaded", main != null and "scene_def" in main and str(main.scene_def.get("name", "")) == "skirmish" and main.sim != null
		and int(main.sim.get_map_size()) == 160 and float(main.time_scale) == 1.5, str(main.scene_def.get("name", "")) if main else "")
	# back to a setup screen, then Leave: the main menu
	AovArgs.override = {"scene": "setup"}
	change_scene_to_file("res://game/main.tscn")
	await _frames(12)
	screen = _find_screen(root)
	_check("setup again", screen != null and screen.settings.players.size() == 4, "remembers the last match")
	if screen:
		await _click(0, "back")
		await _frames(20)
		var sn := str(current_scene.scene_def.get("name", "")) if current_scene and "scene_def" in current_scene else ""
		_check("leave -> menu", sn == "menu", sn)
	_done()

func _done() -> void:
	print("SETUP_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails}))
	AovArgs.override = {}
	quit(fails.size())
