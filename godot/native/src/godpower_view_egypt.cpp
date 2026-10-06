// AovGodpowerView, the Egyptian gods' half (see godpower_view.h): the visuals of the twelve
// Egyptian powers and of the Egyptian myth units' abilities (sim/godpowers egypt_powers.cpp /
// egypt_myth.cpp), into the same ribbon groups, instance buffers and lights as the Lightning
// Storm, plus a small state dictionary for game/godpowers/egypt_fx.gd (the full-frame grade of
// the Eclipse and the Rain, the rainbow, the tornado funnels). Visual only, never the sim RNG,
// everything a function of the sim time (a paused capture is exact).
//
//   Rain            falling streaks round the camera, splash rings, dark wet Farms with green
//                   shoots rising, a cool grey grade and a rainbow (egypt_fx.gd)
//   Prosperity      a gold column over every gold mine the caster works, gold motes spiralling
//                   up, a sun ring on the ground, glints over his miners
//   Vision          the reveal's edge as a bright swirling ring growing to 42 tiles, white
//                   wisps on it, an Eye of Horus burnt into the ground at its heart
//   Eclipse         the world sunk in a deep blue dusk (egypt_fx.gd), pink-violet halos and
//                   motes round the caster's myth units, his Monuments glowing
//   Shifting Sands  sand vortices at both ends: a sand swirl on the ground, sand spiralling
//                   up, grains whirling, a burst at the destination when the units arrive
//   Plague of Serpents  a green glyph ring round the spot, the sand cracking open with a
//                   green glow and a puff of sand where each serpent rises
//   Locust Swarm    five clouds of voxel locusts boiling along their track over a dusty brown
//                   haze, a shadow under each
//   Citadel         a gold pillar of light on the Town Center, a shock ring, sandstone blocks
//                   rising round it; a gold ring and motes on every Citadel Center
//   Ancestors       a blue glyph ring and cold mist; a blue pillar, cracks and wisps where each
//                   Minion claws out
//   Son of Osiris   a pillar of gold light, a gold ring and a sun disc at the change; a gold
//                   ring under him while he lives; his chain lightning in gold
//   Tornado         (funnel: egypt_fx.gd) sand and debris whirled up its sides, a dust skirt,
//                   a sand swirl under it, sand drifts left along its spiral track
//   Thoth's Meteor  the Greek meteor's fireballs, craters and fires (sim Meteor kind 1) under a
//                   teal glyph ring round the target circle
//   abilities       venom motes, the curse's dark wisps, sting flashes, the Sphinx's whirlwind,
//                   the Avenger's spinning blades, the Anubite's landing, the Petsuchos' sun beam
#include "godpower_view.h"

#include <algorithm>
#include <cmath>

#include "sim/sim.h"

using namespace godot;

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr double TAU = PI * 2;

struct Lin { float r, g, b; };
inline float lin1(double c) { return (float)(c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4)); }
inline Lin hex_lin(uint32_t h) { return { lin1(((h >> 16) & 255) / 255.0), lin1(((h >> 8) & 255) / 255.0), lin1((h & 255) / 255.0) }; }
inline double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline double sstep(double e0, double e1, double x) {
	const double t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
}
inline uint32_t hmix(uint32_t a, uint32_t b, uint32_t c) {
	uint32_t h = a * 0x9E3779B1u ^ (b + 0x7F4A7C15u) * 0x85EBCA77u ^ (c + 0x165667B1u) * 0xC2B2AE3Du;
	h ^= h >> 15; h *= 0x2C1B3C6Du; h ^= h >> 12; h *= 0x297A2D39u; h ^= h >> 15;
	return h;
}
// a stable random in [0, 1) per (a, b, c)
inline double hr(uint32_t a, uint32_t b, uint32_t c = 0) { return (hmix(a, b, c) & 0xffffff) / 16777216.0; }
// fade in over `in`, out over `out` before `end`
inline double env(double now, double t0, double end, double in, double out) {
	return clamp01((now - t0) / in) * clamp01((end - now) / out);
}

using P = AovGodpowerView::P;
using Line = AovGodpowerView::Line;

std::vector<P> fractal(aov::RNG &rng, P a, P b, int depth, double rough) {
	std::vector<P> pts{ a, b };
	double amp = std::sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + (b.z - a.z) * (b.z - a.z)) * rough;
	for (int d = 0; d < depth; d++) {
		std::vector<P> out;
		out.push_back(pts[0]);
		for (size_t i = 1; i < pts.size(); i++) {
			const P &p = pts[i - 1], &q = pts[i];
			P m;
			m.x = (p.x + q.x) / 2 + rng.range(-amp, amp);
			m.y = (p.y + q.y) / 2 + rng.range(-amp, amp) * 0.5;
			m.z = (p.z + q.z) / 2 + rng.range(-amp, amp);
			out.push_back(m);
			out.push_back(q);
		}
		pts.swap(out);
		amp *= 0.55;
	}
	return pts;
}

void line(std::vector<Line> &L, const std::vector<P> &pts, double w, double i, double taper, double fade, bool halo = false) {
	L.push_back(Line{ pts, w, i, taper, fade, halo, -1 });
}

double type_height(int type) {
	switch (type) {
		case aov::U_ROC: case aov::U_PHOENIX: return 3.2;
		case aov::U_WAR_ELEPHANT: case aov::U_SIEGE_TOWER: return 4.2;
		case aov::U_SCARAB: case aov::U_PETSUCHOS: case aov::U_SERPENT: return 1.5;
		case aov::U_SON_OF_OSIRIS: return 3.0;
		default: return 2.3;
	}
}

// sandstone / sand palette
constexpr uint32_t SAND[4] = { 0xd9b77a, 0xc9a263, 0xe6c98f, 0xb88c4f };

} // namespace

bool AovGodpowerView::egypt_active() const {
	if (sim_ref_.is_null()) return false;
	const aov::Sim &S = sim_ref_->sim();
	const aov::GodPowers &G = S.godpowers;
	const double now = S.time;
	for (int o = 1; o < aov::MAX_PLAYERS; o++)
		if (G.rain[o].until > now - 3 || G.prosperity[o].until > now - 2) return true;
	if (G.eclipse.until > now - 3) return true;
	if (!G.citadels.empty()) return true;
	bool egypt = false; // (a Greek game pays nothing more)
	for (int o = 1; o < aov::MAX_PLAYERS; o++) egypt |= S.players[o].exists && S.players[o].civ == aov::CIV_EGYPT;
	if (!egypt) return false;
	for (int r = 0; r < S.entities.units.size(); r++) // (the Son of Osiris' ring)
		if (S.entities.units.type[r] == aov::U_SON_OF_OSIRIS && !S.entities.units.removed[r]) return true;
	return !G.visions.empty() || !G.sands.empty() || !G.serpents.empty() || !G.ancestors.empty() || !G.swarms.empty() ||
			!G.citadel_fx.empty() || !G.sons.empty() || !G.tornadoes.empty() || !G.thoth.empty() || !G.rises.empty() || !G.arcs.empty() ||
			!G.dots.empty() || !G.ability_fx.empty() || !drifts_.empty();
}

void AovGodpowerView::egypt_fx(double now, double ua, const Vector3 &cam, int &li, Dictionary &eg) {
	const aov::Sim &S = sim_ref_->sim();
	const aov::GodPowers &G = S.godpowers;
	const aov::Entities &E = S.entities;
	const aov::UnitStore &U = E.units;
	const aov::BuildingStore &B = E.buildings;
	const int MAX_LIGHTS = 4;
	auto upos = [&](int row, double &x, double &z) {
		x = U.prev_x[row] + (U.x[row] - U.prev_x[row]) * ua;
		z = U.prev_z[row] + (U.z[row] - U.prev_z[row]) * ua;
	};
	auto lit = [&](double x, double y, double z, uint32_t hex, double inten, double dist, double decay) {
		if (li >= MAX_LIGHTS || inten <= 0.01) return;
		li++;
		light(x, y, z, hex, inten, dist, decay);
	};
	// the ground point the camera looks at (pitch ~50, so ~0.8 x its height ahead of it, towards -z
	// in its yaw; a box round the camera's own x / z covers the frame for the rain)
	const double cx = cam.x, cz = cam.z;

	// ---- Rain: streaks round the camera, splashes, wet farms, green shoots ---------------------
	double rain_k = 0;
	int rain_owner = 0;
	for (int o = 1; o < aov::MAX_PLAYERS; o++) {
		const aov::TimedPower &t = G.rain[o];
		if (t.until <= now - 3) continue;
		const double k = clamp01((now - t.t0) / 2.0) * clamp01((t.until + 3 - now) / 3.0);
		if (k > rain_k) { rain_k = k; rain_owner = o; }
	}
	if (rain_k > 0) {
		std::vector<Line> L;
		const double W = 64, H = 22, sp = 26; // box, fall height, speed (tiles/s)
		const int N = (int)(900 * rain_k);
		const double ox = std::floor(cx / W) * W, oz = std::floor(cz / W) * W;
		for (int i = 0; i < N; i++) {
			double x = ox + hr(i, 1) * W, z = oz + hr(i, 2) * W;
			if (x < cx - W / 2) x += W;
			if (x > cx + W / 2) x -= W;
			if (z < cz - W / 2) z += W;
			if (z > cz + W / 2) z -= W;
			const double gy = h_at(x, z);
			const double ph = std::fmod(now * sp / H + hr(i, 3), 1.0);
			const double y = gy + H * (1 - ph);
			const double len = 0.9 + 0.5 * hr(i, 4);
			std::vector<P> pts{ P{ x + 0.18 * len, y + len, z + 0.06 * len }, P{ x, y, z } };
			line(L, pts, 0.03, 1.1 * rain_k * (0.6 + 0.4 * hr(i, 5)), 0.2, 0.5);
		}
		emit_lines(G_RAIN, L, 1);
		// splash rings and spray (each ring lives 0.35 s)
		const int NS = (int)(160 * rain_k);
		const Lin sc = hex_lin(0xd8e8ff);
		for (int i = 0; i < NS; i++) {
			const double per = 0.35, ph = now / per + hr(i, 11);
			const int64_t cyc = (int64_t)std::floor(ph);
			const double f = ph - cyc;
			double x = cx + (hr(i, 12, (uint32_t)cyc) - 0.5) * 50, z = cz + (hr(i, 13, (uint32_t)cyc) - 0.5) * 50;
			decal(I_DECAL_ADD, x, h_at(x, z) + 0.05, z, 0.15 + 0.5 * f, 0, sc.r, sc.g, sc.b, (float)(0.5 * (1 - f) * rain_k), 2, 0.55f);
		}
		// the caster's Farms: soaked dark earth, green shoots sparkling up
		int nf = 0;
		for (int b = 0; b < B.size() && nf < 40; b++) {
			if (B.removed[b] || B.dead[b] || B.owner[b] != rain_owner || !aov::building_def(B.type[b]).farm) continue;
			nf++;
			const double fx = B.x[b], fz = B.z[b], gy = h_at(fx, fz);
			decal(I_DECAL_MUL, fx, gy + 0.06, fz, std::max(B.w[b], B.h[b]) * 1.5, 0, 1, 1, 1, (float)(0.35 * rain_k), 0);
			const Lin gc = hex_lin(0x7cff6a);
			for (int k = 0; k < 10; k++) {
				const double per = 1.6, ph = now / per + hr(b, k, 21);
				const int64_t cyc = (int64_t)std::floor(ph);
				const double f = ph - cyc;
				const double px = fx + (hr(b, k, 22 + (uint32_t)cyc) - 0.5) * B.w[b], pz = fz + (hr(b, k, 23 + (uint32_t)cyc) - 0.5) * B.h[b];
				const double s = 0.05 * (1 - f);
				cube(I_EMBER, px, gy + 0.2 + f * 1.4, pz, now + k, k, 0, s, s * 2.2, s, gc.r * 1.6f, gc.g * 1.6f, gc.b * 1.0f);
			}
		}
		Dictionary rd;
		rd["k"] = rain_k;
		rd["owner"] = rain_owner;
		// the rainbow over the caster's home Town Center (else the camera's ground point)
		double rx = cx, rz = cz - 18;
		const int tc = E.building_slot(S.civs.home_tc[rain_owner]);
		if (tc >= 0 && !B.dead[tc]) { rx = B.x[tc]; rz = B.z[tc]; }
		rd["x"] = rx;
		rd["z"] = rz;
		rd["y"] = h_at(rx, rz);
		eg["rain"] = rd;
	}

	// ---- Prosperity: gold columns and motes over the caster's gold mines --------------------------
	for (int o = 1; o < aov::MAX_PLAYERS; o++) {
		const aov::TimedPower &t = G.prosperity[o];
		if (t.until <= now - 2) continue;
		const double k = clamp01((now - t.t0) / 1.5) * clamp01((t.until + 2 - now) / 2.0);
		const aov::ResourceStore &R = E.resources;
		// the mines with one of his gatherers on them, or within 9 tiles of his drop sites
		std::vector<int> mines;
		for (int r = 0; r < R.size() && mines.size() < 8; r++) {
			if (R.removed[r] || R.type[r] != aov::R_GOLD || R.amount[r] <= 0) continue;
			bool his = false;
			for (int b = 0; b < B.size() && !his; b++) {
				if (B.removed[b] || B.dead[b] || B.owner[b] != o) continue;
				if (!(B.type[b] == aov::B_MINING_CAMP || B.type[b] == aov::B_TOWN_CENTER || B.type[b] == aov::B_STOREHOUSE)) continue;
				if (std::hypot(B.x[b] - R.x[r], B.z[b] - R.z[r]) < 9 + B.w[b] * 0.5) his = true;
			}
			if (his) mines.push_back(r);
		}
		const Lin gold = hex_lin(0xff9a10), pale = hex_lin(0xffc040);
		for (size_t m = 0; m < mines.size(); m++) {
			const int r = mines[m];
			const double x = R.x[r], z = R.z[r], gy = h_at(x, z);
			const double pulse = 0.8 + 0.2 * std::sin(now * 2.2 + m);
			glow(false, x, gy + 3.5, z, 2.4, 7.5, gold.r, gold.g * 0.8f, gold.b, 0.22 * k * pulse, 0);
			glow(false, x, gy + 1.2, z, 5.0, 2.0, gold.r, gold.g * 0.8f, gold.b, 0.18 * k, 0);
			decal(I_DECAL_ADD, x, gy + 0.1, z, 8.5, now * 0.15, gold.r, gold.g, gold.b, (float)(1.2 * k), 5, 0.78f, (float)(now * 0.1));
			decal(I_DECAL_ADD, x, gy + 0.08, z, 6.0, 0, gold.r, gold.g, gold.b, (float)(0.35 * k), 1);
			for (int i = 0; i < 46; i++) {
				const double per = 2.4 + hr(r, i, 31) * 1.6, ph = now / per + hr(r, i, 32);
				const double f = ph - std::floor(ph);
				const double a = hr(r, i, 33) * TAU + f * 3.2, rr = 0.6 + 1.6 * hr(r, i, 34) * (1 - 0.5 * f);
				const double s = (0.045 + 0.05 * hr(r, i, 35)) * std::sin(f * PI);
				const double b2 = 0.6 + 0.6 * std::sin(now * 9 + i);
				cube(I_EMBER, x + std::cos(a) * rr, gy + 0.4 + f * 6.5, z + std::sin(a) * rr, now * 3 + i, a, i, s, s, s,
						(float)(4.0 * k * b2), (float)(1.9 * k * b2), (float)(0.25 * k * b2));
			}
			if (m == 0) lit(x, gy + 3, z, 0xffc040, 9 * k * pulse, 12, 1.6);
		}
		// glints over his miners
		int ng = 0;
		for (int u = 0; u < U.size() && ng < 40; u++) {
			if (U.removed[u] || U.dead[u] || U.owner[u] != o || U.carry_type[u] != aov::RES_GOLD || U.carry_amount[u] <= 0) continue;
			ng++;
			double x, z;
			upos(u, x, z);
			const double tw = 0.5 + 0.5 * std::sin(now * 7 + u);
			cube(I_EMBER, x, h_at(x, z) + 2.4 + 0.15 * std::sin(now * 3 + u), z, now * 2, u, 0.6, 0.07, 0.07, 0.07, 3.2f * tw, 2.4f * tw, 0.6f * tw);
		}
		// the cast: a gold ring racing out from his Town Center
		const double age = now - t.t0;
		const int tc = E.building_slot(S.civs.home_tc[o]);
		if (age < 2.5 && tc >= 0) {
			const double f = age / 2.5;
			decal(I_DECAL_ADD, B.x[tc], h_at(B.x[tc], B.z[tc]) + 0.15, B.z[tc], 6 + 40 * std::pow(f, 0.7), 0, gold.r, gold.g, gold.b,
					(float)(2.4 * (1 - f)), 4, 0.06f, 0.37f);
		}
	}

	// ---- Vision: the swirling edge, wisps, the Eye --------------------------------------------------
	for (const aov::VisionCast &v : G.visions) {
		const double age = now - v.t0, k = env(now, v.t0, v.t0 + v.dur, 0.3, 1.5);
		const double gy = h_at(v.x, v.z);
		const Lin wc = hex_lin(0xe8f6ff), cy = hex_lin(0x5fe0ff);
		const double r = v.r;
		decal(I_DECAL_ADD, v.x, gy + 0.25, v.z, 2 * r * 1.04, 0, wc.r, wc.g, wc.b, (float)(1.6 * k), 4, (float)std::max(0.03, 1.6 / r), 0.73f);
		decal(I_DECAL_ADD, v.x, gy + 0.2, v.z, 2 * r * 1.12, -now * 0.35, cy.r, cy.g, cy.b, (float)(0.9 * k), 6, 0.8f, (float)(now * 0.2));
		decal(I_DECAL_ADD, v.x, gy + 0.18, v.z, 2 * r * 0.96, now * 0.22, wc.r, wc.g, wc.b, (float)(0.5 * k), 6, 0.82f, (float)(now * 0.3 + 3));
		// the Eye of Horus at the heart, burning out over 4 s
		const double ek = clamp01(1 - (age - 1.5) / 3.0) * clamp01(age / 0.4);
		if (ek > 0) {
			decal(I_DECAL_ADD, v.x, gy + 0.3, v.z, 9, 0, cy.r * 1.5f, cy.g * 1.5f, cy.b * 1.5f, (float)(1.8 * ek), 7);
			glow(false, v.x, gy + 2, v.z, 7, 5, cy.r, cy.g, cy.b, 0.3 * ek, 0);
			lit(v.x, gy + 4, v.z, 0x80e0ff, 14 * ek, 16, 1.4);
		}
		// wisps riding the edge
		const int NW = (int)(std::min(140.0, 18 + r * 3.2));
		for (int i = 0; i < NW; i++) {
			const double a = hr(i, 41) * TAU + now * (0.25 + 0.2 * hr(i, 42)) * (i % 2 ? 1 : -1);
			const double rr = r * (0.97 + 0.06 * hr(i, 43));
			const double px = v.x + std::cos(a) * rr, pz = v.z + std::sin(a) * rr;
			const double per = 1.4 + hr(i, 44), f = std::fmod(now / per + hr(i, 45), 1.0);
			const Lin c = hex_lin(i % 3 ? 0xdff4ff : 0x9fe8ff);
			Basis bs;
			const double s = (0.35 + 0.5 * hr(i, 46)) * (0.5 + f);
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			inst(I_FLAME, bs, px, h_at(px, pz) + 0.4 + f * 1.8, pz, c.r, c.g, c.b, (float)(0.5 * k * std::sin(f * PI)), 0);
		}
	}

	// ---- Eclipse: halos on the caster's myth units, his Monuments glowing ---------------------------
	double ecl_k = 0;
	if (G.eclipse.until > now - 3) {
		ecl_k = clamp01((now - G.eclipse.t0) / 2.5) * clamp01((G.eclipse.until + 3 - now) / 3.0);
		const int o = G.eclipse.owner;
		const Lin pk = hex_lin(0xff5ad8), vi = hex_lin(0xa070ff);
		int n = 0;
		for (int u = 0; u < U.size() && n < 120; u++) {
			if (U.removed[u] || U.dead[u] || U.owner[u] != o || aov::unit_def(U.type[u]).cls != aov::CLS_MYTH) continue;
			n++;
			double x, z;
			upos(u, x, z);
			const double h = type_height(U.type[u]), gy = h_at(x, z) + U.air_y[u];
			const double p = 0.75 + 0.25 * std::sin(now * 3 + u);
			double dx = x - cam.x, dz = z - cam.z;
			const double dl = std::max(1e-6, std::hypot(dx, dz));
			dx = dx / dl * 0.6;
			dz = dz / dl * 0.6;
			glow(true, x + dx, gy + h * 0.5, z + dz, h * 1.6, h * 1.7, pk.r, pk.g, pk.b, 0.42 * ecl_k * p, 0);
			decal(I_DECAL_ADD, x, h_at(x, z) + 0.12, z, 2.6, now, pk.r, pk.g, pk.b, (float)(0.8 * ecl_k), 1);
			for (int i = 0; i < 5; i++) {
				const double f = std::fmod(now / 1.8 + hr(u, i, 51), 1.0), a = hr(u, i, 52) * TAU + f * 2;
				const double s = 0.06 * std::sin(f * PI);
				cube(I_EMBER, x + std::cos(a) * 0.7, gy + f * h * 1.2, z + std::sin(a) * 0.7, now, a, 0, s, s, s, vi.r * 3 * (float)ecl_k, vi.g * 3 * (float)ecl_k, vi.b * 3 * (float)ecl_k);
			}
		}
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || B.owner[b] != o || !aov::is_monument(B.type[b])) continue;
			const double gy = h_at(B.x[b], B.z[b]);
			glow(false, B.x[b], gy + 2.5, B.z[b], 3, 6, pk.r, pk.g, pk.b, 0.3 * ecl_k, 0);
		}
		// falling dusk motes across the frame
		for (int i = 0; i < 90; i++) {
			const double f = std::fmod(now / (5 + 3 * hr(i, 53)) + hr(i, 54), 1.0);
			const double x = cx + (hr(i, 55) - 0.5) * 50, z = cz + (hr(i, 56) - 0.5) * 50;
			const double s = 0.05 * std::sin(f * PI);
			cube(I_EMBER, x, h_at(x, z) + 12 * (1 - f), z, now, i, 0, s, s, s, vi.r * 2 * (float)ecl_k, vi.g * 2 * (float)ecl_k, vi.b * 3 * (float)ecl_k);
		}
	}
	eg["eclipse"] = ecl_k;

	// ---- Shifting Sands: a vortex at both ends ------------------------------------------------------------
	for (const aov::SandsCast &c : G.sands) {
		const double age = now - c.t0, tp = c.delay;
		for (int end = 0; end < 2; end++) {
			const double x = end ? c.dx : c.sx, z = end ? c.dz : c.sz, gy = h_at(x, z);
			// the source spins up to the jump, the destination flares at it and settles
			double k = end ? (age < tp - 1 ? clamp01(age / tp) * 0.5 : sstep(tp - 1, tp, age)) * clamp01((tp + 3 - age) / 1.5)
						   : sstep(0, 1.2, age) * clamp01((tp + 1.2 - age) / 1.2);
			if (k <= 0.01) continue;
			const double R = c.radius * (end ? 1.05 : 1.0);
			decal(I_DECAL_MIX, x, gy + 0.08, z, 2 * R * 1.25, -now * 1.6, 1, 1, 1, (float)(0.95 * k), 2, (float)(now * 0.5), 0.f);
			const Lin sd = hex_lin(0xe8c27a);
			decal(I_DECAL_ADD, x, gy + 0.12, z, 2 * R * 1.3, now * 0.4, sd.r, sd.g * 0.85f, sd.b * 0.5f, (float)(0.45 * k), 6, 0.1f, (float)(now * 0.4));
			// sand spiralling up the vortex
			for (int i = 0; i < 70; i++) {
				const double per = 1.6 + 0.9 * hr(i, 61, end), f = std::fmod(now / per + hr(i, 62, end), 1.0);
				const double a = hr(i, 63, end) * TAU - f * 7.0 - now * 1.5;
				const double rr = R * (0.25 + 0.85 * hr(i, 64, end)) * (1 - 0.45 * f);
				const Lin cc = hex_lin(SAND[i & 3]);
				Basis bs;
				const double s = (0.35 + 0.45 * hr(i, 65, end)) * (0.6 + 0.9 * f);
				bs.rows[0] = Vector3((real_t)s, 0, 0);
				bs.rows[1] = Vector3(0, (real_t)s, 0);
				bs.rows[2] = Vector3(0, 0, 1);
				const double px = x + std::cos(a) * rr, pz = z + std::sin(a) * rr;
				inst(I_PUFF, bs, px, h_at(px, pz) + 0.2 + f * 4.5, pz, cc.r, cc.g, cc.b, (float)(0.5 * k * std::sin(f * PI)), 0);
			}
			for (int i = 0; i < 90; i++) {
				const double f = std::fmod(now / (0.9 + 0.6 * hr(i, 66, end)) + hr(i, 67, end), 1.0);
				const double a = hr(i, 68, end) * TAU - now * (2.5 + hr(i, 69, end) * 2);
				const double rr = R * (0.3 + 0.8 * hr(i, 70, end));
				const Lin cc = hex_lin(SAND[(i + 1) & 3]);
				const double s = 0.06 + 0.05 * hr(i, 71, end);
				cube(I_DEBRIS, x + std::cos(a) * rr, gy + 0.2 + f * 3.0 * k, z + std::sin(a) * rr, now * 4 + i, a, i, s, s, s, cc.r, cc.g, cc.b);
			}
			if (end && age >= tp && age < tp + 0.8) { // the arrival burst
				const double f = (age - tp) / 0.8;
				decal(I_DECAL_ADD, x, gy + 0.2, z, 2 * R * (0.6 + 1.4 * f), 0, 1.8f, 1.4f, 0.7f, (float)(2.2 * (1 - f)), 4, 0.1f, 0.21f);
				glow(false, x, gy + 1.5, z, R * 2.5, R * 1.5, 1.4, 1.1, 0.6, 0.5 * (1 - f), 0);
				lit(x, gy + 3, z, 0xffd890, 18 * (1 - f), 14, 1.5);
			}
			puff(false, c.t0 + (end ? tp : 0), hmix((uint32_t)(c.t0 * 1000), end, 81), now, x, gy + 0.3, z, 50, 0xd2ae70, 0.5, 1.8, 4.5, 0.8, 0.2, 1.2, R * 0.6);
		}
	}

	// ---- Plague of Serpents / Ancestors: the glyph ring and mist round the spot ------------------------
	for (int kind = 0; kind < 2; kind++)
		for (const aov::SpawnCast &c : kind ? G.ancestors : G.serpents) {
			const double R = aov::power_def(c.id).radius;
			const double raising = kind ? 13.5 : 18.5;
			const double k = env(now, c.t0, c.t0 + raising + 2, 0.6, 2);
			if (k <= 0.01) continue;
			const double gy = h_at(c.x, c.z);
			const Lin col = hex_lin(kind ? 0x58b8ff : 0x7dff8c), deep = hex_lin(kind ? 0x2050ff : 0x10a040);
			decal(I_DECAL_ADD, c.x, gy + 0.15, c.z, 2 * R * 1.08, now * (kind ? -0.08 : 0.08), col.r, col.g, col.b, (float)(1.3 * k), 5, 0.86f, (float)(now * 0.15));
			decal(I_DECAL_ADD, c.x, gy + 0.12, c.z, 2 * R * 0.7, -now * 0.12, deep.r, deep.g, deep.b, (float)(0.6 * k), 6, 0.1f, (float)now);
			for (int i = 0; i < 36; i++) { // low mist
				const double f = std::fmod(now / (3 + 2 * hr(i, 91, kind)) + hr(i, 92, kind), 1.0);
				const double a = hr(i, 93, kind) * TAU + now * 0.1, rr = R * std::sqrt(hr(i, 94, kind));
				const double px = c.x + std::cos(a) * rr, pz = c.z + std::sin(a) * rr;
				Basis bs;
				const double s = 1.6 + 1.6 * f;
				bs.rows[0] = Vector3((real_t)s, 0, 0);
				bs.rows[1] = Vector3(0, (real_t)s, 0);
				bs.rows[2] = Vector3(0, 0, 1);
				inst(I_FLAME, bs, px, h_at(px, pz) + 0.3 + f * 0.8, pz, deep.r * 0.5f, deep.g * 0.5f, deep.b * 0.5f, (float)(0.35 * k * std::sin(f * PI)), 0);
			}
			lit(c.x, gy + 3, c.z, kind ? 0x5aa0ff : 0x60ff80, 6 * k, 14, 1.5);
		}

	// ---- rises: serpents and Minions clawing out, eggs, hatchings, the Scarab's burst ---------------
	for (const aov::RiseFx &f : G.rises) {
		const double age = now - f.t0;
		if (age < 0 || age > 4) continue;
		const double gy = h_at(f.x, f.z);
		const double k = clamp01(1 - age / 3.5);
		const uint32_t sd = hmix((uint32_t)(f.t0 * 1000), (uint32_t)f.unit, f.kind);
		switch (f.kind) {
			case 0: case 1: { // a serpent / a Minion
				const Lin col = hex_lin(f.kind ? 0x6ab4ff : 0x86ff7a);
				decal(I_DECAL_ADD, f.x, gy + 0.08, f.z, 3.2, sd % 628 / 100.0, col.r, col.g, col.b, (float)(1.6 * k), 0, (float)((sd >> 4) % 977 / 977.0));
				decal(I_DECAL_MIX, f.x, gy + 0.05, f.z, 3.0, sd % 314 / 100.0, 1, 1, 1, (float)(0.85 * k), 0, (float)((sd >> 6) % 1000 / 1000.0), 1.f);
				const double pk = clamp01(1 - age / 1.2);
				glow(false, f.x, gy + 1.8, f.z, 0.9, 4.2 * pk + 0.5, col.r, col.g, col.b, 0.9 * pk, 1);
				puff(false, f.t0, sd, now, f.x, gy + 0.3, f.z, 14, f.kind ? 0x8a8478 : 0xc9a263, 0.8, 1.4, 2.4, 1.6, 0.6, 1.8, 0.4);
				puff(true, f.t0, sd ^ 77, now, f.x, gy + 0.6, f.z, 10, f.kind ? 0x3a70ff : 0x30d050, 0.7, 1.6, 0.6, 2.0, 0.4, 1.2, 0.3);
				if (age < 0.6) lit(f.x, gy + 1.5, f.z, f.kind ? 0x4f90ff : 0x50ff70, 10 * (1 - age / 0.6), 8, 1.8);
				break;
			}
			case 2: case 3: { // the Phoenix falls into an egg / hatches
				const Lin fc = hex_lin(0xff8a2a);
				puff(true, f.t0, sd, now, f.x, gy + 1.0, f.z, 40, 0xffa040, 0.9, 1.0, 3.5, 2.5, -1, 0.8, 0.5);
				glow(false, f.x, gy + 1.5, f.z, 5, 5, fc.r, fc.g, fc.b, 0.8 * clamp01(1 - age / 1.5), 0);
				decal(I_DECAL_ADD, f.x, gy + 0.1, f.z, 3 + 4 * age, 0, fc.r, fc.g, fc.b, (float)(2 * clamp01(1 - age / 1.2)), 4, 0.1f, 0.5f);
				if (age < 1) lit(f.x, gy + 2, f.z, 0xff8030, 24 * (1 - age), 12, 1.6);
				break;
			}
			case 4: { // the Scarab's caustic burst
				const Lin gc = hex_lin(0x9cff3a);
				puff(true, f.t0, sd, now, f.x, gy + 0.5, f.z, 50, 0xa0ff40, 1.0, 1.1, 4.5, 1.5, -1.5, 1.0, 0.6);
				puff(false, f.t0, sd ^ 5, now, f.x, gy + 0.4, f.z, 24, 0x5a7a20, 1.4, 2.4, 2.0, 1.0, 0.4, 2.2, 0.8);
				decal(I_DECAL_ADD, f.x, gy + 0.1, f.z, 2 + 6 * std::min(1.0, age / 0.5), 0, gc.r, gc.g, gc.b, (float)(2 * clamp01(1 - age / 0.8)), 2, 0.6f);
				break;
			}
			case 5: { // the Son of Osiris: a pillar of gold light, a ring, a sun disc
				const Lin gc = hex_lin(0xffd060), wc = hex_lin(0xfff6d8);
				const double pk = sstep(0, 0.3, age) * clamp01(1 - (age - 1.5) / 2.0);
				glow(false, f.x, gy + 12, f.z, 2.6, 26, gc.r, gc.g, gc.b, 0.7 * pk, 0);
				glow(false, f.x, gy + 12, f.z, 0.8, 26, wc.r, wc.g, wc.b, 0.9 * pk, 1);
				glow(false, f.x, gy + 5.5, f.z, 3.4, 3.4, wc.r, wc.g, wc.b, 0.8 * pk, 2);
				decal(I_DECAL_ADD, f.x, gy + 0.2, f.z, 7, now * 0.3, gc.r, gc.g, gc.b, (float)(2.0 * pk), 5, 0.72f, (float)(now * 0.2));
				decal(I_DECAL_ADD, f.x, gy + 0.15, f.z, 4 + 22 * std::pow(std::min(1.0, age / 1.4), 0.6), 0, gc.r, gc.g, gc.b, (float)(2.2 * clamp01(1 - age / 1.4)), 4, 0.07f, 0.11f);
				for (int i = 0; i < 60; i++) {
					const double ff = std::fmod(age / (1.5 + hr(i, 101) * 1.5) + hr(i, 102), 1.0);
					const double a = hr(i, 103) * TAU + ff * 4, rr = 0.5 + 2.2 * hr(i, 104);
					const double s = 0.06 * std::sin(ff * PI) * pk;
					cube(I_EMBER, f.x + std::cos(a) * rr, gy + 0.3 + ff * 9, f.z + std::sin(a) * rr, now * 2, a, i, s * 0.4, s * 2.5, s, 3.4f, 2.6f, 1.0f);
				}
				lit(f.x, gy + 5, f.z, 0xffd070, 34 * pk, 18, 1.4);
				break;
			}
			default: break;
		}
	}

	// ---- Locust Swarm: boiling clouds of voxel locusts over a dust haze --------------------------------
	for (int si = 0; si < (int)G.swarms.size(); si++) {
		const aov::Swarm &w = G.swarms[si];
		const double age = now - w.t0;
		const double k = env(now, w.t0, w.t0 + w.dur, 0.8, 1.5);
		const double x = w.x0 + w.dx * aov::SWARM_SPEED * age, z = w.z0 + w.dz * aov::SWARM_SPEED * age;
		const double gy = h_at(x, z);
		const double R = w.radius;
		decal(I_DECAL_MUL, x, gy + 0.06, z, R * 2.6, 0, 1, 1, 1, (float)(0.55 * k), 0);
		// the haze (power_09: a dusty brown cloud)
		for (int i = 0; i < 46; i++) {
			const double a = hr(w.seed, i, 111) * TAU + now * (0.3 + 0.2 * hr(w.seed, i, 112)), rr = R * 0.75 * std::sqrt(hr(w.seed, i, 113));
			const double px = x + std::cos(a) * rr, pz = z + std::sin(a) * rr;
			Basis bs;
			const double s = 0.9 + 0.7 * hr(w.seed, i, 114) + 0.15 * std::sin(now * 1.3 + i);
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			const Lin hc = hex_lin(i % 3 ? 0x8a7656 : 0x6e604a);
			inst(I_PUFF, bs, px, h_at(px, pz) + 0.6 + 2.2 * hr(w.seed, i, 115), pz, hc.r, hc.g, hc.b, (float)(0.22 * k), 0);
		}
		// the locusts: 260 dark voxel bodies, each on its own looping path inside the cloud
		const Lin c0 = hex_lin(0x3a3424), c1 = hex_lin(0x5a5030), c2 = hex_lin(0x24201a);
		const int N = (int)(420 * k);
		for (int i = 0; i < N; i++) {
			const double fa = 0.8 + 1.8 * hr(w.seed, i, 121), fb = 0.6 + 1.5 * hr(w.seed, i, 122), fc = 1.1 + 2.2 * hr(w.seed, i, 123);
			const double pa = hr(w.seed, i, 124) * TAU, pb = hr(w.seed, i, 125) * TAU, pc = hr(w.seed, i, 126) * TAU;
			const double rr = R * (0.15 + 0.85 * std::sqrt(hr(w.seed, i, 127)));
			const double a = pa + now * fa * (i % 2 ? 1 : -1);
			const double px = x + std::cos(a) * rr + 0.6 * std::sin(now * fb + pb), pz = z + std::sin(a) * rr * 0.85 + 0.6 * std::cos(now * fb * 1.3 + pc);
			const double py = gy + 0.6 + 2.6 * hr(w.seed, i, 128) + 0.7 * std::sin(now * fc + pc);
			const double yaw = a + PI / 2 * (i % 2 ? 1 : -1);
			const double s = 0.05 + 0.035 * hr(w.seed, i, 129);
			const double flap = std::abs(std::sin(now * 38 + i));
			const Lin &c = (i % 3) == 0 ? c0 : (i % 3) == 1 ? c1 : c2;
			cube(I_DEBRIS, px, py, pz, 0.3 * std::sin(now * 5 + i), yaw, 0, s * 2.2, s * (0.6 + 0.6 * flap), s, c.r, c.g, c.b);
		}
	}

	// ---- Citadel: the cast (pillar, ring, rising stones) and the Citadel Centers' glow ------------------
	for (const aov::CitadelCast &c : G.citadel_fx) {
		const double age = now - c.t0;
		const int b = E.building_slot(c.building);
		const double half = b >= 0 ? std::max(B.w[b], B.h[b]) * 0.5 : 3.5;
		const double gy = h_at(c.x, c.z);
		const Lin gc = hex_lin(0xffc850), wc = hex_lin(0xfff2cc);
		const double pk = sstep(0, 0.25, age) * clamp01(1 - (age - 2.0) / 2.5);
		glow(false, c.x, gy + 14, c.z, half * 1.6, 30, gc.r, gc.g * 0.85f, gc.b * 0.5f, 0.8 * pk, 0);
		glow(false, c.x, gy + 14, c.z, half * 0.5, 30, wc.r, wc.g, wc.b, 0.6 * pk, 1);
		decal(I_DECAL_ADD, c.x, gy + 0.2, c.z, 2 * half + 30 * std::pow(std::min(1.0, age / 1.6), 0.6), 0, gc.r, gc.g, gc.b,
				(float)(2.4 * clamp01(1 - age / 1.6)), 4, 0.06f, 0.83f);
		decal(I_DECAL_ADD, c.x, gy + 0.18, c.z, 2 * half * 1.5, now * 0.2, gc.r, gc.g, gc.b, (float)(1.6 * pk), 5, 0.8f, (float)now);
		// sandstone blocks heaved up round the walls, settling back
		for (int i = 0; i < 48; i++) {
			const double a = hr(c.building, i, 131) * TAU;
			const double rr = half * (1.0 + 0.25 * hr(c.building, i, 132));
			const double t = age - 0.15 * hr(c.building, i, 133);
			if (t < 0) continue;
			const double up = 3.2 * std::sin(std::min(PI, t * 1.6)) * (0.5 + 0.8 * hr(c.building, i, 134));
			const double px = c.x + std::cos(a) * rr, pz = c.z + std::sin(a) * rr;
			const Lin cc = hex_lin(SAND[i & 3]);
			const double s = 0.25 + 0.25 * hr(c.building, i, 135);
			const double fade = clamp01(1 - (age - 3.5) / 1.5);
			if (fade <= 0) continue;
			cube(I_DEBRIS, px, h_at(px, pz) + up * fade - 0.2 * (1 - fade), pz, t * 2 * hr(c.building, i, 136), a, t * hr(c.building, i, 137), s, s * 0.7, s, cc.r, cc.g, cc.b);
		}
		puff(false, c.t0, hmix(c.building, 9, 141), now, c.x, gy + 0.3, c.z, 90, 0xcfae78, 0.5, 2.0, 6, 1.0, 0.3, 1.2, half);
		lit(c.x, gy + 6, c.z, 0xffcc60, 30 * pk, 22, 1.3);
	}
	for (int32_t id : G.citadels) {
		const int b = E.building_slot(id);
		if (b < 0 || B.dead[b]) continue;
		const double half = std::max(B.w[b], B.h[b]) * 0.5, gy = h_at(B.x[b], B.z[b]);
		const Lin gc = hex_lin(0xffc850);
		decal(I_DECAL_ADD, B.x[b], gy + 0.12, B.z[b], 2 * half * 1.45, now * 0.05, gc.r, gc.g, gc.b, 0.55f, 5, 0.86f, (float)(now * 0.05));
		for (int i = 0; i < 16; i++) {
			const double f = std::fmod(now / (3 + hr(id, i, 151) * 2) + hr(id, i, 152), 1.0);
			const double a = hr(id, i, 153) * TAU, rr = half * (0.8 + 0.4 * hr(id, i, 154));
			const double s = 0.05 * std::sin(f * PI);
			cube(I_EMBER, B.x[b] + std::cos(a) * rr, gy + 0.5 + f * 6, B.z[b] + std::sin(a) * rr, now, a, 0, s, s, s, 3.0f, 2.2f, 0.7f);
		}
	}

	// ---- the Son of Osiris: his gold ring, his chain lightning ----------------------------------------
	for (int u = 0; u < U.size(); u++) {
		if (U.removed[u] || U.dead[u] || U.type[u] != aov::U_SON_OF_OSIRIS) continue;
		double x, z;
		upos(u, x, z);
		const double gy = h_at(x, z);
		const Lin gc = hex_lin(0xffcf5a);
		decal(I_DECAL_ADD, x, gy + 0.12, z, 3.6, now * 0.6, gc.r, gc.g, gc.b, 1.1f, 5, 0.78f, (float)now);
		glow(true, x, gy + 1.6, z, 3.0, 3.4, gc.r, gc.g, gc.b, 0.22, 0);
	}
	{
		std::vector<Line> L;
		for (const aov::Arc &a : G.arcs) {
			const double age = now - a.t0;
			if (age < 0 || age > 0.45) continue;
			aov::RNG rng(a.seed ^ (uint32_t)std::floor(now * 20));
			const std::vector<P> pts = fractal(rng, P{ a.x0, a.y0, a.z0 }, P{ a.x1, a.y1, a.z1 }, 5, 0.18);
			const double k = std::pow(1 - age / 0.45, 1.2);
			line(L, pts, 0.07, 1.1 * k, 0.2, 0);
			line(L, pts, 0.42, 0.35 * k, 0.2, 0, true);
			const Lin gc = hex_lin(0xfff0a0);
			glow(false, a.x1, a.y1, a.z1, 1.6, 1.6, gc.r, gc.g, gc.b, 0.9 * k, 2);
		}
		if (!L.empty()) emit_lines(G_GOLD, L, 1);
		if (!G.arcs.empty()) {
			const aov::Arc &a = G.arcs.back();
			lit(a.x1, a.y1 + 1, a.z1, 0xffe080, 16 * clamp01(1 - (now - a.t0) / 0.45), 10, 1.6);
		}
	}

	// ---- Tornado: debris up its sides, a dust skirt, a sand swirl, drifts on its track ---------------------
	Array tors;
	for (size_t ti = 0; ti < G.tornadoes.size(); ti++) {
		const aov::Tornado &t = G.tornadoes[ti];
		const double age = now - t.t0;
		const double k = env(now, t.t0, t.t0 + t.dur, 1.0, 2.0);
		// its position now, between sim ticks (the closed-form spiral)
		const double sarc = aov::TORNADO_SPEED * age, aa = std::sqrt(2 * sarc / aov::TORNADO_SPIRAL), rr0 = aov::TORNADO_SPIRAL * aa;
		const double x = t.cx + std::cos(t.a0 + aa) * rr0, z = t.cz - std::sin(t.a0 + aa) * rr0;
		const double gy = h_at(x, z);
		const uint32_t seed = hmix((uint32_t)(t.t0 * 1000), (uint32_t)ti, 161);
		Dictionary td;
		td["x"] = x;
		td["z"] = z;
		td["y"] = gy;
		td["k"] = k;
		td["t0"] = t.t0;
		td["id"] = (int64_t)seed;
		tors.push_back(td);
		decal(I_DECAL_MIX, x, gy + 0.07, z, 9.5, now * 3.0, 1, 1, 1, (float)(0.9 * k), 2, (float)(now * 0.8), 1.f);
		decal(I_DECAL_MUL, x, gy + 0.06, z, 12, 0, 1, 1, 1, (float)(0.5 * k), 0);
		// whirled debris: sand clods, stones, splinters, leaves
		for (int i = 0; i < 150; i++) {
			const double per = 2.2 + 2.0 * hr(seed, i, 171), f = std::fmod(now / per + hr(seed, i, 172), 1.0);
			const double h = std::pow(f, 1.2) * 13;
			const double rad = 1.0 + 0.32 * h + 0.5 * hr(seed, i, 173);
			const double a = hr(seed, i, 174) * TAU + now * (4.2 - 0.15 * h) + f * 6;
			const double s = (i % 5 == 0 ? 0.18 : 0.08 + 0.06 * hr(seed, i, 175)) * std::min(1.0, (1 - f) * 4) * k;
			if (s <= 0.01) continue;
			const uint32_t col = i % 7 == 0 ? 0x6a5238 : i % 7 == 1 ? 0x5f8a34 : i % 7 == 2 ? 0x8a7a6a : SAND[i & 3];
			const Lin cc = hex_lin(col);
			cube(I_DEBRIS, x + std::cos(a) * rad, gy + 0.2 + h, z + std::sin(a) * rad, now * 5 + i, a, now * 3 - i, s * (i % 3 == 1 ? 2.2 : 1), s, s, cc.r, cc.g, cc.b);
		}
		// the dust skirt at its foot
		for (int i = 0; i < 110; i++) {
			const double f = std::fmod(now / (1.4 + hr(seed, i, 181)) + hr(seed, i, 182), 1.0);
			const double a = hr(seed, i, 183) * TAU + now * 3.0 + f * 2.0, rad = 1.5 + 3.5 * f;
			const double px = x + std::cos(a) * rad, pz = z + std::sin(a) * rad;
			Basis bs;
			const double s = (0.45 + 0.7 * f) * k;
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			const Lin cc = hex_lin(SAND[i & 3]);
			inst(I_PUFF, bs, px, h_at(px, pz) + 0.4 + f * 1.4, pz, cc.r * 0.9f, cc.g * 0.88f, cc.b * 0.85f, (float)(0.55 * k * (1 - f)), 0);
		}
		// sand drifts along its track (every 0.5 s of its path, fading over 25 s)
		const int steps = (int)std::floor(age / 0.5);
		for (int s = 0; s <= steps; s++) {
			const double ts = s * 0.5;
			const uint64_t key = ((uint64_t)seed << 20) ^ (uint64_t)s;
			if (std::find_if(drifts_.begin(), drifts_.end(), [&](const Drift &d) { return d.key == key; }) != drifts_.end()) continue;
			const double sa = aov::TORNADO_SPEED * ts, a2 = std::sqrt(2 * sa / aov::TORNADO_SPIRAL), r2 = aov::TORNADO_SPIRAL * a2;
			drifts_.push_back({ key, t.cx + std::cos(t.a0 + a2) * r2, t.cz - std::sin(t.a0 + a2) * r2, t.t0 + ts, hr(seed, s, 191) });
		}
		lit(x, gy + 6, z, 0xffe0b0, 3 * k, 14, 1.5);
	}
	eg["tornadoes"] = tors;
	for (const Drift &d : drifts_) {
		const double age = now - d.t0;
		const double k = clamp01(age / 0.6) * clamp01((25 - age) / 5);
		if (k <= 0) continue;
		decal(I_DECAL_MIX, d.x, h_at(d.x, d.z) + 0.04, d.z, 4.2 + 1.6 * d.v, d.v * TAU, 1, 1, 1, (float)(0.75 * k), 3, (float)d.v, 0.f);
	}
	drifts_.erase(std::remove_if(drifts_.begin(), drifts_.end(), [&](const Drift &d) { return now - d.t0 > 25 || now < d.t0 - 1; }), drifts_.end());

	// ---- Thoth's Meteor: the target circle's glyph ring (the meteors: the Greek meteor's visuals) ----------
	for (const aov::ThothCast &t : G.thoth) {
		const double k = env(now, t.t0, t.t0 + 18, 0.5, 2);
		const double gy = h_at(t.cx, t.cz);
		const Lin tc = hex_lin(0x40e0d0), oc = hex_lin(0xff9a40);
		decal(I_DECAL_ADD, t.cx, gy + 0.2, t.cz, 2 * t.radius * 1.05, now * 0.06, tc.r, tc.g, tc.b, (float)(1.1 * k), 5, 0.9f, (float)(now * 0.1));
		decal(I_DECAL_ADD, t.cx, gy + 0.22, t.cz, 2 * t.radius, 0, oc.r, oc.g, oc.b, (float)(0.9 * k), 3, 0.94f, (float)std::fmod(now, 1000.0));
	}

	// ---- abilities and afflictions -------------------------------------------------------------------------
	for (size_t i = 0; i < G.dots.size() && i < 160; i++) {
		const aov::Dot &d = G.dots[i];
		if (d.until < now) continue;
		const int row = E.unit_slot(d.target);
		if (row < 0 || U.dead[row]) continue;
		double x, z;
		upos(row, x, z);
		const double gy = h_at(x, z) + U.air_y[row], h = type_height(U.type[row]);
		const uint32_t col = d.kind == aov::DOT_CURSE ? 0x8a30ff : d.kind == aov::DOT_VENOM ? 0x7aff3a : d.kind == aov::DOT_STING ? 0xffd040 : 0x60e040;
		const Lin c = hex_lin(col);
		for (int j = 0; j < 4; j++) {
			const double f = std::fmod(now / 1.1 + hr(d.target, j, 201 + d.kind), 1.0), a = hr(d.target, j, 202) * TAU + f * 2;
			const double s = 0.05 * std::sin(f * PI);
			cube(I_EMBER, x + std::cos(a) * 0.35, gy + 0.4 + f * h, z + std::sin(a) * 0.35, now, a, 0, s, s, s, c.r * 2.5f, c.g * 2.5f, c.b * 2.5f);
		}
		if (d.kind == aov::DOT_CURSE) {
			Basis bs;
			const double s = 1.1 + 0.2 * std::sin(now * 3 + i);
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			inst(I_PUFF, bs, x, gy + h * 0.6, z, 0.06f, 0.02f, 0.1f, 0.35f, 0);
		}
	}
	for (const aov::AbilityFx &f : G.ability_fx) {
		const double age = now - f.t0;
		if (age < 0 || age > f.dur + 0.5) continue;
		const int row = E.unit_slot(f.unit);
		double ux = f.x1, uz = f.z1;
		if (row >= 0 && !U.dead[row]) upos(row, ux, uz);
		const double gy = h_at(ux, uz);
		const double k = clamp01(1 - (age - f.dur) / 0.5);
		switch (f.kind) {
			case 0: { // Anubite's leap: dust where he lands
				puff(false, f.t0 + 0.3, hmix(f.unit, 7, 211), now, f.x1, h_at(f.x1, f.z1) + 0.2, f.z1, 14, 0xb89a6a, 0.8, 1.1, 2.6, 0.8, 0.3, 1.6, 0.3);
				break;
			}
			case 1: case 2: { // the Sphinx's whirlwind / the Avenger's spin
				const bool spin = f.kind == 2;
				const double R = spin ? 2.4 : 1.5;
				decal(I_DECAL_MIX, ux, gy + 0.06, uz, R * 2.4, -now * 6, 1, 1, 1, (float)(0.7 * k), 2, (float)now, 0.f);
				std::vector<Line> L;
				for (int b = 0; b < (spin ? 2 : 3); b++) {
					std::vector<P> pts;
					const double a0 = -now * (spin ? 11 : 8) + b * TAU / (spin ? 2 : 3);
					for (int q = 0; q <= 14; q++) {
						const double a = a0 + q * 0.12;
						pts.push_back(P{ ux + std::cos(a) * R * 0.8, gy + (spin ? 1.2 : 0.6) + 0.05 * q, uz + std::sin(a) * R * 0.8 });
					}
					line(L, pts, spin ? 0.08 : 0.12, 0.9 * k, 0.9, 1);
				}
				emit_lines(spin ? G_GOLD : G_SAND, L, 1);
				if (!spin)
					for (int i = 0; i < 24; i++) {
						const double a = hr(f.unit, i, 221) * TAU - now * 7, rr = R * (0.4 + 0.7 * hr(f.unit, i, 222));
						const Lin cc = hex_lin(SAND[i & 3]);
						cube(I_DEBRIS, ux + std::cos(a) * rr, gy + 0.2 + 1.2 * hr(f.unit, i, 223), uz + std::sin(a) * rr, now * 4, a, i, 0.07, 0.07, 0.07, cc.r, cc.g, cc.b);
					}
				break;
			}
			case 3: { // the Scorpion Man's stings
				for (int s = 0; s < 3; s++) {
					const double ts = age - s * 0.5;
					if (ts < 0 || ts > 0.3) continue;
					const Lin c = hex_lin(0xffd040);
					glow(false, f.x1, h_at(f.x1, f.z1) + 1.2, f.z1, 1.2, 1.2, c.r, c.g, c.b, 1.2 * (1 - ts / 0.3), 2);
				}
				break;
			}
			case 4: { // the Mummy's curse: a dark ring and wisps where it falls
				const Lin c = hex_lin(0x9a40ff);
				const double kk = clamp01(1 - age / 1.2);
				decal(I_DECAL_ADD, f.x1, h_at(f.x1, f.z1) + 0.1, f.z1, 3.2, now, c.r, c.g, c.b, (float)(1.8 * kk), 6, 0.1f, (float)now);
				puff(false, f.t0, hmix(f.unit, f.target, 231), now, f.x1, h_at(f.x1, f.z1) + 0.5, f.z1, 18, 0x281838, 0.9, 1.6, 1.4, 1.4, 0.5, 1.8, 0.8);
				puff(true, f.t0, hmix(f.unit, f.target, 233), now, f.x1, h_at(f.x1, f.z1) + 0.6, f.z1, 10, 0x6a20d0, 0.7, 1.2, 0.8, 1.6, 0.3, 1.4, 0.6);
				break;
			}
			case 5: { // the Petsuchos' sun beam (myth_05: an orange beam, a glowing orb on the target)
				const double kk = clamp01(1 - age / 0.6);
				if (kk <= 0) break;
				const int tr = E.unit_slot(f.target);
				double tx = f.x1, tz = f.z1;
				if (tr >= 0) upos(tr, tx, tz);
				std::vector<Line> L;
				std::vector<P> pts;
				const double y0 = gy + 0.9, y1 = h_at(tx, tz) + 1.0;
				for (int q = 0; q <= 8; q++) {
					const double t = q / 8.0;
					pts.push_back(P{ ux + (tx - ux) * t, y0 + (y1 - y0) * t + 0.08 * std::sin(now * 40 + q), uz + (tz - uz) * t });
				}
				line(L, pts, 0.09, 1.2 * kk, 0, 0);
				line(L, pts, 0.38, 0.45 * kk, 0, 0, true);
				emit_lines(G_GOLD, L, 1);
				const Lin oc = hex_lin(0xffa040);
				glow(false, tx, y1, tz, 1.8, 1.8, oc.r, oc.g, oc.b, 1.0 * kk, 2);
				lit(tx, y1 + 0.5, tz, 0xff9a40, 8 * kk, 8, 1.8);
				break;
			}
			default: break;
		}
	}
}
