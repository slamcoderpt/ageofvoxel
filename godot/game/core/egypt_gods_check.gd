extends SceneTree
## Scripted check of the Egyptian gods (native/src/sim/godpowers egypt_powers.cpp /
## egypt_myth.cpp, sim/techs; PORTING.md "The Egyptian gods"), headless, on AovSim matches
## of human seats (no AI), every rule measured on real numbers.
##
##   defs        every Egyptian power's Retold numbers (cost, ramp, recharge, age, aim) and
##               every myth unit's (hp, attack, armor, cost, pop, age, its god)
##   gods        the minor gods each major god offers (Ra, Isis, Set) per age; a refused god;
##               "hathor" = Sobek; an age-up without a choice takes the first; each player's
##               powers (major god's Archaic power, a minor god's from his age); a Greek keeps
##               Lightning Storm / Bolt / Meteor and cannot cast an Egyptian power, nor an
##               Egyptian a Greek one; a Greek and an Egyptian in one match
##   passives    the major gods' passive bonuses measured: Ra (berries +30 %, Migdol units
##               +15 % hp, his Priests empower), Isis (TC +5 pop, techs -10 %, Obelisk 5 g),
##               Set (Barracks infantry +5 % speed, Barracks / Siege Works / Migdol -25 % gold)
##   model       Retold's power model: the favor cost ramps per cast (Rain 30 -> 45 -> 60),
##               the recharge after each cast; Clairvoyance halves Vision's and stops its ramp
##   rain, prosperity, vision, eclipse, sands, serpents, locusts, citadel, ancestors, son,
##   tornado, meteor
##               each power's effect on real numbers: food / gold gathered in 10 s with and
##               without, the reveal's radius over time, myth damage / speed / armor / favor
##               under the Eclipse, units teleported (and the refusals), serpents per wave,
##               swarm damage on a unit / a Farm / an own unit and its track, the Citadel's hp
##               / pop / train time / arrows, Minions raised and their end, the Son of Osiris'
##               hp and chain lightning, the new Pharaoh, Tornado damage per pulse on a house
##               and a hoplite, its slow and throw, Thoth's 12 meteors and their blast
##   myth        the myth units: trained only with their minor god and from his age, never by a
##               Greek; their abilities measured (Wadjet venom, Scarab Causticity, Phoenix
##               Rebirth, Avenger Spin, Anubite Jump, Mummy curse -> Minion, Scorpion Sting)
##   techs       the gods' techs: at their buildings, locked to their god, their effects
##               measured (Skin of the Rhino, Flood of the Nile, Sacred Cats, Shaduf, Necropolis,
##               Sun-dried Mud-brick, Crimson Linen, Funeral Rites, New Kingdom, Book of Thoth,
##               Tusks of Apedemak, Spear of Horus, Force of the West Wind)
##   determinism the same casts twice -> the same units hash; rules off -> the Greek powers only
##   phantom     nothing cast: no Rain / Prosperity / Eclipse is live or fading at the start of a
##               match (the renderer's timed list is empty at 0, 1 and 2.5 s)
##   blocks      a live Tornado and Thoth's Meteor block other god powers locally (a Greek
##               Lightning Storm / Meteor inside refused, outside allowed; an Egyptian power too)
##   allies      the Citadel on an ally's Town Center and its +10 % hack armor (Retold's 50 % ->
##               55 %: a hoplite blow x0.9, 3.15 -> 2.835); the Son of Osiris on an ally's Pharaoh
##               (the demigod is the ally's) heals P1's spearman 15 hp/s and is never healed
##   trees       a Tornado and Thoth's Meteor flatten the trees they cross (no longer blocking,
##               the wood kept)
##   split       the myth units' split damage: the Sphinx's 9 crush (x1.5 Criosphinx, x2 with
##               Hieracosphinx) and the Phoenix's 65 on buildings, the Petsuchos' beam (10 P +
##               30 P over 1 s + 2 D + 8 D over 1 s), x0.5 vs heroes, the Serpent's Retold stats
##               (+20 % by age), Tusks of Apedemak's -1 pop
##   roc         the Roc boards units (they leave the world, their pop stays), flies, lands and
##               sets them down; a Roc that falls takes its riders
##   roc_smart   (roc.right_click) the HUD's right-click on one's own Roc (AovSim.smart) boards
##               the selected men (not a catapult, never a foe's man; the Roc stays to land); a
##               boarder sent off drops out; Unload sets the rest down at the click
##   roc_ai      (roc.ai_lifts) an Egyptian AI with Sobek trains a Roc and its gods' myth units
##               at its Temple and flies part of a wave to its target
##   immunity    Retold's immunities: a Zeus player's Bolt, Lightning Storm and Meteor and an
##               Egyptian foe's Locust Swarm and Thoth's Meteor strike the spearmen beside a Son
##               of Osiris and a Roc and never them (0 damage events, hp 609 / 840 kept: the
##               Roc's 700 x1.2 in the Mythic Age)
##   noheal      (son.heal) the Son of Osiris heals allies 15 hp/s and cannot be healed: a
##               spearman +20 in 2 s by a Pharaoh, +30 by the Son, +45 by the Son and a Priest;
##               the Son's own hp unchanged
##   volleys     the Egyptian Town Center shoots 2 arrows a volley, the Greek one 1 (as before),
##               a Citadel Center 3 at three different hoplites
##   eclipse_abilities  the Eclipse's +20 % on the abilities (Anubite Jump 10.5 -> 12.6, the
##               Wadjet's venom, the Mummy's curse and the Scarab's Causticity x1.2: 70 -> 84,
##               100.8 in the Mythic Age), the first myth unit on the map
##               using its ability at once (the Jump on a fresh spawn), Force of the West Wind on
##               the Sphinx's 9 crush
##   myth_ages   (EGYPT.md 5: "Myth units get +HP/+attack bonuses from later age-ups") the ten
##               trainable Egyptian myth units +20 % hp and damage per age past their own (a
##               Classical Sphinx 300 / 15 -> 360 / 18 -> 420 / 21, a Heroic Scarab 1000 -> 1200, a
##               Mythic Avenger x1): read from get_unit_stats, measured on blows (a Sphinx on a
##               hoplite, its Whirlwind, its crush on a House), on a Sphinx alive through a real
##               advance_age (hp re-based, its wounds kept in proportion) and one trained after it;
##               a Greek Minotaur unchanged in every age
##   ai          an Egyptian AI seat casts its gods' powers (Rain on its Farms, a Tornado / Plague
##               of Serpents / Ancestors on a cluster of foes)
##
##   godot --headless --path godot -s res://game/core/egypt_gods_check.gd [-- --only=defs,gods,... --seed=3]

const FPS := 30
var fails: Array = []
var passes := 0
var result := {}
var only: Array = []
var seed_arg := 3
var C := Vector2i(-1, -1)   # the open area of the last _fresh()

func _initialize() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7).split(",")
		elif a.begins_with("--seed="):
			seed_arg = int(a.substr(7))
	_run.call_deferred()

func _want(name: String) -> bool:
	return only.is_empty() or name in only

func _check(name: String, ok: bool, detail := {}) -> void:
	if ok:
		passes += 1
	else:
		fails.append(name)
	result[name] = detail.merged({"ok": ok})
	print("GODS %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

static func _near(a: float, b: float, eps := 1e-3) -> bool:
	return absf(a - b) <= eps

static func _r(v: float, d := 3) -> float:
	var k := pow(10.0, d)
	return roundf(v * k) / k

# ---- helpers ------------------------------------------------------------------

## A 2-player match of human seats: player 1 with god g1, player 2 with god g2 (deathmatch
## stockpiles), victory off, revealed, an open area C cleared. age: both players' age.
func _fresh(g1 := "ra", g2 := "zeus", age := 0, gods1 := [], seed := -1) -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := [{"id": 1, "name": "P1", "human": true, "team": 1, "god": g1}, {"id": 2, "name": "P2", "human": true, "team": 2, "god": g2}]
	var r: Dictionary = sim.start_match({"seed": seed_arg if seed < 0 else seed, "map_size": 160, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
		return null
	sim.set_victory_enabled(false)
	sim.set_fog_reveal_all(true)
	sim.set_record_events(true)
	for a in gods1.size():
		sim.set_minor_god(1, a + 1, gods1[a])
	if age > 0:
		sim.set_player_age(1, age)
		sim.set_player_age(2, age)
	C = _open_area(sim, 44, 30.0)
	sim.set_player_resources(1, {"favor": 200})
	sim.take_events()
	return sim

func _open_area(sim: Object, w: int, far: float) -> Vector2i:
	var c := _find_area(sim, w, far)
	if c.x >= 0:
		sim.clear_rect(c.x - w / 2, c.y - w / 2, w + 1, w + 1)
	return c

func _find_area(sim: Object, w: int, far: float) -> Vector2i:
	var n := int(sim.get_map_size())
	var walk: PackedByteArray = sim.get_passable()
	var starts: Array = sim.get_starts()
	var h := w / 2
	for cz in range(h + 2, n - h - 2, 2):
		for cx in range(h + 2, n - h - 2, 2):
			var ok := true
			for s in starts:
				if Vector2(cx, cz).distance_to(Vector2(float(s.tx), float(s.tz))) < far:
					ok = false
					break
			if not ok:
				continue
			for z in range(cz - h, cz + h + 1):
				for x in range(cx - h, cx + h + 1):
					if walk[z * n + x] == 0:
						ok = false
						break
				if not ok:
					break
			if ok:
				return Vector2i(cx, cz)
	return Vector2i(-1, -1)

func _u(sim: Object, type: String, owner: int, dx: float, dz: float) -> int:
	return int(sim.spawn_unit(type, owner, C.x + dx, C.y + dz, 0.0))

func _b(sim: Object, type: String, owner: int, dx: int, dz: int, built := true) -> int:
	return int(sim.spawn_building(type, owner, C.x + dx, C.y + dz, built, false))

func _step(sim: Object, seconds: float) -> void:
	sim.tick(int(round(seconds * FPS)))

func _hp(sim: Object, id: int) -> float:
	var u: Dictionary = sim.get_unit(id)
	if u.is_empty() or bool(u.dead):
		return 0.0
	return float(u.hp)

func _bhp(sim: Object, id: int) -> float:
	var b: Dictionary = sim.get_building(id)
	return 0.0 if b.is_empty() else float(b.hp)

func _alive(sim: Object, id: int) -> bool:
	var u: Dictionary = sim.get_unit(id)
	return not u.is_empty() and not bool(u.dead)

func _units_of(sim: Object, owner: int, type: String) -> Array:
	var U: Dictionary = sim.get_units()
	var names: PackedStringArray = sim.unit_type_names()
	var out := []
	for i in U.ids.size():
		if int(U.owner[i]) == owner and names[U.type[i]] == type and not (int(U.flags[i]) & 2):
			out.append(int(U.ids[i]))
	return out

func _buildings_of(sim: Object, owner: int, type: String) -> Array:
	var B: Dictionary = sim.get_buildings()
	var names: PackedStringArray = B.type_names
	var out := []
	for i in B.count:
		if int(B.owner[i]) == owner and names[B.type[i]] == type:
			out.append(int(B.ids[i]))
	return out

func _favor(sim: Object, owner: int) -> float:
	return float(sim.get_player(owner).favor)

func _res(sim: Object, owner: int, k: String) -> float:
	return float(sim.get_player(owner)[k])

## Damage events this tick window: {target id: summed amount}
func _damage_by(sim: Object, seconds: float, filter := Callable()) -> Dictionary:
	var out := {}
	for t in int(round(seconds * FPS)):
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and (not filter.is_valid() or filter.call(e)):
				out[int(e.id)] = float(out.get(int(e.id), 0.0)) + float(e.amount)
	return out

# ---- run ------------------------------------------------------------------------

func _run() -> void:
	var t0 := Time.get_ticks_msec()
	for c in ["defs", "gods", "passives", "model", "rain", "prosperity", "vision", "eclipse", "sands", "serpents", "locusts", "citadel",
			"ancestors", "son", "son_divine", "tornado", "meteor", "myth", "techs", "bounds", "determinism",
			"phantom", "blocks", "allies", "trees", "split", "roc", "roc_smart", "roc_ai", "immunity", "noheal", "volleys", "shield_preview", "eclipse_abilities", "myth_ages", "ai"]:
		if _want(c):
			call("_case_" + c)
	result["ms"] = Time.get_ticks_msec() - t0
	result["passes"] = passes
	result["fails"] = fails
	print("GODS_RESULT %s" % JSON.stringify(result))
	quit(fails.size())

# defs -------------------------------------------------------------------------------

const RETOLD_POWERS := {
	# key: [god, favor, recharge, ramp, age, target]
	"rain": ["Ra", 30, 90, 15, 0, "global"], "prosperity": ["Isis", 60, 120, 10, 0, "global"], "vision": ["Set", 40, 240, 5, 0, "point"],
	"eclipse": ["Bast", 90, 150, 25, 1, "global"], "shifting_sands": ["Ptah", 40, 180, 20, 1, "two_points"],
	"plague_of_serpents": ["Anubis", 60, 180, 10, 1, "point"], "locust_swarm": ["Sobek", 75, 150, 10, 2, "two_points"],
	"citadel": ["Sekhmet", 150, 120, 50, 2, "own_tc"], "ancestors": ["Nephthys", 100, 180, 5, 2, "point"],
	"son_of_osiris": ["Osiris", 350, 240, 50, 3, "own_pharaoh"], "tornado": ["Horus", 350, 240, 5, 3, "point"],
	"thoth_meteor": ["Thoth", 350, 240, 5, 3, "point"],
}
const MYTH := {
	# type: [god, age, hp, damage, hack armor (x0.75), cost {res: n}, pop]
	"anubite": ["anubis", 1, 200, 11, 0.45, {"food": 100, "favor": 15}, 2],
	"wadjet": ["ptah", 1, 270, 12, 0.1875, {"wood": 150, "favor": 15}, 2],
	"sphinx": ["bast", 1, 300, 15, 0.3375, {"gold": 120, "favor": 18}, 3],
	"petsuchos": ["sobek", 2, 400, 10, 0.30, {"gold": 200, "favor": 16}, 3],
	"roc": ["sobek", 2, 700, 0, 0.0, {"gold": 100, "favor": 5}, 2],
	"scarab": ["sekhmet", 2, 1000, 16, 0.075, {"food": 240, "favor": 18}, 4],
	"scorpion_man": ["nephthys", 2, 550, 30, 0.375, {"wood": 200, "favor": 22}, 3],
	"mummy": ["osiris", 3, 450, 30, 0.2625, {"wood": 275, "favor": 25}, 4],
	"avenger": ["horus", 3, 700, 28, 0.45, {"food": 250, "favor": 22}, 3],
	"phoenix": ["thoth", 3, 600, 50, 0.1125, {"gold": 200, "favor": 22}, 4],
}

func _case_defs() -> void:
	var sim := _fresh()
	var got := {}
	var ok := true
	for k in RETOLD_POWERS:
		var d: Dictionary = sim.get_power_info(1, k)
		var want: Array = RETOLD_POWERS[k]
		got[k] = [d.god, d.favor, d.cooldown, d.ramp, d.age, d.target]
		ok = ok and str(d.god) == want[0] and float(d.favor) == want[1] and float(d.cooldown) == want[2] and float(d.ramp) == want[3]
		ok = ok and int(d.age) == want[4] and str(d.target) == want[5] and bool(d.egypt)
	_check("defs.powers", ok, got)
	var units := {}
	ok = true
	for t in MYTH:
		var d: Dictionary = sim.get_unit_def(t)
		var w: Array = MYTH[t]
		units[t] = {"hp": d.hp, "damage": d.attack.damage if d.has("attack") else 0, "hack": d.hack_armor, "pierce": d.pierce_armor, "cost": d.cost,
			"pop": d.pop, "age": d.min_age, "class": d["class"]}
		ok = ok and float(d.hp) == w[2] and _near(float(d.hack_armor), w[4]) and int(d.pop) == w[6] and int(d.min_age) == w[1] and str(d["class"]) == "myth"
		if w[3] > 0:
			ok = ok and float(d.attack.damage) == w[3]
		for res in w[5]:
			ok = ok and float(d.cost.get(res, -1)) == w[5][res]
	_check("defs.myth_units", ok, units)

# gods --------------------------------------------------------------------------------

func _case_gods() -> void:
	var sim := _fresh("ra", "zeus")
	var offered := {}
	for g in ["ra", "isis", "set"]:
		offered[g] = [Array(sim.minor_gods_of(g, 1)), Array(sim.minor_gods_of(g, 2)), Array(sim.minor_gods_of(g, 3))]
	var ok: bool = offered.ra == [["bast", "ptah"], ["sobek", "sekhmet"], ["horus", "osiris"]]
	ok = ok and offered.isis == [["anubis", "bast"], ["sobek", "nephthys"], ["osiris", "thoth"]]
	ok = ok and offered.set == [["anubis", "ptah"], ["nephthys", "sekhmet"], ["horus", "thoth"]]
	_check("gods.offered", ok, offered)
	# Ra cannot take Anubis; "hathor" is Sobek; an Egyptian needs a god per age
	var r := {}
	r["ra takes anubis"] = sim.set_minor_god(1, 1, "anubis")
	r["ra takes hathor (heroic)"] = sim.set_minor_god(1, 2, "hathor")
	r["heroic god"] = str(sim.get_gods(1).minor[2])
	r["ra takes bast"] = sim.set_minor_god(1, 1, "bast")
	r["greek takes athena"] = sim.set_minor_god(2, 1, "athena")
	r["greek takes bast"] = sim.set_minor_god(2, 1, "bast")
	ok = not bool(r["ra takes anubis"].ok) and str(r["ra takes anubis"].reason) == "Ra does not offer Anubis" and bool(r["ra takes hathor (heroic)"].ok)
	ok = ok and r["heroic god"] == "sobek" and bool(r["ra takes bast"].ok) and bool(r["greek takes athena"].ok) and not bool(r["greek takes bast"].ok)
	_check("gods.choose", ok, r)
	# an age-up with no choice takes the first offered god (Retold forces a choice)
	var s2 := _fresh("set", "zeus")
	s2.set_player_resources(1, {"food": 5000, "gold": 5000})
	var tc: int = _buildings_of(s2, 1, "town_center")[0]
	_b(s2, "temple", 1, 0, 0)
	s2.tick(1)
	var adv: Dictionary = s2.advance_age(1)
	_step(s2, 61.0)
	var au := {"advance": adv, "age": int(s2.get_player(1).age), "classical god": str(s2.get_gods(1).minor[1]), "tc": tc}
	_check("gods.auto_pick", bool(adv.ok) and au.age == 1 and au["classical god"] == "anubis", au)
	# each player's powers
	var pw := {}
	for g in ["ra", "isis", "set"]:
		var s := _fresh(g, "zeus")
		pw[g + " archaic"] = Array(s.player_powers(1))
	var s3 := _fresh("ra", "zeus", 3, ["ptah", "sekhmet", "osiris"])
	pw["ra ptah sekhmet osiris, mythic"] = Array(s3.player_powers(1))
	pw["zeus (greek)"] = Array(s3.player_powers(2))
	var s4 := _fresh("isis", "zeus", 1, ["bast", "nephthys", "thoth"])
	pw["isis bast nephthys thoth, classical"] = Array(s4.player_powers(1))
	pw["egyptian casts lightning_storm"] = s4.cast_power(1, "lightning_storm", C.x, C.y)
	pw["greek casts rain"] = s4.cast_power(2, "rain", C.x, C.y)
	pw["greek rain reason"] = str(s4.get_power_info(2, "rain").reason)
	pw["isis casts eclipse (bast)"] = s4.cast_power(1, "eclipse", C.x, C.y)
	pw["isis casts ancestors before heroic"] = str(s4.get_power_info(1, "ancestors").reason)
	ok = pw["ra archaic"] == ["rain"] and pw["isis archaic"] == ["prosperity"] and pw["set archaic"] == ["vision"]
	ok = ok and pw["ra ptah sekhmet osiris, mythic"] == ["rain", "shifting_sands", "citadel", "son_of_osiris"]
	ok = ok and pw["zeus (greek)"] == ["lightning_storm", "bolt", "meteor"] and pw["isis bast nephthys thoth, classical"] == ["prosperity", "eclipse"]
	ok = ok and not pw["egyptian casts lightning_storm"] and not pw["greek casts rain"] and pw["isis casts eclipse (bast)"]
	_check("gods.powers", ok, pw)
	# a Greek and an Egyptian in one match: the Greek's Lightning Storm works as before
	var s5 := _fresh("ra", "zeus")
	s5.set_player_resources(2, {"favor": 100})
	var men := []
	for i in 6:
		men.append(_u(s5, "laborer", 1, 6.0 + i * 0.5, 0.0))
	var ls: bool = s5.cast_power(2, "lightning_storm", C.x + 7, C.y)
	var dmg := _damage_by(s5, 6.0)
	var hurt := 0
	for id in men:
		if dmg.has(id):
			hurt += 1
	_check("gods.mixed_match", ls and hurt >= 3 and float(s5.get_player(2).favor) == 60, {"storm": ls, "laborers struck": hurt, "zeus favor": s5.get_player(2).favor})

# passives -------------------------------------------------------------------------------

## What one worker takes per second from a node (a resource's amount, a Farm's rows x
## FOOD_PER_ROW) while he picks, no walk: 3 s windows once he gathers. node: a resource id,
## or a farm building id with farm = true.
func _pick_rate(sim: Object, worker: int, node: int, farm := false, seconds := 3.0) -> float:
	var amount := func() -> float:
		if farm:
			return float(sim.get_building(node).farm_rows)
		var R: Dictionary = sim.get_resources()
		for i in R.ids.size():
			if int(R.ids[i]) == node:
				return float(R.amount[i])
		return -1.0
	var n := 0
	var got := 0.0
	# only ticks he spends picking count (the amount falls; he walks off to drop between)
	for i in int((seconds + 20.0) * FPS):
		var before: float = amount.call()
		sim.tick(1)
		var d := absf(float(amount.call()) - before)
		if d > 1e-9:
			got += d
			n += 1
			if n >= int(seconds * FPS):
				break
	return got / maxf(1.0, n) * FPS

func _picker(sim: Object, owner: int, node_type: String, dx := 0.0) -> Array:
	# (egypt_check.gd's _berry_rate layout: the node at C, the drop site beside it)
	var node := int(sim.spawn_resource(node_type, C.x + int(dx), C.y, 0))
	var gold := node_type == "gold"
	_b(sim, "mining_camp" if gold else "granary", owner, int(dx) + (4 if gold else 2), -1)
	var w := _u(sim, "laborer", owner, dx - (2.2 if gold else 1.0), 0.5)
	sim.tick(1)
	sim.order_gather(PackedInt32Array([w]), node)
	return [w, node]

func _case_passives() -> void:
	var r := {}
	# Ra: Laborers on berries +30 %
	var s1 := _fresh("ra", "zeus")
	var s2 := _fresh("isis", "zeus")
	var p1 := _picker(s1, 1, "berry")
	var p2 := _picker(s2, 1, "berry")
	r["ra berries food/s (a laborer picking)"] = _r(_pick_rate(s1, p1[0], p1[1]), 4)
	r["isis berries food/s"] = _r(_pick_rate(s2, p2[0], p2[1]), 4)
	# (this sim's Laborer: the villager's 0.75 food/s x0.9 = 0.675; Ra x1.3)
	var ok: bool = _near(r["ra berries food/s (a laborer picking)"], 0.675 * 1.3, 0.002) and _near(r["isis berries food/s"], 0.675, 0.002)
	# Ra: Migdol units +15 % hp
	var ca1: float = float(s1.get_unit(_u(s1, "camel_rider", 1, 0, -8)).max_hp)
	var ca2: float = float(s2.get_unit(_u(s2, "camel_rider", 1, 0, -8)).max_hp)
	r["camel rider hp ra / isis"] = [ca1, ca2]
	ok = ok and _near(ca1, 135 * 1.15) and _near(ca2, 135)
	# Isis: Town Center +5 pop; techs -10 %
	s1.tick(2)
	s2.tick(2)
	r["isis pop_cap / ra pop_cap"] = [int(s2.get_player(1).pop_cap), int(s1.get_player(1).pop_cap)]
	ok = ok and r["isis pop_cap / ra pop_cap"][0] - r["isis pop_cap / ra pop_cap"][1] == 5
	var tc2: int = _buildings_of(s2, 1, "town_center")[0]
	var tc1: int = _buildings_of(s1, 1, "town_center")[0]
	var cost := func(sim: Object, b: int, key: String) -> Dictionary:
		for t in sim.get_techs(b):
			if str(t.key) == key:
				return t.cost
		return {}
	r["fortified? skin of the rhino cost ra"] = cost.call(s1, tc1, "skin_of_the_rhino")
	var gr2 := _b(s2, "granary", 1, 8, 8)
	r["flood of the nile cost isis (150 g x0.9)"] = cost.call(s2, gr2, "flood_of_the_nile")
	ok = ok and _near(float(r["flood of the nile cost isis (150 g x0.9)"].get("gold", 0)), 135) and float(r["fortified? skin of the rhino cost ra"].get("food", 0)) == 50
	ok = ok and _near(float(r["flood of the nile cost isis (150 g x0.9)"].get("favor", 0)), 7.2) # (EGYPT.md 4: 135 g + 7.2 favor)
	# Set: Barracks infantry +5 % speed, -25 % gold on Barracks / Siege Works / Migdol
	var s3 := _fresh("set", "zeus")
	var sp3: float = float(s3.get_unit_stats(_u(s3, "spearman", 1, 0, 0)).speed)
	var sp1: float = float(s1.get_unit_stats(_u(s1, "spearman", 1, 0, 0)).speed)
	r["spearman speed set / ra"] = [_r(sp3), _r(sp1)]
	ok = ok and _near(sp3, sp1 * 1.05)
	var bset: Dictionary = s3.get_building_def("eg_barracks", 1)
	var bra: Dictionary = s1.get_building_def("eg_barracks", 1)
	r["barracks gold set / ra"] = [bset.cost.get("gold", 0), bra.cost.get("gold", 0)]
	r["migdol gold set"] = s3.get_building_def("migdol", 1).cost.get("gold", 0)
	ok = ok and _near(float(r["barracks gold set / ra"][0]), 75 * 0.75) and _near(float(r["migdol gold set"]), 375)
	# Ra's Priests empower (60 %), Isis' do not
	var pr1 := _u(s1, "priest", 1, -10, -10)
	var pr2 := _u(s2, "priest", 1, -10, -10)
	var h1 := _b(s1, "house", 1, -12, -14)
	var h2 := _b(s2, "house", 1, -12, -14)
	s1.tick(1)
	s2.tick(1)
	s1.order_empower(PackedInt32Array([pr1]), h1)
	s2.order_empower(PackedInt32Array([pr2]), h2)
	_step(s1, 6.0)
	_step(s2, 6.0)
	var e1 = s1.get_civ_state(1).get("empowered", [])
	var e2 = s2.get_civ_state(1).get("empowered", [])
	r["empowered by ra's priest / isis'"] = [str(e1), str(e2)]
	ok = ok and e1 is Array and e1.size() == 1 and _near(float(e1[0].strength), 0.6) and e2 is Array and e2.is_empty()
	_check("passives.major_gods", ok, r)

# model ---------------------------------------------------------------------------------

func _case_model() -> void:
	var sim := _fresh("ra", "zeus")
	sim.set_player_resources(1, {"favor": 200})
	var r := {}
	r["cost 1"] = float(sim.get_power_info(1, "rain").cost)
	r["cast 1"] = sim.cast_power(1, "rain", 0, 0)
	r["favor after 1"] = _favor(sim, 1)
	r["cost 2"] = float(sim.get_power_info(1, "rain").cost)
	r["recharge left"] = _r(float(sim.power_cooldown(1, "rain")))
	r["cast during recharge"] = sim.cast_power(1, "rain", 0, 0)
	r["reason"] = str(sim.get_power_info(1, "rain").reason)
	_step(sim, 90.1)
	r["cast 2 after 90 s"] = sim.cast_power(1, "rain", 0, 0)
	r["favor after 2"] = _favor(sim, 1)
	r["cost 3"] = float(sim.get_power_info(1, "rain").cost)
	var ok: bool = r["cost 1"] == 30 and r["cast 1"] and r["favor after 1"] == 170 and r["cost 2"] == 45 and _near(r["recharge left"], 90, 0.05)
	ok = ok and not r["cast during recharge"] and r["reason"] == "Recharging" and r["cast 2 after 90 s"] and _near(r["favor after 2"], 125) and r["cost 3"] == 60
	# Clairvoyance: Vision recharges in 120 s and costs 40 every time
	var s2 := _fresh("set", "zeus")
	s2.set_player_resources(1, {"favor": 200})
	s2.grant_tech(1, "clairvoyance")
	s2.cast_power(1, "vision", C.x, C.y)
	r["clairvoyance: recharge"] = _r(float(s2.power_cooldown(1, "vision")))
	r["clairvoyance: next cost"] = float(s2.get_power_info(1, "vision").cost)
	var s3 := _fresh("set", "zeus")
	s3.cast_power(1, "vision", C.x, C.y)
	r["no clairvoyance: recharge, next cost"] = [_r(float(s3.power_cooldown(1, "vision"))), float(s3.get_power_info(1, "vision").cost)]
	ok = ok and _near(r["clairvoyance: recharge"], 120, 0.05) and r["clairvoyance: next cost"] == 40 and r["no clairvoyance: recharge, next cost"] == [240.0, 45.0]
	_check("model.ramp_recharge", ok, r)

# Rain / Prosperity -----------------------------------------------------------------------

func _farm_rate(sim: Object, owner: int, seconds: float) -> float:
	var f0 := _res(sim, owner, "food")
	_step(sim, seconds)
	return (_res(sim, owner, "food") - f0) / seconds

func _case_rain() -> void:
	var sim := _fresh("ra", "zeus")
	var f := _b(sim, "farm", 1, 0, 4)
	_b(sim, "granary", 1, -4, 4)
	var lab := _u(sim, "laborer", 1, 0, 2.0)
	sim.tick(1)
	sim.order(lab, {"type": "gather", "target": f})
	var before := _pick_rate(sim, lab, f, true)
	var cast: bool = sim.cast_power(1, "rain", 0, 0)
	var t0: float = float(sim.get_time())
	var during := _pick_rate(sim, lab, f, true)
	var until: float = float(sim.get_power_stats(1).rain_until)
	while float(sim.get_time()) - t0 < 50.5:
		sim.tick(1)
	var after := _pick_rate(sim, lab, f, true)
	var r := {"farm rows/s before": _r(before, 4), "under rain": _r(during, 4), "ratio": _r(during / maxf(0.0001, before)), "after 50 s": _r(after, 4),
		"lasts [s]": _r(until - t0), "cast": cast}
	_check("rain.farming", cast and _near(during / maxf(0.0001, before), 2.5, 0.01) and _near(after / maxf(0.0001, before), 1.0, 0.01) and _near(until - t0, 50.0, 0.01), r)

func _case_prosperity() -> void:
	var sim := _fresh("isis", "zeus")
	var p := _picker(sim, 1, "gold")
	var before := _pick_rate(sim, p[0], p[1])
	var cast: bool = sim.cast_power(1, "prosperity", 0, 0)
	var t0: float = float(sim.get_time())
	var during := _pick_rate(sim, p[0], p[1])
	var until: float = float(sim.get_power_stats(1).prosperity_until)
	var r := {"gold/s before (a laborer mining)": _r(before, 4), "gold/s prosperity": _r(during, 4), "ratio": _r(during / maxf(0.001, before)), "lasts [s]": _r(until - t0)}
	_check("prosperity.gold", cast and _near(before, 0.495, 0.002) and _near(during / maxf(0.001, before), 1.5, 0.01) and _near(r["lasts [s]"], 75.0, 0.01), r)

# Vision --------------------------------------------------------------------------------

func _case_vision() -> void:
	var sim := _fresh("set", "zeus")
	sim.set_fog_reveal_all(false)
	# a spot far from everything of player 1's
	var n := float(sim.get_map_size())
	var tgt := Vector2(n * 0.5, n * 0.5)
	for s in sim.get_starts():
		if int(s.owner) != 1:
			tgt = Vector2(float(s.tx), float(s.tz))
	sim.fog_recompute()
	var r := {}
	r["enemy start visible before"] = sim.is_visible(tgt.x, tgt.y)
	r["cast"] = sim.cast_power(1, "vision", tgt.x, tgt.y)
	var radius := []
	var probe := []
	# measure in one pass (time since cast)
	var s2 := _fresh("set", "zeus")
	s2.set_fog_reveal_all(false)
	s2.cast_power(1, "vision", tgt.x, tgt.y)
	var t0: float = float(s2.get_time())
	for want in [0.0, 1.0, 2.0, 4.0, 10.0, 19.5, 21.0]:
		while float(s2.get_time()) - t0 < want - 1e-6:
			s2.tick(1)
		var ev: Dictionary = s2.get_egypt_powers()
		var vis: PackedFloat32Array = ev.visions
		radius.append(_r(vis[5]) if vis.size() >= 6 else -1.0)
		s2.fog_recompute()
		probe.append([s2.is_visible(tgt.x + 30.0, tgt.y), s2.is_visible(tgt.x, tgt.y)])
	r["radius at 0 / 1 / 2 / 4 / 10 / 19.5 / 21 s"] = radius
	r["visible 30 tiles off / centre"] = probe
	var ok: bool = not r["enemy start visible before"] and r["cast"] and radius[0] == 6.0 and radius[1] == 15.0 and radius[2] == 24.0 and radius[3] == 42.0
	ok = ok and radius[4] == 42.0 and radius[6] == -1.0 and probe[0][1] and not probe[0][0] and probe[4][0] and not probe[6][1]
	_check("vision.reveal", ok, r)

# Eclipse ------------------------------------------------------------------------------

func _first_hit(sim: Object, att: int, tgt: int, max_s := 20.0) -> float:
	sim.take_events()
	sim.order(att, {"type": "attack", "target": tgt})
	for t in int(max_s * FPS):
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and int(e.other) == att and int(e.id) == tgt:
				return float(e.amount)
	return -1.0

# the myth units' later-age bonus (EGYPT.md 5; Retold gives +20 % per age for the Serpent, the
# same rule for every trainable myth unit: GodPowers::myth_age_mult, MYTH_AGE)
const MYTH_AGE_UNITS := ["anubite", "wadjet", "sphinx", "petsuchos", "roc", "scarab", "scorpion_man", "mummy", "avenger", "phoenix"]

# the Scarab's Causticity (70 divine to the enemies within 3.6 tiles when it dies) in a fresh
# Ra / Bast / Sekhmet / Osiris match at `age`, with or without Bast's Eclipse: the hp a P2 hoplite
# 2 tiles off loses (it goes through damage_mult like every other ability)
func _causticity(age: int, eclipse: bool) -> float:
	var sim := _fresh("ra", "zeus", age, ["bast", "sekhmet", "osiris"])
	if eclipse:
		if not bool(sim.cast_power(1, "eclipse", 0, 0)):
			return -1.0
	var sc := _u(sim, "scarab", 1, 0, 0)
	var h := _u(sim, "hoplite", 2, 2, 0)
	sim.tick(1)
	var h0 := _hp(sim, h)
	sim.kill_unit(sc)
	sim.tick(10)
	return _r(h0 - _hp(sim, h))

func _case_myth_ages() -> void:
	var r := {}
	var ok := true
	# every unit at every age from its own: hp and damage x(1 + 0.2 x ages past its own)
	var table := {}
	for age in [1, 2, 3]:
		var sim := _fresh("ra", "zeus", age, ["bast", "sobek", "osiris"])
		var row := {}
		for t in MYTH_AGE_UNITS:
			var d: Dictionary = sim.get_unit_def(t)
			if int(d.min_age) > age:
				continue
			var u := _u(sim, t, 1, 0, 0)
			sim.tick(1)
			var st: Dictionary = sim.get_unit_stats(u)
			var k: float = 1.0 + 0.2 * (int(age) - int(d.min_age))
			var dmg := float(d.attack.damage) if d.has("attack") else 0.0
			row[t] = [_r(float(st.max_hp)), _r(float(st.damage))]
			ok = ok and _near(float(st.max_hp), float(d.hp) * k, 0.01) and _near(float(st.damage), dmg * k, 0.01)
			sim.kill_unit(u)
		# a Greek myth unit: as before in every age
		var mi := _u(sim, "minotaur", 2, 20, 0)
		sim.tick(1)
		var ms: Dictionary = sim.get_unit_stats(mi)
		row["greek minotaur"] = [_r(float(ms.max_hp)), _r(float(ms.damage))]
		ok = ok and float(ms.max_hp) == float(sim.get_unit_def("minotaur").hp) and float(ms.damage) == float(sim.get_unit_def("minotaur").attack.damage)
		table["age %d" % age] = row
	r["max hp / damage per age"] = table
	# blows measured: a Sphinx on a hoplite (15 x 0.7 hack + 9 crush x 0.01), its Whirlwind on a 2nd hoplite, its
	# crush on a House (15 x 0.35 + 9 x 0.95), Classical vs Mythic
	var blows := []
	var whirl := []
	var house := []
	for age in [1, 3]:
		var sim := _fresh("ra", "zeus", age, ["bast", "sobek", "osiris"])
		var sp := _u(sim, "sphinx", 1, 0, 0)
		var h1 := _u(sim, "hoplite", 2, 1.2, 0)
		var h2 := _u(sim, "hoplite", 2, 0.6, 1.0)
		sim.tick(1)
		blows.append(_r(_first_hit(sim, sp, h1)))
		var wd := _damage_by(sim, 16.0, func(e): return int(e.id) == h2 and int(e.other) == 0)
		whirl.append(_r(float(wd.get(h2, 0.0))))
		sim.kill_unit(sp)
		var hs := _b(sim, "house", 2, 12, 12)
		var s2 := _u(sim, "sphinx", 1, 10.4, 12)
		sim.tick(1)
		house.append(_r(_first_hit(sim, s2, hs)))
	r["sphinx blow on a hoplite [classical, mythic]"] = blows
	r["whirlwind on the 2nd hoplite in 16 s [classical, mythic]"] = whirl
	r["sphinx blow on a house [classical, mythic]"] = house
	ok = ok and _near(blows[0], 15 * 0.7 + 9 * 0.01, 0.02) and _near(blows[1], (15 * 0.7 + 9 * 0.01) * 1.4, 0.02)
	ok = ok and whirl[0] > 1.0 and _near(whirl[1] / whirl[0], 1.4, 0.02)
	ok = ok and _near(house[0], 15 * 0.35 + 9 * 0.95, 0.02) and _near(house[1], (15 * 0.35 + 9 * 0.95) * 1.4, 0.02)
	# a Sphinx alive through a real age-up (Classical -> Heroic): its hp re-based, its wound kept
	# in proportion; one trained after the age-up gets it too
	var s3 := _fresh("ra", "zeus", 1, ["bast", "sobek"])
	s3.set_player_resources(1, {"food": 9000, "wood": 9000, "gold": 9000, "favor": 200})
	var tm := _b(s3, "temple", 1, 0, -8)
	_b(s3, "armory", 1, -8, -8)
	var old := _u(s3, "sphinx", 1, 0, 6)
	s3.tick(1)
	s3.damage(old, 100.0)
	var before := [_r(_hp(s3, old)), _r(float(s3.get_unit(old).max_hp))]
	var adv: Dictionary = s3.advance_age(1)
	var t := 0
	while int(s3.get_player(1).age) < 2 and t < 30 * 120:
		s3.tick(1)
		t += 1
	var after := [_r(_hp(s3, old)), _r(float(s3.get_unit(old).max_hp))]
	r["advance to heroic"] = {"ok": adv.ok, "reason": adv.get("reason", ""), "age": int(s3.get_player(1).age)}
	r["sphinx through the age-up [hp, max] before / after"] = [before, after]
	ok = ok and bool(adv.ok) and int(s3.get_player(1).age) == 2 and after[1] == 360.0 and _near(after[0], before[0] * 1.2, 0.5)
	s3.train(tm, "sphinx")
	_step(s3, 19.0)
	var trained := []
	for u in _units_of(s3, 1, "sphinx"):
		if u != old:
			trained.append(_r(float(s3.get_unit(u).max_hp)))
	r["sphinx trained in the heroic age: max hp"] = trained
	ok = ok and trained.size() == 1 and trained[0] == 360.0
	# the Scarab's Causticity (an ability like the Whirlwind): 70 in the Heroic Age, 84 in the Mythic
	var ca := [_causticity(2, false), _causticity(3, false)]
	r["scarab causticity on a hoplite [heroic, mythic]"] = ca
	ok = ok and _near(ca[0], 70.0, 0.01) and _near(ca[1], 70.0 * 1.2, 0.01)
	_check("myth.ages", ok, r)

# Bast's Eclipse: +20 % damage for the caster's myth units, abilities included (EGYPT.md 5.3):
# the Anubite's Jump, the Wadjet's venom, the Mummy's curse (its hit and its damage over time),
# each measured in a fresh match with and without the Eclipse. The myth units are spawned after
# the 30-tick ability rescan has passed with none on the map, so the first one uses its ability
# at once (an Anubite 5 tiles from his foe leaps). Force of the West Wind (+15 % crush for the
# siege and myth units) on the Sphinx's 9 crush.
func _case_eclipse_abilities() -> void:
	var r := {}
	var jump := []
	var venom := []
	var curse := []
	for on in [false, true]:
		var sim := _fresh("ra", "zeus", 1, ["bast"])
		if on:
			r["cast"] = sim.cast_power(1, "eclipse", 0, 0)
		sim.tick(35)
		# Anubite Jump onto a hoplite 5 tiles off: 15 x (1 - 0.3 hack armor)
		var an := _u(sim, "anubite", 1, -12, 0)
		var jh := _u(sim, "hoplite", 2, -7, 0)
		sim.tick(1)
		sim.order(an, {"type": "attack", "target": jh})
		var jdm := _damage_by(sim, 1.0, func(e): return int(e.id) == jh and int(e.other) == 0)
		jump.append(_r(float(jdm.get(jh, -1.0))))
		sim.kill_unit(an)
		# Wadjet venom: 2.5 / s for 5 s after a hit
		var wj := _u(sim, "wadjet", 1, 0, 12)
		var vh := _u(sim, "hoplite", 2, 6, 12)
		sim.tick(1)
		_first_hit(sim, wj, vh)
		sim.order(wj, {"type": "move", "x": C.x - 10.0, "z": C.y + 12.0})
		# (each 0.5 s tick of it: an Eclipse's faster Wadjet may land a second spit that restarts it)
		var tick_max := 0.0
		for t in int(round(5.6 * FPS)):
			sim.tick(1)
			for e in sim.take_events():
				if e.type == "unit:damaged" and int(e.id) == vh and int(e.other) == 0:
					tick_max = maxf(tick_max, float(e.amount))
		venom.append(_r(tick_max, 4))
		sim.kill_unit(wj)
		# Mummy curse: its hit and its damage over time on a hoplite (the first 3 s)
		var mm := _u(sim, "mummy", 1, 12, -12)
		var ch := _u(sim, "hoplite", 2, 17, -12)
		sim.tick(1)
		sim.order(mm, {"type": "attack", "target": ch})
		var cd := _damage_by(sim, 3.0, func(e): return int(e.id) == ch and int(e.other) == 0)
		curse.append(_r(float(cd.get(ch, 0.0))))
	r["anubite jump [day, eclipse]"] = jump
	r["wadjet venom per 0.5 s tick [day, eclipse]"] = venom
	r["mummy curse hit + dot over 3 s [day, eclipse]"] = curse
	# the Scarab's Causticity on its death: x1.2 under the Eclipse, on top of the later-age x1.2
	var caus := [_causticity(2, false), _causticity(2, true), _causticity(3, false), _causticity(3, true)]
	r["scarab causticity [heroic, heroic + eclipse, mythic, mythic + eclipse]"] = caus
	var ok: bool = r.get("cast", false) and _near(jump[0], 15.0 * 0.7, 0.01) and _near(jump[1], 15.0 * 0.7 * 1.2, 0.01)
	ok = ok and _near(venom[0], 1.25, 0.001) and _near(venom[1], 1.5, 0.001)
	ok = ok and curse[0] > 1.0 and _near(curse[1] / curse[0], 1.2, 0.01)
	ok = ok and _near(caus[0], 70.0, 0.01) and _near(caus[1], 84.0, 0.01) and _near(caus[2], 84.0, 0.01) and _near(caus[3], 100.8, 0.01)
	# Force of the West Wind on the Sphinx's crush part
	var hits := []
	for ww in [false, true]:
		var s3 := _fresh("set", "zeus", 2, ["ptah", "sekhmet"])
		if ww:
			s3.grant_tech(1, "force_of_the_west_wind")
		var hs := _b(s3, "house", 2, 6, 0)
		var sph := _u(s3, "sphinx", 1, 4.4, 0)
		s3.tick(1)
		hits.append(_r(_first_hit(s3, sph, hs)))
	# on a Greek House: 15 hack x0.35 + 9 crush x0.95 -> + 9 x1.15 crush
	r["sphinx blow on a house [before, force of the west wind]"] = hits
	# (a Classical Sphinx in the Heroic Age: x1.2 on both parts, myth_ages)
	ok = ok and _near(hits[0], (15 * 0.35 + 9 * 0.95) * 1.2, 0.02) and _near(hits[1], (15 * 0.35 + 9 * 1.15 * 0.95) * 1.2, 0.02)
	_check("eclipse.abilities_and_west_wind", ok, r)

func _case_eclipse() -> void:
	var r := {}
	var hits := []
	var speeds := []
	var taken := []
	for on in [false, true]:
		var sim := _fresh("ra", "zeus", 1, ["bast"])
		var sph := _u(sim, "sphinx", 1, 0, 0)
		var hop := _u(sim, "hoplite", 2, 1.4, 0)
		sim.tick(1)
		if on:
			r["cast"] = sim.cast_power(1, "eclipse", 0, 0)
			sim.tick(1)
		speeds.append(_r(float(sim.get_unit_stats(sph).speed)))
		hits.append(_r(_first_hit(sim, sph, hop)))
		# what a hoplite blow does to the sphinx
		var hop2 := _u(sim, "hoplite", 2, -1.4, 0)
		sim.tick(1)
		taken.append(_r(_first_hit(sim, hop2, sph)))
	r["sphinx blow on a hoplite [day, eclipse]"] = hits
	r["sphinx speed"] = speeds
	r["hoplite blow on the sphinx"] = taken
	var ok: bool = r.get("cast", false) and _near(hits[1] / hits[0], 1.2, 0.01) and _near(speeds[1] / speeds[0], 1.15, 0.001)
	# -10 % hack vulnerability: the Sphinx's 0.3375 hack armor + 10 points = 0.4375 (TECHS.md)
	ok = ok and _near(taken[1], 9.0 * (1.0 - 0.4375), 0.01) and _near(taken[0], 9.0 * (1.0 - 0.3375), 0.01)
	# Monuments +50 % favor, one Eclipse at a time, 55 s
	var s2 := _fresh("ra", "isis", 1, ["bast"])
	s2.set_minor_god(2, 1, "bast")
	# the power button's tooltip (get_power_def desc, shown by the HUD) says what the sim does:
	# -10 % vulnerability (+10 armor points), never "10 % less damage" (a blow above is x0.849)
	var tip := str(s2.get_power_def("eclipse").get("desc", ""))
	r["tooltip"] = tip
	ok = ok and tip.contains("-10% hack / pierce / crush vulnerability (+10 armor)") and not tip.contains("less damage")
	s2.set_player_resources(1, {"favor": 0})
	s2.set_player_resources(2, {"favor": 200})
	_b(s2, "monument_villagers", 1, 10, 10)
	_b(s2, "monument_soldiers", 1, 14, 10)
	s2.tick(1)
	var f0 := _favor(s2, 1)
	_step(s2, 20.0)
	var day := (_favor(s2, 1) - f0) / 20.0
	s2.set_player_resources(1, {"favor": 100})
	s2.cast_power(1, "eclipse", 0, 0)
	r["second eclipse (isis)"] = str(s2.get_power_info(2, "eclipse").reason)
	f0 = _favor(s2, 1)
	_step(s2, 20.0)
	var dark := (_favor(s2, 1) - f0) / 20.0
	_step(s2, 36.0)
	r["after 56 s, isis can"] = bool(s2.get_power_info(2, "eclipse").can)
	r["favor/s day / eclipse"] = [_r(day, 4), _r(dark, 4)]
	ok = ok and _near(dark / day, 1.5, 0.01) and _near(day, (4.5 + 6.0) / 60.0, 1e-3) and r["second eclipse (isis)"] == "An Eclipse is already darkening the sky" and r["after 56 s, isis can"]
	_check("eclipse.myth_and_favor", ok, r)

# Shifting Sands ------------------------------------------------------------------------

func _case_sands() -> void:
	var sim := _fresh("set", "zeus", 1, ["ptah"])
	var ids := []
	for i in 5:
		ids.append(_u(sim, "spearman", 1, -14 + i * 1.0, 0.5 * i))
	var far := _u(sim, "spearman", 1, -14, 9)   # outside the 6-tile circle
	var scout := _u(sim, "spearman", 1, 14, 0)  # gives sight at the destination
	sim.tick(1)
	var p0: Dictionary = sim.get_unit(ids[2])
	var r := {}
	r["too close (20 tiles)"] = sim.cast_power2(1, "shifting_sands", C.x - 12, C.y, C.x + 8, C.y)
	r["too close reason"] = sim.last_cast_reason()
	r["unseen (far corner)"] = sim.cast_power2(1, "shifting_sands", C.x - 12, C.y, 3.0, 3.0)
	r["unseen reason"] = sim.last_cast_reason()
	r["cast to 26 tiles"] = sim.cast_power2(1, "shifting_sands", C.x - 12, C.y, C.x + 14, C.y)
	_step(sim, 2.9)
	var mid: Dictionary = sim.get_unit(ids[2])
	_step(sim, 0.3)
	var p1: Dictionary = sim.get_unit(ids[2])
	var pf: Dictionary = sim.get_unit(far)
	r["moved at 2.9 s"] = _r(Vector2(float(mid.x), float(mid.z)).distance_to(Vector2(float(p0.x), float(p0.z))))
	r["moved at 3.2 s"] = _r(Vector2(float(p1.x), float(p1.z)).distance_to(Vector2(float(p0.x), float(p0.z))))
	r["teleported"] = int(sim.get_power_stats(1).teleported)
	r["the unit outside stayed"] = _r(Vector2(float(pf.x), float(pf.z)).distance_to(Vector2(C.x - 14, C.y + 9)))
	var ok: bool = not r["too close (20 tiles)"] and r["too close reason"] == "The destination must be at least 40 m away" and not r["unseen (far corner)"]
	ok = ok and r["unseen reason"] == "The destination must be visible" and r["cast to 26 tiles"] and r["moved at 2.9 s"] < 0.5 and _near(r["moved at 3.2 s"], 26.0, 0.6)
	ok = ok and r["teleported"] == 5 and r["the unit outside stayed"] < 0.5
	_check("sands.teleport", ok, r)

# Plague of Serpents -------------------------------------------------------------------

func _case_serpents() -> void:
	var sim := _fresh("isis", "zeus", 1, ["anubis"])
	var r := {}
	r["cast"] = sim.cast_power(1, "plague_of_serpents", C.x, C.y)
	var counts := []
	var t0: float = float(sim.get_time())
	for want in [0.05, 3.05, 6.05, 18.05, 25.0]:
		while float(sim.get_time()) - t0 < want:
			sim.tick(1)
		counts.append(_units_of(sim, 1, "serpent").size())
	r["serpents at 0 / 3 / 6 / 18 / 25 s"] = counts
	var sp: Array = _units_of(sim, 1, "serpent")
	var within := true
	for id in sp:
		var u: Dictionary = sim.get_unit(id)
		if Vector2(float(u.x), float(u.z)).distance_to(Vector2(C)) > 8.6 + 0.6:
			within = false
	r["all within 14 m (8.4 tiles) of the target"] = within
	r["uncontrolled"] = sim.is_uncontrolled(sp[0]) if sp.size() > 0 else false
	# an enemy walks in: they go for it
	var hop := _u(sim, "hoplite", 2, 4.0, 4.0)
	var dmg := _damage_by(sim, 6.0, func(e): return int(e.id) == hop)
	r["damage on a hoplite that came near (6 s)"] = _r(float(dmg.get(hop, 0.0)))
	r["serpent stats"] = sim.get_unit_def("serpent").hp
	var ok: bool = r["cast"] and counts == [2, 4, 6, 14, 14] and within and r["uncontrolled"] and r["damage on a hoplite that came near (6 s)"] > 20
	_check("serpents.waves", ok, r)

# Locust Swarm --------------------------------------------------------------------------

func _case_locusts() -> void:
	var sim := _fresh("ra", "zeus", 2, ["bast", "sobek"])
	var hop := _u(sim, "hoplite", 2, 0, 0)
	var own := _u(sim, "spearman", 1, 2.0, -2.0)
	var farm := _b(sim, "farm", 2, 6, -1)
	sim.tick(1)
	var h0 := _hp(sim, hop)
	var o0 := _hp(sim, own)
	var f0 := _bhp(sim, farm)
	var r := {}
	r["cast (heading +x)"] = sim.cast_power2(1, "locust_swarm", C.x - 3, C.y, C.x + 10, C.y)
	var ev: Dictionary = sim.get_egypt_powers()
	r["swarms"] = ev.swarms.size() / 9
	# only the swarms' damage (no attacker): the two men may also fight each other
	var pd := _damage_by(sim, 1.0, func(e): return int(e.other) == 0)
	var lost_1s := float(pd.get(hop, 0.0))
	var own_1s := float(pd.get(own, 0.0))
	var ev1: Dictionary = sim.get_egypt_powers()
	var x_1s: float = ev1.swarms[1 * 9 + 1] if ev1.swarms.size() >= 18 else 0.0
	_step(sim, 4.0)
	var farm_lost := f0 - _bhp(sim, farm)
	var ev5: Dictionary = sim.get_egypt_powers()
	var x_5s: float = ev5.swarms[1 * 9 + 1] if ev5.swarms.size() >= 18 else 0.0
	_step(sim, 16.0)
	r["swarms after 21 s"] = sim.get_egypt_powers().swarms.size() / 9
	r["hoplite hp lost in 1 s (swarms over it)"] = _r(lost_1s)
	r["own spearman hp lost in 1 s"] = _r(own_1s)
	r["swarm speed [tiles/s]"] = _r((x_5s - x_1s) / 4.0)
	r["farm hp lost"] = _r(farm_lost)
	r["farm damage counted"] = _r(float(sim.get_power_stats(1).farm_damage))
	# a hoplite under n swarms loses 3.5 n / s; the own man 0.35 n / s; the farm x6
	var ok: bool = r["cast (heading +x)"] and r["swarms"] == 5 and r["swarms after 21 s"] == 0 and _near(r["swarm speed [tiles/s]"], 1.8, 0.01)
	# (damage lands every 0.25 s, i.e. every 8th tick: 3.5 x 8 / 30 per swarm a pulse; the own man x0.1)
	ok = ok and lost_1s > 3.4 and _near(fposmod(lost_1s + 0.001, 3.5 * 8.0 / 30.0), 0.0, 0.01) and own_1s > 0 and _near(fposmod(own_1s + 0.0001, 0.35 * 8.0 / 30.0), 0.0, 0.001) and farm_lost > 20.9 * 2
	_check("locusts.swarms", ok, r)

# Citadel --------------------------------------------------------------------------------

func _case_citadel() -> void:
	var sim := _fresh("ra", "zeus", 2, ["bast", "sekhmet"])
	var tc: int = _buildings_of(sim, 1, "town_center")[0]
	var b: Dictionary = sim.get_building(tc)
	var r := {}
	var hp0 := float(b.max_hp)
	sim.tick(2)
	var pop0 := int(sim.get_player(1).pop_cap)
	r["cast on open ground"] = sim.cast_power(1, "citadel", C.x, C.y)
	r["reason"] = sim.last_cast_reason()
	r["cast on the TC"] = sim.cast_power(1, "citadel", float(b.x), float(b.z))
	sim.tick(2)
	r["max hp before / after"] = [hp0, float(sim.get_building(tc).max_hp)]
	r["pop cap before / after"] = [pop0, int(sim.get_player(1).pop_cap)]
	# train time: a Laborer 11.33 s -> / 1.25
	sim.train(tc, "laborer")
	var t := 0
	while sim.get_building(tc).queue.size() > 0 and t < 30 * 20:
		sim.tick(1)
		t += 1
	r["laborer trained in [s]"] = _r(t / 30.0, 2)
	# arrows: an enemy hoplite in range takes three arrows a volley of 6 x1.2
	var hop := int(sim.spawn_unit("hoplite", 2, float(b.x) + 6.0, float(b.z) + 6.0, 0.0))
	var arrows := []
	for i in 30 * 4:
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and int(e.id) == hop:
				arrows.append([_r(float(sim.get_time()), 2), _r(float(e.amount))])
	r["arrows on a hoplite (4 s)"] = arrows
	var ok: bool = not r["cast on open ground"] and r["reason"] == "Target your or an ally's Town Center" and r["cast on the TC"]
	ok = ok and r["max hp before / after"][1] - hp0 == 1200 and r["pop cap before / after"][1] - pop0 == 10 and _near(r["laborer trained in [s]"], 11.33 / 1.25, 0.05)
	# Retold: the Egyptian TC's 2 arrows + the Citadel's 1 = 3 arrows a volley (one hoplite: all three on him at once)
	ok = ok and arrows.size() >= 6 and arrows[0][0] == arrows[1][0] and arrows[1][0] == arrows[2][0] and arrows[3][0] != arrows[2][0] and _near(arrows[0][1], 6.0 * 1.2 * (1.0 - 0.3), 0.01)
	_check("citadel.center", ok, r)

# Ancestors -------------------------------------------------------------------------------

func _case_ancestors() -> void:
	var sim := _fresh("set", "zeus", 2, ["ptah", "nephthys"])
	var r := {}
	r["cast"] = sim.cast_power(1, "ancestors", C.x, C.y)
	var counts := []
	var t0: float = float(sim.get_time())
	for want in [0.05, 6.05, 12.05, 13.5, 59.9, 60.2]:
		while float(sim.get_time()) - t0 < want:
			sim.tick(1)
		counts.append(_units_of(sim, 1, "minion").size())
	r["minions at 0 / 6 / 12 / 13.5 / 59.9 / 60.2 s"] = counts
	r["minion hp / attack"] = [sim.get_unit_def("minion").hp, sim.get_unit_def("minion").attack.damage]
	var ok: bool = r["cast"] and counts == [1, 7, 13, 13, 13, 0]
	_check("ancestors.minions", ok, r)

# Son of Osiris ----------------------------------------------------------------------------

func _case_son() -> void:
	var sim := _fresh("ra", "zeus", 3, ["bast", "sobek", "osiris"])
	sim.set_player_resources(1, {"favor": 400})
	var ph: Array = _units_of(sim, 1, "pharaoh")
	var u: Dictionary = sim.get_unit(ph[0])
	var r := {}
	r["cast on nothing"] = sim.cast_power(1, "son_of_osiris", C.x, C.y)
	r["cast on the pharaoh"] = sim.cast_power(1, "son_of_osiris", float(u.x), float(u.z))
	sim.tick(1)
	var sons: Array = _units_of(sim, 1, "son_of_osiris")
	r["pharaohs / sons after"] = [_units_of(sim, 1, "pharaoh").size(), sons.size()]
	var su: Dictionary = sim.get_unit(sons[0]) if sons.size() > 0 else {}
	r["son hp"] = [su.get("hp", 0), su.get("max_hp", 0)]
	# chain lightning: five hoplites in a row near him
	var hs := []
	for i in 5:
		hs.append(int(sim.spawn_unit("hoplite", 2, float(su.x) + 6.0 + i * 1.0, float(su.z), 0.0)))
	sim.tick(1)
	sim.order(sons[0], {"type": "attack", "target": hs[0]})
	var dmg := _damage_by(sim, 5.0, func(e): return hs.has(int(e.id)))
	var struck := 0
	for id in hs:
		if dmg.has(id):
			struck += 1
	r["hoplites struck by one bolt + chain (5 s)"] = struck
	r["chained hits"] = int(sim.get_power_stats(1).chained)
	r["chain damage on the 2nd hoplite"] = _r(float(dmg.get(hs[1], 0.0)))
	_step(sim, 88.0)
	r["pharaohs 94 s later"] = _units_of(sim, 1, "pharaoh").size()
	var ok: bool = not r["cast on nothing"] and r["cast on the pharaoh"] and r["pharaohs / sons after"] == [0, 1] and float(su.get("max_hp", 0)) == 609
	ok = ok and struck >= 4 and r["chained hits"] >= 3 and r["chain damage on the 2nd hoplite"] >= 50.75 - 0.01 and r["pharaohs 94 s later"] == 1
	_check("son.osiris", ok, r)

# the Son of Osiris' own bolt is divine (EGYPT.md 3.1 / 5.3: 50.75 D, x3 vs myth), as the jumps:
# his first hit on his target goes through no armor, the same as the chain's
func _case_son_divine() -> void:
	var sim := _fresh("ra", "zeus", 3, ["bast", "sobek", "osiris"])
	sim.set_player_resources(1, {"favor": 400})
	var ph: Array = _units_of(sim, 1, "pharaoh")
	var u: Dictionary = sim.get_unit(ph[0])
	sim.cast_power(1, "son_of_osiris", float(u.x), float(u.z))
	sim.tick(1)
	var son := int(_units_of(sim, 1, "son_of_osiris")[0])
	var su: Dictionary = sim.get_unit(son)
	var r := {}
	var firsts := {}
	for kind in ["hoplite", "minotaur", "avenger"]:
		var tgt := int(sim.spawn_unit(kind, 2, float(su.x) + 7.0, float(su.z), 0.0))
		var other := int(sim.spawn_unit("hoplite", 2, float(su.x) + 8.5, float(su.z), 0.0))
		sim.tick(1)
		sim.take_events()
		sim.order(son, {"type": "attack", "target": tgt})
		var first := -1.0
		var chained := -1.0
		for t in int(4 * FPS):
			sim.tick(1)
			for e in sim.take_events():
				if e.type != "unit:damaged":
					continue
				if int(e.id) == tgt and int(e.other) == son and first < 0:
					first = float(e.amount)
				if int(e.id) == other and int(e.other) == 0 and chained < 0:
					chained = float(e.amount)
			if first >= 0 and chained >= 0:
				break
		firsts[kind] = [_r(first), _r(chained)]
		r["%s: first bolt, chain on a hoplite beside it" % kind] = firsts[kind]
		sim.kill_unit(tgt)
		sim.kill_unit(other)
		_step(sim, 3.0)
	var ok: bool = absf(firsts["hoplite"][0] - 50.75) < 0.02 and absf(firsts["hoplite"][1] - 50.75) < 0.02
	ok = ok and absf(firsts["minotaur"][0] - 152.25) < 0.02 and absf(firsts["avenger"][0] - 152.25) < 0.02
	_check("son.divine", ok, r)

# Isis' Divine Shield refuses the Egyptian (and Greek) powers in cast_check, as the real cast does
func _case_shield_preview() -> void:
	var sim := _fresh("isis", "set", 3, ["anubis", "sobek", "thoth"])
	sim.set_minor_god(2, 1, "ptah")
	sim.set_minor_god(2, 2, "sekhmet")
	sim.set_minor_god(2, 3, "horus")
	sim.set_player_resources(2, {"favor": 900})
	sim.spawn_building("monument_villagers", 1, C.x, C.y, true, false)
	sim.tick(2)
	var r := {}
	var near: Dictionary = sim.cast_check(2, "tornado", C.x + 5, C.y)
	var far: Dictionary = sim.cast_check(2, "tornado", C.x + 25, C.y)
	r["preview at 5 / 25 tiles"] = [near.ok, far.ok, near.get("reason", "")]
	r["cast at 5 tiles"] = sim.cast_power(2, "tornado", C.x + 5, C.y)
	r["cast at 25 tiles"] = sim.cast_power(2, "tornado", C.x + 25, C.y)
	var ok: bool = not near.ok and far.ok and not r["cast at 5 tiles"] and r["cast at 25 tiles"]
	_check("shield.preview", ok, r)

# Tornado -----------------------------------------------------------------------------------

func _case_tornado() -> void:
	var sim := _fresh("set", "zeus", 3, ["ptah", "sekhmet", "horus"])
	sim.set_player_resources(1, {"favor": 400})
	var house := _b(sim, "house", 2, 0, 0)
	var hop := _u(sim, "hoplite", 2, 1.0, 1.5)
	var own := _u(sim, "spearman", 1, -1.0, -2.0)
	sim.tick(1)
	var h0 := _bhp(sim, house)
	var r := {}
	var sp0 := float(sim.get_unit_stats(hop).speed)
	r["cast"] = sim.cast_power(1, "tornado", C.x + 1.5, C.y + 1.5)
	var hop_dmg := []
	var first := {}
	for i in 30:
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and int(e.id) == hop and hop_dmg.size() < 2:
				hop_dmg.append(_r(float(e.amount)))
	r["first pulses on the hoplite"] = hop_dmg
	r["house hp lost in the first 1 s"] = _r(h0 - _bhp(sim, house))
	r["hoplite speed before / slowed"] = [_r(sp0), _r(float(sim.get_unit_stats(hop).speed)) if _alive(sim, hop) else -1.0]
	r["thrown"] = int(sim.get_power_stats(1).thrown)
	var ev: Dictionary = sim.get_egypt_powers()
	var t0 := Vector2(ev.tornadoes[5], ev.tornadoes[6]) if ev.tornadoes.size() >= 8 else Vector2()
	_step(sim, 10.0)
	ev = sim.get_egypt_powers()
	var t1 := Vector2(ev.tornadoes[5], ev.tornadoes[6]) if ev.tornadoes.size() >= 8 else Vector2()
	r["moved from the target after 11 s"] = _r(t1.distance_to(Vector2(C.x + 1.5, C.y + 1.5)))
	_step(sim, 10.0)
	r["tornadoes after 21 s"] = sim.get_egypt_powers().tornadoes.size() / 8
	# the hoplite at ~0.7 tiles (full): 25 x (1 - 0.3) + 100 x 0.01 = 18.5; the house (Greek, flat):
	# 25 x 0.5 + 100 x 0.95 = 107.5 a pulse
	var ok: bool = r["cast"] and hop_dmg.size() >= 1 and _near(hop_dmg[0], 18.5, 0.01) and r["house hp lost in the first 1 s"] >= 107.5 * 1.5
	ok = ok and (r["hoplite speed before / slowed"][1] < 0 or _near(r["hoplite speed before / slowed"][1], sp0 * 0.65, 0.01)) and r["thrown"] >= 1
	ok = ok and r["moved from the target after 11 s"] > 4.0 and r["tornadoes after 21 s"] == 0
	_check("tornado.spiral", ok, r)

# Thoth's Meteor ----------------------------------------------------------------------------

func _case_meteor() -> void:
	var sim := _fresh("isis", "zeus", 3, ["anubis", "sobek", "thoth"])
	sim.set_player_resources(1, {"favor": 400})
	var house := _b(sim, "house", 2, 0, 0)
	var hops := []
	for i in 6:
		hops.append(_u(sim, "hoplite", 2, 6.0 + i * 0.8, 6.0))
	sim.tick(1)
	var h0 := _bhp(sim, house)
	var r := {}
	r["cast"] = sim.cast_power(1, "thoth_meteor", C.x + 0.5, C.y + 0.5)
	var landed := []
	var t0: float = float(sim.get_time())
	var house_hit := -1.0
	var hop_hit := -1.0
	while float(sim.get_time()) - t0 < 19.0:
		var n0 := int(sim.get_power_stats(1).meteors_landed)
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and hops.has(int(e.id)) and hop_hit < 0:
				hop_hit = float(e.amount)
		if int(sim.get_power_stats(1).meteors_landed) > n0:
			landed.append(_r(float(sim.get_time()) - t0, 2))
		if house_hit < 0 and _bhp(sim, house) < h0:
			house_hit = h0 - _bhp(sim, house)
	r["landings [s after the cast]"] = landed
	r["first blast on the house"] = _r(house_hit)
	r["blast on a hoplite"] = _r(hop_hit)
	# house (Greek, 5 % crush): 580 x 0.95 + 40 = 591; hoplite (99 %): 5.8 + 40 = 45.8
	var ok: bool = r["cast"] and landed.size() == 12 and _near(landed[0], 3.0, 0.1) and _near(landed[1], 6.0, 0.1) and _near(landed[2], 7.2, 0.1) and _near(landed[11], 18.0, 0.1)
	ok = ok and _near(house_hit, 591.0, 0.01) and _near(hop_hit, 45.8, 0.01)
	_check("meteor.thoth", ok, r)

# myth units -------------------------------------------------------------------------------

func _case_myth() -> void:
	var r := {}
	var sim := _fresh("ra", "zeus", 1, ["bast"])
	var tm := _b(sim, "temple", 1, 0, 0)
	sim.set_player_resources(1, {"food": 5000, "wood": 5000, "gold": 5000, "favor": 200})
	sim.tick(1)
	r["ra/bast: sphinx"] = sim.train(tm, "sphinx")
	r["ra/bast: wadjet"] = sim.train(tm, "wadjet")
	r["ra/bast: petsuchos (heroic)"] = sim.train(tm, "petsuchos")
	r["ra/bast: anubite (isis' / set's)"] = sim.train(tm, "anubite")
	var gt := _b(sim, "temple", 2, 14, 0)
	sim.set_player_resources(2, {"food": 5000, "wood": 5000, "gold": 5000, "favor": 200})
	sim.tick(1)
	r["greek: sphinx"] = sim.train(gt, "sphinx")
	var ok: bool = bool(r["ra/bast: sphinx"].ok) and str(r["ra/bast: wadjet"].reason) == "Requires the minor god Ptah" and str(r["ra/bast: petsuchos (heroic)"].reason) == "Requires Heroic Age"
	ok = ok and not bool(r["ra/bast: anubite (isis' / set's)"].ok) and not bool(r["greek: sphinx"].ok)
	_step(sim, 18.0)
	r["sphinxes trained"] = _units_of(sim, 1, "sphinx").size()
	ok = ok and r["sphinxes trained"] == 1
	_check("myth.trained_with_their_god", ok, r)
	# abilities
	var a := {}
	var s2 := _fresh("set", "zeus", 3, ["ptah", "sekhmet", "horus"])
	# Wadjet venom: 2.5 / s for 5 s after its hit
	var wj := _u(s2, "wadjet", 1, 0, 0)
	var vh := _u(s2, "hoplite", 2, 6, 0)
	s2.tick(1)
	var hit := _first_hit(s2, wj, vh)
	s2.order(wj, {"type": "move", "x": C.x - 10.0, "z": C.y})
	var vh0 := _hp(s2, vh)
	var venom := _damage_by(s2, 5.6, func(e): return int(e.id) == vh and int(e.other) == 0)
	a["wadjet hit / venom over 5 s"] = [_r(hit), _r(float(venom.get(vh, 0.0)))]
	# Scarab Causticity: 70 to enemies near it when it dies (a Heroic Scarab in the Mythic Age: x1.2, myth_ages)
	var sc := _u(s2, "scarab", 1, -10, 10)
	var near := _u(s2, "hoplite", 2, -9, 10)
	s2.tick(1)
	var n0 := _hp(s2, near)
	s2.kill_unit(sc)
	s2.tick(2)
	a["causticity on a hoplite beside the scarab"] = _r(n0 - _hp(s2, near))
	# Avenger Spin: 100 hack over 5 s to the enemies round it
	var av := _u(s2, "avenger", 1, 10, 10)
	var ring := []
	for i in 3:
		ring.append(_u(s2, "hoplite", 2, 10.0 + cos(i * 2.1) * 1.4, 10.0 + sin(i * 2.1) * 1.4))
	s2.tick(1)
	s2.order(av, {"type": "attack", "target": ring[0]})
	var spin := _damage_by(s2, 5.5, func(e): return ring.has(int(e.id)) and int(e.other) == 0)
	a["spin damage on the 2nd / 3rd hoplite (5 s)"] = [_r(float(spin.get(ring[1], 0.0))), _r(float(spin.get(ring[2], 0.0)))]
	# (a Classical Wadjet in the Mythic Age: venom x1.4, myth_ages; the Avenger is Mythic: x1)
	_check("myth.abilities_a", _near(a["wadjet hit / venom over 5 s"][1], 12.5 * 1.4, 0.6) and _near(a["causticity on a hoplite beside the scarab"], 70.0 * 1.2, 0.01)
		and _near(float(spin.get(ring[1], 0.0)), 100.0 * 0.7, 6.0), a)
	var b := {}
	var s3 := _fresh("isis", "zeus", 3, ["anubis", "nephthys", "thoth"])
	# Phoenix Rebirth: an egg, a new Phoenix 50 s later
	var px := _u(s3, "phoenix", 1, 0, 0)
	s3.tick(1)
	s3.kill_unit(px)
	s3.tick(2)
	b["eggs after the phoenix fell"] = _units_of(s3, 1, "phoenix_egg").size()
	_step(s3, 49.0)
	b["phoenixes at 49 s"] = _units_of(s3, 1, "phoenix").size()
	_step(s3, 1.5)
	b["phoenixes at 50.5 s / eggs"] = [_units_of(s3, 1, "phoenix").size(), _units_of(s3, 1, "phoenix_egg").size()]
	# Anubite Jump: onto a hoplite 5 tiles off, 15 hack through its armor
	var an := _u(s3, "anubite", 1, -12, 0)
	var jh := _u(s3, "hoplite", 2, -7, 0)
	s3.tick(1)
	s3.order(an, {"type": "attack", "target": jh})
	var jdm := _damage_by(s3, 1.0, func(e): return int(e.id) == jh and int(e.other) == 0)
	var jd := float(jdm.get(jh, -1.0))
	var an_u: Dictionary = s3.get_unit(an)
	b["anubite jump: first damage, distance after"] = [_r(jd), _r(Vector2(float(an_u.x), float(an_u.z)).distance_to(Vector2(C.x - 7, C.y)))]
	# Scorpion Man Sting: 3 stings of 4 + 1/s for 6 s on its foes
	var sm := _u(s3, "scorpion_man", 1, 12, -10)
	var sh := _u(s3, "hoplite", 2, 13.2, -10)
	s3.tick(1)
	s3.order(sm, {"type": "attack", "target": sh})
	var st := _damage_by(s3, 2.0, func(e): return int(e.id) == sh and int(e.other) == 0)
	b["sting damage on its foe (2 s)"] = _r(float(st.get(sh, 0.0)))
	_check("myth.abilities_b", b["eggs after the phoenix fell"] == 1 and b["phoenixes at 49 s"] == 0 and b["phoenixes at 50.5 s / eggs"] == [1, 0]
		and _near(jd, 15.0 * 0.7 * 1.4, 0.01) and b["anubite jump: first damage, distance after"][1] < 1.6 and b["sting damage on its foe (2 s)"] >= 12.0, b)
	# Mummy Reincarnation: a cursed villager that dies rises as the Mummy owner's Minion
	var c := {}
	var s4 := _fresh("ra", "zeus", 3, ["bast", "sobek", "osiris"])
	var mm := _u(s4, "mummy", 1, 0, 0)
	var vil := _u(s4, "villager", 2, 5, 0)
	s4.tick(1)
	s4.order(mm, {"type": "attack", "target": vil})
	var t := 0
	while _alive(s4, vil) and t < 30 * 20:
		s4.tick(1)
		t += 1
	s4.tick(2)
	c["villager killed after [s]"] = _r(t / 30.0, 2)
	c["minions of player 1"] = _units_of(s4, 1, "minion").size()
	c["minions raised"] = int(s4.get_power_stats(1).minions_raised)
	_check("myth.mummy_curse", c["minions of player 1"] == 1 and c["minions raised"] == 1, c)

# techs ------------------------------------------------------------------------------------

func _tech(sim: Object, b: int, key: String) -> Dictionary:
	for t in sim.get_techs(b):
		if str(t.key) == key:
			return t
	return {}

func _case_techs() -> void:
	var r := {}
	var sim := _fresh("ra", "zeus", 3, ["ptah", "sobek", "horus"])
	sim.set_player_resources(1, {"food": 9000, "wood": 9000, "gold": 9000, "favor": 200})
	var tc: int = _buildings_of(sim, 1, "town_center")[0]
	var tm := _b(sim, "temple", 1, 0, 0)
	var gr := _b(sim, "granary", 1, 8, 0)
	var bk := _b(sim, "eg_barracks", 1, -8, 0)
	sim.tick(1)
	# homes and god locks
	r["TC techs"] = sim.get_techs(tc).map(func(t): return "%s:%s" % [t.key, t.state])
	r["skin_of_the_rhino (ra) / flood_of_the_nile (isis) at the granary"] = [str(_tech(sim, tc, "skin_of_the_rhino").state), str(_tech(sim, gr, "flood_of_the_nile").state)]
	r["sacred_cats (bast; ra took ptah)"] = str(_tech(sim, gr, "sacred_cats").state)
	r["shaduf (ptah) at the granary"] = str(_tech(sim, gr, "shaduf").state)
	var ok: bool = r["skin_of_the_rhino (ra) / flood_of_the_nile (isis) at the granary"] == ["available", "locked_god"] and r["sacred_cats (bast; ra took ptah)"] == "locked_god"
	ok = ok and r["shaduf (ptah) at the granary"] == "available"
	# Skin of the Rhino: "-25 % hack and -25 % pierce vulnerability" is 25 points more armor
	# (EGYPT.md conventions = TECHS.md: "-10 % vulnerability" is 30 % -> 40 % armor): the readout's
	# hack 0.1875 -> 0.4375, pierce 0.2625 -> 0.5125; a hoplite blow on a Laborer 9 x 0.8125 ->
	# 9 x 0.5625 (x0.6923), a toxotes arrow x 0.4875 / 0.7375 (x0.6610)
	var lab := _u(sim, "laborer", 1, 4, 4)
	var hop := _u(sim, "hoplite", 2, 5.4, 4)
	var tox := _u(sim, "toxotes", 2, 4, 9)
	sim.tick(1)
	var before := _first_hit(sim, hop, lab)
	var abefore := _first_hit(sim, tox, lab)
	var lst0: Dictionary = sim.get_unit_stats(lab)
	sim.grant_tech(1, "skin_of_the_rhino")
	var after := _first_hit(sim, hop, lab)
	var aafter := _first_hit(sim, tox, lab)
	var lst1: Dictionary = sim.get_unit_stats(lab)
	r["hoplite blow on a laborer [before, skin of the rhino, ratio]"] = [_r(before), _r(after), _r(after / before, 4)]
	r["toxotes arrow on a laborer [before, skin of the rhino, ratio]"] = [_r(abefore), _r(aafter), _r(aafter / abefore, 4)]
	r["laborer hack / pierce armor [before, skin of the rhino]"] = [[_r(lst0.hack_armor, 4), _r(lst0.pierce_armor, 4)], [_r(lst1.hack_armor, 4), _r(lst1.pierce_armor, 4)]]
	ok = ok and _near(before, 9 * (1 - 0.1875), 0.01) and _near(after, 9 * (1 - 0.4375), 0.01)
	ok = ok and _near(after / before, 0.5625 / 0.8125, 0.0005) and abefore > 0 and _near(aafter / abefore, 0.4875 / 0.7375, 0.0005)
	ok = ok and _near(float(lst0.hack_armor), 0.1875, 0.0001) and _near(float(lst0.pierce_armor), 0.2625, 0.0001)
	ok = ok and _near(float(lst1.hack_armor), 0.4375, 0.0001) and _near(float(lst1.pierce_armor), 0.5125, 0.0001)
	sim.kill_unit(hop)
	# Leather Frame Shield (Ptah): "Spearman -15 % pierce vulnerability": +0.15 pierce armor (15
	# points, as the Armory's shields), so a toxotes arrow x (1 - p - 0.15) / (1 - p), its blows untouched
	var spr := _u(sim, "spearman", 1, -4, 8)
	var tox2 := _u(sim, "toxotes", 2, -4, 13)
	var hop2 := _u(sim, "hoplite", 2, -2.6, 8)
	sim.tick(1)
	var sp_a0 := _first_hit(sim, tox2, spr)
	var sp_h0 := _first_hit(sim, hop2, spr)
	var sp_p0 := float(sim.get_unit_stats(spr).pierce_armor)
	sim.grant_tech(1, "leather_frame_shield")
	var sp_a1 := _first_hit(sim, tox2, spr)
	var sp_h1 := _first_hit(sim, hop2, spr)
	var sp_p1 := float(sim.get_unit_stats(spr).pierce_armor)
	r["spearman pierce armor [before, leather frame shield]"] = [_r(sp_p0, 4), _r(sp_p1, 4)]
	r["toxotes arrow on a spearman [before, leather frame shield, ratio]"] = [_r(sp_a0), _r(sp_a1), _r(sp_a1 / sp_a0, 4)]
	r["hoplite blow on a spearman [before, leather frame shield]"] = [_r(sp_h0), _r(sp_h1)]
	ok = ok and sp_a0 > 0 and _near(sp_p1, sp_p0 + 0.15, 0.0001) and _near(sp_a1 / sp_a0, (1 - sp_p1) / (1 - sp_p0), 0.0005) and sp_h0 > 0 and _near(sp_h1, sp_h0, 0.0001)
	sim.kill_unit(tox)
	sim.kill_unit(tox2)
	sim.kill_unit(hop2)
	sim.kill_unit(spr)
	# Shaduf: a Farm 70 -> 35 gold
	r["farm gold [before, shaduf]"] = [float(sim.get_building_def("farm", 1).cost.get("gold", 0))]
	sim.grant_tech(1, "shaduf")
	r["farm gold [before, shaduf]"].append(float(sim.get_building_def("farm", 1).cost.get("gold", 0)))
	ok = ok and r["farm gold [before, shaduf]"] == [70.0, 35.0]
	# Sun-dried Mud-brick: buildings +10 % hp, -10 % gold
	var hp0 := float(sim.get_building(gr).max_hp)
	sim.grant_tech(1, "sun_dried_mud_brick")
	r["granary hp [before, mud-brick]"] = [hp0, float(sim.get_building(gr).max_hp)]
	r["temple gold with mud-brick"] = float(sim.get_building_def("temple", 1).cost.get("gold", 0))
	ok = ok and _near(r["granary hp [before, mud-brick]"][1], hp0 * 1.1) and _near(r["temple gold with mud-brick"], 135)
	# Spear of Horus: Spearmen x3 vs cavalry, +10 % attack: 6 x 1.1 x 3 = 19.8 on a hippikon (x 0.8)
	var spm := _u(sim, "spearman", 1, -4, -6)
	var hip := _u(sim, "hippikon", 2, -2.8, -6)
	sim.tick(1)
	var sb := _first_hit(sim, spm, hip)
	sim.grant_tech(1, "spear_of_horus")
	var sa := _first_hit(sim, spm, hip)
	r["spearman blow on a hippikon [before, spear of horus]"] = [_r(sb), _r(sa)]
	ok = ok and _near(sa / sb, 1.1 * 1.5, 0.01)
	_check("techs.ra_ptah_sobek_horus", ok, r)
	# Isis / Bast / Nephthys / Osiris / Thoth: Flood of the Nile, Sacred Cats, Necropolis (Anubis: set's)
	var q := {}
	var s2 := _fresh("isis", "zeus", 3, ["anubis", "nephthys", "thoth"])
	s2.set_player_resources(1, {"food": 0, "favor": 0})
	s2.grant_tech(1, "flood_of_the_nile")
	var f0 := _res(s2, 1, "food")
	_step(s2, 10.0)
	q["flood of the nile food in 10 s"] = _r(_res(s2, 1, "food") - f0)
	# Necropolis: Monument favor x1.25
	_b(s2, "monument_villagers", 1, 10, 10)
	s2.tick(1)
	var v0 := _favor(s2, 1)
	_step(s2, 20.0)
	var fav_a := _favor(s2, 1) - v0
	s2.grant_tech(1, "necropolis")
	v0 = _favor(s2, 1)
	_step(s2, 20.0)
	q["monument favor 20 s [before, necropolis]"] = [_r(fav_a, 4), _r(_favor(s2, 1) - v0, 4)]
	# Funeral Rites: 8 gold per soldier lost
	s2.grant_tech(1, "funeral_rites")
	var g0 := _res(s2, 1, "gold")
	s2.kill_unit(_u(s2, "spearman", 1, 0, 0))
	s2.tick(2)
	q["gold refunded for a dead spearman"] = _r(_res(s2, 1, "gold") - g0)
	# New Kingdom: a second Pharaoh at once
	s2.grant_tech(1, "new_kingdom")
	s2.tick(1)
	q["pharaohs after new kingdom"] = _units_of(s2, 1, "pharaoh").size()
	# Book of Thoth: +10 % gather
	# Tusks of Apedemak: a War Elephant costs -10 %
	var mg := _b(s2, "migdol", 1, -12, 10)
	s2.set_player_resources(1, {"food": 1000, "gold": 1000})
	s2.tick(1)
	s2.grant_tech(1, "tusks_of_apedemak")
	var f1 := _res(s2, 1, "food")
	s2.train(mg, "war_elephant")
	q["war elephant food paid with tusks (180 x0.9)"] = _r(f1 - _res(s2, 1, "food"))
	var ok2: bool = _near(q["flood of the nile food in 10 s"], 10.0, 0.05) and _near(q["monument favor 20 s [before, necropolis]"][1] / q["monument favor 20 s [before, necropolis]"][0], 1.25, 0.01)
	ok2 = ok2 and q["gold refunded for a dead spearman"] == 8.0 and q["pharaohs after new kingdom"] == 2 and _near(q["war elephant food paid with tusks (180 x0.9)"], 162.0)
	_check("techs.isis_anubis_nephthys_osiris_thoth", ok2, q)
	# Crimson Linen (Sekhmet): myth units steal 25 % of their damage; Force of the West Wind: Heroic Catapults
	var w := {}
	var s3 := _fresh("set", "zeus", 2, ["ptah", "sekhmet"])
	var sw := _b(s3, "siege_works", 1, -10, -10)
	s3.set_player_resources(1, {"wood": 2000, "gold": 2000, "favor": 200, "food": 2000})
	s3.tick(1)
	w["catapult in heroic [before]"] = str(s3.train(sw, "catapult").reason)
	s3.grant_tech(1, "force_of_the_west_wind")
	w["catapult in heroic [force of the west wind]"] = bool(s3.train(sw, "catapult").ok)
	s3.grant_tech(1, "crimson_linen")
	var scb := _u(s3, "scarab", 1, 0, 0)
	var foe := _u(s3, "hoplite", 2, 1.4, 0)
	s3.tick(1)
	s3.damage(scb, 300.0)
	var st0 := float(s3.get_power_stats(1).stolen)
	var hitv := _first_hit(s3, scb, foe)
	var stolen := float(s3.get_power_stats(1).stolen) - st0
	w["scarab blow / hp regained (75 %)"] = [_r(hitv), _r(stolen)]
	var ok3: bool = w["catapult in heroic [before]"] == "Requires Mythic Age" and w["catapult in heroic [force of the west wind]"]
	ok3 = ok3 and _near(stolen, hitv * 0.75, 0.01)
	_check("techs.set_sekhmet", ok3, w)

# bounds -------------------------------------------------------------------------------------

## Every aimed Egyptian power at off-map points: cast onto the edge tile (what it makes stays
## on the map), a NaN target refused with nothing paid (PORTING.md "Map bounds").
func _case_bounds() -> void:
	var bad := []
	var setups := [["ra", ["bast", "sobek", "horus"], ["vision", "locust_swarm", "tornado", "shifting_sands", "citadel", "son_of_osiris"]],
		["isis", ["anubis", "nephthys", "thoth"], ["plague_of_serpents", "ancestors", "thoth_meteor"]],
		["set", ["ptah", "sekhmet", "horus"], ["vision", "shifting_sands", "tornado"]]]
	var cast := 0
	for st in setups:
		var sim := _fresh(st[0], "zeus", 3, st[1])
		var n := float(sim.get_map_size())
		for k in st[2]:
			if not Array(sim.player_powers(1)).has(k):
				continue
			for t in [[-50.0, -50.0], [1e9, 40.0], [INF, -INF]]:
				sim.set_player_resources(1, {"favor": 400})
				var f0 := _favor(sim, 1)
				if sim.cast_power(1, k, NAN, 30.0) or _favor(sim, 1) != f0:
					bad.append({"nan": k})
				if sim.cast_power2(1, k, t[0], t[1], t[0] + 30.0, t[1]):
					cast += 1
				_step(sim, 0.5)
			_step(sim, 4.0)
			var ev: Dictionary = sim.get_egypt_powers()
			for pair in [["visions", 6, 1], ["swarms", 9, 1], ["tornadoes", 8, 5]]:
				var a: PackedFloat32Array = ev[pair[0]]
				for i in range(0, a.size(), pair[1]):
					var x := a[i + pair[2]]
					var z := a[i + pair[2] + 1]
					if not (x >= 0.0 and z >= 0.0 and x <= n and z <= n):
						bad.append({pair[0]: [x, z]})
		_step(sim, 20.0)
		var U2: Dictionary = sim.get_units()
		var pos: PackedFloat32Array = U2.get("pos", PackedFloat32Array())
		for i in range(0, pos.size(), 2):
			if not (pos[i] >= 0.0 and pos[i + 1] >= 0.0 and pos[i] <= n and pos[i + 1] <= n):
				bad.append({"unit off the map": [pos[i], pos[i + 1]]})
	_check("bounds.off_map_targets", bad.is_empty() and cast >= 6, {"bad": bad, "casts on the edge": cast})

# determinism -------------------------------------------------------------------------------

func _scripted(seed: int) -> int:
	var sim := _fresh("set", "zeus", 3, ["anubis", "nephthys", "horus"], seed)
	for i in 12:
		_u(sim, "hoplite", 2, 4.0 + (i % 4) * 1.1, (i / 4) * 1.1)
		_u(sim, "spearman", 1, -6.0 + (i % 4) * 1.1, (i / 4) * 1.1)
	sim.set_player_resources(1, {"favor": 200})
	sim.cast_power(1, "plague_of_serpents", C.x + 4, C.y)
	_step(sim, 4.0)
	sim.set_player_resources(1, {"favor": 200})
	sim.cast_power(1, "ancestors", C.x + 2, C.y + 3)
	_step(sim, 4.0)
	sim.set_player_resources(1, {"favor": 400})
	sim.cast_power(1, "tornado", C.x + 5, C.y + 1)
	_step(sim, 20.0)
	return int(sim.units_hash())

func _case_determinism() -> void:
	var a := _scripted(seed_arg)
	var b := _scripted(seed_arg)
	_check("determinism.same_casts_same_hash", a == b and a != 0, {"hash 1": a, "hash 2": b})
	# rules off: the browser's game: everyone has the Greek powers, no Egyptian one
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(false)
	sim.new_game(3, 128, "battle", 2)
	_check("determinism.rules_off", Array(sim.player_powers(1)) == ["lightning_storm", "bolt", "meteor"] and not bool(sim.can_cast(1, "rain").ok),
		{"powers": Array(sim.player_powers(1))})


# round 2 ---------------------------------------------------------------------------------------

## A 3-player match: P1 (g1) and P3 (g3, his ally) on team 1, P2 (Zeus) on team 2.
func _fresh3(g1: String, g3: String, age: int, gods1: Array) -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := [{"id": 1, "name": "P1", "human": true, "team": 1, "god": g1}, {"id": 2, "name": "P2", "human": true, "team": 2, "god": "zeus"},
		{"id": 3, "name": "P3", "human": true, "team": 1, "god": g3}]
	var r: Dictionary = sim.start_match({"seed": seed_arg, "map_size": 192, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
		return null
	sim.set_victory_enabled(false)
	sim.set_fog_reveal_all(true)
	sim.set_record_events(true)
	for a in gods1.size():
		sim.set_minor_god(1, a + 1, gods1[a])
	for o in [1, 2, 3]:
		sim.set_player_age(o, age)
	C = _open_area(sim, 30, 30.0)
	sim.set_player_resources(1, {"favor": 900})
	sim.take_events()
	return sim

func _case_phantom() -> void:
	var r := {}
	var ok := true
	for g in [["zeus", "zeus"], ["ra", "isis"]]:
		var sim := _fresh(g[0], g[1])
		var lists := []
		for t in [0.0, 1.0, 1.5]:
			_step(sim, t)
			lists.append((sim.get_egypt_powers().timed as Array).size())
		var st: Dictionary = sim.get_power_stats(1)
		r["%s vs %s: timed powers at 0 / 1 / 2.5 s" % g] = lists
		r["%s vs %s: rain / prosperity / eclipse until" % g] = [st.rain_until, st.prosperity_until, st.eclipse_until]
		ok = ok and lists == [0, 0, 0] and float(st.rain_until) < 0 and float(st.prosperity_until) < 0 and float(st.eclipse_until) < 0
	# a cast Rain is listed (and fades 3 s after it ends)
	var s2 := _fresh("ra", "zeus")
	s2.cast_power(1, "rain", 0, 0)
	s2.tick(1)
	r["rain cast: listed"] = (s2.get_egypt_powers().timed as Array).size()
	ok = ok and r["rain cast: listed"] == 1
	_check("phantom.no_power_at_start", ok, r)

func _case_blocks() -> void:
	var r := {}
	# a Greek (P2, Zeus) in a match with Horus' Tornado
	var sim := _fresh("ra", "zeus", 3, ["bast", "sobek", "horus"])
	sim.set_player_resources(1, {"favor": 900})
	sim.set_player_resources(2, {"favor": 900})
	r["tornado"] = sim.cast_power(1, "tornado", C.x, C.y)
	sim.tick(2)
	var tz: Array = sim.get_egypt_powers().tornadoes
	var tx: float = float(tz[5]) if tz.size() > 6 else C.x
	var tzz: float = float(tz[6]) if tz.size() > 6 else C.y
	r["reason"] = str(sim.cast_check(2, "lightning_storm", tx + 2.0, tzz).reason)
	r["lightning storm 2 tiles from the funnel"] = sim.cast_power(2, "lightning_storm", tx + 2.0, tzz)
	r["lightning storm 30 tiles away"] = sim.cast_power(2, "lightning_storm", C.x + 30.0, C.y + 30.0)
	r["the caster's own vision inside"] = sim.cast_power(1, "vision", tx, tzz + 1.0)
	_step(sim, 20.0)
	r["meteor where the funnel was, after it ended"] = sim.cast_power(2, "meteor", tx + 2.0, tzz)
	var ok: bool = r["tornado"] and not r["lightning storm 2 tiles from the funnel"] and r["reason"] == "Blocked by a Tornado"
	ok = ok and r["lightning storm 30 tiles away"] and not r["the caster's own vision inside"] and r["meteor where the funnel was, after it ended"]
	# Thoth's Meteor: a Greek Meteor inside its 25 m circle refused
	var s2 := _fresh("isis", "zeus", 3, ["anubis", "nephthys", "thoth"])
	s2.set_player_resources(1, {"favor": 900})
	s2.set_player_resources(2, {"favor": 900})
	r["thoth's meteor"] = s2.cast_power(1, "thoth_meteor", C.x, C.y)
	s2.tick(2)
	r["reason 2"] = str(s2.cast_check(2, "meteor", C.x + 8.0, C.y).reason)
	r["greek meteor 8 tiles from its centre"] = s2.cast_power(2, "meteor", C.x + 8.0, C.y)
	r["greek meteor 20 tiles from it"] = s2.cast_power(2, "meteor", C.x + 20.0, C.y)
	ok = ok and r["thoth's meteor"] and not r["greek meteor 8 tiles from its centre"] and r["reason 2"] == "Blocked by Thoth's Meteor" and r["greek meteor 20 tiles from it"]
	_check("blocks.tornado_thoth_local", ok, r)

func _case_allies() -> void:
	var r := {}
	var sim := _fresh3("ra", "isis", 3, ["bast", "sekhmet", "osiris"])
	if sim == null:
		_check("allies.citadel_son", false, {"error": "no match"})
		return
	var tc3: int = _buildings_of(sim, 3, "town_center")[0]
	var tc1: int = _buildings_of(sim, 1, "town_center")[0]
	var b3: Dictionary = sim.get_building(tc3)
	var hp0 := float(b3.max_hp)
	r["citadel on the ally's TC"] = sim.cast_power(1, "citadel", float(b3.x), float(b3.z))
	sim.tick(1)
	r["ally TC max hp +"] = float(sim.get_building(tc3).max_hp) - hp0
	var tc2: int = _buildings_of(sim, 2, "town_center")[0]
	var b2: Dictionary = sim.get_building(tc2)
	r["citadel on the enemy's TC"] = sim.cast_check(1, "citadel", float(b2.x), float(b2.z)).ok
	# +10 % hack armor: a hoplite blow on a plain TC (P1's) vs the Citadel Center (P3's): Retold's
	# 50 % -> 55 % hack armor (EGYPT.md 1.7 and §2's Citadel Center row), so x0.45 / 0.50 = x0.9 of the TC's blow
	var b1: Dictionary = sim.get_building(tc1)
	var hop := int(sim.spawn_unit("hoplite", 2, float(b1.x) + float(b1.w) * 0.5 + 0.8, float(b1.z), 0.0))
	sim.tick(1)
	var plain := _first_hit(sim, hop, tc1)
	sim.kill_unit(hop)
	var hop2 := int(sim.spawn_unit("hoplite", 2, float(b3.x) + float(b3.w) * 0.5 + 0.8, float(b3.z), 0.0))
	sim.tick(1)
	var cit := _first_hit(sim, hop2, tc3)
	sim.kill_unit(hop2)
	r["hoplite blow on a TC / on the Citadel Center"] = [_r(plain), _r(cit)]
	var ok: bool = r["citadel on the ally's TC"] and r["ally TC max hp +"] == 1200.0 and not r["citadel on the enemy's TC"]
	ok = ok and plain > 0 and _near(cit, plain * 0.9, 0.02)
	# the Son of Osiris on the ally's Pharaoh
	var ph: Array = _units_of(sim, 3, "pharaoh")
	if ph.size() > 0:
		var pu: Dictionary = sim.get_unit(ph[0])
		r["son on the ally's pharaoh"] = sim.cast_power(1, "son_of_osiris", float(pu.x), float(pu.z))
		sim.tick(2)
		var sons3: Array = _units_of(sim, 3, "son_of_osiris")
		r["sons of P3 / P1"] = [sons3.size(), _units_of(sim, 1, "son_of_osiris").size()]
		if sons3.size() > 0:
			for t in ["priest", "pharaoh"]:   # (no other healer near: he cannot be healed, and heals allies 15 hp/s)
				for o in [1, 3]:
					for id in _units_of(sim, o, t):
						sim.kill_unit(id)
			var su3: Dictionary = sim.get_unit(sons3[0])
			var man := int(sim.spawn_unit("spearman", 1, float(su3.x) - 1.5, float(su3.z), 0.0))   # (P1's: an ally of P3)
			sim.tick(1)
			sim.damage(sons3[0], 300.0)
			sim.damage(man, 75.0)
			sim.tick(1)
			sim.take_events()
			var h0 := _hp(sim, sons3[0])
			var m0 := _hp(sim, man)
			var son: int = sons3[0]
			var hurt := _damage_by(sim, 2.0, func(e): return int(e.id) == son or int(e.id) == man)   # (blows taken meanwhile added back)
			r["son hp healed in 2 s"] = _r(_hp(sim, son) - h0 + float(hurt.get(son, 0.0)), 2)
			r["son hp [after the blow, 2 s on, max]"] = [h0, _hp(sim, son), float(sim.get_unit(son).max_hp)]
			r["P1 spearman healed by P3's Son in 2 s"] = _r(_hp(sim, man) - m0 + float(hurt.get(man, 0.0)), 2)
		ok = ok and r["son on the ally's pharaoh"] and r["sons of P3 / P1"] == [1, 0] and _near(float(r.get("son hp healed in 2 s", 1)), 0.0, 1e-6)
		ok = ok and _near(float(r.get("P1 spearman healed by P3's Son in 2 s", 0)), 30.0, 0.6)
	else:
		ok = false
		r["error"] = "P3 has no Pharaoh"
	_check("allies.citadel_son", ok, r)

## the trees standing within r of (x, z): [ids, tiles]
func _trees_near(sim: Object, x: float, z: float, r: float) -> Array:
	var R: Dictionary = sim.get_resources()
	var out := []
	for i in int(R.count):
		if R.type_names[R.type[i]] != "tree":
			continue
		var tx := int(R.tile[i * 2])
		var tz := int(R.tile[i * 2 + 1])
		if Vector2(tx + 0.5, tz + 0.5).distance_to(Vector2(x, z)) <= r:
			out.append([int(R.ids[i]), tx, tz, int(R.variant[i]), float(R.amount[i])])
	return out

func _densest_wood(sim: Object) -> Vector2:
	var R: Dictionary = sim.get_resources()
	var best := Vector2.ZERO
	var bn := -1
	var starts: Array = sim.get_starts()
	for i in range(0, int(R.count), 7):
		if R.type_names[R.type[i]] != "tree":
			continue
		var p := Vector2(int(R.tile[i * 2]) + 0.5, int(R.tile[i * 2 + 1]) + 0.5)
		var far := true
		for st in starts:
			if p.distance_to(Vector2(float(st.tx), float(st.tz))) < 25:
				far = false
		if not far:
			continue
		var n := _trees_near(sim, p.x, p.y, 3.0).size()
		if n > bn:
			bn = n
			best = p
	return best

func _case_trees() -> void:
	var r := {}
	var ok := true
	for k in ["tornado", "thoth_meteor"]:
		var sim := _fresh("isis" if k == "thoth_meteor" else "ra", "zeus", 3, ["anubis", "nephthys", "thoth"] if k == "thoth_meteor" else ["bast", "sobek", "horus"])
		sim.set_player_resources(1, {"favor": 900})
		var w := _densest_wood(sim)
		var n := int(sim.get_map_size())
		r[k + " cast"] = sim.cast_power(1, k, w.x, w.y)
		var at := w
		var before := []
		if k == "tornado":   # the first pulse at 0.5 s: the trees within 3 tiles (5 m) of the funnel then
			_step(sim, 0.45)
			var tz: Array = sim.get_egypt_powers().tornadoes
			at = Vector2(float(tz[5]), float(tz[6])) if tz.size() > 6 else w
			before = _trees_near(sim, at.x, at.y, 2.9)
			_step(sim, 0.1)
		else:                # the first meteor on the centre at 3 s: its 8 m (4.8 tiles) blast
			before = _trees_near(sim, at.x, at.y, 2.5)
			_step(sim, 3.2)
		var after := _trees_near(sim, at.x, at.y, 2.9 if k == "tornado" else 2.5)
		after = after.filter(func(t): return before.any(func(b): return int(b[0]) == int(t[0])))
		var walk: PackedByteArray = sim.get_walkable()
		var flat := 0
		var open := 0
		var wood_kept := true
		for t in after:
			if int(t[3]) >= 100:
				flat += 1
				if walk[int(t[2]) * n + int(t[1])] != 0:
					open += 1
			for b in before:
				if int(b[0]) == int(t[0]) and not _near(float(b[4]), float(t[4]), 0.01):
					wood_kept = false
		r[k + ": trees within 2.5 tiles of the target [before, flattened, walkable now]"] = [before.size(), flat, open]
		r[k + ": wood kept"] = wood_kept
		r[k + ": flattened (stats)"] = int(sim.get_power_stats(1).flattened)
		ok = ok and r[k + " cast"] and before.size() >= 3 and flat == after.size() and open == flat and wood_kept and int(sim.get_power_stats(1).flattened) >= flat
	_check("trees.flattened", ok, r)

func _case_split() -> void:
	var r := {}
	# the Sphinx on a Greek House: 15 hack x0.35 + 9 crush x0.95; Criosphinx: 18 x0.35 + 13.5 x0.95; both 21 / 18
	var sim := _fresh("ra", "zeus", 1, ["bast"])
	var hs := _b(sim, "house", 2, 6, 0)
	var sph := _u(sim, "sphinx", 1, 4.4, 0)
	sim.tick(1)
	var blows := [_first_hit(sim, sph, hs)]
	sim.grant_tech(1, "criosphinx")
	blows.append(_first_hit(sim, sph, hs))
	sim.grant_tech(1, "hieracosphinx")
	blows.append(_first_hit(sim, sph, hs))
	r["sphinx blow on a house [base, criosphinx, + hieracosphinx]"] = blows.map(func(v): return _r(v))
	var want := [15 * 0.35 + 9 * 0.95, 18 * 0.35 + 13.5 * 0.95, 21 * 0.35 + 18 * 0.95]
	var ok := true
	for i in 3:
		ok = ok and _near(blows[i], want[i], 0.02)
	# x0.5 vs heroes: an Anubite blow on Achilles (armor 0.55?) vs a hoplite
	var hero := _u(sim, "hero", 2, -6, 0)
	var an := _u(sim, "anubite", 1, -4.6, 0)
	sim.tick(1)
	var hb := _first_hit(sim, an, hero)
	var ha := float(sim.get_unit_stats(hero).hack_armor)
	r["anubite blow on achilles (x0.5)"] = [_r(hb), _r(11.0 * 0.5 * (1.0 - ha))]
	ok = ok and _near(hb, 11.0 * 0.5 * (1.0 - ha), 0.02)
	# the Phoenix on a House: 50 x0.35 + 65 x0.95 (a blow on a hoplite: 50 x (1 - armor) + 65 x 0.01)
	var s2 := _fresh("isis", "zeus", 3, ["anubis", "nephthys", "thoth"])
	var hs2 := _b(s2, "house", 2, 6, 0)
	var px := _u(s2, "phoenix", 1, 3.0, 0)
	s2.tick(1)
	var pb := _first_hit(s2, px, hs2)
	r["phoenix blow on a house"] = [_r(pb), _r(50 * 0.35 + 65 * 0.95)]
	ok = ok and _near(pb, 50 * 0.35 + 65 * 0.95, 0.05)
	# the Petsuchos' beam on a hoplite: 10 P at once, then 30 P + 8 D over 1 s and 2 D at once
	var s3 := _fresh("ra", "zeus", 2, ["bast", "sobek"])
	var pt := _u(s3, "petsuchos", 1, 0, 0)
	var hop := _u(s3, "hoplite", 2, 6, 0)
	s3.tick(1)
	var pa := float(s3.get_unit_stats(hop).pierce_armor)
	var h0 := _hp(s3, hop)
	var first := _first_hit(s3, pt, hop)
	s3.order(pt, {"type": "idle"})
	s3.order(hop, {"type": "idle"})
	_step(s3, 1.4)
	var total := h0 - _hp(s3, hop)
	r["petsuchos beam on a hoplite [first hit, total in 1.4 s]"] = [_r(first), _r(total)]
	r["expected [10 P, 40 P + 10 D]"] = [_r(10 * (1 - pa)), _r(40 * (1 - pa) + 10)]
	ok = ok and _near(first, 10 * (1 - pa), 0.02) and _near(total, 40 * (1 - pa) + 10, 0.1)
	# the Serpent: Retold's 50 hp / 5 hack, +20 % in the Heroic Age
	var s4 := _fresh("isis", "zeus", 1, ["anubis"])
	var d: Dictionary = s4.get_unit_def("serpent")
	r["serpent def [hp, damage, class]"] = [d.hp, d.attack.damage, d["class"]]
	s4.cast_power(1, "plague_of_serpents", C.x, C.y)
	s4.tick(2)
	var sp: Array = _units_of(s4, 1, "serpent")
	r["classical serpent hp"] = _hp(s4, sp[0]) if sp.size() > 0 else 0.0
	ok = ok and float(d.hp) == 50.0 and float(d.attack.damage) == 5.0 and str(d["class"]) == "animal" and _near(float(r["classical serpent hp"]), 50.0)
	# Tusks of Apedemak: the War Elephant's pop 3 -> 2
	var s5 := _fresh("isis", "zeus", 3, ["anubis", "nephthys", "thoth"])
	_u(s5, "war_elephant", 1, 0, 0)
	s5.tick(2)
	var p0 := int(s5.get_player(1).pop)
	s5.grant_tech(1, "tusks_of_apedemak")
	s5.tick(2)
	r["pop with a war elephant [before, tusks]"] = [p0, int(s5.get_player(1).pop)]
	ok = ok and r["pop with a war elephant [before, tusks]"][0] - r["pop with a war elephant [before, tusks]"][1] == 1
	_check("split.crush_beam_heroes_serpent_tusks", ok, r)

func _case_roc() -> void:
	var r := {}
	var sim := _fresh("ra", "zeus", 2, ["bast", "sobek"])
	var roc := _u(sim, "roc", 1, 0, 0)
	var men := []
	for i in 5:
		men.append(_u(sim, "spearman", 1, -3.0 + i * 0.8, 3.0))
	_u(sim, "hoplite", 2, 30, 30)   # (a foe far off)
	sim.tick(2)
	var pop0 := int(sim.get_player(1).pop)
	r["boarding"] = sim.roc_load(roc, PackedInt32Array(men))
	_step(sim, 6.0)
	var st: Dictionary = sim.get_roc(roc)
	var gone := 0
	for m in men:
		if not _alive(sim, m):
			gone += 1
	r["cargo after 6 s"] = (st.cargo as Array).size()
	r["spearmen out of the world"] = gone
	r["pop [before, carried]"] = [pop0, int(sim.get_player(1).pop)]
	# fly 12 tiles and set them down
	r["unload"] = sim.roc_unload(roc, C.x + 12.0, C.y)
	_step(sim, 9.0)
	var out: Array = _units_of(sim, 1, "spearman")
	var near := 0
	for id in out:
		var u: Dictionary = sim.get_unit(id)
		if Vector2(float(u.x), float(u.z)).distance_to(Vector2(C.x + 12.0, C.y)) < 4.0:
			near += 1
	r["spearmen set down near the target"] = near
	r["cargo after unloading"] = (sim.get_roc(roc).cargo as Array).size()
	var ok: bool = r["boarding"] == 5 and r["cargo after 6 s"] == 5 and gone == 5 and r["pop [before, carried]"][0] == r["pop [before, carried]"][1]
	ok = ok and r["unload"] and near == 5 and r["cargo after unloading"] == 0
	# a Roc that falls takes its riders
	var men2 := []
	for i in 3:
		men2.append(_u(sim, "spearman", 1, 12.0 + i * 0.8, 3.0))
	sim.tick(1)
	sim.roc_load(roc, PackedInt32Array(men2))
	_step(sim, 6.0)
	var c2 := (sim.get_roc(roc).cargo as Array).size()
	sim.kill_unit(roc)
	_step(sim, 1.0)
	r["riders when it fell / pop after"] = [c2, int(sim.get_player(1).pop)]
	ok = ok and c2 == 3 and int(sim.get_player(1).pop) == pop0 - 2
	_check("roc.transport", ok, r)

# The Roc in play (round 9): a right-click on one's own Roc (AovSim.smart, the HUD's
# right-click order) boards the selected men; the Roc itself stays to land, a catapult (siege:
# not carried) walks there instead, a foe's man is never taken; a boarder sent elsewhere drops
# out; the HUD's Unload (roc_unload) sets them down where clicked
func _case_roc_smart() -> void:
	var r := {}
	var sim := _fresh("isis", "zeus", 2, ["anubis", "sobek"])
	var roc := _u(sim, "roc", 1, 0, 0)
	var men := []
	for i in 6:
		men.append(_u(sim, "spearman", 1, -4.0 + i * 0.8, 4.0))
	var cat := _u(sim, "catapult", 1, 4.0, 4.0)
	var foe := _u(sim, "hoplite", 2, 9.0, 9.0)
	sim.tick(2)
	var sel := PackedInt32Array(men + [cat, roc, foe])
	var R: Dictionary = sim.get_unit(roc)
	sim.smart(sel, float(R.x), float(R.z), roc)
	sim.tick(1)
	var st: Dictionary = sim.get_roc(roc)
	r["boarding after the right-click"] = (st.boarding as Array).size()
	var cu: Dictionary = sim.get_unit(cat)
	r["catapult order"] = str(cu.get("order", cu.get("order_type", "")))
	# one boarder sent off to the far side: it drops out
	sim.order_move(PackedInt32Array([men[5]]), C.x - 12.0, C.y - 12.0)
	_step(sim, 7.0)
	st = sim.get_roc(roc)
	var gone := 0
	for m in men:
		gone += 0 if _alive(sim, m) else 1
	r["cargo after 7 s / men gone / the one sent off still out"] = [(st.cargo as Array).size(), gone, _alive(sim, men[5])]
	r["catapult / foe still in the world"] = [_alive(sim, cat), _alive(sim, foe)]
	var ok: bool = r["boarding after the right-click"] == 6 and (st.cargo as Array).size() == 5 and gone == 5 and _alive(sim, men[5])
	ok = ok and _alive(sim, cat) and _alive(sim, foe)
	r["unload"] = sim.roc_unload(roc, C.x - 10.0, C.y)
	_step(sim, 9.0)
	var RU: Dictionary = sim.get_unit(roc)
	var rp := Vector2(float(RU.x), float(RU.z))
	var down := 0
	for id in _units_of(sim, 1, "spearman"):
		var u: Dictionary = sim.get_unit(id)
		if Vector2(float(u.x), float(u.z)).distance_to(rp) < 5.0:
			down += 1
	r["roc's landing spot from the click (tiles)"] = _r(rp.distance_to(Vector2(C.x - 10.0, C.y)), 2)
	r["spearmen set down round it"] = down
	ok = ok and r["unload"] and down == 5 and rp.distance_to(Vector2(C.x - 10.0, C.y)) < 4.0 and (sim.get_roc(roc).cargo as Array).is_empty()
	_check("roc.right_click", ok, r)

# An Egyptian AI with Sobek (Ra, Heroic: Bast, Sobek) trains a Roc at its Temple and lifts
# part of its wave to a drop point short of the target (EnemyAI::egypt_myth), and trains its
# minor gods' myth units (the Petsuchos)
func _case_roc_ai() -> void:
	var r := {}
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := [{"id": 1, "name": "P1", "human": true, "team": 1, "god": "zeus"}, {"id": 2, "name": "P2", "human": false, "team": 2, "god": "ra", "ai": "hard"}]
	sim.start_match({"seed": seed_arg, "map_size": 160, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	sim.set_victory_enabled(false)
	sim.set_player_age(2, 2)
	var s2: Dictionary = sim.get_starts()[1]
	var hx := float(s2.tx) + 0.5
	var hz := float(s2.tz) + 0.5
	sim.set_player_resources(2, {"food": 6000, "wood": 6000, "gold": 6000, "favor": 150})
	var tb := -1
	for k in 16:
		var a := TAU * k / 16.0
		tb = int(sim.spawn_building("temple", 2, hx + cos(a) * 12.0, hz + sin(a) * 12.0, true, true))
		if tb > 0:
			break
	for i in 10:
		sim.spawn_unit("spearman", 2, hx + 5.0 + (i % 5) * 0.8, hz + 5.0 + int(i / 5) * 0.8, 0.0)
	sim.set_ai(2, {"next_wave_at": 0.0, "wave_size": 6})
	var gods: Dictionary = sim.get_gods(2) if sim.has_method("get_gods") else {}
	r["temple placed"] = tb > 0
	var t := 0.0
	var ai: Dictionary = {}
	while t < 480.0:
		_step(sim, 5.0)
		t += 5.0
		ai = sim.get_ai(2)
		if int(ai.myth.roc_lifts) >= 1 and t > 20.0:
			break
	r["seconds"] = t
	r["myth trained / roc lifts / riders"] = [int(ai.myth.trained), int(ai.myth.roc_lifts), int(ai.myth.roc_riders)]
	r["rocs"] = _units_of(sim, 2, "roc").size()
	r["petsuchos"] = _units_of(sim, 2, "petsuchos").size()
	# where the riders came down: the spearmen far from home (out at the target)
	_step(sim, 30.0)
	var far := 0
	for id in _units_of(sim, 2, "spearman") + _units_of(sim, 2, "axeman") + _units_of(sim, 2, "slinger"):
		var u: Dictionary = sim.get_unit(id)
		if Vector2(float(u.x), float(u.z)).distance_to(Vector2(hx, hz)) > 40.0:
			far += 1
	r["soldiers out past 40 tiles 30 s later"] = far
	var ok: bool = tb > 0 and int(ai.myth.roc_lifts) >= 1 and int(ai.myth.roc_riders) >= 4 and int(ai.myth.trained) >= 2
	_check("roc.ai_lifts", ok, r)

# Retold's immunities: the Roc is immune to god powers, the Son of Osiris to targeted ones
# (EGYPT.md 5.2 / 3.1): the Greek Bolt, Lightning Storm and Meteor and an Egyptian enemy's
# Locust Swarm and Thoth's Meteor land on the men beside them and never on them
# (the Egyptian foe: Isis with Anubis / Sobek / Thoth)

func _son_and_roc(sim: Object) -> Array:
	var ph := _u(sim, "pharaoh", 1, 0, 0)
	sim.tick(1)
	var u: Dictionary = sim.get_unit(ph)
	sim.set_player_resources(1, {"favor": 900})
	sim.cast_power(1, "son_of_osiris", float(u.x), float(u.z))
	sim.tick(1)
	var sons: Array = _units_of(sim, 1, "son_of_osiris")
	var roc := _u(sim, "roc", 1, 1.5, 0)
	return [sons[0] if sons.size() > 0 else -1, roc]

func _men(sim: Object, n: int) -> Array:
	var out := []
	for i in n:
		out.append(_u(sim, "spearman", 1, -1.5 + (i % 3) * 1.5, 1.5 + (i / 3) * 1.0))
	sim.tick(1)
	sim.take_events()
	return out

func _case_immunity() -> void:
	var r := {}
	var sim := _fresh("ra", "zeus", 3, ["bast", "sobek", "osiris"])
	sim.set_player_resources(2, {"favor": 900})
	var sr := _son_and_roc(sim)
	var son: int = sr[0]
	var roc: int = sr[1]
	r["son / roc hp"] = [_hp(sim, son), _hp(sim, roc)]
	var ok: bool = son >= 0 and _hp(sim, son) == 609 and _hp(sim, roc) == 700 * 1.2 # (a Heroic Roc in the Mythic Age, myth_ages)
	var su: Dictionary = sim.get_unit(son)
	var sx := float(su.x)
	var sz := float(su.z)
	# Bolt aimed at the Son (the Roc beside him): neither is struck; the bolt finds a spearman
	var men := _men(sim, 3)
	r["bolt cast"] = sim.cast_power(2, "bolt", sx, sz)
	var d := _damage_by(sim, 2.0)
	r["bolt: son / roc / spearmen damage"] = [_r(float(d.get(son, 0.0))), _r(float(d.get(roc, 0.0))), _r(_sum(d, men))]
	ok = ok and r["bolt cast"] and not d.has(son) and not d.has(roc) and _sum(d, men) > 0
	# Lightning Storm over all of them for its whole length
	men = _men(sim, 6)
	r["storm cast"] = sim.cast_power(2, "lightning_storm", sx, sz)
	d = _damage_by(sim, 14.0)
	r["storm: son / roc / spearmen damage"] = [_r(float(d.get(son, 0.0))), _r(float(d.get(roc, 0.0))), _r(_sum(d, men))]
	ok = ok and r["storm cast"] and not d.has(son) and not d.has(roc) and _sum(d, men) > 0
	# the Greek Meteor
	_step(sim, 4.0)
	men = _men(sim, 3)
	r["meteor cast"] = sim.cast_power(2, "meteor", sx, sz)
	d = _damage_by(sim, 6.0)
	r["meteor: son / roc / spearmen damage"] = [_r(float(d.get(son, 0.0))), _r(float(d.get(roc, 0.0))), _r(_sum(d, men))]
	ok = ok and r["meteor cast"] and not d.has(son) and not d.has(roc) and _sum(d, men) > 0
	r["son / roc hp after"] = [_hp(sim, son), _hp(sim, roc)]
	ok = ok and _hp(sim, son) == 609 and _hp(sim, roc) == 700 * 1.2
	# an Egyptian enemy (Isis: Anubis / Sobek / Thoth): Locust Swarm and Thoth's Meteor
	var s2 := _fresh("ra", "isis", 3, ["bast", "sobek", "osiris"])
	s2.set_minor_god(2, 1, "anubis")
	s2.set_minor_god(2, 2, "sobek")
	s2.set_minor_god(2, 3, "thoth")
	s2.set_player_resources(2, {"favor": 900})
	sr = _son_and_roc(s2)
	son = sr[0]
	roc = sr[1]
	su = s2.get_unit(son)
	sx = float(su.x)
	sz = float(su.z)
	men = _men(s2, 3)
	r["locusts cast"] = s2.cast_power2(2, "locust_swarm", sx - 3.0, sz, sx + 10.0, sz)
	d = _damage_by(s2, 3.0)
	r["locusts: son / roc / spearmen damage"] = [_r(float(d.get(son, 0.0))), _r(float(d.get(roc, 0.0))), _r(_sum(d, men))]
	ok = ok and r["locusts cast"] and not d.has(son) and not d.has(roc) and _sum(d, men) > 0
	_step(s2, 20.0)
	men = _men(s2, 3)
	r["thoth meteor cast"] = s2.cast_power(2, "thoth_meteor", sx, sz)
	d = _damage_by(s2, 4.0)
	r["thoth meteor: son / roc / spearmen damage"] = [_r(float(d.get(son, 0.0))), _r(float(d.get(roc, 0.0))), _r(_sum(d, men))]
	ok = ok and r["thoth meteor cast"] and not d.has(son) and not d.has(roc) and _sum(d, men) > 0
	_check("immunity.son_roc", ok, r)

static func _sum(d: Dictionary, ids: Array) -> float:
	var t := 0.0
	for id in ids:
		t += float(d.get(id, 0.0))
	return t

# the Son of Osiris heals allies at 15 hp/s (EGYPT.md 3.1, "Heals 15/s" in the column where
# the Pharaoh heals 10/s and the Priest 7.5/s) and cannot be healed: no regeneration of his
# own, and a Priest beside him heals the spearman and skips him
func _kill_healers(sim: Object, owner: int, keep := -1) -> void:
	for t in ["priest", "pharaoh"]:
		for id in _units_of(sim, owner, t):
			if id != keep:
				sim.damage(id, 100000.0)
	sim.tick(1)

func _case_noheal() -> void:
	var r := {}
	# the Pharaoh alone (the control: 10 hp/s)
	var p := _fresh("ra", "zeus", 3, ["bast", "sobek", "osiris"])
	var ph := _u(p, "pharaoh", 1, 0, 0)
	p.tick(1)
	_kill_healers(p, 1, ph)
	var pu: Dictionary = p.get_unit(ph)
	var pm := int(p.spawn_unit("spearman", 1, float(pu.x) - 1.5, float(pu.z), 0.0))
	p.tick(1)
	p.damage(pm, 75.0)
	p.tick(1)
	var q0 := _hp(p, pm)
	_step(p, 2.0)
	r["spearman hp 2 s beside the Pharaoh alone"] = [_r(q0), _r(_hp(p, pm))]
	var ok: bool = _near(_hp(p, pm) - q0, 20.0, 0.6)
	# the Son alone: 15 hp/s on the spearman, his own hp does not move
	var sim := _fresh("ra", "zeus", 3, ["bast", "sobek", "osiris"])
	var son: int = _son_and_roc(sim)[0]
	_kill_healers(sim, 1)
	var su: Dictionary = sim.get_unit(son)
	var man := int(sim.spawn_unit("spearman", 1, float(su.x) - 1.5, float(su.z), 0.0))
	sim.tick(1)
	sim.damage(son, 300.0)
	sim.damage(man, 75.0)
	sim.tick(1)
	var s0 := _hp(sim, son)
	var m0 := _hp(sim, man)
	_step(sim, 2.0)
	r["son hp 2 s, no other healer"] = [_r(s0), _r(_hp(sim, son))]
	r["spearman hp 2 s beside the Son alone"] = [_r(m0), _r(_hp(sim, man))]
	ok = ok and s0 < 609 - 200 and _near(_hp(sim, son), s0, 1e-6) and _near(_hp(sim, man) - m0, 30.0, 0.6)
	r["heal per s (get_unit_def): son / pharaoh / priest"] = [float(sim.get_unit_def("son_of_osiris").get("heal", 0.0)), float(sim.get_unit_def("pharaoh").get("heal", 0.0)), float(sim.get_unit_def("priest").get("heal", 0.0))]
	ok = ok and _near(float(sim.get_unit_def("son_of_osiris").get("heal", 0.0)), 15.0)
	# a Priest joins: the spearman takes 15 + 7.5 hp/s, the Son still nothing
	sim.damage(man, _hp(sim, man) - 10.0)
	sim.spawn_unit("priest", 1, float(su.x) + 1.0, float(su.z) + 1.0, 0.0)
	sim.tick(1)
	var s1 := _hp(sim, son)
	var m1 := _hp(sim, man)
	_step(sim, 2.0)
	r["son hp 2 s beside a Priest"] = [_r(s1), _r(_hp(sim, son))]
	r["spearman hp 2 s beside the Son and a Priest"] = [_r(m1), _r(_hp(sim, man))]
	ok = ok and _near(_hp(sim, son), s1, 1e-6) and _near(_hp(sim, man) - m1, 45.0, 0.9)
	# with the spearman full, nothing heals the Son
	_step(sim, 4.0)
	var s2 := _hp(sim, son)
	_step(sim, 2.0)
	r["son hp 2 s more, the spearman full"] = [_r(s2), _r(_hp(sim, son))]
	ok = ok and _near(_hp(sim, man), float(sim.get_unit(man).max_hp), 0.01) and _near(_hp(sim, son), s2, 1e-6)
	_check("son.heal", ok, r)

# Town Center volleys: Retold's Egyptian TC shoots 2 arrows a volley, the Greek one 1 (as
# today), a Citadel Center 3 at up to 3 different enemies
func _volleys(sim: Object, tc: int, foes: Array, seconds: float) -> Array:
	# arrows landing within 0.5 s of a volley's first (a volley's arrows fly to men at different
	# distances; the TC reloads in ~1.5 s)
	var out := []
	var t0 := -1e9
	for t in int(round(seconds * FPS)):
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and foes.has(int(e.id)) and int(e.other) == tc and float(e.amount) > 4.0:
				var now := float(sim.get_time())
				if now - t0 > 0.5:
					t0 = now
					out.append([])
				out[out.size() - 1].append(int(e.id))
	return out

func _case_volleys() -> void:
	var r := {}
	var sim := _fresh("ra", "zeus", 2, ["bast", "sekhmet"])
	var tc1: int = _buildings_of(sim, 1, "town_center")[0]
	var tc2: int = _buildings_of(sim, 2, "town_center")[0]
	var b1: Dictionary = sim.get_building(tc1)
	var b2: Dictionary = sim.get_building(tc2)
	var hop := int(sim.spawn_unit("hoplite", 2, float(b1.x) + 6.0, float(b1.z) + 6.0, 0.0))
	var spr := int(sim.spawn_unit("spearman", 1, float(b2.x) + 6.0, float(b2.z) + 6.0, 0.0))
	sim.tick(1)
	sim.take_events()
	var v1 := _volleys(sim, tc1, [hop], 6.0)
	sim.take_events()
	var v2 := _volleys(sim, tc2, [spr], 6.0)
	var sizes1 := []
	for v in v1:
		sizes1.append(v.size())
	var sizes2 := []
	for v in v2:
		sizes2.append(v.size())
	r["egyptian TC arrows a volley"] = sizes1
	r["greek TC arrows a volley"] = sizes2
	var ok: bool = sizes1.size() >= 2 and sizes1.count(2) == sizes1.size() and sizes2.size() >= 2 and sizes2.count(1) == sizes2.size()
	# Citadel Center, three hoplites in range: 3 arrows a volley at 3 different men
	sim.set_player_resources(1, {"favor": 400})
	r["citadel"] = sim.cast_power(1, "citadel", float(b1.x), float(b1.z))
	# (three fresh hoplites round the TC, the first one shot dead or not)
	var hops := []
	for off in [Vector2(6, 6), Vector2(-6, 6), Vector2(6, -6)]:
		hops.append(int(sim.spawn_unit("hoplite", 2, float(b1.x) + off.x, float(b1.z) + off.y, 0.0)))
	sim.tick(1)
	sim.take_events()
	var v3 := _volleys(sim, tc1, hops, 7.0)
	var spread := []
	for v in v3:
		var uniq := {}
		for id in v:
			uniq[id] = true
		spread.append([v.size(), uniq.size()])
	r["citadel volleys [arrows, different men]"] = spread
	# (the first and last groups may be cut by the window: the volleys between them are whole)
	ok = ok and r["citadel"] and spread.size() >= 4
	for i in range(1, spread.size() - 1):
		ok = ok and spread[i] == [3, 3]
	_check("tc.volleys", ok, r)

func _case_ai() -> void:
	var r := {}
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := [{"id": 1, "name": "P1", "human": true, "team": 1, "god": "zeus"}, {"id": 2, "name": "P2", "human": false, "team": 2, "god": "ra", "ai": "hard"}]
	sim.start_match({"seed": seed_arg, "map_size": 160, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	sim.set_victory_enabled(false)
	C = _open_area(sim, 30, 30.0)
	for i in 4:
		_b(sim, "farm", 2, -8 + i * 4, -8)
	sim.set_player_resources(2, {"favor": 100})
	_step(sim, 8.0)
	var ai: Dictionary = sim.get_ai(2)
	r["ra seat casts: rain"] = int(ai.casts.get("rain", 0))
	# a Set seat in the Mythic Age (Anubis, Nephthys, Horus), a cluster of foes by its men
	var s2: Object = ClassDB.instantiate("AovSim")
	s2.set_godot_rules(true)
	ps[1].god = "set"
	s2.start_match({"seed": seed_arg, "map_size": 160, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	s2.set_victory_enabled(false)
	s2.set_player_age(2, 3)
	C = _open_area(s2, 30, 30.0)
	for i in 3:
		_u(s2, "spearman", 2, -6.0 + i, 0)
	for i in 12:
		_u(s2, "hoplite", 1, 2.0 + (i % 4) * 1.0, -2.0 + int(i / 4) * 1.0)
	s2.set_player_resources(2, {"favor": 900})
	_step(s2, 6.0)
	var a2: Dictionary = s2.get_ai(2)
	var big := 0
	for k in ["tornado", "plague_of_serpents", "ancestors"]:
		big += int(a2.casts.get(k, 0))
		r["set seat casts: " + k] = int(a2.casts.get(k, 0))
	var ok: bool = r["ra seat casts: rain"] >= 1 and big >= 1
	_check("ai.casts_egyptian_powers", ok, r)
