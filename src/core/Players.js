import { PLAYER_COLORS, AGES } from './constants.js';

// Per-player state. The economy piece owns the rules that mutate it, but the
// data lives here so every piece can read it.
export class Player {
  constructor(id, { name, isAI = false, god = 'Zeus' } = {}) {
    this.id = id;
    this.name = name || `Player ${id}`;
    this.isAI = isAI;
    this.god = god;
    this.color = PLAYER_COLORS[id] ?? 0xffffff;
    this.res = { food: 300, wood: 300, gold: 200, favor: 20 };
    this.pop = 0;       // recomputed by economy each tick
    this.popCap = 0;    // recomputed by economy each tick
    this.age = 0;       // index into AGES
    this.advancing = null; // { t, total } while researching the next age
  }
  get ageName() { return AGES[this.age]; }
  canAfford(cost) {
    for (const k in cost) if ((this.res[k] ?? 0) < cost[k]) return false;
    return true;
  }
  pay(cost) {
    if (!this.canAfford(cost)) return false;
    for (const k in cost) this.res[k] -= cost[k];
    return true;
  }
  refund(cost) { for (const k in cost) this.res[k] += cost[k]; }
}
