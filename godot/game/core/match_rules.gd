extends RefCounted
## Match rules plumbing: the setup screen's match-settings Dictionary
## (game/menu/setup/match_settings.gd, handed to main.gd as the `match`
## arg, JSON) -> the sim's match setup (AovSim.setup_match, sim/match).
##
##   var m := MatchRules.settings(game.args)   # {} for a run without a match
##   MatchRules.preset(m), MatchRules.player_count(m)   # for AovSim.new_game
##   var ctx := MatchRules.apply(game.sim, m)            # after new_game + the pieces' setup
##
## sim_config(m) is the Dictionary AovSim.setup_match / start_match take:
## {seed, map_size, preset, resources, villagers, players: [{id, name, human,
## ai ("easy" | "moderate" | "hard" | "titan"), team (0 = his own: free for
## all), color (0xRRGGBB), god}]}. Game speed and visibility stay main.gd's
## (`timescale`, `fog` args, which to_args() sets too).

const SETTINGS_SCRIPT := "res://game/menu/setup/match_settings.gd"
## The setup screen's colour table (M.COLORS), in case it is missing.
const COLORS := [0x000000, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818, 0x2fc8d8, 0xe860b0]

## The match settings of a run (main.gd args), or {}.
static func settings(args: Dictionary) -> Dictionary:
	if not args.has("match"):
		return {}
	var v = args.match if typeof(args.match) == TYPE_DICTIONARY else JSON.parse_string(str(args.match))
	if typeof(v) != TYPE_DICTIONARY or not v.has("players"):
		return {}
	return v

static func preset(m: Dictionary, fallback := "skirmish") -> String:
	return str(m.get("preset", fallback))

static func player_count(m: Dictionary) -> int:
	return clampi((m.get("players", []) as Array).size(), 2, 6)

static func _colors() -> Array:
	if ResourceLoader.exists(SETTINGS_SCRIPT):
		var M: Script = load(SETTINGS_SCRIPT)
		if "COLORS" in M:
			return M.COLORS
	return COLORS

## setup_match's Dictionary for a match-settings Dictionary.
static func sim_config(m: Dictionary) -> Dictionary:
	var cols := _colors()
	var ffa := bool(m.get("free_for_all", false))
	var ps := []
	var list: Array = m.get("players", [])
	for i in list.size():
		var p: Dictionary = list[i]
		var ci := int(p.get("color", i + 1))
		ps.append({
			"id": int(p.get("id", i + 1)),
			"name": str(p.get("name", "")),
			"human": bool(p.get("human", i == 0)),
			"ai": str(p.get("ai", "moderate")) if str(p.get("ai", "")) != "" else "moderate",
			"team": 0 if ffa else int(p.get("team", 0)),
			"color": int(cols[clampi(ci, 1, cols.size() - 1)]),
			"god": str(p.get("god", "zeus")),
		})
	return {"seed": int(m.get("seed", 1)), "map_size": int(m.get("map_size", 128)), "preset": preset(m),
		"resources": str(m.get("resources", "standard")), "villagers": int(m.get("villagers", 5)), "players": ps}

## Seat the players on the map (the sim is already at new_game with this
## preset and player count): returns main.gd's scene ctx {focus, match}.
static func apply(sim: Object, m: Dictionary) -> Dictionary:
	var r: Dictionary = sim.setup_match(sim_config(m))
	if not bool(r.ok):
		push_error("match setup failed: %s" % r.error)
		return {}
	return {"focus": r.focus, "match": r}
