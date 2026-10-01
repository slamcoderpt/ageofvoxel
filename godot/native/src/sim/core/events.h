// Synchronous event bus (port of src/core/EventBus.js) plus an outbox that
// GDScript drains once per frame (AovSim.take_events()).
//
// Events (JS name -> EventType), fields used:
//   entity:added     EV_ENTITY_ADDED      id, kind
//   entity:removed   EV_ENTITY_REMOVED    id, kind
//   entity:died      EV_ENTITY_DIED       id, kind, other = killer id (0 none)
//   unit:damaged     EV_UNIT_DAMAGED      id = target, other = attacker, amount
//   building:placed  EV_BUILDING_PLACED   id
//   building:completed EV_BUILDING_COMPLETED id
//   unit:trained     EV_UNIT_TRAINED      id
//   age:advanced     EV_AGE_ADVANCED      owner, a = age
//   resources:changed EV_RESOURCES_CHANGED owner
//   godpower:cast    EV_GODPOWER_CAST     owner, a = power id, x, z
//   command:smart    EV_COMMAND_SMART     owner, other = target id, x, z, a = unit count
//   game:over        EV_GAME_OVER         owner = winner, a = loser, amount = time
//   villager:free    EV_FREE_VILLAGER     owner, id = the Town Center (Godot-only: Economy::rescue)
//   player:defeated  EV_PLAYER_DEFEATED   owner, amount = time (Godot-only: Victory, team rules)
//   tech:researched  EV_TECH_RESEARCHED   owner, id = building, a = FortTech (Godot-only: sim/fortify)
//   gate:changed     EV_GATE_CHANGED      owner, id = gate, a = 0 converted / 1 locked / 2 unlocked (Godot-only)
#pragma once
#include <cstdint>
#include <functional>
#include <vector>

namespace aov {

enum EventType : uint8_t {
	EV_ENTITY_ADDED, EV_ENTITY_REMOVED, EV_ENTITY_DIED, EV_UNIT_DAMAGED, EV_BUILDING_PLACED,
	EV_BUILDING_COMPLETED, EV_UNIT_TRAINED, EV_AGE_ADVANCED, EV_RESOURCES_CHANGED, EV_GODPOWER_CAST,
	EV_COMMAND_SMART, EV_GAME_OVER, EV_FREE_VILLAGER, EV_PLAYER_DEFEATED, EV_TECH_RESEARCHED, EV_GATE_CHANGED, EV_COUNT
};

inline const char *event_name(int t) {
	static const char *names[] = { "entity:added", "entity:removed", "entity:died", "unit:damaged", "building:placed",
		"building:completed", "unit:trained", "age:advanced", "resources:changed", "godpower:cast", "command:smart",
		"game:over", "villager:free", "player:defeated", "tech:researched", "gate:changed" };
	return t >= 0 && t < EV_COUNT ? names[t] : "?";
}

struct Event {
	EventType type = EV_ENTITY_ADDED;
	uint8_t kind = 0;     // Kind of `id` where relevant
	int32_t id = 0;
	int32_t other = 0;
	int32_t owner = 0;
	int32_t a = 0;
	double x = 0, z = 0, amount = 0;
};

class EventBus {
public:
	using Fn = std::function<void(const Event &)>;
	// GDScript outbox; bounded so a run that never drains it (bench) stays small.
	std::vector<Event> outbox;
	bool record = true;
	size_t outbox_cap = 1 << 16;

	int on(EventType t, Fn fn) {
		subs_[t].push_back(std::move(fn));
		return (int)subs_[t].size() - 1;
	}
	void emit(const Event &e) {
		for (auto &fn : subs_[e.type])
			if (fn) fn(e);
		if (record) {
			if (outbox.size() >= outbox_cap) outbox.erase(outbox.begin(), outbox.begin() + outbox_cap / 2);
			outbox.push_back(e);
		}
	}
	void clear() {
		for (auto &s : subs_) s.clear();
		outbox.clear();
	}

private:
	std::vector<Fn> subs_[EV_COUNT];
};

} // namespace aov
