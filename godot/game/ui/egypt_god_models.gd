extends RefCounted
## 3D portrait busts of the Egyptian minor gods (ui piece, Godot-only): the
## age-up buttons of an Egyptian Town Center (icon names "g_<god>") rendered
## in the tech icons' studio (tech_icons.gd render_models) and baked onto the
## same square painted tiles as the tech and unit buttons, so a god reads as a
## portrait in the grid's own frame (Retold paints each god's head on his
## age-up button: reference/egypt/ui_03.jpg). Each bust: bare shoulders under
## a wesekh broad collar (gold, lapis, turquoise and carnelian bands), the
## god's head (jackal, cat, lioness, crocodile, falcon, ibis, or a painted
## human face) under his crown, a 3/4 turn to the right.
##
##   EgyptGodModels.build_into("g_sobek", root) -> true (root filled)
##
## Space as tech_models.gd: x right, y up, z toward the camera, about [-1, 1]^2.

const M := preload("res://game/ui/tech_models.gd")

const GOLD := Color(1.0, 0.78, 0.36)
const LAPIS := Color(0.08, 0.2, 0.62)
const TURQ := Color(0.12, 0.62, 0.6)
const CARNELIAN := Color(0.72, 0.16, 0.08)
const LINEN := Color(0.93, 0.9, 0.8)
const GRANITE := Color(0.06, 0.06, 0.07)
const SKIN := Color(0.4, 0.2, 0.09)
const SKIN_F := Color(0.62, 0.4, 0.2)   # a goddess' lighter ochre
const OSIRIS := Color(0.14, 0.38, 0.2)       # Osiris' and Ptah's green flesh

## The minor gods with a bust (the egypt_icons.gd MINOR keys).
const GODS := ["anubis", "bast", "ptah", "hathor", "nephthys", "sekhmet", "sobek", "horus", "osiris", "thoth"]

## Fill root with the bust of an icon name ("g_<god>"); false: no model.
static func build_into(name: String, root: Node3D) -> bool:
	if not name.begins_with("g_"):
		return false
	var g := name.substr(2)
	if not GODS.has(g):
		return false
	var b := Node3D.new()
	root.add_child(b)
	match g:
		"anubis": _anubis(b)
		"bast": _bast(b)
		"ptah": _ptah(b)
		"hathor": _hathor(b)
		"nephthys": _nephthys(b)
		"sekhmet": _sekhmet(b)
		"sobek": _sobek(b)
		"horus": _horus(b)
		"osiris": _osiris(b)
		"thoth": _thoth(b)
	# a 3/4 portrait: turned to the right, the head a little forward
	b.rotation = Vector3(0.1, 0.5, 0.0)
	b.position = Vector3(0.0, -0.05, 0.0)
	return true

# ---- the bust ------------------------------------------------------------------

## The torso's radius at height y (the shoulders' lathe profile below).
const TORSO := [Vector2(0.8, -0.8), Vector2(0.62, -0.62), Vector2(0.38, -0.5), Vector2(0.17, -0.43)]
const DEPTH := 0.56
## the shoulders' width (narrowed: at 48 px the head is the portrait)
const SHOULDER_W := 0.78

static func _torso_r(y: float) -> float:
	for i in TORSO.size() - 1:
		var a: Vector2 = TORSO[i]
		var c: Vector2 = TORSO[i + 1]
		if y >= a.y and y <= c.y:
			return lerpf(a.x, c.x, (y - a.y) / (c.y - a.y))
	return 0.17

## Bare shoulders, a neck and the wesekh collar over them.
static func _shoulders(b: Node3D, skin: Color) -> void:
	var sk := M.mat(skin, 0.85)
	# (the shoulders face the key light: a shade darker than the face, or they burn out)
	M.put(b, M.lathe(TORSO, 40), M.mat(skin.darkened(0.45), 0.9), Transform3D(Basis().scaled(Vector3(SHOULDER_W, 1, DEPTH)), Vector3.ZERO))
	M.put(b, M.cyl(0.15, 0.14, 0.36, 24), M.mat(skin.darkened(0.35), 0.85), Transform3D(Basis(), Vector3(0, -0.28, 0.0)))
	# the broad collar: bands of gold, lapis, turquoise and carnelian beads
	var bands := [GOLD, GOLD, LAPIS, GOLD, TURQ, GOLD, GOLD, CARNELIAN, GOLD, LAPIS, GOLD]
	var prof := []
	for i in 11:
		var y := lerpf(-0.44, -0.8, float(i) / 10.0)
		prof.append(Vector2(_torso_r(y) + 0.035, y))
	prof.reverse()
	bands.reverse()
	M.put(b, M.lathe(prof, 40, Callable(), func(i, a): return (bands[i] as Color).darkened(0.5 if int(a * 40.0 / TAU) % 2 == 0 else 0.62)),
		M.painted(0.8, 0.0), Transform3D(Basis().scaled(Vector3(SHOULDER_W, 1, DEPTH)), Vector3.ZERO))

## The gods' tripartite wig: a striped mass behind the head and two lappets
## hanging before the shoulders (lapis banded with gold).
static func _wig(b: Node3D, top: float, col := LAPIS, w := 0.42) -> void:
	var stripes := func(i: int, _a: float) -> Color:
		return col if i % 4 != 0 else Color(0.8, 0.55, 0.18)
	var prof := []
	for i in 13:
		var t := float(i) / 12.0
		prof.append(Vector2((w + 0.06 * t) * 0.92, top - t * 0.8))
	prof.reverse()
	M.put(b, M.lathe(prof, 36, func(a, _i): return 0.62 if sin(a) > 0.25 else 1.0, func(i, a): return stripes.call(12 - i, a)),
		M.painted(0.4, 0.3), Transform3D(Basis(), Vector3(0, 0, -0.14)))
	for s in [-1.0, 1.0]:
		var p := M.bez(Vector3(0.3 * s, top - 0.35, 0.05), Vector3(0.36 * s, top - 0.7, 0.16), Vector3(0.36 * s, top - 0.88, 0.22), Vector3(0.34 * s, top - 1.06, 0.24), 18)
		M.put(b, M.tube(p, func(t): return Vector2(0.075 + 0.025 * t, 0.045), 10, Vector3(0, 0, 1), false, func(t, _a): return col if int(t * 16.0) % 4 != 0 else Color(0.8, 0.55, 0.18)),
			M.painted(0.4, 0.3))

## A painted human face (gods with a man's or a woman's head).
static func _face(b: Node3D, skin: Color, female := false) -> void:
	var sk := M.mat(skin, 0.5)
	M.put(b, M.sphere(0.29, 0.74), sk, Transform3D(Basis(), Vector3(0, 0.17, 0.02)))
	# jaw and chin
	M.put(b, M.sphere(0.2, 0.34), sk, Transform3D(Basis(), Vector3(0, -0.02, 0.1)))
	# nose
	M.put(b, M.cyl(0.03, 0.065, 0.2, 8), sk, Transform3D(Basis(Vector3.RIGHT, -0.35), Vector3(0, 0.14, 0.29)))
	# lips
	M.put(b, M.sphere(0.075, 0.05), M.mat(skin.darkened(0.35).lerp(CARNELIAN, 0.25), 0.4), Transform3D(Basis(), Vector3(0, 0.0, 0.27)))
	for s in [-1.0, 1.0]:
		var e := Vector3(0.11 * s, 0.22, 0.25)
		M.put(b, M.sphere(0.05, 0.045), M.mat(LINEN, 0.3), Transform3D(Basis(), e))
		M.put(b, M.sphere(0.027), M.mat(GRANITE, 0.15), Transform3D(Basis(), e + Vector3(0.0, 0.0, 0.022)))
		# kohl: the lid line drawn out to the temple, the brow above
		M.put(b, M.tube(M.line(e + Vector3(-0.045 * s, 0.02, 0.01), e + Vector3(0.12 * s, 0.0, -0.06), 6), func(_t): return Vector2(0.012, 0.012), 6), M.mat(GRANITE, 0.3))
		M.put(b, M.tube(M.bez(e + Vector3(-0.05 * s, 0.07, 0.0), e + Vector3(0.0, 0.1, 0.01), e + Vector3(0.06 * s, 0.09, -0.01), e + Vector3(0.12 * s, 0.05, -0.06), 8), func(_t): return Vector2(0.014, 0.012), 6), M.mat(GRANITE, 0.3))
	if female:
		for s in [-1.0, 1.0]:
			M.put(b, M.torus(0.025, 0.05), M.metal(GOLD, 0.2), Transform3D(Basis(Vector3(0, 0, 1), PI / 2), Vector3(0.29 * s, 0.02, 0.0)))

## The god's false beard: a plaited straight beard (or Osiris' curled one).
static func _beard(b: Node3D, curl := false) -> void:
	var p := M.bez(Vector3(0, -0.12, 0.2), Vector3(0, -0.24, 0.24), Vector3(0, -0.34, 0.26), Vector3(0, -0.44, 0.24 + (0.1 if curl else 0.0)), 10)
	M.put(b, M.tube(p, func(_t): return Vector2(0.055, 0.045), 8, Vector3(0, 0, 1), false, func(t, _a): return LAPIS if int(t * 8.0) % 2 == 0 else GOLD), M.painted(0.35, 0.4))

## A sun disc with a rearing uraeus before it.
static func _sun(b: Node3D, at: Vector3, r := 0.24, col := Color(0.86, 0.2, 0.04)) -> void:
	M.put(b, M.cyl(r, r, 0.07, 32), M.glow(col), Transform3D(Basis(Vector3.RIGHT, PI / 2), at))
	M.put(b, M.torus(r - 0.02, r + 0.02), M.metal(GOLD, 0.2), Transform3D(Basis(Vector3.RIGHT, PI / 2), at + Vector3(0, 0, 0.02)))
	_uraeus(b, at + Vector3(0, -r * 0.6, 0.1))

static func _uraeus(b: Node3D, at: Vector3) -> void:
	var p := M.bez(at + Vector3(0, -0.12, -0.02), at + Vector3(0, -0.02, 0.06), at + Vector3(0, 0.06, 0.04), at + Vector3(0, 0.12, 0.06), 10)
	M.put(b, M.tube(p, func(t): return Vector2(0.03 + 0.03 * sin(PI * t), 0.025), 8), M.metal(GOLD, 0.2))

## A beast's head on the bust: a skull sphere and a muzzle swept forward.
static func _beast(b: Node3D, m: Material, skull: float, snout_len: float, snout_w: float, snout_h: float, y := 0.2) -> void:
	M.put(b, M.sphere(skull, skull * 2.1), m, Transform3D(Basis(), Vector3(0, y, 0.0)))
	var p := M.line(Vector3(0, y - 0.04, skull * 0.4), Vector3(0, y - 0.08 - snout_h * 0.3, skull * 0.4 + snout_len), 10)
	M.put(b, M.tube(p, func(t): return Vector2(snout_w * (1.0 - t * 0.45), snout_h * (1.0 - t * 0.35)), 14, Vector3.UP), m)
	# the muzzle's rounded end
	M.put(b, M.sphere(snout_w * 0.55, snout_h * 1.3), m, Transform3D(Basis(), p[p.size() - 1]))

static func _ear(b: Node3D, m: Material, at: Vector3, h: float, r: float, tilt: float) -> void:
	M.put(b, M.cyl(r, 0.0, h, 4), m, Transform3D(Basis(Vector3(0, 0, 1), tilt) * Basis(Vector3.UP, PI / 4).scaled(Vector3(1, 1, 0.45)), at))

static func _eye(b: Node3D, at: Vector3, col: Color, r := 0.04) -> void:
	# (read at 48 px: a third larger than life, set a little proud of the face)
	r *= 1.35
	at += Vector3(0, 0, r * 0.3)
	M.put(b, M.sphere(r), M.glow(col), Transform3D(Basis(), at))
	M.put(b, M.sphere(r * 0.45), M.mat(GRANITE, 0.1), Transform3D(Basis(), at + Vector3(0, 0, r * 0.7)))

# ---- the gods ------------------------------------------------------------------

static func _anubis(b: Node3D) -> void:
	# the black jackal: long muzzle, tall pointed ears, gold-rimmed eyes
	_shoulders(b, SKIN)
	_wig(b, 0.3, LAPIS, 0.36)
	var fur := M.mat(Color(0.05, 0.05, 0.06), 0.35)
	_beast(b, fur, 0.28, 0.48, 0.13, 0.13, 0.16)
	M.put(b, M.sphere(0.05), M.mat(Color(0.02, 0.02, 0.02), 0.2), Transform3D(Basis(), Vector3(0, 0.11, 0.66)))
	for s in [-1.0, 1.0]:
		_ear(b, fur, Vector3(0.12 * s, 0.58, -0.04), 0.46, 0.12, -0.12 * s)
		M.put(b, M.cyl(0.07, 0.0, 0.3, 4), M.metal(GOLD, 0.3), Transform3D(Basis(Vector3(0, 0, 1), -0.12 * s) * Basis(Vector3.UP, PI / 4).scaled(Vector3(1, 1, 0.3)), Vector3(0.12 * s, 0.56, 0.0)))
		_eye(b, Vector3(0.13 * s, 0.3, 0.2), Color(1.0, 0.75, 0.2), 0.035)
	M.put(b, M.torus(0.15, 0.19), M.metal(GOLD, 0.2), Transform3D(Basis(), Vector3(0, -0.12, 0.0)))

static func _bast(b: Node3D) -> void:
	# the cat goddess: a black-bronze cat's head, green eyes, a gold earring
	_shoulders(b, SKIN_F)
	_wig(b, 0.28, LAPIS, 0.34)
	var cat := M.metal(Color(0.2, 0.16, 0.11), 0.38)
	M.put(b, M.sphere(0.29, 0.56), cat, Transform3D(Basis(), Vector3(0, 0.2, 0.0)))
	M.put(b, M.sphere(0.13, 0.17), M.metal(Color(0.42, 0.32, 0.2), 0.4), Transform3D(Basis(), Vector3(0, 0.1, 0.25)))
	M.put(b, M.sphere(0.03), M.mat(Color(0.6, 0.3, 0.3), 0.3), Transform3D(Basis(), Vector3(0, 0.13, 0.37)))
	for s in [-1.0, 1.0]:
		_ear(b, cat, Vector3(0.17 * s, 0.5, -0.02), 0.3, 0.13, -0.3 * s)
		_eye(b, Vector3(0.12 * s, 0.25, 0.23), Color(0.55, 1.0, 0.3), 0.045)
	M.put(b, M.torus(0.04, 0.07), M.metal(GOLD, 0.2), Transform3D(Basis(Vector3(0, 0, 1), PI / 2), Vector3(0.28, 0.05, 0.02)))
	M.put(b, M.torus(0.15, 0.19), M.metal(GOLD, 0.2), Transform3D(Basis(), Vector3(0, -0.12, 0.0)))

static func _ptah(b: Node3D) -> void:
	# the craftsman god: green flesh, a close lapis skullcap, a straight beard
	_shoulders(b, OSIRIS)
	_face(b, OSIRIS)
	var cap := M.mat(LAPIS, 0.25)
	M.put(b, M.sphere(0.31, 0.62), cap, Transform3D(Basis(Vector3.RIGHT, -0.25), Vector3(0, 0.3, -0.03)))
	_beard(b)
	# the menat counterpoise and a was-sceptre's head over the shoulder
	M.put(b, M.tube(M.line(Vector3(-0.5, -0.8, 0.35), Vector3(-0.5, 0.55, 0.35), 8), func(_t): return Vector2.ONE * 0.04, 8), M.metal(GOLD, 0.25))
	M.put(b, M.tube(M.bez(Vector3(-0.5, 0.55, 0.35), Vector3(-0.5, 0.68, 0.35), Vector3(-0.4, 0.72, 0.35), Vector3(-0.33, 0.62, 0.35), 8), func(_t): return Vector2.ONE * 0.04, 8), M.metal(GOLD, 0.25))
	for k in 3:
		M.put(b, M.torus(0.035, 0.065), M.mat(TURQ, 0.3), Transform3D(Basis(), Vector3(-0.5, 0.3 - k * 0.12, 0.35)))

static func _hathor(b: Node3D) -> void:
	# the cow-horned goddess: a black wig, lyre horns cradling a red sun
	_shoulders(b, SKIN_F)
	_wig(b, 0.5, Color(0.06, 0.06, 0.1), 0.38)
	_face(b, SKIN_F, true)
	M.put(b, M.cyl(0.3, 0.32, 0.08, 32), M.metal(GOLD, 0.25), Transform3D(Basis(), Vector3(0, 0.5, -0.04)))
	for s in [-1.0, 1.0]:
		var p := M.bez(Vector3(0.12 * s, 0.55, -0.05), Vector3(0.55 * s, 0.6, -0.05), Vector3(0.5 * s, 1.05, -0.05), Vector3(0.18 * s, 1.15, -0.05), 20)
		M.put(b, M.tube(p, func(t): return Vector2.ONE * (0.07 * (1.0 - t) + 0.02), 10), M.mat(Color(0.2, 0.17, 0.14), 0.35))
	_sun(b, Vector3(0, 0.88, -0.1), 0.26)

static func _nephthys(b: Node3D) -> void:
	# the lady of the house: a vulture cap over a lapis wig, her name glyph
	# (a house under a basket) on her head
	_shoulders(b, SKIN_F)
	_wig(b, 0.5, LAPIS, 0.38)
	_face(b, SKIN_F, true)
	var g := M.metal(GOLD, 0.22)
	# the vulture's wings folded down the wig
	for s in [-1.0, 1.0]:
		var p := M.bez(Vector3(0.05 * s, 0.5, 0.15), Vector3(0.3 * s, 0.45, 0.12), Vector3(0.36 * s, 0.25, 0.08), Vector3(0.35 * s, 0.0, 0.05), 12)
		M.put(b, M.tube(p, func(t): return Vector2(0.09 * (1.0 - t * 0.5), 0.03), 8, Vector3(0, 0, 1), false, func(t, _a): return GOLD if int(t * 10.0) % 2 == 0 else TURQ), M.painted(0.3, 0.6))
	M.put(b, M.cyl(0.24, 0.26, 0.08, 32), g, Transform3D(Basis(), Vector3(0, 0.52, -0.04)))
	M.put(b, M.box(Vector3(0.36, 0.28, 0.12)), g, Transform3D(Basis(), Vector3(0, 0.72, -0.04)))
	M.put(b, M.box(Vector3(0.14, 0.16, 0.13)), M.mat(LAPIS, 0.25), Transform3D(Basis(), Vector3(0.06, 0.66, -0.035)))
	M.put(b, M.sphere(0.2, 0.18), g, Transform3D(Basis(), Vector3(0, 0.9, -0.04)))

static func _sekhmet(b: Node3D) -> void:
	# the lioness: tawny head and ruff, the sun disc and uraeus
	_shoulders(b, SKIN_F)
	_wig(b, 0.36, Color(0.5, 0.3, 0.1), 0.4)
	var fur := M.mat(Color(0.7, 0.42, 0.14), 0.7, "rough")
	M.put(b, M.sphere(0.36, 0.66), M.mat(Color(0.42, 0.22, 0.08), 0.8, "rough"), Transform3D(Basis(), Vector3(0, 0.12, -0.14)))
	M.put(b, M.sphere(0.27, 0.5), fur, Transform3D(Basis().scaled(Vector3(0.95, 1, 1.15)), Vector3(0, 0.2, 0.03)))
	M.put(b, M.sphere(0.15, 0.17), fur, Transform3D(Basis().scaled(Vector3(1, 1, 1.7)), Vector3(0, 0.05, 0.26)))
	M.put(b, M.tube(M.line(Vector3(-0.08, -0.02, 0.44), Vector3(0.08, -0.02, 0.44), 4), func(_t): return Vector2(0.012, 0.012), 6), M.mat(Color(0.2, 0.08, 0.05), 0.4))
	M.put(b, M.sphere(0.05), M.mat(Color(0.2, 0.08, 0.05), 0.3), Transform3D(Basis(), Vector3(0, 0.1, 0.5)))
	for s in [-1.0, 1.0]:
		M.put(b, M.sphere(0.06, 0.08), fur, Transform3D(Basis(), Vector3(0.2 * s, 0.44, -0.04)))
		_eye(b, Vector3(0.12 * s, 0.25, 0.25), Color(1.0, 0.65, 0.15), 0.04)
	_sun(b, Vector3(0, 0.66, -0.06), 0.25)

static func _sobek(b: Node3D) -> void:
	# the crocodile: a long flat green snout lined with teeth, eyes high on
	# the skull, the plumed sun disc of his crown
	_shoulders(b, SKIN)
	_wig(b, 0.3, LAPIS, 0.36)
	var hide := M.mat(Color(0.2, 0.34, 0.16), 0.55, "rough")
	M.put(b, M.sphere(0.27, 0.42), hide, Transform3D(Basis(), Vector3(0, 0.2, -0.02)))
	var p := M.line(Vector3(0, 0.18, 0.12), Vector3(0, 0.1, 0.92), 12)
	M.put(b, M.tube(p, func(t): return Vector2(0.17 * (1.0 - t * 0.35), 0.07), 14, Vector3.UP), hide)
	var jaw := M.line(Vector3(0, 0.03, 0.12), Vector3(0, 0.0, 0.86), 12)
	M.put(b, M.tube(jaw, func(t): return Vector2(0.15 * (1.0 - t * 0.35), 0.045), 14, Vector3.UP), M.mat(Color(0.5, 0.48, 0.3), 0.6))
	M.put(b, M.sphere(0.11, 0.14), hide, Transform3D(Basis(), Vector3(0, 0.1, 0.92)))
	M.put(b, M.sphere(0.1, 0.09), M.mat(Color(0.5, 0.48, 0.3), 0.6), Transform3D(Basis(), Vector3(0, 0.0, 0.86)))
	var tooth := M.mat(LINEN, 0.3)
	for k in 7:
		for s in [-1.0, 1.0]:
			var z := 0.25 + k * 0.09
			var w := 0.165 * (1.0 - (z - 0.12) / 0.8 * 0.35)
			M.put(b, M.cyl(0.018, 0.0, 0.06, 5), tooth, Transform3D(Basis(Vector3.RIGHT, PI), Vector3(w * s, 0.06, z)))
	for s in [-1.0, 1.0]:
		M.put(b, M.sphere(0.07, 0.08), hide, Transform3D(Basis(), Vector3(0.12 * s, 0.35, 0.12)))
		_eye(b, Vector3(0.12 * s, 0.36, 0.17), Color(0.95, 0.8, 0.2), 0.035)
		# the crown's twin plumes
		var pl := M.bez(Vector3(0.07 * s, 0.4, -0.08), Vector3(0.1 * s, 0.7, -0.08), Vector3(0.12 * s, 0.95, -0.08), Vector3(0.1 * s, 1.15, -0.08), 14)
		M.put(b, M.tube(pl, func(t): return Vector2(0.07 * sin(PI * clampf(t * 0.85 + 0.12, 0.0, 1.0)), 0.02), 6, Vector3(0, 0, 1), false, func(t, _a): return LINEN if int(t * 14.0) % 3 != 0 else LAPIS), M.painted(0.5))
		# and the ram's horns under them
		var h := M.bez(Vector3(0.0, 0.42, -0.06), Vector3(0.3 * s, 0.38, -0.06), Vector3(0.42 * s, 0.5, -0.06), Vector3(0.5 * s, 0.46, -0.06), 12)
		M.put(b, M.tube(h, func(t): return Vector2.ONE * (0.05 * (1.0 - t) + 0.015), 8), M.metal(GOLD, 0.25))
	_sun(b, Vector3(0, 0.58, 0.0), 0.15)

static func _horus(b: Node3D) -> void:
	# the falcon: dark brown plumage pale at the cheek, a hooked beak, the
	# falcon's malar stripe, the red and white double crown
	_shoulders(b, SKIN)
	_wig(b, 0.3, LAPIS, 0.36)
	var fc := func(i: int, a: float) -> Color:
		var y := float(i) / 20.0
		return Color(0.2, 0.11, 0.05).lerp(Color(0.9, 0.82, 0.62), clampf((0.42 - y) * 2.6, 0.0, 1.0) * clampf(sin(a) + 0.2, 0.0, 1.0))
	var prof := []
	for i in 21:
		var t := float(i) / 20.0
		prof.append(Vector2(0.3 * sin(PI * clampf(t, 0.02, 0.98)) ** 0.8, lerpf(-0.12, 0.52, t)))
	M.put(b, M.lathe(prof, 36, Callable(), fc), M.feathers(), Transform3D(Basis(), Vector3(0, 0.0, 0.03)))
	var beak := M.bez(Vector3(0.0, 0.2, 0.26), Vector3(0.0, 0.24, 0.48), Vector3(0.0, 0.08, 0.54), Vector3(0.0, -0.02, 0.44), 16)
	M.put(b, M.tube(beak, func(t): return Vector2.ONE * (0.09 * (1.0 - t) + 0.01), 10, Vector3(0, 0, 1), false, func(t, _a): return Color(0.95, 0.75, 0.2).lerp(Color(0.12, 0.1, 0.1), clampf((t - 0.35) * 2.5, 0.0, 1.0))), M.painted(0.25, 0.3))
	for s in [-1.0, 1.0]:
		_eye(b, Vector3(0.14 * s, 0.3, 0.22), Color(1.0, 0.72, 0.1), 0.045)
		M.put(b, M.tube(M.line(Vector3(0.15 * s, 0.25, 0.22), Vector3(0.19 * s, 0.02, 0.17), 6), func(t): return Vector2(0.035 * (1.0 - t * 0.5), 0.015), 6), M.mat(Color(0.1, 0.06, 0.04), 0.6))
	# the pschent: the red deshret (a low cylinder with a high back) round
	# the white hedjet's bulb
	var red := M.mat(Color(0.7, 0.1, 0.06), 0.45)
	M.put(b, M.cyl(0.29, 0.3, 0.22, 32), red, Transform3D(Basis(), Vector3(0, 0.52, -0.03)))
	M.put(b, M.box(Vector3(0.18, 0.4, 0.1)), red, Transform3D(Basis(), Vector3(0, 0.75, -0.26)))
	var hp := []
	for i in 13:
		var t := float(i) / 12.0
		hp.append(Vector2(0.2 * (1.0 - t * 0.55) * (1.0 - t ** 6) + 0.02, lerpf(0.55, 1.12, t)))
	M.put(b, M.lathe(hp, 28), M.mat(LINEN, 0.45), Transform3D(Basis(), Vector3(0, 0.0, -0.03)))
	_uraeus(b, Vector3(0, 0.52, 0.29))

static func _osiris(b: Node3D) -> void:
	# the green-fleshed king of the dead: the white atef crown between two
	# plumes, a curled beard, crook and flail crossed on the chest
	_shoulders(b, OSIRIS)
	_face(b, OSIRIS)
	_beard(b, true)
	var prof := []
	for i in 17:
		var t := float(i) / 16.0
		prof.append(Vector2(0.26 * (1.0 - t * 0.62) + 0.05 * sin(PI * t), lerpf(0.32, 1.18, t)))
	prof.append(Vector2(0.0, 1.22))
	M.put(b, M.lathe(prof, 32, Callable(), func(i, _a): return LINEN if i % 4 != 0 else GOLD), M.painted(0.4), Transform3D(Basis(), Vector3(0, 0, -0.02)))
	M.put(b, M.sphere(0.08), M.metal(GOLD, 0.2), Transform3D(Basis(), Vector3(0, 1.25, -0.02)))
	for s in [-1.0, 1.0]:
		var p := M.bez(Vector3(0.28 * s, 0.42, -0.04), Vector3(0.44 * s, 0.7, -0.04), Vector3(0.38 * s, 0.95, -0.04), Vector3(0.48 * s, 1.15, -0.04), 18)
		M.put(b, M.tube(p, func(t): return Vector2(0.09 * sin(PI * clampf(t * 0.9 + 0.1, 0.0, 1.0)) ** 0.5 + 0.015, 0.02), 4, Vector3(0, 0, 1), true, func(t, _a): return LINEN.lerp(Color(0.7, 0.66, 0.6), absf(sin(t * 30.0)) * 0.5)), M.painted(0.6))
		var h := M.bez(Vector3(0.2 * s, 0.4, 0.0), Vector3(0.4 * s, 0.38, 0.02), Vector3(0.5 * s, 0.48, 0.02), Vector3(0.56 * s, 0.42, 0.02), 12)
		M.put(b, M.tube(h, func(t): return Vector2.ONE * (0.05 * (1.0 - t) + 0.015), 8), M.metal(GOLD, 0.25))
	_uraeus(b, Vector3(0, 0.4, 0.28))
	# crook and flail, banded gold and lapis, crossed before the collar
	var crook := M.bez(Vector3(0.2, -0.8, 0.5), Vector3(0.1, -0.9, 0.5), Vector3(-0.15, -0.6, 0.5), Vector3(-0.3, -0.35, 0.5), 14)
	crook.append_array(M.bez(Vector3(-0.31, -0.33, 0.5), Vector3(-0.38, -0.18, 0.5), Vector3(-0.55, -0.22, 0.5), Vector3(-0.52, -0.36, 0.5), 8))
	M.put(b, M.tube(crook, func(_t): return Vector2.ONE * 0.04, 8, Vector3(0, 0, 1), false, func(t, _a): return GOLD if int(t * 16.0) % 2 == 0 else LAPIS), M.painted(0.25, 0.7))
	var flail := M.line(Vector3(-0.18, -0.8, 0.52), Vector3(0.3, -0.4, 0.52), 10)
	M.put(b, M.tube(flail, func(_t): return Vector2.ONE * 0.035, 8, Vector3(0, 0, 1), false, func(t, _a): return GOLD if int(t * 14.0) % 2 == 0 else LAPIS), M.painted(0.25, 0.7))
	for k in 3:
		var a := Vector3(0.3, -0.4, 0.52)
		M.put(b, M.tube(M.bez(a, a + Vector3(0.08 + k * 0.05, 0.0, 0.0), a + Vector3(0.12 + k * 0.05, -0.15, 0.0), a + Vector3(0.1 + k * 0.06, -0.32, 0.0), 8), func(_t): return Vector2.ONE * 0.022, 6), M.metal(GOLD, 0.25))

static func _thoth(b: Node3D) -> void:
	# the ibis: a small black-and-white head, a long beak curving down, the
	# moon (a silver disc in a crescent) on his head
	_shoulders(b, SKIN)
	_wig(b, 0.3, LAPIS, 0.36)
	var head := M.mat(Color(0.08, 0.08, 0.09), 0.45)
	M.put(b, M.sphere(0.24, 0.46), head, Transform3D(Basis(), Vector3(0, 0.2, 0.0)))
	M.put(b, M.sphere(0.16, 0.36), M.mat(Color(0.92, 0.9, 0.84), 0.6), Transform3D(Basis(), Vector3(0, 0.0, 0.04)))
	var beak := M.bez(Vector3(0, 0.2, 0.18), Vector3(0, 0.22, 0.55), Vector3(0, 0.0, 0.8), Vector3(0, -0.35, 0.88), 20)
	M.put(b, M.tube(beak, func(t): return Vector2.ONE * (0.065 * (1.0 - t) + 0.012), 10), M.mat(Color(0.1, 0.09, 0.08), 0.35))
	for s in [-1.0, 1.0]:
		_eye(b, Vector3(0.12 * s, 0.26, 0.17), Color(0.95, 0.85, 0.5), 0.035)
	var silver := M.metal(Color(0.85, 0.88, 0.95), 0.2)
	var cr := PackedVector3Array()
	for k in 25:
		var a := lerpf(PI * 1.1, PI * 1.9, float(k) / 24.0)
		cr.append(Vector3(cos(a) * 0.3, 0.72 + sin(a) * 0.3 + 0.12, -0.04))
	M.put(b, M.tube(cr, func(t): return Vector2(0.03 + 0.05 * sin(PI * t), 0.04), 8), silver)
	M.put(b, M.cyl(0.2, 0.2, 0.06, 32), M.glow(Color(0.85, 0.92, 1.0)), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0.8, -0.06)))
