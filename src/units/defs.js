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
    name: 'Hoplite', class: 'infantry', hp: 120, speed: 2.5, radius: 0.42, sight: 8, pop: 1,
    cost: { food: 50, gold: 40 }, trainTime: 12, hotkey: 'Q',
    attack: { damage: 9, range: 0.6, cooldown: 1.2 }, armor: 0.3, bonus: { cavalry: 1.5 },
  },
  toxotes: {
    name: 'Toxotes', class: 'archer', hp: 65, speed: 2.6, radius: 0.36, sight: 13, pop: 1,
    cost: { food: 40, wood: 50 }, trainTime: 12, hotkey: 'W',
    attack: { damage: 7, range: 11, cooldown: 1.7, projectile: 'arrow' }, armor: 0.1, bonus: { infantry: 1.2 },
  },
  hippikon: {
    name: 'Hippikon', class: 'cavalry', hp: 160, speed: 4.3, radius: 0.6, sight: 10, pop: 2,
    cost: { food: 60, gold: 70 }, trainTime: 15, hotkey: 'E',
    attack: { damage: 8, range: 0.8, cooldown: 1.3 }, armor: 0.2, bonus: { archer: 1.6 },
  },
  minotaur: {
    name: 'Minotaur', class: 'myth', hp: 480, speed: 2.9, radius: 0.85, sight: 10, pop: 3, myth: true,
    cost: { gold: 150, favor: 20 }, trainTime: 20, hotkey: 'Q', minAge: 1,
    attack: { damage: 24, range: 1.0, cooldown: 1.9, splash: 1.4 }, armor: 0.35, bonus: { infantry: 1.3 },
  },
  // Hero and extra myth units (the battle scene fields them; not yet trainable).
  hero: {
    name: 'Achilles', class: 'hero', hp: 900, speed: 3.1, radius: 0.55, sight: 11, pop: 3, hero: true,
    cost: { food: 150, gold: 150 }, trainTime: 30, hotkey: 'T',
    attack: { damage: 28, range: 0.8, cooldown: 1.0 }, armor: 0.4, bonus: { myth: 3 },
  },
  cyclops: {
    name: 'Cyclops', class: 'myth', hp: 720, speed: 2.6, radius: 1.05, sight: 10, pop: 5, myth: true,
    cost: { food: 180, favor: 30 }, trainTime: 28, hotkey: 'W', minAge: 1,
    attack: { damage: 30, range: 1.2, cooldown: 2.3, splash: 1.6 }, armor: 0.35, bonus: { infantry: 1.4, cavalry: 1.2 },
  },
  centaur: {
    name: 'Centaur', class: 'myth', hp: 340, speed: 4.1, radius: 0.7, sight: 14, pop: 3, myth: true,
    cost: { wood: 120, favor: 20 }, trainTime: 22, hotkey: 'E', minAge: 1,
    attack: { damage: 12, range: 12, cooldown: 1.5, projectile: 'arrow' }, armor: 0.2, bonus: { infantry: 1.2 },
  },
  medusa: {
    name: 'Medusa', class: 'myth', hp: 300, speed: 2.4, radius: 0.6, sight: 14, pop: 4, myth: true,
    cost: { gold: 160, favor: 30 }, trainTime: 26, hotkey: 'R', minAge: 1,
    attack: { damage: 15, range: 12, cooldown: 2.0, projectile: 'arrow' }, armor: 0.25, bonus: { myth: 1.3 },
  },
};
