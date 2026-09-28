extends Node3D
## Economy renderer (port of src/economy/EconomyView.js + EconomyRenderer.js):
## animals and carcasses, thrown spears, fish shoals and fishing boats, crops
## on farms (with the harvest front sweeping the rows), stockpiles beside the
## drop-off buildings, oversized loads on walking villagers and the scenes'
## field dressing. Immediate mode: every frame each prop is drawn into one
## MultiMesh per exported "economy/<key>" model (begin / draw / end).
## The sim side is native/src/sim/economy (AovSim.get_economy(),
## get_buildings() farm_rows / stock, get_units() load, get_decor()).
## Also registers the "economy" scene setup (EconomyScene.js, run in C++).

const FARM_ROWS := 11
const SIM_DT := 1.0 / 30.0
const PLAYER_COLORS := [0xbbbbbb, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818]
const KEYS := ["deer", "boar", "spear", "fish", "boat", "wheat0", "wheat1", "wheat2", "fence", "hay", "sheaf", "sack",
	"amphora", "logs", "goldpile", "cart", "crate_grain", "crate_apples", "crate_grapes", "crate_fish", "crate_gold",
	"load_sheaf", "load_ore", "load_log", "load_haunch", "load_basket"]
const STOCK_KEYS := [
	["sheaf", "sack", "crate_grain"],            # grain
	["crate_apples", "crate_grapes", "amphora"], # fruit
	["sack", "amphora", "crate_apples"],         # meat
	["crate_fish", "crate_fish", "amphora"],     # fish
	["logs", "logs", "logs"],                    # wood
	["goldpile", "goldpile", "crate_gold"],      # gold
]  # in STOCK_ORDER: grain, fruit, meat, fish, wood, gold (the get_buildings().stock layout)

var game: Node = null
var _batches := {}   # key -> {mm: MultiMesh, xf: Array, cd: Array}
var _slots := {}     # building id -> stock slots [[x, z, rot]]
var _decor := {}     # {count, keys, xform}
var _names: PackedStringArray
var _white := Color(1, 1, 1, 1)

func _init() -> void:
	# a static function: a lambda would keep this node alive in AovScenes'
	# static registry past its free (use-after-free at engine shutdown)
	AovScenes.set_setup("economy", _economy_setup)

## The "economy" scene (src/economy/EconomyScene.js), ported to C++
## (native/src/sim/scenes); its after() runs from main.gd.
static func _economy_setup(g: Node) -> Dictionary:
	return g.sim.setup_scene("economy")

func setup(g: Node) -> void:
	game = g
	_names = game.sim.building_type_names()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://game/economy/econ_voxel.gdshader")
	for key in KEYS:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = VoxelModels.mesh("economy", key)
		mm.instance_count = 0
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Econ_" + key
		mmi.multimesh = mm
		mmi.material_override = mat
		if key == "wheat0":
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)
		_batches[key] = {"mm": mm, "xf": [], "cd": []}

## src/core/rng.js hash2
static func hash2(x: int, y: int, s: int = 0) -> float:
	var h := (x * 374761393 + y * 668265263 + s * 2147483647) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	h ^= h >> 16
	return float(h) / 4294967296.0

func _begin() -> void:
	for k in _batches:
		_batches[k].xf.clear()
		_batches[k].cd.clear()

## r.draw(key, x, y, z, rotY, {pitch, roll, scale, sx, sy, sz, tint, team})
func _draw(key: String, x: float, y: float, z: float, rot_y: float, o: Dictionary = {}) -> void:
	var b: Dictionary = _batches.get(key, {})
	if b.is_empty():
		return
	var s := float(o.get("scale", 1.0))
	var sc := Vector3(float(o.get("sx", s)), float(o.get("sy", s)), float(o.get("sz", s)))
	var basis := Basis.from_euler(Vector3(float(o.get("pitch", 0.0)), rot_y, float(o.get("roll", 0.0))), EULER_ORDER_YXZ) * Basis.from_scale(sc)
	b.xf.append(Transform3D(basis, Vector3(x, y, z)))
	var team: Color = o.get("team", _white)
	b.cd.append(Color(team.r, team.g, team.b, float(o.get("tint", 1.0))))

func _end() -> void:
	for k in _batches:
		var b: Dictionary = _batches[k]
		var mm: MultiMesh = b.mm
		var n: int = b.xf.size()
		if mm.instance_count < n:
			mm.instance_count = maxi(32, maxi(n, mm.instance_count * 2))
		mm.visible_instance_count = n
		for i in n:
			mm.set_instance_transform(i, b.xf[i])
			mm.set_instance_custom_data(i, b.cd[i])

func frame(_dt: float, alpha: float) -> void:
	var sim: Object = game.sim
	var paused: bool = game.paused
	var time: float = sim.get_time() + (0.0 if paused else alpha * SIM_DT)
	var E: Dictionary = sim.get_economy()
	_begin()
	_draw_animals(E.animals, alpha, time)
	_draw_spears(E.spears, alpha, paused)
	var wy: float = (sim.get_water_level() - 0.3) * 0.5
	_draw_shoals(E.shoals, wy, time)
	_draw_boats(E.boats, wy, alpha, time)
	var B: Dictionary = sim.get_buildings()
	_draw_crops(B)
	_draw_stock(B)
	_draw_loads(alpha)
	_draw_decor()
	_end()

func _draw_animals(A: Dictionary, alpha: float, time: float) -> void:
	var pos: PackedFloat32Array = A.pos
	var prev: PackedFloat32Array = A.prev_pos
	for i in int(A.count):
		var id: int = A.ids[i]
		var x := lerpf(prev[i * 2], pos[i * 2], alpha)
		var z := lerpf(prev[i * 2 + 1], pos[i * 2 + 1], alpha)
		var y: float = game.sim.height_at(x, z)
		var flash: float = A.flash_t[i]
		var tint := 1.0 + (flash * 3.0 if flash > 0 else 0.0)
		var key := "boar" if A.type[i] == 1 else "deer"
		var rot: float = A.rot[i]
		if A.alive[i]:
			var sp: float = A.speed[i]
			var moving: bool = A.moving[i]
			var run: float = absf(sin(time * (4 + sp * 3) + id)) * (0.04 + sp * 0.03) if moving else 0.0
			var pitch: float = sin(time * (4 + sp * 3) * 2 + id) * 0.05 if moving else A.graze[i] * 0.32 * (0.8 + 0.2 * sin(time * 1.3 + id))
			_draw(key, x, y + run, z, rot, {"pitch": pitch, "tint": tint})
		else:
			var k := minf(1.0, A.dead_t[i] / 0.5)
			var f := k * k
			var left := maxf(0.35, A.amount[i] / A.max_amount[i])
			var side := 1.0 if id % 2 else -1.0
			_draw(key, x, y + f * (0.35 if key == "boar" else 0.25), z, rot, {"roll": side * f * PI / 2 * 0.95, "sy": left, "sx": 1.0, "sz": 0.7 + 0.3 * left, "tint": 0.92})

func _draw_spears(S: PackedFloat32Array, alpha: float, paused: bool) -> void:
	for i in range(0, S.size(), 8):
		var x0 := S[i]
		var z0 := S[i + 1]
		var y0 := S[i + 2]
		var x1 := S[i + 3]
		var z1 := S[i + 4]
		var y1 := S[i + 5]
		var t := S[i + 6] + (0.0 if paused else alpha * SIM_DT)
		var dur := S[i + 7]
		var k := minf(1.0, t / dur)
		var d := Vector2(x1 - x0, z1 - z0).length()
		var h := 0.35 + d * 0.08
		var x := x0 + (x1 - x0) * k
		var z := z0 + (z1 - z0) * k
		var y := y0 + (y1 - y0) * k + 4 * h * k * (1 - k)
		if d == 0:
			d = 1
		var dy := (y1 - y0) + 4 * h * (1 - 2 * k)
		var pitch := 0.7 if k >= 1 else -atan2(dy, d)
		_draw("spear", x, y - 0.25 if k >= 1 else y, z, atan2(x1 - x0, z1 - z0), {"pitch": pitch})

func _draw_shoals(S: PackedFloat32Array, wy: float, time: float) -> void:
	for i in range(0, S.size(), 6):
		var id := int(S[i])
		var sx := S[i + 1]
		var sz := S[i + 2]
		var amount := S[i + 3]
		var max_amount := S[i + 4]
		var phase := S[i + 5]
		if amount <= 0:
			continue
		var n := maxi(2, roundi(6 * amount / max_amount))
		for j in n:
			var ang := phase * (0.5 + (j % 3) * 0.12) + (float(j) / n) * PI * 2
			var rad := 0.45 + (j % 3) * 0.3
			_draw("fish", sx + cos(ang) * rad, wy - 0.06 + sin(time * 3 + j) * 0.02, sz + sin(ang) * rad, atan2(-sin(ang), cos(ang)), {"scale": 1.2})
		# one fish leaps out of the water every few seconds
		var cyc := 3.2 + (id % 3) * 0.7
		var lt := fmod(time + id * 1.37, cyc)
		if lt < 0.7:
			var k := lt / 0.7
			var ang := id * 1.9 + floorf((time + id * 1.37) / cyc) * 2.3
			_draw("fish", sx + cos(ang) * (0.3 + k * 0.9), wy + sin(k * PI) * 0.7, sz + sin(ang) * (0.3 + k * 0.9), ang + PI / 2, {"pitch": (k - 0.5) * 2.2, "scale": 1.4})

func _draw_boats(Bo: PackedFloat32Array, wy: float, alpha: float, time: float) -> void:
	for i in range(0, Bo.size(), 10):
		var id := int(Bo[i])
		var owner := int(Bo[i + 1])
		var x := lerpf(Bo[i + 4], Bo[i + 2], alpha)
		var z := lerpf(Bo[i + 5], Bo[i + 3], alpha)
		var rot := Bo[i + 6]
		var state := int(Bo[i + 8])
		var bob := sin(time * 1.6 + id) * 0.05
		var c: int = PLAYER_COLORS[owner] if owner < PLAYER_COLORS.size() else 0xffffff
		var team := Color.hex((c << 8) | 0xff).srgb_to_linear()
		_draw("boat", x, wy - 0.12 + bob, z, rot, {"roll": sin(time * 1.1 + id * 2) * 0.05, "pitch": sin(time * 1.4 + id) * 0.03, "team": team})
		if state == 2:
			# net floats and a few fish splashing beside the hull
			for j in 3:
				var a := rot + PI / 2 + (j - 1) * 0.4
				var k := fmod(time * 1.5 + j * 0.33 + id, 1.0)
				_draw("fish", x + sin(a) * 1.0, wy + sin(k * PI) * 0.35, z + cos(a) * 1.0, a + j, {"pitch": (k - 0.5) * 2, "scale": 1.1})

func _draw_crops(B: Dictionary) -> void:
	var rect: PackedInt32Array = B.rect
	for i in int(B.count):
		if _names[B.type[i]] != "farm" or not B.built[i]:
			continue
		var id: int = B.ids[i]
		var tx := rect[i * 4]
		var tz := rect[i * 4 + 1]
		var w := rect[i * 4 + 2]
		var h := rect[i * 4 + 3]
		var H: float = B.farm_rows[i]
		var segs := w - 1
		var dz := (h - 1.1) / FARM_ROWS
		var y: float = game.sim.height_at(tx + w * 0.5, tz + h * 0.5) + 0.02
		var back := int(floorf(H / FARM_ROWS)) % 2 == 1
		for r in FARM_ROWS:
			var last_cut := -INF if H < r else floorf((H - r) / FARM_ROWS) * FARM_ROWS + r
			# part-cut current row: split at the farmer's position
			var cur := int(floorf(H)) % FARM_ROWS == r and H >= r
			var age := H - last_cut
			var stage := 0 if age < FARM_ROWS * 0.35 else (1 if age < FARM_ROWS * 0.7 else 2)
			var z := tz + 0.55 + (r + 0.5) * dz
			for s in segs:
				var st := stage
				if cur:
					var frac := H - floorf(H)
					var p := 1.0 - (s + 0.5) / segs if back else (s + 0.5) / segs
					st = 0 if p < frac else 2
				var jit := hash2(id * 13 + r, s, 5)
				_draw("wheat%d" % st, tx + 0.5 + s, y, z, 0.0, {"sy": 0.66 + jit * 0.24, "tint": 0.92 + jit * 0.16})

## Deterministic prop slots around a building's back and sides (stockSlots).
func _stock_slots(id: int, tx: int, tz: int, w: int, h: int) -> Array:
	if _slots.has(id):
		return _slots[id]
	var out := []
	var o := 0.55
	var fz := tz + h + 0.6
	out.append([tx + 0.45, fz, (hash2(id, 0, 3) - 0.5) * 0.8])
	out.append([tx + w - 0.45, fz, (hash2(id, 1, 3) - 0.5) * 0.8])
	out.append([tx - 0.35, fz - 0.1, (hash2(id, 2, 3) - 0.5) * 0.8])
	out.append([tx + w + 0.35, fz - 0.1, (hash2(id, 3, 3) - 0.5) * 0.8])
	var front := out.size()
	var x := tx + 0.6
	while x < tx + w - 0.3:
		out.append([x, tz - o, (hash2(id, out.size(), 3) - 0.5) * 0.8])
		x += 1.0
	var z := tz + 0.6
	while z < tz + h - 0.3:
		out.append([tx - o, z, PI / 2 + (hash2(id, out.size(), 3) - 0.5) * 0.8])
		z += 1.0
	z = tz + 0.6
	while z < tz + h - 0.3:
		out.append([tx + w + o, z, PI / 2 + (hash2(id, out.size(), 3) - 0.5) * 0.8])
		z += 1.0
	# interleave so each kind spreads around the building
	var res := out.slice(0, front)
	var rest := out.slice(front)
	for k in rest.size():
		if k % 2 == 0:
			res.append(rest[k])
	for k in rest.size():
		if k % 2 == 1:
			res.append(rest[k])
	_slots[id] = res
	return res

func _draw_stock(B: Dictionary) -> void:
	var rect: PackedInt32Array = B.rect
	var stock: PackedFloat32Array = B.stock
	for i in int(B.count):
		if not B.built[i]:
			continue
		var any := false
		for k in 6:
			if stock[i * 6 + k] >= 5:
				any = true
		if not any:
			continue
		var id: int = B.ids[i]
		var slots := _stock_slots(id, rect[i * 4], rect[i * 4 + 1], rect[i * 4 + 2], rect[i * 4 + 3])
		var si := 0
		for kind in 6:
			var amt := stock[i * 6 + kind]
			if amt < 5:
				continue
			var n := mini(4, ceili(log(1 + amt / 16) / log(2.0)))
			var j := 0
			while j < n and si < slots.size():
				var sx: float = slots[si][0]
				var sz: float = slots[si][1]
				var rot: float = slots[si][2]
				var key: String = STOCK_KEYS[kind][j % 3]
				var gy: float = game.sim.height_at(sx, sz)
				_draw(key, sx, gy, sz, rot, {"scale": 1.25 + hash2(id, si, 7) * 0.2})
				# produce stacks up: a second crate / sack on top of big piles
				if j >= 2 and (key.begins_with("crate") or key == "sack"):
					_draw(key, sx + 0.05, gy + 0.5, sz - 0.04, rot + 0.4, {"scale": 1.1})
				j += 1
				si += 1

## Oversized loads on walking villagers (drawLoads): a log or a sheaf on the
## shoulder, an ore or berry basket on the head, a haunch over the back.
func _draw_loads(alpha: float) -> void:
	var U: Dictionary = game.sim.get_units()
	var types: PackedByteArray = U.type
	var anims: PackedByteArray = U.anim
	var loads: PackedByteArray = U.load
	var amt: PackedFloat32Array = U.carry_amount
	var pos: PackedFloat32Array = U.pos
	var prev: PackedFloat32Array = U.prev_pos
	var rot: PackedFloat32Array = U.rot
	var prot: PackedFloat32Array = U.prev_rot
	var anim_t: PackedFloat32Array = U.anim_t
	var flags: PackedByteArray = U.flags
	var ids: PackedInt32Array = U.ids
	for i in int(U.count):
		if types[i] != 0 or anims[i] != 1 or (flags[i] & 2) != 0 or loads[i] == 255 or amt[i] < 1.5:
			continue
		var x := lerpf(prev[i * 2], pos[i * 2], alpha)
		var z := lerpf(prev[i * 2 + 1], pos[i * 2 + 1], alpha)
		var r := prot[i] + wrapf(rot[i] - prot[i], -PI, PI) * alpha
		# match the rig's walk bob (units/anim.js)
		var t := anim_t[i] + fmod(ids[i] * 0.618034, 1.0) * PI * 2 * 0.3
		var p := t * 10
		var bob := (1 - absf(cos(p))) * 0.08
		var k := minf(1.0, amt[i] / 10.0)
		var y0: float = game.sim.height_at(x, z) + bob
		var cs := cos(r)
		var sn := sin(r)
		var s := 0.75 + 0.35 * k
		var sway := sin(p) * 0.05
		var put := func(key: String, lx: float, ly: float, lz: float, o: Dictionary) -> void:
			_draw(key, x + lx * cs + lz * sn, y0 + ly, z - lx * sn + lz * cs, r + float(o.get("yaw", 0.0)), o)
		match loads[i]:
			0: put.call("load_log", -0.2, 1.42, 0.05, {"pitch": -0.28, "roll": sway, "scale": s})
			1: put.call("load_ore", 0.0, 1.9, 0.0, {"roll": sway, "scale": s * 0.72})
			2: put.call("load_sheaf", -0.22, 1.36, -0.05, {"pitch": -0.5, "roll": -0.3 + sway, "scale": s})
			4: put.call("load_haunch", 0.05, 1.3, -0.2, {"pitch": -0.3, "roll": sway, "scale": s})
			_: put.call("load_basket", 0.0, 1.9, 0.0, {"roll": sway, "scale": s * 0.8})

func _draw_decor() -> void:
	var D: Dictionary = game.sim.get_decor()
	var keys: PackedStringArray = D.keys
	var xf: PackedFloat32Array = D.xform
	for i in int(D.count):
		var x := xf[i * 5]
		var z := xf[i * 5 + 1]
		_draw(keys[i], x, game.sim.height_at(x, z) + xf[i * 5 + 4], z, xf[i * 5 + 2], {"scale": xf[i * 5 + 3]})
