class_name AovCameraRig
extends Camera3D
## High 3/4 RTS camera: port of src/core/CameraController.js with the same
## parameters (vertical fov 34, near 0.5, far 900, target / distance / pitch /
## yaw), so a view set with the JS numbers frames the same ground.
##
## Controls (README "Camera"): arrows / edge scroll / middle-drag pan, the
## wheel zooms (eased towards the goal distance), and, Godot-only, the view
## turns: Alt or Ctrl + middle-drag (yaw, and pitch 30..70 deg), `[` / `]`
## held, Home resets the yaw / pitch to the scene's. The fog-of-war pass
## (AovFogView) hangs under the camera.

var target := Vector3(64, 0, 64)
var distance := 42.0
var min_dist := 14.0
var max_dist := 110.0
var pitch := deg_to_rad(52.0)
var yaw := deg_to_rad(45.0)
var pan_speed := 1.0
var edge_scroll := true
# Web: no edge scroll until the pointer is over the canvas (the browser reports
# (0, 0) before the first mouse event, and keeps the last position after it leaves).
var _mouse_in := not OS.has_feature("web")
var user_control := true
var sim: Object = null  # AovSim, for smooth_height_at / map size

var _drag := false
var _turn := false
var zoom_goal := -1.0    # eased wheel zoom target (distance), -1: none
var home_pitch := deg_to_rad(52.0)
var home_yaw := deg_to_rad(45.0)
var fog_view: Node  # AovFogView (game/core/fog_view.gd)

func _ready() -> void:
	fov = 34.0
	keep_aspect = Camera3D.KEEP_HEIGHT
	near = 0.5
	far = 900.0
	if sim and DisplayServer.get_name() != "headless":
		fog_view = preload("res://game/core/fog_view.gd").new(sim, self)
		add_child(fog_view)
	apply()

## Angles in degrees, like CameraController.setView.
func set_view(v: Dictionary) -> void:
	if v.has("x"): target.x = float(v.x)
	if v.has("z"): target.z = float(v.z)
	if v.has("distance"): distance = float(v.distance)
	if v.has("pitch"): pitch = deg_to_rad(float(v.pitch))
	if v.has("yaw"): yaw = deg_to_rad(float(v.yaw))
	if v.has("pitch") or v.has("yaw"):
		home_pitch = pitch
		home_yaw = yaw
	zoom_goal = -1.0
	apply()

func pan_screen(right: float, forward: float) -> void:
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var rx := cos(yaw)
	var rz := -sin(yaw)
	target.x += rx * right + fx * forward
	target.z += rz * right + fz * forward

func _unhandled_input(e: InputEvent) -> void:
	if not user_control:
		return
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_MIDDLE:
			_turn = e.pressed and (e.alt_pressed or e.ctrl_pressed)
			_drag = e.pressed and not _turn
		elif e.pressed and (e.button_index == MOUSE_BUTTON_WHEEL_UP or e.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			# JS: distance *= exp(wheelDelta * 0.0012), one notch = 120 (x factor for trackpads)
			var notch: float = (-120.0 if e.button_index == MOUSE_BUTTON_WHEEL_UP else 120.0) * (e.factor if e.factor > 0.0 else 1.0)
			var from: float = zoom_goal if zoom_goal > 0.0 else distance
			zoom_goal = clampf(from * exp(notch * 0.0012), min_dist, max_dist)
	elif e is InputEventMouseMotion and _turn:
		yaw = wrapf(yaw - e.relative.x * 0.006, -PI, PI)
		pitch = clampf(pitch + e.relative.y * 0.004, deg_to_rad(30.0), deg_to_rad(70.0))
	elif e is InputEventMouseMotion and _drag:
		pan_screen(-e.relative.x * distance * 0.0022, -e.relative.y * distance * 0.0032)
	elif e is InputEventKey and e.pressed and not e.echo and e.keycode == KEY_HOME:
		yaw = home_yaw
		pitch = home_pitch

func _notification(what: int) -> void:
	if OS.has_feature("web") and (what == NOTIFICATION_WM_MOUSE_ENTER or what == NOTIFICATION_WM_MOUSE_EXIT):
		_mouse_in = what == NOTIFICATION_WM_MOUSE_ENTER

func _process(dt: float) -> void:
	if user_control:
		var sp := distance * 1.1 * dt * pan_speed
		var r := 0.0
		var f := 0.0
		if Input.is_key_pressed(KEY_UP): f += sp
		if Input.is_key_pressed(KEY_DOWN): f -= sp
		if Input.is_key_pressed(KEY_RIGHT): r += sp
		if Input.is_key_pressed(KEY_LEFT): r -= sp
		if edge_scroll and _mouse_in and DisplayServer.window_is_focused():
			var m := get_viewport().get_mouse_position()
			var s := get_viewport().get_visible_rect().size
			if m.x <= 6: r -= sp
			if m.x >= s.x - 6: r += sp
			if m.y <= 6: f += sp
			if m.y >= s.y - 6: f -= sp
		if r != 0.0 or f != 0.0:
			pan_screen(r, f)
		var turn := 0.0
		if Input.is_key_pressed(KEY_BRACKETLEFT): turn += 1.0
		if Input.is_key_pressed(KEY_BRACKETRIGHT): turn -= 1.0
		if turn != 0.0:
			yaw = wrapf(yaw + turn * 1.6 * dt, -PI, PI)
		if zoom_goal > 0.0:
			distance = lerpf(distance, zoom_goal, 1.0 - exp(-14.0 * dt))
			if absf(distance - zoom_goal) < 0.01:
				distance = zoom_goal
				zoom_goal = -1.0
	apply()
	if fog_view:
		fog_view.update()

func apply() -> void:
	if sim:
		var ws := float(sim.get_map_size())
		target.x = clampf(target.x, 0, ws)
		target.z = clampf(target.z, 0, ws)
		target.y = sim.smooth_height_at(target.x, target.z)
	var h := cos(pitch) * distance
	position = Vector3(target.x + sin(yaw) * h, target.y + sin(pitch) * distance, target.z + cos(yaw) * h)
	look_at(target, Vector3.UP)
