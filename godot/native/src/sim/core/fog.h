// Fog of war for the local player (port of the sim side of
// src/core/FogOfWar.js): per tile 0 unexplored, 1 explored, 2 visible,
// recomputed four times a second from the sight radii of the owner's units
// and buildings. Visual only (the sim never reads it); the renderer samples
// get_fog() (0 / 128 / 255 like the JS fog texture) and the UI asks
// is_explored() for placement.
#pragma once
#include <cstdint>
#include <vector>

namespace aov {

class Sim;

class FogOfWar {
public:
	Sim *sim = nullptr;
	int n = 0;
	std::vector<uint8_t> state;
	bool reveal_all = false;
	double timer = 0;
	int owner = 1;
	uint32_t version = 0; // bumped by every recompute

	void init(Sim *s);
	void set_reveal_all(bool v);
	bool is_visible(double x, double z) const;
	bool is_explored(double x, double z) const;
	void update(double dt);
	void recompute();
};

} // namespace aov
