#include "entities.h"

#include <cstring>

#include "events.h"

namespace aov {

int resource_type_of(const char *key) {
	for (int i = 0; i < R_TYPE_COUNT; i++)
		if (std::strcmp(resource_def(i).key, key) == 0) return i;
	return -1;
}

void Entities::reset(EventBus *ev) {
	units.clear();
	buildings.clear();
	resources.clear();
	next_id = 1;
	id_slot.assign(1, -1);
	id_kind.assign(1, K_NONE);
	events = ev;
	removed_pending = 0;
}

int32_t Entities::alloc_id(Kind k, int row) {
	int32_t id = next_id++;
	id_slot.push_back(row);
	id_kind.push_back(k);
	return id;
}

int Entities::new_unit() {
	int r = units.push();
	units.id[r] = alloc_id(K_UNIT, r);
	return r;
}
int Entities::new_building() {
	int r = buildings.push();
	buildings.id[r] = alloc_id(K_BUILDING, r);
	return r;
}
int Entities::new_resource() {
	int r = resources.push();
	resources.id[r] = alloc_id(K_RESOURCE, r);
	return r;
}

void Entities::added(int32_t id) {
	if (!events) return;
	Event e;
	e.type = EV_ENTITY_ADDED;
	e.id = id;
	e.kind = (uint8_t)kind(id);
	int s = slot(id);
	if (e.kind == K_UNIT) { e.owner = units.owner[s]; e.a = units.type[s]; e.x = units.x[s]; e.z = units.z[s]; }
	else if (e.kind == K_BUILDING) { e.owner = buildings.owner[s]; e.a = buildings.type[s]; e.x = buildings.x[s]; e.z = buildings.z[s]; }
	else if (e.kind == K_RESOURCE) { e.a = resources.type[s]; e.x = resources.x[s]; e.z = resources.z[s]; }
	events->emit(e);
}

void Entities::remove(int32_t id) {
	int s = slot(id);
	if (s < 0) return;
	Kind k = kind(id);
	Event e;
	e.type = EV_ENTITY_REMOVED;
	e.id = id;
	e.kind = (uint8_t)k;
	if (k == K_UNIT) { units.removed[s] = 1; e.owner = units.owner[s]; e.a = units.type[s]; }
	else if (k == K_BUILDING) { buildings.removed[s] = 1; e.owner = buildings.owner[s]; e.a = buildings.type[s]; }
	else if (k == K_RESOURCE) { resources.removed[s] = 1; e.a = resources.type[s]; }
	id_slot[id] = -1;
	removed_pending++;
	if (events) events->emit(e);
}

bool Entities::compact() {
	if (!removed_pending) return false;
	removed_pending = 0;
	auto remap = [this](int row, int32_t id) { id_slot[id] = row; };
	units.compact(remap);
	buildings.compact(remap);
	resources.compact(remap);
	return true;
}

int Entities::count_units(bool alive_only) const {
	int n = 0;
	for (int i = 0; i < units.size(); i++)
		if (!units.removed[i] && (!alive_only || !units.dead[i])) n++;
	return n;
}

} // namespace aov
