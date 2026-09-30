extends CanvasLayer
## Loading screen between the main menu, the match setup and a match (after
## Age of Mythology: Retold's: the map's name and blurb over the setup
## screen's slate, the map itself in a bronze frame, the players by team
## with their colours, god and difficulty, a cast-bronze progress bar with
## what is being built, a tip). Drawn in the HUD style (hud_style.gd,
## panel.gdshader, setup_bg.gdshader) in 1920x1080 CSS px scaled by the
## window height, like the menu and the setup screen.
##
## It lives under the tree root (not the current scene), so it stays up
## while main.tscn is torn down and rebuilt:
##
##   Loading.begin(tree, args, go)   # show it for main.gd args, then go.call() once it is on screen
##   Loading.current(tree)           # the one on screen, or null (main.gd builds in stages then)
##   loading.progress(0.4, "Raising the town")   # main.gd between build stages
##   loading.seat(sim)               # the match is seated: the real starts, in the players' colours
##   loading.finish()                # the scene is built: fill the bar, fade out, free
##
## Only a flow switch (Flow.start_match / to_main_menu / restart) shows it;
## a command-line run (captures, checks) never has one and builds at once.

const S := preload("res://game/ui/hud_style.gd")
const PANEL := preload("res://game/ui/panel.gdshader")
const BG := preload("res://game/menu/setup/setup_bg.gdshader")
const M_PATH := "res://game/menu/setup/match_settings.gd"
const PREVIEW_PATH := "res://game/menu/setup/map_preview.gd"
const NODE_NAME := "AovLoading"
const FADE_IN := 0.25
const FADE_OUT := 0.45

var target := "match"         # "match" | "menu"
var info := {}                # {map, blurb, kicker, teams: [[{name, color: Color, sub, human}]], preset, seed, size, n}
var value := 0.0              # 0..1, the bar
var stage := ""
var tip := ""
var shown_frames := 0         # frames drawn since begin (the check reads it)
var finished := false
var _alpha := 0.0
var _fading_out := false
var _t := 0.0
var _root: Control
var _bg: ColorRect
var _panels: Array = []       # [ColorRect, Rect2 CSS]
var _view: Control
var _css := Vector2(1920, 1080)
var _map_tex: Texture2D = null
var _starts: Array = []       # [{pos: Vector2 0..1, color: Color, n: int}]
var _portraits: Node = null   # the setup screen's voxel portraits in our colour index
var _portrait_frames := 0     # frames the root keeps its 3D on so the portraits render

static func current(tree: SceneTree) -> Node:
	if tree == null or tree.root == null:
		return null
	var n := tree.root.get_node_or_null(NODE_NAME)
	return n if n != null and not n.is_queued_for_deletion() and not n.finished else null

## Show the loading screen for main.gd args `a`, then call `go` once it has
## been drawn (the scene switch blocks while the new scene's _ready runs).
static func begin(tree: SceneTree, a: Dictionary, go: Callable) -> void:
	var old := tree.root.get_node_or_null(NODE_NAME)
	if old != null:
		old.name = "AovLoadingOld"
		old.queue_free()
	var l: CanvasLayer = load("res://game/menu/loading.gd").new()
	l.name = NODE_NAME
	l.configure(a)
	tree.root.add_child(l)
	await tree.process_frame
	await tree.process_frame
	if DisplayServer.get_name() != "headless":
		await RenderingServer.frame_post_draw
	go.call()

func _init() -> void:
	layer = 128
	process_mode = Node.PROCESS_MODE_ALWAYS

func configure(a: Dictionary) -> void:
	target = "menu" if str(a.get("scene", "")) == "menu" else "match"
	var tips: Array = []
	if ResourceLoader.exists("res://game/menu/menu.gd"):
		var ms: Script = load("res://game/menu/menu.gd")
		var c: Dictionary = ms.get_script_constant_map()
		tips = c.get("TIPS", [])
	if not tips.is_empty():
		tip = str(tips[absi(int(a.get("seed", Time.get_ticks_msec() / 1000))) % tips.size()])
	info = _match_info(a) if target == "match" else {}
	stage = "Returning to the main menu" if target == "menu" else "Preparing the match"
	if target == "match":
		_find_preview()

## What the card shows for a match: from the setup screen's settings (the
## `match` arg) when there is one, else the scene's defaults (Quick Match).
func _match_info(a: Dictionary) -> Dictionary:
	var M: Script = load(M_PATH) if ResourceLoader.exists(M_PATH) else null
	var m := {}
	if M != null:
		m = M.from_args(a)
	var out := {"map": "Aegean Hills", "blurb": "", "kicker": "SKIRMISH  ·  CONQUEST", "teams": [], "preset": str(a.get("preset", "skirmish")),
		"seed": int(a.get("seed", 3)), "size": int(a.get("mapsize", 128)), "n": int(a.get("players", 2))}
	var maps: Dictionary = M.MAPS if M != null else {}
	if m.is_empty():
		for k in maps:
			if str(maps[k].preset) == out.preset:
				out.map = str(maps[k].name)
				out.blurb = str(maps[k].get("blurb", ""))
				break
		out.kicker = "QUICK MATCH  ·  CONQUEST"
		var you := {"name": "You", "color": S.hex(0x2f6bff), "sub": "Zeus  ·  Player", "human": true, "n": 1}
		var foe := {"name": "Enemy", "color": S.hex(0xe0282e), "sub": "Zeus  ·  AI Moderate", "human": false, "n": 2}
		out.teams = [[you], [foe]]
		return out
	var mk := str(m.get("map", ""))
	if maps.has(mk):
		out.map = str(maps[mk].name)
		out.blurb = str(maps[mk].get("blurb", ""))
	out.preset = str(m.get("preset", out.preset))
	out.seed = int(m.get("seed", out.seed))
	out.size = int(m.get("map_size", out.size))
	var players: Array = m.get("players", [])
	out.n = players.size()
	var size_name := str(M.option_name(M.SIZES, out.size)) if "SIZES" in M else ""
	var ffa := bool(m.get("free_for_all", false))
	out.kicker = "SKIRMISH  ·  %s  ·  %s MAP  ·  %d PLAYERS" % ["FREE FOR ALL" if ffa else "CONQUEST", size_name.to_upper(), players.size()]
	var by_team := {}
	var order: Array = []
	for i in players.size():
		var p: Dictionary = players[i]
		var t: int = int(M.team_of(m, i))
		if not by_team.has(t):
			by_team[t] = []
			order.append(t)
		var god := str(M.GODS.get(str(p.get("god", "zeus")), {}).get("name", "Zeus")) if "GODS" in M else "Zeus"
		var human := bool(p.get("human", i == 0))
		var sub := "%s  ·  %s" % [god, "Player" if human else "AI " + str(M.option_name(M.DIFFICULTIES, str(p.get("ai", "moderate"))))]
		by_team[t].append({"name": "You" if human and str(p.get("name", "")) == "" else str(p.get("name", "Player %d" % (i + 1))),
			"color": M.color_of(int(p.get("color", i + 1))), "ci": int(p.get("color", i + 1)), "sub": sub, "human": human, "n": i + 1, "team": t})
	for t in order:
		out.teams.append(by_team[t])
	var singles := true
	for t in out.teams:
		singles = singles and (t as Array).size() == 1
	out["ffa"] = ffa or singles  # every player on his own: one list, no team headers
	return out

## The setup screen already drew this map (its preview cache): use it at once.
func _find_preview() -> void:
	if not ResourceLoader.exists(PREVIEW_PATH):
		return
	var P: Script = load(PREVIEW_PATH)
	var key := "%s/%d/%d/%d" % [info.preset, info.seed, info.size, info.n]
	var cache: Dictionary = P.get("_cache") if P.get("_cache") != null else {}
	if cache.has(key):
		_use_preview(cache[key])

func _use_preview(pv: Dictionary) -> void:
	_map_tex = pv.get("tex")
	if _starts.is_empty():
		for st in pv.get("starts", []):
			_starts.append({"pos": st, "color": S.GOLD, "n": 0})

## main.gd: the sim world exists (after new_game); draw its map if the
## preview was not cached.
func map_ready(_sim: Object) -> void:
	_make_portraits()
	if _map_tex != null or target != "match" or not ResourceLoader.exists(PREVIEW_PATH):
		return
	var pv: Dictionary = load(PREVIEW_PATH).build(str(info.preset), int(info.seed), int(info.size), int(info.n))
	if pv.has("tex"):
		_use_preview(pv)
	_redraw()

## The setup screen's voxel portraits (its ColorPortraits: our colour index).
## Made once the new scene exists, and drawn with the root viewport's 3D on
## (SubViewports rendered while a scene world exists under a root with
## disable_3d come out as flat close-ups): _portrait_frames keeps it on.
func _make_portraits() -> void:
	var sp := "res://game/menu/setup/setup.gd"
	if _portraits != null or target != "match" or not ResourceLoader.exists(sp):
		return
	var cp = (load(sp) as Script).get_script_constant_map().get("ColorPortraits")
	if cp is Script:
		_portraits = cp.new()
		add_child(_portraits)
		for t in info.get("teams", []):
			for p in t:
				_portraits.unit("hero" if bool(p.human) else "hoplite", int(p.get("ci", p.n)))
		_portrait_frames = 2
		get_viewport().disable_3d = false

## main.gd: the players are seated: the real Town Center spots in their colours.
func seat(sim: Object) -> void:
	if sim == null:
		return
	var size := float(sim.get_map_size())
	_starts.clear()
	for s in sim.get_starts():
		var owner := int(s.get("owner", 0))
		var col := Color(0.9, 0.8, 0.5)
		if owner > 0:
			col = S.hex(int(sim.get_player(owner).get("color", 0xffffff)))
		_starts.append({"pos": Vector2((float(s.tx) + 0.5) / size, (float(s.tz) + 0.5) / size), "color": col, "n": owner})
	_redraw()

func progress(v: float, what: String) -> void:
	value = clampf(maxf(value, v), 0.0, 1.0)
	stage = what
	_redraw()

func finish() -> void:
	if finished:
		return
	finished = true
	get_viewport().disable_3d = false  # the world shows through the fade
	value = 1.0
	stage = "Ready"
	_redraw()
	_fading_out = true

func _ready() -> void:
	_root = Control.new()
	_root.mouse_filter = Control.MOUSE_FILTER_STOP  # nothing under it takes clicks while loading
	add_child(_root)
	_bg = ColorRect.new()
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bm := ShaderMaterial.new()
	bm.shader = BG
	_bg.material = bm
	_root.add_child(_bg)
	if target == "match":
		_panels.append([_panel(), "title"])
		_panels.append([_panel(), "map"])
		_panels.append([_panel(), "teams"])
	_panels.append([_panel(), "bar"])
	_view = Control.new()
	_view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_view.draw.connect(_draw_view)
	_root.add_child(_view)
	get_viewport().size_changed.connect(_layout)
	_layout()

func _panel() -> ColorRect:
	var cr := ColorRect.new()
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = PANEL
	m.set_shader_parameter("margin", 24.0)
	m.set_shader_parameter("chamfer", Vector4(12, 12, 12, 12))
	m.set_shader_parameter("border", Vector4(3, 3, 3, 3))
	m.set_shader_parameter("bg_mode", 1)
	m.set_shader_parameter("bg0", Color("#15303a"))
	m.set_shader_parameter("bg1", Color("#0b1a20"))
	m.set_shader_parameter("bg2", Color("#050c0f"))
	m.set_shader_parameter("radial_center", Vector2(0.5, 0.0))
	m.set_shader_parameter("radial_radius", Vector2(1.2, 1.1))
	m.set_shader_parameter("shadow_alpha", 0.6)
	cr.material = m
	_root.add_child(cr)
	return cr

# ---- layout (CSS px) ------------------------------------------------------------

func title_rect() -> Rect2: return Rect2(22, 22, _css.x - 44, 150)
func map_rect() -> Rect2:
	var s := minf(_css.y - 196 - 224, 700.0)
	return Rect2(maxf(60.0, _css.x * 0.5 - s - 40), 196, s, s)
func teams_rect() -> Rect2:
	var mr := map_rect().grow(18)
	return Rect2(mr.end.x + 50, mr.position.y, minf(760.0, _css.x - mr.end.x - 110), mr.size.y)
func bar_rect() -> Rect2:
	var w := minf(1300.0, _css.x - 200)
	if target == "menu":
		return Rect2((_css.x - w) * 0.5, _css.y * 0.5 + 60, w, 118)
	return Rect2((_css.x - w) * 0.5, _css.y - 170, w, 118)

func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	var sc := clampf(vs.y / 1080.0, 0.4, 3.0)
	transform = Transform2D().scaled(Vector2(sc, sc))
	_css = vs / sc
	for c in [_root, _bg, _view]:
		c.position = Vector2.ZERO
		c.size = _css
	(_bg.material as ShaderMaterial).set_shader_parameter("size", _css)
	for pr in _panels:
		var r: Rect2
		match str(pr[1]):
			"title": r = title_rect()
			"map": r = map_rect().grow(18)
			"teams": r = teams_rect()
			_: r = bar_rect()
		var cr: ColorRect = pr[0]
		cr.position = r.position - Vector2(24, 24)
		cr.size = r.size + Vector2(48, 48)
		(cr.material as ShaderMaterial).set_shader_parameter("size", r.size)
	_redraw()

func _redraw() -> void:
	if _view:
		_view.queue_redraw()

func _portraits_ok() -> bool:
	return _portraits != null or target != "match"

func _process(dt: float) -> void:
	_t += dt
	shown_frames += 1
	# the world under the opaque card is not drawn while it builds (a frame
	# per stage costs next to nothing then); the setup screen toggles it too
	if _portrait_frames > 0:
		_portrait_frames -= 1
	elif not finished and _alpha >= 1.0 and _portraits_ok():
		get_viewport().disable_3d = true
	if _fading_out:
		_alpha = maxf(0.0, _alpha - dt / FADE_OUT)
		if _alpha <= 0.0:
			queue_free()
			return
	else:
		_alpha = minf(1.0, _alpha + dt / FADE_IN) if shown_frames > 1 else maxf(_alpha, 0.35)
	_root.modulate.a = _alpha
	_redraw()

# ---- drawing -------------------------------------------------------------------

func _draw_view() -> void:
	var ci := _view
	if target == "menu":
		_draw_menu_title(ci)
	else:
		_draw_title(ci)
		_draw_map(ci)
		_draw_teams(ci)
	_draw_bar(ci)

func _rule(ci: CanvasItem, cx: float, y: float, half: float) -> void:
	S.hgrad(ci, Rect2(cx - half, y, half - 14, 1.4), [[0.0, Color(S.GOLD, 0.0)], [1.0, Color(S.GOLD, 0.8)]])
	S.hgrad(ci, Rect2(cx + 14, y, half - 14, 1.4), [[0.0, Color(S.GOLD, 0.8)], [1.0, Color(S.GOLD, 0.0)]])
	S.boss(ci, Vector2(cx, y + 0.7), 4.5)

func _draw_menu_title(ci: CanvasItem) -> void:
	var y := _css.y * 0.5 - 80
	S.text(ci, S.font("bold"), Vector2(0, y - 70), "MOUNT OLYMPUS", 18, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, _css.x, 0.8, 5.0)
	S.text(ci, S.font("black"), Vector2(0, y), "AGE OF VOXEL", 76, S.GOLD, HORIZONTAL_ALIGNMENT_CENTER, _css.x, 0.9, 6.0)
	_rule(ci, _css.x * 0.5, y + 34, 300)

func _draw_title(ci: CanvasItem) -> void:
	var r := title_rect()
	S.text(ci, S.font("bold"), Vector2(r.position.x, r.position.y + 42), str(info.kicker), 17, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.8, 3.0)
	S.text(ci, S.font("black"), Vector2(r.position.x, r.position.y + 100), str(info.map).to_upper(), 54, S.GOLD, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.9, 4.0)
	_rule(ci, r.get_center().x, r.position.y + 116, 260)
	S.text(ci, S.font("sans"), Vector2(r.position.x, r.position.y + 142), str(info.blurb), 19, S.INK, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.8)

func _draw_map(ci: CanvasItem) -> void:
	var r := map_rect()
	ci.draw_rect(r.grow(4), S.DARK)
	if _map_tex != null:
		ci.draw_texture_rect(_map_tex, r, false)
	else:
		S.radial_box(ci, r, [[0.0, Color("#1e4f3a")], [0.7, Color("#12301f")], [1.0, Color("#0a1a12")]], Vector2(0.5, 0.5))
		S.text(ci, S.font("bold"), Vector2(r.position.x, r.get_center().y), "Shaping the land", 18, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.8, 2.0)
	S.inset_shadow(ci, r, 18, 0.9)
	S.metal_border(ci, r.grow(4), 4)
	for c in [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]:
		S.boss(ci, c + (r.get_center() - c).sign() * -2.0, 7)
	var pulse := 0.5 + 0.5 * sin(_t * 4.0)
	for s in _starts:
		var p: Vector2 = r.position + (s.pos as Vector2) * r.size
		if int(s.n) <= 0:  # the generator's start, not seated yet
			ci.draw_circle(p, 7.0, S.DARK, true, -1.0, true)
			ci.draw_circle(p, 5.0, Color(S.GOLD_HI, 0.6 + 0.4 * pulse), true, -1.0, true)
			continue
		ci.draw_circle(p, 18.0 + 4.0 * pulse, Color(s.color, 0.18), true, -1.0, true)
		S.player_tag(ci, Rect2(p - Vector2(12, 12), Vector2(24, 24)), s.color, int(s.n), 14)

func _draw_teams(ci: CanvasItem) -> void:
	var r := teams_rect()
	var x := r.position.x + 36
	var y := r.position.y + 52
	S.text(ci, S.font("title"), Vector2(x, y), "PLAYERS", 26, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9, 2.0)
	y += 18
	ci.draw_line(Vector2(x, y), Vector2(r.end.x - 36, y), Color(S.BRONZE, 0.6), 1.0)
	var teams: Array = info.get("teams", [])
	var rows := 0
	for t in teams:
		rows += (t as Array).size()
	var avail := r.end.y - y - 30
	var row_h := clampf((avail - teams.size() * 58.0) / maxf(1.0, rows), 44.0, 76.0)
	y += 18
	var ffa := bool(info.get("ffa", false))
	for ti in teams.size():
		var team: Array = teams[ti]
		var label := "TEAM %d" % (ti + 1)
		if ffa and ti == 0:
			y += 30
			S.text(ci, S.font("bold"), Vector2(x, y), "FREE FOR ALL" if teams.size() > 2 else "ONE AGAINST ONE", 16, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8, 3.0)
			y += 14
		if not ffa:
			y += 30
			S.text(ci, S.font("bold"), Vector2(x, y), label, 16, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8, 3.0)
			if ti > 0 or teams.size() > 1:
				var tw := S.text_width(S.font("bold"), label, 16, 3.0)
				S.hgrad(ci, Rect2(x + tw + 16, y - 6, r.end.x - 36 - x - tw - 16, 1.2), [[0.0, Color(S.GOLD, 0.6)], [1.0, Color(S.GOLD, 0.0)]])
			y += 14
		for p in team:
			var ry := y
			var hi := bool(p.human)
			if hi:
				ci.draw_rect(Rect2(x - 12, ry + 2, r.end.x - 36 - x + 24, row_h - 6), Color(S.GOLD, 0.07))
			var ps := minf(row_h - 10.0, 56.0)
			var pr := Rect2(x, ry + (row_h - ps) * 0.5, ps, ps)
			ci.draw_rect(pr.grow(2), Color.BLACK)
			S.radial_box(ci, pr, [[0.0, Color("#2a5462")], [0.7, Color("#0c2a33")], [1.0, Color("#041116")]], Vector2(0.5, 0.3))
			var tex: Texture2D = _portraits.unit("hero" if hi else "hoplite", int(p.get("ci", p.n))) if _portraits != null else null
			if tex:
				var n := float(tex.get_width())
				ci.draw_texture_rect_region(tex, pr.grow(-2), Rect2(n * 0.3, n * 0.08, n * 0.4, n * 0.4))
			S.metal_border(ci, pr, 2.0)
			S.player_tag(ci, Rect2(pr.end.x - 12, pr.end.y - 14, 18, 18), p.color, int(p.n), 11)
			var tx := pr.end.x + 22
			var fs := 24 if row_h >= 56 else 21
			S.text(ci, S.font("bold"), Vector2(tx, ry + row_h * 0.5 - 2), str(p.name), fs, S.GOLD_HI if hi else S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85)
			S.text(ci, S.font("sans"), Vector2(tx, ry + row_h * 0.5 + 21), str(p.sub), 17, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
			var zi: Texture2D = S.icon("zeus", 40, "#e9c878")
			if zi != null:
				ci.draw_texture_rect(zi, Rect2(r.end.x - 36 - 40, ry + row_h * 0.5 - 20, 40, 40), false, Color(1, 1, 1, 0.85))
			y += row_h

func _draw_bar(ci: CanvasItem) -> void:
	var r := bar_rect()
	var br := Rect2(r.position.x + 30, r.position.y + 52, r.size.x - 60, 26)
	S.text(ci, S.font("title"), Vector2(br.position.x, r.position.y + 36), "LOADING", 22, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9, 3.0)
	var st := stage + ("" if finished else ".".repeat(1 + int(_t * 3.0) % 3))
	S.text(ci, S.font("sans"), Vector2(br.position.x + 150, r.position.y + 35), st, 19, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	S.text(ci, S.font("bold"), Vector2(br.position.x, r.position.y + 35), "%d%%" % int(round(value * 100.0)), 20, S.GOLD_HI, HORIZONTAL_ALIGNMENT_RIGHT, br.size.x, 0.85)
	# the track: a sunken dark groove in a bronze frame
	ci.draw_rect(br.grow(2), S.DARK)
	S.vgrad(ci, br, [[0.0, Color("#02080a")], [1.0, Color("#0b1c21")]])
	var fw := br.size.x * value
	if fw > 1.0:
		var fr := Rect2(br.position, Vector2(fw, br.size.y))
		S.vgrad(ci, fr, [[0.0, Color("#fff0c0")], [0.35, Color("#e9c878")], [0.7, Color("#b38a45")], [1.0, Color("#6e4f22")]])
		# a moving sheen on the fill
		var sx := fmod(_t * 380.0, fw + 240.0) - 120.0
		var sh := Rect2(br.position.x + maxf(0.0, sx), br.position.y, minf(120.0, fw - maxf(0.0, sx)), br.size.y)
		if sh.size.x > 0:
			S.hgrad(ci, sh, [[0.0, Color(1, 1, 1, 0.0)], [0.5, Color(1, 0.97, 0.85, 0.35)], [1.0, Color(1, 1, 1, 0.0)]])
		ci.draw_line(Vector2(fr.end.x, br.position.y), Vector2(fr.end.x, br.end.y), Color("#fff8dc"), 2.0)
	S.inset_shadow(ci, br, 6, 0.7)
	S.metal_border(ci, br.grow(3), 3)
	S.boss(ci, Vector2(br.position.x - 3, br.get_center().y), 6)
	S.boss(ci, Vector2(br.end.x + 3, br.get_center().y), 6)
	if tip != "":
		S.text(ci, S.font("sans"), Vector2(r.position.x, r.end.y - 8), "Tip:  " + tip, 18, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.8)
