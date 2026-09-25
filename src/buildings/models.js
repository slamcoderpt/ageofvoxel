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

// Entablature over [x, x+w) x [z, z+d): a two-fascia marble architrave, a
// painted frieze band in the owner's colour (two voxels tall, run right
// round the building) edged by a marble fillet, and a projecting marble
// cornice whose overhang throws a clean shadow line. Returns the y above.
function entablature(m, x, y, z, w, d) {
  m.box(x, y, z, w, 1, d, MARBLE_SHADE);
  m.box(x, y + 1, z, w, 1, d, MARBLE);
  m.box(x, y + 2, z, w, 2, d, TEAM);
  m.box(x, y + 4, z, w, 1, d, MARBLE_SHADE);
  m.box(x - 1, y + 5, z - 1, w + 2, 1, d + 2, MARBLE);
  return y + 6;
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

// Lean-to (mono-pitch) portico roof over [x, x+w) x [z, z+d) falling toward
// `dir` ('+x', '-x', '+z' or '-z'), with marble verges and a darker eave.
function leanTo(m, x, y, z, w, d, dir, { run = 2, tone = 'civic' } = {}) {
  const T = ROOF_TONES[tone];
  const fallX = dir === '+x' || dir === '-x';
  const n = fallX ? w : d;
  for (let i = 0; i < w; i++) for (let k = 0; k < d; k++) {
    const t = fallX ? i : k;
    const s = dir === '+x' || dir === '+z' ? t : n - 1 - t;   // distance from the high edge
    const h = Math.floor((n - 1 - s) / run);
    const verge = fallX ? (k === 0 || k === d - 1) : (i === 0 || i === w - 1);
    m.set(x + i, y + h, z + k, verge ? MARBLE_SHADE : s === n - 1 ? T.eave : roofTile(x + i, y + h, z + k, !fallX, T.tones, T.rib));
    for (let yy = y; yy < y + h; yy++) m.set(x + i, yy, z + k, T.eave);
    if (s === n - 1) m.set(x + i, y - 1, z + k, SOFFIT);
  }
  return y + Math.floor((n - 1) / run) + 1;
}

// Mono-pitch (shed) roof over [x, x+w) x [z, z+d), high at the back (-z) and
// falling to a projecting front eave with dark rafter ends; tiled terracotta
// with marble-capped side verges.
function shedRoof(m, x, y, z, w, d, { run = 2, tone = 'terra', wall = MARBLE_SHADE } = {}) {
  const T = ROOF_TONES[tone];
  const rise = Math.floor((d - 1) / run);
  for (let k = 0; k < d; k++) {
    const h = Math.floor((d - 1 - k) / run);
    for (let i = 0; i < w; i++) {
      const verge = i === 0 || i === w - 1;
      const c = verge ? MARBLE_SHADE : k === d - 1 ? T.eave : roofTile(x + i, y + h, z + k, true, T.tones, T.rib);
      m.set(x + i, y + h, z + k, c);
      for (let yy = y; yy < y + h; yy++) if (k > 0 && k < d - 1) m.set(x + i, yy, z + k, T.eave);
    }
  }
  // back wall rises to meet the high edge
  for (let i = 0; i < w; i++) for (let yy = y; yy < y + rise; yy++) m.set(x + i, yy, z, wall);
  // front eave: dark rafter ends under the overhang and antefixes on top
  for (let i = 0; i < w; i++) {
    m.set(x + i, y - 1, z + d - 1, (i & 1) ? SOFFIT : null);
    if (i % 3 === 1) m.set(x + i, y + 1, z + d - 1, T.antefix);
  }
  return y + rise + 1;
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
// Town Center: a peripteral civic hall on a three-step stylobate: four
// round-reading Doric columns across the front and back (plus the flanks)
// in front of a red-painted cella, a team-coloured frieze under a marble
// cornice, and a matte terracotta gable ending front and back in a sculpted
// pediment. A forecourt with braziers, banners and an altar.
export function townCenterModel(variant = 0, m = new VoxelModel()) {
  const S = 28;
  steps(m, 0, 0, S, S, 2, [STONE, PAVE]);
  // stylobate: three marble steps under the hall, dark-light-bright so each
  // tread reads
  m.box(0, 2, 0, 28, 1, 23, MARBLE_DARK);
  m.box(1, 3, 1, 26, 1, 21, MARBLE_SHADE);
  m.box(2, 4, 2, 24, 1, 19, MARBLE);
  const y = 5, CH = 14;
  // cella: ashlar core, its porch faces painted Pompeian red so the white
  // colonnade stands out against it; bronze door, dark windows
  m.box(8, y, 5, 12, CH, 9, ASHLAR);
  m.box(8, y + 1, 13, 12, CH - 1, 1, PORCH_RED);
  m.box(19, y + 1, 5, 1, CH - 1, 9, PORCH_RED);
  m.box(8, y, 13, 12, 1, 1, MARBLE_SHADE);
  m.box(12, y, 13, 4, 8, 1, DOOR);
  m.box(11, y + 8, 13, 6, 1, 1, MARBLE);
  m.box(13, y + 3, 13, 2, 1, 1, BRONZE);
  for (const x of [9, 17]) m.box(x, y + 4, 13, 2, 4, 1, DARK);
  for (const z of [7, 10]) m.box(19, y + 5, z, 1, 4, 2, DARK);
  // peristyle
  for (const x of [3, 9, 15, 21]) { column4(m, x, y, 15, CH); column4(m, x, y, 3, CH); }
  for (const z of [9]) { column4(m, 3, y, z, CH); column4(m, 21, y, z, CH); }
  const t = entablature(m, 3, y + CH, 3, 22, 16);
  templeRoof(m, 1, t, 1, 26, 19, 'z', { run: 2, relief: 'both' });
  banner(m, 6, 2, 25, 7, 'x'); banner(m, 20, 2, 25, 7, 'x');
  // ---- forecourt: braziers, banners and an altar
  brazier(m, 1, 2, 24); brazier(m, 25, 2, 24);
  m.box(12, 2, 23, 4, 2, 3, MARBLE); m.box(12, 3, 23, 4, 1, 3, RED);   // altar
  m.box(13, 4, 24, 2, 1, 1, FIRE, { glow: 0.5 });
  pithos(m, 7, 2, 24, 0xb8683e); amphora(m, 20, 2, 24); amphora(m, 21, 2, 25, 0xa65a34);
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
    shedRoof(m, 0, 13, 0, 12, 10, { run: 2, wall: PL });
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

// Temple: a prostyle temple on a high podium (unlike the Town Center's
// all-round colonnade): four slim Ionic columns before a deep red-walled
// porch, solid ashlar flanks with marble pilasters and team hangings, the
// team frieze, and a terracotta gable with sculpted pediments front and
// back. A full-width stair climbs the podium between braziers and banners.
export function templeModel(variant = 0, m = new VoxelModel()) {
  // podium: dark footing, a stone socle two courses high, marble floor
  m.box(0, 0, 0, 20, 1, 21, MARBLE_DARK);
  m.box(1, 1, 1, 18, 2, 19, BASE_STONE);
  m.box(1, 3, 1, 18, 1, 19, MARBLE);
  m.box(0, 3, 0, 20, 1, 1, MARBLE_SHADE); m.box(0, 3, 0, 1, 1, 20, MARBLE_SHADE); m.box(19, 3, 0, 1, 1, 20, MARBLE_SHADE);
  // front stair, treads alternating tone
  for (let i = 0; i < 4; i++) m.box(3, i, 19, 14, 1, 5 - i, i & 1 ? MARBLE : MARBLE_SHADE);
  const y = 4, CH = 13;
  // cella: ashlar flanks, porch face painted red with bronze doors
  m.box(2, y, 2, 16, CH, 12, ASHLAR);
  m.box(2, y, 2, 16, 1, 12, BASE_STONE);
  m.box(3, y + 1, 13, 14, CH - 1, 1, PORCH_RED);
  m.box(8, y, 13, 4, 9, 1, DOOR);
  m.box(7, y + 9, 13, 6, 1, 1, MARBLE);
  m.box(9, y + 4, 13, 2, 1, 1, GOLD, { glow: 0.3 });
  // antae (wall ends) framing the porch
  for (const x of [2, 16]) m.box(x, y, 13, 2, CH, 3, MARBLE);
  // flanks: marble pilasters with team hangings between them
  for (const z of [2, 6, 10]) { m.box(18, y, z, 1, CH, 1, MARBLE); m.box(1, y, z, 1, CH, 1, MARBLE); }
  for (const z of [4, 8]) { m.box(18, y + 3, z, 1, 7, 2, TEAM); m.box(18, y + 9, z, 1, 1, 2, GILT); }
  // porch: four slim columns, wider central bay
  for (const x of [2, 6, 11, 15]) column3(m, x, y, 17, CH);
  const t = entablature(m, 1, y + CH, 2, 18, 18);
  templeRoof(m, -1, t, 1, 22, 20, 'z', { run: 1.8, relief: 'both' });
  banner(m, 0, 0, 22, 6, 'x'); banner(m, 18, 0, 22, 6, 'x');
  brazier(m, 1, 0, 19); brazier(m, 17, 0, 19);
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

// Military Academy: a gymnasium / palaestra built round an open sand court.
// A tall hall across the back (gable turned sideways so its pediment faces
// +x), colonnaded porticoes with lean-to roofs down both sides and across the
// front, and a pedimented gateway (propylon) in the middle of the front.
// Archery targets, a weapon rack and a bronze hoplite in the court.
export function barracksModel(variant = 0, m = new VoxelModel()) {
  const S = 20;
  const SAND = (x, y, z) => (hash3(x, y, z, 14) < 0.5 ? 0xd2bd92 : 0xc4ae84);
  m.box(0, 0, 0, S, 1, S, BASE_STONE);
  m.box(1, 1, 1, 18, 1, 18, MARBLE_SHADE);
  m.box(5, 1, 9, 13, 1, 9, SAND);
  // ---- back hall (z 1..8)
  m.box(1, 2, 1, 18, 8, 8, ASHLAR);
  m.box(4, 3, 8, 12, 7, 1, PORCH_RED);
  m.box(8, 2, 8, 4, 6, 1, DOOR);
  for (const x of [5, 13]) m.box(x, 5, 8, 2, 3, 1, DARK);
  for (const z of [3, 6]) m.box(18, 5, z, 1, 3, 1, DARK);
  m.box(1, 10, 1, 18, 1, 8, TEAM);
  m.box(0, 11, 0, 20, 1, 10, MARBLE);
  templeRoof(m, 0, 12, 0, 20, 10, 'x', { run: 1.25, relief: 'both' });
  // ---- west portico (z 9..17): outer wall, inner columns, a low lean-to
  m.box(0, 2, 9, 2, 5, 9, ASHLAR);
  for (const cz of [10, 14]) column2(m, 3, 2, cz, 5);
  m.box(0, 7, 9, 5, 1, 9, MARBLE_SHADE);
  leanTo(m, 0, 8, 9, 5, 9, '+x', { run: 2 });
  // ---- east and front: a low coped wall so the court stays open to view
  m.box(18, 2, 9, 2, 3, 11, ASHLAR);
  m.box(19, 4, 9, 1, 1, 11, TEAM);
  m.box(18, 5, 9, 2, 1, 11, MARBLE);
  for (const [x0, w] of [[0, 7], [13, 5]]) {
    m.box(x0, 2, 18, w, 3, 2, ASHLAR);
    m.box(x0, 4, 19, w, 1, 1, TEAM);
    m.box(x0, 5, 18, w, 1, 2, MARBLE);
  }
  // ---- gateway: two tall marble piers with team hangings and a lintel
  for (const x of [7, 11]) { m.box(x, 2, 18, 2, 7, 2, MARBLE); m.box(x, 3, 20, 2, 4, 1, TEAM); m.box(x, 7, 20, 2, 1, 1, GILT); }
  m.box(6, 9, 18, 8, 1, 2, MARBLE_SHADE);
  m.box(6, 10, 18, 8, 1, 2, MARBLE);
  wallBanner(m, 20, 1, 12, '+x', 4);
  // ---- court: targets, weapon rack, a bronze hoplite, a sand pit
  hopliteStatue(m, 11, 1, 12);
  m.box(6, 2, 10, 1, 4, 1, WOOD).box(9, 2, 10, 1, 4, 1, WOOD).box(6, 5, 10, 4, 1, 1, WOOD);
  for (const x of [7, 8]) { m.box(x, 2, 10, 1, 5, 1, 0x9aa0a6); m.set(x, 7, 10, 0xc9ced3); }
  archeryTarget(m, 14, 2, 10);
  m.box(7, 2, 15, 1, 4, 1, WOOD).box(6, 5, 15, 3, 1, 1, WOOD).box(7, 6, 15, 1, 2, 1, 0xc9b27a);
  m.box(15, 2, 16, 2, 1, 1, 0xd8c079);
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
