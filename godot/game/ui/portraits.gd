extends Node
## Unit and building portraits for the HUD (port of src/core/portrait.js +
## units.portraitObject / ui.buildingObject): each (kind, type, owner) is
## rendered once into its own SubViewport (own world, transparent, MSAA)
## lit by portrait.gdshader (three.js hemisphere + sun, no tonemap, exactly
## as src/core/portrait.js) and the JS framing (fov 30, camera
## at centre + r * (2.2, 1.4, 3.2)), then kept as a ViewportTexture. The
## viewports render once (UPDATE_ONCE) and are never redrawn.

const SIZE := 128

var sim: Object = null
var _cache := {}   # key -> Texture2D
var _colors := {}  # owner -> Color

func player_color(owner: int) -> Color:
	if not _colors.has(owner):
		var p: Dictionary = sim.get_player(owner) if sim else {}
		var c := int(p.get("color", 0x2f6bff))
		_colors[owner] = Color8((c >> 16) & 255, (c >> 8) & 255, c & 255)
	return _colors[owner]

func unit(type: String, owner: int) -> Texture2D:
	var key := "u:%s:%d" % [type, owner]
	if not _cache.has(key):
		_cache[key] = _render(_unit_object(type, owner))
	return _cache[key]

## A unit's command-button portrait (ui piece): a tight 3/4 close-up that fills
## the button (a man's head and shoulders, a beast's or a rider's forequarters,
## a machine whole), not the full figure of the card's portrait, so a train /
## summon button reads as a face at 54 px (Retold's unit buttons are busts).
## Busts with their own view: [yaw, pitch] in degrees from the front-right, and
## "whole" (the whole model framed, its silhouette is what reads: the catapult on
## its wheels, the Rhino's horns and the Elephant's trunk and ears in profile) or
## "fore" (a rider with his horse's head, neck and chest: the Mercenary Cavalry,
## so he never reads as the Mercenary on foot beside him in the Town Center).
const BUST_VIEW := {
	"catapult": [55.0, 14.0, "whole"],
	"rhino_of_set": [62.0, 12.0, "whole"],
	"elephant_of_set": [78.0, 10.0, "whole"],
	"mercenary_cavalry": [62.0, 12.0, "fore"],
}

## Parts a bust also frames (and shows, when the card portrait hides them): the
## Laborer with his pick on his shoulder, the Slinger with his sling and pouch,
## so neither is just a bare-chested head beside the other.
const BUST_WITH := {
	"laborer": ["toolPick"],
	"slinger": ["weapon"],
}

## A bust's pose (radians, Basis.from_euler on the rig part): the Laborer's pick
## raised over his shoulder, the Slinger's arm up with his sling.
const BUST_POSE := {
	"laborer": {"armR": Vector3(-1.4, 0, 0), "foreR": Vector3(-1.4, 0, 0)},
	"slinger": {"armR": Vector3(-2.6, 0, 0)},
}

func bust(type: String, owner: int) -> Texture2D:
	var key := "ub:%s:%d" % [type, owner]
	if not _cache.has(key):
		var pose: Dictionary = BUST_POSE.get(type, {})
		var obj := _unit_object(type, owner, BUST_WITH.get(type, []), pose)
		if BUST_WITH.has(type):
			obj.set_meta("bust_with", BUST_WITH[type])
		# the hired Mercenary is seen from his left (shield side), so his bust does
		# not repeat the Spearman's from the same angle (the Mercenary Cavalry is
		# told apart by his horse's head, _bust_focus)
		if type == "mercenary":
			obj.set_meta("bust_mirror", true)
		if BUST_VIEW.has(type):
			var bv: Array = BUST_VIEW[type]
			obj.set_meta("bust_view", Vector2(bv[0], bv[1]))
			if bv.size() > 2:
				obj.set_meta("bust_" + str(bv[2]), true)
		_cache[key] = _render(obj, true)
	return _cache[key]

func building(type: String, owner: int) -> Texture2D:
	var eg := _egypt_model(type, owner)
	if FORT.has(type) and eg == "":
		return fort(type, owner)
	var key := "b:%s:%d" % [type, owner]
	if not _cache.has(key) and eg != "":
		# an Egyptian's building: its Egyptian model (egypt_buildings.gd), Classical look
		var p: Dictionary = sim.get_player(owner) if sim else {}
		var em := MeshInstance3D.new()
		em.mesh = EgyptBuildings.mesh_for(eg, 1, str(p.get("god", "ra")).to_lower())
		em.material_override = _material(owner)
		var eroot := Node3D.new()
		if em.mesh:
			eroot.add_child(em)
		_cache[key] = _render(eroot)
	if not _cache.has(key):
		var mi := MeshInstance3D.new()
		# the Armory and the Market are the "techbuildings" models (Classical look)
		mi.mesh = VoxelModels.mesh("techbuildings", "%s/a1" % type) if TECHB.has(type) else VoxelModels.mesh("buildings", "%s/0" % type)
		mi.material_override = _material(owner)
		var root := Node3D.new()
		root.add_child(mi)
		_cache[key] = _render(root)
	return _cache[key]

const EgyptBuildings := preload("res://game/buildings/egypt_buildings.gd")

## The Egyptian model type a building portrait uses ("" = the Greek / shared
## model): every type with an Egyptian model when its owner is Egyptian (the
## tower: the Sentry Tower), the Egyptian-only types always.
func _egypt_model(type: String, owner: int) -> String:
	var egyptian := false
	if sim:
		egyptian = str(sim.get_player(owner).get("civ", "")) == "egyptian"
	if type == "tower" or type == "wall" or type == "wall_pillar" or type == "gate":
		return "sentry_tower" if egyptian and type == "tower" and EgyptBuildings.model_type("sentry_tower") != "" else ""
	if EgyptBuildings.model_type(type) == "":
		return ""
	if egyptian or type in ["granary", "lumber_camp", "mining_camp", "obelisk", "eg_barracks", "migdol", "siege_works"] or type.begins_with("monument_"):
		return type
	return ""

## Fortification portraits (Godot-only models, groups "walls" / "towers"):
## a short run of wall between two pillars, a pillar, a closed gate between
## its two gate towers, a tower at a stage (level 0..3).
const TECHB := {"armory": true, "market": true}
const FORT := {"wall": true, "wall_pillar": true, "gate": true, "tower": true}

func fort(type: String, owner: int, level := 0) -> Texture2D:
	var key := "f:%s:%d:%d" % [type, owner, level]
	if _cache.has(key):
		return _cache[key]
	var root := Node3D.new()
	var mat := _material(owner)
	var put := func(group: String, model: String, xf: Transform3D) -> void:
		if not VoxelModels.group(group).get("man", {}).get("models", {}).has(model):
			return
		var mi := MeshInstance3D.new()
		mi.mesh = VoxelModels.mesh(group, model)
		mi.material_override = mat
		mi.transform = xf
		root.add_child(mi)
	match type:
		"wall":
			put.call("walls", "pillar", Transform3D(Basis(), Vector3(-1.5, 0, 0)))
			put.call("walls", "seg/0", Transform3D(Basis(), Vector3(-0.5, 0, 0)))
			put.call("walls", "seg/1", Transform3D(Basis(), Vector3(0.5, 0, 0)))
			put.call("walls", "pillar", Transform3D(Basis(), Vector3(1.5, 0, 0)))
		"wall_pillar":
			put.call("walls", "pillar_flag", Transform3D())
		"gate":
			put.call("walls", "pillar_gate", Transform3D(Basis(Vector3.UP, PI), Vector3(-1.5, 0, 0)))
			put.call("walls", "gate2", Transform3D())
			put.call("walls", "gate2/leaf", Transform3D(Basis(), Vector3(-0.625, 0, 0)))
			put.call("walls", "gate2/leaf", Transform3D(Basis(Vector3.UP, PI), Vector3(0.625, 0, 0)))
			put.call("walls", "pillar_gate", Transform3D(Basis(), Vector3(1.5, 0, 0)))
		_:
			put.call("towers", str(clampi(level, 0, 3)), Transform3D())
	_cache[key] = _render(root)
	return _cache[key]

func _material(owner: int) -> ShaderMaterial:
	var key := "m:%d" % owner
	if not _cache.has(key):
		var m := ShaderMaterial.new()
		m.shader = preload("res://game/ui/portrait.gdshader")
		m.set_shader_parameter("team_color", player_color(owner))
		_cache[key] = m
	return _cache[key]

func _unit_object(type: String, owner: int, extra := [], pose := {}) -> Node3D:
	var root := Node3D.new()
	var rig := VoxelModels.rig(type)
	if rig.is_empty():
		return root
	var v := float(rig.voxel)
	var mat := _material(owner)
	var world := {}
	for p in rig.parts:
		var j: Array = p.joint
		var t := Transform3D(Basis.IDENTITY, Vector3(j[0], j[1], j[2]) * v)
		# (the gods piece) a flyer's wings (Roc, Phoenix) are flat plates spread level, edge-on
		# from the portrait camera (a thin stick on the card): raise them in a soaring V
		if str(rig.get("anim", "")) == "flyer" and (str(p.name) == "wingL" or str(p.name) == "wingR"):
			var up := 0.7 if str(p.name) == "wingL" else -0.7
			t.basis = Basis(Vector3.BACK, up) * Basis(Vector3.UP, -up * 0.35)
		if pose.has(str(p.name)):
			t.basis = t.basis * Basis.from_euler(pose[str(p.name)])
		if p.parent != null and str(p.parent) != "" and world.has(p.parent):
			t = world[p.parent] * t
		world[p.name] = t
		if not bool(p.get("portrait", false)) and not (str(p.name) in extra):
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = VoxelModels.mesh("units", p.mesh)
		mi.material_override = mat
		mi.transform = t
		if str(p.name) == "weapon":
			mi.set_meta("weapon", true)
		mi.set_meta("part", str(p.name))
		root.add_child(mi)
	return root

func _render(obj: Node3D, bust := false) -> Texture2D:
	var vp := SubViewport.new()
	vp.size = Vector2i(SIZE, SIZE)
	vp.own_world_3d = true
	vp.transparent_bg = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	vp.positional_shadow_atlas_size = 0
	add_child(vp)
	# Lighting lives in portrait.gdshader (unshaded): the environment only
	# has to stay out of the way (no tonemap, no glow, no ambient).
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED
	e.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	e.tonemap_exposure = 1.0
	env.environment = e
	vp.add_child(env)
	vp.add_child(obj)
	# bounds of the object
	var box := AABB()
	var body := AABB()
	var first := true
	var first_body := true
	var parts := {}  # part name -> its AABB (the bust's focus, _bust_focus)
	for c in obj.get_children():
		if c is MeshInstance3D and c.mesh:
			var b: AABB = c.transform * c.mesh.get_aabb()
			if c.has_meta("part"):
				parts[str(c.get_meta("part"))] = b
			box = b if first else box.merge(b)
			first = false
			if not c.has_meta("weapon"):
				body = b if first_body else body.merge(b)
				first_body = false
	# A weapon far taller than the man (the hero's 5.8-unit spear) would
	# shrink him to a speck in the frame: frame on the body instead, as the
	# other units already are (their weapons stay within half a body).
	if not first_body and box.size.y > body.size.y * 1.5:
		box = body
	var cam := Camera3D.new()
	cam.fov = 30.0
	cam.near = 0.01
	cam.far = 100.0
	vp.add_child(cam)
	if obj.has_meta("bust_mirror"):
		parts["_mirror"] = AABB()
	for k in ["whole", "fore"]:
		if obj.has_meta("bust_" + k):
			parts["_" + k] = AABB()
	if obj.has_meta("bust_view"):
		var vw: Vector2 = obj.get_meta("bust_view")
		parts["_view"] = AABB(Vector3(vw.x, vw.y, 0), Vector3.ZERO)
	if bust and not first_body:
		_frame_bust(cam, obj, body, parts)
		cam.current = true
		return vp.get_texture()
	var ctr := box.get_center()
	var r := maxf(box.size.x, maxf(box.size.y, box.size.z)) * 0.62
	cam.position = ctr + Vector3(r * 2.2, r * 1.4, r * 3.2)
	cam.look_at(ctr, Vector3.UP)
	cam.current = true
	return vp.get_texture()

## The bust framing (bust()): a FOCUS box (_bust_focus: a man's head and
## shoulders, a beast's head, a rider's head and chest over his mount's head, a
## bird's head and breast, a machine's working top) is fitted to the frame from
## the model's real voxels, not from boxes: every vertex inside the focus is
## projected on the view plane and an orthographic camera is sized to their 2D
## bounds (~94 % of the frame). A long subject (a crocodile's snout, a bird's
## spread wings) may run out of the frame on its long side (at most a quarter of
## it), the window kept on the head (ANCHOR). Beasts and machines try a few 3/4
## views (yaw 25-65 deg, pitch 18-34 deg from the front-right) and keep the one
## whose subject fills the tile most; men keep the classic front-right 3/4. The
## rest of the model renders and runs out of the frame behind (a bust, not a
## shrunken full figure).
func _frame_bust(cam: Camera3D, obj: Node3D, body: AABB, parts := {}) -> void:
	var tall := body.size.y > maxf(body.size.x, body.size.z) * 1.2
	var crop := _bust_focus(body, parts)
	if obj.has_meta("bust_with"):
		for pn in obj.get_meta("bust_with"):
			if parts.has(pn):
				# (its top half: the pick's head, the sling's pocket)
				var pb: AABB = parts[pn]
				crop = crop.merge(AABB(Vector3(pb.position.x, pb.end.y - pb.size.y * 0.5, pb.position.z), Vector3(pb.size.x, pb.size.y * 0.5, pb.size.z)))
	if parts.has("_whole"):
		crop = body
	elif parts.has("_fore") and parts.has("neck") and parts.has("body"):
		# the rider and his horse's head, neck and chest (the forequarters)
		var bb: AABB = parts.body
		var fq := AABB(Vector3(bb.position.x, bb.position.y + bb.size.y * 0.3, bb.end.z - bb.size.z * 0.45), Vector3(bb.size.x, bb.size.y * 0.7, bb.size.z * 0.45))
		crop = crop.merge(parts.neck).merge(fq)
	var anchor: AABB = crop
	if parts.has("head"):
		anchor = parts.head
	elif parts.has("neck"):
		anchor = parts.neck
	var grow := crop.grow(maxf(crop.size.length() * 0.02, 0.01))
	# the voxels inside the focus (world space)
	var pts := PackedVector3Array()
	for c in obj.get_children():
		if not (c is MeshInstance3D) or c.mesh == null:
			continue
		var xf: Transform3D = c.transform
		for si in c.mesh.get_surface_count():
			var arr: Array = c.mesh.surface_get_arrays(si)
			var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			for v in vs:
				var w: Vector3 = xf * v
				if grow.has_point(w):
					pts.append(w)
	if pts.is_empty():
		for k in 8:
			pts.append(crop.get_endpoint(k))
	var man := parts.has("head") and parts.has("torso") and not parts.has("body") and not parts.has("coil")
	var dirs: Array[Vector3] = []
	if man:
		dirs.append(Vector3(0.62, 0.3, 1.0).normalized())
	else:
		for pitch in [18.0, 26.0, 34.0]:
			# (a machine also from nearer the side, so a throwing arm reads in profile)
			for yaw in ([55.0, 65.0, 75.0] if parts.has("frame") and parts.has("weapon") else [25.0, 35.0, 45.0, 55.0, 65.0]):
				var py := deg_to_rad(pitch)
				var yw := deg_to_rad(yaw)
				dirs.append(Vector3(sin(yw) * cos(py), sin(py), cos(yw) * cos(py)))
	if parts.has("_view"):
		# a fixed view (bust(): BUST_VIEW, yaw / pitch in degrees from the front-right)
		var vw: Vector3 = parts._view.position
		dirs.clear()
		dirs.append(Vector3(sin(deg_to_rad(vw.x)) * cos(deg_to_rad(vw.y)), sin(deg_to_rad(vw.y)), cos(deg_to_rad(vw.x)) * cos(deg_to_rad(vw.y))))
	var mirror := parts.has("_mirror")
	var best := {}
	for d0 in dirs:
		var dir: Vector3 = d0
		if mirror:
			dir.x = -dir.x
		var f := _fit_view(dir, pts, anchor)
		# a little preference for the classic 40-deg 3/4 (yaw 35-45, pitch 26)
		var score: float = f.fill + (0.03 if absf(d0.y - sin(deg_to_rad(26.0))) < 0.01 and d0.x > 0.55 and d0.x < 0.7 else 0.0)
		if best.is_empty() or score > float(best.score):
			best = f
			best.score = score
			best.dir = dir
	var bd: Vector3 = best.dir
	var right := Vector3.UP.cross(bd).normalized()
	var up := bd.cross(right).normalized()
	var ctr: Vector3 = right * float(best.cx) + up * float(best.cy)
	var depth := 0.0
	for p in pts:
		depth = maxf(depth, p.dot(bd))
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	cam.size = float(best.size)
	var dist := body.size.length() * 2.0 + 2.0
	cam.position = ctr + bd * (depth + dist) - bd * ctr.dot(bd)
	cam.near = 0.01
	cam.far = dist * 2.0 + body.size.length() * 2.0 + 10.0
	cam.look_at(cam.position - bd, Vector3.UP)

## One bust view (_frame_bust): the focus points' 2D bounds seen along dir, the
## orthographic frame size and its centre (right / up coordinates), and how much
## of the frame the subject's bounds fill.
func _fit_view(dir: Vector3, pts: PackedVector3Array, anchor: AABB) -> Dictionary:
	var right := Vector3.UP.cross(dir).normalized()
	var up := dir.cross(right).normalized()
	var x0 := INF
	var x1 := -INF
	var y0 := INF
	var y1 := -INF
	for p in pts:
		var x := p.dot(right)
		var y := p.dot(up)
		x0 = minf(x0, x)
		x1 = maxf(x1, x)
		y0 = minf(y0, y)
		y1 = maxf(y1, y)
	var w := maxf(x1 - x0, 0.001)
	var h := maxf(y1 - y0, 0.001)
	var size := maxf(minf(w, h) / 0.94, maxf(w, h) * 0.8)
	size = minf(size, maxf(w, h) / 0.94)
	var ac := anchor.get_center()
	var cx := (x0 + x1) * 0.5
	var cy := (y0 + y1) * 0.5
	if w > size * 0.94:
		cx = clampf(ac.dot(right), x0 + size * 0.47, x1 - size * 0.47)
	if h > size * 0.94:
		cy = clampf(ac.dot(up), y0 + size * 0.47, y1 - size * 0.47)
	var fill := (minf(w, size) * minf(h, size)) / (size * size)
	return {"size": size, "cx": cx, "cy": cy, "fill": fill}

## The box a bust frames (see _frame_bust), from the rig's part boxes.
func _bust_focus(body: AABB, parts: Dictionary) -> AABB:
	var top := func(b: AABB, f: float) -> AABB:
		return AABB(Vector3(b.position.x, b.end.y - b.size.y * f, b.position.z), Vector3(b.size.x, b.size.y * f, b.size.z))
	var front := func(b: AABB, f: float) -> AABB:
		return AABB(Vector3(b.position.x, b.position.y, b.end.z - b.size.z * f), Vector3(b.size.x, b.size.y, b.size.z * f))
	var tall := body.size.y > maxf(body.size.x, body.size.z) * 1.2
	if parts.has("head") and parts.has("torso") and (parts.has("riderLegs") or parts.has("chariot")):
		# a rider (cavalry, chariot): his head and chest
		var f: AABB = parts.head.merge(top.call(parts.torso, 0.7))
		if parts.has("chariot"):
			# the archer in his chariot: head and chest, the rail at the frame foot
			return parts.head.merge(top.call(parts.torso, 0.85))
		if parts.has("howdah") and parts.has("neck"):
			# the War Elephant: the elephant's head, ears and tusks (the howdah behind)
			var eh: AABB = parts.neck
			for e in ["earL", "earR"]:
				if parts.has(e):
					eh = eh.merge(parts[e])
			return eh
		# the mount's head beside him (its neck mesh's top half: the horse's or the
		# camel's head and ears), so a rider never reads as a man on foot
		if parts.has("neck"):
			f = f.merge(top.call(parts.neck, 0.5))
		return f
	if parts.has("head") and parts.has("torso") and parts.has("body"):
		# a man's upper body on a beast's (Scorpion Man): his head and chest
		return parts.head.merge(top.call(parts.torso, 0.6))
	if parts.has("head") and parts.has("body") and parts.has("neck"):
		# a beast with its own head (gazelle, hyena, giraffe, sphinx, baboon): head and
		# throat, a little of the neck and chest behind
		var hd: AABB = parts.head
		return hd.merge(top.call(parts.neck, 0.15))
	if parts.has("head") and parts.has("torso") and parts.has("_mirror"):
		# the Mercenary: waist-up from his left with his weapon's head in the frame
		# (the Spearman is seen from his right behind his shield, the Mercenary
		# Cavalry with his horse's head)
		var f: AABB = parts.head.merge(top.call(parts.torso, 0.85))
		if parts.has("weapon"):
			f = f.merge(top.call(parts.weapon, 0.35))
		return f
	if parts.has("head") and tall:
		# a standing man / myth figure: head and shoulders (the top 40 %)
		return top.call(body, 0.4)
	if parts.has("head") and parts.has("torso"):
		return parts.head.merge(top.call(parts.torso, 0.5))
	if parts.has("wingL") and parts.has("body"):
		# a bird (Phoenix, Roc): head and breast, the wings run out of the frame
		var bb: AABB = parts.body
		return bb.grow(bb.size.length() * 0.3)
	if parts.has("wingL") and parts.has("torso"):
		# the Wadjet: the reared hood and head
		return top.call(parts.torso, 0.65)
	if parts.has("neck") and parts.has("body"):
		# a beast whose head is its "neck" mesh (crocodile, petsuchos, hippo, rhino,
		# elephant, boar, scarab): the head and the front of the body
		var nk: AABB = parts.neck
		if parts.has("legML"):
			# the Scarab: its head and mandibles and the front of the domed shell
			return nk.merge(front.call(parts.body, 0.7))
		return nk.merge(top.call(front.call(parts.body, 0.25), 0.9))
	if parts.has("torso") and parts.has("coil"):
		return top.call(parts.torso, 0.65)
	if parts.has("frame") and parts.has("body"):
		# the Phoenix Egg on its nest: the whole egg
		return body
	if parts.has("frame") and parts.has("weapon"):
		# the catapult: the whole machine nearly in profile (its throwing arm over the
		# frame is the silhouette that reads; a crop of the frame's timbers did not)
		return parts.weapon.merge(parts.frame)
	if parts.has("frame"):
		# a machine (the siege tower): its upper storeys
		return top.call(parts.frame, 0.45 if tall else 0.6)
	if tall:
		return top.call(body, 0.4)
	return top.call(front.call(body, 0.7), 0.8)
