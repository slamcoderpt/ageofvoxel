extends Button
## One main-menu control, drawn in the HUD style (game/ui/hud_style.gd):
## a dark lacquered card in a cast-bronze frame (game/ui/panel.gdshader) with
## engraved gold line art (game/menu/art.gd) and a Cinzel title, like the
## tiles of Age of Mythology: Retold's main menu.
##
## Styles: "tile" (a big card, title at the bottom, or mid-left with a blurb
## when `title_mid`), "bar" (a row button: Load / Options / Quit), "feature"
## (the carousel card: `pages`), "tab" (top-bar text tab), "burger" (the
## top-bar menu icon), "seg" (an option choice, `selected`).
##
## States: hover (eased `hover_k`), pressed (draw mode), keyboard / joypad
## focus (a pulsing gold ring, only while the menu is in keyboard mode:
## `menu.kb_mode`), unavailable (`available = false`: softer art, a muted
## title, no label; on hover a quiet "Not available in this version." line;
## still focusable and pressable, the menu answers with a notice).

const S := preload("res://game/ui/hud_style.gd")
const Art := preload("res://game/menu/art.gd")
const PANEL := preload("res://game/ui/panel.gdshader")
const MARGIN := 18.0
## Tiles whose engraving fills the card edge to edge, under the label.
const FULL_BLEED := ["campaign", "multiplayer"]

var style := "tile"
var title := ""
var blurb := ""
var art := ""
var title_mid := false
var available := true
var selected := false         # "seg" / "tab": the current choice
var pages: Array = []         # "feature": [{title, text, icon, colors: [c0, c1, c2]}]
var page := 0
var hero: SubViewport = null  # "feature": the rendered hero art (hero_art.gd), one framing per page
var menu: Node = null         # the menu piece (kb_mode, time)

var hover_k := 0.0
var reveal := 1.0             # intro: 0 hidden .. 1 in place
var _page_k := 1.0
var _panel: ColorRect
var _face: Control
var _last_bg := Color(0, 0, 0, 0)

class Face extends Control:
	var tile: Node
	func _draw() -> void:
		tile.draw_face(self)

func _init() -> void:
	flat = true
	text = ""
	focus_mode = Control.FOCUS_ALL
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for st in ["normal", "hover", "pressed", "disabled", "focus", "hover_pressed", "normal_mirrored", "hover_mirrored", "pressed_mirrored", "hover_pressed_mirrored"]:
		add_theme_stylebox_override(st, StyleBoxEmpty.new())
	mouse_entered.connect(func() -> void:
		if not has_focus():
			grab_focus())

func _ready() -> void:
	if style in ["tile", "bar", "feature", "seg"]:
		_panel = ColorRect.new()
		_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var m := ShaderMaterial.new()
		m.shader = PANEL
		_panel.material = m
		add_child(_panel)
		m.set_shader_parameter("margin", MARGIN)
		var ch := 9.0 if style != "seg" else 5.0
		m.set_shader_parameter("chamfer", Vector4(ch, ch, ch, ch))
		m.set_shader_parameter("border", Vector4(2.5, 2.5, 2.5, 2.5) if style != "seg" else Vector4(1.5, 1.5, 1.5, 1.5))
		m.set_shader_parameter("bg_mode", 1)
		m.set_shader_parameter("radial_center", Vector2(0.25, 0.0))
		m.set_shader_parameter("radial_radius", Vector2(1.4, 1.2))
		m.set_shader_parameter("bg_mid", 0.5)
		m.set_shader_parameter("frame_glow", 26.0 if style != "seg" else 10.0)
		m.set_shader_parameter("grain", 0.7)
		m.set_shader_parameter("shadow_offset", Vector2(0, 5))
		m.set_shader_parameter("shadow_blur", 16.0)
		m.set_shader_parameter("shadow_alpha", 0.55)
		m.set_shader_parameter("chamfer_rim", 1.5)
	_face = Face.new()
	_face.tile = self
	_face.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_face)
	resized.connect(_fit)
	_fit()

func _fit() -> void:
	if _panel:
		_panel.position = Vector2(-MARGIN, -MARGIN)
		_panel.size = size + Vector2(MARGIN, MARGIN) * 2.0
		(_panel.material as ShaderMaterial).set_shader_parameter("size", size)
	_face.position = Vector2.ZERO
	_face.size = size

func highlighted() -> bool:
	return is_hovered() or (has_focus() and menu != null and menu.kb_mode)

func _process(dt: float) -> void:
	var goal := 1.0 if highlighted() else 0.0
	hover_k = move_toward(hover_k, goal, dt * 6.0)
	_page_k = move_toward(_page_k, 1.0, dt * 2.5)
	var off := Vector2(-28.0 * pow(1.0 - reveal, 2.0), 0)
	if _panel:
		_panel.position = Vector2(-MARGIN, -MARGIN) + off
		_update_bg()
	_face.position = off
	modulate.a = reveal
	_face.queue_redraw()

func _update_bg() -> void:
	var c0 := Color("#10232a")
	var c1 := Color("#0a161a")
	var c2 := Color("#04090b")
	if style == "feature" and not pages.is_empty():
		var cs: Array = pages[page].colors
		c0 = cs[0]; c1 = cs[1]; c2 = cs[2]
	elif style == "seg" and selected:
		c0 = Color("#2a5a66"); c1 = Color("#143640"); c2 = Color("#0a1d23")
	var k := hover_k * (1.0 if available else 0.45)
	c0 = c0.lerp(Color("#24505c") if style != "feature" else c0.lightened(0.25), k * 0.75)
	c1 = c1.lerp(Color("#11303a") if style != "feature" else c1.lightened(0.15), k * 0.6)
	var a := 0.95 if style != "seg" else 0.9
	if style == "feature":
		a = 1.0
	c0.a = a; c1.a = a; c2.a = a
	if c0 == _last_bg:
		return
	_last_bg = c0
	var m := _panel.material as ShaderMaterial
	m.set_shader_parameter("bg0", c0)
	m.set_shader_parameter("bg1", c1)
	m.set_shader_parameter("bg2", c2)

func next_page() -> void:
	if pages.size() > 1:
		page = (page + 1) % pages.size()
		_page_k = 0.0
		if hero:
			hero.set_page(page)

# ---- drawing -------------------------------------------------------------------

static var _glow_tex: Texture2D
static var _art_glow_tex: Texture2D

func _glow() -> Texture2D:
	if _glow_tex == null:
		_glow_tex = S.radial_tex([[0.0, Color(1, 0.86, 0.55, 0.22)], [0.55, Color(1, 0.8, 0.45, 0.07)], [1.0, Color(1, 0.8, 0.45, 0.0)]], Vector2(0.5, 0.5), 0.5, 128)
	return _glow_tex

func draw_face(ci: Control) -> void:
	var r := Rect2(Vector2.ZERO, size)
	var down := get_draw_mode() == DRAW_PRESSED or get_draw_mode() == DRAW_HOVER_PRESSED
	var hk := hover_k
	var focus_ring: bool = has_focus() and menu != null and menu.kb_mode
	match style:
		"tab": _draw_tab(ci, r, hk, down, focus_ring); return
		"burger": _draw_burger(ci, r, hk, down, focus_ring); return
	var o := Vector2(0, 1) if down else Vector2.ZERO
	# engraved art: full bleed (Campaign / Multiplayer), or a vignette
	if art in FULL_BLEED:
		_draw_full_bleed(ci, r, hk, o)
	elif art != "":
		var ar := _art_rect(r)
		var tex := Art.texture(art, Vector2i(ar.size))
		if tex:
			var a := (0.46 + 0.4 * hk) if available else (0.3 + 0.1 * hk)
			var dst := Rect2(ar.position + (ar.size - Vector2(tex.get_size())) * 0.5 + o, tex.get_size())
			ci.draw_texture_rect(tex, dst, false, Color(1, 1, 1, a))
	if style == "feature":
		_draw_feature(ci, r, hk, o)
	# hover light: a warm bloom from the upper left and a bright inner frame
	if hk > 0.0 and style != "seg":
		ci.draw_texture_rect(_glow(), Rect2(r.position - r.size * 0.25, r.size * 1.1), false, Color(1, 1, 1, hk * (1.0 if available else 0.4)))
	if hk > 0.0:
		ci.draw_rect(r.grow(-3.5), Color(S.GOLD_HI, 0.5 * hk * (1.0 if available else 0.5)), false, 1.2)
	_draw_corners(ci, r, hk)
	# title
	var col := S.INK.lerp(S.GOLD_HI, hk) if available else Color(0.74, 0.76, 0.72).lerp(Color(0.86, 0.84, 0.76), hk)
	var f := S.font("title")
	match style:
		"tile":
			var ty := r.size.y * 0.42 if title_mid else r.size.y - 34.0
			S.text(ci, f, Vector2(22, ty) + o, title, 24, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9, 0.8)
			var ly := ty + 11.0
			var la := 0.55 + 0.4 * hk if available else 0.3
			S.hgrad(ci, Rect2(20, ly, r.size.x - 44, 1.4), [[0.0, Color(S.INK, la)], [0.75, Color(S.INK, la * 0.7)], [1.0, Color(S.INK, 0.0)]])
			if blurb != "":
				var by := ly + 34.0
				for line in blurb.split("\n"):
					S.text(ci, S.font("sans"), Vector2(24, by) + o, line, 20, Color(S.INK, 0.92), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
					by += 25.0
			if not available:
				if hk > 0.05 and blurb == "":
					S.text(ci, S.font("sans"), Vector2(22, ty - 36), "Not available in this version.", 17, Color(S.MUTED, hk), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
		"bar":
			S.text(ci, f, Vector2(36, r.size.y * 0.5 + 8) + o, title, 22, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9, 0.8)
		"seg":
			var sc := S.GOLD if selected else col
			S.text(ci, f, Vector2(0, r.size.y * 0.5 + 6) + o, title, 16, sc, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.9, 0.6)
			if selected:
				ci.draw_rect(r.grow(-2.5), Color(S.GOLD, 0.8), false, 1.5)
	if down:
		ci.draw_rect(r.grow(-2), Color(0, 0, 0, 0.2))
	if focus_ring:
		var p := 0.5 + 0.5 * sin(Time.get_ticks_msec() / 1000.0 * 4.0)
		ci.draw_rect(r.grow(4.0 + p), Color(S.GOLD_HI, 0.55 + 0.35 * p), false, 2.0)
		ci.draw_rect(r.grow(7.0 + p), Color(S.GOLD, 0.18), false, 3.0)

## The card's face inside the bronze frame (its chamfered corners), inset i.
func _inner_poly(r: Rect2, i: float) -> PackedVector2Array:
	var ch := 8.0
	var w := r.size.x
	var h := r.size.y
	return PackedVector2Array([Vector2(i + ch, i), Vector2(w - i - ch, i), Vector2(w - i, i + ch), Vector2(w - i, h - i - ch),
		Vector2(w - i - ch, h - i), Vector2(i + ch, h - i), Vector2(i, h - i - ch), Vector2(i, i + ch)])

## Campaign / Multiplayer: the engraving fills the card edge to edge, over a
## soft gold glow behind its figure, with a dark gradient rising under the label.
func _draw_full_bleed(ci: Control, r: Rect2, hk: float, o: Vector2) -> void:
	var w := r.size.x
	var h := r.size.y
	# the glow behind the figure (right of centre, where the head is)
	var gc := Vector2(w * 0.62, h * 0.38)
	var gs := Vector2(h, h) * (1.25 + 0.1 * hk)
	if _art_glow_tex == null:
		_art_glow_tex = S.radial_tex([[0.0, Color(1, 0.8, 0.48, 0.3)], [0.45, Color(1, 0.76, 0.42, 0.12)], [1.0, Color(1, 0.76, 0.42, 0.0)]], Vector2(0.5, 0.5), 0.5, 128)
	ci.draw_texture_rect(_art_glow_tex, Rect2(gc - gs * 0.5, gs), false, Color(1, 1, 1, 0.85 + 0.15 * hk))
	var tex := Art.texture(art, Vector2i(r.size))
	if tex:
		var pts := _inner_poly(r, 3.0)
		var uvs := PackedVector2Array()
		var off := PackedVector2Array()
		for p in pts:
			uvs.append(p / r.size)
			off.append(p + o)
		var a := (0.5 + 0.2 * hk) if available else (0.48 + 0.16 * hk)
		ci.draw_polygon(off, PackedColorArray([Color(1, 1, 1, a)]), uvs, tex)
	# the label's shadow, rising from the bottom edge
	S.vgrad(ci, Rect2(3, h * 0.5, w - 6, h * 0.5 - 3), [[0.0, Color(0.01, 0.03, 0.04, 0.0)], [0.55, Color(0.01, 0.03, 0.04, 0.6)], [1.0, Color(0.01, 0.03, 0.04, 0.88)]])

func _art_rect(r: Rect2) -> Rect2:
	if art == "skirmish":
		return Rect2(4, 4, r.size.x - 8, r.size.y - 8)
	return Rect2(r.size.x * 0.04, 8, r.size.x * 0.92, r.size.y - 88)

## Retold's frames end in small cast scrolls at the corners.
func _draw_corners(ci: Control, r: Rect2, hk: float) -> void:
	if style == "seg":
		return
	var col := Color(S.BRONZE_HI, 0.75 + 0.25 * hk)
	var dk := Color(0, 0, 0, 0.6)
	var L := 16.0 if style != "bar" else 11.0
	for c in [Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 1)]:
		var sx := 1.0 if c.x == 0 else -1.0
		var sy := 1.0 if c.y == 0 else -1.0
		var p := Vector2(r.position.x + r.size.x * c.x + sx * 6.0, r.position.y + r.size.y * c.y + sy * 6.0)
		for pass_ in 2:
			var cc := dk if pass_ == 0 else col
			var d := Vector2(0, 1) if pass_ == 0 else Vector2.ZERO
			ci.draw_line(p + d + Vector2(sx * 5, 0), p + d + Vector2(sx * L, 0), cc, 1.2, true)
			ci.draw_line(p + d + Vector2(0, sy * 5), p + d + Vector2(0, sy * L), cc, 1.2, true)
			ci.draw_arc(p + d + Vector2(sx * (L + 2.5), sy * 2.5), 2.5, 0, TAU, 12, cc, 1.0, true)
			ci.draw_arc(p + d + Vector2(sx * 2.5, sy * (L + 2.5)), 2.5, 0, TAU, 12, cc, 1.0, true)
		S.boss(ci, p + Vector2(sx, sy) * 1.5, 2.6)

func _draw_feature(ci: Control, r: Rect2, hk: float, o: Vector2) -> void:
	if pages.is_empty():
		return
	var pg: Dictionary = pages[page]
	var a := _page_k
	if hero:
		# the hero art, edge to edge inside the bronze frame (its chamfered
		# corners), fading up from black when the page turns
		hero.hover = hk
		var i := 3.0
		var w := r.size.x
		var h := r.size.y
		var pts := _inner_poly(r, i)
		var uvs := PackedVector2Array()
		for p in pts:
			uvs.append(p / r.size)
		var k := 0.25 + 0.75 * a
		ci.draw_polygon(pts, PackedColorArray([Color(k, k, k)]), uvs, hero.get_texture())
		# the caption's shadow: a dark gradient under the title
		S.vgrad(ci, Rect2(i, h * 0.55, w - 2.0 * i, h * 0.45 - i), [[0.0, Color(0, 0, 0, 0)], [0.45, Color(0.02, 0.01, 0.02, 0.62)], [1.0, Color(0.02, 0.01, 0.02, 0.9)]])
		S.vgrad(ci, Rect2(i, i, w - 2.0 * i, 26), [[0.0, Color(0, 0, 0, 0.35)], [1.0, Color(0, 0, 0, 0)]])
	else:
		_draw_feature_icon(ci, r, hk, o, pg, a)
	var f := S.font("title")
	var col := S.INK.lerp(S.GOLD_HI, hk)
	var ty := r.size.y - 62.0
	S.text(ci, f, Vector2(18, ty) + o, str(pg.title), 22, Color(col, a), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9, 0.8)
	S.hgrad(ci, Rect2(16, ty + 9, r.size.x - 36, 1.3), [[0.0, Color(S.GOLD, 0.75 * a)], [1.0, Color(S.GOLD, 0.0)]])
	S.text(ci, S.font("sans"), Vector2(19, ty + 31) + o, str(pg.text).split("\n")[0], 16, Color(S.INK, 0.92 * a), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	# page dots
	var n := pages.size()
	var cx := r.size.x * 0.5 - (n - 1) * 8.0
	for i in n:
		var c := Vector2(cx + i * 16.0, r.size.y - 13.0)
		ci.draw_circle(c, 5.0, Color(0, 0, 0, 0.7), true, -1.0, true)
		ci.draw_circle(c, 3.6, S.INK if i == page else Color(0.35, 0.38, 0.38), true, -1.0, true)

func _draw_tab(ci: Control, r: Rect2, hk: float, down: bool, focus_ring: bool) -> void:
	var f := S.font("title")
	var cx := r.size.x * 0.5
	if selected:
		# the light falling on the active tab from above, and its ornament
		ci.draw_texture_rect(_glow(), Rect2(Vector2(cx - 90, -70), Vector2(180, 150)), false, Color(1, 1, 1, 0.9))
		var y := r.size.y - 12.0
		ci.draw_line(Vector2(cx - 34, y), Vector2(cx - 8, y), Color(S.GOLD, 0.9), 1.2, true)
		ci.draw_line(Vector2(cx + 8, y), Vector2(cx + 34, y), Color(S.GOLD, 0.9), 1.2, true)
		ci.draw_arc(Vector2(cx - 36, y - 2.5), 2.5, 0, TAU, 12, S.GOLD, 1.0, true)
		ci.draw_arc(Vector2(cx + 36, y - 2.5), 2.5, 0, TAU, 12, S.GOLD, 1.0, true)
		S.boss(ci, Vector2(cx, y), 3.5)
	var col := S.GOLD.lerp(S.GOLD_HI, hk) if selected else Color("#a9a79a").lerp(S.INK, hk)
	if not available:
		col = Color(0.5, 0.52, 0.5).lerp(Color(0.66, 0.68, 0.66), hk)
	var o := Vector2(0, 1) if down else Vector2.ZERO
	S.text(ci, f, Vector2(0, r.size.y * 0.5 + 10) + o, title, 29, col, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.9, 0.4)
	if focus_ring:
		var p := 0.5 + 0.5 * sin(Time.get_ticks_msec() / 1000.0 * 4.0)
		ci.draw_rect(r.grow(-4.0), Color(S.GOLD_HI, 0.5 + 0.35 * p), false, 1.5)

func _draw_burger(ci: Control, r: Rect2, hk: float, down: bool, focus_ring: bool) -> void:
	var col := Color("#b9b8ae").lerp(S.GOLD_HI, hk)
	var c := r.get_center() + (Vector2(0, 1) if down else Vector2.ZERO)
	for i in 3:
		var y := c.y + (i - 1) * 10.0
		ci.draw_line(Vector2(c.x - 17, y + 1), Vector2(c.x + 17, y + 1), Color(0, 0, 0, 0.7), 4.5, true)
		ci.draw_line(Vector2(c.x - 17, y), Vector2(c.x + 17, y), col, 4.0, true)
	if focus_ring:
		ci.draw_rect(r.grow(-2.0), Color(S.GOLD_HI, 0.7), false, 1.5)

## Without hero art: the page's emblem, large, with a glow behind it.
func _draw_feature_icon(ci: Control, r: Rect2, hk: float, o: Vector2, pg: Dictionary, a: float) -> void:
	# the god / subject emblem, large, with a glow behind it
	var ic := str(pg.get("icon", ""))
	if ic != "":
		var px := int(r.size.y * 0.56)
		var c := Vector2(r.size.x * 0.5, r.size.y * 0.36) + o
		ci.draw_texture_rect(_glow(), Rect2(c - Vector2(px, px) * 0.95, Vector2(px, px) * 1.9), false, Color(1, 1, 1, a * (0.9 + 0.5 * hk)))
		var glow := S.icon_glow(ic, px, 6)
		if glow:
			var gs := Vector2(glow.get_size())
			ci.draw_texture_rect(glow, Rect2(c - gs * 0.5, gs), false, Color(pg.get("glow", Color(1, 0.8, 0.4)), 0.55 * a))
		var tex := S.icon(ic, px)
		if tex:
			ci.draw_texture_rect(tex, Rect2(c - Vector2(px, px) * 0.5, Vector2(px, px)), false, Color(1, 1, 1, a))
	S.vgrad(ci, Rect2(3, r.size.y * 0.62, r.size.x - 6, r.size.y * 0.38 - 3), [[0.0, Color(0, 0, 0, 0)], [0.35, Color(0, 0, 0, 0.55)], [1.0, Color(0, 0, 0, 0.75)]])
