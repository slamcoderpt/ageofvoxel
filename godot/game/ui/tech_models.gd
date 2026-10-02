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
	"copper": Color(0.92, 0.42, 0.24),
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

## A metal's wear map (grey, multiplies albedo and roughness): broad tarnish
## clouds, fine scratches and pits, so a polished part is not one smooth
## colour (what made gold read as plastic).
static func _wear() -> Texture2D:
	if _texs.has("wear"):
		return _texs["wear"]
	var cloud := FastNoiseLite.new()
	cloud.seed = 3
	cloud.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	cloud.frequency = 0.035
	cloud.fractal_octaves = 4
	var pit := FastNoiseLite.new()
	pit.seed = 9
	pit.noise_type = FastNoiseLite.TYPE_CELLULAR
	pit.frequency = 0.22
	var img := Image.create(128, 128, false, Image.FORMAT_RGBA8)
	for y in 128:
		for x in 128:
			var c := 0.5 + 0.5 * cloud.get_noise_2d(x, y)
			var pv := 0.5 + 0.5 * pit.get_noise_2d(x, y)
			# scratches: thin bright-dark streaks along one axis
			var sc := pow(absf(sin(x * 0.9 + 6.0 * cloud.get_noise_2d(x * 3.0, y * 0.2))), 40.0)
			var v := 0.78 + 0.22 * smoothstep(0.25, 0.75, c) - 0.1 * smoothstep(0.75, 0.95, pv) + 0.08 * sc
			img.set_pixel(x, y, Color(v, v, v))
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_texs["wear"] = t
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
	# sharper than asked (crisp studio reflections read as metal), the wear
	# map breaking it up again
	m.roughness = minf(1.0, rough * 1.25)
	m.albedo_texture = _wear()
	m.roughness_texture = _wear()
	m.normal_enabled = true
	m.normal_texture = _noise_normal("hammer")
	m.normal_scale = 0.6
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

## Plumage / fur: vertex-coloured, soft and matt, with a fine bumpy normal so
## a lit surface breaks into many small highlights instead of one airbrushed sheen.
static func feathers() -> StandardMaterial3D:
	if _mats.has("feathers"):
		return _mats["feathers"]
	var m := _base("feathers")
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = true
	m.roughness = 0.78
	m.normal_enabled = true
	m.normal_texture = _noise_normal("soft")
	m.normal_scale = 0.9
	m.uv1_scale = Vector3(6, 6, 6)
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

## Weapons line: swords (not spears: the god techs own the spear, the pike and
## the bow), copper one xiphos, bronze two crossed, iron two crossed before a
## labrys (the double axe), so a tier reads by count and silhouette.
static func _weapons(root: Node3D, tier: String) -> void:
	var m := metal(TIER_METAL[tier], 0.26 if tier != "iron" else 0.18)
	var hilt := metal(GOLD, 0.24) if tier != "copper" else metal(TIER_METAL.bronze, 0.3)
	var grip := mat(Color(0.32, 0.16, 0.08), 0.75, "rough")
	match tier:
		"copper":
			xiphos(root, Vector3(-0.42, -0.42, 0), Vector3(1, 1, 0), 1.5, 0.2, m, hilt, grip)
		"bronze":
			xiphos(root, Vector3(-0.5, -0.55, -0.05), Vector3(0.8, 1, 0), 1.45, 0.17, m, hilt, grip)
			xiphos(root, Vector3(0.5, -0.55, 0.06), Vector3(-0.8, 1, 0), 1.45, 0.17, m, hilt, grip)
		_:
			# the labrys behind: a shaft and a double crescent head of dark steel
			var ax := Node3D.new()
			root.add_child(ax)
			ax.position = Vector3(0, 0, -0.25)
			put(ax, tube(line(Vector3(0, -1.0, 0), Vector3(0, 0.95, 0), 6), func(_t): return Vector2(0.045, 0.045), 10), mat(DARK_WOOD, 0.55, "wood"))
			var head := PackedVector2Array([Vector2(0.06, 0.44)])
			for k in 25:
				var a := lerpf(-1.05, 1.05, float(k) / 24.0)
				head.append(Vector2(0.06 + 0.66 * cos(a), 0.62 + 0.5 * sin(a)))
			head.append(Vector2(0.06, 0.8))
			var mir := PackedVector2Array()
			for v in head:
				mir.append(Vector2(-v.x, v.y))
			put(ax, extrude(head, 0.04, 0.03), metal(Color(0.5, 0.52, 0.56), 0.22))
			put(ax, extrude(mir, 0.04, 0.03), metal(Color(0.5, 0.52, 0.56), 0.22))
			put(ax, cyl(0.08, 0.08, 0.34, 16), metal(GOLD, 0.3), Transform3D(Basis(), Vector3(0, 0.62, 0)))
			xiphos(root, Vector3(-0.5, -0.6, 0.12), Vector3(0.8, 1, 0), 1.4, 0.16, m, hilt, grip)
			xiphos(root, Vector3(0.5, -0.6, 0.2), Vector3(-0.8, 1, 0), 1.4, 0.16, m, hilt, grip)
	root.rotation = Vector3(0.0, -0.25, 0)

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
			z += (0.15 * pec + 0.065 * abs_) * strong
			z -= 0.05 * exp(-x * x / 0.002) * clampf((0.55 - y) * 2.0, 0.0, 1.0)
			# the lower edge of the ribcage: an arch ridge under the pectorals
			z += 0.035 * exp(-pow(y - (0.2 - 0.35 * x * x), 2.0) / 0.0025) * clampf(1.0 - absf(x) / 0.5, 0.0, 1.0) * strong
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
	# two engraved bands above the hem (a raised pair of beads)
	for jj in [3, 6]:
		var band := PackedVector3Array()
		for i in nu + 1:
			band.append(rows[jj][i] + Vector3(0, 0, 0.012))
		put(root, tube(band, func(_t): return Vector2(0.018, 0.018), 6), rim_m)
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

## Shields line: a hoplon turned three quarters (its thick rolled rim shows,
## so it reads as a shield, never a target), each tier its blazon: copper a
## raised crescent, bronze a gold star on dark blue enamel, iron a silver
## lambda on crimson with a steel rim and rivets.
static func _shields(root: Node3D, tier: String) -> void:
	var m := metal(TIER_METAL[tier], 0.26 if tier != "iron" else 0.2)
	var R := 1.0
	match tier:
		"copper":
			put(root, disc(R, func(r, _a): return _hoplon(r), 40, 72), m)
			var cres := PackedVector2Array()
			for k in 33:
				var a := lerpf(-2.3, 2.3, float(k) / 32.0)
				cres.append(Vector2(cos(a) * 0.52, sin(a) * 0.52))
			for k in 33:
				var a := lerpf(2.0, -2.0, float(k) / 32.0)
				cres.append(Vector2(cos(a) * 0.4 + 0.16, sin(a) * 0.4))
			put(root, extrude(cres, 0.035, 0.03), metal(GOLD, 0.2), Transform3D(Basis(Vector3(0, 0, 1), PI * 0.5), Vector3(0, 0, _hoplon(0.0) - 0.02)))
		"bronze":
			var star := func(r: float, a: float) -> float:
				var k := absf(cos(4.0 * a))
				var edge := 0.3 + 0.36 * k ** 3.0
				return 0.055 * smoothstep(edge + 0.05, edge - 0.05, r)
			var starc := func(r: float, a: float) -> Color:
				return Color(1.0, 0.78, 0.36) if r > 0.8 or star.call(r, a) > 0.02 else Color(0.06, 0.09, 0.24)
			put(root, disc(R, func(r, a): return _hoplon(r) + star.call(r, a), 56, 192, starc), painted(0.24, 1.0))
		_:
			var col := func(r: float, _a: float) -> Color:
				return Color(0.55, 0.06, 0.04) if r < 0.8 else Color.WHITE
			put(root, disc(0.82, func(r, _a): return _hoplon(r), 32, 72, col), painted(0.4))
			put(root, disc(R, func(r, _a): return _hoplon(r) - (0.0 if r > 0.8 else 0.05), 40, 72), m)
			for k in 12:
				var a := TAU * k / 12.0
				put(root, sphere(0.04), metal(Color(0.9, 0.92, 0.95), 0.2), Transform3D(Basis(), Vector3(cos(a) * 0.9, sin(a) * 0.9, _hoplon(0.9) + 0.02)))
			var lam := PackedVector2Array([Vector2(-0.38, -0.42), Vector2(-0.2, -0.42), Vector2(0, 0.08), Vector2(0.2, -0.42), Vector2(0.38, -0.42), Vector2(0.08, 0.48), Vector2(-0.08, 0.48)])
			put(root, extrude(lam, 0.02, 0.015), metal(Color(0.88, 0.9, 0.94), 0.2), Transform3D(Basis(), Vector3(0, 0, _hoplon(0.0) - 0.01)))
	# the rolled rim and the shield's depth behind it (a bowl, seen edge-on)
	var rim_m := m if tier != "bronze" else metal(GOLD, 0.24)
	put(root, torus(0.94, 1.06), rim_m, Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0, 0, 0.0)))
	put(root, lathe([Vector2(1.0, 0.0), Vector2(0.98, -0.12), Vector2(0.9, -0.24), Vector2(0.7, -0.34), Vector2(0.0, -0.38)], 48), m, Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3.ZERO))
	root.rotation = Vector3(-0.12, -0.72, 0.05)

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
	# the science of the shot: a bronze pair of dividers astride a glowing
	# trajectory, the arc ending in an arrowhead on its mark
	var br := metal(TIER_METAL.bronze, 0.22)
	var hinge := Vector3(-0.05, 0.86, 0.0)
	for f in [Vector3(-0.78, -0.95, 0.0), Vector3(0.62, -0.95, 0.0)]:
		var d: Vector3 = (f - hinge).normalized()
		put(root, tube(line(hinge, f, 16), func(t): var ww: float = lerpf(0.075, 0.012, t ** 1.4); return Vector2(ww, ww * 0.7), 4, Vector3(0, 0, 1), true), br)
		put(root, tube(line(f - d * 0.16, f, 4), func(t): return Vector2.ONE * lerpf(0.02, 0.003, t), 6), metal(STEEL, 0.2))
	put(root, cyl(0.15, 0.15, 0.08, 28), metal(GOLD, 0.2), Transform3D(Basis(Vector3.RIGHT, PI / 2), hinge + Vector3(0, 0, 0.04)))
	put(root, torus(0.06, 0.11), metal(GOLD, 0.24), Transform3D(Basis(Vector3.RIGHT, PI / 2), hinge + Vector3(0, 0.2, 0)))
	# the trajectory: glowing dashes on a parabola, brightening to the mark
	var acc := _acc()
	var pts := PackedVector3Array()
	for k in 41:
		var t := float(k) / 40.0
		pts.append(Vector3(lerpf(-0.95, 0.9, t), -0.7 + 1.55 * 4.0 * t * (1.0 - t) * 0.82 - t * 0.12, 0.3))
	for k in 9:
		var seg := PackedVector3Array()
		for j in 4:
			seg.append(pts[k * 4 + j + 1])
		var b := float(k) / 8.0
		tube_acc(acc, seg, func(_t): return Vector2.ONE * (0.03 + 0.012 * b), 8, Vector3(0, 0, 1), false, func(_t, _a): return Color(Color(1.0, 0.8, 0.4).lerp(Color(1.0, 0.98, 0.85), b), 0.55 + 0.45 * b))
	put(root, _mesh(acc), glow(Color.WHITE, true))
	var tip := pts[40]
	var dd := (pts[40] - pts[37]).normalized()
	put(root, tube(line(tip - dd * 0.3, tip + dd * 0.02, 12), func(t): var w: float = 0.13 * (1.0 - t) ** 0.8 if t > 0.25 else 0.13 * t / 0.25; return Vector2(w, w * 0.25 + 0.006), 4, Vector3(0, 0, 1), true), metal(STEEL, 0.18))
	# the mark: a small red ring where it lands
	put(root, torus(0.1, 0.15), glow(Color(1.0, 0.3, 0.15)), Transform3D(Basis(Vector3.RIGHT, 1.2), tip + Vector3(0.05, -0.12, 0)))

static func _m_burning_pitch(root: Node3D) -> void:
	# a two-handled clay amphora painted black-figure (a black foot, a wave
	# band on the shoulder, a black neck), brimming with glossy black pitch,
	# ablaze, the pitch running down its side
	var base_prof := [Vector2(0.0, -0.95), Vector2(0.3, -0.95), Vector2(0.36, -0.9), Vector2(0.5, -0.65), Vector2(0.66, -0.3), Vector2(0.7, -0.05), Vector2(0.62, 0.22), Vector2(0.42, 0.4), Vector2(0.32, 0.46), Vector2(0.34, 0.52), Vector2(0.44, 0.56), Vector2(0.45, 0.6), Vector2(0.3, 0.6), Vector2(0.0, 0.5)]
	# subdivided, so the painted bands have rows to land on
	var prof := []
	for i in base_prof.size() - 1:
		for k in 4:
			prof.append((base_prof[i] as Vector2).lerp(base_prof[i + 1], k / 4.0))
	prof.append(base_prof[base_prof.size() - 1])
	var col := func(i: int, a: float) -> Color:
		var y: float = prof[i].y
		var terra := Color(0.72, 0.31, 0.13).lerp(Color(0.6, 0.24, 0.1), 0.5 + 0.5 * sin(a * 3.0 + y * 7.0))
		var blk := Color(0.05, 0.035, 0.03)
		if y < -0.74 or y > 0.36:
			return blk
		if absf(y + 0.38) < 0.03:
			return blk
		if y > -0.02 and y < 0.26:
			# the shoulder band: a running wave in the clay's colour on black
			var wv := 0.12 + 0.06 * sin(a * 8.0)
			return terra if absf(y - wv) < 0.035 else blk
		return terra
	var pot := Node3D.new()
	root.add_child(pot)
	pot.transform = Transform3D(Basis(Vector3.RIGHT, 0.22), Vector3(0, -0.15, 0))
	put(pot, lathe(prof, 56, Callable(), col), painted(0.5))
	# the two loop handles, shoulder to neck, out to the sides
	for s in [-1.0, 1.0]:
		var h := bez(Vector3(0.6 * s, 0.1, 0), Vector3(0.95 * s, 0.16, 0), Vector3(0.84 * s, 0.46, 0), Vector3(0.38 * s, 0.42, 0), 16)
		put(pot, tube(h, func(_t): return Vector2(0.08, 0.065), 10), mat(Color(0.62, 0.26, 0.11), 0.6, "rough"))
	# the pitch: a glossy black pool in the mouth and two runs down the side
	put(pot, disc(0.36, func(r, _a): return 0.03 * (1.0 - r / 0.36), 6, 32), mat(Color(0.02, 0.015, 0.01), 0.08), Transform3D(Basis(Vector3.RIGHT, -PI / 2), Vector3(0, 0.6, 0)))
	# one glossy run of pitch over the lip, down the black neck onto the clay
	var ra := 1.75
	var ro := Vector3(cos(ra) * 0.45, 0.6, sin(ra) * 0.45)
	var ro2 := Vector3(cos(ra) * 0.68, -0.12, sin(ra) * 0.68)
	put(pot, tube(bez(ro, ro + Vector3(cos(ra) * 0.08, -0.2, sin(ra) * 0.08), ro2 + Vector3(cos(ra) * 0.06, 0.35, sin(ra) * 0.06), ro2, 14), func(t): return Vector2.ONE * (0.055 + 0.035 * t * t), 10), mat(Color(0.02, 0.015, 0.01), 0.06))
	put(pot, sphere(0.095), mat(Color(0.02, 0.015, 0.01), 0.06), Transform3D(Basis(), ro2))
	flames(root, Vector3(0, 0.5, 0.1), 0.4, 1.2, 6, Vector3.UP, 3)

static func _m_phobos(root: Node3D) -> void:
	# Phobos' spear, close up: a huge obsidian spearhead cracked with red fire,
	# gold rings on its socket, a red aura of panic
	var dark := metal(Color(0.16, 0.13, 0.15), 0.14)
	# a long lanceolate war-spear head (straight edges to a hard point, not a
	# leaf), nearly upright, its socket and a length of shaft below
	var a := Vector3(-0.62, -1.0, 0)
	var b := Vector3(0.5, 1.02, 0)
	var hl := 1.4
	var hw := 0.4
	spear(root, a, b, dark, hl, hw, 0.085, mat(Color(0.12, 0.06, 0.05), 0.5, "wood"), 0.26)
	var d := (b - a).normalized()
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	var base := b - d * hl
	# heat, not veins: the two cutting edges glow red-hot to the point, and a
	# few jagged fractures cross the black glass near the socket (no midrib
	# with side branches: that read as a leaf)
	var acc := _acc()
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	var zof := func(t: float, e: float) -> float:
		var w := _leaf(t, hw, 0.26)
		return (w * 0.3 + 0.004) * (1.0 - absf(e) / maxf(w, 0.001)) + 0.012
	for s2 in [-1.0, 1.0]:
		var ed := PackedVector3Array()
		for k in 25:
			var t := lerpf(0.03, 0.995, float(k) / 24.0)
			var e: float = s2 * _leaf(t, hw, 0.26) * 0.93
			ed.append(base + d * t * hl + x * e + Vector3(0, 0, zof.call(t, e)))
		tube_acc(acc, ed, func(t): return Vector2.ONE * lerpf(0.022, 0.01, t), 6, Vector3(0, 0, 1), false, func(t, _a): return Color(1.0, lerpf(0.35, 0.85, t), lerpf(0.1, 0.45, t)))
	for k in 3:
		var t0 := 0.12 + 0.13 * k
		var cr := PackedVector3Array()
		var e0 := (-1.0 if k % 2 == 0 else 1.0) * _leaf(t0, hw, 0.26) * 0.8
		for j in 5:
			var f := float(j) / 4.0
			var t := t0 + f * 0.12 + rng.randf_range(-0.015, 0.015)
			var e := lerpf(e0, -e0 * 0.3, f) + rng.randf_range(-0.03, 0.03)
			cr.append(base + d * t * hl + x * e + Vector3(0, 0, zof.call(t, e)))
		tube_acc(acc, cr, func(t): return Vector2.ONE * lerpf(0.014, 0.006, t), 6, Vector3(0, 0, 1), false, func(_t, _a): return Color(1.0, 0.3, 0.08))
	put(root, _mesh(acc), glow(Color.WHITE))
	for k in 3:
		put(root, torus(0.075, 0.11), metal(GOLD, 0.22), along(base - d * (0.06 + k * 0.1), d))

static func _m_deimos(root: Node3D) -> void:
	# Deimos, dread: a black horned war helm, its eye slits burning violet
	var iron := metal(Color(0.2, 0.19, 0.22), 0.2)
	var helm := Node3D.new()
	root.add_child(helm)
	helm.rotation = Vector3(0.05, -0.32, 0)
	# the bowl and the face plate (a lathed dome, flattened front to back)
	var prof := []
	for i in 21:
		var t := float(i) / 20.0
		var y := lerpf(-0.75, 0.62, t)
		var r := 0.52 * sqrt(maxf(0.0, 1.0 - pow((y - 0.0) / 0.68, 2.0))) if y > 0.0 else 0.52 - 0.08 * (-y / 0.75) ** 2
		prof.append(Vector2(maxf(r, 0.001), y))
	prof.append(Vector2(0.0, 0.62))
	put(helm, lathe(prof, 48), iron, Transform3D(Basis().scaled(Vector3(1.0, 1.0, 0.9)), Vector3.ZERO))
	# the T of the face opening: black, the eyes glowing in it
	var tee := PackedVector2Array([Vector2(-0.4, 0.08), Vector2(0.4, 0.08), Vector2(0.4, -0.06), Vector2(0.08, -0.12), Vector2(0.07, -0.75), Vector2(-0.07, -0.75), Vector2(-0.08, -0.12), Vector2(-0.4, -0.06)])
	put(helm, extrude(tee, 0.02), mat(Color(0.01, 0.0, 0.02), 0.9), Transform3D(Basis(), Vector3(0, 0, 0.46)))
	for s in [-1.0, 1.0]:
		put(helm, sphere(0.075, 0.06), glow(Color(0.85, 0.5, 1.0)), Transform3D(Basis().scaled(Vector3(1.6, 1.0, 0.6)), Vector3(0.22 * s, 0.01, 0.49)))
		put(helm, sphere(0.14, 0.1), glow(Color(0.6, 0.2, 1.0, 0.4), true), Transform3D(Basis().scaled(Vector3(1.6, 1.0, 0.5)), Vector3(0.22 * s, 0.01, 0.5)))
		# ram's horns: curling out and down from the temples
		var o := Vector3(0.42 * s, 0.3, 0.05)
		var p := bez(o, o + Vector3(0.45 * s, 0.4, 0.0), o + Vector3(0.75 * s, -0.25, 0.15), o + Vector3(0.38 * s, -0.42, 0.3), 24)
		put(helm, tube(p, func(t): return Vector2.ONE * lerpf(0.13, 0.025, t), 12), mat(Color(0.55, 0.47, 0.36), 0.4, "rough"))
		for k in 5:
			put(helm, torus(lerpf(0.11, 0.03, k / 5.0), lerpf(0.145, 0.05, k / 5.0)), mat(Color(0.34, 0.28, 0.2), 0.5), along(p[k * 4 + 2], p[k * 4 + 3] - p[k * 4 + 1]))
	# a crest ridge of dark steel over the bowl
	put(helm, tube(bez(Vector3(0, 0.15, 0.45), Vector3(0, 0.72, 0.35), Vector3(0, 0.78, -0.3), Vector3(0, 0.3, -0.5), 16), func(_t): return Vector2(0.03, 0.07), 8, Vector3(1, 0, 0)), metal(GOLD, 0.24))
	wisps(root, [bez(Vector3(-0.3, -0.6, -0.3), Vector3(-0.7, -0.3, -0.3), Vector3(-0.5, 0.2, -0.3), Vector3(-0.95, 0.5, -0.3), 12),
		bez(Vector3(0.3, -0.6, -0.3), Vector3(0.7, -0.3, -0.3), Vector3(0.5, 0.2, -0.3), Vector3(0.95, 0.5, -0.3), 12)], 0.13, Color(0.8, 0.5, 1.0), Color(0.25, 0.05, 0.45))

static func _m_enyo(root: Node3D) -> void:
	# Enyo's bow: a heavy horn-and-sinew recurve, drawn, bound in red leather
	# with gold tips, the arrow's head glowing
	var limb := func(sgn: float) -> PackedVector3Array:
		return bez(Vector3(0.18, 0, 0), Vector3(0.26, 0.45 * sgn, 0), Vector3(-0.05, 0.85 * sgn, 0), Vector3(-0.34, 0.98 * sgn, 0), 24)
	var horn := mat(Color(0.26, 0.12, 0.06), 0.32, "wood")
	var gold := metal(GOLD, 0.22)
	for sgn in [1.0, -1.0]:
		var lp: PackedVector3Array = limb.call(sgn)
		put(root, tube(lp, func(t): return Vector2(lerpf(0.15, 0.06, t), lerpf(0.11, 0.05, t)), 12), horn)
		# sinew wraps and a gold band along each limb
		for k in [6, 12]:
			put(root, torus(lerpf(0.13, 0.08, k / 24.0), lerpf(0.165, 0.105, k / 24.0)), gold, along(lp[k], lp[k + 1] - lp[k - 1]))
		var tipc := bez(Vector3(-0.34, 0.98 * sgn, 0), Vector3(-0.44, 1.03 * sgn, 0), Vector3(-0.52, 0.98 * sgn, 0), Vector3(-0.53, 0.88 * sgn, 0), 10)
		put(root, tube(tipc, func(t): return Vector2.ONE * lerpf(0.055, 0.02, t), 10), gold)
	put(root, tube(line(Vector3(0.2, -0.2, 0), Vector3(0.2, 0.2, 0), 4), func(_t): return Vector2(0.15, 0.12), 14), mat(Color(0.55, 0.06, 0.05), 0.6, "rough"))
	var nock := Vector3(-0.78, 0, 0.02)
	var sm := mat(Color(0.95, 0.92, 0.84), 0.5)
	put(root, tube(line(Vector3(-0.36, 0.97, 0), nock, 6), func(_t): return Vector2(0.022, 0.022), 6), sm)
	put(root, tube(line(nock, Vector3(-0.36, -0.97, 0), 6), func(_t): return Vector2(0.022, 0.022), 6), sm)
	arrow(root, nock, Vector3(1.0, 0, 0.06), metal(Color(0.85, 0.2, 0.15), 0.2), mat(Color(0.12, 0.07, 0.05), 0.5, "wood"), Color(0.08, 0.05, 0.05), 0.34, 0.15)
	put(root, sphere(0.13), glow(Color(1.0, 0.45, 0.3, 0.5), true), Transform3D(Basis(), Vector3(0.84, 0, 0.06)))
	root.rotation = Vector3(0, -0.2, 0.0)

static func _m_sarissa(root: Node3D) -> void:
	# a phalanx lowering its sarissas: five long pikes, parallel, staggered in
	# depth, red ribbons under the heads (a hatch of shafts, unlike any blade)
	var m := metal(Color(0.8, 0.82, 0.86), 0.18)
	var d := Vector3(1.0, 0.62, 0).normalized()
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	for k in 5:
		var f := float(k) - 2.0
		var o := x * f * 0.3 + d * (-absf(f) * 0.12) + Vector3(0, 0, -0.14 * absf(f))
		var a := o - d * 1.35
		var b := o + d * 1.2
		# bold at button size: thick pale ash shafts, broad heads, wide ribbons
		spear(root, a, b, m, 0.44, 0.15, 0.068, mat(Color(0.62, 0.42, 0.22), 0.55, "wood"))
		var t0 := b - d * 0.52
		put(root, tube(bez(t0, t0 - x * 0.07 - d * 0.04, t0 - x * 0.16 - d * 0.06, t0 - x * 0.26 - d * 0.14, 8), func(t): return Vector2(lerpf(0.08, 0.035, t), 0.018), 6), mat(Color(0.85, 0.08, 0.04), 0.7, "rough"))

static func _m_aegis(root: Node3D) -> void:
	# Athena's owl, the guardian, close up and alive (not a statuette): a
	# tawny owl perched on an olive branch, half-raised barred wings, a pale
	# facial disc ringed dark, huge amber eyes with black pupils and a glint,
	# a scowling brow running up into the ear tufts, layered breast feathers
	# with dark streaks (shape from displacement, pattern from vertex colours)
	var fm := feathers()
	var tawny := Color(0.46, 0.27, 0.12)
	var cream := Color(0.86, 0.74, 0.54)
	var dark := Color(0.13, 0.07, 0.035)
	# the body: an egg of layered feathers, each row overlapping the next
	var bprof := []
	for i in 41:
		var t := PI * i / 40.0
		bprof.append(Vector2(0.52 * sin(t) * (1.0 + 0.12 * sin(t * 0.5 + 1.6)), -0.66 * cos(t)))
	var bdisp := func(a: float, i: int) -> float:
		var y := -0.66 * cos(PI * i / 40.0)
		var band := y * 9.0 + 0.35 * absf(sin(a * 8.0))
		return 1.0 + 0.045 * fposmod(band, 1.0)
	var bcol := func(i: int, a: float) -> Color:
		var y := -0.66 * cos(PI * i / 40.0)
		var front := clampf(sin(a) * 1.6 - 0.2, 0.0, 1.0)
		var band := fposmod(y * 9.0 + 0.35 * absf(sin(a * 8.0)), 1.0)
		var c := tawny.lerp(cream, front * 0.7)
		# feather by feather: some warmer, a short dark streak (a broken
		# arrow mark, not a stripe) on some, dark-edged tips on all
		var col_i := floorf(a * 8.0 / PI)
		var row_i := floorf(y * 9.0 + 0.35 * absf(sin(a * 8.0)))
		var h := fposmod(sin(col_i * 12.9898 + row_i * 78.233) * 43758.5453, 1.0)
		c = c.lerp(tawny, front * h * 0.45)
		var streak := clampf(1.0 - absf(fposmod(a * 8.0 / PI, 1.0) - 0.5) * 12.0, 0.0, 1.0) * front
		streak *= clampf(1.0 - absf(band - 0.55) * 3.0, 0.0, 1.0) * (1.0 if h > 0.35 else 0.0)
		c = c.lerp(dark, streak * 0.8)
		c = c.lerp(dark.lerp(tawny, 0.4), clampf((band - 0.8) * 5.0, 0.0, 1.0) * 0.55)
		return c
	put(root, lathe(bprof, 64, bdisp, bcol), fm, Transform3D(Basis().scaled(Vector3(1.0, 1.0, 0.82)), Vector3(0, -0.36, 0)))
	# the head: broad, flattened on top
	var hprof := []
	for i in 33:
		var t := PI * i / 32.0
		hprof.append(Vector2(0.47 * sin(t), -0.4 * cos(t)))
	var hcol := func(i: int, a: float) -> Color:
		var sp := 1.0 if fposmod(i * 0.37 + a * 2.3, 1.0) > 0.86 else 0.0
		return tawny.darkened(0.08).lerp(cream, sp * 0.8)
	put(root, lathe(hprof, 56, Callable(), hcol), fm, Transform3D(Basis().scaled(Vector3(1.12, 1.0, 0.9)), Vector3(0, 0.44, 0.0)))
	# the facial disc: two pale dishes ringed by a dark ruff, rippled feathers
	for s in [-1.0, 1.0]:
		var dk := func(r: float, a: float) -> float:
			return 0.07 * (1.0 - r / 0.26) + 0.008 * sin(a * 18.0) * r / 0.26
		var dc := func(r: float, a: float) -> Color:
			var q := r / 0.26
			var c := cream.lerp(Color(0.95, 0.88, 0.72), 1.0 - q)
			c = c.lerp(tawny, clampf((q - 0.25) * 1.4, 0.0, 1.0) * 0.35 * (0.6 + 0.4 * sin(a * 18.0)))
			return c.lerp(dark, clampf((q - 0.82) * 6.0, 0.0, 1.0))
		put(root, disc(0.26, dk, 14, 48, dc), fm, Transform3D(Basis(Vector3.UP, 0.32 * s), Vector3(0.19 * s, 0.4, 0.27)))
		# the eye: an amber iris with a deep pupil and a catch light
		var e := Vector3(0.19 * s, 0.42, 0.37)
		put(root, sphere(0.125), glow(Color(1.0, 0.62, 0.08)), Transform3D(Basis().scaled(Vector3(1, 1, 0.55)), e))
		put(root, sphere(0.135, 0.06), mat(dark, 0.4), Transform3D(Basis(), e + Vector3(0, 0, -0.02)))
		put(root, sphere(0.068), mat(Color(0.01, 0.005, 0.0), 0.05), Transform3D(Basis().scaled(Vector3(1, 1, 0.6)), e + Vector3(0, 0, 0.055)))
		put(root, sphere(0.024), glow(Color(1, 1, 0.95)), Transform3D(Basis(), e + Vector3(-0.035, 0.04, 0.1)))
		# the scowling brow: a dark ridge from the beak up into the ear tuft
		var brow := bez(Vector3(0.03 * s, 0.5, 0.42), Vector3(0.14 * s, 0.6, 0.42), Vector3(0.3 * s, 0.64, 0.33), Vector3(0.42 * s, 0.7, 0.15), 14)
		put(root, tube(brow, func(t): return Vector2(lerpf(0.035, 0.05, t), 0.03), 8), mat(dark, 0.7, "rough"))
		# the ear tuft: three feathers
		for k in 3:
			var o := Vector3((0.34 + 0.05 * k) * s, 0.7 - 0.03 * k, 0.08 - 0.06 * k)
			var tip := o + Vector3((0.12 + 0.05 * k) * s, 0.3 - 0.06 * k, -0.04)
			put(root, tube(bez(o, o + (tip - o) * 0.4, o + (tip - o) * 0.7 + Vector3(0.03 * s, 0, 0), tip, 10), func(t): var w: float = 0.06 * (1.0 - t) ** 0.7; return Vector2(w, w * 0.45), 8, Vector3(0, 0, 1), false,
				func(t, _a): return tawny.darkened(0.2).lerp(dark, t)), fm)
		# the wing: half raised, barred flight feathers fanned from the shoulder
		var sh := Vector3(0.38 * s, -0.12, -0.12)
		for k in 6:
			var ang := lerpf(1.25, 0.05, k / 5.0)
			var L := lerpf(0.95, 0.62, k / 5.0)
			var dir := Vector3(cos(ang) * s, sin(ang) * 0.95 - 0.12, -0.05)
			var tip := sh + dir * L
			var fc := func(t: float, _a: float) -> Color:
				var bar := 1.0 if fposmod(t * 5.5, 1.0) > 0.62 else 0.0
				return tawny.darkened(0.15).lerp(cream, bar * 0.7).lerp(dark, clampf((t - 0.86) * 6.0, 0.0, 1.0))
			put(root, tube(bez(sh, sh + dir * L * 0.4, tip - Vector3(0, 0.08, 0), tip, 14), func(t): var w: float = 0.12 * sin(PI * clampf(t * 0.85 + 0.15, 0.0, 1.0)) ** 0.6; return Vector2(w, 0.03), 6, Vector3(0, 0, 1), false, fc),
				fm, Transform3D(Basis(), Vector3(0, 0, -0.05 * k)))
		# coverts over the wing's root
		put(root, sphere(0.2), mat(tawny.darkened(0.1), 0.75, "rough"), Transform3D(Basis(Vector3(0, 0, 1), -0.7 * s).scaled(Vector3(1.4, 0.8, 0.6)), Vector3(0.42 * s, 0.02, -0.02)))
		# talons gripping the branch
		for k in 3:
			var tb := Vector3((0.1 + 0.06 * k) * s - 0.06 * s, -0.98, 0.18)
			put(root, tube(bez(tb + Vector3(0, 0.12, 0), tb + Vector3(0, 0.05, 0.06), tb + Vector3(0, -0.04, 0.08), tb + Vector3(0, -0.09, 0.03), 8), func(t): return Vector2.ONE * lerpf(0.035, 0.012, t), 8), mat(Color(0.75, 0.6, 0.25), 0.45))
	# the beak: a hooked horn-grey bill between the eyes
	put(root, tube(bez(Vector3(0, 0.38, 0.4), Vector3(0, 0.36, 0.5), Vector3(0, 0.28, 0.52), Vector3(0, 0.22, 0.46), 10), func(t): return Vector2(lerpf(0.06, 0.008, t), lerpf(0.05, 0.008, t)), 10), mat(Color(0.38, 0.36, 0.3), 0.3))
	# the olive branch it perches on, two leaves and an olive
	var br := bez(Vector3(-0.85, -1.02, 0.12), Vector3(-0.3, -1.08, 0.2), Vector3(0.3, -1.0, 0.2), Vector3(0.88, -1.08, 0.1), 16)
	put(root, tube(br, func(t): return Vector2.ONE * lerpf(0.06, 0.04, t), 10), mat(Color(0.3, 0.2, 0.12), 0.8, "wood"))
	var leaf := mat(Color(0.32, 0.42, 0.2), 0.5)
	for L2 in [[Vector3(0.62, -1.06, 0.14), Vector3(0.95, -0.9, 0.2)], [Vector3(-0.6, -1.05, 0.15), Vector3(-0.95, -1.18, 0.22)]]:
		put(root, tube(line(L2[0], L2[1], 10), func(t): var w: float = 0.07 * sin(PI * t) ** 0.8; return Vector2(w, 0.012), 6), leaf)
	put(root, sphere(0.05), mat(Color(0.12, 0.14, 0.06), 0.25), Transform3D(Basis(), Vector3(0.72, -1.14, 0.18)))

static func _m_sun_ray(root: Node3D) -> void:
	# Apollo's sun: a blazing disc in a gold ring throwing long rays
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
	# Zeus' keraunos, forged by Hephaestus: a gold thunderbolt, a ringed grip,
	# three lightning prongs fanning from each flared end
	var gold := metal(GOLD, 0.2)
	var bolt := Node3D.new()
	root.add_child(bolt)
	bolt.rotation = Vector3(0, 0, -0.32)
	put(bolt, tube(line(Vector3(0, -0.28, 0), Vector3(0, 0.28, 0), 8), func(t): return Vector2.ONE * (0.08 + 0.025 * sin(t * PI)), 14), gold)
	for k in 3:
		put(bolt, torus(0.08, 0.13), gold, Transform3D(Basis(), Vector3(0, -0.18 + k * 0.18, 0)))
	for s in [-1.0, 1.0]:
		put(bolt, cyl(0.09, 0.2, 0.22, 20), gold, Transform3D(Basis(Vector3.RIGHT, 0.0 if s > 0 else PI), Vector3(0, 0.38 * s, 0)))
		for j in 3:
			var ang := (j - 1) * 0.62
			var dir := Vector3(sin(ang), cos(ang) * s, 0)
			var a0 := Vector3(0, 0.46 * s, 0)
			var a1 := a0 + dir * (0.9 if j == 1 else 0.72)
			var side := dir.cross(Vector3(0, 0, 1)).normalized()
			var zz := PackedVector3Array()
			for q in 6:
				var t := q / 5.0
				zz.append(a0.lerp(a1, t) + side * (0.0 if q == 0 or q == 5 else (0.1 if q % 2 == 1 else -0.1)))
			# a gold zigzag prong, sharp-edged, in a blue-white glow
			put(bolt, tube(zz, func(t): return Vector2(lerpf(0.11, 0.02, t), lerpf(0.07, 0.015, t)), 4, Vector3(0, 0, 1), true), gold)
			put(bolt, tube(zz, func(t): return Vector2.ONE * lerpf(0.16, 0.04, t), 8, Vector3(0, 0, 1), false, func(_t, _a): return Color(0.45, 0.7, 1.0, 0.45)), glow(Color.WHITE, true), Transform3D(Basis(), Vector3(0, 0, -0.08)))

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

## A xiphos (the hoplite's leaf-bladed short sword), hilt guard at g, blade
## along dir, length L, half width w: a waisted leaf blade with a raised
## midrib, a crossguard with flared ends, a cord-bound grip, a disc pommel.
static func xiphos(root: Node3D, g: Vector3, dir: Vector3, L: float, w: float, m: Material, hilt: Material, grip: Material = null) -> void:
	var d := dir.normalized()
	var x := d.cross(Vector3(0, 0, 1)).normalized()
	var wf := func(t: float) -> float:
		# waisted near the hilt, the leaf's belly at two thirds, then the point
		var ww: float = w * (0.72 + 0.16 * sin(PI * clampf((t - 0.05) / 0.9, 0.0, 1.0)) + 0.14 * exp(-pow((t - 0.62) / 0.16, 2.0)))
		return ww * (1.0 if t < 0.74 else pow(1.0 - (t - 0.74) / 0.26, 0.85))
	put(root, tube(line(g, g + d * L, 32), func(t): var ww: float = wf.call(t); return Vector2(ww, ww * 0.2 + 0.006), 4, Vector3(0, 0, 1), true), m)
	# the midrib: a thin bright ridge down the blade
	put(root, tube(line(g + d * 0.04, g + d * L * 0.9, 12), func(t): return Vector2.ONE * (0.022 * (1.0 - t * 0.8) + 0.004), 6), m, Transform3D(Basis(), Vector3(0, 0, w * 0.18)))
	# guard: a bar thickest at its flared ends
	put(root, tube(line(g - x * w * 1.9, g + x * w * 1.9, 10), func(t): return Vector2.ONE * (0.04 + 0.035 * pow(absf(t - 0.5) * 2.0, 3.0)), 10), hilt)
	if grip == null:
		grip = mat(LEATHER, 0.7, "rough")
	put(root, tube(line(g - d * 0.03, g - d * 0.32, 8), func(t): return Vector2.ONE * (0.042 + 0.008 * sin(t * PI)), 10), grip)
	for k in 3:
		put(root, torus(0.04, 0.058), hilt, along(g - d * (0.08 + k * 0.1), d))
	put(root, cyl(0.075, 0.075, 0.05, 20), hilt, along(g - d * 0.36, d))

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
	# a marble altar, its front hung with gold garlands and rosettes between
	# fluted corner posts, a log pile on top ablaze
	var marble := mat(Color(0.74, 0.71, 0.65), 0.4, "rough")
	var shade := mat(Color(0.5, 0.46, 0.41), 0.5, "rough")
	var gold := metal(GOLD, 0.22)
	put(root, box(Vector3(1.55, 0.16, 0.95)), marble, Transform3D(Basis(), Vector3(0, -0.92, 0)))
	put(root, box(Vector3(1.4, 0.06, 0.85)), shade, Transform3D(Basis(), Vector3(0, -0.82, 0)))
	put(root, box(Vector3(1.2, 0.72, 0.7)), marble, Transform3D(Basis(), Vector3(0, -0.45, 0)))
	put(root, box(Vector3(1.4, 0.06, 0.85)), shade, Transform3D(Basis(), Vector3(0, -0.07, 0)))
	put(root, box(Vector3(1.5, 0.14, 0.92)), marble, Transform3D(Basis(), Vector3(0, 0.03, 0)))
	# fluted posts at the front corners
	for s in [-1.0, 1.0]:
		put(root, cyl(0.1, 0.1, 0.72, 16), marble, Transform3D(Basis(), Vector3(0.56 * s, -0.45, 0.33)))
		for k in 3:
			put(root, box(Vector3(0.015, 0.66, 0.02)), shade, Transform3D(Basis(), Vector3(0.56 * s + (k - 1) * 0.05, -0.45, 0.43)))
		# volutes on the top corners
		put(root, cyl(0.11, 0.11, 0.92, 18), marble, Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0.64 * s, 0.14, 0)))
		put(root, torus(0.05, 0.1), gold, Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(0.64 * s, 0.14, 0.47)))
	# two garland swags between three rosettes
	for k in 3:
		var x := lerpf(-0.36, 0.36, k / 2.0)
		put(root, disc(0.07, func(r, a): return 0.03 * (1.0 - r / 0.07) + 0.01 * sin(a * 8.0), 6, 32), gold, Transform3D(Basis(), Vector3(x, -0.2, 0.36)))
	for k in 2:
		var x0 := lerpf(-0.36, 0.36, k / 2.0)
		var x1 := x0 + 0.36
		put(root, tube(bez(Vector3(x0, -0.22, 0.37), Vector3(x0 + 0.04, -0.46, 0.4), Vector3(x1 - 0.04, -0.46, 0.4), Vector3(x1, -0.22, 0.37), 16), func(t): return Vector2.ONE * (0.03 + 0.03 * sin(t * PI)), 8), mat(Color(0.25, 0.5, 0.15), 0.6, "rough"))
	# the log pile
	var wood := mat(DARK_WOOD, 0.8, "wood")
	for k in 3:
		var y := 0.17 + 0.06 * k
		put(root, cyl(0.06, 0.06, 0.8, 10), wood, Transform3D(Basis(Vector3(0, 0, 1), PI / 2) * Basis(Vector3.RIGHT, 0.0).rotated(Vector3.UP, 0.4 + k * 0.9), Vector3(0, y, 0)))
	flames(root, Vector3(0, 0.25, 0.05), 0.42, 1.0, 5, Vector3.UP, 9)
	root.rotation = Vector3(0.18, -0.5, 0)

