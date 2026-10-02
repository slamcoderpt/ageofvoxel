extends RefCounted
## 3D models of the tech icons (ui piece, Godot-only): one small scene per
## icon name of tech_icons.gd, built from code (lofted blades, lathed shields
## and bowls, swept shafts, horns and snakes, bevelled extrusions) with real
## materials (metal with a hammered normal map, wood, leather, cloth, glass,
## glowing fire / souls / lightning). TechIcons.render_models() lights them
## in a studio (a softbox sky for the metal's reflections, a key light with
## shadows, a rim light in the tile's family colour) and bakes each into the
## picture a command button shows, so the icons are rendered like the game's
## 3D portraits and not flat vector glyphs.
##
##   TechModels.build("t_weapons_bronze") -> Node3D (null: no model, the SVG glyph is used)
##
## Space: x right, y up, z toward the camera; a model fills about [-1, 1]^2.

const TIER_METAL := {
	"copper": Color(0.96, 0.5, 0.3),
	"bronze": Color(1.0, 0.76, 0.34),
	"iron": Color(0.72, 0.76, 0.82),
}
const GOLD := Color(1.0, 0.78, 0.36)
const STEEL := Color(0.78, 0.8, 0.84)
const DARK_IRON := Color(0.34, 0.35, 0.38)
const WOOD := Color(0.3, 0.16, 0.07)
const DARK_WOOD := Color(0.22, 0.12, 0.06)
const LEATHER := Color(0.36, 0.2, 0.1)
const CLOTH_RED := Color(0.62, 0.06, 0.04)

## Godot's front faces wind clockwise: a triangle whose (b-a)x(c-a) points
## along its normal is flipped (see _tri)
const WIND := 1.0

static var _mats := {}
static var _texs := {}

# ---- materials -----------------------------------------------------------------------

static func _noise_normal(kind: String) -> Texture2D:
	if _texs.has(kind):
		return _texs[kind]
	var n := FastNoiseLite.new()
	n.seed = 7
	match kind:
		"hammer":
			n.noise_type = FastNoiseLite.TYPE_CELLULAR
			n.frequency = 0.09
			n.cellular_return_type = FastNoiseLite.RETURN_DISTANCE
		"grain":
			n.noise_type = FastNoiseLite.TYPE_SIMPLEX
			n.frequency = 0.03
		_:
			n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
			n.frequency = 0.08
	var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
	for y in 128:
		for x in 128:
			var v: float
			if kind == "grain":
				# wood: long streaks (stretched noise, then ring bands)
				var q := n.get_noise_2d(x * 0.25, y * 4.0)
				v = 0.5 + 0.5 * sin(q * 9.0 + x * 0.35)
			else:
				v = 0.5 + 0.5 * n.get_noise_2d(x, y)
			img.set_pixel(x, y, Color(v, v, v))
	img.bump_map_to_normal_map(2.0 if kind == "hammer" else 1.2)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_texs[kind] = t
	return t

static func _base(key: String) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.uv1_triplanar = true
	m.uv1_scale = Vector3(3, 3, 3)
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	_mats[key] = m
	return m

## Polished metal (a tier's copper / bronze / iron, gold, steel), hammered.
static func metal(c: Color, rough := 0.3) -> StandardMaterial3D:
	var key := "metal:%s:%.2f" % [c.to_html(), rough]
	if _mats.has(key):
		return _mats[key]
	var m := _base(key)
	m.albedo_color = c
	m.metallic = 1.0
	m.metallic_specular = 0.6
	m.roughness = rough
	m.normal_enabled = true
	m.normal_texture = _noise_normal("hammer")
	m.normal_scale = 0.35
	return m

## A non-metal surface (wood, leather, cloth, stone, skin, fruit).
static func mat(c: Color, rough := 0.6, kind := "") -> StandardMaterial3D:
	var key := "mat:%s:%.2f:%s" % [c.to_html(), rough, kind]
	if _mats.has(key):
		return _mats[key]
	var m := _base(key)
	m.albedo_color = c
	m.roughness = rough
	if kind == "wood":
		m.normal_enabled = true
		m.normal_texture = _noise_normal("grain")
		m.normal_scale = 0.6
		m.uv1_scale = Vector3(2, 2, 2)
	elif kind == "rough":
		m.normal_enabled = true
		m.normal_texture = _noise_normal("soft")
		m.normal_scale = 0.8
	elif kind == "vc":
		m.vertex_color_use_as_albedo = true
	return m

## Vertex-coloured (painted shield faces, targets, fruit) surface.
static func painted(rough := 0.45, metallic := 0.0) -> StandardMaterial3D:
	var key := "painted:%.2f:%.2f" % [rough, metallic]
	if _mats.has(key):
		return _mats[key]
	var m := _base(key)
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = true
	m.roughness = rough
	m.metallic = metallic
	return m

## Glowing: fire, souls, lightning, magic (unshaded, vertex colours with alpha).
static func glow(c: Color, alpha := false) -> StandardMaterial3D:
	var key := "glow:%s:%s" % [c.to_html(), alpha]
	if _mats.has(key):
		return _mats[key]
	var m := _base(key)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = true
	if alpha:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.cull_mode = BaseMaterial3D.CULL_DISABLED
		m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return m

## Glass (the hourglass): see-through with a sharp reflection.
static func glass(c: Color, a := 0.28) -> StandardMaterial3D:
	var key := "glass:%s:%.2f" % [c.to_html(), a]
	if _mats.has(key):
		return _mats[key]
	var m := _base(key)
	m.albedo_color = Color(c, a)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.roughness = 0.04
	m.metallic = 0.2
	m.metallic_specular = 1.0
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m

# ---- mesh building ------------------------------------------------------------------
# An accumulator {v, n, c} of triangles (unindexed); grids of rows compute their
# own smooth normals, oriented away from a centre per row.

static func _acc() -> Dictionary:
	return {"v": PackedVector3Array(), "n": PackedVector3Array(), "c": PackedColorArray()}

static func _tri(acc: Dictionary, a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, ca := Color.WHITE, cb := Color.WHITE, cc := Color.WHITE) -> void:
	var fn := (b - a).cross(c - a)
	if fn.dot(na + nb + nc) * WIND > 0.0:
		var t := b
		b = c
		c = t
		var tn := nb
		nb = nc
		nc = tn
		var tc := cb
		cb = cc
		cc = tc
	acc.v.append_array([a, b, c])
	acc.n.append_array([na, nb, nc])
	acc.c.append_array([ca, cb, cc])

## Add a grid: rows[i] = PackedVector3Array (all the same size); wrap closes
## each row into a ring; centres[i]: a point the row's normals face away from
## (one per row, or one for all); cols: rows of Colors (optional).
static func _grid(acc: Dictionary, rows: Array, wrap: bool, centres: PackedVector3Array, cols: Array = []) -> void:
	var nr := rows.size()
	if nr < 2:
		return
	var nc: int = rows[0].size()
	var nrm := []
	for i in nr:
		var r := PackedVector3Array()
		r.resize(nc)
		nrm.append(r)
	var ncell := nc if wrap else nc - 1
	for i in nr - 1:
		var r0: PackedVector3Array = rows[i]
		var r1: PackedVector3Array = rows[i + 1]
		for j in ncell:
			var j1 := (j + 1) % nc
			var fn1 := (r0[j1] - r0[j]).cross(r1[j1] - r0[j])
			var fn2 := (r1[j1] - r0[j]).cross(r1[j] - r0[j])
			nrm[i][j] += fn1 + fn2
			nrm[i][j1] += fn1
			nrm[i + 1][j1] += fn1 + fn2
			nrm[i + 1][j] += fn2
	# orientation: the whole grid faces away from its centres
	var score := 0.0
	for i in nr:
		var ctr: Vector3 = centres[mini(i, centres.size() - 1)]
		for j in nc:
			score += nrm[i][j].dot(rows[i][j] - ctr)
	var sgn := 1.0 if score >= 0.0 else -1.0
	for i in nr:
		for j in nc:
			var v: Vector3 = nrm[i][j]
			nrm[i][j] = v.normalized() * sgn if v.length_squared() > 1e-14 else Vector3.ZERO
	# rows that collapse to a point (a pole) take their neighbours' normals
	for i in nr:
		for j in nc:
			if nrm[i][j] == Vector3.ZERO:
				var k := i + 1 if i + 1 < nr else i - 1
				nrm[i][j] = nrm[k][j] if nrm[k][j] != Vector3.ZERO else Vector3.BACK
	var has_c := cols.size() == nr
	for i in nr - 1:
		for j in ncell:
			var j1 := (j + 1) % nc
			var a: Vector3 = rows[i][j]
			var b: Vector3 = rows[i][j1]
			var c: Vector3 = rows[i + 1][j1]
			var d: Vector3 = rows[i + 1][j]
			var ca: Color = cols[i][j] if has_c else Color.WHITE
			var cb: Color = cols[i][j1] if has_c else Color.WHITE
			var cc: Color = cols[i + 1][j1] if has_c else Color.WHITE
			var cd: Color = cols[i + 1][j] if has_c else Color.WHITE
			if (a - b).length_squared() > 1e-12:
				_tri(acc, a, b, c, nrm[i][j], nrm[i][j1], nrm[i + 1][j1], ca, cb, cc)
			if (c - d).length_squared() > 1e-12:
				_tri(acc, a, c, d, nrm[i][j], nrm[i + 1][j1], nrm[i + 1][j], ca, cc, cd)

static func _mesh(acc: Dictionary) -> ArrayMesh:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = acc.v
	arr[Mesh.ARRAY_NORMAL] = acc.n
	arr[Mesh.ARRAY_COLOR] = acc.c
	var m := ArrayMesh.new()
	if acc.v.size() > 0:
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

## Sweep a section along a path: rad(t) -> Vector2(half width, half
## thickness), t in 0..1 along the path; the thickness axis is `up` made
## perpendicular to the path (z: flat things facing the camera). sides 4 +
## sharp: a diamond blade with crisp edges and ridge.
static func tube_acc(acc: Dictionary, path: PackedVector3Array, rad: Callable, sides := 12, up := Vector3(0, 0, 1), sharp := false, cols: Callable = Callable(), phase := 0.0) -> void:
	var n := path.size()
	var rows := []
	var crow := []
	var ctr := PackedVector3Array()
	for i in n:
		var t := float(i) / float(n - 1)
		var T := (path[mini(i + 1, n - 1)] - path[maxi(i - 1, 0)]).normalized()
		var Z := up - T * up.dot(T)
		if Z.length_squared() < 1e-6:
			Z = T.cross(Vector3.RIGHT)
		Z = Z.normalized()
		var X := T.cross(Z).normalized()
		var r: Vector2 = rad.call(t)
		var row := PackedVector3Array()
		var cr := []
		for k in sides:
			var a := TAU * k / sides + phase
			row.append(path[i] + X * cos(a) * r.x + Z * sin(a) * r.y)
			if cols.is_valid():
				cr.append(cols.call(t, a))
		rows.append(row)
		crow.append(cr)
		ctr.append(path[i])
	if not sharp:
		_grid(acc, rows, true, ctr, crow if cols.is_valid() else [])
		return
	for k in sides:
		var k1 := (k + 1) % sides
		var strip := []
		var cs := []
		for i in n:
			strip.append(PackedVector3Array([rows[i][k], rows[i][k1]]))
			if cols.is_valid():
				cs.append([crow[i][k], crow[i][k1]])
		_grid(acc, strip, false, ctr, cs)

static func tube(path: PackedVector3Array, rad: Callable, sides := 12, up := Vector3(0, 0, 1), sharp := false, cols: Callable = Callable(), phase := 0.0) -> ArrayMesh:
	var acc := _acc()
	tube_acc(acc, path, rad, sides, up, sharp, cols, phase)
	return _mesh(acc)

## A body of revolution round y: prof = [Vector2(radius, y), ...] bottom to top.
## disp(theta, i) -> radius factor (flutes, lobes); cols(i, theta) -> Color.
static func lathe(prof: Array, sides := 40, disp: Callable = Callable(), cols: Callable = Callable()) -> ArrayMesh:
	var acc := _acc()
	var rows := []
	var crow := []
	var ctr := PackedVector3Array()
	for i in prof.size():
		var p: Vector2 = prof[i]
		var row := PackedVector3Array()
		var cr := []
		for k in sides:
			var a := TAU * k / sides
			var f := 1.0 if not disp.is_valid() else float(disp.call(a, i))
			row.append(Vector3(cos(a) * p.x * f, p.y, sin(a) * p.x * f))
			if cols.is_valid():
				cr.append(cols.call(i, a))
		rows.append(row)
		crow.append(cr)
		ctr.append(Vector3(0, p.y, 0))
	_grid(acc, rows, true, ctr, crow if cols.is_valid() else [])
	return _mesh(acc)

## A disc facing +z: height h(r, theta) above z = 0 at radius r (0..R), colour cols(r, theta).
static func disc(R: float, h: Callable, rings := 28, sides := 72, cols: Callable = Callable()) -> ArrayMesh:
	var acc := _acc()
	var rows := []
	var crow := []
	for i in rings + 1:
		var r := R * float(i) / rings
		var row := PackedVector3Array()
		var cr := []
		for k in sides:
			var a := TAU * k / sides
			row.append(Vector3(cos(a) * r, sin(a) * r, float(h.call(r, a))))
			if cols.is_valid():
				cr.append(cols.call(r, a))
		rows.append(row)
		crow.append(cr)
	_grid(acc, rows, true, PackedVector3Array([Vector3(0, 0, -50)]), crow if cols.is_valid() else [])
	return _mesh(acc)

## A bevelled extrusion of a 2D outline (xy, any winding) from z = -d to +d,
## the front edge chamfered by `bev` (vertex-wise inset, fine for gentle shapes).
static func extrude(poly: PackedVector2Array, d: float, bev := 0.0, col := Color.WHITE) -> ArrayMesh:
	var acc := _acc()
	extrude_acc(acc, poly, d, bev, col)
	return _mesh(acc)

static func extrude_acc(acc: Dictionary, poly: PackedVector2Array, d: float, bev := 0.0, col := Color.WHITE, z0 := 0.0) -> void:
	var p := poly
	if Geometry2D.is_polygon_clockwise(p):
		p = p.duplicate()
		p.reverse()
	var n := p.size()
	# inset outline (per-vertex miter, clamped)
	var ins := PackedVector2Array()
	for i in n:
		var a := p[(i - 1 + n) % n]
		var b := p[i]
		var c := p[(i + 1) % n]
		var e0 := (b - a).normalized()
		var e1 := (c - b).normalized()
		var n0 := Vector2(-e0.y, e0.x)
		var n1 := Vector2(-e1.y, e1.x)
		var m := (n0 + n1)
		if m.length_squared() < 1e-6:
			m = n0
		m = m.normalized()
		var s := clampf(1.0 / maxf(m.dot(n0), 0.25), 1.0, 3.0)
		ins.append(b + m * bev * s)
	var tris := Geometry2D.triangulate_polygon(ins if bev > 0.0 else p)
	var fz := z0 + d
	var bz := z0 - d
	var cap: PackedVector2Array = ins if bev > 0.0 else p
	for t in range(0, tris.size(), 3):
		var a2 := cap[tris[t]]
		var b2 := cap[tris[t + 1]]
		var c2 := cap[tris[t + 2]]
		_tri(acc, Vector3(a2.x, a2.y, fz), Vector3(b2.x, b2.y, fz), Vector3(c2.x, c2.y, fz), Vector3.BACK, Vector3.BACK, Vector3.BACK, col, col, col)
		var pa := p[tris[t]] if bev > 0.0 else a2
		var pb := p[tris[t + 1]] if bev > 0.0 else b2
		var pc := p[tris[t + 2]] if bev > 0.0 else c2
		if bev <= 0.0:
			pa = a2
			pb = b2
			pc = c2
		_tri(acc, Vector3(pa.x, pa.y, bz), Vector3(pb.x, pb.y, bz), Vector3(pc.x, pc.y, bz), Vector3.FORWARD, Vector3.FORWARD, Vector3.FORWARD, col, col, col)
	# the back cap uses the outer outline: triangulate it separately when bevelled
	if bev > 0.0:
		pass
	for i in n:
		var i1 := (i + 1) % n
		var a := p[i]
		var b := p[i1]
		var e := (b - a).normalized()
		var on := Vector3(e.y, -e.x, 0.0)   # outward for a counter-clockwise outline
		var fz2 := fz - bev
		var A0 := Vector3(a.x, a.y, bz)
		var B0 := Vector3(b.x, b.y, bz)
		var A1 := Vector3(a.x, a.y, fz2)
		var B1 := Vector3(b.x, b.y, fz2)
		_tri(acc, A0, B0, B1, on, on, on, col, col, col)
		_tri(acc, A0, B1, A1, on, on, on, col, col, col)
		if bev > 0.0:
			var A2 := Vector3(ins[i].x, ins[i].y, fz)
			var B2 := Vector3(ins[i1].x, ins[i1].y, fz)
			var bn := (on + Vector3.BACK).normalized()
			_tri(acc, A1, B1, B2, bn, bn, bn, col, col, col)
			_tri(acc, A1, B2, A2, bn, bn, bn, col, col, col)

# ---- paths ---------------------------------------------------------------------------

static func line(a: Vector3, b: Vector3, n := 8) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in n + 1:
		out.append(a.lerp(b, float(i) / n))
	return out

static func bez(a: Vector3, b: Vector3, c: Vector3, d: Vector3, n := 24) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in n + 1:
		var t := float(i) / n
		var u := 1.0 - t
		out.append(a * u * u * u + b * 3.0 * u * u * t + c * 3.0 * u * t * t + d * t * t * t)
	return out

## A helix round the y axis (the Asclepius snake): r, from y0 to y1, turns.
static func helix(r: float, y0: float, y1: float, turns: float, n := 80, phase := 0.0) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in n + 1:
		var t := float(i) / n
		var a := phase + TAU * turns * t
		out.append(Vector3(cos(a) * r, lerpf(y0, y1, t), sin(a) * r))
	return out

# ---- scene helpers --------------------------------------------------------------------

static func put(root: Node3D, mesh: Mesh, m: Material, xf := Transform3D()) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = m
	mi.transform = xf
	root.add_child(mi)
	return mi

static func sphere(r: float, h := -1.0) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = r
	s.height = 2.0 * r if h < 0.0 else h
	s.radial_segments = 32
	s.rings = 16
	return s

static func box(sz: Vector3) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = sz
	return b

static func cyl(r0: float, r1: float, h: float, seg := 24) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = r1
	c.bottom_radius = r0
	c.height = h
	c.radial_segments = seg
	c.rings = 1
	return c

static func torus(r_in: float, r_out: float) -> TorusMesh:
	var t := TorusMesh.new()
	t.inner_radius = r_in
	t.outer_radius = r_out
	t.rings = 48
	t.ring_segments = 12
	return t

## A transform placing +y along `dir` at `pos` (cylinders and cones along a direction).
static func along(pos: Vector3, dir: Vector3) -> Transform3D:
	var y := dir.normalized()
	var x := y.cross(Vector3(0, 0, 1))
	if x.length_squared() < 1e-6:
		x = Vector3.RIGHT
	x = x.normalized()
	var z := x.cross(y).normalized()
	return Transform3D(Basis(x, y, z), pos)

# ---- shared parts ----------------------------------------------------------------------

## A leaf-shaped blade profile: width at s (0 base .. 1 tip).
static func _leaf(s: float, w: float, belly := 0.45) -> float:
	if s <= 0.0 or s >= 1.0:
		return 0.0
	# rises fast to the belly, then tapers to the point
	if s < belly:
		return w * sin(PI * 0.5 * s / belly) ** 0.7
	return w * (1.0 - (s - belly) / (1.0 - belly)) ** 0.85

## A spear from butt a to tip b: a wooden shaft, a socket, a leaf head (diamond
## section, sharp edges) of length hl and half width hw, a butt spike.
static func spear(root: Node3D, a: Vector3, b: Vector3, m: Material, hl := 0.55, hw := 0.15, shaft_r := 0.055, wood: Material = null, belly := 0.4) -> void:
	var d := (b - a).normalized()
	var base := b - d * hl
	if wood == null:
		wood = mat(WOOD, 0.62, "wood")
	put(root, tube(line(a + d * 0.06, base, 6), func(_t): return Vector2(shaft_r, shaft_r), 10), wood)
	put(root, tube(line(base - d * 0.12, base + d * 0.05, 4), func(t): return Vector2.ONE * lerpf(shaft_r * 1.35, shaft_r * 0.95, t), 12), m)
	put(root, tube(line(base, b, 24), func(t): var w: float = _leaf(t, hw, belly); return Vector2(w, w * 0.3 + 0.004), 4, Vector3(0, 0, 1), true), m)
	put(root, tube(line(a, a + d * 0.12, 4), func(t): return Vector2.ONE * lerpf(0.004, shaft_r * 1.2, t), 10), m)

## An upright xiphos (leaf blade) with its hilt; centre of the guard at g, length L.
static func sword(root: Node3D, g: Vector3, dir: Vector3, L: float, w: float, m: Material, hilt: Material, grip: Material = null) -> void:
	var d := dir.normalized()
	put(root, tube(line(g, g + d * L, 28), func(t): var ww: float = w * (0.78 + 0.22 * sin(PI * clampf(t / 0.75, 0.0, 1.0))) * (1.0 if t < 0.72 else (1.0 - (t - 0.72) / 0.28) ** 0.9); return Vector2(ww, ww * 0.22 + 0.006), 4, Vector3(0, 0, 1), true), m)
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	put(root, tube(line(g - x * w * 2.3, g + x * w * 2.3, 6), func(t): return Vector2.ONE * (0.045 + 0.02 * absf(t - 0.5) * 2.0), 10), hilt)
	if grip == null:
		grip = mat(LEATHER, 0.7, "rough")
	put(root, tube(line(g - d * 0.04, g - d * 0.3, 6), func(_t): return Vector2(0.04, 0.04), 10), grip)
	put(root, sphere(0.07), hilt, Transform3D(Basis(), g - d * 0.34))

## An arrow from nock a to tip b: a shaft, a head, fletching.
static func arrow(root: Node3D, a: Vector3, b: Vector3, head: Material, shaft: Material, fletch: Color, hl := 0.24, hw := 0.09) -> void:
	var d := (b - a).normalized()
	var base := b - d * hl
	put(root, tube(line(a, base, 6), func(_t): return Vector2(0.026, 0.026), 8), shaft)
	put(root, tube(line(base - d * 0.02, b, 12), func(t): var w: float = hw * (1.0 - t) ** 0.8 if t > 0.2 else hw * t / 0.2; return Vector2(w, w * 0.25 + 0.005), 4, Vector3(0, 0, 1), true), head)
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	var fm := mat(fletch, 0.8)
	for s in [-1.0, 1.0]:
		var p := PackedVector2Array()
		var o := a + d * 0.03
		var vtx := [o, o + d * 0.24, o + d * 0.2 + x * s * 0.09, o + x * s * 0.1 - d * 0.02]
		var acc := _acc()
		var nn := Vector3(0, 0, 1)
		_tri(acc, vtx[0], vtx[1], vtx[2], nn, nn, nn)
		_tri(acc, vtx[0], vtx[2], vtx[3], nn, nn, nn)
		_tri(acc, vtx[0], vtx[2], vtx[1], -nn, -nn, -nn)
		_tri(acc, vtx[0], vtx[3], vtx[2], -nn, -nn, -nn)
		put(root, _mesh(acc), fm)
		p.clear()

## Flames: tongues rising from points, vertex-coloured (white-yellow core to
## red, fading); base positions, heights, a sway, the up direction.
static func flames(root: Node3D, base: Vector3, spread: float, height: float, n := 5, up := Vector3.UP, seed := 1) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var acc := _acc()
	var side := up.cross(Vector3(0, 0, 1)).normalized()
	for k in n:
		var f := (float(k) / maxf(1.0, n - 1)) - 0.5 if n > 1 else 0.0
		var o := base + side * f * spread * 2.0 + Vector3(0, 0, rng.randf_range(-0.05, 0.05))
		var h := height * (1.0 - absf(f) * 0.9) * rng.randf_range(0.8, 1.1)
		var sway := rng.randf_range(-0.25, 0.25) * height
		var p := bez(o, o + up * h * 0.35, o + up * h * 0.7 + side * sway, o + up * h + side * sway * 1.4, 16)
		var w := spread * (0.55 if n > 1 else 1.0) * rng.randf_range(0.8, 1.1)
		tube_acc(acc, p, func(t): var ww: float = w * sin(PI * clampf(t * 0.9 + 0.1, 0.0, 1.0)) ** 0.6 * (1.0 - t * 0.6); return Vector2(ww, ww * 0.55), 10, Vector3(0, 0, 1), false,
			func(t, _a): return Color(Color(1.0, 0.62, 0.1).lerp(Color(0.9, 0.18, 0.02), clampf(t * 1.4, 0.0, 1.0)), clampf(1.1 - t, 0.0, 1.0) * 0.95))
	put(root, _mesh(acc), glow(Color.WHITE, true))
	# an inner bright core
	var core := _acc()
	var cp := bez(base, base + up * height * 0.15, base + up * height * 0.3, base + up * height * 0.42, 12)
	tube_acc(core, cp, func(t): var ww: float = spread * 0.42 * sin(PI * clampf(t * 0.9 + 0.1, 0.0, 1.0)) ** 0.6; return Vector2(ww, ww * 0.5), 10, Vector3(0, 0, 1), false,
		func(t, _a): return Color(Color(1.0, 0.95, 0.55).lerp(Color(1.0, 0.7, 0.15), t), 1.0 - t * 0.5))
	var mi := put(root, _mesh(core), glow(Color.WHITE, true))
	mi.position += Vector3(0, 0, 0.12)

# ---- the models ------------------------------------------------------------------------

## The 3D model of an icon name, or null (the SVG glyph is used instead).
static func build(name: String) -> Node3D:
	var root := Node3D.new()
	root.name = name
	var parts := name.split("_")
	if parts.size() == 3 and parts[0] == "t" and TIER_METAL.has(parts[2]):
		match parts[1]:
			"weapons":
				_weapons(root, parts[2])
			"armor":
				_armor(root, parts[2])
			"shields":
				_shields(root, parts[2])
			_:
				return null
		return root
	if not _custom(name, root):
		root.free()
		return null
	return root

## The icons with their own model (else: false, the SVG glyph stays).
static func _custom(name: String, root: Node3D) -> bool:
	match name:
		"t_ballistics": _m_ballistics(root)
		"t_burning_pitch": _m_burning_pitch(root)
		"t_phobos": _m_phobos(root)
		"t_deimos": _m_deimos(root)
		"t_enyo": _m_enyo(root)
		"t_sarissa": _m_sarissa(root)
		"t_aegis": _m_aegis(root)
		"t_sun_ray": _m_sun_ray(root)
		"t_shafts_of_plague": _m_shafts_of_plague(root)
		"t_forge_of_olympus": _m_forge_of_olympus(root)
		"t_olympian_weapons": _m_olympian_weapons(root)
		"t_harvest_of_souls": _m_harvest_of_souls(root)
		"t_tax_collectors": _m_tax_collectors(root)
		"t_ambassadors": _m_scroll(root, true)
		"t_scroll": _m_scroll(root, false)
		"t_coinage": _m_coinage(root)
		"t_omniscience": _m_omniscience(root)
		"t_olympian_parentage": _m_olympian_parentage(root)
		"t_labyrinth": _m_labyrinth(root)
		"t_sylvan_lore": _m_sylvan_lore(root)
		"t_will_of_kronos": _m_will_of_kronos(root)
		"t_hymn": _m_hymn(root)
		"t_oracle": _m_oracle(root)
		"t_temple_of_healing": _m_temple_of_healing(root)
		"t_golden_apples": _m_golden_apples(root)
		"t_dionysia": _m_dionysia(root)
		"t_face_of_the_gorgon": _m_face_of_the_gorgon(root)
		"t_monstrous_rage": _m_monstrous_rage(root)
		"t_pious_sacrifice": _m_pious_sacrifice(root)
		_:
			return false
	return true

static func _weapons(root: Node3D, tier: String) -> void:
	var m := metal(TIER_METAL[tier], 0.3 if tier != "iron" else 0.22)
	match tier:
		"copper":
			spear(root, Vector3(-0.95, -0.95, 0), Vector3(0.95, 0.95, 0), m, 0.85, 0.25, 0.065)
		"bronze":
			spear(root, Vector3(-0.95, -0.95, -0.05), Vector3(0.95, 0.95, -0.05), m, 0.7, 0.21)
			spear(root, Vector3(0.95, -0.95, 0.05), Vector3(-0.95, 0.95, 0.05), m, 0.7, 0.21)
			# red horsehair tassels under the heads
			for s in [-1.0, 1.0]:
				var o := Vector3(0.4 * s, 0.4, 0.1)
				put(root, tube(bez(o, o + Vector3(0.02 * s, -0.1, 0.02), o + Vector3(0.06 * s, -0.22, 0.02), o + Vector3(0.1 * s, -0.32, 0.0), 10), func(t): return Vector2.ONE * lerpf(0.05, 0.015, t), 8), mat(CLOTH_RED, 0.85, "rough"))
		_:
			spear(root, Vector3(-0.95, -0.95, -0.12), Vector3(0.9, 0.9, -0.12), m, 0.62, 0.19)
			spear(root, Vector3(0.95, -0.95, -0.12), Vector3(-0.9, 0.9, -0.12), m, 0.62, 0.19)
			sword(root, Vector3(0, -0.42, 0.12), Vector3.UP, 1.38, 0.15, metal(Color(0.85, 0.88, 0.92), 0.16), metal(GOLD, 0.3))

static func _armor(root: Node3D, tier: String) -> void:
	var m := metal(TIER_METAL[tier], 0.32 if tier != "iron" else 0.24)
	var strong := 1.0 if tier == "copper" else 1.35
	# the cuirass: a front shell, x = u * half width(y), bulging toward the camera
	var nu := 36
	var nv := 40
	var rows := []
	for j in nv + 1:
		var v := float(j) / nv
		var row := PackedVector3Array()
		for i in nu + 1:
			var u := lerpf(-1.0, 1.0, float(i) / nu)
			# the top edge: shoulders high, the neck dipped
			var ytop := 0.92 - 0.26 * exp(-u * u / 0.09) - 0.05 * u * u
			var ybot := -0.95 + 0.06 * u * u
			var y := lerpf(ybot, ytop, v)
			# half width: hips, waist, chest, then the armholes cut in near the top
			var hw := 0.66 - 0.06 * sin(clampf((y + 0.6) / 0.9, 0.0, 1.0) * PI) + 0.08 * clampf((y - 0.05) / 0.35, 0.0, 1.0)
			if y > 0.42:
				hw -= 0.28 * ((y - 0.42) / 0.5) ** 1.4
			var x := u * hw
			var z := 0.5 * sqrt(maxf(0.0, 1.0 - u * u)) ** 0.9
			# muscles: pectorals, the abdominal grid, the centre groove
			var pec := exp(-((x - 0.25) ** 2 + (y - 0.38) ** 2 * 1.6) / 0.03) + exp(-((x + 0.25) ** 2 + (y - 0.38) ** 2 * 1.6) / 0.03)
			var abs_ := 0.0
			for ay in [0.08, -0.18, -0.44]:
				for ax in [-0.12, 0.12]:
					abs_ += exp(-((x - ax) ** 2 + (y - ay) ** 2 * 0.8) / 0.008)
			z += (0.09 * pec + 0.035 * abs_) * strong
			z -= 0.04 * exp(-x * x / 0.002) * clampf((0.55 - y) * 2.0, 0.0, 1.0)
			# the flared lip at the hem
			z += 0.08 * clampf((-0.75 - y) / 0.2, 0.0, 1.0)
			row.append(Vector3(x, y, z))
		rows.append(row)
	var acc := _acc()
	_grid(acc, rows, false, PackedVector3Array([Vector3(0, 0, -2)]))
	var shell := put(root, _mesh(acc), m)
	(shell.material_override as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
	# a rolled rim along the edges (thickness and a bright line)
	var rim := PackedVector3Array()
	for i in nu + 1:
		rim.append(rows[nv][i])
	var rimb := PackedVector3Array()
	for i in nu + 1:
		rimb.append(rows[0][i])
	var rl := PackedVector3Array()
	for j in nv + 1:
		rl.append(rows[j][0])
	var rr := PackedVector3Array()
	for j in nv + 1:
		rr.append(rows[j][nu])
	var rim_m := m if tier == "copper" else metal(GOLD if tier == "iron" else TIER_METAL[tier].lightened(0.1), 0.25)
	for pth in [rim, rimb, rl, rr]:
		put(root, tube(pth, func(_t): return Vector2(0.03, 0.03), 8), rim_m)
	if tier != "copper":
		# shoulder guards: curved plates over each shoulder
		for s in [-1.0, 1.0]:
			var p := bez(Vector3(0.12 * s, 0.86, -0.1), Vector3(0.36 * s, 1.02, 0.1), Vector3(0.56 * s, 0.92, 0.22), Vector3(0.66 * s, 0.6, 0.2), 16)
			put(root, tube(p, func(t): return Vector2(0.15 + 0.04 * sin(t * PI), 0.035), 12, Vector3(0, 1, 0.6)), m)
			put(root, sphere(0.05), metal(GOLD, 0.25), Transform3D(Basis(), Vector3(0.5 * s, 0.84, 0.3)))
	if tier == "bronze":
		# a gorgoneion medallion on the chest
		put(root, disc(0.13, func(r, _a): return 0.05 * (1.0 - (r / 0.13) ** 2) + 0.02, 8, 32), metal(GOLD, 0.2), Transform3D(Basis(), Vector3(0, 0.2, 0.54)))
		put(root, torus(0.12, 0.155), metal(GOLD, 0.25), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0.2, 0.56)))
	if tier == "iron":
		# pteruges: leather strips hanging below the hem, studded
		for k in 7:
			var f := lerpf(-1.0, 1.0, k / 6.0)
			var x := f * 0.56
			var z := 0.36 * sqrt(maxf(0.0, 1.0 - f * f * 0.85)) + 0.05
			var len_ := 0.32 - 0.06 * absf(f)
			put(root, box(Vector3(0.15, len_, 0.03)), mat(Color(0.34, 0.17, 0.08), 0.75, "rough"), Transform3D(Basis(Vector3.UP, -f * 0.9), Vector3(x, -0.95 - len_ * 0.5, z)))
			put(root, sphere(0.025), metal(GOLD, 0.3), Transform3D(Basis(), Vector3(x, -1.05 - len_ * 0.5, z + 0.03)))
		for s in [-1.0, 1.0]:
			for yy in [0.2, -0.2, -0.6]:
				put(root, sphere(0.028), metal(GOLD, 0.25), Transform3D(Basis(), Vector3(0.52 * s, yy, 0.22)))
	root.rotation = Vector3(0.08, -0.3, 0)

static func _shields(root: Node3D, tier: String) -> void:
	var m := metal(TIER_METAL[tier], 0.3 if tier != "iron" else 0.24)
	var R := 1.0
	match tier:
		"copper":
			# a plain hoplon: a domed face with turned rings, a broad flat rim, a boss
			put(root, disc(R, func(r, _a): return _hoplon(r) + (0.012 * sin(r * 40.0) if r < 0.7 else 0.0), 40, 72), m)
			put(root, sphere(0.14, 0.14), m, Transform3D(Basis(), Vector3(0, 0, 0.26)))
		"bronze":
			# gold, a star / sunburst raised on the face
			var star := func(r: float, a: float) -> float:
				var k := absf(cos(4.0 * a))
				var edge := 0.3 + 0.36 * k ** 3.0
				return 0.055 * smoothstep(edge + 0.05, edge - 0.05, r)
			var starc := func(r: float, a: float) -> Color:
				return Color(1.0, 0.78, 0.36) if r > 0.8 or star.call(r, a) > 0.02 else Color(0.08, 0.1, 0.22)
			put(root, disc(R, func(r, a): return _hoplon(r) + star.call(r, a), 56, 192, starc), painted(0.3, 1.0))
			put(root, sphere(0.12, 0.14), metal(Color(0.85, 0.2, 0.12), 0.25), Transform3D(Basis(), Vector3(0, 0, 0.3)))
		_:
			# iron: a painted face (crimson, a silver lambda) on a steel rim with rivets
			var col := func(r: float, _a: float) -> Color:
				return Color(0.55, 0.06, 0.04) if r < 0.8 else Color.WHITE
			put(root, disc(0.82, func(r, _a): return _hoplon(r), 32, 72, col), painted(0.5))
			put(root, disc(R, func(r, _a): return _hoplon(r) - (0.0 if r > 0.8 else 0.05), 40, 72), m)
			for k in 12:
				var a := TAU * k / 12.0
				put(root, sphere(0.04), metal(Color(0.9, 0.92, 0.95), 0.2), Transform3D(Basis(), Vector3(cos(a) * 0.9, sin(a) * 0.9, _hoplon(0.9) + 0.02)))
			var lam := PackedVector2Array([Vector2(-0.38, -0.42), Vector2(-0.2, -0.42), Vector2(0, 0.08), Vector2(0.2, -0.42), Vector2(0.38, -0.42), Vector2(0.08, 0.48), Vector2(-0.08, 0.48)])
			put(root, extrude(lam, 0.02, 0.015), metal(Color(0.88, 0.9, 0.94), 0.2), Transform3D(Basis(), Vector3(0, 0, _hoplon(0.0) - 0.01)))
	root.rotation = Vector3(-0.15, -0.42, 0)

## The hoplon's profile: a dome to r 0.8, a broad flat rim to 1.
static func _hoplon(r: float) -> float:
	if r < 0.8:
		return 0.06 + 0.2 * (1.0 - (r / 0.8) ** 2)
	return 0.06 - 0.06 * ((r - 0.8) / 0.2) ** 2

# ---- Armory: siege and god techs -----------------------------------------------------

## Glowing wisps (souls, mist, terror): soft tapered tubes along curves, fading.
static func wisps(root: Node3D, paths: Array, w: float, c0: Color, c1: Color) -> void:
	var acc := _acc()
	for pth in paths:
		tube_acc(acc, pth, func(t): var ww: float = w * sin(PI * clampf(t, 0.0, 1.0)) ** 0.5 * (1.15 - t * 0.7); return Vector2(ww, ww * 0.6), 10, Vector3(0, 0, 1), false,
			func(t, _a): return Color(c0.lerp(c1, t), (1.0 - t) * 0.85 + 0.1))
	put(root, _mesh(acc), glow(Color.WHITE, true))

static func _m_ballistics(root: Node3D) -> void:
	# a straw target in its wooden ring, an arrow in the bull's-eye
	var col := func(r: float, _a: float) -> Color:
		if r < 0.15:
			return Color(0.95, 0.72, 0.12)
		if r < 0.31:
			return Color(0.62, 0.04, 0.03)
		if r < 0.47:
			return Color(0.9, 0.84, 0.68)
		if r < 0.63:
			return Color(0.62, 0.04, 0.03)
		return Color(0.88, 0.8, 0.62)
	var tgt := Node3D.new()
	root.add_child(tgt)
	tgt.transform = Transform3D(Basis(Vector3.UP, -0.55), Vector3(0.18, -0.12, 0))
	put(tgt, disc(0.78, func(r, _a): return 0.12 * (1.0 - (r / 0.78) ** 2), 30, 72, col), painted(0.8))
	put(tgt, torus(0.76, 0.9), mat(WOOD, 0.6, "wood"), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0, 0.0)))
	put(tgt, box(Vector3(0.12, 0.7, 0.1)), mat(WOOD, 0.6, "wood"), Transform3D(Basis(Vector3.FORWARD, 0.4), Vector3(-0.3, -0.85, -0.1)))
	put(tgt, box(Vector3(0.12, 0.7, 0.1)), mat(WOOD, 0.6, "wood"), Transform3D(Basis(Vector3.FORWARD, -0.4), Vector3(0.3, -0.85, -0.1)))
	arrow(root, Vector3(-1.0, 0.92, 0.75), Vector3(0.12, -0.05, 0.12), metal(STEEL, 0.25), mat(Color(0.5, 0.32, 0.16), 0.6, "wood"), Color(0.75, 0.08, 0.05), 0.2, 0.08)
	# a second arrow, already in the target
	arrow(root, Vector3(-0.2, 1.0, 0.6), Vector3(0.38, 0.28, 0.06), metal(STEEL, 0.25), mat(Color(0.5, 0.32, 0.16), 0.6, "wood"), Color(0.92, 0.88, 0.8), 0.2, 0.08)

static func _m_burning_pitch(root: Node3D) -> void:
	# a broad steel arrowhead and its pitch-soaked wrap, ablaze
	var a := Vector3(-0.95, -0.95, 0)
	var b := Vector3(0.95, 0.95, 0)
	arrow(root, a, b, metal(Color(0.8, 0.82, 0.86), 0.2), mat(Color(0.42, 0.26, 0.12), 0.6, "wood"), Color(0.9, 0.86, 0.78), 0.5, 0.24)
	var w := Vector3(0.3, 0.3, 0)
	put(root, tube(line(w - Vector3(0.14, 0.14, 0), w + Vector3(0.1, 0.1, 0), 6), func(t): return Vector2.ONE * (0.07 + 0.04 * sin(t * PI)), 10), mat(Color(0.06, 0.04, 0.03), 0.25))
	flames(root, w + Vector3(-0.05, 0.05, 0.1), 0.26, 0.95, 5, Vector3(-0.4, 1.0, 0).normalized(), 3)
	flames(root, w + Vector3(-0.3, -0.2, 0.15), 0.16, 0.55, 3, Vector3(-0.6, 1.0, 0).normalized(), 5)

static func _m_phobos(root: Node3D) -> void:
	# Phobos' spear: upright, a long barbed head of dark steel, its edge glowing
	# red, red pennons streaming from the socket
	var dark := metal(Color(0.42, 0.38, 0.4), 0.25)
	var a := Vector3(-0.22, -1.0, 0)
	var b := Vector3(0.16, 1.0, 0)
	spear(root, a, b, dark, 1.05, 0.32, 0.065, mat(Color(0.12, 0.06, 0.05), 0.5, "wood"), 0.35)
	var d := (b - a).normalized()
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	var base := b - d * 0.95
	# the glowing fuller along the blade
	put(root, tube(line(base + d * 0.08, b - d * 0.08, 10), func(t): return Vector2.ONE * (0.025 * sin(PI * t) + 0.004), 6), glow(Color(1.0, 0.25, 0.08)), Transform3D(Basis(), Vector3(0, 0, 0.07)))
	# barbs sweeping back from the head's base
	for s in [-1.0, 1.0]:
		var o := base + d * 0.06
		put(root, tube(bez(o, o + x * s * 0.14, o + x * s * 0.24 - d * 0.06, o + x * s * 0.28 - d * 0.22, 10), func(t): return Vector2(lerpf(0.05, 0.004, t), lerpf(0.02, 0.003, t)), 4, Vector3(0, 0, 1), true), dark)
	# gold rings
	for k in 3:
		put(root, torus(0.055, 0.085), metal(GOLD, 0.25), along(base - d * (0.2 + k * 0.08), d))
	# pennons
	var o2 := base - d * 0.2
	var p := bez(o2, o2 + Vector3(-0.3, 0.05, 0.1), o2 + Vector3(-0.45, -0.3, 0.05), o2 + Vector3(-0.7, -0.35, 0.0), 16)
	put(root, tube(p, func(t): return Vector2(0.11 * (1.0 - t * 0.5), 0.012), 6, Vector3(0, 0, 1)), mat(Color(0.7, 0.05, 0.03), 0.7, "rough"))

static func _m_deimos(root: Node3D) -> void:
	# Deimos' sword: a forward-curved kopis, the blade widening to its belly
	var g := Vector3(-0.42, -0.5, 0)
	var p := bez(g, g + Vector3(0.3, 0.5, 0), g + Vector3(0.95, 0.95, 0), g + Vector3(1.38, 1.4, 0), 30)
	put(root, tube(p, func(t): var w: float = (0.1 + 0.12 * t ** 1.3) * (1.0 if t < 0.82 else (1.0 - (t - 0.82) / 0.18) ** 0.8); return Vector2(w, w * 0.18 + 0.006), 4, Vector3(0, 0, 1), true), metal(Color(0.86, 0.88, 0.93), 0.34))
	var d := (p[1] - p[0]).normalized()
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	put(root, tube(line(g - x * 0.26, g + x * 0.26, 6), func(t): return Vector2.ONE * (0.05 + 0.03 * absf(t - 0.5) * 2.0), 10), metal(GOLD, 0.28))
	var hp := bez(g, g - d * 0.15, g - d * 0.32 - x * 0.02, g - d * 0.42 - x * 0.12, 10)
	put(root, tube(hp, func(_t): return Vector2(0.055, 0.05), 10), mat(Color(0.18, 0.08, 0.2), 0.6, "rough"))
	put(root, sphere(0.08), metal(GOLD, 0.25), Transform3D(Basis(), hp[hp.size() - 1]))
	wisps(root, [bez(Vector3(-0.1, 0.4, -0.1), Vector3(-0.4, 0.6, 0), Vector3(-0.2, 0.9, 0), Vector3(-0.6, 1.05, 0), 12),
		bez(Vector3(0.5, -0.1, -0.1), Vector3(0.8, -0.3, 0), Vector3(0.7, -0.6, 0), Vector3(1.0, -0.8, 0), 12),
		bez(Vector3(0.2, 0.1, -0.2), Vector3(0.1, -0.3, -0.1), Vector3(0.4, -0.5, 0), Vector3(0.3, -0.95, 0), 12)], 0.11, Color(0.85, 0.5, 1.0), Color(0.3, 0.05, 0.5))

static func _m_enyo(root: Node3D) -> void:
	# Enyo's bow: a recurve drawn, the arrow level, its head glowing
	var top := Vector3(-0.32, 0.98, 0)
	var bot := Vector3(-0.32, -0.98, 0)
	var limb := func(sgn: float) -> PackedVector3Array:
		return bez(Vector3(0.18, 0, 0), Vector3(0.22, 0.45 * sgn, 0), Vector3(-0.05, 0.85 * sgn, 0), Vector3(-0.32, 0.98 * sgn, 0), 20)
	var wood := mat(Color(0.2, 0.09, 0.05), 0.45, "wood")
	for sgn in [1.0, -1.0]:
		put(root, tube(limb.call(sgn), func(t): return Vector2(lerpf(0.095, 0.04, t), lerpf(0.075, 0.035, t)), 10), wood)
		put(root, tube(bez(Vector3(-0.32, 0.98 * sgn, 0), Vector3(-0.4, 1.02 * sgn, 0), Vector3(-0.46, 0.98 * sgn, 0), Vector3(-0.47, 0.9 * sgn, 0), 8), func(t): return Vector2.ONE * lerpf(0.032, 0.012, t), 8), mat(Color(0.92, 0.88, 0.76), 0.35))
	put(root, tube(line(Vector3(0.19, -0.16, 0), Vector3(0.19, 0.16, 0), 4), func(_t): return Vector2(0.085, 0.08), 12), mat(Color(0.5, 0.08, 0.06), 0.6, "rough"))
	var nock := Vector3(-0.72, 0, 0.02)
	var sm := mat(Color(0.95, 0.92, 0.84), 0.5)
	put(root, tube(line(top, nock, 6), func(_t): return Vector2(0.012, 0.012), 6), sm)
	put(root, tube(line(nock, bot, 6), func(_t): return Vector2(0.012, 0.012), 6), sm)
	arrow(root, nock, Vector3(0.98, 0, 0.04), metal(Color(0.85, 0.25, 0.2), 0.25), mat(Color(0.5, 0.32, 0.16), 0.6, "wood"), Color(0.15, 0.1, 0.1), 0.3, 0.12)
	put(root, sphere(0.1), glow(Color(1.0, 0.4, 0.3)), Transform3D(Basis(), Vector3(0.82, 0, 0.04)))
	root.rotation = Vector3(0, -0.35, 0)

static func _m_sarissa(root: Node3D) -> void:
	# a fan of three long pikes behind a small bronze shield
	var m := metal(Color(0.8, 0.82, 0.86), 0.22)
	spear(root, Vector3(-0.12, -1.0, -0.1), Vector3(-0.8, 0.98, -0.1), m, 0.36, 0.11, 0.045)
	spear(root, Vector3(0.0, -1.0, -0.05), Vector3(0.0, 1.0, -0.05), m, 0.36, 0.11, 0.045)
	spear(root, Vector3(0.12, -1.0, -0.1), Vector3(0.8, 0.98, -0.1), m, 0.36, 0.11, 0.045)
	var sh := Node3D.new()
	root.add_child(sh)
	sh.transform = Transform3D(Basis(Vector3.UP, -0.3).scaled(Vector3(0.48, 0.48, 0.48)), Vector3(0, -0.45, 0.25))
	put(sh, disc(1.0, func(r, _a): return _hoplon(r), 32, 64), metal(TIER_METAL.bronze, 0.3))
	put(sh, disc(0.55, func(r, _a): return _hoplon(r) + 0.01, 16, 64, func(r, a): return Color(0.55, 0.04, 0.03) if r > 0.25 or absf(sin(a * 4.0)) > 0.5 else Color(0.95, 0.9, 0.8)), painted(0.45))

static func _m_aegis(root: Node3D) -> void:
	# Athena's aegis: a golden shield ringed with snakes, a gorgon boss, a ward of light behind
	var sh := Node3D.new()
	root.add_child(sh)
	sh.transform = Transform3D(Basis(Vector3.UP, -0.38) * Basis(Vector3.RIGHT, -0.12), Vector3.ZERO)
	put(sh, disc(0.86, func(r, _a): return _hoplon(r / 0.86 * 0.95) * 0.9, 36, 72), metal(GOLD, 0.24))
	# the snake rim: a scaly green body winding round the edge
	var ring := PackedVector3Array()
	for k in 145:
		var a := TAU * k / 144.0
		var rr := 0.9 + 0.035 * sin(a * 14.0)
		ring.append(Vector3(cos(a) * rr, sin(a) * rr, 0.06 + 0.04 * cos(a * 14.0)))
	put(sh, tube(ring, func(_t): return Vector2(0.07, 0.07), 10), metal(Color(0.3, 0.62, 0.22), 0.35))
	for k in 4:
		var a := TAU * k / 4.0 + 0.5
		var o := Vector3(cos(a), sin(a), 0) * 0.92
		put(sh, sphere(0.1, 0.16), metal(Color(0.3, 0.62, 0.22), 0.3), Transform3D(Basis(Vector3(0, 0, 1), a), o + Vector3(0, 0, 0.1)))
	# the boss: a silver disc ringed in gold
	put(sh, disc(0.3, func(r, _a): return 0.24 + 0.1 * (1.0 - (r / 0.3) ** 2), 12, 48), metal(Color(0.85, 0.87, 0.9), 0.2))
	put(sh, torus(0.28, 0.34), metal(GOLD, 0.25), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0, 0.25)))
	put(sh, sphere(0.07), metal(GOLD, 0.2), Transform3D(Basis(), Vector3(0, 0, 0.35)))
	# the ward of light behind it
	put(root, torus(0.98, 1.08), glow(Color(0.7, 0.85, 1.0)), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0, -0.35)))

static func _m_sun_ray(root: Node3D) -> void:
	# Apollo's sun: a blazing disc throwing long rays, a golden arrow across it
	var acc := _acc()
	for k in 16:
		var a := TAU * k / 16.0 + 0.1
		var L := 1.0 if k % 2 == 0 else 0.7
		var d := Vector3(cos(a), sin(a), 0)
		tube_acc(acc, line(d * 0.3, d * L, 6), func(t): return Vector2(0.09 * (1.0 - t) + 0.005, 0.02), 6, Vector3(0, 0, 1), false,
			func(t, _a): return Color(Color(1.0, 0.95, 0.6).lerp(Color(1.0, 0.6, 0.1), t), 1.0 - t * 0.9))
	put(root, _mesh(acc), glow(Color.WHITE, true), Transform3D(Basis(), Vector3(0, 0, -0.2)))
	var col := func(i: int, _a: float) -> Color:
		return Color(1.0, 1.0, 0.88).lerp(Color(1.0, 0.7, 0.15), clampf(float(i) / 16.0, 0.0, 1.0))
	var prof := []
	for i in 17:
		var t := float(i) / 16.0
		prof.append(Vector2(0.42 * sin(t * PI * 0.5), 0.42 * cos(t * PI * 0.5)))
	put(root, lathe(prof, 40, Callable(), col), glow(Color.WHITE), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3.ZERO))
	put(root, torus(0.42, 0.5), metal(GOLD, 0.2), Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0, 0.02)))
	arrow(root, Vector3(-0.95, -0.7, 0.45), Vector3(0.98, 0.72, 0.45), metal(GOLD, 0.2), metal(Color(0.9, 0.7, 0.35), 0.35), Color(1.0, 0.9, 0.6), 0.3, 0.12)

static func _m_shafts_of_plague(root: Node3D) -> void:
	# two arrows, their heads coated in glowing green venom, dripping
	var head := metal(Color(0.3, 0.34, 0.3), 0.3)
	var shaft := mat(Color(0.4, 0.28, 0.14), 0.6, "wood")
	for k in 2:
		var o := Vector3(0.28 * k - 0.1, -0.28 * k + 0.05, 0.08 * k)
		var a := Vector3(-0.95, -0.85, 0) + o
		var b := Vector3(0.75, 0.85, 0) + o
		arrow(root, a, b, head, shaft, Color(0.25, 0.4, 0.1), 0.32, 0.14)
		put(root, tube(line(b - (b - a).normalized() * 0.34, b - (b - a).normalized() * 0.04, 8), func(t): return Vector2(0.09 * (1.0 - t) + 0.03, 0.05), 8), glow(Color(0.45, 1.0, 0.25)))
		for j in 2:
			var dp := b - (b - a).normalized() * (0.18 + j * 0.12) + Vector3(0.02, -0.12 - j * 0.15, 0.06)
			put(root, sphere(0.045, 0.12), glow(Color(0.5, 1.0, 0.3)), Transform3D(Basis(), dp))
	wisps(root, [bez(Vector3(0.6, 0.6, 0), Vector3(0.9, 0.9, 0), Vector3(0.6, 1.0, 0), Vector3(0.95, 1.05, 0), 12),
		bez(Vector3(0.9, 0.3, 0), Vector3(1.0, 0.6, 0), Vector3(0.8, 0.75, 0), Vector3(1.05, 0.95, 0), 12)], 0.1, Color(0.6, 1.0, 0.3), Color(0.1, 0.4, 0.05))

static func _m_forge_of_olympus(root: Node3D) -> void:
	# an anvil with a glowing ingot, the hammer raised above it, sparks
	var prof := PackedVector2Array([Vector2(-1.0, 0.12), Vector2(-0.45, 0.02), Vector2(-0.38, 0.2), Vector2(0.72, 0.2), Vector2(0.72, -0.04), Vector2(0.42, -0.1),
		Vector2(0.3, -0.36), Vector2(0.52, -0.62), Vector2(-0.52, -0.62), Vector2(-0.3, -0.36), Vector2(-0.4, -0.1), Vector2(-0.6, -0.06)])
	put(root, extrude(prof, 0.24, 0.04), metal(Color(0.32, 0.33, 0.36), 0.34), Transform3D(Basis(Vector3.UP, -0.45), Vector3(0, -0.25, 0)))
	put(root, box(Vector3(0.5, 0.1, 0.18)), glow(Color(1.0, 0.55, 0.15)), Transform3D(Basis(Vector3.UP, -0.45), Vector3(0.05, 0.0, 0.05)))
	var hm := Node3D.new()
	root.add_child(hm)
	hm.transform = Transform3D(Basis(Vector3(0, 0, 1), 0.65), Vector3(0.35, 0.6, 0.2))
	put(hm, box(Vector3(0.42, 0.22, 0.22)), metal(Color(0.62, 0.64, 0.68), 0.3), Transform3D(Basis(), Vector3(0, 0.25, 0)))
	put(hm, cyl(0.045, 0.04, 0.85), mat(WOOD, 0.6, "wood"), Transform3D(Basis(), Vector3(0.0, -0.18, 0)))
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	for k in 10:
		var a := rng.randf_range(0.3, 2.8)
		var r := rng.randf_range(0.2, 0.7)
		put(root, sphere(rng.randf_range(0.018, 0.035)), glow(Color(1.0, 0.75, 0.3)), Transform3D(Basis(), Vector3(cos(a) * r, 0.05 + sin(a) * r * 0.8, 0.25)))

static func _bolt(root: Node3D, a: Vector3, b: Vector3, w: float, seed := 1) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var d := b - a
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	var pts := PackedVector3Array()
	for k in 7:
		var t := k / 6.0
		var off := 0.0 if k == 0 or k == 6 else (w if k % 2 == 1 else -w) * rng.randf_range(0.6, 1.0)
		pts.append(a + d * t + x * off)
	put(root, tube(pts, func(t): return Vector2.ONE * lerpf(0.06, 0.012, t), 8), glow(Color(0.85, 0.95, 1.0)))
	put(root, tube(pts, func(t): return Vector2.ONE * lerpf(0.13, 0.03, t), 8, Vector3(0, 0, 1), false, func(_t, _a): return Color(0.5, 0.75, 1.0, 0.35)), glow(Color.WHITE, true))

static func _m_olympian_weapons(root: Node3D) -> void:
	# a gleaming sword with a golden hilt between two lightning bolts
	sword(root, Vector3(0, -0.5, 0.05), Vector3.UP, 1.45, 0.16, metal(Color(0.88, 0.9, 0.95), 0.12), metal(GOLD, 0.22), mat(Color(0.25, 0.12, 0.45), 0.6, "rough"))
	_bolt(root, Vector3(-0.45, 1.0, -0.1), Vector3(-0.75, -0.6, -0.1), 0.14, 2)
	_bolt(root, Vector3(0.5, 1.0, -0.1), Vector3(0.78, -0.55, -0.1), 0.14, 5)

static func _m_harvest_of_souls(root: Node3D) -> void:
	# a scythe, souls rising from its blade
	var a := Vector3(0.55, -1.0, 0)
	var b := Vector3(-0.2, 0.92, 0)
	put(root, tube(bez(a, a + Vector3(-0.1, 0.6, 0), b + Vector3(0.05, -0.6, 0), b, 12), func(_t): return Vector2(0.055, 0.055), 10), mat(Color(0.22, 0.12, 0.06), 0.55, "wood"))
	var bl := bez(b + Vector3(0.02, -0.02, 0), b + Vector3(0.55, 0.15, 0), b + Vector3(0.95, -0.15, 0), b + Vector3(1.05, -0.62, 0), 24)
	put(root, tube(bl, func(t): var w: float = 0.15 * (1.0 - t) ** 0.7 + 0.004; return Vector2(w, 0.022), 4, Vector3(0, 0, 1), true), metal(Color(0.72, 0.75, 0.8), 0.2))
	put(root, torus(0.05, 0.08), metal(Color(0.5, 0.5, 0.55), 0.3), along(b, Vector3(0.4, -1, 0)))
	wisps(root, [bez(Vector3(-0.6, -0.8, 0.1), Vector3(-0.9, -0.3, 0.1), Vector3(-0.5, 0.0, 0.1), Vector3(-0.8, 0.45, 0.1), 14),
		bez(Vector3(0.1, -0.6, 0.15), Vector3(-0.2, -0.2, 0.15), Vector3(0.2, 0.0, 0.15), Vector3(0.0, 0.4, 0.15), 14),
		bez(Vector3(-0.3, -0.95, 0.05), Vector3(-0.5, -0.6, 0.05), Vector3(-0.2, -0.45, 0.05), Vector3(-0.35, -0.1, 0.05), 14)], 0.13, Color(0.75, 1.0, 0.95), Color(0.2, 0.7, 0.8))
	for p in [Vector3(-0.8, 0.45, 0.12), Vector3(0.0, 0.4, 0.17), Vector3(-0.35, -0.1, 0.07)]:
		put(root, sphere(0.09), glow(Color(0.85, 1.0, 1.0)), Transform3D(Basis(), p))

# ---- Market ----------------------------------------------------------------------------

static func coin(root: Node3D, xf: Transform3D, r := 0.24) -> void:
	var prof := [Vector2(0.0, -0.035), Vector2(r * 0.98, -0.035), Vector2(r, -0.02), Vector2(r, 0.02), Vector2(r * 0.98, 0.035), Vector2(r * 0.86, 0.035), Vector2(r * 0.82, 0.024), Vector2(r * 0.45, 0.03), Vector2(r * 0.3, 0.05), Vector2(0.0, 0.05)]
	put(root, lathe(prof, 32), metal(GOLD, 0.26), xf)

static func _m_tax_collectors(root: Node3D) -> void:
	# a fat leather purse tied with a gold cord, coins spilling at its foot
	var prof := []
	for i in 25:
		var t := float(i) / 24.0
		var y := lerpf(-0.82, 0.62, t)
		var r := 0.0
		if t < 0.7:
			r = 0.7 * sin(PI * (t / 0.7) ** 0.8) ** 0.7 + 0.001
		elif t < 0.8:
			r = lerpf(0.12, 0.09, (t - 0.7) / 0.1)
		else:
			r = 0.09 + 0.22 * sin(PI * 0.5 * (t - 0.8) / 0.2)
		prof.append(Vector2(r, y))
	prof.append(Vector2(0.0, 0.6))
	put(root, lathe(prof, 36, func(a, i): return 1.0 + (0.06 * sin(a * 7.0) if i > 19 else 0.02 * sin(a * 3.0))), mat(Color(0.34, 0.18, 0.08), 0.65, "rough"), Transform3D(Basis(), Vector3(-0.1, 0.12, 0)))
	put(root, torus(0.09, 0.16), metal(GOLD, 0.3), Transform3D(Basis().rotated(Vector3.RIGHT, 0.2), Vector3(-0.1, 0.25, 0)))
	put(root, tube(bez(Vector3(0.0, 0.22, 0.12), Vector3(0.15, 0.1, 0.2), Vector3(0.2, -0.05, 0.25), Vector3(0.16, -0.2, 0.3), 10), func(_t): return Vector2(0.025, 0.025), 8), metal(GOLD, 0.3))
	coin(root, Transform3D(Basis(Vector3.RIGHT, 1.2), Vector3(0.55, -0.82, 0.3)))
	coin(root, Transform3D(Basis(Vector3.RIGHT, 1.3), Vector3(0.6, -0.74, 0.3)))
	coin(root, Transform3D(Basis(Vector3.RIGHT, 0.5) * Basis(Vector3(0, 0, 1), 0.4), Vector3(0.78, -0.55, 0.45)))
	coin(root, Transform3D(Basis(Vector3.RIGHT, 1.0) * Basis(Vector3(0, 0, 1), -0.6), Vector3(0.2, -0.85, 0.6)))

static func _m_coinage(root: Node3D) -> void:
	# a stack of gold staters and one standing in front, an owl struck on it
	for k in 6:
		coin(root, Transform3D(Basis(Vector3.UP, k * 0.7), Vector3(-0.3 + 0.03 * sin(k * 2.0), -0.82 + k * 0.075, -0.1 + 0.02 * k)), 0.42)
	var front := Transform3D(Basis(Vector3.UP, -0.35) * Basis(Vector3.RIGHT, PI / 2 - 0.2), Vector3(0.38, -0.12, 0.35))
	coin(root, front, 0.52)
	# Athena's owl struck on its face: a raised silhouette (ear tufts, body)
	var owl := PackedVector2Array([Vector2(-0.16, -0.24), Vector2(-0.2, -0.05), Vector2(-0.17, 0.12), Vector2(-0.15, 0.25), Vector2(-0.07, 0.16), Vector2(0.07, 0.16), Vector2(0.15, 0.25),
		Vector2(0.17, 0.12), Vector2(0.2, -0.05), Vector2(0.16, -0.24), Vector2(0.05, -0.3), Vector2(-0.05, -0.3)])
	var face := Transform3D(Basis(Vector3.UP, -0.35) * Basis(Vector3.RIGHT, -0.2), Vector3(0.38, -0.12, 0.35))
	put(root, extrude(owl, 0.02, 0.018), metal(GOLD.lightened(0.08), 0.22), face * Transform3D(Basis(), Vector3(0, 0, 0.055)))

static func _m_scroll(root: Node3D, sealed: bool) -> void:
	# a parchment scroll half unrolled; an envoy's: a red wax seal and ribbon
	var parch := mat(Color(0.88, 0.8, 0.62), 0.85, "rough")
	var sheet := []
	for j in 13:
		var v := float(j) / 12.0
		var row := PackedVector3Array()
		for i in 13:
			var u := lerpf(-0.7, 0.7, float(i) / 12.0)
			row.append(Vector3(u, lerpf(0.55, -0.6, v), 0.06 * sin(v * PI * 2.0)))
		sheet.append(row)
	var acc := _acc()
	_grid(acc, sheet, false, PackedVector3Array([Vector3(0, 0, -5)]))
	var sm := put(root, _mesh(acc), parch)
	(sm.material_override as StandardMaterial3D).cull_mode = BaseMaterial3D.CULL_DISABLED
	# writing lines
	for k in 5:
		put(root, box(Vector3(0.95 - (0.35 if k == 4 else 0.0), 0.035, 0.01)), mat(Color(0.3, 0.2, 0.12), 0.9), Transform3D(Basis(), Vector3(-0.1 - (0.17 if k == 4 else 0.0), 0.35 - k * 0.17, 0.08 * sin((0.2 + k * 0.14) * PI * 2.0) + 0.02)))
	for y in [0.62, -0.68]:
		put(root, cyl(0.12, 0.12, 1.5, 24), parch, Transform3D(Basis(Vector3(0, 0, 1), PI / 2), Vector3(0, y, 0.05)))
		for s in [-1.0, 1.0]:
			put(root, sphere(0.09), mat(Color(0.3, 0.15, 0.07), 0.4, "wood"), Transform3D(Basis(), Vector3(0.82 * s, y, 0.05)))
	if sealed:
		put(root, tube(bez(Vector3(0.3, -0.3, 0.1), Vector3(0.35, -0.6, 0.15), Vector3(0.25, -0.8, 0.2), Vector3(0.4, -1.0, 0.2), 10), func(_t): return Vector2(0.06, 0.012), 6), mat(Color(0.15, 0.25, 0.6), 0.6))
		put(root, tube(bez(Vector3(0.3, -0.3, 0.1), Vector3(0.45, -0.55, 0.15), Vector3(0.55, -0.75, 0.2), Vector3(0.68, -0.95, 0.2), 10), func(_t): return Vector2(0.06, 0.012), 6), mat(Color(0.15, 0.25, 0.6), 0.6))
		put(root, disc(0.2, func(r, a): return 0.06 * (1.0 - (r / 0.2) ** 3) + 0.01 * sin(a * 9.0) * (r / 0.2), 10, 36), mat(Color(0.65, 0.06, 0.04), 0.35), Transform3D(Basis(), Vector3(0.3, -0.3, 0.12)))
	root.rotation = Vector3(0.1, -0.25, 0.08)

# ---- Temple ----------------------------------------------------------------------------

static func _m_omniscience(root: Node3D) -> void:
	# the all-seeing eye: a glossy eyeball, a glowing blue iris, gold lids, rays
	var col := func(r: float, _a: float) -> Color:
		if r < 0.1:
			return Color(0.01, 0.01, 0.02)
		if r < 0.25:
			return Color(0.1, 0.4, 0.9).lerp(Color(0.5, 0.85, 1.0), (r - 0.1) / 0.15)
		if r < 0.27:
			return Color(0.05, 0.1, 0.2)
		return Color(0.95, 0.93, 0.9)
	put(root, disc(0.55, func(r, _a): return sqrt(maxf(0.0, 0.55 * 0.55 - r * r)) - 0.1, 24, 64, col), painted(0.12))
	for sgn in [1.0, -1.0]:
		var p := bez(Vector3(-1.0, 0, 0.2), Vector3(-0.45, 0.7 * sgn, 0.35), Vector3(0.45, 0.7 * sgn, 0.35), Vector3(1.0, 0, 0.2), 28)
		put(root, tube(p, func(t): return Vector2.ONE * (0.05 + 0.05 * sin(t * PI)), 10), metal(GOLD, 0.22))
	var acc := _acc()
	for k in 12:
		var a := TAU * k / 12.0 + PI / 12.0
		var d := Vector3(cos(a) * 1.0, sin(a) * 0.85, 0)
		tube_acc(acc, line(d * 0.6, d * (1.05 if k % 2 == 0 else 0.85), 4), func(t): return Vector2(0.05 * (1.0 - t) + 0.004, 0.02), 6, Vector3(0, 0, 1), false,
			func(t, _a): return Color(Color(1.0, 0.92, 0.6), 1.0 - t * 0.85))
	put(root, _mesh(acc), glow(Color.WHITE, true), Transform3D(Basis(), Vector3(0, 0, -0.1)))
	put(root, sphere(0.05), glow(Color.WHITE), Transform3D(Basis(), Vector3(-0.12, 0.12, 0.5)))

static func _m_olympian_parentage(root: Node3D) -> void:
	# a Corinthian helmet in bronze with a tall red crest
	var dark := func(i: int, a: float) -> Color:
		var y := lerpf(-0.75, 0.62, float(i) / 24.0)
		var da := absf(wrapf(a - PI / 2.0, -PI, PI))
		if y > -0.02 and y < 0.14 and da < 0.95:
			return Color(0.02, 0.015, 0.01)
		if y > -0.62 and y < 0.0 and da < 0.16:
			return Color(0.02, 0.015, 0.01)
		return Color(1.0, 0.78, 0.4)
	var prof := []
	for i in 25:
		var t := float(i) / 24.0
		var y := lerpf(-0.75, 0.62, t)
		var r := 0.52 * sqrt(maxf(0.0, 1.0 - ((y - 0.0) / 0.64) ** 2)) if y > 0.0 else 0.52 - 0.06 * (-y / 0.75)
		if i == 24:
			r = 0.0
		prof.append(Vector2(r, y))
	put(root, lathe(prof, 48, func(a, i): return 1.0 + (0.12 * clampf((0.3 - float(i) / 24.0) * 3.0, 0.0, 1.0) if absf(wrapf(a - PI / 2.0, -PI, PI)) > 2.2 else 0.0), dark), painted(0.28, 1.0))
	var crest := bez(Vector3(0, 0.45, 0.42), Vector3(0, 1.05, 0.3), Vector3(0, 1.05, -0.6), Vector3(0, 0.15, -0.85), 24)
	put(root, tube(crest, func(t): return Vector2(0.05, 0.22 * sin(PI * clampf(t * 0.9 + 0.08, 0.0, 1.0)) ** 0.5 + 0.02), 12, Vector3(1, 0, 0)), mat(Color(0.72, 0.05, 0.03), 0.8, "rough"))
	put(root, tube(bez(Vector3(0, 0.5, 0.4), Vector3(0, 0.7, 0.35), Vector3(0, 0.75, -0.3), Vector3(0, 0.55, -0.55), 16), func(_t): return Vector2(0.06, 0.035), 8, Vector3(1, 0, 0)), metal(GOLD, 0.25))
	root.rotation = Vector3(0.05, 0.75, 0)

static func _m_labyrinth(root: Node3D) -> void:
	# the Labyrinth of Minos seen from above: stone walls on a slab, a glow at its heart
	var stone := mat(Color(0.82, 0.74, 0.6), 0.85, "rough")
	put(root, box(Vector3(2.0, 0.12, 2.0)), mat(Color(0.38, 0.3, 0.22), 0.9, "rough"), Transform3D(Basis(), Vector3(0, -0.06, 0)))
	var walls := [
		[-0.95, -0.95, 0.95, -0.95], [0.95, -0.95, 0.95, 0.95], [0.95, 0.95, -0.95, 0.95], [-0.95, 0.95, -0.95, -0.55],
		[-0.65, -0.65, 0.35, -0.65], [0.65, -0.65, 0.65, 0.65], [0.65, 0.65, -0.65, 0.65], [-0.65, 0.65, -0.65, -0.65],
		[-0.35, -0.35, 0.35, -0.35], [0.35, -0.35, 0.35, 0.35], [0.35, 0.35, -0.1, 0.35], [-0.35, 0.35, -0.35, -0.35],
		[0.35, -0.65, 0.35, -0.45], [-0.65, 0.05, -0.35, 0.05]]
	for w in walls:
		var a := Vector3(w[0], 0.12, w[1])
		var b := Vector3(w[2], 0.12, w[3])
		var c := (a + b) * 0.5
		var sz := Vector3(absf(b.x - a.x) + 0.12, 0.24, absf(b.z - a.z) + 0.12)
		put(root, box(sz), stone, Transform3D(Basis(), c))
	put(root, sphere(0.1), glow(Color(1.0, 0.5, 0.2)), Transform3D(Basis(), Vector3(0, 0.12, 0)))
	root.rotation = Vector3(0.95, 0.4, 0)

static func _m_sylvan_lore(root: Node3D) -> void:
	# an oak sprig: a curved twig, glossy lobed leaves, an acorn
	var stem := bez(Vector3(-0.85, -0.95, 0), Vector3(-0.4, -0.3, 0), Vector3(0.1, 0.3, 0), Vector3(0.75, 0.9, 0), 20)
	put(root, tube(stem, func(t): return Vector2.ONE * lerpf(0.05, 0.02, t), 8), mat(Color(0.35, 0.22, 0.1), 0.7, "wood"))
	var leaf_m := mat(Color(0.22, 0.55, 0.12), 0.35)
	var leaves := [[0.25, 1.0, 0.75], [0.4, -1.0, 0.8], [0.55, 1.0, 0.7], [0.7, -1.0, 0.65], [0.9, 1.0, 0.55], [0.12, -1.0, 0.6]]
	for lf in leaves:
		var t: float = lf[0]
		var i := int(t * 20)
		var o: Vector3 = stem[i]
		var d: Vector3 = (stem[mini(i + 1, 20)] - stem[maxi(i - 1, 0)]).normalized()
		var x := d.cross(Vector3(0, 0, 1)) * float(lf[1])
		var L: float = lf[2]
		var tip := o + (x * 0.85 + d * 0.5).normalized() * L
		var mid := bez(o, o + x * L * 0.3 + d * 0.1, tip - d * 0.1 + Vector3(0, 0, 0.1), tip, 20)
		put(root, tube(mid, func(s): var w: float = 0.2 * L * sin(PI * clampf(s, 0.0, 1.0)) ** 0.8 * (1.0 + 0.18 * sin(s * 30.0)); return Vector2(w, 0.012), 4, Vector3(0, 0, 1), true), leaf_m)
	var ac := stem[20]
	put(root, sphere(0.13, 0.3), mat(Color(0.55, 0.36, 0.12), 0.35), Transform3D(Basis(Vector3(0, 0, 1), -0.6), ac + Vector3(0.05, -0.12, 0.1)))
	put(root, sphere(0.15, 0.16), mat(Color(0.35, 0.25, 0.12), 0.9, "rough"), Transform3D(Basis(Vector3(0, 0, 1), -0.6), ac + Vector3(-0.02, -0.01, 0.1)))

static func _m_will_of_kronos(root: Node3D) -> void:
	# an hourglass in a gold frame, its sand running
	var gm := metal(GOLD, 0.25)
	for y in [-0.92, 0.92]:
		put(root, cyl(0.62, 0.62, 0.12, 32), gm, Transform3D(Basis(), Vector3(0, y, 0)))
	for k in 3:
		var a := TAU * k / 3.0 + 0.4
		put(root, cyl(0.045, 0.045, 1.8, 10), mat(DARK_WOOD, 0.4, "wood"), Transform3D(Basis(), Vector3(cos(a) * 0.5, 0, sin(a) * 0.5)))
	var prof := []
	for i in 33:
		var t := float(i) / 32.0
		var y := lerpf(-0.86, 0.86, t)
		prof.append(Vector2(0.06 + 0.36 * (absf(y) / 0.86) ** 0.7 * (1.0 - (absf(y) / 0.86) ** 6), y))
	put(root, lathe(prof, 32), glass(Color(0.85, 0.95, 1.0), 0.22))
	var sand := mat(Color(0.95, 0.7, 0.3), 0.8)
	var top := []
	for i in 9:
		var t := float(i) / 8.0
		top.append(Vector2(0.3 * (1.0 - t) ** 0.6 + 0.02 * t, lerpf(0.45, 0.12, t)))
	top.push_front(Vector2(0.0, 0.45))
	put(root, lathe(top, 24), sand)
	put(root, lathe([Vector2(0.0, -0.84), Vector2(0.36, -0.84), Vector2(0.3, -0.7), Vector2(0.12, -0.56), Vector2(0.0, -0.52)], 24), sand)
	put(root, cyl(0.015, 0.015, 0.6, 6), glow(Color(1.0, 0.8, 0.4)), Transform3D(Basis(), Vector3(0, -0.25, 0)))
	root.rotation = Vector3(0.2, 0.3, 0.12)

static func _m_hymn(root: Node3D) -> void:
	# Pan's pipes: seven reeds bound with leather, a vine curling round them
	var reed := mat(Color(0.85, 0.66, 0.36), 0.45, "wood")
	for k in 7:
		var L := 1.7 - k * 0.17
		var x := -0.6 + k * 0.2
		put(root, cyl(0.09, 0.09, L, 16), reed, Transform3D(Basis(), Vector3(x, 0.85 - L * 0.5, 0)))
		put(root, cyl(0.065, 0.065, 0.02, 12), mat(Color(0.1, 0.06, 0.03), 0.9), Transform3D(Basis(), Vector3(x, 0.86, 0)))
		put(root, torus(0.085, 0.11), reed, Transform3D(Basis(), Vector3(x, 0.85 - L * 0.55, 0)))
	put(root, box(Vector3(1.45, 0.14, 0.22)), mat(Color(0.4, 0.2, 0.1), 0.7, "rough"), Transform3D(Basis(), Vector3(0, 0.42, 0)))
	var vine := bez(Vector3(-0.9, -0.6, 0.2), Vector3(-0.2, 0.0, 0.3), Vector3(0.3, 0.1, 0.25), Vector3(0.85, -0.3, 0.2), 16)
	put(root, tube(vine, func(_t): return Vector2.ONE * 0.025, 6), mat(Color(0.25, 0.45, 0.1), 0.5))
	for t in [0.25, 0.55, 0.85]:
		var o: Vector3 = vine[int(t * 16)]
		put(root, tube(bez(o, o + Vector3(0.1, 0.12, 0.05), o + Vector3(0.22, 0.12, 0.05), o + Vector3(0.3, 0.02, 0.05), 10), func(s): var w: float = 0.1 * sin(PI * clampf(s, 0.0, 1.0)); return Vector2(w, 0.012), 4, Vector3(0, 0, 1), true), mat(Color(0.3, 0.6, 0.15), 0.4))
	root.rotation = Vector3(0.1, -0.4, 0.15)

static func _m_oracle(root: Node3D) -> void:
	# the Delphic tripod: a gold bowl on three legs, prophetic vapours rising
	put(root, lathe([Vector2(0.0, 0.0), Vector2(0.3, 0.02), Vector2(0.5, 0.15), Vector2(0.58, 0.32), Vector2(0.62, 0.36), Vector2(0.54, 0.34), Vector2(0.0, 0.3)], 40), metal(GOLD, 0.24))
	for k in 3:
		var a := TAU * k / 3.0 + 0.5
		var top := Vector3(cos(a) * 0.48, 0.12, sin(a) * 0.48)
		var foot := Vector3(cos(a) * 0.62, -1.0, sin(a) * 0.62)
		put(root, tube(bez(top, top + Vector3(0, -0.4, 0), foot + Vector3(cos(a) * -0.2, 0.4, sin(a) * -0.2), foot, 12), func(_t): return Vector2.ONE * 0.04, 8), metal(GOLD.darkened(0.15), 0.3))
		put(root, sphere(0.06), metal(GOLD, 0.3), Transform3D(Basis(), foot))
	flames(root, Vector3(0, 0.32, 0), 0.22, 0.4, 4, Vector3.UP, 7)
	wisps(root, [bez(Vector3(0, 0.5, 0), Vector3(-0.4, 0.7, 0), Vector3(0.3, 0.85, 0), Vector3(-0.2, 1.1, 0), 14),
		bez(Vector3(0.1, 0.5, 0.05), Vector3(0.5, 0.65, 0.05), Vector3(0.1, 0.9, 0.05), Vector3(0.6, 1.05, 0.05), 14),
		bez(Vector3(-0.1, 0.5, -0.05), Vector3(-0.6, 0.55, -0.05), Vector3(-0.5, 0.85, -0.05), Vector3(-0.8, 0.95, -0.05), 14)], 0.13, Color(0.85, 0.8, 1.0), Color(0.45, 0.35, 0.85))
	root.rotation = Vector3(0.25, 0, 0)

static func _m_temple_of_healing(root: Node3D) -> void:
	# the Rod of Asclepius: a knotted staff, a green serpent coiled round it
	put(root, tube(line(Vector3(0, -1.0, 0), Vector3(0, 0.98, 0), 12), func(t): return Vector2.ONE * (0.07 + 0.012 * sin(t * 40.0)), 10), mat(Color(0.38, 0.22, 0.1), 0.65, "wood"))
	put(root, sphere(0.1), mat(Color(0.38, 0.22, 0.1), 0.65, "wood"), Transform3D(Basis(), Vector3(0, 0.98, 0)))
	var h := helix(0.2, -0.8, 0.55, 2.3, 90, -PI / 2.0)
	var snake := mat(Color(0.18, 0.5, 0.12), 0.32, "rough")
	put(root, tube(h, func(t): return Vector2.ONE * lerpf(0.02, 0.075, clampf(t * 3.0, 0.0, 1.0)), 10), snake)
	var hd: Vector3 = h[h.size() - 1]
	var nk := bez(hd, hd + Vector3(0.1, 0.12, 0.1), hd + Vector3(0.22, 0.25, 0.15), hd + Vector3(0.3, 0.32, 0.18), 8)
	put(root, tube(nk, func(_t): return Vector2.ONE * 0.075, 10), snake)
	put(root, sphere(0.11, 0.16), snake, Transform3D(Basis(Vector3(0, 0, 1), -0.5).scaled(Vector3(1.4, 1, 1)), nk[nk.size() - 1] + Vector3(0.05, 0.02, 0)))
	put(root, sphere(0.022), glow(Color(1.0, 0.85, 0.2)), Transform3D(Basis(), nk[nk.size() - 1] + Vector3(0.06, 0.06, 0.07)))
	root.rotation = Vector3(0, 0, -0.18)

static func apple(root: Node3D, xf: Transform3D, m: Material) -> void:
	var prof := []
	for i in 21:
		var t := float(i) / 20.0
		var a := t * PI
		var r := 0.5 * sin(a) * (1.0 + 0.1 * sin(a))
		var y := -0.46 * cos(a) - 0.06 * sin(a) ** 6 * (1.0 if t > 0.5 else -0.5)
		if i == 0:
			y = -0.38
		if i == 20:
			y = 0.32
		prof.append(Vector2(r, y))
	put(root, lathe(prof, 40), m, xf)
	put(root, tube(bez(Vector3(0, 0.3, 0), Vector3(0, 0.45, 0), Vector3(0.05, 0.55, 0), Vector3(0.12, 0.62, 0), 8), func(_t): return Vector2.ONE * 0.03, 6), mat(Color(0.3, 0.18, 0.08), 0.7), xf)
	put(root, tube(bez(Vector3(0.08, 0.5, 0), Vector3(0.25, 0.65, 0.05), Vector3(0.45, 0.62, 0.05), Vector3(0.6, 0.48, 0.0), 12), func(s): var w: float = 0.12 * sin(PI * clampf(s, 0.0, 1.0)) ** 0.8; return Vector2(w, 0.012), 4, Vector3(0, 0, 1), true), mat(Color(0.25, 0.58, 0.12), 0.35), xf)

static func _m_golden_apples(root: Node3D) -> void:
	# the Hesperides' golden apples: polished gold, a leaf on each
	apple(root, Transform3D(Basis().scaled(Vector3.ONE * 1.25), Vector3(0.22, 0.05, -0.2)), metal(GOLD, 0.3))
	apple(root, Transform3D(Basis(Vector3(0, 0, 1), 0.3).scaled(Vector3.ONE * 0.95), Vector3(-0.42, -0.4, 0.35)), metal(GOLD.lightened(0.05), 0.32))

static func _m_dionysia(root: Node3D) -> void:
	# a bunch of glossy dark grapes under a vine leaf
	var gm := mat(Color(0.32, 0.08, 0.42), 0.18)
	var rows := [[4, 0.42], [4, 0.17], [3, -0.08], [3, -0.33], [2, -0.58], [1, -0.83]]
	for ri in rows.size():
		var cnt: int = rows[ri][0]
		var y: float = rows[ri][1]
		for k in cnt:
			var x := (k - (cnt - 1) * 0.5) * 0.25 + (0.06 if ri % 2 == 1 else 0.0)
			put(root, sphere(0.15, 0.32), gm, Transform3D(Basis(), Vector3(x, y, 0.08 * sin(k * 2.0 + ri))))
	var leaf := PackedVector2Array()
	for k in 60:
		var a := TAU * k / 60.0
		var r := 0.45 * (1.0 + 0.25 * cos(a * 5.0)) * (0.9 + 0.1 * sin(a))
		leaf.append(Vector2(cos(a) * r, sin(a) * r * 0.85))
	put(root, extrude(leaf, 0.015, 0.01), mat(Color(0.25, 0.55, 0.12), 0.4), Transform3D(Basis(Vector3(0, 0, 1), 0.4) * Basis(Vector3.RIGHT, -0.5), Vector3(0.45, 0.65, -0.15)))
	put(root, tube(bez(Vector3(0.0, 0.5, 0), Vector3(-0.05, 0.75, 0), Vector3(-0.2, 0.85, 0), Vector3(-0.4, 0.95, 0), 10), func(_t): return Vector2.ONE * 0.04, 8), mat(Color(0.3, 0.2, 0.08), 0.7, "wood"))

static func _m_face_of_the_gorgon(root: Node3D) -> void:
	# Medusa as a cast-bronze gorgoneion: the head a dark metal mask, snakes
	# writhing out of it, only the petrifying eyes alight
	var skin := metal(Color(0.5, 0.56, 0.42), 0.38)
	put(root, sphere(0.4, 0.95), skin, Transform3D(Basis().scaled(Vector3(1.0, 1.0, 0.8)), Vector3(0, -0.12, 0)))
	for s in [-1.0, 1.0]:
		put(root, sphere(0.1, 0.06), mat(Color(0.02, 0.02, 0.02), 0.5), Transform3D(Basis(Vector3(0, 0, 1), -0.35 * s).scaled(Vector3(1.4, 1.0, 1.0)), Vector3(0.15 * s, -0.02, 0.29)))
		put(root, sphere(0.06, 0.05), glow(Color(1.0, 0.92, 0.3)), Transform3D(Basis(Vector3(0, 0, 1), -0.35 * s).scaled(Vector3(1.3, 0.75, 1.0)), Vector3(0.15 * s, -0.02, 0.31)))
	var snake := mat(Color(0.2, 0.45, 0.12), 0.32, "rough")
	var rng := RandomNumberGenerator.new()
	rng.seed = 4
	for k in 11:
		var a := lerpf(-0.45, PI + 0.45, k / 10.0)
		var d := Vector3(cos(a), sin(a) * 0.9 + 0.1, 0.0).normalized()
		var o := Vector3(0, -0.05, 0) + d * 0.34
		var side := Vector3(-d.y, d.x, 0)
		var w := rng.randf_range(0.1, 0.18) * (1.0 if k % 2 == 0 else -1.0)
		var L := rng.randf_range(0.5, 0.7)
		var p := bez(o, o + d * L * 0.35 + side * w, o + d * L * 0.7 - side * w, o + d * L + side * w * 0.6 + Vector3(0, 0, 0.1), 16)
		put(root, tube(p, func(t): return Vector2.ONE * lerpf(0.065, 0.035, t), 8), snake)
		put(root, sphere(0.065, 0.1), snake, Transform3D(Basis(), p[p.size() - 1] + d * 0.03))

static func _m_monstrous_rage(root: Node3D) -> void:
	# a raging bull's head: a broad dark brow, a long muzzle, great horns
	# sweeping up, slit eyes burning red under the brow, a gold nose ring
	var hide := mat(Color(0.26, 0.1, 0.06), 0.55, "rough")
	put(root, sphere(0.45, 0.8), hide, Transform3D(Basis().scaled(Vector3(1.15, 1.0, 0.8)), Vector3(0, 0.28, 0)))
	put(root, tube(line(Vector3(0, 0.2, 0.05), Vector3(0, -0.62, 0.22), 10), func(t): return Vector2(lerpf(0.36, 0.27, t), lerpf(0.3, 0.24, t)), 20), hide)
	put(root, sphere(0.27, 0.36), mat(Color(0.36, 0.18, 0.13), 0.45, "rough"), Transform3D(Basis().scaled(Vector3(1.05, 1.0, 1.0)), Vector3(0, -0.68, 0.25)))
	# the angry brow: a ridge that dips to the middle
	put(root, tube(bez(Vector3(-0.4, 0.3, 0.3), Vector3(-0.15, 0.12, 0.42), Vector3(0.15, 0.12, 0.42), Vector3(0.4, 0.3, 0.3), 12), func(_t): return Vector2.ONE * 0.07, 10), hide)
	for s in [-1.0, 1.0]:
		put(root, sphere(0.045), mat(Color(0.03, 0.01, 0.01), 0.4), Transform3D(Basis(), Vector3(0.11 * s, -0.78, 0.48)))
		put(root, sphere(0.07, 0.05), glow(Color(1.0, 0.18, 0.04)), Transform3D(Basis(Vector3(0, 0, 1), -0.45 * s).scaled(Vector3(1.4, 0.8, 1)), Vector3(0.22 * s, 0.1, 0.36)))
		var o := Vector3(0.4 * s, 0.5, 0.0)
		var horn := bez(o, o + Vector3(0.38 * s, -0.05, 0.05), o + Vector3(0.62 * s, 0.15, 0.1), o + Vector3(0.5 * s, 0.55, 0.12), 18)
		put(root, tube(horn, func(t): return Vector2.ONE * lerpf(0.12, 0.012, t ** 0.9), 12), mat(Color(0.9, 0.84, 0.68), 0.28))
		put(root, sphere(0.1, 0.26), hide, Transform3D(Basis(Vector3(0, 0, 1), 1.1 * s), Vector3(0.52 * s, 0.22, -0.08)))
	put(root, torus(0.08, 0.12), metal(GOLD, 0.25), Transform3D(Basis(), Vector3(0, -0.88, 0.45)))
	wisps(root, [bez(Vector3(-0.5, -0.3, -0.3), Vector3(-0.8, 0.0, -0.3), Vector3(-0.6, 0.4, -0.3), Vector3(-0.95, 0.75, -0.3), 12),
		bez(Vector3(0.5, -0.3, -0.3), Vector3(0.8, 0.0, -0.3), Vector3(0.6, 0.4, -0.3), Vector3(0.95, 0.75, -0.3), 12)], 0.16, Color(1.0, 0.35, 0.1), Color(0.5, 0.0, 0.0))

static func _m_pious_sacrifice(root: Node3D) -> void:
	# a marble altar with its offering ablaze
	var marble := mat(Color(0.9, 0.87, 0.8), 0.35, "rough")
	put(root, box(Vector3(1.5, 0.16, 0.9)), marble, Transform3D(Basis(), Vector3(0, -0.92, 0)))
	put(root, box(Vector3(1.2, 0.72, 0.7)), marble, Transform3D(Basis(), Vector3(0, -0.5, 0)))
	put(root, box(Vector3(1.0, 0.36, 0.05)), mat(Color(0.62, 0.12, 0.08), 0.6), Transform3D(Basis(), Vector3(0, -0.5, 0.36)))
	put(root, box(Vector3(1.45, 0.14, 0.86)), marble, Transform3D(Basis(), Vector3(0, -0.08, 0)))
	for s in [-1.0, 1.0]:
		put(root, cyl(0.1, 0.1, 0.86, 16), marble, Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0.62 * s, 0.02, 0)))
	put(root, box(Vector3(0.7, 0.12, 0.35)), mat(DARK_WOOD, 0.8, "wood"), Transform3D(Basis(Vector3.UP, 0.3), Vector3(0, 0.05, 0)))
	flames(root, Vector3(0, 0.05, 0.05), 0.42, 0.95, 5, Vector3.UP, 9)
	root.rotation = Vector3(0.12, -0.45, 0)
