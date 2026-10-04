extends SceneTree
## The enemy AI's research, ages and Market (sim combat/enemy_ai_techs.cpp),
## headless, on real matches (godot rules on, sim only):
##
##   godot --headless --path godot -s res://game/core/aitechs_check.gd [-- --only=ladder,market,determinism,duel --seed=1 --minutes=35]
##
## Cases (each prints "AITECHS PASS|FAIL <case> <details>"):
##   ladder       each difficulty in peace (the other AI idle, no waves) for
##                --minutes: when it builds its Armory / Market, reaches each
##                age, finishes each tech (its delay after reaching the tech's
##                age), Market lots. Easy researches little and late (<= 3
##                techs, the first after 18 min, Classical only, no Market);
##                Moderate more than Easy (Heroic, a Market), Hard more than Moderate
##                (its Market sooner), Titan at least Hard's, >= 18 techs, every
##                age before Hard (on its age plan), a median delay <= 10 min
##                after each age, Mythic before 30 min, every
##                weapons / armor / shields tier, the Armories in the order
##                Titan < Hard < Moderate < Easy
##   market       a Titan with its Market given a food / wood glut and no
##                gold sells lots (gold up, those prices down); then given
##                gold and no food / wood while it saves for an age buys them
##   determinism  two Titan runs to 22 min: the same techs at the same times,
##                the same lots, the same resources
##   duel         AI vs AI (Titan vs Moderate, Hard vs Easy): decided within
##                45 min, both sides researched
## Ends with "AITECHS_RESULT {json}"; exit code = number of failed cases.

const STEP := 300 # ticks (10 s)
var fails := 0
var only := []
var seed_arg := 1
var minutes := 35.0
var result := {}

func _initialize() -> void:
	var t0 := Time.get_ticks_msec()
	var a := AovArgs.parse()
	if a.has("only"):
		only = str(a.only).split(",")
	seed_arg = int(a.get("seed", 1))
	minutes = float(a.get("minutes", 35))
	if not ClassDB.class_exists("AovSim"):
		printerr("AITECHS FAIL AovSim missing (build the extension)")
		quit(1)
		return
	for c in ["ladder", "market", "determinism", "duel"]:
		if only.is_empty() or c in only:
			call("_case_" + c)
	result["ms"] = Time.get_ticks_msec() - t0
	result["fails"] = fails
	print("AITECHS_RESULT %s" % JSON.stringify(result))
	quit(fails)

func _report(name: String, ok: bool, det: Variant) -> void:
	if not ok:
		fails += 1
	print("AITECHS %s %s %s" % ["PASS" if ok else "FAIL", name, JSON.stringify(det)])
	result[name] = {"ok": ok, "details": det}

static func _sim(seed: int, players: Array) -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var ps := []
	for i in players.size():
		ps.append({"id": i + 1, "name": "P%d" % (i + 1), "human": false, "ai": str(players[i]), "team": 0, "color": -1})
	var r: Dictionary = sim.start_match({"seed": seed, "map_size": 128, "preset": "skirmish", "resources": "standard", "players": ps})
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
	return sim

# Steps a peace match of difficulty `d` (player 1; player 2 idle) to `mins`,
# recording when each tech is done.
func _peace(d: String, seed: int, mins: float, hook := Callable()) -> Dictionary:
	var sim := _sim(seed, [d, "easy"])
	sim.set_victory_enabled(false)
	sim.set_ai(2, {"enabled": false})
	sim.set_ai(1, {"next_wave_at": 1e9})
	var done_at := {}
	var armory_at := -1.0
	var market_at := -1.0
	while sim.get_time() < mins * 60.0:
		sim.tick(STEP)
		sim.take_events()
		var t := float(sim.get_time())
		for k in sim.get_player_techs(1).done:
			if not done_at.has(k):
				done_at[k] = snappedf(t / 60.0, 0.01)
		var tk: Dictionary = sim.get_ai(1).techs
		if armory_at < 0 and int(tk.armories) > 0:
			armory_at = t
		if market_at < 0 and int(tk.markets) > 0:
			market_at = t
		if hook.is_valid():
			hook.call(sim)
	var tk2: Dictionary = sim.get_ai(1).techs
	var age_min := [0.0, float(tk2.classical_at) / 60.0, float(tk2.heroic_at) / 60.0, float(tk2.mythic_at) / 60.0]
	# delay of each tech after reaching its age (on time)
	var lag := []
	for k in done_at:
		var age := int(sim.get_tech_def(k).age)
		if age >= 1 and age_min[age] > 0:
			lag.append(float(done_at[k]) - age_min[age])
	lag.sort()
	var pl: Dictionary = sim.get_player(1)
	return {"d": d, "done": done_at, "n": done_at.size(), "first": _first(done_at), "armory_min": snappedf(armory_at / 60.0, 0.01) if armory_at >= 0 else -1.0,
		"market_min": snappedf(market_at / 60.0, 0.01) if market_at >= 0 else -1.0,
		"classical": snappedf(age_min[1], 0.01), "heroic": snappedf(age_min[2], 0.01), "mythic": snappedf(age_min[3], 0.01), "age": int(pl.age),
		"lag_median": snappedf(lag[lag.size() / 2], 0.01) if not lag.is_empty() else -1.0,
		"sold": int(tk2.sold), "bought": int(tk2.bought), "gold_in": int(tk2.gold_in), "gold_out": int(tk2.gold_out),
		"holds": int(tk2.holds), "age_holds": int(tk2.age_holds), "gods": sim.get_player_techs(1).minor_gods,
		"res": [int(pl.food), int(pl.wood), int(pl.gold), int(pl.favor)], "pop": int(pl.pop)}

static func _first(done_at: Dictionary) -> float:
	var f := 1e9
	for k in done_at:
		f = minf(f, float(done_at[k]))
	return f if f < 1e9 else -1.0

func _case_ladder() -> void:
	var r := {}
	for d in ["easy", "moderate", "hard", "titan"]:
		r[d] = _peace(d, seed_arg, minutes)
		print("AITECHS   %s: %d techs (first %.1f min, lag median %.1f), armory %.1f, market %.1f, ages C %.1f H %.1f M %.1f, lots sold %d bought %d, gods %s" % [d, r[d].n, r[d].first,
			r[d].lag_median, r[d].armory_min, r[d].market_min, r[d].classical, r[d].heroic, r[d].mythic, r[d].sold, r[d].bought, r[d].gods])
		print("AITECHS     %s" % JSON.stringify(r[d].done))
	var e: Dictionary = r.easy
	var m: Dictionary = r.moderate
	var h: Dictionary = r.hard
	var t: Dictionary = r.titan
	var lines := ["copper_weapons", "copper_armor", "copper_shields", "bronze_weapons", "bronze_armor", "bronze_shields", "iron_weapons", "iron_armor", "iron_shields"]
	var titan_lines := true
	for k in lines:
		titan_lines = titan_lines and t.done.has(k)
	var checks := {
		"easy_little_late": e.n >= 1 and e.n <= 3 and e.first >= 18.0 and e.age == 1 and e.market_min < 0,
		"moderate_more": m.n > e.n and m.age >= 2 and m.market_min > 0,
		"hard_more": h.n > m.n and h.age >= 2 and h.market_min > 0 and h.market_min < m.market_min,
		"titan_most": t.n >= h.n and t.n >= 18 and t.mythic > 0 and t.mythic < 30.0 and titan_lines,
		# (on its age plan the Titan reaches every age first and researches
		# from early on; its median tech lag after each age grows as it reaches
		# the ages sooner and saves for the next, so it is bounded loosely)
		"titan_on_time": t.lag_median >= 0 and t.lag_median <= 10.0 and t.first < m.first and t.first < e.first - 8.0
			and t.classical < h.classical and t.heroic > 0 and t.heroic < h.heroic and t.mythic > 0 and t.mythic < h.mythic,
		"armory_order": t.armory_min > 0 and t.armory_min <= h.armory_min and h.armory_min <= m.armory_min and m.armory_min < e.armory_min,
	}
	var ok := true
	for k in checks:
		ok = ok and checks[k]
	_report("ladder", ok, {"checks": checks, "runs": r})

func _case_market() -> void:
	var st := {"phase": 0, "t": 0.0}
	var log := {}
	var hook := func(sim: Object) -> void:
		var tk: Dictionary = sim.get_ai(1).techs
		var t := float(sim.get_time())
		if st.phase == 0 and int(tk.markets) > 0 and bool(sim.get_market(1).has_market):
			st.phase = 1
			st.t = t
			var mk: Dictionary = sim.get_market(1)
			log["before"] = {"sold": int(tk.sold), "bought": int(tk.bought), "food_price": float(mk.food.price), "wood_price": float(mk.wood.price), "t": t}
			sim.set_player_resources(1, {"food": 3000.0, "wood": 3000.0, "gold": 0.0})
		elif st.phase == 1 and t >= st.t + 60:
			var mk2: Dictionary = sim.get_market(1)
			var pl: Dictionary = sim.get_player(1)
			log["glut"] = {"sold": int(tk.sold), "bought": int(tk.bought), "food_price": float(mk2.food.price), "wood_price": float(mk2.wood.price), "gold": float(pl.gold)}
			st.phase = 2
			st.t = t
			sim.set_player_resources(1, {"food": 0.0, "wood": 0.0, "gold": 4000.0})
		elif st.phase == 2 and t >= st.t + 60:
			var mk3: Dictionary = sim.get_market(1)
			log["short"] = {"sold": int(tk.sold), "bought": int(tk.bought), "food_price": float(mk3.food.price), "wood_price": float(mk3.wood.price)}
			st.phase = 3
	var r := _peace("titan", seed_arg, 26.0, hook)
	var ok: bool = st.phase == 3
	if ok:
		var b: Dictionary = log.before
		var g: Dictionary = log.glut
		var s: Dictionary = log.short
		ok = g.sold - b.sold >= 5 and (g.food_price < b.food_price or g.wood_price < b.wood_price) and s.bought - g.bought >= 3
	_report("market", ok, {"log": log, "market_min": r.market_min, "sold": r.sold, "bought": r.bought})

func _case_determinism() -> void:
	var a := _peace("titan", seed_arg + 1, 22.0)
	var b := _peace("titan", seed_arg + 1, 22.0)
	var ok: bool = JSON.stringify(a) == JSON.stringify(b) and int(a.n) > 0
	_report("determinism", ok, {"n": a.n, "sold": a.sold, "bought": a.bought, "res": a.res, "same": JSON.stringify(a) == JSON.stringify(b)})

func _case_duel() -> void:
	var out := []
	var ok := true
	for pair in [["titan", "moderate"], ["hard", "easy"]]:
		var sim := _sim(seed_arg, pair)
		while sim.get_time() < 45 * 60.0 and not sim.get_victory().decided:
			sim.tick(STEP)
			sim.take_events()
		var v: Dictionary = sim.get_victory()
		var row := {"pair": pair, "decided": v.decided, "winner": int(v.winner) if v.decided else 0, "minutes": snappedf(sim.get_time() / 60.0, 0.1)}
		for o in [1, 2]:
			var tk: Dictionary = sim.get_ai(o).techs
			row["p%d" % o] = {"techs": sim.get_player_techs(o).done.size(), "age": int(sim.get_player(o).age), "sold": int(tk.sold), "bought": int(tk.bought)}
		out.append(row)
		print("AITECHS   duel %s" % JSON.stringify(row))
		# (a Hard / Easy match can end before the Classical Age, or early in it
		# on the age plan, before any tech is due)
		ok = ok and bool(v.decided) and int(v.winner) == 1 and (int(row.p1.techs) > 0 or int(row.p1.age) == 0 or float(row.minutes) < 15.0)
	_report("duel", ok, out)
