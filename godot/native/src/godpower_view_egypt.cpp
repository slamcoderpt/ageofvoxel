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
//   Vision          an Eye of Horus and a column of cyan light at its heart; the reveal's edge a
//                   thick band under swirling rings and streaks racing out to 42 tiles, kicking up
//                   sand; everything it passes flashes, the revealed enemy keeps a cyan rim
//   Eclipse         whole-map: the world turned to blue moonlight (egypt_fx.gd); every one of the
//                   caster's myth units lights at once with a ring pulsing out from under it, then
//                   wears a magenta ring under it, a pink glow on its head,
//                   streaks rising up it, an eclipse corona over its health bar
//   Shifting Sands  sand vortices at both ends: a sand swirl on the ground, sand spiralling
//                   up, grains whirling, a burst at the destination when the units arrive
//   Plague of Serpents  a green glyph ring round the spot over a painted vortex (a deep emerald
//                   heart paling to light green); where each serpent bursts out: a dark pit and
//                   jagged cracks glowing green, a raised ring of dark ochre sand voxels round
//                   its coils, a plume of tan dust and voxel chunks up to its head that fall
//                   back and lie round the hole, a low dust skirt (serpent_burst)
//   Locust Swarm    five living clouds, each a noise-shaped footprint: a dense swirling core of
//                   locusts in four sizes and tones (a light sand tier) thinning into stragglers,
//                   motion streaks, dust feathering out and lagging behind, a broken shadow
//   Citadel         a gold pillar of light on the Town Center, a shock ring, sandstone blocks
//                   rising round it; a gold ring and motes on every Citadel Center
//   Ancestors       a blue glyph ring and cold mist; a blue pillar, cracks and wisps where each
//                   Minion claws out
//   Son of Osiris   a pillar of gold light, a gold ring and a sun disc at the change; a gold
//                   ring under him while he lives; his chain lightning in gold
//   Tornado         (funnel: egypt_fx.gd) sand and debris whirled up its sides, a dust skirt,
//                   a sand swirl under it, sand drifts left along its spiral track
//   Thoth's Meteor  (thoth_fx) a burning rock falling on a fire trail, the blast's fireball rolling
//                   up into black smoke, a dust ring, rocks and lava thrown out; then a glowing
//                   crater that stays (sim Scorch kind 1, THOTH_CRATER_LIFE): a charred bowl in
//                   cracked, baked ground, lava in its heart and cracks, flames for 12 s, smoke,
//                   a dark lip of rocks; all under a teal glyph ring round the target circle.
//                   Its fire and lava are emissive (a negative blue: the grade keeps their orange)
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
	return !G.rocs.empty() || !G.visions.empty() || !G.sands.empty() || !G.serpents.empty() || !G.ancestors.empty() || !G.swarms.empty() ||
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
		// (linear golds leaning to yellow: AgX bleaches a saturated orange such as 0xff9a10 to salmon
		// pink on sand, and an additive gold on bright sand only lightens it; the ground is painted
		// gold, alpha-blended (decal_mix kind 4), and the light keeps g / r near 0.7)
		const Lin gold = { 1.0f, 0.66f, 0.1f }, hot = { 1.0f, 0.86f, 0.42f };
		std::vector<Line> L;
		for (size_t m = 0; m < mines.size(); m++) {
			const int r = mines[m];
			const double x = R.x[r], z = R.z[r], gy = h_at(x, z);
			const double pulse = 0.85 + 0.15 * std::sin(now * 2.2 + m);
			// the column of gold light over the mine: a soft wide shaft and a hot heart, fading up
			// to 11 tiles, with thin rays climbing it
			{
				std::vector<P> col;
				for (int j = 0; j <= 8; j++) {
					const double f = j / 8.0;
					P q{ x, gy + 1.2 + f * 10.0, z };
					q.m = (float)(std::pow(1 - f, 1.4) * (0.6 + 0.4 * std::sin(f * 9 - now * 3.0 + m) * 0.5 + 0.2));
					q.wm = (float)(1.0 - 0.35 * f);
					col.push_back(q);
				}
				L.push_back(Line{ col, 4.4, 0.34 * k * pulse, 0, 0, true, G_GILD });
				L.push_back(Line{ col, 1.8, 0.5 * k * pulse, 0, 0, true, G_GILD });
				L.push_back(Line{ col, 0.4, 0.6 * k * pulse, 0, 0, false, G_GILD });
				for (int i = 0; i < 7; i++) { // rays: a stretch of light rising up the shaft
					const double per = 1.6 + 0.8 * hr(r, i, 41), f = std::fmod(now / per + hr(r, i, 42), 1.0);
					const double an = hr(r, i, 43) * TAU, rr = 0.25 + 0.9 * hr(r, i, 44);
					const double y0 = gy + 1.0 + f * 8.0, len = 1.5 + 2.5 * hr(r, i, 45);
					std::vector<P> ray{ P{ x + std::cos(an) * rr, y0, z + std::sin(an) * rr }, P{ x + std::cos(an) * rr * 0.8, y0 + len * 0.5, z + std::sin(an) * rr * 0.8 },
						P{ x + std::cos(an) * rr * 0.6, y0 + len, z + std::sin(an) * rr * 0.6 } };
					ray[0].m = 0.3f; ray[2].m = 0.2f;
					L.push_back(Line{ ray, 0.16, 1.1 * k * std::sin(f * PI), 0.4, 0, false, G_GILD });
				}
			}
			// a warm bloom over the mine and its camp (yellow, kept below the bleach)
			glow(false, x, gy + 2.2, z, 6.5, 4.5, gold.r, gold.g, gold.b, 0.16 * k * pulse, 0);
			glow(false, x, gy + 1.9, z, 2.2, 1.4, hot.r, hot.g, hot.b, 0.2 * k * pulse, 0);
			// the ground: a painted gold glyph ring and gilt dust round the mine (alpha-blended, so it
			// reads as gold against sand), and a faint additive sheen under it
			decal(I_DECAL_MIX, x, gy + 0.1, z, 9.5, now * 0.15, 1, 1, 1, (float)(0.95 * k), 4, 0.74f, (float)(now * 0.1));
			decal(I_DECAL_ADD, x, gy + 0.08, z, 8.0, 0, gold.r, gold.g * 0.85f, gold.b, (float)(0.22 * k * pulse), 8);
			// glittering nuggets on the mine's face
			for (int i = 0; i < 26; i++) {
				const double an = hr(r, i, 51) * TAU, rr = 0.5 + 1.2 * hr(r, i, 52);
				const double tw = std::pow(0.5 + 0.5 * std::sin(now * (3 + 3 * hr(r, i, 53)) + i * 1.7), 3.0);
				const double s = 0.09 + 0.07 * hr(r, i, 54);
				cube(I_EMBER, x + std::cos(an) * rr, gy + 0.6 + 0.9 * (1 - rr / 1.7) + 0.25 * hr(r, i, 55), z + std::sin(an) * rr, an, i, 0.3, s, s, s,
						(float)(k * (0.36 + 0.9 * tw)), (float)(k * (0.16 + 0.55 * tw)), (float)(k * (0.0 + 0.12 * tw)));
			}
			// gold motes spiralling up the column
			for (int i = 0; i < 48; i++) {
				const double per = 2.4 + hr(r, i, 31) * 1.6, ph = now / per + hr(r, i, 32);
				const double f = ph - std::floor(ph);
				const double a = hr(r, i, 33) * TAU + f * 3.2, rr = 0.5 + 1.8 * hr(r, i, 34) * (1 - 0.5 * f);
				const double s = (0.1 + 0.08 * hr(r, i, 35)) * std::sin(f * PI);
				const double b2 = 0.75 + 0.35 * std::sin(now * 9 + i);
				cube(I_EMBER, x + std::cos(a) * rr, gy + 0.4 + f * 8.0, z + std::sin(a) * rr, now * 3 + i, a, i, s, s, s,
						(float)((i % 3 ? 0.46 : 1.1) * k * b2), (float)((i % 3 ? 0.235 : 0.72) * k * b2), (float)((i % 3 ? 0.004 : 0.12) * k * b2));
			}
			if (m == 0) {
				lit(x, gy + 3.5, z, 0xffc030, 14 * k * pulse, 14, 1.3);
				// and the drop site his miners carry it to (the Mining Camp in power_03) lit gold
				int best = -1;
				double bd = 1e9;
				for (int b = 0; b < B.size(); b++) {
					if (B.removed[b] || B.dead[b] || B.owner[b] != o) continue;
					if (!(B.type[b] == aov::B_MINING_CAMP || B.type[b] == aov::B_TOWN_CENTER || B.type[b] == aov::B_STOREHOUSE)) continue;
					const double d = std::hypot(B.x[b] - x, B.z[b] - z);
					if (d < bd) { bd = d; best = b; }
				}
				if (best >= 0 && bd < 14) {
					const double bx = B.x[best], bz = B.z[best], by = h_at(bx, bz);
					lit(bx, by + 3.2, bz, 0xffc030, 10 * k * pulse, 8, 1.4);
					glow(false, bx, by + 2.6, bz, 3.4, 2.4, gold.r, gold.g, gold.b, 0.14 * k * pulse, 0);
				}
			}
		}
		if (!L.empty()) emit_lines(G_GILD, L, 1);
		// glints over his miners
		int ng = 0;
		for (int u = 0; u < U.size() && ng < 40; u++) {
			if (U.removed[u] || U.dead[u] || U.owner[u] != o || U.carry_type[u] != aov::RES_GOLD || U.carry_amount[u] <= 0) continue;
			ng++;
			double x, z;
			upos(u, x, z);
			const double tw = 0.5 + 0.5 * std::sin(now * 7 + u);
			const double s = 0.08 + 0.05 * tw;
			cube(I_EMBER, x, h_at(x, z) + 2.5 + 0.15 * std::sin(now * 3 + u), z, now * 2, u, 0.6, s, s, s, (float)(0.38 + 0.6 * tw), (float)(0.17 + 0.4 * tw), (float)(0.0 + 0.06 * tw));
		}
		// the cast: a gold ring racing out from his Town Center
		const double age = now - t.t0;
		const int tc = E.building_slot(S.civs.home_tc[o]);
		if (age < 2.5 && tc >= 0) {
			const double f = age / 2.5;
			decal(I_DECAL_ADD, B.x[tc], h_at(B.x[tc], B.z[tc]) + 0.15, B.z[tc], 6 + 40 * std::pow(f, 0.7), 0, gold.r, gold.g, gold.b,
					(float)(1.3 * (1 - f)), 4, 0.06f, 0.37f);
		}
	}

	// ---- Vision: an Eye and a column of light at the heart, a thick swirling front, the revealed lit -----
	// (round 18) The cast reads from its heart out: the Eye of Horus burnt into the ground under a
	// glyph ring and a column of cyan light with two strands winding up it; the reveal's edge is a
	// thick saturated band on the ground under a curtain of swirling rings and vertical streaks
	// (power_04's white swirl rings), kicking up sand and grit while it races out (10 m + 15 m/s);
	// every unit and building it passes flashes (a rim, a light shaft, a ring and a puff of dust) and
	// the enemy it reveals keeps a faint cyan rim for the 20 s. The caster's rings and streaks are in
	// G_VISION, drawn over the fog of war (fog_view.gd draws at RENDER_PRIORITY_MAX - 1).
	for (const aov::VisionCast &v : G.visions) {
		const double age = now - v.t0, k = env(now, v.t0, v.t0 + v.dur, 0.3, 1.5);
		if (k <= 0.005) continue;
		const double gy = h_at(v.x, v.z);
		const Lin wc = hex_lin(0xeef9ff), cy = hex_lin(0x22b8ff), cd = hex_lin(0x1070ff);
		const double R = std::max(0.5, v.r);
		const double Rmax = aov::power_def(aov::GP_VISION).radius;
		const double grow = 1 - sstep(Rmax - 3, Rmax, R);      // 1 while the front races out
		const double fk = 0.55 + 0.45 * grow;                   // the front's strength
		const double burst = std::exp(-age * 1.1);              // the cast's flash, fading
		const Group vg = v.owner == 1 ? G_VISION : G_BAND2;
		const uint32_t vs = hmix((uint32_t)(v.x * 64), (uint32_t)(v.z * 64), (uint32_t)(v.t0 * 30));
		std::vector<Line> L;

		// -- the heart: the Eye, a glyph ring, the cast's shock ring, a column of light
		decal(I_DECAL_ADD, v.x, gy + 0.3, v.z, 14, 0, cy.r * 1.6f, cy.g * 1.6f, cy.b * 1.6f, (float)((2.0 + 2.0 * burst) * k), 7);
		decal(I_DECAL_ADD, v.x, gy + 0.26, v.z, 17, now * 0.25, cy.r, cy.g, cy.b, (float)((1.3 + 1.2 * burst) * k), 5, 0.78f, (float)(now * 0.3));
		if (age < 1.3)
			decal(I_DECAL_ADD, v.x, gy + 0.2, v.z, 4 + 26 * std::pow(age / 1.3, 0.6), 0, wc.r, wc.g, wc.b, (float)(2.6 * (1 - age / 1.3)), 4, 0.08f, 0.31f);
		const double col = (0.95 + 1.3 * burst) * k;
		glow(false, v.x, gy + 13, v.z, 4.2, 28, cd.r, cd.g, cd.b, 0.6 * col, 0);
		glow(false, v.x, gy + 13, v.z, 2.0, 28, cy.r, cy.g, cy.b, 1.0 * col, 0);
		glow(false, v.x, gy + 13, v.z, 0.7, 28, wc.r, wc.g, wc.b, 1.4 * col, 1);
		glow(false, v.x, gy + 1.2, v.z, 5, 4, wc.r, wc.g, wc.b, 0.7 * col, 2);
		{ // the shaft itself: a straight beam of light out of the Eye
			std::vector<P> pts;
			for (int q = 0; q <= 12; q++) {
				const double f = q / 12.0;
				P p{ v.x, gy + 0.2 + f * 24, v.z };
				p.m = (float)(1 - 0.85 * f);
				p.wm = (float)(1 - 0.5 * f);
				pts.push_back(p);
			}
			line(L, pts, 0.45, 1.3 * col, 0, 0);
			line(L, pts, 2.2, 0.55 * col, 0, 0, true);
		}
		for (int s = 0; s < 2; s++) { // two strands winding up the column
			std::vector<P> pts;
			const int n = 40;
			for (int q = 0; q <= n; q++) {
				const double f = (double)q / n, a = s * PI + f * 9 + now * 2.4, rr = 1.5 - 0.8 * f;
				P p{ v.x + std::cos(a) * rr, gy + 0.3 + f * 18, v.z + std::sin(a) * rr };
				p.m = (float)(std::sin(PI * std::min(1.0, f * 1.15)) * (0.6 + 0.4 * std::sin(f * 20 - now * 8)));
				pts.push_back(p);
			}
			line(L, pts, 0.2, 0.9 * col, 0.6, 0.2);
			line(L, pts, 0.6, 0.35 * col, 0.6, 0.2, true);
		}
		for (int i = 0; i < 70; i++) { // motes rising in the column
			const double f = std::fmod(now / (1.6 + hr(i, 61)) + hr(i, 62), 1.0), a = hr(i, 63) * TAU + f * 5;
			const double rr = 0.4 + 2.0 * hr(i, 64) * (1 - 0.6 * f), s = 0.07 * std::sin(f * PI) * k;
			cube(I_EMBER, v.x + std::cos(a) * rr, gy + 0.3 + f * 16, v.z + std::sin(a) * rr, now * 2, a, i, s * 0.5, s * 2.2, s * 0.5, 0.9f, 2.6f, 3.4f);
		}
		lit(v.x, gy + 4, v.z, 0x70d8ff, (14 + 30 * burst) * k, 22, 1.3);

		// -- the front: a thick saturated band on the ground, a crisp white edge, swirl inside
		{
			const double S = 2 * R / 0.86, wb = std::min(0.3, 2.8 / (S * 0.5));
			decal(I_DECAL_ADD, v.x, gy + 0.25, v.z, S, -now * 0.2, cy.r, cy.g, cy.b, (float)(3.2 * fk * k), 4, (float)wb, 0.53f);
			decal(I_DECAL_ADD, v.x, gy + 0.24, v.z, 2 * R * 1.01, 0, wc.r, wc.g, wc.b, (float)(1.8 * fk * k), 2, (float)std::max(0.9, 1 - 1.2 / R));
			decal(I_DECAL_ADD, v.x, gy + 0.18, v.z, 2 * R, now * 0.22, cy.r, cy.g, cy.b, (float)(0.3 * k), 6, 0.86f, (float)(now * 0.3 + 3));
		}
		// swirling rings at three heights, broken into turning arcs (power_04)
		for (int j = 0; j < 3; j++) {
			const double hgt = (0.5 + 1.5 * j) * (0.7 + 0.5 * grow), sp = (j % 2 ? -0.55 : 0.4) * (1 + grow);
			for (int a2 = 0; a2 < 3; a2++) {
				const double span = (0.45 + 0.3 * hr(vs, j * 3 + a2, 71)) * PI;
				const double a0 = hr(vs, j * 3 + a2, 72) * TAU + now * sp;
				const int n = std::max(16, (int)(R * span / 0.9));
				std::vector<P> pts;
				for (int q = 0; q <= n; q++) {
					const double f = (double)q / n, a = a0 + span * f;
					const double rr = R * (1.0 + 0.012 * std::sin(a * 5 + now * 3 + j)) - 0.35 * j;
					P p{ v.x + std::cos(a) * rr, gy + hgt + 0.35 * std::sin(a * 3 + now * 2.2 + j * 2), v.z + std::sin(a) * rr };
					const double e = std::sin(PI * f);
					p.m = (float)(e * (0.65 + 0.35 * std::sin(a * 7 - now * 5)));
					p.wm = (float)(0.5 + 0.5 * e);
					pts.push_back(p);
				}
				const double ii = (j == 0 ? 1.1 : j == 1 ? 0.85 : 0.6) * fk * k;
				line(L, pts, 0.32, ii, 0, 0);
				line(L, pts, 1.3, 0.4 * ii, 0, 0, true);
			}
		}
		// vertical streaks standing on the edge, flickering in and out
		const int NS = (int)std::min(120.0, 20 + R * 2.4);
		for (int i = 0; i < NS; i++) {
			const double per = 0.9 + 0.8 * hr(vs, i, 81), f = std::fmod(now / per + hr(vs, i, 82), 1.0);
			const double a = hr(vs, i, 83) * TAU + now * 0.3 * (i % 2 ? 1 : -1);
			const double rr = R * (0.985 + 0.02 * hr(vs, i, 84));
			const double hh = (2.0 + 4.5 * hr(vs, i, 85)) * (0.6 + 0.6 * grow) * (0.4 + 0.6 * std::sin(f * PI));
			const double px = v.x + std::cos(a) * rr, pz = v.z + std::sin(a) * rr, g0 = h_at(px, pz);
			std::vector<P> pts;
			for (int q = 0; q <= 5; q++) {
				const double ff = q / 5.0;
				P p{ px + std::cos(a + PI / 2) * 0.4 * ff, g0 + 0.2 + hh * ff, pz + std::sin(a + PI / 2) * 0.4 * ff };
				p.m = (float)(1 - ff);
				pts.push_back(p);
			}
			const double ii = std::sin(f * PI) * fk * k;
			line(L, pts, 0.14, 0.9 * ii, 0.5, 0);
			line(L, pts, 0.5, 0.3 * ii, 0.5, 0, true);
		}
		// sand and grit thrown up at the leading edge while it races out
		if (grow > 0.01) {
			for (int i = 0; i < 120; i++) {
				const double per = 0.3 + 0.2 * hr(vs, i, 91), f = std::fmod(now / per + hr(vs, i, 92), 1.0);
				const double tb = age - f * per;
				if (tb < 0) continue;
				const double rb = std::min(Rmax, aov::VISION_R0 + aov::VISION_GROW * tb);
				const double a = hr(vs, i, 93) * TAU, rr = rb - 0.8 + 1.4 * f;
				const double px = v.x + std::cos(a) * rr, pz = v.z + std::sin(a) * rr;
				Basis bs;
				const double s = (0.8 + 1.2 * f) * (0.8 + 0.4 * hr(vs, i, 94));
				bs.rows[0] = Vector3((real_t)s, 0, 0);
				bs.rows[1] = Vector3(0, (real_t)(s * 0.8), 0);
				bs.rows[2] = Vector3(0, 0, 1);
				const Lin dc = hex_lin(i % 3 ? 0x9a7648 : 0x7e6040);
				inst(I_PUFF, bs, px, h_at(px, pz) + 0.3 + 1.4 * f, pz, dc.r, dc.g, dc.b, (float)(0.22 * std::sin(f * PI) * grow * k), (float)hr(vs, i, 95), 1);
			}
			for (int i = 0; i < 180; i++) {
				const double per = 0.6 + 0.3 * hr(vs, i, 101), f = std::fmod(now / per + hr(vs, i, 102), 1.0);
				const double t = f * per, tb = age - t;
				if (tb < 0) continue;
				const double rb = std::min(Rmax, aov::VISION_R0 + aov::VISION_GROW * tb);
				const double a = hr(vs, i, 103) * TAU, rr = rb + (2.5 + 3 * hr(vs, i, 104)) * t;
				const double y = (4 + 4 * hr(vs, i, 105)) * t - 9.8 * t * t;
				if (y < -0.2) continue;
				const double px = v.x + std::cos(a) * rr, pz = v.z + std::sin(a) * rr;
				const double s = 0.09 + 0.09 * hr(vs, i, 106);
				const Lin dc = hex_lin(SAND[i & 3]);
				cube(I_DEBRIS, px, h_at(px, pz) + 0.2 + std::max(0.0, y), pz, t * 9, a, t * 7, s, s, s, dc.r, dc.g, dc.b);
			}
		}

		// -- every unit and building the front passes flashes; the enemy it reveals keeps a rim
		int nf = 0;
		double best = 0, bx = 0, by = 0, bz = 0;
		auto mark = [&](double x, double z, double h, double wdt, bool enemy, uint32_t id) {
			const double d = std::hypot(x - v.x, z - v.z);
			if (d > R + 0.5) return;
			const double tp = std::max(0.0, (d - aov::VISION_R0) / aov::VISION_GROW), dt = age - tp;
			if (dt < 0) return;
			const double fl = std::exp(-dt * 1.7) * k, rim = (enemy ? 0.45 : 0.0) * k;
			const double o = fl + rim;
			if (o < 0.02) return;
			const double g0 = h_at(x, z);
			double dx = x - cam.x, dz = z - cam.z;
			const double dl = std::max(1e-6, std::hypot(dx, dz));
			dx = dx / dl * 0.5;
			dz = dz / dl * 0.5;
			glow(true, x + dx, g0 + h * 0.5, z + dz, wdt * 1.5 + 0.9, h * 1.6, cy.r, cy.g, cy.b, 0.9 * o, 0);
			if (fl > 0.02) {
				glow(false, x, g0 + h * 0.5, z, wdt * 0.9 + 0.5, h * 1.1, wc.r, wc.g, wc.b, 0.5 * fl, 0);
				glow(false, x, g0 + h + 3, z, 0.4, 7, wc.r, wc.g, wc.b, 0.7 * fl, 1);
				decal(I_DECAL_ADD, x, g0 + 0.15, z, wdt * 1.3 + 1 + 3 * (1 - std::exp(-dt * 3)), 0, cy.r, cy.g, cy.b, (float)(2.2 * fl), 2, 0.7f);
				if (nf < 90) {
					nf++;
					puff(false, v.t0 + tp, hmix(vs, id, 111), now, x, g0 + 0.2, z, 5 + (int)wdt, 0xcfae78, 0.5 + 0.15 * wdt, 1.4, 2.6, 0.9, 0.3, 1.3, 0.3 + 0.3 * wdt, 1);
				}
				if (fl > best) { best = fl; bx = x; by = g0 + h; bz = z; }
			}
			if (enemy && rim > 0.02)
				decal(I_DECAL_ADD, x, g0 + 0.12, z, wdt * 1.2 + 1.2, 0, cy.r, cy.g, cy.b, (float)(0.9 * rim), 2, 0.75f);
		};
		for (int u = 0; u < U.size(); u++) {
			if (U.removed[u] || U.dead[u]) continue;
			double x, z;
			upos(u, x, z);
			mark(x, z, type_height(U.type[u]), 0.5, U.owner[u] != v.owner && U.owner[u] != 0, (uint32_t)u);
		}
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b]) continue;
			const double w = std::max(B.w[b], B.h[b]);
			mark(B.x[b], B.z[b], 1.5 + w * 0.7, w * 0.5, B.owner[b] != v.owner && B.owner[b] != 0, 0x10000u + (uint32_t)b);
		}
		if (best > 0.05) lit(bx, by + 1, bz, 0xa8ecff, 26 * best, 14, 1.5);
		if (!L.empty()) emit_lines(vg, L, 1);
	}

	// ---- Eclipse: a whole-map power: the light itself is the sign, then every empowered myth unit ----
	// (round 20) Retold's Eclipse is whole-map, so nothing local marks a centre: the frame turns to
	// blue moonlight everywhere (egypt_fx.gd / egypt_grade*.gdshader, eased in over 2.5 s) and, as the
	// light goes, every one of the caster's myth units across the map lights at once (a small hashed
	// stagger, 0..0.4 s): one moonlit ring pulsing out from under it. It then wears, for the whole
	// 55 s, the empowered side's marker: a magenta ring under it, a soft pink glow on its head
	// (power_05), a few magenta streaks rising up its body (all one way: up, a buff) and a magenta
	// eclipse corona (a ring with eight rays) over its health bar. Nothing is drawn on the enemy.
	// (The sim's TimedPower x / z, the caster's densest myth group, is kept for the capture framing.)
	double ecl_k = 0;
	if (G.eclipse.until > now - 3) {
		ecl_k = clamp01((now - G.eclipse.t0) / 2.5) * clamp01((G.eclipse.until + 3 - now) / 3.0);
		const double end_k = clamp01((G.eclipse.until + 3 - now) / 3.0);
		const int o = G.eclipse.owner;
		const double age = now - G.eclipse.t0;
		const Lin mg = hex_lin(0xff28c8), pk = hex_lin(0xff6ad8);
		// the empowered: every myth unit of the caster
		std::vector<Line> L;
		int n = 0;
		for (int u = 0; u < U.size() && n < 120; u++) {
			if (U.removed[u] || U.dead[u] || U.owner[u] != o || aov::unit_def(U.type[u]).cls != aov::CLS_MYTH) continue;
			n++;
			double x, z;
			upos(u, x, z);
			const double h = type_height(U.type[u]), g0 = h_at(x, z), gy = g0 + U.air_y[u];
			// lit all at once across the map as the light goes (a small hashed stagger)
			const double ton = 0.6 + 0.4 * hr(u, 0, 50);
			const double kk = sstep(ton, ton + 0.25, age) * end_k;
			if (kk <= 0.005) continue;
			const double fl = age > ton && age < ton + 0.7 ? 1 - (age - ton) / 0.7 : 0;
			// the moonlit ring pulsing out from under it as it lights
			const double pa = age - ton;
			if (pa >= 0 && pa < 1.4) {
				const double pr = 1.3 + pa * 2.2, pf = 1 - pa / 1.4;
				decal(I_DECAL_ADD, x, g0 + 0.12, z, 2 * pr, 0, mg.r, mg.g, mg.b, (float)(1.6 * pf * pf * end_k), 2, (float)std::max(0.0, 1 - 0.5 / pr));
			}
			// the ring under it (hard edge, bright rim, faint fill)
			decal(I_DECAL_ADD, x, g0 + 0.13, z, 2.6, now * 0.5 + u, mg.r, mg.g, mg.b, (float)(0.8 * kk + 1.2 * fl), 10, 0.04f, (float)now);
			// the soft pink glow on its head (power_05), kept small: a tint, not a flare
			const double p = 0.85 + 0.15 * std::sin(now * 3 + u);
			glow(true, x, gy + h * 0.78, z, h * 0.75, h * 0.75, pk.r, pk.g, pk.b, (0.22 * p + 0.5 * fl) * kk, 0);
			// streaks rising up its body, all upward
			for (int i = 0; i < 4; i++) {
				const double ph = std::fmod(now / 1.1 + hr(u, i, 51), 1.0), a = hr(u, i, 52) * TAU;
				const double rr = 0.55 + 0.2 * hr(u, i, 53);
				const double y0 = gy + 0.1 + ph * h * 1.05, len = 0.35 + 0.25 * hr(u, i, 54);
				const double px = x + std::cos(a) * rr, pz = z + std::sin(a) * rr;
				line(L, { P{ px, y0, pz }, P{ px, y0 + len, pz } }, 0.05, 1.3 * kk * std::sin(ph * PI), 0.8, 0.9);
			}
			// the eclipse corona over its health bar: a ring and eight short rays facing the camera
			const double cyh = gy + h + 1.05;
			double dx = x - cam.x, dy = cyh - cam.y, dz = z - cam.z;
			const double dl = std::max(1e-6, std::sqrt(dx * dx + dy * dy + dz * dz));
			dx /= dl; dy /= dl; dz /= dl;
			// right = d x up(0,1,0) = (-dz, 0, dx); up' = right x d
			double rx = -dz, rz = dx;
			const double rl = std::max(1e-6, std::hypot(rx, rz));
			rx /= rl; rz /= rl;
			const double ux = -rz * dy, uy = rz * dx - rx * dz, uz2 = rx * dy;
			const double cr = 0.26 * (1 + 0.6 * fl);
			std::vector<P> ring;
			for (int q = 0; q <= 20; q++) {
				const double a = q * TAU / 20;
				ring.push_back(P{ x + (rx * std::cos(a) + ux * std::sin(a)) * cr, cyh + uy * std::sin(a) * cr, z + (rz * std::cos(a) + uz2 * std::sin(a)) * cr });
			}
			line(L, ring, 0.07, 1.6 * kk, 0, 0);
			for (int q = 0; q < 8; q++) {
				const double a = q * TAU / 8 + now * 0.6;
				const double c0 = std::cos(a), s0 = std::sin(a), r0 = cr * 1.35, r1 = cr * (q & 1 ? 1.75 : 2.05);
				line(L, { P{ x + (rx * c0 + ux * s0) * r0, cyh + uy * s0 * r0, z + (rz * c0 + uz2 * s0) * r0 },
								P{ x + (rx * c0 + ux * s0) * r1, cyh + uy * s0 * r1, z + (rz * c0 + uz2 * s0) * r1 } },
						0.05, 1.3 * kk, 0.7, 0.6);
			}
		}
		if (!L.empty()) emit_lines(G_ECLIPSE, L, 1);
		for (int b = 0; b < B.size(); b++) {
			if (B.removed[b] || B.dead[b] || B.owner[b] != o || !aov::is_monument(B.type[b])) continue;
			const double gy = h_at(B.x[b], B.z[b]);
			decal(I_DECAL_ADD, B.x[b], gy + 0.13, B.z[b], 4.2, now * 0.3 + b, mg.r, mg.g, mg.b, (float)(0.45 * ecl_k), 10, 0.03f, (float)now);
			glow(false, B.x[b], gy + 2.5, B.z[b], 2.2, 4, pk.r, pk.g, pk.b, 0.2 * ecl_k, 0);
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
			if (kind) decal(I_DECAL_ADD, c.x, gy + 0.12, c.z, 2 * R * 0.7, -now * 0.12, deep.r, deep.g, deep.b, (float)(0.6 * k), 6, 0.1f, (float)now);
			else // the serpents' vortex: a deep emerald heart paling to light green, painted (decal_mix kind 7)
				decal(I_DECAL_MIX, c.x, gy + 0.04, c.z, 2 * R * 0.98, -now * 0.12, 1, 1, 1, (float)(0.95 * k), 7, (float)now);
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

	// ---- a serpent bursting out of the sand (Plague of Serpents, each rise) ---------------------------
	// The ground breaks where it comes up and stays broken while the brood guards the spot
	// (SERPENT_MARK_LIFE): a dark pit, churned dark ochre sand and jagged cracks racing out
	// (decal_mix kind 6) glowing green for the first seconds (decal_add kind 11); a raised ring of
	// displaced sand voxels heaped round its coils (two to three voxels high, darker ochre,
	// thrown up in the first 0.3 s); a thick plume of tan dust and voxel chunks flung up to the
	// height of its head, falling back round the hole and lying there; a low dust skirt drifting
	// for a few seconds. Nothing tall and glowing over the serpent itself: its head stays clear.
	auto serpent_burst = [&](double x, double z, double gy, double age, uint32_t sd, double now, int &) {
		const double fade = clamp01((aov::SERPENT_MARK_LIFE - age) / 4.0);   // the mark settles away
		const double grow = sstep(0, 0.5, age);
		const double rot = sd % 628 / 100.0;
		double cdx = cam.x - x, cdz = cam.z - z;
		const double cl = std::max(1e-6, std::hypot(cdx, cdz));
		cdx /= cl; cdz /= cl;
		auto smoothstep_ = [](double e0, double e1, double v) { return sstep(e0, e1, v); };
		// the broken ground, and its glow while the god's power is in it. (The quad is yawed so its
		// +x points away from the camera: the pit's far wall, which faces the eye, is the lit one;
		// the seed alone varies the cracks.)
		const double yaw = std::atan2(cdz, -cdx);
		decal(I_DECAL_MIX, x, gy + 0.05, z, 6.2, yaw, 1, 1, 1, (float)fade, 6, (float)((sd >> 5) % 997 / 997.0), (float)grow);
		const double gk = clamp01(1 - age / 4.0) * 0.95 + 0.05 * fade;   // (an old hole's cracks go dark)
		const Lin gc = hex_lin(0x5cff6a);
		decal(I_DECAL_ADD, x, gy + 0.07, z, 6.2, yaw, gc.r, gc.g, gc.b, (float)(1.3 * gk * (0.85 + 0.15 * std::sin(now * 5 + sd % 7))), 11,
				(float)((sd >> 5) % 997 / 997.0), (float)grow);
		// the raised ring of displaced sand: voxels heaped round the hole, highest on its crest
		static const uint32_t OCHRE[5] = { 0x7c5226, 0x6a431c, 0x8a5c2a, 0x5a3816, 0x94683a };
		const double pop = sstep(0.0, 0.3, age), sink = 1 - fade;
		const int NA = 26;
		for (int j = 0; j < NA; j++) {
			const double a0 = (j + 0.5) / NA * TAU + rot;
			for (int ring = 0; ring < 3; ring++) {
				// inner slope, crest, outer skirt
				const double rr = (ring == 0 ? 0.8 : ring == 1 ? 1.04 : 1.3) + 0.1 * (hr(sd, j * 3 + ring, 201) - 0.5);
				const int layers = ring == 1 ? 2 + (hr(sd, j, 202) > 0.45) : ring == 0 ? 1 + (hr(sd, j, 203) > 0.4) : 1;
				const double aj = a0 + (ring == 1 ? 0 : 0.5 / NA * TAU) + 0.08 * (hr(sd, j * 3 + ring, 204) - 0.5);
				for (int l = 0; l < layers; l++) {
					const double s = (0.21 - 0.025 * l) * (0.9 + 0.2 * hr(sd, j * 9 + ring * 3 + l, 205));
					const double px = x + std::cos(aj) * rr, pz = z + std::sin(aj) * rr;
					const double py = gy + s * 0.5 + l * s * 0.92 - (1 - pop) * (l + 1) * s - sink * (l + 1.2) * s;
					if (py + s * 0.5 < gy) continue;
					const Lin oc = hex_lin(OCHRE[(j + ring * 2 + l) % 5]);
					const float sh = (float)(l == layers - 1 ? 1.0 : 0.8); // the crest's top caught by the sun
					cube(I_DEBRIS, px, py, pz, 0.12 * (hr(sd, j, 206 + l) - 0.5), aj + 0.3 * hr(sd, j, 208 + ring), 0.12 * (hr(sd, j, 210 + l) - 0.5),
							s, s, s, oc.r * sh, oc.g * sh, oc.b * sh);
				}
			}
		}
		// voxel chunks flung up to the serpent's head, falling back and lying round the hole
		static const uint32_t CHUNK[4] = { 0xb08a50, 0x8e683a, 0x6e4a24, 0xc49c62 };
		for (int i = 0; i < 44; i++) {
			// (the chunks flung towards the camera fly lower: none hangs in front of the serpent's face)
			const double a = hr(sd, i, 141) * TAU, sp = 0.5 + 1.9 * hr(sd, i, 142);
			const double vy = (4.2 + 2.8 * hr(sd, i, 143)) * (1 - 0.42 * std::max(0.0, std::cos(a) * cdx + std::sin(a) * cdz));
			const double g = 8.5, tl = 2 * vy / g;               // its flight time
			const double s = (0.07 + 0.13 * hr(sd, i, 144)) * (age < tl ? 1 : fade * clamp01(1 - (age - tl - 4) / 2.0));
			if (s <= 0.01) continue;
			const double ta = std::min(age, tl);
			const double rr = 0.35 + sp * ta;
			const double yy = age < tl ? gy + 0.2 + vy * ta - 0.5 * g * ta * ta : gy + s * 0.5;
			const double spin = age < tl ? age * (6 + 4 * hr(sd, i, 145)) : tl * 6;
			const Lin cc = hex_lin(CHUNK[i & 3]);
			cube(I_DEBRIS, x + std::cos(a) * rr, std::max(yy, gy + s * 0.5), z + std::sin(a) * rr, spin + i, a, spin * 0.7, s, s, s, cc.r, cc.g, cc.b);
		}
		// the plume: thick tan dust boiling up round the hole to the head's height (a hollow
		// column: the dust rises round the coils, not over the face)
		for (int i = 0; i < 40; i++) {
			const double L = 2.2 + 1.4 * hr(sd, i, 151), del = 0.25 * hr(sd, i, 152);
			const double t = age - del;
			if (t < 0 || t > L) continue;
			const double u = t / L;
			const double a = hr(sd, i, 153) * TAU + u * 0.8;
			const double rr = 0.75 + 0.55 * hr(sd, i, 154) + 0.9 * u;
			const double top = 1.4 + 1.5 * hr(sd, i, 155);
			const double yy = gy + 0.3 + top * (1 - std::exp(-t * 2.2));
			const double sz = (0.55 + 0.5 * hr(sd, i, 156)) * (0.7 + 1.3 * u);
			// (thinned on the camera's side above the coils, so the serpent's head is not veiled)
			const double front = std::max(0.0, std::cos(a) * cdx + std::sin(a) * cdz) * smoothstep_(1.0, 1.8, yy - gy);
			const double al = std::min(1.0, (1 - u) * 1.8) * 0.85 * std::min(1.0, t / 0.12) * (1 - 0.8 * front);
			const Lin dc = hex_lin(i % 3 ? 0xc8a46c : 0xa88654);
			Basis bs;
			bs.rows[0] = Vector3((real_t)(sz * 0.55), 0, 0);
			bs.rows[1] = Vector3(0, (real_t)(sz * 0.55), 0);
			bs.rows[2] = Vector3(0, 0, 1);
			inst(I_PUFF, bs, x + std::cos(a) * rr, yy, z + std::sin(a) * rr, dc.r, dc.g, dc.b, (float)al, (float)((sd ^ (uint32_t)i) % 997) / 997.f, 1.f);
		}
		// a burst of sand rolling out low along the ground
		puff(false, now - age, sd ^ 0x5bd1e995u, now, x, gy + 0.25, z, 22, 0xb8925a, 1.1, 2.6, 3.4, 0.35, 0.0, 1.8, 0.5, 1.f);
		// the dust skirt, drifting round the heap for a while after
		const double sk = clamp01((age - 0.8) / 1.0) * clamp01((9 - age) / 3.0);
		if (sk > 0)
			for (int i = 0; i < 12; i++) {
				const double per = 2.6 + hr(sd, i, 161), ph = std::fmod(now / per + hr(sd, i, 162), 1.0);
				const double a = hr(sd, i, 163) * TAU + now * 0.15, rr = 1.0 + 0.8 * hr(sd, i, 164) + 0.4 * ph;
				const double sz = 0.8 + 0.6 * ph;
				Basis bs;
				bs.rows[0] = Vector3((real_t)(sz * 0.55), 0, 0);
				bs.rows[1] = Vector3(0, (real_t)(sz * 0.55), 0);
				bs.rows[2] = Vector3(0, 0, 1);
				const Lin dc = hex_lin(0xc4a068);
				inst(I_PUFF, bs, x + std::cos(a) * rr, gy + 0.25 + 0.5 * ph, z + std::sin(a) * rr, dc.r, dc.g, dc.b, (float)(0.4 * sk * std::sin(ph * PI)),
						(float)((sd ^ (uint32_t)(i + 77)) % 997) / 997.f, 1.f);
			}
		// a low green flash in the hole (kept under the coils: the head stays clear)
		const double pk = clamp01(1 - age / 1.0);
		glow(false, x, gy + 0.35, z, 2.2, 0.9 * pk + 0.2, gc.r, gc.g, gc.b, 0.8 * pk, 1);
		if (age < 0.6) lit(x, gy + 1.5, z, 0x50ff70, 10 * (1 - age / 0.6), 8, 1.8);
	};

	// ---- rises: serpents and Minions clawing out, eggs, hatchings, the Scarab's burst ---------------
	for (const aov::RiseFx &f : G.rises) {
		const double age = now - f.t0;
		if (age < 0 || age > (f.kind == 0 ? aov::SERPENT_MARK_LIFE : 4)) continue;
		const double gy = h_at(f.x, f.z);
		const double k = clamp01(1 - age / 3.5);
		const uint32_t sd = hmix((uint32_t)(f.t0 * 1000), (uint32_t)f.unit, f.kind);
		switch (f.kind) {
			case 0: { // a serpent bursting out of the sand
				serpent_burst(f.x, f.z, gy, age, sd, now, li);
				break;
			}
			case 1: { // a Minion
				const Lin col = hex_lin(f.kind ? 0x6ab4ff : 0x86ff7a);
				decal(I_DECAL_ADD, f.x, gy + 0.08, f.z, 3.2, sd % 628 / 100.0, col.r, col.g, col.b, (float)(1.6 * k), 0, (float)((sd >> 4) % 977 / 977.0));
				decal(I_DECAL_MIX, f.x, gy + 0.05, f.z, 3.0, sd % 314 / 100.0, 1, 1, 1, (float)(0.85 * k), 0, (float)((sd >> 6) % 1000 / 1000.0), 1.f);
				const double pk = clamp01(1 - age / 1.2);
				glow(false, f.x, gy + 1.8, f.z, 0.9, 4.2 * pk + 0.5, col.r, col.g, col.b, 0.9 * pk, 1);
				// the sand thrown up: soft round dust (no hard voxel squares round the serpent rearing
				// out of it, seen close) and a spray of sand grains
				puff(false, f.t0, sd, now, f.x, gy + 0.3, f.z, 14, f.kind ? 0x8a8478 : 0xc9a263, 0.8, 1.4, 2.4, 1.6, 0.6, 1.8, 0.4, 1.f);
				if (age < 1.4)
					for (int i = 0; i < 26; i++) {
						const double a = hr(sd, i, 141) * TAU, sp = 1.2 + 2.2 * hr(sd, i, 142), vy = 3 + 3 * hr(sd, i, 143);
						const double yy = gy + 0.2 + vy * age - 6.0 * age * age;
						if (yy < gy) continue;
						const Lin sc = hex_lin(i % 3 ? 0xc9a263 : 0xa8844c);
						const double s = 0.05 + 0.05 * hr(sd, i, 144);
						cube(I_DEBRIS, f.x + std::cos(a) * sp * age, yy, f.z + std::sin(a) * sp * age, age * 6 + i, a, i, s, s, s, sc.r, sc.g, sc.b);
					}
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

	// ---- Locust Swarm: a living cloud, no volume primitive --------------------------------------------
	// (gods round 23) Each swarm is drawn from its own noise field: an irregular footprint (a radius
	// that wanders with the angle and the time) holds a dense, swirling core of locusts in four sizes
	// and four tones (dark brown, olive, ochre and a light sand tier whose wings catch the sun) that
	// thins out into stragglers past the edge; the bigger ones beat dun wings, each fast one trails
	// a thin pale streak back along its path (where it was 0.09 s ago). Under it, soft dust puffs in two tones, dense in the core and feathering
	// into loose dust that lags behind the swarm; on the ground, a broken shadow of small soft blots.
	for (int si = 0; si < (int)G.swarms.size(); si++) {
		const aov::Swarm &w = G.swarms[si];
		const double k = env(now, w.t0, w.t0 + w.dur, 0.8, 1.5);
		if (k <= 0.001) continue;
		const double R = w.radius;
		const double hd = std::atan2(w.dz, w.dx); // (the heading)
		const double spin = (w.seed & 1) ? 1 : -1;
		// the swarm's centre at time t (its own wobble on top of the drift: never a rigid disc)
		auto centre = [&](double t, double &cx, double &cz) {
			const double a = t - w.t0;
			cx = w.x0 + w.dx * aov::SWARM_SPEED * a + 0.5 * std::sin(t * 0.7 + w.seed % 97) + 0.3 * std::sin(t * 1.9 + 3);
			cz = w.z0 + w.dz * aov::SWARM_SPEED * a + 0.5 * std::cos(t * 0.6 + w.seed % 89) + 0.3 * std::cos(t * 1.7 + 1);
		};
		// the footprint: a radius that wanders with the angle (three lobes beating against each other)
		auto rim = [&](double a, double t) {
			const uint32_t s = w.seed;
			return 0.72 + 0.16 * std::sin(a * 2 + 6.28 * hr(s, 1, 151) + t * 0.45) + 0.11 * std::sin(a * 3 + 6.28 * hr(s, 2, 151) - t * 0.6) +
					0.07 * std::sin(a * 5 + 6.28 * hr(s, 3, 151) + t * 1.1);
		};
		double x, z;
		centre(now, x, z);
		const double gy = h_at(x, z);
		// the shadow: small soft blots scattered by the same footprint, darker in the core
		for (int i = 0; i < 16; i++) {
			const double a = hr(w.seed, i, 161) * TAU + now * 0.25 * spin;
			const double rr = R * rim(a, now) * std::pow(hr(w.seed, i, 162), 0.8) * 0.9;
			const double px = x + std::cos(a) * rr, pz = z + std::sin(a) * rr;
			const double sz = R * (0.55 + 0.6 * hr(w.seed, i, 163)) * (1.1 - 0.5 * rr / R);
			decal(I_DECAL_MUL, px, h_at(px, pz) + 0.06, pz, sz, 0, 1, 1, 1, (float)(0.16 * k * (1.1 - 0.6 * rr / R)), 0);
		}
		// the dust: a dense core of dusty brown, a lighter sand fringe feathering out, and loose dust
		// left behind the swarm (puffs born at the swarm and fading as they lag back on its track)
		for (int i = 0; i < 52; i++) {
			const double u = hr(w.seed, i, 171);
			const double a = hr(w.seed, i, 172) * TAU + now * (0.35 + 0.3 * hr(w.seed, i, 173)) * spin;
			const double rr = R * rim(a, now) * (0.15 + 1.05 * std::pow(u, 0.9));
			const double px = x + std::cos(a) * rr, pz = z + std::sin(a) * rr;
			const double edge = clamp01(rr / R);
			const double s = (1.6 + 1.8 * hr(w.seed, i, 174)) * (1.15 - 0.35 * edge) + 0.25 * std::sin(now * 1.3 + i);
			Basis bs;
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			const Lin hc = hex_lin(edge > 0.65 ? (i & 1 ? 0xc4a878 : 0xa89070) : (i % 3 ? 0x7a6446 : i % 2 ? 0x5e5040 : 0x8c8478));
			inst(I_PUFF, bs, px, h_at(px, pz) + 0.5 + (2.4 - 1.4 * edge) * hr(w.seed, i, 175), pz, hc.r, hc.g, hc.b,
					(float)((0.34 - 0.2 * edge) * k), (float)hr(w.seed, i, 176), 1);
		}
		for (int i = 0; i < 18; i++) { // the trail: puffs shed every ~0.3 s, each living 2.4 s
			const double per = 2.4, ph = hr(w.seed, i, 181) * per;
			const double t = std::fmod(now - w.t0 + ph, per);
			const double tb = now - t; // born
			if (tb < w.t0) continue;
			double bx, bz;
			centre(tb, bx, bz);
			const double a = hr(w.seed, i, 182) * TAU;
			const double rr = R * rim(a, tb) * (0.4 + 0.6 * hr(w.seed, i, 183));
			const double px = bx + std::cos(a) * rr + std::cos(a) * t * 0.5, pz = bz + std::sin(a) * rr + std::sin(a) * t * 0.5;
			const double life = t / per;
			const double s = (1.2 + 1.2 * hr(w.seed, i, 184)) * (1 + 0.8 * life);
			Basis bs;
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			const Lin hc = hex_lin(i & 1 ? 0xc9b083 : 0xa48c64);
			const double kb = env(tb, w.t0, w.t0 + w.dur, 0.8, 1.5);
			inst(I_PUFF, bs, px, h_at(px, pz) + 0.4 + 0.6 * life + hr(w.seed, i, 185), pz, hc.r, hc.g, hc.b,
					(float)(0.2 * kb * std::sin(PI * std::min(1.0, life * 1.15))), (float)hr(w.seed, i, 186), 1);
		}
		// the locusts: each on its own orbit; the core packed and spinning fast, stragglers slow and far
		static const uint32_t TONES[4] = { 0x2e2418, 0x4e4228, 0x8a6c3a, 0xe2c991 };
		Lin tone[4];
		for (int c = 0; c < 4; c++) tone[c] = hex_lin(TONES[c]);
		static const double SIZES[4] = { 0.032, 0.05, 0.075, 0.11 };
		const Lin wing = hex_lin(0x9a8660);
		const int N = (int)(460 * k);
		for (int i = 0; i < N; i++) {
			const double u = hr(w.seed, i, 121);
			const double rn = 1.3 * std::pow(u, 2.0); // (dense core: half of them inside 0.33 R)
			const double a0 = hr(w.seed, i, 124) * TAU;
			const double om = (0.5 + 0.5 * hr(w.seed, i, 122)) * 1.6 / (0.25 + rn) * spin; // (the core spins fastest)
			const double fb = 0.6 + 1.5 * hr(w.seed, i, 123), fc = 1.1 + 2.2 * hr(w.seed, i, 125);
			const double pb = hr(w.seed, i, 126) * TAU, pc = hr(w.seed, i, 127) * TAU;
			const double hbase = (0.5 + 3.2 * hr(w.seed, i, 128)) * (1.15 - 0.55 * std::min(1.0, rn));
			const int ti = hr(w.seed, i, 129) < 0.2 ? 3 : hr(w.seed, i, 130) < 0.5 ? 0 : hr(w.seed, i, 131) < 0.6 ? 1 : 2;
			const double sv = hr(w.seed, i, 132);
			const int zi = sv < 0.4 ? 0 : sv < 0.75 ? 1 : sv < 0.94 ? 2 : 3;
			auto pos = [&](double t, double &px, double &py, double &pz, double &a) {
				double cx, cz;
				centre(t, cx, cz);
				a = a0 + t * om;
				const double rr = R * rn * rim(a, t);
				px = cx + std::cos(a) * rr + 0.45 * std::sin(t * fb + pb);
				pz = cz + std::sin(a) * rr * 0.9 + 0.45 * std::cos(t * fb * 1.3 + pc);
				py = h_at(px, pz) + hbase + 0.6 * std::sin(t * fc + pc);
			};
			double px, py, pz, a;
			pos(now, px, py, pz, a);
			const double s = SIZES[zi] * (0.85 + 0.3 * hr(w.seed, i, 133));
			const double yaw = -(a + PI / 2 * spin);
			const double flap = std::abs(std::sin(now * 38 + i));
			const Lin &c = tone[ti];
			const double roll = 0.3 * std::sin(now * 5 + i);
			cube(I_DEBRIS, px, py, pz, roll, yaw, 0, s * 2.2, s * 0.8, s * 0.8, c.r, c.g, c.b);
			// the wings: a flat dun pair beating over the two bigger sizes
			if (zi >= 2) {
				const double span = s * (1.0 + 0.8 * flap);
				cube(I_DEBRIS, px, py + s * 0.45, pz, roll, yaw, 0, s * 1.1, s * 0.15, span, wing.r, wing.g, wing.b);
			}
			// the streak: a thin pale dash from where it was 0.09 s ago (the fast ones only)
			if (std::abs(om) * R * rn < 2.0 || (i % 3) == 2) continue;
			double qx, qy, qz, qa;
			pos(now - 0.09, qx, qy, qz, qa);
			const double ddx = px - qx, ddy = py - qy, ddz = pz - qz;
			const double len = std::sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
			if (len < 0.08) continue;
			const double hl = std::sqrt(ddx * ddx + ddz * ddz);
			const Lin &gc = tone[ti == 0 ? 2 : 3];
			cube(I_DEBRIS, (px + qx) / 2, (py + qy) / 2, (pz + qz) / 2, 0, std::atan2(-ddz, ddx), std::atan2(ddy, hl), len, s * 0.3,
					s * 0.3, gc.r * 0.85f, gc.g * 0.85f, gc.b * 0.85f);
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
	Array cits; // (egypt_fx.gd: the Citadel's fortress model over each, rising in the cast)
	for (int32_t id : G.citadels) {
		const int b = E.building_slot(id);
		if (b < 0 || B.dead[b]) continue;
		const double half = std::max(B.w[b], B.h[b]) * 0.5, gy = h_at(B.x[b], B.z[b]);
		{
			double rise = 1;
			for (const aov::CitadelCast &c : G.citadel_fx)
				if (c.building == id) rise = sstep(0.2, 2.6, now - c.t0);
			Dictionary cd;
			cd["id"] = id;
			cd["x"] = B.x[b];
			cd["z"] = B.z[b];
			cd["y"] = gy;
			cd["w"] = std::max(B.w[b], B.h[b]);
			cd["owner"] = B.owner[b];
			cd["rise"] = rise;
			cits.push_back(cd);
		}
		const Lin gc = hex_lin(0xffc850);
		decal(I_DECAL_ADD, B.x[b], gy + 0.12, B.z[b], 2 * half * 1.45, now * 0.05, gc.r, gc.g, gc.b, 0.55f, 5, 0.86f, (float)(now * 0.05));
		for (int i = 0; i < 16; i++) {
			const double f = std::fmod(now / (3 + hr(id, i, 151) * 2) + hr(id, i, 152), 1.0);
			const double a = hr(id, i, 153) * TAU, rr = half * (0.8 + 0.4 * hr(id, i, 154));
			const double s = 0.05 * std::sin(f * PI);
			cube(I_EMBER, B.x[b] + std::cos(a) * rr, gy + 0.5 + f * 6, B.z[b] + std::sin(a) * rr, now, a, 0, s, s, s, 3.0f, 2.2f, 0.7f);
		}
	}

	eg["citadels"] = cits;

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
		// the chain lightning, layered as the Lightning Storm's bolts are (godpower_view.cpp
		// bolt_lines): a hot deep-gold leader that tapers toward its target, two soft halos and
		// a wide amber veil, a second jittered strand, crackling side tendrils, and at each
		// struck man a burst of light, a scorch-gold ground flash and sparks thrown off
		std::vector<Line> L;
		for (const aov::Arc &a : G.arcs) {
			const double age = now - a.t0;
			if (age < 0 || age > 0.45) continue;
			const double k = std::pow(1 - age / 0.45, 0.8);
			const double flick = 0.75 + 0.25 * std::sin(now * 90 + a.seed % 97);
			aov::RNG rng(a.seed ^ (uint32_t)std::floor(now * 20));
			const P p0{ a.x0, a.y0, a.z0 }, p1{ a.x1, a.y1, a.z1 };
			const std::vector<P> pts = fractal(rng, p0, p1, 6, 0.16);
			const double W = 0.24;
			line(L, pts, W, 1.2 * k * flick, 0.35, 0);
			line(L, pts, W * 2.4, 0.7 * k, 0.3, 0, true);
			line(L, pts, W * 5.0, 0.3 * k, 0.25, 0, true);
			line(L, pts, W * 8.0, 0.08 * k, 0.2, 0.1, true);
			const std::vector<P> twin = fractal(rng, p0, p1, 5, 0.24);
			line(L, twin, W * 0.45, 0.7 * k * (1.7 - flick), 0.5, 0.2);
			line(L, twin, W * 1.6, 0.22 * k, 0.5, 0.2, true);
			const int n = (int)pts.size();
			for (int f = 0; f < 4 && n > 6; f++) {
				const P q = pts[rng.int_(2, n - 3)];
				const double len = rng.range(0.5, 1.3), an = rng.range(0, TAU);
				const std::vector<P> tw = fractal(rng, q, P{ q.x + std::cos(an) * len, q.y + rng.range(-0.7, 0.3) * len, q.z + std::sin(an) * len }, 3, 0.25);
				line(L, tw, W * 0.35, 0.8 * k, 0.9, 0.8);
				line(L, tw, W * 1.5, 0.2 * k, 0.9, 0.85, true);
			}
			const Lin gc = hex_lin(0xffc040), hc = hex_lin(0xfff0a0);
			glow(false, a.x1, a.y1, a.z1, 2.4, 2.4, gc.r, gc.g, gc.b, 0.95 * k, 2);
			glow(false, a.x1, a.y1, a.z1, 0.9, 0.9, hc.r, hc.g, hc.b, 1.0 * k, 3);
			glow(false, a.x0, a.y0, a.z0, 1.2, 1.2, gc.r, gc.g, gc.b, 0.6 * k, 2);
			const double gy = h_at(a.x1, a.z1);
			decal(I_DECAL_ADD, a.x1, gy + 0.1, a.z1, 2.2 + 1.2 * (age / 0.45), 0, gc.r, gc.g, gc.b, (float)(0.9 * k), 8);
			for (int j = 0; j < 10; j++) { // sparks thrown off the struck man, falling back
				const double tt = age * (1.2 + 0.6 * hr(a.seed, j, 211)), an = hr(a.seed, j, 212) * TAU, sp = 1.5 + 2.0 * hr(a.seed, j, 213);
				const double sx = a.x1 + std::cos(an) * sp * tt, sz = a.z1 + std::sin(an) * sp * tt;
				const double sy = a.y1 + (2.5 * hr(a.seed, j, 214)) * tt - 6 * tt * tt;
				const double ss = 0.05 * k;
				if (sy < gy || ss < 0.005) continue;
				cube(I_EMBER, sx, sy, sz, now, an, 0, ss, ss, ss, 3.2f, 2.3f, 0.7f);
			}
		}
		if (!L.empty()) emit_lines(G_ARC, L, 1);
		if (!G.arcs.empty()) {
			const aov::Arc &a = G.arcs.back();
			lit(a.x1, a.y1 + 1, a.z1, 0xffc050, 22 * clamp01(1 - (now - a.t0) / 0.45), 12, 1.6);
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
		// the dust skirt at its foot (egypt_fx.gd draws the skirt itself; these are soft round
		// puffs rolling off its rim, not the voxel squares, which read as pixelated blobs)
		for (int i = 0; i < 44; i++) {
			const double f = std::fmod(now / (1.4 + hr(seed, i, 181)) + hr(seed, i, 182), 1.0);
			const double a = hr(seed, i, 183) * TAU + now * 3.0 + f * 2.0, rad = 3.6 + 2.6 * f;
			const double px = x + std::cos(a) * rad, pz = z + std::sin(a) * rad;
			Basis bs;
			const double s = (0.45 + 0.7 * f) * k;
			bs.rows[0] = Vector3((real_t)s, 0, 0);
			bs.rows[1] = Vector3(0, (real_t)s, 0);
			bs.rows[2] = Vector3(0, 0, 1);
			const Lin cc = hex_lin(SAND[i & 3]);
			inst(I_PUFF, bs, px, h_at(px, pz) + 0.4 + f * 1.4, pz, cc.r * 0.62f, cc.g * 0.58f, cc.b * 0.54f, (float)(0.42 * k * (1 - f)),
					(float)(i % 97) / 97.f, 1.f);
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

	// ---- Thoth's Meteor: the target circle's glyph ring; its meteors, blasts and craters: thoth_fx ------------
	thoth_fx(now, li);
	for (const aov::ThothCast &t : G.thoth) {
		const double k = env(now, t.t0, t.t0 + 18, 0.5, 2);
		const double gy = h_at(t.cx, t.cz);
		const Lin tc = hex_lin(0x40e0d0), oc = hex_lin(0xff9a40);
		decal(I_DECAL_ADD, t.cx, gy + 0.2, t.cz, 2 * t.radius * 1.05, now * 0.06, tc.r, tc.g, tc.b, (float)(1.1 * k), 5, 0.9f, (float)(now * 0.1));
		decal(I_DECAL_ADD, t.cx, gy + 0.22, t.cz, 2 * t.radius, 0, oc.r * 0.3f, oc.g * 0.3f, 0, (float)(0.9 * k), 3, 0.94f, (float)std::fmod(now, 1000.0), -1);
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
		const bool beam = d.kind == aov::DOT_BEAM_P || d.kind == aov::DOT_BEAM_D;
		const uint32_t col = d.kind == aov::DOT_CURSE ? 0x8a30ff : d.kind == aov::DOT_VENOM ? 0x7aff3a : d.kind == aov::DOT_STING ? 0xffd040 : beam ? 0xffb030 : 0x60e040;
		if (beam) { // the Petsuchos' sun beam still burning on him: a gold glow and sparks shed upward
			const double bk = clamp01((d.until - now) / 0.4);
			const Lin gc = hex_lin(0xffc040);
			if (d.kind == aov::DOT_BEAM_D) glow(true, x, gy + h * 0.55, z, h * 1.1, h * 1.2, gc.r, gc.g, gc.b, 0.35 * bk, 0);
		}
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
	// the Roc coming down to load / unload: dust blown out from under its wings
	for (const aov::RocState &st : G.rocs) {
		const int row = E.unit_slot(st.roc);
		if (row < 0 || U.dead[row] || st.land_k <= 0.02 || st.land_k >= 0.999) continue;
		double x, z;
		upos(row, x, z);
		const double gy = h_at(x, z);
		const double k = std::sin(st.land_k * PI);
		decal(I_DECAL_ADD, x, gy + 0.08, z, 3.5 + 2.5 * st.land_k, now * 0.6, 0.55f, 0.45f, 0.3f, (float)(0.5 * k), 6, 0.7f, (float)(now * 0.4));
		for (int j = 0; j < 3; j++)
		{
			const double te = std::floor(now * 4) / 4;
			const uint32_t cyc = (uint32_t)(int64_t)(te * 4);
			puff(false, te, hmix(st.roc, j + cyc * 3, 233), now, x + std::cos(j * 2.1 + te) * 1.4 * (0.5 + 0.5 * k), gy + 0.2, z + std::sin(j * 2.1 + te) * 1.4 * (0.5 + 0.5 * k),
					6, 0xc8a878, 0.5, 0.6, 1.6, 0.6, 0.3, 1.0, 0.2);
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

// ---- Thoth's Meteor -------------------------------------------------------------------------------------
// Its fire and lava are drawn emissive (I_FLAME / I_EMBER with custom.y = 1, decal_add with
// custom.w = -1, the G_LAVA ribbons): they write a negative blue, which game/lighting/grade_effect.gd
// reads as light that keeps its own (r, g) colour. Through the grade's warm-chroma limiter a bright
// additive orange comes out pink; this way the fire is orange and the lava glows.
namespace {
// fire / lava colour by temperature (0 dark red .. 1 white-yellow), linear, before the grade's x2.1
void fire_col(double T, float &r, float &g) {
	static const double K[6][3] = { { 0.0, 0.10, 0.004 }, { 0.25, 0.30, 0.03 }, { 0.5, 0.55, 0.11 }, { 0.75, 0.8, 0.24 },
		{ 0.9, 1.0, 0.42 }, { 1.0, 1.3, 0.75 } };
	T = clamp01(T);
	for (int i = 1; i < 6; i++)
		if (T <= K[i][0]) {
			const double f = (T - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
			r = (float)(K[i - 1][1] + (K[i][1] - K[i - 1][1]) * f);
			g = (float)(K[i - 1][2] + (K[i][2] - K[i - 1][2]) * f);
			return;
		}
	r = 1.3f; g = 0.75f;
}
} // namespace

void AovGodpowerView::thoth_fx(double now, int &li) {
	const aov::GodPowers &G = sim_ref_->sim().godpowers;
	const int MAX_LIGHTS = 4;
	auto lit = [&](double x, double y, double z, uint32_t hex, double inten, double dist, double decay) {
		if (li >= MAX_LIGHTS || inten <= 0.01) return;
		li++;
		light(x, y, z, hex, inten, dist, decay);
	};
	// camera-facing sprites: fire (additive, emissive) and soft smoke (blended)
	auto fire = [&](double x, double y, double z, double s, double T, double a, uint32_t h, double tall = 1) {
		if (a <= 0.01 || s <= 0.02) return;
		float r, g;
		fire_col(T, r, g);
		Basis bs;
		bs.rows[0] = Vector3((real_t)s, 0, 0);
		bs.rows[1] = Vector3(0, (real_t)(s * tall), 0);
		bs.rows[2] = Vector3(0, 0, 1);
		inst(I_FLAME, bs, x, y, z, r, g, 0, (float)std::min(1.0, a), (float)((h % 997) / 997.0), 1);
	};
	auto smoke = [&](double x, double y, double z, double s, double v, double a, uint32_t h) {
		if (a <= 0.01 || s <= 0.02) return;
		Basis bs;
		bs.rows[0] = Vector3((real_t)s, 0, 0);
		bs.rows[1] = Vector3(0, (real_t)s, 0);
		bs.rows[2] = Vector3(0, 0, 1);
		// v: 0 black soot .. 1 a lighter ash grey (the smoke thins and greys as it rises)
		const float c = (float)(0.022 + 0.06 * v);
		inst(I_PUFF, bs, x, y, z, c * 1.06f, c, c * 0.95f, (float)std::min(1.0, a), (float)((h % 997) / 997.0), 1);
	};
	// a particle thrown from (x, y, z) at velocity v with drag 1 (as puff()), rising `up`
	auto drift = [](double age, double v, double &d) { d = v * (1 - std::exp(-age)); };

	// ---- falling meteors: a burning rock on a fire trail, its smoke, the warning ring under it
	for (const aov::Meteor &m : G.meteors) {
		if (m.done || m.kind != 1) continue;
		const double gy = h_at(m.x, m.z);
		double dx = m.x - m.sx, dy = gy - m.sy, dz = m.z - m.sz;
		const double dl = std::sqrt(dx * dx + dy * dy + dz * dz);
		dx /= dl; dy /= dl; dz /= dl;
		const double t = clamp01((now - m.t0) / m.delay);
		const double px = m.sx + (m.x - m.sx) * t, py = m.sy + (gy - m.sy) * t, pz = m.sz + (m.z - m.sz) * t;
		const uint32_t ms = (uint32_t)(int64_t)(m.t0 * 1000) ^ (uint32_t)(int64_t)(m.x * 31);
		// the rock, white-hot and tumbling, inside its fireball, a few dark crust chunks on it
		cube(I_EMBER, px, py, pz, now * 3.1, now * 2.3, now * 1.7, 0.75, 0.7, 0.8, 1.3f, 0.7f, 0, 1);
		const Lin rock = hex_lin(0x2a221e);
		for (int j = 0; j < 3; j++) {
			const double a = now * (2.5 + j) + j * 2.1;
			cube(I_DEBRIS, px + std::cos(a) * 0.32, py + std::sin(a * 1.3) * 0.3, pz + std::sin(a) * 0.32, a, a * 0.7, j, 0.32, 0.28, 0.3,
					rock.r, rock.g, rock.b);
		}
		const double fl = 0.9 + 0.1 * std::sin(now * 41);
		fire(px, py, pz, 2.2 * fl, 1.0, 1.0, ms);
		fire(px - dx * 0.8, py - dy * 0.8, pz - dz * 0.8, 3.8 * fl, 0.75, 0.8, ms + 1);
		fire(px - dx * 2.0, py - dy * 2.0, pz - dz * 2.0, 5.2, 0.45, 0.55, ms + 2);
		// the trail: a ribbon of fire behind it
		std::vector<P> trail;
		for (int i = 0; i <= 12; i++) trail.push_back(P{ -dx * i * 1.2, -dy * i * 1.2, -dz * i * 1.2 });
		std::vector<Line> L;
		line(L, trail, 0.55, 1.0, 0.9, 1);
		line(L, trail, 1.9, 0.8, 0.85, 1, true);
		emit_lines(G_LAVA, L, 1.0, px, py, pz);
		// fire and black smoke shed along the fall (closed form per 1/30 s slot)
		const int64_t t1 = (int64_t)std::floor(now * 30), t0t = (int64_t)std::ceil(m.t0 * 30);
		for (int64_t n = std::max(t0t, t1 - 75); n <= t1; n++) {
			const double te = n / 30.0, kk = clamp01((te - m.t0) / m.delay), age = now - te;
			const double qx = m.sx + (m.x - m.sx) * kk, qy = m.sy + (gy - m.sy) * kk, qz = m.sz + (m.z - m.sz) * kk;
			const uint32_t h = hmix(ms, (uint32_t)n, 7);
			if (age < 0.9) {
				const double f = age / 0.9;
				const double jx = (hr(h, 1) - 0.5) * 1.4, jy = (hr(h, 2) - 0.5) * 1.0, jz = (hr(h, 3) - 0.5) * 1.4;
				fire(qx + jx * f, qy + jy * f + 0.8 * f, qz + jz * f, 1.6 + 2.2 * f, 0.85 - 0.75 * f, 0.7 * (1 - f), h);
			}
			if (age < 2.5 && n % 2 == 0) {
				const double f = age / 2.5;
				const double jx = (hr(h, 4) - 0.5) * 1.6, jz = (hr(h, 5) - 0.5) * 1.6;
				smoke(qx + jx * f - dx * 1.5, qy + 1.2 * f - dy * 1.5, qz + jz * f - dz * 1.5, 1.4 + 3.0 * f, f, 0.55 * std::sin(PI * std::min(1.0, f * 1.4 + 0.15)), h);
			}
		}
		// the ground below: a hot ring closing in, a glow growing as it nears
		const double R1 = (m.radius + 0.5) * (1.6 - t * 0.6);
		const Lin wc = hex_lin(0xff7020);
		decal(I_DECAL_ADD, m.x, gy + 0.2, m.z, 2 * R1, 0, wc.r * 0.5f, wc.g * 0.5f, 0, (float)(std::min(1.0, t * 3) * 0.8), 3,
				(float)((m.radius - 0.5) / (m.radius + 0.5)), (float)std::fmod(now, 1000.0), -1);
		decal(I_DECAL_ADD, m.x, gy + 0.15, m.z, 2 * m.radius * (0.4 + 0.4 * t), 0, 0.5f, 0.1f, 0, (float)(0.35 * t * t * t), 8, 0, 0, -1);
		lit(px, py, pz, 0xff8a30, 34, 18, 2);
	}

	// ---- blasts and craters
	for (const aov::Scorch &sc : G.scorches) {
		if (sc.kind != 1) continue;
		const double age = now - sc.t0;
		if (age < 0 || age > aov::THOTH_CRATER_LIFE) continue;
		const uint32_t sd = sc.seed;
		const double x = sc.x, y = sc.y, z = sc.z;
		const double life = aov::THOTH_CRATER_LIFE;
		const double fade = clamp01((life - age) / 15.0);           // the crater's last 15 s
		const double heat = 0.3 + 0.7 * std::exp(-age / 10.0);      // the lava cooling to a dull glow
		const double D = sc.size;                                   // decal diameter (blast x 2.2)
		const double Rb = 0.42 * D * 0.5;                           // the bowl's radius
		// the crater: charred bowl, soot rays, cracked plates; the lava over it
		decal(I_DECAL_MIX, x, y + 0.05, z, D, (sd % 628) / 100.0, 1, 1, 1, (float)(clamp01(age / 0.15) * fade), 5,
				(float)((sd % 1000) / 1000.0), (float)clamp01(age / 40.0));
		decal(I_DECAL_ADD, x, y + 0.08, z, D, (sd % 628) / 100.0, 1, 1, 1, (float)(clamp01(age / 0.1) * fade), 9, (float)heat,
				(float)((sd % 1000) / 1000.0), -1);
		// the lip: dark rocks heaved up round the bowl, a few lava blobs glowing in it
		{
			const Lin b0 = hex_lin(0x2b2420), b1 = hex_lin(0x40362e), b2 = hex_lin(0x5a4c3e);
			const double up = clamp01(age / 0.25);
			for (int i = 0; i < 18; i++) {
				const double a = (i + 0.5) / 18.0 * TAU + (hr(sd, i, 11) - 0.5) * 0.3;
				const double rr = Rb * (0.95 + 0.18 * hr(sd, i, 12));
				const double s = (0.3 + 0.3 * hr(sd, i, 13)) * up;
				const double cx = x + std::cos(a) * rr, cz = z + std::sin(a) * rr;
				const Lin &c = i % 3 == 0 ? b2 : i % 3 == 1 ? b1 : b0;
				cube(I_DEBRIS, cx, h_at(cx, cz) + s * 0.3, cz, 0.3 * hr(sd, i, 14), a, 0.25 * hr(sd, i, 15), s * 1.3, s * 0.8, s, c.r, c.g, c.b);
			}
			for (int i = 0; i < 7; i++) {
				const double a = hr(sd, i, 21) * TAU, rr = Rb * 0.55 * std::sqrt(hr(sd, i, 22));
				const double bub = 0.5 + 0.5 * std::sin(now * (1.3 + hr(sd, i, 23)) + i * 2.1);
				const double s = (0.16 + 0.14 * hr(sd, i, 24)) * (0.7 + 0.3 * bub) * up;
				const double cx = x + std::cos(a) * rr, cz = z + std::sin(a) * rr;
				float r, g;
				fire_col(heat * (0.7 + 0.25 * bub), r, g);
				cube(I_EMBER, cx, y + 0.12, cz, 0, a, 0, s, s * 0.6, s, r * 0.7f, g * 0.7f, 0, 1);
			}
		}
		// rocks and lava thrown out (closed-form arcs; they lie where they land)
		for (int i = 0; i < 12; i++) {
			const double a = hr(sd, i, 31) * TAU, sp = 1.5 + 3 * hr(sd, i, 32), vy = 4 + 6 * hr(sd, i, 33);
			const double tl = vy / 11.0;                              // back on the ground
			const double tt = std::min(age, tl);
			const double ox = x + std::cos(a) * (0.4 + sp * tt), oz = z + std::sin(a) * (0.4 + sp * tt);
			const double oy = std::max(h_at(ox, oz), y + 0.3 + vy * tt - 5.5 * tt * tt);
			const bool hot = i % 2 == 0;
			const double s = hot ? 0.12 + 0.1 * hr(sd, i, 34) : 0.14 + 0.14 * hr(sd, i, 34);
			const double spin = age < tl ? age * 9 : tl * 9;
			const double gone = clamp01((life * 0.5 - age) / 5.0);  // the thrown pieces fade before the crater
			if (gone <= 0) continue;
			if (hot && age < 6) {
				float r, g;
				fire_col(0.95 - age / 6.0 * 0.9, r, g);
				cube(I_EMBER, ox, oy + s * 0.4, oz, spin + i, spin * 0.7, i, s, s, s, r, g, 0, 1);
				if (age < tl) fire(ox, oy + s * 0.4, oz, 0.9, 0.8 - age, 0.6, hmix(sd, i, 35));
			} else {
				const Lin c = hex_lin(i % 3 == 0 ? 0x3a302a : i % 3 == 1 ? 0x6a5640 : 0x261f1b);
				cube(I_DEBRIS, ox, oy + s * 0.4 - (1 - gone) * s, oz, spin + i, spin * 0.7, i, s, s, s, c.r, c.g, c.b);
			}
		}
		// the blast: a white-hot flash, a shock ring, the fireball rolling up into black smoke, a dust ring
		if (age < 0.6) {
			const double k = age / 0.6;
			fire(x, y + 1.2 + 2 * k, z, 6 + 10 * k, 1.0 - 0.4 * k, 1.2 * (1 - k) * (1 - k), sd);
			decal(I_DECAL_ADD, x, y + 0.2, z, 2 * (2 + 5 * k), 0, 0.9f, 0.3f, 0, (float)((1 - k) * (1 - k) * 1.1), 8, 0, 0, -1);
		}
		if (age < 0.8) {
			const double k = age / 0.8;
			decal(I_DECAL_ADD, x, y + 0.22, z, 2 * (1 + 11 * (1 - std::pow(1 - k, 2))), 0, 0.9f, 0.32f, 0, (float)((1 - k) * 2.2), 2, 0.8f, 0, -1);
		}
		if (age < 2.2) {
			for (int i = 0; i < 30; i++) {
				const double L = 0.9 + 1.0 * hr(sd, i, 41);
				const double pa = age - 0.03 * hr(sd, i, 42);
				if (pa < 0 || pa > L) continue;
				const double f = pa / L, a = hr(sd, i, 43) * TAU;
				double ho, ve;
				drift(pa, 2 + 5 * hr(sd, i, 44), ho);
				drift(pa, 3 + 6 * hr(sd, i, 45), ve);
				fire(x + std::cos(a) * ho, y + 0.6 + ve + 0.8 * pa, z + std::sin(a) * ho, (1.0 + 1.2 * hr(sd, i, 46)) * (1 + 1.0 * f),
						1.0 - 0.95 * f, 0.75 * (1 - f * f), hmix(sd, i, 47));
			}
		}
		if (age < 7) {
			for (int i = 0; i < 26; i++) {
				const double t0 = 0.2 + 0.5 * hr(sd, i, 51), L = 3.5 + 3 * hr(sd, i, 52);
				const double pa = age - t0;
				if (pa < 0 || pa > L) continue;
				const double f = pa / L, a = hr(sd, i, 53) * TAU;
				double ho, ve;
				drift(pa, 1.5 + 3 * hr(sd, i, 54), ho);
				drift(pa, 4 + 4 * hr(sd, i, 55), ve);
				smoke(x + std::cos(a) * ho + 0.6 * pa, y + 1.4 + ve + 0.9 * pa, z + std::sin(a) * ho - 0.3 * pa, (2.2 + 1.8 * hr(sd, i, 56)) * (1 + 1.3 * f),
						f * 0.8, 0.85 * std::min(1.0, pa * 4) * (1 - f), hmix(sd, i, 57));
			}
		}
		if (age < 2.5) {
			const Lin dc = hex_lin(0xb89a70);
			for (int i = 0; i < 22; i++) {
				const double L = 1.6 + 0.9 * hr(sd, i, 61), pa = age;
				if (pa > L) continue;
				const double f = pa / L, a = (i + hr(sd, i, 62)) / 22.0 * TAU;
				double ho;
				drift(pa, 6 + 4 * hr(sd, i, 63), ho);
				const double px = x + std::cos(a) * (1 + ho), pz = z + std::sin(a) * (1 + ho);
				Basis bs;
				const double s = (1.6 + 1.2 * hr(sd, i, 64)) * (1 + 1.2 * f);
				bs.rows[0] = Vector3((real_t)s, 0, 0);
				bs.rows[1] = Vector3(0, (real_t)s, 0);
				bs.rows[2] = Vector3(0, 0, 1);
				inst(I_PUFF, bs, px, h_at(px, pz) + 0.5 + 0.5 * f, pz, dc.r, dc.g, dc.b, (float)(0.55 * (1 - f)), (float)hr(sd, i, 65), 1);
			}
		}
		// the crater burning: flame tongues in the bowl for 12 s, then smoke rising thinner
		if (age < 13) {
			const double fk = clamp01((12.5 - age) / 3.0) * clamp01(age / 0.4);
			const int64_t t1 = (int64_t)std::floor(now * 15), t0t = (int64_t)std::ceil((sc.t0 + 0.3) * 15);
			for (int64_t n = std::max(t0t, t1 - 12); n <= t1; n++) {
				const double te = n / 15.0, pa = now - te;
				for (int j = 0; j < 3; j++) {
					const uint32_t h = hmix(sd, (uint32_t)n, 70 + j);
					const double L = 0.55 + 0.35 * hr(h, 1);
					if (pa > L) continue;
					const double f = pa / L, a = hr(h, 2) * TAU, rr = Rb * 0.7 * std::sqrt(hr(h, 3));
					const double fx = x + std::cos(a) * rr, fz = z + std::sin(a) * rr;
					fire(fx + 0.3 * f, y + 0.3 + 2.2 * f * (1 - 0.4 * rr / Rb), fz, (1.3 + 0.8 * hr(h, 4)) * (1 - 0.55 * f) * (0.6 + 0.4 * fk),
							(0.8 - 0.7 * f) * (0.75 + 0.25 * fk), 0.8 * fk * std::sin(PI * std::min(1.0, f * 1.3 + 0.08)), h, 2.0);
				}
			}
		}
		if (age > 0.8 && age < 40) {
			const double sk = clamp01((40 - age) / 25.0);
			const int64_t t1 = (int64_t)std::floor(now * 6), t0t = (int64_t)std::ceil((sc.t0 + 0.8) * 6);
			for (int64_t n = std::max(t0t, t1 - 30); n <= t1; n++) {
				const double te = n / 6.0, pa = now - te;
				const uint32_t h = hmix(sd, (uint32_t)n, 90);
				if (hr(h, 9) > 0.35 + 0.65 * clamp01((40 - (te - sc.t0)) / 25.0)) continue;
				const double L = 4 + 2 * hr(h, 1);
				if (pa > L) continue;
				const double f = pa / L, a = hr(h, 2) * TAU, rr = Rb * 0.5 * hr(h, 3);
				smoke(x + std::cos(a) * rr + 0.9 * pa, y + 1 + 1.6 * pa, z + std::sin(a) * rr - 0.4 * pa, (1.4 + 0.8 * hr(h, 4)) * (1 + 1.6 * f),
						0.3 + 0.6 * f, 0.35 * sk * std::min(1.0, pa * 2) * (1 - f), h);
			}
		}
		// light: the blast's flash, then the crater's glow
		if (age < 0.9) lit(x, y + 3, z, 0xff9a40, 70 * (1 - age / 0.9), 20, 2);
		else if (age < 14) lit(x, y + 2.2, z, 0xff6a20, 12 * clamp01((14 - age) / 4) * (0.85 + 0.15 * std::sin(now * 9 + sd % 7)), 9, 2);
	}
}

