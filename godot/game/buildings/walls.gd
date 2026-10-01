extends Node3D
## Greek stone walls and gates (buildings piece, Godot-only; Age of
## Mythology: Retold's Greek stone wall, reference/walls/walls_01, walls_02,
## gate_01..04, combat_01, place_01). Models: the "walls" group
## (scripts/export-walls.mjs: 1/8-tile voxels, pivot at the tile centre,
## walls along +x).
##
## Walls are laid out per tile from an occupancy grid, so pieces join cleanly
## whatever the sim's wall entities are (one building per tile or a 1 x n
## segment): every tile of a wall, pillar or gate rect is a wall tile; it
## links to its four neighbours of the same owner (to a gate only along the
## gate's axis) and to a diagonal one when no orthogonal tile joins the two.
## A straight tile is one `seg/<v>` piece (3 stone variants by tile hash),
## turned so its one parapet (merlons, model +z) faces away from the owner's
## nearest Town Center. Pillar tiles: the sim's `wall_pillar` pieces, every
## end, corner, junction and lone tile (so each run ends flush inside a
## pillar), and for static walls with `auto` one at least every 5 tiles of a
## straight run. Only a corner next to a pillar (a 1-tile jog, a staircase)
## or a diagonal join gets an `arm` / `arm_m` (parapet outside) per link
## from its centre (a diagonal arm is the same model turned 45 degrees and
## stretched by sqrt 2) round a `core`. A pillar tile is a `pillar` (`pillar_flag`, with its pennants,
## at a line end; `pillar_gate`, the taller gate tower with a flag, beside a
## gate). A gate (`gate<L>`, L = tiles along its axis, 1..5) is the paved
## threshold between two gate towers; its two door leaves are MeshInstances
## that swing (0.7 s) inward, towards the owner's nearest Town Center: open
## as far as the sim's `get_buildings().fort_open` (0..1, also read as
## `gate_open` / `open`) when it exports it, else while a unit of the owner
## or an ally is within 2 tiles of the opening (checked 5 times a second).
##
## States per piece: under construction `/s<k>` (k = floor(progress * 4): 0
## the staked-out foundation with team pennants, 1..3 the courses rising in
## timber scaffolding; door leaves appear when the gate is finished), built,
## damaged `/d1` below 2/3 hp (merlons knocked off, cracks, chips; split
## planks on the leaves) and `/d2` below 1/3 (the top broken off in a jagged
## line, open cracks, rubble at the foot; the leaves half gone). Drawn as one
## MultiMesh per model (team colour per instance, AO baked by
## building_ao.gd), rebuilt only when the set of pieces, a state or what is
## explored changes.
##
## Sources (both may be used at once):
##   - sim buildings whose type name contains "wall" ("wall_pillar": a
##     pillar) or "gate": buildings.gd calls `walls.from_buildings(B, names)`;
##   - `set_static(entries)`: render-only walls (the walls scene while the sim
##     has no wall type): [{kind: "wall"|"pillar"|"gate", owner, tx, tz, w, h,
##     built, progress, hp, max_hp, open: -1 (auto) | 0..1, auto: pillars
##     chosen here}].

const BuildingAO = preload("res://game/buildings/building_ao.gd")
const GROUP := "walls"
const DOOR_TIME := 0.7
const RUN_GAP := 5          # at most this many straight tiles between two pillars (auto)
const SQRT2 := 1.41421356
const LOCAL_PLAYER := 1
const ORTH := [[1, 0], [0, 1], [-1, 0], [0, -1]]
const DIAG := [[1, 1], [-1, 1], [-1, -1], [1, -1]]

var game: Node = null
var _team_lin := {}         # owner -> linear Color (instance custom)
var _team_srgb := {}        # owner -> sRGB Color (leaf materials)
var _leaf_mats := {}
var _batches := {}          # model key -> {mmi, mm}
var _gates := {}            # gate uid -> {node, left, right, open, target, e, half, leaf}
var _static: Array = []
var _sim_entries: Array = []
var _sim_sig := -1
var _sim_open := {}         # sim gate id -> open 0..1
var _sig := -1
var _vis_sig := -1
var _fog_version := -1
var _door_check := 0.0
var _gate_info := {}        # L -> {opening} (voxels)
var _voxel := 0.125
var _ok := false

func setup(g: Node, team_colors: Array) -> void:
	game = g
	for o in team_colors.size():
		var c := Color.hex((int(team_colors[o]) << 8) | 0xff)
		_team_srgb[o] = c
		var l := c.srgb_to_linear()
		l.a = 0.0
		_team_lin[o] = l
	var man: Dictionary = VoxelModels.group(GROUP).get("man", {})
	_ok = not man.is_empty()
	if _ok:
		_voxel = float(man.get("voxel", 0.125))
		for k in man.get("gates", {}):
			_gate_info[int(k)] = man.gates[k]

## True when a building type name is drawn by this renderer.
static func handles(type_name: String) -> bool:
	return type_name.contains("wall") or type_name.contains("gate")

static func kind_of(type_name: String) -> String:
	if type_name.contains("gate"):
		return "gate"
	return "pillar" if type_name.contains("pillar") else "wall"

func set_static(entries: Array) -> void:
	_static = entries.duplicate(true)
	_sig = -1

## The wall / pillar / gate rows of AovSim.get_buildings() (once a frame).
func from_buildings(B: Dictionary, names: PackedStringArray) -> void:
	var types: PackedByteArray = B.type
	var rect: PackedInt32Array = B.rect
	var ids: PackedInt32Array = B.ids
	var built: PackedByteArray = B.built
	var progress: PackedFloat32Array = B.progress
	var hp: PackedFloat32Array = B.hp
	var max_hp: PackedFloat32Array = B.max_hp
	var open_arr = B.get("fort_open", B.get("gate_open", B.get("open", null)))
	var rows := PackedInt32Array()
	var sig := 0
	for i in int(B.count):
		if not handles(names[types[i]]):
			continue
		rows.append(i)
		var st := 0
		if not built[i]:
			st = 10 + clampi(floori(progress[i] * 4.0), 0, 3)
		elif max_hp[i] > 0.0:
			var f := hp[i] / max_hp[i]
			st = 2 if f < 1.0 / 3.0 else (1 if f < 2.0 / 3.0 else 0)
		sig = (sig * 31 + ids[i] * 7 + types[i] * 3 + st * 131) & 0x3fffffff
		if open_arr != null and i < open_arr.size():
			_sim_open[ids[i]] = float(open_arr[i])
	sig = (sig * 31 + rows.size()) & 0x3fffffff
	if sig == _sim_sig:
		return
	_sim_sig = sig
	var out := []
	for i in rows:
		out.append({"id": ids[i], "kind": kind_of(names[types[i]]), "owner": int(B.owner[i]),
			"tx": rect[i * 4], "tz": rect[i * 4 + 1], "w": rect[i * 4 + 2], "h": rect[i * 4 + 3],
			"built": built[i] != 0, "progress": float(progress[i]), "hp": float(hp[i]), "max_hp": float(max_hp[i]),
			"open": -1.0, "auto": false})
	_sim_entries = out

func frame(dt: float) -> void:
	if not _ok:
		return
	var entries: Array = _static + _sim_entries
	var sig := (entries.size() * 7919 + _sim_sig) & 0x3fffffff
	for e in _static:
		sig = (sig * 31 + int(e.tx) * 7 + int(e.tz) * 131 + int(e.w) * 3 + int(e.h) * 5 + int(e.owner) * 17 + _state_code(e) * 1009) & 0x3fffffff
	var fv: int = game.sim.fog_version()
	var vis_changed := false
	if fv != _fog_version or sig != _sig:
		_fog_version = fv
		var vs := 0
		for e in entries:
			vs = (vs * 3 + (1 if _visible(e) else 0)) & 0x3fffffff
		if vs != _vis_sig:
			_vis_sig = vs
			vis_changed = true
	if sig != _sig or vis_changed:
		_sig = sig
		var t0 := Time.get_ticks_usec()
		_rebuild(entries)
		if OS.get_environment("AOV_WALLS_DEBUG") != "":
			print("walls: rebuilt %d pieces in %.2f ms" % [entries.size(), (Time.get_ticks_usec() - t0) / 1000.0])
	_doors(dt)

## 0 built, 1 / 2 damaged, 10 + stage under construction
static func _state_code(e: Dictionary) -> int:
	if not e.get("built", true):
		return 10 + clampi(floori(float(e.get("progress", 0.0)) * 4.0), 0, 3)
	var mx := float(e.get("max_hp", 0.0))
	if mx <= 0.0:
		return 0
	var f := float(e.get("hp", mx)) / mx
	return 2 if f < 1.0 / 3.0 else (1 if f < 2.0 / 3.0 else 0)

static func _suffix(code: int) -> String:
	if code >= 10:
		return "/s%d" % (code - 10)
	return "" if code == 0 else "/d%d" % code

func _visible(e: Dictionary) -> bool:
	if int(e.owner) == LOCAL_PLAYER:
		return true
	return game.sim.is_explored(float(e.tx) + float(e.w) * 0.5, float(e.tz) + float(e.h) * 0.5)

static func _tk(tx: int, tz: int) -> int:
	return (tz + 4096) * 16384 + tx + 4096

static func _h(x: int, z: int, s: int) -> int:
	var h := (x * 374761393 + z * 668265263 + s * 2147483647) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	return h ^ (h >> 16)

## Gate axis: along x when the rect is wider than deep; a square rect takes
## the axis its wall neighbours run on.
static func _gate_axis_x(e: Dictionary, occ: Dictionary) -> bool:
	if int(e.w) != int(e.h):
		return int(e.w) > int(e.h)
	var tx: int = e.tx
	var tz: int = e.tz
	var nx := int(occ.has(_tk(tx - 1, tz))) + int(occ.has(_tk(tx + int(e.w), tz)))
	var nz := int(occ.has(_tk(tx, tz - 1))) + int(occ.has(_tk(tx, tz + int(e.h))))
	return nx >= nz

static func _yaw_of(dx: float, dz: float) -> float:
	return atan2(-dz, dx)   # Basis(UP, yaw) turns +x onto (dx, dz)

func _rebuild(entries: Array) -> void:
	var occ := {}     # tile -> {owner, gate: entry or null, e}
	for e in entries:
		if not _visible(e):
			continue
		for dz in int(e.h):
			for dx in int(e.w):
				occ[_tk(int(e.tx) + dx, int(e.tz) + dz)] = {"owner": int(e.owner), "gate": e if e.kind == "gate" else null, "e": e}
	var gate_axis := {}
	for e in entries:
		if e.kind == "gate":
			gate_axis[e] = _gate_axis_x(e, occ)
	var items := {}   # key -> Array of [Transform3D, owner]
	var sim = game.sim
	# links per wall / pillar tile
	var links := {}
	for k in occ:
		var t: Dictionary = occ[k]
		if t.gate != null:
			continue
		var tz: int = int(k / 16384) - 4096
		var tx: int = k % 16384 - 4096
		var o := [false, false, false, false]
		var gt := [false, false, false, false]
		for i in 4:
			var n = occ.get(_tk(tx + ORTH[i][0], tz + ORTH[i][1]))
			if n == null or n.owner != t.owner:
				continue
			if n.gate != null:
				if (ORTH[i][1] == 0) == bool(gate_axis[n.gate]):
					o[i] = true
					gt[i] = true
			else:
				o[i] = true
		var d := [false, false, false, false]
		for i in 4:
			var ddx: int = DIAG[i][0]
			var ddz: int = DIAG[i][1]
			var n = occ.get(_tk(tx + ddx, tz + ddz))
			if n == null or n.owner != t.owner or n.gate != null:
				continue
			if occ.has(_tk(tx + ddx, tz)) or occ.has(_tk(tx, tz + ddz)):
				continue
			d[i] = true
		var no := int(o[0]) + int(o[1]) + int(o[2]) + int(o[3])
		var nd := int(d[0]) + int(d[1]) + int(d[2]) + int(d[3])
		var ng := int(gt[0]) + int(gt[1]) + int(gt[2]) + int(gt[3])
		var straight: bool = nd == 0 and no == 2 and ((o[0] and o[2]) or (o[1] and o[3]))
		var diag_run: bool = no == 0 and nd == 2 and ((d[0] and d[2]) or (d[1] and d[3]))
		var e: Dictionary = t.e
		var is_p: bool = e.kind == "pillar" or ng > 0
		if bool(e.get("auto", false)) and not straight and not diag_run:
			is_p = true
		links[k] = {"o": o, "d": d, "gate": ng > 0, "links": no + nd, "tx": tx, "tz": tz, "e": e,
			"straight": straight, "pillar": is_p}
	# auto walls: a pillar at least every RUN_GAP tiles of a straight run
	var run_pillars := []
	for k in links:
		var L: Dictionary = links[k]
		if not L.straight or L.pillar or not bool(L.e.get("auto", false)):
			continue
		var ax: bool = L.o[0]
		var bx: int = -1 if ax else 0
		var bz: int = 0 if ax else -1
		var back = links.get(_tk(L.tx + bx, L.tz + bz))
		if back != null and back.straight and not back.pillar and bool(back.o[0]) == ax:
			continue   # not the start of the run
		var run := []
		var cx: int = L.tx
		var cz: int = L.tz
		while true:
			var c = links.get(_tk(cx, cz))
			if c == null or not c.straight or c.pillar or bool(c.o[0]) != ax:
				break
			run.append(c)
			cx -= bx
			cz -= bz
		var n := run.size()
		var parts := int(ceil(float(n + 1) / float(RUN_GAP + 1)))
		for j in range(1, parts):
			var idx := int(round(float(j) * float(n + 1) / float(parts))) - 1
			if idx >= 0 and idx < n:
				run_pillars.append(run[idx])
	for L in run_pillars:
		L.pillar = true
	# every end, corner and junction is capped by a pillar (the curtain ends
	# flush inside it), but for a tile right next to one (a 1-tile jog or a
	# staircase): that joins on arms, so a stepped line is not a row of pillars
	for k in links:
		var L: Dictionary = links[k]
		if L.pillar or L.straight or int(L.links) == 0:
			continue
		if L.d[0] or L.d[1] or L.d[2] or L.d[3]:
			continue
		var near := false
		for i in 4:
			if L.o[i]:
				var n = links.get(_tk(L.tx + ORTH[i][0], L.tz + ORTH[i][1]))
				if n != null and n.pillar:
					near = true
		if not near:
			L.pillar = true
	var towns := _towns()
	# pieces
	for k in links:
		var L: Dictionary = links[k]
		var e: Dictionary = L.e
		var sfx := _suffix(_state_code(e))
		var owner: int = int(e.owner)
		var x: float = L.tx + 0.5
		var z: float = L.tz + 0.5
		var pos := Vector3(x, sim.height_at(x, z), z)
		var out := _outward(towns, owner, Vector2(x, z))
		if L.pillar:
			var key := "pillar" + sfx
			if L.gate:
				key = "pillar_gate" + sfx
			elif sfx == "" and int(L.links) <= 1:
				key = "pillar_flag"
			# a pillar faces the way its wall runs (the flag pole at the back);
			# a gate tower turns its flag away from the gate
			var yaw := 0.0
			for i in 4:
				if L.o[i]:
					yaw = _yaw_of(ORTH[i][0], ORTH[i][1])
					break
			_add(items, key, Transform3D(Basis(Vector3.UP, yaw), pos), owner)
			for i in 4:
				if L.d[i]:
					var xp := _diag_xf(i, pos)
					_add(items, _arm_key(xp, out) + sfx, xp, owner)
			continue
		if L.straight:
			var v := _h(L.tx, L.tz, 41) % 3
			var key2 := ("seg/0" + sfx) if sfx.begins_with("/s") else ("seg/%d%s" % [v, sfx])
			# the parapet (+z in the model) on the side away from the town
			var yaw2 := (0.0 if out.y >= 0.0 else PI) if L.o[0] else (PI * 0.5 if out.x >= 0.0 else -PI * 0.5)
			_add(items, key2, Transform3D(Basis(Vector3.UP, yaw2), pos), owner)
			continue
		for i in 4:
			if L.o[i]:
				var xf := Transform3D(Basis(Vector3.UP, _yaw_of(ORTH[i][0], ORTH[i][1])), pos)
				_add(items, _arm_key(xf, out) + sfx, xf, owner)
			if L.d[i]:
				var xd := _diag_xf(i, pos)
				_add(items, _arm_key(xd, out) + sfx, xd, owner)
		_add(items, "core" + sfx, Transform3D(Basis(), pos), owner)
	# gates
	var seen_gates := {}
	for e in entries:
		if e.kind != "gate" or not _visible(e):
			continue
		var axx: bool = gate_axis.get(e, true)
		var Lg := clampi(maxi(int(e.w), int(e.h)), 1, 5)
		var cx := float(e.tx) + float(e.w) * 0.5
		var cz := float(e.tz) + float(e.h) * 0.5
		var y := INF
		for dz in int(e.h):
			for dx in int(e.w):
				y = minf(y, sim.height_at(float(e.tx) + dx + 0.5, float(e.tz) + dz + 0.5))
		var yaw := 0.0 if axx else PI * 0.5
		var inward := _inward(e, Vector2(cx, cz))
		if Vector2(sin(yaw), cos(yaw)).dot(inward) < 0.0:
			yaw += PI
		var xf := Transform3D(Basis(Vector3.UP, yaw), Vector3(cx, y, cz))
		var code := _state_code(e)
		_add(items, "gate%d%s" % [Lg, _suffix(code)], xf, int(e.owner))
		var uid := _gate_uid(e)
		seen_gates[uid] = true
		_gate_node(uid, e, Lg, xf, code)
	for uid in _gates.keys():
		if not seen_gates.has(uid):
			_gates[uid].node.queue_free()
			_gates.erase(uid)
	if OS.get_environment("AOV_WALLS_DEBUG") != "":
		for key in items:
			print("walls: ", key, " x", items[key].size(), " ", items[key].map(func(it): return Vector2i(int(it[0].origin.x), int(it[0].origin.z))) if items[key].size() < 40 else "")
		_dump(links, occ)
	# multimeshes
	for key in _batches.keys():
		if not items.has(key):
			_batches[key].mmi.queue_free()
			_batches.erase(key)
	for key in items:
		var list: Array = items[key]
		var b: Dictionary = _batches.get(key, {})
		if b.is_empty():
			if VoxelModels.info(GROUP, key).is_empty():
				continue
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = BuildingAO.mesh(GROUP, key)
			var mmi := MultiMeshInstance3D.new()
			mmi.name = "W_" + key.replace("/", "_")
			mmi.multimesh = mm
			mmi.material_override = BuildingAO.material(Color.WHITE, true)
			add_child(mmi)
			b = {"mmi": mmi, "mm": mm}
			_batches[key] = b
		var mm2: MultiMesh = b.mm
		mm2.instance_count = list.size()
		for i in list.size():
			mm2.set_instance_transform(i, list[i][0])
			mm2.set_instance_custom_data(i, _team_lin.get(list[i][1], Color(1, 1, 1, 0)))

## AOV_WALLS_DEBUG: the tiles as a map (P pillar, - | straight, + other, G gate).
static func _dump(links: Dictionary, occ: Dictionary) -> void:
	var x0 := 1 << 20
	var z0 := 1 << 20
	var x1 := -(1 << 20)
	var z1 := -(1 << 20)
	for k in occ:
		var tz: int = int(k / 16384) - 4096
		var tx: int = k % 16384 - 4096
		x0 = mini(x0, tx); x1 = maxi(x1, tx); z0 = mini(z0, tz); z1 = maxi(z1, tz)
	if x1 < x0:
		return
	print("walls: map x %d..%d z %d..%d" % [x0, x1, z0, z1])
	for z in range(z0, z1 + 1):
		var s := ""
		for x in range(x0, x1 + 1):
			var k := _tk(x, z)
			var L = links.get(k)
			if L == null:
				s += "G" if occ.has(k) else "."
			elif L.pillar:
				s += "P"
			elif L.straight:
				s += "-" if L.o[0] else "|"
			else:
				s += "+"
		print("walls: %4d %s" % [z, s])

static func _add(items: Dictionary, key: String, xf: Transform3D, owner: int) -> void:
	if not items.has(key):
		items[key] = []
	items[key].append([xf, owner])

static func _diag_xf(i: int, pos: Vector3) -> Transform3D:
	var b := Basis(Vector3.UP, _yaw_of(DIAG[i][0], DIAG[i][1])) * Basis.from_scale(Vector3(SQRT2, 1.0, 1.0))
	return Transform3D(b, pos)

## An arm's parapet (model +z) goes on the outer side: `arm`, or `arm_m`
## (parapet on -z) when the turned arm's +z faces the town.
static func _arm_key(xf: Transform3D, out: Vector2) -> String:
	var zl := xf.basis.z
	return "arm" if zl.x * out.x + zl.z * out.y >= 0.0 else "arm_m"

## Town Centres per owner (the inside of a wall is towards the nearest one).
func _towns() -> Dictionary:
	var res := {}
	var B: Dictionary = game.sim.get_buildings()
	var names: PackedStringArray = B.type_names
	var rect: PackedInt32Array = B.rect
	for i in int(B.count):
		if names[B.type[i]] != "town_center":
			continue
		var o := int(B.owner[i])
		if not res.has(o):
			res[o] = []
		res[o].append(Vector2(rect[i * 4] + rect[i * 4 + 2] * 0.5, rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5))
	return res

## Away from the owner's nearest Town Centre (+z when he has none).
static func _outward(towns: Dictionary, owner: int, p: Vector2) -> Vector2:
	var best := INF
	var o := Vector2(0.0, 1.0)
	for c in towns.get(owner, []):
		var d: float = p.distance_squared_to(c)
		if d < best and d > 0.0:
			best = d
			o = p - c
	return o

static func _gate_uid(e: Dictionary) -> String:
	return "%d_%d_%d" % [int(e.owner), int(e.tx), int(e.tz)]

## Leaves swing towards the inside: the owner's nearest Town Center.
func _inward(e: Dictionary, c: Vector2) -> Vector2:
	var B: Dictionary = game.sim.get_buildings()
	var names: PackedStringArray = B.type_names
	var best := INF
	var to := Vector2.ZERO
	var rect: PackedInt32Array = B.rect
	for i in int(B.count):
		if int(B.owner[i]) != int(e.owner) or names[B.type[i]] != "town_center":
			continue
		var p := Vector2(rect[i * 4] + rect[i * 4 + 2] * 0.5, rect[i * 4 + 1] + rect[i * 4 + 3] * 0.5)
		if p.distance_to(c) < best:
			best = p.distance_to(c)
			to = p - c
	return to

func _leaf_mat(owner: int) -> ShaderMaterial:
	if not _leaf_mats.has(owner):
		_leaf_mats[owner] = BuildingAO.material(_team_srgb.get(owner, Color.WHITE))
	return _leaf_mats[owner]

func _gate_node(uid: String, e: Dictionary, Lg: int, xf: Transform3D, code: int) -> void:
	var g: Dictionary = _gates.get(uid, {})
	if g.is_empty():
		var node := Node3D.new()
		node.name = "Gate_" + uid
		add_child(node)
		var left := MeshInstance3D.new()
		left.material_override = _leaf_mat(int(e.owner))
		node.add_child(left)
		var right := MeshInstance3D.new()
		right.material_override = _leaf_mat(int(e.owner))
		node.add_child(right)
		g = {"node": node, "left": left, "right": right, "open": -1.0, "target": 0.0, "leaf": ""}
		_gates[uid] = g
	var leaf := "gate%d/leaf%s" % [Lg, _suffix(code) if code < 10 else ""]
	if leaf != g.leaf and not VoxelModels.info(GROUP, leaf).is_empty():
		g.leaf = leaf
		var mesh := BuildingAO.mesh(GROUP, leaf)
		g.left.mesh = mesh
		g.right.mesh = mesh
	var info: Dictionary = _gate_info.get(Lg, {"opening": Lg * 8 - 6})
	var half := float(info.opening) * 0.5 * _voxel
	g["e"] = e
	g["half"] = half
	g.node.transform = xf
	g.left.position = Vector3(-half, 0.0, 0.0)
	g.right.position = Vector3(half, 0.0, 0.0)
	g.node.visible = code < 10
	if g.open < 0.0:
		g.target = _door_target(e, xf.origin, half)
		g.open = g.target
	_pose(g)

func _pose(g: Dictionary) -> void:
	var a: float = smoothstep(0.0, 1.0, float(g.open)) * PI * 0.5
	g.left.rotation = Vector3(0.0, -a, 0.0)
	g.right.rotation = Vector3(0.0, PI + a, 0.0)

func _door_target(e: Dictionary, c: Vector3, half: float) -> float:
	if e.has("id") and _sim_open.has(e.id):
		return clampf(float(_sim_open[e.id]), 0.0, 1.0)
	if float(e.get("open", -1.0)) >= 0.0:
		return clampf(float(e.open), 0.0, 1.0)
	if not e.get("built", true):
		return 0.0
	var sim = game.sim
	var r := half + 2.0
	for pid in sim.get_player_ids():
		if pid != int(e.owner) and not sim.is_ally(pid, int(e.owner)):
			continue
		if sim.units_near(c.x, c.z, r, pid).size() > 0:
			return 1.0
	return 0.0

func _doors(dt: float) -> void:
	if _gates.is_empty():
		return
	_door_check -= dt
	var check := _door_check <= 0.0
	if check:
		_door_check = 0.2
	for uid in _gates:
		var g: Dictionary = _gates[uid]
		if check or g.e.has("id"):
			g.target = _door_target(g.e, g.node.position, float(g.half))
		var o: float = g.open
		if o != g.target:
			o = move_toward(o, g.target, dt / DOOR_TIME)
			g.open = o
			_pose(g)

## Scene "walls" (Godot-only, game/core/scenes.gd): the planned Greek town of
## the `town` scene ringed by a stone wall with pillars at the corners and
## along the runs, a closed gate on the south side and an open one on the
## east side with villagers in it, a stretch being built (foundation stakes
## and scaffolding, every stage) west of the closed gate and two damaged
## stretches on the east side; the camera looks along the south wall at the
## south-east corner from outside, like reference/walls/walls_02. These are
## this renderer's static walls (render-only: they do not block), the same
## pieces the sim's wall / wall_pillar / gate buildings are drawn with.
static func scene_setup(game: Node) -> Dictionary:
	var sim = game.sim
	var ctx: Dictionary = sim.setup_scene("town", game.scene_opts())
	var B: Dictionary = sim.get_buildings()
	var rect: PackedInt32Array = B.rect
	var x0 := 1 << 20
	var z0 := 1 << 20
	var x1 := -(1 << 20)
	var z1 := -(1 << 20)
	for i in int(B.count):
		if int(B.owner[i]) != 1:
			continue
		x0 = mini(x0, rect[i * 4])
		z0 = mini(z0, rect[i * 4 + 1])
		x1 = maxi(x1, rect[i * 4] + rect[i * 4 + 2] - 1)
		z1 = maxi(z1, rect[i * 4 + 1] + rect[i * 4 + 3] - 1)
	var size: int = sim.get_map_size()
	var m := int(game.args.get("walls_margin", 3))
	x0 = maxi(2, x0 - m)
	z0 = maxi(2, z0 - m)
	x1 = mini(size - 3, x1 + m)
	z1 = mini(size - 3, z1 + m)
	var gate_s := [x1 - 12, z1, 4, 1]   # closed: nobody near it
	var gate_e := [x1, z1 - 8, 1, 4]    # open: villagers walking through
	var entries := []
	var tiles := []
	for x in range(x0, x1 + 1):
		tiles.append([x, z0])
		tiles.append([x, z1])
	for z in range(z0 + 1, z1):
		tiles.append([x0, z])
		tiles.append([x1, z])
	# fell the trees on the ring and in a band round it (outside wider: the
	# camera looks in from there), so the wall stands clear like a built one
	var band := int(game.args.get("walls_clear", 8))
	sim.clear_rect(x0 - band, z0 - band, x1 - x0 + 1 + 2 * band, band + 7)
	sim.clear_rect(x0 - band, z1 - 6, x1 - x0 + 1 + 2 * band, band + 7)
	sim.clear_rect(x0 - band, z0, band + 7, z1 - z0 + 1)
	sim.clear_rect(x1 - 6, z0, band + 7, z1 - z0 + 1)
	for t in tiles:
		var tx: int = t[0]
		var tz: int = t[1]
		var skip := false
		for g in [gate_s, gate_e]:
			if tx >= g[0] and tx < g[0] + g[2] and tz >= g[1] and tz < g[1] + g[3]:
				skip = true
		if skip:
			continue
		var e := {"kind": "wall", "owner": 1, "tx": tx, "tz": tz, "w": 1, "h": 1, "built": true, "progress": 1.0,
			"hp": 1000.0, "max_hp": 1000.0, "open": -1.0, "auto": true}
		# construction west of the closed gate: stages 3, 2, 1, 0 going west
		var west: int = gate_s[0] - 2 - tx
		if tz == z1 and west >= 0 and west < 8:
			e.built = false
			e.progress = (3 - west / 2) / 4.0 + 0.01
		# battle damage on the east wall north of the open gate
		if tx == x1 and tz < gate_e[1] - 1 and tz >= gate_e[1] - 4:
			e.hp = 500.0
		if tx == x1 and tz < gate_e[1] - 4 and tz >= gate_e[1] - 7:
			e.hp = 250.0
		entries.append(e)
	for g in [gate_s, gate_e]:
		sim.clear_rect(g[0], g[1], g[2], g[3])
		entries.append({"kind": "gate", "owner": 1, "tx": g[0], "tz": g[1], "w": g[2], "h": g[3], "built": true,
			"progress": 1.0, "hp": 1000.0, "max_hp": 1000.0, "open": 1.0 if g == gate_e else 0.0, "auto": true})
	var how := "static"
	if sim.has_method("place_wall") and not AovArgs.flag(game.args, "walls_static", false) \
			and _sim_ring(sim, x0, z0, x1, z1, gate_s, gate_e):
		how = "sim"
	else:
		game.pieces.buildings.walls.set_static(entries)
		# villagers in the open gate, builders at the scaffolding
		var gx: float = gate_e[0] + 0.5
		var gz: float = gate_e[1] + 2.0
		for k in 3:
			sim.spawn_unit("villager", 1, gx + 0.8 - k * 0.9, gz - 0.5 + k * 0.5, PI * 0.5)
		for k in 2:
			sim.spawn_unit("villager", 1, gate_s[0] - 4.5 - k * 3.0, z1 + 1.1, PI)
	ctx["focus"] = Vector2(x1 - 6.0, z1 - 5.0)
	ctx["walls_ring"] = [x0, z0, x1, z1]
	print("walls: ring %d,%d .. %d,%d (%s walls)" % [x0, z0, x1, z1, how])
	return ctx

## The same ring as the sim's own walls (sim/fortify): place_wall lines built
## by villagers (stepped here before the first frame), two segments turned
## into gates, a last stretch placed but only begun (foundations and
## scaffolding), damage dealt to the east side. False (nothing kept) if the
## sim refuses the ring.
static func _sim_ring(sim, x0: int, z0: int, x1: int, z1: int, gate_s: Array, gate_e: Array) -> bool:
	const FPS := 30
	sim.set_player_resources(1, {"food": 50000, "wood": 50000, "gold": 50000, "favor": 0})
	var ctr := Vector2((x0 + x1) * 0.5 + 0.5, (z0 + z1) * 0.5 + 0.5)
	var vills := []
	for side in 4:
		for k in 10:
			var t := (k + 0.5) / 10.0
			var p: Vector2
			match side:
				0: p = Vector2(lerpf(x0 + 2, x1 - 2, t), z0 + 2.5)
				1: p = Vector2(x1 - 1.5, lerpf(z0 + 2, z1 - 2, t))
				2: p = Vector2(lerpf(x0 + 2, x1 - 2, t), z1 - 1.5)
				_: p = Vector2(x0 + 2.5, lerpf(z0 + 2, z1 - 2, t))
			var id: int = sim.spawn_unit("villager", 1, p.x, p.y, 0.0)
			if id > 0:
				vills.append(id)
	var w := func(tx: int, tz: int) -> Vector2: return Vector2(tx + 0.5, tz + 0.5)
	var xs: int = gate_s[0] - 3   # the south side west of here is the stretch being built
	var lines := [[w.call(x0, z0), w.call(x1, z0)], [w.call(x1, z0), w.call(x1, z1)],
		[w.call(x1, z1), w.call(xs, z1)], [w.call(x0, z0), w.call(x0, z1)]]
	for ln in lines:
		var r: Dictionary = sim.place_wall(1, ln[0], ln[1], PackedInt32Array(vills))
		if not bool(r.get("ok", false)):
			push_warning("walls scene: place_wall refused: %s" % r.get("reason", ""))
	sim.tick(1)
	if _unbuilt(sim, 1).is_empty():
		return false
	_build_all(sim, vills, 240.0 * FPS)
	# gates: the segment nearest each gate spot
	var W: Dictionary = sim.get_walls()
	var best_s := [0, 1e9]
	var best_e := [0, 1e9]
	for i in int(W.count):
		if int(W.kind[i]) != 1 or int(W.built[i]) == 0:
			continue
		var r := [int(W.rect[i * 4]), int(W.rect[i * 4 + 1]), int(W.rect[i * 4 + 2]), int(W.rect[i * 4 + 3])]
		var c := Vector2(r[0] + r[2] * 0.5, r[1] + r[3] * 0.5)
		if r[1] == z1 and r[3] == 1 and r[2] >= 3:
			var d := absf(c.x - (gate_s[0] + 2.0))
			if d < best_s[1]:
				best_s = [int(W.ids[i]), d]
		if r[0] == x1 and r[2] == 1 and r[3] >= 3:
			var d2 := absf(c.y - (gate_e[1] + 2.0))
			if d2 < best_e[1]:
				best_e = [int(W.ids[i]), d2]
	var gate_ids := []
	for g in [best_s[0], best_e[0]]:
		if g > 0 and bool(sim.convert_to_gate(g).get("ok", false)):
			gate_ids.append(g)
	# the builders go home, but for a few: three stand inside the open gate,
	# three begin the last stretch (foundations, scaffolding)
	var ge: Dictionary = sim.get_building(best_e[0]) if best_e[0] > 0 else {}
	var gz0: int = int(ge.get("tz", gate_e[1]))
	var home := vills.duplicate()
	var keep_gate := []
	while home.size() > 0 and keep_gate.size() < 3:
		keep_gate.append(home.pop_back())
	var keep_build := []
	for k in 3:
		keep_build.append(home.pop_at(20))   # (south side builders)
	sim.order_move(PackedInt32Array(home), ctr.x, ctr.y)
	for k in keep_gate.size():
		sim.move_to(keep_gate[k], float(x1) - 1.0, float(gz0) + 1.2 + k * 0.8)
	var r2: Dictionary = sim.place_wall(1, w.call(xs - 1, z1), w.call(x0, z1), PackedInt32Array())
	if not bool(r2.get("ok", false)):
		push_warning("walls scene: the last stretch was refused: %s" % r2.get("reason", ""))
	# east to west, each builder starts 3 s after the one before: three stages
	var stretch: Array = []
	for id in r2.get("ids", PackedInt32Array()):
		var b: Dictionary = sim.get_building(id)
		stretch.append([-int(b.get("tx", 0)), id])
	stretch.sort()
	for t in 11 * FPS:
		if t % (3 * FPS) == 0:
			var k := t / (3 * FPS)
			var pi := 1 + 2 * k
			if k < keep_build.size() and pi < stretch.size():
				sim.order_build(PackedInt32Array([keep_build[k]]), stretch[pi][1])
		sim.tick(1)
	# two of them walk out through the gate (it opens for them), one waits
	for k in 2:
		sim.move_to(keep_gate[k], float(x1) + 5.0, float(gz0) + 1.5 + k * 1.0)
	sim.tick(int(1.6 * FPS))
	# battle damage on the east side north of the open gate: d1, then d2
	var W2: Dictionary = sim.get_walls()
	for i in int(W2.count):
		if int(W2.rect[i * 4]) != x1 or int(W2.kind[i]) > 1:
			continue
		var below := gz0 - (int(W2.rect[i * 4 + 1]) + int(W2.rect[i * 4 + 3]))
		var want := 0.55 if below >= 1 and below < 4 else (0.22 if below >= 4 and below < 9 else 1.0)
		var id: int = W2.ids[i]
		for k in 40:   # (armour takes its share: hit until it is down to `want`)
			var b: Dictionary = sim.get_building(id)
			if b.is_empty() or float(b.hp) <= want * float(b.max_hp):
				break
			sim.damage(id, maxf(1.0, float(b.hp) - want * float(b.max_hp)) * 0.5, 0)
	if OS.get_environment("AOV_WALLS_DEBUG") != "":
		var W3: Dictionary = sim.get_walls()
		for i in int(W3.count):
			if int(W3.kind[i]) == 2:
				print("walls: gate ", W3.ids[i], " rect ", W3.rect.slice(i * 4, i * 4 + 4), " open ", W3.open[i])
		for v in keep_gate:
			var u: Dictionary = sim.get_unit(v)
			print("walls: gate villager ", u.x, ",", u.z, " ", u.order)
	return true

static func _unbuilt(sim, owner: int) -> Array:
	var W: Dictionary = sim.get_walls()
	var out := []
	for i in int(W.count):
		if int(W.owner[i]) == owner and int(W.built[i]) == 0 and int(W.kind[i]) <= 2:
			out.append(int(W.ids[i]))
	return out

## Step until every wall piece is built; idle builders go to the nearest
## unfinished piece once a second.
static func _build_all(sim, vills: Array, max_ticks: int) -> void:
	for t in max_ticks:
		if t % 30 == 0:
			var left := _unbuilt(sim, 1)
			if left.is_empty():
				return
			var pos := {}
			for id in left:
				var b: Dictionary = sim.get_building(id)
				pos[id] = Vector2(float(b.get("x", 0.0)), float(b.get("z", 0.0)))
			for v in vills:
				var u: Dictionary = sim.get_unit(v)
				if u.is_empty() or bool(u.get("dead", false)) or str(u.get("order", "")) == "build":
					continue
				var up := Vector2(float(u.x), float(u.z))
				var best := 0
				var bd := 1e9
				for id in left:
					var d: float = pos[id].distance_to(up)
					if d < bd:
						bd = d
						best = id
				if best > 0:
					sim.order_build(PackedInt32Array([v]), best)
		sim.tick(1)
