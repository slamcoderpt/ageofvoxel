// Seeded deterministic random numbers: bit-exact port of src/core/rng.js.
// Never use rand()/time inside the simulation.
#pragma once
#include <cmath>
#include <cstdint>

namespace aov {

// JS Math.round: floor(x + 0.5)
inline double js_round(double x) { return std::floor(x + 0.5); }
// JS ToInt32 of an integral double (wraps like `x | 0`)
inline int32_t js_int32(double x) {
	double m = std::fmod(std::trunc(x), 4294967296.0);
	if (m < 0) m += 4294967296.0;
	return (int32_t)(uint32_t)m;
}

struct Mulberry32 {
	uint32_t a;
	explicit Mulberry32(uint32_t seed = 1) : a(seed) {}
	double next() {
		a += 0x6d2b79f5u;
		uint32_t t = a;
		t = (t ^ (t >> 15)) * (t | 1u);
		t ^= t + (t ^ (t >> 7)) * (t | 61u);
		return (double)(t ^ (t >> 14)) / 4294967296.0;
	}
};

class RNG {
public:
	uint32_t seed;
	explicit RNG(uint32_t s = 1) : seed(s), m_(s) {}
	double next() { return m_.next(); }
	double range(double a, double b) { return a + (b - a) * m_.next(); }
	int int_(int a, int b) { return (int)std::floor(range(a, (double)b + 1)); } // inclusive
	bool chance(double p) { return m_.next() < p; }
	template <class T> const T &pick(const T *arr, int n) { return arr[(int)std::floor(m_.next() * n)]; }
	RNG fork(uint32_t salt) const {
		// (this.seed * 2654435761 + salt * 97531) >>> 0, evaluated in doubles like JS
		double v = (double)seed * 2654435761.0 + (double)salt * 97531.0;
		return RNG((uint32_t)js_int32(v));
	}

private:
	Mulberry32 m_;
};

// Stateless integer hash -> [0,1).
inline double hash2(int32_t x, int32_t y, int32_t s = 0) {
	// JS: (x * 374761393 + y * 668265263 + s * 2147483647) | 0 in doubles
	double d = (double)x * 374761393.0 + (double)y * 668265263.0 + (double)s * 2147483647.0;
	uint32_t h = (uint32_t)js_int32(d);
	h = (h ^ (h >> 13)) * 1274126177u;
	h ^= h >> 16;
	return (double)h / 4294967296.0;
}
inline double hash3(int32_t x, int32_t y, int32_t z, int32_t s = 0) {
	return hash2(x * 31 + z * 7919, y * 17 + z * 131, s);
}

// Seeded 2D value noise + fBm (makeNoise2D).
class Noise2D {
public:
	explicit Noise2D(uint32_t seed) {
		Mulberry32 rnd(seed);
		for (int i = 0; i < 256; i++) {
			perm_[i] = (uint16_t)i;
			vals_[i] = (float)rnd.next(); // Float32Array in JS
		}
		for (int i = 255; i > 0; i--) {
			int j = (int)std::floor(rnd.next() * (i + 1));
			uint16_t t = perm_[i];
			perm_[i] = perm_[j];
			perm_[j] = t;
		}
		for (int i = 0; i < 256; i++) perm_[i + 256] = perm_[i];
	}
	double noise(double x, double y) const {
		double xi = std::floor(x), yi = std::floor(y);
		double xf = x - xi, yf = y - yi;
		int32_t ix = js_int32(xi), iy = js_int32(yi);
		double a = v(ix, iy), b = v(ix + 1, iy), c = v(ix, iy + 1), d = v(ix + 1, iy + 1);
		double u = s(xf), w = s(yf);
		return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
	}
	double fbm(double x, double y, int oct = 4, double lac = 2, double gain = 0.5) const {
		double amp = 1, f = 1, sum = 0, norm = 0;
		for (int i = 0; i < oct; i++) {
			sum += amp * noise(x * f, y * f);
			norm += amp;
			amp *= gain;
			f *= lac;
		}
		return sum / norm;
	}

private:
	uint16_t perm_[512];
	float vals_[256];
	double v(int32_t x, int32_t y) const { return vals_[perm_[(perm_[x & 255] + y) & 511] & 255]; }
	static double s(double t) { return t * t * (3 - 2 * t); }
};

} // namespace aov
