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
| `src/lighting/` | renderer, sun + soft shadows (texel-snapped, follows the view), hemisphere + fill light, sky dome, distance haze, post (GTAO ambient occlusion, bloom, ACES tone map, colour grade + vignette) | `lighting.sunDir`, `?post=high|low|off`; objects opt out of AO with `obj.userData.noAO = true` |
| `src/godpowers/` | favor-costed powers: Lightning Storm and Bolt (Zeus); bolt ribbons, pooled flash lights, sparks, scorch decals, storm ring/cloud | `godpowers.cast(owner, id, x, z)`, `canCast()`, `cooldownLeft()` |
| `src/combat/` | `attack` order, auto-targeting, melee/splash/ranged damage with class bonuses, arrows, death, hit flash/particles, health bars, selection rings, Town Center arrows, **enemy AI** (`EnemyAI.js`) | `combat.damage(t, amount, attacker)`, `kill(e)`, `findEnemyNear()`, `combat.ai.enabled` |
| `src/ui/` | HUD (resource bar, age, clock, god power buttons, portrait/stats/queue, command grid with hotkeys, rotated minimap), box/click/double-click select, right-click smart orders, control groups (Ctrl+1..9), idle villager (`.`), Town Center (`H`), placement and power targeting modes | `ui.message(text)`, `ui.selection.set(ids)`, `ui.setVisible(bool)` |
| `src/economy/` | gathering state machine and drop-off, farms (row-by-row harvest, crop overlay), hunting (deer/boar herds, thrown spears, carcasses), fishing (shoals + fishing boats), stockpiles by drop-offs, worship → favor, population & cap, training queues, rally points, age advancement, the `economy` scene | `economy.train(b, type)`, `cancelTrain()`, `advanceAge(owner)`, `nearestResource()`, `nearestDropoff()`, `economy.wildlife.spawnHerd()`, `economy.fishing.spawnBoat()` |
| `src/core/` | game loop (`Game.js`), entity store, events, players, map generation (`GameMap.js`), A* pathfinding + steering (`pathfinding.js`, `Movement.js`), orders (`Commands.js`), input, RTS camera, picking, fog of war, particles (`fx/`), voxel model + mesher + materials (`voxel.js`), composable shader patches, portraits, **scene registry** (`scenes/`) | see below |

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
- **Movement.** `game.movement.moveTo(u, x, z, {goalRect, range})`, then poll `u.moving` / `u.arrived`.
  Grid A* (8-connected, line-of-sight smoothed) over `map.isWalkable()`; separation steering via a spatial hash
  (`game.movement.hash`, also used for neighbour queries); stuck detection re-paths.
- **Events** (`game.events.on/emit`): `entity:added|removed|died`, `unit:damaged`, `unit:trained`,
  `building:placed|completed`, `age:advanced`, `resources:changed`, `selection:changed`, `godpower:cast`.
- **Determinism.** Sim randomness only from `game.rng` (seeded). Visual randomness uses `hash2/hash3` or
  seeded RNGs. Particles and god-power visuals are simulated in the fixed tick so paused captures match.
- **Voxel models.** `new VoxelModel().box(x,y,z,w,h,d,color)` (+ `cylinder`, `ellipsoid`, `roofX/Z`, `line`,
  `carve`, `merge`); colour `TEAM` is tinted per owner; `{glow: 0..1}` makes emissive voxels.
  `buildVoxelGeometry(model, {size, pivot, jitter})` emits only exposed faces with per-voxel colour jitter and
  baked per-vertex AO. `makeVoxelMaterial()` / `voxelMaterialFor(color)` add team tint, glow, hit flash and fog of war.
- **Fog of war.** `game.fog.isVisible/isExplored(x, z)`; call `applyFogOfWar(material)` on world materials.

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
| `hud` | town with the full HUD visible and a villager selected, fog on |

Params: `scene`, `seed`, `live=1` (keep simulating; scenes are paused by default), `hud=0|1`,
`post=high|low|off`, `fog=0|1`, `timescale=N`, `cam=x,z[,distance[,pitch[,yaw]]]` (camera override for close-ups).

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
node scripts/smoke.mjs [--port 5173] [--seconds 20] [--timescale 4]
node scripts/longrun.mjs [--port 5173] [--minutes 12]      # long AI-vs-idle sim, checks for runtime errors
```

`shoot.mjs` launches headless Chromium with SwiftShader WebGL (`scripts/browser.mjs`; falls back to
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`), waits for `__sceneReady`, saves the PNG, prints console
errors and exits non-zero if the page threw or the canvas is blank. Software rendering is slow: expect
~20–60 s per 1080p capture. `smoke.mjs` loads `?scene=economy&live=1`, runs ~20 s of game time and checks that
resources rose, units moved and nothing threw.

## Known limits / next steps per piece

- Terrain: no smoothing between ground types, no grass/detail props; trees are ~1.6k triangles each (the
  biggest GPU cost; consider LOD or merging same-colour faces).
- Buildings: no rotation, no wall/tower, construction shown by vertical scale only.
- Units: no formations beyond grid moves, no corpses blood/decals, cavalry rig is basic.
- Lighting: no time of day; sky rarely visible from the RTS camera.
- God powers: one god; no ages gating powers.
- Combat: no attack-move command, simple AI (one attack wave pattern).
- UI: no tech tree, no garrison, no tooltips for units in the world.
- Economy: fishing boats are economy-owned (not selectable/trainable units yet; no dock building); no market/tribute, no techs.
