extends RefCounted
## Match settings: the one Dictionary the skirmish setup screen
## (game/menu/setup/setup.gd) writes and the match rules consume. Shape
## (documented in PORTING.md, "Match settings"):
##
##   {
##     "version": 1,
##     "game_type": "standard",
##     "victory": "conquest",
##     "map": "aegean_hills",         # key of MAPS (or "random": rolled by roll())
##     "preset": "skirmish",          # MAPS[map].preset: the generator preset for AovSim.new_game
##     "seed": 3,                     # map seed (AovSim.new_game)
##     "map_size": 128,               # tiles per side (AovSim.new_game)
##     "visibility": "standard",      # "standard" (fog of war) | "revealed"
##     "resources": "standard",       # key of RESOURCES: starting stockpile
##     "speed": 1.0,                  # game time scale (main.gd time_scale)
##     "free_for_all": false,         # true: every player on his own team (teams ignored)
##     "lock_teams": false,           # UI only: the team pickers are locked
##     "players": [                   # 2..6 entries, index 0 = owner 1 = the human
##       {"id": 1, "name": "You", "human": true, "ai": "", "god": "zeus",
##        "color": 1, "team": 1},
##       {"id": 2, "name": "Pericles", "human": false, "ai": "moderate", "god": "zeus",
##        "color": 2, "team": 2},
##       ...
##     ]
##   }
##
## color = index into COLORS (1..8); team = 1..6 (0 = none); ai = key of
## DIFFICULTIES. The sim's player ids are the array order (owner 1..6), so
## start i of the generator is players[i].
##
## Hand-off: Play calls menu.start_match(to_args(settings)) (game/menu/flow.gd:
## main.tscn reloads with those args): main.gd's own args for what it already
## honours (seed, mapsize, players, timescale, fog) plus `match` = this
## Dictionary as JSON for the rules (from_args() reads it back).

## The settings of the last Play (the screen reopens with them).
static var last := {}

const VERSION := 1
const MAX_PLAYERS := 6

## Maps: the generator presets under their skirmish names. Which player counts
## a map takes is asked of the generator itself (starts_for), so a preset that
## learns to place more starts unlocks them here without an edit.
const MAPS := {
	"aegean_hills": {"name": "Aegean Hills", "preset": "skirmish",
		"blurb": "Rolling hills, forests and hidden lakes. A classic land map."},
	"ionian_coast": {"name": "Ionian Coast", "preset": "coast",
		"blurb": "A long shoreline with open sea to the east: fish, docks and a narrow land front."},
	"marathon": {"name": "Marathon", "preset": "battle",
		"blurb": "A flat open plain with a clear centre. Armies meet early."},
	"circle_of_poleis": {"name": "Circle of Poleis", "preset": "stress",
		"blurb": "City-states on a ring round a wide plain. Built for two to six players."},
}
const MAP_ORDER := ["aegean_hills", "ionian_coast", "marathon", "circle_of_poleis"]

const SIZES := [
	{"key": 96, "name": "Small"},
	{"key": 128, "name": "Standard"},
	{"key": 160, "name": "Large"},
	{"key": 192, "name": "Huge"},
	{"key": 256, "name": "Giant"},
]

## Starting stockpile per player ({} = the game's default, 300 / 300 / 200 / 20).
const RESOURCES := [
	{"key": "low", "name": "Low", "res": {"food": 150, "wood": 150, "gold": 100, "favor": 0}},
	{"key": "standard", "name": "Standard", "res": {}},
	{"key": "high", "name": "High", "res": {"food": 1000, "wood": 1000, "gold": 750, "favor": 50}},
	{"key": "deathmatch", "name": "Deathmatch", "res": {"food": 10000, "wood": 10000, "gold": 10000, "favor": 100}},
]

const SPEEDS := [
	{"key": 0.75, "name": "Slow"},
	{"key": 1.0, "name": "Standard"},
	{"key": 1.5, "name": "Fast"},
	{"key": 2.0, "name": "Very Fast"},
]

const VISIBILITY := [
	{"key": "standard", "name": "Standard"},
	{"key": "revealed", "name": "Revealed"},
]

## AI difficulty. `ai` is a hint for the rules piece in AovSim.set_ai terms
## (wave_size, aggression); "moderate" is the game's current AI unchanged.
const DIFFICULTIES := [
	{"key": "easy", "name": "Easy", "ai": {"wave_size": 5, "aggression": 0.6}},
	{"key": "moderate", "name": "Moderate", "ai": {}},
	{"key": "hard", "name": "Hard", "ai": {"wave_size": 10, "aggression": 1.3}},
	{"key": "titan", "name": "Titan", "ai": {"wave_size": 14, "aggression": 1.7}},
]

## Player colours: 1..6 are the sim's PLAYER_COLORS for owners 1..6.
const COLORS := [0x000000, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818, 0x2fc8d8, 0xe860b0]

## Major gods. Zeus (Greeks) and Ra, Isis, Set (Egyptians: the sim's civ per
## player follows the god, PORTING.md "Civilizations"); Hades and Poseidon are
## listed locked. "focus" / "lines": the card's text (Retold's, EGYPT.md 4);
## "powers": the god powers he has from the start (the Egyptians' minor gods
## add one per age: game/ui/egypt_icons.gd OFFERED / the sim's minor_gods_of).
const GODS := {
	"zeus": {"name": "Zeus", "title": "King of the Olympian Gods", "culture": "Greeks", "available": true,
		"powers": ["lightning_storm", "bolt", "meteor"],
		"lines": ["Starts with the Greek town: Town Center, houses, temple, barracks.",
			"Villagers worship at the temple for Favor, the price of god powers.",
			"Three god powers, each with its own cooldown (listed on the right)."]},
	"hades": {"name": "Hades", "title": "God of the Underworld", "culture": "Greeks", "available": false},
	"poseidon": {"name": "Poseidon", "title": "God of the Sea", "culture": "Greeks", "available": false},
	"ra": {"name": "Ra", "title": "God of the Sun", "culture": "Egyptians", "available": true,
		"powers": ["rain"], "focus": "Focus: Migdol Stronghold units and empowerment.",
		"lines": ["Mandjet: a Monument the Pharaoh empowers empowers every building within 30 m at 60 %.",
			"Priests can empower (at 60 % of a Pharaoh).",
			"Laborers gather berries 30 % faster; Camel Riders, Chariot Archers and War Elephants +15 % hp."]},
	"isis": {"name": "Isis", "title": "Goddess of Magic and Healing", "culture": "Egyptians", "available": true,
		"powers": ["prosperity"], "focus": "Focus: technology.",
		"lines": ["Divine Shield: no enemy god power within 25 m of a Monument (50 m and healing when empowered).",
			"Technologies cost 10 % less; Town Centers +5 population.",
			"Obelisks cost 5 gold less and Priests build them 40 % faster."]},
	"set": {"name": "Set", "title": "God of Storms and Trickery", "culture": "Egyptians", "available": true,
		"powers": ["vision"], "focus": "Focus: Barracks units.",
		"lines": ["Devotees: Barracks and Migdols near a Monument train 10 % cheaper.",
			"The Pharaoh summons Animals of Set; Priests convert wild animals; starts with a Baboon.",
			"Spearmen, Axemen and Slingers +5 % speed; Barracks, Siege Works and Migdols -25 % gold."]},
}
const GOD_ORDER := ["zeus", "hades", "poseidon", "ra", "isis", "set"]
## the pantheon picker's culture rows (Retold's Select Pantheon, reference/egypt/ui_04.jpg)
const CULTURES := [["Greeks", ["zeus", "hades", "poseidon"]], ["Egyptians", ["ra", "isis", "set"]]]
## god power names / one-line help for the cards (the sim's get_power_def has the full text)
const POWERS := {
	"lightning_storm": ["Lightning Storm", "A storm of bolts over a wide area"], "bolt": ["Bolt", "Strikes one unit dead"],
	"meteor": ["Meteor", "A burning rock that levels buildings"],
	"rain": ["Rain", "50 s: your Laborers farm 150 % faster"], "prosperity": ["Prosperity", "75 s: your Laborers mine gold 50 % faster"],
	"vision": ["Vision", "Reveals a circle anywhere on the map for 20 s"],
	"eclipse": ["Eclipse", "Myth units stronger and faster"], "shifting_sands": ["Shifting Sands", "Teleports your units"],
	"plague_of_serpents": ["Plague of Serpents", "Fourteen serpents rise"], "locust_swarm": ["Locust Swarm", "Swarms devour farms"],
	"citadel": ["Citadel", "A Town Center becomes a Citadel"], "ancestors": ["Ancestors", "Raises 13 Minions"],
	"son_of_osiris": ["Son of Osiris", "The Pharaoh becomes a demigod"], "tornado": ["Tornado", "A wrecking whirlwind"],
	"thoth_meteor": ["Meteor", "Twelve meteors fall"],
}

## The culture of a god key ("Greeks" / "Egyptians").
static func culture_of(god: String) -> String:
	return str(GODS.get(god.to_lower(), GODS.zeus).culture)

const AI_NAMES := ["Pericles", "Leonidas", "Themistocles", "Miltiades", "Lysander", "Epaminondas"]

static func defaults(n_players := 2) -> Dictionary:
	var s := {
		"version": VERSION, "game_type": "standard", "victory": "conquest",
		"map": "aegean_hills", "preset": "skirmish", "seed": 3, "map_size": 128,
		"visibility": "standard", "resources": "standard", "speed": 1.0,
		"free_for_all": false, "lock_teams": false, "players": [],
	}
	set_player_count(s, n_players)
	return s

static func new_player(s: Dictionary, idx: int) -> Dictionary:
	var used := {}
	for p in s.players:
		used[int(p.color)] = true
	var col := idx + 1
	if used.has(col):
		for c in range(1, COLORS.size()):
			if not used.has(c):
				col = c
				break
	if idx == 0:
		return {"id": 1, "name": "You", "human": true, "ai": "", "god": "zeus", "color": col, "team": 1}
	return {"id": idx + 1, "name": AI_NAMES[(idx - 1) % AI_NAMES.size()], "human": false, "ai": "moderate",
		"god": "zeus", "color": col, "team": idx + 1}

static func set_player_count(s: Dictionary, n: int) -> void:
	n = clampi(n, 2, MAX_PLAYERS)
	var ps: Array = s.players
	while ps.size() > n:
		ps.pop_back()
	while ps.size() < n:
		ps.append(new_player(s, ps.size()))
	for i in ps.size():
		ps[i].id = i + 1

static func color_of(idx: int) -> Color:
	var c: int = COLORS[clampi(idx, 1, COLORS.size() - 1)]
	return Color8((c >> 16) & 255, (c >> 8) & 255, c & 255)

static func option_name(list: Array, key) -> String:
	for o in list:
		if o.key == key:
			return o.name
	return str(key)

static func option(list: Array, key) -> Dictionary:
	for o in list:
		if o.key == key:
			return o
	return {}

## Starts the generator makes for a map at a player count (cached).
static var _starts_cache := {}
static func starts_for(map_key: String, n: int) -> int:
	var preset: String = MAPS.get(map_key, MAPS.aegean_hills).preset
	var key := "%s/%d" % [preset, n]
	if not _starts_cache.has(key):
		if not ClassDB.class_exists("AovSim"):
			return 2
		var sim: Object = ClassDB.instantiate("AovSim")
		sim.new_game(1, 96, preset, n)
		_starts_cache[key] = sim.get_starts().size()
	return _starts_cache[key]

static func map_supports(map_key: String, n: int) -> bool:
	return map_key == "random" or starts_for(map_key, n) >= n

## Maps that take n players (in MAP_ORDER).
static func maps_for(n: int) -> Array:
	var out := []
	for k in MAP_ORDER:
		if map_supports(k, n):
			out.append(k)
	return out

## The team of each owner as the rules use it (free for all: own team).
static func team_of(s: Dictionary, idx: int) -> int:
	var p: Dictionary = s.players[idx]
	return idx + 1 + 100 if bool(s.free_for_all) or int(p.team) <= 0 else int(p.team)

## Resolve "random" choices (the map) right before the match starts.
static func roll(s: Dictionary) -> Dictionary:
	var out: Dictionary = s.duplicate(true)
	if out.map == "random":
		var pool := maps_for(out.players.size())
		var rng := RandomNumberGenerator.new()
		rng.seed = int(out.seed) * 7919 + 17
		out.map = pool[rng.randi() % pool.size()] if not pool.is_empty() else "aegean_hills"
	out.preset = MAPS[out.map].preset
	return out

## main.gd args for a match (strings, as Flow passes them).
static func to_args(s: Dictionary) -> Dictionary:
	var m := roll(s)
	var a := {
		"scene": "skirmish",
		"seed": str(m.seed),
		"mapsize": str(m.map_size),
		"players": str(m.players.size()),
		"preset": str(m.preset),
		"timescale": str(m.speed),
		"match": JSON.stringify(m),
	}
	if m.visibility == "revealed":
		a["fog"] = "0"
	return a

## The match settings of a run (main.gd args), or {} when it has none.
static func from_args(args: Dictionary) -> Dictionary:
	if not args.has("match"):
		return {}
	var v = JSON.parse_string(str(args.match))
	if typeof(v) != TYPE_DICTIONARY:
		return {}
	# JSON numbers come back as floats: restore the ints
	for k in ["seed", "map_size", "version"]:
		if v.has(k):
			v[k] = int(v[k])
	for p in v.get("players", []):
		for k in ["id", "color", "team"]:
			if p.has(k):
				p[k] = int(p[k])
	return v
