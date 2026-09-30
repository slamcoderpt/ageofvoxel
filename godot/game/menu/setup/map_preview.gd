extends RefCounted
## Map preview for the setup screen: runs the real map generator
## (AovSim.new_game with the chosen preset / seed / size / player count) and
## paints the result top-down, one pixel per tile, with the minimap's colours
## (game/ui/minimap_ground.gdshader: water deep / shallow, ground types,
## height brightness and a relief shade) and the resource spawns (trees, gold,
## berries). Returns {tex, starts: [Vector2 in 0..1], size, preset}.

static var _cache := {}

static func ground_rgb(g: int) -> Vector3:
	match g:
		6: return Vector3(150, 160, 72)
		1: return Vector3(150, 115, 75)
		2: return Vector3(215, 196, 140)
		3: return Vector3(140, 134, 124)
		4: return Vector3(200, 190, 165)
		5: return Vector3(110, 76, 46)
	return Vector3(96, 150, 58)

static func build(preset: String, seed: int, size: int, players: int) -> Dictionary:
	var key := "%s/%d/%d/%d" % [preset, seed, size, players]
	if _cache.has(key):
		return _cache[key]
	if not ClassDB.class_exists("AovSim"):
		return {}
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.new_game(seed, size, preset, players)
	var cols: int = sim.get_map_cols()
	var cps: int = cols / size
	var hts: PackedInt32Array = sim.get_heights()
	var gr: PackedByteArray = sim.get_ground()
	var wl: int = sim.get_water_level()
	var data := PackedByteArray()
	data.resize(size * size * 3)
	for tz in size:
		for tx in size:
			var c := tz * cps * cols + tx * cps
			var l := hts[c]
			var rgb: Vector3
			if l < wl:
				rgb = Vector3(34, 90, 150) if l < wl - 2 else Vector3(60, 150, 170)
			else:
				rgb = ground_rgb(gr[c])
			var lw := hts[c - cps * cols - cps] if tx > 0 and tz > 0 else l
			var shade := clampf(float(l - lw) * 0.09, -0.22, 0.22)
			var k := (0.84 + clampf(float(l - 4) * 0.03, -0.2, 0.25)) * (1.0 + shade)
			var i := (tz * size + tx) * 3
			data[i] = mini(255, int(rgb.x * k))
			data[i + 1] = mini(255, int(rgb.y * k))
			data[i + 2] = mini(255, int(rgb.z * k))
	for r in sim.get_resource_spawns():
		var col: Vector3
		var w := 1
		match str(r.type):
			"tree": col = Vector3(30, 72, 34)
			"gold":
				col = Vector3(236, 196, 72)
				w = 3
			"berry": col = Vector3(196, 70, 96)
			_: continue
		for dz in w:
			for dx in w:
				var x: int = int(r.tx) + dx
				var z: int = int(r.tz) + dz
				if x < 0 or z < 0 or x >= size or z >= size:
					continue
				var i := (z * size + x) * 3
				data[i] = int(col.x)
				data[i + 1] = int(col.y)
				data[i + 2] = int(col.z)
	var img := Image.create_from_data(size, size, false, Image.FORMAT_RGB8, data)
	# upscale smoothly so the frame shows soft relief, not hard tile steps
	img.resize(size * 3, size * 3, Image.INTERPOLATE_CUBIC)
	var starts := []
	for s in sim.get_starts():
		starts.append(Vector2((float(s.tx) + 0.5) / size, (float(s.tz) + 0.5) / size))
	var out := {"tex": ImageTexture.create_from_image(img), "starts": starts, "size": size, "preset": preset}
	if _cache.size() > 24:
		_cache.clear()
	_cache[key] = out
	return out
