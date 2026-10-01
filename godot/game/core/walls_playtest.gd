extends SceneTree
## Walls, gates and towers through the real input path (ui piece: wall mode,
## the build grid, the fortification commands; PORTING.md "Walls, gates,
## towers: placement"). Every player action is an InputEvent fed to
## Input.parse_input_event (mouse moves / presses / drags at screen points
## projected from the sim, clicks on the drawn command grid, keys); the
## results are read back from the sim.
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/core/walls_playtest.gd -- --scene=skirmish [--shots=/abs/dir]
##
## Steps: box select the villagers; the Build Wall / tower buttons and their
## tooltips (cost, age); W enters wall mode; a drag across the Town Center
## shows red blocked tiles, Esc drops it; four Shift-drags draw a closed
## ring (each start a tile off the last corner: it snaps onto it and joins),
## the ghost green along the dragged tiles with the total cost, every line
## placed exactly on the dragged tiles and paid; the selected villagers build
## the whole ring; a click on a south segment, the Convert to Gate button;
## L locks the gate, the Unlock button unlocks it; enemy soldiers ordered
## into the ring stay out, the player's own (box selected, right-click
## inside) walk in through the gate; Y places a tower (ghost + range ring),
## the villagers build it, its upgrade button refuses before the Classical
## Age, the age is advanced through the Town Center (A), then the Watch
## Tower button researches the upgrade (range up), and the tower shoots an
## enemy. Harness shortcuts (not player input): the AI is off, resources
## are granted, the enemy's soldiers are spawned and ordered by script, the
## sim is stepped fast while frames render between.
##
## Prints "WALLSPLAY ok|FAIL <step>" and "WALLSPLAY_RESULT {json}"; exit =
## failures (99 on a timeout). Needs a rendering display (HUD hit zones are
## registered while it draws). ~4 min on lavapipe.

var main: Node
var ui: Node
var sim: Object
var cam: Camera3D
var fails: Array = []
var passes := 0
var shots := ""
const ME := 1
const FOE := 2

func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots = a.substr(8)
	var dog := Timer.new()
	dog.wait_time = 1500
	dog.one_shot = true
	dog.timeout.connect(func() -> void:
		printerr("WALLSPLAY timeout")
		quit(99))
	root.add_child.call_deferred(dog)
	dog.autostart = true
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

func _check(name: String, ok: bool, detail := "") -> void:
	if ok:
		passes += 1
		print("WALLSPLAY ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("WALLSPLAY FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _shot(name: String) -> void:
	if shots == "":
		return
	await _frames(2)
	DirAccess.make_dir_recursive_absolute(shots)
	var img := root.get_texture().get_image()
	img.save_png(shots.path_join("walls_play_%s.png" % name))

# ---- input (as game/core/playtest.gd) -------------------------------------------------

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

## press at a, move to b in steps (button held), optionally stop before the release
func _press_drag(a: Vector2, b: Vector2, mods := {}, steps := 8) -> void:
	await _move(a, mods)
	await _button(a, MOUSE_BUTTON_LEFT, true, mods)
	for i in range(1, steps + 1):
		await _move(a.lerp(b, i / float(steps)), mods, 1)
	await _frames(2)

func _release(b: Vector2, mods := {}) -> void:
	await _button(b, MOUSE_BUTTON_LEFT, false, mods)
	await _frames(2)

func _box(points: Array) -> void:
	var lo := Vector2(1e9, 1e9)
	var hi := Vector2(-1e9, -1e9)
	for p in points:
		lo = lo.min(p)
		hi = hi.max(p)
	await _press_drag(lo - Vector2(25, 25), hi + Vector2(25, 25), {}, 6)
	await _release(hi + Vector2(25, 25))

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

# ---- helpers ------------------------------------------------------------------------

func _bind() -> void:
	main = current_scene
	ui = main.pieces.get("ui")
	sim = main.sim
	cam = main.camera

func _screen(x: float, z: float, lift := 0.0) -> Vector2:
	cam.apply()
	return cam.unproject_position(Vector3(x, sim.height_at(x, z) + lift, z))

func _tile_screen(t: Vector2i) -> Vector2:
	return _screen(t.x + 0.5, t.y + 0.5)

func _on_screen(p: Vector2) -> bool:
	var r := root.get_visible_rect().grow(-40)
	return r.has_point(p) and p.y > r.size.y * 0.12 and p.y < r.size.y * 0.76

func _units(owner: int, type_name := "") -> Array:
	var u: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in int(u.count):
		if int(u.owner[i]) == owner and not (u.flags[i] & 2) and (type_name == "" or names[u.type[i]] == type_name):
			out.append({"id": u.ids[i], "x": u.pos[i * 2], "z": u.pos[i * 2 + 1], "order": u.order[i]})
	return out

func _town_center() -> Dictionary:
	var b: Dictionary = sim.get_buildings()
	for i in int(b.count):
		if int(b.owner[i]) == ME and b.type_names[b.type[i]] == "town_center":
			return {"id": b.ids[i], "tx": b.rect[i * 4], "tz": b.rect[i * 4 + 1], "w": b.rect[i * 4 + 2], "h": b.rect[i * 4 + 3]}
	return {}

## player 1's wall pieces: [{id, kind, tx, tz, w, h, built, locked, tech}]
func _pieces() -> Array:
	var W: Dictionary = sim.get_walls()
	var out := []
	for i in int(W.count):
		if int(W.owner[i]) != ME:
			continue
		out.append({"id": int(W.ids[i]), "kind": int(W.kind[i]), "tx": int(W.rect[i * 4]), "tz": int(W.rect[i * 4 + 1]),
			"w": int(W.rect[i * 4 + 2]), "h": int(W.rect[i * 4 + 3]), "built": int(W.built[i]), "locked": int(W.locked[i]), "tech": int(W.tech[i])})
	return out

func _piece(id: int) -> Dictionary:
	for p in _pieces():
		if p.id == id:
			return p
	return {}

## tiles covered by player 1's wall pieces (not towers)
func _wall_tiles() -> Dictionary:
	var out := {}
	for p in _pieces():
		if p.kind == 3:
			continue
		for z in range(p.tz, p.tz + p.h):
			for x in range(p.tx, p.tx + p.w):
				out[Vector2i(x, z)] = p.id
	return out

func _res() -> Vector2:
	var p: Dictionary = sim.get_player(ME)
	return Vector2(float(p.wood), float(p.gold))

## centre of the drawn command button running `action` (and optional arg check)
func _cmd_center(action: String) -> Variant:
	for layer in [ui._front, ui._back]:
		for z in layer.zones:
			if z.id == "cmd":
				var c = ui.commands[int(z.arg)]
				if c != null and str(c.action) == action:
					return layer.get_global_transform_with_canvas() * z.rect.get_center()
	return null

func _cmd(action: String) -> Dictionary:
	for c in ui.commands:
		if c != null and str(c.action) == action:
			return c
	return {}

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

func _inside(ids: Array, c: Vector2i, r: int) -> int:
	var n := 0
	for id in ids:
		var u: Dictionary = sim.get_unit(id)
		if u.is_empty() or bool(u.dead):
			continue
		if u.x > c.x - r + 1 and u.x < c.x + r and u.z > c.y - r + 1 and u.z < c.y + r:
			n += 1
	return n

## the line of tiles a straight drag from a to b covers (same row or column)
func _line(a: Vector2i, b: Vector2i) -> Array:
	var out := []
	var d := Vector2i(signi(b.x - a.x), signi(b.y - a.y))
	var t := a
	out.append(t)
	while t != b:
		t += d
		out.append(t)
	return out

# ---- the ring area -------------------------------------------------------------------

const R := 3   # ring corners at C +- R: a 7 x 7 ring of 24 tiles

## a ring centre near the Town Center (nearest first, 6+ tiles off) whose
## four sides plan fully (no tile blocked), every tile explored and nobody
## standing on it
func _find_ring(tc: Dictionary) -> Vector2i:
	var cx: float = tc.tx + tc.w * 0.5
	var cz: float = tc.tz + tc.h * 0.5
	var cands := []
	for z in range(int(cz) - 22, int(cz) + 23):
		for x in range(int(cx) - 22, int(cx) + 23):
			var d := Vector2(x + 0.5, z + 0.5).distance_to(Vector2(cx, cz))
			if d >= 6.0 + R:
				cands.append([d, Vector2i(x, z)])
	cands.sort_custom(func(p, q): return p[0] < q[0])
	for cd in cands:
		var c: Vector2i = cd[1]
		var ok := true
		for k in 4:
			var p0: Vector2i = _corner(c, k)
			var p1: Vector2i = _corner(c, (k + 1) % 4)
			var P: Dictionary = sim.plan_wall(ME, Vector2(p0.x + 0.5, p0.y + 0.5), Vector2(p1.x + 0.5, p1.y + 0.5))
			if not bool(P.valid) or int(P.new_tiles) != 2 * R + 1:
				ok = false
				break
			for i in P.state.size():
				if not sim.is_explored(P.tiles[i * 2] + 0.5, P.tiles[i * 2 + 1] + 0.5):
					ok = false
			if not ok:
				break
		if ok and sim.units_near(c.x + 0.5, c.y + 0.5, R + 1.5).is_empty():
			return c
	return Vector2i(-1, -1)

## harness: the camera between the ring and the Town Center (where a player
## would have scrolled to)
func _look(c: Vector2i) -> void:
	var tc := _town_center()
	var tcp := Vector2(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5)
	var p := tcp.lerp(Vector2(c.x + 0.5, c.y + 0.5), 0.6)
	cam.target.x = p.x
	cam.target.z = p.y
	await _frames(6)

func _corner(c: Vector2i, k: int) -> Vector2i:
	return [Vector2i(c.x - R, c.y - R), Vector2i(c.x + R, c.y - R), Vector2i(c.x + R, c.y + R), Vector2i(c.x - R, c.y + R)][k]

# ---- the playthrough -------------------------------------------------------------------

func _run() -> void:
	await _frames(12)
	_bind()
	if ui == null or sim == null:
		_check("scene with the ui piece", false)
		_finish()
		return
	# harness: no AI raids during the fast-forwards, enough wood and gold
	sim.set_ai_enabled(false)
	sim.set_player_resources(ME, {"food": 3000.0, "wood": 3000.0, "gold": 3000.0})
	# zoom out a little (wheel): the ring and the Town Center in one view
	for i in 3:
		await _button(root.get_visible_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, true)
	await _frames(40)
	var tc := _town_center()
	var C := _find_ring(tc)
	if C.x >= 0:
		await _look(C)
	var on := C.x >= 0
	for k in 4:
		on = on and _on_screen(_tile_screen(_corner(C, k)))
	_check("ring area on screen", on, "centre %s, camera distance %.0f" % [C, cam.distance])
	if not on:
		_finish()
		return

	# 1. box select the villagers, Ctrl+1
	var vills := _units(ME, "villager")
	var pts := []
	for v in vills:
		pts.append(_screen(v.x, v.z, 0.8))
	await _box(pts)
	await _frames(3)
	_check("box select villagers", ui.selected.size() == vills.size() and vills.size() >= 4, "%d/%d" % [ui.selected.size(), vills.size()])
	await _key(KEY_1, {"ctrl": true})
	var builders: Array = ui.selected.duplicate()

	# 2. the build grid: wall and tower buttons with hotkeys, tooltips with cost and age
	await _frames(8)
	var wc = _cmd_center("wall")
	var tower_cmd: Dictionary = {}
	for c in ui.commands:
		if c != null and str(c.get("arg", "")) == "tower":
			tower_cmd = c
	_check("build grid has Wall (W) and the tower (Y)", wc != null and str(_cmd("wall").get("key", "")) == "W" and str(tower_cmd.get("key", "")) == "Y",
		"%s / %s" % [_cmd("wall").get("title", ""), tower_cmd.get("title", "")])
	if wc != null:
		await _move(wc)
		await _frames(2)
		var tip: Dictionary = ui.tooltip
		var lines := " ".join(PackedStringArray(tip.get("lines", [])))
		_check("Wall tooltip: cost per tile, age, hotkey", str(tip.get("title", "")) == "Build Wall" and float(tip.get("cost", {}).get("wood", 0)) > 0
			and float(tip.get("cost", {}).get("gold", 0)) > 0 and lines.contains("Archaic") and lines.contains("per tile") and str(tip.get("hotkey", "")) == "W", str(tip))
	var tcc = null
	for layer in [ui._front, ui._back]:
		for z in layer.zones:
			if z.id == "cmd" and ui.commands[int(z.arg)] != null and str(ui.commands[int(z.arg)].get("arg", "")) == "tower":
				tcc = layer.get_global_transform_with_canvas() * z.rect.get_center()
	if tcc != null:
		await _move(tcc)
		await _frames(2)
		var tip2: Dictionary = ui.tooltip
		_check("tower tooltip: cost, age", str(tip2.get("title", "")).contains("Tower") and float(tip2.get("cost", {}).get("wood", 0)) > 0
			and " ".join(PackedStringArray(tip2.get("lines", []))).contains("Age"), str(tip2))

	# 3. W: wall mode; a drag across the Town Center shows blocked tiles in red; Esc drops it
	var mid := root.get_visible_rect().get_center()
	await _move(mid)
	await _key(KEY_W)
	_check("W enters wall mode", str(ui._mode.get("kind", "")) == "wall" and ui._mode.get("builders", []).size() == builders.size(), str(ui._mode.get("kind", "")))
	var tcm := Vector2i(int(tc.tx + tc.w * 0.5), int(tc.tz + tc.h * 0.5))
	var ba := Vector2i(tcm.x - 7, tcm.y)
	var bb := Vector2i(tcm.x + 7, tcm.y)
	if _on_screen(_tile_screen(ba)) and _on_screen(_tile_screen(bb)):
		await _press_drag(_tile_screen(ba), _tile_screen(bb))
		var pv: Dictionary = ui.wall_preview
		var red := 0
		for g in ui._wall_ghosts:
			if g.visible and _tinted(g, ui.GHOST_BAD):
				red += 1
		_check("dragging over the Town Center: blocked tiles red", bool(pv.get("dragging", false)) and int(pv.get("blocked", 0)) >= 5 and red >= 5, "blocked %d, red ghosts %d" % [int(pv.get("blocked", 0)), red])
		await _shot("blocked")
		await _key(KEY_ESCAPE)
		await _release(_tile_screen(bb))
		_check("Esc drops the line", ui._mode.is_empty() and _wall_tiles().is_empty(), "%d wall tiles" % _wall_tiles().size())
		await _key(KEY_W)

	# 4. the ring: four Shift-drags; each one after the first starts a tile off
	#    the last corner and snaps onto it
	var paid_expected := Vector2.ZERO
	var res0 := _res()
	var all_ok := true
	var detail := []
	for k in 4:
		var p0: Vector2i = _corner(C, k)
		var p1: Vector2i = _corner(C, (k + 1) % 4)
		var from := p0
		if k > 0:
			# a tile off the corner, away from the new side
			var away := Vector2i(signi(p0.x - p1.x), signi(p0.y - p1.y))
			from = p0 + away
		var last := k == 3
		var mods := {} if last else {"shift": true}
		await _press_drag(_tile_screen(from), _tile_screen(p1), mods)
		var pv: Dictionary = ui.wall_preview
		var a_tile := Vector2i(int(floor(pv.get("a", Vector2(-9, -9)).x)), int(floor(pv.get("a", Vector2(-9, -9)).y)))
		var st: PackedByteArray = pv.get("state", PackedByteArray())
		var green := 0
		for g in ui._wall_ghosts:
			if g.visible and _tinted(g, ui.GHOST_OK):
				green += 1
		var want_new := 2 * R + (1 if k == 0 else 0) - (1 if last else 0)
		var cost: Dictionary = pv.get("cost", {})
		var ok_k: bool = bool(pv.get("ok", false)) and int(pv.get("new_tiles", 0)) == want_new and green == want_new and a_tile == p0
		if k > 0:
			ok_k = ok_k and st.size() > 0 and st[0] == 2   # joins the last line's corner
		ok_k = ok_k and float(cost.get("wood", 0)) == 4.0 * want_new and float(cost.get("gold", 0)) == 2.0 * want_new
		if k == 0:
			await _shot("drag")
		var before := _wall_tiles().size()
		var r0 := _res()
		await _release(_tile_screen(p1), mods)
		var after := _wall_tiles()
		var placed := true
		for t in _line(p0, p1):
			placed = placed and after.has(t)
		ok_k = ok_k and placed and after.size() == before + want_new and r0 - _res() == Vector2(4.0 * want_new, 2.0 * want_new)
		ok_k = ok_k and (str(ui._mode.get("kind", "")) == ("" if last else "wall"))
		paid_expected += Vector2(4.0 * want_new, 2.0 * want_new)
		detail.append("%d: new %d green %d snap %s->%s cost %s placed %s" % [k, int(pv.get("new_tiles", 0)), green, from, a_tile, cost, placed])
		all_ok = all_ok and ok_k
		_check("line %d dragged, snapped, placed on its tiles, paid" % (k + 1), ok_k, detail[k])
	var ring := _wall_tiles()
	var closed := ring.size() == 8 * R
	for k in 4:
		for t in _line(_corner(C, k), _corner(C, (k + 1) % 4)):
			closed = closed and ring.has(t)
	_check("closed ring of foundations", closed and all_ok and res0 - _res() == paid_expected, "%d tiles, paid %s" % [ring.size(), res0 - _res()])
	await _frames(4)
	await _shot("foundations")
	var building := 0
	for v in _units(ME, "villager"):
		if builders.has(v.id) and int(v.order) == 5:
			building += 1
	_check("the selected villagers go to build", building == builders.size(), "%d/%d" % [building, builders.size()])

	# 5. they build it all (no further orders)
	var built_t: float = await _step_until(400.0, func() -> bool:
		for p in _pieces():
			if p.kind != 3 and p.built == 0:
				return false
		return true)
	_check("villagers build the whole ring", built_t >= 0.0, "%.0f s of sim" % built_t)
	await _frames(6)

	# 6. click a south segment, Convert to Gate (button)
	var seg := {}
	for p in _pieces():
		if p.kind == 1 and p.tz == C.y + R and p.w >= 2:
			seg = p
	var gate_id := int(seg.get("id", 0))
	if gate_id != 0:
		for i in seg.w:
			await _click(_tile_screen(Vector2i(seg.tx + i, seg.tz)))
			await _frames(3)
			if ui.selected.size() == 1 and int(ui.selected[0]) == gate_id:
				break
	_check("click selects a wall segment", gate_id != 0 and ui.selected.size() == 1 and int(ui.selected[0]) == gate_id, "segment %s" % seg)
	await _frames(8)
	var gc = _cmd_center("gate")
	_check("segment offers Convert to Gate (G)", gc != null and str(_cmd("gate").get("key", "")) == "G", str(_cmd("gate").get("title", "")))
	var r1 := _res()
	if gc != null:
		await _click(gc)
		await _frames(3)
	_check("Convert to Gate button makes a gate", int(_piece(gate_id).get("kind", -1)) == 2 and r1 - _res() == Vector2(30, 20), "kind %d, paid %s" % [int(_piece(gate_id).get("kind", -1)), r1 - _res()])
	await _frames(8)

	# 7. L locks, the Unlock button unlocks
	await _key(KEY_L)
	await _frames(2)
	_check("L locks the gate", int(_piece(gate_id).get("locked", 0)) == 1)
	await _frames(8)
	var uc = _cmd_center("lock")
	_check("gate shows Unlock Gate", uc != null and str(_cmd("lock").get("title", "")) == "Unlock Gate", str(_cmd("lock").get("title", "")))
	if uc != null:
		await _click(uc)
		await _frames(2)
	_check("Unlock button unlocks", int(_piece(gate_id).get("locked", 1)) == 0)

	# 8. enemies are kept out (harness: spawned and ordered by script), the
	#    player's own soldiers walk in through the gate (box select, right-click)
	var centre := Vector2(C.x + 0.5, C.y + 0.5)
	var foes: Array = Array(sim.spawn_block("hoplite", FOE, 6, C.x + 0.5, C.y - R - 4.5, 3, 1.1, 0.0, 0.0))
	sim.tick(1)
	sim.order_move(PackedInt32Array(foes), centre.x, centre.y)
	var foe_peak := 0
	for s in 40:
		sim.tick(30)
		foe_peak = maxi(foe_peak, _inside(foes, C, R))
		if s % 4 == 0:
			await _frames(1)
	_check("enemy soldiers stay outside the ring", foe_peak == 0, "peak inside %d of %d" % [foe_peak, foes.size()])
	await _shot("blocked_enemies")
	for id in foes:
		sim.kill_unit(id)
	sim.tick(2)
	var mine: Array = Array(sim.spawn_block("hoplite", ME, 6, C.x + 0.5, C.y + R + 4.5, 3, 1.1, 0.0, 0.0))
	await _frames(4)
	pts = []
	for id in mine:
		var u: Dictionary = sim.get_unit(id)
		pts.append(_screen(u.x, u.z, 0.8))
	await _box(pts)
	await _frames(3)
	var sel_ok: bool = ui.selected.size() == mine.size()
	await _click(_screen(centre.x, centre.y), MOUSE_BUTTON_RIGHT)
	var in_t: float = await _step_until(60.0, func() -> bool: return _inside(mine, C, R) >= 5)
	_check("own soldiers walk in through the gate", sel_ok and in_t >= 0.0, "%d inside after %.0f s" % [_inside(mine, C, R), in_t])
	await _shot("gate")

	# 9. the tower: group 1, Y, ghost + range ring, click a free tile, built
	await _key(KEY_1)
	await _frames(8)
	await _key(KEY_Y)
	await _frames(2)
	var tmode: bool = str(ui._mode.get("kind", "")) == "place" and str(ui._mode.get("type", "")) == "tower"
	var td: Dictionary = sim.get_building_def("tower")
	var placed_at := Vector2i(-1, -1)
	var tw0 := _towers().size()
	for r in range(R + 3, R + 12):
		for a in 16:
			var ang := a * TAU / 16.0
			var tx := int(C.x + cos(ang) * r - td.w * 0.5)
			var tz := int(C.y + sin(ang) * r - td.h * 0.5)
			if not sim.can_place("tower", tx, tz) or not sim.is_explored(tx, tz):
				continue
			var p := _screen(tx + td.w * 0.5, tz + td.h * 0.5)
			if not _on_screen(p):
				continue
			await _move(p)
			await _frames(2)
			if ui._ghost_ok:
				_check("tower ghost with its range ring", tmode and ui._ghost != null and ui._range_ring.visible and ui._range_ring.scale.x >= 9.0,
					"ring %.1f" % ui._range_ring.scale.x)
				await _shot("tower_ghost")
				await _click(p)
				placed_at = Vector2i(tx, tz)
				break
		if placed_at.x >= 0:
			break
	await _frames(3)
	var towers := _towers()
	_check("Y + click places a tower", towers.size() == tw0 + 1, "at %s" % placed_at)
	var tower_id := int(towers[towers.size() - 1].id) if not towers.is_empty() else 0
	var tb_t: float = await _step_until(200.0, func() -> bool: return tower_id != 0 and int(_piece(tower_id).get("built", 0)) == 1)
	_check("villagers build the tower", tb_t >= 0.0, "%.0f s" % tb_t)

	# 10. upgrades: refused before the Classical Age, then researched
	await _click(_screen(placed_at.x + 1.0, placed_at.y + 1.0))
	await _frames(8)
	if not (ui.selected.size() == 1 and int(ui.selected[0]) == tower_id):
		await _click(_screen(placed_at.x + 1.0, placed_at.y + 1.5))
		await _frames(8)
	var up: Dictionary = _cmd("research")
	_check("tower selected: Upgrade to Watch Tower (U), needs Classical", ui.selected.size() == 1 and int(ui.selected[0]) == tower_id
		and str(up.get("key", "")) == "U" and not bool(up.get("enabled", true)) and str(up.get("warn", "")).contains("Classical"), "%s / %s" % [up.get("title", ""), up.get("warn", "")])
	await _key(KEY_U)
	await _frames(2)
	_check("U before the age: refused with the reason", int(_piece(tower_id).get("tech", 0)) == 0 and ui.msg_text.contains("Classical"), "'%s'" % ui.msg_text)
	await _key(KEY_H)
	await _frames(8)
	await _key(KEY_A)
	await _frames(2)
	var age_t: float = await _step_until(200.0, func() -> bool: return int(sim.get_player(ME).age) >= 1)
	_check("Town Center advances to the Classical Age (H, A)", age_t >= 0.0, "%.0f s" % age_t)
	await _look(C)
	await _click(_screen(placed_at.x + 1.0, placed_at.y + 1.0))
	await _frames(8)
	var range0 := float(sim.get_fortify(ME).tower.range)
	var upc = _cmd_center("research")
	_check("Upgrade to Watch Tower enabled", upc != null and bool(_cmd("research").get("enabled", false)), str(_cmd("research").get("title", "")))
	if upc != null:
		await _click(upc)
		await _frames(2)
	_check("upgrade button starts the research", int(_piece(tower_id).get("tech", 0)) > 0)
	var up_t: float = await _step_until(120.0, func() -> bool: return int(sim.get_fortify(ME).tower_level) >= 1)
	var F: Dictionary = sim.get_fortify(ME)
	await _frames(8)
	_check("tower upgraded: Watch Tower, longer range", up_t >= 0.0 and str(F.tower_name) == "Watch Tower" and float(F.tower.range) > range0
		and str(ui.info.get("title", "")) == "Watch Tower", "%s range %s -> %s, card '%s'" % [F.tower_name, range0, F.tower.range, ui.info.get("title", "")])
	await _shot("tower")

	# 11. the tower shoots an enemy that comes in range
	var tcx := placed_at.x + 1.0
	var tcz := placed_at.y + 1.0
	var spot := Vector2(tcx + 5.0, tcz)
	for a in 8:
		var ang := a * TAU / 8.0
		var cand := Vector2(tcx + cos(ang) * 6.0, tcz + sin(ang) * 6.0)
		if sim.find_path(cand.x, cand.y, cand.x + 0.1, cand.y).size() > 0 and _wall_tiles().get(Vector2i(int(cand.x), int(cand.y))) == null:
			spot = cand
			break
	var foe := int(sim.spawn_unit("hoplite", FOE, spot.x, spot.y, 0.0))
	var hp0 := float(sim.get_unit(foe).hp)
	for s in 8:
		sim.tick(30)
		await _frames(1)
	var fu: Dictionary = sim.get_unit(foe)
	_check("the tower shoots an enemy in range", fu.is_empty() or bool(fu.dead) or float(fu.hp) < hp0, "hp %.0f -> %s" % [hp0, "dead" if fu.is_empty() or bool(fu.dead) else str(fu.hp)])
	_finish()

## a ghost piece tinted c (alpha aside: pieces and tile markers differ)
func _tinted(g: MeshInstance3D, c: Color) -> bool:
	var a: Color = (g.material_override as StandardMaterial3D).albedo_color
	return absf(a.r - c.r) < 0.01 and absf(a.g - c.g) < 0.01 and absf(a.b - c.b) < 0.01

func _towers() -> Array:
	return _pieces().filter(func(p): return p.kind == 3)

func _finish() -> void:
	print("WALLSPLAY_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails}))
	quit(fails.size())
