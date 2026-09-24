// Shared world constants. Changing these affects every piece, so coordinate.

export const TILE = 1;          // gameplay grid cell size in world units
export const VOXEL = 0.5;       // terrain voxel size (2x2 terrain columns per tile)
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

export const GAIA = 0;          // owner id for neutral resources
export const PLAYER = 1;        // the local human player
export const ENEMY = 2;         // the AI opponent

export const PLAYER_COLORS = {
  0: 0xbbbbbb,
  1: 0x2f6bff, // blue
  2: 0xe0282e, // red
};

export const RESOURCES = ['food', 'wood', 'gold', 'favor'];

export const AGES = ['Archaic', 'Classical', 'Heroic', 'Mythic'];
