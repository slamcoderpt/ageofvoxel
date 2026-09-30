extends RefCounted
## Gold line art for the main-menu tiles (Retold's tiles carry engraved gold
## drawings of gods and heroes). Plain SVG strokes, built as strings and
## rasterised once per size; drawn by menu tiles with a modulate alpha.
##
##   Art.texture("skirmish", Vector2i(460, 250))

const GOLD := "#e9c878"

static var _cache := {}

static func texture(name: String, px: Vector2i) -> Texture2D:
	var key := "%s@%dx%d" % [name, px.x, px.y]
	if _cache.has(key):
		return _cache[key]
	var src := svg(name)
	if src.is_empty():
		return null
	var vb := _viewbox(name)
	var img := Image.new()
	var k := minf(float(px.x) / vb.x, float(px.y) / vb.y)
	if img.load_svg_from_string(src, k) != OK:
		push_error("menu art: bad svg %s" % name)
		return null
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex

static func _viewbox(name: String) -> Vector2:
	match name:
		"skirmish": return Vector2(300, 168)
		"logo_rule": return Vector2(400, 24)
		"campaign", "multiplayer": return Vector2(296, 250)
		_: return Vector2(160, 160)

static func _head(name: String, width := 1.6) -> String:
	var vb := _viewbox(name)
	return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d"><g fill="none" stroke="%s" stroke-width="%.2f" stroke-linecap="round" stroke-linejoin="round">' % [vb.x, vb.y, vb.x, vb.y, GOLD, width]

static func _stars(seed: int, n: int, area: Rect2) -> String:
	var s := ""
	var h := seed
	for i in n:
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var x := area.position.x + float(h % 1000) / 1000.0 * area.size.x
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var y := area.position.y + float(h % 1000) / 1000.0 * area.size.y
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var r := 0.5 + float(h % 100) / 100.0 * 0.9
		s += '<circle cx="%.1f" cy="%.1f" r="%.2f" fill="%s" stroke="none"/>' % [x, y, r, GOLD]
	return s

## A Greek key (meander) band between two rules, starting at y.
static func _meander(x0: float, x1: float, y: float) -> String:
	var s := '<path d="M%.1f %.1f L%.1f %.1f M%.1f %.1f L%.1f %.1f" stroke-width="1"/>' % [x0, y - 4, x1, y - 4, x0, y + 16, x1, y + 16]
	var d := ""
	var x := x0
	while x < x1:
		d += "M%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f L%.1f %.1f " % [
			x, y + 12, x, y, x + 12, y, x + 12, y + 8, x + 4, y + 8, x + 4, y + 4, x + 8, y + 4, x + 8, y + 4]
		d += "M%.1f %.1f L%.1f %.1f " % [x, y + 12, x + 16, y + 12]
		x += 16.0
	return s + '<path d="%s" stroke-width="1.3"/>' % d

static func _laurel(cx: float, cy: float, r: float, a0: float, a1: float, n: int, side: float) -> String:
	var s := '<path d="M%.1f %.1f A%.1f %.1f 0 0 %d %.1f %.1f"/>' % [cx + cos(a0) * r, cy + sin(a0) * r, r, r, 1 if side > 0 else 0, cx + cos(a1) * r, cy + sin(a1) * r]
	for i in n:
		var t := float(i) / float(n - 1)
		var a := lerpf(a0, a1, t)
		var p := Vector2(cx + cos(a) * r, cy + sin(a) * r)
		var tang := Vector2(-sin(a), cos(a)) * signf(a1 - a0)
		var out := Vector2(cos(a), sin(a))
		for sgn: float in [-1.0, 1.0]:
			var dir := (tang * 0.8 + out * 0.6 * sgn).normalized()
			var tip := p + dir * 11.0
			var nrm := Vector2(-dir.y, dir.x) * 3.2
			var m := (p + tip) * 0.5
			s += '<path d="M%.1f %.1f Q%.1f %.1f %.1f %.1f Q%.1f %.1f %.1f %.1f"/>' % [p.x, p.y, m.x + nrm.x, m.y + nrm.y, tip.x, tip.y, m.x - nrm.x, m.y - nrm.y, p.x, p.y]
	return s

static func svg(name: String) -> String:
	match name:
		"skirmish":
			# a hoplite shield with Zeus's thunderbolt, crossed spears behind
			# it, a Greek key band below and the stars above
			var s := _head(name, 1.5)
			s += _stars(7, 46, Rect2(10, 4, 290, 110))
			s += '<g transform="translate(246 78) scale(0.86) translate(-220 -80)">'
			# spears (shafts, leaf heads, butt spikes)
			s += '<path d="M134 150 L290 14"/><path d="M290 14 l8 -12 l-6 18 z"/><path d="M134 150 l-8 7"/>'
			s += '<path d="M300 142 L150 14"/><path d="M150 14 l-13 -13 l18 6 z"/>'
			# shield: dark face hides the shafts
			s += '<circle cx="220" cy="80" r="58" fill="#061015"/>'
			s += '<circle cx="220" cy="80" r="52"/><circle cx="220" cy="80" r="56" stroke-width="0.8"/>'
			for i in 32:
				var a := TAU * float(i) / 32.0
				var p := Vector2(220, 80) + Vector2(cos(a), sin(a)) * 48.0
				s += '<circle cx="%.1f" cy="%.1f" r="1.0" fill="%s" stroke="none"/>' % [p.x, p.y, GOLD]
			s += '<circle cx="220" cy="80" r="44" stroke-width="0.8"/>'
			# thunderbolt, with sparks
			s += '<path d="M231 42 L203 86 L220 86 L208 122 L240 74 L223 74 L237 42 Z" stroke-width="2"/>'
			s += '<path d="M202 58 l-8 -5 M240 104 l9 4 M194 94 l-9 3 M246 58 l9 -4 M212 40 l-3 -8 M228 124 l3 7" stroke-width="1.1"/>'
			s += '</g>'
			s += _meander(0, 300, 146)
			return s + '</g></svg>'
		"campaign":
			return _campaign()
		"multiplayer":
			return _multiplayer()
		"load":
			# a scroll
			var s := _head(name, 1.6)
			s += '<path d="M40 50 L120 50 M40 110 L120 110 M40 50 C30 50 30 62 40 62 L40 110 M120 50 L120 98 C130 98 130 110 120 110"/>'
			return s + '</g></svg>'
		"logo_rule":
			# the ornament under the logo: two fading rules, scrolls and a centre diamond
			var s := _head(name, 1.4)
			s += '<path d="M20 12 L168 12 M232 12 L380 12"/>'
			s += '<path d="M168 12 c8 -8 16 -8 18 0 c-2 6 -8 6 -9 2 M232 12 c-8 -8 -16 -8 -18 0 c2 6 8 6 9 2"/>'
			s += '<path d="M200 4 L208 12 L200 20 L192 12 Z" fill="%s"/>' % GOLD
			return s + '</g></svg>'
	return ""

# ---- the full-bleed tile illustrations (Campaign, Multiplayer) -------------------
# Engraved like Retold's tiles: a figure filling the card edge to edge, drawn
# in gold strokes with hatched shadows; dark fills hide what lies behind.

const INK := "#061015"

## Parallel hatch lines clipped to a path (an engraving's shading).
static func _hatch(id: String, d: String, box: Rect2, step: float, slant: float, width := 0.7) -> String:
	var s := '<clipPath id="%s"><path d="%s"/></clipPath><g clip-path="url(#%s)" stroke-width="%.2f">' % [id, d, id, width]
	var x := box.position.x - box.size.y * absf(slant)
	var lines := ""
	while x < box.end.x + box.size.y * absf(slant):
		lines += "M%.1f %.1f L%.1f %.1f " % [x, box.position.y, x + box.size.y * slant, box.end.y]
		x += step
	return s + '<path d="%s"/></g>' % lines

## Rows of sea swell from y0 down to y1.
static func _waves(x0: float, x1: float, y0: float, y1: float, rows: int, seed: int) -> String:
	var s := ""
	var h := seed
	for j in rows:
		var t := float(j) / float(maxi(rows - 1, 1))
		var y := lerpf(y0, y1, t)
		var w := lerpf(7.0, 16.0, t)
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var x := x0 - float(h % 100) / 100.0 * w * 2.0
		var d := "M%.1f %.1f" % [x, y]
		while x < x1:
			d += " q%.1f %.1f %.1f 0 t%.1f 0" % [w * 0.5, -w * 0.35, w, w]
			x += w * 2.0
		s += '<path d="%s" stroke-width="%.2f"/>' % [d, lerpf(0.7, 1.2, t)]
	return s

## A bank of scalloped cloud along a baseline, with an inner curl per puff.
static func _clouds(x0: float, x1: float, y: float, r: float, seed: int, fill := true) -> String:
	var d := "M%.1f %.1f" % [x0, y + r]
	var curls := ""
	var h := seed
	var x := x0
	while x < x1:
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var rr := r * (0.7 + float(h % 100) / 100.0 * 0.6)
		d += " a%.1f %.1f 0 0 1 %.1f 0" % [rr, rr, rr * 1.6]
		curls += '<path d="M%.1f %.1f a%.1f %.1f 0 1 1 %.1f %.1f" stroke-width="0.8"/>' % [x + rr * 0.45, y + r - rr * 0.25, rr * 0.3, rr * 0.3, rr * 0.45, rr * -0.2]
		x += rr * 1.6
	d += " L%.1f %.1f L%.1f %.1f Z" % [x, y + 200.0, x0, y + 200.0]
	return '<path d="%s"%s/>' % [d, ' fill="%s"' % INK if fill else ""] + curls

## Tight curls (hair, beard): little spirals scattered in a box.
static func _curls(box: Rect2, n: int, size: float, seed: int) -> String:
	var d := ""
	var h := seed
	for i in n:
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var x := box.position.x + float(h % 1000) / 1000.0 * box.size.x
		h = (h * 1103515245 + 12345) & 0x7fffffff
		var y := box.position.y + float(h % 1000) / 1000.0 * box.size.y
		var r := size * (0.7 + float(h % 7) / 10.0)
		d += "M%.1f %.1f c%.1f %.1f %.1f %.1f %.1f %.1f c%.1f %.1f %.1f %.1f %.1f %.1f " % [
			x, y, r * 0.2, -r, r * 1.4, -r * 0.9, r * 1.2, r * 0.1, -r * 0.1, r * 0.6, -r * 0.7, r * 0.6, -r * 0.6, r * 0.1]
	return '<path d="%s" stroke-width="0.9"/>' % d

## The Vergina sun: a disc with sixteen rays (the shield / sail device).
static func _sun(cx: float, cy: float, r: float) -> String:
	var d := ""
	for i in 16:
		var a := TAU * float(i) / 16.0
		var l := r if i % 2 == 0 else r * 0.7
		var a0 := a - 0.07
		var a1 := a + 0.07
		d += "M%.1f %.1f L%.1f %.1f L%.1f %.1f " % [cx + cos(a0) * r * 0.3, cy + sin(a0) * r * 0.3, cx + cos(a) * l, cy + sin(a) * l, cx + cos(a1) * r * 0.3, cy + sin(a1) * r * 0.3]
	return '<path d="%s" stroke-width="1"/><circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" fill-opacity="0.5"/>' % [d, cx, cy, r * 0.22, GOLD]

## Campaign: a hoplite hero charging with his spear raised, his cloak flying,
## and behind him a trireme burning in a sea fight under a rain of arrows.
static func _campaign() -> String:
	var s := _head("campaign", 1.4)
	s += _stars(11, 40, Rect2(0, 0, 296, 90))
	# the sea fight on the horizon, left
	s += '<path d="M0 150 L296 150" stroke-width="0.8"/>'
	s += '<g transform="translate(-6 72) scale(0.72)">'
	s += '<path d="M80 100 L80 24 M44 32 L116 32" stroke-width="2"/>'
	s += '<path d="M46 34 Q80 44 114 34 L111 84 Q80 91 49 84 Z" fill="%s"/>' % INK
	s += _sun(80, 60, 20)
	s += '<path d="M18 92 Q80 112 146 92 L156 98 L146 100 Q80 122 22 102 Z" fill="%s"/>' % INK
	s += '<path d="M18 92 C8 84 10 68 22 70 C28 71 28 78 22 78"/><path d="M24 98 Q80 114 142 98" stroke-width="0.8"/>'
	for i in 10:
		var x := 34.0 + i * 10.5
		s += '<circle cx="%.1f" cy="%.1f" r="3"/>' % [x, 97.0 + sin(float(i) / 9.0 * PI) * 5.0]
		s += '<path d="M%.1f %.1f L%.1f %.1f" stroke-width="1"/>' % [x + 2, 106.0 + sin(float(i) / 9.0 * PI) * 3.0, x - 6, 126.0]
	# fire on its stern, smoke rising
	s += '<path d="M112 84 c-6 -10 2 -16 0 -26 c8 8 12 14 8 24 c4 -6 8 -8 6 -16 c8 10 6 20 -2 24 Z" fill="%s" fill-opacity="0.35"/>' % GOLD
	s += '<path d="M118 56 c-10 -12 6 -18 -2 -32 M126 60 c8 -14 -4 -20 6 -34" stroke-width="0.8"/>'
	s += '</g>'
	# a second ship further out
	s += '<g transform="translate(96 118) scale(0.34)"><path d="M80 100 L80 24" stroke-width="3"/><path d="M50 34 Q80 42 110 34 L108 80 Q80 86 52 80 Z" fill="%s"/><path d="M18 92 Q80 112 146 92 L156 98 Q80 122 22 102 Z" fill="%s" stroke-width="3"/></g>' % [INK, INK]
	# arrows arcing over the fight
	for i in 7:
		var x0 := 20.0 + i * 17.0
		var y0 := 60.0 + (i % 3) * 8.0
		s += '<path d="M%.1f %.1f q24 -26 52 -12" stroke-width="0.7" stroke-dasharray="3 2"/>' % [x0, y0]
		s += '<path d="M%.1f %.1f l-5 -4 M%.1f %.1f l-6 1" stroke-width="0.9"/>' % [x0 + 52, y0 - 12, x0 + 52, y0 - 12]
	s += _waves(-10, 306, 162, 248, 7, 3)
	# ---- the hero (local 0..180 x 0..300), charging to the left
	s += '<g transform="translate(116 8) scale(0.92)">'
	# cloak, flying back
	var cloak := "M128 112 C156 118 182 146 192 196 C198 228 190 262 178 300 L136 300 C150 256 146 200 124 150 Z"
	s += '<path d="%s" fill="%s"/>' % [cloak, INK]
	s += _hatch("ca_cloak", cloak, Rect2(120, 110, 80, 190), 4.0, -0.35)
	s += '<path d="M136 128 C152 164 160 214 156 290 M146 122 C166 156 176 206 172 280" stroke-width="1"/>'
	# legs striding (greaves over the shins)
	for leg in ["M104 222 L120 222 C126 234 132 244 138 252 L122 258 C116 246 110 234 104 222 Z",
			"M122 258 L138 252 C146 268 152 284 158 296 L142 300 C136 286 130 272 122 258 Z",
			"M76 222 C72 236 66 248 60 258 L78 262 C84 250 92 236 96 222 Z",
			"M60 258 C54 276 50 292 50 300 L74 300 C76 290 78 276 78 262 Z"]:
		s += '<path d="%s" fill="%s" stroke-width="1.3"/>' % [leg, INK]
	s += '<path d="M69 262 C66 278 64 290 62 300 M130 256 C138 270 144 284 150 298" stroke-width="0.8"/>'
	# cuirass
	var torso := "M58 116 C70 106 120 104 134 116 L130 150 C128 168 124 180 122 190 L70 192 C68 176 64 160 62 150 Z"
	s += '<path d="%s" fill="%s"/>' % [torso, INK]
	s += '<path d="M72 134 C84 144 94 144 98 132 M98 132 C104 144 116 144 124 132 M82 154 Q96 160 112 154 M84 168 Q96 173 110 168 M97 142 L97 186" stroke-width="1.1"/>'
	s += _hatch("ca_torso", torso, Rect2(56, 104, 80, 90), 3.2, 0.25, 0.55)
	s += '<path d="M68 190 L124 188 M68 196 L124 194" stroke-width="1.3"/>'
	var pt := ""
	for i in 8:
		var x := 68.0 + i * 7.2
		pt += "M%.1f 196 L%.1f 224 L%.1f 224 L%.1f 196 " % [x, x - 1.5, x + 5.5, x + 6.0]
	s += '<path d="%s" fill="%s" stroke-width="1"/>' % [pt, INK]
	# neck and the Corinthian helmet with its horsehair crest
	s += '<path d="M86 98 L84 112 M104 96 L108 110" stroke-width="1.2"/>'
	var crest := "M60 38 C58 4 112 -10 146 28 C156 42 158 60 150 74 C146 54 134 40 120 34 C104 26 82 26 70 36 Z"
	s += '<path d="%s" fill="%s"/>' % [crest, INK]
	var strands := ""
	for i in 13:
		var t := float(i) / 12.0
		var ax := lerpf(66, 146, t)
		strands += "M%.1f %.1f Q%.1f %.1f %.1f %.1f " % [lerpf(70, 124, t), 34.0 - sin(t * PI) * 4.0, ax - 6, 20.0 - sin(t * PI) * 18.0 + t * 20.0, ax + 4, lerpf(10, 70, t * t)]
	s += '<path d="%s" stroke-width="0.8"/>' % strands
	s += '<path d="M62 62 C60 40 72 28 88 28 C106 28 116 40 116 58 L118 84 C118 92 112 96 104 96 L100 86 L92 86 L90 98 L76 98 C70 98 66 92 66 86 L62 74 Z" fill="%s" stroke-width="1.6"/>' % INK
	s += '<path d="M62 52 C80 46 100 46 116 50" stroke-width="1.1"/>'
	s += '<path d="M64 60 L86 58 L86 64 L72 66 L72 90 M66 62 L67 80" stroke-width="1.3"/>'
	s += '<path d="M92 86 C98 70 108 62 116 62" stroke-width="0.8"/>'
	s += _hatch("ca_helm", "M96 30 C108 32 116 42 116 58 L118 84 C118 92 112 96 104 96 L100 86 C104 70 104 46 96 30 Z", Rect2(94, 28, 26, 70), 2.6, 0.2, 0.55)
	# the raised arm and the spear, thrust overhand
	s += '<path d="M120 116 C130 100 144 86 154 82 C162 84 166 92 162 98 C152 108 142 118 134 126 Z" fill="%s"/>' % INK
	s += '<path d="M154 82 C150 72 144 64 138 58 L148 52 C156 60 162 74 164 92 Z" fill="%s"/>' % INK
	s += '<path d="M136 110 C144 100 150 96 156 94 M146 60 C152 68 156 76 158 86" stroke-width="0.8"/>'
	s += '<path d="M206 72 L-40 -6" stroke-width="2.2"/>'
	s += '<path d="M133 46 C134 40 148 40 150 46 L150 58 C146 62 136 62 133 56 Z" fill="%s" stroke-width="1.3"/>' % INK
	s += '<path d="M137.5 43 L137.5 59 M141.5 42 L141.5 60 M145.5 43 L145.5 59" stroke-width="0.7"/>'
	s += '<path d="M-40 -6 L-20 -6 L-6 2 L-24 2 Z" fill="%s" fill-opacity="0.4" transform="rotate(17.6 -40 -6)"/>' % GOLD
	s += '<path d="M206 72 l10 4" stroke-width="3"/>'
	# the shield (aspis) on his left arm, with the sun of Vergina
	s += '<ellipse cx="46" cy="150" rx="46" ry="54" fill="%s" stroke-width="1.8"/>' % INK
	s += '<ellipse cx="46" cy="150" rx="40" ry="48" stroke-width="0.9"/>'
	s += _sun(46, 150, 30)
	s += _hatch("ca_shield", "M46 96 A46 54 0 0 1 46 204 A34 54 0 0 0 46 96 Z", Rect2(40, 94, 56, 112), 2.8, 0.1, 0.6)
	s += '</g>'
	return s + '</g></svg>'

## Multiplayer: Zeus rising out of the storm clouds, bearded and crowned with
## laurel, a thunderbolt raised in his fist and lightning forking round him.
static func _multiplayer() -> String:
	var s := _head("multiplayer", 1.4)
	s += '<defs><radialGradient id="mp_glow"><stop offset="0" stop-color="%s" stop-opacity="0.55"/><stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient></defs>' % [GOLD, GOLD]
	s += _stars(5, 36, Rect2(0, 0, 296, 110))
	# lightning forking across the sky
	s += '<path d="M0 40 L22 52 L16 58 L44 72 L38 78 L70 96" stroke-width="1.2"/><path d="M22 52 L30 38 M44 72 L58 64" stroke-width="0.8"/>'
	s += '<path d="M296 150 L274 162 L282 168 L262 178" stroke-width="1"/>'
	# clouds behind the god
	s += _clouds(-10, 120, 150, 18, 9)
	s += _clouds(196, 310, 176, 15, 4)
	# the god (local coordinates are the tile's)
	# the hair, flowing back over his shoulder
	var hair := "M120 46 C132 26 170 22 192 42 C210 60 210 96 204 124 C200 146 208 162 218 176 C196 178 178 164 172 146 L160 70 Z"
	s += '<path d="%s" fill="%s"/>' % [hair, INK]
	s += _curls(Rect2(150, 40, 54, 120), 34, 5.0, 21)
	s += _hatch("mp_hair", hair, Rect2(150, 20, 70, 160), 3.0, 0.3, 0.5)
	# body: shoulders, chest, the himation over his left shoulder
	var body := "M40 250 C44 214 64 190 104 182 C124 178 142 178 160 176 C190 176 214 184 232 204 L250 250 Z"
	s += '<path d="%s" fill="%s"/>' % [body, INK]
	s += '<path d="M110 214 C128 228 150 226 160 210 M160 210 C170 224 194 226 206 210 M160 214 L160 250 M138 238 Q150 244 160 240" stroke-width="1.1"/>'
	var drape := "M44 250 C50 214 70 190 104 182 C118 196 124 214 128 250 Z"
	s += '<path d="%s" fill="%s" stroke-width="1.4"/>' % [drape, INK]
	s += '<path d="M60 250 C66 222 80 202 100 190 M76 250 C82 226 92 208 108 196 M94 250 C98 232 104 216 114 204 M112 250 C114 234 116 222 120 212" stroke-width="0.9"/>'
	s += _hatch("mp_drape", drape, Rect2(40, 180, 90, 72), 3.0, -0.4, 0.5)
	s += _hatch("mp_body", "M200 190 C216 196 228 206 234 220 L250 250 L206 250 Z", Rect2(196, 186, 56, 66), 3.0, 0.3, 0.5)
	# the raised arm: shoulder to elbow out to the right, forearm up to the fist
	s += '<path d="M200 184 C214 170 230 156 244 146 C256 142 268 150 266 162 C254 176 240 192 230 204 Z" fill="%s"/>' % INK
	s += '<path d="M244 150 C240 132 238 116 238 100 L258 98 C260 114 264 136 266 158 Z" fill="%s"/>' % INK
	s += '<path d="M214 196 C226 180 236 170 248 160 M252 146 C250 128 248 112 246 100" stroke-width="0.8"/>'
	# the thunderbolt in his fist, with its glow
	s += '<circle cx="248" cy="62" r="54" fill="url(#mp_glow)" stroke="none"/>'
	var bolt := "M254 4 L238 36 L250 36 L236 66 L246 66 L230 110 L262 58 L250 58 L266 26 L254 26 L262 4 Z"
	s += '<path d="%s" fill="%s" fill-opacity="0.45" stroke-width="1.6"/>' % [bolt, GOLD]
	for i in 12:
		var a := TAU * float(i) / 12.0 + 0.2
		s += '<path d="M%.1f %.1f L%.1f %.1f" stroke-width="0.8"/>' % [248 + cos(a) * 34, 58 + sin(a) * 34, 248 + cos(a) * 46, 58 + sin(a) * 46]
	s += '<path d="M236 88 C236 80 244 76 252 78 C262 80 262 96 256 102 C248 106 238 102 236 96 Z" fill="%s" stroke-width="1.4"/>' % INK
	s += '<path d="M240 86 L256 86 M239 92 L257 92 M240 98 L254 98" stroke-width="0.8"/>'
	# the neck, under the beard
	s += '<path d="M140 160 L136 182 M176 150 L180 178" stroke-width="1.3"/>'
	# the face, in profile to the left
	var face := "M124 46 C118 52 116 58 118 64 L112 78 L118 82 L118 90 C114 100 110 112 116 124 C110 134 114 146 122 152 C120 164 130 172 142 178 C146 168 156 172 164 164 C176 160 184 150 180 136 C186 122 184 106 176 96 L172 64 C164 44 140 38 124 46 Z"
	s += '<path d="%s" fill="%s" stroke-width="1.6"/>' % [face, INK]
	s += '<path d="M122 60 Q130 54 142 58 M124 66 Q130 62 138 66 Q131 69 124 66 M118 90 C126 94 134 94 142 88 M132 82 L140 80" stroke-width="1.1"/>'
	s += '<circle cx="131" cy="65.5" r="1.4" fill="%s" stroke="none"/>' % GOLD
	s += '<path d="M148 60 C152 72 150 84 142 92" stroke-width="0.8"/>'
	# beard: S-curled locks falling in rows
	var locks := ""
	for row in 6:
		var y := 98.0 + row * 12.0
		var x0 := 120.0 + row * 2.5
		var x1 := 178.0 - row * 4.0
		var x := x0
		while x < x1:
			locks += "M%.1f %.1f c3 5 -2 8 1 13 " % [x, y]
			x += 6.0
	s += '<path d="%s" stroke-width="0.9"/>' % locks
	s += _hatch("mp_face", "M150 50 C166 56 172 66 174 96 C182 118 182 140 176 156 L150 150 Z", Rect2(146, 46, 40, 120), 2.8, 0.25, 0.5)
	# the laurel crown
	s += _laurel(150, 118, 74, deg_to_rad(242), deg_to_rad(292), 6, 1.0)
	# clouds boiling round his waist, in front
	s += _clouds(-6, 300, 214, 14, 17)
	return s + '</g></svg>'
