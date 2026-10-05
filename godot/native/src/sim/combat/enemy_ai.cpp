// Port of src/combat/EnemyAI.js (see enemy_ai.h).
#include "enemy_ai.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "../core/jsmath.h"
#include "../sim.h"

namespace aov {

static const double PI = 3.141592653589793;

// god powers (Godot-only: the browser's EnemyAI never casts)
static const double POWER_EVERY = 2;      // s between decisions
static const double REACH_ARMY = 12;      // enemies this close to one of our soldiers are in reach
static const double REACH_BASE = 16;      // ... or this close to one of our buildings' centre
static const int STORM_MIN = 6;           // enemy units a Lightning Storm must catch
static const int METEOR_BUILDINGS = 2;    // enemy buildings a Meteor must hit
static const int METEOR_UNITS = 8;        // ... or enemy units
static const double BOLT_SPARE_FAVOR = 70; // Bolt a plain (non-myth) unit only with this much favor
static const int MAX_CENTRES = 64;        // candidate strike points tried per power
static const double STORE_EVERY = 5;       // Godot-only: s between storehouse checks
static const double SITE_EVERY = 10;       // Godot-only: s between abandoned-foundation checks
static const double SITE_SAFE = 10;        // ... a foundation with a foe this close waits
static const double STORE_FAR = 16;        // ... a node this far from every drop-off is far
static const int STORE_MEN = 3;            // ... and this many villagers working far ones
static const int STORE_MAX = 4;            // ... storehouses at most
static const double FOOD_GLUT = 1500;      // Godot-only: food beyond this (wood / gold short): fewer farmers
static const double STRAY_DIST = 30;      // idle soldiers this far from our Town Center rejoin the attack
static const int OVERDUE_MIN = 6;         // men an overdue wave needs at least
static const double EG_FIRST_WAVE = 300;  // Godot-only, an Egyptian seat: s past its Classical Age before its first wave

const char *ai_difficulty_name(int d) {
	static const char *n[] = { "easy", "moderate", "hard", "titan" };
	return d >= 0 && d < 4 ? n[d] : "";
}

int ai_difficulty_of(const char *name) {
	for (int d = 0; d < 4; d++)
		if (std::string(name) == ai_difficulty_name(d)) return d;
	return AI_DEFAULT;
}

AIParams ai_params(int d) {
	AIParams p; // AI_DEFAULT / AI_MODERATE: the browser's EnemyAI
	if (d == AI_EASY) {
		p.think = 2;
		p.max_villagers = 14;
		p.villagers_rules = 18;
		p.villager_queue = 1;
		p.academy_at = 12;
		p.temple_at = 13;
		p.army_queue = 1;
		p.wave_size = 5;
		p.wave_grow = 2;
		p.wave_max = 16;
		p.first_wave = 420;
		p.aggression = 0.6;
		p.power_every = 30;
		p.storm_min = 12;
		p.worshippers = 1;
		p.age_after = 720;
	} else if (d == AI_HARD) {
		p.max_villagers = 30;
		p.villagers_rules = 42;
		p.academy_at = 8;
		p.temple_at = 12;
		p.academy2_at = 20;
		p.army_queue = 4;
		p.wave_size = 8;
		p.wave_grow = 5;
		p.wave_max = 44;
		p.first_wave = 240;
		p.aggression = 1.15;
		p.storm_min = 5;
		p.worshippers = 4;
		p.house_margin = 6;
		p.food_share = 0.55;
		p.gold_share = 0.17;
		p.bank_cap = 600;
		p.army_while_saving = true;
	} else if (d == AI_TITAN) {
		p.think = 0.75;
		p.max_villagers = 34;
		p.villagers_rules = 50;
		p.villager_queue = 3;
		p.academy_at = 8;
		p.temple_at = 11;
		p.academy2_at = 16;
		p.army_queue = 5;
		p.wave_size = 10;
		p.wave_grow = 6;
		p.wave_max = 50;
		p.first_wave = 240;
		p.aggression = 1.45;
		p.power_every = 1;
		p.storm_min = 4;
		p.worshippers = 5;
		p.house_margin = 8;
		p.food_share = 0.58;
		p.gold_share = 0.16;
		p.bank_cap = 450;
		p.army_while_saving = true;
		p.gather_mult = 1.2;
		p.bonus_res = 150;
	}
	// fortifications (Godot-only): every difficulty towers and walls its
	// town in, as the Retold AI does; the harder ones sooner, with more
	// towers, more hands on the ring and the upgrades
	if (d == AI_EASY) {
		p.towers_max = 1;
		p.tower_at = 13;
		p.tower_upgrade = false;
		p.walls = true;
		p.wall_at = 720;
		p.wall_builders = 2;
		p.repairers = 1;
		p.tower_fear = false;
	} else if (d == AI_HARD || d == AI_TITAN) {
		const bool titan = d == AI_TITAN;
		p.towers_max = titan ? 4 : 3;
		p.tower_at = titan ? 12 : 14;
		p.walls = true;
		p.wall_at = titan ? 360 : 420;
		p.wall_builders = titan ? 5 : 4;
		p.wall_upgrade = true;
		p.repairers = 3;
	} else { // Moderate (and the default AI): a tower or two, Watch Tower, the ring at 10 min
		p.towers_max = 2;
		p.walls = true;
		p.wall_at = 600;
		p.wall_builders = 3;
		p.wall_upgrade = true;
	}
	// research, ages, the Market (Godot-only, enemy_ai_techs.cpp), scaled as
	// Retold's AI: Easy little and late (an Armory 9 min into the Classical
	// Age, two Copper techs, never past the Classical Age, no Market); Titan
	// an Armory as soon as it is Classical, a Market, Heroic at 11 min,
	// Mythic at 19, nearly every tech its gods allow on time. Moderate keeps
	// the struct's defaults (Heroic at 15 min, its Market there)
	if (d == AI_EASY) {
		p.armory_at = 12;
		p.armory_delay = 540;
		p.tech_level = 0;
		p.tech_keep = 300;
		p.escrow_max = 30;
		p.escrow_rest = 150;
		p.max_age = 1;
		p.market_age = 4;
		p.classical_at = 660;
	} else if (d == AI_HARD || d == AI_TITAN) {
		const bool titan = d == AI_TITAN;
		p.armory_at = titan ? 10 : 16;
		p.armory_delay = titan ? 20 : 45;
		p.fort_first = false;
		p.tech_level = titan ? 3 : 2;
		p.tech_keep = titan ? 100 : 150;
		p.escrow_max = titan ? 180 : 120;
		p.escrow_rest = titan ? 45 : 60;
		p.age_escrow_max = titan ? 300 : 240;
		p.max_age = 3;
		p.classical_at = titan ? 240 : 330;
		p.heroic_at = titan ? 660 : 780;
		p.mythic_at = titan ? 1140 : 1380;
		p.age_lead = titan ? 120 : 110;
		p.guard = 8;
		p.archaic_villagers = titan ? 23 : 20;
		p.market_age = 1;
		p.market_delay = titan ? 210 : 120;
		p.trade_glut = titan ? 1100 : 1400;
		p.trade_every = titan ? 1 : 1.5;
	}
	return p;
}

void EnemyAI::set_difficulty(int d) {
	difficulty = d;
	par = ai_params(d);
	wave_size = par.wave_size;
	next_wave_at = par.first_wave;
	aggression = par.aggression;
}

void EnemyAI::update(double dt) {
	if (!enabled) return;
	timer -= dt;
	if (timer > 0) return;
	timer = par.think;
	Sim &S = *sim;
	Entities &E = S.entities;
	UnitStore &U = E.units;
	BuildingStore &B = E.buildings;
	Player &p = S.players[owner];
	std::vector<int> vills, army, buildings;
	// (Godot-only, sim/civ: an Egyptian seat plays its own civ: Laborers, drop
	// sites, Monuments for favor, its Barracks and Migdol, the Pharaoh empowering)
	const bool eg = egypt();
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r] || U.owner[r] != owner || U.dead[r]) continue;
		if (eg && U.type[r] == U_PHARAOH) continue; // (he empowers: egypt_pharaoh)
		(unit_def(U.type[r]).gatherer ? vills : army).push_back(r);
	}
	for (int b = 0; b < B.size(); b++)
		if (!B.removed[b] && B.owner[b] == owner && !B.dead[b]) buildings.push_back(b);
	if (S.godot_rules) {
		power_timer -= par.think;
		if (par.power_every > 0 && power_timer <= 0) {
			power_timer = difficulty == AI_DEFAULT ? POWER_EVERY : par.power_every;
			use_powers(army, buildings);
		}
	}
	int tc = -1;
	for (int b : buildings)
		if (B.type[b] == B_TOWN_CENTER && B.built[b]) { tc = b; break; }
	if (tc < 0) return;
	const int nv = (int)vills.size();

	// saving food for the Classical Age (minotaurs need it)
	Cost age_cost;
	const bool has_age_cost = S.economy.next_age_cost(owner, age_cost);
	// (Godot-only: it saves for the next age on its age plan instead, the
	// cost held back from the army and the towers until it can pay:
	// enemy_ai_techs.cpp; villagers go on whatever it saves for up to
	// archaic_villagers in the Archaic Age, a dozen while it saves for an age later, 30 while it
	// saves for a tech or a building, then out of what is left over)
	const bool saving = S.godot_rules ? escrow_item_ >= 2000 && escrow_item_ < 2004
			: p.age < 1 && !p.advancing && has_age_cost && nv >= 16 && S.time >= 300 && S.time < 540 && !p.can_afford(age_cost);
	// 1. villagers
	const int worker = eg ? U_LABORER : U_VILLAGER;
	if ((S.godot_rules ? escrow_item_ < 0 || nv < (p.age == 0 ? par.archaic_villagers : saving ? 12 : 30) || escrow_allows(unit_def(worker).cost) : !saving) && nv < (S.godot_rules ? par.villagers_rules : par.max_villagers) && (int)B.queue[tc].size() < par.villager_queue)
		S.economy.train(tc, worker);
	int counts[3] = { 0, 0, 0 };
	std::vector<int> by_type[3];
	for (int v : vills)
		if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] < 3) {
			counts[U.econ_res_type[v]]++;
			by_type[U.econ_res_type[v]].push_back(v);
		}
	int workers = 0;
	for (int v : vills) workers += U.order_type[v] == O_IDLE || U.order_type[v] == O_GATHER;
	// shares of the workers per resource (food, wood, gold): the browser's 0.5 / 0.3 / 0.2;
	// a harder AI weighs food (villagers, soldiers, the next age) and stops
	// piling up what it cannot spend
	double sh[3] = { 0.5, 0.3, 0.2 };
	if (par.food_share > 0) {
		sh[RES_FOOD] = par.food_share;
		sh[RES_GOLD] = p.res[RES_GOLD] > par.bank_cap ? 0.08 : par.gold_share;
		// (Godot-only: the wall ring or a tower waits for gold: more hands on it)
		if (S.godot_rules && (line_gold_ > p.res[RES_GOLD] || want_gold_)) sh[RES_GOLD] = std::max(sh[RES_GOLD], 0.3);
		if (p.res[RES_WOOD] > par.bank_cap) sh[RES_WOOD] = 0.15;
		sh[RES_WOOD] = std::min(sh[RES_WOOD], 1 - sh[RES_FOOD] - sh[RES_GOLD]);
		sh[RES_FOOD] = 1 - sh[RES_WOOD] - sh[RES_GOLD];
	}
	// (Godot-only, sim/civ: gold is an Egyptian's wood: its Farms, Town Centers,
	// Temple, Barracks, Migdol, towers and most soldiers cost gold; wood only its
	// Slingers and Chariot Archers: a few hands in the woods)
	if (eg) {
		const double f = par.food_share > 0 ? par.food_share : 0.5;
		sh[RES_WOOD] = p.res[RES_WOOD] > 300 ? 0.04 : 0.12;
		sh[RES_GOLD] = p.res[RES_GOLD] > 1200 ? 0.15 : 1 - f - sh[RES_WOOD];
		sh[RES_FOOD] = 1 - sh[RES_WOOD] - sh[RES_GOLD];
	}
	// (Godot-only: what it saves for lacks gold: more hands on gold, for
	// every difficulty; enemy_ai_techs.cpp)
	if (S.godot_rules && tech_gold_ && sh[RES_GOLD] < 0.3) {
		sh[RES_GOLD] = 0.3;
		sh[RES_FOOD] = std::max(0.25, 1 - sh[RES_WOOD] - sh[RES_GOLD]);
		sh[RES_WOOD] = 1 - sh[RES_FOOD] - sh[RES_GOLD];
	}
	// (Godot-only: the next age waits for food: more hands on food)
	if (S.godot_rules && tech_food_ && sh[RES_FOOD] < 0.55) {
		sh[RES_FOOD] = 0.55;
		const double rest = sh[RES_WOOD] + sh[RES_GOLD];
		sh[RES_WOOD] = rest > 0 ? 0.45 * sh[RES_WOOD] / rest : 0.2;
		sh[RES_GOLD] = 1 - sh[RES_FOOD] - sh[RES_WOOD];
	}
	// (Godot-only: from the Classical Age farms, houses and towers all want
	// wood while it saves food and gold for the next age: a fifth of the
	// hands in the woods at least while it is short)
	if (S.godot_rules && !eg && p.age >= 1 && p.res[RES_WOOD] < 150 && sh[RES_WOOD] < 0.2) {
		const double take = 0.2 - sh[RES_WOOD];
		sh[RES_WOOD] = 0.2;
		if (sh[RES_FOOD] - take >= 0.3) sh[RES_FOOD] -= take;
		else sh[RES_GOLD] = std::max(0.05, sh[RES_GOLD] - take);
		sh[RES_FOOD] = 1 - sh[RES_WOOD] - sh[RES_GOLD];
	}
	// (Godot-only: the next stretch of the wall ring waits for wood: more
	// hands in the woods, or the army's toxotes eat every log and the ring
	// never rises; or what it saves for lacks wood)
	if (S.godot_rules && (line_wood_ > p.res[RES_WOOD] || tech_wood_) && sh[RES_WOOD] < 0.4) {
		sh[RES_WOOD] = 0.4;
		sh[RES_FOOD] = std::max(0.2, 1 - sh[RES_WOOD] - sh[RES_GOLD]);
		sh[RES_GOLD] = 1 - sh[RES_WOOD] - sh[RES_FOOD];
	}
	// (Godot-only: a food pile it cannot spend, wood / gold short: the
	// farmers go to the woods and the mines, or an AI-vs-AI match drags on
	// with 9000 food and no gold for one more soldier)
	if (S.godot_rules && p.res[RES_FOOD] > FOOD_GLUT && (p.res[RES_WOOD] < 300 || p.res[RES_GOLD] < 300)) {
		sh[RES_FOOD] = 0.2;
		sh[RES_WOOD] = 0.4;
		sh[RES_GOLD] = 0.4;
	}
	const int target[3] = { (int)std::ceil(workers * sh[0]), (int)std::floor(workers * sh[1]), (int)std::floor(workers * sh[2]) };
	// ['food', 'wood', 'gold'].sort(...)[0]: the most under-staffed, ties to the first
	auto need = [&]() {
		int best = 0;
		for (int k = 1; k < 3; k++)
			if (counts[k] - target[k] < counts[best] - target[best]) best = k;
		return best;
	};
	for (int v : vills) {
		if (U.order_type[v] != O_IDLE) continue;
		const int want = need();
		if (assign(v, want, tc, buildings)) counts[want]++;
		else if (assign(v, RES_WOOD, tc, buildings)) counts[RES_WOOD]++;
	}
	// rebalance: move one worker per tick from the most over-staffed resource
	const int lack = need();
	if (counts[lack] < target[lack]) {
		int over = 0;
		for (int k = 1; k < 3; k++)
			if (counts[k] - target[k] > counts[over] - target[over]) over = k;
		if (over != lack && counts[over] > target[over]) {
			for (int v : by_type[over])
				if (!(U.carry_amount[v] != 0) || U.carry_amount[v] < 3) {
					assign(v, lack, tc, buildings);
					break;
				}
		}
	}

	// 2. houses
	auto building = [&](int t) {
		for (int b : buildings)
			if (B.type[b] == t && !B.built[b]) return true;
		return false;
	};
	if (p.pop_cap - p.pop < par.house_margin && p.pop_cap < 300 && !building(B_HOUSE)) try_build(B_HOUSE, pick_builder(vills), tc);
	// 3. military
	int academy = -1, temple_any = -1, temple = -1, academy2 = -1;
	// (an Egyptian: the Barracks from the Classical Age, a Migdol Stronghold, its
	// second military building, from the Heroic Age: the Mythic Age needs one)
	const int ACAD = eg ? B_EG_BARRACKS : B_BARRACKS, ACAD2 = eg ? B_MIGDOL : B_BARRACKS;
	for (int b : buildings) {
		if (eg ? academy2 < 0 && B.type[b] == ACAD2 : academy >= 0 && academy2 < 0 && B.type[b] == ACAD2) academy2 = b;
		if (academy < 0 && B.type[b] == ACAD) academy = b;
		if (temple_any < 0 && B.type[b] == B_TEMPLE) temple_any = b;
		if (temple < 0 && B.type[b] == B_TEMPLE && B.built[b]) temple = b;
	}
	if (academy < 0 && nv >= par.academy_at && (!eg || p.age >= 1)) try_build(ACAD, pick_builder(vills), tc);
	if (temple_any < 0 && nv >= par.temple_at && (!eg || p.age >= 1)) try_build(B_TEMPLE, pick_builder(vills), tc); // (an Egyptian's gold goes to Laborers' Farms first)
	if (eg) {
		// (the Migdol: every difficulty that goes past the Heroic Age, or the Mythic Age never comes)
		if (academy >= 0 && academy2 < 0 && p.age >= 2 && !building(B_MIGDOL)) try_build(B_MIGDOL, pick_builder(vills), tc);
	} else if (par.academy2_at > 0 && academy >= 0 && academy2 < 0 && temple_any >= 0 && nv >= par.academy2_at && !building(B_BARRACKS))
		try_build(B_BARRACKS, pick_builder(vills), tc);
	static const int PICK[4] = { U_HOPLITE, U_TOXOTES, U_HOPLITE, U_HIPPIKON };
	// (Egyptian: the Barracks' Spearmen (vs cavalry), Slingers (vs infantry), Axemen
	// (vs infantry, heroes); the Migdol's Camel Riders, Chariot Archers, War Elephants)
	static const int EPICK[4] = { U_SPEARMAN, U_SLINGER, U_AXEMAN, U_SPEARMAN };
	static const int EPICK2[4] = { U_CAMEL_RIDER, U_CHARIOT_ARCHER, U_CAMEL_RIDER, U_WAR_ELEPHANT };
	const int *pick_a = eg ? EPICK : PICK, *pick_b = eg ? EPICK2 : PICK;
	// (Godot-only: with an army at home, the wood for the next stretch of wall / the next tower comes first)
	int home = 0; // (soldiers by the Town Center: a wave out does not count)
	if (S.godot_rules)
		for (int u : army) home += jsm::hypot(U.x[u] - B.x[tc], U.z[u] - B.z[tc]) < STRAY_DIST;
	const bool walls_first = S.godot_rules && wall_saving(home);
	// (Godot-only: what it saves for, an Armory / a Market / the next age / a tech, stays in the bank: enemy_ai_techs.cpp)
	// (Godot-only: a guard of par.guard soldiers trains whatever it saves
	// for: an AI saving for its next age with one spearman at home was
	// overrun by the first wave and lost half its villagers)
	const bool guard_short = (int)army.size() < par.guard;
	const int pick1 = pick_a[(int64_t)std::floor(S.time / 7) % 4], pick2 = pick_b[((int64_t)std::floor(S.time / 7) + 1) % 4];
	if (academy >= 0 && B.built[academy] && (int)B.queue[academy].size() < par.army_queue && (!saving || par.army_while_saving) && !walls_first &&
			(!S.godot_rules || guard_short || escrow_allows(unit_def(pick1).cost)))
		S.economy.train(academy, pick1);
	if (academy2 >= 0 && B.built[academy2] && (int)B.queue[academy2].size() < par.army_queue && (!saving || par.army_while_saving) && !walls_first &&
			(!S.godot_rules || guard_short || escrow_allows(unit_def(pick2).cost)))
		S.economy.train(academy2, pick2);
	if (eg) {
		// (an Egyptian Temple trains Priests: two from the Heroic Age, healers that go with the waves)
		if (temple >= 0 && p.age >= 2 && B.queue[temple].empty() && S.civs.count_type(owner, U_PRIEST) < 2 && escrow_allows(unit_def(U_PRIEST).cost) &&
				p.res[RES_GOLD] >= unit_def(U_PRIEST).cost.v[RES_GOLD] + 100)
			S.economy.train(temple, U_PRIEST);
		// (foes at its town, its camps out by the woods and mines: the men at home go
		// at them; at the Town Center with no soldier at all (none before the
		// Classical Age), Mercenaries, the Egyptians' stopgap, Retold)
		int threat = -1;
		for (int b : buildings)
			if (!is_wall_piece(B.type[b]) && S.combat.find_enemy_near(B.x[b], B.z[b], owner, 14) >= 0) { threat = b; break; }
		if (threat >= 0) {
			// (a few, at the Town Center itself, no soldier left, gold to spare: they
			// decay, and its Farms and Barracks want the gold more)
			if (army.empty() && threat == tc && S.civs.count_type(owner, U_MERCENARY) < 3 && p.res[RES_GOLD] >= 200 && B.queue[tc].size() < 3)
				S.economy.train(tc, U_MERCENARY);
			std::vector<int> def;
			for (int u : army)
				if ((U.order_type[u] == O_IDLE || (U.order_type[u] == O_ATTACK && (U.order_b[u] & ATK_AUTO))) && jsm::hypot(U.x[u] - B.x[threat], U.z[u] - B.z[threat]) < 45)
					def.push_back(u);
			if (!def.empty()) S.commands.move(def, B.x[threat], B.z[threat], O_ATTACK_MOVE);
		}
		egypt_monuments(tc, vills, buildings);
		egypt_pharaoh(tc, buildings);
	} else if (temple >= 0 && p.age >= 1 && B.queue[temple].size() < 1 && (!S.godot_rules || escrow_allows(unit_def(U_MINOTAUR).cost))) S.economy.train(temple, U_MINOTAUR);
	// worshippers (an Egyptian's Laborers never worship: favor from its Monuments)
	if (temple >= 0 && !eg) {
		int worshipping = 0;
		for (int v : vills) worshipping += U.order_type[v] == O_WORSHIP;
		// Godot-only: never more than a quarter of the villagers at prayer (a
		// town worn down to a handful of men must feed itself again: with
		// every last villager worshipping an AI-vs-AI match could never end)
		// (and with the favor at its cap of 200, one prayer is enough: the
		// rest gather what the techs and the next age need)
		int want = S.godot_rules ? std::min(par.worshippers, nv / 4) : par.worshippers;
		if (S.godot_rules && p.res[RES_FAVOR] >= 190) want = std::min(want, 1);
		if (S.godot_rules && worshipping > want)
			for (int v : vills)
				if (worshipping > want && U.order_type[v] == O_WORSHIP) {
					S.commands.idle(v);
					worshipping--;
				}
		if (worshipping < want) {
			for (int v : vills)
				if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] == RES_GOLD) {
					S.commands.order(v, Order::with_target(O_WORSHIP, B.id[temple]));
					break;
				}
		}
	}
	// 4. age up
	if (S.godot_rules) {
		// (Godot-only: on its age plan, as soon as it can pay from its saving's start)
		if (!p.advancing && p.age < 1 && has_age_cost && S.time >= par.classical_at - par.age_lead && p.can_afford(age_cost)) S.economy.advance_age(owner);
	} else if (!p.advancing && p.age < 1 && has_age_cost && S.time >= par.age_after && (p.res[RES_FOOD] > 500 || (nv >= 16 && p.can_afford(age_cost))))
		S.economy.advance_age(owner);

	// Godot-only: a storehouse by a wood line / mine far from every drop-off
	if (S.godot_rules) {
		if (eg) egypt_camps(tc, vills, buildings);
		else storehouses(tc, vills, buildings);
	}
	// Godot-only: a foundation nobody builds any more gets a villager
	if (S.godot_rules) finish_sites(vills, buildings);
	// Godot-only: the Armory, the Market, their techs and the Temple's, the
	// Heroic / Mythic Ages, Market trades (enemy_ai_techs.cpp)
	if (S.godot_rules) research(tc, vills, buildings, false); // (its own savings: the age plan's escrow)
	// Godot-only: towers, the wall ring, upgrades, repairs; breaking enemy walls, tower fear
	if (S.godot_rules) {
		ScopedTimer ft(S.prof.enabled ? &S.prof.sub["ai.fortify"] : nullptr);
		fortify(tc, vills, army, buildings, saving && !S.godot_rules); // (the age plan's savings do not hold the walls and towers back)
	}

	// 5. attack waves
	std::vector<int> idle_army;
	for (int u : army)
		if (U.order_type[u] == O_IDLE || (U.order_type[u] == O_ATTACK && (U.order_b[u] & ATK_AUTO))) idle_army.push_back(u);
	// Godot-only: a wave overdue by a whole interval (the army cannot grow to
	// wave_size: a starved economy, a population cap) goes with what there is
	const bool overdue = S.godot_rules && S.time >= next_wave_at + 120 / aggression && (int)idle_army.size() >= OVERDUE_MIN;
	// (an Egyptian has no soldiers before its Barracks, in the Classical Age: its
	// first wave waits five minutes past it, and its waves are a third bigger:
	// its men cost less and are 1 pop, the Greek town has its towers by then)
	const bool eg_early = eg && (techs.age_at[1] < 0 || S.time < techs.age_at[1] + EG_FIRST_WAVE);
	const int need_men = eg ? wave_size + wave_size / 3 : wave_size;
	if (S.time >= next_wave_at && !eg_early && ((int)idle_army.size() >= need_men || overdue)) {
		// (Godot-only: a weak wave keeps clear of enemy towers, see enemy_ai_fort.cpp)
		const int t = S.godot_rules ? pick_target(tc, (int)idle_army.size(), overdue) : find_target(tc);
		if (t >= 0) {
			const int32_t tid = B.id[t];
			WaveLog w{ S.time, tid, B.x[t], B.z[t], {} };
			for (int u : idle_army) w.units.push_back(U.id[u]);
			waves.push_back(std::move(w));
			if (S.godot_rules) // Godot-only: attack-move there, fighting what they meet on the way
				S.commands.move(idle_army, B.x[t], B.z[t], O_ATTACK_MOVE, AM_THEN_BUILDINGS);
			else
				for (int u : idle_army) {
					Order o = Order::with_target(O_ATTACK, tid);
					o.b = ATK_THEN_BUILDINGS;
					S.commands.order(u, o);
				}
			wave_size = std::min(par.wave_max, wave_size + par.wave_grow);
			next_wave_at = S.time + 120 / aggression;
		}
	} else if (S.godot_rules) {
		// Godot-only: men of a wave left idle far from home (a Lightning Storm
		// drops the men it throws idle) press on instead of standing about
		std::vector<int> strays;
		for (int u : idle_army)
			if (U.order_type[u] == O_IDLE && jsm::hypot(U.x[u] - B.x[tc], U.z[u] - B.z[tc]) > STRAY_DIST) strays.push_back(u);
		const int t = strays.empty() ? -1 : find_target(tc);
		if (t >= 0) S.commands.move(strays, B.x[t], B.z[t], O_ATTACK_MOVE, AM_THEN_BUILDINGS);
	}
}

// God powers, through the same GodPowers::can_cast / cast as the player's
// HUD (favor costs and cooldowns included). Every POWER_EVERY s, among the
// enemy units near our army or base: a Lightning Storm on the densest
// cluster (at least STORM_MIN men inside the strike radius), else a Meteor
// on a clump of enemy buildings near our army or a big enemy army, else a
// Bolt on the most valuable single target (a myth unit or hero first; a
// plain unit only when favor is plentiful). Deterministic: no random draws,
// ties go to the first candidate in row order.
void EnemyAI::use_powers(const std::vector<int> &army, const std::vector<int> &buildings) {
	Sim &S = *sim;
	GodPowers &G = S.godpowers;
	const bool storm_ok = G.can_cast(owner, GP_LIGHTNING_STORM).ok, meteor_ok = G.can_cast(owner, GP_METEOR).ok,
			   bolt_ok = G.can_cast(owner, GP_BOLT).ok;
	if (!storm_ok && !meteor_ok && !bolt_ok) return;
	const UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	const GameMap &map = S.map();
	// reach: coarse cells (4 tiles) near our soldiers and buildings
	const int CELL = 4, M = (map.size + CELL - 1) / CELL;
	reach_.assign((size_t)M * M, 0);
	auto mark = [&](double x, double z, double r) {
		int c0x, c1x, c0z, c1z;
		if (!cell_span(x - r, x + r, CELL, M, c0x, c1x) || !cell_span(z - r, z + r, CELL, M, c0z, c1z)) return;
		for (int cz = c0z; cz <= c1z; cz++)
			for (int cx = c0x; cx <= c1x; cx++) {
				const double dx = (cx + 0.5) * CELL - x, dz = (cz + 0.5) * CELL - z;
				if (dx * dx + dz * dz <= (r + CELL * 0.71) * (r + CELL * 0.71)) reach_[(size_t)cz * M + cx] = 1;
			}
	};
	for (int u : army) mark(U.x[u], U.z[u], REACH_ARMY);
	for (int b : buildings) mark(B.x[b], B.z[b], REACH_BASE);
	auto in_reach = [&](double x, double z) {
		if (!(x >= 0 && z >= 0 && x < M * CELL && z < M * CELL)) return false; // (checked before the cast)
		return reach_[(size_t)(int)(z / CELL) * M + (int)(x / CELL)] != 0;
	};
	// enemy units in reach (on the ground: men carried up a storm are spoken for)
	std::vector<int> foes;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.gp_state[r] != 1 && sim->is_enemy(owner, U.owner[r]) && in_reach(U.x[r], U.z[r])) foes.push_back(r);
	// the densest cluster of `foes` within radius r: count, centre
	auto cluster = [&](double r, double &ox, double &oz) {
		int best = 0;
		const double r2 = r * r;
		const size_t n = foes.size(), step = std::max<size_t>(1, n / MAX_CENTRES);
		for (size_t i = 0; i < n; i += step) {
			const double cx = U.x[foes[i]], cz = U.z[foes[i]];
			int k = 0;
			double sx = 0, sz = 0;
			for (int o : foes) {
				const double dx = U.x[o] - cx, dz = U.z[o] - cz;
				if (dx * dx + dz * dz <= r2) {
					k++;
					sx += U.x[o];
					sz += U.z[o];
				}
			}
			if (k <= best) continue;
			// re-centre on the men caught, keep it if it catches as many
			const double mx = sx / k, mz = sz / k;
			int km = 0;
			for (int o : foes) {
				const double dx = U.x[o] - mx, dz = U.z[o] - mz;
				km += dx * dx + dz * dz <= r2;
			}
			best = std::max(k, km);
			ox = km >= k ? mx : cx;
			oz = km >= k ? mz : cz;
		}
		return best;
	};
	const int storm_min = difficulty == AI_DEFAULT ? STORM_MIN : par.storm_min;
	if (storm_ok && (int)foes.size() >= storm_min) {
		double x = 0, z = 0;
		// the storm strikes men within 0.78 of its radius (GodPowers::update)
		if (cluster(power_def(GP_LIGHTNING_STORM).radius * 0.78, x, z) >= storm_min && G.cast(owner, GP_LIGHTNING_STORM, x, z)) {
			casts[GP_LIGHTNING_STORM]++;
			return;
		}
	}
	if (meteor_ok) {
		const double R = power_def(GP_METEOR).radius;
		// a clump of enemy buildings our army stands by (Godot-only: wall
		// pieces do not count: a Meteor is for the town, the men break the wall)
		int best = 0;
		double bx = 0, bz = 0;
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || !sim->is_enemy(owner, B.owner[b]) || is_wall_piece(B.type[b]) || !in_reach(B.x[b], B.z[b])) continue;
			int k = 0;
			for (int o = 0; o < B.size(); o++) {
				if (B.removed[o] || B.dead[o] || !sim->is_enemy(owner, B.owner[o]) || is_wall_piece(B.type[o])) continue;
				const BuildingDef &od = building_def(B.type[o]);
				if (jsm::hypot(B.x[o] - B.x[b], B.z[o] - B.z[b]) < R + std::max(od.w, od.h) / 2.0) k++;
			}
			if (k > best) {
				best = k;
				bx = B.x[b];
				bz = B.z[b];
			}
		}
		double ux = 0, uz = 0;
		const int men = (int)foes.size() >= METEOR_UNITS ? cluster(R * 0.8, ux, uz) : 0;
		const bool on_men = men >= METEOR_UNITS, on_town = best >= METEOR_BUILDINGS;
		if ((on_men || on_town) && G.cast(owner, GP_METEOR, on_men ? ux : bx, on_men ? uz : bz)) {
			casts[GP_METEOR]++;
			return;
		}
	}
	if (bolt_ok && !foes.empty()) {
		// value: myth units and heroes first (by hp left), then the dearest unit
		int best = -1;
		double bv = 0;
		const bool spare = S.players[owner].res[RES_FAVOR] >= BOLT_SPARE_FAVOR;
		for (int o : foes) {
			const UnitDef &d = unit_def(U.type[o]);
			double v;
			if (d.myth || d.hero) v = 10000 + U.hp[o];
			else if (spare && !d.gatherer) v = d.cost.v[RES_FOOD] + d.cost.v[RES_WOOD] + d.cost.v[RES_GOLD] + d.cost.v[RES_FAVOR] * 3;
			else continue;
			if (v > bv) {
				bv = v;
				best = o;
			}
		}
		// (the bolt picks the unit nearest the point: cast right on the target)
		if (best >= 0 && G.cast(owner, GP_BOLT, U.x[best], U.z[best])) casts[GP_BOLT]++;
	}
}

// Send a villager to gather a resource type; food falls back to farms.
bool EnemyAI::assign(int v, int res, int tc, const std::vector<int> &buildings) {
	Sim &S = *sim;
	Entities &E = S.entities;
	const BuildingStore &B = E.buildings;
	// (Godot-only: from the Classical Age wild food farther than 18 from the
	// Town Center is not worth the walk: a farm is built instead, or 40
	// villagers fed a whole town out of a far berry bush and the next age
	// waited minutes for food; in the Archaic Age wood is too short for farms)
	const double reach = res == RES_GOLD ? 45 : res == RES_FOOD && S.godot_rules && S.players[owner].age >= 1 ? 18 : 34;
	int32_t r = S.economy.nearest_resource(B.x[tc], B.z[tc], res, reach);
	// Godot-only: the mines and woods by the town worked out, go farther (a
	// late game without gold or wood within reach would starve and stall)
	if (!r && S.godot_rules && res != RES_FOOD) r = S.economy.nearest_resource(B.x[tc], B.z[tc], res, 80);
	if (r) return S.commands.order(v, Order::with_target(O_GATHER, r));
	if (res != RES_FOOD) return false;
	for (int b : buildings) {
		if (!building_def(B.type[b]).farm || !B.built[b]) continue;
		const int fs = B.farmer[b] ? E.unit_slot(B.farmer[b]) : -1;
		if (fs >= 0 && E.units.order_target[fs] == B.id[b]) continue;
		return S.commands.order(v, Order::with_target(O_GATHER, B.id[b]));
	}
	for (int b : buildings) {
		if (!building_def(B.type[b]).farm || B.built[b]) continue;
		if (!S.godot_rules) return false;
		// Godot-only: a farm foundation left without a builder (its villager
		// died or was called away) is built by this one; one that stays unbuilt
		// for a minute and a half of tries is pulled down and paid back, so
		// food can come in again (an AI with no farm going up starved for good)
		const int32_t fid = B.id[b];
		double first = -1;
		for (const auto &kv : farm_tries_)
			if (kv.first == fid) first = kv.second;
		if (first < 0) farm_tries_.push_back({ fid, first = S.time });
		if (S.time - first > 90) {
			S.players[owner].refund(egypt() ? build_cost(B_FARM) : building_def(B_FARM).cost);
			S.buildings.destroy(fid);
			farm_tries_.erase(std::remove_if(farm_tries_.begin(), farm_tries_.end(), [&](const std::pair<int32_t, double> &kv) { return kv.first == fid; }), farm_tries_.end());
			return false;
		}
		for (int u = 0; u < E.units.size(); u++)
			if (!E.units.removed[u] && !E.units.dead[u] && E.units.owner[u] == owner && E.units.order_type[u] == O_BUILD && E.units.order_target[u] == fid) return false;
		return S.commands.order(v, Order::with_target(O_BUILD, fid));
	}
	return try_build(B_FARM, v, tc);
}

// Godot-only: the woods / mines being worked have moved far from every
// drop-off (the near ones cut, a wall ring between the town and the forest):
// a storehouse goes up by them, so the trips stay short (an AI-vs-AI match
// otherwise ends with 30 villagers walking 80 tiles per load, no wood, no
// gold, no army). One at a time, at most STORE_MAX, no rng draw.
void EnemyAI::storehouses(int, const std::vector<int> &vills, const std::vector<int> &buildings) {
	Sim &S = *sim;
	Entities &E = S.entities;
	const UnitStore &U = E.units;
	const BuildingStore &B = E.buildings;
	const ResourceStore &R = E.resources;
	store_t_ -= par.think;
	if (store_t_ > 0) return;
	store_t_ = STORE_EVERY;
	int have = 0;
	for (int b : buildings)
		if (B.type[b] == B_STOREHOUSE) {
			if (!B.built[b]) return; // (one going up)
			have++;
		}
	Player &p = S.players[owner];
	const Cost &c = building_def(B_STOREHOUSE).cost;
	if (have >= STORE_MAX || !p.can_afford(c)) return;
	for (int res = RES_WOOD; res <= RES_GOLD; res++) {
		int far = 0, first = -1, rs = -1;
		for (int v : vills) {
			if (U.order_type[v] != O_GATHER || U.econ_res_type[v] != res) continue;
			const int s = E.resource_slot(U.order_target[v]);
			if (s < 0) continue;
			const int32_t d = S.economy.nearest_dropoff(owner, R.x[s], R.z[s], res);
			const int ds = d ? E.building_slot(d) : -1;
			if (ds >= 0 && jsm::hypot(B.x[ds] - R.x[s], B.z[ds] - R.z[s]) < STORE_FAR) continue;
			far++;
			if (first < 0) {
				first = v;
				rs = s;
			}
		}
		if (far < STORE_MEN) continue;
		// the nearest open spot round that node (3x3, a tile clear round it)
		const double rx = R.x[rs], rz = R.z[rs];
		for (int r = 2; r <= 8; r++)
			for (int i = 0; i < 16; i++) {
				const double a = PI * 2 * i / 16;
				const int tx = (int)std::floor(rx + jsm::cos(a) * r) - 1, tz = (int)std::floor(rz + jsm::sin(a) * r) - 1;
				if (!S.buildings.can_place(B_STOREHOUSE, tx, tz) || !gap_ok(tx, tz, 3, 3) || reserved(tx, tz, 3, 3)) continue;
				p.pay(c);
				const int b = S.buildings.spawn(B_STOREHOUSE, owner, tx, tz, false);
				if (b < 0) return;
				S.commands.order(first, Order::with_target(O_BUILD, B.id[b]));
				fort.storehouses++;
				return;
			}
	}
}

// Godot-only: a foundation of its own (not a farm, nor a wall piece: those
// have their own builders) with no villager on it, its builder killed or
// sent elsewhere, gets the nearest gatherer, unless foes stand at it. An
// Armory left a stake in the ground for good kept a whole AI out of the
// Heroic Age.
void EnemyAI::finish_sites(const std::vector<int> &vills, const std::vector<int> &buildings) {
	Sim &S = *sim;
	const UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	site_t_ -= par.think;
	if (site_t_ > 0) return;
	site_t_ = SITE_EVERY;
	for (int b : buildings) {
		if (B.built[b] || B.dead[b] || building_def(B.type[b]).farm || is_wall_piece(B.type[b])) continue;
		bool manned = false;
		for (int v : vills)
			if (U.order_type[v] == O_BUILD && U.order_target[v] == B.id[b]) { manned = true; break; }
		if (manned || S.combat.find_enemy_near(B.x[b], B.z[b], owner, SITE_SAFE) >= 0) continue;
		int best = -1;
		double bd = INFINITY;
		for (int v : vills) {
			if (U.order_type[v] != O_GATHER && U.order_type[v] != O_IDLE) continue;
			const double d = jsm::hypot(U.x[v] - B.x[b], U.z[v] - B.z[b]);
			if (d < bd) { bd = d; best = v; }
		}
		if (best < 0) return;
		S.commands.order(best, Order::with_target(O_BUILD, B.id[b]));
		return; // (one a check)
	}
}

int EnemyAI::pick_builder(const std::vector<int> &vills) const {
	const UnitStore &U = sim->entities.units;
	for (int v : vills)
		if (U.order_type[v] == O_GATHER && U.econ_phase[v] != EP_NONE && U.econ_res_type[v] == RES_WOOD) return v;
	for (int v : vills)
		if (U.order_type[v] == O_IDLE) return v;
	return vills.empty() ? -1 : vills[0];
}

int EnemyAI::find_target(int tc) const {
	const BuildingStore &B = sim->entities.buildings;
	int best = -1;
	double bd = INFINITY;
	for (int b = 0; b < B.size(); b++) {
		if (B.removed[b] || !sim->is_enemy(owner, B.owner[b])) continue;
		if (is_wall_piece(B.type[b])) continue; // (Godot-only pieces: waves breach them on the way)
		const double dx = B.x[b] - B.x[tc], dz = B.z[b] - B.z[tc];
		const double d = dx * dx + dz * dz;
		if (d < bd) {
			bd = d;
			best = b;
		}
	}
	return best;
}

bool EnemyAI::try_build(int type, int builder, int tc) {
	Sim &S = *sim;
	Player &p = S.players[owner];
	const Cost cost = egypt() ? build_cost(type) : S.godot_rules ? rules_building_cost(type) : building_def(type).cost; // (Godot-only: Retold's Temple, sim/techs; an Egyptian's own costs, sim/civ)
	if (builder < 0 || !p.can_afford(cost)) return false;
	if (egypt() && !S.civs.can_build(owner, type)) return false; // (sim/civ: its civ's types, ages, limits)
	// (Godot-only: what it saves for stays in the bank: no farm or storehouse
	// out of the Armory's wood; houses and the saved-for building itself go on)
	if (S.godot_rules && type != B_HOUSE && escrow_item_ != 1000 + type && !escrow_allows(cost)) return false;
	int tx, tz;
	if (!find_spot(type, tc, tx, tz)) return false;
	p.pay(cost);
	const int b = S.buildings.spawn(type, owner, tx, tz, false);
	S.commands.order(builder, Order::with_target(O_BUILD, S.entities.buildings.id[b]));
	return true;
}

bool EnemyAI::find_spot(int type, int tc, int &otx, int &otz) {
	Sim &S = *sim;
	const BuildingDef &def = building_def(type);
	const BuildingStore &B = S.entities.buildings;
	const double cx = std::floor(B.x[tc]), cz = std::floor(B.z[tc]);
	for (int r = 6; r < 24; r += 1) {
		for (int k = 0; k < 16; k++) {
			const double a = S.rng.range(0, PI * 2);
			const int tx = (int)js_round(cx + jsm::cos(a) * r - def.w / 2.0), tz = (int)js_round(cz + jsm::sin(a) * r - def.h / 2.0);
			// leave a one-tile gap around buildings so paths stay open
			// (Godot-only: never on an opening of our wall ring)
			if (S.buildings.can_place(type, tx, tz) && gap_ok(tx, tz, def.w, def.h) && !(S.godot_rules && reserved(tx, tz, def.w, def.h))) {
				otx = tx;
				otz = tz;
				return true;
			}
		}
	}
	return false;
}

bool EnemyAI::gap_ok(int tx, int tz, int w, int h) const {
	const GameMap &map = sim->map();
	for (int z = tz - 1; z <= tz + h; z++)
		for (int x = tx - 1; x <= tx + w; x++)
			if (!map.is_walkable(x, z)) return false;
	return true;
}

// ---- an Egyptian seat (Godot-only, sim/civ) ---------------------------------------

bool EnemyAI::egypt() const { return sim->godot_rules && sim->civs.civ(owner) == CIV_EGYPT; }

Cost EnemyAI::build_cost(int type) const { return egypt() ? sim->civs.cost(owner, type) : building_def(type).cost; } // (a Greek: the def's, as before)

static const double EG_CAMP_FAR = 9;  // a node worked this far from every drop site of its kind gets a camp
static const int EG_CAMP_MAX = 4;     // camps of each kind at most

// Laborers drop food only at a Granary, wood at a Lumber Camp, gold at a
// Mining Camp (or the Town Center): a free camp goes up by every food / wood /
// gold node worked away from one, as Retold's AI does (one rising at a time).
void EnemyAI::egypt_camps(int, const std::vector<int> &vills, const std::vector<int> &buildings) {
	Sim &S = *sim;
	Entities &E = S.entities;
	const UnitStore &U = E.units;
	const BuildingStore &B = E.buildings;
	const ResourceStore &R = E.resources;
	store_t_ -= par.think;
	if (store_t_ > 0) return;
	store_t_ = STORE_EVERY;
	static const int CAMP[3] = { B_GRANARY, B_LUMBER_CAMP, B_MINING_CAMP };
	int have[3] = { 0, 0, 0 };
	for (int b : buildings)
		for (int k = 0; k < 3; k++)
			if (B.type[b] == CAMP[k]) {
				if (!B.built[b]) return; // (one going up)
				have[k]++;
			}
	Player &p = S.players[owner];
	for (int res = RES_FOOD; res <= RES_GOLD; res++) {
		const int type = CAMP[res];
		const Cost c = build_cost(type);
		if (have[res] >= EG_CAMP_MAX || !p.can_afford(c) || !S.civs.can_build(owner, type)) continue;
		int first = -1, rs = -1;
		for (int v : vills) {
			if (U.order_type[v] != O_GATHER || U.econ_res_type[v] != res) continue;
			const int s = E.resource_slot(U.order_target[v]);
			if (s < 0) continue; // (a farm: by the Town Center)
			const int32_t d = S.economy.nearest_dropoff(owner, R.x[s], R.z[s], res);
			const int ds = d ? E.building_slot(d) : -1;
			if (ds >= 0 && jsm::hypot(B.x[ds] - R.x[s], B.z[ds] - R.z[s]) < EG_CAMP_FAR) continue;
			first = v;
			rs = s;
			break;
		}
		if (first < 0) continue;
		const BuildingDef &def = building_def(type);
		const double rx = R.x[rs], rz = R.z[rs];
		for (int r = 2; r <= 8; r++)
			for (int i = 0; i < 16; i++) {
				const double a = PI * 2 * i / 16;
				const int tx = (int)std::floor(rx + jsm::cos(a) * r) - def.w / 2, tz = (int)std::floor(rz + jsm::sin(a) * r) - def.h / 2;
				if (!S.buildings.can_place(type, tx, tz) || !gap_ok(tx, tz, def.w, def.h) || reserved(tx, tz, def.w, def.h)) continue;
				p.pay(c);
				const int b = S.buildings.spawn(type, owner, tx, tz, false);
				if (b < 0) return;
				S.commands.order(first, Order::with_target(O_BUILD, B.id[b]));
				fort.storehouses++;
				return;
			}
	}
}

// Favor: the five Monuments, in order, one rising at a time: the first once a
// few Laborers work, then one more per age (all five in the Mythic Age), each
// with something left over for the army and the next age.
void EnemyAI::egypt_monuments(int tc, const std::vector<int> &vills, const std::vector<int> &buildings) {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	monument_t_ -= par.think;
	if (monument_t_ > 0) return;
	monument_t_ = 5;
	int have = 0;
	for (int b : buildings)
		if (is_monument(B.type[b])) {
			if (!B.built[b]) return;
			have++;
		}
	const Player &p = S.players[owner];
	const int allowed = p.age >= 3 ? MONUMENT_COUNT : p.age + 1;
	if (have >= allowed || (int)vills.size() < 8) return;
	const int type = B_MONUMENT_VILLAGERS + have;
	const Cost c = build_cost(type);
	for (int k = 0; k < RES_COUNT; k++)
		if (c.has[k] && p.res[k] < c.v[k] + 75) return;
	try_build(type, pick_builder(vills), tc);
}

// The Pharaoh empowers (O_EMPOWER): a rising Town Center / Temple / Barracks /
// Migdol / Armory / Market / Monument first (+75 % build), else a military
// building training (+75 %), else one researching, else the Granary (+20 % food
// dropped), else the Town Center. He fights back what attacks him.
void EnemyAI::egypt_pharaoh(int tc, const std::vector<int> &buildings) {
	Sim &S = *sim;
	const UnitStore &U = S.entities.units;
	const BuildingStore &B = S.entities.buildings;
	int ph = -1;
	for (int r = 0; r < U.size() && ph < 0; r++)
		if (!U.removed[r] && !U.dead[r] && U.owner[r] == owner && U.type[r] == U_PHARAOH) ph = r;
	if (ph < 0) return;
	if (U.order_type[ph] == O_ATTACK && S.combat.find_enemy_near(U.x[ph], U.z[ph], owner, 10) >= 0) return;
	auto pick = [&](auto pred) {
		int best = -1;
		double bd = INFINITY;
		for (int b : buildings) {
			if (!pred(b)) continue;
			const double d = jsm::hypot(B.x[b] - B.x[tc], B.z[b] - B.z[tc]);
			if (d < bd) { bd = d; best = b; }
		}
		return best;
	};
	auto big = [&](int t) {
		return t == B_TOWN_CENTER || t == B_TEMPLE || t == B_EG_BARRACKS || t == B_MIGDOL || t == B_ARMORY || t == B_MARKET || is_monument(t);
	};
	int t = pick([&](int b) { return !B.built[b] && big(B.type[b]) && jsm::hypot(B.x[b] - B.x[tc], B.z[b] - B.z[tc]) < 30; });
	if (t < 0) t = pick([&](int b) { return B.built[b] && (B.type[b] == B_EG_BARRACKS || B.type[b] == B_MIGDOL) && !B.queue[b].empty(); });
	if (t < 0) t = pick([&](int b) { return B.built[b] && !B.tech_queue[b].empty(); });
	if (t < 0) t = pick([&](int b) { return B.built[b] && B.type[b] == B_GRANARY; });
	if (t < 0) t = tc;
	const int32_t id = B.id[t];
	if (U.order_type[ph] == O_EMPOWER && U.order_target[ph] == id) return;
	S.commands.order(ph, Order::with_target(O_EMPOWER, id));
	pharaoh_on_ = id;
}

} // namespace aov
