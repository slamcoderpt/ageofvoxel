// Research, technologies and trade (Godot-only, see techs.h).
#include "techs.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <initializer_list>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

// ---- data -------------------------------------------------------------------

namespace {
constexpr TechEffect E(uint8_t k, UnitMask u, bool b, double v, double retold) { return TechEffect{ k, u, b, v, retold }; }
constexpr TechEffect E(uint8_t k, UnitMask u, bool b, double v) { return TechEffect{ k, u, b, v, v }; }
constexpr TechEffect N{};
constexpr double D = DIST_SCALE;
constexpr UnitMask M_MINO = UM(U_MINOTAUR), M_CYCLOPS = UM(U_CYCLOPS), M_CENTAUR = UM(U_CENTAUR), M_MEDUSA = UM(U_MEDUSA);
constexpr UnitMask M_RANGED_MYTH = M_CENTAUR | M_MEDUSA;
const char *const CLASSICAL_GODS[] = { "athena", "hermes", "ares", "pan", nullptr };
const char *const HEROIC_GODS[] = { "apollo", "dionysus", "aphrodite", "hestia", nullptr };
const char *const MYTHIC_GODS[] = { "artemis", "hera", "hephaestus", "demeter", "persephone", nullptr };
std::string lower(std::string s) {
	for (char &c : s) c = (char)std::tolower((unsigned char)c);
	return s;
}
} // namespace

const char *const *minor_gods(int age) {
	static const char *const none[] = { nullptr };
	return age == 1 ? CLASSICAL_GODS : age == 2 ? HEROIC_GODS : age == 3 ? MYTHIC_GODS : none;
}

const char *tech_state_name(int s) {
	static const char *n[] = { "available", "locked_age", "locked_prereq", "locked_god", "researching", "queued", "done", "unavailable" };
	return s >= 0 && s <= TS_UNAVAILABLE ? n[s] : "?";
}

const TechDef &tech_def(int t) {
	// Retold values (reference/techs/TECHS.md). Cost F / W / G / Fv.
	// clang-format off
	static const TechDef T[T_COUNT] = {
		// ---- Armory: generic line -------------------------------------------------------------
		{ "copper_weapons", "Copper Weapons", TH_ARMORY, -1, 1, Cost(100, 0, 100, 0), 30, -1, nullptr, false,
			{ E(TE_ATTACK, M_HUMAN | M_HERO, true, 0.10), N, N, N }, nullptr,
			"+10% attack: human soldiers, heroes, buildings", "buildings = the Town Center's and towers' arrows" },
		{ "bronze_weapons", "Bronze Weapons", TH_ARMORY, -1, 2, Cost(200, 0, 200, 0), 40, T_COPPER_WEAPONS, nullptr, false,
			{ E(TE_ATTACK, M_HUMAN | M_HERO, true, 0.10), N, N, N }, nullptr,
			"+10% attack: human soldiers, heroes, buildings", "additive with Copper: +20% of base" },
		{ "iron_weapons", "Iron Weapons", TH_ARMORY, -1, 3, Cost(450, 0, 450, 0), 50, T_BRONZE_WEAPONS, nullptr, false,
			{ E(TE_ATTACK, M_HUMAN | M_HERO, true, 0.10), N, N, N }, nullptr,
			"+10% attack: human soldiers, heroes, buildings", "additive: +30% of base with all three" },
		{ "copper_armor", "Copper Armor", TH_ARMORY, -1, 1, Cost(75, 0, 75, 0), 30, -1, nullptr, false,
			{ E(TE_HACK_ARMOR, M_HUMAN, false, 0.10), E(TE_HACK_ARMOR, M_HERO, false, 0.15), N, N }, nullptr,
			"Human soldiers -10% hack vulnerability, heroes -15%",
			"hack = melee blows; +0.10 / +0.15 on the unit's armor fraction vs them (ships: none here)" },
		{ "bronze_armor", "Bronze Armor", TH_ARMORY, -1, 2, Cost(200, 0, 150, 0), 40, T_COPPER_ARMOR, nullptr, false,
			{ E(TE_HACK_ARMOR, M_HUMAN, false, 0.10), E(TE_HACK_ARMOR, M_HERO, false, 0.15), N, N }, nullptr,
			"Human soldiers -10% hack vulnerability, heroes -15%", "stacks" },
		{ "iron_armor", "Iron Armor", TH_ARMORY, -1, 3, Cost(400, 0, 400, 0), 50, T_BRONZE_ARMOR, nullptr, false,
			{ E(TE_HACK_ARMOR, M_HUMAN, false, 0.10), E(TE_HACK_ARMOR, M_HERO, false, 0.15), N, N }, nullptr,
			"Human soldiers -10% hack vulnerability, heroes -15%", "stacks" },
		{ "copper_shields", "Copper Shields", TH_ARMORY, -1, 1, Cost(0, 75, 75, 0), 30, -1, nullptr, false,
			{ E(TE_PIERCE_ARMOR, M_HUMAN, false, 0.10), E(TE_PIERCE_ARMOR, M_HERO, false, 0.15), N, N }, nullptr,
			"Human soldiers -10% pierce vulnerability, heroes -15%",
			"pierce = arrows (units' and buildings'); +0.10 / +0.15 armor vs them" },
		{ "bronze_shields", "Bronze Shields", TH_ARMORY, -1, 2, Cost(0, 200, 150, 0), 40, T_COPPER_SHIELDS, nullptr, false,
			{ E(TE_PIERCE_ARMOR, M_HUMAN, false, 0.10), E(TE_PIERCE_ARMOR, M_HERO, false, 0.15), N, N }, nullptr,
			"Human soldiers -10% pierce vulnerability, heroes -15%", "stacks" },
		{ "iron_shields", "Iron Shields", TH_ARMORY, -1, 3, Cost(0, 400, 350, 0), 50, T_BRONZE_SHIELDS, nullptr, false,
			{ E(TE_PIERCE_ARMOR, M_HUMAN, false, 0.10), E(TE_PIERCE_ARMOR, M_HERO, false, 0.15), N, N }, nullptr,
			"Human soldiers -10% pierce vulnerability, heroes -15%", "stacks" },
		{ "ballistics", "Ballistics", TH_ARMORY, -1, 1, Cost(0, 150, 150, 0), 50, -1, nullptr, false,
			{ E(TE_TRACK, M_TOXOTES | M_EG_RANGED, true, 3), N, N, N }, nullptr,
			"Ranged soldiers and buildings lead their shots: +3 track rating",
			"with the rules on, arrows of toxotes, towers and Town Centers follow a moving target only ARROW_TRACK_BASE (1) tile "
			"from where it stood when loosed and miss beyond it; Ballistics adds 3 tiles (myth units' and heroes' arrows home)" },
		{ "burning_pitch", "Burning Pitch", TH_ARMORY, -1, 3, Cost(0, 500, 300, 0), 40, -1, nullptr, false,
			{ E(TE_VS_BUILDINGS, M_TOXOTES | M_EG_RANGED | M_RANGED_MYTH, false, 3.0), N, N, N }, nullptr,
			"Ranged soldiers +3.0x damage vs buildings (Centaur, Medusa too)",
			"the damage multiplier vs buildings goes 1 -> 4 (on top of the building's armor: x0.35, or Retold's 90 % pierce on an Armory / Market / Temple); ships: none here" },
		// ---- Armory: Greek god techs ----------------------------------------------------------------
		{ "phobos_spear_of_panic", "Phobos' Spear of Panic", TH_ARMORY, B_BARRACKS, 1, Cost(100, 0, 0, 15), 40, -1, "ares", false,
			{ E(TE_DIVINE, M_HOPLITE, false, 1), N, N, N }, nullptr,
			"+1 divine attack: Hoplite (Prodromos, Militia)", "+1 damage per blow that no armor reduces (x0.35 on buildings); Prodromos / Militia: none here" },
		{ "deimos_sword_of_dread", "Deimos' Sword of Dread", TH_ARMORY, B_BARRACKS, 1, Cost(0, 0, 150, 10), 20, -1, "ares", false,
			{ N, N, N, N }, "Hypaspist",
			"Unlocks Hypaspists in the Classical Age, +15% attack", "" },
		{ "enyo_bow_of_horror", "Enyo's Bow of Horror", TH_ARMORY, -1, 1, Cost(0, 125, 0, 12), 20, -1, "ares", false,
			{ E(TE_ATTACK, M_TOXOTES, false, 0.10), E(TE_ARROW_SPEED, M_TOXOTES, true, 0.5), N, N }, nullptr,
			"Toxotes +10% attack; arrow-firing units and buildings +20 projectile speed (40 -> 60)",
			"projectile speed x1.5: the flight's distance term is divided by 1.5" },
		{ "sarissa", "Sarissa", TH_ARMORY, B_BARRACKS, 1, Cost(0, 125, 0, 20), 40, -1, "athena", false,
			{ E(TE_ATTACK, M_HOPLITE, false, 0.10), E(TE_RANGE, M_HOPLITE, false, 0.5 * D, 0.5), N, N }, nullptr,
			"Hoplites +10% hack attack and +0.5 range", "hoplite blows are hack: +10% attack; range +0.5 x DIST_SCALE = +0.3 tiles" },
		{ "aegis_shield", "Aegis Shield", TH_ARMORY, B_BARRACKS, 1, Cost(0, 200, 0, 20), 40, -1, "athena", false,
			{ E(TE_PIERCE_ARMOR, M_HOPLITE, false, 0.15), N, N, N }, nullptr,
			"Infantry -15% pierce vulnerability", "infantry = the hoplite (Hypaspist, Myrmidon: none here)" },
		{ "sun_ray", "Sun Ray", TH_ARMORY, -1, 2, Cost(100, 0, 0, 20), 30, -1, "apollo", false,
			{ E(TE_ATTACK, M_TOXOTES | M_RANGED_MYTH, false, 0.15), E(TE_REVEAL, M_TOXOTES | M_RANGED_MYTH, false, REVEAL_RADIUS), N, N }, nullptr,
			"+15% ranged attack; projectiles +20 LOS and reveal an area where they land for 6 s",
			"toxotes, Centaur, Medusa (the hero here is melee); an arrow that hits reveals Retold's area 25 x DIST_SCALE = 15 tiles round the target for 6 s (a hit within 3 tiles of a live reveal renews it); +20 projectile LOS: the reveal" },
		{ "shafts_of_plague", "Shafts of Plague", TH_ARMORY, -1, 3, Cost(0, 0, 300, 30), 40, -1, "artemis", false,
			{ E(TE_ATTACK, M_TOXOTES, false, 0.10), E(TE_POISON, M_TOXOTES, false, POISON_DPS), N, N }, nullptr,
			"Ranged soldiers +10% attack; projectiles poison 0.25 divine damage/s for 6 s", "poison ignores armor; a new hit restarts the 6 s" },
		{ "forge_of_olympus", "Forge of Olympus", TH_ARMORY, -1, 3, Cost(0, 0, 300, 30), 5, -1, "hephaestus", false,
			{ E(TE_ARMORY_DISCOUNT, 0, false, 0.75), N, N, N }, nullptr,
			"All Armory techs -75% food / wood / gold cost and +50% Armory research speed", "" },
		{ "olympian_weapons", "Olympian Weapons", TH_ARMORY, -1, 3, Cost(0, 0, 300, 20), 40, -1, "hephaestus", false,
			{ E(TE_ATTACK, M_HOPLITE | M_HIPPIKON | M_TOXOTES, false, 0.20), E(TE_VS_MYTH, M_HOPLITE | M_HIPPIKON | M_TOXOTES, false, 1.0), N, N }, nullptr,
			"Myrmidon, Hetairos, Gastraphetes: +20% attack and +1x vs myth units",
			"mapped onto this game's counterparts: Myrmidon -> hoplite, Hetairos -> hippikon, Gastraphetes -> toxotes" },
		{ "harvest_of_souls", "Harvest of Souls", TH_ARMORY, B_BARRACKS, 3, Cost(150, 0, 150, 25), 40, -1, "persephone", false,
			{ E(TE_FRENZY, M_HOPLITE, false, FRENZY_TIME), N, N, N }, nullptr,
			"Hoplite, Hypaspist: for 5 s after a kill +15% damage and -20% reload (no stack)", "Hypaspist: none here" },
		// ---- Market --------------------------------------------------------------------------------
		{ "tax_collectors", "Tax Collectors", TH_MARKET, -1, 2, Cost(200, 0, 200, 0), 35, -1, nullptr, false,
			{ E(TE_MARKET_FEE, 0, false, -0.075), E(TE_TRIBUTE_FEE, 0, false, -0.10), N, N }, nullptr,
			"Market fee 30% -> 22.5%; tribute fee 20% -> 10%", "" },
		{ "ambassadors", "Ambassadors", TH_MARKET, -1, 3, Cost(0, 0, 250, 0), 30, T_TAX_COLLECTORS, nullptr, false,
			{ E(TE_MARKET_FEE, 0, false, -0.075), E(TE_TRIBUTE_FEE, 0, false, -0.10), N, N }, nullptr,
			"Market fee 22.5% -> 15%; tribute fee 10% -> 0", "" },
		{ "coinage", "Coinage", TH_MARKET, -1, 3, Cost(0, 0, 200, 0), 40, -1, nullptr, false,
			{ N, N, N, N }, "Caravan",
			"+20% movement speed for Caravans", "" },
		// ---- Temple --------------------------------------------------------------------------------
		{ "omniscience", "Omniscience", TH_TEMPLE, -1, 3, Cost(), 4, -1, nullptr, false,
			{ E(TE_OMNISCIENCE, 0, false, 1), N, N, N }, nullptr,
			"Line of sight of every enemy unit and building; costs 100 gold x the enemies' total population",
			"the price is taken when it is queued; the fog stamps every enemy's sight for the owner and his allies" },
		{ "olympian_parentage", "Olympian Parentage", TH_TEMPLE, -1, 0, Cost(100, 0, 0, 10), 40, -1, "zeus", true,
			{ E(TE_HP, M_HERO, false, 0.25), E(TE_REGEN, M_HERO, false, 1), N, N }, nullptr,
			"Heroes +25% hp and +1 hp/s regeneration", "" },
		{ "labyrinth_of_minos", "Labyrinth of Minos", TH_TEMPLE, -1, 1, Cost(0, 250, 0, 20), 30, -1, "athena", false,
			{ E(TE_HP, M_MINO, false, 0.35), E(TE_SPEED, M_MINO, false, 0.15), N, N }, nullptr,
			"Minotaur -> Bull Minotaur: +35% hp, +15% speed", "" },
		{ "winged_messenger", "Winged Messenger", TH_TEMPLE, -1, 1, Cost(0, 0, 50, 3), 30, -1, "hermes", false,
			{ N, N, N, N }, "Pegasus",
			"Pegasus +6 LOS, +20% speed, a free Pegasus", "" },
		{ "sylvan_lore", "Sylvan Lore", TH_TEMPLE, -1, 1, Cost(0, 250, 0, 18), 40, -1, "hermes", false,
			{ E(TE_HP, M_CENTAUR, false, 0.35), E(TE_RANGE, M_CENTAUR, false, 3 * D, 3), E(TE_SIGHT, M_CENTAUR, false, 1 * D, 1), N }, nullptr,
			"Centaur -> Centaur Polemarch: +35% hp, +3 range, +1 LOS", "range / LOS x DIST_SCALE: +1.8 / +0.6 tiles" },
		{ "will_of_kronos", "Will of Kronos", TH_TEMPLE, -1, 1, Cost(0, 0, 150, 10), 40, -1, "ares", false,
			{ E(TE_SPLASH, M_CYCLOPS, false, 1.5 * D, 1.5), N, N, N }, nullptr,
			"Cyclops -> Elder Cyclops: melee area damage +1.5 radius", "splash radius +0.9 tiles (x DIST_SCALE); the thrown-unit area: Cyclops do not throw here" },
		{ "call_of_lykaion", "Call of Lykaion", TH_TEMPLE, -1, 1, Cost(200, 0, 0, 14), 30, -1, "pan", false,
			{ N, N, N, N }, "Lykaon",
			"Lykaon -> Alpha Lykaon +25% attack; a Lykaon per Town Center", "" },
		{ "hymn_of_the_wildwood", "Hymn of the Wildwood", TH_TEMPLE, -1, 1, Cost(0, 0, 150, 20), 40, -1, "pan", false,
			{ E(TE_HEAL_AURA, M_HERO, false, 0.75), N, N, N }, nullptr,
			"Heroes heal nearby units 0.75 hp/s in radius 5", "radius 3 tiles (x DIST_SCALE); the owner's units, the hero himself too" },
		{ "oracle", "Oracle", TH_TEMPLE, -1, 2, Cost(0, 75, 0, 10), 30, -1, "apollo", false,
			{ E(TE_SIGHT, M_ALL, true, 5 * D, 5), E(TE_QUEUE_VIEW, 0, false, 1), N, N }, nullptr,
			"All units and buildings +5 LOS; enemy queues visible", "+3 tiles of sight (x DIST_SCALE); queue_view is for the UI" },
		{ "temple_of_healing", "Temple of Healing", TH_TEMPLE, -1, 2, Cost(0, 0, 75, 12), 30, -1, "apollo", false,
			{ E(TE_TEMPLE_HEAL, 0, false, 15), N, N, N }, nullptr,
			"The Temple heals up to 3 units within 15 at 15 hp/s (half on moving or fighting units)",
			"radius 9 tiles (x DIST_SCALE) from the temple's centre; idle units first, then nearest" },
		{ "golden_apples", "Golden Apples", TH_TEMPLE, B_TOWN_CENTER, 2, Cost(100, 0, 75, 0), 30, -1, "aphrodite", false,
			{ E(TE_FAVOR, M_VILLAGER, false, 0.20), N, N, N }, nullptr,
			"Villagers +20% favor gather rate", "the worship favor rate x1.2" },
		{ "roar_of_orthus", "Roar of Orthus", TH_TEMPLE, -1, 2, Cost(300, 0, 0, 20), 40, -1, "aphrodite", false,
			{ N, N, N, N }, "Nemean Lion",
			"Nemean Lion -> Nemean Rex: Roar radius +100%", "" },
		{ "dionysia", "Dionysia", TH_TEMPLE, -1, 2, Cost(0, 150, 0, 20), 40, -1, "dionysus", false,
			{ E(TE_HP, M_ALL, false, 0.05), N, N, N }, nullptr,
			"All units +5% hp", "" },
		{ "chthonic_rites", "Chthonic Rites", TH_TEMPLE, -1, 2, Cost(0, 0, 100, 25), 25, -1, "dionysus", false,
			{ N, N, N, N }, "Hydra",
			"Hydra and Scylla +4 hp/s regeneration", "" },
		{ "hallowed_woodlands", "Hallowed Woodlands", TH_TEMPLE, -1, 2, Cost(300, 0, 0, 20), 40, -1, "hestia", false,
			{ N, N, N, N }, "Hamadryad",
			"Hamadryad -> Sylvan Hamadryad: +30% hp, +30% ranged attack", "" },
		{ "face_of_the_gorgon", "Face of the Gorgon", TH_TEMPLE, -1, 3, Cost(0, 300, 0, 20), 40, -1, "hera", false,
			{ E(TE_RANGE, M_MEDUSA, false, 5 * D, 5), N, N, N }, nullptr,
			"Medusa -> Medusa Matriarch: +5 range, -25% ability recharge", "+3 tiles (x DIST_SCALE); Medusa has no Petrify ability here" },
		{ "monstrous_rage", "Monstrous Rage", TH_TEMPLE, -1, 3, Cost(250, 0, 0, 25), 30, -1, "hera", false,
			{ E(TE_RELOAD, M_MYTH, false, 0.75), E(TE_SPEED, M_MYTH, false, 0.15), N, N }, nullptr,
			"Myth units -25% rate of fire (+33% attack speed) and +15% speed", "attack cooldown x0.75" },
		{ "hand_of_talos", "Hand of Talos", TH_TEMPLE, -1, 3, Cost(0, 200, 0, 15), 40, -1, "hephaestus", false,
			{ N, N, N, N }, "Colossus",
			"Colossus -> Silver Colossus: +25% hp", "" },
		{ "shoulder_of_talos", "Shoulder of Talos", TH_TEMPLE, -1, 3, Cost(0, 0, 300, 20), 50, T_HAND_OF_TALOS, "hephaestus", false,
			{ N, N, N, N }, "Colossus",
			"Colossus -> Gold Colossus: +30% hp, -20% hack vulnerability", "" },
		{ "flames_of_typhon", "Flames of Typhon", TH_TEMPLE, -1, 3, Cost(300, 0, 0, 20), 40, -1, "artemis", false,
			{ N, N, N, N }, "Chimera",
			"Chimera -> Chimera Tyrant: +40% damage, Blaze", "" },
		{ "enchanted_hymn", "Enchanted Hymn", TH_TEMPLE, -1, 3, Cost(0, 0, 300, 20), 40, -1, "persephone", false,
			{ N, N, N, N }, "Siren",
			"Siren -> Prima Siren: Alluring Aria +50% damage", "" },
		{ "pious_sacrifice", "Pious Sacrifice", TH_TEMPLE, -1, 3, Cost(0, 125, 125, 30), 40, -1, "persephone", false,
			{ E(TE_PIOUS, M_HOPLITE, false, PIOUS_STEP), N, N, N }, nullptr,
			"When an infantry unit dies, human soldiers within 5 get -10% reload for 5 s (stacks to -50%)",
			"infantry = hoplite; radius 3 tiles (x DIST_SCALE); every death adds a stack and restarts the 5 s" },
		{ "iron_grip", "Iron Grip", TH_TEMPLE, -1, 3, Cost(150, 150, 0, 20), 30, -1, "demeter", false,
			{ N, N, N, N }, "Harpy",
			"Harpy -> Nephelean Harpy: +10% speed, Drop", "" },
		// ---- Temple: Egyptian (sim/civ; EGYPT.md 1.6, 6) ------------------------------------------------
		{ "hands_of_the_pharaoh", "Hands of the Pharaoh", TH_TEMPLE, -1, 0, Cost(0, 0, 75, 0), 10, -1, nullptr, false,
			{ E(TE_RANGE, UM(U_PRIEST), false, 3 * D, 3), E(TE_SIGHT, UM(U_PRIEST), false, 3 * D, 3), N, N }, nullptr,
			"Priests +3 range, +3 LOS; they can carry relics and Auto Scout",
			"range / LOS +3 x DIST_SCALE = +1.8 tiles; relics and Auto Scout: none here" },
	};
	// clang-format on
	return T[t >= 0 && t < T_COUNT ? t : 0];
}

int tech_of(const char *key) {
	for (int t = 0; t < T_COUNT; t++)
		if (std::strcmp(tech_def(t).key, key) == 0) return t;
	return -1;
}

int tech_home_building(int home) { return home == TH_ARMORY ? B_ARMORY : home == TH_MARKET ? B_MARKET : B_TEMPLE; }

// ---- setup ------------------------------------------------------------------

void Techs::init(Sim *s) {
	sim = s;
	for (int i = 0; i < MAX_PLAYERS; i++) {
		done[i] = 0;
		mods[i] = TechMods();
		for (auto &g : minor[i]) g.clear();
	}
	for (double &p : price) p = MARKET_BASE;
	reveals.clear();
	heroic_needs_armory = true; // (Retold; set_tech_rules turns it off)
	researched = 0;
	any_heal_ = any_poison_ = false;
	// units trained later get their owner's upgrades
	s->events.on(EV_ENTITY_ADDED, [this](const Event &e) {
		if (!sim->godot_rules || e.kind != K_UNIT) return;
		const int r = sim->entities.unit_slot(e.id);
		if (r < 0) return;
		const int o = sim->entities.units.owner[r];
		if (o <= 0 || o >= MAX_PLAYERS || !done[o]) return;
		apply_unit(r, TechMods(), mods[o]);
	});
	s->events.on(EV_ENTITY_DIED, [this](const Event &e) {
		if (!sim->godot_rules || e.kind != K_UNIT) return;
		on_died(e.id, e.other, e.x, e.z);
	});
}

// ---- state ------------------------------------------------------------------

bool Techs::researches_at(int btype, int t) const {
	const TechDef &d = tech_def(t);
	return btype == tech_home_building(d.home) || (d.also >= 0 && btype == d.also);
}

int Techs::queued_at(int owner, int t, int32_t *building, int *index) const {
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || B.owner[b] != owner) continue;
		const TechQueue &q = B.tech_queue[b];
		for (size_t i = 0; i < q.size(); i++)
			if (q[i].tech == t) {
				if (building) *building = B.id[b];
				if (index) *index = (int)i;
				return i == 0 ? 1 : 2;
			}
	}
	return 0;
}

int Techs::state(int owner, int t, std::string *reason) const {
	auto why = [&](const std::string &s) { if (reason) *reason = s; };
	why("");
	if (t < 0 || t >= T_COUNT || owner <= 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists) {
		why("Unknown technology");
		return TS_UNAVAILABLE;
	}
	const TechDef &d = tech_def(t);
	if (is_done(owner, t)) { why("Already researched"); return TS_DONE; }
	const int q = queued_at(owner, t);
	if (q) { why("Already being researched"); return q == 1 ? TS_RESEARCHING : TS_QUEUED; }
	if (!sim->godot_rules) { why("Not in this game"); return TS_UNAVAILABLE; }
	if (d.missing) { why(std::string("No ") + d.missing + " in this game"); return TS_UNAVAILABLE; }
	const Player &p = sim->players[owner];
	{ // (sim/civ) a civ's techs: the Greek god techs and Temple techs are the Greeks', Hands of the Pharaoh the Egyptians'
		const int tc = t == T_HANDS_OF_THE_PHARAOH ? CIV_EGYPT : (d.god || d.home == TH_TEMPLE) ? CIV_GREEK : -1;
		if (tc >= 0 && tc != p.civ) { why(std::string("Not a technology of the ") + civ_name(p.civ)); return TS_UNAVAILABLE; }
	}
	if (d.god) {
		if (d.major) {
			if (lower(p.god) != d.god) { why(std::string("Requires ") + (char)std::toupper(d.god[0]) + (d.god + 1)); return TS_LOCKED_GOD; }
		} else {
			const std::string &m = minor[owner][d.age];
			if (!m.empty() && m != d.god) { why(std::string("Requires the minor god ") + (char)std::toupper(d.god[0]) + (d.god + 1)); return TS_LOCKED_GOD; }
		}
	}
	if (p.age < d.age) { why(std::string("Requires ") + AGES[d.age] + " Age"); return TS_LOCKED_AGE; }
	if (d.requires >= 0 && !is_done(owner, d.requires)) { why(std::string("Requires ") + tech_def(d.requires).name); return TS_LOCKED_PREREQ; }
	return TS_AVAILABLE;
}

int Techs::pop_of_enemies(int owner) const {
	const UnitStore &U = sim->entities.units;
	int n = 0;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && sim->is_enemy(owner, U.owner[r])) n += unit_def(U.type[r]).pop;
	return n;
}

Cost Techs::cost_for(int owner, int t) const {
	const TechDef &d = tech_def(t);
	if (t == T_OMNISCIENCE) return Cost(0, 0, 100.0 * pop_of_enemies(owner), 0);
	Cost c = d.cost;
	if (d.home == TH_ARMORY && owner > 0 && owner < MAX_PLAYERS && mods[owner].armory_discount)
		for (int k = 0; k < RES_FAVOR; k++) c.v[k] *= 0.25; // (favor unchanged)
	return c;
}

double Techs::time_for(int, int t) const { return tech_def(t).time; }

// ---- research -----------------------------------------------------------------

TechResult Techs::research(int32_t id, int t) {
	TechResult r;
	if (!sim->godot_rules) { r.reason = "Not in this game"; return r; }
	if (t < 0 || t >= T_COUNT) { r.reason = "Unknown technology"; return r; }
	Entities &E = sim->entities;
	BuildingStore &B = E.buildings;
	const int b = E.building_slot(id);
	if (b < 0 || B.removed[b] || B.dead[b] || !B.built[b]) { r.reason = "Cannot research here"; return r; }
	const TechDef &d = tech_def(t);
	if (!researches_at(B.type[b], t)) {
		r.reason = std::string("Research it at the ") + building_def(tech_home_building(d.home)).name;
		return r;
	}
	if ((int)B.tech_queue[b].size() >= TECH_QUEUE_MAX) { r.reason = "Queue full"; return r; }
	const int owner = B.owner[b];
	std::string why;
	const int s = state(owner, t, &why);
	if (s != TS_AVAILABLE) { r.reason = why; return r; }
	const Cost c = cost_for(owner, t);
	Player &p = sim->players[owner];
	if (!p.pay(c)) { r.reason = "Not enough resources"; return r; }
	TechItem it;
	it.tech = (uint8_t)t;
	it.total = time_for(owner, t);
	for (int k = 0; k < RES_COUNT; k++) it.paid[k] = c.has[k] ? c.v[k] : 0;
	B.tech_queue[b].push_back(it);
	Event e;
	e.type = EV_RESOURCES_CHANGED;
	e.owner = owner;
	sim->events.emit(e);
	r.ok = true;
	return r;
}

bool Techs::cancel(int32_t id, int index) {
	Entities &E = sim->entities;
	BuildingStore &B = E.buildings;
	const int b = E.building_slot(id);
	if (b < 0 || B.removed[b]) return false;
	TechQueue &q = B.tech_queue[b];
	if (q.empty()) return false;
	if (index < 0) index = (int)q.size() - 1;
	if (index >= (int)q.size()) return false;
	Player &p = sim->players[B.owner[b]];
	for (int k = 0; k < RES_COUNT; k++) p.res[k] += q[index].paid[k];
	q.erase(q.begin() + index);
	Event e;
	e.type = EV_RESOURCES_CHANGED;
	e.owner = B.owner[b];
	sim->events.emit(e);
	return true;
}

bool Techs::training_paused(int b) const {
	return sim->godot_rules && !sim->entities.buildings.tech_queue[b].empty();
}

void Techs::grant(int owner, int t) {
	if (owner <= 0 || owner >= MAX_PLAYERS || t < 0 || t >= T_COUNT || is_done(owner, t)) return;
	done[owner] |= 1ull << t;
	recompute(owner);
}

TechResult Techs::set_minor_god(int owner, int age, const std::string &god) {
	TechResult r;
	if (owner <= 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists) { r.reason = "No such player"; return r; }
	if (age < 1 || age > 3) { r.reason = "Minor gods are chosen for the Classical, Heroic and Mythic Ages"; return r; }
	const std::string g = lower(god);
	if (!g.empty()) {
		bool ok = false;
		for (const char *const *m = minor_gods(age); *m; m++)
			if (g == *m) ok = true;
		if (!ok) { r.reason = "Not a minor god of the " + std::string(AGES[age]) + " Age"; return r; }
	}
	minor[owner][age] = g;
	r.ok = true;
	return r;
}

void Techs::finish(int b, int t) {
	BuildingStore &B = sim->entities.buildings;
	const int owner = B.owner[b];
	done[owner] |= 1ull << t;
	researched++;
	recompute(owner);
	Event e;
	e.type = EV_TECH_RESEARCHED;
	e.kind = K_BUILDING;
	e.id = B.id[b];
	e.owner = owner;
	e.a = TECH_EVENT_BASE + t;
	e.x = B.x[b];
	e.z = B.z[b];
	sim->events.emit(e);
}

// ---- modifiers ------------------------------------------------------------------

void Techs::recompute(int owner) {
	const TechMods old = mods[owner];
	TechMods m;
	for (int t = 0; t < T_COUNT; t++) {
		if (!is_done(owner, t)) continue;
		for (const TechEffect &f : tech_def(t).eff) {
			for (int u = 0; u < U_TYPE_COUNT; u++) {
				if (!((f.units >> u) & 1)) continue;
				switch (f.kind) {
					case TE_ATTACK: m.attack[u] += f.v; break;
					case TE_HACK_ARMOR: m.hack[u] += f.v; break;
					case TE_PIERCE_ARMOR: m.pierce[u] += f.v; break;
					case TE_HP: m.hp[u] += f.v; break;
					case TE_SPEED: m.speed[u] += f.v; break;
					case TE_RANGE: m.range[u] += f.v; break;
					case TE_SIGHT: m.sight[u] += f.v; break;
					case TE_REGEN: m.regen[u] += f.v; break;
					case TE_RELOAD: m.reload[u] *= f.v; break;
					case TE_SPLASH: m.splash[u] += f.v; break;
					case TE_DIVINE: m.divine[u] += f.v; break;
					case TE_VS_BUILDINGS: m.vs_buildings[u] += f.v; break;
					case TE_VS_MYTH: m.vs_myth[u] += f.v; break;
					case TE_ARROW_SPEED: m.arrow_speed[u] += f.v; break;
					case TE_TRACK: m.track[u] += f.v; break;
					case TE_POISON: m.poison[u] = true; break;
					case TE_FRENZY: m.frenzy[u] = true; break;
					case TE_REVEAL: m.reveal[u] = true; break;
					default: break;
				}
			}
			switch (f.kind) {
				case TE_ATTACK: if (f.buildings) m.b_attack += f.v; break;
				case TE_ARROW_SPEED: if (f.buildings) m.b_arrow_speed += f.v; break;
				case TE_TRACK: if (f.buildings) m.b_track += f.v; break;
				case TE_SIGHT: if (f.buildings) m.b_sight += f.v; break;
				case TE_PIOUS: m.pious = true; break;
				case TE_HEAL_AURA: m.heal_aura += f.v; break;
				case TE_TEMPLE_HEAL: m.temple_heal += f.v; break;
				case TE_FAVOR: m.favor += f.v; break;
				case TE_MARKET_FEE: m.market_fee += f.v; break;
				case TE_TRIBUTE_FEE: m.tribute_fee += f.v; break;
				case TE_OMNISCIENCE: m.omniscience = true; break;
				case TE_QUEUE_VIEW: m.queue_view = true; break;
				case TE_ARMORY_DISCOUNT: m.armory_discount = true; break;
				default: break;
			}
		}
	}
	mods[owner] = m;
	UnitStore &U = sim->entities.units;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.owner[r] == owner) apply_unit(r, old, m);
	any_heal_ = false;
	for (int o = 1; o < MAX_PLAYERS; o++) {
		const TechMods &k = mods[o];
		if (k.heal_aura > 0 || k.temple_heal > 0) any_heal_ = true;
		for (int u = 0; u < U_TYPE_COUNT; u++)
			if (k.regen[u] > 0) any_heal_ = true;
	}
}

// re-base a unit's hp / speed / sight from the modifiers `old` to `cur`
void Techs::apply_unit(int r, const TechMods &old, const TechMods &cur) {
	UnitStore &U = sim->entities.units;
	const int t = U.type[r];
	if (cur.hp[t] != old.hp[t]) {
		const double k = (1 + cur.hp[t]) / (1 + old.hp[t]);
		U.max_hp[r] *= k;
		U.hp[r] *= k;
	}
	if (cur.speed[t] != old.speed[t]) U.speed[r] *= (1 + cur.speed[t]) / (1 + old.speed[t]);
	if (cur.sight[t] != old.sight[t]) U.sight[r] += cur.sight[t] - old.sight[t];
}

double Techs::unit_damage(int r) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[r], o = U.owner[r];
	double d = sim->civs.base_damage(r) * (1 + mods[o].attack[t]); // (sim/civ: Priest / Pharaoh by age; else the def's)
	if (mods[o].frenzy[t] && U.tech_frenzy_t[r] >= sim->time) d *= FRENZY_DAMAGE;
	return d;
}

double Techs::reload_mult(int r) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[r], o = U.owner[r];
	double k = mods[o].reload[t];
	if (mods[o].frenzy[t] && U.tech_frenzy_t[r] >= sim->time) k *= FRENZY_RELOAD;
	if (U.tech_pious_n[r] && U.tech_pious_t[r] >= sim->time) k *= 1 - PIOUS_STEP * U.tech_pious_n[r];
	return k;
}

double Techs::range_add(int r) const {
	const UnitStore &U = sim->entities.units;
	const double h = is_egypt_unit(U.type[r]) ? sim->civs.range_add(r) : 0; // (sim/civ: Priest / Pharaoh by age)
	return mods[U.owner[r]].range[U.type[r]] + h;
}

double Techs::splash_add(int r) const {
	const UnitStore &U = sim->entities.units;
	return mods[U.owner[r]].splash[U.type[r]];
}

// arrows are pierce; blows of units (and splash) are hack; god powers neither
double Techs::unit_armor(int tr, const Hitter &a, uint8_t kind) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[tr], o = U.owner[tr];
	double armor = unit_def(t).armor;
	if (a.kind == 0 && kind != DK_ARROW) return armor; // (god powers; an arrow whose shooter is gone is still an arrow)
	bool arrow = kind == DK_ARROW || a.kind == K_BUILDING;
	if (!arrow && a.kind == K_UNIT && a.row >= 0 && a.row < U.size()) arrow = unit_def(U.type[a.row]).attack.projectile;
	if (arrow && is_egypt_unit(t)) armor = sim->civs.base_pierce(tr); // (sim/civ: Egyptian units have a hack and a pierce armor)
	const double add = arrow ? mods[o].pierce[t] : mods[o].hack[t];
	if (add == 0) return armor;
	return std::min(ARMOR_CAP, armor + add);
}

// the extra factor on a hit from unit row ar on (kind, row): multipliers
// add, as in Retold (Olympian Weapons: x1.5 vs myth becomes x2.5)
double Techs::vs_mult(int ar, int tk, int tr) const {
	const UnitStore &U = sim->entities.units;
	const int at = U.type[ar], o = U.owner[ar];
	if (tk == K_BUILDING) return 1 + mods[o].vs_buildings[at];
	if (tk == K_UNIT && mods[o].vs_myth[at] != 0 && unit_def(U.type[tr]).cls == CLS_MYTH) {
		const double base = unit_def(at).bonus[CLS_MYTH] != 0 ? unit_def(at).bonus[CLS_MYTH] : 1;
		return (base + mods[o].vs_myth[at]) / base;
	}
	return 1;
}

double Techs::divine(int ar) const {
	const UnitStore &U = sim->entities.units;
	return mods[U.owner[ar]].divine[U.type[ar]];
}

double Techs::arrow_speed(const Hitter &a) const {
	if (a.owner <= 0 || a.owner >= MAX_PLAYERS) return 1;
	if (a.kind == K_BUILDING) return 1 + mods[a.owner].b_arrow_speed;
	if (a.kind == K_UNIT) return 1 + mods[a.owner].arrow_speed[sim->entities.units.type[a.row]];
	return 1;
}

double Techs::arrow_track(const Hitter &a) const {
	if (a.owner <= 0 || a.owner >= MAX_PLAYERS) return -1;
	if (a.kind == K_BUILDING) return ARROW_TRACK_BASE + mods[a.owner].b_track;
	if (a.kind == K_UNIT) {
		const int t = sim->entities.units.type[a.row];
		const UnitDef &d = unit_def(t);
		if (d.myth || d.hero || d.cls == CLS_VILLAGER) return -1; // (myth units' / heroes' shots home)
		return ARROW_TRACK_BASE + mods[a.owner].track[t];
	}
	return -1;
}

void Techs::on_arrow_hit(const Hitter &a, int tr) {
	if (a.kind != K_UNIT || a.owner <= 0 || a.owner >= MAX_PLAYERS) return;
	UnitStore &U = sim->entities.units;
	if (a.row < 0 || a.row >= U.size()) return;
	const int at = U.type[a.row];
	const TechMods &m = mods[a.owner];
	if (m.poison[at] && !U.dead[tr]) {
		U.tech_poison_t[tr] = POISON_TIME;
		U.tech_poison_by[tr] = (uint8_t)a.owner;
		any_poison_ = true;
	}
	if (m.reveal[at]) {
		// a hit within REVEAL_MERGE of a live reveal of his renews it (a volley
		// on one fight is one 15-tile reveal, not twenty)
		for (Reveal &v : reveals)
			if (v.owner == a.owner && (v.x - U.x[tr]) * (v.x - U.x[tr]) + (v.z - U.z[tr]) * (v.z - U.z[tr]) < REVEAL_MERGE * REVEAL_MERGE) {
				v.until = sim->time + REVEAL_TIME;
				return;
			}
		reveals.push_back({ a.owner, U.x[tr], U.z[tr], REVEAL_RADIUS, sim->time + REVEAL_TIME });
	}
}

const char *myth_unit_god(int type) {
	switch (type) {
		case U_MINOTAUR: return "athena";
		case U_CYCLOPS: return "ares";
		case U_CENTAUR: return "hermes";
		case U_MEDUSA: return "hera";
		default: return nullptr;
	}
}

int rules_min_age(int type) { return type == U_MEDUSA ? 3 : unit_def(type).min_age; }

bool rules_trains(int building_type, int type) {
	if (building_type == B_TEMPLE) {
		for (const int *t = RULES_TEMPLE_TRAINS; *t >= 0; t++)
			if (*t == type) return true;
		return false;
	}
	return building_type >= 0 && building_type < B_TYPE_COUNT && building_def(building_type).trains_type(type);
}

bool Techs::god_allows_unit(int owner, int type, std::string *reason) const {
	const char *g = myth_unit_god(type);
	if (!g || owner <= 0 || owner >= MAX_PLAYERS) return true;
	const std::string &m = minor[owner][rules_min_age(type)];
	if (m.empty() || m == g) return true;
	if (reason) *reason = std::string("Requires the minor god ") + (char)std::toupper(g[0]) + (g + 1);
	return false;
}

double Techs::building_armor_mult(const Hitter &a, uint8_t kind, int btype) const {
	// the attack's type, as Fortify::armor_mult reads it: arrows (and every
	// building's shot) pierce, myth units and god powers crush, the rest hack
	const Entities &E = sim->entities;
	bool arrow = kind == DK_ARROW || a.kind == K_BUILDING, myth = a.myth_class, pseudo = a.kind == 0;
	if (a.kind == K_UNIT && a.row >= 0 && a.row < E.units.size()) {
		const UnitDef &d = unit_def(E.units.type[a.row]);
		arrow = arrow || d.attack.projectile;
		myth = myth || d.cls == CLS_MYTH;
	}
	const CivArmor ar = civ_building_armor(btype); // (sim/civ: the Egyptian buildings' own Retold armor)
	if (myth || (pseudo && !arrow)) return 1 - ar.crush;
	return 1 - (arrow ? ar.pierce : ar.hack);
}

bool Techs::omniscient(int fog_owner) const {
	for (int o = 1; o < MAX_PLAYERS; o++)
		if (mods[o].omniscience && sim->players[o].exists && sim->is_ally(fog_owner, o)) return true;
	return false;
}

UnitStats Techs::stats(int r) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[r], o = U.owner[r];
	const UnitDef &d = unit_def(t);
	const bool on = sim->godot_rules;
	const TechMods &m = mods[o];
	UnitStats s;
	s.damage = on ? unit_damage(r) : d.attack.damage;
	s.hp = U.hp[r];
	s.max_hp = U.max_hp[r];
	s.speed = U.speed[r];
	s.range = (d.has_attack ? d.attack.range : 0.5) + (on ? range_add(r) : 0);
	s.sight = U.sight[r];
	s.hack_armor = on ? std::min(ARMOR_CAP, d.armor + m.hack[t]) : d.armor;
	s.pierce_armor = on ? std::min(ARMOR_CAP, (is_egypt_unit(t) ? sim->civs.base_pierce(r) : d.armor) + m.pierce[t]) : d.armor;
	s.reload = d.attack.cooldown * (on ? reload_mult(r) : 1);
	s.splash = d.attack.splash + (on ? m.splash[t] : 0);
	s.divine = on ? m.divine[t] : 0;
	s.regen = on ? m.regen[t] : 0;
	s.vs_buildings = on ? 1 + m.vs_buildings[t] : 1;
	s.vs_myth = (d.bonus[CLS_MYTH] != 0 ? d.bonus[CLS_MYTH] : 1) + (on ? m.vs_myth[t] : 0);
	if (!d.attack.projectile) s.track = -1;
	else {
		Hitter h;
		h.kind = K_UNIT;
		h.row = r;
		h.owner = o;
		s.track = on ? arrow_track(h) : -1;
	}
	s.arrow_speed = on ? 1 + m.arrow_speed[t] : 1;
	return s;
}

// ---- deaths: Harvest of Souls, Pious Sacrifice ---------------------------------------

void Techs::on_died(int32_t id, int32_t killer, double x, double z) {
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const int v = E.unit_slot(id);
	if (v < 0) return;
	const int vo = U.owner[v];
	// the killer's frenzy
	const int k = killer ? E.unit_slot(killer) : -1;
	if (k >= 0 && !U.dead[k]) {
		const int ko = U.owner[k];
		if (ko > 0 && ko < MAX_PLAYERS && mods[ko].frenzy[U.type[k]] && sim->is_enemy(ko, vo)) U.tech_frenzy_t[k] = sim->time + FRENZY_TIME;
	}
	// an infantry death steadies the soldiers round it
	if (vo > 0 && vo < MAX_PLAYERS && mods[vo].pious && ((M_HOPLITE >> U.type[v]) & 1)) {
		sim->movement.hash.for_each_near(x, z, PIOUS_RADIUS, [&](int o) {
			if (o >= U.size() || U.removed[o] || U.dead[o] || o == v || U.owner[o] != vo || !((M_HUMAN >> U.type[o]) & 1)) return;
			if (jsm::hypot(U.x[o] - x, U.z[o] - z) > PIOUS_RADIUS) return;
			if (U.tech_pious_t[o] < sim->time) U.tech_pious_n[o] = 0;
			U.tech_pious_n[o] = (uint8_t)std::min(PIOUS_MAX, U.tech_pious_n[o] + 1);
			U.tech_pious_t[o] = sim->time + PIOUS_TIME;
		});
	}
}

// ---- market -----------------------------------------------------------------------

double Techs::fee(int owner) const {
	const double f = MARKET_FEE + (owner > 0 && owner < MAX_PLAYERS ? mods[owner].market_fee : 0);
	return std::max(0.0, f);
}

double Techs::tribute_fee(int owner) const {
	const double f = TRIBUTE_FEE + (owner > 0 && owner < MAX_PLAYERS ? mods[owner].tribute_fee : 0);
	return std::max(0.0, f);
}

double Techs::buy_price(int owner, int res) const {
	if (!market_tradable(res)) return 0;
	return std::floor(price[res] * (1 + fee(owner)) + 1e-9); // (Retold's readout truncates: 130 / 122 / 115)
}

double Techs::sell_price(int owner, int res) const {
	if (!market_tradable(res)) return 0;
	return std::floor(price[res] * (1 - fee(owner)) + 1e-9); // (70 / 77 / 85)
}

bool Techs::has_market(int owner) const {
	const BuildingStore &B = sim->entities.buildings;
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && !B.dead[b] && B.built[b] && B.owner[b] == owner && B.type[b] == B_MARKET) return true;
	return false;
}

TradeResult Techs::buy(int32_t id, int res) {
	TradeResult r;
	if (!sim->godot_rules) { r.reason = "Not in this game"; return r; }
	const BuildingStore &B = sim->entities.buildings;
	const int b = sim->entities.building_slot(id);
	if (b < 0 || B.removed[b] || B.dead[b] || !B.built[b] || B.type[b] != B_MARKET) { r.reason = "Trade at a Market"; return r; }
	if (!market_tradable(res)) { r.reason = res == RES_FAVOR ? "Favor cannot be traded" : "Only food and wood are traded"; return r; }
	if ((int)B.tech_queue[b].size() >= TECH_QUEUE_MAX) { r.reason = "The Market is busy (queue full)"; return r; }
	const int owner = B.owner[b];
	Player &p = sim->players[owner];
	const double cost = buy_price(owner, res);
	if (p.res[RES_GOLD] < cost) { r.reason = "Not enough gold"; return r; }
	p.res[RES_GOLD] -= cost;
	p.res[res] += MARKET_LOT;
	price[res] = std::min(MARKET_MAX, price[res] + MARKET_STEP);
	r.ok = true;
	r.gold = -cost;
	r.amount = MARKET_LOT;
	Event e;
	e.type = EV_RESOURCES_CHANGED;
	e.owner = owner;
	sim->events.emit(e);
	return r;
}

TradeResult Techs::sell(int32_t id, int res) {
	TradeResult r;
	if (!sim->godot_rules) { r.reason = "Not in this game"; return r; }
	const BuildingStore &B = sim->entities.buildings;
	const int b = sim->entities.building_slot(id);
	if (b < 0 || B.removed[b] || B.dead[b] || !B.built[b] || B.type[b] != B_MARKET) { r.reason = "Trade at a Market"; return r; }
	if (!market_tradable(res)) { r.reason = res == RES_FAVOR ? "Favor cannot be traded" : "Only food and wood are traded"; return r; }
	if ((int)B.tech_queue[b].size() >= TECH_QUEUE_MAX) { r.reason = "The Market is busy (queue full)"; return r; }
	const int owner = B.owner[b];
	Player &p = sim->players[owner];
	if (p.res[res] < MARKET_LOT) { r.reason = std::string("Not enough ") + res_name(res); return r; }
	const double gain = sell_price(owner, res);
	p.res[res] -= MARKET_LOT;
	p.res[RES_GOLD] += gain;
	price[res] = std::max(MARKET_MIN, price[res] - MARKET_STEP);
	r.ok = true;
	r.gold = gain;
	r.amount = -MARKET_LOT;
	Event e;
	e.type = EV_RESOURCES_CHANGED;
	e.owner = owner;
	sim->events.emit(e);
	return r;
}

TradeResult Techs::tribute(int from, int to, int res, double amount) {
	TradeResult r;
	if (!sim->godot_rules) { r.reason = "Not in this game"; return r; }
	if (from <= 0 || from >= MAX_PLAYERS || to <= 0 || to >= MAX_PLAYERS || from == to || !sim->players[from].exists || !sim->players[to].exists) {
		r.reason = "No such player";
		return r;
	}
	if (res < 0 || res >= RES_COUNT) { r.reason = "Unknown resource"; return r; }
	if (!(amount > 0)) { r.reason = "Nothing to send"; return r; }
	if (!has_market(from)) { r.reason = "Tribute needs a Market"; return r; }
	const double total = js_round(amount * (1 + tribute_fee(from)));
	Player &p = sim->players[from];
	if (p.res[res] < total) { r.reason = std::string("Not enough ") + res_name(res); return r; }
	p.res[res] -= total;
	sim->players[to].res[res] += amount;
	r.ok = true;
	r.amount = amount;
	r.gold = total - amount; // the fee paid
	for (int o : { from, to }) {
		Event e;
		e.type = EV_RESOURCES_CHANGED;
		e.owner = o;
		sim->events.emit(e);
	}
	return r;
}

// ---- tick -------------------------------------------------------------------------

void Techs::update(double dt) {
	if (!sim->godot_rules) return;
	Entities &E = sim->entities;
	BuildingStore &B = E.buildings;
	UnitStore &U = E.units;
	const double now = sim->time;
	// research queues
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !B.built[b] || B.tech_queue[b].empty()) continue;
		TechItem &q = B.tech_queue[b][0];
		const int owner = B.owner[b];
		double rate = B.type[b] == B_ARMORY && mods[owner].armory_discount ? 1.5 : 1.0; // (Forge of Olympus)
		if (B.civ_empower[b] > 0) rate *= sim->civs.research_mult(b); // (sim/civ: the Pharaoh's empowerment)
		q.t += dt * rate;
		if (q.t >= q.total) {
			const int t = q.tech;
			B.tech_queue[b].erase(B.tech_queue[b].begin());
			finish(b, t);
		}
	}
	// market prices drift back towards the base price
	for (int k = 0; k < RES_COUNT; k++) {
		if (!market_tradable(k)) continue;
		if (price[k] > MARKET_BASE) price[k] = std::max(MARKET_BASE, price[k] - MARKET_DRIFT * dt);
		else if (price[k] < MARKET_BASE) price[k] = std::min(MARKET_BASE, price[k] + MARKET_DRIFT * dt);
	}
	// Sun Ray reveals
	if (!reveals.empty())
		reveals.erase(std::remove_if(reveals.begin(), reveals.end(), [&](const Reveal &v) { return v.until < now; }), reveals.end());
	// poison
	if (any_poison_) {
		bool any = false;
		for (int r = 0; r < U.size(); r++) {
			if (U.removed[r] || U.tech_poison_t[r] <= 0) continue;
			if (U.dead[r]) { U.tech_poison_t[r] = 0; continue; }
			any = true;
			const double step = std::min(dt, U.tech_poison_t[r]);
			U.tech_poison_t[r] -= step;
			U.hp[r] -= POISON_DPS * step;
			if (U.hp[r] <= 0) sim->combat.kill(U.id[r], Hitter::pseudo(U.tech_poison_by[r]));
		}
		any_poison_ = any;
	}
	if (!any_heal_) return;
	auto heal = [&](int r, double amount) {
		if (U.dead[r] || U.hp[r] >= U.max_hp[r]) return;
		U.hp[r] = std::min(U.max_hp[r], U.hp[r] + amount);
	};
	// regeneration and the heroes' Hymn
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.dead[r]) continue;
		const int o = U.owner[r], t = U.type[r];
		if (o <= 0 || o >= MAX_PLAYERS) continue;
		const TechMods &m = mods[o];
		if (m.regen[t] > 0) heal(r, m.regen[t] * dt);
		if (m.heal_aura > 0 && t == U_HERO) {
			const double x = U.x[r], z = U.z[r];
			sim->movement.hash.for_each_near(x, z, HYMN_RADIUS, [&](int u) {
				if (u >= U.size() || U.removed[u] || U.owner[u] != o) return;
				if (jsm::hypot(U.x[u] - x, U.z[u] - z) <= HYMN_RADIUS) heal(u, m.heal_aura * dt);
			});
		}
	}
	// Temple of Healing: up to 3 damaged units near each temple, idle first
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || B.dead[b] || !B.built[b] || B.type[b] != B_TEMPLE) continue;
		const int o = B.owner[b];
		const double rate = mods[o].temple_heal;
		if (rate <= 0) continue;
		struct Cand { double score; int row; };
		Cand best[TEMPLE_HEAL_UNITS];
		int nb = 0;
		const double x = B.x[b], z = B.z[b];
		const double R = TEMPLE_HEAL_RADIUS + std::max(B.w[b], B.h[b]) / 2.0;
		sim->movement.hash.for_each_near(x, z, R, [&](int u) {
			if (u >= U.size() || U.removed[u] || U.dead[u] || U.owner[u] != o || U.hp[u] >= U.max_hp[u]) return;
			const double d = jsm::hypot(U.x[u] - x, U.z[u] - z);
			if (d > R) return;
			const bool busy = U.moving[u] || U.order_type[u] == O_ATTACK || U.order_type[u] == O_ATTACK_MOVE;
			const Cand c{ (busy ? 1000.0 : 0.0) + d + U.id[u] * 1e-9, u };
			int i = nb < TEMPLE_HEAL_UNITS ? nb++ : TEMPLE_HEAL_UNITS;
			if (i == TEMPLE_HEAL_UNITS) {
				if (c.score >= best[TEMPLE_HEAL_UNITS - 1].score) return;
				i = TEMPLE_HEAL_UNITS - 1;
			}
			best[i] = c;
			for (; i > 0 && best[i].score < best[i - 1].score; i--) std::swap(best[i], best[i - 1]);
		});
		for (int i = 0; i < nb; i++) heal(best[i].row, (best[i].score >= 1000 ? rate * 0.5 : rate) * dt);
	}
}

} // namespace aov
