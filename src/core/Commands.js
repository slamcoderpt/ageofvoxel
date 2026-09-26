// High-level orders shared by the human UI and the AI.
//
// An order is a plain object stored on the unit: u.order = { type, ... }.
// Pieces register a handler per order type:
//   game.commands.register('gather', { start(unit, order) { ... return true } })
// and then drive units carrying that order type from their own update().
// Built-in: 'idle' and 'move' (handled here + core Movement).

export class Commands {
  constructor(game) {
    this.game = game;
    this.handlers = new Map();
    this.register('idle', { start: (u) => { game.movement.stop(u); return true; } });
    this.register('move', {
      start: (u, o) => { game.movement.moveTo(u, o.x, o.z); return true; },
    });
  }

  register(type, handler) { this.handlers.set(type, handler); }

  // Give one unit an order. Returns false if the handler rejected it.
  order(u, order) {
    if (!u || u.dead) return false;
    const h = this.handlers.get(order.type);
    if (!h) { console.warn('No handler for order', order.type); return false; }
    const prev = u.order;
    u.order = { ...order };
    if (prev && prev.type !== order.type) this.handlers.get(prev.type)?.cancel?.(u, prev);
    const ok = h.start(u, u.order);
    if (!ok) { u.order = { type: 'idle' }; this.handlers.get('idle').start(u, u.order); }
    return ok;
  }

  idle(u) { return this.order(u, { type: 'idle' }); }

  // Formation move: fan units out on a grid around the destination.
  move(units, x, z) {
    const list = units.filter((u) => !u.dead);
    if (!list.length) return;
    const n = list.length;
    const cols = Math.ceil(Math.sqrt(n));
    const spacing = 1.15;
    // order units by distance so near units take near slots
    let cx = 0, cz = 0;
    for (const u of list) { cx += u.x; cz += u.z; }
    cx /= n; cz /= n;
    const ang = Math.atan2(x - cx, z - cz);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    list.sort((a, b) => a.id - b.id);
    list.forEach((u, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const ox = (col - (cols - 1) / 2) * spacing * (u.radius > 0.5 ? 1.8 : 1);
      const oz = -(row - (Math.ceil(n / cols) - 1) / 2) * spacing * (u.radius > 0.5 ? 1.8 : 1);
      const wx = x + ox * ca + oz * sa, wz = z - ox * sa + oz * ca;
      this.order(u, { type: 'move', x: n === 1 ? x : wx, z: n === 1 ? z : wz });
    });
  }

  // Right-click semantics.
  smart(units, x, z, target) {
    const game = this.game;
    const movers = [];
    for (const u of units) {
      if (u.dead) continue;
      const d = u.def || {};
      if (target && !target.dead && target !== u) {
        if (target.kind === 'resource' && d.gatherer) { this.order(u, { type: 'gather', targetId: target.id }); continue; }
        if (target.owner !== u.owner && target.owner !== 0 && d.attack) { this.order(u, { type: 'attack', targetId: target.id }); continue; }
        if (target.kind === 'building' && target.owner === u.owner && d.builder) {
          if (!target.built) { this.order(u, { type: 'build', targetId: target.id }); continue; }
          if (target.def?.worship) { this.order(u, { type: 'worship', targetId: target.id }); continue; }
          if (target.def?.farm) { this.order(u, { type: 'gather', targetId: target.id }); continue; }
          if (u.carry && u.carry.amount > 0 && target.def?.dropoff) { this.order(u, { type: 'dropoff', targetId: target.id }); continue; }
        }
      }
      movers.push(u);
    }
    if (movers.length) this.move(movers, x, z);
    game.events.emit('command:smart', { units, x, z, target });
  }

  stop(units) { for (const u of units) this.idle(u); }
}
