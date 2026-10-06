extends Node3D
## The Egyptian powers' own nodes (child of godpowers.gd, which draws everything else of
## theirs from AovGodpowerView: godpower_view_egypt.cpp). Fed once a frame with the view's
## "egypt" state:
##   - the full-frame grade (egypt_grade.gdshader): Bast's Eclipse sinks the world in a deep
##     blue dusk, Ra's Rain washes it cool grey with drifting cloud shadows; both dim the sun
##     and sky through godpowers.gd _storm_light (light_k / light_dim / light_fog);
##   - Ra's rainbow (rainbow.gdshader) arching over the caster's Town Center, turned to the
##     camera;
##   - Horus' tornado funnels (tornado.gdshader): a dust column and a darker core on a ring
##     mesh, following the sim's spiral.
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

var _grade: MeshInstance3D
var _grade_mat: ShaderMaterial
var _rainbow: MeshInstance3D
var _rainbow_mat: ShaderMaterial
var _funnels := {}           # tornado id -> {root, mats}
var _citadels := {}          # Town Center id -> MeshInstance3D (the Citadel's fortress)
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
	if ecl >= rk * 0.55:
		light_k = ecl
		light_dim = 1.15
		light_fog = Color.hex(0x1a1c3cff)
	else:
		light_k = rk * 0.55
		light_dim = 0.7
		light_fog = Color.hex(0x5a646eff)
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
	for layer in 2:
		var m := ShaderMaterial.new()
		m.shader = load("res://game/godpowers/tornado.gdshader")
		m.render_priority = 22 + layer
		m.set_shader_parameter("core", layer == 0)
		m.set_shader_parameter("H", 16.0)
		var mi := MeshInstance3D.new()
		mi.mesh = _funnel_mesh(0.7 if layer == 0 else 1.25, 16.0, 64, 24)
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.extra_cull_margin = 16.0
		root.add_child(mi)
		mats.append(m)
	return {"root": root, "mats": mats}

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
