extends SceneTree
## Check of the capture guard in game/main.gd _capture() (PORTING.md "Capture
## guard"). Two parts:
##
##   1. capture_verdict() rules, headless: a clean frame is saved with exit 0;
##      a sheared frame (v/h gradient > 1.6) is NOT saved and exits 3; a blank
##      frame is saved and exits 3, whatever --width says; a size mismatch with
##      --width/--height is only a warning and never hides the blank or shear
##      verdicts. fake_shear() of a real-looking image scores > 1.6 and the
##      original < 1.6.
##   2. end to end (unless --no-e2e): real captures under xvfb + lavapipe of the
##      "town" scene to one --out path: a clean shot (exit 0, PNG written), then
##      --capture_fake=shear to the same path (exit 3, the good PNG is byte for
##      byte untouched, no temp file left), --capture_fake=crop (a frame smaller
##      than --width/--height: one AOV_CAPTURE_WARN, exit 0), then
##      --capture_fake=blank,crop (blank AND the wrong size: exit 3, not 0).
##
##   godot --headless --path godot -s res://game/core/capture_guard_check.gd
##
## Prints "CAPGUARD PASS|FAIL <case>" and exits with the number of failures.

const Main := preload("res://game/main.gd")
var fails := 0

func ok(name: String, cond: bool, detail := "") -> void:
	print("CAPGUARD %s %s %s" % ["PASS" if cond else "FAIL", name, detail])
	if not cond:
		fails += 1

func _initialize() -> void:
	verdicts()
	shear_metric()
	var user := OS.get_cmdline_user_args()
	if not user.has("--no-e2e"):
		e2e()
	print("CAPGUARD_RESULT %s" % JSON.stringify({"fails": fails}))
	quit(fails)

func verdicts() -> void:
	var v: Dictionary = Main.capture_verdict(1.0, 120.0, 40.0, 1280, 720, 1280, 720)
	ok("clean.saved_exit0", v.save and v.code == 0 and v.errors.is_empty() and v.warnings.is_empty(), str(v))
	v = Main.capture_verdict(2.3, 120.0, 40.0, 1280, 720, 1280, 720)
	ok("sheared.not_saved_exit3", not v.save and v.code == 3, str(v))
	v = Main.capture_verdict(2.3, 120.0, 40.0, 1420, 798, 1280, 720)
	ok("sheared+size.not_saved_exit3_warned", not v.save and v.code == 3 and v.warnings.size() == 1, str(v))
	v = Main.capture_verdict(1.0, 2.0, 1.0, 1280, 720, 1280, 720)
	ok("blank.exit3", v.code == 3 and v.save, str(v))
	v = Main.capture_verdict(1.0, 2.0, 1.0, 1420, 798, 1280, 720)
	ok("blank+size.exit3_not0", v.code == 3 and v.warnings.size() == 1, str(v))
	v = Main.capture_verdict(1.0, 120.0, 40.0, 1420, 798, 1280, 720)
	ok("size_only.warn_exit0", v.code == 0 and v.save and v.warnings.size() == 1, str(v))
	v = Main.capture_verdict(1.0, 120.0, 40.0, 1420, 798, -1, -1)
	ok("no_width_arg.no_warn", v.code == 0 and v.warnings.is_empty(), str(v))

func shear_metric() -> void:
	# a deterministic "scene": soft gradients plus blocky detail, like a frame
	var img := Image.create(320, 180, false, Image.FORMAT_RGB8)
	for y in 180:
		for x in 320:
			var b := 0.35 + 0.25 * sin(x * 0.05) * cos(y * 0.07)
			if ((x / 12) + (y / 9)) % 5 == 0:
				b += 0.3
			img.set_pixel(x, y, Color(b, b * 0.9, b * 0.7))
	var r0: float = Main.shear_ratio(img)
	var r1: float = Main.shear_ratio(Main.fake_shear(img, 4))
	ok("shear_ratio.real_below", r0 < Main.SHEAR_MAX, "%.2f" % r0)
	ok("shear_ratio.sheared_above", r1 > Main.SHEAR_MAX, "%.2f" % r1)

func shoot(out: String, extra: Array, warned := []) -> int:
	var godot := OS.get_executable_path()
	var path := ProjectSettings.globalize_path("res://")
	var argv := ["-a", "-s", "-screen 0 640x360x24", godot, "--path", path, "--rendering-driver", "vulkan",
		"--audio-driver", "Dummy", "--resolution", "640x360", "--", "--scene=town", "--out=" + out,
		"--frames=4", "--quit"]
	argv.append_array(extra)
	var log := []
	OS.set_environment("VK_ICD_FILENAMES", "/usr/share/vulkan/icd.d/lvp_icd.json")
	var code := OS.execute("xvfb-run", PackedStringArray(argv), log, true)
	for l in str(log[0] if log.size() else "").split("\n"):
		if l.begins_with("AOV_CAPTURE") or l.contains("capture looks"):
			print("    ", l.strip_edges())
		if l.begins_with("AOV_CAPTURE_WARN"):
			warned.append(l.strip_edges())
	return code

func e2e() -> void:
	var dir := OS.get_cache_dir().path_join("aov_capguard_%d" % OS.get_process_id())
	DirAccess.make_dir_recursive_absolute(dir)
	var out := dir.path_join("shot.png")
	var c := shoot(out, ["--width=640", "--height=360"])
	ok("e2e.clean_exit0_written", c == 0 and FileAccess.file_exists(out), "exit %d" % c)
	var good := FileAccess.get_file_as_bytes(out)
	c = shoot(out, ["--width=640", "--height=360", "--capture_fake=shear"])
	var after := FileAccess.get_file_as_bytes(out)
	ok("e2e.sheared_exit3", c == 3, "exit %d" % c)
	ok("e2e.sheared_kept_good_png", good.size() > 0 and after == good, "%d -> %d bytes" % [good.size(), after.size()])
	var leftovers := Array(DirAccess.get_files_at(dir)).filter(func(f): return f.ends_with(".tmp.png"))
	ok("e2e.no_temp_left", leftovers.is_empty(), str(leftovers))
	var warned := []
	c = shoot(out, ["--width=640", "--height=360", "--capture_fake=crop"], warned)
	ok("e2e.size_mismatch_warns_exit0", c == 0 and warned.size() == 1, "exit %d, %s" % [c, warned])
	warned = []
	c = shoot(out, ["--width=640", "--height=360", "--capture_fake=blank,crop"], warned)
	ok("e2e.blank_wrong_size_exit3", c == 3 and warned.size() == 1, "exit %d, %s" % [c, warned])
	for f in DirAccess.get_files_at(dir):
		DirAccess.remove_absolute(dir.path_join(f))
	DirAccess.remove_absolute(dir)
