// AovBuildingAO::bake (buildings piece, render side): a wide-radius ambient
// occlusion baked per vertex into a building / prop mesh, standing in for
// the part of the browser's GTAO (PostFX.js: radius 1.6, blend 0.6) that the
// mesher's per-corner AO cannot reach: gaps between columns, the recess
// under a portico or eave, the joint between a wall and the ground.
//
// The mesh is rasterised into an occupancy grid (cells of 1/8 world unit,
// half a building voxel): every triangle is sampled at 1/16 unit and the
// cell just behind each sample is marked solid, so voxel faces and the
// smooth "extras" (column shafts, domes) both count. Each vertex then casts
// 32 cosine-weighted rays over its hemisphere from just in front of its face
// (nudged toward the face centre so it does not read its own corner) and
// marches them to `radius`; a ray that hits contributes 1 - (t / radius)^2.
// With `ground` the model's y = 0 plane (buildings and props are pivoted on
// the ground) is solid too, which gives the contact darkening at the foot of
// every wall. Output: one byte per vertex (0 open .. 255 fully occluded).
// Deterministic, no randomness; cost ~ vertices * 32 * 16 lookups, done
// once per model (game/buildings caches the result).
#include "building_ao.h"

#include <godot_cpp/classes/mesh.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_vector3_array.hpp>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

using namespace godot;

void AovBuildingAO::_bind_methods() {
	ClassDB::bind_static_method("AovBuildingAO", D_METHOD("bake", "arrays", "radius", "ground"), &AovBuildingAO::bake, DEFVAL(1.6), DEFVAL(true));
}

PackedByteArray AovBuildingAO::bake(const Array &arrays, double radius, bool ground) {
	PackedByteArray out;
	if (arrays.size() < Mesh::ARRAY_MAX) return out;
	const PackedVector3Array V = arrays[Mesh::ARRAY_VERTEX];
	const PackedVector3Array N = arrays[Mesh::ARRAY_NORMAL];
	const PackedInt32Array I = arrays[Mesh::ARRAY_INDEX];
	const int nv = (int)V.size();
	if (nv == 0 || N.size() != nv || I.size() < 3) return out;
	out.resize(nv);
	out.fill(0);
	radius = std::max(0.25, radius);

	const float cell = 0.125f;
	const float inv = 1.0f / cell;
	Vector3 lo = V[0], hi = V[0];
	for (int i = 1; i < nv; i++) {
		lo = lo.min(V[i]);
		hi = hi.max(V[i]);
	}
	lo -= Vector3(cell, cell, cell);
	hi += Vector3(cell, cell, cell);
	const int gx = (int)std::ceil((hi.x - lo.x) * inv) + 1;
	const int gy = (int)std::ceil((hi.y - lo.y) * inv) + 1;
	const int gz = (int)std::ceil((hi.z - lo.z) * inv) + 1;
	if ((int64_t)gx * gy * gz > 64 * 1024 * 1024) return out;
	std::vector<uint8_t> grid((size_t)gx * gy * gz, 0);
	auto cell_of = [&](const Vector3 &p, int &x, int &y, int &z) -> bool {
		x = (int)std::floor((p.x - lo.x) * inv);
		y = (int)std::floor((p.y - lo.y) * inv);
		z = (int)std::floor((p.z - lo.z) * inv);
		return x >= 0 && y >= 0 && z >= 0 && x < gx && y < gy && z < gz;
	};

	// rasterise + per-vertex face centroids
	std::vector<Vector3> cen(nv, Vector3());
	std::vector<int> cnt(nv, 0);
	const float spacing = 0.0625f;
	for (int64_t t = 0; t + 2 < I.size(); t += 3) {
		const int ia = I[t], ib = I[t + 1], ic = I[t + 2];
		if (ia < 0 || ib < 0 || ic < 0 || ia >= nv || ib >= nv || ic >= nv) continue;
		const Vector3 a = V[ia], b = V[ib], c = V[ic];
		const Vector3 m = (a + b + c) / 3.0f;
		cen[ia] += m; cen[ib] += m; cen[ic] += m;
		cnt[ia]++; cnt[ib]++; cnt[ic]++;
		Vector3 fn = N[ia] + N[ib] + N[ic];
		if (fn.length_squared() < 1e-8f) continue;
		fn.normalize();
		const float e = std::max({ (b - a).length(), (c - a).length(), (c - b).length() });
		const int ns = std::max(1, (int)std::ceil(e / spacing));
		for (int i = 0; i <= ns; i++)
			for (int j = 0; i + j <= ns; j++) {
				const Vector3 p = a + (b - a) * ((float)i / ns) + (c - a) * ((float)j / ns) - fn * 0.03f;
				int x, y, z;
				if (cell_of(p, x, y, z)) grid[((size_t)y * gz + z) * gx + x] = 1;
			}
	}

	// 32 cosine-weighted directions (Fibonacci spiral on the disc, lifted)
	const int K = 32;
	float dl[K][3];
	for (int k = 0; k < K; k++) {
		const float u = (k + 0.5f) / K;
		const float r = std::sqrt(u);
		const float ph = k * 2.39996323f;
		dl[k][0] = r * std::cos(ph);
		dl[k][1] = std::sqrt(std::max(0.0f, 1.0f - u));
		dl[k][2] = r * std::sin(ph);
	}
	const float R = (float)radius;
	const float step = 0.1f;
	const float t0 = 0.12f;

	for (int i = 0; i < nv; i++) {
		Vector3 n = N[i];
		if (n.length_squared() < 1e-8f) continue;
		n.normalize();
		const Vector3 up = std::fabs(n.y) < 0.9f ? Vector3(0, 1, 0) : Vector3(1, 0, 0);
		const Vector3 tx = up.cross(n).normalized();
		const Vector3 tz = n.cross(tx);
		Vector3 o = V[i] + n * 0.1f;
		if (cnt[i]) o += (cen[i] / (float)cnt[i] - V[i]) * 0.3f;
		float occ = 0.0f;
		for (int k = 0; k < K; k++) {
			const Vector3 d = tx * dl[k][0] + n * dl[k][1] + tz * dl[k][2];
			for (float t = t0; t <= R; t += step) {
				const Vector3 p = o + d * t;
				bool hit = ground && p.y < -0.02f;
				if (!hit) {
					int x, y, z;
					if (!cell_of(p, x, y, z)) {
						// left the grid: only the ground can still be hit
						if (!ground || d.y >= 0.0f) break;
						continue;
					}
					hit = grid[((size_t)y * gz + z) * gx + x] != 0;
				}
				if (hit) {
					const float f = t / R;
					occ += 1.0f - f * f;
					break;
				}
			}
		}
		out.set(i, (uint8_t)std::lround(std::min(1.0f, occ / K) * 255.0f));
	}
	return out;
}
