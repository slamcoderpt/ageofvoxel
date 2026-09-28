// First-pass voxel heightfield mesher (AovSim.build_terrain_mesh), used by
// game/terrain/terrain.gd until the terrain piece ports the full
// src/terrain/TerrainMesh.js (smoothed shores, talus, cliff relief, outcrops).
// Ported as is: the ground palette (palette.js topColor / sideColor /
// cliffColor / seabedColor, same noise and hashes), corner-sampled top
// colours with wallShade, per-vertex top AO and the wall foot AO gradient.
// Colours are linear (JS toLin = pow(c, 2.2)); triangles in Godot's
// clockwise winding. One call per chunk: the renderer rebuilds only chunks
// hit by take_map_changes().
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

} // namespace

Array AovSim::build_terrain_mesh(int64_t cx0_, int64_t cz0_, int64_t cx1_, int64_t cz1_) const {
	const aov::GameMap &map = sim_.world.map;
	const int C = map.cols, W = map.water_level;
	const double V = aov::VOXEL;
	const int x0 = std::max(0, (int)cx0_), z0 = std::max(0, (int)cz0_), x1 = std::min(C, (int)cx1_), z1 = std::min(C, (int)cz1_);
	aov::Noise2D noise((uint32_t)(map.seed * 3 + 17));
	auto L = [&](int x, int z) { return x < 0 || z < 0 || x >= C || z >= C ? -4 : (int)map.heights[z * C + x]; };
	static const double AO[4] = { 0.55, 0.72, 0.87, 1.0 };
	PackedVector3Array pos, nor;
	PackedColorArray col;
	PackedInt32Array idx;
	auto lin = [](C3 c, double a) {
		return Color((float)(std::pow(c.r, 2.2) * a), (float)(std::pow(c.g, 2.2) * a), (float)(std::pow(c.b, 2.2) * a));
	};
	// JS quad(p, n, c, ao) with the triangle order flipped for Godot
	auto quad = [&](const Vector3 *p, Vector3 n, const C3 *c, const int *ao) {
		int b = (int)pos.size();
		for (int k = 0; k < 4; k++) {
			pos.push_back(p[k]);
			nor.push_back(n);
			col.push_back(lin(c[k], ao ? AO[ao[k]] : 1.0));
		}
		if (ao && ao[0] + ao[2] < ao[1] + ao[3]) {
			int t[6] = { b + 1, b + 3, b + 2, b + 1, b, b + 3 };
			for (int v : t) idx.push_back(v);
		} else {
			int t[6] = { b, b + 2, b + 1, b, b + 3, b + 2 };
			for (int v : t) idx.push_back(v);
		}
	};
	auto wall_shade = [&](int ix, int iz, int lvl) {
		double f = 1;
		for (int dz = -2; dz <= 1; dz++)
			for (int dx = -2; dx <= 1; dx++) {
				int rise = L(ix + dx, iz + dz) - lvl;
				if (rise < 2) continue;
				bool near = dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0;
				f = std::min(f, near ? (rise >= 4 ? 0.62 : 0.74) : 0.86);
			}
		return f;
	};
	const double surf = W - 0.3;
	for (int cz = z0; cz < z1; cz++)
		for (int cx = x0; cx < x1; cx++) {
			const int l = L(cx, cz);
			const int g = map.ground[cz * C + cx];
			const double y = l * V, X = cx * V, Z = cz * V;
			auto occ = [&](int dx, int dz) { return L(cx + dx, cz + dz) > l ? 1 : 0; };
			auto corner_ao = [&](int sx, int sz) {
				int s1 = occ(sx, 0), s2 = occ(0, sz), cr = occ(sx, sz);
				return s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
			};
			int ao[4] = { corner_ao(-1, 1), corner_ao(1, 1), corner_ao(1, -1), corner_ao(-1, -1) };
			static const int CS[4][2] = { { 0, 1 }, { 1, 1 }, { 1, 0 }, { 0, 0 } };
			C3 c[4];
			if (l < W) {
				// underwater column: seabed tint by depth (the JS smooths shores; first pass keeps steps)
				for (int k = 0; k < 4; k++) c[k] = seabed_color(cx + CS[k][0], cz + CS[k][1], surf - l, noise);
			} else if (g == aov::PAVED || g == aov::FARM || g == aov::ROCK) {
				C3 t = mul(top_color(g, cx, cz, l, noise), wall_shade(cx, cz, l) * 0.5 + wall_shade(cx + 1, cz + 1, l) * 0.5);
				for (int k = 0; k < 4; k++) c[k] = t;
			} else {
				double jit = 1 + (hash2(cx, cz, 57) - 0.5) * 0.07;
				for (int k = 0; k < 4; k++) {
					int ix = cx + CS[k][0], iz = cz + CS[k][1];
					c[k] = mul(top_color(g, ix, iz, l, noise), jit * wall_shade(ix, iz, l));
				}
			}
			Vector3 tp[4] = { Vector3(X, y, Z + V), Vector3(X + V, y, Z + V), Vector3(X + V, y, Z), Vector3(X, y, Z) };
			quad(tp, Vector3(0, 1, 0), c, ao);
			static const int SD[4][2] = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } };
			for (int s = 0; s < 4; s++) {
				const int dx = SD[s][0], dz = SD[s][1];
				const int nl = L(cx + dx, cz + dz);
				if (nl >= l) continue;
				const int bottom = nl, drop = l - nl;
				const int u = dx != 0 ? cz : cx;
				for (int k = l - 1; k >= bottom; k--) {
					const int depth = l - 1 - k;
					const double yy = k * V;
					C3 sc = k < W - 1 ? seabed_color(cx, cz, surf - k, noise)
							: (drop >= 2 || g == aov::ROCK) ? cliff_color(g, depth, drop, u, k, cx, cz, noise)
															 : side_color(g, depth, cx, k, cz);
					if (depth == 0 && drop < 2) sc = mul(sc, 1.05);
					const int up = k - nl;
					auto ao_at = [](double h) { return h >= 2.2 ? 1.0 : 0.58 + 0.42 * std::max(0.0, h) / 2.2; };
					C3 scB = mul(sc, ao_at(up)), scT = mul(sc, ao_at(up + 1));
					Vector3 p[4];
					if (dx == 1) { p[0] = Vector3(X + V, yy, Z); p[1] = Vector3(X + V, yy + V, Z); p[2] = Vector3(X + V, yy + V, Z + V); p[3] = Vector3(X + V, yy, Z + V); }
					else if (dx == -1) { p[0] = Vector3(X, yy, Z + V); p[1] = Vector3(X, yy + V, Z + V); p[2] = Vector3(X, yy + V, Z); p[3] = Vector3(X, yy, Z); }
					else if (dz == 1) { p[0] = Vector3(X + V, yy, Z + V); p[1] = Vector3(X + V, yy + V, Z + V); p[2] = Vector3(X, yy + V, Z + V); p[3] = Vector3(X, yy, Z + V); }
					else { p[0] = Vector3(X, yy, Z); p[1] = Vector3(X, yy + V, Z); p[2] = Vector3(X + V, yy + V, Z); p[3] = Vector3(X + V, yy, Z); }
					C3 cc[4] = { scB, scT, scT, scB };
					quad(p, Vector3((real_t)dx, 0, (real_t)dz), cc, nullptr);
				}
			}
		}
	Array arrays;
	arrays.resize(Mesh::ARRAY_MAX);
	if (pos.is_empty()) return arrays;
	arrays[Mesh::ARRAY_VERTEX] = pos;
	arrays[Mesh::ARRAY_NORMAL] = nor;
	arrays[Mesh::ARRAY_COLOR] = col;
	arrays[Mesh::ARRAY_INDEX] = idx;
	return arrays;
}
