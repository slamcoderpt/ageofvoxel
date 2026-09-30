extends SubViewport
## The feature carousel's hero art, rendered live in the game's own voxel
## render: a small diorama in its own World3D (the menu's harbour town is a
## different world, so none of this shows behind the menu or touches its
## light). Zeus's army (the golden hero at the head of a hoplite phalanx,
## archers, a minotaur and a cyclops) stands before a temple on a hill under
## a crimson storm sky, a lightning bolt striking behind it. Every model is
## an exported game model (VoxelModels) in rest pose; the ground is voxel
## columns like the terrain's.
##
## Each carousel page is a framing of the diorama (PAGES): the hero portrait
## under the storm (Zeus), the phalanx from its flank at dusk (attack-move),
## a wide view over the hill (the voxel world). The tile draws `get_texture()`
## edge to edge; `set_page(i)` changes the framing and `hover` (0..1) pushes
## the camera in a little. Deterministic: a fixed RNG seed, and the camera
## drift and bolt flicker stop in captures (`still`).

const TEAM := Color8(0x2f, 0x6b, 0xff)
const SKY := preload("res://game/menu/hero_sky.gdshader")
const BOLT := preload("res://game/menu/hero_bolt.gdshader")

## Page framings: camera position, look target, fov, and the light mood
## (storm = 1: the crimson storm sky with the bolt; 0: a gold dusk).
const PAGES := [
	{"pos": Vector3(-1.7, 0.95, 7.2), "look": Vector3(2.3, 2.45, -3.0), "fov": 38.0, "storm": 1.0},
	{"pos": Vector3(10.0, 1.5, 5.0), "look": Vector3(0.5, 1.2, -1.6), "fov": 36.0, "storm": 0.0},
	{"pos": Vector3(-12.0, 10.0, 13.0), "look": Vector3(1.0, 0.8, -5.0), "fov": 40.0, "storm": 0.3},
]

var page := 0
var hover := 0.0
var still := false
var t := 0.0
var _cam: Camera3D
var _env: Environment
var _sky: ShaderMaterial
var _key: DirectionalLight3D
var _rim: DirectionalLight3D
var _flash: OmniLight3D
var _bolt: MeshInstance3D
var _bolt_mat: ShaderMaterial
var _root: Node3D
var _rng := RandomNumberGenerator.new()
var _heights := {}   # Vector2i cell -> column top (m)

const CELL := 0.5

func _init(px := Vector2i(640, 540)) -> void:
	size = px
	own_world_3d = true
	transparent_bg = false
	msaa_3d = Viewport.MSAA_2X
	render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_rng.seed = 20260930

func _ready() -> void:
	_root = Node3D.new()
	add_child(_root)
	_build_env()
	_build_ground()
	_build_town()
	_build_army()
	_build_bolt()
	_cam = Camera3D.new()
	_cam.near = 0.1
	_cam.far = 200.0
	_root.add_child(_cam)
	_cam.current = true
	set_page(page)

func set_page(i: int) -> void:
	page = clampi(i, 0, PAGES.size() - 1)
	_apply(0.0)

func _process(dt: float) -> void:
	if not still:
		t += dt
	_apply(dt)

func _apply(_dt: float) -> void:
	if _cam == null:
		return
	var p: Dictionary = PAGES[page]
	var look: Vector3 = p.look
	var pos: Vector3 = p.pos
	# a slow sway, and a push towards the subject on hover
	var sway := Vector3(sin(t * 0.21) * 0.35, sin(t * 0.17) * 0.12, 0.0)
	pos = pos.lerp(look, 0.09 * hover) + sway
	_cam.fov = float(p.fov)
	_cam.look_at_from_position(pos, look, Vector3.UP)
	var storm: float = p.storm
	_sky.set_shader_parameter("storm", storm)
	_env.fog_light_color = Color(0.75, 0.45, 0.28).lerp(Color(0.32, 0.08, 0.14), storm)
	_env.ambient_light_color = Color(0.95, 0.62, 0.42).lerp(Color(0.42, 0.3, 0.55), storm)
	_key.light_color = Color(1.0, 0.8, 0.55).lerp(Color(1.0, 0.8, 0.6), storm)
	_key.light_energy = lerpf(1.3, 1.05, storm)
	_rim.light_energy = lerpf(0.3, 2.2, storm)
	# the bolt flickers: a strike every few seconds, a steady glow in captures
	var f := 1.0
	if not still:
		var ph := fmod(t, 4.2)
		f = 0.55 + 0.45 * (1.0 if ph < 0.12 or (ph > 0.2 and ph < 0.28) else 0.0) + 0.1 * sin(t * 23.0)
	_bolt.visible = storm > 0.5
	_bolt_mat.set_shader_parameter("intensity", 5.0 * f)
	_flash.visible = storm > 0.5
	_flash.light_energy = 5.0 * f
	_sky.set_shader_parameter("flash", f * storm)

# ---- the world -------------------------------------------------------------------

func _build_env() -> void:
	var we := WorldEnvironment.new()
	_env = Environment.new()
	_sky = ShaderMaterial.new()
	_sky.shader = SKY
	_sky.set_shader_parameter("bolt_dir", Vector3(0.45, 0.4, -0.8).normalized())
	var sky := Sky.new()
	sky.sky_material = _sky
	sky.radiance_size = Sky.RADIANCE_SIZE_64
	_env.background_mode = Environment.BG_SKY
	_env.sky = sky
	_env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	_env.ambient_light_energy = 0.3
	_env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	_env.tonemap_exposure = 1.1
	_env.glow_enabled = true
	_env.glow_intensity = 0.18
	_env.glow_bloom = 0.0
	_env.glow_hdr_threshold = 2.5
	_env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SCREEN
	_env.set_glow_level(1, 1.0)
	_env.set_glow_level(2, 1.0)
	_env.set_glow_level(3, 0.0)
	_env.set_glow_level(4, 0.0)
	_env.set_glow_level(5, 0.0)
	_env.fog_enabled = true
	_env.fog_density = 0.012
	_env.fog_sky_affect = 0.0
	_env.fog_light_energy = 1.0
	_env.adjustment_enabled = true
	_env.adjustment_saturation = 1.25
	_env.adjustment_contrast = 1.12
	we.environment = _env
	_root.add_child(we)
	# key: a warm low light from the front left (the faces catch it)
	_key = DirectionalLight3D.new()
	_key.rotation = Vector3(deg_to_rad(-24.0), deg_to_rad(-38.0), 0.0)
	_key.shadow_enabled = true
	_key.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	_key.directional_shadow_max_distance = 40.0
	_root.add_child(_key)
	# rim: the storm's cold light from behind, outlining helmets and spears
	_rim = DirectionalLight3D.new()
	_rim.rotation = Vector3(deg_to_rad(-18.0), deg_to_rad(160.0), 0.0)
	_rim.light_color = Color(0.62, 0.76, 1.0)
	_root.add_child(_rim)
	_flash = OmniLight3D.new()
	_flash.position = Vector3(8.5, 4.0, -11.0)
	_flash.light_color = Color(0.7, 0.8, 1.0)
	_flash.omni_range = 16.0
	_root.add_child(_flash)

## Terrain height (m) at cell c: the plain the army stands on, a path, the
## temple hill stepping up behind, knolls at the sides.
func _h(x: float, z: float) -> float:
	var h := 0.0
	# the hill behind: rises from z=-6 to a plateau at z<-9.5
	h += clampf((-z - 6.0) / 3.5, 0.0, 1.0) * 2.0
	# rolling ground
	h += 0.25 * sin(x * 0.7 + 1.3) * cos(z * 0.5) + 0.2 * sin(x * 0.23 - z * 0.31)
	# knolls on the far flanks
	h += maxf(0.0, 1.0 - Vector2(x + 10.0, z + 3.0).length() / 5.0) * 2.2
	h += maxf(0.0, 1.0 - Vector2(x - 11.0, z + 1.0).length() / 5.5) * 1.8
	# the plain where the army stands is flat
	var flat := clampf(1.0 - (Vector2(x * 0.8, z + 1.5).length() - 3.5) / 2.5, 0.0, 1.0)
	h = lerpf(h, 0.0, flat * clampf((z + 6.0) / 2.0, 0.0, 1.0))
	return snappedf(h, 0.25)

func height(x: float, z: float) -> float:
	var c := Vector2i(floori(x / CELL), floori(z / CELL))
	return _heights.get(c, 0.0)

func _hash(x: int, z: int) -> float:
	var n := (x * 73856093) ^ (z * 19349663)
	n = (n ^ (n >> 13)) * 1274126177
	return float(n & 0xffff) / 65535.0

func _build_ground() -> void:
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.vertex_color_is_srgb = true
	mat.roughness = 1.0
	mat.metallic_specular = 0.0
	box.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = box
	var cells := []
	for ix in range(-44, 45):
		for iz in range(-70, 22):
			cells.append(Vector2i(ix, iz))
	mm.instance_count = cells.size()
	var i := 0
	for c: Vector2i in cells:
		var x := (c.x + 0.5) * CELL
		var z := (c.y + 0.5) * CELL
		var h := _h(x, z)
		_heights[c] = h
		var j := _hash(c.x, c.y)
		var col := Color(0.34, 0.5, 0.2).lerp(Color(0.46, 0.58, 0.24), j)
		# a dirt road from the front up to the temple
		var road := absf(x - 0.35 - sin(z * 0.25) * 0.5)
		if road < 1.1 + j * 0.3:
			col = Color(0.55, 0.43, 0.29).lerp(Color(0.64, 0.52, 0.36), j)
		# stone where the hill steps
		var s := absf(_h(x, z + CELL) - h) + absf(_h(x + CELL, z) - h)
		if s > 0.3 and road >= 1.1:
			col = Color(0.5, 0.48, 0.44).lerp(Color(0.62, 0.6, 0.55), j)
		var bottom := -2.0
		mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(CELL, h - bottom, CELL)), Vector3(x, (h + bottom) * 0.5, z)))
		mm.set_instance_color(i, col)
		i += 1
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	_root.add_child(mi)

func _put(g: String, model: String, pos: Vector3, rot := 0.0, s := 1.0) -> void:
	var m := VoxelModels.mesh(g, model)
	if m == null:
		return
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.material_override = VoxelModels.team_material(TEAM)
	mi.transform = Transform3D(Basis(Vector3.UP, rot).scaled(Vector3.ONE * s), pos)
	_root.add_child(mi)

func _ground(x: float, z: float) -> Vector3:
	return Vector3(x, height(x, z), z)

func _build_town() -> void:
	# the temple on the hill, statues and columns before it
	_put("buildings", "temple/0", _ground(0.4, -12.5))
	_put("props", "statue", _ground(-3.2, -9.6), 0.3)
	_put("props", "statue", _ground(4.0, -9.6), -0.3)
	_put("props", "altar", _ground(0.4, -8.6))
	_put("buildings", "house/3", _ground(-7.5, -12.0), 0.4)
	_put("buildings", "house/7", _ground(8.0, -12.5), -0.3)
	_put("props", "pillar", _ground(-1.8, -7.2))
	_put("props", "pillar", _ground(2.6, -7.2))
	# cypresses and olives framing it, trees on the knolls
	for c in [Vector2(-4.8, -10.5), Vector2(5.8, -10.8), Vector2(-9.5, -9.0), Vector2(10.5, -8.5), Vector2(-6.0, -7.0)]:
		_put("props", "cypress", _ground(c.x, c.y), _rng.randf() * TAU)
	for c in [Vector2(-8.5, -3.5), Vector2(-11.0, 0.5), Vector2(12.0, -4.0)]:
		_put("resources", "tree%d" % _rng.randi_range(0, 9), _ground(c.x, c.y), _rng.randf() * TAU)
	for c in [Vector2(-10.0, -2.5), Vector2(-12.5, -5.5), Vector2(11.5, -6.5)]:
		_put("resources", "tree%d" % _rng.randi_range(0, 9), _ground(c.x, c.y), _rng.randf() * TAU)
	_put("resources", "gold", _ground(-6.5, -1.0))
	_put("resources", "berry", _ground(-8.0, -5.5))
	_put("props", "amphorae", _ground(-4.6, 1.8))

## A unit in rest pose (as the model gallery assembles it), facing +z turned by rot.
func _unit(unit_type: String, x: float, z: float, rot := 0.0) -> void:
	var rig := VoxelModels.rig(unit_type)
	if rig.is_empty():
		return
	var V: float = rig.voxel
	var base := Transform3D(Basis(Vector3.UP, rot), _ground(x, z))
	var world: Array[Transform3D] = []
	var mat := VoxelModels.team_material(TEAM)
	for p in rig.parts:
		var local := Transform3D(Basis(), Vector3(p.joint[0], p.joint[1], p.joint[2]) * V)
		var parent := base if int(p.parentIdx) < 0 else world[int(p.parentIdx)]
		var w := parent * local
		world.append(w)
		if p.conditional and not p.portrait:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = VoxelModels.mesh("units", p.mesh)
		mi.material_override = mat
		mi.transform = w
		_root.add_child(mi)

func _build_army() -> void:
	# the hero at the head, a little forward
	_unit("hero", 0.0, 0.9, -0.12)
	# the phalanx: ranks behind him, a rank either side
	for rank in 4:
		var z := -0.6 - rank * 1.15
		var n := 7 + rank
		for k in n:
			var x := (k - (n - 1) * 0.5) * 1.05 + (0.5 if rank % 2 == 1 else 0.0) * 0.5
			if rank == 0 and absf(x) < 0.8:
				continue
			_unit("hoplite" if rank < 3 else "toxotes", x + _rng.randf_range(-0.12, 0.12), z + _rng.randf_range(-0.1, 0.1), _rng.randf_range(-0.15, 0.15))
	for k in 3:
		_unit("hoplite", -2.2 - k * 1.05, 0.35, 0.08)
		_unit("hoplite", 2.4 + k * 1.05, 0.35, -0.08)
	# myth units on the flanks
	_unit("minotaur", 4.0, -1.8, -0.45)
	_unit("cyclops", -5.2, -3.4, 0.4)
	_unit("hippikon", 6.2, -3.4, -0.6)
	_unit("hippikon", -6.6, -0.8, 0.5)

## Zeus's bolt: a jagged ribbon (and forks) from the clouds to the hill behind
## the temple, facing the first page's camera, additive and over-bright so
## the glow picks it up.
func _build_bolt() -> void:
	var top := Vector3(16.0, 24.0, -30.0)
	var end := Vector3(9.5, height(9.5, -13.0) + 0.2, -13.0)
	var eye: Vector3 = PAGES[0].pos
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var main := _jag(top, end, 6, 2.6)
	_ribbon(st, main, eye, 0.28, 0.12)
	# forks
	for k in [2, 4, 5]:
		if k < main.size() - 1:
			var a: Vector3 = main[k * main.size() / 8]
			var dir := (end - top).normalized().rotated(Vector3.FORWARD, _rng.randf_range(-0.9, 0.9))
			var b := a + dir * _rng.randf_range(4.0, 7.0) + Vector3(_rng.randf_range(-2.0, 2.0), 0, 0)
			_ribbon(st, _jag(a, b, 4, 0.9), eye, 0.12, 0.04)
	_sky.set_shader_parameter("bolt_dir", (top.lerp(end, 0.35) - eye).normalized())
	_bolt = MeshInstance3D.new()
	_bolt.mesh = st.commit()
	_bolt.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_bolt_mat = ShaderMaterial.new()
	_bolt_mat.shader = BOLT
	_bolt.material_override = _bolt_mat
	_root.add_child(_bolt)

func _jag(a: Vector3, b: Vector3, depth: int, amp: float) -> Array:
	var pts := [a, b]
	var d := amp
	for _i in depth:
		var np := [pts[0]]
		for k in range(1, pts.size()):
			var m: Vector3 = (pts[k - 1] + pts[k]) * 0.5
			m += Vector3(_rng.randf_range(-d, d), _rng.randf_range(-d, d) * 0.4, _rng.randf_range(-d, d) * 0.5)
			np.append(m)
			np.append(pts[k])
		pts = np
		d *= 0.55
	return pts

func _ribbon(st: SurfaceTool, pts: Array, eye: Vector3, w0: float, w1: float) -> void:
	for k in range(1, pts.size()):
		var a: Vector3 = pts[k - 1]
		var b: Vector3 = pts[k]
		var u0 := float(k - 1) / (pts.size() - 1)
		var u1 := float(k) / (pts.size() - 1)
		var wa := lerpf(w0, w1, u0) * 1.0
		var wb := lerpf(w0, w1, u1) * 1.0
		var side := (b - a).cross(eye - (a + b) * 0.5).normalized()
		var v := [a - side * wa, a + side * wa, b + side * wb, b - side * wb]
		var uv := [Vector2(0, u0), Vector2(1, u0), Vector2(1, u1), Vector2(0, u1)]
		for i in [0, 1, 2, 0, 2, 3]:
			st.set_uv(uv[i])
			st.add_vertex(v[i])
