extends Node
## Unit and building portraits for the HUD (port of src/core/portrait.js +
## units.portraitObject / ui.buildingObject): each (kind, type, owner) is
## rendered once into its own SubViewport (own world, transparent, MSAA)
## with a hemisphere-ish key / fill light and the JS framing (fov 30, camera
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
	var key := "b:%s:%d" % [type, owner]
	if not _cache.has(key):
		var mi := MeshInstance3D.new()
		mi.mesh = VoxelModels.mesh("buildings", "%s/0" % type)
		mi.material_override = VoxelModels.team_material(player_color(owner))
		var root := Node3D.new()
		root.add_child(mi)
		_cache[key] = _render(root)
	return _cache[key]

func _unit_object(type: String, owner: int) -> Node3D:
	var root := Node3D.new()
	var rig := VoxelModels.rig(type)
	if rig.is_empty():
		return root
	var v := float(rig.voxel)
	var mat := VoxelModels.team_material(player_color(owner))
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
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	# HemisphereLight(0xdfeaff, 0x5a4a30, 2.2): the average of sky and ground
	e.ambient_light_color = Color("#9ea4a0")
	e.ambient_light_energy = 0.85
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = 1.05
	env.environment = e
	vp.add_child(env)
	vp.add_child(obj)
	# bounds of the object
	var box := AABB()
	var first := true
	for c in obj.get_children():
		if c is MeshInstance3D and c.mesh:
			var b: AABB = c.transform * c.mesh.get_aabb()
			box = b if first else box.merge(b)
			first = false
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
	var sun := DirectionalLight3D.new()
	sun.light_color = Color("#fff0d0")
	sun.light_energy = 1.55
	vp.add_child(sun)
	sun.look_at_from_position(ctr + Vector3(3, 5, 4), ctr, Vector3.UP)
	var sky := DirectionalLight3D.new()  # the hemisphere's sky half, from above-front
	sky.light_color = Color("#dfeaff")
	sky.light_energy = 0.45
	vp.add_child(sky)
	sky.look_at_from_position(ctr + Vector3(-2, 4, 1), ctr, Vector3.UP)
	var rim := DirectionalLight3D.new()  # a cool back light so the figure lifts off the teal
	rim.light_color = Color("#bfe6ff")
	rim.light_energy = 0.7
	vp.add_child(rim)
	rim.look_at_from_position(ctr + Vector3(-3, 2, -4), ctr, Vector3.UP)
	return vp.get_texture()
