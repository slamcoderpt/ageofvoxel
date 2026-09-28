// Shared world constants: port of src/core/constants.js.
#pragma once
#include <cstdint>

namespace aov {

constexpr double TILE = 1.0;   // gameplay grid cell size in world units
constexpr double VOXEL = 0.5;  // terrain voxel size (2x2 terrain columns per tile)
constexpr int SIM_HZ = 30;
constexpr double SIM_DT = 1.0 / SIM_HZ;

constexpr int GAIA = 0;
constexpr int PLAYER = 1;
constexpr int ENEMY = 2;

constexpr uint32_t PLAYER_COLORS[7] = { 0xbbbbbb, 0x2f6bff, 0xe0282e, 0x2fb04a, 0xf2c21b, 0x8e44d8, 0xf07818 };

} // namespace aov
