# Age of Voxel

A browser real-time strategy game in the spirit of *Age of Mythology*, drawn as voxel
art. You play the Greeks under Zeus against a computer opponent: gather food, wood
and gold, earn favor at the temple, raise a town, advance through the ages, train
hoplites, archers, cavalry and minotaurs, call down Zeus's lightning, and burn the
enemy's Town Center before they burn yours.

Built with Vite and Three.js (WebGL), plain ES modules and a DOM/CSS HUD. No framework.

## Screenshots

Screenshots are not committed (`shots/` is gitignored). Capture your own with the
deterministic scene harness:

```
npm run build && npx vite preview --port 5173      # in one terminal
node scripts/shoot.mjs --scene town --port 5173 --out shots/town.png
```

Any scene below can be captured the same way (`--scene hud`, `--scene battle`, ...).
Captures run on software WebGL, so allow a minute or two per 1080p frame.

## Install and run

Needs Node 20.19+ or 22.12+ (Vite 8).

```
npm install
npm run dev          # http://localhost:5173 - the default scene is a skirmish against the AI
npm run build        # production build into dist/
npm run preview      # serve dist/
```

## Playing

You start with a Town Center and five villagers; the AI starts the same way on the
far side of the map. **You win when every enemy Town Center is destroyed and lose when
yours are.** A Victory or Defeat card then appears with a Play Again button.

A typical opening: put villagers on berries, trees and the gold mine, train more
villagers at the Town Center, build houses for population, a farm or two once the
berries run out, a temple (villagers worshipping there generate favor), and a
Military Academy. Advance to the Classical Age at the Town Center to unlock minotaurs.

### Camera

| Input | Action |
|---|---|
| Arrow keys | Pan |
| Mouse at the screen edge | Pan (edge scroll) |
| Middle-drag | Pan |
| Mouse wheel | Zoom in / out |
| Left-click or drag on the minimap | Jump the camera there |
| `H` | Select and centre on your Town Center |

### Selection

| Input | Action |
|---|---|
| Left-click | Select a unit, building or resource |
| Left-drag | Box-select your units (soldiers are preferred when the box also holds villagers) |
| Shift + click | Add a unit to / remove it from the selection |
| Shift + drag | Add the boxed units to the selection |
| Double-click a unit | Select every unit of that type on screen |
| Click a portrait in the selection panel | Select just that one |
| `.` or the villager button by the minimap | Cycle through idle villagers |
| Crossed-swords button by the minimap | Select all idle soldiers |

### Orders (right-click)

With units selected, right-click:

| Target | Villagers | Soldiers |
|---|---|---|
| Ground | Move there (in formation) | Move there; they engage enemies near where they stop |
| Tree, berry bush, gold mine, deer / boar | Gather (hunters spear animals, then butcher them) | Move |
| Your farm | Farm it (one farmer per farm) | Move |
| Your unfinished building | Help build it | Move |
| Your temple | Worship (generates favor) | Move |
| Your Town Center / Storehouse while carrying | Drop off the load | Move |
| Enemy unit or building | Attack | Attack (soldiers sent at a building fight off nearby defenders, then return to it) |
| Minimap | Move there | Move there |

With a Town Center, Military Academy or Temple selected, right-click sets its **rally
point**; trained units walk there (villagers rallied onto a resource start gathering it).

`X` or the Stop button halts the selected units.

### Command hotkeys

The command grid (bottom left) shows each command's hotkey; the same keys work from
the keyboard.

| Selection | Key | Command |
|---|---|---|
| Villagers | `E` | Build House (+10 population) |
| | `F` | Build Farm |
| | `S` | Build Storehouse (drop-off) |
| | `R` | Build Temple |
| | `B` | Build Military Academy |
| | `T` | Build Town Center |
| | `X` | Stop |
| Town Center | `Q` | Train Villager |
| | `A` | Advance to the next age |
| Military Academy | `Q` / `W` / `E` | Train Hoplite / Toxotes (archer) / Hippikon (cavalry) |
| Temple | `Q` | Train Minotaur (Classical Age) |

Click a queued unit in the selection panel to cancel it (the cost is refunded).

### Building placement

1. Select one or more villagers and press a build hotkey (or click the button).
2. A ghost follows the cursor: green where the building fits, red where it does not
   (blocked, water, steep ground, unexplored or unaffordable).
3. Left-click to place it. The cost is paid and the selected villagers go to build it.
   **Shift + click** keeps placing more of the same building.
4. Right-click or `Esc` cancels.

When they finish, builders help on the nearest unfinished building of yours, else go
back to what they were doing before, else stand idle. The first builder of a farm
starts farming it.

### Control groups

| Input | Action |
|---|---|
| `Ctrl` + `0`-`9` | Assign the selection to a group |
| `0`-`9` | Select the group (tap twice to centre the camera on it) |
| `Shift` + `0`-`9` | Add the group to the selection |
| Click a group card (top left) | Select the group and centre on it |

### God powers

The slots either side of the age medallion (top centre) are the god powers. Each costs
favor and then recharges (the dark sweep shows the cooldown).

| Power | Cost | Effect |
|---|---|---|
| Lightning Storm (Zeus) | 40 favor | A whirling storm over an area: lightning strikes enemy units for 9 s and hurls them into the air |
| Bolt (Zeus) | 15 favor | A single bolt that slays the enemy unit nearest the target point |
| Meteor | 30 favor | A meteor smashes units and buildings where it lands |

Click a power, then left-click the target on the map. Right-click or `Esc` cancels.
Favor comes from villagers worshipping at a temple.

### Other HUD buttons

Top right: game speed (normal / fast), pause, objectives, and hotkeys (click to pin the
hotkey card open). By the minimap: idle villager, idle military, Town Center, signal
(explains minimap orders), minimap terrain on/off, and the score list on/off.

## Scenes

The game doubles as a deterministic screenshot harness. Pick a scene with `?scene=`:

| URL | What it shows |
|---|---|
| `/` or `/?scene=skirmish` | The playable match against the AI (default) |
| `/?scene=town` | A developed Greek town in full swing |
| `/?scene=battle` | Two mixed armies clashing, arrows in flight |
| `/?scene=godpower` | Zeus's Lightning Storm striking an enemy army |
| `/?scene=coast` | A seaside town with beach, cliffs and animated water |
| `/?scene=economy` | A busy economy: farms, hunters, fishing boats, building and training |
| `/?scene=hud` | The town with the full HUD, a villager selected and control groups set |

Harness scenes start paused; add `&live=1` to let them run. Other parameters:
`seed=N`, `hud=0|1`, `fog=0|1`, `post=high|low|off` (post-processing quality),
`timescale=N` and `cam=x,z[,distance[,pitch[,yaw]]]`.

## Scripts

All scripts expect a server already running (`npx vite` or `npx vite preview`) and use
headless Chromium with software WebGL through Playwright.

```
node scripts/shoot.mjs --scene town --out shots/town.png [--port 5173] [--width 1920 --height 1080]
node scripts/smoke.mjs [--port 5173] [--seconds 20] [--live 60]   # short gameplay check
node scripts/longrun.mjs [--port 5173] [--minutes 12]             # long AI run, checks for runtime errors
```

## How it was built

Each visual piece (terrain, buildings, units, combat, lighting, god powers, HUD and
economy) was built and iterated by a builder agent. Each round was judged blind against
reference frames from *Age of Mythology: Retold* (in `reference/`) and kept only if it
won that comparison. A final integration pass then played the skirmish end to end and
fixed gameplay and correctness issues without changing how anything looks.
`ARCHITECTURE.md` describes the code layout, the piece contract and the scene harness.
