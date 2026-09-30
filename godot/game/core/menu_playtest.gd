extends SceneTree
## The whole screen flow through real input events (mouse clicks at the drawn
## widgets' centres, keys), started with NO scene argument like a player's
## launch: main menu -> Skirmish -> the setup screen (6 players, teams 3 v 3,
## one AI per difficulty level, a new colour, a larger map) -> Play -> the
## loading screen -> the match, whose settings are then read back from the
## sim (players, teams, human / AI, difficulties, colours, map size); Esc ->
## the game menu (the match pauses; Resume; Options opens and Esc closes it)
## -> Quit to Main Menu -> the menu -> Skirmish (the setup remembers) -> Play
## -> the same match again; the result card's Play Again (the same match once
## more) and Main Menu (back to the menu).
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/core/menu_playtest.gd [-- --shots=/abs/dir]
##
## Prints "FLOW ok|FAIL <step>" per step, the clicks it took ("FLOW clicks
## ...") and "FLOW_RESULT {json}"; exits with the number of failed steps
## (99 on a timeout). --shots saves the loading screen, the game menu and the
## result card as PNGs there. It needs a display (headless windows are 64x64).

const M := preload("res://game/menu/setup/match_settings.gd")
const Loading := preload("res://game/menu/loading.gd")

## What the test sets on the setup screen (row = player index, 0 = you).
const WANT_TEAMS := [1, 1, 1, 2, 2, 2]
const WANT_AI := ["", "easy", "moderate", "hard", "titan", "moderate"]
const WANT_COLOR0 := 7          # M.COLORS[7]: cyan, a colour no seat has by default
const WANT_SIZE := 160          # Large

var fails: Array = []
var passes := 0
var clicks := 0
var keys := 0
var screen: Control             # the setup screen
var shots := ""
var report := {}

func _initialize() -> void:
	var dog := Timer.new()
	dog.wait_time = 1500
	dog.one_shot = true
	dog.autostart = true
	dog.timeout.connect(func() -> void:
		printerr("FLOW timeout")
		print("FLOW_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails + ["timeout"], "report": report}))
		quit(99))
	root.add_child.call_deferred(dog)
	var a := AovArgs.parse()
	shots = str(a.get("shots", ""))
	_check("launch has no scene argument", not a.has("scene"), str(a))
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

# ---- plumbing -------------------------------------------------------------------------

func _check(name: String, ok: bool, detail := "") -> void:
	if ok:
		passes += 1
		print("FLOW ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("FLOW FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _shot(name: String) -> void:
	if shots == "":
		return
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(shots)
	root.get_texture().get_image().save_png(shots.path_join(name + ".png"))

func _move_to(p: Vector2) -> void:
	var m := InputEventMouseMotion.new()
	var last: Vector2 = root.get_mouse_position()
	m.position = p
	m.global_position = p
	m.relative = p - last
	Input.warp_mouse(p)
	Input.parse_input_event(m)
	await _frames(1)

func _click_at(p: Vector2) -> void:
	await _move_to(p)
	clicks += 1
	for pressed in [true, false]:
		var e := InputEventMouseButton.new()
		e.position = p
		e.global_position = p
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = pressed
		Input.parse_input_event(e)
		await _frames(1)
	await _frames(2)

## A Control's centre in window px (through its CanvasLayer's scale).
func _center(c: Control) -> Vector2:
	return c.get_global_transform_with_canvas() * (c.size * 0.5)

## Click a Control, after checking it is the one the GUI finds there.
func _click_control(c: Control) -> bool:
	if c == null or not c.is_visible_in_tree():
		return false
	var p := _center(c)
	await _move_to(p)
	var hit := root.gui_get_hovered_control() if root.has_method("gui_get_hovered_control") else c
	if hit != null and hit != c and not c.is_ancestor_of(hit):
		print("FLOW note: the control under the mouse is %s, not %s" % [hit.name, c.name])
		return false
	await _click_at(p)
	return true

func _key(k: Key) -> void:
	keys += 1
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = k
		e.physical_keycode = k
		e.pressed = pressed
		Input.parse_input_event(e)
		await _frames(1)
	await _frames(1)

func _main() -> Node:
	var m := current_scene
	return m if m != null and "scene_def" in m else null

func _scene_name() -> String:
	var m := _main()
	return str(m.scene_def.get("name", "")) if m else ""

## Wait until `scene` is built and on screen (no loading screen left);
## returns {ok, frames, ms, loading_seen, loading_frames}.
func _await_scene(scene: String, old, max_frames := 900) -> Dictionary:
	var t0 := Time.get_ticks_msec()
	var seen := false
	var shot_done := false
	var lf := 0
	for i in max_frames:
		await process_frame
		var l := root.get_node_or_null(Loading.NODE_NAME)
		if l != null:
			seen = true
			lf = maxi(lf, int(l.shown_frames))
			if not shot_done and float(l.value) > 0.3 and scene != "menu":
				shot_done = true
				report["loading_" + scene] = {"map": str(l.info.get("map", "")), "teams": (l.info.get("teams", []) as Array).size(), "stage": str(l.stage), "value": snappedf(float(l.value), 0.01)}
				await _shot("loading")
		var m := _main()
		if m != null and (old == null or not is_instance_valid(old) or m != old) and _scene_name() == scene and not bool(m.building) and m.sim != null and l == null:
			return {"ok": true, "frames": i + 1, "ms": Time.get_ticks_msec() - t0, "loading_seen": seen, "loading_frames": lf}
	return {"ok": false, "frames": max_frames, "ms": Time.get_ticks_msec() - t0, "loading_seen": seen, "loading_frames": lf}

# ---- the setup screen -------------------------------------------------------------------

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
	await _click_at(p)
	return true

## Open dropdown (id, row) and click the item whose value is v.
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

## Main menu -> Skirmish: the setup screen.
func _open_setup() -> bool:
	var m := _main()
	if m == null or not m.pieces.has("menu"):
		return false
	var menu: Node = m.pieces.menu
	var ok := await _click_control(menu._tiles.get("skirmish"))
	await _frames(6)
	screen = _find_screen(root)
	return ok and screen != null and screen.is_visible_in_tree()

# ---- the match, read back from the sim --------------------------------------------------

func _check_match(tag: String, want_color: int) -> void:
	var m := _main()
	var sim: Object = m.sim if m else null
	if sim == null:
		_check(tag + ": the match exists", false)
		return
	var ids: Array = []
	for pid in sim.get_player_ids():
		if int(pid) != 0:
			ids.append(int(pid))
	ids.sort()
	_check(tag + ": 6 players", ids == [1, 2, 3, 4, 5, 6], str(ids))
	var teams := []
	var diffs := []
	var humans := []
	for pid in ids:
		var p: Dictionary = sim.get_player(pid)
		teams.append(int(p.get("team", -1)))
		diffs.append("" if bool(p.get("human", false)) else str(p.get("difficulty", "?")))
		humans.append(bool(p.get("human", false)))
	var t := teams
	_check(tag + ": teams 3 v 3", t.size() == 6 and t[0] == t[1] and t[1] == t[2] and t[3] == t[4] and t[4] == t[5] and t[0] != t[3]
		and sim.is_ally(1, 2) and sim.is_ally(1, 3) and sim.is_enemy(1, 4) and sim.is_ally(4, 6) and not sim.is_ally(3, 5), str(t))
	_check(tag + ": you are the one human", humans == [true, false, false, false, false, false] and int(sim.get_local_player()) == 1, str(humans))
	_check(tag + ": one AI per difficulty", diffs == WANT_AI, str(diffs))
	var ai_diffs := []
	for pid in range(2, 7):
		ai_diffs.append(str(sim.get_ai(pid).get("difficulty", "?")))
	_check(tag + ": the AIs run their difficulty", ai_diffs == WANT_AI.slice(1), str(ai_diffs))
	var c1 := int(sim.get_player(1).get("color", -1))
	var cols := []
	for pid in ids:
		cols.append(int(sim.get_player(pid).get("color", -1)))
	var distinct := {}
	for c in cols:
		distinct[c] = true
	_check(tag + ": your colour", c1 == int(M.COLORS[want_color]), "%06x (want %06x)" % [c1, int(M.COLORS[want_color])])
	_check(tag + ": six distinct colours", distinct.size() == 6, str(cols.map(func(c): return "%06x" % c)))
	_check(tag + ": map size", int(sim.get_map_size()) == WANT_SIZE, str(sim.get_map_size()))
	_check(tag + ": a Town Center per player", _tcs(sim).size() == 6, str(_tcs(sim).size()))
	_check(tag + ": the HUD is up", m.pieces.has("ui") and m.pieces.ui.hud_visible)
	report[tag] = {"players": ids.size(), "teams": teams, "difficulties": diffs, "colors": cols.map(func(c): return "%06x" % c), "map_size": sim.get_map_size()}

func _tcs(sim: Object, owners := []) -> Array:
	var b: Dictionary = sim.get_buildings()
	var out := []
	for i in int(b.count):
		if b.type_names[b.type[i]] == "town_center" and (owners.is_empty() or int(b.owner[i]) in owners):
			out.append(b.ids[i])
	return out

func _hud_zone(id: String) -> Variant:
	var ui: Node = _main().pieces.get("ui")
	for layer in [ui._front, ui._back]:
		for z in layer.zones:
			if z.id == id:
				return layer.get_global_transform_with_canvas() * z.rect.get_center()
	return null

## Raze the enemy team's Town Centers (a harness shortcut, as playtest.gd
## does) and wait for the result card.
func _win() -> bool:
	var m := _main()
	for id in _tcs(m.sim, [4, 5, 6]):
		m.sim.destroy_building(id)
	for i in 240:
		await process_frame
		if not m.pieces.ui.result.is_empty():
			await _frames(4)
			return true
	return false

# ---- the run --------------------------------------------------------------------------

func _run() -> void:
	# 1. a plain launch: the main menu
	var r := await _await_scene("menu", null, 300)
	_check("plain launch opens the main menu", r.ok and _main().pieces.menu.active and not _main().pieces.has("ui"), _scene_name())
	if not r.ok:
		return _done()
	await _frames(45)  # the menu's intro
	var c0 := clicks

	# 2. Skirmish -> the setup screen
	_check("Skirmish opens the setup screen", await _open_setup())
	if screen == null:
		return _done()
	var s: Dictionary = screen.settings
	var parts := {"skirmish": clicks - c0}
	var cp := clicks
	# 3. the match: 6 players, teams 3 v 3, one AI per difficulty, a colour, the map size
	_check("player count 6", await _pick("count", 0, 6) and s.players.size() == 6, str(s.players.size()))
	parts["count"] = clicks - cp
	cp = clicks
	for i in 6:
		if int(s.players[i].team) != WANT_TEAMS[i]:
			await _pick("team", i, WANT_TEAMS[i])
	parts["teams"] = clicks - cp
	cp = clicks
	_check("teams 3 v 3 set", s.players.map(func(p): return int(p.team)) == WANT_TEAMS, str(s.players.map(func(p): return int(p.team))))
	for i in range(1, 6):
		if str(s.players[i].ai) != WANT_AI[i]:
			await _pick("difficulty", i, WANT_AI[i])
	parts["difficulties"] = clicks - cp
	cp = clicks
	_check("difficulties set", s.players.map(func(p): return "" if bool(p.human) else str(p.ai)) == WANT_AI)
	_check("colour set", await _pick("color", 0, WANT_COLOR0) and int(s.players[0].color) == WANT_COLOR0, str(s.players[0].color))
	parts["colour"] = clicks - cp
	cp = clicks
	_check("map size set", await _pick("size", 0, WANT_SIZE) and int(s.map_size) == WANT_SIZE, str(s.map_size))
	parts["map size"] = clicks - cp
	await _shot("setup")
	# 4. Play: the loading screen, then the match
	var old := _main()
	var ok_play := await _click_zone(0, "play")
	var setup_clicks := clicks - c0
	parts["play"] = 1
	report["clicks_parts"] = parts
	print("FLOW clicks: %d from the main menu to this match %s; a default skirmish is 2 (Skirmish, Play)" % [setup_clicks, JSON.stringify(parts)])
	r = await _await_scene("skirmish", old)
	report["clicks_to_match"] = setup_clicks
	report["load_1"] = r
	_check("Play starts the match", ok_play and r.ok, str(r))
	_check("a loading screen shows while it builds", r.loading_seen and r.loading_frames >= 3, "%d frames, %d ms" % [r.loading_frames, r.ms])
	if not r.ok:
		return _done()
	_check_match("match", WANT_COLOR0)
	await _frames(10)

	# 5. Esc: the game menu, the match pauses; Resume goes on
	var m := _main()
	var gm: Node = m.get("game_menu")
	_check("the match has a game menu", gm != null)
	if gm == null:
		return _done()
	await _key(KEY_ESCAPE)
	_check("Esc opens the game menu", gm.visible and gm.buttons.resume.is_visible_in_tree())
	await _shot("game_menu")
	var tk: int = m.sim.get_tick()
	await _frames(20)
	_check("the match pauses under it", m.sim.get_tick() == tk and m.paused, "tick %d -> %d" % [tk, m.sim.get_tick()])
	var ui: Node = m.pieces.ui
	var nsel: int = ui.selected.size()
	await _key(KEY_H)   # a HUD hotkey (select the Town Center) must not pass through
	_check("hotkeys do not reach the HUD", ui.selected.size() == nsel, "%d -> %d" % [nsel, ui.selected.size()])
	_check("Resume closes it", await _click_control(gm.buttons.resume) and not gm.visible)
	await _frames(30)
	_check("the match runs again", m.sim.get_tick() > tk and not m.paused, "tick %d -> %d" % [tk, m.sim.get_tick()])
	await _key(KEY_ESCAPE)
	_check("Esc opens it again", gm.visible)
	_check("Options opens", await _click_control(gm.buttons.options) and gm.options.visible)
	await _shot("game_options")
	await _key(KEY_ESCAPE)
	_check("Esc closes Options, the menu stays", not gm.options.visible and gm.visible)
	await _key(KEY_ESCAPE)
	_check("Esc closes the menu", not gm.visible and not m.paused)
	await _key(KEY_ESCAPE)
	# 6. Quit to Main Menu
	old = m
	var ok_quit := await _click_control(gm.buttons.quit)
	r = await _await_scene("menu", old)
	report["to_menu"] = r
	_check("Quit to Main Menu", ok_quit and r.ok and _main().pieces.menu.active, str(r))
	if not r.ok:
		return _done()
	await _frames(45)

	# 7. Skirmish again: the setup remembers the match; Play plays it again
	c0 = clicks
	_check("Skirmish again", await _open_setup())
	if screen == null:
		return _done()
	s = screen.settings
	_check("the setup remembers the last match", s.players.size() == 6 and int(s.map_size) == WANT_SIZE and int(s.players[0].color) == WANT_COLOR0
		and s.players.map(func(p): return int(p.team)) == WANT_TEAMS, "%d players" % s.players.size())
	old = _main()
	var ok2 := await _click_zone(0, "play")
	r = await _await_scene("skirmish", old)
	report["clicks_replay"] = clicks - c0
	report["load_2"] = r
	_check("setup -> Play again", ok2 and r.ok, str(r))
	if not r.ok:
		return _done()
	_check_match("replay", WANT_COLOR0)

	# 8. the result card: Play Again (the same match), then Main Menu
	_check("victory card", await _win())
	await _shot("result")
	var pz = _hud_zone("restart")
	var mz = _hud_zone("to_menu")
	_check("the card offers Play Again and Main Menu", pz != null and mz != null)
	if pz == null or mz == null:
		return _done()
	old = _main()
	await _click_at(pz)
	r = await _await_scene("skirmish", old)
	_check("Play Again starts the same match", r.ok and _main().pieces.ui.result.is_empty() and _main().sim.get_tick() < 30 * 20, str(r))
	if not r.ok:
		return _done()
	_check_match("play again", WANT_COLOR0)
	_check("second victory card", await _win())
	old = _main()
	await _click_at(_hud_zone("to_menu"))
	r = await _await_scene("menu", old)
	_check("Main Menu from the result card", r.ok and _main().pieces.menu.active, str(r))
	_done()

func _done() -> void:
	report["clicks_total"] = clicks
	report["keys_total"] = keys
	print("FLOW_RESULT %s" % JSON.stringify({"passed": passes, "failed": fails, "report": report}))
	AovArgs.override = {}
	M.last = {}
	quit(fails.size())
