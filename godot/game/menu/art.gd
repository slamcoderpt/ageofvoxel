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
			# a trireme under sail, the star on its sail, oars in the sea
			var s := _head(name, 1.5)
			s += _stars(11, 20, Rect2(6, 6, 148, 40))
			s += '<path d="M80 100 L80 24 M44 32 L116 32" stroke-width="1.8"/>'
			s += '<path d="M46 34 Q80 44 114 34 L111 84 Q80 91 49 84 Z" fill="#061015"/>'
			s += '<path d="M80 50 L84 62 L96 66 L84 70 L80 82 L76 70 L64 66 L76 62 Z" fill="%s" fill-opacity="0.35"/>' % GOLD
			s += '<path d="M46 34 L32 96 M114 34 L130 96" stroke-width="0.8"/>'
			# hull with a curled stern and a ram at the prow
			s += '<path d="M18 92 Q80 112 146 92 L156 98 L146 100 Q80 122 22 102 Z" fill="#061015"/>'
			s += '<path d="M18 92 C8 84 10 68 22 70 C28 71 28 78 22 78"/>'
			s += '<path d="M24 98 Q80 114 142 98" stroke-width="0.8"/>'
			for i in 10:
				var x := 34.0 + i * 10.5
				s += '<circle cx="%.1f" cy="%.1f" r="3.2"/>' % [x, 97.0 + sin(float(i) / 9.0 * PI) * 5.0]
				s += '<path d="M%.1f %.1f L%.1f %.1f" stroke-width="1"/>' % [x + 2, 106.0 + sin(float(i) / 9.0 * PI) * 3.0, x - 6, 130.0]
			for j in 3:
				var y := 128.0 + j * 9.0
				var d := "M%d %.1f" % [4 + j * 7, y]
				var x2 := 4.0 + j * 7
				while x2 < 156.0:
					d += " q6 -5 12 0 t12 0"
					x2 += 24.0
				s += '<path d="%s" stroke-width="%.1f"/>' % [d, 1.1 - j * 0.25]
			return s + '</g></svg>'
		"multiplayer":
			# two crossed swords inside a victor's laurel wreath
			var s := _head(name, 1.6)
			s += _stars(5, 16, Rect2(8, 8, 144, 40))
			s += _laurel(80, 86, 54, deg_to_rad(120), deg_to_rad(250), 7, 1.0)
			s += _laurel(80, 86, 54, deg_to_rad(60), deg_to_rad(-70), 7, -1.0)
			# swords
			s += '<path d="M46 124 L112 46 L118 40 L114 50 L50 128 Z"/>'
			s += '<path d="M40 112 L60 132" stroke-width="2"/><path d="M44 130 l-8 9"/>'
			s += '<path d="M114 124 L48 46 L42 40 L46 50 L110 128 Z"/>'
			s += '<path d="M120 112 L100 132" stroke-width="2"/><path d="M116 130 l8 9"/>'
			s += '<circle cx="34" cy="141" r="3"/><circle cx="126" cy="141" r="3"/>'
			return s + '</g></svg>'
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
