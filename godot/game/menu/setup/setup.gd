extends Control
## Skirmish match setup (after Age of Mythology: Retold's lobby): a title bar
## with the back chevron, the game type / victory bar, the player table (name,
## AI difficulty, pantheon, colour, team; add / remove AI players), the map
## panel on the right (player count, map name, a preview drawn from the real
## map generator for the chosen map / seed / size / player count, Select Map,
## map size, seed, visibility, starting resources, game speed, free for all,
## lock teams), and Leave / Play. Every choice lands in one match-settings
## Dictionary (game/menu/setup/match_settings.gd, shape in PORTING.md); Play
## starts the match with it (menu.start_match(M.to_args(settings))).
##
## Hosted by the main menu (game/menu/menu.gd, "Setup screen contract": a
## Control in the menu's scaled CSS-px layer; Leave frees it), or standalone
## in the scene "setup" (main.gd puts a scene's "screen" on a CanvasLayer;
## then it scales itself by the window height like game/ui/ui.gd; Leave goes
## to the main menu). Drawn in the HUD's CSS px (1920x1080 layout) with the
## HUD style: panel.gdshader panels, hud_style.gd type and bronze,
## widgets.gd fields / lists / pills.
##
## Scene: godot --path godot -- --scene=setup [--players=2..6] [--map=KEY] [--god=ra|isis|set|zeus] [--god2=...]
##        [--seed=N] [--mapsize=N] [--open=team|color|difficulty|count|size|resources|speed|god|map]
## (captures: node scripts/godot-shoot.mjs --scene setup --params "players=5").

const S := preload("res://game/ui/hud_style.gd")
const W := preload("res://game/menu/setup/widgets.gd")
const M := preload("res://game/menu/setup/match_settings.gd")
const MapPreview := preload("res://game/menu/setup/map_preview.gd")
const EgyptIcons := preload("res://game/ui/egypt_icons.gd")
const FLOW := "res://game/menu/flow.gd"   # the main menu's screen flow (loaded when there)

## portraits.gd with its owner -> colour lookup replaced by our colour index
class ColorPortraits extends "res://game/ui/portraits.gd":
	func player_color(owner: int) -> Color:
		return M.color_of(owner)

class View extends Control:
	var screen: Node
	var layer := 0
	func _draw() -> void:
		screen._draw_view(self, layer)
	func _gui_input(e: InputEvent) -> void:
		screen._view_input(self, e)
	func _has_point(p: Vector2) -> bool:
		return screen._view_has_point(layer, p)

var menu: Node = null           # the main menu hosting this screen (null: standalone)
var settings := {}
var args := {}

var _bg: ColorRect
var _panels := {}               # name -> ColorRect (panel.gdshader)
var _view: View
var _dim: ColorRect
var _modal_panel: ColorRect
var _top: View
var _portraits: Node
var _css := Vector2(1920, 1080)
var _mouse := Vector2(-1, -1)
var _zones := [[], []]          # per layer: [{rect, id, arg}]
var _open := {}                 # the open dropdown: {id, row, anchor, items, cur, cb, min_w}
var _modal := ""                # "" | "god" | "map"
var _modal_arg := 0
var _god_pick := "zeus"
var _preview := {}
var _preview_key := ""
var _note := ""                 # one-line status (map switched ...)
var _pending_open := []
var _leaving := false

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	args = AovArgs.parse()
	var from_match := M.from_args(args)  # the last match's settings (Play Again / back from a match)
	if not from_match.is_empty():
		settings = from_match
	elif not M.last.is_empty():
		settings = M.last.duplicate(true)
	else:
		var n := clampi(int(args.get("players", 2)), 2, M.MAX_PLAYERS)
		settings = M.defaults(n)
		if args.has("map") and (M.MAPS.has(str(args.map)) or str(args.map) == "random"):
			settings.map = str(args.map)
		if args.has("seed") and str(args.get("scene", "")) == "setup":
			settings.seed = int(args.seed)
		if args.has("mapsize"):
			settings.map_size = int(args.mapsize)
	_fit_map_to_players(false)

	_bg = ColorRect.new()
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bm := ShaderMaterial.new()
	bm.shader = preload("res://game/menu/setup/setup_bg.gdshader")
	_bg.material = bm
	add_child(_bg)
	for pn in ["title", "bar", "table", "map", "chat"]:
		_panels[pn] = _make_panel()
		add_child(_panels[pn])
	_view = View.new()
	_view.screen = self
	_view.layer = 0
	_view.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_view)
	_dim = ColorRect.new()
	_dim.color = Color(0, 0, 0, 0.62)
	_dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_dim.visible = false
	add_child(_dim)
	_modal_panel = _make_panel()
	_modal_panel.visible = false
	add_child(_modal_panel)
	_top = View.new()
	_top.screen = self
	_top.layer = 1
	_top.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_top)
	_portraits = ColorPortraits.new()
	_portraits.name = "Portraits"
	add_child(_portraits)
	_layout()
	get_viewport().size_changed.connect(_layout)

	# --god=ra|isis|set|zeus: your pantheon (captures), --god2=: the first AI's
	for k in [["god", 0], ["god2", 1]]:
		var gk := str(args.get(k[0], "")).to_lower()
		if M.GODS.has(gk) and bool(M.GODS[gk].available) and int(k[1]) < _players().size():
			_players()[int(k[1])].god = gk
	match str(args.get("open", "")):
		"team": _open_dropdown("team", 1)
		"color": _open_dropdown("color", 1)
		"difficulty": _open_dropdown("difficulty", 1)
		"count": _open_dropdown("count", 0)
		"size": _open_dropdown("size", 0)
		"resources": _open_dropdown("resources", 0)
		"speed": _open_dropdown("speed", 0)
		"god": _show_modal("god", 0)
		"map": _show_modal("map", 0)

## The screen is opaque: the 3D world behind it (the menu's live town, the
## setup scene's field) is not rendered while it is open.
var _had_3d := true
func _enter_tree() -> void:
	_had_3d = not get_viewport().disable_3d
	get_viewport().disable_3d = true

func _exit_tree() -> void:
	if _had_3d:
		get_viewport().disable_3d = false

## The menu's contract: called after add_child.
func open(m: Node) -> void:
	menu = m
	_layout.call_deferred()

func _make_panel() -> ColorRect:
	var cr := ColorRect.new()
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = preload("res://game/ui/panel.gdshader")
	cr.material = m
	return cr

# ---- layout (CSS px) -------------------------------------------------------------

func title_rect() -> Rect2: return Rect2(0, 0, _css.x, 96)
func bar_rect() -> Rect2: return Rect2(22, 114, _css.x - 44, 62)
func map_rect() -> Rect2: return Rect2(_css.x - 22 - 500, 196, 500, 806)
func table_rect() -> Rect2: return Rect2(22, 196, map_rect().position.x - 20 - 22, 806)
func chat_rect() -> Rect2: return Rect2(22, 1022, 700, 46)
func leave_rect() -> Rect2: return Rect2(_css.x - 22 - 480, 1026, 210, 42)
func play_rect() -> Rect2: return Rect2(_css.x - 22 - 250, 1026, 250, 42)
func modal_rect() -> Rect2:
	var sz := Vector2(1460, 840) if _modal == "god" else Vector2(1300, 600)
	return Rect2(((_css - sz) * 0.5).round(), sz)

const DARK_PANEL := {"bg_mode": 1, "bg0": Color(0.105, 0.125, 0.13, 0.96), "bg1": Color(0.062, 0.078, 0.084, 0.97),
	"bg2": Color(0.035, 0.045, 0.05, 0.98), "bg_mid": 0.5, "radial_center": Vector2(0.5, 0.0), "radial_radius": Vector2(1.3, 1.1)}
const TEAL_PANEL := {"bg_mode": 1, "bg0": Color(22 / 255.0, 70 / 255.0, 82 / 255.0, 0.97), "bg1": Color(11 / 255.0, 40 / 255.0, 48 / 255.0, 0.97),
	"bg2": Color(5 / 255.0, 22 / 255.0, 28 / 255.0, 0.98), "bg_mid": 0.48, "radial_center": Vector2(0.5, 0.0), "radial_radius": Vector2(1.3, 1.0)}

func _panel_specs() -> Dictionary:
	return {
		"title": {"rect": title_rect(), "chamfer": Vector4(0, 0, 26, 26), "border": Vector4(0, 0, 3, 0), "style": TEAL_PANEL, "shadow": Vector3(6, 18, 0.55)},
		"bar": {"rect": bar_rect(), "chamfer": Vector4.ZERO, "border": Vector4(2, 2, 2, 2), "style": DARK_PANEL, "shadow": Vector3(4, 12, 0.45), "grain": 0.6},
		"table": {"rect": table_rect(), "chamfer": Vector4.ZERO, "border": Vector4(2, 2, 2, 2), "style": DARK_PANEL, "shadow": Vector3(6, 18, 0.5), "grain": 0.6},
		"map": {"rect": map_rect(), "chamfer": Vector4.ZERO, "border": Vector4(3, 3, 3, 3), "style": TEAL_PANEL, "shadow": Vector3(6, 18, 0.5)},
		"chat": {"rect": chat_rect(), "chamfer": Vector4(0, 0, 0, 0), "border": Vector4(2, 2, 2, 2), "style": DARK_PANEL, "shadow": Vector3(3, 10, 0.4), "grain": 0.4},
	}

func _apply_panel(cr: ColorRect, spec: Dictionary) -> void:
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
	m.set_shader_parameter("grain", spec.get("grain", 1.0))
	var sh: Vector3 = spec.shadow
	m.set_shader_parameter("shadow_offset", Vector2(0, sh.x))
	m.set_shader_parameter("shadow_blur", sh.y)
	m.set_shader_parameter("shadow_alpha", sh.z)
	for k in spec.style:
		m.set_shader_parameter(k, spec.style[k])

func _layout() -> void:
	if not is_inside_tree():
		return
	var vs := get_viewport().get_visible_rect().size
	if menu != null and get_parent() is Control:
		_css = (get_parent() as Control).size  # already in CSS px, scaled by the menu's layer
		scale = Vector2.ONE
	else:
		var sc := clampf(vs.y / 1080.0, 0.5, 2.0)
		_css = vs / sc
		scale = Vector2(sc, sc)
	if _css.x < 1440.0:  # narrow windows: keep the layout, shrink it to the width
		var k := _css.x / 1440.0
		scale *= k
		_css /= k
	position = Vector2.ZERO
	size = _css
	for c in [_bg, _view, _dim, _top]:
		c.position = Vector2.ZERO
		c.size = _css
	(_bg.material as ShaderMaterial).set_shader_parameter("size", _css)
	var specs := _panel_specs()
	for k in specs:
		_apply_panel(_panels[k], specs[k])
	_sync_modal()
	_redraw()

func _sync_modal() -> void:
	_dim.visible = _modal != ""
	_modal_panel.visible = _modal != ""
	if _modal != "":
		_apply_panel(_modal_panel, {"rect": modal_rect(), "chamfer": Vector4(18, 18, 18, 18), "border": Vector4(3, 3, 3, 3),
			"style": DARK_PANEL, "shadow": Vector3(10, 30, 0.7), "grain": 0.6})

func _redraw() -> void:
	if _view:
		_view.queue_redraw()
		_top.queue_redraw()

# ---- settings ----------------------------------------------------------------------

func _players() -> Array:
	return settings.players

func _fit_map_to_players(tell := true) -> void:
	var n := _players().size()
	if M.map_supports(settings.map, n):
		return
	var pool := M.maps_for(n)
	if pool.is_empty():
		return
	var old: String = M.MAPS[settings.map].name
	settings.map = pool[0]
	if tell:
		_note = "%s takes 2 players: the map is now %s." % [old, M.MAPS[settings.map].name]

func _changed() -> void:
	settings.preset = M.MAPS[settings.map].preset if settings.map != "random" else "skirmish"
	_redraw()

func _set_key(k: String, v) -> void:
	settings[k] = v
	_changed()

func _set_player_key(row: int, k: String, v) -> void:
	_players()[row][k] = v
	_changed()

func _set_count(n: int) -> void:
	_note = ""
	M.set_player_count(settings, n)
	_fit_map_to_players()
	_changed()

func _set_color(idx: int, col: int) -> void:
	var ps := _players()
	for j in ps.size():
		if j != idx and int(ps[j].color) == col:
			ps[j].color = ps[idx].color  # swap with the player who had it
	ps[idx].color = col
	_changed()

func _preview_now() -> Dictionary:
	var preset: String = M.MAPS[settings.map].preset if settings.map != "random" else "skirmish"
	var key := "%s/%d/%d/%d" % [preset, settings.seed, settings.map_size, _players().size()]
	if key != _preview_key:
		_preview_key = key
		_preview = MapPreview.build(preset, int(settings.seed), int(settings.map_size), _players().size())
	return _preview

# ---- dropdowns -----------------------------------------------------------------------

func _items_of(list: Array) -> Array:
	var out := []
	for o in list:
		out.append({"label": o.name, "value": o.key})
	return out

func _index_of(items: Array, value) -> int:
	for i in items.size():
		if items[i].value == value:
			return i
	return -1

## Dropdown definitions: id (+ row) -> {items, cur, cb}.
func _dd(id: String, row: int) -> Dictionary:
	var ps := _players()
	match id:
		"count":
			var items := []
			for n in range(2, M.MAX_PLAYERS + 1):
				items.append({"label": str(n), "value": n})
			return {"items": items, "cur": ps.size(), "cb": func(v): _set_count(int(v))}
		"size":
			var items := []
			for o in M.SIZES:
				items.append({"label": o.name, "value": o.key, "note": "%d x %d" % [o.key, o.key]})
			return {"items": items, "cur": int(settings.map_size), "cb": func(v): _set_key("map_size", int(v))}
		"visibility":
			return {"items": [{"label": "Standard", "value": "standard", "note": "fog of war"}, {"label": "Revealed", "value": "revealed", "note": "whole map"}],
				"cur": settings.visibility, "cb": func(v): _set_key("visibility", v)}
		"resources":
			var items := []
			for o in M.RESOURCES:
				var r: Dictionary = o.res
				items.append({"label": o.name, "value": o.key, "note": "300 / 300 / 200" if r.is_empty() else "%d / %d / %d" % [r.food, r.wood, r.gold]})
			return {"items": items, "cur": settings.resources, "cb": func(v): _set_key("resources", v)}
		"speed":
			var items := []
			for o in M.SPEEDS:
				items.append({"label": o.name, "value": o.key, "note": "x%s" % str(o.key)})
			return {"items": items, "cur": float(settings.speed), "cb": func(v): _set_key("speed", float(v))}
		"game_type":
			return {"items": [{"label": "Standard", "value": "standard"}], "cur": "standard", "cb": func(_v): pass}
		"victory":
			return {"items": [{"label": "Conquest", "value": "conquest", "note": "destroy every enemy"}], "cur": "conquest", "cb": func(_v): pass}
		"difficulty":
			var items := []
			for o in M.DIFFICULTIES:
				items.append({"label": o.name, "value": o.key})
			return {"items": items, "cur": ps[row].ai, "cb": func(v): _set_player_key(row, "ai", v)}
		"team":
			var items := []
			for t in range(1, M.MAX_PLAYERS + 1):
				items.append({"label": "Team %d" % t, "value": t})
			return {"items": items, "cur": int(ps[row].team), "cb": func(v): _set_player_key(row, "team", int(v))}
		"color":
			var items := []
			for c in range(1, M.COLORS.size()):
				var who := ""
				for j in ps.size():
					if j != row and int(ps[j].color) == c:
						who = str(ps[j].name)
				items.append({"label": str(c), "value": c, "color": M.color_of(c), "note": who})
			return {"items": items, "cur": int(ps[row].color), "cb": func(v): _set_color(row, int(v))}
	return {}

func _dd_anchor(id: String, row: int) -> Rect2:
	for z in _zones[0]:
		if z.id == "dd" and z.arg.id == id and int(z.arg.row) == row:
			return z.rect
	return Rect2()

func _open_dropdown(id: String, row: int) -> void:
	if _zones[0].is_empty():
		_pending_open = [id, row]  # opened after the first draw has laid out the zones
		return
	var d := _dd(id, row)
	if d.is_empty():
		return
	d["id"] = id
	d["row"] = row
	d["anchor"] = _dd_anchor(id, row)
	d["min_w"] = 250.0 if id == "color" else 0.0
	_open = d
	_redraw()

func _show_modal(kind: String, arg: int) -> void:
	_open = {}
	_modal = kind
	_modal_arg = arg
	if kind == "god":
		_god_pick = str(_players()[clampi(arg, 0, _players().size() - 1)].god)
	_sync_modal()
	_redraw()

func _close_modal() -> void:
	_modal = ""
	_sync_modal()
	_redraw()

# ---- input -------------------------------------------------------------------------------

func _view_has_point(layer: int, p: Vector2) -> bool:
	if layer == 0:
		return true
	return _modal != "" or not _open.is_empty()

func _zone_at(layer: int, p: Vector2) -> Dictionary:
	var zs: Array = _zones[layer]
	for i in range(zs.size() - 1, -1, -1):
		if zs[i].rect.has_point(p):
			return zs[i]
	return {}

func _view_input(v: View, e: InputEvent) -> void:
	if e is InputEventMouseMotion:
		_mouse = v.get_local_mouse_position()
		_redraw()
		return
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		var p := v.get_local_mouse_position()
		_mouse = p
		var z := _zone_at(v.layer, p)
		_click(v.layer, z)
		v.accept_event()
	elif e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_RIGHT:
		if not _open.is_empty():
			_open = {}
		elif _modal != "":
			_close_modal()
		_redraw()

func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and not e.echo:
		if e.keycode == KEY_ESCAPE:
			if not _open.is_empty():
				_open = {}
				_redraw()
			elif _modal != "":
				_close_modal()
			else:
				_back()
		elif e.keycode == KEY_ENTER and _open.is_empty() and _modal == "":
			_play()

func _click(layer: int, z: Dictionary) -> void:
	if layer == 1 and not _open.is_empty():
		if not z.is_empty() and z.id == "item":
			var it: Dictionary = _open.items[int(z.arg)]
			if bool(it.get("enabled", true)):
				var cb: Callable = _open.cb
				_open = {}
				cb.call(it.value)
		else:
			_open = {}
		_redraw()
		return
	if z.is_empty():
		return
	match str(z.id):
		"dd":
			if not _open.is_empty() and _open.id == z.arg.id and int(_open.row) == int(z.arg.row):
				_open = {}
			else:
				_open_dropdown(z.arg.id, int(z.arg.row))
		"back": _back()
		"play": _play()
		"god": _show_modal("god", int(z.arg))
		"select_map": _show_modal("map", 0)
		"reseed":
			settings.seed = (int(settings.seed) * 1103515245 + 12345 + Time.get_ticks_usec()) % 100000
			_changed()
		"toggle":
			settings[z.arg] = not bool(settings[z.arg])
			_changed()
		"add":
			_set_count(_players().size() + 1)
		"remove":
			_players().remove_at(int(z.arg))
			_set_count(_players().size())
		"modal_close": _close_modal()
		"god_pick":
			if bool(M.GODS[z.arg].available):
				_god_pick = z.arg
		"god_confirm":
			_players()[_modal_arg].god = _god_pick
			_close_modal()
			_changed()
		"map_pick":
			_note = ""
			settings.map = z.arg
			_close_modal()
			_changed()
	_redraw()

func _back() -> void:
	if _leaving:
		return
	if menu != null and menu.has_method("close_screen"):
		menu.close_screen()
	elif menu != null:
		queue_free()
	elif ResourceLoader.exists(FLOW):
		_leaving = true
		load(FLOW).to_main_menu(get_tree())
	else:
		get_tree().quit()

func _play() -> void:
	if _leaving:
		return
	_leaving = true
	M.last = settings.duplicate(true)
	var a := M.to_args(settings)
	if menu != null and menu.has_method("start_match"):
		menu.start_match(a)
	elif ResourceLoader.exists(FLOW):
		load(FLOW).start_match(get_tree(), a)
	else:
		_leaving = false

# ---- drawing ------------------------------------------------------------------------------

func _hover(r: Rect2, layer := 0) -> bool:
	if layer == 0 and (_modal != "" or not _open.is_empty()):
		return false
	if layer == 1 and _modal == "" and _open.is_empty():
		return false
	return r.has_point(_mouse)

func _zone(layer: int, r: Rect2, id: String, arg = null) -> void:
	_zones[layer].append({"rect": r, "id": id, "arg": arg})

func _draw_view(ci: CanvasItem, layer: int) -> void:
	_zones[layer] = []
	if layer == 0:
		_draw_title(ci)
		_draw_bar(ci)
		_draw_table(ci)
		_draw_map_panel(ci)
		_draw_bottom(ci)
		if not _pending_open.is_empty():
			var po := _pending_open
			_pending_open = []
			_open_dropdown.call_deferred(po[0], po[1])
	else:
		if _modal == "god":
			_draw_god_modal(ci)
		elif _modal == "map":
			_draw_map_modal(ci)
		if not _open.is_empty():
			_draw_open(ci)

func _label(ci: CanvasItem, pos: Vector2, s: String, size := 22, col := Color("#efe4cc"), font := "bold") -> void:
	S.text(ci, S.font(font), pos, s, size, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9)

func _field(ci: CanvasItem, r: Rect2, id: String, row: int, label: String, enabled := true, swatch = null) -> void:
	var open: bool = not _open.is_empty() and _open.id == id and int(_open.row) == row
	W.field(ci, r, label, _hover(r) and enabled, open, enabled, swatch)
	if enabled:
		_zone(0, r, "dd", {"id": id, "row": row})

func _draw_title(ci: CanvasItem) -> void:
	var r := title_rect()
	# back chevron
	var c := Vector2(76, 46)
	var hov := _hover(Rect2(30, 10, 90, 72))
	var col := Color("#f3d893") if hov else Color("#d8b46c")
	var pts := PackedVector2Array([c + Vector2(22, -30), c + Vector2(-20, 0), c + Vector2(22, 30), c + Vector2(30, 22), c + Vector2(-2, 0), c + Vector2(30, -22)])
	ci.draw_colored_polygon(PackedVector2Array(Array(pts).map(func(p): return p + Vector2(0, 3))), Color(0, 0, 0, 0.7))
	ci.draw_polygon(pts, PackedColorArray([Color("#fff0c0"), col, Color("#8c6a36"), Color("#6e4f22"), col.darkened(0.2), Color("#f3d893")]))
	_zone(0, Rect2(30, 10, 90, 72), "back")
	# divider
	S.vgrad(ci, Rect2(126, 18, 2, 60), [[0.0, Color(0.85, 0.7, 0.42, 0.0)], [0.5, Color(0.85, 0.7, 0.42, 0.9)], [1.0, Color(0.85, 0.7, 0.42, 0.0)]])
	S.text(ci, S.font("black"), Vector2(146, 63), "Skirmish", 46, Color("#f0d48a"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.95, 1.0)
	S.text(ci, S.font("title"), Vector2(150 + S.text_width(S.font("black"), "Skirmish", 46, 1.0) + 22, 61), "MATCH SETUP", 17,
		Color(0.85, 0.72, 0.45, 0.6), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.0, 2.5)
	# profile chip, top right (the local player and his god)
	var chip := Rect2(r.end.x - 300, 22, 250, 50)
	W.draw_box(ci, chip, Color(0.02, 0.06, 0.07, 0.85), Color("#8c6a36"), 1.5, 3.0)
	W.god_disc(ci, Vector2(chip.position.x + 26, chip.get_center().y), 18, str(_players()[0].god))
	S.text(ci, S.font("bold"), Vector2(chip.position.x + 56, chip.get_center().y + 8), str(_players()[0].name), 22, S.INK)
	S.text(ci, S.font("sans"), Vector2(chip.position.x, chip.get_center().y + 7), M.culture_of(str(_players()[0].god)), 17, S.MUTED, HORIZONTAL_ALIGNMENT_RIGHT, chip.size.x - 14)
	W.frame_corners(ci, Rect2(8, 6, r.size.x - 16, r.size.y - 12), 30)

func _draw_bar(ci: CanvasItem) -> void:
	var r := bar_rect()
	var y := r.get_center().y
	var bf := S.font("bold")
	var x := r.position.x + 18
	_label(ci, Vector2(x, y + 8), "Game Type:", 24)
	x += S.text_width(bf, "Game Type:", 24) + 16
	_field(ci, Rect2(x, y - 19, 250, 38), "game_type", 0, "Standard")
	x += 250 + 34
	_label(ci, Vector2(x, y + 8), "Victory Condition:", 24)
	x += S.text_width(bf, "Victory Condition:", 24) + 16
	_field(ci, Rect2(x, y - 19, 250, 38), "victory", 0, "Conquest")
	# right: a compact summary of the match
	var ps := _players()
	var teams := {}
	for i in ps.size():
		teams[M.team_of(settings, i)] = true
	var mode := _team_mode()
	S.text(ci, S.font("sans"), Vector2(r.position.x, y + 7), "%d players  ·  %s  ·  %s map" % [ps.size(), mode, M.option_name(M.SIZES, int(settings.map_size))],
		20, S.MUTED, HORIZONTAL_ALIGNMENT_RIGHT, r.size.x - 24, 0.8)

## "1 v 1", "2 v 3", "Free for All" (every player on his own team, more than two).
func _team_mode() -> String:
	var ps := _players()
	var sizes := {}
	for i in ps.size():
		var t := M.team_of(settings, i)
		sizes[t] = int(sizes.get(t, 0)) + 1
	if sizes.size() == 1:
		return "one team"
	if sizes.size() == ps.size() and ps.size() > 2:
		return "Free for All"
	var parts := []
	for t in sizes:
		parts.append(str(sizes[t]))
	return " v ".join(parts)

# player table ------------------------------------------------------------------------------

const ROW_H := 66.0

func _cols(t: Rect2) -> Dictionary:
	var x := t.position.x
	var w := t.size.x
	return {"name": x + 22, "diff": x + 380, "god": x + w * 0.575, "color": x + w * 0.66, "team": x + w * 0.765, "remove": t.end.x - 60}

func _draw_table(ci: CanvasItem) -> void:
	var t := table_rect()
	var c := _cols(t)
	var hy := t.position.y + 34
	var hf := S.font("title7")
	var hc := Color("#e9dcc0")
	S.text(ci, hf, Vector2(c.name, hy), "Name", 22, hc)
	S.text(ci, hf, Vector2(c.diff, hy), "Difficulty", 22, hc)
	S.text(ci, hf, Vector2(c.god - 80, hy), "Pantheon", 22, hc, HORIZONTAL_ALIGNMENT_CENTER, 160)
	S.text(ci, hf, Vector2(c.color, hy), "Color", 22, hc, HORIZONTAL_ALIGNMENT_CENTER, 96)
	S.text(ci, hf, Vector2(c.team, hy), "Team", 22, hc, HORIZONTAL_ALIGNMENT_CENTER, 170)
	var y0 := t.position.y + 52
	# faint row stripes all the way down (the lobby's ruled sheet)
	var n_rows := int((t.end.y - 12 - y0) / ROW_H)
	for i in n_rows:
		var ry := y0 + i * ROW_H
		if i % 2 == 1:
			ci.draw_rect(Rect2(t.position.x + 6, ry, t.size.x - 12, ROW_H), Color(1, 1, 1, 0.018))
		ci.draw_line(Vector2(t.position.x + 8, ry + ROW_H), Vector2(t.end.x - 8, ry + ROW_H), Color(0, 0, 0, 0.55), 1.0)
		ci.draw_line(Vector2(t.position.x + 8, ry + ROW_H + 1), Vector2(t.end.x - 8, ry + ROW_H + 1), Color(1, 1, 1, 0.035), 1.0)
	var ps := _players()
	for i in ps.size():
		_draw_row(ci, t, c, i, y0 + i * ROW_H)
	if ps.size() < M.MAX_PLAYERS:
		var ry := y0 + ps.size() * ROW_H
		var ar := Rect2(c.name, ry + 13, 300, 40)
		var hov := _hover(ar)
		W.draw_box(ci, ar, Color(0.05, 0.12, 0.14, 0.5 if hov else 0.25), Color("#d8b46c") if hov else Color(0.55, 0.42, 0.22, 0.7), 1.0, 3.0)
		W.draw_svg(ci, "plus", Rect2(ar.position.x + 10, ar.get_center().y - 10, 20, 20), "#e9c878")
		S.text(ci, S.font("sans"), Vector2(ar.position.x + 40, ar.get_center().y + 7), "Add AI Player", 21, S.GOLD if hov else Color("#c9b38a"))
		_zone(0, ar, "add")
	W.frame_corners(ci, t.grow(-6), 26)

func _draw_row(ci: CanvasItem, t: Rect2, c: Dictionary, i: int, y: float) -> void:
	var p: Dictionary = _players()[i]
	var cy := y + ROW_H * 0.5
	var human := bool(p.human)
	# portrait: a voxel unit in the player's colour
	var pr := Rect2(c.name, cy - 26, 52, 52)
	ci.draw_rect(pr.grow(2), Color.BLACK)
	S.radial_box(ci, pr, [[0.0, Color("#2a5462")], [0.7, Color("#0c2a33")], [1.0, Color("#041116")]], Vector2(0.5, 0.3))
	var egy := EgyptIcons.is_egypt_god(str(p.god))
	var tex: Texture2D = _portraits.unit(("pharaoh" if human else "spearman") if egy else ("hero" if human else "hoplite"), int(p.color))
	if tex:
		# head and shoulders: the upper middle of the full-figure portrait
		var n := float(tex.get_width())
		ci.draw_texture_rect_region(tex, pr.grow(-2), Rect2(n * 0.3, n * 0.08, n * 0.4, n * 0.4))
	S.metal_border(ci, pr, 2.0)
	# name + controller
	var nx: float = c.name + 62
	W.draw_svg(ci, "villager" if human else "gear", Rect2(nx, cy - 11, 22, 22), "#c9d6d2")
	S.text(ci, S.font("bold"), Vector2(nx + 30, cy + 8), str(p.name), 24, Color("#fff4dc") if human else S.INK)
	if human:
		W.field(ci, Rect2(c.diff, cy - 19, 220, 38), "Player", false, false, false)
	else:
		_field(ci, Rect2(c.diff, cy - 19, 220, 38), "difficulty", i, "AI - " + M.option_name(M.DIFFICULTIES, p.ai))
	# pantheon
	var gc := Vector2(c.god, cy)
	var gh := _hover(Rect2(gc - Vector2(26, 26), Vector2(52, 52)))
	W.god_disc(ci, gc, 23, str(p.god), gh)
	_zone(0, Rect2(gc - Vector2(26, 26), Vector2(52, 52)), "god", i)
	# colour
	_field(ci, Rect2(c.color, cy - 19, 96, 38), "color", i, str(p.color), true, M.color_of(int(p.color)))
	# team
	var ffa := bool(settings.free_for_all)
	var tl := "—" if ffa else "Team %d" % int(p.team)
	_field(ci, Rect2(c.team, cy - 19, 170, 38), "team", i, tl, not ffa and not bool(settings.lock_teams))
	# remove (AI rows while more than 2 players)
	if not human and _players().size() > 2:
		var rr := Rect2(c.remove, cy - 16, 32, 32)
		var hov := _hover(rr)
		W.draw_box(ci, rr, Color(0.25, 0.06, 0.05, 0.6) if hov else Color(0, 0, 0, 0.25), Color("#d8b46c") if hov else Color(0.55, 0.42, 0.22, 0.6), 1.0, 16.0)
		W.draw_svg(ci, "close", rr.grow(-8), "#f3d8b0" if hov else "#b8a47c")
		_zone(0, rr, "remove", i)

# map panel ----------------------------------------------------------------------------------

func _draw_map_panel(ci: CanvasItem) -> void:
	var r := map_rect()
	var x0 := r.position.x + 22
	var fx := r.end.x - 22 - 230
	var y := r.position.y + 22
	_label(ci, Vector2(x0, y + 26), "Player Count:", 22)
	_field(ci, Rect2(fx, y, 230, 38), "count", 0, str(_players().size()))
	y += 58
	var map_name: String = "Random Map" if settings.map == "random" else M.MAPS[settings.map].name
	S.text(ci, S.font("black"), Vector2(r.position.x, y + 30), map_name, 32, Color("#f6e7c1"), HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.95, 0.6)
	y += 48
	var ps := 262.0
	var pr := Rect2(r.get_center().x - ps * 0.5, y, ps, ps)
	_draw_preview(ci, pr)
	y += ps + 20
	var br := Rect2(r.get_center().x - 130, y, 260, 42)
	W.pill(ci, br, "Select Map", "bronze", _hover(br), true, 22)
	_zone(0, br, "select_map")
	y += 56
	var rows := [
		["Map Size:", "size", M.option_name(M.SIZES, int(settings.map_size))],
		["Map Seed:", "seed", str(settings.seed)],
		["Map Visibility:", "visibility", M.option_name(M.VISIBILITY, settings.visibility)],
		["-", "", ""],
		["Starting Resources:", "resources", M.option_name(M.RESOURCES, settings.resources)],
		["Game Speed:", "speed", M.option_name(M.SPEEDS, float(settings.speed))],
	]
	for row in rows:
		if row[0] == "-":
			W.rule(ci, Vector2(x0, y + 4), Vector2(r.end.x - 22, y + 4), false)
			y += 12
			continue
		_label(ci, Vector2(x0, y + 26), row[0], 22)
		if row[1] == "seed":
			var sr := Rect2(fx, y, 230 - 48, 38)
			W.field(ci, sr, str(row[2]), false, false, false)
			var dr := Rect2(fx + 230 - 40, y, 40, 38)
			var dh := _hover(dr)
			W.draw_box(ci, dr, Color("#10323b") if dh else Color("#0a1f25"), Color("#f3d893") if dh else Color("#8c6a36"), 1.0, 3.0)
			W.draw_svg(ci, "dice", dr.grow(-8), "#f3d893" if dh else "#e9c878")
			_zone(0, dr, "reseed")
		else:
			_field(ci, Rect2(fx, y, 230, 38), row[1], 0, row[2])
		y += 44
	y += 4
	for tg in [["Free for All", "free_for_all"], ["Lock Teams", "lock_teams"]]:
		_label(ci, Vector2(x0, y + 23), tg[0], 22)
		var trr := Rect2(r.end.x - 22 - 58, y + 4, 58, 28)
		var hr := Rect2(x0, y, r.size.x - 44, 36)
		W.toggle(ci, trr, bool(settings[tg[1]]), _hover(hr))
		_zone(0, hr, "toggle", tg[1])
		y += 38

func _draw_preview(ci: CanvasItem, pr: Rect2) -> void:
	# ornate frame: dark mat, bronze bevel, gold hairline
	S.drop_shadow(ci, pr.grow(10), 6, 20, 0.6)
	ci.draw_rect(pr.grow(12), Color("#050505"))
	S.vgrad(ci, pr.grow(10), S.METAL)
	ci.draw_rect(pr.grow(6), Color("#2a1d0c"))
	S.vgrad(ci, pr.grow(5), [[0.0, Color("#f3d893")], [1.0, Color("#8c6a36")]])
	ci.draw_rect(pr.grow(2), Color.BLACK)
	var pv := _preview_now()
	if pv.is_empty():
		ci.draw_rect(pr, Color("#123a46"))
		return
	ci.draw_texture_rect(pv.tex, pr, false)
	# inner vignette
	for k in 6:
		ci.draw_rect(pr.grow(-k * 2.0), Color(0, 0, 0, 0.16 - k * 0.025), false, 2.0)
	if settings.map == "random":
		ci.draw_rect(pr, Color(0.02, 0.05, 0.06, 0.55))
		S.text(ci, S.font("black"), Vector2(pr.position.x, pr.get_center().y + 50), "?", 150, Color("#fff4dc"), HORIZONTAL_ALIGNMENT_CENTER, pr.size.x, 1.0)
	else:
		var ps := _players()
		var starts: Array = pv.starts
		for i in mini(starts.size(), ps.size()):
			var sp: Vector2 = pr.position + starts[i] * pr.size
			var col := M.color_of(int(ps[i].color))
			# a Town Center marker: a bordered square in the player's colour
			var sq := Rect2(sp - Vector2(8, 8), Vector2(16, 16))
			ci.draw_rect(sq.grow(2), Color(0, 0, 0, 0.85))
			ci.draw_rect(sq, col)
			ci.draw_rect(sq, Color(1, 1, 1, 0.9), false, 1.5)
			S.text(ci, S.font("bold"), Vector2(sq.position.x, sq.end.y - 2), str(i + 1), 14, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, sq.size.x, 0.9)
	W.frame_corners(ci, pr.grow(10), 18)

func _draw_bottom(ci: CanvasItem) -> void:
	var cr := chat_rect()
	var tip: String = _note if _note != "" else M.MAPS.get(settings.map, {}).get("blurb", "The map is rolled from all maps that fit the player count.")
	W.draw_svg(ci, "scroll", Rect2(cr.position.x + 12, cr.get_center().y - 11, 22, 22), "#c9b38a")
	S.text(ci, S.font("sans"), Vector2(cr.position.x + 44, cr.get_center().y + 7), W.ellipsize(S.font("sans"), tip, 19, cr.size.x - 60), 19,
		Color("#f3d8a0") if _note != "" else S.MUTED)
	W.pill(ci, leave_rect(), "Leave", "bronze", _hover(leave_rect()))
	_zone(0, leave_rect(), "back")
	W.pill(ci, play_rect(), "Play", "green", _hover(play_rect()))
	_zone(0, play_rect(), "play")

# open dropdown ----------------------------------------------------------------------------------

func _draw_open(ci: CanvasItem) -> void:
	var items: Array = _open.items
	var lr := W.list_rect(_open.anchor, items.size(), _css.y, float(_open.get("min_w", 0.0)))
	var hover := -1
	for i in items.size():
		var ir := Rect2(lr.position.x + 4, lr.position.y + 4 + i * W.ITEM_H, lr.size.x - 8, W.ITEM_H)
		if ir.has_point(_mouse):
			hover = i
	var cur := _index_of(items, _open.cur)
	# re-draw the anchor field open over the dim content
	var rects := W.draw_list(ci, lr, items, cur, hover)
	for i in rects.size():
		_zone(1, rects[i], "item", i)

# pantheon picker ---------------------------------------------------------------------------------

func _draw_god_modal(ci: CanvasItem) -> void:
	var r := modal_rect()
	var p: Dictionary = _players()[_modal_arg]
	S.text(ci, S.font("black"), Vector2(r.position.x + 40, r.position.y + 60), "Select Pantheon", 38, Color("#f0d48a"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.95, 0.8)
	S.text(ci, S.font("sans"), Vector2(r.position.x, r.position.y + 56), "for %s" % p.name, 21, S.MUTED, HORIZONTAL_ALIGNMENT_RIGHT, r.size.x - 90)
	var cx := Rect2(r.end.x - 60, r.position.y + 24, 36, 36)
	W.draw_svg(ci, "close", cx.grow(-6), "#f3d893" if _hover(cx, 1) else "#c9a258")
	_zone(1, cx, "modal_close")
	# left: gods by culture (Retold's Select Pantheon, reference/egypt/ui_04.jpg)
	var lx := r.position.x + 40
	var ly := r.position.y + 96
	var col_r := Rect2(lx - 10, ly, 360, r.size.y - 196)
	W.draw_box(ci, col_r, Color(0, 0, 0, 0.3), Color(0.55, 0.42, 0.22, 0.6), 1.0, 3.0)
	var yy := ly
	for cu in M.CULTURES:
		S.text(ci, S.font("title"), Vector2(col_r.position.x, yy + 38), str(cu[0]).to_upper(), 24, Color("#e9c878"), HORIZONTAL_ALIGNMENT_CENTER, col_r.size.x, 0.9, 2.0)
		W.rule(ci, Vector2(col_r.position.x + 30, yy + 54), Vector2(col_r.end.x - 30, yy + 54))
		var gods: Array = cu[1]
		for gi in gods.size():
			var g: String = gods[gi]
			var gd: Dictionary = M.GODS[g]
			var card := Rect2(col_r.position.x + 20 + gi * 110, yy + 70, 100, 132)
			var av := bool(gd.available)
			var hov := _hover(card, 1) and av
			var sel := _god_pick == g
			W.draw_box(ci, card, Color(0.06, 0.16, 0.19, 0.9) if sel else Color(0.02, 0.05, 0.06, 0.8),
				Color("#f3d893") if sel or hov else Color(0.55, 0.42, 0.22, 0.7), 2.0 if sel else 1.0, 3.0)
			W.god_disc(ci, Vector2(card.get_center().x, card.position.y + 46), 33, g, hov, not av)
			S.text(ci, S.font("title"), Vector2(card.position.x, card.end.y - 32), gd.name.to_upper(), 16, Color("#e9c878") if av else Color(0.55, 0.53, 0.5), HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 0.8, 1.0)
			S.text(ci, S.font("sans"), Vector2(card.position.x, card.end.y - 12), "Available" if av else "Locked", 14,
				Color(0.6, 0.8, 0.6) if av else Color(0.55, 0.52, 0.48), HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 0.6)
			_zone(1, card, "god_pick", g)
		yy += 222
	for k in 2:
		var ty := yy + 30 + k * 68
		S.text(ci, S.font("title"), Vector2(col_r.position.x, ty), ["NORSE", "ATLANTEANS"][k], 20, Color(0.55, 0.52, 0.47), HORIZONTAL_ALIGNMENT_CENTER, col_r.size.x, 0.8, 2.0)
		S.text(ci, S.font("sans"), Vector2(col_r.position.x, ty + 26), "Not in the game yet", 16, Color(0.5, 0.49, 0.46), HORIZONTAL_ALIGNMENT_CENTER, col_r.size.x, 0.6)
	# centre: the god
	var g0 := _god_pick
	var gd: Dictionary = M.GODS[g0]
	var egy := EgyptIcons.is_egypt_god(g0)
	var mx := r.position.x + 420
	var mw := 440.0
	var plaque := Rect2(mx, ly, mw, 78)
	W.draw_box(ci, plaque, Color(0.03, 0.07, 0.08, 0.95), Color("#c9a258"), 2.0, 4.0)
	W.frame_corners(ci, plaque.grow(-4), 14)
	S.text(ci, S.font("black"), Vector2(mx, ly + 38), gd.name.to_upper(), 30, Color("#fff0c0"), HORIZONTAL_ALIGNMENT_CENTER, mw, 0.9, 1.5)
	S.text(ci, S.font("title"), Vector2(mx, ly + 64), gd.title.to_upper(), 15, Color("#d8c9a0"), HORIZONTAL_ALIGNMENT_CENTER, mw, 0.8, 1.0)
	var art := Rect2(mx + 40, ly + 96, mw - 80, 260)
	_god_art(ci, art, g0)
	var dr := Rect2(mx, art.end.y + 20, mw, r.end.y - 92 - (art.end.y + 20))
	W.draw_box(ci, dr, Color(0.01, 0.03, 0.035, 0.85), Color(0.55, 0.42, 0.22, 0.8), 1.0, 3.0)
	var ly2 := dr.position.y + 30
	if str(gd.get("focus", "")) != "":
		S.text(ci, S.font("bold"), Vector2(dr.position.x + 14, ly2), str(gd.focus), 17, S.GOLD)
		ly2 += 28
	var lines: Array = gd.get("lines", [])
	for li in lines.size():
		S.text(ci, S.font("bold"), Vector2(dr.position.x + 14, ly2), "•", 17, S.GOLD)
		ly2 = _wrap(ci, str(lines[li]), Vector2(dr.position.x + 30, ly2), dr.size.x - 44, 17, S.INK) + 28
	# right: god powers (Zeus: his three; an Egyptian: his Archaic power, then the
	# minor gods he picks from at each age-up with their powers, as ui_04's tree)
	var rx := mx + mw + 36
	var rw := r.end.x - 36 - rx
	S.text(ci, S.font("title"), Vector2(rx, ly + 30), "GOD POWERS" if not egy else "GOD POWER AND MINOR GODS", 22, Color("#e9c878"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9, 2.0)
	W.rule(ci, Vector2(rx, ly + 46), Vector2(rx + rw, ly + 46), false)
	if not egy:
		var keys := {"lightning_storm": "Z", "bolt": "C", "meteor": "V"}
		var pw: Array = gd.get("powers", [])
		for pi in pw.size():
			var py := ly + 70 + pi * 96
			_power_row(ci, Rect2(rx, py, rw, 80), str(pw[pi]), keys.get(pw[pi], ""))
		_wrap(ci, "Minor gods (one per age) are not in the game yet.", Vector2(rx, ly + 70 + 3 * 96 + 16), rw, 16, Color(0.6, 0.6, 0.56))
	else:
		var py := ly + 64
		_age_medal(ci, Vector2(rx + 30, py + 36), 0)
		_power_row(ci, Rect2(rx + 74, py, rw - 74, 80), str(gd.powers[0]), "Z")
		var sim_ref: Object = _sim_for_gods()
		for age in [1, 2, 3]:
			var ay: float = ly + 168 + (age - 1) * 152
			ci.draw_line(Vector2(rx, ay - 10), Vector2(rx + rw, ay - 10), Color(0.55, 0.42, 0.22, 0.45), 1.0)
			_age_medal(ci, Vector2(rx + 30, ay + 64), age)
			var offer := EgyptIcons.offered(sim_ref, g0, age)
			for k in offer.size():
				var mg: String = offer[k]
				var info: Dictionary = EgyptIcons.MINOR.get(mg, {"name": mg.capitalize(), "power": "", "focus": ""})
				var gy: float = ay + k * 68
				var gc2 := Vector2(rx + 98, gy + 30)
				W.minor_disc(ci, gc2, 28, mg)
				S.text(ci, S.font("title7"), Vector2(rx + 136, gy + 22), str(info.name), 21, S.INK)
				S.text(ci, S.font("sans"), Vector2(rx + 136, gy + 46), str(info.focus), 15, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
				var pk := str(info.power)
				if pk != "":
					var ic := Rect2(rx + rw - 172, gy + 6, 44, 44)
					S.cell(ci, ic, [[0.0, Color("#4c77b0")], [0.82, Color("#152847")], [1.0, Color("#152847")]], Vector2(0.5, 0.38), 2.0)
					S.draw_icon(ci, "meteor" if pk == "thoth_meteor" else pk, ic.grow(-7))
					_wrap(ci, str(M.POWERS.get(pk, [pk.capitalize()])[0]), Vector2(ic.end.x + 8, gy + 34), 118, 15, Color("#d8e6f0"))
	var cb := Rect2(r.get_center().x - 160, r.end.y - 68, 320, 44)
	W.pill(ci, cb, "Confirm %s" % gd.name, "bronze", _hover(cb, 1))
	_zone(1, cb, "god_confirm")
	# clicks anywhere else in the modal are swallowed
	_zones[1].push_front({"rect": Rect2(Vector2.ZERO, _css), "id": "none", "arg": null})

## the god card's art: his colours and emblem over a sun / sea / desert glow
func _god_art(ci: CanvasItem, art: Rect2, god: String) -> void:
	S.vgrad(ci, art.grow(4), S.METAL)
	var stops: Array
	match god:
		"ra": stops = [[0.0, Color("#fff6d0")], [0.3, Color("#f2b850")], [0.7, Color("#a8481a")], [1.0, Color("#2a0c04")]]
		"isis": stops = [[0.0, Color("#eefcff")], [0.32, Color("#6cc8d8")], [0.72, Color("#1c5a86")], [1.0, Color("#071a30")]]
		"set": stops = [[0.0, Color("#ffe2b8")], [0.3, Color("#d8783c")], [0.72, Color("#6a1a10")], [1.0, Color("#1a0604")]]
		_: stops = [[0.0, Color("#f8e8b8")], [0.35, Color("#7da0c4")], [0.75, Color("#253c5c")], [1.0, Color("#0c1626")]]
	S.radial_box(ci, art, stops, Vector2(0.5, 0.35))
	if EgyptIcons.is_egypt_god(god):
		# a horizon of dunes / the Nile under the emblem, and two gold obelisk bands
		var hz := art.position.y + art.size.y * 0.78
		var dune := PackedVector2Array([Vector2(art.position.x, art.end.y), Vector2(art.position.x, hz)])
		for k in 9:
			var x := art.position.x + art.size.x * k / 8.0
			dune.append(Vector2(x, hz + sin(k * 1.7) * 6.0))
		dune.append(Vector2(art.end.x, art.end.y))
		var dc: Color = {"ra": Color(0.36, 0.14, 0.04, 0.75), "isis": Color(0.04, 0.16, 0.3, 0.75), "set": Color(0.3, 0.07, 0.03, 0.75)}[god]
		ci.draw_colored_polygon(dune, dc)
		for side in [0, 1]:
			var bx := art.position.x + 18 if side == 0 else art.end.x - 30
			ci.draw_rect(Rect2(bx, art.position.y + 14, 12, art.size.y - 28), Color(0, 0, 0, 0.25))
			ci.draw_rect(Rect2(bx + 2, art.position.y + 16, 8, art.size.y - 32), Color("#d8a840"))
			for k in 8:
				ci.draw_rect(Rect2(bx + 2, art.position.y + 26 + k * (art.size.y - 52) / 8.0, 8, 3), Color("#2e5ea6"))
	var em := S.icon_glow(god, 200, 6)
	if em:
		ci.draw_texture_rect(em, Rect2(art.get_center() - Vector2(em.get_width(), em.get_height()) * 0.5, Vector2(em.get_width(), em.get_height())), false, Color(1.0, 0.95, 0.7, 0.55))
	W.draw_svg(ci, god, Rect2(art.get_center() - Vector2(100, 100), Vector2(200, 200)), "#fff8e0")

## a god power row of the card: icon cell, name, hotkey chip, one line
func _power_row(ci: CanvasItem, r: Rect2, key: String, hotkey: String) -> void:
	var ic := Rect2(r.position, Vector2(72, 72))
	S.cell(ci, ic, [[0.0, Color("#2a6a7a")], [0.7, Color("#0c2a33")], [1.0, Color("#041116")]], Vector2(0.5, 0.3), 2.0)
	var icon: String = {"lightning_storm": "storm", "thoth_meteor": "meteor"}.get(key, key)
	S.draw_icon(ci, icon, ic.grow(-14))
	var nm: Array = M.POWERS.get(key, [key.capitalize(), ""])
	S.text(ci, S.font("title7"), Vector2(r.position.x + 88, r.position.y + 28), str(nm[0]), 21, S.INK)
	_wrap(ci, str(nm[1]), Vector2(r.position.x + 88, r.position.y + 54), r.size.x - 92, 16, S.MUTED)
	if hotkey != "":
		var kr := Rect2(r.position.x + 88 + S.text_width(S.font("title7"), str(nm[0]), 21) + 10, r.position.y + 7, 28, 27)
		W.draw_box(ci, kr, Color(0, 0, 0, 0.5), Color("#8c6a36"), 1.0, 3.0)
		S.text(ci, S.font("bold"), Vector2(kr.position.x, kr.position.y + 21), hotkey, 17, S.GOLD, HORIZONTAL_ALIGNMENT_CENTER, kr.size.x)

## the age medallion of the minor-god tree (I bronze, II silver, III gold, IV green: Retold's)
func _age_medal(ci: CanvasItem, c: Vector2, age: int) -> void:
	var face: Array = [[[0.0, Color("#f0b884")], [0.6, Color("#a05a28")], [1.0, Color("#4a2410")]],
		[[0.0, Color("#ffffff")], [0.6, Color("#a8b0b8")], [1.0, Color("#40464e")]],
		[[0.0, Color("#fff4c0")], [0.6, Color("#d8a630")], [1.0, Color("#5a3c08")]],
		[[0.0, Color("#b8f0c0")], [0.6, Color("#2e9a50")], [1.0, Color("#0a3818")]]][clampi(age, 0, 3)]
	ci.draw_circle(c + Vector2(0, 2), 25, Color(0, 0, 0, 0.6), true, -1.0, true)
	ci.draw_circle(c, 24, Color("#1a1206"), true, -1.0, true)
	S.disc(ci, c, 22, S.radial_tex(face, Vector2(0.5, 0.3), 0.7, 64))
	ci.draw_arc(c, 18, 0, TAU, 40, Color(0, 0, 0, 0.35), 1.5, true)
	var rn: String = ["I", "II", "III", "IV"][clampi(age, 0, 3)]
	S.text(ci, S.font("black"), Vector2(c.x - 30, c.y + 9), rn, 24, Color("#fff8e0"), HORIZONTAL_ALIGNMENT_CENTER, 60, 0.9)

## a sim to ask which minor gods a major god offers (the screen has none of its own)
static var _gods_sim: Object = null
func _sim_for_gods() -> Object:
	if _gods_sim == null and ClassDB.class_exists("AovSim"):
		_gods_sim = ClassDB.instantiate("AovSim")
	return _gods_sim

# map chooser ---------------------------------------------------------------------------------------

func _draw_map_modal(ci: CanvasItem) -> void:
	var r := modal_rect()
	S.text(ci, S.font("black"), Vector2(r.position.x + 40, r.position.y + 60), "Select Map", 38, Color("#f0d48a"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.95, 0.8)
	var n := _players().size()
	S.text(ci, S.font("sans"), Vector2(r.position.x, r.position.y + 56), "%d players  ·  %s  ·  seed %d" % [n, M.option_name(M.SIZES, int(settings.map_size)), settings.seed], 20,
		S.MUTED, HORIZONTAL_ALIGNMENT_RIGHT, r.size.x - 90)
	var cx := Rect2(r.end.x - 60, r.position.y + 24, 36, 36)
	W.draw_svg(ci, "close", cx.grow(-6), "#f3d893" if _hover(cx, 1) else "#c9a258")
	_zone(1, cx, "modal_close")
	var keys: Array = M.MAP_ORDER.duplicate()
	keys.append("random")
	var cw := (r.size.x - 80 - 4 * 24) / 5.0
	for i in keys.size():
		var k: String = keys[i]
		var card := Rect2(r.position.x + 40 + i * (cw + 24), r.position.y + 110, cw, r.size.y - 150)
		var ok := M.map_supports(k, n)
		var sel: bool = settings.map == k
		var hov := _hover(card, 1) and ok
		W.draw_box(ci, card, Color(0.05, 0.14, 0.17, 0.95) if sel else Color(0.02, 0.05, 0.06, 0.85),
			Color("#f3d893") if sel or hov else Color(0.55, 0.42, 0.22, 0.7), 2.0 if sel else 1.0, 4.0)
		var pr := Rect2(card.position.x + 16, card.position.y + 16, cw - 32, cw - 32)
		ci.draw_rect(pr.grow(3), Color.BLACK)
		S.vgrad(ci, pr.grow(2), S.METAL)
		if k == "random":
			S.radial_box(ci, pr, [[0.0, Color("#2a5462")], [0.7, Color("#0c2a33")], [1.0, Color("#041116")]], Vector2(0.5, 0.4))
			S.text(ci, S.font("black"), Vector2(pr.position.x, pr.get_center().y + 40), "?", 120, Color("#fff4dc"), HORIZONTAL_ALIGNMENT_CENTER, pr.size.x, 1.0)
		else:
			var pv := MapPreview.build(M.MAPS[k].preset, int(settings.seed), int(settings.map_size), n if ok else 2)
			if not pv.is_empty():
				ci.draw_texture_rect(pv.tex, pr, false, Color.WHITE if ok else Color(0.4, 0.4, 0.4))
		var title: String = "Random Map" if k == "random" else M.MAPS[k].name
		S.text(ci, S.font("title"), Vector2(card.position.x, pr.end.y + 40), title, 22, Color("#fff0c0") if ok else Color(0.55, 0.53, 0.5), HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 0.9, 0.5)
		var blurb: String = "Any map that fits the player count." if k == "random" else M.MAPS[k].blurb
		_wrap(ci, blurb, Vector2(card.position.x + 16, pr.end.y + 72), card.size.x - 32, 17, S.MUTED if ok else Color(0.45, 0.45, 0.43))
		var cap := "2 - %d players" % M.MAX_PLAYERS if (k == "random" or M.starts_for(k, M.MAX_PLAYERS) >= M.MAX_PLAYERS) else "2 players"
		S.text(ci, S.font("bold"), Vector2(card.position.x, card.end.y - 20), cap, 17, Color(0.62, 0.82, 0.62) if ok else Color(0.8, 0.55, 0.4), HORIZONTAL_ALIGNMENT_CENTER, card.size.x, 0.7)
		if not ok:
			W.draw_svg(ci, "lock", Rect2(pr.get_center() - Vector2(24, 24), Vector2(48, 48)), "#d8c08a")
		else:
			_zone(1, card, "map_pick", k)
	_zones[1].push_front({"rect": Rect2(Vector2.ZERO, _css), "id": "none", "arg": null})

## Word-wrapped text; returns the last line's baseline.
func _wrap(ci: CanvasItem, s: String, pos: Vector2, width: float, size: int, col: Color) -> float:
	var f := S.font("sans")
	var line := ""
	var y := pos.y
	for word in s.split(" "):
		var t := word if line == "" else line + " " + word
		if f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > width and line != "":
			S.text(ci, f, Vector2(pos.x, y), line, size, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
			y += size + 6
			line = word
		else:
			line = t
	if line != "":
		S.text(ci, f, Vector2(pos.x, y), line, size, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	return y
