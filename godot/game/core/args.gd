class_name AovArgs
extends RefCounted
## Command-line options (everything after "--"), mirroring the browser URL
## params:  godot --path godot -- --scene=town --seed=7 --out=shots/town.png
## Both "--key=value" and "--key value" work; a bare "--flag" is "1".

## Args for the next main-scene load, set by the main menu / match setup
## (game/menu/flow.gd) before it reloads game/main.tscn: when not empty,
## parse() returns a copy of it instead of the command line (so the result
## card's Play Again replays the same match).
static var override := {}

static func parse(argv: PackedStringArray = OS.get_cmdline_user_args()) -> Dictionary:
	if not override.is_empty():
		return override.duplicate(true)
	var out := {}
	# Web export: the page's query string, like the browser build
	# (index.html?scene=town&seed=7); command-line args still win.
	if OS.has_feature("web"):
		var q := str(JavaScriptBridge.eval("location.search", true))
		for pair in q.trim_prefix("?").split("&", false):
			var kv := pair.split("=", true, 1)
			out[kv[0].uri_decode()] = kv[1].uri_decode() if kv.size() > 1 else "1"
	var i := 0
	while i < argv.size():
		var a := argv[i]
		if a.begins_with("--"):
			a = a.substr(2)
			var eq := a.find("=")
			if eq >= 0:
				out[a.substr(0, eq)] = a.substr(eq + 1)
			elif i + 1 < argv.size() and not argv[i + 1].begins_with("--"):
				out[a] = argv[i + 1]
				i += 1
			else:
				out[a] = "1"
		i += 1
	return out

static func flag(args: Dictionary, key: String, default_value: bool) -> bool:
	if not args.has(key):
		return default_value
	var v := str(args[key])
	return v != "0" and v != "false"
