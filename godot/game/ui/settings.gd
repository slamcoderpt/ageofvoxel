extends RefCounted
## Player preferences kept between runs (user://settings.cfg): the browser's
## localStorage keys aov.quality and aov.perf. Captures and benches never read
## them (they pass --quality / run with --out), so frames stay reproducible.

const PATH := "user://settings.cfg"

static func read(section: String, key: String, default = null):
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		return default
	return cf.get_value(section, key, default)

static func write(section: String, key: String, value) -> void:
	var cf := ConfigFile.new()
	cf.load(PATH)  # missing file: start empty
	cf.set_value(section, key, value)
	cf.save(PATH)
