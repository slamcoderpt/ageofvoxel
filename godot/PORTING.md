# Age of Voxel: Godot 4 port (shared contract)

The browser build (`src/`, Vite + Three.js, see `../ARCHITECTURE.md`) stays in
the repo untouched as the reference. This directory is the Godot 4.5.1 port
(Forward+), targeting Windows, macOS, Linux and web. Read this file before you
change anything here, and keep it accurate when you change something it
describes.

## Decisions (fixed by the lead)

- **Simulation in C++** (GDExtension in `native/`, godot-cpp 4.5): everything
  the JS does in `update()` at the fixed 30 Hz tick, deterministic, seeded RNG.
  C# cannot export to web in Godot 4, and GDScript is too slow for 2000 units.
- **Rendering, animation, effects, input and UI in GDScript + shaders**
  (`game/`), reading sim state through packed arrays once per frame.
- Sim code under `native/src/sim/` is plain C++17 with **no Godot includes**.
  `native/src/aov_sim.{h,cpp}` (class `AovSim`) is the only binding layer:
  thin getters that copy sim state into `PackedFloat32Array` /
  `PackedInt32Array` / `PackedByteArray`, and commands that forward to the sim.

## Layout and ownership

One directory per piece, mirroring the JS pieces (`src/<piece>/`). Only edit
your own directories; use other pieces' public API (documented at the top of
their main file) or ask their owner. Shared code is in `game/core/` and
`native/src/sim/core/` (owner: foundation).

| Piece | GDScript (render / UI) | C++ sim (`native/src/sim/…`) | JS reference |
|---|---|---|---|
| core (foundation) | `game/main.gd`, `game/core/` (args, scenes, camera, model loader, voxel shader, bench, sim_debug, simcheck) | `core/` (constants, rng, jsmath, game_map, entities, players, events, spatial_hash, pathfinding, movement, commands, profile, fog, victory), `sim.{h,cpp}` | `src/core/` |
| terrain | `game/terrain/terrain.gd` + `terrain.gdshader` (chunks, paving cobbles / pale stone of MaterialPatches patchGround), `water.gdshader` (Water.js), `props.gdshader` (voxel.gdshader + MultiMesh instance tint, used by trees / gold / berries / ground details); mesher in `native/src/terrain_mesher.cpp` (TerrainMesh.js full port, water depth bake, GroundDetails.js scatter) | map edits live in `core/game_map`; resource nodes `Sim::spawn_resource` | `src/terrain/` |
| lighting | `game/lighting/lighting.gd` (sun + PCSS soft shadows, hemisphere = ambient colour + two unshadowed up/down lights, fill, depth haze following the camera, SSAO, MSAA, `--quality=high\|medium\|low`, `--post=high\|low\|off`), `grade_effect.gd` (CompositorEffect compute pass on the HDR buffer: exposure 2.1 + PBR Neutral + the PostFX.js grade; Godot's tonemap is LINEAR; Compatibility/web falls back to AgX), `sky.gdshader`. MaterialPatches.js canopy / foliage terms not ported yet | none | `src/lighting/` |
| buildings | `game/buildings/buildings.gd` (models, construction stages, house yaw, fog visibility), `town_props.gd` (props.js: town dressing, one MultiMesh per prop kind) | `buildings/` (defs, spawn + ground dressing, placement, construction, destroy, town.js: ported) | `src/buildings/` |
| units | `game/units/units.gd` (rigs posed by the full anim.js port, conditional parts, crowd yaw / press / jitter, deaths and corpses, contact shadows), `unit.gdshader` (team lift + rim, hit flash, corpse drain, dithered fade) + `unit_outline.gdshader` (inverted hull, next pass); posing in C++: `native/src/unit_view.cpp` (`AovUnitView`) | `units/` (defs, spawn, anim state, spread: ported) | `src/units/` |
| combat (incl. enemy AI) | `game/combat/combat.gd` (arrows + streaks + stuck arrows, health bars, hit sparks / flash, dust, chips, ground scars, dropped gear; shaders in `game/combat/`), all instance data from `AovUnitView` (via `pieces.units.last`) | `combat/` (combat.cpp: attack order, targeting, damage, projectiles, death, Town Center arrows, phalanx lines; enemy_ai.cpp: ported) | `src/combat/` |
| economy | `game/economy/economy.gd` (EconomyView: animals, spears, boats, shoals, crops, stockpiles, loads, decor; Godot-only activity fx: axe / pick chips and dust, sickle chaff, stooks on cut rows, hoof dust, shoal ripples, fish splashes, net ripples, boat wakes; crops sway, `econ_voxel.gdshader`, `fx_chip / fx_puff / fx_ring.gdshader`), buffers built in C++ by `AovEconView` (`native/src/econ_view.{h,cpp}`, render side, reads the sim, never writes it) | `economy/` (gathering, farms, hunting, fishing, worship, training, age: ported) | `src/economy/` |
| godpowers | `game/godpowers/godpowers.gd` (not written yet: bolts, storm funnel, scorches, debris) | `godpowers/` (favor, cooldowns, Lightning Storm, Bolt, Meteor, thrown units: ported) | `src/godpowers/` |
| ui (HUD, selection, input) | `game/ui/ui.gd` | none | `src/ui/` |
| scenes | `AovScenes.set_setup()` from the owning piece, else the C++ setup | `scenes/` (helpers.js, skirmish / town / coast / hud, EconomyScene.js; battle.cpp: BattleScene.js + units/battleHost.js, godpower, stress.js: all ported) | `src/core/scenes/`, `BattleScene.js`, `EconomyScene.js` |

```
godot/
  project.godot            Forward+, 1920x1080, main scene game/main.tscn
  PORTING.md               this file
  game/main.tscn|gd        entry: args, sim, pieces, loop, capture, bench
  game/core/               args.gd, scenes.gd, camera_rig.gd, voxel_models.gd,
                           voxel.gdshader, bench.gd, model_gallery.gd
  game/<piece>/<piece>.gd  one node per piece (see "Piece contract")
  assets/models/           exported voxel models (generated, committed)
  native/SConstruct        builds bin/libaov.<platform>.<target>.<arch>.so|dll|…
  native/aov.gdextension   entry symbol aov_library_init
  native/godot-cpp/        git submodule, tag godot-4.5-stable
  native/src/              register_types.cpp, aov_sim.{h,cpp}, sim/…
```

Git does not keep empty directories: create yours when you add its first file.

## Build

```
git submodule update --init godot/native/godot-cpp     # CI / fresh clone
cd godot/native && scons -j2                           # linux, template_debug
scons -j2 target=template_release                      # release build
```

`SConstruct` links the prebuilt `godot-cpp/bin/libgodot-cpp.<platform>.<target>.*`
when it exists (`build_library=no`), so only our sources compile (a few
seconds). A fresh clone has no prebuilt library and builds it (~1700 files,
tens of minutes on 2 cores); `build_library=yes` forces that. In this
container the submodule checkout is hard-linked from `/opt/godot-cpp` (already
built): do not rebuild it. Use `-j2`: the machine is shared.

The sim is compiled with `-ffp-contract=off` (MSVC `/fp:precise`): no FMA
contraction, never `-ffast-math`, or it stops matching the browser.

Web: the extension must be built with emscripten (`platform=web`, dlink) and
exported with "Extensions Support" on; not set up yet.

**Godot only loads a GDExtension listed in `.godot/extension_list.cfg`**,
which an import writes. After a fresh clone (or if `AovSim` is missing):

```
godot --headless --path godot --import     # may print a crash on first run; the cache is written anyway
```

`scripts/godot-shoot.mjs` does this automatically when the file is missing.
`.godot/` is never committed.

## Run, capture, bench

The main scene reads user args after `--`, mirroring the browser URL params:

```
godot --path godot -- --scene=town [--seed=N] [--mapsize=N] [--units=N] [--players=2..6]
      [--live=0|1] [--hud=0|1] [--fog=0|1] [--timescale=N] [--cam=x,z[,dist[,pitch[,yaw]]]]
      [--width=W --height=H] [--out=shots/town.png] [--frames=N] [--quit] [--timeout=S]
```

- `--out`: after `--frames` rendered frames (default 4, like `main.js`) save
  the viewport as PNG, print `AOV_CAPTURE {json}` and quit (exit 3 if the frame
  is blank: mean < 8 or std < 4 over a 160x90 downscale, as `shoot.mjs`).
- `--quit`: same without saving. A watchdog quits (exit 4) after `--timeout`
  seconds (default 600) so a script error never hangs a capture.
- Scenes: `skirmish town battle godpower coast economy hud stress` (same
  presets, seeds, map sizes and cameras as the JS registry) and the Godot-only
  `models` (every exported model on one strip). Like main.js, main.gd turns
  the ENEMY AI and Victory on per scene (`ai`, `victory`) before the setup,
  sets the fog (`reveal_all`, `--fog`) after it, and pauses when the match is
  decided (`AovSim.is_paused()`). `--units=N` reaches the C++ setup through
  `setup_scene(name, {units})`.

Capture (xvfb + lavapipe software Vulkan; there is no GPU here):

```
node scripts/godot-shoot.mjs --scene town --out shots/godot/town.png [--width 1920 --height 1080]
     [--seed N] [--params "units=500&cam=64,64,30"] [--frames 4] [--timeout 300] [--verbose]
```

It runs `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s
"-screen 0 WxHx24" godot --path godot --rendering-driver vulkan --audio-driver
Dummy --resolution WxH -- …`, and exits non-zero on a GDScript / engine error,
a missing extension, a timeout or a blank frame. Compare with
`reference/browser/<scene>.png` (same scene, seed and camera).

Bench (headless, sim only):

```
node scripts/godot-stress.mjs [--units 250,500,1000,2000,3000,4000] [--ticks 600] [--warmup 150] [--json out.json]
godot --headless --path godot -- --scene=stress --units=2000 --bench --ticks=600 --warmup=150 --json=/tmp/b.json
```

`godot-stress.mjs` prints exactly the tables of `scripts/stress.mjs` (its
summarize/print code is copied unchanged), fed by `game/core/bench.gd`, which
runs the scene setup (C++ `setup_scene("stress", {units})`, fog on for player
1, the ENEMY AI on as in main.js), then the same protocol as stress.mjs:
`--warmup` ticks, `--ticks` recorded ticks with the profiler on
(`AovSim.get_profile()`: `{total, sys:{name:ms}, sub:{}, ai:{player:ms},
calls:{name:[n, ms]}, callsBy:{"findPath@combat":[n, ms]}}`, `get_stats()`:
`{alive, dead, moving, buildings, projectiles}`), then 60 ticks of spatial-hash
census (per tick). `Sim::tick` runs each system of the JS `game.simOrder`
(economy, buildings, combat, godpowers, units, movement, fog, victory) under
its name; **sim pieces must fill the rest**: sub-steps under `prof.sub`
(`ScopedTimer`), AI players under `prof.ai` (inside combat, like the JS),
counted calls with `CallTimer ct(&sim->prof, "findPath");` (fills `calls` and
`callsBy` with the running system).

Result on this container (Xeon 2.1 GHz, shared, `template_debug` build, seed 23,
6 players, 600 recorded ticks), next to the browser's in `docs/stress-report.md`:

| N | 250 | 500 | 1000 | 2000 | 3000 | 4000 |
|---|---:|---:|---:|---:|---:|---:|
| Godot C++ sim, mean ms/tick | 0.14 | 0.26 | 0.63 | **1.30** | 2.12 | 3.38 |
| Godot C++ sim, p95 | 0.22 | 0.37 | 0.82 | **2.06** | 3.43 | 5.28 |
| browser JS sim, mean (report) | 2.4 | 3.3 | 7.6 | **15.0** | 25.2 | 40.7 |

At 2000 units: movement 0.47, units 0.44 (spread 0.40), combat 0.26 (AI of
all 6 players 0.01), economy 0.10, fog 0.03 ms/tick; `findPath` 183 calls/tick
(172 from combat, exactly the browser's counts: the two sims run the same
game), 0.14 ms/tick; 16.7 neighbours visited per hash query.

Other tools:

```
node scripts/check-mapgen.mjs            # C++ vs JS generateMap() for every scene's seed/preset: heights, ground,
                                         # passability, walkable after resources, resources, starts (all "ok")
node scripts/check-sim.mjs [--only a,b]  # C++ sim vs the JS modules: scenarios (skirmish 3, town 7, battle 19, coast 5,
                                         # stress 2000 and 4200 units; the town / economy / coast / hud / battle /
                                         # godpower / stress scene setups, econ-ops: placement, training, age, destroy,
                                         # skirmish-ai: 5 min of the enemy AI, combat-ops: attack orders, Town Center
                                         # arrows, every god power) spawn, order, step up to 9000 ticks and compare
                                         # every unit, player, building, resource, arrow in flight, thrown unit and AI
                                         # wave state bit for bit at every checkpoint (all "ok"); ~10 min. The JS side
                                         # runs the real Combat / EnemyAI / GodPowers / Victory without their renderers
node scripts/export-models.mjs           # re-export godot/assets/models from the JS model code (~5 s)
godot --headless --path godot -s res://game/core/simcheck.gd -- --mapdump=F | --scenario=F --out=F   # their C++ side
```

Sim debug view: `--simdebug=1` draws every unit as a box in its owner's
colour (off by default now that `game/units/units.gd` exists);
`--simdemo=1 [--simdemo_t=7]` spawns two armies at the first two starts and
marches them onto each other, e.g.
`node scripts/godot-shoot.mjs --scene skirmish --params "simdemo=1"`.

## Conventions

- **World units**: 1 tile = 1 world unit, terrain voxel `VOXEL = 0.5` (2x2
  columns per tile), map heights in voxel levels (`y = level * 0.5`), water
  surface at `(waterLevel - 0.3) * 0.5`. Buildings use 0.25 voxels, units
  0.07-0.15 (per rig), trees/props 0.18. Y up, same axes as Three.js (both
  right-handed, Y up, -Z forward), so JS positions and rotations carry over
  unchanged. Unit facing is +z at rot 0, like the JS.
- **Camera**: `AovCameraRig` (`game/core/camera_rig.gd`) is
  `CameraController.js`: vertical fov 34, near 0.5, far 900, target / distance /
  pitch / yaw in the same units; `set_view({x, z, distance, pitch, yaw})` takes
  degrees like `setView`. Scene cameras in `game/core/scenes.gd` use the JS
  numbers, so captures line up with `reference/browser/<scene>.png`. Where a JS
  camera is relative to the setup's focus (`ctx.focus`), the scene setup must
  return `{"focus": Vector2(x, z)}`; until it exists the focus falls back to
  player 1's start tile centre.
- **Determinism**: sim randomness only from the sim's seeded `aov::RNG`
  (mulberry32, bit-exact with `src/core/rng.js`, including `hash2/hash3` and
  `Noise2D`); visual randomness from hashes. Port JS arithmetic faithfully:
  doubles, `Math.round` = `aov::js_round` (floor(x + 0.5)), `| 0` =
  `aov::js_int32`, Float32Array values stored as `float`, and **the JS Math
  functions from `core/jsmath.h`**: `jsm::atan2 / sin / cos / atan` (V8's
  fdlibm) and `jsm::hypot` (V8's scaled sum). glibc's differ in the last bit
  for 3-17 % of inputs, enough to make a battle drift. Iterate entities in
  row order (= id order = JS Map order). `generate_map` and the whole core
  (entities, units update / spread, pathfinding, movement, commands) are
  bit-exact with the browser (`check-mapgen.mjs`, `check-sim.mjs`); extend
  `check-sim.mjs` with your system's scenario when you port one. `Math.pow`
  (and `**`) is `jsm::pow`: V8's fdlibm pow with its own quirk, glibc's
  differs for ~10 % of inputs.
- **Entity store** (`sim/core/entities.h`): struct-of-arrays per kind
  (`entities.units / buildings / resources`), one id counter, ids never
  reused, `id_slot`/`id_kind` map an id to its row. Rows are dense in id
  order; `remove()` only flags the row (`removed`), and rows are compacted
  once per tick right before Movement rebuilds the spatial hash, so a row
  index is stable for a whole tick (the hash stores rows). Skip `removed`
  rows in loops. Pieces add per-entity fields as columns in the X-macro lists
  (`AOV_UNIT_COLUMNS` …; prefix private ones with the piece name). Orders
  live in `order_type / order_target / order_x / order_z / order_a..c`;
  register a handler per order type with `sim.commands.register_handler()`.
  Animation requests: set `units.anim_want[row]` each tick (`A_GATHER` …).
  Huntable animals (deer, boar) are resource rows too (`R_DEER` / `R_BOAR`,
  `is_animal_type()`), never blocking tiles, with a fractional rect: take a
  resource's rect as `x - w / 2, z - h / 2` (exact for every node), not
  `tx / tz`. Sim order per tick: economy, buildings, units, movement (JS
  `simOrder`; combat and godpowers slot in after buildings).
- **Paths**: `Movement::move_to(row, x, z, rect, range)` like `moveTo`;
  waypoints live in `sim.paths` (a pool, handle per unit). `Pathfinder`
  caches A* results per (start tile, goal tile, rect) while walkability is
  unchanged (`GameMap::pass_version`, bumped by `block` / passability):
  exact. Two opt-in scalers that are NOT bit-exact with the browser, off by
  default: `AovSim.set_group_paths(n)` (formation moves of >= n units share
  one Dijkstra field: 360 units into a forest 544 ms -> 30 ms) and
  `AovSim.set_repath_budget(n)` (max stuck re-paths per tick, the rest wait).
  Interactive play (the ui piece) should turn group paths on (~24);
  deterministic captures and parity checks leave them off.
- **Combat** (`sim/combat`): an attack order is `order_type = O_ATTACK`,
  `order_target` = target id, `order_x` = re-path timer, `order_a` = the
  building it switched away from, `order_b` bits `ATK_THEN_BUILDINGS` /
  `ATK_AUTO`. `combat.damage(target_id, amount, Hitter, kind)` /
  `combat.kill(id, Hitter)` are the only way to hurt or kill (never set `dead`
  yourself). The JS `u.combat_*` fields are unit columns (`combat_leash`,
  `combat_reach`, `combat_line` + `line_*`, `died_at`, `hit_time`, `stag_t` /
  `stag_k`, `melee_t`, `kit`); the corpse hold (`dieT <= 2` for 30 s after
  death) is in combat, removal in units. Visual-only JS parts (BattleFX,
  Debris, Overlays, the stagger lean, arrow streaks) belong to
  `game/combat`, fed by `get_units()` / `get_combat()`.
- **God powers** (`sim/godpowers`): thrown units carry `air_y`, `air_rx`,
  `air_rz` (exported as `get_units().air`); the units renderer lifts and
  tumbles them. Bolt channels (`boltLines(seed, …)` in effects.js), debris,
  sparks, smoke and flames are visual: `get_godpowers()` gives the seeds and
  times to draw them.
- **Sim / render split**: GDScript never mutates sim state directly; it calls
  `AovSim` commands. Per frame, pieces pull packed arrays (positions, rotations,
  anim state, hp, …) with one call each, never per entity. The sim keeps the
  previous tick's positions so renderers interpolate with `game.alpha` (1
  while paused). `AovSim.take_map_changes()` returns dirty column rects
  (cx0, cz0, cx1, cz1) since the last call (the JS `map.onChange`); only the
  terrain piece drains it. Sim events are drained once per frame by
  `main.gd` into `game.events` (an Array of Dictionaries, see below): read
  that in `frame()`, never call `take_events()` yourself.
- **Voxel models**: exported once from the JS builders by
  `scripts/export-models.mjs` into `assets/models/<group>.json` + `.bin.gz`
  (groups: units, buildings, construction, props, resources, details,
  economy, combat); never hand-edit, re-run the exporter after changing a JS
  `models.js`. Load with `VoxelModels.mesh(group, name)` (an `ArrayMesh`, cached).
  Vertex data: `CUSTOM0` = sRGB albedo with the per-voxel jitter and baked AO
  (RGBA8), `CUSTOM1.r` = team mask, `CUSTOM1.g` = glow; triangles already in
  Godot's clockwise winding. Shade with `game/core/voxel.gdshader`
  (`VoxelModels.material()` / `team_material(color, instanced)`): albedo *
  mix(1, team colour, team), emission = albedo * glow * 2.5; with
  `use_instance_team` the MultiMesh custom data is (linear team rgb, hit flash).
  Names: `units/<type>/<part>`, `buildings/<type>/<variant>`,
  `construction/<type>/<variant>/<stage 0..7>`, `props/<kind>`,
  `resources/tree0..9|gold|berry` (+ `_shape` shadow-only twins),
  `details/tuft0..4|flowers0..3|pebbles0..2`, `economy/<key>` (the
  EconomyView keys), `combat/arrow|debris_*`.
- **Unit rigs**: `VoxelModels.rig(type)` = `{voxel, anim, style, euler: "XYZ",
  parts: [{name, anim (channel), joint, parent, parentIdx, coat, portrait,
  conditional, mesh}]}`, parents first. Part world transform =
  `parent_world * Transform3D(Basis.from_euler(rot, EULER_ORDER_XYZ), joint * voxel)`
  (Godot's `EULER_ORDER_XYZ` equals Three's default `'XYZ'`, checked). Each
  part mesh is pivoted at its joint. `conditional` parts have a `show(u)` rule
  in `src/units/models.js` (tools, carried goods, gear variants) that the units
  piece reimplements.
- **Colours**: JS hex colours are sRGB; use `Color8`/`Color.hex` (sRGB) for
  material albedo and `source_color` uniforms; convert to linear for raw
  shader data (instance custom data).

## Piece contract (GDScript)

`game/main.gd` instances every existing `res://game/<piece>/<piece>.gd` in the
order `lighting, terrain, buildings, units, economy, combat, godpowers, ui`
as a child node (no edit to `main.gd` needed to add a piece), then:

- `setup(game)` once, after the sim world exists (`game.sim` is the `AovSim`,
  `game.camera` the `AovCameraRig`, `game.args` the parsed args,
  `game.scene_def` the scene entry, `game.pieces[name]` the other pieces);
- `frame(dt, alpha)` once per displayed frame, visual only.

The game loop (in `main.gd`) ticks `sim.tick(1)` at 30 Hz while not paused
(`live` scenes, or `--live=1`); a scene's `fast_forward` seconds are stepped
before the first frame. A scene setup is registered with
`AovScenes.set_setup(name, callable)` (register a **static** function: a
lambda capturing a node outlives it in the static registry and crashes the
engine at exit); it runs after all `setup()` calls and returns a ctx
Dictionary (`focus`, …). Without one, main.gd runs the C++ setup when
`AovSim.has_scene_setup(name)` (skirmish, town, coast, hud; economy
registers itself from `game/economy`), then `AovSim.scene_after(name)`
after the fast-forward (the JS `scene.after`).

## AovSim API (so far)

Lifecycle: `new_game(seed, map_size=128, preset="skirmish", players=2)`
(players Gaia / 1 "You" / 2 "Enemy", the map, the initial resources as
entities blocking their tiles), `tick(n=1)`, `get_tick()`, `get_time()`,
`get_seed()`, `version()`.

Map: `get_map_size()`, `get_map_cols()`, `get_water_level()`, `get_heights()`
(PackedInt32Array, cols*cols, row-major z then x), `get_ground()`
(PackedByteArray, `aov::Ground`), `get_passable()`, `get_walkable()`
(passable and not blocked: what A* sees), `height_at(x, z)`,
`smooth_height_at(x, z)`, `get_starts()` ([{owner, tx, tz}]),
`get_resource_spawns()` ([{type, tx, tz, variant}], the initial spawns),
`take_map_changes()`, `map_hash()`, `build_terrain_mesh(cx0, cz0, cx1, cz1)`
(Mesh arrays for a column rect: vertex, normal, linear colour, index; the
full TerrainMesh.js: smoothed shore, talus, cliff relief), `get_water_depth()`
(cols*cols bytes, metres below the surface * 40 from the smoothed seabed),
`build_ground_details(cx0, cz0, cx1, cz1)` (12 PackedFloat32Arrays, one per
`details/` model, already in MultiMesh buffer layout: 3x4 transform + rgba).

Players: `add_player(id, name="", is_ai=true)` (owners 3..6),
`get_player(id)` ({id, name, is_ai, god, color, food, wood, gold, favor, pop,
pop_cap, age, age_name, advancing, advance_t, advance_total}),
`get_player_ids()`, `is_enemy(a, b)`, `set_player_resources(owner,
{food, …})`, `set_player_age(owner, age)`.

Entities: `unit_type_names()` (type index -> key), `get_unit_def(key)`,
`spawn_unit(type, owner, x, z, rot=0)` -> id, `spawn_block(type, owner,
count, x, z, cols=0, spacing=1, rot=0, jitter=0.15)` -> ids (helpers.js
spawnBlock), `spawn_resource(type, tx, tz, variant=0)`, `remove_resource(id)`,
`clear_rect(tx, tz, w, h)`, `kill_unit(id, killer=0)` (combat.kill: dead,
idle, corpse hold, `entity:died`), `entity_kind(id)` (0
none, 1 unit, 2 building, 3 resource), `get_unit_count()`, `get_unit(id)`
(one unit as a Dictionary incl. its remaining path: UI / debugging only),
`units_near(x, z, r, owner=-1)`.

Per-frame state, one call each, parallel arrays (index i = one entity):
- `get_units()`: `count`, `ids` (Int32), `pos` / `prev_pos` (Float32, x,z
  pairs), `rot` / `prev_rot`, `ground_y` (terrain height under pos), `type`
  (Byte, index into `unit_type_names()`), `owner`, `hp`, `max_hp`, `anim`
  (Byte: 0 idle, 1 walk, 2 gather, 3 build, 4 worship, 5 attack, 6 die),
  `anim_t`, `attack_t`, `die_t`, `hit_t` (-1 = never hit), `flash_t`,
  `order` (Byte: 0 idle, 1 move, 2 gather, 3 dropoff, 4 worship, 5 build,
  6 attack), `target` (order target id), `flags` (Byte: 1 moving, 2 dead,
  4 arrived, 8 carrying, 16 battle line), `carry` (Byte resource kind 0
  food 1 wood 2 gold, 255 none), `carry_amount`, `task` (Byte: the kind
  being gathered, u.econ.resType, 255 none), `load` (Byte, what drawLoads
  shows: 0 wood, 1 gold, 2 grain, 3 fruit, 4 meat, 255 none).
- `get_buildings()`: `count`, `ids`, `type` (index into `type_names`:
  town_center, house, storehouse, farm, temple, barracks), `owner`, `rect`
  (tx,tz,w,h), `hp`, `max_hp`, `built`, `progress`, `variant` (model
  variant, variantOf), `yaw` / `setback` (houses), `farm_rows`, `stock` (6
  per building: grain, fruit, meat, fish, wood, gold), `queue_len`, `rally`
  (3 per building: set, x, z), `type_names`.
- `get_resources()`: `count`, `ids`, `type` (index into `type_names`:
  tree, gold, berry, deer, boar), `tile` (tx,tz; animals: floor(x - 0.5)),
  `amount`, `max_amount`, `variant`, `type_names`.
- `get_economy()`: `animals` ({count, ids, type (0 deer 1 boar), alive,
  moving, pos, prev_pos, rot, prev_rot, flash_t, speed, graze, dead_t,
  amount, max_amount, ground_y}), `spears` (8 floats each: x0, z0, y0, x1,
  z1, y1, t, dur), `shoals` (6: id, x, z, amount, max_amount, phase),
  `boats` (10: id, owner, x, z, prev_x, prev_z, rot, prev_rot, state 0 idle
  1 to shoal 2 fishing 3 to dock, carry). `get_decor()`: {count, keys,
  xform (5 each: x, z, rot, scale, y)}, the scenes' field dressing.

Commands: `order(id, {type, target, x, z, a, b, c})`, `order_move(ids, x, z)`
(formation move), `order_idle(ids)`, `smart(ids, x, z, target_id=0)`
(right-click; order types whose piece is not ported yet fall back to a
move), `order_gather / order_build / order_worship / order_dropoff(ids,
target)`, `move_to(id, x, z, range=0)`, `find_path(sx, sz, gx, gz)`
(PackedVector2Array), `set_group_paths(min_units)`, `set_repath_budget(n)`,
`set_path_cache(on)`.

Buildings: `building_type_names()`, `get_building_def(key)`,
`spawn_building(type, owner, tx, tz, built=true, site=true)` -> id
(buildings.spawn: clears resources, flattens, ground dressing),
`can_place(type, tx, tz)`, `place_building(type, owner, tx, tz, builder_ids)`
-> id or 0 (placement.confirm: pay, foundation, builders ordered and told to
resume their gather / worship afterwards), `destroy_building(id)`,
`get_building(id)` (incl. `queue` [{type, t, total}], `rally`).

Economy: `train(building, unit_type)` / `advance_age(owner)` -> {ok,
reason}, `cancel_train(building, index)`, `next_age_cost(owner)`,
`set_rally(building, x, z, target_id=0)`, `clear_rally(building)`,
`nearest_resource(x, z, res_type, max_dist=14)` (grid index, same answer as
the JS scan), `nearest_dropoff(owner, x, z, res_type)`, `spawn_herd(type,
x, z, n)`, `spawn_boat(owner, x, z, rot)`, `spawn_shoal(x, z, amount)`.

Scenes: `has_scene_setup(name)`, `setup_scene(name, opts={units})` ->
{focus: Vector2, tc, fields, hunt_spot, select, army, villagers},
`scene_after(name)`.

Combat: `kill_unit(id, killer=0)` (combat.kill), `damage(target, amount,
attacker=0)`, `order(id, {type: "attack", target, auto, then_buildings})`,
`set_unit_combat(id, {leash, reach, kit, line: {cx, cz, nx, nz, d0} | null})`,
`set_ai_enabled(on)` (the ENEMY's EnemyAI), `add_ai(owner)`, `get_ai(owner)` /
`set_ai(owner, {enabled, next_wave_at, wave_size, aggression})`,
`get_combat()` ({projectiles: 16 floats each (x, y, z, px, py, pz, sx, sy,
sz, tx, ty, tz, t, dur, arc, dist), projectile_info: 2 ints (target, has
target pos), stuck: 7 (x, y, z, dx, dy, dz, t), scars: 5 (x, z, radius,
dirt, blood), drops: 9 (kind shield/helmet/spear/stub, x, z, rot, owner,
tilt, roll, lift, die time)}). `get_units()` also has `air` (3 each: airY,
airRx, airRz), `stagger` (2: stagT, stagK), `melee_t`, `gp_hit_t`,
`hit_time` (game times, -1 never), `kit` (255 unset).

God powers: `power_names()` (lightning_storm, bolt, meteor),
`get_power_def(key)`, `can_cast(owner, key)` -> {ok, reason},
`cast_power(owner, key, x, z)`, `power_cooldown(owner, key)`,
`get_godpowers()` ({time, storms: 6 each (owner, x, z, t0, duration,
radius), bolts: 6 (x, y, z, t0, life, sky) + bolt_seeds, scorches: 6 (x, y,
z, t0, size, blast) + scorch_seeds, zaps: 5 (x, y, z, t0, life) + zap_units
(id, seed), meteors: 9 (owner, x, z, t0, delay, radius, sx, sy, sz), fires:
6 (x, y, z, r, t0, dur)}).

Fog of war (player 1) and victory: `set_fog_reveal_all(on)`,
`fog_recompute()`, `get_fog()` (size*size bytes: 0 unexplored, 128
explored, 255 visible), `fog_version()`, `is_explored(x, z)`,
`is_visible(x, z)`, `set_victory_enabled(on)`, `get_victory()` ({enabled,
decided, winner, loser, time}), `is_paused()`, `set_paused(on)`.

Events (`game.events`, drained by main.gd): [{type, id, kind, other, owner,
a, x, z, amount}], type one of `entity:added` (a = type index),
`entity:removed`, `entity:died` (other = killer, x, z), `unit:damaged` (id =
target unit or building, kind, other = attacker id (0 god power / gone),
owner = attacker's owner, amount = damage after bonus and armor, x, z),
`building:placed`, `building:completed`, `unit:trained`, `age:advanced`,
`resources:changed`, `godpower:cast` (owner, a = power index in
`power_names()`, x, z), `command:smart` (other = target, a =
unit count), `game:over` (owner = winner, a = loser, amount = time);
`set_record_events(on)`. C++ systems subscribe
with `sim.events.on(EV_…, fn)`.

Profiling / checks: `set_profiling(on)`, `get_profile()`, `get_stats()`
({alive, dead, moving, buildings, projectiles, resources, paths, path_calls,
path_searches, path_cache_hits, path_expanded, group_fields, …}),
`set_census(on)` / `take_census()` (spatial-hash queries), `units_hash()`,
`get_units_f64()` / `get_econ_f64()` (full-precision dumps for parity tools).

Economy render data: `AovEconView` (`native/src/econ_view.h`), `setup(sim,
keys)` (the `economy/<key>` model names in MultiMesh order), `update(alpha,
paused, local_player)` once per frame -> {props: Array[PackedFloat32Array]
(16 floats per instance: TRANSFORM_3D + custom data = linear team rgb,
tint), counts, chips / puffs / rings + *_count (20 floats: TRANSFORM_3D +
colour + custom)}, zero-padded to power-of-two capacities. Fog-aware, closed
form in the sim time (captures are deterministic), no sim RNG.

Units / combat render data: `AovUnitView` (`native/src/unit_view.h`),
`setup(sim, rigs)` (one `VoxelModels.rig(type)` per unit type index; it
subscribes to the sim's `unit:damaged` / `entity:died` to stamp hits with
the sim time), `update(dt, alpha, local_player, frustum=[])` once per frame
(`Camera3D.get_frustum()`: units off screen are not posed) -> {parts:
Array[PackedFloat32Array] (one per rig part, types in index order; COLOR =
coat / corpse tint + fade, CUSTOM = linear team rgb + floor(dead*100) +
flash), part_counts, shadows, bars (CUSTOM = hp fraction, width px),
arrows, streaks (origin = head, COLOR = tail), sparks (COLOR = hdr rgb +
alpha, CUSTOM = size + velocity), dust, chips, drops: Array[4] (shield,
helmet, spear, stub; CUSTOM = team rgb), scars (only when scars_changed;
CUSTOM = dirt, blood), + *_count}; 20 floats per instance (TRANSFORM_3D +
colour + custom), zero-padded to power-of-two capacities. Visual only: never
writes the sim, own hash RNG; the anim.js pose, index.js render transforms,
BattleFX / Particles / Debris / Overlays / Projectiles render maths are
ported there. Stress (2000 units, fog off, 1280x720): ~3 ms per update on
this container's debug build.

Add methods in `aov_sim.{h,cpp}` next to the piece's section and list them here.

## Status

- Done (foundation): project, GDExtension + `AovSim`, model export (all JS
  models incl. unit rigs), capture and bench scripts.
- Done (sim core A): bit-exact map generator for every preset and player
  count; entity store, players (Gaia + 6), events, spatial hash, A* with
  line-of-sight smoothing (+ exact path cache), movement (separation,
  sliding, stuck re-paths), units spawn / anim state / spread / corpse
  clearing, commands (idle, move, formation move, smart), all bit-exact with
  the browser (`check-sim.mjs`: 4200 units over 900 ticks match; C++ 1.7
  ms/tick vs JS 31 ms). First-pass terrain (C++ chunk mesher with the JS
  palette and AO) and a sim debug view.
- Done (sim core B): economy (gathering state machine and drop-off, farms,
  hunting with herds / spears / carcasses, fishing boats and shoals,
  worship -> favor, population and cap, training queues, rally points, age
  advancement, nearestResource grid index), buildings (placement,
  foundations, construction, builders moving on, destruction, ground
  dressing, the planned town), scene setups (skirmish, town, coast, hud,
  economy), all bit-exact with the browser (`check-sim.mjs`). Rendered:
  buildings and construction stages, units in the rest pose, the economy
  view.
- Done (sim core C): combat (attack orders, auto-targeting with the
  crowding penalty, melee / splash / ranged damage, class bonuses, armor,
  knock-back and stagger, projectiles, death and the corpse hold, Town Center
  arrows, phalanx lines), the enemy AI (any number of AI players), god powers
  (favor, cooldowns, Lightning Storm with its whirlwind, Bolt, Meteor, thrown
  units), fog of war, victory, and the battle / godpower / stress scene
  setups, all bit-exact with the browser (`check-sim.mjs`); the headless
  stress bench (`godot-stress.mjs`, numbers above).
- Placeholders to replace: `game/terrain/terrain.gd` (first pass: no shore
  smoothing, talus, cliff relief, water shader or ground details),
  `game/lighting/lighting.gd`, the placement ghost
  (UI); the
  `game/godpowers` renderers and the fog-of-war shading do not exist yet
  (the sim state they need is exported, see "AovSim API").
