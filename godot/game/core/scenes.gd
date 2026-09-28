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
