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

const GROUND_RGB := {
	0: [96, 150, 58], 6: [150, 160, 72], 1: [150, 115, 75], 2: [215, 196, 140],
	3: [140, 134, 124], 4: [200, 190, 165], 5: [110, 76, 46],
}
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
var _cols := [0, 0, 0]
var _heights := PackedInt32Array()
var _groundb := PackedByteArray()
var _water := 0

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
	_ground.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
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

## Terrain colour of one tile (Minimap.groundTile).
func _tile_rgb(tx: int, tz: int) -> Color:
	var cols: int = _cols[0]
	var cps: int = _cols[1]
	var cx := tx * cps
	var cz := tz * cps
	var l := _heights[cz * cols + cx]
	var rgb: Array
	if l < _water:
		rgb = [34, 90, 150] if l < _water - 2 else [60, 150, 170]
	else:
		rgb = GROUND_RGB.get(_groundb[cz * cols + cx], GROUND_RGB[0])
	var lw := l
	if tx > 0 and tz > 0:
		lw = _heights[(cz - cps) * cols + (cx - cps)]
	var shade := clampf((l - lw) * 0.09, -0.22, 0.22)
	var k := (0.84 + clampf((l - 4) * 0.03, -0.2, 0.25)) * (1.0 + shade)
	return Color(minf(1.0, rgb[0] * k / 255.0), minf(1.0, rgb[1] * k / 255.0), minf(1.0, rgb[2] * k / 255.0))

func _build_base() -> void:
	_heights = sim.get_heights()
	_groundb = sim.get_ground()
	_water = int(sim.get_water_level())
	var cols := int(sim.get_map_cols())
	_cols = [cols, cols / N, 0]
	_base = Image.create(N, N, false, Image.FORMAT_RGB8)
	for tz in N:
		for tx in N:
			_base.set_pixel(tx, tz, _tile_rgb(tx, tz))
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
	else:
		_base_tex.update(_base)

func _repaint(tx: int, tz: int, w: int, h: int) -> void:
	for z in range(maxi(0, tz), mini(N, tz + h)):
		for x in range(maxi(0, tx), mini(N, tx + w)):
			_base.set_pixel(x, z, _tile_rgb(x, z))

## Sim events of this frame (resources removed, buildings placed).
func on_events(events: Array) -> void:
	var dirty := false
	for e in events:
		var t: String = e.type
		if t == "entity:removed" and _res_rects.has(e.id):
			var rr: Array = _res_rects[e.id]
			_res_rects.erase(e.id)
			_repaint(rr[0], rr[1], rr[2], rr[3])
			dirty = true
		elif t == "building:placed":
			var b: Dictionary = sim.get_building(e.id)
			if not b.is_empty():
				_heights = sim.get_heights()
				_groundb = sim.get_ground()
				_repaint(int(b.tx) - 2, int(b.tz) - 2, int(b.w) + 4, int(b.h) + 4)
				dirty = true
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
			ci.draw_rect(Rect2(tx - 0.5, tz - 0.5, w + 1, h + 1), Color(0, 0, 0, 0.75))
			ci.draw_rect(Rect2(tx, tz, w, h), _pcol(o))
	if _view.size() == 4:
		var k := float(N) / px  # one HUD px in tiles
		var pts := PackedVector2Array(_view)
		pts.push_back(_view[0])
		ci.draw_polyline(pts, Color(0, 0, 0, 0.55), 2.1 * k, true)
		ci.draw_polyline(pts, Color(1, 1, 1, 0.95), 1.15 * k, true)

var _pcols := {}
func _pcol(o: int) -> Color:
	if not _pcols.has(o):
		var c := int(sim.get_player(o).get("color", 0xd8d0b0)) if o > 0 else 0xd8d0b0
		_pcols[o] = Color8((c >> 16) & 255, (c >> 8) & 255, c & 255)
	return _pcols[o]

## HUD-local point (relative to the diamond centre, in HUD px) -> world x/z.
func to_world(local: Vector2) -> Vector2:
	var r := local.rotated(-rotation)
	return (r / px + Vector2(0.5, 0.5)) * float(N)
