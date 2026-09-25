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
    // the mining camp sits on the camera side of the ore so the miners at the
    // face and the basket carriers walking back are in plain view
    let goldStore = null;
    if (gold) for (const [ox, oz] of [[-4.5, 3.5], [-5, 1], [-3, 4.5], [0, 5], [-5.5, -1]]) {
      goldStore = placeNear(game, 'storehouse', PLAYER, gold.x + ox, gold.z + oz, { maxR: 1 });
      if (goldStore) break;
    }
    if (gold && !goldStore) goldStore = placeNear(game, 'storehouse', PLAYER, tc.x + (gold.x - tc.x) * 0.6, tc.z + (gold.z - tc.z) * 0.6, { maxR: 4 });
    assignGatherers(game, all.slice(6, 10), 'gold', goldStore || tc);
    // miners start at the face on the near side, already swinging
    if (gold) all.slice(6, 10).forEach((v, i) => {
      const a = Math.PI * (0.15 + i * 0.28), r = 1.7;
      const w = openGround(game, gold.x + Math.cos(a) * r, gold.z + Math.sin(a) * r);
      if (w) { v.x = v.prevX = w[0]; v.z = v.prevZ = w[1]; }
    });
    const berries = [...game.entities.resources()].filter((r) => r.type === 'berry');
    const nearBerry = berries.sort((a, b) => ((a.x - tc.x) ** 2 + (a.z - tc.z) ** 2) - ((b.x - tc.x) ** 2 + (b.z - tc.z) ** 2))[0];
    assignGatherers(game, all.slice(10, 13), 'food', nearBerry || tc);
    const house = placeNear(game, 'house', PLAYER, tc.x + 8, tc.z - 5, { built: false, maxR: 3, progress: 0.05 });
    if (house) game.commands.order(all[13], { type: 'build', targetId: house.id });
    assignGatherers(game, all.slice(14, 16), 'wood', store || tc);
    if (gold) tc.rally = { x: gold.x, z: gold.z, targetId: gold.id };
    game.economy.train(tc, 'villager');
    // pre-stocked yards so storehouses look lived-in
    if (store) store.econ_stock = { wood: 260 };
    if (goldStore) goldStore.econ_stock = { gold: 180 };
    if (granary) granary.econ_stock = { grain: 300, fruit: 60 };
    tc.econ_stock = { grain: 80, meat: 60, wood: 40 };

    // ---- hunting: a deer herd and a boar out past the houses
    econ.wildlife.spawned = true; // this scene places its own game
    // close enough to the town that the hunt shares the shot with the fields
    const huntSpot = (fields && openGround(game, fields.x0 + fields.cols * 4 + 3.2, fields.z0 + 7)) || openGround(game, tc.x - 5, tc.z + 13) || openGround(game, tc.x + 12, tc.z - 10);
    if (huntSpot) {
      const herd = econ.wildlife.spawnHerd('deer', huntSpot[0], huntSpot[1], 7);
      // one deer already down and being butchered
      // one deer already down: hunters butcher it at the edge of the fields
      // while the rest of the herd grazes on
      if (herd[0]) { econ.wildlife.hit(herd[0], 99, tc); herd[0].amount = herd[0].maxAmount = 160; }
      const hunters = spawnBlock(game, 'villager', PLAYER, 3, herd[0] ? herd[0].x - 1 : huntSpot[0], herd[0] ? herd[0].z : huntSpot[1], { spacing: 1.0 });
      hunters.forEach((h, i) => {
        if (!herd[0]) return;
        game.commands.order(h, { type: 'gather', targetId: herd[0].id });
        h.carry = { type: 'food', amount: [0, 4.5, 8.5][i % 3] }; // out of step with each other
      });
      const boarSpot = openGround(game, huntSpot[0] + 2, huntSpot[1] + 6);
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

    // worn dirt paths: town centre <-> fields, mine, woodline, berries, hunt
    const tcEdge = (x, z) => [Math.max(tc.tx - 0.5, Math.min(tc.tx + tc.w + 0.5, x)), Math.max(tc.tz - 0.5, Math.min(tc.tz + tc.h + 0.5, z))];
    const trail = (b, w = 1.1) => { if (b) paintPath(game.map, ...tcEdge(b.x, b.z), b.x, b.z, w); };
    if (fields) {
      const gz = fields.z0 + 6;
      paintPath(game.map, tc.tx + tc.w, tc.z, fields.x0 - 0.5, gz, 1.4);
      paintPath(game.map, fields.x0 + fields.cols * 2, fields.z0 + 12.5, fields.x0 + fields.cols * 2 - 3, fields.z0 + 17, 1.0);
    }
    trail(goldStore, 1.3);
    if (gold && goldStore) paintPath(game.map, goldStore.x, goldStore.z, gold.x, gold.z, 1.2);
    trail(store, 1.2);
    if (wood && store) paintPath(game.map, store.x, store.z, wood.x, wood.z, 0.9);
    trail(nearBerry, 1.0);
    if (huntSpot && fields) paintPath(game.map, fields.x0 + fields.cols * 4 + 0.5, fields.z0 + 6, huntSpot[0], huntSpot[1], 0.9);
    dressYard(game, econ, goldStore, gold);

    const enemy = standardStart(game, ENEMY, e, 6);
    game.combat.ai.enabled = true;
    game.combat.ai.nextWaveAt = 1e9; // keep the economy scene peaceful
    void enemy;
    // frame the harbour, the hunt, the town centre and the fields together
    const pts = [[tc.x, tc.z]];
    if (fields) pts.push([fields.x0 + fields.cols * 2, fields.z0 + 6]);
    if (water) pts.push([water[0], water[1]]);
    const fx = pts.reduce((a, q) => a + q[0], 0) / pts.length, fz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    void fx; void fz;
    // frame the town centre, the mine and the field block tightly
    const fc = fields ? [fields.x0 + fields.cols * 2, fields.z0 + 6] : [tc.x + 8, tc.z + 4];
    const focus = { x: tc.x * 0.4 + fc[0] * 0.6 + 1, z: tc.z * 0.45 + fc[1] * 0.55 };
    return { focus, tc, fields, granary, farms, gold, goldStore, store, wood, nearBerry, huntSpot };
  },
  camera: (game, ctx) => ({ x: ctx.focus.x, z: ctx.focus.z, distance: 36, yaw: 18 }),
  // After the fast-forward: put a few porters mid-trip with full loads, so the
  // paths between the fields, the mine, the woodline and the drop-offs carry
  // traffic in the (paused) frame.
  after(game, ctx) {
    const econ = game.economy;
    const trips = [];
    const leg = (res, drop, k, dx = 0, dz = 0) => { if (res && drop) trips.push({ res, drop, k, dx, dz }); };
    const farmsW = (ctx.farms || []).filter((f) => ctx.fields && f.tx === ctx.fields.x0);
    leg(farmsW[0], ctx.tc, 0.55, 0, 0.4);
    leg(farmsW[farmsW.length - 1], ctx.tc, 0.35, 0.3, 0);
    const farE = (ctx.farms || []).filter((f) => ctx.fields && f.tz === ctx.fields.z0 + 8).pop();
    leg(farE, ctx.granary, 0.5);
    leg(ctx.gold, ctx.goldStore, 0.45, 0.4, 0.3);
    leg(ctx.gold, ctx.tc, 0.6, -0.3, 0);
    leg(ctx.wood, ctx.store, 0.5);
    leg(ctx.wood, ctx.tc, 0.55, 0.2, 0.5);
    leg(ctx.nearBerry, ctx.tc, 0.5);
    for (const { res, drop, k, dx, dz } of trips) {
      const ex = Math.max(drop.tx - 0.4, Math.min(drop.tx + drop.w + 0.4, res.x));
      const ez = Math.max(drop.tz - 0.4, Math.min(drop.tz + drop.h + 0.4, res.z));
      const w = openGround(game, res.x + (ex - res.x) * k + dx, res.z + (ez - res.z) * k + dz);
      if (!w) continue;
      const v = game.units.spawn('villager', PLAYER, w[0], w[1]);
      // (set up by hand: a farm already has its farmer, so a gather order
      // onto it would be refused)
      const resType = res.def?.farm ? 'food' : res.resType;
      v.order = { type: 'gather', targetId: res.id };
      v.econ = { phase: 'toDrop', resId: res.id, resType, dropId: drop.id, tries: 0, throwCd: 0.4 };
      v.carry = { type: resType, amount: v.def.carryCap || 10 };
      game.movement.moveTo(v, drop.x, drop.z, { goalRect: drop });
    }
    game.fastForward(0.3);
  },
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

// A worn, slightly wandering dirt track between two points (column resolution),
// painted only over grass so plazas and fields keep their ground.
function paintPath(map, x0, z0, x1, z1, width = 1.1) {
  const c = map.cps || 2;
  const len = Math.hypot(x1 - x0, z1 - z0);
  if (len < 0.5) return;
  const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
  const steps = Math.ceil(len * c * 2);
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wob = Math.sin(t * Math.PI) * Math.sin(t * 7.3 + x0 * 0.7) * 0.6;
    const px = x0 + (x1 - x0) * t + nx * wob, pz = z0 + (z1 - z0) * t + nz * wob;
    const hw = width * (0.8 + 0.3 * Math.sin(t * 11 + z0));
    const r = Math.ceil(hw * c);
    const ccx = px * c, ccz = pz * c;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const cx = Math.floor(ccx) + dx, cz = Math.floor(ccz) + dz;
        if (!map.inCols(cx, cz)) continue;
        if (Math.hypot(cx + 0.5 - ccx, cz + 0.5 - ccz) > hw * c) continue;
        const i2 = map.cIdx(cx, cz), g = map.ground[i2];
        if (g !== GROUND.GRASS && g !== GROUND.DRYGRASS) continue;
        if (map.isWaterCol(cx, cz)) continue;
        map.ground[i2] = GROUND.DIRT;
        bx0 = Math.min(bx0, cx); bz0 = Math.min(bz0, cz); bx1 = Math.max(bx1, cx + 1); bz1 = Math.max(bz1, cz + 1);
      }
  }
  if (bx1 > bx0) map.markDirty(bx0, bz0, bx1, bz1);
}

// Mining camp dressing: ore baskets, a crate of ore and a cart by the face.
function dressYard(game, econ, store, gold) {
  if (!store || !gold) return;
  const D = econ.decor;
  const dx = store.x - gold.x, dz = store.z - gold.z, d = Math.hypot(dx, dz) || 1;
  const mx = gold.x + (dx / d) * 2.2, mz = gold.z + (dz / d) * 2.2;
  D.push({ key: 'crate_gold', x: mx + (dz / d) * 1.3, z: mz - (dx / d) * 1.3, rot: 0.4, scale: 1.3 });
  D.push({ key: 'goldpile', x: mx - (dz / d) * 1.4, z: mz + (dx / d) * 1.4, rot: 1.1, scale: 1.1 });
  D.push({ key: 'sack', x: mx + (dz / d) * 1.9, z: mz - (dx / d) * 0.6, rot: 2.2, scale: 1.2 });
}
