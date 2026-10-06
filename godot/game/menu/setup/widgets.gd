extends RefCounted
## Drawn widgets of the menu screens, in the HUD's look (game/ui/hud_style.gd:
## dark teal fields, cast-bronze rims, Cinzel / Alegreya type): dropdown
## fields and their open lists, pill buttons (bronze, green Play), toggles,
## colour swatches, pantheon discs, section rules. Immediate mode: a screen
## calls these from _draw() with its CanvasItem; hit testing is the screen's.

const S := preload("res://game/ui/hud_style.gd")
const EgyptIcons := preload("res://game/ui/egypt_icons.gd")

const FIELD_H := 38.0
const ITEM_H := 36.0

static var _boxes := {}
static var _svgs := {}

## Extra line icons (24x24 viewBox, currentColor), menu-only.
const SVG := {
	"lock": '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10.5" rx="2" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
	"dice": '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="1.7" fill="currentColor"/><circle cx="16" cy="8" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="8" cy="16" r="1.7" fill="currentColor"/><circle cx="16" cy="16" r="1.7" fill="currentColor"/></svg>',
	"trident": '<svg viewBox="0 0 24 24"><path d="M12 6v16M6 3v5c0 2.5 2.7 4 6 4s6-1.5 6-4V3M12 1.5l-1.8 4.5h3.6zM6 1.5L4.6 4.5h2.8zM18 1.5l-1.4 3h2.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
	"bident": '<svg viewBox="0 0 24 24"><path d="M12 11v11M8 2v5c0 2.2 1.8 4 4 4s4-1.8 4-4V2M8 1l-1.2 3h2.4zM16 1l-1.2 3h2.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 20c2-1 4-1 6-1s4 0 6 1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
	"check": '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	"close": '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
	"plus": '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
	"map": '<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
}

static func svg(name: String, px: int, tint := "#ffffff") -> Texture2D:
	var key := "%s@%d%s" % [name, px, tint]
	if _svgs.has(key):
		return _svgs[key]
	var src: String = SVG.get(name, "")
	if src.is_empty():
		return S.icon(name, px, tint)
	var img := Image.new()
	if img.load_svg_from_string(src.replace("currentColor", tint), float(px) / 24.0) != OK:
		return null
	var tex := ImageTexture.create_from_image(img)
	_svgs[key] = tex
	return tex

static func draw_svg(ci: CanvasItem, name: String, r: Rect2, tint := "#ffffff", mod := Color.WHITE, shadow := true) -> void:
	var tex := svg(name, int(round(maxf(r.size.x, r.size.y))), tint)
	if tex == null:
		return
	var dst := Rect2(r.position + (r.size - Vector2(tex.get_width(), tex.get_height())) * 0.5, Vector2(tex.get_width(), tex.get_height()))
	if shadow:
		ci.draw_texture_rect(tex, Rect2(dst.position + Vector2(0, 1.5), dst.size), false, Color(0, 0, 0, 0.8 * mod.a))
	ci.draw_texture_rect(tex, dst, false, mod)

## A cached StyleBoxFlat (rounded, bordered, antialiased).
static func box(bg: Color, border: Color, bw := 1.0, radius := 3.0, shadow := 0.0) -> StyleBoxFlat:
	var key := "%s|%s|%s|%s|%s" % [bg, border, bw, radius, shadow]
	if _boxes.has(key):
		return _boxes[key]
	var b := StyleBoxFlat.new()
	b.bg_color = bg
	b.border_color = border
	b.set_border_width_all(int(round(bw)))
	b.set_corner_radius_all(int(round(radius)))
	b.anti_aliasing = true
	b.anti_aliasing_size = 0.8
	b.corner_detail = 10
	if shadow > 0.0:
		b.shadow_color = Color(0, 0, 0, 0.55)
		b.shadow_size = int(shadow)
		b.shadow_offset = Vector2(0, shadow * 0.4)
	_boxes[key] = b
	return b

static func draw_box(ci: CanvasItem, r: Rect2, bg: Color, border: Color, bw := 1.0, radius := 3.0, shadow := 0.0) -> void:
	box(bg, border, bw, radius, shadow).draw(ci.get_canvas_item(), r)

static func tri_down(ci: CanvasItem, c: Vector2, w: float, col: Color, up := false) -> void:
	var h := w * 0.62
	var pts := PackedVector2Array([c + Vector2(-w * 0.5, -h * 0.5), c + Vector2(w * 0.5, -h * 0.5), c + Vector2(0, h * 0.5)]) if not up else \
		PackedVector2Array([c + Vector2(-w * 0.5, h * 0.5), c + Vector2(w * 0.5, h * 0.5), c + Vector2(0, -h * 0.5)])
	ci.draw_colored_polygon(PackedVector2Array([pts[0] + Vector2(0, 1.5), pts[1] + Vector2(0, 1.5), pts[2] + Vector2(0, 1.5)]), Color(0, 0, 0, 0.7))
	ci.draw_colored_polygon(pts, col)

## A dropdown field: dark inset box, bronze rim (gold when hovered / open),
## the value, a gold arrow. `swatch` paints the field in a player colour.
static func field(ci: CanvasItem, r: Rect2, label: String, hover := false, open := false, enabled := true, swatch = null) -> void:
	var rim := Color("#f3d893") if (open or hover) and enabled else Color("#8c6a36") if enabled else Color("#3d3424")
	if swatch != null:
		var c: Color = swatch
		draw_box(ci, r.grow(1), Color(0, 0, 0, 0.8), Color(0, 0, 0, 0), 0.0, 3.0)
		S.vgrad(ci, r.grow(-2), [[0.0, c.lightened(0.22)], [0.5, c], [1.0, c.darkened(0.25)]])
		draw_box(ci, r, Color(0, 0, 0, 0), Color.WHITE if hover or open else Color(1, 1, 1, 0.85), 2.0, 2.0)
		S.text(ci, S.font("bold"), Vector2(r.position.x + 12, r.get_center().y + 7), label, 20, Color.WHITE, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9)
		tri_down(ci, Vector2(r.end.x - 17, r.get_center().y + 1), 15, Color.WHITE, open)
		return
	draw_box(ci, r.grow(1), Color(0, 0, 0, 0.55), Color(0, 0, 0, 0), 0.0, 4.0)
	var top := Color("#0b1f25") if enabled else Color("#0a1114")
	var bot := Color("#050d10") if enabled else Color("#070a0c")
	S.vgrad(ci, r.grow(-1), [[0.0, top], [1.0, bot]])
	if hover and enabled and not open:
		S.vgrad(ci, r.grow(-1), [[0.0, Color(0.23, 0.45, 0.5, 0.25)], [1.0, Color(0, 0, 0, 0)]])
	draw_box(ci, r, Color(0, 0, 0, 0), rim, 1.0, 3.0)
	ci.draw_line(r.position + Vector2(3, 1.5), Vector2(r.end.x - 3, r.position.y + 1.5), Color(0, 0, 0, 0.6), 1.0)
	var col := S.INK if enabled else Color(0.55, 0.58, 0.56)
	var f := S.font("sans")
	var fs := 21
	var tw := r.size.x - (40.0 if enabled else 20.0)
	S.text(ci, f, Vector2(r.position.x + 11, r.get_center().y + 7.5), ellipsize(f, label, fs, tw), fs, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
	if enabled:
		tri_down(ci, Vector2(r.end.x - 18, r.get_center().y + 1), 15, Color("#f3d893") if hover or open else Color("#e9c878"), open)

static func ellipsize(f: Font, s: String, size: int, w: float) -> String:
	if f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x <= w:
		return s
	var t := s
	while t.length() > 1 and f.get_string_size(t + "...", HORIZONTAL_ALIGNMENT_LEFT, -1, size).x > w:
		t = t.substr(0, t.length() - 1)
	return t.strip_edges() + "..."

## The open list under (or over) a field. items: [{label, enabled, note, color}].
## Returns the item rects (the screen hit-tests them).
static func list_rect(anchor: Rect2, n: int, css_h: float, min_w := 0.0) -> Rect2:
	var h := ITEM_H * n + 8.0
	var w := maxf(anchor.size.x, min_w)
	var y := anchor.end.y + 2.0
	if y + h > css_h - 8.0:
		y = anchor.position.y - 2.0 - h
	return Rect2(anchor.position.x, y, w, h)

static func draw_list(ci: CanvasItem, lr: Rect2, items: Array, cur: int, hover: int) -> Array:
	S.drop_shadow(ci, lr, 8, 22, 0.55)
	draw_box(ci, lr.grow(1), Color(0, 0, 0, 1), Color(0, 0, 0, 0), 0.0, 4.0)
	S.vgrad(ci, lr.grow(-1), [[0.0, Color("#0e2a32")], [0.5, Color("#081a20")], [1.0, Color("#051216")]])
	draw_box(ci, lr, Color(0, 0, 0, 0), Color("#c9a258"), 1.5, 3.0)
	var rects := []
	var f := S.font("sans")
	for i in items.size():
		var it: Dictionary = items[i]
		var ir := Rect2(lr.position.x + 4, lr.position.y + 4 + i * ITEM_H, lr.size.x - 8, ITEM_H)
		rects.append(ir)
		var en := bool(it.get("enabled", true))
		if it.has("color"):
			var c: Color = it.color
			var sw := Rect2(ir.position + Vector2(4, 4), Vector2(ir.size.x - 8, ir.size.y - 8))
			S.vgrad(ci, sw, [[0.0, c.lightened(0.2)], [1.0, c.darkened(0.2)]])
			ci.draw_rect(sw, Color.WHITE if i == hover else Color(1, 1, 1, 0.35), false, 2.0 if i == hover else 1.0)
			S.text(ci, S.font("bold"), Vector2(sw.position.x + 9, sw.get_center().y + 7), str(it.label), 19, Color.WHITE, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.9)
			if str(it.get("note", "")) != "":
				S.text(ci, f, Vector2(sw.position.x, sw.get_center().y + 6), str(it.note), 16, Color(1, 1, 1, 0.92),
					HORIZONTAL_ALIGNMENT_RIGHT, sw.size.x - 8, 0.95)
			continue
		if i == hover and en:
			S.hgrad(ci, ir, [[0.0, Color(0.30, 0.55, 0.60, 0.55)], [1.0, Color(0.16, 0.36, 0.42, 0.35)]])
			ci.draw_rect(ir, Color(0.95, 0.85, 0.57, 0.45), false, 1.0)
		var col := S.GOLD_HI if i == cur else S.INK if en else Color(0.5, 0.53, 0.52)
		S.text(ci, f, Vector2(ir.position.x + 30, ir.get_center().y + 7.5), str(it.label), 21, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8)
		if i == cur:
			draw_svg(ci, "check", Rect2(ir.position.x + 7, ir.get_center().y - 8, 16, 16), "#e9c878")
		if str(it.get("note", "")) != "":
			S.text(ci, f, Vector2(ir.position.x, ir.get_center().y + 6), str(it.note), 16, Color(0.66, 0.72, 0.7) if en else Color(0.5, 0.5, 0.48),
				HORIZONTAL_ALIGNMENT_RIGHT, ir.size.x - 10, 0.6)
		if not en:
			draw_svg(ci, "lock", Rect2(ir.end.x - 26, ir.get_center().y - 8, 16, 16), "#8c7a56", Color.WHITE, false)
	return rects

## A pill button: "bronze" (dark lacquer, bronze rim) or "green" (Play).
static func pill(ci: CanvasItem, r: Rect2, label: String, style := "bronze", hover := false, enabled := true, size := 22) -> void:
	var rad := r.size.y * 0.5
	S.drop_shadow(ci, Rect2(r.position + Vector2(rad * 0.5, 0), r.size - Vector2(rad, 0)), 4, 12, 0.5)
	draw_box(ci, r.grow(2), Color(0, 0, 0, 0.9), Color(0, 0, 0, 0), 0.0, rad + 2)
	var rim := Color("#f3d893") if hover and enabled else Color("#b38a45") if enabled else Color("#5a4a30")
	draw_box(ci, r.grow(1), rim, Color(0, 0, 0, 0), 0.0, rad + 1)
	var top: Color
	var bot: Color
	if style == "green":
		top = Color("#5da33a") if hover else Color("#4a8a2a")
		bot = Color("#1f4a10") if hover else Color("#183d0c")
	else:
		top = Color("#3a3226") if hover else Color("#2a241c")
		bot = Color("#0e0c09")
	if not enabled:
		top = Color("#262420")
		bot = Color("#121110")
	var inner := r.grow(-1.5)
	draw_box(ci, inner, bot, Color(0, 0, 0, 0), 0.0, inner.size.y * 0.5)
	draw_box(ci, Rect2(inner.position, Vector2(inner.size.x, inner.size.y * 0.55)), Color(top, 0.95), Color(0, 0, 0, 0), 0.0, inner.size.y * 0.5)
	draw_box(ci, Rect2(inner.position + Vector2(0, inner.size.y * 0.3), Vector2(inner.size.x, inner.size.y * 0.4)), Color(top.lerp(bot, 0.5), 0.9), Color(0, 0, 0, 0), 0.0, 4.0)
	ci.draw_line(inner.position + Vector2(rad, 2), Vector2(inner.end.x - rad, inner.position.y + 2), Color(1, 1, 1, 0.18), 1.0)
	var col := Color("#fff4dc") if enabled else Color(0.5, 0.5, 0.48)
	S.text(ci, S.font("title"), Vector2(r.position.x, r.get_center().y + size * 0.36), label, size, col, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.9)

## A pill toggle (track + gold knob), Retold's switch.
static func toggle(ci: CanvasItem, r: Rect2, on: bool, hover := false) -> void:
	var rad := r.size.y * 0.5
	draw_box(ci, r.grow(1.5), Color(0, 0, 0, 0.9), Color(0, 0, 0, 0), 0.0, rad + 1.5)
	draw_box(ci, r, Color("#6e4f22") if on else Color("#0b1417"), Color("#f3d893") if hover else Color("#b38a45"), 1.5, rad)
	if on:
		S.hgrad(ci, r.grow(-3), [[0.0, Color(0.95, 0.8, 0.45, 0.35)], [1.0, Color(0.95, 0.8, 0.45, 0.0)]])
	var kx := r.end.x - rad if on else r.position.x + rad
	var c := Vector2(kx, r.get_center().y)
	ci.draw_circle(c + Vector2(0, 1.5), rad - 2.0, Color(0, 0, 0, 0.6), true, -1.0, true)
	S.stud(ci, c, rad - 3.5)

## A thin double gold rule with a centred diamond (section divider).
static func rule(ci: CanvasItem, a: Vector2, b: Vector2, boss := true) -> void:
	ci.draw_line(a + Vector2(0, 1), b + Vector2(0, 1), Color(0, 0, 0, 0.8), 1.0)
	ci.draw_line(a, b, Color(0.79, 0.64, 0.35, 0.55), 1.0)
	if boss:
		var c := (a + b) * 0.5
		S.boss(ci, c, 4.0)

## Corner ornaments of a gilded frame (L brackets with a stud).
static func frame_corners(ci: CanvasItem, r: Rect2, len := 22.0) -> void:
	var col := Color("#d8b46c")
	for k in 4:
		var sx := 1.0 if k % 2 == 0 else -1.0
		var sy := 1.0 if k < 2 else -1.0
		var p := Vector2(r.position.x if sx > 0 else r.end.x, r.position.y if sy > 0 else r.end.y)
		ci.draw_line(p + Vector2(0, 1), p + Vector2(len * sx, 1), Color(0, 0, 0, 0.8), 3.0)
		ci.draw_line(p, p + Vector2(len * sx, 0), col, 2.0)
		ci.draw_line(p, p + Vector2(0, len * sy), col, 2.0)
		S.stud(ci, p + Vector2(5 * sx, 5 * sy), 2.6)

## A pantheon portrait disc: the god's emblem on a sky / sea / shadow ground,
## a bronze ring; locked gods greyed with a padlock.
static func god_disc(ci: CanvasItem, c: Vector2, rad: float, god: String, hover := false, locked := false) -> void:
	ci.draw_circle(c + Vector2(0, 2), rad + 4, Color(0, 0, 0, 0.55), true, -1.0, true)
	ci.draw_circle(c, rad + 3.0, DARK_RIM, true, -1.0, true)
	ci.draw_circle(c, rad + 2.0, Color("#f3d893") if hover else Color("#b38a45"), true, -1.0, true)
	ci.draw_circle(c, rad, Color.BLACK, true, -1.0, true)
	var stops: Array
	match god:
		"hades": stops = [[0.0, Color("#7a2a22")], [0.6, Color("#2a0e0c")], [1.0, Color("#0a0404")]]
		"poseidon": stops = [[0.0, Color("#3aa4b8")], [0.6, Color("#0f4a5c")], [1.0, Color("#041c24")]]
		"ra", "isis", "set": stops = EgyptIcons.GOD_STOPS[god].duplicate(true)
		_: stops = [[0.0, Color("#f6e3a8")], [0.45, Color("#6d93b8")], [1.0, Color("#1a2c44")]]
	if locked:
		for s in stops:
			var cc: Color = s[1]
			var l := cc.get_luminance()
			s[1] = Color(l, l, l).lerp(cc, 0.2).darkened(0.35)
	S.disc(ci, c, rad - 1.0, S.radial_tex(stops, Vector2(0.5, 0.35), 0.7, 64))
	var em: String = {"zeus": "zeus", "hades": "bident", "poseidon": "trident", "ra": "ra", "isis": "isis", "set": "set"}.get(god, "zeus")
	var px := rad * (1.7 if em in ["zeus", "ra", "isis", "set"] else 1.25)
	var tint := "#fff6d8" if not locked else "#9a9a94"
	draw_svg(ci, em, Rect2(c - Vector2(px, px) * 0.5, Vector2(px, px)), tint, Color.WHITE, true)
	ci.draw_arc(c, rad - 1.5, PI * 1.15, PI * 1.85, 24, Color(1, 1, 1, 0.22), 2.0, true)
	if locked:
		ci.draw_circle(c, rad - 1.0, Color(0, 0, 0, 0.35), true, -1.0, true)
		draw_svg(ci, "lock", Rect2(c + Vector2(rad * 0.25, rad * 0.2), Vector2(rad * 0.7, rad * 0.7)), "#d8c08a")

## A minor god's disc (the Egyptians' age-up gods): lapis and gold, his
## hieroglyph emblem (EgyptIcons "mg_<god>"); `locked` greys it.
static func minor_disc(ci: CanvasItem, c: Vector2, rad: float, god: String, hover := false, locked := false) -> void:
	ci.draw_circle(c + Vector2(0, 2), rad + 3, Color(0, 0, 0, 0.55), true, -1.0, true)
	ci.draw_circle(c, rad + 2.5, DARK_RIM, true, -1.0, true)
	ci.draw_circle(c, rad + 1.5, Color("#f3d893") if hover else Color("#b38a45"), true, -1.0, true)
	ci.draw_circle(c, rad, Color.BLACK, true, -1.0, true)
	var stops: Array = EgyptIcons.GOD_STOPS.minor.duplicate(true)
	if locked:
		for st in stops:
			var cc: Color = st[1]
			var l := cc.get_luminance()
			st[1] = Color(l, l, l).lerp(cc, 0.2).darkened(0.35)
	S.disc(ci, c, rad - 1.0, S.radial_tex(stops, Vector2(0.5, 0.3), 0.7, 64))
	var px := rad * 1.45
	draw_svg(ci, "mg_" + god, Rect2(c - Vector2(px, px) * 0.5, Vector2(px, px)), "#ffe9a8" if not locked else "#9a9a94", Color.WHITE, true)
	ci.draw_arc(c, rad - 1.5, PI * 1.15, PI * 1.85, 24, Color(1, 1, 1, 0.22), 2.0, true)

const DARK_RIM := Color("#040b0e")
