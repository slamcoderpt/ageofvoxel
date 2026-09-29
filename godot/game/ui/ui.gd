extends Node
## UI piece: HUD, selection and input (port of src/ui/: index.js,
## CommandPanel.js, Selection.js, Minimap.js). Public API for other pieces:
##
##   pieces.ui.selected        Array of selected entity ids (read only)
##   pieces.ui.hover_entity    id under the cursor (0 = none)
##   pieces.ui.message(text)   centre-top notice
##   pieces.ui.feed(text, gold=false)   event feed notice (top left)
##
## Layout: a CanvasLayer scaled from the browser's 1920x1080 CSS px holds the
## shader panels (panel.gdshader), the "back" HUD layer (hud.gd), the minimap
## (minimap.gd) and the "front" HUD layer. Portraits come from portraits.gd
## (one SubViewport rendered once per unit / building type and owner).
##
## Cost per frame with nothing selected: a few Dictionary reads; stats (the
## villager counts per resource, idle villagers / soldiers, scores) walk the
## unit arrays twice a second; the minimap refreshes 5 times a second with
## no per-unit script work; selection rings and bars touch only selected units.

const S := preload("res://game/ui/hud_style.gd")
const Hud := preload("res://game/ui/hud.gd")
const Minimap := preload("res://game/ui/minimap.gd")
const Portraits := preload("res://game/ui/portraits.gd")
const PerfMeter := preload("res://game/ui/perf_meter.gd")
const Settings := preload("res://game/ui/settings.gd")

const AGES := ["Archaic", "Classical", "Heroic", "Mythic"]
const ROMAN := ["I", "II", "III", "IV"]
const BUILD_MENU := ["house", "farm", "storehouse", "temple", "barracks", "town_center"]
const ORDER_NAMES := {1: "Moving", 2: "Gathering", 3: "Returning", 4: "Worshipping", 5: "Building", 6: "Attacking"}
const RES_NAMES := ["food", "wood", "gold"]
const POWER_ICONS := {"lightning_storm": "storm", "bolt": "bolt", "meteor": "meteor"}
const HEIGHT := {"villager": 2.0, "hoplite": 2.25, "toxotes": 2.05, "hippikon": 2.75, "minotaur": 3.4, "hero": 3.7, "cyclops": 5.0, "centaur": 2.9, "medusa": 2.6}

var game: Node = null
var sim: Object = null
var me := 1

# ---- public state -----------------------------------------------------------
var selected: Array = []
var hover_entity := 0
var groups := {}                 # "1".."0" -> Array of ids

# ---- HUD state read by hud.gd -------------------------------------------------
var hud_visible := true
var hud_state := {}
var player := {}
var powers: Array = []
var commands: Array = []
var info := {}
var feed_items: Array = []
var tooltip := {}
var hover_id := ""
var mouse_down := false
var msg_text := ""
var msg_alpha := 0.0
var menu_open := false
var user_paused := false
var scores_visible := true
var result := {}
var result_shown := false
var minimap: Node2D

var _layer: CanvasLayer
var _root: Control
var _back: Control
var _front: Control
var _perf: Control                # F3 meter (perf_meter.gd)
var _world: Control              # selection box + bars under the HUD
var _panels: Array = []
var _portraits: Node
var _names: PackedStringArray
var _defs := {}                  # unit type key -> def
var _bdefs := {}                 # building type key -> def
var _pdefs := {}                 # power key -> def
var _stat_t := 0.0
var _hud_t := 0.0
var _msg_t := 0.0
var _cmd_sig := ""
var _first := true
var _scale := 1.0
var _fog_on := false
var _mode := {}                  # {} | {kind: "power", id} | {kind: "place", type, builders}
var _ghost: MeshInstance3D
var _ghost_ok := false
var _ghost_tile := Vector2i.ZERO
var _range_ring: MeshInstance3D
var _rings: MultiMeshInstance3D
var _markers: Array = []         # [{mi, t}]
var _drag := {}                  # {start, shift, active}
var _mouse := Vector2.ZERO
var _last_click := {"t": 0, "id": 0}
var _last_group := {"k": "", "t": 0}
var _idle_idx := -1
var _view_t := 0.0
var _units_cache := {}
var _units_frame := -1

# ================================================================================
# setup

func setup(g: Node) -> void:
	game = g
	sim = g.sim
	_names = sim.unit_type_names()
	for n in _names:
		_defs[n] = sim.get_unit_def(n)
	for n in sim.building_type_names():
		_bdefs[n] = sim.get_building_def(n)
	for n in sim.power_names():
		_pdefs[n] = sim.get_power_def(n)
	hud_visible = AovArgs.flag(g.args, "hud", bool(g.scene_def.get("hud", false)))
	_fog_on = AovArgs.flag(g.args, "fog", not bool(g.scene_def.get("reveal_all", false)))
	# interactive play: formation moves share one path field (PORTING.md);
	# deterministic captures keep the browser-exact per-unit paths
	if not g.args.has("out") and not AovArgs.flag(g.args, "quit", false):
		sim.set_group_paths(24)

	_portraits = Portraits.new()
	_portraits.name = "Portraits"
	_portraits.sim = sim
	add_child(_portraits)

	_layer = CanvasLayer.new()
	_layer.layer = 10
	add_child(_layer)
	_root = Control.new()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_root)
	_world = _WorldOverlay.new()
	_world.ui = self
	_world.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_world)
	_back = Hud.new()
	_back.ui = self
	_back.layer = "back"
	_back.mouse_filter = Control.MOUSE_FILTER_STOP
	for spec in _back.panel_specs():
		var cr := ColorRect.new()
		cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var m := ShaderMaterial.new()
		m.shader = preload("res://game/ui/panel.gdshader")
		cr.material = m
		_root.add_child(cr)
		_panels.append({"node": cr, "name": spec.name})
	_root.add_child(_back)
	minimap = Minimap.new()
	minimap.name = "Minimap"
	minimap.local_player = me
	minimap.fog_on = _fog_on
	_root.add_child(minimap)
	minimap.setup(g)
	_front = Hud.new()
	_front.ui = self
	_front.layer = "front"
	_front.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_child(_front)
	_perf = PerfMeter.new()
	_perf.name = "PerfMeter"
	_root.add_child(_perf)
	_perf.setup(g)
	_layout()
	get_viewport().size_changed.connect(_layout)

	# selection rings: one MultiMesh, instances = selected units only
	_rings = MultiMeshInstance3D.new()
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = _ring_mesh(0.8, 1.0, 40)
	mm.instance_count = 64
	mm.visible_instance_count = 0
	_rings.multimesh = mm
	_rings.material_override = _flat_material(Color.WHITE, true)
	_rings.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_rings.custom_aabb = AABB(Vector3(-1e4, -100, -1e4), Vector3(2e4, 400, 2e4))
	add_child(_rings)
	_range_ring = MeshInstance3D.new()
	_range_ring.mesh = _ring_mesh(0.94, 1.0, 64)
	_range_ring.material_override = _flat_material(Color(0.62, 0.85, 1.0, 0.75), false)
	_range_ring.visible = false
	_range_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_range_ring)
	_set_hud_visible(hud_visible)
	_refresh_all()

func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	_scale = clampf(vs.y / 1080.0, 0.7, 2.0)
	_layer.transform = Transform2D().scaled(Vector2(_scale, _scale))
	var css := vs / _scale
	for c in [_root, _world, _back, _front, _perf]:
		c.position = Vector2.ZERO
		c.size = css
	var specs: Array = _back.panel_specs()
	for i in specs.size():
		var spec: Dictionary = specs[i]
		var cr: ColorRect = _panels[i].node
		var margin := 24.0
		var r: Rect2 = spec.rect
		cr.position = r.position - Vector2(margin, margin)
		cr.size = r.size + Vector2(margin, margin) * 2.0
		var m: ShaderMaterial = cr.material
		m.set_shader_parameter("size", r.size)
		m.set_shader_parameter("margin", margin)
		m.set_shader_parameter("chamfer", spec.chamfer)
		m.set_shader_parameter("border", spec.border)
		m.set_shader_parameter("frame", spec.get("frame", 1.0))
		var sh: Vector3 = spec.shadow
		m.set_shader_parameter("shadow_offset", Vector2(0, sh.x))
		m.set_shader_parameter("shadow_blur", sh.y)
		m.set_shader_parameter("shadow_alpha", sh.z)
		for k in spec.style:
			m.set_shader_parameter(k, spec.style[k])
	minimap.position = _back.dia_center()
	minimap.scale = Vector2.ONE * (190.0 / float(minimap.N))
	minimap.px = 190.0
	_redraw()

func _set_hud_visible(v: bool) -> void:
	hud_visible = v
	for p in _panels:
		p.node.visible = v
	minimap.visible = v
	_redraw()

static func _ring_mesh(r0: float, r1: float, n: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var idx := PackedInt32Array()
	for i in n:
		var a := TAU * float(i) / float(n)
		v.push_back(Vector3(cos(a) * r0, 0, sin(a) * r0))
		v.push_back(Vector3(cos(a) * r1, 0, sin(a) * r1))
	for i in n:
		var j := (i + 1) % n
		idx.append_array([i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

static func _flat_material(c: Color, vertex_color: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.albedo_color = c
	m.vertex_color_use_as_albedo = vertex_color
	m.no_depth_test = false
	m.render_priority = 2
	return m

# ================================================================================
# per frame

func frame(dt: float, alpha: float) -> void:
	_frame(dt, alpha)

func _frame(dt: float, alpha: float) -> void:
	if _first:
		_first = false
		_apply_scene_ctx()
	_handle_events(game.events)
	_prune_selection()
	_update_rings(alpha)
	_update_markers(dt)
	_update_ghost()
	if _msg_t > 0.0:
		_msg_t -= dt
		msg_alpha = clampf(_msg_t / 0.4, 0.0, 1.0)
		_front.queue_redraw()
	if not hud_visible:
		_world.queue_redraw()
		return
	_stat_t -= dt
	if _stat_t <= 0.0:
		_stat_t = 0.5
		_refresh_stats()
	_hud_t -= dt
	var sig := _selection_sig()
	if _hud_t <= 0.0 or sig != _cmd_sig:
		_hud_t = 0.2
		_refresh_hud(sig)
	minimap.rotation = game.camera.yaw
	minimap.refresh(dt)
	_view_t -= dt
	if _view_t <= 0.0:
		_view_t = 0.05
		minimap.set_view(_view_corners())
	_world.queue_redraw()

## The hud scene's after(): control groups and the selected villager.
func _apply_scene_ctx() -> void:
	var ctx: Dictionary = game.ctx
	if str(game.scene_def.get("name", "")) == "hud":
		if ctx.has("army"): groups["1"] = Array(ctx.army)
		if ctx.has("villagers"): groups["2"] = Array(ctx.villagers).slice(0, 6)
		if ctx.has("tc"): groups["3"] = [ctx.tc]
	if ctx.has("select") and hud_visible:
		set_selection(Array(ctx.select))

func _refresh_all() -> void:
	_refresh_stats()
	_refresh_hud(_selection_sig())

func _redraw() -> void:
	if _back:
		_back.queue_redraw()
		_front.queue_redraw()

## Units arrays, fetched at most once per frame.
func units() -> Dictionary:
	var f := Engine.get_process_frames() * 100003 + int(sim.get_tick())
	if f != _units_frame:
		_units_frame = f
		_units_cache = sim.get_units()
	return _units_cache

# ---- events -------------------------------------------------------------------

func _handle_events(events: Array) -> void:
	if events.is_empty():
		return
	minimap.on_events(events)
	var t := float(sim.get_time())
	var batch := []
	for e in events:
		match str(e.type):
			"building:completed":
				if int(e.owner) == me and t > 0.0:
					var b: Dictionary = sim.get_building(e.id)
					if not b.is_empty():
						batch.append(["%s built." % _bdefs.get(b.type, {}).get("name", b.type), false])
			"unit:trained":
				if int(e.owner) == me and t > 0.0:
					var u: Dictionary = sim.get_unit(e.id)
					if not u.is_empty():
						batch.append(["%s trained." % _defs.get(u.type, {}).get("name", u.type), false])
			"villager:free":
				if int(e.owner) == me:
					batch.append(["Your Town Center calls a new villager.", true])
			"age:advanced":
				if int(e.owner) == me:
					batch.append(["You reached the %s Age!" % AGES[clampi(int(e.a), 0, 3)], true])
			"godpower:cast":
				if int(e.owner) == me:
					var pn: String = sim.power_names()[clampi(int(e.a), 0, 2)]
					batch.append(["You use the %s God Power!" % _pdefs[pn].name, true])
			"game:over":
				_show_result(int(e.owner), float(e.amount))
	# notices from a fast-forward arrive together: keep the latest of a kind
	# (the older ones would already have faded, as in the browser)
	if batch.size() > 1 and game.get("_frames") != null and int(game._frames) <= 1:
		batch = [batch[batch.size() - 1]]
	for b in batch:
		feed(b[0], b[1])

func feed(text: String, gold := false) -> void:
	feed_items.append({"text": text, "gold": gold, "t": float(sim.get_time()), "alpha": 1.0})
	while feed_items.size() > 4:
		feed_items.pop_front()
	_front.queue_redraw()

func message(text: String) -> void:
	if text == "":
		return
	msg_text = text
	_msg_t = 2.2
	msg_alpha = 1.0
	_front.queue_redraw()

func _show_result(winner: int, time: float) -> void:
	if not result.is_empty():
		return
	var s := int(time)
	var p: Dictionary = sim.get_player(me)
	var won := winner == me
	result = {"won": won, "kicker": "%s  ·  %s Age  ·  %02d:%02d" % [p.get("god", "Zeus"), AGES[clampi(int(p.get("age", 0)), 0, 3)], s / 60, s % 60],
		"text": "The enemy Town Center has fallen." if won else "Your last Town Center has fallen."}
	result_shown = true
	_mode = {}
	_redraw()

# ---- stats (twice a second) -------------------------------------------------------

func _refresh_stats() -> void:
	var u := units()
	var n := int(u.count)
	var owner: PackedByteArray = u.owner if u.owner is PackedByteArray else PackedByteArray(u.owner)
	var order: PackedByteArray = u.order
	var flags: PackedByteArray = u.flags
	var task: PackedByteArray = u.task
	var type: PackedByteArray = u.type
	var counts := [0, 0, 0, 0]
	var idle := 0
	var army := 0
	var score := {}
	var pops := []
	var gath := []
	var mil := []
	for k in _names:
		var d: Dictionary = _defs[k]
		pops.append(int(d.get("pop", 1)) * 10)
		gath.append(bool(d.get("gatherer", false)))
		mil.append(not bool(d.get("gatherer", false)) and float(d.attack.get("damage", 0)) > 0)
	var score_arr := PackedInt32Array()
	score_arr.resize(9)
	for i in n:
		if flags[i] & 2:
			continue
		var o := owner[i]
		var ty := type[i]
		score_arr[o] += pops[ty]
		if o != me:
			continue
		var ot := order[i]
		if ot == 2 or ot == 3:
			var tk := task[i]
			if tk < 3:
				counts[tk] += 1
		elif ot == 4:
			counts[3] += 1
		elif ot == 0:
			if gath[ty]:
				idle += 1
			elif mil[ty]:
				army += 1
	var B: Dictionary = sim.get_buildings()
	var bo = B.owner
	var built = B.built
	for i in int(B.count):
		if built[i]:
			score_arr[int(bo[i])] += 25
	player = sim.get_player(me)
	hud_state["n_food"] = counts[0]
	hud_state["n_wood"] = counts[1]
	hud_state["n_gold"] = counts[2]
	hud_state["n_favor"] = counts[3]
	hud_state["idle"] = idle
	hud_state["army"] = army
	var rows := []
	for pid in sim.get_player_ids():
		if int(pid) == 0:
			continue
		var p: Dictionary = sim.get_player(pid)
		if p.is_empty():
			continue
		rows.append({"id": int(pid), "name": "You" if int(pid) == me else str(p.name), "god": str(p.god), "color": S.hex(int(p.color)),
			"age": ROMAN[clampi(int(p.age), 0, 3)], "score": score_arr[int(pid)] + int(p.age) * 100})
	hud_state["scores"] = rows
	# control group cards
	var gl := []
	for k in ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]:
		var ids: Array = _alive(groups.get(k, []))
		groups[k] = ids
		if ids.is_empty():
			continue
		var tally := {}
		var first := {}
		for id in ids:
			var key := _type_key(id)
			tally[key] = tally.get(key, 0) + 1
			if not first.has(key): first[key] = id
		var best := ""
		for key in tally:
			if best == "" or tally[key] > tally[best]:
				best = key
		var parts := best.split(":")
		var tex: Texture2D = _portraits.unit(parts[1], me) if parts[0] == "u" else _portraits.building(parts[1], me)
		var nm: String = (_defs if parts[0] == "u" else _bdefs).get(parts[1], {}).get("name", parts[1])
		gl.append({"key": k, "count": ids.size(), "tex": tex, "name": nm})
	hud_state["groups"] = gl
	# feed fade: notices fade after ~14 s of game time
	var t := float(sim.get_time())
	var keep := []
	for f in feed_items:
		var age := t - float(f.t)
		if age > 14.0:
			continue
		f.alpha = clampf((14.0 - age) / 3.0, 0.0, 1.0) if age > 11.0 else 1.0
		keep.append(f)
	feed_items = keep
	_redraw()

func _type_key(id: int) -> String:
	var k := int(sim.entity_kind(id))
	if k == 1:
		return "u:" + str(sim.get_unit(id).get("type", "villager"))
	if k == 2:
		return "b:" + str(sim.get_building(id).get("type", "house"))
	return "r:?"

func _alive(ids: Array) -> Array:
	var out := []
	for id in ids:
		var k := int(sim.entity_kind(id))
		if k == 1:
			var d: Dictionary = sim.get_unit(id)
			if d.is_empty() or bool(d.get("dead", false)):
				continue
		elif k == 0:
			continue
		out.append(id)
	return out

# ---- HUD state (5 times a second, or on selection change) -------------------------------

func game_paused() -> bool:
	return bool(game.paused)

func time_scale_fast() -> bool:
	return float(game.time_scale) > 1.0

func minimap_rotation() -> float:
	return game.camera.yaw if game and game.camera else PI * 0.25

func _selection_sig() -> String:
	var s := ""
	for id in selected:
		s += str(id) + ","
	player = sim.get_player(me)
	return s + "|%d|%s" % [int(player.get("age", 0)), player.get("advancing", false)]

func _refresh_hud(sig: String) -> void:
	player = sim.get_player(me)
	var p := player
	hud_state["food"] = floor(float(p.get("food", 0)))
	hud_state["wood"] = floor(float(p.get("wood", 0)))
	hud_state["gold"] = floor(float(p.get("gold", 0)))
	hud_state["favor"] = floor(float(p.get("favor", 0)))
	hud_state["pop"] = int(p.get("pop", 0))
	hud_state["pop_cap"] = int(p.get("pop_cap", 0))
	var age := int(p.get("age", 0))
	hud_state["roman"] = ROMAN[clampi(age, 0, 3)]
	hud_state["next_age"] = AGES[age + 1] if age + 1 < AGES.size() else ""
	hud_state["adv"] = float(p.advance_t) / maxf(0.001, float(p.advance_total)) if bool(p.get("advancing", false)) else 0.0
	var s := int(floor(float(sim.get_time())))
	hud_state["clock"] = "%02d:%02d" % [s / 60, s % 60]
	# god powers
	powers = []
	for k in sim.power_names():
		var def: Dictionary = _pdefs[k]
		var cc: Dictionary = sim.can_cast(me, k)
		var left := float(sim.power_cooldown(me, k))
		powers.append({"key": k, "def": def, "icon": POWER_ICONS.get(k, "bolt"), "can": bool(cc.ok), "reason": str(cc.reason),
			"cd": clampf(left / maxf(0.001, float(def.cooldown)), 0.0, 1.0), "cd_left": left,
			"active": _mode.get("kind", "") == "power" and _mode.get("id", "") == k})
	if sig != _cmd_sig:
		_cmd_sig = sig
	commands = _commands_for()
	info = _info_for()
	_redraw()

func _can_afford(cost: Dictionary) -> bool:
	for k in cost:
		if float(player.get(k, 0.0)) < float(cost[k]):
			return false
	return true

func _sel_entities() -> Array:
	var out := []
	for id in selected:
		var k := int(sim.entity_kind(id))
		if k == 1:
			var d: Dictionary = sim.get_unit(id)
			if not d.is_empty() and not d.dead:
				d["kind"] = "unit"
				out.append(d)
		elif k == 2:
			var b: Dictionary = sim.get_building(id)
			if not b.is_empty():
				b["kind"] = "building"
				out.append(b)
		elif k == 3:
			out.append({"kind": "resource", "id": id})
	return out

func _commands_for() -> Array:
	var slots := []
	slots.resize(15)
	var sel := _sel_entities()
	if sel.is_empty() or int(sel[0].get("owner", 0)) != me:
		return slots
	var list := []
	var us := sel.filter(func(e): return e.kind == "unit")
	var age := int(player.get("age", 0))
	if not us.is_empty():
		var builders := us.filter(func(e): return bool(_defs[e.type].get("builder", false)))
		if not builders.is_empty():
			for t in BUILD_MENU:
				var d: Dictionary = _bdefs[t]
				var ok_age := int(d.get("min_age", 0)) <= age
				list.append({"key": str(d.hotkey), "tex": _portraits.building(t, me), "title": "Build %s" % d.name, "cost": d.cost,
					"enabled": ok_age and _can_afford(d.cost), "action": "build", "arg": t,
					"warn": "" if ok_age else "Requires the %s Age" % AGES[int(d.min_age)]})
		list.append({"key": "X", "svg": "stop", "title": "Stop", "enabled": true, "action": "stop", "slot": 14})
	else:
		var b: Dictionary = sel[0]
		if b.kind == "building" and bool(b.get("built", false)):
			var bd: Dictionary = _bdefs[b.type]
			for t in bd.get("trains", []):
				var d: Dictionary = _defs[t]
				var ok := int(d.get("min_age", 0)) <= age
				list.append({"key": str(d.hotkey), "tex": _portraits.unit(t, me), "title": "Train %s" % d.name + ("" if ok else " (requires %s Age)" % AGES[int(d.min_age)]),
					"cost": d.cost, "enabled": ok and _can_afford(d.cost), "action": "train", "arg": t})
			if bool(bd.get("age_up", false)) and age + 1 < AGES.size():
				var cost: Dictionary = sim.next_age_cost(me)
				var adv := bool(player.get("advancing", false))
				list.append({"key": "A", "svg": "age", "title": ("Advancing to the %s Age..." if adv else "Advance to the %s Age") % AGES[age + 1],
					"cost": cost, "enabled": not adv and _can_afford(cost), "action": "age", "slot": 4})
	var i := 0
	for c in list:
		if c.has("slot") and slots[c.slot] == null:
			slots[c.slot] = c
		else:
			while i < 15 and slots[i] != null:
				i += 1
			if i < 15:
				slots[i] = c
	return slots

func _owner_fields(d: Dictionary, owner: int) -> void:
	var p: Dictionary = sim.get_player(owner)
	d["owner"] = owner
	d["owner_color"] = S.hex(int(p.get("color", 0xffffff)))
	d["owner_name"] = "You" if owner == me else str(p.get("name", "Player %d" % owner))

func _info_for() -> Dictionary:
	var sel := _sel_entities()
	var god := str(player.get("god", "Zeus"))
	if sel.is_empty():
		return {"kind": "none", "text": "%s · %s Age" % [god, AGES[clampi(int(player.get("age", 0)), 0, 3)]]}
	if sel.size() > 1:
		var counts := {}
		for e in sel:
			var nm: String = _name_of(e)
			counts[nm] = counts.get(nm, 0) + 1
		var title := "%d %ss" % [sel.size(), counts.keys()[0]] if counts.size() == 1 else "%d Selected" % sel.size()
		var d := {"kind": "multi", "title": title, "items": []}
		_owner_fields(d, int(sel[0].get("owner", 0)))
		for e in sel.slice(0, 24):
			var tex: Texture2D = null
			if e.kind == "unit": tex = _portraits.unit(e.type, int(e.owner))
			elif e.kind == "building": tex = _portraits.building(e.type, int(e.owner))
			d.items.append({"id": e.id, "tex": tex, "hp": float(e.get("hp", 1)) / maxf(1.0, float(e.get("max_hp", 1)))})
		return d
	var e: Dictionary = sel[0]
	var d := {"kind": e.kind, "title": _name_of(e), "stats": [], "tasks": [], "queue": []}
	if e.kind == "unit":
		var ud: Dictionary = _defs[e.type]
		_owner_fields(d, int(e.owner))
		d["cls"] = str(ud.get("class", "")).capitalize()
		d["hp"] = float(e.hp)
		d["max_hp"] = float(e.max_hp)
		d["tex"] = _portraits.unit(e.type, int(e.owner))
		var atk: Dictionary = ud.get("attack", {})
		if float(atk.get("damage", 0)) > 0:
			d.stats.append(["sword", _num(atk.damage), "ranged" if str(atk.get("projectile", "")) != "" else "hack"])
		d.stats.append(["shield", "%d%%" % int(round(float(ud.get("armor", 0)) * 100)), "armor"])
		if float(ud.get("speed", 0)) > 0:
			d.stats.append(["speed", "%.1f" % float(ud.speed), "speed"])
		if float(ud.get("sight", 0)) > 0:
			d.stats.append(["eye", _num(ud.sight), "LOS"])
		# carried goods and the current task, from the unit arrays
		var u := units()
		var ids: PackedInt32Array = u.ids
		var i := ids.bsearch(int(e.id))
		if i < int(u.count) and ids[i] == int(e.id):
			var carry: int = u.carry[i]
			var amt := float(u.carry_amount[i])
			if carry < 3 and amt > 0:
				d.stats.append([RES_NAMES[carry], str(int(amt)), "/ 10"])
			var ot: int = u.order[i]
			if ot == 0:
				d.tasks.append("Idle")
			else:
				var s: String = ORDER_NAMES.get(ot, "Busy")
				var tk: int = u.task[i]
				if (ot == 2 or ot == 3) and tk < 3:
					s += " " + RES_NAMES[tk]
				d.tasks.append(s)
	elif e.kind == "building":
		var bd: Dictionary = _bdefs[e.type]
		_owner_fields(d, int(e.owner))
		d["cls"] = "Building"
		d["hp"] = float(e.hp)
		d["max_hp"] = float(e.max_hp)
		d["tex"] = _portraits.building(e.type, int(e.owner))
		if not bool(e.built):
			d.tasks.append("Under construction · %d%%" % int(floor(float(e.progress) * 100)))
		if bool(bd.get("age_up", false)) and bool(player.get("advancing", false)) and int(e.owner) == me:
			d.tasks.append("Advancing · %d%%" % int(floor(float(hud_state.get("adv", 0)) * 100)))
		for k in bd.get("dropoff", []):
			d.stats.append([k, "", ""])
		if not bd.get("dropoff", []).is_empty():
			d.stats[d.stats.size() - 1][2] = "drop-off"
		if int(bd.get("pop", 0)) > 0:
			d.stats.append(["house", "+%d" % int(bd.pop), "pop"])
		var q: Array = e.get("queue", [])
		for qi in q.size():
			var it: Dictionary = q[qi]
			d.queue.append({"i": qi, "tex": _portraits.unit(it.type, int(e.owner)), "name": _defs[it.type].name + (" (free)" if bool(it.get("free", false)) else ""),
				"p": float(it.t) / maxf(0.001, float(it.total)) if qi == 0 else 0.0})
	else:
		var r: Dictionary = sim.get_resources()
		var ids: PackedInt32Array = r.ids
		var i := ids.bsearch(int(e.id))
		if i < int(r.count) and ids[i] == int(e.id):
			var tn: String = r.type_names[r.type[i]]
			d["title"] = {"tree": "Tree", "gold": "Gold Mine", "berry": "Berry Bush", "deer": "Deer", "boar": "Boar"}.get(tn, tn)
			d["cls"] = "Gaia"
			var rk := "gold" if tn == "gold" else "wood" if tn == "tree" else "food"
			d["icon"] = rk
			d.stats.append([rk, str(int(ceil(float(r.amount[i])))), rk])
	return d

static func _num(v) -> String:
	var f := float(v)
	return str(int(f)) if f == floor(f) else "%.1f" % f

func _name_of(e: Dictionary) -> String:
	if e.kind == "unit": return str(_defs[e.type].name)
	if e.kind == "building": return str(_bdefs[e.type].name)
	return "Resource"

# ================================================================================
# selection

func set_selection(ids: Array) -> void:
	selected = ids.duplicate()
	var d := {}
	for id in selected:
		d[id] = true
	minimap.selected = d
	_hud_t = 0.0
	_redraw()

func _prune_selection() -> void:
	if selected.is_empty():
		return
	var u := units()
	var ids: PackedInt32Array = u.ids
	var flags: PackedByteArray = u.flags
	var keep := []
	for id in selected:
		var k := int(sim.entity_kind(id))
		if k == 1:
			var i := ids.bsearch(int(id))
			if i >= int(u.count) or ids[i] != int(id) or (flags[i] & 2):
				continue
		elif k == 0:
			continue
		keep.append(id)
	if keep.size() != selected.size():
		set_selection(keep)

func _own_units() -> Array:
	var out := []
	for id in selected:
		if int(sim.entity_kind(id)) == 1 and int(sim.get_unit(id).get("owner", 0)) == me:
			out.append(id)
	return out

## Selection rings under selected (and hovered) units, one MultiMesh.
func _update_rings(alpha: float) -> void:
	var mm := _rings.multimesh
	var list := selected.duplicate()
	if hover_entity != 0 and not selected.has(hover_entity):
		list.append(hover_entity)
	if list.is_empty():
		mm.visible_instance_count = 0
		return
	if list.size() > mm.instance_count:
		var cap := mm.instance_count
		while cap < list.size():
			cap *= 2
		mm.instance_count = cap
	var u := units()
	var ids: PackedInt32Array = u.ids
	var pos: PackedFloat32Array = u.pos
	var prev: PackedFloat32Array = u.prev_pos
	var gy: PackedFloat32Array = u.ground_y
	var owner = u.owner
	var type: PackedByteArray = u.type
	var n := 0
	for id in list:
		var k := int(sim.entity_kind(id))
		var x := 0.0
		var z := 0.0
		var y := 0.0
		var rad := 0.6
		var o := 0
		if k == 1:
			var i := ids.bsearch(int(id))
			if i >= int(u.count) or ids[i] != int(id):
				continue
			x = lerpf(prev[i * 2], pos[i * 2], alpha)
			z = lerpf(prev[i * 2 + 1], pos[i * 2 + 1], alpha)
			y = gy[i]
			rad = float(_defs[_names[type[i]]].get("radius", 0.4)) * 1.5 + 0.1
			o = int(owner[i])
		elif k == 2:
			var b: Dictionary = sim.get_building(id)
			x = float(b.x)
			z = float(b.z)
			y = float(sim.height_at(x, z))
			rad = maxf(float(b.w), float(b.h)) * 0.72
			o = int(b.owner)
		else:
			continue
		var col := Color(0.35, 1.0, 0.45, 0.9) if o == me else Color(1, 0.95, 0.6, 0.9) if o == 0 else Color(1.0, 0.3, 0.25, 0.9)
		if id == hover_entity and not selected.has(id):
			col.a = 0.45
		mm.set_instance_transform(n, Transform3D(Basis.from_scale(Vector3(rad, 1, rad)), Vector3(x, y + 0.06, z)))
		mm.set_instance_color(n, col)
		n += 1
	mm.visible_instance_count = n

# ================================================================================
# world picking

## Ray from the camera through a screen point onto the terrain (world x/z), or null.
func pick_ground(screen: Vector2) -> Variant:
	var cam: Camera3D = game.camera
	var o := cam.project_ray_origin(screen)
	var d := cam.project_ray_normal(screen)
	if d.y >= -0.001:
		return null
	var ws := float(sim.get_map_size())
	var t := 0.0
	var step := 1.0
	var prev_t := 0.0
	for i in 600:
		var p := o + d * t
		if p.y <= sim.height_at(clampf(p.x, 0, ws - 0.01), clampf(p.z, 0, ws - 0.01)):
			var a := prev_t
			var b := t
			for k in 12:
				var m := (a + b) * 0.5
				var q := o + d * m
				if q.y <= sim.height_at(clampf(q.x, 0, ws - 0.01), clampf(q.z, 0, ws - 0.01)):
					b = m
				else:
					a = m
			var hit := o + d * b
			if hit.x < 0 or hit.z < 0 or hit.x > ws or hit.z > ws:
				return null
			return Vector2(hit.x, hit.z)
		prev_t = t
		t += step
		if t > 900.0:
			break
	return null

func _screen(p: Vector3) -> Vector2:
	return game.camera.unproject_position(p)

## The entity under a screen point: units (projected body box), then
## buildings (footprint), then resources (tree crowns, other footprints).
func pick_entity(sp: Vector2) -> int:
	var cam: Camera3D = game.camera
	var u := units()
	var n := int(u.count)
	var ids: PackedInt32Array = u.ids
	var pos: PackedFloat32Array = u.pos
	var gy: PackedFloat32Array = u.ground_y
	var flags: PackedByteArray = u.flags
	var owner = u.owner
	var type: PackedByteArray = u.type
	var best := 0
	var bd := INF
	for i in n:
		if flags[i] & 2:
			continue
		var x := pos[i * 2]
		var z := pos[i * 2 + 1]
		var w := Vector3(x, gy[i], z)
		if cam.is_position_behind(w):
			continue
		var bot := cam.unproject_position(w)
		if absf(bot.x - sp.x) > 80 or absf(bot.y - sp.y) > 160:
			continue
		if int(owner[i]) != me and _fog_on and not sim.is_visible(x, z):
			continue
		var top := cam.unproject_position(w + Vector3(0, HEIGHT.get(_names[type[i]], 1.8), 0))
		var hp := absf(bot.y - top.y)
		var m := (top + bot) * 0.5
		var dx := sp.x - m.x
		var dy := sp.y - m.y
		if absf(dx) < maxf(10, hp * 0.45) and absf(dy) < maxf(12, hp * 0.65):
			var dd := dx * dx + dy * dy
			if dd < bd:
				bd = dd
				best = ids[i]
	if best != 0:
		return best
	var g = pick_ground(sp)
	if g == null:
		return 0
	var B: Dictionary = sim.get_buildings()
	var rect: PackedInt32Array = B.rect
	for i in int(B.count):
		var tx := rect[i * 4]
		var tz := rect[i * 4 + 1]
		var w := rect[i * 4 + 2]
		var h := rect[i * 4 + 3]
		if int(B.owner[i]) != me and _fog_on and not sim.is_explored(tx + w * 0.5, tz + h * 0.5):
			continue
		if g.x >= tx - 0.3 and g.x <= tx + w + 0.3 and g.y >= tz - 0.3 and g.y <= tz + h + 0.3:
			return B.ids[i]
	var R: Dictionary = sim.get_resources()
	var tile: PackedInt32Array = R.tile
	var rt: PackedByteArray = R.type
	bd = INF
	for i in int(R.count):
		var tx := tile[i * 2]
		var tz := tile[i * 2 + 1]
		if absf(tx + 0.5 - g.x) > 7 or absf(tz + 0.5 - g.y) > 7:
			continue
		if _fog_on and not sim.is_explored(tx + 0.5, tz + 0.5):
			continue
		var tn: String = R.type_names[rt[i]]
		if tn == "tree":
			var s := _screen(Vector3(tx + 0.5, sim.height_at(tx + 0.5, tz + 0.5) + 2.5, tz + 0.5))
			var dd := s.distance_squared_to(sp)
			if dd < 900 and dd < bd:
				bd = dd
				best = R.ids[i]
		else:
			var wh := 3 if tn == "gold" else 1
			if g.x >= tx - 0.2 and g.x <= tx + wh + 0.2 and g.y >= tz - 0.2 and g.y <= tz + wh + 0.2:
				return R.ids[i]
	return best

func _view_corners() -> PackedVector2Array:
	var vs := get_viewport().get_visible_rect().size
	var out := PackedVector2Array()
	var pts := [[Vector2(0, 0), 1.0], [Vector2(vs.x, 0), 1.0], [Vector2(vs.x, vs.y - 1), -1.0], [Vector2(0, vs.y - 1), -1.0]]
	for pp in pts:
		var hit = null
		for i in 4:
			hit = pick_ground(pp[0] + Vector2(0, pp[1] * vs.y * 0.08 * i))
			if hit != null:
				break
		if hit == null:
			return PackedVector2Array()
		out.push_back(hit)
	return out

# ================================================================================
# input

func blocking_rects() -> Array:
	var out := []
	for spec in _back.panel_specs():
		out.append(spec.rect)
	out.append(Rect2(_back.mm_origin() + Vector2(40, 0), Vector2(284, 330)))
	return out

func _css(p: Vector2) -> Vector2:
	return p / _scale

func hud_input(ctrl: Control, e: InputEvent) -> void:
	if e is InputEventMouseMotion:
		_mouse = ctrl.get_global_mouse_position() * _scale
		var z: Dictionary = _front.zone_at(e.position)
		if z.is_empty():
			z = _back.zone_at(e.position)
		_set_hover(z)
		if _mm_drag and z.get("id", "") == "minimap":
			_minimap_click(e.position, MOUSE_BUTTON_LEFT)
		return
	if not (e is InputEventMouseButton):
		return
	var z: Dictionary = _front.zone_at(e.position)
	if z.is_empty():
		z = _back.zone_at(e.position)
	if e.button_index == MOUSE_BUTTON_LEFT:
		mouse_down = e.pressed
		if not e.pressed:
			_mm_drag = false
			_redraw()
			return
	if not e.pressed:
		return
	if z.is_empty():
		return
	ctrl.accept_event()
	var id: String = z.id
	if id == "minimap":
		_mm_drag = e.button_index == MOUSE_BUTTON_LEFT
		_minimap_click(e.position, e.button_index)
		return
	if e.button_index != MOUSE_BUTTON_LEFT:
		return
	_click_zone(id, z.arg)
	_redraw()

var _mm_drag := false

func _set_hover(z: Dictionary) -> void:
	var id: String = z.get("id", "")
	if id == "cmd" or id == "group" or id == "power" or id == "res" or id == "queue" or id == "multi" or id == "gfx":
		id = "%s:%s" % [id, z.arg]
	if id == hover_id:
		return
	hover_id = id
	if z.is_empty() or z.tip.is_empty():
		if not menu_open:
			tooltip = {}
	elif not menu_open:
		tooltip = z.tip.duplicate()
		tooltip["anchor"] = z.rect
	_redraw()

func _minimap_click(p: Vector2, button: int) -> void:
	var w: Vector2 = minimap.to_world(p - _back.dia_center())
	if button == MOUSE_BUTTON_LEFT:
		game.camera.target.x = w.x
		game.camera.target.z = w.y
	elif button == MOUSE_BUTTON_RIGHT:
		_order_at(w.x, w.y, 0)

## The live graphics level (lighting piece), for the settings card.
func graphics_quality() -> String:
	return str(game.pieces["lighting"].quality) if game.pieces.has("lighting") else "high"

func _click_zone(id: String, arg) -> void:
	match id:
		"cmd":
			var c = commands[int(arg)]
			if c == null:
				return
			if not c.enabled:
				message(c.get("warn", "") if c.get("warn", "") != "" else "Cannot do that yet")
				return
			_run_command(c)
		"power":
			var p: Dictionary = {}
			for pp in powers:
				if pp.key == arg:
					p = pp
			if p.is_empty():
				return
			if not p.can:
				message(p.reason)
				return
			_mode = {"kind": "power", "id": arg}
			message("%s: choose a target" % p.def.name)
			_hud_t = 0.0
		"group":
			_recall_group(str(arg), false, true)
		"multi":
			set_selection([arg])
		"queue":
			var sel := _sel_entities()
			if not sel.is_empty() and sel[0].kind == "building":
				sim.cancel_train(sel[0].id, int(arg))
				_hud_t = 0.0
		"mb:speed":
			game.time_scale = 1.0 if float(game.time_scale) > 1.0 else 1.5
			message("Fast speed" if float(game.time_scale) > 1.0 else "Normal speed")
		"mb:pause":
			if not result.is_empty():
				return
			game.paused = not game.paused
			user_paused = game.paused
			message("Game paused" if game.paused else "Game resumed")
		"gfx":
			var q := str(arg)
			if game.pieces.has("lighting"):
				game.pieces["lighting"].set_quality(q)
			Settings.write("graphics", "quality", q)
			message("Graphics: %s" % q.capitalize())
		"mb:obj":
			message("Objective: destroy the enemy Town Center")
		"mb:menu":
			menu_open = not menu_open
			tooltip = {} if not menu_open else {"title": "Hotkeys", "lines": [". idle villager  ·  H Town Center", "Ctrl+1..9 assign group  ·  1..9 recall",
				"Q/E/F/S/R/B build  ·  X stop", "Space / arrows: pan  ·  wheel: zoom", "F1 HUD  ·  F3 performance meter"], "menu": true, "anchor": Rect2(_back.menubar_rect().position + Vector2(0, 50), Vector2(10, 1))}
		"rb:idle":
			_cycle_idle()
		"rb:army":
			_select_idle_army()
		"rb:home":
			_goto_tc()
		"rb:flare":
			message("Right-click the minimap to send units")
		"rb:terrain":
			minimap.show_terrain = not minimap.show_terrain
			minimap.refresh(0.0, true)
		"rb:score":
			scores_visible = not scores_visible
		"restart":
			get_tree().reload_current_scene()
		"medal":
			pass

func _run_command(c: Dictionary) -> void:
	var sel := _sel_entities()
	match str(c.action):
		"build":
			var builders := []
			for e in sel:
				if e.kind == "unit" and bool(_defs[e.type].get("builder", false)) and int(e.owner) == me:
					builders.append(e.id)
			_begin_place(str(c.arg), builders)
		"stop":
			sim.order_idle(PackedInt32Array(_own_units()))
		"train":
			var r: Dictionary = sim.train(sel[0].id, str(c.arg))
			if not r.ok: message(r.reason)
		"age":
			var r: Dictionary = sim.advance_age(me)
			if not r.ok: message(r.reason)
	_hud_t = 0.0
	_stat_t = 0.0

func _unhandled_input(e: InputEvent) -> void:
	if game == null or game.camera == null or not result.is_empty():
		return
	if e is InputEventMouseMotion:
		_mouse = e.position
		if hover_id != "":
			_set_hover({})
		if not _drag.is_empty():
			if not _drag.active and e.position.distance_to(_drag.start) > 5:
				_drag.active = true
			_world.queue_redraw()
		_hover_pending = true
		return
	if e is InputEventMouseButton and e.pressed:
		if e.button_index == MOUSE_BUTTON_LEFT:
			if _mode.get("kind", "") == "place":
				_confirm_place(e.shift_pressed)
				return
			if _mode.get("kind", "") == "power":
				var g = pick_ground(e.position)
				if g != null:
					var ok: bool = sim.cast_power(me, _mode.id, g.x, g.y)
					if not ok:
						message(str(sim.can_cast(me, _mode.id).reason))
				_mode = {}
				_hud_t = 0.0
				return
			_drag = {"start": e.position, "shift": e.shift_pressed, "active": false}
		elif e.button_index == MOUSE_BUTTON_RIGHT:
			if not _mode.is_empty():
				_cancel_mode()
				return
			var g = pick_ground(e.position)
			if g != null:
				_order_at(g.x, g.y, pick_entity(e.position))
	elif e is InputEventMouseButton and not e.pressed and e.button_index == MOUSE_BUTTON_LEFT and not _drag.is_empty():
		_finish_drag(e.position)
	elif e is InputEventKey and e.pressed and not e.echo:
		_key(e)

var _hover_pending := false

func _process(_dt: float) -> void:
	if _hover_pending and game and game.camera:
		_hover_pending = false
		var h := pick_entity(_mouse) if hover_id == "" else 0
		if h != hover_entity:
			hover_entity = h

func _finish_drag(p: Vector2) -> void:
	var d := _drag
	_drag = {}
	_world.queue_redraw()
	if d.active:
		var r := Rect2(d.start, Vector2.ZERO).expand(p)
		var u := units()
		var ids := []
		var mil := []
		var cam: Camera3D = game.camera
		var pos: PackedFloat32Array = u.pos
		var gy: PackedFloat32Array = u.ground_y
		var owner = u.owner
		var flags: PackedByteArray = u.flags
		var type: PackedByteArray = u.type
		for i in int(u.count):
			if flags[i] & 2 or int(owner[i]) != me:
				continue
			var w := Vector3(pos[i * 2], gy[i] + 0.8, pos[i * 2 + 1])
			if cam.is_position_behind(w):
				continue
			if r.has_point(cam.unproject_position(w)):
				ids.append(u.ids[i])
				if not bool(_defs[_names[type[i]]].get("gatherer", false)):
					mil.append(u.ids[i])
		var pick := mil if not mil.is_empty() and mil.size() < ids.size() and not d.shift else ids
		if d.shift:
			var s := selected.duplicate()
			for id in pick:
				if not s.has(id): s.append(id)
			set_selection(s)
		elif not pick.is_empty():
			set_selection(pick)
		return
	var t := pick_entity(p)
	var now := Time.get_ticks_msec()
	if t != 0 and _last_click.id == t and now - int(_last_click.t) < 350 and int(sim.entity_kind(t)) == 1:
		# double click: every unit of that type and owner on screen
		var ut: Dictionary = sim.get_unit(t)
		var u := units()
		var vs := get_viewport().get_visible_rect()
		var ids := []
		var cam: Camera3D = game.camera
		for i in int(u.count):
			if u.flags[i] & 2 or int(u.owner[i]) != int(ut.owner) or _names[u.type[i]] != str(ut.type):
				continue
			var w := Vector3(u.pos[i * 2], u.ground_y[i], u.pos[i * 2 + 1])
			if not cam.is_position_behind(w) and vs.has_point(cam.unproject_position(w)):
				ids.append(u.ids[i])
		set_selection(ids)
	elif t != 0:
		if d.shift and _owner_of(t) == me:
			var s := selected.duplicate()
			if s.has(t): s.erase(t)
			else: s.append(t)
			set_selection(s)
		else:
			set_selection([t])
	elif not d.shift:
		set_selection([])
	_last_click = {"t": now, "id": t}

func _owner_of(id: int) -> int:
	var k := int(sim.entity_kind(id))
	if k == 1: return int(sim.get_unit(id).get("owner", 0))
	if k == 2: return int(sim.get_building(id).get("owner", 0))
	return 0

func _order_at(x: float, z: float, target: int) -> void:
	var own := _own_units()
	if not own.is_empty():
		sim.smart(PackedInt32Array(own), x, z, target)
		var enemy: bool = target != 0 and sim.is_enemy(me, _owner_of(target))
		_marker(x, z, Color("#ff4030") if enemy else Color("#7dff7a"))
		return
	var any := false
	for id in selected:
		if int(sim.entity_kind(id)) == 2:
			var b: Dictionary = sim.get_building(id)
			if int(b.owner) == me and not _bdefs[b.type].get("trains", []).is_empty():
				sim.set_rally(id, x, z, target)
				any = true
	if any:
		_marker(x, z, Color("#ffd84a"))

func _marker(x: float, z: float, c: Color) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = _ring_mesh(0.5 / 0.7, 1.0, 24)
	mi.material_override = _flat_material(c, false)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position = Vector3(x, sim.height_at(x, z) + 0.08, z)
	mi.scale = Vector3.ONE * 0.7
	add_child(mi)
	_markers.append({"mi": mi, "t": 0.0})

func _update_markers(dt: float) -> void:
	if _markers.is_empty():
		return
	var keep := []
	for m in _markers:
		m.t += dt
		var t: float = m.t
		if t > 0.6:
			m.mi.queue_free()
			continue
		m.mi.scale = Vector3.ONE * 0.7 * (1.0 + t * 1.5)
		(m.mi.material_override as StandardMaterial3D).albedo_color.a = maxf(0.0, 1.0 - t / 0.6)
		keep.append(m)
	_markers = keep

func _key(e: InputEventKey) -> void:
	var kc := e.keycode
	if kc == KEY_ESCAPE:
		_cancel_mode()
		if menu_open:
			menu_open = false
			tooltip = {}
			_redraw()
		return
	if kc >= KEY_0 and kc <= KEY_9:
		var k := str(kc - KEY_0)
		if e.ctrl_pressed or e.meta_pressed:
			groups[k] = selected.duplicate()
			message("Group %s assigned" % k)
			_stat_t = 0.0
			get_viewport().set_input_as_handled()
			return
		_recall_group(k, e.shift_pressed, false)
		return
	if kc == KEY_H:
		_goto_tc()
		return
	if kc == KEY_PERIOD:
		_cycle_idle()
		return
	if kc == KEY_F1:
		_set_hud_visible(not hud_visible)
		return
	if e.ctrl_pressed or e.meta_pressed:
		return
	var ch := OS.get_keycode_string(kc).to_upper()
	if ch.length() != 1:
		return
	for c in commands:
		if c != null and c.key == ch:
			if c.enabled:
				_run_command(c)
			else:
				message(c.get("warn", "") if c.get("warn", "") != "" else "Cannot do that yet")
			return
	# god power hotkeys (Z / X / C) when the key is free
	for p in powers:
		if str(p.def.get("hotkey", "")) == ch:
			_click_zone("power", p.key)
			return

func _recall_group(k: String, add: bool, center: bool) -> void:
	var ids := _alive(groups.get(k, []))
	if ids.is_empty():
		return
	if add:
		var s := selected.duplicate()
		for id in ids:
			if not s.has(id): s.append(id)
		set_selection(s)
	else:
		set_selection(ids)
	var now := Time.get_ticks_msec()
	if center or (_last_group.k == k and now - int(_last_group.t) < 400):
		_center_on(ids)
	_last_group = {"k": k, "t": now}

func _center_on(ids: Array) -> void:
	var x := 0.0
	var z := 0.0
	var n := 0
	for id in ids:
		var k := int(sim.entity_kind(id))
		var d: Dictionary = sim.get_unit(id) if k == 1 else sim.get_building(id) if k == 2 else {}
		if d.has("x"):
			x += float(d.x)
			z += float(d.z)
			n += 1
	if n > 0:
		game.camera.target.x = x / n
		game.camera.target.z = z / n

func _goto_tc() -> void:
	var B: Dictionary = sim.get_buildings()
	var tn: PackedStringArray = B.type_names
	for i in int(B.count):
		if int(B.owner[i]) == me and tn[B.type[i]] == "town_center":
			set_selection([B.ids[i]])
			_center_on([B.ids[i]])
			return

func _cycle_idle() -> void:
	var u := units()
	var idle := []
	for i in int(u.count):
		if int(u.owner[i]) == me and not (u.flags[i] & 2) and u.order[i] == 0 and bool(_defs[_names[u.type[i]]].get("gatherer", false)):
			idle.append(u.ids[i])
	if idle.is_empty():
		message("No idle villagers")
		return
	_idle_idx = (_idle_idx + 1) % idle.size()
	set_selection([idle[_idle_idx]])
	_center_on([idle[_idle_idx]])

func _select_idle_army() -> void:
	var u := units()
	var ids := []
	for i in int(u.count):
		var d: Dictionary = _defs[_names[u.type[i]]]
		if int(u.owner[i]) == me and not (u.flags[i] & 2) and u.order[i] == 0 and not bool(d.get("gatherer", false)) and float(d.attack.get("damage", 0)) > 0:
			ids.append(u.ids[i])
	if ids.is_empty():
		message("No idle military")
		return
	set_selection(ids)
	_center_on(ids)

# ---- placement / targeting modes -------------------------------------------------------

func _begin_place(type: String, builders: Array) -> void:
	_cancel_mode()
	_mode = {"kind": "place", "type": type, "builders": builders}
	_ghost = MeshInstance3D.new()
	_ghost.mesh = VoxelModels.mesh("buildings", "%s/0" % type)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.49, 1.0, 0.6, 0.45)
	m.no_depth_test = false
	m.render_priority = 3
	_ghost.material_override = m
	_ghost.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ghost)
	_update_ghost()

func _cancel_mode() -> void:
	if _ghost:
		_ghost.queue_free()
		_ghost = null
	_mode = {}
	_range_ring.visible = false
	_hud_t = 0.0

func _update_ghost() -> void:
	var kind: String = _mode.get("kind", "")
	if kind == "" :
		_range_ring.visible = false
		return
	var mp := get_viewport().get_mouse_position()
	var g = pick_ground(mp)
	if kind == "power":
		if g == null:
			_range_ring.visible = false
			return
		var r := float(_pdefs[_mode.id].get("radius", 2.0))
		_range_ring.visible = true
		_range_ring.position = Vector3(g.x, sim.height_at(g.x, g.y) + 0.1, g.y)
		_range_ring.scale = Vector3(r, 1, r)
		return
	if _ghost == null or g == null:
		return
	var d: Dictionary = _bdefs[_mode.type]
	var tx := int(round(g.x - float(d.w) / 2.0))
	var tz := int(round(g.y - float(d.h) / 2.0))
	_ghost_tile = Vector2i(tx, tz)
	_ghost_ok = sim.can_place(_mode.type, tx, tz) and _can_afford(d.cost) and (not _fog_on or sim.is_explored(tx, tz))
	var x := tx + float(d.w) * 0.5
	var z := tz + float(d.h) * 0.5
	_ghost.position = Vector3(x, sim.height_at(x, z), z)
	(_ghost.material_override as StandardMaterial3D).albedo_color = Color(0.49, 1.0, 0.6, 0.45) if _ghost_ok else Color(1.0, 0.35, 0.29, 0.45)

func _confirm_place(shift: bool) -> void:
	_update_ghost()
	if not _ghost_ok:
		message("Cannot place building here")
		return
	var t: String = _mode.type
	var builders: Array = _mode.builders
	var id := int(sim.place_building(t, me, _ghost_tile.x, _ghost_tile.y, PackedInt32Array(builders)))
	if id == 0:
		message("Cannot place building here")
		return
	_cancel_mode()
	if shift:
		_begin_place(t, builders)
	_stat_t = 0.0
	_hud_t = 0.0

# ================================================================================
# world overlay: drag box + health bars over selected units

class _WorldOverlay extends Control:
	var ui: Node
	func _draw() -> void:
		ui._draw_world(self)

func _draw_world(ci: Control) -> void:
	if not _drag.is_empty() and _drag.active:
		var r := Rect2(_css(_drag.start), Vector2.ZERO).expand(_css(_mouse))
		ci.draw_rect(r, Color(140 / 255.0, 1.0, 140 / 255.0, 0.12))
		ci.draw_rect(r, Color("#b8ffb0"), false, 1.0)
	if selected.is_empty():
		return
	var u := units()
	var ids: PackedInt32Array = u.ids
	var cam: Camera3D = game.camera
	var a := float(game.alpha)
	var n := 0
	for id in selected:
		if n >= 64:
			break
		if int(sim.entity_kind(id)) != 1:
			continue
		var i := ids.bsearch(int(id))
		if i >= int(u.count) or ids[i] != int(id):
			continue
		var x := lerpf(u.prev_pos[i * 2], u.pos[i * 2], a)
		var z := lerpf(u.prev_pos[i * 2 + 1], u.pos[i * 2 + 1], a)
		var tname: String = _names[u.type[i]]
		var w := Vector3(x, u.ground_y[i] + HEIGHT.get(tname, 1.8) + 0.3, z)
		if cam.is_position_behind(w):
			continue
		var sp := _css(cam.unproject_position(w))
		var d: Dictionary = _defs[tname]
		var bw := 76.0 if (d.myth or d.hero) else 50.0 if str(d.get("class", "")) == "cavalry" else 44.0
		bw *= 0.8
		var f := clampf(float(u.hp[i]) / maxf(1.0, float(u.max_hp[i])), 0.0, 1.0)
		var r := Rect2(sp.x - bw * 0.5, sp.y - 3, bw, 6)
		ci.draw_rect(r.grow(1), Color(0.02, 0.03, 0.03, 0.85))
		ci.draw_rect(r, Color(0.16, 0.08, 0.06, 0.9))
		var fc := Color(0.3, 1.0, 0.18) if f > 0.5 else Color(1.0, 0.82, 0.25) if f > 0.25 else Color(1.0, 0.3, 0.2)
		ci.draw_rect(Rect2(r.position, Vector2(bw * f, 6)), fc)
		ci.draw_rect(Rect2(r.position, Vector2(bw * f, 2)), Color(1, 1, 1, 0.3))
		n += 1
