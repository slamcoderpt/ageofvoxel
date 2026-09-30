extends RefCounted
## Screen flow between the main menu, the match setup and a match. Every
## switch reloads game/main.tscn with new args (AovArgs.override), so a match
## started from the menu is built exactly like one from the command line:
##
##   Flow.start_match({"seed": 9, "players": 3, ...})   # --scene=skirmish + opts
##   Flow.to_main_menu(tree)                             # back to --scene=menu
##
## The match setup screen (another piece) is found by path: the first script
## of SETUP_SCREENS that exists is instanced by the menu's Skirmish tile as a
## Control over the menu (see game/menu/menu.gd "Setup screen contract").
## Without one, Skirmish starts the default skirmish directly.

const SETUP_SCREENS := [
	"res://game/setup/setup.gd",
	"res://game/setup/skirmish_setup.gd",
	"res://game/menu/setup/setup.gd",
	"res://game/lobby/lobby.gd",
]

static func setup_screen_path() -> String:
	for p in SETUP_SCREENS:
		if ResourceLoader.exists(p):
			return p
	return ""

## Start a match: `opts` are main.gd args (seed, players, mapsize, ...), the
## scene defaults to "skirmish".
static func start_match(tree: SceneTree, opts := {}) -> void:
	var a := {"scene": "skirmish"}
	a.merge(opts, true)
	for k in a:
		a[k] = str(a[k])
	_go(tree, a)

static func to_main_menu(tree: SceneTree) -> void:
	_go(tree, {"scene": "menu"})

static func _go(tree: SceneTree, a: Dictionary) -> void:
	# keep the process-level options of this run (quality, fps, window size)
	var keep := AovArgs.parse()
	for k in ["quality", "post", "fps", "width", "height"]:
		if keep.has(k) and not a.has(k):
			a[k] = keep[k]
	AovArgs.override = a
	tree.change_scene_to_file("res://game/main.tscn")
