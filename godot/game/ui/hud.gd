extends Control
## The HUD's drawn layers (port of src/ui/index.js + CommandPanel.js markup
## and hud.css). Two instances: "back" draws everything that sits on the
## shader panels (resource strip, age medallion and god-power slots, menu
## buttons, clock and scores, control groups, the command grid, the
## selection card, the minimap's bronze diamond frame); "front" draws what
## sits over the minimap (inner shade, gems, the button ring and badges),
## the event feed, the tooltip, messages and the match result card. Both
## register hit zones while drawing, so clicks and tooltips use exactly the
## drawn rects. Redrawn only when the UI's state signature changes.
##
## All coordinates are CSS px of the browser layout (1920x1080); the parent
## CanvasLayer scales them to the window.

const S := preload("res://game/ui/hud_style.gd")
const TechIcons := preload("res://game/ui/tech_icons.gd")

var ui: Node = null
var layer := "back"
var zones: Array = []   # [{rect: Rect2, id: String, arg, tip: Dictionary}]

# ---- layout (CSS px) ------------------------------------------------------------

func W() -> float: return size.x
func H() -> float: return size.y

## The top-centre resource strip (.resrow): 4 cells of 150 + pop 136, padding 22.
func resrow_rect() -> Rect2:
	var w := 22.0 * 2 + 150.0 * 4 + 136.0 + 6.0
	return Rect2(round((W() - w) * 0.5), 0, w, 44)

## The age hub (.agehub): plate l (176) + medal (84) + plate r (176), overlapped by 46.
func hub_x() -> float: return round(W() * 0.5 - 172.0)
func plate_l_rect() -> Rect2: return Rect2(hub_x(), 42, 176, 58)
func plate_r_rect() -> Rect2: return Rect2(hub_x() + 168, 42, 176, 58)
func medal_center() -> Vector2: return Vector2(W() * 0.5, 42 + 2 + 42)
func menubar_rect() -> Rect2: return Rect2(W() - 197, 0, 197, 50)
func commands_rect() -> Rect2: return Rect2(0, H() - 206, 315, 206)
func info_rect() -> Rect2: return Rect2(312, H() - 206, 430, 206)
func mm_origin() -> Vector2: return Vector2(W() - 364, H() - 330)
func tray_rect() -> Rect2: return Rect2(W() - 364, H() - 150, 364, 150)
func dia_center() -> Vector2: return mm_origin() + Vector2(182, 83 + 95)

## The shader panels (the parent UI creates one ColorRect per entry).
func panel_specs() -> Array:
	var teal_v := {"bg_mode": 0, "bg0": Color("#123a46"), "bg1": Color("#0a242c"), "bg2": Color("#06171d"), "bg_mid": 0.55}
	var panel := {"bg_mode": 1, "bg0": Color(22 / 255.0, 70 / 255.0, 82 / 255.0, 0.97), "bg1": Color(11 / 255.0, 40 / 255.0, 48 / 255.0, 0.97),
		"bg2": Color(5 / 255.0, 22 / 255.0, 28 / 255.0, 0.98), "bg_mid": 0.48, "radial_center": Vector2(0.5, 0.0), "radial_radius": Vector2(1.3, 1.0)}
	var plate := {"bg_mode": 0, "bg0": Color("#0e303a"), "bg1": Color("#0b2530"), "bg2": Color("#07191f"), "bg_mid": 0.5}
	return [
		{"name": "plate_l", "rect": plate_l_rect(), "chamfer": Vector4(0, 0, 0, 18), "border": Vector4(0, 3, 3, 3), "style": plate, "shadow": Vector3(4, 10, 0.5)},
		{"name": "plate_r", "rect": plate_r_rect(), "chamfer": Vector4(0, 0, 18, 0), "border": Vector4(0, 3, 3, 3), "style": plate, "shadow": Vector3(4, 10, 0.5)},
		{"name": "resrow", "rect": resrow_rect(), "chamfer": Vector4(0, 0, 14, 14), "border": Vector4(0, 3, 3, 3), "style": teal_v, "shadow": Vector3(3, 10, 0.45)},
		{"name": "menubar", "rect": menubar_rect(), "chamfer": Vector4(0, 0, 0, 16), "border": Vector4(0, 0, 3, 3),
			"style": {"bg_mode": 0, "bg0": Color("#123a46"), "bg1": Color("#0c2a33"), "bg2": Color("#06171d"), "bg_mid": 0.5}, "shadow": Vector3(3, 10, 0.45)},
		{"name": "commands", "rect": commands_rect(), "chamfer": Vector4.ZERO, "border": Vector4(3, 3, 0, 0), "style": panel, "shadow": Vector3(6, 18, 0.5)},
		{"name": "info", "rect": info_rect(), "chamfer": Vector4.ZERO, "border": Vector4(3, 3, 0, 0), "style": panel, "shadow": Vector3(6, 18, 0.5)},
		{"name": "tray", "rect": tray_rect(), "chamfer": Vector4(26, 26, 0, 0), "border": Vector4.ZERO, "frame": 0.0,
			"style": {"bg_mode": 1, "bg0": Color(22 / 255.0, 70 / 255.0, 82 / 255.0, 0.97), "bg1": Color(12 / 255.0, 44 / 255.0, 54 / 255.0, 0.975),
			"bg2": Color(5 / 255.0, 22 / 255.0, 28 / 255.0, 0.98), "bg_mid": 0.5, "radial_center": Vector2(0.5, 0.0), "radial_radius": Vector2(1.2, 1.2)},
			"shadow": Vector3(0, 16, 0.45)},
	]

# ---- zones / input -----------------------------------------------------------------

func zone(r: Rect2, id: String, arg = null, tip := {}) -> void:
	zones.append({"rect": r, "id": id, "arg": arg, "tip": tip})

func zone_at(p: Vector2) -> Dictionary:
	for i in range(zones.size() - 1, -1, -1):
		if zones[i].rect.has_point(p):
			if zones[i].id == "minimap":
				# the map is a rotated square: test in its own frame
				var l := (p - dia_center()).rotated(-ui.minimap_rotation())
				if absf(l.x) > 95.0 or absf(l.y) > 95.0:
					continue
			return zones[i]
	return {}

## Mouse picking: only the drawn HUD (zones and panels) blocks the world.
func _has_point(p: Vector2) -> bool:
	if ui == null or not ui.hud_visible:
		return false
	if not zone_at(p).is_empty():
		return true
	if layer != "front":
		return false
	if ui.result_shown:
		return true
	for r in ui.blocking_rects():
		if r.has_point(p):
			return true
	return false

func _gui_input(e: InputEvent) -> void:
	if ui:
		ui.hud_input(self, e)

# ---- drawing -------------------------------------------------------------------

func _draw() -> void:
	zones.clear()
	if ui == null or not ui.hud_visible:
		if layer == "front":
			_draw_message()
			_draw_result()
		return
	if layer == "back":
		_draw_resrow()
		_draw_hub()
		_draw_topright()
		_draw_groups()
		_draw_commands()
		_draw_info()
		_draw_tray()
	else:
		_draw_minimap_front()
		_draw_feed()
		_draw_message()
		_draw_result()
		_draw_tooltip()

# resource strip ------------------------------------------------------------------

func _draw_resrow() -> void:
	var r := resrow_rect()
	var st: Dictionary = ui.hud_state
	var bold := S.font("bold")
	S.stud(self, Vector2(r.position.x + 13.5, r.position.y + 20.5), 4.5)
	S.stud(self, Vector2(r.end.x - 13.5, r.position.y + 20.5), 4.5)
	var x := r.position.x + 3 + 22
	var cy := 3.0 + 17.0
	var keys := ["food", "wood", "gold", "favor"]
	var tips := {
		"food": {"title": "Food", "lines": ["Gathered from berries, hunting, fishing and farms"]},
		"wood": {"title": "Wood", "lines": ["Chopped from trees"]},
		"gold": {"title": "Gold", "lines": ["Mined from gold mines"]},
		"favor": {"title": "Favor", "lines": ["Earned by villagers worshipping at a temple", "Spent on god powers and myth units"]},
	}
	for i in 5:
		var cw := 150.0 if i < 4 else 136.0
		var cell := Rect2(x, 3, cw, 34)
		if i > 0:  # bronze divider
			S.vgrad(self, Rect2(x, 7, 2, 26), [[0.0, Color(S.BRONZE_HI, 0)], [0.3, S.BRONZE_HI], [0.7, S.BRONZE], [1.0, Color(S.BRONZE, 0)]])
			draw_rect(Rect2(x + 2, 7, 1, 26), Color(S.DARK, 0.8))
		var ix := x + 6
		if i < 4:
			var k: String = keys[i]
			var nb := Rect2(ix, cy - 11, 24, 22)
			var ns := str(st.get("n_" + k, 0))
			nb.size.x = maxf(24.0, S.text_width(bold, ns, 13) + 8)
			S.vgrad(self, nb, [[0.0, Color("#07161b")], [1.0, Color("#0e2c35")]])
			draw_rect(nb, S.BRONZE, false, 1.0)
			draw_rect(nb.grow(-1), Color(0, 0, 0, 0.5), false, 1.0)
			S.text(self, bold, Vector2(nb.position.x, cy + 4.5), ns, 13, Color("#e9f0ec"), HORIZONTAL_ALIGNMENT_CENTER, nb.size.x, 0.6)
			ix = nb.end.x + 7
			S.draw_icon(self, k, Rect2(ix, cy - 13.5, 27, 27))
			ix += 27 + 7
			S.text(self, bold, Vector2(ix, cy + 7), str(int(st.get(k, 0))), 20, Color("#fbf3de"))
			var tip: Dictionary = tips[k].duplicate()
			if k == "favor" and st.has("favor_lines"):
				tip["lines"] = st.favor_lines   # an Egyptian: the Monuments' favor
			else:
				tip["lines"] = tip.lines + ["%d %s %s" % [int(st.get("n_" + k, 0)), str(st.get("worker_word", "villagers")).to_lower(), "worshipping" if k == "favor" else "gathering"]]
			zone(cell, "res", k, tip)
		else:
			S.draw_icon(self, "house", Rect2(ix, cy - 13.5, 27, 27))
			ix += 27 + 7
			var warn: bool = int(st.get("pop", 0)) >= int(st.get("pop_cap", 0))
			S.text(self, bold, Vector2(ix, cy + 7), "%d/%d" % [int(st.get("pop", 0)), int(st.get("pop_cap", 0))], 20,
				Color("#ff8a70") if warn else Color("#fff3d0"))
			zone(cell, "res", "pop", {"title": "Population", "lines": ["Houses and Town Centers raise the cap"]})
		x += cw

# age medallion + god powers ------------------------------------------------------

func _draw_hub() -> void:
	var st: Dictionary = ui.hud_state
	var powers: Array = ui.powers
	var slots := maxi(4, powers.size() + (powers.size() % 2))
	var lx := plate_l_rect().position.x + 3 + 16
	var rx := plate_r_rect().position.x + 3 + 54
	var y := 46.5
	for i in slots:
		var half := slots / 2
		var px: float = (lx + i * 54) if i < half else (rx + (i - half) * 54)
		var r := Rect2(px, y, 46, 46)
		if i < powers.size():
			_draw_power(r, powers[i])
		else:
			S.cell(self, r, [[0.0, Color("#12323c")], [0.85, Color("#06161b")], [1.0, Color("#06161b")]], Vector2(0.5, 0.4))
			var c := r.get_center()
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, -7), c + Vector2(7, 0), c + Vector2(0, 7), c + Vector2(-7, 0)]), Color(216 / 255.0, 180 / 255.0, 108 / 255.0, 0.28))
	_draw_medal(st)

func _draw_power(r: Rect2, p: Dictionary) -> void:
	var active: bool = p.active
	S.cell(self, r, [[0.0, Color("#4c77b0")], [0.82, Color("#152847")], [1.0, Color("#152847")]], Vector2(0.5, 0.38))
	var ok: bool = p.can
	var ir := Rect2(r.get_center() - Vector2(17, 17), Vector2(34, 34))
	if ok:
		var g := S.icon_glow(p.icon, 34, 4)
		if g:
			var gs := Vector2(g.get_width(), g.get_height())
			draw_texture_rect(g, Rect2(r.get_center() - gs * 0.5, gs), false, Color(170 / 255.0, 215 / 255.0, 1.0, 0.75))
		S.draw_icon(self, p.icon, ir, false)
	else:
		S.draw_icon(self, p.icon, ir, false, Color(0.42, 0.44, 0.48, 1.0))
	var cd: float = p.cd
	if cd > 0.0:  # conic cooldown shade
		var c := r.get_center()
		var pts := PackedVector2Array([c])
		var n := 32
		for k in n + 1:
			var a := -PI * 0.5 + TAU * cd * float(k) / float(n)
			var d := Vector2(cos(a), sin(a))
			var t := 23.0 / maxf(absf(d.x), absf(d.y))
			pts.push_back(c + d * t)
		draw_colored_polygon(pts, Color(0, 0, 0, 0.7))
		S.text(self, S.font("bold"), Vector2(r.position.x, r.position.y + 29), str(int(ceil(p.cd_left))), 15, Color("#f3ead6"), HORIZONTAL_ALIGNMENT_CENTER, r.size.x)
	if active:
		draw_rect(r.grow(-2), S.GOLD_HI, false, 1.0)
		for k in 3:
			draw_rect(r.grow(1.0 + k * 2.0), Color(0.62, 0.82, 1.0, 0.35 - k * 0.1), false, 2.0)
	var def: Dictionary = p.def
	zone(r, "power", p.key, {"title": def.get("name", ""), "sub": "(%s)" % def.get("god", ""), "lines": [def.get("desc", "")],
		"cost": {"favor": p.get("cost", def.get("favor", 0))}, "hotkey": str(def.get("hotkey", "")), "warn": "" if ok else p.reason})

func _conic_ring(c: Vector2, r0: float, r1: float, stops: Array, a0 := 0.0, a1 := TAU, n := 72) -> void:
	for k in n:
		var t0 := float(k) / float(n)
		var t1 := float(k + 1) / float(n)
		var aa := a0 + (a1 - a0) * t0
		var ab := a0 + (a1 - a0) * t1
		var ca := S.sample(stops, t0)
		var cb := S.sample(stops, t1)
		var da := Vector2(sin(aa), -cos(aa))
		var db := Vector2(sin(ab), -cos(ab))
		draw_polygon(PackedVector2Array([c + da * r0, c + da * r1, c + db * r1, c + db * r0]), PackedColorArray([ca, ca, cb, cb]))

func _draw_medal(st: Dictionary) -> void:
	var c := medal_center()
	# drop shadow + dark outline
	for k in 5:
		draw_circle(c + Vector2(0, 5), 44.0 + k * 1.6, Color(0, 0, 0, 0.1), true, -1.0, true)
	draw_circle(c, 44.0, S.DARK, true, -1.0, true)
	# cast gold rim: conic gradient (two light / dark cycles)
	var rim := [[0.0, Color("#f7df9c")], [0.125, Color("#9c7434")], [0.25, Color("#f0cf82")], [0.375, Color("#7a5826")], [0.5, Color("#f7df9c")],
		[0.625, Color("#9c7434")], [0.75, Color("#f0cf82")], [0.875, Color("#7a5826")], [1.0, Color("#f7df9c")]]
	_conic_ring(c, 35.0, 42.0, rim)
	draw_arc(c, 41.5, 0, TAU, 72, Color(1, 0.95, 0.8, 0.35), 1.0, true)
	draw_arc(c, 42.3, 0, TAU, 72, S.DARK, 1.2, true)
	# advance progress ring (.medal .ring)
	var adv: float = st.get("adv", 0.0)
	if adv > 0.0:
		_conic_ring(c, 42.5, 47.0, [[0.0, Color("#9dffb5")], [1.0, Color("#9dffb5")]], 0.0, TAU * adv, 64)
	# the green face
	draw_circle(c, 35.0, S.DARK, true, -1.0, true)
	var face := [[0.0, Color("#6fd08a")], [0.38, Color("#27884a")], [0.72, Color("#0f4a28")], [1.0, Color("#062414")]]
	S.disc(self, c, 34.0, S.radial_tex(face, Vector2(0.5, 0.32), 0.68, 96))
	draw_arc(c, 32.5, 0, TAU, 64, Color(190 / 255.0, 1.0, 200 / 255.0, 0.25), 3.0, true)
	draw_arc(c, 30.0, PI * 0.15, PI * 0.85, 32, Color(0, 0, 0, 0.3), 7.0, true)
	draw_arc(c, 31.0, PI * 1.2, PI * 1.8, 32, Color(1, 1, 1, 0.14), 4.0, true)
	# the numeral
	var roman: String = st.get("roman", "I")
	var f := S.font("black")
	var tw := S.text_width(f, roman, 34, -1.0)
	var pos := Vector2(c.x - tw * 0.5, c.y + 15)
	for k in 6:
		draw_string(f, pos + Vector2(0, 2) * float(k > 2), roman, HORIZONTAL_ALIGNMENT_LEFT, -1, 34, Color(0.7, 1.0, 0.75, 0.10))
	draw_string_outline(f, pos + Vector2(0, 2), roman, HORIZONTAL_ALIGNMENT_LEFT, -1, 34, 3, Color("#0a2a14"))
	draw_string_outline(f, pos, roman, HORIZONTAL_ALIGNMENT_LEFT, -1, 34, 2, Color("#3d2a10"))
	draw_string(f, pos, roman, HORIZONTAL_ALIGNMENT_LEFT, -1, 34, Color("#f6f1d2"))
	var p: Dictionary = ui.player
	var lines := ["Worshipping %s" % p.get("god", "Zeus")]
	for mg in st.get("minor_gods", []):
		lines.append("· %s" % str(mg))
	if st.get("next_age", "") != "":
		lines.append("Advance at the Town Center (A)")
	zone(Rect2(c - Vector2(42, 42), Vector2(84, 84)), "medal", null, {"title": "%s Age" % p.get("age_name", "Archaic"), "lines": lines})

# top right --------------------------------------------------------------------------

## "Z storm  ·  C bolt  ·  V meteor" (god power hotkeys, from the power defs)
func _power_keys_line() -> String:
	var parts := []
	for p in ui.powers:
		var k := str(p.def.get("hotkey", ""))
		if k != "":
			parts.append("%s %s" % [k, str(p.def.get("name", p.key)).split(" ")[-1].to_lower()])
	return "  ·  ".join(parts) + " (god powers)"

func _draw_topright() -> void:
	var r := menubar_rect()
	var bx := r.position.x + 3 + 22 + 4
	var btns := [
		["speed", "fast", {"title": "Game Speed", "lines": ["Toggle normal / fast"]}],
		["pause", "play" if ui.user_paused else "pause", {"title": "Pause", "lines": ["Pause or resume the game"]}],
		["obj", "scroll", {"title": "Objectives", "lines": ["Destroy the enemy Town Center"]}],
		["menu", "gear", {"title": "Hotkeys", "lines": [". idle villager  ·  H Town Center", "Ctrl+1..9 assign group  ·  1..9 recall", "Q/E/F/S/R/B build  ·  X stop",
			"A attack-move (army)  ·  A age (Town Center)", _power_keys_line()]}],
	]
	for i in btns.size():
		var c := Vector2(bx + 15 + i * 42, 4 + 4 + 15)
		var id: String = btns[i][0]
		var on: bool = (id == "speed" and ui.time_scale_fast()) or (id == "menu" and ui.menu_open)
		S.round_button(self, c, 15, ui.hover_id == "mb:" + id, on)
		S.draw_icon(self, btns[i][1], Rect2(c - Vector2(9, 9), Vector2(18, 18)), true)
		zone(Rect2(c - Vector2(19, 19), Vector2(38, 38)), "mb:" + id, null, btns[i][2])
	var st: Dictionary = ui.hud_state
	var bold := S.font("bold")
	var sans := S.font("sans")
	# clock: "00:30 (Archaic Age)" on a dark fade
	var clock: String = st.get("clock", "00:00")
	var age := "(%s Age)" % ui.player.get("age_name", "Archaic")
	var w1 := S.text_width(bold, clock, 16)
	var w2 := S.text_width(sans, age, 16)
	var cw := 18.0 + w1 + 5.0 + w2 + 12.0
	var cr := Rect2(W() - cw, 55, cw, 26)
	S.hgrad(self, cr, [[0.0, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.0)], [22.0 / cw, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.78)], [1.0, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.78)]])
	S.text(self, bold, Vector2(cr.position.x + 18, 74), clock, 16, S.INK)
	S.text(self, sans, Vector2(cr.position.x + 18 + w1 + 5, 74), age, 16, S.MUTED)
	# scores
	if ui.scores_visible:
		var rows: Array = st.get("scores", [])
		var y := 85.0
		var widths := []
		var maxw := 0.0
		for row in rows:
			var wn := S.text_width(bold, row.name, 15) + 4 + S.text_width(sans, "(%s):" % row.god, 15)
			widths.append(wn)
			maxw = maxf(maxw, wn)
		var total := 24.0 + maxw + 6 + 19 + 6 + 22 + 6 + 42 + 12
		var n_labels := 0
		for row in rows:
			if row.has("team_label"):
				n_labels += 1
		var sr := Rect2(W() - total, y, total, 9 + rows.size() * 23.0 + n_labels * 19.0 - 4.0 + 5)
		S.hgrad(self, sr, [[0.0, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.0)], [26.0 / total, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.72)], [1.0, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.72)]])
		var ry := y + 4
		for i in rows.size():
			var row: Dictionary = rows[i]
			if row.has("team_label"):
				# a team header (match rules): "Team 1 ........ 1234"
				S.text(self, S.font("title"), Vector2(W() - total + 26, ry + 13), str(row.team_label).to_upper(), 12, S.GOLD)
				S.text(self, sans, Vector2(W() - 12 - 42, ry + 13), str(row.team_score), 13, S.MUTED)
				ry += 19
			var x1 := W() - 12 - 42 - 6 - 22 - 6 - 19 - 6
			var nx: float = x1 - widths[i]
			S.text(self, bold, Vector2(nx, ry + 15), row.name, 15, S.INK)
			S.text(self, sans, Vector2(nx + S.text_width(bold, row.name, 15) + 4, ry + 15), "(%s):" % row.god, 15, S.MUTED)
			S.player_tag(self, Rect2(x1 + 6, ry + 1, 19, 19), row.color, row.id)
			S.text(self, S.font("title"), Vector2(x1 + 6 + 19 + 6, ry + 15), row.age, 14, Color("#f6eedb"), HORIZONTAL_ALIGNMENT_CENTER, 22)
			S.text(self, bold, Vector2(W() - 12 - 42, ry + 15), str(row.score), 15, S.INK)
			ry += 23

# control groups ------------------------------------------------------------------------

func _draw_groups() -> void:
	var gs: Array = ui.hud_state.get("groups", [])
	var x := 6.0
	var bold := S.font("bold")
	for g in gs:
		var r := Rect2(x, 6, 50, 64)
		S.drop_shadow(self, r, 3, 8, 0.4)
		S.cell(self, r, [[0.0, Color("#2c5f72")], [0.85, Color("#0a222a")], [1.0, Color("#0a222a")]], Vector2(0.5, 0.35))
		var tex: Texture2D = g.tex
		if tex:
			# 64x64 image at (-9, -10), clipped to the card
			_clip_tex(tex, Rect2(r.position + Vector2(-9, -10), Vector2(64, 64)), r.grow(-2))
		var kr := Rect2(r.position.x + 2, r.end.y - 2 - 17, 46, 17)
		S.vgrad(self, kr, [[0.0, Color("#0e2f39")], [1.0, Color("#051419")]])
		draw_line(kr.position, Vector2(kr.end.x, kr.position.y), S.BRONZE, 1.0)
		S.text(self, bold, Vector2(kr.position.x, kr.end.y - 3), g.key, 14, S.INK, HORIZONTAL_ALIGNMENT_CENTER, kr.size.x)
		var cp := Vector2(r.position.x + 5, r.position.y + 17)
		draw_string_outline(bold, cp, str(g.count), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, 5, Color(0, 0, 0, 0.55))
		draw_string_outline(bold, cp + Vector2(0, 1), str(g.count), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, 2, Color(0, 0, 0, 0.9))
		draw_string(bold, cp, str(g.count), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, S.INK)
		zone(r, "group", g.key, {"title": "Group %s" % g.key, "lines": ["%d × %s" % [g.count, g.name], "Press %s to select, twice to centre" % g.key]})
		x += 55

static var _grey := {}   # portrait texture RID -> its locked (greyscale, darkened) copy
static var _grey_seen := {}   # portrait texture RID -> the frame it was first asked for

## The "locked" copy of a portrait (a unit / building ViewportTexture): every
## pixel's luminance in the tech tiles' locked grey (TechIcons.bake: l * 0.56
## .. 0.64, a cold slate), alpha kept, so a locked train / build button has no
## colour left, as a locked tech tile. Read back once per portrait and cached;
## null while the portrait's viewport has not rendered yet (then retried).
static func locked_portrait(tex: Texture2D) -> Texture2D:
	return _portrait_variant(tex, "locked")

## The "busy" copy of a portrait (a unit training): TechIcons.busy_image's
## cold blue duotone, as a tech tile being researched; cached as above.
static func busy_portrait(tex: Texture2D) -> Texture2D:
	return _portrait_variant(tex, "busy")

static func _portrait_variant(tex: Texture2D, mode: String) -> Texture2D:
	if tex == null:
		return null
	var key := "%s:%s" % [tex.get_rid().get_id(), mode]
	if _grey.has(key):
		return _grey[key]
	# a portrait's viewport renders once, some frames after it is made: read it
	# back only after it has been asked for over a few drawn frames
	var f := Engine.get_frames_drawn()
	if not _grey_seen.has(key):
		_grey_seen[key] = f
	if f - int(_grey_seen[key]) < 1:
		return null
	var img := tex.get_image()
	if img == null or img.is_empty():
		return null
	img = img.duplicate()
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	var d := img.get_data()
	var solid := 0
	for i in range(3, d.size(), 4):
		if d[i] > 200:
			solid += 1
	if solid * 50 < d.size() / 4:
		return null  # not rendered yet (under 2% of it opaque)
	if mode == "busy":
		TechIcons.busy_image(img)
	else:
		for i in range(0, d.size(), 4):
			if d[i + 3] == 0:
				continue
			var l := (d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255.0
			d[i] = int(clampf(l * 0.6 + 0.03, 0.0, 1.0) * 255.0)
			d[i + 1] = int(clampf(l * 0.62 + 0.035, 0.0, 1.0) * 255.0)
			d[i + 2] = int(clampf(l * 0.68 + 0.045, 0.0, 1.0) * 255.0)
		img.set_data(img.get_width(), img.get_height(), false, Image.FORMAT_RGBA8, d)
	var out := ImageTexture.create_from_image(img)
	_grey[key] = out
	return out

## Draw `tex` into `dst`, clipped to `clip` (overflow: hidden).
func _clip_tex(tex: Texture2D, dst: Rect2, clip: Rect2, mod := Color.WHITE) -> void:
	var inter := dst.intersection(clip)
	if inter.size.x <= 0 or inter.size.y <= 0:
		return
	var ts := Vector2(tex.get_width(), tex.get_height())
	var src := Rect2((inter.position - dst.position) / dst.size * ts, inter.size / dst.size * ts)
	draw_texture_rect_region(tex, inter, src, mod)

# command grid ------------------------------------------------------------------------------

func _draw_commands() -> void:
	var r := commands_rect()
	S.boss(self, Vector2(r.end.x + 2, r.position.y - 2), 7)
	var cmds: Array = ui.commands
	var bold := S.font("bold")
	for i in 15:
		var col := i % 5
		var row := i / 5
		var cr := Rect2(10 + col * 59, r.position.y + 3 + 14 + row * 59, 54, 54)
		var c = cmds[i] if i < cmds.size() else null
		if c == null:
			S.vgrad(self, cr, [[0.0, Color(3 / 255.0, 14 / 255.0, 18 / 255.0, 0.55)], [1.0, Color(14 / 255.0, 44 / 255.0, 52 / 255.0, 0.45)]])
			S.inset_shadow(self, cr, 8, 0.55)
			draw_rect(cr, Color(216 / 255.0, 180 / 255.0, 108 / 255.0, 0.16), false, 1.0)
			continue
		var hover: bool = ui.hover_id == "cmd:%d" % i
		var pressed: bool = hover and ui.mouse_down
		var rr := cr
		if pressed:
			rr = cr.grow(-1)
		var en: bool = c.enabled
		var st := str(c.get("state", ""))
		if st == "locked" and not c.has("tech"):
			# locked: the cell's plate goes grey with the portrait (no team-teal left)
			S.cell(self, rr, [[0.0, Color("#3e4246")], [0.85, Color("#16181b")], [1.0, Color("#16181b")]], Vector2(0.5, 0.35))
			# and its gold metal edge dims to the locked tech frame's grey
			draw_rect(rr.grow(-1), Color("#5c5c62"), false, 2.0)
			draw_rect(Rect2(rr.position + Vector2(0, 0), Vector2(rr.size.x, 1)), Color("#8a8a90"))
		else:
			S.cell(self, rr, [[0.0, Color("#3d6f86")], [0.85, Color("#0f2d38")], [1.0, Color("#0f2d38")]], Vector2(0.5, 0.35))
		var mod := Color.WHITE if en or st == "unaffordable" or st == "training" else Color(0.45, 0.47, 0.5)
		var ir := rr.grow(-3)
		if c.has("tech"):
			# a tech: its painted tile (TechIcons.tile), greyed when locked
			var busy := st == "researching" or st == "queued"
			var tex := TechIcons.tile(str(c.svg), int(ir.size.x), "locked" if st == "locked" else ("busy" if busy else "normal"))  # 1:1, never rescaled (48 px)
			if tex:
				draw_texture_rect(tex, ir, false)
				if st == "researching":
					# the colour comes back clockwise from 12 o'clock as it is researched
					_reveal(TechIcons.tile(str(c.svg), int(ir.size.x), "normal"), ir, ir, float(c.get("progress", 0.0)))
			else:
				S.draw_icon(self, c.svg, Rect2(rr.get_center() - Vector2(20, 21), Vector2(40, 40)), true, mod)
		elif c.has("trade"):
			# a market exchange: the resource, a green (buy) / red (sell) arrow, the price in gold
			S.draw_icon(self, str(c.trade), Rect2(rr.position + Vector2(5, 4), Vector2(30, 30)), true, mod)
			S.draw_icon(self, "t_buy" if c.dir == "buy" else "t_sell", Rect2(rr.position + Vector2(32, 5), Vector2(18, 18)), true, mod)
			S.draw_icon(self, "gold", Rect2(rr.position + Vector2(3, 36), Vector2(14, 14)), false, mod)
			var lb := str(c.get("label", ""))
			draw_string_outline(bold, Vector2(rr.position.x + 18, rr.end.y - 4), lb, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, 4, Color(0, 0, 0, 0.75))
			draw_string(bold, Vector2(rr.position.x + 18, rr.end.y - 4), lb, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color("#ffe39a") if en else Color("#ff8a70"))
		elif c.get("tex") != null:
			var ptex: Texture2D = c.tex
			var pdst := Rect2(rr.grow(-2).position, Vector2(58, 58))  # CSS: the oversized grid item sits at the content box origin, overflowing right / down
			if st == "locked" or st == "training" or st == "queued":
				# locked: the portrait's greyscale copy (the tech tiles' "locked"
				# grey); training / queued: its blue "busy" copy, as a tech being
				# researched; until the portrait has rendered, a dark tint
				var gt := locked_portrait(ptex) if st == "locked" else busy_portrait(ptex)
				if gt:
					ptex = gt
					mod = Color.WHITE
				else:
					mod = Color(0.2, 0.2, 0.22) if st == "locked" else Color(0.3, 0.42, 0.6)
			_clip_tex(ptex, pdst, rr.grow(-2), mod)
			if st == "training" and ptex != c.tex:
				_reveal(c.tex, pdst, rr.grow(-2), float(c.get("progress", 0.0)))
			if st == "locked":
				draw_rect(rr.grow(-2), Color(0.03, 0.05, 0.07, 0.22))
		elif c.has("minor"):
			_minor_tile(rr, str(c.minor), en or st == "researching" or st == "unaffordable")
		else:
			S.draw_icon(self, c.svg, Rect2(rr.get_center() - Vector2(16, 16), Vector2(32, 32)), true, mod)
		_draw_cmd_state(c, rr, ir, st, hover)
		if hover and (en or st != ""):
			draw_rect(rr.grow(-2), S.GOLD_HI if en else Color(1, 1, 1, 0.35), false, 1.0)
			if en:
				for k in 3:
					draw_rect(rr.grow(1.0 + k * 2.0), Color(233 / 255.0, 200 / 255.0, 120 / 255.0, 0.3 - k * 0.09), false, 2.0)
		if c.key != "":
			var f := bold
			var kx := rr.end.x - 4 - S.text_width(f, c.key, 13)
			# over a progress bar (on the tile's foot) the key sits above it
			var ky := rr.end.y - (12 if st == "researching" or st == "training" or (st == "queued" and c.has("tech")) else 4)
			draw_string_outline(f, Vector2(kx, ky), c.key, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, 4, Color(0, 0, 0, 0.75))
			draw_string(f, Vector2(kx, ky), c.key, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.62, 0.62, 0.64) if st == "locked" else Color.WHITE)
		var tip := {"title": c.title, "lines": c.get("lines", []), "cost": c.get("cost", {}), "hotkey": c.key, "warn": c.get("warn", "")}
		for k in ["time", "bullets", "foot", "wide", "gain", "status"]:
			if c.has(k):
				tip[k] = c[k]
		zone(cr, "cmd", i, tip)

## A minor god's age-up button (the Egyptians): a lapis disc under his gold
## hieroglyph, dimmed when the button is locked.
func _minor_tile(rr: Rect2, god: String, lit: bool) -> void:
	var c := rr.get_center()
	var stops := [[0.0, Color("#f8e6b0")], [0.45, Color("#2e5ea6")], [1.0, Color("#081836")]] if lit else \
		[[0.0, Color("#8a8a86")], [0.45, Color("#3a3e48")], [1.0, Color("#101216")]]
	draw_circle(c, 22.5, Color("#1a1206"), true, -1.0, true)
	draw_circle(c, 21.5, Color("#d8b46c") if lit else Color("#6a6a6e"), true, -1.0, true)
	S.disc(self, c, 20.0, S.radial_tex(stops, Vector2(0.5, 0.3), 0.7, 64))
	var tex := S.icon("mg_" + god, 38, "#ffe9a8" if lit else "#a8a8a4")
	if tex:
		draw_texture_rect(tex, Rect2(c - Vector2(19, 20), Vector2(38, 38)), false, Color(0, 0, 0, 0.7))
		draw_texture_rect(tex, Rect2(c - Vector2(19, 19), Vector2(38, 38)), false)

## The state layer of a command button (PORTING.md "Command button states").
## One language for every button (tech, train, build, trade), read from the
## frame's colour first: available: the family's bright bevel (gold generic /
## purple god, the god's emblem on its corner; a portrait keeps the cell's
## edge); unaffordable: the whole bevel red plus a red cast (techs and
## portraits alike); researching / training / queued: the whole bevel blue,
## the picture in the blue "busy" duotone, its colour coming back clockwise
## as the work runs, a thick bar on the tile's foot; a queued tech its place
## in the queue on a corner chip (never over the picture); locked: the greyed picture, a dim grey
## bevel, the age numeral or a padlock on the corner.
const FRAMES := {
	"gold": ["#fff0b0", "#e2b340", "#7a5612", ""],
	"purple": ["#f6dcff", "#b45ae6", "#4e1c86", ""],
	"grey": ["#86868c", "#56565c", "#2a2a2e", ""],
	"red": ["#ffb4a0", "#ff2a12", "#800c04", "#ff6a40"],
	"blue": ["#d8f2ff", "#2ea2ff", "#0a3a80", "#7ccaff"],
}

## The frame colour a state draws (FRAMES), "" for none (a plain portrait).
static func frame_of(fam: String, st: String) -> String:
	match st:
		"unaffordable": return "red"
		"researching", "training", "queued": return "blue"
		"locked": return "grey" if fam != "" else ""
	return fam

func _draw_cmd_state(c: Dictionary, rr: Rect2, ir: Rect2, st: String, _hover: bool) -> void:
	var bold := S.font("bold")
	var title := S.font("title")
	var p := clampf(float(c.get("progress", 0.0)), 0.0, 1.0)
	if st == "unaffordable":
		# Retold: the picture in full colour under a red cast, deepest at the foot
		S.vgrad(self, ir, [[0.0, Color(0.8, 0.06, 0.02, 0.08)], [0.45, Color(0.8, 0.06, 0.02, 0.16)], [1.0, Color(0.9, 0.05, 0.02, 0.42)]])
	# the frame: a 3 px bevel, lit top / left, shaded bottom / right
	var fam := str(c.get("frame", ""))
	var sf := frame_of(fam, st)
	var o := rr.grow(-1)
	if sf != "":
		var fc: Array = FRAMES[sf]
		var hi := Color(str(fc[0]))
		var mid := Color(str(fc[1]))
		var lo := Color(str(fc[2]))
		if sf == "red" or sf == "blue":
			# a glow into the gap between cells: the state reads from afar
			draw_rect(rr.grow(1), Color(mid, 0.45), false, 2.0)
		draw_rect(o.grow(1), Color(0.03, 0.02, 0.0, 0.9), false, 1.0)
		draw_rect(Rect2(o.position, Vector2(o.size.x, 2)), hi)
		draw_rect(Rect2(o.position, Vector2(2, o.size.y)), hi.lerp(mid, 0.4))
		draw_rect(Rect2(o.position.x, o.end.y - 2, o.size.x, 2), lo)
		draw_rect(Rect2(o.end.x - 2, o.position.y, 2, o.size.y), lo.lerp(mid, 0.3))
		draw_rect(o, mid, false, 1.0)
		draw_rect(o.grow(-2), Color(str(fc[3])) if str(fc[3]) != "" else Color(0, 0, 0, 0.6), false, 1.0)
	if st == "researching" or st == "training":
		# where the colour stops: the sweep's leading edge on the picture
		if p > 0.0 and p < 1.0:
			_sweep_edge(ir, p)
		# progress: a thick bar on the tile's foot (dark trough, blue to ice)
		var bar := Rect2(ir.position.x + 1, ir.end.y - 7, ir.size.x - 2, 6)
		draw_rect(bar.grow(1), Color(0, 0, 0, 0.9))
		draw_rect(bar, Color("#0a1a30"))
		var fr := Rect2(bar.position, Vector2(roundf(bar.size.x * p), bar.size.y))
		if fr.size.x > 0:
			S.hgrad(self, fr, [[0.0, Color("#1c78e0")], [1.0, Color("#a8e4ff")]])
			draw_rect(Rect2(fr.position, Vector2(fr.size.x, 1)), Color(1, 1, 1, 0.55))
	elif st == "queued" and c.has("tech"):
		# a queued tech: a dark blue bar on the foot, empty (it waits its turn);
		# its place in the queue is the corner chip below, off the picture
		var bar := Rect2(ir.position.x + 1, ir.end.y - 7, ir.size.x - 2, 6)
		draw_rect(bar.grow(1), Color(0, 0, 0, 0.9))
		draw_rect(bar, Color("#0a1a30"))
		for k in 4:
			draw_rect(Rect2(bar.position.x + 3 + k * (bar.size.x - 6) / 4.0, bar.position.y + 2, 4, 2), Color("#4a86c8"))
	var lockd := st == "locked"
	# identity: a god tech keeps its god in every state. Purple corner caps
	# (an L bracket on each of the four corners, over the state's bevel) and
	# the god's emblem on a medallion at the top-left: a red can't-afford or
	# a blue researching god tech still reads "god tech" by shape, not only
	# by a frame colour the state has taken over
	var god := str(c.get("god", ""))
	if fam == "purple":
		_god_corners(rr, lockd)
	if fam == "purple" and god != "":
		var mc := rr.position + Vector2(3.5, 3.5)
		draw_circle(mc, 8.0, Color(0.04, 0.0, 0.08, 0.95))
		draw_circle(mc, 7.0, Color("#6a32b0") if not lockd else Color("#3a3440"))
		draw_arc(mc, 7.0, 0, TAU, 22, Color("#f0d8ff") if not lockd else Color("#8a8490"), 1.2, true)
		var em := TechIcons.god_emblem(god)
		if em != "":
			S.draw_icon(self, em, Rect2(mc - Vector2(5.5, 5.5), Vector2(11, 11)), false, Color.WHITE if not lockd else Color(0.6, 0.6, 0.62))
		else:
			var ini := god.substr(0, 1).to_upper()
			draw_string(title, Vector2(mc.x - S.text_width(title, ini, 8) * 0.5, mc.y + 3), ini, HORIZONTAL_ALIGNMENT_LEFT, -1, 8, Color("#fff4dc"))
	# an Armory line's tier: 1-3 small notches set into the frame's top edge
	# in the tier's metal (the picture itself tells the tiers apart: one
	# sword / two / two and an axe, copper / bronze / steel)
	var tier := int(c.get("tier", 0))
	if tier > 0:
		var tc: Color = [Color("#f08a4a"), Color("#ffd050"), Color("#dfe8f0")][tier - 1]
		if lockd:
			tc = tc.lerp(Color(0.6, 0.6, 0.62), 0.35)
		var x0 := rr.get_center().x - (tier * 7 - 2) * 0.5
		for k in tier:
			var nr := Rect2(x0 + k * 7, rr.position.y - 1, 5, 4)
			draw_rect(nr.grow(1), Color(0, 0, 0, 0.9))
			draw_rect(nr, tc)
			draw_rect(Rect2(nr.position, Vector2(nr.size.x, 1)), tc.lightened(0.5))
	# state badge on the frame's top-right corner: the age numeral or a padlock;
	# the queue place / count
	var bc2 := Vector2(rr.end.x - 3, rr.position.y + 3)
	if lockd:
		draw_circle(bc2, 7.5, Color(0, 0, 0, 0.92))
		draw_circle(bc2, 6.5, Color("#2a2c30"))
		draw_arc(bc2, 6.5, 0, TAU, 20, Color("#c8b080"), 1.2, true)
		if c.has("age_req"):
			var rn: String = ["I", "II", "III", "IV"][clampi(int(c.age_req), 0, 3)]
			var fs := 9 if rn.length() < 3 else 8
			draw_string(title, Vector2(bc2.x - S.text_width(title, rn, fs) * 0.5, bc2.y + 3.5), rn, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color("#f4e0a8"))
		else:
			S.draw_icon(self, "lock", Rect2(bc2 - Vector2(4.5, 4.5), Vector2(9, 9)), false)
	elif (st == "training" or st == "queued") and int(c.get("count", 0)) > 0:
		# the count in training / the place in the queue: a blue chip on the
		# frame's corner (a queued tech's with an hourglass), never on the picture
		var n := str(int(c.count))
		var qt := st == "queued" and c.has("tech")
		var iw := 9.0 if qt else 0.0
		var bw := maxf(13.0, S.text_width(bold, n, 11) + 6 + iw)
		var br := Rect2(rr.end.x - bw + 3, rr.position.y - 3, bw, 13)
		draw_rect(br, Color(0, 0, 0, 0.9))
		draw_rect(br.grow(-1), Color("#0e3a78"))
		draw_rect(br.grow(-1), Color("#9fd8ff"), false, 1.0)
		if qt:
			S.draw_icon(self, "t_time", Rect2(br.position + Vector2(2, 2), Vector2(9, 9)), false)
		draw_string(bold, Vector2(br.position.x + iw + (bw - iw - S.text_width(bold, n, 11)) * 0.5, br.end.y - 3), n, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color.WHITE)

## A god tech's corner caps: a purple L bracket on each corner of rr, set over
## the frame's bevel (whatever colour the state gave it) and the gap round it.
func _god_corners(rr: Rect2, dim: bool) -> void:
	var hi := Color("#f6dcff") if not dim else Color("#8a8490")
	var mid := Color("#a04ee0") if not dim else Color("#4a4452")
	var arm := 12.0
	var th := 3.0
	var o := rr.grow(1)
	for cx in [0, 1]:
		for cy in [0, 1]:
			var x := o.position.x if cx == 0 else o.end.x - arm
			var y := o.position.y if cy == 0 else o.end.y - th
			var xv := o.position.x if cx == 0 else o.end.x - th
			var yv := o.position.y if cy == 0 else o.end.y - arm
			var hr := Rect2(x, y, arm, th)
			var vr := Rect2(xv, yv, th, arm)
			draw_rect(hr.grow(1), Color(0.03, 0.0, 0.06, 0.95))
			draw_rect(vr.grow(1), Color(0.03, 0.0, 0.06, 0.95))
			draw_rect(hr, mid)
			draw_rect(vr, mid)
			# lit edge on the top / left faces
			draw_rect(Rect2(hr.position, Vector2(hr.size.x, 1)), hi)
			draw_rect(Rect2(vr.position, Vector2(1, vr.size.y)), hi.lerp(mid, 0.3))
			# a stud on the bracket's end
			var sx := hr.end.x - 1.5 if cx == 0 else hr.position.x + 1.5
			var sy := vr.end.y - 1.5 if cy == 0 else vr.position.y + 1.5
			draw_circle(Vector2(sx, hr.get_center().y), 1.1, hi)
			draw_circle(Vector2(vr.get_center().x, sy), 1.1, hi)

## Darken the part of r a clockwise sweep from 12 o'clock has not reached at p.
func _sweep(r: Rect2, p: float, col: Color) -> void:
	if p >= 1.0:
		return
	var c := r.get_center()
	var rad := r.size.length() * 0.5 + 1.0
	var pts := PackedVector2Array([c])
	var a0 := -PI * 0.5 + TAU * p
	var steps := maxi(2, int(ceil((1.0 - p) * 32)))
	for k in steps + 1:
		var a := lerpf(a0, PI * 1.5, float(k) / steps)
		pts.append(c + Vector2(cos(a), sin(a)) * rad)
	# clip the fan to the rect
	var clipped := Geometry2D.intersect_polygons(pts, PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]))
	for poly in clipped:
		draw_colored_polygon(poly, col)
	if p > 0.0:
		# the sweep's leading edge, centre to the rect's border
		var d := Vector2(cos(a0), sin(a0))
		var t := minf(r.size.x * 0.5 / maxf(absf(d.x), 0.001), r.size.y * 0.5 / maxf(absf(d.y), 0.001))
		draw_line(c, c + d * t, Color(0.85, 1.0, 0.8, 0.3), 1.0, true)

## The clockwise fan from 12 o'clock to p (0..1) round clip's centre, clipped to clip.
func _fan(clip: Rect2, p: float) -> Array:
	var c := clip.get_center()
	var rad := clip.size.length() * 0.5 + 1.0
	var pts := PackedVector2Array([c])
	var a1 := -PI * 0.5 + TAU * p
	var steps := maxi(2, int(ceil(p * 48)))
	for k in steps + 1:
		var a := lerpf(-PI * 0.5, a1, float(k) / steps)
		pts.append(c + Vector2(cos(a), sin(a)) * rad)
	return Geometry2D.intersect_polygons(pts, PackedVector2Array([clip.position, Vector2(clip.end.x, clip.position.y), clip.end, Vector2(clip.position.x, clip.end.y)]))

## Draw tex (laid at dst) over the part of clip a clockwise sweep from
## 12 o'clock has reached at p: the busy picture's colour coming back.
func _reveal(tex: Texture2D, dst: Rect2, clip: Rect2, p: float) -> void:
	if tex == null or p <= 0.0:
		return
	if p >= 1.0:
		_clip_tex(tex, dst, clip)
		return
	for poly in _fan(clip, p):
		var uv := PackedVector2Array()
		for q in poly:
			uv.append((q - dst.position) / dst.size)
		draw_colored_polygon(poly, Color.WHITE, uv, tex)

## The sweep's leading edge, centre to the rect's border, and its 12 o'clock start.
func _sweep_edge(r: Rect2, p: float) -> void:
	var c := r.get_center()
	var a0 := -PI * 0.5 + TAU * p
	var d := Vector2(cos(a0), sin(a0))
	var t := minf(r.size.x * 0.5 / maxf(absf(d.x), 0.001), r.size.y * 0.5 / maxf(absf(d.y), 0.001))
	draw_line(c, c + d * t, Color(0, 0, 0, 0.6), 3.0, true)
	draw_line(c, c + d * t, Color("#c8ecff"), 1.0, true)
	draw_line(c, Vector2(c.x, r.position.y), Color(0, 0, 0, 0.45), 2.0, true)
	draw_circle(c, 2.0, Color("#c8ecff"))

# selection card --------------------------------------------------------------------------------

func _draw_info() -> void:
	var r := info_rect()
	S.boss(self, Vector2(r.end.x + 2, r.position.y - 2), 7)
	var info: Dictionary = ui.info
	# the god's emblem, faint
	var g0 := str(ui.player.get("god", "zeus")).to_lower()
	var em := S.icon(g0 if g0 in ["ra", "isis", "set"] else "zeus", 150, "#78d2dc")
	if em:
		draw_texture_rect(em, Rect2(r.end.x - 3 - 8 - 150, r.end.y - 6 - 150, 150, 150), false, Color(1, 1, 1, 0.10))
	var x0 := r.position.x + 16
	var y0 := r.position.y + 3 + 12
	var bold := S.font("bold")
	var sans := S.font("sans")
	var title := S.font("title")
	match str(info.get("kind", "none")):
		"none":
			var s: String = info.get("text", "")
			S.text(self, title, Vector2(r.position.x, r.get_center().y + 5), s.to_upper(), 14, Color(216 / 255.0, 180 / 255.0, 108 / 255.0, 0.45),
				HORIZONTAL_ALIGNMENT_CENTER, r.size.x - 3, 0.0, 1.5)
		"multi":
			S.text(self, title, Vector2(x0, y0 + 20), str(info.title).to_upper(), 20, Color("#fff4dc"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85, 1.2)
			var oy := y0 + 27
			_owner_line(Vector2(x0, oy), info)
			var mx := x0
			var my := oy + 18 + 8 + 3
			for it in info.items:
				if mx + 44 > r.end.x - 16:
					mx = x0
					my += 52
				if my + 48 > r.end.y:
					break
				var mr := Rect2(mx, my, 44, 48)
				draw_rect(mr, Color("#10303c"))
				if it.tex:
					_clip_tex(it.tex, Rect2(mr.position, Vector2(44, 44)), mr.grow(-1))
				draw_rect(mr, S.BRONZE, false, 1.0)
				var hpw: float = (mr.size.x - 4) * clampf(it.hp, 0.0, 1.0)
				draw_rect(Rect2(mr.position.x + 2, mr.end.y - 4, mr.size.x - 4, 3), Color(0.1, 0.05, 0.03, 0.9))
				draw_rect(Rect2(mr.position.x + 2, mr.end.y - 4, hpw, 3), Color("#3d9a32") if it.hp > 0.5 else Color("#d8a030") if it.hp > 0.25 else Color("#c83a2a"))
				zone(mr, "multi", it.id, {})
				mx += 48
		_:
			S.text(self, title, Vector2(x0, y0 + 20), str(info.title).to_upper(), 20, Color("#fff4dc"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85, 1.2)
			var oy := y0 + 27
			_owner_line(Vector2(x0, oy), info)
			var by := oy + 18 + 8
			if info.has("hp"):
				var hy := oy + 18 + 6
				S.draw_icon(self, "heart", Rect2(x0, hy + 1, 18, 18))
				var hs := "%d/%d" % [int(ceil(info.hp)), int(info.max_hp)]
				S.text(self, bold, Vector2(x0 + 24, hy + 16), hs, 16, S.INK)
				var bx := x0 + 24 + S.text_width(bold, hs, 16) + 12
				var bar := Rect2(bx, hy + 5.5, 170, 9)
				draw_rect(bar.grow(1), Color(216 / 255.0, 180 / 255.0, 108 / 255.0, 0.5), false, 1.0)
				draw_rect(bar, Color("#2a1510"))
				draw_rect(bar, Color.BLACK, false, 1.0)
				var f := clampf(info.hp / maxf(1.0, info.max_hp), 0.0, 1.0)
				var fill := Rect2(bar.position + Vector2(1, 1), Vector2((bar.size.x - 2) * f, bar.size.y - 2))
				var hc := [Color("#9ef58a"), Color("#3a9a2e")] if f > 0.5 else [Color("#ffe08a"), Color("#c89a2e")] if f > 0.25 else [Color("#ff9a7a"), Color("#b8322a")]
				S.vgrad(self, fill, [[0.0, hc[0]], [1.0, hc[1]]])
				draw_rect(Rect2(fill.position, Vector2(fill.size.x, 1)), Color(1, 1, 1, 0.35))
				by = hy + 20 + 8
			# portrait
			var pr := Rect2(x0, by, 88, 88)
			S.drop_shadow(self, pr, 3, 8, 0.4)
			S.cell(self, pr, [[0.0, Color("#4f8ea6")], [0.8, Color("#10303c")], [1.0, Color("#10303c")]], Vector2(0.5, 0.38))
			if info.get("tex") != null:
				_clip_tex(info.tex, Rect2(pr.grow(-2).position, Vector2(112, 112)), pr.grow(-2))  # as the browser: anchored top-left, cropped right / down
			elif info.get("icon", "") != "":
				S.draw_icon(self, info.icon, Rect2(pr.get_center() - Vector2(27, 27), Vector2(54, 54)))
			# stats (2 columns) + task + queue
			var sx := pr.end.x + 14
			var colw := (r.end.x - 3 - 16 - sx - 12) * 0.5
			var sy := by + 2
			var stats: Array = info.get("stats", [])
			var i := 0
			for s in stats:
				var cx: float = sx + (i % 2) * (colw + 12)
				var cy: float = sy + (i / 2) * 22
				S.draw_icon(self, s[0], Rect2(cx, cy + 1, 18, 18))
				var vx := cx + 23
				S.text(self, bold, Vector2(vx, cy + 16), str(s[1]), 15, S.INK)
				if s[2] != "":
					S.text(self, sans, Vector2(vx + S.text_width(bold, str(s[1]), 15) + 5, cy + 16), s[2], 15, S.MUTED)
				i += 1
			var ty := sy + ((stats.size() + 1) / 2) * 22 + 3
			for t in info.get("tasks", []):
				S.text(self, title, Vector2(sx, ty + 14), str(t).to_upper(), 13, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85, 0.8)
				ty += 20
			var qx := sx
			var qs: Array = info.get("queue", [])
			for q in qs:
				var qr := Rect2(qx, ty + 4, 38, 38)
				draw_rect(qr, Color("#10303c"))
				if q.has("tech"):
					var qt := TechIcons.tile(str(q.svg), 34)
					if qt:
						draw_texture_rect(qt, qr.grow(-2), false)  # 34 px, 1:1
					if q.p <= 0.0:
						draw_rect(qr.grow(-2), Color(0.0, 0.03, 0.05, 0.45))
					else:
						_sweep(qr.grow(-2), float(q.p), Color(0.0, 0.03, 0.05, 0.5))
				elif q.tex:
					_clip_tex(q.tex, Rect2(qr.get_center() - Vector2(24, 24), Vector2(48, 48)), qr.grow(-1))
				draw_rect(qr, S.BRONZE, false, 1.0)
				if q.p > 0.0:
					draw_rect(Rect2(qr.position.x, qr.end.y - 4, qr.size.x, 4), Color(0, 0, 0, 0.6))
					draw_rect(Rect2(qr.position.x, qr.end.y - 4, qr.size.x * q.p, 4), Color("#6cc4ff"))  # the busy blue of the grid's bars
				if q.has("tech"):
					var ql := ["%s left" % _secs(float(q.left)) if q.p > 0.0 else "Queued", "Click to cancel (refunds its cost)"]
					zone(qr, "rqueue", q.tech, {"title": q.name, "lines": ql})
				else:
					zone(qr, "queue", q.i, {"title": q.name, "lines": ["Click to cancel"]})
				qx += 42
			if not qs.is_empty():
				ty += 46
			# the techs researched here (small icons) and a Market's rates
			var dts: Array = info.get("done_techs", [])
			if not dts.is_empty() and ty + 24 <= r.end.y - 4:
				S.text(self, title, Vector2(sx, ty + 16), "RESEARCHED", 11, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85, 0.8)
				var dx := sx + S.text_width(title, "RESEARCHED", 11, 0.8) + 8
				for dt in dts:
					if dx + 22 > r.end.x - 12:
						break
					# done: the tile dimmed, a green check, no buyable frame
					var dr := Rect2(dx, ty + 2, 22, 22)
					var dtex := TechIcons.tile(str(dt.svg), 22)
					if dtex:
						draw_texture_rect(dtex, dr, false, Color(0.62, 0.66, 0.64))
					draw_rect(dr, Color("#2f6a34"), false, 1.0)
					var ck := dr.end - Vector2(5, 5)
					draw_circle(ck, 5.0, Color(0, 0, 0, 0.85))
					draw_circle(ck, 4.0, Color("#3fae3a"))
					draw_polyline(PackedVector2Array([ck + Vector2(-2.2, 0), ck + Vector2(-0.6, 1.6), ck + Vector2(2.2, -1.6)]), Color.WHITE, 1.3, true)
					zone(dr, "rdone", dt.tech, {"title": dt.name, "lines": [dt.text, "Researched"]})
					dx += 25
				ty += 28
			if info.has("market"):
				_draw_market_rates(Vector2(sx, ty), r.end.x - 14 - sx, info.market)

static func _secs(t: float) -> String:
	return "%ds" % int(ceil(maxf(t, 0.0)))

## A Market's exchange on its card (Retold's trade readout): per resource the
## gold a lot costs / brings now, how far its price is above or below the
## base, and the fee.
func _draw_market_rates(p: Vector2, _w: float, m: Dictionary) -> void:
	var bold := S.font("bold")
	var sans := S.font("sans")
	var title := S.font("title")
	var y := p.y
	S.text(self, title, Vector2(p.x, y + 13), "EXCHANGE  ·  %d PER LOT  ·  FEE %s%%" % [int(m.get("lot", 100)), _num1(float(m.get("fee", 0.3)) * 100.0)], 11, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85, 0.8)
	y += 18
	for res in ["food", "wood"]:
		var e: Dictionary = m.get(res, {})
		if not bool(e.get("tradable", false)):
			continue
		var x := p.x
		S.draw_icon(self, res, Rect2(x, y + 1, 18, 18))
		x += 24
		S.text(self, sans, Vector2(x, y + 15), "Buy", 14, S.MUTED)
		x += S.text_width(sans, "Buy", 14) + 5
		S.text(self, bold, Vector2(x, y + 15), str(int(e.buy)), 15, S.INK)
		x += S.text_width(bold, str(int(e.buy)), 15) + 3
		S.draw_icon(self, "gold", Rect2(x, y + 3, 14, 14), false)
		x += 24
		S.text(self, sans, Vector2(x, y + 15), "Sell", 14, S.MUTED)
		x += S.text_width(sans, "Sell", 14) + 5
		S.text(self, bold, Vector2(x, y + 15), str(int(e.sell)), 15, S.INK)
		x += S.text_width(bold, str(int(e.sell)), 15) + 3
		S.draw_icon(self, "gold", Rect2(x, y + 3, 14, 14), false)
		x += 22
		var d := float(e.price) - float(m.get("base", 100.0))
		if absf(d) >= 0.5:
			S.draw_icon(self, "t_buy" if d > 0 else "t_sell", Rect2(x, y + 3, 14, 14), false)
			S.text(self, sans, Vector2(x + 16, y + 15), "%+d" % int(round(d)), 13, Color("#9ef58a") if d > 0 else Color("#ff8a70"))
		y += 22

static func _num1(v: float) -> String:
	return str(int(v)) if v == floor(v) else "%.1f" % v

func _owner_line(p: Vector2, info: Dictionary) -> void:
	var bold := S.font("bold")
	var sans := S.font("sans")
	var x := p.x
	if info.get("owner", 0) > 0:
		S.player_tag(self, Rect2(x, p.y, 18, 18), info.owner_color, info.owner, 11)
		x += 18 + 6
		S.text(self, bold, Vector2(x, p.y + 14), info.owner_name, 15, S.INK)
		x += S.text_width(bold, info.owner_name, 15) + 5
	if info.get("cls", "") != "":
		S.text(self, sans, Vector2(x, p.y + 14), ("· " if info.get("owner", 0) > 0 else "") + str(info.cls), 15, S.MUTED)

# minimap frame ------------------------------------------------------------------------------

func _draw_tray() -> void:
	var o := mm_origin()
	var t := tray_rect()
	# the rim: M1 150V26L27 1h310l26 25v124 (dark 5px, bronze 2px, inner 1px)
	var rim := PackedVector2Array([Vector2(1, 150), Vector2(1, 26), Vector2(27, 1), Vector2(337, 1), Vector2(363, 26), Vector2(363, 150)])
	var inner := PackedVector2Array([Vector2(7, 150), Vector2(7, 29), Vector2(30, 7), Vector2(334, 7), Vector2(357, 29), Vector2(357, 150)])
	for i in rim.size():
		rim[i] += t.position
		inner[i] += t.position
	draw_polyline(rim, Color("#050d10"), 5.0, true)
	draw_polyline(rim, Color("#b08a4c"), 2.0, true)
	var hi := PackedVector2Array([rim[1] + Vector2(0.5, 0), rim[2] + Vector2(0, 0.5), rim[3] + Vector2(0, 0.5)])
	draw_polyline(hi, Color(1, 0.93, 0.72, 0.45), 1.0, true)
	draw_polyline(inner, Color("#5b4422"), 1.0, true)
	# the diamond's cast-bronze frame (.dia::before, rotated with the map)
	var c := dia_center()
	var rot: float = ui.minimap_rotation()
	var sq := func(half: float) -> PackedVector2Array:
		var pts := PackedVector2Array()
		for v in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
			pts.push_back(c + (v * half).rotated(rot))
		return pts
	# drop shadow
	for k in 5:
		var sh: PackedVector2Array = sq.call(106.0 + k * 3.0)
		for j in sh.size():
			sh[j] += Vector2(0, 8)
		draw_colored_polygon(sh, Color(0, 0, 0, 0.09))
	draw_colored_polygon(sq.call(112.0), S.DARK)
	draw_colored_polygon(sq.call(111.0), Color("#b08a4c"))
	draw_colored_polygon(sq.call(110.0), Color("#0a242c"))
	draw_colored_polygon(sq.call(106.0), S.DARK)
	# the metal: linear-gradient(135deg, #fff0c0, #c99a48 22%, #6b4c26 48%, #d8b060 74%, #fff0c0) with a bevel
	var metal := [[0.0, Color("#fff0c0")], [0.22, Color("#c99a48")], [0.48, Color("#6b4c26")], [0.74, Color("#d8b060")], [1.0, Color("#fff0c0")]]
	var outer: PackedVector2Array = sq.call(105.0)
	var inn: PackedVector2Array = sq.call(99.0)
	var n := 12
	for e in 4:
		var a0 := outer[e]
		var a1 := outer[(e + 1) % 4]
		var b0 := inn[e]
		var b1 := inn[(e + 1) % 4]
		# light from the top-left: edges facing up-left brighter
		var mid := ((a0 + a1) * 0.5 - c).normalized()
		var lit := clampf(0.5 - mid.dot(Vector2(0.6, 0.8)) * 0.5, 0.0, 1.0)
		var shade := lerpf(0.78, 1.12, lit)
		for k in n:
			var t0 := float(k) / n
			var t1 := float(k + 1) / n
			var p0 := a0.lerp(a1, t0)
			var p1 := a0.lerp(a1, t1)
			var q0 := b0.lerp(b1, t0)
			var q1 := b0.lerp(b1, t1)
			# 135deg gradient in the square's own frame: t = projection on its diagonal
			var g := func(pt: Vector2) -> Color:
				var l := (pt - c).rotated(-rot)
				var tt := clampf((l.x + l.y) / (2.0 * 105.0) * 0.5 + 0.5, 0.0, 1.0)
				return S.sample(metal, tt) * shade
			var co0: Color = g.call(p0)
			var co1: Color = g.call(p1)
			var ci1: Color = (g.call(q1) as Color).darkened(0.12)
			var ci0: Color = (g.call(q0) as Color).darkened(0.12)
			draw_polygon(PackedVector2Array([p0, p1, q1, q0]), PackedColorArray([co0, co1, ci1, ci0]))
	draw_polyline(_closed(outer), Color(1, 0.95, 0.8, 0.5), 1.0, true)
	draw_polyline(_closed(inn), Color(0.2, 0.13, 0.05, 0.8), 1.0, true)
	# .dia::after: the dark bed with a light hairline
	draw_colored_polygon(sq.call(99.0), Color("#041116"))
	draw_polyline(_closed(sq.call(98.5)), Color(1, 230 / 255.0, 170 / 255.0, 0.35), 1.0, true)

func _closed(p: PackedVector2Array) -> PackedVector2Array:
	var q := PackedVector2Array(p)
	q.push_back(p[0])
	return q

func _draw_minimap_front() -> void:
	var c := dia_center()
	var rot: float = ui.minimap_rotation()
	zone(Rect2(c - Vector2(136, 136), Vector2(272, 272)), "minimap")
	# inner shade over the map edge (.dia .inner)
	for k in 6:
		var half := 95.0 - k * 2.0
		var pts := PackedVector2Array()
		for v in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1), Vector2(-1, -1)]:
			pts.push_back(c + (v * half).rotated(rot))
		draw_polyline(pts, Color(0, 0, 0, 0.8 if k == 0 else 0.1 * (1.0 - k / 6.0)), 1.0 if k == 0 else 2.0, true)
	# gems at the corners
	for v in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
		var gc: Vector2 = c + (v * 105.0).rotated(rot)
		_gem(gc, rot)
	# the button ring
	var o := mm_origin()
	var btns := [
		["idle", "villager", Vector2(14, 212), {"title": "Idle Villager", "lines": ["Select the next idle villager (.)"]}, int(ui.hud_state.get("idle", 0))],
		["army", "military", Vector2(51, 249), {"title": "Idle Military", "lines": ["Select all idle soldiers"]}, int(ui.hud_state.get("army", 0))],
		["home", "house", Vector2(88, 286), {"title": "Town Center", "lines": ["Select and centre on your Town Center (H)"]}, 0],
		["flare", "flare", Vector2(240, 286), {"title": "Signal", "lines": ["Right-click the minimap to send selected units there"]}, 0],
		["terrain", "terrain", Vector2(277, 249), {"title": "Terrain", "lines": ["Show or hide terrain on the minimap"]}, 0],
		["score", "laurel", Vector2(314, 212), {"title": "Scores", "lines": ["Show or hide the score list"]}, 0],
	]
	var bold := S.font("bold")
	for b in btns:
		var bc: Vector2 = o + b[2] + Vector2(18, 18)
		var id: String = "rb:" + b[0]
		S.round_button(self, bc, 18, ui.hover_id == id)
		var off: bool = (b[0] == "terrain" and not ui.minimap.show_terrain) or (b[0] == "score" and not ui.scores_visible)
		S.draw_icon(self, b[1], Rect2(bc - Vector2(11, 11), Vector2(22, 22)), true, Color(1, 1, 1, 0.35 if off else 1.0))
		zone(Rect2(bc - Vector2(22, 22), Vector2(44, 44)), id, null, b[3])
		var badge: int = b[4]
		if badge > 0:
			var s := str(badge)
			var bw := maxf(18.0, S.text_width(bold, s, 12) + 8)
			var br := Rect2(bc.x + 18 + 8 - bw, bc.y - 18 - 8, bw, 18)
			var rc := br.get_center()
			draw_circle(rc + Vector2(0, 1), 10.5, Color(0, 0, 0, 0.5), true, -1.0, true)
			if bw <= 18.0:
				draw_circle(rc, 9.5, Color("#ffd0a0"), true, -1.0, true)
				S.disc(self, rc, 8.5, S.radial_tex([[0.0, Color("#e0503f")], [1.0, Color("#9a2620")]], Vector2(0.4, 0.3), 0.7, 32))
			else:
				draw_rect(br.grow(1), Color("#ffd0a0"))
				draw_rect(br, Color("#b8322a"))
			S.text(self, bold, Vector2(br.position.x, br.position.y + 13.5), s, 12, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, br.size.x, 0.6)

func _gem(c: Vector2, rot: float) -> void:
	var sq := func(half: float) -> PackedVector2Array:
		var pts := PackedVector2Array()
		for v in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
			pts.push_back(c + (v * half).rotated(rot))
		return pts
	draw_colored_polygon(sq.call(11.5), S.DARK)
	draw_colored_polygon(sq.call(10.5), S.GOLD)
	draw_colored_polygon(sq.call(8.2), Color("#0b3d2c"))
	var tex := S.radial_tex([[0.0, Color("#d8fff0")], [0.5, Color("#2fa07a")], [1.0, Color("#0b3d2c")]], Vector2(0.35, 0.3), 0.85, 32)
	var pts: PackedVector2Array = sq.call(8.0)
	draw_colored_polygon(pts, Color.WHITE, PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]), tex)
	draw_line(pts[0], pts[1], Color(1, 1, 1, 0.35), 1.0, true)

# feed / message / tooltip / result -------------------------------------------------------------

func _draw_feed() -> void:
	var y := 84.0
	var bold := S.font("bold")
	for it in ui.feed_items:
		var a: float = it.alpha
		if a <= 0.0:
			continue
		var w := S.text_width(bold, it.text, 16, 0.2) + 24
		var r := Rect2(10, y, w, 27)
		draw_rect(Rect2(r.position + Vector2(0, 2), r.size).grow(2), Color(0, 0, 0, 0.25 * a))
		S.vgrad(self, r, [[0.0, Color(14 / 255.0, 44 / 255.0, 52 / 255.0, 0.92 * a)], [1.0, Color(5 / 255.0, 20 / 255.0, 25 / 255.0, 0.92 * a)]])
		draw_rect(r.grow(-1), Color(0, 0, 0, 0.6 * a), false, 1.0)
		draw_rect(r, Color(S.BRONZE, a), false, 1.0)
		var col := Color("#ffe39a") if it.gold else Color("#f6eedb")
		col.a = a
		S.text(self, bold, Vector2(r.position.x + 12, r.position.y + 19), it.text, 16, col, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.85 * a, 0.2)
		y += 27 + 6

func _draw_message() -> void:
	var a: float = ui.msg_alpha
	if a <= 0.0 or ui.msg_text == "":
		return
	var f := S.font("title7")
	var s: String = ui.msg_text
	var w := S.text_width(f, s, 20)
	var p := Vector2((W() - w) * 0.5, 150 + 20)
	for k in 4:
		draw_string_outline(f, p + Vector2(0, 2), s, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, 4 + k * 3, Color(0, 0, 0, 0.18 * a))
	draw_string(f, p + Vector2(0, 2), s, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(0, 0, 0, a))
	draw_string(f, p, s, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Color(1, 231 / 255.0, 160 / 255.0, a))

func _draw_tooltip() -> void:
	var t: Dictionary = ui.tooltip
	if t.is_empty() or not t.has("anchor"):
		return
	if t.get("wide", false):
		_draw_wide_tooltip(t)
		return
	var title := S.font("title")
	var sans := S.font("sans")
	var bold := S.font("bold")
	var cost: Dictionary = t.get("cost", {})
	# the body lines wrapped to the panel's widest (278): no line runs past its edge
	var lines: Array = []
	for l in t.get("lines", []):
		if S.text_width(sans, str(l), 14) > 278.0:
			# (a number keeps its unit: "+20 %" never breaks before the %)
			for wl in _wrap(sans, str(l).replace(" %", "\u00a0%"), 14, 278.0):
				lines.append(str(wl).replace("\u00a0", " "))
		else:
			lines.append(str(l))
	var w := 0.0
	var tw := S.text_width(title, str(t.get("title", "")), 14, 0.5)
	if t.get("sub", "") != "":
		tw += 5 + S.text_width(sans, t.sub, 14)
	w = tw
	for l in lines:
		w = maxf(w, S.text_width(sans, str(l), 14))
	if t.has("status"):
		w = maxf(w, S.text_width(bold, str(t.status.text), 13))
	var cost_w := 0.0
	for k in cost:
		cost_w += 16 + S.text_width(bold, str(int(cost[k])), 14) + 10
	w = minf(maxf(w, cost_w), 278.0)
	var menu: bool = t.get("menu", false)
	if menu:
		w = maxf(w, 262.0)  # room for the Graphics row
	var h := 8.0 + 18.0 + lines.size() * 18.0 + (20.0 if not cost.is_empty() else 0.0) + (18.0 if t.get("hotkey", "") != "" else 0.0) + (18.0 if t.get("warn", "") != "" or t.has("status") else 0.0) + (38.0 if menu else 0.0) + 8.0
	var ar: Rect2 = t.anchor
	var x := minf(W() - maxf(290.0, w + 30.0), ar.position.x)
	var y := ar.position.y - h - 8.0
	if y < 4.0:
		y = ar.end.y + 8.0
	var r := Rect2(x, y, w + 22, h)
	draw_rect(Rect2(r.position + Vector2(0, 4), r.size).grow(4), Color(0, 0, 0, 0.18))
	draw_rect(Rect2(r.position + Vector2(0, 2), r.size).grow(2), Color(0, 0, 0, 0.25))
	draw_rect(r.grow(1), Color.BLACK)
	S.vgrad(self, r, [[0.0, Color(12 / 255.0, 40 / 255.0, 48 / 255.0, 0.97)], [1.0, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.97)]])
	draw_rect(r, S.BRONZE_HI, false, 1.0)
	var cy := r.position.y + 8 + 14
	S.text(self, title, Vector2(r.position.x + 11, cy), str(t.get("title", "")), 14, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8, 0.5)
	if t.get("sub", "") != "":
		S.text(self, sans, Vector2(r.position.x + 11 + S.text_width(title, str(t.title), 14, 0.5) + 5, cy), t.sub, 14, S.MUTED)
	# the state and its reason open the tooltip, right under the name (as a tech's)
	if t.has("status"):
		cy += 18
		S.text(self, bold, Vector2(r.position.x + 11, cy), str(t.status.text), 13, status_color(str(t.status.state)), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	elif t.get("warn", "") != "":
		cy += 18
		S.text(self, sans, Vector2(r.position.x + 11, cy), str(t.warn), 13, Color("#ff8a70"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	for l in lines:
		cy += 18
		S.text(self, sans, Vector2(r.position.x + 11, cy), str(l), 14, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	if not cost.is_empty():
		cy += 20
		var cx := r.position.x + 11
		for k in cost:
			S.draw_icon(self, k, Rect2(cx, cy - 13, 15, 15))
			cx += 18
			var v := str(int(cost[k]))
			var have: float = ui.player.get(k, 0.0)
			S.text(self, bold, Vector2(cx, cy), v, 14, S.INK if have >= float(cost[k]) else Color("#ff8a70"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
			cx += S.text_width(bold, v, 14) + 10
	if t.get("hotkey", "") != "":
		cy += 18
		S.text(self, sans, Vector2(r.position.x + 11, cy), "Hotkey: " + str(t.hotkey), 12, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
	if menu:
		# the graphics quality row of the pinned hotkey card (browser: gear card,
		# Graphics High / Medium / Low; applies at once and is remembered)
		cy += 12
		draw_line(Vector2(r.position.x + 11, cy - 4), Vector2(r.end.x - 11, cy - 4), Color(S.BRONZE_HI, 0.35), 1.0)
		cy += 18
		S.text(self, bold, Vector2(r.position.x + 11, cy), "Graphics", 14, S.MUTED, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
		var cur: String = ui.graphics_quality()
		var bx := r.position.x + 11 + 70
		for q in [["high", "High"], ["medium", "Medium"], ["low", "Low"]]:
			var br := Rect2(bx, cy - 16, 58, 22)
			var on: bool = cur == q[0]
			var hov: bool = ui.hover_id == "gfx:" + q[0]
			draw_rect(br, Color("#2d7489") if on else (Color("#1e5363") if hov else Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.9)))
			draw_rect(br, S.GOLD if on else Color(S.BRONZE_HI, 0.6), false, 1.0)
			S.text(self, bold if on else sans, Vector2(br.position.x, cy), q[1], 13, S.INK if on else S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, br.size.x, 0.6)
			zone(br, "gfx", q[0])
			bx += 62

## Words of `s` in lines no wider than `w` at font size `px`.
static func _wrap(f: Font, s: String, px: int, w: float) -> Array:
	var out := []
	var cur := ""
	for word in s.split(" ", false):
		var tryw: String = word if cur == "" else cur + " " + word
		if cur != "" and S.text_width(f, tryw, px) > w:
			out.append(cur)
			cur = word
		else:
			cur = tryw
	if cur != "":
		out.append(cur)
	return out

## A tech / trade tooltip as Retold's (reference/techs/ui_03.jpg, ui_05.jpg):
## the name and hotkey, "Cost: 100 [food], 10 [favor], 40s [hourglass]"
## (red where short), the effect, per-class bullets, the lock's reason in
## red, age / building / god.
## The colour of a command state's line in a tooltip.
static func status_color(st: String) -> Color:
	match st:
		"available": return Color("#9ef58a")
		"unaffordable": return Color("#ff7a5c")
		"locked": return Color("#d8a878")
		"researching", "training": return Color("#8fdcff")
		"queued": return Color("#ffd27a")
	return S.MUTED

func _draw_wide_tooltip(t: Dictionary) -> void:
	var title := S.font("title")
	var sans := S.font("sans")
	var bold := S.font("bold")
	var maxw := 350.0
	var rows := []   # [text, font, size, color, height]
	for l in t.get("lines", []):
		var wl := _wrap(sans, "• " + str(l), 15, maxw)
		for k in wl.size():
			rows.append([("    " if k > 0 else "") + str(wl[k]), sans, 15, S.INK, 19.0])
	for l in t.get("bullets", []):
		var wl := _wrap(sans, "• " + str(l), 14, maxw)
		for k in wl.size():
			rows.append([("    " if k > 0 else "") + str(wl[k]), sans, 14, Color("#e9d39a"), 18.0])
	var stt: Dictionary = t.get("status", {})
	if not stt.is_empty():
		var wl := _wrap(bold, str(stt.text), 13, maxw)
		for k in wl.size():
			rows.insert(k, [("    " if k > 0 else "") + str(wl[k]), bold, 13, status_color(str(stt.state)), 19.0])
	elif str(t.get("warn", "")) != "":
		for wl in _wrap(bold, str(t.warn), 13, maxw):
			rows.append([str(wl), bold, 13, Color("#ff8a70"), 18.0])
	for l in t.get("foot", []):
		rows.append([str(l), sans, 12, S.MUTED, 16.0])
	var head := str(t.get("title", ""))
	var hk := str(t.get("hotkey", ""))
	var w := S.text_width(title, head, 15, 0.5) + (6.0 + S.text_width(sans, "(%s)" % hk, 14) if hk != "" else 0.0)
	var cost: Dictionary = t.get("cost", {})
	var gain: Dictionary = t.get("gain", {})
	var cw := S.text_width(sans, "Cost:", 14) + 6
	for k in cost:
		cw += S.text_width(bold, str(int(cost[k])), 14) + 3 + 16 + 10
	if t.has("time"):
		cw += S.text_width(bold, "%ds" % int(ceil(float(t.time))), 14) + 3 + 16
	w = maxf(w, cw)
	if not gain.is_empty():
		w = maxf(w, S.text_width(sans, "Gives:", 14) + 6 + 60)
	for row in rows:
		w = maxf(w, S.text_width(row[1], row[0], row[2]))
	w = minf(w, maxw + 10)
	var h := 8.0 + 20.0 + (22.0 if not cost.is_empty() or t.has("time") else 0.0) + (20.0 if not gain.is_empty() else 0.0) + 4.0
	for row in rows:
		h += row[4]
	h += 8.0
	var ar: Rect2 = t.anchor
	var x := clampf(ar.position.x, 4.0, W() - w - 30.0)
	var y := ar.position.y - h - 8.0
	if y < 4.0:
		y = ar.end.y + 8.0
	var r := Rect2(x, y, w + 22, h)
	draw_rect(Rect2(r.position + Vector2(0, 4), r.size).grow(4), Color(0, 0, 0, 0.18))
	draw_rect(Rect2(r.position + Vector2(0, 2), r.size).grow(2), Color(0, 0, 0, 0.25))
	draw_rect(r.grow(1), Color.BLACK)
	S.vgrad(self, r, [[0.0, Color(12 / 255.0, 40 / 255.0, 48 / 255.0, 0.97)], [1.0, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.97)]])
	draw_rect(r, S.BRONZE_HI, false, 1.0)
	var lx := r.position.x + 11
	var cy := r.position.y + 8 + 15
	S.text(self, title, Vector2(lx, cy), head, 15, S.GOLD, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.8, 0.5)
	if hk != "":
		S.text(self, sans, Vector2(lx + S.text_width(title, head, 15, 0.5) + 6, cy), "(%s)" % hk, 14, S.MUTED)
	if not cost.is_empty() or t.has("time"):
		cy += 22
		S.text(self, sans, Vector2(lx, cy), "Cost:", 14, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
		var cx := lx + S.text_width(sans, "Cost:", 14) + 6
		for k in cost:
			var v := str(int(cost[k]))
			var have: float = ui.player.get(k, 0.0)
			S.text(self, bold, Vector2(cx, cy), v, 14, S.INK if have >= float(cost[k]) else Color("#ff8a70"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
			cx += S.text_width(bold, v, 14) + 3
			S.draw_icon(self, k, Rect2(cx, cy - 13, 16, 16))
			cx += 16 + 10
		if t.has("time"):
			var ts := "%ds" % int(ceil(float(t.time)))
			S.text(self, bold, Vector2(cx, cy), ts, 14, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
			cx += S.text_width(bold, ts, 14) + 3
			S.draw_icon(self, "t_time", Rect2(cx, cy - 13, 16, 16))
	if not gain.is_empty():
		cy += 20
		S.text(self, sans, Vector2(lx, cy), "Gives:", 14, S.INK, HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
		var gx := lx + S.text_width(sans, "Gives:", 14) + 6
		for k in gain:
			var v := str(int(gain[k]))
			S.text(self, bold, Vector2(gx, cy), v, 14, Color("#9ef58a"), HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)
			gx += S.text_width(bold, v, 14) + 3
			S.draw_icon(self, k, Rect2(gx, cy - 13, 16, 16))
			gx += 26
	cy += 4
	for row in rows:
		cy += row[4]
		S.text(self, row[1], Vector2(lx, cy), row[0], row[2], row[3], HORIZONTAL_ALIGNMENT_LEFT, -1, 0.6)

func _draw_result() -> void:
	var res: Dictionary = ui.result
	if res.is_empty():
		return
	var full := Rect2(Vector2.ZERO, size)
	draw_rect(full, Color(4 / 255.0, 17 / 255.0, 22 / 255.0, 0.5))
	var won: bool = res.won
	var r := Rect2(W() * 0.5 - 220, H() * 0.5 - 110, 440, 200)
	S.drop_shadow(self, r, 6, 18, 0.5)
	S.radial_box(self, r, [[0.0, Color(22 / 255.0, 70 / 255.0, 82 / 255.0, 0.97)], [0.48, Color(11 / 255.0, 40 / 255.0, 48 / 255.0, 0.97)], [1.0, Color(5 / 255.0, 22 / 255.0, 28 / 255.0, 0.98)]], Vector2(0.5, 0.0))
	S.metal_border(self, r, 3)
	draw_rect(r.grow(-3), S.DARK, false, 1.0)
	draw_rect(r.grow(-4), Color(216 / 255.0, 180 / 255.0, 108 / 255.0, 0.55), false, 1.0)
	S.boss(self, r.position + Vector2(-2, -2), 7)
	S.boss(self, Vector2(r.end.x + 2, r.position.y - 2), 7)
	S.text(self, S.font("bold"), Vector2(r.position.x, r.position.y + 38), res.kicker, 14, S.MUTED, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.8, 0.6)
	S.text(self, S.font("black"), Vector2(r.position.x, r.position.y + 96), "VICTORY" if won else "DEFEAT", 48, S.GOLD if won else S.INK, HORIZONTAL_ALIGNMENT_CENTER, r.size.x, 0.9, 5.0)
	S.text(self, S.font("bold"), Vector2(r.position.x, r.position.y + 126), res.text, 17, S.INK, HORIZONTAL_ALIGNMENT_CENTER, r.size.x)
	# Play Again (the same match) and Main Menu
	for b in [["restart", "PLAY AGAIN", -190.0], ["to_menu", "MAIN MENU", 10.0]]:
		var br := Rect2(r.get_center().x + float(b[2]), r.end.y - 58, 180, 38)
		S.cell(self, br, [[0.0, Color("#2d7489") if ui.hover_id == b[0] else Color("#1e5363")], [0.7, Color("#0a232b")], [1.0, Color("#051216")]], Vector2(0.5, 0.35))
		S.text(self, S.font("title"), Vector2(br.position.x, br.position.y + 25), b[1], 16, Color("#fff4dc"), HORIZONTAL_ALIGNMENT_CENTER, br.size.x, 0.85, 1.5)
		zone(br, b[0])
