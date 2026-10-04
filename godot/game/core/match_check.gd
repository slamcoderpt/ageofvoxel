extends SceneTree
## Match rules check (headless): every option of the skirmish setup screen
## does what it says in the sim (sim/match, sim/core/victory, fog, the enemy
## AI's difficulty) and through main.gd.
##
##   godot --headless --path godot -s res://game/core/match_check.gd [-- --only=teams,vision,victory,maps,difficulty,main]
##         [--seeds=N (difficulty matches per pairing, default 10)] [--minutes=M (cap per match, default 45)] [--quiet=1]
##
## Cases (each prints "MATCH PASS|FAIL <case> <details>"):
##   teams       a 2v2 of AIs for 20 min: no unit or building is ever damaged by
##               its owner or an ally (units, arrows, splash, god powers), no
##               attack order ever targets an ally, and allies did fight enemies
##   vision      the local player sees his ally's town and men (shared fog) but not the enemy's
##   victory     team victory: 2v2 (one enemy down: the match goes on, both: won;
##               the local TC down with the ally standing: goes on; both: lost), FFA of 3
##   maps        2..6 players x every size x the ring presets x seeds: the right
##               number of starts, each with its gold mine, berries and woodline,
##               all connected on foot, evenly spaced (fair)
##   difficulty  AI vs AI (seats swapped every other seed): Hard beats Easy and
##               Titan beats Moderate in most seeds; economy / waves / god powers
##               measurably ordered Easy < Moderate < Hard < Titan (within
##               the noise of the matches played)
##   main        the setup screen's settings through main.gd (AovArgs.override):
##               preset, players, teams, colours, difficulty, resources, speed, visibility
## Ends with "MATCH_RESULT {json}"; exit code = number of failed cases.

const STEP := 15
var fails := 0
var results := {}
var only := []
var quiet := false
var n_seeds := 10
var max_minutes := 45.0
var _main: Node = null
var _main_cfg := {}
var _t0 := 0

func _initialize() -> void:
	_t0 = Time.get_ticks_msec()
	var a := AovArgs.parse()
	if a.has("only"):
		only = str(a.only).split(",")
	quiet = AovArgs.flag(a, "quiet", false)
	n_seeds = int(a.get("seeds", 10))
	max_minutes = float(a.get("minutes", 45))
	if not ClassDB.class_exists("AovSim"):
		printerr("MATCH FAIL AovSim missing (build the extension)")
		quit(1)
		return
	for c in ["maps", "vision", "victory", "teams", "difficulty"]:
		if only.is_empty() or only.has(c):
			call("_case_" + c)
	if only.is_empty() or only.has("main"):
		_start_main()
	else:
		_finish()

func _log(s: String) -> void:
	if not quiet:
		print(s)

func _report(name: String, ok: bool, details: String, data = null) -> void:
	print("MATCH %s %s %s" % ["PASS" if ok else "FAIL", name, details])
	results[name] = {"ok": ok, "details": details, "data": data}
	if not ok:
		fails += 1

func _finish() -> void:
	print("MATCH_RESULT %s" % JSON.stringify({"fails": fails, "wall_s": (Time.get_ticks_msec() - _t0) / 1000.0, "cases": results}))
	quit(fails)

# ---- helpers -------------------------------------------------------------------

## A match-settings-like sim config (AovSim.start_match).
static func cfg(seed: int, size: int, preset: String, players: Array, resources := "standard") -> Dictionary:
	var ps := []
	for i in players.size():
		var p: Dictionary = players[i]
		ps.append({"id": i + 1, "name": p.get("name", "P%d" % (i + 1)), "human": bool(p.get("human", false)),
			"ai": str(p.get("ai", "moderate")), "team": int(p.get("team", 0)), "color": int(p.get("color", -1))})
	return {"seed": seed, "map_size": size, "preset": preset, "resources": resources, "players": ps}

static func new_sim(c: Dictionary) -> Object:
	var sim: Object = ClassDB.instantiate("AovSim")
	sim.set_godot_rules(true)
	var r: Dictionary = sim.start_match(c)
	if not bool(r.ok):
		push_error("start_match: %s" % r.error)
		return null
	sim.set_fog_reveal_all(false)
	sim.fog_recompute()
	return sim

static func tc_of(sim: Object, owner: int) -> Dictionary:
	var b: Dictionary = sim.get_buildings()
	var names: PackedStringArray = b.type_names
	for i in int(b.count):
		if int(b.owner[i]) == owner and names[b.type[i]] == "town_center":
			return {"id": int(b.ids[i]), "x": b.rect[i * 4] + b.rect[i * 4 + 2] * 0.5, "z": b.rect[i * 4 + 1] + b.rect[i * 4 + 3] * 0.5}
	return {}

# ---- teams: no friendly fire ---------------------------------------------------------

func _case_teams() -> void:
	var total_ff := 0
	var ally_orders := 0
	var enemy_dmg := 0
	var info := []
	for seed in [4, 9]:
		var c := cfg(seed, 160, "skirmish", [{"ai": "hard", "team": 1}, {"ai": "hard", "team": 1}, {"ai": "hard", "team": 2}, {"ai": "hard", "team": 2}])
		var sim := new_sim(c)
		if sim == null:
			_report("teams", false, "start_match failed")
			return
		var owners := {}
		for bid in [1, 2, 3, 4]:
			owners[int(tc_of(sim, bid).id)] = bid
		var u: Dictionary = sim.get_units()
		for i in int(u.count):
			owners[int(u.ids[i])] = int(u.owner[i])
		var ff := 0
		var by_kind := {}
		var ticks := int(20 * 60 * 30)
		var t := 0
		while t < ticks:
			sim.tick(STEP)
			t += STEP
			for e in sim.take_events():
				var ty := str(e.type)
				if ty == "entity:added" and int(e.kind) != 3:
					owners[int(e.id)] = int(e.owner)
				elif ty == "unit:damaged":
					var att := int(e.owner)
					var tgt := int(owners.get(int(e.id), -1))
					if att <= 0 or tgt <= 0:
						continue
					if sim.is_ally(att, tgt):
						ff += 1
						var k := "attacker %d -> %d (%s)" % [att, tgt, "unit" if int(e.other) != 0 else "god power / gone"]
						by_kind[k] = int(by_kind.get(k, 0)) + 1
					else:
						enemy_dmg += 1
			if t % 300 == 0:
				# attack orders (auto-targets included) on an ally
				var uu: Dictionary = sim.get_units()
				for i in int(uu.count):
					var o := int(uu.order[i])
					if (o == 6) and not (uu.flags[i] & 2):
						var tg := int(uu.target[i])
						var to := int(owners.get(tg, -1))
						if to > 0 and sim.is_ally(int(uu.owner[i]), to):
							ally_orders += 1
			if sim.get_victory().decided:
				break
		total_ff += ff
		var casts := 0
		for o in [1, 2, 3, 4]:
			for k in sim.get_ai(o).casts:
				casts += int(sim.get_ai(o).casts[k])
		info.append({"seed": seed, "minutes": snappedf(sim.get_time() / 60.0, 0.1), "friendly_hits": ff, "by": by_kind, "casts": casts,
			"decided": sim.get_victory().decided, "winner_team": sim.get_victory().get("winner_team", 0)})
		_log("MATCH   teams seed %d: %s" % [seed, info.back()])
	_report("teams", total_ff == 0 and ally_orders == 0 and enemy_dmg > 200,
		"2v2 Hard AIs, 2 x 20 min: %d friendly hits, %d attack orders on allies, %d hits on enemies" % [total_ff, ally_orders, enemy_dmg], info)

# ---- vision: allies share the fog ----------------------------------------------------

func _case_vision() -> void:
	var c := cfg(3, 160, "skirmish", [{"human": true, "team": 1}, {"ai": "moderate", "team": 2}, {"ai": "moderate", "team": 1}, {"ai": "moderate", "team": 2}])
	var sim := new_sim(c)
	var ok := sim != null
	var det := []
	if ok:
		sim.tick(30)
		sim.fog_recompute()
		var ally: Dictionary = tc_of(sim, 3)
		var foe: Dictionary = tc_of(sim, 2)
		var mine: Dictionary = tc_of(sim, 1)
		var see_ally: bool = sim.is_visible(ally.x, ally.z)
		var see_foe: bool = sim.is_visible(foe.x, foe.z)
		var see_me: bool = sim.is_visible(mine.x, mine.z)
		# the ally's villagers too
		var u: Dictionary = sim.get_units()
		var ally_units := 0
		var ally_seen := 0
		for i in int(u.count):
			if int(u.owner[i]) == 3:
				ally_units += 1
				if sim.is_visible(u.pos[i * 2], u.pos[i * 2 + 1]):
					ally_seen += 1
		# team mates seated side by side: the ally's start is next to ours on the ring
		var st: Array = sim.get_starts()
		var d_ally := Vector2(st[0].tx - st[2].tx, st[0].tz - st[2].tz).length()
		var d_foe := Vector2(st[0].tx - st[1].tx, st[0].tz - st[1].tz).length()
		var d_foe2 := Vector2(st[0].tx - st[3].tx, st[0].tz - st[3].tz).length()
		ok = see_me and see_ally and not see_foe and ally_units > 0 and ally_seen == ally_units and d_ally <= minf(d_foe, d_foe2) + 0.5
		det = ["own TC visible %s" % see_me, "ally TC visible %s" % see_ally, "enemy TC visible %s" % see_foe,
			"ally men seen %d/%d" % [ally_seen, ally_units], "ally start %.0f tiles away, enemies %.0f / %.0f" % [d_ally, d_foe, d_foe2]]
		# and the other way: a 1v1 without teams still hides the enemy
		var s2 := new_sim(cfg(3, 128, "skirmish", [{"human": true}, {"ai": "moderate"}]))
		var f2: Dictionary = tc_of(s2, 2)
		ok = ok and not s2.is_visible(f2.x, f2.z) and not s2.is_ally(1, 2)
	_report("vision", ok, ", ".join(det))

# ---- victory per team ----------------------------------------------------------------

func _kill_tc(sim: Object, owner: int) -> void:
	while true:
		var t: Dictionary = tc_of(sim, owner)
		if t.is_empty():
			return
		sim.destroy_building(t.id)

func _settle(sim: Object) -> Dictionary:
	sim.tick(31)
	return sim.get_victory()

func _case_victory() -> void:
	var det := []
	var ok := true
	var team4 := [{"human": true, "team": 1}, {"ai": "easy", "team": 1}, {"ai": "easy", "team": 2}, {"ai": "easy", "team": 2}]
	# a. both enemies down -> won by team 1
	var sim := new_sim(cfg(5, 128, "skirmish", team4))
	var defeated := []
	var v := _settle(sim)
	ok = ok and not v.decided
	_kill_tc(sim, 3)
	v = _settle(sim)
	for e in sim.take_events():
		if str(e.type) == "player:defeated":
			defeated.append(int(e.owner))
	var a1: bool = not v.decided and defeated == [3]
	_kill_tc(sim, 4)
	v = _settle(sim)
	var a2: bool = v.decided and int(v.winner) == 1 and int(v.winner_team) == sim.get_team(1)
	det.append("2v2 one enemy down: goes on %s (defeated %s); both: won %s (winner %d, team %d)" % [a1, defeated, a2, int(v.winner), int(v.winner_team)])
	ok = ok and a1 and a2
	# b. my TC down, the ally stands -> goes on; the ally falls -> lost
	sim = new_sim(cfg(5, 128, "skirmish", team4))
	_settle(sim)
	_kill_tc(sim, 1)
	v = _settle(sim)
	var b1: bool = not v.decided
	_kill_tc(sim, 2)
	v = _settle(sim)
	var b2: bool = v.decided and int(v.loser) == 1 and sim.is_enemy(1, int(v.winner)) and int(v.winner_team) == sim.get_team(3)
	det.append("2v2 my TC down, ally standing: goes on %s; ally down: lost %s (winner %d)" % [b1, b2, int(v.winner)])
	ok = ok and b1 and b2
	# c. free for all of 3: one AI down -> goes on, both -> won
	sim = new_sim(cfg(5, 128, "skirmish", [{"human": true}, {"ai": "easy"}, {"ai": "easy"}]))
	_settle(sim)
	_kill_tc(sim, 3)
	v = _settle(sim)
	var c1: bool = not v.decided
	_kill_tc(sim, 2)
	v = _settle(sim)
	var c2: bool = v.decided and int(v.winner) == 1
	det.append("FFA 3: one down goes on %s, both down won %s" % [c1, c2])
	ok = ok and c1 and c2
	# d. an AI-only 2v2 plays to a team result (Hard team vs Easy team)
	sim = new_sim(cfg(7, 128, "skirmish", [{"ai": "hard", "team": 1}, {"ai": "hard", "team": 1}, {"ai": "easy", "team": 2}, {"ai": "easy", "team": 2}]))
	var ticks := int(max_minutes * 60 * 30)
	while sim.get_tick() < ticks and not sim.get_victory().decided:
		sim.tick(150)
		sim.take_events()
	v = sim.get_victory()
	var d1: bool = v.decided and int(v.winner_team) == sim.get_team(1)
	det.append("AI 2v2 Hard+Hard vs Easy+Easy: decided %s at %.1f min, winner team %d" % [v.decided, sim.get_time() / 60.0, int(v.get("winner_team", 0))])
	ok = ok and d1
	_report("victory", ok, "; ".join(det))

# ---- maps: 2..6 players, fair starts --------------------------------------------------

func _start_stats(sim: Object) -> Dictionary:
	var starts: Array = sim.get_starts()
	var n: int = sim.get_map_size()
	var res: Dictionary = sim.get_resources()
	var names: PackedStringArray = res.type_names
	var walk: PackedByteArray = sim.get_walkable()
	# the Town Centers block their own tiles: flood over walkable + TC footprints
	var b: Dictionary = sim.get_buildings()
	var open := walk.duplicate()
	for i in int(b.count):
		for z in range(int(b.rect[i * 4 + 1]), int(b.rect[i * 4 + 1] + b.rect[i * 4 + 3])):
			for x in range(int(b.rect[i * 4]), int(b.rect[i * 4] + b.rect[i * 4 + 2])):
				open[z * n + x] = 1
	var seen := PackedByteArray()
	seen.resize(n * n)
	var q := PackedInt32Array([starts[0].tz * n + starts[0].tx])
	seen[q[0]] = 1
	var h := 0
	while h < q.size():
		var i := q[h]
		h += 1
		var x: int = i % n
		var z: int = i / n
		for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
			var nx: int = x + d[0]
			var nz: int = z + d[1]
			if nx < 0 or nz < 0 or nx >= n or nz >= n:
				continue
			var j: int = nz * n + nx
			if seen[j] or not open[j]:
				continue
			seen[j] = 1
			q.push_back(j)
	var per := []
	for s in starts:
		var gold := 0
		var gold_reach := false
		var berries := 0
		var wood := 0
		for i in int(res.count):
			var ty: String = names[res.type[i]]
			var tx: int = res.tile[i * 2]
			var tz: int = res.tile[i * 2 + 1]
			var cx := tx + (1.5 if ty == "gold" else 0.5)
			var cz := tz + (1.5 if ty == "gold" else 0.5)
			var d := Vector2(cx - s.tx, cz - s.tz).length()
			if ty == "gold" and d <= 15.0:
				gold += 1
				for zz in range(tz - 1, tz + 4):
					for xx in range(tx - 1, tx + 4):
						if xx >= 0 and zz >= 0 and xx < n and zz < n and seen[zz * n + xx]:
							gold_reach = true
			elif ty == "berry" and d <= 14.0:
				berries += 1
			elif ty == "tree" and d >= 8.0 and d <= 14.0:
				wood += 1
		per.append({"owner": int(s.owner), "gold": gold, "gold_reach": gold_reach, "berries": berries, "wood": wood,
			"reach": seen[int(s.tz) * n + int(s.tx)] == 1})
	# spacing: nearest other start, distance to the centre
	var near := []
	var centre := []
	for i in starts.size():
		var best := 1e9
		for j in starts.size():
			if i != j:
				best = minf(best, Vector2(starts[i].tx - starts[j].tx, starts[i].tz - starts[j].tz).length())
		near.append(best)
		centre.append(Vector2(starts[i].tx - n / 2.0, starts[i].tz - n / 2.0).length())
	return {"per": per, "near_min": near.min(), "near_max": near.max(), "c_min": centre.min(), "c_max": centre.max()}

func _case_maps() -> void:
	var M: Script = load("res://game/menu/setup/match_settings.gd") if ResourceLoader.exists("res://game/menu/setup/match_settings.gd") else null
	var checked := 0
	var bad := []
	var table := {}
	for n in [2, 3, 4, 5, 6]:
		for preset in ["skirmish", "battle", "stress"]:
			for size in [96, 128, 160, 192, 256]:
				for seed in ([1, 2, 3] if size <= 160 else [1, 2]):
					var ps := []
					for i in n:
						ps.append({"human": i == 0, "ai": "moderate"})
					var sim := new_sim(cfg(seed, size, preset, ps))
					if sim == null:
						bad.append("%s n=%d size=%d seed=%d: start_match refused" % [preset, n, size, seed])
						continue
					checked += 1
					var st := _start_stats(sim)
					var issues := []
					if (st.per as Array).size() != n:
						issues.append("%d starts" % (st.per as Array).size())
					for p in st.per:
						if p.gold < 1 or not p.gold_reach: issues.append("p%d gold %d reach %s" % [p.owner, p.gold, p.gold_reach])
						if p.berries < 5: issues.append("p%d berries %d" % [p.owner, p.berries])
						if p.wood < 16: issues.append("p%d woodline %d" % [p.owner, p.wood])
						if not p.reach: issues.append("p%d cut off" % p.owner)
					if st.near_max > st.near_min * 1.12 + 1.0: issues.append("spacing %.1f..%.1f" % [st.near_min, st.near_max])
					if n > 2 and st.c_max > st.c_min + 1.5: issues.append("ring %.1f..%.1f" % [st.c_min, st.c_max])
					var key := "%s/%d" % [preset, n]
					if not table.has(key):
						table[key] = {"maps": 0, "bad": 0, "near": [], "gold": 0, "berries": 1e9, "wood": 1e9}
					table[key].maps += 1
					table[key].near.append(snappedf(st.near_min, 0.1))
					for p in st.per:
						table[key].berries = mini(int(table[key].berries), int(p.berries))
						table[key].wood = mini(int(table[key].wood), int(p.wood))
					if not issues.is_empty():
						table[key].bad += 1
						bad.append("%s n=%d size=%d seed=%d: %s" % [preset, n, size, seed, ", ".join(issues)])
	for k in table:
		_log("MATCH   maps %s: %d maps, %d unfair, min berries %d, min woodline %d, nearest-start %s" % [k, table[k].maps, table[k].bad, table[k].berries, table[k].wood, table[k].near])
	for b in bad:
		_log("MATCH   maps unfair: %s" % b)
	# the setup screen offers these counts per map
	var offered := ""
	if M != null:
		for n in [2, 3, 4, 5, 6]:
			offered += "%d:%s " % [n, ",".join(M.maps_for(n))]
	_report("maps", bad.is_empty() and checked > 0, "%d maps (2-6 players x 5 sizes x skirmish / battle / stress), %d unfair; offered %s" % [checked, bad.size(), offered], bad)

# ---- difficulty ----------------------------------------------------------------------

func _duel(seed: int, a: String, b: String, swap: bool) -> Dictionary:
	var p1 := {"ai": b if swap else a}
	var p2 := {"ai": a if swap else b}
	var sim := new_sim(cfg(seed, 128, "skirmish", [p1, p2]))
	var ticks := int(max_minutes * 60 * 30)
	var stats := {1: {}, 2: {}}
	while sim.get_tick() < ticks and not sim.get_victory().decided:
		sim.tick(150)
		sim.take_events()
		var tk: int = sim.get_tick()
		if tk == 6 * 60 * 30 or tk == 9 * 60 * 30:
			var u: Dictionary = sim.get_units()
			var names: PackedStringArray = sim.unit_type_names()
			for o in [1, 2]:
				var nv := 0
				var na := 0
				for i in int(u.count):
					if int(u.owner[i]) == o and not (u.flags[i] & 2):
						if names[u.type[i]] == "villager": nv += 1
						else: na += 1
				if tk == 6 * 60 * 30:
					stats[o]["vill6"] = nv
				else:
					stats[o]["army9"] = na
					var pl: Dictionary = sim.get_player(o)
					stats[o]["bank9"] = int(pl.food + pl.wood + pl.gold)
	var v: Dictionary = sim.get_victory()
	for o in [1, 2]:
		var ai: Dictionary = sim.get_ai(o)
		var casts := 0
		for k in ai.casts:
			casts += int(ai.casts[k])
		var w: Array = ai.waves
		stats[o]["first_wave"] = float(w[0].t) if not w.is_empty() else -1.0
		stats[o]["waves"] = w.size()
		var men := 0
		for wv in w:
			men += (wv.units as PackedInt32Array).size()
		stats[o]["wave_men"] = men
		stats[o]["casts"] = casts
		stats[o]["difficulty"] = str(ai.difficulty)
	var a_owner := 2 if swap else 1
	var winner := int(v.winner) if v.decided else 0
	return {"seed": seed, "a": a, "b": b, "a_owner": a_owner, "decided": v.decided, "a_won": winner == a_owner, "b_won": winner != 0 and winner != a_owner,
		"minutes": snappedf(sim.get_time() / 60.0, 0.1), "stats_a": stats[a_owner], "stats_b": stats[3 - a_owner]}

func _case_difficulty() -> void:
	var ok := true
	var det := []
	var agg := {}
	var all := []
	for pair in [["hard", "easy"], ["titan", "moderate"], ["hard", "moderate"], ["moderate", "easy"]]:
		var wins := 0
		var losses := 0
		var n := n_seeds if pair[1] != "easy" or pair[0] == "hard" else maxi(2, n_seeds / 2)
		for k in n:
			var r := _duel(k + 1, pair[0], pair[1], k % 2 == 1)
			all.append(r)
			wins += int(r.a_won)
			losses += int(r.b_won)
			for side in [["a", pair[0]], ["b", pair[1]]]:
				var s: Dictionary = r["stats_" + side[0]]
				if not agg.has(side[1]):
					agg[side[1]] = {"n": 0, "vill6": 0.0, "army9": 0.0, "first_wave": 0.0, "wave_men_per_min": 0.0, "casts_per_min": 0.0}
				var g: Dictionary = agg[side[1]]
				g.n += 1
				for key in ["vill6", "army9", "first_wave"]:
					g[key] += float(s.get(key, 0))
				g.casts_per_min += float(s.casts) / maxf(1.0, r.minutes)
				g.wave_men_per_min += float(s.wave_men) / maxf(1.0, r.minutes)
			_log("MATCH   duel seed %d %s (p%d) vs %s: %s in %.1f min  a=%s  b=%s" % [r.seed, pair[0], r.a_owner, pair[1],
				"A WINS" if r.a_won else ("B WINS" if r.b_won else "undecided"), r.minutes, r.stats_a, r.stats_b])
		var need := int(ceil(n * 0.66))
		var pair_ok := wins >= need and wins > losses
		det.append("%s beat %s %d/%d (lost %d)" % [pair[0], pair[1], wins, n, losses])
		ok = ok and pair_ok
	# economy speed, measured in peace (the opponent idle, no waves): villagers
	# at 6 min, population and resources banked + spent proxy at 9 min
	var econ := {}
	for d in ["easy", "moderate", "hard", "titan"]:
		var ev := 0.0
		var ep := 0.0
		for seed in [1, 2, 3]:
			var sim := new_sim(cfg(seed, 128, "skirmish", [{"ai": d}, {"ai": "easy"}]))
			sim.set_ai(2, {"enabled": false})
			sim.set_ai(1, {"next_wave_at": 1e9})
			sim.tick(6 * 60 * 30)
			var u: Dictionary = sim.get_units()
			var names: PackedStringArray = sim.unit_type_names()
			for i in int(u.count):
				if int(u.owner[i]) == 1 and names[u.type[i]] == "villager" and not (u.flags[i] & 2):
					ev += 1
			sim.tick(3 * 60 * 30)
			ep += float(sim.get_player(1).pop)
		econ[d] = {"peace_vill6": ev / 3.0, "peace_pop9": ep / 3.0}
	# measurable ordering of the averages
	var avg := {}
	for d in agg:
		var g: Dictionary = agg[d]
		avg[d] = {}
		for key in ["vill6", "army9", "first_wave", "wave_men_per_min", "casts_per_min"]:
			avg[d][key] = snappedf(g[key] / g.n, 0.01)
		avg[d].merge(econ.get(d, {}))
	var order := ["easy", "moderate", "hard", "titan"]
	var mono := true
	for i in 3:
		var lo: Dictionary = avg.get(order[i], {})
		var hi: Dictionary = avg.get(order[i + 1], {})
		if lo.is_empty() or hi.is_empty():
			continue
		# economy (in peace: villagers at 6 min, population at 9), waves (men sent per minute), god powers (casts per minute);
		# within the noise of the matches (a harder AI pays for its next age sooner on its age plan, 400 food
		# that is not men at 9 min; Moderate and Hard decide on god powers at the same pace)
		if not (hi.peace_vill6 >= lo.peace_vill6 - 0.5 and hi.peace_pop9 >= lo.peace_pop9 - 3.0 and hi.wave_men_per_min >= lo.wave_men_per_min * 0.9 and hi.casts_per_min >= lo.casts_per_min * 0.75):
			mono = false
	det.append("averages %s" % JSON.stringify(avg))
	ok = ok and mono
	_report("difficulty", ok, "; ".join(det), all)

# ---- main.gd: the setup screen's settings reach the match -------------------------------

func _start_main() -> void:
	var M: Script = load("res://game/menu/setup/match_settings.gd")
	var s: Dictionary = M.defaults(4)
	s.map = "aegean_hills"
	s.seed = 11
	s.map_size = 160
	s.resources = "high"
	s.speed = 1.5
	s.visibility = "standard"
	s.players[1].team = 1
	s.players[1].ai = "titan"
	s.players[1].color = 7
	s.players[2].team = 2
	s.players[2].ai = "easy"
	s.players[3].team = 2
	s.players[3].ai = "hard"
	_main_cfg = s
	AovArgs.override = M.to_args(s)
	_main = load("res://game/main.tscn").instantiate()
	root.add_child(_main)
	process_frame.connect(_check_main, CONNECT_ONE_SHOT)

func _check_main() -> void:
	await process_frame
	await process_frame
	var sim: Object = _main.sim
	var det := []
	var ok: bool = sim != null and _main.errors.is_empty()
	if ok:
		var ids: PackedInt32Array = sim.get_player_ids()
		var p2: Dictionary = sim.get_player(2)
		var p3: Dictionary = sim.get_player(3)
		var M: Script = load("res://game/menu/setup/match_settings.gd")
		var c7: int = M.COLORS[7]
		ok = ids.size() == 5 and sim.get_map_size() == 160 and sim.get_seed() == 11 \
			and sim.is_ally(1, 2) and sim.is_ally(3, 4) and sim.is_enemy(1, 3) and not sim.is_ally(2, 4) \
			and str(sim.get_ai(2).difficulty) == "titan" and str(sim.get_ai(3).difficulty) == "easy" and str(sim.get_ai(4).difficulty) == "hard" \
			and float(sim.get_player(1).food) == 1000.0 and float(p3.gather_mult) == 1.0 and absf(float(p2.gather_mult) - 1.2) < 1e-9 \
			and int(p2.color) == c7 and absf(float(_main.time_scale) - 1.5) < 0.001 \
			and bool(sim.get_victory().enabled) and not bool(_main.paused) and sim.get_starts().size() == 4 \
			and not sim.is_visible(tc_of(sim, 3).x, tc_of(sim, 3).z) and sim.is_visible(tc_of(sim, 2).x, tc_of(sim, 2).z)
		det = ["players %s" % ids, "teams %d %d %d %d" % [sim.get_team(1), sim.get_team(2), sim.get_team(3), sim.get_team(4)],
			"ai %s %s %s" % [sim.get_ai(2).difficulty, sim.get_ai(3).difficulty, sim.get_ai(4).difficulty],
			"food %d, titan gather x%.2f" % [int(sim.get_player(1).food), float(p2.gather_mult)], "speed %.2f" % _main.time_scale,
			"colour p2 %06x" % int(p2.color), "map %d seed %d" % [sim.get_map_size(), sim.get_seed()]]
		# the HUD's score list is grouped by team with team headers
		var ui: Node = _main.pieces.get("ui")
		if ui != null:
			ui._refresh_stats()
			var rows: Array = ui.hud_state.get("scores", [])
			var labels := []
			var order := []
			for r in rows:
				order.append(int(r.id))
				if r.has("team_label"):
					labels.append(str(r.team_label))
			det.append("score rows %s headers %s" % [order, labels])
			ok = ok and order == [1, 2, 3, 4] and labels == ["Team 1", "Team 2"]
	AovArgs.override = {}
	_report("main", ok, ", ".join(det))
	_main.queue_free()
	_finish()
