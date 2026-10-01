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
| core (foundation; skirmish builder: camera, fog pass, playtest) | `game/main.gd`, `game/core/` (args, scenes, camera, model loader, voxel shader, bench, sim_debug, simcheck, `fog_view.gd` + `fog_of_war.gdshader` (fog-of-war shading, one full-screen pass), `playtest.gd` (scripted skirmish playthrough), `menu_playtest.gd` (the screen flow through real input: menu -> setup -> loading -> match -> Esc menu -> menu, see "Screen flow"), `match_rules.gd` + `match_check.gd` (match settings -> the sim, see "Match rules")) | `core/` (constants, rng, jsmath, bounds, game_map, entities, players, events, spatial_hash, pathfinding, movement, commands, profile, fog, victory), `match/` (the match setup: seats, teams, difficulty, stockpiles), `fortify/` (walls, gates, towers, their stages: Godot-only, see "Walls, gates, towers"), `sim.{h,cpp}` | `src/core/` |
| terrain | `game/terrain/terrain.gd` + `terrain.gdshader` (chunks, paving cobbles / pale stone of MaterialPatches patchGround), `water.gdshader` (Water.js), `props.gdshader` (voxel.gdshader + MultiMesh instance tint, used by trees / gold / berries / ground details); mesher in `native/src/terrain_mesher.cpp` (TerrainMesh.js full port, water depth bake, GroundDetails.js scatter) | map edits live in `core/game_map`; resource nodes `Sim::spawn_resource` | `src/terrain/` |
| lighting | `game/lighting/lighting.gd` (sun + PCSS soft shadows, hemisphere = ambient colour + two unshadowed up/down lights, fill, depth haze following the camera, SSAO, MSAA, `--quality=high\|medium\|low`, `--post=high\|low\|off`), `grade_effect.gd` (CompositorEffect compute pass on the HDR buffer: exposure 2.1 + PBR Neutral + the PostFX.js grade; Godot's tonemap is LINEAR; Compatibility/web falls back to AgX), `sky.gdshader`. MaterialPatches.js canopy / foliage terms not ported yet | none | `src/lighting/` |
| buildings | `game/buildings/buildings.gd` (models, construction stages, house yaw, fog visibility), `walls.gd` (Greek walls, pillars and gates with swinging leaves, construction and damage states; models by `../scripts/export-walls.mjs`, see "Walls and gates: the look"), `towers.gd` + `tower_scene.gd` (Greek towers, a model per upgrade stage, construction / damage / upgrade states, the `towers` capture scene; models by `../scripts/export-towers.mjs`, see "Towers: the look"), `town_props.gd` (props.js: town dressing, one MultiMesh per prop kind), `building_ao.gd` + `building.gdshader` (every building / prop mesh gets a wide-radius AO baked once per model by `AovBuildingAO.bake` in `native/src/building_ao.cpp` (render side, stands in for the browser's GTAO: column gaps, porticoes, eaves, wall-to-ground contact), stored in CUSTOM1.b and multiplied into the albedo; pale albedo pulled down, glow lowered; without the class, e.g. an old web .wasm, meshes come out without it) | `buildings/` (defs, spawn + ground dressing, placement, construction, destroy, town.js: ported) | `src/buildings/` |
| units | `game/units/units.gd` (rigs posed by the full anim.js port, conditional parts, crowd yaw / press / jitter, deaths and corpses, contact shadows), `unit.gdshader` (team lift + rim, hit flash, corpse drain, dithered fade) + `unit_outline.gdshader` (inverted hull, next pass); posing in C++: `native/src/unit_view.cpp` (`AovUnitView`) | `units/` (defs, spawn, anim state, spread: ported) | `src/units/` |
| combat (incl. enemy AI) | `game/combat/combat.gd` (arrows + streaks + stuck arrows, health bars, hit sparks / flash, dust, chips, ground scars, dropped gear; shaders in `game/combat/`), `tower_fire.gd` + `tower_flash / tower_puff.gdshader` (tower arrows: loose flash, heavier arrow, tracer, strike; see "Towers: the look"), all instance data from `AovUnitView` (via `pieces.units.last`) | `combat/` (combat.cpp: attack order, targeting, damage, projectiles, death, Town Center arrows, phalanx lines; enemy_ai.cpp: ported, plus god powers and a wave log, Godot-only; enemy_ai_fort.cpp: the AI's walls, towers and breaches, Godot-only) | `src/combat/` |
| economy | `game/economy/economy.gd` (EconomyView: animals, spears, boats, shoals, crops, stockpiles, loads, decor; Godot-only activity fx: axe / pick chips and dust, sickle chaff, stooks on cut rows, hoof dust, shoal ripples, fish splashes, net ripples, boat wakes; crops sway, `econ_voxel.gdshader`, `fx_chip / fx_puff / fx_ring.gdshader`), buffers built in C++ by `AovEconView` (`native/src/econ_view.{h,cpp}`, render side, reads the sim, never writes it) | `economy/` (gathering, farms, hunting, fishing, worship, training, age: ported) | `src/economy/` |
| godpowers | `game/godpowers/godpowers.gd` (the whole BoltRenderer of effects.js: bolt / sky / zap ribbons, impact flash sprites and decals, scorches with ember cracks (hot orange / red, glowing as long as the scorch lasts), a charcoal ash edge and a hot rim, an expanding impact ring at every strike point (Godot-only; decals are pulled toward the camera so voxel bumps do not swallow them), crater debris, char rims, spark streaks, smoke and flames, the storm funnel (wall, cloud body, dust wall, ground shockwave, rain, energy bands, whirled debris), flyer trails / back lights / drop shadows, meteor fireball and fire, strike / storm point lights and the shadow spot, the full-frame storm grade with light pools; dims the lighting piece's sun / sky / grade while a storm plays), shaders beside it; buffers built in C++ by `AovGodpowerView` (`native/src/godpower_view.{h,cpp}`, render side, reads the sim, never writes it) | `godpowers/` (favor, cooldowns, Lightning Storm, Bolt, Meteor, thrown units: ported) | `src/godpowers/` |
| ui (HUD, selection, input) | `game/ui/ui.gd` (selection, box / double-click select, smart orders, rally points, control groups, hotkeys, placement ghost, wall drawing (click-drag line ghost, cost, snapping) and the wall / gate / tower commands (see "Walls, gates, towers: placement"), god-power targeting ring, move markers, selection rings (one MultiMesh) + bars, event feed, messages, result card; public: `pieces.ui.selected`, `hover_entity`, `message()`, `feed()`), `hud.gd` (the drawn HUD, two layers with hit zones), `hud_style.gd` (palette, Cinzel / Alegreya fonts in `fonts/`, SVG icons from `icons.gd` = `src/ui/icons.js` rasterised at runtime, draw helpers), `panel.gdshader` (the gilded teal panels), `minimap.gd` + `minimap_ground/units.gdshader` (terrain colours computed in the shader from `get_heights()` / `get_ground()` uploaded as textures, re-uploaded on `building:placed`; unit dots read straight from `get_units()` arrays as data textures: no per-unit script), `portraits.gd` + `portrait.gdshader` (one SubViewport per type / owner, rendered once, unshaded with the browser's three.js hemisphere + sun lighting, no tonemap) | none | `src/ui/` |
| performance (6 teams, 2000 units) | `game/perf/perf.gd` (the render bench, `--renderbench`), and in the render paths of the stress scene: unit LOD + box shadow casters (`game/units`), coarse voxel twins `VoxelModels.coarse()` (tree shadow casters), tight resource / ground-detail buckets (`game/terrain`), economy props frustum culling (`AovEconView`); report in `../docs/godot-stress-report.md` | sim hot paths (with their owners); `native/src/unit_lod.cpp` (`AovUnitView.lod_mesh`) | `docs/stress-report.md` |
| exports (Windows, macOS, Linux, web) | `export_presets.cfg`, `../scripts/godot-export.sh`, `../.github/workflows/godot.yml`, `native/SConstruct` + `native/aov.gdextension` (platform entries); see "Export" | none | `vite build` |
| scenes | `AovScenes.set_setup()` from the owning piece, else the C++ setup | `scenes/` (helpers.js, skirmish / town / coast / hud, EconomyScene.js; battle.cpp: BattleScene.js + units/battleHost.js, godpower, stress.js: all ported) | `src/core/scenes/`, `BattleScene.js`, `EconomyScene.js` |
| menu (main menu) | `game/menu/`: `menu.gd` (the piece, scene `menu`), `tile.gd`, `art.gd`, `options.gd`, `flow.gd` (screen flow, `AovArgs.override`), `loading.gd` (the loading screen), `game_menu.gd` (the in-game Esc menu), `hero_art.gd` + `hero_sky.gdshader` + `hero_bolt.gdshader` (the feature card's rendered art), `logo.gdshader`, `menu_sky.gdshader`, `menu_check.gd`; see "Main menu" | none | none (Godot-only) |

```
godot/
  project.godot            Forward+, 1920x1080, main scene game/main.tscn
  PORTING.md               this file
  game/main.tscn|gd        entry: args, sim, pieces, loop, capture, bench
  game/core/               args.gd, scenes.gd, camera_rig.gd, voxel_models.gd,
                           voxel.gdshader, bench.gd, model_gallery.gd,
                           fog_view.gd + fog_of_war.gdshader, playtest.gd,
                           *_check.gd (headless rule checks)
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

SCons does not notice a compiler upgrade (emsdk swaps the clang behind the
same `emcc`), so `SConstruct` writes the compiler's `--version` line to
`godot-cpp/bin/.aov-compiler.<platform>.<target>.txt` and, when it changes,
deletes that platform/target's godot-cpp and libaov objects and library and
rebuilds them. Mixing godot-cpp objects from one emscripten with libaov from
another is what made the round-3 web build abort at startup ("Class ''
doesn't exist" in `bind_methodfi`, then heap corruption). Our own objects
carry the same per-target suffix as godot-cpp's
(`src/aov_sim.linux.template_debug.x86_64.os`, `...web.template_release.wasm32.nothreads.o`),
so switching platform or target never relinks another target's object.

The sim is compiled with `-ffp-contract=off` (MSVC `/fp:precise`): no FMA
contraction, never `-ffast-math`, or it stops matching the browser.

Web: `source ~/emsdk/emsdk_env.sh && scons -j2 platform=web threads=no
target=template_release` with **emscripten 4.0.10** (the version the official
4.5.1 web templates are built with and report at startup; CI pins it too, and
`~/emsdk` here has it active; build godot-cpp and libaov with the same one)
gives `bin/libaov.web.template_release.wasm32.nothreads.wasm`. The
web export uses the dlink "nothreads" template: no SharedArrayBuffer, so it
runs from any static server without cross-origin isolation headers. The first
web build compiles godot-cpp for wasm (~20 min on 2 cores here).
macOS: `platform=macos arch=universal` builds `bin/libaov.macos.<target>.framework`
(one binary for x86_64 + arm64, plus `Resources/Info.plist` for signing).

**Godot only loads a GDExtension listed in `.godot/extension_list.cfg`**,
which an import writes. After a fresh clone (or if `AovSim` is missing):

```
godot --headless --path godot --import     # may print a crash on first run; the cache is written anyway
```

`scripts/godot-shoot.mjs` does this automatically when the file is missing.
`.godot/` is never committed.

## Export (owner: exports / platforms piece)

`export_presets.cfg` has four presets: `Linux` (x86_64), `Windows` (x86_64),
`macOS` (universal, ad-hoc signed, not notarized: a `.zip` holding
`Age of Voxel.app`) and `Web` (Compatibility renderer, dlink nothreads). The
models (`assets/models/*`) and the woff2 fonts are read with `FileAccess`, so
they are listed in each preset's `include_filter`: keep that in mind if you add
raw data files (the fonts' `.import` files say `importer="keep"` so the woff2
bytes themselves are exported). Official 4.5.1 templates go in
`~/.local/share/godot/export_templates/4.5.1.stable/` (installed in this
container: linux, windows, macos, web).

```
scripts/godot-export.sh linux|windows|macos|web [release|debug]   # scons for the target, then export
SKIP_BUILD=1 scripts/godot-export.sh linux debug                  # export only (uses native/bin as is)
python3 -m http.server -d dist-godot/web 8000                     # web: open http://localhost:8000/?scene=town
node scripts/godot-webshoot.mjs --scene hud [--out shots/godot/web-hud.png]   # web smoke test + screenshot (headless Chromium)
node scripts/godot-webshoot.mjs --scene none      # no params: the default fog-of-war skirmish (what CI checks)
node scripts/godot-webshoot.mjs --scene none --coi   # same, served with COOP/COEP (the nothreads build must start both ways)
dist-godot/linux/AgeOfVoxel.x86_64 -- --scene=town                # exported builds take the same args
```

The editor that runs an export loads the extension through the *debug*
entry for its own OS (`linux.debug.x86_64` on Linux, `macos.debug` on a Mac),
whatever the target: without that `template_debug` library it logs
"GDExtension dynamic library not found" and the export fails. The script
builds it along with the target's library, or, with `SKIP_BUILD=1`, stops
early naming whichever of the two is missing; CI's linux native job builds
both `template_release` and `template_debug` for that reason. The web library
is built with emscripten 4.0.10, the version the official 4.5.1 web templates
report at startup.

Output: `../dist-godot/<target>/` (gitignored). In the web build the page's
query string is read like the command line (`AovArgs.parse`). CI:
`.github/workflows/godot.yml` builds the extension on ubuntu-22.04 (linux),
windows-latest (MSVC), macos-latest (universal) and ubuntu + emsdk (web),
caches godot-cpp per submodule commit, exports the four presets on Linux and
uploads `aov-godot-{linux-x86_64,windows-x86_64,macos-universal,web}`; with the
repository variable `GODOT_PAGES=true` it also publishes the web build on
GitHub Pages from main.

**Web = Compatibility renderer** (GLES3 / WebGL2; Forward+ does not exist on
the web). Test it on desktop with `--rendering-method gl_compatibility
--rendering-driver opengl3`. Known 4.5 GLES3 bug: RGBA8 custom vertex
attributes are bound with one component (only red), so
`VoxelModels.add_voxel_surface()` uploads CUSTOM0 / CUSTOM1 as RGBA float
there; build voxel surfaces through it (and read them back with
`VoxelModels.voxel_arrays()`), never with a raw `ARRAY_CUSTOM_RGBA8_UNORM`
flag. Compute / CompositorEffect passes do not run on Compatibility (the
lighting piece falls back). Depth conventions differ: Forward+ / Mobile use
reversed Z (NDC z in [0, 1], cleared depth 0), Compatibility standard Z (NDC z
= depth * 2 - 1, cleared depth 1). A shader that reads `hint_depth_texture`
must branch on `#if CURRENT_RENDERER == RENDERER_COMPATIBILITY` (see
`fog_of_war.gdshader`), or the whole world reads as sky. `godot-webshoot.mjs`
fails on a black frame centre ("black 3D world") to catch that. Colours
drawn by full-screen passes go through AgX there, not the grade, so they may
need their own Compatibility values (`fog_view.gd`).

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
  `models` (every exported model on one strip), `walls` (a walled Greek town,
  see "Walls and gates: the look"), `aifort` (two AIs play a match in the
  setup: their own walls, gates, towers and breaches, see "Enemy AI:
  fortifications") and `menu` (the main menu,
  below). **Without `--scene`** the game opens the main menu; a run with
  `--out`, `--quit` or `--bench` and no `--scene` still gets the skirmish, as
  before (so does the web build's `?scene=` query). Like main.js, main.gd turns
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
| Godot C++ sim, mean ms/tick | 0.09 | 0.17 | 0.38 | **0.95** | 1.50 | 2.61 |
| Godot C++ sim, p95 | 0.19 | 0.25 | 0.53 | **1.32** | 2.65 | 4.02 |
| browser JS sim, mean (report) | 2.4 | 3.3 | 7.6 | **15.0** | 25.2 | 40.7 |

At 2000 units: movement 0.32, units 0.29 (spread 0.28), combat 0.23 (AI of
all 6 players 0.01), economy 0.08, fog 0.02 ms/tick; `findPath` 183 calls/tick
(172 from combat, exactly the browser's counts: the two sims run the same
game), 0.12 ms/tick; 16.7 neighbours visited per hash query (23.1 at 4000:
the armies get denser on the fixed map, hence 2.7x from 2000 to 4000, as in
the browser). The separation loops read the hash's position mirror
(`SpatialHash::for_each_near_xz`, kept exact with `sync()` / `moved()`).
Wall times on this shared machine vary by +-30 %. Since the enemy AI casts
god powers, every seat's storms and meteors thin the stress armies (2000
units: about 1310-1340 alive on average over the recorded ticks instead of
1926, 0.75-0.9 ms/tick mean; attack-move scans (`amPick`) cost 0.01
ms/tick there); `--params "godot_rules=0"` (the browser's map and rules)
gives the workload of the table above (1.06-1.09 ms/tick mean on this
machine today). **Walls and towers in the stress scene** (rules on): every
town is walled in by its EnemyAI at setup (`EnemyAI::fortify_now`: the AI's
own square ring with clipped corners and a gate in each straight side,
finished, plus two towers by the Town Center; ~600 buildings instead of
~130), so the bench measures pathing round walls, breaches and tower fire;
`--params "fort=0"` (`setup_scene(..., {fort: false})`) leaves them out.
2000 units, three interleaved runs today: 0.74-0.89 ms/tick mean (p95
1.44-1.64) walled, 0.67-0.77 (p95 0.98-1.32) with `fort=0`, 0.69-0.81 for
the previous commit; `findPath` 0.18-0.20 ms/tick walled (0.07 without;
`pathCut` / `pathFail` / `pathFlood` are its region rows, see "Walls,
gates, towers"). The render numbers and
their method are in `../docs/godot-stress-report.md`.

Render bench (xvfb + lavapipe, the counterpart of `scripts/bench.mjs`;
`game/perf/perf.gd` pauses the sim like bench.mjs, turns vsync off and times
`--frames` frames after `--warmup`):

```
node scripts/godot-renderbench.mjs [--scene stress] [--params "units=2000&fog=0"] [--width 1280 --height 720]
     [--frames 30] [--warmup 10] [--live 0|1] [--json out.json]
godot --path godot --rendering-driver vulkan -- --scene=stress --units=2000 --fog=0 --renderbench=30 [--rb_warmup=10]
```

It prints wall ms per frame (mean / median / p95), process CPU ms per frame
(all threads: lavapipe rasterises on worker threads; steadier than wall time
on this shared machine), draw calls / primitives for the main and the shadow
passes, units posed / at LOD. Experiments: `--rb_hide=units,terrain/Resources`
hides pieces or their child nodes, `--rb_off=shadow,msaa,ao,post` turns one
render feature off. Numbers next to the browser's: `../docs/godot-stress-report.md`.

Skirmish playtest (the whole match through real input events: box select,
right-click gather, control groups, house placement, train, advance age,
double-click, stop, the god power hotkeys with villagers selected (no clash
with a command key, the key in the tooltip, the "Not enough favor" message,
targeting mode, Esc), attack-move (box-selected army, the button's tooltip
"Attack-Move (A)", A enters the mode, Esc cancels it, A + a ground click and
A + a minimap click give `attack_move`), camera zoom / turn / pan, a Bolt by hotkey + click, two
minutes against the AI, the victory card and Play Again; ~12 min on lavapipe):

```
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
  godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
  -s res://game/core/playtest.gd -- --scene=skirmish     # "PLAYTEST ok|FAIL <step>", exit = failures
```

AI-vs-AI skirmish (the real main scene headless, an EnemyAI for player 1 as
well, the sim stepped 15 ticks per frame until Victory decides; ~20 s):

```
godot --headless --path godot -s res://game/core/aivai.gd -- --scene=skirmish --seed=5 [--minutes=60] [--quiet=1] [--verbose=1]
```

It logs every attack wave (`AovSim.get_ai(owner).waves`: launch time,
target building, the men sent), where its men are every 20 s and when half
of the survivors are within 16 tiles of the target ("ARRIVED"), every god
power cast, and ends with `AIVAI_RESULT {json}` (match length, winner, per
player waves / arrived / sizes / casts); exit 0 when the match was decided
with no script error.

Other tools:

```
node scripts/check-mapgen.mjs            # per scene seed/preset (+ stress 2-6 players, 3 split skirmish seeds):
                                         # 1. the C++ generator with the Godot passes off vs JS generateMap(): heights,
                                         #    ground, passability, walkable after resources, resources, starts (exact);
                                         # 2. the game's map (NOT the browser's: woodlines, connected starts): >= 16 trees
                                         #    8-14 tiles from every Town Center, every start and nearby mine / bush
                                         #    reachable, terrain changed only where graded (all "ok")
node scripts/check-sim.mjs [--only a,b]  # C++ sim (with set_godot_rules(false): the browser's map and rules) vs the JS modules: scenarios (skirmish 3, town 7, battle 19, coast 5,
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

## Main menu (game/menu)

`game/menu/menu.gd` (a piece: in `PIECE_ORDER`, idle unless the scene is
`menu`) is Retold's main menu in the HUD style (`hud_style.gd`, the panel
shader, Cinzel / Alegreya): the coast town plays live behind it (the C++
`coast` setup, no AI, no HUD) as an evening hero shot through a long lens
(fov 25, pitch 7.5, from the sea): an acropolis, a temple the menu raises
on the headland at the harbour mouth (`_raise_acropolis`, `ACRO`), fills
the right-centre third, backlit by the setting sun that sits just past its
roof (`SUN_AT`, a frame point: the sky's sun, the additive bloom and the
sea's glitter path all aim at it; the key light comes from that side,
higher); three fishing boats lie in the mid-ground on a diagonal leading to
it (placed where their frame points meet the sea, each on its own rich
shoal so they stay and fish); the trees that would wall the frame's middle
on this side of the temple are felled (`_clear_view`, `CLEAR_FRAME`) so
the eye runs past the beach to the town; depth haze begins just past the
temple (`FOG_NEAR` / `FOG_FAR` x the camera distance) so the woods and the
old town step back in value; the sea is graded from the play map's cyan to
an evening teal (`_grade_water`, the terrain's water material, menu scene
only); `menu_sky.gdshader` (gold horizon to dusky blue, cloud streaks) and
golden haze hide the map edge, set on the lighting piece's nodes for this
scene only (`_apply_mood` / `_aim_mood`, `_mood_frame` after lighting's frame), plus a
warm additive sun bloomplus a
warm additive sun bloom and a shadow gradient under the menu column. The
camera sways slowly round the anchor. Over it: a top bar with the logo
(`logo.gdshader`: white text shaded as cast gold) and tabs, the Skirmish
tile, Campaign / Multiplayer unavailable (each carries a full-bleed
engraving from `art.gd`, drawn edge to edge inside the frame at about 45%
over a soft gold glow, bleeding under the label's dark gradient: Campaign a
hoplite hero charging past a burning trireme under a rain of arrows,
Multiplayer Zeus rising from storm clouds with his thunderbolt; hatched
shading via SVG clip paths; a muted title, on hover "Not available in this
version.", pressing shows a notice), a feature carousel (Zeus, attack-move, the map) whose card
carries full-colour art rendered live in our own voxel render
(`hero_art.gd`: a SubViewport with its own World3D, so nothing of it
reaches the harbour or its light; exported models in rest pose on voxel
ground: the golden hero before a hoplite phalanx, archers, minotaur,
cyclops and cavalry, the temple on a hill, a crimson storm sky
(`hero_sky.gdshader`) and Zeus's bolt (`hero_bolt.gdshader`, glow); one
camera framing and mood per page, a slow sway and bolt flicker live, still
in captures; drawn edge to edge inside the bronze frame, the title on a
dark gradient, a one-line caption), Quick Match
(the default skirmish at once; there is no Load until saved games exist),
How to Play (`guide.gd`: the goal and the mouse / camera / hotkeys, the
same framed sheet as Options) and Quit (a notice on the web). Options
(`options.gd`: Graphics High / Medium / Low live + remembered like the gear
card, window mode, F3 meter) opens from the top bar's OPTIONS tab or the
burger, so it appears once. The bottom-left plate (Retold's chat bar) shows
one gameplay tip at a time, turning every 9 s (the first in captures). Tiles are
`tile.gd` Buttons (hover / pressed / focus states) with gold line art built
as SVG in `art.gd`. Keyboard / joypad: the first arrow or D-pad press
focuses Skirmish, arrows move, Enter / A presses, Esc / B closes Options; the
focus ring only shows while the last input was not the mouse. Screen flow
is `flow.gd`: `Flow.start_match(tree, opts)` / `Flow.to_main_menu(tree)` set
`AovArgs.override` (parse() returns it instead of the command line, so Play
Again replays the same match) and reload `main.tscn`. Skirmish opens the
first existing script of `Flow.SETUP_SCREENS` (the "Setup screen contract"
at the top of `menu.gd`), or starts the default skirmish without one.
The `menu` scene lists `skip_pieces: ["ui"]` (scenes.gd; main.gd does not
load a skipped piece): no in-game UI behind the menu (its hotkeys, F1 HUD
toggle and world clicks cannot reach the town), and the menu and its capture
do not depend on `game/ui/ui.gd` loading. A piece that fails to load is
skipped and reported (main.gd), so one broken piece never leaves the menu
scene with un-set-up pieces (the "Nil base 'sim' / 'camera'" errors).
Behind the menu the shoals' leaping fish are hidden (economy's `Econ_fish`
node, menu scene only): at that distance they read as specks.

```
node scripts/godot-shoot.mjs --scene menu --out shots/godot/menu.png
     [--params "menu_hover=skirmish"]    # a tile hovered + focused: skirmish campaign multiplayer feature quick guide quit tab_play tab_options burger
     [--params "menu_options=1"]         # the Options dialog open
     [--params "menu_guide=1"]           # the How to Play sheet open
     [--params "menu_view=x,z,dist,pitch,yaw"]   # camera anchor; menu_intro=1 plays the fade-in (off in captures)
     [--params "menu_hero=yaw,pitch,dist,left,fwd,fov"]  # the hero framing (temple -> view target shift, lens); fleet, felled trees and light follow it
     [--params "menu_acro=tx,tz"]        # where the acropolis temple is raised (tile corner)
     [--params "menu_look=sx,sy,near,far"]  # the sun's frame point (1920x1080) and the haze start / end (x camera distance)
     [--params "menu_page=1"]            # the feature card turned N pages (0 Zeus, 1 attack-move, 2 the voxel world)
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
  godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
  -s res://game/menu/menu_check.gd        # no --scene on purpose: "MENU ok|FAIL <step>", exit = failures
```

`menu_check.gd` launches with no scene argument and drives the menu through
real key, joypad and mouse events: the menu opens with no in-game UI,
arrows / D-pad move the focus, Enter on an unavailable tile gives its
notice, the feature card's rendered art (full colour, reframed on a page turn),
Options only in the top bar, the hero shot (the acropolis in the
right-centre third, the fleet before it, the sea graded down), Campaign / Multiplayer art filling the tile,
hover, the Options tab (Graphics Low applies live and is remembered, then
restored), Esc, How to Play open / Esc, world clicks blocked, Skirmish -> the setup screen -> a
match with its HUD, then back to the menu.

## Screen flow: menu, setup, loading, match, game menu (game/menu/flow.gd)

A plain launch (no `--scene`, the web build without `?scene=`) opens the main
menu; Skirmish opens the setup screen; its Play (and the menu's Quick Match)
calls `Flow.start_match(tree, M.to_args(settings))`; the in-game menu's Quit
to Main Menu and the result card's Main Menu call `Flow.to_main_menu`; the
result card's Play Again calls `Flow.restart` (the current run's args again:
exactly the same match, setup settings or command line). Every switch sets
`AovArgs.override` and goes through **the loading screen**
(`game/menu/loading.gd`, a CanvasLayer at 128 under the tree *root*, so it
survives the scene change): it is drawn first (the map's name, kicker and
blurb, the map preview from the setup screen's cache in a bronze frame, the
players by team with their voxel portraits, colour tags, god and
difficulty, a cast-bronze bar with the stage being built, a tip), then
`main.tscn` reloads under it. main.gd finds it (`loading`, node
`AovLoading`) and builds in stages, one drawn frame each (`_stage`: new_game,
each piece's `setup()`, the match seating, the fast-forward), with its own
process mode disabled until the last `setup()` ran (no piece `frame()` or
input half set up; `building` is true meanwhile), advances the bar, marks the
Town Centers in the players' colours once `MatchRules.apply` seated them
(`loading.seat(sim)`), then `loading.finish()` fades it out. The root
viewport's 3D is off under the opaque card (a stage then costs ~70 ms instead
of a full lavapipe frame), except for the two frames that draw the portraits
(SubViewports rendered while a scene world exists under a root with
`disable_3d` come out as flat close-ups). A command-line run (captures,
checks, `--scene=...`) has no loading screen and builds synchronously as
before; `time_scale` is set before the build so checks that wait a few frames
after Play still read it.

**In-game menu** (`game/menu/game_menu.gd`, hosted by main.gd as
`game_menu` in every scene with the in-game UI, a CanvasLayer at 60): Esc
with nothing to cancel (no placement / targeting mode, no hotkey card: ui.gd
`_key` calls `game.open_game_menu()`) or F10 opens it; the match pauses
under a dim veil (restored on close, a decided match stays paused); Resume,
Options (the main menu's Options dialog: graphics live, display, F3 meter)
and Quit to Main Menu, in the HUD style (panel.gdshader, `tile.gd` bars),
keyboard / joypad navigable; Esc closes Options, then the menu; no hotkey
reaches the HUD while it is open. The result card (hud.gd) has Play Again
and Main Menu.

```
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
  godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
  -s res://game/core/menu_playtest.gd [-- --shots=/abs/dir]    # no --scene on purpose: "FLOW ok|FAIL <step>", exit = failures
```

`menu_playtest.gd` drives it all with real input events (mouse moves and
clicks at the widgets' centres, checked to be the control under the mouse;
keys): plain launch -> the menu -> Skirmish -> setup: 6 players, teams 3 v 3,
one AI per difficulty (Easy, Moderate, Hard, Titan, Moderate), your colour
changed to 7 (cyan), map size Large -> Play -> the loading screen -> the
match, then from the sim: players 1..6, teams (and `is_ally` / `is_enemy`),
the one human, each seat's difficulty and its AI's, the colours, the map
size, a Town Center each, the HUD; Esc -> the game menu (the tick stops, H
does not reach the HUD) -> Resume (the tick runs) -> Esc -> Options -> Esc ->
Esc -> Esc -> Quit to Main Menu -> the menu -> Skirmish (the setup remembers
the match) -> Play -> the same match; the enemy team's Town Centers razed
(harness shortcut) -> the result card -> Play Again (the same match, from
tick 0) -> the card again -> Main Menu. It prints the clicks it took: 24 from
the main menu to that match (Skirmish 1, count 2, teams 10, difficulties 6,
colour 2, map size 2, Play 1; a default skirmish is 2: Skirmish, Play), and
each load's frames / ms (~2-4 s on lavapipe). `--shots` saves the setup, the
loading screen, the game menu, its Options and the result card.

## Match setup and match settings (game/menu/setup)

The skirmish setup screen (`game/menu/setup/setup.gd`, after Retold's
lobby; widgets in `widgets.gd`, backdrop `setup_bg.gdshader`, preview
`map_preview.gd`) opens from the main menu's Skirmish tile (the menu's
"Setup screen contract", `Flow.SETUP_SCREENS`) or on its own as the scene
`setup` (a scene entry with `"screen": <script>`: main.gd puts it on a
CanvasLayer over the scene's world; the screen is opaque and scales itself
by the window height like the HUD). Leave = back to the menu (hosted:
`menu.close_screen()`, standalone: `Flow.to_main_menu`); Play =
`menu.start_match(M.to_args(settings))` / `Flow.start_match`.

```
node scripts/godot-shoot.mjs --scene setup --params "players=5"          # 2..6 players
node scripts/godot-shoot.mjs --scene setup --params "players=2&open=team" # an open picker:
     # open=team|color|difficulty|count|size|resources|speed (dropdowns of row 1 / the map panel), god, map (the modals)
     # also map=<key>, seed=N, mapsize=N
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
  godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
  -s res://game/menu/setup/setup_check.gd -- --scene=setup   # "SETUP ok|FAIL <step>", exit = failures
```

`setup_check.gd` drives the screen through real mouse / key events at the
drawn widgets' hit zones (count, colour swap, team, difficulty, resources,
speed, size, seed, free for all, the pantheon picker, the map chooser,
remove / add, Esc, Play -> the match loads with the settings, setup again
remembers them, Leave -> menu). It needs a display (headless windows are
64x64).

**The match-settings Dictionary** (`game/menu/setup/match_settings.gd`,
preloaded as `M`; the one hand-off between the setup screen and the match
rules):

```
{ version: 1, game_type: "standard", victory: "conquest",
  map: "aegean_hills" | "ionian_coast" | "marathon" | "circle_of_poleis",   # M.MAPS ("random" is rolled before Play)
  preset: "skirmish" | "coast" | "battle" | "stress",                       # M.MAPS[map].preset, for AovSim.new_game
  seed: int, map_size: 96 | 128 | 160 | 192 | 256,
  visibility: "standard" | "revealed", resources: "low" | "standard" | "high" | "deathmatch",   # M.RESOURCES[..].res
  speed: 0.75 | 1.0 | 1.5 | 2.0, free_for_all: bool, lock_teams: bool (UI only),
  players: [ {id: 1..6 (= owner, = start index + 1), name, human: bool, ai: "" | "easy" | "moderate" | "hard" | "titan",
              god: "zeus", color: 1..8 (M.COLORS, 1..6 = the sim's PLAYER_COLORS), team: 1..6}, ... ] }   # 2..6, [0] = the human
```

`M.team_of(settings, i)` gives the team the rules should use (free for all:
a team per player); `M.DIFFICULTIES[..].ai` was a hint for
the rules (unused: they take the difficulty key, see "Match rules");
`M.RESOURCES[..].res` the `set_player_resources` stockpile (`{}` = the
default). Play passes main.gd args (strings): `scene=skirmish`, `seed`,
`mapsize`, `players`, `preset`, `timescale` (speed), `fog=0` (revealed), and
`match` = the whole Dictionary as JSON; `M.from_args(game.args)` reads it
back ({} for a run without one). main.gd honours seed, mapsize,
timescale and fog, and hands the rest to the match rules (below). Which
player counts a map takes is asked of the generator (`M.starts_for`: the
starts `new_game` places): Aegean Hills, Marathon and Circle of Poleis take
2-6, Ionian Coast 2. Only Zeus is playable: Hades and Poseidon
are shown locked in the pantheon picker. The map preview is the real
generator's output for the chosen preset / seed / size / player count
(tiles coloured like the minimap, trees / gold / berries, Town Center
markers in the players' colours).

## Match rules (native/src/sim/match, game/core/match_rules.gd)

A run with a `match` arg (the setup screen's Play) is a real match:
main.gd reads it with `MatchRules.settings(args)`
(`game/core/match_rules.gd`), calls `new_game(seed, mapsize,
MatchRules.preset(m), player count)` and, in place of the scene setup,
`MatchRules.apply(sim, m)` -> `AovSim.setup_match(MatchRules.sim_config(m))`
-> `Sim::setup_match` (`sim/match/match.{h,cpp}`). `AovSim.start_match(cfg)`
does `new_game` + `setup_match` in one call (checks, tools). The sim config:

```
{ seed, map_size, preset, resources: "low" | "standard" | "high" | "deathmatch", villagers: 5,
  players: [ {id: 1..6, name, human: bool, ai: "easy" | "moderate" | "hard" | "titan",
              team: int (<= 0: his own; free for all sends 0), color: 0xRRGGBB, god: "zeus"}, ... ] }
-> {ok, error, local, focus: Vector2 (the local Town Center), tcs, slots (start index per player)}
```

- **Seats**: team mates side by side round the ring (teams in order of
  first appearance, players in order within one); `get_starts()` is then
  renumbered so `starts[i].owner == i + 1`. The local player is the first
  human (fog owner). Each player gets the standard start (Town Center + 5
  villagers), his stockpile (low 150/150/100/0, standard 300/300/200/20,
  high 1000/1000/750/50, deathmatch 10000/10000/10000/100), and each AI seat
  an `EnemyAI` with its difficulty (`combat.ai()` stays the ENEMY's: a
  disabled placeholder when player 2 is human). Victory is turned on.
- **Teams** (`Sim::team`, `team_of`, `is_enemy`, `is_ally`; `new_game`
  gives every player a team of his own, the browser's rule): `is_enemy` is
  no longer static and every enemy test goes through it, so allies are never
  auto-targeted, attacked by a right-click / attack order, hit by splash,
  Town Center arrows, a Lightning Storm, Bolt or Meteor, nor aimed at by the
  AI's waves and god powers. The fog stamps the sight of the fog owner's
  allies too (shared vision). Victory is per team (see `victory.h`): a player
  is out when his last Town Center falls (`player:defeated`), a team when
  all its players are; the match is decided when one team is left (it
  wins) or the local player's team is out (defeat). `get_victory()` has
  `winner_team`. HUD: the score list is grouped by team ("TEAM 1" headers
  with the team's total, the local team first) whenever a team has two
  players; the feed says "<name> has been defeated.", the result card
  "Every enemy Town Center has fallen." / "Your team's last Town Center has fallen.".
- **Maps**: `skirmish` and `battle` place 3..6 players on a ring (radius
  0.35 x size, evenly spaced, Godot passes only; 2 players keep the
  browser's diagonal), `stress` already did. A Godot-only pass,
  `balance_starts` (after connect_starts, before the woodlines), gives any
  start the generator shortchanged (a neighbour's forest or a lake on the
  spot) its gold mine (11-14 tiles out) and berry patch (9-12 out);
  `get_mapgen_info().balanced` counts what it added.
- **AI difficulty** (`AIParams` / `ai_params(d)` in `combat/enemy_ai.h`;
  Moderate = the browser's EnemyAI unchanged): Easy thinks every 2 s, stops
  at 14 villagers, one academy queue slot, waves of 5 (+2) from 7 min every
  200 s, one worshipper, a god power decision every 30 s, no Classical Age
  before 12 min. Hard: 30 villagers, academy at 8, a second academy at 20,
  queue 4, waves of 8 (+5) every 104 s, 4 worshippers, storms on 5+ men,
  food-heavy gathering that stops banking gold, houses built earlier, keeps
  training while saving for the age. Titan: all of Hard and faster (thinks
  every 0.75 s, 34 villagers, 3 villager slots, second academy at 16, waves
  of 10 (+6) every 92 s, 5 worshippers, a power decision every second,
  storms on 4+) plus **+20 % gather rate** (`Player::gather_mult`) and +150
  food / wood / gold. `set_ai(owner, {difficulty: "hard"})` switches one;
  `get_ai(owner).difficulty`, `get_player(id)` {team, human, difficulty,
  gather_mult}. Fortifications scale too (Godot rules): Easy at most one
  tower, Moderate one tower and Watch Tower, Hard three towers and a wall
  ring from 9 min, Titan four towers and the ring from 6 min (see "Enemy
  AI: fortifications").
- Game speed and visibility stay main.gd's (`timescale`, `fog` args).

```
godot --headless --path godot -s res://game/core/match_check.gd [-- --only=maps,vision,victory,teams,difficulty,main] [--seeds=6]
```

`match_check.gd` ("MATCH PASS|FAIL <case>", `MATCH_RESULT {json}`, exit =
failures, ~50 s): **teams** (two 20-minute 2v2s of Hard AIs: no damage
event from an ally, no attack order on one, thousands of hits on enemies),
**vision** (the ally's town and men visible, the enemy's not), **victory**
(2v2: one enemy down goes on, both = won; my TC down with the ally standing
goes on, both = lost; FFA of 3; an AI 2v2 plays to a team result),
**maps** (195 maps: 2-6 players x 96..256 x skirmish / battle / stress x
seeds: the start count, each start's mine, berries and woodline, all
reachable, spacing even), **difficulty** (AI vs AI, seats swapped every
other seed: Hard beats Easy, Titan beats Moderate, Hard beats Moderate,
Moderate beats Easy in most seeds; peaceful villagers at 6 min /
population at 9, wave men per minute and casts per minute ordered Easy <
Moderate < Hard < Titan), **main** (the setup screen's settings through
main.gd: players, teams, difficulty, colours, resources, speed, fog, the
team score list). Today: Hard 6/6 over Easy, Titan 5/6 over Moderate (one
undecided), Hard 4/6 over Moderate, Moderate 3/3 over Easy; peaceful
villagers at 6 min 14 / 22 / 30 / 35.

## Walls and gates: the look (game/buildings/walls.gd)

Greek stone walls and gates after Age of Mythology: Retold
(`reference/walls/walls_01`, `walls_02`, `gate_01..04`, `combat_01`,
`place_01`), drawn by `game/buildings/walls.gd` (a child of the buildings
piece; `buildings.gd` hands it every building whose type name contains
`wall` or `gate` and skips them itself, as it skips any type with no
exported model). Models: the Godot-only `walls` group, authored in JS in
the buildings' style and palette and meshed by the browser's mesher
(`node scripts/export-walls.mjs`, ~5 s, deterministic; re-run it after
changing the script, never hand-edit `assets/models/walls.*`). Voxel = 1/8
tile (twice the buildings' resolution: crenels, the meander and dentils need
it); every model is pivoted at its tile centre, walls run along +x.

- **Profile**: a stone skirt hanging 0.75 below the ground (slopes), a
  plinth with a team ledge, ashlar in running bond, a gilt fillet, the
  **team-colour meander** on a dark band (period 8 = one tile, the back face
  mirrored, so the key runs on unbroken across tiles, arms and turned
  pieces), dentils, a projecting cornice that is the paved wall-walk, then a
  single parapet on the **outer** side only (a team band under plain stone
  merlons, period 4, continuous from tile to tile) and a low stone curb on
  the inner side. Every curtain piece has this one section at one height,
  so a run has one wall-walk and one row of merlons. Each piece is turned so
  its parapet faces away from the owner's nearest Town Center (`arm_m` is
  the arm with its parapet mirrored, for turned arms). `pillar` (1.5 tiles,
  1.5x the wall's height: quoins, team stripes, the team meander between
  gilt fillets, a hollow crenellated top in plain stone), `pillar_flag`
  (with a pole and three team pennants, at line ends), `pillar_gate` (the
  gate tower: 1.75 tiles, taller still, a flag). The team colour is in the
  bands, the frieze and the flags, never on the merlons.
- **Layout** per tile from an occupancy grid (works for 1 x 1 pieces and
  1 x n segments alike): a tile links to its 4 neighbours of the same owner
  (to a gate only along the gate's axis) and to a diagonal one when no
  orthogonal tile joins the two. A straight tile is `seg/<v>` (3 stone
  variants by tile hash). Pillar tiles: the sim's `wall_pillar` pieces,
  every end, corner and junction (so each run ends flush inside a pillar,
  never butting into the next run), and for static walls with `auto` one
  every <= 5 tiles of a run; beside a gate a pillar is a gate tower. Only a
  corner right next to a pillar (a 1-tile jog, a staircase line) and
  diagonal joins are built from an `arm` per link round a `core` (a
  diagonal arm is the arm turned 45 degrees and stretched by sqrt 2).
- **Gates** (`gate<L>`, L = 1..5 tiles along the axis: the paved threshold
  and a sill between the two gate towers, which overhang it by 3 voxels):
  two door leaves (`gate<L>/leaf`: planks, iron bands and studs, the team
  meander trim) are MeshInstances that swing 90 degrees inward (towards the
  owner's nearest Town Center) in 0.7 s, as far as the sim's
  `get_buildings().fort_open` (0..1); without it (static walls) open while a
  unit of the owner or an ally is within 2 tiles.
- **States**: under construction `/s0..s3` (floor(progress * 4): 0 = the
  staked-out foundation, stakes with team pennants and a rope; 1..3 = the
  courses rising inside a timber scaffold with ledgers, braces and a
  pennant; the leaves appear once the gate is finished); damage `/d1` below
  2/3 hp (merlons knocked off, cracks, chipped arrises, split planks on the
  leaves), `/d2` below 1/3 (the top broken in one jagged line, the same
  through the wall's thickness, a tower's on a slant; open cracks, rubble at
  the foot, the leaves half gone). Chips only along the break.
- One MultiMesh per model (team colour per instance, AO baked once per model
  by `building_ao.gd`), laid out again only when the set of pieces, a state
  or what is explored changes (~3 ms for a 180-tile ring; the first wall of
  a run loads and bakes the models, ~0.2 s). `walls.set_static(entries)`
  draws render-only walls (`{kind: wall|pillar|gate, owner, tx, tz, w, h,
  built, progress, hp, max_hp, open, auto}`). `AOV_WALLS_DEBUG=1` prints
  the pieces per model and the rebuild time.
- Not yet: the Wooden Wall stage (level 0 in `get_walls().level`) is drawn
  in stone like the later stages (Retold's Archaic palisade, `walls_03`).

Capture scene `walls`: the `town` scene's town ringed by the sim's own
walls (`place_wall` lines built by 40 villagers, stepped in the setup; two
segments turned into gates with `convert_to_gate`: the south one closed,
the east one open with villagers walking through it; the south-west stretch
placed last and only begun: foundations and the three scaffold stages; the
east side north of the open gate damaged to d1 and d2), the camera outside
the south-east corner like `walls_02`. `--walls_static=1` (or a sim without
`place_wall`) draws the same ring as static walls.

```
node scripts/godot-shoot.mjs --scene walls --out shots/godot/walls.png
     [--params "cam=48,100,44,52,45"]      # the same ring at the skirmish camera's distance
     [--params "walls_static=1"]           # render-only walls (no sim pieces)
node scripts/export-walls.mjs             # re-export godot/assets/models/walls.*
```

## Towers: the look (game/buildings/towers.gd, game/combat/tower_fire.gd)

Greek towers after Age of Mythology: Retold (`reference/walls/tower_01..05`),
drawn by `game/buildings/towers.gd` (a child of the buildings piece;
`buildings.gd` hands it the `tower` rows and skips them itself). Models: the
Godot-only `towers` group (`node scripts/export-towers.mjs`, ~3 s,
deterministic; re-run it after changing the script, never hand-edit
`assets/models/towers.*`), the walls' voxel (1/8 tile), palette and team
trims; pivot at the 2 x 2 footprint centre, the door to +z (like the
buildings' fronts). One model per stage, chosen by the owner's tower level
(`get_walls().level` of the tower, else `get_fortify(owner).tower_level`):

- `0` **Sentry Tower** (`tower_05`): a wooden stilted lookout: four logs on
  stone pads, X braces and girts, a ladder, a plank platform at 4 world
  units with a boarded railing (loopholes) and a **team rail**, posts to a
  stepped plank roof with team eaves, a team pennant.
Each stone stage has its own silhouette on the same 12 x 12 shaft (quoined
corner pilasters on dark base blocks with **team bands**, a door with a
marble frame and lintel):

- `1` **Watch Tower** (`tower_02`): a slim warm limestone shaft, ivy, a
  dentilled cornice, a lantern room of paired arched windows, a red tile
  gable roof with marble pediments and the **team ridge**.
- `2` **Guard Tower** (`tower_03`): grey stone, deep panels with arrow
  slits, two ledges; **corbelled machicolations** (a bracket every 3 voxels
  stepping out 3) carry a crenellated gallery (parapet with a **team
  band**, merlons), two **archers** (team tunics, bronze helmets, bows) on
  the walk; a set-back lantern under a terracotta **pyramid roof** with team
  hips; **team banners** hung from the gallery.
- `3` **Ballista Tower** (`tower_01`): pale dressed stone, an **open-frame**
  shaft (the pilasters clear of a deep dark slot, a vine inside), the
  walls' **team meander** under heavy two-tier brackets that carry a broad
  **fighting platform** (20 x 20, gilt-capped merlons), three archers and the
  **ballista** through the front crenel, a columned pavilion with a brazier
  under a bronze-green pedimented roof (gilt lion, acroteria).
- Stone and windows: dark mortar beds every course, darker head joints, a
  worn pale top arris per course (`masonry(..., arris)`), then `weather()`:
  convex vertical edges worn light (here and there chipped dark), ledge
  tops lighter, the undersides of every overhang darker. Lantern windows
  are 2 voxels deep with a gallery behind and a dark cella core whose face
  behind each window is lamp-lit (low glow: the grade turns strong emission
  pastel), so a window shows depth and warm light, not a flat void or the
  sky.
- States: `<L>/s0..s3` under construction (floor(progress * 4): 0 = the
  staked foundation with team pennants and a rope, 1..3 = rising in a timber
  scaffold), `<L>/d1` below 2/3 hp (chips, cracks), `<L>/d2` below 1/3 (the
  roof broken off in a jagged line, rubble); `upgrade` (a scaffold round the
  upper tower) stands while a tower stage is being researched at it
  (`get_walls().tech`). `towers.level_override[id]` / `model_override[id]`
  (`"2/s1"`, `"1+upgrade"`) draw one tower in another state (scenes).

**Tower fire** (`game/combat/tower_fire.gd`, child of the combat piece,
closed form in the sim time; the sim's projectiles whose start is a
tower's centre, `Combat::fire` at `TOWER_ARROW_Y`): a warm flash at the
lantern window / platform rail on the target's side and a puff of bow dust
for 0.45 s after the loose; the tower's arrow drawn heavier over the sim's
(x1.45 sentry .. x2.1 ballista bolt) with a **trail** along the last 30% of
its arc (`tower_streak.gdshader`: six camera-facing ribbon segments, an
amber edge round a hot core, widening to the head, >= 4.5 px wide at
1080p) and a glint on the head; at the strike (`unit:damaged` with `other` = the tower) a short
flash and a puff of kicked-up earth (the hit spark is AovUnitView's).

Capture scene `towers`: the `town` scene's town with four towers in a row
on its south side, Sentry, Watch, Guard, Ballista from the camera outwards
(`level_override`), an enemy squad of hoplites attack-moving on them, the
camera low (distance 25, pitch 19) and focused just behind the row so the
tower tops are in frame; the
setup steps the sim (>= `towers_t` s, default 3) until an arrow has just
left a tower while another is in mid flight, so the paused frame shows the
loose, an arrow in the air and a strike.

```
node scripts/godot-shoot.mjs --scene towers --out shots/godot/towers.png
     [--params "towers_t=6"]               # fight longer before the frame is chosen
     [--params "towers_states=1&cam=31,111,30,30,0"]   # a row of states: s0..s3, d1/d2, upgrade
node scripts/export-towers.mjs            # re-export godot/assets/models/towers.*
```

## Walls, gates, towers: placement (game/ui)

With villagers selected the build grid has **Build Wall (W)** and the tower
(**Y**, named after the owner's tower stage, its portrait the stage's model);
tooltips give the cost (per tile for walls), the stage's hp / range and the
age. Portraits of wall pieces, gates and towers are composed from the
`walls` / `towers` models (`portraits.gd`, `fort()`).

- **Wall mode** (`ui._mode.kind == "wall"`): the ghost follows the cursor
  tile; left press starts a line, dragging shows what `plan_wall` would lay,
  one ghost per tile (the pillar / segment model, turned along the line):
  green where it can go, red where a tile is blocked or unexplored (or every
  new tile when the line is unaffordable), gold on tiles of the player's wall
  it joins. A box by the cursor gives the tiles, the total wood / gold (red
  when short) and why it cannot be built. An end on one of his wall tiles, or
  within one tile of one of his pillars (an end or corner), snaps onto it, so
  lines join. Release calls `place_wall` with the selected villagers, who go
  and build the foundations; Shift keeps the mode for the next line; Esc /
  right-click cancels. `ui.wall_preview` = {a, b, tiles, state, new_tiles,
  blocked, cost, ok, afford, reason, dragging}.
- **Tower**: placed like any building; its ghost is the stage's model with
  its range ring; a selected finished tower shows its range ring too.
- **Commands** on a selected finished piece of one's own: a wall segment
  **Convert to Gate (G)**; a gate **Lock / Unlock Gate (L)**; any wall piece
  the next wall stage, a tower the next tower stage (**U**, disabled with
  "Requires the <age> Age" until then); while one researches, **Cancel (X)**
  (refund). The selection card shows the stage name (Wooden Wall, Watch
  Tower, ...), a tower's damage and range, a gate's state and research
  progress. The feed says "<stage> finished." once a player's last wall
  foundation is done (not per piece) and "<tech> researched.".

The real-input playtest (`game/core/walls_playtest.gd`, ~5 min on lavapipe, ~15 at 0.4 FPS under load;
harness shortcuts: AI off, resources granted, enemy soldiers spawned and
ordered by script, the sim stepped fast while frames render):

```
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
  godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
  -s res://game/core/walls_playtest.gd -- --scene=skirmish [--shots=/abs/dir]   # "WALLSPLAY ok|FAIL <step>", exit = failures
```

It box-selects the villagers, checks the Wall / tower buttons and tooltips,
W, a drag across the Town Center (red blocked tiles) dropped with Esc, four
Shift-drags of a closed 7 x 7 ring (each later line started a tile off the
last corner: snapped and joined; green ghosts and the cost checked mid-drag;
every line placed on exactly the dragged tiles and paid), the villagers
building it all, a click on a segment + the Convert to Gate button, L locks
and the Unlock button unlocks, enemy soldiers ordered into the ring stay
out while the player's own (box select, right-click) walk in through the
gate, Y + a click places a tower (ghost and range ring), group 1 + a
right-click walks the builders off it and a click on a footprint spot no unit
covers selects it (units win picks, so a click on the crowd would select a
villager; the click is retried as the sim runs between frames), its upgrade refused
before the Classical Age (U), H + A advance the age, the Watch Tower button
researches it (range up, card title), and the tower alone shoots an enemy
(the player's units are removed first, the foe stands away from the Town
Center, and every hit is attributed from the
`unit:damaged` events). After the gate is made, the gate unlocked and the
upgrade finished it also checks that the tooltip under the resting mouse
describes the command now in that slot (the hud re-reads the zone under the
cursor every frame, `ui._refresh_hover`, so a slot whose command changes
without a mouse move never keeps the old tooltip).
`--shots` saves the blocked drag, the green drag, the foundations, the
gate, the tower ghost and the upgraded tower.

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
  degrees like `setView`. Input as the JS (arrows, edge scroll, middle-drag
  pan, wheel zoom, eased), plus Godot-only turning: Alt / Ctrl + middle-drag
  (yaw, pitch 30..70), `[` / `]`, Home resets. The camera owns the
  fog-of-war pass (`AovFogView`, a full-screen quad drawn last in the
  transparent pass: world position from the depth buffer, the JS
  `applyFogOfWar` factor from `get_fog()` uploaded on `fog_version()`
  changes, unexplored = black under the depth haze, graded to the browser's
  frame); hidden when the map is revealed. Entities in the fog are hidden by
  their renderers. Scene cameras in `game/core/scenes.gd` use the JS
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
  row order (= id order = JS Map order). `generate_map` runs the browser's
  generator bit for bit and then Godot-only passes (the browser build is
  frozen, so the Godot map may now differ from it): **every start is
  connected on foot to the others** (`connect_starts` in `game_map.cpp`:
  when the forest noise closes a band of trees across the map or a lake cuts
  it in two, the cheapest route is cleared, a lane three trees wide, and
  water / cliffs on it are graded into a causeway or ramp; 5 of the first 40
  skirmish seeds needed it, none of the scenes' seeds do), and **every start
  gets a woodline** (`place_woodlines`: 28 trees in a band about 10 tiles
  along, their centres 8.5-13.5 tiles from the Town Center's centre, in the
  direction nearest the start forest's that keeps 50 degrees clear of the
  start gold and berries and 40 of the Town Center's south door; open ground
  only, a tile gap round mines and bushes, and a flood fill rejects a band
  that would cut any tile off; its own RNG, so the rest of the map is
  untouched). The planned towns (`layout_town`: town, hud, coast, stress)
  clear trees from their streets and lots, so there the plan decides what is
  left of it. `AovSim.get_mapgen_info()` = {felled, graded, woodline, balanced};
  `set_godot_rules(false)` before `new_game` gives the browser's map. The whole core
  (entities, units update / spread, pathfinding, movement, commands) is
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
  EconomyView keys), `combat/arrow|debris_*`. Godot-only models (no JS
  builder) are authored in the same format by their own scripts:
  `walls/*` by `scripts/export-walls.mjs` (see "Walls and gates: the look"),
  `towers/*` by `scripts/export-towers.mjs` (see "Towers: the look").
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
order `lighting, terrain, buildings, units, economy, combat, godpowers, ui, perf`
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
`get_player_ids()`, `is_enemy(a, b)`, `is_ally(a, b)`, `get_team(id)`,
`get_local_player()`, `setup_match(cfg)` / `start_match(cfg)` (see "Match
rules"), `set_player_resources(owner,
{food, …})`, `set_player_age(owner, age)`.

Entities: `unit_type_names()` (type index -> key), `get_unit_def(key)`,
`spawn_unit(type, owner, x, z, rot=0)` -> id (0 = refused off the map, -1
unknown type; see "Map bounds"), `spawn_block(type, owner,
count, x, z, cols=0, spacing=1, rot=0, jitter=0.15)` -> ids (helpers.js
spawnBlock; units that could not be placed are left out), `spawn_resource(type, tx, tz, variant=0)` (0 off the map), `remove_resource(id)`,
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
  6 attack, 7 attack_move), `target` (order target id), `flags` (Byte: 1 moving, 2 dead,
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
(formation move), `order_attack_move(ids, x, z)` (formation attack-move,
Godot-only, see "Attack-move"), `order_idle(ids)`, `smart(ids, x, z, target_id=0)`
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
`get_building(id)` (incl. `queue` [{type, t, total, free}], `rally`).

Fortifications (Godot-only, see "Walls, gates, towers"): `plan_wall(owner,
a, b)`, `place_wall(owner, a, b, builders=[])` -> {ok, reason, ids},
`convert_to_gate(id)`, `set_gate_locked(id, on)`, `research(building, key)`,
`cancel_research(building)`, `fort_tech_names()`, `get_walls()`,
`get_fortify(owner)`; `get_buildings()` also has `fort_open`, `fort_locked`.

**Free villager** (Godot-only rule, `Economy::rescue`, checked once a
second for every player, AI included): a player who still owns a completed
Town Center, has no living villager and none queued, and cannot afford one
would be stuck for good, so that Town Center trains one villager for free
(normal train time, at the head of its queue, population cap ignored) and
emits `villager:free`; the HUD feeds "Your Town Center calls a new
villager." to the local player. It cannot stack: the rule never fires while
a villager is queued. Checked by
`godot --headless --path godot -s res://game/core/softlock_check.gd -- --scene=skirmish`
("SOFTLOCK ok|FAIL <step>", exit = failures).

Economy: `train(building, unit_type)` / `advance_age(owner)` -> {ok,
reason}, `cancel_train(building, index)` (a free villager refunds nothing), `next_age_cost(owner)`,
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
`set_ai_enabled(on)` (the ENEMY's EnemyAI), `add_ai(owner)`, `get_ai(owner)`
({enabled, wave_size, next_wave_at, aggression, waves: [{t, target, x, z,
units}], casts: {power: n}, difficulty, fort: {towers, wall_lines,
wall_tiles, gates, upgrades, repairs, focus, avoided, retreats, reopened,
patched, dropped, ring_at, ring_done_at, ring_state, ring_r, lines_left,
line_cost, unbuilt, gaps: [{a, b, state, seg}]}}) / `set_ai(owner, {enabled, next_wave_at, wave_size, aggression, difficulty,
wall_at, towers_max, breach_focus, fort: false, fortify_now: towers})` (the
last five Godot-only: a ring from that time, the tower count, the breach
focus, no fortifications at all, a finished fortified town now),
`get_combat()` ({projectiles: 16 floats each (x, y, z, px, py, pz, sx, sy,
sz, tx, ty, tz, t, dur, arc, dist), projectile_info: 2 ints (target, has
target pos), stuck: 7 (x, y, z, dx, dy, dz, t), scars: 5 (x, z, radius,
dirt, blood), drops: 9 (kind shield/helmet/spear/stub, x, z, rot, owner,
tilt, roll, lift, die time)}). `get_units()` also has `air` (3 each: airY,
airRx, airRz), `stagger` (2: stagT, stagK), `melee_t`, `gp_hit_t`,
`hit_time` (game times, -1 never), `kit` (255 unset).

God powers: `power_names()` (lightning_storm, bolt, meteor; hotkeys Z / C
/ V in their defs, Godot: the browser's X for Bolt is the Stop command, so
it only worked with nothing selected; ui.gd checks the power keys first and
shows them in the button tooltip and the gear's hotkeys card),
`get_power_def(key)`, `can_cast(owner, key)` -> {ok, reason},
`cast_power(owner, key, x, z)`, `power_cooldown(owner, key)`,
`get_godpowers()` ({time, storms: 6 each (owner, x, z, t0, duration,
radius), bolts: 6 (x, y, z, t0, life, sky) + bolt_seeds, scorches: 6 (x, y,
z, t0, size, blast) + scorch_seeds, zaps: 5 (x, y, z, t0, life) + zap_units
(id, seed), meteors: 9 (owner, x, z, t0, delay, radius, sx, sy, sz), fires:
6 (x, y, z, r, t0, dur)}).

**Enemy AI god powers** (Godot-only, `EnemyAI::use_powers`): every 2 s each
AI player looks at the enemy units within 12 tiles of one of its soldiers
or 16 of one of its buildings and casts through the same
`GodPowers::can_cast` / `cast` as the HUD (favor and cooldowns exactly as
for the player): a Lightning Storm on the densest cluster if it catches at
least 6 men (counted within the storm's strike radius, 0.78 x 7.5), else a
Meteor on a clump of at least 2 enemy buildings next to its army or on 8+
men, else a Bolt on a myth unit or hero (a plain soldier only with 70+
favor to spare; never a villager). No random draws: ties go to the first
candidate in row order. The HUD feeds "<name> uses the <power> God Power!"
when an enemy casts.

**Fight back while moving** (Godot-only, `Combat::damage` / `engage`,
event-driven: nothing runs for a unit that is not hit): a unit on a plain
`move` (not a villager, not leashed) struck by an enemy *unit* within its
sight, ahead of it or beside it (dot(direction of travel = towards its
current waypoint, direction to the attacker) > -0.25), stops and attacks it;
the men of the same owner on a plain move within 4 tiles for whom the
attacker is also ahead or beside turn with it (one hash query per
retaliation). The attack remembers the move (`am_resume` / `am_x` / `am_z`
unit columns; any new order clears them in `Commands::set`): when the foe
dies the man takes on an enemy within 4 tiles that is fighting and not
behind him (the attacker's comrades), else walks on to his destination; a
foe beyond his sight for 2 s is dropped the same way. Struck from behind
(moving away from the fight) he keeps going: a move away is a retreat.
Town Center arrows never stop a move. The browser's rule (an AI unit on a
move fights back from any side, and stays) applies with the rules off.
`get_unit(id).resume` (0 none, 1 move). Checked by
`godot --headless --path godot -s res://game/core/attackmove_check.gd -- --scene=skirmish`
("ATTACKMOVE PASS|FAIL <case>", `ATTACKMOVE_RESULT {json}`, exit = failures).

**Attack-move** (Godot-only order `attack_move`, `O_ATTACK_MOVE` = 7 in
`get_units().order`; `AovSim.order_attack_move(ids, x, z)` is the formation
version: `Commands::move(rows, x, z, O_ATTACK_MOVE)`, the same slots and
the same shared group path as a formation move; `order(id, {type:
"attack_move", x, z})` for one unit): order_x / order_z = destination,
order_b bit `AM_THEN_BUILDINGS`. The unit walks there and, every 8 ticks
(staggered by id: `(tick + id) % 8`) and on arrival, looks within its sight
through the spatial hash (`Combat::am_pick`): enemy military units first
(myth units and heroes rank as military), then villagers, then buildings
(a pass over the buildings only when no unit is in sight), nearest first.
Found: an attack (`engage`, no ATK_AUTO, so the AI never redrafts the men
into a new wave) that remembers the attack-move; ranged units keep their
range (the attack order's own approach). While on a villager or a building
it turns on a soldier that comes into sight; a hit from any side engages the
attacker. When the foe dies (or stays beyond its sight for 2 s) it takes the
next one in sight or walks on. On arrival with nothing in sight it goes
idle, or with `AM_THEN_BUILDINGS` attacks the nearest enemy building with
ATK_THEN_BUILDINGS (the browser's wave order). Villagers given one simply
move. **The enemy AI's waves** (`EnemyAI::update`, rules on) attack-move to
the target building's centre with `AM_THEN_BUILDINGS` instead of the
browser's direct attack on it. Since waves now fight the enemy's waves on
the way, two more Godot-only AI rules keep matches from stalling: idle
soldiers more than 30 tiles from their Town Center (a Lightning Storm drops
the men it throws idle) attack-move on to the target, and a wave overdue by
a whole interval (120 s / aggression) leaves with at least 6 men even when
the army cannot grow to `wave_size` (a starved economy). `get_unit(id).resume` 2 = fighting on an
attack-move. UI (`ui.gd`): with soldiers selected the command grid has
Attack-Move (slot 13, key **A**, tooltip "Attack-Move (A)"); A / the button
enters the `attack_move` targeting mode (the god powers' mode machinery:
cross cursor, an orange ring under it, Esc or right-click cancels), then a
left-click on the ground or the minimap attack-moves the soldiers there (the
rest of the selection moves; an orange marker and "Attack-move"), a
left-click on an enemy is the normal attack. A is also the Town Center's
Advance Age key: the two never share a command grid (buildings vs units),
so they do not clash; the gear's hotkeys card lists both.
`attackmove_check.gd` cases 3 and 4.

**Map bounds** (Godot-only safety; changes nothing for a point on the map, so
parity holds): the world is `[0, size) x [0, size)` tiles. Every world
position that becomes a grid or array index (map columns / tiles, fog,
spatial hash, resource index, AI reach cells, A*) goes through
`sim/core/bounds.h` (`floor_clamp`, `cell_span`: clamp in double before the
cast) or `GameMap`'s `in_world`, `walkable_at`, `level_at`, `tile_clamp`,
`clamp_to_map`, `rect_in_tiles`, so no coordinate (off the map, huge,
infinite, NaN) indexes out of range or hits an undefined float -> int cast.
The segfault this fixed: `SpatialHash::for_each_near_xz` clamped only one
end of each cell range, so a query centred far off the map in x (a unit
spawned at x = 1e9, z on the map, in the spread pass) read `start[]` far
out of range. Policy per entry point:
- unit spawns (`Units::spawn`, so `spawn_unit`, `spawn_block`, training): a
  point on the map is used as given (walkable or not, as the browser); a
  point off it is clamped onto the map and the unit goes to the nearest
  walkable tile within 8 tiles of that edge point (the clamped point itself
  when its tile is walkable); none there, or NaN: nothing spawns, no RNG
  drawn, `spawn_unit` returns 0;
- move / attack-move / formation / smart orders, `move_to`, rally points,
  god power targets (and each storm strike), boats, shoals, herds: an
  off-map point goes to the centre of the edge tile (`clamp_to_map`: 0.5 or
  size - 0.5 on that axis); NaN refuses the command (the unit keeps its
  order, a power is not paid for);
- buildings and resources: a footprint not wholly on the map is refused
  (`can_place` false, `place_building` / `spawn_building` /
  `spawn_resource` 0; tiles range-checked in 64 bits);
- nothing moves a unit off the map (movement's "escape if embedded" step,
  knock-back, thrown units, spread, boats all stay on it); the accessors
  (`height_at`, `smooth_height_at`, `is_explored`, `is_visible`,
  `nearest_resource`, `units_near`, `find_path`) take any input;
- UI: `pick_ground` returns null off the map, `minimap.to_world` clamps.
Checked by
`godot --headless --path godot -s res://game/core/bounds_check.gd -- --scene=skirmish`
("BOUNDS PASS|FAIL <case>", `BOUNDS_RESULT {json}`, exit = failures): spawns
at negative, beyond-size, huge, infinite and NaN points (and an edge of the
coast map with no walkable tile, refused), orders, placements and every god
power at off-map points, then 90 s of play with the AI on, no unit ever off
the map.

**Walls, gates, towers** (Godot-only, `native/src/sim/fortify/`, class
`Fortify` = `Sim::fortify`; Age of Mythology: Retold's Greek fortifications,
`reference/walls/`). Pieces are building rows of the types `wall` (a straight
segment, 1 x n tiles, n <= 4), `wall_pillar` (1x1), `gate` and `tower` (2x2),
appended to `building_type_names()`, so construction (villagers on O_BUILD,
several builders faster: rate x n^0.75), damage, death, fog sight and the
builders moving on to the next unfinished piece are the buildings / combat
systems'. Stone does not exist here: everything costs wood + gold.
- **Walls**: `place_wall(owner, a, b, builders)` (a, b world points; their
  tiles are the line's ends) lays a 4-connected line (one step in x or z at a
  time: no diagonal gap), joins the owner's existing pieces (those tiles are
  skipped) and leaves a gap at blocked tiles; each run of new tiles gets a
  pillar at both ends (none next to a joint), at corners with two 2+ tile
  arms and evenly so no segment exceeds 4 tiles, segments in between. 4 wood
  + 2 gold and 3 s (one builder) per tile, paid at once; foundations block
  at once. `plan_wall(owner, a, b)` is the same without placing (the UI
  ghost). Every piece blocks its tiles for everyone (A*, group fields,
  attack-move, the movement step all go round it); destroying one unblocks
  them. Stages (player-wide, researched at any wall piece): Wooden Wall
  (Archaic, 200 hp per tile), Stone Wall (Classical, 150 w + 100 g, 40 s,
  450), Fortified Wall (Heroic, 250 + 200, 50 s, 700), Citadel Wall (Mythic,
  400 + 300, 60 s, 1000); pillars x1.5. The map passes (connected starts,
  woodlines) run at map generation, before any wall exists.
- **Gates**: `convert_to_gate(segment)` (finished segment, 30 w + 20 g; same
  id and rect, hp x1.25). Its tiles stay blocked and `GameMap::gate_pass`
  (bit per owner) lets the gate owner and his allies through:
  `Pathfinder::pass_owner` (set before each search: Movement uses the unit's
  owner, `Commands::move` the first mover's for the group field;
  `AovSim.find_path` -1) and the movement step (`GameMap::walkable_at_for`);
  the path cache keys on it while gates exist. Every other walkability test
  (placement, spawns, `nearest_walkable`, spread, knock-back) sees a gate as
  a wall. `set_gate_locked(id, on)`: nobody passes. `fort_open` (0..1, in
  `get_buildings()` and `get_walls().open`) is the leaves' state: open while
  a unit allowed through is within 2.5 tiles, 0.4 s swing.
- **Towers**: `tower` (2x2, 120 w + 60 g, 30 s) shoots homing arrows
  (`Combat::fire`) at the nearest enemy unit in range, no garrison. Stages
  researched at a tower, applied to all the owner's towers (hp scaled with
  the new max): Sentry Tower (hp 750, range 10, damage 6 / 1.5 s, sight 12),
  Watch Tower (Classical, 100 + 100, 30 s: 1000, 11, 8), Guard Tower
  (Heroic, 200 + 200, 40 s: 1400, 12, 10 / 1.4 s), Ballista Tower (Mythic,
  300 + 300, 50 s: 1800, 13, 16 / 2 s). `research(building, key)` ->
  {ok, reason} ("Requires Classical Age", "Research the previous stage
  first", ...), `cancel_research(building)` refunds, event `tech:researched`.
- **Combat rules** (rules on): a building's arrows (Town Center, tower) never
  damage a friend; pieces have their own armor on top of the 0.35 building
  factor (walls: arrows x0.15, melee x0.6; towers x0.4 / x0.8; myth units and
  god powers x1). Walls are never picked by attack-move scans, wave targets
  or the "then buildings" sweep; a unit whose attack target is walled off
  (its last path search did not reach: `units.path_blocked`) attacks the
  nearest enemy wall piece within 6 tiles, then goes back to its target
  (the AI's waves breach a ring this way). The real target, a building or a
  unit, is kept in `order_a` with the `ATK_BREACH` bit (combat.h) while the
  man breaks the wall: switching to an enemy unit near the piece (a
  repairer) or to the next piece keeps it, and when the piece falls he heads
  for that target before any other foe in sight. A man whose target was
  walled off on this order (`ATK_BROKE_IN`) that finds the target dead and
  no foe in sight attacks the nearest enemy building (not a wall) within
  twice his sight instead of standing idle in the hole.
- **Repair** (rules on, any building): a build order (right-click) on a
  damaged finished building of one's own heals it for free at half the
  build rate x builders^0.75 (`REPAIR_RATE`).
- Render data: `get_walls()` = {count, ids, kind (0 pillar, 1 wall, 2 gate, 3
  tower), owner, rect (4 each), hp, max_hp, built, progress, axis (0 along
  x, 1 along z), conn (bits 1 -z, 2 +x, 4 +z, 8 -x: a neighbour tile is his
  wall piece), level (the owner's stage), open, locked, tech (research in
  progress: `fort_tech_names()` index + 1), tech_t (0..1)};
  `get_fortify(owner)` = {wall_level, wall_name, wall_tile_hp, tower_level,
  tower_name, tower {hp, range, damage, cooldown, sight}, techs [{key, name,
  line, level, min_age, time, cost, state: done / available /
  needs_previous / needs_age / researching}], walls, gates, towers}. Events
  `gate:changed` (a = 0 converted, 1 locked, 2 unlocked), `tech:researched`.
Checked by
`godot --headless --path godot -s res://game/core/walls_check.gd [-- --seed=7 --only=...]`
("WALLS PASS|FAIL <case>", `WALLS_RESULT {json}`, exit = failures, ~3 s):
plan, build (a 13 x 13 ring by 8 villagers; 4 builders > 1), keepout (single
A*, formation, group field, attack-move, right-click: nobody inside),
gate (owner and ally in, enemy out, leaves open for them only, locked keeps
the owner out), repair (free, 4 hands faster), breach (soldiers break a piece
to reach a house inside; its tiles walkable again; the whole army goes in and
razes the house, none idle outside; the same with a villager as the target in
a fresh ring: they break in and kill him), towers (kill an enemy in
range, never an ally / own unit; Town Center arrows never hit an ally),
upgrades (each stage's age, range / damage / hp up, arrow damage measured;
Stone Wall hp x2.25), determinism (two runs bit-equal), rules_off.

- **Walled-off goals fail fast** (`Pathfinder::regions`, on while walls
  stand): a search that does not reach its goal floods the goal's region
  (4-connected, walkable for `pass_owner`, at most 4096 tiles); while that
  region is closed and holds no start, later searches into it are not run
  (a failed A* expands `max_nodes` = 12000 for nothing, ~1.5 ms): the path
  goes to the walkable tile outside it nearest the goal (6000 nodes; else
  the wall face on the line to the start), `last_found = false`, so the
  breach rule works as before. A flood stays valid while no walkability
  change (`GameMap::pass_log`, the tile rect of every block / unblock /
  passability / gate mask change) touches its box; a closed one that was
  touched is flooded again on the next search (~40 us) instead of failing
  an A*. Profile rows `pathCut`, `pathFail`, `pathFlood`.

**Enemy AI: fortifications** (Godot-only, `native/src/sim/combat/enemy_ai_fort.cpp`,
`AIParams` towers_max .. breach_focus in `enemy_ai.h`; Retold's AI walls
its town, towers its resources and breaks walls; deterministic, no rng draw,
every loop in row order):
- **Towers**: one at a time once the academy stands and the villagers are
  `tower_at`: by the Town Center towards the nearest enemy, between the Town
  Center and its gold mine, at its wood line (within 22 / 20 tiles), then
  round the Town Center; 6 tiles apart, never on a ring line or opening.
- **Wall ring** (Hard / Titan, from `wall_at`): a square with clipped
  corners (`R / 8`) round the Town Center, half-width the smallest of 15..22
  that holds every building of its own with 2 tiles to spare (archers shoot
  12 over a wall), at most 0.36 of the way to the nearest other Town Center;
  4 + 4 lines (the side facing the enemy first), each straight side leaving
  a 3-tile opening slid to open ground. A line goes down when it can be paid
  (+40 wood, +15 gold kept); the first tower comes first; while a line or a
  tower waits, an army of 8+ at home stops the academies from spending the
  wood and gold (`wall_saving`) and gold gets 30 % of the workers;
  `wall_builders` villagers (Hard 4, Titan 5) are kept on the foundations;
  a foundation they stand short of for 6 thinks (water, trees round it) is
  pulled down and paid back. Planned lines and openings (+2 tiles each
  side) are kept free of the AI's own farms / houses (`reserved`). Once the
  ring stands each opening is filled from pillar to pillar (one segment)
  and turned into a gate, several at once but never the last way out while
  others are rising. Every think one ring line is laid again (`patch_ring`:
  tiles that were trees, berries or a farm, and pieces the enemy broke once
  no foe is within 8). Every 20 s a path from the Town Center to outside
  the ring (its own gates open) must exist, else a straight segment becomes
  a gate (or, short of gold, is pulled down).
- **Upkeep**: tower / wall stages researched as the age allows (Watch
  Tower from Moderate, Stone Wall at Hard / Titan; +150 wood +60 gold
  kept); the most damaged piece or building (fortifications and the Town
  Center first) under 70 % hp with no foe within 8 gets `repairers`
  villagers (Easy 1, Moderate 2, Hard / Titan 3; free, Fortify's repair).
- **Attacking walls**: the sim's breach rule sends each walled-off man at
  the wall piece nearest to him; the AI turns each group of breakers (16
  tiles) onto one of the pieces they picked, the least hp x (1 + distance /
  4), kept until it falls (`breach_picks_`), for the men within 12 of it.
  An open gap needs nothing: the path goes through it.
- **Tower fear** (Moderate and up, until 25 min): a wave needs 4 + 2 x
  stage men per enemy tower covering its target; short of that it takes
  the nearest target out of their range, or waits for more men (never past
  an overdue interval); a wave worn below half inside tower range, not at
  its target, falls back home once (`retreats`).
- **No stalemates** (AI vs AI): fear ends at 25 min, overdue waves go, a
  breach is walled up only once the fight has left it; and three economy
  rules (Godot rules, they stalled matches behind towers): at most a quarter
  of the villagers worship, gold / wood are looked for up to 80 tiles once
  the near ones are worked out, a farm foundation left unbuilt is finished
  by the next food villager or, after 90 s, pulled down and paid back.
- `fortify_now(towers)` (stress scene, `set_ai {fortify_now}`): the ring
  and openings placed finished and paid, gates converted, the towers built.

```
godot --headless --path godot -s res://game/core/aifort_check.gd [-- --only=build,upgrade,repair,breach,gap,fear,determinism,matches --seed=1 --minutes=50]
node scripts/godot-shoot.mjs --scene aifort --out shots/godot/aifort.png [--seed 2]
     [--params "aifort_ai=hard,titan&aifort_t=16&aifort_focus=breach|town&aifort_owner=2"]
```

`aifort_check.gd` ("AIFORT PASS|FAIL <case>", `AIFORT_RESULT {json}`, exit =
failures, ~10 s): **build** (a Hard AI in peace for 20 min: 2+ towers within
26 tiles, a ring closed by its pieces (and trees) with a gate, villagers
working outside it), **upgrade** (Watch Tower, Stone Wall in the Classical
Age), **repair** (a ring piece and a tower at 30 % back over 60 %),
**difficulty** (Moderate a tower and no wall, Easy at most one tower),
**breach** (24 hoplites at a walled town break in and hit the Town Center;
with the focus the two most hit pieces take >= 50 % of the hits, 15 points
more than each man on his nearest piece, or only one or two are hit), **gap**
(that piece pulled down first: in through the opening, nothing destroyed,
sooner), **fear** (6 men facing three towers are held or sent elsewhere, lose
<= 2), **determinism**, **matches** (Hard v Hard, Titan v Hard, Hard v Titan
decided). Capture scene `aifort`: a two-AI match played `aifort_t` minutes in
the setup, the camera on the wall piece hit most in the last minute (else
`aifort_owner`'s Town Center).

`set_godot_rules(on)` (default on, kept across `new_game`): off = the
browser's rules only (no AI god powers, no free villager, no fighting back
while moving, AI waves attack their target directly, no walls / gates /
towers, no repair); `simcheck.gd`
turns it off for `check-sim.mjs`, and `--godot_rules=0` does it for a run
(A/B benches: the AI's storms thin the stress armies, so its numbers move).

Fog of war (player 1 and his allies) and victory: `set_fog_reveal_all(on)`,
`fog_recompute()`, `get_fog()` (size*size bytes: 0 unexplored, 128
explored, 255 visible), `fog_version()`, `is_explored(x, z)`,
`is_visible(x, z)`, `set_victory_enabled(on)`, `get_victory()` ({enabled,
decided, winner, loser, winner_team, time}), `is_paused()`, `set_paused(on)`.

Events (`game.events`, drained by main.gd): [{type, id, kind, other, owner,
a, x, z, amount}], type one of `entity:added` (a = type index),
`entity:removed`, `entity:died` (other = killer, x, z), `unit:damaged` (id =
target unit or building, kind, other = attacker id (0 god power / gone),
owner = attacker's owner, amount = damage after bonus and armor, x, z),
`building:placed`, `building:completed`, `unit:trained`, `age:advanced`,
`resources:changed`, `godpower:cast` (owner, a = power index in
`power_names()`, x, z), `command:smart` (other = target, a =
unit count), `game:over` (owner = winner, a = loser, amount = time), `villager:free`
(owner, id = the Town Center: see "Free villager" below), `player:defeated`
(owner, amount = time; Godot-only, see "Match rules");
`set_record_events(on)`. C++ systems subscribe
with `sim.events.on(EV_…, fn)`.

Profiling / checks: `set_profiling(on)`, `get_profile()`, `get_stats()`
({alive, dead, moving, buildings, projectiles, resources, paths, path_calls,
path_searches, path_cache_hits, path_expanded, group_fields, …}),
`set_census(on)` / `take_census()` (spatial-hash queries), `units_hash()`,
`get_units_f64()` / `get_econ_f64()` (full-precision dumps for parity tools).

Economy render data: `AovEconView` (`native/src/econ_view.h`), `setup(sim,
keys)` (the `economy/<key>` model names in MultiMesh order), `update(alpha,
paused, local_player, frustum=[])` once per frame (props off screen, a
shadow margin included, are skipped) -> {props: Array[PackedFloat32Array]
(16 floats per instance: TRANSFORM_3D + custom data = linear team rgb,
tint), counts, chips / puffs / rings + *_count (20 floats: TRANSFORM_3D +
colour + custom)}, zero-padded to power-of-two capacities. Fog-aware, closed
form in the sim time (captures are deterministic), no sim RNG.

Units / combat render data: `AovUnitView` (`native/src/unit_view.h`),
`setup(sim, rigs)` (one `VoxelModels.rig(type)` per unit type index; it
subscribes to the sim's `unit:damaged` / `entity:died` to stamp hits with
the sim time), `update(dt, alpha, local_player, frustum=[], lod_origin,
lod_dist=0)` once per frame (`Camera3D.get_frustum()`: units off screen are
not posed; units farther than `lod_dist` from `lod_origin`, the camera, go
to `parts_lod` / `part_counts_lod` instead, drawn with the coarse twins) ->
{parts:
Array[PackedFloat32Array] (one per rig part, types in index order; COLOR =
coat / corpse tint + fade, CUSTOM = linear team rgb + floor(dead*100) +
flash), part_counts, shadows, bars (CUSTOM = hp fraction, width px),
arrows, streaks (origin = head, COLOR = tail), sparks (COLOR = hdr rgb +
alpha, CUSTOM = size + velocity; zero velocity = a slow spark; negative
size = an impact burst, CUSTOM = (-scale, age 0..1, ray seed): a 20-30 px
star (at 1080p) of a white-hot core, a yellow glow and a mid-bright orange
halo that keeps its hue through the grade, ~0.35 s, never team-tinted),
dust (incl. a brown puff at the struck man's feet), chips (incl. 3-5 voxel
debris and 4-6 hot sparks per landed blow), drops: Array[4] (shield,
helmet, spear, stub; CUSTOM = team rgb), scars (only when scars_changed;
CUSTOM = dirt, blood), + *_count}; 20 floats per instance (TRANSFORM_3D +
colour + custom), zero-padded to power-of-two capacities. Visual only: never
writes the sim, own hash RNG; the anim.js pose, index.js render transforms,
BattleFX / Particles / Debris / Overlays / Projectiles render maths are
ported there; also `unit_count` (posed) and `lod_count`. Stress (2000
units, fog off, 1280x720): ~3 ms per update on this container's debug build.
`AovUnitView.lod_mesh(arrays, factor=2, shadow_only=false)` (static,
`native/src/unit_lod.cpp`): the coarse voxel twin of an exported model
(voxels rebuilt from the faces, interior filled, factor^3 per cell; with
shadow_only whole cells and greedy-merged faces), used through
`VoxelModels.coarse(mesh, factor, shadow_only)`. In `game/units` the full
part meshes cast no shadow: near units cast their coarse shadow-only twin
(factor 2), LOD units a 12-triangle box per part (`unit_shadow.gdshader`,
SHADOWS_ONLY, same buffers); units whose 0.07 voxels are under
`--unit_lod` px (default 2.5, 0 = off) use the coarse twins. The shadow
shader squashes every caster vertex towards the ground under it
(`--unit_shadow_squash`, default 0.7, 1 = physical), so each man casts a
compact shadow of about one body length under the low sun instead of long
streaks over his neighbours; the ground is `sim.get_heights()` as an RGBA8
texture, re-uploaded every 1.5 s by `units.gd`.

God power render data: `AovGodpowerView` (`native/src/godpower_view.h`),
`setup(sim)`, `update(alpha, paused, camera_position)` once per frame ->
{active (false: nothing to draw, nothing else returned), time, ribbons:
Array (one per group: ground bolts, sky bolts, zaps, bands, bands2, trails,
fire, sparks, bloom veil; null or ArrayMesh arrays with CUSTOM0 = side,
width, intensity, core and CUSTOM1 = tangent, CUSTOM2 = spark colour), inst:
Array[PackedFloat32Array] (20 floats per instance: TRANSFORM_3D + colour +
custom; debris, embers, glows, rims, decals mix / add / mul, smoke, flames),
counts, lights (9 floats each), spot, pools, flash, storm, storms};
`storm_static(id)` -> {gh, rb, rt, H, base, rain}. Bolt channels are
rebuilt from their seeds with the JS RNG (same shapes as the browser),
crater debris and sparks are stepped at 30 Hz from their strike, smoke and
flames are the Particles.js emits in closed form: a paused capture is exact.

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
  `game/lighting/lighting.gd`.
- Done (skirmish): fog-of-war shading (`game/core/fog_view.gd`), camera
  turning and eased zoom, the minimap / picking / placement now honour the
  fog in the skirmish (ui.gd read the `fog` flag inverted), and
  `game/core/playtest.gd` plays the match end to end (all steps "ok").
- Done (ui): the full browser HUD (resource strip with villager counts, age
  medallion, god-power slots with cooldowns, menu buttons, clock, scores,
  control-group cards, feed, command grid, selection card, diamond minimap
  with its button ring, tooltips) and the input of Selection.js. Drawn in the
  browser's CSS px and scaled by the CanvasLayer (height / 1080, 0.7..2);
  F1 toggles it, `--hud=0|1` as in the browser. Group paths (`set_group_paths(24)`)
  are turned on only outside captures. Not yet: the graphics-quality row of
  the hotkey card.
- Done (godpowers render): `game/godpowers` + `AovGodpowerView`, see the
  table and "AovSim API". Godot-only: a lavender veil round the bolts and
  the contact stands in for the browser's bloom pass (this renderer has
  none); the storm floor is a touch brighter. Not fog-aware yet.
- Done (group 0, Godot-only gameplay; the browser is frozen, so these break
  parity on purpose and `set_godot_rules(false)` switches them off for the
  parity tools): every start connected on foot (split maps stalled the AI's
  attack waves for good), a start woodline 8-14 tiles from every Town
  Center, the free villager, the enemy AI's god powers, god power hotkeys
  Z / C / V. Checks: `aivai.gd`, `softlock_check.gd`, `playtest.gd`,
  `check-mapgen.mjs`.
- Done (Godot-only combat): units on a plain move fight back unless struck
  from behind, then walk on; attack-move (hotkey A; the AI's waves use it)
  (`attackmove_check.gd`, `playtest.gd`, `aivai.gd`).
- Done (map bounds): off-map positions are safe everywhere, see "Map
  bounds" (`bounds_check.gd`).
- Done (fortify sim): walls, gates for allies, towers that shoot, their
  stages, repair, the breach rule, see "Walls, gates, towers"
  (`walls_check.gd`).
- Done (AI fortifications): the enemy AI builds towers, walls its town in
  with gates (Hard / Titan), upgrades, repairs and patches them, breaks
  enemy walls one piece per group, fears towers when weak; walled-off goals
  fail fast in the pathfinder; the stress scene is walled (`fort=0` off).
  See "Enemy AI: fortifications" (`aifort_check.gd`, scene `aifort`).
