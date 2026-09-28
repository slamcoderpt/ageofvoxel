// Terrain meshing for the terrain piece (game/terrain): a port of
// src/terrain/TerrainMesh.js (AovSim.build_terrain_mesh), the Water.js depth
// bake (AovSim.get_water_depth) and the GroundDetails.js scatter
// (AovSim.build_ground_details). Visual only: nothing here touches sim state.
//
// Ported as is: the ground palette (palette.js topColor / sideColor /
// cliffColor / seabedColor, same noise and hashes), corner-sampled top
// colours with wallShade, per-vertex top AO and the wall foot AO gradient,
// the smoothed shore / seabed surface (4x4 tent average of shore columns with
// a noisy grass/sand contour and wet-sand blend), skirts, talus in stepped
// cliff corners, rock outcrops and the cliff relief (grass lips, hanging
// tufts and roots, strata ledges, rubble at the foot).
// Colours are linear (JS toLin = pow(c, 2.2)); triangles in Godot's
// clockwise winding. One call per chunk: the renderer rebuilds only chunks
// hit by take_map_changes().
#include <cstring>
#include <godot_cpp/classes/mesh.hpp>
#include <godot_cpp/variant/packed_color_array.hpp>
#include <godot_cpp/variant/packed_vector3_array.hpp>

#include <algorithm>
#include <cmath>

#include "aov_sim.h"
#include "sim/core/jsmath.h"

using namespace godot;

namespace {

using aov::hash2;
struct C3 { double r, g, b; };
C3 hexc(uint32_t h) { return { ((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0 }; }
C3 lerp_hex(uint32_t a, uint32_t b, double t) {
	C3 A = hexc(a), B = hexc(b);
	return { A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t };
}
C3 mul(C3 c, double k) { return { c.r * k, c.g * k, c.b * k }; }
double clamp01(double v) { return std::min(1.0, std::max(0.0, v)); }

const uint32_t GROUND_COLORS[7][2] = {
	{ 0x44722a, 0x789838 }, { 0x9a7447, 0xb58b58 }, { 0xd9c48c, 0xe8d7a3 }, { 0x807b6b, 0xa29c86 },
	{ 0xc9bea3, 0xd9d0b8 }, { 0x6d4a2c, 0x80593a }, { 0x7f913c, 0xa19f50 },
};
const uint32_t SIDE_DIRT[2] = { 0x8a6540, 0x9c7549 }, SIDE_ROCK[2] = { 0x746a5e, 0x958a7a }, UNDERWATER[2] = { 0xb9a674, 0xc9b78a };

C3 top_color(int ground, int cx, int cz, int level, const aov::Noise2D &noise) {
	using namespace aov;
	const uint32_t *pair = GROUND_COLORS[ground < 7 ? ground : 0];
	double t = noise.fbm(cx * 0.03, cz * 0.03, 3);
	t = std::min(1.0, std::max(0.0, (t - 0.28) * 2.1));
	double mid = noise.fbm(cx * 0.13 + 40, cz * 0.13, 2) - 0.5;
	double j = (hash2(cx, cz, 11) - 0.5) * 0.12 + mid * 0.16;
	C3 c = lerp_hex(pair[0], pair[1], t);
	double &r = c.r, &g = c.g, &b = c.b;
	if (ground == PAVED) {
		double k = 0.9 + hash2(cx >> 1, cz >> 1, 5) * 0.15;
		r *= k; g *= k; b *= k;
	} else if (ground == FARM) {
		double f = (cz & 1) == 0 ? 0.85 : 1.05;
		r *= f; g *= f; b *= f;
	} else if (ground == GRASS || ground == DRYGRASS) {
		double warm = std::max(0.0, noise.fbm(cx * 0.06 + 90, cz * 0.06 + 13, 3) - 0.55) * 2.2;
		r += warm * 0.12; g += warm * 0.05; b -= warm * 0.02;
		double lush = std::max(0.0, 0.42 - noise.fbm(cx * 0.08 + 7, cz * 0.08 + 61, 2)) * 1.6;
		r -= lush * 0.1; g -= lush * 0.05; b -= lush * 0.03;
		double bare = noise.noise(cx * 0.21 + 300, cz * 0.21 + 11);
		if (bare > 0.8) {
			double k = std::min(1.0, (bare - 0.8) * 7) * 0.55;
			r += (0.6 - r) * k; g += (0.5 - g) * k; b += (0.31 - b) * k;
		}
	} else if (ground == ROCK) {
		double wx = cx + noise.noise(cx * 0.19 + 11, cz * 0.19) * 2.4;
		double wz = cz + noise.noise(cx * 0.19 + 77, cz * 0.19 + 5) * 2.4;
		int sx = (int)std::floor(wx / 3), sz = (int)std::floor(wz / 3);
		double k = 0.84 + hash2(sx, sz, 19) * 0.28;
		r *= k; g *= k; b *= k;
		double fx = wx / 3 - sx, fz = wz / 3 - sz;
		if (fx < 0.2 || fz < 0.2) { r *= 0.8; g *= 0.79; b *= 0.78; }
		double g2 = (hash2(cx * 3, cz * 5, 19) - 0.5) * 0.08;
		r *= 1 + g2; g *= 1 + g2; b *= 1 + g2;
		double soil = noise.fbm(cx * 0.07 + 140, cz * 0.07 + 40, 3);
		if (soil > 0.4) {
			double kd = std::min(1.0, (soil - 0.4) * 5);
			double grassy = std::min(1.0, std::max(0.0, (soil - 0.47) * 5));
			double tr = 0.56 + (0.4 - 0.56) * grassy, tg = 0.44 + (0.52 - 0.44) * grassy, tb = 0.29 + (0.19 - 0.29) * grassy;
			double kk = kd * (0.75 + hash2(cx, cz, 23) * 0.25);
			r += (tr - r) * kk; g += (tg - g) * kk; b += (tb - b) * kk;
		}
		double drift = noise.fbm(cx * 0.16 + 400, cz * 0.16 + 120, 2);
		if (drift > 0.52) {
			double kg = std::min(1.0, (drift - 0.52) * 6) * (0.7 + hash2(cx, cz, 29) * 0.3);
			r += (0.46 - r) * kg; g += (0.54 - g) * kg; b += (0.22 - b) * kg;
		}
		double moss = noise.fbm(cx * 0.12 + 70, cz * 0.12 + 5, 2);
		if (moss > 0.6) {
			double km = std::min(1.0, (moss - 0.6) * 4) * 0.4;
			r += (0.36 - r) * km; g += (0.45 - g) * km; b += (0.22 - b) * km;
		}
	} else if (ground == SAND) {
		double rip = jsm::sin(cx * 0.9 + noise.noise(cx * 0.1, cz * 0.1) * 6) * 0.025;
		r += rip; g += rip; b += rip;
	}
	double lift = 1 + std::min(ground == ROCK ? 0.02 : 0.08, std::max(-0.06, (level - 4) * 0.012));
	return { clamp01((r + j * r) * lift), clamp01((g + j * g) * lift), clamp01((b + j * b) * lift) };
}

C3 seabed_color(int ix, int iz, double d, const aov::Noise2D &noise) {
	static const double D[] = { -0.3, 0.0, 0.4, 2.0, 4.0, 7.0, 12.0 };
	static const uint32_t CC[] = { 0xcdb88a, 0xa89066, 0xd8c897, 0xc4b889, 0x8d9a72, 0x5f6f5a, 0x3f5250 };
	int i = 0;
	while (i < 7 - 2 && d > D[i + 1]) i++;
	double t = std::min(1.0, std::max(0.0, (d - D[i]) / (D[i + 1] - D[i])));
	C3 c = lerp_hex(CC[i], CC[i + 1], t);
	if (d > 0.6) {
		double weed = noise.fbm(ix * 0.09 + 500, iz * 0.09 + 200, 3);
		if (weed > 0.55) {
			double k = std::min(1.0, (weed - 0.55) * 5) * 0.55 * std::min(1.0, (d - 0.6) / 1.5);
			c.r += (0.33 - c.r) * k; c.g += (0.45 - c.g) * k; c.b += (0.27 - c.b) * k;
		}
		double st = noise.noise(ix * 0.35 + 40, iz * 0.35 + 900);
		if (st > 0.78) c = mul(c, 0.8 + (1 - st) * 0.6);
	}
	return mul(c, 1 + (hash2(ix, iz, 71) - 0.5) * 0.05);
}

C3 side_color(int ground, int depth, int cx, int cy, int cz) {
	using namespace aov;
	double j = (hash2(cx * 7 + cy, cz * 3 - cy, 31) - 0.5) * 0.14;
	const uint32_t *pair;
	if (ground == ROCK || depth > 2) pair = SIDE_ROCK;
	else if (depth == 0 && (ground == GRASS || ground == DRYGRASS)) return mul(hexc(GROUND_COLORS[ground][0]), 0.92 * (1 + j));
	else if (ground == SAND) pair = UNDERWATER;
	else pair = SIDE_DIRT;
	double strata = (cy % 3) == 0 ? 0.9 : 1.0;
	if (pair == SIDE_ROCK) {
		strata *= 0.84 + hash2((cx + cz) >> 1, cy >> 1, 41) * 0.26;
		if (hash2(cx * 5 + cz, cy, 43) > 0.9) strata *= 0.75;
	}
	return mul(lerp_hex(pair[0], pair[1], hash2(cx, cz + cy * 13, 3)), strata * (1 + j));
}

C3 cliff_color(int ground, int depth, int drop, int u, int k, int cx, int cz, const aov::Noise2D &noise) {
	using namespace aov;
	static const uint32_t LIGHT[3] = { 0xbfa67e, 0xa99f8e, 0xc7b08a }, DARK[3] = { 0x8c6a47, 0x6f665c, 0x7d5d42 };
	const uint32_t EARTH = 0x6b4c31, ROOT = 0x4a3524, MOSS = 0x55702e;
	bool grassy = ground == GRASS || ground == DRYGRASS;
	double j = 1 + (hash2(u * 7 + k, cx * 3 + cz - k, 31) - 0.5) * 0.1;
	if (depth == 0 && (grassy || (ground == ROCK && hash2(u, k, 5) > 0.6))) return mul(hexc(GROUND_COLORS[grassy ? ground : GRASS][0]), 0.95 * j);
	if (ground == SAND) return mul(lerp_hex(UNDERWATER[0], UNDERWATER[1], hash2(cx, cz + k * 13, 3)), (k % 2 == 0 ? 0.93 : 1.0) * j);
	if (drop <= 2 && ground != ROCK) return mul(lerp_hex(SIDE_DIRT[0], SIDE_DIRT[1], hash2(u, k * 13, 3)), (depth == 1 ? 0.88 : 1.0) * j);
	if (depth == 1 && grassy) {
		double h = hash2(u, k, 61);
		return mul(hexc(h < 0.28 ? MOSS : h < 0.5 ? ROOT : EARTH), j);
	}
	double wob = noise.noise(cx * 0.045 + 3, cz * 0.045 + 9) * 2.2;
	int band = (int)std::floor((k + wob) / 2 + 100);
	const uint32_t *set = band % 2 == 0 ? LIGHT : DARK;
	uint32_t tone = set[(int)std::floor(hash2(band, 3, 91) * 3) % 3];
	int bw = 2 + (int)std::floor(hash2(band, 7, 93) * 3);
	int uu = u + (int)std::floor(hash2(band, 11, 95) * 4);
	int blk = (int)std::floor((double)uu / bw);
	double s = 0.9 + hash2(blk, band, 97) * 0.16;
	if (uu - blk * bw == 0 && hash2(blk, band, 99) > 0.5) s *= 0.78;
	if ((k + wob) / 2 + 100 - band < 0.26) s *= 0.8;
	if (hash2(u * 5 + k, cz + cx, 43) > 0.93) s *= 0.7;
	C3 c = hexc(tone);
	if (grassy && depth <= 3 && hash2(u, k, 67) < 0.35 - depth * 0.1) {
		c.r += (0.34 - c.r) * 0.55; c.g += (0.44 - c.g) * 0.55; c.b += (0.2 - c.b) * 0.55;
	}
	return mul(c, s * j);
}


// ---------------------------------------------------------------------------
// TerrainMesh.js: shore mask, smoothed corner levels, chunk mesher.

C3 lerp3(C3 a, C3 b, double t) { return { a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t }; }

class TerrainBuilder {
public:
	const aov::GameMap &map;
	const int C, W;
	aov::Noise2D noise;
	int rx0, rz0, rx1, rz1; // cached shore mask region [rx0, rx1) x [rz0, rz1)
	std::vector<uint8_t> shore;

	TerrainBuilder(const aov::GameMap &m, int x0, int z0, int x1, int z1) :
			map(m), C(m.cols), W(m.water_level), noise((uint32_t)(m.seed * 3 + 17)) {
		rx0 = std::max(0, x0); rz0 = std::max(0, z0);
		rx1 = std::min(C, x1); rz1 = std::min(C, z1);
		if (rx1 < rx0) rx1 = rx0;
		if (rz1 < rz0) rz1 = rz0;
		shore.assign((size_t)(rx1 - rx0) * (rz1 - rz0), 0);
		for (int cz = rz0; cz < rz1; cz++)
			for (int cx = rx0; cx < rx1; cx++) shore[(cz - rz0) * (rx1 - rx0) + cx - rx0] = compute_shore(cx, cz);
	}

	int L(int x, int z) const { return x < 0 || z < 0 || x >= C || z >= C ? -4 : (int)map.heights[z * C + x]; }

	// _computeShore for one column: 1 smooth shore, +2 sand within 3 columns
	uint8_t compute_shore(int cx, int cz) const {
		using namespace aov;
		const int i = cz * C + cx, l = map.heights[i], g = map.ground[i];
		bool s = l <= W || (l <= W + 2 && g == SAND);
		bool near = g == SAND, near_wide = near;
		for (int dz = -5; dz <= 5 && !near_wide; dz++)
			for (int dx = -5; dx <= 5; dx++) {
				const int x = cx + dx, z = cz + dz;
				if (x < 0 || z < 0 || x >= C || z >= C) continue;
				const int j = z * C + x;
				if (map.ground[j] == SAND && map.heights[j] <= W + 2) {
					near_wide = true;
					if (std::abs(dx) <= 3 && std::abs(dz) <= 3) near = true;
					break;
				}
			}
		if (!near && near_wide) {
			for (int dz = -3; dz <= 3 && !near; dz++)
				for (int dx = -3; dx <= 3 && !near; dx++) {
					const int x = cx + dx, z = cz + dz;
					if (x >= 0 && z >= 0 && x < C && z < C && map.ground[z * C + x] == SAND && map.heights[z * C + x] <= W + 2) near = true;
				}
		}
		if (!s && near_wide && l <= W + 3 && (g == GRASS || g == DRYGRASS || g == DIRT)) s = true;
		return (s ? 1 : 0) | (near ? 2 : 0);
	}

	uint8_t shore_bits(int cx, int cz) const {
		if (cx < 0 || cz < 0 || cx >= C || cz >= C) return 0;
		if (cx >= rx0 && cx < rx1 && cz >= rz0 && cz < rz1) return shore[(cz - rz0) * (rx1 - rx0) + cx - rx0];
		return compute_shore(cx, cz);
	}
	bool is_shore(int cx, int cz) const { return (shore_bits(cx, cz) & 1) == 1; }

	// smoothed level at column corner (ix, iz) (shared by columns ix-1..ix, iz-1..iz)
	double corner_level(int ix, int iz) const {
		auto clampc = [&](int v) { return std::max(0, std::min(C - 1, v)); };
		double ls[16];
		bool has[16];
		double local_max = -1e9;
		int q = 0;
		for (int dz = -2; dz <= 1; dz++)
			for (int dx = -2; dx <= 1; dx++, q++) {
				const int x = clampc(ix + dx), z = clampc(iz + dz);
				has[q] = (shore_bits(x, z) & 1) != 0;
				ls[q] = map.heights[z * C + x];
				if (has[q]) local_max = std::max(local_max, ls[q]);
			}
		if (local_max == -1e9) return W;
		double s = 0, n = 0;
		q = 0;
		for (int dz = -2; dz <= 1; dz++)
			for (int dx = -2; dx <= 1; dx++, q++) {
				double l = has[q] ? ls[q] : std::min(ls[q], local_max);
				const double w = (dx == -1 || dx == 0 ? 2 : 1) * (dz == -1 || dz == 0 ? 2 : 1);
				s += l * w; n += w;
			}
		double h = n ? s / n : W;
		for (int dz = -1; dz <= 0; dz++)
			for (int dx = -1; dx <= 0; dx++) {
				const int x = clampc(ix + dx), z = clampc(iz + dz);
				if (!(shore_bits(x, z) & 1)) h = std::min(h, (double)map.heights[z * C + x]);
			}
		return h;
	}

	double surface_y(int cx, int cz) const {
		if (!is_shore(cx, cz)) return map.level(cx, cz) * aov::VOXEL;
		return (corner_level(cx, cz) + corner_level(cx + 1, cz) + corner_level(cx, cz + 1) + corner_level(cx + 1, cz + 1)) * 0.25 * aov::VOXEL;
	}

	double wall_shade(int ix, int iz, int lvl) const {
		double f = 1;
		for (int dz = -2; dz <= 1; dz++)
			for (int dx = -2; dx <= 1; dx++) {
				const int rise = L(ix + dx, iz + dz) - lvl;
				if (rise < 2) continue;
				const bool nr = dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0;
				f = std::min(f, nr ? (rise >= 4 ? 0.62 : 0.74) : 0.86);
			}
		return f;
	}

	// --- mesh output ---
	PackedVector3Array pos, nor;
	PackedColorArray col;
	PackedInt32Array idx;

	static Color lin(C3 c, double a) {
		return Color((float)(std::pow(c.r, 2.2) * a), (float)(std::pow(c.g, 2.2) * a), (float)(std::pow(c.b, 2.2) * a));
	}
	// JS quad(p, n, c, ao) with the triangle order flipped for Godot
	void quad(const Vector3 *p, const Vector3 *n, bool per_n, const C3 *c, bool per_c, const int *ao) {
		static const double AO[4] = { 0.55, 0.72, 0.87, 1.0 };
		const int b = (int)pos.size();
		for (int k = 0; k < 4; k++) {
			pos.push_back(p[k]);
			nor.push_back(per_n ? n[k] : n[0]);
			col.push_back(lin(per_c ? c[k] : c[0], ao ? AO[ao[k]] : 1.0));
		}
		if (ao && ao[0] + ao[2] < ao[1] + ao[3]) {
			const int t[6] = { b + 1, b + 3, b + 2, b + 1, b, b + 3 };
			for (int v : t) idx.push_back(v);
		} else {
			const int t[6] = { b, b + 2, b + 1, b, b + 3, b + 2 };
			for (int v : t) idx.push_back(v);
		}
	}
	void quad1(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Vector3 n, C3 c) {
		const Vector3 p[4] = { p0, p1, p2, p3 };
		quad(p, &n, false, &c, false, nullptr);
	}
	// axis-aligned box without a bottom face
	void box(double ax, double ay, double az, double bx, double by, double bz, C3 c, C3 t) {
		typedef Vector3 V3;
		quad1(V3(ax, by, bz), V3(bx, by, bz), V3(bx, by, az), V3(ax, by, az), V3(0, 1, 0), t);
		quad1(V3(bx, ay, az), V3(bx, by, az), V3(bx, by, bz), V3(bx, ay, bz), V3(1, 0, 0), c);
		quad1(V3(ax, ay, bz), V3(ax, by, bz), V3(ax, by, az), V3(ax, ay, az), V3(-1, 0, 0), c);
		quad1(V3(bx, ay, bz), V3(bx, by, bz), V3(ax, by, bz), V3(ax, ay, bz), V3(0, 0, 1), c);
		quad1(V3(ax, ay, az), V3(ax, by, az), V3(bx, by, az), V3(bx, ay, az), V3(0, 0, -1), c);
	}

	void talus(int cx, int cz, int l, double base_y) {
		const int hx = std::max(L(cx + 1, cz), L(cx - 1, cz)) - l, hz = std::max(L(cx, cz + 1), L(cx, cz - 1)) - l;
		const int rise = std::min(hx, hz);
		if (rise < 2 || base_y < (W - 0.1) * aov::VOXEL) return;
		const int sx = L(cx + 1, cz) > L(cx - 1, cz) ? 1 : -1, sz = L(cx, cz + 1) > L(cx, cz - 1) ? 1 : -1;
		const double V = aov::VOXEL, X = cx * V, Z = cz * V;
		const double r1 = aov::hash2(cx, cz, 301), r2 = aov::hash2(cx, cz, 302), r3 = aov::hash2(cx, cz, 303);
		const double top_y = l * V + rise * V * (0.3 + r1 * 0.55);
		const double tk = 0.82 + r2 * 0.3;
		const C3 c = { 0.6 * tk, 0.56 * tk, 0.5 * tk };
		const double w1 = V * (0.6 + r2 * 0.4), w2 = V * (0.55 + r3 * 0.45);
		const double ax = sx > 0 ? X + V - w1 : X, az = sz > 0 ? Z + V - w2 : Z;
		box(ax, base_y, az, ax + w1, top_y, az + w2, mul(c, 0.88), c);
		const double h2 = base_y + (top_y - base_y) * (0.35 + r3 * 0.3);
		const double bx = sx > 0 ? X + V - w1 - 0.18 : X + w1 - 0.04, bz = sz > 0 ? Z + V - w2 * 0.8 : Z + 0.04;
		box(bx, base_y, bz, bx + 0.22, h2, bz + w2 * 0.75, mul(c, 0.8), mul(c, 0.95));
	}

	void cliff_detail(int g, int l, int base, int dx, int dz, int cx, int cz, int u, double bot) {
		using namespace aov;
		const double V = VOXEL, X = cx * V, Z = cz * V, top = l * V;
		const double fx = dx == 1 ? X + V : X, fz = dz == 1 ? Z + V : Z;
		auto place = [&](double a0, double a1, double o0, double o1, double y0, double y1, C3 c, C3 ct) {
			if (dx != 0) {
				const double xa = fx + dx * o0, xb = fx + dx * o1;
				box(std::min(xa, xb), y0, Z + a0 * V, std::max(xa, xb), y1, Z + a1 * V, c, ct);
			} else {
				const double za = fz + dz * o0, zb = fz + dz * o1;
				box(X + a0 * V, y0, std::min(za, zb), X + a1 * V, y1, std::max(za, zb), c, ct);
			}
		};
		auto h = [&](int s) { return hash2(cx * 4 + dx + 7, cz * 4 + dz + 3, s); };
		const bool grassy = g == GRASS || g == DRYGRASS || (g == ROCK && h(1) > 0.55);
		const int drop = l - base;
		if (grassy) {
			const C3 gc = top_color(g == ROCK ? GRASS : g, cx, cz, l, noise);
			const C3 lip_c = mul(gc, 0.78), lip_t = mul(gc, 0.98);
			const double over = 0.06 + h(2) * 0.08;
			place(-0.02, 1.02, -0.02, over, top - 0.1 - h(3) * 0.06, top + 0.035, lip_c, lip_t);
			const int nd = 1 + (int)std::floor(h(4) * 2.5);
			for (int i = 0; i < nd; i++) {
				const double a = 0.08 + hash2(cx + i * 17, cz - i * 5, 71 + dx * 3 + dz) * 0.7;
				const double w = 0.09 + hash2(cx - i, cz + i * 3, 72) * 0.14;
				const double len = 0.14 + hash2(cx + i, cz + i, 73) * std::min(0.55, drop * V * 0.3);
				const bool root = hash2(cx * 3 + i, cz, 74) > 0.62;
				const C3 c = root ? C3{ 0.29, 0.21, 0.14 } : mul(gc, 0.72);
				place(a, std::min(1.0, a + w), 0, over * 0.7, top - 0.1 - len, top - 0.05, c, c);
			}
		}
		if (drop >= 3) {
			const int n = (int)std::floor(h(5) * 2.2);
			for (int i = 0; i < n; i++) {
				const int ky = base + 1 + (int)std::floor(hash2(cx + i * 9, cz, 76 + dx) * (drop - 2));
				const double a = hash2(cx, cz + i * 7, 77 + dz) * 0.6;
				const double w = 0.3 + hash2(cx + i, cz * 2, 78) * 0.55;
				const double hgt = V * (0.5 + hash2(cx * 2, cz + i, 79) * 1.2);
				const double out = 0.05 + hash2(cx - i, cz, 80) * 0.11;
				const C3 c = cliff_color(ROCK, 5, drop, u, ky, cx, cz, noise);
				place(a, std::min(1.02, a + w), -0.02, out, ky * V, std::min(top - 0.12, ky * V + hgt), mul(c, 1.06), mul(c, 1.14));
			}
		}
		if (bot > (W - 0.1) * V) {
			const int nr = (int)std::floor(h(6) * (drop >= 4 ? 3.2 : 2.2));
			for (int i = 0; i < nr; i++) {
				const bool big = hash2(cx + i, cz - i, 81) > 0.72;
				const double s = big ? 0.28 + hash2(cx, cz + i, 82) * 0.3 : 0.1 + hash2(cx + i, cz, 83) * 0.14;
				const double a = hash2(cx * 5 + i, cz, 84 + dx) * (1 - s * 0.9);
				const double o = hash2(cx, cz * 5 + i, 85 + dz) * 0.25;
				const double hh = s * (0.6 + hash2(cx + i * 3, cz + i, 86) * 0.8) * (big ? std::min(2.4, drop * 0.35) : 1.0);
				const double tk = 0.8 + hash2(cx + i, cz, 87) * 0.35, warm = hash2(cx, cz + i, 88) * 0.06;
				const C3 tone = { (0.62 + warm) * tk, (0.57 + warm * 0.5) * tk, 0.5 * tk };
				place(a, a + s / V, o - 0.02, o + s, bot, bot + std::min(hh, std::max(0.1, top - bot - 0.25)), mul(tone, 0.9), tone);
			}
		}
	}

	void build(int x0, int z0, int x1, int z1) {
		using namespace aov;
		const double V = VOXEL;
		const int cOff = 2, CW = (x1 - x0) + 5, CD = (z1 - z0) + 5;
		std::vector<double> corner((size_t)CW * CD);
		for (int j = 0; j < CD; j++)
			for (int i = 0; i < CW; i++) corner[j * CW + i] = corner_level(x0 - cOff + i, z0 - cOff + j);
		auto CL = [&](int ix, int iz) { return corner[(iz - z0 + cOff) * CW + (ix - x0 + cOff)]; };
		auto corner_normal = [&](int ix, int iz) {
			const double gx = (CL(ix + 1, iz) - CL(ix - 1, iz)) * 0.5, gz = (CL(ix, iz + 1) - CL(ix, iz - 1)) * 0.5;
			const double len = std::sqrt(gx * gx + 1 + gz * gz);
			return Vector3((real_t)(-gx / len), (real_t)(1 / len), (real_t)(-gz / len));
		};
		const double surf = W - 0.3;
		static const int CS[4][2] = { { 0, 1 }, { 1, 1 }, { 1, 0 }, { 0, 0 } };
		for (int cz = z0; cz < z1; cz++)
			for (int cx = x0; cx < x1; cx++) {
				const int l = L(cx, cz);
				const int g = map.ground[cz * C + cx];
				const double y = l * V, X = cx * V, Z = cz * V;
				auto occ = [&](int dx, int dz) { return L(cx + dx, cz + dz) > l ? 1 : 0; };
				auto corner_ao = [&](int sx, int sz) {
					const int s1 = occ(sx, 0), s2 = occ(0, sz), cr = occ(sx, sz);
					return s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
				};
				const int ao[4] = { corner_ao(-1, 1), corner_ao(1, 1), corner_ao(1, -1), corner_ao(-1, -1) };

				if (is_shore(cx, cz)) {
					// --- smooth shore / seabed column ---
					double hs[4];
					for (int k = 0; k < 4; k++) hs[k] = CL(cx + CS[k][0], cz + CS[k][1]);
					const bool soft = (shore_bits(cx, cz) & 2) && (g == SAND || g == GRASS || g == DRYGRASS || g == DIRT);
					C3 cols[4];
					Vector3 p[4], n[4];
					for (int k = 0; k < 4; k++) {
						const int ix = cx + CS[k][0], iz = cz + CS[k][1];
						C3 top;
						if (soft) {
							const double edge = W + 0.85 + (noise.fbm(ix * 0.11 + 33, iz * 0.11 + 71, 2) - 0.5) * 1.4;
							const double gs = std::min(1.0, std::max(0.0, (hs[k] - edge) / 0.5 + 0.5));
							const C3 sa = top_color(SAND, ix, iz, l, noise);
							if (gs <= 0) top = sa;
							else top = lerp3(sa, top_color(g == SAND ? GRASS : g, ix, iz, l, noise), gs);
						} else top = top_color(g, ix, iz, l, noise);
						const double d = surf - hs[k];
						const C3 sb = seabed_color(ix, iz, d, noise);
						const double t = std::min(1.0, std::max(0.0, (d + 0.25) / 0.55));
						const double ws = d < 0.3 ? wall_shade(ix, iz, (int)std::floor(hs[k] + 0.5)) : 1.0;
						cols[k] = mul(lerp3(top, sb, t), ws);
						p[k] = Vector3((real_t)(ix * V), (real_t)(hs[k] * V), (real_t)(iz * V));
						n[k] = corner_normal(ix, iz);
					}
					quad(p, n, true, cols, true, nullptr);
					talus(cx, cz, l, std::min(std::min(hs[0], hs[1]), std::min(hs[2], hs[3])) * V - 0.03);
					struct Edge { int dx, dz; Vector3 n; int ka, kb; double ax, az, bx, bz; };
					const Edge edges[4] = {
						{ 1, 0, Vector3(1, 0, 0), 2, 1, X + V, Z, X + V, Z + V },
						{ -1, 0, Vector3(-1, 0, 0), 0, 3, X, Z + V, X, Z },
						{ 0, 1, Vector3(0, 0, 1), 1, 0, X + V, Z + V, X, Z + V },
						{ 0, -1, Vector3(0, 0, -1), 3, 2, X, Z, X + V, Z },
					};
					for (const Edge &e : edges) {
						const int nx = cx + e.dx, nz = cz + e.dz;
						if (is_shore(nx, nz)) continue;
						const int nl = L(nx, nz);
						const double ya = hs[e.ka] * V, yb = hs[e.kb] * V, yl = nl * V;
						if (std::max(ya, yb) <= yl) continue;
						const C3 sc = nl < 0 ? seabed_color(cx, cz, 3, noise) : side_color(SAND, 0, cx, l, cz);
						quad1(Vector3(e.ax, std::min(yl, ya), e.az), Vector3(e.ax, ya, e.az), Vector3(e.bx, yb, e.bz), Vector3(e.bx, std::min(yl, yb), e.bz), e.n, sc);
					}
					continue;
				}

				// --- regular stepped land column ---
				C3 c[4];
				const bool crisp = g == PAVED || g == FARM || g == ROCK;
				if (crisp) {
					const C3 t = mul(top_color(g, cx, cz, l, noise), wall_shade(cx, cz, l) * 0.5 + wall_shade(cx + 1, cz + 1, l) * 0.5);
					for (int k = 0; k < 4; k++) c[k] = t;
				} else {
					const double jit = 1 + (hash2(cx, cz, 57) - 0.5) * 0.07;
					for (int k = 0; k < 4; k++) {
						const int ix = cx + CS[k][0], iz = cz + CS[k][1];
						c[k] = mul(top_color(g, ix, iz, l, noise), jit * wall_shade(ix, iz, l));
					}
				}
				{
					const Vector3 tp[4] = { Vector3(X, y, Z + V), Vector3(X + V, y, Z + V), Vector3(X + V, y, Z), Vector3(X, y, Z) };
					const Vector3 up(0, 1, 0);
					quad(tp, &up, false, c, true, ao);
				}
				talus(cx, cz, l, y);
				if (g == ROCK) {
					const double r = hash2(cx, cz, 311);
					if (r < 0.2) {
						const double w = 0.25 + hash2(cx, cz, 312) * 0.25, d = 0.25 + hash2(cx, cz, 313) * 0.25;
						const double ox = hash2(cx, cz, 314) * (V - w), oz = hash2(cx, cz, 315) * (V - d);
						const double hh = 0.06 + r * 0.6;
						box(X + ox, y - 0.02, Z + oz, X + ox + w, y + hh, Z + oz + d, mul(c[0], 0.78), mul(c[0], 1.08));
					}
				}
				static const int SD[4][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
				for (int s = 0; s < 4; s++) {
					const int dx = SD[s][0], dz = SD[s][1];
					const int nl = L(cx + dx, cz + dz);
					const bool shore_n = is_shore(cx + dx, cz + dz);
					if (nl >= l && !shore_n) continue;
					const int bottom = shore_n ? std::min(nl, l) - 4 : nl;
					const int drop = l - std::max(nl, shore_n ? W - 1 : nl);
					const int u = dx != 0 ? cz : cx;
					const int base_k = shore_n ? std::max(nl, W - 1) : nl;
					const Vector3 nn((real_t)dx, 0, (real_t)dz);
					for (int k = l - 1; k >= bottom; k--) {
						const int depth = l - 1 - k;
						const double yy = k * V;
						C3 sc = k < W - 1 ? seabed_color(cx, cz, surf - k, noise)
								: (drop >= 2 || g == ROCK) ? cliff_color(g, depth, drop, u, k, cx, cz, noise)
															: side_color(g, shore_n ? std::min(depth, 1) : depth, cx, k, cz);
						if (depth == 0 && drop < 2) sc = mul(sc, 1.05);
						const int upk = k - base_k;
						auto ao_at = [](double h) { return h >= 2.2 ? 1.0 : 0.58 + 0.42 * std::max(0.0, h) / 2.2; };
						const C3 cc[4] = { mul(sc, ao_at(upk)), mul(sc, ao_at(upk + 1)), mul(sc, ao_at(upk + 1)), mul(sc, ao_at(upk)) };
						Vector3 p[4];
						if (dx == 1) { p[0] = Vector3(X + V, yy, Z); p[1] = Vector3(X + V, yy + V, Z); p[2] = Vector3(X + V, yy + V, Z + V); p[3] = Vector3(X + V, yy, Z + V); }
						else if (dx == -1) { p[0] = Vector3(X, yy, Z + V); p[1] = Vector3(X, yy + V, Z + V); p[2] = Vector3(X, yy + V, Z); p[3] = Vector3(X, yy, Z); }
						else if (dz == 1) { p[0] = Vector3(X + V, yy, Z + V); p[1] = Vector3(X + V, yy + V, Z + V); p[2] = Vector3(X, yy + V, Z + V); p[3] = Vector3(X, yy, Z + V); }
						else { p[0] = Vector3(X, yy, Z); p[1] = Vector3(X, yy + V, Z); p[2] = Vector3(X + V, yy + V, Z); p[3] = Vector3(X + V, yy, Z); }
						quad(p, &nn, false, cc, true, nullptr);
					}
					if (drop >= 2 && l - 1 >= W)
						cliff_detail(g, l, std::max(nl, W - 1), dx, dz, cx, cz, u, shore_n ? surface_y(cx + dx, cz + dz) - 0.04 : nl * V);
				}
			}
	}
};

// GroundDetails.js: tufts 0..4, flowers 5..8, pebbles 9..11
const int D_TUFTS = 5, D_FLOWERS = 4, D_PEBBLES = 3, D_MODELS = D_TUFTS + D_FLOWERS + D_PEBBLES;

} // namespace

Array AovSim::build_terrain_mesh(int64_t cx0_, int64_t cz0_, int64_t cx1_, int64_t cz1_) const {
	const aov::GameMap &map = sim_.world.map;
	const int C = map.cols;
	const int x0 = std::max(0, (int)cx0_), z0 = std::max(0, (int)cz0_), x1 = std::min(C, (int)cx1_), z1 = std::min(C, (int)cz1_);
	Array arrays;
	arrays.resize(Mesh::ARRAY_MAX);
	if (x1 <= x0 || z1 <= z0) return arrays;
	TerrainBuilder tb(map, x0 - 6, z0 - 6, x1 + 6, z1 + 6);
	tb.build(x0, z0, x1, z1);
	if (tb.pos.is_empty()) return arrays;
	arrays[Mesh::ARRAY_VERTEX] = tb.pos;
	arrays[Mesh::ARRAY_NORMAL] = tb.nor;
	arrays[Mesh::ARRAY_COLOR] = tb.col;
	arrays[Mesh::ARRAY_INDEX] = tb.idx;
	return arrays;
}

// Water.js depth bake: metres below the surface * 40 from the smoothed seabed.
PackedByteArray AovSim::get_water_depth() const {
	const aov::GameMap &map = sim_.world.map;
	const int C = map.cols;
	TerrainBuilder tb(map, 0, 0, C, C);
	const double wy = map.water_y();
	PackedByteArray out;
	out.resize((int64_t)C * C);
	uint8_t *w = out.ptrw();
	for (int cz = 0; cz < C; cz++)
		for (int cx = 0; cx < C; cx++) {
			const double d = wy - tb.surface_y(cx, cz);
			w[cz * C + cx] = (uint8_t)std::max(0.0, std::min(255.0, std::floor(d * 40 + 0.5)));
		}
	return out;
}

// GroundDetails.js _build for a column rect: one PackedFloat32Array per detail
// model (tuft0..4, flowers0..3, pebbles0..2), in MultiMesh buffer layout
// (TRANSFORM_3D + colours: 12 floats of a row-major 3x4 transform, then rgba).
Array AovSim::build_ground_details(int64_t cx0_, int64_t cz0_, int64_t cx1_, int64_t cz1_) const {
	using namespace aov;
	const GameMap &map = sim_.world.map;
	const int C = map.cols, W = map.water_level, cps = map.cps;
	const int x0 = std::max(0, (int)cx0_), z0 = std::max(0, (int)cz0_), x1 = std::min(C, (int)cx1_), z1 = std::min(C, (int)cz1_);
	Array out;
	std::vector<std::vector<float>> lists(D_MODELS);
	if (x1 > x0 && z1 > z0) {
		TerrainBuilder tb(map, x0 - 1, z0 - 1, x1 + 2, z1 + 2);
		Noise2D N((uint32_t)(map.seed * 5 + 91));
		const Noise2D &tn = tb.noise;
		const Entities &E = sim_.entities;
		for (int cz = z0; cz < z1; cz++)
			for (int cx = x0; cx < x1; cx++) {
				const int i = cz * C + cx;
				const int l = map.heights[i];
				if (l <= W) continue;
				const int g = map.ground[i];
				const int tx = cx / cps, tz = cz / cps;
				const bool blocked = map.blocked[map.t_idx(tx, tz)] > 0;
				bool tree = false;
				if (blocked) {
					auto it = map.blockers.find(map.t_idx(tx, tz));
					if (it != map.blockers.end() && E.kind(it->second) == K_RESOURCE) {
						const int r = E.slot(it->second);
						tree = r >= 0 && E.resources.type[r] == R_TREE;
					}
				}
				if (blocked && !tree) continue;
				bool flat = true;
				static const int NB[4][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
				for (auto &d : NB)
					if (map.level(cx + d[0], cz + d[1]) != l) { flat = false; break; }
				const double h = hash2(cx, cz, 401), h2 = hash2(cx, cz, 402);
				int pick = -1;
				if (g == GRASS || g == DRYGRASS) {
					const double lush = N.fbm(cx * 0.08 + 7, cz * 0.08 + 61, 2);
					const double clump = N.fbm(cx * 0.22 + 31, cz * 0.22 + 17, 2);
					const double p = std::max(0.0, clump - 0.42) * 1.8 + std::max(0.0, 0.5 - lush) * 0.6 + (tree ? 0.3 : 0) + 0.03;
					const double fl = N.fbm(cx * 0.05 + 200, cz * 0.05 + 30, 3);
					if (!tree && fl > 0.58 && h2 < (fl - 0.58) * 1.8) {
						const int kind = (int)std::floor(N.noise(cx * 0.02 + 5, cz * 0.02 + 9) * D_FLOWERS * 1.999) % D_FLOWERS;
						pick = D_TUFTS + kind;
					} else if (h < p) {
						pick = g == DRYGRASS && h2 < 0.5 ? 3 + (int)std::floor(h2 * 8) % 2 : (int)std::floor(h2 * 3);
					} else if (h > 0.996) pick = D_TUFTS + D_FLOWERS + (int)std::floor(h2 * D_PEBBLES);
				} else if (g == ROCK) {
					const double soil = std::max(tn.fbm(cx * 0.07 + 140, cz * 0.07 + 40, 3) - 0.5, tn.fbm(cx * 0.16 + 400, cz * 0.16 + 120, 2) - 0.52);
					if (soil > 0 && h < 0.1 + soil * 1.5) pick = h2 < 0.6 ? 3 + (int)std::floor(h2 * 3.3) % 2 : (int)std::floor(h2 * 3);
					else if (h > 0.93) pick = D_TUFTS + D_FLOWERS + (int)std::floor(h2 * D_PEBBLES);
				} else if (g == DIRT || g == SAND) {
					if (h < (g == SAND ? 0.012 : 0.035)) pick = D_TUFTS + D_FLOWERS + (int)std::floor(h2 * D_PEBBLES);
					else if (g == DIRT && h > 0.94) pick = 3 + (int)std::floor(h2 * 2);
				}
				if (pick < 0 || (!flat && pick < D_TUFTS + D_FLOWERS && h2 > 0.5)) continue;
				const double a = hash2(cx, cz, 403), b = hash2(cx, cz, 404), c = hash2(cx, cz, 405);
				const double ang = a * Math_PI * 2, co = std::cos(ang), si = std::sin(ang);
				const double sc = 0.75 + b * 0.6, sy = sc * (0.85 + c * 0.4);
				const double px = (cx + 0.3 + a * 0.4) * VOXEL, pz = (cz + 0.3 + c * 0.4) * VOXEL;
				const double py = tb.is_shore(cx, cz) ? tb.surface_y(cx, cz) : l * VOXEL;
				const float t = (float)(0.88 + b * 0.22);
				const float m[16] = {
					(float)(co * sc), 0, (float)(si * sc), (float)px,
					0, (float)sy, 0, (float)py,
					(float)(-si * sc), 0, (float)(co * sc), (float)pz,
					t, t, t * 0.96f, 1.0f,
				};
				lists[pick].insert(lists[pick].end(), m, m + 16);
			}
	}
	for (auto &v : lists) {
		PackedFloat32Array a;
		a.resize((int64_t)v.size());
		if (!v.empty()) std::memcpy(a.ptrw(), v.data(), v.size() * sizeof(float));
		out.push_back(a);
	}
	return out;
}
