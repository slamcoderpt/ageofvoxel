# Age of Voxel — Architecture

A browser RTS in the spirit of Age of Mythology, rendered as voxel art.
Stack: Vite + Three.js (WebGL), plain ES modules, DOM/CSS HUD. No framework.

```
npm install
npm run dev          # http://localhost:5173  (default scene: skirmish vs. AI)
npm run build        # production build into dist/
```

## Ownership: one directory per piece

Each piece is a class constructed with `(game)` and wired up in `src/core/Game.js`.
A piece may implement `update(dt)` (fixed-step sim, 30 Hz, deterministic),
`render(dt, alpha)` (once per displayed frame, visual only) and `resize(w, h)`.
Only edit files in your own directory; if you need something from another
piece, use its public API (documented at the top of its `index.js`) or talk to
its owner. Shared code lives in `src/core/`.

| Directory | Owns | Public API (see file headers) |
|---|---|---|
| `src/terrain/` | voxel heightfield mesh (chunked, per-vertex AO), ground palette, animated water shader, trees / gold mines / berry bushes (instanced, bucketed by map chunk), resource definitions | `terrain.spawnResource(type, tx, tz, {variant})`, `removeResource(e)`, `clearRect()` |
| `src/buildings/` | Greek building defs + voxel models (Town Center, House, Storehouse, Farm, Temple, Military Academy), placement ghost/validation, construction (`build` order), destruction, rendering | `buildings.spawn(type, owner, tx, tz, {built})`, `canPlace()`, `placement.begin/hover/confirm/cancel`, `destroy(b)`, `geometry(type)` |
| `src/units/` | unit defs, voxel part rigs (villager, hoplite, toxotes, hippikon, minotaur), procedural part animation (idle/walk/gather/build/worship/attack/die), instanced rendering per (type, part) | `units.spawn(type, owner, x, z)`, `portraitObject(type, owner)`, `heightOf(u)`; systems request an animation with `u.anim.want = 'gather'` |
| `src/lighting/` | renderer, sun + soft shadows (texel-snapped, follows the view), hemisphere + fill light, sky dome, distance haze, post (GTAO ambient occlusion, bloom, tone map, colour grade + vignette), graphics quality levels, per-frame render culling (see *Rendering performance*) | `lighting.sunDir`, `?post=high|low|off`, `?quality=high|medium|low`, `lighting.setQuality(q)`; objects opt out of AO with `obj.userData.noAO = true` (blended materials always do; opaque `noAO` objects need `renderOrder >= 2`, see *Rendering performance*); `obj.userData.depthGeometry` is drawn instead of `obj.geometry` in the shadow pass |
| `src/godpowers/` | favor-costed powers: Lightning Storm and Bolt (Zeus); bolt ribbons, pooled flash lights, sparks, scorch decals, storm ring/cloud | `godpowers.cast(owner, id, x, z)`, `canCast()`, `cooldownLeft()` |
| `src/combat/` | `attack` order, auto-targeting, melee/splash/ranged damage with class bonuses, arrows, death, hit flash/particles, health bars, selection rings, Town Center arrows, **enemy AI** (`EnemyAI.js`) | `combat.damage(t, amount, attacker)`, `kill(e)`, `findEnemyNear()`, `combat.ai.enabled` |
| `src/ui/` | HUD (resource bar, age, clock, god power buttons, portrait/stats/queue, command grid with hotkeys, rotated minimap), box/click/double-click select, right-click smart orders, control groups (Ctrl+1..9), idle villager (`.`), Town Center (`H`), placement and power targeting modes, performance meter (`F3`, `PerfMeter.js`; `?fps=1|0` forces it, hidden by default in capture scenes), settings card (gear button, clicked open: hotkeys and the Graphics quality row, remembered in localStorage `aov.quality`) | `ui.message(text)`, `ui.selection.set(ids)`, `ui.setVisible(bool)` |
| `src/economy/` | gathering state machine and drop-off, farms (row-by-row harvest, crop overlay), hunting (deer/boar herds, thrown spears, carcasses), fishing (shoals + fishing boats), stockpiles by drop-offs, worship → favor, population & cap, training queues, rally points, age advancement, the `economy` scene | `economy.train(b, type)`, `cancelTrain()`, `advanceAge(owner)`, `nearestResource()`, `nearestDropoff()`, `economy.wildlife.spawnHerd()`, `economy.fishing.spawnBoat()` |
| `src/core/` | game loop (`Game.js`), entity store, events, players, map generation (`GameMap.js`), A* pathfinding + steering (`pathfinding.js`, `Movement.js`), orders (`Commands.js`), input, RTS camera, picking, fog of war, particles (`fx/`), voxel model + mesher + materials (`voxel.js`), composable shader patches, portraits, match end (`Victory.js`), **scene registry** (`scenes/`) | see below |

### Core concepts

- **World units.** 1 tile = 1 world unit (`TILE`). Terrain voxels are 0.5 (`VOXEL`, 2x2 columns per tile).
  Buildings use 0.25 voxels (4 per tile), units 0.1, trees/props 0.18.
- **Entities** are plain objects in `game.entities` (`units()`, `buildings()`, `resources()`, `get(id)`).
  Common fields: `id, kind, type, owner, def, x, z, rot, hp, maxHp, dead`. Owners: 0 Gaia, 1 player, 2 AI.
  Put piece-private fields under a prefix (`e.combat_*`) to avoid collisions.
- **Orders.** `game.commands.order(unit, {type, ...})`. Handlers are registered per order type
  (`idle`, `move` in core; `gather`, `dropoff`, `worship` in economy; `build` in buildings; `attack` in combat).
  The owning piece drives units with that order from its `update()`. `commands.smart(units, x, z, target)`
  implements right-click; `commands.move()` does formation moves.
  When a building is finished its builders move on (buildings piece): one farms a new farm, the rest help on
  the nearest unfinished site of their owner within 12 tiles, else resume the gather/worship order they had
  when placement sent them (`order.resume`), else go idle. An `attack` order on a building that switches to
  nearby defenders keeps the building in `order.buildingId` and returns to it. Gatherers that cannot reach a
  node mark it (`r.econ_unreachT`) and `economy.nearestResource()` skips it for 90 s.
- **Movement.** `game.movement.moveTo(u, x, z, {goalRect, range})`, then poll `u.moving` / `u.arrived`.
  Grid A* (8-connected, line-of-sight smoothed) over `map.isWalkable()`; separation steering via a spatial hash
  (`game.movement.hash`, also used for neighbour queries); stuck detection re-paths.
- **Events** (`game.events.on/emit`): `entity:added|removed|died`, `unit:damaged`, `unit:trained`,
  `building:placed|completed`, `age:advanced`, `resources:changed`, `selection:changed`, `godpower:cast`,
  `game:over` ({ winner, loser, time }).
- **Match end** (`Victory.js`, last in the sim order). Enabled by the scene (`victory: true`, only the skirmish).
  A player who has owned a Town Center loses when none is left (foundations count); `game.victory.result`
  is then set, the game pauses and `game:over` fires. The UI shows a Victory / Defeat card (`.gameover` in
  `src/ui/hud.css`) whose Play Again button reloads the page with the same URL. `stats().over` reports it.
- **Determinism.** Sim randomness only from `game.rng` (seeded). Visual randomness uses `hash2/hash3` or
  seeded RNGs. Particles and god-power visuals are simulated in the fixed tick so paused captures match.
- **Voxel models.** `new VoxelModel().box(x,y,z,w,h,d,color)` (+ `cylinder`, `ellipsoid`, `roofX/Z`, `line`,
  `carve`, `merge`); colour `TEAM` is tinted per owner; `{glow: 0..1}` makes emissive voxels.
  `buildVoxelGeometry(model, {size, pivot, jitter})` emits only exposed faces with per-voxel colour jitter and
  baked per-vertex AO. `makeVoxelMaterial()` / `voxelMaterialFor(color)` add team tint, glow, hit flash and fog of war.
- **Fog of war.** `game.fog.isVisible/isExplored(x, z)`; call `applyFogOfWar(material)` on world materials.
- **Map edits.** `map.flattenTiles/paintTiles` call `map.onChange({cx0, cz0, cx1, cz1})` (column rect); the terrain
  piece marks the overlapping mesh chunks and only the resource instancing buckets over that rect for rebuild.

## Scene harness (deterministic screenshots)

URL params select a reproducible setup (registered in `src/core/scenes/index.js`):

| scene | what it shows |
|---|---|
| `skirmish` (default) | playable match: you vs. the AI, fog on, HUD on, live |
| `town` | developed Greek town, 28 villagers working, farms, temple, soldiers |
| `battle` | two mixed armies (hoplites, toxotes, hippikon, minotaur) clashing, arrows in flight |
| `godpower` | Zeus's Lightning Storm hitting an enemy army mid-cast |
| `coast` | seaside town, beach, cliffs, animated water |
| `economy` | busy economy: fenced block of farms round a granary, hunters on a deer herd, fishing boats, wood/gold/berries, building, training (used by the smoke test) |
| `hud` | town with the full HUD visible, a villager selected and control groups set (map revealed) |
| `stress` | scalability test: 6 players on a 256-tile map, each with a town, villagers gathering and an army fighting on the two fronts it shares with its neighbours; `?units=N` total units (default 2000), `?players=2..6`; live, fog on for player 1, profiler on (`src/core/scenes/stress.js`, used by `scripts/stress.mjs`) |

Scene fields: `preset, seed, mapSize, players, hud, revealAll, ai, live, victory, prof, fastForward, camera, setup, after`.

Params: `scene`, `seed`, `live=1` (keep simulating; scenes are paused by default), `hud=0|1`,
`post=high|low|off`, `quality=high|medium|low`, `fog=0|1`, `timescale=N`, `cam=x,z[,distance[,pitch[,yaw]]]`
(camera override for close-ups), `prof=1|0` (profiler, below), `mapsize=N` (map size in tiles),
and for the stress scene `units=N`, `players=2..6`.

**More than two players.** The engine's default is PLAYER (1), ENEMY (2) and GAIA (0). A scene can add
owners 3-6 with `game.addPlayer(id, {name, isAI})` (colours in `PLAYER_COLORS`) and an AI for each with
`game.combat.addAI(owner)` (all instances in `combat.ais`); `isEnemy()` already treats any two different
non-Gaia owners as enemies. Map starts for more than two players exist only in the `stress` preset
(`generateMap({players})`, a ring round the centre). Victory, fog of war and the HUD still assume one local
player (PLAYER).

**Profiler** (`src/core/Profiler.js`, `game.prof`). Off by default; `?prof=1` or a scene with `prof: true`
(the stress scene) turns it on, and `Game.tick()` / `Game.frame()` then take a timed path (otherwise one null
check). Per tick `game.prof.last` holds ms per system of `game.simOrder`, per EnemyAI instance, a few
sub-steps (projectiles, battle fx, unit spread) and count + ms of `findPath`, `nearestWalkable`,
`pickTarget`, `findEnemyNear`, `nearestResource`, `nearestDropoff`; per frame `game.prof.lastFrame` holds CPU
ms of each `renderOrder` piece's `render()` and of `lighting.draw()`. The F3 meter adds sim ms per tick, the
costliest system and the unit count while it is on.

Flow (`src/main.js`): generate map from the scene's preset+seed → `scene.setup(game)` → fast-forward N seconds
of sim → set camera → pause → render 4 frames → `window.__sceneReady = true`. Under automation
(`navigator.webdriver`) a paused scene then stops redrawing so the capture is exact. `window.__game` exposes the
game (`__game.stats()` for tests). To add a scene, call `registerScene(name, {...})`; helpers such as
`buildTown`, `spawnBlock`, `placeNear`, `assignGatherers` live in `src/core/scenes/helpers.js`.

## Scripts

Both expect a server already running (they build nothing):

```
npx vite --port 5173            # or: npm run build && npx vite preview --port 5173
node scripts/shoot.mjs --scene town --out shots/town.png [--port 5173] [--width 1920 --height 1080] \
     [--params "cam=64,64,20&post=low"] [--timeout 300]
node scripts/smoke.mjs [--port 5173] [--seconds 20] [--timescale 4] [--live 60]
node scripts/longrun.mjs [--port 5173] [--minutes 12]      # long AI-vs-idle sim, checks for runtime errors
node scripts/bench.mjs [--port 5173] [--scenes skirmish,town,battle] [--width 1920 --height 1080] [--dpr 1] \
     [--params "quality=medium"] [--json out.json]          # per-frame render cost, see below
node scripts/stress.mjs [--port 5173] [--units 250,500,1000,2000,3000,4000] [--ticks 600] [--warmup 150] \
     [--frames 4] [--params "players=6"] [--json out.json]  # sim / render scaling vs unit count
```

`stress.mjs` loads `?scene=stress&units=N&prof=1` per N (cross-origin isolated, so `performance.now()` has
~5 us resolution), pauses the loop and steps `game.tick()` directly: `--warmup` ticks, then `--ticks` recorded
ticks (total and per-system ms, per AI, pathfinding / search calls, entity counts, JS heap), 60 ticks
counting spatial-hash queries, and a few rendered frames with fog on and with the map revealed (CPU ms per
render piece and `lighting.draw()`, draw calls, triangles). It prints mean / p95 / max per system per N and
the growth exponent of each system. Results and analysis: `docs/stress-report.md`.

`shoot.mjs` launches headless Chromium with SwiftShader WebGL (`scripts/browser.mjs`; falls back to
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`), waits for `__sceneReady`, saves the PNG, prints console
errors and exits non-zero if the page threw or the canvas is blank. It seeds `Math.random` in the page (GTAO's
denoise noise is built from it), so two captures of the same build are pixel-identical and before/after
captures can be compared by pixel difference. Software rendering is slow: expect
~20–60 s per 1080p capture. `smoke.mjs` loads `?scene=economy&live=1`, lets the real loop
run for up to `--live` wall-clock seconds (it must advance game time), then, if the machine was too slow to get
there, steps the fixed-step sim in the page until `--seconds` of game time have been simulated. Resource gain,
unit movement and errors are checked over that simulated span, so the result does not depend on render speed.

## Rendering performance

Software GL makes frame rates meaningless in CI, so `scripts/bench.mjs` measures what does not depend on
the GPU: draw calls and triangles per frame (renderer.info reset once per frame, split into the shadow pass
and each composer pass, and per top-level scene group), `render()` calls, render targets and their pixel
count, CPU ms per frame and per piece, one scene-graph matrix update, and sim ms per tick per system. Use a
production build (`npm run build && npx vite preview`).

What keeps a frame cheap (all invisible at the default `quality=high`):

- **One scene render per frame.** The main pass also writes GTAO's g-buffer (below); GTAO used to draw the
  whole scene a second time with a normal material (on a Mac, ~260 draw calls and 1.4M triangles a frame).
- **One shadow map per frame.** `shadowMap.autoUpdate` is off; `Lighting.draw()` flags it once, so the scene
  render draws it.
- **Shadow caster culling** (`Lighting._cullForFrame`). A caster is left out of the shadow pass when the
  volume its bounding sphere sweeps along the sunlight, down to the lowest ground, misses the view frustum.
  Conservative, so no visible shadow is lost. Instanced props are bucketed per map chunk for this.
- **Depth geometries.** Objects with `userData.depthGeometry` are drawn with it in the shadow pass: the same
  voxel surface meshed greedily without colour or AO (`buildGreedyGeometry(model, { shape: true })`), about
  30% fewer triangles for trees.
- **No downward faces on props** (`noDown` in both meshers): the RTS camera is always above them, so those
  are back faces; the shadow geometries keep them.
- **Empty instanced meshes are hidden** for the frame (units keep a mesh per type and body part; three still
  bound each one in every pass).
- **World matrices once per frame** (`scene.matrixWorldAutoUpdate` off, updated in `draw()`); static meshes
  (terrain chunks, resource buckets, ground details, building props) have `matrixAutoUpdate = false`.
- **Building props are instanced** per (kind, owner) (`src/buildings/props.js`); `ATM_STATIC_INST` keeps the
  lighting patches from treating them as trees.
- **Post pipeline** (`PostFX.js`): only the scene pass renders into a 4x MSAA half-float target; GTAO only
  computes its AO map, one pass applies it into a single-sample target, bloom adds onto that, and one final
  pass does tone mapping, sRGB and the grade straight to the canvas (was: copy + blend, output, grade).
- **AO g-buffer from the scene pass** (`GBuffer.js`). With AO on, the scene target has two colour
  attachments (colour + view-space normal, packed like `MeshNormalMaterial`) and a depth texture;
  `GTAOPass.setGBuffer(depth, normal)` reads them. `Lighting._cullForFrame` hands every visible object to
  `post.gbuffer.prepare()` before the frame is drawn. Opaque materials (except on `noAO` objects) get a
  patch that writes the vertex normal (not the bent shading normal; a screen-derivative face normal for
  unlit built-ins, a camera-facing one for the sky); WebGL drops any draw that leaves an active draw buffer
  unwritten. Blended materials and opaque `noAO` objects are *late* draws: the opaque `noAO` ones (unit
  outline hulls, god power debris) have `renderOrder = 2`, so they come after the rest of the opaque scene
  (same image: they are depth-tested; 4 pixels of a 1080p battle frame change on ties). The first late draw
  copies the multisampled depth into the depth texture and switches the normal attachment off, so outlines,
  water, contact shadows, particles and effects leave the AO input alone, as with the old separate pass;
  with no late draw the depth is copied after the pass. With AO off (`quality=low`, `post=low`) the scene
  target is colour-only (no normal output, no depth copy), as before.
  Remaining difference from the old pass: at silhouettes and voxel steps the MSAA resolve averages the 4
  samples' normals and the depth is one sample's, where the old pass sampled pixel centres without
  multisampling. AO moves by about GTAO's own noise: mean absolute difference 0.31-0.57 of 255 per scene
  (re-seeding GTAO's denoise noise alone gives ~0.7) with a slight brightening bias (+0.06 to +0.11), and no
  visible change in 4x crops of building bases, tree gaps or unit contact.
- **Pixel ratio** is capped at 1.5 with post-processing (2 without).

Quality levels (`?quality=`, or the Graphics row of the gear card; `lighting.setQuality()` switches live):

| level | pixel ratio cap | GTAO | shadow map |
|---|---|---|---|
| `high` (default, the reference look) | 1.5 | full resolution | 4096 |
| `medium` | 1 | half resolution (softer crevice AO) | 2048 |
| `low` | 1 | off | 2048 |

Per frame at 1920x1080, `quality=high` (`scripts/bench.mjs`), before and after the g-buffer change:

| scene | draw calls | triangles | scene renders |
|---|---|---|---|
| skirmish | 744 -> 484 | 2.67M -> 1.89M | 2 -> 1 |
| town | 1167 -> 760 | 5.78M -> 4.04M | 2 -> 1 |
| battle | 1026 -> 719 | 6.18M -> 4.58M | 2 -> 1 |

Mean absolute pixel difference against the old separate normal pass (seeded captures, 0-255): town 0.57,
battle 0.48, godpower 0.31, coast 0.47, economy 0.48, hud 0.44.

`medium` drops the same draws (its half-resolution AO now reads the full-resolution g-buffer); `low` is
unchanged (481 / 757 / 716 draws, one scene render, same targets).

`?post=low|off` still overrides the post chain (and uses a 2048 shadow map).

## Known limits / next steps per piece

- Terrain: no smoothing between ground types; trees are ~0.5-0.8k triangles each (~0.3-0.7k in the
  shadow pass) and, with the grass tufts, still the biggest triangle cost; a distance LOD would change
  the look.
- Buildings: no rotation, no wall/tower, construction shown by vertical scale only.
- Units: no formations beyond grid moves, no corpses blood/decals, cavalry rig is basic.
- Lighting: no time of day; sky rarely visible from the RTS camera.
- God powers: one god; no ages gating powers.
- Combat: no attack-move command, simple AI (one attack wave pattern; saves food to reach the Classical Age
  once it has 16 villagers; never casts god powers).
- UI: no tech tree, no garrison, no tooltips for units in the world; god powers have no keyboard hotkeys.
- Match: the only end condition is losing every Town Center; Play Again reloads the page.
- Economy: fishing boats are economy-owned (not selectable/trainable units yet; no dock building); no market/tribute, no techs.
