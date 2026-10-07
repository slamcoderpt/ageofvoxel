extends SceneTree
## The Egyptians played from the menu through real input only (ui piece:
## the setup's pantheon picker, the Egyptian HUD; PORTING.md "Egyptian HUD").
## Every player action is an InputEvent fed to Input.parse_input_event: mouse
## moves / presses on the drawn widgets of the main menu, the setup screen and
## the HUD (their hit zones' centres), on units and buildings (screen points
## projected from the sim) and on the ground, and keys; what happened is read
## back from the sim.
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/core/egypt_playtest.gd [-- --shots=/abs/dir]
##
## Launched with no scene argument (a player's launch: the main menu).
## Steps: Skirmish -> the setup screen; the pantheon disc of your row opens
## Select Pantheon; Ra (in the Egyptians' row) is picked and confirmed; the
## starting resources set to High in their dropdown; Play -> the match loads
## and the sim has you Egyptian (civ, god Ra, Laborers, the Pharaoh, no
## villager); a click and shift-clicks select the Laborers (Ctrl+1); the
## Laborers' build grid is the Egyptian one (Granary on W, House on Q,
## Barracks greyed "Requires Classical Age", a Granary tooltip on hover);
## the Granary button + a ground click and Q + a ground click lay a Granary
## and a House the Laborers build; H selects the Town Center, whose age-up
## shows Ra's two Classical minor gods (Bast on A, Ptah on S), a click on
## Bast advances to the Classical Age with Bast (get_gods: minor 1 = bast,
## Eclipse among the powers); D + a ground click lays a Barracks; a click
## on it shows Spearman / Axeman / Slinger, Q trains a Spearman; a click on
## the Pharaoh shows Empower (Q), Q + a click on the Barracks empowers it
## (get_civ_state: the Barracks empowered at 1); a click on the Rain button
## casts Rain (favor paid, its cooldown running, Rain active in the sim);
## then Esc -> Quit to Main Menu, Skirmish again, Set picked, Play: a click on
## Set's Pharaoh shows the eight Animals of Set, each with its own rendered
## icon and stats, every key distinct (A Attack-Move); S summons a Baboon.
## Harness shortcuts (not player input): the enemy AI is off once the match
## runs, the sim is stepped fast while frames render between, 60 favor is
## granted before the cast (an Egyptian starts with none; a Monument makes
## 4.5 a minute).
##
## Prints "EGYPTPLAY ok|FAIL <step>" and "EGYPTPLAY_RESULT {json}"; exit =
## failures (99 on a timeout). Needs a rendering display (hit zones are
## registered while the HUD draws; headless windows are 64x64).

const Loading := preload("res://game/menu/loading.gd")
const ME := 1

var fails: Array = []
var passes := 0
var clicks := 0
var keys := 0
var shots := ""
var result := {}
var screen: Control      # the setup screen
var main: Node
var ui: Node
var sim: Object
var cam: Camera3D

func _initialize() -> void:
	var dog := Timer.new()
	dog.wait_time = 2400
	dog.one_shot = true
	dog.autostart = true
	dog.timeout.connect(func() -> void:
		printerr("EGYPTPLAY timeout")
		print("EGYPTPLAY_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails + ["timeout"], "steps": result}))
		quit(99))
	root.add_child.call_deferred(dog)
	var a := AovArgs.parse()
	shots = str(a.get("shots", ""))
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

# ---- plumbing ---------------------------------------------------------------------------

func _check(name: String, ok: bool, detail := "") -> void:
	result[name] = ok
	if ok:
		passes += 1
		print("EGYPTPLAY ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("EGYPTPLAY FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _shot(name: String) -> void:
	if shots == "":
		return
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(shots)
	root.get_texture().get_image().save_png(shots.path_join("egypt_play_%s.png" % name))

func _move(p: Vector2, mask := 0) -> void:
	var e := InputEventMouseMotion.new()
	var last: Vector2 = root.get_mouse_position()
	e.position = p
	e.global_position = p
	e.relative = p - last
	e.button_mask = mask
	Input.warp_mouse(p)
	Input.parse_input_event(e)
	await _frames(1)

func _button(p: Vector2, button: int, pressed: bool, mods := {}) -> void:
	var e := InputEventMouseButton.new()
	e.position = p
	e.global_position = p
	e.button_index = button
	e.pressed = pressed
	e.factor = 1.0
	e.shift_pressed = mods.get("shift", false)
	e.ctrl_pressed = mods.get("ctrl", false)
	Input.parse_input_event(e)
	await _frames(1)

func _click(p: Vector2, button := MOUSE_BUTTON_LEFT, mods := {}) -> void:
	clicks += 1
	await _move(p)
	await _button(p, button, true, mods)
	await _button(p, button, false, mods)
	await _frames(2)

func _key(k: Key, mods := {}) -> void:
	keys += 1
	var e := InputEventKey.new()
	e.keycode = k
	e.physical_keycode = k
	e.pressed = true
	e.ctrl_pressed = mods.get("ctrl", false)
	Input.parse_input_event(e)
	await _frames(1)
	var r := e.duplicate() as InputEventKey
	r.pressed = false
	Input.parse_input_event(r)
	await _frames(2)

func _main() -> Node:
	var m := current_scene
	return m if m != null and "scene_def" in m else null

func _scene_name() -> String:
	var m := _main()
	return str(m.scene_def.get("name", "")) if m else ""

## wait until `scene` is built and on screen (no loading screen left)
func _await_scene(scene: String, old, max_frames := 1200) -> bool:
	for i in max_frames:
		await process_frame
		var l := root.get_node_or_null(Loading.NODE_NAME)
		var m := _main()
		if m != null and (old == null or not is_instance_valid(old) or m != old) and _scene_name() == scene and not bool(m.building) and m.sim != null and l == null:
			return true
	return false

# ---- the setup screen (as game/core/menu_playtest.gd) -------------------------------------

func _find_screen(n: Node) -> Control:
	if n is Control and n.get_script() and str(n.get_script().resource_path).ends_with("menu/setup/setup.gd"):
		return n
	for c in n.get_children():
		var r := _find_screen(c)
		if r:
			return r
	return null

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

func _click_zone(layer: int, id: String, arg = null) -> bool:
	var p = _zone_pos(layer, id, arg)
	if p == null:
		return false
	await _click(p)
	return true

## open dropdown (id, row) and click the item whose value is v
func _pick(id: String, row: int, v) -> bool:
	if not await _click_zone(0, "dd", [id, row]):
		return false
	if screen._open.is_empty():
		return false
	var idx := -1
	for i in screen._open.items.size():
		if screen._open.items[i].value == v:
			idx = i
	if idx < 0:
		await _key(KEY_ESCAPE)
		return false
	return await _click_zone(1, "item", idx)

# ---- the match --------------------------------------------------------------------------

func _bind() -> void:
	main = _main()
	ui = main.pieces.get("ui")
	sim = main.sim
	cam = main.camera

func _screen(x: float, z: float, lift := 0.0) -> Vector2:
	cam.apply()
	return cam.unproject_position(Vector3(x, sim.height_at(x, z) + lift, z))

func _on_screen(p: Vector2) -> bool:
	var r := root.get_visible_rect().grow(-40)
	return r.has_point(p) and p.y > r.size.y * 0.14 and p.y < r.size.y * 0.72

func _units(type_name := "") -> Array:
	var u: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in int(u.count):
		if int(u.owner[i]) == ME and not (u.flags[i] & 2) and (type_name == "" or names[u.type[i]] == type_name):
			out.append({"id": int(u.ids[i]), "x": float(u.pos[i * 2]), "z": float(u.pos[i * 2 + 1])})
	return out

func _buildings(type_name: String) -> Array:
	var B: Dictionary = sim.get_buildings()
	var out := []
	for i in int(B.count):
		if int(B.owner[i]) == ME and B.type_names[B.type[i]] == type_name:
			out.append({"id": int(B.ids[i]), "tx": int(B.rect[i * 4]), "tz": int(B.rect[i * 4 + 1]), "w": int(B.rect[i * 4 + 2]), "h": int(B.rect[i * 4 + 3])})
	return out

func _cmd_where(pred: Callable) -> Variant:
	for z in ui._back.zones:
		if z.id == "cmd":
			var c = ui.commands[int(z.arg)]
			if c != null and pred.call(c):
				return ui._back.get_global_transform_with_canvas() * z.rect.get_center()
	return null

func _cmd_find(pred: Callable) -> Dictionary:
	for c in ui.commands:
		if c != null and pred.call(c):
			return c
	return {}

func _build_cmd(t: String) -> Dictionary:
	return _cmd_find(func(c): return str(c.get("action", "")) == "build" and str(c.get("arg", "")) == t)

func _hud_zone(id: String, arg = null) -> Variant:
	for layer in [ui._front, ui._back]:
		for z in layer.zones:
			if z.id == id and (arg == null or str(z.arg) == str(arg)):
				return layer.get_global_transform_with_canvas() * z.rect.get_center()
	return null

## step the sim fast (frames render in between) until done() or the time is up
func _step_until(seconds: float, done: Callable) -> float:
	var t := 0.0
	while t < seconds:
		if done.call():
			return t
		sim.tick(30)
		t += 1.0
		if int(t) % 3 == 0:
			await _frames(1)
	return t if done.call() else -1.0

func _look(x: float, z: float) -> void:
	cam.target.x = x
	cam.target.z = z
	await _frames(6)

## a free lot for `type` near the Town Center, on screen, away from `avoid`
func _lot(type: String, avoid: Array) -> Dictionary:
	var tc: Dictionary = _buildings("town_center")[0]
	var d: Dictionary = sim.get_building_def(type)
	var w := int(d.w)
	var h := int(d.h)
	var c := Vector2(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5)
	for r in range(6, 18):
		for k in 24:
			var a := TAU * k / 24.0
			var t := Vector2i(int(round(c.x + cos(a) * r - w * 0.5)), int(round(c.y + sin(a) * r - h * 0.5)))
			if not sim.can_place(type, t.x, t.y) or not sim.is_explored(t.x + 0.5, t.y + 0.5):
				continue
			var far := true
			for o in avoid:
				if absi(t.x - o.x) < 7 and absi(t.y - o.y) < 7:
					far = false
			if not far:
				continue
			var sp := _screen(t.x + w * 0.5, t.y + h * 0.5)
			if _on_screen(sp) and sim.units_near(t.x + w * 0.5, t.y + h * 0.5, maxf(w, h)).is_empty():
				return {"tile": t, "screen": sp}
	return {}

## the Laborers (group 1), the build command by `how` ("key" / "click"), a click on a lot
func _place(type: String, how: String, avoid: Array) -> int:
	await _key(KEY_1)
	await _frames(3)
	var before := _buildings(type).size()
	var bc := _build_cmd(type)
	if bc.is_empty():
		_check("%s button in the Laborers' grid" % type, false)
		return 0
	if how == "key":
		await _key(OS.find_keycode_from_string(str(bc.key)))
	else:
		await _click(_cmd_where(func(c): return str(c.get("action", "")) == "build" and str(c.get("arg", "")) == type))
	await _frames(3)
	var placing: bool = ui._mode.get("kind", "") == "place" and str(ui._mode.get("type", "")) == type
	var lot := _lot(type, avoid)
	if lot.is_empty() or not placing:
		_check("place %s (%s)" % [type, how], false, "placing %s, lot %s, msg '%s'" % [placing, lot, ui.msg_text])
		return 0
	await _move(lot.screen)
	await _frames(3)
	await _click(lot.screen)
	await _frames(4)
	var id := 0
	for b in _buildings(type):
		if Vector2i(b.tx, b.tz) == lot.tile:
			id = b.id
	_check("place %s (%s %s + a ground click)" % [type, how, str(bc.key)], _buildings(type).size() == before + 1 and id > 0, "lot %s, id %d" % [lot.tile, id])
	avoid.append(lot.tile)
	return id

## a real left click on a building, on a footprint spot no unit covers (retried)
func _select_building(id: int) -> bool:
	for attempt in 8:
		if ui.selected.size() == 1 and int(ui.selected[0]) == id:
			return true
		var b: Dictionary = sim.get_building(id)
		if b.is_empty():
			return false
		await _look(float(b.x), float(b.z) + 2.0)
		var p = _building_point(id)
		if p == null:
			await _frames(4)
			continue
		await _click(p)
		await _frames(4)
	return ui.selected.size() == 1 and int(ui.selected[0]) == id

## a screen point on building `id` that picks it (units win picks), or null
func _building_point(id: int) -> Variant:
	var b: Dictionary = sim.get_building(id)
	var w := float(b.w)
	var h := float(b.h)
	var x0 := float(b.x) - w * 0.5
	var z0 := float(b.z) - h * 0.5
	var n := 6
	for k in n * n:
		var q := Vector2(x0 + (k % n + 0.5) / n * w, z0 + (k / n + 0.5) / n * h)
		var sp := _screen(q.x, q.y, 0.6)
		if _on_screen(sp) and ui.pick_entity(sp) == id:
			return sp
	return null

## a real left click on a unit (it may walk: retried)
func _select_unit(id: int, shift := false) -> bool:
	for attempt in 8:
		if ui.selected.has(id) and (shift or ui.selected.size() == 1):
			return true
		var u: Dictionary = sim.get_unit(id)
		if u.is_empty():
			return false
		var sp := _screen(float(u.x), float(u.z), 0.9)
		if not _on_screen(sp):
			await _look(float(u.x), float(u.z) + 2.0)
			sp = _screen(float(u.x), float(u.z), 0.9)
		if ui.pick_entity(sp) != id:
			sp = _screen(float(u.x), float(u.z), 0.4)
		await _click(sp, MOUSE_BUTTON_LEFT, {"shift": shift})
		await _frames(3)
	return ui.selected.has(id)

# ---- the playthrough ----------------------------------------------------------------------

func _run() -> void:
	# 1. the main menu -> Skirmish -> the setup screen
	var ok := await _await_scene("menu", null, 400)
	_check("plain launch opens the main menu", ok, _scene_name())
	if not ok:
		return _finish()
	await _frames(45)
	var m := _main()
	ok = m.pieces.has("menu") and await _click_control(m.pieces.menu._tiles.get("skirmish"))
	await _frames(6)
	screen = _find_screen(root)
	_check("Skirmish opens the setup screen", ok and screen != null and screen.is_visible_in_tree())
	if screen == null:
		return _finish()
	var s: Dictionary = screen.settings

	# 2. Select Pantheon: your row's god disc, Ra in the Egyptians' row, Confirm
	await _click_zone(0, "god", 0)
	_check("your pantheon disc opens Select Pantheon", screen._modal == "god")
	var has_egypt := _zone_pos(1, "god_pick", "ra") != null and _zone_pos(1, "god_pick", "isis") != null and _zone_pos(1, "god_pick", "set") != null
	_check("the picker offers Ra, Isis and Set", has_egypt)
	await _click_zone(1, "god_pick", "ra")
	_check("a click picks Ra (his card shows)", screen._god_pick == "ra")
	await _shot("pantheon")
	await _click_zone(1, "god_confirm")
	_check("Confirm Ra: you play Ra", screen._modal == "" and str(s.players[0].god) == "ra", str(s.players[0].god))
	_check("starting resources High", await _pick("resources", 0, "high") and str(s.resources) == "high", str(s.resources))

	# 3. Play: the match as an Egyptian
	var old := _main()
	await _click_zone(0, "play")
	ok = await _await_scene("skirmish", old)
	_check("Play starts the match", ok)
	if not ok:
		return _finish()
	_bind()
	var p: Dictionary = sim.get_player(ME)
	_check("the sim has you Egyptian with Ra", str(p.get("civ", "")) == "egyptian" and str(p.get("god", "")).to_lower() == "ra", "%s / %s" % [p.get("civ", ""), p.get("god", "")])
	_check("Egyptian start: Laborers and the Pharaoh, no villager", _units("laborer").size() >= 3 and _units("pharaoh").size() == 1 and _units("villager").is_empty(),
		"%d laborers" % _units("laborer").size())
	sim.set_ai_enabled(false)   # harness
	for i in 2:
		await _button(root.get_visible_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, true)
	await _frames(20)
	var tc: Dictionary = _buildings("town_center")[0]
	await _look(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5 + 2.0)

	# 4. the Laborers: a click, shift-clicks, Ctrl+1
	var labs := _units("laborer")
	var sel_ok := true
	for i in labs.size():
		sel_ok = sel_ok and await _select_unit(labs[i].id, i > 0)
	_check("click + shift-clicks select the Laborers", sel_ok and ui.selected.size() == labs.size(), "%d/%d" % [ui.selected.size(), labs.size()])
	await _key(KEY_1, {"ctrl": true})
	await _frames(6)

	# 5. the Egyptian build grid, its hotkeys, states and a tooltip
	var gc := _build_cmd("granary")
	var hc := _build_cmd("house")
	var bc := _build_cmd("eg_barracks")
	_check("the Laborers' grid is Egyptian: Granary W, House Q, Barracks D, no Storehouse",
		str(gc.get("key", "")) == "W" and str(hc.get("key", "")) == "Q" and str(bc.get("key", "")) == "D" and _build_cmd("storehouse").is_empty(),
		"%s / %s / %s" % [gc.get("key", ""), hc.get("key", ""), bc.get("key", "")])
	_check("the Barracks waits for the Classical Age (greyed, its reason)", not bool(bc.get("enabled", true)) and str(bc.get("state", "")) == "locked"
		and str(bc.get("warn", "")).contains("Classical"), "'%s'" % bc.get("warn", ""))
	var gp = _cmd_where(func(c): return str(c.get("arg", "")) == "granary")
	if gp != null:
		await _move(gp + Vector2(3, 2))
		await _frames(4)
	_check("hovering the Granary shows its tooltip", str(ui.tooltip.get("title", "")) == "Build Granary" and str(ui.tooltip.get("hotkey", "")) == "W"
		and not Array(ui.tooltip.get("lines", [])).is_empty(), str(ui.tooltip.get("title", "")))
	await _shot("build_grid")

	# 6. a Granary (its button + a ground click) and a House (Q + a ground click), built by the Laborers
	var lots := []
	var ids := {}
	for step in [["granary", "click"], ["house", "key"]]:
		var id := await _place(step[0], step[1], lots)
		ids[step[0]] = id
		if id == 0:
			continue
		var t := await _step_until(300.0, func(): var b: Dictionary = sim.get_building(id); return not b.is_empty() and bool(b.built))
		_check("the Laborers build the %s" % step[0], t >= 0.0, "in %.0f s" % t)

	# 7. H: the Town Center; its age-up offers Ra's Classical gods; a click on Bast advances
	await _look(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5 + 2.0)
	await _key(KEY_H)
	await _frames(6)
	var bast := _cmd_find(func(c): return str(c.get("action", "")) == "age_god" and str(c.get("arg", "")) == "bast")
	var ptah := _cmd_find(func(c): return str(c.get("action", "")) == "age_god" and str(c.get("arg", "")) == "ptah")
	_check("the Town Center's age-up: Bast (A) or Ptah (S)", str(bast.get("key", "")) == "A" and str(ptah.get("key", "")) == "S" and bool(bast.get("enabled", false)),
		"%s / %s" % [bast.get("title", ""), ptah.get("title", "")])
	# one button kit (round 6): the gods' busts rendered (egypt_god_models.gd) on
	# the grid's square tiles, distinct; the train buttons are bust portraits
	# (portraits.gd bust()); the card's drop-off row lists food, wood and gold
	var TIk = load("res://game/ui/tech_icons.gd")
	var labc := _cmd_find(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "laborer")
	var busts_ok: bool = TIk.rendered("g_bast") and TIk.rendered("g_ptah") and TIk.BACKDROPS.has("g_bast")
	for g in TIk.GOD_BUSTS:
		busts_ok = busts_ok and TIk.rendered("g_" + str(g))
	_check("the age-up gods are rendered busts, the train buttons bust portraits, the card's drop-off row",
		busts_ok and bool(labc.get("bust", false)) and Array(ui.info.get("dropoff", [])) == ["food", "wood", "gold"],
		"busts %s, laborer bust %s, dropoff %s" % [busts_ok, labc.get("bust", false), ui.info.get("dropoff", [])])
	var lb := _units("laborer").size()
	var tl = _cmd_where(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "laborer")
	if tl != null:
		await _click(tl)
	await _frames(3)
	await _shot("age_pick")
	var bp = _cmd_where(func(c): return str(c.get("action", "")) == "age_god" and str(c.get("arg", "")) == "bast")
	if bp != null:
		await _click(bp)
	await _frames(3)
	_check("a click on Bast starts the advance", bool(sim.get_player(ME).get("advancing", false)), "'%s'" % ui.msg_text)
	var aged := await _step_until(200.0, func(): return int(sim.get_player(ME).age) >= 1)
	var gods: Dictionary = sim.get_gods(ME) if sim.has_method("get_gods") else {}
	_check("the Classical Age with Bast", aged >= 0.0 and str(gods.get("minor", {}).get(1, "")) == "bast", "after %.0f s, %s" % [aged, gods.get("minor", {})])
	_check("the Town Center trained a Laborer (its button)", _units("laborer").size() > lb, "%d -> %d" % [lb, _units("laborer").size()])
	await _frames(12)   # (the HUD refreshes its power buttons 5 times a second)
	var pk: Array = Array(sim.player_powers(ME)) if sim.has_method("player_powers") else []
	_check("Bast's Eclipse joins Rain in the god powers", pk.has("rain") and pk.has("eclipse") and ui.powers.size() == pk.size(), str(pk))

	# 8. a Barracks (D + a ground click), a click on it, Q trains a Spearman
	var bar := await _place("eg_barracks", "key", lots)
	if bar > 0:
		var t := await _step_until(400.0, func(): var b: Dictionary = sim.get_building(bar); return not b.is_empty() and bool(b.built))
		_check("the Laborers build the Barracks", t >= 0.0, "in %.0f s" % t)
		var picked := await _select_building(bar)
		await _frames(6)
		var sc := _cmd_find(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "spearman")
		_check("the Barracks' grid: Spearman (Q), Axeman, Slinger", picked and str(sc.get("key", "")) == "Q"
			and not _cmd_find(func(c): return str(c.get("arg", "")) == "axeman").is_empty() and not _cmd_find(func(c): return str(c.get("arg", "")) == "slinger").is_empty(),
			"selected %s, Q = %s" % [picked, sc.get("title", "")])
		var spw = _cmd_where(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "spearman")
		if spw != null:
			await _move(spw + Vector2(3, 2))
			await _frames(4)
		var spl := str(ui.tooltip.get("lines", []))
		var spd: Dictionary = sim.get_unit_def("spearman")
		_check("hovering the Spearman: his stats in the tooltip (hp, hack attack, speed, armor, pop) and Retold's (speed 5.0, armor 40 / 10, 2 pop)", str(ui.tooltip.get("title", "")) == "Train Spearman"
			and spl.contains("%d hp" % int(round(float(spd.hp)))) and spl.contains("hack attack") and spl.contains("speed") and spl.contains("Armor")
			and spl.contains("Retold: speed 5.0") and spl.contains("armor 40 % / 10 %") and spl.contains("2 pop"),
			"%s %s" % [ui.tooltip.get("title", ""), spl])
		var n0 := _units("spearman").size()
		await _key(KEY_Q)
		await _frames(3)
		var tt := await _step_until(120.0, func(): return _units("spearman").size() > n0)
		_check("Q trains a Spearman", tt >= 0.0, "in %.0f s" % tt)

	# 8b. a Temple: its grid holds the Priest and the myth units of the gods he
	# chose (Bast: the Sphinx), none of another god's (Ptah's Wadjet, Anubis' Anubite,
	# Thoth's Phoenix...); each button's state agrees with sim.train; its key trains it
	await _temple_step(lots)

	# 9. the Pharaoh: a click on him, Empower (Q), a click on the Barracks
	var ph := _units("pharaoh")
	if ph.is_empty() or bar == 0:
		_check("the Pharaoh empowers the Barracks", false, "no Pharaoh / Barracks")
	else:
		var phid: int = ph[0].id
		var b0: Dictionary = sim.get_building(bar)
		await _look(float(b0.x), float(b0.z) + 2.0)
		var psel := await _select_unit(phid)
		await _frames(6)
		var ec := _cmd_find(func(c): return str(c.get("action", "")) == "empower")
		_check("a click selects the Pharaoh: Empower on Q", psel and str(ec.get("key", "")) == "Q", "selected %s" % psel)
		await _shot("pharaoh")
		await _key(KEY_Q)
		await _frames(2)
		_check("Q: the empower cursor", str(ui._mode.get("kind", "")) == "empower")
		var bpt = _building_point(bar)
		if bpt != null:
			await _click(bpt)
		await _frames(3)
		var te := await _step_until(120.0, func():
			for e in sim.get_civ_state(ME).get("empowered", []):
				if int(e.id) == bar and float(e.strength) >= 1.0:
					return true
			return false)
		_check("the Pharaoh empowers the Barracks", te >= 0.0, "in %.0f s, '%s'" % [te, ui.msg_text])

	# 10. a god power: a click on Rain (harness: 60 favor)
	var pr: Dictionary = sim.get_player(ME)
	sim.set_player_resources(ME, {"food": float(pr.food), "wood": float(pr.wood), "gold": float(pr.gold), "favor": 60.0})
	await _frames(12)
	var rp = _hud_zone("power", "rain")
	var f0 := float(sim.get_player(ME).favor)
	if rp != null:
		await _click(rp)
	await _frames(4)
	var f1 := float(sim.get_player(ME).favor)
	var cd := float(sim.power_cooldown(ME, "rain"))
	var eg: Dictionary = sim.get_egypt_powers() if sim.has_method("get_egypt_powers") else {}
	_check("a click on Rain casts it (favor paid, its recharge running)", rp != null and f0 - f1 >= 29.0 and cd > 0.0,
		"favor %.0f -> %.0f, cooldown %.0f s, '%s'" % [f0, f1, cd, ui.msg_text])
	await _shot("rain")
	report_egypt(eg)
	# 11. a second match as Set: his Pharaoh's summon grid
	await _set_match()
	_finish()

## 11. Esc -> Quit to Main Menu -> Skirmish -> Set in Select Pantheon -> Play; a
## click on Set's Pharaoh: the eight Animals of Set each with its own rendered
## icon (a voxel rig, no blank square), stats in the tooltip, every key of the
## grid distinct (A stays Attack-Move); S summons a Baboon, A starts Attack-Move.
func _set_match() -> void:
	var m := _main()
	var gm: Node = m.get("game_menu") if m else null
	if gm == null:
		_check("Set: back to the main menu", false, "no game menu")
		return
	await _key(KEY_ESCAPE)
	await _frames(4)
	var ok_quit := await _click_control(gm.buttons.quit)
	var ok := ok_quit and await _await_scene("menu", m, 600)
	_check("Set: Esc, Quit to Main Menu", ok)
	if not ok:
		return
	await _frames(45)
	ok = _main().pieces.has("menu") and await _click_control(_main().pieces.menu._tiles.get("skirmish"))
	await _frames(6)
	screen = _find_screen(root)
	if not ok or screen == null:
		_check("Set: Skirmish opens the setup screen", false)
		return
	var s: Dictionary = screen.settings
	await _click_zone(0, "god", 0)
	await _click_zone(1, "god_pick", "set")
	await _click_zone(1, "god_confirm")
	_check("Set: a click on Set in Select Pantheon, Confirm", screen._modal == "" and str(s.players[0].god) == "set", str(s.players[0].god))
	var old := _main()
	await _click_zone(0, "play")
	ok = await _await_scene("skirmish", old)
	if not ok:
		_check("Set: Play starts the match", false)
		return
	_bind()
	var p: Dictionary = sim.get_player(ME)
	_check("Set: the sim has you Egyptian with Set", str(p.get("civ", "")) == "egyptian" and str(p.get("god", "")).to_lower() == "set", "%s / %s" % [p.get("civ", ""), p.get("god", "")])
	sim.set_ai_enabled(false)   # harness
	for i in 2:
		await _button(root.get_visible_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, true)
	await _frames(20)
	var ph := _units("pharaoh")
	if ph.is_empty():
		_check("Set: a click selects the Pharaoh", false, "no Pharaoh")
		return
	var phid: int = ph[0].id
	await _look(float(ph[0].x), float(ph[0].z) + 2.0)
	var psel := await _select_unit(phid)
	await _frames(8)
	_check("Set: a click selects the Pharaoh", psel)
	var sums := []
	for c in ui.commands:
		if c != null and str(c.get("action", "")) == "summon":
			sums.append(c)
	var types := sums.map(func(c): return str(c.arg[1]))
	_check("Set: his grid has the eight Animals of Set", types == ["baboon_of_set", "gazelle_of_set", "hyena_of_set", "giraffe_of_set",
		"crocodile_of_set", "hippo_of_set", "rhino_of_set", "elephant_of_set"], str(types))
	# every summon icon: a rig, a rendered picture (not a blank square), all different
	await _frames(4)
	var bad := []
	var seen := {}
	for c in sums:
		var t := str(c.arg[1])
		var img: Image = (c.tex as Texture2D).get_image() if c.get("tex") != null else null
		var fl := _bust_fill(img)
		var hsh: int = hash(img.get_data()) if img != null else 0
		var fills: bool = fl.ok
		if VoxelModels.rig(t).is_empty() or img == null or not fills or seen.has(hsh):
			bad.append("%s (%s)" % [t, fl.desc])
		seen[hsh] = t
	_check("Set: each summon has its own rendered icon (8 distinct voxel busts, each filling its tile)", bad.is_empty() and sums.size() == 8, str(bad))
	# every Egyptian unit's and myth unit's button bust (portraits.gd bust()) fills its tile
	var names: PackedStringArray = sim.unit_type_names()
	var eg_types := []
	for i in range(maxi(names.find("laborer"), 0), names.size()):
		eg_types.append(names[i])
	var texs := eg_types.map(func(t): return ui._portraits.bust(t, 1))
	await _frames(12)
	var loose := []
	for i in eg_types.size():
		var bt: Texture2D = texs[i]
		var fb := _bust_fill(bt.get_image() if bt != null else null)
		if not fb.ok:
			loose.append("%s (%s)" % [eg_types[i], fb.desc])
	_check("every Egyptian unit's button bust fills its tile (%d busts)" % eg_types.size(), loose.is_empty() and eg_types.size() >= 30, str(loose))
	# no two busts alike (not only not identical): their colour mix x their silhouette
	# (_bust_alike) stays under 0.62; round 7's Mercenary / Mercenary Cavalry (two
	# dark heads with the same blue headband and gold collar) scored 0.68, the
	# Laborer / Slinger 0.72, the Rhino / Elephant of Set 0.69
	var sigs := []
	for i in eg_types.size():
		var bt: Texture2D = texs[i]
		sigs.append(_bust_sig(bt.get_image() if bt != null else null))
	var alike := []
	var worst := [0.0, "", ""]
	for i in eg_types.size():
		for j in range(i + 1, eg_types.size()):
			var a := _bust_alike(sigs[i], sigs[j])
			if a > float(worst[0]):
				worst = [a, eg_types[i], eg_types[j]]
			if a >= 0.62:
				alike.append("%s / %s %.2f" % [eg_types[i], eg_types[j], a])
	_check("no two Egyptian busts alike (colours x silhouette < 0.62; closest %s / %s %.2f)" % [worst[1], worst[2], worst[0]], alike.is_empty(), str(alike))
	var keys_seen := {}
	var dup := []
	for c in ui.commands:
		if c == null:
			continue
		if keys_seen.has(c.key):
			dup.append("%s: %s / %s" % [c.key, keys_seen[c.key], c.title])
		keys_seen[c.key] = c.title
	var am := _cmd_find(func(c): return str(c.get("action", "")) == "attack_move")
	_check("Set: every key of the grid is its own (A is Attack-Move, no summon on A)", dup.is_empty() and str(am.get("key", "")) == "A"
		and sums.all(func(c): return str(c.key) != "A"), "%s, keys %s" % [str(dup), str(sums.map(func(c): return c.key))])
	var hp = _cmd_where(func(c): return str(c.get("action", "")) == "summon" and str(c.arg[1]) == "hyena_of_set")
	if hp != null:
		await _move(hp + Vector2(3, 2))
		await _frames(4)
	var tl := " ".join(PackedStringArray(Array(ui.tooltip.get("lines", [])).map(func(l): return str(l))))
	_check("Set: hovering the Hyena: its stats and its age (Classical, greyed)", str(ui.tooltip.get("title", "")) == "Summon Hyena of Set"
		and tl.contains("45 hp") and tl.contains("pop") and tl.contains("food"), "'%s' %s" % [ui.tooltip.get("title", ""), tl])
	await _shot("set_pharaoh")
	# S: a Baboon of Set (harness: 10 favor; a Set player starts with none)
	var pr: Dictionary = sim.get_player(ME)
	sim.set_player_resources(ME, {"food": float(pr.food), "wood": float(pr.wood), "gold": float(pr.gold), "favor": 10.0})
	await _frames(6)
	var b0 := _units("baboon_of_set").size()
	var bk := str(sums[0].key) if not sums.is_empty() else "S"
	await _key(OS.find_keycode_from_string(bk))
	var tb := await _step_until(30.0, func(): return _units("baboon_of_set").size() > b0)
	_check("Set: %s summons a Baboon of Set beside the Pharaoh" % bk, tb >= 0.0, "%d -> %d, '%s'" % [b0, _units("baboon_of_set").size(), ui.msg_text])
	await _key(KEY_A)
	await _frames(2)
	_check("Set: A starts Attack-Move", str(ui._mode.get("kind", "")) == "attack_move", str(ui._mode))
	await _key(KEY_ESCAPE)

## The Temple (8b): placed with its key, built, clicked; its train buttons
## read against the sim's own gates.
func _temple_step(lots: Array) -> void:
	# harness: the Temple's and the Sphinx's price (the Barracks and Spearman spent the purse)
	var pr: Dictionary = sim.get_player(ME)
	sim.set_player_resources(ME, {"food": float(pr.food) + 300.0, "wood": float(pr.wood) + 600.0, "gold": float(pr.gold) + 600.0, "favor": 60.0})
	var tcmd := _build_cmd("temple")
	await _key(KEY_1)
	await _frames(6)
	tcmd = _build_cmd("temple")
	_check("the Temple on S in the Laborers' grid, enabled", str(tcmd.get("key", "")) == "S" and bool(tcmd.get("enabled", false)), "%s '%s'" % [tcmd.get("key", ""), tcmd.get("warn", "")])
	var tid := await _place("temple", "key", lots)
	if tid == 0:
		return
	var t := await _step_until(500.0, func(): var b: Dictionary = sim.get_building(tid); return not b.is_empty() and bool(b.built))
	_check("the Laborers build the Temple", t >= 0.0, "in %.0f s" % t)
	var picked := await _select_building(tid)
	await _frames(6)
	var shown := []
	for c in ui.commands:
		if c != null and str(c.get("action", "")) == "train":
			shown.append(str(c.arg))
	var myth := []
	for tr in sim.get_trains(tid):
		if str(tr.get("god", "")) != "":
			myth.append(str(tr.type))
	var others := []
	for m in myth:
		if m != "sphinx" and shown.has(m):
			others.append(m)
	_check("the Temple's grid: the Priest and Bast's Sphinx, no other god's myth unit", picked and shown.has("priest") and shown.has("sphinx") and others.is_empty() and myth.size() >= 10,
		"shown %s, of %d myth units" % [shown, myth.size()])
	# every button's state is the sim's: a held-back unit would be refused by sim.train
	var agree := true
	var bad := ""
	for tr in sim.get_trains(tid):
		if str(tr.get("god", "")) != "" and str(tr.type) != "sphinx":
			if bool(tr.ok):
				agree = false
				bad += "%s ok; " % tr.type
			elif not (str(tr.reason).begins_with("Requires the minor god") or str(tr.reason).begins_with("Requires ")):
				agree = false
				bad += "%s '%s'; " % [tr.type, tr.reason]
	_check("get_trains holds back every myth unit of a god not chosen (its reason)", agree, bad)
	var sc := _cmd_find(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "sphinx")
	var sp = _cmd_where(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "sphinx")
	if sp != null:
		await _move(sp + Vector2(3, 2))
		await _frames(4)
	var sphl := str(ui.tooltip.get("lines", []))
	_check("hovering the Sphinx: its tooltip names Bast, its stats (300 hp, attack, armor, pop) and Whirlwind", str(ui.tooltip.get("title", "")) == "Train Sphinx"
		and sphl.contains("Bast") and sphl.contains("300 hp") and sphl.contains("attack") and sphl.contains("Armor") and sphl.contains("pop")
		and sphl.contains("Whirlwind"), "%s %s" % [ui.tooltip.get("title", ""), ui.tooltip.get("lines", [])])
	# the Temple's tech buttons: each Egyptian tech its own rendered 3D icon
	# (egypt_tech_models.gd), not the generic scroll; and every one of the 36
	var TI = load("res://game/ui/tech_icons.gd")
	var tsv := []
	for c in ui.commands:
		if c != null and str(c.get("action", "")) == "research":
			tsv.append(str(c.svg))
	var tok := tsv.size() >= 2
	for nm in tsv:
		tok = tok and str(nm).begins_with("e_") and TI.rendered(str(nm)) and tsv.count(nm) == 1
	_check("the Temple's techs: each its own rendered icon (no scroll)", tok, str(tsv))
	var all_icons := {}
	var unrendered := []
	for k in TI.EGYPT_GOD:
		var nm2: String = TI.icon_for(str(k))
		all_icons[nm2] = true
		if not TI.rendered(nm2) or not TI.BACKDROPS.has(nm2):
			unrendered.append(nm2)
	_check("all 36 Egyptian techs: 36 distinct rendered icons with their own backdrops", all_icons.size() == 36 and unrendered.is_empty(), str(unrendered))
	await _shot("temple")
	# harness: the favor a Sphinx costs (an Egyptian's favor comes from Monuments)
	pr = sim.get_player(ME)
	sim.set_player_resources(ME, {"food": float(pr.food), "wood": float(pr.wood), "gold": maxf(float(pr.gold), 300.0), "favor": 60.0})
	await _frames(12)
	sc = _cmd_find(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "sphinx")
	var n0 := _units("sphinx").size()
	if not sc.is_empty():
		await _key(OS.find_keycode_from_string(str(sc.key)))
	await _frames(3)
	var tt := await _step_until(120.0, func(): return _units("sphinx").size() > n0)
	_check("the Sphinx's key trains a Sphinx", bool(sc.get("enabled", false)) and tt >= 0.0, "key %s, in %.0f s, '%s'" % [sc.get("key", ""), tt, ui.msg_text])

func report_egypt(eg: Dictionary) -> void:
	result["egypt_powers"] = str(eg.keys()) if not eg.is_empty() else ""

## Click a Control, after checking it is the one the GUI finds there.
func _click_control(c: Control) -> bool:
	if c == null or not c.is_visible_in_tree():
		return false
	var p := c.get_global_transform_with_canvas() * (c.size * 0.5)
	await _click(p)
	return true

func _finish() -> void:
	print("EGYPTPLAY clicks %d, keys %d" % [clicks, keys])
	print("EGYPTPLAY_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails, "steps": result}))
	quit(fails.size())

## A bust's signature for _bust_alike: the share of its opaque pixels in each
## colour bin (6 levels a channel) and its 16 x 16 coverage (alpha) grid.
func _bust_sig(img: Image) -> Dictionary:
	var hist := {}
	var tot := 0
	var sil := PackedFloat32Array()
	sil.resize(256)
	if img == null:
		return {"hist": hist, "sil": sil}
	var w := img.get_width()
	var h := img.get_height()
	var cnt := PackedFloat32Array()
	cnt.resize(256)
	for y in range(0, h, 2):
		for x in range(0, w, 2):
			var c := img.get_pixel(x, y)
			var cell := (y * 16 / h) * 16 + (x * 16 / w)
			cnt[cell] += 1.0
			if c.a < 0.5:
				continue
			sil[cell] += 1.0
			var k := (c.r8 / 43) * 36 + (c.g8 / 43) * 6 + (c.b8 / 43)
			hist[k] = int(hist.get(k, 0)) + 1
			tot += 1
	for i in 256:
		sil[i] = sil[i] / maxf(1.0, cnt[i])
	for k in hist:
		hist[k] = float(hist[k]) / maxf(1.0, tot)
	return {"hist": hist, "sil": sil}

## How alike two busts look (0..1): their colour histograms' overlap times their
## silhouettes' overlap (1 - mean coverage difference).
func _bust_alike(a: Dictionary, b: Dictionary) -> float:
	var hi := 0.0
	for k in a.hist:
		hi += minf(float(a.hist[k]), float(b.hist.get(k, 0.0)))
	var d := 0.0
	for i in 256:
		d += absf(a.sil[i] - b.sil[i])
	return hi * (1.0 - d / 256.0)

## (ui round 7) a button bust fills its tile: >= 30 % of the samples (every 4th
## pixel) opaque and the opaque pixels spanning >= 80 % of its width and of its
## height, so a full-body model shrunk to a sliver (round 6's crocodile: 11 %,
## a thin streak) fails.
func _bust_fill(img: Image) -> Dictionary:
	if img == null:
		return {"ok": false, "desc": "no image"}
	var cover := 0
	var n := 0
	var bx0 := 9999
	var bx1 := -1
	var by0 := 9999
	var by1 := -1
	for y in range(0, img.get_height(), 4):
		for x in range(0, img.get_width(), 4):
			n += 1
			if img.get_pixel(x, y).a > 0.5:
				cover += 1
				bx0 = mini(bx0, x)
				bx1 = maxi(bx1, x)
				by0 = mini(by0, y)
				by1 = maxi(by1, y)
	var ok := cover >= n * 0.3 and (bx1 - bx0 + 4) >= img.get_width() * 0.8 and (by1 - by0 + 4) >= img.get_height() * 0.8
	return {"ok": ok, "desc": "cover %d/%d, span %dx%d" % [cover, n, bx1 - bx0 + 4, by1 - by0 + 4]}
