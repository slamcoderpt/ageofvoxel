extends Node3D
## God power visuals (port of the render half of src/godpowers: effects.js
## BoltRenderer and the visual lists of index.js). The sim half (favor,
## cooldowns, Lightning Storm, Bolt, Meteor, thrown units) is C++ in
## native/src/sim/godpowers; everything drawn here is a function of the sim
## time, so a paused capture is exact.
##
##   - Lightning: fractal channels with forks and sub-forks as camera-facing
##     ribbons (white-hot core, blue / violet bloom), ground arcs, an impact
##     ball and stem, a ground flash, a crisp flash disc, a shock ring, point
##     lights, one shadow-casting spot over the freshest strike, light pools
##     relighting the land (grade pass), scorches with cooling ember cracks,
##     crater debris, char rims, spark streaks and smoke.
##   - Storm: the full-frame storm grade (world-space darkening, drifting
##     cloud shadows, violet spill round the wall; the world position comes
##     from the depth buffer), the funnel (energy wall, dark cloud body front
##     and back, dust wall, ground shockwave), spiralling energy bands with
##     earth and turf riding them, debris whirled up the funnel, rain, cloud
##     crawlers, trails / back lights / drop shadows of the men it carries, a
##     violet light over its heart and one circling inside; it dims the sun
##     and sky light and darkens the grade (lighting piece public API).
##   - Zaps crawling over struck men, with an electric back light.
##   - Meteor: fireball, flame trail, warning ring, blast flash, shock ring,
##     burning crater (flames, black smoke, flickering light).
##
## All per-frame buffers are built in C++ by AovGodpowerView
## (native/src/godpower_view.{h,cpp}) in one call: no per-entity script
## work, and nothing at all while no power is active.
##
## Public API: `view` (the AovGodpowerView), `storm_k` (0..1 strength of
## the strongest storm this frame).

const STRIDE := 20
const DIR := "res://game/godpowers/"

var game: Node = null
var view = null   # AovGodpowerView
var egypt = null  # egypt_fx.gd (the Egyptian powers' grade, rainbow, tornado funnels)
var storm_k := 0.0

var _ribbon_mesh := ArrayMesh.new()
var _ribbon_mats: Array[ShaderMaterial] = []
var _mms: Array[MultiMesh] = []
var _lights: Array[OmniLight3D] = []
var _spot: SpotLight3D
var _grade_mul: MeshInstance3D
var _grade_add: MeshInstance3D
var _grade_mat: ShaderMaterial
var _grade_add_mat: ShaderMaterial
var _storms := {}   # storm id -> {root: Node3D, mats: Array[ShaderMaterial], rain: ShaderMaterial}
var _idle := true
var _light_base := {}
var _bars_hidden := false

# ribbon groups (AovGodpowerView::Group): halo, core, gain, edge, screen
const BLUE := 0x3d9bff
const VIOLET := 0x6b3dff
const WHITE := 0xeef6ff

static func _lin(hex: int) -> Vector3:
	var c := Color.hex((hex << 8) | 0xff).srgb_to_linear()
	return Vector3(c.r, c.g, c.b)

func _mat(file: String, priority: int) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(DIR + file)
	m.render_priority = priority
	return m

func _ribbon_mat(halo, core, gain: float, edge, screen := 1.0, spark := false) -> ShaderMaterial:
	var m := _mat("ribbon.gdshader", 30)
	m.set_shader_parameter("halo", halo if halo is Vector3 else _lin(halo))
	m.set_shader_parameter("core", core if core is Vector3 else _lin(core))
	m.set_shader_parameter("edge", edge if edge is Vector3 else _lin(edge))
	m.set_shader_parameter("gain", gain)
	m.set_shader_parameter("screen", screen)
	m.set_shader_parameter("spark", spark)
	return m

func _add_mm(mesh: Mesh, mat: Material, node_name: String, shadow: bool, aabb: AABB) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = mesh
	mm.custom_aabb = aabb
	mm.instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.name = node_name
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadow else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	_mms.append(mm)
	return mm

func setup(g: Node) -> void:
	game = g
	var size := float(game.sim.get_map_size())
	var aabb := AABB(Vector3(-32, -40, -32), Vector3(size + 64, 200, size + 64))
	view = ClassDB.instantiate("AovGodpowerView")
	view.setup(game.sim)

	# ribbons: one surface per group, rebuilt per frame
	_ribbon_mats = [
		_ribbon_mat(BLUE, Vector3(1.0, 0.98, 1.08), 2.8, VIOLET),        # ground bolts
		_ribbon_mat(BLUE, WHITE, 1.35, VIOLET),                          # cloud crawlers
		_ribbon_mat(BLUE, WHITE, 2.2, VIOLET),                           # zaps
		_ribbon_mat(0x7a50ff, 0xf2eaff, 1.9, 0x9a28ff),                  # storm bands
		_ribbon_mat(0x4f8cff, 0xeef6ff, 1.9, 0x5a3dff),                  # storm bands (blue)
		_ribbon_mat(0x8a60ff, 0xe8dcff, 1.2, 0x6a30ff),                  # flyer trails
		_ribbon_mat(0xff5a10, 0xffe0a0, 3.0, 0xc0200a, 0.0),             # meteor trail
		_ribbon_mat(BLUE, WHITE, 1.0, VIOLET, 1.0, true),                # sparks
		_ribbon_mat(Vector3(0.8, 0.72, 1.0), WHITE, 1.0, Vector3(0.42, 0.26, 1.0)),  # bloom veil
		# (the Egyptian powers, egypt_fx.gd / godpower_view_egypt.cpp)
		_ribbon_mat(0xffb030, 0xfff4c8, 2.4, 0xff7010),                  # gold: chain lightning, sun beams, spinning blades
		_ribbon_mat(Vector3(0.28, 0.32, 0.38), Vector3(0.75, 0.8, 0.88), 0.55, Vector3(0.18, 0.2, 0.26), 0.0),  # rain streaks
		_ribbon_mat(0xc8a060, 0xffe2a8, 0.9, 0x8a6a3a),                  # sand ribbons
		# the Son of Osiris' chain lightning: linear gold leaning to yellow, kept below where AgX
		# bleaches a saturated orange to salmon pink
		_ribbon_mat(Vector3(1.0, 0.5, 0.0), Vector3(1.0, 0.72, 0.16), 0.95, Vector3(0.75, 0.28, 0.0)),
		# Prosperity's column of gold light over the mines: the same kept-low linear gold, softer,
		# leaning further to yellow at the fringe so the shaft over sand reads gold, not salmon
		_ribbon_mat(Vector3(0.9, 0.55, 0.0), Vector3(1.0, 0.78, 0.12), 0.8, Vector3(0.6, 0.3, 0.0)),
	]
	var prio := [30, 29, 31, 27, 27, 26, 30, 32, 29, 31, 24, 28, 31, 29]
	for i in _ribbon_mats.size():
		_ribbon_mats[i].render_priority = prio[i]
	_ribbon_mesh.custom_aabb = aabb
	var rmi := MeshInstance3D.new()
	rmi.name = "GP_Ribbons"
	rmi.mesh = _ribbon_mesh
	rmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(rmi)

	# instance buffers (AovGodpowerView::Inst order)
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var plane := PlaneMesh.new()
	plane.size = Vector2(1, 1)
	_add_mm(box, _mat("debris.gdshader", 0), "GP_Debris", true, aabb)
	_add_mm(box, _mat("ember.gdshader", 0), "GP_Embers", false, aabb)
	_add_mm(quad, _mat("glow.gdshader", 35), "GP_Glows", false, aabb)
	_add_mm(quad, _mat("glow_depth.gdshader", 33), "GP_Rims", false, aabb)
	_add_mm(plane, _mat("decal_mix.gdshader", 1), "GP_Scorches", false, aabb)
	_add_mm(plane, _mat("decal_add.gdshader", 12), "GP_Flashes", false, aabb)
	_add_mm(plane, _mat("decal_mul.gdshader", 3), "GP_Shadows", false, aabb)
	_add_mm(quad, _mat("puff.gdshader", 15), "GP_Smoke", false, aabb)
	_add_mm(quad, _mat("flame.gdshader", 16), "GP_Flames", false, aabb)

	# pooled lights: 4 strike / fire / meteor lights + 2 storm lights
	for i in 6:
		var l := OmniLight3D.new()
		l.name = "GP_Light%d" % i
		l.light_energy = 0.0
		l.shadow_enabled = false
		l.visible = false
		add_child(l)
		_lights.append(l)
	_spot = SpotLight3D.new()
	_spot.name = "GP_Spot"
	_spot.light_color = Color.hex(0xcfe0ffff)
	_spot.spot_range = 18.0
	_spot.spot_angle = rad_to_deg(1.4)
	_spot.spot_attenuation = 2.0
	_spot.spot_angle_attenuation = 0.6
	_spot.shadow_enabled = true
	_spot.shadow_bias = 0.04
	_spot.shadow_normal_bias = 0.8
	_spot.visible = false
	add_child(_spot)

	# the full-frame storm grade (multiply) + its additive haze
	var fq := QuadMesh.new()
	fq.size = Vector2(2, 2)
	_grade_mat = _mat("storm_grade.gdshader", 10)
	_grade_add_mat = _mat("storm_grade_add.gdshader", 11)
	_grade_mul = _fullscreen(fq, _grade_mat, "GP_GradeMul")
	_grade_add = _fullscreen(fq, _grade_add_mat, "GP_GradeAdd")
	# the Egyptian powers' own nodes: the Eclipse / Rain grade, the rainbow, tornado funnels
	egypt = preload("res://game/godpowers/egypt_fx.gd").new()
	egypt.name = "EgyptFX"
	add_child(egypt)
	egypt.setup(self)
	AovScenes.set_setup("egypt_powers", preload("res://game/godpowers/egypt_powers_scene.gd").scene_setup)

func _fullscreen(mesh: Mesh, mat: Material, node_name: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = node_name
	mi.mesh = mesh
	mi.material_override = mat
	mi.extra_cull_margin = 16384.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	add_child(mi)
	return mi

static func _upload(mm: MultiMesh, buf: PackedFloat32Array, n: int) -> void:
	if n == 0 and mm.visible_instance_count == 0:
		return
	var cap := buf.size() / STRIDE
	if mm.instance_count != cap:
		mm.instance_count = cap
	mm.buffer = buf
	mm.visible_instance_count = n

func frame(_dt: float, alpha: float) -> void:
	var cam_pos: Vector3 = game.camera.global_position
	var d: Dictionary = view.update(alpha, game.paused, cam_pos)
	if d.is_empty():
		return
	if not d.active:
		if not _idle:
			egypt.frame({}, float(d.get("time", 0.0)))
			_clear()
		return
	_idle = false
	var now: float = d.time

	# ribbons
	_ribbon_mesh.clear_surfaces()
	var ribbons: Array = d.ribbons
	var fmt := (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT) | (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT)
	var fmt_spark := fmt | (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM2_SHIFT)
	for gi in ribbons.size():
		var arr = ribbons[gi]
		if arr == null:
			continue
		_ribbon_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, fmt_spark if gi == 7 else fmt)
		_ribbon_mesh.surface_set_material(_ribbon_mesh.get_surface_count() - 1, _ribbon_mats[gi])

	# instances
	var inst: Array = d.inst
	var counts: PackedInt32Array = d.counts
	for i in _mms.size():
		_upload(_mms[i], inst[i], counts[i])
	(get_node("GP_Flashes") as MultiMeshInstance3D).material_override.set_shader_parameter("time", now)

	# lights
	var L: PackedFloat32Array = d.lights
	for i in _lights.size():
		var l := _lights[i]
		var o := i * 9
		if o + 8 >= L.size() or L[o + 6] <= 0.001:
			l.visible = false
			continue
		l.visible = true
		l.position = Vector3(L[o], L[o + 1], L[o + 2])
		l.light_color = Color(L[o + 3], L[o + 4], L[o + 5]).linear_to_srgb()
		l.light_energy = L[o + 6] / PI
		l.omni_range = L[o + 7] if L[o + 7] > 0.0 else 120.0
		l.omni_attenuation = L[o + 8]
	var sp: Array = d.spot
	if sp.size() == 4 and float(sp[3]) > 0.01:
		_spot.visible = true
		var p := Vector3(sp[0], sp[1], sp[2])
		_spot.transform = Transform3D(Basis.looking_at(Vector3(-0.1, -2.6, -0.1), Vector3(0, 0, 1)), p)
		_spot.light_energy = float(sp[3]) / PI
	else:
		_spot.visible = false

	# storms: static meshes per storm, uniforms per frame
	var flash: float = d.flash
	var seen := {}
	for st in d.storms:
		var id: int = st.id
		seen[id] = true
		if not _storms.has(id):
			_storms[id] = _make_storm(st)
		var sv: Dictionary = _storms[id]
		for m in sv.mats:
			m.set_shader_parameter("time", now)
			m.set_shader_parameter("k", st.k)
			m.set_shader_parameter("flash", flash)
		sv.wall.set_shader_parameter("hot_a", st.hot_a)
		sv.wall.set_shader_parameter("hot_w", st.hot_w)
	for id in _storms.keys():
		if not seen.has(id):
			_storms[id].root.queue_free()
			_storms.erase(id)

	# grade + light pools
	var storm: Dictionary = d.storm
	storm_k = float(storm.get("k", 0.0))
	var pools: PackedFloat32Array = d.pools
	var show := storm_k > 0.0 or pools.size() > 0
	_grade_mul.visible = show
	_grade_add.visible = show
	if show:
		var pv := PackedVector4Array()
		for i in 6:
			if i * 4 + 3 < pools.size():
				pv.append(Vector4(pools[i * 4], pools[i * 4 + 1], pools[i * 4 + 2], pools[i * 4 + 3]))
			else:
				pv.append(Vector4(0, 0, 0, 1))
		for m in [_grade_mat, _grade_add_mat]:
			m.set_shader_parameter("pools", pv)
			m.set_shader_parameter("k", storm_k)
			m.set_shader_parameter("flash", flash)
			m.set_shader_parameter("time", now)
			if storm_k > 0.0:
				m.set_shader_parameter("center", Vector2(storm.x, storm.z))
				m.set_shader_parameter("radius", storm.rb)
				m.set_shader_parameter("plane_y", storm.y)
			elif pools.size() > 0:
				m.set_shader_parameter("plane_y", game.sim.height_at(pools[0], pools[1]))
	egypt.frame(d.get("egypt", {}), now)
	_storm_light(storm_k)

## Nothing active any more: hide everything, give the lighting back.
func _clear() -> void:
	_idle = true
	_ribbon_mesh.clear_surfaces()
	for mm in _mms:
		mm.visible_instance_count = 0
	for l in _lights:
		l.visible = false
	_spot.visible = false
	_grade_mul.visible = false
	_grade_add.visible = false
	for id in _storms.keys():
		_storms[id].root.queue_free()
	_storms.clear()
	storm_k = 0.0
	_storm_light(0.0)

## The cloud deck dims the sun and sky light and darkens the grade
## (effects.js stormLight), through the lighting piece's public API.
## (Godot: the Egyptian Eclipse and Rain dim it too, egypt_fx.gd light_k /
## light_dim / light_fog: the strongest of the storm and them wins)
func _storm_light(k: float) -> void:
	var lp = game.pieces.get("lighting")
	if lp == null:
		return
	var bars_k := k
	var fog_col := Color.hex(0x141a2cff)
	var dim := 1.0
	if egypt != null and egypt.light_k > k:
		k = egypt.light_k
		fog_col = egypt.light_fog
		dim = egypt.light_dim
	var items := []
	if lp.get("sun"):
		items.append([lp.sun, "light_energy", 0.66])
	if lp.get("fill"):
		items.append([lp.fill, "light_energy", 0.2])
	for h in lp.get("hemi_lights") if lp.get("hemi_lights") != null else []:
		items.append([h, "light_energy", 0.35])
	if lp.get("env"):
		items.append([lp.env, "ambient_light_energy", 0.35])
	for it in items:
		_ease(it[0], it[1], _base(it[0], it[1]) * (1.0 - minf(0.95, it[2] * dim) * k))
	if lp.get("env"):
		var env: Environment = lp.env
		var fb: Color = _base(env, "fog_light_color")
		_ease(env, "fog_light_color", fb.lerp(fog_col, k))
	var gr = lp.get("grade")
	if gr != null:
		_ease(gr, "vignette", lerpf(_base(gr, "vignette"), 0.55, k))
		_ease(gr, "top_haze", lerpf(_base(gr, "top_haze"), 0.0, k))
		_ease(gr, "floor_value", lerpf(_base(gr, "floor_value"), 0.0, k))
		_ease(gr, "saturation", lerpf(_base(gr, "saturation"), _base(gr, "saturation") * 1.08, k))
	var combat = game.pieces.get("combat")
	if combat != null:
		var bars: Node3D = combat.get_node_or_null("HealthBars")
		if bars != null:
			if bars_k > 0.0:
				bars.visible = false
				_bars_hidden = true
			elif _bars_hidden:
				bars.visible = true
				_bars_hidden = false

## Remember a property's own value (re-read when someone else changed it).
func _base(obj: Object, prop: String):
	var key := "%d:%s" % [obj.get_instance_id(), prop]
	var cur = obj.get(prop)
	if not _light_base.has(key) or _light_base[key].set != cur:
		_light_base[key] = {"base": cur, "set": cur}
	return _light_base[key].base

func _ease(obj: Object, prop: String, value) -> void:
	var key := "%d:%s" % [obj.get_instance_id(), prop]
	_base(obj, prop)
	obj.set(prop, value)
	_light_base[key].set = obj.get(prop)

## The funnel of one storm: energy wall, cloud body (far + near), dust wall,
## ground shockwave and rain; built once from AovGodpowerView.storm_static.
func _make_storm(st: Dictionary) -> Dictionary:
	var s: Dictionary = view.storm_static(st.id)
	var gh: PackedFloat32Array = s.gh
	var rb: float = s.rb
	var rt: float = s.rt
	var H: float = s.H
	var root := Node3D.new()
	root.name = "GP_Storm%d" % st.id
	root.position = Vector3(st.x, 0, st.z)
	add_child(root)
	var mats: Array[ShaderMaterial] = []
	var wall := _mat("storm_wall.gdshader", 24)
	wall.set_shader_parameter("uH", H)
	var back := _mat("storm_body.gdshader", 21)
	back.set_shader_parameter("uH", H)
	back.set_shader_parameter("front", false)
	var front := _mat("storm_body.gdshader", 23)
	front.set_shader_parameter("uH", H)
	front.set_shader_parameter("front", true)
	var dust := _mat("storm_dust.gdshader", 20)
	dust.set_shader_parameter("uH", 4.2)
	var ground := _mat("storm_ground.gdshader", 2)
	var rain := _mat("rain.gdshader", 25)
	mats.append_array([wall, back, front, dust, ground, rain])
	_mesh_child(root, _funnel(gh, rb, rt, H, 192, 18), wall)
	var fg := _funnel(gh, rb * 0.97, rt * 0.97, H, 160, 22)
	_mesh_child(root, fg, back)
	_mesh_child(root, fg, front)
	_mesh_child(root, _funnel(gh, rb * 0.98, rb * 1.4, 4.2, 160, 8), dust)
	_mesh_child(root, _ground_ring(st.x, st.z, rb, rb * 0.8, rb * 1.75), ground)
	# rain streaks (line segments; the shader drops them)
	var rv := PackedVector3Array()
	var ruv := PackedVector2Array()
	var R: PackedFloat32Array = s.rain
	for i in R.size() / 3:
		var p := Vector3(R[i * 3], 0, R[i * 3 + 1])
		rv.append(p); rv.append(p)
		ruv.append(Vector2(0, R[i * 3 + 2])); ruv.append(Vector2(1, R[i * 3 + 2]))
	var ra := []
	ra.resize(Mesh.ARRAY_MAX)
	ra[Mesh.ARRAY_VERTEX] = rv
	ra[Mesh.ARRAY_TEX_UV] = ruv
	var rm := ArrayMesh.new()
	rm.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, ra)
	rm.custom_aabb = AABB(Vector3(-40, -5, -40), Vector3(80, 40, 80))
	var rmi := _mesh_child(root, rm, rain)
	rmi.position.y = float(st.y)
	return {"root": root, "mats": mats, "wall": wall}

func _mesh_child(root: Node3D, mesh: Mesh, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	return mi

## funnelGeometry: rings stacked up the profile, the foot following the
## smoothed terrain round the ring. UV = (height fraction, angle).
func _funnel(gh: PackedFloat32Array, rb: float, rt: float, H: float, seg: int, rows: int) -> ArrayMesh:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	var na := gh.size()
	var base := 1e9
	for x in gh:
		base = minf(base, x)
	for j in rows + 1:
		var h := float(j) / rows
		var r := rb + (rt - rb) * pow(h, 1.7)
		for i in seg + 1:
			var a := float(i) / seg * TAU
			var g := gh[int(float(i) / seg * na) % na]
			var y := g + (base - g) * minf(1.0, h * 2.5) + h * H
			v.append(Vector3(cos(a) * r, y, sin(a) * r))
			uv.append(Vector2(h, a))
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

## groundRingGeometry: terrain-following annulus, UV = (r / rb, angle).
func _ground_ring(cx: float, cz: float, rb: float, r0: float, r1: float, na := 220, nr := 30) -> ArrayMesh:
	var v := PackedVector3Array()
	var uv := PackedVector2Array()
	var idx := PackedInt32Array()
	var sim = game.sim
	for j in nr + 1:
		var r := r0 + (r1 - r0) * (float(j) / nr)
		for i in na + 1:
			var a := float(i) / na * TAU
			var x := cos(a) * r
			var z := sin(a) * r
			v.append(Vector3(x, sim.height_at(cx + x, cz + z) + 0.05, z))
			uv.append(Vector2(r / rb, a))
			if i > 0 and j > 0:
				var p := (j - 1) * (na + 1) + i - 1
				var q := j * (na + 1) + i - 1
				idx.append_array([p, q, p + 1, p + 1, q, q + 1])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_TEX_UV] = uv
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m
