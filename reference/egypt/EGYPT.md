# The Egyptians in Age of Mythology: Retold (reference)

This is the reference for adding the Egyptians to Age of Voxel as a second playable pantheon, chosen per player at match setup through the major god (Ra, Isis or Set).
All values are **Retold** values from the current Age of Empires Series Wiki pages (Retold update 19.x, the Obsidian Mirror era, 2025–2026), unless marked otherwise.
Where Retold changed the original 2002 AoM value, the old value follows as "(AoM: ...)". Where a value changed several times during Retold, the newest one is given and the update that set it is noted when it matters.

Primary source: the Age of Empires Series Wiki (ageofempires.fandom.com). Each page was read as raw wikitext through the MediaWiki API
(`https://ageofempires.fandom.com/api.php?action=parse&prop=wikitext&page=<Title>`), the same method used for reference/techs/TECHS.md.
The wiki takes its numbers from the game data and tooltips and keeps a changelog for each Retold patch (update 17.x = launch 2024, 18.x = Immortal Pillars / Heavenly Spear era 2025, 19.x = Obsidian Mirror era 2025–26).
The official pantheon page is https://www.ageofempires.com/games/aom/civilizations/egyptian-pantheon/ .

Conventions (same as TECHS.md):
- Cost is food / wood / gold / favor ("f / w / g / fav"). "-" means none.
- Armor is Retold's percentage damage reduction: hack / pierce / crush. 99% crush on human units means crush damage barely hurts them.
- Attacks: H = hack, P = pierce, C = crush, D = divine. "×N vs X" is a damage multiplier against class X.
- Range, LOS and speed are in game metres (tiles); ROF is seconds between attacks.
- **Laborers build 25% slower** than Greek villagers (work rate ×0.75), so every Egyptian build time below is the base time ×4/3 (for example 15 s base → 20 s). The in-game UI shows the base time until a Laborer starts on the foundation.

---

## 1. Civilization rules

Sources: https://ageofempires.fandom.com/wiki/Egyptians_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Laborer , https://ageofempires.fandom.com/wiki/Pharaoh_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Priest_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Monument_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Town_Center_(Age_of_Mythology) , https://www.ageofempires.com/games/aom/civilizations/egyptian-pantheon/

### 1.1 Start of the match
| Item | Retold | AoM |
|---|---|---|
| Starting resources | 200 f, 100 w, 50 g, 0 favor | 250 f, 100 w, 100 g |
| Starting units | 1 **Pharaoh**, 1 **Priest** (the scout), **3 Laborers** | 2 Laborers |
| Set only | also 1 **Baboon of Set** (scout animal) | Hyena of Set |
| Starting building | Town Center (Egyptian model) | same |

### 1.2 Economy: Laborers, no worship
- Worker unit: **Laborer** (50 f, 1 pop, 17 s at the Town Center). There is a hard cap of **100 living Laborers** whatever the population (AoM: 80).
- Laborers gather **10% slower** than Greek villagers (Caravans and Fishing Ships too), and **build 25% slower**.
- Laborers gather food, wood and gold, build every building **except Obelisks**, and repair everything. They **never gather favor**: Egyptians have no worship.
- Base gather rates per second (unempowered, no techs): Farm 0.63, hunt 0.9, herd 0.81, berries 0.63 (Ra: 0.819), tree 0.9, gold mine 0.77.
  Carry capacity: 15 food, 10 wood, 10 gold (+5 per wood/gold tech, +15 food with Husbandry).
- **Separate drop sites** per resource: **Granary** (food), **Lumber Camp** (wood), **Mining Camp** (gold). All three are **free**, and the Town Center takes everything. (Greeks: one Storehouse for wood + gold.)
- **Farms are available in the Archaic Age** (Greeks: Classical) and cost **70 gold**.

### 1.3 Buildings cost gold instead of wood
- Egyptian buildings **never cost wood**. Drop sites, **Houses**, the **Armory** and the **Market** are **free** (but slow to build).
- Most others cost **gold**: Town Center / Village Center 550 g; Farm 70 g; Dock 50 g; Barracks 75 g; Siege Works 75 g; Migdol 500 g; towers 200 g; walls 3–15 g per segment; Lighthouse 200 g; Obelisk 10 g.
- The **Temple** costs **150 g** (wood removed: Greek 150 w + 150 g).
- The Wonder costs 5,000 f + 7,500 g (wood -100%, gold +50%).
- Watch Tower upgrade: 50 w + 100 g (a discount; it was free and automatic before update 18.33318).
- Warships cost -10%.
- Human soldier upgrades are **per unit line** (Medium / Heavy / Champion Spearmen, Axemen, ...), not shared per building as for the Greeks.

### 1.4 Favor: Monuments
- Egyptians get favor only from **Monuments** (and the Wonder). Each Monument is a building with a build limit of **1**, and there are 5 types that must be built **in order** (a Monument can be placed once all previous ones exist, at least as a foundation; AoM: fully built).
- Each one gives a constant trickle while it stands. The total is 4.5 + 6 + 7.5 + 9 + 12 = **39 favor per minute** with all five.
- Empowered Monuments (Pharaoh) give +20% favor. Isis doubles this to +100%. Anubis's Necropolis gives +25%, and Bast's Eclipse gives +50% for its duration.

| # | Monument | Cost (food and gold, each) | Build time (1 Laborer) | HP | Favor / min | Size |
|---|---|---|---|---|---|---|
| 1 | Monument to Villagers | 50 f + 50 g | 26.67 s (20 base) | 450 | 4.5 (6 before 17.64528) | 1×1 |
| 2 | Monument to Soldiers | 100 f + 100 g | 40 s (30 base) | 450 | 6 | 1×1 |
| 3 | Monument to Priests | 200 f + 200 g | 53.33 s (40 base) | 600 | 7.5 | 1×1 |
| 4 | Monument to Pharaohs | 300 f + 300 g | 66.67 s (50 base) | 800 | 9 | 2×2 |
| 5 | Monument to Gods | 600 f + 600 g | 80 s (60 base) | 1,200 | 12 | 3×3 |

Monument armor: 5% / 90% / 5%, LOS 9. The wiki table has one cost column labelled "Food and Gold cost"; the number is the amount of each resource.
The Monument to Gods shows a statue of the player's major god (see building_17.jpg).
Each major god adds a Monument aura (section 4): Ra's **Mandjet**, Isis's **Divine Shield** and Set's **Devotees**.

### 1.5 The Pharaoh (hero, empowerer)
- You start with **one** Pharaoh, limit 1. Osiris's **New Kingdom** gives a second one. He is **free, 0 pop**, and cannot be trained.
- **Respawn**: if he dies, he reappears at the starting Town Center after **90 s**.
- **Empower** (passive, auto when ordered onto a building or foundation). It works on almost every building, including walls, gates, Obelisks and damaged Wonders, but **not Farms** and not Titan Gates. A beam of light shines on the empowered building. Pharaoh-strength effects:
  - construction and repair **+75% speed** (-42.86% time);
  - unit training (not Laborers, Caravans or Fishing Ships) **+75%**, and tech research (not age-ups) **+75%** (AoM: +30% for both);
  - drop sites add **+20% extra resources** on each drop (a 10-wood load becomes 12; the tree still loses 10);
  - Monuments and the Wonder generate favor **+20%** faster;
  - buildings that shoot attack **33% faster** (×0.75 reload; ×0.5 before 18.40371);
  - Obelisks and Lighthouses get **+75% LOS**.
- Strength by empowerer: a **Ra Priest** or a Ra Pharaoh-empowered Monument works at **60%** of these values (for example +45% speed instead of +75%). The **Son of Osiris** works at **120%** (+90% speed, +24% resources), with the same attack-rate and LOS bonus as the Pharaoh.
- **Heal**: auto-heals allies at **10 HP/s** (half on a non-idle target), range 10.
- **Heka**: his ranged attack does divine damage to myth units, with **×2.5 vs myth units**. It homes in on moving targets.
- He can carry relics (**Sacred Hands**), but in Retold only once a Temple exists.
- Set's Pharaoh can **summon Animals of Set** for favor without interrupting his other actions.

| Pharaoh | Archaic | Classical | Heroic | Mythic |
|---|---|---|---|---|
| HP (base 100, grows per age) | 100 | 110 | 125 | 145 |
| Ranged attack (P vs non-myth, D vs myth; base 12) | 3 | 13.2 | 15 | 17.4 |
| Range | 3 | 12 | 18 | 20 |
| LOS | 18 | 18 | 24 | 26 |

Other stats: ROF 1.0, accuracy 80%, armor 15% / 30% / 99%, speed 4.0, size 0.49. The Archaic attack is deliberately crippled so he cannot rush.

### 1.6 Priests (trainable mini-heroes)
- Cost **100 g, 2 pop, 10 s**. Trained at the **Temple**, and at the **Town Center** once a Temple exists. Available from the Archaic Age.
- **Heal** at 7.5 HP/s (half on non-idle targets), range 10. **Heka** with **×5 vs myth units**. Weak against human units.
- They **build Obelisks**, the Egyptian scouting building. They have Auto Scout and can carry relics only after **Hands of the Pharaoh** (Temple, 75 g, 10 s: +3 range, +3 LOS).
- **Ra's** Priests can **empower** (at 60%). **Isis's** build Obelisks **40% faster**, and Obelisks cost 5 g less. **Set's** can **convert wild animals** (range 10) into Animals of Set, which keep 75% of their food.

| Priest | Archaic | Classical | Heroic | Mythic |
|---|---|---|---|---|
| HP (base 80) | 80 | 88 | 100 | 116 |
| Attack (base 2) | 0.5 | 2.2 | 2.5 | 2.9 |
| Range | 5 | 12 | 16 | 20 |
| LOS | 14 | 14 | 18 | 22 |

Other stats: ROF 0.8, armor 10% / 1% / 99%, speed 3.8.

### 1.7 Town Center, Houses, population
- **Town Center** (Egyptian): **550 g**, build time **200 s** for one Laborer (150 base), 2,400 HP, 50% / 90% / 10%, 5×5, LOS 25, 2 arrows of 10 dmg, range 18.
  It supports **15 pop**; a Fortified TC supports 25. Limit: 1 in the Archaic Age, unlimited from the Classical Age. Garrison 25.
  It trains **Laborers**, **Priests** (once a Temple exists), **Mercenaries** and **Mercenary Cavalry**, and does the age-ups.
  It researches the generic Fortified Town Center, Masons, Architects and Secrets of the Titans, plus these Egyptian god techs: Skin of the Rhino (Ra), Sun-dried Mud-brick (Sobek), Funeral Rites, Spirit of Maat and Nebty (Nephthys), New Kingdom (Osiris), Book of Thoth (Thoth).
- **Village Center** (Egyptian): 550 g, 200 s, 1,200 HP. It cannot hire Mercenaries.
- **House**: **free**, **20 s** (15 base), **+10 pop**, 450 HP, 2×2, limit 16 (as for the Greeks).
- **Isis**: Town Centers and Citadel Centers support **+5 pop** (20 per TC).

### 1.8 Ages
The age-up costs and requirements are **the same as the Greeks'**. Each age-up picks one of two minor gods offered by the major god (section 5).
| Age-up | Cost | Time | Requirement |
|---|---|---|---|
| Classical | 400 f | 60 s | a Temple |
| Heroic | 800 f + 500 g | 75 s | an Armory **or** a Market (Retold) |
| Mythic | 1,200 f + 1,200 g | 120 s | a fortress-type building (for Egyptians, the **Migdol Stronghold**) |
| Wonder Age (Retold) | build the Wonder: 5,000 f + 7,500 g | 7,200 s for one Laborer | Mythic Age |

Source for ages: https://ageofempires.fandom.com/wiki/Classical_Age_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Heroic_Age , https://ageofempires.fandom.com/wiki/Mythic_Age , https://ageofempires.fandom.com/wiki/Wonder_Age

---

## 2. Egyptian buildings

Sources: https://ageofempires.fandom.com/wiki/Town_Center_(Age_of_Mythology) , .../House_(Age_of_Mythology) , .../Granary_(Age_of_Mythology) , .../Lumber_Camp_(Age_of_Mythology) , .../Mining_Camp_(Age_of_Mythology) , .../Farm_(Age_of_Mythology) , .../Monument_(Age_of_Mythology) , .../Temple_(Age_of_Mythology) , .../Barracks_(Age_of_Mythology) , .../Migdol_Stronghold , .../Siege_Works_(Age_of_Mythology) , .../Armory , .../Market_(Age_of_Mythology) , .../Dock_(Age_of_Mythology) , .../Obelisk , .../Lighthouse_(Age_of_Mythology) , .../Sentry_Tower_(Age_of_Mythology) , .../Watch_Tower_(Age_of_Mythology) , .../Guard_Tower_(Age_of_Mythology) , .../Stone_Wall_(Age_of_Mythology) , .../Fortified_Wall_(Age_of_Mythology) , .../Citadel_Wall , .../Citadel_Center , .../Wonder_(Age_of_Mythology)

All build times are for one Laborer, which is the base time ×4/3. Armor is hack / pierce / crush.

| Building | Age | Cost | Build time | HP | Armor | Size | LOS | Function |
|---|---|---|---|---|---|---|---|---|
| **Town Center** | Archaic (start) | 550 g (AoM 100 f + 400 g) | 200 s | 2,400 (Fortified 3,000) | 50/90/10 | 5×5 | 25 | Laborers, Priests\*, Mercenaries; age-ups; +15 pop; drop site for all; 2×10 arrows, range 18 |
| **House** | Archaic | free | 20 s | 450 | 40/90/5 | 2×2 | 9 | +10 pop, limit 16 |
| **Granary** | Archaic | free | 20 s | 400 | 40/90/5 | 2×2 | 9 | Food drop site. Techs: Husbandry, Plow → Irrigation → Flood Control, Survival Equipment; Flood of the Nile (Isis), Sacred Cats (Bast), Shaduf (Ptah, also at the Temple) |
| **Lumber Camp** | Archaic | free | 20 s | 400 | 40/90/5 | 2×2 | 9 | Wood drop site. Techs: Hand Axe → Bow Saw → Carpenters; Adze of Wepwawet (Bast) |
| **Mining Camp** | Archaic | free | 20 s | 400 | 40/90/5 | 2×2 | 9 | Gold drop site. Techs: Pickaxe → Shaft Mine → Quarry |
| **Farm** | **Archaic** | 70 g (Shaduf -50%) | 13.33 s | 200 | 40/80/5 | 3×3 | 6 | Infinite food, 1 Laborer |
| **Monument** ×5 | Archaic | 50–600 f+g (§1.4) | 26.7–80 s | 450–1,200 | 5/90/5 | 1×1 to 3×3 | 9 | Favor trickle and god aura |
| **Obelisk** | Archaic | 10 g (Isis 5 g) | 12 s by a **Priest** (Isis 40% faster); 48 s by a Fishing Ship | 50 | 5/90/5 | 0.74×0.74 | **32** (detection 12) | Scouting only, built by Priests and Fishing Ships |
| **Temple** | Archaic | **150 g** (Greek 150 w + 150 g) | 53.33 s (40 base) | 1,200 | 40/90/5 | 5×5 | 9 | Priests, myth units; Hands of the Pharaoh and god techs; relics (garrison 5) |
| **Dock** | Archaic | 50 g | 40 s | 1,600 | 40/90/5 | 3.5×3.5 | 22 | Fishing Ship, Kebenit, Ramming Galley, War Barge, Leviathan, War Turtle |
| **Barracks** | **Classical** | 75 g | 33.33 s (25 base) | 1,200 | 40/90/5 | 4×4 | 9 | Spearman, Axeman, Slinger; their Medium/Heavy/Champion lines; Levy/Conscript Barracks Soldiers; god techs |
| **Armory** | Classical | **free** | 53.33 s (40 base) | 1,200 | 40/90/5 | 4×4 | 9 | Generic Copper/Bronze/Iron line, Ballistics, Burning Pitch; Ptah and Sekhmet techs |
| **Market** | Classical | **free** | 53.33 s | 1,200 | 40/90/5 | 4×4 | 9 | Trade (exchange rates, tribute), Caravans; Dark Water (Sobek) |
| **Sentry Tower** | Classical | 200 g | 80 s (60 base) | 600 | 50/90/5 | 1×1 | 24 | Upgrades: Watch Tower (50 w + 100 g, Egyptian discount), Guard Tower (Heroic), **Ballista Tower** (Mythic, Egyptian only); limit 30 |
| **Stone Wall / Gate** | Classical | 3 / 6 / 9 / 15 g (connector / short / medium / long) | ×4/3 of 5 / 6 / 9 / 15 s | 1,200 (connector 600) | 55/90/5 | - | 8 | Fortified Wall (Heroic, 500 f + 400 g, 50 s, 1,800 HP) → **Citadel Wall** (Mythic, Egyptian only, 800 f + 500 g, 50 s, 2,400 HP) |
| **Migdol Stronghold** | **Heroic** | **500 g**, limit 15 (the wiki notes it shows 600 since update 18.42553; forum thread 277805 says the cost in game is 600) | **153.33 s** (115 base) | **3,250** | 50/90/5 | 5×5 | 30 | Egyptian fortress: Chariot Archer, Camel Rider, War Elephant. Shoots 3 arrows of 11.5, range 4–20, ×3 vs ships. Garrison 20. Mythic Age prerequisite |
| **Siege Works** | Heroic | 75 g | 53.33 s (40 base) | 1,200 | 40/90/5 | 5×5 | 9 | Siege Tower (Heroic), Catapult (Mythic); Draft Horses, Engineers; Force of the West Wind (Sekhmet) |
| **Lighthouse** | **Mythic** | 200 g (300 before 19.14612) | 160 s (120 base); 480 s by a Fishing Ship | 1,400 | 40/90/5 | 3×3 | **60** | Huge LOS, garrison 10 |
| **Citadel Center** | Heroic | from the **Citadel** god power (Sekhmet) on a TC | - | 3,600 (Fortified 4,500) | 55/90/10 | 5×5 | 26 | TC +1,200 HP, +2 dmg and +1 arrow (3 arrows), +10 pop (25), +10% hack armor, everything 25% faster |
| **Wonder** | Mythic | 5,000 f + 7,500 g | 7,200 s | 9,999 | 40/90/5 | 8×8 | 9 | Advances to the Wonder Age (Retold). It can be empowered while building, and when finished but damaged |

\* The TC trains Priests only after a Temple has been built.
Set: Barracks, Siege Works and Migdol cost **-25% gold**.
Sobek's **Sun-dried Mud-brick** (TC, Heroic): all Egyptian buildings +10% HP, -10% gold cost, -15% build time.

Building look in Retold (see building_*.jpg): flat-roofed sandstone and mud-brick blocks with a **blue player-colour band** on the roof rims and the bases.
Houses are three small flat-roofed boxes with striped cloth awnings. The Granary has round domed clay silos beside a flat-roofed hut. The camps are flat-roofed huts with striped awnings, log piles or gold ore.
The Temple is a raised platform with a pillared kiosk, ramps and a large god statue. The TC is a walled compound with a falcon-god statue, a courtyard and silos.
The Migdol is a tall square stone keep with corner turrets and a tiled roof. The Barracks is a low walled courtyard with yellow banners. The Obelisk is a slim gilded spire topped with a glowing teal flame.
The Monuments are dark-stone and gold statues (kneeling Laborer, mummiform soldier, priest, Pharaoh and queen couple, god) on gilded plinths.

---

## 3. Egyptian human units

Sources: https://ageofempires.fandom.com/wiki/Laborer , .../Spearman_(Age_of_Mythology) , .../Axeman_(Age_of_Mythology) , .../Slinger_(Age_of_Mythology) , .../Chariot_Archer_(Age_of_Mythology) , .../Camel_Rider_(Age_of_Mythology) , .../War_Elephant_(Age_of_Mythology) , .../Siege_Tower_(Age_of_Mythology) , .../Catapult_(Age_of_Mythology) , .../Mercenary_(Age_of_Mythology) , .../Mercenary_Cavalry , .../Priest_(Age_of_Mythology) , .../Pharaoh_(Age_of_Mythology) , .../Caravan_(Age_of_Mythology) , .../Fishing_Ship_(Age_of_Mythology) , .../Kebenit , .../Ramming_Galley , .../War_Barge , .../Baboon_of_Set , .../Hyena_of_Set , .../Crocodile_of_Set

### 3.1 Land units
| Unit | Built at, age | Cost | Pop | Train | HP | Attack | Range | ROF | Armor H/P/C | Speed | LOS | Bonuses / notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Laborer** | TC, Archaic | 50 f | 1 | 17 s | 55 (AoM 65) | 6 H melee; 12 P vs animals (range 12, ROF 2) | 0.5 | 1 | 25/35/99 | 3.8 | 14 | ×4 vs towers. Cap 100 |
| **Spearman** | Barracks, Classical | 50 f + 25 g | 2 | 12.5 s | 85 | 6 H | 0.75 | 1 | 40/10/99 | 5.0 | 16 | **×2 vs cavalry** (anti-cavalry infantry) |
| **Axeman** | Barracks, Classical | 40 f + 30 g | 2 | 11.5 s | 85 | 5 H | melee | 1 | 40/10/99 | 4.3 | 16 | **×4 vs infantry** (anti-infantry) |
| **Slinger** | Barracks, Classical | 55 w + 25 g | 2 | 13.5 s | 60 | 4 P | 17 | 1 | 15/40/99 | 4.0 | 19 | **×2.25 vs ranged soldiers** (anti-archer) |
| **Chariot Archer** | Migdol, Heroic | 100 w + 40 g | 3 | 8 s | 95 | 11 P | 19 | 1.5 | 15/20/99 | 5.0 | 21 | **×1.5 vs infantry**. Ranged cavalry |
| **Camel Rider** | Migdol, Heroic | 50 f + 70 g | 3 | 6.5 s | 135 | 8 H | 0.75 | 1 | 15/40/99 | 6.0 | 16 | **×2 vs cavalry**, ×1.25 vs ranged soldiers |
| **War Elephant** | Migdol, Heroic | 180 f + 70 g | 5 | 14 s | 450 | 22 H (small splash) | 0.75 | 1.4 | 25/50/99 | 2.9 | 16 | **×4 vs buildings**, ×1.5 vs ranged soldiers. Size 1.49 |
| **Siege Tower** | Siege Works, Heroic | 200 w + 100 g | 3 | 15 s | 400 | 180 C ram vs buildings (ROF 3.5, range 3, area 8 vs walls) + 3 arrows × 3 P vs units (range 12) | 3 / 12 | 3.5 / 1 | 5/90/85 | 2.9 | 20 | Garrisons 5 foot units |
| **Catapult** | Siege Works, Mythic (Heroic with Force of the West Wind) | 200 w + 200 g | 5 | 26.5 s | 115 | 200 C + 40 P, area 8 | 10–28 | 4 | 30/90/85 | 2.4 | 36 | ×2.5 vs ships |
| **Mercenary** | TC, Archaic | 90 g | **0** | 1 s | 90, **-2.5 HP/s** (expires) | 7 H | 0.75 | 1 | 35/15/99 | 4.3 | 16 | ×1.5 vs cavalry. Limit 12. Emergency defence |
| **Mercenary Cavalry** | TC, Heroic | 120 g | **0** | 2 s | 160, **-4 HP/s** | 8 H | 0.75 | 1 | 20/35/99 | 5.3 | 12 | ×1.5 vs ranged soldiers. Limit 8 |
| **Priest** | Temple / TC, Archaic | 100 g | 2 | 10 s | 80–116 | 0.5–2.9 P/D, **×5 vs myth** | 5–20 | 0.8 | 10/1/99 | 3.8 | 14–22 | Heals 7.5/s, builds Obelisks (§1.6) |
| **Pharaoh** | start (respawns at TC in 90 s) | free | 0 | - | 100–145 | 3–17.4 P/D, **×2.5 vs myth** | 3–20 | 1.0 | 15/30/99 | 4.0 | 18–26 | Empower, heals 10/s (§1.5) |
| **Son of Osiris** | Son of Osiris god power on a Pharaoh | - | 0 | - | 420 / 462 / 525 / **609** (by age) | **50.75 D chain lightning** (Mythic), jumps to 4 targets, ×3 vs myth | 18 | 3 | 30/50/99 | 3.6 | 25 | Heals 15/s, empowers at 120%, cannot be healed, immune to targeted god powers |
| **Caravan** (camel) | Market, Heroic | 100 f + 25 w | 1 | 18 s | 115 | - | - | - | 30/30/99 | 3.8 | 16 | Trade, limit 60 |

Egyptian human soldiers get the normal automatic age stat boosts and the Armory lines.
Per-line upgrades (these replace the Greek Medium/Heavy/Champion Infantry etc.):
| Line | Medium (Classical) | Heavy (Heroic) | Champion (Mythic) |
|---|---|---|---|
| Spearmen | 100 f + 100 g, 20 s: +10% HP, +10% dmg, +1 LOS | 300 f + 200 g, 30 s: +15% HP, +15% dmg, +1 LOS | 400 f + 300 g, 40 s: +20% HP, +20% dmg, +1 LOS |
| Axemen | same costs as Spearmen | same | same |
| Slingers | 100 w + 100 g, 20 s: +10% HP, +10% dmg, +1 LOS, +1 range | 300 w + 200 g, 30 s: +10% HP, +15% dmg, +1 LOS, +1 range | 400 w + 300 g, 40 s: +10% HP, +20% dmg, +1 LOS, +1 range |
| Chariots | free on reaching Heroic (+10% HP, +10% dmg) | 200 w + 200 g, 15 s: +10% HP, +15% dmg, +1 LOS | 400 w + 200 g, 40 s: +10% HP, +20% dmg, +1 LOS |
| Camel Riders | free on reaching Heroic (+10% HP, +10% dmg) | 250 f + 150 g, 15 s: +15% HP, +15% dmg, +1 LOS | 400 f + 200 g, 40 s: +20% HP, +20% dmg, +1 LOS |
| War Elephants | free on reaching Heroic (+10% HP, +10% dmg) | 300 f + 200 g, 15 s: +15% HP, +15% dmg, +1 LOS | 500 f + 400 g, 40 s: +20% HP, +20% dmg, +1 LOS, +0.75 splash radius |

Training-speed techs: **Levy Barracks Soldiers** (Barracks, Heroic, 150 f + 75 w, 20 s, -20% train time) → **Conscript Barracks Soldiers** (Mythic, 200 f + 100 w, 30 s, -20%).
**Levy Migdol Soldiers** (Migdol, Heroic, 75 w + 150 g, 20 s, -20%) → **Conscript Migdol Soldiers** (Mythic, 100 w + 200 g, 20 s, -20%).
**Advanced Fortifications** (Migdol, Mythic, 600 w + 600 g, 30 s): fortress +50% attack, towers +50% attack. Source: https://ageofempires.fandom.com/wiki/Levy_Barracks_Soldiers and the pages of the same names.

### 3.2 Animals of Set (Set only)
Set's Pharaoh summons them (3–4 s, favor). Each age-up also spawns 3 at the Temple: Classical 2 Gazelles + 1 Hyena, Heroic 2 Giraffes + 1 Crocodile, Mythic 2 Hippos + 1 Rhino (5 each before update 19.12998).
Examples: **Baboon of Set** (Archaic, 3 favor, 1 pop, 20 HP, 3 H, speed 3.3, the starting scout); **Hyena of Set** (Classical, 4 favor, 45 HP, 7 H, speed 4); **Crocodile of Set** (Heroic, 6 favor, 70 HP, 9 H).
The Mythic summons are Hippopotamus, Rhinoceros and Elephant of Set. Source: https://ageofempires.fandom.com/wiki/Animal_of_Set

### 3.3 Ships (Dock)
| Ship | Age | Cost | Pop | HP | Attack | Notes |
|---|---|---|---|---|---|---|
| Fishing Ship | Archaic | 50 w | 1 | 100 | - | Can build Obelisks and Lighthouses |
| Kebenit (arrow ship) | Classical | 90 w + 45 g | 3 | 290 | 3 arrows × 8 P, range 15 | Garrison 5 |
| Ramming Galley (close combat) | Classical | 90 w + 45 g | 3 | 320 | 25 H, range 2 | |
| War Barge (siege ship) | Classical | 90 w + 45 g | 3 | 250 | 4 projectiles × 4 C + 2 P, range 20, ×2 vs arrow ships | Trains fastest, 12.5 s |
| Leviathan (myth) | Heroic | 200 g + 15 fav | 3 | 1,020 | 38 H | Transport, 15 slots |
| War Turtle (myth) | Mythic | 225 f + 15 fav | 4 | 1,320 | 60 H + 40 C | Buck flips nearby ships |

Look (unit_*.jpg): bronze-skinned soldiers in white linen kilts with **blue player colour** on the kilts and armbands.
Axemen wear striped nemes headcloths and carry gold epsilon axes and gold/blue shields. Spearmen are bare-chested with long spears. Slingers wear short kilts.
Chariot Archers ride silver two-wheel chariots pulled by white horses with blue/striped blankets. Camel Riders sit on blanketed camels. War Elephants carry a howdah tower and wear armour plates.
The Priest wears a white robe and headcloth with a gold ankh staff. The Pharaoh wears a tall blue/gold crown and a gold robe with a crook staff, inside an empower ring.

---

## 4. Major gods: Ra, Isis, Set

Sources: https://ageofempires.fandom.com/wiki/Ra , https://ageofempires.fandom.com/wiki/Isis , https://ageofempires.fandom.com/wiki/Set , https://ageofempires.fandom.com/wiki/Rain , https://ageofempires.fandom.com/wiki/Prosperity , https://ageofempires.fandom.com/wiki/Vision , https://ageofempires.fandom.com/wiki/Skin_of_the_Rhino , https://ageofempires.fandom.com/wiki/Flood_of_the_Nile , https://ageofempires.fandom.com/wiki/Clairvoyance , https://www.ageofempires.com/games/aom/civilizations/egyptian-pantheon/

Retold god-power model: a power has a **favor cost**, a **recharge** (cooldown) and a **ramp** (each recast costs more). In the Wonder Age every Egyptian power gets -75% recharge and -75% recast cost.

### Ra: God of the Sun. Focus: Migdol Stronghold units and empowerment
- Minor gods: Classical **Bast / Ptah**; Heroic **Sobek / Sekhmet** (AoM: Hathor / Sekhmet); Mythic **Horus / Osiris**.
- Bonuses:
  - **Mandjet**: a Pharaoh-empowered Monument also empowers all buildings (including other Monuments) within **30 m** at **60%** efficiency. It does not stack.
  - **Priests can empower** (at 60% of a Pharaoh).
  - Workers gather berries **+30%** faster.
  - Camel Rider, Chariot Archer and War Elephant **+15% HP**.
  - (AoM: chariots and camels +12% HP and +10% speed; Pharaoh empower +25% resources; Monuments -25% cost.)
- **God power: Rain** (Archaic). 30 favor, recharge 90 s, ramp +15. For **50 s**, the caster's Laborers farm **+150%** faster and Fishing Ships fish +50% faster. It now affects only the caster.
  (AoM: 60 s, +200% farming for the caster and +100% for everyone else, and it blocked other powers globally.)
- **Unique tech: Skin of the Rhino** (TC, Archaic): 50 f + 5 fav, 15 s. Laborers get -25% hack and -25% pierce vulnerability. (AoM: also +10% hack attack.)

### Isis: Goddess of Magic and Healing. Focus: technology
- Minor gods: Classical **Anubis / Bast**; Heroic **Sobek / Nephthys** (AoM: Hathor / Nephthys); Mythic **Osiris / Thoth**.
- Bonuses:
  - **Divine Shield**: no enemy god power can be cast within **25 m** of a Monument. When the Monument is empowered the shield grows to **50 m**, and the Monument also **heals** units within 50 m at 1 HP/s (half for busy units, stacks across Monuments) and gives **favor 100% faster** (instead of +20%).
  - Technologies (not age-ups, not Secrets of the Titans) cost **-10%** (the favor part is not reduced).
  - TCs and Citadel Centers **+5 pop**.
  - **Obelisks** cost 5 g less and Priests build them **40% faster**.
- **God power: Prosperity** (Archaic). 60 favor, recharge 120 s, ramp +10. For **75 s**, Laborers mine gold **+50%** faster and Caravans earn **+20%** gold (since update 19.16313; before it was +80% for 50 s, which is what the Isis page and the official site still describe).
- **Unique tech: Flood of the Nile** (Granary, Archaic): 135 g + 7.2 fav (150 g + 8 fav base, with Isis's -10%), 40 s. Passive trickle of **+1 food/s**.

### Set: God of Storms and Trickery. Focus: Barracks units
- Minor gods: Classical **Anubis / Ptah**; Heroic **Nephthys / Sekhmet**; Mythic **Horus / Thoth**.
- Bonuses:
  - **Devotees**: units trained at Barracks and Migdols near a Monument cost **-10%**. It does not stack.
  - The Pharaoh summons **Animals of Set**, and 3 of them spawn at the Temple on each age-up (§3.2).
  - Priests **convert wild animals** (the converted animal keeps 75% of its food).
  - You start with a **Baboon of Set**.
  - Spearman, Axeman and Slinger **+5% speed**.
  - Barracks, Siege Works and Migdol Strongholds **-25% gold**.
  - (AoM: Slingers and Chariot Archers trained 20% faster, Slingers +10% HP, Migdol -25% gold.)
- **God power: Vision** (Archaic). 40 favor, recharge 240 s, ramp +5. It reveals a circle of **70 m LOS** (it grows from 10 by 15 per second) anywhere on the map for **20 s**, for the caster and allies.
- **Unique tech: Clairvoyance** (Temple, Archaic): 150 g + 10 fav, 40 s. Vision recharge **-50%** and recasting is **free**. (AoM: Feral, which made converted animals stronger.)

---

## 5. Minor gods

Sources: https://ageofempires.fandom.com/wiki/Bast , .../Ptah , .../Anubis , .../Sobek , .../Hathor , .../Sekhmet , .../Nephthys , .../Osiris , .../Horus , .../Thoth , each god power page (.../Eclipse , .../Shifting_Sands , .../Plague_of_Serpents , .../Locust_Swarm , .../Citadel_(Age_of_Mythology) , .../Ancestors , .../Son_of_Osiris , .../Tornado , .../Meteor), each myth unit page (.../Anubite , .../Wadjet , .../Sphinx , .../Petsuchos , .../Roc , .../Scarab , .../Scorpion_Man , .../Mummy , .../Minion , .../Avenger , .../Phoenix , .../Leviathan_(Age_of_Mythology) , .../War_Turtle), and each tech page (same wiki, page name = tech name).

**Retold change:** in the Heroic Age, **Sobek replaces Hathor**. Hathor only comes back as a cosmetic portrait with the Legacy Deity Portraits pack.
The task brief lists Hathor; for Retold, build Sobek: same Locust Swarm power, Petsuchos and Roc myth units, and Sun-dried Mud-brick and Crocodilopolis techs, plus new techs Dark Water and Solar Barque.

| Age | Minor god | Offered by |
|---|---|---|
| Classical | **Bast** | Ra, Isis |
| Classical | **Ptah** | Ra, Set |
| Classical | **Anubis** | Isis, Set |
| Heroic | **Sobek** (AoM: Hathor) | Ra, Isis |
| Heroic | **Sekhmet** | Ra, Set |
| Heroic | **Nephthys** | Isis, Set |
| Mythic | **Osiris** | Ra, Isis |
| Mythic | **Horus** | Ra, Set |
| Mythic | **Thoth** | Isis, Set |

Myth units are trained at the Temple. Their attack ignores normal armor in the usual AoM way (myth vs human). All myth units have 80% crush armor and ×0.5 (or ×0.25) damage vs heroes.
Myth units get +HP/+attack bonuses from later age-ups. Sekhmet's **Crimson Linen** (Temple/Dock, Heroic, 125 f + 20 fav, 40 s) gives every myth unit lifesteal of 25% of damage dealt (Scarab 75%).

### 5.1 Classical Age

**Bast** (Ra, Isis): myth units and Laborers
- **Eclipse**: 90 favor, recharge 150 s, ramp +25, **55 s**, whole map (the sky darkens). Your myth units get +20% damage (abilities included), -60% ability recharge, +15% speed and -10% hack/pierce/crush vulnerability; Monuments generate +50% favor. Only one Eclipse can be active at a time. (AoM: +50% attack, 60 s, and it blocked other powers.)
- **Sphinx**: 120 g + 18 fav, 3 pop, 17 s. HP 300; 15 H + 9 C, range 1, ROF 1.3; armor 45/60/80; speed 5.3; LOS 16; ×3 vs myth units. Ability **Whirlwind**: 30 H over 2 s to all adjacent enemies in a 2.5 m area, recharge 15 s. It raids and attacks buildings.
- Techs:
  - **Criosphinx** (Temple, 150 w + 5 fav, 40 s): Sphinx +20% HP, +20% hack and +50% crush damage.
  - **Hieracosphinx** (Temple, 150 w + 10 fav, 30 s, needs Criosphinx): +10% speed, a further +20% hack and +50% crush.
  - **Sacred Cats** (Granary, 55 g + 10 fav, 30 s): Laborers +8% farming and +10% other food.
  - **Adze of Wepwawet** (Lumber Camp, 50 g + 10 fav, 40 s): Laborers fell trees in one hit, +10% wood rate.

**Ptah** (Ra, Set): technology / Barracks units
- **Shifting Sands**: 40 favor, recharge 180 s, ramp +20. After 3 s it teleports **all own and allied units** (not ships or Titans) in a **10 m** circle to a **visible** point at least 40 m away (no maximum distance). (AoM: radius 5, and it could also take some enemy units.)
- **Wadjet**: 150 w + 15 fav, 2 pop, 17 s. HP 270; 12 P ranged, range 18, ROF 1.5, accuracy 80%; **Venomous**: +2.5 D/s for 5 s on organic units; ×2 vs myth units; armor 25/35/80; speed 3.8; LOS 20. A winged cobra that spits venom.
- Techs:
  - **Scalloped Axe** (Armory/Barracks, 50 f + 10 fav, 30 s): Axeman +15% attack.
  - **Leather Frame Shield** (Armory/Barracks, 75 w + 10 fav, 40 s): Spearman -15% pierce vulnerability.
  - **Electrum Bullets** (Armory/Barracks, 150 g + 15 fav, 40 s): Slinger +10% attack and +0.5 divine.
  - **Shaduf** (Temple/Granary, 100 w + 10 fav, 20 s): Farms -50% cost and -50% build time.

**Anubis** (Isis, Set): Anubites and Monuments
- **Plague of Serpents**: 60 favor, recharge 180 s, ramp +10. It spawns **14 Serpents** (Sea Snakes on water) within 14 m of the target: 2 at once, then 2 every 3 s.
  They are uncontrolled, guard the spot, attack nearby enemies, ignore buildings, give you their LOS and live until killed. (AoM: 9 serpents.)
- **Anubite**: 100 f + 15 fav, 2 pop, 9 s. HP 200; 11 H, range 0.5, ROF 0.8; ×3 vs myth units; armor 60/55/80; speed 5.0; LOS 16. Ability **Jump**: leaps onto an enemy 4–11 m away for 15 H, recharge 12 s.
- Techs:
  - **Feet of the Jackal** (Temple, 200 g + 10 fav, 30 s): becomes the Guardian Anubite, +40% HP, +20% hack, +3 jump distance.
  - **Serpent Spear** (Barracks, 125 f + 12 fav, 40 s): Spearmen poison for 0.125 D/s over 6 s.
  - **Necropolis** (Temple, 50 w + 150 g, 30 s): Monuments +25% favor.

### 5.2 Heroic Age

**Sobek** (Ra, Isis; replaces Hathor): buildings and camel units
- **Locust Swarm**: 75 favor, recharge 150 s, ramp +10. It sends **5 swarms** in a chosen direction (point + direction) at speed 3 for **20 s**.
  Each swarm deals **3.5 divine damage per second** in a 6 m area: ×6 vs Farms and berry bushes, ×0.1 vs your own units, and it kills livestock. It hits all units and buildings in its path but hurts economy most. Mythic +20% damage, Wonder Age +100%.
  (AoM: 1 swarm in a circle, 23 s, only villagers, Fishing Ships and Farms.)
- **Petsuchos**: 200 g + 16 fav, 3 pop, 20 s. HP 400; sun beam **10 P + 30 P over 1 s + 2 D + 8 D over 1 s**, **100% accuracy**, range 20, ROF 2; ×2.5 vs myth units; armor 40/45/80; speed 3.6; LOS 22.
  Its attacks **Illuminate** the target (25 LOS around it for 6 s). A jewelled crocodile.
- **Roc**: 100 g + 5 fav, 2 pop, 14 s. HP 700, armor 0/25/80, speed 5.3, LOS 16. A flying transport for 20 units (not Titans). It must **Land** (2 s) to load or unload and is immune to god powers. A giant bird carrying a basket.
- Techs:
  - **Sun-dried Mud-brick** (TC, 200 w + 20 fav, 15 s): buildings +10% HP, -10% gold cost, -15% build time.
  - **Crocodilopolis** (Temple, 200 w + 15 fav, 40 s): Petsuchos → Petsobek, +6 range and +6 LOS.
  - **Dark Water** (Market/Migdol, 200 f + 18 fav, 30 s): Camel Riders and Caravans +15% HP and +0.5 HP/s regeneration.
  - **Solar Barque** (Dock, 150 w + 10 fav, 30 s): Kebenits spawn 3 Sea Snakes per 200 damage dealt to ships.

**Hathor** (AoM only, Ra/Isis; for reference): Locust Swarm (AoM version), Petsuchos, Roc; techs Medjay (Mercenaries live 30 s longer), Crocodilopolis, Sun-dried Mud-brick.

**Sekhmet** (Ra, Set): ranged and siege weapons
- **Citadel**: 150 favor, recharge 120 s, ramp +50, instant. Target: your own or an allied Town Center, which becomes a **Citadel Center** with +1,200 HP, +2 attack and +1 arrow (3 arrows), +1 LOS, +10 pop, +10% hack armor, and **+25% work rate** (trains, researches and ages 25% faster).
- **Scarab**: 240 f + 18 fav, 4 pop, 20 s. HP 1,000; 16 H + **100 C**, range 1, ROF 1.5; ×2 vs myth units; armor 10/75/80; speed 3.3; LOS 16.
  **Causticity**: when it dies it splashes 70 D in a 6 m area. A living siege beetle with a shimmering green/orange shell.
- Techs:
  - **Bone Bow** (Migdol/Armory, 125 w + 20 fav, 40 s): Chariot Archer +2 range, +4 LOS.
  - **Slings of the Sun** (Barracks/Armory, 100 g + 15 fav, 40 s): Slinger +0.75 multiplier vs infantry.
  - **Crimson Linen** (Temple/Dock, 125 f + 20 fav, 40 s): myth units regain 25% of damage dealt as HP (Scarab 75%).
  - **Force of the West Wind** (Siege Works, 150 g + 25 fav, 90 s): siege and myth units +15% crush; **Catapults available in the Heroic Age**.
  - (AoM: Stones of Red Linen, +20% Catapult and War Barge damage.)

**Nephthys** (Isis, Set): Pharaohs and Priests
- **Ancestors**: 100 favor, recharge 180 s, ramp +5. Over 13 s it raises **13 controllable Minions** (Lost Ships on water) within a 16 m radius. They all die **60 s** after the cast.
  **Minion**: 140 HP, 10 H, ROF 0.9, armor 35/40/80, speed 4.75, ×0.5 vs villagers; undead in blue rags.
- **Scorpion Man**: 200 w + 22 fav, 3 pop, 20 s. HP 550; 30 H, range 1, ROF 1.2; ×3 vs myth units; armor 50/40/80; speed 5; LOS 16.
  Ability **Sting** (recharge 16 s): stings a few enemies in a 2 m area 3 times, each for 4 D at once + 6 D over 6 s.
- Techs:
  - **Funeral Rites** (Temple/TC, 100 g + 15 fav, 40 s): every human soldier or hero that dies refunds 8 g.
  - **Spirit of Maat** (Temple/TC, 100 g + 25 fav, 30 s): Priest and Pharaoh healing +50%, Priests -30% cost.
  - **Nebty** (Temple/TC, 100 w + 15 fav, 30 s): Priest and Pharaoh +1× vs myth units, +10% HP.
  - **Funeral Barge** (Dock, 200 g + 20 fav, 30 s): a destroyed War Barge has a 10% chance to spawn a Leviathan.
  - (AoM: City of the Dead, Pharaoh +30% HP and +20% attack, respawn 40 s.)

### 5.3 Mythic Age

**Osiris** (Ra, Isis): camels and Pharaohs
- **Son of Osiris**: 350 favor, recharge 240 s, ramp +50. Target: one of your or an ally's **Pharaohs**, who turns into the **Son of Osiris** (stats in §3.1) at full HP: a falcon-headed demigod with a chain-lightning staff.
  A new ordinary Pharaoh then appears at the Town Center after a while (since the Extended Edition).
- **Mummy**: 275 w + 25 fav, 4 pop, 17 s. HP 450; 30 P ranged, range 12, ROF 1.7; ×3 vs myth units; armor 35/50/80; speed 4.0; LOS 16.
  Ability **Reincarnation** (recharge 18 s): a curse on human or myth units in a 2 m area, range 12, for 15 s: 2 P at once + 4 D/s (60 total). A target that dies under the curse rises as **your Minion**.
  (AoM: instant kill and convert into a Minion.)
- Techs:
  - **New Kingdom** (TC/Temple, 150 g + 20 fav, 30 s): a second Pharaoh.
  - **Desert Wind** (Migdol, 300 g + 30 fav, 40 s): Camel Rider +15% HP, speed and hack damage.
  - **Atef Crown** (Temple, 200 g + 20 fav, 40 s): Mummy Vizier, +20% HP, +40% attack, Minions live twice as long.

**Horus** (Ra, Set): infantry
- **Tornado**: 350 favor, recharge 240 s, ramp +5, **20 s**. A whirlwind spirals anticlockwise out from the target, dealing **25 H + 100 C every 0.5 s** (full within 5 m of the centre, falling off to 15 m; ×0.1 vs Farms).
  It slows targets by 35% for 6 s, flattens trees (the wood stays), gives 20 m LOS and blocks other god powers **locally**. A little friendly fire.
- **Avenger**: 250 f + 22 fav, 3 pop, 24 s. HP 700; 28 H, range 0.5, ROF 1; ×3 vs myth units; armor 60/40/80; speed 5.5; LOS 16.
  Ability **Spin** (recharge 10 s): 100 H over 5 s to all adjacent enemies in a 4 m area. A falcon-headed warrior with two blades.
- Techs (Barracks):
  - **Axe of Vengeance** (150 w + 20 fav, 40 s): Axemen +0.5% attack per 1% of HP missing, +2× vs buildings.
  - **Greatest of Fifty** (150 g + 20 fav, 40 s): infantry +20% HP and +10% speed; unlocks the Wedge formation.
  - **Spear of Horus** (also listed as Spears on the Horizon; 250 f + 25 fav, 40 s): Spearmen +10% attack, +1× vs cavalry.

**Thoth** (Isis, Set): War Elephants and economy
- **Meteor**: 350 favor, recharge 240 s, ramp +5, **18 s**, 25 m target circle. 12 meteors: the first lands in the centre after 3 s, the other 11 follow after 3 more seconds on the densest targets.
  Each meteor does **580 C + 40 D** in an 8 m area at 100% accuracy (×0.1 vs own units and Farms) and always knocks units back. It leaves glowing craters, flattens trees, gives LOS and blocks god powers locally.
  (AoM: 10–11 meteors of 900 C + 100 H in a 12 m area.)
  Note: Age of Voxel already has a Greek "Meteor" (sim/godpowers); this is Thoth's version.
- **Phoenix**: 200 g + 22 fav, 4 pop. HP 600; 50 H + 65 C, range 4, area 4, ROF 2.7; ×2 vs myth units; armor 15/55/80; speed 4.5; LOS 16; flying.
  **Rebirth**: when it dies it leaves a **Phoenix Egg** (300 HP, 15/55/99) that hatches a free Phoenix after 50 s if it survives.
  The wiki infobox gives a Temple train time of 6 s, which is probably an error; check in game.
- Techs:
  - **Valley of the Kings** (Migdol, 500 g + 40 fav, 20 s): a **Pharaoh-empowered** Barracks or Migdol trains 60% slower but **spawns a free extra copy** of each unit. (AoM: Migdol -66% train time.)
  - **Book of Thoth** (TC, 300 w + 30 fav, 40 s): Laborers +10% gather rate.
  - **Tusks of Apedemak** (Migdol, 250 f + 15 fav, 40 s): War Elephant +10% attack, -10% cost, **-1 pop**.

### 5.4 The other Egyptian myth units
- **Leviathan** (Dock, Heroic, all gods in Retold): see §3.3.
- **War Turtle** (Dock, Mythic, all gods in Retold): see §3.3.
- **Egyptian Titan** (via Secrets of the Titans): a giant falcon-headed figure (Ra; AoM: Horus).

---

## 6. Armory, Market and Temple techs for Egyptians, and age-ups

Sources: https://ageofempires.fandom.com/wiki/Armory , https://ageofempires.fandom.com/wiki/Market_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Temple_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Hands_of_the_Pharaoh , and reference/techs/TECHS.md for the generic tables.

- **Armory**: free, 53.33 s build. The **11 generic techs are the same as the Greeks'**, with the same costs (TECHS.md §2.1): Copper → Bronze → Iron Weapons / Armor / Shields, Ballistics, Burning Pitch.
  The Egyptian god techs that can also be researched there are Serpent Spear (Anubis, the Armory page lists it), Electrum Bullets, Leather Frame Shield and Scalloped Axe (Ptah), and Bone Bow and Slings of the Sun (Sekhmet).
  The UI capture reference/techs/ui_02.jpg is an Egyptian Armory with Ptah's and Sekhmet's techs.
- **Market**: free, 53.33 s. The same 3 generic techs and trade rules as the Greeks (TECHS.md §3), the same Caravan (camel), and tribute is unlocked. Myth tech: Dark Water (Sobek).
- **Temple**: 150 g, 53.33 s. It trains Priests (all gods) and myth units:
  Classical Anubite / Wadjet / Sphinx; Heroic Petsuchos / Roc / Scarab / Scorpion Man; Mythic Avenger / Mummy / Phoenix.
  Its techs, by age:
  - Archaic: **Hands of the Pharaoh** (75 g, 10 s; Priests carry relics, +3 range, +3 LOS) and Clairvoyance (Set).
  - Classical: Feet of the Jackal, Necropolis, Shaduf, Criosphinx, Hieracosphinx.
  - Heroic: Funeral Rites, Spirit of Maat, Nebty, Crocodilopolis, Crimson Linen.
  - Mythic: Atef Crown, New Kingdom.
  Greek Temple generic techs that need a worship/hero mechanic do not apply.
- **Town Center**: Masons, Architects, Fortified Town Center and Secrets of the Titans as for every pantheon, plus the Egyptian god techs listed in §1.7.
- **Age-up costs**: the same as the Greeks' (§1.8). The only Egyptian difference is the Mythic prerequisite building (the Migdol Stronghold).

---

## 7. What maps onto Age of Voxel (notes for the build)
- New resource flows: no worship. Favor comes from Monument trickles; the Greek Temple-prayer favor must not apply to Egyptian players.
- New economic rules: three drop sites; Farms in Archaic; gold building costs; the Laborer 25% build penalty and 10% gather penalty; the Laborer cap of 100.
- The Pharaoh empower is a per-building multiplier (+75% build/train/research, +20% drop-off, +20% favor, ×0.75 reload). It is the core Egyptian mechanic and fits Sim::godpowers / building timers.
- Priests: a trainable healer that builds Obelisks (a 1-tile LOS tower).
- Per-unit-line upgrades (Medium/Heavy/Champion per line) instead of the Greek building-wide ones.
- Minor gods per age: Bast/Ptah/Anubis, Sobek/Sekhmet/Nephthys, Osiris/Horus/Thoth, each with one god power, myth unit(s) and techs, mirroring the existing Greek minor_gods() / set_minor_god.
