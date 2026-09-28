// AovUnitView::lod_mesh (performance piece): a coarser voxel twin of one
// exported unit part, for units far from the camera (unit LOD).
//
// The exported part meshes (scripts/export-models.mjs) are one quad per
// visible voxel face on a grid of the rig's voxel size, pivoted at the joint.
// This rebuilds the voxel set from the faces (every voxel face a triangle
// covers, the voxel behind it; merged quads work too), fills the interior (flood fill of the outside), merges
// every factor^3 block into one cell whose box spans the solid voxels it
// holds (thin blades and spear shafts keep their width), colours the cell
// with the mean of its surface faces (CUSTOM0 albedo with the baked AO,
// CUSTOM1 team mask / glow), and emits the cells' faces that are not covered by a neighbour.
// Same vertex format as the source (VERTEX, NORMAL, CUSTOM0 / CUSTOM1 RGBA8),
// same clockwise winding. shadow_only (shadow caster twins): whole cells,
// solid when a quarter of their voxels are, faces greedy-merged, one colour.
#include "unit_view.h"

#include <godot_cpp/classes/mesh.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_vector3_array.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

using namespace godot;

namespace {

inline int floor_div(int a, int b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }

struct Acc {
	double c[8] = { 0, 0, 0, 0, 0, 0, 0, 0 }; // custom0 rgba, custom1 rgba
	int n = 0;
};

inline int64_t key3(int x, int y, int z) {
	return ((int64_t)(x + 4096) << 26) | ((int64_t)(y + 4096) << 13) | (int64_t)(z + 4096);
}

} // namespace

Array AovUnitView::lod_mesh(const Array &arrays, int64_t factor, bool shadow_only) {
	Array out;
	if (arrays.size() < Mesh::ARRAY_MAX || factor < 2) return out;
	const PackedVector3Array V = arrays[Mesh::ARRAY_VERTEX];
	const PackedVector3Array N = arrays[Mesh::ARRAY_NORMAL];
	const PackedByteArray C0 = arrays[Mesh::ARRAY_CUSTOM0];
	const PackedByteArray C1 = arrays[Mesh::ARRAY_CUSTOM1];
	const PackedInt32Array I = arrays[Mesh::ARRAY_INDEX];
	const int nv = (int)V.size();
	if (nv == 0 || I.size() < 3 || N.size() != nv || C0.size() < nv * 4 || C1.size() < nv * 4) return out;

	// voxel size: the shortest triangle edge (quad sides; diagonals are longer)
	double vox = 1e9;
	for (int64_t t = 0; t + 2 < I.size(); t += 3)
		for (int e = 0; e < 3; e++) {
			const double l = (V[I[t + e]] - V[I[t + (e + 1) % 3]]).length();
			if (l > 1e-6) vox = std::min(vox, l);
		}
	if (vox >= 1e9) return out;
	// grid origin: the mesh's min corner (parts are not all on the joint's grid)
	Vector3 org = V[0];
	for (int i = 1; i < nv; i++) org = Vector3(std::min(org.x, V[i].x), std::min(org.y, V[i].y), std::min(org.z, V[i].z));

	// surface voxels: every voxel face a triangle covers (merged / greedy
	// quads span several), the voxel on the inner side of it
	std::unordered_map<int64_t, Acc> surf;
	int lo[3] = { 1 << 20, 1 << 20, 1 << 20 }, hi[3] = { -(1 << 20), -(1 << 20), -(1 << 20) };
	for (int64_t t = 0; t + 2 < I.size(); t += 3) {
		const int a = I[t], b = I[t + 1], c = I[t + 2];
		const Vector3 n = (N[a] + N[b] + N[c]).normalized();
		const int d = std::abs(n.x) >= std::abs(n.y) && std::abs(n.x) >= std::abs(n.z) ? 0 : std::abs(n.y) >= std::abs(n.z) ? 1 : 2;
		const int u = (d + 1) % 3, w = (d + 2) % 3;
		const Vector3 P[3] = { (V[a] - org) / (real_t)vox, (V[b] - org) / (real_t)vox, (V[c] - org) / (real_t)vox };
		const double pl = (P[0][d] + P[1][d] + P[2][d]) / 3.0;
		const int layer = (int)std::floor(pl - (n[d] > 0 ? 0.5 : -0.5));
		const double u0 = std::min({ P[0][u], P[1][u], P[2][u] }), u1 = std::max({ P[0][u], P[1][u], P[2][u] });
		const double w0 = std::min({ P[0][w], P[1][w], P[2][w] }), w1 = std::max({ P[0][w], P[1][w], P[2][w] });
		const double area = (P[1][u] - P[0][u]) * (P[2][w] - P[0][w]) - (P[2][u] - P[0][u]) * (P[1][w] - P[0][w]);
		if (std::abs(area) < 1e-9) continue;
		double col[8];
		for (int ch = 0; ch < 4; ch++) {
			col[ch] = (C0[a * 4 + ch] + C0[b * 4 + ch] + C0[c * 4 + ch]) / 3.0;
			col[4 + ch] = (C1[a * 4 + ch] + C1[b * 4 + ch] + C1[c * 4 + ch]) / 3.0;
		}
		for (int iu = (int)std::floor(u0); iu < (int)std::ceil(u1 - 1e-6); iu++)
			for (int iw = (int)std::floor(w0); iw < (int)std::ceil(w1 - 1e-6); iw++) {
				// cell centre inside the triangle (barycentric, inclusive)
				const double qu = iu + 0.5, qw = iw + 0.5;
				const double l1 = ((P[1][u] - qu) * (P[2][w] - qw) - (P[2][u] - qu) * (P[1][w] - qw)) / area;
				const double l2 = ((P[2][u] - qu) * (P[0][w] - qw) - (P[0][u] - qu) * (P[2][w] - qw)) / area;
				const double l3 = 1 - l1 - l2;
				if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
				int iv[3];
				iv[d] = layer;
				iv[u] = iu;
				iv[w] = iw;
				Acc &A = surf[key3(iv[0], iv[1], iv[2])];
				for (int ch = 0; ch < 8; ch++) A.c[ch] += col[ch];
				A.n++;
				for (int k = 0; k < 3; k++) { lo[k] = std::min(lo[k], iv[k]); hi[k] = std::max(hi[k], iv[k]); }
			}
	}
	if (surf.empty()) return out;
	// dense grid with a one-voxel margin; flood the outside, the rest is solid
	const int ox = lo[0] - 1, oy = lo[1] - 1, oz = lo[2] - 1;
	const int sx = hi[0] - lo[0] + 3, sy = hi[1] - lo[1] + 3, sz = hi[2] - lo[2] + 3;
	if ((int64_t)sx * sy * sz > 8000000) return out;
	std::vector<uint8_t> g((size_t)sx * sy * sz, 0); // 1 surface, 2 outside
	auto gi = [&](int x, int y, int z) { return ((size_t)z * sy + y) * sx + x; };
	for (const auto &kv : surf) {
		const int x = (int)((kv.first >> 26) & 8191) - 4096, y = (int)((kv.first >> 13) & 8191) - 4096, z = (int)(kv.first & 8191) - 4096;
		g[gi(x - ox, y - oy, z - oz)] = 1;
	}
	{
		std::vector<int> st{ 0 };
		g[0] = 2;
		while (!st.empty()) {
			const int p = st.back();
			st.pop_back();
			const int x = p % sx, y = (p / sx) % sy, z = p / (sx * sy);
			const int nb[6][3] = { { x - 1, y, z }, { x + 1, y, z }, { x, y - 1, z }, { x, y + 1, z }, { x, y, z - 1 }, { x, y, z + 1 } };
			for (const auto &q : nb) {
				if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= sx || q[1] >= sy || q[2] >= sz) continue;
				const size_t j = gi(q[0], q[1], q[2]);
				if (g[j]) continue;
				g[j] = 2;
				st.push_back((int)j);
			}
		}
	}

	// cells of factor^3 voxels: the box of their solid voxels, the mean colour of their faces
	const int F = (int)factor;
	struct Cell { int mn[3], mx[3]; int solid = 0; Acc acc; };
	std::unordered_map<int64_t, Cell> cells;
	Acc all;
	for (int z = 0; z < sz; z++)
		for (int y = 0; y < sy; y++)
			for (int x = 0; x < sx; x++) {
				const uint8_t s = g[gi(x, y, z)];
				if (s == 2) continue;
				const int v[3] = { x + ox, y + oy, z + oz };
				const int64_t ck = key3(floor_div(v[0], F), floor_div(v[1], F), floor_div(v[2], F));
				auto it = cells.find(ck);
				if (it == cells.end()) {
					Cell c;
					for (int d = 0; d < 3; d++) c.mn[d] = c.mx[d] = v[d];
					it = cells.emplace(ck, c).first;
				}
				Cell &c = it->second;
				for (int d = 0; d < 3; d++) { c.mn[d] = std::min(c.mn[d], v[d]); c.mx[d] = std::max(c.mx[d], v[d]); }
				c.solid++;
				if (s == 1) {
					const Acc &A = surf[key3(v[0], v[1], v[2])];
					for (int ch = 0; ch < 8; ch++) { c.acc.c[ch] += A.c[ch]; all.c[ch] += A.c[ch]; }
					c.acc.n += A.n;
					all.n += A.n;
				}
			}

	PackedVector3Array ov, on;
	PackedByteArray oc0, oc1;
	PackedInt32Array oi;
	// one quad on axis d, side s (0 = -, 1 = +), in voxel units; u / w the tangent axes
	auto emit = [&](int d, int s, double plane, double u0, double u1, double w0, double w1, const uint8_t *col0, const uint8_t *col1) {
		const int u = (d + 1) % 3, w = (d + 2) % 3;
		Vector3 q[4];
		const double uv[4][2] = { { u0, w0 }, { u1, w0 }, { u1, w1 }, { u0, w1 } };
		for (int k = 0; k < 4; k++) {
			real_t p[3];
			p[d] = (real_t)(plane * vox);
			p[u] = (real_t)(uv[k][0] * vox);
			p[w] = (real_t)(uv[k][1] * vox);
			q[k] = org + Vector3(p[0], p[1], p[2]);
		}
		Vector3 n;
		n[d] = s ? 1.0f : -1.0f;
		const int base = (int)ov.size();
		for (int k = 0; k < 4; k++) {
			ov.push_back(q[k]);
			on.push_back(n);
			for (int ch = 0; ch < 4; ch++) oc0.push_back(col0[ch]);
			for (int ch = 0; ch < 4; ch++) oc1.push_back(col1[ch]);
		}
		// Godot's front faces are clockwise: cross(e1, e2) points against the normal
		const bool flip = (q[1] - q[0]).cross(q[2] - q[0]).dot(n) > 0;
		const int tri[6] = { 0, 1, 2, 0, 2, 3 };
		for (int k = 0; k < 6; k += 3) {
			oi.push_back(base + tri[k]);
			oi.push_back(base + (flip ? tri[k + 2] : tri[k + 1]));
			oi.push_back(base + (flip ? tri[k + 1] : tri[k + 2]));
		}
	};
	auto colour = [&](const Acc &A0, uint8_t *col0, uint8_t *col1) {
		const Acc &A = A0.n ? A0 : all;
		const double inv = A.n ? 1.0 / A.n : 0;
		for (int ch = 0; ch < 4; ch++) {
			col0[ch] = (uint8_t)std::lround(std::min(255.0, A.c[ch] * inv));
			col1[ch] = (uint8_t)std::lround(std::min(255.0, A.c[4 + ch] * inv));
		}
	};

	if (shadow_only) {
		// shadow casters: whole cells (solid when >= a quarter of their voxels
		// are), greedy-merged faces, one colour
		const int need = std::max(1, F * F * F / 4);
		int clo[3] = { 1 << 20, 1 << 20, 1 << 20 }, chi[3] = { -(1 << 20), -(1 << 20), -(1 << 20) };
		for (const auto &kv : cells) {
			const int cc[3] = { (int)((kv.first >> 26) & 8191) - 4096, (int)((kv.first >> 13) & 8191) - 4096, (int)(kv.first & 8191) - 4096 };
			for (int d = 0; d < 3; d++) { clo[d] = std::min(clo[d], cc[d]); chi[d] = std::max(chi[d], cc[d]); }
		}
		const int ex[3] = { chi[0] - clo[0] + 1, chi[1] - clo[1] + 1, chi[2] - clo[2] + 1 };
		std::vector<uint8_t> solid((size_t)ex[0] * ex[1] * ex[2], 0);
		auto si = [&](const int *c) { return ((size_t)c[2] * ex[1] + c[1]) * ex[0] + c[0]; };
		for (const auto &kv : cells) {
			if (kv.second.solid < need) continue;
			const int c[3] = { (int)((kv.first >> 26) & 8191) - 4096 - clo[0], (int)((kv.first >> 13) & 8191) - 4096 - clo[1], (int)(kv.first & 8191) - 4096 - clo[2] };
			solid[si(c)] = 1;
		}
		auto is_solid = [&](int x, int y, int z) {
			if (x < 0 || y < 0 || z < 0 || x >= ex[0] || y >= ex[1] || z >= ex[2]) return false;
			const int c[3] = { x, y, z };
			return solid[si(c)] != 0;
		};
		uint8_t col0[4], col1[4];
		colour(all, col0, col1);
		std::vector<uint8_t> mask;
		for (int d = 0; d < 3; d++) {
			const int u = (d + 1) % 3, w = (d + 2) % 3;
			for (int s = 0; s < 2; s++)
				for (int l = 0; l < ex[d]; l++) {
					mask.assign((size_t)ex[u] * ex[w], 0);
					for (int iw = 0; iw < ex[w]; iw++)
						for (int iu = 0; iu < ex[u]; iu++) {
							int c[3], nb[3];
							c[d] = l; c[u] = iu; c[w] = iw;
							nb[0] = c[0]; nb[1] = c[1]; nb[2] = c[2];
							nb[d] += s ? 1 : -1;
							mask[(size_t)iw * ex[u] + iu] = is_solid(c[0], c[1], c[2]) && !is_solid(nb[0], nb[1], nb[2]);
						}
					for (int iw = 0; iw < ex[w]; iw++)
						for (int iu = 0; iu < ex[u]; iu++) {
							if (!mask[(size_t)iw * ex[u] + iu]) continue;
							int wu = 1;
							while (iu + wu < ex[u] && mask[(size_t)iw * ex[u] + iu + wu]) wu++;
							int ww = 1;
							for (bool ok = true; ok && iw + ww < ex[w]; ) {
								for (int k = 0; k < wu; k++)
									if (!mask[(size_t)(iw + ww) * ex[u] + iu + k]) { ok = false; break; }
								if (ok) ww++;
							}
							for (int j = 0; j < ww; j++)
								for (int k = 0; k < wu; k++) mask[(size_t)(iw + j) * ex[u] + iu + k] = 0;
							const double plane = (double)(l + clo[d] + (s ? 1 : 0)) * F;
							emit(d, s, plane, (double)(iu + clo[u]) * F, (double)(iu + wu + clo[u]) * F,
								(double)(iw + clo[w]) * F, (double)(iw + ww + clo[w]) * F, col0, col1);
						}
				}
		}
	} else {
		for (const auto &kv : cells) {
			const Cell &c = kv.second;
			const int cc[3] = { (int)((kv.first >> 26) & 8191) - 4096, (int)((kv.first >> 13) & 8191) - 4096, (int)(kv.first & 8191) - 4096 };
			uint8_t col0[4], col1[4];
			colour(c.acc, col0, col1);
			for (int d = 0; d < 3; d++)
				for (int s = 0; s < 2; s++) {
					const int u = (d + 1) % 3, w = (d + 2) % 3;
					// covered by the neighbour cell? (our face on the cell wall, theirs on the same wall, spanning ours)
					const bool on_wall = s ? c.mx[d] == cc[d] * F + F - 1 : c.mn[d] == cc[d] * F;
					if (on_wall) {
						int nc[3] = { cc[0], cc[1], cc[2] };
						nc[d] += s ? 1 : -1;
						auto it = cells.find(key3(nc[0], nc[1], nc[2]));
						if (it != cells.end()) {
							const Cell &o = it->second;
							const bool touches = s ? o.mn[d] == nc[d] * F : o.mx[d] == nc[d] * F + F - 1;
							if (touches && o.mn[u] <= c.mn[u] && o.mx[u] >= c.mx[u] && o.mn[w] <= c.mn[w] && o.mx[w] >= c.mx[w]) continue;
						}
					}
					emit(d, s, s ? c.mx[d] + 1 : c.mn[d], c.mn[u], c.mx[u] + 1, c.mn[w], c.mx[w] + 1, col0, col1);
				}
		}
	}
	if (ov.is_empty()) return out;
	out.resize(Mesh::ARRAY_MAX);
	out[Mesh::ARRAY_VERTEX] = ov;
	out[Mesh::ARRAY_NORMAL] = on;
	out[Mesh::ARRAY_CUSTOM0] = oc0;
	out[Mesh::ARRAY_CUSTOM1] = oc1;
	out[Mesh::ARRAY_INDEX] = oi;
	return out;
}
