extends Node3D
## Town dressing (port of src/buildings/props.js): visual-only props (well,
## market stalls, stoa, statues on plinths, fire pillars, amphorae, crates,
## cypresses, walled house courts, temenos walls, the altar...) anchored
## round built buildings. Props never block movement. Each building offers
## candidate spots (tile offsets from its footprint); a prop takes the first
## spot whose tiles are free (walkable, outside every building footprint,
## unused by another prop). The layout is recomputed only when the set of
## buildings (or their built flag) changes, like the JS `dirty` flag.
## Drawn as one MultiMesh per prop kind (team colour per instance), so a
## whole town is ~30 draw calls whatever its size. Models: VoxelModels
## "props/<kind>" (exported from props.js, pivot at the footprint centre).

const PROPS := {
	"well": [2, 2, false], "stall_food": [2, 1, false], "stall_pots": [2, 1, false],
	"stall_cloth": [2, 1, false], "stoa": [2, 5, false], "kiln": [2, 2, false],
	"statue": [2, 2, false], "hoplite": [1, 1, false], "pillar": [1, 1, false],
	"amphorae": [1, 1, false], "crates": [1, 1, false], "cypress": [1, 1, false],
	"olive": [1, 1, false], "fence_x": [3, 1, true], "fence_z": [1, 3, true],
	"wall_x": [3, 1, true], "wall_z": [1, 3, true], "garden": [2, 2, true],
	"pithoi": [2, 1, false], "kore": [1, 1, false], "flowers": [2, 1, true],
	"court_a": [1, 3, false], "court_b": [1, 3, false], "court_c": [1, 3, false],
	"court_d": [1, 3, false], "altar": [1, 1, false], "twall_x": [3, 1, false],
	"twall_z": [1, 3, false], "planter": [1, 1, false],
}   # kind -> [w, h, ground] in tiles (props.js PROPS)
const COURTS := ["court_a", "court_b", "court_c", "court_d"]
const G_PAVED := 4
const G_FARM := 5
const LOCAL_PLAYER := 1

var game: Node = null
var _batches := {}     # kind -> {mmi, mm, items: [{x, z, owner, xf}], shown: PackedByteArray}
var _items: Array = []
var _team_lin := {}    # owner -> Color (linear)
var _fog_version := -1

func setup(g: Node, team_colors: Array) -> void:
	game = g
	for o in team_colors.size():
		var c := Color.hex((int(team_colors[o]) << 8) | 0xff).srgb_to_linear()
		c.a = 0.0   # instance custom alpha = hit flash
		_team_lin[o] = c

## src/core/rng.js hash2 / hash3 (bit-exact)
static func hash2(x: int, y: int, s: int = 0) -> float:
	var h := (x * 374761393 + y * 668265263 + s * 2147483647) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	h ^= h >> 16
	return float(h) / 4294967296.0

static func hash3(x: int, y: int, z: int, s: int = 0) -> float:
	return hash2(x * 31 + z * 7919, y * 17 + z * 131, s)

## blds: Array of {id, type, owner, tx, tz, w, h, built, variant, temenos (Array or null)}
func rebuild(blds: Array) -> void:
	_items = _layout(blds)
	var by_kind := {}
	for it in _items:
		if not by_kind.has(it.kind):
			by_kind[it.kind] = []
		by_kind[it.kind].append(it)
	for kind in _batches.keys():
		if not by_kind.has(kind):
			_batches[kind].mmi.visible = false
			_batches[kind].items = []
			_batches[kind].mm.instance_count = 0
	for kind in by_kind:
		var list: Array = by_kind[kind]
		var b: Dictionary = _batches.get(kind, {})
		if b.is_empty():
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = VoxelModels.mesh("props", kind)
			var mmi := MultiMeshInstance3D.new()
			mmi.name = "prop_" + kind
			mmi.multimesh = mm
			var mat := VoxelModels.team_material(Color.WHITE, true)
			mat.set_shader_parameter("roughness_value", 0.93)
			mmi.material_override = mat
			add_child(mmi)
			b = {"mmi": mmi, "mm": mm}
			_batches[kind] = b
		b.items = list
		var mm: MultiMesh = b.mm
		mm.instance_count = list.size()
		b.mmi.visible = true
		for i in list.size():
			var it: Dictionary = list[i]
			var pos := Vector3(it.x, game.sim.height_at(it.x, it.z), it.z)
			it.xf = Transform3D(Basis(Vector3.UP, it.rot), pos)
			mm.set_instance_transform(i, it.xf)
			mm.set_instance_custom_data(i, _team_lin.get(it.owner, Color(1, 1, 1, 0)))
		b.shown = PackedByteArray()
		b.shown.resize(list.size())
		b.shown.fill(1)
	_fog_version = -1
	update_fog()

## Props outside the explored area are hidden (zero-scale instances), only
## rewritten when the fog changes.
func update_fog() -> void:
	var fv: int = game.sim.fog_version()
	if fv == _fog_version:
		return
	_fog_version = fv
	for kind in _batches:
		var b: Dictionary = _batches[kind]
		var any := false
		for i in b.items.size():
			var it: Dictionary = b.items[i]
			var v := 1 if (it.owner == LOCAL_PLAYER or game.sim.is_explored(it.x, it.z)) else 0
			if v:
				any = true
			if v == b.shown[i]:
				continue
			b.shown[i] = v
			var xf: Transform3D = it.xf
			b.mm.set_instance_transform(i, xf if v else Transform3D(Basis().scaled(Vector3.ZERO), xf.origin))
		b.mmi.visible = any

func _layout(blds: Array) -> Array:
	var sim = game.sim
	var size: int = sim.get_map_size()
	var cols: int = sim.get_map_cols()
	var cps: int = cols / size
	var walk: PackedByteArray = sim.get_walkable()
	var ground: PackedByteArray = sim.get_ground()
	var used := {}
	# footprint lookup: tile -> true for every building (built or not)
	var foot := {}
	for o in blds:
		for k in range(o.tz, o.tz + o.h):
			for i in range(o.tx, o.tx + o.w):
				foot[k * 4096 + i] = true
	var out := []
	var order := []
	for b in blds:
		if b.built:
			order.append(b)
	order.sort_custom(func(a, b2):
		var da: int = a.w * a.h
		var db: int = b2.w * b2.h
		return da > db if da != db else a.id < b2.id)
	for b in order:
		for anchor in _anchors_for(b):
			var kind: String = anchor[0]
			var p: Array = PROPS[kind]
			var pw: int = p[0]
			var ph: int = p[1]
			for spot in anchor[1]:
				var x: int = b.tx + spot[0]
				var z: int = b.tz + spot[1]
				var ok := true
				for k in range(z, z + ph):
					for i in range(x, x + pw):
						var key := k * 4096 + i
						if i < 0 or k < 0 or i >= size or k >= size or used.has(key) or not walk[k * size + i] or foot.has(key):
							ok = false
							break
						if p[2]:
							var cx := i * cps
							var cz := k * cps
							var g: int = ground[cz * cols + cx] if cx < cols and cz < cols else -1
							if g == G_PAVED or g == G_FARM or g < 0:
								ok = false
								break
					if not ok:
						break
				if not ok:
					continue
				for k in range(z, z + ph):
					for i in range(x, x + pw):
						used[k * 4096 + i] = true
				var square: bool = pw == ph and not p[2] and kind != "statue" and kind != "hoplite" and kind != "kore"
				var rot := floorf(hash3(x, 9, z, 73) * 4.0) * (PI / 2.0) if square else 0.0
				out.append({"kind": kind, "owner": b.owner, "x": x + pw / 2.0, "z": z + ph / 2.0, "rot": rot})
				break
	return out

## props.js anchorsFor: [kind, [[dx, dz], ...]] (first free spot wins)
func _anchors_for(b: Dictionary) -> Array:
	var w: int = b.w
	var h: int = b.h
	var v := int(floorf(hash3(b.tx, 5, b.tz, 71) * 4.0))
	match b.type:
		"town_center":
			return [
				["stoa", [[-3, 5], [-4, 5]]], ["stoa", [[-3, -3], [-3, -4]]],
				["pillar", [[-1, h], [-1, h + 1]]], ["pillar", [[w, h], [w, h + 1]]],
				["stall_food", [[0, h], [-1, h + 1]]], ["stall_pots", [[0, h + 2], [-1, h + 2]]], ["stall_cloth", [[w - 2, h + 2], [w - 1, h + 2]]],
				["well", [[w + 1, h], [w + 1, h + 1]]],
				["statue", [[w + 1, -3], [w + 1, -2]]],
				["cypress", [[-2, -2], [-1, -2]]], ["cypress", [[w + 1, 0], [w, -2]]],
			]
		"house":
			var out := [[COURTS[(v + maxi(0, b.variant)) & 3], [[w, 0]]], ["wall_x", [[0, -1]]]]
			if v & 2:
				out.append(["cypress", [[-1, 0]]])
			return out
		"storehouse":
			return [
				["fence_z", [[w + 1, -1]]], ["fence_z", [[-2, -1]]],
				["crates", [[w, 0], [-1, 0]]], ["pithoi", [[-1, -1], [w - 1, -1]]],
				["kiln", [[-4, 0], [w + 2, 0], [-4, 2]]],
			]
		"temple":
			if b.temenos != null:
				return _temenos_anchors(b)
			return [
				["kore", [[-1, h]]], ["kore", [[w, h]]],
				["pillar", [[-1, h - 2]]], ["pillar", [[w, h - 2]]],
				["cypress", [[-1, 0], [-1, 1]]], ["cypress", [[w, 0], [w, 1]]],
				["statue", [[w + 1, h - 1], [-3, h - 1], [w + 1, 2]]],
				["flowers", [[0, h + 1]]], ["flowers", [[3, h + 1]]],
				["hoplite", [[w, h + 1], [-1, h + 1]]],
			]
		"barracks":
			return [
				["pillar", [[-1, h - 1]]], ["pillar", [[w, h - 1]]], ["hoplite", [[w, 1], [-1, 1]]],
				["fence_x", [[0, h + 1], [1, -1]]], ["fence_z", [[w + 1, 0], [-2, 0]]],
			]
	return []

## props.js temenosAnchors: forecourt with the altar on the axis, fire
## pillars and statues flanking the approach, rows of cypresses, and a low
## boundary wall with a gate on the axis.
func _temenos_anchors(b: Dictionary) -> Array:
	var w: int = b.w
	var h: int = b.h
	var t: Array = b.temenos
	var out := [
		["altar", [[w / 2, h + 2]]],
		["pillar", [[-1, h]]], ["pillar", [[w, h]]],
		["statue", [[-3, h + 1]]], ["statue", [[w + 1, h + 1]]],
	]
	for z in [0, 2, 4]:
		out.append(["cypress", [[-2, z]]])
		out.append(["cypress", [[w + 1, z]]])
	var x0: int = t[0] - b.tx
	var z0: int = t[1] - b.tz
	var x1: int = x0 + t[2] - 1
	var z1: int = z0 + t[3] - 1
	var x := x0
	while x + 2 <= x1:
		out.append(["twall_x", [[x, z0]]])
		x += 3
	var z := z0 + 1
	while z + 2 <= z1:
		out.append(["twall_z", [[x0, z]]])
		out.append(["twall_z", [[x1, z]]])
		z += 3
	var gate0: int = w / 2 - 2
	var gate1: int = w / 2 + 2
	x = x0
	while x + 2 < gate0 + 1:
		out.append(["twall_x", [[x, z1]]])
		x += 3
	x = x1 - 2
	while x > gate1 - 1:
		out.append(["twall_x", [[x, z1]]])
		x -= 3
	return out
