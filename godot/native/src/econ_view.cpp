// AovEconView: see econ_view.h.
#include "econ_view.h"

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>

#include "sim/sim.h"

using namespace godot;

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr int FARM_ROWS = 11;

inline double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline double fract(double v) { return v - std::floor(v); }

// src/units/anim.js uhash(u, k), as the units view (unit_view.cpp) poses them
inline double uhash(int32_t id, int k) {
	const uint32_t a = (uint32_t)(id + 1) * 2654435761u;
	const uint32_t b = (uint32_t)(k + 7) * 40503u;
	return (double)((a ^ b) % 10007u) / 10007.0;
}
// visual-only hash in [0, 1)
inline double vh(int32_t a, int32_t b, int32_t s) { return aov::hash2(a, b, s); }

struct Lin { float r, g, b; };
Lin hex_lin(uint32_t h) {
	auto lin = [](double c) { return (float)(c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4)); };
	return { lin(((h >> 16) & 255) / 255.0), lin(((h >> 8) & 255) / 255.0), lin((h & 255) / 255.0) };
}

// What a villager carries or gathers as drawLoads shows it: 0 wood, 1 gold,
// 2 grain, 3 fruit, 4 meat, 255 nothing (as AovSim's load_kind, without the
// carry test when `gathering`).
uint8_t load_kind(const aov::Entities &E, int r, bool gathering) {
	const aov::UnitStore &U = E.units;
	const int c = gathering ? U.econ_res_type[r] : U.carry_type[r];
	if (c == aov::RES_NONE || c == 255 || (!gathering && U.carry_amount[r] <= 0)) return 255;
	if (c == aov::RES_WOOD) return 0;
	if (c == aov::RES_GOLD) return 1;
	if (c != aov::RES_FOOD) return 255;
	const int32_t src = U.econ_phase[r] != aov::EP_NONE ? U.econ_res[r] : 0;
	const int s = E.slot(src);
	if (s >= 0 && E.kind(src) == aov::K_BUILDING && aov::building_def(E.buildings.type[s]).farm) return 2;
	if (s >= 0 && E.kind(src) == aov::K_RESOURCE) {
		const int t = E.resources.type[s];
		if (aov::is_animal_type(t)) return 4;
		if (t == aov::R_BERRY) return 3;
	}
	if (U.econ_phase[r] != aov::EP_NONE && U.econ_hunt[r]) return 4;
	return 2;
}

const char *STOCK_KEYS[6][3] = {
	{ "sheaf", "sack", "crate_grain" },            // grain
	{ "crate_apples", "crate_grapes", "amphora" }, // fruit
	{ "sack", "amphora", "crate_apples" },         // meat
	{ "crate_fish", "crate_fish", "amphora" },     // fish
	{ "logs", "logs", "logs" },                    // wood
	{ "goldpile", "goldpile", "crate_gold" },      // gold
};
const char *LOAD_KEYS[5] = { "load_log", "load_ore", "load_sheaf", "load_basket", "load_haunch" };

} // namespace

void AovEconView::_bind_methods() {
	ClassDB::bind_method(D_METHOD("setup", "sim", "keys"), &AovEconView::setup);
	ClassDB::bind_method(D_METHOD("update", "alpha", "paused", "local_player", "frustum"), &AovEconView::update, DEFVAL(Array()));
}

void AovEconView::setup(const Ref<AovSim> &sim, const PackedStringArray &keys) {
	sim_ref_ = sim;
	props_.assign(keys.size(), Buf());
	key_idx_.clear();
	for (int64_t i = 0; i < keys.size(); i++) key_idx_[std::string(keys[i].utf8().get_data())] = (int)i;
	auto idx = [&](const char *k) { auto it = key_idx_.find(k); return it == key_idx_.end() ? -1 : it->second; };
	k_deer = idx("deer"); k_boar = idx("boar"); k_spear = idx("spear"); k_fish = idx("fish"); k_boat = idx("boat"); k_sheaf = idx("sheaf");
	for (int s = 0; s < 3; s++) k_wheat[s] = idx(s == 0 ? "wheat0" : s == 1 ? "wheat1" : "wheat2");
	for (int l = 0; l < 5; l++) k_load[l] = idx(LOAD_KEYS[l]);
	for (int a = 0; a < 6; a++)
		for (int b = 0; b < 3; b++) k_stock[a][b] = idx(STOCK_KEYS[a][b]);
	chips_.stride = puffs_.stride = rings_.stride = 20;
	slots_.clear();
}

void AovEconView::draw(int k, double x, double y, double z, double yaw, double pitch, double roll, double sx, double sy,
		double sz, float tr, float tg, float tb, float tint) {
	if (k < 0) return;
	if (!planes_.empty()) {
		// off screen, shadow margin included (a boat is ~3 m, crops cast < 2 m)
		const real_t r = (real_t)(3.5 * std::max({ std::abs(sx), std::abs(sy), std::abs(sz) }));
		const Vector3 c((real_t)x, (real_t)y, (real_t)z);
		for (const Plane &p : planes_)
			if (p.distance_to(c) > r) return;
	}
	Buf &b = props_[k];
	Basis B;
	if (pitch == 0 && roll == 0) B = Basis(Vector3(0, 1, 0), (real_t)yaw);
	else B = Basis::from_euler(Vector3((real_t)pitch, (real_t)yaw, (real_t)roll)); // YXZ, as Three's Euler(…, 'YXZ')
	B = B * Basis::from_scale(Vector3((real_t)sx, (real_t)sy, (real_t)sz));
	const float v[16] = { B.rows[0].x, B.rows[0].y, B.rows[0].z, (float)x, B.rows[1].x, B.rows[1].y, B.rows[1].z, (float)y,
		B.rows[2].x, B.rows[2].y, B.rows[2].z, (float)z, tr, tg, tb, tint };
	b.d.insert(b.d.end(), v, v + 16);
	b.n++;
}

void AovEconView::fx(Buf &b, double x, double y, double z, double size, float r, float g, float bl, float a, float c0, float c1,
		float c2, float c3, double yaw) {
	const float s = (float)size;
	const float cy = (float)std::cos(yaw) * s, sy = (float)std::sin(yaw) * s;
	const float v[20] = { cy, 0, sy, (float)x, 0, s, 0, (float)y, -sy, 0, cy, (float)z, r, g, bl, a, c0, c1, c2, c3 };
	b.d.insert(b.d.end(), v, v + 20);
	b.n++;
}

PackedFloat32Array AovEconView::pack(const Buf &b) {
	int cap = 32;
	while (cap < b.n) cap <<= 1;
	PackedFloat32Array out;
	out.resize((int64_t)cap * b.stride);
	float *w = out.ptrw();
	if (!b.d.empty()) memcpy(w, b.d.data(), b.d.size() * sizeof(float));
	memset(w + b.d.size(), 0, ((size_t)cap * b.stride - b.d.size()) * sizeof(float));
	return out;
}

// EconomyView.stockSlots: deterministic prop slots around a building's back
// and sides, front corners first, the rest interleaved (+ ground height).
const std::vector<AovEconView::Slot> &AovEconView::stock_slots(int row) {
	const aov::Sim &SM = sim_ref_->sim();
	const aov::BuildingStore &B = SM.entities.buildings;
	const int32_t id = B.id[row];
	auto it = slots_.find(id);
	if (it != slots_.end()) return it->second;
	const double tx = B.tx[row], tz = B.tz[row], w = B.w[row], h = B.h[row];
	std::vector<Slot> out;
	auto rot = [&](int i) { return (float)((vh(id, i, 3) - 0.5) * 0.8); };
	const double o = 0.55, fz = tz + h + 0.6;
	out.push_back({ (float)(tx + 0.45), (float)fz, rot(0), 0 });
	out.push_back({ (float)(tx + w - 0.45), (float)fz, rot(1), 0 });
	out.push_back({ (float)(tx - 0.35), (float)(fz - 0.1), rot(2), 0 });
	out.push_back({ (float)(tx + w + 0.35), (float)(fz - 0.1), rot(3), 0 });
	const size_t front = out.size();
	for (double x = tx + 0.6; x < tx + w - 0.3; x += 1.0) out.push_back({ (float)x, (float)(tz - o), rot((int)out.size()), 0 });
	for (double z = tz + 0.6; z < tz + h - 0.3; z += 1.0) out.push_back({ (float)(tx - o), (float)z, (float)(PI / 2) + rot((int)out.size()), 0 });
	for (double z = tz + 0.6; z < tz + h - 0.3; z += 1.0) out.push_back({ (float)(tx + w + o), (float)z, (float)(PI / 2) + rot((int)out.size()), 0 });
	std::vector<Slot> res(out.begin(), out.begin() + front);
	for (size_t k = front; k < out.size(); k++)
		if ((k - front) % 2 == 0) res.push_back(out[k]);
	for (size_t k = front; k < out.size(); k++)
		if ((k - front) % 2 == 1) res.push_back(out[k]);
	for (Slot &s : res) s.y = (float)SM.map().height_at(s.x, s.z);
	return slots_[id] = res;
}

Dictionary AovEconView::update(double alpha, bool paused, int64_t local_player, const Array &frustum) {
	Dictionary out;
	if (sim_ref_.is_null()) return out;
	planes_.clear();
	for (int64_t k = 0; k < frustum.size(); k++) planes_.push_back(frustum[k]);
	const aov::Sim &SM = sim_ref_->sim();
	const aov::GameMap &map = SM.map();
	const aov::Economy &ec = SM.economy;
	const aov::ResourceStore &R = SM.entities.resources;
	const aov::BuildingStore &B = SM.entities.buildings;
	const aov::UnitStore &U = SM.entities.units;
	const int me = (int)local_player;
	const double da = paused ? 0 : alpha * aov::SIM_DT;
	const double time = SM.time + da;
	const double wy = map.water_y();
	for (Buf &b : props_) b.clear();
	chips_.clear(); puffs_.clear(); rings_.clear();

	// fx colours (sRGB, the shader linearises)
	auto chip = [&](double x, double y, double z, double size, uint32_t hex, double yaw, double pitch, float glow = 0) {
		const float r = ((hex >> 16) & 255) / 255.f, g = ((hex >> 8) & 255) / 255.f, b = (hex & 255) / 255.f;
		// tumble: pitch goes in the custom data (the shader spins the cube about x)
		fx(chips_, x, y, z, size, r, g, b, 1, glow, (float)pitch, 0, 0, yaw);
	};
	auto puff = [&](double x, double y, double z, double size, uint32_t hex, double a) {
		fx(puffs_, x, y, z, size, ((hex >> 16) & 255) / 255.f, ((hex >> 8) & 255) / 255.f, (hex & 255) / 255.f, (float)a);
	};
	auto ring = [&](double x, double z, double radius, double a, double band) {
		fx(rings_, x, wy + 0.07, z, radius, 0.92f, 0.97f, 1.f, (float)a, (float)band);
	};
	// a splash of water drops (closed-form ballistic, age in seconds)
	auto droplets = [&](double x, double z, double age, int32_t seed, int n, double power) {
		if (age < 0 || age > 0.6) return;
		for (int j = 0; j < n; j++) {
			const double h1 = vh(seed, j, 91), h2 = vh(seed, j, 92), h3 = vh(seed, j, 93);
			const double ang = h1 * PI * 2, sp = (0.4 + h2 * 0.8) * power, vu = (1.6 + h3 * 1.4) * power;
			const double y = wy + vu * age - 4.9 * age * age;
			if (y < wy - 0.05) continue;
			chip(x + std::cos(ang) * sp * age, y, z + std::sin(ang) * sp * age, 0.05 * (1 - age), 0xe8f4ff, ang, age * 9, 0.35f);
		}
	};

	// ---- animals & carcasses (with hoof dust behind running game)
	for (int32_t id : ec.wildlife.animals) {
		const int a = SM.entities.resource_slot(id);
		if (a < 0) continue;
		const double x = R.prev_x[a] + (R.x[a] - R.prev_x[a]) * alpha, z = R.prev_z[a] + (R.z[a] - R.prev_z[a]) * alpha;
		const bool alive = R.alive[a];
		if (alive ? !SM.fog.is_visible(x, z) : !SM.fog.is_explored(x, z)) continue;
		const double y = map.height_at(x, z);
		const double fl = R.flash_t[a];
		const float tint = (float)(1 + (fl > 0 ? fl * 3 : 0));
		const bool boar = R.type[a] == aov::R_BOAR;
		const int key = boar ? k_boar : k_deer;
		const double rot = R.rot[a];
		if (alive) {
			const double sp = R.an_speed[a];
			const bool moving = R.an_moving[a];
			const double run = moving ? std::abs(std::sin(time * (4 + sp * 3) + id)) * (0.04 + sp * 0.03) : 0;
			const double pitch = moving ? std::sin(time * (4 + sp * 3) * 2 + id) * 0.05 : R.an_graze[a] * 0.32 * (0.8 + 0.2 * std::sin(time * 1.3 + id));
			draw(key, x, y + run, z, rot, pitch, 0, 1, 1, 1, 1, 1, 1, tint);
			const double dx = R.x[a] - R.prev_x[a], dz = R.z[a] - R.prev_z[a];
			const double v = std::sqrt(dx * dx + dz * dz) / aov::SIM_DT;
			if (moving && v > 1.2) {
				const double k = clamp01((v - 1.2) / 2.5);
				const double fx_ = std::sin(rot), fz_ = std::cos(rot);
				for (int j = 0; j < 3; j++) {
					const double ph = fract(time * 1.4 + j / 3.0 + vh(id, j, 81));
					const double age = ph * 0.7;
					const double back = 0.35 + age * 0.4, side = (vh(id, (int)std::floor(time * 1.4 + j / 3.0), 82 + j) - 0.5) * 0.5;
					const double px = x - fx_ * back + fz_ * side, pz = z - fz_ * back - fx_ * side;
					puff(px, map.height_at(px, pz) + 0.12 + age * 0.25, pz, 0.28 + age * 0.6, 0xe6d3ac, 0.6 * k * (1 - ph));
				}
			}
		} else {
			const double k = std::min(1.0, R.an_dead_t[a] / 0.5);
			const double f = k * k;
			const double left = std::max(0.35, R.amount[a] / R.max_amount[a]);
			const double side = id % 2 ? 1 : -1;
			draw(key, x, y + f * (boar ? 0.35 : 0.25), z, rot, 0, side * f * PI / 2 * 0.95, 1, left, 0.7 + 0.3 * left, 1, 1, 1, 0.92f);
		}
	}

	// ---- spears in flight / stuck in the ground
	for (const aov::Spear &s : ec.spears) {
		const double t = s.t + da;
		const double k = std::min(1.0, t / s.dur);
		const double d0 = std::hypot(s.x1 - s.x0, s.z1 - s.z0);
		const double h = 0.35 + d0 * 0.08;
		const double x = s.x0 + (s.x1 - s.x0) * k, z = s.z0 + (s.z1 - s.z0) * k;
		const double y = s.y0 + (s.y1 - s.y0) * k + 4 * h * k * (1 - k);
		const double d = d0 == 0 ? 1 : d0;
		const double dy = (s.y1 - s.y0) + 4 * h * (1 - 2 * k);
		const double pitch = k >= 1 ? 0.7 : -std::atan2(dy, d);
		if (!SM.fog.is_visible(x, z)) continue;
		draw(k_spear, x, k >= 1 ? y - 0.25 : y, z, std::atan2(s.x1 - s.x0, s.z1 - s.z0), pitch);
	}

	// ---- fish shoals: circling fish, ripples, one leaping fish every few seconds
	for (const aov::Shoal &s : ec.fishing.shoals) {
		if (s.amount <= 0 || !SM.fog.is_explored(s.x, s.z)) continue;
		const int n = std::max(2, (int)std::floor(6 * s.amount / s.max_amount + 0.5));
		for (int i = 0; i < n; i++) {
			const double ang = s.phase * (0.5 + (i % 3) * 0.12) + ((double)i / n) * PI * 2;
			const double rad = 0.45 + (i % 3) * 0.3;
			draw(k_fish, s.x + std::cos(ang) * rad, wy - 0.06 + std::sin(time * 3 + i) * 0.02, s.z + std::sin(ang) * rad,
					std::atan2(-std::sin(ang), std::cos(ang)), 0, 0, 1.2, 1.2, 1.2);
		}
		for (int j = 0; j < 3; j++) {
			const double u = time / 2.6 + j / 3.0 + s.id * 0.37;
			const double ph = fract(u);
			const int cyc = (int)std::floor(u);
			const double ox = (vh(s.id, cyc, 71 + j) - 0.5) * 1.6, oz = (vh(s.id, cyc, 74 + j) - 0.5) * 1.6;
			ring(s.x + ox, s.z + oz, 0.2 + ph * 0.7, 0.3 * (1 - ph) * std::min(1.0, ph * 6), 0.3);
		}
		const double cyc = 3.2 + (s.id % 3) * 0.7;
		const double lt = std::fmod(time + s.id * 1.37, cyc);
		const double ang = s.id * 1.9 + std::floor((time + s.id * 1.37) / cyc) * 2.3;
		const int32_t seed = s.id * 131 + (int32_t)std::floor((time + s.id * 1.37) / cyc);
		if (lt < 0.7) {
			const double k = lt / 0.7;
			const double jx = s.x + std::cos(ang) * (0.3 + k * 0.9), jz = s.z + std::sin(ang) * (0.3 + k * 0.9);
			draw(k_fish, jx, wy + std::sin(k * PI) * 0.7, jz, ang + PI / 2, (k - 0.5) * 2.2, 0, 1.4, 1.4, 1.4);
		}
		// splash where it leaves the water and where it falls back in
		const double x0 = s.x + std::cos(ang) * 0.3, z0 = s.z + std::sin(ang) * 0.3;
		const double x1 = s.x + std::cos(ang) * 1.2, z1 = s.z + std::sin(ang) * 1.2;
		if (lt < 1.1) ring(x0, z0, 0.12 + lt * 0.45, 0.5 * (1 - lt / 1.1), 0.35);
		if (lt >= 0.7 && lt < 1.9) ring(x1, z1, 0.12 + (lt - 0.7) * 0.55, 0.6 * (1 - (lt - 0.7) / 1.2), 0.35);
		droplets(x0, z0, lt, seed, 4, 0.7);
		droplets(x1, z1, lt - 0.7, seed + 7, 6, 1.0);
	}

	// ---- fishing boats: hull, net ripples and fish while fishing, wake when under way
	for (const aov::Boat &b : ec.fishing.boats) {
		const double x = b.prev_x + (b.x - b.prev_x) * alpha, z = b.prev_z + (b.z - b.prev_z) * alpha;
		if (b.owner != me && !SM.fog.is_visible(x, z)) continue;
		const double bob = std::sin(time * 1.6 + b.id) * 0.05;
		const Lin team = hex_lin(b.owner >= 0 && b.owner < aov::MAX_PLAYERS && SM.players[b.owner].exists ? SM.players[b.owner].color : 0xffffff);
		draw(k_boat, x, wy - 0.12 + bob, z, b.rot, std::sin(time * 1.4 + b.id) * 0.03, std::sin(time * 1.1 + b.id * 2) * 0.05, 1, 1, 1,
				team.r, team.g, team.b, 1);
		if (b.state == aov::BS_FISHING) {
			for (int i = 0; i < 3; i++) {
				const double a = b.rot + PI / 2 + (i - 1) * 0.4;
				const double k = std::fmod(time * 1.5 + i * 0.33 + b.id, 1.0);
				draw(k_fish, x + std::sin(a) * 1.0, wy + std::sin(k * PI) * 0.35, z + std::cos(a) * 1.0, a + i, (k - 0.5) * 2, 0, 1.1, 1.1, 1.1);
			}
			const double a = b.rot + PI / 2;
			for (int j = 0; j < 2; j++) {
				const double ph = fract(time / 1.8 + j * 0.5 + b.id * 0.29);
				ring(x + std::sin(a) * 1.0, z + std::cos(a) * 1.0, 0.25 + ph * 0.6, 0.4 * (1 - ph), 0.3);
			}
			const double k = std::fmod(time * 1.5 + b.id, 1.0);
			droplets(x + std::sin(a) * 1.0, z + std::cos(a) * 1.0, k - 0.45, b.id * 17 + (int32_t)std::floor(time * 1.5 + b.id), 3, 0.6);
		}
		const double dx = b.x - b.prev_x, dz = b.z - b.prev_z;
		const double v = std::sqrt(dx * dx + dz * dz) / aov::SIM_DT;
		if (v > 0.15) {
			const double fx_ = dx / (v * aov::SIM_DT), fz_ = dz / (v * aov::SIM_DT);
			for (int j = 0; j < 5; j++) {
				const double ph = fract(time / 1.6 + j / 5.0);
				const double age = ph * 1.6;
				const double back = 0.8 + v * age;
				ring(x - fx_ * back, z - fz_ * back, 0.2 + age * 0.35, 0.45 * (1 - ph) * std::min(1.0, v / 0.8), 0.35);
			}
		}
	}

	// ---- crops on farms (the harvest front sweeps the rows as the farmer works)
	for (int i = 0; i < B.size(); i++) {
		if (B.removed[i] || !B.built[i] || !aov::building_def(B.type[i]).farm) continue;
		if (!SM.fog.is_explored(B.x[i], B.z[i])) continue;
		const int32_t id = B.id[i];
		const int tx = B.tx[i], tz = B.tz[i], w = B.w[i], h = B.h[i];
		const double H = B.econ_rows[i];
		const int segs = w - 1;
		const double dz = (h - 1.1) / FARM_ROWS;
		const double y = map.height_at(B.x[i], B.z[i]) + 0.02;
		const bool back = std::fmod(std::floor(H / FARM_ROWS), 2.0) == 1;
		for (int r = 0; r < FARM_ROWS; r++) {
			const double last_cut = H < r ? -INFINITY : std::floor((H - r) / FARM_ROWS) * FARM_ROWS + r;
			const bool cur = std::fmod(std::floor(H), (double)FARM_ROWS) == r && H >= r;
			const double age = H - last_cut;
			const int stage = age < FARM_ROWS * 0.35 ? 0 : age < FARM_ROWS * 0.7 ? 1 : 2;
			const double z = tz + 0.55 + (r + 0.5) * dz;
			for (int s = 0; s < segs; s++) {
				int st = stage;
				if (cur) {
					const double frac = H - std::floor(H);
					const double p = back ? 1 - (s + 0.5) / segs : (s + 0.5) / segs;
					st = p < frac ? 0 : 2;
				}
				const double jit = vh(id * 13 + r, s, 5);
				draw(k_wheat[st], tx + 0.5 + s, y, z, 0, 0, 0, 1, 0.66 + jit * 0.24, 1, 1, 1, 1, (float)(0.92 + jit * 0.16));
			}
			// Godot-only: a cut row keeps a stook or two of bound sheaves standing
			// on the stubble until the crop grows back
			if (stage == 0 && !cur && k_sheaf >= 0) {
				const int32_t cyc = (int32_t)std::floor((H - r) / FARM_ROWS);
				for (int q = 0; q < 2; q++) {
					const double hh = vh(id * 13 + r, cyc * 2 + q, 9);
					if (hh > (q == 0 ? 0.5 : 0.18)) continue;
					const double sx = tx + 0.5 + std::floor(vh(id * 13 + r, cyc * 2 + q, 10) * segs) + (vh(id, r + q * 17, 11) - 0.5) * 0.4;
					const double sc = 0.68 + hh * 0.3;
					draw(k_sheaf, sx, y, z, vh(id, r, 12) * PI, (vh(id, r, 13) - 0.5) * 0.2, (vh(id, r, 14) - 0.5) * 0.25, sc, sc, sc);
				}
			}
		}
	}

	// ---- stockpiles beside drop-off buildings
	for (int i = 0; i < B.size(); i++) {
		if (B.removed[i] || !B.built[i]) continue;
		const double st[6] = { B.stock_grain[i], B.stock_fruit[i], B.stock_meat[i], B.stock_fish[i], B.stock_wood[i], B.stock_gold[i] };
		bool any = false;
		for (double v : st) any = any || v >= 5;
		if (!any || !SM.fog.is_explored(B.x[i], B.z[i])) continue;
		const int32_t id = B.id[i];
		const std::vector<Slot> &slots = stock_slots(i);
		size_t si = 0;
		for (int kind = 0; kind < 6; kind++) {
			const double amt = st[kind];
			if (amt < 5) continue;
			const int n = std::min(4, (int)std::ceil(std::log2(1 + amt / 16)));
			for (int j = 0; j < n && si < slots.size(); j++, si++) {
				const Slot &sl = slots[si];
				const int key = k_stock[kind][j % 3];
				const double sc = 1.25 + vh(id, (int)si, 7) * 0.2;
				draw(key, sl.x, sl.y, sl.z, sl.rot, 0, 0, sc, sc, sc);
				const char *name = STOCK_KEYS[kind][j % 3];
				if (j >= 2 && (std::strncmp(name, "crate", 5) == 0 || std::strcmp(name, "sack") == 0))
					draw(key, sl.x + 0.05, sl.y + 0.5, sl.z - 0.04, sl.rot + 0.4, 0, 0, 1.1, 1.1, 1.1);
			}
		}
	}

	// ---- villagers: oversized loads while walking, work effects while gathering
	const int rows = (int)U.id.size();
	for (int i = 0; i < rows; i++) {
		if (U.removed[i] || U.dead[i] || (U.type[i] != aov::U_VILLAGER && U.type[i] != aov::U_LABORER)) continue; // (sim/civ: the Laborer too)
		const int st = U.anim_state[i];
		if (st != aov::A_WALK && st != aov::A_GATHER) continue;
		const double x = U.prev_x[i] + (U.x[i] - U.prev_x[i]) * alpha, z = U.prev_z[i] + (U.z[i] - U.prev_z[i]) * alpha;
		if (U.owner[i] != me && !SM.fog.is_visible(x, z)) continue;
		const int32_t id = U.id[i];
		double dr = U.rot[i] - U.prev_rot[i];
		while (dr > PI) dr -= PI * 2;
		while (dr < -PI) dr += PI * 2;
		const double rot0 = U.prev_rot[i] + dr * alpha;
		// the units view's pose clock (unit_view.cpp pose_unit)
		const double m = 0.85 + uhash(id, 40) * 0.3;
		const double t = (U.anim_t[i] + da) * m + std::fmod(id * 0.618034, 1.0) * PI * 2 * 0.5;

		if (st == aov::A_WALK) {
			if (U.carry_amount[i] < 1.5) continue;
			const uint8_t lk = load_kind(SM.entities, i, false);
			if (lk == 255) continue;
			// the units view's root: slot jitter, walk bob
			const double rot = rot0;
			const double jl = (uhash(id, 5) - 0.5) * 2 * 0.18, jf = (uhash(id, 6) - 0.5) * 2 * 0.18 * 0.6;
			const double cs = std::cos(rot), sn = std::sin(rot);
			const double ux = x + cs * jl + sn * jf, uz = z - sn * jl + cs * jf;
			const double p = t * 10;
			const double sc = 0.93 + uhash(id, 7) * 0.13;
			const double bob = (1 - std::abs(std::cos(p))) * 0.08 * sc;
			const double k = std::min(1.0, U.carry_amount[i] / std::max(1.0, aov::unit_carry_cap(U.type[i], U.carry_type[i])));
			const double y0 = map.height_at(ux, uz) + bob;
			const double s = (0.75 + 0.35 * k) * sc;
			const double sway = std::sin(p) * 0.05;
			auto put = [&](int key, double lx, double ly, double lz, double pitch, double roll, double scale) {
				lx *= sc; ly *= sc; lz *= sc;
				draw(key, ux + lx * cs + lz * sn, y0 + ly, uz - lx * sn + lz * cs, rot, pitch, roll, scale, scale, scale);
			};
			switch (lk) {
				case 0: put(k_load[0], -0.2, 1.42, 0.05, -0.28, sway, s); break;
				case 1: put(k_load[1], 0, 1.9, 0, 0, sway, s * 0.72); break;
				case 2: put(k_load[2], -0.22, 1.36, -0.05, -0.5, -0.3 + sway, s); break;
				case 4: put(k_load[4], 0.05, 1.3, -0.2, -0.3, sway, s); break;
				default: put(k_load[3], 0, 1.9, 0, 0, sway, s * 0.8); break;
			}
			continue;
		}

		// gathering: the units view's standing root (crowd yaw, slot jitter)
		const uint8_t gk = load_kind(SM.entities, i, true);
		if (gk == 255) continue;
		const double yaw = (uhash(id, 8) < 0.5 ? -1 : 1) * (0.087 + uhash(id, 4) * 0.175) * 1.15;
		const double rot = rot0 + yaw;
		const double jl = (uhash(id, 5) - 0.5) * 2 * 0.18, jf = (uhash(id, 6) - 0.5) * 2 * 0.18 * 0.6;
		const double cs = std::cos(rot), sn = std::sin(rot);
		const double ux = x + cs * jl + sn * jf, uz = z - sn * jl + cs * jf;
		const double gy = map.height_at(ux, uz);
		// forward (+z at rot 0) and right
		const double fx_ = sn, fz_ = cs, rx = cs, rz = -sn;
		const double since_start = U.anim_t[i] + da;
		if (gk == 0 || gk == 1) {
			// axe / pick strike: the swing comes down at cyc ~0.8 (anim.js)
			const double u = t * 0.9 - 0.8;
			const int n = (int)std::floor(u);
			const double age = (u - n) / (0.9 * m);
			if (age > since_start || age > 1.1) continue;
			const bool wood = gk == 0;
			const double px = ux + fx_ * 0.62, pz = uz + fz_ * 0.62;
			const double y0 = gy + (wood ? 0.55 : 0.3);
			const int nc = wood ? 10 : 11;
			for (int j = 0; j < nc; j++) {
				const double h1 = vh(id * 7 + j, n, 61), h2 = vh(id * 7 + j, n, 62), h3 = vh(id * 7 + j, n, 63), h4 = vh(id * 7 + j, n, 64);
				const double vf = -(0.35 + h1 * 1.0), vs = (h2 - 0.5) * 2.4, vu = 1.3 + h3 * 1.9;
				const double g = 8.5;
				const double land = (vu + std::sqrt(vu * vu + 2 * g * std::max(0.0, y0 - gy - 0.03))) / g;
				const double a = std::min(age, land);
				double cx = px + (fx_ * vf + rx * vs) * a, cz = pz + (fz_ * vf + rz * vs) * a;
				const double cy = age < land ? y0 + vu * a - 0.5 * g * a * a : map.height_at(cx, cz) + 0.03;
				const double life = 1.1 - h4 * 0.3;
				if (age > life) continue;
				const double fade = clamp01((life - age) / 0.25);
				const double size = (wood ? 0.12 + h4 * 0.09 : 0.1 + h4 * 0.08) * fade;
				uint32_t col;
				float glow = 0;
				if (wood) col = j % 3 == 0 ? 0x5c3d24 : (h4 < 0.5 ? 0xe0bc80 : 0xcfa468);
				else if (j % 2 == 0) { col = h4 < 0.5 ? 0xffd24a : 0xf0b830; glow = 1.6f; }
				else col = h4 < 0.5 ? 0x8f887e : 0x6f6a64;
				chip(cx, cy, cz, size, col, h1 * 6 + a * 11 * (h2 + 0.3), a * 13 * (h3 + 0.4), glow);
			}
			for (int j = 0; j < 2; j++) {
				const double h1 = vh(id * 5 + j, n, 66);
				const double k = age / 1.1;
				const double qx = px - fx_ * 0.15 + rx * (h1 - 0.5) * 0.5 + (j ? 0.1 : -0.1), qz = pz - fz_ * 0.15 + rz * (h1 - 0.5) * 0.5;
				puff(qx, gy + 0.12 + k * 0.35 + (wood ? 0.2 : 0), qz, 0.35 + k * 0.8, wood ? 0xf0dfb8 : 0xd8d0c4, 0.8 * (1 - k) * std::min(1.0, age * 12));
			}
		} else if (gk == 2) {
			// sickle: straw chaff kicked up off the row, drifting downwind
			for (int j = 0; j < 7; j++) {
				const double u = time / 1.25 + j / 7.0 + vh(id, j, 67);
				const double ph = fract(u);
				const int cyc = (int)std::floor(u);
				if (ph * 1.25 > since_start) continue;
				const double h1 = vh(id * 4 + j, cyc, 68), h2 = vh(id * 4 + j, cyc, 69);
				const double a = ph * 1.25;
				// cut at the row ahead, tossed back and aside over the stubble behind
				const double sx = ux + fx_ * (0.55 + h1 * 0.2) + rx * (h2 - 0.5) * 0.3, sz = uz + fz_ * (0.55 + h1 * 0.2) + rz * (h2 - 0.5) * 0.3;
				const double back = a * (0.7 + h2 * 0.6), side = (h1 - 0.5) * 1.4 * a;
				const double cx = sx - fx_ * back + rx * side + std::sin(a * 6 + j) * 0.06, cz = sz - fz_ * back + rz * side + std::cos(a * 5 + j) * 0.06;
				const double cy = gy + 0.5 + a * (1.3 - a * 0.85) + h1 * 0.1;
				chip(cx, cy, cz, (0.12 + h1 * 0.06) * (1 - ph * ph), h2 < 0.45 ? 0xfff2c4 : h2 < 0.85 ? 0xf2d77e : 0x9cc05a, h1 * 6 + a * 7, a * 9 + h2 * 3);
			}
			{
				const double ph = fract(time / 0.9 + vh(id, 0, 77));
				const double px = ux + fx_ * 0.5 + ph * 0.25, pz = uz + fz_ * 0.5 + ph * 0.1;
				puff(px, gy + 0.7 + ph * 0.4, pz, 0.3 + ph * 0.5, 0xfff0c8, 0.55 * (1 - ph) * std::min(1.0, ph * 8));
			}
		} else if (gk == 3) {
			// berry picking: leaves and the odd berry dropping from the bush
			for (int j = 0; j < 2; j++) {
				const double u = time / 1.7 + j * 0.5 + vh(id, j, 70);
				const double ph = fract(u);
				const int cyc = (int)std::floor(u);
				const double h1 = vh(id * 2 + j, cyc, 71), h2 = vh(id * 2 + j, cyc, 72);
				const double a = ph * 1.7;
				const double cx = ux + fx_ * (0.55 + h1 * 0.2) + rx * (h2 - 0.5) * 0.6 + std::sin(a * 5 + j) * 0.08;
				const double cz = uz + fz_ * (0.55 + h1 * 0.2) + rz * (h2 - 0.5) * 0.6;
				const double cy = std::max(gy + 0.04, gy + 0.7 - a * 0.45);
				chip(cx, cy, cz, 0.08 * (1 - std::max(0.0, ph - 0.7) / 0.3), h2 < 0.3 ? 0xc0304a : 0x5e9a38, a * 4 + h1 * 6, std::sin(a * 6) * 0.8);
			}
		}
	}

	// ---- static field dressing placed by scenes
	for (const aov::Decor &d : ec.decor) {
		if (!SM.fog.is_explored(d.x, d.z)) continue;
		auto it = key_idx_.find(d.key);
		if (it == key_idx_.end()) continue;
		const double s = d.scale == 0 ? 1 : d.scale;
		draw(it->second, d.x, map.height_at(d.x, d.z) + d.y, d.z, d.rot, 0, 0, s, s, s);
	}

	Array props;
	PackedInt32Array counts;
	for (const Buf &b : props_) {
		props.push_back(pack(b));
		counts.push_back(b.n);
	}
	out["props"] = props;
	out["counts"] = counts;
	out["chips"] = pack(chips_);
	out["chip_count"] = chips_.n;
	out["puffs"] = pack(puffs_);
	out["puff_count"] = puffs_.n;
	out["rings"] = pack(rings_);
	out["ring_count"] = rings_.n;
	return out;
}
