extends Node3D
## The Egyptian powers' own nodes (child of godpowers.gd, which draws everything else of
## theirs from AovGodpowerView: godpower_view_egypt.cpp). Fed once a frame with the view's
## "egypt" state:
##   - the full-frame grade (egypt_grade.gdshader + its additive half egypt_grade_add): Bast's
##     Eclipse turns the world to blue moonlight (power_05), Ra's Rain washes it cool grey with drifting cloud shadows; both dim the sun
##     and sky through godpowers.gd _storm_light (light_k / light_dim / light_fog);
##   - Ra's rainbow (rainbow.gdshader) arching over the caster's Town Center, turned to the
##     camera;
##   - Horus' tornado funnels (tornado.gdshader): a dense brown-grey body banded by climbing
##     spiral lanes with bright back-lit edges, its inner wall, a sheath of silhouette wisps, a
##     dust skirt rolling out round its foot, and big wreckage (roof tiles, beams, bricks)
##     whirled round it; following the sim's spiral.
##   - Sekhmet's Citadel: the fortress model (egypt_gods "citadel", export-egypt-gods.mjs:
##     battered curtain walls, four bastions with braziers, a pylon gate with her red banners
##     and a winged sun disc) over every Citadel Center, on the Egyptian buildings' shader in
##     the owner's colour; it rises out of the ground in the cast (the view's "rise" 0..1) and
##     shows where the Town Center would (the local player's or explored ground).
## Everything is a function of the sim time (a paused capture is exact).

var gp: Node = null
var light_k := 0.0           # how much the Egyptian powers dim the lights (0..1)
var light_dim := 1.0         # the dimming's strength factor (godpowers.gd _storm_light)
var light_fog := Color.hex(0x141a2cff)
## (the Eclipse) the lighting grade's vignette / sand-tint / saturation targets while it
## dominates the light (godpowers.gd _storm_light); -1 = the storm's own (vignette 0.55)
var light_vignette := -1.0
var light_sand := -1.0
var light_sat := -1.0
var light_exposure := 1.0    # x the lighting grade's display exposure (moonlight: lifted)

var _grade: MeshInstance3D
var _grade_mat: ShaderMaterial
var _grade_add: MeshInstance3D
var _grade_add_mat: ShaderMaterial
var _rainbow: MeshInstance3D
var _rainbow_mat: ShaderMaterial
var _funnels := {}           # tornado id -> {root, mats}
var _citadels := {}          # Town Center id -> MeshInstance3D (the Citadel's fortress)
const ECLIPSE_DIM := 0.1    # light_dim under the Eclipse: sun x0.93, sky / ambient x0.97
const CITADEL_MODEL_W := 7.0 # the model's footprint (tiles): the Egyptian Town Center's

func setup(godpowers: Node) -> void:
	gp = godpowers
	_grade_mat = ShaderMaterial.new()
	_grade_mat.shader = load("res://game/godpowers/egypt_grade.gdshader")
	_grade_mat.render_priority = 9
	var fq := QuadMesh.new()
	fq.size = Vector2(2, 2)
	_grade = MeshInstance3D.new()
	_grade.name = "EG_Grade"
	_grade.mesh = fq
	_grade.material_override = _grade_mat
	_grade.extra_cull_margin = 16384.0
	_grade.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_grade.visible = false
	add_child(_grade)
	_grade_add_mat = ShaderMaterial.new()
	_grade_add_mat.shader = load("res://game/godpowers/egypt_grade_add.gdshader")
	_grade_add_mat.render_priority = 10
	_grade_add = MeshInstance3D.new()
	_grade_add.name = "EG_GradeAdd"
	_grade_add.mesh = fq
	_grade_add.material_override = _grade_add_mat
	_grade_add.extra_cull_margin = 16384.0
	_grade_add.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_grade_add.visible = false
	add_child(_grade_add)
	_rainbow_mat = ShaderMaterial.new()
	_rainbow_mat.shader = load("res://game/godpowers/rainbow.gdshader")
	_rainbow_mat.render_priority = 20
	_rainbow = MeshInstance3D.new()
	_rainbow.name = "EG_Rainbow"
	_rainbow.mesh = _arc_mesh(19.0, 2.6, 96)
	_rainbow.material_override = _rainbow_mat
	_rainbow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_rainbow.extra_cull_margin = 64.0
	_rainbow.visible = false
	add_child(_rainbow)

func frame(eg: Dictionary, now: float) -> void:
	var ecl := float(eg.get("eclipse", 0.0))
	var rain: Dictionary = eg.get("rain", {})
	var rk := float(rain.get("k", 0.0))
	# grade + lights
	_grade.visible = ecl > 0.0 or rk > 0.0
	if _grade.visible:
		_grade_mat.set_shader_parameter("eclipse_k", ecl)
		_grade_mat.set_shader_parameter("rain_k", rk)
		_grade_mat.set_shader_parameter("time", now)
		if rk > 0.0:
			_grade_mat.set_shader_parameter("plane_y", float(rain.get("y", 0.0)))
	_grade_add.visible = ecl > 0.0
	if ecl > 0.0:
		_grade_add_mat.set_shader_parameter("eclipse_k", ecl)
	if ecl >= rk * 0.55:
		# moonlight, not night: the sun only dimmed by about a third (the grade's blue
		# multiply does the rest), a blue-grey fog, a soft vignette, no warm sand tint
		light_k = ecl
		light_dim = ECLIPSE_DIM
		light_fog = Color.hex(0x5a6c8cff)
		light_vignette = 0.22
		light_sand = 0.0
		light_sat = 0.8
		light_exposure = 1.18
	else:
		light_k = rk * 0.55
		light_dim = 0.7
		light_fog = Color.hex(0x5a646eff)
		light_vignette = -1.0
		light_sand = -1.0
		light_sat = -1.0
		light_exposure = 1.0
	# the rainbow: over the caster's home, turned to face the camera
	_rainbow.visible = rk > 0.02
	if _rainbow.visible:
		_rainbow_mat.set_shader_parameter("k", rk)
		var at := Vector3(float(rain.x), float(rain.y) - 1.0, float(rain.z))
		var cam: Camera3D = get_viewport().get_camera_3d()
		var yaw := 0.0
		if cam != null:
			var d := cam.global_position - at
			yaw = atan2(d.x, d.z)
			# set the arc a little behind the base from the camera, so it frames the town
			at -= Vector3(d.x, 0.0, d.z).normalized() * 4.0
		_rainbow.transform = Transform3D(Basis(Vector3.UP, yaw), at)
	# tornado funnels
	var seen := {}
	for t in eg.get("tornadoes", []):
		var id := int(t.id)
		seen[id] = true
		if not _funnels.has(id):
			_funnels[id] = _make_funnel()
		var f: Dictionary = _funnels[id]
		f.root.position = Vector3(float(t.x), float(t.y) - 0.2, float(t.z))
		for m in f.mats:
			m.set_shader_parameter("time", now)
			m.set_shader_parameter("k", float(t.k))
		_chunk_frame(f.chunks, now, float(t.k))
	for id in _funnels.keys():
		if not seen.has(id):
			_funnels[id].root.queue_free()
			_funnels.erase(id)
	_citadel_frame(eg.get("citadels", []))

## The Citadel's fortress over each Citadel Center (the sim's citadels, from the view).
func _citadel_frame(list: Array) -> void:
	var seen := {}
	for c in list:
		var id := int(c.id)
		seen[id] = true
		var mi: MeshInstance3D = _citadels.get(id, null)
		if mi == null:
			var mesh: Mesh = null
			if FileAccess.file_exists("res://assets/models/egypt_gods.json") and VoxelModels.info("egypt_gods", "citadel").size() > 0:
				mesh = preload("res://game/buildings/building_ao.gd").mesh("egypt_gods", "citadel")
			if mesh == null:
				continue
			mi = MeshInstance3D.new()
			mi.name = "EG_Citadel_%d" % id
			mi.mesh = mesh
			var cols: Array = preload("res://game/buildings/buildings.gd").PLAYER_COLORS
			var o := int(c.owner)
			var col: int = cols[o] if o >= 0 and o < cols.size() else 0xffffff
			mi.material_override = preload("res://game/buildings/egypt_buildings.gd").material(Color.hex((col << 8) | 0xff))
			add_child(mi)
			_citadels[id] = mi
		var s := float(c.w) / CITADEL_MODEL_W
		var rise := float(c.get("rise", 1.0))
		mi.scale = Vector3(s, s, s)
		# rising out of the ground (the terrain hides what is still below it)
		mi.position = Vector3(float(c.x), float(c.y) - (1.0 - rise) * 4.8 * s, float(c.z))
		var sim: Object = gp.game.sim if gp != null and gp.game != null else null
		mi.visible = rise > 0.0 and (int(c.owner) == 1 or sim == null or sim.is_explored(float(c.x), float(c.z)))
	for id in _citadels.keys():
		if not seen.has(id):
			_citadels[id].queue_free()
			_citadels.erase(id)

func _make_funnel() -> Dictionary:
	var root := Node3D.new()
	root.name = "EG_Tornado"
	add_child(root)
	var mats := []
	# [mode, mesh]: the skirt, the inner wall, the body, the silhouette wisps (drawn in that order)
	var layers := [
		[3, _skirt_mesh(1.0, 5.4, 2.2, 64, 10)],
		[0, _funnel_mesh(0.7, 16.0, 72, 28)],
		[1, _funnel_mesh(0.7, 16.0, 72, 28)],
		[2, _funnel_mesh(0.86, 16.0, 72, 28)],
	]
	for li in layers.size():
		var m := ShaderMaterial.new()
		m.shader = load("res://game/godpowers/tornado.gdshader")
		m.render_priority = 21 + li
		m.set_shader_parameter("mode", int(layers[li][0]))
		m.set_shader_parameter("H", 16.0)
		var mi := MeshInstance3D.new()
		mi.mesh = layers[li][1]
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.extra_cull_margin = 16.0
		root.add_child(mi)
		mats.append(m)
	# the big wreckage caught in it: roof tiles, beams, mud bricks (lit voxel blocks)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var bm := BoxMesh.new()
	bm.size = Vector3.ONE
	mm.mesh = bm
	mm.instance_count = CHUNKS.size()
	var cm := StandardMaterial3D.new()
	cm.vertex_color_use_as_albedo = true
	cm.roughness = 0.9
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = cm
	mmi.extra_cull_margin = 16.0
	root.add_child(mmi)
	return {"root": root, "mats": mats, "chunks": mm}

# the wreckage: [size, colour, height (m), angle offset (turns)]: tiles, beams, bricks, a plank
const CHUNKS := [
	[Vector3(0.95, 0.16, 0.62), 0x8e3f28, 2.6, 0.00],
	[Vector3(1.9, 0.24, 0.24), 0x6e4a2c, 4.2, 0.37],
	[Vector3(0.55, 0.38, 0.38), 0xb89468, 3.4, 0.71],
	[Vector3(0.9, 0.15, 0.6), 0x7a3624, 5.6, 0.18],
	[Vector3(1.6, 0.2, 0.2), 0x7a5634, 7.0, 0.55],
	[Vector3(0.95, 0.16, 0.62), 0x9a4630, 8.3, 0.86],
	[Vector3(0.6, 0.4, 0.4), 0x8a8074, 6.2, 0.95],
	[Vector3(2.2, 0.26, 0.26), 0x5e3e24, 9.8, 0.30],
	[Vector3(0.9, 0.15, 0.6), 0x8e3f28, 11.0, 0.64],
	[Vector3(1.2, 0.12, 0.45), 0x9a7a52, 12.2, 0.08],
	[Vector3(0.5, 0.34, 0.34), 0xb89468, 1.8, 0.45],
	[Vector3(0.95, 0.16, 0.62), 0x7a3624, 13.2, 0.80],
]

## The wreckage's place at sim time `now` (radians round the funnel, just outside its wall).
static func _chunk_frame(mm: MultiMesh, now: float, k: float) -> void:
	for i in CHUNKS.size():
		var c: Array = CHUNKS[i]
		var h: float = float(c[2]) + sin(now * 0.8 + i * 1.7) * 0.7
		var r := 0.7 * (0.7 + 0.05 * h + 0.012 * h * h) * 1.25 + 0.55
		var a: float = float(c[3]) * TAU + now * (2.4 - 0.09 * h)
		var sw := Vector2(sin(now * 0.9 + h * 0.18) * h * 0.06, cos(now * 0.7 + h * 0.15) * h * 0.05)
		var p := Vector3(cos(a) * r + sw.x, h, sin(a) * r + sw.y)
		# flying tangentially, tumbling
		var b := Basis(Vector3.UP, -a) * Basis.from_euler(Vector3(now * (1.1 + 0.2 * i), 0.4 * i, now * (0.7 + 0.13 * i)))
		var s: float = clampf(k * 1.4 - 0.2, 0.0, 1.0)
		mm.set_instance_transform(i, Transform3D(b * Basis.from_scale(c[0] * s * 1.3), p))
		mm.set_instance_color(i, Color.hex((int(c[1]) << 8) | 0xff).darkened(0.4))   # (the grade lifts a lit albedo: kept dark)

## The skirt: a low dome of dust round the foot, from radius r0 (height h0, hugging the
## funnel) out to r1 on the ground; UV = (0 inner .. 1 outer edge, angle).
static func _skirt_mesh(r0: float, r1: float, h0: float, seg: int, rows: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for j in rows + 1:
		var u := float(j) / rows
		var r := lerpf(r0, r1, u)
		var h := h0 * pow(1.0 - u, 1.4) * (0.75 + 0.25 * (1.0 - u)) + 0.15 * sin(PI * u)
		for i in seg + 1:
			var a := float(i) / seg * TAU
			v.append(Vector3(cos(a) * r, h, sin(a) * r))
			uv.append(Vector2(u, a))
			if i > 0 and j > 0:
				var p := (j - 1) * (seg + 1) + i - 1
				var q := j * (seg + 1) + i - 1
				idx.append_array([p, p + 1, q, q, p + 1, q + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

## A funnel: rings up a flaring profile (r = s (0.7 + 0.05 h + 0.012 h^2)), UV = (h / H, angle).
static func _funnel_mesh(s: float, H: float, seg: int, rows: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for j in rows + 1:
		var hf := float(j) / rows
		var h := hf * H
		var r := s * (0.7 + 0.05 * h + 0.012 * h * h)
		for i in seg + 1:
			var a := float(i) / seg * TAU
			v.append(Vector3(cos(a) * r, h, sin(a) * r))
			uv.append(Vector2(hf, a))
			if i > 0 and j > 0:
				var p := (j - 1) * (seg + 1) + i - 1
				var q := j * (seg + 1) + i - 1
				idx.append_array([p, p + 1, q, q, p + 1, q + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m

## The rainbow: a half ring of radius R and width W in the local XY plane (feet on the ground).
static func _arc_mesh(R: float, W: float, seg: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	for i in seg + 1:
		var f := float(i) / seg
		var a := PI * f
		for j in 2:
			var r := R + W * 0.5 - W * j
			v.append(Vector3(cos(a) * r, sin(a) * r * 0.85, 0.0))
			uv.append(Vector2(f, float(j)))
		if i > 0:
			var p := (i - 1) * 2
			idx.append_array([p, p + 1, p + 2, p + 2, p + 1, p + 3])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m
