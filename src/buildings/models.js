import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';
import { TILES, gableRoof, hipRoof, shedRoof, dome, cylinder, roundColumn } from './shapes.js';

// Greek voxel buildings described in code, styled after Age of Mythology:
// Retold's towns: limestone and whitewashed walls on stone plinths, shallow
// tile roofs, round columns on stepped stylobates, pediments with painted
// tympana, painted friezes; team colour only on cloth (banners, awnings).
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
const ASHLAR = masonry([0xebe5d8, 0xddd6c7, 0xd0c8b6], [0xcdc3ae, 0xbfb49d, 0xd8cfbb], { bed: 0.62, head: 0.78, seed: 3 });
// Each building type has its own wall material:
//   LIMESTONE  whitewashed limestone ashlar in long, low courses with crisp
//              joints (Town Center, temple)
//   WHITEWASH  smooth lime plaster, only faintly mottled (houses)
//   MUDBRICK   sun-dried brick, 3 voxels long, pale mortar (houses, sheds)
//   FIELDSTONE irregular rubble of grey and brown stones (towers)
const LIMESTONE = masonry([0xf6f2e9, 0xefeadf, 0xe7e1d4], [0xebe5d8, 0xe2dbcc, 0xf2ede3], { len: 7, course: 2, bed: 0.8, head: 0.87, grime: 3, seed: 5 });
const WHITEWASH = (x, y, z) => { const h = hash3(x >> 1, y >> 1, z >> 1, 71); return h < 0.55 ? 0xf5f1e8 : h < 0.88 ? 0xede8dc : 0xe4ddcf; };
const WASH_OCHRE = (x, y, z) => { const h = hash3(x >> 1, y >> 1, z >> 1, 73); return h < 0.55 ? 0xecd9b4 : h < 0.88 ? 0xe3cea6 : 0xd9c49b; };
const MUDBRICK = (x, y, z) => {
  const u = x + z + (y & 1) * 2;
  const blk = Math.floor(u / 3);
  let c = pick(hash3(blk, y, (x - z) >> 3, 72), [0xd2ad82, 0xc7a077, 0xdcba90, 0xc09a6e, 0xd6b389]);
  if (((u % 3) + 3) % 3 === 0) c = mix(c, 0xd9c7a6, 0.55);        // pale mortar head joint
  return c;
};
function fieldstone(seed = 81) {
  const TONES = [0xa59c8b, 0x918979, 0xb4a993, 0x867e70, 0x9f9380, 0xbcb29d, 0x8c8a82];
  return (x, y, z) => {
    const row = y >> 1;
    const L = 2 + Math.floor(hash3(row, 1, 0, seed) * 3);
    const v = x + z + Math.floor(hash3(row, 2, 0, seed) * 5);
    const cell = Math.floor(v / L);
    let c = pick(hash3(cell, row, (x - z) >> 4, seed), TONES);
    if (((v % L) + L) % L === 0) c = 0x6e675b;                          // mortar between stones
    else if ((y & 1) === 0 && hash3(cell, row, 3, seed) < 0.75) c = shade(c, 0.78);   // uneven bed
    return c;
  };
}
const FIELDSTONE = fieldstone(81);
// darker stone for the stepped base (stylobate / socle) under the walls
const BASE_STONE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 21); return h < 0.4 ? 0x8d8676 : h < 0.8 ? 0x7f786a : 0x9a9382; };
const PAINT_BLUE = 0x34528a;   // painted (fixed) frieze blue, not team colour
const PAINT_BLUE_D = 0x28406e;
const GILT = 0xd2a847;         // painted gold fillets
const SOFFIT = 0x4a3d33;       // dark underside of eaves / mutules / rafter ends
const TYMPANUM = 0x2c3f66;     // deep painted blue ground of a pediment
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
const RED = 0xa8372a;
const PORCH_RED = (x, y, z) => (hash3(x >> 1, y >> 1, z >> 1, 43) < 0.5 ? 0x8e3a2c : 0x983f2f);       // painted metopes
const OCHRE = 0xd49a3a;
const LEAF = (x, y, z) => pick(hash3(x, y, z, 12), [0x3d6b2f, 0x4a7b36, 0x55863b, 0x416f31]);
const OLIVE = (x, y, z) => pick(hash3(x, y, z, 13), [0x7d8f4e, 0x6f8445, 0x8a9a5a]);
// terracotta roof tiles: every tile its own fired tone, cover-tile rows
// (imbrices) darker than the pans between them
const TERRA_TONES = [0xf08a4a, 0xe57c3e, 0xf79a5a, 0xdc7038, 0xeb8446, 0xfaa868, 0xd4682f];
const MARBLE_TILE_TONES = [0xe8e6dc, 0xdedcd0, 0xf0eee6, 0xd4d6cb, 0xe2e3d9];
const SAGE_TONES = [0x7f9e84, 0x8aa88c, 0x74957b, 0x95b193, 0x7c9a80, 0x86a487];
const CIVIC_TONES = [0xc46a44, 0xbb603c, 0xcd744b, 0xb4593a, 0xc86f47, 0xbf6540, 0xd27d52];
const TERRACOTTA = (x, y, z) => pick(hash3(x, y, z, 9), TERRA_TONES);
const RIDGE_T = 0xb4532a;
const EAVE_T = 0xc0602e;
const ROOF_TONES = {
  terra: { tones: TERRA_TONES, ridge: RIDGE_T, eave: EAVE_T, cap: 0x9a4322, antefix: 0xd0703e, rib: 0.9 },
  marble: { tones: MARBLE_TILE_TONES, ridge: 0xa9aa9c, eave: 0xa7a89a, cap: 0x9a9c8e, antefix: 0xf5f2ea, rib: 0.82 },
  // weathered sage-green glazed tiles (Retold temples / civic roofs)
  // matte, slightly weathered terracotta for temples and civic halls
  civic: { tones: CIVIC_TONES, ridge: 0x8e4128, eave: 0x9c4a2c, cap: 0x7d3a24, antefix: 0xc0643a, rib: 0.92 },
  sage: { tones: SAGE_TONES, ridge: 0x62806c, eave: 0x6f8a78, cap: 0x55705f, antefix: 0xc8d8c4, rib: 0.87 },
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

const COL_SHAFT = (x, y, z) => (hash3(x, y >> 1, z, 41) < 0.55 ? 0xf2ede3 : 0xebe5d8);
const FLUTE = COL_SHAFT;
const oct = (i, k, n) => !((i === 0 || i === n - 1) && (k === 0 || k === n - 1));

// Round-reading Doric column, 4 voxels across: an octagonal shaft (4x4 minus
// the corners) on a square plinth and a rounded torus, with a dark necking
// ring under a flared echinus and a square abacus, so base, shaft and
// capital read as three parts. (x, z) = shaft min corner; h >= 8.
function column4(m, x, y, z, h) {
  m.box(x - 1, y, z - 1, 6, 1, 6, MARBLE_SHADE);
  for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) if (oct(i, k, 6)) m.set(x - 1 + i, y + 1, z - 1 + k, MARBLE);
  for (let yy = y + 2; yy < y + h - 3; yy++)
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) if (oct(i, k, 4)) m.set(x + i, yy, z + k, COL_SHAFT);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) if (oct(i, k, 4)) m.set(x + i, y + h - 3, z + k, MARBLE_DARK);
  m.box(x, y + h - 2, z, 4, 1, 4, MARBLE);
  for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) if (oct(i, k, 6)) m.set(x - 1 + i, y + h - 2, z - 1 + k, MARBLE);
  m.box(x - 1, y + h - 1, z - 1, 6, 1, 6, MARBLE_SHADE);
}

// Slimmer Ionic-looking column, 3 voxels across (corner voxels a shade
// darker so it reads round), 5x5 plinth + torus, dark necking, 5x5 capital
// with volute ends. (x, z) = shaft min corner.
function column3(m, x, y, z, h) {
  m.box(x - 1, y, z - 1, 5, 1, 5, MARBLE_SHADE);
  for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) if (oct(i, k, 5)) m.set(x - 1 + i, y + 1, z - 1 + k, MARBLE);
  for (let yy = y + 2; yy < y + h - 2; yy++)
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
      const corner = (i !== 1) && (k !== 1);
      m.set(x + i, yy, z + k, corner ? 0xdcd5c6 : COL_SHAFT);
    }
  m.box(x, y + h - 2, z, 3, 1, 3, MARBLE_DARK);
  for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) if (oct(i, k, 5)) m.set(x - 1 + i, y + h - 1, z - 1 + k, MARBLE);
  // volutes: the capital's side ends curl down one voxel
  m.set(x - 1, y + h - 2, z + 1, MARBLE_SHADE); m.set(x + 3, y + h - 2, z + 1, MARBLE_SHADE);
}

// 2x2 column with a 4x4 base and capital; (x, z) is the shaft's min corner.
function column2(m, x, y, z, h) {
  m.box(x - 1, y, z - 1, 4, 1, 4, MARBLE_SHADE);
  m.box(x, y + 1, z, 2, h - 2, 2, FLUTE);
  m.box(x - 1, y + h - 1, z - 1, 4, 1, 4, MARBLE);
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
  // dark soffit: rafter ends under both projecting eaves
  for (const u of [0, w - 1]) for (let v = 1; v < d - 1; v += 2) put(u, y - 1, v, SOFFIT);
  // antefixes: a comb of upright palmette tiles along both eaves
  if (antefix) for (const u of [0, w - 1])
    for (let v = 2; v < d - 2; v += 3) put(u, y + 1, v, T.antefix);
  if (acro) {
    // corner acroteria: small marble scrolls curling inward, gilt tips;
    // apex acroterion: a palmette fan with a gilt crown
    const c0 = Math.floor((w - 1) / 2), c1 = Math.ceil((w - 1) / 2);
    const tip = MARBLE_SHADE;
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

// Greek temple roof: a gable whose ridge runs front to back (ridge 'z'; 'x'
// turns it sideways) over [x, x+sx) x [z, z+sz), eaves included, in matte
// terracotta. Each short end is a true pediment: a horizontal geison, a
// raking cornice two voxels thick that stands proud of the tiles, a
// tympanum recessed one voxel with a dark painted ground, marble relief
// figures standing on the geison (a taller one in the middle, reclining ones
// in the corners), and plain marble acroteria: a palmette at the apex and a
// low scroll at each corner. The long eaves have a continuous dark soffit.
// Returns the y just above the ridge.
function templeRoof(m, x, y, z, sx, sz, ridge = 'z', { run = 2, tone = 'civic', relief = 'both', tymp = TYMPANUM } = {}) {
  const T = ROOF_TONES[tone];
  const alongX = ridge === 'x';
  const w = alongX ? sz : sx, d = alongX ? sx : sz;
  const put = (u, yy, v, c, o) => (alongX ? m.set(x + v, yy, z + u, c, o) : m.set(x + u, yy, z + v, c, o));
  const H = (u) => Math.floor(Math.min(u, w - 1 - u) / run);
  const hmax = H(Math.floor((w - 1) / 2));
  const c0 = Math.floor((w - 1) / 2), c1 = Math.ceil((w - 1) / 2);
  for (let u = 0; u < w; u++) {
    const h = H(u);
    for (let v = 1; v < d - 1; v++) {
      const wx = alongX ? x + v : x + u, wz = alongX ? z + u : z + v;
      put(u, y + h, v, u === 0 || u === w - 1 ? T.eave : roofTile(wx, y + h, wz, alongX, T.tones, T.rib));
      for (let yy = y; yy < y + h; yy++) put(u, yy, v, T.eave);
    }
    if (u === c0 || u === c1) for (let v = 1; v < d - 1; v++) put(u, y + h + 1, v, T.ridge);
  }
  // long eaves: a continuous dark soffit under the overhang
  for (const u of [0, w - 1]) for (let v = 1; v < d - 1; v++) put(u, y - 1, v, SOFFIT);
  for (const [vo, vt, front] of [[d - 1, d - 2, true], [0, 1, false]]) {
    // horizontal geison across the base of the pediment
    for (let u = 0; u < w; u++) { put(u, y, vo, MARBLE_SHADE); put(u, y - 1, vo, MARBLE_SHADE); }
    for (let u = 1; u < w - 1; u++) {
      const h = H(u);
      // raking cornice + sima, proud of the tile plane
      put(u, y + h + 1, vo, MARBLE);
      put(u, y + h, vo, MARBLE_SHADE);
      // recessed tympanum behind the outer plane
      for (let yy = y + 1; yy < y + h; yy++) put(u, yy, vt, tymp);
    }
    if (relief === 'both' || (relief === 'front' && front)) {
      const mid = (w - 1) / 2;
      for (let u = 2; u < w - 2; u++) {
        const top = y + H(u) - 1;
        const du = Math.abs(u - mid), k = Math.round(du);
        const centre = du < 1;
        if (top < y + 1) {
          // reclining figures in the low corners of the gable
          if (H(u) >= 1 && k % 2 === 0) put(u, y + 1, vo, MARBLE_SHADE);
          continue;
        }
        if (!centre && k % 4 !== 0) continue;
        const hh = centre ? top : Math.min(top, y + 3);
        for (let yy = y + 1; yy <= hh; yy++) put(u, yy, vo, yy === hh ? MARBLE_SHADE : MARBLE);
      }
    }
    // apex acroterion: a marble palmette fan; corner acroteria: low scrolls
    const ay = y + hmax + 2;
    put(c0, ay, vo, MARBLE); put(c1, ay, vo, MARBLE);
    put(c0 - 1, ay, vo, MARBLE_SHADE); put(c1 + 1, ay, vo, MARBLE_SHADE);
    put(c0, ay + 1, vo, MARBLE_SHADE); put(c1, ay + 1, vo, MARBLE_SHADE);
    for (const [u, du] of [[0, 1], [w - 1, -1]]) {
      put(u, y + 1, vo, MARBLE); put(u, y + 2, vo, MARBLE_SHADE); put(u + du, y + 2, vo, MARBLE);
    }
  }
  return y + hmax + 2;
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
// The cloth hangs from a bronze bracket one voxel proud of the wall (so it
// throws its own shadow line), has a painted white hem at the top, a gilt
// emblem, and a swallow-tailed foot; `y` is the foot, `y + h` the rod.
function wallBanner(m, x, y, z, face = '+z', h = 5) {
  const put = (a, yy, c, out = 1) => (face === '+z' ? m.set(x + a, yy, z + out, c) : m.set(x + out, yy, z + a, c));
  // thin dark bronze rod, the dyed cloth with a pale emblem
  for (let a = -1; a < 4; a++) put(a, y + h, 0x6e5426);
  for (let yy = y + 1; yy < y + h; yy++) for (let a = 0; a < 3; a++) put(a, yy, TEAM);
  put(1, y + h - 3, 0xf3efe6);
  put(0, y, TEAM); put(2, y, TEAM);      // swallowtail
}


// Window or door opening with a timber lintel over it (running a voxel past
// each jamb). An opening in a +-z wall has d === 1, in a +-x wall w === 1.
function win(m, x, y, z, w, h, d, c = DARK, lintel = DARKWOOD) {
  m.box(x, y, z, w, h, d, c);
  if (d === 1) m.box(x - 1, y + h, z, w + 2, 1, 1, lintel);
  else m.box(x, y + h, z - 1, 1, 1, d + 2, lintel);
}

// Timber joist ends poking out along the top of a wall run (house walls).
function joists(m, x, y, z, len, axis = 'x', step = 3) {
  for (let i = 1; i < len - 1; i += step) (axis === 'x' ? m.set(x + i, y, z, DARKWOOD) : m.set(x, y, z + i, DARKWOOD));
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

// Mediterranean cypress: a short trunk under a dense flame of foliage,
// fullest a third of the way up and tapering to a leaning point, its edge
// ragged with tufts so it reads as a tree and not a post. Darker toward the
// core and the bottom, sunlit tufts near the top.
const CYP = [0x2c5424, 0x335e28, 0x3b692d, 0x457534, 0x507f3a];
function cypress(m, x, y, z, h = 12) {
  m.box(x, y, z, 1, 2, 1, 0x5a3e26);
  const rmax = h >= 14 ? 2.3 : 1.8;
  const lean = (hash3(x, y, z, 14) - 0.5) * 1.2;
  for (let j = 1; j < h; j++) {
    const t = j / h;
    // profile: swell quickly, fullest at ~0.3, taper to a point
    const r = t < 0.3 ? rmax * (0.55 + 1.5 * t) : rmax * Math.pow((1 - t) / 0.7, 0.85);
    const cx = x + 0.5 + lean * t * t, cz = z + 0.5;
    const R = Math.ceil(r + 1);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const px = x + dx, pz = z + dz;
      const d = Math.hypot(px + 0.5 - cx, pz + 0.5 - cz);
      const n = hash3(px, y + j, pz, 13);
      if (d > r + (n - 0.5) * 0.9) continue;
      if (j === h - 1 && d > 0.8) continue;
      const k = Math.min(CYP.length - 1, Math.max(0, Math.floor(t * 2.2 + (d / Math.max(r, 0.5)) * 1.4 + n * 1.4 - 0.4)));
      m.set(px, y + j, pz, CYP[k]);
    }
  }
}

function olive(m, x, y, z) {
  m.box(x, y, z, 1, 3, 1, 0x6a5238);
  m.set(x + 1, y + 2, z, 0x6a5238);
  m.ellipsoid(x + 0.5, y + 4, z, 2, 1.2, 2, OLIVE);
}

// Marble statue of Zeus on a pedestal: a dark stone step, a moulded marble
// base, a red-painted die with a gilt fillet and a cornice, then a slim
// standing figure (chiton to the ankles with a blue himation drape, bare
// chest, broad shoulders, laurel) holding a gilt sceptre and raising a
// golden thunderbolt, so it reads as a figure on a plinth and not a stack.
// (x, z) = die min corner (the die is 4x4; the step spills 2 each side).
function statue(m, x, y, z, { color = MARBLE, bolt = true } = {}) {
  m.box(x - 2, y, z - 2, 8, 1, 8, BASE_STONE);
  m.box(x - 1, y + 1, z - 1, 6, 1, 6, MARBLE_SHADE);
  m.box(x, y + 2, z, 4, 3, 4, PORCH_RED);
  m.box(x, y + 4, z, 4, 1, 4, GILT);
  m.box(x - 1, y + 5, z - 1, 6, 1, 6, MARBLE_SHADE);
  const b = y + 6;
  // feet and chiton
  m.box(x + 1, b, z + 1, 2, 5, 2, color);
  m.set(x + 1, b, z + 3, color).set(x + 2, b, z + 3, MARBLE_SHADE);
  // himation: a painted blue fold from the left hip down across the legs
  for (const [dx, dy] of [[0, 4], [0, 3], [1, 3], [1, 2], [1, 1]]) m.set(x + 1 + dx, b + dy, z + 2, PAINT_BLUE);
  m.set(x + 1, b + 4, z + 1, PAINT_BLUE_D);
  // torso, shoulders, head with a gilt laurel
  m.box(x + 1, b + 5, z + 1, 2, 2, 2, color);
  m.box(x, b + 7, z + 1, 4, 1, 2, color);
  m.box(x + 1, b + 8, z + 1, 2, 2, 2, color);
  m.set(x + 1, b + 8, z + 2, MARBLE_SHADE);
  m.box(x + 1, b + 10, z + 1, 2, 1, 2, MARBLE_SHADE); m.set(x + 1, b + 9, z + 1, GILT).set(x + 2, b + 9, z + 1, GILT);
  // left arm down to a tall gilt sceptre
  m.box(x, b + 5, z + 1, 1, 2, 1, color); m.set(x - 1, b + 5, z + 1, color);
  m.box(x - 2, b - 1, z + 1, 1, 13, 1, GILT);
  // right arm raised with the thunderbolt
  m.box(x + 4, b + 7, z + 1, 1, 3, 1, color);
  if (bolt) {
    m.set(x + 4, b + 10, z + 1, GOLD, { glow: 0.5 }).set(x + 5, b + 11, z + 1, GOLD, { glow: 0.5 }).set(x + 4, b + 12, z + 1, GOLD, { glow: 0.5 }).set(x + 5, b + 13, z + 1, GOLD, { glow: 0.5 });
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
  m.box(x, b + 1, z + 1, 1, 3, 3, BRONZE); m.set(x, b + 2, z + 2, TEAM);  // bronze shield, painted blazon
}

// ---- buildings ---------------------------------------------------------------
// Roofs, pediments, domes and round shafts are smooth parts (shapes.js);
// walls, bases and ornament stay voxel. Each type has its own silhouette:
//   Town Center   the widest and tallest: raised podium, full front
//                 colonnade, a raised central pediment; sage-green tiles
//   Temple        the one true temple front: podium, columns, pediment
//   Academy       a long stoa and a tall watch tower under dark slate
//   Storehouse    an open shed under timber shingles, two granary silos
//   House         four courtyard plans; tiled (four terracotta hues) or,
//                 on some plans, flat roof decks inside a painted parapet
// Materials follow the type: limestone ashlar (Town Center, temple),
// whitewash or ochre plaster with timber lintels (houses, sheds).

// A round granary silo with a domed cap.
function silo(m, cx, y, cz, r, h) {
  cylinder(m, cx, y, cz, r + 0.3, 1, 0x9a9382, { segs: 16 });
  cylinder(m, cx, y + 1, cz, r, h - 1, 0xeee8dc, { segs: 16, cap: false });
  cylinder(m, cx, y + h - 2, cz, r + 0.05, 0.6, 0xa8372a, { segs: 16, cap: false });
  dome(m, cx, y + h + 0.4, cz, r + 0.2, { segs: 16, rings: 5, k: 0.75, tones: [0xe7e1d4, 0xdcd5c6], rib: 0xf5f1e8, ribEvery: 4 });
  cylinder(m, cx, y + h + 0.4 + (r + 0.2) * 0.75, cz, 0.35, 0.8, BRONZE, { segs: 6 });
}

// Town Center: the biggest, tallest thing in town, readable at RTS zoom
// from its outline alone. A raised podium (base course, a three-voxel
// ashlar die with a marble cornice, the stylobate) climbed by a broad
// front stair carries a wide hall: a full front colonnade of eight tall
// columns across the whole width, two-deep at the corners, before a
// red-painted cella wall with bronze doors. The hall's own low ridge runs
// along the front (pediments on the ends); over the middle a raised attic
// with a triglyph frieze carries a much larger front pediment (ridge front
// to back) crowned with acroteria, so the silhouette steps up to the
// centre. The roof is weathered sage-green glazed tile, which no other
// building uses. Team colour: cloths hung on the end walls.
export function townCenterModel(variant = 0, m = new VoxelModel()) {
  // podium: base course, ashlar die, marble cornice, stylobate
  m.box(0, 0, 0, 28, 1, 28, STONE);
  m.box(1, 1, 1, 26, 3, 25, ASHLAR);
  m.box(1, 1, 1, 26, 1, 25, BASE_STONE);
  m.box(0, 4, 0, 28, 1, 27, MARBLE_SHADE);
  for (let x = 0; x < 28; x += 2) m.set(x, 3, 26, SOFFIT);
  m.box(1, 5, 1, 26, 1, 25, MARBLE);
  // broad front stair up the middle, cheek blocks either side
  for (let i = 0; i < 5; i++) m.box(7, i, 27 - i, 14, 1, 1 + i, i & 1 ? MARBLE_SHADE : MARBLE);
  for (const x of [5, 21]) { m.box(x, 0, 23, 2, 5, 5, ASHLAR); m.box(x, 5, 23, 2, 1, 5, MARBLE_SHADE); brazier(m, x, 6, 25); }
  const Y = 6, CH = 13;
  // cella: limestone walls, the colonnade face painted with a red dado and
  // a gilt fillet, bronze doors and small upper windows
  m.box(3, Y, 3, 22, CH, 13, LIMESTONE);
  m.box(3, Y, 3, 22, 1, 13, BASE_STONE);
  m.box(3, Y + 1, 15, 22, 5, 1, PORCH_RED);
  m.box(3, Y + 6, 15, 22, 1, 1, GILT);
  win(m, 12, Y, 15, 4, 8, 1, DOOR, GILT);
  m.box(13, Y + 3, 15, 2, 1, 1, GOLD, { glow: 0.25 });
  win(m, 6, Y, 15, 3, 6, 1, DOOR, MARBLE_SHADE);
  win(m, 19, Y, 15, 3, 6, 1, DOOR, MARBLE_SHADE);
  for (const x of [7, 13, 20]) win(m, x, Y + 9, 15, 2, 2, 1, DARK, MARBLE_SHADE);
  for (const z of [4, 12]) { win(m, 24, Y + 4, z, 1, 4, 2, DARK, MARBLE_SHADE); win(m, 3, Y + 4, z, 1, 4, 2, DARK, MARBLE_SHADE); }
  // colonnade floor
  m.box(2, Y - 1, 16, 24, 1, 9, (x, yy, z) => ((x + z) % 4 === 0 ? MARBLE_SHADE : MARBLE));
  // full front colonnade: eight columns across, a second row at the ends
  for (let i = 0; i < 8; i++) roundColumn(m, 3.5 + i * 3, Y, 23.5, 0.8, CH);
  for (const x of [3.5, 24.5]) roundColumn(m, x, Y, 19.5, 0.8, CH);
  // entablature: two-fascia architrave, Doric frieze, cornice with mutules
  const t = Y + CH;
  const FRIEZE = (x, yy, z) => {
    const p = (x + z) % 5;
    if (p < 2) return (x + z) & 1 ? TRI_B : TRI_A;
    return p === 3 && yy === t + 3 ? MARBLE : METOPE;
  };
  m.box(2, t, 2, 24, 1, 23, MARBLE_SHADE);
  m.box(2, t + 1, 2, 24, 1, 23, MARBLE);
  m.box(2, t + 2, 2, 24, 2, 23, FRIEZE);
  m.box(1, t + 4, 1, 26, 1, 25, MARBLE);
  for (let x = 1; x < 27; x += 2) { m.set(x, t + 3, 25, SOFFIT); m.set(x, t + 3, 1, SOFFIT); }
  for (let z = 1; z < 26; z += 2) { m.set(1, t + 3, z, SOFFIT); m.set(26, t + 3, z, SOFFIT); }
  const top = t + 5;
  // one broad, low temple roof over the whole hall, ridge front to back
  // (about 15 degrees), a wide pediment over the eight-column front with
  // relief figures, a plainer one at the back
  const tiles = TILES.civic;
  const R = gableRoof(m, { wx0: 1, wx1: 27, wz0: 1, wz1: 26, top, axis: 'z', pitch: 0.27, ov: 0.6, ovG: 0.6, ends: 'pediment', tiles, tymp: 0x2f5596, rakeH: 0.8, sima: 0xa8372a, geisonPaint: 0x2d4b82, seed: 41, ornate: true, acroK: 1.7 });
  pedimentRelief(m, R, 26);
  // team cloths on the end walls and hung between the outer columns
  wallBanner(m, 24, Y + 3, 8, '+x', 8);
  wallBanner(m, 1, Y + 3, 8, '+x', 8);
  return m;
}

// House variants: variant % HOUSE_PLANS is the plan (silhouette),
// floor(variant / HOUSE_PLANS) the roof tint; see houseModel.
export const HOUSE_PLANS = 6;
const OCHRE_PLASTER = (x, y, z) => { const h = hash3(x >> 1, y >> 1, z >> 1, 74); return h < 0.5 ? 0xd49a58 : h < 0.85 ? 0xca904f : 0xdca766; };
const HOUSE_PLASTER = [WHITEWASH, OCHRE_PLASTER];
const HOUSE_FILL = [0xf1ede4, 0xd29a5a];
const HOUSE_BAND = [0xa8452f, 0x3f5f8a];
const HOUSE_SOCLE = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 75); return h < 0.4 ? 0x6f695e : h < 0.8 ? 0x645e54 : 0x7a7367; };
const HOUSE_LOT = (x, y, z) => { const h = hash3(x >> 1, 0, z >> 1, 76); let c = h < 0.4 ? 0xd9d1bf : h < 0.8 ? 0xcfc6b2 : 0xe2dbcb; if (((x >> 1) + (z >> 1)) % 2 === 0) c = shade(c, 0.94); return c; };
const DOOR_PAINT = [(x, y, z) => ((x + z) % 2 ? 0x6b4a2e : 0x5f4028), (x, y, z) => ((x + z) % 2 ? 0x35577f : 0x2e4d72), (x, y, z) => ((x + z) % 2 ? 0x4f6b3c : 0x465f35)];
const EARTH = (x, y, z) => pick(hash3(x, 0, z, 77), [0x9c8160, 0x927757, 0xa58a68, 0x8b7152]);
const SOIL = (x, y, z) => (hash3(x, y, z, 78) < 0.5 ? 0x5b4630 : 0x4e3c29);
const CLOTH = [0xefe8d6, 0xb8402f, 0x3f6aa6, 0xd9a441, 0xe9e1cf, 0x8a4a7a, 0xc9763a];
const LOGS = (x, y, z) => (hash3(x, y, z, 98) < 0.5 ? 0x7a5230 : 0x6a462a);
const LOG_END = 0xc9a574;
const PLANK = (x, y, z) => (hash3(x, y, z, 104) < 0.5 ? 0xb08a58 : 0xa27d4d);
// painted board shutters (two tones: boards and the batten between them)
const SHUTTERS = [
  (y) => (y & 1 ? 0x3f6e4a : 0x355f3f),
  (y) => (y & 1 ? 0x3b5f8c : 0x31527a),
  (y) => (y & 1 ? 0x7b4a2c : 0x6a3f25),
  (y) => (y & 1 ? 0x4c7a7a : 0x416a6a),
];
// house roofs run from pale ochre through sun-faded orange and red to old
// dark brick, each with its own cover-tile spacing and a few slipped or
// missing tiles (dark gaps) and odd replacement tiles breaking the rows
const houseTiles = (base, plane, extra = {}) => ({ ...base, ...extra, plane: { ...(base.plane || {}), ...plane } });
// house roofs: clean fired terracotta in two close tints, a regular
// cover-tile rhythm, no missing or odd tiles and almost no weathering
const cleanTiles = (base) => ({ ...base, plane: { ...(base.plane || {}), missing: 0, weather: 0.08, bandEvery: 0 } });
const SAGE_PLANE = { ribGap: 1.5, ribW: 0.36, ribH: 0.46, bandEvery: 0, weather: 0.12, lip: 0.22, antefixH: 0.3, missing: 0 };
// Four roof families so a street never reads as one roof stamped along it:
// Retold's pale sage glaze (white ridge, white fascia), fired terracotta, a
// greyer lichen-weathered sage and sun-faded orange tiles.
const HOUSE_ROOFS = [
  { ...TILES.sage, tones: [0x9db69a, 0x92ab8f, 0xa7bfa3, 0x8ba688], butt: 0x5f775d, fascia: 0xf0ece2, ridge: 0xe9e6dc, soffit: 0x3c4a40, antefix: 0xf3f0e6, plane: SAGE_PLANE },
  cleanTiles({ ...TILES.warm, tones: [0xd9602c, 0xd25a2a, 0xdf6a33, 0xd65d2d], butt: 0x8a3a1e, ridge: 0xa4431f }),
  { ...TILES.sage, tones: [0xaab7a6, 0xa0ae9c, 0xb4c0b0, 0x98a795], butt: 0x69766a, fascia: 0xece8de, ridge: 0xdedbd0, soffit: 0x3f4640, antefix: 0xf1eee4, plane: SAGE_PLANE },
  cleanTiles({ ...TILES.warm, tones: [0xe1804b, 0xda7845, 0xe68a55, 0xdd7c48], butt: 0x9a5030, ridge: 0xb05a34 }),
];
export const HOUSE_TINTS = HOUSE_ROOFS.length;

// a terracotta pot with a clipped round shrub or a flowering plant, 1x1
function potPlant(m, x, y, z, seed = 0) {
  const h = hash3(x, seed, z, 105);
  m.set(x, y, z, 0xa65a34).set(x, y + 1, z, 0xb8683e);
  m.set(x, y + 2, z, h < 0.5 ? 0x4a7b36 : 0x55863b);
  if (h < 0.35) m.set(x, y + 3, z, 0x4a7b36);
  else if (h < 0.7) m.set(x, y + 3, z, h < 0.5 ? 0xd9467a : 0xf2ede2);
}

// stacked firewood, logs lying along x with pale cut ends on the +z face
function woodpile(m, x, y, z, w, h, d = 2) {
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w - (yy >> 1); xx++)
    for (let zz = 0; zz < d; zz++) m.set(x + xx, y + yy, z + zz, zz === d - 1 ? LOG_END : LOGS);
}

// a two-wheeled hand cart, bed 3 wide running along z with its shafts
// resting on the ground toward +z; spoked wheels either side; a load of
// sacks (0), jars (1) or logs (2)
function handCart(m, x, y, z, load = 0) {
  m.box(x, y + 2, z, 3, 1, 4, PLANK);
  m.box(x, y + 3, z, 1, 1, 4, DARKWOOD); m.box(x + 2, y + 3, z, 1, 1, 4, DARKWOOD); m.box(x, y + 3, z, 3, 1, 1, DARKWOOD);
  for (const wx of [x - 1, x + 3]) {
    for (const [dz, dy] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) m.set(wx, y + dy, z + dz, 0x4a3524);
    m.set(wx, y + 1, z + 1, 0x8b6139);
  }
  m.set(x, y + 2, z + 4, WOOD).set(x + 2, y + 2, z + 4, WOOD);
  m.set(x, y + 1, z + 5, WOOD).set(x + 2, y + 1, z + 5, WOOD);
  m.set(x, y, z + 6, DARKWOOD).set(x + 2, y, z + 6, DARKWOOD);
  if (load === 0) { m.box(x, y + 3, z + 1, 3, 1, 2, 0xd9c79e); m.set(x + 1, y + 4, z + 1, 0xcdb98a).set(x + 1, y + 4, z + 2, 0xe2d2aa); }
  else if (load === 1) { for (const dz of [1, 2]) { m.set(x + 1, y + 3, z + dz, 0xb8683e); } m.set(x + 1, y + 4, z + 1, 0xa65a34); m.set(x + 1, y + 4, z + 2, 0xc47440); }
  else for (let dz = 1; dz < 4; dz++) { m.set(x + 1, y + 3, z + dz, dz & 1 ? LOG_END : LOGS); m.set(x + 1, y + 4, z + dz, LOGS); }
}

// a low pomegranate / quince bush for a courtyard garden: a short trunk and
// a rounded crown dotted with fruit, kept well under the eaves
function fruitTree(m, x, y, z, seed = 0) {
  m.box(x, y, z, 1, 2, 1, 0x6a4a2e);
  const fruit = seed & 1 ? 0xe0a030 : 0x8a2d3a;
  for (let dy = 0; dy < 2; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const r = Math.abs(dx) + Math.abs(dz) + dy;
    if (r > 3 || (Math.abs(dx) === 2 && Math.abs(dz) === 2)) continue;
    if (r === 3 && hash3(x + dx, dy + seed, z + dz, 106) < 0.4) continue;
    const h = hash3(x + dx, y + dy, z + dz, 107);
    m.set(x + dx, y + 2 + dy, z + dz, h < 0.1 ? fruit : h < 0.4 ? 0x4a7b36 : h < 0.75 ? 0x3f6a2c : 0x55863b);
  }
}

// a kitchen-garden bed: a stone kerb round dark soil, rows of greens and a
// few flowers
function gardenBed(m, x, z, w, d, seed = 0) {
  m.box(x, 0, z, w, 2, d, 0x9a9384);
  m.box(x + 1, 1, z + 1, w - 2, 1, d - 2, SOIL);
  for (let zz = z + 1; zz < z + d - 1; zz++) for (let xx = x + 1; xx < x + w - 1; xx++) {
    const h = hash3(xx, seed, zz, 108);
    if (((xx - x) & 1) === 0 && h < 0.85) m.set(xx, 2, zz, h < 0.12 ? 0xd9467a : h < 0.2 ? 0xf1c40f : h < 0.55 ? 0x5e8c3a : 0x6e9a42);
  }
}

// Houses: five plans so a quarter reads as a lived-in town, not one asset
// stamped over and over. Every plan shares the grammar (lime-washed walls
// on a grey stone plinth course, terracotta roofs, dark doors and window
// holes) but not the shape:
//   0  courtyard house: an L of a back hall and a gable-ended street wing
//      round a walled yard with a vine pergola, jars and a gate
//   1  two-storey house with a timber balcony on posts over the door and a
//      single-storey lean-to (shed roof) beside it, firewood stacked in front
//   2  a pair of row houses sharing a party wall, different heights and
//      roof tints; walls run to the plot edge so neighbouring row plots join
//   3  row house with a flat-roofed annex: a parapet roof terrace with
//      laundry drying on a line, pots along the edge
//   4  cottage behind a walled front yard: vine pergola across its front,
//      a fruit tree, storage jars
// Plots are 12 x 12 voxels; the street (door) side is +z. Walls, windows
// and doors exist on every face so a house can be turned to its street.
// Walls are coursed ashlar under a thin lime wash: blocks 5 voxels long
// and 3 high in running bond, each its own tone, with darker bed joints
// and head joints, so every wall reads as built stone even at RTS zoom.
// Three washes (white, grey-white, warm cream) keep neighbours apart.
const HOUSE_STUCCO = [
  masonry([0xf4f0e7, 0xece7dc, 0xe6e0d2], [0xefeadf, 0xe3ddcf, 0xf2eee5], { len: 5, course: 3, bed: 0.8, head: 0.88, grime: 0, seed: 141 }),
  masonry([0xe9e6de, 0xdfdbd1, 0xe5e1d7], [0xdcd8cc, 0xe8e4da, 0xd6d1c4], { len: 4, course: 3, bed: 0.8, head: 0.87, grime: 0, seed: 142 }),
  masonry([0xefe2c6, 0xe6d7b8, 0xeadcbf], [0xe2d2b1, 0xeddfc3, 0xdfcfae], { len: 6, course: 3, bed: 0.8, head: 0.88, grime: 0, seed: 145 }),
];
const HOUSE_GABLE = [0xf1ede4, 0xe4e0d6, 0xebdfc4];
// a dark grey base course, two voxels high, set off from the pale walls
const HOUSE_PLINTH = (x, y, z) => { const h = hash3(x >> 1, y, z >> 1, 143); const c = h < 0.4 ? 0x7d766a : h < 0.8 ? 0x736c60 : 0x857e71; return y === 1 ? shade(c, 1.08) : ((x + z) % 3 === 0 ? shade(c, 0.86) : c); };
const HOUSE_DOOR = (x, y, z) => ((x + z) & 1 ? 0x3d2a1c : 0x352419);
const HOUSE_DOOR_BLUE = (x, y, z) => ((x + z) & 1 ? 0x2f4c72 : 0x2a4467);
const HOUSE_WIN = 0x1f1813;
const YARD = (x, y, z) => pick(hash3(x, 0, z, 146), [0xb09572, 0xa68b68, 0xb99e7a, 0xa08564]);
const YARD_WALL = (x, y, z) => (hash3(x >> 1, y, z >> 1, 147) < 0.6 ? 0xefe9de : 0xe5ded0);
const COPING = (x, y, z) => ((x + z) % 3 === 0 ? 0xc0633a : 0xdcd5c4);
const VINE = (x, y, z) => pick(hash3(x, y, z, 148), [0x4a7b36, 0x3f6a2c, 0x55863b, 0x5e8c3a]);
const GRAPE = 0x5a2d52;

export function houseModel(variant = 0, m = new VoxelModel()) {
  const plan = variant % HOUSE_PLANS, tint = Math.floor(variant / HOUSE_PLANS) % HOUSE_TINTS;
  const tiles = HOUSE_ROOFS[tint];
  // wings take the sister tint of the same family (sage / grey sage,
  // terracotta / faded), never a clashing one
  const tiles2 = HOUSE_ROOFS[tint ^ 2];
  const wash = (plan + tint) % 3;
  // plinth course (y 0), plaster to h, optional painted band on the top row
  const body = (x0, z0, w, d, h, { wall = HOUSE_STUCCO[wash], band = false } = {}) => {
    m.box(x0, 0, z0, w, 2, d, HOUSE_PLINTH);
    m.box(x0, 2, z0, w, h - 2, d, wall);
    if (band) m.box(x0, h - 1, z0, w, 1, d, PAINT_BLUE);
    return h;
  };
  // an opening sunk one voxel into the wall face
  const hole = (x, y, z, w, h, face, c) => {
    for (let a = 0; a < w; a++) for (let yy = y; yy < y + h; yy++) {
      if (face === '+z') { m.remove(x + a, yy, z); m.set(x + a, yy, z - 1, c); }
      else if (face === '-z') { m.remove(x + a, yy, z); m.set(x + a, yy, z + 1, c); }
      else if (face === '+x') { m.remove(x, yy, z + a); m.set(x - 1, yy, z + a, c); }
      else { m.remove(x, yy, z + a); m.set(x + 1, yy, z + a, c); }
    }
  };
  const door = (x, zf, c = HOUSE_DOOR) => {
    hole(x, 1, zf, 2, 4, '+z', c);
    m.box(x - 1, 5, zf, 4, 1, 1, MARBLE_SHADE);                 // stone lintel
    m.box(x, 0, zf + 1, 2, 1, 1, MARBLE);                       // threshold step
  };
  // recolour existing wall voxels along a face (lintels, sills)
  const trim = (x, y, zf, w, face, c) => {
    for (let a = 0; a < w; a++) {
      const [vx, vz] = face === '+z' || face === '-z' ? [x + a, zf] : [x, zf + a];
      if (m.has(vx, y, vz)) m.set(vx, y, vz, c);
    }
  };
  // a dark window hole with a timber lintel over it and a stone sill under
  const win = (x, y, zf, face = '+z') => {
    hole(x, y, zf, 2, 2, face, HOUSE_WIN);
    const alongZ = face === '+x' || face === '-x';
    trim(alongZ ? x : x - 1, y + 2, alongZ ? zf - 1 : zf, 4, face, DARKWOOD);
    trim(x, y - 1, zf, 2, face, MARBLE_SHADE);
  };
  // a window with painted board shutters folded back either side
  const winS = (x, y, zf, sh) => {
    win(x, y, zf);
    for (let yy = y; yy < y + 2; yy++) { m.set(x - 1, yy, zf + 1, sh(yy)); m.set(x + 2, yy, zf + 1, sh(yy)); }
  };
  // eaves stand 1.6 voxels proud of the walls so every roof throws a
  // shadow line onto its wall; gable ends keep a shorter verge
  const gable = (o) => gableRoof(m, { ov: 1.6, ovG: 0.8, pitch: 0.36, tiles, fill: HOUSE_GABLE[wash], ...o });
  const hip = (o) => hipRoof(m, { ov: 1.6, pitch: 0.38, tiles, ...o });
  const yardWall = (x0, z0, x1, z1, h = 3, gate = null) => {
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (gate && x >= gate[0] && x <= gate[1] && z >= gate[2] && z <= gate[3]) continue;
      m.set(x, 0, z, HOUSE_PLINTH);
      for (let y = 1; y < h; y++) m.set(x, y, z, YARD_WALL);
      m.set(x, h, z, COPING);
    }
  };
  // timber pergola: posts at the corners of [x0,x1] x [z0,z1], beams and
  // slats at y, a ragged vine canopy with a few grape clusters
  const pergola = (x0, z0, x1, z1, y, seed) => {
    for (const [px, pz] of [[x0, z1], [x1, z1]]) m.box(px, 0, pz, 1, y, 1, DARKWOOD);
    for (let x = x0; x <= x1; x++) m.set(x, y, z1, DARKWOOD);
    for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z++) m.set(x, y, z, WOOD);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const h = hash3(x, seed, z, 149);
      if (h < 0.62) m.set(x, y + 1, z, VINE);
      if (h < 0.07 && z > z0) m.set(x, y - 1, z, GRAPE);
    }
  };
  // laundry line between two posts, cloths hanging along it
  const laundry = (x, y, z0, z1) => {
    m.box(x, y, z0, 1, 4, 1, DARKWOOD); m.box(x, y, z1, 1, 4, 1, DARKWOOD);
    for (let z = z0 + 1; z < z1; z++) {
      m.set(x, y + 3, z, 0xcdb98a);
      const c = CLOTH[Math.floor(hash3(x, z, variant, 150) * CLOTH.length)];
      if (((z - z0) % 3) !== 0) { m.set(x, y + 2, z, c); if ((z & 1) === 0) m.set(x, y + 1, z, c); }
    }
  };

  // a rubble-stone chimney stack, 2 x 2, from the wall top at y0 to y1,
  // a projecting cap slab and a sooty flue; the smoke rises from m.chimney
  const chimney = (x, z, y0, y1) => {
    m.box(x, y0, z, 2, y1 - y0, 2, (xx, yy, zz) => (hash3(xx, yy >> 1, zz, 151) < 0.5 ? 0xa39b8b : 0x958d7d));
    m.box(x, y1, z, 2, 1, 2, 0x6f685c);
    m.set(x, y1 + 1, z, 0x7d766a); m.set(x + 1, y1 + 1, z + 1, 0x7d766a);
    m.set(x + 1, y1 + 1, z, 0x2a2420); m.set(x, y1 + 1, z + 1, 0x2a2420);
    m.chimney = [x + 1, y1 + 2, z + 1];
  };
  const up = (r) => Math.ceil(r.ridgeY) + 2;

  if (plan === 0) {
    // back hall across the plot, gable-ended wing on the left to the street
    const top = body(0, 0, 12, 5, 9);
    const r0 = gable({ wx0: 0, wx1: 12, wz0: 0, wz1: 5, top, axis: 'x', seed: 11 + variant });
    chimney(9, 2, top, up(r0));
    const tw = body(0, 5, 5, 6, 8);
    gable({ wx0: 0, wx1: 5, wz0: 5, wz1: 11, top: tw, axis: 'z', ovG: 0.5, seed: 12 + variant });
    door(1, 10);
    win(4, 3, 7, '+x');
    win(0, 3, 6, '-x'); win(0, 4, 1, '-x'); win(4, 5, 0, '-z'); win(8, 5, 0, '-z');
    // the yard: packed earth, a low wall with a gate on the street
    for (let x = 5; x < 12; x++) for (let z = 5; z < 12; z++) m.set(x, 0, z, YARD);
    yardWall(5, 11, 11, 11, 3, [7, 8, 11, 11]);
    yardWall(11, 5, 11, 10, 3);
    // the hall's yard front: a door, a window, a vine pergola off it
    hole(8, 1, 4, 2, 4, '+z', HOUSE_DOOR);
    win(5, 4, 4);
    win(11, 4, 1, '+x');
    pergola(5, 5, 10, 8, 5, variant);
    pithos(m, 9, 1, 9, 0xb8683e); amphora(m, 10, 1, 10, 0xc47440); amphora(m, 6, 1, 10, 0xa65a34);
    m.box(6, 1, 8, 1, 1, 2, 0xcfc7b4);                           // bench under the vine
    potPlant(m, 3, 0, 11, variant);
    return m;
  }
  if (plan === 1) {
    // two-storey house at the back under a low gable (ridge across the
    // plot), a single-storey front room whose flat roof is a terrace with a
    // parapet, jars and a small awning, reached by a door from the upper
    // floor; a lean-to shed with a shed roof on the right, firewood by it
    const top = body(0, 1, 8, 5, 13, { band: true });
    const r1 = gable({ wx0: 0, wx1: 8, wz0: 1, wz1: 6, top, axis: 'x', seed: 21 + variant });
    chimney(1, 3, top, up(r1));
    const ft = body(0, 6, 8, 4, 7);
    m.box(0, ft, 6, 8, 1, 4, ROOFDECK);
    for (let x = 0; x < 8; x++) m.set(x, ft + 1, 9, (x & 1) ? YARD_WALL : COPING);
    for (let z = 6; z < 10; z++) { m.set(0, ft + 1, z, YARD_WALL); m.set(7, ft + 1, z, YARD_WALL); }
    m.box(0, ft - 1, 6, 8, 1, 4, PAINT_BLUE);                        // painted band under the terrace
    hole(2, ft + 1, 5, 2, 4, '+z', HOUSE_DOOR);                      // door out onto the terrace
    win(5, ft + 2, 5);
    // an awning of cloth on poles over half the terrace
    const cloth = CLOTH[(variant % 3) + 1];
    for (const x of [4, 7]) m.box(x, ft + 1, 8, 1, 3, 1, DARKWOOD);
    for (let x = 4; x < 8; x++) for (let z = 6; z < 9; z++) m.set(x, ft + 4, z, (x & 1) ? cloth : shade(cloth, 0.86));
    pithos(m, 1, ft + 1, 7, 0xa65a34); potPlant(m, 3, ft + 1, 8, variant);
    door(1, 9, tint & 1 ? HOUSE_DOOR_BLUE : HOUSE_DOOR);
    win(5, 2, 9);
    win(0, 3, 7, '-x'); win(0, 8, 3, '-x'); win(2, 8, 1, '-z'); win(5, 3, 1, '-z');
    // lean-to on the right under a shed roof, its own door
    const lt = body(8, 3, 4, 6, 6);
    shedRoof(m, { wx0: 8, wx1: 12, wz0: 3, wz1: 9, top: lt, dir: '+x', pitch: 0.3, ov: 0.8, ovS: 0.4, tiles: tiles2, seed: 22 + variant, fill: HOUSE_GABLE[wash] });
    hole(9, 1, 8, 2, 4, '+z', DARKWOOD);
    win(11, 3, 5, '+x');
    woodpile(m, 8, 0, 10, 4, 3, 2);
    amphora(m, 4, 0, 10, 0xc47440);
    return m;
  }
  if (plan === 2) {
    // two narrow row houses sharing a party wall at x = 6, walls to the
    // plot edges; the left one taller, the right under another roof tint
    const ta = body(0, 1, 6, 10, 11, { band: true });
    const r2 = gable({ wx0: 0, wx1: 6, wz0: 1, wz1: 11, top: ta, axis: 'z', ovG: 0.6, ov: 0.25, seed: 31 + variant });
    chimney(2, 3, ta, up(r2));
    const tb = body(6, 2, 6, 9, 8, { wall: HOUSE_STUCCO[(wash + 1) % 3] });
    gable({ wx0: 6, wx1: 12, wz0: 2, wz1: 11, top: tb, axis: 'x', ovG: 0.2, tiles: tiles2, fill: HOUSE_GABLE[(wash + 1) % 3], seed: 32 + variant });
    door(1, 10);
    winS(3, 7, 10, SHUTTERS[variant % 4]);
    win(4, 3, 10);
    door(9, 10, HOUSE_DOOR_BLUE);
    win(7, 3, 10);
    win(0, 6, 4, '-x'); win(11, 3, 5, '+x'); win(2, 6, 1, '-z'); win(8, 3, 2, '-z');
    // doorsteps: a pot plant by one, a bench and a jar by the other
    potPlant(m, 4, 0, 11, variant);
    m.box(6, 0, 11, 2, 1, 1, 0xcfc7b4);
    amphora(m, 11, 0, 11, 0xb8683e);
    return m;
  }
  if (plan === 3) {
    // gable-ended row house with a flat-roofed annex: roof terrace with a
    // parapet, laundry drying, pots along the edge
    const ta = body(0, 0, 7, 11, 10);
    const r3 = gable({ wx0: 0, wx1: 7, wz0: 0, wz1: 11, top: ta, axis: 'z', ov: 0.3, ovG: 0.7, seed: 41 + variant });
    chimney(3, 7, ta, up(r3));
    const tb = body(7, 1, 5, 10, 7, { band: true });
    m.box(7, tb, 1, 5, 1, 10, ROOFDECK);
    for (let x = 7; x < 12; x++) { m.set(x, tb + 1, 1, YARD_WALL); m.set(x, tb + 1, 10, YARD_WALL); }
    for (let z = 1; z < 11; z++) m.set(11, tb + 1, z, YARD_WALL);
    laundry(9, tb + 1, 2, 9);
    potPlant(m, 8, tb + 1, 9, variant); pithos(m, 7, tb + 1, 3, 0xa65a34);
    door(1, 10);
    winS(2, 6, 10, SHUTTERS[(variant + 1) % 4]);
    win(4, 3, 10);
    hole(8, 1, 10, 2, 4, '+z', HOUSE_DOOR_BLUE);
    m.box(7, 5, 10, 4, 1, 1, MARBLE_SHADE);
    win(11, 3, 4, '+x'); win(0, 3, 3, '-x'); win(0, 6, 7, '-x'); win(3, 3, 0, '-z');
    m.box(10, 0, 11, 2, 1, 1, 0xcfc7b4);
    amphora(m, 5, 0, 11, 0xc47440);
    return m;
  }
  if (plan === 5) {
    // tower house: a three-storey tower at the back left under a steep
    // pyramid roof, a gable-fronted hall beside it running to the street
    // with the chimney, and a walled front yard before the tower with a
    // vine pergola, jars and a well-head
    const tw = body(0, 0, 6, 6, 18, { band: true });
    hip({ wx0: 0, wx1: 6, wz0: 0, wz1: 6, top: tw, pitch: 0.55, ov: 1.4 });
    m.box(0, 7, 0, 6, 1, 6, MARBLE_SHADE);                            // floor string courses
    m.box(0, 12, 0, 6, 1, 6, MARBLE_SHADE);
    win(2, 9, 5); win(2, 14, 5); win(5, 9, 2, '+x'); win(5, 14, 2, '+x');
    win(0, 9, 2, '-x'); win(0, 14, 2, '-x'); win(2, 14, 0, '-z');
    const hl = body(6, 1, 6, 9, 8, { wall: HOUSE_STUCCO[(wash + 1) % 3] });
    const r5 = gable({ wx0: 6, wx1: 12, wz0: 1, wz1: 10, top: hl, axis: 'z', ov: 1.4, ovG: 0.8, tiles: tiles2, fill: HOUSE_GABLE[(wash + 1) % 3], seed: 61 + variant });
    chimney(8, 3, hl, up(r5));
    door(8, 9, tint & 1 ? HOUSE_DOOR_BLUE : HOUSE_DOOR);
    win(11, 3, 5, '+x'); win(11, 3, 2, '+x'); win(7, 3, 1, '-z');
    // porch: two posts and a short shed roof over the hall door
    for (const px of [7, 10]) m.box(px, 0, 11, 1, 5, 1, DARKWOOD);
    shedRoof(m, { wx0: 7, wx1: 11, wz0: 10, wz1: 12, top: 5, dir: '+z', pitch: 0.35, ov: 0.6, ovS: 0.3, tiles: tiles2, seed: 62 + variant, fill: HOUSE_GABLE[wash] });
    for (let x = 0; x < 6; x++) for (let z = 6; z < 12; z++) m.set(x, 0, z, YARD);
    yardWall(0, 11, 5, 11, 3, [2, 3, 11, 11]);
    yardWall(0, 6, 0, 10, 3);
    hole(2, 1, 5, 2, 4, '+z', HOUSE_DOOR);
    pergola(1, 6, 5, 8, 5, variant + 5);
    pithos(m, 1, 1, 9, 0xb8683e); amphora(m, 4, 1, 10, 0xc47440); amphora(m, 5, 1, 9, 0xa65a34);
    // well-head: a round stone kerb
    m.box(3, 1, 9, 1, 2, 1, 0xa39b8b);
    potPlant(m, 11, 0, 11, variant);
    return m;
  }
  // U-plan courtyard house: a hip-roofed back range, a gable-ended wing
  // on the left fronting the street, a lower flat-roofed store on the
  // right, and between them a yard behind a gated wall with a vine
  // pergola off the back range, a fruit tree and storage jars
  const top = body(0, 0, 12, 5, 9, { band: true });
  const r4 = hip({ wx0: 0, wx1: 12, wz0: 0, wz1: 5, top, seed: 51 + variant });
  chimney(9, 1, top, up(r4));
  const lw = body(0, 5, 4, 7, 8);
  gable({ wx0: 0, wx1: 4, wz0: 5, wz1: 12, top: lw, axis: 'z', ov: 0.6, ovG: 0.4, tiles: tiles2, seed: 52 + variant });
  const rw = body(8, 5, 4, 5, 6);
  m.box(8, rw, 5, 4, 1, 5, ROOFDECK);
  for (let x = 8; x < 12; x++) m.set(x, rw + 1, 9, COPING);
  for (let z = 5; z < 10; z++) m.set(11, rw + 1, z, YARD_WALL);
  pithos(m, 9, rw + 1, 6, 0xb8683e); potPlant(m, 10, rw + 1, 8, variant);
  door(1, 11, tint & 1 ? HOUSE_DOOR : HOUSE_DOOR_BLUE);
  win(1, 5, 11); win(0, 3, 7, '-x'); win(3, 3, 8, '+x');
  hole(5, 1, 4, 2, 4, '+z', HOUSE_DOOR); win(9, 4, 4);             // back range yard front
  win(11, 3, 1, '+x'); win(0, 4, 1, '-x'); win(3, 4, 0, '-z'); win(8, 4, 0, '-z');
  hole(9, 1, 9, 2, 3, '+z', DARKWOOD); win(11, 2, 6, '+x');       // store door, vent
  for (let x = 4; x < 12; x++) for (let z = 5; z < 12; z++) if (!m.has(x, 0, z)) m.set(x, 0, z, YARD);
  yardWall(4, 11, 11, 11, 3, [6, 7, 11, 11]);
  pergola(4, 5, 7, 7, 5, variant + 3);
  fruitTree(m, 6, 1, 9, variant);
  pithos(m, 4, 1, 10, 0xb8683e); amphora(m, 7, 1, 8, 0xc47440);
  woodpile(m, 8, 1, 10, 3, 2, 1);
  return m;
}

// Storehouse: an open-fronted whitewashed shed on white columns under a low
// warm-terracotta gable, full of goods, with two white granary silos under
// domed caps in front, all on a paved lot.
export function storehouseModel(variant = 0, m = new VoxelModel()) {
  const PL = HOUSE_PLASTER[0], BAND = HOUSE_BAND[0];
  m.box(0, 0, 0, 12, 1, 12, HOUSE_LOT);
  m.box(1, 1, 1, 10, 1, 6, MARBLE_SHADE);
  m.box(1, 1, 1, 10, 7, 2, PL);
  m.box(1, 1, 1, 2, 7, 6, PL);
  m.box(10, 1, 1, 1, 7, 6, PL);
  m.box(1, 1, 1, 10, 1, 2, HOUSE_SOCLE); m.box(1, 1, 1, 2, 1, 6, HOUSE_SOCLE); m.box(10, 1, 1, 1, 1, 6, HOUSE_SOCLE);
  m.box(1, 2, 1, 10, 1, 2, BAND); m.box(1, 2, 1, 2, 1, 6, BAND); m.box(10, 2, 1, 1, 1, 6, BAND);
  for (const x of [4.5, 7.5]) roundColumn(m, x, 2, 6.2, 0.5, 5);
  m.box(1, 7, 6, 10, 1, 1, MARBLE);
  m.box(10, 4, 3, 1, 2, 2, DARK); m.box(10, 6, 2, 1, 1, 4, MARBLE_SHADE);
  gableRoof(m, { wx0: 1, wx1: 11, wz0: 1, wz1: 7, top: 8, axis: 'x', pitch: 0.3, ov: 0.7, ovG: 0.5, tiles: TILES.shingle, fill: HOUSE_FILL[0], seed: 51 });
  // goods under the shed
  m.box(3, 2, 3, 2, 2, 2, 0x9b7040).box(3, 4, 3, 2, 1, 2, 0x8a6236);
  m.box(5, 2, 3, 2, 2, 2, 0xa27a48);
  for (let i = 0; i < 3; i++) m.box(7, 2 + i, 3 + (i % 2), 3, 1, 1, 0x6e4526);
  amphora(m, 3, 2, 5); amphora(m, 4, 2, 6, 0xa65a34);
  m.box(6, 2, 5, 2, 1, 1, GOLD, { glow: 0.1 }).set(6, 3, 5, GOLD, { glow: 0.1 });
  // granary silos
  silo(m, 3.4, 1, 9.6, 2.1, 7);
  silo(m, 8.6, 1, 9.4, 2.3, 9);
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

// Temple: a peripteral Doric temple, the one true temple front in the town.
// A three-step crepidoma (each step its own stone tone, so the risers read
// as stripes) carries a colonnade all round - four columns across the front
// and back, five down each flank - before a red-painted cella with bronze
// doors. Over the columns: a two-band architrave, a Doric frieze of blue
// triglyphs and red metopes (each with a small marble relief) under a gilt
// taenia, a projecting cornice with dark mutules, then a terracotta gable
// whose pediments carry a painted sima, a deep blue tympanum with coloured
// figures, and gilt acroteria.
const TRI_A = 0x2d4b82, TRI_B = 0x1d3360;       // triglyph glyphs / grooves
const METOPE = 0xa23a2c;
function doricFrieze(m, x, y, z, w, d, h = 3) {
  // walk the perimeter; triglyphs 2 voxels wide, metopes 3, a triglyph on
  // every corner
  const face = (len, put) => {
    for (let i = 0; i < len; i++) {
      const p = i % 5;
      for (let k = 0; k < h; k++) {
        let c;
        if (p < 2) c = (i & 1) ? TRI_B : TRI_A;
        else c = (p === 3 && k === 1) ? MARBLE : METOPE;
        put(i, y + k, c);
      }
    }
  };
  face(w, (i, yy, c) => { m.set(x + i, yy, z + d - 1, c); m.set(x + i, yy, z, c); });
  face(d, (i, yy, c) => { m.set(x + w - 1, yy, z + i, c); m.set(x, yy, z + i, c); });
  // fill the core so the frieze is solid
  m.box(x + 1, y, z + 1, w - 2, h, d - 2, MARBLE_SHADE);
  // taenia: gilt fillet over the frieze, regulae drops under the triglyphs
  m.box(x, y + h, z, w, 1, d, GILT);
  return y + h + 1;
}

export function templeModel(variant = 0, m = new VoxelModel()) {
  // crepidoma: three steps, then the stylobate
  const STEP = [0x9b927f, 0xc2b9a5, 0xddd6c6];
  for (let i = 0; i < 3; i++) m.box(i, i, i, 20 - 2 * i, 1, 24 - 2 * i, (x, y, z) => ((x + z + i) % 7 === 0 ? shade(STEP[i], 0.9) : STEP[i]));
  m.box(3, 3, 3, 14, 1, 18, MARBLE);
  // a stair ramp up the middle of the front steps
  for (let i = 0; i < 3; i++) m.box(7, i, 21 + (2 - i) - 0, 6, 1, 1 + i, i & 1 ? MARBLE : MARBLE_SHADE);
  const y = 4, CH = 12;
  // cella: ashlar walls, the front face painted red with bronze doors
  m.box(6, y, 6, 8, CH, 11, LIMESTONE);
  m.box(6, y, 6, 8, 1, 11, BASE_STONE);
  m.box(6, y + 1, 16, 8, CH - 1, 1, PORCH_RED);
  m.box(8, y, 16, 4, 8, 1, DOOR);
  m.box(8, y + 8, 16, 4, 1, 1, GILT);
  m.box(9, y + 3, 17, 2, 1, 1, GOLD, { glow: 0.3 });
  for (const x of [6, 13]) m.box(x, y, 16, 1, CH, 1, MARBLE);             // antae
  m.box(5, y + CH - 1, 5, 10, 1, 13, MARBLE_SHADE);                        // ceiling beams
  // peristyle: 4 x 5 columns
  const xs = [4, 8, 12, 16], zs = [4.2, 8.4, 12.6, 16.8, 20.2];
  for (const x of xs) for (const z of [zs[0], zs[4]]) roundColumn(m, x, y, z, 0.85, CH);
  for (const x of [xs[0], xs[3]]) for (const z of zs.slice(1, 4)) roundColumn(m, x, y, z, 0.85, CH);
  // entablature: architrave in two fasciae, the Doric frieze, cornice
  let t = y + CH;
  m.box(2, t, 2, 16, 1, 20, MARBLE_SHADE);
  m.box(2, t + 1, 2, 16, 1, 20, MARBLE);
  t = doricFrieze(m, 2, t + 2, 2, 16, 20, 3);
  m.box(1, t, 1, 18, 1, 22, MARBLE);                                        // cornice (geison)
  for (let x = 1; x < 19; x += 2) { m.set(x, t - 1, 1, SOFFIT); m.set(x, t - 1, 22, SOFFIT); }   // mutules
  for (let z = 1; z < 23; z += 2) { m.set(1, t - 1, z, SOFFIT); m.set(18, t - 1, z, SOFFIT); }
  t += 1;
  const R = gableRoof(m, { wx0: 1, wx1: 19, wz0: 1, wz1: 23, top: t, axis: 'z', pitch: 0.28, ov: 0.5, ovG: 1.2, ends: 'pediment', tiles: TILES.brick, tymp: 0x2f5596, rakeH: 0.8, sima: 0xa8372a, geisonPaint: 0x2d4b82, seed: 71, ornate: true });
  pedimentRelief(m, R, 23);
  pedimentRelief(m, R, 0, -1);

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

// Relief figures standing in a pediment's recessed tympanum (the front
// end, voxel row z = vz), kept under the raking cornice: a taller gilt god
// in the middle, marble figures to either side, reclining ones toward the
// corners.
function pedimentRelief(m, R, vz, dir = 1) {
  const { top, ridgeY, um, half, pitch, rakeH, P } = R;
  // voxel at (u across the ridge, yy) in the pediment plane vz
  const setU = (u, yy, c) => { const q = P(u, yy, vz); m.set(q[0], yy, q[2], c); };
  const span = half - rakeH / pitch, rise = ridgeY - rakeH - top;
  const inner = (u) => top + rise * (1 - Math.abs(u - um) / span);
  const y0 = Math.ceil(top);
  const ROBES = [0xf1ece2, 0xa8372a, 0xf1ece2, 0xd2a847, 0xf1ece2];
  const SKIN = 0xe8d6bd;
  // slim figures standing three voxels apart on the blue ground, a gilt Zeus in the middle,
  // painted robes to the sides, reclining figures in the low corners
  for (let x = Math.floor(um - span) + 1; x < um + span - 1; x++) {
    const lim = Math.min(inner(x), inner(x + 1)) - 0.2;
    const hgt = Math.floor(lim) - y0;
    if (hgt < 1) continue;
    const d = x + 0.5 - um, ad = Math.abs(d);
    const slot = Math.floor((ad + 1) / 3), pos = Math.floor(ad + 1) % 3;   // 3-voxel slots out from the centre
    if (ad > 1 && pos !== 1) continue;                                       // blue ground between figures
    const centre = ad < 1.1;
    const robe = centre ? GOLD : ROBES[slot % ROBES.length];
    const hh = centre ? hgt : hgt >= 4 ? hgt - 1 : hgt;
    for (let yy = y0; yy < y0 + hh; yy++) {
      const head = yy === y0 + hh - 1 && hh >= 2;
      setU(x, yy, head ? (centre ? GILT : SKIN) : robe);
    }
  }
  void dir;
}

// Military Academy: a long stoa across the back (seven round columns before
// a solid back wall, a low gable with pediments at both ends) and a tall
// square watch tower at the front corner, round a sand training court.
export function barracksModel(variant = 0, m = new VoxelModel()) {
  const S = 20;
  const SAND = (x, y, z) => (hash3(x, y, z, 14) < 0.5 ? 0xd2bd92 : 0xc4ae84);
  m.box(0, 0, 0, S, 1, S, BASE_STONE);
  m.box(1, 1, 1, 18, 1, 18, MARBLE_SHADE);
  m.box(2, 1, 11, 11, 1, 7, SAND);
  // ---- stoa (z 1..10)
  m.box(0, 1, 1, 20, 1, 9, MARBLE_DARK);
  m.box(1, 2, 1, 18, 1, 9, MARBLE);
  m.box(1, 3, 1, 18, 9, 3, LIMESTONE);
  m.box(1, 3, 1, 18, 1, 3, BASE_STONE);
  m.box(4, 3, 4, 3, 5, 1, DOOR); m.box(13, 3, 4, 3, 5, 1, DOOR);
  m.box(9, 5, 4, 2, 4, 1, DARK);
  for (const x of [5, 14]) { m.box(x - 1, 8, 4, 5, 1, 1, MARBLE); }
  for (let i = 0; i < 7; i++) roundColumn(m, 2.6 + i * 2.47, 3, 8.4, 0.62, 8);
  m.box(1, 11, 7, 18, 1, 3, MARBLE_SHADE);
  m.box(1, 12, 7, 18, 1, 3, (x) => ((x % 5) < 2 ? TRI_A : METOPE));
  m.box(1, 12, 4, 18, 1, 3, MARBLE_SHADE);
  gableRoof(m, { wx0: 1, wx1: 19, wz0: 1, wz1: 10, top: 13, axis: 'x', pitch: 0.3, ov: 0.9, ovG: 1, ends: 'pediment', tiles: TILES.civic, tymp: 0x2f5596, rakeH: 0.7, sima: 0x8a6a3a, geisonPaint: 0x2c333c, seed: 61 });
  m.box(1, 12, 1, 18, 1, 3, MARBLE_SHADE);
  // ---- watch tower (front right)
  // same grammar as the houses: whitewash on a stone plinth, a dark door,
  // window slits, one blue band under a terracotta hip
  const TOWER = HOUSE_PLASTER[0];
  m.box(13, 1, 12, 7, 2, 7, HOUSE_SOCLE);
  m.box(14, 3, 13, 5, 21, 5, TOWER);
  for (const yy of [11, 18]) { m.box(16, yy, 18, 1, 3, 1, DARK); m.box(19, yy, 15, 1, 3, 1, DARK); }
  m.box(15, 3, 18, 3, 5, 1, DOOR);
  m.box(14, 23, 13, 5, 1, 5, PAINT_BLUE); m.box(14, 24, 13, 5, 1, 5, TOWER);
  hipRoof(m, { wx0: 14, wx1: 19, wz0: 13, wz1: 18, top: 25, pitch: 0.55, ov: 1.1, tiles: TILES.civic, seed: 63 });
  wallBanner(m, 19, 10, 15, '+x', 5);
  // ---- low court walls, gateway piers on the front
  m.box(0, 2, 10, 2, 3, 9, HOUSE_PLASTER[0]); m.box(0, 5, 10, 2, 1, 9, MARBLE_SHADE);
  m.box(0, 2, 18, 5, 3, 2, HOUSE_PLASTER[0]); m.box(0, 5, 18, 5, 1, 2, MARBLE_SHADE);
  for (const x of [5, 10]) m.box(x, 2, 18, 2, 7, 2, MARBLE);
  m.box(4, 9, 18, 9, 1, 2, MARBLE_SHADE);
  m.box(12, 2, 18, 1, 3, 2, HOUSE_PLASTER[0]);
  // ---- court: bronze hoplite, weapon rack, archery target
  hopliteStatue(m, 8, 2, 13);
  m.box(3, 2, 12, 1, 4, 1, WOOD).box(6, 2, 12, 1, 4, 1, WOOD).box(3, 5, 12, 4, 1, 1, WOOD);
  for (const x of [4, 5]) { m.box(x, 2, 12, 1, 5, 1, 0x9aa0a6); m.set(x, 7, 12, 0xc9ced3); }
  archeryTarget(m, 3, 2, 16);
  return m;
}

// Weathering pass over a finished model's pale stone/plaster/marble voxels:
//   - quoins: every outside wall corner is dressed with long-and-short
//     blocks of a warmer, darker stone (alternate courses reach two voxels
//     round each face), so corners read as built stone, not a cut box;
//   - a grimy splash zone near the ground, darkest at the foot;
//   - rain streaks down from sills and wall tops, and faint lichen patches.
const QUOIN = 0xb09c78;
function weather(m, { ground = 1, grime = 5, quoin: QC = QUOIN, quoinMix = 0.7, wash = false } = {}) {
  const b = m.bounds();
  const pale = (c) => {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, bl = c & 255;
    return Math.min(r, g, bl) > 0xa8 && Math.max(r, g, bl) - Math.min(r, g, bl) < 0x3c;
  };
  const edits = [];
  const has = (x, y, z) => m.has(x, y, z);
  for (let y = b.min[1]; y < b.max[1]; y++)
    for (let z = b.min[2]; z < b.max[2]; z++)
      for (let x = b.min[0]; x < b.max[0]; x++) {
        const v = m.get(x, y, z);
        if (!v || v.team || v.glow || !pale(v.c)) continue;
        const ex = !has(x - 1, y, z) || !has(x + 1, y, z), ez = !has(x, y, z - 1) || !has(x, y, z + 1);
        if (!ex && !ez) continue;                               // not on a wall face
        let c = v.c;
        const course = Math.floor((y - ground) / 3);
        // corners (both a +-x and a +-z face open) and the long quoin arm
        let quoin = QC !== null && ex && ez;
        if (QC !== null && !quoin && (course & 1)) {
          // within two voxels of the wall's end along the face
          for (const [dx, dz] of ez && !ex ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]) {
            if (has(x + dx, y, z + dz) && !has(x + 2 * dx, y, z + 2 * dz)) quoin = true;
            if (has(x + dx, y, z + dz) && has(x + 2 * dx, y, z + 2 * dz) && !has(x + 3 * dx, y, z + 3 * dz)) quoin = true;
          }
        }
        if (quoin && !has(x, y + 1, z) && !has(x, y - 1, z)) quoin = false;     // a lone trim course
        if (quoin) {
          c = mix(c, QC, quoinMix);
          if ((y - ground) % 3 === 0) c = shade(c, 0.8);          // joint under each quoin block
        }
        // splash zone near the ground
        const gy = y - ground;
        if (gy >= 0 && gy < grime) c = shade(mix(c, 0x9c8a6c, 0.18 * (1 - gy / grime)), 0.82 + 0.036 * gy);
        // rain streaks: some columns darken below an overhang or opening
        const hs = hash3(x + z * 3, 0, x - z, 91);
        if (hs < 0.16 && (has(x, y + 1, z) === false || hash3(x, y >> 2, z, 92) < 0.35)) c = shade(c, 0.9);
        else if (hs < 0.16) c = shade(c, 0.94);
        // lichen / soot patches
        if (hash3(x >> 2, y >> 2, z >> 2, 93) < 0.12) c = shade(mix(c, 0xa59a78, 0.2), 0.95);
        if (wash) {
          // lime-wash renewed in patches: older, darker coats show through
          // in ragged blotches, a greyer one lower down, and here and there
          // the plaster has flaked off to the rubble under it
          const n = hash3(Math.floor((x + 1) / 3), Math.floor(y / 2), Math.floor((z + 1) / 3), 94) * 0.7 + hash3(x, y, z, 95) * 0.3;
          if (n < 0.2) c = shade(mix(c, 0xc9b58f, 0.45), 0.9);
          else if (n < 0.28) c = shade(mix(c, 0xb7b2a2, 0.35), 0.93);
          if (n < 0.14 && hash3(x, y, z, 96) < 0.22 && gy > 1) c = 0xa08c6c;
        }
        if (c !== v.c) edits.push([x, y, z, c]);
      }
  for (const [x, y, z, c] of edits) m.get(x, y, z).c = c;
  return clothFolds(m);
}

// Team cloth is dyed, not painted: the shader multiplies the owner colour by
// the voxel colour, so give every cloth voxel a fold tone (vertical pleats
// lighter and darker, the foot of each hanging a touch darker) instead of
// one flat saturated value.
function clothFolds(m) {
  for (const [k, v] of m.vox) {
    if (!v.team) continue;
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;   // voxel.js key layout
    const pleat = ((x + z) % 3 + 3) % 3;
    let c = pleat === 0 ? 0xffffff : pleat === 1 ? 0xc6c3bd : 0x96928b;
    if (!m.has(x, y - 1, z)) c = shade(c, 0.85);
    v.c = c;
  }
  return m;
}
function mix(a, b, t) {
  const ch = (c, s) => (c >> s) & 255;
  return (Math.round(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t) << 16) | (Math.round(ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t) << 8) | Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
}
const weathered = (fn, opts) => (variant = 0, m) => {
  // construction stages pass their own recording model: leave those alone
  if (m) return fn(variant, m);
  return weather(fn(variant), opts);
};

export const BUILDING_MODELS = {
  town_center: weathered(townCenterModel, { ground: 3, quoin: 0xd9ceb4, quoinMix: 0.45 }),
  house: weathered(houseModel, { ground: 2, grime: 4, quoin: 0xc9bb9c, quoinMix: 0.35 }),
  storehouse: weathered(storehouseModel, { ground: 1, quoin: null, grime: 2 }),
  farm: farmModel,
  temple: weathered(templeModel, { ground: 4, quoin: 0xd9ceb4, quoinMix: 0.45 }),
  barracks: weathered(barracksModel, { ground: 3, quoin: 0xd9ceb4, quoinMix: 0.45, grime: 3 }),
};

// Number of visual variants per type (picked per building from its tile).
export const BUILDING_VARIANTS = { house: HOUSE_TINTS * HOUSE_PLANS };

export {
  WOOD, DARKWOOD, STONE, MARBLE, MARBLE_SHADE, MARBLE_DARK, ASHLAR, PAVE, TERRACOTTA, BRONZE, GOLD, FIRE, LEAF,
  amphora, pithos, potPlant, cypress, olive, statue, hopliteStatue, brazier, roofTile, shade, gable,
};
