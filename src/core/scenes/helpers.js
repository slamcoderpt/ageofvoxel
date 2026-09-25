// Helpers for building reproducible scenes. Everything here is deterministic.

// Place a building near (cx, cz) (tile coords of its centre), spiralling
// outwards until it fits with a one-tile gap. Returns the entity or null.
export function placeNear(game, type, owner, cx, cz, { built = true, maxR = 6, gap = 1, progress } = {}) {
  const def = game.buildings.defs[type];
  for (let r = 0; r <= maxR; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const tx = Math.round(cx - def.w / 2) + dx, tz = Math.round(cz - def.h / 2) + dz;
        if (!game.buildings.canPlace(type, tx, tz)) continue;
        if (gap && !gapOk(game, tx, tz, def, gap)) continue;
        const b = game.buildings.spawn(type, owner, tx, tz, { built });
        if (!built && progress !== undefined) { b.progress = progress; b.hp = b.maxHp * (0.1 + 0.9 * progress); }
        return b;
      }
  return null;
}

function gapOk(game, tx, tz, def, gap) {
  for (let z = tz - gap; z < tz + def.h + gap; z++)
    for (let x = tx - gap; x < tx + def.w + gap; x++) {
      if (!game.map.inTiles(x, z)) return false;
      for (const b of game.entities.buildings())
        if (x >= b.tx && x < b.tx + b.w && z >= b.tz && z < b.tz + b.h) return false;
    }
  return true;
}

// Spawn `count` units of a type in a loose block formation centred on (x, z),
// facing `rot` radians.
export function spawnBlock(game, type, owner, count, x, z, { cols = 0, spacing = 1.0, rot = 0, jitter = 0.15 } = {}) {
  const out = [];
  cols = cols || Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const ox = (col - (cols - 1) / 2) * spacing + game.rng.range(-jitter, jitter);
    const oz = (row - (rows - 1) / 2) * spacing + game.rng.range(-jitter, jitter);
    let wx = x + ox * c + oz * s, wz = z - ox * s + oz * c;
    const w = game.pathfinder.nearestWalkable(Math.floor(wx), Math.floor(wz), 6);
    if (w && !game.map.isWalkable(Math.floor(wx), Math.floor(wz))) { wx = w[0] + 0.5; wz = w[1] + 0.5; }
    out.push(game.units.spawn(type, owner, wx, wz, { rot }));
  }
  return out;
}

// Send villagers to gather the nearest nodes of a resource type.
export function assignGatherers(game, villagers, resType, near) {
  const nodes = [...game.entities.resources()].filter((r) => r.resType === resType)
    .sort((a, b) => ((a.x - near.x) ** 2 + (a.z - near.z) ** 2) - ((b.x - near.x) ** 2 + (b.z - near.z) ** 2));
  villagers.forEach((v, i) => {
    const node = nodes[resType === 'gold' ? 0 : Math.min(nodes.length - 1, i)];
    if (node) game.commands.order(v, { type: 'gather', targetId: node.id });
  });
  return nodes[0];
}

export function nearestResource(game, resType, x, z) {
  let best = null, bd = Infinity;
  for (const r of game.entities.resources()) {
    if (r.resType !== resType) continue;
    const d = (r.x - x) ** 2 + (r.z - z) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

// A standard starting position: Town Center + villagers.
export function standardStart(game, owner, start, villagers = 5) {
  const tc = game.buildings.spawn('town_center', owner, start.tx - 3, start.tz - 3, { built: true });
  const vs = spawnBlock(game, 'villager', owner, villagers, tc.x, tc.tz + tc.h + 1.5, { spacing: 1.1 });
  return { tc, villagers: vs };
}

// A developed Greek town around a start position.
export function buildTown(game, owner, start, { villagers = 24, soldiers = 6 } = {}) {
  const sx = start.tx, sz = start.tz;
  const tc = game.buildings.spawn('town_center', owner, sx - 3, sz - 3, { built: true });
  const wood = nearestResource(game, 'wood', sx, sz);
  const gold = nearestResource(game, 'gold', sx, sz);
  const berry = nearestResource(game, 'food', sx, sz);
  const toward = (r, k) => (r ? [sx + (r.x - sx) * k, sz + (r.z - sz) * k] : [sx + 8, sz + 8]);
  const store = placeNear(game, 'storehouse', owner, ...toward(wood, 0.72), { maxR: 5 });
  const store2 = placeNear(game, 'storehouse', owner, ...toward(gold, 0.7), { maxR: 5, gap: 2 });
  const houses = [];
  for (const [dx, dz] of [[-6, -11], [4, -11], [-11, -6], [-11, 4], [-17, -6], [15, 4], [10, -13]]) {
    const h = placeNear(game, 'house', owner, sx + dx, sz + dz, { maxR: 4, gap: 3 });
    if (h) houses.push(h);
  }
  const temple = placeNear(game, 'temple', owner, sx + 11, sz - 5, { maxR: 5, gap: 2 });
  const barracks = placeNear(game, 'barracks', owner, sx - 4, sz + 10, { maxR: 5, gap: 2 });
  const farms = [];
  for (const [dx, dz] of [[6, 7], [11, 7], [6, 12]]) {
    const f = placeNear(game, 'farm', owner, sx + dx, sz + dz, { maxR: 3, gap: 0 });
    if (f) farms.push(f);
  }
  const house2 = placeNear(game, 'house', owner, sx + 3, sz + 11, { built: false, progress: 0.55, maxR: 4 });

  const vs = spawnBlock(game, 'villager', owner, villagers, tc.x, tc.tz + tc.h + 2, { spacing: 1.2 });
  let i = 0;
  const take = (n) => vs.slice(i, (i += n));
  const nW = Math.round(villagers * 0.3), nG = Math.round(villagers * 0.2), nB = Math.round(villagers * 0.15);
  assignGatherers(game, take(nW), 'wood', wood || tc);
  assignGatherers(game, take(nG), 'gold', gold || tc);
  assignGatherers(game, take(nB), 'food', berry || tc);
  for (const f of farms) { const v = take(1)[0]; if (v) game.commands.order(v, { type: 'gather', targetId: f.id }); }
  if (temple) for (const v of take(3)) game.commands.order(v, { type: 'worship', targetId: temple.id });
  if (house2) for (const v of take(2)) game.commands.order(v, { type: 'build', targetId: house2.id });
  // the rest idle in the plaza
  const army = soldiers ? spawnBlock(game, 'hoplite', owner, soldiers, tc.x + 5.5, tc.z + 1, { cols: 3, spacing: 1.0, rot: Math.PI / 4 }) : [];
  return { tc, houses, temple, barracks, farms, store, store2, villagers: vs, army };
}
