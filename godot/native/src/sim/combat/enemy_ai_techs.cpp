// Godot-only (behind Sim::godot_rules): the enemy AI's research, its later
// ages and its Market (sim/techs), scaled by difficulty as Retold's AI
// (AIParams; see godot/PORTING.md "Enemy AI: research, ages, Market"):
//
// - Gods: on reaching an age it takes that age's minor god (Techs::
//   set_minor_god, unless one is set): Athena in the Classical Age (its
//   minotaurs, its hoplites), Aphrodite (Easy, Moderate) or Apollo (Hard,
//   Titan) in the Heroic, Hera (Hard) or Hephaestus (Titan) in the Mythic.
//   Only that god's techs open, as in Retold.
// - Armory: in the Classical Age, armory_delay s after reaching it, with its
//   academy standing and armory_at villagers (Easy / Moderate: once its
//   fortifications are done too, at most fort_cap s later).
// - Market: once in market_age (Hard / Titan: Classical, Moderate: Heroic,
//   Easy: never), market_delay s after its Armory stands.
// - Ages: past the Classical Age up to max_age (Moderate Heroic, Hard /
//   Titan Mythic, Easy never), from heroic_at / mythic_at, with an Armory
//   (Retold: an Armory or a Market), once the urgent techs of its age are
//   researched. Still Archaic past 9 min (the army ate the food), it saves
//   for the Classical Age too.
// - Techs: PLAN, in order, each with the lowest tier that researches it (0
//   Easy .. 3 Titan) and whether it is urgent (the armor / weapon lines);
//   techs that upgrade a unit wait till it fields one. Each building
//   (Armory, Market, Temple) researches its first open tech of the plan,
//   one at a time; the building, the age-up and the techs are paid in that
//   order of priority.
// - Escrow: what it cannot pay yet (the first such item) stays in the bank:
//   its academies and Temple train only with that much left over, and more
//   villagers go to the gold / wood it lacks; whole for escrow_max s per
//   item (age_escrow_max for an age-up), then half of it for escrow_rest s
//   (the army's turn). Never with fewer than ESCROW_MEN soldiers or a foe
//   in its town: the men first.
// - Market: every trade_every s one lot of 100: gold short for what it
//   saves for: it sells the food / wood it has most to spare beyond that
//   (no gold mine left within reach: beyond TRADE_KEEP); food / wood short:
//   it buys with the gold it can spare; else a food / wood glut (beyond
//   trade_glut, gold short) is sold, and a gold glut buys the food / wood it
//   lacks. Never at a bad price (TRADE_MIN_SELL, TRADE_MAX_BUY).
//
// Deterministic: no rng draw, buildings and units in row order.
#include "enemy_ai.h"

#include <algorithm>

#include "../sim.h"

namespace aov {

static const double TRADE_KEEP = 150;   // food / wood kept when selling for gold, gold kept when buying
static const double TRADE_MIN_SELL = 45; // never sells 100 for less gold than this
static const double TRADE_MAX_BUY = 220; // never pays more gold than this for 100
static const double TRADE_LOW = 150;     // food / wood below this is short (gold glut)
static const int ESCROW_MEN = 8;         // no saving with fewer soldiers than this
static const double ESCROW_SAFE = 26;    // ... or with a foe this close to its Town Center

struct AIPlanItem {
	int tech;
	int tier;      // lowest tech_level that researches it
	bool urgent;   // its academies wait for it
	UnitMask units; // only once it fields one of these (0: always)
};

// In order: the Classical Armory line first, then each age's economy techs,
// its lines and its god's techs.
static const AIPlanItem PLAN[] = {
	// Classical
	{ T_COPPER_WEAPONS, 0, true, 0 },
	{ T_COPPER_ARMOR, 0, true, 0 },
	{ T_COPPER_SHIELDS, 1, true, 0 },
	{ T_LABYRINTH_OF_MINOS, 1, false, M_MYTH },
	{ T_BALLISTICS, 2, false, 0 },
	{ T_SARISSA, 2, false, M_HOPLITE },
	{ T_AEGIS, 3, false, M_HOPLITE },
	// Heroic
	{ T_TAX_COLLECTORS, 2, false, 0 },
	{ T_GOLDEN_APPLES, 1, false, 0 },
	{ T_BRONZE_WEAPONS, 1, true, 0 },
	{ T_BRONZE_ARMOR, 1, true, 0 },
	{ T_BRONZE_SHIELDS, 2, true, 0 },
	{ T_SUN_RAY, 2, false, M_TOXOTES },
	{ T_TEMPLE_OF_HEALING, 2, false, 0 },
	{ T_ORACLE, 3, false, 0 },
	// Mythic
	{ T_FORGE_OF_OLYMPUS, 3, true, 0 },
	{ T_IRON_WEAPONS, 2, true, 0 },
	{ T_IRON_ARMOR, 2, true, 0 },
	{ T_IRON_SHIELDS, 3, true, 0 },
	{ T_MONSTROUS_RAGE, 2, false, M_MYTH },
	{ T_OLYMPIAN_WEAPONS, 3, false, 0 },
	{ T_BURNING_PITCH, 3, false, M_TOXOTES },
	{ T_AMBASSADORS, 3, false, 0 },
	{ T_OMNISCIENCE, 3, false, 0 },
};

void EnemyAI::choose_gods() {
	Sim &S = *sim;
	const int age = S.players[owner].age;
	const int lvl = par.tech_level;
	static const char *heroic[4] = { "aphrodite", "aphrodite", "apollo", "apollo" };
	static const char *mythic[4] = { "hera", "hera", "hera", "hephaestus" };
	for (int a = 1; a <= age && a <= 3; a++) {
		if (!S.techs.minor[owner][a].empty()) continue;
		S.techs.set_minor_god(owner, a, a == 1 ? "athena" : a == 2 ? heroic[lvl & 3] : mythic[lvl & 3]);
	}
}

bool EnemyAI::escrow_allows(const Cost &c) const {
	const Player &p = sim->players[owner];
	for (int k = 0; k < RES_COUNT; k++)
		if (c.has[k] && escrow_[k] > 0 && p.res[k] - c.v[k] < escrow_[k]) return false;
	return true;
}

void EnemyAI::research(int tc, const std::vector<int> &vills, const std::vector<int> &buildings, bool saving) {
	Sim &S = *sim;
	const BuildingStore &B = S.entities.buildings;
	const UnitStore &U = S.entities.units;
	Player &p = S.players[owner];
	for (int a = 1; a <= 3; a++)
		if (p.age >= a && techs.age_at[a] < 0) techs.age_at[a] = S.time;
	double esc[4] = { 0, 0, 0, 0 };
	int esc_item = -1;
	const Cost *goal = nullptr;
	Cost goal_c;
	// leave the escrow as computed below (or none) when returning
	struct Commit {
		EnemyAI *ai;
		double *esc;
		int *item;
		~Commit() {
			Player &pl = ai->sim->players[ai->owner];
			if (*item != ai->escrow_item_) {
				ai->escrow_item_ = *item;
				ai->escrow_since_ = ai->sim->time;
			}
			ai->tech_gold_ = *item >= 0 && pl.res[RES_GOLD] < esc[RES_GOLD];
			ai->tech_wood_ = *item >= 0 && pl.res[RES_WOOD] < esc[RES_WOOD];
			ai->tech_food_ = *item >= 0 && pl.res[RES_FOOD] < esc[RES_FOOD];
			for (int k = 0; k < RES_COUNT; k++) ai->escrow_[k] = esc[k];
		}
	} commit{ this, esc, &esc_item };
	// (still Archaic past the browser's saving window, 9 min: the army ate
	// every bit of food and the Classical Age never came; it saves its 400
	// food like any age-up, the advance itself is update()'s step 4)
	if (p.age == 0 && !p.advancing && par.escrow_max > 0 && S.time >= par.classical_at - par.age_lead) {
		Cost c;
		if (S.economy.next_age_cost(owner, c) && !p.can_afford(c)) {
			// (on its age plan: whatever its army, unless foes are in the town)
			if (S.combat.find_enemy_near(B.x[tc], B.z[tc], owner, ESCROW_SAFE) < 0) {
				esc_item = 2001;
				esc[RES_FOOD] = c.v[RES_FOOD];
				techs.age_holds++;
			}
		}
		return;
	}
	if (par.armory_at <= 0 || p.age < 1 || saving) return;
	choose_gods();
	int armory = -1, market = -1, temple = -1, academy = -1;
	bool armory_any = false, market_any = false;
	for (int b : buildings) {
		const int t = B.type[b];
		if (t == B_ARMORY) {
			armory_any = true;
			if (armory < 0 && B.built[b]) armory = b;
		} else if (t == B_MARKET) {
			market_any = true;
			if (market < 0 && B.built[b]) market = b;
		} else if (t == B_TEMPLE && temple < 0 && B.built[b]) temple = b;
		else if (t == B_BARRACKS && academy < 0 && B.built[b]) academy = b;
	}
	// no saving with a small army or foes in the town: the men first
	int men = 0;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.owner[r] == owner && !unit_def(U.type[r]).gatherer) men++;
	const bool foes_near = S.combat.find_enemy_near(B.x[tc], B.z[tc], owner, ESCROW_SAFE) >= 0;
	const bool threatened = men < ESCROW_MEN || foes_near;
	// the escrow is whole for escrow_max s per item (age_escrow_max for an
	// age-up), then half of it for escrow_rest s (the army's turn: it spends
	// what is beyond that half, the rest of the savings stay)
	auto save_for = [&](int item, const Cost &c) {
		if (esc_item >= 0) return; // (one item at a time: the first)
		if (!goal) {
			goal_c = c;
			goal = &goal_c;
		}
		if (par.escrow_max <= 0 || (item >= 2000 || item == 1000 + B_ARMORY ? foes_near : threatened)) return; // (an age on its plan, or the Armory it needs: whatever its army)
		const double limit = item >= 2000 ? par.age_escrow_max : par.escrow_max;
		if (item == escrow_item_ && S.time - escrow_since_ >= limit) {
			escrow_free_until_ = S.time + par.escrow_rest;
			escrow_since_ = escrow_free_until_; // (whole again after the rest)
		}
		const double share = S.time < escrow_free_until_ ? 0.5 : 1;
		esc_item = item;
		for (int k = 0; k < RES_COUNT; k++) esc[k] = c.has[k] && k != RES_FAVOR ? c.v[k] * share : 0;
		techs.holds++;
	};
	// may it pay c with what it saves for left over (plus keep)
	auto affords = [&](const Cost &c, double keep) {
		for (int k = 0; k < RES_COUNT; k++)
			if (c.has[k] && p.res[k] < c.v[k] + esc[k] + (k == RES_FAVOR ? 0 : keep)) return false;
		return true;
	};

	// 1. the Armory
	const double since_classical = S.time - techs.age_at[1];
	// (the Heroic Age needs an Armory or a Market: on its age plan the Armory
	// comes in time for it, whatever else waits)
	const bool heroic_due = p.age == 1 && par.max_age >= 2 && S.time >= par.heroic_at - par.age_lead - 150;
	if (!armory_any) {
		if (academy < 0 || (!heroic_due && ((int)vills.size() < par.armory_at || since_classical < par.armory_delay))) return;
		const bool fort_done = !(par.walls && ring_state_ != 3) && fort.towers >= par.towers_max;
		if (!heroic_due && par.fort_first && !fort_done && since_classical < par.armory_delay + par.fort_cap) return; // (the fortifications first)
		const Cost &c = building_def(B_ARMORY).cost;
		if (!p.can_afford(c)) save_for(1000 + B_ARMORY, c);
		else if (try_build(B_ARMORY, pick_builder(vills), tc)) techs.armories++;
		return;
	}
	if (armory >= 0 && armory_up_at_ < 0) armory_up_at_ = S.time;
	// the next age on its plan comes before the Market and the other techs:
	// saving from age_lead s before its time
	{
		// (the urgent techs of the age it is in go first, until two minutes past the age's time)
		bool urgent_left = false;
		for (const AIPlanItem &it : PLAN) {
			if (!it.urgent || it.tier > par.tech_level || tech_def(it.tech).age > p.age) continue;
			const int st = S.techs.state(owner, it.tech);
			if (st == TS_AVAILABLE || st == TS_LOCKED_PREREQ) urgent_left = true;
		}
		Cost age_cost;
		const double age_t = p.age == 1 ? par.heroic_at : par.mythic_at;
		const bool want_age = !p.advancing && p.age < par.max_age && p.age < 3 && (armory >= 0 || market >= 0) &&
				(!urgent_left || S.time >= age_t + 120) && S.time >= age_t - par.age_lead && S.economy.next_age_cost(owner, age_cost);
		if (want_age) {
			if (affords(age_cost, 0)) S.economy.advance_age(owner);
			else save_for(2000 + p.age + 1, age_cost);
		}
	}
	// 2. the Market
	if (!market_any && par.market_age <= 3 && p.age >= par.market_age && armory >= 0 && S.time - armory_up_at_ >= par.market_delay) {
		const Cost &c = building_def(B_MARKET).cost;
		if (!p.can_afford(c)) save_for(1000 + B_MARKET, c);
		else if (try_build(B_MARKET, pick_builder(vills), tc)) techs.markets++;
	}
	// 3. techs (each building its first open tech of the plan) and the next
	// age, in the plan's order: the age-up comes after the urgent techs of
	// the age it is in
	UnitMask fielded = 0;
	for (int r = 0; r < U.size(); r++)
		if (!U.removed[r] && !U.dead[r] && U.owner[r] == owner) fielded |= UM(U.type[r]);
	struct Cand { size_t at; int b; int tech; };
	Cand cand[3];
	int nc = 0;
	const int homes[3] = { armory, market, temple };
	const size_t NPLAN = sizeof(PLAN) / sizeof(PLAN[0]);
	for (int h = 0; h < 3; h++) {
		const int b = homes[h];
		if (b < 0 || !B.tech_queue[b].empty()) continue;
		for (size_t i = 0; i < NPLAN; i++) {
			const AIPlanItem &it = PLAN[i];
			if (it.tier > par.tech_level || (it.units && !(fielded & it.units))) continue;
			if (tech_def(it.tech).home != (uint8_t)h || !S.techs.researches_at(B.type[b], it.tech)) continue;
			if (S.techs.state(owner, it.tech) != TS_AVAILABLE) continue;
			cand[nc++] = { i, b, it.tech };
			break; // (in order: the next one waits for it)
		}
	}
	std::sort(cand, cand + nc, [](const Cand &a, const Cand &b) { return a.at < b.at; });
	for (int i = 0; i < nc; i++) {
		const Cand &c = cand[i];
		if (esc_item >= 2000 && !PLAN[c.at].urgent) continue; // (saving for an age: only the urgent techs)
		const Cost cost = S.techs.cost_for(owner, c.tech);
		const double keep = PLAN[c.at].urgent || escrow_item_ == c.tech ? 0 : par.tech_keep; // (one it saved for: nothing left over)
		if (affords(cost, keep)) {
			if (S.techs.research(B.id[c.b], c.tech).ok) {
				techs.started++;
				techs.last_tech = c.tech;
			}
		} else save_for(c.tech, cost);
	}
	// 4. the Market
	if (market >= 0) trade(market, B.id[tc], goal);
}

// One lot of 100 at the Market every trade_every s (see the top of the file).
void EnemyAI::trade(int market, int32_t tc_id, const Cost *goal) {
	Sim &S = *sim;
	Player &p = S.players[owner];
	trade_t_ -= par.think;
	if (trade_t_ > 0) return;
	trade_t_ = par.trade_every;
	const int32_t mid = S.entities.buildings.id[market];
	auto sell = [&](int r) {
		if (S.techs.sell_price(owner, r) < TRADE_MIN_SELL) return false;
		const TradeResult t = S.techs.sell(mid, r);
		if (!t.ok) return false;
		techs.sold++;
		techs.gold_in += t.gold;
		return true;
	};
	auto buy = [&](int r, double gold_keep) {
		const double price = S.techs.buy_price(owner, r);
		if (price > TRADE_MAX_BUY || p.res[RES_GOLD] - price < gold_keep) return false;
		const TradeResult t = S.techs.buy(mid, r);
		if (!t.ok) return false;
		techs.bought++;
		techs.gold_out += t.gold;
		return true;
	};
	const int TRADED[2] = { RES_FOOD, RES_WOOD };
	if (goal) {
		const Cost &g = *goal;
		auto want = [&](int k) { return g.has[k] ? g.v[k] : 0.0; };
		// gold short: sell what it has most to spare beyond the goal (no
		// gold mine left within reach: beyond TRADE_KEEP, the farms and
		// the woods refill it, the Market is its only gold)
		if (p.res[RES_GOLD] < want(RES_GOLD)) {
			const BuildingStore &B = S.entities.buildings;
			const int tc = S.entities.building_slot(tc_id);
			const bool dry = tc >= 0 && !S.economy.nearest_resource(B.x[tc], B.z[tc], RES_GOLD, 80);
			int best = -1;
			double spare = 100;
			for (int r : TRADED) {
				const double s = p.res[r] - (dry ? 0 : want(r)) - TRADE_KEEP;
				if (s >= spare) {
					spare = s;
					best = r;
				}
			}
			if (best >= 0 && sell(best)) return;
		}
		// food / wood short: buy it with the gold beyond the goal
		for (int r : TRADED)
			if (p.res[r] < want(r) && buy(r, want(RES_GOLD) + TRADE_KEEP)) return;
	}
	// a food / wood glut, gold short: sell it; a gold glut, food / wood short: buy
	for (int r : TRADED)
		if (p.res[r] > par.trade_glut && p.res[RES_GOLD] < par.trade_glut * 0.5 && sell(r)) return;
	if (p.res[RES_GOLD] > par.trade_glut) {
		const int r = p.res[RES_FOOD] <= p.res[RES_WOOD] ? RES_FOOD : RES_WOOD;
		if (p.res[r] < TRADE_LOW) buy(r, par.trade_glut * 0.5);
	}
}

} // namespace aov
