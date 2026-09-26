// Minimal synchronous pub/sub. Events used across pieces:
//   'entity:added' (e), 'entity:removed' (e), 'entity:died' (e, killer)
//   'unit:damaged' ({target, attacker, amount})
//   'building:placed' (b), 'building:completed' (b)
//   'unit:trained' (u), 'age:advanced' ({owner, age})
//   'resources:changed' (owner), 'selection:changed' (ids)
//   'godpower:cast' ({power, owner, x, z})
export class EventBus {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.map.get(name).delete(fn);
  }
  emit(name, ...args) {
    const set = this.map.get(name);
    if (set) for (const fn of set) fn(...args);
  }
}
