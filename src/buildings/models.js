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
  m.box(x, b + 1, z + 1, 1, 3, 3, BRONZE); m.set(x, b + 2, z + 2, TEAM);  // bronze shield, painted blazon
}

// ---- buildings ---------------------------------------------------------------
// Roofs, pediments, domes and round shafts are smooth parts (shapes.js);
// walls, bases and ornament stay voxel. Each type has its own silhouette:
//   Town Center   a low pedimented stoa with a prostyle porch, sage tiles
//   Temple        the one true temple front: podium, columns, pediment
//   Academy       a long stoa across the back and a tall watch tower
//   Storehouse    an open shed with two domed granary silos
//   House         five plans: courtyard house, L-house with pergola,
//                 two-storey house, porch cottage, tower house (pyrgos)
// Materials follow the type: limestone ashlar (Town Center, temple),
// whitewash or mudbrick with timber lintels (houses, sheds), fieldstone
// (towers); roof tiles are sage, marble or one of four terracotta hues.

// A round granary silo with a domed cap.
function silo(m, cx, y, cz, r, h) {
  cylinder(m, cx, y, cz, r + 0.3, 1, 0x9a9382, { segs: 16 });
  cylinder(m, cx, y + 1, cz, r, h - 1, 0xeee8dc, { segs: 16, cap: false });
  cylinder(m, cx, y + h - 2, cz, r + 0.05, 0.6, 0xa8372a, { segs: 16, cap: false });
  dome(m, cx, y + h + 0.4, cz, r + 0.2, { segs: 16, rings: 5, k: 0.75, tones: [0xe7e1d4, 0xdcd5c6], rib: 0xf5f1e8, ribEvery: 4 });
  cylinder(m, cx, y + h + 0.4 + (r + 0.2) * 0.75, cz, 0.35, 0.8, BRONZE, { segs: 6 });
}

// Town Center: a low pedimented stoa. A long hall on a marble stylobate: a
// row of rooms across the back behind a red-painted dado, solid limestone
// end walls (antae) and seven Doric columns along the front, all under one
// architrave, a painted blue frieze with gilt rosettes, a projecting cornice
// and a shallow sage-tiled gable with pediments at both ends. A prostyle
// porch of four columns projects from the middle of the front under its own
// pediment (painted tympanum, figures, red sima). Team colour is only on
// cloth banners hung from the antae and the end wall. A marble Zeus stands
// in the forecourt to one side, an olive and storage jars on the other.
export function townCenterModel(variant = 0, m = new VoxelModel()) {
  steps(m, 0, 0, 28, 28, 2, [STONE, PAVE]);
  // stylobates: the hall and the porch, a stair in front of the porch
  m.box(1, 2, 1, 26, 1, 20, MARBLE);
  m.box(7, 2, 21, 14, 1, 6, MARBLE);
  m.box(8, 2, 27, 12, 1, 1, MARBLE_SHADE);
  const Y = 3, CH = 10;
  // back rooms, the colonnade side painted with a red dado
  m.box(1, Y, 1, 26, CH, 8, LIMESTONE);
  m.box(3, Y, 8, 22, 3, 1, PORCH_RED);
  m.box(3, Y + 3, 8, 22, 1, 1, GILT);
  win(m, 12, Y, 8, 4, 7, 1, DOOR, MARBLE_SHADE);
  win(m, 5, Y, 8, 3, 6, 1, DOOR, MARBLE_SHADE);
  win(m, 20, Y, 8, 3, 6, 1, DOOR, MARBLE_SHADE);
  for (const x of [9, 17]) win(m, x, Y + 5, 8, 2, 2, 1, DARK, MARBLE_SHADE);
  // end walls (antae) down both sides of the colonnade
  for (const x0 of [1, 25]) m.box(x0, Y, 9, 2, CH, 11, LIMESTONE);
  // +x end: windows to the back rooms and the colonnade
  for (const z of [3, 6]) win(m, 26, Y + 4, z, 1, 3, 2, DARK, MARBLE_SHADE);
  win(m, 26, Y + 4, 13, 1, 3, 2, DARK, MARBLE_SHADE);
  // floor of the colonnade
  m.box(3, Y - 1, 9, 22, 1, 11, (x, yy, z) => ((x + z) % 4 === 0 ? MARBLE_SHADE : MARBLE));
  // colonnade: seven columns on the front edge
  for (let i = 0; i < 7; i++) roundColumn(m, 5 + i * 3, Y, 19.6, 0.72, CH);
  // porch: four columns
  for (let i = 0; i < 4; i++) roundColumn(m, 9.5 + i * 3, Y, 25, 0.72, CH);
  // entablature over hall and porch: architrave, painted frieze, cornice
  const t = Y + CH;
  const FRIEZE = (x, yy, z) => (yy === t + 2 && (x + z) % 6 === 0 ? GILT : yy === t + 3 && (x + z) % 2 === 0 ? PAINT_BLUE_D : PAINT_BLUE);
  for (const [x0, z0, w, d] of [[1, 1, 26, 20], [8, 20, 12, 7]]) {
    m.box(x0, t, z0, w, 1, d, MARBLE_SHADE);
    m.box(x0, t + 1, z0, w, 1, d, MARBLE);
    m.box(x0, t + 2, z0, w, 2, d, FRIEZE);
    m.box(x0, t + 4, z0, w, 1, d, MARBLE_SHADE);
  }
  m.box(0, t + 5, 0, 28, 1, 22, MARBLE);
  m.box(7, t + 5, 21, 14, 1, 7, MARBLE);
  for (let x = 0; x < 28; x += 2) { if (x < 7 || x > 20) m.set(x, t + 4, 21, SOFFIT); m.set(x, t + 4, 0, SOFFIT); }
  for (let z = 0; z < 22; z += 2) { m.set(0, t + 4, z, SOFFIT); m.set(27, t + 4, z, SOFFIT); }
  // roofs: the hall's ridge runs along the stoa, the porch's front to back
  const top = t + 6;
  const R = gableRoof(m, { wx0: 0.5, wx1: 27.5, wz0: 0.5, wz1: 21.5, top, axis: 'x', pitch: 0.3, ov: 0.6, ovG: 0.5, ends: 'pediment', tiles: TILES.sage, tymp: 0x2f5596, rakeH: 0.8, sima: 0xa8372a, geisonPaint: 0x2d4b82, seed: 41 });
  pedimentRelief(m, R, 27);
  const P = gableRoof(m, { wx0: 7.5, wx1: 20.5, wz0: 13, wz1: 27, top, axis: 'z', pitch: 0.34, ov: 0.5, ovG: 0.8, ends: 'pediment', tiles: TILES.sage, tymp: 0x2f5596, rakeH: 0.8, sima: 0xa8372a, geisonPaint: 0x2d4b82, seed: 43 });
  pedimentRelief(m, P, 27);
  // acroteria on the porch pediment
  const ay = Math.floor(P.ridgeY) + 1;
  m.set(13, ay, 27, MARBLE); m.set(14, ay, 27, MARBLE); m.set(13, ay + 1, 27, GILT); m.set(14, ay + 1, 27, GILT);
  // team cloths: hung off the antae and the east end wall
  wallBanner(m, 27, Y + 2, 8, '+x', 7);
  wallBanner(m, 27, Y + 2, 16, '+x', 7);
  // forecourt: Zeus on the west side, an olive and jars on the east
  statue(m, 2, 2, 22, { bolt: true });
  olive(m, 23, 2, 24); olive(m, 25, 2, 22);
  pithos(m, 22, 2, 21, 0xb8683e); amphora(m, 25, 2, 25, 0xa65a34); amphora(m, 26, 2, 26);
  return m;
}

// House variants: variant % 5 is the plan, each its own silhouette and height:
//   0 low courtyard house with flat terraces   1 L-house with a vine pergola
//   2 two-storey house with a balcony          3 pedimented porch cottage
//   4 tower house (pyrgos) with a low barn
// and floor(variant / 5) the finish: 0 lime-washed plaster (white or ochre),
// 1 bare mudbrick on a stone socle. Roof tiles come in four fired hues
// (terra, brick red, umber, ochre) so neighbouring roofs differ. Openings
// carry timber lintels; flat roofs show their joist ends.
const HOUSE_ROOFS = [
  [TILES.terra, TILES.brick, TILES.ochre, TILES.umber, TILES.brick],
  [TILES.umber, TILES.terra, TILES.brick, TILES.ochre, TILES.terra],
];
export function houseModel(variant = 0, m = new VoxelModel()) {
  const plan = variant % 5, fin = Math.floor(variant / 5) % 2;
  m.box(0, 0, 0, 12, 1, 12, STONE);
  const ochre = fin === 0 && (plan === 1 || plan === 3);
  const PL = fin === 1 ? MUDBRICK : ochre ? WASH_OCHRE : WHITEWASH;
  const fill = fin === 1 ? 0xd0aa7f : ochre ? 0xe6d3ad : 0xefeae0;
  const tiles = HOUSE_ROOFS[fin][plan];
  if (plan === 0) {
    // rooms at the back (taller) and down the east side (lower), flat roofs
    m.box(0, 1, 0, 12, 7, 5, PL); m.box(0, 1, 0, 12, 2, 5, BASE_STONE);
    flatRoof(m, 0, 8, 0, 12, 5);
    joists(m, 0, 7, 5, 12, 'x', 2); joists(m, 12, 7, 0, 5, 'z', 2);
    m.box(8, 1, 5, 4, 6, 7, PL); m.box(8, 1, 5, 4, 2, 7, BASE_STONE);
    flatRoof(m, 8, 7, 5, 4, 7);
    joists(m, 8, 6, 12, 4, 'x', 2); joists(m, 12, 6, 5, 7, 'z', 2);
    // courtyard walls with a coping and a gate
    m.box(0, 1, 5, 1, 4, 7, PL); m.box(0, 1, 11, 8, 4, 1, PL);
    m.box(0, 5, 5, 1, 1, 7, MARBLE_SHADE); m.box(0, 5, 11, 8, 1, 1, MARBLE_SHADE);
    m.carve(3, 1, 11, 2, 4, 1); m.carve(3, 5, 11, 2, 1, 1);
    m.box(2, 1, 11, 1, 6, 1, DARKWOOD); m.box(5, 1, 11, 1, 6, 1, DARKWOOD); m.box(1, 7, 11, 6, 1, 1, DARKWOOD);
    m.box(1, 1, 5, 7, 1, 6, PAVE);
    // tiled lean-to along the back rooms, on wooden posts
    for (const px of [1.5, 4.25, 7]) cylinder(m, px, 2, 7.2, 0.3, 3.2, 0x7a5230, { segs: 6 });
    shedRoof(m, { wx0: 0.5, wx1: 8, wz0: 5, wz1: 7.5, top: 5, dir: '+z', pitch: 0.45, ov: 0.4, ovS: 0, tiles, fill, seed: 7 });
    win(m, 4, 2, 4, 2, 3, 1, DOOR);
    olive(m, 3, 2, 9);
    pithos(m, 6, 2, 9, 0xb8683e); amphora(m, 6, 2, 10, 0xa65a34);
    win(m, 9, 3, 11, 2, 2, 1); win(m, 11, 3, 7, 1, 2, 2);
    win(m, 11, 4, 1, 1, 2, 1); win(m, 11, 4, 3, 1, 2, 1);
    wallBanner(m, 12, 1, 8, '+x', 5);
    // chimney and rooftop jars
    m.box(2, 10, 1, 1, 2, 1, PL); m.set(2, 12, 1, 0x3a3430);
    amphora(m, 9, 9, 7, 0xa65a34); amphora(m, 9, 9, 9);
    return m;
  }
  if (plan === 1) {
    // L-shape: back wing across the lot, side wing down the west edge
    m.box(0, 1, 0, 12, 6, 5, PL); m.box(0, 1, 0, 12, 2, 5, BASE_STONE);
    m.box(0, 1, 5, 5, 6, 7, PL); m.box(0, 1, 5, 5, 2, 7, BASE_STONE);
    gableRoof(m, { wx0: 0, wx1: 12, wz0: 0, wz1: 5, top: 7, axis: 'x', pitch: 0.42, ov: 0.6, ovG: 0.4, tiles, fill, seed: 11 });
    gableRoof(m, { wx0: 0, wx1: 5, wz0: 2.5, wz1: 12, top: 7, axis: 'z', pitch: 0.42, ov: 0.6, ovG: 0.4, tiles, fill, seed: 12 });
    awning(m, 1, 6, 12, 2);
    win(m, 1, 2, 11, 2, 3, 1, DOOR);
    win(m, 4, 3, 7, 1, 2, 2); win(m, 11, 3, 2, 1, 2, 2); win(m, 7, 3, 4, 2, 2, 1);
    // vine pergola on timber posts in the inner corner
    m.box(5, 1, 5, 7, 1, 7, PAVE);
    for (const [px, pz] of [[11, 11], [7, 11], [11, 7]]) m.box(px, 2, pz, 1, 5, 1, WOOD);
    m.box(5, 7, 11, 7, 1, 1, WOOD); m.box(11, 7, 5, 1, 1, 7, WOOD); m.box(5, 7, 7, 7, 1, 1, WOOD);
    for (const x of [6, 8, 10]) m.box(x, 8, 5, 1, 1, 7, DARKWOOD);
    for (let x = 5; x < 12; x++) for (let z = 5; z < 12; z++) {
      const h = hash3(x, 9, z, 44);
      if (h < 0.62) m.set(x, 9, z, LEAF);
      else if (h < 0.7) m.set(x, 7, z, 0x6b3a6e);
    }
    m.box(8, 2, 8, 2, 1, 2, WOOD); m.box(8, 3, 8, 2, 1, 2, 0x9b7040); m.set(8, 4, 8, 0x6b3a6e);
    pithos(m, 5, 2, 10, 0xa65a34); amphora(m, 10, 2, 5);
    m.box(9, 7, 1, 1, 4, 1, PL); m.set(9, 11, 1, 0x3a3430);
    return m;
  }
  if (plan === 2) {
    // two storeys, a wooden balcony across the front on timber posts
    m.box(1, 1, 1, 10, 12, 7, PL); m.box(1, 1, 1, 10, 2, 7, BASE_STONE);
    // timber floor beam round the building between the storeys
    m.box(1, 7, 7, 10, 1, 1, DARKWOOD); m.box(10, 7, 1, 1, 1, 7, DARKWOOD);
    joists(m, 11, 12, 1, 7, 'z', 2);
    shedRoof(m, { wx0: 1, wx1: 11, wz0: 1, wz1: 8, top: 13, dir: '+z', pitch: 0.32, ov: 0.8, ovS: 0.5, tiles, fill, seed: 21 });
    win(m, 5, 2, 7, 2, 4, 1, DOOR); win(m, 2, 3, 7, 2, 2, 1); win(m, 8, 3, 7, 2, 2, 1);
    win(m, 10, 3, 3, 1, 2, 2);
    win(m, 5, 8, 7, 2, 3, 1); win(m, 2, 9, 7, 2, 2, 1); win(m, 8, 9, 7, 2, 2, 1);
    win(m, 10, 9, 5, 1, 2, 2); m.box(10, 8, 1, 1, 3, 2, DOOR);
    // balcony: planked floor, balustrade, flower pots
    m.box(1, 7, 8, 10, 1, 2, WOOD);
    for (let x = 1; x < 11; x += 2) m.set(x, 8, 9, DARKWOOD);
    m.box(1, 9, 9, 10, 1, 1, DARKWOOD); m.box(1, 8, 8, 1, 2, 1, DARKWOOD); m.box(10, 8, 8, 1, 2, 1, DARKWOOD);
    m.box(1, 1, 9, 1, 6, 1, WOOD); m.box(10, 1, 9, 1, 6, 1, WOOD);
    m.set(3, 8, 8, 0xc0392b).set(4, 8, 8, 0x3d6b2f).set(7, 8, 8, 0x3d6b2f).set(8, 8, 8, 0x9b59b6);
    for (let i = 0; i < 6; i++) m.box(11, 1 + i, 7 - i, 1, 1, 1, STONE);
    m.box(1, 1, 10, 10, 1, 2, PAVE);
    pithos(m, 2, 2, 10, 0xb8683e); amphora(m, 8, 2, 11, 0xa65a34); amphora(m, 9, 2, 10);
    m.box(2, 13, 2, 1, 5, 1, PL); m.set(2, 18, 2, 0x3a3430);
    return m;
  }
  if (plan === 3) {
    // cottage with a two-column porch under a front pediment
    m.box(1, 1, 1, 10, 6, 7, PL);
    m.box(1, 1, 1, 10, 2, 7, BASE_STONE);
    win(m, 4, 1, 7, 3, 4, 1, DOOR);
    win(m, 10, 3, 3, 1, 2, 2);
    m.box(1, 1, 8, 10, 1, 3, PAVE);
    column2(m, 2, 2, 9, 5); column2(m, 8, 2, 9, 5);
    m.box(1, 7, 9, 10, 1, 2, DARKWOOD);
    gableRoof(m, { wx0: 1, wx1: 11, wz0: 1, wz1: 11, top: 8, axis: 'z', pitch: 0.4, ov: 0.6, ovG: 0.4, tiles, fill, seed: 31 });
    m.box(1, 7, 1, 10, 1, 7, DARKWOOD);
    wallBanner(m, 11, 1, 3, '+x', 5);
    m.box(8, 8, 2, 1, 4, 1, PL); m.set(8, 12, 2, 0x3a3430);
    amphora(m, 11, 1, 9);
    return m;
  }
  // plan 4: tower house - a tall fieldstone tower with a pyramid roof
  // beside a low barn under a shed roof
  const TOWER = fieldstone(29 + fin);
  m.box(1, 1, 1, 6, 20, 6, TOWER);
  m.box(1, 1, 1, 6, 2, 6, BASE_STONE);
  for (const yy of [8, 14]) joists(m, 7, yy, 1, 6, 'z', 2);
  m.box(0, 20, 0, 8, 1, 8, DARKWOOD);
  for (const [yy, hh] of [[9, 3], [15, 3]]) { win(m, 3, yy, 7, 2, hh, 1); win(m, 7, yy, 3, 1, hh, 2); }
  win(m, 3, 2, 7, 2, 4, 1, DOOR);
  hipRoof(m, { wx0: 0, wx1: 8, wz0: 0, wz1: 8, top: 21, pitch: 0.55, ov: 0.5, tiles: fin ? TILES.brick : TILES.umber, seed: 41 });
  // barn
  m.box(7, 1, 2, 4, 5, 9, PL); m.box(7, 1, 2, 4, 2, 9, BASE_STONE);
  win(m, 11, 3, 5, 1, 2, 2);
  win(m, 8, 1, 10, 2, 4, 1, DOOR);
  shedRoof(m, { wx0: 7, wx1: 11, wz0: 2, wz1: 11, top: 6, dir: '+x', pitch: 0.35, ov: 0.6, ovS: 0.4, tiles, fill, seed: 43 });
  // yard: hay, a cart wheel, jars
  m.box(1, 1, 8, 5, 1, 4, PAVE);
  m.box(1, 2, 10, 2, 2, 2, 0xcdb46a); m.set(2, 4, 10, 0xd8c079);
  pithos(m, 4, 2, 9, 0xb8683e); amphora(m, 5, 2, 11);
  return m;
}

// Storehouse: an open-fronted timber shed under a shallow tiled gable, full
// of goods, with two white granary silos under domed caps in front.
export function storehouseModel(variant = 0, m = new VoxelModel()) {
  m.box(0, 0, 0, 12, 1, 12, BASE_STONE);
  m.box(1, 1, 1, 10, 1, 10, PAVE);
  m.box(1, 1, 1, 10, 7, 2, MUDBRICK);
  m.box(1, 1, 1, 2, 7, 6, MUDBRICK);
  m.box(10, 1, 1, 1, 7, 6, MUDBRICK);
  m.box(1, 1, 1, 10, 2, 6, BASE_STONE);
  for (const x of [1, 10]) m.box(x, 1, 6, 1, 7, 1, DARKWOOD);
  joists(m, 11, 7, 1, 6, 'z', 2);
  for (const x of [4.5, 7.5]) cylinder(m, x, 1, 6.3, 0.5, 7, 0x7a5230, { segs: 8 });
  m.box(1, 7, 6, 10, 1, 1, DARKWOOD);
  gableRoof(m, { wx0: 1, wx1: 11, wz0: 1, wz1: 7, top: 8, axis: 'x', pitch: 0.42, ov: 0.8, ovG: 0.5, tiles: TILES.slate, fill: 0xc29b70, seed: 51 });
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
  const R = gableRoof(m, { wx0: 1, wx1: 19, wz0: 1, wz1: 23, top: t, axis: 'z', pitch: 0.36, ov: 0.5, ovG: 1.2, ends: 'pediment', tiles: TILES.marble, tymp: 0x2f5596, rakeH: 0.8, sima: 0xa8372a, geisonPaint: 0x2d4b82, seed: 71 });
  pedimentRelief(m, R, 23);
  pedimentRelief(m, R, 0, -1);
  // acroteria: a marble palmette with a gilt tip on the apex, small marble
  // scrolls on the corners
  for (const vz of [0, 23]) {
    const ay = Math.floor(R.ridgeY) + 1;
    m.set(9, ay, vz, MARBLE); m.set(10, ay, vz, MARBLE); m.set(9, ay + 1, vz, GILT); m.set(10, ay + 1, vz, GILT);
    for (const x of [0, 19]) m.set(x, t, vz, MARBLE);
  }

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
  const ROBES = [0xa8372a, 0xf1ece2, 0xd2a847, 0xf1ece2, 0xb5542e];
  const SKIN = 0xe8d6bd;
  // figures two voxels wide, one voxel apart: a gilt Zeus in the middle,
  // painted robes to the sides, reclining figures in the low corners
  for (let x = Math.floor(um - span) + 1; x < um + span - 1; x++) {
    const lim = Math.min(inner(x), inner(x + 1)) - 0.2;
    const hgt = Math.floor(lim) - y0;
    if (hgt < 1) continue;
    const d = x + 0.5 - um, ad = Math.abs(d);
    const slot = Math.floor((ad + 1) / 3), pos = Math.floor(ad + 1) % 3;   // 3-voxel slots out from the centre
    if (ad > 1 && pos === 0) continue;                                       // gap between figures
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
  m.box(1, 3, 3, 18, 3, 1, PORCH_RED);
  m.box(1, 3, 1, 18, 1, 3, BASE_STONE);
  m.box(4, 3, 4, 3, 5, 1, DOOR); m.box(13, 3, 4, 3, 5, 1, DOOR);
  m.box(9, 5, 4, 2, 4, 1, DARK);
  for (const x of [5, 14]) { m.box(x - 1, 8, 4, 5, 1, 1, MARBLE); }
  for (let i = 0; i < 7; i++) roundColumn(m, 2.6 + i * 2.47, 3, 8.4, 0.62, 8);
  m.box(1, 11, 7, 18, 1, 3, MARBLE_SHADE);
  m.box(1, 12, 7, 18, 1, 3, (x) => ((x % 5) < 2 ? TRI_A : METOPE));
  m.box(1, 12, 4, 18, 1, 3, MARBLE_SHADE);
  gableRoof(m, { wx0: 1, wx1: 19, wz0: 1, wz1: 10, top: 13, axis: 'x', pitch: 0.4, ov: 0.9, ovG: 1, ends: 'pediment', tiles: TILES.brick, tymp: 0x2f5596, rakeH: 0.7, sima: 0xa8372a, seed: 61 });
  m.box(1, 12, 1, 18, 1, 3, MARBLE_SHADE);
  // ---- watch tower (front right)
  const TOWER = fieldstone(33);
  m.box(13, 1, 12, 7, 2, 7, BASE_STONE);
  m.box(14, 3, 13, 5, 21, 5, TOWER);
  for (const yy of [9, 16]) m.box(14, yy, 13, 5, 1, 5, MARBLE_SHADE);
  for (const yy of [11, 18]) { m.box(16, yy, 18, 1, 3, 1, DARK); m.box(19 - 1 + 1, yy, 15, 1, 3, 1, DARK); }
  m.box(15, 3, 18, 3, 5, 1, DOOR);
  m.box(14, 21, 18, 5, 1, 1, METOPE); m.box(19, 21, 13, 1, 1, 5, METOPE);
  m.box(13, 24, 12, 7, 1, 7, DARKWOOD);
  hipRoof(m, { wx0: 14, wx1: 19, wz0: 13, wz1: 18, top: 25, pitch: 0.7, ov: 0.9, tiles: TILES.umber, seed: 63, finial: BRONZE });
  wallBanner(m, 19, 10, 15, '+x', 5);
  // ---- low court walls, gateway piers on the front
  m.box(0, 2, 10, 2, 3, 9, FIELDSTONE); m.box(0, 5, 10, 2, 1, 9, MARBLE_SHADE);
  m.box(0, 2, 18, 5, 3, 2, FIELDSTONE); m.box(0, 5, 18, 5, 1, 2, MARBLE_SHADE);
  for (const x of [5, 10]) m.box(x, 2, 18, 2, 7, 2, MARBLE);
  m.box(4, 9, 18, 9, 1, 2, MARBLE_SHADE);
  m.box(12, 2, 18, 1, 3, 2, FIELDSTONE);
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
function weather(m, { ground = 1, grime = 5, quoin: QC = QUOIN, quoinMix = 0.7 } = {}) {
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
  house: weathered(houseModel, { ground: 1, quoin: null }),
  storehouse: weathered(storehouseModel, { ground: 1 }),
  farm: farmModel,
  temple: weathered(templeModel, { ground: 4, quoin: 0xd9ceb4, quoinMix: 0.45 }),
  barracks: weathered(barracksModel, { ground: 3 }),
};

// Number of visual variants per type (picked per building from its tile).
export const BUILDING_VARIANTS = { house: 10 };

export {
  WOOD, DARKWOOD, STONE, MARBLE, MARBLE_SHADE, MARBLE_DARK, ASHLAR, PAVE, TERRACOTTA, BRONZE, GOLD, FIRE, LEAF,
  amphora, pithos, cypress, olive, statue, hopliteStatue, brazier, roofTile, shade, gable,
};
