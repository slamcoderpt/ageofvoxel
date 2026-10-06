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
const FLOW := "res://game/menu/flow.gd"   # screen flow (Play Again, Main Menu), when the menu piece is there
const BUILD_MENU := ["house", "farm", "storehouse", "temple", "barracks", "armory", "market", "town_center", "wall", "tower"]
## build-grid tooltip lines of the buildings that research (Retold's help text)
const BUILD_LINES := {
	"armory": ["Researches weapon, armor and shield upgrades", "and its gods' military techs."],
	"market": ["Buys and sells food and wood for gold;", "researches the trade techs."],
}
## the command grid's hotkeys by slot (tech buttons: Retold's grid letters;
## the third row is Y..P, as Z / C / V are the god powers here)
const SLOT_KEYS := ["Q", "W", "E", "R", "T", "A", "S", "D", "F", "G", "Y", "U", "I", "O", "P"]
## the Armory's generic lines, one column each in the top row (Retold, ui_02.jpg)
const ARMORY_COLS := {"weapons": 0, "armor": 1, "shields": 2, "ballistics": 3, "burning_pitch": 4}
const TechIcons := preload("res://game/ui/tech_icons.gd")
const FORT_TYPES := {"wall": true, "wall_pillar": true, "gate": true, "tower": true}
const GHOST_OK := Color(0.49, 1.0, 0.6, 0.45)
const GHOST_BAD := Color(1.0, 0.35, 0.29, 0.45)
const GHOST_JOIN := Color(1.0, 0.86, 0.4, 0.6)
const ORDER_NAMES := {1: "Moving", 2: "Gathering", 3: "Returning", 4: "Worshipping", 5: "Building", 6: "Attacking", 7: "Attack-moving", 8: "Empowering", 9: "Converting"}
const AM_COLOR := Color("#ff7a30")   # attack-move: cursor ring and order marker
const RES_NAMES := ["food", "wood", "gold"]
const POWER_ICONS := {"lightning_storm": "storm", "bolt": "bolt", "meteor": "meteor", "thoth_meteor": "meteor"}
const EgyptIcons := preload("res://game/ui/egypt_icons.gd")
const EgyptBuildings := preload("res://game/buildings/egypt_buildings.gd")
## The Egyptian Laborer's build grid (Retold's, reference/egypt/ui_01.jpg):
## [building, hotkey] by slot, economy on the top row, the Monuments (one
## button: the next one in order), Temple and the Classical buildings in the
## middle, the late military, defences and Town Center below. The keys avoid
## Z / C / V / B (the god powers) and X (stop: its key still works).
const EGYPT_GRID := [["house", "Q"], ["granary", "W"], ["lumber_camp", "E"], ["mining_camp", "R"], ["farm", "T"],
	["monument", "A"], ["temple", "S"], ["eg_barracks", "D"], ["armory", "F"], ["market", "G"],
	["migdol", "Y"], ["siege_works", "U"], ["tower", "I"], ["wall", "O"], ["town_center", "P"]]
const MONUMENTS := ["monument_villagers", "monument_soldiers", "monument_priests", "monument_pharaohs", "monument_gods"]
## build-grid tooltip lines of the Egyptian buildings (Retold's help text, EGYPT.md 2)
const EGYPT_LINES := {
	"house": ["+10 population."],
	"granary": ["Drop-off for food; Laborers carry 15 food.", "Researches the farming techs."],
	"lumber_camp": ["Drop-off for wood."],
	"mining_camp": ["Drop-off for gold."],
	"farm": ["Laborers farm food here; infinite."],
	"temple": ["Trains Priests and the myth units of your minor gods;", "researches god techs."],
	"eg_barracks": ["Trains Spearmen, Axemen and Slingers."],
	"migdol": ["Trains Chariot Archers, Camel Riders and War Elephants;", "shoots arrows. The Mythic Age needs one."],
	"siege_works": ["Trains Siege Towers and Catapults."],
	"town_center": ["Trains Laborers, Priests and Mercenaries;", "advances to the next age."],
	"obelisk": ["Sees far: line of sight over a wide area.", "Built by Priests."],
}
const EGYPT_TRAIN_LINES := {
	"laborer": "Gathers, builds, repairs; 15 food / 10 wood / 10 gold a trip.",
	"priest": "Heals; Ra's Priests empower, Set's convert wild animals.",
	"mercenary": "A hired spearman for the Town Center's defence; dies in time.",
	"mercenary_cavalry": "A hired rider; dies in time.",
	"spearman": "Fast infantry, x2 vs cavalry.", "axeman": "Heavy infantry, x4 vs infantry.",
	"slinger": "Ranged infantry, x2.25 vs archers.", "chariot_archer": "Fast ranged cavalry, x1.5 vs infantry.",
	"camel_rider": "Raider, x2 vs cavalry.", "war_elephant": "Slow, very tough, x4 vs buildings.",
	"siege_tower": "Siege: breaks buildings and walls.", "catapult": "Siege: long-range stones vs buildings.",
}
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
var _mbdefs := {}                # building type key -> def with my civ's cost / trains / min age (get_building_def(t, me))
var civ := "greek"               # my civilization ("greek" | "egyptian", get_player(me).civ)
var _stat_t := 0.0
var _hud_t := 0.0
var _msg_t := 0.0
var _cmd_sig := ""
var _first := true
var _scale := 1.0
var _fog_on := false
var _mode := {}                  # {} | {kind: "power", id} | {kind: "place", type, builders} | {kind: "attack_move"} | {kind: "wall", builders, start}
## the wall line under the cursor while in wall mode (read by the overlay and
## the walls playtest): {a, b (world points, snapped), tiles, state, new_tiles,
## cost, ok, reason}
var wall_preview := {}
var _wall_ghosts: Array = []     # MeshInstance3D pool of the wall line ghost
var _wall_mats := {}
var _wall_sig := ""
var _fort := {}                  # get_fortify(me), refreshed with the HUD
var _walls_cache := {}           # get_walls(), refreshed with the HUD
var _sel_tower := {}             # {x, z, range}: the selected tower's range ring
var _ghost: MeshInstance3D
var _ghost_ok := false
var _ghost_tile := Vector2i.ZERO
var _range_ring: MeshInstance3D
var _am_ring: MeshInstance3D     # attack-move targeting: a ring under the cursor
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
	_tech_names = sim.tech_names() if sim.has_method("tech_names") else PackedStringArray()
	AovScenes.set_setup("techui", _techui_setup)
	AovScenes.set_setup("egyptui", _egyptui_setup)
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
	if hud_visible:
		TechIcons.studio_start(self)   # the tech icons' 3D models (TechIcons "the 3D studio")

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
	_am_ring = MeshInstance3D.new()
	_am_ring.mesh = _ring_mesh(0.7, 1.0, 40)
	_am_ring.material_override = _flat_material(Color(AM_COLOR, 0.85), false)
	_am_ring.visible = false
	_am_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_am_ring)
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
	if hud_visible:
		TechIcons.studio_poll()    # the 3D tech icons, rendered once (tech_models.gd)
		TechIcons.prewarm_step()   # the tech tiles, one per frame (PORTING.md "Command button states")
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
	if _scene_tip >= 0:
		_pin_scene_tip()
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
	_scene_tip = int(ctx.get("tip_slot", -1))

var _scene_tip := -1   # techui capture scene: the command slot whose tooltip stays open

## The techui scene's open tooltip: the tip of command slot _scene_tip as if
## the mouse rested on it (zones exist once the HUD has drawn).
func _pin_scene_tip() -> void:
	for z in _back.zones:
		if z.id == "cmd" and int(z.arg) == _scene_tip and not z.tip.is_empty():
			var t: Dictionary = z.tip.duplicate()
			t["anchor"] = z.rect
			if t != tooltip or hover_id != "cmd:%d" % _scene_tip:
				tooltip = t
				hover_id = "cmd:%d" % _scene_tip
				_redraw()
			return

## The "techui" capture scene (Godot-only): the town scene's town in the
## Heroic Age with an Armory, a Market and its Temple; Copper Weapons and
## Copper Armor researched, Copper Shields and Ballistics in the Armory's
## queue (the first one under way), two Minotaurs training at the Temple, a
## few trades made so the prices moved, and 16 favor left so some god techs
## are short of favor: every button state at once (available, unaffordable,
## locked by age, locked by a prerequisite: Bronze Shields padlocked behind
## Copper Shields, researching, queued, training); the Armory selected with
## the tooltip of its first tech button open.
##   node scripts/godot-shoot.mjs --scene techui --width 1920 --height 1080
##     [--params "techui_sel=market"]   # market | temple | armory (default)
##     [--params "techui_tip=5"]        # the command slot whose tooltip is open (-1: none)
static func _techui_setup(g: Node) -> Dictionary:
	var sim2: Object = g.sim
	var ctx: Dictionary = sim2.setup_scene("town", g.scene_opts())
	sim2.set_player_age(1, 2)
	sim2.set_player_resources(1, {"food": 3000.0, "wood": 3000.0, "gold": 3000.0, "favor": 100.0})
	var B: Dictionary = sim2.get_buildings()
	var tn: PackedStringArray = B.type_names
	var tc := Vector2i(-1, -1)
	var temple := 0
	for i in int(B.count):
		if int(B.owner[i]) != 1:
			continue
		if tn[B.type[i]] == "town_center":
			tc = Vector2i(B.rect[i * 4] + B.rect[i * 4 + 2] / 2, B.rect[i * 4 + 1] + B.rect[i * 4 + 3] / 2)
		elif tn[B.type[i]] == "temple":
			temple = int(B.ids[i])
	# two free 4x4 lots near the Town Center, nearest first
	var lots := []
	for r in range(6, 20):
		for k in 32:
			var a := TAU * k / 32.0
			var t := Vector2i(tc.x + int(round(cos(a) * r)) - 2, tc.y + int(round(sin(a) * r)) - 2)
			var ok: bool = sim2.can_place("armory", t.x, t.y)
			for l in lots:
				if absi(t.x - l.x) < 6 and absi(t.y - l.y) < 6:
					ok = false
			if ok:
				lots.append(t)
			if lots.size() == 2:
				break
		if lots.size() == 2:
			break
	if lots.size() < 2:
		push_error("techui: no lots for the Armory and the Market")
		return ctx
	var armory := int(sim2.spawn_building("armory", 1, lots[0].x, lots[0].y, true))
	var market := int(sim2.spawn_building("market", 1, lots[1].x, lots[1].y, true))
	sim2.grant_tech(1, "copper_weapons")
	sim2.grant_tech(1, "copper_armor")
	sim2.research(armory, "copper_shields")
	sim2.research(armory, "ballistics")
	for k in 3:
		sim2.market_buy(market, "food")
	sim2.market_sell(market, "wood")
	if temple > 0:
		sim2.train(temple, "minotaur")
		sim2.train(temple, "minotaur")
	sim2.tick(12 * 30)   # Copper Shields 40 % done
	# then a purse that leaves some techs short (the favor of most god techs)
	sim2.set_player_resources(1, {"food": 1450.0, "wood": 980.0, "gold": 1210.0, "favor": 16.0})
	var pick := str(g.args.get("techui_sel", "armory"))
	var sel := market if pick == "market" else temple if pick == "temple" and temple > 0 else armory
	var focus: Vector2i = lots[1] if sel == market else lots[0]
	ctx["focus"] = Vector2(focus.x + 2.0, focus.y + 2.0)
	ctx["select"] = [sel]
	ctx["tip_slot"] = int(g.args.get("techui_tip", 0))
	print("techui: armory %d market %d temple %d, selected %d" % [armory, market, temple, sel])
	return ctx

## The "egyptui" capture scene (Godot-only): the "egypt" scene's Ra town
## (sim/civ/egypt_scene.cpp) put back in the Classical Age with Bast chosen
## (Rain and Eclipse in the god-power slots), a purse that leaves some
## buttons short, and one unit or building selected with a command tooltip
## open: a Laborer (the build grid, the Granary's tooltip), the Pharaoh (his
## Empower command), the Town Center (the age-up's two minor gods, Sobek and
## Sekhmet: the god pick), a Temple or a Priest.
##   node scripts/godot-shoot.mjs --scene egyptui --width 1920 --height 1080
##     [--params "egyptui_sel=pharaoh"]   # laborer (default) | pharaoh | tc (= god) | temple | priest
##     [--params "egyptui_tip=5"]         # the command slot whose tooltip is open (-1: none)
static func _egyptui_setup(g: Node) -> Dictionary:
	var sim2: Object = g.sim
	var ctx: Dictionary = sim2.setup_scene("egypt", g.scene_opts())
	sim2.set_player_age(1, 1)
	if sim2.has_method("set_minor_god"):
		sim2.set_minor_god(1, 1, "bast")
	sim2.set_player_resources(1, {"food": 820.0, "wood": 340.0, "gold": 610.0, "favor": 45.0})
	var pick := str(g.args.get("egyptui_sel", "laborer"))
	if pick == "god":
		pick = "tc"
	var cs: Dictionary = sim2.get_civ_state(1)
	var sel := 0
	var tip := 1
	match pick:
		"pharaoh":
			sel = int(cs.get("pharaoh", 0))
			tip = 0
		"tc":
			sel = int(cs.get("home_tc", 0))
			tip = 4
		"temple", "priest", "laborer":
			if pick == "temple":
				var B: Dictionary = sim2.get_buildings()
				for i in int(B.count):
					if int(B.owner[i]) == 1 and B.type_names[B.type[i]] == "temple":
						sel = int(B.ids[i])
				tip = 0
			else:
				var u: Dictionary = sim2.get_units()
				var names: PackedStringArray = sim2.unit_type_names()
				var f: Vector2 = ctx.get("focus", Vector2.ZERO)
				var best := 1e9
				for i in int(u.count):
					if int(u.owner[i]) != 1 or names[u.type[i]] != pick:
						continue
					var dd := Vector2(u.pos[i * 2], u.pos[i * 2 + 1]).distance_to(f)
					if dd < best:
						best = dd
						sel = int(u.ids[i])
				tip = 1 if pick == "laborer" else 0
	if sel > 0:
		var k := int(sim2.entity_kind(sel))
		var e: Dictionary = sim2.get_unit(sel) if k == 1 else sim2.get_building(sel)
		if not e.is_empty():
			ctx["focus"] = Vector2(float(e.x), float(e.z) + 3.0)
		ctx["select"] = [sel]
	ctx["tip_slot"] = int(g.args.get("egyptui_tip", tip))
	print("egyptui: selected %s %d, tooltip slot %d" % [pick, sel, int(ctx.tip_slot)])
	return ctx

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
	var wall_done := false
	for e in events:
		match str(e.type):
			"building:completed":
				if int(e.owner) == me and t > 0.0:
					var b: Dictionary = sim.get_building(e.id)
					if not b.is_empty() and (b.type == "wall" or b.type == "wall_pillar" or b.type == "gate"):
						wall_done = true  # one notice per finished line, below
					elif not b.is_empty():
						batch.append(["%s built." % _name_of({"kind": "building", "type": b.type}), false])
			"tech:researched":
				if int(e.owner) == me:
					var names: PackedStringArray = sim.fort_tech_names()
					var tk := int(e.a) - 1
					if tk >= 0 and tk < names.size():
						batch.append(["%s researched." % str(_tech_def(names[tk]).get("name", names[tk])), true])
					elif int(e.a) >= 100 and int(e.a) - 100 < _tech_names.size():
						# an Armory / Market / Temple tech (a = 100 + its id)
						batch.append(["%s researched." % str(sim.get_tech_def(_tech_names[int(e.a) - 100]).get("name", "")), true])
					_hud_t = 0.0
			"unit:trained":
				if int(e.owner) == me and t > 0.0:
					var u: Dictionary = sim.get_unit(e.id)
					if not u.is_empty():
						batch.append(["%s trained." % _defs.get(u.type, {}).get("name", u.type), false])
			"villager:free":
				if int(e.owner) == me:
					batch.append(["Your Town Center calls a new %s." % ("Laborer" if egypt() else "villager"), true])
			"age:advanced":
				if int(e.owner) == me:
					batch.append(["You reached the %s Age!" % AGES[clampi(int(e.a), 0, 3)], true])
			"godpower:cast":
				var pnames: PackedStringArray = sim.power_names()
				var pn: String = pnames[clampi(int(e.a), 0, pnames.size() - 1)]
				if int(e.owner) == me:
					batch.append(["You use the %s God Power!" % _pdefs[pn].name, true])
				elif sim.is_enemy(me, int(e.owner)):
					batch.append(["%s uses the %s God Power!" % [str(sim.get_player(int(e.owner)).get("name", "The enemy")), _pdefs[pn].name], false])
			"player:defeated":
				if int(e.owner) != me:
					var dn := str(sim.get_player(int(e.owner)).get("name", "A player"))
					batch.append(["%s%s has been defeated." % ["Your ally " if sim.is_ally(me, int(e.owner)) else "", dn], true])
			"game:over":
				_show_result(int(e.owner), float(e.amount))
	# notices from a fast-forward arrive together: keep the latest of a kind
	# (the older ones would already have faded, as in the browser)
	if wall_done:
		var W: Dictionary = sim.get_walls()
		var left := 0
		for i in int(W.count):
			if int(W.owner[i]) == me and int(W.kind[i]) != 3 and int(W.built[i]) == 0:
				left += 1
		if left == 0:
			batch.append(["%s finished." % str(sim.get_fortify(me).get("wall_name", "Wall")), false])
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
	# teams (match rules): the match is won by a team
	var won: bool = winner == me or (winner != 0 and bool(sim.is_ally(me, winner)))
	var teamed := false
	for pid in sim.get_player_ids():
		if int(pid) != 0 and int(pid) != me and sim.is_ally(me, int(pid)):
			teamed = true
	var foes := 0
	for pid in sim.get_player_ids():
		if int(pid) != 0 and sim.is_enemy(me, int(pid)):
			foes += 1
	var win_text := "Every enemy Town Center has fallen." if foes > 1 else "The enemy Town Center has fallen."
	var lose_text := "Your team's last Town Center has fallen." if teamed else "Your last Town Center has fallen."
	result = {"won": won, "kicker": "%s  ·  %s Age  ·  %02d:%02d" % [p.get("god", "Zeus"), AGES[clampi(int(p.get("age", 0)), 0, 3)], s / 60, s % 60],
		"text": win_text if won else lose_text}
	result_shown = true
	_cancel_mode()
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
			"age": ROMAN[clampi(int(p.age), 0, 3)], "score": score_arr[int(pid)] + int(p.age) * 100, "team": int(p.get("team", pid))})
	# teams (match rules): the list grouped by team, the local player's first;
	# "team_label" on a team's first row when some team has two players or more
	var members := {}
	for r in rows:
		members[r.team] = int(members.get(r.team, 0)) + 1
	var teamed := false
	for t in members:
		teamed = teamed or int(members[t]) > 1
	if teamed:
		var my_team := int(sim.get_team(me))
		var tlist := []
		for r in rows:
			if not tlist.has(r.team):
				tlist.append(r.team)
		tlist.sort_custom(func(a, b): return (a == my_team and b != my_team) or ((a == my_team) == (b == my_team) and a < b))
		var sorted := []
		for ti in tlist.size():
			var first := true
			var total := 0
			for r in rows:
				if r.team == tlist[ti]:
					total += int(r.score)
			for r in rows:
				if r.team != tlist[ti]:
					continue
				if first:
					r["team_label"] = "Team %d" % (ti + 1)
					r["team_score"] = total
					first = false
				sorted.append(r)
		rows = sorted
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
	var c2 := str(p.get("civ", "greek"))
	if c2 != civ:
		civ = c2
		_mbdefs.clear()
	# god powers: the ones my gods give (player_powers: the Greeks' three, an
	# Egyptian's major god's and one per minor god chosen), with their ramped cost
	powers = []
	var pkeys: Array = Array(sim.player_powers(me)) if sim.has_method("player_powers") else Array(sim.power_names())
	for k in pkeys:
		var def: Dictionary = _pdefs.get(k, {})
		if def.is_empty():
			continue
		var cc: Dictionary = sim.can_cast(me, k)
		var pinfo: Dictionary = sim.get_power_info(me, k) if sim.has_method("get_power_info") else {}
		var left := float(sim.power_cooldown(me, k))
		powers.append({"key": k, "def": def, "icon": POWER_ICONS.get(k, k), "can": bool(cc.ok), "reason": str(cc.reason),
			"cd": clampf(left / maxf(0.001, float(def.cooldown)), 0.0, 1.0), "cd_left": left,
			"cost": float(pinfo.get("cost", def.get("favor", 0))), "target": str(pinfo.get("target", "point")),
			"active": _mode.get("kind", "") == "power" and _mode.get("id", "") == k})
	if egypt():
		_egypt_hud_state()
	if sig != _cmd_sig:
		_cmd_sig = sig
	_fort = sim.get_fortify(me)
	_walls_cache = sim.get_walls()
	_sel_tower = _tower_ring_of_selection()
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
	var tech_bld := {}   # a finished building of the player that researches / trades
	var us := sel.filter(func(e): return e.kind == "unit")
	var age := int(player.get("age", 0))
	if not us.is_empty():
		var builders := [] if egypt() else us.filter(func(e): return bool(_defs[e.type].get("builder", false)))
		if egypt():
			_egypt_unit_commands(us, list)
		if not builders.is_empty():
			for t in BUILD_MENU:
				if not _bdefs.has(t):
					continue
				var d: Dictionary = _bdef(t)
				var ok_age := int(d.get("min_age", 0)) <= age
				var c := {"key": str(d.hotkey), "tex": _portraits.building(t, me), "title": "Build %s" % d.name, "cost": d.cost,
					"enabled": ok_age and _can_afford(d.cost), "action": "build", "arg": t,
					"warn": "" if ok_age else "Requires the %s Age" % AGES[int(d.min_age)]}
				if not ok_age:
					c["age_req"] = int(d.min_age)
				if BUILD_LINES.has(t):
					c["lines"] = BUILD_LINES[t] + ["%d hp · %s Age" % [int(d.get("hp", 0)), AGES[clampi(int(d.get("min_age", 0)), 0, 3)]]]
				if t == "wall":
					c.title = "Build Wall"
					c.action = "wall"
					c.lines = ["Click and drag on the ground to draw a line;", "it joins your walls it touches.",
						"%s · %d hp per tile" % [str(_fort.get("wall_name", d.name)), int(_fort.get("wall_tile_hp", d.get("hp", 0)))],
						"Cost per tile · %s Age" % AGES[int(d.get("min_age", 0))]]
				elif t == "tower":
					var lv := int(_fort.get("tower_level", 0))
					var tw: Dictionary = _fort.get("tower", {})
					c.tex = _portraits.fort("tower", me, lv)
					c.title = "Build %s" % str(_fort.get("tower_name", d.name))
					c.lines = ["Shoots arrows at enemies in range %s." % _num(tw.get("range", 10)),
						"%d hp · %s Age" % [int(tw.get("hp", d.get("hp", 0))), AGES[int(d.get("min_age", 0))]]]
				list.append(c)
		if not _military(us).is_empty():
			list.append({"key": "A", "svg": "attack", "title": "Attack-Move (A)", "enabled": true, "action": "attack_move", "slot": 13})
		list.append({"key": "X", "svg": "stop", "title": "Stop", "enabled": true, "action": "stop", "slot": 14})
	else:
		var b: Dictionary = sel[0]
		if b.kind == "building" and bool(b.get("built", false)):
			var bd: Dictionary = _bdefs[b.type]
			if egypt():
				_egypt_trains(b, list)
			for t in ([] if egypt() else bd.get("trains", [])):
				var d: Dictionary = _defs[t]
				var ok := int(d.get("min_age", 0)) <= age
				var tc := {"key": str(d.hotkey), "tex": _portraits.unit(t, me), "title": "Train %s" % d.name,
					"cost": d.cost, "enabled": ok and _can_afford(d.cost), "action": "train", "arg": t}
				if not ok:
					tc["warn"] = "Requires the %s Age" % AGES[int(d.min_age)]
					tc["age_req"] = int(d.min_age)
				list.append(tc)
			if bool(bd.get("age_up", false)) and age + 1 < AGES.size() and egypt():
				_egypt_age_commands(list)
			elif bool(bd.get("age_up", false)) and age + 1 < AGES.size():
				var cost: Dictionary = sim.next_age_cost(me)
				var adv := bool(player.get("advancing", false))
				list.append({"key": "A", "svg": "age", "title": ("Advancing to the %s Age..." if adv else "Advance to the %s Age") % AGES[age + 1],
					"cost": cost, "enabled": not adv and _can_afford(cost), "action": "age", "slot": 4})
			if FORT_TYPES.has(str(b.type)):
				_fort_commands(b, list)
			else:
				tech_bld = b
				if str(b.type) == "market":
					_market_commands(b, list)
	var i := 0
	for c in list:
		if c.has("slot") and slots[c.slot] == null:
			slots[c.slot] = c
		else:
			while i < 15 and slots[i] != null:
				i += 1
			if i < 15:
				slots[i] = c
	if not tech_bld.is_empty():
		_tech_slots(slots, tech_bld)
	var sb: Dictionary = sel[0] if sel[0].kind == "building" else {}
	for c in slots:
		if c != null:
			_auto_state(c, sb)
	return slots

# ---- the Egyptians (PORTING.md "Egyptian HUD") -------------------------------------------------

func egypt() -> bool:
	return civ == "egyptian"

## A building's def with my civ's cost, trains, min age and hotkey (cached per match).
func _bdef(t: String) -> Dictionary:
	if not _mbdefs.has(t):
		var d: Dictionary = sim.get_building_def(t, me)
		var by: Dictionary = d.get("by_civ", {}).get(civ, {})
		if not by.is_empty():
			d["cost"] = by.get("cost", d.get("cost", {}))
			d["min_age"] = int(by.get("min_age", d.get("min_age", 0)))
			d["build_time_one"] = float(by.get("build_time", 0.0))
		_mbdefs[t] = d
	return _mbdefs[t]

## The next Monument in order (the first one not standing or laid), else the last.
func _next_monument() -> String:
	var have := {}
	var B: Dictionary = sim.get_buildings()
	var tn: PackedStringArray = B.type_names
	for i in int(B.count):
		if int(B.owner[i]) == me:
			have[tn[B.type[i]]] = true
	for m in MONUMENTS:
		if not have.has(m):
			return m
	return MONUMENTS[MONUMENTS.size() - 1]

## The HUD's Egyptian state: favor from the Monuments (the resource strip's
## favor cell counts them), the worker word, the gods for the medallion.
func _egypt_hud_state() -> void:
	var cs: Dictionary = sim.get_civ_state(me)
	var mons: Array = cs.get("monuments", [])
	var built := mons.filter(func(m): return bool(m.built))
	hud_state["worker_word"] = "Laborers"
	hud_state["favor_lines"] = ["Made by your Monuments: %d of 5 standing" % built.size(),
		"+%s favor / min now (empowered: +%d %%)" % [_num(float(cs.get("favor_per_min", 0.0))), int(round(float(cs.get("empower_favor", 0.2)) * 100))],
		"Spent on god powers, myth units and techs"]
	hud_state["n_favor"] = built.size()
	var gods: Dictionary = sim.get_gods(me) if sim.has_method("get_gods") else {}
	var picked := []
	for a in [1, 2, 3]:
		var g := str(gods.get("minor", {}).get(a, ""))
		if g != "":
			picked.append("%s (%s)" % [str(EgyptIcons.MINOR.get(g, {}).get("name", g.capitalize())), AGES[a]])
	hud_state["minor_gods"] = picked

## One Egyptian build button (EGYPT_GRID): his civ's cost, the reason it is
## refused (can_build: the age, the Monument order, a limit), Retold's help.
func _egypt_build_cmd(t: String, key: String, slot: int) -> Dictionary:
	var real := _next_monument() if t == "monument" else t
	var d: Dictionary = _bdef(real)
	var age := int(player.get("age", 0))
	var cb: Dictionary = sim.can_build(me, real)
	var ok := bool(cb.ok)
	var c := {"key": key, "slot": slot, "tex": _portraits.building(real, me), "title": "Build %s" % str(d.get("name", real)), "cost": d.get("cost", {}),
		"enabled": ok and _can_afford(d.get("cost", {})), "action": "build", "arg": real}
	if not ok:
		c["warn"] = str(cb.reason) if str(cb.reason) != "" else "Cannot build that yet"
		if int(d.get("min_age", 0)) > age:
			c["age_req"] = int(d.min_age)
	var lines: Array = (EGYPT_LINES.get(real, []) + BUILD_LINES.get(real, [])).duplicate()
	if real.begins_with("monument_"):
		var cs: Dictionary = sim.get_civ_state(me)
		lines = ["+%s favor / min (Monument %d of 5, in order)." % [_num(float(d.get("favor_per_min", 0.0))), int(d.get("monument", 1))],
			"Empowered: more favor (%s: +%d %%)." % [str(cs.get("god", "ra")).capitalize(), int(round(float(cs.get("empower_favor", 0.2)) * 100))]]
	var bt := float(d.get("build_time_one", 0.0))
	lines.append("%d hp · %s Age%s" % [int(d.get("hp", 0)), AGES[clampi(int(d.get("min_age", 0)), 0, 3)], " · %d s for one builder" % int(round(bt)) if bt > 0.0 else ""])
	c["lines"] = lines
	if real == "wall":
		c.title = "Build Wall"
		c.action = "wall"
		c.lines = ["Click and drag on the ground to draw a line;", "it joins your walls it touches.",
			"%s · %d hp per tile" % [str(_fort.get("wall_name", d.get("name", "Wall"))), int(_fort.get("wall_tile_hp", d.get("hp", 0)))],
			"Cost per segment · %s Age" % AGES[clampi(int(d.get("min_age", 0)), 0, 3)]]
	elif real == "tower":
		var tw: Dictionary = _fort.get("tower", {})
		c.title = "Build %s" % str(_fort.get("tower_name", d.get("name", "Tower")))
		c.lines = ["Shoots arrows at enemies in range %s." % _num(tw.get("range", 10)),
			"%d hp · %s Age" % [int(tw.get("hp", d.get("hp", 0))), AGES[clampi(int(d.get("min_age", 0)), 0, 3)]]]
	return c

## The Egyptian units' commands: the Laborers' build grid, a Priest's Obelisk,
## the Pharaoh's (and Ra's Priests') Empower, Set's Pharaoh's summons.
func _egypt_unit_commands(us: Array, list: Array) -> void:
	var labs := us.filter(func(e): return str(e.type) == "laborer")
	var priests := us.filter(func(e): return str(e.type) == "priest")
	var phar := us.filter(func(e): return str(e.type) == "pharaoh")
	var god := str(player.get("god", "")).to_lower()
	if not labs.is_empty():
		for i in EGYPT_GRID.size():
			list.append(_egypt_build_cmd(str(EGYPT_GRID[i][0]), str(EGYPT_GRID[i][1]), i))
		return
	if not priests.is_empty():
		list.append(_egypt_build_cmd("obelisk", "Q", 0))
	var empowerers := phar.size() + (priests.size() if god == "ra" else 0)
	if empowerers > 0:
		var strength := "a Pharaoh's full strength" if not phar.is_empty() else "60 % (Ra's Priests)"
		list.append({"key": "W" if phar.is_empty() else "Q", "slot": 1 if phar.is_empty() else 0, "svg": "empower", "title": "Empower",
			"lines": ["Click one of your buildings: he walks to it and empowers it", "(%s): work +75 %%, drops +20 %%, Monument favor up." % strength,
				"Right-click a building does the same."], "enabled": true, "action": "empower"})
	if phar.size() == 1 and god == "set":
		var menu: Array = sim.get_summon_menu(int(phar[0].id))
		var keys := ["A", "S", "D", "F", "G", "Y", "U", "I"]
		for j in mini(menu.size(), keys.size()):
			var m: Dictionary = menu[j]
			var c := {"key": keys[j], "slot": 5 + j, "tex": _portraits.unit(str(m.type), me), "title": "Summon %s" % str(m.name), "cost": m.cost,
				"time": float(m.time), "lines": ["An Animal of Set appears beside the Pharaoh (%d pop);" % int(m.pop), "its carcass feeds your Laborers."],
				"enabled": bool(m.ok), "action": "summon", "arg": [int(phar[0].id), str(m.type)]}
			if not bool(m.ok) and not str(m.reason).begins_with("Not enough"):
				c["warn"] = str(m.reason)
				if int(m.age) > int(player.get("age", 0)):
					c["age_req"] = int(m.age)
			list.append(c)

## An Egyptian building's train buttons (get_trains: his civ's list, Devotees' cost,
## the locks: a Temple for Priests, the minor god for a myth unit, the age).
func _egypt_trains(b: Dictionary, list: Array) -> void:
	var trains: Array = sim.get_trains(int(b.id))
	var age := int(player.get("age", 0))
	var keys := ["Q", "W", "E", "R", "T", "A", "S", "D", "F", "G", "Y", "U", "I", "O", "P"]
	var tc := str(b.type) == "town_center"
	var j := 0
	for tr in trains:
		var t := str(tr.type)
		var d: Dictionary = _defs.get(t, {})
		if d.is_empty():
			continue
		# a myth unit of a minor god not chosen stays off the Temple's grid once his age's god is picked
		var reason := str(tr.reason)
		if reason.begins_with("Requires the minor god") and _minor_chosen_for(int(d.get("min_age", 1))):
			continue
		while tc and (j == 4 or j == 9):
			j += 1   # (the Town Center's age-up buttons)
		if j >= keys.size():
			break
		var c := {"key": keys[j], "slot": j, "tex": _portraits.unit(t, me), "title": "Train %s" % str(d.get("name", t)), "cost": tr.cost,
			"enabled": bool(tr.ok) and _can_afford(tr.cost), "action": "train", "arg": t, "time": float(d.get("train_time", 0.0))}
		var line := str(EGYPT_TRAIN_LINES.get(t, ""))
		if line == "" and str(d.get("god", "")) != "":
			line = "Myth unit of %s." % str(d.god).capitalize()
		c["lines"] = [line] if line != "" else []
		if tr.has("devotees"):
			c.lines.append("Devotees: -10 % near your Monument.")
		if not bool(tr.ok) and not reason.begins_with("Not enough") and reason != "Need more houses":
			c["warn"] = reason
			if int(d.get("min_age", 0)) > age:
				c["age_req"] = int(d.min_age)
		elif not bool(tr.ok):
			c["deny"] = reason
		list.append(c)
		j += 1

## Has the player chosen the minor god of `age` (1..3)?
func _minor_chosen_for(age: int) -> bool:
	if not sim.has_method("get_gods"):
		return false
	return str(sim.get_gods(me).get("minor", {}).get(clampi(age, 1, 3), "")) != ""

## The Town Center's age-up for an Egyptian: one button per minor god his major
## god offers for the next age (Retold: the god is chosen with the age-up);
## while advancing, the chosen god's button shows the progress.
func _egypt_age_commands(list: Array) -> void:
	var age := int(player.get("age", 0))
	var nxt := age + 1
	var cost: Dictionary = sim.next_age_cost(me)
	var adv := bool(player.get("advancing", false))
	var god := str(player.get("god", "ra")).to_lower()
	var offer := EgyptIcons.offered(sim, god, nxt)
	var chosen := ""
	if sim.has_method("get_gods"):
		chosen = str(sim.get_gods(me).get("minor", {}).get(nxt, ""))
	for k in mini(offer.size(), 2):
		var g: String = offer[k]
		var info: Dictionary = EgyptIcons.MINOR.get(g, {"name": g.capitalize(), "power": "", "focus": ""})
		var pk := str(info.power)
		var pname := str(_pdefs.get(pk, {}).get("name", pk.capitalize()))
		var units := []
		for t in _names:
			if str(_defs[t].get("god", "")).to_lower() == g:
				units.append(str(_defs[t].name))
		var lines := ["%s: %s." % [str(info.name), str(info.focus)], "God power: %s" % pname]
		if not units.is_empty():
			lines.append("Myth unit%s: %s" % ["s" if units.size() > 1 else "", ", ".join(units)])
		var c := {"key": ["A", "S"][k], "slot": [4, 9][k], "minor": g, "svg": "mg_" + g,
			"title": ("Advancing to the %s Age (%s)..." if adv else "Advance to the %s Age: %s") % [AGES[nxt], str(info.name)],
			"cost": cost, "lines": lines, "enabled": not adv and _can_afford(cost), "action": "age_god", "arg": g}
		if adv:
			c["enabled"] = false
			if chosen == g:
				c["progress"] = float(hud_state.get("adv", 0.0))
				_set_state(c, "researching", "Advancing · %d%%" % int(floor(float(hud_state.get("adv", 0.0)) * 100)))
			else:
				c["warn"] = "Advancing with %s" % str(EgyptIcons.MINOR.get(chosen, {}).get("name", chosen.capitalize()))
		list.append(c)

# ---- research and trade commands (sim/techs; PORTING.md "Research panel, tooltips, market") ----

var _tech_names: PackedStringArray
var _tech_page := 0
var _tech_page_of := 0          # the building the page belongs to
var _ptechs := {}               # get_player_techs(me), refreshed with the HUD

## Which of a building's techs get a button: not done (researched techs leave
## the grid; the card lists them), not "unavailable" (their unit is
## not in this game); a line shows only its next tier (Bronze once Copper is
## done; greyed until its age); a god's techs appear in his age (Retold: with
## the god), all gods' while no minor god is chosen, only his once one is;
## a tech being researched or queued keeps its button (state "researching" /
## "queued": a progress sweep, its place in the queue); the step after a tech
## under way (`busy`: researching / queued) shows padlocked, "Requires <it>",
## so the line's next step is seen waiting on the one in progress.
func _tech_visible(te: Dictionary, done: Dictionary, busy := {}) -> bool:
	var st := str(te.state)
	if st == "unavailable" or st == "done" or st == "locked_god":
		return false
	if st == "researching" or st == "queued":
		return true   # stays on its button with the progress sweep / queue badge
	if st == "locked_prereq" and busy.has(str(te.requires)):
		return true   # padlocked: waits on the tech under way
	if str(te.requires) != "" and not done.has(str(te.requires)):
		return false
	if not bool(te.generic) and int(te.age) > int(player.get("age", 0)):
		return false
	return true

## Retold-style effect bullets ("Human Soldier: Attack +10%") from a tech's effects.
func _tech_bullets(te: Dictionary) -> Array:
	var out := []
	for f in te.get("effects", []):
		var v := float(f.value)
		var what := ""
		match str(f.kind):
			"attack": what = "Attack %+d%%" % int(round(v * 100))
			"hack_armor": what = "Vulnerability to Hack attacks -%d%%" % int(round(v * 100))
			"pierce_armor": what = "Vulnerability to Pierce attacks -%d%%" % int(round(v * 100))
			"hp": what = "Hitpoints +%d%% of base" % int(round(v * 100))
			"speed": what = "Speed +%d%%" % int(round(v * 100))
			"range": what = "Range +%s" % _num(snappedf(v, 0.1))
			"sight": what = "Line of Sight +%s" % _num(snappedf(v, 0.1))
			"regen": what = "Regeneration Rate +%s per second" % _num(v)
			"reload": what = "Rate of fire %+d%%" % int(round((v - 1.0) * 100))
			"splash": what = "Area damage radius +%s" % _num(snappedf(v, 0.1))
			"divine": what = "+%s divine damage per attack" % _num(v)
			"vs_buildings": what = "Damage vs buildings +%sx" % ("%.1f" % v)
			"vs_myth": what = "Damage vs myth units +%sx" % ("%.1f" % v)
			"arrow_speed": what = "Projectile speed +%d%%" % int(round(v * 100))
			"track": what = "Track rating +%s" % _num(v)
			"poison": what = "Poison %s damage/s for 6 s" % _num(v)
			"heal_aura": what = "Heals nearby units %s hp/s" % _num(v)
			"favor": what = "Favor rate +%d%%" % int(round(v * 100))
			"market_fee": what = "Market fee %d%%" % int(round(v * 100))
			"tribute_fee": what = "Tribute fee %d%%" % int(round(v * 100))
		if what == "":
			continue
		var groups := _class_groups(Array(f.get("units", [])))
		for who in groups:
			out.append("%s: %s" % [who, what])
		if bool(f.get("buildings", false)):
			out.append("Buildings: %s" % what)
		if groups.is_empty() and not bool(f.get("buildings", false)):
			out.append(what)
	return out

## Retold's unit classes of a tech's units: "All Units", "Human Soldier"
## (hoplite, toxotes, hippikon), "Hero", "Myth Unit" (the four myth units),
## else each unit's name.
func _class_groups(units: Array) -> Array:
	if units.is_empty():
		return []
	var set := {}
	for u in units:
		set[str(u)] = true
	if set.size() >= maxi(9, _defs.size()):
		return ["All Units"]
	var out := []
	var human := ["hoplite", "toxotes", "hippikon"]
	# (sim/civ) the Egyptian human soldiers and heroes share the Greek classes
	var eg_human := ["spearman", "axeman", "slinger", "chariot_archer", "camel_rider", "war_elephant", "mercenary", "mercenary_cavalry"]
	var myth := ["minotaur", "cyclops", "centaur", "medusa"]
	if human.all(func(k): return set.has(k)):
		out.append("Human Soldier")
		for k in human: set.erase(k)
		if eg_human.all(func(k): return set.has(k)):
			for k in eg_human: set.erase(k)
	if myth.all(func(k): return set.has(k)):
		out.append("Myth Unit")
		for k in myth: set.erase(k)
	if set.has("hero"):
		out.append("Hero")
		set.erase("hero")
		for k in ["priest", "pharaoh"]: set.erase(k)
	for u in units:
		if set.has(str(u)):
			out.append(str(_defs[u].name) if _defs.has(u) else str(u).capitalize())
	return out

## The command of one tech button (tooltip: name, cost and time, Retold's
## effect, per-class bullets, age / building, the lock's reason).
func _tech_command(bid: int, btype: String, te: Dictionary) -> Dictionary:
	var st := str(te.state)
	var cost: Dictionary = te.cost
	var t := float(te.time)
	if btype == "armory" and bool(_ptechs.get("armory_discount", false)):
		t /= 1.5   # Forge of Olympus: +50 % research speed at the Armory
	var foot := ["%s Age · %s" % [str(te.age_name), str(_bdefs[str(te.building)].name) if _bdefs.has(str(te.building)) else ""]]
	if str(te.also) != "" and _bdefs.has(str(te.also)):
		foot.append("Also researched at the %s" % _bdefs[str(te.also)].name if str(te.building) == btype else "Also researched at the %s" % _bdefs[str(te.building)].name)
	if str(te.god) != "":
		foot.append("God: %s" % str(te.god).capitalize())
	var lines := [str(te.text)]
	var short := _short_of(cost)
	var deny := "" if short.is_empty() else "Not enough %s" % short[0]
	var c := {"key": "", "svg": TechIcons.icon_for(str(te.key)), "title": str(te.name), "cost": cost, "time": t,
		"lines": lines, "bullets": _tech_bullets(te), "foot": foot, "wide": true,
		"frame": "gold" if bool(te.generic) else "purple", "tech": str(te.key),
		"tier": TechIcons.tier_of(str(te.key)), "god": str(te.god),
		"enabled": st == "available" and deny == "", "locked": st.begins_with("locked"),
		"warn": str(te.reason) if st.begins_with("locked") else "", "deny": deny,
		"action": "research", "arg": [bid, str(te.key)]}
	match st:
		"available":
			if short.is_empty():
				_set_state(c, "available", "Click to research")
			else:
				c["short"] = short
				_set_state(c, "unaffordable", _short_text(cost))
		"researching", "queued":
			var p := float(te.get("progress", 0.0))
			var here := int(te.get("at", bid)) == bid
			var where := "" if here else " at another %s" % (str(_bdefs[str(te.building)].name) if _bdefs.has(str(te.building)) else "building")
			c["progress"] = p if st == "researching" else 0.0
			c["count"] = int(te.get("queue_index", 0)) + 1
			if st == "researching":
				c.deny = "%s: researching%s, %s left" % [str(te.name), where, _secs_text((1.0 - p) * t)]
				_set_state(c, "researching", "%d%% · %s left%s · cancel it from the queue" % [int(floor(p * 100)), _secs_text((1.0 - p) * t), where])
			else:
				c.deny = "%s: queued%s" % [str(te.name), where]
				_set_state(c, "queued", "%s in the queue%s · cancel it from the queue" % [_ordinal(int(c.count)), where])
		_:
			if st == "locked_age":
				c["age_req"] = int(te.age)
			_set_state(c, "locked", str(te.reason))
	return c

## A command's state, the language every command button speaks (PORTING.md
## "Command button states"): "available", "unaffordable" (c.short: the
## missing resources), "locked" (c.age_req: the age it waits for, else a
## prerequisite), "researching" / "training" (c.progress, c.count),
## "queued" (c.count: its place in the queue). The tooltip says it in words.
static func _set_state(c: Dictionary, st: String, why: String) -> void:
	c["state"] = st
	var word: String = {"available": "Available", "unaffordable": "Can't afford", "locked": "Locked",
		"researching": "Researching", "training": "Training", "queued": "Queued"}.get(st, st.capitalize())
	c["status"] = {"state": st, "text": word + (" · " + why if why != "" else "")}

## The resources a cost is short of, in cost order.
func _short_of(cost: Dictionary) -> Array:
	var out := []
	for k in cost:
		if float(player.get(k, 0.0)) < float(cost[k]):
			out.append(str(k))
	return out

## "Need 40 more gold, 10 more favor".
func _short_text(cost: Dictionary) -> String:
	var parts := []
	for k in cost:
		var need := float(cost[k]) - float(player.get(k, 0.0))
		if need > 0.0:
			parts.append("%d more %s" % [int(ceil(need)), k])
	return "Need " + ", ".join(parts)

static func _secs_text(t: float) -> String:
	return "%ds" % int(ceil(maxf(t, 0.0)))

static func _ordinal(n: int) -> String:
	return str(n) + ("st" if n == 1 else "nd" if n == 2 else "rd" if n == 3 else "th")

## The state of a train / build / age / trade command that has none yet:
## locked by its age (c.age_req) or another reason (c.warn), else short of
## its cost, else training (b's queue holds this unit: the head's progress
## and the count queued), else available.
func _auto_state(c: Dictionary, b: Dictionary) -> void:
	if c.has("state"):
		return
	if str(c.get("warn", "")) != "":
		_set_state(c, "locked", str(c.warn))
		return
	var cost: Dictionary = c.get("cost", {})
	if str(c.get("action", "")) == "train" and not b.is_empty():
		var n := 0
		var p := 0.0
		var q: Array = b.get("queue", [])
		for k in q.size():
			if str(q[k].type) == str(c.arg):
				if n == 0 and k == 0:
					p = float(q[k].t) / maxf(0.001, float(q[k].total))
				n += 1
		if n > 0:
			c["count"] = n
			c["progress"] = p
			c["short"] = _short_of(cost)
			_set_state(c, "training", "%d queued%s" % [n, " · %d%%" % int(floor(p * 100)) if p > 0.0 else ""] + ("" if c.short.is_empty() else " · " + _short_text(cost)))
			return
	var short := _short_of(cost)
	if not short.is_empty():
		c["short"] = short
		_set_state(c, "unaffordable", _short_text(cost))
	elif bool(c.get("enabled", true)):
		_set_state(c, "available", "")

## Place a building's tech buttons in the free slots of the grid (the
## Armory's generic lines by column in the top row, god techs below; at a
## building that trains, below its train buttons), with the slot's letter as
## hotkey unless another button has it; more than fit: the last free slot
## pages through them.
func _tech_slots(slots: Array, b: Dictionary) -> void:
	var bid := int(b.id)
	var btype := str(b.type)
	var techs: Array = sim.get_techs(bid)
	if techs.is_empty():
		return
	_ptechs = sim.get_player_techs(me)
	var done := {}
	for k in _ptechs.get("done", []):
		done[str(k)] = true
	var busy := {}
	for te in techs:
		if str(te.state) == "researching" or str(te.state) == "queued":
			busy[str(te.key)] = true
	var generic := []
	var gods := []
	for te in techs:
		if not _tech_visible(te, done, busy):
			continue
		(generic if bool(te.generic) else gods).append(te)
	var used := {}
	for c in slots:
		if c != null and str(c.key) != "":
			used[str(c.key)] = true
	var put := func(slot: int, c: Dictionary) -> void:
		var k: String = SLOT_KEYS[slot]
		if not used.has(k):
			c.key = k
			used[k] = true
		slots[slot] = c
	var rest := []
	if btype == "armory":
		for te in generic:
			var line := str(te.key)
			for l in ["weapons", "armor", "shields"]:
				if line.ends_with("_" + l):
					line = l
			var col := int(ARMORY_COLS.get(line, -1))
			if col >= 0 and slots[col] == null:
				put.call(col, _tech_command(bid, btype, te))
			else:
				rest.append(te)
		rest.append_array(gods)
	else:
		rest = generic + gods
	# the padlocked next steps after every buyable / greyed-by-age button
	rest = rest.filter(func(te): return str(te.state) != "locked_prereq") + rest.filter(func(te): return str(te.state) == "locked_prereq")
	if rest.is_empty():
		return
	# free slots: below the top row when the building trains / ages up (or is the Armory), else from the top
	var top_busy := btype == "armory" or btype == "market" or not Array(_bdefs[btype].get("trains", [])).is_empty() or bool(_bdefs[btype].get("age_up", false))
	var order := []
	if btype == "market":
		order = [0, 1, 2, 3, 4, 10, 11, 12, 13, 14]
	elif top_busy:
		order = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 1, 2, 3, 4]
	else:
		order = range(15)
	var free := order.filter(func(k): return slots[k] == null)
	if free.is_empty():
		return
	if _tech_page_of != bid:
		_tech_page_of = bid
		_tech_page = 0
	var per: int = free.size() if rest.size() <= free.size() else free.size() - 1
	var pages := int(ceil(float(rest.size()) / float(maxi(1, per))))
	_tech_page = posmod(_tech_page, maxi(1, pages))
	var shown := rest.slice(_tech_page * per, _tech_page * per + per)
	for j in shown.size():
		put.call(int(free[j]), _tech_command(bid, btype, shown[j]))
	if pages > 1:
		put.call(int(free[free.size() - 1]), {"key": "", "svg": "fast", "title": "More techs (%d / %d)" % [_tech_page + 1, pages],
			"lines": ["%d techs here: show the next ones." % rest.size()], "enabled": true, "action": "tech_page"})

## The Market's exchange (Retold: buy / sell buttons with the live price):
## food and wood in lots of 100 for gold, the price moving with each trade.
func _market_commands(b: Dictionary, list: Array) -> void:
	var M: Dictionary = sim.get_market(me)
	var lot := int(M.get("lot", 100))
	var slot := 5
	for res in ["food", "wood"]:
		var m: Dictionary = M.get(res, {})
		if not bool(m.get("tradable", false)):
			continue
		var buy := int(m.buy)
		var sell := int(m.sell)
		var R: String = str(res).capitalize()
		list.append({"key": SLOT_KEYS[slot], "trade": res, "dir": "buy", "label": str(buy), "title": "Buy %d %s" % [lot, R],
			"cost": {"gold": buy}, "lines": ["Pay %d gold for %d %s." % [buy, lot, res], "Each purchase raises the price (now %d)." % int(m.price)],
			"enabled": float(player.get("gold", 0)) >= buy, "deny": "Not enough gold", "wide": true, "action": "trade", "arg": [int(b.id), res, "buy"], "slot": slot})
		list.append({"key": SLOT_KEYS[slot + 1], "trade": res, "dir": "sell", "label": str(sell), "title": "Sell %d %s" % [lot, R],
			"cost": {res: float(lot)}, "gain": {"gold": sell}, "lines": ["Get %d gold for %d %s." % [sell, lot, res], "Each sale lowers the price (now %d)." % int(m.price)],
			"enabled": float(player.get(res, 0)) >= lot, "deny": "Not enough %s" % res, "wide": true, "action": "trade", "arg": [int(b.id), res, "sell"], "slot": slot + 1})
		slot += 2

## A wall row of get_walls() (cached with the HUD) for a building id, or -1.
func _wall_row(id: int) -> int:
	if _walls_cache.is_empty():
		return -1
	var ids: PackedInt32Array = _walls_cache.ids
	return ids.find(id)

func _tech_def(key: String, owner := -1) -> Dictionary:
	var F: Dictionary = _fort if owner < 0 or owner == me else sim.get_fortify(owner)
	for te in F.get("techs", []):
		if str(te.key) == key:
			return te
	return {}

## Commands of a finished wall piece / gate / tower of the player: Convert
## to Gate (G) on a segment, Lock / Unlock (L) on a gate, the next wall or
## tower stage (U, researched for every piece of that line), cancel (X).
func _fort_commands(b: Dictionary, list: Array) -> void:
	var t := str(b.type)
	var id := int(b.id)
	var row := _wall_row(id)
	var tech := int(_walls_cache.tech[row]) if row >= 0 else 0
	if t == "wall" and _bdefs.has("gate"):
		var gd: Dictionary = _bdefs["gate"]
		list.append({"key": "G", "tex": _portraits.fort("gate", me), "title": "Convert to Gate", "cost": gd.cost,
			"lines": ["Opens for you and your allies,", "stays shut to your enemies."], "enabled": _can_afford(gd.cost), "action": "gate", "arg": id})
	elif t == "gate":
		var locked := row >= 0 and int(_walls_cache.locked[row]) != 0
		list.append({"key": "L", "svg": "unlock" if locked else "lock", "title": "Unlock Gate" if locked else "Lock Gate",
			"lines": ["Let your units and your allies' through again."] if locked else ["Nobody passes, not even your own units."],
			"enabled": true, "action": "lock", "arg": id, "on": not locked})
	var line := "tower" if t == "tower" else "wall"
	if tech > 0:
		var names: PackedStringArray = sim.fort_tech_names()
		var te := _tech_def(names[tech - 1]) if tech - 1 < names.size() else {}
		list.append({"key": "X", "svg": "stop", "title": "Cancel %s" % str(te.get("name", "research")), "lines": ["Refunds its cost."],
			"enabled": true, "action": "cancel_research", "arg": id, "slot": 14})
		return
	for te in _fort.get("techs", []):
		var st := str(te.state)
		if str(te.line) != line or st == "done" or st == "needs_previous":
			continue
		var ok_age := st != "needs_age"
		var c := {"key": "U", "title": "Upgrade to %s" % te.name, "cost": te.cost, "action": "research", "arg": [id, str(te.key)],
			"lines": ["Every %s of yours gains its strength." % ("tower" if line == "tower" else "wall piece"), "%s Age · %ds" % [AGES[clampi(int(te.min_age), 0, 3)], int(te.time)]],
			"enabled": st == "available" and _can_afford(te.cost),
			"warn": "Requires the %s Age" % AGES[clampi(int(te.min_age), 0, 3)] if not ok_age else ("Being researched elsewhere" if st == "researching" else "")}
		if line == "tower":
			c.tex = _portraits.fort("tower", me, int(te.level))
		else:
			c.svg = "upgrade"
		list.append(c)
		break

## Soldiers among unit dicts / ids (not villagers, with an attack): the ones an attack-move moves.
func _military(us: Array) -> Array:
	return us.filter(func(e): var d: Dictionary = _defs[e.type]; return not bool(d.get("gatherer", false)) and float(d.attack.get("damage", 0)) > 0)

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
		d["cls"] = "Worker" if str(e.type) == "laborer" else str(ud.get("class", "")).capitalize()
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
				var caps: Dictionary = ud.get("carry", {})
				d.stats.append([RES_NAMES[carry], str(int(amt)), "/ %d" % int(caps.get(RES_NAMES[carry], 10))])
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
		if FORT_TYPES.has(str(e.type)):
			_fort_info(e, d)
		if not bool(e.built):
			d.tasks.append("Under construction · %d%%" % int(floor(float(e.progress) * 100)))
		var emp := _empower_of(int(e.id))
		if emp > 0.0:
			d.tasks.append("Empowered · %d%%" % int(round(emp * 100)))
		if str(e.type).begins_with("monument_") and bool(e.built):
			d.stats.append(["favor", "+" + _num(float(sim.get_building_def(str(e.type)).get("favor_per_min", 0.0)) * (1.0 + emp * float(sim.get_civ_state(int(e.owner)).get("empower_favor", 0.2)))), "favor / min"])
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
		if not FORT_TYPES.has(str(e.type)) and bool(e.built):
			_research_info(e, d)
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

## A building's empowerment (0..1: the Pharaoh 1, Ra's Priests 0.6, Mandjet 0.6), 0 for none.
func _empower_of(id: int) -> float:
	var B: Dictionary = sim.get_buildings()
	if not B.has("empower"):
		return 0.0
	var ids: PackedInt32Array = B.ids
	var i := ids.bsearch(id)
	if i < int(B.count) and ids[i] == id:
		return float(B.empower[i])
	return 0.0

## The research part of a building's card: "Researching <tech> · n%", the
## queue (icon + progress, click to cancel: refunds what was paid), the techs
## researched here (small icons), and at a Market its live exchange rates.
func _research_info(e: Dictionary, d: Dictionary) -> void:
	var bid := int(e.id)
	var mine := int(e.owner) == me
	var R: Array = sim.get_research(bid) if mine else []
	for k in R.size():
		var it: Dictionary = R[k]
		var p := float(it.get("progress", 0.0))
		if k == 0:
			d.tasks.append("Researching %s · %d%%" % [str(it.name), int(floor(p * 100))])
		d.queue.append({"i": k, "tech": str(it.key), "svg": TechIcons.icon_for(str(it.key)), "name": str(it.name),
			"p": p if k == 0 else 0.0, "left": float(it.total) - float(it.t)})
	if mine and _tech_names.size() > 0:
		var done := []
		for te in sim.get_techs(bid):
			if str(te.state) == "done" and str(te.building) == str(e.type):
				done.append({"tech": str(te.key), "svg": TechIcons.icon_for(str(te.key)), "name": str(te.name), "text": str(te.text)})
		d["done_techs"] = done
	if str(e.type) == "market":
		d["market"] = sim.get_market(int(e.owner))

## The selection card of a wall piece, gate or tower: its stage's name and
## portrait, a tower's damage and range, gate state, research progress.
func _fort_info(e: Dictionary, d: Dictionary) -> void:
	var owner := int(e.owner)
	var F: Dictionary = _fort if owner == me else sim.get_fortify(owner)
	var t := str(e.type)
	var row := _wall_row(int(e.id))
	d["cls"] = "Fortification"
	if t == "tower":
		var lv := int(F.get("tower_level", 0))
		d["title"] = str(F.get("tower_name", d.title))
		d["tex"] = _portraits.fort("tower", owner, lv)
		var tw: Dictionary = F.get("tower", {})
		d.stats.append(["sword", _num(tw.get("damage", 0)), "ranged"])
		d.stats.append(["eye", _num(tw.get("range", 0)), "range"])
	elif t == "gate":
		d["title"] = "Gate"
		var locked := row >= 0 and int(_walls_cache.locked[row]) != 0
		if bool(e.built):
			d.tasks.append("Locked: nobody passes" if locked else "Open to you and your allies")
	else:
		d["title"] = str(F.get("wall_name", d.title)) + (" Pillar" if t == "wall_pillar" else "")
	if row >= 0 and int(_walls_cache.tech[row]) > 0:
		var names: PackedStringArray = sim.fort_tech_names()
		var tk := int(_walls_cache.tech[row]) - 1
		var te := _tech_def(names[tk], owner) if tk < names.size() else {}
		d.tasks.append("Researching %s · %d%%" % [str(te.get("name", "")), int(floor(float(_walls_cache.tech_t[row]) * 100))])

static func _num(v) -> String:
	var f := float(v)
	return str(int(f)) if f == floor(f) else "%.1f" % f

func _name_of(e: Dictionary) -> String:
	if e.kind == "unit": return str(_defs[e.type].name)
	if e.kind == "building" and (e.type == "wall" or e.type == "wall_pillar"): return str(_fort.get("wall_name", _bdefs[e.type].name))
	if e.kind == "building" and e.type == "tower": return str(_fort.get("tower_name", _bdefs[e.type].name))
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
		_hud_mouse = e.position
		_hud_mouse_in = true
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
			if _mode.get("kind", "") == "wall" and _mode.get("start") != null:
				_confirm_wall(e.shift_pressed)
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
var _hud_mouse := Vector2(-1, -1)
var _hud_mouse_in := false   # the last mouse motion was over the hud (not the world)

## The hud zones are rebuilt every redraw, so the command under a resting
## mouse can change without a mouse event (an upgrade finishes and the slot
## becomes the next stage, a wall segment becomes a gate, a gate is locked).
## Re-read the zone under the cursor and refresh the tooltip when its
## content changed, so it never describes the command that was there before
## (also when the slot was empty for a while, e.g. during a research).
func _refresh_hover() -> void:
	if not _hud_mouse_in or menu_open:
		return
	var z: Dictionary = _front.zone_at(_hud_mouse)
	if z.is_empty():
		z = _back.zone_at(_hud_mouse)
	if _hover_key(z) != hover_id:
		_set_hover(z)
		return
	if z.is_empty() or z.tip.is_empty():
		if not tooltip.is_empty():
			tooltip = {}
			_redraw()
		return
	var t: Dictionary = z.tip.duplicate()
	t["anchor"] = z.rect
	if t != tooltip:
		tooltip = t
		_redraw()

func _hover_key(z: Dictionary) -> String:
	var id: String = z.get("id", "")
	if id == "cmd" or id == "group" or id == "power" or id == "res" or id == "queue" or id == "multi" or id == "gfx" or id == "rqueue" or id == "rdone":
		id = "%s:%s" % [id, z.arg]
	return id

func _set_hover(z: Dictionary) -> void:
	var id := _hover_key(z)
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
	if button == MOUSE_BUTTON_LEFT and _mode.get("kind", "") == "attack_move":
		_attack_move_at(w.x, w.y, 0)
		_mm_drag = false
	elif button == MOUSE_BUTTON_LEFT:
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
				message(_deny_text(c))
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
			_cancel_mode()  # (drops a building ghost still on the cursor)
			if str(p.get("target", "point")) == "global":
				# a power over the whole map (Rain, Prosperity, Eclipse): cast at once
				if sim.cast_power(me, str(arg), 0.0, 0.0):
					message("%s!" % p.def.name)
				else:
					message(_cast_reason(str(arg)))
				_hud_t = 0.0
				return
			_mode = {"kind": "power", "id": arg, "target": str(p.get("target", "point"))}
			var hint := {"two_points": "choose where it starts", "own_tc": "click one of your Town Centers", "own_pharaoh": "click your Pharaoh"}
			message("%s: %s" % [p.def.name, hint.get(str(p.get("target", "")), "choose a target")])
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
		"rqueue":
			# a tech in the building's research queue: cancel it (refunds what was paid)
			var sel := _sel_entities()
			if not sel.is_empty() and sel[0].kind == "building" and int(sel[0].get("owner", 0)) == me:
				sim.cancel_research(sel[0].id, str(arg))
				_hud_t = 0.0
				_stat_t = 0.0
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
				"Q/E/F/S/R/B build  ·  W wall  ·  Y tower", "G gate  ·  L lock gate  ·  U upgrade  ·  X stop", "A attack-move (army)  ·  A age (Town Center)", "Space / arrows: pan  ·  wheel: zoom", "F1 HUD  ·  F3 performance meter"], "menu": true, "anchor": Rect2(_back.menubar_rect().position + Vector2(0, 50), Vector2(10, 1))}
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
			# Play Again: the same match (its args) through the loading screen
			if ResourceLoader.exists(FLOW):
				load(FLOW).restart(get_tree())
			else:
				get_tree().reload_current_scene()
		"to_menu":
			if ResourceLoader.exists(FLOW):
				load(FLOW).to_main_menu(get_tree())
		"medal":
			pass

## Why a disabled command refuses: its lock (age, prerequisite), else what is short.
static func _deny_text(c: Dictionary) -> String:
	if str(c.get("warn", "")) != "":
		return str(c.warn)
	if str(c.get("deny", "")) != "":
		return str(c.deny)
	return "Cannot do that yet"

func _run_command(c: Dictionary) -> void:
	var sel := _sel_entities()
	match str(c.action):
		"build":
			var builders := []
			for e in sel:
				if e.kind == "unit" and bool(_defs[e.type].get("builder", false)) and int(e.owner) == me:
					# an Egyptian's Laborers build all but the Obelisk, his Priests only that
					if egypt() and (str(e.type) == "priest") != (str(c.arg) == "obelisk"):
						continue
					builders.append(e.id)
			_begin_place(str(c.arg), builders)
		"wall":
			var builders := []
			for e in sel:
				if e.kind == "unit" and bool(_defs[e.type].get("builder", false)) and int(e.owner) == me:
					builders.append(e.id)
			_begin_wall(builders)
		"gate":
			var r: Dictionary = sim.convert_to_gate(int(c.arg))
			message("Gate: open to you and your allies" if r.ok else str(r.reason))
		"lock":
			var r: Dictionary = sim.set_gate_locked(int(c.arg), bool(c.on))
			message(("Gate locked" if bool(c.on) else "Gate unlocked") if r.ok else str(r.reason))
		"research":
			var r: Dictionary = sim.research(int(c.arg[0]), str(c.arg[1]))
			if not r.ok: message(r.reason)
		"cancel_research":
			sim.cancel_research(int(c.arg))
		"tech_page":
			_tech_page += 1
		"trade":
			var r: Dictionary = sim.market_buy(int(c.arg[0]), str(c.arg[1])) if str(c.arg[2]) == "buy" else sim.market_sell(int(c.arg[0]), str(c.arg[1]))
			if not bool(r.ok):
				message(str(r.reason))
			elif str(c.arg[2]) == "buy":
				message("Bought %d %s for %d gold" % [absi(int(r.amount)), str(c.arg[1]), absi(int(r.gold))])
			else:
				message("Sold %d %s for %d gold" % [absi(int(r.amount)), str(c.arg[1]), absi(int(r.gold))])
		"stop":
			sim.order_idle(PackedInt32Array(_own_units()))
		"attack_move":
			_cancel_mode()
			_mode = {"kind": "attack_move"}
			Input.set_default_cursor_shape(Input.CURSOR_CROSS)
			message("Attack-move: click the ground or the minimap (Esc cancels)")
		"train":
			var r: Dictionary = sim.train(sel[0].id, str(c.arg))
			if not r.ok: message(r.reason)
		"age":
			var r: Dictionary = sim.advance_age(me)
			if not r.ok: message(r.reason)
		"age_god":
			# an Egyptian age-up: the minor god first, then the advance (undone if refused)
			var nxt := int(player.get("age", 0)) + 1
			var g: Dictionary = sim.set_minor_god(me, nxt, str(c.arg))
			var r: Dictionary = sim.advance_age(me) if bool(g.ok) else g
			if not bool(r.ok):
				if bool(g.ok):
					sim.set_minor_god(me, nxt, "")
				message(str(r.reason))
			else:
				message("Advancing to the %s Age with %s" % [AGES[clampi(nxt, 0, 3)], str(EgyptIcons.MINOR.get(str(c.arg), {}).get("name", str(c.arg).capitalize()))])
		"empower":
			var ids := []
			for e in sel:
				if e.kind == "unit" and int(e.owner) == me and (str(e.type) == "pharaoh" or str(e.type) == "priest"):
					ids.append(e.id)
			_cancel_mode()
			_mode = {"kind": "empower", "ids": ids}
			Input.set_default_cursor_shape(Input.CURSOR_POINTING_HAND)
			message("Empower: click one of your buildings (Esc cancels)")
		"summon":
			var r: Dictionary = sim.summon_animal(int(c.arg[0]), str(c.arg[1]))
			if not bool(r.ok): message(str(r.reason))
	_hud_t = 0.0
	_stat_t = 0.0

func _unhandled_input(e: InputEvent) -> void:
	if game == null or game.camera == null or not result.is_empty():
		return
	if e is InputEventMouseMotion:
		_mouse = e.position
		_hud_mouse_in = false
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
			if _mode.get("kind", "") == "wall":
				var gw = pick_ground(e.position)
				if gw != null:
					_mode["start"] = _snap_wall(gw)
					_wall_sig = ""
					_update_ghost()
				return
			if _mode.get("kind", "") == "attack_move":
				var g = pick_ground(e.position)
				if g != null:
					_attack_move_at(g.x, g.y, pick_entity(e.position))
				return
			if _mode.get("kind", "") == "power":
				var g = pick_ground(e.position)
				if g != null and str(_mode.get("target", "")) == "two_points" and _mode.get("from") == null:
					# Shifting Sands: the first click picks the units' circle, the second where they go
					_mode["from"] = g
					message("%s: now choose where they go" % str(_pdefs[_mode.id].name))
					return
				if g != null:
					var ok: bool
					if _mode.get("from") != null:
						ok = sim.cast_power2(me, _mode.id, _mode.from.x, _mode.from.y, g.x, g.y)
					else:
						var at: Vector2 = g
						var tid := pick_entity(e.position)
						if tid != 0 and str(_mode.get("target", "")).begins_with("own_"):
							# aim at the Town Center / Pharaoh clicked, not the ground behind it
							var k := int(sim.entity_kind(tid))
							var ent: Dictionary = sim.get_unit(tid) if k == 1 else sim.get_building(tid) if k == 2 else {}
							if not ent.is_empty():
								at = Vector2(float(ent.x), float(ent.z))
						ok = sim.cast_power(me, _mode.id, at.x, at.y)
					if not ok:
						message(_cast_reason(str(_mode.id)))
				_mode = {}
				_hud_t = 0.0
				return
			if _mode.get("kind", "") == "empower":
				var tid := pick_entity(e.position)
				if tid != 0 and int(sim.entity_kind(tid)) == 2 and _owner_of(tid) == me:
					sim.order_empower(PackedInt32Array(_mode.ids), tid)
					var tb: Dictionary = sim.get_building(tid)
					_marker(float(tb.x), float(tb.z), Color("#ffd860"))
					message("Empowering the %s" % str(_bdefs.get(str(tb.type), {}).get("name", "building")))
					_cancel_mode()
				else:
					message("Empower: click one of your buildings")
				return
			_drag = {"start": e.position, "shift": e.shift_pressed, "active": false}
		elif e.button_index == MOUSE_BUTTON_RIGHT:
			if not _mode.is_empty():
				_cancel_mode()
				return
			var g = pick_ground(e.position)
			if g != null:
				_order_at(g.x, g.y, pick_entity(e.position))
	elif e is InputEventMouseButton and not e.pressed and e.button_index == MOUSE_BUTTON_LEFT and _mode.get("kind", "") == "wall" and _mode.get("start") != null:
		_confirm_wall(e.shift_pressed)
	elif e is InputEventMouseButton and not e.pressed and e.button_index == MOUSE_BUTTON_LEFT and not _drag.is_empty():
		_finish_drag(e.position)
	elif e is InputEventKey and e.pressed and not e.echo:
		_key(e)

var _hover_pending := false

func _process(_dt: float) -> void:
	_refresh_hover()
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

## Attack-move targeting click: an enemy under the cursor is attacked (the
## right-click order), anywhere else the soldiers attack-move there (the
## rest of the selection just moves).
func _attack_move_at(x: float, z: float, target: int) -> void:
	_cancel_mode()
	var own := _own_units()
	if own.is_empty():
		return
	if target != 0 and sim.is_enemy(me, _owner_of(target)):
		_order_at(x, z, target)
		return
	var mil := []
	var rest := []
	for id in own:
		var d: Dictionary = _defs[str(sim.get_unit(id).get("type", "villager"))]
		(rest if bool(d.get("gatherer", false)) or float(d.attack.get("damage", 0)) <= 0 else mil).append(id)
	if not mil.is_empty():
		sim.order_attack_move(PackedInt32Array(mil), x, z)
	if not rest.is_empty():
		sim.order_move(PackedInt32Array(rest), x, z)
	_marker(x, z, AM_COLOR)
	message("Attack-move")

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
		var busy := not _mode.is_empty() or menu_open
		_cancel_mode()
		if menu_open:
			menu_open = false
			tooltip = {}
			_redraw()
		if not busy and game.has_method("open_game_menu"):
			game.open_game_menu()  # nothing to cancel: the in-game menu (game/menu/game_menu.gd)
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
	# god power hotkeys (Z / C / V, from the power defs): letters no command
	# grid slot uses (units Q/W/E/R/T, buildings T/E/S/F/R/B, X stop, A: age
	# with a Town Center selected, attack-move with soldiers selected; the two
	# never share a grid), so they work whatever is selected; same path as
	# clicking the button
	for p in powers:
		if str(p.def.get("hotkey", "")) == ch:
			_click_zone("power", p.key)
			get_viewport().set_input_as_handled()
			return
	for c in commands:
		if c != null and c.key == ch:
			if c.enabled:
				_run_command(c)
			else:
				message(_deny_text(c))
			return
	if ch == "X" and not _own_units().is_empty():
		# Stop when the grid has no room for its button (the Laborers' full build grid)
		sim.order_idle(PackedInt32Array(_own_units()))

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
	var eg_model := type if EgyptBuildings.model_type(type) != "" else ("sentry_tower" if type == "tower" and EgyptBuildings.model_type("sentry_tower") != "" else "")
	if egypt() and eg_model != "":
		# an Egyptian's building: its Egyptian model, fitted to the footprint
		_ghost.mesh = EgyptBuildings.mesh_for(eg_model, int(player.get("age", 0)), str(player.get("god", "ra")).to_lower())
		var bd0: Dictionary = _bdefs.get(type, {})
		_ghost.scale = Vector3.ONE * EgyptBuildings.fit_scale(eg_model, float(bd0.get("w", 1)), float(bd0.get("h", 1)))
	elif type == "tower":
		_ghost.mesh = VoxelModels.mesh("towers", str(clampi(int(_fort.get("tower_level", 0)), 0, 3)))
	elif type == "armory" or type == "market":
		_ghost.mesh = VoxelModels.mesh("techbuildings", "%s/a1" % type)
	else:
		_ghost.mesh = VoxelModels.mesh("buildings", "%s/0" % type)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = GHOST_OK
	m.no_depth_test = false
	m.render_priority = 3
	_ghost.material_override = m
	_ghost.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ghost)
	_update_ghost()

## Why a cast was refused (the sim's last reason, else can_cast's).
func _cast_reason(k: String) -> String:
	var why := str(sim.last_cast_reason()) if sim.has_method("last_cast_reason") else ""
	return why if why != "" else str(sim.can_cast(me, k).reason)

func _cancel_mode() -> void:
	if _mode.get("kind", "") == "empower":
		Input.set_default_cursor_shape(Input.CURSOR_ARROW)
	if _ghost:
		_ghost.queue_free()
		_ghost = null
	if _mode.get("kind", "") == "attack_move":
		Input.set_default_cursor_shape(Input.CURSOR_ARROW)
	_mode = {}
	wall_preview = {}
	_wall_sig = ""
	for gm in _wall_ghosts:
		gm.visible = false
	_range_ring.visible = false
	_am_ring.visible = false
	_hud_t = 0.0

func _update_ghost() -> void:
	var kind: String = _mode.get("kind", "")
	if kind == "" :
		# a selected tower shows its range
		_range_ring.visible = not _sel_tower.is_empty()
		if _range_ring.visible:
			var r0 := float(_sel_tower.range)
			_range_ring.position = Vector3(_sel_tower.x, sim.height_at(_sel_tower.x, _sel_tower.z) + 0.1, _sel_tower.z)
			_range_ring.scale = Vector3(r0, 1, r0)
		_am_ring.visible = false
		return
	var mp := get_viewport().get_mouse_position()
	var g = pick_ground(mp)
	if kind == "wall":
		_range_ring.visible = false
		if g != null:
			_update_wall_ghost(g)
		return
	if kind == "attack_move":
		_am_ring.visible = g != null
		if g != null:
			var pulse := 0.85 + 0.15 * sin(Time.get_ticks_msec() * 0.008)
			_am_ring.position = Vector3(g.x, sim.height_at(g.x, g.y) + 0.1, g.y)
			_am_ring.scale = Vector3(pulse, 1, pulse)
		return
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
	_ghost_ok = sim.can_place(_mode.type, tx, tz) and _can_afford(_bdef(_mode.type).get("cost", d.cost)) and (not _fog_on or sim.is_explored(tx, tz))
	var x := tx + float(d.w) * 0.5
	var z := tz + float(d.h) * 0.5
	_ghost.position = Vector3(x, sim.height_at(x, z), z)
	(_ghost.material_override as StandardMaterial3D).albedo_color = GHOST_OK if _ghost_ok else GHOST_BAD
	# a tower shows the range it will cover
	_range_ring.visible = _mode.type == "tower"
	if _range_ring.visible:
		var tr := float(_fort.get("tower", {}).get("range", 10))
		_range_ring.position = Vector3(x, sim.height_at(x, z) + 0.1, z)
		_range_ring.scale = Vector3(tr, 1, tr)

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

# ---- walls: click-drag a line ------------------------------------------------------------
#
# Wall mode (W, or the Build Wall button, with villagers selected): the ghost
# follows the cursor tile; press on the ground starts a line, dragging shows
# the line AovSim.plan_wall() would lay (4-connected tiles; pillars at ends,
# corners and every few tiles, segments between) as ghost pieces, green
# where they can go, red where a tile is blocked, unexplored or the whole
# line unaffordable or refused (a building on it: a wall never goes over
# one), gold on tiles of the player's wall it joins; the total
# cost follows the cursor. An end within one tile of one of his pillars (a
# wall end or corner) snaps onto it, so lines join. Release places the
# foundations (AovSim.place_wall) and the selected villagers go and build
# them; Shift keeps the mode for the next line; Esc / right-click cancels.

func _begin_wall(builders: Array) -> void:
	_cancel_mode()
	_mode = {"kind": "wall", "builders": builders, "start": null}
	_walls_cache = sim.get_walls()
	message("Wall: drag a line on the ground (Shift: keep drawing, Esc: cancel)")
	_update_ghost()

## A ground point as the centre of its tile, snapped onto the player's wall:
## the tile itself when it is his wall, else a pillar of his within one tile.
func _snap_wall(g: Vector2) -> Vector2:
	var tx := int(floor(g.x))
	var tz := int(floor(g.y))
	var W := _walls_cache
	var best := Vector2i(tx, tz)
	var bd := 1e9
	var rect: PackedInt32Array = W.get("rect", PackedInt32Array())
	for i in int(W.get("count", 0)):
		var k := int(W.kind[i])
		if int(W.owner[i]) != me or k == 3:
			continue
		var rx := rect[i * 4]
		var rz := rect[i * 4 + 1]
		var rw := rect[i * 4 + 2]
		var rh := rect[i * 4 + 3]
		var reach := 1 if k == 0 else 0
		if tx < rx - reach or tx >= rx + rw + reach or tz < rz - reach or tz >= rz + rh + reach:
			continue
		for z in range(rz, rz + rh):
			for x in range(rx, rx + rw):
				var dx := x - tx
				var dz := z - tz
				if maxi(absi(dx), absi(dz)) > reach:
					continue
				var dd := float(dx * dx + dz * dz)
				if dd < bd:
					bd = dd
					best = Vector2i(x, z)
	return Vector2(best.x + 0.5, best.y + 0.5)

## Ghost materials: wall pieces lit (so pillars, merlons and the wall-walk
## read through the tint), tile markers flat and drawn over whatever stands
## on the tile (a blocked tile under a house still shows red).
func _wall_mat(c: Color, marker := false) -> StandardMaterial3D:
	var key := c.to_html() + ("m" if marker else "")
	if not _wall_mats.has(key):
		var m := StandardMaterial3D.new()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.albedo_color = c
		m.render_priority = 3
		if marker:
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.no_depth_test = true
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		else:
			m.albedo_color.a = 0.6
			m.emission_enabled = true
			m.emission = Color(c.r, c.g, c.b) * 0.45
			m.roughness = 1.0
		_wall_mats[key] = m
	return _wall_mats[key]

func _wall_mesh(model: String) -> Mesh:
	var key := "mesh:" + model
	if not _wall_mats.has(key):
		var m: Mesh = null
		if model != "tile" and VoxelModels.group("walls").get("man", {}).get("models", {}).has(model):
			m = VoxelModels.mesh("walls", model)
		if m == null:
			var pm := PlaneMesh.new()
			pm.size = Vector2(0.9, 0.9)
			m = pm
		_wall_mats[key] = m
	return _wall_mats[key]

func _update_wall_ghost(g: Vector2) -> void:
	var b := _snap_wall(g)
	var a: Vector2 = _mode.start if _mode.get("start") != null else b
	var sig := "%s|%s|%d|%d" % [a, b, int(player.get("wood", 0)), int(player.get("gold", 0))]
	if sig == _wall_sig:
		return
	_wall_sig = sig
	var P: Dictionary = sim.plan_wall(me, a, b)
	var tiles: PackedInt32Array = P.get("tiles", PackedInt32Array())
	var state: PackedByteArray = P.get("state", PackedByteArray())
	var n := state.size()
	var pillar := {}
	var pieces: PackedInt32Array = P.get("pieces", PackedInt32Array())
	var tnames: PackedStringArray = sim.building_type_names()
	for i in range(0, pieces.size(), 5):
		if tnames[pieces[i]] == "wall_pillar":
			pillar[Vector2i(pieces[i + 1], pieces[i + 2])] = true
	var cost: Dictionary = P.get("cost", {})
	var afford := _can_afford(cost)
	var hidden := 0
	var st := PackedByteArray(state)
	for i in n:
		if st[i] == 1 and _fog_on and not sim.is_explored(tiles[i * 2] + 0.5, tiles[i * 2 + 1] + 0.5):
			st[i] = 0
			hidden += 1
	var ok: bool = bool(P.get("valid", false)) and int(P.get("new_tiles", 0)) > 0 and afford and hidden == 0
	var reason := ""
	if not bool(P.get("valid", false)) or int(P.get("new_tiles", 0)) == 0:
		reason = str(P.get("reason", "")) if str(P.get("reason", "")) != "" else "Cannot build a wall there"
	elif hidden > 0:
		reason = "Unexplored ground"
	elif not afford:
		reason = "Not enough resources"
	var blocked := 0
	for i in n:
		if st[i] == 0:
			blocked += 1
	wall_preview = {"a": a, "b": b, "tiles": tiles, "state": st, "new_tiles": int(P.get("new_tiles", 0)), "blocked": blocked,
		"cost": cost, "ok": ok, "afford": afford, "reason": reason, "dragging": _mode.get("start") != null}
	# ghost pieces, one per tile
	while _wall_ghosts.size() < n:
		var mi := MeshInstance3D.new()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)
		_wall_ghosts.append(mi)
	var good := GHOST_OK
	var in_way := int(P.get("on_building", 0)) > 0   # (a building on the line: the whole line is refused)
	for i in _wall_ghosts.size():
		var mi: MeshInstance3D = _wall_ghosts[i]
		if i >= n:
			mi.visible = false
			continue
		var tx := tiles[i * 2]
		var tz := tiles[i * 2 + 1]
		var x := tx + 0.5
		var z := tz + 0.5
		var model := "tile"
		var col := GHOST_BAD
		var yaw := 0.0
		if st[i] == 1:
			model = "pillar" if pillar.has(Vector2i(tx, tz)) else "seg/0"
			col = good if afford and not in_way else GHOST_BAD
			# a segment runs along the line (x or z) at that tile
			var j0 := maxi(i - 1, 0)
			var j1 := mini(i + 1, n - 1)
			if tiles[j1 * 2] == tiles[j0 * 2] and j1 != j0:
				yaw = PI * 0.5
		elif st[i] == 2:
			col = GHOST_JOIN
		mi.mesh = _wall_mesh(model)
		mi.material_override = _wall_mat(col, model == "tile")
		var y: float = sim.height_at(x, z) + (0.08 if model == "tile" else 0.0)
		mi.transform = Transform3D(Basis(Vector3.UP, yaw), Vector3(x, y, z))
		mi.visible = true

func _confirm_wall(shift: bool) -> void:
	if _mode.get("kind", "") != "wall" or _mode.get("start") == null:
		return
	_wall_sig = ""
	_update_ghost()
	var pv := wall_preview
	if not bool(pv.get("ok", false)):
		message(str(pv.get("reason", "")) if str(pv.get("reason", "")) != "" else "Cannot build a wall there")
		_mode["start"] = null
		_wall_sig = ""
		return
	var r: Dictionary = sim.place_wall(me, pv.a, pv.b, PackedInt32Array(_mode.builders))
	if not bool(r.ok):
		message(str(r.reason))
		_mode["start"] = null
		_wall_sig = ""
		return
	_walls_cache = sim.get_walls()
	if shift:
		_mode["start"] = null
		_wall_sig = ""
	else:
		_cancel_mode()
	_stat_t = 0.0
	_hud_t = 0.0

## {x, z, range} of the one selected tower (finished), else {}.
func _tower_ring_of_selection() -> Dictionary:
	if selected.size() != 1 or int(sim.entity_kind(selected[0])) != 2:
		return {}
	var b: Dictionary = sim.get_building(selected[0])
	if b.is_empty() or str(b.get("type", "")) != "tower" or not bool(b.get("built", false)):
		return {}
	var F: Dictionary = _fort if int(b.owner) == me else sim.get_fortify(int(b.owner))
	return {"x": float(b.x), "z": float(b.z), "range": float(F.get("tower", {}).get("range", 10))}

## The wall line's cost by the cursor: tiles, wood / gold (red when short),
## and why it cannot be built.
func _draw_wall_cost(ci: Control) -> void:
	var pv := wall_preview
	if pv.is_empty() or _mode.get("kind", "") != "wall":
		return
	var bold := S.font("bold")
	var sans := S.font("sans")
	var n := int(pv.new_tiles)
	var head := "Wall · %d tile%s" % [n, "" if n == 1 else "s"]
	if int(pv.blocked) > 0:
		head += " · %d blocked" % int(pv.blocked)
	var cost: Dictionary = pv.cost
	var w := S.text_width(bold, head, 14) + 20
	var cw := 0.0
	for k in cost:
		if float(cost[k]) > 0:
			cw += 18 + S.text_width(bold, str(int(cost[k])), 14) + 10
	var reason: String = "" if bool(pv.ok) else str(pv.reason)
	w = maxf(w, cw + 20)
	if reason != "":
		w = maxf(w, S.text_width(sans, reason, 13) + 20)
	var h := 26.0 + (20.0 if cw > 0 else 0.0) + (18.0 if reason != "" else 0.0) + 6.0
	var p := _css(_mouse) + Vector2(20, 22)
	var vs := ci.size
	p.x = minf(p.x, vs.x - w - 6)
	p.y = minf(p.y, vs.y - h - 6)
	var r := Rect2(p, Vector2(w, h))
	ci.draw_rect(r.grow(1), Color.BLACK)
	ci.draw_rect(r, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.92))
	ci.draw_rect(r, S.BRONZE_HI, false, 1.0)
	var cy := r.position.y + 19
	S.text(ci, bold, Vector2(r.position.x + 10, cy), head, 14, S.GOLD if bool(pv.ok) else Color("#ff8a70"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	if cw > 0:
		cy += 20
		var cx := r.position.x + 10
		for k in cost:
			if float(cost[k]) <= 0:
				continue
			S.draw_icon(ci, k, Rect2(cx, cy - 13, 15, 15))
			cx += 18
			var v := str(int(cost[k]))
			S.text(ci, bold, Vector2(cx, cy), v, 14, S.INK if float(player.get(k, 0.0)) >= float(cost[k]) else Color("#ff8a70"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
			cx += S.text_width(bold, v, 14) + 10
	if reason != "":
		cy += 18
		S.text(ci, sans, Vector2(r.position.x + 10, cy), reason, 13, Color("#ff8a70"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)

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
	_draw_wall_cost(ci)
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
