extends SceneTree
## The Armory, the Market and the Temple's research through the real input
## path (ui piece: the build grid, placement, the tech buttons, the research
## queue on the selection card, the Market's trade buttons; PORTING.md
## "Research panel, tooltips, market trade"). Every player action is an
## InputEvent fed to Input.parse_input_event (mouse moves / presses at screen
## points projected from the sim, clicks on the drawn command grid and card,
## keys); the results are read back from the sim.
##
##   VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
##     godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
##     -s res://game/core/techs_playtest.gd -- --scene=skirmish [--shots=/abs/dir]
##
## Steps: box select the villagers (Ctrl+1); the build grid has the Armory
## (U) and the Market (K), greyed in the Archaic Age with the reason in the
## tooltip, a click refused with that message; H + A advance to the Classical
## Age; R + a ground click places a Temple, the Armory button + a click an
## Armory, K + a click a Market, the villagers build each; a click on the
## Armory shows its tech buttons (Copper Weapons on Q in a gold frame, Burning
## Pitch greyed "Requires Mythic Age", god techs in purple frames, no Bronze
## tier yet; their states: "available", "locked" with the age numeral, god
## techs with their god), the hover tooltip gives cost, time and effect;
## without favor (harness) a god tech is "unaffordable", short of favor, the
## tooltip says how much more; a click on Copper Weapons pays its cost and
## puts it in the card's queue (its button "researching", Q again refused);
## W queues Copper Armor ("queued", 2nd) and a click on its queue icon cancels it with an
## exact refund; Copper Weapons finishes (feed notice, a hoplite's damage x1.1
## in get_unit_stats, Bronze Weapons now on Q "locked" "Requires Heroic Age",
## Copper Weapons off the grid and under "Researched"); a click on the Temple and the hotkey of
## Olympian Parentage research it (a hero's hp x1.25); a click on the Market
## shows its rates, a click on Buy Food buys 100 food for the shown price (the
## price moves, the button's label follows), S sells 100 food.
## Harness shortcuts (not player input): the AI is off, resources are granted,
## a hoplite and a hero are spawned to measure the techs on, the sim is
## stepped fast while frames render between.
##
## Prints "TECHSPLAY ok|FAIL <step>" and "TECHSPLAY_RESULT {json}"; exit =
## failures (99 on a timeout). Needs a rendering display (HUD hit zones are
## registered while it draws).

var main: Node
var ui: Node
var sim: Object
var cam: Camera3D
var fails: Array = []
var passes := 0
var shots := ""
var result := {}
const ME := 1

func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots = a.substr(8)
	var dog := Timer.new()
	dog.wait_time = 1500
	dog.one_shot = true
	dog.timeout.connect(func() -> void:
		printerr("TECHSPLAY timeout")
		quit(99))
	root.add_child.call_deferred(dog)
	dog.autostart = true
	change_scene_to_file("res://game/main.tscn")
	_run.call_deferred()

func _check(name: String, ok: bool, detail := "") -> void:
	result[name] = ok
	if ok:
		passes += 1
		print("TECHSPLAY ok   %s %s" % [name, detail])
	else:
		fails.append(name)
		print("TECHSPLAY FAIL %s %s" % [name, detail])

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _shot(name: String) -> void:
	if shots == "":
		return
	await _frames(2)
	DirAccess.make_dir_recursive_absolute(shots)
	root.get_texture().get_image().save_png(shots.path_join("techs_play_%s.png" % name))

# ---- input (as game/core/walls_playtest.gd) ---------------------------------------------

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

func _click(p: Vector2, button := MOUSE_BUTTON_LEFT) -> void:
	await _move(p)
	await _button(p, button, true)
	await _button(p, button, false)

func _box(points: Array) -> void:
	var lo := Vector2(1e9, 1e9)
	var hi := Vector2(-1e9, -1e9)
	for p in points:
		lo = lo.min(p)
		hi = hi.max(p)
	var a := lo - Vector2(25, 25)
	var b := hi + Vector2(25, 25)
	await _move(a)
	await _button(a, MOUSE_BUTTON_LEFT, true)
	for i in range(1, 7):
		await _move(a.lerp(b, i / 6.0), 1)
	await _frames(2)
	await _button(b, MOUSE_BUTTON_LEFT, false)
	await _frames(2)

func _key(k: Key, mods := {}) -> void:
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

func _on_screen(p: Vector2) -> bool:
	var r := root.get_visible_rect().grow(-40)
	return r.has_point(p) and p.y > r.size.y * 0.14 and p.y < r.size.y * 0.72

func _units(owner: int, type_name := "") -> Array:
	var u: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in int(u.count):
		if int(u.owner[i]) == owner and not (u.flags[i] & 2) and (type_name == "" or names[u.type[i]] == type_name):
			out.append({"id": u.ids[i], "x": u.pos[i * 2], "z": u.pos[i * 2 + 1]})
	return out

func _buildings(type_name: String) -> Array:
	var B: Dictionary = sim.get_buildings()
	var out := []
	for i in int(B.count):
		if int(B.owner[i]) == ME and B.type_names[B.type[i]] == type_name:
			out.append({"id": int(B.ids[i]), "tx": int(B.rect[i * 4]), "tz": int(B.rect[i * 4 + 1]), "w": int(B.rect[i * 4 + 2]), "h": int(B.rect[i * 4 + 3])})
	return out

func _res() -> Dictionary:
	var p: Dictionary = sim.get_player(ME)
	return {"food": float(p.food), "wood": float(p.wood), "gold": float(p.gold), "favor": float(p.favor)}

## the drawn command button whose command matches `pred` (centre in window px), or null
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

func _tech_cmd(key: String) -> Dictionary:
	return _cmd_find(func(c): return str(c.get("tech", "")) == key)

func _build_cmd(t: String) -> Dictionary:
	return _cmd_find(func(c): return str(c.get("action", "")) == "build" and str(c.get("arg", "")) == t)

## hover a command button: the tooltip ui shows for it
func _hover_cmd(pred: Callable) -> Dictionary:
	var p = _cmd_where(pred)
	if p == null:
		return {}
	await _move(p + Vector2(3, 2))
	await _frames(3)
	return ui.tooltip

## a zone of the selection card (id, arg) centre in window px, or null
func _card_zone(id: String, arg) -> Variant:
	for z in ui._back.zones:
		if z.id == id and str(z.arg) == str(arg):
			return ui._back.get_global_transform_with_canvas() * z.rect.get_center()
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

## a free lot for `type` near the Town Center, on screen, away from `avoid`
## lots: its tile and the screen point a click places it at (the ghost's tile
## is round(cursor - size / 2), so the click aims at the lot's centre)
func _lot(type: String, avoid: Array) -> Dictionary:
	var tc: Dictionary = _buildings("town_center")[0]
	var d: Dictionary = sim.get_building_def(type)
	var w := int(d.w)
	var h := int(d.h)
	var c := Vector2(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5)
	for r in range(7, 18):
		for k in 24:
			var a := TAU * k / 24.0
			var t := Vector2i(int(round(c.x + cos(a) * r - w * 0.5)), int(round(c.y + sin(a) * r - h * 0.5)))
			if not sim.can_place(type, t.x, t.y) or not sim.is_explored(t.x + 0.5, t.y + 0.5):
				continue
			var far := true
			for o in avoid:
				if absi(t.x - o.x) < 8 and absi(t.y - o.y) < 8:
					far = false
			if not far:
				continue
			var sp := _screen(t.x + w * 0.5, t.y + h * 0.5)
			if _on_screen(sp) and sim.units_near(t.x + w * 0.5, t.y + h * 0.5, maxf(w, h)).is_empty():
				return {"tile": t, "screen": sp}
	return {}

## a real left click on a building, on a footprint spot no unit covers (units
## win picks); retried, the sim runs between frames
func _select_building(id: int) -> bool:
	for attempt in 8:
		if ui.selected.size() == 1 and int(ui.selected[0]) == id:
			return true
		var b: Dictionary = sim.get_building(id)
		if b.is_empty():
			return false
		var d: Dictionary = sim.get_building_def(str(b.type))
		var w := float(d.w)
		var h := float(d.h)
		var x0 := float(b.x) - w * 0.5
		var z0 := float(b.z) - h * 0.5
		var hit = null
		var n := 6
		for k in n * n:
			var q := Vector2(x0 + (k % n + 0.5) / n * w, z0 + (k / n + 0.5) / n * h)
			var sp := _screen(q.x, q.y, 0.6)
			if _on_screen(sp) and ui.pick_entity(sp) == id:
				hit = sp
				break
		if hit == null:
			await _frames(4)
			continue
		await _click(hit)
		await _frames(4)
	return ui.selected.size() == 1 and int(ui.selected[0]) == id

## harness: the camera on a point (where a player would have scrolled to)
func _look(x: float, z: float) -> void:
	cam.target.x = x
	cam.target.z = z
	await _frames(6)

## place `type` with the selected villagers: `how` = "key" (its hotkey) or
## "click" (its build button), then a click on a free lot; the new foundation's id
func _place(type: String, how: String, avoid: Array) -> int:
	await _key(KEY_1)   # the builders (group 1)
	await _frames(4)
	var before := _buildings(type).size()
	var bc := _build_cmd(type)
	if bc.is_empty():
		_check("%s button in the build grid" % type, false)
		return 0
	if how == "key":
		await _key(OS.find_keycode_from_string(str(bc.key)))
	else:
		var p = _cmd_where(func(c): return str(c.get("action", "")) == "build" and str(c.get("arg", "")) == type)
		await _click(p)
	await _frames(3)
	var placing: bool = ui._mode.get("kind", "") == "place" and str(ui._mode.get("type", "")) == type
	var lot := _lot(type, avoid)
	if lot.is_empty() or not placing:
		_check("place %s (%s)" % [type, how], false, "placing %s, lot %s" % [placing, lot])
		return 0
	await _move(lot.screen)
	await _frames(3)
	await _click(lot.screen)
	await _frames(4)
	var list := _buildings(type)
	var id := 0
	for b in list:
		if Vector2i(b.tx, b.tz) == lot.tile:
			id = b.id
	_check("place %s (%s + a ground click)" % [type, how], list.size() == before + 1 and id > 0, "lot %s, id %d" % [lot.tile, id])
	avoid.append(lot.tile)
	return id

# ---- the playthrough -------------------------------------------------------------------

func _run() -> void:
	await _frames(12)
	_bind()
	if ui == null or sim == null:
		_check("scene with the ui piece", false)
		_finish()
		return
	# harness: no AI, resources for three buildings, an age and some research
	sim.set_ai_enabled(false)
	sim.set_player_resources(ME, {"food": 4000.0, "wood": 3000.0, "gold": 3000.0, "favor": 100.0})
	for i in 2:
		await _button(root.get_visible_rect().get_center(), MOUSE_BUTTON_WHEEL_DOWN, true)
	await _frames(30)
	var tc: Dictionary = _buildings("town_center")[0]
	await _look(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5 + 2.0)

	# 1. box select the villagers, Ctrl+1
	var vills := _units(ME, "villager")
	var pts := []
	for v in vills:
		pts.append(_screen(v.x, v.z, 0.8))
	await _box(pts)
	await _frames(3)
	_check("box select villagers", ui.selected.size() == vills.size() and vills.size() >= 4, "%d/%d" % [ui.selected.size(), vills.size()])
	await _key(KEY_1, {"ctrl": true})
	await _frames(6)

	# 2. the build grid: Armory (U), Market (K), greyed in the Archaic Age with the reason
	var ac := _build_cmd("armory")
	var mc := _build_cmd("market")
	_check("build grid has the Armory (U) and the Market (K)", str(ac.get("key", "")) == "U" and str(mc.get("key", "")) == "K",
		"%s / %s" % [ac.get("title", ""), mc.get("title", "")])
	var tip := await _hover_cmd(func(c): return str(c.get("arg", "")) == "armory")
	_check("Armory tooltip: name, cost, help, age lock", str(tip.get("title", "")) == "Build Armory" and tip.get("cost", {}) == {"wood": 150.0}
		and str(tip.get("warn", "")) == "Requires the Classical Age" and not Array(tip.get("lines", [])).is_empty() and not bool(ac.get("enabled", true)),
		"%s %s '%s'" % [tip.get("title", ""), tip.get("cost", {}), tip.get("warn", "")])
	await _click(_cmd_where(func(c): return str(c.get("arg", "")) == "armory"))
	await _frames(2)
	_check("Archaic Age: the Armory button refuses with its reason", ui.msg_text == "Requires the Classical Age" and ui._mode.is_empty(), "'%s'" % ui.msg_text)

	# 3. H + A: advance to the Classical Age at the Town Center
	await _key(KEY_H)
	await _frames(4)
	await _key(KEY_A)
	await _frames(2)
	var aged := await _step_until(240.0, func(): return int(sim.get_player(ME).age) >= 1)
	_check("H + A: the Classical Age", aged >= 0.0, "after %.0f s" % aged)
	await _look(tc.tx + tc.w * 0.5, tc.tz + tc.h * 0.5 + 2.0)

	# 4. Temple (R), Armory (button), Market (K): placed by input, built by the villagers
	var lots := []
	var ids := {}
	for step in [["temple", "key"], ["armory", "click"], ["market", "key"]]:
		var id := await _place(step[0], step[1], lots)
		ids[step[0]] = id
		if id == 0:
			continue
		var built := await _step_until(400.0, func(): var b: Dictionary = sim.get_building(id); return not b.is_empty() and bool(b.built))
		_check("villagers build the %s" % step[0], built >= 0.0, "in %.0f s" % built)
	await _shot("buildings")
	if ids.get("armory", 0) == 0 or ids.get("temple", 0) == 0 or ids.get("market", 0) == 0:
		_finish()
		return

	# harness: a hoplite and a hero to measure the techs on (away from the town)
	var hop := int(sim.spawn_unit("hoplite", ME, tc.tx - 6.0, tc.tz - 6.0, 0.0))
	var hero := int(sim.spawn_unit("hero", ME, tc.tx - 7.0, tc.tz - 6.0, 0.0))
	var hop0: Dictionary = sim.get_unit_stats(hop)
	var hero0: Dictionary = sim.get_unit_stats(hero)

	# 5. the Armory's tech buttons
	var arm: int = ids.armory
	var ab: Dictionary = sim.get_building(arm)
	await _look(float(ab.x), float(ab.z) + 3.0)
	var sel_ok := await _select_building(arm)
	await _frames(6)
	_check("click selects the Armory", sel_ok)
	var cw := _tech_cmd("copper_weapons")
	var bp := _tech_cmd("burning_pitch")
	var gods: Array = ui.commands.filter(func(c): return c != null and str(c.get("frame", "")) == "purple")
	_check("Armory grid: Copper Weapons on Q (gold frame), Burning Pitch greyed, god techs in purple, no Bronze yet",
		str(cw.get("key", "")) == "Q" and bool(cw.get("enabled", false)) and str(cw.get("frame", "")) == "gold" and ui.commands[0] == cw
		and not bp.is_empty() and not bool(bp.enabled) and str(bp.warn) == "Requires Mythic Age"
		and gods.size() >= 4 and _tech_cmd("bronze_weapons").is_empty(),
		"Q=%s, pitch '%s', %d god techs" % [cw.get("title", ""), bp.get("warn", ""), gods.size()])
	# the state language: available / locked by age (the numeral badge) / god techs' emblems
	_check("button states: Copper Weapons 'available', Burning Pitch 'locked' by the Mythic Age, god techs carry their god",
		str(cw.get("state", "")) == "available" and str(bp.get("state", "")) == "locked" and int(bp.get("age_req", -1)) == 3
		and str(Dictionary(bp.get("status", {})).get("text", "")) == "Locked · Requires Mythic Age"
		and int(cw.get("tier", 0)) == 1 and gods.all(func(c): return str(c.get("god", "")) != "" and ["available", "unaffordable", "locked"].has(str(c.get("state", "")))),
		"%s / %s %s" % [cw.get("state", ""), bp.get("state", ""), bp.get("status", {})])
	# unaffordable (harness: the favor taken away): a red-washed button, the missing resource and the words
	var fav0 := float(_res().favor)
	sim.set_player_resources(ME, {"favor": 0.0})
	await _frames(14)
	var fg = ui.commands.filter(func(c): return c != null and str(c.get("frame", "")) == "purple" and float(Dictionary(c.get("cost", {})).get("favor", 0.0)) > 0.0)
	var fc: Dictionary = fg[0] if not fg.is_empty() else {}
	_check("unaffordable: a god tech without favor is 'unaffordable', short of favor, the tooltip says what is missing",
		str(fc.get("state", "")) == "unaffordable" and Array(fc.get("short", [])).has("favor") and not bool(fc.get("enabled", true))
		and str(Dictionary(fc.get("status", {})).get("text", "")).begins_with("Can't afford · Need ") and str(fc.status.text).contains("more favor"),
		"%s: %s %s" % [fc.get("title", "?"), fc.get("state", ""), fc.get("status", {})])
	sim.set_player_resources(ME, {"favor": fav0})
	await _frames(14)
	tip = await _hover_cmd(func(c): return str(c.get("tech", "")) == "copper_weapons")
	_check("tech tooltip: name, cost, time, effect, per-class bullets", str(tip.get("title", "")) == "Copper Weapons" and tip.get("cost", {}) == {"food": 100.0, "gold": 100.0}
		and int(tip.get("time", 0)) == 30 and str(Array(tip.get("lines", [""]))[0]).contains("+10% attack") and Array(tip.get("bullets", [])).has("Human Soldier: Attack +10%"),
		"%s %s %ss %s" % [tip.get("title", ""), tip.get("cost", {}), tip.get("time", 0), tip.get("bullets", [])])
	await _shot("armory_tooltip")

	# 6. a click on Copper Weapons: paid, in the card's queue, its button "researching"
	var r0 := _res()
	await _click(_cmd_where(func(c): return str(c.get("tech", "")) == "copper_weapons"))
	await _frames(6)
	var r1 := _res()
	var q: Array = ui.info.get("queue", [])
	var cwr := _tech_cmd("copper_weapons")
	_check("click Copper Weapons: paid 100 food + 100 gold, queued on the card, its button 'researching' (not buyable)",
		is_equal_approx(r0.food - r1.food, 100.0) and is_equal_approx(r0.gold - r1.gold, 100.0)
		and q.size() >= 1 and str(q[0].get("tech", "")) == "copper_weapons"
		and str(cwr.get("state", "")) == "researching" and not bool(cwr.get("enabled", true)) and str(cwr.get("key", "")) == "Q"
		and str(Dictionary(cwr.get("status", {})).get("text", "")).begins_with("Researching · "),
		"paid %.0f / %.0f, queue %s" % [r0.food - r1.food, r0.gold - r1.gold, q.map(func(e): return e.get("tech", e.get("name", "")))])
	# W: Copper Armor queued; a click on its queue icon cancels it (exact refund)
	var ca := _tech_cmd("copper_armor")
	var r2 := _res()
	# Q again on the researching button: refused, nothing paid twice
	await _key(KEY_Q)
	await _frames(4)
	var rq := _res()
	_check("Q on the researching Copper Weapons: refused, nothing paid", is_equal_approx(rq.food, r1.food) and is_equal_approx(rq.gold, r1.gold)
		and sim.get_research(arm).filter(func(e): return str(e.key) == "copper_weapons").size() == 1, "food %.0f -> %.0f" % [r1.food, rq.food])
	await _key(OS.find_keycode_from_string(str(ca.get("key", "W"))))
	await _frames(6)
	var queued: bool = sim.get_research(arm).any(func(e): return str(e.key) == "copper_armor")
	var caq := _tech_cmd("copper_armor")
	_check("Copper Armor's button: 'queued', 2nd in the queue", str(caq.get("state", "")) == "queued" and int(caq.get("count", 0)) == 2
		and str(Dictionary(caq.get("status", {})).get("text", "")).begins_with("Queued · 2nd in the queue"), "%s %s" % [caq.get("state", ""), caq.get("status", {})])
	var qp = _card_zone("rqueue", "copper_armor")
	if qp != null:
		await _click(qp)
		await _frames(6)
	var r3 := _res()
	_check("%s queues Copper Armor, a click on its queue icon cancels it (refund)" % str(ca.get("key", "?")),
		queued and qp != null and not sim.get_research(arm).any(func(e): return str(e.key) == "copper_armor")
		and is_equal_approx(r3.food, r2.food) and is_equal_approx(r3.gold, r2.gold),
		"queued %s, icon %s, food %.0f -> %.0f" % [queued, qp != null, r2.food, r3.food])
	await _shot("armory_queue")
	var done_t := await _step_until(60.0, func(): return Array(sim.get_player_techs(ME).done).has("copper_weapons"))
	await _frames(8)
	var hop1: Dictionary = sim.get_unit_stats(hop)
	var fed: bool = ui.feed_items.any(func(f): return str(f.text) == "Copper Weapons researched.")
	_check("Copper Weapons researched: feed notice, hoplite damage x1.1", done_t >= 0.0 and fed and is_equal_approx(float(hop1.damage), float(hop0.damage) * 1.1),
		"%.0f s, damage %.2f -> %.2f, feed %s" % [done_t, float(hop0.damage), float(hop1.damage), fed])
	var bw := _tech_cmd("bronze_weapons")
	var dts: Array = ui.info.get("done_techs", [])
	_check("next tier: Bronze Weapons on Q, 'locked' by the Heroic Age; Copper Weapons off the grid, under Researched",
		ui.commands[0] == bw and not bw.is_empty() and not bool(bw.enabled) and str(bw.warn) == "Requires Heroic Age"
		and str(bw.get("state", "")) == "locked" and int(bw.get("age_req", -1)) == 2 and int(bw.get("tier", 0)) == 2
		and _tech_cmd("copper_weapons").is_empty() and dts.any(func(e): return str(e.tech) == "copper_weapons"),
		"Q=%s '%s', researched %s" % [bw.get("title", ""), bw.get("warn", ""), dts.map(func(e): return e.tech)])
	await _shot("armory_done")
	# locked by a prerequisite (the padlock, no age numeral): in the Heroic Age,
	# with Copper Shields under way, Bronze Shields shows greyed and padlocked,
	# "Requires Copper Shields", after the buyable buttons
	var age0 := int(ui.player.get("age", 1))
	sim.set_player_age(ME, 2)
	var cs_ok := bool(Dictionary(sim.research(arm, "copper_shields")).get("ok", false))
	await _frames(14)
	var bsh := _tech_cmd("bronze_shields")
	_check("padlock: Bronze Shields 'locked' by its prerequisite while Copper Shields researches (no age badge), the tooltip says why",
		cs_ok and str(bsh.get("state", "")) == "locked" and not bsh.has("age_req") and not bool(bsh.get("enabled", true))
		and str(Dictionary(bsh.get("status", {})).get("text", "")) == "Locked · Requires Copper Shields"
		and str(_tech_cmd("copper_shields").get("state", "")) == "researching",
		"research %s, bronze shields %s %s" % [cs_ok, bsh.get("state", "?"), bsh.get("status", {})])
	sim.cancel_research(arm, "copper_shields")
	sim.set_player_age(ME, age0)
	await _frames(14)

	# 7. the Temple: a click selects it, the hotkey of Olympian Parentage researches it
	var tb: Dictionary = sim.get_building(ids.temple)
	await _look(float(tb.x), float(tb.z) + 3.0)
	sel_ok = await _select_building(ids.temple)
	await _frames(6)
	var op := _tech_cmd("olympian_parentage")
	_check("click selects the Temple: its tech buttons with hotkeys", sel_ok and not op.is_empty() and str(op.key) != "" and bool(op.enabled)
		and str(op.frame) == "purple", "Olympian Parentage on %s" % op.get("key", "?"))
	# a locked train button (a myth unit of a later age): its portrait greyed, not
	# only darkened (the same locked language as a tech tile: the slate grey keeps
	# HSV saturation ~0.15-0.2 in its dark pixels, a colour portrait is ~0.55)
	var lt: Dictionary = {}
	for c in ui.commands:
		if c != null and str(c.get("action", "")) == "train" and str(c.get("state", "")) == "locked" and c.get("tex") != null:
			lt = c
			break
	var grey: Texture2D = null
	for k in 10:
		grey = load("res://game/ui/hud.gd").locked_portrait(lt.tex) if not lt.is_empty() else null
		if grey:
			break
		await _frames(1)
	var sat_of := func(img: Image) -> float:
		var tot := 0.0
		var n := 0
		for y in range(0, img.get_height(), 2):
			for x in range(0, img.get_width(), 2):
				var px := img.get_pixel(x, y)
				if px.a > 0.5:
					tot += px.s
					n += 1
		return tot / maxf(1.0, n)
	var s0: float = sat_of.call(lt.tex.get_image()) if not lt.is_empty() else -1.0
	var s1: float = sat_of.call(grey.get_image()) if grey else -1.0
	_check("a locked train button: its portrait greyed (saturation), the tooltip opens with the state",
		not lt.is_empty() and grey != null and s1 >= 0.0 and s1 < 0.22 and s0 > s1 + 0.25
		and str(Dictionary(lt.get("status", {})).get("text", "")).begins_with("Locked · Requires the "),
		"%s: saturation %.2f -> %.2f, '%s'" % [lt.get("title", "?"), s0, s1, Dictionary(lt.get("status", {})).get("text", "")])
	var r4 := _res()
	if not op.is_empty():
		await _key(OS.find_keycode_from_string(str(op.key)))
		await _frames(4)
	var r5 := _res()
	var tq: Array = ui.info.get("queue", [])
	_check("its hotkey queues Olympian Parentage (100 food, 10 favor)", is_equal_approx(r4.food - r5.food, 100.0) and is_equal_approx(r4.favor - r5.favor, 10.0)
		and tq.any(func(e): return str(e.get("tech", "")) == "olympian_parentage"), "paid %.0f food %.0f favor" % [r4.food - r5.food, r4.favor - r5.favor])
	done_t = await _step_until(80.0, func(): return Array(sim.get_player_techs(ME).done).has("olympian_parentage"))
	var hero1: Dictionary = sim.get_unit_stats(hero)
	_check("Olympian Parentage researched: the hero's hp x1.25", done_t >= 0.0 and is_equal_approx(float(hero1.max_hp), float(hero0.max_hp) * 1.25),
		"%.0f s, max hp %.0f -> %.0f" % [done_t, float(hero0.max_hp), float(hero1.max_hp)])

	# 8. the Market: rates on the card, Buy Food by a click, Sell Food by S
	var mb: Dictionary = sim.get_building(ids.market)
	await _look(float(mb.x), float(mb.z) + 3.0)
	sel_ok = await _select_building(ids.market)
	await _frames(6)
	var M0: Dictionary = sim.get_market(ME)
	var buy := _cmd_find(func(c): return str(c.get("trade", "")) == "food" and str(c.get("dir", "")) == "buy")
	var sell := _cmd_find(func(c): return str(c.get("trade", "")) == "food" and str(c.get("dir", "")) == "sell")
	_check("click selects the Market: its rates on the card, buy / sell buttons with the live price",
		sel_ok and ui.info.has("market") and str(buy.get("label", "")) == str(int(M0.food.buy)) and str(sell.get("label", "")) == str(int(M0.food.sell)) and str(sell.get("key", "")) == "S",
		"buy %s (%s) sell %s (%s)" % [buy.get("label", ""), buy.get("key", ""), sell.get("label", ""), sell.get("key", "")])
	await _shot("market")
	var r6 := _res()
	await _click(_cmd_where(func(c): return str(c.get("trade", "")) == "food" and str(c.get("dir", "")) == "buy"))
	await _frames(6)
	var r7 := _res()
	var M1: Dictionary = sim.get_market(ME)
	var buy2 := _cmd_find(func(c): return str(c.get("trade", "")) == "food" and str(c.get("dir", "")) == "buy")
	_check("click Buy Food: +100 food for the shown price, the price rises, the label follows",
		is_equal_approx(r7.food - r6.food, 100.0) and is_equal_approx(r6.gold - r7.gold, float(M0.food.buy)) and float(M1.food.price) > float(M0.food.price)
		and str(buy2.get("label", "")) == str(int(M1.food.buy)),
		"food +%.0f, gold -%.0f, price %.0f -> %.0f, label %s" % [r7.food - r6.food, r6.gold - r7.gold, float(M0.food.price), float(M1.food.price), buy2.get("label", "")])
	await _key(KEY_S)
	await _frames(6)
	var r8 := _res()
	var M2: Dictionary = sim.get_market(ME)
	_check("S sells 100 food for the shown price, the price falls", is_equal_approx(r7.food - r8.food, 100.0) and is_equal_approx(r8.gold - r7.gold, float(M1.food.sell))
		and float(M2.food.price) < float(M1.food.price), "food -%.0f, gold +%.0f, price %.0f -> %.0f" % [r7.food - r8.food, r8.gold - r7.gold, float(M1.food.price), float(M2.food.price)])
	await _shot("market_trade")
	_finish()

func _finish() -> void:
	result["passes"] = passes
	result["fails"] = fails
	print("TECHSPLAY_RESULT %s" % JSON.stringify(result))
	print("TECHSPLAY %s (%d ok, %d failed)" % ["ok" if fails.is_empty() else "FAIL", passes, fails.size()])
	quit(fails.size())
