// High-level orders shared by the human UI and the AI (port of
// src/core/Commands.js). An order lives in the unit's order_* columns;
// pieces register a handler per order type:
//   sim.commands.register_handler(O_GATHER, start, cancel)
// and drive units carrying that order type from their own update().
// Built in: O_IDLE and O_MOVE (here + Movement). move() is the formation
// move, smart() the right-click semantics.
#pragma once
#include <cstdint>
#include <functional>
#include <vector>

#include "entities.h"

namespace aov {

class Sim;

struct Order {
	uint8_t type = O_IDLE;
	int32_t target = 0; // targetId
	double x = 0, z = 0;
	int32_t a = 0, b = 0, c = 0; // per-type extras (see entities.h order_a/b/c)
	static Order idle() { return Order(); }
	static Order move(double x, double z) { Order o; o.type = O_MOVE; o.x = x; o.z = z; return o; }
	static Order with_target(OrderType t, int32_t id) { Order o; o.type = t; o.target = id; return o; }
};

class Commands {
public:
	using StartFn = std::function<bool(int row, const Order &)>;
	using CancelFn = std::function<void(int row, const Order &prev)>;
	Sim *sim = nullptr;

	void init(Sim *s);
	void register_handler(OrderType t, StartFn start, CancelFn cancel = nullptr);
	bool has_handler(int t) const { return t >= 0 && t < O_TYPE_COUNT && (bool)start_[t]; }

	Order get(int row) const;
	void set(int row, const Order &o);
	void set_idle_fields(int row) { set(row, Order::idle()); }

	// Give one unit an order. Returns false if the handler rejected it (the
	// unit then goes idle) or no handler exists for the type. Bounds: a move /
	// attack-move destination off the map is clamped onto its edge tile
	// (GameMap::clamp_to_map); a NaN one is refused (false, order unchanged).
	// move() and smart() clamp their point the same way.
	bool order(int row, const Order &o);
	bool idle(int row) { return order(row, Order::idle()); }
	// Formation move: fan units out on a grid around the destination. `type`
	// O_ATTACK_MOVE (Godot-only, order_b = b) gives the same slots and the
	// same shared group path, as an attack-move.
	void move(const std::vector<int> &rows, double x, double z, uint8_t type = O_MOVE, int32_t b = 0);
	// Right-click semantics; target_id 0 = ground. Order types whose piece is
	// not ported yet (no handler) fall back to moving there.
	void smart(const std::vector<int> &rows, double x, double z, int32_t target_id);
	void stop(const std::vector<int> &rows) {
		for (int r : rows) idle(r);
	}

private:
	StartFn start_[O_TYPE_COUNT];
	CancelFn cancel_[O_TYPE_COUNT];
};

} // namespace aov
