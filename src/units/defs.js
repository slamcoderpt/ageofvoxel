// Unit definitions. Distances in tiles (world units), speeds in tiles/second.
//   attack.projectile: 'arrow' -> ranged (combat piece spawns projectiles)
//   bonus: damage multipliers vs. other unit classes
export const UNIT_VOXEL = 0.1;

export const UNIT_DEFS = {
  villager: {
    name: 'Villager', class: 'villager', hp: 75, speed: 2.7, radius: 0.32, sight: 8, pop: 1,
    cost: { food: 50 }, trainTime: 10, gatherer: true, builder: true, hotkey: 'Q',
    attack: { damage: 3, range: 0.5, cooldown: 1.5 }, armor: 0,
    gatherRate: { food: 0.75, wood: 0.6, gold: 0.55 }, carryCap: 10,
  },
  hoplite: {
    name: 'Hoplite', class: 'infantry', hp: 120, speed: 2.5, radius: 0.36, sight: 8, pop: 1,
    cost: { food: 50, gold: 40 }, trainTime: 12, hotkey: 'Q',
    attack: { damage: 9, range: 0.6, cooldown: 1.2 }, armor: 0.3, bonus: { cavalry: 1.5 },
  },
  toxotes: {
    name: 'Toxotes', class: 'archer', hp: 65, speed: 2.6, radius: 0.32, sight: 13, pop: 1,
    cost: { food: 40, wood: 50 }, trainTime: 12, hotkey: 'W',
    attack: { damage: 7, range: 11, cooldown: 1.7, projectile: 'arrow' }, armor: 0.1, bonus: { infantry: 1.2 },
  },
  hippikon: {
    name: 'Hippikon', class: 'cavalry', hp: 160, speed: 4.3, radius: 0.55, sight: 10, pop: 2,
    cost: { food: 60, gold: 70 }, trainTime: 15, hotkey: 'E',
    attack: { damage: 8, range: 0.8, cooldown: 1.3 }, armor: 0.2, bonus: { archer: 1.6 },
  },
  minotaur: {
    name: 'Minotaur', class: 'myth', hp: 480, speed: 2.9, radius: 0.75, sight: 10, pop: 3, myth: true,
    cost: { gold: 150, favor: 20 }, trainTime: 20, hotkey: 'Q', minAge: 1,
    attack: { damage: 24, range: 1.0, cooldown: 1.9, splash: 1.4 }, armor: 0.35, bonus: { infantry: 1.3 },
  },
};
