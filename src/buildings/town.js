import { GROUND } from '../core/GameMap.js';
import { hash3 } from '../core/rng.js';
import { HOUSE_PLANS, HOUSE_TINTS } from './models.js';

// A planned Greek town (Hippodamian grid) round a start position, used by the
// town / coast / hud scenes through buildings.layoutTown(owner, start).
//
// All coordinates are tile offsets from the start tile (the Town Center's
// centre). Buildings face +z (their doors and porches), which is the side the
// default RTS camera looks at, so every row fronts onto a street to its +z.
//
//        -z (far, top of screen)
//   row B houses      |  temenos: stepped two-level platform, temple at the
//   ---- lane ----    |  back, open forecourt with altar and statues
//   row A houses      |       N street
//   ===== main street ===== AGORA (Town Center) ===== main street =====
//   row C houses      |       S street        farms (east)
//   ---- lane ----    |
//   row D: academy, houses
//        +z (near, bottom of screen)
//
// Houses stand 3 x 3 with a walled side courtyard (a prop), one tile of
// alley and the next house: two clear tiles between walls. Each slot is
// tried where planned; a slot that does not fit (cliff, water, a mine) is
// nudged a tile or dropped, so the plan survives other maps (coast).

const S = {
  agora: [-6, -6, 6, 6],                   // [x0, z0, x1, z1] inclusive
  temenos: [-6, -20, 6, -8],
  sanctum: [-4, -19, 4, -9],              // the upper step of the temenos
  streets: [
    [-25, -1, 22, 1],                      // main street, east-west, 3 wide
    [-1, -7, 1, 18],                       // north-south: temenos gate to the fields
    [-25, -9, -7, -8],                     // lane in front of row B
    [-25, 7, -2, 8],                       // lane in front of row C
    [-8, -9, -7, 16],                      // west cross street
  ],
  // [type, dx, dz] footprint corners
  temple: [-2, -17],
  barracks: [-14, 10],
  store: [18, -5],                         // wood yard at the eastern forest edge
  store2: [13, -5],                        // by the gold mine
  // [dx, dz, plan, yaw]: plans (models.js houseModel) 0 courtyard house
  // (back range + street wing round a walled court), 1 gable-fronted hall
  // behind a walled yard, 2 hipped block with a walled side court. Rows
  // alternate plans; most houses front their street, a few turn a side.
  houses: [
    [-11, -5, 0, 0], [-14, -5, 1, 0], [-18, -6, 2, 0], [-23, -5, 0, 0],                       // row A
    [-12, -12, 1, 0], [-16, -13, 2, 0], [-20, -12, 0, 0], [-23, -12, 1, Math.PI / 2],        // row B
    [-11, 3, 2, 0], [-15, 3, 0, 0], [-18, 3, 1, 0], [-23, 4, 2, -Math.PI / 2],               // row C
    [-20, 10, 0, Math.PI / 2],             // row D, beside the academy
    [-6, 15, 1, 0], [3, 13, 0, 0],         // along the south street
  ],
  house2: [-6, 10],                        // being built, on the south street corner
  farms: [[9, 3], [14, 3], [9, 9]],
};

export function layoutTown(game, owner, start) {
  const map = game.map, B = game.buildings;
  const sx = start.tx, sz = start.tz;
  const rect = ([x0, z0, x1, z1]) => [sx + x0, sz + z0, x1 - x0 + 1, z1 - z0 + 1];

  // clear straggler trees from everything the plan covers (not mines or bushes)
  const clearTrees = (tx, tz, w, h) => {
    for (const e of [...game.entities.resources()])
      if (e.resType === 'wood' && e.tx < tx + w && e.tx + (e.w || 1) > tx && e.tz < tz + h && e.tz + (e.h || 1) > tz)
        game.terrain.removeResource(e);
  };
  for (const r of [S.agora, S.temenos, ...S.streets]) clearTrees(...rect(r));
  for (const [dx, dz] of [...S.houses, S.house2]) clearTrees(sx + dx - 1, sz + dz - 1, 6, 5);
  clearTrees(sx + S.barracks[0], sz + S.barracks[1], 5, 5);
  for (const [dx, dz] of [S.store, S.store2]) clearTrees(sx + dx - 2, sz + dz - 2, 7, 6);

  // Town Center on the agora
  const tc = B.spawn('town_center', owner, sx - 3, sz - 3, { built: true, site: false });
  const L0 = map.tileRectStats(sx - 3, sz - 3, 7, 7).min;

  // temenos: a two-step paved platform, only where the ground is flat and dry
  let temenosOk = false;
  {
    const [tx, tz, w, h] = rect(S.temenos);
    const st = map.tileRectStats(tx, tz, w, h);
    let walk = true;
    for (let z = tz; z < tz + h && walk; z++) for (let x = tx; x < tx + w; x++) if (!map.isTerrainPassable(x, z) || B.inFootprint(x, z)) { walk = false; break; }
    if (walk && !st.water && st.max - st.min <= 2 && st.min >= L0 - 1) {
      temenosOk = true;
      map.flattenTiles(tx, tz, w, h, L0 + 1, GROUND.PAVED);
      const [ix, iz, iw, ih] = rect(S.sanctum);
      map.flattenTiles(ix, iz, iw, ih, L0 + 2, GROUND.PAVED);
    }
  }

  const tryAt = (type, dx, dz, opts = {}, nudge = 1) => {
    for (let r = 0; r <= nudge; r++)
      for (const [ox, oz] of r === 0 ? [[0, 0]] : [[0, r], [r, 0], [-r, 0], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
        const tx = sx + dx + ox, tz = sz + dz + oz;
        if (!B.canPlace(type, tx, tz)) continue;
        return B.spawn(type, owner, tx, tz, { built: true, site: false, ...opts });
      }
    return null;
  };
  // fallback for the key buildings: spiral out from the planned spot
  const spiral = (type, dx, dz, opts = {}) => tryAt(type, dx, dz, opts, 1) || tryAt(type, dx, dz, opts, 6);

  const temple = spiral('temple', ...S.temple);
  if (temple && temenosOk) temple.bld_temenos = rect(S.temenos);
  const store2 = spiral('storehouse', ...S.store2);
  const store = spiral('storehouse', ...S.store);
  const barracks = spiral('barracks', ...S.barracks);
  const houses = [];
  S.houses.forEach(([dx, dz, plan, yaw], i) => {
    const h = tryAt('house', dx, dz);
    if (!h) return;
    // each house its own roof tint, never the same as the one before it
    h.bld_variant = plan + HOUSE_PLANS * ((i * 3) % HOUSE_TINTS);
    h.bld_yaw = yaw;
    houses.push(h);
  });
  const farms = [];
  for (const [dx, dz] of S.farms) { const f = tryAt('farm', dx, dz); if (f) farms.push(f); }
  const house2 = tryAt('house', ...S.house2, { built: false });
  if (house2) { house2.progress = 0.55; house2.hp = house2.maxHp * (0.1 + 0.9 * 0.55); }

  // ---- ground: agora, streets, forecourts, courtyards
  const paint = (x, z, g, over = null) => {
    if (!map.isTerrainPassable(x, z) || B.inFootprint(x, z)) return;
    const cur = B.groundAt(x, z);
    if (cur < 0 || cur === GROUND.FARM || cur === GROUND.SAND || cur === GROUND.ROCK) return;
    if (over && !over.includes(cur)) return;
    const st = map.tileRectStats(x, z, 1, 1);
    if (st.water) return;
    map.paintTiles(x, z, 1, 1, g);
  };
  const fill = ([x0, z0, x1, z1], g, over) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) paint(sx + x, sz + z, g, over);
  };
  fill(S.agora, GROUND.PAVED);
  for (const s of S.streets) fill(s, GROUND.PAVED);
  // worn-earth shoulders along the streets where they meet grass, ragged
  const grass = [GROUND.GRASS, GROUND.DRYGRASS];
  for (const [x0, z0, x1, z1] of S.streets) {
    const along = x1 - x0 > z1 - z0;
    for (let a = along ? x0 : z0; a <= (along ? x1 : z1); a++)
      for (const side of along ? [z0 - 1, z1 + 1] : [x0 - 1, x1 + 1]) {
        const x = along ? a : side, z = along ? side : a;
        if (hash3(sx + x, 12, sz + z, 49) < 0.45) paint(sx + x, sz + z, GROUND.DIRT, grass);
      }
  }
  // every house and storehouse: a paved forecourt onto its street, and a
  // packed-earth side court (the courtyard prop sits on it)
  for (const b of [...houses, store, store2, house2]) {
    if (!b) continue;
    for (let x = b.tx - 1; x <= b.tx + b.w; x++) paint(x, b.tz + b.h, GROUND.PAVED);
    for (let z = b.tz; z < b.tz + b.h; z++) paint(b.tx + b.w, z, GROUND.DIRT, grass);
  }
  // work yards round the storehouses
  for (const b of [store, store2]) {
    if (!b) continue;
    for (let z = b.tz - 1; z < b.tz + b.h; z++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) paint(x, z, GROUND.DIRT, grass);
  }
  // the academy's drill ground in front
  if (barracks) for (let x = barracks.tx - 1; x <= barracks.tx + barracks.w; x++) paint(x, barracks.tz + barracks.h, GROUND.DIRT, grass);

  return { tc, houses, temple, barracks, farms, store, store2, house2 };
}
