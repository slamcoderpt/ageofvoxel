extends Node3D
## Terrain piece: port of src/terrain (TerrainMesh.js, Water.js,
## GroundDetails.js, ResourceRenderer.js).
##
## Heightfield: chunks of CHUNK x CHUNK terrain columns meshed in C++ by
## AovSim.build_terrain_mesh() (native/src/terrain_mesher.cpp: palette.js
## colours, per-vertex AO, smoothed shore / seabed, talus, cliff relief, rock
## outcrops), rebuilt only where AovSim.take_map_changes() reports edits.
## Ground details: per chunk, one MultiMesh per detail model from
## AovSim.build_ground_details() (buffers ready to upload), rebuilt with the chunk.
## Water: a ws*5 plane centred on the map (Water.js) with water.gdshader, fed a
## depth texture baked from the smoothed seabed (AovSim.get_water_depth()).
## Resources: one MultiMesh per (model, 16x16-tile bucket) like
## ResourceRenderer.js, with the JS per-tree scale / tint and a shadow-only
## twin on the lighter `_shape` mesh; only buckets whose content changed are
## rebuilt (entity events of kind 3 in game.events, map edits under them).
##
## Public API: `terrain_material` (ShaderMaterial of every chunk: terrain.gdshader,
## uniforms pave*, pale, sand*), `water_material` (water.gdshader),
## `refresh_water_depth()`.

const VOXEL := 0.5
const CHUNK := 32        # columns per chunk side (16 tiles), as TerrainMesh.js
const RES_BUCKET := 64   # tiles per resource bucket side (JS: 16; fewer draw calls here)
const DET_REGION := 4    # ground details are batched per 4x4 terrain chunks (fewer draw calls)
const DETAIL_NAMES := ["tuft0", "tuft1", "tuft2", "tuft3", "tuft4",
	"flowers0", "flowers1", "flowers2", "flowers3", "pebbles0", "pebbles1", "pebbles2"]

var game: Node = null
var water_material: ShaderMaterial
var _chunks := {}          # Vector2i -> MeshInstance3D
var _details := {}         # region Vector2i -> Array[MultiMeshInstance3D]
var _details_dirty := {}   # region Vector2i -> true
var _building_all := false
var terrain_material: ShaderMaterial
var _prop_material: ShaderMaterial
var _res_root: Node3D
var _det_root: Node3D
var _res_nodes := {}       # bucket key -> [MultiMeshInstance3D visual, shadow]
var _res_sig := {}         # bucket key -> PackedInt32Array of ids
var _res_force := {}       # bucket key -> true (terrain under it changed)
var _water: MeshInstance3D
var _depth_tex: ImageTexture

func setup(g: Node) -> void:
	game = g
	# linear vertex colours (JS toLin) + paving / pale-stone breakup (terrain.gdshader)
	terrain_material = ShaderMaterial.new()
	terrain_material.shader = preload("res://game/terrain/terrain.gdshader")
	_prop_material = ShaderMaterial.new()
	_prop_material.shader = preload("res://game/terrain/props.gdshader")
	var t0 := Time.get_ticks_msec()
	var C: int = game.sim.get_map_cols()
	var n := ceili(float(C) / CHUNK)
	_det_root = Node3D.new()
	_det_root.name = "GroundDetails"
	add_child(_det_root)
	_building_all = true
	for cz in n:
		for cx in n:
			_build_chunk(Vector2i(cx, cz))
	_building_all = false
	var nr := ceili(float(n) / DET_REGION)
	for rz in nr:
		for rx in nr:
			_build_details(Vector2i(rx, rz))
	game.sim.take_map_changes()  # the initial map is fully built
	var t1 := Time.get_ticks_msec()
	_build_water()
	_res_root = Node3D.new()
	_res_root.name = "Resources"
	add_child(_res_root)
	_sync_resources()
	print("terrain: %d chunks (%dx%d columns) + details in %d ms, water + resources %d ms (%d detail, %d resource MultiMeshes)" % [
		n * n, C, C, t1 - t0, Time.get_ticks_msec() - t1, _det_root.get_child_count(), _res_root.get_child_count()])

func frame(_dt: float, _alpha: float) -> void:
	var rects: PackedInt32Array = game.sim.take_map_changes()
	var res_dirty := false
	if not rects.is_empty():
		var dirty := {}
		for i in range(0, rects.size(), 4):
			# the smoothed shore, AO, talus and walls reach 3 columns out (markDirtyCols)
			for cz in range(floori((rects[i + 1] - 3) / float(CHUNK)), floori((rects[i + 3] + 3) / float(CHUNK)) + 1):
				for cx in range(floori((rects[i] - 3) / float(CHUNK)), floori((rects[i + 2] + 3) / float(CHUNK)) + 1):
					dirty[Vector2i(cx, cz)] = true
			# props sitting on changed terrain need their height refreshed
			var cps := 2
			var tx0 := floori(rects[i] / float(cps)) - 1
			var tz0 := floori(rects[i + 1] / float(cps)) - 1
			var tx1 := floori((rects[i + 2] - 1) / float(cps)) + 1
			var tz1 := floori((rects[i + 3] - 1) / float(cps)) + 1
			for bz in range(floori(tz0 / float(RES_BUCKET)), floori(tz1 / float(RES_BUCKET)) + 1):
				for bx in range(floori(tx0 / float(RES_BUCKET)), floori(tx1 / float(RES_BUCKET)) + 1):
					_res_force["%d|%d" % [bx, bz]] = true
			res_dirty = true
		for k in dirty:
			_build_chunk(k)
		for k in _details_dirty:
			_build_details(k)
		_details_dirty.clear()
		if _depth_tex:
			refresh_water_depth()
	if not res_dirty:
		for e in game.events:
			if int(e.kind) == 3 and (e.type == "entity:added" or e.type == "entity:removed"):
				res_dirty = true
				break
	if res_dirty:
		_sync_resources()
	if water_material:
		water_material.set_shader_parameter("u_time", float(game.sim.get_time()))

# --- heightfield + ground details ------------------------------------------

func _build_chunk(k: Vector2i) -> void:
	var C: int = game.sim.get_map_cols()
	if k.x < 0 or k.y < 0 or k.x * CHUNK >= C or k.y * CHUNK >= C:
		return
	var x0 := k.x * CHUNK
	var z0 := k.y * CHUNK
	var arrays: Array = game.sim.build_terrain_mesh(x0, z0, x0 + CHUNK, z0 + CHUNK)
	var mi: MeshInstance3D = _chunks.get(k)
	if mi == null:
		mi = MeshInstance3D.new()
		mi.name = "Chunk_%d_%d" % [k.x, k.y]
		mi.material_override = terrain_material
		add_child(mi)
		_chunks[k] = mi
	if arrays[Mesh.ARRAY_VERTEX] == null:
		mi.mesh = null
	else:
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mi.mesh = am
	if not _building_all:
		_details_dirty[Vector2i(floori(k.x / float(DET_REGION)), floori(k.y / float(DET_REGION)))] = true

func _build_details(k: Vector2i) -> void:
	for old in _details.get(k, []):
		old.queue_free()
	var R := CHUNK * DET_REGION
	var lists: Array = game.sim.build_ground_details(k.x * R, k.y * R, (k.x + 1) * R, (k.y + 1) * R)
	var nodes := []
	for m in lists.size():
		var buf: PackedFloat32Array = lists[m]
		if buf.is_empty():
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = VoxelModels.mesh("details", DETAIL_NAMES[m])
		mm.instance_count = buf.size() / 16
		mm.buffer = buf
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Det_%d_%d_%s" % [k.x, k.y, DETAIL_NAMES[m]]
		mmi.multimesh = mm
		mmi.material_override = _prop_material
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_det_root.add_child(mmi)
		nodes.append(mmi)
	_details[k] = nodes

# --- water ------------------------------------------------------------------

func _build_water() -> void:
	var ws: float = game.sim.get_map_size()
	_water = MeshInstance3D.new()
	_water.name = "Water"
	var pm := PlaneMesh.new()
	# the sea runs far past the map rim, as in src/terrain/Water.js (ws * 5, centred)
	pm.size = Vector2(ws * 5.0, ws * 5.0)
	pm.subdivide_width = 199
	pm.subdivide_depth = 199
	_water.mesh = pm
	_water.position = Vector3(ws / 2, (game.sim.get_water_level() - 0.3) * VOXEL, ws / 2)
	_water.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	water_material = ShaderMaterial.new()
	water_material.shader = preload("res://game/terrain/water.gdshader")
	water_material.render_priority = 1
	water_material.set_shader_parameter("world_size", ws)
	water_material.set_shader_parameter("sun_dir", _sun_dir())
	# AgX tone mapping darkens the (untonemapped in the browser) water ~7 %
	water_material.set_shader_parameter("out_gain", 1.07)
	_water.material_override = water_material
	refresh_water_depth()
	add_child(_water)

## Re-bake the depth texture from the smoothed seabed (after map edits).
func refresh_water_depth() -> void:
	var C: int = game.sim.get_map_cols()
	var img := Image.create_from_data(C, C, false, Image.FORMAT_R8, game.sim.get_water_depth())
	if _depth_tex == null:
		_depth_tex = ImageTexture.create_from_image(img)
		water_material.set_shader_parameter("depth_tex", _depth_tex)
	else:
		_depth_tex.update(img)

func _sun_dir() -> Vector3:
	var lighting: Node = game.pieces.get("lighting")
	if lighting and lighting.get_script():
		var consts: Dictionary = lighting.get_script().get_script_constant_map()
		if consts.has("SUN_DIR"):
			return (consts.SUN_DIR as Vector3).normalized()
	return Vector3(-0.6, 0.47, 0.4).normalized()

# --- resources (ResourceRenderer.js) ---------------------------------------

## hash2 of src/core/rng.js (bit-exact: 64-bit ints hold the JS doubles exactly).
static func hash2(x: int, y: int, s: int = 0) -> float:
	var h := (x * 374761393 + y * 668265263 + s * 2147483647) & 0xffffffff
	h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
	h ^= h >> 16
	return float(h) / 4294967296.0

func _sync_resources() -> void:
	var sim: Object = game.sim
	var R: Dictionary = sim.get_resources()
	var names: PackedStringArray = R.type_names
	var types: PackedByteArray = R.type
	var tiles: PackedInt32Array = R.tile
	var variants: PackedInt32Array = R.variant
	var ids: PackedInt32Array = R.ids
	var rows := {}   # key -> PackedInt32Array of row indices
	var sigs := {}   # key -> PackedInt32Array of ids
	for i in int(R.count):
		var type := names[types[i]]
		if type != "tree" and type != "gold" and type != "berry":
			continue  # huntable animals are resources too: game/economy draws them
		var model: String = "tree%d" % (variants[i] % 10) if type == "tree" else type
		var key := "%s|%d|%d" % [model, floori(tiles[i * 2] / float(RES_BUCKET)), floori(tiles[i * 2 + 1] / float(RES_BUCKET))]
		if not rows.has(key):
			rows[key] = PackedInt32Array()
			sigs[key] = PackedInt32Array()
		rows[key].append(i)
		sigs[key].append(ids[i])
	for key in _res_nodes.keys():
		if not rows.has(key):
			for nd in _res_nodes[key]:
				nd.queue_free()
			_res_nodes.erase(key)
			_res_sig.erase(key)
	for key in rows:
		var parts: PackedStringArray = key.split("|")
		var forced := _res_force.has(parts[1] + "|" + parts[2])
		if not forced and _res_sig.has(key) and _res_sig[key] == sigs[key]:
			continue
		_res_sig[key] = sigs[key]
		_build_bucket(key, parts[0], rows[key], R)
	_res_force.clear()

func _build_bucket(key: String, model: String, rows: PackedInt32Array, R: Dictionary) -> void:
	var sim: Object = game.sim
	var tiles: PackedInt32Array = R.tile
	var is_tree := model.begins_with("tree")
	var size := 3.0 if model == "gold" else 1.0
	var buf := PackedFloat32Array()
	buf.resize(rows.size() * 16)
	var o := 0
	for i in rows:
		var tx := tiles[i * 2]
		var tz := tiles[i * 2 + 1]
		var x := tx + size / 2
		var z := tz + size / 2
		var rot := 0.0 if model == "gold" else floorf(hash2(tx, tz, 77) * 4.0) * PI / 2
		var sc := 0.85 + hash2(tx, tz, 5) * 0.35 if is_tree else 1.0
		var sy := sc * (0.9 + hash2(tx, tz, 9) * 0.2)
		var co := cos(rot)
		var si := sin(rot)
		var t := 0.88 + hash2(tx, tz, 13) * 0.24 if is_tree else 1.0
		var y: float = sim.height_at(x, z) - 0.05
		var m := [co * sc, 0.0, si * sc, x, 0.0, sy, 0.0, y, -si * sc, 0.0, co * sc, z,
			t, t * (0.97 + hash2(tx, tz, 3) * 0.06), t * 0.95, 1.0]
		for v in m:
			buf[o] = v
			o += 1
	var nodes: Array = _res_nodes.get(key, [])
	if nodes.is_empty():
		for shadow in [false, true]:
			var mmi := MultiMeshInstance3D.new()
			mmi.name = ("ResShadow_" if shadow else "Res_") + key.replace("|", "_")
			mmi.material_override = _prop_material
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if shadow \
				else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_res_root.add_child(mmi)
			nodes.append(mmi)
		_res_nodes[key] = nodes
	for s in 2:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = VoxelModels.mesh("resources", model + ("_shape" if s == 1 else ""))
		mm.instance_count = rows.size()
		mm.buffer = buf
		nodes[s].multimesh = mm
