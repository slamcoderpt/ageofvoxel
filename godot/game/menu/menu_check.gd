extends SceneTree
## Main-menu check through the real input path (keys, joypad, mouse events fed
## to Input.parse_input_event), started with NO scene argument, so it also
## checks that a plain launch opens the menu:
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/menu/menu_check.gd
##
## Prints "MENU ok|FAIL <step>" per step; exits with the number of failures
## (99 on a timeout). Restores the Graphics setting it changes.

const Settings := preload("res://game/ui/settings.gd")
const Flow := preload("res://game/menu/flow.gd")
const Art := preload("res://game/menu/art.gd")

var main: Node
var menu: Node
var fails: Array = []
var passes := 0
var _quality0 = null

func _initialize() -> void:
	var dog := Timer.new()
	dog.wait_time = 600
	dog.one_shot = true
	dog.autostart = true
	dog.timeout.connect(func() -> void:
		printerr("MENU timeout")
		quit(99))
	root.add_child.call_deferred(dog)
	_quality0 = Settings.read("graphics", "quality", null)
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

func _check(name: String, ok: bool, detail := "") -> void:
	if ok:
		passes += 1
		print("MENU ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("MENU FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _key(k: int) -> void:
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = k
		e.physical_keycode = k
		e.pressed = pressed
		Input.parse_input_event(e)
		await _frames(1)
	await _frames(2)

func _pad(b: int) -> void:
	for pressed in [true, false]:
		var e := InputEventJoypadButton.new()
		e.button_index = b
		e.pressed = pressed
		e.device = 0
		Input.parse_input_event(e)
		await _frames(1)
	await _frames(2)

func _screen(css: Vector2) -> Vector2:
	return css * float(menu._scale)

func _move(p: Vector2) -> void:
	var e := InputEventMouseMotion.new()
	var last: Vector2 = root.get_mouse_position()
	e.position = p
	e.global_position = p
	e.relative = p - last
	Input.warp_mouse(p)
	Input.parse_input_event(e)
	await _frames(2)

func _click(p: Vector2) -> void:
	await _move(p)
	for pressed in [true, false]:
		var e := InputEventMouseButton.new()
		e.position = p
		e.global_position = p
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = pressed
		Input.parse_input_event(e)
		await _frames(1)
	await _frames(2)

func _tile_center(n: String) -> Vector2:
	var t: Control = menu._tiles[n]
	return _screen(t.get_global_rect().get_center())  # the menu's CanvasLayer is scaled

func _focus_name() -> String:
	var f := root.gui_get_focus_owner()
	return str(f.name) if f else ""

func _run() -> void:
	await _frames(12)
	main = current_scene
	menu = main.pieces.get("menu") if main else null
	_check("no-arg launch opens the menu", main != null and str(main.scene_def.get("name", "")) == "menu" and menu != null and menu.active)
	if menu == null or not menu.active:
		_finish()
		return
	var ui: Node = main.pieces.get("ui")
	_check("no in-game UI behind the menu (no HUD, hotkeys or world clicks)", ui == null)
	_check("camera is the menu's", not main.camera.user_control)
	# the hero shot: low evening camera, the fleet off the beach, the evening sky
	_check("hero shot: low camera", rad_to_deg(main.camera.pitch) < 20.0, "%.1f" % rad_to_deg(main.camera.pitch))
	var boats: PackedFloat32Array = main.sim.get_economy().get("boats", PackedFloat32Array())
	_check("hero shot: the fleet is out", boats.size() >= 30, str(boats.size() / 10))
	# the hero landmark: the acropolis temple on the headland fills the
	# right-centre third of the frame, the boats lie between it and the camera
	var an: Dictionary = menu._hero_anchor()
	var eye: Vector3 = menu._anchor_eye(an)
	var hp: Vector2 = menu._hero_pos()
	var ts: Vector2 = menu._to_screen(an, eye, Vector3(hp.x, main.sim.height_at(hp.x, hp.y) + 3.0, hp.y))
	var temples := 0
	var bl: Dictionary = main.sim.get_buildings()
	var ti: int = PackedStringArray(bl.get("type_names", PackedStringArray())).find("temple")
	for ty in PackedByteArray(bl.get("type", PackedByteArray())):
		temples += 1 if int(ty) == ti else 0
	_check("hero shot: the acropolis stands in the right-centre third", menu._acro != Vector2.ZERO and temples >= 2 and ts.x > 1000.0 and ts.x < 1500.0 and ts.y > 150.0 and ts.y < 600.0, "%d temples, at %s" % [temples, ts])
	var near := 0
	var td := Vector2(eye.x, eye.z).distance_to(hp)
	for i in range(0, boats.size() - 3, 10):
		near += 1 if Vector2(eye.x, eye.z).distance_to(Vector2(boats[i + 2], boats[i + 3])) < td * 0.8 else 0
	_check("hero shot: the fleet lies in the mid-ground before the temple", near >= 3, "%d of %d" % [near, boats.size() / 10])
	var wm: ShaderMaterial = main.pieces.terrain.water_material
	var sc: Color = wm.get_shader_parameter("shallow_col")
	_check("hero shot: the sea graded down from the play map's cyan", sc.s < 0.5 and float(wm.get_shader_parameter("out_sat")) < 1.0, "shallow %s" % sc)
	_check("no Load row: Quick Match instead", menu._tiles.has("quick") and not menu._tiles.has("load"))
	await _frames(45)  # the intro
	# the feature card carries rendered hero art (hero_art.gd), not a flat card
	var fe: Node = menu._tiles.feature
	var art_ok := false
	var art_info := "no hero art"
	if fe.hero != null:
		var img: Image = fe.hero.get_texture().get_image()
		var sat := 0.0
		var n := 0
		for y in range(0, img.get_height(), 25):
			for x in range(0, img.get_width(), 25):
				var c := img.get_pixel(x, y)
				sat += c.s * c.v
				n += 1
		sat /= maxf(1.0, n)
		art_info = "%dx%d, colour %.2f" % [img.get_width(), img.get_height(), sat]
		art_ok = img.get_width() >= 400 and sat > 0.25
	_check("feature card: rendered hero art in full colour", art_ok, art_info)
	var p0: int = fe.page
	fe.next_page()
	_check("feature card: a page turn reframes the art", fe.hero != null and fe.hero.page == fe.page and fe.page != p0, "%d -> %d" % [p0, fe.page])

	# keyboard: the first arrow focuses Skirmish, the next ones move between tiles
	await _key(KEY_DOWN)
	_check("first key focuses Skirmish", _focus_name() == "skirmish" and menu.kb_mode, _focus_name())
	await _key(KEY_DOWN)
	var below := _focus_name()
	_check("Down moves to the row below", below in ["campaign", "multiplayer"], below)
	await _key(KEY_RIGHT)
	_check("Right moves along the row", _focus_name() == "multiplayer", _focus_name())
	await _key(KEY_ENTER)
	_check("Enter on an unavailable tile shows a notice", menu._toast_t >= 0.0 and menu._toast_title == "Multiplayer", menu._toast_title)
	await _key(KEY_UP)
	_check("Up returns to Skirmish", _focus_name() == "skirmish", _focus_name())
	await _key(KEY_UP)
	_check("Up again reaches the top bar", _focus_name() in ["tab_play", "tab_options", "burger"], _focus_name())

	# joypad D-pad
	await _pad(JOY_BUTTON_DPAD_DOWN)
	var jf := _focus_name()
	_check("joypad D-pad moves the focus", jf != "" and jf != "tab_play" and jf != "tab_options", jf)

	# Options exists once (the top bar tab), not again as a row
	_check("Options is not duplicated as a row", not menu._tiles.has("options") and menu._tiles.has("tab_options"))
	# Campaign / Multiplayer carry full-bleed engravings, not a small icon
	var bleed := true
	for n in ["campaign", "multiplayer"]:
		var tl: Control = menu._tiles[n]
		var tx: Texture2D = Art.texture(tl.art, Vector2i(tl.size))
		bleed = bleed and tl.art in tl.FULL_BLEED and tx != null and tx.get_width() >= int(tl.size.x) - 1 and tx.get_height() >= int(tl.size.y) - 1
	_check("Campaign / Multiplayer art fills the tile", bleed)

	# mouse: hover shows, then leaves keyboard mode; click the Options tab opens the dialog
	await _move(_tile_center("tab_options"))
	await _frames(10)
	_check("hover highlights a tile", menu._tiles.tab_options.is_hovered() and menu._tiles.tab_options.hover_k > 0.5 and not menu.kb_mode)
	await _click(_tile_center("tab_options"))
	_check("click Options opens the dialog", menu._options.visible)
	var lighting: Node = main.pieces.get("lighting")
	var q0: String = str(lighting.quality) if lighting else ""
	var low: Control = null
	for t in menu._options._rows["quality"].tiles:
		if str(t.get_meta("value")) == "low":
			low = t
	await _click(_screen(low.get_global_rect().get_center()))
	_check("Graphics Low applies live", lighting == null or str(lighting.quality) == "low", str(lighting.quality) if lighting else "")
	_check("Graphics Low is remembered", str(Settings.read("graphics", "quality", "")) == "low")
	await _key(KEY_ESCAPE)
	_check("Esc closes Options", not menu._options.visible)
	_check("focus returns to the Options tab", _focus_name() == "tab_options", _focus_name())
	if lighting and q0 != "":
		lighting.set_quality(q0)

	# How to Play: the controls sheet opens, Esc closes it
	await _click(_tile_center("guide"))
	_check("How to Play opens the controls sheet", menu._guide.visible)
	await _key(KEY_ESCAPE)
	_check("Esc closes How to Play", not menu._guide.visible and _focus_name() == "guide", _focus_name())

	# the world behind the menu takes no clicks (no selection box / orders)
	var n0: int = ui.selected.size() if ui else 0
	var vs: Vector2 = root.get_visible_rect().size
	await _click(Vector2(vs.x * 0.75, vs.y * 0.6))
	_check("world clicks are blocked", ui == null or ui.selected.size() == n0)

	# Skirmish: the setup screen when there is one, else a match
	var setup_path := Flow.setup_screen_path()
	await _click(_tile_center("skirmish"))
	if setup_path != "":
		await _frames(5)
		_check("Skirmish opens the setup screen", menu._screen != null and not menu._ui.visible, setup_path)
		menu.start_match({})
	await _frames(40)
	var m2: Node = current_scene
	_check("a match starts", m2 != null and m2 != main and str(m2.scene_def.get("name", "")) == "skirmish" and m2.sim != null,
		str(m2.scene_def.get("name", "")) if m2 else "")
	_check("the match has its HUD", m2 != null and m2.pieces.has("ui") and m2.pieces.ui.hud_visible)
	_check("menu piece is idle in a match", m2 != null and not m2.pieces.menu.active)
	# and back
	Flow.to_main_menu(self)
	await _frames(30)
	var m3: Node = current_scene
	_check("back to the main menu", m3 != null and str(m3.scene_def.get("name", "")) == "menu" and m3.pieces.menu.active)
	_finish()

func _finish() -> void:
	if _quality0 == null:
		var cf := ConfigFile.new()
		if cf.load(Settings.PATH) == OK and cf.has_section_key("graphics", "quality"):
			cf.erase_section_key("graphics", "quality")
			cf.save(Settings.PATH)
	else:
		Settings.write("graphics", "quality", _quality0)
	AovArgs.override = {}
	print("MENU_RESULT %s" % JSON.stringify({"passes": passes, "fails": fails}))
	quit(fails.size())
