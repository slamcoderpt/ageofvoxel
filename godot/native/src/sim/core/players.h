// Per-player state (port of src/core/Players.js). Owners 0 (Gaia) .. 6.
// The economy piece owns the rules that mutate it; the data lives here.
#pragma once
#include <cstdint>
#include <string>

#include "constants.h"

namespace aov {

enum ResKind : uint8_t { RES_FOOD = 0, RES_WOOD = 1, RES_GOLD = 2, RES_FAVOR = 3, RES_COUNT = 4, RES_NONE = 255 };
inline const char *res_name(int r) {
	static const char *n[] = { "food", "wood", "gold", "favor" };
	return r >= 0 && r < RES_COUNT ? n[r] : "";
}

struct Cost {
	double v[RES_COUNT] = { 0, 0, 0, 0 };
	bool has[RES_COUNT] = { false, false, false, false }; // keys present (JS iterates own keys)
	Cost() = default;
	Cost(double food, double wood, double gold, double favor) {
		double a[4] = { food, wood, gold, favor };
		for (int i = 0; i < 4; i++) { v[i] = a[i]; has[i] = a[i] != 0; }
	}
};

constexpr int MAX_PLAYERS = 7; // 0 = Gaia, 1..6
constexpr const char *AGES[] = { "Archaic", "Classical", "Heroic", "Mythic" };

struct Player {
	bool exists = false;
	int id = 0;
	std::string name;
	bool is_ai = false;
	std::string god = "Zeus";
	uint32_t color = 0xffffff;
	double res[RES_COUNT] = { 300, 300, 200, 20 };
	int pop = 0, pop_cap = 0;
	int age = 0;
	bool advancing = false;
	double advancing_t = 0, advancing_total = 0;
	// Godot-only (match setup): gather rate multiplier (Titan AI 1.2), AI
	// difficulty (AIDifficulty, -1 = none / the default AI), human seat
	double gather_mult = 1;
	int difficulty = -1;
	bool human = false;
	// Godot-only (sim/civ): the civilization, set at match setup from the major
	// god (CIV_GREEK 0 = the browser's game, CIV_EGYPT 1)
	uint8_t civ = 0;

	void init(int id_, const std::string &name_, bool ai) {
		*this = Player();
		exists = true;
		id = id_;
		name = name_.empty() ? "Player " + std::to_string(id_) : name_;
		is_ai = ai;
		color = id_ >= 0 && id_ < 7 ? PLAYER_COLORS[id_] : 0xffffff;
	}
	bool can_afford(const Cost &c) const {
		for (int k = 0; k < RES_COUNT; k++)
			if (c.has[k] && res[k] < c.v[k]) return false;
		return true;
	}
	bool pay(const Cost &c) {
		if (!can_afford(c)) return false;
		for (int k = 0; k < RES_COUNT; k++)
			if (c.has[k]) res[k] -= c.v[k];
		return true;
	}
	void refund(const Cost &c) {
		for (int k = 0; k < RES_COUNT; k++)
			if (c.has[k]) res[k] += c.v[k];
	}
};

} // namespace aov
