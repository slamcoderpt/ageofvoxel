// AovGodpowerView: see godpower_view.h.
#include "godpower_view.h"

#include <godot_cpp/classes/mesh.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_vector3_array.hpp>

#include <algorithm>
#include <cmath>

#include "sim/sim.h"

using namespace godot;

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr double TAU = PI * 2;
constexpr double DT = 1.0 / 30.0;

inline double clamp01(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
inline double sstep(double e0, double e1, double x) {
	const double t = clamp01((x - e0) / (e1 - e0));
	return t * t * (3 - 2 * t);
}
inline double hyp3(double x, double y, double z) { return std::sqrt(x * x + y * y + z * z); }
inline double funnel_r(double rb, double rt, double h) { return rb + (rt - rb) * std::pow(h, 1.7); }

struct Lin { float r, g, b; };
inline float lin1(double c) { return (float)(c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4)); }
inline Lin hex_lin(uint32_t h) { return { lin1(((h >> 16) & 255) / 255.0), lin1(((h >> 8) & 255) / 255.0), lin1((h & 255) / 255.0) }; }

// visual-only seed mixing
inline uint32_t mix3(uint32_t a, uint32_t b, uint32_t c) {
	uint32_t h = a * 0x9E3779B1u ^ (b + 0x7F4A7C15u) * 0x85EBCA77u ^ (c + 0x165667B1u) * 0xC2B2AE3Du;
	h ^= h >> 15; h *= 0x2C1B3C6Du; h ^= h >> 12; h *= 0x297A2D39u; h ^= h >> 15;
	return h;
}

using P = AovGodpowerView::P;
using Line = AovGodpowerView::Line;

std::vector<P> fractal(aov::RNG &rng, P a, P b, int depth, double rough) {
	std::vector<P> pts{ a, b };
	double amp = hyp3(b.x - a.x, b.y - a.y, b.z - a.z) * rough;
	for (int d = 0; d < depth; d++) {
		std::vector<P> out;
		out.reserve(pts.size() * 2);
		out.push_back(pts[0]);
		for (size_t i = 1; i < pts.size(); i++) {
			const P &p = pts[i - 1], &q = pts[i];
			P m;
			m.x = (p.x + q.x) / 2 + rng.range(-amp, amp);
			m.y = (p.y + q.y) / 2 + rng.range(-amp, amp) * 0.35;
			m.z = (p.z + q.z) / 2 + rng.range(-amp, amp);
			out.push_back(m);
			out.push_back(q);
		}
		pts.swap(out);
		amp *= 0.55;
	}
	return pts;
}

void push(std::vector<Line> &L, const std::vector<P> &pts, double w, double i, double taper, double fade, bool halo = false, int grp = -1) {
	L.push_back(Line{ pts, w, i, taper, fade, halo, grp });
}
void channel(std::vector<Line> &L, const std::vector<P> &pts, double w, double i, double taper, double fade, double bw = 7, double bi = 0.32) {
	push(L, pts, w, i, taper, fade);
	push(L, pts, w * bw, i * bi, std::min(0.95, taper + 0.1), fade, true);
}

// effects.js boltLines (cloud-to-ground strike)
template <class H>
std::vector<Line> bolt_lines(uint32_t seed, double x, double gy0, double z, H heightAt, double height = 21) {
	aov::RNG rng(seed);
	std::vector<Line> L;
	const double away = std::atan2(-1.0, -1.0);
	const double ta = away + ((seed & 1) ? 1 : -1) * rng.range(0.5, 1.6);
	const double off = rng.range(2.5, 6);
	P top{ x + std::cos(ta) * off, gy0 + height * rng.range(0.8, 0.95), z + std::sin(ta) * off };
	const std::vector<P> main = fractal(rng, top, P{ x, gy0 + 0.05, z }, 7, 0.07);
	const int n = (int)main.size();
	const double W0 = 0.14, W1 = 0.42;
	auto wAt = [&](double f) { return W0 + (W1 - W0) * f; };
	const double tap = 1 - W1 / W0;
	push(L, main, W0, 1.15, tap, -0.5);
	push(L, main, W0 * 1.8, 0.45, tap * 0.5, -0.2, true);
	push(L, main, W0 * 4.2, 0.06, tap * 0.3, 0.2, true);
	// (Godot: the browser's bloom pass has no counterpart in this renderer's
	// post, so a wide soft lavender veil stands in for the bloom round the
	// white-hot leader and its forks; kept narrow at the base (about half the
	// round-1 width there) so the men under the contact stay readable)
	push(L, main, W0 * 7.5, 0.38, 0.45, 0.15, true, AovGodpowerView::G_BLOOM);
	const int nf = rng.int_(2, 3) + (rng.chance(0.4) ? 1 : 0);
	for (int f = 0; f < nf; f++) {
		const int i = std::min(n - 1, rng.int_((int)std::floor(n * (0.3 + f * 0.14)), (int)std::floor(n * (0.44 + f * 0.14))));
		const P p = main[i];
		const double drop = p.y - gy0;
		const double len = rng.range(0.35, 0.6) * drop + 2;
		const double a = ta + PI + ((f % 2) ? 1 : -1) * rng.range(0.6, 1.9);
		P end;
		end.x = p.x + std::cos(a) * len * 0.4;
		end.y = p.y - len * rng.range(0.8, 1.3);
		end.z = p.z + std::sin(a) * len * 0.4;
		const double gy = heightAt(end.x, end.z) + 0.05;
		const bool grounded = end.y <= gy + 0.3;
		end.y = std::max(end.y, gy);
		const std::vector<P> fork = fractal(rng, p, end, 5, 0.12);
		const double fw = wAt((double)i / (n - 1)) * 0.6, ft = grounded ? 0.55 : 0.92;
		push(L, fork, fw, 0.85, ft, grounded ? 0.3 : 0.85);
		push(L, fork, fw * 3, 0.34, ft, grounded ? 0.35 : 0.9, true);
		push(L, fork, fw * 9, 0.11, ft * 0.8, 0.8, true);
		push(L, fork, fw * 5, 0.12, ft * 0.9, 0.6, true, AovGodpowerView::G_BLOOM);
		for (int k = 0; k < 3; k++) {
			if (!rng.chance(0.7)) continue;
			const int fl = (int)fork.size();
			const int j = rng.int_(3, fl - 5);
			const P q = fork[j];
			const double l2 = len * rng.range(0.2, 0.38), b2 = a + rng.range(-1.3, 1.3);
			const std::vector<P> sub = fractal(rng, q,
					P{ q.x + std::cos(b2) * l2, std::max(q.y - l2 * 0.8, heightAt(q.x, q.z) + 0.2), q.z + std::sin(b2) * l2 }, 3, 0.2);
			const double sw = fw * (1 - ((double)j / (fl - 1)) * ft) * 0.55;
			push(L, sub, sw, 0.6, 0.95, 0.85);
			push(L, sub, sw * 4, 0.2, 0.95, 0.9, true);
		}
	}
	for (int f = 0; f < 3; f++) {
		const int i = rng.int_(2, (int)std::floor(n * 0.45));
		const P p = main[i];
		const double len = rng.range(1.5, 4), a = rng.range(0, TAU);
		const std::vector<P> pts = fractal(rng, p, P{ p.x + std::cos(a) * len, p.y - len * 0.5, p.z + std::sin(a) * len }, 3, 0.22);
		push(L, pts, 0.014, 0.45, 0.95, 0.9);
		push(L, pts, 0.06, 0.1, 0.95, 0.9, true);
	}
	const int na = rng.int_(3, 5);
	for (int k = 0; k < na; k++) {
		const double a = ((double)k / na) * TAU + rng.range(-0.4, 0.4);
		const double len = rng.range(0.9, 1.8);
		std::vector<P> pts;
		const int ns = 9;
		double ox = 0, oz = 0;
		for (int s = 0; s <= ns; s++) {
			const double t = (double)s / ns;
			ox += rng.range(-0.2, 0.2);
			oz += rng.range(-0.2, 0.2);
			const double px = x + std::cos(a) * len * t + ox * t, pz = z + std::sin(a) * len * t + oz * t;
			pts.push_back(P{ px, heightAt(px, pz) + 0.08 + rng.range(0, 0.12), pz });
		}
		push(L, pts, 0.035, 0.8, 0.95, 0.9);
		push(L, pts, 0.13, 0.18, 0.9, 0.9, true);
	}
	return L;
}

std::vector<Line> sky_lines(uint32_t seed, double x, double y, double z) {
	aov::RNG rng(seed);
	const double a = rng.range(0, TAU), len = rng.range(8, 16);
	P s{ x - std::cos(a) * len / 2, y, z - std::sin(a) * len / 2 };
	P e;
	e.x = x + std::cos(a) * len / 2;
	e.y = y + rng.range(-2, 2);
	e.z = z + std::sin(a) * len / 2;
	const std::vector<P> main = fractal(rng, s, e, 5, 0.12);
	std::vector<Line> L;
	channel(L, main, 0.1, 0.8, 0.3, 0, 7, 0.3);
	for (int f = 0; f < 3; f++) {
		const P p = main[rng.int_(4, (int)main.size() - 5)];
		const double b = a + rng.range(-1.5, 1.5), l = len * 0.35;
		P q;
		q.x = p.x + std::cos(b) * l;
		q.y = p.y - rng.range(0, 3);
		q.z = p.z + std::sin(b) * l;
		channel(L, fractal(rng, p, q, 3, 0.15), 0.06, 0.55, 0.9, 0, 6, 0.3);
	}
	return L;
}

std::vector<Line> zap_lines(uint32_t seed, double h) {
	aov::RNG rng(seed);
	std::vector<Line> L;
	for (int k = 0; k < 2; k++) {
		const double a0 = rng.range(0, TAU);
		std::vector<P> pts;
		for (int s = 0; s <= 7; s++) {
			const double a = a0 + s * rng.range(0.3, 0.7), r = rng.range(0.3, 0.5);
			const double y = rng.range(0.1, h);
			pts.push_back(P{ std::cos(a) * r, y, std::sin(a) * r });
		}
		channel(L, pts, 0.025, 1, 0.4, 0, 5, 0.35);
	}
	return L;
}

double bolt_env(double age, double life, uint32_t seed) {
	if (age < 0.05) return 1.3;
	const double rs = 0.1 + (seed % 5) * 0.012;
	const double ret = std::exp(-std::pow((age - rs) / 0.03, 2)) * 0.45;
	const double flick = 0.85 + 0.15 * std::abs(std::sin(age * 38 + (seed % 7)));
	const double decay = std::exp(-(age - 0.05) / 0.16) * std::max(0.0, 1 - age / life);
	return decay * flick + ret;
}

void spark_color(double T, float &r, float &g, float &b) {
	auto lerp3 = [&](double r0, double g0, double b0, double r1, double g1, double b1, double t) {
		r = (float)(r0 + (r1 - r0) * t); g = (float)(g0 + (g1 - g0) * t); b = (float)(b0 + (b1 - b0) * t);
	};
	if (T > 0.8) return lerp3(2.6, 2.7, 3.2, 3.0, 2.4, 1.2, (1 - T) / 0.2);
	if (T > 0.55) return lerp3(3.0, 2.4, 1.2, 2.8, 1.2, 0.25, (0.8 - T) / 0.25);
	if (T > 0.25) return lerp3(2.8, 1.2, 0.25, 1.2, 0.22, 0.04, (0.55 - T) / 0.3);
	const double k = std::max(0.0, T / 0.25);
	r = (float)(1.2 * k); g = (float)(0.22 * k); b = (float)(0.04 * k);
}

double unit_height(int type) {
	static const double H[aov::U_TYPE_COUNT] = { 2.0, 2.25, 2.05, 2.75, 3.4, 3.7, 5.0, 2.9, 2.6,
		2.0, 2.25, 2.25, 2.05, 2.75, 2.9, 4.2, 5.0, 2.6, 2.25, 2.75, 2.0, 2.3, 1.4, // (the Egyptian types: sim/civ)
	1.6, 1.4, 4.0, 1.0, 1.8, 2.0, 3.6, 1.6, 1.2, // (the Animals of Set)
	2.5, 2.6, 2.6, 1.4, 3.5, 2.0, 2.8, 2.4, 2.6, 3.2, 1.4, 2.2, 3.0, 1.0 }; // (the Egyptian gods' myth units, sim/godpowers)
	return type >= 0 && type < aov::U_TYPE_COUNT ? H[type] : 1.8;
}

inline uint64_t key2(uint32_t seed, double t0) {
	return ((uint64_t)seed << 32) ^ (uint64_t)(int64_t)std::llround(t0 * 30000.0);
}

} // namespace

void AovGodpowerView::_bind_methods() {
	ClassDB::bind_method(D_METHOD("setup", "sim"), &AovGodpowerView::setup);
	ClassDB::bind_method(D_METHOD("update", "alpha", "paused", "cam"), &AovGodpowerView::update);
	ClassDB::bind_method(D_METHOD("storm_static", "id"), &AovGodpowerView::storm_static);
}

void AovGodpowerView::setup(const Ref<AovSim> &sim) {
	sim_ref_ = sim;
	bolt_cache_.clear();
	zap_cache_.clear();
	spawned_.clear();
	debris_.clear();
	sparks_.clear();
	storms_.clear();
	drifts_.clear();
	last_time_ = -1;
}

double AovGodpowerView::h_at(double x, double z) const { return sim_ref_->sim().map().height_at(x, z); }

void AovGodpowerView::emit_lines(Group g, const std::vector<Line> &lines, double alpha, double ox, double oy, double oz, double rot, double sy) {
	if (alpha <= 0.001) return;
	const double c = std::cos(rot), s = std::sin(rot);
	// Three's rotation.y: x' = x c + z s, z' = -x s + z c
	auto tf = [&](const P &p, double &x, double &y, double &z) {
		x = ox + p.x * c + p.z * s;
		y = oy + p.y * sy;
		z = oz - p.x * s + p.z * c;
	};
	for (const Line &L : lines) {
		const int n = (int)L.pts.size();
		if (n < 2) continue;
		Ribbon &R = rib_[L.grp >= 0 ? L.grp : g];
		const int32_t base = (int32_t)(R.v.size() / 3);
		for (int k = 0; k < n; k++) {
			const P &a = L.pts[std::max(0, k - 1)], &b = L.pts[std::min(n - 1, k + 1)];
			double ax, ay, az, bx, by, bz, px, py, pz;
			tf(a, ax, ay, az);
			tf(b, bx, by, bz);
			tf(L.pts[k], px, py, pz);
			double tx = bx - ax, ty = by - ay, tz = bz - az;
			if (std::abs(tx) + std::abs(ty) + std::abs(tz) < 1e-9) ty = 1;
			const double f = (double)k / (n - 1);
			const double ww = L.w * (1 - f * L.taper) * L.pts[k].wm;
			const double ii = L.i * (L.fade != 0 ? 1 - f * L.fade : 1) * L.pts[k].m * alpha;
			for (int sd = -1; sd <= 1; sd += 2) {
				R.v.push_back((float)px); R.v.push_back((float)py); R.v.push_back((float)pz);
				R.c0.push_back((float)sd); R.c0.push_back((float)ww); R.c0.push_back((float)ii); R.c0.push_back(L.halo ? 0.f : 1.f);
				R.c1.push_back((float)tx); R.c1.push_back((float)ty); R.c1.push_back((float)tz); R.c1.push_back(0.f);
			}
			if (k > 0) {
				const int32_t p = base + (k - 1) * 2, q = base + k * 2;
				R.idx.push_back(p); R.idx.push_back(p + 1); R.idx.push_back(q + 1);
				R.idx.push_back(p); R.idx.push_back(q + 1); R.idx.push_back(q);
			}
		}
	}
}

void AovGodpowerView::inst(Inst k, const Basis &b, double x, double y, double z, float r, float g, float bl, float a, float c0,
		float c1, float c2, float c3) {
	Buf &B = inst_[k];
	const float v[20] = { (float)b.rows[0].x, (float)b.rows[0].y, (float)b.rows[0].z, (float)x,
		(float)b.rows[1].x, (float)b.rows[1].y, (float)b.rows[1].z, (float)y,
		(float)b.rows[2].x, (float)b.rows[2].y, (float)b.rows[2].z, (float)z,
		r, g, bl, a, c0, c1, c2, c3 };
	B.d.insert(B.d.end(), v, v + 20);
	B.n++;
}

void AovGodpowerView::glow(bool depth, double x, double y, double z, double sx, double sy, double r, double g, double b, double o, double tight) {
	if (o <= 0.002) return;
	Basis bs;
	bs.rows[0] = Vector3((real_t)sx, 0, 0);
	bs.rows[1] = Vector3(0, (real_t)sy, 0);
	bs.rows[2] = Vector3(0, 0, 1);
	inst(depth ? I_RIM : I_GLOW, bs, x, y, z, (float)(r * o), (float)(g * o), (float)(b * o), 1, (float)tight);
}

void AovGodpowerView::decal(Inst k, double x, double y, double z, double size, double rot, float r, float g, float b, float a, float kind,
		float p1, float p2, float p3) {
	const double c = std::cos(rot) * size, s = std::sin(rot) * size;
	Basis bs;
	bs.rows[0] = Vector3((real_t)c, 0, (real_t)s);
	bs.rows[1] = Vector3(0, 1, 0);
	bs.rows[2] = Vector3((real_t)-s, 0, (real_t)c);
	inst(k, bs, x, y, z, r, g, b, a, kind, p1, p2, p3);
}

void AovGodpowerView::cube(Inst k, double x, double y, double z, double rx, double ry, double rz, double sx, double sy, double sz, float r,
		float g, float b, float flag) {
	Basis bs = Basis::from_euler(Vector3((real_t)rx, (real_t)ry, (real_t)rz), EULER_ORDER_XYZ);
	for (int i = 0; i < 3; i++) {
		bs.rows[i].x *= (real_t)sx;
		bs.rows[i].y *= (real_t)sy;
		bs.rows[i].z *= (real_t)sz;
	}
	inst(k, bs, x, y, z, r, g, b, 1, 0, flag);
}

void AovGodpowerView::light(double x, double y, double z, uint32_t hex, double intensity, double dist, double decay) {
	const Lin c = hex_lin(hex);
	const float v[9] = { (float)x, (float)y, (float)z, c.r, c.g, c.b, (float)intensity, (float)dist, (float)decay };
	lights_.insert(lights_.end(), v, v + 9);
}

// One Particles.js emit({...}) evaluated in closed form at `now` (drag 1).
void AovGodpowerView::puff(bool add, double te, uint32_t seed, double now, double x, double y, double z, int count, uint32_t color,
		double size, double life, double speed, double up, double gravity, double grow, double spread) {
	if (now < te) return;
	const Lin c = hex_lin(color);
	for (int i = 0; i < count; i++) {
		aov::RNG r(mix3(seed, (uint32_t)i, 0x51ed27u));
		const double a = r.range(0, TAU), sp = speed * r.range(0.3, 1);
		const double k = 1 + r.range(-0.1, 0.1);
		const double px = x + r.range(-spread, spread), py = y + r.range(-spread, spread) * 0.5, pz = z + r.range(-spread, spread);
		const double vx = std::cos(a) * sp, vy = up * r.range(0.5, 1.5), vz = std::sin(a) * sp;
		const double sz = size * r.range(0.7, 1.3), L = life * r.range(0.6, 1.2);
		const double age = now - te;
		if (age >= L) continue;
		const double e = std::exp(-age), h = 1 - e; // drag 1
		const double X = px + vx * h, Z = pz + vz * h;
		const double Y = py + gravity * age + (vy - gravity) * h;
		const double t = age / L;
		const double al = std::min(1.0, (1 - t) * 1.6);
		const double s = std::max(0.0, sz * (1 + grow * t)) * 0.55;
		if (s <= 0.005) continue;
		Basis bs;
		bs.rows[0] = Vector3((real_t)s, 0, 0);
		bs.rows[1] = Vector3(0, (real_t)s, 0);
		bs.rows[2] = Vector3(0, 0, 1);
		inst(add ? I_FLAME : I_PUFF, bs, X, Y, Z, (float)(c.r * k), (float)(c.g * k), (float)(c.b * k), (float)al,
				(float)((seed ^ (uint32_t)i) % 997) / 997.f);
	}
}

// index.js strike() / impactMeteor(): debris, char rim, sparks.
void AovGodpowerView::spawn_strike(double x, double y, double z, uint32_t seed, double t0, bool blast) {
	const int64_t tick = (int64_t)std::llround(t0 * 30) - 1;
	auto throw_debris = [&](int n, double power, bool blue) {
		aov::RNG vr(seed);
		static const uint32_t COLS[8] = { 0x5b4430, 0x6e5238, 0x4a3726, 0x4e7a2e, 0x3f6526, 0x1c1814, 0x2a2420, 0x7a7468 };
		for (int i = 0; i < n; i++) {
			const double a = vr.range(0, TAU), sp = vr.range(1.5, 5.5) * power;
			const bool ember = i < (int)std::ceil(n * (blue ? 0.2 : 0.4));
			Debris d;
			d.x = x + std::cos(a) * 0.3; d.y = y + 0.2; d.z = z + std::sin(a) * 0.3;
			d.vx = std::cos(a) * sp; d.vy = vr.range(4, 10) * power; d.vz = std::sin(a) * sp;
			d.rx = vr.range(0, 6); d.ry = vr.range(0, 6); d.rz = vr.range(0, 6);
			d.wx = vr.range(-12, 12); d.wy = vr.range(-8, 8); d.wz = vr.range(-12, 12);
			d.s = ember ? vr.range(0.1, 0.18) : vr.range(0.12, 0.34);
			d.color = vr.pick(COLS, 8);
			d.ember = ember; d.blue = blue;
			d.cool = blue ? vr.range(0.3, 0.6) : vr.range(1.2, 2.6);
			d.t0 = t0; d.settled = false;
			d.die = t0 + (blue ? vr.range(3, 5) : vr.range(7, 11));
			d.px = d.x; d.py = d.y; d.pz = d.z; d.tick = tick;
			debris_.push_back(d);
		}
	};
	if (blast) {
		throw_debris(60, 1.5, false);
	} else {
		throw_debris(28, 1.15, true);
		// charRim
		aov::RNG vr(seed ^ 0x27d4eb2du);
		static const uint32_t COLS[4] = { 0x16120f, 0x201a15, 0x2c241c, 0x3a2e22 };
		for (int i = 0; i < 11; i++) {
			const double a = (i / 11.0) * TAU + vr.range(-0.25, 0.25), r = vr.range(0.75, 1.3), s = vr.range(0.16, 0.3);
			const double px = x + std::cos(a) * r, pz = z + std::sin(a) * r;
			Debris d{};
			d.x = px; d.y = h_at(px, pz) + s * 0.45; d.z = pz;
			d.ry = vr.range(0, 6);
			d.s = s; d.color = vr.pick(COLS, 4);
			d.settled = true; d.t0 = t0;
			d.die = t0 + vr.range(9, 12);
			d.px = d.x; d.py = d.y; d.pz = d.z; d.tick = tick;
			debris_.push_back(d);
		}
		// throwSparks(x, y, z, 44, seed, 1.0)
		aov::RNG sr(seed ^ 0x5bd1e995u);
		for (int i = 0; i < 44; i++) {
			const double a = sr.range(0, TAU);
			const bool wide = sr.chance(0.25);
			const double sp = wide ? sr.range(6, 11) : sr.range(1.5, 5);
			const double vx = std::cos(a) * sp, vz = std::sin(a) * sp, vy = sr.range(6, 13), t = sr.range(0.04, 0.17);
			Spark p;
			p.x = x + vx * t; p.y = y + 0.25 + vy * t - 10 * t * t; p.z = z + vz * t;
			p.vx = vx; p.vy = vy - 20 * t; p.vz = vz;
			p.t0 = t0 - t;
			p.life = sr.range(0.45, 0.9);
			p.dim = 1;
			p.heat = sr.range(0.75, 1.1);
			p.px = p.x; p.py = p.y; p.pz = p.z; p.tick = tick;
			sparks_.push_back(p);
		}
		if (sparks_.size() > 400) sparks_.erase(sparks_.begin(), sparks_.begin() + (sparks_.size() - 400));
	}
	if (debris_.size() > 460) debris_.erase(debris_.begin(), debris_.begin() + (debris_.size() - 460));
}

// index.js updateDebris / the sparks loop, stepped at the sim's 30 Hz.
void AovGodpowerView::step_particles(double now) {
	const int64_t T = (int64_t)std::llround(now * 30);
	for (Debris &d : debris_) {
		while (d.tick < T) {
			d.tick++;
			d.px = d.x; d.py = d.y; d.pz = d.z;
			if (d.settled) { d.tick = T; d.px = d.x; d.py = d.y; d.pz = d.z; break; }
			d.vy -= 22 * DT;
			d.x += d.vx * DT; d.y += d.vy * DT; d.z += d.vz * DT;
			d.rx += d.wx * DT; d.ry += d.wy * DT; d.rz += d.wz * DT;
			const double g = h_at(d.x, d.z) + d.s * 0.45;
			if (d.y <= g) {
				d.y = g;
				if (d.vy < -3) { d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.wx *= 0.5; d.wz *= 0.5; }
				else {
					d.settled = true;
					d.rx = std::round(d.rx / (PI / 2)) * (PI / 2);
					d.rz = std::round(d.rz / (PI / 2)) * (PI / 2);
				}
			}
		}
	}
	debris_.erase(std::remove_if(debris_.begin(), debris_.end(), [&](const Debris &d) { return now >= d.die; }), debris_.end());
	for (Spark &p : sparks_) {
		while (p.tick < T) {
			p.tick++;
			p.px = p.x; p.py = p.y; p.pz = p.z;
			p.vy -= 20 * DT;
			p.vx *= 1 - 1.2 * DT; p.vz *= 1 - 1.2 * DT;
			p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
			const double g = h_at(p.x, p.z) + 0.05;
			if (p.y < g) { p.y = g; p.vy = std::abs(p.vy) * 0.35; p.vx *= 0.6; p.vz *= 0.6; }
		}
	}
	sparks_.erase(std::remove_if(sparks_.begin(), sparks_.end(), [&](const Spark &p) { return now - p.t0 >= p.life; }), sparks_.end());
}

void AovGodpowerView::init_storm(StormVis &v, double x, double z, double t0, double R) {
	v.init = true;
	v.rb = R * 0.85; v.rt = R * 1.18; v.H = 11;
	const int NA = 256;
	std::vector<double> raw(NA);
	v.gh.assign(NA, 0);
	for (int i = 0; i < NA; i++) {
		const double a = ((double)i / NA) * TAU;
		raw[i] = h_at(x + std::cos(a) * v.rb, z + std::sin(a) * v.rb);
	}
	v.base = 1e9;
	for (int i = 0; i < NA; i++) {
		double m = -1e9, sum = 0;
		for (int d = -6; d <= 6; d++) { const double h = raw[(i + d + NA) % NA]; sum += h; m = std::max(m, h); }
		v.gh[i] = std::max(sum / 13, m - 0.35);
		v.base = std::min(v.base, v.gh[i]);
	}
	const uint32_t s0 = (uint32_t)aov::js_int32(t0 * 1000);
	aov::RNG rng(s0 ^ 0x9e3779b9u);
	struct HD { double w, i, span, h0, climb, a; };
	static const HD HERO[7] = {
		{ 0.46, 1.0, 2.5, 0.08, 0.3, 0.0 }, { 0.28, 0.95, 2.0, 0.28, 0.35, 2.3 }, { 0.15, 0.85, 1.6, 0.02, 0.2, 4.1 },
		{ 0.08, 0.75, 1.3, 0.45, 0.3, 5.2 }, { 0.24, 0.85, 1.8, 0.18, 0.45, 1.2 }, { 0.13, 0.75, 1.5, 0.36, 0.35, 3.3 },
		{ 0.2, 0.8, 2.1, 0.55, 0.3, 5.9 },
	};
	v.bands.clear();
	for (int j = 0; j < 7; j++) {
		const HD &H0 = HERO[j];
		BandDef b;
		b.layer = (j == 2 || j == 5) ? 1 : 0;
		b.hero = j;
		b.a0 = H0.a + rng.range(-0.3, 0.3);
		b.sp = 1.55 + j * 0.18;
		b.span = H0.span; b.h0 = H0.h0; b.climb = H0.climb;
		b.dr = rng.range(-0.1, 0.25);
		b.ya = rng.range(0.1, 0.25);
		b.yf = rng.int_(2, 4);
		b.ph = rng.range(0, 6.28);
		b.pf = rng.range(1.2, 2);
		b.rate = rng.range(0.1, 0.16);
		b.w = H0.w; b.i = H0.i;
		v.bands.push_back(b);
	}
	static const uint32_t EARTH[5] = { 0x6a5238, 0x584330, 0x7a6a5c, 0x4a3a2c, 0x8a8078 };
	static const uint32_t TURF[4] = { 0x4e7a2e, 0x5f8a34, 0x3f6526, 0x6f9a3a };
	v.pull.clear();
	for (int j = 0; j < 130; j++) {
		const int kind = j % 5 == 0 ? 2 : j % 5 < 3 ? 0 : 1; // 0 earth, 1 grass, 2 glow
		PullDef d;
		d.a = rng.range(0, TAU);
		d.w = rng.range(0.7, 1.3);
		d.rate = rng.range(0.16, 0.34);
		d.ph = rng.next();
		d.dr = rng.range(-0.8, 0.9);
		d.s = kind == 0 ? rng.range(0.1, 0.26) : kind == 1 ? rng.range(0.06, 0.1) : rng.range(0.05, 0.1);
		d.sy = kind == 1 ? rng.range(2.5, 4) : 1;
		d.col = kind == 0 ? rng.pick(EARTH, 5) : rng.pick(TURF, 4);
		d.glow = kind == 2;
		d.rx = rng.range(-9, 9);
		d.rz = rng.range(-9, 9);
		v.pull.push_back(d);
	}
}

Dictionary AovGodpowerView::storm_static(int64_t id) {
	Dictionary out;
	if (sim_ref_.is_null()) return out;
	const aov::GodPowers &G = sim_ref_->sim().godpowers;
	if (id < 0 || id >= (int64_t)G.storms.size()) return out;
	const aov::Storm &st = G.storms[id];
	if ((int64_t)storms_.size() <= id) storms_.resize(id + 1);
	StormVis &v = storms_[id];
	if (!v.init) init_storm(v, st.x, st.z, st.t0, st.radius);
	PackedFloat32Array gh;
	gh.resize((int64_t)v.gh.size());
	for (size_t i = 0; i < v.gh.size(); i++) gh.set((int64_t)i, (float)v.gh[i]);
	// rainGeometry(seed, R, 420): sparse over the storm floor, a curtain round it
	aov::RNG rng((uint32_t)aov::js_int32(st.t0 * 1000));
	const int n = 420;
	const double R = st.radius;
	PackedFloat32Array rain;
	for (int i = 0; i < n; i++) {
		const bool inner = i < n * 0.15;
		const double a = rng.range(0, TAU), s = rng.next();
		const double r = inner ? std::sqrt(rng.next()) * R * 0.8 : R * (0.8 + std::sqrt(rng.next()) * 0.75);
		rain.push_back((float)(std::cos(a) * r));
		rain.push_back((float)(std::sin(a) * r));
		rain.push_back((float)s);
	}
	out["gh"] = gh;
	out["rb"] = v.rb;
	out["rt"] = v.rt;
	out["H"] = v.H;
	out["base"] = v.base;
	out["rain"] = rain;
	return out;
}

Array AovGodpowerView::pack_ribbon(const Ribbon &r, bool spark) {
	Array a;
	a.resize(Mesh::ARRAY_MAX);
	const int64_t nv = (int64_t)(r.v.size() / 3);
	PackedVector3Array v;
	v.resize(nv);
	for (int64_t i = 0; i < nv; i++) v.set(i, Vector3(r.v[i * 3], r.v[i * 3 + 1], r.v[i * 3 + 2]));
	PackedFloat32Array c0, c1;
	c0.resize((int64_t)r.c0.size());
	std::copy(r.c0.begin(), r.c0.end(), c0.ptrw());
	c1.resize((int64_t)r.c1.size());
	std::copy(r.c1.begin(), r.c1.end(), c1.ptrw());
	PackedInt32Array idx;
	idx.resize((int64_t)r.idx.size());
	std::copy(r.idx.begin(), r.idx.end(), idx.ptrw());
	a[Mesh::ARRAY_VERTEX] = v;
	a[Mesh::ARRAY_CUSTOM0] = c0;
	a[Mesh::ARRAY_CUSTOM1] = c1;
	if (spark) {
		PackedFloat32Array c2;
		c2.resize((int64_t)r.c2.size());
		std::copy(r.c2.begin(), r.c2.end(), c2.ptrw());
		a[Mesh::ARRAY_CUSTOM2] = c2;
	}
	a[Mesh::ARRAY_INDEX] = idx;
	return a;
}

PackedFloat32Array AovGodpowerView::pack_buf(const Buf &b) {
	int cap = 32;
	while (cap < b.n) cap *= 2;
	PackedFloat32Array out;
	out.resize((int64_t)cap * 20);
	float *w = out.ptrw();
	std::copy(b.d.begin(), b.d.end(), w);
	std::fill(w + b.d.size(), w + (size_t)cap * 20, 0.f);
	return out;
}

Dictionary AovGodpowerView::update(double alpha, bool paused, const Vector3 &cam) {
	Dictionary out;
	if (sim_ref_.is_null()) return out;
	const aov::Sim &SM = sim_ref_->sim();
	const aov::GodPowers &G = SM.godpowers;
	const aov::UnitStore &U = SM.entities.units;
	const double now = SM.time;
	const double ua = paused ? 1.0 : std::min(1.0, std::max(0.0, alpha));
	if (now < last_time_ - 1e-6) setup(sim_ref_); // a new game
	last_time_ = now;
	// nothing to draw: skip the whole frame (the stress scene pays nothing)
	const bool active = !G.bolts.empty() || !debris_.empty() || !sparks_.empty() || !G.scorches.empty() || !G.meteors.empty() ||
			!G.fires.empty() || !G.airborne.empty() || !G.zaps.empty() ||
			std::any_of(G.storms.begin(), G.storms.end(), [](const aov::Storm &s) { return !s.done; }) ||
			egypt_active(); // (the Egyptian powers, godpower_view_egypt.cpp)
	if (!active) {
		out["time"] = now;
		out["active"] = false;
		return out;
	}
	for (Ribbon &r : rib_) r.clear();
	for (Buf &b : inst_) b.clear();
	lights_.clear();
	pools_.clear();
	auto hat = [&](double x, double z) { return h_at(x, z); };
	auto upos = [&](int row, double &x, double &z) {
		x = U.prev_x[row] + (U.x[row] - U.prev_x[row]) * ua;
		z = U.prev_z[row] + (U.z[row] - U.prev_z[row]) * ua;
	};
	const int MAX_LIGHTS = 4;
	int li = 0;
	double flash = 0;

	// ---- crater particles: spawn for new strikes, step to now
	for (const aov::Scorch &sc : G.scorches) {
		if (sc.size > 0 && !sc.blast) continue; // fork scorches throw nothing
		if (sc.kind == 1) continue;              // (Thoth's Meteor: godpower_view_egypt.cpp thoth_fx)
		const uint64_t k = key2(sc.seed, sc.t0) ^ (sc.blast ? 0x5a5a5a5a00000000ull : 0);
		if (spawned_.count(k)) continue;
		spawned_[k] = true;
		spawn_strike(sc.x, sc.y, sc.z, sc.seed, sc.t0, sc.blast);
	}
	if (spawned_.size() > 4096) spawned_.clear();
	step_particles(now);

	// ---- bolts (freshest first)
	std::vector<int> order;
	for (int i = 0; i < (int)G.bolts.size(); i++) order.push_back(i);
	std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return G.bolts[a].t0 > G.bolts[b].t0; });
	std::vector<double> storm_hw(G.storms.size(), 0), storm_ha(G.storms.size(), 0);
	std::vector<uint64_t> alive_bolts;
	int spot_b = -1;
	double spot_env = 0;
	for (int oi = 0; oi < (int)order.size(); oi++) {
		const aov::Bolt &b = G.bolts[order[oi]];
		const double age = now - b.t0;
		if (age > b.life || age < 0) continue;
		const uint64_t key = key2(b.seed, b.t0);
		alive_bolts.push_back(key);
		auto it = bolt_cache_.find(key);
		if (it == bolt_cache_.end())
			it = bolt_cache_.emplace(key, b.sky ? sky_lines(b.seed, b.x, b.y, b.z) : bolt_lines(b.seed, b.x, b.y, b.z, hat)).first;
		const double k = age / b.life;
		if (b.sky) {
			const double env = std::pow(1 - k, 1.4) * (age < 0.06 ? 1.4 : (0.55 + 0.45 * std::abs(std::sin(age * 55 + b.seed % 7))));
			emit_lines(G_SKY, it->second, std::min(1.1, env) * 0.4);
			flash = std::max(flash, env * 0.5);
			continue;
		}
		const double env = bolt_env(age, b.life, b.seed);
		flash = std::max(flash, env);
		const double pin = age < 0.06 ? 1 : std::exp(-(age - 0.06) / 0.07);
		const double g = 0.8 + 0.35 * aov::hash2((int32_t)(b.seed & 0xffff), 91);
		const double e = std::min(1.5, env) * g;
		emit_lines(G_BOLT, it->second, std::min(1.1, env) * g);
		const Lin hot = hex_lin(0xdfe9ff), stem = hex_lin(0xf4f0ff);
		glow(true, b.x, b.y + 0.55, b.z, 0.5 + 0.5 * pin, 0.5 + 0.5 * pin, hot.r, hot.g, hot.b, 2.2 * g * pin, 2);
		// (Godot: stands in for the browser's bloom round the contact; half
		// the round-1 radius and depth tested, so it never paints over men)
		if (oi == 0) glow(true, b.x, b.y + 0.6, b.z, 2.8, 2.8, 0.85, 0.75, 1.25, 0.4 * g * std::min(1.2, env), 0);
		decal(I_DECAL_ADD, b.x, b.y + 0.08, b.z, 2.0 + 0.8 * pin, (b.seed % 628) / 100.0, 1, 1, 1,
				(float)(std::min(1.0, e * 0.7) * (0.1 + 0.9 * pin)), 1);
		const double hero = oi == 0 ? 1 : 0.35;
		const double sk = std::min(1.0, age / 0.4);
		glow(false, b.x, b.y + 1.2, b.z, 0.35 + 0.15 * pin, 2.4 + 0.6 * pin, stem.r, stem.g, stem.b,
				0.7 * g * hero * (age < 0.1 ? 1 : std::exp(-(age - 0.1) / 0.18)), 2);
		decal(I_DECAL_MIX, b.x, b.y + 0.3, b.z, 6.2, 0, 1, 1, 1,
				(float)std::min(1.0, hero * g * (age < 0.1 ? 1.3 : 1.3 * std::exp(-(age - 0.1) / 0.2))), 1, (float)sk);
		decal(I_DECAL_ADD, b.x, b.y + 0.12, b.z, 2 * (1.5 + 3.0 * std::pow(sk, 0.6)), 0, 0.95f, 0.8f, 1.6f,
				(float)(hero * 3.0 * std::pow(1 - sk, 1.2)), 2, 0.75f);
		const double snap = age < 0.1 ? 1 : std::exp(-(age - 0.1) / 0.12);
		const float pv[4] = { (float)b.x, (float)b.z, (float)(std::min(0.8, e * 0.6) * (0.15 + 0.85 * snap) * (oi == 0 ? 1 : 0.3)),
			(float)(3.4 + 1.6 * snap) };
		if (pools_.size() < 6 * 4) pools_.insert(pools_.end(), pv, pv + 4);
		for (size_t s = 0; s < G.storms.size(); s++) {
			const aov::Storm &st = G.storms[s];
			if (st.done) continue;
			const double dx = b.x - st.x, dz = b.z - st.z, d = std::hypot(dx, dz);
			const double w = std::min(1.2, env) * (0.45 + 0.55 * std::min(1.0, d / st.radius)) * std::pow(1 - k, 0.7);
			if (w > storm_hw[s]) { storm_hw[s] = w; storm_ha[s] = std::atan2(dz, dx); }
		}
		if (spot_b < 0 || env > spot_env) { spot_b = order[oi]; spot_env = env; }
		if (li < MAX_LIGHTS) {
			li++;
			const bool heroL = oi == 0;
			light(b.x, b.y + (heroL ? 2.2 : 3.2), b.z, heroL ? 0xc49cff : 0x9cbcff,
					(heroL ? 26 : 17) * std::min(1.1, e) * (0.08 + 0.92 * snap), heroL ? 11 : 10, heroL ? 1.3 : 2);
		}
	}
	for (auto it = bolt_cache_.begin(); it != bolt_cache_.end();) {
		if (std::find(alive_bolts.begin(), alive_bolts.end(), it->first) == alive_bolts.end()) it = bolt_cache_.erase(it);
		else ++it;
	}
	Array spot;
	if (spot_b >= 0) {
		const aov::Bolt &b = G.bolts[spot_b];
		spot.push_back(b.x + 0.1); spot.push_back(b.y + 2.6); spot.push_back(b.z + 0.1);
		spot.push_back(12 * std::min(1.1, spot_env));
	}

	// ---- meteors (falling)
	for (const aov::Meteor &m : G.meteors) {
		if (m.done || m.kind == 1) continue; // (Thoth's: thoth_fx)
		const double gy = h_at(m.x, m.z);
		double dx = m.x - m.sx, dy = gy - m.sy, dz = m.z - m.sz;
		const double dl = hyp3(dx, dy, dz);
		dx /= dl; dy /= dl; dz /= dl;
		std::vector<P> trail;
		for (int i = 0; i <= 10; i++) trail.push_back(P{ -dx * i * 1.1, -dy * i * 1.1, -dz * i * 1.1 });
		std::vector<Line> L;
		push(L, trail, 0.5, 1, 0.9, 1);
		push(L, trail, 1.8, 0.9, 0.8, 1, true);
		const double t = std::min(1.0, (now - m.t0) / m.delay);
		const double px = m.sx + (m.x - m.sx) * t, py = m.sy + (gy - m.sy) * t, pz = m.sz + (m.z - m.sz) * t;
		emit_lines(G_FIRE, L, 1.2, px, py, pz);
		const Lin c = hex_lin(0xffc070);
		const double s = 5 + std::sin(now * 40) * 0.6;
		glow(false, px, py, pz, s, s, c.r, c.g, c.b, 1, 0);
		const Lin wc = hex_lin(0xff8a30);
		const double R1 = (m.radius + 0.5) * (1.6 - t * 0.6);
		decal(I_DECAL_ADD, m.x, gy + 0.2, m.z, 2 * R1, 0, wc.r, wc.g, wc.b, (float)(std::min(1.0, t * 3) * 0.8), 3,
				(float)((m.radius - 0.5) / (m.radius + 0.5)), (float)std::fmod(now, 1000.0));
		if (li < MAX_LIGHTS) { li++; light(px, py, pz, 0xff9a40, 40, 16, 2); }
		// the flame trail and smoke puffed out along the fall (index.js update)
		const int64_t t1 = (int64_t)std::floor(now * 30), t0t = (int64_t)std::ceil(m.t0 * 30);
		for (int64_t n = std::max(t0t, t1 - 45); n <= t1; n++) {
			const double te = n / 30.0, kk = std::min(1.0, (te - m.t0) / m.delay);
			const double qx = m.sx + (m.x - m.sx) * kk, qy = m.sy + (gy - m.sy) * kk, qz = m.sz + (m.z - m.sz) * kk;
			puff(true, te, mix3((uint32_t)n, 0x3e7e0u, 1), now, qx, qy, qz, 6, 0xff8a30, 0.9, 0.5, 0.6, 0.3, 0, 1.2, 0.5);
			puff(false, te, mix3((uint32_t)n, 0x3e7e0u, 2), now, qx, qy, qz, 3, 0x3a3430, 1.0, 1.4, 0.4, 0.3, 0.4, 2.5, 0.6);
		}
	}

	// ---- scorch decals, cooling ember cracks, meteor blast flash, crater smoke
	for (size_t si = 0; si < G.scorches.size(); si++) {
		const aov::Scorch &sc = G.scorches[si];
		const double age = now - sc.t0;
		if (age < 0 || sc.kind == 1) continue; // (Thoth's craters: thoth_fx)
		const double size = sc.size > 0 ? sc.size : 5.2;
		const double op = std::max(0.0, 1 - std::max(0.0, age - 8) / 6);
		decal(I_DECAL_MIX, sc.x, sc.y + 0.04, sc.z, size, (sc.seed % 628) / 100.0, 1, 1, 1, (float)op, 0, (float)((sc.seed % 1000) / 1000.0),
				sc.blast ? 1.f : 0.f);
		const double heat = std::exp(-age / (sc.blast ? 2.5 : 1.6));
		float er, eg, eb;
		if (sc.blast) { er = (float)(0.5 + 0.7 * heat); eg = (float)(0.12 + heat * 0.45); eb = (float)(0.04 + heat * 0.35); }
		else {
			// (Godot: the fused cracks cool from blue-white through
			// yellow-orange to a dull red that glows for as long as the scorch
			// lasts, so every strike point reads as hot damage, not dirt)
			const double w = std::max(0.0, 1 - age / 0.3) * 0.8;
			// (kept below ~2 in linear so the tonemapper leaves them saturated
			// orange / red instead of washing them to peach)
			const double t = std::exp(-age / 1.4), q = sc.size > 0 ? 0.7 : 1.0;
			const double cr = q * (1.25 + 0.5 * t), cg = q * (0.04 + 0.26 * t), cb = q * (0.03 + 0.02 * t);
			er = (float)(cr + (1.8 - cr) * w);
			eg = (float)(cg + (2.3 - cg) * w);
			eb = (float)(cb + (3.4 - cb) * w);
		}
		const double eo = sc.blast ? std::min(1.0, heat * 0.9) : std::min(1.0, 0.95 * op);
		if (eo > 0.01)
			decal(I_DECAL_ADD, sc.x, sc.y + 0.06, sc.z, size * (sc.blast ? 0.5 : 0.62), ((sc.seed >> 3) % 628) / 100.0, er, eg, eb, (float)eo, 0,
					(float)((sc.seed % 977) / 977.0));
		if (!sc.blast) {
			// (Godot) the impact ring: a crisp white-violet ring racing out
			// over the ground from each strike point, then a hot orange rim
			// that stays at the crater edge while it cools
			const double big = sc.size > 0 ? 0.55 : 1.0;
			const double rk = std::min(1.0, age / 1.0);
			if (rk < 1) {
				const double rad = big * (0.8 + 2.6 * (1 - std::pow(1 - rk, 2.4)));
				decal(I_DECAL_ADD, sc.x, sc.y + 0.14, sc.z, 2 * rad, 0, 1.9f, 1.75f, 2.6f,
						(float)(std::pow(1 - rk, 0.9) * 3.0), 4, (float)(0.09 + 0.05 * rk), (float)((sc.seed % 811) / 811.0));
			}
			const double rim = std::exp(-age / 3.0) * 0.8 + 0.25;
			decal(I_DECAL_ADD, sc.x, sc.y + 0.1, sc.z, size * 0.46, (sc.seed % 311) / 50.0, 1.7f, 0.32f, 0.06f, (float)(0.8 * rim * op * (1 - 0.6 * std::max(0.0, 1 - age / 0.3))), 4, 0.12f,
					(float)((sc.seed % 523) / 523.0));
		}
		if (sc.blast) {
			const double k = std::min(1.0, age / 0.7);
			const Lin gc = hex_lin(0xffa050), rc = hex_lin(0xffa060);
			glow(false, sc.x, sc.y + 1.5, sc.z, 6 + 8 * k, 6 + 8 * k, gc.r, gc.g, gc.b, std::pow(std::max(0.0, 1 - k), 2) * 0.7, 0);
			if (k < 1) decal(I_DECAL_ADD, sc.x, sc.y + 0.2, sc.z, 2 * (1 + k * 9), 0, rc.r, rc.g, rc.b, (float)((1 - k) * 2.5), 2, 0.75f);
			if (age < 0.8 && li < MAX_LIGHTS) { li++; light(sc.x, sc.y + 3, sc.z, 0xff9040, 60 * (1 - k), 16, 2); }
			// impactMeteor's bursts
			const uint32_t s0 = sc.seed;
			puff(true, sc.t0, mix3(s0, 1, 9), now, sc.x, sc.y + 0.6, sc.z, 90, 0xffb040, 0.55, 0.8, 11, 7, -10, 0, 0.8);
			puff(true, sc.t0, mix3(s0, 2, 9), now, sc.x, sc.y + 1.0, sc.z, 30, 0xff5a18, 1.4, 0.7, 4, 3, 1, 1.5, 1);
			puff(false, sc.t0, mix3(s0, 3, 9), now, sc.x, sc.y + 0.4, sc.z, 40, 0x4a3a2a, 0.3, 1.4, 8, 10, -18, 0, 1);
			puff(false, sc.t0, mix3(s0, 4, 9), now, sc.x, sc.y + 0.5, sc.z, 30, 0x3c3632, 1.4, 3.0, 2.5, 2.2, 0.8, 3, 1.5);
		} else if (sc.size <= 0) {
			// the strike's smoke puff, then the crater smokes for a few seconds
			puff(false, sc.t0, mix3(sc.seed, 7, 3), now, sc.x, sc.y + 0.2, sc.z, 5, 0x2a2622, 0.42, 1.0, 2.0, 1.2, 0.6, 1.5, 0.35);
			const int64_t t1 = (int64_t)std::floor(now * 30 + 1e-6), t0t = (int64_t)std::ceil(sc.t0 * 30 - 1e-6);
			for (int64_t n = std::max(t0t, t1 - 58); n <= t1; n++) {
				const double te = n / 30.0, a2 = te - sc.t0;
				if (a2 > 5) break;
				const double k = 1 - a2 / 5;
				aov::RNG r(mix3(sc.seed, (uint32_t)n, 11));
				if (!(r.next() < 0.04 + 0.12 * k)) continue;
				const double ox = r.range(-0.4, 0.4), oz = r.range(-0.4, 0.4);
				puff(false, te, mix3(sc.seed, (uint32_t)n, 12), now, sc.x + ox, sc.y + 0.3, sc.z + oz, 1, r.chance(0.5) ? 0x2a2826 : 0x34302d,
						0.4 + 0.25 * k, 1.6, 0.25, 1.3, 0.9, 1.5, 0.3);
			}
		}
	}

	// ---- burning meteor craters: flames, a hot heart, black smoke, a warm light
	for (size_t fi = 0; fi < G.fires.size(); fi++) {
		const aov::Fire &f = G.fires[fi];
		const double age = now - f.t0;
		if (age < 0 || age > f.dur + 4 || f.kind == 1) continue; // (Thoth's: thoth_fx)
		if (age <= f.dur && li < MAX_LIGHTS) {
			li++;
			const int32_t fl = (int32_t)std::floor(now * 14);
			const double fk = std::max(0.0, 1 - age / f.dur);
			light(f.x + (aov::hash2(fl, 1) - 0.5) * 0.6, f.y + 2.4, f.z + (aov::hash2(fl, 2) - 0.5) * 0.6, 0xff7a2a,
					16 * fk * (0.8 + 0.4 * aov::hash2(fl, 3)), 10, 2);
		}
		const int64_t t1 = (int64_t)std::floor(now * 30 + 1e-6), t0t = (int64_t)std::ceil(f.t0 * 30 - 1e-6);
		for (int64_t n = std::max(t0t, t1 - 116); n <= t1; n++) {
			const double te = n / 30.0, a2 = te - f.t0;
			if (a2 > f.dur) break;
			const double k = 1 - a2 / f.dur;
			aov::RNG r(mix3((uint32_t)fi * 7919u + 17u, (uint32_t)n, 21));
			const bool recent = now - te < 1.1;
			for (int j = 0; j < 5; j++) {
				const double a = r.range(0, TAU), rr = std::sqrt(r.next()) * f.r * 0.8;
				const double fx = f.x + std::cos(a) * rr, fz = f.z + std::sin(a) * rr;
				const double yy = r.range(0, 2.4);
				if (!recent) continue;
				const double fy = h_at(fx, fz);
				puff(true, te, mix3((uint32_t)fi, (uint32_t)n, 30 + j), now, fx, fy + 0.3 + yy * (1 - rr / f.r), fz, (int)std::ceil(5 * k),
						(j & 1) ? 0xff7a20 : 0xff5a10, 1.35, 0.9, 0.35, 3.6, 2.2, -0.55, 0.45);
			}
			const double hx = r.range(-1, 1), hz = r.range(-1, 1);
			if (recent)
				puff(true, te, mix3((uint32_t)fi, (uint32_t)n, 40), now, f.x + hx, f.y + 0.4, f.z + hz, (int)std::ceil(2 * k), 0xffc050, 0.8,
						0.6, 0.3, 3.8, 2, -0.6, 0.6);
			if (r.chance(0.7 * k)) {
				const double sx = r.range(-1.5, 1.5), sz = r.range(-1.5, 1.5);
				puff(false, te, mix3((uint32_t)fi, (uint32_t)n, 41), now, f.x + sx, f.y + 2.2, f.z + sz, 1, r.chance(0.5) ? 0x1e1b1a : 0x2e2a28,
						1.6, 3.2, 0.3, 2.4, 0.5, 2.4, 0);
			}
		}
	}
	Dictionary egypt; // (the Egyptian powers: godpower_view_egypt.cpp; their state for game/godpowers/egypt_fx.gd)
	egypt_fx(now, ua, cam, li, egypt);
	for (; li < MAX_LIGHTS; li++) light(0, -100, 0, 0, 0, 1, 2);

	// ---- zaps on struck units
	for (const aov::Zap &z : G.zaps) {
		const double age = now - z.t0;
		if (age < 0 || age > z.life) continue;
		const int row = z.unit > 0 ? SM.entities.unit_slot(z.unit) : -1;
		double x = z.x, y = z.y, zz = z.z, h = 1.8 * 0.8;
		if (row >= 0) {
			upos(row, x, zz);
			y = h_at(x, zz) + U.air_y[row];
			h = unit_height(U.type[row]) * 0.8;
		}
		const uint64_t key = key2(z.seed, z.t0);
		auto it = zap_cache_.find(key);
		if (it == zap_cache_.end()) it = zap_cache_.emplace(key, zap_lines(z.seed, h)).first;
		const double k = age / z.life;
		const int32_t f = (int32_t)std::floor(now * 30);
		const double rot = f * 2.1 + (double)z.seed;
		const double sy = 0.8 + aov::hash2(f, (int32_t)z.seed) * 0.4;
		emit_lines(G_ZAP, it->second, (1 - k) * (aov::hash2(f, (int32_t)z.seed, 3) > 0.3 ? 1 : 0.3) * 0.6, x, y, zz, std::fmod(rot, TAU), sy);
		double cx = x - cam.x, cz = zz - cam.z;
		const double cl = std::max(1e-6, std::hypot(cx, cz));
		cx = cx / cl * 0.55; cz = cz / cl * 0.55;
		const Lin rc = hex_lin(0x5f9cff);
		glow(true, x + cx, y + h * 0.55, zz + cz, h * 1.4, h * 1.4, rc.r, rc.g, rc.b, std::pow(1 - k, 1.3) * 0.28, 0);
	}
	if (zap_cache_.size() > 256) zap_cache_.clear();

	// ---- storms
	Array storms_out;
	double gradeK = 0;
	int gst = -1;
	if (storms_.size() < G.storms.size()) storms_.resize(G.storms.size());
	int rims = 0;
	for (size_t s = 0; s < G.storms.size(); s++) {
		const aov::Storm &st = G.storms[s];
		if (st.done) continue;
		StormVis &v = storms_[s];
		if (!v.init) init_storm(v, st.x, st.z, st.t0, st.radius);
		const double k = std::min(1.0, (now - st.t0) / 1.0) * std::min(1.0, std::max(0.0, (st.t0 + st.duration - now) / 1.5));
		if (k <= 0) continue;
		const double fl = std::min(1.5, flash);
		if (k >= gradeK) { gradeK = k; gst = (int)s; }
		const double hw = storm_hw[s];
		if (hw >= v.hot_w * 0.8 && hw > 0) { v.hot_w = hw; v.hot_a = storm_ha[s]; }
		else v.hot_w *= 0.9;
		const int NA = (int)v.gh.size();
		auto ghAt = [&](double a) {
			const double f = std::fmod(std::fmod(a, TAU) + TAU, TAU) / TAU * NA;
			const int i = (int)std::floor(f);
			const double t = f - i;
			return v.gh[i % NA] * (1 - t) + v.gh[(i + 1) % NA] * t;
		};
		const double cd = std::atan2(cam.z - st.z, cam.x - st.x);
		// energy bands spiralling up the funnel, with dust and turf riding them
		for (const BandDef &b : v.bands) {
			const double head = b.a0 + b.sp * now;
			const double da = std::abs(std::fmod(std::fmod(head - v.hot_a, TAU) + TAU * 1.5, TAU) - PI);
			const double pulse = 0.55 + 0.45 * std::pow(0.5 + 0.5 * std::sin(now * b.pf + b.ph), 1.5);
			const double i = b.i * k * pulse * (0.8 + 0.7 * v.hot_w * std::exp(-da * da * 1.5) + 0.15 * std::min(1.0, fl));
			if (i < 0.02) continue;
			const double cyc = std::fmod(now * b.rate + b.ph / TAU, 1.0);
			const double hHead = b.h0 + cyc * (1.05 - b.h0);
			const double ii = i * std::min(1.0, cyc * 6) * (1 - sstep(0.7, 1.05, hHead));
			if (ii < 0.02) continue;
			std::vector<P> pts;
			const int n = 56;
			for (int q = 0; q <= n; q++) {
				const double f = (double)q / n, a = head - b.span * f;
				const double hf = std::max(0.0, hHead - b.climb * f);
				const double r = funnel_r(v.rb, v.rt, hf) + b.dr + 0.22 * std::sin(a * 3 + now * 2.1 + b.ph) + 0.08 * std::sin(a * 11 - now * 5 + b.ph * 2);
				const double g = ghAt(a);
				const double face = std::cos(a - cd);
				const double fr = sstep(-0.75, 0.85, face);
				const double rim = std::pow(1 - std::abs(face), 1.4);
				const double lead = sstep(0, 0.05, f) * (1 + 0.5 * std::exp(-f * 14));
				P p{ st.x + std::cos(a) * r,
					g + (v.base - g) * std::min(1.0, hf * 2.5) + 0.15 + hf * v.H + b.ya * std::sin(a * b.yf + now * 2.3 + b.ph),
					st.z + std::sin(a) * r };
				p.m = (float)((0.22 + 0.1 * fr + 0.95 * rim) * (1 + 2.2 * std::exp(-f * 10)));
				p.wm = (float)(lead * (0.75 + 0.45 * rim) * (0.85 + 0.4 * hf));
				pts.push_back(p);
			}
			std::vector<Line> L;
			push(L, pts, b.w, 0.75 * ii, 0.97, 1);
			push(L, pts, b.w * 2.0, 0.3 * ii, 0.9, 0.97, true);
			emit_lines(b.layer ? G_BAND2 : G_BAND, L, 1);
			static const int NR[4] = { 26, 16, 8, 4 };
			const int nr = b.hero < 4 ? NR[b.hero] : 0;
			for (int q = 0; q < nr; q++) {
				const double hq = aov::hash2(q + 17, b.hero + 3);
				const double f = std::fmod(hq + now * (0.35 + 0.2 * aov::hash2(q, b.hero, 5)), 1.0) * 0.75;
				const P &p = pts[std::min(n, (int)std::floor(f * n + 0.5))];
				const double jit = (aov::hash2(q, b.hero, 9) - 0.5) * (0.9 + b.w * 2), jy = (aov::hash2(q, b.hero, 11) - 0.5) * (0.6 + b.w * 2);
				const double a = head - b.span * f;
				const int kind = q % 3;
				const double sz = (kind == 0 ? 0.1 + 0.14 * hq : kind == 1 ? 0.12 + 0.06 * hq : 0.05 + 0.04 * hq) * (0.7 + b.w) *
						std::min(1.0, ii * 1.5) * sstep(0.75, 0.55, f);
				if (sz <= 0.01) continue;
				const double px = p.x + std::cos(a) * jit, py = p.y + jy, pz = p.z + std::sin(a) * jit;
				const double sy = kind == 1 ? 0.18 : 1, sx = kind == 1 ? 1.6 : 1;
				if (kind == 2 && q % 2 == 0) {
					cube(I_EMBER, px, py, pz, now * (4 + q % 5) + q, a, now * (3 + q % 4) - q, sz * sx, sz * sy, sz, 1.6f, 0.9f, 3.2f);
				} else {
					const uint32_t col = kind == 0 ? ((q & 4) ? 0x6a5238 : 0x4a3a2c) : kind == 1 ? ((q & 4) ? 0x5f8a34 : 0x86a03a) : 0x9a8a7a;
					const Lin c = hex_lin(col);
					cube(I_DEBRIS, px, py, pz, now * (4 + q % 5) + q, a, now * (3 + q % 4) - q, sz * sx, sz * sy, sz, c.r, c.g, c.b);
				}
			}
		}
		// debris torn up and whirled round the funnel
		if (k > 0.05) {
			for (const PullDef &d : v.pull) {
				const double u = std::fmod(now * d.rate + d.ph, 1.0);
				const double hf = std::pow(u, 1.3) * 0.85;
				const double a = d.a + d.w * now + u * 5.5;
				const double r = funnel_r(v.rb, v.rt, hf) + d.dr * (1 - 0.5 * u);
				const int gi = (int)std::floor(std::fmod(std::fmod(a, TAU) + TAU, TAU) / TAU * NA) % NA;
				const double g = v.gh[gi];
				const double sz = d.s * (1 - u * 0.4) * std::min(1.0, k * 1.5) * std::min(1.0, (1 - u) * 5) * std::min(1.0, u * 12);
				if (sz <= 0.01) continue;
				const double px = st.x + std::cos(a) * r, py = g + (v.base - g) * std::min(1.0, hf * 2.5) + 0.1 + hf * v.H, pz = st.z + std::sin(a) * r;
				if (d.glow) cube(I_EMBER, px, py, pz, d.rx * now, a, d.rz * now, sz, sz * d.sy, sz, 1.6f, 0.9f, 3.2f);
				else {
					const Lin c = hex_lin(d.col);
					cube(I_DEBRIS, px, py, pz, d.rx * now, a, d.rz * now, sz, sz * d.sy, sz, c.r, c.g, c.b);
				}
			}
		}
		// trails and back lights of the men carried round the funnel
		for (int32_t id : G.airborne) {
			const int row = SM.entities.unit_slot(id);
			if (row < 0 || U.dead[row] || U.removed[row]) continue;
			const bool carried = U.gp_storm[row] == (int32_t)s && !U.gp_flung[row];
			if (!carried && !U.gp_flung[row]) continue;
			const double ay = U.air_y[row];
			if (ay < 0.4) continue;
			const double airt = now - U.gp_t0[row];
			double x, z;
			upos(row, x, z);
			const int ns = (int)std::min(12.0, std::floor(std::max(0.0, airt) * 30) + 1);
			if (ns < 4 && carried) continue;
			std::vector<P> pts;
			double dx = x - st.x, dz = z - st.z, dd = std::hypot(dx, dz);
			if (dd < 0.05) { dx = 1; dz = 0; dd = 1; }
			const double ux = dx / dd, uz = dz / dd;
			const double vt = U.gp_vx[row] * -uz + U.gp_vz[row] * ux, vr = U.gp_vx[row] * ux + U.gp_vz[row] * uz;
			const double ang0 = std::atan2(dz, dx), om = vt / dd;
			for (int q = 0; q < std::max(ns, 4); q++) {
				const double tau = q * DT;
				double px, pz, py;
				if (carried) {
					const double an = ang0 - om * tau, rr = dd - vr * tau;
					px = st.x + std::cos(an) * rr; pz = st.z + std::sin(an) * rr;
					py = std::max(0.0, ay - U.gp_vy[row] * tau);
				} else {
					px = x - U.gp_vx[row] * tau; pz = z - U.gp_vz[row] * tau;
					py = std::max(0.0, ay - U.gp_vy[row] * tau - 9 * tau * tau);
				}
				pts.push_back(P{ px, h_at(px, pz) + py + 0.7, pz });
			}
			const double i0 = 0.8 * k * std::min(1.0, ay / 1.5);
			std::vector<Line> L;
			push(L, pts, 0.15, i0 * 1.3, 0.9, 1);
			push(L, pts, 0.55, i0 * 0.5, 0.8, 1, true);
			emit_lines(G_TRAIL, L, 1);
			if (rims < 24) {
				rims++;
				double cx = pts[0].x - cam.x, cz = pts[0].z - cam.z;
				const double cl = std::max(1e-6, std::hypot(cx, cz));
				const Lin rc = hex_lin(0xc8d8ff);
				glow(true, pts[0].x + cx / cl * 0.6, pts[0].y + 0.1, pts[0].z + cz / cl * 0.6, 2.0, 2.0, rc.r, rc.g, rc.b,
						0.75 * k * std::min(1.0, ay / 1.5), 0);
			}
		}
		Dictionary sd;
		sd["id"] = (int64_t)s;
		sd["x"] = st.x;
		sd["z"] = st.z;
		sd["y"] = h_at(st.x, st.z);
		sd["k"] = k;
		sd["rb"] = v.rb;
		sd["hot_a"] = v.hot_a;
		sd["hot_w"] = v.hot_w;
		sd["t0"] = st.t0;
		storms_out.push_back(sd);
	}

	// ---- thrown crater debris and embers
	for (const Debris &d : debris_) {
		const double fade = d.settled ? std::min(1.0, std::max(0.0, (d.die - now) / 1.5)) : 1;
		if (fade <= 0) continue;
		const double hot = d.ember ? std::max(0.0, 1 - (now - d.t0) / d.cool) : 0;
		const double lx = d.px + (d.x - d.px) * ua, ly = d.py + (d.y - d.py) * ua, lz = d.pz + (d.z - d.pz) * ua;
		if (d.ember && hot > 0.05) {
			if (d.blue) cube(I_EMBER, lx, ly, lz, d.rx, d.ry, d.rz, d.s, d.s, d.s, (float)(1.6 * hot * hot + 0.05), (float)(2.2 * hot * hot + 0.12), (float)(3.2 * hot + 0.3));
			else cube(I_EMBER, lx, ly, lz, d.rx, d.ry, d.rz, d.s, d.s, d.s, (float)(4.5 * hot + 0.3), (float)(1.6 * hot * hot + 0.1), (float)(0.25 * hot));
		} else {
			const Lin c = hex_lin(d.color);
			cube(I_DEBRIS, lx, ly - (1 - fade) * d.s, lz, d.rx, d.ry, d.rz, d.s, d.s, d.s, c.r, c.g, c.b);
		}
	}

	// ---- spark streaks
	{
		Ribbon &R = rib_[G_SPARK];
		int n = 0;
		for (const Spark &p : sparks_) {
			if (n >= 256) break;
			const double k = (now - p.t0) / p.life;
			if (k < 0 || k >= 1) continue;
			const double T = p.heat * std::pow(1 - k, 0.8) * p.dim;
			float cr, cg, cb;
			spark_color(T, cr, cg, cb);
			const double sp = hyp3(p.vx, p.vy, p.vz), L = std::max(0.18, std::min(1.5, sp * 0.08)) / std::max(1e-3, sp);
			const double tx = -p.vx * L, ty = -p.vy * L, tz = -p.vz * L;
			const double ww = 0.09 * (0.6 + 0.6 * (1 - k));
			const double hx = p.px + (p.x - p.px) * ua, hy = p.py + (p.y - p.py) * ua, hz = p.pz + (p.z - p.pz) * ua;
			const int32_t base = n * 4;
			for (int e = 0; e < 2; e++) {
				for (int sd = -1; sd <= 1; sd += 2) {
					R.v.push_back((float)(hx + tx * e)); R.v.push_back((float)(hy + ty * e)); R.v.push_back((float)(hz + tz * e));
					R.c0.push_back((float)sd); R.c0.push_back((float)(ww * (1 - e * 0.5))); R.c0.push_back((float)e); R.c0.push_back(0);
					R.c1.push_back((float)tx); R.c1.push_back((float)ty); R.c1.push_back((float)tz); R.c1.push_back(0);
					R.c2.push_back(cr); R.c2.push_back(cg); R.c2.push_back(cb); R.c2.push_back(1);
				}
			}
			R.idx.push_back(base); R.idx.push_back(base + 1); R.idx.push_back(base + 3);
			R.idx.push_back(base); R.idx.push_back(base + 3); R.idx.push_back(base + 2);
			n++;
		}
	}

	// ---- drop shadows under the men in the air
	{
		int n = 0;
		for (int32_t id : G.airborne) {
			if (n >= 48) break;
			const int row = SM.entities.unit_slot(id);
			if (row < 0 || U.dead[row] || U.removed[row]) continue;
			const double h = U.air_y[row];
			if (!(h > 0.15)) continue;
			double x, z;
			upos(row, x, z);
			decal(I_DECAL_MUL, x, h_at(x, z) + 0.07, z, 0.85 + h * 0.09, 0, 1, 1, 1, (float)(0.8 * std::max(0.35, 1 - h / 14)), 0);
			n++;
		}
	}

	// ---- storm lights: one high over the heart pulsing with the strikes, one circling inside
	Dictionary storm;
	storm["k"] = gradeK;
	if (gst >= 0) {
		const aov::Storm &st = G.storms[gst];
		const StormVis &v = storms_[gst];
		const double gy = h_at(st.x, st.z);
		storm["x"] = st.x;
		storm["z"] = st.z;
		storm["y"] = gy;
		storm["rb"] = v.rb;
		storm["id"] = (int64_t)gst;
		light(st.x, gy + 24, st.z, 0xbca4ff, gradeK * (3 + 6 * std::min(1.2, flash)), 0, 0.9);
		const double a = now * 2.0 + PI, r = v.rb * (0.45 + 0.1 * std::sin(now * 1.3 + 1));
		const double px = st.x + std::cos(a) * r, pz = st.z + std::sin(a) * r;
		light(px, h_at(px, pz) + 5, pz, 0x9a60ff, 7 * gradeK * (0.85 + 0.15 * std::sin(now * 7 + 2)) + 10 * std::min(1.0, flash), 14, 1.6);
	} else {
		light(0, -100, 0, 0, 0, 1, 2);
		light(0, -100, 0, 0, 0, 1, 2);
	}

	Array ribbons;
	for (int g = 0; g < G_COUNT; g++) {
		if (rib_[g].idx.empty()) ribbons.push_back(Variant());
		else ribbons.push_back(pack_ribbon(rib_[g], g == G_SPARK));
	}
	Array insts;
	PackedInt32Array counts;
	for (int k = 0; k < I_COUNT; k++) {
		insts.push_back(pack_buf(inst_[k]));
		counts.push_back(inst_[k].n);
	}
	PackedFloat32Array lights, pools;
	for (float f : lights_) lights.push_back(f);
	for (float f : pools_) pools.push_back(f);
	out["time"] = now;
	out["ribbons"] = ribbons;
	out["inst"] = insts;
	out["counts"] = counts;
	out["lights"] = lights;
	out["spot"] = spot;
	out["pools"] = pools;
	out["flash"] = std::min(1.5, flash);
	out["storm"] = storm;
	out["storms"] = storms_out;
	out["egypt"] = egypt;
	out["active"] = true;
	return out;
}
