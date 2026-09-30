extends Node2D
## The minimap content (port of src/ui/Minimap.js): a tile-resolution
## terrain image (ground colours, relief shade, resources) under the fog of
## war mask, building footprints in their owner's colour, unit dots and the
## camera's view trapezoid. The node is placed at the diamond's centre and
## rotated by the camera yaw so the map reads as a diamond, like AoM; its
## local unit is one tile (the HUD scales it to the frame).
##
## Unit dots cost no script work per unit: one MultiMeshInstance2D whose
## shader reads position / owner / flags / type / selection from data
## textures made straight from the sim's packed arrays (minimap_units.gdshader).

const RES_RGB := {"tree": [30, 70, 26], "gold": [255, 214, 70], "berry": [214, 70, 88]}
const RES_WH := {"tree": 1, "gold": 3, "berry": 1}

var game: Node = null
var sim: Object = null
var N := 128
var px := 190.0              # frame size in HUD px
var show_terrain := true
var fog_on := false
var local_player := 1
var selected := {}           # id -> true (set by the UI)

var _base: Image
var _base_tex: ImageTexture
var _fog_tex: ImageTexture
var _fog_ver := -1
var _ground: Sprite2D
var _ground_mat: ShaderMaterial
var _units: MultiMeshInstance2D
var _units_mat: ShaderMaterial
var _cap := 0
var _tex := {}               # name -> ImageTexture (unit data)
var _overlay: Node2D
var _buildings := {}         # last get_buildings()
var _res_rects := {}         # resource id -> [tx, tz, w, h]
var _timer := 0.0
var _view := PackedVector2Array()
var _height_tex: ImageTexture
var _groundt: ImageTexture

class Overlay extends Node2D:
	var mm: Node2D
	func _draw() -> void:
		mm._draw_overlay(self)

func setup(g: Node) -> void:
	game = g
	sim = g.sim
	N = int(sim.get_map_size())
	var ws := float(N)
	position = Vector2.ZERO
	_ground = Sprite2D.new()
	_ground.centered = false
	_ground.position = Vector2(-ws, -ws) * 0.5
	_ground.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST  # the shader blends tiles itself
	_ground_mat = ShaderMaterial.new()
	_ground_mat.shader = preload("res://game/ui/minimap_ground.gdshader")
	_ground.material = _ground_mat
	add_child(_ground)
	_units = MultiMeshInstance2D.new()
	_units.position = Vector2(-ws, -ws) * 0.5
	_units_mat = ShaderMaterial.new()
	_units_mat.shader = preload("res://game/ui/minimap_units.gdshader")
	_units.material = _units_mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_2D
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	mm.mesh = q
	_units.multimesh = mm
	add_child(_units)
	_overlay = Overlay.new()
	_overlay.mm = self
	_overlay.position = Vector2(-ws, -ws) * 0.5
	add_child(_overlay)
	# player colours and myth sizes for the dot shader
	var cols := PackedVector3Array()
	cols.resize(8)
	for pid in sim.get_player_ids():
		if int(pid) < 8:
			var c := int(sim.get_player(pid).get("color", 0xffffff))
			cols[int(pid)] = Vector3(((c >> 16) & 255) / 255.0, ((c >> 8) & 255) / 255.0, (c & 255) / 255.0)
	_units_mat.set_shader_parameter("colors", cols)
	var big := PackedFloat32Array()
	big.resize(16)
	var names: PackedStringArray = sim.unit_type_names()
	for i in mini(16, names.size()):
		var d: Dictionary = sim.get_unit_def(names[i])
		big[i] = 1.0 if bool(d.get("myth", false)) else 0.0
	_units_mat.set_shader_parameter("big", big)
	_units_mat.set_shader_parameter("map_size", ws)
	_build_base()

## The terrain image (Minimap.groundTile + drawBase) is computed on the GPU
## by minimap_ground.gdshader from the sim's height / ground columns, so a
## new building (its plaza, streets and roads reach far past the footprint)
## costs two texture uploads instead of a script loop over every tile.
## Resources are a tile-res RGBA8 layer (the sprite's own texture) painted
## once and cleared per removed resource.
func _upload_terrain() -> void:
	var cols := int(sim.get_map_cols())
	var h: PackedInt32Array = sim.get_heights()
	# int32 little-endian bytes as RGBA8 (decoded in the shader)
	var himg := Image.create_from_data(cols, cols, false, Image.FORMAT_RGBA8, h.to_byte_array())
	var gimg := Image.create_from_data(cols, cols, false, Image.FORMAT_R8, sim.get_ground())
	if _height_tex == null or _height_tex.get_width() != cols:
		_height_tex = ImageTexture.create_from_image(himg)
		_groundt = ImageTexture.create_from_image(gimg)
		_ground_mat.set_shader_parameter("height_tex", _height_tex)
		_ground_mat.set_shader_parameter("ground_tex", _groundt)
	else:
		_height_tex.update(himg)
		_groundt.update(gimg)
	_ground_mat.set_shader_parameter("cps", cols / N)
	_ground_mat.set_shader_parameter("tiles", N)
	_ground_mat.set_shader_parameter("water", int(sim.get_water_level()))

func _build_base() -> void:
	_upload_terrain()
	_base = Image.create(N, N, false, Image.FORMAT_RGBA8)
	var r: Dictionary = sim.get_resources()
	var types: PackedStringArray = r.type_names
	var tile: PackedInt32Array = r.tile
	var ids: PackedInt32Array = r.ids
	var ty: PackedByteArray = r.type
	_res_rects.clear()
	for i in int(r.count):
		var k := types[ty[i]]
		if not RES_RGB.has(k):
			continue
		var c: Array = RES_RGB[k]
		var wh: int = RES_WH[k]
		var tx := tile[i * 2]
		var tz := tile[i * 2 + 1]
		_res_rects[ids[i]] = [tx, tz, wh, wh]
		_base.fill_rect(Rect2i(tx, tz, wh, wh).intersection(Rect2i(0, 0, N, N)), Color8(c[0], c[1], c[2]))
	if _base_tex == null:
		_base_tex = ImageTexture.create_from_image(_base)
		_ground.texture = _base_tex
		_ground_mat.set_shader_parameter("res_tex", _base_tex)
	else:
		_base_tex.update(_base)

## Sim events of this frame (resources removed, buildings placed).
func on_events(events: Array) -> void:
	var dirty := false
	var terrain := false
	for e in events:
		var t: String = e.type
		if t == "entity:removed" and _res_rects.has(e.id):
			var rr: Array = _res_rects[e.id]
			_res_rects.erase(e.id)
			_base.fill_rect(Rect2i(rr[0], rr[1], rr[2], rr[3]).intersection(Rect2i(0, 0, N, N)), Color(0, 0, 0, 0))
			dirty = true
		elif t == "building:placed":
			terrain = true
	if terrain:
		_upload_terrain()
	if dirty:
		_base_tex.update(_base)

func _data_tex(name: String, img: Image) -> void:
	var t: ImageTexture = _tex.get(name)
	if t == null or t.get_width() != img.get_width():
		t = ImageTexture.create_from_image(img)
		_tex[name] = t
		_units_mat.set_shader_parameter(name, t)
	else:
		t.update(img)

func _ensure_cap(n: int) -> void:
	var cap := 64
	while cap < n:
		cap *= 2
	if cap == _cap:
		return
	_cap = cap
	var mm := _units.multimesh
	mm.instance_count = cap
	var buf := PackedFloat32Array()
	buf.resize(cap * 8)
	for i in cap:
		buf[i * 8] = 1.0
		buf[i * 8 + 5] = 1.0
	mm.buffer = buf

## Refresh the dynamic layers (5 times a second, like the browser).
func refresh(dt: float, force := false) -> void:
	_timer -= dt
	if _timer > 0.0 and not force:
		return
	_timer = 0.2
	_ground_mat.set_shader_parameter("show_terrain", show_terrain)
	_ground_mat.set_shader_parameter("fog_on", fog_on)
	_units_mat.set_shader_parameter("fog_on", fog_on)
	_units_mat.set_shader_parameter("local_player", local_player)
	if fog_on:
		var fv := int(sim.fog_version())
		if fv != _fog_ver:
			_fog_ver = fv
			var img := Image.create_from_data(N, N, false, Image.FORMAT_L8, sim.get_fog())
			if _fog_tex == null:
				_fog_tex = ImageTexture.create_from_image(img)
				_ground_mat.set_shader_parameter("fog_tex", _fog_tex)
				_units_mat.set_shader_parameter("fog_tex", _fog_tex)
			else:
				_fog_tex.update(img)
	var u: Dictionary = sim.get_units()
	var n := int(u.count)
	_ensure_cap(n)
	var pos: PackedFloat32Array = u.pos
	pos.resize(_cap * 2)
	_data_tex("pos_tex", Image.create_from_data(_cap, 1, false, Image.FORMAT_RGF, pos.to_byte_array()))
	for key in ["owner", "flags", "type"]:
		var b: PackedByteArray = u[key]
		b.resize(_cap)
		_data_tex(key + "_tex", Image.create_from_data(_cap, 1, false, Image.FORMAT_R8, b))
	var sel := PackedByteArray()
	sel.resize(_cap)
	if not selected.is_empty():
		var ids: PackedInt32Array = u.ids
		for id in selected:
			var i := ids.bsearch(int(id))
			if i < n and ids[i] == int(id):
				sel[i] = 255
	_data_tex("sel_tex", Image.create_from_data(_cap, 1, false, Image.FORMAT_R8, sel))
	_units_mat.set_shader_parameter("count", n)
	_units.multimesh.visible_instance_count = _cap
	_buildings = sim.get_buildings()
	_overlay.queue_redraw()

func set_view(corners: PackedVector2Array) -> void:
	_view = corners
	_overlay.queue_redraw()

func _draw_overlay(ci: Node2D) -> void:
	if not _buildings.is_empty():
		var rect: PackedInt32Array = _buildings.rect
		var owner = _buildings.owner
		for i in int(_buildings.count):
			var o := int(owner[i])
			var tx := rect[i * 4]
			var tz := rect[i * 4 + 1]
			var w := rect[i * 4 + 2]
			var h := rect[i * 4 + 3]
			if fog_on and o != local_player and not sim.is_explored(tx + w * 0.5, tz + h * 0.5):
				continue
			ci.draw_rect(Rect2(tx - 0.5, tz - 0.5, w + 1, h + 1), Color(0, 0, 0, 0.55))  # JS .75, softened there by the canvas downscale
			ci.draw_rect(Rect2(tx, tz, w, h), _pcol(o))
	if _view.size() == 4:
		var k := float(N) / px  # one HUD px in tiles
		var pts := PackedVector2Array(_view)
		pts.push_back(_view[0])
		ci.draw_polyline(pts, Color(0, 0, 0, 0.5), 1.3 * k, true)  # AA feathers ~1 local unit (a tile): thinner than the JS 1.4 / 0.8 to match
		ci.draw_polyline(pts, Color(1, 1, 1, 0.95), 0.5 * k, true)

var _pcols := {}
func _pcol(o: int) -> Color:
	if not _pcols.has(o):
		var c := int(sim.get_player(o).get("color", 0xd8d0b0)) if o > 0 else 0xd8d0b0
		_pcols[o] = Color8((c >> 16) & 255, (c >> 8) & 255, c & 255)
	return _pcols[o]

## HUD-local point (relative to the diamond centre, in HUD px) -> world x/z,
## clamped onto the map (a click on the diamond's rim or its button ring can
## fall just outside it; the sim clamps orders too: PORTING.md "Map bounds").
func to_world(local: Vector2) -> Vector2:
	var r := local.rotated(-rotation)
	var w := (r / px + Vector2(0.5, 0.5)) * float(N)
	return w.clamp(Vector2.ZERO, Vector2(N - 0.01, N - 0.01))
