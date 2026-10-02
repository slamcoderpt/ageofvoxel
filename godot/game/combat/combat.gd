extends Node3D
## Combat renderer (the visual half of src/combat: Projectiles.js render,
## Overlays.js health bars, BattleFX.js sparks / dust, core/fx/Particles.js
## chips, Debris.js dropped gear).
##
## All instance data comes from this frame's AovUnitView.update() result,
## which the units piece keeps in `game.pieces.units.last` (computed in C++,
## native/src/unit_view.cpp): arrows in flight and stuck in the ground with
## their streaks, health bars over the badly hurt, hit sparks, dust puffs and
## chips from the sim's unit:damaged / entity:died events (closed form per
## event, so a capture after a fast-forward shows the ones still alive), and
## the battle scene's dropped shields, helmets and spears plus the gear the
## dead let fall, and the ground scars (churned earth and blood per terrain
## column, from the scene, every blow and death and the melee scuffs). One MultiMesh per kind, no per-entity script work.
##
## The simulation half (attack orders, targeting, damage, projectiles, death,
## Town Center arrows, battle lines, enemy AI) is C++: native/src/sim/combat.

const Units := preload("res://game/units/units.gd")
const DROP_MODELS := ["debris_shield", "debris_helmet", "debris_spear", "debris_stub"]

var game: Node = null
var _arrow_mm: MultiMesh
var _streak_mm: MultiMesh
var _bar_mm: MultiMesh
var _spark_mm: MultiMesh
var _dust_mm: MultiMesh
var _chip_mm: MultiMesh
var _drop_mms: Array[MultiMesh] = []
var _bar_mat: ShaderMaterial
var _scar_mm: MultiMesh
var _tower_fire: Node3D = null   # tower_fire.gd: loose flashes, arrow glints, strikes of tower arrows

func _add(mesh: Mesh, mat: Material, name_: String, shadows: bool, aabb: AABB) -> MultiMesh:
	var mm := Units.make_mm(mesh, aabb)
	var mmi := MultiMeshInstance3D.new()
	mmi.name = name_
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mmi)
	return mm

func _shader(path: String, priority := 0) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = load(path)
	m.render_priority = priority
	return m

func setup(g: Node) -> void:
	game = g
	var size := float(game.sim.get_map_size())
	var aabb := AABB(Vector3(-16, -40, -16), Vector3(size + 32, 160, size + 32))
	var vox := VoxelModels.team_material(Color.WHITE, true)
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var cell := PlaneMesh.new()
	cell.size = Vector2(0.5, 0.5)
	_scar_mm = _add(cell, _shader("res://game/combat/scar.gdshader"), "Scars", false, aabb)
	_arrow_mm = _add(VoxelModels.mesh("combat", "arrow"), vox, "Arrows", true, aabb)
	for k in DROP_MODELS:
		_drop_mms.append(_add(VoxelModels.mesh("combat", k), vox, "Debris_" + k, true, aabb))
	_dust_mm = _add(quad, _shader("res://game/combat/dust.gdshader", 1), "Dust", false, aabb)
	_chip_mm = _add(quad, _shader("res://game/combat/chip.gdshader", 2), "Chips", false, aabb)
	_streak_mm = _add(quad, _shader("res://game/combat/streak.gdshader", 3), "ArrowStreaks", false, aabb)
	_spark_mm = _add(quad, _shader("res://game/combat/spark.gdshader", 4), "Sparks", false, aabb)
	_bar_mat = _shader("res://game/combat/health_bar.gdshader", 10)
	_bar_mm = _add(quad, _bar_mat, "HealthBars", false, aabb)
	_tower_fire = preload("res://game/combat/tower_fire.gd").new()
	_tower_fire.name = "TowerFire"
	add_child(_tower_fire)
	_tower_fire.setup(game)

func frame(_dt: float, _alpha: float) -> void:
	_tower_fire.frame(_dt, _alpha)
	var units = game.pieces.get("units")
	if units == null or units.last.is_empty():
		return
	var d: Dictionary = units.last
	# 7 px at 1080p (Overlays.resize)
	var h := float(get_viewport().get_visible_rect().size.y)
	_bar_mat.set_shader_parameter("bar_px", roundf(clampf(h / 1080.0 * 7.0, 6.0, 12.0)))
	if d.scars_changed:
		Units.upload(_scar_mm, d.scars, d.scar_count)
	Units.upload(_arrow_mm, d.arrows, d.arrow_count)
	Units.upload(_streak_mm, d.streaks, d.streak_count)
	Units.upload(_bar_mm, d.bars, d.bar_count)
	Units.upload(_spark_mm, d.sparks, d.spark_count)
	Units.upload(_dust_mm, d.dust, d.dust_count)
	Units.upload(_chip_mm, d.chips, d.chip_count)
	var drops: Array = d.drops
	var dc: PackedInt32Array = d.drop_counts
	for i in _drop_mms.size():
		Units.upload(_drop_mms[i], drops[i], dc[i])
