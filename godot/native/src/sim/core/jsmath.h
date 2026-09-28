// Bit-exact ports of the V8 (JavaScript) Math functions the simulation uses.
// glibc's atan2/sin/cos differ from V8 in the last bit for a few percent of
// inputs (checked over 2M samples), which is enough to make a C++ battle
// drift away from the browser one. V8 implements them with fdlibm 5.3
// (src/base/ieee754.cc) and Math.hypot with a scaled Kahan sum; these are
// faithful ports. Compile without FMA contraction (SConstruct: -ffp-contract=off).
#pragma once
#include <cmath>
#include <cstdint>
#include <cstring>

namespace aov {
namespace jsm {

inline int32_t hi_word(double x) { uint64_t b; std::memcpy(&b, &x, 8); return (int32_t)(b >> 32); }
inline uint32_t lo_word(double x) { uint64_t b; std::memcpy(&b, &x, 8); return (uint32_t)b; }
inline double from_words(uint32_t hi, uint32_t lo) { uint64_t b = ((uint64_t)hi << 32) | lo; double d; std::memcpy(&d, &b, 8); return d; }

inline double kernel_cos(double x, double y) {
	const double one = 1.0, C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
				 C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
	int32_t ix = hi_word(x) & 0x7fffffff;
	if (ix < 0x3e400000) {
		if ((int)x == 0) return one;
	}
	double z = x * x;
	double r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
	if (ix < 0x3FD33333) return one - (0.5 * z - (z * r - x * y));
	double qx;
	if (ix > 0x3fe90000) qx = 0.28125;
	else qx = from_words((uint32_t)(ix - 0x00200000), 0);
	double hz = 0.5 * z - qx;
	double a = one - qx;
	return a - (hz - (z * r - x * y));
}

inline double kernel_sin(double x, double y, int iy) {
	const double half = 0.5, S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
				 S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
	int32_t ix = hi_word(x) & 0x7fffffff;
	if (ix < 0x3e400000) {
		if ((int)x == 0) return x;
	}
	double z = x * x;
	double v = z * x;
	double r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
	if (iy == 0) return x + v * (S1 + z * r);
	return x - ((z * (half * y - v * r) - y) - v * S1);
}

// Returns n (quadrant), y[0] + y[1] = x - n*pi/2. Large |x| (>= 2^19*pi/2,
// never reached by the sim) falls back to libm.
inline int32_t rem_pio2(double x, double *y) {
	static const int32_t npio2_hw[] = { 0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
		0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A,
		0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
		0x404858EB, 0x404921FB };
	const double half = 0.5, invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
				 pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
				 pio2_3t = 8.47842766036889956997e-32;
	int32_t hx = hi_word(x);
	int32_t ix = hx & 0x7fffffff;
	if (ix <= 0x3fe921fb) { y[0] = x; y[1] = 0; return 0; }
	if (ix < 0x4002d97c) {
		double z;
		if (hx > 0) {
			z = x - pio2_1;
			if (ix != 0x3ff921fb) { y[0] = z - pio2_1t; y[1] = (z - y[0]) - pio2_1t; }
			else { z -= pio2_2; y[0] = z - pio2_2t; y[1] = (z - y[0]) - pio2_2t; }
			return 1;
		}
		z = x + pio2_1;
		if (ix != 0x3ff921fb) { y[0] = z + pio2_1t; y[1] = (z - y[0]) + pio2_1t; }
		else { z += pio2_2; y[0] = z + pio2_2t; y[1] = (z - y[0]) + pio2_2t; }
		return -1;
	}
	if (ix <= 0x413921fb) {
		double t = std::fabs(x);
		int32_t n = (int32_t)(t * invpio2 + half);
		double fn = (double)n;
		double r = t - fn * pio2_1;
		double w = fn * pio2_1t;
		if (n < 32 && ix != npio2_hw[n - 1]) {
			y[0] = r - w;
		} else {
			int32_t j = ix >> 20;
			y[0] = r - w;
			int32_t i = j - ((hi_word(y[0]) >> 20) & 0x7ff);
			if (i > 16) {
				t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); y[0] = r - w;
				i = j - ((hi_word(y[0]) >> 20) & 0x7ff);
				if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); y[0] = r - w; }
			}
		}
		y[1] = (r - y[0]) - w;
		if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
		return n;
	}
	// huge arguments: not bit-exact, never used by the sim
	double q = std::remainder(x, 1.5707963267948966);
	int32_t n = (int32_t)std::nearbyint((x - q) / 1.5707963267948966);
	y[0] = q; y[1] = 0;
	return n;
}

inline double cos(double x) {
	int32_t ix = hi_word(x) & 0x7fffffff;
	if (ix <= 0x3fe921fb) return kernel_cos(x, 0.0);
	if (ix >= 0x7ff00000) return x - x;
	double y[2];
	int32_t n = rem_pio2(x, y);
	switch (n & 3) {
		case 0: return kernel_cos(y[0], y[1]);
		case 1: return -kernel_sin(y[0], y[1], 1);
		case 2: return -kernel_cos(y[0], y[1]);
		default: return kernel_sin(y[0], y[1], 1);
	}
}

inline double sin(double x) {
	int32_t ix = hi_word(x) & 0x7fffffff;
	if (ix <= 0x3fe921fb) return kernel_sin(x, 0.0, 0);
	if (ix >= 0x7ff00000) return x - x;
	double y[2];
	int32_t n = rem_pio2(x, y);
	switch (n & 3) {
		case 0: return kernel_sin(y[0], y[1], 1);
		case 1: return kernel_cos(y[0], y[1]);
		case 2: return -kernel_sin(y[0], y[1], 1);
		default: return -kernel_cos(y[0], y[1]);
	}
}

inline double atan(double x) {
	static const double atanhi[] = { 4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00 };
	static const double atanlo[] = { 2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17 };
	static const double aT[] = { 3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
		9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
		4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02 };
	const double one = 1.0, huge = 1.0e300;
	int32_t hx = hi_word(x);
	int32_t ix = hx & 0x7fffffff;
	int id;
	if (ix >= 0x44100000) {
		if (ix > 0x7ff00000 || (ix == 0x7ff00000 && lo_word(x) != 0)) return x + x;
		if (hx > 0) return atanhi[3] + atanlo[3];
		return -atanhi[3] - atanlo[3];
	}
	if (ix < 0x3fdc0000) {
		if (ix < 0x3e400000) {
			if (huge + x > one) return x;
		}
		id = -1;
	} else {
		x = std::fabs(x);
		if (ix < 0x3ff30000) {
			if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - one) / (2.0 + x); }
			else { id = 1; x = (x - one) / (x + one); }
		} else {
			if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (one + 1.5 * x); }
			else { id = 3; x = -1.0 / x; }
		}
	}
	double z = x * x;
	double w = z * z;
	double s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
	double s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
	if (id < 0) return x - x * (s1 + s2);
	z = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
	return (hx < 0) ? -z : z;
}

inline double atan2(double y, double x) {
	const double tiny = 1.0e-300, zero = 0.0, pi_o_4 = 7.8539816339744827900E-01, pi_o_2 = 1.5707963267948965580E+00,
				 pi = 3.1415926535897931160E+00, pi_lo = 1.2246467991473531772E-16;
	if (std::isnan(x) || std::isnan(y)) return x + y;
	int32_t hx = hi_word(x), ix = hx & 0x7fffffff;
	uint32_t lx = lo_word(x);
	int32_t hy = hi_word(y), iy = hy & 0x7fffffff;
	uint32_t ly = lo_word(y);
	if (((uint32_t)(hx - 0x3ff00000) | lx) == 0) return atan(y);
	int32_t m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
	if (((uint32_t)iy | ly) == 0) {
		switch (m) {
			case 0:
			case 1: return y;
			case 2: return pi + tiny;
			default: return -pi - tiny;
		}
	}
	if (((uint32_t)ix | lx) == 0) return (hy < 0) ? -pi_o_2 - tiny : pi_o_2 + tiny;
	if (ix == 0x7ff00000) {
		if (iy == 0x7ff00000) {
			switch (m) {
				case 0: return pi_o_4 + tiny;
				case 1: return -pi_o_4 - tiny;
				case 2: return 3.0 * pi_o_4 + tiny;
				default: return -3.0 * pi_o_4 - tiny;
			}
		}
		switch (m) {
			case 0: return zero;
			case 1: return -zero;
			case 2: return pi + tiny;
			default: return -pi - tiny;
		}
	}
	if (iy == 0x7ff00000) return (hy < 0) ? -pi_o_2 - tiny : pi_o_2 + tiny;
	int32_t k = (iy - ix) >> 20;
	double z;
	if (k > 60) { z = pi_o_2 + 0.5 * pi_lo; m &= 1; }
	else if (hx < 0 && k < -60) z = 0.0;
	else z = atan(std::fabs(y / x));
	switch (m) {
		case 0: return z;
		case 1: return -z;
		case 2: return pi - (z - pi_lo);
		default: return (z - pi_lo) - pi;
	}
}

// Math.hypot(a, b): V8's scaled Kahan summation (not libm hypot).
inline double hypot(double a, double b) {
	a = std::fabs(a);
	b = std::fabs(b);
	if (std::isinf(a) || std::isinf(b)) return INFINITY;
	if (std::isnan(a) || std::isnan(b)) return NAN;
	double mx = a > b ? a : b;
	if (mx == 0) return 0;
	double sum = 0, comp = 0;
	double n = a / mx;
	double s = n * n - comp;
	double p = sum + s;
	comp = (p - sum) - s;
	sum = p;
	n = b / mx;
	s = n * n - comp;
	p = sum + s;
	comp = (p - sum) - s;
	sum = p;
	return std::sqrt(sum) * mx;
}

} // namespace jsm
} // namespace aov
