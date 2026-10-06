extends RefCounted
## 3D models of the Egyptian tech icons (ui piece, Godot-only): one small scene
## per Egyptian tech (icon name "e_<tech key>", TechIcons.icon_for), built from
## tech_models.gd's parts (lathes, sweeps, bevelled extrusions, glow) and lit
## in the same studio, so an Egyptian's Town Center, Granary, Temple, Barracks,
## Migdol and Siege Works show a rendered picture per tech as the Greek
## buttons do (Retold paints one per tech: reference/egypt/ui_05.jpg shows
## Sobek's: the crocodile under the sun disc, the mud-brick stack, the camel
## at dark water, the solar barque). Materials in the game's Egyptian palette:
## polished gold, lapis, turquoise faience, white linen, black granite,
## sandstone and Nile mud.
##
##   EgyptTechModels.build_into("e_shaduf", root) -> true (root filled)
##
## Space as tech_models.gd: x right, y up, z toward the camera, about [-1, 1]^2.

const M := preload("res://game/ui/tech_models.gd")

const GOLD := Color(1.0, 0.78, 0.36)
const LAPIS := Color(0.08, 0.2, 0.62)
const TURQ := Color(0.12, 0.62, 0.6)
const LINEN := Color(0.93, 0.9, 0.8)
const GRANITE := Color(0.07, 0.07, 0.08)
const SAND := Color(0.86, 0.7, 0.45)
const MUD := Color(0.52, 0.36, 0.22)
const IVORY := Color(0.95, 0.9, 0.76)
const NILE := Color(0.08, 0.36, 0.62)
const COPPER := Color(0.85, 0.45, 0.25)

## Every Egyptian tech with its own model (the techs.cpp keys).
const KEYS := [
	"hands_of_the_pharaoh", "skin_of_the_rhino", "flood_of_the_nile", "clairvoyance",
	"criosphinx", "hieracosphinx", "sacred_cats", "adze_of_wepwawet",
	"scalloped_axe", "leather_frame_shield", "electrum_bullets", "shaduf",
	"feet_of_the_jackal", "serpent_spear", "necropolis",
	"sun_dried_mud_brick", "crocodilopolis", "dark_water", "solar_barque",
	"bone_bow", "slings_of_the_sun", "crimson_linen", "force_of_the_west_wind",
	"funeral_rites", "spirit_of_maat", "nebty", "funeral_barge",
	"new_kingdom", "desert_wind", "atef_crown",
	"axe_of_vengeance", "greatest_of_fifty", "spear_of_horus",
	"valley_of_the_kings", "book_of_thoth", "tusks_of_apedemak",
]

## Fill root with the model of an icon name ("e_<key>"); false: no model.
static func build_into(name: String, root: Node3D) -> bool:
	if not name.begins_with("e_"):
		return false
	var key := name.substr(2)
	if not KEYS.has(key):
		return false
	match key:
		"hands_of_the_pharaoh": _m_hands_of_the_pharaoh(root)
		"skin_of_the_rhino": _m_skin_of_the_rhino(root)
		"flood_of_the_nile": _m_flood_of_the_nile(root)
		"clairvoyance": _m_clairvoyance(root)
		"criosphinx": _m_criosphinx(root)
		"hieracosphinx": _m_hieracosphinx(root)
		"sacred_cats": _m_sacred_cats(root)
		"adze_of_wepwawet": _m_adze_of_wepwawet(root)
		"scalloped_axe": _m_scalloped_axe(root)
		"leather_frame_shield": _m_leather_frame_shield(root)
		"electrum_bullets": _m_electrum_bullets(root)
		"shaduf": _m_shaduf(root)
		"feet_of_the_jackal": _m_feet_of_the_jackal(root)
		"serpent_spear": _m_serpent_spear(root)
		"necropolis": _m_necropolis(root)
		"sun_dried_mud_brick": _m_sun_dried_mud_brick(root)
		"crocodilopolis": _m_crocodilopolis(root)
		"dark_water": _m_dark_water(root)
		"solar_barque": _m_solar_barque(root)
		"bone_bow": _m_bone_bow(root)
		"slings_of_the_sun": _m_slings_of_the_sun(root)
		"crimson_linen": _m_crimson_linen(root)
		"force_of_the_west_wind": _m_force_of_the_west_wind(root)
		"funeral_rites": _m_funeral_rites(root)
		"spirit_of_maat": _m_spirit_of_maat(root)
		"nebty": _m_nebty(root)
		"funeral_barge": _m_funeral_barge(root)
		"new_kingdom": _m_new_kingdom(root)
		"desert_wind": _m_desert_wind(root)
		"atef_crown": _m_atef_crown(root)
		"axe_of_vengeance": _m_axe_of_vengeance(root)
		"greatest_of_fifty": _m_greatest_of_fifty(root)
		"spear_of_horus": _m_spear_of_horus(root)
		"valley_of_the_kings": _m_valley_of_the_kings(root)
		"book_of_thoth": _m_book_of_thoth(root)
		"tusks_of_apedemak": _m_tusks_of_apedemak(root)
		_:
			return false
	return true

# ---- shared parts -------------------------------------------------------------

static func _gold(rough := 0.22) -> Material:
	return M.metal(GOLD, rough)

## A flat polygon (xy) at z, a thin bevelled slab.
static func _slab(root: Node3D, poly: PackedVector2Array, d: float, m: Material, xf := Transform3D()) -> MeshInstance3D:
	return M.put(root, M.extrude(poly, d, minf(d * 0.6, 0.02)), m, xf)

## An ellipse outline as a polygon.
static func _ellipse(cx: float, cy: float, rx: float, ry: float, n := 32) -> PackedVector2Array:
	var p := PackedVector2Array()
	for k in n:
		var a := TAU * k / n
		p.append(Vector2(cx + cos(a) * rx, cy + sin(a) * ry))
	return p

## The ankh: a loop, a crossbar and a flaring stem, gold with a lapis inlay.
static func ankh(root: Node3D, xf: Transform3D, s := 1.0) -> void:
	var n := Node3D.new()
	n.transform = xf
	root.add_child(n)
	var g := _gold(0.2)
	M.put(n, M.tube(_loop(0.0, 0.5 * s, 0.26 * s, 0.34 * s), func(_t): return Vector2(0.075, 0.075) * s, 12), g)
	var bar := PackedVector2Array([Vector2(-0.52, 0.12), Vector2(0.52, 0.12), Vector2(0.56, 0.2), Vector2(0.52, 0.28), Vector2(-0.52, 0.28), Vector2(-0.56, 0.2)])
	var stem := PackedVector2Array([Vector2(-0.08, 0.14), Vector2(0.08, 0.14), Vector2(0.17, -0.95), Vector2(-0.17, -0.95)])
	for i in bar.size():
		bar[i] *= s
	for i in stem.size():
		stem[i] *= s
	_slab(n, bar, 0.07 * s, g)
	_slab(n, stem, 0.07 * s, g)
	# the lapis inlay down the stem and across the bar
	var inl := PackedVector2Array([Vector2(-0.04, 0.05), Vector2(0.04, 0.05), Vector2(0.09, -0.85), Vector2(-0.09, -0.85)])
	for i in inl.size():
		inl[i] *= s
	_slab(n, inl, 0.02 * s, M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(0, 0, 0.07 * s)))
	M.put(n, M.box(Vector3(0.86, 0.06, 0.03) * s), M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(0, 0.2, 0.07) * s))

## A closed loop path (an ellipse in xy) round (cx, cy).
static func _loop(cx: float, cy: float, rx: float, ry: float, n := 40) -> PackedVector3Array:
	var p := PackedVector3Array()
	for k in n + 1:
		var a := TAU * k / n
		p.append(Vector3(cx + cos(a) * rx, cy + sin(a) * ry, 0.0))
	return p

## A papyrus boat's hull from x0 to x1 (both ends swept up), deck at y.
static func _hull(root: Node3D, x0: float, x1: float, y: float, m: Material, curl := 0.55) -> void:
	var path := PackedVector3Array()
	for k in 33:
		var t := float(k) / 32.0
		var x := lerpf(x0, x1, t)
		var e := absf(t - 0.5) * 2.0
		path.append(Vector3(x, y + curl * e ** 3.0, 0.0))
	M.put(root, M.tube(path, func(t): var e: float = 1.0 - absf(t - 0.5) * 2.0; return Vector2.ONE * (0.04 + 0.16 * sqrt(maxf(e, 0.0))), 14), m)
	# the bundles' lashing bands
	for k in 7:
		var t := 0.2 + k * 0.1
		M.put(root, M.torus(0.15, 0.19), _gold(0.3), M.along(path[int(t * 32)], Vector3(1, 0, 0)))

## Water: a rippled disc (glossy), radius R, seen from the front-top.
static func _water(root: Node3D, R: float, xf: Transform3D, c: Color, ripples := 3.0) -> void:
	M.put(root, M.disc(R, func(r, a): return 0.025 * sin(r * ripples * TAU / R + a * 0.0) * (1.0 - r / R), 18, 48), M.mat(c, 0.08), xf)

static func _spheres(root: Node3D, pts: Array, r: float, m: Material) -> void:
	for p in pts:
		M.put(root, M.sphere(r), m, Transform3D(Basis(), p))

# ---- Temple / Town Center: the major gods and the Pharaoh -----------------------

static func _m_hands_of_the_pharaoh(root: Node3D) -> void:
	# the Priest's gold ankh crossed with the Pharaoh's banded crook, a halo
	# of the priests' reach (a ring of light) behind
	ankh(root, Transform3D(Basis(Vector3(0, 0, 1), 0.18), Vector3(0.12, 0.0, 0.1)), 1.0)
	var crook := M.bez(Vector3(-0.55, -1.0, -0.1), Vector3(-0.3, -0.2, -0.1), Vector3(-0.1, 0.5, -0.1), Vector3(-0.15, 0.78, -0.1), 20)
	crook.append_array(M.bez(Vector3(-0.15, 0.82, -0.1), Vector3(-0.2, 1.08, -0.1), Vector3(-0.55, 1.08, -0.1), Vector3(-0.58, 0.82, -0.1), 10))
	M.put(root, M.tube(crook, func(t): return Vector2.ONE * 0.055, 10, Vector3(0, 0, 1), false, func(t, _a): return GOLD if int(t * 18.0) % 2 == 0 else LAPIS.lightened(0.15)), M.painted(0.25, 0.7))
	var ring := M._acc()
	M.tube_acc(ring, _loop(0.1, 0.1, 0.95, 0.95, 64), func(_t): return Vector2(0.05, 0.01), 8, Vector3(0, 0, 1), false, func(t, _a): return Color(1.0, 0.92, 0.6, 0.35 + 0.35 * sin(t * TAU * 6.0) ** 2))
	M.put(root, M._mesh(ring), M.glow(Color.WHITE, true), Transform3D(Basis(), Vector3(0, 0, -0.3)))

static func _m_skin_of_the_rhino(root: Node3D) -> void:
	# a rhino's grey hide stretched as a plate, its great curved horn on it
	var hide := M.mat(Color(0.17, 0.165, 0.16), 0.9, "rough")
	M.put(root, M.disc(0.95, func(r, a): return 0.22 * (1.0 - (r / 0.95) ** 2) + 0.025 * sin(a * 11.0 + r * 9.0) * r, 18, 60), hide, Transform3D(Basis(Vector3.RIGHT, -0.35), Vector3(0, -0.15, -0.2)))
	# skin folds
	for k in 3:
		var y := -0.55 + k * 0.32
		M.put(root, M.tube(M.bez(Vector3(-0.7, y, 0.12), Vector3(-0.25, y + 0.1, 0.25), Vector3(0.25, y + 0.1, 0.25), Vector3(0.7, y, 0.12), 14), func(t): return Vector2.ONE * 0.035 * sin(PI * t), 8), hide)
	var horn := M.bez(Vector3(0.05, -0.35, 0.25), Vector3(0.1, 0.15, 0.35), Vector3(0.1, 0.6, 0.35), Vector3(-0.25, 1.05, 0.25), 24)
	M.put(root, M.tube(horn, func(t): return Vector2.ONE * (0.3 * (1.0 - t) ** 0.9 + 0.01), 16, Vector3(0, 0, 1), false, func(t, _a): return Color(0.32, 0.26, 0.2).lerp(Color(0.78, 0.7, 0.56), t)), M.painted(0.3))
	var small := M.bez(Vector3(0.45, -0.5, 0.15), Vector3(0.5, -0.25, 0.2), Vector3(0.52, 0.0, 0.2), Vector3(0.4, 0.2, 0.15), 14)
	M.put(root, M.tube(small, func(t): return Vector2.ONE * (0.15 * (1.0 - t) + 0.01), 12, Vector3(0, 0, 1), false, func(t, _a): return Color(0.3, 0.25, 0.2).lerp(Color(0.72, 0.65, 0.52), t)), M.painted(0.35))
	# Ra's gold sun on the plate's rim
	M.put(root, M.sphere(0.16), M.glow(Color(1.0, 0.75, 0.25)), Transform3D(Basis(), Vector3(-0.6, 0.45, 0.25)))

static func _m_flood_of_the_nile(root: Node3D) -> void:
	# the Nile's blue flood curling over a sheaf of ripe wheat
	var stalk := M.mat(Color(0.85, 0.66, 0.25), 0.55)
	var ear := M.mat(Color(0.95, 0.75, 0.3), 0.45, "rough")
	for k in 5:
		var x := -0.5 + k * 0.22
		var top := Vector3(x + 0.1 * (k - 2), 0.75 - absf(k - 2) * 0.1, 0.0)
		M.put(root, M.tube(M.line(Vector3(x * 0.4, -0.95, 0), top, 8), func(_t): return Vector2.ONE * 0.025, 6), stalk)
		for j in 6:
			for s in [-1.0, 1.0]:
				var p := top + Vector3(0.05 * s, -0.06 - j * 0.07, 0.03)
				M.put(root, M.sphere(0.04, 0.11), ear, Transform3D(Basis(Vector3(0, 0, 1), -0.4 * s), p))
	# the wave: a thick glossy curl, a foam lip, droplets
	var wave := M.bez(Vector3(-1.05, -0.85, 0.25), Vector3(-0.2, -0.95, 0.3), Vector3(0.95, -0.6, 0.3), Vector3(0.6, -0.1, 0.35), 24)
	wave.append_array(M.bez(Vector3(0.58, -0.08, 0.35), Vector3(0.45, 0.15, 0.35), Vector3(0.15, 0.0, 0.35), Vector3(0.25, -0.2, 0.35), 10))
	M.put(root, M.tube(wave, func(t): return Vector2(0.28 * (1.0 - t) ** 0.6 + 0.03, 0.12), 14, Vector3(0, 0, 1), false, func(t, _a): return NILE.lerp(Color(0.5, 0.85, 0.95), t ** 1.5)), M.painted(0.08, 0.1))
	_spheres(root, [Vector3(0.75, 0.15, 0.4), Vector3(0.9, -0.05, 0.38), Vector3(0.35, 0.2, 0.45)], 0.05, M.mat(Color(0.7, 0.92, 1.0), 0.05))

static func _m_clairvoyance(root: Node3D) -> void:
	# the wedjat eye of Horus in gold and lapis, its pupil alight
	var g := _gold(0.2)
	var lap := M.mat(LAPIS, 0.22)
	var eye := PackedVector2Array()
	for k in 40:
		var a := TAU * k / 40.0
		eye.append(Vector2(cos(a) * 0.62, sin(a) * 0.3 * (1.0 if sin(a) > 0 else 0.85)))
	_slab(root, eye, 0.04, M.mat(IVORY, 0.35))
	M.put(root, M.tube(_loop(0.0, 0.0, 0.66, 0.33, 48), func(_t): return Vector2(0.06, 0.05), 8), lap, Transform3D(Basis(), Vector3(0, 0, 0.03)))
	M.put(root, M.disc(0.24, func(r, _a): return 0.05 * (1.0 - (r / 0.24) ** 2), 10, 36), lap, Transform3D(Basis(), Vector3(0.0, 0.0, 0.05)))
	M.put(root, M.sphere(0.1), M.glow(Color(0.7, 0.95, 1.0)), Transform3D(Basis(), Vector3(0.0, 0.0, 0.1)))
	# the brow and the falcon's cheek markings: a tear drop and a spiral
	_slab(root, PackedVector2Array([Vector2(-0.7, 0.45), Vector2(0.75, 0.48), Vector2(0.82, 0.6), Vector2(-0.7, 0.58)]), 0.05, lap)
	M.put(root, M.tube(M.line(Vector3(-0.05, -0.32, 0.03), Vector3(-0.12, -0.95, 0.03), 8), func(t): return Vector2(0.06 * (1.0 - t * 0.4), 0.04), 8), lap)
	var sp := PackedVector3Array()
	for k in 31:
		var t := float(k) / 30.0
		var a := -PI * 0.5 + t * TAU * 0.9
		var r := 0.28 * (1.0 - t * 0.7)
		sp.append(Vector3(0.12 + t * 0.35 + cos(a) * r * 0.6, -0.55 + sin(a) * r, 0.03))
	M.put(root, M.tube(sp, func(t): return Vector2.ONE * (0.055 - 0.03 * t), 8), lap)
	M.put(root, M.tube(_loop(0.0, 0.05, 0.9, 0.9, 64), func(_t): return Vector2(0.035, 0.035), 8), g, Transform3D(Basis(), Vector3(0, 0, -0.1)))

# ---- Bast ----------------------------------------------------------------------

## A beast head (sphinx variants): a stone face block, nemes in gold and lapis.
static func _nemes(root: Node3D, y: float) -> void:
	var stripes := func(i: int, _a: float) -> Color:
		return GOLD if i % 3 != 0 else LAPIS
	var prof := []
	for i in 13:
		var t := float(i) / 12.0
		prof.append(Vector2(0.5 + 0.12 * t, y - t * 0.9))
	M.put(root, M.lathe(prof, 32, func(a, _i): return 1.0 if sin(a) < 0.4 else 0.75, func(i, _a): return stripes.call(i, 0.0)), M.painted(0.3, 0.6), Transform3D(Basis(), Vector3(0, 0, -0.18)))

static func _m_criosphinx(root: Node3D) -> void:
	# a ram-headed sphinx's head: a sandstone ram face, curled gold horns, nemes
	var stone := M.mat(Color(0.46, 0.3, 0.15), 0.8, "rough")
	_nemes(root, 0.3)
	M.put(root, M.sphere(0.42, 0.95), stone, Transform3D(Basis(Vector3.RIGHT, 0.35), Vector3(0, 0.05, 0.05)))
	M.put(root, M.sphere(0.24, 0.5), stone, Transform3D(Basis(Vector3.RIGHT, 0.9), Vector3(0, -0.38, 0.3)))
	for s in [-1.0, 1.0]:
		var sp := PackedVector3Array()
		for k in 41:
			var t := float(k) / 40.0
			var a := t * TAU * 1.25
			var r := 0.38 * (1.0 - t * 0.75)
			sp.append(Vector3(s * (0.42 + 0.3 - cos(a) * r), 0.2 - sin(a) * r * 1.1, 0.1 + t * 0.15))
		M.put(root, M.tube(sp, func(t): return Vector2.ONE * (0.13 * (1.0 - t) + 0.03), 12, Vector3(0, 0, 1), false, func(t, _a): return Color(1.0, 0.82, 0.42) if int(t * 24.0) % 2 == 0 else Color(0.8, 0.58, 0.22)), M.painted(0.25, 0.9))
		M.put(root, M.sphere(0.05), M.mat(GRANITE, 0.2), Transform3D(Basis(), Vector3(0.17 * s, 0.05, 0.42)))
	M.put(root, M.box(Vector3(0.12, 0.35, 0.1)), _gold(), Transform3D(Basis(), Vector3(0, -0.72, 0.28)))

static func _m_hieracosphinx(root: Node3D) -> void:
	# a falcon-headed sphinx's head: brown feathered head, a hooked beak, the
	# falcon's dark malar stripe, a nemes behind
	_nemes(root, 0.42)
	var feather := M.feathers()
	var fc := func(i: int, a: float) -> Color:
		var y := float(i) / 20.0
		return Color(0.16, 0.08, 0.03).lerp(Color(0.85, 0.75, 0.55), clampf((0.3 - y) * 3.0, 0.0, 1.0) * clampf(sin(a), 0.0, 1.0))
	var prof := []
	for i in 21:
		var t := float(i) / 20.0
		prof.append(Vector2(0.45 * sin(PI * clampf(t, 0.02, 0.98)) ** 0.8, lerpf(-0.5, 0.5, t)))
	M.put(root, M.lathe(prof, 36, Callable(), fc), feather, Transform3D(Basis(), Vector3(0, 0.05, 0.08)))
	var beak := M.bez(Vector3(0.0, 0.05, 0.45), Vector3(0.0, 0.1, 0.75), Vector3(0.0, -0.1, 0.85), Vector3(0.0, -0.3, 0.7), 16)
	M.put(root, M.tube(beak, func(t): return Vector2.ONE * (0.13 * (1.0 - t) + 0.01), 10, Vector3(0, 0, 1), false, func(t, _a): return Color(0.95, 0.75, 0.2).lerp(Color(0.12, 0.1, 0.1), clampf((t - 0.4) * 2.5, 0.0, 1.0))), M.painted(0.25, 0.3))
	for s in [-1.0, 1.0]:
		M.put(root, M.sphere(0.08), M.mat(Color(0.95, 0.7, 0.1), 0.15), Transform3D(Basis(), Vector3(0.22 * s, 0.15, 0.38)))
		M.put(root, M.sphere(0.05), M.mat(GRANITE, 0.1), Transform3D(Basis(), Vector3(0.24 * s, 0.15, 0.44)))
		M.put(root, M.tube(M.line(Vector3(0.24 * s, 0.05, 0.4), Vector3(0.3 * s, -0.3, 0.33), 6), func(t): return Vector2(0.05 * (1.0 - t * 0.5), 0.02), 6), M.mat(Color(0.12, 0.08, 0.06), 0.6))
	root.rotation = Vector3(0, 0.55, 0)

static func _m_sacred_cats(root: Node3D) -> void:
	# a seated black-bronze Bastet cat with a gold earring and collar
	var cat := M.metal(Color(0.12, 0.11, 0.1), 0.3)
	var prof := []
	for i in 17:
		var t := float(i) / 16.0
		prof.append(Vector2(0.42 * (1.0 - t) ** 0.6 * (0.8 + 0.2 * sin(PI * t)) + 0.08, lerpf(-0.95, 0.3, t)))
	M.put(root, M.lathe(prof, 32), cat, Transform3D(Basis().scaled(Vector3(1.0, 1.0, 0.8)), Vector3.ZERO))
	M.put(root, M.sphere(0.25, 0.46), cat, Transform3D(Basis(), Vector3(0, 0.48, 0.05)))
	M.put(root, M.sphere(0.11, 0.16), cat, Transform3D(Basis(), Vector3(0, 0.4, 0.25)))
	for s in [-1.0, 1.0]:
		M.put(root, M.cyl(0.11, 0.0, 0.3, 4), cat, Transform3D(Basis(Vector3(0, 0, 1), -0.25 * s), Vector3(0.15 * s, 0.75, 0.0)))
		M.put(root, M.sphere(0.035), M.glow(Color(0.6, 1.0, 0.35)), Transform3D(Basis(), Vector3(0.09 * s, 0.52, 0.24)))
		# front legs
		M.put(root, M.cyl(0.06, 0.075, 0.75, 12), cat, Transform3D(Basis(), Vector3(0.12 * s, -0.55, 0.32)))
	M.put(root, M.torus(0.045, 0.075), _gold(), Transform3D(Basis(Vector3(0, 0, 1), PI / 2), Vector3(0.24, 0.6, 0.0)))
	M.put(root, M.torus(0.18, 0.24), _gold(), Transform3D(Basis(Vector3.RIGHT, 0.3), Vector3(0, 0.22, 0.04)))
	M.put(root, M.sphere(0.06), M.mat(LAPIS, 0.2), Transform3D(Basis(), Vector3(0, 0.14, 0.27)))
	M.put(root, M.tube(M.bez(Vector3(0.2, -0.9, -0.1), Vector3(0.6, -0.95, 0.1), Vector3(0.6, -0.8, 0.35), Vector3(0.3, -0.9, 0.45), 12), func(t): return Vector2.ONE * (0.05 - 0.02 * t), 8), cat)
	root.rotation = Vector3(0, 0.35, 0)

static func _m_adze_of_wepwawet(root: Node3D) -> void:
	# a carpenter's adze: a bent wooden handle, a copper blade lashed on with
	# leather, wood chips flying
	var wood := M.mat(Color(0.45, 0.28, 0.12), 0.6, "wood")
	M.put(root, M.tube(M.line(Vector3(-0.75, -0.95, 0), Vector3(0.1, 0.65, 0), 8), func(_t): return Vector2.ONE * 0.075, 10), wood)
	M.put(root, M.tube(M.line(Vector3(0.05, 0.6, 0), Vector3(0.55, 0.25, 0), 6), func(_t): return Vector2.ONE * 0.08, 10), wood)
	var blade := PackedVector2Array([Vector2(-0.08, 0.0), Vector2(0.08, 0.0), Vector2(0.14, -0.6), Vector2(0.0, -0.66), Vector2(-0.14, -0.6)])
	_slab(root, blade, 0.03, M.metal(COPPER, 0.25), Transform3D(Basis(Vector3(0, 0, 1), 0.6), Vector3(0.5, 0.35, 0.09)))
	for k in 4:
		M.put(root, M.torus(0.07, 0.11), M.mat(Color(0.3, 0.16, 0.08), 0.8, "rough"), M.along(Vector3(0.24 + k * 0.08, 0.53 - k * 0.055, 0.0), Vector3(1.0, -0.7, 0)))
	var rng := RandomNumberGenerator.new()
	rng.seed = 41
	for k in 6:
		var p := Vector3(rng.randf_range(0.3, 0.95), rng.randf_range(-0.85, -0.3), rng.randf_range(0.0, 0.3))
		M.put(root, M.box(Vector3(0.12, 0.04, 0.05)), M.mat(Color(0.82, 0.62, 0.35), 0.7), Transform3D(Basis(Vector3(0, 0, 1), rng.randf_range(-1.5, 1.5)), p))

# ---- Ptah ---------------------------------------------------------------------

static func _m_scalloped_axe(root: Node3D) -> void:
	# the Egyptian scalloped (epsilon) axe: a bronze blade with three lugs
	# lashed to a long haft, its cutting edge in three scallops
	var wood := M.mat(Color(0.4, 0.24, 0.1), 0.6, "wood")
	M.put(root, M.tube(M.line(Vector3(-0.35, -1.0, 0), Vector3(0.05, 1.0, 0), 10), func(_t): return Vector2.ONE * 0.06, 10), wood)
	var poly := PackedVector2Array()
	for k in 25:
		var t := float(k) / 24.0
		var y := lerpf(-0.5, 0.5, t)
		var x := 0.62 + 0.12 * sin(t * PI) + 0.07 * absf(sin(t * PI * 3.0))
		poly.append(Vector2(x, y))
	poly.append_array(PackedVector2Array([Vector2(0.1, 0.32), Vector2(0.0, 0.42), Vector2(0.0, 0.22), Vector2(0.1, 0.12), Vector2(0.0, 0.05), Vector2(0.0, -0.05), Vector2(0.1, -0.12), Vector2(0.0, -0.22), Vector2(0.0, -0.42), Vector2(0.1, -0.32)]))
	poly.reverse()
	_slab(root, poly, 0.035, M.metal(Color(0.95, 0.66, 0.32), 0.16), Transform3D(Basis(Vector3(0, 0, 1), -0.2), Vector3(-0.05, 0.4, 0.06)))
	for y in [0.15, 0.4, 0.65]:
		M.put(root, M.torus(0.06, 0.1), M.mat(Color(0.3, 0.16, 0.08), 0.8, "rough"), M.along(Vector3(-0.35 + (y + 1.0) * 0.2, y, 0), Vector3(0.2, 1.0, 0)))

static func _m_leather_frame_shield(root: Node3D) -> void:
	# a tall Egyptian shield: round-topped, cowhide (white with brown patches)
	# on a wooden frame, a bronze boss plate
	var outline := PackedVector2Array()
	for k in 17:
		var a := PI * float(k) / 16.0
		outline.append(Vector2(cos(a) * 0.55, 0.45 + sin(a) * 0.5))
	outline.append(Vector2(-0.52, -0.95))
	outline.append(Vector2(0.52, -0.95))
	var hide := func(p: Vector2) -> Color:
		var n := sin(p.x * 7.0 + 1.3) * cos(p.y * 5.0) + sin(p.x * 3.0 - p.y * 4.0) * 0.6
		return Color(0.28, 0.15, 0.07) if n > 0.2 else Color(0.94, 0.9, 0.82)
	var acc := M._acc()
	M.extrude_acc(acc, outline, 0.05, 0.015)
	for i in acc.c.size():
		var v: Vector3 = acc.v[i]
		acc.c[i] = hide.call(Vector2(v.x, v.y))
	M.put(root, M._mesh(acc), M.painted(0.7))
	# the cowhide's brown patches
	var spot := M.mat(Color(0.24, 0.12, 0.05), 0.75, "rough")
	for sp in [[-0.25, 0.55, 0.2, 0.14, 0.4], [0.22, 0.1, 0.17, 0.24, -0.3], [-0.2, -0.55, 0.24, 0.16, 0.2], [0.3, -0.7, 0.12, 0.1, 0.0], [0.15, 0.72, 0.1, 0.08, 0.6]]:
		M.put(root, M.sphere(1.0), spot, Transform3D(Basis(Vector3(0, 0, 1), float(sp[4])).scaled(Vector3(float(sp[2]), float(sp[3]), 0.012)), Vector3(float(sp[0]), float(sp[1]), 0.052)))
	var rim := PackedVector3Array()
	for p in outline:
		rim.append(Vector3(p.x, p.y, 0.04))
	rim.append(rim[0])
	M.put(root, M.tube(rim, func(_t): return Vector2.ONE * 0.05, 8), M.mat(Color(0.42, 0.25, 0.1), 0.55, "wood"))
	_slab(root, PackedVector2Array([Vector2(-0.18, 0.15), Vector2(0.18, 0.15), Vector2(0.18, -0.25), Vector2(-0.18, -0.25)]), 0.03, M.metal(M.TIER_METAL.bronze, 0.25), Transform3D(Basis(), Vector3(0, 0, 0.08)))
	root.rotation = Vector3(0, -0.35, 0.08)

static func _m_electrum_bullets(root: Node3D) -> void:
	# a leather sling and a heap of pale-gold electrum bullets, one glinting
	var el := M.metal(Color(0.96, 0.9, 0.6), 0.18)
	var rng := RandomNumberGenerator.new()
	rng.seed = 23
	for k in 9:
		var row := 0 if k < 4 else (1 if k < 7 else 2)
		var off: float = [1.5, 5.0, 7.5][row]
		var x := (k - off) * 0.3
		var p := Vector3(x + 0.15, -0.72 + row * 0.2, 0.1 * sin(k * 1.7))
		M.put(root, M.sphere(0.13, 0.36), el, Transform3D(Basis(Vector3(0, 0, 1), rng.randf_range(1.2, 1.9)), p))
	var cord := M.mat(Color(0.35, 0.2, 0.1), 0.7, "rough")
	M.put(root, M.tube(M.bez(Vector3(-0.9, 0.95, 0), Vector3(-0.8, 0.4, 0.1), Vector3(-0.55, 0.0, 0.2), Vector3(-0.3, -0.1, 0.25), 14), func(_t): return Vector2.ONE * 0.025, 6), cord)
	M.put(root, M.tube(M.bez(Vector3(-0.6, 0.95, 0), Vector3(-0.3, 0.5, 0.1), Vector3(0.1, 0.1, 0.2), Vector3(0.1, -0.1, 0.25), 14), func(_t): return Vector2.ONE * 0.025, 6), cord)
	M.put(root, M.disc(0.24, func(r, _a): return -0.08 * (1.0 - (r / 0.24) ** 2), 8, 24), M.mat(Color(0.45, 0.26, 0.12), 0.7, "rough"), Transform3D(Basis(Vector3.RIGHT, -0.3).scaled(Vector3(1.0, 0.6, 1.0)), Vector3(-0.1, -0.15, 0.25)))
	M.put(root, M.sphere(0.12, 0.3), el, Transform3D(Basis(Vector3(0, 0, 1), 1.5), Vector3(-0.1, -0.1, 0.33)))
	M.put(root, M.sphere(0.06), M.glow(Color(1.0, 1.0, 0.85)), Transform3D(Basis(), Vector3(0.0, -0.05, 0.45)))

static func _m_shaduf(root: Node3D) -> void:
	# the shaduf: a long pole pivoting on a post, a mud counterweight on one
	# end, a leather bucket on a rope over the water on the other
	var wood := M.mat(Color(0.45, 0.3, 0.15), 0.65, "wood")
	M.put(root, M.cyl(0.07, 0.08, 1.3), wood, Transform3D(Basis(), Vector3(0, -0.4, 0)))
	M.put(root, M.cyl(0.07, 0.08, 1.3), wood, Transform3D(Basis(), Vector3(0, -0.4, -0.3)))
	M.put(root, M.box(Vector3(0.12, 0.12, 0.45)), wood, Transform3D(Basis(), Vector3(0, 0.25, -0.15)))
	var a := Vector3(-0.85, -0.05, -0.15)
	var b := Vector3(0.95, 0.75, -0.15)
	M.put(root, M.tube(M.line(a, b, 8), func(_t): return Vector2.ONE * 0.045, 8), wood)
	M.put(root, M.sphere(0.24), M.mat(MUD, 0.9, "rough"), Transform3D(Basis(), a + Vector3(0.05, -0.12, 0)))
	M.put(root, M.tube(M.line(b, b + Vector3(0, -1.05, 0), 6), func(_t): return Vector2.ONE * 0.015, 6), M.mat(Color(0.7, 0.6, 0.4), 0.8))
	M.put(root, M.lathe([Vector2(0.0, -0.18), Vector2(0.14, -0.16), Vector2(0.18, 0.0), Vector2(0.17, 0.05), Vector2(0.0, 0.05)], 24), M.mat(Color(0.4, 0.22, 0.1), 0.6, "rough"), Transform3D(Basis(), b + Vector3(0, -1.15, 0)))
	_water(root, 0.7, Transform3D(Basis(Vector3.RIGHT, -1.25), Vector3(0.6, -1.0, 0.0)), NILE)

# ---- Anubis -------------------------------------------------------------------

static func _m_feet_of_the_jackal(root: Node3D) -> void:
	# Anubis' black jackal head: a long muzzle, tall gold-lined ears, a gold
	# collar, a leaping trail behind
	var black := M.mat(Color(0.05, 0.05, 0.06), 0.3)
	var back := Node3D.new()
	back.transform = Transform3D(Basis(Vector3.UP, PI / 2).scaled(Vector3(0.75, 0.85, 0.75)), Vector3(-0.35, 0.15, 0))
	root.add_child(back)
	_nemes(back, 0.25)
	M.put(root, M.sphere(0.36, 0.62), black, Transform3D(Basis(), Vector3(-0.15, 0.1, 0)))
	M.put(root, M.tube(M.line(Vector3(0.05, 0.02, 0), Vector3(0.8, -0.15, 0), 8), func(t): return Vector2(0.22 * (1.0 - t * 0.6), 0.16 * (1.0 - t * 0.5)), 12, Vector3(0, 1, 0)), black)
	M.put(root, M.sphere(0.06), M.mat(Color(0.02, 0.02, 0.02), 0.1), Transform3D(Basis(), Vector3(0.82, -0.12, 0)))
	for s in [-1.0, 1.0]:
		var ear := PackedVector2Array([Vector2(-0.14, 0.0), Vector2(0.14, 0.0), Vector2(0.02, 0.62)])
		var xf := Transform3D(Basis(Vector3.UP, 0.3 * s) * Basis(Vector3(0, 0, 1), 0.25), Vector3(-0.25, 0.32, 0.12 * s))
		_slab(root, ear, 0.035, black, xf)
		_slab(root, PackedVector2Array([Vector2(-0.07, 0.04), Vector2(0.07, 0.04), Vector2(0.01, 0.45)]), 0.01, _gold(), xf * Transform3D(Basis(), Vector3(0, 0, 0.04 * s)))
	M.put(root, M.sphere(0.05), M.glow(Color(1.0, 0.85, 0.3)), Transform3D(Basis(), Vector3(0.05, 0.18, 0.2)))
	M.put(root, M.torus(0.22, 0.32), _gold(), Transform3D(Basis(Vector3(0, 0, 1), 0.3), Vector3(-0.3, -0.3, 0)))
	M.wisps(root, [M.bez(Vector3(-0.5, -0.7, -0.1), Vector3(-0.9, -0.6, -0.1), Vector3(-0.8, -0.95, -0.1), Vector3(-1.1, -0.9, -0.1), 12)], 0.12, Color(1.0, 0.9, 0.55), Color(0.6, 0.35, 0.1))
	root.rotation = Vector3(0, -0.25, 0)

static func _m_serpent_spear(root: Node3D) -> void:
	# a spear with a green asp coiled up its shaft, venom on the blade
	var a := Vector3(-0.85, -1.0, 0)
	var b := Vector3(0.75, 1.0, 0)
	M.spear(root, a, b, M.metal(M.TIER_METAL.bronze, 0.22), 0.55, 0.16)
	var d := (b - a).normalized()
	var n := Node3D.new()
	n.transform = M.along(a + d * 0.6, d)
	root.add_child(n)
	var snake := func(t: float, _a: float) -> Color:
		return Color(0.2, 0.55, 0.12) if int(t * 30.0) % 3 != 0 else Color(0.85, 0.75, 0.2)
	var h := M.helix(0.13, 0.0, 1.35, 2.2, 90)
	M.put(n, M.tube(h, func(t): return Vector2.ONE * lerpf(0.02, 0.06, clampf(t * 4.0, 0.0, 1.0)), 10, Vector3(0, 0, 1), false, snake), M.painted(0.3))
	var hd: Vector3 = h[h.size() - 1]
	M.put(n, M.sphere(0.09, 0.13), M.mat(Color(0.2, 0.55, 0.12), 0.3), Transform3D(Basis(), hd + Vector3(0.05, 0.08, 0.05)))
	M.put(n, M.sphere(0.02), M.glow(Color(1.0, 0.9, 0.2)), Transform3D(Basis(), hd + Vector3(0.1, 0.12, 0.1)))
	var tip := b - d * 0.3
	M.put(root, M.sphere(0.05, 0.12), M.glow(Color(0.5, 1.0, 0.3)), Transform3D(Basis(), tip + Vector3(0.08, -0.12, 0.06)))

static func _m_necropolis(root: Node3D) -> void:
	# a step pyramid of pale limestone over the desert, a dark doorway, the
	# Monuments' favor rising from it as a gold glow
	var stone := M.mat(Color(0.9, 0.8, 0.6), 0.85, "rough")
	M.put(root, M.box(Vector3(2.2, 0.1, 1.4)), M.mat(SAND, 0.95, "rough"), Transform3D(Basis(), Vector3(0, -0.75, 0)))
	for k in 5:
		var w := 1.7 - k * 0.32
		M.put(root, M.box(Vector3(w, 0.28, w * 0.75)), stone, Transform3D(Basis(), Vector3(0, -0.56 + k * 0.28, 0)))
	M.put(root, M.box(Vector3(0.16, 0.22, 0.05)), M.mat(Color(0.05, 0.04, 0.03), 0.9), Transform3D(Basis(), Vector3(0, -0.59, 0.66)))
	M.put(root, M.sphere(0.2), M.glow(Color(1.0, 0.85, 0.4)), Transform3D(Basis(), Vector3(0, 0.95, 0)))
	M.wisps(root, [M.bez(Vector3(0, 0.75, 0), Vector3(-0.2, 0.9, 0), Vector3(0.2, 1.05, 0), Vector3(0.0, 1.25, 0), 12)], 0.14, Color(1.0, 0.95, 0.7), Color(0.9, 0.6, 0.2))
	root.rotation = Vector3(0.25, 0.45, 0)

# ---- Sobek --------------------------------------------------------------------

static func _m_sun_dried_mud_brick(root: Node3D) -> void:
	# a stack of sun-dried mud bricks in a running bond, straw in the mud
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for row in 4:
		var n := 3 if row % 2 == 0 else 2
		for k in n:
			var x := (k - (n - 1) * 0.5) * 0.62
			var c := MUD.lerp(Color(0.72, 0.55, 0.35), rng.randf_range(0.0, 0.6))
			M.put(root, M.box(Vector3(0.58, 0.26, 0.4)), M.mat(c, 0.95, "rough"), Transform3D(Basis(Vector3.UP, rng.randf_range(-0.05, 0.05)), Vector3(x, -0.75 + row * 0.28, 0)))
	var straw := M.mat(Color(0.95, 0.82, 0.45), 0.7)
	for k in 10:
		var p := Vector3(rng.randf_range(-0.8, 0.8), -0.75 + rng.randi_range(0, 3) * 0.28 + rng.randf_range(-0.08, 0.08), 0.21)
		M.put(root, M.box(Vector3(0.12, 0.012, 0.012)), straw, Transform3D(Basis(Vector3(0, 0, 1), rng.randf_range(-1.0, 1.0)), p))
	M.put(root, M.box(Vector3(0.36, 0.06, 0.26)), M.mat(Color(0.35, 0.22, 0.1), 0.6, "wood"), Transform3D(Basis(Vector3(0, 0, 1), 0.25), Vector3(0.45, 0.5, 0.15)))
	root.rotation = Vector3(0.3, 0.5, 0)

static func _m_crocodilopolis(root: Node3D) -> void:
	# Sobek's crocodile: jaws agape full of teeth, the sun disc between gold
	# plumes above
	var hide := M.mat(Color(0.22, 0.32, 0.14), 0.55, "rough")
	var up := PackedVector2Array([Vector2(-0.5, 0.0), Vector2(0.9, 0.08), Vector2(0.95, 0.16), Vector2(0.3, 0.3), Vector2(-0.4, 0.42), Vector2(-0.6, 0.25)])
	_slab(root, up, 0.2, hide, Transform3D(Basis(Vector3(0, 0, 1), 0.25), Vector3(-0.2, -0.15, 0)))
	var lo := PackedVector2Array([Vector2(-0.5, 0.0), Vector2(-0.6, -0.2), Vector2(0.85, -0.1), Vector2(0.9, 0.0)])
	_slab(root, lo, 0.17, hide, Transform3D(Basis(Vector3(0, 0, 1), -0.2), Vector3(-0.2, -0.3, 0)))
	var tooth := M.mat(IVORY, 0.4)
	for k in 6:
		var x := -0.15 + k * 0.15
		M.put(root, M.cyl(0.03, 0.0, 0.12, 6), tooth, Transform3D(Basis(Vector3.RIGHT, PI), Vector3(x, -0.12 + x * 0.25 - 0.06, 0.12)))
		M.put(root, M.cyl(0.03, 0.0, 0.1, 6), tooth, Transform3D(Basis(), Vector3(x, -0.33 - x * 0.2 + 0.07, 0.1)))
	M.put(root, M.sphere(0.1), hide, Transform3D(Basis(), Vector3(-0.55, 0.22, 0.12)))
	M.put(root, M.sphere(0.05), M.glow(Color(1.0, 0.8, 0.2)), Transform3D(Basis(), Vector3(-0.53, 0.25, 0.2)))
	M.put(root, M.disc(0.28, func(r, _a): return 0.06 * (1.0 - (r / 0.28) ** 2), 10, 36), M.mat(Color(0.85, 0.12, 0.05), 0.25), Transform3D(Basis(), Vector3(-0.45, 0.72, 0)))
	M.put(root, M.torus(0.27, 0.33), _gold(), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(-0.45, 0.72, 0)))
	for s in [-1.0, 1.0]:
		M.put(root, M.tube(M.line(Vector3(-0.45 + 0.38 * s, 0.4, -0.05), Vector3(-0.45 + 0.42 * s, 1.15, -0.05), 8), func(t): return Vector2(0.08 * (1.0 - t * 0.6), 0.02), 6), _gold(0.3))

static func _m_dark_water(root: Node3D) -> void:
	# a stone basin of dark, still water, a glowing drop falling into it
	M.put(root, M.torus(0.75, 0.95), M.mat(Color(0.6, 0.55, 0.48), 0.85, "rough"), Transform3D(Basis().scaled(Vector3(1, 1.6, 1)), Vector3(0, -0.45, 0)))
	_water(root, 0.8, Transform3D(Basis(Vector3.RIGHT, -PI / 2), Vector3(0, -0.4, 0)), Color(0.03, 0.1, 0.2), 4.0)
	M.put(root, M.torus(0.25, 0.3), M.glow(Color(0.4, 0.85, 1.0)), Transform3D(Basis(), Vector3(0, -0.37, 0)))
	M.put(root, M.torus(0.48, 0.52), M.glow(Color(0.25, 0.6, 0.85)), Transform3D(Basis(), Vector3(0, -0.38, 0)))
	M.put(root, M.sphere(0.13), M.mat(Color(0.3, 0.75, 1.0), 0.05), Transform3D(Basis(), Vector3(0, 0.35, 0)))
	M.put(root, M.cyl(0.0, 0.12, 0.24, 16), M.mat(Color(0.3, 0.75, 1.0), 0.05), Transform3D(Basis(), Vector3(0, 0.55, 0)))
	M.put(root, M.sphere(0.06), M.glow(Color(0.8, 0.95, 1.0)), Transform3D(Basis(), Vector3(0.03, 0.38, 0.1)))
	root.rotation = Vector3(0.45, 0, 0)

static func _m_solar_barque(root: Node3D) -> void:
	# Ra's solar barque: a gilded papyrus boat with a cabin, the sun disc
	# riding on it
	_hull(root, -1.0, 1.0, -0.45, M.mat(Color(0.75, 0.6, 0.3), 0.6, "rough"))
	M.put(root, M.box(Vector3(0.6, 0.3, 0.3)), M.mat(Color(0.6, 0.12, 0.06), 0.5), Transform3D(Basis(), Vector3(-0.2, -0.2, 0)))
	M.put(root, M.box(Vector3(0.66, 0.05, 0.36)), _gold(), Transform3D(Basis(), Vector3(-0.2, -0.04, 0)))
	M.put(root, M.sphere(0.36), M.glow(Color(1.0, 0.82, 0.3)), Transform3D(Basis(), Vector3(0.3, 0.3, 0)))
	M.put(root, M.torus(0.36, 0.44), _gold(), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0.3, 0.3, 0)))
	_water(root, 1.0, Transform3D(Basis(Vector3.RIGHT, -1.3), Vector3(0, -0.62, 0)), NILE)

# ---- Sekhmet ------------------------------------------------------------------

static func _m_bone_bow(root: Node3D) -> void:
	# a recurved composite bow of bone and horn, sinew-bound, strung
	var pts := PackedVector3Array()
	for k in 41:
		var t := float(k) / 40.0
		var y := lerpf(-1.0, 1.0, t)
		var x := 0.45 * cos(t * PI - PI / 2) - 0.18 * absf(y) ** 6 * 1.6
		pts.append(Vector3(x * 1.0 - 0.15, y, 0))
	M.put(root, M.tube(pts, func(t): return Vector2.ONE * (0.06 - 0.03 * absf(t - 0.5) * 2.0), 10, Vector3(0, 0, 1), false, func(t, _a): return IVORY if int(t * 16.0) % 4 != 0 else Color(0.55, 0.4, 0.25)), M.painted(0.35))
	M.put(root, M.tube(M.line(pts[1], pts[39], 4), func(_t): return Vector2.ONE * 0.01, 6), M.mat(Color(0.9, 0.85, 0.7), 0.6))
	M.put(root, M.torus(0.05, 0.085), M.mat(Color(0.5, 0.1, 0.05), 0.6), M.along(pts[20], Vector3.UP))
	M.arrow(root, Vector3(-0.3, -0.75, 0.05), Vector3(0.75, 0.75, 0.05), M.metal(M.TIER_METAL.bronze, 0.25), M.mat(Color(0.6, 0.45, 0.25), 0.6, "wood"), Color(0.75, 0.15, 0.08))

static func _m_slings_of_the_sun(root: Node3D) -> void:
	# a sling whirled round, its pouch holding a stone ablaze like the sun
	var cord := M.mat(Color(0.4, 0.22, 0.1), 0.7, "rough")
	var arc := PackedVector3Array()
	for k in 33:
		var a := lerpf(-0.3, PI * 1.25, float(k) / 32.0)
		arc.append(Vector3(cos(a) * 0.75 - 0.1, sin(a) * 0.75 - 0.1, 0.0))
	var trail := M._acc()
	M.tube_acc(trail, arc, func(t): return Vector2(0.05 + 0.1 * t, 0.01), 6, Vector3(0, 0, 1), false, func(t, _a): return Color(1.0, 0.7, 0.2, t * 0.6))
	M.put(root, M._mesh(trail), M.glow(Color.WHITE, true), Transform3D(Basis(), Vector3(0, 0, -0.1)))
	var hand := Vector3(-0.75, -0.85, 0.1)
	var stone := Vector3(0.55, 0.35, 0.15)
	M.put(root, M.tube(M.bez(hand, hand + Vector3(0.3, 0.2, 0), stone + Vector3(-0.3, -0.25, 0), stone + Vector3(-0.1, -0.15, 0), 12), func(_t): return Vector2.ONE * 0.025, 6), cord)
	M.put(root, M.tube(M.bez(hand, hand + Vector3(0.45, 0.05, 0), stone + Vector3(-0.1, -0.4, 0), stone + Vector3(0.05, -0.18, 0), 12), func(_t): return Vector2.ONE * 0.025, 6), cord)
	M.put(root, M.disc(0.2, func(r, _a): return -0.08 * (1.0 - (r / 0.2) ** 2), 8, 24), M.mat(Color(0.45, 0.26, 0.12), 0.7, "rough"), Transform3D(Basis(Vector3(0, 0, 1), 0.6), stone + Vector3(0, -0.1, -0.05)))
	var rays := M._acc()
	for k in 12:
		var a := TAU * k / 12.0
		var d := Vector3(cos(a), sin(a), 0)
		M.tube_acc(rays, M.line(d * 0.14, d * (0.42 if k % 2 == 0 else 0.3), 4), func(t): return Vector2(0.045 * (1.0 - t) + 0.005, 0.01), 6, Vector3(0, 0, 1), false, func(t, _a): return Color(1.0, 0.85, 0.4, 1.0 - t))
	M.put(root, M._mesh(rays), M.glow(Color.WHITE, true), Transform3D(Basis(), stone))
	M.put(root, M.sphere(0.15), M.glow(Color(1.0, 0.9, 0.5)), Transform3D(Basis(), stone))
	M.put(root, M.sphere(0.07), M.mat(Color(0.3, 0.2, 0.12), 0.8, "rough"), Transform3D(Basis(), hand))

static func _m_crimson_linen(root: Node3D) -> void:
	# folded crimson linen with gold-thread borders, one length draped over
	var red := M.mat(Color(0.62, 0.05, 0.06), 0.85, "rough")
	for k in 3:
		var y := -0.75 + k * 0.2
		M.put(root, M.box(Vector3(1.5 - k * 0.06, 0.18, 0.9)), red, Transform3D(Basis(Vector3.UP, 0.04 * k), Vector3(0, y, 0)))
		M.put(root, M.box(Vector3(1.52 - k * 0.06, 0.03, 0.92)), _gold(0.35), Transform3D(Basis(Vector3.UP, 0.04 * k), Vector3(0, y + 0.05, 0)))
	var sheet := []
	for j in 15:
		var v := float(j) / 14.0
		var row := PackedVector3Array()
		for i in 13:
			var u := lerpf(-0.6, 0.6, float(i) / 12.0)
			var y := -0.15 + 0.9 * (1.0 - v) - 0.15 * sin(u * 5.0) * v
			row.append(Vector3(u + 0.12 * v, y, 0.5 * v + 0.08 * sin(u * 8.0 + v * 3.0)))
		sheet.append(row)
	var acc := M._acc()
	M._grid(acc, sheet, false, PackedVector3Array([Vector3(0, 0, -5)]))
	var mi := M.put(root, M._mesh(acc), M.mat(Color(0.75, 0.08, 0.08), 0.8))
	(mi.material_override as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
	M.put(root, M.sphere(0.12), M.glow(Color(1.0, 0.4, 0.3)), Transform3D(Basis(), Vector3(0.0, 0.85, 0.0)))
	root.rotation = Vector3(0.3, 0.35, 0)

static func _m_force_of_the_west_wind(root: Node3D) -> void:
	# a catapult's boulder flung on the west wind, streams of air round it
	M.put(root, M.lathe([Vector2(0.0, -0.45), Vector2(0.3, -0.38), Vector2(0.45, -0.1), Vector2(0.42, 0.2), Vector2(0.25, 0.4), Vector2(0.0, 0.44)], 20, func(a, i): return 1.0 + 0.1 * sin(a * 3.0 + i) + 0.06 * cos(a * 7.0)), M.mat(Color(0.55, 0.5, 0.45), 0.9, "rough"), Transform3D(Basis(), Vector3(0.35, 0.15, 0)))
	M.wisps(root, [M.bez(Vector3(-1.0, 0.5, 0.2), Vector3(-0.5, 0.6, 0.2), Vector3(-0.1, 0.55, 0.3), Vector3(0.35, 0.62, 0.3), 14),
		M.bez(Vector3(-1.05, 0.1, 0.3), Vector3(-0.6, 0.15, 0.3), Vector3(-0.3, 0.05, 0.4), Vector3(0.0, 0.1, 0.45), 14),
		M.bez(Vector3(-1.0, -0.35, 0.2), Vector3(-0.5, -0.4, 0.2), Vector3(-0.1, -0.25, 0.3), Vector3(0.3, -0.35, 0.3), 14),
		M.bez(Vector3(-0.8, -0.75, 0.1), Vector3(-0.3, -0.8, 0.1), Vector3(0.2, -0.6, 0.1), Vector3(0.7, -0.5, 0.1), 14)], 0.12, Color(0.9, 0.97, 1.0), Color(0.45, 0.65, 0.9))
	M.put(root, M.sphere(0.1), M.glow(Color(1.0, 0.75, 0.3)), Transform3D(Basis(), Vector3(0.75, 0.45, 0.3)))

# ---- Nephthys -----------------------------------------------------------------

static func _m_funeral_rites(root: Node3D) -> void:
	# an alabaster canopic jar with a gold-and-lapis human-headed lid, the
	# gold the fallen refund at its foot
	var ala := M.mat(Color(0.92, 0.86, 0.72), 0.3)
	var prof := []
	for i in 17:
		var t := float(i) / 16.0
		prof.append(Vector2(0.32 + 0.16 * sin(PI * t * 0.85), lerpf(-0.95, 0.2, t)))
	prof.append(Vector2(0.0, 0.2))
	M.put(root, M.lathe(prof, 36), ala)
	M.put(root, M.box(Vector3(0.3, 0.4, 0.02)), M.mat(Color(0.25, 0.4, 0.55), 0.6), Transform3D(Basis(), Vector3(0, -0.35, 0.47)))
	_nemes(root, 0.62)
	M.put(root, M.sphere(0.26, 0.52), M.mat(Color(0.82, 0.62, 0.42), 0.4), Transform3D(Basis(), Vector3(0, 0.45, 0.05)))
	for s in [-1.0, 1.0]:
		M.put(root, M.sphere(0.035), M.mat(GRANITE, 0.1), Transform3D(Basis(), Vector3(0.09 * s, 0.5, 0.27)))
	for k in 3:
		M.coin(root, Transform3D(Basis(Vector3.RIGHT, 1.3), Vector3(0.55 + k * 0.05, -0.95 + k * 0.06, 0.25)), 0.18)
	M.coin(root, Transform3D(Basis(Vector3.RIGHT, 0.4), Vector3(-0.55, -0.85, 0.3)), 0.18)

static func _m_spirit_of_maat(root: Node3D) -> void:
	# the feather of Maat standing on a gold scale pan, glowing truth
	var vane := func(t: float, a: float) -> Color:
		return LINEN.lerp(Color(0.55, 0.5, 0.42), clampf(absf(sin(t * 45.0 + a * 0.5)) ** 3.0, 0.0, 1.0))
	var path := M.bez(Vector3(0, -0.55, 0), Vector3(0.0, 0.25, 0), Vector3(0.25, 0.95, 0), Vector3(0.62, 0.72, 0), 30)
	M.put(root, M.tube(path, func(t): var w: float = (0.12 + 0.24 * t) * sin(PI * clampf(t * 0.92 + 0.08, 0.0, 1.0)) ** 0.4; return Vector2(w, 0.02), 4, Vector3(0, 0, 1), true, vane), M.painted(0.6))
	M.put(root, M.tube(path, func(_t): return Vector2.ONE * 0.02, 6), M.mat(Color(0.9, 0.85, 0.7), 0.4), Transform3D(Basis(), Vector3(0, 0, 0.03)))
	M.put(root, M.lathe([Vector2(0.0, 0.0), Vector2(0.6, 0.0), Vector2(0.65, 0.08), Vector2(0.0, -0.12)], 36), _gold(0.2), Transform3D(Basis(), Vector3(0, -0.62, 0)))
	for s in [-1.0, 1.0]:
		M.put(root, M.tube(M.line(Vector3(0.6 * s, -0.58, 0), Vector3(0.05 * s, 0.25, 0), 6), func(_t): return Vector2.ONE * 0.012, 6), _gold(0.3))
	M.put(root, M.sphere(0.5), M.glow(Color(1.0, 0.95, 0.75, 0.25), true), Transform3D(Basis(), Vector3(0.05, 0.3, -0.4)))

static func _m_nebty(root: Node3D) -> void:
	# the Two Ladies: Nekhbet's vulture wings spread behind Wadjet's rearing
	# gold cobra
	var wing := func(s: float) -> PackedVector2Array:
		var p := PackedVector2Array([Vector2(0.0, 0.15)])
		for k in 7:
			var a := lerpf(0.55, -0.35, float(k) / 6.0)
			var r := 0.95 - absf(k - 2) * 0.05
			p.append(Vector2(s * cos(a) * r, sin(a) * r + 0.1))
			p.append(Vector2(s * cos(a - 0.07) * (r - 0.12), sin(a - 0.07) * (r - 0.12) + 0.1))
		p.append(Vector2(0.0, -0.15))
		return p
	for s in [-1.0, 1.0]:
		var poly: PackedVector2Array = wing.call(s)
		var acc := M._acc()
		M.extrude_acc(acc, poly, 0.03, 0.01)
		for i in acc.c.size():
			var v: Vector3 = acc.v[i]
			var r := Vector2(v.x, v.y - 0.1).length()
			acc.c[i] = LAPIS.lightened(0.1) if r > 0.7 else (GOLD if r > 0.4 else Color(0.75, 0.12, 0.08))
		M.put(root, M._mesh(acc), M.painted(0.3, 0.5), Transform3D(Basis(), Vector3(0, 0.0, -0.2)))
	var cob := M.bez(Vector3(0.2, -0.95, 0.1), Vector3(-0.35, -0.75, 0.15), Vector3(0.25, -0.4, 0.2), Vector3(0.0, 0.05, 0.2), 20)
	M.put(root, M.tube(cob, func(t): return Vector2.ONE * lerpf(0.05, 0.1, t), 10), _gold(0.2))
	var hood := PackedVector2Array()
	for k in 24:
		var a := TAU * k / 24.0
		hood.append(Vector2(cos(a) * 0.24 * (1.0 + 0.2 * sin(a)), sin(a) * 0.36))
	_slab(root, hood, 0.04, _gold(0.2), Transform3D(Basis(), Vector3(0.0, 0.3, 0.22)))
	_slab(root, _ellipse(0.0, 0.0, 0.11, 0.2, 20), 0.02, M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(0.0, 0.27, 0.27)))
	M.put(root, M.sphere(0.1, 0.14), _gold(0.2), Transform3D(Basis(), Vector3(0.0, 0.68, 0.25)))
	for s in [-1.0, 1.0]:
		M.put(root, M.sphere(0.022), M.glow(Color(1.0, 0.3, 0.2)), Transform3D(Basis(), Vector3(0.045 * s, 0.7, 0.33)))

static func _m_funeral_barge(root: Node3D) -> void:
	# a dark funeral barge on black water carrying a gilded sarcophagus
	_hull(root, -1.0, 1.0, -0.4, M.mat(Color(0.22, 0.14, 0.08), 0.6, "wood"), 0.45)
	var sarc := PackedVector2Array()
	for k in 13:
		var a := PI * 0.5 - PI * float(k) / 12.0
		sarc.append(Vector2(0.45 + cos(a) * 0.14, sin(a) * 0.14))
	sarc.append(Vector2(-0.5, -0.12))
	sarc.append(Vector2(-0.5, 0.12))
	M.put(root, M.extrude(sarc, 0.12, 0.03), _gold(0.25), Transform3D(Basis(), Vector3(0, -0.12, 0)))
	M.put(root, M.box(Vector3(0.6, 0.06, 0.26)), M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(-0.05, -0.12, 0.0)))
	for x in [-0.55, 0.55]:
		M.put(root, M.cyl(0.025, 0.025, 0.55), M.mat(Color(0.22, 0.14, 0.08), 0.6, "wood"), Transform3D(Basis(), Vector3(x, 0.0, 0)))
	M.put(root, M.box(Vector3(1.2, 0.04, 0.4)), M.mat(Color(0.88, 0.85, 0.75), 0.8), Transform3D(Basis(), Vector3(0, 0.28, 0)))
	_water(root, 1.0, Transform3D(Basis(Vector3.RIGHT, -1.3), Vector3(0, -0.58, 0)), Color(0.04, 0.08, 0.14))
	M.put(root, M.sphere(0.12), M.glow(Color(0.6, 0.85, 1.0)), Transform3D(Basis(), Vector3(-0.7, 0.55, 0)))

# ---- Osiris -------------------------------------------------------------------

static func _m_new_kingdom(root: Node3D) -> void:
	# the pschent, the double crown of a united Egypt: the white crown's bulb
	# inside the red crown with its curl, a gold uraeus on the brow
	var white := M.mat(Color(0.95, 0.93, 0.86), 0.45)
	var red := M.mat(Color(0.72, 0.08, 0.06), 0.5)
	var prof := []
	for i in 17:
		var t := float(i) / 16.0
		prof.append(Vector2(0.3 * (1.0 - t * 0.55) + 0.06 * sin(PI * t), lerpf(-0.2, 0.85, t)))
	prof.append(Vector2(0.0, 0.92))
	M.put(root, M.lathe(prof, 32), white)
	M.put(root, M.sphere(0.12), white, Transform3D(Basis(), Vector3(0, 0.88, 0)))
	M.put(root, M.lathe([Vector2(0.0, -0.75), Vector2(0.5, -0.75), Vector2(0.5, -0.1), Vector2(0.45, -0.1), Vector2(0.42, -0.72), Vector2(0.0, -0.72)], 36), red)
	M.put(root, M.box(Vector3(0.3, 1.0, 0.12)), red, Transform3D(Basis(), Vector3(0, 0.0, -0.45)))
	M.put(root, M.tube(M.bez(Vector3(0.05, -0.15, 0.42), Vector3(0.1, 0.25, 0.6), Vector3(0.55, 0.35, 0.6), Vector3(0.45, 0.1, 0.5), 16), func(t): return Vector2.ONE * 0.03 * (1.0 - t * 0.4), 6), _gold(0.25))
	M.put(root, M.tube(M.bez(Vector3(0, -0.72, 0.5), Vector3(0.0, -0.5, 0.58), Vector3(0.0, -0.4, 0.55), Vector3(0.0, -0.3, 0.6), 10), func(t): return Vector2.ONE * lerpf(0.06, 0.04, t), 8), _gold(0.2))
	M.put(root, M.sphere(0.06), _gold(0.2), Transform3D(Basis(), Vector3(0.0, -0.28, 0.62)))
	M.put(root, M.torus(0.48, 0.54), _gold(0.25), Transform3D(Basis(), Vector3(0, -0.74, 0)))
	root.rotation = Vector3(0.1, 0.55, 0)

static func _m_desert_wind(root: Node3D) -> void:
	# golden dunes under a racing sand wind
	var rows := []
	for j in 13:
		var z := lerpf(-1.0, 1.0, float(j) / 12.0)
		var row := PackedVector3Array()
		for i in 25:
			var x := lerpf(-1.2, 1.2, float(i) / 24.0)
			row.append(Vector3(x, -0.6 + 0.3 * sin(x * 2.4 + z * 1.5) * (0.6 + 0.4 * cos(z * 2.0)), z))
		rows.append(row)
	var acc := M._acc()
	M._grid(acc, rows, false, PackedVector3Array([Vector3(0, -5, 0)]))
	M.put(root, M._mesh(acc), M.mat(Color(0.5, 0.3, 0.1), 0.95, "rough"))
	M.wisps(root, [M.bez(Vector3(-1.1, -0.2, 0.4), Vector3(-0.4, 0.2, 0.4), Vector3(0.2, -0.1, 0.5), Vector3(1.0, 0.3, 0.5), 16),
		M.bez(Vector3(-1.0, 0.3, 0.2), Vector3(-0.3, 0.6, 0.3), Vector3(0.3, 0.35, 0.3), Vector3(1.1, 0.7, 0.3), 16),
		M.bez(Vector3(-0.9, 0.75, 0.1), Vector3(-0.2, 1.0, 0.1), Vector3(0.4, 0.8, 0.1), Vector3(1.0, 1.0, 0.1), 16)], 0.11, Color(1.0, 0.88, 0.6), Color(0.75, 0.5, 0.2))
	M.put(root, M.sphere(0.2), M.glow(Color(1.0, 0.7, 0.3)), Transform3D(Basis(), Vector3(0.75, 0.75, -0.6)))
	root.rotation = Vector3(0.35, 0, 0)

static func _m_atef_crown(root: Node3D) -> void:
	# Osiris' atef: the white crown flanked by two curling ostrich plumes on
	# ram horns, a gold sun disc on its tip
	var white := M.mat(Color(0.95, 0.93, 0.86), 0.45)
	var prof := []
	for i in 17:
		var t := float(i) / 16.0
		prof.append(Vector2(0.3 * (1.0 - t * 0.6) + 0.05 * sin(PI * t), lerpf(-0.75, 0.6, t)))
	prof.append(Vector2(0.0, 0.66))
	M.put(root, M.lathe(prof, 32, Callable(), func(i, _a): return Color(0.95, 0.93, 0.86) if i % 3 != 0 else GOLD), M.painted(0.4))
	M.put(root, M.sphere(0.13), _gold(0.2), Transform3D(Basis(), Vector3(0, 0.72, 0)))
	var plume := func(t: float, _a: float) -> Color:
		return LINEN.lerp(Color(0.7, 0.66, 0.6), absf(sin(t * 40.0)) * 0.5)
	for s in [-1.0, 1.0]:
		var p := M.bez(Vector3(0.32 * s, -0.7, 0), Vector3(0.5 * s, -0.2, 0), Vector3(0.42 * s, 0.45, 0), Vector3(0.6 * s, 0.85, 0), 24)
		M.put(root, M.tube(p, func(t): var w: float = 0.15 * sin(PI * clampf(t * 0.9 + 0.1, 0.0, 1.0)) ** 0.5 + 0.02; return Vector2(w, 0.02), 4, Vector3(0, 0, 1), true, plume), M.painted(0.6))
		var h := PackedVector3Array()
		for k in 21:
			var t := float(k) / 20.0
			h.append(Vector3(s * (0.25 + t * 0.7), -0.75 + 0.12 * sin(t * PI * 2.0), 0.1))
		M.put(root, M.tube(h, func(t): return Vector2.ONE * (0.07 * (1.0 - t) + 0.015), 8), _gold(0.25))
	root.rotation = Vector3(0.05, 0.3, 0)

# ---- Horus --------------------------------------------------------------------

static func _m_axe_of_vengeance(root: Node3D) -> void:
	# a crescent battle axe, its edge glowing a vengeful red, gold-banded haft
	var wood := M.mat(Color(0.35, 0.2, 0.08), 0.6, "wood")
	M.put(root, M.tube(M.line(Vector3(0.45, -1.0, 0), Vector3(-0.2, 0.95, 0), 10), func(_t): return Vector2.ONE * 0.06, 10), wood)
	for k in 3:
		M.put(root, M.torus(0.055, 0.085), _gold(), M.along(Vector3(0.45, -1.0, 0).lerp(Vector3(-0.2, 0.95, 0), 0.15 + k * 0.08), Vector3(-0.65, 1.95, 0)))
	var poly := PackedVector2Array()
	for k in 21:
		var a := lerpf(-1.2, 1.2, float(k) / 20.0)
		poly.append(Vector2(cos(a) * 0.62, sin(a) * 0.62))
	poly.append(Vector2(0.0, 0.18))
	poly.append(Vector2(0.0, -0.18))
	var xf := Transform3D(Basis(Vector3(0, 0, 1), 0.32), Vector3(-0.12, 0.55, 0.06))
	_slab(root, poly, 0.035, M.metal(M.TIER_METAL.bronze, 0.2), xf)
	var edge := PackedVector3Array()
	for k in 21:
		var a := lerpf(-1.2, 1.2, float(k) / 20.0)
		edge.append(Vector3(cos(a) * 0.62, sin(a) * 0.62, 0.0))
	M.put(root, M.tube(edge, func(_t): return Vector2(0.05, 0.03), 8, Vector3(0, 0, 1), false, func(t, _a): return Color(1.0, 0.3, 0.1, 0.9 - 0.4 * absf(t - 0.5))), M.glow(Color.WHITE, true), xf)
	M.put(root, M.sphere(0.55), M.glow(Color(0.9, 0.15, 0.05, 0.18), true), Transform3D(Basis(), Vector3(0.2, 0.6, -0.3)))

static func _m_greatest_of_fifty(root: Node3D) -> void:
	# a bronze khopesh before the company's standard: a pole with a gold fan
	# and a red-and-white pennant
	var wood := M.mat(Color(0.4, 0.24, 0.1), 0.6, "wood")
	M.put(root, M.cyl(0.04, 0.04, 2.0), wood, Transform3D(Basis(), Vector3(-0.45, 0.0, -0.2)))
	var fan := PackedVector2Array([Vector2(0, 0)])
	for k in 13:
		var a := lerpf(0.15, PI - 0.15, float(k) / 12.0)
		fan.append(Vector2(cos(a) * 0.4, sin(a) * 0.4))
	_slab(root, fan, 0.03, _gold(0.2), Transform3D(Basis(), Vector3(-0.45, 0.85, -0.2)))
	_slab(root, _ellipse(0, 0, 0.12, 0.12, 16), 0.02, M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(-0.45, 1.0, -0.16)))
	var flag := []
	for j in 5:
		var v := float(j) / 4.0
		var row := PackedVector3Array()
		for i in 9:
			var u := float(i) / 8.0
			row.append(Vector3(-0.45 + u * 0.7, 0.62 - v * 0.35, -0.2 + 0.06 * sin(u * 6.0)))
		flag.append(row)
	var acc := M._acc()
	var cols := []
	for j in 5:
		var cr := []
		for i in 9:
			cr.append(Color(0.75, 0.08, 0.06) if j % 2 == 0 else LINEN)
		cols.append(cr)
	M._grid(acc, flag, false, PackedVector3Array([Vector3(0, 0, -5)]), cols)
	var mi := M.put(root, M._mesh(acc), M.painted(0.8))
	(mi.material_override as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
	# the khopesh: a straight neck into a deep sickle blade
	var path := M.line(Vector3(0.2, -0.95, 0.2), Vector3(0.25, -0.15, 0.2), 6)
	path.append_array(M.bez(Vector3(0.25, -0.1, 0.2), Vector3(0.3, 0.45, 0.2), Vector3(0.85, 0.55, 0.2), Vector3(0.75, 0.05, 0.2), 18))
	M.put(root, M.tube(path, func(t): var w: float = 0.03 if t < 0.25 else 0.14 * sin(PI * clampf((t - 0.25) / 0.75, 0.0, 1.0)) ** 0.6 + 0.01; return Vector2(w, 0.02), 4, Vector3(0, 0, 1), true), M.metal(M.TIER_METAL.bronze, 0.2))
	M.put(root, M.cyl(0.05, 0.05, 0.4, 10), M.mat(Color(0.2, 0.12, 0.06), 0.7, "rough"), Transform3D(Basis(), Vector3(0.19, -1.1, 0.2)))
	M.put(root, M.box(Vector3(0.22, 0.05, 0.08)), _gold(), Transform3D(Basis(), Vector3(0.2, -0.9, 0.2)))

static func _m_spear_of_horus(root: Node3D) -> void:
	# a gold spear, Horus' falcon wings spread at its socket
	var a := Vector3(-0.85, -1.0, 0)
	var b := Vector3(0.75, 1.0, 0)
	M.spear(root, a, b, _gold(0.18), 0.6, 0.17, 0.05, M.mat(Color(0.3, 0.16, 0.06), 0.6, "wood"))
	var d := (b - a).normalized()
	var o := b - d * 0.66
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	for s in [-1.0, 1.0]:
		var p := PackedVector2Array([Vector2(0, 0)])
		for k in 6:
			var t := float(k) / 5.0
			p.append(Vector2(0.15 + t * 0.55, -0.05 - t * 0.35 + 0.08 * (k % 2)))
		p.append(Vector2(0.15, 0.12))
		var basis := Basis(x * s, d, Vector3(0, 0, 1) * s)
		var acc := M._acc()
		M.extrude_acc(acc, p, 0.025, 0.01)
		for i in acc.c.size():
			var v: Vector3 = acc.v[i]
			acc.c[i] = GOLD if v.x < 0.35 else (LAPIS.lightened(0.15) if int(v.x * 12.0) % 2 == 0 else TURQ)
		M.put(root, M._mesh(acc), M.painted(0.3, 0.5), Transform3D(basis, o))
	M.put(root, M.sphere(0.07), M.glow(Color(1.0, 0.95, 0.6)), Transform3D(Basis(), b - d * 0.2 + Vector3(0, 0, 0.06)))

# ---- Thoth --------------------------------------------------------------------

static func _m_valley_of_the_kings(root: Node3D) -> void:
	# a king's gold funerary mask: the striped nemes, kohl eyes, a lapis beard
	var g := _gold(0.18)
	var nem := PackedVector2Array([Vector2(-0.3, 0.85), Vector2(0.3, 0.85), Vector2(0.55, 0.45), Vector2(0.62, -0.75), Vector2(0.32, -0.85), Vector2(-0.32, -0.85), Vector2(-0.62, -0.75), Vector2(-0.55, 0.45)])
	var acc := M._acc()
	M.extrude_acc(acc, nem, 0.06, 0.02)
	for i in acc.c.size():
		var v: Vector3 = acc.v[i]
		acc.c[i] = GOLD if int((v.y + 2.0) * 9.0) % 2 == 0 else LAPIS
	M.put(root, M._mesh(acc), M.painted(0.25, 0.75), Transform3D(Basis(), Vector3(0, 0, -0.15)))
	var face := []
	for i in 17:
		var t := float(i) / 16.0
		face.append(Vector2(0.36 * sin(PI * clampf(t, 0.03, 0.97)) ** 0.6, lerpf(-0.6, 0.6, t)))
	M.put(root, M.lathe(face, 32), g, Transform3D(Basis().scaled(Vector3(1.0, 1.0, 0.6)), Vector3(0, 0.05, 0.0)))
	for s in [-1.0, 1.0]:
		_slab(root, _ellipse(0, 0, 0.11, 0.05, 16), 0.01, M.mat(IVORY, 0.3), Transform3D(Basis(Vector3.UP, 0.35 * s), Vector3(0.14 * s, 0.17, 0.2)))
		M.put(root, M.sphere(0.035), M.mat(GRANITE, 0.1), Transform3D(Basis(), Vector3(0.14 * s, 0.17, 0.22)))
		M.put(root, M.tube(M.line(Vector3(0.04 * s, 0.24, 0.21), Vector3(0.3 * s, 0.22, 0.13), 4), func(_t): return Vector2.ONE * 0.018, 6), M.mat(LAPIS, 0.2))
	M.put(root, M.cyl(0.07, 0.06, 0.4, 12), M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(0, -0.72, 0.1)))
	for k in 3:
		M.put(root, M.torus(0.06, 0.08), g, Transform3D(Basis(), Vector3(0, -0.6 - k * 0.12, 0.1)))
	M.put(root, M.tube(M.bez(Vector3(-0.1, 0.62, 0.15), Vector3(-0.05, 0.75, 0.2), Vector3(0.05, 0.75, 0.2), Vector3(0.0, 0.65, 0.28), 8), func(_t): return Vector2.ONE * 0.04, 8), g)

static func _m_book_of_thoth(root: Node3D) -> void:
	# a papyrus of Thoth unrolled, its hieroglyphs alight, the moon above it
	var pap := M.mat(Color(0.88, 0.78, 0.52), 0.85, "rough")
	var sheet := []
	for j in 11:
		var v := float(j) / 10.0
		var row := PackedVector3Array()
		for i in 15:
			var u := lerpf(-0.85, 0.85, float(i) / 14.0)
			row.append(Vector3(u, lerpf(0.35, -0.65, v), 0.05 * sin(v * PI * 2.0)))
		sheet.append(row)
	var acc := M._acc()
	M._grid(acc, sheet, false, PackedVector3Array([Vector3(0, 0, -5)]))
	var sm := M.put(root, M._mesh(acc), pap)
	(sm.material_override as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
	for x in [-0.95, 0.95]:
		M.put(root, M.cyl(0.11, 0.11, 1.1, 20), pap, Transform3D(Basis(), Vector3(x, -0.15, 0.04)))
	var gl := M.glow(Color(0.45, 1.0, 0.75))
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for col in 5:
		for r in 3:
			var p := Vector3(-0.6 + col * 0.3, 0.18 - r * 0.28, 0.08)
			match rng.randi_range(0, 2):
				0:
					M.put(root, M.box(Vector3(0.14, 0.04, 0.02)), gl, Transform3D(Basis(), p))
				1:
					M.put(root, M.torus(0.04, 0.065), gl, Transform3D(Basis(Vector3.RIGHT, PI / 2), p))
				_:
					M.put(root, M.box(Vector3(0.04, 0.16, 0.02)), gl, Transform3D(Basis(), p))
	var moon := PackedVector2Array()
	for k in 25:
		var a := lerpf(0.5, TAU - 0.5, float(k) / 24.0)
		moon.append(Vector2(cos(a) * 0.3, sin(a) * 0.3))
	for k in 25:
		var a := lerpf(TAU - 0.9, 0.9, float(k) / 24.0)
		moon.append(Vector2(0.14 + cos(a) * 0.24, sin(a) * 0.24))
	_slab(root, moon, 0.04, M.metal(Color(0.88, 0.9, 0.95), 0.2), Transform3D(Basis(Vector3(0, 0, 1), PI / 2), Vector3(0, 0.75, 0)))
	root.rotation = Vector3(0.2, -0.2, 0)

static func _m_tusks_of_apedemak(root: Node3D) -> void:
	# a pair of great ivory tusks crossed, gold-capped and gold-banded
	for s in [-1.0, 1.0]:
		var p := M.bez(Vector3(-0.75 * s, -0.95, 0.05 * s), Vector3(-0.6 * s, 0.1, 0.1 * s), Vector3(0.2 * s, 0.85, 0.1 * s), Vector3(0.75 * s, 0.75, 0.05 * s), 24)
		M.put(root, M.tube(p, func(t): return Vector2.ONE * (0.18 * (1.0 - t) ** 0.8 + 0.012), 14, Vector3(0, 0, 1), false, func(t, _a): return IVORY.darkened(0.15 * (1.0 - t))), M.painted(0.3))
		M.put(root, M.torus(0.14, 0.2), _gold(), M.along(p[2], p[3] - p[1]))
		M.put(root, M.torus(0.11, 0.165), _gold(), M.along(p[7], p[8] - p[6]))
		M.put(root, M.cyl(0.19, 0.19, 0.08, 20), _gold(), M.along(p[0], p[1] - p[0]))
	M.put(root, M.sphere(0.16), M.mat(Color(0.75, 0.12, 0.06), 0.2), Transform3D(Basis(), Vector3(0, -0.35, 0.3)))
	M.put(root, M.torus(0.15, 0.21), _gold(), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, -0.35, 0.28)))
