import { PLAYER, ENEMY } from '../core/constants.js';
import { GROUND } from '../core/GameMap.js';
import { standardStart, placeNear, spawnBlock, nearestResource, assignGatherers } from '../core/scenes/helpers.js';
import { FARM_ROWS } from './constants.js';

// The "economy" harness scene, owned by the economy piece: a busy Greek
// economy in the spirit of AoM Retold — a fenced block of farms around a
// granary with farmers working the rows, hunters spearing a deer herd and
// butchering the kill, fishing boats working shoals off the shore, and
// wood/gold/berry gatherers walking loads back to stockpiled storehouses.
export const economyScene = {
  description: 'A busy economy: fields, hunting, fishing, wood/gold/berries, building, training (used by the smoke test).',
  preset: 'skirmish', seed: 3, hud: false, revealAll: true, ai: true, fastForward: 15,
  setup(game) {
    const [p, e] = game.starts;
    const econ = game.economy;
    const { tc, villagers } = standardStart(game, PLAYER, p, 6);
    const map = game.map;

    // ---- the field block: 4x3 (or 3x3) farms around a granary
    const fields = findFieldBlock(game, tc, 4) || findFieldBlock(game, tc, 3);
    const farms = [];
    let granary = null;
    if (fields) {
      const { x0, z0, cols } = fields;
      map.paintTiles(x0 - 1, z0 - 1, cols * 4 + 2, 14, GROUND.DIRT);
      for (let j = 0; j < 3; j++)
        for (let i = 0; i < cols; i++) {
          const tx = x0 + i * 4, tz = z0 + j * 4;
          if (i === 1 && j === 1) {
            granary = game.buildings.spawn('storehouse', PLAYER, tx, tz + 1, { built: true });
            continue;
          }
          if (game.buildings.canPlace('farm', tx, tz)) farms.push(game.buildings.spawn('farm', PLAYER, tx, tz, { built: true }));
        }
      dressFields(game, econ, x0, z0, cols * 4, 12, granary);
    }
    // farms mid-harvest, each at a different point of the cycle
    farms.forEach((f, i) => { f.econ_rows = ((i * 7.3) % FARM_ROWS) + FARM_ROWS * (i % 3); });
    const farmers = spawnBlock(game, 'villager', PLAYER, farms.length, fields ? fields.x0 + fields.cols * 2 : tc.x, fields ? fields.z0 + 6 : tc.z, { spacing: 1.2 });
    farms.forEach((f, i) => {
      const v = farmers[i];
      const [fx, fz] = econ.farmSpot(v, f);
      v.x = v.prevX = fx; v.z = v.prevZ = fz;
      if (i % 3 === 1) v.carry = { type: 'food', amount: 7 };
      game.commands.order(v, { type: 'gather', targetId: f.id });
    });

    // ---- wood, gold and berries around the town centre
    const wood = nearestResource(game, 'wood', tc.x, tc.z);
    const store = placeNear(game, 'storehouse', PLAYER, tc.x + (wood.x - tc.x) * 0.7, tc.z + (wood.z - tc.z) * 0.7, { maxR: 5 });
    placeNear(game, 'house', PLAYER, tc.x - 8, tc.z - 5, { maxR: 3 });
    placeNear(game, 'house', PLAYER, tc.x - 8, tc.z, { maxR: 3 });
    const extra = spawnBlock(game, 'villager', PLAYER, 10, tc.x, tc.tz + tc.h + 2, { spacing: 1.1 });
    const all = [...villagers, ...extra];
    assignGatherers(game, all.slice(0, 6), 'wood', store || tc);
    const gold = nearestResource(game, 'gold', tc.x, tc.z);
    const goldStore = gold ? placeNear(game, 'storehouse', PLAYER, tc.x + (gold.x - tc.x) * 0.6, tc.z + (gold.z - tc.z) * 0.6, { maxR: 4 }) : null;
    assignGatherers(game, all.slice(6, 10), 'gold', goldStore || tc);
    const berries = [...game.entities.resources()].filter((r) => r.type === 'berry');
    const nearBerry = berries.sort((a, b) => ((a.x - tc.x) ** 2 + (a.z - tc.z) ** 2) - ((b.x - tc.x) ** 2 + (b.z - tc.z) ** 2))[0];
    assignGatherers(game, all.slice(10, 13), 'food', nearBerry || tc);
    const house = placeNear(game, 'house', PLAYER, tc.x + 8, tc.z - 5, { built: false, maxR: 3 });
    if (house) game.commands.order(all[13], { type: 'build', targetId: house.id });
    game.economy.train(tc, 'villager');
    // pre-stocked yards so storehouses look lived-in
    if (store) store.econ_stock = { wood: 260 };
    if (goldStore) goldStore.econ_stock = { gold: 180 };
    if (granary) granary.econ_stock = { grain: 300, fruit: 60 };
    tc.econ_stock = { grain: 80, meat: 60, wood: 40 };

    // ---- hunting: a deer herd and a boar out past the houses
    econ.wildlife.spawned = true; // this scene places its own game
    const huntSpot = openGround(game, tc.x - 11, tc.z + 9) || openGround(game, tc.x + 12, tc.z - 10);
    if (huntSpot) {
      const herd = econ.wildlife.spawnHerd('deer', huntSpot[0], huntSpot[1], 7);
      // one deer already down and being butchered
      if (herd[0]) { econ.wildlife.hit(herd[0], 99, tc); herd[0].amount = 70; }
      const hunters = spawnBlock(game, 'villager', PLAYER, 5, huntSpot[0] + 3, huntSpot[1] - 3, { spacing: 1.0 });
      hunters.forEach((h, i) => { const t = herd[i === 0 || i === 1 ? 0 : Math.min(herd.length - 1, i)]; if (t) game.commands.order(h, { type: 'gather', targetId: t.id }); });
      const boarSpot = openGround(game, huntSpot[0] - 5, huntSpot[1] + 5);
      if (boarSpot) econ.wildlife.spawnHerd('boar', boarSpot[0], boarSpot[1], 1);
    }

    // ---- fishing: a harbour storehouse on the nearest shore, boats on the shoals
    const water = nearestWater(econ.fishing, tc.x, tc.z, 40);
    if (water) {
      const dx = tc.x - water[0], dz = tc.z - water[1], d = Math.hypot(dx, dz) || 1;
      let dock = null;
      for (let k = 3; k < 9 && !dock; k++) dock = placeNear(game, 'storehouse', PLAYER, water[0] + (dx / d) * k, water[1] + (dz / d) * k, { maxR: 1 });
      if (dock) dock.econ_stock = { fish: 140, meat: 50 };
    }
    const shore = econ.fishing.findDock(PLAYER, water ? water[0] : tc.x, water ? water[1] : tc.z);
    if (shore) {
      const dx = shore.x - tc.x, dz = shore.z - tc.z, d = Math.hypot(dx, dz) || 1;
      let placed = 0;
      for (let k = 0; k < 60 && placed < 4; k++) {
        const ang = Math.atan2(dz, dx) + ((k % 9) - 4) * 0.12;
        const r = d + 5 + Math.floor(k / 9) * 2;
        const sx = tc.x + Math.cos(ang) * r, sz = tc.z + Math.sin(ang) * r;
        if (!econ.fishing.isOpen(sx, sz, 1.4)) continue;
        if (econ.fishing.shoals.some((s) => Math.hypot(s.x - sx, s.z - sz) < 4.5)) continue;
        econ.fishing.spawnShoal(sx, sz, 400);
        placed++;
      }
      econ.fishing.populate(); // plus shoals elsewhere on the map
      const boats = [[1.5, 0], [-1.2, 1.2], [0.4, -1.8], [-2, -1]];
      boats.forEach(([ox, oz], i) => {
        const b = econ.fishing.spawnBoat(PLAYER, shore.x + ox, shore.z + oz, i * 2);
        if (!econ.fishing.isWater(b.x, b.z)) { b.x = b.prevX = shore.x; b.z = b.prevZ = shore.z; }
        if (i === 2) b.carry = 12;
      });
    }

    const enemy = standardStart(game, ENEMY, e, 6);
    game.combat.ai.enabled = true;
    game.combat.ai.nextWaveAt = 1e9; // keep the economy scene peaceful
    void enemy;
    // frame the harbour, the hunt, the town centre and the fields together
    const pts = [[tc.x, tc.z]];
    if (fields) pts.push([fields.x0 + fields.cols * 2, fields.z0 + 6]);
    if (water) pts.push([water[0], water[1]]);
    const fx = pts.reduce((a, q) => a + q[0], 0) / pts.length, fz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    return { focus: { x: fx + 1.5, z: fz + 2 } };
  },
  camera: (game, ctx) => ({ x: ctx.focus.x, z: ctx.focus.z, distance: 54, yaw: 18 }),
};

// Find a (cols*4)x12 tile block near the town centre where every farm fits.
function findFieldBlock(game, tc, cols) {
  let best = null, bs = -Infinity;
  const cands = [];
  for (let dz = -18; dz <= 18; dz++)
    for (let dx = -18; dx <= 18; dx++) cands.push([dx, dz]);
  for (const [dx, dz] of cands) {
    const x0 = Math.round(tc.x) + dx, z0 = Math.round(tc.z) + dz;
    // keep a road between the fields and the town centre
    if (x0 < tc.tx + tc.w + 2 && x0 + cols * 4 > tc.tx - 2 && z0 < tc.tz + tc.h + 2 && z0 + 12 > tc.tz - 2) continue;
    let ok = 0;
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < cols; i++) if (game.buildings.canPlace('farm', x0 + i * 4, z0 + j * 4)) ok++;
    if (ok < cols * 3) continue;
    const cx = x0 + cols * 2 - tc.x, cz = z0 + 6 - tc.z;
    // prefer close to the TC and toward the camera side (+x +z)
    const s = -Math.hypot(cx, cz) + (cx + cz) * 0.35;
    if (s > bs) { bs = s; best = { x0, z0, cols }; }
  }
  return best;
}

function nearestWater(fishing, x, z, maxR) {
  for (let r = 4; r <= maxR; r++)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (fishing.isOpen(px, pz, 1.2)) return [px, pz];
    }
  return null;
}

function openGround(game, x, z) {
  const w = game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 8);
  return w ? [w[0] + 0.5, w[1] + 0.5] : null;
}

// Fences around the block (with gates), hay, sheaves and a cart by the granary.
function dressFields(game, econ, x0, z0, W, H, granary) {
  const D = econ.decor;
  const S = Math.max(W, H);
  for (let i = 0; i < W; i++) {
    if (i === (W >> 1) - 1 || i === W >> 1) continue; // gates in the middle of each side
    D.push({ key: 'fence', x: x0 + i, z: z0 - 0.35 });
    D.push({ key: 'fence', x: x0 + i, z: z0 + H + 0.35 });
  }
  for (let i = 0; i < H; i++) {
    if (i === (H >> 1) - 1 || i === H >> 1) continue;
    D.push({ key: 'fence', x: x0 - 0.35, z: z0 + i + 1, rot: Math.PI / 2 });
    D.push({ key: 'fence', x: x0 + W + 0.35, z: z0 + i + 1, rot: Math.PI / 2 });
  }
  if (granary) {
    const gx = granary.x, gz = granary.z;
    D.push({ key: 'cart', x: gx + 0.2, z: gz + 2.1, rot: Math.PI / 2 + 0.3 });
    D.push({ key: 'hay', x: gx - 1.9, z: gz + 1.9, rot: 0.4 });
    D.push({ key: 'hay', x: gx - 2.0, z: gz + 1.1, rot: 1.3, scale: 0.85 });
    D.push({ key: 'sheaf', x: gx + 2.0, z: gz + 1.9, rot: 0.2 });
    D.push({ key: 'sheaf', x: gx + 1.6, z: gz + 2.2, rot: 0.9 });
  }
  // hay bales at the outer corners
  D.push({ key: 'hay', x: x0 - 1.2, z: z0 - 1.2, rot: 0.3 });
  D.push({ key: 'hay', x: x0 + W + 1.2, z: z0 + H + 1.1, rot: 1.1 });
  D.push({ key: 'crate_apples', x: x0 + W + 1.1, z: z0 - 1.1, rot: 0.5 });
  D.push({ key: 'crate_grain', x: x0 - 1.1, z: z0 + H + 1.2, rot: 0.2 });
}
