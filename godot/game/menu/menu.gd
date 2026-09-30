extends Node
## Main menu (scene "menu", what the game opens with no --scene): Age of
## Mythology: Retold's main menu in our HUD style. The coast town plays live
## behind it (the C++ "coast" setup, no AI, no HUD) under a slow drifting
## camera; over it: the top bar with the logo and tabs, the Skirmish tile,
## Campaign / Multiplayer (unavailable: softer art, a notice when pressed),
## a feature carousel, Quick Match / Options / Quit, a status plate and
## notices.
##
## Loaded as a piece in every scene (main.gd PIECE_ORDER) and does nothing
## unless the scene is "menu".
##
## Args (menu scene only): --menu_hover=<tile> draws that tile hovered and
## focused (captures of the states), --menu_options=1 opens Options,
## --menu_intro=0|1 (default: on when playing, off in captures),
## --menu_view=x,z,distance,pitch,yaw overrides the camera anchor.
##
## Setup screen contract (the match setup piece): Skirmish instances the first
## script of Flow.SETUP_SCREENS that exists. A Control goes under the menu's
## CanvasLayer (laid out in the HUD's 1920x1080 CSS px, full rect, scaled with
## the window like the HUD); anything else is added under this node. Before
## add_child the menu sets `screen.menu = <this node>` when the script has a
## `menu` property, and after it calls `screen.open(<this node>)` if defined.
## The screen starts a match with `menu.start_match(opts)` (= Flow.start_match:
## scene skirmish + opts as main.gd args) and returns to the menu by freeing
## itself (queue_free) or calling `menu.close_screen()`. While it is open the
## menu's own controls are hidden; the live background keeps playing.

const S := preload("res://game/ui/hud_style.gd")
const Tile := preload("res://game/menu/tile.gd")
const Art := preload("res://game/menu/art.gd")
const Flow := preload("res://game/menu/flow.gd")
const Options := preload("res://game/menu/options.gd")
const HeroArt := preload("res://game/menu/hero_art.gd")
const PANEL := preload("res://game/ui/panel.gdshader")
const LOGO := preload("res://game/menu/logo.gdshader")
const SKY := preload("res://game/menu/menu_sky.gdshader")

const VERSION := "Age of Voxel · Godot build"

var game: Node
var active := false
var kb_mode := false       # the last input was keyboard / joypad: show the focus ring
var capturing := false
var t := 0.0
var _scale := 1.0
var _css := Vector2(1920, 1080)
var _layer: CanvasLayer
var _root: Control         # CSS px, scaled
var _ui: Control           # the menu's own controls (hidden under a screen)
var _shade: Control
var _sunglow: Control
var _topbar: ColorRect
var _top: Control
var _logo: Control
var _tiles := {}           # name -> Tile
var _order: Array = []     # intro order
var _toast: Control
var _toast_t := -1.0
var _toast_title := ""
var _toast_text := ""
var _options: Control
var _veil: Control
var _screen: Node = null
var _fade := 1.0           # 1 = black (the intro fades in / start fades out)
var _leaving := false
var _anchor := {}          # camera anchor: x, z, distance, pitch, yaw

## The scene setup: the coast town (C++), as the "coast" scene builds it.
static func scene_setup(g: Node) -> Dictionary:
	var ctx: Dictionary = g.sim.setup_scene("coast", g.scene_opts())
	var m: Node = g.pieces.get("menu")
	if m and m.has_method("_spawn_fleet"):
		m._spawn_fleet()
	return ctx

## The fleet: [screen x, screen y (1920x1080 frame at the anchor), heading]
const FLEET := [Vector3(1180, 880, 0.15), Vector3(1450, 925, -0.35), Vector3(1730, 870, 0.3)]

## A small fleet fishes off the beach, below the temple: each boat
## goes where its screen point's ray meets the sea (the anchor's camera), or
## is pushed out to sea until it floats.
func _spawn_fleet() -> void:
	var sim: Object = game.sim
	var an := _hero_anchor()
	var yr := deg_to_rad(float(an.yaw))
	var pr := deg_to_rad(float(an.pitch))
	var tgt := Vector3(an.x, sim.smooth_height_at(an.x, an.z), an.z)
	var pos := tgt + Vector3(sin(yr) * cos(pr), sin(pr), cos(yr) * cos(pr)) * float(an.distance)
	var fwd := (tgt - pos).normalized()
	var right := Vector3(cos(yr), 0.0, -sin(yr))
	var up := right.cross(fwd)
	var ty := tan(deg_to_rad(17.0))
	var tx := ty * 16.0 / 9.0
	var wl: float = sim.get_water_level()
	for b: Vector3 in FLEET:
		var ray: Vector3 = fwd + right * (b.x / 960.0 - 1.0) * tx + up * (1.0 - b.y / 540.0) * ty
		if ray.y >= -0.01:
			continue
		var p: Vector3 = pos + ray * ((wl - pos.y) / ray.y)
		var out := Vector3(sin(yr), 0.0, cos(yr))   # towards the camera: out to sea
		var n := 0
		while n < 40 and sim.height_at(p.x, p.z) >= wl - 0.5:
			p += out * 0.5
			n += 1
		# each boat gets its own rich shoal where it stands: the boats keep
		# fishing there (they sail to the nearest free shoal) instead of
		# wandering off to the scene's own shoals
		sim.spawn_shoal(p.x, p.z, 1.0e6)
		sim.spawn_boat(1, p.x, p.z, yr + PI * 0.5 + b.z)

func setup(g: Node) -> void:
	game = g
	if str(g.scene_def.get("name", "")) != "menu":
		set_process(false)
		set_process_input(false)
		return
	active = true
	AovScenes.set_setup("menu", scene_setup)
	capturing = g.args.has("out") or AovArgs.flag(g.args, "quit", false)
	g.camera.user_control = false
	g.camera.edge_scroll = false
	if g.args.has("menu_hero"):
		var hc := str(g.args.menu_hero).split(",")
		HERO_YAW = float(hc[0]); HERO_PITCH = float(hc[1]); HERO_DIST = float(hc[2]); HERO_SHIFT = Vector2(float(hc[3]), float(hc[4]))
	_apply_mood()
	_build()
	if not AovArgs.flag(g.args, "menu_intro", not capturing):
		_fade = 0.0
		for tl in _order:
			tl.reveal = 1.0
	else:
		for tl in _order:
			tl.reveal = 0.0
	var hv := str(g.args.get("menu_hover", ""))
	if _tiles.has(hv):
		kb_mode = true
		_tiles[hv].grab_focus()
		_tiles[hv].hover_k = 1.0
	if AovArgs.flag(g.args, "menu_options", false):
		_open_options()
		if _tiles.has("seg:" + hv):
			pass

# ---- build -----------------------------------------------------------------------

func _build() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 20
	add_child(_layer)
	_root = Control.new()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_root)
	# the backdrop: darkening behind the tiles, mist along the bottom; it also
	# eats clicks on the world (no selection behind the menu)
	_shade = Control.new()
	_shade.mouse_filter = Control.MOUSE_FILTER_STOP
	_shade.draw.connect(_draw_shade)
	# the evening sun's light in the air, added over the world (under the
	# shade): a warm bloom from the sun low behind the town on the right
	_sunglow = Control.new()
	_sunglow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var gm := CanvasItemMaterial.new()
	gm.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	_sunglow.material = gm
	_sunglow.draw.connect(_draw_sunglow)
	_root.add_child(_sunglow)
	_root.add_child(_shade)
	_ui = Control.new()
	_ui.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_ui)

	# top bar
	_topbar = _panel_rect(Vector4(0, 16, 16, 0), Vector4(0, 3, 3, 3), [Color("#0d171b"), Color("#081013"), Color("#040709")], 0.97)
	_ui.add_child(_topbar)
	_top = Control.new()
	_top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_top.draw.connect(_draw_top)
	_ui.add_child(_top)
	_logo = Control.new()
	_logo.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lm := ShaderMaterial.new()
	lm.shader = LOGO
	lm.set_shader_parameter("y0", 12.0)
	lm.set_shader_parameter("y1", 58.0)
	_logo.material = lm
	_logo.draw.connect(_draw_logo)
	_ui.add_child(_logo)

	_add("tab_play", "tab", "PLAY", Rect2(506, 12, 118, 72))
	_tiles.tab_play.selected = true
	_add("tab_options", "tab", "OPTIONS", Rect2(632, 12, 190, 72))
	_add("burger", "burger", "", Rect2(0, 22, 56, 52))

	var sk := _add("skirmish", "tile", "SKIRMISH", Rect2(18, 124, 468, 262))
	sk.title_mid = true
	sk.blurb = "Play a single player match\nagainst the AI."
	sk.art = "skirmish"
	var ca := _add("campaign", "tile", "CAMPAIGN", Rect2(26, 404, 296, 250))
	ca.art = "campaign"
	ca.available = false
	var mp := _add("multiplayer", "tile", "MULTIPLAYER", Rect2(352, 404, 296, 250))
	mp.art = "multiplayer"
	mp.available = false
	var fe := _add("feature", "feature", "", Rect2(26, 676, 296, 250))
	fe.pages = [
		{"title": "GREEKS · ZEUS", "text": "Lightning Storm, Bolt and Meteor.", "icon": "zeus",
			"colors": [Color("#6a2230"), Color("#2c0e18"), Color("#0b0508")], "glow": Color(1.0, 0.85, 0.45)},
		{"title": "ATTACK-MOVE", "text": "Press A and click to fight your way.", "icon": "sword",
			"colors": [Color("#274a2a"), Color("#10220f"), Color("#050b05")], "glow": Color(1.0, 0.7, 0.4)},
		{"title": "A VOXEL WORLD", "text": "Every map grows from its own seed.", "icon": "terrain",
			"colors": [Color("#1d4660"), Color("#0b2030"), Color("#040a10")], "glow": Color(0.7, 0.9, 1.0)},
	]
	# the card's art: the army of Zeus rendered live in our own voxel render
	# (hero_art.gd, its own World3D), one framing per page; 2x the card's px
	var hero := HeroArt.new(Vector2i(592, 500))
	hero.still = capturing
	add_child(hero)
	fe.hero = hero
	if game.args.has("menu_page"):
		for _i in int(game.args.menu_page):
			fe.next_page()
	# (no Load: saved games do not exist yet, so the row is Quick Match)
	_add("quick", "bar", "QUICK MATCH", Rect2(352, 676, 296, 68))
	_add("options", "bar", "OPTIONS", Rect2(352, 767, 296, 68))
	var q := _add("quit", "bar", "QUIT", Rect2(352, 858, 296, 68))
	if OS.has_feature("web"):
		q.available = false
	_order = [_tiles.skirmish, _tiles.campaign, _tiles.multiplayer, _tiles.feature, _tiles.quick, _tiles.options, _tiles.quit]
	for n in _tiles:
		_tiles[n].pressed.connect(_on_pressed.bind(n))
	# explicit focus paths for arrows / D-pad (the grid is irregular)
	var nb := {
		"tab_play": {"right": "tab_options", "down": "skirmish"},
		"tab_options": {"left": "tab_play", "right": "burger", "down": "skirmish"},
		"burger": {"left": "tab_options", "down": "skirmish"},
		"skirmish": {"up": "tab_play", "down": "campaign", "right": "multiplayer"},
		"campaign": {"up": "skirmish", "right": "multiplayer", "down": "feature"},
		"multiplayer": {"up": "skirmish", "left": "campaign", "down": "quick"},
		"feature": {"up": "campaign", "right": "quick"},
		"quick": {"up": "multiplayer", "left": "feature", "down": "options"},
		"options": {"up": "quick", "left": "feature", "down": "quit"},
		"quit": {"up": "options", "left": "feature"},
	}
	var props := {"up": "focus_neighbor_top", "down": "focus_neighbor_bottom", "left": "focus_neighbor_left", "right": "focus_neighbor_right"}
	for n in nb:
		var tl: Tile = _tiles[n]
		for side in props:
			# a side without a path keeps the focus where it is
			var other: Tile = _tiles[nb[n][side]] if nb[n].has(side) else tl
			tl.set(props[side], tl.get_path_to(other))

	_toast = Control.new()
	_toast.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_toast.draw.connect(_draw_toast)
	_ui.add_child(_toast)

	_options = Options.new()
	_options.menu = self
	_options.visible = false
	_root.add_child(_options)
	_options.build()
	_options.closed.connect(func() -> void:
		if _tiles.has("options"):
			_tiles.options.grab_focus())
	# the fade (intro / leaving) over everything
	_veil = Control.new()
	_veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_veil.draw.connect(func() -> void:
		if _fade > 0.0:
			_veil.draw_rect(Rect2(Vector2.ZERO, _css), Color(0, 0, 0, clampf(_fade, 0.0, 1.0))))
	_root.add_child(_veil)
	_layout()
	get_viewport().size_changed.connect(_layout)

func _panel_rect(chamfer: Vector4, border: Vector4, cols: Array, a: float) -> ColorRect:
	var cr := ColorRect.new()
	cr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var m := ShaderMaterial.new()
	m.shader = PANEL
	m.set_shader_parameter("margin", 18.0)
	m.set_shader_parameter("chamfer", chamfer)
	m.set_shader_parameter("border", border)
	m.set_shader_parameter("bg_mode", 0)
	for i in 3:
		var c: Color = cols[i]
		c.a = a
		m.set_shader_parameter("bg%d" % i, c)
	m.set_shader_parameter("grain", 0.8)
	m.set_shader_parameter("shadow_alpha", 0.6)
	m.set_shader_parameter("shadow_blur", 20.0)
	cr.material = m
	return cr

func _set_panel_rect(cr: ColorRect, r: Rect2) -> void:
	cr.position = r.position - Vector2(18, 18)
	cr.size = r.size + Vector2(36, 36)
	(cr.material as ShaderMaterial).set_shader_parameter("size", r.size)

func _add(n: String, style: String, title: String, r: Rect2) -> Tile:
	var tl := Tile.new()
	tl.name = n
	tl.style = style
	tl.title = title
	tl.menu = self
	tl.position = r.position
	tl.size = r.size
	_ui.add_child(tl)
	_tiles[n] = tl
	return tl

func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	_scale = clampf(vs.y / 1080.0, 0.5, 3.0)
	_layer.transform = Transform2D().scaled(Vector2(_scale, _scale))
	_css = vs / _scale
	for c in [_root, _sunglow, _shade, _ui, _top, _logo, _options, _toast, _veil]:
		c.position = Vector2.ZERO
		c.size = _css
	_set_panel_rect(_topbar, Rect2(22, -4, _css.x - 44, 100))
	_tiles.burger.position = Vector2(_css.x - 100, 22)
	_top.queue_redraw()
	_shade.queue_redraw()

# ---- actions ---------------------------------------------------------------------

func _on_pressed(n: String) -> void:
	if _leaving:
		return
	match n:
		"skirmish":
			_open_skirmish()
		"campaign":
			notice("Campaign", "The Greek campaign is still being carved.\nTry a Skirmish against the AI meanwhile.")
		"multiplayer":
			notice("Multiplayer", "Multiplayer is not available in this version.")
		"quick":
			# a default skirmish at once: Greeks against one AI on the default map
			start_match({})
		"options", "tab_options", "burger":
			_open_options()
		"tab_play":
			pass
		"feature":
			_tiles.feature.next_page()
		"quit":
			if OS.has_feature("web"):
				notice("Quit", "Close the browser tab to leave the game.")
			else:
				get_tree().quit()

func _open_options() -> void:
	_options.open()

func _open_skirmish() -> void:
	var path := Flow.setup_screen_path()
	if path == "":
		start_match({})
		return
	var scr: Object = load(path).new()
	if "menu" in scr:
		scr.set("menu", self)
	_screen = scr
	if scr is Control:
		var c := scr as Control
		c.position = Vector2.ZERO
		c.size = _css
		_root.add_child(c)
	else:
		add_child(scr)
	_ui.visible = false
	scr.tree_exited.connect(_on_screen_closed.bind(scr))
	if scr.has_method("open"):
		scr.open(self)

func close_screen() -> void:
	if _screen and is_instance_valid(_screen):
		_screen.queue_free()

func _on_screen_closed(scr: Node) -> void:
	if _screen != scr or not is_inside_tree():
		return
	_screen = null
	_ui.visible = true
	_tiles.skirmish.grab_focus()

## Start a match (a fade to black, then main.tscn reloads with the args).
func start_match(opts: Dictionary) -> void:
	if _leaving:
		return
	_leaving = true
	var tw := create_tween()
	tw.tween_property(self, "_fade", 1.0, 0.35)
	tw.tween_callback(func() -> void: Flow.start_match(get_tree(), opts))

## A notice at the bottom right (Retold's notification toast).
func notice(title: String, text: String) -> void:
	_toast_title = title
	_toast_text = text
	_toast_t = 0.0

# ---- input -----------------------------------------------------------------------

const NAV := ["ui_up", "ui_down", "ui_left", "ui_right", "ui_accept", "ui_focus_next", "ui_focus_prev"]

func _input(e: InputEvent) -> void:
	if not active:
		return
	if e is InputEventMouseMotion and (e as InputEventMouseMotion).relative.length() > 2.0:
		kb_mode = false
		return
	if e is InputEventKey or e is InputEventJoypadButton or e is InputEventJoypadMotion:
		var nav := false
		for a in NAV:
			if e.is_action_pressed(a):
				nav = true
		if nav:
			kb_mode = true
			if get_viewport().gui_get_focus_owner() == null and _ui.visible:
				_tiles.skirmish.grab_focus()
				get_viewport().set_input_as_handled()
		if e.is_action_pressed("ui_cancel"):
			if _options.visible:
				_options.close()
				get_viewport().set_input_as_handled()

# ---- per frame -------------------------------------------------------------------

func frame(dt: float, _alpha: float) -> void:
	if not active:
		return
	t += dt
	_drive_camera()
	_mood_frame()
	# intro: fade in from black, tiles slide in one after another
	if not _leaving:
		_fade = move_toward(_fade, 0.0, dt * 1.4)
	for i in _order.size():
		var k := clampf((t - 0.35 - i * 0.07) / 0.45, 0.0, 1.0)
		_order[i].reveal = maxf(_order[i].reveal, 1.0 - pow(1.0 - k, 3.0))
	# the feature carousel turns every 7 s unless the pointer rests on it
	if not capturing and fmod(t, 7.0) < dt and t > 1.0 and not _tiles.feature.highlighted():
		_tiles.feature.next_page()
	if _toast_t >= 0.0:
		_toast_t += dt
		if _toast_t > 4.5:
			_toast_t = -1.0
	_top.queue_redraw()
	_toast.queue_redraw()
	_shade.queue_redraw()
	_veil.queue_redraw()
	# the logo's light sweep every 9 s
	var ph := fmod(t + 6.0, 9.0)
	(_logo.material as ShaderMaterial).set_shader_parameter("shine_x", -200.0 + ph * 260.0)
	_logo.queue_redraw()

## The hero shot: a low three-quarter view from the sea, the temple on the
## right-third line (it stands out against the evening haze), the harbour and
## its fishing boats in the foreground; the camera breathes and sways slowly
## round that anchor.
func _drive_camera() -> void:
	var cam: AovCameraRig = game.camera
	if _anchor.is_empty():
		_anchor = _hero_anchor()
		if game.args.has("menu_view"):
			var c := str(game.args.menu_view).split(",")
			var keys := ["x", "z", "distance", "pitch", "yaw"]
			for i in mini(c.size(), 5):
				_anchor[keys[i]] = float(c[i])
	var s := t
	var yaw: float = _anchor.yaw + 3.0 * sin(s * TAU / 90.0)
	var dist: float = _anchor.distance + 2.0 * sin(s * TAU / 53.0)
	var pitch: float = _anchor.pitch + 1.0 * sin(s * TAU / 61.0)
	var y := deg_to_rad(yaw)
	# drift along the view's right axis
	var side := 1.5 * sin(s * TAU / 97.0)
	var x: float = _anchor.x + cos(y) * side
	var z: float = _anchor.z - sin(y) * side
	cam.set_view({"x": x, "z": z, "distance": dist, "pitch": pitch, "yaw": yaw})

## Where the temple stands (world x, z), or the scene focus without one.
func _hero_pos() -> Vector2:
	var f: Vector2 = game.ctx.get("focus", Vector2(64, 64))
	var b: Dictionary = game.sim.get_buildings()
	var names: PackedStringArray = b.get("type_names", PackedStringArray())
	var ti := names.find("temple")
	var types: PackedByteArray = b.get("type", PackedByteArray())
	var rect: PackedInt32Array = b.get("rect", PackedInt32Array())
	for i in types.size():
		if int(types[i]) == ti:
			return Vector2(rect[i * 4] + rect[i * 4 + 2] * 0.5, rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5)
	return f

## The camera anchor for the hero shot: the view looks past the temple so
## it sits right of the frame centre (the menu column fills the left).
func _hero_anchor() -> Dictionary:
	var h := _hero_pos()
	var yaw := HERO_YAW
	var yr := deg_to_rad(yaw)
	var right := Vector2(cos(yr), -sin(yr))     # the view's right axis (x, z)
	var fwd := Vector2(-sin(yr), -cos(yr))      # into the screen
	var p := h - right * HERO_SHIFT.x + fwd * HERO_SHIFT.y
	return {"x": p.x, "z": p.y, "distance": HERO_DIST, "pitch": HERO_PITCH, "yaw": yaw}

var HERO_YAW := 82.0
var HERO_PITCH := 9.0
var HERO_DIST := 66.0
var HERO_SHIFT := Vector2(7.0, -4.0)   # temple -> view target: left, forward

# ---- the mood: a warm, low evening sun and haze (menu scene only) --------------

var _light: Node = null

## Evening light for the hero shot, set on the lighting piece's nodes (the
## menu scene only; the lighting piece stays the owner, nothing else changes):
## a low warm key from the right, a warm sky gradient with the sun's glow
## sitting behind the town, deep golden haze that swallows the map edge, a
## warm top haze and a vignette in the grade.
func _apply_mood() -> void:
	_light = game.pieces.get("lighting")
	if _light == null or not ("sun" in _light) or _light.sun == null:
		return
	var yr := deg_to_rad(HERO_YAW)
	var right := Vector3(cos(yr), 0.0, -sin(yr))
	var fwd := Vector3(-sin(yr), 0.0, -cos(yr))
	var to_sun := (right * 0.85 + fwd * 0.55).normalized()
	to_sun.y = 0.36
	to_sun = to_sun.normalized()
	var sun: DirectionalLight3D = _light.sun
	sun.light_color = Color(1.0, 0.68, 0.4)
	sun.light_energy = 7.6 / PI
	sun.basis = Basis.looking_at(-to_sun, Vector3.UP)
	sun.shadow_opacity = 0.86
	var fill: DirectionalLight3D = _light.fill
	if fill:
		fill.light_color = Color(0.55, 0.66, 0.9)
		fill.light_energy = 0.5 / PI
		var fd := (-right * 0.8 - fwd * 0.2).normalized()
		fd.y = 0.45
		fill.basis = Basis.looking_at(-fd.normalized(), Vector3.UP)
	# the sky: the glow of the setting sun low behind the temple, off the key's
	# real direction on purpose (the frame wants the glow, the town the side light)
	var sky_sun := (fwd * 0.96 + right * 0.26).normalized()
	sky_sun.y = 0.07
	var env: Environment = _light.env
	var sm := ShaderMaterial.new()
	sm.shader = SKY
	sm.set_shader_parameter("sun_dir", sky_sun.normalized())
	sm.set_shader_parameter("horizon_color", MOOD_HAZE)
	if env.sky:
		env.sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.fog_light_color = MOOD_HAZE
	env.fog_density = 1.0
	env.fog_sun_scatter = 0.0
	env.fog_depth_curve = 1.6
	env.ambient_light_color = Color(0.6, 0.6, 0.7)
	env.ambient_light_energy *= 0.8
	for h in _light.get("hemi_lights"):
		(h as DirectionalLight3D).light_energy *= 0.75
	var gr = _light.get("grade")
	if gr:
		gr.top_haze = 0.12
		gr.top_haze_color = Vector3(MOOD_HAZE.r, MOOD_HAZE.g, MOOD_HAZE.b)
		gr.vignette = 0.7
		gr.saturation = 0.86
	_mood_frame()

const MOOD_HAZE := Color(0.93, 0.79, 0.62)      # golden evening air
const MOOD_SKY_TOP := Color(0.36, 0.5, 0.7)

## Per frame after the lighting piece: the haze begins just past the temple
## and hides the map's far edge (lighting.frame() resets it from the distance).
func _mood_frame() -> void:
	# the shoals' leaping fish read as specks at this distance: the boats
	# fish, but the fish themselves are not drawn behind the menu
	var ep = game.pieces.get("economy")
	if ep and ep.has_node("Econ_fish"):
		(ep.get_node("Econ_fish") as Node3D).visible = false
	if _light == null or not ("env" in _light) or _light.env == null:
		return
	var d: float = game.camera.distance
	_light.env.fog_depth_begin = d * 1.05
	_light.env.fog_depth_end = d * 3.4
	_light.sun.directional_shadow_max_distance = d * 3.0

# ---- drawing ---------------------------------------------------------------------

func _draw_shade() -> void:
	var w := _css.x
	var h := _css.y
	# the menu column sits on shadow: a deep gradient from the left edge that
	# is gone by the middle of the frame, darker still at the bottom left
	S.hgrad(_shade, Rect2(0, 0, 1000, h), [[0.0, Color(0.01, 0.03, 0.04, 0.82)], [0.45, Color(0.01, 0.03, 0.04, 0.62)], [0.7, Color(0.01, 0.03, 0.04, 0.22)], [1.0, Color(0.01, 0.03, 0.04, 0.0)]])
	# a light sea mist rolling in along the bottom
	S.vgrad(_shade, Rect2(0, h * 0.84, w, h * 0.16), [[0.0, Color(0.95, 0.88, 0.8, 0.0)], [1.0, Color(0.95, 0.86, 0.76, 0.14)]])
	S.vgrad(_shade, Rect2(0, 0, w, 220), [[0.0, Color(0, 0, 0, 0.35)], [1.0, Color(0, 0, 0, 0.0)]])

static var _sun_tex: Texture2D

func _draw_sunglow() -> void:
	if _sun_tex == null:
		_sun_tex = S.radial_tex([[0.0, Color(1.0, 0.8, 0.52, 0.34)], [0.25, Color(1.0, 0.7, 0.42, 0.16)], [0.6, Color(0.9, 0.55, 0.3, 0.05)], [1.0, Color(0.9, 0.5, 0.3, 0.0)]], Vector2(0.5, 0.5), 0.5, 256)
	var w := _css.x
	var c := Vector2(w - 470.0, 150.0)
	var sz := Vector2(1900, 1300)
	_sunglow.draw_texture_rect(_sun_tex, Rect2(c - sz * 0.5, sz), false)

func _draw_logo() -> void:
	var x := 70.0
	var base := 58.0
	var parts := [["A", 60, "black"], ["GE", 46, "black"], [" ", 18, "black"], ["OF", 21, "black"], [" ", 18, "black"], ["V", 60, "black"], ["OXEL", 46, "black"]]
	var bx := x
	for p in parts:
		var f := S.font(p[2])
		var sz: int = p[1]
		var yy := base if p[0] != "OF" else base - 17.0
		_logo.draw_string_outline(f, Vector2(bx, yy + 2), p[0], HORIZONTAL_ALIGNMENT_LEFT, -1, sz, 6, Color(0, 0, 0, 0.55))
		_logo.draw_string_outline(f, Vector2(bx, yy), p[0], HORIZONTAL_ALIGNMENT_LEFT, -1, sz, 3, Color("#2a1c08"))
		_logo.draw_string(f, Vector2(bx, yy), p[0], HORIZONTAL_ALIGNMENT_LEFT, -1, sz, Color.WHITE)
		bx += f.get_string_size(p[0], HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x + 1.0
	# the tagline between two scrolled rules
	var w := bx - x
	var rule := Art.texture("logo_rule", Vector2i(int(w), int(w * 24.0 / 400.0)))
	var cy := base + 16.0
	if rule:
		_logo.draw_texture_rect(rule, Rect2(Vector2(x, cy - rule.get_height() * 0.5), rule.get_size()), false, Color(0.85, 0.7, 0.4, 0.9))
	var tf := S.font("title7")
	var tag := "OLYMPUS"
	var tw := S.text_width(tf, tag, 12, 7.0)
	var tx := x + w * 0.5 - tw * 0.5
	_logo.draw_rect(Rect2(tx - 14, cy - 9, tw + 28, 18), Color("#081013"))
	S.text(_logo, tf, Vector2(tx, cy + 4.5), tag, 12, Color("#d9b870"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.0, 7.0)

func _draw_top() -> void:
	var w := _css.x
	# scrolled bronze corners at the bottom of the bar
	for sx in [1.0, -1.0]:
		var c := Vector2(22.0 + 16.0 if sx > 0 else w - 38.0, 92.0)
		_top.draw_arc(c + Vector2(sx * 6, -12), 7.0, 0, TAU, 16, Color(S.BRONZE_HI, 0.9), 1.4, true)
		_top.draw_arc(c + Vector2(sx * 6, -12), 3.0, 0, TAU, 12, Color(S.BRONZE_HI, 0.9), 1.2, true)
		S.boss(_top, c + Vector2(sx * 6, -12), 1.8)
	# player plate: the god's medallion, the name and the connection state
	var r := Rect2(w - 430, 24, 300, 48)
	_top.draw_rect(r.grow(1), Color(0, 0, 0, 0.7))
	S.vgrad(_top, r, [[0.0, Color("#0e1c21")], [1.0, Color("#060d10")]])
	_top.draw_rect(r, Color(S.BRONZE_HI, 0.85), false, 1.2)
	_top.draw_rect(r.grow(-3), Color(S.BRONZE_DK, 0.9), false, 1.0)
	var zi := S.icon("zeus", 34, "#e9c878")
	if zi:
		_top.draw_texture_rect(zi, Rect2(r.position + Vector2(10, 7), Vector2(34, 34)), false)
	S.text(_top, S.font("bold"), Vector2(r.position.x + 56, r.position.y + 22), "Player", 19, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	S.text(_top, S.font("sans"), Vector2(r.position.x + 56, r.position.y + 40), "Greeks · Zeus", 14, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	# offline pip
	var pc := Vector2(r.end.x - 20, r.get_center().y)
	_top.draw_circle(pc, 5.0, Color(0, 0, 0, 0.7), true, -1.0, true)
	_top.draw_circle(pc, 3.6, Color("#8a8f86"), true, -1.0, true)
	S.text(_top, S.font("title7"), Vector2(pc.x - 118, pc.y + 5), "OFFLINE", 12, S.MUTED, HORIZONTAL_ALIGNMENT_RIGHT, 104, 0.8, 1.5)
	# status plate (Retold's chat bar: offline here)
	var h := _css.y
	var sr := Rect2(26, h - 56, 490, 38)
	_top.draw_rect(sr.grow(1), Color(0, 0, 0, 0.6))
	S.vgrad(_top, sr, [[0.0, Color(0.05, 0.1, 0.12, 0.88)], [1.0, Color(0.02, 0.05, 0.06, 0.88)]])
	_top.draw_rect(sr, Color(S.BRONZE, 0.6), false, 1.0)
	_draw_bubble(Vector2(sr.position.x + 22, sr.get_center().y))
	S.text(_top, S.font("sans"), Vector2(sr.position.x + 46, sr.position.y + 25), "Offline  ·  Single player", 18, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	S.text(_top, S.font("sans"), Vector2(w - 400, h - 26), VERSION, 15, Color(S.INK, 0.85), HORIZONTAL_ALIGNMENT_RIGHT, 370, 0.9)

func _draw_bubble(c: Vector2) -> void:
	var r := Rect2(c - Vector2(10, 8), Vector2(20, 13))
	_top.draw_rect(r, Color(S.MUTED, 0.9))
	_top.draw_colored_polygon(PackedVector2Array([Vector2(c.x - 6, r.end.y), Vector2(c.x - 1, r.end.y), Vector2(c.x - 7, r.end.y + 5)]), Color(S.MUTED, 0.9))
	for i in 3:
		_top.draw_circle(Vector2(c.x - 5 + i * 5, c.y - 1.5), 1.4, Color("#0b1417"))

func _draw_toast() -> void:
	if _toast_t < 0.0:
		return
	var a := clampf(_toast_t / 0.2, 0.0, 1.0) * clampf((4.5 - _toast_t) / 0.5, 0.0, 1.0)
	var lines := _toast_text.split("\n")
	var w := 440.0
	var hh := 74.0 + lines.size() * 24.0
	var slide := (1.0 - clampf(_toast_t / 0.25, 0.0, 1.0)) * 30.0
	var r := Rect2(_css.x - w - 26 + slide, _css.y - hh - 150, w, hh)
	_toast.modulate.a = a
	S.drop_shadow(_toast, r, 6, 18, 0.5)
	_toast.draw_rect(r.grow(1), Color(0, 0, 0, 0.8))
	S.vgrad(_toast, r, [[0.0, Color("#0f2027")], [1.0, Color("#071115")]])
	S.metal_border(_toast, r, 2.0)
	S.text(_toast, S.font("bold"), Vector2(r.position.x + 18, r.position.y + 32), _toast_title, 21, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	S.hgrad(_toast, Rect2(r.position.x + 16, r.position.y + 44, w - 70, 1.3), [[0.0, Color(S.INK, 0.7)], [1.0, Color(S.INK, 0.0)]])
	# the close box
	var xb := Rect2(r.end.x - 36, r.position.y + 14, 22, 22)
	_toast.draw_rect(xb, S.GOLD)
	_toast.draw_line(xb.position + Vector2(6, 6), xb.end - Vector2(6, 6), Color("#1a1206"), 2.4, true)
	_toast.draw_line(Vector2(xb.end.x - 6, xb.position.y + 6), Vector2(xb.position.x + 6, xb.end.y - 6), Color("#1a1206"), 2.4, true)
	var y := r.position.y + 74.0
	for line in lines:
		S.text(_toast, S.font("sans"), Vector2(r.position.x + 20, y), line, 18, Color(S.INK, 0.92), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
		y += 24.0
