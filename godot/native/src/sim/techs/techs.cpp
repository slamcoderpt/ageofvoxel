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

std::string canonical_god(const std::string &god) {
	const std::string g = lower(god);
	return g == "hathor" ? "sobek" : g;
}

const char *const *minor_gods_of(const std::string &major, int age) {
	static const char *const none[] = { nullptr };
	// EGYPT.md 4 (Retold: Sobek in the Heroic Age where AoM had Hathor)
	static const char *const RA[4][3] = { { nullptr }, { "bast", "ptah", nullptr }, { "sobek", "sekhmet", nullptr }, { "horus", "osiris", nullptr } };
	static const char *const ISIS[4][3] = { { nullptr }, { "anubis", "bast", nullptr }, { "sobek", "nephthys", nullptr }, { "osiris", "thoth", nullptr } };
	static const char *const SET[4][3] = { { nullptr }, { "anubis", "ptah", nullptr }, { "nephthys", "sekhmet", nullptr }, { "horus", "thoth", nullptr } };
	if (age < 1 || age > 3) return none;
	const std::string m = lower(major);
	if (m == "ra") return RA[age];
	if (m == "isis") return ISIS[age];
	if (m == "set") return SET[age];
	return minor_gods(age);
}

int egypt_god_age(const std::string &god) {
	const std::string g = canonical_god(god);
	if (g == "ra" || g == "isis" || g == "set") return 0;
	if (g == "bast" || g == "ptah" || g == "anubis") return 1;
	if (g == "sobek" || g == "sekhmet" || g == "nephthys") return 2;
	if (g == "osiris" || g == "horus" || g == "thoth") return 3;
	return -1;
}

bool is_egypt_god(const std::string &god) { return egypt_god_age(god) >= 0; }

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
		// ---- the Egyptian gods (EGYPT.md 4, 5; the effects' hooks: sim/techs, sim/godpowers, sim/civ) ----
		// major gods' unique techs (Archaic)
		{ "skin_of_the_rhino", "Skin of the Rhino", TH_TOWN_CENTER, -1, 0, Cost(50, 0, 0, 5), 15, -1, "ra", true,
			{ E(TE_HACK_ARMOR, UM(U_LABORER), false, 0.25), E(TE_PIERCE_ARMOR, UM(U_LABORER), false, 0.25), N, N }, nullptr,
			"Laborers -25% hack and -25% pierce vulnerability", "+0.25 on the Laborer's hack (0.1875) and pierce (0.2625) armor (EGYPT.md / TECHS.md: -X % vulnerability is X points more armor)" },
		{ "flood_of_the_nile", "Flood of the Nile", TH_GRANARY, -1, 0, Cost(0, 0, 150, 7.2), 40, -1, "isis", true,
			{ E(TE_TRICKLE, 0, false, 1), N, N, N }, nullptr,
			"A passive trickle of +1 food per second", "Isis' -10 % makes it 135 g; its favor is Retold's 7.2 as listed (150 g + 8 favor before Isis' -10 %; the -10 % leaves other techs' favor alone)" },
		{ "clairvoyance", "Clairvoyance", TH_TEMPLE, -1, 0, Cost(0, 0, 150, 10), 40, -1, "set", true,
			{ E(TE_VISION_RECHARGE, 0, false, 0.5), N, N, N }, nullptr,
			"Vision recharges 50% faster and recasting it is free", "Vision's recharge x0.5; its cost no longer ramps (every cast 40 favor)" },
		// Bast (Classical)
		{ "criosphinx", "Criosphinx", TH_TEMPLE, -1, 1, Cost(0, 150, 0, 5), 40, -1, "bast", false,
			{ E(TE_HP, UM(U_SPHINX), false, 0.20), E(TE_ATTACK, UM(U_SPHINX), false, 0.20), N, N }, nullptr,
			"Sphinx +20% hp, +20% hack and +50% crush damage", "+20 % on the hack part, the 9 crush x1.5 (GodPowers::myth_crush)" },
		{ "hieracosphinx", "Hieracosphinx", TH_TEMPLE, -1, 1, Cost(0, 150, 0, 10), 30, T_CRIOSPHINX, "bast", false,
			{ E(TE_SPEED, UM(U_SPHINX), false, 0.10), E(TE_ATTACK, UM(U_SPHINX), false, 0.20), N, N }, nullptr,
			"Sphinx +10% speed, a further +20% hack and +50% crush damage", "additive: +40 % hack and crush x2 with both" },
		{ "sacred_cats", "Sacred Cats", TH_GRANARY, -1, 1, Cost(0, 0, 55, 10), 30, -1, "bast", false,
			{ E(TE_GATHER_FARM, UM(U_LABORER), false, 0.08), E(TE_GATHER_FOOD, UM(U_LABORER), false, 0.10), N, N }, nullptr,
			"Laborers +8% farming, +10% other food gathering", "" },
		{ "adze_of_wepwawet", "Adze of Wepwawet", TH_LUMBER_CAMP, -1, 1, Cost(0, 0, 50, 10), 40, -1, "bast", false,
			{ E(TE_GATHER_WOOD, UM(U_LABORER), false, 0.10), N, N, N }, nullptr,
			"Laborers fell trees in one hit; +10% wood gathering", "+10 % wood; trees here fall at once anyway" },
		// Ptah (Classical)
		{ "scalloped_axe", "Scalloped Axe", TH_EG_BARRACKS, B_ARMORY, 1, Cost(50, 0, 0, 10), 30, -1, "ptah", false,
			{ E(TE_ATTACK, UM(U_AXEMAN), false, 0.15), N, N, N }, nullptr, "Axeman +15% attack", "" },
		{ "leather_frame_shield", "Leather Frame Shield", TH_EG_BARRACKS, B_ARMORY, 1, Cost(0, 75, 0, 10), 40, -1, "ptah", false,
			{ E(TE_PIERCE_ARMOR, UM(U_SPEARMAN), false, 0.15), N, N, N }, nullptr, "Spearman -15% pierce vulnerability", "+0.15 pierce armor (15 points, TECHS.md's convention)" },
		{ "electrum_bullets", "Electrum Bullets", TH_EG_BARRACKS, B_ARMORY, 1, Cost(0, 0, 150, 15), 40, -1, "ptah", false,
			{ E(TE_ATTACK, UM(U_SLINGER), false, 0.10), E(TE_DIVINE, UM(U_SLINGER), false, 0.5), N, N }, nullptr,
			"Slinger +10% attack and +0.5 divine damage", "" },
		{ "shaduf", "Shaduf", TH_TEMPLE, B_GRANARY, 1, Cost(0, 100, 0, 10), 20, -1, "ptah", false,
			{ E(TE_FARM_DISCOUNT, 0, false, 0.5), N, N, N }, nullptr,
			"Farms -50% cost and -50% build time", "an Egyptian Farm 70 -> 35 gold, 10 -> 5 s base (a Laborer x4/3)" },
		// Anubis (Classical)
		{ "feet_of_the_jackal", "Feet of the Jackal", TH_TEMPLE, -1, 1, Cost(0, 0, 200, 10), 30, -1, "anubis", false,
			{ E(TE_HP, UM(U_ANUBITE), false, 0.40), E(TE_ATTACK, UM(U_ANUBITE), false, 0.20), N, N }, nullptr,
			"Anubite -> Guardian Anubite: +40% hp, +20% hack, +3 jump distance", "the jump's reach +1.8 tiles (x DIST_SCALE)" },
		{ "serpent_spear", "Serpent Spear", TH_EG_BARRACKS, B_ARMORY, 1, Cost(125, 0, 0, 12), 40, -1, "anubis", false,
			{ E(TE_MELEE_POISON, UM(U_SPEARMAN), false, 0.125), N, N, N }, nullptr,
			"Spearmen poison: 0.125 divine damage per second over 6 s", "a blow restarts the 6 s (no armor)" },
		{ "necropolis", "Necropolis", TH_TEMPLE, -1, 1, Cost(0, 50, 150, 0), 30, -1, "anubis", false,
			{ E(TE_FAVOR, 0, false, 0.25), N, N, N }, nullptr, "Monuments +25% favor", "the owner's favor rate x1.25" },
		// Sobek (Heroic; Retold's replacement for AoM's Hathor)
		{ "sun_dried_mud_brick", "Sun-dried Mud-brick", TH_TOWN_CENTER, -1, 2, Cost(0, 200, 0, 20), 15, -1, "sobek", false,
			{ E(TE_MUDBRICK, 0, false, 0.10), N, N, N }, nullptr,
			"All buildings +10% hp, -10% gold cost, -15% build time", "existing buildings too (max and current hp x1.1)" },
		{ "crocodilopolis", "Crocodilopolis", TH_TEMPLE, -1, 2, Cost(0, 200, 0, 15), 40, -1, "sobek", false,
			{ E(TE_RANGE, UM(U_PETSUCHOS), false, 6 * D, 6), E(TE_SIGHT, UM(U_PETSUCHOS), false, 6 * D, 6), N, N }, nullptr,
			"Petsuchos -> Petsobek: +6 range, +6 LOS", "+3.6 tiles (x DIST_SCALE)" },
		{ "dark_water", "Dark Water", TH_MARKET, B_MIGDOL, 2, Cost(200, 0, 0, 18), 30, -1, "sobek", false,
			{ E(TE_HP, UM(U_CAMEL_RIDER), false, 0.15), E(TE_REGEN, UM(U_CAMEL_RIDER), false, 0.5), N, N }, nullptr,
			"Camel Riders and Caravans +15% hp, +0.5 hp/s regeneration", "Caravans: none here" },
		{ "solar_barque", "Solar Barque", TH_TEMPLE, -1, 2, Cost(0, 150, 0, 10), 30, -1, "sobek", false,
			{ N, N, N, N }, "Kebenit", "Kebenits spawn 3 Sea Snakes per 200 damage dealt to ships (Dock)", "" },
		// Sekhmet (Heroic)
		{ "bone_bow", "Bone Bow", TH_MIGDOL, B_ARMORY, 2, Cost(0, 125, 0, 20), 40, -1, "sekhmet", false,
			{ E(TE_RANGE, UM(U_CHARIOT_ARCHER), false, 2 * D, 2), E(TE_SIGHT, UM(U_CHARIOT_ARCHER), false, 4 * D, 4), N, N }, nullptr,
			"Chariot Archer +2 range, +4 LOS", "+1.2 / +2.4 tiles (x DIST_SCALE)" },
		{ "slings_of_the_sun", "Slings of the Sun", TH_EG_BARRACKS, B_ARMORY, 2, Cost(0, 0, 100, 15), 40, -1, "sekhmet", false,
			{ E(TE_VS_INFANTRY, UM(U_SLINGER), false, 0.75), N, N, N }, nullptr, "Slinger +0.75x damage vs infantry", "" },
		{ "crimson_linen", "Crimson Linen", TH_TEMPLE, -1, 2, Cost(125, 0, 0, 20), 40, -1, "sekhmet", false,
			{ E(TE_LIFESTEAL, M_EG_MYTH & ~UM(U_SCARAB), false, 0.25), E(TE_LIFESTEAL, UM(U_SCARAB), false, 0.75), N, N }, nullptr,
			"Myth units regain 25% of the damage they deal as hp (Scarab 75%)", "" },
		{ "force_of_the_west_wind", "Force of the West Wind", TH_SIEGE_WORKS, -1, 2, Cost(0, 0, 150, 25), 90, -1, "sekhmet", false,
			{ E(TE_ATTACK, UM(U_SIEGE_TOWER) | UM(U_CATAPULT), false, 0.15), E(TE_HEROIC_SIEGE, 0, false, 1), N, N }, nullptr,
			"Siege and myth units +15% crush damage; Catapults available in the Heroic Age",
			"+15 % attack of the siege weapons; the Sphinx's, Scarab's and Phoenix's crush part +15 % (GodPowers::myth_crush)" },
		// Nephthys (Heroic)
		{ "funeral_rites", "Funeral Rites", TH_TEMPLE, B_TOWN_CENTER, 2, Cost(0, 0, 100, 15), 40, -1, "nephthys", false,
			{ E(TE_REFUND, M_EG_HUMAN | M_HERO, false, 8), N, N, N }, nullptr,
			"Every human soldier or hero of yours that dies refunds 8 gold", "" },
		{ "spirit_of_maat", "Spirit of Maat", TH_TEMPLE, B_TOWN_CENTER, 2, Cost(0, 0, 100, 25), 30, -1, "nephthys", false,
			{ E(TE_HEAL_MULT, UM(U_PRIEST) | UM(U_PHARAOH), false, 0.5), E(TE_COST, UM(U_PRIEST), false, -0.30), N, N }, nullptr,
			"Priest and Pharaoh healing +50%; Priests -30% cost", "" },
		{ "nebty", "Nebty", TH_TEMPLE, B_TOWN_CENTER, 2, Cost(0, 100, 0, 15), 30, -1, "nephthys", false,
			{ E(TE_VS_MYTH, UM(U_PRIEST) | UM(U_PHARAOH), false, 1.0), E(TE_HP, UM(U_PRIEST) | UM(U_PHARAOH), false, 0.10), N, N }, nullptr,
			"Priest and Pharaoh +1x damage vs myth units, +10% hp", "" },
		{ "funeral_barge", "Funeral Barge", TH_TEMPLE, -1, 2, Cost(0, 0, 200, 20), 30, -1, "nephthys", false,
			{ N, N, N, N }, "War Barge", "A destroyed War Barge has a 10% chance to spawn a Leviathan (Dock)", "" },
		// Osiris (Mythic)
		{ "new_kingdom", "New Kingdom", TH_TOWN_CENTER, B_TEMPLE, 3, Cost(0, 0, 150, 20), 30, -1, "osiris", false,
			{ E(TE_PHARAOH, 0, false, 1), N, N, N }, nullptr, "A second Pharaoh", "he appears at once at the home Town Center; both respawn" },
		{ "desert_wind", "Desert Wind", TH_MIGDOL, -1, 3, Cost(0, 0, 300, 30), 40, -1, "osiris", false,
			{ E(TE_HP, UM(U_CAMEL_RIDER), false, 0.15), E(TE_SPEED, UM(U_CAMEL_RIDER), false, 0.15), E(TE_ATTACK, UM(U_CAMEL_RIDER), false, 0.15), N }, nullptr,
			"Camel Rider +15% hp, speed and hack damage", "" },
		{ "atef_crown", "Atef Crown", TH_TEMPLE, -1, 3, Cost(0, 0, 200, 20), 40, -1, "osiris", false,
			{ E(TE_HP, UM(U_MUMMY), false, 0.20), E(TE_ATTACK, UM(U_MUMMY), false, 0.40), E(TE_MINION_LIFE, 0, false, 2), N }, nullptr,
			"Mummy -> Mummy Vizier: +20% hp, +40% attack; Minions live twice as long", "Ancestors' Minions 60 -> 120 s" },
		// Horus (Mythic)
		{ "axe_of_vengeance", "Axe of Vengeance", TH_EG_BARRACKS, -1, 3, Cost(0, 150, 0, 20), 40, -1, "horus", false,
			{ E(TE_RAGE, UM(U_AXEMAN), false, 0.5), E(TE_VS_BUILDINGS, UM(U_AXEMAN), false, 2.0), N, N }, nullptr,
			"Axemen +0.5% attack per 1% of hp missing, +2x damage vs buildings", "" },
		{ "greatest_of_fifty", "Greatest of Fifty", TH_EG_BARRACKS, -1, 3, Cost(0, 0, 150, 20), 40, -1, "horus", false,
			{ E(TE_HP, M_EG_INFANTRY, false, 0.20), E(TE_SPEED, M_EG_INFANTRY, false, 0.10), N, N }, nullptr,
			"Infantry +20% hp and +10% speed; unlocks the Wedge formation", "infantry = Spearman, Axeman, Mercenary; formations: none here" },
		{ "spear_of_horus", "Spear of Horus", TH_EG_BARRACKS, -1, 3, Cost(250, 0, 0, 25), 40, -1, "horus", false,
			{ E(TE_ATTACK, UM(U_SPEARMAN), false, 0.10), E(TE_VS_CAVALRY, UM(U_SPEARMAN), false, 1.0), N, N }, nullptr,
			"Spearmen +10% attack, +1x damage vs cavalry", "x2 -> x3 vs cavalry" },
		// Thoth (Mythic)
		{ "valley_of_the_kings", "Valley of the Kings", TH_MIGDOL, -1, 3, Cost(0, 0, 500, 40), 20, -1, "thoth", false,
			{ E(TE_VALLEY, 0, false, 1.6), N, N, N }, nullptr,
			"A Pharaoh-empowered Barracks or Migdol trains 60% slower but spawns a free extra copy of each unit", "" },
		{ "book_of_thoth", "Book of Thoth", TH_TOWN_CENTER, -1, 3, Cost(0, 300, 0, 30), 40, -1, "thoth", false,
			{ E(TE_GATHER_FARM, UM(U_LABORER), false, 0.10), E(TE_GATHER_FOOD, UM(U_LABORER), false, 0.10),
				E(TE_GATHER_WOOD, UM(U_LABORER), false, 0.10), E(TE_GATHER_GOLD, UM(U_LABORER), false, 0.10) }, nullptr,
			"Laborers +10% gather rate", "" },
		{ "tusks_of_apedemak", "Tusks of Apedemak", TH_MIGDOL, -1, 3, Cost(250, 0, 0, 15), 40, -1, "thoth", false,
			{ E(TE_ATTACK, UM(U_WAR_ELEPHANT), false, 0.10), E(TE_COST, UM(U_WAR_ELEPHANT), false, -0.10), N, N }, nullptr,
			"War Elephant +10% attack, -10% cost, -1 pop", "pop 3 -> 2 (Techs::unit_pop)" },
	};
	// clang-format on
	return T[t >= 0 && t < T_COUNT ? t : 0];
}

int tech_of(const char *key) {
	for (int t = 0; t < T_COUNT; t++)
		if (std::strcmp(tech_def(t).key, key) == 0) return t;
	return -1;
}

int tech_civ(int t) {
	if (t >= T_HANDS_OF_THE_PHARAOH) return CIV_EGYPT; // (Hands of the Pharaoh, the Egyptian gods' techs)
	const TechDef &d = tech_def(t);
	return d.god || d.home == TH_TEMPLE ? CIV_GREEK : -1;
}

int tech_home_building(int home) {
	switch (home) {
		case TH_ARMORY: return B_ARMORY;
		case TH_MARKET: return B_MARKET;
		case TH_TOWN_CENTER: return B_TOWN_CENTER;
		case TH_GRANARY: return B_GRANARY;
		case TH_LUMBER_CAMP: return B_LUMBER_CAMP;
		case TH_EG_BARRACKS: return B_EG_BARRACKS;
		case TH_MIGDOL: return B_MIGDOL;
		case TH_SIEGE_WORKS: return B_SIEGE_WORKS;
		default: return B_TEMPLE;
	}
}

// ---- setup ------------------------------------------------------------------

void Techs::init(Sim *s) {
	sim = s;
	for (int i = 0; i < MAX_PLAYERS; i++) {
		done[i].reset();
		mods[i] = TechMods();
		trickled[i] = refunded[i] = stolen[i] = 0;
		valley_copies[i] = 0;
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
		if (o <= 0 || o >= MAX_PLAYERS || (done[o].none() && sim->players[o].civ != CIV_EGYPT)) return; // (Egyptians: myth units' age hp)
		apply_unit(r, TechMods(), mods[o]);
	});
	// (the Egyptian gods) an Egyptian reaching an age takes a minor god if he chose none
	s->events.on(EV_AGE_ADVANCED, [this](const Event &e) {
		if (sim->godot_rules) auto_minor(e.owner);
	});
	// lifesteal (Crimson Linen), Serpent Spear's poison
	s->events.on(EV_UNIT_DAMAGED, [this](const Event &e) {
		if (sim->godot_rules) on_damaged(e);
	});
	// Shaduf / Sun-dried Mud-brick on a new building (after sim/civ's own build time: its
	// handler was registered first, Civs::init runs before... see build_time_mult)
	s->events.on(EV_BUILDING_PLACED, [this](const Event &e) {
		if (!sim->godot_rules) return;
		const int b = sim->entities.building_slot(e.id);
		if (b < 0) return;
		BuildingStore &B = sim->entities.buildings;
		const int o = B.owner[b];
		if (o <= 0 || o >= MAX_PLAYERS) return;
		const double k = build_time_mult(o, B.type[b]);
		if (k != 1) {
			const double base = civ_build_time(sim->civs.civ(o), B.type[b]);
			B.fort_build_time[b] = (B.fort_build_time[b] > 0 ? B.fort_build_time[b] : base > 0 ? base : building_def(B.type[b]).build_time) * k;
		}
		if (mods[o].mudbrick > 0) {
			B.max_hp[b] *= 1 + mods[o].mudbrick;
			B.hp[b] *= 1 + mods[o].mudbrick;
		}
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
	{ // (sim/civ) a civ's techs
		const int tc = tech_civ(t);
		if (tc >= 0 && tc != p.civ) { why(std::string("Not a technology of the ") + civ_name(p.civ)); return TS_UNAVAILABLE; }
	}
	if (d.god) {
		if (d.major) {
			if (lower(p.god) != d.god) { why(std::string("Requires ") + (char)std::toupper(d.god[0]) + (d.god + 1)); return TS_LOCKED_GOD; }
		} else {
			// (Greeks: none chosen opens every god's techs; Egyptians take a god at every age-up,
			// Techs::auto_minor, so theirs need him)
			const std::string &m = minor[owner][d.age];
			const bool strict = p.civ == CIV_EGYPT;
			if ((strict || !m.empty()) && m != d.god) { why(std::string("Requires the minor god ") + (char)std::toupper(d.god[0]) + (d.god + 1)); return TS_LOCKED_GOD; }
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
	const double im = sim->civs.tech_cost_mult(owner); // (sim/civ: Isis -10 %, favor unchanged)
	if (im != 1)
		for (int k = 0; k < RES_FAVOR; k++) c.v[k] *= im;
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
	done[owner].set(t);
	recompute(owner);
	on_done(owner, t);
}

TechResult Techs::set_minor_god(int owner, int age, const std::string &god) {
	TechResult r;
	if (owner <= 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists) { r.reason = "No such player"; return r; }
	if (age < 1 || age > 3) { r.reason = "Minor gods are chosen for the Classical, Heroic and Mythic Ages"; return r; }
	const std::string g = canonical_god(god); // ("hathor" = Retold's Sobek)
	const std::string &major = sim->players[owner].god;
	const bool egypt = sim->players[owner].civ == CIV_EGYPT;
	if (!g.empty()) {
		bool ok = false;
		for (const char *const *m = egypt ? minor_gods_of(major, age) : minor_gods(age); *m; m++)
			if (g == *m) ok = true;
		if (!ok) {
			if (egypt && egypt_god_age(g) == age) r.reason = std::string(1, (char)std::toupper(major.empty() ? '?' : major[0])) + (major.empty() ? "" : major.substr(1)) + " does not offer " + (char)std::toupper(g[0]) + g.substr(1);
			else r.reason = "Not a minor god of the " + std::string(AGES[age]) + " Age";
			return r;
		}
	}
	// (Retold chooses him once, at the age-up: the UI only offers the choice there; an
	// Egyptian who reached the age without one got the first offered, Techs::auto_minor)
	if (egypt && g.empty()) { r.reason = "An Egyptian needs a minor god for every age"; return r; }
	minor[owner][age] = g;
	r.ok = true;
	return r;
}

void Techs::auto_minor(int owner) {
	if (owner <= 0 || owner >= MAX_PLAYERS || !sim->players[owner].exists || sim->players[owner].civ != CIV_EGYPT) return;
	const Player &p = sim->players[owner];
	for (int a = 1; a <= std::min(3, p.age); a++)
		if (minor[owner][a].empty()) {
			const char *const *m = minor_gods_of(p.god, a);
			if (*m) minor[owner][a] = *m;
		}
	recompute(owner); // (the myth units' later-age hp, GodPowers::myth_age_mult, re-based on every unit)
}

int Techs::min_age_for(int owner, int type) const {
	const int a = rules_min_age(type);
	if (type == U_CATAPULT && owner > 0 && owner < MAX_PLAYERS && mods[owner].heroic_siege) return std::min(a, 2);
	return a;
}

void Techs::finish(int b, int t) {
	BuildingStore &B = sim->entities.buildings;
	const int owner = B.owner[b];
	done[owner].set(t);
	researched++;
	recompute(owner);
	on_done(owner, t);
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
					case TE_GATHER_FARM: m.gather[0][u] += f.v; break;
					case TE_GATHER_FOOD: m.gather[1][u] += f.v; break;
					case TE_GATHER_WOOD: m.gather[2][u] += f.v; break;
					case TE_GATHER_GOLD: m.gather[3][u] += f.v; break;
					case TE_VS_INFANTRY: m.vs_infantry[u] += f.v; break;
					case TE_VS_CAVALRY: m.vs_cavalry[u] += f.v; break;
					case TE_LIFESTEAL: m.lifesteal[u] += f.v; break;
					case TE_HEAL_MULT: m.heal_mult[u] += f.v; break;
					case TE_COST: m.cost[u] += f.v; break;
					case TE_RAGE: m.rage[u] += f.v; break;
					case TE_MELEE_POISON: m.melee_poison[u] += f.v; break;
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
				case TE_TRICKLE: m.trickle += f.v; break;
				case TE_VISION_RECHARGE: m.vision_recharge *= f.v; break;
				case TE_FARM_DISCOUNT: m.farm_discount *= f.v; break;
				case TE_MUDBRICK: m.mudbrick += f.v; break;
				case TE_REFUND: m.refund += f.v; break;
				case TE_PHARAOH: m.pharaohs += (int)f.v; break;
				case TE_HEROIC_SIEGE: m.heroic_siege = true; break;
				case TE_VALLEY: m.valley = f.v; break;
				case TE_MINION_LIFE: m.minion_life *= f.v; break;
				default: break;
			}
		}
	}
	// (Egyptians, rules on) the myth units' +20 % hp per later age (EGYPT.md 5), on top of the techs';
	// their damage part rides in GodPowers::damage_mult
	if (sim->godot_rules)
		for (int u = U_ANUBITE; u <= U_PHOENIX; u++) {
			const double k = sim->godpowers.myth_age_mult(owner, u);
			if (k != 1) m.hp[u] = (1 + m.hp[u]) * k - 1;
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

int Techs::unit_pop(int owner, int type) const {
	const int p = unit_def(type).pop;
	if (type == U_WAR_ELEPHANT && sim->godot_rules && is_done(owner, T_TUSKS_OF_APEDEMAK)) return std::max(0, p - 1);
	return p;
}

double Techs::unit_damage(int r) const {
	const UnitStore &U = sim->entities.units;
	const int t = U.type[r], o = U.owner[r];
	double d = sim->civs.base_damage(r) * (1 + mods[o].attack[t]); // (sim/civ: Priest / Pharaoh by age; else the def's)
	if (mods[o].frenzy[t] && U.tech_frenzy_t[r] >= sim->time) d *= FRENZY_DAMAGE;
	if (mods[o].rage[t] > 0 && U.max_hp[r] > 0) d *= 1 + mods[o].rage[t] * std::max(0.0, 1 - U.hp[r] / U.max_hp[r]); // (Axe of Vengeance)
	d *= sim->godpowers.damage_mult(r); // (sim/godpowers: Bast's Eclipse)
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
	armor = tech_armor(o, t, armor, arrow);
	return sim->godpowers.armor_after(tr, armor); // (sim/godpowers: the Eclipse's -10 % vulnerability, +0.10 armor)
}

double Techs::tech_armor(int o, int t, double armor, bool pierce) const {
	const TechMods &m = mods[o];
	const double add = pierce ? m.pierce[t] : m.hack[t];
	if (add != 0) armor = std::min(ARMOR_CAP, armor + add);
	return armor;
}

// the extra factor on a hit from unit row ar on (kind, row): multipliers
// add, as in Retold (Olympian Weapons: x1.5 vs myth becomes x2.5)
double Techs::vs_mult(int ar, int tk, int tr) const {
	const UnitStore &U = sim->entities.units;
	const int at = U.type[ar], o = U.owner[ar];
	if (tk == K_BUILDING) return 1 + mods[o].vs_buildings[at];
	if (tk != K_UNIT) return 1;
	const int tc = unit_def(U.type[tr]).cls;
	auto add = [&](int cls, double v) { // (multipliers add: x2 vs cavalry + 1 = x3)
		const double base = unit_def(at).bonus[cls] != 0 ? unit_def(at).bonus[cls] : 1;
		return (base + v) / base;
	};
	if (mods[o].vs_myth[at] != 0 && tc == CLS_MYTH) return add(CLS_MYTH, mods[o].vs_myth[at]);
	if (mods[o].vs_infantry[at] != 0 && tc == CLS_INFANTRY) return add(CLS_INFANTRY, mods[o].vs_infantry[at]); // (Slings of the Sun)
	if (mods[o].vs_cavalry[at] != 0 && tc == CLS_CAVALRY) return add(CLS_CAVALRY, mods[o].vs_cavalry[at]);     // (Spear of Horus)
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
		// the Egyptian gods' (EGYPT.md 5, sim/godpowers egypt_myth.cpp)
		case U_SPHINX: return "bast";
		case U_WADJET: return "ptah";
		case U_ANUBITE: return "anubis";
		case U_PETSUCHOS: case U_ROC: return "sobek";
		case U_SCARAB: return "sekhmet";
		case U_SCORPION_MAN: return "nephthys";
		case U_MUMMY: return "osiris";
		case U_AVENGER: return "horus";
		case U_PHOENIX: return "thoth";
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
	if (m == g) return true;
	if (m.empty() && !is_egypt_myth(type)) return true; // (Greeks: none chosen opens every god's unit; the Egyptians' need their god)
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
	s.hack_armor = on ? tech_armor(o, t, d.armor, false) : d.armor;
	s.pierce_armor = on ? tech_armor(o, t, is_egypt_unit(t) ? sim->civs.base_pierce(r) : d.armor, true) : d.armor;
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
	// Funeral Rites: his human soldier or hero refunds gold
	if (vo > 0 && vo < MAX_PLAYERS && mods[vo].refund > 0 && ((M_EG_HUMAN | M_HERO) >> U.type[v] & 1)) {
		sim->players[vo].res[RES_GOLD] += mods[vo].refund;
		refunded[vo] += mods[vo].refund;
	}
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

// ---- the Egyptian gods' techs: hooks ---------------------------------------------------

double Techs::favor_mult(int owner) const {
	if (owner <= 0 || owner >= MAX_PLAYERS) return 1;
	return (1 + mods[owner].favor) * sim->godpowers.favor_mult(owner); // (sim/godpowers: Bast's Eclipse +50 % Monument favor)
}

double Techs::gather_mult(int r, bool farm, int res, int node_type) const {
	const UnitStore &U = sim->entities.units;
	const int o = U.owner[r], t = U.type[r];
	if (o <= 0 || o >= MAX_PLAYERS) return 1;
	const TechMods &m = mods[o];
	const int k = farm ? 0 : res == RES_FOOD ? 1 : res == RES_WOOD ? 2 : res == RES_GOLD ? 3 : -1;
	const double tech = k >= 0 ? 1 + m.gather[k][t] : 1;
	return tech * sim->godpowers.gather_mult(r, farm, res, node_type); // (Ra's Rain, Isis' Prosperity)
}

double Techs::train_cost_mult(int owner, int utype) const {
	if (owner <= 0 || owner >= MAX_PLAYERS || utype < 0 || utype >= U_TYPE_COUNT) return 1;
	return std::max(0.0, 1 + mods[owner].cost[utype]);
}

double Techs::heal_mult(int r) const {
	const UnitStore &U = sim->entities.units;
	const int o = U.owner[r];
	if (o <= 0 || o >= MAX_PLAYERS) return 1;
	return 1 + mods[o].heal_mult[U.type[r]];
}

void Techs::building_cost(int owner, int btype, Cost &c) const {
	if (owner <= 0 || owner >= MAX_PLAYERS) return;
	const TechMods &m = mods[owner];
	if (btype == B_FARM && m.farm_discount != 1)
		for (int k = 0; k < RES_FAVOR; k++) c.v[k] *= m.farm_discount;
	if (m.mudbrick > 0) c.v[RES_GOLD] *= 0.9;
}

double Techs::build_time_mult(int owner, int btype) const {
	if (owner <= 0 || owner >= MAX_PLAYERS) return 1;
	const TechMods &m = mods[owner];
	double k = 1;
	if (btype == B_FARM) k *= m.farm_discount;
	if (m.mudbrick > 0) k *= 0.85;
	return k;
}

int Techs::pharaoh_count(int owner) const { return 1 + (owner > 0 && owner < MAX_PLAYERS ? mods[owner].pharaohs : 0); }

double Techs::train_speed(int b, int utype) const {
	const BuildingStore &B = sim->entities.buildings;
	const int o = B.owner[b];
	double k = sim->godpowers.work_mult(b); // (Sekhmet's Citadel: +25 %)
	if (o > 0 && o < MAX_PLAYERS && mods[o].valley > 0 && B.civ_empower[b] > 0 && (B.type[b] == B_EG_BARRACKS || B.type[b] == B_MIGDOL) &&
			utype != U_LABORER)
		k /= mods[o].valley; // (Valley of the Kings: 60 % slower, a free copy)
	return k;
}

void Techs::on_trained(int b, int utype, int32_t) {
	BuildingStore &B = sim->entities.buildings;
	const int o = B.owner[b];
	if (o <= 0 || o >= MAX_PLAYERS || mods[o].valley <= 0 || B.civ_empower[b] <= 0) return;
	if (B.type[b] != B_EG_BARRACKS && B.type[b] != B_MIGDOL) return;
	if (sim->economy.spawn_from_building(b, utype) >= 0) valley_copies[o]++;
}

void Techs::on_done(int owner, int t) {
	if (t == T_NEW_KINGDOM) sim->civs.spawn_pharaoh(owner); // (his second Pharaoh, at once)
	if (t == T_SUN_DRIED_MUD_BRICK) {
		BuildingStore &B = sim->entities.buildings;
		for (int b = 0; b < B.size(); b++)
			if (!B.removed[b] && !B.dead[b] && B.owner[b] == owner) {
				B.max_hp[b] *= 1 + mods[owner].mudbrick;
				B.hp[b] *= 1 + mods[owner].mudbrick;
			}
	}
}

void Techs::on_damaged(const Event &e) {
	if (e.kind != K_UNIT || e.other <= 0 || e.amount <= 0) return;
	Entities &E = sim->entities;
	UnitStore &U = E.units;
	const int a = E.unit_slot(e.other);
	if (a < 0 || U.dead[a]) return;
	const int o = U.owner[a], t = U.type[a];
	if (o <= 0 || o >= MAX_PLAYERS) return;
	const TechMods &m = mods[o];
	if (m.lifesteal[t] > 0 && U.hp[a] < U.max_hp[a]) { // (Crimson Linen)
		const double before = U.hp[a];
		U.hp[a] = std::min(U.max_hp[a], U.hp[a] + e.amount * m.lifesteal[t]);
		stolen[o] += U.hp[a] - before;
	}
	if (m.melee_poison[t] > 0 && !unit_def(t).attack.projectile) { // (Serpent Spear)
		const int v = E.unit_slot(e.id);
		if (v >= 0 && !U.dead[v]) sim->godpowers.add_dot(e.id, o, m.melee_poison[t], POISON_TIME, DOT_POISON);
	}
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
		rate *= sim->godpowers.work_mult(b); // (sim/godpowers: Sekhmet's Citadel +25 %)
		q.t += dt * rate;
		if (q.t >= q.total) {
			const int t = q.tech;
			B.tech_queue[b].erase(B.tech_queue[b].begin());
			finish(b, t);
		}
	}
	// Flood of the Nile's food trickle
	for (int o = 1; o < MAX_PLAYERS; o++)
		if (mods[o].trickle > 0 && sim->players[o].exists) {
			sim->players[o].res[RES_FOOD] += mods[o].trickle * dt;
			trickled[o] += mods[o].trickle * dt;
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
		if (U.dead[r] || U.hp[r] >= U.max_hp[r] || U.type[r] == U_SON_OF_OSIRIS) return; // (Retold: the Son cannot be healed)
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
