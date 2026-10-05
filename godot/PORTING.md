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
| core (foundation; skirmish builder: camera, fog pass, playtest) | `game/main.gd`, `game/core/` (args, scenes, camera, model loader, voxel shader, bench, sim_debug, simcheck, `fog_view.gd` + `fog_of_war.gdshader` (fog-of-war shading, one full-screen pass), `playtest.gd` (scripted skirmish playthrough), `menu_playtest.gd` (the screen flow through real input: menu -> setup -> loading -> match -> Esc menu -> menu, see "Screen flow"), `match_rules.gd` + `match_check.gd` (match settings -> the sim, see "Match rules")) | `core/` (constants, rng, jsmath, bounds, game_map, entities, players, events, spatial_hash, pathfinding, movement, commands, profile, fog, victory), `match/` (the match setup: seats, teams, difficulty, stockpiles), `fortify/` (walls, gates, towers, their stages: Godot-only, see "Walls, gates, towers"), `techs/` (research queues, the Armory / Market / Temple techs, market trade, tribute: Godot-only, see "Research, Armory, Market, Temple techs"), `sim.{h,cpp}` | `src/core/` |
| terrain | `game/terrain/terrain.gd` + `terrain.gdshader` (chunks, paving cobbles / pale stone of MaterialPatches patchGround), `water.gdshader` (Water.js), `props.gdshader` (voxel.gdshader + MultiMesh instance tint, used by trees / gold / berries / ground details); mesher in `native/src/terrain_mesher.cpp` (TerrainMesh.js full port, water depth bake, GroundDetails.js scatter) | map edits live in `core/game_map`; resource nodes `Sim::spawn_resource` | `src/terrain/` |
| lighting | `game/lighting/lighting.gd` (sun + PCSS soft shadows, hemisphere = ambient colour + two unshadowed up/down lights, fill, depth haze following the camera, SSAO, MSAA, `--quality=high\|medium\|low`, `--post=high\|low\|off`), `grade_effect.gd` (CompositorEffect compute pass on the HDR buffer: exposure 2.1 + PBR Neutral + the PostFX.js grade; Godot's tonemap is LINEAR; Compatibility/web falls back to AgX), `sky.gdshader`. MaterialPatches.js canopy / foliage terms not ported yet | none | `src/lighting/` |
| buildings | `game/buildings/buildings.gd` (models, construction stages, house yaw, fog visibility), `walls.gd` (Greek walls, pillars and gates with swinging leaves, construction and damage states; models by `../scripts/export-walls.mjs`, see "Walls and gates: the look"), `towers.gd` + `tower_scene.gd` (Greek towers, a model per upgrade stage, construction / damage / upgrade states, the `towers` capture scene; models by `../scripts/export-towers.mjs`, see "Towers: the look"), `tech_buildings.gd` + `techbuildings_scene.gd` (the Greek Armory and Market, a model per age look plus construction stages, the `techbuildings` capture scene; models by `../scripts/export-techbuildings.mjs`, see "Armory and Market: the look"), `egypt_buildings.gd` + `egypt_town_scene.gd` (every Egyptian building, construction stages, the `egypt_town` capture scene; models by `../scripts/export-egypt.mjs`, see "Egyptian buildings: the look"), `town_props.gd` (props.js: town dressing, one MultiMesh per prop kind), `building_ao.gd` + `building.gdshader` (every building / prop mesh gets a wide-radius AO baked once per model by `AovBuildingAO.bake` in `native/src/building_ao.cpp` (render side, stands in for the browser's GTAO: column gaps, porticoes, eaves, wall-to-ground contact), stored in CUSTOM1.b and multiplied into the albedo; pale albedo pulled down, glow lowered; without the class, e.g. an old web .wasm, meshes come out without it) | `buildings/` (defs, spawn + ground dressing, placement, construction, destroy, town.js: ported) | `src/buildings/` |
| units | `game/units/units.gd` (rigs posed by the full anim.js port, conditional parts, crowd yaw / press / jitter, deaths and corpses, contact shadows), `unit.gdshader` (team lift + rim, hit flash, corpse drain, dithered fade) + `unit_outline.gdshader` (inverted hull, next pass; per-corner push directions in CUSTOM1.b keep the hull closed, see "Egyptian units and myth units: the look"); posing in C++: `native/src/unit_view.cpp` (`AovUnitView`) | `units/` (defs, spawn, anim state, spread: ported) | `src/units/` |
| combat (incl. enemy AI) | `game/combat/combat.gd` (arrows + streaks + stuck arrows, health bars, hit sparks / flash, dust, chips, ground scars, dropped gear; shaders in `game/combat/`), `tower_fire.gd` + `tower_flash / tower_puff.gdshader` (tower arrows: loose flash, heavier arrow, tracer, strike; see "Towers: the look"), all instance data from `AovUnitView` (via `pieces.units.last`) | `combat/` (combat.cpp: attack order, targeting, damage, projectiles, death, Town Center arrows, phalanx lines; enemy_ai.cpp: ported, plus god powers and a wave log, Godot-only; enemy_ai_fort.cpp: the AI's walls, towers and breaches, Godot-only) | `src/combat/` |
| economy | `game/economy/economy.gd` (EconomyView: animals, spears, boats, shoals, crops, stockpiles, loads, decor; Godot-only activity fx: axe / pick chips and dust, sickle chaff, stooks on cut rows, hoof dust, shoal ripples, fish splashes, net ripples, boat wakes; crops sway, `econ_voxel.gdshader`, `fx_chip / fx_puff / fx_ring.gdshader`), buffers built in C++ by `AovEconView` (`native/src/econ_view.{h,cpp}`, render side, reads the sim, never writes it) | `economy/` (gathering, farms, hunting, fishing, worship, training, age: ported) | `src/economy/` |
| godpowers | `game/godpowers/godpowers.gd` (the whole BoltRenderer of effects.js: bolt / sky / zap ribbons, impact flash sprites and decals, scorches with ember cracks (hot orange / red, glowing as long as the scorch lasts), a charcoal ash edge and a hot rim, an expanding impact ring at every strike point (Godot-only; decals are pulled toward the camera so voxel bumps do not swallow them), crater debris, char rims, spark streaks, smoke and flames, the storm funnel (wall, cloud body, dust wall, ground shockwave, rain, energy bands, whirled debris), flyer trails / back lights / drop shadows, meteor fireball and fire, strike / storm point lights and the shadow spot, the full-frame storm grade with light pools; dims the lighting piece's sun / sky / grade while a storm plays), shaders beside it; buffers built in C++ by `AovGodpowerView` (`native/src/godpower_view.{h,cpp}`, render side, reads the sim, never writes it) | `godpowers/` (favor, cooldowns, Lightning Storm, Bolt, Meteor, thrown units: ported) | `src/godpowers/` |
| ui (HUD, selection, input) | `game/ui/ui.gd` (selection, box / double-click select, smart orders, rally points, control groups, hotkeys, placement ghost, wall drawing (click-drag line ghost, cost, snapping) and the wall / gate / tower commands (see "Walls, gates, towers: placement"), god-power targeting ring, move markers, selection rings (one MultiMesh) + bars, event feed, messages, result card; public: `pieces.ui.selected`, `hover_entity`, `message()`, `feed()`), `hud.gd` (the drawn HUD, two layers with hit zones), `hud_style.gd` (palette, Cinzel / Alegreya fonts in `fonts/`, SVG icons from `icons.gd` = `src/ui/icons.js` rasterised at runtime, draw helpers), `panel.gdshader` (the gilded teal panels), `minimap.gd` + `minimap_ground/units.gdshader` (terrain colours computed in the shader from `get_heights()` / `get_ground()` uploaded as textures, re-uploaded on `building:placed`; unit dots read straight from `get_units()` arrays as data textures: no per-unit script), `portraits.gd` + `portrait.gdshader` (one SubViewport per type / owner, rendered once, unshaded with the browser's three.js hemisphere + sun lighting, no tonemap), the research / market panel and tooltips with `tech_icons.gd` + `tech_models.gd` (the tech icons as rendered 3D models; see "Research panel, tooltips, market trade") | none | `src/ui/` |
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
  fortifications"), `techbuildings` (the Greek Armory and Market, see
  "Armory and Market: the look"), `egypt_units` (every Egyptian unit and myth unit, see
  "Egyptian units and myth units: the look"), `egypt_town` (every Egyptian building in a town, see
  "Egyptian buildings: the look"), `techui` (a selected Armory's tech
  buttons, research queue and a tooltip, see "Research panel, tooltips,
  market trade") and `menu` (the main menu,
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
2000 units, three interleaved runs today (round 2, the AI's siege on):
0.75-0.85 ms/tick mean (p95 1.43-1.69, max 2.7-4.0) walled, 0.69-0.90
(p95 1.00-1.40) with `fort=0` (round 1 walled: 0.85-0.94, p95 1.55-1.90,
single ticks of 10-14 ms); combat 0.17-0.20 ms/tick walled, 0.15-0.20
without; `pathCut` / `pathFail` / `pathFlood` are the region rows of
`findPath`, see "Walls, gates, towers". The render numbers and
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
  gather_mult}. Fortifications scale too (Godot rules): every difficulty
  walls its town in, Easy with at most one tower and the ring from 12 min,
  Moderate two towers, Watch Tower, Stone Wall and the ring from 10 min,
  Hard three towers and the ring from 7 min, Titan four towers and the ring
  from 6 min (see "Enemy AI: fortifications").
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
team score list). Ten seeds per pair (the metrics are noisy with fewer), and
the ordering allows small ties (villagers -0.5, population -3, wave men
x0.9, casts x0.75): the stronger AIs now spend their early economy on the
age plan instead of villagers. Today: Hard 10/10 over Easy, Titan 10/10
over Moderate, Hard 8/10 over Moderate (one lost), Moderate 5/5 over Easy;
peaceful villagers at 6 min 18 / 27 / 27 / 27.

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
  every <= 5 tiles of a run; beside a gate a pillar is a gate tower.
  **Stepped runs** (a line dragged at an angle is a staircase of tiles):
  the chain of tiles between two anchors (pillars, ends, junctions) that is
  not one straight row is drawn as a straight curtain at its true angle,
  pillar centre to pillar centre (the tile centres simplified to within 0.75
  tiles, Douglas-Peucker; a `core` at a bend left over): round(length)
  `seg` pieces turned to the line and stretched to fill it, the parapet
  away from the town, each in the state of the run tile nearest it (so a
  diagonal reads as a long wall, not a row of little towers). Only a corner
  right next to a pillar outside such a run and diagonal joins are built
  from an `arm` per link round a `core` (a diagonal arm is the arm turned
  45 degrees and stretched by sqrt 2).
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

Capture scene `wall_angles` (`game/buildings/wall_angles_scene.gd`): sim
walls dragged out from a point of open ground at 0, 22.5, 45 and 67.5
degrees off the grid and built, and a line across a house (refused); for
checking that diagonal walls read as long curtains.

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

## Armory and Market: the look (game/buildings/tech_buildings.gd)

The Greek Armory and Market after Age of Mythology: Retold
(`reference/techs/building_01..03` the Armory, `building_04..06` the
Market, one per age), drawn by `game/buildings/tech_buildings.gd` (a child
of the buildings piece; `buildings.gd` hands it the sim's `armory` /
`market` rows and skips them itself, like the towers). Models: the
Godot-only `techbuildings` group (`node scripts/export-techbuildings.mjs`,
~10 s, deterministic; re-run it after changing the script, never hand-edit
`assets/models/techbuildings.*`): 1/8-tile voxels (the walls' and towers'
resolution) plus the town's smooth tile roofs (`src/buildings/shapes.js`
gableRoof / shedRoof / roundColumn with the tile sizes doubled, so tiles
match the other buildings'), the buildings' palette and weathering, the
team colour in bands, cloth and shields. Both are 4 x 4 tiles (the sim's
defs), pivoted at the footprint centre, the front to +z.

- **Armory** (`armory/*`): few, big, clearly modelled pieces so it reads
  as a forge at game zoom, not a scatter of props. A long whitewashed hall
  with a dark socle and a **team band**, a terracotta gable roof crossed by
  two raised pedimented gables, its east gable end in dressed stone (not a
  bare smooth triangle), a timber porch, a door in a marble frame; three
  barrels in one group by the front; the open-fronted plank **lean-to
  smithy** on the east end (a plank gable roof with battens on posts and
  beams, a dark underside, rafters and an open king-post truss at the end,
  a board back wall, the forge hearth with glowing coals and a **stone
  chimney** standing up through the roof, one anvil); in the yard the round
  **smelting furnace** (two smooth stone drums, a smooth tapering
  lime-washed bottle kiln, coals glowing in the throat, a stone fire mouth),
  a stone water trough, a **shield rack** with two hoplite shields (7 x 7
  pixel-art aspides: bronze rim, team field, raised boss), and one
  continuous **low yard wall** with a flat pale coping along the front and
  east edges.
- **Market** (`market/*`): a two-storey **stoa** (team band at the foot and
  under the upper floor, windows, pedimented gable roof with a palmette
  cresting on the ridge), a low columned wing with a pediment to the front
  whose ridge runs in under the stoa's **projecting first-floor cornice**
  (the roof junction is hidden), a terrace with an **iron balustrade** and
  an outside stair, an open court of crates, painted amphorae, barrels and
  sacks, and three **stalls** (two on the front, one on the east side): a
  plank counter with a team skirt and three heaped produce crates (red
  fruit, greens, grapes, oranges, lemons) in front, posts, a small plain
  tile gable at the back and the **team / white striped awning** sloping
  out from under its eave, with a scalloped valance.
- **Roofs**: no antefixes along the eaves (at this size a row of them reads
  as spikes); palmettes only on the stoa's ridge (`ridgeCrest`) and the
  Mythic acroteria.
- **Age looks**: `<type>/a1` (Archaic, Classical: terracotta roofs, red
  tympana), `a2` (Heroic: pale green glazed roofs, blue tympana, **team
  finials** on the gables), `a3` (Mythic: marble roofs,
  gilt acroteria, marble pilasters, the smithy's marble tie beam), chosen by the owner's
  `get_player(owner).age`.
- **Construction**: `<type>/s0..s7` (floor(progress * 8), cut from `a1`
  like `src/buildings/construction.js`: 0 = the staked lot with team
  pennants and a rope, 1..7 = the work rising inside a timber scaffold with
  plank walks, braces, a hoist and stacked blocks; the roofs appear at s7).
- `TechBuildings.model_key(type, built, progress, age)`, `mesh_for(type,
  age)` (a finished mesh, for portraits and placement ghosts: the ui's
  `buildings/<type>/0` lookups have no such model), `model_override[id]`
  (one sim building in another look), `set_static(entries)` (render-only
  buildings: `{type, owner, x, z, age | key}`).

Capture scene `techbuildings` (`game/buildings/techbuildings_scene.gd`):
the `town` scene's town with an Armory and a Market side by side on
cleared lots just south of it, the camera close and high like the
references. Spawned by the sim when it has the `armory` / `market` types,
else drawn render-only on the same lots.

```
node scripts/godot-shoot.mjs --scene techbuildings --out shots/godot/techbuildings.png
     [--params "techb_age=2"]          # the owner in the Heroic (2) / Mythic (3) age
     [--params "techb_states=1&cam=40,112,30,42,15"]   # a row: a1 a2 a3 of each, s0, s3, s5
     [--params "techb_static=1"]       # render-only even when the sim has the types
node scripts/export-techbuildings.mjs   # re-export godot/assets/models/techbuildings.*
```

## Egyptian buildings: the look (game/buildings/egypt_buildings.gd)

Every Egyptian building of Age of Mythology: Retold (`reference/egypt/
building_01..23`, EGYPT.md section 2) in this game's voxel style, drawn by
`game/buildings/egypt_buildings.gd` (a child of the buildings piece). Models:
the Godot-only groups `egypt` (finished looks) and `egypt_stages`
(construction), both written by `node scripts/export-egypt.mjs` (~20 s,
deterministic; re-run it after changing the script, never hand-edit
`assets/models/egypt*`): 1/8-tile voxels (the walls', towers' and tech
buildings' resolution, the same mesher, jitter, weathering and team voxels),
a few smooth parts (the silos), pivoted at the footprint centre, the front to
+z. The palette: pale coursed sandstone walls (`WASH`, houses, camps, Granary,
Armory, Sentry Tower), warm sandstone ashlar (pylons, plinths), pale limestone cornices
and copings, dark plaster / mud roof decks, mud brick and palm thatch
(Archaic houses), painted friezes (blue / red / ochre), gilt, dark basalt.
- **Three values per lot** (so a town never reads as one tan mass): the
  walls are the lightest (whitewash / limestone), the **roof deck** two
  steps darker (`PLASTER` a warm grey-brown deck, `ROOFTILE` a darker tile,
  `MUDROOF`) framed by the brightest line, the pale cornice `LIP`, so every
  roof is a dark inset in a bright frame; the ground under and round a
  building (`SPLASH`, `WORN` paths, `EARTH` yards, `PAVE`) a step or two
  darker than the walls and than the terrain's dirt. A **base course**
  (`plinths()`, `PLINTH`, `BASE_H` = 2): every ground-level block's first
  two rows are dark brown stone, ringed one voxel out by the same stone (not
  in front of doors), and left as voxels under the battered skin (which
  starts above them), so every building stands on a crisp dark course
  darker than both its walls and the apron.
- **Coursed walls** (`coursed()`: `WASH`, `SAND`, `LIME`): the stone courses
  read from the RTS camera: three-voxel courses in three sand tones in an
  A B A C rhythm, each course's bottom row a darker bed joint, blocks in a
  running bond (head joints a shade darker), a small per-block wobble; no
  wall is a single-tone plane. The skin's per-cell colour jitter is +-2 %.
- **Windows and doors**: `slit()` cuts the opening one voxel into the wall
  (a dark recess, a hole in the skin, not a painted dot) under a limestone
  lintel one voxel proud and a voxel wider each side, on a shadowed sill;
  `win()` groups three slits with wall mullions under one lintel (houses,
  the Sentry Tower: the windows sit high, under the band). No lone dark
  voxels anywhere on a face: painted bands and friezes use tones of their
  own paint and pale separators, never ink dots (rows of single dark voxels
  under a cornice read as eyes and the houses as faces), the winged sun's
  wings are solid. `door()` frames: jambs one voxel proud, the lintel proud
  and a voxel wider each side, a second shadowed course over it.
- **A tall element per function** (read at a glance): the Town Center's
  painted pylon gate and Ra statue, the house's **red-striped cloth
  awning** on poles over its jars (and an upper room or a walled yard), the Granary's tall domed silos, the Lumber Camp's timber
  sheerlegs with a slung log, the Mining Camp's headframe with a pulley and
  an ore bucket, the Temple's papyrus colonnade and gilt-tipped obelisk
  pair at the ramp foot, the Barracks' tall banner masts, the Market's
  **columned portico** standing above its hall, the Armory's tall chimney
  furnace, the Migdol's keep and turrets.

- **The Egyptian block** (`block()`): a flat plaster roof (palm thatch under
  poles on Archaic houses) inside a **cavetto cornice** (the wall's top row
  fluted, the warm-limestone lip flaring one voxel out), a thin **team line**
  one voxel inside the lip, a torus roll under the cornice, one thin `band`
  (ochre dashes by default, `'team'` a dark lapis line on the
  Migdol, `'lapis'` on the Armory), an optional muted painted
  frieze, pale corner torus mouldings, a darker socle and **battered walls**
  (inset one voxel every `batter` rows). Doors are cut `deep` voxels (2 by
  default, 3 to 4 on the Town Center and Barracks gates) into the wall with
  **near-black reveals** (jambs, soffit) and a dark leaf at the back, framed
  in limestone with a projecting lintel, some with a gilt winged sun; slit
  windows (houses have no beam ends: their dark dots read as eyes). `lipOut: 2` is
  the **deep cornice**: a shadowed gorge row flaring one voxel out at the
  wall top and the pale lip two voxels out, so each roof edge throws a dark
  line and every block's silhouette stands off the ground and its
  neighbours (TC blocks and pylons, camps, Granary, Barracks, Armory,
  Market).
- **Value steps per structure** (so a compound never reads as one tan mass):
  `LIME` pale limestone for the chief block (the TC hall, the Market hall,
  the Barracks gatehouse, Migdol, Siege Works) with a pale tiled roof,
  `OCHRE_W` warm ochre sandstone for enclosure walls, the Barracks ranges
  and the Mining Camp, `MUDB` dark mud brick with a darker `MUDROOF` and a
  pale lime lip for the TC's side rooms, `WASH` whitewash for houses, the
  camps, the Granary store and the Armory, `SAND` for pylons, `FLAG` cool grey
  flagstones in the TC courtyard. `bands()` paints wide rows round a
  block's outer shell: the TC pylons carry red, ochre and turquoise bands
  between ink rules over turquoise / ochre relief panels; the team colour
  stays on the roof lines only.
- **Smooth battered walls** (`skin()`): voxels draw a batter as stairs that
  read as a ziggurat, so every battered face of every block is covered by a
  smooth sloping plane through the steps' outer edges, one quad per voxel
  cell coloured by the masonry voxel behind it (courses, bands, friezes, door
  frames, slits and team voxels carry through), with holes at recesses
  (doors) and gaps where something stands against the wall (porches,
  lintels, beams, adjoining blocks). Finished models only (construction
  stages keep the stepped voxels).
- **Two team strengths**: `TEAM` voxels (roof lines, lapis bands, plinth
  panels) are weathered to a dark warm grey and tinted at 0.62, so the
  owner's colour is a thin dark lapis / maroon line, never the loudest thing;
  `TEAMB` (bright) is kept for **one feature per function**: the Market's
  striped awnings, the Barracks' and Migdol's banners, the statues' kilts,
  the construction pennants. Other strong colour is saved for the Temple's
  painted columns (papyrus capitals, lapis / red bands, glyph columns) and
  the relief bands on its platform, the Armory's forge glow.
- **Settled into the ground**: no square slab under a model; `settle()` lays
  the plinth line, then a clean straight-edged apron of darker packed earth
  under and one voxel round whatever stands and **worn paths** from every
  ground-level door (registered by `door()`) to the lot edge; yards,
  threshing floors and paving are ragged `patch()`es. The ground row is
  pivoted 0.1 tile down (it sits 0.025 above the terrain: a decal). Clutter
  is **sparse** (one crate stack, a basket or a jar per small lot, the
  working props of each function: log pile, ore bins, racks, counters), so
  the doors, plinths and footprints stay clear.
- **Types** (the sim's keys, `sim/civ`; footprints as `buildings/defs.h`):
  `town_center` 7x7 (a walled compound: low ochre enclosure walls with
  corner piers, a pale limestone two-storey hall with a deep latticed door
  on the courtyard, a mud-brick east block and front-right room, a battered
  sandstone pylon gateway with wide painted bands, a gate block between the
  pylons with a 4-voxel black passage and a dark leaf under the lintel
  bridge and its winged sun, a big and a small **domed silo** (front left), awnings, a
  fire bowl, a basin, a palm, the gilt **falcon-headed Ra** with his sun
  disc on a plinth at the front left), `house` 3x3 (three plans after
  building_04, each block on its base course under a deep cavetto cornice
  (`lipOut: 2`): a main block with a lower side room and the awning on the
  side room's front; a main block with an upper room on its roof (its own
  window) and a projecting door portal, the awning on the front; an L of a
  tall back block and a low front room round a small yard behind a clean
  coursed yard wall with a limestone coping and a gap, the awning over the
  yard's jars; three-slit window groups high on all four faces, framed
  doors, a striped canvas awning on poles (`clothAwning`); no roof vents, canopies or stairs;
  Archaic look `a1` mud brick with a mud gorge and thatch under poles, `a2`
  sandstone with plaster roofs and an ochre band), `granary` 3x3 (after building_05: a coursed sandstone store at the
  back left with a deep cavetto cornice, a framed roof hatch, a door and slit
  in front and a ladder up to the roof; two domed brick silos in a row along
  its east side, a ladder from the roof up to each silo's mouth; a crate of
  grain and a barrel), `lumber_camp` / `mining_camp` 3x3
  (battered blocks under a flared cavetto (`block(..., { flare: true })`)
  with the painted `CAMP_FRIEZE` (lapis, a pale fillet, red) under it; a
  canvas awning over the work yard: the Lumber Camp's over a 3-2 stack of
  big logs (`bigLog`: 3x3 section, pale sapwood ring caps round a dark
  heart, ends to the open side), crates, a barrel and a saw-pit in front (a
  dark pit in a timber kerb, a log on bearers, the pit saw through it); the
  Mining Camp's over gold ore bins, a trough, a sledge of blocks), `farm` 4x4 (a mud border, an irrigation channel and a shaduf; the
  crops are the economy piece's), `temple` 5x6 (a two-tier platform with a
  ramp, a kiosk of painted papyrus columns with screen walls, a naos and
  white drapes, the **major god's statue**: variants `ra` falcon with the
  disc, `isis` winged with horns and disc, `set` the Set animal), `eg_barracks`
  5x5 (thick battered ranges round a drill yard, a raised gatehouse with a
  latticed door, team banners on poles, a rack of spears and shields),
  `migdol` 7x7 (a tall battered limestone keep with a tiled roof, four taller
  corner turrets whose team rim runs only along their two outer sides, slit
  windows in threes, a projecting gate front with a deep gate and a gilt
  winged scarab, latticed windows, a cart wheel), `siege_works` 7x7 (two
  tall workshop towers, a colonnade with green-footed columns under a long
  multicolour awning, wheels, barrels, a catapult arm, a siege-tower frame),
  `armory` / `market` 4x4 (Retold's Egyptian ones: a forge under a dark
  striped awning with a stepped chimney furnace, a trough and a gilt ankh /
  a hall with three stalls of **team / white striped awnings** over produce),
  `obelisk` 1x1 (a gilt-panelled spire, four prongs holding a glowing teal
  flame), the five **Monuments** (`monument_villagers` kneeling with bowls,
  `monument_soldiers` mummiform with crook and flail, `monument_priests`
  striding in a nemes, `monument_pharaohs` a king and queen, all dark basalt
  and gold on gilt plinths with team panels; `monument_gods` 4x4 with
  variants `ra` / `isis` / `set`, Eye of Horus panels and glowing sun bowls).
  Render-only (no sim type yet): `lighthouse` 3x3 (the Pharos: a battered
  tower, an octagonal storey, a columned lantern with a fire), `wonder` 8x8
  (a sphinx on a stepped plinth behind a pylon gate with gold reliefs and
  hieroglyph columns, obelisks, column drums), `sentry_tower`, `palm`
  (3 variants, scene dressing), `clutter` 2x2 (street dressing, 8 variants:
  0 jars and a basket, 1 crates and sacks, 2 a mud-brick wall run with a gap,
  3 a hand cart, 4 a pen corner, 5 a reed sunshade stall, 6 a woodpile,
  7 a shaded well).
- **Canvas awnings** (`clothAwning()`: houses, camps, the Town Center; the
  Market, Armory and Siege Works keep the voxel `awning()` with team
  stripes): a smooth two-sided sheet drawn by `clothSkin()` (half-voxel
  quads in `m.skin`, like the battered walls), not voxel slats. It runs from
  a timber batten on the wall, sloping `drop` voxels to the front, bellied
  along its run and sagging (`sag`, ~1 voxel) in the middle of every span
  between the front `posts`; stripes run one way only, wall to front, cream
  / faded terracotta (`CANVAS`, `CANVAS_T`, `sw` wide); a voxel hem hangs
  under the front edge, scalloped (2 voxels at every scallop's middle). Not
  in the construction stages (the cloth goes up when the building is done).
- **Silos** (`silo()`, the Granary's and the Town Center's): masonry, not
  smooth capsules. A round dark stone plinth; a drum of plastered mud brick
  in courses of 1.5 voxels (bricks in a running bond, darker head joints, a
  recessed bed joint under every course so the rows read), its tone a dirty
  plaster that lightens upward, stained in patches, the two bottom courses
  worn dark; squared timber posts standing proud of it, each on a dark foot
  block and capped over the timber band that rings the drum's top; a
  corbelled beehive dome of stepped courses (riser + lit tread each); and a
  loading mouth with a rolled plaster lip round a dark recessed throat with
  a heap of grain in it. Smooth parts (`ringWall`, `ringTread`, `post`,
  `beam`, `ladder`: oriented timbers) over a voxel core, so the AO and the
  construction stages (the drum's courses rising) still work.
- **Keys**: `<type>/<variant>/a<age>` finished (the highest listed age look
  <= the owner's age), `<type>/s<k>` in `egypt_stages` (k = floor(progress
  * 8) rounded down to 0, 2, 4, 6: 0 = the staked lot with team pennants and
  mud bricks, then the work rising in a palm-wood scaffold with a mud-brick
  ramp; smooth parts appear when finished). The manifest's `types` lists
  each type's footprint, variants and ages; `stage_keys` the stages.
- **Who draws what**: `buildings.gd` asks `egypt.owns(type, civ, owner)` per
  row of `get_buildings()` (its `civ` column: 1 = Egyptian) and skips those
  rows (and their Greek town props); `tech_buildings.gd` skips an Egyptian
  owner's Armory / Market the same way; the Egyptian-only keys are always
  drawn here. Variants: houses by the sim's variant (% 3) and yaw, temple and
  Monument to the Gods by the owner's `god`. A sim footprint that differs from
  the model's is fitted with a uniform scale. Walls, gates and towers of an
  Egyptian player are still drawn Greek by walls.gd / towers.gd.
- API: `EgyptBuildings.model_key(type, variant, built, progress, age, god)`,
  `mesh_for(type, age, god, variant)` (portraits, placement ghosts),
  `force_owner[owner] = true` (draw that owner's buildings Egyptian),
  `model_override[id]`, `set_static(entries)` (render-only:
  `{type, owner, x, z, key | variant, age, god, built, progress, yaw, scale}`).

Capture scene `egypt_town` (`game/buildings/egypt_town_scene.gd`): a whole
Egyptian settlement on the flat start of a battle map, laid out like
`reference/egypt/building_01`: houses in touching rows along paved lanes,
the Town Center on its plaza at the end of the main street, the temple up a
processional way between obelisks, the military quarter east, the camps by
their fields, street clutter between the buildings (`CLUTTER`), palms. The
ground is painted after the spawns (a spawn lays its own square of dirt):
worn earth everywhere, `LANES` paved (`AovSim.paint_ground`; sand reads as
beach on low ground), and the map's ground details (pebbles, tufts) are
hidden so the ground is clean like Retold's (`egt_details=1` keeps them).
Houses stand a lane's width (one tile) apart, palms only at the quarters'
edges, the street clutter sparse. Player 1 is made Egyptian and the sim's types are
spawned, the rest (lighthouse, wonder, palms, clutter) drawn render-only.
The whole-town camera is set by the scene (`cam` overrides it).

```
node scripts/godot-shoot.mjs --scene egypt_town --out shots/godot/egypt_town.png    # the whole town
     [--params "egt_focus=migdol"]     # frame one building (any type above, close: distance 5 + 2 x tiles), palms cleared round it
     [--params "egt_god=isis"]         # ra | isis | set (temple statue, Monument to the Gods)
     [--params "egt_age=1"]            # the owner's age (1: Archaic houses)
     [--params "egt_states=1"]         # a row of construction stages and variants
     [--params "egt_row=house/0/a2,house/1/a2,house/2/a2"]   # a framed row of model keys (look reviews; s/<type>/s<k> for a stage)
     [--params "egt_yaw=208"]          # the framing camera's yaw for egt_focus / egt_row (default 28)
     [--params "egt_static=1"]         # render-only even where the sim has the types
     [--params "egt_details=1"]        # keep the map's pebbles and tufts
node scripts/export-egypt.mjs          # re-export godot/assets/models/egypt*.{json,bin.gz}
```

## Egyptian units and myth units: the look (game/units)

Every Egyptian unit of Age of Mythology: Retold (`reference/egypt/unit_01..13`,
`myth_01..14`, EGYPT.md sections 3 and 5) as a voxel part rig in the Greek
units' format: the Godot-only model group `egypt_units` (rigs + meshes),
written by `node scripts/export-egypt-units.mjs` (~2 s, deterministic; re-run
it after changing the script, never hand-edit `assets/models/egypt_units*`).
`VoxelModels.rig(type)` falls back to that group when `units.json` has no rig
of the name, and `VoxelModels.mesh("units", name)` to its meshes, so
`units.gd`, portraits, hero art and the model gallery draw them by the sim's
type key with no stand-in. Posed by `AovUnitView` (`native/src/unit_view.cpp`)
with the Greek units' code (idle, walk, gather, build, attack, hit, die), the
same channel names, plus:

- **Rig fields** (export-egypt-units.mjs head): `pose` = a variant of the anim
  family: `spear` / `slash` (Spearman, Mercenary / Axeman, Mummy, Minion: the
  hoplite's thrust variants and battle-line guards / the swordsman's overhead
  slash), `sling` (archer family: the sling whirls over the head and is let go
  overarm; arms down at rest), `serpent` (medusa family without arms: the
  hood rears and strikes), `chariot`, `staff`; `gait` / `stride` (four-legged
  walk frequency / amplitude x the horse's: elephant 0.55 / 0.6, camel 0.75,
  crocodile 0.7 / 0.55); `hover` (flyers, rig voxels); `graze: false` (horse /
  centaur kinds: no head-down grazing dip at idle, for harnessed and ridden
  mounts: the chariot horse, the camel; Rig::graze in unit_view.cpp, default
  true so the Greek horses are unchanged); per part `vary: [k, n]`
  (shown for the units whose id hashes to k of n, rule `R_VARY`) and
  `rest: [x, y, z]` (radians, Part::rest in unit_view.cpp: a fixed turn
  applied after the channel's pose; the Egyptian heads carry [-0.22, 0, 0],
  chin up towards the camera; no Greek rig has it).
- **Heads** (`faceN` / `nemesN` / `capN` / `headE` in the exporter): authored
  at half the body's voxel (`HEAD_SCALE` 0.5, pivot [3.5, 0, 3]) so a head is
  about a sixth of the figure (Retold's proportions) and still has a face:
  a 7 x 8 x 6 skull with rounded edges and a narrowing jaw, kohl eyes (white
  + dark), a kohl brow, a nose ridge standing one voxel out of the face, cheek
  hollows, a mouth, ears. Headdresses break the box: the nemes (axeman, camel
  rider, mummy, sphinx) has a domed crown striped front-to-back on top (so the
  top reads as cloth, not a flat lid), a gold brow band, side wings flaring
  out and down to the shoulders and two lappets laid forward over the
  shoulders and down the chest in front of the collar; the khat (laborer) a
  bag at the nape; the priest a headcloth to the shoulders and a sun disc; the
  pharaoh's khepresh swells up and back; the spearman close-cropped black
  hair (a hairline on the face plane, the team band a row up so it shades
  neither brow nor eyes) and a side lock. The men's face plane (z = 5) is
  `SKIN_FACE`, a step lighter than the skull, with 1-voxel dark pupils inside
  pale eye corners, a brow line a value step down above them and a lighter
  nose ridge.
- **Value separation** (round 6): skin, leather, wood and metal sit 2-3
  value steps apart: the heads' `SKIN` a warm terracotta tan (0xc46e38 ..),
  bodies the two flat `PAL_SKIN` tones (see Men's body),
  `LEATHER` / `WOOD` dark walnut (0x54301a / 0x5c3a20 ..), shield backs a
  pale spotted cowhide. Spear points (`spearM`) are leaf-shaped iron-grey
  blades (`BLADE` / `BLADE_EDGE` / `BLADE_DK`): a dark socket, 3 wide across
  the belly with bright honed edges, narrowing to a bright tip, a midrib
  front to back; arrowheads the same grey. The Spearman wears a white scale
  collar with a team row (unit_01) set a row low so the neck shows, no dark
  straps; the Axeman a team tunic under his gold collar; the epsilon axe
  blade an orange-leaning gold (plain GOLD goes olive in shade).
- **Idle at ease** (unit_view.cpp, `eg_ease`): rigs with pose `spear` /
  `slash` (Spearman, Mercenary, Axeman, Mummy, Minion) skip the hoplite's
  idle variants (spear levelled overhead, shield raised) and stand with the
  haft upright held out from the body and the shield low at the side, so in
  a group no man's spear or shield covers a neighbour. Greek rigs have no
  `pose` and keep their idles; combat-line guards are unchanged.
- **Collision offsets**: long hafts (spear, epsilon axe, ankh staff, crook)
  are gripped at `GRIP_E` [-0.45, -8.5, 0.6] (outside and in front of the
  fist, not its centre) and shields strapped at `SHIELD_E` [1.9, -5.4, 2.6] on
  the forearm, so posed arms swing them past the torso rather than through it.
- **Outline** (`unit_outline.gdshader`, both unit groups): a voxel mesh has a
  copy of every corner per face, so pushing each face out along its own
  normal split the inverted hull into offset squares (jagged black fringes
  and splinters along every voxel edge and step). `scripts/outline-codes.mjs`
  gives every copy of a corner the same push, the sum of the distinct face
  normals there (-1 / 0 / 1 per axis, one byte in `extra.b` = CUSTOM1.b), so
  the hull stays closed; `export-models.mjs` writes it for the Greek `units`
  group (only units.bin.gz changes), `export-egypt-units.mjs` for its own.
  `extra.a` = a per-mesh width factor (0 = 1, the Greeks'): Egyptian bodies
  0.55, gear 0.45, the half-size heads 0.35, so a line never swallows a face
  and two men side by side keep their own outlines.
- **Palette**: the grade's exposure and warm chroma limiter (grade_effect.gd)
  take about half the chroma of any warm colour: a deep gold (0xd2a400) reads
  olive-khaki, an orange gold (0xffb000) peach like the skin. The gold is a
  light yellow with no blue (`GOLD` 0xe8c400 .., the Pharaoh's `PH_GOLD`
  0xf0c800 ..), the most gold-looking choice next to the team blue; the skin
  is a warm terracotta (see Value separation), apart from the gold by hue.
- **Men's body** (round 7, `manTorso` / `manArmM` / `manThighM` /
  `manShinM` / `manParts` in the exporter): every Egyptian man (Laborer,
  Spearman, Axeman, Slinger, Mercenary, Priest, Pharaoh, the charioteer,
  camel / cavalry riders, the mahout, the scorpion man's torso, Mummy,
  Minion; Anubite, Avenger and Son of Osiris through `beastManParts`, which
  splits the arms at the elbow for the beast anim's `foreL` / `foreR`) is
  authored at half the rig voxel (`BODY_SCALE` 0.5, like the heads) with
  Retold's proportions: the hip at 14 rig voxels (thigh 7, shin 7: the legs
  are half the figure), a short torso from the hip (rows `TORSO_ROWS`, in
  half voxels: 10-wide pelvis, 8-wide waist at the belt, 10-wide ribs, a
  12-wide chest = 1.2-1.3 x the hips, rounded deltoids standing out to 14, a
  sloping 6-wide trapezius), a 2-row (one rig voxel) neck and the head
  raised on it at 8.5 (x 0.9 head scale for men). Arms are 3 x 3 half voxels
  hanging from under the deltoids (pivot at the shoulder, the fist 8.5 rig
  voxels down: `HAND_E`), legs taper to 2 x 2 ankles over sandalled feet.
  Skin is two flat tones, no noise (`PAL_SKIN` L 0xec9a50 front / shoulder
  tops, M 0xbc7038 sides and back, part jitter 0.015): one darker row under
  the pectorals and at the solar plexus, nothing on the back. Dress is
  painted in clean bands: `eKilt` (an A-line shendyt 10 -> 12 -> 14 wide,
  side faces a tone darker than the front, one diagonal wrap fold, a pale
  hem dipping lower at the front, an optional apron panel standing proud and
  widening down), `eBelt` (+ a knot / buckle), `eCollar` (the wesekh as a
  short cape: rings by the distance from the neck over the shoulders and down
  the chest and back, so the front is a crescent of bands; `paint()` takes
  `TM` / `TM_SH` for team dye), `eStraps` (the spearman's silver straps),
  `eSash` (a diagonal strap / quiver belt). The Pharaoh's corselet, shoulder
  pads, collar ring and A-line skirt and the Priest's robe are painted on
  the same torso. The old crate body (`torsoBody`, `shapeTorso`, `legsE`,
  `arms`) is gone.
- **Stance** (rig field `stance`, unit_view.cpp `Rig::stance`, a number or
  true = 1): the idle stands in a relaxed stride (one foot forward, the
  weight on the back leg, the hips turned; mirrored by unit id), x the value
  (0.3 for the Pharaoh's and Priest's robes, so a leg never leaves the
  skirt); the slinger lets the sling hang and sway out from a fist held off
  the hip. Greek rigs have no `stance` and are unchanged; combat-line guards
  and the hoplite idles override it.
- **New kinds / channels**: `flyer` (Phoenix, Roc: hover with a bob, wings
  `wingL` / `wingR` beating, faster on the move, a dive with the talons
  forward to strike, a fall when killed), `siege` (Catapult, Siege Tower:
  wheels roll on the move, the catapult arm `weapon` lies cocked and throws on
  each attack); the `wheel` channel also turns the chariot's wheels; the
  medusa family beats `wingL` / `wingR` (Wadjet). Dead flyers and siege
  topple like beasts.
- **Units** (rig voxel): `laborer` (0.07, bare chest, white kilt, team sash
  and khat, the villager's tools / loads by name: `toolAxe`, `carryWood` ...),
  `spearman` (unit_05: bare chest under two silver straps from the shoulders
  to the belt, shaved head with a side lock, team kilt and wrist bands, long
  spear, round-topped team shield),
  `axeman` (unit_02: a broad gold scale collar to mid-chest, team cap
  sleeves, black and gold nemes, a team kilt with a pointed gold apron, the
  gold epsilon axe, a gold shield with team bands), `slinger` (unit_06: bare chest under a team
  broad collar with a white rim, a leopard belt and plain hide front flap
  over a team kilt, team wrist bands, a bobbed wig; the sling (`slingM`, part
  scale 0.5 so the cords are thin) hangs from the fist along -y: a team
  finger loop, two dark cords to a leather cradle round a grey stone, 12 rig
  voxels long), `mercenary` (a Nubian spearman, round team shield),
  `priest` (white robe and headcloth, gold sun disc and sash, ankh staff),
  `pharaoh` (0.08: the team blue crown with gold discs and uraeus, gold
  corselet, shoulder pads and apron over an A-line team skirt, the striped
  crook raised overhead), `chariot_archer`
  (white horse in a striped blanket and team collar, hitched to an Egyptian
  chariot: a D-shaped car open at the back (an 11-voxel front, sides sweeping
  down to the back), its breastwork in the army's colour inside gold rims and
  struts with a gold sun disc, the car's rim 3 voxels above the wheels; two
  six-spoke wheels (radius 5.8, light spokes in a dark felloe, a silver hub)
  on the axle at the back of the car; two 2 x 2 shafts from under the floor
  along the horse's flanks to yoke saddles at its shoulders, the yoke across
  the withers, a team breast strap with gold studs; the archer bare-chested
  in a gold / team broad collar and a white kilt, a quiver on his back, a
  striped helmet over a face with 2-voxel dark eyes and a nose shadow (head
  style `charioteer`, x 1.15), a short 1-voxel recurved bow canted outwards
  (`rest: [0, 0, -0.7]`) so it never stands up through his head; anim
  `centaur` = horse legs + archer arms; the horse's neck is arched high,
  5 voxels wide at the base with a dark grey mane falling to the off side and
  splayed ears (`horseNeck({ thick })`, a neck and not a pole seen from
  behind), the belly tucked up; pose `chariot` (unit_view.cpp horse_pose)
  makes the idle horse stand mid-stride: near foreleg lifted and pawing,
  a hind leg set back, head up), `camel_rider` (0.09, the rider at 0.065 / 0.09
  so the camel dominates: a sandy-brown hide distinct from the rider's
  bronze skin, a lighter belly and legs, a darker muzzle; one high hump under
  a domed white cloth with a broad team border and an ochre zigzag hem; a
  long S-curved neck that dips from the chest and rises above the rider's
  knees to a small head with ears and a narrow muzzle, a team scarf at the
  throat; long thin legs with knobby knees / hocks and broad pads; the
  rider's bare legs astride the cloth, a team tunic, a team-crowned linen
  nemes with lappets, a silver hooked sword held forward from the fist),
  `mercenary_cavalry` (dark barded horse, Nubian rider; shares the horse
  neck and belly of the chariot horse), `war_elephant` (0.1: grey elephant, cow-hide cloth, team pad, a
  wooden howdah, a silver and gold forehead plate with a team lozenge,
  trunk, tusks, ears; a mahout at 0.7 x), `catapult` (0.09), `siege_tower`
  (0.1, team hides, a ladder).
- **Myth units** (no sim type yet: drawn on stand-in sim units, below):
  `anubite` (beast, jackal head under a team headcloth, linen straps, two
  sickle blades), `avenger` (beast, falcon head and feather mantle, team and
  gold collar, two gold blades), `son_of_osiris` (beast, a gold falcon god
  with a sun disc), `mummy`, `minion` (human), `sphinx` (four-legged: lion
  body, a man's head in a team and white nemes), `petsuchos` (jewelled
  crocodile, horned sun-disc crown, team tail tip), `scarab` (six legs on the
  four leg channels, iridescent shell with team blotches, mandibles),
  `scorpion_man` (a man on a team and white scorpion: eight legs, pincers on
  the `neck` channel, a tail arching over the back), `wadjet` (serpent:
  coil, hood, team wings with red bars), `phoenix`, `roc` (flyers; the roc
  carries a basket).
- **`baboon_of_set`** (sim type, Set's starting scout; four-legged rig 0.06,
  anim `horse`, gait 1.3): an olive-grey baboon with a pale cape over the high
  shoulders, a back sloping to a red rump, a long dark muzzle with amber eyes,
  an arching tail, a team collar with a gold amulet; in the myth lineup.
- **`units.gd draw_as(unit_id, type)`**: draws and poses one sim unit with
  another rig (AovUnitView `add_rig(rig)` appends a render-only rig and its
  part buffers, `set_rig_override(id, rig)`); the sim still runs it as its
  own type. When the sim gains a type of the same key (anubite ...), its rig
  is found by name and nothing else is needed. Known look gaps: very bright
  saturated orange / yellow on large upward faces (the Phoenix's wings)
  washes out under the grade, so the Phoenix is a golden bird with team
  flame tips rather than a glowing one.

Capture scene `egypt_units` (`game/units/egypt_units_scene.gd`): on the flat
start of a battle map, desert ground with a paved square, player 1 Egyptian.

```
node scripts/godot-shoot.mjs --scene egypt_units --out shots/godot/egypt_units.png   # lineup: men / cavalry and siege / myth units
     [--params "eu_group=foot"]       # a block of foot soldiers (unit_02)
     [--params "eu_group=mounted"]    # chariots, camels, an elephant (unit_01 / unit_13)
     [--params "eu_group=myth"]       # the myth units, two rows
     [--params "eu_group=battle"]     # an Egyptian army against Greeks, 5 s into the fight
     [--params "eu_group=eco"]        # Laborers gathering wood / gold and building, Priests, the Pharaoh
     [--params "eu_focus=anubite"]    # four of one type from four sides (three-quarter turns), framed close; men with hafts stand GAP 2-2.6 apart
     [--params "eu_state=walk"]       # with a lineup / focus: idle | walk | attack | die
     [--params "eu_t=3"]              # seconds of sim after the setup
     [--params "eu_yaw=28"]           # camera yaw (the rows face it)
     [--params "eu_one=axeman&eu_turn=30"]  # one unit framed close, turned from the camera (model checks)
     [--params "eu_zoom=0.75"]        # scale the camera distance of any group
node scripts/export-egypt-units.mjs   # re-export godot/assets/models/egypt_units.{json,bin.gz}
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
  new tile when the line is unaffordable or crosses a building), gold on tiles of the player's wall
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

## Research, Armory, Market, Temple techs (native/src/sim/techs)

Godot-only (behind `Sim::godot_rules`; with the rules off nothing here can be
built, researched or traded and `check-sim.mjs` stays 16/16 bit-exact). The
Greek tech tree of Age of Mythology: Retold for the Armory, the Market and
the Temple, with the numbers of `../reference/techs/TECHS.md`. Class `Techs`
= `Sim::techs` (`techs/techs.{h,cpp}`); run in the buildings step after
`Fortify::update`.

- **Buildings**: `armory` and `market` (appended to `building_type_names()`,
  `B_ARMORY` / `B_MARKET`): 150 wood, 40 s, 1200 hp, 4x4, sight 9, Classical
  Age, villager-built like the others (placement refuses them in the Archaic
  Age, and always with the rules off). Their models and construction
  stages are `game/buildings/tech_buildings.gd` (scene `techbuildings`).
  **The Temple** takes Retold's cost and hp with the rules on (150 wood +
  150 gold, 1200 hp: `rules_building_cost` / `rules_building_hp`, read by
  `Buildings::place` / `spawn`, the AI's `try_build` and `get_building_def`);
  the browser's 150 + 50, 1500 hp stay with the rules off. Its footprint
  stays 5x6, not Retold's 5x5: the footprint is read by 54 places in the sim
  (placement, pathing, the start towns' layout, the AI's spots) and by the
  temple's voxel model, all of which would have to move together behind the
  flag; the gameplay numbers do.
  **Armor**: with the rules on the Armory, the Market and the Temple take
  Retold's 40 % hack / 90 % pierce / 5 % crush (TECHS.md) in place of the
  browser's flat building factor (x0.35, myth units x1.2), read the way
  `Fortify::armor_mult` reads an attack: arrows and every building's shot
  are pierce, myth units and god powers crush, the rest hack
  (`Techs::building_armor_mult`). A hoplite's blow on one: 9 -> 5.4 (a house:
  3.15), a toxotes' arrow 7 -> 0.7 (house 2.45), a minotaur's blow 24 ->
  22.8 (house 28.8). Every other building keeps the browser's factor.
  **The Heroic Age needs an Armory or a Market** (Retold) with the rules on,
  by default (`set_tech_rules({heroic_needs_armory: false})` turns it off);
  the advance is refused with "Requires an Armory or a Market". The enemy AI
  (Moderate and up) goes on to the Heroic / Mythic Age once its Armory
  stands (see "Enemy AI: research, ages, Market").
- **Myth units at the Temple**: with the rules on the Temple trains every
  Greek myth unit this game has a model for, through the same `train()`:
  Minotaur (Athena), Cyclops (Ares), Centaur (Hermes) from the Classical Age
  and the Medusa (Hera) from the Mythic Age (Retold; the browser trains the
  Minotaur alone, every unit Classical). `get_building_def("temple").trains`
  = [minotaur, cyclops, centaur, medusa] (hotkeys Q W E R, the HUD lists
  them), `get_unit_def(t).min_age` / `god` follow the rules. A chosen minor
  god (`set_minor_god`) allows only his unit ("Requires the minor god Ares");
  none chosen: all of them, as with the techs. Their stats and costs are the
  existing unit defs (TECHS.md has no unit numbers). So Sylvan Lore, Will of
  Kronos and Face of the Gorgon, and the Centaur / Medusa part of Burning
  Pitch and Sun Ray, act on units a player can really train.
- **AI research**: the enemy AI builds an Armory and a Market, researches
  the Armory / Market / Temple techs, advances to the Heroic and Mythic Ages
  and trades at its Market, scaled by difficulty: see "Enemy AI: research,
  ages, Market" (`combat/enemy_ai_techs.cpp`, `aitechs_check.gd`).
- **Research queue** (generalises the fortify stages' one-slot research):
  every building row has `tech_queue` (`TechItem` {tech, t, total, paid}),
  up to `TECH_QUEUE_MAX` = 5. `research(building, key)` checks the building
  (a tech's home, or its "also at": Military Academy for Phobos, Deimos,
  Sarissa, Aegis, Harvest of Souls; Town Center for Golden Apples), built and
  alive, the queue, the tech's state, and pays the cost at once; the head
  progresses (x1.5 at an Armory with Forge of Olympus); `cancel_research(
  building, key = "": the last queued)` refunds exactly what was paid. Done:
  the owner's bit, his modifiers recomputed and applied to every unit he owns
  (hp scaled with the new max, speed, sight) and, through `entity:added`, to
  every unit spawned later; event `tech:researched` with `a = 100 + TechId`
  (the fortify stages keep a = 1..6), `id` = the building. One-time; only one
  copy queued at a time (any building). While a building researches, its
  training queue waits (one production queue, as in Retold); a destroyed
  building loses its queue (no refund). The fortify stages are listed by the
  same `get_techs(building)` for a tower / wall piece and researched by the
  same `research()`.
- **States** (`get_techs`): `available`, `locked_age`, `locked_prereq`,
  `locked_god`, `researching` (head of a queue), `queued`, `done`,
  `unavailable` (the unit it upgrades is not in this game: no building
  trains it, or the rules are off), each with a `reason` ("Requires Heroic Age", "Requires Copper
  Weapons", "No Hypaspist in this game", ...).
- **Gods**: generic techs need nothing; Olympian Parentage needs the major god
  Zeus (`Player.god`, every player here); a minor-god tech needs that god for
  its age once one is chosen with `set_minor_god(owner, age, god)` (Classical
  athena / hermes / ares / pan, Heroic apollo / dionysus / aphrodite /
  hestia, Mythic artemis / hera / hephaestus / demeter / persephone). Until a
  player picks (this game has no age-up god choice yet), every god's techs of
  that age are open.
- **Effects** (`TechMods` per player and unit type, read only with the rules
  on by the system that owns the stat): attack (`Techs::unit_damage`, combat
  melee / arrows / splash), hack armor (melee blows) and pierce armor (arrows of
  units and buildings) added to the unit's single armor fraction, capped 0.95
  (Retold's "-10 % vulnerability" = +0.10), hp, speed, range
  (`Combat::range_of`), sight, reload (attack cooldown factor), splash radius,
  divine damage (added after armor, x0.35 on buildings), multipliers vs
  buildings / myth units (added, as Retold's), arrow speed and tracking
  (`Combat::fire` / `update_projectiles`), building arrows (Town Center,
  towers: x weapons in `fire`), building sight and Omniscience and Sun Ray
  reveals (`FogOfWar::recompute`), favor rate (`Economy` worship),
  regeneration / healing / poison / timed buffs (`Techs::update`).
  Unit classes: human soldier = hoplite, toxotes, hippikon; hero = hero;
  myth = minotaur, cyclops, centaur, medusa; infantry = hoplite; ranged
  soldier = toxotes. **Retold distances** (range, LOS, radii) are scaled by
  `DIST_SCALE` = 0.6 (this sim's toxotes range 11 vs Retold's 18, sight 13 vs
  22); hp, damage, rates and times are Retold's.

| Tech (building, age) | Applied here |
|---|---|
| Copper / Bronze / Iron Weapons (Armory, C / H / M; each needs the previous) | +10 % attack each (additive: +30 %): human soldiers, hero, Town Center and tower arrows |
| Copper / Bronze / Iron Armor | +0.10 hack armor each, hero +0.15 |
| Copper / Bronze / Iron Shields | +0.10 pierce armor each, hero +0.15 |
| Ballistics (C) | **arrows now miss**: with the rules on, a toxotes', tower's or Town Center's arrow follows its target only `ARROW_TRACK_BASE` = 1 tile (+ the target's radius) from where it stood when loosed, else it lands there (a stuck arrow); Ballistics +3 tiles (Retold's "+3 track rating"). Myth units' and heroes' shots still home |
| Burning Pitch (M) | toxotes, centaur, medusa: damage multiplier vs buildings 1 -> 4 |
| Phobos' Spear of Panic (Ares, C; also Academy) | hoplite +1 divine damage per blow |
| Deimos' Sword of Dread (Ares) | unavailable: no Hypaspist |
| Enyo's Bow of Horror (Ares, C) | toxotes +10 %; arrows of toxotes and buildings fly x1.5 faster |
| Sarissa (Athena, C; also Academy) | hoplite +10 %, range +0.3 (0.5 x 0.6) |
| Aegis Shield (Athena, C; also Academy) | hoplite +0.15 pierce armor |
| Sun Ray (Apollo, H) | toxotes, centaur, medusa +15 %; a hit reveals Retold's area 25 x 0.6 = 15 tiles round the target for 6 s (`REVEAL_RADIUS`; a hit within 3 tiles of a live reveal renews it, so a volley is one reveal). Retold's "+20 LOS" for projectiles is that reveal (a projectile has no sight of its own here) |
| Shafts of Plague (Artemis, M) | toxotes +10 %; hits poison 0.25 hp/s for 6 s (ignores armor, restarts on a new hit) |
| Forge of Olympus (Hephaestus, M) | Armory techs x0.25 food / wood / gold (favor unchanged), Armory research x1.5 |
| Olympian Weapons (Hephaestus, M) | Myrmidon / Hetairos / Gastraphetes -> hoplite / hippikon / toxotes: +20 %, +1 multiplier vs myth units |
| Harvest of Souls (Persephone, M; also Academy) | hoplite: 5 s after a kill x1.15 damage, reload x0.8 |
| Tax Collectors (Market, H) / Ambassadors (M, needs Tax Collectors) | market fee 30 -> 22.5 -> 15 %; tribute fee 20 -> 10 -> 0 % |
| Coinage (M) | unavailable: no Caravan |
| Omniscience (Temple, M) | costs 100 gold x the enemies' living population (at queue time), 4 s; the fog shows every enemy unit's and building's sight to the owner and his allies |
| Olympian Parentage (Zeus, A) | hero +25 % hp, +1 hp/s |
| Labyrinth of Minos (Athena, C) | minotaur +35 % hp, +15 % speed |
| Sylvan Lore (Hermes, C) | centaur +35 % hp, range +1.8, sight +0.6 |
| Will of Kronos (Ares, C) | cyclops splash radius +0.9 (1.6 -> 2.5) |
| Hymn of the Wildwood (Pan, C) | each hero heals the owner's units within 3 tiles 0.75 hp/s |
| Oracle (Apollo, H) | units and buildings +3 sight; `queue_view` flag for the UI |
| Temple of Healing (Apollo, H) | each Temple heals up to 3 damaged units within 9 tiles (+ half its size) at 15 hp/s, idle ones first, half rate on moving / fighting ones |
| Golden Apples (Aphrodite, H; also Town Center) | worship favor x1.2 |
| Dionysia (Dionysus, H) | every unit +5 % hp |
| Face of the Gorgon (Hera, M) | medusa range +3 |
| Monstrous Rage (Hera, M) | myth units reload x0.75, speed +15 % |
| Pious Sacrifice (Persephone, M) | a hoplite's death: the owner's human soldiers within 3 tiles reload -10 % per death (max 5) for 5 s from the last |
| Winged Messenger, Call of Lykaion, Roar of Orthus, Chthonic Rites, Hallowed Woodlands, Hand / Shoulder of Talos, Flames of Typhon, Enchanted Hymn, Iron Grip | unavailable: their units (Pegasus, Lykaon, Nemean Lion, Hydra, Hamadryad, Colossus, Chimera, Siren, Harpy) are not in this game |

- **Market** (`market_buy(market, res)` / `market_sell(market, res)` ->
  {ok, reason, gold, amount}): food and wood in lots of 100 for gold (favor
  and gold: refused, as Retold). One price per resource **shared by every
  player**, start 100: buy = floor(price x (1 + fee)), sell = floor(price x
  (1 - fee)) (130 / 70; 122 / 77 with Tax Collectors; 115 / 85 with
  Ambassadors: Retold's readouts); each buy +2 (`MARKET_STEP`), each sale
  -2, clamped 25..1000 (60 sales: sell 17 per 100, the floor of the original
  AoM observation); the price **drifts back** towards 100 at 0.2 per second
  (`MARKET_DRIFT`). The step is this port's pick within TECHS.md's "about
  1.5 to 3"; **the drift is a deliberate departure**: TECHS.md says Retold's
  prices do not recover over time. Here the price is shared by every player
  and the AIs trade too, so without a drift one player's early sales would
  leave the price at the floor for the whole match; the slow recovery (20
  points in 100 s) keeps the Market usable. Set `MARKET_DRIFT` = 0 for
  Retold's behaviour. A Market with a full research queue
  cannot trade. `get_market(owner)` = {food / wood: {tradable, price, buy,
  sell}, favor: {tradable: false}, fee, tribute_fee, lot, base, step, drift,
  min, max, has_market}.
- **Tribute** (Retold: only with a finished Market): `tribute(from, to, res,
  amount)` -> {ok, reason, amount, fee}: the receiver gets the amount, the
  sender pays it x (1 + fee).

API: `tech_names()`, `get_tech_def(key)` ({key, name, building, also, age,
age_name, base_cost, time, requires, god, major_god, generic, missing, text
(Retold's effect), mapping (how it maps here), effects [{kind, units,
buildings, value, retold}], id, event_a}), `get_techs(building)` (that
building's techs for its owner: the static data + state, reason, cost (the
price he would pay now: discounts, Omniscience), at / queue_index / progress
while queued), `get_owner_techs(owner, building_type)` (the same without a
building, for menus), `get_research(building)` ([{key, name, t, total,
progress, paid}]; also `get_building(id).research`), `research(building,
key)`, `cancel_research(building, key = "")`, `get_player_techs(owner)`
({done, queue, minor_gods, god, market_fee, tribute_fee, favor_mult,
building_attack, building_sight, omniscience, queue_view, armory_discount,
has_market}), `set_minor_god(owner, age, god)`, `grant_tech(owner, key)`
(free and instant: scenes, checks), `get_unit_stats(id)` ({damage, hp,
max_hp, speed, range, sight, hack_armor, pierce_armor, reload, splash,
divine, regen, vs_buildings, vs_myth, track, arrow_speed, poisoned}: the
tooltip readout), `get_market(owner)`, `market_buy`, `market_sell`,
`tribute`, `set_tech_rules({heroic_needs_armory})`, `get_tech_rules()`
({heroic_needs_armory, researched, reveals, reveal_radius}).

```
godot --headless --path godot -s res://game/core/techs_check.gd [-- --only=defs,buildings,research,locks,weapons,armor,ballistics,armory_gods,temple,myth_units,retold_bld,market,ai,determinism,rules_off --seed=3]
```

`techs_check.gd` ("TECHS PASS|FAIL <case>", `TECHS_RESULT {json}`, exit =
failures, ~25 s, 51 cases) measures every effect on real numbers: the
unit:damaged amount of a real blow / arrow before and after (hoplite 9 ->
9.9 / 10.8 / 11.7 per weapons tier on a villager, toxotes 7 -> 9.1, hero 28
-> 36.4, Town Center and tower 6 -> 7.8, minotaur unchanged; an enemy
hoplite's blow on a hoplite 6.3 -> 5.4 / 4.5 / 3.6 and on the hero 5.4 ->
1.35 with the armor line; arrows likewise with the shields), hit rates at a
running villager (20 % without Ballistics, 100 % with), toxotes on a house
2.45 -> 9.8 with Burning Pitch, a 3 s walk (+15 %), heal / regen / poison /
favor over time, 3 of 4 hurt villagers healed by a Temple, the fog at the
enemy's start before and after Omniscience (600 gold for 6 enemy pop),
prices after each trade, the clamp, the drift and every fee, tribute paid /
received; plus the queue (paid at queue time, one copy, cancel refunds
exactly, done after 30 s, event a = 100, existing and newly spawned units
get it, a Military Academy's hoplite waits for its Sarissa), every lock,
determinism (two runs bit-equal) and the rules off (nothing built,
researched, traded). `myth_units` trains the Centaur, Cyclops and Medusa at
a real Temple with `train()` (no `spawn_unit`), researches Sylvan Lore /
Will of Kronos / Face of the Gorgon there and measures the trained units
(centaur 340 -> 459 hp, range 12 -> 13.8, on one trained before and one
after; cyclops splash 1.6 -> 2.5 and a bystander 2.2 tiles off losing 15 hp;
medusa range 12 -> 15), the Medusa refused in the Classical Age, a chosen
minor god's lock. `retold_bld`: the Temple's cost paid and hp, the armor of
the three buildings on real blows / arrows, the Heroic Age refused without
an Armory / Market. Sun Ray: with the fog on, a spot 13 tiles past the
target is seen only while the reveal lasts. `ai`: a Moderate AI (seed 3)
builds its Armory at 22.5 min and finishes Copper Weapons at 24.5; Easy
builds none.

## Research panel, tooltips, market trade (game/ui)

The Armory, the Market and the Temple's techs in the HUD, as Age of
Mythology: Retold's command panel (`reference/techs/ui_01..05`).

- **Build grid**: with villagers selected the grid now has **Armory (U)**
  and **Market (K)** (after the Military Academy; their portraits are the
  `techbuildings` models, `portraits.gd`), tooltips with the cost, Retold's
  help line, hp and age; greyed before the Classical Age ("Requires the
  Classical Age", also the message of a click / key). Their placement ghost
  is the Classical model (`VoxelModels.mesh("techbuildings", "<type>/a1")`).
- **Tech buttons** (`ui._tech_slots`, any finished building of the player
  whose `get_techs()` is not empty: Armory, Market, Temple, and the techs the
  Military Academy / Town Center also research): a button shows a tech that
  is not done, not `unavailable` (its unit is not in this game)
  and not `locked_god`; a line shows only its next tier (Bronze appears once
  Copper is done, greyed until the Heroic Age); a god's techs appear from his
  age on (Retold: with the god; every god's while no minor god is chosen).
  The Armory's generic lines sit by column in the top row (weapons Q, armor
  W, shields E, Ballistics R, Burning Pitch T, as `ui_02.jpg`), god techs in
  rows 2-3; elsewhere techs fill the rows below the train buttons. Hotkeys
  are the slot's letter, Q W E R T / A S D F G / **Y U I O P** (the third row
  is not Retold's Z X C V B: Z / C / V are the god powers here), unless a
  train / age button already has it. Frames: **gold** for generic techs,
  **purple** for a god's, and every button speaks the state language below
  ("Command button states"); a tech being researched or queued keeps its
  button. More techs
  than free slots (a Mythic Temple with no minor god chosen): the last slot is
  "More techs (n / m)" and pages.
- **Icons**: rendered **3D models**, not drawn glyphs. `game/ui/tech_models.gd`
  builds one small scene per icon from code (lofted blades with a diamond
  section and crisp ridges, lathed shields / bowls / apples / helmets,
  parametric discs with relief and painted faces, swept shafts, horns, bows
  and snakes, bevelled extrusions; materials: polished metal with a hammered
  normal map, wood grain, leather, cloth, marble, glass, unshaded glowing
  fire / souls / lightning / venom with alpha). `TechIcons` "the 3D studio"
  renders them all once: one shared World3D, each model in its own 256 px
  SubViewport (4x MSAA, transparent) spaced 40 units apart, lit by a softbox
  panorama sky (the metal's reflections and ambient: a warm softbox up left,
  a strip light behind right, a soft frontal box, a dark floor), a key light
  from the top left with soft shadows, a cool fill, a rim omni light behind
  each model in its tile family's glow, SSAO, filmic tone mapping.
  `ui.setup` calls `TechIcons.studio_start(self)`, the next drawn frame
  renders the studio, `studio_poll()` (every ui frame) reads the pictures
  back two drawn frames later and frees it (a `RenderingServer.force_draw`
  does not render freshly added viewports), then re-bakes any tile already
  made, in place (`ImageTexture.update`). Headless (no renderer): nothing is
  rendered and the SVG glyphs below are the fallback. **No motif is shared
  between two Armory lines** (each line owns one silhouette, so a button is
  told apart by its art, not by its frame or pips): **weapons** are swords
  (copper one leaf-bladed xiphos with a midrib, bronze two crossed, iron two
  crossed before a labrys), **armor** a muscle cuirass with pectorals, the
  ribcage arch, abdominals and two beaded bands at the hem (copper plain,
  bronze with shoulder guards and a gold medallion, iron steel with shoulder
  guards, gold rivets and pteruges), **shields** a hoplon turned three
  quarters so its rolled rim and bowl show (never a flat target), copper a
  raised gold crescent, bronze a gold star on dark blue enamel, iron a
  silver lambda on crimson with rivets; Ballistics a bronze pair of dividers
  astride a glowing trajectory ending in an arrowhead on its mark, Burning
  Pitch a painted clay pot brimming with black pitch, ablaze, the pitch
  running down its side, Phobos a huge obsidian spearhead (the only spear)
  cracked with glowing red seams, Deimos a black ram-horned war helm with
  burning violet eye slits, Enyo a heavy horn recurve with gold bands and
  tips, drawn, Sarissa a phalanx of five thick parallel lowered pikes (pale ash, broad heads) with red
  ribbons (a hatch, no shield), Aegis Athena's silver owl with fanned bronze
  and gold wings and glowing eyes, Sun Ray a blazing sun in a gold ring,
  Shafts of Plague two arrows dripping green venom, Forge of Olympus an
  anvil, a hot ingot, the hammer and sparks, Olympian Weapons Zeus' gold
  keraunos (a ringed grip, three zigzag prongs fanning from each end),
  Harvest of Souls a scythe and rising souls; Tax Collectors a purse and
  coins, Ambassadors a sealed scroll, Coinage a stack of staters and an owl
  coin; Omniscience an eye in gold lids with rays, Olympian Parentage a
  crested Corinthian helmet, Labyrinth the maze from above, Sylvan Lore an
  oak sprig, Will of Kronos an hourglass, Hymn Pan's pipes, Oracle the
  Delphic tripod's vapours, Temple of Healing the Rod of Asclepius, Golden
  Apples, Dionysia grapes, Face of the Gorgon a bronze gorgoneion with snakes
  and glowing eyes, Monstrous Rage a bull's head with burning eyes, Pious
  Sacrifice a marble altar with fluted posts, volutes, garlands and gold
  rosettes, its log pile ablaze. Materials: every metal carries a wear map
  (`TechModels._wear()`: tarnish clouds, pits, scratches) on its albedo and
  roughness over a hammered normal map, and the studio sky has a bright
  horizon over a dark floor, so curved metal shows a crisp light-over-dark
  reflection (polished bronze, not plastic); the 256 px render is unsharp-
  masked after the downscale (`TechIcons._sharpen`) so edges and highlights
  stay crisp at button size. Iterate with a contact sheet (below).
  **Aegis** is a living tawny owl (not a statuette, `TechModels.feathers()`:
  vertex-coloured plumage with a fine bump normal): an egg of layered breast
  feathers (displaced rows, each tip dark, short broken streaks), a broad
  head, a pale facial disc ringed by a dark ruff, huge amber eyes with black
  pupils and a glint, a scowling brow running up into the ear tufts,
  half-raised barred wings, talons on an olive branch. **Burning Pitch** is a
  two-handled black-figure amphora (a black foot, a running-wave band on the
  shoulder, a black neck) brimming with glossy pitch, one run over the lip,
  ablaze. **Phobos** is a lanceolate war-spear head of black glass whose two
  cutting edges glow red-hot to the point, a few jagged fractures near the
  socket (no midrib with side veins: that read as a leaf).
  A button never shows the bare picture:
  `TechIcons.tile(name, px, "normal"|"locked")` composites it once (CPU,
  cached; `prewarm_step()` bakes the set one per frame): **its own painted
  backdrop** (`TechIcons.BACKDROPS`, `backdrop(name, px)`, cached; one per
  line, not one vignette per family): a sky gradient, a light pool placed
  for that picture and a value-noise pattern that says where the tech
  lives: the weapons a forge (orange heat from below, sparks), armor
  brushed steel with a window's light, shields the sea, Ballistics an
  engineer's blueprint grid with a drafting arc, Burning Pitch smoke over a
  low fire, Phobos a crimson mist, Deimos violet fog, Enyo a dusk skyline
  over dark hills, Sarissa dusty light shafts, Aegis a starry night with a
  moon glow, Sun Ray a sunburst, Shafts of Plague venom drips, Olympian
  Weapons storm clouds, Harvest of Souls an underworld mist, the Labyrinth
  and Pious Sacrifice stone walls, the gardens out-of-focus leaves, the
  Market coin bokeh (patterns: embers, streaks, waves, grid, smoke, cracks,
  mist, horizon, dust, stars, rays, bokeh, blocks, drips, clouds; none red).
  So five gold buttons in one row differ by their scene before their art
  (techs_playtest checks it). The studio's rim light takes that backdrop
  light's colour and side (a forge's orange from below, the moon's blue on
  the owl), so the model sits lit inside its scene; the halo behind the
  picture is that light at 12% (not an airbrushed glow), the top sheen 2.5%.
  The picture's drawn bounds are fitted per icon (`FRAMING`: [fit, dx, dy],
  default `FIT` 90%; Phobos, Sun Ray and Sarissa fill past the frame as
  close-ups, the cuirass sits smaller), Lanczos from 256 px, a soft drop
  shadow and a dark outline round the silhouette so it reads on any
  backdrop. The SVG fallback
  (`SVG`, `TEMPLATES`: 24-unit glyphs, embossed from their blurred alpha)
  and the `g_<god>` emblems, `t_buy` / `t_sell`, `t_time` stay SVG.
  "locked" is the same tile drained and its values split: the backdrop
  drops to a dark slate (luminance x 0.42), the picture to a mid grey (x
  0.64 + 0.07 through a soft S-curve, so it is not silvery), the outline
  stays dark; the picture keeps 14% of its own hue (a tier's metal 20%), so
  a greyed flame still reads warmer and brighter than its clay pot. **Sharpness at button size**: every tile is baked at the exact size it
is drawn (48 px on the grid, 34 px in the queue, 22 px on the card; a 64 px
tile drawn at 48 went soft), the studio uses ACES tone mapping, a stronger
key (2.3, specular 1.4) over a lower ambient (0.38) and stronger SSAO, and
after the downscale `TechIcons._clarity` pushes each channel away from its
own 2 px blur (local contrast, so folds, rims and engraved faces survive at
40 px) with a mild saturation lift; the picture fills 90% of the tile
(`FIT`). Iterate with a contact sheet: after
  `render_models(host, names)` and two drawn frames `studio_finish()`, then
  `TechIcons.bake(name, 64, locked)` per name (`TechIcons._glyph3d[name]`
  is the raw render). No plate is red: red means "can't afford".
- **Tooltips** (`hud._draw_wide_tooltip`, commands with `wide`): the name and
  "(hotkey)", "Cost: 100 [food] 100 [gold] 30s [hourglass]" (red where short;
  the time with Forge of Olympus at the Armory /1.5), Retold's effect text,
  per-class bullets built from the effects ("Human Soldier: Attack +10%",
  "Hero: Vulnerability to Hack attacks -15%", "Buildings: Attack +10%"), the
  lock's reason in red ("Requires Heroic Age", "Requires Copper Weapons"),
  then age, building, "Also researched at ..." and the god; lines wrap at
  350 px. A disabled tech's click / key says its lock, else what is short
  ("Not enough gold").
- **Research queue on the card** (`ui._research_info`): "Researching <tech>
  · n%", the queue as tech icons (the head with a progress bar; tooltip:
  seconds left, click to cancel: `cancel_research(building, key)`, exact
  refund), and **RESEARCHED**: small dimmed tiles of the techs done at
  that building with a green check and a green frame (never a buyable gold
  one). A building's training waits while it researches (sim). The feed
  says "<tech> researched." (`tech:researched`, a = 100 + id).
- **Market**: trade buttons in the second row, Buy Food (A), Sell Food (S),
  Buy Wood (D), Sell Wood (F): the resource, a green / red arrow and the live
  price in gold on the button (Retold's `ui_01.jpg`), tooltips "Cost: 134
  [gold]" / "Gives: 72 [gold]"; a click / key trades a lot of 100
  (`market_buy` / `market_sell`) and says "Bought 100 food for 134 gold". The
  card shows the exchange: per resource Buy / Sell in gold and how far the
  price is above / below 100, the lot and the fee (30 %, 22.5 % with Tax
  Collectors, 15 % with Ambassadors). Market techs in the top row.
- **Capture scene `techui`** (`ui._techui_setup`; hud on, 1920x1080): the
  town scene's town in the Heroic Age with an Armory, a Market and its
  Temple, Copper Weapons and Copper Armor done, Copper Shields (39 %) and
  Ballistics in the Armory's queue, two Minotaurs training at the Temple, a
  few trades made, 14 favor left: every state at once (Bronze Weapons /
  Armor available, Copper Shields researching, Ballistics queued, Burning
  Pitch locked by the Mythic Age, the god techs short of favor but Enyo's
  Bow); the Armory selected with the tooltip of its first button (Bronze
  Weapons) open.

```
node scripts/godot-shoot.mjs --scene techui --width 1920 --height 1080 --out shots/godot/techui.png
     [--params "techui_sel=market"]   # market | temple | armory
     [--params "techui_tip=5"]        # the command slot whose tooltip is open (-1 none)
```

**Command button states** (`ui._set_state` / `_auto_state`, drawn by
`hud._draw_cmd_state`): every command carries `state`, the same language for
techs, train, build and trade buttons at every building, plus `status`
`{state, text}`, the state in words as the first line of its tooltip,
coloured by state (`hud.status_color`). **The frame's colour is the state**,
read before anything else (`hud.frame_of`): gold / purple = buyable, red =
can't afford, blue = in progress (researching, training, queued), grey =
locked; the picture backs it (full colour, red cast, blue duotone, slate).

| state | button | tooltip line |
|---|---|---|
| `available` | full-colour tile, bright bevelled frame (gold: generic tech, purple: god tech, the god's emblem on its top-left corner); a unit / building portrait keeps the cell's gold edge | "Available · Click to research" (green) |
| `unaffordable` (`short`: the missing resources) | **the same on every button** (techs, train, build, trades): the whole 3 px bevel turns red (`hud.FRAMES.red`: #ffb4a0 / #ff2a12 / #800c04, inner line #ff6a40) with a red glow into the gap between cells, the picture in full colour under a red cast (8% at the top, 16% at the middle, 42% at the foot); a god tech keeps its purple corner caps and emblem medallion, so it still reads as a god tech | "Can't afford · Need 40 more gold, 5 more favor" (red); the cost's short numbers red |
| `locked` (`age_req` when an age, else a prerequisite) | the tile desaturated and darkened (`tile(..., "locked")`); a unit / building portrait the same: `hud.locked_portrait(tex)` reads the portrait back once, turns every pixel into the tiles' locked slate grey (luminance x 0.6-0.68) and caches it (a near-black tint for the frame or two before the portrait has rendered), on a grey cell plate (no team teal; mean saturation ~0.18, the same as a locked tech tile); a dim grey frame, a badge centred on the frame's top-right corner (7.5 px radius, mostly over the frame and the gap): the required age's numeral (II / III / IV) or, locked by a prerequisite, a padlock; the hotkey dimmed. A tech locked by a prerequisite is shown only while that prerequisite is researching / queued (`ui._tech_visible`'s `busy`: the line's next step, padlocked, after the buyable buttons), else hidden as in Retold | "Locked · Requires Heroic Age" / "Locked · Requires Copper Shields" (tan) |
| `researching` / `training` (`progress`, `count`) | "busy", **the same on techs and train buttons**: the whole bevel blue (`hud.FRAMES.blue`: #d8f2ff / #2ea2ff / #0a3a80, inner #7ccaff) with a blue glow in the gap; the picture in the **busy duotone** (`TechIcons.tile(..., "busy")` / `hud.busy_portrait(tex)`, both `TechIcons.busy_image`: luminance mapped navy #06142c to ice #b4dcff, 8% of the hue kept), its full colour coming back clockwise from 12 o'clock as the work runs (`hud._reveal`, a textured fan; its leading edge an ice line), a thick 6 px progress bar on the tile's foot (blue to ice in a dark trough; the hotkey rides above it); a train button's queued count on a blue chip at the top-right corner | "Researching · 39% · 25s left · cancel it from the queue" (blue) |
| `queued` (`count`: its place) | blue bevel and the busy duotone (no colour yet), an empty dashed 6 px bar on the foot (it waits its turn), its place in the queue on the **blue corner chip** with an hourglass (the training count's chip), never over the picture: a queued Ballistics still shows its dividers | "Queued · 2nd in the queue" (blue-amber) |
| researched | off the grid (the line's next tier takes the slot); on the card under RESEARCHED with a green check | |

Every tooltip, narrow (train / build / age) or wide (techs, trades), opens
with that state line right under the name, before the cost and the hotkey.

**Nothing covers the picture** except the work in progress (a researching /
training / queued tile's 6 px bar on its foot and a researching tile's sweep
edge). Every other mark rides the frame (its 3 px bevel
and the 5 px gap between cells):
an Armory line's **tier notches** set into the frame's top edge (1-3 small
5x4 px bars in the tier's metal, `tier`; the picture itself tells the tiers
apart: one sword / two / two and an axe, copper / bronze / steel, and a
locked tier glyph keeps 20% of its metal's hue), a god tech's **medallion**
centred on the frame's top-left corner (8 px radius) with its god's emblem
(`god`; `TechIcons.GODS`: Zeus' bolt, Athena's owl, Apollo's sun, Ares'
helmet, ...: Greek gods share initials, so no letters), and on every god
tech, **in every state**, purple **corner caps** (a 3 px L bracket with
12 px arms, a lit edge and a stud, `hud._god_corners`) on all four corners
over the state's bevel: a red can't-afford or blue researching god tech
keeps the god-tech shape, a generic tech has plain corners; locked, the caps
go slate. A click or key on a
button that is not available says why (`_deny_text`: the lock, what is
short, "Copper Weapons: researching, 25s left").

The real-input playtest (`game/core/techs_playtest.gd`; harness shortcuts:
AI off, resources granted, a hoplite and a hero spawned to measure on, the
sim stepped fast while frames render):

```
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json xvfb-run -a -s "-screen 0 1280x720x24" \
  godot --path godot --rendering-driver vulkan --audio-driver Dummy --resolution 1280x720 \
  -s res://game/core/techs_playtest.gd -- --scene=skirmish [--shots=/abs/dir]   # "TECHSPLAY ok|FAIL <step>", exit = failures
```

It is slow under lavapipe: a full run is about 9.5 minutes on 4 cores
(1-2 s a frame; the last check, "S sells 100 food", lands at ~9m20s), longer
with another Godot running. Give it `timeout 900` or more and run it alone;
a 580 s timeout kills it just after "click Buy Food" and looks like a stall.
Its own watchdog quits with 99 after 1500 s.

It box-selects the villagers, checks the Armory (U) / Market (K) buttons and
the Armory tooltip's age lock (a click refused with "Requires the Classical
Age"), H + A advance the age, R + a ground click places a Temple, the Armory
button + a click an Armory, K + a click a Market (each built by the
villagers), a click on the Armory: Copper Weapons on Q in a gold frame,
Burning Pitch greyed "Requires Mythic Age", four or more god techs in purple,
no Bronze tier; the states (Copper Weapons `available` tier 1, Burning Pitch
`locked` with `age_req` 3 and "Locked · Requires Mythic Age", the god techs
with their god); with the favor taken away (harness) a god tech is
`unaffordable`, short of favor, "Can't afford · Need n more favor"; the
hover tooltip (cost, 30 s, effect, "Human Soldier: Attack +10%"); a click
on Copper Weapons pays 100 food + 100 gold and puts it in the card's queue,
its button `researching` on Q (Q again: refused, nothing paid); its key
queues Copper Armor (`queued`, "2nd in the queue") and a click on the queue
icon cancels it (exact refund); when Copper Weapons is done: the feed
notice, a hoplite's damage x1.1 (`get_unit_stats`), Bronze Weapons on Q
`locked` "Requires Heroic Age" (tier 2), Copper Weapons off the grid and
under Researched; in the Heroic Age (harness) with Copper Shields under way,
Bronze Shields `locked` with the padlock (no `age_req`), "Locked · Requires
Copper Shields" (then cancelled, the age restored); a click on the
Temple and Olympian Parentage's hotkey (100 food, 10 favor): the hero's hp
x1.25; a click on the Market: its rates on the card and the buttons' prices;
a click on Buy Food (+100 food for the shown price, the price and the label
move) and S (sells 100 food, the price falls).

## Civilizations, the Egyptians (native/src/sim/civ)

Godot-only, behind `Sim::godot_rules` (check-sim 16/16 bit-exact: with the
rules off every player is Greek, no Egyptian type spawns, places or trains).
The reference is `reference/egypt/EGYPT.md` (Retold's numbers). Owner: the
civ piece (`sim/civ/civ.{h,cpp}`, its hooks in economy / buildings / combat /
techs / fortify / match / commands, `native/src/aov_sim_civ.cpp`).

- **A civilization per player**: `Player::civ` (0 Greek, 1 Egyptian), set by
  `setup_match` from the major god (`zeus / hades / poseidon` -> Greek,
  `ra / isis / set` -> Egyptian, any case) or a player's `civ` key
  ("greek" / "egyptian") in the match config; `set_player_civ(owner, civ)`
  for scenes / checks. A Greek and an Egyptian play the same match, each with
  his own types (`unit_civ`, `building_civ`): the Greek ones (the browser's
  plus Armory, Market, walls, towers) and the Egyptian ones (units from
  `U_LABORER`, buildings from `B_GRANARY`). Town Center, House, Farm,
  Temple, Armory, Market, walls, gates and towers are both civs' (an
  Egyptian one costs gold and never wood: `civ_building_cost`); Storehouse
  and Military Academy are Greek only. A player places only his civ's
  buildings (`Civs::can_build`: civ, age, Monument order), his buildings
  train only his civ's lists (`civ_trains`), builders build only their civ's
  (`unit_can_build`: villager Greek / shared, Laborer Egyptian / shared but the
  Obelisk, Priest the Obelisk alone), techs: the Greek god techs and the
  Greek Temple techs are Greek only, Hands of the Pharaoh Egyptian only, the
  generic Armory and Market lines both (they apply to the Egyptian human
  soldiers and heroes: `M_EG_HUMAN`, `M_HERO`; Ballistics / Burning Pitch to
  Slingers and Chariot Archers). Unit masks are 32 bits now (`UnitMask`).
- **Start** (Retold): Town Center, `villagers - 2` Laborers (3 of the
  default 5), the Pharaoh, a Priest, and for Set a Baboon of Set (the
  scout animal, an Animal of Set: below; drawn with its own `baboon_of_set`
  rig in `egypt_units`). Stockpile: Retold's 200 f / 100 w /
  50 g / 0 favor on "standard" (the Greeks' 300 / 300 / 200 / 20), i.e. the
  setup's stockpile x `EGYPT_START_RES` (2/3, 1/3, 1/4, 0): "low" 100 / 50 /
  25, "high" 667 / 333 / 187.5; "deathmatch" keeps its 10000s (favor 0); an
  AI's difficulty bonus is added on top as for the Greeks.
- **Economy**: Laborers gather x0.9 (their rates are the villager's x0.9,
  farms `FARM_RATE` x0.9), build at 0.75 (a site's rate is (1 / time) x
  n^0.75 x the builders' mean work rate: a House is 15 s for a villager, 20 s
  for a Laborer, Retold's x4/3), never worship (the order is refused), a cap
  of 100 (living + queued). Carry (Retold, EGYPT.md 1.2): a Laborer takes
  15 food, 10 wood, 10 gold to a drop site (`LABORER_CARRY`,
  `unit_carry_cap`; berries, farms, hunt and carcasses alike), a Greek
  villager 10 of each as before; `get_unit_def(t).carry` gives it per
  resource and the unit panel shows "/ 15" or "/ 10". Retold's +5 wood / gold
  carry per gather tech and +15 food with Husbandry are not in this game:
  neither civ has gather techs here (Husbandry, Hand Axe, Pickaxe ... are
  not built), so the base values hold all match. Drop sites: Granary (food), Lumber Camp (wood),
  Mining Camp (gold), all free; the Town Center takes everything. Favor only
  from the five Monuments (one each, in order: a later one needs every
  earlier one standing, a foundation will do), 4.5 / 6 / 7.5 / 9 / 12 per
  minute (39 with all five), capped at 200 like the Greeks'. The Mythic Age
  needs a Migdol Stronghold (and the Heroic an Armory or a Market, as the
  Greeks). The free worker of `Economy::rescue` is a Laborer.
- **The Pharaoh** (one, free, 0 pop, not trainable; respawns at his home
  Town Center, else any, 90 s after he fell; Set's summons Animals of Set,
  below): `O_EMPOWER` (order type
  "empower", `order_empower(ids, building)`, a right-click on an own
  building but a Farm) walks him to the building; standing within 2 tiles of
  it he empowers it (`B.civ_empower`, 1; Ra's Priests 0.6; several do not
  stack): construction and repair +75 %, training +75 % (not Laborers),
  research +75 % (age-ups are the player's, not empowered), +20 % on each
  drop at it, Monument favor +20 %, x0.75 reload of a shooting building
  (Town Center, Migdol, tower), Obelisk LOS +75 %. He and the Priests heal
  the most hurt ally within 6 tiles (Retold 10 x 0.6) while idle: 10 / 7.5
  hp/s, half on a busy target; a healing Priest does not auto-attack. Both
  grow with the age (hp, damage, range, LOS: `hero_age`, applied on
  `age:advanced` and at spawn). Isis' Priests build Obelisks 40 % faster.
- **Major gods' passives** (EGYPT.md 4, `Civs::cost / pop_bonus /
  gather_bonus / tech_cost_mult` and the spawn handler): Ra: Laborers +30 %
  on berries, Chariot Archer / Camel Rider / War Elephant +15 % hp, his
  Priests empower (60 %); Isis: a Town Center +5 pop (20), techs -10 % food /
  wood / gold (not favor, not age-ups), Obelisks 5 gold and built 40 %
  faster by her Priests; Set: Spearman / Axeman / Slinger +5 % speed,
  Barracks / Siege Works / Migdol -25 % gold, the starting Baboon.
- **Monument auras** (EGYPT.md 1.4 and 4, `Civs::auras / shield_allows /
  train_cost_mult`; Retold metres x0.6, measured from the Monument's
  footprint, built Monuments only):
  - Ra's **Mandjet**: a Monument the Pharaoh himself empowers (full
    strength; a Ra Priest's 60 % does not count) lends 60 % empowerment to
    every other building of his within 18 tiles (30 m), other Monuments
    included, Farms not: +45 % train / build / research, +12 % drops and
    Monument favor. No stacking (the strongest empowerment of a building
    wins), no chaining. `Civs::mandjet_by[row]` = the lending Monument.
  - Isis' **Divine Shield**: no enemy god power can be cast within 15 tiles
    (25 m) of a Monument, 30 tiles (50 m) when it is empowered
    (`GodPowers::cast` refuses: nothing paid, no cooldown); her own and her
    allies' powers are not blocked. An empowered Monument heals her units
    and her allies' (not siege) within 30 tiles at 1 hp/s, half if busy,
    stacking across Monuments; its favor is +100 % (`ISIS_EMPOWER_FAVOR`)
    instead of +20 %: Monument to Villagers 4.5 -> 9 / min (Ra / Set 5.4).
  - Set's **Devotees**: a Barracks or Migdol of his within 18 tiles of a
    Monument trains at -10 % (all resources; EGYPT.md gives no distance,
    Mandjet's 30 m is used); no stacking; a cancelled unit refunds what was
    paid (`TrainItem::cost_mult`).
  - Not yet: the god powers (Rain, Prosperity, Vision) and the unique techs
    (another piece's). The setup screen's
  pantheon picker (game/menu/setup) still lists the Egyptians as "not in the
  game yet": a match config with `god: "ra" | "isis" | "set"` (main.gd's
  `match` arg, `start_match`) plays them already.
- **Set's Animals of Set** (EGYPT.md 1.5, 1.6, 3.2, 4 Set; the numbers
  EGYPT.md leaves out from the Retold wiki's Animal of Set tables, as of
  update 19.12998): class `CLS_ANIMAL` ("animal"), Egyptian types from
  `U_BABOON` to `U_BOAR_OF_SET` (`is_set_animal`, `set_animal(t)`: summon
  age, food, converted from).
  - **Summons**: Set's Pharaoh summons them for favor
    (`Civs::summon`, `summon_animal(pharaoh, type)`, `get_summon_menu(pharaoh)`):
    no order, a queue of his own (5 at most, one at a time, the head runs)
    that never interrupts what he does (he walks, empowers, heals, fights on);
    the animal appears beside him after its summon time; pop is counted while
    queued (`Economy::recount` adds `Civs::summons`), the favor is paid on
    queueing and refunded if he falls. By age: Archaic Baboon (3 favor, 3 s);
    Classical Gazelle (3, 3 s), Hyena (4, 4 s); Heroic Giraffe (5, 4 s),
    Crocodile (6, 4 s); Mythic Hippopotamus (7, 6 s, 2 pop), Rhinoceros (9,
    6 s, 2 pop), Elephant (14, 8 s, 2 pop). Refused: another god's or a
    Greek's Pharaoh ("Only Set's Pharaoh summons Animals of Set"), the age
    ("Requires Classical Age"), "Need more houses", "Not enough favor",
    "Queue full".
  - **Age-ups**: on each age-up (`age:advanced`, and `set_player_age` through
    `Civs::age_set`, which also applies the Pharaoh's / Priests' per-age hp
    and LOS) Set gets 3 at his first standing Temple (none: the home Town
    Center): Classical 2 Gazelles + 1 Hyena, Heroic 2 Giraffes + 1 Crocodile,
    Mythic 2 Hippos + 1 Rhino (`set_age_animals`), free.
  - **Conversion**: Set's Priests convert a live wild animal (`O_CONVERT`,
    order type "convert", `order_convert(ids, animal)`, a right-click on a
    deer or boar): he walks within 6 tiles (Retold 10 x 0.6), channels
    (`order_x` = seconds, kept if the animal grazes off and he follows) for
    Retold's 35 s (deer) / 50 s (boar), and the animal becomes his Deer /
    Boar of Set (Retold's converted stats) where it stood. Another god's
    Priest, a Greek or any other unit cannot (the order is refused).
  - **Food**: an Animal of Set that dies leaves a carcass (a dead deer, or a
    boar for the 2-pop ones) with its food: Retold's Amount for the summoned
    (Baboon 93.75, Gazelle 150, Hyena 93.75, Giraffe 300, Crocodile 187.5,
    Hippo 375, Rhino 487.5, Elephant 675), and for the converted 75 % of this
    sim's wild animal (deer 100 -> 75, boar 250 -> 187.5); Laborers butcher
    it like any hunt.
  - **Stats** (mapped as the other units): Baboon 20 hp / 3 hack / ROF 1 /
    35-5 % armor, Gazelle 15 / 3.5 / 1.1 / 35-0, Hyena 45 / 7 / 1.8 / 20-30,
    Giraffe 25 / 5 / 1.4 / 35-5, Crocodile 70 / 9 / 1.3 / 10-30, Hippo 100 /
    6 / 1 / 10-20, Rhino 135 / 8 / 1.1 / 30-40, Elephant 270 / 10 / 1.4 /
    20-40, Deer 15 / 3 / 1.1 / 35-0, Boar 70 / 6 / 1 / 20-30; speed (3.3 / 4 /
    5) x0.65, LOS (16 / 14) x0.6, reload x1.15, armor x0.75; in the Archaic
    Age they hit at 10 % (Retold's -90 %); x0.5 vs buildings (the Elephant
    x1.5). They can be healed (Retold). No Armory upgrades (Retold).
  - **Laborers' bow**: a Laborer attacking an Animal of Set shoots Retold's
    anti-animal attack, 12 pierce at 7.2 tiles (12 x 0.6) every 2.3 s (ROF
    2 x 1.15), an arrow; wild deer / boar are still hunted with this sim's
    spear (3 per 1.5 s at 3.4 tiles, the villager's).
  - The renderer draws them with stand-in rigs (`stand_in`: `baboon_of_set`,
    the Crocodile `petsuchos`, the Elephant `war_elephant`) until their
    models exist; `get_civ_fx()` has `converts` [priest, animal]* and
    `convert_progress` (0..1) for a conversion effect.
- **Retold's Egyptian prices and times where they differ from the Greek
  ones**: the Watch Tower costs an Egyptian 50 w + 100 g (Greek 100 + 100),
  the Fortified Wall 500 f + 400 g, the Citadel Wall 800 f + 500 g
  (`civ_fort_tech_cost`: research, refund, `get_fortify`, `get_techs` and the
  AI's wall / tower upgrades); one Laborer builds a Town Center in 200 s
  (Retold's 150 base), a Farm in 13.3 s (10 base), a Sentry Tower in 80 s
  (60 base) (`civ_build_time`, the row's `fort_build_time`; the Greeks keep
  this sim's 60 / 12 / 30); the other shared types' base times are Retold's
  already (House 15, Temple 40, Armory / Market 40). Drop sites', the
  Barracks' and the Siege Works' LOS 5.4 (Retold's 9 x 0.6; the Migdol 18,
  the Obelisk 19.2, the Monuments 5.4 by the same rule). The Guard and Ballista Tower stages keep the Greek
  prices (EGYPT.md gives none); the Citadel Wall and Ballista Tower are not
  Egyptian-only here.
- **Egyptian walls** (EGYPT.md 2, Stone Wall; `civ_wall_piece_cost`,
  `civ_fort_tech_time`, `EGYPT_WALL_AGE`, `Fortify::grant_level`): an
  Egyptian builds walls from the Classical Age (`plan_wall` / `place_wall`
  in the Archaic: "Requires Classical Age"), and reaching it (a real age-up
  or `set_player_age`) gives him the Stone Wall stage free: Retold has no
  Stone Wall research (its walls are stone from the Classical Age), while
  this sim's Greeks still research it (150 w + 100 g, 40 s) from their
  Archaic Wooden Wall (`get_fortify` lists the Egyptian `stone_wall` as done,
  cost {}). Pieces are priced as Retold's segments, gold only: a pillar (the
  connector) 3 g, a segment of 1 tile (short) 6 g, 2-3 tiles (medium) 9 g, 4
  tiles (`WALL_SEGMENT_MAX`, long) 15 g (an 11-tile line, pillar-4-pillar-4-
  pillar, is 39 g; the Greek pays 4 w + 2 g a tile, 44 w + 22 g). The
  Fortified Wall is 500 f + 400 g and 50 s, the Citadel Wall 800 f + 500 g
  and 50 s (the Greek 60 s). Hp and armor stay this sim's shared wall stages
  (Stone 450 per tile, Fortified 700, Citadel 1000, pillars x1.5; `Fortify::armor_mult`
  on wall pieces: x0.15 arrows, x0.6 blows, not on siege, myth units or god
  powers): Retold gives the Greek and the Egyptian Stone Wall the same 1,200 hp
  and 55 / 90 / 5 % armor, and this sim's tile walls already map that wall for
  the Greeks, so both civs share the mapping. Gates keep the shared
  conversion (its wood paid in gold by an Egyptian). egypt_check
  `civcosts.walls` measures it on both civs.
- **Mapping Retold onto this sim** (`civ.h` head, `egypt_unit(t).mapping`
  per unit): hp and damage as Retold; speed x0.65 (the Laborer: the
  villager's 2.7 / 4.0 ratio); range and LOS x0.6 (`DIST_SCALE`); reload
  x1.15 for every Egyptian unit, the Laborer included (Retold ROF 1 -> 1.15 s,
  6 hack every 1.15 s = 5.2 hack/s; the Greek villager keeps the browser's
  1.5 s), asserted per unit by egypt_check `units.reload`; armor: Egyptian units have a hack (`UnitDef.armor`) and a pierce
  armor (`EgyptUnit.pierce_armor`) = Retold's x0.75 (the hoplite's 0.30 is
  Retold's 40 % hack), read by `Techs::unit_armor` (arrows pierce, blows
  hack); the Laborer too (25 / 35 % -> hack 0.1875, pierce 0.2625; the Greek
  villager keeps 0); train time as Retold (the
  Laborer 17 x 10 / 15, as the villager's 10 s for Retold's 15). Bonuses are
  the class multipliers (Spearman x2 cavalry, Axeman x4 infantry, Slinger
  x2.25 archers, Chariot Archer x1.5 infantry, Camel Rider x2 cavalry and
  x1.25 archers, War Elephant x1.5 archers and x4 vs buildings, Priest x5 /
  Pharaoh x2.5 myth). Population: the browser halves Retold's human-soldier
  pop, rounding up (Retold hoplite / toxotes 2 -> 1, hippikon 3 -> 2, the
  villager 1), under Retold's caps (TC 15, House 10, `POP_MAX` 300, the same
  for both civs), so the Egyptian ones are mapped alike: Spearman / Axeman /
  Slinger / Priest 2 -> 1, Chariot Archer / Camel Rider / Siege Tower 3 -> 2,
  War Elephant / Catapult 5 -> 3; the Laborer 1, Mercenaries and the Pharaoh
  0 as Retold; the Animals of Set keep Retold's 1 / 2 (summoned for favor, as
  the myth units, whose pop this sim does not halve). Under the same cap an
  Egyptian fields as many men as a Greek. Ranged units (toxotes, Slingers,
  Chariot Archers) stand and shoot, they never kite, whatever the civ: at
  equal cost or pop, infantry that reaches them wins (10 Slingers lose to 10
  Spearmen as 10 toxotes to 10 hoplites; Retold's own numbers give the same
  for a fight without micro: a Slinger's 4 pierce on a Spearman's 10 % is
  3.6 hp/s, 8 of them kill one Spearman in the ~3.4 s he walks 17 m, then
  lose the melee); Slingers beat archers (x2.25). Building limits
  (`civ_building_limit`, `can_build`, `by_civ.egyptian.limit`): one of each
  Monument (in order) and 15 Migdols, standing or foundations; the shared
  types' Retold limits (House 16, Sentry Tower 30, one TC in the Archaic
  Age) are not applied, because this sim's Greeks have none and must play
  as today. The Laborer's x4 vs towers multiplies his blow on a
  tower (6 x 0.35 x the tower's armor: 6.72, a villager's 0.84). Siege: a Catapult stone is 42 vs units (40 pierce + 200
  crush x the 1 % human crush vulnerability; no area, no minimum range here)
  and 200 crush vs buildings, a Siege Tower 9 vs units and 59.1 crush per hit
  vs buildings (Retold's 180 / 3.5 s at a 1.15 s reload), crush less the
  building's crush armor (5 %), not the browser's flat x0.35. Buildings: the
  shared types keep the Greek building's hp and footprint (base build times:
  Retold's, above);
  the Egyptian ones take Retold hp x1.25 (the TC / Temple / Academy ratio),
  footprints of the models (drop sites 3x3, Monuments 2x2 / 3x3, Barracks
  5x5, Migdol 6x6, Siege Works 5x5, Obelisk 1x1), Retold armor (40 / 90 / 5,
  Migdol 50 / 90 / 5, Monuments and Obelisk 5 / 90 / 5), LOS x0.6. The Migdol
  shoots one arrow of 10.35 every 1.6 s at 12 tiles (3 x 11.5 against the
  TC's 2 x 10 in Retold, on this sim's TC arrow of 6). Mercenaries lose 2.5 /
  4 hp/s (limits 12 / 8). Not in this game (yet): ships and the Dock,
  Caravans, the Lighthouse, the Wonder, the per-line Medium / Heavy / Champion
  upgrades and Levy / Conscript techs, relics, the Egyptian minor gods,
  their god powers and myth units (other pieces'); the wild animals other than
  deer and boar (this sim has only those two to convert).
- **Scene `egypt`** (`sim/civ/egypt_scene.cpp`, entry in
  `game/core/scenes.gd`): player 1 Egyptian (Ra, Mythic) at the first start,
  Laborers at a Lumber Camp (empowered by the Pharaoh), a Mining Camp and a
  Granary, Houses, the five Monuments, an Obelisk, Temple, Barracks, Migdol,
  his army in ranks with two Priests healing wounded Spearmen; a Greek player
  2. `node scripts/godot-shoot.mjs --scene egypt --out shots/godot/egypt-scene.png`.
- **Scene `egypt_set`** (same file): a Set player reaching the Heroic Age
  at his Temple (the two age-ups' 6 animals there), the Pharaoh walking by
  and summoning a Baboon, a Hyena and a Crocodile, a Priest converting a deer
  herd, Laborers butchering a fallen Gazelle of Set by a Granary; a Greek
  player 2. `node scripts/godot-shoot.mjs --scene egypt_set`.
- **Renderer**: every Egyptian unit has its own rig now ("Egyptian units and
  myth units: the look"); a type without one falls back as before: `units.gd` draws an Egyptian unit
  with its Greek stand-in's rig (`get_unit_def(t).stand_in`) and
  `buildings.gd` an Egyptian building with its stand-in model or a sandstone
  placeholder block (Monuments, Obelisk). `get_buildings()` has `empower`
  (0..1) and `civ` (the owner's) per building; `get_civ_fx()` the heal and
  empower pairs for beams.

API (all Godot-only): `civ_names()`, `get_civ(civ)` ({key, name, gods,
build_menu, units, buildings, worker}), `set_player_civ(owner, civ)`,
`get_build_menu(owner)`, `can_build(owner, type)` ({ok, reason}),
`get_trains(building)` ([{type, ok, reason}]), `order_empower(ids,
building)`, `get_civ_state(owner)` ({civ, monuments, empowered,
favor_per_min, favor_made, drop_bonus, pharaoh, respawn_in, laborers,
laborer_cap, home_tc}), `get_civ_fx()` ({heals: [healer, target]*,
empowers: [unit, building]*, empower_strength}), `get_building_def(type,
owner = 0)` (owner > 0: his civ's cost and trains; plus civ, stand_in,
armor, by_civ {greek|egyptian: {cost, trains, build_time for one builder}},
monument / favor_per_min), `get_unit_def(type)` (plus civ, hack_armor,
pierce_armor, stand_in, retold, mapping, limit, heal, decay, by_age),
`get_player(id)` (plus civ, civ_id); `get_civ_state` also gives `god`,
`empower_favor`, `mandjet` ([{id, type, by}]), `shields` ([{id, x, z,
radius, heals}]), `devotees` ([{id, type, by, cost_mult}]), `isis_healed`,
`devotee_saved`, `shield_refused`; `get_trains` gives each unit's `cost`
there (Devotees applied) and `devotees` (the Monument); `get_civ_fx().mandjet`
[monument, building]*; `shield_check(caster, x, z)` ({ok, reason, by}: a god
power's target under a Divine Shield); `get_techs(building)` /
`get_owner_techs(owner, type)` list only the owner's civ's techs (`tech_civ`).
Set's animals: `get_summon_menu(pharaoh)` ([{type, name, cost, time, age,
pop, ok, reason}]), `summon_animal(pharaoh, type)` ({ok, reason}),
`get_summons(owner)` ([{pharaoh, type, t, total}]), `order_convert(ids,
animal)`; `get_civ_state` also `summoned`, `converted`, `age_gift`,
`carcass_food`, `animals_of_set` ({type: n}), `summon_pop`; `get_unit_def`
of an animal: `animal_of_set`, `food`, `summon_age`, `summon_time` or
`converted_from` / `convert_time`, `archaic_attack`; of the Laborer:
`vs_animals` {damage, range, cooldown}; of the Priest: `convert_range`;
`get_building_def(...).by_civ[civ]` has `base_build_time` and `build_time`
(one builder).

```
godot --headless --path godot -s res://game/core/egypt_check.gd [-- --only=defs,match,economy,units,pop,limits,pharaoh,priest,gods,auras,set,civcosts,locks,determinism,rules_off]   # ~1 min
```

`egypt_check.gd` ("EGYPT PASS|FAIL <case>", `EGYPT_RESULT {json}`, exit =
failures): the civs and every Egyptian unit's / building's numbers; the god
picks the civ and the Egyptian start; a 5-minute Greek vs Egyptian economy
on the same woods / mine / farms (today: Egyptian / Greek wood 0.94, gold
0.88, food 0.90; favor 3 worshippers 76 vs the five Monuments 195), drop
sites, no worship; each unit's live stats, its bonus on a first blow, and
its counters fought at equal cost (900 resources: Spearmen beat hippikons,
Axemen hoplites and Spearmen, Slingers toxotes, Camel Riders hippikons and
Chariot Archers, hippikons Slingers, War Elephants toxotes; reported: this
sim's archers do not kite, so Chariot Archers lose a straight fight to
infantry as the Greek toxotes does); population (`pop`): each unit's pop
(Spearman / Axeman / Slinger / Priest 1, Chariot Archer / Camel Rider /
Siege Tower 2, War Elephant / Catapult 3), 10 hoplites and 10 Spearmen add
10 each, the same room under the cap trains as many Spearmen as hoplites
(50 / 51, refused "Need more houses"), the counters again at equal pop (10
Spearmen beat 5 hippikons 10 left, 10 Axemen 10 hoplites 9 left, 10
Slingers 10 toxotes, 5 Camel Riders 5 hippikons and 5 Chariot Archers, 5
hippikons 10 Slingers, 10 Axemen 10 Spearmen; reported: 10 Spearmen lose to
10 hoplites 0 / 8, 3 War Elephants beat 9 toxotes), and ranged vs infantry
reported (10 Slingers holding lose to 10 Spearmen walking in 0 / 7, as 10
toxotes to 10 hoplites 0 / 10); limits (`limits`): 14 Migdols built and a
15th foundation, the 16th refused "Limit of 15 Migdol Strongholds", a fallen
one frees a slot, 31 Egyptian towers and a 32nd allowed; the Pharaoh's empower measured
(wood x1.20, 3 Spearmen 37.6 -> 21.5 s and Laborers unchanged, a House 20 ->
11.46 s for a Laborer (15 s for a villager), Copper Weapons 30 -> 17.2 s,
Monument 4.5 -> 5.4 favor / min), his respawn at the TC at 90 s and his
stats by age; healing 7.5 / 10 / 3.75 hp/s; the civ locks both ways,
Monument order, the TC's Priests, Mercenary and Laborer limits, a Migdol
for Mythic, builders; the major gods' passives (Ra's berries 0.877 vs 0.675
food/s, camel 155.25 hp, Set's Spearman 3.41 speed and 56.25-gold Barracks,
Isis' 20-pop TC, 90 / 90 Copper Weapons and 5-gold Obelisk); the Monument
auras (empowered Monument to Villagers 5.4 / min for Ra and Set, 9.0 for
Isis, measured over 30 s; Mandjet: Monument 2 and a Barracks 9 tiles off at
0.6, a Barracks 26 tiles off and a Farm not, favor 12.12 / min, 3 Spearmen
37.6 -> 25.9 s, none from a Ra Priest's or an Isis Pharaoh's Monument;
Divine Shield: a Greek Bolt refused at 10 tiles (no favor paid) and cast at
20, refused at 20 / 29 once empowered and allowed at 31; Isis' healing 0 /
1 / 2 hp/s with 0 / 1 / 2 empowered Monuments, 1 for a walking man under
two, 0 at 32 tiles; Devotees: Set's Spearman 45 f + 22.5 g near, 50 + 25
far, Camel Rider 45 + 63 at the Migdol, refund 45 + 22.5, Ra's in full);
the Egyptian stockpile 200 / 100 / 50 / 0 and Set's Baboon; the Laborer's
6.72 on a tower against the villager's 0.84; the limit message "Limit of 12
Mercenaries"; Set's animals (`set.*`: the summon menu by age, 3 + 3 favor and
Baboons at 3.0 / 6.1 s while the Pharaoh walks on, an Elephant of Set 14
favor in 8 s, refusals; 2 Gazelles + 1 Hyena at the Temple on a real
Classical age-up, then Heroic and Mythic's on `set_player_age(3)`, none for
Ra; a Priest channelling 35.0 s on a deer from 5.6 tiles and 50.0 s on a
boar, the wild deer gone, its Deer of Set's carcass 75 food butchered by a
Laborer, refused for Ra's Priest, a Greek-owned one and a hoplite; every
animal's stats, a Hyena's blow on a hoplite 0.49 Archaic / 4.9 Classical, a
Laborer's arrow 9.3 on a Hyena from 7 tiles without walking, 4 Laborers
shoot down 2 Hyenas and all live); Retold's Egyptian prices (`civcosts.*`:
Watch Tower 50 w + 100 g paid and refunded, Fortified / Citadel Wall 500 f +
400 g / 800 f + 500 g, Greek 100 + 100 and 250 w + 200 g; one Laborer's TC
201 s, Farm 14.7, tower 81, House 21 with the walk, the villager's 61 / 13 /
31; a hoplite's blow 7.31 on a Laborer vs 9 on a villager, a toxotes arrow
5.16; drop sites' LOS 5.4); a mixed Greek + Egyptian match twice, bit-equal,
and a Set match with summons, a conversion, an age-up gift and an animal
fight twice, bit-equal; rules off refuses (no Animal of Set spawns, no
convert, no summon).

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
  `towers/*` by `scripts/export-towers.mjs` (see "Towers: the look"),
  `techbuildings/*` by `scripts/export-techbuildings.mjs` (see "Armory and
  Market: the look").
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
`clear_rect(tx, tz, w, h)`, `paint_ground(tx, tz, w, h, ground)` (Godot-only scene tool: `GameMap::paint_tiles`, render only; 1 dirt, 2 sand, 4 paved), `kill_unit(id, killer=0)` (combat.kill: dead,
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

Research, techs, market (Godot-only, see "Research, Armory, Market, Temple
techs"): `research(building, key)` also takes an Armory / Market / Temple
tech, `cancel_research(building, key="")`, `tech_names()`,
`get_tech_def(key)`, `get_techs(building)`, `get_owner_techs(owner,
building_type)`, `get_research(building)`, `get_player_techs(owner)`,
`set_minor_god(owner, age, god)`, `grant_tech(owner, key)`,
`get_unit_stats(id)`, `get_market(owner=1)`, `market_buy(market, res)`,
`market_sell(market, res)`, `tribute(from, to, res, amount)`,
`set_tech_rules(opts)`, `get_tech_rules()`; `get_building(id).research`.

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
  skipped) and leaves a gap at blocked tiles (trees, water, steep ground);
  a line across a building (any, a foundation too, not the owner's wall it
  joins) is refused whole, "A building is in the way" (`plan_wall` counts
  them, `on_building`; the AI's ring, laid round its own town, passes
  `through_buildings` and keeps the gap instead); each run of new tiles gets a
  pillar at both ends (none next to a joint), at corners with two 2+ tile
  arms and evenly so no two pillars stand more than 5 tiles apart as the
  crow flies (a straight run: segments of at most 4; a line at an angle is a
  staircase of tiles, spaced by its length, not its tile count), segments
  in between. 4 wood
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
  `gate:changed` (a = 0 converted, 1 locked, 2 unlocked), `tech:researched` (a = 1..6 a fortify stage, 100 + TechId an Armory / Market / Temple tech: `get_tech_def(key).event_a`).
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
- **Wall ring** (every difficulty, from `wall_at`: Easy 12 min, Moderate 10,
  Hard 7, Titan 6; `wall_builders` 2 / 3 / 4 / 5): a square with clipped
  corners (`R / 8`) round the Town Center, half-width the smallest of 15..22
  that holds every building of its own with 2 tiles to spare (archers shoot
  12 over a wall), at most 0.36 of the way to the nearest other Town Center;
  4 + 4 lines (the side facing the enemy first), each straight side leaving
  a 3-tile opening slid to open ground. A line goes down when it can be paid
  (+40 wood, +15 gold kept); the first tower comes first; while a line or a
  tower waits, an army of 8+ at home stops the academies from spending the
  wood and gold (`wall_saving`) and gold gets 30 % of the workers; a line
  kept waiting 40 s (`LINE_PATIENCE`) holds them with any army at home (a
  wave out would otherwise leave the ring waiting for good), and while it
  waits for wood 40 % of the workers go to the woods; `wall_builders`
  villagers are kept on the foundations;
  a foundation they stand short of for 6 thinks (water, trees round it) is
  pulled down and paid back. Planned lines and openings (+2 tiles each
  side) are kept free of the AI's own farms / houses (`reserved`). Once the
  ring stands each opening is filled from pillar to pillar (one segment)
  and turned into a gate, several at once but never the last way out while
  others are rising; an opening left open (its segment broken, ground
  taken) or a gate broken is tried again every 60 s once no foe is within
  14. Every think one ring line is laid again (`patch_ring`: tiles that
  were trees, berries or a farm, and pieces the enemy broke, once no foe is
  within 8 of the new tiles); a hole of up to 12 tiles keeps no reserve and
  holds the academies until it is paid. Every 20 s a path from the Town
  Center to outside the ring (its own gates open) must exist, else a
  straight segment becomes a gate (or, short of gold, is pulled down).
- **Upkeep**: tower / wall stages researched as the age allows (Watch
  Tower and Stone Wall from Moderate; the tower's first, +30
  wood +20 gold kept; while one waits the academies of an army of 8+ at
  home wait too, up to 90 s per tech, `upgrade_holds`); the most damaged
  piece or building (fortifications and the Town Center first) under 70 %
  hp with no foe within 8 gets `repairers` villagers (Easy 1, Moderate 2,
  Hard / Titan 3; free, Fortify's repair).
- **Attacking walls**: the sim's breach rule sends each walled-off man at
  the wall piece nearest to him; the AI turns each group of breakers (16
  tiles) onto one of the pieces they picked, the least hp x (1 + distance /
  4), kept until it falls (`breach_picks_`), for the men within 12 of it.
  On top of that, every 2 s, the **siege** (`siege`, `fort.sieges` /
  `sieged` / `breached`): our men out of the town (25+ tiles) in groups of
  14 tiles, a group held up by a wall (one walled off, or at a piece)
  whose target building (the one most of them attack, else the nearest)
  cannot be walked to (enemy gates closed) is set on one piece: among the
  enemy pieces within 90 whose fall opens a way (open ground on both
  faces: no staircase piece of a clipped corner), the least hp x (1 +
  distance / 6) + 25 x its distance to the building, the first of 48 they
  can walk up to (a 40000-node search, 24000 expansions per check, one
  group's search per check; a ring backed by a forest is skipped at once
  by the region cut); at most 12 men on it, only men stuck at the wall are
  turned, a man fighting a foe he can reach keeps fighting; bowmen shoot
  the foes within 9 of the piece that are in bow range (repairers, men
  behind it), else the piece; a group of bowmen alone goes home to march
  with the next wave (`regroups`). Each man keeps the building as his real
  target (`order_a`, `ATK_BREACH`): the sim sends him through the hole once
  the piece is down. A piece unhurt for 30 s (crowded out, repaired under
  their blows) is given up for 120 s; a group with no piece to get at is
  sent at another enemy building it can reach, the Town Center first
  (`retargets`). An open gap needs nothing: the path goes through it.
  Combat (Godot rules): a man breaking a wall does not turn on a foe behind
  it (no straight walk to him, `line_walkable`); a man walled off from his
  target searches again every 4 s (a building) / 2 s (a unit), not every
  tick (`WALLED_REPATH`).
- **Meteor**: wall pieces do not count in the AI's clump of enemy
  buildings (a Meteor is cast on the town; the men break the wall).
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
  by the next food villager or, after 90 s, pulled down and paid back; and
  (round 2) a storehouse goes up by a wood line / mine being worked by 3+
  villagers 16+ tiles from every drop-off (every 5 s, one at a time, at
  most 4, `storehouses`), and with food over 1500 and wood or gold under
  300 the workers go 20 / 40 / 40 % food / wood / gold (AI-vs-AI matches
  had ended with 9000 food, no wood, no gold, no army).
- `fortify_now(towers)` (stress scene, `set_ai {fortify_now}`): the ring
  and openings placed finished and paid, gates converted, the towers built.

```
godot --headless --path godot -s res://game/core/aifort_check.gd [-- --only=build,upgrade,repair,breach,gap,fear,determinism,matches,siege --seed=1 --minutes=50]
node scripts/godot-shoot.mjs --scene aifort --out shots/godot/aifort.png [--seed 2]
     [--params "aifort_ai=hard,titan&aifort_t=16&aifort_focus=breach|town&aifort_owner=2"]
```

`aifort_check.gd` ("AIFORT PASS|FAIL <case>", `AIFORT_RESULT {json}`, exit =
failures, ~10 s): **build** (a Hard AI in peace for 20 min: 2+ towers within
26 tiles, a ring closed by its pieces (and trees) with a gate, villagers
working outside it), **upgrade** (Watch Tower, Stone Wall in the Classical
Age), **repair** (a ring piece and a tower at 30 % back over 60 %),
**difficulty** (Moderate 1-2 towers and a closed ring with gates by 18 min,
Easy at most one tower and its ring by 25 min),
**breach** (24 hoplites at a walled town break in and hit the Town Center;
with the focus the two most hit pieces take >= 50 % of the hits, 15 points
more than each man on his nearest piece, or only one or two are hit), **gap**
(that piece pulled down first: in through the opening, nothing destroyed,
sooner), **fear** (6 men facing three towers are held or sent elsewhere, lose
<= 2), **determinism**, **matches** (Hard v Hard, Titan v Hard, Hard v Titan
decided), **siege** (Titan v Titan, favor held at 0 so no Meteor, on the
first seed from seed + 7 where both rings close (on the age plans one side
can fall before it walls in): sieges > 0, a wall / pillar / gate piece
destroyed with its last hit from a soldier, the match decided within 75 min). Capture scene `aifort`: a two-AI match played `aifort_t` minutes in
the setup, the camera on the wall piece hit most in the last minute (else
`aifort_owner`'s Town Center).

**Enemy AI: research, ages, Market** (Godot-only, behind the rules,
`native/src/sim/combat/enemy_ai_techs.cpp`, called from `EnemyAI::update`
after the storehouses): the AI uses the tech tree of "Research, Armory,
Market, Temple techs" the way Retold's AI does, scaled by difficulty
(`AIParams`, `ai_params(d)`). Deterministic: no rng draw, rows in order.

| | Easy | Moderate (default AI) | Hard | Titan |
|---|---|---|---|---|
| Armory | 9 min into the Classical Age, 12 villagers, after its ring / towers | 1.5 min in, 18 villagers, after its ring / towers (at most 7 min more) | 45 s in, 16 villagers | 20 s in, 14 villagers |
| Market | never | in the Heroic Age, 1 min after its Armory | Classical, 1.5 min after its Armory | Classical, 45 s after its Armory |
| Age plan (`classical_at` / `heroic_at` / `mythic_at`, saving from `age_lead` s before) | Classical at 11 min, no later age | Classical 7, Heroic 15 | Classical 5.5, Heroic 13, Mythic 23 | Classical 4, Heroic 11, Mythic 19 |
| Reached (peace, measured) | Classical ~10 | Classical ~8, Heroic ~21 | Classical ~6-7, Heroic ~19, Mythic ~28 | Classical ~5, Heroic ~14, Mythic ~25 |
| Villagers (Godot rules) | 18 | 26 | 42 | 50 |
| Guard (soldiers trained whatever it saves) | 4 | 4 | 8 | 8 |
| Techs (tier) | 0: Copper Weapons, Copper Armor | 1: + Copper Shields, Labyrinth of Minos, Golden Apples, Bronze Weapons / Armor | 2: + Ballistics, Sarissa, Tax Collectors, Bronze Shields, Sun Ray, Temple of Healing, Iron Weapons / Armor, Monstrous Rage | 3: + Aegis Shield, Oracle, Forge of Olympus (first in the Mythic Age), Iron Shields, Olympian Weapons, Burning Pitch, Ambassadors, Omniscience |
| Saving (escrow) | 30 s per item, then 150 s at half | 60 s, 90 s at half; age-up 150 s | 120 s, 60 s at half; age-up 240 s | 180 s, 45 s at half; age-up 300 s |
| Trades | none | glut beyond 1800 | 1400, a lot every 1.5 s | 1100, a lot every 1 s |

- **Gods**: on reaching an age it takes that age's minor god
  (`Techs::set_minor_god`, only if none is set): Athena (Classical: its
  minotaurs and hoplites), Aphrodite (Easy / Moderate) or Apollo (Hard /
  Titan) in the Heroic Age, Hera (Hard) or Hephaestus (Titan) in the Mythic.
  Only that god's techs open, as for a player.
- **The plan** (`PLAN`): the Classical Armory line first, then per age its
  economy techs (Tax Collectors, Golden Apples), its armor / weapon lines
  (urgent) and its god's techs. Each item has a tier (the lowest
  `tech_level` that researches it) and, for unit upgrades, the units it
  needs fielded (Labyrinth / Monstrous Rage: a myth unit; Sarissa / Aegis: a
  hoplite; Sun Ray / Burning Pitch: a toxotes). Each of its Armory, Market
  and Temple researches its first open tech of the plan, one at a time (a
  Temple researching does not train, as for a player). Priority: the
  Armory / Market building, the age-up, the techs in plan order.
- **The age plan** (`AIParams::classical_at`, `heroic_at`, `mythic_at`,
  `age_lead`): from `age_lead` s before an age's time it saves that age's
  cost (escrow item 2000 + age), before the Market and every non-urgent
  tech (while it saves for an age only the urgent techs are bought); the
  urgent techs of the age it is in still go first until two minutes past
  the age's time; it advances as soon as it can pay. The Heroic Age needs
  an Armory or a Market: the Armory goes up in time for it whatever else
  waits (`heroic_due`). While it saves for an age the walls and towers go
  on (fortify gets no "saving"), its villagers keep coming: up to
  `archaic_villagers` (20, Titan 23) in the Archaic Age, a dozen later,
  then out of what is left over; and `guard` soldiers (Hard / Titan 8, else
  4) train whatever it saves (an AI saving for its next age with one
  spearman at home was overrun and lost half its villagers). A tech or a
  building it saves for holds farms and storehouses back too (not houses),
  and villagers only past 30. When the next age lacks food 55 % of the
  hands go to food; from the Classical Age a fifth stay in the woods at
  least while wood is short (farms, houses, towers). Measured (aitechs /
  probes): before it, Hard and Titan AIs ate every bit of food with their
  armies and most never left the Archaic Age.
- **Economy for the plan** (Godot rules): villagers up to
  `villagers_rules` (18 / 26 / 42 / 50; the browser's `max_villagers`
  14 / 22 / 30 / 34 capped the income below a Heroic Age); from the
  Classical Age wild food farther than 18 tiles from its Town Center is
  left for farms (40 villagers fed a town out of a far berry bush and the
  next age waited minutes for food); a foundation of its own with nobody
  on it gets the nearest gatherer every 10 s (`finish_sites`: an Armory
  left a stake in the ground for good kept a whole AI out of the Heroic
  Age).
- **Escrow** (what makes it research on time without starving its army):
  the first item it cannot pay stays in the bank: its academies and Temple
  train only with that much left over (`escrow_allows`), and when that item
  lacks gold or wood more villagers go to it (gold share >= 0.3, wood >=
  0.4); whole for `escrow_max` s per item (`age_escrow_max` for an
  age-up), then only half of it for `escrow_rest` s (the army may spend the
  rest). Never with fewer than 8 soldiers or a foe within 26 tiles of its
  Town Center: the men first (without this rule a starved Hard AI held its
  last food for a tech and lost its army); an age on its plan and the
  Armory it needs are saved for whatever its army (only foes near stop
  it), the 400 food of the Classical Age from `classical_at - age_lead`.
  A tech it does not save for needs `tech_keep` left over.
- **Market**: a lot of 100 every `trade_every` s at its Market: gold short
  for what it saves for (an age-up, a tech): it sells the food / wood it has
  most to spare beyond that item (no gold mine within 80 tiles: beyond 150,
  the farms and the woods refill it, the Market is its only gold); food /
  wood short: it buys with the gold beyond the item + 150; else a food /
  wood glut beyond `trade_glut` with gold under half of it is sold, and a
  gold glut buys the food or wood under 150. Never sells 100 for under 45
  gold nor buys for over 220. Prices are the shared ones (a player sees the
  AI's trades move them).
- **Favor**: at its cap (190+ of 200) only one villager keeps praying (the
  rest gather what the techs and the next age need).
- `get_ai(owner).techs` = {armories, markets, started, holds, age_holds,
  sold, bought, gold_in, gold_out, classical_at, heroic_at, mythic_at
  (s, -1 not yet), last_tech, tech_level, max_age, saving_for (-1 none,
  1000 + building type, 2000 + age, else a TechId)}; `set_ai(owner,
  {armory_at (0: no research, no later age), max_age, market_age,
  tech_level, trade_glut})`.

```
godot --headless --path godot -s res://game/core/aitechs_check.gd [-- --only=ladder,market,determinism,duel --seed=1 --minutes=35]
```

`aitechs_check.gd` ("AITECHS PASS|FAIL <case>", `AITECHS_RESULT {json}`,
exit = failures, ~20 s): **ladder** (each difficulty in peace, the other AI
idle and no waves, 35 min, seed 1): Easy 2 techs (Copper Weapons 29.0 min,
Copper Armor 31.3), its Armory at 21.7, Classical only, no Market; Moderate
5 (first 19.5), Armory 15.2, Heroic and its Market at 30.5; Hard 12 (first
15.8), Armory 14.0, Market 16.7, Heroic 19.2; Titan 21 (first 10.5, median
3.6 min after reaching each tech's age), Armory 9.3, Market 11.2, Heroic
14.3, Mythic 24.5, all nine weapons / armor / shields tiers, 28 lots sold
(its gold mines run dry by 24 min); checked: Easy <= 3 techs, the first
after 18 min; Moderate more, Heroic, a Market; Hard more, its Market
sooner; Titan >= Hard, >= 18, every age before Hard (its age plan), median
delay <= 10 min, Mythic < 30 min; the
Armories Titan < Hard < Moderate < Easy. **market** (a Titan given 3000
food / wood and no gold at its Market sells 24 lots in 60 s, both prices
fall; given 4000 gold and no food / wood while saving for its age-up buys
12), **determinism** (two Titan runs, the same techs at the same times, the
same lots and resources), **duel** (Titan v Moderate, Hard v Easy decided
by player 1). `match_check.gd --only=difficulty` (the ladder of wins, 21
duels) still passes, every duel decided within 45 min. `techs_check.gd` `ai`: Moderate's Armory and Copper
Weapons, Easy's Armory later and at most two techs by 30 min. Capture:
`node scripts/godot-shoot.mjs --scene aifort --params
"aifort_ai=titan,hard&aifort_t=22&aifort_focus=town&aifort_owner=1"` (the
Titan's town at 22 min: Temple, Armory, Market inside its ring).

`set_godot_rules(on)` (default on, kept across `new_game`): off = the
browser's rules only (no AI god powers, no free villager, no fighting back
while moving, AI waves attack their target directly, no walls / gates /
towers, no repair, no Armory / Market, research or trade); `simcheck.gd`
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
- Done (techs sim): a general research queue, the Armory and the Market,
  all 47 Greek Armory / Market / Temple techs of Retold (35 with an effect
  here, 12 unavailable: their units do not exist), the Temple training the
  Cyclops, Centaur and Medusa those techs upgrade, Retold's Temple numbers
  and building armor, the Heroic Age's Armory / Market rule, market trade
  with moving, drifting prices, tribute, arrows that miss without
  Ballistics, an AI that builds an Armory and researches; see "Research,
  Armory, Market, Temple techs" (`techs_check.gd`). Not yet: the AI does
  not use the Market or the Temple's techs.
- Done (AI fortifications): the enemy AI builds towers, walls its town in
  with gates (every difficulty), upgrades, repairs and patches them, breaks
  enemy walls one piece per group, fears towers when weak; walled-off goals
  fail fast in the pathfinder; the stress scene is walled (`fort=0` off).
  See "Enemy AI: fortifications" (`aifort_check.gd`, scene `aifort`).
