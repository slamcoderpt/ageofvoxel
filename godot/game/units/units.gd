extends Node3D
## Units renderer, first pass (sim core B): every unit drawn from its
## exported voxel part rig (VoxelModels.rig) in the rest pose, one MultiMesh
## per (type, part) with the owner's colour as instance data. The units /
## battle piece replaces the static pose with the animated one of
## src/units/anim.js; the transforms below (root at the interpolated
## position, yaw, per-unit scale jitter, parts chained through their joints)
## are the ones src/units/index.js render() uses with all channel rotations
## at zero.
##
## Conditional parts follow the show(u) rules of src/units/models.js:
## villager tools by task (axe / pick / sickle while gathering or walking to
## gather empty-handed, hammer while building), carried goods by carry kind;
## soldiers' kit (helmet, cloak, weapon, shield) from gearOf(u) (the same
## uhash of the unit id as src/units/anim.js).

const PLAYER_COLORS := [0xbbbbbb, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818]
const A_WALK := 1
const A_GATHER := 2
const A_BUILD := 3
const A_ATTACK := 5
const O_GATHER := 2
const RES_FOOD := 0
const RES_WOOD := 1
const RES_GOLD := 2

var game: Node = null
var _types: PackedStringArray
var _rigs := []          # type index -> {parts: [{mm, offset, name}], big}
var _team := []          # owner -> linear team colour (Color, crushed saturation like the JS)

func setup(g: Node) -> void:
	game = g
	_types = game.sim.unit_type_names()
	for c in PLAYER_COLORS:
		var col := Color.hex((c << 8) | 0xff).srgb_to_linear()
		var mx := maxf(maxf(col.r, col.g), maxf(col.b, 1e-4))
		_team.append(Color(mx * pow(col.r / mx, 2), mx * pow(col.g / mx, 2), mx * pow(col.b / mx, 2)))
	var mat := VoxelModels.team_material(Color.WHITE, true)
	for t in _types:
		var rig := VoxelModels.rig(t)
		var def: Dictionary = game.sim.get_unit_def(t)
		var entry := {"parts": [], "big": bool(def.get("myth", false)) or bool(def.get("hero", false))}
		if rig.is_empty():
			_rigs.append(entry)
			continue
		var voxel := float(rig.voxel)
		var offsets := []
		for p in rig.parts:
			var j: Array = p.joint
			var off := Vector3(j[0], j[1], j[2]) * voxel
			var pi := int(p.parentIdx)
			if pi >= 0:
				off += offsets[pi]
			offsets.append(off)
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = VoxelModels.mesh("units", str(p.mesh))
			mm.instance_count = 0
			var mmi := MultiMeshInstance3D.new()
			mmi.name = "%s_%s" % [t, p.name]
			mmi.multimesh = mm
			mmi.material_override = mat
			add_child(mmi)
			entry.parts.append({"mm": mm, "offset": off, "name": str(p.name), "conditional": bool(p.conditional)})
		_rigs.append(entry)

## src/units/anim.js uhash(u, k)
static func uhash(id: int, k: int) -> float:
	var a := ((id + 1) * 2654435761) & 0xffffffff
	var b := ((k + 7) * 40503) & 0xffffffff
	return float((a ^ b) % 10007) / 10007.0

## src/units/anim.js gearOf(u)
static func gear_of(id: int, type: String) -> Dictionary:
	var h := uhash(id, 20)
	var c := uhash(id, 21)
	var s := uhash(id, 22)
	var kit := (1 if uhash(id, 24) < 0.3 else 0) if type == "hoplite" else 0
	return {
		"kit": kit,
		"helm": 2 if kit == 1 else (0 if h < 0.42 else (1 if h < 0.84 else 3)),
		"cloak": 1 if c < 0.12 else (2 if c < 0.42 else 0),
		"shield": 0 if s < 0.25 else (1 if s < 0.45 else (2 if s < 0.8 else 3)),
		"hat": 0 if h < 0.4 else (1 if h < 0.72 else 2),
		"pennant": 1 if uhash(id, 23) < 0.22 else 0,
	}

## show(u) of a conditional part
func _shows(part: String, type: String, id: int, anim: int, order: int, task: int, carry: int, carry_amt: float, attack_t: float, gear: Dictionary) -> bool:
	match part:
		"toolHammer":
			return anim == A_BUILD
		"toolAxe", "toolPick", "toolSickle":
			if anim != A_GATHER and not (anim == A_WALK and order == O_GATHER and carry_amt <= 0.0):
				return false
			return task == (RES_WOOD if part == "toolAxe" else (RES_GOLD if part == "toolPick" else RES_FOOD))
		"carryWood":
			return carry_amt > 0.0 and carry == RES_WOOD
		"carryGold":
			return carry_amt > 0.0 and carry == RES_GOLD
		"carryFood":
			return carry_amt > 0.0 and carry == RES_FOOD
		"arrow":
			return anim == A_ATTACK and attack_t > 0.45
		"head", "head1", "head2", "head3":
			var v := 0 if part == "head" else int(part.substr(4))
			return gear.helm == v if type == "hoplite" else gear.hat == v
		"cloakLong":
			return gear.cloak == 1
		"cloakShort":
			return gear.cloak == 2
		"weapon":
			return gear.kit == 0
		"pennant":
			return gear.kit == 0 and gear.pennant == 1
		"sword", "thureos":
			return gear.kit == 1
		"shield", "shield1", "shield2", "shield3":
			var v := 0 if part == "shield" else int(part.substr(6))
			return gear.kit == 0 and gear.shield == v
	return true

func frame(_dt: float, alpha: float) -> void:
	var U: Dictionary = game.sim.get_units()
	var n: int = U.count
	var ids: PackedInt32Array = U.ids
	var pos: PackedFloat32Array = U.pos
	var prev: PackedFloat32Array = U.prev_pos
	var rot: PackedFloat32Array = U.rot
	var prot: PackedFloat32Array = U.prev_rot
	var types: PackedByteArray = U.type
	var owners: PackedByteArray = U.owner
	var anims: PackedByteArray = U.anim
	var orders: PackedByteArray = U.order
	var flags: PackedByteArray = U.flags
	var carry: PackedByteArray = U.carry
	var carry_amt: PackedFloat32Array = U.carry_amount
	var task: PackedByteArray = U.task
	var atk: PackedFloat32Array = U.attack_t
	var die_t: PackedFloat32Array = U.die_t
	# per (type, part) instance lists
	var lists := []
	var colors := []
	for t in _rigs.size():
		var l := []
		var c := []
		for p in _rigs[t].parts:
			l.append([])
			c.append([])
		lists.append(l)
		colors.append(c)
	for i in n:
		var t: int = types[i]
		var rig: Dictionary = _rigs[t]
		if rig.parts.is_empty():
			continue
		var id: int = ids[i]
		var x := lerpf(prev[i * 2], pos[i * 2], alpha)
		var z := lerpf(prev[i * 2 + 1], pos[i * 2 + 1], alpha)
		var dr := wrapf(rot[i] - prot[i], -PI, PI)
		var yaw := prot[i] + dr * alpha
		var dead := (flags[i] & 2) != 0
		var sc := 1.0 if rig.big else 0.93 + uhash(id, 7) * 0.13
		var y: float = game.sim.height_at(x, z)
		var basis := Basis(Vector3.UP, yaw).scaled(Vector3(sc, sc, sc))
		var origin := Vector3(x, y, z)
		if dead:
			# a man goes over full length onto his back (or face) and lies flat
			var k := clampf((die_t[i] - 0.18) / 0.5, 0.0, 1.0)
			var f := k * k
			var dir := 1.0 if uhash(id, 70) < 0.3 else -1.0
			basis = basis * Basis(Vector3.RIGHT, dir * f * 1.5)
			origin.y += 0.26 * f * 0.3 - maxf(0.0, die_t[i] - 24.0) * 0.5
		var team: Color = _team[owners[i]] if owners[i] < _team.size() else Color.WHITE
		if dead:
			team = team.darkened(0.6)
		var tname := _types[t]
		var gear := gear_of(id, tname) if tname == "hoplite" or tname == "toxotes" else {}
		var parts: Array = rig.parts
		for pi in parts.size():
			var p: Dictionary = parts[pi]
			if p.conditional and not _shows(p.name, tname, id, anims[i], orders[i], task[i], carry[i], carry_amt[i], atk[i], gear):
				continue
			lists[t][pi].append(Transform3D(basis, origin + basis * p.offset))
			colors[t][pi].append(team)
	for t in _rigs.size():
		var parts: Array = _rigs[t].parts
		for pi in parts.size():
			var mm: MultiMesh = parts[pi].mm
			var l: Array = lists[t][pi]
			if mm.instance_count < l.size():
				mm.instance_count = maxi(l.size(), mm.instance_count * 2)
			mm.visible_instance_count = l.size()
			var cl: Array = colors[t][pi]
			for k in l.size():
				mm.set_instance_transform(k, l[k])
				mm.set_instance_custom_data(k, Color(cl[k].r, cl[k].g, cl[k].b, 0.0))
