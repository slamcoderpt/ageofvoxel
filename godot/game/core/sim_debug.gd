extends Node3D
## Sim debug view (foundation): every unit as a box in its owner's colour,
## sized by its radius, facing its rotation (+z at rot 0), interpolated
## between the last two ticks with game.alpha; the dead lie flat and grey.
## One MultiMesh, filled from AovSim.get_units() once per frame. main.gd adds
## it while the units piece has no renderer (or with --simdebug=1).
##
## --simdemo=1 [--simdemo_t=S]: spawn two armies at the first two starts,
## order a formation move of each onto the midpoint and step S seconds
## (default 7) so a capture shows armies marching and meeting.

const PLAYER_COLORS := [0xbbbbbb, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818]

var game: Node = null
var _mm: MultiMesh
var _colors: Array[Color] = []
var _radius: Array[float] = []   # per unit type

func setup(g: Node) -> void:
	game = g
	for t in game.sim.unit_type_names():
		_radius.append(float(game.sim.get_unit_def(t).radius))
	for c in PLAYER_COLORS:
		_colors.append(Color.hex((c << 8) | 0xff))
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_colors = true
	var box := BoxMesh.new()
	box.size = Vector3(1.0, 1.0, 1.0)
	_mm.mesh = box
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.8
	box.material = mat
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "UnitMarkers"
	mmi.multimesh = _mm
	add_child(mmi)
	if AovArgs.flag(game.args, "simdemo", false):
		_demo()

func _demo() -> void:
	var sim: Object = game.sim
	var starts: Array = sim.get_starts()
	var a: Dictionary = starts[0]
	var b: Dictionary = starts[1]
	var A := Vector2(a.tx + 0.5, a.tz + 0.5)
	var B := Vector2(b.tx + 0.5, b.tz + 0.5)
	var mid := (A + B) * 0.5
	var armies := []
	for side in [[1, A, B], [2, B, A]]:
		var o: int = side[0]
		var p: Vector2 = side[1]
		var dir: Vector2 = (side[2] - p).normalized()
		var rot := atan2(dir.x, dir.y)
		var c := p + dir * 8.0
		var ids := PackedInt32Array()
		ids.append_array(sim.spawn_block("hoplite", o, 36, c.x, c.y, 9, 1.1, rot))
		ids.append_array(sim.spawn_block("toxotes", o, 18, c.x - dir.x * 4, c.y - dir.y * 4, 9, 1.1, rot))
		ids.append_array(sim.spawn_block("hippikon", o, 8, c.x - dir.x * 8, c.y - dir.y * 8, 8, 1.6, rot))
		ids.append_array(sim.spawn_block("minotaur", o, 2, c.x + dir.y * 7, c.y - dir.x * 7, 2, 2.2, rot))
		sim.spawn_block("villager", o, 10, p.x - dir.x * 4, p.y - dir.y * 4, 5, 1.1, rot)
		armies.append(ids)
	sim.order_move(armies[0], mid.x - (B - A).normalized().x * 3, mid.y - (B - A).normalized().y * 3)
	sim.order_move(armies[1], mid.x + (B - A).normalized().x * 3, mid.y + (B - A).normalized().y * 3)
	var secs := float(game.args.get("simdemo_t", 7.0))
	sim.tick(int(round(secs * 30.0)))
	var st: Dictionary = sim.get_stats()
	print("simdemo: %d units, %d moving after %.1f s; paths %d searches, %d cache hits" % [
		st.alive, st.moving, secs, st.path_searches, st.path_cache_hits])
	game.ctx["focus"] = mid

func frame(_dt: float, alpha: float) -> void:
	var U: Dictionary = game.sim.get_units()
	var n: int = U.count
	if _mm.instance_count < n:
		_mm.instance_count = maxi(n, _mm.instance_count * 2)
	_mm.visible_instance_count = n
	var pos: PackedFloat32Array = U.pos
	var prev: PackedFloat32Array = U.prev_pos
	var rot: PackedFloat32Array = U.rot
	var prot: PackedFloat32Array = U.prev_rot
	var types: PackedByteArray = U.type
	var owners: PackedByteArray = U.owner
	var flags: PackedByteArray = U.flags
	var gy: PackedFloat32Array = U.ground_y
	for i in n:
		var x := lerpf(prev[i * 2], pos[i * 2], alpha)
		var z := lerpf(prev[i * 2 + 1], pos[i * 2 + 1], alpha)
		var r: float = _radius[types[i]]
		var dead := (flags[i] & 2) != 0
		var dr := wrapf(rot[i] - prot[i], -PI, PI)
		var yaw := prot[i] + dr * alpha
		var h := r * 2.6 if not dead else r * 0.5
		var basis := Basis(Vector3.UP, yaw).scaled(Vector3(r * 1.5, h, r * 2.0))
		_mm.set_instance_transform(i, Transform3D(basis, Vector3(x, gy[i] + h * 0.5, z)))
		var col: Color = _colors[owners[i]] if owners[i] < _colors.size() else Color.WHITE
		_mm.set_instance_color(i, col.darkened(0.55).lerp(Color(0.5, 0.5, 0.5), 0.5) if dead else col)
