class_name AovCameraRig
extends Camera3D
## High 3/4 RTS camera: port of src/core/CameraController.js with the same
## parameters (vertical fov 34, near 0.5, far 900, target / distance / pitch /
## yaw), so a view set with the JS numbers frames the same ground.

var target := Vector3(64, 0, 64)
var distance := 42.0
var min_dist := 14.0
var max_dist := 110.0
var pitch := deg_to_rad(52.0)
var yaw := deg_to_rad(45.0)
var pan_speed := 1.0
var edge_scroll := true
var user_control := true
var sim: Object = null  # AovSim, for smooth_height_at / map size

var _drag := false

func _ready() -> void:
	fov = 34.0
	keep_aspect = Camera3D.KEEP_HEIGHT
	near = 0.5
	far = 900.0
	apply()

## Angles in degrees, like CameraController.setView.
func set_view(v: Dictionary) -> void:
	if v.has("x"): target.x = float(v.x)
	if v.has("z"): target.z = float(v.z)
	if v.has("distance"): distance = float(v.distance)
	if v.has("pitch"): pitch = deg_to_rad(float(v.pitch))
	if v.has("yaw"): yaw = deg_to_rad(float(v.yaw))
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
			_drag = e.pressed
		elif e.pressed and e.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = clampf(distance * exp(-120 * 0.0012), min_dist, max_dist)
		elif e.pressed and e.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = clampf(distance * exp(120 * 0.0012), min_dist, max_dist)
	elif e is InputEventMouseMotion and _drag:
		pan_screen(-e.relative.x * distance * 0.0022, -e.relative.y * distance * 0.0032)

func _process(dt: float) -> void:
	if user_control:
		var sp := distance * 1.1 * dt * pan_speed
		var r := 0.0
		var f := 0.0
		if Input.is_key_pressed(KEY_UP): f += sp
		if Input.is_key_pressed(KEY_DOWN): f -= sp
		if Input.is_key_pressed(KEY_RIGHT): r += sp
		if Input.is_key_pressed(KEY_LEFT): r -= sp
		if edge_scroll and DisplayServer.window_is_focused():
			var m := get_viewport().get_mouse_position()
			var s := get_viewport().get_visible_rect().size
			if m.x <= 6: r -= sp
			if m.x >= s.x - 6: r += sp
			if m.y <= 6: f += sp
			if m.y >= s.y - 6: f -= sp
		if r != 0.0 or f != 0.0:
			pan_screen(r, f)
	apply()

func apply() -> void:
	if sim:
		var ws := float(sim.get_map_size())
		target.x = clampf(target.x, 0, ws)
		target.z = clampf(target.z, 0, ws)
		target.y = sim.smooth_height_at(target.x, target.z)
	var h := cos(pitch) * distance
	position = Vector3(target.x + sin(yaw) * h, target.y + sin(pitch) * distance, target.z + cos(yaw) * h)
	look_at(target, Vector3.UP)
