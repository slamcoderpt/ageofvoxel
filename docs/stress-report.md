# Stress test: can the browser carry 6 teams and ~2000 units?

**Short answer: yes, with work on four specific hot spots. None of them needs a native engine.**
Cost grows linearly with unit count, with no quadratic blow-up. Three systems dominate the bill, and all
three have well-known fixes that work in JavaScript. A C#/C++ port would gain a constant factor of about
1.5–3×, but these fixes give a larger gain for a fraction of the effort, and the port would give up the
web's distribution, which is the game's biggest advantage.

## Setup

- Scene: `?scene=stress&units=N&prof=1` (`src/core/scenes/stress.js`).
  - 6 players on a 256-tile map, each with a town, gathering villagers and armies fighting on two fronts.
  - Fog of war is on for player 1.
- Runner: `node scripts/stress.mjs`.
  - Steps `game.tick()` directly: 150 warm-up ticks, then 600 recorded ticks (20 s of game time) per N.
  - Also renders a few frames with fog on and with the map revealed.
- Machine: cloud container with an Intel Xeon at 2.1 GHz (4 threads), headless Chromium, SwiftShader WebGL.
  - This CPU is about 2–3× slower single-threaded than a recent laptop (Apple M-series, recent Intel/AMD).
  - **Read sim times below as a pessimistic upper bound.**
  - Render CPU is inflated further, because SwiftShader rasterises on the CPU. There, only the per-piece
    `render()` times (JS work) are meaningful, not `lighting.draw`.
- Raw output: `node scripts/stress.mjs --json out.json` (full per-tick samples).

Budget: the sim runs at 30 ticks/s. For 60 FPS, the main thread has 16.7 ms per frame for everything.

- A tick of X ms costs X × 30 / 1000 of the main thread.
- At 8 ms/tick, that is a quarter of the frame budget.
- **Target: mean ≤ 8 ms/tick, p95 ≤ 16 ms on a normal laptop.**

## Results: sim ms per tick (mean)

| system | 250 | 500 | 1000 | 2000 | 3000 | 4000 | growth k (ms ~ N^k) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **total (mean)** | 2.4 | 3.3 | 7.6 | **15.0** | 25.2 | 40.7 | 1.02 |
| **total (p95)** | 6.3 | 6.9 | 15.1 | **26.5** | 44.5 | 67.7 | 0.86 |
| movement (path following, separation) | 0.6 | 0.7 | 1.9 | 4.3 | 6.8 | 13.2 | 1.13 |
| units (of which `_spread`) | 0.5 (0.3) | 0.7 (0.5) | 2.0 (1.6) | 4.4 (3.8) | 8.1 (7.0) | 13.0 (11.5) | 1.20 |
| combat (targeting, attacks, projectiles, fx) | 1.0 | 1.3 | 2.8 | 4.4 | 6.4 | 7.9 | 0.74 |
| economy (gathering) | 0.2 | 0.4 | 0.6 | 1.4 | 3.4 | 6.0 | 1.27 |
| AI, all 6 players | 0.04 | 0.02 | 0.08 | 0.15 | 0.23 | 0.27 | 0.65 |
| fog of war | 0.07 | 0.05 | 0.08 | 0.12 | 0.15 | 0.22 | 0.42 |
| buildings, god powers, victory, fx | < 0.3 in total at every N | | | | | | |

Pathfinding and searches, counted inside the systems above:

| call | 1000 | 2000 | 4000 |
|---|---|---|---|
| `findPath` calls/tick | 83 | 183 | 376 |
| `findPath` ms/tick | 0.8 | 1.8 (p95 9.2) | 6.7 (p95 23.9) |
| `nearestResource` ms/tick | 0.03 | 0.24 | 0.53 (≈190–290 µs per call, a linear scan) |
| spatial hash neighbours visited per query | 11 | 17 | 23 |

- About 90 % of `findPath` calls come from combat (units re-pathing to targets): 349 calls/tick at 4000 units.
- The economy's calls are fewer but longer: 26 calls/tick, 4.5 ms at 4000.

Render, JS side only (CPU ms per frame in each piece's `render()`):

| N | units, fog on | units, map revealed | triangles, map revealed |
|---|---:|---:|---:|
| 1000 | 3.4 | 8.4 | 28 M |
| 2000 | 6.4 | **31.8** | **51 M** |
| 4000 | 22.4 | 45.2 | 98 M |

Every other render piece (terrain, buildings, economy, combat fx, UI) stays under 2.2 ms at every N.

## What this says

1. **No wall, just a slope.** Total sim cost grows linearly (k ≈ 1.0).
   - At 1000 units it is 7.6 ms/tick, within budget even on this slow CPU.
   - At 2000 units it is 15 ms mean and 26.5 ms p95. That is about 2× over budget here, or roughly at budget
     on a laptop CPU that is 2–3× faster.
2. **Four places pay the bill at 2000 units**, together 80 % of it: unit spreading, movement, combat
   re-pathing and the resource search.
   - **`units._spread`**: 3.8 ms. Local avoidance for standing units. Every standing unit queries the
     spatial hash every tick through a closure, and neighbours per query grow with density (17 → 23).
   - **`movement`**: 4.3 ms. Path following plus overlap resolution, with the same per-unit hash queries.
   - **Combat re-pathing**: 172 `findPath` calls/tick. Every unit that chases a target runs its own A*.
   - **`nearestResource`**: a linear scan over all resources, 0.2–0.3 ms per call. It drives economy's
     p95 spikes (8.8 ms at 2000).
3. **AI and fog of war are negligible.** Six AIs together cost 0.15 ms/tick at 2000 units, and fog costs
   0.12 ms. More players cost almost nothing on their own; what costs is the units they field.
4. **Render: GPU triangles are the real risk, not JS.**
   - Every unit is drawn at full voxel detail wherever it is. With the map revealed, 2000 units come to
     51 M triangles per frame, and the shadow pass repeats part of that.
   - That count is what would limit a Mac GPU, which is already GPU-bound at 1.9 M triangles in skirmish.
   - The units' JS render cost (a matrix per body part per unit per frame) also climbs to 32 ms when all
     2000 are on screen. There is no frustum culling yet, only fog culling.

## What a native port would and would not buy

- **It would buy:** C#/C++ runs the same algorithms roughly 1.5–3× faster, with no GC pauses and real
  threads. A data-oriented design (ECS, DOTS) adds more on top.
- **It would not buy:** the fixes below. Without them, a native build still pays O(units × neighbours) for
  spreading, one A* per chasing unit and a linear resource search. It would just pay them faster.
- **What it costs:** rewriting about 17 k lines of game code. Three.js rendering, the HUD and every tool would have to be
  redone in Unity, Godot or Unreal. We would lose "open a link and play", which matters most for a new RTS
  looking for players and multiplayer testers.
- **Multiplayer:** it favours neither. The sim is already a fixed 30 Hz, seeded, deterministic loop. That is
  exactly what lockstep needs, and it works over WebRTC/WebSockets from the browser.
  - One caveat applies to either platform: floating-point determinism across machines must be checked.
    Browsers are strict IEEE-754, which helps.

## Recommendation: stay in the browser, in this order

| # | change | expected effect at 2000 units |
|---|---|---|
| 1 | **Unit render LOD and culling.** Frustum-cull units. Update far or off-screen units' body-part matrices at a lower rate. Draw distant units as a single merged low-poly mesh, and drop them from the shadow pass beyond mid-range. | Triangles 51 M → ~5–10 M; units render JS 32 → ~5 ms |
| 2 | **Flow fields / shared paths for combat.** Units heading to the same target area share one path or flow field. Cache paths per (start cell, goal cell) for a few ticks. Stagger re-pathing so each unit re-paths at most every N ticks. | `findPath` 172 → ~20 calls/tick; movement p95 spikes gone |
| 3 | **Separation on typed arrays.** Store positions and radii in `Float32Array`s, iterate the hash cells inline instead of through a closure, and only spread units whose neighbourhood changed or run it every other tick. | `_spread` + movement 8 → ~3 ms |
| 4 | **Spatial index for resources.** A per-type grid bucket for `nearestResource`. | economy p95 spikes gone |
| 5 | **Sim in a Web Worker.** It needs state snapshots by message, or a `SharedArrayBuffer`, which requires serving the page with COOP/COEP headers, as `scripts/stress.mjs` already does. The main thread then only renders, and the whole sim budget (33 ms/tick at 30 Hz) is free for the sim. | frees the main thread; also the natural shape for lockstep multiplayer |
| 6 | (only if 1–5 fall short) The hot loops (movement, separation, pathfinding) in Rust/C++ → **WASM**. It keeps the browser and gives most of the native speed for those loops. | ~1.5–2× on the moved loops |
| 7 | (renderer) **WebGPU** via `three/webgpu`, for compute-driven culling and animation of units. | GPU-side unit animation |

- Steps 1–4 are local changes, each measurable with `scripts/stress.mjs`.
- On a normal laptop they should bring 2000 units to about 5–8 ms/tick of sim and a GPU load close to
  today's skirmish.
- That covers the planned scale. A 6-player game at a realistic ~150–300 units per player is 900–1800
  units, and Age of Mythology caps each player at 300 population, with most units costing 1–5 population each.

**Revisit a native engine only if**, after steps 1–5, 2000 units still cost more than 8 ms/tick mean or
16 ms p95 on a mid-range laptop. Re-run the same command on that laptop:

```
npm run build && npx vite preview --port 4173 &
node scripts/stress.mjs --port 4173 --units 1000,2000,3000
```

Try the scene live with `?scene=stress&units=2000`. Press F3 to show sim ms per tick, the costliest
system and the unit count.
