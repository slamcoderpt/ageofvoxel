class_name AovScenes
extends RefCounted
## Scene registry for the deterministic capture harness: the same scenes,
## presets, seeds and camera parameters as src/core/scenes/index.js (and
## src/combat/BattleScene.js, src/economy/EconomyScene.js,
## src/core/scenes/stress.js), so captures line up with
## reference/browser/<scene>.png.
##
## camera: {distance, pitch, yaw} in degrees like CameraController.setView;
## x/z come from the scene setup's focus (focus_dx/focus_dz are the offsets the
## JS scene adds to its focus). Until a piece implements the scene's setup, the
## focus falls back to the tile centre of player 1's start.
## A piece that owns a scene registers its setup with AovScenes.set_setup().

const DEFAULT_CAMERA := {"distance": 42.0, "pitch": 52.0, "yaw": 45.0}

static var SCENES := {
	"skirmish": {"preset": "skirmish", "seed": 3, "hud": true, "reveal_all": false, "ai": true, "live": true, "victory": true, "fast_forward": 0.0,
		"camera": {"distance": 44.0, "focus_dx": 2.0, "focus_dz": 4.0}},
	"town": {"preset": "skirmish", "seed": 7, "hud": false, "reveal_all": true, "fast_forward": 30.0,
		"camera": {"distance": 50.0, "pitch": 50.0, "focus_dx": 1.0, "focus_dz": 1.0}},
	"battle": {"preset": "battle", "seed": 11, "hud": false, "reveal_all": true, "fast_forward": 6.5,
		"camera": {"x": 64.6, "z": 63.8, "distance": 38.0, "pitch": 54.0}},
	"godpower": {"preset": "battle", "seed": 19, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"x": 61.0, "z": 63.0, "distance": 36.0, "pitch": 50.0}},
	"coast": {"preset": "coast", "seed": 5, "hud": false, "reveal_all": true, "fast_forward": 20.0,
		"camera": {"distance": 56.0, "pitch": 46.0, "yaw": 20.0}},
	"economy": {"preset": "skirmish", "seed": 3, "hud": false, "reveal_all": true, "ai": true, "fast_forward": 15.0,
		"camera": {"distance": 36.0, "yaw": 18.0}},
	"hud": {"preset": "skirmish", "seed": 7, "hud": true, "reveal_all": true, "fast_forward": 30.0,
		"camera": {"distance": 44.0, "focus_dx": 2.0, "focus_dz": 5.0}},
	"stress": {"preset": "stress", "seed": 23, "map_size": 256, "players": 6, "hud": true, "reveal_all": false, "ai": true, "live": true,
		"prof": true, "fast_forward": 0.0, "units": 2000,
		"camera": {"distance": 52.0, "pitch": 52.0}},
	# Godot-only: the main menu (game/menu): the coast town live behind the menu,
	# no AI, no HUD; the menu piece registers its setup and drives the camera.
	# skip_pieces: no in-game UI behind the menu (its hotkeys, F1 HUD, world
	# clicks), and the menu does not depend on game/ui/ui.gd loading.
	"menu": {"preset": "coast", "seed": 5, "hud": false, "reveal_all": true, "live": true, "fast_forward": 20.0,
		"skip_pieces": ["ui"],
		"camera": {"distance": 46.0, "pitch": 24.0, "yaw": 20.0}},
	# Godot-only: the skirmish match setup screen (game/menu/setup) over a small
	# still field (the screen is opaque); --players=2..6, --open=<picker>.
	"setup": {"preset": "battle", "seed": 1, "map_size": 96, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"screen": "res://game/menu/setup/setup.gd", "camera": {"distance": 40.0}},
	# Godot-only: Greek stone walls and gates (game/buildings/walls.gd): the town
	# scene's town in a wall ring, a gate open and one closed, construction and
	# damage; the camera looks along the south wall like reference/walls/walls_02.
	"walls": {"preset": "skirmish", "seed": 7, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 27.0, "pitch": 37.0, "yaw": 44.0}},
	# Godot-only: sim walls dragged at 0 / 22 / 45 / 67 degrees and across a
	# house (game/buildings/wall_angles_scene.gd): how diagonal walls read.
	"wall_angles": {"preset": "skirmish", "seed": 7, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 34.0, "pitch": 48.0, "yaw": 20.0}},
	# Godot-only: Greek towers (game/buildings/towers.gd, game/combat/tower_fire.gd):
	# the town with a row of towers at every upgrade stage, an enemy squad in
	# front of them under fire (the setup steps the sim until arrows fly).
	"towers": {"preset": "skirmish", "seed": 7, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 25.0, "pitch": 19.0, "yaw": -40.0}},
	# Godot-only: the Greek Armory and Market (game/buildings/tech_buildings.gd,
	# techbuildings_scene.gd): the town with both on cleared lots at its edge,
	# the camera close and high like reference/techs/building_01 / building_04.
	"techbuildings": {"preset": "skirmish", "seed": 7, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 17.0, "pitch": 45.0, "yaw": 22.0, "focus_dx": -0.3, "focus_dz": -1.2}},
	# Godot-only: an Egyptian (Ra, Mythic) player at play (sim/civ/egypt_scene.cpp):
	# Laborers at their drop sites, the Pharaoh empowering the Lumber Camp, the
	# Monuments, his army in ranks with Priests healing; a Greek player 2.
	"egypt": {"preset": "skirmish", "seed": 7, "hud": true, "reveal_all": true, "fast_forward": 4.0,
		"camera": {"distance": 40.0, "pitch": 48.0, "yaw": 25.0}},
	# Godot-only: Set's Animals of Set (sim/civ/egypt_scene.cpp): the age-ups' animals
	# at the Temple, the Pharaoh summoning, a Priest converting deer, Laborers
	# butchering a fallen Gazelle of Set.
	"egypt_set": {"preset": "skirmish", "seed": 7, "hud": true, "reveal_all": true, "fast_forward": 5.0,
		"camera": {"distance": 20.0, "pitch": 50.0, "yaw": 20.0}},
	# Godot-only: an Egyptian town with every Egyptian building on desert ground
	# (game/buildings/egypt_town_scene.gd, egypt_buildings.gd); egt_focus=<type>
	# frames one building like reference/egypt/building_02..21.
	"egypt_town": {"preset": "battle", "seed": 1, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 64.0, "pitch": 50.0, "yaw": 30.0}},
	# Godot-only: the Egyptian units and myth units (game/units/egypt_units_scene.gd,
	# models by scripts/export-egypt-units.mjs): a lineup, eu_group=foot | mounted |
	# myth | battle | eco, eu_focus=<type> frames four of one type like reference/egypt/unit_05.
	"egypt_units": {"preset": "battle", "seed": 1, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 30.0, "pitch": 46.0, "yaw": 28.0}},
	# Godot-only: one Egyptian god power mid-cast (game/godpowers/egypt_powers_scene.gd):
	# power=rain | prosperity | vision | eclipse | shifting_sands | plague_of_serpents |
	# locust_swarm | citadel | ancestors | son_of_osiris | tornado | thoth_meteor, t=seconds in.
	"egypt_powers": {"preset": "battle", "seed": 1, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 40.0, "pitch": 46.0, "yaw": 24.0}},
	# Godot-only: the research panel (game/ui/ui.gd _techui_setup): a selected
	# Armory with its tech buttons, the research queue and a tech tooltip open
	# (techui_sel=market | temple, techui_tip=<slot>).
	"techui": {"preset": "skirmish", "seed": 7, "hud": true, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 30.0, "pitch": 48.0, "yaw": 30.0, "focus_dz": 3.0}},
	# Godot-only: the enemy AI's own fortifications (game/core/aifort_scene.gd):
	# two AIs play aifort_t minutes in the setup (walls, gates, towers, breaches).
	"aifort": {"preset": "skirmish", "seed": 2, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 46.0, "pitch": 50.0, "yaw": 30.0}},
	# Godot-only: every exported model on a flat strip (checks scripts/export-models.mjs).
	"models": {"preset": "battle", "seed": 1, "map_size": 96, "hud": false, "reveal_all": true, "fast_forward": 0.0,
		"camera": {"distance": 34.0, "pitch": 38.0, "yaw": 0.0}},
}

## name -> Callable(game) -> Dictionary ctx (may contain "focus": Vector2 in world x/z)
static var _setups := {}

static func names() -> Array:
	return SCENES.keys()

static func get_def(scene_name: String) -> Dictionary:
	if not SCENES.has(scene_name):
		return {}
	var d: Dictionary = SCENES[scene_name].duplicate(true)
	d["name"] = scene_name
	d.merge({"map_size": 128, "players": 2, "hud": false, "reveal_all": false, "ai": false, "live": false,
		"victory": false, "prof": false, "fast_forward": 0.0}, false)
	return d

static func set_setup(scene_name: String, fn: Callable) -> void:
	_setups[scene_name] = fn

static func get_setup(scene_name: String) -> Callable:
	return _setups.get(scene_name, Callable())
