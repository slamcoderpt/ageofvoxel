extends RefCounted
## HUD look: palette, fonts, rasterised icons and the draw helpers shared by
## the HUD controls (port of the browser's src/ui/hud.css: dark teal panels in
## cast-bronze frames, after Age of Mythology: Retold). Everything is drawn in
## "CSS pixels" (the browser layout at 1920x1080); the HUD CanvasLayer scales.

const Icons := preload("res://game/ui/icons.gd")

const GOLD := Color("#e9c878")
const GOLD_HI := Color("#fff0c0")
const BRONZE := Color("#8c6a36")
const BRONZE_HI := Color("#d8b46c")
const BRONZE_DK := Color("#3b2a12")
const INK := Color("#f3ead6")
const MUTED := Color("#a9b8b4")
const DARK := Color("#040b0e")
const TEAL_0 := Color("#041116")
## --metal: linear-gradient(180deg, #f3d893 0%, #b38a45 38%, #6e4f22 62%, #c9a258 100%)
const METAL := [[0.0, Color("#f3d893")], [0.38, Color("#b38a45")], [0.62, Color("#6e4f22")], [1.0, Color("#c9a258")]]

static var _fonts := {}
static var _icons := {}
static var _grads := {}

# ---- fonts -------------------------------------------------------------------

static func _font_file(file: String) -> Font:
	var path := "res://game/ui/fonts/" + file
	var f := FontFile.new()
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		push_error("hud: missing font %s" % path)
		return ThemeDB.fallback_font
	f.data = bytes
	f.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
	f.hinting = TextServer.HINTING_LIGHT
	f.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_AUTO
	f.multichannel_signed_distance_field = false
	return f

## "sans" Alegreya Sans 500, "bold" Alegreya Sans 800, "title" Cinzel 800,
## "black" Cinzel 900, "title7" Cinzel 700.
static func font(kind: String) -> Font:
	if _fonts.has(kind):
		return _fonts[kind]
	var f: Font
	match kind:
		"sans": f = _font_file("alegreya-sans-500.woff2")
		"bold": f = _font_file("alegreya-sans-800.woff2")
		_:
			if not _fonts.has("_cinzel"):
				_fonts["_cinzel"] = _font_file("cinzel-var.woff2")
			var v := FontVariation.new()
			v.base_font = _fonts["_cinzel"]
			var w := 900 if kind == "black" else 700 if kind == "title7" else 800
			v.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): w}
			f = v
	_fonts[kind] = f
	return f

# ---- icons -------------------------------------------------------------------

## The browser's SVG icon `name` rasterised to `px` pixels (square viewBox
## icons; `wing` keeps its 3:1 aspect). `tint` replaces currentColor.
static func icon(name: String, px: int, tint := "") -> Texture2D:
	var key := "%s@%d%s" % [name, px, tint]
	if _icons.has(key):
		return _icons[key]
	var svg: String = Icons.SVG.get(name, "")
	if svg.is_empty():
		return null
	if tint != "":
		svg = svg.replace("currentColor", tint)
	var vb := 100.0 if name == "zeus" else 120.0 if name == "wing" else 24.0
	var img := Image.new()
	var err := img.load_svg_from_string(svg, float(px) / vb)
	if err != OK:
		push_error("hud: bad svg icon %s" % name)
		return null
	var tex := ImageTexture.create_from_image(img)
	_icons[key] = tex
	return tex

## A soft glow of an icon (its silhouette blurred by a down/up resize), drawn
## under it with a modulate colour for the CSS drop-shadow(0 0 Npx colour).
static func icon_glow(name: String, px: int, blur := 4) -> Texture2D:
	var key := "%s@%d~%d" % [name, px, blur]
	if _icons.has(key):
		return _icons[key]
	var base := icon(name, px)
	if base == null:
		return null
	var pad := blur * 3
	var img := Image.create(px + pad * 2, px + pad * 2, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var src := base.get_image()
	src.convert(Image.FORMAT_RGBA8)
	img.blend_rect(src, Rect2i(0, 0, px, px), Vector2i(pad, pad))
	# silhouette (white, alpha only)
	var w := img.get_width()
	var small := maxi(4, w / maxi(2, blur))
	img.resize(small, small, Image.INTERPOLATE_BILINEAR)
	img.resize(w, w, Image.INTERPOLATE_CUBIC)
	for y in w:
		for x in w:
			var c := img.get_pixel(x, y)
			img.set_pixel(x, y, Color(1, 1, 1, clampf(c.a * 1.6, 0.0, 1.0)))
	var tex := ImageTexture.create_from_image(img)
	_icons[key] = tex
	return tex

static func draw_icon(ci: CanvasItem, name: String, r: Rect2, shadow := true, mod := Color.WHITE) -> void:
	var px := int(round(maxf(r.size.x, r.size.y)))
	var tex := icon(name, px)
	if tex == null:
		return
	var dst := Rect2(r.position, Vector2(tex.get_width(), tex.get_height()))
	dst.position += (r.size - dst.size) * 0.5
	if shadow:
		ci.draw_texture_rect(tex, Rect2(dst.position + Vector2(0, 1), dst.size), false, Color(0, 0, 0, 0.85 * mod.a))
	ci.draw_texture_rect(tex, dst, false, mod)

# ---- gradients -----------------------------------------------------------------

static func _gradient(stops: Array) -> Gradient:
	var g := Gradient.new()
	var offs := PackedFloat32Array()
	var cols := PackedColorArray()
	for s in stops:
		offs.push_back(s[0])
		cols.push_back(s[1])
	g.offsets = offs
	g.colors = cols
	return g

## A radial gradient texture (CSS radial-gradient(circle at cx cy, ...)):
## `center` is the focus in 0..1 of the box, `extent` the radius (in box
## units) that the last stop reaches.
static func radial_tex(stops: Array, center := Vector2(0.5, 0.5), extent := 0.5, size := 128) -> Texture2D:
	var key := "%s|%s|%s|%d" % [str(stops), center, extent, size]
	if _grads.has(key):
		return _grads[key]
	var t := GradientTexture2D.new()
	t.gradient = _gradient(stops)
	t.width = size
	t.height = size
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = center
	t.fill_to = center + Vector2(extent, 0)
	_grads[key] = t
	return t

static var _circle := PackedVector2Array()
static var _circle_uv := PackedVector2Array()

## A disc filled with a texture (UV-mapped polygon) with an antialiased rim.
static func disc(ci: CanvasItem, c: Vector2, rad: float, tex: Texture2D, rim := Color(0, 0, 0, 0)) -> void:
	if _circle.is_empty():
		for i in 48:
			var a := TAU * float(i) / 48.0
			_circle.push_back(Vector2(cos(a), sin(a)))
			_circle_uv.push_back(Vector2(0.5 + 0.5 * cos(a), 0.5 + 0.5 * sin(a)))
	var pts := PackedVector2Array()
	pts.resize(48)
	for i in 48:
		pts[i] = c + _circle[i] * rad
	ci.draw_colored_polygon(pts, Color.WHITE, _circle_uv, tex)
	if rim.a > 0.0:
		ci.draw_arc(c, rad, 0.0, TAU, 48, rim, 1.0, true)

static func sample(stops: Array, t: float) -> Color:
	t = clampf(t, 0.0, 1.0)
	for i in range(1, stops.size()):
		if t <= stops[i][0]:
			var a: Array = stops[i - 1]
			var b: Array = stops[i]
			var k: float = 0.0 if b[0] == a[0] else (t - a[0]) / (b[0] - a[0])
			return (a[1] as Color).lerp(b[1], k)
	return stops[stops.size() - 1][1]

## Vertical multi-stop gradient over a rect.
static func vgrad(ci: CanvasItem, r: Rect2, stops: Array) -> void:
	for i in range(1, stops.size()):
		var y0 := r.position.y + r.size.y * float(stops[i - 1][0])
		var y1 := r.position.y + r.size.y * float(stops[i][0])
		if y1 <= y0:
			continue
		ci.draw_polygon(PackedVector2Array([Vector2(r.position.x, y0), Vector2(r.end.x, y0), Vector2(r.end.x, y1), Vector2(r.position.x, y1)]),
			PackedColorArray([stops[i - 1][1], stops[i - 1][1], stops[i][1], stops[i][1]]))

## Horizontal multi-stop gradient over a rect.
static func hgrad(ci: CanvasItem, r: Rect2, stops: Array) -> void:
	for i in range(1, stops.size()):
		var x0 := r.position.x + r.size.x * float(stops[i - 1][0])
		var x1 := r.position.x + r.size.x * float(stops[i][0])
		if x1 <= x0:
			continue
		ci.draw_polygon(PackedVector2Array([Vector2(x0, r.position.y), Vector2(x1, r.position.y), Vector2(x1, r.end.y), Vector2(x0, r.end.y)]),
			PackedColorArray([stops[i - 1][1], stops[i][1], stops[i][1], stops[i - 1][1]]))

## A radial-gradient box (CSS radial-gradient(circle at cx cy, ...)) filling r.
static func radial_box(ci: CanvasItem, r: Rect2, stops: Array, center := Vector2(0.5, 0.35)) -> void:
	# farthest-corner radius in units of the box (square boxes)
	var far := 0.0
	for c in [Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 1)]:
		far = maxf(far, center.distance_to(c))
	ci.draw_texture_rect(radial_tex(stops, center, far, 64), r, false)

## The cast-bronze border-image (var(--metal) 1) of width w round r (outside
## the content, inside r): top row = the gradient's top colour, bottom row its
## bottom colour, the sides the full vertical gradient. sides = "trbl".
static func metal_border(ci: CanvasItem, r: Rect2, w: float, sides := "trbl") -> void:
	var top := "t" in sides
	var bot := "b" in sides
	if "l" in sides:
		vgrad(ci, Rect2(r.position, Vector2(w, r.size.y)), METAL)
	if "r" in sides:
		vgrad(ci, Rect2(Vector2(r.end.x - w, r.position.y), Vector2(w, r.size.y)), METAL)
	if top:
		ci.draw_rect(Rect2(r.position, Vector2(r.size.x, w)), METAL[0][1])
		ci.draw_rect(Rect2(r.position + Vector2(0, w * 0.5), Vector2(r.size.x, w * 0.5)), Color("#d9b870"))
	if bot:
		ci.draw_rect(Rect2(Vector2(r.position.x, r.end.y - w), Vector2(r.size.x, w)), METAL[3][1])
		ci.draw_rect(Rect2(Vector2(r.position.x, r.end.y - w * 0.5), Vector2(r.size.x, w * 0.5)), Color("#a8843f"))

## A framed cell: dark outline, cast-bronze 2px border, radial teal fill.
static func cell(ci: CanvasItem, r: Rect2, stops: Array, center := Vector2(0.5, 0.35), border := 2.0) -> void:
	ci.draw_rect(r.grow(1), DARK)
	radial_box(ci, r.grow(-border), stops, center)
	metal_border(ci, r, border)
	ci.draw_rect(r.grow(-border), DARK, false, 1.0)

## Inner shadow (CSS inset 0 0 Npx rgba(0,0,0,a)) of a rect: stacked strokes.
static func inset_shadow(ci: CanvasItem, r: Rect2, px: float, a: float) -> void:
	var n := int(ceil(px / 2.0))
	for i in n:
		var k := 1.0 - float(i) / float(n)
		ci.draw_rect(r.grow(-(i * 2.0 + 1.0)), Color(0, 0, 0, a * k * k * 0.45), false, 2.0)

## A soft drop shadow under a rect (CSS 0 dy blur rgba(0,0,0,a)).
static func drop_shadow(ci: CanvasItem, r: Rect2, dy: float, blur: float, a: float) -> void:
	var n := 6
	for i in n:
		var g := blur * (float(i) + 1.0) / float(n)
		ci.draw_rect(Rect2(r.position + Vector2(0, dy), r.size).grow(g * 0.5), Color(0, 0, 0, a / float(n) * 0.9))

## A round HUD button (CSS .mbtn / .rbtn): radial teal face, 1px dark / 2px
## bronze / 1px dark ring, a soft top highlight and bottom shade.
static func round_button(ci: CanvasItem, c: Vector2, rad: float, hover := false, on := false) -> void:
	ci.draw_circle(c + Vector2(0, 3), rad + 5.0, Color(0, 0, 0, 0.28), true, -1.0, true)
	ci.draw_circle(c, rad + 4.0, DARK, true, -1.0, true)
	ci.draw_circle(c, rad + 3.0, GOLD_HI if on else Color("#b28c4c"), true, -1.0, true)
	ci.draw_arc(c, rad + 2.2, PI * 1.1, PI * 1.9, 24, Color(1, 0.94, 0.75, 0.55), 1.0, true)
	ci.draw_circle(c, rad + 1.0, DARK, true, -1.0, true)
	var stops := [[0.0, Color("#2d7489") if hover else Color("#1e5363")], [0.7, Color("#0e303a") if hover else Color("#0a232b")], [1.0, Color("#051216")]]
	disc(ci, c, rad, radial_tex(stops, Vector2(0.5, 0.35), 0.62, 64))
	ci.draw_arc(c, rad - 1.0, PI * 1.15, PI * 1.85, 24, Color(1, 1, 1, 0.12), 2.0, true)
	ci.draw_arc(c, rad - 2.0, PI * 0.15, PI * 0.85, 24, Color(0, 0, 0, 0.35), 3.0, true)
	if on:
		ci.draw_circle(c, rad + 7.0, Color(1, 0.9, 0.63, 0.18), false, 4.0, true)

## A small cast-bronze stud / boss (radial highlight at top-left).
static func stud(ci: CanvasItem, c: Vector2, rad: float) -> void:
	ci.draw_circle(c, rad + 1.0, DARK, true, -1.0, true)
	var stops := [[0.0, GOLD_HI], [0.4, BRONZE_HI], [0.9, BRONZE_DK], [1.0, BRONZE_DK]]
	disc(ci, c, rad, radial_tex(stops, Vector2(0.35, 0.3), 0.8, 32))

## A diamond boss (rotated square) with a radial highlight (.gild::before).
static func boss(ci: CanvasItem, c: Vector2, half: float) -> void:
	var d := half * 1.414
	ci.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -d - 1.5), c + Vector2(d + 1.5, 0), c + Vector2(0, d + 1.5), c + Vector2(-d - 1.5, 0)]), DARK)
	var pts := PackedVector2Array([c + Vector2(0, -d), c + Vector2(d, 0), c + Vector2(0, d), c + Vector2(-d, 0)])
	var cols := PackedColorArray([Color("#fff4c8"), Color("#b8914f"), Color("#5e421c"), Color("#d8b46c")])
	ci.draw_polygon(pts, cols)
	ci.draw_polygon(PackedVector2Array([c + Vector2(0, -d * 0.45), c + Vector2(d * 0.45, 0), c + Vector2(0, d * 0.45), c + Vector2(-d * 0.45, 0)]),
		PackedColorArray([Color("#fff8dc"), Color("#d8b46c"), Color("#8c6a36"), Color("#e9c878")]))

## Text with the HUD's dark drop shadow (text-shadow: 0 1px 2px #000).
static func text(ci: CanvasItem, f: Font, pos: Vector2, s: String, size: int, col: Color, align := HORIZONTAL_ALIGNMENT_LEFT,
		width := -1.0, shadow := 0.85, spacing := 0.0) -> void:
	if spacing != 0.0:
		_spaced(ci, f, pos, s, size, col, align, width, shadow, spacing)
		return
	if shadow > 0.0:
		ci.draw_string_outline(f, pos + Vector2(0, 1), s, align, width, size, 3, Color(0, 0, 0, shadow * 0.35))
		ci.draw_string(f, pos + Vector2(0, 1), s, align, width, size, Color(0, 0, 0, shadow))
	ci.draw_string(f, pos, s, align, width, size, col)

static func _spaced(ci: CanvasItem, f: Font, pos: Vector2, s: String, size: int, col: Color, align: int, width: float, shadow: float, spacing: float) -> void:
	var w := text_width(f, s, size, spacing)
	var x := pos.x
	if align == HORIZONTAL_ALIGNMENT_CENTER and width > 0:
		x += (width - w) * 0.5
	elif align == HORIZONTAL_ALIGNMENT_RIGHT and width > 0:
		x += width - w
	for ch in s:
		if shadow > 0.0:
			ci.draw_string_outline(f, Vector2(x, pos.y + 1), ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 3, Color(0, 0, 0, shadow * 0.35))
			ci.draw_string(f, Vector2(x, pos.y + 1), ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(0, 0, 0, shadow))
		ci.draw_string(f, Vector2(x, pos.y), ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size, col)
		x += f.get_string_size(ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + spacing

static func text_width(f: Font, s: String, size: int, spacing := 0.0) -> float:
	if spacing == 0.0:
		return f.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var w := 0.0
	for ch in s:
		w += f.get_string_size(ch, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x + spacing
	return w - spacing

static func hex(c: int) -> Color:
	return Color8((c >> 16) & 255, (c >> 8) & 255, c & 255)

## A player colour tag (the small numbered square of the owner / score lines).
static func player_tag(ci: CanvasItem, r: Rect2, col: Color, n: int, size := 12) -> void:
	ci.draw_rect(r.grow(1), Color(0, 0, 0, 0.6))
	var hi := col.lightened(0.18)
	ci.draw_polygon(PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]),
		PackedColorArray([hi, hi, col.darkened(0.12), col.darkened(0.12)]))
	ci.draw_rect(r, Color(1, 1, 1, 0.75), false, 1.0)
	var f := font("bold")
	text(ci, f, Vector2(r.position.x, r.position.y + r.size.y * 0.5 + size * 0.36), str(n), size, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.7)
