# Greek Armory, Market and Temple technologies (Age of Mythology: Retold)

This is the reference for adding the Armory, the Market and Temple research to Age of Voxel.
All values are **Retold** values as of the current Age of Empires Series Wiki pages (Retold update 19.x, the Obsidian Mirror era, 2026), unless marked otherwise.
Where Retold changed the original 2002 AoM values, the old value is given as "(AoM: ...)".

Primary source: the Age of Empires Series Wiki (ageofempires.fandom.com). Each page was read as raw wikitext through the wiki's MediaWiki API
(`https://ageofempires.fandom.com/api.php?action=parse&prop=wikitext&page=<Title>`), because the normal HTML pages sit behind a Cloudflare challenge.
The wiki takes its numbers from the in-game data and tooltips and keeps a changelog for each Retold patch.
Each section below cites its page URLs. The tooltip screenshots in this folder (ui_03.jpg, ui_05.jpg) show the in-game cost format: `Cost: 100 food, 10 favor, 40s`.

Conventions:
- Cost is food / wood / gold / favor. "-" means none.
- **Vulnerability** is AoM's name for incoming-damage multipliers. Retold shows armor as a percentage, so "-10% hack vulnerability" means 10 percentage points more hack armor (for example 30% to 40%) in the HUD's armor readout.
- Unit classes: **Human soldier** (infantry, archers, cavalry, siege crews; *not* villagers, myth units or heroes), **Hero**, **Myth unit**, **Ship**, **Building**.
  Age of Voxel maps these as: human soldier = hoplite, toxotes, hippikon; hero = hero; myth unit = minotaur; building = Town Center, towers and walls (anything that shoots).

---

## 1. Buildings

| Building | Cost | Build time | HP | Age | Armor (hack / pierce / crush) | Size | Notes |
|---|---|---|---|---|---|---|---|
| **Armory** | 150 wood | 40 s | 1,200 | Classical | 40% / 90% / 5% | 4x4 | Researches military upgrades. In Retold, an Armory **or** a Market is required to advance to the Heroic Age. (AoM: the Armory was required.) LOS 9. |
| **Market** | 150 wood (AoM: 300) | 40 s | 1,200 | Classical (AoM: Heroic) | 40% / 90% / 5% | 4x4 | Buys and sells resources, trains Caravans (caravans need a Town Center to trade with), is the caravan drop-off, and **unlocks tribute** (Retold only). It is an alternative prerequisite for the Heroic Age. (AoM: the Market was the sole prerequisite for the Mythic Age.) |
| **Temple** | 150 wood + 150 gold (AoM: 100 + 100) | 40 s | 1,200 | Archaic | 40% / 90% / 5% | 5x5 | Required for the Classical Age. Trains myth units. Greek villagers pray beside it for favor. Greek heroes can only be trained at the TC/Fortress once a Temple exists. Garrisons 5 (relics). |

Greek god bonuses on these buildings:
- **Poseidon**: Market costs -30% and spawns 2 Militia when destroyed. Market exchange rates are improved by 15% (see 3.2). The Armory spawns 4 Militia and the Temple spawns 5 when destroyed.
- **Hephaestus**: the Forge of Olympus tech (see below) makes Armory techs cheaper and faster.
- **Demeter**: herd animals near a Temple raise its favor rate (+3% each, max +30%).
- General techs that affect all three buildings: Masons (+20% HP), Architects (+30% HP), Signal Fires and Carrier Pigeons (+7 LOS).

Sources: https://ageofempires.fandom.com/wiki/Armory , https://ageofempires.fandom.com/wiki/Market_(Age_of_Mythology) , https://ageofempires.fandom.com/wiki/Temple_(Age_of_Mythology)

---

## 2. Armory (Greek): 21 technologies

### 2.1 Generic Armory line (all pantheons): 11 techs

There are three lines (weapons, armor, shields) in three tiers (Copper in Classical, Bronze in Heroic, Iron in Mythic). Each tier requires the previous one.
The in-game command panel groups these generic techs in its top row (yellow frame) and god/myth techs below them (purple frame); see ui_02.jpg.

| # | Tech | Age | Cost F/W/G/Fv | Time | Requires | Effect (exact) | Affects |
|---|---|---|---|---|---|---|---|
| 1 | **Copper Weapons** | Classical | 100 / - / 100 / - (AoM: 200F 200G) | 30 s | - | +10% attack | Human soldiers, heroes, buildings, ships |
| 2 | **Bronze Weapons** | Heroic | 200 / - / 200 / - (AoM: 300F 300G) | 40 s | Copper Weapons | +10% attack | same |
| 3 | **Iron Weapons** | Mythic | 450 / - / 450 / - (AoM: 600F 600G) | 50 s | Bronze Weapons | +10% attack | same |
| 4 | **Copper Armor** (AoM: "Copper Mail") | Classical | 75 / - / 75 / - (AoM: 150F 150G) | 30 s | - | Human soldiers -10% hack vulnerability. Heroes -15% hack. Ships -10% hack and -10% crush | Human soldiers, heroes, ships |
| 5 | **Bronze Armor** (AoM: "Bronze Mail") | Heroic | 200 / - / 150 / - (AoM: 300F 200G) | 40 s | Copper Armor | same as Copper Armor (stacks) | same |
| 6 | **Iron Armor** (AoM: "Iron Mail") | Mythic | 400 / - / 400 / - (AoM: 500F 500G) | 50 s | Bronze Armor | same (stacks) | same |
| 7 | **Copper Shields** | Classical | - / 75 / 75 / - (AoM: 150W 150G) | 30 s | - | Human soldiers and ships -10% pierce vulnerability. Heroes -15% pierce | Human soldiers, heroes, ships |
| 8 | **Bronze Shields** | Heroic | - / 200 / 150 / - (AoM: 300W 200G) | 40 s | Copper Shields | same (stacks) | same |
| 9 | **Iron Shields** | Mythic | - / 400 / 350 / - (AoM: 500W 400G) | 50 s | Bronze Shields | same (stacks) | same |
| 10 | **Ballistics** (new in Retold) | Classical (Heroic before update 19.14612) | - / 150 / 150 / - (was 200W 200G) | 50 s | - | All non-siege ranged units and buildings lead their shots and can hit moving targets. Since update 17.43876 this is "+3 track rating" rather than perfect tracking (99). | Ranged soldiers, archer ships, buildings that shoot (towers, TC) |
| 11 | **Burning Pitch** | Mythic | - / 500 / 300 / - | 40 s | - | Ranged soldiers get +3.0x damage multiplier vs buildings (Throwing Axemen only +1.0x) and +1.5x vs ships. Centaur, Medusa, Satyr and Draugr get +3.0x vs buildings. Arrow ships get +15% attack and +3.0x vs buildings. (AoM: archers +6x vs buildings, and bonuses for ballistae.) | Ranged soldiers (toxotes), some ranged myth units, arrow ships |

Notes:
- The three weapon tiers are additive, so all three give +30% attack. Each armor or shield tier adds 10 percentage points of armor (15 for heroes).
- Retold applies the Armory upgrades to buildings too. The in-game help lists them under "Applied Upgrades" for every building.
- Visual: units change their equipment model as tiers are researched (Bronze is gold coloured, Iron is silver; see the trailer and units references).

Sources: https://ageofempires.fandom.com/wiki/Copper_Weapons , /Bronze_Weapons , /Iron_Weapons , /Copper_Armor , /Bronze_Armor , /Iron_Armor , /Copper_Shields , /Bronze_Shields , /Iron_Shields , /Ballistics_(Age_of_Mythology) , /Burning_Pitch

### 2.2 Greek god (myth) techs researchable at the Armory: 10 techs

Each is available only to a player who chose that minor god (or major god, for Zeus, Hades and Poseidon picks), and only in that god's age.
Many can also be researched at another building, which is listed.

| # | Tech | God | Age | Cost F/W/G/Fv | Time | Also at | Effect (exact) | Affects |
|---|---|---|---|---|---|---|---|---|
| 12 | **Phobos' Spear of Panic** | Ares | Classical | 100 / - / - / 15 (AoM: 200F) | 40 s | Military Academy, Stable | +1 divine attack (AoM: +10% hack) | Hoplite, Prodromos, Militia |
| 13 | **Deimos' Sword of Dread** | Ares | Classical | - / - / 150 / 10 (AoM: 200F 15Fv) | 20 s | Military Academy | Unlocks Hypaspists in the Classical Age and gives them +15% attack | Hypaspist |
| 14 | **Enyo's Bow of Horror** | Ares | Classical | - / 125 / - / 12 (AoM: 200G 20Fv) | 20 s | Archery Range | Toxotes +10% attack. Arrow-firing units and buildings get +20 projectile speed (40 to 60) | Toxotes, arrow towers/buildings, Gastraphetes, triremes |
| 15 | **Sarissa** | Athena | Classical | - / 125 / - / 20 (AoM: 200W 25Fv) | 40 s | Military Academy | Hoplites get +10% hack attack and +0.5 range (AoM: -10% hack vulnerability) | Hoplite |
| 16 | **Aegis Shield** | Athena | Classical | - / 200 / - / 20 (AoM: 300W 25Fv) | 40 s | Military Academy | Infantry -15% pierce vulnerability (AoM: -10%) | Infantry (hoplite, hypaspist, myrmidon) |
| 17 | **Sun Ray** | Apollo | Heroic | 100 / - / - / 20 (AoM: 200G 40Fv) | 30 s | Archery Range | +15% ranged attack. Projectiles get +20 LOS and reveal an area of 25 for 6 s where they land | Toxotes, Peltast, Gastraphetes, Greek land heroes, Centaur, Manticore, Medusa |
| 18 | **Shafts of Plague** | Artemis | Mythic | - / - / 300 / 30 (AoM: 40Fv) | 40 s | Archery Range | Ranged soldiers +10% attack, and their projectiles poison: 0.25 divine damage/s for 6 s (not vs siege) | Ranged soldiers |
| 19 | **Forge of Olympus** | Hephaestus | Mythic | - / - / 300 / 30 | 5 s | - | All Armory techs -75% food/wood/gold cost (favor unchanged) and +50% Armory research speed | Armory |
| 20 | **Olympian Weapons** (AoM: "Weapon of the Titans") | Hephaestus | Mythic | - / - / 300 / 20 | 40 s | - | +20% attack and +1x damage multiplier vs myth units | Myrmidon, Hetairos, Gastraphetes |
| 21 | **Harvest of Souls** (added in update 19.14612) | Persephone | Mythic | 150 / - / 150 / 25 | 40 s | Military Academy | For 5 s after killing an enemy: +15% damage and -20% reload time (does not stack) | Hoplite, Hypaspist |

Sources: https://ageofempires.fandom.com/wiki/Phobos'_Spear_of_Panic , /Deimos'_Sword_of_Dread , /Enyo's_Bow_of_Horror , /Sarissa , /Aegis_Shield , /Sun_Ray , /Shafts_of_Plague , /Forge_of_Olympus , /Olympian_Weapons , /Harvest_of_Souls ; list of Armory myth techs: https://ageofempires.fandom.com/wiki/Armory

---

## 3. Market: 3 technologies and the trading rules

### 3.1 Market technologies (Greek has no Market myth techs)

| # | Tech | Age | Cost F/W/G/Fv | Time | Requires | Effect (exact) | Affects |
|---|---|---|---|---|---|---|---|
| 22 | **Tax Collectors** | Heroic | 200 / - / 200 / - | 35 s | - | Market buy/sell fee -25%, from a 30% spread to 22.5% (-0.075). Tribute fee -50% (20% to 10%). (AoM: -50% fee, no tribute effect.) | Market exchange, tribute |
| 23 | **Ambassadors** | Mythic (AoM: Heroic) | - / - / 250 / - | 30 s | Tax Collectors (Retold only) | Market fee -25% again, from 22.5% to 15%. Tribute fee removed (10% to 0). (AoM: removed the tribute fee only.) | Market exchange, tribute |
| 24 | **Coinage** | Mythic | - / - / 200 / - | 40 s | - | +20% movement speed for Caravans (and the Chinese Pixiu) | Caravan |

Sources: https://ageofempires.fandom.com/wiki/Tax_Collectors , https://ageofempires.fandom.com/wiki/Ambassadors , https://ageofempires.fandom.com/wiki/Coinage_(Age_of_Mythology)

### 3.2 Resource exchange (buy and sell)

- Gold is the currency. The Market can **buy** food or wood with gold, and **sell** food or wood for gold, in lots of **100**. Favor cannot be traded.
  The Market command panel has 4 trade buttons in a 2x2 block: a food pair and a wood pair (one buy and one sell each). Each button shows a number and its hotkey (A, S, Z, X); see ui_01.jpg, where the numbers read 42, 262, 27 and 165 late in a campaign game after heavy trading. The Caravan train button sits above them. Trying to buy without enough gold shows "You do not have enough {gold} to purchase that!" (there is a localisation bug that leaves the placeholder unfilled).
- **Base rates**: buy 100 food for **130 gold**, buy 100 wood for **130 gold**, sell 100 food for **70 gold**, sell 100 wood for **70 gold**.
  The model is a base price (100 gold per 100 units) with a **30% fee**. Buy = price x (1 + fee) and sell = price x (1 - fee).
- With Tax Collectors the fee is 22.5% (base buy 122, sell 77). With Ambassadors it is 15% (base buy 114 to 115, sell 85). The wiki prints 114/85 for Ambassadors and 122/77 for Tax Collectors.
- Poseidon (Greek major god): exchange rates are improved by 15%. (AoM: the Poseidon fee was 10% instead of 30%.)
- **Prices move**: each sale lowers that resource's price, and so both its buy and sell rates. Each purchase raises it. The price is **shared by all players** in the match, as in AoE2.
  The **per-trade step size is not published** in any source found (see Problems). The only numeric observation is from original AoM (Heaven forums, 2003). There, about 37 sales of 100 drove the sell price to its floor (about 18 gold for 100), which suggests roughly 1 to 1.5 price points per 100 traded, with a clamp at a floor and a ceiling.
  A faithful implementation: keep a per-resource `price` (start 100, clamp about 20 to 1000 like the AoE engines). Buy cost = `round(price * (1 + fee))` and sell gain = `round(price * (1 - fee))`. Each buy adds `+delta` to the price and each sell subtracts `delta`, with `delta` about 1.5 to 3. Prices do not recover over time.
- Market exchange has no research time. It is instant, but the Market cannot trade while its research queue is full (forum bug report "Filling the Market Queue prevents buying or selling resources", update 18, https://forums.ageofempires.com/t/272404).

### 3.3 Tribute (Retold)

- Tribute to allies is possible **only while the player owns a completed Market**. If all Markets are destroyed, tribute is disabled again.
- Tribute fee: **20%** at start (sending 100 food costs 120). It drops to **10%** with Tax Collectors and to **0** with Ambassadors.

### 3.4 Caravans (for completeness)

Caravans are trained at the Market (Greek "Donkey Caravan", 25 wood plus a food/gold cost, build limit 60). They walk to an own or allied Town Center and bring gold back to the farthest Market.
Gold depends on the straight-line distance between the buildings (0.7 gold per tile in Retold), +10% for an allied TC.

Sources: https://ageofempires.fandom.com/wiki/Market_(Age_of_Mythology) (Functions: resource exchange, trade, tribute), https://ageofempires.fandom.com/wiki/Caravan_(Age_of_Mythology) , https://aom.heavengames.com/cgi-bin/forums/display.cgi?action=st&fn=11&tn=14183 (original-AoM price observation)

---

## 4. Temple (Greek): 23 technologies

### 4.1 Generic

| # | Tech | Age | Cost | Time | Effect | Affects |
|---|---|---|---|---|---|---|
| 25 | **Omniscience** | Mythic | gold = 100 x total population of all enemy units | 4 s | Grants the line of sight of all enemy units and buildings ("Your spies have been sent out to watch enemy positions.") | Player |

### 4.2 Greek god (myth) techs at the Temple: 22 techs

| # | Tech | God | Age | Cost F/W/G/Fv | Time | Requires | Effect (exact) | Affects |
|---|---|---|---|---|---|---|---|---|
| 26 | **Olympian Parentage** | Zeus | Archaic | 100 / - / - / 10 (AoM: 200F) | 40 s | - | Heroes +25% HP and +1 HP/s regeneration. Also at the Fortress. (Tooltip in ui_03.jpg.) | Heroes |
| 27 | **Labyrinth of Minos** | Athena | Classical | - / 250 / - / 20 | 30 s | - | Minotaur becomes Bull Minotaur: +35% HP, +15% speed | Minotaur |
| 28 | **Winged Messenger** | Hermes | Classical | - / - / 50 / 3 (AoM: 10Fv) | 30 s | - | Pegasus +6 LOS and +20% speed. Grants a free Pegasus that respawns at a Temple 90 s after it dies | Pegasus |
| 29 | **Sylvan Lore** | Hermes | Classical | - / 250 / - / 18 | 40 s | - | Centaur becomes Centaur Polemarch: +35% HP, +3 range, +1 LOS | Centaur |
| 30 | **Will of Kronos** | Ares | Classical | - / - / 150 / 10 (AoM: 200F 25Fv) | 40 s | - | Cyclops becomes Elder Cyclops: melee attacks deal area damage (+1.5 radius) and the thrown-unit area grows by +1.5 | Cyclops |
| 31 | **Call of Lykaion** (was "Predatory Instinct") | Pan | Classical | 200 / - / - / 14 | 30 s | - | Lykaon becomes Alpha Lykaon: wolf form +25% attack. Every Town and Village Center spawns 1 Lykaon | Lykaon |
| 32 | **Hymn of the Wildwood** (update 19.14612) | Pan | Classical | - / - / 150 / 20 | 40 s | - | Heroes heal nearby units at 0.75 HP/s in radius 5 | Heroes |
| 33 | **Oracle** | Apollo | Heroic | - / 75 / - / 10 (AoM: 150W) | 30 s | - | All units and buildings +5 LOS. You can see enemy buildings' training and research queues when you select them | All units, buildings |
| 34 | **Temple of Healing** | Apollo | Heroic | - / - / 75 / 12 (AoM: 150G 20Fv) | 30 s | - | The Temple heals up to 3 idle units within radius 15 at 15 HP/s (half rate if tasked onto a moving or fighting unit) | Temple, all own units |
| 35 | **Golden Apples** | Aphrodite | Heroic | 100 / - / 75 / - (AoM: 300F 200G) | 30 s | - | Villagers +20% favor gather rate. Also at the Town Center | Villagers |
| 36 | **Roar of Orthus** | Aphrodite | Heroic | 300 / - / - / 20 | 40 s | - | Nemean Lion becomes Nemean Rex: Roar ability area radius +100% | Nemean Lion |
| 37 | **Dionysia** (AoM: "Bacchanalia") | Dionysus | Heroic | - / 150 / - / 20 (AoM: 300W) | 40 s | - | All units +5% HP | All units |
| 38 | **Chthonic Rites** (new in Retold) | Dionysus | Heroic | - / - / 100 / 25 | 25 s | - | Hydra and Scylla regenerate +4 HP/s. Also at the Dock | Hydra, Scylla |
| 39 | **Hallowed Woodlands** | Hestia | Heroic | 300 / - / - / 20 | 40 s | - | Hamadryad becomes Sylvan Hamadryad: +30% HP, +30% ranged attack, Woodland Cloak recharge -4 s | Hamadryad |
| 40 | **Face of the Gorgon** | Hera | Mythic | - / 300 / - / 20 | 40 s | - | Medusa becomes Medusa Matriarch: +5 range (attack and Petrify), -25% ability recharge (AoM: +33% HP) | Medusa |
| 41 | **Monstrous Rage** | Hera | Mythic | 250 / - / - / 25 | 30 s | - | Myth units: -25% rate of fire (+33% attack speed) and +15% speed (AoM: +25% attack) | Myth units |
| 42 | **Hand of Talos** | Hephaestus | Mythic | - / 200 / - / 15 | 40 s | - | Colossus becomes Silver Colossus: +25% HP | Colossus |
| 43 | **Shoulder of Talos** | Hephaestus | Mythic | - / - / 300 / 20 | 50 s | Hand of Talos | Colossus becomes Gold Colossus: +30% HP, -20% hack vulnerability | Colossus |
| 44 | **Flames of Typhon** | Artemis | Mythic | 300 / - / - / 20 | 40 s | - | Chimera becomes Chimera Tyrant: +40% damage, Blaze ability and a lingering fire area attack | Chimera |
| 45 | **Enchanted Hymn** | Persephone | Mythic | - / - / 300 / 20 | 40 s | - | Siren becomes Prima Siren: Alluring Aria +50% damage. Entranced units move at 0.75x instead of 0.5x | Siren |
| 46 | **Pious Sacrifice** | Persephone | Mythic | - / 125 / 125 / 30 | 40 s | - | When an infantry unit dies, human soldiers within 5 get -10% reload time for 5 s (stacks to -50%) | Infantry, human soldiers |
| 47 | **Iron Grip** | Demeter | Mythic | 150 / 150 / - / 20 | 30 s | - | Harpy becomes Nephelean Harpy: +10% speed, +25% Abduct duration, enables the Drop ability. (Moved from the Fortress to the Temple in 19.5934.) | Harpy |

Pan, Hestia, Demeter and Persephone come from the "New Gods Pack: Demeter" DLC (2026). The base game Greek minor gods are Athena, Hermes, Ares (Classical), Apollo, Dionysus, Aphrodite (Heroic) and Artemis, Hera, Hephaestus (Mythic).
For Age of Voxel, the relevant subset is: Olympian Parentage (hero), Labyrinth of Minos (minotaur), Monstrous Rage (myth units), Dionysia (all units), Oracle (LOS), Temple of Healing, Golden Apples (favor) and Omniscience.

Sources: https://ageofempires.fandom.com/wiki/Temple_(Age_of_Mythology) (Greek myth tech table), and each tech page: /Omniscience , /Olympian_Parentage , /Labyrinth_of_Minos , /Winged_Messenger , /Sylvan_Lore , /Will_of_Kronos , /Predatory_Instinct , /Hymn_of_the_Wildwood , /Oracle_(technology) , /Temple_of_Healing , /Golden_Apples , /Roar_of_Orthus , /Dionysia , /Chthonic_Rites , /Hallowed_Woodlands , /Face_of_the_Gorgon , /Monstrous_Rage , /Hand_of_Talos , /Shoulder_of_Talos , /Flames_of_Typhon , /Enchanted_Hymn , /Pious_Sacrifice , /Iron_Grip

---

## 5. Research behaviour (UI and rules shared by all three buildings)

- A tech is a button in the building's command grid with a hotkey (Q W E R T / A S D F / Z X C). Generic techs have a gold/yellow frame and god techs a purple frame (ui_02.jpg).
  Unavailable techs (wrong age, missing prerequisite) are hidden or greyed out. A researched tech disappears, and the next tier takes its slot.
- Hovering a button shows a tooltip (ui_03.jpg, ui_05.jpg):
  1. the name with its hotkey;
  2. `Cost: <n> food, <n> gold, <n> favor, <t>s` with resource icons and an hourglass;
  3. a flavour line ("Leto summons Hephaestus to harden the armor...");
  4. one bullet per effect in the form `<Unit class>: <Stat> <+/-n%>`, for example "Human Soldier: Vulnerability to Pierce attacks -15%";
  5. dimmed lines for upgrades already applied.
- Research uses the building's production queue (the same queue as training). The building portrait shows a progress bar. Resources are paid when the item is queued and refunded if it is cancelled (standard AoM behaviour).
  When it finishes, a message such as "Omniscience improvement complete." appears at the bottom left.
- Only one copy of a tech can be queued or researched. A building cannot train or exchange while its research queue is full (see 3.2).
- Research time is affected by Rigsthula, Divine Prefecture and similar god bonuses (non-Greek), and for the Armory by Forge of Olympus (Greek, Hephaestus).
