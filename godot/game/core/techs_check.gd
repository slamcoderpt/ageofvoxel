extends SceneTree
## Scripted check of the research system and the Greek Armory, Market and
## Temple techs (native/src/sim/techs, PORTING.md "Research, Armory, Market,
## Temple techs"), headless, on AovSim matches of two human seats (no AI):
## every effect is measured on real numbers (a blow's damage from the
## unit:damaged event, hp, speed over a walk, heal / favor / poison over
## time, prices), before and after.
##
##   defs         47 techs (21 Armory, 3 Market, 23 Temple) with Retold's costs / times;
##                Armory and Market: 150 wood, 40 s, 1200 hp, 4x4, Classical
##   buildings    no Armory in the Archaic Age; villagers build one in the Classical Age
##   research     cost paid at queue time, one copy at a time, progress, cancel refunds
##                exactly, done after its time, event tech:researched, one-time; the
##                effect reaches existing and newly trained units; a building's
##                training waits while it researches
##   locks        age, prerequisite, minor god, wrong building, unit not in the game,
##                queue full, not enough resources
##   weapons      Copper / Bronze / Iron Weapons: hoplite, toxotes, hippikon, hero,
##                Town Center and tower arrows x1.1 / 1.2 / 1.3; myth units unchanged
##   armor        Copper / Bronze / Iron Armor and Shields: hack / pierce armor of a
##                hoplite (+0.1 each) and the hero (+0.15 each), measured on blows / arrows
##   ballistics   arrows at a running target miss without it and hit with it
##   armory_gods  Burning Pitch, Phobos, Enyo, Sarissa, Aegis, Sun Ray, Shafts of
##                Plague, Forge of Olympus, Olympian Weapons, Harvest of Souls
##   temple       Olympian Parentage, Labyrinth of Minos, Sylvan Lore, Will of Kronos,
##                Hymn of the Wildwood, Oracle, Temple of Healing, Golden Apples,
##                Dionysia, Face of the Gorgon, Monstrous Rage, Pious Sacrifice, Omniscience
##   market       buy / sell 100 for gold, prices move with each trade (shared by all
##                players), clamp, drift back; favor not traded; fees with Tax Collectors /
##                Ambassadors (130/70 -> 122/77 -> 115/85); tribute needs a Market, fee 20/10/0 %
##   determinism  two identical runs with research, trade and a fight end bit-equal
##   rules_off    with set_godot_rules(false) nothing can be researched, built or traded
##
##   godot --headless --path godot -s res://game/core/techs_check.gd [-- --only=defs,market,... --seed=3]
##
## Prints "TECHS PASS|FAIL <case> {detail}" and "TECHS_RESULT {json}"; exit = failures.

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
	print("TECHS %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(detail)])

static func _near(a: float, b: float, eps := 1e-3) -> bool:
	return absf(a - b) <= eps

# ---- helpers ------------------------------------------------------------------

## A 2-player match (both human, no AI), deathmatch stockpiles, Mythic Age,
## fog revealed, victory off; C = an open area far from both towns.
func _fresh(seed := 3, age := 3) -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := [{"id": 1, "name": "P1", "human": true, "team": 1}, {"id": 2, "name": "P2", "human": true, "team": 2}]
	var r: Dictionary = sim.start_match({"seed": seed, "map_size": 160, "preset": "skirmish", "resources": "deathmatch", "players": ps})
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
		return null
	sim.set_victory_enabled(false)
	sim.set_fog_reveal_all(true)
	sim.set_record_events(true)
	sim.set_player_age(1, age)
	sim.set_player_age(2, age)
	C = _open_area(sim, 26, 30.0)
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

func _b(sim: Object, type: String, owner: int, dx: int, dz: int) -> int:
	return int(sim.spawn_building(type, owner, C.x + dx, C.y + dz, true, false))

func _res(sim: Object, owner: int) -> Dictionary:
	var p: Dictionary = sim.get_player(owner)
	return {"food": float(p.food), "wood": float(p.wood), "gold": float(p.gold), "favor": float(p.favor)}

func _step(sim: Object, seconds: float) -> void:
	sim.tick(int(round(seconds * FPS)))

## The first blow / arrow from `att` on `tgt`: its damage (unit:damaged amount), -1 none.
func _first_hit(sim: Object, att: int, tgt: int, max_s := 20.0) -> float:
	sim.take_events()
	if att > 0 and not sim.get_unit(att).is_empty():
		sim.order(att, {"type": "attack", "target": tgt})
	for t in int(max_s * FPS):
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:damaged" and int(e.other) == att and int(e.id) == tgt:
				return float(e.amount)
	return -1.0

## Fresh sim, the techs granted to player 1, then the damage of a's first blow on t
## (a of owner ao at (-2, 0), t of owner to at (0, 0); or t a building type).
func _hit_case(a_type: String, t_type: String, techs: Array, ao := 1, to := 2, granted_to := 1) -> float:
	var sim := _fresh(seed_arg)
	for k in techs:
		sim.grant_tech(granted_to, k)
	var a := _u(sim, a_type, ao, -3.0 if a_type != "toxotes" else -8.0, 0.0)
	var t := -1
	if t_type in ["house", "temple", "armory"]:
		t = _b(sim, t_type, to, 1, -1)
	else:
		t = _u(sim, t_type, to, 0.5, 0.5)
	sim.tick(1)
	return _first_hit(sim, a, t)

func _stats(sim: Object, id: int) -> Dictionary:
	return sim.get_unit_stats(id)

func _tech(list: Array, key: String) -> Dictionary:
	for e in list:
		if str(e.key) == key:
			return e
	return {}

# ---- run ------------------------------------------------------------------------

func _run() -> void:
	var t0 := Time.get_ticks_msec()
	for c in ["defs", "buildings", "research", "locks", "weapons", "armor", "ballistics", "armory_gods", "temple", "market", "determinism", "rules_off"]:
		if _want(c):
			call("_case_" + c)
	result["ms"] = Time.get_ticks_msec() - t0
	result["passes"] = passes
	result["fails"] = fails
	print("TECHS_RESULT %s" % JSON.stringify(result))
	quit(fails.size())

# defs -------------------------------------------------------------------------------

func _case_defs() -> void:
	var sim := _fresh(seed_arg)
	var names: PackedStringArray = sim.tech_names()
	var per := {"armory": 0, "market": 0, "temple": 0}
	var missing := []
	for k in names:
		var d: Dictionary = sim.get_tech_def(k)
		per[str(d.building)] += 1
		if str(d.missing) != "":
			missing.append(k)
	_check("defs.count", names.size() == 47 and per.armory == 21 and per.market == 3 and per.temple == 23, {"n": names.size(), "per": per})
	# spot checks against reference/techs/TECHS.md
	var want := {
		"copper_weapons": [{"food": 100.0, "gold": 100.0}, 30.0, 1, ""],
		"bronze_weapons": [{"food": 200.0, "gold": 200.0}, 40.0, 2, "copper_weapons"],
		"iron_weapons": [{"food": 450.0, "gold": 450.0}, 50.0, 3, "bronze_weapons"],
		"bronze_armor": [{"food": 200.0, "gold": 150.0}, 40.0, 2, "copper_armor"],
		"iron_shields": [{"wood": 400.0, "gold": 350.0}, 50.0, 3, "bronze_shields"],
		"ballistics": [{"wood": 150.0, "gold": 150.0}, 50.0, 1, ""],
		"burning_pitch": [{"wood": 500.0, "gold": 300.0}, 40.0, 3, ""],
		"sarissa": [{"wood": 125.0, "favor": 20.0}, 40.0, 1, ""],
		"forge_of_olympus": [{"gold": 300.0, "favor": 30.0}, 5.0, 3, ""],
		"tax_collectors": [{"food": 200.0, "gold": 200.0}, 35.0, 2, ""],
		"ambassadors": [{"gold": 250.0}, 30.0, 3, "tax_collectors"],
		"olympian_parentage": [{"food": 100.0, "favor": 10.0}, 40.0, 0, ""],
		"monstrous_rage": [{"food": 250.0, "favor": 25.0}, 30.0, 3, ""],
		"shoulder_of_talos": [{"gold": 300.0, "favor": 20.0}, 50.0, 3, "hand_of_talos"],
	}
	var bad := []
	for k in want:
		var d: Dictionary = sim.get_tech_def(k)
		var w: Array = want[k]
		if d.is_empty() or d.base_cost != w[0] or not _near(float(d.time), w[1]) or int(d.age) != w[2] or str(d.requires) != w[3]:
			bad.append([k, d.get("base_cost"), d.get("time"), d.get("age"), d.get("requires")])
	_check("defs.retold_numbers", bad.is_empty(), {"bad": bad})
	var bdefs := []
	for k in ["armory", "market"]:
		var d: Dictionary = sim.get_building_def(k)
		bdefs.append(d)
	var bok := true
	for d in bdefs:
		bok = bok and float(d.hp) == 1200.0 and int(d.w) == 4 and int(d.h) == 4 and float(d.build_time) == 40.0 and d.cost == {"wood": 150.0} and int(d.min_age) == 1
	_check("defs.buildings", bok, {"armory": bdefs[0], "market": bdefs[1]})
	_check("defs.missing_units", missing.size() == 12 and "deimos_sword_of_dread" in missing and "coinage" in missing, {"missing": missing})

# buildings ------------------------------------------------------------------------------

func _case_buildings() -> void:
	var sim := _fresh(seed_arg, 0)
	var vills := []
	for i in 3:
		vills.append(_u(sim, "villager", 1, -4.0 + i, 4.0))
	sim.tick(1)
	var archaic := int(sim.place_building("armory", 1, C.x, C.y, PackedInt32Array(vills)))
	sim.set_player_age(1, 1)
	var before := _res(sim, 1)
	var arm := int(sim.place_building("armory", 1, C.x, C.y, PackedInt32Array(vills)))
	var after := _res(sim, 1)
	var built_s := -1.0
	for t in 90 * FPS:
		sim.tick(1)
		if arm > 0 and bool(sim.get_building(arm).get("built", false)):
			built_s = t / float(FPS)
			break
	var mk := int(sim.place_building("market", 1, C.x + 6, C.y, PackedInt32Array(vills)))
	var mk_built := false
	for t in 90 * FPS:
		sim.tick(1)
		if mk > 0 and bool(sim.get_building(mk).get("built", false)):
			mk_built = true
			break
	var b: Dictionary = sim.get_building(arm)
	_check("buildings.place_build", archaic == 0 and arm > 0 and _near(before.wood - after.wood, 150.0) and built_s > 0 and mk_built and float(b.max_hp) == 1200.0,
		{"archaic_refused": archaic == 0, "wood_paid": before.wood - after.wood, "built_s_3_villagers": built_s, "market_built": mk_built, "hp": b.get("max_hp")})

# research ---------------------------------------------------------------------------------

func _case_research() -> void:
	var sim := _fresh(seed_arg)
	var arm := _b(sim, "armory", 1, -10, -10)
	var arm2 := _b(sim, "armory", 1, 6, -10)
	var hop := _u(sim, "hoplite", 1, -3.0, 0.0)
	var foe := _u(sim, "villager", 2, 0.5, 0.5)
	sim.tick(1)
	var before := _res(sim, 1)
	var r: Dictionary = sim.research(arm, "copper_weapons")
	var start_t: float = sim.get_time()
	var paid := _res(sim, 1)
	var st := _tech(sim.get_techs(arm), "copper_weapons")
	var dup: Dictionary = sim.research(arm2, "copper_weapons")
	var r2: Dictionary = sim.research(arm, "copper_armor")
	var st2 := _tech(sim.get_techs(arm), "copper_armor")
	var mid := _res(sim, 1)
	var cancelled := bool(sim.cancel_research(arm, "copper_armor"))
	var refunded := _res(sim, 1)
	_check("research.queue_pay_cancel",
		bool(r.ok) and _near(before.food - paid.food, 100.0) and _near(before.gold - paid.gold, 100.0) and str(st.state) == "researching"
			and not bool(dup.ok) and str(dup.reason) == "Already being researched" and bool(r2.ok) and str(st2.state) == "queued"
			and _near(paid.food - mid.food, 75.0) and cancelled and refunded == paid,
		{"paid": [before.food - paid.food, before.gold - paid.gold], "state": st.get("state"), "dup": dup.reason,
			"queued": st2.get("state"), "refund_exact": refunded == paid})
	# the damage before; done after 30 s; the event; one-time
	var d0 := _first_hit(sim, hop, foe)
	sim.order_idle(PackedInt32Array([hop]))
	sim.take_events()
	var done_t := -1.0
	var ev_a := -1
	var prog_err := -1.0
	for t in 40 * FPS:
		sim.tick(1)
		if t == 5 * FPS:
			var want: float = (float(sim.get_time()) - start_t) / 30.0
			prog_err = absf(float(_tech(sim.get_techs(arm), "copper_weapons").get("progress", -1.0)) - want)
		for e in sim.take_events():
			if e.type == "tech:researched":
				ev_a = int(e.a)
				done_t = float(sim.get_time())
		if done_t > 0:
			break
	var def: Dictionary = sim.get_tech_def("copper_weapons")
	var again: Dictionary = sim.research(arm, "copper_weapons")
	var foe2 := _u(sim, "villager", 2, 0.5, -1.5)
	sim.tick(1)
	var d1 := _first_hit(sim, hop, foe2)
	var fresh := _u(sim, "hoplite", 1, -3.0, 2.0)
	sim.tick(1)
	var foe3 := _u(sim, "villager", 2, 0.5, 3.5)
	sim.tick(1)
	var d2 := _first_hit(sim, fresh, foe3)
	_check("research.done_effect",
		_near(done_t - start_t, 30.0, 0.1) and ev_a == int(def.event_a) and not bool(again.ok) and str(again.reason) == "Already researched"
			and _near(d0, 9.0) and _near(d1, 9.9) and _near(d2, 9.9) and prog_err >= 0 and prog_err < 0.01
			and str(_tech(sim.get_techs(arm), "copper_weapons").state) == "done",
		{"took_s": done_t - start_t, "event_a": ev_a, "again": again.reason, "hit_before": d0, "hit_after": d1, "new_unit": d2, "progress_error": prog_err})
	# training waits at a building that researches (Military Academy: Sarissa)
	var bar := _b(sim, "barracks", 1, -10, 4)
	sim.tick(1)
	var tr: Dictionary = sim.train(bar, "hoplite")
	var rs: Dictionary = sim.research(bar, "sarissa")
	sim.take_events()
	var trained_at := -1.0
	var sar_at := -1.0
	var t1: float = sim.get_time()
	for t in 70 * FPS:
		sim.tick(1)
		for e in sim.take_events():
			if e.type == "unit:trained" and trained_at < 0:
				trained_at = float(sim.get_time()) - t1
			if e.type == "tech:researched" and sar_at < 0:
				sar_at = float(sim.get_time()) - t1
		if trained_at > 0:
			break
	_check("research.training_waits", bool(tr.ok) and bool(rs.ok) and _near(sar_at, 40.0, 0.1) and trained_at > sar_at and _near(trained_at, 52.0, 0.2),
		{"sarissa_done_s": sar_at, "hoplite_trained_s": trained_at})

# locks ------------------------------------------------------------------------------------

func _case_locks() -> void:
	var sim := _fresh(seed_arg, 1)
	var arm := _b(sim, "armory", 1, -10, -10)
	var tmp := _b(sim, "temple", 1, 4, -10)
	sim.tick(1)
	var L: Array = sim.get_techs(arm)
	var s_bronze := str(_tech(L, "bronze_weapons").state)   # Heroic: age lock
	var r_bronze: Dictionary = sim.research(arm, "bronze_weapons")
	sim.set_player_age(1, 2)
	var s_bronze2 := str(_tech(sim.get_techs(arm), "bronze_weapons").state)   # no Copper: prerequisite lock
	var r_bronze2: Dictionary = sim.research(arm, "bronze_weapons")
	var s_deimos := str(_tech(sim.get_techs(arm), "deimos_sword_of_dread").state)
	var r_wrong: Dictionary = sim.research(tmp, "copper_weapons")
	var g: Dictionary = sim.set_minor_god(1, 1, "athena")
	var s_phobos := str(_tech(sim.get_techs(arm), "phobos_spear_of_panic").state)
	var s_sarissa := str(_tech(sim.get_techs(arm), "sarissa").state)
	var g_bad: Dictionary = sim.set_minor_god(1, 1, "apollo")
	var n_ok := 0
	for k in ["copper_weapons", "copper_armor", "copper_shields", "ballistics", "sarissa"]:
		if bool(sim.research(arm, k).ok):
			n_ok += 1
	var full: Dictionary = sim.research(arm, "aegis_shield")
	var arm2 := _b(sim, "armory", 1, 6, 4)
	sim.set_player_resources(1, {"food": 0, "wood": 0, "gold": 0, "favor": 0})
	sim.tick(1)
	var poor: Dictionary = sim.research(arm2, "aegis_shield")
	_check("locks.all", s_bronze == "locked_age" and not bool(r_bronze.ok) and str(r_bronze.reason) == "Requires Heroic Age"
			and s_bronze2 == "locked_prereq" and not bool(r_bronze2.ok) and s_deimos == "unavailable"
			and not bool(r_wrong.ok) and bool(g.ok) and s_phobos == "locked_god" and s_sarissa == "available" and not bool(g_bad.ok)
			and n_ok == 5 and str(full.reason) == "Queue full" and str(poor.reason) == "Not enough resources",
		{"age": [s_bronze, r_bronze.reason], "prereq": [s_bronze2, r_bronze2.reason], "deimos": s_deimos, "wrong_building": r_wrong.reason,
			"god": [s_phobos, s_sarissa, g_bad.reason], "queued": n_ok, "full": full.reason, "poor": poor.reason})

# weapons ------------------------------------------------------------------------------------

func _case_weapons() -> void:
	var tiers := [[], ["copper_weapons"], ["copper_weapons", "bronze_weapons"], ["copper_weapons", "bronze_weapons", "iron_weapons"]]
	var rows := {}
	var ok := true
	for ut in ["hoplite", "toxotes", "hippikon", "hero", "minotaur"]:
		var v := []
		for tl in tiers:
			v.append(_hit_case(ut, "villager", tl))
		rows[ut] = v
		for i in 4:
			var want: float = v[0] * (1.0 + (0.1 * i if ut != "minotaur" else 0.0))
			ok = ok and v[0] > 0 and _near(v[i], want)
	# building arrows: a Town Center and a tower on an enemy villager
	var b_rows := {}
	for bt in ["town_center", "tower"]:
		var v := []
		for tl in [[], ["copper_weapons", "bronze_weapons", "iron_weapons"]]:
			var sim := _fresh(seed_arg)
			for k in tl:
				sim.grant_tech(1, k)
			var b := _b(sim, bt, 1, -3, -3)
			sim.tick(1)
			var foe := _u(sim, "villager", 2, 4.0 + (3.0 if bt == "town_center" else 0.0), 0.5)
			sim.tick(1)
			v.append(_first_hit(sim, b, foe))
		b_rows[bt] = v
		ok = ok and v[0] > 0 and _near(v[1], v[0] * 1.3)
	_check("weapons.attack", ok, {"vs_villager [none, copper, bronze, iron]": rows, "building_arrows [none, all three]": b_rows})

# armor ------------------------------------------------------------------------------------

func _case_armor() -> void:
	var ok := true
	var rows := {}
	var lines := {"hack": ["copper_armor", "bronze_armor", "iron_armor"], "pierce": ["copper_shields", "bronze_shields", "iron_shields"]}
	for line in lines:
		var att := "hoplite" if line == "hack" else "toxotes"
		for target in ["hoplite", "hero", "minotaur"]:
			var v := []
			for n in 4:
				var tl: Array = lines[line].slice(0, n)
				# player 2's attacker on player 1's unit, player 1 has the techs
				v.append(_hit_case(att, target, tl, 2, 1, 1))
			rows["%s %s->%s" % [line, att, target]] = v
			var base: float = {"hoplite": 0.3, "hero": 0.4, "minotaur": 0.35}[target]
			var step: float = {"hoplite": 0.1, "hero": 0.15, "minotaur": 0.0}[target]
			for n in 4:
				var raw: float = v[0] / (1.0 - base)
				ok = ok and v[0] > 0 and _near(v[n], raw * (1.0 - min(0.95, base + step * n)))
	_check("armor.hack_pierce", ok, rows)

# ballistics -----------------------------------------------------------------------------------

func _running_hits(techs: Array) -> Dictionary:
	var sim := _fresh(seed_arg)
	for k in techs:
		sim.grant_tech(1, k)
	var archers := []
	for i in 3:
		archers.append(_u(sim, "toxotes", 1, -8.0, -1.0 + i))
	var runner := _u(sim, "villager", 2, 0.0, -8.0)   # (villagers on a move never turn to fight)
	sim.tick(1)
	for a in archers:
		sim.order(a, {"type": "attack", "target": runner})
	var hits := 0
	var misses := 0
	var leg := 0
	sim.take_events()
	for t in 30 * FPS:
		if t % (3 * FPS) == 0:
			leg += 1
			sim.order_move(PackedInt32Array([runner]), C.x + 0.5, C.y + (8.0 if leg % 2 == 1 else -8.0))
		sim.tick(1)
		if sim.get_unit(runner).is_empty() or bool(sim.get_unit(runner).dead):
			break
		for e in sim.take_events():
			if e.type == "unit:damaged" and int(e.id) == runner:
				hits += 1
		var S: PackedFloat32Array = sim.get_combat().stuck
		for i in range(6, S.size(), 7):
			if S[i] < 1.5 / FPS:
				misses += 1
	var st := _stats(sim, archers[0])
	return {"hits": hits, "misses": misses, "hit_rate": hits / maxf(1.0, hits + misses), "track": st.get("track")}

func _case_ballistics() -> void:
	var a := _running_hits([])
	var b := _running_hits(["ballistics"])
	_check("ballistics.track", float(a.track) == 1.0 and float(b.track) == 4.0 and float(a.hit_rate) < 0.5 and float(b.hit_rate) > 0.85,
		{"without": a, "with": b})

# Armory god techs and Burning Pitch -------------------------------------------------------------

func _case_armory_gods() -> void:
	# Burning Pitch: toxotes vs a house x4
	var bp0 := _hit_case("toxotes", "house", [])
	var bp1 := _hit_case("toxotes", "house", ["burning_pitch"])
	_check("armory.burning_pitch", bp0 > 0 and _near(bp1, bp0 * 4.0), {"vs_house": [bp0, bp1]})
	# Phobos: +1 divine (no armor) on a hoplite blow
	var ph0 := _hit_case("hoplite", "hoplite", [])
	var ph1 := _hit_case("hoplite", "hoplite", ["phobos_spear_of_panic"])
	_check("armory.phobos", _near(ph0, 9.0 * 0.7) and _near(ph1, 9.0 * 0.7 + 1.0), {"vs_hoplite": [ph0, ph1]})
	# Enyo: toxotes +10 %, arrows faster (shorter flight)
	var en := []
	var durs := []
	for tl in [[], ["enyo_bow_of_horror"]]:
		var sim := _fresh(seed_arg)
		for k in tl:
			sim.grant_tech(1, k)
		var a := _u(sim, "toxotes", 1, -9.0, 0.0)
		var t := _u(sim, "villager", 2, 0.5, 0.5)
		sim.tick(1)
		sim.order(a, {"type": "attack", "target": t})
		var dur := -1.0
		for i in 10 * FPS:
			sim.tick(1)
			var P: PackedFloat32Array = sim.get_combat().projectiles
			if P.size() >= 16:
				dur = P[13]
				break
		durs.append(dur)
		en.append(_first_hit(sim, a, t))
	_check("armory.enyo", _near(en[1], en[0] * 1.1) and durs[0] > 0.4 and _near(durs[1], 0.4 + (durs[0] - 0.4) / 1.5, 0.01), {"damage": en, "flight_s": durs})
	# Sarissa: hoplite +10 % and +0.3 range
	var sa0 := _hit_case("hoplite", "villager", [])
	var sa1 := _hit_case("hoplite", "villager", ["sarissa"])
	var sim2 := _fresh(seed_arg)
	var h := _u(sim2, "hoplite", 1, 0.0, 0.0)
	var r0 := float(_stats(sim2, h).range)
	sim2.grant_tech(1, "sarissa")
	var r1 := float(_stats(sim2, h).range)
	_check("armory.sarissa", _near(sa1, sa0 * 1.1) and _near(r1 - r0, 0.3), {"damage": [sa0, sa1], "range": [r0, r1]})
	# Aegis Shield: hoplite pierce armor +0.15 (toxotes arrow on a hoplite)
	var ae0 := _hit_case("toxotes", "hoplite", [], 2, 1)
	var ae1 := _hit_case("toxotes", "hoplite", ["aegis_shield"], 2, 1)
	_check("armory.aegis", _near(ae1, ae0 / 0.7 * 0.55), {"arrow_on_hoplite": [ae0, ae1]})
	# Sun Ray: +15 % ranged, an arrow reveals round its hit
	var sr0 := _hit_case("toxotes", "villager", [])
	var sim3 := _fresh(seed_arg)
	sim3.grant_tech(1, "sun_ray")
	var a3 := _u(sim3, "toxotes", 1, -8.0, 0.0)
	var t3 := _u(sim3, "villager", 2, 0.5, 0.5)
	sim3.tick(1)
	var sr1 := _first_hit(sim3, a3, t3)
	var rev := int(sim3.get_tech_rules().reveals)
	sim3.kill_unit(t3)
	_step(sim3, 7.0)
	var rev_after := int(sim3.get_tech_rules().reveals)
	_check("armory.sun_ray", _near(sr1, sr0 * 1.15) and rev >= 1 and rev_after == 0, {"damage": [sr0, sr1], "reveals": rev, "after_6s": rev_after})
	# Shafts of Plague: +10 %, then 0.25 / s poison for 6 s
	var sim4 := _fresh(seed_arg)
	sim4.grant_tech(1, "shafts_of_plague")
	var a4 := _u(sim4, "toxotes", 1, -8.0, 0.0)
	var t4 := _u(sim4, "hippikon", 2, 0.5, 0.5)
	sim4.tick(1)
	var sp1 := _first_hit(sim4, a4, t4)
	sim4.kill_unit(a4)
	var hp_a := float(sim4.get_unit(t4).hp)
	_step(sim4, 8.0)
	var hp_b := float(sim4.get_unit(t4).hp)
	_check("armory.shafts_of_plague", _near(sp1, 7.0 * 1.1 * 0.8) and _near(hp_a - hp_b, 1.5, 0.02), {"arrow": sp1, "poison_hp_lost": hp_a - hp_b})
	# Forge of Olympus: Armory techs -75 % f/w/g, research +50 % speed
	var sim5 := _fresh(seed_arg)
	var arm := _b(sim5, "armory", 1, -10, -10)
	sim5.tick(1)
	var c0: Dictionary = _tech(sim5.get_techs(arm), "bronze_weapons").cost
	sim5.grant_tech(1, "forge_of_olympus")
	sim5.grant_tech(1, "copper_weapons")
	var c1: Dictionary = _tech(sim5.get_techs(arm), "bronze_weapons").cost
	var c_fav: Dictionary = _tech(sim5.get_techs(arm), "sarissa").cost
	var p0 := _res(sim5, 1)
	sim5.research(arm, "bronze_weapons")
	var p1 := _res(sim5, 1)
	sim5.take_events()
	var took := -1.0
	for i in 40 * FPS:
		sim5.tick(1)
		for e in sim5.take_events():
			if e.type == "tech:researched":
				took = (i + 1) / float(FPS)
		if took > 0:
			break
	_check("armory.forge_of_olympus", c0 == {"food": 200.0, "gold": 200.0} and c1 == {"food": 50.0, "gold": 50.0} and c_fav == {"wood": 31.25, "favor": 20.0}
			and _near(p0.food - p1.food, 50.0) and _near(took, 40.0 / 1.5, 0.05),
		{"bronze_cost": [c0, c1], "sarissa_cost": c_fav, "took_s": took})
	# Olympian Weapons: hoplite +20 % and +1x vs myth units
	var ow0 := _hit_case("hoplite", "minotaur", [])
	var ow1 := _hit_case("hoplite", "minotaur", ["olympian_weapons"])
	var ow2 := _hit_case("hoplite", "villager", ["olympian_weapons"])
	_check("armory.olympian_weapons", _near(ow0, 9.0 * 0.65) and _near(ow1, 9.0 * 1.2 * 2.0 * 0.65) and _near(ow2, 9.0 * 1.2),
		{"vs_minotaur": [ow0, ow1], "vs_villager": ow2})
	# Harvest of Souls: after a kill, +15 % and reload x0.8 for 5 s
	var sim6 := _fresh(seed_arg)
	sim6.grant_tech(1, "harvest_of_souls")
	var hh := _u(sim6, "hoplite", 1, -3.0, 0.0)
	var v1 := _u(sim6, "villager", 2, 0.5, 0.5)
	var v2 := _u(sim6, "villager", 2, 0.5, 2.0)
	sim6.tick(1)
	var rl0 := float(_stats(sim6, hh).reload)
	var hs0 := _first_hit(sim6, hh, v1)
	sim6.kill_unit(v1, hh)
	var rl1 := float(_stats(sim6, hh).reload)
	var hs1 := _first_hit(sim6, hh, v2, 4.0)
	_step(sim6, 6.0)
	var rl2 := float(_stats(sim6, hh).reload)
	_check("armory.harvest_of_souls", _near(hs0, 9.0) and _near(hs1, 9.0 * 1.15) and _near(rl1, rl0 * 0.8) and _near(rl2, rl0),
		{"hit": [hs0, hs1], "reload": [rl0, rl1, rl2]})

# temple ------------------------------------------------------------------------------------------

func _case_temple() -> void:
	# Olympian Parentage: hero hp x1.25 (existing and new), +1 hp/s
	var sim := _fresh(seed_arg)
	var hero := _u(sim, "hero", 1, 0.0, 0.0)
	var mh0 := float(sim.get_unit(hero).max_hp)
	sim.grant_tech(1, "olympian_parentage")
	var mh1 := float(sim.get_unit(hero).max_hp)
	var hero2 := _u(sim, "hero", 1, 2.0, 0.0)
	var mh2 := float(sim.get_unit(hero2).max_hp)
	sim.damage(hero, 300.0)
	var hp0 := float(sim.get_unit(hero).hp)
	_step(sim, 10.0)
	var hp1 := float(sim.get_unit(hero).hp)
	_check("temple.olympian_parentage", _near(mh0, 900.0) and _near(mh1, 1125.0) and _near(mh2, 1125.0) and _near(hp1 - hp0, 10.0, 0.05),
		{"max_hp": [mh0, mh1, mh2], "regen_10s": hp1 - hp0})
	# Labyrinth of Minos: minotaur hp x1.35, speed x1.15 (measured over a walk)
	var lab := []
	for tl in [[], ["labyrinth_of_minos"]]:
		var s := _fresh(seed_arg)
		for k in tl:
			s.grant_tech(1, k)
		var m := _u(s, "minotaur", 1, -10.0, 0.0)
		s.tick(1)
		s.order_move(PackedInt32Array([m]), C.x + 12.0, C.y)
		_step(s, 0.5)
		var x0 := float(s.get_unit(m).x)
		_step(s, 3.0)
		lab.append([float(s.get_unit(m).max_hp), float(s.get_unit(m).x) - x0])
	_check("temple.labyrinth_of_minos", _near(lab[1][0], 480.0 * 1.35) and _near(lab[1][1] / lab[0][1], 1.15, 0.02), {"hp_and_3s_walk": lab})
	# Sylvan Lore: centaur hp x1.35, range +1.8, sight +0.6
	sim = _fresh(seed_arg)
	var cen := _u(sim, "centaur", 1, 0.0, 0.0)
	var s0 := _stats(sim, cen)
	sim.grant_tech(1, "sylvan_lore")
	var s1 := _stats(sim, cen)
	_check("temple.sylvan_lore", _near(s1.max_hp, s0.max_hp * 1.35) and _near(s1.range - s0.range, 1.8) and _near(s1.sight - s0.sight, 0.6),
		{"before": [s0.max_hp, s0.range, s0.sight], "after": [s1.max_hp, s1.range, s1.sight]})
	# Will of Kronos: cyclops splash 1.6 -> 2.5: a bystander 2.2 from the target is hit only with it
	var wk := []
	for tl in [[], ["will_of_kronos"]]:
		var s := _fresh(seed_arg)
		for k in tl:
			s.grant_tech(1, k)
		var cy := _u(s, "cyclops", 1, -3.0, 0.5)
		var t := _u(s, "villager", 2, 0.5, 0.5)
		var by := _u(s, "villager", 2, 0.5, 2.7)
		s.tick(1)
		var hit := _first_hit(s, cy, t)
		var by_hp := float(s.get_unit(by).hp)
		wk.append([hit, 75.0 - by_hp, float(_stats(s, cy).splash)])
	_check("temple.will_of_kronos", wk[0][0] > 0 and _near(wk[0][1], 0.0) and _near(wk[1][1], 15.0) and _near(wk[1][2] - wk[0][2], 0.9),
		{"[target hit, bystander hp lost, splash]": wk})
	# Hymn of the Wildwood: a hero heals a hurt villager beside him 0.75 hp/s
	sim = _fresh(seed_arg)
	var hy := _u(sim, "hero", 1, 0.0, 0.0)
	var hurt := _u(sim, "villager", 1, 1.5, 0.0)
	var far := _u(sim, "villager", 1, 8.0, 0.0)
	sim.tick(1)
	sim.damage(hurt, 40.0)
	sim.damage(far, 40.0)
	_step(sim, 4.0)
	var hy0 := float(sim.get_unit(hurt).hp)
	sim.grant_tech(1, "hymn_of_the_wildwood")
	_step(sim, 4.0)
	var hy1 := float(sim.get_unit(hurt).hp)
	_check("temple.hymn_of_the_wildwood", _near(hy0, 35.0) and _near(hy1 - hy0, 3.0, 0.05) and _near(float(sim.get_unit(far).hp), 35.0),
		{"hp_4s_before": hy0, "healed_4s": hy1 - hy0, "out_of_radius": sim.get_unit(far).hp})
	# Oracle: every unit +3 sight, buildings +3
	sim = _fresh(seed_arg)
	var vo := _u(sim, "villager", 1, 0.0, 0.0)
	var so0 := float(_stats(sim, vo).sight)
	sim.grant_tech(1, "oracle")
	var so1 := float(_stats(sim, vo).sight)
	var pt: Dictionary = sim.get_player_techs(1)
	_check("temple.oracle", _near(so1 - so0, 3.0) and _near(float(pt.building_sight), 3.0) and bool(pt.queue_view), {"sight": [so0, so1], "building_sight": pt.building_sight})
	# Temple of Healing: up to 3 idle units within reach healed 15 hp/s
	sim = _fresh(seed_arg)
	var tmp := _b(sim, "temple", 1, -3, -3)
	var hurt4 := []
	for i in 4:
		hurt4.append(_u(sim, "villager", 1, 4.0, -1.0 + i))
	sim.tick(1)
	for v in hurt4:
		sim.damage(v, 60.0)
	sim.grant_tech(1, "temple_of_healing")
	_step(sim, 0.5)
	var healed := []
	for v in hurt4:
		healed.append(float(sim.get_unit(v).hp) - 15.0)
	var n_healed := 0
	for x in healed:
		if x > 1.0:
			n_healed += 1
	var tmax: float = healed.max()
	_check("temple.temple_of_healing", tmp > 0 and n_healed == 3 and _near(tmax, 7.5, 0.3), {"hp_gained_0.5s": healed})
	# Golden Apples: favor x1.2 (worship measured over 30 s)
	var fav := []
	for tl in [[], ["golden_apples"]]:
		var s := _fresh(seed_arg)
		for k in tl:
			s.grant_tech(1, k)
		var t := _b(s, "temple", 1, -3, -3)
		var ws := []
		for i in 4:
			ws.append(_u(s, "villager", 1, 3.5, -2.0 + i))
		s.tick(1)
		s.order_worship(PackedInt32Array(ws), t)
		_step(s, 6.0)
		s.set_player_resources(1, {"favor": 0})
		_step(s, 30.0)
		fav.append(float(s.get_player(1).favor))
	_check("temple.golden_apples", fav[0] > 1.0 and _near(fav[1] / fav[0], 1.2, 0.01), {"favor_30s": fav})
	# Dionysia: all units +5 % hp
	sim = _fresh(seed_arg)
	var dv := _u(sim, "villager", 1, 0.0, 0.0)
	var dh := _u(sim, "hoplite", 1, 1.0, 0.0)
	sim.grant_tech(1, "dionysia")
	_check("temple.dionysia", _near(float(sim.get_unit(dv).max_hp), 78.75) and _near(float(sim.get_unit(dh).max_hp), 126.0),
		{"villager": sim.get_unit(dv).max_hp, "hoplite": sim.get_unit(dh).max_hp})
	# Face of the Gorgon: medusa range +3
	sim = _fresh(seed_arg)
	var me := _u(sim, "medusa", 1, 0.0, 0.0)
	var mr0 := float(_stats(sim, me).range)
	sim.grant_tech(1, "face_of_the_gorgon")
	var mr1 := float(_stats(sim, me).range)
	_check("temple.face_of_the_gorgon", _near(mr1 - mr0, 3.0), {"range": [mr0, mr1]})
	# Monstrous Rage: myth units reload x0.75 (blows counted over 30 s), speed x1.15
	var mrg := []
	for tl in [[], ["monstrous_rage"]]:
		var s := _fresh(seed_arg)
		for k in tl:
			s.grant_tech(1, k)
		var m := _u(s, "minotaur", 1, -3.0, 0.5)
		var t := _u(s, "minotaur", 2, 0.5, 0.5)
		s.tick(1)
		s.order(m, {"type": "attack", "target": t})
		var blows := 0
		s.take_events()
		for i in 30 * FPS:
			s.tick(1)
			for e in s.take_events():
				if e.type == "unit:damaged" and int(e.other) == m:
					blows += 1
		mrg.append([blows, float(_stats(s, m).reload), float(_stats(s, m).speed)])
	_check("temple.monstrous_rage", _near(mrg[1][1], mrg[0][1] * 0.75) and _near(mrg[1][2], mrg[0][2] * 1.15) and float(mrg[1][0]) >= float(mrg[0][0]) * 1.2,
		{"[blows_30s, reload, speed]": mrg})
	# Pious Sacrifice: a hoplite falls, the soldiers within 3 reload x0.9 per death (5 s)
	sim = _fresh(seed_arg)
	sim.grant_tech(1, "pious_sacrifice")
	var dead1 := _u(sim, "hoplite", 1, 0.0, 0.0)
	var dead2 := _u(sim, "hoplite", 1, 0.0, 0.6)
	var near := _u(sim, "toxotes", 1, 1.5, 0.0)
	var farh := _u(sim, "hoplite", 1, 8.0, 0.0)
	sim.tick(2)
	var pr0 := float(_stats(sim, near).reload)
	sim.kill_unit(dead1)
	var pr1 := float(_stats(sim, near).reload)
	sim.kill_unit(dead2)
	var pr2 := float(_stats(sim, near).reload)
	var prf := float(_stats(sim, farh).reload)
	_step(sim, 6.0)
	var pr3 := float(_stats(sim, near).reload)
	_check("temple.pious_sacrifice", _near(pr1, pr0 * 0.9) and _near(pr2, pr0 * 0.8) and _near(pr3, pr0) and _near(prf, 1.2),
		{"toxotes_reload [none, 1 death, 2 deaths, after 6 s]": [pr0, pr1, pr2, pr3], "far_hoplite": prf})
	# Omniscience: 100 gold x the enemies' population; then every enemy is seen
	sim = _fresh(seed_arg)
	sim.set_fog_reveal_all(false)
	var tm := _b(sim, "temple", 1, -3, -3)
	var st2: Dictionary = sim.get_starts()[1]
	var spot := Vector2(float(st2.tx) + 0.5, float(st2.tz) + 0.5)   # player 2's start: nobody of player 1 sees it
	var spy := int(sim.spawn_unit("hoplite", 2, spot.x, spot.y, 0.0))
	sim.tick(1)
	sim.fog_recompute()
	var seen0 := bool(sim.is_visible(spot.x, spot.y))
	var cost: Dictionary = _tech(sim.get_techs(tm), "omniscience").cost
	var g0: float = _res(sim, 1).gold
	var orr: Dictionary = sim.research(tm, "omniscience")
	var g1: float = _res(sim, 1).gold
	_step(sim, 4.5)
	sim.fog_recompute()
	var seen1 := bool(sim.is_visible(spot.x, spot.y))
	_check("temple.omniscience", bool(orr.ok) and float(cost.get("gold", 0.0)) > 0 and _near(g0 - g1, float(cost.gold)) and not seen0 and seen1
			and _near(float(cost.gold), 100.0 * 6),
		{"cost (5 villagers + 1 hoplite)": cost, "seen_before": seen0, "seen_after": seen1, "spy": spy})

# market --------------------------------------------------------------------------------------------

func _case_market() -> void:
	var sim := _fresh(seed_arg)
	var mk := _b(sim, "market", 1, -3, -3)
	var mk2 := _b(sim, "market", 2, 6, 6)
	sim.tick(1)
	var m0: Dictionary = sim.get_market(1)
	var r0 := _res(sim, 1)
	var b1: Dictionary = sim.market_buy(mk, "food")
	var r1 := _res(sim, 1)
	var m1: Dictionary = sim.get_market(1)
	var s1: Dictionary = sim.market_sell(mk, "wood")
	var r2 := _res(sim, 1)
	var m2: Dictionary = sim.get_market(1)
	# shared by all players: player 2 sees player 1's trades
	var m_p2: Dictionary = sim.get_market(2)
	_check("market.buy_sell",
		int(m0.food.buy) == 130 and int(m0.food.sell) == 70 and int(m0.wood.buy) == 130 and bool(b1.ok)
			and _near(r0.gold - r1.gold, 130.0) and _near(r1.food - r0.food, 100.0) and _near(float(m1.food.price), 102.0)
			and bool(s1.ok) and _near(r2.gold - r1.gold, 70.0) and _near(r1.wood - r2.wood, 100.0) and _near(float(m2.wood.price), 98.0)
			and _near(float(m_p2.food.price), 102.0) and not bool(m0.favor.tradable),
		{"start": [m0.food.buy, m0.food.sell], "after_buy_food": [m1.food.price, m1.food.buy, m1.food.sell], "after_sell_wood": [m2.wood.price, m2.wood.buy, m2.wood.sell]})
	# many trades: the price climbs / falls, clamped
	for i in 60:
		sim.market_sell(mk2, "wood")
	var low: Dictionary = sim.get_market(1)
	for i in 30:
		sim.market_buy(mk, "food")
	var high: Dictionary = sim.get_market(1)
	_check("market.moves_clamp", _near(float(low.wood.price), 25.0) and int(low.wood.sell) == 17 and _near(float(high.food.price), 162.0) and int(high.food.buy) == 210,
		{"wood_after_60_sales": low.wood, "food_after_31_buys": high.food})
	# drift back towards 100 (0.2 / s)
	_step(sim, 10.0)
	var dr: Dictionary = sim.get_market(1)
	_step(sim, 600.0)
	var dr2: Dictionary = sim.get_market(1)
	_check("market.drift", _near(float(dr.food.price), 160.0, 0.01) and _near(float(dr.wood.price), 27.0, 0.01) and _near(float(dr2.food.price), 100.0) and _near(float(dr2.wood.price), 100.0),
		{"after_10s": [dr.food.price, dr.wood.price], "after_610s": [dr2.food.price, dr2.wood.price]})
	# refusals
	var fav: Dictionary = sim.market_buy(mk, "favor")
	var gold: Dictionary = sim.market_buy(mk, "gold")
	var tmp := _b(sim, "temple", 1, -12, 6)
	sim.tick(1)
	var not_market: Dictionary = sim.market_buy(tmp, "food")
	sim.set_player_resources(1, {"food": 50, "gold": 10})
	var poor_b: Dictionary = sim.market_buy(mk, "food")
	var poor_s: Dictionary = sim.market_sell(mk, "food")
	sim.set_player_resources(1, {"food": 5000, "wood": 5000, "gold": 5000, "favor": 100})
	_check("market.refusals", not bool(fav.ok) and str(fav.reason) == "Favor cannot be traded" and not bool(gold.ok) and not bool(not_market.ok)
			and str(poor_b.reason) == "Not enough gold" and str(poor_s.reason) == "Not enough food",
		{"favor": fav.reason, "gold": gold.reason, "temple": not_market.reason, "poor": [poor_b.reason, poor_s.reason]})
	# fees: Tax Collectors, Ambassadors
	var fees := []
	var tribs := []
	var s2 := _fresh(seed_arg)
	var m3 := _b(s2, "market", 1, -3, -3)
	var no_mk: Dictionary = s2.tribute(2, 1, "gold", 100)
	s2.tick(1)
	for k in ["", "tax_collectors", "ambassadors"]:
		if k != "":
			s2.grant_tech(1, k)
		var m: Dictionary = s2.get_market(1)
		fees.append([m.fee, m.food.buy, m.food.sell])
		var a := _res(s2, 1)
		var p2a := _res(s2, 2)
		var tr: Dictionary = s2.tribute(1, 2, "wood", 100)
		tribs.append([a.wood - _res(s2, 1).wood, _res(s2, 2).wood - p2a.wood, tr.ok])
	_check("market.fees_tribute", _near(float(fees[0][0]), 0.3) and _near(float(fees[1][0]), 0.225) and _near(float(fees[2][0]), 0.15)
			and int(fees[0][1]) == 130 and int(fees[0][2]) == 70 and int(fees[1][1]) == 122 and int(fees[1][2]) == 77 and int(fees[2][1]) == 115 and int(fees[2][2]) == 85
			and _near(tribs[0][0], 120.0) and _near(tribs[1][0], 110.0) and _near(tribs[2][0], 100.0) and _near(tribs[0][1], 100.0)
			and not bool(no_mk.ok) and str(no_mk.reason) == "Tribute needs a Market"
			and str(_tech(s2.get_techs(m3), "coinage").state) == "unavailable",
		{"[fee, buy, sell]": fees, "tribute 100 wood [paid, received]": tribs, "no_market": no_mk.reason})

# determinism / rules off -------------------------------------------------------------------------------

func _scenario() -> String:
	var sim := _fresh(seed_arg + 1)
	var arm := _b(sim, "armory", 1, -10, -10)
	var mk := _b(sim, "market", 1, 6, -10)
	var tm := _b(sim, "temple", 2, 6, 6)
	sim.tick(1)
	sim.research(arm, "copper_weapons")
	sim.research(arm, "ballistics")
	sim.research(tm, "monstrous_rage")
	for i in 5:
		sim.market_buy(mk, "wood")
	var a := []
	var b := []
	for i in 6:
		a.append(_u(sim, ["hoplite", "toxotes"][i % 2], 1, -4.0 + (i % 3), -2.0 + i / 3))
		b.append(_u(sim, ["hoplite", "minotaur"][i % 2], 2, 4.0 + (i % 3), -2.0 + i / 3))
	sim.tick(1)
	for i in 6:
		sim.order(a[i], {"type": "attack", "target": b[i]})
		sim.order(b[i], {"type": "attack", "target": a[i]})
	_step(sim, 60.0)
	var m: Dictionary = sim.get_market(1)
	return "%d %s %s %s" % [sim.units_hash(), JSON.stringify(_res(sim, 1)), JSON.stringify(m.wood), JSON.stringify(sim.get_player_techs(1).done)]

func _case_determinism() -> void:
	var a := _scenario()
	var b := _scenario()
	_check("determinism", a == b, {"a": a, "b": b})

func _case_rules_off() -> void:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(false)
	sim.new_game(seed_arg, 128, "skirmish", 2)
	sim.set_player_resources(1, {"food": 5000, "wood": 5000, "gold": 5000, "favor": 100})
	sim.set_player_age(1, 3)
	var st: Array = sim.get_starts()
	var tx := int(st[0].tx) + 8
	var tz := int(st[0].tz) + 8
	var placed := int(sim.place_building("armory", 1, tx, tz, PackedInt32Array()))
	var arm := int(sim.spawn_building("armory", 1, tx, tz, true, false))
	var mk := int(sim.spawn_building("market", 1, tx + 6, tz, true, false))
	sim.tick(1)
	var r: Dictionary = sim.research(arm, "copper_weapons")
	var b: Dictionary = sim.market_buy(mk, "food")
	var t: Dictionary = sim.tribute(1, 2, "food", 100)
	var s := str(_tech(sim.get_techs(arm), "copper_weapons").state)
	sim.set_godot_rules(true)
	_check("rules_off", placed == 0 and not bool(r.ok) and not bool(b.ok) and not bool(t.ok) and s == "unavailable",
		{"place": placed, "research": r.reason, "buy": b.reason, "tribute": t.reason, "state": s})
