extends SceneTree
## Scripted playthrough of the skirmish through the real input path: every
## step is an InputEvent fed to Input.parse_input_event (mouse at screen
## positions projected from the sim state, keys), exactly what a player's
## mouse and keyboard produce, then the sim / UI state is checked.
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/core/playtest.gd -- --scene=skirmish
##
## Prints "PLAYTEST ok|FAIL <step>" per step and "PLAYTEST_RESULT {json}";
## exits with the number of failed steps (99 on a timeout). Needs a rendering
## display: the HUD hit zones are registered while it draws.

var main: Node
var ui: Node
var sim: Object
var cam: Camera3D
var fails: Array = []
var passes := 0

func _initialize() -> void:
	var dog := Timer.new()
	dog.wait_time = 900
	dog.one_shot = true
	dog.timeout.connect(func() -> void:
		printerr("PLAYTEST timeout")
		quit(99))
	root.add_child.call_deferred(dog)
	dog.autostart = true
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

func _check(name: String, ok: bool, detail := "") -> void:
	if ok:
		passes += 1
		print("PLAYTEST ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("PLAYTEST FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _bind() -> void:
	main = current_scene
	ui = main.pieces.get("ui")
	sim = main.sim
	cam = main.camera

# ---- input ---------------------------------------------------------------------

func _mods(ev: InputEventWithModifiers, mods: Dictionary) -> void:
	ev.shift_pressed = mods.get("shift", false)
	ev.ctrl_pressed = mods.get("ctrl", false)
	ev.alt_pressed = mods.get("alt", false)

func _move(p: Vector2, mods := {}, mask := 0) -> void:
	var e := InputEventMouseMotion.new()
	var last: Vector2 = root.get_mouse_position()
	e.position = p
	e.global_position = p
	e.relative = p - last
	e.button_mask = mask
	_mods(e, mods)
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
	_mods(e, mods)
	Input.parse_input_event(e)
	await _frames(1)

func _click(p: Vector2, button := MOUSE_BUTTON_LEFT, mods := {}) -> void:
	await _move(p, mods)
	await _button(p, button, true, mods)
	await _button(p, button, false, mods)

func _drag(a: Vector2, b: Vector2, button := MOUSE_BUTTON_LEFT, mods := {}) -> void:
	await _move(a, mods)
	await _button(a, button, true, mods)
	for i in range(1, 7):
		await _move(a.lerp(b, i / 6.0), mods, 1 << (button - 1))
	await _button(b, button, false, mods)

func _key(k: Key, mods := {}) -> void:
	var e := InputEventKey.new()
	e.keycode = k
	e.physical_keycode = k
	e.pressed = true
	_mods(e, mods)
	Input.parse_input_event(e)
	await _frames(1)
	var r := e.duplicate() as InputEventKey
	r.pressed = false
	Input.parse_input_event(r)
	await _frames(1)

# ---- world helpers -------------------------------------------------------------------

func _screen(x: float, z: float, lift := 0.6) -> Vector2:
	cam.apply()
	return cam.unproject_position(Vector3(x, sim.height_at(x, z) + lift, z))

func _own_units(type_name := "") -> Array:
	var u: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in int(u.count):
		if int(u.owner[i]) == 1 and not (u.flags[i] & 2) and (type_name == "" or names[u.type[i]] == type_name):
			out.append({"id": u.ids[i], "x": u.pos[i * 2], "z": u.pos[i * 2 + 1], "order": u.order[i], "target": u.target[i]})
	return out

func _buildings(owner: int, type_name := "") -> Array:
	var b: Dictionary = sim.get_buildings()
	var out := []
	for i in int(b.count):
		if int(b.owner[i]) == owner and (type_name == "" or b.type_names[b.type[i]] == type_name):
			out.append({"id": b.ids[i], "tx": b.rect[i * 4], "tz": b.rect[i * 4 + 1], "w": b.rect[i * 4 + 2], "h": b.rect[i * 4 + 3], "built": b.built[i]})
	return out

func _on_screen(p: Vector2) -> bool:
	var r := root.get_visible_rect().grow(-40)
	# keep clear of the bottom HUD band and the top bar
	return r.has_point(p) and p.y > r.size.y * 0.12 and p.y < r.size.y * 0.78

func _zone_center(id: String) -> Variant:
	for layer in [ui._front, ui._back]:
		for z in layer.zones:
			if z.id == id:
				return layer.get_global_transform_with_canvas() * z.rect.get_center()
	return null

# ---- the playthrough -----------------------------------------------------------------

func _run() -> void:
	await _frames(12)
	_bind()
	if ui == null:
		_check("ui piece present", false)
		_finish()
		return
	_check("scene loaded", sim != null and cam != null, "tick %d" % sim.get_tick())
	var fv = cam.get("fog_view")
	_check("fog of war pass active", fv != null and fv.visible)

	# box select the five villagers
	var vills := _own_units("villager")
	var lo := Vector2(1e9, 1e9)
	var hi := Vector2(-1e9, -1e9)
	for v in vills:
		var p := _screen(v.x, v.z, 0.8)
		lo = lo.min(p)
		hi = hi.max(p)
	await _drag(lo - Vector2(30, 30), hi + Vector2(30, 30))
	await _frames(2)
	_check("box select villagers", ui.selected.size() == vills.size() and vills.size() >= 5, "%d/%d" % [ui.selected.size(), vills.size()])

	# right-click the nearest berry bush / tree: gather
	var tc: Dictionary = _buildings(1, "town_center")[0]
	var res: Dictionary = sim.get_resources()
	var best := -1
	var bd := 1e9
	for i in int(res.count):
		var tx: float = res.tile[i * 2] + 0.5
		var tz: float = res.tile[i * 2 + 1] + 0.5
		var rt: String = res.type_names[res.type[i]]
		if (rt != "tree" and rt != "berry" and rt != "gold") or not sim.is_visible(tx, tz):
			continue
		var p := _screen(tx, tz, 1.2)
		var d := Vector2(tx - tc.tx, tz - tc.tz).length()
		if _on_screen(p) and d < bd:
			bd = d
			best = i
	if best >= 0:
		var tx: float = res.tile[best * 2] + 0.5
		var tz: float = res.tile[best * 2 + 1] + 0.5
		await _click(_screen(tx, tz, 1.2), MOUSE_BUTTON_RIGHT)
		await _frames(3)
		var gathering := 0
		for v in _own_units("villager"):
			if int(v.order) == 2 or int(v.order) == 1:
				gathering += 1
		_check("right-click resource: gather", gathering >= 4, "%d villagers ordered" % gathering)
	else:
		_check("right-click resource: gather", false, "no tree on screen")

	# control group 1
	var sel_before: Array = ui.selected.duplicate()
	await _key(KEY_1, {"ctrl": true})
	_check("ctrl+1 assigns group", ui.groups.get("1", []).size() == sel_before.size())

	# build a house: E, ghost, left-click a free explored tile
	await _key(KEY_E)
	_check("E starts house placement", str(ui._mode.get("kind", "")) == "place")
	var placed := false
	var houses0 := _buildings(1, "house").size()
	var hd: Dictionary = sim.get_building_def("house")
	for r in range(4, 14):
		for a in 16:
			var ang := a * TAU / 16.0
			var tx := int(tc.tx + tc.w * 0.5 + cos(ang) * r - hd.w * 0.5)
			var tz := int(tc.tz + tc.h * 0.5 + sin(ang) * r - hd.h * 0.5)
			if not sim.can_place("house", tx, tz) or not sim.is_explored(tx, tz):
				continue
			var p := _screen(tx + hd.w * 0.5, tz + hd.h * 0.5, 0.0)
			if not _on_screen(p):
				continue
			await _move(p)
			await _frames(2)
			if ui._ghost_ok:
				await _click(p)
				placed = true
				break
		if placed:
			break
	await _frames(3)
	_check("house placed with a click", _buildings(1, "house").size() == houses0 + 1, "houses %d -> %d" % [houses0, _buildings(1, "house").size()])

	# recall group 1
	await _click(Vector2(root.get_visible_rect().size.x * 0.5, root.get_visible_rect().size.y * 0.3))  # click empty ground: deselect
	await _key(KEY_1)
	_check("1 recalls group", ui.selected.size() == sel_before.size(), "%d" % ui.selected.size())

	# H selects the Town Center, Q trains a villager
	await _key(KEY_H)
	_check("H selects Town Center", ui.selected.size() == 1 and int(ui.selected[0]) == int(tc.id))
	await _key(KEY_Q)
	await _frames(2)
	var q: Array = sim.get_building(tc.id).get("queue", [])
	_check("Q trains a villager", q.size() >= 1, "queue %d" % q.size())

	# advance age (grant the cost first: the opening cannot afford it yet)
	var cost: Dictionary = sim.next_age_cost(1)
	var pl: Dictionary = sim.get_player(1)
	sim.set_player_resources(1, {"food": float(pl.food) + float(cost.get("food", 0)), "wood": float(pl.wood) + float(cost.get("wood", 0)),
		"gold": float(pl.gold) + float(cost.get("gold", 0)), "favor": float(pl.favor) + float(cost.get("favor", 0))})
	await _frames(20)  # HUD refresh picks the new command state
	await _key(KEY_A)
	await _frames(2)
	_check("A advances the age", bool(sim.get_player(1).advancing), str(sim.get_player(1).get("age_name", "")))

	# double-click a villager: all villagers on screen
	var v0: Array = _own_units("villager")
	var pv := _screen(v0[0].x, v0[0].z, 0.8)
	# (both clicks inside one frame: software-rendered frames are slower
	# than the 350 ms double-click window)
	await _move(pv)
	for i in 4:
		var e := InputEventMouseButton.new()
		e.position = pv
		e.global_position = pv
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = i % 2 == 0
		e.double_click = i == 2
		Input.parse_input_event(e)
	await _frames(3)
	_check("double-click selects the type", ui.selected.size() >= 2, "%d" % ui.selected.size())

	# X stops them
	await _key(KEY_X)
	await _frames(2)
	var idle := 0
	for v in _own_units("villager"):
		if ui.selected.has(v.id) and int(v.order) == 0:
			idle += 1
	_check("X stops the selection", idle == ui.selected.size(), "%d idle" % idle)

	# god power hotkeys work with units selected (X is Stop there): a real key
	# event, the same "can't cast" message as the button, then targeting mode
	var storm_key := str(sim.get_power_def("lightning_storm").get("hotkey", ""))
	var used := {"X": true, "H": true}
	for c in ui.commands:
		if c != null: used[str(c.key)] = true
	var clash := []
	for pn in sim.power_names():
		var k := str(sim.get_power_def(pn).get("hotkey", ""))
		if k == "" or used.has(k): clash.append("%s:%s" % [pn, k])
	_check("power hotkeys clash with no command", clash.is_empty(), str(clash))
	var tip := ""
	for z in ui._back.zones + ui._front.zones:
		if z.id == "power" and str(z.arg) == "lightning_storm":
			tip = str(z.tip.get("hotkey", ""))
	_check("power tooltip shows its hotkey", tip == storm_key and tip != "", "'%s'" % tip)
	var n_sel: int = ui.selected.size()
	var fav0 := float(sim.get_player(1).favor)
	sim.set_player_resources(1, {"favor": 0.0})
	await _frames(15)
	await _key(OS.find_keycode_from_string(storm_key))
	_check("power hotkey without favor: the button's message", str(ui._mode.get("kind", "")) == "" and ui.msg_text == "Not enough favor", "'%s'" % ui.msg_text)
	sim.set_player_resources(1, {"favor": maxf(fav0, 60.0)})
	await _frames(15)
	await _key(OS.find_keycode_from_string(storm_key))
	_check("%s enters Lightning Storm targeting" % storm_key, str(ui._mode.get("kind", "")) == "power" and str(ui._mode.get("id", "")) == "lightning_storm"
		and ui.selected.size() == n_sel, "mode %s, %d selected" % [ui._mode, ui.selected.size()])
	await _key(KEY_ESCAPE)
	_check("Esc leaves targeting", ui._mode.is_empty())

	# camera: wheel zoom, [ turn, middle-drag pan, Home resets
	var d0: float = cam.distance
	await _button(root.get_visible_rect().get_center(), MOUSE_BUTTON_WHEEL_UP, true)
	await _frames(30)
	_check("wheel zooms in", cam.distance < d0 - 1.0, "%.1f -> %.1f" % [d0, cam.distance])
	var y0: float = cam.yaw
	var ev := InputEventKey.new()
	ev.keycode = KEY_BRACKETLEFT
	ev.pressed = true
	Input.parse_input_event(ev)
	await _frames(10)
	var up := ev.duplicate() as InputEventKey
	up.pressed = false
	Input.parse_input_event(up)
	await _frames(1)
	_check("[ turns the camera", absf(cam.yaw - y0) > 0.02, "%.2f -> %.2f rad" % [y0, cam.yaw])
	await _key(KEY_HOME)
	await _frames(1)
	_check("Home resets the turn", absf(cam.yaw - y0) < 1e-4)
	var t0: Vector3 = cam.target
	var c := root.get_visible_rect().get_center()
	await _drag(c, c + Vector2(120, 60), MOUSE_BUTTON_MIDDLE)
	_check("middle-drag pans", cam.target.distance_to(t0) > 1.0, "%.1f" % cam.target.distance_to(t0))
	await _key(KEY_H)  # back home
	await _frames(2)

	# god power: Bolt by its hotkey, then a left-click on the map
	var favor0 := float(sim.get_player(1).favor)
	var bolt: Dictionary = sim.get_power_def("bolt")
	var hk := str(bolt.get("hotkey", ""))
	sim.set_player_resources(1, {"favor": maxf(favor0, 60.0)})
	favor0 = float(sim.get_player(1).favor)
	await _frames(15)
	if hk != "":
		await _key(OS.find_keycode_from_string(hk))
	else:
		var zc = null
		for layer in [ui._front, ui._back]:
			for z in layer.zones:
				if z.id == "power" and str(z.arg) == "bolt":
					zc = layer.get_global_transform_with_canvas() * z.rect.get_center()
		if zc != null:
			await _click(zc)
	_check("power targeting mode", str(ui._mode.get("kind", "")) == "power", "hotkey '%s'" % hk)
	await _click(_screen(tc.tx + tc.w + 4.0, tc.tz + tc.h + 4.0, 0.0))
	await _frames(3)
	_check("Bolt cast on the map", float(sim.get_player(1).favor) < favor0 or float(sim.power_cooldown(1, "bolt")) > 0.0,
		"favor %.0f -> %.0f" % [favor0, float(sim.get_player(1).favor)])

	# let the match play (AI included) for two minutes of sim, rendering along
	var tick0: int = sim.get_tick()
	main.time_scale = 8.0
	await _frames(90)
	main.time_scale = 1.0
	sim.tick(30 * 90)
	await _frames(10)
	_check("match runs with the AI", sim.get_tick() > tick0 + 30 * 90, "tick %d" % sim.get_tick())

	# victory: raze the enemy Town Center (harness shortcut), expect the card
	for b in _buildings(2, "town_center"):
		sim.destroy_building(b.id)
	for i in 120:
		await process_frame
		if not ui.result.is_empty():
			break
	_check("victory card", not ui.result.is_empty() and bool(ui.result.get("won", false)), str(ui.result.get("kicker", "")))
	await _frames(4)
	var rz = _zone_center("restart")
	_check("play again button drawn", rz != null)
	if rz != null:
		var old := main
		await _click(rz)
		await _frames(20)
		_check("play again restarts", current_scene != null and current_scene != old and current_scene.sim != null and current_scene.pieces.has("ui")
			and current_scene.pieces.ui.result.is_empty(), "tick %d" % (current_scene.sim.get_tick() if current_scene and current_scene.sim else -1))
	_finish()

func _finish() -> void:
	print("PLAYTEST_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails}))
	quit(fails.size())
