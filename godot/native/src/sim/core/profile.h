// Sim profiler data (the JS Profiler's prof.last) and a scoped timer.
#pragma once
#include <chrono>
#include <cstdint>
#include <map>
#include <string>

namespace aov {

// Per-tick timing, filled while `enabled` (the JS Profiler's prof.last):
// ms per system of the sim order, per AI player, sub-steps, and counted calls
// (findPath, nearestResource, ...). Systems time themselves with ScopedTimer.
struct Profile {
	bool enabled = false;
	double total = 0;
	std::map<std::string, double> sys, sub, ai;
	std::map<std::string, std::pair<int64_t, double>> calls; // name -> (count, ms)
	void clear() { total = 0; sys.clear(); sub.clear(); ai.clear(); calls.clear(); }
};

using Clock = std::chrono::steady_clock;
inline double ms_since(Clock::time_point t0) {
	return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}
struct ScopedTimer {
	double *out;
	Clock::time_point t0;
	explicit ScopedTimer(double *o) : out(o), t0(o ? Clock::now() : Clock::time_point()) {}
	~ScopedTimer() { if (out) *out += ms_since(t0); }
};

} // namespace aov
