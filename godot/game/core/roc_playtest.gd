extends SceneTree
## The Roc played through real input only (gods piece; EGYPT.md 5.2: Sobek's flying transport
## for 20, it lands 2 s to load or unload; PORTING.md "The Roc in play"). Every player action
## is an InputEvent fed to Input.parse_input_event: clicks on the Temple, on HUD buttons (their
## hit zones' centres), drags over units, right-clicks on the Roc and on the ground, keys;
## what happened is read back from the sim.
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/core/roc_playtest.gd -- --scene=egypt [--shots=/abs/dir]
##
## The "egypt" scene: player 1 Ra in the Mythic Age (given Bast / Sobek / Horus, the gods
## Techs::auto_minor gives him), his Temple. Steps: a click on the Temple shows Train Roc (Sobek's myth unit),
## a click on it trains one (paid 100 gold + 5 favor); spearmen dragged into a selection and a
## right-click on the Roc board it (Commands::smart): they walk to it, it lands and takes them
## in (gone from the world, its card "Carrying n / 20"); a click on the Roc shows Unload (R) /
## Unload Here (T) enabled and Board (E) greyed; R + a ground click far off flies it there, it
## lands and sets them down round it; then the Roc clicked and the two spearmen left
## shift-clicked to it, E (Board) takes them in, T (Unload Here) sets them down where it stands.
## Harness shortcuts (not player input): the enemy AI is off, the sim is stepped fast while
## frames render between, the gold / favor for the Roc is granted, the eight spearmen are
## spawned on open ground by the Temple (the Barracks' training is egypt_playtest's).
##
## Prints "ROCPLAY ok|FAIL <step>" and "ROCPLAY_RESULT {json}"; exit = failures (99 on a
## timeout). Needs a rendering display (hit zones are registered while the HUD draws).

const ME := 1

var fails: Array = []
var passes := 0
var shots := ""
var result := {}
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
		printerr("ROCPLAY timeout")
		print("ROCPLAY_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails + ["timeout"], "steps": result}))
		quit(99))
	root.add_child.call_deferred(dog)
	var a := AovArgs.parse()
	shots = str(a.get("shots", ""))
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

# ---- plumbing (as egypt_playtest.gd) -----------------------------------------------------

func _check(name: String, ok: bool, detail := "") -> void:
	result[name] = ok
	if ok:
		passes += 1
		print("ROCPLAY ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("ROCPLAY FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _shot(name: String) -> void:
	if shots == "":
		return
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(shots)
	root.get_texture().get_image().save_png(shots.path_join("roc_play_%s.png" % name))

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
	Input.parse_input_event(e)
	await _frames(1)

func _click(p: Vector2, button := MOUSE_BUTTON_LEFT, mods := {}) -> void:
	await _move(p)
	await _button(p, button, true, mods)
	await _button(p, button, false, mods)
	await _frames(2)

func _drag(a: Vector2, b: Vector2) -> void:
	await _move(a)
	await _button(a, MOUSE_BUTTON_LEFT, true)
	for k in 6:
		await _move(a.lerp(b, (k + 1) / 6.0), MOUSE_BUTTON_MASK_LEFT)
	await _button(b, MOUSE_BUTTON_LEFT, false)
	await _frames(3)

func _key(k: Key) -> void:
	var e := InputEventKey.new()
	e.keycode = k
	e.physical_keycode = k
	e.pressed = true
	Input.parse_input_event(e)
	await _frames(1)
	var r := e.duplicate() as InputEventKey
	r.pressed = false
	Input.parse_input_event(r)
	await _frames(2)

func _main() -> Node:
	var m := current_scene
	return m if m != null and "scene_def" in m else null

func _screen(x: float, z: float, lift := 0.0) -> Vector2:
	cam.apply()
	return cam.unproject_position(Vector3(x, sim.height_at(x, z) + lift, z))

func _units(type_name: String) -> Array:
	var u: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in int(u.count):
		if int(u.owner[i]) == ME and not (u.flags[i] & 2) and names[u.type[i]] == type_name:
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

func _cmd(action: String) -> Dictionary:
	for c in ui.commands:
		if c != null and str(c.get("action", "")) == action:
			return c
	return {}

func _step_until(seconds: float, done: Callable) -> float:
	var t := 0.0
	while t < seconds:
		if done.call():
			return t
		sim.tick(15)
		t += 0.5
		await _frames(1)
	return t if done.call() else -1.0

func _look(x: float, z: float) -> void:
	cam.target.x = x
	cam.target.z = z
	await _frames(8)

## a click on the Roc's bird (it hovers ~3 m up), else its feet
func _roc_point(roc: int) -> Vector2:
	var r: Dictionary = sim.get_unit(roc)
	for lift in [3.4, 3.0, 2.4, 1.0]:
		var p := _screen(float(r.x), float(r.z), lift)
		if ui.pick_entity(p) == roc:
			return p
	return _screen(float(r.x), float(r.z), 3.0)

func _near_count(ids: Array, p: Vector2, rad: float) -> int:
	var n := 0
	for s in _units("spearman"):
		if (ids.is_empty() or int(s.id) in ids) and Vector2(s.x, s.z).distance_to(p) < rad:
			n += 1
	return n

# ---- the run -----------------------------------------------------------------------------

func _run() -> void:
	for i in 1200:
		await process_frame
		var m := _main()
		if m != null and not bool(m.building) and m.sim != null and m.pieces.has("ui"):
			break
	main = _main()
	if main == null:
		_check("scene", false)
		_finish()
		return
	ui = main.pieces.get("ui")
	sim = main.sim
	cam = main.camera
	sim.set_ai_enabled(false)
	main.time_scale = 0.0   # (the harness steps the sim)
	await _frames(10)
	# (harness: the scene's Ra has no minor god set; Bast, Sobek, Horus, as Techs::auto_minor gives)
	for a in 3:
		sim.set_minor_god(ME, a + 1, ["bast", "sobek", "horus"][a])
	var gods: Dictionary = sim.get_gods(ME) if sim.has_method("get_gods") else {}
	result["gods"] = str(gods.get("minor", ""))
	var temples := _buildings("temple")
	_check("temple", not temples.is_empty(), str(temples))
	if temples.is_empty():
		_finish()
		return
	var T: Dictionary = temples[0]
	var tcx: float = T.tx + T.w * 0.5
	var tcz: float = T.tz + T.h * 0.5
	sim.set_player_resources(ME, {"gold": 2000, "favor": 100, "food": 2000, "wood": 2000})
	await _look(tcx, tcz)
	# 1. the Temple: Train Roc, clicked
	var tp := _screen(tcx, tcz, 1.5)
	await _click(tp)
	await _frames(6)
	var roc_cmd = _cmd_where(func(c): return str(c.get("action", "")) == "train" and str(c.get("arg", "")) == "roc")
	_check("temple shows Train Roc", ui.selected.has(int(T.id)) and roc_cmd != null, "selected %s" % str(ui.selected))
	if roc_cmd == null:
		_finish()
		return
	var g0 := float(sim.get_player(ME).gold)
	var f0 := float(sim.get_player(ME).favor)
	await _click(roc_cmd)
	await _frames(4)
	var paid := [g0 - float(sim.get_player(ME).gold), f0 - float(sim.get_player(ME).favor)]
	_check("Train Roc paid 100 gold + 5 favor", absf(paid[0] - 100) < 0.01 and absf(paid[1] - 5) < 0.01, str(paid))
	var t := await _step_until(60.0, func(): return not _units("roc").is_empty())
	_check("a Roc trained at the Temple", t >= 0, "%.1f s" % t)
	if t < 0:
		_finish()
		return
	var roc := int(_units("roc")[0].id)
	# open ground by the Temple: the Roc there, the spearmen beside it (harness)
	var R: Dictionary = sim.get_unit(roc)
	var spot := Vector2(float(R.x), float(R.z))
	var men := []
	for i in 8:
		men.append(int(sim.spawn_unit("spearman", ME, spot.x + 6.0 + (i % 4) * 0.9, spot.y + 5.0 + int(i / 4) * 0.9, 0.0)))
	sim.tick(2)
	await _look(spot.x + 3.0, spot.y + 3.0)
	# 2. six spearmen dragged into a selection, a right-click on the Roc: they board
	var six: Array = men.slice(0, 6)
	var b0 := Vector2(INF, INF)
	var b1 := Vector2(-INF, -INF)
	for id in six:
		var u: Dictionary = sim.get_unit(id)
		var p := _screen(float(u.x), float(u.z), 0.8)
		b0 = b0.min(p)
		b1 = b1.max(p)
	# (the last two, the row behind: the box takes the front row of four and two of the back)
	await _drag(b0 - Vector2(14, 14), b1 + Vector2(14, 14))
	var sel: Array = ui.selected.duplicate()
	var sel_men := sel.filter(func(id): return id in men)
	_check("drag-select spearmen", sel_men.size() >= 4 and not sel.has(roc), "%d selected" % sel.size())
	var boarders := sel_men.duplicate()
	await _click(_roc_point(roc), MOUSE_BUTTON_RIGHT)
	await _frames(3)
	var st: Dictionary = sim.get_roc(roc)
	_check("right-click on the Roc boards them", (st.boarding as Array).size() == boarders.size() and str(ui.msg_text).contains("Roc"),
		"boarding %d of %d, msg '%s'" % [(st.boarding as Array).size(), boarders.size(), ui.msg_text])
	await _shot("1_boarding")
	t = await _step_until(20.0, func(): return (sim.get_roc(roc).cargo as Array).size() == boarders.size())
	var gone := 0
	for id in boarders:
		gone += 0 if sim.get_unit(id).size() > 0 and not bool(sim.get_unit(id).get("dead", false)) else 1
	_check("they are in the Roc (out of the world)", t >= 0 and gone == boarders.size(), "%.1f s, %d gone" % [t, gone])
	# 3. the Roc selected: its card and its buttons
	await _step_until(3.0, func(): return false)
	await _click(_roc_point(roc))
	await _frames(6)
	var unl := _cmd("roc_unload")
	var brd := _cmd("roc_board")
	var here := _cmd("roc_unload_here")
	_check("the Roc's buttons: Unload (R) / Unload Here (T) on, Board (E) greyed",
		ui.selected == [roc] and not unl.is_empty() and bool(unl.enabled) and str(unl.key) == "R" and not here.is_empty() and bool(here.enabled)
		and not brd.is_empty() and not bool(brd.enabled), "selected %s" % str(ui.selected))
	var card: Dictionary = ui._info_for()
	_check("the Roc's card: Carrying %d / 20" % boarders.size(), str(card.get("tasks", [])).contains("Carrying %d / 20" % boarders.size()), str(card.get("tasks", [])))
	await _move(_cmd_where(func(c): return str(c.get("action", "")) == "roc_unload"))
	await _frames(6)
	await _shot("2_loaded_unload_tip")
	# 4. R + a ground click 14 tiles off: it flies there, lands, sets them down
	var dest := spot + Vector2(-12.0, 6.0)
	var dp := _screen(dest.x, dest.y)
	if not root.get_visible_rect().grow(-60).has_point(dp):
		await _look(spot.x - 6.0, spot.y + 3.0)
		dp = _screen(dest.x, dest.y)
	await _key(KEY_R)
	_check("R: Unload targeting", str(ui._mode.get("kind", "")) == "roc_unload", str(ui._mode))
	await _move(dp)
	await _frames(4)
	await _click(dp)
	await _frames(2)
	await _shot("3_flying")
	t = await _step_until(30.0, func(): return (sim.get_roc(roc).cargo as Array).is_empty())
	R = sim.get_unit(roc)
	var landed := Vector2(float(R.x), float(R.z))
	var down := _near_count([], landed, 5.0)
	_check("the Roc lands by the click and sets them down", t >= 0 and landed.distance_to(dest) < 4.0 and down >= boarders.size(),
		"%.1f s, landed %.1f tiles off, %d spearmen round it" % [t, landed.distance_to(dest), down])
	await _look(landed.x, landed.y)
	await _shot("4_unloaded")
	# 5. the Roc + the two spearmen left, dragged together: E boards them, T sets them down there
	var rest: Array = men.filter(func(id): return not (id in boarders) and sim.get_unit(id).size() > 0)
	await _step_until(3.0, func(): return false)
	for id in rest:
		sim.order_move(PackedInt32Array([id]), landed.x + 4.0, landed.y + 2.0)   # (harness: walked over)
	await _step_until(12.0, func(): return false)
	await _look(landed.x + 2.0, landed.y + 1.0)
	var pr := _roc_point(roc)
	await _click(pr)
	for id in rest:
		var u: Dictionary = sim.get_unit(id)
		await _click(_screen(float(u.x), float(u.z), 1.0), MOUSE_BUTTON_LEFT, {"shift": true})
	await _frames(4)
	var sel2: Array = ui.selected.duplicate()
	brd = _cmd("roc_board")
	_check("Roc + spearmen selected: Board (E) on", sel2.has(roc) and sel2.size() >= 2 and not brd.is_empty() and bool(brd.enabled), "selected %s" % str(sel2))
	var n2 := sel2.filter(func(id): return id in rest).size()
	await _key(KEY_E)
	t = await _step_until(20.0, func(): return (sim.get_roc(roc).cargo as Array).size() == n2)
	_check("E: they board", n2 > 0 and t >= 0, "%d in, %.1f s" % [n2, t])
	await _key(KEY_T)
	t = await _step_until(10.0, func(): return (sim.get_roc(roc).cargo as Array).is_empty())
	_check("T: Unload Here", t >= 0, "%.1f s" % t)
	_finish()

func _finish() -> void:
	print("ROCPLAY_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails, "steps": result}))
	quit(fails.size())
