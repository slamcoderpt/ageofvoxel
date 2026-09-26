// Greek building definitions. Footprints are in tiles; models are built at
// BUILDING_VOXEL (4 voxels per tile).
//   trains:   unit types this building can queue (economy piece runs the queue)
//   dropoff:  resource types villagers may return here
//   pop:      population capacity provided
//   worship:  villagers can worship here to generate favor
//   farm:     infinite food node gathered by one villager
export const BUILDING_VOXEL = 0.25;

export const BUILDING_DEFS = {
  town_center: {
    name: 'Town Center', w: 7, h: 7, hp: 3000, cost: { wood: 400, gold: 200 }, buildTime: 60,
    pop: 15, sight: 14, dropoff: ['food', 'wood', 'gold'], trains: ['villager'], ageUp: true,
    attack: { damage: 6, range: 10, cooldown: 1.6, projectile: 'arrow' }, hotkey: 'T', minAge: 0,
  },
  house: {
    name: 'House', w: 3, h: 3, hp: 600, cost: { wood: 50 }, buildTime: 15, pop: 10, sight: 6, hotkey: 'E', minAge: 0,
  },
  storehouse: {
    name: 'Storehouse', w: 3, h: 3, hp: 800, cost: { wood: 50 }, buildTime: 15, sight: 6,
    dropoff: ['food', 'wood', 'gold'], hotkey: 'S', minAge: 0,
  },
  farm: {
    name: 'Farm', w: 4, h: 4, hp: 300, cost: { wood: 100 }, buildTime: 12, sight: 4, farm: true, walkable: true, hotkey: 'F', minAge: 0,
  },
  temple: {
    name: 'Temple', w: 5, h: 6, hp: 1500, cost: { wood: 150, gold: 50 }, buildTime: 40, sight: 10, worship: true,
    trains: ['minotaur'], hotkey: 'R', minAge: 0,
  },
  barracks: {
    name: 'Military Academy', w: 5, h: 5, hp: 1500, cost: { wood: 150 }, buildTime: 30, sight: 8,
    trains: ['hoplite', 'toxotes', 'hippikon'], hotkey: 'B', minAge: 0,
  },
};

export const BUILD_MENU = ['house', 'farm', 'storehouse', 'temple', 'barracks', 'town_center'];
