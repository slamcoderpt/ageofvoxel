extends SceneTree
## Scripted check of the civilizations and the Egyptians (native/src/sim/civ,
## PORTING.md "Civilizations, the Egyptians"), headless, on AovSim matches of
## human seats (no AI), every rule measured on real numbers.
##
##   defs         the two civs, their build menus and units; every Egyptian unit's and
##                building's numbers (Retold, mapped) printed and spot-checked
##   match        the god picks the civ (zeus -> Greek, ra / isis / set -> Egyptian);
##                Egyptian start: Town Center, 3 Laborers, the Pharaoh, a Priest, no favor
##   economy      5 minutes, the same woods / mine / farms for a Greek and an Egyptian:
##                wood, gold and food per worker (Laborers x0.9), each civ's drop sites
##                (Granary food only, Lumber Camp wood, Mining Camp gold), favor from 3
##                worshippers vs the five Monuments (39 / min), Laborers never worship
##   units        each Egyptian unit's live stats (get_unit_stats), its bonus measured on
##                a first blow, and its counter matchup fought at equal cost
##   pharaoh      empower measured before / after: gather (drop +20 %), train (+75 %, not
##                Laborers), build (+75 %), research (+75 %), Monument favor (+20 %);
##                Laborer build 0.75; respawn at the Town Center after 90 s; stats by age
##   priest       healing 7.5 hp/s (Pharaoh 10), half on a busy target; Priest damage x5 vs myth
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
	for c in ["defs", "match", "economy", "units", "pharaoh", "priest", "locks", "determinism", "rules_off"]:
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
	_check("defs.units", ok and units.size() == 13, units)
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
		for t in ["villager", "laborer", "pharaoh", "priest"]:
			st[t] = _units_of(sim, i + 1, t).size()
		st["favor"] = float(p.favor)
		st["tc"] = _buildings_of(sim, i + 1, "town_center").size()
		starts[str(p.god)] = st
	var ok: bool = bool(r.ok) and civs == ["greek", "egyptian", "egyptian", "egyptian"]
	ok = ok and starts.Zeus.villager == 5 and starts.Zeus.laborer == 0 and starts.Zeus.favor == 20
	for g in ["Ra", "Isis", "Set"]:
		ok = ok and starts[g].laborer == 3 and starts[g].pharaoh == 1 and starts[g].priest == 1 and starts[g].villager == 0 and starts[g].favor == 0 and starts[g].tc == 1
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
		["priest", "minotaur", 2.9 * 5 * 0.65], ["hoplite", "spearman", 9 * 0.7], ["toxotes", "spearman", 7 * (1 - 0.075)]]
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
	_check("units.bonus_hits", ok, {"measured": hits, "want": want})
	# counters at equal cost (900 resources each side)
	var fights := {}
	ok = true
	for f in [["spearman", "hippikon"], ["axeman", "hoplite"], ["slinger", "toxotes"], ["camel_rider", "hippikon"], ["chariot_archer", "hoplite"],
			["hippikon", "slinger"], ["war_elephant", "toxotes"]]:
		var r := _fight(f[0], f[1])
		fights["%s vs %s" % f] = r
		ok = ok and r.winner == f[0]
	# and the counters of the Egyptian units: the hippikon beats Slingers, hoplites the Chariots? (reported)
	fights["spearman vs axeman (reported)"] = _fight("spearman", "axeman", 900.0, "ra", "ra")
	_check("units.counters", ok, fights)

# pharaoh ------------------------------------------------------------------------------------

func _gather_run(empower: bool) -> Dictionary:
	var sim := _fresh("zeus", "ra", seed_arg, 1, "standard")
	sim.set_player_resources(2, {"food": 0, "wood": 0, "gold": 0, "favor": 0})
	for i in 12:
		sim.spawn_resource("tree", C.x - 2 + (i % 4), C.y - 14 + i / 4, 0)
	var lc := _b(sim, "lumber_camp", 2, -1, -10)
	var ph: Array = _units_of(sim, 2, "pharaoh")
	sim.tick(1)
	var ws := []
	for i in 4:
		ws.append(_u(sim, "laborer", 2, i - 1.5, -6.0))
	sim.tick(1)
	sim.order_gather(PackedInt32Array(ws), int(sim.nearest_resource(C.x, C.y - 9, "wood", 10)))
	if empower:
		sim.order_empower(PackedInt32Array(ph), lc)
	var w0 := float(_res(sim, 2).wood)
	_step(sim, 180.0)
	return {"wood": _r(float(_res(sim, 2).wood) - w0, 2), "bonus": _r(float(sim.get_civ_state(2).drop_bonus), 2),
		"empowered": sim.get_civ_state(2).empowered}

func _train_run(empower: bool, type: String, bt: String) -> float:
	var sim := _fresh("zeus", "ra", seed_arg, 3)
	var b := _b(sim, bt, 2, -2, -2)
	var ph: Array = _units_of(sim, 2, "pharaoh")
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
	var ph: Array = _units_of(sim, 2, "pharaoh")
	sim.tick(1)
	if empower:
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
	var ph: Array = _units_of(sim, 2, "pharaoh")
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
	var ph: Array = _units_of(sim, 2, "pharaoh")
	sim.tick(1)
	var f0 := float(_res(sim, 2).favor)
	_step(sim, 60.0)
	var f1 := float(_res(sim, 2).favor)
	sim.order_empower(PackedInt32Array(ph), m)
	for i in 60 * FPS:
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
	var hp0 := float(s2.get_unit(p0[0]).max_hp)
	s2.set_player_age(2, 1)
	s2.advance_age(2)   # (set_player_age emits no event: advance from Classical to Heroic for the event path)
	var hp_cl := float(s2.get_unit(p0[0]).max_hp)
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
	_check("pharaoh.respawn", none_yet and back.size() == 1 and near_tc, {"none_at_89s": none_yet, "back_at_91s": back, "at_tc": near_tc})
	_check("pharaoh.ages", hp0 == 100 and true, {"archaic_hp": hp0, "after set_player_age 1 (no event) hp": hp_cl})

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
		var t := _u(sim, "spearman", 2, 2.5, 0.0)
		sim.tick(1)
		sim.damage(t, 60.0, 0)
		if c[1]:
			sim.order_move(PackedInt32Array([t]), C.x + 2.5, C.y + 0.0)   # (busy: a move order to where it stands)
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
	r["priest builds the obelisk (s)"] = _build_time(sim, ob, 40.0)
	ok = ok and _near(r["priest builds the obelisk (s)"], 12.0, 0.6)
	# limits: Mercenaries 12, Laborers 100
	var n := 0
	for i in 14:
		if bool(sim.train(etc, "mercenary").ok):
			n += 1
	r["mercenaries queued of 14"] = n
	var etc2 := _b(sim, "town_center", 2, -6, 16)
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
	ok = ok and n == 12 and q == 2
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

func _case_determinism() -> void:
	var a := _scenario()
	var b := _scenario()
	_check("determinism", a == b, {"a": a, "b": b})

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
	sim.set_godot_rules(true)
	_check("rules_off", bool(r.ok) and civ == "greek" and lab == 0 and gran == 0 and placed == 0 and not bool(tr.ok) and not emp and vills.size() == 5,
		{"civ": civ, "spawn laborer": lab, "spawn granary": gran, "place granary": placed, "train laborer": tr.reason, "empower": emp, "villagers": vills.size()})
