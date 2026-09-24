import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';

// Greek voxel buildings described in code, styled after Age of Mythology:
// Retold's towns: white marble and pale ashlar, verdigris-green ribbed tile
// roofs, blue (team) trim, columns, pediments with acroteria, statues.
//
// Footprint origin is (0,0,0); a model spans [0, w*4) x [0, h*4) voxels. The
// front (door) faces +z, towards the default camera.
//
// Every builder takes (variant, m) so the construction system can pass a
// clipped model (see construction.js) and houses can vary.

// ---- palette ---------------------------------------------------------------
const MARBLE = (x, y, z) => { const h = hash3(x, y, z, 1); return h < 0.62 ? 0xf3efe6 : h < 0.9 ? 0xe9e4d8 : 0xdfd8c9; };
const MARBLE_SHADE = 0xd6cfbf;
const MARBLE_DARK = 0xbdb5a3;
// ashlar: running-bond blocks 3 voxels long, 2 high, each block its own tone
const ASHLAR = (x, y, z) => {
  const row = y >> 1;
  const u = x + z + (row & 1) * 2;
  const h = hash3(Math.floor(u / 3), row, (x - z) >> 3, 3);
  return h < 0.3 ? 0xe4ded2 : h < 0.6 ? 0xd9d2c3 : h < 0.85 ? 0xcec6b5 : 0xc2baa8;
};
const STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 2); return h < 0.45 ? 0xaea796 : h < 0.85 ? 0x9f9886 : 0xbab3a2; };
const PAVE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 8); return h < 0.4 ? 0xcfc6b1 : h < 0.8 ? 0xc4bba5 : 0xd8d0bd; };
const WOOD = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0x7a5230 : 0x8b6139);
const DARK = 0x2a211b;
const DOOR = (x, y, z) => ((x + z) % 2 ? 0x6b4527 : 0x5c3a20);
const BRONZE = 0xc99a3c;
const GOLD = 0xf2c14e;
const FIRE = 0xffa53a;
// verdigris tile roofs
const RIDGE = 0xe6e2d6;
const ROOF_EDGE = 0x6c887a;
const RIB = 0x7b9887;
const TILE = (x, y, z) => { const h = hash3(x, y, z, 5); return h < 0.45 ? 0x9cbaa8 : h < 0.85 ? 0x91b09d : 0xa8c4b2; };
const TERRACOTTA = (x, y, z) => (hash3(x, y, z, 9) < 0.5 ? 0xb8683e : 0xa65a34);

// ---- parts -----------------------------------------------------------------
function steps(m, x, z, w, d, n, colors = [STONE, MARBLE_SHADE, MARBLE]) {
  for (let i = 0; i < n; i++) m.box(x + i, i, z + i, w - 2 * i, 1, d - 2 * i, colors[Math.min(colors.length - 1, i + (colors.length - n))]);
  return n;
}

// 2x2 shaft with a 4x4 base and capital; (x, z) is the shaft's min corner.
function column(m, x, y, z, h) {
  m.box(x - 1, y, z - 1, 4, 1, 4, MARBLE_SHADE);
  m.box(x, y + 1, z, 2, h - 3, 2, (xx, yy, zz) => (((xx + zz + yy) & 3) === 0 ? MARBLE_SHADE : MARBLE(xx, yy, zz)));
  m.box(x - 1, y + h - 2, z - 1, 4, 1, 4, MARBLE);
  m.box(x - 1, y + h - 1, z - 1, 4, 1, 4, MARBLE_SHADE);
}

function colonnade(m, x0, z0, w, d, y, h, spacing = 3) {
  for (let x = x0; x <= x0 + w - 2; x += spacing) { column(m, x, y, z0, h); column(m, x, y, z0 + d - 2, h); }
  for (let z = z0 + spacing; z <= z0 + d - 2 - spacing; z += spacing) { column(m, x0, y, z, h); column(m, x0 + w - 2, y, z, h); }
}

// Entablature: architrave (marble), frieze of team triglyphs, cornice.
function entablature(m, x, y, z, w, d) {
  m.box(x, y, z, w, 1, d, MARBLE);
  m.box(x, y + 1, z, w, 1, d, (xx, yy, zz) => (((xx + zz) % 3) === 0 ? MARBLE_SHADE : TEAM));
  m.box(x - 1, y + 2, z - 1, w + 2, 1, d + 2, MARBLE);
  return y + 3;
}

// Gable roof over [x, x+w) x [z, z+d) starting at y. axis = direction of the
// ridge ('z': pediments on the front/back, 'x': pediments on the sides).
// Ribbed verdigris tiles running down the slope, marble ridge cap, raking
// marble cornice around a tympanum, optional acroteria. Returns the y above
// the ridge.
function gable(m, x, y, z, w, d, axis = 'z', { o = 1, tymp = MARBLE_SHADE, acro = true, roof = null } = {}) {
  const W = axis === 'z' ? w : d, D = axis === 'z' ? d : w;
  const put = (u, yy, v, c) => (axis === 'z' ? m.set(x + u, yy, z + v, c) : m.set(x + v, yy, z + u, c));
  let s = 0;
  for (; ; s++) {
    const ul = s - o, ur = W - 1 - s + o;
    if (ul > ur) break;
    const ridge = ur - ul <= 1;
    for (let v = -o; v < D + o; v++) {
      const edge = v === -o || v === D + o - 1;
      const c = ridge ? RIDGE : edge ? ROOF_EDGE : roof || ((v & 1) === 0 ? RIB : TILE);
      put(ul, y + s, v, c); put(ur, y + s, v, c);
      if (s === 0 && o > 0) continue;
      for (let u = ul + 1; u < ur; u++) {
        if (v === 0 || v === D - 1) put(u, y + s, v, u === ul + 1 || u === ur - 1 || s === 0 ? MARBLE : tymp);
        else if (v > 0 && v < D - 1) put(u, y + s, v, TILE);
      }
    }
  }
  if (acro) {
    const mid = Math.floor((W - 1) / 2);
    for (const v of [-o, D + o - 1]) {
      put(mid, y + s, v, TEAM);
      if (acro === 'gold') { put(mid, y + s + 1, v, GOLD); put(mid + (W & 1 ? 0 : 1), y + s, v, TEAM); }
      put(-o, y + 1, v, TEAM); put(W - 1 + o, y + 1, v, TEAM);
    }
  }
  return y + s;
}

// Hip (four-sided pyramid) roof, used on towers.
function hipRoof(m, x, y, z, w, d) {
  let s = 0;
  for (; w - 2 * s > 0 && d - 2 * s > 0; s++) {
    for (let i = x + s; i < x + w - s; i++) for (let k = z + s; k < z + d - s; k++) {
      const edge = i === x + s || i === x + w - s - 1 || k === z + s || k === z + d - s - 1;
      if (edge) m.set(i, y + s, k, ((i + k) & 1) ? TILE : RIB);
    }
  }
  m.set(x + (w >> 1), y + s, z + (d >> 1), GOLD);
  return y + s;
}

function brazier(m, x, y, z) {
  m.box(x, y, z, 2, 1, 2, MARBLE_SHADE);
  m.box(x, y + 1, z, 2, 2, 2, MARBLE);
  m.box(x - 0 , y + 3, z, 2, 1, 2, BRONZE);
  m.box(x, y + 4, z, 2, 1, 2, FIRE, { glow: 1 });
  m.set(x, y + 5, z + 1, 0xffd27a, { glow: 1 });
}

function banner(m, x, y, z, h = 5, axis = 'x') {
  m.box(x, y, z, 1, h + 3, 1, BRONZE);
  if (axis === 'x') { m.box(x + 1, y + h + 2, z, 2, 1, 1, BRONZE); m.box(x + 1, y + 2, z, 2, h, 1, TEAM); m.box(x + 1, y + 2, z, 2, 1, 1, GOLD); }
  else { m.box(x, y + h + 2, z + 1, 1, 1, 2, BRONZE); m.box(x, y + 2, z + 1, 1, h, 2, TEAM); m.box(x, y + 2, z + 1, 1, 1, 2, GOLD); }
  m.set(x, y + h + 3, z, GOLD);
}

function amphora(m, x, y, z, c = 0xb8683e) {
  m.set(x, y, z, c).set(x, y + 1, z, c).set(x, y + 2, z, 0x8f4f2c);
}

function cypress(m, x, y, z, h = 10) {
  m.box(x, y, z, 1, 2, 1, 0x5a3e26);
  for (let j = 1; j < h; j++) {
    const r = j < 2 || j > h - 3 ? 0 : 1;
    m.box(x - r, y + j, z - r, 1 + 2 * r, 1, 1 + 2 * r, (xx, yy, zz) => (hash3(xx, yy, zz, 12) < 0.5 ? 0x3d6b2f : 0x4a7b36));
  }
}

// Marble statue of a god on a pedestal: robe, torso, raised arm with a
// golden thunderbolt. (x, z) = pedestal min corner (pedestal is 4x4).
function statue(m, x, y, z, { color = MARBLE, bolt = true } = {}) {
  m.box(x - 1, y, z - 1, 6, 1, 6, MARBLE_SHADE);
  m.box(x, y + 1, z, 4, 3, 4, MARBLE);
  m.box(x, y + 2, z, 4, 1, 4, TEAM);
  m.box(x - 1, y + 4, z - 1, 6, 1, 6, MARBLE_SHADE);
  const b = y + 5;
  m.box(x, b, z + 1, 4, 4, 3, color);         // robe
  m.box(x + 1, b + 4, z + 1, 2, 1, 2, color);  // waist
  m.box(x, b + 5, z + 1, 4, 3, 2, color);      // chest
  m.box(x + 1, b + 8, z + 1, 2, 2, 2, color);  // head
  m.box(x + 1, b + 10, z + 1, 2, 1, 2, MARBLE_SHADE); // hair / laurel
  m.box(x - 1, b + 5, z + 1, 1, 2, 1, color);  // left arm down
  m.box(x + 4, b + 7, z + 1, 1, 3, 1, color);  // right arm raised
  if (bolt) {
    m.set(x + 4, b + 10, z + 1, GOLD, { glow: 0.5 }).set(x + 5, b + 11, z + 1, GOLD, { glow: 0.5 }).set(x + 4, b + 12, z + 1, GOLD, { glow: 0.5 });
  }
}

// Colossal marble statue of Zeus for the Town Center forecourt: tall
// pedestal with a team band, robed figure, raised arm with a glowing golden
// thunderbolt. (x, z) = pedestal min corner, pedestal is 6x6.
function colossus(m, x, y, z) {
  m.box(x - 1, y, z - 1, 8, 1, 8, MARBLE_SHADE);
  m.box(x, y + 1, z, 6, 4, 6, MARBLE);
  m.box(x, y + 3, z, 6, 1, 6, TEAM);
  m.box(x - 1, y + 5, z - 1, 8, 1, 8, MARBLE_SHADE);
  const b = y + 6, C = MARBLE, F = (xx, yy, zz) => ((xx + yy) % 3 === 0 ? MARBLE_SHADE : MARBLE(xx, yy, zz)); // robe folds
  m.box(x + 1, b, z + 1, 4, 7, 4, F);          // robe to the knees
  m.box(x + 1, b, z + 5, 1, 1, 1, C).box(x + 4, b, z + 5, 1, 1, 1, C); // feet
  m.box(x + 1, b + 7, z + 2, 4, 2, 3, F);      // waist / himation fold
  m.box(x, b + 9, z + 2, 6, 4, 3, C);          // chest and shoulders
  m.box(x + 2, b + 13, z + 2, 2, 1, 2, C);     // neck
  m.box(x + 1, b + 14, z + 2, 4, 3, 3, C);     // head
  m.box(x + 1, b + 13, z + 4, 4, 2, 1, MARBLE_SHADE); // beard
  m.box(x + 1, b + 17, z + 2, 4, 1, 3, MARBLE_SHADE); // hair / laurel
  m.box(x - 1, b + 6, z + 3, 1, 4, 1, C);      // left arm down, holding a sceptre
  m.box(x - 2, b + 1, z + 3, 1, 12, 1, BRONZE).set(x - 2, b + 13, z + 3, GOLD);
  m.box(x + 6, b + 11, z + 3, 1, 2, 1, C);     // right arm raised
  m.box(x + 7, b + 12, z + 3, 1, 4, 1, C);
  for (const [dx, dy] of [[7, 16], [8, 17], [7, 18], [8, 19], [7, 20]]) m.set(x + dx, b + dy, z + 3, GOLD, { glow: 0.8 });
}

// ---- buildings ---------------------------------------------------------------
export function townCenterModel(variant = 0, m = new VoxelModel()) {
  const S = 28;
  const y = steps(m, 0, 0, S, S, 2, [STONE, PAVE]);
  // ---- great hall at the back, colonnaded front and pediment on the plaza
  m.box(4, y, 2, 20, 10, 11, ASHLAR);
  m.box(4, y, 2, 20, 1, 11, STONE);
  m.box(3, y, 12, 22, 1, 5, MARBLE_SHADE);       // portico floor
  for (let i = 0; i < 6; i++) column(m, 4 + Math.round(i * 3.6), y + 1, 14, 9);
  m.box(11, y, 12, 6, 6, 1, DOOR);
  m.box(10, y + 6, 12, 8, 1, 1, MARBLE);
  for (const x of [6, 20]) m.box(x, y + 4, 12, 2, 3, 1, DARK);
  for (const z of [5, 9]) { m.box(3, y + 5, z, 1, 3, 2, DARK); m.box(24, y + 5, z, 1, 3, 2, DARK); }
  // side colonnades (peripteral hall)
  m.box(1, y, 2, 3, 1, 15, MARBLE_SHADE); m.box(24, y, 2, 3, 1, 15, MARBLE_SHADE);
  for (const z of [3, 7, 11, 14]) { column(m, 1, y + 1, z, 9); column(m, 25, y + 1, z, 9); }
  const t = entablature(m, 1, y + 10, 2, 26, 15);
  gable(m, 1, t, 2, 26, 15, 'z', { o: 1, acro: 'gold' });
  // ---- side stoas framing the forecourt (short columns, lean-to roofs)
  for (const [sx, dir] of [[1, 1], [23, -1]]) {
    m.box(sx, y, 18, 4, 1, 9, MARBLE_SHADE);
    const back = dir > 0 ? sx : sx + 3;
    m.box(back, y, 18, 1, 6, 9, ASHLAR);
    for (const z of [18, 22, 25]) m.box(dir > 0 ? sx + 2 : sx, y + 1, z, 2, 5, 1, MARBLE);
    m.box(sx, y + 6, 18, 4, 1, 9, TEAM);
    for (let i = 0; i < 4; i++) {
      const x = dir > 0 ? sx + i : sx + 3 - i;
      m.box(x, y + 7 + (i < 2 ? 1 : 0) - (i === 3 ? 0 : 0), 17, 1, 1, 11, i === 3 ? ROOF_EDGE : (xx, yy, zz) => ((zz & 1) ? TILE(xx, yy, zz) : RIB));
    }
  }
  // ---- forecourt: colossus of the patron god, braziers, banners, cypresses
  colossus(m, 11, y, 19);
  brazier(m, 7, y, 20); brazier(m, 19, y, 20);
  brazier(m, 7, y, 25); brazier(m, 19, y, 25);
  banner(m, 10, y, 26, 5, 'x'); banner(m, 16, y, 26, 5, 'x');
  cypress(m, 1, y, 14, 12); cypress(m, 26, y, 14, 12);
  return m;
}

// Three house variants: pedimented cottage with a porch, courtyard house with
// a lean-to, and an L-shaped house with a side wing.
export function houseModel(variant = 0, m = new VoxelModel()) {
  m.box(0, 0, 0, 12, 1, 12, STONE);
  if (variant === 1) {
    // ridge along x, gable ends on the sides, lean-to and pergola in front
    m.box(1, 1, 1, 10, 6, 7, ASHLAR);
    m.box(1, 1, 1, 10, 1, 7, STONE);
    m.box(1, 7, 1, 10, 1, 7, TEAM);
    m.box(0, 8, 0, 12, 1, 9, MARBLE);
    gable(m, 1, 9, 1, 10, 7, 'x', { o: 1 });
    m.box(4, 1, 7, 2, 4, 1, DOOR); m.box(8, 3, 7, 2, 2, 1, DARK);
    // pergola / porch posts with a light roof
    for (const x of [1, 5, 10]) m.box(x, 1, 10, 1, 5, 1, MARBLE);
    m.box(1, 6, 8, 10, 1, 3, (x, y, z) => ((x & 1) ? WOOD(x, y, z) : 0x6f8f4a));
    amphora(m, 2, 1, 9); amphora(m, 3, 1, 9, 0xa65a34);
    m.box(7, 1, 9, 2, 1, 1, 0x9b7040);
    // chimney
    m.box(8, 12, 3, 2, 3, 2, ASHLAR); m.set(8, 15, 3, 0x3a3430);
    return m;
  }
  if (variant === 2) {
    // L-shape: tall block on the left, lower wing on the right
    m.box(1, 1, 1, 6, 7, 10, ASHLAR);
    m.box(1, 1, 1, 6, 1, 10, STONE);
    m.box(1, 8, 1, 6, 1, 10, TEAM);
    m.box(0, 9, 0, 8, 1, 12, MARBLE);
    gable(m, 1, 10, 1, 6, 10, 'z', { o: 1 });
    m.box(3, 1, 10, 2, 4, 1, DOOR); m.box(3, 5, 10, 2, 1, 1, MARBLE);
    m.box(7, 1, 4, 4, 5, 6, ASHLAR);
    m.box(7, 1, 4, 4, 1, 6, STONE);
    m.box(7, 6, 4, 4, 1, 6, MARBLE);
    gable(m, 7, 7, 4, 4, 6, 'x', { o: 1, acro: false });
    m.box(10, 3, 6, 1, 2, 2, DARK);
    m.box(8, 1, 10, 1, 3, 1, MARBLE).box(10, 1, 10, 1, 3, 1, MARBLE);
    amphora(m, 9, 1, 11);
    return m;
  }
  // variant 0: cottage with a two-column porch under the front pediment
  m.box(1, 1, 1, 10, 6, 7, ASHLAR);
  m.box(1, 1, 1, 10, 1, 7, STONE);
  m.box(4, 1, 7, 3, 4, 1, DOOR); m.box(3, 5, 7, 5, 1, 1, MARBLE);
  m.box(1, 4, 4, 1, 2, 2, DARK); m.box(10, 4, 4, 1, 2, 2, DARK);
  m.box(1, 1, 8, 10, 1, 3, PAVE);
  column(m, 2, 1, 9, 6); column(m, 8, 1, 9, 6);
  m.box(1, 7, 1, 10, 1, 10, TEAM);
  m.box(0, 8, 0, 12, 1, 12, MARBLE);
  gable(m, 1, 9, 1, 10, 10, 'z', { o: 1 });
  m.box(8, 13, 2, 2, 3, 2, ASHLAR); m.set(8, 16, 2, 0x3a3430);
  amphora(m, 11, 1, 9);
  return m;
}

export function storehouseModel(variant = 0, m = new VoxelModel()) {
  m.box(0, 0, 0, 12, 1, 12, STONE);
  m.box(1, 1, 1, 10, 1, 10, PAVE);
  // back wall of ashlar, open colonnaded front
  m.box(1, 1, 1, 10, 7, 2, ASHLAR);
  m.box(1, 1, 1, 2, 7, 6, ASHLAR);
  for (const x of [1, 5, 9]) { m.box(x, 1, 9, 2, 7, 2, MARBLE); m.box(x, 1, 9, 2, 1, 2, MARBLE_SHADE); }
  m.box(10, 1, 3, 1, 7, 1, MARBLE); m.box(10, 1, 6, 1, 7, 1, MARBLE);
  m.box(1, 8, 1, 10, 1, 10, TEAM);
  m.box(0, 9, 0, 12, 1, 12, MARBLE);
  gable(m, 1, 10, 1, 10, 10, 'x', { o: 1 });
  // goods: crates, amphorae, a log pile, gold and grain sacks
  m.box(3, 2, 3, 2, 2, 2, 0x9b7040).box(3, 4, 3, 2, 1, 2, 0x8a6236);
  m.box(5, 2, 3, 2, 2, 2, 0xa27a48);
  for (let i = 0; i < 3; i++) m.box(7, 2 + i, 3 + (i % 2), 3, 1, 1, 0x6e4526);
  amphora(m, 3, 2, 6); amphora(m, 4, 2, 7, 0xa65a34); amphora(m, 3, 2, 8);
  m.box(7, 2, 6, 2, 1, 2, GOLD, { glow: 0.1 }).set(7, 3, 6, GOLD, { glow: 0.1 });
  m.box(6, 2, 8, 2, 1, 1, 0xd8c79a);
  // crates stacked outside
  m.box(10, 1, 10, 2, 2, 2, 0x9b7040).box(10, 3, 10, 1, 1, 1, 0xa27a48);
  return m;
}

export function farmModel(variant = 0, m = new VoxelModel()) {
  const S = 16;
  // fence: posts and rails
  for (let i = 0; i < S; i += 1) {
    const post = i % 3 === 0;
    const c = post ? WOOD : 0x9a7348;
    for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) {
      m.set(x, 0, z, c);
      if (post) m.set(x, 1, z, WOOD);
    }
  }
  m.carve(7, 0, S - 1, 2, 2, 1);
  // crop rows: leafy green with ripening wheat heads
  for (let z = 2; z < S - 2; z += 2)
    for (let x = 2; x < S - 2; x++) {
      const h = hash3(x, 0, z, 9);
      if (h < 0.92) m.set(x, 0, z, h < 0.45 ? 0x5f8a2e : 0x6f9a36);
      if (h < 0.6) m.set(x, 1, z, h < 0.3 ? 0xd9c35a : 0x86a83c);
    }
  // hay bale and a little shrine post
  m.box(1, 0, 1, 2, 1, 1, 0xd8c079);
  m.box(S - 3, 0, 1, 1, 3, 1, MARBLE).set(S - 3, 3, 1, TEAM);
  return m;
}

export function templeModel(variant = 0, m = new VoxelModel()) {
  const W = 20, D = 24;
  const y = steps(m, 0, 0, W, D, 3, [STONE, MARBLE_SHADE, MARBLE]);
  // cella
  m.box(5, y, 6, 10, 10, 13, ASHLAR);
  m.box(8, y, 18, 4, 7, 1, DOOR);
  m.box(7, y + 7, 18, 6, 1, 1, MARBLE);
  // peristyle
  colonnade(m, 3, 3, W - 5, D - 5, y, 11, 3);
  const t = entablature(m, 3, y + 11, 3, W - 6, D - 6);
  gable(m, 3, t, 3, W - 6, D - 6, 'z', { o: 1, acro: 'gold' });
  // golden statue of the god on the front steps & sacred braziers
  statue(m, 8, 0, 20, { color: MARBLE, bolt: true });
  brazier(m, 1, y, 21); brazier(m, 17, y, 21);
  cypress(m, 0, 0, 0, 12);
  return m;
}

function archeryTarget(m, x, y, z) {
  m.box(x + 1, y, z, 1, 2, 1, WOOD);
  const ring = [0xf0ebe0, 0xc0392b, 0xf0ebe0];
  for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
    const c = dx === 1 && dy === 1 ? 0xc0392b : (dx + dy) % 2 ? ring[0] : 0xd8c079;
    m.set(x + dx, y + 2 + dy, z, c);
  }
}

export function barracksModel(variant = 0, m = new VoxelModel()) {
  const S = 20;
  m.box(0, 0, 0, S, 1, S, STONE);
  m.box(2, 1, 10, 16, 1, 8, (x, y, z) => (hash3(x, y, z, 14) < 0.5 ? 0xc9b48c : 0xbba57e)); // sand yard
  // yard walls with a marble coping and team band
  const wall = (x, z, w, d) => { m.box(x, 1, z, w, 4, d, ASHLAR); m.box(x, 5, z, w, 1, d, MARBLE); };
  wall(0, 0, 2, S); wall(S - 2, 0, 2, S);
  wall(0, S - 2, 7, 2); wall(13, S - 2, 7, 2);
  m.box(0, 4, 0, 2, 1, S, TEAM); m.box(S - 2, 4, 0, 2, 1, S, TEAM);
  // main hall at the back with a colonnaded front
  m.box(2, 1, 1, 16, 8, 7, ASHLAR);
  m.box(8, 1, 7, 4, 5, 1, DOOR);
  for (let x = 3; x < 18; x += 4) { m.box(x, 1, 8, 2, 8, 2, MARBLE); m.box(x - 1, 1, 7, 4, 1, 4, MARBLE_SHADE); }
  m.box(2, 9, 1, 16, 1, 9, TEAM);
  m.box(1, 10, 0, 18, 1, 11, MARBLE);
  gable(m, 2, 11, 1, 16, 9, 'x', { o: 1 });
  // gate towers with hip roofs and banners
  for (const tx of [5, 12]) {
    m.box(tx, 1, S - 3, 3, 9, 3, ASHLAR);
    m.box(tx, 8, S - 3, 3, 1, 3, TEAM);
    m.box(tx - 1, 10, S - 4, 5, 1, 5, MARBLE);
    hipRoof(m, tx - 1, 11, S - 4, 5, 5);
  }
  banner(m, 8, 1, S - 1, 5, 'x');
  // weapon rack, archery targets and a training dummy in the yard
  m.box(3, 2, 11, 1, 4, 1, WOOD).box(6, 2, 11, 1, 4, 1, WOOD).box(3, 5, 11, 4, 1, 1, WOOD);
  for (const x of [4, 5]) { m.box(x, 2, 11, 1, 5, 1, 0x9aa0a6); m.set(x, 7, 11, 0xc9ced3); }
  archeryTarget(m, 13, 2, 11);
  archeryTarget(m, 9, 2, 12);
  m.box(15, 2, 15, 1, 4, 1, WOOD).box(14, 5, 15, 3, 1, 1, WOOD).box(15, 6, 15, 1, 2, 1, 0xc9b27a);
  m.box(3, 2, 15, 2, 1, 2, 0xd8c079);
  return m;
}

export const BUILDING_MODELS = {
  town_center: townCenterModel,
  house: houseModel,
  storehouse: storehouseModel,
  farm: farmModel,
  temple: templeModel,
  barracks: barracksModel,
};

// Number of visual variants per type (picked per building from its tile).
export const BUILDING_VARIANTS = { house: 3 };

export { WOOD, STONE, MARBLE, MARBLE_SHADE, MARBLE_DARK, ASHLAR, TERRACOTTA };
