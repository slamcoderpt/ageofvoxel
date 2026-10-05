extends SceneTree
## Scripted check of the civilizations and the Egyptians (native/src/sim/civ,
## PORTING.md "Civilizations, the Egyptians"), headless, on AovSim matches of
## human seats (no AI), every rule measured on real numbers.
##
##   defs         the two civs, their build menus and units; every Egyptian unit's and
##                building's numbers (Retold, mapped) printed and spot-checked
##   match        the god picks the civ (zeus -> Greek, ra / isis / set -> Egyptian);
##                Egyptian start: Town Center, 3 Laborers, the Pharaoh, a Priest (Set: a Baboon),
##                Retold's 200 f / 100 w / 50 g and no favor (Greek 300 / 300 / 200 / 20)
##   economy      5 minutes, the same woods / mine / farms for a Greek and an Egyptian:
##                wood, gold and food per worker (Laborers x0.9), each civ's drop sites
##                (Granary food only, Lumber Camp wood, Mining Camp gold), favor from 3
##                worshippers vs the five Monuments (39 / min), Laborers never worship
##   units        each Egyptian unit's live stats (get_unit_stats), its bonus measured on
##                a first blow, and its counter matchup fought at equal cost
##   pop          population mapped as the browser maps the Greeks (Retold's soldier pop
##                halved, rounded up): each unit's pop; 10 hoplites and 10 Spearmen add 10
##                each; the same cap trains as many Spearmen as hoplites; the counters
##                fought at equal POPULATION; ranged units vs infantry (no kiting) reported
##   limits       Retold's building limits: 15 Migdols (foundations count), one of each
##                Monument; the shared types' limits not applied (as the Greeks here)
##   pharaoh      empower measured before / after: gather (drop +20 %), train (+75 %, not
##                Laborers), build (+75 %), research (+75 %), Monument favor (+20 %);
##                Laborer build 0.75; respawn at the Town Center after 90 s; stats by age
##   priest       healing 7.5 hp/s (Pharaoh 10), half on a busy target; Priest damage x5 vs myth
##   gods         the major gods' passives: Ra (Laborers +30 % on berries, Migdol units +15 %
##                hp, his Priests empower at 60 %), Isis (TC +5 pop, techs -10 %, Obelisk 5 gold,
##                built 40 % faster), Set (Barracks units +5 % speed, Barracks / Siege Works /
##                Migdol -25 % gold)
##   auras        the major gods' Monument auras (EGYPT.md 1.4, 4): Ra's Mandjet (a Pharaoh-
##                empowered Monument empowers his buildings in 18 tiles at 60 %: train speed,
##                favor), Isis' Divine Shield (no enemy god power in 15 / 30 tiles, 1 hp/s
##                healing in 30 tiles, favor +100 % empowered: 9 / min vs Ra's 5.4), Set's
##                Devotees (Barracks / Migdol near a Monument train at -10 %, refunds alike)
##   set          Set's Animals of Set (EGYPT.md 1.5, 1.6, 3.2, 4): the Pharaoh's summon menu by
##                age, favor paid, summon time, a queue that does not stop him, refusals
##                (Ra, a Greek, no favor, the age); the 3 animals at the Temple on each age-up
##                (a real age-up and set_player_age); a Priest converting a deer (35 s) and a
##                boar (50 s) at range 6, the animal's 75 % food in its carcass, butchered by a
##                Laborer; Archaic x0.1 attack; each animal's stats; Laborers' bow vs animals
##   civcosts     Retold's Egyptian prices / times where they differ from the Greek ones:
##                Watch Tower 50 w + 100 g, Fortified Wall 500 f + 400 g, Citadel Wall 800 f +
##                500 g; one Laborer builds the TC in 200 s, a Farm in 13.3, a tower in 80;
##                Laborer armor 25 / 35 % (x0.75), drop-site LOS 5.4
##   locks        civ locks (builds, trains, techs both ways), Monument order and limit, the
##                TC's Priests need a Temple, Laborer cap, Mercenary limit, Mythic needs a
##                Migdol, a Laborer cannot build an Obelisk, a Priest only that
##   determinism  a mixed Greek + Egyptian match (economy, empower, Monuments, a fight)
##                twice: bit-equal
##   rules_off    with set_godot_rules(false): god ra stays Greek, no Egyptian type spawns,
##                places or trains, no empower
##
##   godot --headless --path godot -s res://game/core/egypt_check.gd [-- --only=defs,economy,... --seed=3]
##
## Prints "EGYPT PASS|FAIL <case> {detail}" and "EGYPT_RESULT {json}"; exit = failures.

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
	print("EGYPT %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

static func _near(a: float, b: float, eps := 1e-3) -> bool:
	return absf(a - b) <= eps

static func _r(v: float, d := 3) -> float:
	var k := pow(10.0, d)
	return roundf(v * k) / k

# ---- helpers ------------------------------------------------------------------

## A 2-player match of human seats: player 1 with god g1, player 2 with god g2
## (deathmatch stockpiles), victory off, revealed, an open area C cleared.
func _fresh(g1 := "zeus", g2 := "ra", seed := 3, age := 0, resources := "deathmatch") -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := [{"id": 1, "name": "P1", "human": true, "team": 1, "god": g1}, {"id": 2, "name": "P2", "human": true, "team": 2, "god": g2}]
	var r: Dictionary = sim.start_match({"seed": seed, "map_size": 160, "preset": "skirmish", "resources": resources, "players": ps})
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
		return null
	sim.set_victory_enabled(false)
	sim.set_fog_reveal_all(true)
	sim.set_record_events(true)
	if age > 0:
		sim.set_player_age(1, age)
		sim.set_player_age(2, age)
	C = _open_area(sim, 40, 26.0)
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

func _res(sim: Object, owner: int) -> Dictionary:
	var p: Dictionary = sim.get_player(owner)
	return {"food": float(p.food), "wood": float(p.wood), "gold": float(p.gold), "favor": float(p.favor)}

func _step(sim: Object, seconds: float) -> void:
	sim.tick(int(round(seconds * FPS)))

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

## The first blow / arrow from `att` on `tgt`: its damage (unit:damaged amount), -1 none.
func _first_hit(sim: Object, att: int, tgt: int, max_s := 20.0) -> float:
	sim.take_events()
	sim.order(att, {"type": "attack", "target": tgt})
	for t in int(max_s * FPS):
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and int(e.other) == att and int(e.id) == tgt:
				return float(e.amount)
	return -1.0

## Ticks until building `b` is finished (-1: not within max_s).
func _build_time(sim: Object, b: int, max_s := 200.0) -> float:
	for t in int(max_s * FPS):
		sim.tick(1)
		if bool(sim.get_building(b).built):
			return (t + 1) / float(FPS)
	return -1.0

# ---- run ------------------------------------------------------------------------

func _run() -> void:
	var t0 := Time.get_ticks_msec()
	for c in ["defs", "match", "economy", "units", "pop", "limits", "pharaoh", "priest", "gods", "auras", "set", "civcosts", "locks", "determinism", "rules_off"]:
		if _want(c):
			call("_case_" + c)
	result["ms"] = Time.get_ticks_msec() - t0
	result["passes"] = passes
	result["fails"] = fails
	print("EGYPT_RESULT %s" % JSON.stringify(result))
	quit(fails.size())

# defs -------------------------------------------------------------------------------

func _case_defs() -> void:
	var sim := _fresh()
	var g: Dictionary = sim.get_civ("greek")
	var e: Dictionary = sim.get_civ("egyptian")
	_check("defs.civs", Array(sim.civ_names()) == ["greek", "egyptian"] and Array(e.gods) == ["ra", "isis", "set"]
		and "granary" in e.build_menu and not ("storehouse" in e.build_menu) and "storehouse" in g.build_menu and not ("granary" in g.build_menu)
		and "laborer" in e.units and not ("villager" in e.units) and "villager" in g.units and not ("pharaoh" in g.units),
		{"greek": g, "egyptian": e})
	# every Egyptian unit's numbers
	var units := {}
	for t in e.units:
		var d: Dictionary = sim.get_unit_def(t)
		units[t] = {"class": d["class"], "hp": d.hp, "speed": d.speed, "sight": d.sight, "pop": d.pop, "cost": d.cost, "train": d.train_time,
			"attack": d.attack, "hack": d.hack_armor, "pierce": d.pierce_armor, "min_age": d.min_age, "retold": d.get("retold", "")}
	var sp: Dictionary = sim.get_unit_def("spearman")
	var ax: Dictionary = sim.get_unit_def("axeman")
	var lab: Dictionary = sim.get_unit_def("laborer")
	var ok: bool = float(sp.hp) == 85 and float(sp.cost.food) == 50 and float(sp.cost.gold) == 25 and _near(float(sp.hack_armor), 0.30) and _near(float(sp.pierce_armor), 0.075)
	ok = ok and float(ax.attack.damage) == 5 and float(lab.hp) == 55 and float(lab.cost.food) == 50 and str(lab["class"]) == "villager"
	ok = ok and float(sim.get_unit_def("war_elephant").hp) == 450 and int(sim.get_unit_def("pharaoh").pop) == 0 and float(sim.get_unit_def("priest").cost.gold) == 100
	var bb: Dictionary = sim.get_unit_def("baboon_of_set")
	ok = ok and float(bb.hp) == 20 and float(bb.attack.damage) == 3 and float(bb.cost.favor) == 3 and int(bb.pop) == 1 and str(bb.civ) == "egyptian"
	_check("defs.units", ok and units.size() == 23, units)
	# every Egyptian building's numbers (for an Egyptian owner)
	var blds := {}
	for t in e.build_menu:
		var d: Dictionary = sim.get_building_def(t, 2)
		blds[t] = {"cost": d.cost, "hp": d.hp, "size": "%dx%d" % [d.w, d.h], "base_time": d.build_time,
			"laborer_time": d.by_civ.egyptian.build_time if d.by_civ.has("egyptian") else -1.0, "age": d.min_age, "trains": d.trains,
			"armor": d.get("armor", "flat x0.35"), "dropoff": d.dropoff, "pop": d.pop}
	var c := func(t: String, k: String) -> float: return float(blds[t].cost.get(k, 0.0))
	ok = c.call("town_center", "gold") == 550 and c.call("town_center", "wood") == 0 and blds.house.cost.is_empty() and c.call("farm", "gold") == 70
	ok = ok and c.call("temple", "gold") == 150 and c.call("temple", "wood") == 0 and blds.granary.cost.is_empty() and blds.armory.cost.is_empty()
	ok = ok and c.call("monument_gods", "food") == 600 and c.call("monument_gods", "gold") == 600 and c.call("migdol", "gold") == 500 and c.call("eg_barracks", "gold") == 75
	ok = ok and Array(blds.granary.dropoff) == ["food"] and Array(blds.lumber_camp.dropoff) == ["wood"] and Array(blds.mining_camp.dropoff) == ["gold"]
	ok = ok and _near(float(blds.house.laborer_time), 20.0) and Array(blds.town_center.trains) == ["laborer", "mercenary", "mercenary_cavalry", "priest"]
	ok = ok and Array(blds.migdol.trains) == ["chariot_archer", "camel_rider", "war_elephant"] and int(blds.migdol.age) == 2 and int(blds.eg_barracks.age) == 1
	# a Greek owner's numbers for the shared types are unchanged
	var gt: Dictionary = sim.get_building_def("temple", 1)
	ok = ok and float(gt.cost.wood) == 150 and float(gt.cost.gold) == 150 and Array(sim.get_building_def("town_center", 1).trains) == ["villager"]
	_check("defs.buildings", ok, blds)

# match --------------------------------------------------------------------------------

func _case_match() -> void:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := []
	var gods := ["zeus", "ra", "isis", "set"]
	for i in 4:
		ps.append({"id": i + 1, "name": "P%d" % (i + 1), "human": true, "team": i + 1, "god": gods[i]})
	var r: Dictionary = sim.start_match({"seed": seed_arg, "map_size": 160, "preset": "skirmish", "players": ps})
	var civs := []
	var starts := {}
	for i in 4:
		var p: Dictionary = sim.get_player(i + 1)
		civs.append(str(p.civ))
		var st := {}
		for t in ["villager", "laborer", "pharaoh", "priest", "baboon_of_set"]:
			st[t] = _units_of(sim, i + 1, t).size()
		st["favor"] = float(p.favor)
		st["stock"] = [float(p.food), float(p.wood), float(p.gold)]
		st["tc"] = _buildings_of(sim, i + 1, "town_center").size()
		starts[str(p.god)] = st
	var ok: bool = bool(r.ok) and civs == ["greek", "egyptian", "egyptian", "egyptian"]
	ok = ok and starts.Zeus.villager == 5 and starts.Zeus.laborer == 0 and starts.Zeus.favor == 20 and starts.Zeus.stock == [300.0, 300.0, 200.0]
	for g in ["Ra", "Isis", "Set"]:
		ok = ok and starts[g].laborer == 3 and starts[g].pharaoh == 1 and starts[g].priest == 1 and starts[g].villager == 0 and starts[g].favor == 0 and starts[g].tc == 1
		ok = ok and starts[g].stock == [200.0, 100.0, 50.0] and starts[g].baboon_of_set == (1 if g == "Set" else 0)
	_check("match.civ_from_god", ok, {"civs": civs, "starts": starts})
	# a match can also name the civ (scenes / tools)
	var sim2: Object = ClassDB.instantiate("AovSim")
	sim2.set_godot_rules(true)
	sim2.start_match({"seed": seed_arg, "map_size": 128, "players": [{"id": 1, "human": true, "civ": "egyptian"}, {"id": 2, "human": true, "god": "zeus"}]})
	_check("match.civ_key", str(sim2.get_player(1).civ) == "egyptian" and str(sim2.get_player(2).civ) == "greek", {})

# economy ---------------------------------------------------------------------------------

## One civ's 5-minute economy at the area C side `side` (-1 left, +1 right): 3 workers on
## woods, 3 on a gold mine, 3 on farms, each next to its civ's drop site; 3 worshippers
## (Greek) or the five Monuments (Egyptian). Returns the resources made.
func _econ_side(sim: Object, owner: int, egypt: bool, side: int) -> Dictionary:
	var x0 := side * 10
	var worker := "laborer" if egypt else "villager"
	# woods: a 4x3 grove; a gold mine; 3 farms
	for i in 12:
		sim.spawn_resource("tree", C.x + x0 - 2 + (i % 4), C.y - 14 + i / 4, 0)
	sim.spawn_resource("gold", C.x + x0 - 1, C.y - 4, 0)
	var farms := []
	for i in 3:
		farms.append(_b(sim, "farm", owner, x0 - 7 + i * 5, 6))
	_b(sim, "lumber_camp" if egypt else "storehouse", owner, x0 - 1, -10)
	_b(sim, "mining_camp" if egypt else "storehouse", owner, x0 + 3, -4)
	_b(sim, "granary" if egypt else "storehouse", owner, x0 - 1, 11)
	sim.tick(1)
	var wood := []
	var gold := []
	var food := []
	for i in 3:
		wood.append(_u(sim, worker, owner, x0 + i - 1.0, -8.0))
		gold.append(_u(sim, worker, owner, x0 + i - 1.0, -1.0))
		food.append(_u(sim, worker, owner, x0 + i - 1.0, 4.5))
	sim.tick(1)
	var tree := int(sim.nearest_resource(C.x + x0, C.y - 9, "wood", 10))
	var mine := int(sim.nearest_resource(C.x + x0, C.y - 2, "gold", 10))
	sim.order_gather(PackedInt32Array(wood), tree)
	sim.order_gather(PackedInt32Array(gold), mine)
	for i in 3:
		sim.order_gather(PackedInt32Array([food[i]]), farms[i])
	if egypt:
		var k := 0
		for t in ["monument_villagers", "monument_soldiers", "monument_priests", "monument_pharaohs", "monument_gods"]:
			_b(sim, t, owner, x0 - 8 + k * 4, 14)
			k += 1
	else:
		var tm := _b(sim, "temple", owner, x0 - 3, 14)
		var ws := []
		for i in 3:
			ws.append(_u(sim, "villager", owner, x0 + i - 1.0, 12.0))
		sim.tick(1)
		sim.order_worship(PackedInt32Array(ws), tm)
	return {"wood": wood, "gold": gold, "food": food}

func _case_economy() -> void:
	var sim := _fresh("zeus", "ra", seed_arg, 1, "standard")
	for o in [1, 2]:
		sim.set_player_resources(o, {"food": 0, "wood": 0, "gold": 0, "favor": 0})
	var g := _econ_side(sim, 1, false, -1)
	var e := _econ_side(sim, 2, true, 1)
	var r0g := _res(sim, 1)
	var r0e := _res(sim, 2)
	_step(sim, 300.0)
	var rg := _res(sim, 1)
	var re := _res(sim, 2)
	var made := {}
	for k in ["food", "wood", "gold", "favor"]:
		made[k] = [_r(rg[k] - r0g[k], 1), _r(re[k] - r0e[k], 1)]
	var ratio := {}
	for k in ["food", "wood", "gold"]:
		ratio[k] = _r(made[k][1] / maxf(1.0, made[k][0]))
	var cs: Dictionary = sim.get_civ_state(2)
	# Laborers 10 % slower at the node and ~5 % slower on foot (3.8 vs 4.0): x0.84 .. x0.93
	var ok := true
	for k in ["food", "wood", "gold"]:
		ok = ok and ratio[k] >= 0.82 and ratio[k] <= 0.95 and made[k][0] > 100
	_check("economy.gather_5min", ok, {"made [greek, egyptian]": made, "egyptian / greek": ratio})
	# favor: 3 worshippers = 0.1 x 3^0.85 / s; the five Monuments 39 / min
	var want_g := 0.1 * pow(3.0, 0.85) * 300.0
	var want_e := 39.0 * 5.0
	_check("economy.favor_5min", absf(made.favor[0] - want_g) < want_g * 0.08 and absf(made.favor[1] - want_e) < 1.0 and _near(float(cs.favor_per_min), 39.0, 0.01),
		{"greek_worship": made.favor[0], "greek_want ~": _r(want_g, 1), "egyptian_monuments": made.favor[1], "egyptian_want": want_e, "favor_per_min": cs.favor_per_min})
	# drop sites: a Granary takes food only; a Laborer with wood goes to the Lumber Camp
	var gr: Array = _buildings_of(sim, 2, "granary")
	var lc: Array = _buildings_of(sim, 2, "lumber_camp")
	var gb: Dictionary = sim.get_building(gr[0])
	var nd_w := int(sim.nearest_dropoff(2, float(gb.x), float(gb.z), "wood"))
	var nd_f := int(sim.nearest_dropoff(2, float(gb.x), float(gb.z), "food"))
	_check("economy.dropsites", nd_f == gr[0] and nd_w != gr[0] and (nd_w == lc[0] or "town_center" == str(sim.get_building(nd_w).type)),
		{"granary": gr[0], "food_at_granary": nd_f, "wood_from_granary": nd_w, "lumber_camp": lc[0]})
	# Laborers never worship (the order is refused; a Greek villager's is not)
	var tm := _b(sim, "temple", 2, -14, -16)
	var lab := _u(sim, "laborer", 2, -10.0, -12.0)
	sim.tick(1)
	var w_ok: bool = sim.order(lab, {"type": "worship", "target": tm})
	_check("economy.no_worship", not w_ok and str(sim.get_unit(lab).order) != "worship", {"order_accepted": w_ok})

# units ----------------------------------------------------------------------------------

## Equal-cost armies (budget in resources) of type a (owner 1) and b (owner 2) attack-move
## at each other; -> {winner, survivors}.
func _fight(a: String, b: String, budget := 900.0, g1 := "ra", g2 := "zeus") -> Dictionary:
	var sim := _fresh(g1, g2, seed_arg, 3)
	var cost := func(t: String) -> float:
		var c: Dictionary = sim.get_unit_def(t).cost
		var s := 0.0
		for k in c:
			s += float(c[k])
		return s
	var na := maxi(1, roundi(budget / cost.call(a)))
	var nb := maxi(1, roundi(budget / cost.call(b)))
	var A := []
	var Bs := []
	for i in na:
		A.append(_u(sim, a, 1, -9.0 - (i / 5) * 1.4, -3.0 + (i % 5) * 1.4))
	for i in nb:
		Bs.append(_u(sim, b, 2, 9.0 + (i / 5) * 1.4, -3.0 + (i % 5) * 1.4))
	sim.tick(1)
	sim.order_attack_move(PackedInt32Array(A), C.x + 12.0, C.y)
	sim.order_attack_move(PackedInt32Array(Bs), C.x - 12.0, C.y)
	var la := 0
	var lb := 0
	var t := 0.0
	while t < 150.0:
		_step(sim, 1.0)
		t += 1.0
		la = 0
		lb = 0
		for id in A:
			la += int(_alive(sim, id))
		for id in Bs:
			lb += int(_alive(sim, id))
		if la == 0 or lb == 0:
			break
	return {"a": "%d %s" % [na, a], "b": "%d %s" % [nb, b], "left": [la, lb], "s": t, "winner": a if lb == 0 and la > 0 else b if la == 0 and lb > 0 else "none"}

func _case_units() -> void:
	# live stats with the owner's age (Mythic here), as the readout gives them
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var stats := {}
	for t in sim.get_civ("egyptian").units:
		var id := _u(sim, t, 2, 0.0, 0.0)
		sim.tick(1)
		var s: Dictionary = sim.get_unit_stats(id)
		stats[t] = {"hp": _r(s.max_hp, 1), "damage": _r(s.damage, 2), "range": _r(s.range, 2), "speed": s.speed, "reload": _r(s.reload, 2),
			"hack": s.hack_armor, "pierce": s.pierce_armor}
		sim.kill_unit(id, 0)
	var ok: bool = stats.pharaoh.hp == 145 and _near(stats.pharaoh.damage, 17.4) and _near(stats.pharaoh.range, 12.0) and stats.priest.hp == 116
	ok = ok and stats.spearman.hp == 85 and _near(stats.slinger.range, 10.2) and _near(stats.camel_rider.pierce, 0.3)
	_check("units.stats", ok, stats)
	# bonuses on a first blow (damage after armor): Spearman x2 vs cavalry, Axeman x4 vs
	# infantry, Slinger x2.25 vs archers, Chariot x1.5 vs infantry, Camel x2 vs cavalry,
	# Priest x5 vs myth; War Elephant x4 and Catapult crush vs buildings
	var hits := {}
	var want := {}
	var cases := [["spearman", "hippikon", 6 * 2 * 0.8], ["axeman", "hoplite", 5 * 4 * 0.7], ["slinger", "toxotes", 4 * 2.25 * 0.9],
		["chariot_archer", "hoplite", 11 * 1.5 * 0.7], ["camel_rider", "hippikon", 8 * 2 * 0.8], ["mercenary", "hippikon", 7 * 1.5 * 0.8],
		["priest", "minotaur", 2.9 * 5 * 0.65], ["hoplite", "spearman", 9 * 0.7], ["toxotes", "spearman", 7 * 1.2 * (1 - 0.075)]]
	ok = true
	for c in cases:
		var s2 := _fresh("ra", "zeus", seed_arg, 3)
		var ao := 1
		var to := 2
		if c[0] in ["hoplite", "toxotes"]:
			ao = 2
			to = 1
		var a := _u(s2, c[0], ao, -6.0 if c[0] in ["slinger", "chariot_archer", "priest", "toxotes"] else -2.0, 0.0)
		var t := _u(s2, c[1], to, 0.5, 0.5)
		s2.tick(1)
		var d := _first_hit(s2, a, t)
		hits["%s -> %s" % [c[0], c[1]]] = _r(d, 3)
		want["%s -> %s" % [c[0], c[1]]] = _r(c[2], 3)
		ok = ok and _near(d, c[2], 0.01)
	# buildings: a War Elephant's blow on a Greek house (x0.35 flat, x4), a Catapult's
	# stone on a house (200 crush - 5 %) and on an Egyptian Granary (Retold 5 % crush)
	for c in [["war_elephant", "house", 22 * 0.35 * 4], ["catapult", "house", 200 * 0.95], ["catapult", "granary", 200 * 0.95], ["siege_tower", "house", 59.1 * 0.95]]:
		var s3 := _fresh("ra", "ra", seed_arg, 3)
		var bt := _b(s3, c[1], 2, 2, -2)
		var a := _u(s3, c[0], 1, -8.0 if c[0] == "catapult" else -3.0, 0.0)
		s3.tick(1)
		var d := _first_hit(s3, a, bt, 30.0)
		hits["%s -> %s" % [c[0], c[1]]] = _r(d, 3)
		want["%s -> %s" % [c[0], c[1]]] = _r(c[2], 3)
		ok = ok and _near(d, c[2], 0.01)
	# a Laborer's blow on a tower: x4 (Retold), against the villager's (3 vs 6 damage)
	var s4 := _fresh("ra", "zeus", seed_arg, 3)
	var tw := _b(s4, "tower", 2, 2, -2)
	var vl := _u(s4, "villager", 2, -2.0, 0.0)
	var lb := _u(s4, "laborer", 1, -2.0, 1.0)
	s4.tick(1)
	var lb_hit := _first_hit(s4, lb, tw)
	var s5 := _fresh("zeus", "zeus", seed_arg, 3)
	var tw5 := _b(s5, "tower", 2, 2, -2)
	var vl5 := _u(s5, "villager", 1, -2.0, 0.0)
	s5.tick(1)
	var vl_hit := _first_hit(s5, vl5, tw5)
	hits["laborer -> tower"] = _r(lb_hit, 3)
	hits["villager -> tower"] = _r(vl_hit, 3)
	want["laborer -> tower"] = _r(vl_hit * 2.0 * 4.0, 3)
	ok = ok and vl_hit > 0 and _near(lb_hit, vl_hit * 2.0 * 4.0, 0.01)
	_check("units.bonus_hits", ok, {"measured": hits, "want": want})
	# counters at equal cost (900 resources each side)
	var fights := {}
	ok = true
	for f in [["spearman", "hippikon"], ["axeman", "hoplite"], ["slinger", "toxotes"], ["camel_rider", "hippikon"], ["camel_rider", "chariot_archer"],
			["hippikon", "slinger"], ["war_elephant", "toxotes"], ["axeman", "spearman"]]:
		var r := _fight(f[0], f[1], 900.0, "ra", "zeus" if f[1] in ["hoplite", "toxotes", "hippikon"] else "ra")
		fights["%s vs %s" % f] = r
		ok = ok and r.winner == f[0]
	# reported, not asserted: this sim's archers stand and shoot (no kiting), so at equal
	# cost a straight fight is lost to infantry by Chariot Archers, and the same way by
	# the Greek toxotes (its x1.2 vs infantry)
	fights["chariot_archer vs hoplite (reported)"] = _fight("chariot_archer", "hoplite")
	fights["chariot_archer vs axeman (reported)"] = _fight("chariot_archer", "axeman", 900.0, "ra", "ra")
	fights["toxotes vs hoplite (reported, the Greek counterpart)"] = _fight("toxotes", "hoplite", 900.0, "zeus", "zeus")
	_check("units.counters", ok, fights)

# pop -----------------------------------------------------------------------------------------

## na `a` (owner 1, god g1) against nb `b` (owner 2, god g2), attack-moving at each other
## (hold_a: side a stands its ground, the other side walks in from beyond its range)
func _fight_n(a: String, na: int, b: String, nb: int, g1 := "ra", g2 := "zeus", hold_a := false) -> Dictionary:
	var sim := _fresh(g1, g2, seed_arg, 3)
	var A := []
	var Bs := []
	for i in na:
		A.append(_u(sim, a, 1, -9.0 - (i / 5) * 1.4, -3.0 + (i % 5) * 1.4))
	for i in nb:
		Bs.append(_u(sim, b, 2, 9.0 + (i / 5) * 1.4, -3.0 + (i % 5) * 1.4))
	sim.tick(1)
	if not hold_a:
		sim.order_attack_move(PackedInt32Array(A), C.x + 12.0, C.y)
	sim.order_attack_move(PackedInt32Array(Bs), C.x - 12.0, C.y)
	var la := na
	var lb := nb
	var t := 0.0
	while t < 150.0:
		_step(sim, 1.0)
		t += 1.0
		la = 0
		lb = 0
		for id in A:
			la += int(_alive(sim, id))
		for id in Bs:
			lb += int(_alive(sim, id))
		if la == 0 or lb == 0:
			break
	return {"a": "%d %s" % [na, a], "b": "%d %s" % [nb, b], "left": [la, lb], "s": t,
		"winner": a if lb == 0 and la > 0 else b if la == 0 and lb > 0 else "none"}

func _case_pop() -> void:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	sim.tick(30)
	# each unit's pop: Retold's halved, rounded up (the browser's hoplite / toxotes 2 -> 1, hippikon 3 -> 2)
	var want := {"villager": 1, "hoplite": 1, "toxotes": 1, "hippikon": 2,
		"laborer": 1, "spearman": 1, "axeman": 1, "slinger": 1, "chariot_archer": 2, "camel_rider": 2, "war_elephant": 3,
		"siege_tower": 2, "catapult": 3, "priest": 1, "mercenary": 0, "mercenary_cavalry": 0, "pharaoh": 0}
	var got := {}
	var ok := true
	for t in want:
		got[t] = int(sim.get_unit_def(t).pop)
		ok = ok and got[t] == want[t]
	_check("pop.defs", ok, {"pop": got, "want": want})
	# 10 hoplites for the Greek, 10 Spearmen for the Egyptian: +10 each; 5 hippikons / 5 Chariot Archers: +10 each
	var p0 := [int(sim.get_player(1).pop), int(sim.get_player(2).pop)]
	for i in 10:
		_u(sim, "hoplite", 1, -12.0 + (i % 5) * 1.2, -12.0 + (i / 5) * 1.2)
		_u(sim, "spearman", 2, 6.0 + (i % 5) * 1.2, -12.0 + (i / 5) * 1.2)
	sim.tick(2)
	var p1 := [int(sim.get_player(1).pop), int(sim.get_player(2).pop)]
	for i in 5:
		_u(sim, "hippikon", 1, -12.0 + i * 1.6, -8.0)
		_u(sim, "chariot_archer", 2, 6.0 + i * 1.6, -8.0)
	sim.tick(2)
	var p2 := [int(sim.get_player(1).pop), int(sim.get_player(2).pop)]
	var r := {"10 hoplites": p1[0] - p0[0], "10 spearmen": p1[1] - p0[1], "5 hippikons": p2[0] - p1[0], "5 chariot archers": p2[1] - p1[1]}
	ok = r["10 hoplites"] == 10 and r["10 spearmen"] == 10 and r["5 hippikons"] == 10 and r["5 chariot archers"] == 10
	_check("pop.spawned", ok, r)
	# the same cap: a fresh match, each side 40 pop of room (cap raised by Houses), trains
	# hoplites at an Academy / Spearmen at a Barracks until "Need more houses"
	var s2 := _fresh("zeus", "ra", seed_arg, 3)
	var room := {}
	var trained := {}
	var reason := {}
	for o in [1, 2]:
		var bt := "barracks" if o == 1 else "eg_barracks"
		var ut := "hoplite" if o == 1 else "spearman"
		var bx := -16 if o == 1 else 8
		for h in 4:
			_b(s2, "house", o, bx + h * 3, 10)
		var bs := []
		for k in 6:   # (a queue holds 10: six buildings)
			bs.append(_b(s2, bt, o, bx + (k % 2) * 6, -18 + (k / 2) * 6))
		s2.tick(30)
		var p: Dictionary = s2.get_player(o)
		room[o] = int(p.pop_cap) - int(p.pop)
		var n := 0
		var last := ""
		for b in bs:
			for i in 12:
				var t: Dictionary = s2.train(b, ut)
				if not bool(t.ok):
					last = str(t.reason)
					break
				n += 1
			if last == "Need more houses":
				break
		trained[ut] = n
		reason[ut] = last
	var r2 := {"room": room, "trained": trained, "refused": reason}
	ok = trained.hoplite == room[1] and trained.spearman == room[2] and reason.spearman == "Need more houses"
	_check("pop.same_cap", ok, r2)
	# counters at equal POPULATION (10 pop a side): the counter wins, as at equal cost
	var fights := {}
	ok = true
	for f in [["spearman", 10, "hippikon", 5, "zeus"], ["axeman", 10, "hoplite", 10, "zeus"], ["slinger", 10, "toxotes", 10, "zeus"],
			["camel_rider", 5, "hippikon", 5, "zeus"], ["camel_rider", 5, "chariot_archer", 5, "ra"], ["hippikon", 5, "slinger", 10, "ra"],
			["axeman", 10, "spearman", 10, "ra"]]:
		var g2: String = f[4]
		var g1 := "zeus" if f[0] in ["hoplite", "toxotes", "hippikon"] else "ra"
		var fr := _fight_n(f[0], f[1], f[2], f[3], g1, g2)
		fights["%s x%d vs %s x%d" % [f[0], f[1], f[2], f[3]]] = fr
		ok = ok and fr.winner == f[0]
	# reported: the critic's equal-pop line (a Spearman is an anti-cavalry 75-resource unit, the
	# hoplite a 90-resource line infantry with 35 more hp and 3 more damage: the hoplite wins
	# man for man, as Retold's hoplite beats its Spearman), and War Elephants against toxotes
	fights["spearman x10 vs hoplite x10 (reported)"] = _fight_n("spearman", 10, "hoplite", 10, "ra", "zeus")
	fights["war_elephant x3 vs toxotes x9 (reported)"] = _fight_n("war_elephant", 3, "toxotes", 9, "ra", "zeus")
	_check("pop.counters", ok, fights)
	# ranged vs infantry: this sim's ranged units stand and shoot (no kiting), both civs alike;
	# infantry that reaches them wins. Slingers holding while Spearmen walk in from 18 tiles,
	# and the Greek pair the same way (reported, not asserted)
	var rv := {}
	rv["slinger x10 hold vs spearman x10"] = _fight_n("slinger", 10, "spearman", 10, "ra", "ra", true)
	rv["toxotes x10 hold vs hoplite x10 (Greek)"] = _fight_n("toxotes", 10, "hoplite", 10, "zeus", "zeus", true)
	rv["slinger x10 vs toxotes x10 hold"] = _fight_n("slinger", 10, "toxotes", 10, "ra", "zeus")
	_check("pop.ranged_vs_infantry", true, rv)

# limits ---------------------------------------------------------------------------------------

func _case_limits() -> void:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var r := {}
	var migs := []
	for i in 14:
		migs.append(_b(sim, "migdol", 2, -18 + (i % 5) * 7, -18 + (i / 5) * 7))
	sim.tick(1)
	r["migdols"] = _buildings_of(sim, 2, "migdol").size()
	r["can_build 15th"] = sim.can_build(2, "migdol")
	var lb := _u(sim, "laborer", 2, 0.0, 6.0)
	sim.tick(1)
	# the 15th as a foundation: it counts
	r["place 15th"] = int(sim.place_building("migdol", 2, C.x + 10, C.y + 4, PackedInt32Array([lb])))
	sim.tick(1)
	r["can_build 16th"] = sim.can_build(2, "migdol")
	r["place 16th"] = int(sim.place_building("migdol", 2, C.x + 10, C.y + 12, PackedInt32Array([lb])))
	var lim = sim.get_building_def("migdol", 2).by_civ.egyptian.get("limit", 0)
	r["def limit"] = lim
	var ok: bool = r["migdols"] == 14 and bool(r["can_build 15th"].ok) and r["place 15th"] > 0
	ok = ok and not bool(r["can_build 16th"].ok) and str(r["can_build 16th"].reason) == "Limit of 15 Migdol Strongholds" and r["place 16th"] == 0 and int(lim) == 15
	# a lost Migdol frees a slot
	sim.destroy_building(migs[0])
	sim.tick(2)
	r["can_build after one fell"] = sim.can_build(2, "migdol")
	ok = ok and bool(r["can_build after one fell"].ok)
	# shared types: no limit for either civ (as this sim's Greeks), reported
	for i in 31:
		_b(sim, "tower", 2, 14 + (i % 4) * 2, -18 + (i / 4) * 2)
	sim.tick(1)
	r["egyptian towers"] = _buildings_of(sim, 2, "tower").size()
	r["can_build 32nd tower (no limit, as the Greeks)"] = sim.can_build(2, "tower")
	_check("limits.migdol", ok, r)

# pharaoh ------------------------------------------------------------------------------------

func _gather_run(empower: bool) -> Dictionary:
	var sim := _fresh("zeus", "ra", seed_arg, 1, "standard")
	sim.set_player_resources(2, {"food": 0, "wood": 0, "gold": 0, "favor": 0})
	for i in 12:
		sim.spawn_resource("tree", C.x - 2 + (i % 4), C.y - 14 + i / 4, 0)
	var lc := _b(sim, "lumber_camp", 2, -1, -10)
	var ph: Array = [_u(sim, "pharaoh", 2, -3.0, 3.0)]   # (a Pharaoh at the site: the measure starts once he stands there)
	sim.tick(1)
	var ws := []
	for i in 4:
		ws.append(_u(sim, "laborer", 2, i - 1.5, -6.0))
	sim.tick(1)
	sim.order_gather(PackedInt32Array(ws), int(sim.nearest_resource(C.x, C.y - 9, "wood", 10)))
	if empower:
		sim.order_empower(PackedInt32Array(ph), lc)
		for i in 30 * FPS:
			sim.tick(1)
			if not sim.get_civ_state(2).empowered.is_empty():
				break
	var w0 := float(_res(sim, 2).wood)
	_step(sim, 180.0)
	return {"wood": _r(float(_res(sim, 2).wood) - w0, 2), "bonus": _r(float(sim.get_civ_state(2).drop_bonus), 2),
		"empowered": sim.get_civ_state(2).empowered}

func _train_run(empower: bool, type: String, bt: String) -> float:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var b := _b(sim, bt, 2, -2, -2)
	var ph: Array = [_u(sim, "pharaoh", 2, -3.0, 3.0)]   # (a Pharaoh at the site: the measure starts once he stands there)
	sim.tick(1)
	if empower:
		sim.order_empower(PackedInt32Array(ph), b)
		for i in 60 * FPS:   # until he stands there
			sim.tick(1)
			if not sim.get_civ_state(2).empowered.is_empty():
				break
	for i in 3:
		sim.train(b, type)
	sim.take_events()
	var n := 0
	for t in 200 * FPS:
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:trained" and int(e.owner) == 2:
				n += 1
		if n >= 3:
			return (t + 1) / float(FPS)
	return -1.0

func _build_run(empower: bool, owner: int, worker: String, type: String) -> float:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var b := _b(sim, type, owner, 0, -6, false)
	var w := _u(sim, worker, owner, 1.0, -1.5)
	sim.tick(1)
	if empower:
		var ph: Array = [_u(sim, "pharaoh", 2, -3.0, 3.0)]   # (a Pharaoh at the site)
		sim.tick(1)
		sim.order_empower(PackedInt32Array(ph), b)
		for i in 60 * FPS:
			sim.tick(1)
			if not sim.get_civ_state(2).empowered.is_empty():
				break
	sim.order_build(PackedInt32Array([w]), b)
	# from the first tick of work: wait until he reaches the site
	for i in 10 * FPS:
		sim.tick(1)
		if float(sim.get_building(b).progress) > 0.0:
			break
	var p0 := float(sim.get_building(b).progress)
	var t := _build_time(sim, b)
	return _r(t + p0 * float(sim.get_building_def(type).build_time) / (0.75 if worker == "laborer" else 1.0), 2)

func _research_run(empower: bool) -> float:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var arm := _b(sim, "armory", 2, -2, -2)
	var ph: Array = [_u(sim, "pharaoh", 2, -3.0, 3.0)]   # (a Pharaoh at the site: the measure starts once he stands there)
	sim.tick(1)
	if empower:
		sim.order_empower(PackedInt32Array(ph), arm)
		for i in 60 * FPS:
			sim.tick(1)
			if not sim.get_civ_state(2).empowered.is_empty():
				break
	var r: Dictionary = sim.research(arm, "copper_weapons")
	if not bool(r.ok):
		return -1.0
	for t in 120 * FPS:
		sim.tick(1)
		if sim.get_research(arm).is_empty():
			return (t + 1) / float(FPS)
	return -1.0

func _case_pharaoh() -> void:
	var g0 := _gather_run(false)
	var g1 := _gather_run(true)
	var k: float = float(g1.wood) / maxf(1.0, float(g0.wood))
	_check("pharaoh.empower_gather", k > 1.15 and k < 1.25 and float(g1.bonus) > 0 and float(g0.bonus) == 0,
		{"wood_3min [plain, empowered]": [g0.wood, g1.wood], "ratio": _r(k), "drop_bonus": g1.bonus, "empowered": g1.empowered})
	var tr0 := _train_run(false, "spearman", "eg_barracks")
	var tr1 := _train_run(true, "spearman", "eg_barracks")
	var tl0 := _train_run(false, "laborer", "town_center")
	var tl1 := _train_run(true, "laborer", "town_center")
	_check("pharaoh.empower_train", _near(tr1, tr0 / 1.75, 0.1) and _near(tl0, tl1, 0.05),
		{"3 spearmen [plain, empowered] s": [tr0, tr1], "want": _r(tr0 / 1.75, 2), "3 laborers (not sped up)": [tl0, tl1]})
	var bg := _build_run(false, 1, "villager", "house")
	var bl := _build_run(false, 2, "laborer", "house")
	var be := _build_run(true, 2, "laborer", "house")
	_check("pharaoh.empower_build", _near(bg, 15.0, 0.15) and _near(bl, 20.0, 0.15) and _near(be, 20.0 / 1.75, 0.15),
		{"house: greek villager": bg, "laborer (x4/3)": bl, "laborer, empowered": be, "want": [15.0, 20.0, _r(20.0 / 1.75, 2)]})
	var rs0 := _research_run(false)
	var rs1 := _research_run(true)
	_check("pharaoh.empower_research", _near(rs0, 30.0, 0.05) and _near(rs1, 30.0 / 1.75, 0.1), {"copper_weapons [plain, empowered] s": [rs0, rs1]})
	# Monument favor +20 %
	var sim := _fresh("zeus", "ra", seed_arg, 1)
	sim.set_player_resources(2, {"favor": 0})
	var m := _b(sim, "monument_villagers", 2, 0, -4)
	var ph: Array = [_u(sim, "pharaoh", 2, -3.0, 3.0)]   # (a Pharaoh at the site: the measure starts once he stands there)
	sim.tick(1)
	var f0 := float(_res(sim, 2).favor)
	_step(sim, 60.0)
	var f1 := float(_res(sim, 2).favor)
	sim.order_empower(PackedInt32Array(ph), m)
	for i in 30 * FPS:
		sim.tick(1)
		if not sim.get_civ_state(2).empowered.is_empty():
			break
	var f2 := float(_res(sim, 2).favor)
	_step(sim, 60.0)
	var f3 := float(_res(sim, 2).favor)
	_check("pharaoh.empower_favor", _near(f1 - f0, 4.5, 0.01) and _near(f3 - f2, 4.5 * 1.2, 0.01), {"favor/min [plain, empowered]": [_r(f1 - f0), _r(f3 - f2)]})
	# respawn at the Town Center 90 s after his death; stats grow with the age
	var s2 := _fresh("zeus", "ra", seed_arg, 0)
	var p0: Array = _units_of(s2, 2, "pharaoh")
	var st0: Dictionary = s2.get_unit_stats(p0[0])
	var adv: Dictionary = s2.advance_age(2)   # Archaic -> Classical (30 s here)
	_step(s2, 31.0)
	var st1: Dictionary = s2.get_unit_stats(p0[0])
	s2.kill_unit(p0[0], 0)
	_step(s2, 89.0)
	var none_yet := _units_of(s2, 2, "pharaoh").is_empty()
	_step(s2, 2.0)
	var back: Array = _units_of(s2, 2, "pharaoh")
	var tc: Dictionary = s2.get_building(_buildings_of(s2, 2, "town_center")[0])
	var near_tc := false
	if not back.is_empty():
		var u: Dictionary = s2.get_unit(back[0])
		near_tc = Vector2(float(u.x), float(u.z)).distance_to(Vector2(float(tc.x), float(tc.z))) < 8.0
	var st2: Dictionary = s2.get_unit_stats(back[0]) if back.size() == 1 else {}
	_check("pharaoh.respawn", none_yet and back.size() == 1 and near_tc, {"none_at_89s": none_yet, "back_at_91s": back, "at_tc": near_tc})
	var row := func(s: Dictionary) -> Array: return [_r(s.get("max_hp", 0.0), 1), _r(s.get("damage", 0.0), 2), _r(s.get("range", 0.0), 2), _r(s.get("sight", 0.0), 2)]
	_check("pharaoh.ages", bool(adv.ok) and row.call(st0) == [100.0, 3.0, 1.8, 10.8] and row.call(st1) == [110.0, 13.2, 7.2, 10.8] and row.call(st2) == [110.0, 13.2, 7.2, 10.8],
		{"[hp, damage, range, sight] archaic": row.call(st0), "classical": row.call(st1), "respawned in classical": row.call(st2)})

# priest -----------------------------------------------------------------------------------

func _case_priest() -> void:
	var rows := {}
	var ok := true
	for c in [["priest", false, 7.5], ["pharaoh", false, 10.0], ["priest", true, 3.75]]:
		var sim := _fresh("zeus", "ra", seed_arg, 0)
		for id in _units_of(sim, 2, "pharaoh") + _units_of(sim, 2, "priest"):
			sim.kill_unit(id, 0)
		_step(sim, 30.0)   # (corpses gone from the count; no respawn yet)
		var h := _u(sim, c[0], 2, 0.0, 0.0)
		var t := _u(sim, "laborer" if c[1] else "spearman", 2, 2.5, 0.0)
		sim.tick(1)
		sim.damage(t, 40.0 if c[1] else 100.0, 0)
		if c[1]:   # (busy: building a house he stands by)
			var hs := _b(sim, "house", 2, 3, 1, false)
			sim.tick(1)
			sim.order_build(PackedInt32Array([t]), hs)
			_step(sim, 2.0)
		var hp0 := float(sim.get_unit(t).hp)
		var heals := 0
		for i in 4 * FPS:
			sim.tick(1)
			if not sim.get_civ_fx().heals.is_empty():
				heals += 1
		var hp1 := float(sim.get_unit(t).hp)
		var rate := (hp1 - hp0) / 4.0
		rows["%s%s" % [c[0], " (busy target)" if c[1] else ""]] = {"hp/s": _r(rate), "want": c[2]}
		ok = ok and _near(rate, c[2], 0.3)
	_check("priest.heal", ok, rows)

# gods -------------------------------------------------------------------------------------

## A berry bush's food taken per second by one Laborer of god g while he picks (no walk).
func _berry_rate(g: String) -> float:
	var sim := _fresh("zeus", g, seed_arg, 0)
	var bush := int(sim.spawn_resource("berry", C.x, C.y, 0))
	_b(sim, "granary", 2, 2, -1)
	var lab := _u(sim, "laborer", 2, -1.0, 0.5)
	sim.tick(1)
	sim.order_gather(PackedInt32Array([lab]), bush)
	var amount := func() -> float:
		var R: Dictionary = sim.get_resources()
		for i in R.ids.size():
			if int(R.ids[i]) == bush:
				return float(R.amount[i])
		return -1.0
	for i in 10 * FPS:   # until he picks
		sim.tick(1)
		if str(sim.get_unit(lab).anim) == "gather":
			break
	var a0: float = amount.call()
	sim.tick(FPS * 3)
	return (a0 - float(amount.call())) / 3.0

func _case_gods() -> void:
	var r := {}
	var ra := _berry_rate("ra")
	var isis := _berry_rate("isis")
	r["laborer berries/s [ra, isis]"] = [_r(ra), _r(isis)]
	var ok := _near(isis, 0.75 * 0.9, 0.01) and _near(ra, 0.75 * 0.9 * 1.3, 0.01)
	var hp := {}
	var spd := {}
	for g in ["ra", "isis", "set"]:
		var sim := _fresh("zeus", g, seed_arg, 3)
		var cm := _u(sim, "camel_rider", 2, 0.0, 0.0)
		var sp := _u(sim, "spearman", 2, 2.0, 0.0)
		sim.tick(1)
		hp[g] = _r(float(sim.get_unit_stats(cm).max_hp), 2)
		spd[g] = _r(float(sim.get_unit_stats(sp).speed), 4)
		var bd: Dictionary = sim.get_building_def("eg_barracks", 2)
		var mg: Dictionary = sim.get_building_def("migdol", 2)
		var ob: Dictionary = sim.get_building_def("obelisk", 2)
		r[g + " costs [barracks, migdol, obelisk] gold"] = [float(bd.cost.gold), float(mg.cost.gold), float(ob.cost.gold)]
		var arm := _b(sim, "armory", 2, -6, -6)
		sim.tick(1)
		var cw: Dictionary = {}
		for t in sim.get_techs(arm):
			if str(t.key) == "copper_weapons":
				cw = t.cost
		r[g + " copper_weapons cost"] = cw
		r[g + " pop_cap (one TC)"] = int(sim.get_player(2).pop_cap)
	r["camel hp"] = hp
	r["spearman speed"] = spd
	ok = ok and hp.ra == _r(135 * 1.15, 2) and hp.isis == 135.0 and spd.set == _r(3.25 * 1.05, 4) and spd.ra == 3.25
	ok = ok and r["set costs [barracks, migdol, obelisk] gold"] == [56.25, 375.0, 10.0] and r["isis costs [barracks, migdol, obelisk] gold"] == [75.0, 500.0, 5.0]
	ok = ok and _near(float(r["isis copper_weapons cost"].food), 90.0) and _near(float(r["ra copper_weapons cost"].food), 100.0)
	ok = ok and r["isis pop_cap (one TC)"] == 20 and r["ra pop_cap (one TC)"] == 15
	_check("gods.passives", ok, r)

# auras ------------------------------------------------------------------------------------

## Ticks until `owner` has an empowered building (max 60 s).
func _wait_empowered(sim: Object, owner: int, n := 1) -> void:
	for i in 60 * FPS:
		sim.tick(1)
		var k := 0
		for e in sim.get_civ_state(owner).empowered:
			if float(e.strength) >= 1.0:
				k += 1
		if k >= n:
			return

## Seconds to train 3 `type` at building b (-1: not within 200 s).
func _train3(sim: Object, b: int, type: String) -> float:
	for i in 3:
		sim.train(b, type)
	sim.take_events()
	var n := 0
	for t in 200 * FPS:
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:trained" and int(e.owner) == 2:
				n += 1
		if n >= 3:
			return (t + 1) / float(FPS)
	return -1.0

## hp/s a unit gains over `seconds`
func _hp_rate(sim: Object, id: int, seconds: float) -> float:
	var h0 := float(sim.get_unit(id).hp)
	_step(sim, seconds)
	return (float(sim.get_unit(id).hp) - h0) / seconds

## Destroys `owner`'s buildings and units (a test's far side free of arrows).
func _disarm(sim: Object, owner: int) -> void:
	var B: Dictionary = sim.get_buildings()
	for i in B.count:
		if int(B.owner[i]) == owner:
			sim.damage(int(B.ids[i]), 1e7, 0)
	var U: Dictionary = sim.get_units()
	for i in U.ids.size():
		if int(U.owner[i]) == owner:
			sim.kill_unit(int(U.ids[i]), 0)
	sim.tick(1)

func _case_auras() -> void:
	# --- favor of an empowered Monument to Villagers: Ra / Set +20 % (5.4 / min), Isis +100 % (9)
	var fav := {}
	var ok := true
	for g in ["ra", "isis", "set"]:
		var sim := _fresh("zeus", g, seed_arg, 1)
		sim.set_player_resources(2, {"favor": 0})
		var m := _b(sim, "monument_villagers", 2, 0, -4)
		var ph: Array = [_u(sim, "pharaoh", 2, -3.0, 3.0)]
		sim.tick(1)
		var plain := float(sim.get_civ_state(2).favor_per_min)
		sim.order_empower(PackedInt32Array(ph), m)
		_wait_empowered(sim, 2)
		var f0 := float(_res(sim, 2).favor)
		_step(sim, 30.0)
		var f1 := float(_res(sim, 2).favor)
		var st: Dictionary = sim.get_civ_state(2)
		fav[g] = {"plain /min": _r(plain), "empowered /min": _r(float(st.favor_per_min)), "measured over 30 s, /min": _r((f1 - f0) * 2.0), "empower_favor": st.empower_favor}
		var want := 9.0 if g == "isis" else 5.4
		ok = ok and _near(plain, 4.5) and _near(float(st.favor_per_min), want) and _near((f1 - f0) * 2.0, want, 0.02)
	_check("auras.monument_favor", ok, fav)

	# --- Ra's Mandjet: the Pharaoh on Monument 1 lends 60 % to Monument 2, a Barracks in
	# 18 tiles (not the one 26 tiles off, not a Farm); Ra's Priest on it lends nothing
	var r := {}
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	sim.set_player_resources(2, {"favor": 0})
	var m1 := _b(sim, "monument_villagers", 2, -16, -4)
	var m2 := _b(sim, "monument_soldiers", 2, -16, 4)
	var bk := _b(sim, "eg_barracks", 2, -7, -4)
	var far := _b(sim, "eg_barracks", 2, 12, -4)
	var farm := _b(sim, "farm", 2, -11, 9)
	_disarm(sim, 1)   # (the Greek Town Center's arrows reach the west side of the area)
	for i in 4:   # (room for 9 spearmen; out of the Monument's reach)
		_b(sim, "house", 2, 10 + (i % 2) * 4, 8 + (i / 2) * 4)
	var ph: Array = [_u(sim, "pharaoh", 2, -18.0, -6.0)]
	sim.tick(1)
	var t_plain := _train3(sim, far, "spearman")
	sim.order_empower(PackedInt32Array(ph), m1)
	_wait_empowered(sim, 2)
	sim.tick(1)
	var st: Dictionary = sim.get_civ_state(2)
	var lent := {}
	for e in st.mandjet:
		lent[int(e.id)] = int(e.by)
	var emp := {}
	for e in st.empowered:
		emp[int(e.id)] = _r(float(e.strength), 2)
	r["empowered {id: strength}"] = emp
	r["mandjet {id: by}"] = lent
	r["ids [m1, m2, barracks, far barracks, farm]"] = [m1, m2, bk, far, farm]
	ok = emp.get(m1, 0.0) == 1.0 and emp.get(m2, 0.0) == 0.6 and emp.get(bk, 0.0) == 0.6 and not emp.has(far) and not emp.has(farm)
	ok = ok and lent.get(m2, 0) == m1 and lent.get(bk, 0) == m1 and lent.size() == 2
	r["favor /min (4.5 x1.2 + 6 x1.12 = 12.12)"] = _r(float(st.favor_per_min))
	ok = ok and _near(float(st.favor_per_min), 4.5 * 1.2 + 6.0 * (1 + 0.2 * 0.6))
	var t_near := _train3(sim, bk, "spearman")
	var t_far := _train3(sim, far, "spearman")
	r["3 spearmen s [far barracks before, Mandjet barracks, far barracks]"] = [t_plain, t_near, t_far]
	r["want Mandjet (x1/1.45)"] = _r(t_plain / 1.45, 2)
	ok = ok and _near(t_near, t_plain / 1.45, 0.1) and _near(t_far, t_plain, 0.05)
	# Ra's Priest on the Monument (60 %): no Mandjet; an Isis Pharaoh's Monument: none either
	sim.order(ph[0], {"type": "move", "x": C.x + 0.0, "z": C.y + 16.0})
	var pr: Array = [_u(sim, "priest", 2, -18.0, -6.0)]
	sim.tick(1)
	sim.order_empower(PackedInt32Array(pr), m1)
	for i in 20 * FPS:
		sim.tick(1)
		if not sim.get_civ_state(2).empowered.is_empty():
			break
	_step(sim, 1.0)
	r["priest-empowered: mandjet"] = sim.get_civ_state(2).mandjet.size()
	r["priest-empowered: empowered"] = sim.get_civ_state(2).empowered.size()
	ok = ok and r["priest-empowered: mandjet"] == 0 and r["priest-empowered: empowered"] == 1
	var si := _fresh("zeus", "isis", seed_arg, 3)
	var im := _b(si, "monument_villagers", 2, -16, -4)
	_b(si, "eg_barracks", 2, -7, -4)
	var iph: Array = [_u(si, "pharaoh", 2, -18.0, -6.0)]
	si.tick(1)
	si.order_empower(PackedInt32Array(iph), im)
	_wait_empowered(si, 2)
	si.tick(1)
	r["isis: mandjet"] = si.get_civ_state(2).mandjet.size()
	ok = ok and r["isis: mandjet"] == 0
	_check("auras.mandjet", ok, r)

	# --- Isis' Divine Shield: no enemy god power within 15 tiles of a Monument, 30 when
	# empowered; refused casts cost nothing; her own (and allies') powers are not blocked
	r = {}
	sim = _fresh("zeus", "isis", seed_arg, 3)
	var sm := _b(sim, "monument_villagers", 2, -18, 0)   # footprint x -18..-16
	sim.tick(1)
	var edge := C.x - 16.0   # its east edge
	var z := C.y + 1.0
	var fv := func() -> float: return float(_res(sim, 1).favor)
	var f_a: float = fv.call()
	r["bolt at 10 tiles"] = sim.cast_power(1, "bolt", edge + 10.0, z)
	r["shield_check 10"] = sim.shield_check(1, edge + 10.0, z)
	var f_b: float = fv.call()
	r["shield_check 20 (unempowered)"] = sim.shield_check(1, edge + 20.0, z)
	r["isis' own at 5"] = sim.shield_check(2, edge + 5.0, z)
	r["bolt at 20"] = sim.cast_power(1, "bolt", edge + 20.0, z)
	var f_c: float = fv.call()
	ok = not bool(r["bolt at 10 tiles"]) and f_a == f_b and not bool(r["shield_check 10"].ok) and int(r["shield_check 10"].by) == sm
	ok = ok and bool(r["shield_check 20 (unempowered)"].ok) and bool(r["isis' own at 5"].ok) and bool(r["bolt at 20"]) and f_c < f_b
	var sph: Array = [_u(sim, "pharaoh", 2, -20.0, 2.0)]
	sim.tick(1)
	sim.order_empower(PackedInt32Array(sph), sm)
	_wait_empowered(sim, 2)
	sim.tick(1)
	r["shield_check 20 (empowered)"] = sim.shield_check(1, edge + 20.0, z)
	r["shield_check 29"] = sim.shield_check(1, edge + 29.0, z)
	r["shield_check 31"] = sim.shield_check(1, edge + 31.0, z)
	var f_d: float = fv.call()
	r["lightning_storm at 20 (empowered)"] = sim.cast_power(1, "lightning_storm", edge + 20.0, z)
	r["favor [before, after the refused casts, after bolt, after the refused storm]"] = [f_a, f_b, f_c, fv.call()]
	r["shields"] = sim.get_civ_state(2).shields
	r["refused"] = sim.get_civ_state(2).shield_refused
	ok = ok and not bool(r["shield_check 20 (empowered)"].ok) and not bool(r["shield_check 29"].ok) and bool(r["shield_check 31"].ok)
	ok = ok and not bool(r["lightning_storm at 20 (empowered)"]) and fv.call() == f_d and int(r.refused) == 2
	_check("auras.divine_shield", ok, r)

	# --- Isis: an empowered Monument heals in 30 tiles at 1 hp/s, half if busy, stacking
	r = {}
	sim = _fresh("zeus", "isis", seed_arg, 3)
	var h1 := _b(sim, "monument_villagers", 2, -18, -2)
	var h2 := _b(sim, "monument_soldiers", 2, -18, 4)
	var sp := _u(sim, "spearman", 2, 0.0, 0.0)       # ~16 tiles off
	var sfar := _u(sim, "spearman", 2, 16.0, 0.0)    # ~32 tiles off
	var hph: Array = [_u(sim, "pharaoh", 2, -20.0, -4.0)]
	var hph2: Array = [_u(sim, "pharaoh", 2, -20.0, 6.0)]
	sim.tick(1)
	sim.damage(sp, 60.0, 0)
	sim.damage(sfar, 60.0, 0)
	r["unempowered hp/s"] = _r(_hp_rate(sim, sp, 3.0))
	sim.order_empower(PackedInt32Array(hph), h1)
	_wait_empowered(sim, 2)
	r["one empowered hp/s"] = _r(_hp_rate(sim, sp, 4.0))
	sim.order_empower(PackedInt32Array(hph2), h2)
	_wait_empowered(sim, 2, 2)
	r["two empowered hp/s"] = _r(_hp_rate(sim, sp, 4.0))
	r["32 tiles off hp/s"] = _r(_hp_rate(sim, sfar, 2.0))
	sim.order(sp, {"type": "move", "x": C.x + 0.0, "z": C.y + 14.0})
	sim.tick(2)
	r["two, walking (busy) hp/s"] = _r(_hp_rate(sim, sp, 2.0))
	r["isis_healed"] = _r(float(sim.get_civ_state(2).isis_healed), 2)
	ok = r["unempowered hp/s"] == 0.0 and _near(r["one empowered hp/s"], 1.0, 0.02) and _near(r["two empowered hp/s"], 2.0, 0.02)
	ok = ok and r["32 tiles off hp/s"] == 0.0 and _near(r["two, walking (busy) hp/s"], 1.0, 0.05)
	_check("auras.isis_heal", ok, r)

	# --- Set's Devotees: a Barracks / Migdol in 18 tiles of a Monument trains at -10 %
	# (the refund of a cancelled one is what he paid); a far Barracks and Ra's pay in full
	r = {}
	ok = true
	for g in ["set", "ra"]:
		sim = _fresh("zeus", g, seed_arg, 3)
		_b(sim, "monument_villagers", 2, -16, -4)
		var dbk := _b(sim, "eg_barracks", 2, -8, -4)
		var dfar := _b(sim, "eg_barracks", 2, 12, -4)
		var dmg := _b(sim, "migdol", 2, -8, 6)
		for hx in [-16, -12, -8]: # (pop room: Set's age-ups gave him 9 Animals of Set)
			_b(sim, "house", 2, hx, 16)
		sim.tick(1)
		var paid := func(b: int, t: String) -> Array:
			var a: Dictionary = _res(sim, 2)
			sim.train(b, t)
			var c: Dictionary = _res(sim, 2)
			return [_r(a.food - c.food, 2), _r(a.wood - c.wood, 2), _r(a.gold - c.gold, 2)]
		var row := {}
		row["spearman near [f, w, g]"] = paid.call(dbk, "spearman")
		row["spearman far"] = paid.call(dfar, "spearman")
		row["camel rider at the migdol"] = paid.call(dmg, "camel_rider")
		var before: Dictionary = _res(sim, 2)
		sim.cancel_train(dbk, 0)
		var after: Dictionary = _res(sim, 2)
		row["refund near [f, g]"] = [_r(after.food - before.food, 2), _r(after.gold - before.gold, 2)]
		row["get_trains cost near"] = sim.get_trains(dbk)[0].cost
		row["devotees"] = sim.get_civ_state(2).devotees.size()
		r[g] = row
		var k := 0.9 if g == "set" else 1.0
		ok = ok and row["spearman near [f, w, g]"] == [_r(50 * k, 2), 0.0, _r(25 * k, 2)] and row["spearman far"] == [50.0, 0.0, 25.0]
		ok = ok and row["camel rider at the migdol"] == [_r(50 * k, 2), 0.0, _r(70 * k, 2)] and row["refund near [f, g]"] == [_r(50 * k, 2), _r(25 * k, 2)]
		ok = ok and _near(float(row["get_trains cost near"].food), 50 * k) and row.devotees == (2 if g == "set" else 0)
	_check("auras.devotees", ok, r)

# locks ------------------------------------------------------------------------------------

func _case_locks() -> void:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var r := {}
	# builds
	var gv := _u(sim, "villager", 1, -6.0, 0.0)
	var lb := _u(sim, "laborer", 2, 6.0, 0.0)
	sim.tick(1)
	r["greek places a granary"] = int(sim.place_building("granary", 1, C.x - 10, C.y - 10, PackedInt32Array([gv])))
	r["greek can_build granary"] = sim.can_build(1, "granary")
	r["egyptian places a storehouse"] = int(sim.place_building("storehouse", 2, C.x + 8, C.y - 10, PackedInt32Array([lb])))
	r["egyptian places an academy"] = int(sim.place_building("barracks", 2, C.x + 8, C.y - 10, PackedInt32Array([lb])))
	var ok: bool = r["greek places a granary"] == 0 and r["egyptian places a storehouse"] == 0 and r["egyptian places an academy"] == 0
	# trains
	var gtc := _b(sim, "town_center", 1, -14, 6)
	var etc := _b(sim, "town_center", 2, 6, 6)
	var gtm := _b(sim, "temple", 1, -14, -16)
	sim.tick(1)
	r["greek TC laborer"] = sim.train(gtc, "laborer").reason
	r["egyptian TC villager"] = sim.train(etc, "villager").reason
	r["greek temple priest"] = sim.train(gtm, "priest").reason
	r["egyptian TC priest, no temple"] = sim.train(etc, "priest").reason
	ok = ok and not bool(sim.train(gtc, "laborer").ok) and not bool(sim.train(etc, "villager").ok) and not bool(sim.train(gtm, "priest").ok)
	ok = ok and r["egyptian TC priest, no temple"] == "Requires a Temple"
	var etm := _b(sim, "temple", 2, 12, -16)
	sim.tick(1)
	r["egyptian temple minotaur"] = sim.train(etm, "minotaur").reason
	r["egyptian TC priest, with temple"] = sim.train(etc, "priest").ok
	ok = ok and not bool(sim.train(etm, "minotaur").ok) and bool(r["egyptian TC priest, with temple"])
	# techs both ways
	var garm := _b(sim, "armory", 1, -18, 0)
	var earm := _b(sim, "armory", 2, 14, 0)
	sim.tick(1)
	r["greek hands_of_the_pharaoh"] = sim.research(gtm, "hands_of_the_pharaoh").reason
	r["egyptian sarissa"] = sim.research(earm, "sarissa").reason
	r["egyptian omniscience"] = sim.research(etm, "omniscience").reason
	r["egyptian hands_of_the_pharaoh"] = sim.research(etm, "hands_of_the_pharaoh").ok
	r["egyptian copper_weapons"] = sim.research(earm, "copper_weapons").ok
	ok = ok and r["greek hands_of_the_pharaoh"] != "" and r["egyptian sarissa"] != "" and r["egyptian omniscience"] != ""
	ok = ok and bool(r["egyptian hands_of_the_pharaoh"]) and bool(r["egyptian copper_weapons"])
	# the tech lists hold the owner's civ's techs only
	var keys := func(b: int) -> Array:
		var out := []
		for t in sim.get_techs(b):
			out.append(str(t.key))
		return out
	r["greek temple techs"] = keys.call(gtm).size()
	r["egyptian temple techs"] = keys.call(etm)
	r["egyptian armory techs"] = keys.call(earm).size()
	r["greek armory techs"] = keys.call(garm).size()
	ok = ok and r["greek temple techs"] == 23 and r["egyptian temple techs"] == ["hands_of_the_pharaoh"] and r["egyptian armory techs"] == 11 and r["greek armory techs"] == 21
	# Monuments: in order, one each
	r["monument 2 first"] = sim.can_build(2, "monument_soldiers")
	var m1 := int(sim.place_building("monument_villagers", 2, C.x + 2, C.y - 18, PackedInt32Array([lb])))
	r["monument 1"] = m1
	r["monument 1 again"] = sim.can_build(2, "monument_villagers")
	r["monument 2 after 1"] = sim.can_build(2, "monument_soldiers")
	ok = ok and not bool(r["monument 2 first"].ok) and m1 > 0 and not bool(r["monument 1 again"].ok) and bool(r["monument 2 after 1"].ok)
	# builders: a Laborer cannot build an Obelisk, a Priest builds nothing else
	var ob := _b(sim, "obelisk", 2, 16, 12, false)
	var hs := _b(sim, "house", 2, 10, 14, false)
	var pr := _u(sim, "priest", 2, 14.0, 10.0)
	sim.tick(1)
	r["laborer on obelisk"] = sim.order(lb, {"type": "build", "target": ob})
	r["priest on house"] = sim.order(pr, {"type": "build", "target": hs})
	r["priest on obelisk"] = sim.order(pr, {"type": "build", "target": ob})
	ok = ok and not bool(r["laborer on obelisk"]) and not bool(r["priest on house"]) and bool(r["priest on obelisk"])
	r["priest builds the obelisk (s, with his walk)"] = _build_time(sim, ob, 40.0)
	ok = ok and _near(r["priest builds the obelisk (s, with his walk)"], 12.0, 1.0)
	# limits: Mercenaries 12 (living + queued), Laborers 100
	for i in 11:
		_u(sim, "mercenary", 2, -4.0, 14.0)
	sim.tick(1)
	var n := 0
	for i in 3:
		if bool(sim.train(etc, "mercenary").ok):
			n += 1
	r["mercenaries trainable with 11 alive"] = n
	r["mercenary limit reason"] = sim.train(etc, "mercenary").reason
	var etc2 := _b(sim, "town_center", 2, -6, 16)
	for i in 8:
		_b(sim, "house", 2, -18 + (i % 4) * 3, -18 + (i / 4) * 3)
	sim.tick(1)
	var have := _units_of(sim, 2, "laborer").size()
	for i in 100 - have - 2:
		_u(sim, "laborer", 2, 0.0, 18.0)
	sim.tick(1)
	var q := 0
	for i in 5:
		if bool(sim.train(etc2, "laborer").ok):
			q += 1
	r["laborers trainable at 98"] = q
	r["laborer cap reason"] = sim.train(etc2, "laborer").reason
	ok = ok and n == 1 and q == 2 and r["mercenary limit reason"] == "Limit of 12 Mercenaries"
	# Mythic Age: the Egyptians need a Migdol
	var s2 := _fresh("zeus", "ra", seed_arg, 2)
	s2.set_player_resources(2, {"food": 5000, "gold": 5000})
	_b(s2, "armory", 2, 0, 0)
	s2.tick(1)
	r["mythic without migdol"] = s2.advance_age(2).reason
	_b(s2, "migdol", 2, 6, -8)
	s2.tick(1)
	r["mythic with migdol"] = s2.advance_age(2).ok
	ok = ok and r["mythic without migdol"] == "Requires a Migdol Stronghold" and bool(r["mythic with migdol"])
	_check("locks", ok, r)

# Set's Animals of Set -------------------------------------------------------------------------

func _menu_row(menu: Array, t: String) -> Dictionary:
	for e in menu:
		if str(e.type) == t:
			return e
	return {}

func _near_count(sim: Object, owner: int, types: Array, x: float, z: float, rad: float) -> Dictionary:
	var out := {}
	for t in types:
		var n := 0
		for id in _units_of(sim, owner, t):
			var u: Dictionary = sim.get_unit(id)
			if Vector2(float(u.x), float(u.z)).distance_to(Vector2(x, z)) <= rad:
				n += 1
		if n:
			out[t] = n
	return out

func _carcass_near(sim: Object, x: float, z: float, rad := 2.0) -> Dictionary:
	var R: Dictionary = sim.get_resources()
	var best := {}
	for i in R.count:
		var tn: String = R.type_names[R.type[i]]
		if tn != "deer" and tn != "boar":
			continue
		var tx := float(R.tile[i * 2]) + 0.5
		var tz := float(R.tile[i * 2 + 1]) + 0.5
		if Vector2(tx, tz).distance_to(Vector2(x, z)) <= rad + 1.0 and int(R.ids[i]) > int(best.get("id", 0)):
			best = {"id": int(R.ids[i]), "type": tn, "amount": float(R.amount[i])}
	return best

func _case_set() -> void:
	const ANIMALS := ["baboon_of_set", "gazelle_of_set", "hyena_of_set", "giraffe_of_set", "crocodile_of_set", "hippo_of_set", "rhino_of_set", "elephant_of_set", "deer_of_set", "boar_of_set"]
	# --- the Pharaoh's summons: menu by age, favor, time, a queue that does not stop him
	var r := {}
	var sim := _fresh("ra", "set", seed_arg, 0)
	sim.set_player_resources(2, {"favor": 100.0})
	var ph: int = _units_of(sim, 2, "pharaoh")[0]
	sim.tick(1)
	var menu: Array = sim.get_summon_menu(ph)
	r["menu archaic"] = menu.map(func(e): return "%s %s %s" % [e.type, JSON.stringify(e.cost), "ok" if e.ok else e.reason])
	var ok: bool = menu.size() == 8 and bool(_menu_row(menu, "baboon_of_set").ok) and str(_menu_row(menu, "gazelle_of_set").reason) == "Requires Classical Age"
	ok = ok and float(_menu_row(menu, "elephant_of_set").cost.favor) == 14 and float(_menu_row(menu, "hyena_of_set").time) == 4
	r["ra's pharaoh menu"] = sim.get_summon_menu(_units_of(sim, 1, "pharaoh")[0]).size()
	r["ra's pharaoh summons"] = sim.summon_animal(_units_of(sim, 1, "pharaoh")[0], "baboon_of_set")
	r["archaic gazelle"] = sim.summon_animal(ph, "gazelle_of_set")
	ok = ok and int(r["ra's pharaoh menu"]) == 0 and not bool(r["ra's pharaoh summons"].ok) and str(r["archaic gazelle"].reason) == "Requires Classical Age"
	# he walks off while two Baboons are summoned one after the other
	var b0 := _units_of(sim, 2, "baboon_of_set").size()
	var f0: float = _res(sim, 2).favor
	var ph0: Dictionary = sim.get_unit(ph)
	sim.order(ph, {"type": "move", "x": C.x + 10.0, "z": C.y + 0.0})
	var s1: Dictionary = sim.summon_animal(ph, "baboon_of_set")
	var s2: Dictionary = sim.summon_animal(ph, "baboon_of_set")
	r["favor paid for 2"] = _r(f0 - _res(sim, 2).favor, 2)
	r["queued"] = sim.get_summons(2).size()
	r["pop with the queue"] = int(sim.get_player(2).pop)
	var times := []
	var nb := b0
	for t in 9 * FPS:
		sim.tick(1)
		var n := _units_of(sim, 2, "baboon_of_set").size()
		if n > nb:
			times.append(_r((t + 1) / float(FPS), 2))
			nb = n
	var phu: Dictionary = sim.get_unit(ph)
	r["baboons appeared at [s]"] = times
	var walked := Vector2(float(phu.x), float(phu.z)).distance_to(Vector2(float(ph0.x), float(ph0.z)))
	r["pharaoh while summoning: order, walked"] = [str(phu.order), _r(walked, 1)]
	r["summoned"] = sim.get_civ_state(2).summoned
	ok = ok and bool(s1.ok) and bool(s2.ok) and r["favor paid for 2"] == 6.0 and int(r.queued) == 2 and times.size() == 2
	ok = ok and str(phu.order) == "move" and walked > 10.0
	ok = ok and times.size() == 2 and _near(times[0], 3.0, 0.1) and _near(times[1], 6.0, 0.1) and int(r.summoned) == 2
	# no favor; the Mythic list, the Elephant of Set
	sim.set_player_resources(2, {"favor": 2.0})
	r["no favor"] = sim.summon_animal(ph, "baboon_of_set")
	sim.set_player_resources(2, {"favor": 100.0})
	sim.set_player_age(2, 3)
	var houses := 0
	for hx in [-16, -12, -8, -4]:
		_b(sim, "house", 2, hx, 14)
	sim.tick(1)
	f0 = _res(sim, 2).favor
	r["mythic elephant"] = sim.summon_animal(ph, "elephant_of_set")
	r["elephant favor"] = _r(f0 - _res(sim, 2).favor, 2)
	var ne := 0
	var t_el := -1.0
	for t in 10 * FPS:
		sim.tick(1)
		if _units_of(sim, 2, "elephant_of_set").size() > 0:
			t_el = _r((t + 1) / float(FPS), 2)
			break
	r["elephant after [s]"] = t_el
	r["menu mythic ok"] = sim.get_summon_menu(ph).filter(func(e): return e.ok).map(func(e): return e.type)
	ok = ok and str(r["no favor"].reason) == "Not enough favor" and bool(r["mythic elephant"].ok) and r["elephant favor"] == 14.0 and _near(t_el, 8.0, 0.05)
	ok = ok and r["menu mythic ok"].size() == 8
	_check("set.summon", ok, r)

	# --- the age-ups: 3 Animals of Set at the Temple (a real age-up, then set_player_age); Ra: none
	r = {}
	ok = true
	for g in ["set", "ra"]:
		sim = _fresh("zeus", g, seed_arg, 0, "deathmatch")
		var tm := _b(sim, "temple", 2, 0, 0)
		var tb: Dictionary = sim.get_building(tm)
		for hx in [-16, -12, -8, -4]:
			_b(sim, "house", 2, hx, 14)
		sim.tick(1)
		var row := {}
		var adv: Dictionary = sim.advance_age(2)
		for t in 120 * FPS:
			sim.tick(1)
			if int(sim.get_player(2).age) >= 1:
				break
		sim.tick(2)
		row["classical: at the temple"] = _near_count(sim, 2, ANIMALS, float(tb.x), float(tb.z), 9.0)
		sim.set_player_age(2, 3)
		sim.tick(2)
		row["after set_player_age(3): at the temple"] = _near_count(sim, 2, ANIMALS, float(tb.x), float(tb.z), 9.0)
		row["age_gift"] = sim.get_civ_state(2).age_gift
		row["advance"] = adv
		r[g] = row
		if g == "set":
			ok = ok and row["classical: at the temple"] == {"gazelle_of_set": 2, "hyena_of_set": 1}
			ok = ok and row["after set_player_age(3): at the temple"] == {"gazelle_of_set": 2, "hyena_of_set": 1, "giraffe_of_set": 2, "crocodile_of_set": 1, "hippo_of_set": 2, "rhino_of_set": 1}
			ok = ok and int(row.age_gift) == 9
		else:
			ok = ok and row["classical: at the temple"].is_empty() and row["after set_player_age(3): at the temple"].is_empty() and int(row.age_gift) == 0
	_check("set.age_gifts", ok, r)

	# --- Set's Priests convert wild animals: range 6, 35 s a deer, 50 s a boar; 75 % food kept
	r = {}
	sim = _fresh("zeus", "set", seed_arg, 0)
	var pr := _u(sim, "priest", 2, -12.0, 0.0)
	var deer: PackedInt32Array = sim.spawn_herd("deer", C.x + 0.0, C.y + 0.0, 1)
	var boar: PackedInt32Array = sim.spawn_herd("boar", C.x + 0.0, C.y + 8.0, 1)
	var rpr := _u(sim, "priest", 1, 17.0, 17.0)
	var hop0 := _u(sim, "hoplite", 1, 17.0, 15.0)
	sim.tick(1)
	r["greek priest? (a hoplite) convert order"] = sim.order(hop0, {"type": "convert", "target": deer[0]})
	sim.order_convert(PackedInt32Array([pr]), deer[0])
	var dist_at := -1.0
	var chan := 0   # ticks the Priest channels (in range; the deer may graze off and he follows)
	var t_d := -1.0
	for t in 70 * FPS:
		sim.tick(1)
		var u: Dictionary = sim.get_unit(pr)
		if str(u.anim) == "worship":
			chan += 1
			if dist_at < 0:
				var R: Dictionary = sim.get_resources()
				for i in R.count:
					if int(R.ids[i]) == deer[0]:
						dist_at = _r(Vector2(float(u.x), float(u.z)).distance_to(Vector2(float(R.tile[i * 2]) + 0.5, float(R.tile[i * 2 + 1]) + 0.5)), 1)
		if _units_of(sim, 2, "deer_of_set").size() > 0:
			t_d = (t + 1) / float(FPS)
			break
	r["deer: converted at [s] (walk + channel)"] = _r(t_d, 2)
	r["deer: priest distance when he starts (<= 6)"] = dist_at
	r["deer: channelled [s]"] = _r(chan / float(FPS), 2)
	var dos: Array = _units_of(sim, 2, "deer_of_set")
	r["deer of set"] = dos.size()
	var deer_gone := true
	var Rs: Dictionary = sim.get_resources()
	for i in Rs.count:
		if int(Rs.ids[i]) == deer[0]:
			deer_gone = false
	r["the wild deer is gone"] = deer_gone
	ok = dos.size() == 1 and deer_gone and _near(chan / float(FPS), 35.0, 0.1) and dist_at <= 7.0 and not bool(r["greek priest? (a hoplite) convert order"])
	# the boar: 50 s
	sim.order_convert(PackedInt32Array([pr]), boar[0])
	chan = 0
	for t in 90 * FPS:
		sim.tick(1)
		if str(sim.get_unit(pr).anim) == "worship":
			chan += 1
		if _units_of(sim, 2, "boar_of_set").size() > 0:
			break
	r["boar: channelled [s]"] = _r(chan / float(FPS), 2)
	ok = ok and _near(chan / float(FPS), 50.0, 0.1) and int(sim.get_civ_state(2).converted) == 2
	# the converted deer dies: a carcass with 75 % of the deer's 100 food; a Laborer butchers it
	var du: Dictionary = sim.get_unit(dos[0])
	sim.kill_unit(dos[0], 0)
	sim.tick(1)
	var cc := _carcass_near(sim, float(du.x), float(du.z))
	r["carcass"] = cc
	var lab := _u(sim, "laborer", 2, float(du.x) - C.x + 1.0, float(du.z) - C.y)
	_b(sim, "granary", 2, int(float(du.x) - C.x) - 5, int(float(du.z) - C.y) - 1)
	sim.tick(1)
	var f_before: float = _res(sim, 2).food
	if cc.has("id"):
		sim.order_gather(PackedInt32Array([lab]), cc.id)
	_step(sim, 150.0)
	var left := -1.0
	var R2: Dictionary = sim.get_resources()
	for i in R2.count:
		if cc.has("id") and int(R2.ids[i]) == cc.id:
			left = float(R2.amount[i])
	r["carcass left after 150 s (-1: butchered, gone)"] = left
	r["food the laborer brought (it, then whatever next)"] = _r(_res(sim, 2).food - f_before, 2)
	r["carcass_food"] = sim.get_civ_state(2).carcass_food
	ok = ok and cc.has("id") and _near(float(cc.amount), 75.0) and str(cc.type) == "deer" and left == -1.0 and float(r["food the laborer brought (it, then whatever next)"]) >= 74.4
	# Ra's Priest cannot convert
	var dh: PackedInt32Array = sim.spawn_herd("deer", C.x + 14.0, C.y + 14.0, 1)
	r["a Greek-owned priest's convert order"] = sim.order(rpr, {"type": "convert", "target": dh[0]})
	var sr := _fresh("zeus", "ra", seed_arg, 0)
	var rp: int = _units_of(sr, 2, "priest")[0]
	var dr: PackedInt32Array = sr.spawn_herd("deer", C.x + 0.0, C.y + 0.0, 1)
	r["ra's priest convert order"] = sr.order(rp, {"type": "convert", "target": dr[0]})
	ok = ok and not bool(r["a Greek-owned priest's convert order"]) and not bool(r["ra's priest convert order"])
	_check("set.convert", ok, r)

	# --- each animal's live stats; Archaic x0.1 attack; Laborers' bow vs animals (12 pierce at 7.2)
	r = {}
	ok = true
	var want := {"baboon_of_set": [20, 3, 3], "gazelle_of_set": [15, 3.5, 3], "hyena_of_set": [45, 7, 4], "giraffe_of_set": [25, 5, 5],
		"crocodile_of_set": [70, 9, 6], "hippo_of_set": [100, 6, 7], "rhino_of_set": [135, 8, 9], "elephant_of_set": [270, 10, 14],
		"deer_of_set": [15, 3, 0], "boar_of_set": [70, 6, 0]}
	sim = _fresh("zeus", "set", seed_arg, 1)
	var st := {}
	for t in want:
		var d: Dictionary = sim.get_unit_def(t)
		var id := _u(sim, t, 2, 0.0, 0.0)
		var s: Dictionary = sim.get_unit_stats(id)
		st[t] = {"hp": d.hp, "damage": s.get("damage", d.attack.damage), "favor": d.cost.get("favor", 0.0), "pop": d.pop, "speed": d.speed,
			"hack": d.hack_armor, "pierce": d.pierce_armor, "food": d.food, "class": d["class"]}
		ok = ok and float(d.hp) == want[t][0] and _near(float(st[t].damage), want[t][1]) and float(st[t].favor) == want[t][2] and str(d["class"]) == "animal"
		sim.kill_unit(id, 0)
	r["stats"] = st
	# Archaic vs Classical: a Hyena's first blow on a hoplite (hack 0.30)
	for age in [0, 1]:
		sim = _fresh("zeus", "set", seed_arg, age)
		var hy := _u(sim, "hyena_of_set", 2, 0.0, 0.0)
		var hop := _u(sim, "hoplite", 1, 1.0, 0.0)
		sim.tick(1)
		r["hyena blow on a hoplite, age %d" % age] = _r(_first_hit(sim, hy, hop), 3)
	ok = ok and _near(r["hyena blow on a hoplite, age 0"], 0.7 * 0.7, 0.01) and _near(r["hyena blow on a hoplite, age 1"], 7 * 0.7, 0.01)
	# the Laborer's bow: 12 pierce vs a Hyena (pierce 0.225) from 7 tiles; his blow on a hoplite stays 6 hack
	sim = _fresh("ra", "set", seed_arg, 1)
	var hy2 := _u(sim, "hyena_of_set", 2, 0.0, 0.0)
	var lb := _u(sim, "laborer", 1, -7.0, 0.0)
	sim.tick(1)
	var lx: float = float(sim.get_unit(lb).x)
	r["laborer bow on a hyena"] = _r(_first_hit(sim, lb, hy2), 3)
	r["laborer moved before shooting"] = _r(absf(float(sim.get_unit(lb).x) - lx), 2)
	ok = ok and _near(r["laborer bow on a hyena"], 12 * (1 - 0.225), 0.01) and r["laborer moved before shooting"] < 0.5
	# a fight: 4 Laborers (Ra) against 2 Hyenas of Set (Set), 60 s
	sim = _fresh("ra", "set", seed_arg, 1)
	var labs := []
	var hys := []
	for i in 4:
		labs.append(_u(sim, "laborer", 1, -6.0, -3.0 + 2.0 * i))
	for i in 2:
		hys.append(_u(sim, "hyena_of_set", 2, 6.0, -1.0 + 2.0 * i))
	sim.tick(1)
	sim.order_attack_move(PackedInt32Array(hys), C.x - 6.0, C.y + 0.0)
	for l in labs:
		sim.order(l, {"type": "attack", "target": hys[0]})
	for t in 60 * FPS:
		sim.tick(1)
		if t % 15 == 0:
			for l in labs:
				if _alive(sim, l) and str(sim.get_unit(l).order) != "attack":
					for h in hys:
						if _alive(sim, h):
							sim.order(l, {"type": "attack", "target": h})
							break
	r["fight 4 laborers vs 2 hyenas: laborers left"] = labs.filter(func(x): return _alive(sim, x)).size()
	r["fight: hyenas left"] = hys.filter(func(x): return _alive(sim, x)).size()
	ok = ok and int(r["fight: hyenas left"]) == 0 and int(r["fight 4 laborers vs 2 hyenas: laborers left"]) >= 2
	_check("set.animals", ok, r)

# Egyptian prices and times where Retold differs ---------------------------------------------

func _case_civcosts() -> void:
	var r := {}
	var ok := true
	for g in ["ra", "zeus"]:
		var sim := _fresh(g, "zeus", seed_arg, 3)
		var row := {}
		var tw := _b(sim, "tower", 1, 0, 0)
		var wl: Dictionary = sim.place_wall(1, Vector2i(C.x - 10, C.y + 8), Vector2i(C.x - 4, C.y + 8), PackedInt32Array())
		sim.tick(1)
		var a: Dictionary = _res(sim, 1)
		row["watch_tower"] = sim.research(tw, "watch_tower")
		var b: Dictionary = _res(sim, 1)
		row["watch tower paid [f, w, g]"] = [_r(a.food - b.food), _r(a.wood - b.wood), _r(a.gold - b.gold)]
		sim.cancel_research(tw, "watch_tower")
		var c: Dictionary = _res(sim, 1)
		row["refund [f, w, g]"] = [_r(c.food - b.food), _r(c.wood - b.wood), _r(c.gold - b.gold)]
		var fort: Dictionary = sim.get_fortify(1)
		var costs := {}
		for e in fort.techs:
			costs[e.key] = e.cost
		row["costs"] = costs
		r[g] = row
		if g == "ra":
			ok = ok and row["watch tower paid [f, w, g]"] == [0.0, 50.0, 100.0] and row["refund [f, w, g]"] == [0.0, 50.0, 100.0]
			ok = ok and costs.fortified_wall == {"food": 500.0, "gold": 400.0} and costs.citadel_wall == {"food": 800.0, "gold": 500.0}
		else:
			ok = ok and row["watch tower paid [f, w, g]"] == [0.0, 100.0, 100.0] and costs.fortified_wall == {"wood": 250.0, "gold": 200.0}
	_check("civcosts.fort_upgrades", ok, r)

	# one worker's build time: Egyptian (Retold base x4/3) vs Greek
	r = {}
	ok = true
	for g in ["ra", "zeus"]:
		var row := {}
		for t in ["town_center", "farm", "tower", "house"]:
			var sim := _fresh(g, "zeus", seed_arg, 1)
			var site := _b(sim, t, 1, 0, 0, false)
			var wk := _u(sim, "laborer" if g == "ra" else "villager", 1, -3.0, -3.0)
			sim.tick(1)
			sim.order_build(PackedInt32Array([wk]), site)
			row[t] = _r(_build_time(sim, site, 260.0), 1)
			row[t + " (get_building_def)"] = _r(float(sim.get_building_def(t, 1).get("by_civ", {}).get("egyptian" if g == "ra" else "greek", {}).get("build_time", -1)), 2)
		r[g] = row
	# (the walk to the site is in the measure: up to ~2 s)
	ok = _near(r.ra.town_center, 200.0, 3.0) and _near(r.ra.farm, 13.3, 2.5) and _near(r.ra.tower, 80.0, 3.0) and _near(r.ra.house, 20.0, 2.5)
	ok = ok and _near(r.zeus.town_center, 60.0, 3.0) and _near(r.zeus.tower, 30.0, 3.0)
	ok = ok and _near(r.ra["town_center (get_building_def)"], 200.0, 0.01) and _near(r.ra["farm (get_building_def)"], 13.33, 0.01)
	_check("civcosts.build_times", ok, r)

	# the Laborer's armor (25 / 35 % x0.75) against the villager's 0; drop-site LOS 5.4
	r = {}
	var sim := _fresh("zeus", "ra", seed_arg, 1)
	var lb := _u(sim, "laborer", 2, 0.0, 0.0)
	var vl := _u(sim, "villager", 1, 0.0, 14.0)
	var h1 := _u(sim, "hoplite", 1, 1.0, 0.0)
	var h2 := _u(sim, "hoplite", 2, 1.0, 14.0)
	var tx1 := _u(sim, "toxotes", 1, -6.0, 0.0)
	sim.tick(1)
	r["toxotes arrow on a laborer"] = _r(_first_hit(sim, tx1, lb), 3)
	sim.order_idle(PackedInt32Array([tx1]))
	r["hoplite blow on a laborer"] = _r(_first_hit(sim, h1, lb), 3)
	r["hoplite blow on a villager"] = _r(_first_hit(sim, h2, vl), 3)
	r["drop sites LOS"] = [sim.get_building_def("granary", 2).sight, sim.get_building_def("lumber_camp", 2).sight, sim.get_building_def("mining_camp", 2).sight]
	ok = _near(r["hoplite blow on a laborer"], 9 * (1 - 0.1875), 0.01) and _near(r["hoplite blow on a villager"], 9.0, 0.01)
	ok = ok and _near(r["toxotes arrow on a laborer"], 7 * (1 - 0.2625), 0.01) and r["drop sites LOS"] == [5.4, 5.4, 5.4]
	_check("civcosts.laborer_armor_los", ok, r)

# determinism ------------------------------------------------------------------------------

func _scenario() -> String:
	var sim := _fresh("zeus", "isis", seed_arg + 1, 1, "high")
	_econ_side(sim, 1, false, -1)
	_econ_side(sim, 2, true, 1)
	var lc: Array = _buildings_of(sim, 2, "lumber_camp")
	sim.order_empower(PackedInt32Array(_units_of(sim, 2, "pharaoh")), lc[0])
	var a := []
	var b := []
	for i in 6:
		a.append(_u(sim, ["hoplite", "toxotes"][i % 2], 1, -4.0 + (i % 3), 18.0 + i / 3))
		b.append(_u(sim, ["spearman", "slinger"][i % 2], 2, 4.0 + (i % 3), 18.0 + i / 3))
	sim.tick(1)
	sim.order_attack_move(PackedInt32Array(a), C.x + 8.0, C.y + 18.0)
	sim.order_attack_move(PackedInt32Array(b), C.x - 8.0, C.y + 18.0)
	_step(sim, 120.0)
	return "%d %s %s" % [sim.units_hash(), JSON.stringify(_res(sim, 1)), JSON.stringify(_res(sim, 2))]

## Set against a Greek: summons while the Pharaoh walks, a Priest converting, the age-up gift, a fight with animals
func _scenario_set() -> String:
	var sim := _fresh("zeus", "set", seed_arg + 2, 0, "high")
	_econ_side(sim, 1, false, -1)
	_econ_side(sim, 2, true, 1)
	sim.set_player_resources(2, {"favor": 60.0})
	var ph: int = _units_of(sim, 2, "pharaoh")[0]
	var pr := _u(sim, "priest", 2, 6.0, -14.0)
	var deer: PackedInt32Array = sim.spawn_herd("deer", C.x + 10.0, C.y - 14.0, 3)
	for hx in [12, 16]:
		_b(sim, "house", 2, hx, 6)
	sim.tick(1)
	sim.order(ph, {"type": "move", "x": C.x + 4.0, "z": C.y + 18.0})
	for i in 3:
		sim.summon_animal(ph, "baboon_of_set")
	sim.order_convert(PackedInt32Array([pr]), deer[0])
	var a := []
	for i in 4:
		a.append(_u(sim, "hoplite", 1, -4.0 + (i % 2), 18.0 + i / 2))
	_step(sim, 20.0)
	sim.set_player_age(2, 1)
	var b: Array = _units_of(sim, 2, "baboon_of_set") + _units_of(sim, 2, "gazelle_of_set") + _units_of(sim, 2, "hyena_of_set")
	sim.order_attack_move(PackedInt32Array(b), C.x - 6.0, C.y + 18.0)
	sim.order_attack_move(PackedInt32Array(a), C.x + 6.0, C.y + 18.0)
	_step(sim, 100.0)
	var cs: Dictionary = sim.get_civ_state(2)
	return "%d %s %s summoned %d converted %d gift %d carcass %.2f" % [sim.units_hash(), JSON.stringify(_res(sim, 1)), JSON.stringify(_res(sim, 2)),
		cs.summoned, cs.converted, cs.age_gift, cs.carcass_food]

func _case_determinism() -> void:
	var a := _scenario()
	var b := _scenario()
	_check("determinism", a == b, {"a": a, "b": b})
	a = _scenario_set()
	b = _scenario_set()
	_check("determinism.set", a == b and a.contains("summoned 3") and a.contains("gift 3"), {"a": a, "b": b})

# rules off --------------------------------------------------------------------------------

func _case_rules_off() -> void:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(false)
	var r: Dictionary = sim.start_match({"seed": seed_arg, "map_size": 128, "players": [{"id": 1, "human": true, "god": "ra"}, {"id": 2, "human": true, "god": "zeus"}]})
	var civ := str(sim.get_player(1).civ)
	var st: Array = sim.get_starts()
	var tx := int(st[0].tx) + 8
	var tz := int(st[0].tz) + 8
	var lab := int(sim.spawn_unit("laborer", 1, tx, tz, 0.0))
	var gran := int(sim.spawn_building("granary", 1, tx, tz, true, false))
	var placed := int(sim.place_building("granary", 1, tx, tz, PackedInt32Array()))
	var tc: Array = _buildings_of(sim, 1, "town_center")
	var tr: Dictionary = sim.train(tc[0], "laborer")
	var vills := _units_of(sim, 1, "villager")
	var emp: bool = sim.order(vills[0], {"type": "empower", "target": tc[0]})
	var hy := int(sim.spawn_unit("hyena_of_set", 1, tx, tz, 0.0))
	var conv: bool = sim.order(vills[0], {"type": "convert", "target": 1})
	var sm: Dictionary = sim.summon_animal(vills[0], "baboon_of_set")
	sim.set_godot_rules(true)
	_check("rules_off", bool(r.ok) and civ == "greek" and lab == 0 and gran == 0 and placed == 0 and not bool(tr.ok) and not emp and vills.size() == 5 and hy == 0 and not conv and not bool(sm.ok),
		{"spawn hyena_of_set": hy, "convert": conv, "summon": sm, "civ": civ, "spawn laborer": lab, "spawn granary": gran, "place granary": placed, "train laborer": tr.reason, "empower": emp, "villagers": vills.size()})
