// Entity store. Entities are plain objects. Every entity has at least:
//   id, kind ('unit' | 'building' | 'resource'), type (def key), owner,
//   x, z (world position of the center), rot (yaw radians), hp, maxHp, dead
// Units additionally carry: prevX, prevZ (for render interpolation), radius,
//   speed, path, order, anim, carry ...  (see src/units/index.js)
// Buildings: tx, tz (footprint origin tile), w, h (footprint size in tiles),
//   built, progress, queue (see src/buildings/index.js)
// Resources: resType ('food'|'wood'|'gold'), amount, tx, tz (see src/terrain/)
//
// Pieces are free to hang extra fields on entities; prefix private fields with
// the piece name (e.g. e.combat_*) to avoid collisions.

export class EntityStore {
  constructor(events) {
    this.events = events;
    this.nextId = 1;
    this.all = new Map();
    this.byKind = { unit: new Map(), building: new Map(), resource: new Map() };
  }
  add(e) {
    e.id = this.nextId++;
    e.dead = e.dead || false;
    this.all.set(e.id, e);
    this.byKind[e.kind].set(e.id, e);
    this.events.emit('entity:added', e);
    return e;
  }
  get(id) { return this.all.get(id); }
  remove(e) {
    if (!this.all.has(e.id)) return;
    this.all.delete(e.id);
    this.byKind[e.kind].delete(e.id);
    e.removed = true;
    this.events.emit('entity:removed', e);
  }
  units() { return this.byKind.unit.values(); }
  buildings() { return this.byKind.building.values(); }
  resources() { return this.byKind.resource.values(); }
  *query(kind, pred) {
    for (const e of this.byKind[kind].values()) if (pred(e)) yield e;
  }
  count(kind, pred) {
    let n = 0;
    for (const e of this.byKind[kind].values()) if (!pred || pred(e)) n++;
    return n;
  }
}
