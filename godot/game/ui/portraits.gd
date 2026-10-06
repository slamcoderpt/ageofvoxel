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

func _unit_object(type: String, owner: int) -> Node3D:
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
		if p.parent != null and str(p.parent) != "" and world.has(p.parent):
			t = world[p.parent] * t
		world[p.name] = t
		if not bool(p.get("portrait", false)):
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = VoxelModels.mesh("units", p.mesh)
		mi.material_override = mat
		mi.transform = t
		if str(p.name) == "weapon":
			mi.set_meta("weapon", true)
		root.add_child(mi)
	return root

func _render(obj: Node3D) -> Texture2D:
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
	for c in obj.get_children():
		if c is MeshInstance3D and c.mesh:
			var b: AABB = c.transform * c.mesh.get_aabb()
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
	var ctr := box.get_center()
	var r := maxf(box.size.x, maxf(box.size.y, box.size.z)) * 0.62
	var cam := Camera3D.new()
	cam.fov = 30.0
	cam.near = 0.01
	cam.far = 100.0
	vp.add_child(cam)
	cam.position = ctr + Vector3(r * 2.2, r * 1.4, r * 3.2)
	cam.look_at(ctr, Vector3.UP)
	cam.current = true
	return vp.get_texture()
