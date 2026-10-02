extends Node3D
## Tower fire (combat piece, Godot-only): what makes a tower's arrows read
## at RTS distance. The arrows themselves (model + streak) are AovUnitView's
## like every projectile; this adds, for the projectiles that leave a tower
## (`get_combat().projectiles` whose start is a tower's centre: Combat::fire
## starts a building's arrow there, at TOWER_ARROW_Y):
##   - the loose: a warm flash at the lantern window (or the sentry
##     platform's rail) on the side of the target, and a puff of pale dust;
##   - a trail (tower_streak.gdshader): an amber ribbon with a hot core along
##     the last 30% of the arc behind the head, and a glint on the head, so
##     the shot reads against grass;
##   - the strike: a flash and a dust puff where the tower's arrow lands
##     (the sim's `unit:damaged` with `other` = the tower).
## All closed form in the sim time (paused captures show the frame as it is).
## Window offsets come from the towers renderer (game/buildings/towers.gd).

const Units := preload("res://game/units/units.gd")
const STRIDE := 20
const LOOSE_T := 0.45       # how long a loose shows (s)
const HIT_T := 0.6
const ARROW_SCALE := [1.45, 1.5, 1.6, 2.1]   # per tower level
const TRAIL_SEG := 6       # trail segments per tower arrow
const TRAIL_K := 0.3       # trail length, as a fraction of the flight

var game: Node = null
var _flash_mm: MultiMesh
var _arrow_mm: MultiMesh
var _ar := PackedFloat32Array()
var _puff_mm: MultiMesh
var _streak_mm: MultiMesh
var _st := PackedFloat32Array()
var _hits: Array = []       # [{x, y, z, t0, seed}]
var _towers := {}           # tower id -> Vector3 centre (ground), refreshed with the walls list
var _tower_sig := -1
var _fl := PackedFloat32Array()
var _pf := PackedFloat32Array()

func setup(g: Node) -> void:
	game = g
	var size := float(game.sim.get_map_size())
	var aabb := AABB(Vector3(-16, -40, -16), Vector3(size + 32, 160, size + 32))
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	_puff_mm = _add(quad, "res://game/combat/tower_puff.gdshader", 1, "TowerPuffs", aabb)
	_streak_mm = _add(quad, "res://game/combat/tower_streak.gdshader", 4, "TowerTrails", aabb)
	_flash_mm = _add(quad, "res://game/combat/tower_flash.gdshader", 5, "TowerFlashes", aabb)
	# the tower's heavier arrow, drawn over the sim's plain one (combat/arrow
	# scaled up: a war arrow from the sentry and watch towers, a bolt from the
	# ballista tower)
	_arrow_mm = Units.make_mm(VoxelModels.mesh("combat", "arrow"), aabb)
	var ami := MultiMeshInstance3D.new()
	ami.name = "TowerArrows"
	ami.multimesh = _arrow_mm
	ami.material_override = VoxelModels.team_material(Color.WHITE, true)
	add_child(ami)

func _add(mesh: Mesh, shader: String, prio: int, name_: String, aabb: AABB) -> MultiMesh:
	var mat := ShaderMaterial.new()
	mat.shader = load(shader)
	mat.render_priority = prio
	var mm := Units.make_mm(mesh, aabb)
	var mmi := MultiMeshInstance3D.new()
	mmi.name = name_
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	return mm

func _towers_view():
	var b = game.pieces.get("buildings")
	if b == null:
		return null
	return b.get("towers")

func _refresh_towers() -> void:
	if not game.sim.has_method("get_walls"):
		return
	var W: Dictionary = game.sim.get_walls()
	var n := int(W.get("count", 0))
	var sig := n
	var ids: PackedInt32Array = W.get("ids", PackedInt32Array())
	for i in n:
		sig = (sig * 31 + ids[i]) & 0x3fffffff
	if sig == _tower_sig:
		return
	_tower_sig = sig
	_towers.clear()
	var kind = W.get("kind")
	var rect: PackedInt32Array = W.get("rect", PackedInt32Array())
	for i in n:
		if kind != null and int(kind[i]) != 3:
			continue
		var x := rect[i * 4] + rect[i * 4 + 2] * 0.5
		var z := rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5
		_towers[ids[i]] = Vector3(x, game.sim.height_at(x, z), z)

## Appends one sprite to the flash (puff = false) or puff buffer.
func _push(puff: bool, p: Vector3, col: Color, size: float, min_px: float, seed: float, age: float) -> void:
	var v := PackedFloat32Array([1.0, 0.0, 0.0, p.x, 0.0, 1.0, 0.0, p.y, 0.0, 0.0, 1.0, p.z,
		col.r, col.g, col.b, col.a, size, min_px, seed, age])
	if puff:
		_pf.append_array(v)
	else:
		_fl.append_array(v)

func frame(_dt: float, _alpha: float) -> void:
	_refresh_towers()
	var now: float = game.sim.get_time()
	# strikes: the sim's hits by a tower
	for e in game.events:
		if e.type == "unit:damaged" and _towers.has(int(e.other)):
			var x := float(e.x)
			var z := float(e.z)
			_hits.append({"p": Vector3(x, game.sim.height_at(x, z) + 0.75, z), "t0": now, "seed": fposmod(x * 7.31 + z * 3.17, 1.0)})
	_fl.clear()
	_pf.clear()
	_ar.clear()
	_st.clear()
	if not _towers.is_empty():
		var tv = _towers_view()
		var C: Dictionary = game.sim.get_combat()
		var P: PackedFloat32Array = C.get("projectiles", PackedFloat32Array())
		for k in P.size() / 16:
			var o := k * 16
			var s := Vector3(P[o + 6], P[o + 7], P[o + 8])
			var tid := _tower_at(s)
			if tid == 0:
				continue
			if tv != null and not tv.shown_visible(tid):
				continue
			var t: float = P[o + 12]
			var seed := fposmod(float(tid) * 0.618 + float(k) * 0.37, 1.0)
			var head := Vector3(P[o], P[o + 1], P[o + 2])
			var to := Vector2(P[o + 9] - s.x, P[o + 11] - s.z)
			var dir := to.normalized() if to.length_squared() > 1e-6 else Vector2(0, 1)
			# a tracer on the arrow: warm glow dots along its arc behind the
			# head (the arc as AovUnitView draws it: lerp + sin(k pi) * arc)
			var dur: float = maxf(P[o + 13], 1e-3)
			var arc: float = P[o + 14]
			var tgt := Vector3(P[o + 9], P[o + 10], P[o + 11])
			var kk := clampf(t / dur, 0.0, 1.0)
			var lvl := 1
			if tv != null:
				lvl = maxi(0, tv.shown_level(tid))
			var vel := (tgt - s) + Vector3(0.0, cos(kk * PI) * PI * arc, 0.0)
			if vel.length_squared() > 1e-6:
				var sc: float = ARROW_SCALE[mini(lvl, ARROW_SCALE.size() - 1)]
				var b := Basis.looking_at(-vel.normalized(), Vector3.UP if absf(vel.normalized().y) < 0.99 else Vector3.RIGHT).scaled(Vector3(sc, sc, sc))
				_ar.append_array(PackedFloat32Array([b.x.x, b.y.x, b.z.x, head.x, b.x.y, b.y.y, b.z.y, head.y, b.x.z, b.y.z, b.z.z, head.z,
					1, 1, 1, 1, 1, 1, 1, 0]))
			# the trail: a ribbon along the arc behind the head (the arc as
			# AovUnitView draws it: lerp + sin(k pi) * arc), widest and
			# hottest at the head, a glint on the head itself
			var wide: float = 0.1 if lvl < 3 else 0.13
			var k0 := maxf(0.0, kk - TRAIL_K)
			var prev := head
			for j in TRAIL_SEG:
				var kj := kk - (kk - k0) * float(j + 1) / float(TRAIL_SEG)
				var pj := s.lerp(tgt, kj) + Vector3(0.0, sin(kj * PI) * arc, 0.0)
				if prev.distance_squared_to(pj) > 1e-6:
					_st.append_array(PackedFloat32Array([1, 0, 0, prev.x, 0, 1, 0, prev.y, 0, 0, 1, prev.z,
						pj.x, pj.y, pj.z, 1.0, 1.0 - float(j + 1) / float(TRAIL_SEG), 1.0 - float(j) / float(TRAIL_SEG), wide, 4.5]))
				prev = pj
			_push(false, head, Color(1.0, 0.7, 0.32, 1.0), 0.14, 9.0, seed, -1.0)
			if t < LOOSE_T:
				var lv := 1
				if tv != null:
					lv = maxi(0, tv.shown_level(tid))
				# where the arrow comes out: the sim's start height, at the
				# lantern window / the platform rail on the target's side
				var reach := 1.05 if lv == 0 else 0.92
				var w := Vector3(s.x + dir.x * reach, s.y, s.z + dir.y * reach)
				var a := t / LOOSE_T
				if t < 0.2:
					var k2 := t / 0.2
					_push(false, w, Color(1.0, 0.55, 0.18, 1.0 - k2 * k2), 0.6 * (0.7 + 0.5 * k2), 30.0, seed, k2)
				var drift := Vector3(dir.x, 0.0, dir.y) * (0.35 + 0.6 * a) + Vector3(0.0, 0.3 * a, 0.0)
				_push(true, w + drift, Color(0.78, 0.74, 0.68, 0.28 * (1.0 - a)), 0.25 + 0.45 * a, 6.0, seed, a)
	# strikes, oldest dropped
	var keep := []
	for h in _hits:
		var age: float = now - float(h.t0)
		if age < 0.0 or age > HIT_T:
			continue
		keep.append(h)
		var a := age / HIT_T
		# (the hit spark itself is AovUnitView's impact burst) a puff of
		# kicked-up earth, a ring of dust spreading at the struck man's feet
		_push(true, h.p + Vector3(0, -0.5 + 0.35 * a, 0), Color(0.6, 0.5, 0.36, 0.6 * (1.0 - a)), 0.3 + 0.55 * a, 7.0, float(h.seed), a)
		if age < 0.12:
			_push(false, h.p, Color(1.0, 0.5, 0.15, 1.0 - age / 0.12), 0.3, 10.0, float(h.seed), age / 0.12)
	_hits = keep
	_upload(_flash_mm, _fl)
	_upload(_puff_mm, _pf)
	_upload(_arrow_mm, _ar)
	_upload(_streak_mm, _st)

func _tower_at(s: Vector3) -> int:
	for id in _towers:
		var c: Vector3 = _towers[id]
		if absf(c.x - s.x) < 0.01 and absf(c.z - s.z) < 0.01:
			return id
	return 0

## Uploads n sprites, the buffer padded to a power-of-two capacity.
static func _upload(mm: MultiMesh, buf: PackedFloat32Array) -> void:
	var n := buf.size() / STRIDE
	if n == 0:
		if mm.instance_count > 0:
			mm.visible_instance_count = 0
		return
	var cap := 16
	while cap < n:
		cap *= 2
	buf.resize(cap * STRIDE)
	if mm.instance_count != cap:
		mm.instance_count = cap
	mm.buffer = buf
	mm.visible_instance_count = n
