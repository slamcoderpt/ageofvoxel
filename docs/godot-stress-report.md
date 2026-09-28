# Stress test, Godot port: 6 teams, 2000 units

Companion to `docs/stress-report.md` (the browser build). Same scene (`stress`: seed 23, 256-tile map,
6 players, towns, gathering villagers, two battle fronts, the enemy AI on), same machine (the shared
cloud container: Xeon 2.1 GHz, 4 threads, no GPU), same protocols.

**Short answer: both bars are beaten.**

- **Sim:** 0.95–1.25 ms/tick mean and 1.3–1.7 ms p95 at 2000 units. The bar is ≤ 8 and ≤ 16 ms, and the
  browser takes 15.0 / 26.5 ms. The browser's growth from 2000 to 4000 units comes from unit density, and
  the Godot sim follows the same curve.
- **Render:** the stress frame at 1280x720 with the map revealed takes **3.6–5.8 s** in Godot on lavapipe.
  The browser takes **30.6–41.9 s** on SwiftShader on the same machine, in the same hour. That makes Godot
  **7–8x** faster, and it draws 6.6 M primitives where the browser draws 51 M triangles.

## How to reproduce

```
# sim (headless, the stress.mjs protocol: 150 warm-up + 600 recorded ticks per N)
node scripts/godot-stress.mjs --units 250,500,1000,2000,3000,4000

# render, Godot (xvfb + lavapipe; sim paused like bench.mjs, vsync off)
node scripts/godot-renderbench.mjs --params "units=2000&fog=0" --width 1280 --height 720 --frames 8 --warmup 3

# render, browser (the bar; needs npm run build && npx vite preview --port 4173)
node scripts/bench.mjs --scenes stress --params "units=2000&fog=0" --width 1280 --height 720
```

`fog=0` reveals the map, so every unit is eligible to draw. That is the heavy case: with fog on, the
browser only draws what player 1 sees.

## The machine is shared: read wall times as ranges

Other agents build and render on the same 4 threads during these runs (load average 6–11). Wall times
therefore move by ±40 % from one run to the next. For example, the browser frame took 30.6 s at 14:10
and 41.9 s at 15:35, with identical work. So:

- every comparison below pairs runs from the same hour;
- the Godot bench also reports the **process CPU time per frame**, summed over all threads (lavapipe
  rasterises on worker threads). It moves much less with the load, and it is the number used to
  compare Godot with Godot.

## Results: sim ms per tick

The C++ GDExtension is `template_debug` (-O2). It is bit-exact with the browser (`check-sim.mjs`:
the stress scene over 600 ticks, and the battle, skirmish and god-power scenes, all ok).

| N | 250 | 500 | 1000 | 2000 | 3000 | 4000 | k (ms ~ N^k) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Godot C++ sim, mean** | 0.09 | 0.17 | 0.38 | **0.95** | 1.50 | 2.61 | 1.20 |
| **Godot C++ sim, p95** | 0.19 | 0.25 | 0.53 | **1.32** | 2.65 | 4.02 | 1.09 |
| Godot, earlier run the same afternoon (mean / p95) | 0.13 / 0.23 | 0.19 / 0.28 | 0.47 / 0.60 | 1.17 / 1.54 | 1.98 / 3.50 | 2.96 / 4.50 | 1.13 |
| browser JS sim, mean (`stress-report.md`) | 2.4 | 3.3 | 7.6 | **15.0** | 25.2 | 40.7 | 1.02 |
| browser JS sim, p95 | 6.3 | 6.9 | 15.1 | **26.5** | 44.5 | 67.7 | 0.86 |
| target | | | | ≤ 8 / ≤ 16 | | | |

At 2000 units, the mean per system is movement 0.32, units 0.29 (spread 0.28), combat 0.23 (all six AIs
0.01), economy 0.08 and fog 0.02 ms/tick.

- `findPath` runs 183 calls/tick (172 of them from combat) for 0.12 ms/tick. These are exactly the
  browser's call counts, because the two sims run the same game.
- `nearestResource` takes 1.6 µs per call. It uses a grid index; the browser scans all resources in
  190–290 µs.

**Growth to 4000 units.** Doubling from 2000 to 4000 units costs 2.7x in Godot (0.95 → 2.61 ms). It costs
the same in the browser (15.0 → 40.7 ms, also 2.7x). The work itself grows that fast:

- On the fixed 256 map the armies get denser.
- The spatial hash visits 16.7 neighbours per query at 2000 units and 23.1 at 4000, the same counts as
  the browser.
- So neighbour visits per tick grow from 47 k to 128 k (2.7x).
- Movement and spreading must visit neighbours in the JS order to stay bit-exact. Their per-visit cost
  is now just two loads and a compare (see "Sim changes").
- The growth exponent over 250 → 4000 looks higher than the browser's (1.2 against 1.0). That is only
  because the Godot sim has almost no fixed cost per tick. At 250 units it runs 0.09 ms against 2.4.
- The absolute cost at 4000 units (2.6 ms mean, 4.0 p95) is a third of the 8 ms budget.

The browser report's recommended scalers already exist in the C++ sim. They are opt-in, because they are
not bit-exact with the browser:

- `AovSim.set_group_paths(n)`: formation moves share one Dijkstra field (a flow field).
- `AovSim.set_repath_budget(n)`: staggered re-pathing.
- The exact A* path cache, per (start tile, goal tile, rect) while walkability is unchanged.
- Typed struct-of-arrays entity columns, a flat counting-sort spatial hash, and the grid index for
  `nearestResource`.

## Results: render, stress scene at 1280x720, sim paused

For the browser, `sw-gpu ms` is the wall time until SwiftShader has finished the frame; this is the bar.
For Godot, the number is the wall time frame to frame with vsync off.

**Map revealed (`fog=0`), the stress camera (distance 52, pitch 52):**

| | wall ms / frame | CPU ms / frame | primitives (main + shadow) | draw calls |
|---|---:|---:|---:|---:|
| **browser, SwiftShader** (14:10 / 15:35) | **30 616 / 41 865** | – | 51.17 M (+17.3 M shadow counted inside) | 991 |
| Godot before this work (14:16) | 6 781 | – | 33.37 M (11.35 + 22.00) | 2684 |
| Godot, all changes but unit LOD (`--unit_lod=0`) | 5 312 | 10 025 | 8.23 M (5.18 + 3.02) | 3561 |
| **Godot, this work** (two runs, 15:10 / 15:25) | **3 643 / 5 821** | **8 042 / 7 971** | **6.60 M (3.55 + 3.02)** | 3561 |

For the "before" row, the per-piece breakdown gave units 2.86 M main + 11.46 M shadow, terrain
(chunks, ground details, trees) 7.8 M + 7.7 M, economy 0.4 M + 1.6 M, buildings 0.27 M + 1.19 M.

**Fog on (the default scene), same camera:**

| | wall ms / frame | primitives |
|---|---:|---:|
| browser | 15 336 | 15.38 M |
| Godot, this work | 3 040 – 3 762 | 5.55 M |

**The whole map on screen** (`cam=128,128,230`, beyond the game's zoom limit of 110; 1748 units on
screen):

| | wall ms / frame | primitives |
|---|---:|---:|
| browser | 116 855 | 76.71 M |
| Godot, before the ground-detail range | 26 290 | 39.59 M |
| Godot, this work | 13 718 | 24.35 M |

**The frame itself.** The Godot capture matches the browser's composition, models, palette and camera
(`reference/browser/stress.png` against `node scripts/godot-shoot.mjs --scene stress`).

**Where the rest of a Godot frame goes.** These numbers come from the render bench with one feature
turned off, measured midway through this work (CPU 9.1 s/frame at that point):

- sun shadows (PCSS, 4 splits, 4096 atlas): 4.2 s (46 %);
- 4x MSAA: 1.9 s;
- SSAO: 0.5 s.

These belong to the lighting piece's `--quality` levels; `--quality=medium` halves the frame. They are
left at `high`, the same look the browser has.

## What changed (this round)

Render paths of the stress scene, all instanced and with no per-unit nodes or script calls:

1. **Unit shadow casters are boxes.** The voxel part meshes no longer cast shadows. Instead, a
   12-triangle box per part (`game/units/unit_shadow.gdshader`) is drawn into the shadow map only. It
   uses the same MultiMesh buffers, uploaded twice. Unit shadow primitives drop from 11.46 M to 0.17 M.
2. **Unit LOD.** When a unit's 0.07 voxels drop below `--unit_lod` px on screen (default 2.5, about 33
   world units from the camera at 720p), it is drawn with its coarse voxel twin:
   - The twin is built once in C++ by `AovUnitView.lod_mesh` (`native/src/unit_lod.cpp`). It rebuilds
     the voxels from the faces, fills the interior and merges 2x2x2 voxels per cell, as a box spanning
     its solid voxels. Thin blades keep their width.
   - It carries the mean colour, team mask and glow, in the same vertex format and shaders.
   - It has 2–4x fewer triangles.
   - `AovUnitView.update()` sorts units into `parts` or `parts_lod` by camera distance.
   - Zoomed in, every unit is full detail. Mythic and hero rigs (voxel ≥ 0.1) are never coarsened.
3. **Trees cast shadows from a merged coarse twin.** `VoxelModels.coarse(mesh, 2, true)` turns the
   `_shape` mesh into whole 2x2x2 cells with greedy-merged faces (tree 630 → 256 triangles).
4. **Tight culling buckets.** Resource buckets shrink from 64 to 16 tiles, as in the JS. Ground details
   are batched per terrain chunk instead of per 4x4 chunks. Details are culled past 150 world units
   (`visibility_range_end`), where a tuft is a pixel or two.
5. **Economy props are frustum-culled in C++.** `AovEconView.update(…, frustum)` drops props off screen,
   with a margin for the shadows they cast into view. Their MultiMeshes span the whole map, so before
   this every crop of all six towns went into every shadow cascade (1.6 M → 0.15 M shadow primitives).

Sim hot paths (bit-exact):

6. **A position mirror in the spatial hash.** `SpatialHash` keeps x, z and radius per item, in cell
   order, so the separation loops of movement and `units.spread` read contiguous memory instead of three
   scattered columns per neighbour.
   - It is kept exact, not snapshotted: `sync()` runs at spread start, and `moved()` runs whenever a
     hashed row moves.
   - The loops reject far neighbours first. The JS test then runs unchanged on the live arrays.
   - Result: movement + units went from 2.11 ms/tick at 4000 units (one run before) to 1.84 and 1.75
     (two runs after), on the noisy machine.

Tools:

7. **The render bench.** `game/perf/perf.gd` (`--renderbench=N`) and `scripts/godot-renderbench.mjs`
   report:
   - wall, CPU and GPU ms per frame;
   - draw calls, primitives and objects for the main and shadow passes;
   - units posed and units at LOD.

   Two experiment switches exist: `--rb_hide=piece[/Child]` and `--rb_off=shadow,msaa,ao,post`. The
   script runs Godot in its own process group, so a script error or a timeout cannot leave an orphan
   engine running.

## Not done yet (next rounds)

- Town props (`game/buildings/town_props.gd`): one map-wide MultiMesh per prop kind. They still put
  1.0 M primitives into every shadow cascade; per-town batches or C++ culling would remove most of that.
- Tree LOD for zoomed-out views: `visibility_range` twins. A colour-quantised greedy merge is needed
  first, because the exported meshes are already merged, and a plain coarse twin of a visible tree has
  more triangles than the original.
- Per-cascade culling of unit shadow boxes (the unit MultiMeshes carry a map-wide AABB).
- The web export (Compatibility renderer): its numbers are not measured here.
