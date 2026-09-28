// Economy piece, simulation half: port of the update() side of
// src/economy/ (index.js, Wildlife.js, Fishing.js): gathering state machine
// and drop-off, farms (row-by-row harvest), hunting (herds that graze, flee
// and are speared from range, carcasses butchered like any node), fishing
// (shoals and fishing boats docking beside a food drop-off), stockpiles by
// the drop-offs, worship -> favor, population and cap, training queues,
// rally points and age advancement. Bit-exact with the browser
// (scripts/check-sim.mjs, scenarios "econ-*").
//
// Orders handled: O_GATHER (trees, mines, bushes, farms, animals), O_DROPOFF,
// O_WORSHIP. Unit state lives in the econ_* unit columns (the JS u.econ),
// farm / queue / rally / stockpile state in building columns, animal state
// in resource columns (see core/entities.h).
//
// nearest_resource() uses a grid index of the static nodes (trees, mines,
// bushes; 8-tile cells, ring search bounded by max_dist) plus the few
// animals, nearest_dropoff() per-owner lists of drop-off buildings: both
// return exactly what the JS linear scans return (ties to the lowest id).
// Rendering (animals, spears, boats, crops, stockpiles, loads) is
// game/economy/economy.gd.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "../core/entities.h"

namespace aov {

class Sim;
struct Order;

constexpr int FARM_ROWS = 11;          // crop rows per farm, harvested one after another
constexpr int POP_MAX = 300;
constexpr double FARM_RATE = 0.55;
constexpr double FOOD_PER_ROW = 2.5;
constexpr double HUNT_RANGE = 3.4;
constexpr double SPEAR_CD = 1.5;
constexpr double SPEAR_DMG = 3;
constexpr double UNREACH_FORGET = 90;  // s a node stays skipped after gatherers failed to reach it
constexpr double BOAT_SPEED = 2.4;
constexpr double BOAT_CAP = 20;
constexpr double FISH_RATE = 0.9;      // food / second while the net is out

// AGE_COSTS / AGE_TIME (index = the age being advanced to)
const Cost &age_cost(int age); // age 1..3; Cost() for others
constexpr double AGE_TIME[4] = { 0, 30, 40, 50 };

// ---- wildlife (Wildlife.js) -------------------------------------------------
struct AnimalDef { double hp, speed, flee_speed; bool flees; double radius; };
const AnimalDef &animal_def(int res_type); // R_DEER / R_BOAR

class Wildlife {
public:
	struct Home { double x, z; int shared; }; // econ_home objects (identity = index)
	Sim *sim = nullptr;
	bool spawned = false;
	std::vector<Home> homes;
	std::vector<int32_t> animals; // the JS Set, insertion (= id) order

	void init(Sim *s);
	int32_t spawn(int type, double x, double z, int home = -1, double rot = 0);
	std::vector<int32_t> spawn_herd(int type, double x, double z, int n);
	bool walkable_near(double x, double z, double &ox, double &oz) const;
	void populate(); // default herds round every start (deterministic from the seed)
	// hit(animal, damage, attacker position)
	void hit(int row, double dmg, double ax, double az);
	void update(double dt);
	double rand(int row); // per-animal mulberry32 stream
};

// ---- fishing (Fishing.js) ---------------------------------------------------
struct Shoal { int id; double x, z, amount, max_amount, phase; };
enum BoatState : uint8_t { BS_IDLE, BS_TO_SHOAL, BS_FISHING, BS_TO_DOCK };
struct Boat {
	int id, owner;
	double x, z, prev_x, prev_z, rot, prev_rot;
	uint8_t state = BS_IDLE;
	int shoal = -1; // index into shoals
	double carry = 0;
	bool dock = false;
	double dock_x = 0, dock_z = 0;
	int32_t dock_building = 0;
	double t = 0, wait = 0;
};

class Fishing {
public:
	Sim *sim = nullptr;
	std::vector<Shoal> shoals;
	std::vector<Boat> boats;
	int next_id = 1;
	bool spawned = false;

	void init(Sim *s);
	bool is_water(double x, double z) const;
	bool is_open(double x, double z, double r = 0.9) const; // open water with a margin (hulls)
	int spawn_shoal(double x, double z, double amount = 300);
	void populate(); // shoals along every shoreline
	int spawn_boat(int owner, double x, double z, double rot = 0);
	int nearest_shoal(double x, double z, int exclude = -1) const;
	bool find_dock(int owner, double x, double z, double &ox, double &oz, int32_t &building) const;
	void update(double dt);
	bool sail(Boat &b, double x, double z, double dt);
};

// ---- the economy --------------------------------------------------------------
struct Spear { double x0, z0, y0, x1, z1, y1, t, dur; int32_t target, from; bool hit; };
// Static field dressing placed by scenes (economy.decor): drawn by economy.gd.
struct Decor { std::string key; double x, z, rot, scale, y; };
struct Result { bool ok; std::string reason; };

class Economy {
public:
	Sim *sim = nullptr;
	Wildlife wildlife;
	Fishing fishing;
	std::vector<Spear> spears;
	std::vector<Decor> decor;

	void init(Sim *s);
	void update(double dt);

	// public API (economy.train / cancelTrain / advanceAge / nextAgeCost)
	Result train(int brow, int unit_type);
	void cancel_train(int brow, int index);
	Result advance_age(int owner);
	bool next_age_cost(int owner, Cost &out) const;
	void recount();
	// nearestResource(x, z, resType, maxDist = 14, exclude): id or 0
	int32_t nearest_resource(double x, double z, int res, double max_dist = 14, int32_t exclude = 0);
	// nearestDropoff(owner, x, z, resType): id or 0
	int32_t nearest_dropoff(int owner, double x, double z, int res);
	int spawn_from_building(int brow, int type); // unit row

	// helpers shared with the scenes
	void farm_spot(int brow, double &x, double &z) const;
	bool in_farm(int urow, int brow) const;
	void approach(int urow, int32_t target_id);
	// the JS `u.econ = { phase, resId, resType, dropId, tries, throwCd }`
	void set_econ(int urow, EconPhase phase, int32_t res, int res_type, int32_t drop, double throw_cd);
	void go_drop(int urow);

	// grid index of static resource nodes (per ResKind food/wood/gold)
	static constexpr int CELL = 8;
	int ncell = 0;
	std::vector<std::vector<int32_t>> cells[3];
	std::vector<int32_t> cell_of; // id -> cell (-1)
	std::vector<std::vector<int32_t>> dropoffs; // owner -> drop-off building ids
	void index_add(int32_t id);
	void index_remove(int32_t id, int kind);

private:
	bool start_gather(int urow, const Order &o);
	void update_gatherer(int urow, double dt);
	void throw_spear(int urow, int arow);
	void update_spears(double dt);
	bool is_animal(int32_t id) const;
};

} // namespace aov
