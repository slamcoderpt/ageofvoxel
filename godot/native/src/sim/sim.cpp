#include "sim.h"

#include <cstring>

#include "core/jsmath.h"

namespace aov {

void Sim::new_game(uint32_t seed_, int map_size, const std::string &preset, int n_players) {
	seed = seed_;
	rng = RNG(seed_);
	tick_count = 0;
	time = 0;
	events.clear();
	entities.reset(&events);
	for (auto &p : players) p = Player();
	players[GAIA].init(GAIA, "Gaia", false);
	players[PLAYER].init(PLAYER, "You", false);
	players[ENEMY].init(ENEMY, "Enemy", true);
	world = generate_map(seed_, map_size, preset, n_players);
	paths.reset();
	pathfinder.init(&world.map, &prof);
	movement.init(this);
	commands.init(this);
	units.init(this);
	economy.init(this);
	buildings.init(this);
	scene = SceneCtx();
	for (const auto &r : world.resources) {
		int t = resource_type_of(r.type.c_str());
		if (t >= 0) spawn_resource(t, r.tx, r.tz, r.variant);
	}
}

Player &Sim::add_player(int id, const std::string &name, bool is_ai) {
	if (!players[id].exists) players[id].init(id, name, is_ai);
	return players[id];
}

void Sim::tick(double dt) {
	Clock::time_point t0;
	if (prof.enabled) {
		prof.clear();
		t0 = Clock::now();
	}
	time += dt;
	tick_count++;
	const bool P = prof.enabled;
	// JS simOrder: economy, buildings, combat, godpowers, units, movement, fx, fog, victory
	{
		ScopedTimer t(P ? &prof.sys["economy"] : nullptr);
		economy.update(dt);
	}
	{
		ScopedTimer t(P ? &prof.sys["buildings"] : nullptr);
		buildings.update(dt);
	}
	{
		ScopedTimer t(P ? &prof.sys["units"] : nullptr);
		units.update(dt);
	}
	{
		ScopedTimer t(P ? &prof.sys["movement"] : nullptr);
		movement.update(dt);
	}
	if (P) prof.total = ms_since(t0);
}

void Sim::fast_forward(double seconds) {
	const int n = (int)js_round(seconds / SIM_DT);
	for (int i = 0; i < n; i++) tick(SIM_DT);
}

int32_t Sim::spawn_resource(int type, int tx, int tz, int variant) {
	const ResourceDef &def = resource_def(type);
	int r = entities.new_resource();
	ResourceStore &R = entities.resources;
	R.type[r] = (uint8_t)type;
	R.res_type[r] = def.res_type;
	R.amount[r] = R.max_amount[r] = def.amount;
	R.tx[r] = tx;
	R.tz[r] = tz;
	R.w[r] = def.w;
	R.h[r] = def.h;
	R.x[r] = tx + def.w / 2.0;
	R.z[r] = tz + def.h / 2.0;
	R.radius[r] = std::max(def.w, def.h) / 2.0;
	R.variant[r] = variant;
	const int32_t id = R.id[r];
	entities.added(id);
	world.map.block(tx, tz, def.w, def.h, id);
	return id;
}

void Sim::remove_resource(int32_t id) {
	int s = entities.resource_slot(id);
	if (s < 0) return;
	const ResourceStore &R = entities.resources;
	if (is_animal_type(R.type[s])) {
		const double tx = R.x[s] - 0.5, tz = R.z[s] - 0.5;
		if (tx == std::floor(tx) && tz == std::floor(tz)) world.map.unblock((int)tx, (int)tz, 1, 1);
	} else world.map.unblock(R.tx[s], R.tz[s], R.w[s], R.h[s]);
	entities.remove(id);
}

void Sim::clear_rect(int tx, int tz, int w, int h) {
	std::vector<int32_t> ids;
	const ResourceStore &R = entities.resources;
	for (int i = 0; i < R.size(); i++) {
		if (R.removed[i]) continue;
		const double rtx = R.x[i] - R.w[i] / 2.0, rtz = R.z[i] - R.h[i] / 2.0; // (fractional for animals)
		if (rtx < tx + w && rtx + R.w[i] > tx && rtz < tz + h && rtz + R.h[i] > tz) ids.push_back(R.id[i]);
	}
	for (int32_t id : ids) remove_resource(id);
}

std::vector<int32_t> Sim::spawn_block(int type, int owner, int count, double x, double z, int cols, double spacing, double rot, double jitter) {
	std::vector<int32_t> out;
	if (!cols) cols = (int)std::ceil(std::sqrt((double)count));
	const double rows = std::ceil((double)count / cols);
	const double c = jsm::cos(rot), s = jsm::sin(rot);
	for (int i = 0; i < count; i++) {
		const int col = i % cols, row = (int)std::floor((double)i / cols);
		const double ox = (col - (cols - 1) / 2.0) * spacing + rng.range(-jitter, jitter);
		const double oz = (row - (rows - 1) / 2) * spacing + rng.range(-jitter, jitter);
		double wx = x + ox * c + oz * s, wz = z - ox * s + oz * c;
		int wtx, wtz;
		const int ftx = (int)std::floor(wx), ftz = (int)std::floor(wz);
		if (pathfinder.nearest_walkable(ftx, ftz, 6, wtx, wtz) && !map().is_walkable(ftx, ftz)) {
			wx = wtx + 0.5;
			wz = wtz + 0.5;
		}
		int r = units.spawn(type, owner, wx, wz, rot);
		out.push_back(entities.units.id[r]);
	}
	return out;
}

uint32_t Sim::units_hash() const {
	uint32_t h = 2166136261u;
	auto mix = [&](uint32_t v) {
		for (int k = 0; k < 4; k++) {
			h ^= (v >> (k * 8)) & 255u;
			h *= 16777619u;
		}
	};
	auto mixd = [&](double d) {
		uint64_t b;
		std::memcpy(&b, &d, 8);
		mix((uint32_t)b);
		mix((uint32_t)(b >> 32));
	};
	const UnitStore &U = entities.units;
	for (int r = 0; r < U.size(); r++) {
		if (U.removed[r]) continue;
		mix((uint32_t)U.id[r]);
		mixd(U.x[r]);
		mixd(U.z[r]);
		mixd(U.rot[r]);
		mixd(U.hp[r]);
		mix((uint32_t)(U.moving[r] | (U.dead[r] << 1) | (U.arrived[r] << 2)));
		mix(U.order_type[r]);
		mix(U.anim_state[r]);
	}
	return h;
}

} // namespace aov
