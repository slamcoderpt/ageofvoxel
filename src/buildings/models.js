import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';

// Greek voxel buildings described in code, styled after Age of Mythology:
// Retold's towns: white marble and plastered walls on stone plinths, shallow
// terracotta tile roofs, blue (team) trim, octagonal columns on stepped
// stylobates, pediments with painted tympana, colourful friezes.
//
// Footprint origin is (0,0,0); a model spans [0, w*4) x [0, h*4) voxels (roof
// eaves may overhang by one voxel). The front (door) faces +z; the default
// camera looks from the +x/+z corner, so the +x side is the second show face.
//
// Every builder takes (variant, m) so the construction system can pass a
// recording model (see construction.js) and houses can vary.

// ---- palette ---------------------------------------------------------------
const pick = (h, cols) => cols[Math.min(cols.length - 1, Math.floor(h * cols.length))];
const MARBLE = (x, y, z) => { const h = hash3(x, y, z, 1); return h < 0.62 ? 0xf3efe6 : h < 0.9 ? 0xe9e4d8 : 0xdfd8c9; };
const MARBLE_SHADE = 0xd6cfbf;
const MARBLE_DARK = 0xbdb5a3;
// Dressed masonry: running-bond blocks `len` voxels long and `course` high.
// Every block gets its own tone, each course leans to one of two stone
// families (two-tone coursing), bed joints are a darker row and head joints a
// slightly darker column, and the lowest courses are weathered darker.
function masonry(tonesA, tonesB, { len = 4, course = 3, bed = 0.84, head = 0.92, grime = 4, seed = 3 } = {}) {
  return (x, y, z) => {
    const row = Math.floor(y / course);
    const u = x + z + (row & 1) * (len >> 1);
    const blk = Math.floor(u / len);
    const h = hash3(blk, row, (x - z) >> 3, seed);
    const fam = hash3(row, 1, (x - z) >> 3, seed + 1) < 0.5 ? tonesA : tonesB;
    let c = pick(h, fam);
    if (y % course === 0) c = shade(c, bed);
    else if (((u % len) + len) % len === 0) c = shade(c, head);
    if (y < grime) c = shade(c, 0.9 + 0.025 * y);
    return c;
  };
}
const ASHLAR = masonry([0xe8e2d5, 0xddd6c7, 0xd3cbba], [0xcdc3ae, 0xc1b7a1, 0xd6cdb9], { bed: 0.76, head: 0.86, seed: 3 });
// house walls: pale limestone blocks, two families so neighbouring houses differ
const PLASTER = masonry([0xf2eee4, 0xebe6da, 0xe4ded0], [0xe0d9ca, 0xd8d0bf, 0xe8e2d5], { len: 5, course: 3, bed: 0.76, head: 0.88, seed: 17 });
const PLASTER_WARM = masonry([0xf0e5cd, 0xe9dcc0, 0xe2d3b4], [0xdccdae, 0xd4c4a3, 0xe6d9bd], { len: 5, course: 3, bed: 0.76, head: 0.88, seed: 18 });
// darker stone for the stepped base (stylobate / socle) under the walls
const BASE_STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 21); return h < 0.4 ? 0x8d8676 : h < 0.8 ? 0x7f786a : 0x9a9382; };
const PAINT_BLUE = 0x34528a;   // painted (fixed) frieze blue, not team colour
const PAINT_BLUE_D = 0x28406e;
const GILT = 0xd2a847;         // painted gold fillets
const STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 2); return h < 0.45 ? 0xaea796 : h < 0.85 ? 0x9f9886 : 0xbab3a2; };
const PAVE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 8); return h < 0.4 ? 0xcfc6b1 : h < 0.8 ? 0xc4bba5 : 0xd8d0bd; };
const ROOFDECK = (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 19), [0xd9ccb0, 0xd1c3a5, 0xcdbd9c]);
const WOOD = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0x7a5230 : 0x8b6139);
const DARKWOOD = 0x5a3b22;
const DARK = 0x2a211b;
const DOOR = (x, y, z) => ((x + z) % 2 ? 0x6b4527 : 0x5c3a20);
const BRONZE = 0xc99a3c;
const GOLD = 0xf2c14e;
const GOLD_CAP = 0xe0b04a;
const FIRE = 0xffa53a;
const RED = 0xa8372a;       // painted metopes
const OCHRE = 0xd49a3a;
const LEAF = (x, y, z) => pick(hash3(x, y, z, 12), [0x3d6b2f, 0x4a7b36, 0x55863b, 0x416f31]);
const OLIVE = (x, y, z) => pick(hash3(x, y, z, 13), [0x7d8f4e, 0x6f8445, 0x8a9a5a]);
// terracotta roof tiles: every tile its own fired tone, cover-tile rows
// (imbrices) darker than the pans between them
const TERRA_TONES = [0xf08a4a, 0xe57c3e, 0xf79a5a, 0xdc7038, 0xeb8446, 0xfaa868, 0xd4682f];
const MARBLE_TILE_TONES = [0xe8e6dc, 0xdedcd0, 0xf0eee6, 0xd4d6cb, 0xe2e3d9];
const SAGE_TONES = [0x94b095, 0xa2bca0, 0x88a78b, 0xadc5a8, 0x8fac90, 0x9bb697];
const TERRACOTTA = (x, y, z) => pick(hash3(x, y, z, 9), TERRA_TONES);
const RIDGE_T = 0xb4532a;
const EAVE_T = 0xc0602e;
const ROOF_TONES = {
  terra: { tones: TERRA_TONES, ridge: RIDGE_T, eave: EAVE_T, cap: 0x9a4322, antefix: 0xd0703e, rib: 0.86 },
  marble: { tones: MARBLE_TILE_TONES, ridge: 0xa9aa9c, eave: 0xa7a89a, cap: 0x9a9c8e, antefix: 0xf5f2ea, rib: 0.82 },
  // weathered sage-green glazed tiles (Retold temples / civic roofs)
  sage: { tones: SAGE_TONES, ridge: 0x62806c, eave: 0x6f8a78, cap: 0x55705f, antefix: 0xc8d8c4, rib: 0.72 },
};
const shade = (c, f) => {
  const r = Math.round(((c >> 16) & 255) * f), g = Math.round(((c >> 8) & 255) * f), b = Math.round((c & 255) * f);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
};

// ---- parts -----------------------------------------------------------------
function steps(m, x, z, w, d, n, colors = [STONE, MARBLE_SHADE, MARBLE], y0 = 0) {
  for (let i = 0; i < n; i++) m.box(x + i, y0 + i, z + i, w - 2 * i, 1, d - 2 * i, colors[Math.min(colors.length - 1, i + (colors.length - n))]);
  return y0 + n;
}

// Fluted marble: vertical grooves as alternating tones.
const FLUTE = (xx, yy, zz) => (((xx + zz) & 1) ? MARBLE(xx, yy, zz) : 0xe0d9ca);

// Octagonal column, 4 voxels across (4x4 minus the corners), square plinth,
// flared echinus and a wide abacus. (x, z) = shaft min corner.
function column4(m, x, y, z, h) {
  m.box(x, y, z, 4, 1, 4, MARBLE_SHADE);
  for (let yy = y + 1; yy < y + h - 2; yy++)
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) {
      if ((i === 0 || i === 3) && (k === 0 || k === 3)) continue;
      m.set(x + i, yy, z + k, FLUTE);
    }
  m.box(x, y + h - 2, z, 4, 1, 4, MARBLE);
  for (let i = -1; i < 5; i++) for (let k = -1; k < 5; k++) {
    if ((i === -1 || i === 4) && (k === -1 || k === 4)) continue;
    m.set(x + i, y + h - 1, z + k, MARBLE_SHADE);
  }
}

// Round-ish column 3 voxels across (corner voxels shaded), 5-wide capital.
function column3(m, x, y, z, h) {
  m.box(x, y, z, 3, 1, 3, MARBLE_SHADE);
  for (let yy = y + 1; yy < y + h - 1; yy++)
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
      const corner = (i !== 1) && (k !== 1);
      m.set(x + i, yy, z + k, corner ? 0xd9d2c3 : MARBLE);
    }
  for (let i = -1; i < 4; i++) for (let k = -1; k < 4; k++) {
    if ((i === -1 || i === 3) && (k === -1 || k === 3)) continue;
    m.set(x + i, y + h - 1, z + k, MARBLE_SHADE);
  }
}

// 2x2 column with a 4x4 base and capital; (x, z) is the shaft's min corner.
function column2(m, x, y, z, h) {
  m.box(x - 1, y, z - 1, 4, 1, 4, MARBLE_SHADE);
  m.box(x, y + 1, z, 2, h - 2, 2, FLUTE);
  m.box(x - 1, y + h - 1, z - 1, 4, 1, 4, MARBLE);
}

// Entablature over [x, x+w) x [z, z+d): marble architrave, a gilt fillet,
// a painted frieze of blue triglyphs and coloured metopes, and an overhanging
// dentil cornice. Team colour is not used here (it lives on banners/shields).
function entablature(m, x, y, z, w, d, { metope = RED, tall = true, shields = false } = {}) {
  m.box(x, y, z, w, 1, d, MARBLE);
  m.box(x, y + 1, z, w, 1, d, GILT);
  const fh = tall ? 2 : 1;
  m.box(x, y + 2, z, w, fh, d, (xx, yy, zz) => ((xx + zz) % 3 === 0 ? PAINT_BLUE : metope));
  const cy = y + 2 + fh;
  m.box(x - 1, cy, z - 1, w + 2, 1, d + 2, (xx, yy, zz) => ((xx + zz) & 1 ? MARBLE(xx, yy, zz) : MARBLE_SHADE));
  // bronze-bossed team shields hung on the front architrave
  if (shields) for (let sx = x + 2; sx + 3 <= x + w - 1; sx += 5) {
    const zf = z + d;
    m.box(sx, y - 1, zf, 3, 3, 1, BRONZE);
    m.remove(sx, y - 1, zf); m.remove(sx + 2, y - 1, zf); m.remove(sx, y + 1, zf); m.remove(sx + 2, y + 1, zf);
    m.set(sx + 1, y, zf, TEAM);
  }
  return cy + 1;
}

function roofTile(x, y, z, alongX, tones = TERRA_TONES, rib = 0.86) {
  const row = alongX ? x : z;            // position along the ridge
  const run = alongX ? z : x;            // position down the slope
  const c = pick(hash3(row >> 1, y, run >> 1, 9), tones);
  // cover-tile ribs (imbrices) every other voxel, with a lighter lap line
  // where each course overlaps the next
  if (row & 1) return shade(c, rib);
  return (run % 3 === 0) ? shade(c, 1.06) : c;
}

// Shallow terracotta gable over [x, x+sx) x [z, z+sz) (eaves included),
// starting at y. ridge = 'z' puts the pediments on the front/back, 'x' on the
// sides. run = horizontal voxels per 1 voxel of rise (3 ~ 18 deg, 2 ~ 27 deg).
// Marble raking cornice around a recessed tympanum (team blue by default)
// with optional relief figures and acroteria. Returns the y above the ridge.
function gable(m, x, y, z, sx, sz, ridge = 'z', { run = 3, tymp = PAINT_BLUE, acro = true, relief = false, rake = MARBLE, tone = 'terra', antefix = true } = {}) {
  const T = ROOF_TONES[tone];
  const alongX = ridge === 'x';
  const w = alongX ? sz : sx, d = alongX ? sx : sz;
  const put = (u, yy, v, c, o) => (alongX ? m.set(x + v, yy, z + u, c, o) : m.set(x + u, yy, z + v, c, o));
  const H = (u) => Math.floor(Math.min(u, w - 1 - u) / run);
  const hmax = H(Math.floor((w - 1) / 2));
  for (let u = 0; u < w; u++) {
    const h = H(u);
    for (let v = 0; v < d; v++) {
      const end = v === 0 || v === d - 1;
      const wx = alongX ? x + v : x + u, wz = alongX ? z + u : z + v;
      let c;
      if (end) c = rake;
      else if (u === 0 || u === w - 1) c = T.eave;
      else c = roofTile(wx, y + h, wz, alongX, T.tones, T.rib);
      put(u, y + h, v, c);
      if (h > 0 && !end) put(u, y + h - 1, v, T.eave);
      if ((v === 1 || v === d - 2) && u > 0 && u < w - 1)
        for (let yy = y; yy < y + h; yy++) put(u, yy, v, tymp);
    }
    // ridge cap
    if (u === Math.floor((w - 1) / 2) || u === Math.ceil((w - 1) / 2))
      for (let v = 1; v < d - 1; v++) put(u, y + h + 1, v, (v % 3) ? T.ridge : T.cap);
  }
  // relief figures standing in the front tympanum, under the raking cornice
  if (relief) {
    // a frieze of figures: heads rise to the cornice, bodies stand a voxel
    // lower, a gilt god at the centre; only every fourth column is left open
    // so the painted ground shows between groups
    const mid = (w - 1) / 2;
    for (let u = 2; u < w - 2; u++) {
      const top = y + H(u) - 1;
      const du = Math.abs(u - mid);
      const k = Math.round(du);
      if (du >= 1 && k % 4 === 2) continue;
      const hgt = du < 1 ? top : k % 4 === 0 ? top : top - 1;
      for (let yy = y; yy <= hgt; yy++) put(u, yy, d - 1, du < 1 ? GOLD : (yy === hgt && k % 4 === 0) ? MARBLE_SHADE : MARBLE);
    }
  }
  // antefixes: a comb of upright palmette tiles along both eaves
  if (antefix) for (const u of [0, w - 1])
    for (let v = 2; v < d - 2; v += 3) put(u, y + 1, v, T.antefix);
  if (acro) {
    // corner acroteria: small marble scrolls curling inward, gilt tips;
    // apex acroterion: a palmette fan with a gilt crown
    const c0 = Math.floor((w - 1) / 2), c1 = Math.ceil((w - 1) / 2);
    const tip = GILT;
    for (const v of [0, d - 1]) {
      for (const [u, du] of [[0, 1], [w - 1, -1]]) {
        put(u, y + 1, v, MARBLE); put(u, y + 2, v, MARBLE_SHADE); put(u + du, y + 2, v, MARBLE_SHADE);
      }
      put(c0 - 1, y + hmax + 1, v, MARBLE_SHADE); put(c1 + 1, y + hmax + 1, v, MARBLE_SHADE);
      put(c0, y + hmax + 1, v, MARBLE); put(c1, y + hmax + 1, v, MARBLE);
      put(c0, y + hmax + 2, v, MARBLE); put(c1, y + hmax + 2, v, MARBLE);
      put(c0, y + hmax + 3, v, tip); put(c1, y + hmax + 3, v, tip);
    }
  }
  return y + hmax + 2;
}

// Shallow terracotta hip roof over [x, x+w) x [z, z+d).
function hipRoof(m, x, y, z, w, d, { run = 2, finial = GOLD } = {}) {
  let hmax = 0;
  const H = (i, k) => Math.floor(Math.min(i, w - 1 - i, k, d - 1 - k) / run);
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) hmax = Math.max(hmax, H(i, k));
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
    const h = H(i, k);
    const ring = Math.min(i, w - 1 - i, k, d - 1 - k);
    const hipLine = (i === k || w - 1 - i === k || i === d - 1 - k || w - 1 - i === d - 1 - k);
    const c = ring === 0 ? EAVE_T : h === hmax || hipLine ? RIDGE_T : roofTile(x + i, y + h, z + k, Math.min(k, d - 1 - k) < Math.min(i, w - 1 - i));
    m.set(x + i, y + h, z + k, c);
    if (h > 0) m.set(x + i, y + h - 1, z + k, EAVE_T);
  }
  if (finial) m.set(x + (w >> 1), y + hmax + 1, z + (d >> 1), finial);
  return y + hmax + 1;
}

// Flat roof: slab with a low marble parapet and a team band under it.
function flatRoof(m, x, y, z, w, d) {
  m.box(x, y, z, w, 1, d, ROOFDECK);
  m.shell(x, y + 1, z, w, 1, d, MARBLE);
  return y + 2;
}

function brazier(m, x, y, z) {
  m.box(x, y, z, 2, 1, 2, MARBLE_SHADE);
  m.box(x, y + 1, z, 2, 2, 2, MARBLE);
  m.box(x, y + 3, z, 2, 1, 2, BRONZE);
  m.box(x, y + 4, z, 2, 1, 2, FIRE, { glow: 0.45 });
  m.set(x, y + 5, z + 1, 0xffd27a, { glow: 0.45 });
}

function banner(m, x, y, z, h = 5, axis = 'x') {
  m.box(x, y, z, 1, h + 3, 1, BRONZE);
  if (axis === 'x') { m.box(x + 1, y + h + 2, z, 2, 1, 1, BRONZE); m.box(x + 1, y + 2, z, 2, h, 1, TEAM); m.box(x + 1, y + 2, z, 2, 1, 1, GOLD); }
  else { m.box(x, y + h + 2, z + 1, 1, 1, 2, BRONZE); m.box(x, y + 2, z + 1, 1, h, 2, TEAM); m.box(x, y + 2, z + 1, 1, 1, 2, GOLD); }
  m.set(x, y + h + 3, z, GOLD);
}

// Stepped dark-stone base (socle) under a wall block [x, x+w) x [z, z+d):
// a protruding footing course at y0 and a flush darker course above it.
function socle(m, x, y0, z, w, d, n = 2) {
  m.box(x - 1, y0, z - 1, w + 2, 1, d + 2, BASE_STONE);
  if (n > 1) m.box(x, y0 + 1, z, w, 1, d, BASE_STONE);
  return y0 + n;
}

// Team cloth hung flat on a wall: gilt rod, cloth with a painted border and
// a gilt emblem, fringed tail. face '+z' hangs on a wall whose outer plane is
// z (cloth at z), '+x' on a wall whose outer plane is x.
function wallBanner(m, x, y, z, face = '+z', h = 5) {
  const put = (a, yy, c) => (face === '+z' ? m.set(x + a, yy, z, c) : m.set(x, yy, z + a, c));
  for (let a = -1; a < 3; a++) put(a, y + h, BRONZE);
  for (let yy = y + 1; yy < y + h; yy++) for (let a = 0; a < 2; a++) put(a, yy, TEAM);
  put(0, y + h - 2, GOLD); put(1, y + h - 2, GOLD);
  put(0, y, TEAM);
}

// Striped team awning over a door, sloping out from a +z wall (axis 'z',
// cloth at z and z+1) or a +x wall (axis 'x'), over [x, x+w) at height y.
function awning(m, x, y, z, w, axis = 'z') {
  for (let a = -1; a <= w; a++) {
    const c = (a & 1) ? TEAM : 0xf2ede2;
    if (axis === 'z') { m.set(x + a, y, z, c); m.set(x + a, y - 1, z + 1, c); }
    else { m.set(x, y, z + a, c); m.set(x + 1, y - 1, z + a, c); }
  }
}

// Painted band (fixed blue with gilt dots) along a wall top
function band(m, x, y, z, w, h, d) {
  m.box(x, y, z, w, h, d, (xx, yy, zz) => ((xx + zz) % 4 === 0 ? GILT : PAINT_BLUE));
}

// Small amphora (1x1 footprint).
function amphora(m, x, y, z, c = 0xb8683e) {
  m.set(x, y, z, shade(c, 0.85)).set(x, y + 1, z, c).set(x, y + 2, z, 0x8f4f2c);
}

// Big storage jar (pithos), 2x2 body with a narrow neck and a painted band.
function pithos(m, x, y, z, c = 0xb8683e) {
  m.box(x, y, z, 2, 1, 2, shade(c, 0.82));
  m.box(x, y + 1, z, 2, 1, 2, 0x2b2420);
  m.box(x, y + 2, z, 2, 1, 2, c);
  m.set(x, y + 3, z, shade(c, 0.9));
}

function cypress(m, x, y, z, h = 12) {
  m.box(x, y, z, 1, 2, 1, 0x5a3e26);
  for (let j = 1; j < h; j++) {
    const r = j < 2 || j > h - 3 ? 0 : 1;
    m.box(x - r, y + j, z - r, 1 + 2 * r, 1, 1 + 2 * r, (xx, yy, zz) => (hash3(xx, yy, zz, 12) < 0.5 ? 0x3d6b2f : 0x4a7b36));
  }
}

function olive(m, x, y, z) {
  m.box(x, y, z, 1, 3, 1, 0x6a5238);
  m.set(x + 1, y + 2, z, 0x6a5238);
  m.ellipsoid(x + 0.5, y + 4, z, 2, 1.2, 2, OLIVE);
}

// Marble statue of a god on a pedestal: robe, torso, raised arm with a
// golden thunderbolt. (x, z) = pedestal min corner (pedestal is 4x4).
function statue(m, x, y, z, { color = MARBLE, bolt = true } = {}) {
  m.box(x - 1, y, z - 1, 6, 1, 6, MARBLE_SHADE);
  m.box(x, y + 1, z, 4, 3, 4, MARBLE);
  band(m, x, y + 2, z, 4, 1, 4);
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

// Bronze hoplite statue with spear and round shield on a small plinth.
// (x, z) = plinth min corner, plinth 4x4.
function hopliteStatue(m, x, y, z) {
  m.box(x, y, z, 4, 1, 4, MARBLE_SHADE);
  m.box(x, y + 1, z, 4, 2, 4, MARBLE);
  band(m, x, y + 2, z, 4, 1, 4);
  const b = y + 3, C = 0x9a7440, D2 = 0x7d5c30;
  m.set(x + 1, b, z + 1, C).set(x + 2, b, z + 2, C).set(x + 1, b + 1, z + 1, C).set(x + 2, b + 1, z + 2, C); // legs
  m.box(x + 1, b + 2, z + 1, 2, 3, 2, C);                             // torso
  m.box(x + 1, b + 5, z + 1, 2, 2, 2, D2);                            // helmet
  m.box(x + 1, b + 7, z + 1, 2, 1, 1, TEAM).set(x + 1, b + 7, z + 2, TEAM); // crest
  m.box(x + 3, b - 1, z + 2, 1, 11, 1, D2);                             // spear
  m.set(x + 3, b + 10, z + 2, 0xd8d1c1);
  m.box(x, b + 1, z + 1, 1, 3, 3, TEAM); m.set(x, b + 2, z + 2, GOLD);    // shield
}

// ---- buildings ---------------------------------------------------------------
// Town Center: a hexastyle-looking civic hall on a three-step stylobate: four
// octagonal columns across the front (plus the flanks), a painted frieze, a
// shallow pediment with a blue tympanum and relief figures, and a forecourt
// with braziers, banners and statues.
export function townCenterModel(variant = 0, m = new VoxelModel()) {
  const S = 28;
  steps(m, 0, 0, S, S, 2, [STONE, PAVE]);
  // stylobate: three marble steps under the hall
  m.box(1, 2, 1, 26, 1, 20, BASE_STONE);
  m.box(2, 3, 2, 24, 1, 18, (x, y, z) => shade(ASHLAR(x, y + 1, z), 0.9));
  m.box(3, 4, 3, 22, 1, 16, MARBLE_SHADE);
  const y = 5, CH = 13;
  // cella (ashlar) with a bronze door, windows and pilasters
  m.box(8, y, 4, 12, CH, 10, ASHLAR);
  m.box(8, y, 4, 12, 1, 10, STONE);
  m.box(12, y, 13, 4, 8, 1, DOOR);
  m.box(11, y + 8, 13, 6, 1, 1, MARBLE);
  m.box(13, y + 3, 13, 2, 1, 1, BRONZE);
  for (const x of [9, 17]) m.box(x, y + 4, 13, 2, 4, 1, DARK);
  for (const z of [6, 10]) m.box(19, y + 5, z, 1, 4, 2, DARK);
  // peristyle: 4 octagonal columns on the front, back row and flanks
  for (const x of [3, 9, 15, 21]) { column4(m, x, y, 15, CH); column4(m, x, y, 3, CH); }
  for (const z of [9]) { column4(m, 3, y, z, CH); column4(m, 21, y, z, CH); }
  // porch ceiling beams and a coffered shadow line
  const t = entablature(m, 3, y + CH, 3, 22, 16);
  gable(m, 1, t, 1, 26, 20, 'z', { run: 2.5, acro: 'gold', relief: true });
  banner(m, 6, 2, 25, 7, 'x'); banner(m, 20, 2, 25, 7, 'x');
  // ---- forecourt: braziers, banners, flanking statues and an altar
  brazier(m, 1, 2, 22); brazier(m, 25, 2, 22);
  m.box(12, 2, 23, 4, 2, 3, MARBLE); m.box(12, 3, 23, 4, 1, 3, RED);   // altar
  m.box(13, 4, 24, 2, 1, 1, FIRE, { glow: 0.5 });
  pithos(m, 7, 2, 22, 0xb8683e); amphora(m, 20, 2, 22); amphora(m, 21, 2, 23, 0xa65a34);
  return m;
}

// House variants, each with its own silhouette:
//   0 flat-roofed courtyard house        1 L-shaped house with a vine pergola
//   2 two-storey house with a balcony     3 pedimented cottage with a porch
export function houseModel(variant = 0, m = new VoxelModel()) {
  m.box(0, 0, 0, 12, 1, 12, STONE);
  const PL = variant === 1 || variant === 3 ? PLASTER_WARM : PLASTER;
  if (variant === 0) {
    // rooms at the back (tall) and down the east side (lower), flat roofs
    m.box(0, 1, 0, 12, 7, 5, PL); m.box(0, 1, 0, 12, 2, 5, BASE_STONE);
    band(m, 0, 7, 4, 12, 1, 1); band(m, 11, 7, 0, 1, 1, 5);
    flatRoof(m, 0, 8, 0, 12, 5);
    m.box(8, 1, 5, 4, 6, 7, PL); m.box(8, 1, 5, 4, 2, 7, BASE_STONE);
    band(m, 8, 6, 11, 4, 1, 1); band(m, 11, 6, 5, 1, 1, 7);
    flatRoof(m, 8, 7, 5, 4, 7);
    // courtyard walls with a marble coping and a gate
    m.box(0, 1, 5, 1, 4, 7, PL); m.box(0, 1, 11, 8, 4, 1, PL);
    m.box(0, 5, 5, 1, 1, 7, MARBLE); m.box(0, 5, 11, 8, 1, 1, MARBLE);
    m.carve(3, 1, 11, 2, 4, 1); m.carve(3, 5, 11, 2, 1, 1);
    m.box(2, 1, 11, 1, 6, 1, MARBLE); m.box(5, 1, 11, 1, 6, 1, MARBLE); band(m, 2, 7, 11, 4, 1, 1);
    m.box(1, 1, 5, 7, 1, 6, PAVE);
    // tiled lean-to along the back rooms, on two wooden posts
    for (let x = 1; x < 8; x++) { m.set(x, 6, 5, roofTile(x, 6, 5, false)); m.set(x, 5, 6, roofTile(x, 5, 6, false)); }
    m.box(1, 2, 6, 1, 3, 1, WOOD); m.box(7, 2, 6, 1, 3, 1, WOOD);
    m.box(4, 2, 4, 2, 3, 1, DOOR);
    // olive tree, pithoi and a loom-bench in the court
    olive(m, 3, 2, 9);
    pithos(m, 6, 2, 8, 0xb8683e); amphora(m, 6, 2, 10, 0xa65a34);
    // windows on the show faces, rooftop jars and a chimney pot
    m.box(9, 3, 11, 2, 2, 1, DARK); m.box(11, 3, 7, 1, 2, 2, DARK);
    wallBanner(m, 12, 0, 9, '+x', 5);
    m.box(11, 4, 1, 1, 2, 1, DARK); m.box(11, 4, 3, 1, 2, 1, DARK);
    m.box(2, 10, 1, 1, 2, 1, PL); m.set(2, 12, 1, 0x3a3430);
    amphora(m, 9, 9, 7, 0xa65a34); amphora(m, 9, 9, 9);
    return m;
  }
  if (variant === 1) {
    // L-shape: back wing across the lot, side wing down the west edge
    m.box(0, 1, 0, 12, 6, 5, PL); m.box(0, 1, 0, 12, 2, 5, BASE_STONE);
    m.box(0, 1, 5, 5, 6, 7, PL); m.box(0, 1, 5, 5, 2, 7, BASE_STONE);
    band(m, 5, 6, 4, 7, 1, 1); band(m, 11, 6, 0, 1, 1, 5);
    band(m, 0, 6, 11, 5, 1, 1); band(m, 4, 6, 5, 1, 1, 6);
    gable(m, 0, 7, -1, 13, 7, 'x', { run: 1.5, tymp: MARBLE_SHADE, acro: false });
    gable(m, -1, 7, 4, 7, 9, 'z', { run: 1.5, acro: true });
    awning(m, 1, 6, 12, 2);
    m.box(1, 2, 11, 2, 3, 1, DOOR); m.box(1, 5, 11, 2, 1, 1, MARBLE);
    m.box(4, 3, 7, 1, 2, 2, DARK); m.box(11, 3, 2, 1, 2, 2, DARK); m.box(7, 3, 4, 2, 2, 1, DARK);
    // vine pergola on marble posts in the inner corner
    m.box(5, 1, 5, 7, 1, 7, PAVE);
    for (const [px, pz] of [[11, 11], [7, 11], [11, 7]]) m.box(px, 2, pz, 1, 5, 1, MARBLE);
    m.box(5, 7, 11, 7, 1, 1, WOOD); m.box(11, 7, 5, 1, 1, 7, WOOD); m.box(5, 7, 7, 7, 1, 1, WOOD);
    for (const x of [6, 8, 10]) m.box(x, 8, 5, 1, 1, 7, DARKWOOD);
    for (let x = 5; x < 12; x++) for (let z = 5; z < 12; z++) {
      const h = hash3(x, 9, z, 44);
      if (h < 0.62) m.set(x, 9, z, LEAF);
      else if (h < 0.7) m.set(x, 7, z, 0x6b3a6e);
    }
    m.box(8, 2, 8, 2, 1, 2, WOOD); m.box(8, 3, 8, 2, 1, 2, 0x9b7040); m.set(8, 4, 8, 0x6b3a6e);
    pithos(m, 5, 2, 10, 0xa65a34); amphora(m, 10, 2, 5);
    return m;
  }
  if (variant === 2) {
    // two storeys, a wooden balcony across the front on marble posts
    m.box(1, 1, 1, 10, 12, 7, PL); m.box(1, 1, 1, 10, 2, 7, BASE_STONE);
    m.box(1, 7, 7, 10, 1, 1, MARBLE); m.box(10, 7, 1, 1, 1, 7, MARBLE);
    band(m, 1, 12, 7, 10, 1, 1); band(m, 10, 12, 1, 1, 1, 7);
    hipRoof(m, 0, 13, 0, 12, 9, { run: 2 });
    // ground floor: door and windows
    m.box(5, 2, 7, 2, 4, 1, DOOR); m.box(2, 3, 7, 2, 2, 1, DARK); m.box(8, 3, 7, 2, 2, 1, DARK);
    m.box(10, 3, 3, 1, 2, 2, DARK);
    // upper floor: balcony door, shuttered windows
    m.box(5, 8, 7, 2, 4, 1, DARK); m.box(2, 9, 7, 2, 2, 1, DARK); m.box(8, 9, 7, 2, 2, 1, DARK);
    for (const sx of [1, 4, 7, 10]) m.box(sx, 9, 7, 1, 2, 1, PAINT_BLUE_D);
    // team drapes hung under the balcony
    for (const sx of [3, 7]) { m.box(sx, 4, 9, 2, 3, 1, TEAM); m.box(sx, 6, 9, 2, 1, 1, GILT); }
    m.box(10, 9, 5, 1, 2, 2, DARK); m.box(10, 7, 1, 1, 4, 2, DOOR);
    // balcony
    m.box(1, 7, 8, 10, 1, 2, WOOD);
    for (let x = 1; x < 11; x += 2) m.set(x, 8, 9, DARKWOOD);
    m.box(1, 9, 9, 10, 1, 1, DARKWOOD); m.box(1, 8, 8, 1, 2, 1, DARKWOOD); m.box(10, 8, 8, 1, 2, 1, DARKWOOD);
    m.box(1, 1, 9, 1, 6, 1, MARBLE); m.box(10, 1, 9, 1, 6, 1, MARBLE);
    m.set(3, 8, 8, 0xc0392b).set(8, 8, 8, 0x9b59b6);         // flower pots on the balcony
    // exterior stair up the east side
    for (let i = 0; i < 6; i++) m.box(11, 1 + i, 7 - i, 1, 1, 1, STONE);
    // front yard
    m.box(1, 1, 10, 10, 1, 2, PAVE);
    pithos(m, 2, 2, 10, 0xb8683e); amphora(m, 8, 2, 11, 0xa65a34); amphora(m, 9, 2, 10);
    return m;
  }
  // variant 3: cottage with a two-column porch under a front pediment
  m.box(1, 1, 1, 10, 6, 7, PL);
  m.box(1, 1, 1, 10, 2, 7, BASE_STONE);
  m.box(4, 1, 7, 3, 4, 1, DOOR); m.box(3, 5, 7, 5, 1, 1, MARBLE);
  m.box(10, 3, 3, 1, 2, 2, DARK);
  m.box(1, 1, 8, 10, 1, 3, PAVE);
  column2(m, 2, 2, 9, 5); column2(m, 8, 2, 9, 5);
  band(m, 1, 7, 1, 10, 1, 10);
  m.box(0, 8, 0, 12, 1, 12, MARBLE);
  gable(m, 0, 9, -1, 12, 14, 'z', { run: 2 });
  wallBanner(m, 11, 1, 5, '+x', 5);
  m.box(8, 12, 2, 2, 3, 2, PL); m.set(8, 15, 2, 0x3a3430);
  amphora(m, 11, 1, 9);
  return m;
}

export function storehouseModel(variant = 0, m = new VoxelModel()) {
  m.box(0, 0, 0, 12, 1, 12, BASE_STONE);
  m.box(1, 1, 1, 10, 1, 10, PAVE);
  // back wall of ashlar, open colonnaded front
  m.box(1, 1, 1, 10, 7, 2, ASHLAR);
  m.box(1, 1, 1, 2, 7, 6, ASHLAR);
  for (const x of [1, 5, 9]) { m.box(x, 1, 9, 2, 7, 2, MARBLE); m.box(x, 1, 9, 2, 1, 2, MARBLE_SHADE); }
  m.box(10, 1, 3, 1, 7, 1, MARBLE); m.box(10, 1, 6, 1, 7, 1, MARBLE);
  band(m, 1, 8, 1, 10, 1, 10);
  m.box(0, 9, 0, 12, 1, 12, MARBLE);
  gable(m, -1, 10, 0, 14, 12, 'x', { run: 2 });
  awning(m, 3, 7, 11, 6);
  // goods: crates, amphorae, a log pile, gold and grain sacks
  m.box(3, 2, 3, 2, 2, 2, 0x9b7040).box(3, 4, 3, 2, 1, 2, 0x8a6236);
  m.box(5, 2, 3, 2, 2, 2, 0xa27a48);
  for (let i = 0; i < 3; i++) m.box(7, 2 + i, 3 + (i % 2), 3, 1, 1, 0x6e4526);
  amphora(m, 3, 2, 6); amphora(m, 4, 2, 7, 0xa65a34); amphora(m, 3, 2, 8);
  m.box(7, 2, 6, 2, 1, 2, GOLD, { glow: 0.1 }).set(7, 3, 6, GOLD, { glow: 0.1 });
  m.box(6, 2, 8, 2, 1, 1, 0xd8c79a);
  m.box(10, 1, 10, 2, 2, 2, 0x9b7040).box(10, 3, 10, 1, 1, 1, 0xa27a48);
  return m;
}

export function farmModel(variant = 0, m = new VoxelModel()) {
  const S = 16;
  for (let i = 0; i < S; i += 1) {
    const post = i % 3 === 0;
    const c = post ? WOOD : 0x9a7348;
    for (const [x, z] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) {
      m.set(x, 0, z, c);
      if (post) m.set(x, 1, z, WOOD);
    }
  }
  m.carve(7, 0, S - 1, 2, 2, 1);
  for (let z = 2; z < S - 2; z += 2)
    for (let x = 2; x < S - 2; x++) {
      const h = hash3(x, 0, z, 9);
      if (h < 0.92) m.set(x, 0, z, h < 0.45 ? 0x5f8a2e : 0x6f9a36);
      if (h < 0.6) m.set(x, 1, z, h < 0.3 ? 0xd9c35a : 0x86a83c);
    }
  m.box(1, 0, 1, 2, 1, 1, 0xd8c079);
  m.box(S - 3, 0, 1, 1, 3, 1, MARBLE).set(S - 3, 3, 1, TEAM);
  return m;
}

// Temple: peripteral, 4x5 round columns on a two-step stylobate, cella with
// bronze doors, painted frieze, shallow pediment with a blue tympanum and a
// golden relief, braziers and cypresses in the forecourt.
export function templeModel(variant = 0, m = new VoxelModel()) {
  const W = 20;
  m.box(0, 0, 0, W, 1, 21, BASE_STONE);
  m.box(1, 1, 1, W - 2, 1, 19, (x, yy, z) => shade(ASHLAR(x, yy + 1, z), 0.92));
  const y = 2, CH = 12;
  // front steps up the stylobate
  m.box(6, 0, 20, 8, 1, 1, MARBLE_SHADE);
  // cella
  m.box(5, y, 5, 10, CH, 10, ASHLAR);
  m.box(8, y, 14, 4, 8, 1, DOOR);
  m.box(7, y + 8, 14, 6, 1, 1, MARBLE);
  m.box(9, y + 3, 14, 2, 1, 1, GOLD, { glow: 0.3 });
  // peristyle
  const xs = [1, 6, 11, 16], zs = [1, 6, 11, 16];
  for (const x of xs) { column3(m, x, y, 1, CH); column3(m, x, y, 16, CH); }
  for (const z of zs.slice(1, -1)) { column3(m, 1, y, z, CH); column3(m, 16, y, z, CH); }
  const t = entablature(m, 1, y + CH, 1, W - 2, 18, { metope: RED });
  gable(m, 0, t, 0, W, 20, 'z', { run: 2.5, acro: 'gold', relief: true, tone: 'sage' });
  banner(m, 0, 0, 23, 6, 'x'); banner(m, 17, 0, 23, 6, 'x');
  // forecourt
  brazier(m, 1, 0, 21); brazier(m, 17, 0, 21);
  m.box(8, 0, 21, 4, 2, 2, MARBLE); m.box(9, 2, 21, 2, 1, 2, FIRE, { glow: 0.9 });
  cypress(m, 5, 0, 22, 8); cypress(m, 14, 0, 22, 8);
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
  m.box(0, 0, 0, S, 1, S, BASE_STONE);
  m.box(2, 1, 10, 16, 1, 8, (x, y, z) => (hash3(x, y, z, 14) < 0.5 ? 0xc9b48c : 0xbba57e)); // sand yard
  const wall = (x, z, w, d) => { m.box(x, 1, z, w, 4, d, ASHLAR); m.box(x, 5, z, w, 1, d, MARBLE); };
  wall(0, 0, 2, S); wall(S - 2, 0, 2, S);
  wall(0, S - 2, 7, 2); wall(13, S - 2, 7, 2);
  band(m, 0, 4, 0, 2, 1, S); band(m, S - 2, 4, 0, 2, 1, S);
  // main hall at the back with a colonnaded front
  m.box(2, 1, 1, 16, 8, 7, ASHLAR);
  m.box(8, 1, 7, 4, 5, 1, DOOR);
  for (let x = 3; x < 18; x += 4) { m.box(x, 1, 8, 2, 8, 2, FLUTE); m.box(x - 1, 1, 7, 4, 1, 4, MARBLE_SHADE); }
  band(m, 2, 9, 1, 16, 1, 9);
  m.box(1, 10, 0, 18, 1, 11, MARBLE);
  gable(m, 0, 11, -1, 20, 12, 'x', { run: 2, tone: 'sage' });
  wallBanner(m, 18, 1, 13, '+x', 4);
  // gate towers with hip roofs and banners
  for (const tx of [5, 12]) {
    m.box(tx, 1, S - 3, 3, 9, 3, ASHLAR);
    band(m, tx, 8, S - 3, 3, 1, 3);
    m.box(tx - 1, 10, S - 4, 5, 1, 5, MARBLE);
    hipRoof(m, tx - 1, 11, S - 4, 5, 5, { run: 1 });
  }
  banner(m, 8, 1, S - 1, 5, 'x');
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
export const BUILDING_VARIANTS = { house: 4 };

export {
  WOOD, DARKWOOD, STONE, MARBLE, MARBLE_SHADE, MARBLE_DARK, ASHLAR, PAVE, TERRACOTTA, BRONZE, GOLD, FIRE, LEAF,
  amphora, pithos, cypress, olive, statue, hopliteStatue, brazier, roofTile, shade, gable,
};
