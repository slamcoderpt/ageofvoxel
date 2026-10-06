#!/usr/bin/env node
// The Egyptian units and myth units of Age of Mythology: Retold for the Godot
// port (reference/egypt/unit_01..13, myth_01..14, EGYPT.md sections 3 and 5).
// Godot-only (the browser build has none of them), authored in the unit voxel
// format of src/units/models.js (the same part rigs: a voxel model per part,
// pivoted at its joint, joints in rig voxels relative to the parent, +z the
// facing, +x the unit's left), the same mesher (buildVoxelGeometry, jitter
// 0.05, baked AO) and the same animation channels, so godot/native/src/
// unit_view.cpp (AovUnitView) poses them with the Greek units' code:
//
//   node scripts/export-egypt-units.mjs [--out godot/assets/models]   (~5 s, deterministic)
//
// Output: the "egypt_units" model group (egypt_units.json + .bin.gz) with a
// "rigs" table keyed by the unit's sim key (laborer, spearman, ... and the
// myth units anubite, wadjet, ...). VoxelModels.rig(type) falls back to this
// group when units.json has no rig of that name, and VoxelModels.mesh("units",
// name) to its models, so units.gd, portraits.gd and hero_art.gd draw them.
// Rig fields beyond units.json's: "pose" (a variant of the anim family read by
// unit_view.cpp: spear | slash | sling | serpent | chariot), "gait" / "stride"
// (four-legged walk frequency / amplitude, x the horse's), "hover" (flyers:
// height above the ground in rig voxels) and per part "vary": [k, n] (shown
// for the units whose id hashes to k of n: per-man kit variety).
//
// Look (Retold): bronze-skinned men in white linen, the army's colour on the
// kilts, armbands, nemes stripes, shield faces and saddle cloths; gold on the
// broad collars, axes, crowns and staffs. Animals: a white chariot horse in a
// striped blanket, a tan camel with a hump and a long neck, a grey elephant
// with a howdah and a forehead plate, a lion-bodied sphinx, a jewelled
// crocodile, a green-shelled stag scarab, a blue scorpion under a man, a winged cobra,
// a falcon warrior, a jackal warrior, mummies, a fire bird, a giant roc.
import * as THREE from 'three';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('out', 'godot/assets/models'));
const src = (p) => import(path.join(ROOT, 'src', p));
const { VoxelModel, TEAM, buildVoxelGeometry } = await src('core/voxel.js');
const { hash3 } = await src('core/rng.js');
const { outlineCodes } = await import('./outline-codes.mjs');
void THREE;

const FORMAT = 2;
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

class Group {
  constructor(name) { this.name = name; this.models = {}; this.chunks = []; this.bytes = 0; this.extra = {}; }
  _blob(typed) {
    const off = this.bytes;
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    this.chunks.push(buf);
    this.bytes += buf.length;
    return off;
  }
  // outline: the inverted-hull width factor of this mesh (unit_outline.gdshader,
  // extra.a / 255; 0 = 1.0, the Greek units')
  add(name, geo, { outline = 1 } = {}) {
    if (this.models[name]) throw new Error(`duplicate model ${this.name}/${name}`);
    const a = geo.attributes;
    const n = a.position.count;
    const codes = outlineCodes(geo);   // extra.b: the outline push per corner (outline-codes.mjs)
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4), ext = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = a.position.getX(i); pos[i * 3 + 1] = a.position.getY(i); pos[i * 3 + 2] = a.position.getZ(i);
      nor[i * 3] = a.normal.getX(i); nor[i * 3 + 1] = a.normal.getY(i); nor[i * 3 + 2] = a.normal.getZ(i);
      col[i * 4] = u8(toSRGB(a.color.getX(i))); col[i * 4 + 1] = u8(toSRGB(a.color.getY(i))); col[i * 4 + 2] = u8(toSRGB(a.color.getZ(i)));
      col[i * 4 + 3] = 255;
      ext[i * 4] = u8(a.team.getX(i));
      ext[i * 4 + 1] = u8(a.glow.getX(i));
      ext[i * 4 + 2] = codes[i];
      ext[i * 4 + 3] = u8(outline);
    }
    const idx = Int32Array.from(geo.index.array);
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    this.models[name] = {
      vertices: n, indices: idx.length,
      aabb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map(r4),
      position: this._blob(pos), normal: this._blob(nor), color: this._blob(col), extra: this._blob(ext), index: this._blob(idx),
    };
  }
  write() {
    const man = { format: FORMAT, group: this.name, bin: `${this.name}.bin.gz`, bytes: this.bytes, ...this.extra, models: this.models };
    const gz = zlib.gzipSync(Buffer.concat(this.chunks), { level: 9, mtime: 0 });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${this.name}.bin.gz`), gz);
    fs.writeFileSync(path.join(OUT, `${this.name}.json`), JSON.stringify(man, null, 1) + '\n');
    const tris = Object.values(this.models).reduce((s, m) => s + m.indices / 3, 0);
    console.log(`${this.name.padEnd(13)} ${String(Object.keys(this.models).length).padStart(4)} models ${String(tris).padStart(8)} tris ${(this.bytes / 1e6).toFixed(2).padStart(7)} MB raw ${(gz.length / 1e6).toFixed(2).padStart(6)} MB gz`);
  }
}

// ---- palette -----------------------------------------------------------------
const pick3 = (seed, a, b, c, pa = 0.5, pb = 0.85) => (x, y, z) => { const h = hash3(x, y, z, seed); return h < pa ? a : h < pb ? b : c; };
// sun-bronzed Egyptian skin: a warm light terracotta tan, two to three value
// steps above the leather and the hafts (LEATHER, WOOD), so a bare arm never
// melts into a strap, a shaft or a shield back; the face plane a step lighter
// again (SKIN_FACE) so the dark eyes, brow and hairline read on it
const SKIN = pick3(3, 0x9e5832, 0x96522e, 0xa45e36);   // (round 12) a step browner, to sit on the bodies
const SKIN_SH = 0x8e4a24;
const SKIN_FACE = pick3(35, 0xbe7848, 0xb67244, 0xc47e4c);
// bare chests and limbs, seen in shade from the camera: a redder light tone,
// so the sand-coloured bounce light leaves them warm terracotta, not olive
const SKIN_FRONT = pick3(36, 0xffa070, 0xf89868, 0xffa878);
const SKIN_DK = pick3(4, 0x5c3824, 0x4f2f1e, 0x684230);   // the Nubian mercenaries
const SKIN_DK_SH = 0x3a2216;
const HAIR = 0x1c1410;
const DARK = 0x140e0a;
const EYE_WHITE = 0xf0e8dc;
const LINEN = pick3(6, 0xf2ecdc, 0xe8e0cb, 0xf8f4e8, 0.55, 0.85);
const LINEN_SH = 0xcfc5ab;
// a light yellow with no blue: the grade's warm-chroma limit turns a deep gold
// olive-khaki and an orange gold peach; this stays the most gold-looking
const GOLD = pick3(31, 0xe8c400, 0xd8b400, 0xf2d020, 0.45, 0.8);
const GOLD_DK = 0x6a4206;
// the Pharaoh's gold: brighter and a step towards orange, so large gold faces
// read as gold rather than olive under the grade
const PH_GOLD = pick3(32, 0xf0c800, 0xe4bc00, 0xf8d420, 0.45, 0.8);
const PH_GOLD_L = 0xffe040;
const SKIN_PH = pick3(33, 0x8e5232, 0x864c2e, 0x965836);   // a clear tan (the face block reads at RTS zoom)
const BRONZE = pick3(2, 0xd29c44, 0xbb8636, 0xe8be62, 0.45, 0.8);
const SILVER = pick3(5, 0xd8dde2, 0xc4cad0, 0xeef1f4);
const SILVER_DK = 0x8c939a;
// leather and wood sit well below the skin (dark walnut hafts, black-brown straps)
const LEATHER = 0x54301a;
const LEATHER_DK = 0x301a0c;
const SANDAL = 0x4a2a14;
const WOOD = pick3(9, 0x5c3a20, 0x52331c, 0x664226);
const WOOD_DK = 0x382010;
// spear and arrow points: dark iron-grey blades with a bright honed edge
const BLADE = 0x6a737c;
const BLADE_EDGE = 0xb4bec8;
const BLADE_DK = 0x4c525a;
const BLACK = 0x1e1a18;
const TEAM_TRIM = 0xf4eedc;
const TEAM_SHADE = 0xb4b4b4;   // team voxels a value step darker (the tint multiplies)
const RED = 0xc23a22;
const OCHRE = 0xd89a32;
const STONE = pick3(12, 0x9a9a92, 0x8a8a84, 0xa8a8a0);

// team-tinted voxels on a darker base: shaded folds that still read as the dye
function tbox(m, x, y, z, w, h, d, base) {
  m.box(x, y, z, w, h, d, TEAM);
  for (let k = z; k < z + d; k++) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const v = m.get(i, j, k); if (v) v.c = base; }
  return m;
}
const tset = (m, x, y, z, base) => { m.set(x, y, z, TEAM); m.get(x, y, z).c = base; return m; };
// paint a horizontal band round a model's outer surface at height y
function band(m, y, color, r = 24) {
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++)
    if (m.has(x, y, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) m.set(x, y, z, color);
  return m;
}
function recolor(m, fn) { for (const [k, v] of m.vox) { if (!v.team) { const c = fn(v.c); if (c !== undefined) v.c = c; } } return m; }
// tapered capsule between two (y, z) points over x in [x0, x0 + w)
function capsuleYZ(m, x0, w, y0, z0, r0, y1, z1, r1, color, opts) {
  const dy = y1 - y0, dz = z1 - z0, L2 = dy * dy + dz * dz || 1;
  const rmax = Math.max(r0, r1);
  for (let y = Math.floor(Math.min(y0, y1) - rmax); y <= Math.ceil(Math.max(y0, y1) + rmax); y++)
    for (let z = Math.floor(Math.min(z0, z1) - rmax); z <= Math.ceil(Math.max(z0, z1) + rmax); z++) {
      const cy = y + 0.5, cz = z + 0.5;
      const t = Math.max(0, Math.min(1, ((cy - y0) * dy + (cz - z0) * dz) / L2));
      const ey = cy - (y0 + dy * t), ez = cz - (z0 + dz * t);
      const r = r0 + (r1 - r0) * t;
      if (ey * ey + ez * ez <= r * r) for (let x = x0; x < x0 + w; x++) m.set(x, y, z, color, opts);
    }
  return m;
}
// a round tapered tube between two 3D points (legs, tails, necks)
function tube(m, a, b, r0, r1, color, opts) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const rm = Math.max(r0, r1);
  for (let x = Math.floor(Math.min(a[0], b[0]) - rm); x <= Math.ceil(Math.max(a[0], b[0]) + rm); x++)
    for (let y = Math.floor(Math.min(a[1], b[1]) - rm); y <= Math.ceil(Math.max(a[1], b[1]) + rm); y++)
      for (let z = Math.floor(Math.min(a[2], b[2]) - rm); z <= Math.ceil(Math.max(a[2], b[2]) + rm); z++) {
        const p = [x + 0.5 - a[0], y + 0.5 - a[1], z + 0.5 - a[2]];
        const t = Math.max(0, Math.min(1, (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / L2));
        const e = [p[0] - d[0] * t, p[1] - d[1] * t, p[2] - d[2] * t];
        const r = r0 + (r1 - r0) * t;
        if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] <= r * r) m.set(x, y, z, typeof color === 'function' ? color(x, y, z, t) : color, opts);
      }
  return m;
}

const part = (name, model, pivot, joint, parent = null, extra = {}) => ({ name, model, pivot, joint, parent, ...extra });

// ---- heads (half-size voxels: HEAD_SCALE x the rig voxel) ------------------------
// A head is authored at twice the body's resolution so it can be small (about
// a sixth of the figure, Retold's proportions) and still carry a face: the
// skull x 0..6, y 0..7 (chin at 0), z 0..5 with the face plane at z = 5 and
// the nose ridge standing out at z = 6; pivot [3.5, 0, 3] at the top of the
// neck. Seen from the RTS camera the figure shows a rounded crown, the face
// (kohl eyes, a nose ridge, a mouth) and whatever headdress breaks the box:
// a nemes's side wings flaring down to the shoulders with its lappets lying
// on the chest, a khat's bag, a crown. Each rig tilts its head back a little
// towards the camera (part "rest", unit_view.cpp).
const HEAD_SCALE = 0.5;
const HEAD_PIVOT = [3.5, 0, 3];
const HEAD_TILT = [-0.22, 0, 0];   // chin up: the face turns to the camera above
const LIP = 0x6a2c1c;
function faceN(m, skin = SKIN, shade = SKIN_SH, { eyes = null, brow = HAIR, nose = null, face = null } = {}) {
  for (let y = 0; y <= 7; y++) for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) {
    const ex = x === 0 || x === 6, ez = z === 0 || z === 5;
    if (ex && ez) continue;                              // rounded vertical edges
    if (y === 7 && (ex || ez)) continue;                 // rounded crown
    if (y === 0 && (ex || z === 0)) continue;            // the jaw narrows to the chin
    if (y === 1 && ex && z >= 4) continue;
    m.set(x, y, z, ex || z === 0 ? shade : z === 5 && face ? face : skin);
  }
  // the face (z = 5, x 1..5)
  const E = eyes || [EYE_WHITE, DARK];
  m.set(1, 4, 5, E[0]).set(2, 4, 5, E[1]).set(4, 4, 5, E[1]).set(5, 4, 5, E[0]);
  if (brow) m.set(1, 5, 5, brow).set(2, 5, 5, brow).set(4, 5, 5, brow).set(5, 5, 5, brow).set(0, 4, 4, brow).set(6, 4, 4, brow);
  const N = nose || (typeof skin === 'function' ? skin(3, 3, 6) : skin);
  m.set(3, 4, 5, N).set(3, 3, 6, N).set(3, 2, 6, N);    // the nose ridge stands out of the face
  m.set(3, 1, 5, LIP).set(2, 1, 5, shade).set(4, 1, 5, shade);
  m.set(2, 3, 5, shade).set(4, 3, 5, shade);            // cheek hollows beside the nose
  m.set(-1, 3, 2, shade).set(-1, 4, 2, skin).set(7, 3, 2, shade).set(7, 4, 2, skin);   // ears
  return m;
}
// a cap of cloth / hair / metal over the skull from height y0 up to a top
// layer at y = top, open at the face below the brow (y < front)
function capN(m, color, { y0 = 5, front = 6, top = 8 } = {}) {
  for (let y = y0; y < top; y++) {
    for (let z = 0; z <= 5; z++) m.set(-1, y, z, color).set(7, y, z, color);
    for (let x = 0; x <= 6; x++) { m.set(x, y, -1, color); if (y >= front) m.set(x, y, 6, color); }
  }
  for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) {
    if ((x === 0 || x === 6) && (z === 0 || z === 5)) continue;
    m.set(x, top, z, color);
  }
  return m;
}
// a band round the head at height y (outside the skull)
function ringN(m, y, color) {
  for (let z = 0; z <= 5; z++) m.set(-1, y, z, color).set(7, y, z, color);
  for (let x = 0; x <= 6; x++) m.set(x, y, -1, color).set(x, y, 6, color);
  return m;
}
// nemes: a striped headcloth: a domed crown with a gold brow band, side wings
// that flare out and down past the jaw onto the shoulders, two lappets falling
// forward onto the chest, a queue down the back. Stripes run round the head
// (by height) and front to back on the crown, so the top reads as a striped
// cloth rather than a flat lid.
function nemesN(m, a = GOLD, b = TEAM, { uraeus = false, lappets = true, chest = 9, wing = 1 } = {}) {
  const S = (x, y, z) => { const c = (y >= 8 ? (z & 1) : (y & 1)) ? b : a; return typeof c === 'function' ? c(x, y, z) : c; };
  capN(m, S, { y0: 5, front: 6, top: 8 });
  m.box(0, 6, 6, 7, 1, 1, GOLD).set(-1, 6, 5, GOLD).set(7, 6, 5, GOLD);   // brow band
  // side wings: from the temples down to the shoulders, flaring outwards
  for (let y = 5; y >= -3; y--) {
    const out = 1 + Math.floor((5 - y) * 0.33 * wing);
    for (const s of [-1, 1]) for (let k = 1; k <= out; k++) {
      const x = s < 0 ? -k : 6 + k;
      for (let z = (y < 2 ? 1 : 0); z <= 4; z++) m.set(x, y, z, S(x, y, z));
    }
  }
  if (lappets) {
    // over the shoulders and down the chest (in front of a collar at z = chest)
    for (const x0 of [-2, 7]) {
      for (let z = 4; z <= chest; z++) m.box(x0, -2 - Math.floor((z - 4) * 0.5), z, 2, 2, 1, S);
      for (let y = -3 - Math.floor((chest - 4) * 0.5); y >= -7; y--) m.box(x0, y, chest, 2, 1, 1, S);
      m.box(x0, -8, chest, 2, 1, 1, a);
    }
  }
  m.box(2, -5, -2, 3, 11, 1, S);                         // the queue at the back
  if (uraeus) m.set(3, 7, 7, GOLD).set(3, 8, 7, 0xff5a2a).set(3, 6, 7, GOLD);
  return m;
}
// (round 23) the mummy's nemes as one flared trapezoid: a low rounded cap
// over the skull, wide team bands broken by a thin pale line every fourth row
// (no 1-voxel stripe noise), a gold brow band, side wings stepping out from
// the temples to twice the skull's width at the jaw, and two broad lappets
// falling forward onto the chest with gold tips. The face stays open.
function nemesT(m, { line = 0xf2ead2, chest = 8, tip = GOLD } = {}) {
  const S = (x, y, z) => ((((y + 32) % 4) === 0) ? line : TEAM);
  const SC = (x, y, z) => (((x + 32) % 4) === 1 ? line : TEAM);        // the crown: bands front to back
  // the cap: x -1..7, z -1..6 (open below the brow at the front), up to y 8
  for (let y = 5; y <= 8; y++) {
    const nar = y >= 8 ? 1 : 0;
    for (let x = -1 + nar; x <= 7 - nar; x++) for (let z = -1 + nar; z <= 6 - nar; z++) {
      const ex = x === -1 + nar || x === 7 - nar, ez = z === -1 + nar || z === 6 - nar;
      if (ex && ez) continue;
      if (y < 8 && !ex && !ez) continue;                    // hollow below the top
      if (z === 6 && y < 6) continue;                       // the face open
      m.set(x, y, z, y === 8 ? SC(x, y, z) : S(x, y, z));
    }
  }
  for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) m.set(x, 7, z, TEAM);
  m.box(-1, 6, 6, 9, 1, 1, GOLD).set(3, 7, 7, GOLD).set(3, 8, 7, GOLD);   // brow band, gold uraeus
  // the wings: from the temples (y 5) to the jaw (y -2), stepping out 1 voxel every 2 rows
  for (let y = 5; y >= -2; y--) {
    const out = Math.min(4, 1 + Math.floor((5 - y) / 2));
    for (const s of [-1, 1]) for (let k = 1; k <= out; k++) {
      const x = s < 0 ? -k : 6 + k;
      for (let z = -1; z <= 4; z++) m.set(x, y, z, S(x, y, z));
    }
  }
  // the lower edge of the wings, solid team
  for (const s of [-1, 1]) for (let k = 1; k <= 4; k++) { const x = s < 0 ? -k : 6 + k; for (let z = -1; z <= 4; z++) m.set(x, -3, z, TEAM); }
  // the lappets: 2 wide, forward over the shoulders, then down the chest
  for (const x0 of [-3, 8]) {
    for (let z = 2; z <= chest; z++) m.box(x0, -3 - Math.floor((z - 2) * 0.35), z, 2, 2, 1, S);
    const yt = -3 - Math.floor((chest - 2) * 0.35);
    for (let y = yt - 1; y >= -8; y--) m.box(x0, y, chest, 2, 1, 1, S);
    m.box(x0, -9, chest, 2, 1, 1, tip);
  }
  m.box(1, -6, -2, 5, 11, 1, S);                           // the back gathered into a queue
  return m;
}
function headE(style) {
  const m = new VoxelModel();
  const dark = style === 'merc' || style === 'mercCav';
  if (style === 'pharaoh') {
    // a clear tan face block: no brow line, two dark kohl eyes, the nose ridge
    // (a step lighter than his arms: the face turns from the sun and must still read tan)
    const FACE = pick3(34, 0xc89060, 0xc08858, 0xd0986a);
    faceN(m, FACE, 0xa87046, { eyes: [DARK, DARK], brow: null, nose: 0xc08858 });
    m.set(1, 4, 5, DARK).set(2, 4, 5, DARK).set(4, 4, 5, DARK).set(5, 4, 5, DARK);
    m.set(2, 3, 5, FACE(2, 3, 5)).set(4, 3, 5, FACE(4, 3, 5)).set(3, 1, 5, 0x7a3a24);
    // (round 13) kohl-lined eyes with white corners under a brow ridge, nostril shadows
    m.set(1, 4, 5, 0xf6eee2).set(5, 4, 5, 0xf6eee2);
    for (const x of [1, 2, 4, 5]) m.set(x, 5, 6, 0x4a2412);
    m.set(2, 2, 5, 0x7a4424).set(4, 2, 5, 0x7a4424).set(2, 1, 5, 0x6a3020).set(4, 1, 5, 0x6a3020);
  } else if (dark) faceN(m, SKIN_DK, SKIN_DK_SH, { nose: 0x6e4632, face: 0x6c4632 });
  else {
    // the light face plane: two dark kohl eyes (a voxel of the body each), a
    // brow line a value step down above them, the nose standing out lighter
    // (round 13) a defined face at RTS zoom: a dark brow ridge standing a
    // voxel proud over the eyes (unbroken but for the nose bridge), white eye
    // corners and dark pupils under it, a light nose line from the bridge to
    // the tip with dark nostril shadows either side, a dark mouth line
    faceN(m, SKIN, SKIN_SH, { eyes: [0xf6eee2, DARK], brow: 0x3a1c0e, nose: 0xf0b07a, face: SKIN_FACE });
    m.set(2, 3, 5, SKIN_FACE(2, 3, 5)).set(4, 3, 5, SKIN_FACE(4, 3, 5));
    for (const x of [1, 2, 4, 5]) m.set(x, 5, 6, 0x4a2412);                    // the brow ridge
    m.set(3, 5, 5, 0xd8925e).set(3, 4, 6, 0xe8a670);                            // the bridge of the nose
    m.set(2, 2, 5, 0x5a2c16).set(4, 2, 5, 0x5a2c16);                            // nostril shadows
    m.set(2, 1, 5, 0x4a2014).set(3, 1, 5, 0x3a1810).set(4, 1, 5, 0x4a2014);     // the mouth
  }
  if (style === 'laborer') {
    // (round 12, unit_11) close-cropped black hair with a clear hairline,
    // full at the back of the skull, no headcloth
    capN(m, HAIR, { y0: 6, front: 7, top: 8 });
    for (let x = 0; x <= 6; x++) m.set(x, 7, 5, HAIR);
    for (let z = 0; z <= 4; z++) m.set(-1, 5, z, HAIR).set(7, 5, z, HAIR);
    m.box(0, 3, -1, 7, 3, 1, HAIR);
  } else if (style === 'spear') {
    // close-cropped black hair (a clear hairline over the light face), a team
    // headband and one long braided side lock
    // (the band sits a row up, so it casts no shadow on the brow and eyes)
    capN(m, HAIR, { y0: 5, front: 7, top: 8 });
    for (let x = 0; x <= 6; x++) m.set(x, 6, 5, HAIR);
    ringN(m, 7, TEAM);
    m.box(-2, 1, 1, 1, 5, 2, HAIR).box(-2, -3, 1, 1, 4, 1, HAIR).set(-2, -4, 1, GOLD(0, 0, 0));
  } else if (style === 'shaved') {
    // (round 22, the Scorpion Man, myth_08) a shaved head: a smooth skull a
    // step darker than the face with one lit row on the crown, no wig or
    // headband; gold earrings
    const SK = 0x9a5632, SK_L = 0xbc7848;
    // no cap round the skull (it read as a hat brim): the face block's own
    // crown with a low dome on top, the lit row along its middle
    for (let x = 1; x <= 5; x++) for (let z = 0; z <= 4; z++) m.set(x, 8, z, x >= 2 && x <= 4 && z >= 1 && z <= 3 ? SK_L : SK);
    m.set(-1, 3, 3, GOLD(0, 0, 0)).set(7, 3, 3, GOLD(0, 0, 0));
  } else if (style === 'axe') {
    nemesN(m, GOLD, BLACK);
  } else if (style === 'sling') {
    // a black bobbed wig to the jaw, a team headband with a gold bead
    capN(m, HAIR, { y0: 1, front: 6, top: 8 });
    m.box(0, 0, -1, 7, 2, 1, HAIR);
    ringN(m, 6, TEAM).set(3, 6, 7, GOLD(1, 1, 1));
  } else if (style === 'helmet') {
    // a rounded silver helmet with a team crest and cheek guards
    capN(m, SILVER, { y0: 3, front: 6, top: 8 });
    m.box(-1, 6, 6, 9, 1, 1, SILVER_DK);
    m.box(3, 6, -2, 1, 4, 9, TEAM).remove(3, 6, 6).remove(3, 9, 7).remove(3, 9, -2);
    m.box(-1, 0, 3, 1, 3, 3, SILVER).box(7, 0, 3, 1, 3, 3, SILVER).box(0, 1, -1, 7, 2, 1, SILVER_DK);
  } else if (style === 'charioteer') {
    // a striped bronze and team helmet cap over an open face: big dark kohl
    // eyes (2 voxels each) and a shadow beside the nose, readable at RTS zoom
    capN(m, (x, y, z) => (y >= 8 ? (x & 1) : (y & 1)) ? TEAM : BRONZE(x, y, z), { y0: 5, front: 6, top: 8 });
    m.box(0, 6, 6, 7, 1, 1, GOLD).set(3, 8, 7, GOLD(0, 0, 0)).set(3, 7, 7, GOLD(1, 0, 0));
    m.set(1, 4, 5, DARK).set(2, 4, 5, DARK).set(4, 4, 5, DARK).set(5, 4, 5, DARK);
    m.set(2, 3, 5, 0x4a2814).set(2, 2, 5, 0x5a321c).set(4, 2, 5, SKIN_SH);
    m.box(-1, 2, 1, 1, 3, 3, BRONZE).box(7, 2, 1, 1, 3, 3, BRONZE);   // cheek flaps behind the face
  } else if (style === 'camel') {
    nemesN(m, LINEN, TEAM, { chest: 7 });
  } else if (style === 'priest') {
    // a shaved priest under a white headcloth to the shoulders, a gold sun disc on the brow
    capN(m, LINEN, { y0: 5, front: 6, top: 8 });
    for (let y = 5; y >= -2; y--) for (const x of [-1, -2, 7, 8]) { if ((x === -2 || x === 8) && y > 2) continue; m.box(x, y, 0, 1, 1, 5, LINEN); }
    m.box(-2, -2, -1, 11, 7, 1, LINEN_SH);
    m.box(0, 6, 6, 7, 1, 1, GOLD);
    m.box(2, 7, 6, 3, 2, 1, GOLD, { glow: 0.35 }).set(3, 7, 7, 0xff9a20, { glow: 0.6 }).set(3, 8, 7, 0xffb030, { glow: 0.5 });
  } else if (style === 'pharaoh') {
    // the blue crown (khepresh) in the army's colour studded with gold discs,
    // swelling up and back; a gold uraeus, a gold false beard
    for (let y = 5; y <= 12; y++) {
      const back = y > 7 ? Math.min(4, y - 7) : 0, nar = y > 10 ? 1 : 0;
      for (let z = -1 - back; z <= 6 - Math.floor(back / 2); z++) for (let x = -1 + nar; x <= 7 - nar; x++) {
        if (z >= 5 && y < 6) continue;
        const ex = x === -1 + nar || x === 7 - nar, ez = z === -1 - back || z === 6 - Math.floor(back / 2);
        if (ex && ez) continue;
        if ((x + y * 2 + z) % 5 === 0 && y > 6) m.set(x, y, z, PH_GOLD); else m.set(x, y, z, TEAM);
      }
    }
    m.box(-1, 6, 6, 9, 1, 1, PH_GOLD).carve(-1, 6, 6, 1, 1, 1).carve(7, 6, 6, 1, 1, 1);
    m.set(3, 7, 7, PH_GOLD_L).set(3, 8, 7, PH_GOLD_L).set(3, 9, 7, PH_GOLD_L);   // uraeus
    m.box(-1, 1, -1, 9, 4, 1, TEAM).box(-1, 1, 0, 1, 4, 3, TEAM).box(7, 1, 0, 1, 4, 3, TEAM);
    // the braided false beard: dark, banded gold, standing out under the chin
    m.box(2, -3, 5, 3, 3, 2, HAIR).box(2, -2, 6, 3, 1, 1, PH_GOLD_L).set(3, -4, 5, PH_GOLD_L);
  } else if (style === 'merc') {
    capN(m, HAIR, { y0: 5, front: 6, top: 8 });
    for (let x = -1; x <= 7; x += 2) m.set(x, 9, 2, HAIR);
    ringN(m, 6, TEAM);
    m.set(-1, 3, 3, GOLD(0, 0, 0)).set(7, 3, 3, GOLD(0, 0, 0));       // gold earrings
  } else if (style === 'mercCav') {
    capN(m, HAIR, { y0: 2, front: 6, top: 8 });
    ringN(m, 6, TEAM);
  } else if (style === 'mahout') {
    capN(m, LINEN, { y0: 5, front: 6, top: 8 });
    m.box(0, 9, 0, 7, 2, 6, TEAM).carve(0, 10, 0, 1, 1, 1).carve(6, 10, 5, 1, 1, 1).box(1, 11, 1, 5, 1, 4, TEAM);
  } else if (style === 'mummy') {
    // the face under wrappings, glowing green eyes, a team and gold nemes
    const WRAP = (x, y, z) => ((y & 1) ? 0xd2c6a6 : 0xb8aa86);
    m.vox.clear();
    faceN(m, WRAP, 0x8a7c5c, { eyes: [0x60ff90, 0x60ff90], brow: 0x7a6c50, nose: 0xc6b996 });
    m.get(1, 4, 5).glow = 0.8; m.get(2, 4, 5).glow = 0.8; m.get(4, 4, 5).glow = 0.8; m.get(5, 4, 5).glow = 0.8;
    nemesT(m, { chest: 8 });
  } else if (style === 'minion') {
    const GR = pick3(65, 0x8c8c86, 0x7e7e78, 0x9a9a92);
    m.vox.clear();
    faceN(m, GR, 0x5e5e58, { eyes: [0x80d0ff, 0x80d0ff], brow: 0x3a3a36, nose: 0x9a9a92 });
    for (const [x] of [[1], [2], [4], [5]]) m.get(x, 4, 5).glow = 0.8;
    capN(m, TEAM, { y0: 3, front: 6, top: 9 });
    m.box(-1, -2, -1, 9, 6, 1, TEAM).box(-1, 0, 0, 1, 3, 4, TEAM).box(7, 0, 0, 1, 3, 4, TEAM);
    for (let x = -1; x <= 7; x++) tset(m, x, 6, 6, TEAM_SHADE);
  }
  return m;
}
function headPart(style, joint = [0, 10, 0.2], parent = 'torso', s = 1) {
  return part('head', headE(style), HEAD_PIVOT, joint, parent, { scale: HEAD_SCALE * s, rest: HEAD_TILT });
}
// ---- the Egyptian man (round 7): Retold's proportions, not a walking crate ----
// The men's bodies are authored at half the rig voxel (BODY_SCALE, like the
// heads), so a figure can taper: long legs (hip at 14 rig voxels: the legs
// are half the figure), a short torso narrowing from 12-wide shoulders over a
// 12-wide chest (1.2-1.3 x the 10-wide hips) to an 8-wide waist at the belt,
// rounded deltoids the arms hang from, a sloping trapezius, a 2-row (one rig
// voxel) neck and the head raised on it. Skin is two flat tones, no noise: a
// light front / shoulder tone (L) and a side / back tone (M), with one darker
// row under the pectorals; dress is painted over it in clean bands. All
// measures below are in half voxels (h) unless they are joints (rig voxels).
const BODY_SCALE = 0.5;
const MAN = { hip: 14, shin: -7, legX: 1.25, armX: 4, armY: 6.25, headY: 8.5, headZ: 0.3 };   // rig voxels
const HAND_E = [0, -8.5, 0];           // the fist (arm joint -> fist centre)
const GRIP_E = [-0.45, -8.5, 0.6];     // a haft held just outside / in front of the fist
const SHIELD_E = [1.9, -5.4, 2.6];     // a shield strapped on the forearm, clear of the body
// (round 11) a step redder, so the skin stays warm brown in the sky-lit shade
// instead of going olive-khaki beside the gold
// (round 12) a sun-browned skin, not salmon: four tones (H the lit shoulder
// tops, L fronts, M sides / back, D the inner faces under the arms, the inner
// legs and under the chest)
// (round 12b) a step darker and browner again: L 0xbc7442 still graded to a
// salmon peach on the lit fronts, Retold's labourers are a mid brown
const PAL_SKIN = { H: 0xa26c42, L: 0x8e5634, M: 0x6a3a22, D: 0x4c2816 };
const PAL_DARK = { L: 0x80543a, M: 0x5e3a26, D: 0x3e2618 };
// [width, zBack, zFront] per torso row (y = 0 at the hip joint)
const TORSO_ROWS = {
  '-1': [10, -3, 2], 0: [10, -3, 2], 1: [10, -3, 2],    // the pelvis (under the kilt)
  2: [8, -3, 2], 3: [8, -3, 2],                          // the waist at the belt
  4: [8, -3, 2], 5: [8, -3, 2], 6: [8, -3, 2],           // the belly
  7: [10, -3, 3], 8: [10, -3, 3],                        // the ribs widen
  9: [12, -4, 3], 10: [12, -4, 3], 11: [12, -4, 3], 12: [12, -4, 3],   // the chest
  13: [12, -3, 2],                                       // the shoulders' top
  14: [6, -2, 1],                                        // the trapezius slopes in
  15: [4, -2, 1], 16: [4, -2, 1],                        // the neck
};
const solid = (c, x, y, z) => (typeof c === 'function' ? c(x, y, z) : c);
const TM = { t: 0xffffff }, TM_SH = { t: TEAM_SHADE }, TM_DK = { t: 0x8a8a8a };   // team dye tones for paint()
// the bare torso in two flat tones
function manTorso(pal = PAL_SKIN) {
  const m = new VoxelModel();
  for (const [ys, [w, z0, z1]] of Object.entries(TORSO_ROWS)) {
    const y = +ys;
    for (let x = -w / 2; x < w / 2; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === -w / 2 || x === w / 2 - 1, ez = z === z0 || z === z1;
      if (ex && ez && w >= 8) continue;                  // rounded edges
      const ax = Math.abs(x + 0.5);
      let c = pal.M;
      if (z === z1 && !(ex && w >= 8)) c = pal.L;
      // (round 12) the flanks under the arms a tone darker (D)
      if (ex && y >= 6 && y <= 11) c = pal.D;
      if (y >= 13) c = palH(pal);                        // the lit tops of the shoulders
      if (y >= 15) c = z === z1 ? pal.L : pal.M;         // the neck
      // the shadow under the pectorals: one unbroken row (two dark patches
      // and a solar plexus mark read as a face painted on the chest), the
      // ribs below it a side tone
      // (round 12b) the side tone, not D, and only under the pecs: a full dark
      // row read as a seam cutting the torso in two
      if (z === z1 && y === 9 && ax <= 4) c = pal.M;
      if (z === z0 && y <= 1) c = pal.D;
      m.set(x, y, z, c);
    }
  }
  // rounded deltoids standing out past the chest: the arms hang from under them
  for (const x of [-7, 6]) for (let y = 10; y <= 13; y++) for (let z = -2; z <= 1; z++) {
    if ((y === 10 || y === 13) && (z === -2 || z === 1)) continue;
    m.set(x, y, z, y >= 12 ? palH(pal) : z === 1 ? pal.L : pal.M);
  }
  return m;
}
// paint every voxel of a torso inside a region (fn(x, y, z) -> colour | null)
function paint(m, fn) {
  for (const [k] of m.vox) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    const c = fn(x, y, z, m.get(x, y, z));
    if (c === null || c === undefined) continue;
    if (typeof c === 'object') tset(m, x, y, z, c.t);    // { t: base }: team dye on a base tone
    else m.set(x, y, z, c);
  }
  return m;
}
const teamTone = (m, x, y, z, base) => tset(m, x, y, z, base);
// the shendyt: an A-line kilt from the belt (y 1) to the hem at y = -len,
// widening 10 -> 12 -> 14, deeper towards the hem, the sides a tone darker than
// the front (form, not stripes), one wrap fold running diagonally down the
// front, a pale hem, the front dipping a row lower; an optional apron panel
// standing a voxel proud of the front, widening downwards
function eKilt(m, { color = TEAM, len = 8, hem = TEAM_TRIM, side = TEAM_SHADE, apron = null, apronEdge = null, fold = true, pleats = false } = {}) {
  for (let y = 1; y >= -len - 1; y--) {
    const i = 1 - y;
    // (round 12) a short trapezoid flaring from the belt: wider and deeper
    // every few rows, so the hem stands out past the hips
    const w = i < 2 ? 10 : i < 5 ? 12 : 14;
    const z0 = i < 5 ? -3 : -4, z1 = 2 + (i >= 2 ? 1 : 0) + (i >= 5 ? 1 : 0);
    for (let x = -w / 2; x < w / 2; x++) for (let z = z0; z <= z1; z++) {
      const ax = Math.abs(x + 0.5);
      if (y === -len - 1 && (ax > 3 || z < z1 - 1)) continue;       // the front dips lower
      const ex = x === -w / 2 || x === w / 2 - 1;
      if (ex && (z === z0 || z === z1)) continue;
      const isHem = hem && (y === -len - 1 || (y === -len && ax > 3) || (y === -len && z < z1 - 1));
      const isSide = ex || z === z0;
      // (round 13) pleats: every third column of the front a tone down from
      // the second row, so a team kilt reads as folded linen, not a blob
      const isFold = (fold && z === z1 && Math.round(-2 - (1 - y) * 0.45) === x) || (pleats && i >= 2 && z === z1 && (x + 30) % 3 === 0);
      // the belt's shadow: the row under the belt a tone down all round
      const isShadow = i === 0;
      const dk = isSide || isFold || isShadow;
      if (isHem) { if (typeof hem === 'object') tset(m, x, y, z, hem.t); else m.set(x, y, z, hem); continue; }
      if (color === TEAM) tset(m, x, y, z, dk ? (isSide && (isFold || isShadow) ? 0x8a8a8a : side) : 0xffffff);
      else m.set(x, y, z, dk ? side : solid(color, x, y, z));
    }
  }
  if (apron) {
    for (let y = 1; y >= -len; y--) {
      const hw = 1 + Math.floor((1 - y) / 3);
      const z = (1 - y) < 6 ? 3 : 4;
      for (let x = -hw; x < hw; x++) {
        const edge = apronEdge && (x === -hw || x === hw - 1 || y === -len);
        m.set(x, y, z, edge ? apronEdge : apron);
      }
    }
  }
  return m;
}
// a belt round the waist (rows 2-3), a knot / buckle standing out at the front
function eBelt(m, color, knot = null) {
  for (let y = 2; y <= 3; y++) for (let x = -5; x <= 4; x++) for (let z = -4; z <= 3; z++) {
    if (!m.has(x, y, z)) continue;
    const out = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    if (out) { if (color === TEAM) tset(m, x, y, z, 0xffffff); else m.set(x, y, z, solid(color, x, y, z)); }
  }
  if (knot) m.box(-1, 2, 3, 2, 2, 1, knot);
  return m;
}
// the broad collar (wesekh) lying over the shoulders like a short cape: rings
// by the distance from the neck over the surface (across the shoulders' top,
// then down the chest and the back), one ring per entry of rows (1 h each),
// so the front shows a clean crescent of bands under the chin
function eCollar(m, rows, { r0 = 2.6 } = {}) {
  paint(m, (x, y, z) => {
    if (y < 8 || y > 14) return null;
    const a = Math.hypot(x + 0.5, (z + 0.5) * 1.25);
    const s = a + Math.max(0, 13.5 - (y + 0.5)) * 1.05;
    const k = Math.floor(s - r0);
    if (k < 0 || k >= rows.length || (y >= 15)) return null;
    return rows[k];
  });
  return m;
}
// two straps from the shoulders straight down the chest and back to the belt
// (Retold's spearman), a metal ring where they cross the collarbone
function eStraps(m, color, stud) {
  paint(m, (x, y, z) => {
    if (y < 4 || y > 13) return null;
    const ax = Math.abs(x + 0.5);
    if (y === 13 && (ax === 3.5 || ax === 2.5)) return color;
    if (ax === 3.5 && (z >= 2 || z <= -3)) return color;
    return null;
  });
  if (stud) for (const x of [-4, 3]) m.set(x, 11, 4, stud).set(x, 11, -5, stud);
  return m;
}
// (round 12) the limbs are round, tapering sections of one flesh mass, not
// sticks: each row a filled ellipse (half-extents rx / rz about z = cz) on the
// voxel grid, so a 5-wide row is an octagon, a 3-wide one a square or a plus;
// four flat skin tones by the face a voxel is on: H (the lit tops of the
// shoulders), L (the front), M (the sides and back), D (the inner faces:
// under the arms, the inner thighs and calves)
const lighten = (c, k = 0.16) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; const f = (v) => Math.min(255, Math.round(v + (255 - v) * k)); return (f(r) << 16) | (f(g) << 8) | f(b); };
const palH = (pal) => pal.H ?? lighten(pal.L);
function limbRows(m, rows, tone) {
  for (const [y, rx, rz, cz = 0] of rows) for (let x = -3; x <= 3; x++) for (let z = -4; z <= 4; z++) {
    const nx = x / rx, nz = (z - cz) / rz;
    if (nx * nx + nz * nz > 1) continue;
    const c = tone(x, y, z, nx, nz);
    if (c === null || c === undefined) continue;
    if (c === TEAM) tset(m, x, y, z, nz > 0.45 ? 0xffffff : TEAM_SHADE);
    else m.set(x, y, z, solid(c, x, y, z));
  }
  return m;
}
// Arm (half voxels), the shoulder joint at pivot [0.5, 18.5, 0.5]: a round
// shoulder cap, a 5-wide deltoid / biceps (y 13..17) whose inner column sits
// inside the torso's deltoid (no gap at the armpit), tapering through the
// upper arm to a 3-wide elbow (y 9..10), a 3-wide forearm narrowing to the
// wrist (y 3..4) and a 3 x 3 fist (y 0..2): the upper arm two voxels thicker
// than the forearm. Tones: the cap's top H, fronts L, sides / back M, the
// inner face (towards the body) D.
const ARM_ROWS = [
  [18, 1.6, 1.6], [17, 2.3, 2.0], [16, 2.4, 2.3], [15, 2.4, 2.3], [14, 2.4, 2.3], [13, 2.3, 2.1],
  [12, 2.0, 2.0], [11, 2.0, 2.0], [10, 1.6, 1.6], [9, 1.6, 1.6],
  [8, 1.6, 1.6], [7, 1.6, 1.6], [6, 1.6, 1.6], [5, 1.6, 1.6], [4, 1.6, 1.6], [3, 1.25, 1.25],
];
// (round 13) the hand: a narrower wrist (row 3, a plus section a tone down,
// so the forearm visibly ends) over a fist a voxel deeper than the forearm,
// the fingers curled forward: the back of the hand (row 2), the knuckles
// (row 1, a lit row across the front, a thumb on the inner side) and the
// curled fingertips (row 0, under the front). grip: a hole through the fist
// (x 0, z 0..1, rows 0..2) a haft passes through, the fingers wrapped round
// it in front (z 2) and the palm behind (z -1): GRIP_C is its centre (rig
// voxels from the shoulder joint, straight arm)
function handVox(m, pal, out, { grip = false, fist = null } = {}) {
  const H = palH(pal);
  for (let y = 0; y <= 2; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 2; z++) {
    if (y === 0 && z === -1) continue;                    // the fingertips curl under the front
    if (y === 2 && z === 2 && !grip) continue;            // the back of the hand slopes to the knuckles
    if (grip && x === 0 && (z === 0 || z === 1)) continue;   // the haft's hole
    const inner = x * out < 0, front = z === 2;
    let c = front ? (y === 1 ? H : pal.L) : inner ? pal.D : pal.M;
    if (front && y === 0) c = pal.M;                      // under the curled fingers
    if (front && y === 1 && x === 0 && !grip) c = pal.L;  // the crease between the knuckles
    if (z === -1 && y === 2) c = pal.M;
    m.set(x, y, z, fist || c);
  }
  // the thumb laid over the fingers on the inner side
  m.set(-out, 2, 2, fist || pal.L);
  return m;
}
const GRIP_C = [0, -8.5, 0.25];
function manArmM({ pal = PAL_SKIN, side = 'L', bracer = null, band: bnd = null, sleeve = null, fist = null, bend = 0, grip = false } = {}) {
  const m = new VoxelModel();
  const out = side === 'L' ? 1 : -1, H = palH(pal);
  limbRows(m, ARM_ROWS, (x, y, z, nx, nz) => {
    const inner = nx * out < -0.55, front = nz > 0.45;
    let c = front ? pal.L : inner ? pal.D : pal.M;
    if (y >= 16 && nz > -0.6 && !inner) c = H;            // the lit shoulder cap
    if (y >= 17) c = inner ? pal.M : H;
    if (y === 3) c = front ? pal.M : pal.D;               // the wrist, a tone down
    if (bracer && y >= 4 && y <= 7) c = bracer;
    if (bnd && y >= 12 && y <= 13) c = bnd;
    if (sleeve && y >= 13) c = y === 13 ? (typeof sleeve === 'number' ? shadeC(sleeve, 0.86) : sleeve) : sleeve;
    return c;
  });
  handVox(m, pal, out, { grip, fist });
  return bendArm(m, bend);
}
const shadeC = (c, k) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k); };
// bend an arm (manArmM, half voxels) at the elbow: the forearm (y <= 9) turns
// forward (+z) by a radians about the elbow (y 9.5, z 0.5), so the arm hangs
// from the shoulder and the forearm comes forward instead of the whole arm
// hanging straight; armFist(a) = the bent fist in rig voxels from the shoulder
// joint (for a part attached to the hand). (round 13) The hand (rows 0..2)
// is carried, not turned: the wrist flexes so the fist stays upright and a
// haft held through it (grip) stands straight in it.
const ELBOW_Y = 9.5;
const handShift = (a) => {
  const ca = Math.cos(a), sa = Math.sin(a);
  return [Math.round(ELBOW_Y - 8 * ca - 1.5), Math.round(0.5 + 8 * sa - 0.5)];
};
function bendArm(m, a) {
  if (!a) return m;
  const ca = Math.cos(a), sa = Math.sin(a), fore = [], hand = [];
  for (const [k, v] of m.vox) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    if (y <= 2) hand.push([x, y, z, v]); else if (y <= 9) fore.push([x, y, z, v]);
  }
  for (const [x, y, z] of [...fore, ...hand]) m.remove(x, y, z);
  for (const [x, y, z, v] of fore) for (const oy of [0.2, 0.5, 0.8]) for (const oz of [0.2, 0.5, 0.8]) {
    const dy = y + oy - ELBOW_Y, dz = z + oz - 0.5;
    const ny = Math.floor(ELBOW_Y + dy * ca + dz * sa), nz = Math.floor(0.5 + dz * ca - dy * sa);
    if (ny > 9 && m.has(x, ny, nz)) continue;
    m.set(x, ny, nz, 0); Object.assign(m.get(x, ny, nz), v);
  }
  const [hy, hz] = handShift(a);
  for (const [x, y, z, v] of hand) { m.set(x, y + hy, z + hz, 0); Object.assign(m.get(x, y + hy, z + hz), v); }
  return m;
}
// the grip hole's centre in a bent arm (rig voxels from the shoulder joint)
const gripBent = (a) => { const [hy, hz] = handShift(a); return [0, (1.5 + hy - 18.5) * BODY_SCALE, (1 + hz - 0.5) * BODY_SCALE]; };
const armFist = (a) => [0, (ELBOW_Y - 8 * Math.cos(a) - 18.5) * BODY_SCALE, 8 * Math.sin(a) * BODY_SCALE];
// Thigh / shin (half voxels), pivot [0.5, 14, 0.5] at the hip / knee: the
// thigh a 5-wide rounded section (the two thighs meet under the pelvis, no
// gap) tapering to a 3-wide knee (y 0..2) that sits inside the shin's 4-5
// wide top (the knee rows overlap, so a bent knee stays closed); the shin a
// calf bulging back, narrowing to the ankle over a straight foot (toes
// forward, not turned in). side 'L' | 'R' picks the inner face (tone D).
const LEG_PIVOT = [0.5, 14, 0.5];
const THIGH_ROWS = [
  [13, 2.5, 2.4], [12, 2.5, 2.4], [11, 2.5, 2.4], [10, 2.5, 2.4], [9, 2.4, 2.3], [8, 2.4, 2.3], [7, 2.3, 2.2],
  [6, 2.3, 2.2], [5, 2.2, 2.1], [4, 2.0, 2.0], [3, 2.0, 2.0], [2, 2.0, 2.0], [1, 2.0, 2.0], [0, 2.0, 2.0],
];
function manThighM({ pal = PAL_SKIN, kilt = null, side = 'L' } = {}) {
  const m = new VoxelModel();
  const out = side === 'L' ? 1 : -1;
  limbRows(m, THIGH_ROWS, (x, y, z, nx, nz) => {
    if (kilt && y >= 9) return kilt;
    const inner = nx * out < -0.55;
    return nz > 0.45 ? pal.L : inner ? pal.D : pal.M;
  });
  if (!kilt) m.set(0, 1, 2, palH(pal)).set(0, 2, 2, pal.L);   // the kneecap
  else m.set(0, 1, 2, palH(pal));
  return m;
}
const SHIN_ROWS = [
  [13, 2.0, 2.0], [12, 2.1, 2.1], [11, 2.2, 2.4, -0.3], [10, 2.2, 2.5, -0.5], [9, 2.0, 2.4, -0.5], [8, 2.0, 2.3, -0.4],
  [7, 1.8, 2.0, -0.2], [6, 1.7, 1.8], [5, 1.6, 1.6], [4, 1.6, 1.6], [3, 1.6, 1.6], [2, 1.6, 1.6],
];
function manShinM({ pal = PAL_SKIN, sandal = SANDAL, band: bnd = null, wrap = null, foot = null, side = 'L' } = {}) {
  const m = new VoxelModel();
  const out = side === 'L' ? 1 : -1;
  limbRows(m, SHIN_ROWS, (x, y, z, nx, nz) => {
    if (wrap) return (y >> 1) & 1 ? wrap : LINEN_SH;
    if (bnd && y === 11) return bnd;
    const inner = nx * out < -0.55;
    return nz > 0.45 ? pal.L : inner ? pal.D : pal.M;
  });
  // the foot: a sole and the foot over it, straight forward
  const F = foot || pal.M;
  m.box(-1, 0, -2, 3, 1, 6, sandal || F);
  m.box(-1, 1, -1, 3, 1, 4, F).set(0, 1, 3, F);
  if (!foot) m.set(0, 1, 2, pal.L).set(0, 1, 1, pal.L);
  if (sandal) m.set(-1, 1, 1, sandal).set(1, 1, 1, sandal).set(0, 2, -1, sandal);
  return m;
}
// a myth warrior on the men's body with a beast's head (a rig-voxel model,
// scaled down onto the neck) and split arms for the beast anim (armL / foreL:
// the upper arm to the elbow, the forearm and fist); weapons go on the fist
// at BEAST_FIST of the forearm
// (round 15) the forearm overlaps the upper arm two rows at a rounded elbow
// with a knob behind it (splitArm, as the men's), so a bent elbow stays
// closed; the fist centre moves with the forearm joint (y 9.5)
const BEAST_FIST = [0, -4, 0.3];
function beastManParts({ torso, pal = PAL_SKIN, head: hm, headPivot = [2.5, 0, 2.5], headScale = 0.62, headZ = 0.5, arm = {}, leg = {}, shin = null }) {
  const X = { scale: BODY_SCALE, jitter: 0.015, ao: false };
  const thL = manThighM({ pal, ...leg, side: 'L' }), thR = manThighM({ pal, ...leg, side: 'R' });
  const shL = shin || manShinM({ pal, ...leg, side: 'L' }), shR = shin || manShinM({ pal, ...leg, side: 'R' });
  const split = (side) => splitArm(manArmM({ pal, ...arm, side }), pal);
  const [uL, lL] = split('L'), [uR, lR] = split('R');
  return [
    part('legL', thL, LEG_PIVOT, [MAN.legX, MAN.hip, 0], null, X),
    part('shinL', shL, LEG_PIVOT, [0, MAN.shin, 0], 'legL', X),
    part('legR', thR, LEG_PIVOT, [-MAN.legX, MAN.hip, 0], null, X),
    part('shinR', shR, LEG_PIVOT, [0, MAN.shin, 0], 'legR', X),
    part('torso', torso, [0, 0, 0], [0, MAN.hip, 0], null, X),
    part('head', hm, headPivot, [0, MAN.headY, headZ], 'torso', { scale: headScale }),
    part('armL', uL, [0.5, 18.5, 0.5], [MAN.armX, MAN.armY, 0], 'torso', X),
    part('foreL', lL, [0.5, 9.5, 0.5], FORE_J, 'armL', X),
    part('armR', uR, [0.5, 18.5, 0.5], [-MAN.armX, MAN.armY, 0], 'torso', X),
    part('foreR', lR, [0.5, 9.5, 0.5], FORE_J, 'armR', X),
  ];
}
// a rider's upper body on the men's torso: the kilt below its top rows is cut
// away (the seat; the rider's legs are a part of the mount's rig)
function riderMan({ torso, ...o }) {
  torso.carve(-9, -14, -7, 18, 12, 14);
  return manParts({ torso, legs: false, ...o });
}
// a strap painted diagonally across the front of a torso (a quiver / baldric)
function eSash(m, color, x0 = -5, x1 = 4, y0 = 13, y1 = 3) {
  paint(m, (x, y, z) => {
    if (y > y0 || y < y1 || m.has(x, y, z + 1) || z < 1) return null;
    const xs = x0 + (x1 - x0) * (y0 - y) / (y0 - y1);
    return Math.abs(x + 0.5 - xs) < 0.9 ? color : null;
  });
  return m;
}
// the parts of a standing Egyptian man; s scales a rider (joints and voxels)
function manParts({ torso, head: hs, headScale = 0.9, headZ = MAN.headZ, pal = PAL_SKIN, arm = {}, armL = {}, armR = {}, leg = {}, s = 1,
  legs = true, torsoJoint = null, torsoParent = null, restL = null, restR = null, liftL = 0, liftR = 0 } = {}) {
  // (round 12) no baked corner AO on the men's bodies: on the rounded limb
  // sections it drew dark grooves down every arm and leg (a stick-built doll);
  // the scene's light shades the round forms instead
  const S = BODY_SCALE * s, X = { scale: S, jitter: 0.015, ao: false };   // flat tones: almost no per-voxel jitter
  const P = [];
  if (legs) {
    P.push(
      part('legL', manThighM({ pal, ...leg, side: 'L' }), LEG_PIVOT, sc([MAN.legX, MAN.hip, 0], s), null, X),
      part('shinL', manShinM({ pal, ...leg, side: 'L' }), LEG_PIVOT, sc([0, MAN.shin, 0], s), 'legL', X),
      part('legR', manThighM({ pal, ...leg, side: 'R' }), LEG_PIVOT, sc([-MAN.legX, MAN.hip, 0], s), null, X),
      part('shinR', manShinM({ pal, ...leg, side: 'R' }), LEG_PIVOT, sc([0, MAN.shin, 0], s), 'legR', X),
    );
  }
  P.push(part('torso', torso, [0, 0, 0], torsoJoint || sc([0, MAN.hip, 0], s), torsoParent, X));
  P.push(headPart(hs, sc([0, MAN.headY, headZ], s), 'torso', headScale * s));
  // (round 12) an arm with no baked bend is split at the elbow like the
  // archer's (splitArm: the upper arm and the forearm overlap two rows at a
  // rounded elbow, channels foreL / foreR), so a work or fighting pose can
  // bend it instead of swinging a stiff stick from the shoulder; gear held in
  // that hand is re-parented to the forearm by rig()
  for (const [sd, o, lift, rest] of [['L', armL, liftL, restL], ['R', armR, liftR, restR]]) {
    const a = manArmM({ pal, ...arm, ...o, side: sd });
    const sx = sd === 'L' ? MAN.armX : -MAN.armX, R = rest ? { rest } : {};
    if ({ ...arm, ...o }.bend) { P.push(part(`arm${sd}`, a, [0.5, 18.5, 0.5], sc([sx, MAN.armY + lift, 0], s), 'torso', { ...X, ...R })); continue; }
    const [up, lo] = splitArm(a, pal);
    P.push(part(`arm${sd}`, up, [0.5, 18.5, 0.5], sc([sx, MAN.armY + lift, 0], s), 'torso', { ...X, ...R }));
    P.push(part(`fore${sd}`, lo, [0.5, 9.5, 0.5], sc(FORE_J, s), `arm${sd}`, { ...X, forearm: true }));
  }
  return P;
}

// ---- hand-held gear (along +y, the grip at the origin) -------------------------
// the spear: a dark walnut shaft and a leaf-shaped iron-grey point, four
// voxels long over a dark socket: one wide at the base, three wide across
// the leaf's belly with bright honed edges, narrowing to a bright tip; a thin
// midrib front to back so the point reads edge-on too
function spearM(len = 26) {
  const m = new VoxelModel();
  const t = len - 9;
  m.box(0, -9, 0, 1, t + 9, 1, (x, y, z) => (y % 6 === 0 ? WOOD_DK : WOOD(x, y, z)));
  m.set(0, t, 0, BLADE_DK);                                         // the socket
  m.set(0, t + 1, 0, BLADE).set(-1, t + 1, 0, BLADE_DK).set(1, t + 1, 0, BLADE_DK);
  m.set(0, t + 2, 0, BLADE).set(-1, t + 2, 0, BLADE_EDGE).set(1, t + 2, 0, BLADE_EDGE);
  m.set(0, t + 3, 0, BLADE).set(-1, t + 3, 0, BLADE_EDGE).set(1, t + 3, 0, BLADE_EDGE);
  m.set(0, t + 4, 0, BLADE_EDGE).set(0, t + 5, 0, BLADE_EDGE);
  m.set(0, t + 2, 1, BLADE_DK).set(0, t + 2, -1, BLADE_DK).set(0, t + 3, 1, BLADE).set(0, t + 3, -1, BLADE);
  m.set(0, t - 1, 0, TEAM).set(0, t - 2, 0, TEAM);   // a team tassel under the blade
  m.box(0, -11, 0, 1, 2, 1, BLADE_DK);               // the butt spike
  return m;
}
// the epsilon axe: a long haft and a gold crescent blade held at two tangs
function epsilonAxeM() {
  const m = new VoxelModel();
  m.box(0, -6, 0, 1, 22, 1, (x, y, z) => (y % 5 === 0 ? WOOD_DK : WOOD(x, y, z)));
  for (let y = 9; y <= 16; y++) {
    const d = Math.abs(y - 12.5);
    const z1 = 5 - Math.round(d * d * 0.18);
    // (an orange-leaning gold: the plain GOLD turns olive in shade on a blade this big)
    for (let z = 1; z <= z1; z++) m.set(0, y, z, z === z1 ? 0xffd468 : (hash3(0, y, z, 83) < 0.5 ? 0xf2a428 : 0xe89a20));
  }
  m.carve(0, 11, 1, 1, 3, 2);           // the open eye between the tangs (the epsilon)
  m.set(0, 16, 0, GOLD_DK).set(0, 9, 0, GOLD_DK);
  return m;
}
// (round 23) the khopesh at half a rig voxel (part scale 0.5): about 60 % of
// the torso's length, a dark grip between a gold pommel and a gold guard, a
// straight dark-metal neck, then the sickle blade curving forward and down,
// its convex outer rim a bright 1-voxel cutting edge, its inner (back) rim a
// darker spine, so the weapon reads as metal against linen, bandages or skin.
// Two voxels thick; along +y from the fist (the part's rest swings it out).
function khopeshFine({ metal = 0x4a525c, edge = 0xf2f6fa, spine = 0x24282e, guard = GOLD } = {}) {
  const m = new VoxelModel();
  m.box(0, -4, 0, 2, 1, 2, guard);                         // pommel
  m.box(0, -3, 0, 2, 4, 2, LEATHER_DK);                    // grip (in the fist)
  m.box(-1, 1, -1, 4, 1, 4, guard);                        // guard
  m.box(0, 2, 0, 2, 4, 1, spine).box(0, 2, 1, 2, 4, 1, metal);   // the neck
  // the blade: an arc round (y 7, z 4.5), radius 4.6, from the neck over the top to the hooked tip
  const cy = 7, cz = 4.5, R = 4.6;
  for (let y = 4; y <= 13; y++) for (let z = -1; z <= 11; z++) {
    const dy = y + 0.5 - cy, dz = z + 0.5 - cz, d = Math.hypot(dy, dz);
    const a = Math.atan2(dy, dz);                           // 0 = forward, pi/2 = up, pi = back
    if (a < -0.55 || (a > 2.9 || a < -2.9)) continue;
    if (d < R - 2.1 || d > R + 0.55) continue;
    const c = d > R - 0.45 ? edge : d < R - 1.4 ? spine : metal;
    m.set(0, y, z, c).set(1, y, z, c);
  }
  return m;
}
// the camel rider's sword (round 9): one straight, solid metal-grey blade,
// 2 x 2 voxels and 11 long, a lighter honed edge row, a short point, over a
// gold guard and a dark grip in the fist (along +y; the part's rest tilts it
// forward and out from the body, so it stands clear of the rider and the neck)
function camelSwordM() {
  const m = new VoxelModel();
  m.box(0, -2, 0, 2, 3, 2, LEATHER_DK).box(0, -3, 0, 2, 1, 2, GOLD);
  m.box(-1, 1, -1, 4, 1, 4, GOLD);
  m.box(0, 2, 0, 2, 11, 2, 0x8a929a).box(0, 2, 1, 2, 11, 1, 0xb8c0c8);
  m.box(0, 13, 0, 2, 1, 2, 0xb8c0c8).set(0, 14, 1, 0xd0d6dc).set(1, 14, 1, 0xd0d6dc);
  return m;
}
function longBladeM(col = GOLD, len = 12) {
  const m = new VoxelModel();
  m.box(0, -2, 0, 1, 3, 1, LEATHER_DK).set(0, -3, 0, col).box(-1, 1, 0, 3, 1, 1, col).box(0, 1, -1, 1, 1, 3, col);
  m.box(0, 2, 0, 1, len, 1, col).box(0, 3, 1, 1, len - 3, 1, col).set(0, len + 2, 0, 0xfff0b0);
  return m;
}
// Egyptian shield: tall, round-topped, the face in the army's colour inside a gold rim
function egShieldM({ face = TEAM, rim = GOLD, boss = GOLD, bands = false, w = 3, h = 6 } = {}) {
  const m = new VoxelModel();
  for (let y = -h; y <= h - 1; y++) for (let x = -w; x <= w; x++) {
    const top = y > h - 1 - w;
    const cy = h - 1 - w;
    if (top && x * x + (y - cy) * (y - cy) > w * w + 0.6) continue;
    if (y === -h && Math.abs(x) === w) continue;
    const edge = Math.abs(x) === w || y === -h || (top && x * x + (y - cy) * (y - cy) > (w - 1) * (w - 1) + 0.6);
    let c = edge ? rim : face;
    if (!edge && bands && (y === 0 || y === -3 || y === 3)) c = rim;
    if (!edge && Math.abs(x) <= 0 && Math.abs(y - 1) <= 1) c = boss;
    m.set(x, y, 1, c);
    m.set(x, y, 0, edge ? GOLD_DK : (x === 0 ? LEATHER_DK : (hash3(x, y, 0, 81) < 0.3 ? 0x3a2a1e : 0xa08868)));   // a cowhide back
  }
  m.box(0, -1, -1, 1, 3, 1, LEATHER);
  return m;
}
function bowM() {
  const m = new VoxelModel();
  for (let y = -12; y <= 12; y++) {
    const z = Math.round(4 - (y * y) / 30 + (Math.abs(y) > 10 ? 1.2 : 0));
    const c = Math.abs(y) < 2 ? LEATHER : Math.abs(y) > 10 ? GOLD(0, y, 0) : WOOD_DK;
    m.set(0, y, z, c).set(1, y, z, c);
  }
  m.box(0, -11, 0, 1, 23, 1, 0xf1ead8);
  return m;
}
function arrowM() {
  const m = new VoxelModel();
  m.box(0, 0, -2, 1, 1, 14, WOOD).set(0, 0, 12, BLADE).set(0, 0, 13, BLADE_EDGE);
  m.box(0, 0, -3, 1, 1, 3, 0xf4f0e8).set(0, 1, -2, TEAM).set(0, -1, -2, TEAM);
  return m;
}
// a sling hanging from the fist (along -y), authored at half the rig voxel
// (part scale 0.5) so the cords can be thin: a team finger loop, two dark
// cords running close and spreading to a small leather cradle round a pale
// grey stone at the end, 12 rig voxels long (longer than the forearm): a
// cord and a stone, not a club
function slingM() {
  const m = new VoxelModel();
  const CORD = 0x4a2e18;
  m.box(-1, -2, -1, 2, 3, 2, TEAM);
  for (let y = -3; y >= -20; y--) { const o = y < -16 ? 1 : 0; m.set(-1 - o, y, 0, CORD).set(o, y, 0, CORD); }
  m.box(-2, -23, -1, 4, 1, 3, LEATHER).set(-3, -22, 0, LEATHER).set(2, -22, 0, LEATHER).set(-3, -21, 0, CORD).set(2, -21, 0, CORD);
  m.box(-2, -22, -1, 4, 2, 3, 0x8e8a82).box(-1, -21, 0, 2, 1, 1, 0xa8a49a);   // the grey stone
  return m;
}
// the priest's staff (round 10, unit_09), authored at half the rig voxel
// (part scale 0.5, pivot [1, 0, 1]: a 2 x 2 shaft centred on the fist):
// a dark shaft from the ground to above the head, topped by one clear ankh
// in a deep orange gold (the grade turns the light GOLD cream on a small
// emblem): a 12-wide crossbar with flared ends over a teardrop loop 8 wide
// and 14 tall whose 4-wide, 9-tall eye is cut right through, so the ground
// shows in the hole; a darker rim on the loop's outer edge keeps the shape
// against a white robe, no glow (glow washes it to cream)
const ANKH_G = pick3(84, 0x8c6c00, 0x846400, 0x947400);
const ANKH_L = 0xb89400, ANKH_D = 0x483000;
function ankhStaffM({ glow = 0 } = {}) {
  const m = new VoxelModel();
  const o = glow ? { glow } : undefined;
  for (let y = -29; y <= 26; y++) for (let x = 0; x <= 1; x++) for (let z = 0; z <= 1; z++)
    m.set(x, y, z, y >= 22 || (y + 40) % 14 === 0 || y <= -27 ? ANKH_G(x, y, z) : (x + z) % 2 ? WOOD_DK : 0x2a160a, o);
  // the crossbar, the arms flaring at the ends
  for (let x = -5; x <= 6; x++) {
    const e = x <= -4 || x >= 5;
    for (let y = e ? 26 : 27; y <= (e ? 30 : 29); y++) for (let z = 0; z <= 1; z++)
      m.set(x, y, z, x === -5 || x === 6 ? ANKH_D : y === (e ? 30 : 29) ? ANKH_L : ANKH_G(x, y, z), o);
  }
  // the loop: [outer half-width, eye half-width] per row from the crossbar up
  const ROWS = [[1, 0], [2, 0], [3, 0], [3, 1], [4, 2], [4, 2], [4, 2], [4, 2], [4, 2], [4, 2], [4, 2], [3, 1], [3, 0], [2, 0]];
  ROWS.forEach(([hw, eh], i) => {
    const y = 30 + i;
    for (let x = 1 - hw; x < 1 + hw; x++) {
      if (eh && x >= 1 - eh && x < 1 + eh) continue;     // the eye, cut through
      const rim = x === 1 - hw || x === hw;
      for (let z = 0; z <= 1; z++) m.set(x, y, z, rim && hw >= 3 ? ANKH_D : i >= 11 ? ANKH_L : ANKH_G(x, y, z), o);
    }
  });
  return m;
}
const ANKH_PIVOT = [1, 0, 1];
// the pharaoh's crook (round 13, unit_04), authored at half the rig voxel
// (part scale 0.5, pivot [1, 0, 1]: the 2 x 2 shaft centred in the fist): a
// long shaft banded gold and the army's colour three rows each, a gold butt
// below the fist and, at the top, a wide hook curling over and down (outer
// radius 5, a clear gap inside) with a gold tip: Retold's heqa sceptre, held
// overhead it reads as a crook, not a stick
function crookM() {
  const m = new VoxelModel();
  const S = (x, y, z) => (Math.floor((y + 30) / 3) & 1 ? PH_GOLD(x, y, z) : TEAM);
  for (let y = -7; y <= 30; y++) for (let x = 0; x <= 1; x++) for (let z = 0; z <= 1; z++)
    m.set(x, y, z, y <= -5 ? PH_GOLD_L : S(x, y, z));
  // the hook: a half ring of radius 4.5 centred above the shaft's top, opening
  // forward (+z) and down
  const cy = 30, cz = 5;
  for (let k = 0; k <= 20; k++) {
    const a = Math.PI * k / 20;                         // 0 = the shaft side, PI = the far side
    const y = Math.round(cy + Math.sin(a) * 4.5), z = Math.round(cz - Math.cos(a) * 4.5);
    for (const [dy, dz] of [[0, 0], [0, 1], [1, 0], [1, 1]]) for (let x = 0; x <= 1; x++) m.set(x, y + dy - (dy && Math.sin(a) > 0.7 ? 1 : 0), z + dz, S(x, y + dy, z + dz));
  }
  for (let y = cy - 3; y <= cy; y++) for (let x = 0; x <= 1; x++) for (let z = 9; z <= 10; z++) m.set(x, y, z, S(x, y, z));
  for (let x = 0; x <= 1; x++) m.set(x, cy - 4, 9, PH_GOLD_L).set(x, cy - 4, 10, PH_GOLD_L);
  return m;
}
// tools (built along +z like the Greek villager's)
function axeToolM() { return new VoxelModel().box(0, 0, -1, 1, 1, 10, WOOD).box(0, 0, 7, 1, 3, 2, BRONZE).box(0, -1, 8, 1, 5, 1, BRONZE); }
function pickToolM() { return new VoxelModel().box(0, 0, -1, 1, 1, 10, WOOD).box(0, -3, 8, 1, 7, 1, BRONZE).box(0, 0, 9, 1, 1, 1, BRONZE); }
function hammerToolM() { return new VoxelModel().box(0, 0, -1, 1, 1, 7, WOOD).box(-1, -1, 5, 3, 3, 2, STONE); }
function sickleToolM() {
  return new VoxelModel().box(0, 0, -1, 1, 1, 4, WOOD).line(0, 0, 3, 0, 2, 6, BRONZE).line(0, 2, 6, 0, 3, 8, BRONZE).line(0, 3, 8, 0, 1, 10, BRONZE);
}
function logsM() {
  const m = new VoxelModel();
  const BARK = pick3(9, 0x6b4428, 0x5a3820, 0x7a5030);
  for (const [x, y] of [[0, 0], [2, 0], [1, 2]]) m.box(x, y, 0, 2, 2, 12, BARK).box(x, y, 12, 2, 2, 1, 0xc9a26a).box(x, y, -1, 2, 2, 1, 0xc9a26a);
  return m;
}
// a pottery jar on the shoulder (food) / a basket of ore (gold)
function basketM(fill) {
  const m = new VoxelModel();
  const WICKER = (x, y, z) => ((x + y + z) % 2 ? 0xa57a3e : 0x8a6330);
  m.box(0, 0, 0, 6, 4, 4, WICKER).carve(1, 1, 1, 4, 3, 2);
  if (fill === 'gold') m.box(1, 3, 1, 4, 1, 2, GOLD, { glow: 0.12 }).box(2, 4, 1, 2, 1, 2, GOLD, { glow: 0.12 });
  else m.box(1, 3, 1, 4, 1, 2, 0xc0a040).box(2, 4, 1, 2, 1, 2, 0xd8b850).set(1, 4, 2, 0x5a8a2c);
  m.box(0, 4, 0, 1, 3, 1, LEATHER).box(5, 4, 0, 1, 3, 1, LEATHER);
  return m;
}

// ---- the archer's arms and bow (round 11) -----------------------------------------
// white linen for a kilt: warm, so the sky light keeps it linen-white, not grey
const KILT_LINEN = pick3(87, 0xfaf2e0, 0xf2e8d2, 0xfff8ea, 0.55, 0.85);
const KILT_LINEN_SH = 0xd6c8a8;
// arms split at the elbow (manArmM halves): the upper arm (shoulder to the
// elbow, y 9..18) and the forearm (y 0..10) overlapping at a rounded elbow
// (the forearm's top two rows sit inside the upper arm's bottom ones), so a
// bent arm (channels foreL / foreR) stays one closed limb; the forearm turns
// about the elbow's middle (pivot y 9.5)
const FORE_FIST = [0, -4.25, 0];
const FORE_J = [0, -4.5, 0];            // the elbow (arm joint -> forearm joint), rig voxels
function splitArm(a, pal) {
  const up = new VoxelModel(), lo = new VoxelModel();
  for (const [k, v] of a.vox) {
    const y = ((k >> 10) & 1023) - 512;
    if (y >= 9) up.vox.set(k, v);
    if (y <= 10) lo.vox.set(k, { ...v });
  }
  // the elbow knob behind the joint: closes the back of the bend
  for (const y of [9, 10]) if (!lo.has(0, y, -2)) lo.set(0, y, -2, pal.M);
  return [up, lo];
}
function archerArms(o = {}, pal = PAL_SKIN) {
  const X = { scale: BODY_SCALE, jitter: 0.015, ao: false };
  const out = [];
  for (const side of ['L', 'R']) {
    const [up, lo] = splitArm(manArmM({ pal, ...o, side }), pal);
    const sx = side === 'L' ? MAN.armX : -MAN.armX;
    out.push(part(`arm${side}`, up, [0.5, 18.5, 0.5], [sx, MAN.armY, 0], 'torso', X));
    out.push(part(`fore${side}`, lo, [0.5, 9.5, 0.5], [0, -4.5, 0], `arm${side}`, X));
  }
  return out;
}
// a recurved composite bow at half the rig voxel (part scale 0.5): limbs of
// honey-brown wood 2 x 2 thin, a dark leather grip at the fist, ivory horn
// tips curling forward, and a 1-voxel linen string; grip at the origin, the
// belly bowing forward (+z), the string behind it (z -5), along +y
const BOW_WOOD = pick3(88, 0x9a6232, 0x8c582c, 0xa66c38);
const BOW_WOOD_DK = 0x5e3618;
function recurveBowM() {
  const m = new VoxelModel();
  const H = 19;
  for (let y = -H; y <= H; y++) {
    const ay = Math.abs(y);
    let z = Math.round(-(y * y) / 72);                 // limbs sweeping back from the grip
    if (ay >= H - 3) z += ay - (H - 3);                // the tips recurve forward
    const c = ay <= 2 ? LEATHER_DK : ay >= H - 2 ? 0xf0e6cc : (ay & 3) === 0 ? BOW_WOOD_DK : BOW_WOOD(0, y, 0);
    m.set(0, y, z, c).set(1, y, z, c);
    if (ay <= 2) m.set(0, y, z + 1, LEATHER).set(1, y, z + 1, LEATHER);   // the grip wraps the belly
  }
  const zs = Math.round(-((H - 4) * (H - 4)) / 72);   // the string's nocks
  for (let y = -(H - 4); y <= H - 4; y++) m.set(0, y, zs - 1, 0xf2ead6);
  return m;
}

// ---- rigs --------------------------------------------------------------------
const RIGS = {};
function rig(type, meta, parts) {
  // (round 12) gear held in a hand whose arm is split at the elbow (manParts:
  // a part foreL / foreR flagged forearm) hangs from the forearm instead, at
  // the same place while the elbow is straight
  for (const p of parts) {
    if (p.name.startsWith('fore') || (p.parent !== 'armL' && p.parent !== 'armR')) continue;
    const f = parts.find((q) => q.forearm && q.parent === p.parent);
    if (!f) continue;
    p.parent = f.name;
    p.joint = p.joint.map((v, i) => v - f.joint[i]);
  }
  RIGS[type] = { ...meta, parts };
}
// scale a sub-rig's internal joints (a rider at another rig voxel size)
const sc = (j, s) => j.map((v) => v * s);

// Laborer (unit_11): bare chest, Retold's team-coloured wrap kilt flaring
// from a pale linen sash knotted at the front, close-cropped black hair.
{
  const t = manTorso();
  eKilt(t, { len: 6, hem: TM_DK, pleats: true });
  eBelt(t, LINEN, LINEN_SH);
  t.box(0, -5, 3, 1, 6, 1, LINEN).set(0, -6, 3, LINEN_SH);                   // the sash's end down the front
  const showTool = () => ({ conditional: true, portrait: false });
  rig('laborer', { voxel: 0.07, anim: 'human', style: 'villager', stance: true }, [
    ...manParts({ torso: t, head: 'laborer', leg: { sandal: null, kilt: TEAM } }),
    part('toolAxe', axeToolM(), [0, 0, 0], HAND_E, 'armR', showTool()),
    part('toolPick', pickToolM(), [0, 0, 0], HAND_E, 'armR', showTool()),
    part('toolSickle', sickleToolM(), [0, 0, 0], HAND_E, 'armR', showTool()),
    part('toolHammer', hammerToolM(), [0, 0, 0], HAND_E, 'armR', showTool()),
    part('carryWood', logsM(), [2, 0, 6], [-2.2, 7.4, 0], 'torso', showTool()),
    part('carryGold', basketM('gold'), [3, 0, 4], [0, 1, -2.2], 'torso', showTool()),
    part('carryFood', basketM('food'), [3, 0, 4], [0, 1, -2.2], 'torso', showTool()),
  ]);
}

// Spearman (unit_05): bare-chested under two silver straps from the shoulders
// to the belt, a shaved head with a side lock, a team kilt, team wrist bands,
// a long spear and a round-topped team shield.
{
  const t = manTorso();
  eKilt(t, { len: 6 });
  eBelt(t, LEATHER_DK, SILVER);
  eStraps(t, SILVER_DK, SILVER);
  rig('spearman', { voxel: 0.07, anim: 'human', style: 'spear', pose: 'spear', stance: true }, [
    ...manParts({ torso: t, head: 'spear', arm: { bracer: TEAM }, leg: { kilt: TEAM } }),
    part('weapon', spearM(28), [0, 0, 0], GRIP_E, 'armR'),
    part('shield', egShieldM({ face: TEAM, rim: SILVER, boss: SILVER }), [0, 0, 0], SHIELD_E, 'armL'),
  ]);
}

// Axeman (unit_02): a broad gold scale collar to mid-chest, team cap sleeves,
// a black-and-gold nemes, a team kilt with a pointed gold apron, the gold
// epsilon axe and a gold and team shield.
{
  const t = manTorso();
  eKilt(t, { len: 6, apron: 0xf2b830, apronEdge: GOLD_DK });
  eBelt(t, GOLD, GOLD_DK);
  const SC = 0xf2b830;   // an orange-leaning gold (plain GOLD goes olive in shade)
  eCollar(t, [GOLD_DK, SC, SC, GOLD_DK, SC, SC, GOLD_DK, SC], { r0: 2.4 });
  rig('axeman', { voxel: 0.07, anim: 'human', style: 'axe', pose: 'slash', stance: true }, [
    ...manParts({ torso: t, head: 'axe', arm: { sleeve: TEAM, bracer: GOLD }, leg: { kilt: TEAM } }),
    part('weapon', epsilonAxeM(), [0, 0, 0], GRIP_E, 'armR'),
    part('shield', egShieldM({ face: GOLD, rim: TEAM, boss: GOLD_DK, bands: true }), [0, 0, 0], SHIELD_E, 'armL'),
  ]);
}

// Slinger (unit_06): bare chest under a team broad collar with a white rim, a
// leopard-skin belt and front flap over a short team kilt, dark leather
// wrist guards, a bobbed wig and headband; the sling hangs from the fist,
// a dark cord to a leather pouch holding a grey stone.
{
  const t = manTorso();
  eKilt(t, { len: 6 });
  const LEO_C = 0xd8a24a, LEO_S = 0x3a2414;
  // (spots only in one staggered row along the belt: two spots over one on a
  // flap read as a face, so the flap is plain hide inside a dark edge)
  const LEO = (x, y, z) => (y === 2 && (x + 9) % 3 === 0 ? LEO_S : y === 3 && (x + 10) % 3 === 0 ? LEO_S : LEO_C);
  eBelt(t, LEO, null);
  for (let y = 1; y >= -5; y--) { const hw = y > -2 ? 2 : 3; for (let x = -hw; x < hw; x++) t.set(x, y, (1 - y) < 6 ? 3 : 4, y === -5 || x === -hw || x === hw - 1 ? LEO_S : LEO_C); }
  eCollar(t, [TM, TM, TM_SH, TM, TM, TEAM_TRIM], { r0: 2.6 });
  rig('slinger', { voxel: 0.07, anim: 'archer', style: 'sling', pose: 'sling', stance: true }, [
    ...manParts({ torso: t, head: 'sling', arm: { bracer: TEAM }, leg: { kilt: TEAM } }),
    part('weapon', slingM(), [0, 0, 0], HAND_E, 'armR', { scale: 0.5 }),
    part('pouch', new VoxelModel().box(0, 0, 0, 2, 2, 2, LEATHER).box(0, 2, 0, 2, 1, 2, TEAM), [1, 0, 1], [2.6, -1.6, -1], 'torso'),
  ]);
}

// Mercenary (unit_01): a Nubian spearman: dark skin, a gold collar, a team
// loincloth with a long front flap, a round team shield.
{
  const t = manTorso(PAL_DARK);
  eKilt(t, { len: 5, hem: null, apron: TEAM, apronEdge: TEAM_TRIM });
  eBelt(t, LEATHER_DK, GOLD);
  eCollar(t, [GOLD, GOLD, GOLD_DK, GOLD], { r0: 2.6 });
  const sh = new VoxelModel();
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const d = Math.hypot(x, y); if (d > 5.3) continue;
    sh.set(x, y, 1, d > 4.4 ? TEAM : d < 1.2 ? SILVER(x, y, 1) : (Math.abs(x) <= 1 ? TEAM_TRIM : TEAM));
    sh.set(x, y, 0, LEATHER_DK);
  }
  sh.box(0, -1, -1, 1, 3, 1, LEATHER);
  rig('mercenary', { voxel: 0.07, anim: 'human', style: 'spear', pose: 'spear', stance: true }, [
    ...manParts({ torso: t, head: 'merc', pal: PAL_DARK, arm: { band: TEAM, bracer: TEAM }, leg: { sandal: null, band: TEAM } }),
    part('weapon', spearM(24), [0, 0, 0], GRIP_E, 'armR'),
    part('shield', sh, [0, 0, 0], SHIELD_E, 'armL'),
  ]);
}

// Priest (unit_09): a white robe with short sleeves to the ankles, a dark
// zigzag collar edge, a gold sash with its long end down the front to a gold
// hem, gold armlets, a white headcloth with a sun disc, the ankh staff.
{
  const t = manTorso();
  // (round 13) three linen tones: RB lit fronts, RB_SH sides / folds, RB_DK
  // the deep creases (under the arms, the belt's shadow, inside the folds
  // nearest the hem), so the robe reads as hanging cloth, not a white block
  const RB = 0xf2ecdc, RB_SH = LINEN_SH, RB_DK = 0xa8987a;
  paint(t, (x, y, z) => (y <= 14 ? (z >= 2 && Math.abs(x + 0.5) < 5 ? RB : RB_SH) : null));
  paint(t, (x, y, z) => (y >= 13 && y <= 14 ? RB : null));
  // the flanks under the arms and the chest's underside
  paint(t, (x, y, z) => { const ax = Math.abs(x + 0.5); return y >= 5 && y <= 11 && ax >= 4.5 ? RB_DK : y >= 4 && y <= 11 && ax >= 3.5 && z >= 2 ? RB_SH : null; });
  // two folds drawn down from the collar to the sash, the cloth pulled by the shoulders
  paint(t, (x, y, z) => (y >= 4 && y <= 10 && z >= 2 && (x === -3 || x === 2) ? RB_SH : null));
  paint(t, (x, y, z) => (y >= 4 && y <= 6 && z >= 2 && Math.abs(x + 0.5) <= 2.5 ? RB_SH : null));   // the cloth bloused over the sash
  // the dark zigzag edge round the neck
  paint(t, (x, y, z) => { const a = Math.hypot(x + 0.5, (z + 0.5) * 1.25) + Math.max(0, 13.5 - (y + 0.5)); return y >= 11 && y <= 14 && a >= 3.4 && a < 4.4 && (x + y) % 2 ? 0x2a3a6a : null; });
  const LEN = 23;
  for (let i = 0; i <= LEN; i++) {
    const y = 1 - i;
    // (round 10) the robe gathers to the 8-wide waist under the sash and
    // flares over the hips to 16 at the hem: a waist, not a slab
    const w = i < 2 ? 8 : 2 * Math.round(Math.min(10 + (i - 2) * 0.5, 10 + (i - 2) * 6 / (LEN - 2)) / 2), z0 = -3 - Math.round(i * 1.5 / LEN), z1 = 2 + Math.round(i * 1.5 / LEN);
    // (round 13) the folds fanning out from the sash: an inner pair either side
    // of the sash's end and an outer pair over the thighs, each a shaded
    // crease with its deep core lower down
    const fi = 2 + Math.floor(i * 0.12), fo = 3 + Math.floor(i * 0.2);
    for (let x = -w / 2; x < w / 2; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === -w / 2 || x === w / 2 - 1;
      if (ex && (z === z0 || z === z1)) continue;
      let c = ex || z === z0 ? RB_SH : RB;
      if (z === z1) {
        if (x === -fi || x === fi + 1 || (i >= 6 && (x === -fo - 1 || x === fo + 1))) c = i >= 12 ? RB_DK : RB_SH;
        if (i >= 6 && (x === -fo || x === fo)) c = RB_SH;
      }
      if (ex && z === z1 - 1) c = RB_DK;                  // the sides turn away into shade
      if (ex && z === z0 + 1) c = RB_DK;
      if (i <= 1) c = i === 0 ? RB_DK : RB_SH;            // the belt's shadow under the sash
      if (i === LEN - 2) c = z === z1 || ex ? RB_SH : c;  // the cloth's shadow over the hem
      t.set(x, y, z, i >= LEN - 1 ? GOLD : c);
    }
    if (i < 2) for (const x of [-5, 4]) for (let z = -3; z <= 2; z++) t.remove(x, y, z);
    for (let x = 0; x <= 1; x++) t.set(x, y, z1 + 1, i === 0 ? GOLD_DK : x === 1 && i > 2 ? 0xc8a000 : GOLD);   // the sash's long end down the front, shaded on one edge
  }
  eBelt(t, GOLD, GOLD);
  // (round 10) not a T-pose: the staff arm's shoulder raised half a voxel and
  // its forearm bent forward to hold the staff out in front of the hip, the
  // free arm bent at the elbow with the fist at the waist
  // the legs are robed (linen to the ankle, bare feet), so a striding leg
  // that swings out of the rigid robe reads as cloth, not a bare plank
  const BR = 0.95, BL = 1.35;
  rig('priest', { voxel: 0.07, anim: 'human', style: 'priest', pose: 'staff', stance: 0.3, upright: true }, [
    ...manParts({ torso: t, head: 'priest', arm: { sleeve: RB, bracer: GOLD }, armL: { bend: BL }, armR: { bend: BR, grip: true }, leg: { sandal: null, pal: { L: RB, M: RB_SH, D: RB_SH }, foot: PAL_SKIN.M },
      liftR: 0.5, restL: [0, -0.75, 0.1], restR: [0, -0.35, -0.2] }),
    // the staff stands upright in the bent fist whatever the arm does (rig
    // "upright": unit_view.cpp gives the weapon the unit's orientation)
    // (round 13) through the fist: the fingers wrap the shaft (manArmM grip)
    part('weapon', ankhStaffM(), ANKH_PIVOT, gripBent(BR), 'armR', { scale: 0.5 }),
  ]);
}

// Pharaoh (unit_04), on the men's body (rig voxel 0.08): a narrow waist under a
// gold sash, a team chest under a gold corselet with a team V, squared gold
// shoulder pads standing out past the deltoids, a light gold collar ring round
// the neck, an A-line team skirt flaring to the ankles with a pleated gold
// apron down the front and a gold hem; a tan face with dark eyes and a braided
// beard under the tall team crown (head x 1.2). The crook arm is lifted up and
// out (part "rest") so the striped crook breaks the silhouette above the
// crown; the other fist is held clear of the body. Light yellow gold
// (PH_GOLD): the soldiers' GOLD reads olive on large faces under the grade.
{
  const PAL_PH = { L: 0xd08a58, M: 0xa86436, D: 0x7a4424 };
  const t = manTorso(PAL_PH);
  // the team under-robe over the chest, the gold corselet on its front with a team V
  paint(t, (x, y, z) => (y >= 4 && y <= 13 ? (z >= 2 ? TM : TM_SH) : null));
  paint(t, (x, y, z) => {
    if (y < 4 || y > 11 || z < 2) return null;
    const ax = Math.abs(x + 0.5);
    if (ax <= 0.5 || (ax <= 1.5 && y >= 9) || (ax <= 2.5 && y >= 11)) return TM;   // the V
    return PH_GOLD;
  });
  // squared gold shoulder pads over the deltoids, a team row of the collar
  for (const s of [-1, 1]) for (let x = 4; x <= 8; x++) for (let z = -3; z <= 2; z++) {
    const X = s > 0 ? x : -x - 1;
    t.set(X, 14, z, x === 8 && (z === -3 || z === 2) ? GOLD_DK : PH_GOLD).set(X, 13, z, PH_GOLD);
    if (x >= 7) { if (z === 2 || z === -3) tset(t, X, 12, z, 0xffffff); else t.set(X, 12, z, PH_GOLD); }
  }
  for (let x = -3; x <= 2; x++) for (let z = -3; z <= 2; z++) if (Math.abs(x + 0.5) > 1.5 || z < -2 || z > 1) t.set(x, 15, z, PH_GOLD_L);   // the collar ring
  // the A-line skirt: a shell from the sash flaring to the ankles
  const LEN = 23;
  for (let i = 0; i <= LEN; i++) {
    const y = 1 - i;
    const w = 2 * Math.round((10 + i * 8 / LEN) / 2), z0 = -3 - Math.round(i * 2 / LEN), z1 = 2 + Math.round(i * 2 / LEN);
    const aw = 1.5 + i * 0.12;
    for (let x = -w / 2; x < w / 2; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === -w / 2 || x === w / 2 - 1;
      if (ex && (z === z0 || z === z1)) continue;
      const ax = Math.abs(x + 0.5);
      if (i >= LEN - 1) t.set(x, y, z, PH_GOLD);                                     // the gold hem band
      else if (z === z1 && ax <= aw && i <= LEN - 3) t.set(x, y, z, ax > aw - 1 ? PH_GOLD_L : PH_GOLD);   // the gold apron
      else tset(t, x, y, z, ex || z === z0 || (z === z1 && ax > aw + 2) ? TEAM_SHADE : 0xffffff);
    }
  }
  eBelt(t, PH_GOLD, PH_GOLD_L);
  rig('pharaoh', { voxel: 0.08, anim: 'human', style: 'pharaoh', pose: 'staff', stance: 0.3 }, [
    ...manParts({ torso: t, head: 'pharaoh', headScale: 1.1, pal: PAL_PH, arm: { bracer: TEAM, band: PH_GOLD_L }, armR: { grip: true }, leg: { sandal: SANDAL },
      restL: [-0.35, 0, 0.42], restR: [-0.25, 0, -2.25] }),
    // (round 13) the crook through the raised fist (the fingers round the
    // shaft), laid across over the crown with the hook out past his left
    // shoulder, as Retold's Pharaoh holds it (unit_04)
    part('weapon', crookM(), [1, 0, 1], GRIP_C, 'armR', { scale: 0.5, rest: [0, 0, 0.95] }),
  ]);
}

// ---- horses, camels, elephants ---------------------------------------------------
const WHITE_COAT = pick3(12, 0xeceae4, 0xdcd8d0, 0xc8c4bc, 0.55, 0.85);
// (round 14) the chariot horse's blanket in Retold's warm stripes (deep red,
// ochre, a cream stripe, a dark leather and ochre fringe) instead of blue and
// white, so the white horse's head and neck read apart from the cloth
const BLANKET_RED = 0x8e2a1c, BLANKET_CREAM = 0xe8d2a0;
const DARK_COAT = pick3(14, 0x4a4648, 0x3c383a, 0x56504e, 0.55, 0.85);
const HOOF = 0x2e2621;
function horseBody(C) {
  const m = new VoxelModel();
  m.ellipsoid(3, 4.5, 10.5, 3.3, 4.6, 9.8, C);
  m.ellipsoid(3, 5, 3.5, 3.5, 4.6, 4, C);
  m.ellipsoid(3, 4, 17.5, 3.1, 4.4, 3.8, C);
  m.ellipsoid(3, 7.5, 2.5, 2.4, 1.5, 3, C);
  m.box(1, 1, 1, 5, 4, 4, C).box(1, 0, 16, 5, 4, 4, C);
  // a tucked-up belly between the fore and hind legs (daylight under it)
  for (let z = 7; z < 15; z++) m.carve(0, -2, z, 7, 3 + (z > 8 && z < 13 ? 1 : 0), 1);
  return m;
}
function horseNeck(C, MANE, { bridle = TEAM, collar: col = null, thick = false } = {}) {
  const m = new VoxelModel();
  // an arched neck carried high (the crest up to y 13), the head out in
  // front of the chest at ~40 degrees, clear of the forelegs; "thick": a
  // neck 5 wide at the base, 4 up the middle (so a horse seen from behind
  // shows a neck, not a pole)
  const pts = [[0, 1.5, 3.2], [4, 2.4, 2.8], [8.5, 3.6, 2.3], [12.5, 5.2, 1.9]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, w] = thick ? (i === 0 ? [-1, 5] : i === 1 ? [-1, 5] : [0, 3]) : [0, 3];
    capsuleYZ(m, x0, w, pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], C);
  }
  capsuleYZ(m, 0, 3, 13, 6, 2.2, 10, 11.5, 1.5, C);
  capsuleYZ(m, 0, 3, 12, 7, 1.6, 10.5, 8.8, 1.6, C);
  capsuleYZ(m, 0, 3, 10, 11.5, 1.5, 9.6, 12.4, 1.2, 0x6f675f);
  m.set(0, 9, 12, DARK).set(2, 9, 12, DARK).set(-1, 12, 7, DARK).set(3, 12, 7, DARK);
  m.set(0, 15, 5, C).set(0, 16, 5, C).set(2, 15, 5, C).set(2, 16, 5, C);
  if (thick) m.set(-1, 15, 5, C).set(-1, 16, 4, 0x8a847c).set(3, 15, 5, C).set(3, 16, 4, 0x8a847c).set(1, 14, 3, MANE).set(1, 14, 4, MANE);   // pricked ears splayed (a Y seen from behind), a forelock
  for (let y = 1; y <= 14; y++) {
    let z = -8;
    while (z < 12 && !m.has(1, y, z)) z++;
    if (z >= 12) continue;
    if (thick) m.set(1, y, z - 1, MANE).set(2, y, z - 1, MANE).set(3, y, z, MANE).set(3, y, z + 1, MANE);   // the mane falls to the off side
    else m.set(1, y, z - 1, MANE).set(1, y, z, MANE);
  }
  m.line(-1, 13, 6, -1, 10, 10, bridle).line(3, 13, 6, 3, 10, 10, bridle).box(0, 14, 6, 3, 1, 1, bridle).box(-1, 10, 11, 5, 1, 1, bridle);
  m.set(-1, 11, 9, GOLD(1, 1, 1)).set(3, 11, 9, GOLD(2, 1, 1));
  if (col) for (let y = 1; y <= 4; y++) for (let z = -2; z <= 8; z++) for (let x = -1; x <= 3; x++) {
    if (!m.has(x, y, z)) continue;
    if (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1)) m.set(x, y, z, y === 4 ? GOLD : col);
  }
  return m;
}
function horseUpper(C, hind) {
  const m = new VoxelModel().box(0, 0, 0, 2, 5, hind ? 3 : 2, C).box(0, 3, 0, 2, 2, hind ? 4 : 3, C);
  if (hind) m.box(0, 2, -1, 2, 3, 1, C);
  return m;
}
function horseLower(C, sock = 0xf2eee6) { return new VoxelModel().box(0, 2, 0, 2, 5, 2, C).box(0, 1, 0, 2, 1, 2, sock).box(0, 0, 0, 2, 1, 3, HOOF); }
function horseTail(MANE) { return new VoxelModel().box(0, -1, -1, 2, 2, 2, MANE).box(0, -4, -2, 2, 3, 2, MANE).box(0, -8, -3, 2, 4, 2, MANE).box(0, -10, -3, 2, 2, 1, MANE); }
// a striped blanket over the back (team, white and gold stripes) with a hem
function stripedBlanket({ z0 = 7, z1 = 14, low = 4, top = 9, colors = [TEAM, TEAM_TRIM, OCHRE, TEAM_TRIM], spine = null, hem = null } = {}) {
  const m = new VoxelModel();
  for (let z = z0; z <= z1; z++) {
    const lo = z === z0 || z === z1 ? low + 2 : low;
    for (let y = lo; y <= top; y++) {
      const c = colors[(top - y) % colors.length];
      m.set(-1, y, z, c).set(7, y, z, c);
    }
    m.box(0, top + 1, z, 7, 1, 1, colors[0]);
    if (spine) m.box(2, top + 1, z, 3, 1, 1, spine).set(3, top + 1, z, colors[0]);   // a two-stripe spine down the back
    const hc = hem ? hem[z & 1] : RED;                                                  // the hem (two-tone: a fringe)
    m.set(-1, lo - 1, z, hc).set(7, lo - 1, z, hc);
    if (hem && !(z & 1) && z !== z0 && z !== z1) m.set(-1, lo - 2, z, hem[0]).set(7, lo - 2, z, hem[0]);
  }
  return m;
}
function horseLegs(C, { sock, gaitLong = 1 } = {}) {
  const coat = { coat: true };
  return [
    part('legFL', horseUpper(C, false), [1, 5, 1], [2, 1, 7], 'body', coat),
    part('cannonFL', horseLower(C, sock), [1, 7, 1], [0, -4, 0], 'legFL', coat),
    part('legFR', horseUpper(C, false), [1, 5, 1], [-2, 1, 7], 'body', coat),
    part('cannonFR', horseLower(C, sock), [1, 7, 1], [0, -4, 0], 'legFR', coat),
    part('legBL', horseUpper(C, true), [1, 5, 1.5], [2, 1, -6.5], 'body', coat),
    part('cannonBL', horseLower(C, sock), [1, 7, 1], [0, -4, 0], 'legBL', coat),
    part('legBR', horseUpper(C, true), [1, 5, 1.5], [-2, 1, -6.5], 'body', coat),
    part('cannonBR', horseLower(C, sock), [1, 7, 1], [0, -4, 0], 'legBR', coat),
  ];
}
// rider legs over a saddle: thighs on the back at height y, shins down the flanks
function riderLegsM({ y = 11, x0 = -2, x1 = 7, skin = SKIN, kiltC = TEAM, len = 6, z = 9, sandal = true } = {}) {
  const m = new VoxelModel();
  for (const x of [x0, x1]) {
    const o = x < 3 ? -1 : 1;
    m.box(x, y, z, 2, 2, 5, skin).box(x, y + 1, z, 2, 1, 3, kiltC);
    m.box(x + o, y - len, z + 3, 2, len, 2, skin);
    m.box(x + o, y - len - 1, z + 3, 2, 1, 3, sandal ? SANDAL : skin);
  }
  return m;
}

// Chariot Archer (unit_03): a white horse in a striped blanket and a team
// collar, hitched by two shafts and a yoke on its withers to an Egyptian
// chariot: a D-shaped car open at the back, its breastwork painted in the
// army's colour inside gold rims and struts (a gold sun disc on the front),
// standing on two big six-spoke wheels at the rear axle (the wheel as tall
// as the archer's waist above the floor). The archer: bronze, bare-chested
// under a gold and team broad collar, a white kilt, a quiver on his back, a
// striped helmet over a face with dark eyes, a short recurved bow held canted
// away from the head. The horse stands mid-stride, a foreleg lifted and the
// head high (pose "chariot", unit_view.cpp).
// Chariot space: the floor at y 0 (6 voxels off the ground at the axle), +z
// forward; the horse's withers at about (y 12.5, z 27), its chest at z 32.
{
  const C = WHITE_COAT, MANE = pick3(13, 0x6e6862, 0x5e5852, 0x7c766e);   // a dark grey mane on the white horse
  const car = new VoxelModel();
  const zf = (x) => 4 - Math.round((x * x) / 9);          // the D's rounded front, flat open back at z -4
  const top = (z) => (z >= 0 ? 9 : 9 - Math.round(-z * 0.6));   // the sides sweep down towards the back
  for (let x = -5; x <= 5; x++) for (let z = -4; z <= zf(x); z++) car.set(x, 0, z, (x + z) & 1 ? WOOD_DK : LEATHER_DK);
  const inD = (x, z) => Math.abs(x) <= 5 && z >= -4 && z <= zf(x);
  for (let x = -5; x <= 5; x++) for (let z = -4; z <= zf(x); z++) {
    if (inD(x + 1, z) && inD(x - 1, z) && inD(x, z + 1)) continue;   // walls on the D's rim; the back stays open
    const h = top(z);
    for (let y = 1; y <= h; y++) {
      let c;
      if (y === h) c = GOLD(x, y, z);                                     // the gold rim
      else if (y === 1) c = GOLD_DK;                                      // a dark gold foot band
      else if ((Math.abs(x) === 5 && (z === 2 || z === -2)) || (z === zf(x) && (x === -3 || x === 3))) c = GOLD(x, y, z);   // gold struts
      else c = TEAM;
      if (c === TEAM && y === h - 1) tset(car, x, y, z, TEAM_SHADE); else car.set(x, y, z, c);
    }
  }
  // a gold sun disc on the breastwork, the rear grab posts
  for (let x = -1; x <= 1; x++) for (let y = 3; y <= 5; y++) if (x * x + (y - 4) * (y - 4) <= 1) car.set(x, y, zf(x) + 1, GOLD(x, y, 9), { glow: 0.1 });
  car.set(0, 4, zf(0) + 1, 0xf0d040, { glow: 0.2 });
  for (const x of [-5, 5]) car.box(x, top(-4) + 1, -4, 1, 2, 1, GOLD).set(x - Math.sign(x), top(-4) + 2, -4, GOLD(x, 0, 0));
  // the axle (the car rides on it at the back), the hub stubs
  car.box(-8, -1, -3, 17, 1, 1, SILVER_DK);
  // two shafts (2 x 2) from under the car along the horse's flanks, up to the
  // yoke saddle at its shoulders; the yoke across the withers, a breast strap
  for (const s of [-1, 1]) {
    const xs = s < 0 ? -6 : 5;
    for (let z = -2; z <= 27; z++) {
      const y = z < 4 ? -2 : -2 + Math.round((z - 4) * 0.42);
      car.box(xs, y, z, 2, 2, 1, (z & 3) === 0 && z > 4 ? WOOD_DK : WOOD(xs, y, z));
    }
    car.box(xs, 7, 26, 2, 5, 1, LEATHER_DK);                          // the yoke saddle down the shoulder
    // the breast strap round the chest, team with gold studs
    for (let z = 27; z <= 32; z++) car.set(s < 0 ? -5 : 5, 8 - Math.round((z - 27) * 0.3), z, TEAM);
    car.set(s < 0 ? -5 : 5, 7, 29, GOLD(0, 7, 29));
  }
  for (let x = -4; x <= 4; x++) { car.set(x, 6, 33, TEAM); if (!(x & 1)) car.set(x, 5, 33, GOLD(x, 5, 33)); }
  car.box(-6, 12, 25, 13, 2, 2, WOOD_DK);                              // the yoke on the withers
  car.box(-7, 12, 25, 1, 2, 2, GOLD).box(7, 12, 25, 1, 2, 2, GOLD).set(0, 14, 26, GOLD(3, 1, 1));
  // wheels: six spokes, a dark felloe 2 wide, a silver hub standing out
  const wheel = new VoxelModel();
  const R = 5.8, SPOKE = 0xc09458;   // light ash spokes against the dark felloe
  for (let y = -7; y <= 7; y++) for (let z = -7; z <= 7; z++) {
    const d = Math.hypot(y, z);
    if (d > R) continue;
    if (d > R - 1.3) { wheel.set(0, y, z, (Math.round(Math.atan2(y, z) * 4) & 1) ? WOOD_DK : LEATHER_DK).set(1, y, z, WOOD_DK); continue; }
    if (d < 1.5) { wheel.box(-1, y, z, 4, 1, 1, SILVER(0, y, z)); continue; }
    const a = Math.atan2(y, z);
    const k = Math.round(a / (Math.PI / 3)) * (Math.PI / 3);
    const off = Math.abs(Math.sin(a - k)) * d;
    if (off < 0.62) wheel.set(0, y, z, SPOKE).set(1, y, z, SPOKE);
  }
  wheel.set(-2, 0, 0, SILVER_DK).set(3, 0, 0, SILVER_DK);
  // the archer (round 11): one joined body, not loose blocks. Bronze skin,
  // a single wesekh band lying flush on the chest (gold, lapis, gold), a
  // white linen kilt, a dark leather quiver strap; the arms split at the elbow
  // (archerArms: upper arm and forearm overlapping at a rounded elbow, the
  // shoulder head sunk a voxel into the deltoid) so the bow arm bends and the
  // right hand rests on the string at a bent elbow (pose "chariot",
  // unit_view.cpp archer_upper)
  const t = manTorso();
  eKilt(t, { color: KILT_LINEN, side: KILT_LINEN_SH, hem: KILT_LINEN_SH, len: 6, fold: true });
  eBelt(t, TEAM, GOLD);
  eCollar(t, [ANKH_L, TM, ANKH_L], { r0: 2.4 });
  t.box(2, 3, -6, 3, 11, 2, LEATHER).box(2, 3, -6, 3, 1, 2, LEATHER_DK).box(2, 13, -6, 3, 1, 2, LEATHER_DK);   // the quiver on the back
  for (const x of [2, 4]) t.set(x, 14, -6, 0xf4f0e8).set(x, 15, -5, 0xf4f0e8);
  const standLegs = new VoxelModel();
  for (const x of [-2, 1]) standLegs.box(x, 0, -1, 2, 14, 2, SKIN_FRONT).box(x, 0, -1, 2, 1, 3, SANDAL).box(x, 10, -1, 2, 4, 2, KILT_LINEN);
  const rider = riderMan({ torso: t, torsoJoint: [0, 14.5, -1], torsoParent: 'chariot', head: 'charioteer', headScale: 1.0 })
    .filter((p) => !/^(arm|fore)[LR]$/.test(p.name));
  rig('chariot_archer', { voxel: 0.07, anim: 'centaur', style: 'chariot', pose: 'chariot', graze: false }, [
    part('body', horseBody(C), [3, 0, 10.5], [0, 10, 12], null, { coat: true }),
    part('barding', stripedBlanket({ z0: 7, z1: 14, low: 5, top: 9, colors: [BLANKET_RED, OCHRE, BLANKET_RED, BLANKET_CREAM], spine: OCHRE, hem: [LEATHER_DK, OCHRE] }), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('neck', horseNeck(C, MANE, { collar: TEAM, thick: true, bridle: LEATHER_DK }), [1.5, 0, 2], [0, 5.5, 8], 'body', { coat: true }),
    part('tail', horseTail(MANE), [1, 0, 0], [0, 7, -10], 'body', { coat: true }),
    ...horseLegs(C, {}),
    part('chariot', car, [0, 0, 0], [0, -3.8, -22], 'body'),
    part('wheelL', wheel, [1, 0.5, 0.5], [7.5, -0.5, -2.5], 'chariot', { anim: 'wheel' }),
    part('wheelR', wheel, [1, 0.5, 0.5], [-6.5, -0.5, -2.5], 'chariot', { anim: 'wheel' }),
    part('riderLegs', standLegs, [0, 0, 0], [0, 1, -1], 'chariot'),
    ...rider,
    ...archerArms({ band: TEAM, bracer: LEATHER }),
    part('weapon', recurveBowM(), [0.5, 0, 0], FORE_FIST, 'foreL', { scale: 0.5, jitter: 0.015 }),
    part('arrow', arrowM(), [0, 0, 0], FORE_FIST, 'foreR', { conditional: true, portrait: false }),
  ]);
}

// Camel Rider (rig voxel 0.09, the rider at 0.065 / 0.09):
// a dromedary in its own sandy-brown hide (a lighter belly and legs, a dark
// muzzle), one high hump under a narrow white saddle cloth with a team
// border, a gold trim and a two-tone fringe, a long S-curved neck that dips from the chest and
// rises high above the rider's knees to a small head with a narrow muzzle,
// long thin legs with knobby knees and broad pads, a team scarf at the throat.
// The rider: bronze skin over the white cloth, a team tunic and kilt, a gold
// collar, a striped linen-and-team nemes, and a long hooked khopesh-sword
// held out from his side.
{
  const HIDE = pick3(15, 0x9a7048, 0x8c6440, 0xa67a50, 0.5, 0.85);
  const BELLY = pick3(17, 0xc9a67a, 0xbf9c70, 0xd2b084, 0.5, 0.85);
  const MUZZLE = 0x7a5636, KNEE = 0x6e4e34, PAD = 0x3e2c20;
  const HC = (x, y, z) => (y <= 2 ? BELLY(x, y, z) : HIDE(x, y, z));
  const body = new VoxelModel();
  body.ellipsoid(4, 4.5, 10, 3.8, 3.9, 7.5, HC);      // the barrel
  body.ellipsoid(4, 4, 15.5, 3.5, 4.4, 3.2, HC);      // the deep chest (brisket)
  body.ellipsoid(4, 4.8, 4, 3.5, 3.6, 3.4, HC);       // the narrow rump
  body.ellipsoid(4, 9.5, 10.5, 2.9, 4.4, 4.2, HIDE);  // the single high hump
  for (let z = 7; z < 13; z++) body.carve(0, -2, z, 9, 2 + (z > 8 && z < 11 ? 1 : 0), 1);   // the belly line
  // the saddle cloth (round 14, unit_08): a narrow linen cloth laid over the
  // hump, not a slab. It follows the hump and the barrel one voxel proud (so
  // the hump keeps its dome and the cloth reads as draped), spans only the
  // seat (z 8..13: the hump's tan fore and aft slopes and the whole rump,
  // shoulders and lower flanks stay bare) and stops at mid-barrel, well above
  // the elbows. From the top down: a white linen field (lit on top, a shade
  // step on the flanks), two rows of the army's colour, one gold trim row,
  // and a two-tone fringe (red / ochre, tassels on every other column)
  const cloth = new VoxelModel();
  const CZ0 = 6, CZ1 = 15, TRIM_Y = 5, CLOTH_TOP = 0xf6f2e6, CLOTH_SIDE = 0xe4dcc6, CLOTH_SH = 0xccc2a8;
  const clothC = (y, z, top) => {
    if (y <= TRIM_Y - 1) return (z & 1) ? RED : OCHRE;          // the fringe
    if (y === TRIM_Y) return GOLD;                              // the gold trim band
    if (y <= TRIM_Y + 2) return TEAM;                           // the team border
    return top ? CLOTH_TOP : y === TRIM_Y + 3 ? CLOTH_SH : CLOTH_SIDE;   // the linen field, shaded towards the hem
  };
  // the drape narrows towards the top (a trapezoid seen from the side): the
  // hem spans z 6..15, the field over the hump only the seat (z 8..13)
  const zIn = (y, z) => { const k = y >= 12 ? 2 : y >= 10 ? 1 : 0; return z >= CZ0 + k && z <= CZ1 - k; };
  for (let z = CZ0; z <= CZ1; z++) for (let x = 0; x <= 8; x++) {
    let top = -1;
    for (let y = 16; y >= 0; y--) if (body.has(x, y, z)) { top = y; break; }
    if (top < TRIM_Y + 3 || !zIn(top + 1, z)) continue;
    cloth.set(x, top + 1, z, clothC(top + 1, z, true));
  }
  for (let z = CZ0; z <= CZ1; z++) for (let y = TRIM_Y - 1; y <= 15; y++) {
    if (!zIn(y, z)) continue;
    let lo = 99, hi = -99;
    for (let x = -1; x <= 9; x++) if (body.has(x, y, z)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    if (hi < lo) continue;
    // one voxel proud of the hide, the hem (trim and fringe) flaring out a second
    const out = y <= TRIM_Y ? 2 : 1;
    for (const [x0, sg] of [[lo, -1], [hi, 1]]) for (let o = 1; o <= out; o++) if (!cloth.has(x0 + sg * o, y, z)) cloth.set(x0 + sg * o, y, z, clothC(y, z, false));
  }
  // the drape's front and back edges in the team colour, tassels hanging from
  // the fringe on every other column
  for (const k of [...cloth.vox.keys()]) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    if (y > TRIM_Y + 2 && !zIn(y, z - 1) !== !zIn(y, z + 1) && (x < 3 || x > 5)) cloth.set(x, y, z, TEAM);
  }
  for (let z = CZ0; z <= CZ1; z += 2) for (let x = -3; x <= 11; x++) if (cloth.has(x, TRIM_Y - 1, z) && (x < 1 || x > 7)) cloth.set(x, TRIM_Y - 2, z, z % 4 === 1 ? RED : OCHRE);
  // the rider's legs (a separate part, so they carry their own outline): each
  // a bent two-segment limb in half voxels of the camel, the white-kilted
  // thigh running out and forward over the cloth from the hip, a knee, and
  // the bare shin hanging down and a little back along the camel's flank,
  // clear of the cloth, a darker foot turned forward at the ankle
  const legs = new VoxelModel();
  const LEG_L = 0xb06a3a, LEG_M = 0x8c4c26, FOOT = 0x4a2a14;
  const H = (v) => v.map((c) => c * 2);
  const skin = (x, y, z) => (legs.has(x, y + 1, z) ? LEG_M : LEG_L);
  for (const s of [-1, 1]) {
    const hip = [4 + s * 1.7, 15.2, 10.0], knee = [4 + s * 4.6, 12.6, 12.9], ankle = [4 + s * 6.4, 3.6, 12.0], toe = [4 + s * 6.5, 3.0, 13.4];
    tube(legs, H(hip), H(knee), 1.9, 1.6, (x, y, z, t) => (t < 0.35 ? TEAM : LEG_M));   // the team kilt over the upper thigh (against the white cloth)
    tube(legs, H(knee), H(ankle), 1.55, 1.2, LEG_M);
    tube(legs, H(ankle), H(toe), 1.1, 1.0, FOOT);
  }
  for (const [k, v] of legs.vox) if (v.c === LEG_M) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    v.c = skin(x, y, z);
  }
  // the neck: an S-curve dipping forward from the chest, then rising high
  const neck = new VoxelModel();
  const NP = [[1, 0, 2.6], [-0.3, 3.6, 2.1], [2.2, 7.0, 1.8], [8, 9.0, 1.6], [14, 9.0, 1.6]];
  for (let i = 0; i < NP.length - 1; i++) capsuleYZ(neck, 0, 3, NP[i][0], NP[i][1], NP[i][2], NP[i + 1][0], NP[i + 1][1], NP[i + 1][2], HIDE);
  for (let y = -2; y <= 10; y++) for (let z = 0; z <= 12; z++) if (neck.has(1, y, z) && !neck.has(1, y - 1, z) && y < 6) neck.set(1, y, z, BELLY(1, y, z));
  // the small head held level, the narrow muzzle and the drooping lip
  capsuleYZ(neck, 0, 3, 14.7, 8.4, 1.9, 14.5, 11.8, 1.5, HIDE);
  capsuleYZ(neck, 0, 3, 14.3, 11.8, 1.25, 13.6, 14.8, 1.0, MUZZLE);
  neck.set(1, 12, 14, MUZZLE).set(1, 12, 13, MUZZLE);
  neck.set(0, 16, 8, HIDE).set(0, 17, 8, KNEE).set(2, 16, 8, HIDE).set(2, 17, 8, KNEE);   // small ears
  for (const x of [0, 2]) if (neck.has(x, 15, 10)) neck.set(x, 15, 10, DARK);
  neck.set(1, 13, 15, DARK);
  // halter and the team scarf at the throat with a hanging end
  for (let y = 11; y <= 17; y++) for (let x = 0; x <= 2; x++) { if (neck.has(x, y, 12)) neck.set(x, y, 12, LEATHER_DK); if (neck.has(x, y, 9) && y >= 15) neck.set(x, y, 9, LEATHER_DK); }
  neck.set(1, 12, 15, 0x3a2a1e);
  for (let y = -1; y <= 3; y++) for (let z = 0; z <= 5; z++) for (let x = -1; x <= 3; x++) {
    if (!neck.has(x, y, z) || (neck.has(x + 1, y, z) && neck.has(x - 1, y, z) && neck.has(x, y + 1, z) && neck.has(x, y, z + 1) && neck.has(x, y, z - 1))) continue;
    if (y >= 2) neck.set(x, y, z, TEAM); else if (y === 1) neck.set(x, y, z, GOLD);   // (round 14) a narrow scarf band over a gold edge, not a blue sleeve
  }
  neck.box(-1, 1, 4, 1, 2, 2, TEAM).box(-1, -3, 4, 1, 4, 1, TEAM).set(-1, -4, 4, TEAM_TRIM);
  // long thin legs: a thick forearm / thigh, a knobby knee, a slim cannon, a broad pad
  const up = (hind) => {
    const m = new VoxelModel().box(0, 1, 0, 2, 7, 2, HIDE).box(0, 5, hind ? -1 : 0, 2, 3, 3, HIDE);
    m.box(0, 0, hind ? -1 : 0, 2, 2, 3, KNEE);     // the knee (front) / hock (hind) knob
    return m;
  };
  const low = () => new VoxelModel().box(0, 2, 0, 2, 7, 2, BELLY).box(0, 1, 0, 2, 1, 2, KNEE).box(0, 0, -1, 2, 1, 4, PAD);
  const coat = { coat: true };
  const R = 0.065 / 0.09;   // the rider a touch under the foot soldiers' size: the camel dominates
  const t = manTorso();
  // the rider reads apart from the blue cloth by a value step: a flat white
  // kilt and the seat under a dark leather corslet and belt, the team tunic
  // only on the shoulders and sleeves above it
  eKilt(t, { color: 0xf2ecdc, side: LINEN_SH, hem: LINEN_SH, len: 6, fold: false });
  paint(t, (x, y, z) => (y >= 2 && y <= 13 ? (z >= 2 && Math.abs(x + 0.5) < 5 ? TM : TM_SH) : null));   // the team tunic
  paint(t, (x, y, z) => (y >= 2 && y <= 9 ? (Math.abs(x + 0.5) < 5 ? LEATHER : LEATHER_DK) : null));   // the leather corslet all round
  eCollar(t, [GOLD, GOLD, TEAM_TRIM, TEAM_TRIM, GOLD], { r0: 2.6 });
  eBelt(t, LEATHER_DK, GOLD);
  rig('camel_rider', { voxel: 0.09, anim: 'horse', style: 'camel', pose: 'mount', gait: 0.75, stride: 0.9, graze: false }, [
    part('body', body, [4, 0, 10], [0, 14, 0.5], null, coat),
    part('barding', cloth, [4, 0, 10], [0, 0, 0], 'body', { jitter: 0.015 }),
    part('riderLegs', legs, [8, 0, 20], [0, 0, 0], 'body', { scale: 0.5, jitter: 0.015 }),
    part('neck', neck, [1.5, 0, 1], [0, 5.5, 7.6], 'body', coat),
    part('tail', new VoxelModel().box(0, -6, -1, 1, 6, 1, HIDE).box(0, -9, -1, 1, 3, 1, HAIR), [0.5, 0, 0], [0, 7, -9], 'body', coat),
    part('legFL', up(false), [1, 8, 1], [2.5, 2, 5.5], 'body', coat),
    part('cannonFL', low(), [1, 9, 1], [0, -7, 0], 'legFL', coat),
    part('legFR', up(false), [1, 8, 1], [-2.5, 2, 5.5], 'body', coat),
    part('cannonFR', low(), [1, 9, 1], [0, -7, 0], 'legFR', coat),
    part('legBL', up(true), [1, 8, 1], [2.5, 2, -5.5], 'body', coat),
    part('cannonBL', low(), [1, 9, 1], [0, -7, 0], 'legBL', coat),
    part('legBR', up(true), [1, 8, 1], [-2.5, 2, -5.5], 'body', coat),
    part('cannonBR', low(), [1, 9, 1], [0, -7, 0], 'legBR', coat),
    ...riderMan({ torso: t, s: R, torsoJoint: [0, 15.4, 0], torsoParent: 'body', head: 'camel', arm: { sleeve: TEAM, bracer: GOLD } }),
    part('weapon', camelSwordM(), [0.5, 0, 0.5], sc(HAND_E, R), 'armR', { scale: R, jitter: 0.015, rest: [0.55, 0, 0.3] }),
  ]);
}

// Mercenary Cavalry: a dark armoured horse, a Nubian rider with a spear.
{
  const C = DARK_COAT, MANE = 0x1e1a1a;
  // (round 14) a narrow saddle cloth (z 8..13) ending high on the flank: a
  // team field under a cream stripe, a silver trim row and a two-tone fringe,
  // so the dark horse's barrel, shoulder and the rider's legs show
  const bard = stripedBlanket({ z0: 8, z1: 13, low: 6, top: 9, colors: [TEAM, TEAM_TRIM, TEAM, SILVER_DK], spine: TEAM_TRIM, hem: [OCHRE, RED] });
  const t = manTorso(PAL_DARK);
  eKilt(t, { len: 6 }); eBelt(t, LEATHER_DK, GOLD); eCollar(t, [GOLD, GOLD, GOLD_DK, GOLD], { r0: 2.6 });
  rig('mercenary_cavalry', { voxel: 0.07, anim: 'horse', style: 'rider', pose: 'mount' }, [
    part('body', horseBody(C), [3, 0, 10.5], [0, 10, 0], null, { coat: false }),
    part('barding', bard, [3, 0, 10.5], [0, 0, 0], 'body'),
    part('riderLegs', riderLegsM({ skin: SKIN_DK, sandal: false, kiltC: KILT_LINEN, len: 8 }), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('neck', horseNeck(C, MANE, { collar: SILVER_DK }), [1.5, 0, 2], [0, 5.5, 8], 'body'),
    part('tail', horseTail(MANE), [1, 0, 0], [0, 7, -10], 'body'),
    ...horseLegs(C, { sock: TEAM }).map((p) => ({ ...p, coat: false })),
    ...riderMan({ torso: t, torsoJoint: [0, 10, 0.5], torsoParent: 'body', head: 'mercCav', pal: PAL_DARK, arm: { bracer: TEAM } }),
    part('weapon', spearM(30, SILVER), [0, 0, 0], HAND_E, 'armR'),
  ]);
}

// War Elephant (unit_07): a grey elephant (rig voxel 0.1). Flat mid-grey skin
// (cool, dark enough that the warm grade keeps it grey) with faint wrinkle
// rows; a cow-hide saddle cloth over the back only (it follows the barrel and
// stops at a team hem high on the flanks, so grey shows on the sides and
// legs), a team saddle pad, a wooden howdah. The head is one solid grey mass
// set forward of the shoulders and joined to them: a domed brow, two big flat
// ear slabs a shade darker flaring out from the sides of the skull, a tapered
// trunk of five stepped segments hanging to the ground and curling forward at
// the tip, two bright ivory tusks out of the trunk's base; a narrow team brow
// band with gold studs. A mahout with a spear on its neck (rider parts at
// 0.7 x, the human voxel size). Idle: no grazing (graze false).
{
  const G = (x, y, z) => (hash3(x, y, z, 16) < 0.1 ? 0x6a6664 : 0x726e6b);
  const GH = 0x7a7673;   // the head one flat grey, a touch lighter (it faces the camera)
  const GE = 0x76726f, GEI = 0x6e6a67, GW = 0x625e5b, NAIL = 0xd8d0c0, IVORY = 0xfffaee, IVORY_SH = 0xece2cc;
  const body = new VoxelModel();
  body.ellipsoid(5.5, 6, 9.5, 5.6, 5.8, 9.2, G);
  body.ellipsoid(5.5, 7, 15, 5.4, 6, 4.4, G);    // the high shoulders
  body.ellipsoid(5.5, 6, 3.5, 5.2, 5.4, 4, G);
  for (let y = 1; y <= 9; y += 3) for (let z = 1; z <= 19; z++) for (const x of [0, 11]) if (body.has(x, y, z) && (z % 5)) body.set(x, y, z, GW);   // wrinkle rows
  // the saddle cloth: on the back, draped down the barrel to y 7, a team hem
  const cloth = new VoxelModel();
  const HIDE = (x, y, z) => (hash3(x >> 1, y >> 1, z >> 1, 91) < 0.33 ? 0x7a3e1c : 0xeee6d8);
  const Z0 = 4, Z1 = 15, LOW = 7;
  for (let z = Z0; z <= Z1; z++) for (let x = 0; x <= 11; x++) {
    let top = -1;
    for (let y = 16; y >= 0; y--) if (body.has(x, y, z)) { top = y; break; }
    if (top < 0) continue;
    cloth.set(x, top + 1, z, HIDE(x, top, z));
  }
  for (let z = Z0; z <= Z1; z++) for (let y = LOW; y <= 13; y++) for (const s of [-1, 1]) {
    let xb = s < 0 ? 0 : 11;
    while (xb >= 0 && xb <= 11 && !body.has(xb, y, z)) xb -= s;
    if (xb < 0 || xb > 11) continue;
    const x = xb + s;
    if (cloth.has(x, y, z) || body.has(x, y, z)) continue;
    const end = z === Z0 || z === Z1;
    cloth.set(x, y, z, y === LOW ? TEAM_TRIM : y === LOW + 1 || end ? TEAM : HIDE(x, y, z));
  }
  // team pad and the howdah: a wooden box with corner posts and a team rail
  const how = new VoxelModel();
  how.box(0, 0, 0, 12, 2, 10, TEAM);
  tbox(how, 0, 0, 0, 12, 1, 10, TEAM_SHADE);
  for (let x = 1; x <= 10; x++) for (let z = 1; z <= 8; z++) for (let y = 2; y <= 6; y++) {
    const edge = x === 1 || x === 10 || z === 1 || z === 8;
    if (!edge && y > 2) continue;
    const post = (x === 1 || x === 10) && (z === 1 || z === 8);
    how.set(x, y, z, post ? WOOD_DK : y === 6 ? TEAM : (y === 4 ? WOOD_DK : WOOD(x, y, z)));
  }
  for (const [x, z] of [[1, 1], [10, 1], [1, 8], [10, 8]]) how.box(x, 7, z, 1, 2, 1, WOOD_DK);
  how.set(5, 3, 2, 0x8a6a3a).set(6, 3, 6, 0xb08a4a).set(4, 3, 5, STONE(1, 1, 1));   // pots, a basket
  how.line(-1, 1, 5, -1, -3, 5, LEATHER_DK).line(12, 1, 5, 12, -3, 5, LEATHER_DK);   // girth ropes down to the cloth
  // the head, in its own frame: x 0..11 (centre 5.5), the joint at (5.5, 0, 0)
  // sits at the front of the shoulders; the skull's back sinks into them
  const headM = new VoxelModel();
  headM.ellipsoid(5.5, 0, -1, 4.6, 4.6, 3.6, G);       // the neck root inside the shoulders
  headM.ellipsoid(5.5, 0.5, 3, 4.3, 4.6, 3.8, GH);     // the skull
  headM.ellipsoid(5.5, 3.2, 3.2, 4.2, 2.8, 3.4, GH);    // the domed brow
  headM.ellipsoid(5.5, -2.5, 4.8, 3, 2.6, 2.6, GH);    // the cheeks / trunk root
  // the trunk: five stepped segments, each narrower, down to the ground and
  // curling forward (and up) at the tip; a darker crease between segments
  const SEG = [[4, 4, -3, 5, 3], [4, 3, -6, 6, 3], [4.5, 2, -9, 6, 3], [4.5, 2, -11, 7, 2], [5, 1, -12, 8, 1]];
  for (const [x0, w, y0, z0, d] of SEG) {
    headM.box(Math.round(x0), y0, z0, w, 3, d, GH);
  }
  headM.box(4, -12, 7, 3, 2, 2, GH);                     // the curl
  headM.box(5, -12, 9, 2, 1, 2, GH).box(5, -11, 10, 2, 1, 1, GH);
  // tusks: bright ivory prongs out of the trunk's base, forward then up
  for (const x of [2.5, 8.5]) {
    tube(headM, [x, -3.5, 5], [x, -5.5, 8.5], 1.05, 0.9, IVORY_SH);
    tube(headM, [x, -5.5, 8.5], [x, -3.8, 10.8], 0.85, 0.3, IVORY);
  }
  // eyes, a dark crease under the brow
  headM.set(2, 1, 5, DARK).set(9, 1, 5, DARK).set(2, 2, 5, GE).set(9, 2, 5, GE);
  // a gold brow band across the domes
  for (let x = 1; x <= 10; x++) {
    let z = 10; while (z > -2 && !headM.has(x, 3, z)) z--;
    if (z > -2) headM.set(x, 3, z, GOLD(x, 3, z));
  }
  // ears: big flat slabs (2 thick) one shade darker, separate parts hinged at
  // the sides of the skull and turned out (rest yaw) so the back edge flares
  // away from the head; rounded, with a lobe hanging below the jaw
  const ear = (s) => {
    const m = new VoxelModel();
    for (let y = -7; y <= 5; y++) for (let z = -7; z <= 0; z++) {
      const dy = (y + 0.5) / 5.2, dz = (z + 2.8) / 3.2;
      const lobe = y < 0 && y >= -7 && z >= -3 && z <= -1 && (y + 7) >= (-1 - z);
      if (dy * dy + dz * dz > 1 && !lobe) continue;
      m.set(0, y, z, s > 0 ? GE : GEI).set(1, y, z, s > 0 ? GEI : GE);
    }
    return m;
  };
  const legUp = new VoxelModel().box(0, 0, 0, 4, 6, 4, G);
  const legLow = new VoxelModel().box(0, 1, 0, 4, 6, 4, G).box(0, 0, 0, 4, 1, 4, GW);
  for (let x = 0; x < 4; x += 2) legLow.set(x, 0, 4, NAIL).set(x + 1, 0, 4, GW);   // toenails
  band(legLow, 5, GOLD_DK); band(legLow, 4, GOLD);
  const R = 0.7;   // mahout scale
  const t = manTorso();
  eKilt(t, { len: 6 }); eBelt(t, GOLD, GOLD_DK); eCollar(t, [GOLD, TM, GOLD], { r0: 2.6 });
  rig('war_elephant', { voxel: 0.1, anim: 'horse', style: 'elephant', gait: 0.55, stride: 0.6, graze: false }, [
    part('body', body, [5.5, 0, 9.5], [0, 9, 0], null),
    part('barding', cloth, [5.5, 0, 9.5], [0, 0, 0], 'body'),
    part('howdah', how, [6, 0, 5], [0, 12, -3], 'body'),
    part('riderLegs', riderLegsM({ y: 13, x0: 2, x1: 9, z: 12, len: 5, sandal: false }), [5.5, 0, 9.5], [0, 0, 0], 'body'),
    part('neck', headM, [5.5, 0, 0], [0, 8, 10], 'body'),
    part('earL', ear(1), [0, 0, 0], [5, 1, 2.5], 'neck', { rest: [0, -0.5, 0.35] }),
    part('earR', ear(-1), [2, 0, 0], [-5, 1, 2.5], 'neck', { rest: [0, 0.5, -0.35] }),
    part('tail', new VoxelModel().box(0, -8, 0, 1, 8, 1, G).box(-1, -10, 0, 3, 2, 1, HAIR), [0.5, 0, 0.5], [0, 9, -9], 'body'),
    part('legFL', legUp, [2, 6, 2], [3.5, 3, 5.5], 'body'),
    part('cannonFL', legLow, [2, 7, 2], [0, -5, 0], 'legFL'),
    part('legFR', legUp, [2, 6, 2], [-3.5, 3, 5.5], 'body'),
    part('cannonFR', legLow, [2, 7, 2], [0, -5, 0], 'legFR'),
    part('legBL', legUp, [2, 6, 2], [3.5, 3, -5.5], 'body'),
    part('cannonBL', legLow, [2, 7, 2], [0, -5, 0], 'legBL'),
    part('legBR', legUp, [2, 6, 2], [-3.5, 3, -5.5], 'body'),
    part('cannonBR', legLow, [2, 7, 2], [0, -5, 0], 'legBR'),
    ...riderMan({ torso: t, s: R, torsoJoint: [0, 13, 3], torsoParent: 'body', head: 'mahout', arm: { bracer: TEAM } }),
    part('weapon', spearM(28), [0, 0, 0], sc(HAND_E, R), 'armR', { scale: R }),
  ]);
}

// ---- siege ---------------------------------------------------------------------
function siegeWheel(r = 4) {
  const m = new VoxelModel();
  for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
    const d = Math.hypot(y, z);
    if (d > r + 0.4) continue;
    if (d > r - 0.8) m.set(0, y, z, (y * 3 + z) % 4 ? WOOD : WOOD_DK).set(1, y, z, WOOD_DK);
    else if (d < 1.2) m.set(0, y, z, BRONZE(0, y, z)).set(1, y, z, BRONZE(1, y, z));
    else if (y === 0 || z === 0) m.set(0, y, z, WOOD_DK);
  }
  return m;
}
// Catapult (rig voxel 0.09): a timber frame on four wheels, a throwing arm
// (channel "weapon") with a sling bucket, team cloth on the frame.
{
  const fr = new VoxelModel();
  fr.box(-6, 4, -9, 2, 2, 18, WOOD_DK).box(4, 4, -9, 2, 2, 18, WOOD_DK);
  for (const z of [-8, -2, 6]) fr.box(-6, 4, z, 12, 2, 2, WOOD);
  // the A-frame uprights and the crossbar the arm strikes
  for (const x of [-6, 4]) { fr.line(x, 6, -6, x, 15, -1, WOOD_DK); fr.line(x + 1, 6, 3, x + 1, 15, -1, WOOD_DK); }
  fr.box(-6, 15, -2, 12, 2, 2, WOOD).box(-5, 15, -1, 10, 2, 1, TEAM);
  fr.box(-5, 6, -8, 10, 2, 6, WOOD);   // the counterweight bed
  fr.box(-4, 8, -7, 8, 3, 4, STONE);
  fr.box(-7, 5, -4, 1, 3, 8, TEAM).box(6, 5, -4, 1, 3, 8, TEAM);   // team cloths on the sides
  for (let z = -4; z < 4; z += 2) { tset(fr, -7, 5, z, TEAM_SHADE); tset(fr, 6, 5, z, TEAM_SHADE); }
  fr.box(-2, 6, 4, 4, 2, 4, WOOD_DK).box(-1, 8, 5, 2, 1, 2, ROPE());
  const arm = new VoxelModel();
  arm.box(-1, 0, -1, 2, 2, 2, BRONZE).box(0, 0, 0, 1, 18, 1, WOOD_DK).box(-1, 0, 0, 1, 18, 1, WOOD);
  arm.box(-2, 17, -2, 4, 1, 4, LEATHER).box(-2, 18, -2, 4, 1, 1, LEATHER).box(-2, 18, 1, 4, 1, 1, LEATHER);
  arm.box(-1, 18, -1, 2, 2, 2, STONE);
  rig('catapult', { voxel: 0.09, anim: 'siege', style: 'catapult' }, [
    part('frame', fr, [0, 0, 0], [0, 0, 0], null),
    part('wheelFL', siegeWheel(4), [0, 0, 0], [7, 4, 6], 'frame', { anim: 'wheel' }),
    part('wheelFR', siegeWheel(4), [1, 0, 0], [-7, 4, 6], 'frame', { anim: 'wheel' }),
    part('wheelBL', siegeWheel(4), [0, 0, 0], [7, 4, -6], 'frame', { anim: 'wheel' }),
    part('wheelBR', siegeWheel(4), [1, 0, 0], [-7, 4, -6], 'frame', { anim: 'wheel' }),
    part('weapon', arm, [0, 0, 0], [0, 7, -3], 'frame'),
  ]);
}
function ROPE() { return (x, y, z) => (hash3(x, y, z, 44) < 0.5 ? 0xc8b07a : 0xb89e68); }
// Siege Tower (rig voxel 0.1): a tall timber tower on four wheels, hide
// panels in the army's colour, a drawbridge at the top, a ladder at the back.
{
  const fr = new VoxelModel();
  const W = 5, D = 5;
  for (let y = 3; y <= 30; y++) for (let x = -W; x <= W; x++) for (let z = -D; z <= D; z++) {
    const edge = Math.abs(x) === W || Math.abs(z) === D;
    if (!edge) continue;
    const post = Math.abs(x) === W && Math.abs(z) === D;
    let c;
    if (post) c = WOOD_DK;
    else if (y % 7 === 3) c = WOOD_DK;
    else if (Math.abs(z) === D && z > 0 && y > 23 && Math.abs(x) <= 3) c = WOOD(x, y, z);       // the bridge, raised
    else c = (y >> 2) % 2 ? TEAM : (x + z + y) % 3 ? LEATHER : 0x8a6440;
    fr.set(x, y, z, c);
    if (c === TEAM && (x + y) % 3 === 0) tset(fr, x, y, z, TEAM_SHADE);
  }
  fr.box(-W, 31, -D, 2 * W + 1, 1, 2 * D + 1, WOOD_DK).carve(-W + 1, 31, -D + 1, 2 * W - 1, 1, 2 * D - 1);
  for (let x = -W; x <= W; x += 2) fr.box(x, 32, -D, 1, 2, 1, WOOD_DK).box(x, 32, D, 1, 2, 1, WOOD_DK);
  fr.box(-W - 1, 3, -D - 1, 2 * W + 3, 2, 2 * D + 3, WOOD_DK);
  for (let y = 4; y <= 30; y += 2) fr.box(-1, y, -D - 1, 3, 1, 1, WOOD);   // ladder rungs at the back
  fr.box(-2, 4, -D - 1, 1, 27, 1, WOOD_DK).box(2, 4, -D - 1, 1, 27, 1, WOOD_DK);
  rig('siege_tower', { voxel: 0.1, anim: 'siege', style: 'tower' }, [
    part('frame', fr, [0, 0, 0], [0, 0, 0], null),
    part('wheelFL', siegeWheel(3), [0, 0, 0], [W + 2, 3, 3], 'frame', { anim: 'wheel' }),
    part('wheelFR', siegeWheel(3), [1, 0, 0], [-W - 2, 3, 3], 'frame', { anim: 'wheel' }),
    part('wheelBL', siegeWheel(3), [0, 0, 0], [W + 2, 3, -3], 'frame', { anim: 'wheel' }),
    part('wheelBR', siegeWheel(3), [1, 0, 0], [-W - 2, 3, -3], 'frame', { anim: 'wheel' }),
  ]);
}

// ---- myth units -------------------------------------------------------------------
// Anubite (beast rig, 0.085): a jackal-headed warrior, dark fur, a team
// headcloth, white linen straps, a team kilt, a sickle-sword in each hand.
{
  const FUR = pick3(21, 0x4a2e1c, 0x3e2616, 0x5a3a24);
  const FUR_LT = 0x6e4a30;
  // the men's body in two flat fur tones: linen straps crossed over the
  // chest, a team kilt with a linen hem, silver anklets and armlets
  const PAL_F = { L: 0x6a452c, M: 0x4a2e1c, D: 0x301c10 };
  const body = manTorso(PAL_F);
  eKilt(body, { len: 7, hem: LINEN });
  eBelt(body, GOLD, GOLD_DK);
  eSash(body, LINEN, -5, 4, 13, 3); eSash(body, LINEN, 4, -5, 13, 3);
  eCollar(body, [TM, TM, LINEN], { r0: 2.6 });
  // (round 15) the head reads muzzle and ears first from the RTS camera: a
  // 5 x 5 x 5 skull, a long muzzle (3 wide, 6 forward) with a lighter bridge
  // along its top and a black nose, tall pointed ears (2 wide at the base,
  // a lighter inner face) standing clear above the crown; the team headcloth
  // only wraps the skull, one voxel thin: the crown behind the ears, the
  // sides beside the eyes, lappets down the cheeks and a short flap at the
  // nape, never above the skull nor behind it as a slab
  const headM = new VoxelModel();
  const SNOUT_T = 0x7a5236, EAR_IN = 0x9a6a4c;
  headM.box(0, 0, 0, 5, 5, 5, FUR);
  headM.box(1, 0, 5, 3, 3, 3, FUR).box(1, 0, 8, 3, 2, 3, FUR).box(1, -1, 5, 3, 1, 4, FUR_LT);   // muzzle and jaw
  for (let z = 5; z <= 10; z++) headM.set(2, z <= 7 ? 3 : 2, z, SNOUT_T);                       // the bridge
  headM.box(1, 1, 11, 3, 1, 1, DARK).set(2, 2, 10, DARK);                                        // the nose
  headM.set(1, 3, 5, 0xffd040, { glow: 0.6 }).set(3, 3, 5, 0xffd040, { glow: 0.6 });               // eyes beside the bridge
  for (const ex of [0, 3]) {                                                                     // ears, x 0..1 and 3..4
    headM.box(ex, 5, 2, 2, 2, 2, FUR).box(ex + (ex ? 1 : 0), 7, 2, 1, 2, 2, FUR).set(ex + (ex ? 1 : 0), 9, 2, FUR);
    headM.box(ex, 5, 3, 2, 2, 1, EAR_IN).set(ex + (ex ? 1 : 0), 7, 3, EAR_IN);
  }
  // the headcloth (team): the crown z -1..1 behind the ears, the sides x 0 / 4
  // (y 1..4, z 0..3) and the back of the skull painted, then a one-voxel
  // lappet on each cheek (x -1 / 5, y -2..2, z 1..3) and a short nape flap (z -1, 3 wide, y -2..1)
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 1; z++) tset(headM, x, 4, z, 0xffffff);
  for (const x of [0, 4]) for (let y = 1; y <= 4; y++) for (let z = 0; z <= 3; z++) tset(headM, x, y, z, y === 4 ? 0xffffff : TEAM_SHADE);
  for (let x = 0; x <= 4; x++) for (let y = 0; y <= 4; y++) tset(headM, x, y, 0, TEAM_SHADE);
  for (const x of [-1, 5]) for (let y = -2; y <= 2; y++) for (let z = 1; z <= 3; z++) if (!(y === 2 && z === 3)) tset(headM, x, y, z, y === -2 ? 0xffffff : TEAM_SHADE);
  for (let x = 1; x <= 3; x++) for (let y = -2; y <= 1; y++) tset(headM, x, y, -1, y === -2 ? 0xffffff : TEAM_SHADE);
  // the sickle-sword (round 15): dark steel, apart from the white linen; a
  // leather grip in the fist and a bronze guard, a straight neck, then the
  // hooked blade (two voxels deep along the spine, a lighter honed edge on the
  // inner curve). The part's rest turns it forward and down out of the fist,
  // a fighting grip, so it never lies along the arm
  const STEEL = 0x4e565e, STEEL_D = 0x383e44, STEEL_E = 0x8a949e, BRZ = 0x8a5a24;
  const blade = () => {
    const m = new VoxelModel();
    m.box(0, -2, 0, 1, 3, 1, LEATHER_DK).set(0, -3, 0, BRZ).set(0, 1, 0, BRZ).set(0, 1, 1, BRZ).set(0, 1, -1, BRZ);
    m.box(0, 2, 0, 1, 5, 1, STEEL).set(0, 4, 1, STEEL_D);
    const arc = [[7, 0], [8, 1], [9, 2], [9, 3], [9, 4], [8, 5], [7, 6], [6, 6], [5, 7]];
    for (const [y, z] of arc) { m.set(0, y, z, STEEL); if (y > 5) m.set(0, y - 1, z, z >= 2 && z <= 5 ? STEEL_E : STEEL_D); }
    m.set(0, 4, 7, STEEL_E);
    return m;
  };
  const GRIP_R = { rest: [2.15, 0, -0.2], scale: 0.7 }, GRIP_L = { rest: [2.15, 0, 0.2], scale: 0.7 };
  rig('anubite', { voxel: 0.085, anim: 'beast', style: 'beast' }, [
    ...beastManParts({ torso: body, pal: PAL_F, head: headM, headScale: 0.62, arm: { band: 0x8e959c, bracer: TEAM }, leg: { sandal: null, foot: FUR_LT, band: 0x8e959c, kilt: TEAM } }),
    part('weapon', blade(), [0, 0, 0], BEAST_FIST, 'foreR', GRIP_R),
    part('weapon2', blade(), [0, 0, 0], BEAST_FIST, 'foreL', { anim: 'weapon', ...GRIP_L }),
  ]);
}

// Avenger (beast rig, 0.1): a falcon-headed warrior: a dark feathered mantle
// with white tips, a team kilt with a gold hem, a team and gold collar,
// scaled legs with talons, two long gold blades.
{
  const FEATH = pick3(25, 0x3a3f48, 0x2e3239, 0x4a5058);
  // the men's body: a team and gold collar, a team kilt with a gold hem,
  // the dark feathered mantle down the back with white tips, feathered
  // thighs over grey scaled shins and yellow talons
  const body = manTorso();
  eKilt(body, { len: 8, hem: GOLD });
  eBelt(body, GOLD, GOLD_DK);
  eCollar(body, [GOLD, TM, TM, GOLD, TM_SH, GOLD], { r0: 2.4 });
  for (let y = -2; y <= 14; y++) for (let x = -7; x <= 6; x++) {
    let zb = 9; for (let z = -6; z <= 4; z++) if (body.has(x, y, z)) { zb = z; break; }
    if (zb === 9 || (y < 1 && Math.abs(x + 0.5) > 5)) continue;
    body.set(x, y, zb - 1, y <= 0 ? 0xe8e8e4 : FEATH(x, y, 0));
  }
  const PAL_SC = { L: 0x6a7078, M: 0x4c525a, D: 0x363a40 };
  const shinA = manShinM({ pal: PAL_SC, sandal: null, foot: 0xd8b060 });
  shinA.set(-2, 0, 5, DARK).set(1, 0, 5, DARK).set(-1, 0, -3, DARK);   // talons
  const headM = new VoxelModel();
  headM.ellipsoid(2.5, 3, 2.5, 3, 3.2, 3, FEATH);
  headM.box(1, 1, 5, 3, 2, 2, GOLD).box(2, 0, 7, 1, 2, 1, GOLD_DK).set(2, -1, 7, GOLD_DK);   // hooked beak
  headM.box(0, 2, 4, 1, 2, 1, 0xf0f0ec).box(4, 2, 4, 1, 2, 1, 0xf0f0ec).set(0, 3, 5, 0xffb020, { glow: 0.5 }).set(4, 3, 5, 0xffb020, { glow: 0.5 });
  headM.box(0, 1, -1, 5, 5, 1, FEATH).box(0, -3, -2, 5, 5, 2, FEATH).box(0, -4, -2, 5, 1, 2, 0xe8e8e4);
  rig('avenger', { voxel: 0.1, anim: 'beast', style: 'beast' }, [
    ...beastManParts({ torso: body, head: headM, headScale: 0.62, arm: { band: GOLD, bracer: TEAM }, leg: { kilt: TEAM, pal: { L: 0x4a5058, M: 0x3a3f48, D: 0x2e3239 } }, shin: shinA }),
    // (round 15) the blades low in a fighting grip, forward, down and out
    // from the fists (myth_12), never along the arms
    // in a deep orange-leaning gold (the plain GOLD reads pale beside the linen)
    part('weapon', longBladeM(0xd89a28, 13), [0, 0, 0], BEAST_FIST, 'foreR', { rest: [2.0, 0, -0.35], scale: 0.8 }),
    part('weapon2', longBladeM(0xd89a28, 13), [0, 0, 0], BEAST_FIST, 'foreL', { anim: 'weapon', rest: [2.0, 0, 0.35], scale: 0.8 }),
  ]);
}

// Mummy (human rig, 0.08), on the men's body: linen wrappings banded every
// two rows (light / dark, no noise), a team and gold striped nemes, a
// tattered skirt, a curved blade.
{
  const WL = (x, y, z) => ((y >> 1) & 1 ? 0xd8ccac : 0xc0b290), WM = (x, y, z) => ((y >> 1) & 1 ? 0xb4a684 : 0x9c8e6c);
  const PAL_W = { L: WL, M: WM, D: 0x7a6c50 };
  const t = manTorso(PAL_W);
  eKilt(t, { color: 0x9a8e6e, side: 0x7e7258, hem: null, len: 8, fold: false });
  for (let y = -6; y >= -9; y--) for (let x = -7; x <= 6; x++) for (let z = -4; z <= 3; z++) if (hash3(x, y, z, 64) < 0.35) t.remove(x, y, z);   // ragged hem
  eBelt(t, TEAM, null);
  rig('mummy', { voxel: 0.08, anim: 'human', style: 'mummy', pose: 'slash', stance: true }, [
    ...manParts({ torso: t, head: 'mummy', headZ: 0.6, pal: PAL_W, leg: { sandal: null, foot: 0x6a6050 } }),
    part('weapon', khopeshFine(), [1, 0, 1], HAND_E, 'armR', { scale: 0.5, rest: [0.3, -1.57, 0.3] }),
  ]);
}

// Minion (human rig, 0.072), on the men's body: grey undead, rib lines across
// the chest, a team hood and loincloth.
{
  const PAL_G = { L: 0x9a9a92, M: 0x7e7e78, D: 0x5e5e58 };
  const t = manTorso(PAL_G);
  paint(t, (x, y, z) => (z === 3 && (y === 8 || y === 10) && Math.abs(x + 0.5) >= 1.5 ? PAL_G.D : null));   // ribs
  eKilt(t, { len: 4, hem: null, apron: TEAM, fold: false });
  eBelt(t, 0x4a4038, null);
  rig('minion', { voxel: 0.072, anim: 'human', style: 'minion', pose: 'slash', stance: true }, [
    ...manParts({ torso: t, head: 'minion', headZ: 0.6, pal: PAL_G, leg: { sandal: null, foot: PAL_G.D } }),
    part('weapon', khopeshFine({ metal: 0x6a5a48, spine: 0x3a2e24, edge: 0xe8e2d4 }), [1, 0, 1], HAND_E, 'armR', { scale: 0.5, rest: [0.3, -1.57, 0.3] }),
  ]);
}

// Son of Osiris (beast rig, 0.1): the Pharaoh as a falcon-headed demigod in
// gold with a glowing ankh staff.
{
  // the men's body: a gold corselet, a broad team and gold collar, a long
  // kilt banded team and gold, gold wings folded down the back
  const body = manTorso();
  paint(body, (x, y, z) => (y >= 3 && y <= 9 && (z >= 2 || z <= -3) ? GOLD : null));
  eCollar(body, [TM, GOLD, TM, GOLD, TM, GOLD], { r0: 2.4 });
  eKilt(body, { len: 10, hem: GOLD, apron: GOLD, apronEdge: TEAM_TRIM });
  eBelt(body, GOLD, TEAM);
  for (let y = 0; y <= 13; y++) for (let x = -6; x <= 5; x++) body.set(x, y, -5, (x + y) % 3 ? GOLD(x, y, 0) : 0xfff0a0, { glow: 0.15 });
  const shinO = manShinM({ sandal: GOLD, band: GOLD });
  const headM = new VoxelModel();
  headM.ellipsoid(2.5, 3, 2.5, 3, 3.2, 3, GOLD, { glow: 0.2 });
  headM.box(1, 1, 5, 3, 2, 2, 0x2a2a30).box(2, 0, 7, 1, 2, 1, 0x2a2a30);
  headM.set(0, 3, 5, 0x60e0ff, { glow: 0.9 }).set(4, 3, 5, 0x60e0ff, { glow: 0.9 });
  headM.ellipsoid(2.5, 8, 2.5, 2, 2.4, 2, 0xffe060, { glow: 0.9 });   // the sun disc
  rig('son_of_osiris', { voxel: 0.1, anim: 'beast', style: 'beast' }, [
    ...beastManParts({ torso: body, head: headM, headScale: 0.62, arm: { band: GOLD, bracer: GOLD }, leg: { kilt: TEAM }, shin: shinO }),
    part('weapon', ankhStaffM({ glow: 0.15 }), ANKH_PIVOT, BEAST_FIST, 'foreR', { scale: 0.5 }),
  ]);
}

// Sphinx (four-legged rig, 0.11; round 17 rebuild after myth_03): a lion's
// body with a deep chest tapering to a narrow waist and a low haunch, a flat
// back, thick forelegs on wide clawed paws with team wrist bands, bent hind
// legs (thigh forward to the stifle, gaskin back to the hock, a sloped
// metatarsus), a tail curling up into a team tuft. On a raised chest and a
// thick neck an upright man's head at body scale (1.4x the old one): a face
// with a brow ridge, kohl eyes, a standing nose, a mouth, a chin and a
// braided false beard, framed by a symmetric striped nemes (gold brow band
// and uraeus, a striped crown, side wings flaring out past the jaw, two wide
// lappets falling onto the chest, a queue behind).
{
  const LION = pick3(51, 0x9e6826, 0x966222, 0xa66e2c, 0.5, 0.85);   // a red-brown lion (myth_03), not sand
  const LION_LT = pick3(53, 0xc08c4a, 0xb88444, 0xc69250, 0.5, 0.85);   // belly, throat, inner legs
  const LION_DK = 0x6e3e1c;                                             // creases, toe splits
  const CLAW = 0x2a2420;
  const UK = (k) => [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512];
  // body (y = height above the ground; the pivot sits at the rig's y 10)
  const body = new VoxelModel();
  // swept from a side profile (z, back, belly, half width) through a boxy
  // round section, so the outline steps evenly: a deep chest under high
  // withers, a narrow tucked-up waist, a low haunch, a flat back
  const PROF = [[-1, 14, 11.6, 2.0], [0, 15, 10.6, 2.8], [2, 15.6, 9.8, 3.3], [5, 15.6, 10, 3.2], [7, 15.4, 11.2, 2.7],
    [10, 15.4, 11.6, 2.6], [12, 15.8, 10.4, 3.0], [14, 16.6, 8.8, 3.8], [17, 17, 8, 4.1], [19, 16.6, 8.4, 3.9], [21, 15.4, 9.6, 3.2], [22, 14, 11, 2.2]];
  for (let z = -1; z <= 22; z++) {
    let i = 0;
    while (i < PROF.length - 2 && PROF[i + 1][0] < z) i++;
    const [z0, t0, b0, w0] = PROF[i], [z1, t1, b1, w1] = PROF[i + 1];
    const f = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
    const top = t0 + (t1 - t0) * f, bot = b0 + (b1 - b0) * f, hw = w0 + (w1 - w0) * f + 0.3;
    const cy = (top + bot) / 2, ry = (top - bot) / 2 + 0.3;
    for (let y = Math.floor(bot); y <= Math.ceil(top); y++) for (let x = -3; x <= 9; x++) {
      const dx = Math.abs(x - 3) / hw, dy = Math.abs(y - cy) / ry;
      if (dx ** 2.5 + dy ** 2.5 <= 1) body.set(x, y, z, LION);
    }
  }
  // light underside: throat, chest floor and belly
  for (const [k, v] of body.vox) {
    const [x, y, z] = UK(k);
    if (y < 13 && (!body.has(x, y - 1, z) || !body.has(x, y - 2, z))) v.c = LION_LT(x, y, z);
    if (z >= 19 && y >= 11 && y <= 15 && Math.abs(x - 3) <= 2) v.c = LION_LT(x, y, z);   // the bib under the lappets
  }
  // the neck: thick, rising up and a little forward from the withers, a gold
  // and team collar where it meets the chest
  const neck = new VoxelModel();
  capsuleYZ(neck, 0, 5, 0, 0, 2.6, 5, 1.2, 2.2, LION);
  for (let z = -3; z <= 4; z++) for (let x = 0; x <= 4; x++) for (const y of [1]) if (neck.has(x, y, z) && (!neck.has(x, y, z + 1) || !neck.has(x, y, z - 1) || x === 0 || x === 4)) neck.set(x, y, z, GOLD(x, y, z));
  for (let x = 1; x <= 3; x++) for (let y = 2; y <= 6; y++) { let z = 6; while (z > -2 && !neck.has(x, y, z)) z--; if (z > -2) neck.set(x, y, z, LION_LT(x, y, z)); }   // the throat
  // the head, authored at body scale: face x 1..7 (centre x 4), y 0..7, the
  // face plane z 4, the nose at z 5
  const SK = pick3(54, 0xd09464, 0xc88c5c, 0xd49a6a, 0.5, 0.85);   // the face a step lighter than the lion
  const SK_SH = 0x9c6038;
  const BROW = 0x7a4020;
  const h = new VoxelModel();
  for (let y = 0; y <= 8; y++) for (let x = 1; x <= 7; x++) for (let z = -2; z <= 4; z++) {
    if (y <= 1 && (x <= 1 || x >= 7)) continue;                  // the jaw narrows
    if (y === 0 && (x <= 2 || x >= 6)) continue;                 // to a chin
    h.set(x, y, z, z === 4 ? SK(x, y, z) : SK_SH);
  }
  // brow ridge: a dark line a voxel proud over the eyes, broken by the bridge
  for (const x of [2, 3, 5, 6]) h.set(x, 5, 4, BROW);
  for (const x of [1, 7]) h.set(x, 5, 4, SK_SH);
  // eyes: a white and a dark pupil each, either side of the nose bridge
  h.set(1, 4, 4, SK_SH).set(2, 4, 4, EYE_WHITE).set(3, 4, 4, DARK);
  h.set(7, 4, 4, SK_SH).set(6, 4, 4, EYE_WHITE).set(5, 4, 4, DARK);
  // the nose standing out: bridge, ridge and tip, nostril shade either side
  h.set(4, 4, 5, SK(4, 4, 5)).set(4, 3, 5, 0xd08e5a).set(4, 2, 5, 0xd08e5a).set(4, 2, 6, 0xc88654);
  h.set(3, 2, 4, SK_SH).set(5, 2, 4, SK_SH);
  h.set(2, 3, 4, SK_SH).set(6, 3, 4, SK_SH);                    // cheekbones' shade
  h.set(3, 1, 4, SK_SH).set(4, 1, 4, LIP).set(5, 1, 4, SK_SH);   // the mouth
  h.set(4, 0, 5, SK(4, 0, 5));                                   // the chin stands out
  // the braided false beard: a gold-banded dark plait under the chin
  for (let y = -4; y <= -1; y++) h.box(4, y, 3, 1, 1, 2, y & 1 ? 0x7a4a22 : 0xa87038);
  h.box(4, -5, 3, 1, 1, 2, GOLD);
  // the nemes (team / linen stripes by height, 1 voxel each)
  const ST = (x, y, z) => (y & 1 ? TEAM : LINEN(x, y, z));
  // crown: over the skull from the brow band up, domed; stripes run front to back on top
  for (let y = 8; y <= 9; y++) for (let x = 0; x <= 8; x++) for (let z = -3; z <= 5; z++) {
    if (y === 9 && (x === 0 || x === 8 || z === 5 || z === -3)) continue;
    h.set(x, y, z, y === 9 ? ((x & 1) ? LINEN(x, y, z) : TEAM) : ST(x, y, z));
  }
  h.box(0, 7, 5, 9, 1, 1, GOLD).box(0, 7, -3, 1, 1, 8, GOLD).box(8, 7, -3, 1, 1, 8, GOLD);   // the gold brow band
  h.set(4, 8, 6, GOLD).set(4, 9, 6, 0xd8b400).set(4, 8, 5, GOLD);          // the uraeus
  // side wings: from the temples down past the jaw, flaring out (a trapezoid
  // round the face), set back from the face plane so the face reads first
  for (let y = 7; y >= -1; y--) {
    const out = y >= 6 ? 1 : y >= 3 ? 2 : 3;
    for (let k = 1; k <= out; k++) for (const x of [1 - k, 7 + k]) for (let z = k >= 2 ? -1 : -3; z <= 3; z++) {
      if (y === 7 && x !== 0 && x !== 8) continue;
      h.set(x, y, z, ST(x, y, z));
    }
  }
  // two wide lappets (3 wide, 2 deep) from the wings' feet down onto the chest,
  // leaning forward with the chest, gold-tipped
  for (const x0 of [-2, 8]) {
    for (let y = -2; y >= -9; y--) {
      const z0 = y >= -4 ? 1 : y >= -7 ? 2 : 3;
      h.box(x0, y, z0, 3, 1, 2, y === -9 ? GOLD : ST(x0, y, z0));
    }
  }
  // the back of the nemes gathered into a queue
  h.box(2, 0, -4, 5, 8, 1, ST).box(3, -4, -4, 3, 4, 1, ST);
  // tail: up and back from the rump, curving out, a team tuft
  const tail = new VoxelModel();
  tube(tail, [0.5, 0.5, 0.5], [0.5, -2.5, -3], 0.95, 0.85, LION);
  tube(tail, [0.5, -2.5, -3], [0.5, -2.5, -6.5], 0.85, 0.8, LION);
  tube(tail, [0.5, -2.5, -6.5], [0.5, 0, -9], 0.8, 0.75, LION);
  tail.ellipsoid(0, 1, -10, 1, 1.6, 1.2, TEAM).set(0, 2, -9, TEAM_SHADE).set(0, 0, -11, TEAM);
  // legs. forelegs: a thick upper with the elbow behind, a lower with a team
  // wrist band and a wide clawed paw (4 wide, toes split, dark claws)
  const foreUp = () => new VoxelModel().box(0, 0, 0, 3, 6, 3, LION).box(0, 1, -1, 3, 3, 1, LION).box(0, 3, 3, 3, 3, 1, LION);
  const paw = (m, z0) => {
    m.box(-1, 0, z0, 5, 2, 4, LION).box(0, 2, z0 + 1, 3, 1, 2, LION);
    for (const x of [-1, 0, 2, 3]) m.set(x, 0, z0 + 4, CLAW);   // four dark claws, split in pairs
    for (const x of [-1, 0, 1, 2, 3]) m.set(x, 0, z0 + 3, LION_LT);
    m.set(1, 1, z0 + 3, LION_DK).set(1, 0, z0 + 3, LION_DK);   // the toe split
    return m;
  };
  const foreLow = () => { const m = new VoxelModel().box(0, 2, 0, 3, 6, 3, LION); for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) { if (x === 1 && z === 1) continue; tset(m, x, 4, z, TEAM_SHADE); m.set(x, 5, z, TEAM); } m.box(0, 4, -1, 3, 2, 1, TEAM); paw(m, -1); return m; };
  // hind legs: the thigh forward to the stifle, the gaskin back to the hock
  const hindUp = () => {
    const m = new VoxelModel();
    m.box(0, 4, -1, 3, 4, 4, LION).box(0, 3, 0, 3, 1, 3, LION);    // the thigh, broad, forward to the stifle
    m.box(0, 1, -1, 3, 2, 3, LION).box(0, 0, -2, 3, 1, 3, LION);   // the gaskin, back and down to the hock
    return m;
  };
  const hindLow = () => {
    const m = new VoxelModel();
    m.box(0, 6, -2, 3, 2, 3, LION).set(1, 7, -3, LION_DK).set(1, 6, -3, LION_DK);   // the hock and its point
    m.box(0, 2, -1, 3, 4, 2, LION);                                                // the metatarsus, sloping to the paw
    for (let x = 0; x < 3; x++) for (const z of [-2, 1]) m.set(x, 3, z, TEAM);     // the ankle band
    m.box(0, 3, -2, 3, 1, 1, TEAM).box(0, 3, 1, 3, 1, 1, TEAM);
    paw(m, -1);
    return m;
  };
  rig('sphinx', { voxel: 0.11, anim: 'horse', style: 'sphinx', gait: 0.8, stride: 0.8 }, [
    part('body', body, [3.5, 10, 10.5], [0, 10, 0]),
    part('neck', neck, [2.5, 0, 0.5], [0, 5.5, 8.2], 'body'),
    part('head', h, [4.5, 0, 0.5], [0, 5.5, 1.6], 'neck', { scale: 0.82, rest: [-0.12, 0, 0] }),
    part('tail', tail, [0.5, 0, 0], [0, 3.5, -10], 'body'),
    part('legFL', foreUp(), [1.5, 6, 1.5], [2.3, 1.5, 7], 'body'),
    part('cannonFL', foreLow(), [1.5, 7.5, 1.5], [0, -5.5, 0], 'legFL'),
    part('legFR', foreUp(), [1.5, 6, 1.5], [-2.3, 1.5, 7], 'body'),
    part('cannonFR', foreLow(), [1.5, 7.5, 1.5], [0, -5.5, 0], 'legFR'),
    part('legBL', hindUp(), [1.5, 6, 1], [2.5, 1.5, -7], 'body'),
    part('cannonBL', hindLow(), [1.5, 7.5, -1], [0, -5.5, -0.5], 'legBL'),
    part('legBR', hindUp(), [1.5, 6, 1], [-2.5, 1.5, -7], 'body'),
    part('cannonBR', hindLow(), [1.5, 7.5, -1], [0, -5.5, -0.5], 'legBR'),
  ]);
}

// Baboon of Set (four-legged rig, 0.06; sim type baboon_of_set, Set's
// starting scout): an olive-grey baboon with a pale shaggy cape over the high
// shoulders, a back sloping down to a red rump, a long dark dog-like muzzle
// with amber eyes under a heavy brow, a tail arching up and over, a team
// collar with a gold amulet of Set.
{
  const FUR = pick3(81, 0x6e5e44, 0x625438, 0x7a6a4e, 0.5, 0.85);
  const CAPE = pick3(82, 0x9c8c68, 0x8e7e5c, 0xa89a76, 0.5, 0.85);
  const FACE = 0x3e302c;
  const body = new VoxelModel();
  body.ellipsoid(3, 4.5, 6, 2.8, 3.2, 5.5, FUR);
  body.ellipsoid(3, 3.8, 1.5, 2.6, 2.8, 2.6, FUR);
  body.ellipsoid(3, 6, 10, 3.4, 3.8, 3.2, CAPE);          // the cape over the shoulders
  for (let x = 1; x <= 5; x++) for (let y = 1; y <= 4; y++) if (body.has(x, y, -1) || body.has(x, y, 0)) { const z = body.has(x, y, -1) ? -1 : 0; if (Math.abs(x - 3) <= 1) body.set(x, y, z, 0xb4443a); }
  const neck = new VoxelModel();
  capsuleYZ(neck, 0, 4, 0, 0, 2.2, 2, 2.5, 2, CAPE);
  for (let x = 0; x < 4; x++) tset(neck, x, 1, 3, TEAM_SHADE).set(x, 0, 3, TEAM);
  neck.set(1, -1, 4, GOLD(0, 0, 0)).set(2, -1, 4, GOLD(0, 0, 0)).set(1, -2, 4, 0xc23a22);
  const h = new VoxelModel();
  h.box(0, 0, 0, 5, 4, 4, FUR).box(-1, 1, 0, 1, 3, 3, CAPE).box(5, 1, 0, 1, 3, 3, CAPE);   // skull, cheek ruffs
  h.box(1, 0, 4, 3, 2, 4, FACE).box(1, 2, 4, 3, 1, 2, FACE).set(2, 2, 6, FACE);              // the long muzzle
  h.set(1, 1, 8, 0x2a1e1a).set(3, 1, 8, 0x2a1e1a).box(2, 0, 8, 1, 2, 1, FACE);
  h.box(0, 3, 4, 5, 1, 1, FUR);                                                             // the heavy brow
  h.set(1, 2, 4, 0xf0a020).set(3, 2, 4, 0xf0a020);                                          // amber eyes
  h.set(0, 4, 1, FUR).set(4, 4, 1, FUR);                                                    // ears
  const tail = new VoxelModel().line(0, 0, 0, 0, 3, -2, FUR).line(0, 3, -2, 0, 4, -5, FUR).line(0, 4, -5, 0, 1, -7, FUR).box(0, 0, -8, 1, 2, 1, FACE);
  const up = () => new VoxelModel().box(0, 0, 0, 2, 5, 2, FUR);
  const low = (front) => new VoxelModel().box(0, 1, 0, 2, 6, 2, front ? CAPE : FUR).box(0, 0, -0, 2, 1, 3, FACE);
  rig('baboon_of_set', { voxel: 0.06, anim: 'horse', style: 'baboon', gait: 1.3, stride: 0.8 }, [
    part('body', body, [3, 0, 6], [0, 9, 0]),
    part('neck', neck, [2, 0, 1], [0, 7, 6], 'body'),
    part('head', h, [2.5, 1, 1.5], [0, 2.5, 2.5], 'neck', { rest: [-0.15, 0, 0] }),
    part('tail', tail, [0.5, 0, 0], [0, 4.5, -4], 'body'),
    part('legFL', up(), [1, 5, 1], [2, 2, 4.5], 'body'),
    part('cannonFL', low(true), [1, 7, 1], [0, -4, 0], 'legFL'),
    part('legFR', up(), [1, 5, 1], [-2, 2, 4.5], 'body'),
    part('cannonFR', low(true), [1, 7, 1], [0, -4, 0], 'legFR'),
    part('legBL', up(), [1, 5, 1], [2, 1, -2], 'body'),
    part('cannonBL', low(false), [1, 7, 1], [0, -4, 0], 'legBL'),
    part('legBR', up(), [1, 5, 1], [-2, 1, -2], 'body'),
    part('cannonBR', low(false), [1, 7, 1], [0, -4, 0], 'legBR'),
  ]);
}

// Petsuchos (four-legged rig, 0.09, sprawl): a long crocodile with a jewelled
// gold and team collar, a horned sun-disc crown, bronze girth straps, team
// anklets and a team tail tip (myth_04).
// (round 19) a low sprawling reptile: the flat body's belly one voxel off the
// ground; each upper limb reaches out sideways level from the body's flank,
// the forearm angles down and a little out to a wide flat foot of the body's
// brown with four short cream claws fanned at its front and outer edge (no
// black foot blocks); the tail's three segments (anim tailA / tailB / tailC,
// so they never take the horse's drooping tail pitch) have flat undersides
// that sink gently to lie on the ground, ridged with two rows of scutes and a
// spiky team crest on the tip.
{
  const CROC = (x, y, z) => { const h = hash3(x, y, z, 71); const ridge = (z & 1) && y >= 4; return ridge ? 0x543a20 : h < 0.5 ? 0x7a5632 : h < 0.85 ? 0x6c4c2c : 0x86623c; };
  const BELLY = 0xc8aa7a;
  const SIDE = pick3(72, 0x9a744a, 0x8e6a44, 0xa47e52);   // the lighter flank above the belly
  const SCUTE = 0x3e2a18;
  const FOOT = pick3(73, 0x5e4228, 0x563c24, 0x66482c);
  const CLAW = 0xd8c49a;
  const body = new VoxelModel();
  // a flat, wide body (9 wide, 5 tall), widest behind the forelegs, narrowing
  // to the neck and to the tail's base
  const half = (z) => z < 5 ? 3.2 + z * 0.22 : z > 17 ? 4.3 - (z - 17) * 0.2 : 4.3;
  for (let z = 0; z <= 22; z++) {
    const w = half(z);
    for (let x = -5; x <= 5; x++) for (let y = 0; y <= 4; y++) {
      const dx = Math.abs(x) / (w + 0.4), dy = Math.abs(y - 2) / 2.7;
      if (Math.pow(dx, 2.6) + Math.pow(dy, 2.6) > 1) continue;
      body.set(x, y, z, y === 0 ? BELLY : y === 1 && Math.abs(x) >= w - 1 ? SIDE : CROC(x, y, z));
    }
  }
  // two rows of raised dark scutes down the spine and a row along each flank's top
  for (let z = 1; z <= 21; z += 2) {
    body.set(-1, 5, z, SCUTE).set(1, 5, z, SCUTE);
    for (const s of [-1, 1]) { let x = 5 * s; while (x !== 0 && !body.has(x, 4, z)) x -= s; if (x !== 0) body.set(x, 4, z, SCUTE); }
  }
  // bronze girth straps round the body (behind the forelegs, before the hind legs)
  for (const zb of [11, 15]) for (let x = -6; x <= 6; x++) for (let y = 0; y <= 6; y++) {
    if (!body.has(x, y, zb)) continue;
    if (!body.has(x + 1, y, zb) || !body.has(x - 1, y, zb) || !body.has(x, y + 1, zb)) body.set(x, y, zb, y === 0 ? BELLY : BRONZE(x, y, zb));
  }
  const neck = new VoxelModel();
  // a long flat head: snout, teeth, eyes up top
  for (let z = 0; z <= 13; z++) {
    const w = z < 5 ? 3.4 : 2.6 - (z - 5) * 0.08, h = z < 5 ? 2.6 : 1.8;
    for (let x = -4; x <= 4; x++) for (let y = 0; y <= 5; y++) {
      const dx = x / w, dy = (y - 2) / h;
      if (dx * dx + dy * dy <= 1) neck.set(x, y, z, y <= 1 ? BELLY : CROC(x, y, z));
    }
  }
  for (let z = 6; z <= 13; z += 2) { neck.set(-2, 1, z, 0xf2ead4).set(2, 1, z, 0xf2ead4); }
  neck.set(-2, 4, 4, 0xffd020, { glow: 0.6 }).set(2, 4, 4, 0xffd020, { glow: 0.6 });
  // the jewelled collar (gold rim, team stones) round the neck
  for (let y = -1; y <= 6; y++) for (let x = -5; x <= 5; x++) {
    const d = Math.hypot(x / 4.6, (y - 2.5) / 3.6);
    if (d > 1.05 || d < 0.62) continue;
    neck.set(x, y, -1, d > 0.92 ? GOLD(x, y, 0) : ((x + y) % 2 ? TEAM : GOLD(x, y, 1)));
  }
  // horned crown with a sun disc
  neck.box(-1, 5, 1, 3, 1, 3, GOLD).box(-3, 6, 2, 1, 2, 1, GOLD).box(3, 6, 2, 1, 2, 1, GOLD).set(-4, 8, 2, GOLD).set(4, 8, 2, GOLD);
  neck.ellipsoid(0, 8, 2, 1.4, 1.4, 0.4, TEAM).set(0, 8, 3, GOLD);
  // a tail segment 8 long tapering r0 -> r1; its underside sinks `drop` voxels
  // over its length (so the chain lies on the ground); returns the model and
  // the next segment's joint
  const tail = (r0, r1, drop, tip) => {
    const m = new VoxelModel();
    const yc = (z) => (r0 + (r1 - r0) * (z / 8)) - r0 - drop * (z / 8);
    for (let z = 0; z < 8; z++) {
      const r = r0 + (r1 - r0) * (z / 8), c = yc(z);
      for (let x = -3; x <= 3; x++) for (let y = -4; y <= 4; y++) {
        const dy = y - c;
        if (x * x * 0.8 + dy * dy > r * r + 0.3) continue;
        m.set(x, y, -z, tip && z > 3 ? TEAM : dy < -r * 0.45 ? BELLY : CROC(x, y, z));
      }
      const top = Math.round(c + r);
      if (z % 2 === 0) {
        if (tip && z > 1) m.set(0, top + 1, -z, TEAM).set(0, top + 2, -z, TEAM);   // the tip's spiky crest
        else if (r > 1.3) m.set(-1, top, -z, SCUTE).set(1, top, -z, SCUTE);
        else m.set(0, top + 1, -z, SCUTE);
      }
    }
    if (!tip && r0 > 2) {
      // a bronze strap round the tail's root
      for (let x = -3; x <= 3; x++) for (let y = -4; y <= 4; y++) if (m.has(x, y, -2)) m.set(x, y, -2, BRONZE(x, y, 2));
    }
    return { m, next: [0, yc(8), -8] };
  };
  const T1 = tail(2.4, 1.8, 0.6, false), T2 = tail(1.8, 1.1, 0.4, false), T3 = tail(1.1, 0.5, 0.2, true);
  // a sprawling limb, side s (+1 = left, +x): the upper limb runs level out
  // from the flank, 4 long; the forearm drops from the elbow to the ground,
  // leaning out one voxel, with a team anklet; a flat foot 4 wide on the
  // ground with four cream claws
  const upper = (s) => {
    const m = new VoxelModel();
    for (let i = 0; i < 4; i++) m.box(s * i, 0, 0, 1, 2, i < 3 ? 3 : 2, CROC);
    for (let i = 0; i < 3; i++) m.set(s * i, 0, 1, SIDE);   // the lighter underside
    return m;
  };
  const lower = (s, front) => {
    const m = new VoxelModel();
    m.box(0, 3, 0, 1, 1, 2, CROC).box(s, 3, 0, 1, 1, 2, CROC);          // the elbow (under the upper limb's end)
    tbox(m, 0, 2, 0, 1, 1, 2, TEAM_SHADE).box(s, 2, 0, 1, 1, 2, TEAM);   // the team anklet
    m.box(s, 1, 0, 1, 1, 2, CROC).box(2 * s, 1, 0, 1, 1, 2, CROC);      // leaning out
    // the flat foot: 4 wide (x s..4s), 3 deep (z -1..1), toes forward
    for (let i = 1; i <= 4; i++) for (let k = front ? -1 : -1; k <= 1; k++) m.set(s * i, 0, k, FOOT);
    // claws: three toes forward, one splayed out to the side
    m.set(s * 1, 0, 2, CLAW).set(s * 2.0, 0, 2, FOOT).set(s * 2, 0, 3, CLAW).set(s * 3, 0, 2, CLAW).set(s * 5, 0, 1, CLAW);
    return m;
  };
  rig('petsuchos', { voxel: 0.09, anim: 'horse', style: 'croc', gait: 0.7, stride: 0.55, graze: false, sprawl: true }, [
    part('body', body, [0, 0, 11], [0, 1, 0]),
    part('neck', neck, [0, 2, 0], [0, 1.2, 11], 'body'),
    part('tail', T1.m, [0, 0, 0], [0, 2.4, -11], 'body', { anim: 'tailA' }),
    part('tail2', T2.m, [0, 0, 0], T1.next, 'tail', { anim: 'tailB' }),
    part('tail3', T3.m, [0, 0, 0], T2.next, 'tail2', { anim: 'tailC' }),
    part('legFL', upper(1), [0, 1, 1], [3.4, 2, 7.5], 'body'),
    part('cannonFL', lower(1, true), [0.5, 3, 1], [3.5, 0, 0], 'legFL'),
    part('legFR', upper(-1), [1, 1, 1], [-3.4, 2, 7.5], 'body'),
    part('cannonFR', lower(-1, true), [0.5, 3, 1], [-3.5, 0, 0], 'legFR'),
    part('legBL', upper(1), [0, 1, 1], [3.4, 2, -6.5], 'body'),
    part('cannonBL', lower(1, false), [0.5, 3, 1], [3.5, 0, 0], 'legBL'),
    part('legBR', upper(-1), [1, 1, 1], [-3.4, 2, -6.5], 'body'),
    part('cannonBR', lower(-1, false), [0.5, 3, 1], [-3.5, 0, 0], 'legBR'),
  ]);
}

// Scarab (six-legged rig, 0.1): a giant stag-scarab (myth_07 / myth_14).
// Round 21: no scattered hues. The elytra are two smooth symmetric domes, one
// each side of a dark seam, in one metallic green ramp (a near-black rim row
// overhanging the dark belly, bottle green low on the flanks, emerald, a light
// green on each crown and a yellow-green glint on its top); one team-colour
// pattern repeated mirror-exact on both halves (an oblique streak and a rear
// spot, like Retold's blue marks). A rounded bronze-green pronotum, a dark head
// with pale yellow eyes and great curved stag mandibles (an inner tooth each,
// lighter on top); six jointed legs that leave the body sideways, rise to a
// knee and taper down and out to clawed tarsi, the front pair reaching
// forward, the hind pair back.
{
  const S_RIM = 0x07160e, S_LOW = 0x0f3420, S_MID = 0x1a5c30, S_HI = 0x369a46, S_GLINT = 0x80c858, S_SEAM = 0x040a06;
  const CH_D = 0x1c1610, CH_M = 0x2c2218, CH_L = 0x45362a;
  const PR_D = 0x1a2416, PR_M = 0x2e3e22, PR_L = 0x55682e;
  const body = new VoxelModel();
  // the belly: a dark chitin keel under the shell, narrower than the shell
  body.ellipsoid(6, 2.2, 9.5, 4.6, 2.2, 7.6, (x, y) => (y >= 3 ? CH_M : CH_D));
  // the elytra: per elytron a dome centred 2.4 out from the seam (d = |x - 6|),
  // long and round at the rear, square-shouldered at the front (a superellipse)
  // each elytron an oval dome: footprint an ellipse (rx 4.3 about 2.5 out from
  // the seam, round at the rear, square-shouldered at the front), height a
  // smooth cap over it, so both domes meet low at the seam
  const ZC = 9.5, BASE = 3, HT = 6.2;
  const elyH = (x, z) => {
    const d = Math.abs(x - 6), u = (d - 2.5) / 4.3;
    const w = z < ZC ? (ZC - z) / 9.8 : (z - ZC) / 8.6;
    const q = 1 - u * u - (z < ZC ? w * w : w * w * w * w);
    if (q <= 0) return -1;
    return HT * Math.sqrt(q);
  };
  for (let z = 0; z <= 18; z++) for (let x = 0; x <= 12; x++) {
    const h = elyH(x, z);
    if (h < 0) continue;
    const top = Math.round(BASE + h);
    for (let y = BASE; y <= top; y++) {
      const f = (y - BASE) / HT;
      let c = f < 0.35 ? S_LOW : f < 0.75 ? S_MID : S_HI;
      if (y === BASE) c = S_RIM;
      body.set(x, y, z, c);
    }
  }
  // the darker rim: the lowest shell row and every outermost voxel of the row
  // above it, so the shell's edge reads as a lip over the body
  for (let z = 0; z <= 18; z++) for (let x = 0; x <= 12; x++) {
    if (body.get(x, BASE + 1, z) && !body.has(x + (x < 6 ? -1 : 1), BASE + 1, z)) body.set(x, BASE + 1, z, S_RIM);
  }
  const topY = (x, z) => { let y = 12; while (y > BASE && !body.has(x, y, z)) y--; return y; };
  // a glint on each crown (the same two places on both halves)
  for (const x of [3, 9]) for (const z of [10, 11, 12, 13, 14]) { const y = topY(x, z); if (y > BASE + 3) body.set(x, y, z, S_GLINT); }
  // the pattern: an oblique team streak across each elytron and a rear spot,
  // mirrored exactly (painted by d = |x - 6|)
  for (let z = 0; z <= 18; z++) for (let x = 0; x <= 12; x++) {
    const d = Math.abs(x - 6);
    if (d === 0) continue;
    const streak = d >= 1 && d <= 5 && Math.abs((z - 6.5) - (d - 1) * 0.75) < 0.85;
    const spot = (d - 3) * (d - 3) + (z - 2.5) * (z - 2.5) <= 1.3;
    if (!streak && !spot) continue;
    const y = topY(x, z);
    if (y <= BASE + 1) continue;
    body.set(x, y, z, TEAM, { glow: 0.08 });
    const v = body.get(x, y - 1, z);
    if (v && !v.team && !body.has(x + (x < 6 ? -1 : 1), y - 1, z)) { body.set(x, y - 1, z, TEAM); body.get(x, y - 1, z).c = TEAM_SHADE; }
  }
  // the seam: the dark line between the wing cases, two voxels deep
  for (let z = 0; z <= 18; z++) { const y = topY(6, z); if (y > BASE) { body.set(6, y, z, S_SEAM); body.set(6, y - 1, z, S_SEAM); } }
  // the pronotum: a rounded shield in front of the elytra, a dark gap between
  for (let z = 19; z <= 23; z++) for (let x = 1; x <= 11; x++) {
    const dx = (x - 6) / 5.2, dz = (z - 19.5) / 4.6;
    const q = 1 - dx * dx * dx * dx - dz * dz;
    if (q <= 0) continue;
    const top = Math.round(BASE - 0.5 + 4.2 * Math.sqrt(q));
    for (let y = BASE - 1; y <= top; y++) body.set(x, y, z, y >= top && q > 0.55 ? PR_L : y >= top - 1 ? PR_M : PR_D);
  }
  for (let x = 2; x <= 10; x++) { const y = topY(x, 19); if (y >= BASE) body.set(x, y, 19, PR_D); }
  for (const x of [4, 8]) body.set(x, topY(x, 21), 21, S_GLINT);
  // the head (neck channel): a dark wedge, pale yellow eyes on its sides,
  // two great curved mandibles reaching forward and closing at the tips
  const headM = new VoxelModel();
  headM.ellipsoid(0, 2.5, 2.4, 3.6, 2.4, 2.8, (x, y) => (y >= 4 ? CH_L : y >= 2 ? CH_M : CH_D));
  headM.box(-2, 4, 3, 5, 1, 2, CH_L);                          // a ridge across the brow
  for (const s of [-1, 1]) {
    headM.set(s * 4, 3, 2, 0xe8e070, { glow: 0.55 }).set(s * 4, 3, 3, 0xe8e070, { glow: 0.55 }).set(s * 4, 4, 2, 0xc8c058, { glow: 0.4 });
    headM.set(s * 4, 2, 3, CH_D);
  }
  const MAND = (x, y, z, t) => (t > 0.85 ? 0x1a100a : y >= 3 ? 0x6a4428 : 0x40281a);
  for (const s of [-1, 1]) {
    tube(headM, [s * 2.2, 2.2, 4.5], [s * 5.2, 2.6, 8.2], 1.5, 1.15, MAND);
    tube(headM, [s * 5.2, 2.6, 8.2], [s * 4.8, 3.0, 12.2], 1.15, 0.85, MAND);
    tube(headM, [s * 4.8, 3.0, 12.2], [s * 2.0, 3.0, 14.2], 0.85, 0.45, MAND);
    tube(headM, [s * 5.0, 2.6, 10.0], [s * 3.2, 2.6, 10.8], 0.6, 0.35, MAND);   // the inner tooth
  }
  // six legs: the femur leaves the body sideways and rises to the knee, the
  // tibia angles down and out (two outer spurs), the tarsus reaches on to a
  // claw on the ground; each segment thinner than the last
  const LEG_C = (x, y, z, t) => (y >= 0 ? CH_L : CH_M);
  const legs = [];
  const leg = (nm, ch, zj, zdir) => {
    for (const s of [1, -1]) {
      const fem = new VoxelModel();
      tube(fem, [0, 0, 0], [s * 4.6, 1.6, zdir * 1.4], 1.35, 1.0, LEG_C);
      const tib = new VoxelModel();
      const k = [s * 3.0, -5.0, zdir * 2.0], f = [s * 4.6, -6.6, zdir * 3.4];
      tube(tib, [0, 0, 0], k, 1.0, 0.72, (x, y, z, t) => (t < 0.3 ? CH_L : CH_M));
      tube(tib, k, f, 0.72, 0.55, CH_D);
      for (const t of [0.35, 0.65]) tib.set(Math.round(k[0] * t + s), Math.round(k[1] * t), Math.round(k[2] * t), CH_D);
      tib.set(Math.round(f[0] + s * 0.6), Math.round(f[1]), Math.round(f[2] + zdir * 0.6), 0x120c08);
      const L = `${s > 0 ? 'L' : 'R'}`;
      const c = ch[s > 0 ? 0 : 1];
      legs.push(part(`leg${nm}${L}`, fem, [0, 0, 0], [s * 4.4, 1.5, zj], 'body', { anim: `leg${c}` }));
      legs.push(part(`cannon${nm}${L}`, tib, [0, 0, 0], [s * 4.6, 1.6, zdir * 1.4], `leg${nm}${L}`, { anim: `cannon${c}` }));
    }
  };
  leg('F', ['FL', 'FR'], 6.5, 1.3);
  leg('M', ['BR', 'BL'], 2.5, 0.1);
  leg('B', ['BL', 'BR'], -1.5, -1.6);
  rig('scarab', { voxel: 0.1, anim: 'horse', style: 'beetle', gait: 1.1, stride: 0.6 }, [
    part('body', body, [6, 0, 9], [0, 3, 0]),
    part('neck', headM, [0, 1.5, 0], [0, 2.2, 14.6], 'body'),
    ...legs,
  ]);
}

// Scorpion Man (four-legged rig, 0.09): a man's torso (bronze skin, a gold
// collar, a shaved head) on a scorpion's body of team and white plates, eight
// long dark legs, two big chelae and a tail curled over the back (myth_08).
// Round 22: the tail is six team plates that taper (radius 1.9 -> 0.95, length
// 4.6 -> 2.8) along a C-arc up from the rump and forward over the back, each a
// solid plate with one pale line along the arc's outer edge and a darker rim
// where it meets the next, ending in a maroon bulb with a dark barb hooking
// down; its joints use the tailA/B/C channels (the rig's `sting` flag sways and
// strikes with them), never the horse's tail channel, which bent all six joints
// down and sideways at once (the "broken pipe"). Each leg is a femur rising out
// to a high knee and a long tibia angled out and down to a point on the ground,
// near-black with a slate highlight line on top; the chelae are a palm with a
// fixed and a movable finger round a gap, slate with a lighter top and dark tips;
// the rider is shaved (no wig or headband: myth_08).
{
  // (round 16) myth_08: team plates across the back, each 3 voxels long with a dark chitin seam and
  // its rear row a shade darker (the plates overlap), the lower flanks white
  const PLATE = (x, y, z) => (y <= 2 ? 0xeceae2 : z % 3 === 0 && y >= 3 ? 0x24222a : TEAM);
  const BELLY = 0xbdb8ac;
  const body = new VoxelModel();
  for (let z = 0; z <= 16; z++) {
    const w = 3.6 - Math.abs(z - 8) * 0.06;
    for (let x = -4; x <= 10; x++) for (let y = 0; y <= 6; y++) {
      const dx = (x - 3) / w, dy = (y - 3) / 2.6;
      if (dx * dx + dy * dy <= 1) body.set(x, y, z, y <= 1 ? BELLY : PLATE(x, y, z));
    }
  }
  for (let z = 0; z <= 16; z++) for (let x = -4; x <= 10; x++) for (let y = 2; y <= 6; y++) { const v = body.get(x, y, z); if (v && v.team && z % 3 === 1) v.c = TEAM_SHADE; }
  // the chelae (they move with the "neck" channel): a two-part arm out and
  // forward, a swollen palm, a fixed outer finger and a movable inner one
  // curving towards each other round a clear gap
  const CL = 0x2a2630, CL_L = 0x4e4858, CL_D = 0x100c12;
  const clawC = (cy) => (x, y) => (y >= cy + 1 ? CL_L : CL);
  const pin = new VoxelModel();
  for (const s of [-1, 1]) {
    tube(pin, [s * 3, 2, 0], [s * 6, 3, 3.5], 0.9, 0.9, clawC(3));
    tube(pin, [s * 6, 3, 3.5], [s * 5.5, 3, 7.5], 0.95, 1.2, clawC(3));
    for (let x = -8; x <= 8; x++) for (let y = 0; y <= 6; y++) for (let z = 7; z <= 14; z++) {
      const dx = (x + 0.5 - s * 5.4) / 2.1, dy = (y + 0.5 - 3.3) / 1.9, dz = (z + 0.5 - 10.3) / 2.4;
      if (dx * dx + dy * dy + dz * dz <= 1) pin.set(x, y, z, y >= 4 ? CL_L : CL);
    }
    // the fixed finger (outer) and the movable finger (inner), tips dark and turned in
    tube(pin, [s * 6.6, 3.5, 11.8], [s * 6.8, 3.5, 15.2], 1.0, 0.6, (x, y, z, t) => (t > 0.75 ? CL_D : y >= 4 ? CL_L : CL));
    tube(pin, [s * 6.8, 3.5, 15.2], [s * 5.6, 3.5, 16.4], 0.6, 0.45, CL_D);
    tube(pin, [s * 3.4, 3, 11.8], [s * 2.6, 3, 14.6], 0.9, 0.5, (x, y, z, t) => (t > 0.75 ? CL_D : CL));
    tube(pin, [s * 2.6, 3, 14.6], [s * 3.4, 3, 15.8], 0.5, 0.45, CL_D);
  }
  // the tail: six tapering plates on a C-arc, angle a measured from straight
  // back (0) through up (pi/2) to forward (pi); the pale line runs along the
  // arc's outer side (-cos a, -sin a in y, z)
  const ANG = [1.05, 1.6, 2.15, 2.65, 3.15, 3.7];
  const LEN = [4.6, 4.3, 3.9, 3.5, 3.1, 2.8];
  const RAD = [1.9, 1.7, 1.5, 1.3, 1.12, 0.95];
  const T_RIM = TEAM_SHADE, T_LINE = 0xe6e8ee;
  const dirOf = (i) => [0, Math.sin(ANG[i]) * LEN[i], -Math.cos(ANG[i]) * LEN[i]];
  const tseg = (i) => {
    const m = new VoxelModel();
    const d = dirOf(i), a = ANG[i], r = RAD[i], r1 = RAD[i + 1] || r * 0.85;
    const ou = [0, -Math.cos(a), -Math.sin(a)];
    const back = [0, -d[1] / LEN[i] * 0.7, -d[2] / LEN[i] * 0.7];   // overlap the joint so a bend stays closed
    const shade = [];   // team voxels a step darker (tset after the tube)
    const SH = (x, y, z) => { shade.push([x, y, z]); return TEAM; };
    tube(m, back, d, r, r1 + 0.05, (x, y, z, t) => {
      const py = y + 0.5, pz = z + 0.5;
      const along = (py * d[1] + pz * d[2]) / (LEN[i] * LEN[i]);
      const cy = d[1] * along, cz = d[2] * along;
      const o = (py - cy) * ou[1] + (pz - cz) * ou[2];
      if (along > 0.84) return SH(x, y, z);                              // the plate's rim, under the next plate
      if ((x === 0 || x === -1) && o > r * 0.7) return T_LINE;                         // one light line along the outer edge
      if (o < -r * 0.4) return SH(x, y, z);                              // the inner (shaded) side a step darker
      return TEAM;
    });
    for (const [x, y, z] of shade) if (m.get(x, y, z)?.team) m.get(x, y, z).c = T_RIM;
    if (i === 5) {
      // the venom bulb, maroon with a lighter top, and a dark barb hooking down and back
      const bc = [d[0], d[1] - 1.2, d[2] + 0.6];
      for (let x = -3; x <= 3; x++) for (let y = -6; y <= 4; y++) for (let z = -3; z <= 6; z++) {
        const dx = (x + 0.5 - bc[0]) / 1.55, dy = (y + 0.5 - bc[1]) / 1.7, dz = (z + 0.5 - bc[2]) / 1.75;
        if (dx * dx + dy * dy + dz * dz <= 1) m.set(x, y, z, y + 0.5 > bc[1] + 0.6 ? 0x9a4440 : 0x6e2426);
      }
      const b0 = [0, Math.round(bc[1] - 2), Math.round(bc[2] + 0.4)];
      for (const x of [-1, 0]) m.set(x, b0[1], b0[2], 0x241418).set(x, b0[1], b0[2] - 1, 0x241418);   // the barb's base
      m.set(0, b0[1] - 1, b0[2], 0x160c10).set(-1, b0[1] - 1, b0[2], 0x160c10).set(0, b0[1] - 2, b0[2] - 1, 0x0e080a).set(0, b0[1] - 3, b0[2] - 2, 0x0e080a);
    }
    return m;
  };
  const tail = [];
  let prev = 'body';
  const TCH = ['tailA', 'tailA', 'tailB', 'tailB', 'tailC', 'tailC'];
  for (let i = 0; i < 6; i++) {
    const nm = i ? `tail${i + 1}` : 'tail';
    tail.push(part(nm, tseg(i), [0, 0, 0], i ? dirOf(i - 1) : [0, 4, -7.5], prev, { anim: TCH[i] }));
    prev = nm;
  }
  // the legs: a femur rising out to a high knee, a long tibia angled out and
  // down to a point on the ground; near-black, a slate line along the top
  const LG = 0x1c1a22, LG_L = 0x4a4858, LG_D = 0x0e0c10;
  const legs = [];
  const LCH = [['FL', 'FR'], ['BR', 'BL'], ['FL', 'FR'], ['BR', 'BL']];
  const SPREAD = [1.8, 0.6, -0.6, -1.8];   // the front legs reach forward, the back ones back
  [5, 1.5, -2, -5.5].forEach((z, i) => {
    for (const s of [1, -1]) {
      const ch = s > 0 ? LCH[i][0] : LCH[i][1];
      const nm = `${s > 0 ? 'L' : 'R'}${i}`;
      const knee = [s * 4.2, 4.2, SPREAD[i]];
      const up = new VoxelModel(); tube(up, [0, 0, 0], knee, 0.95, 0.8, (x, y, z, t) => (y + 0.5 > t * knee[1] + 0.45 ? LG_L : LG));
      const foot = [s * 3.4, -11.6, SPREAD[i] * 1.2];
      const low = new VoxelModel();
      tube(low, [0, 0, 0], foot, 0.95, 0.7, (x, y, z, t) => (t > 0.76 ? LG_D : t < 0.12 ? LG_L : (s * (x + 0.5) > s * foot[0] * t + 0.3 ? LG_L : LG)));
      legs.push(part(`leg${nm}`, up, [0, 0, 0], [s * 3, 2, z], 'body', { anim: `leg${ch}` }));
      legs.push(part(`cannon${nm}`, low, [0, 0, 0], knee, `leg${nm}`, { anim: `cannon${ch}` }));
    }
  });
  const t = manTorso();
  eKilt(t, { color: OCHRE, side: 0xa87424, hem: GOLD, len: 3, fold: false }); eBelt(t, GOLD, GOLD_DK); eCollar(t, [GOLD, TM, TM, GOLD], { r0: 2.6 });
  rig('scorpion_man', { voxel: 0.09, anim: 'horse', style: 'scorpion', gait: 1.0, stride: 0.5, sting: true, graze: false }, [
    part('body', body, [3, 0, 8], [0, 6, -1]),
    part('neck', pin, [0, 0, 0], [0, 0, 7], 'body'),
    ...tail,
    ...legs,
    ...manParts({ torso: t, legs: false, torsoJoint: [0, 5, 7], torsoParent: 'body', head: 'shaved', arm: { bracer: GOLD, band: TEAM } }),
    part('weapon', khopeshFine({ metal: 0xa8682a, spine: 0x5a3414, edge: 0xffe8b0 }), [1, 0, 1], HAND_E, 'armR', { scale: 0.6, rest: [0.3, -1.57, 0.3] }),
  ]);
}

// Wadjet (serpent rig, 0.09): a winged cobra (myth_02). Round 16: no per-voxel
// alternation anywhere: the body is painted in broad zones (a light tan belly
// and lower flank along the whole coil, a mid-tan back, dark brown saddle bands
// 3 voxels long every 7 along the spine only) so each coil reads as one tube; a
// second, smaller coil rides on the first; the hood a dark brown flare with a
// darker rim and a light spectacle eye-spot behind, a pale throat in front;
// the head with a light jaw, a 2x2 dark eye with a 1-voxel glint each side, a
// brow ridge and a light snout tip; the wings: tan coverts with one dark edge
// row, a red chevron per feather, team feathers alternating in 3-wide quills,
// darker tips, and stepped primaries (each feather pointed and the outer four
// 2 voxels longer than the one before) so the trailing edge is jagged.
{
  const W_BELLY = 0xe8d49a, W_SIDE = 0xc89c4c, W_BACK = 0xa47434, W_BAND = 0x4e3420, W_BAND_D = 0x3a2616;
  const W_HOOD = 0x2e3248, W_HOOD_D = 0xc8963e, W_HOOD_F = 0x7a5428, W_HOOD_FD = 0x34241a, W_SPOT = 0xecd06a, W_THROAT = 0xf2e4b8;
  // a tube voxel's zone: u = the voxel's height in the tube (-1 belly .. 1 spine),
  // q = the distance along the tube (voxels), spine = on the top line
  const zone = (u, q, spine) => (u < -0.3 ? W_BELLY : u < 0.25 ? W_SIDE : (spine && ((Math.floor(q) % 7) + 7) % 7 < 3) ? W_BAND : W_BACK);
  const coil = new VoxelModel();
  const ring = (R, yc, r, turns, a0, n) => {
    for (let a = 0; a < n; a++) {
      const th = a0 + (a / n) * Math.PI * 2 * turns;
      const cx = Math.sin(th) * R, cz = Math.cos(th) * R - 1;
      const q = (a / n) * Math.PI * 2 * turns * R;
      const ri = Math.ceil(r);
      for (let y = -ri; y <= ri; y++) for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
        if (dx * dx + dz * dz + y * y > r * r + 0.5) continue;
        const spine = y >= ri - 1 && dx * dx + dz * dz <= 2;
        coil.set(Math.round(cx + dx), Math.round(yc + y), Math.round(cz + dz), zone(y / r, q, spine));
      }
    }
  };
  ring(4.5, 2, 2.2, 0.85, 0, 40);          // the ground coil
  ring(3.2, 4.6, 1.7, 0.55, 2.2, 28);      // a smaller coil riding on it (the overlap reads)
  // the rising neck base: a light front, a mid back with spine bands behind
  for (let y = 2; y <= 9; y++) { const r = 2.6 - (y - 2) * 0.1; for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= r * r) coil.set(x, y, z + 1, z >= 1 ? W_BELLY : z >= 0 ? W_SIDE : (Math.abs(x) <= 1 && z <= -1 && y % 7 < 3) ? W_BAND : W_BACK); }
  const seg = (len, r0, r1, q0) => { const m = new VoxelModel(); for (let z = 0; z < len; z++) { const r = r0 + (r1 - r0) * (z / len); for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= r * r + 0.3) m.set(x, y, -z, zone(y / Math.max(r, 1), q0 + z, Math.abs(x) <= 1 && y >= r * 0.4)); } return m; };
  // the neck and hood: the throat pale in front (+z), the back mid-tan with spine bands
  const hood = new VoxelModel();
  for (let y = 0; y <= 14; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 2.2 * 2.2) {
    hood.set(x + 4, y, z + 2, (z >= 1 && x === 0) ? (y % 5 === 2 ? W_BAND : W_THROAT) : z >= 0 ? W_SIDE : (Math.abs(x) <= 1 && y % 7 < 3) ? W_BAND : W_BACK);
  }
  // the flare: a broad shield two voxels deep: behind, dark slate (myth_02) in a gold rim with a light
  // spectacle mark; in front, a dark brown rim round a mid-brown face and the pale throat
  for (let y = 3; y <= 15; y++) {
    const w = Math.round(8.2 - Math.abs(y - 10.5) * 1.05);
    for (let x = -w; x <= w; x++) {
      const rim = Math.abs(x) >= w || y === 3 || y === 15;
      const spot = (y >= 9 && y <= 11 && Math.abs(x) >= 2 && Math.abs(x) <= 4) || (y === 12 && Math.abs(x) <= 3) || (y === 6 && Math.abs(x) % 3 === 1 && Math.abs(x) < 6);
      const cup = Math.abs(x) >= 6 ? 2 : Math.abs(x) >= 4 ? 1 : 0;   // the flare's wings cup forward round the neck
      hood.set(x + 4, y, cup, rim ? W_HOOD_D : spot ? W_SPOT : W_HOOD);
      // the front face: a pale throat down the middle, the flare's inner face a darker tan with two dark throat bars
      hood.set(x + 4, y, 1 + cup, rim ? W_HOOD_FD : Math.abs(x) <= 1 ? ((y === 6 || y === 7) ? W_BAND : W_THROAT) : W_HOOD_F);
    }
  }
  // the head: x 0..4, a light jaw, mid sides, a narrower crown with a dark scale cap, brow ridges
  const sh = new VoxelModel();
  for (let x = 0; x <= 4; x++) for (let z = 0; z <= 5; z++) {
    sh.set(x, 0, z, W_BELLY);
    for (let y = 1; y <= 2; y++) sh.set(x, y, z, W_SIDE);
  }
  for (let x = 1; x <= 3; x++) for (let z = 0; z <= 5; z++) sh.set(x, 3, z, z <= 2 ? W_BAND : W_BACK);
  sh.set(0, 3, 3, W_BAND_D).set(0, 3, 4, W_BAND_D).set(4, 3, 3, W_BAND_D).set(4, 3, 4, W_BAND_D);   // brows
  for (const x of [0, 4]) {
    sh.set(x, 1, 3, DARK).set(x, 1, 4, DARK).set(x, 2, 3, DARK).set(x, 2, 4, 0xfaf4e0);   // the eye and its glint
    sh.set(x, 1, 5, W_BAND_D);   // the mouth line
  }
  for (let x = 1; x <= 3; x++) for (let z = 6; z <= 7; z++) { sh.set(x, 0, z, W_THROAT); sh.set(x, 1, z, z === 7 ? W_THROAT : W_SIDE); }
  sh.set(1, 1, 7, DARK).set(3, 1, 7, DARK);                 // nostrils on the light snout tip
  sh.set(1, -1, 6, 0xf8f4e8).set(3, -1, 6, 0xf8f4e8);       // fangs
  hood.merge(sh, 2, 15, 1);
  const W_COV = 0x6a4a26, W_COV_L = 0x8e6834;   // the coverts a mid golden brown (no pale sticks)
  const wing = (s) => {
    const m = new VoxelModel();
    for (let i = 0; i <= 23; i++) {   // along the wing (outward), feathers 3 columns wide
      const f = Math.floor(i / 3), k = i % 3;
      const len = 9 + (f >= 4 ? (f - 3) * 2 + 1 : 0) - (2 - k);   // pointed feathers, stepped primaries
      for (let j = 0; j <= len; j++) {   // feather length (down / back)
        const wy = -Math.round(j * 0.55), wz = -j;
        if (j < 3) {   // the coverts: two scaled rows and a dark edge, thick only along the inner arm
          const c = j === 2 ? W_BAND : (f % 2 ? W_COV : W_COV_L);
          m.set(s * i, wy, wz, c);
          if (i < 12 && j < 2) m.set(s * i, wy + 1, wz, f % 2 ? W_COV : W_COV_L);
          continue;
        }
        if ((j === 4 && k !== 0) || (j === 5 && k === 1)) { m.set(s * i, wy, wz, RED); continue; }   // a red chevron per feather
        const tip = j > len - 2;
        if (tip) tset(m, s * i, wy, wz, 0x7a7a7a);
        else if (f % 2) tset(m, s * i, wy, wz, TEAM_SHADE);
        else m.set(s * i, wy, wz, TEAM);
      }
    }
    return m;
  };
  rig('wadjet', { voxel: 0.09, anim: 'medusa', style: 'wadjet', pose: 'serpent' }, [
    part('coil', coil, [0, 0, 0], [0, 0, 0]),
    part('tailA', seg(8, 2.2, 1.8, 0), [0, 0, 0], [-2, 2, -4], 'coil'),
    part('tailB', seg(8, 1.8, 1.2, 8), [0, 0, 0], [0, 0, -8], 'tailA'),
    part('tailC', seg(8, 1.2, 0.4, 16), [0, 0, 0], [0, 0, -8], 'tailB'),
    part('torso', hood, [4, 0, 2], [0, 9, 1], 'coil'),
    part('wingL', wing(1), [0, 0, 0], [2, 6, -4], 'torso'),
    part('wingR', wing(-1), [0, 0, 0], [-2, 6, -4], 'torso'),
  ]);
}

// (round 20) the birds (Phoenix, Roc) share one raptor build: each wing is an
// arm (wingL / wingR) and a hand (handL / handR, anim channels foreL / foreR,
// so the hand lags the arm on the beat and the wing bends). The arm is cambered
// (a two-voxel leading edge, the coverts raised one voxel, the flight feathers
// lower) and rises toward the wrist (dihedral); the chord tapers from the root
// to the wrist and on along the swept-back hand. The colour runs in feather
// tracts, not bands: light marginal coverts, mottled lesser coverts, a
// scalloped row of greater coverts, then the secondaries as two-voxel feathers
// of alternating length (a jagged trailing edge) whose tips alone carry a pale
// band and the team colour. Six primaries fan out from the hand as separate
// one-voxel strips (gaps open between them toward the tips, the tips curl up),
// again with the pale band and team colour on the tips only. Both sides are
// mirrored voxel for voxel (x -> -x - 1), so the wings match.
const raptorWing = (s, P) => {
  const X = (x) => (s > 0 ? x : -x - 1);
  const put = (m, x, y, z, c) => m.set(X(x), y, z, c, P.glow && (c === TEAM || c === P.band) ? { glow: P.glow } : undefined);
  const tract = (m, i, j, chord, k, rise) => {
    // one voxel column of a cambered wing section at span i, chord row j
    const last = j === chord, tip1 = j === chord - 1;
    let c;
    if (j === 0) c = P.lead;
    else if (j <= 2) c = P.lesser(i, j, 0);
    else if (j <= 4) c = j === 4 ? ((i + 1) % 3 === 0 ? P.scallop : P.coverTip) : P.greater;
    else if (last) c = TEAM;
    else if (tip1) c = P.band;
    else c = k % 2 ? P.sec : P.sec2;
    if (j === 0) { put(m, i, rise, -j, c); put(m, i, rise + 1, -j, c); }
    else if (j <= 4) put(m, i, rise + 1, -j, c);
    else if (j === 5) { put(m, i, rise, -j, c); put(m, i, rise + 1, -j, P.coverTip === c ? c : P.greater); }
    else put(m, i, rise, -j, c);
  };
  const arm = new VoxelModel();
  const ARM = P.arm;
  for (let i = 0; i < ARM; i++) {
    const k = i >> 1;
    const chord = Math.round(P.root - (i * (P.root - P.wrist)) / ARM) + (k % 2 ? 0 : 1);
    const rise = Math.floor(i * 0.2);
    for (let j = 0; j <= chord; j++) tract(arm, i, j, chord, k, rise);
  }
  const armRise = Math.floor(ARM * 0.2);
  const hand = new VoxelModel();
  for (let i = -1; i <= 6; i++) {
    const lz = -Math.round(Math.max(0, i) * 0.35);
    const chord = Math.max(3, Math.round(P.wrist - 1 - Math.max(0, i) * 0.5));
    for (let j = 0; j <= chord; j++) {
      const jj = j;
      let c = jj === 0 ? P.lead : jj <= 2 ? P.lesser(i, j, 1) : P.greater;
      if (jj === 3 && i % 2 === 0) c = P.coverTip;
      if (jj === 0) { put(hand, i, 0, lz - j, c); put(hand, i, 1, lz - j, c); }
      else if (jj <= 3) put(hand, i, 1, lz - j, c);
      else { put(hand, i, 0, lz - j, P.prim); put(hand, i, 1, lz - j, P.greater); }
    }
  }
  // the six primaries, fanned from the tip of the hand toward the trailing edge
  const LEN = [8, 9.5, 9.5, 9, 8, 7];
  for (let f = 0; f < 6; f++) {
    const th = -0.12 + f * 0.21;
    const bx = 6 - f * 0.55, bz = -2.6 - f * 0.95;
    const L = LEN[f] * P.primScale;
    for (let t = 0; t <= L; t += 0.5) {
      const u = t / L;
      const c = u > 0.8 ? TEAM : u > 0.64 ? P.band : f % 2 ? P.prim : P.prim2;
      const y = u > 0.72 ? 1 : 0;
      put(hand, Math.round(bx + Math.cos(th) * t), y, Math.round(bz - Math.sin(th) * t), c);
    }
  }
  return { arm, hand, armRise, armLen: ARM };
};
// a fanned tail of separate feathers with rounded, notched ends: dark vanes,
// a pale band and the team colour on the tips only
const raptorTail = (P) => {
  const m = new VoxelModel();
  const N = 7;
  for (let f = 0; f < N; f++) {
    const a = (f - (N - 1) / 2) * 0.16;
    const L = P.tailLen - Math.abs(f - (N - 1) / 2) * 0.7 + (f % 2 ? 0 : 0.6);
    for (let t = 0; t <= L; t += 0.5) {
      const u = t / L;
      const c = u > 0.86 ? TEAM : u > 0.72 ? P.band : f % 2 ? P.sec : P.sec2;
      const x = Math.round(Math.sin(a) * t * 1.25);
      m.set(x, Math.round(-t * 0.12), -Math.round(Math.cos(a) * t), c, P.glow && (c === TEAM) ? { glow: P.glow } : undefined);
    }
  }
  // the coverts over the root of the fan
  for (let z = 0; z >= -3; z--) for (let x = -1 - (z < -1 ? 1 : 0); x <= 1 + (z < -1 ? 1 : 0); x++) m.set(x, 1, z, P.greater);
  return m;
};
// an eagle's head on a neck: a hackled neck narrower than head and body, a
// round head with a dark brow ridge jutting over each eye (an amber eye with a
// dark pupil under it), a yellow cere and a three-voxel hooked beak whose upper
// mandible curves down over the lower to a dark point
const raptorHead = (body, P, z0, y0) => {
  for (let k = 0; k <= 3; k++) body.ellipsoid(0, y0 - 1 + k * 0.5, z0 + k * 0.7, 1.6, 1.6, 0.9, P.neck);
  const hz = z0 + 3.4, hy = y0 + 1.4;
  body.ellipsoid(0, hy, hz, 2.1, 1.9, 2.2, P.head);
  body.ellipsoid(0, hy + 1, hz - 0.6, 1.6, 1, 1.7, P.crown);
  const ez = Math.round(hz + 0.6), ey = Math.round(hy);
  for (const x of [-2, 2]) {
    const xo = x < 0 ? -1 : 1;
    body.set(x, ey, ez, 0xe8a020).set(x, ey, ez + 1, DARK);          // the eye, the pupil toward the beak
    body.set(x, ey + 1, ez - 1, P.brow).set(x, ey + 1, ez, P.brow).set(x, ey + 1, ez + 1, P.brow);   // brow ridge
    body.set(x + xo, ey + 1, ez + 1, P.brow);                                                     // jutting out
  }
  const bz = Math.round(hz + 2);
  body.box(-1, ey - 1, bz, 3, 2, 1, P.cere);                       // the cere
  body.box(0, ey - 1, bz + 1, 1, 2, 1, P.beak).set(-1, ey - 1, bz + 1, P.beak).set(1, ey - 1, bz + 1, P.beak);
  body.set(0, ey - 1, bz + 2, P.beak).set(0, ey, bz + 2, P.beak);  // the upper mandible running on
  body.set(0, ey - 2, bz + 2, P.beakTip).set(0, ey - 2, bz + 1, P.beakLow);   // the hook bending down over the lower mandible
  body.set(0, ey - 3, bz + 2, P.beakTip);
  return { hz, hy };
};
const raptorRig = (type, meta, body, P, extraParts) => {
  const L = raptorWing(1, P), R = raptorWing(-1, P);
  const [jx, jy, jz] = P.joint;
  rig(type, meta, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('wingL', L.arm, [0, 0, 0], [0.5 + jx, jy, jz], 'body'),
    part('handL', L.hand, [0, 0, 0], [L.armLen, L.armRise, 0], 'wingL', { anim: 'foreL' }),
    part('wingR', R.arm, [0, 0, 0], [0.5 - jx, jy, jz], 'body'),
    part('handR', R.hand, [0, 0, 0], [-R.armLen, R.armRise, 0], 'wingR', { anim: 'foreR' }),
    part('tail', raptorTail(P), [0, 0, 0], [0.5, 0.5, P.tailZ], 'body'),
    ...extraParts,
  ]);
};
const raptorLeg = (thigh, shank, claw) => {
  const m = new VoxelModel();
  m.ellipsoid(0, 3, 0, 1, 1.2, 1, thigh);                // the feathered "trousers"
  m.box(0, 0, 0, 1, 2, 1, shank);
  m.box(-1, -1, 1, 1, 1, 2, shank).box(1, -1, 1, 1, 1, 2, shank).box(0, -1, 1, 1, 1, 3, shank).box(0, -1, -1, 1, 1, 1, shank);
  m.set(-1, -2, 2, claw).set(1, -2, 2, claw).set(0, -2, 3, claw).set(0, -2, -1, claw);
  return m;
};

// Phoenix (flyer, 0.1): a bird of fire: a gold and orange body, the raptor
// wings in flame colours (gold coverts, orange and red flight feathers) with
// blue (team) flame on the feather tips, a flame crest, a long burning tail.
{
  const FIRE = (x, y, z) => { const h = hash3(x, y, z, 95); return h < 0.3 ? 0xd05010 : h < 0.7 ? 0xe8a018 : 0xe07810; };
  const P = {
    root: 9, wrist: 7, arm: 9, primScale: 1, tailLen: 14, tailZ: -5, joint: [2.5, 1.5, 2], glow: 0.12,
    lead: 0xf0c020, lesser: pick3(97, 0xe8a818, 0xf0b820, 0xe09810), greater: 0xe07810, scallop: 0xc03008, coverTip: 0xf0b820,
    sec: 0xd85010, sec2: 0xc03c08, prim: 0xd04810, prim2: 0xb83408, band: 0xf8d020,
    neck: pick3(98, 0xe8a018, 0xe07810, 0xf0b820), head: pick3(99, 0xe8a018, 0xe07810, 0xf0b820), crown: 0xf0c020, brow: 0xa82806,
    cere: 0xf0c020, beak: 0xf0d050, beakLow: 0xd0a020, beakTip: GOLD_DK,
  };
  const body = new VoxelModel();
  body.ellipsoid(0, 0, 0, 2.6, 2.4, 4.8, FIRE);
  body.ellipsoid(0, -1, 1, 2, 1.6, 3.4, 0xf0c020);              // the bright breast
  raptorHead(body, P, 4, 1.5);
  for (let i = 0; i < 6; i++) body.set(0, 5 + i, 6 - i, i > 3 ? TEAM : 0xf0b820, i > 3 ? { glow: 0.12 } : undefined);   // flame crest
  for (let i = 0; i < 4; i++) body.set(0, 4 + i, 5 - i, 0xd05010);
  // two long burning streamers trail past the tail fan
  const tail = raptorTail(P);
  for (let i = 0; i < 16; i++) for (const x of [-2, 2]) tail.set(x + Math.round(x * i * 0.06), -Math.round(i * 0.25), -i - 2, i > 12 ? TEAM : i > 7 ? 0xd05010 : 0xe8a018, i > 12 ? { glow: 0.12 } : undefined);
  const L = raptorWing(1, P), R = raptorWing(-1, P);
  const leg = raptorLeg(0xe07810, GOLD_DK, DARK);
  // (round 20) every flame voxel carries glow 0.8, the unit shader's fire
  // marker: it burns with its own light and keeps its orange through the
  // grade (which bleaches a lit saturated orange to salmon); the team flame
  // tips glow a little, the dark eyes, claws and beak tip stay unlit
  const burn = (m) => { for (const v of m.vox.values()) if (!v.team && v.c !== DARK && v.c !== GOLD_DK) v.glow = 0.8; return m; };
  for (const m of [body, tail, L.arm, L.hand, R.arm, R.hand, leg]) burn(m);
  rig('phoenix', { voxel: 0.1, anim: 'flyer', style: 'phoenix', hover: 16 }, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('wingL', L.arm, [0, 0, 0], [0.5 + P.joint[0], P.joint[1], P.joint[2]], 'body'),
    part('handL', L.hand, [0, 0, 0], [L.armLen, L.armRise, 0], 'wingL', { anim: 'foreL' }),
    part('wingR', R.arm, [0, 0, 0], [0.5 - P.joint[0], P.joint[1], P.joint[2]], 'body'),
    part('handR', R.hand, [0, 0, 0], [-R.armLen, R.armRise, 0], 'wingR', { anim: 'foreR' }),
    part('tail', tail, [0, 0, 0], [0.5, 0, P.tailZ], 'body'),
    part('legL', leg, [0.5, 3, 0], [1.6, -2, 0], 'body'),
    part('legR', leg, [0.5, 3, 0], [-0.6, -2, 0], 'body'),
  ]);
}

// Roc (flyer, 0.12): a giant eagle (myth_06): a dark brown body under a
// golden-tawny neck and head, broad cambered raptor wings in brown feather
// tracts with the team colour on the covert, secondary and primary tips, a
// fanned tail, yellow talons, carrying a round woven basket.
{
  const BR = pick3(96, 0x62401f, 0x5a3a1c, 0x6c4622);
  const P = {
    root: 10, wrist: 8, arm: 10, primScale: 1.1, tailLen: 10, tailZ: -5.5, joint: [3, 1.5, 2.5], glow: 0,
    lead: 0xa47a32, lesser: pick3(97, 0x84581c, 0x7a5018, 0x8e6222), greater: 0x5a3c1a, scallop: 0x3a2412, coverTip: 0x9a7030,
    sec: 0x4a3018, sec2: 0x402a14, prim: 0x3a2612, prim2: 0x32200f, band: 0xd8c8a0,
    neck: pick3(98, 0x9a6c24, 0x8e621e, 0xa6782a), head: pick3(99, 0x7a5420, 0x704c1c, 0x845c24), crown: 0xa47a32,
    brow: 0x2a1a0c, cere: 0xe0b030, beak: 0xe0d4a8, beakLow: 0xc0b088, beakTip: 0x3a3430,
  };
  const body = new VoxelModel();
  body.ellipsoid(0, 0, 0, 3.2, 2.8, 6, BR);
  body.ellipsoid(0, -1, 1.5, 2.4, 1.8, 4, 0x7a4c26);           // the breast a step lighter
  body.ellipsoid(0, 1.2, 0, 2.6, 2, 5.4, 0x4e3218);            // the darker mantle
  raptorHead(body, P, 5, 2);
  const basket = new VoxelModel();
  for (let y = 0; y <= 6; y++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    const d = Math.hypot(x, z);
    if (d > 5.3 || (d < 4.3 && y > 0)) continue;
    basket.set(x, y, z, y === 3 ? TEAM : (x + y + z) % 2 ? 0xc8986a : 0xb08050);
  }
  for (const [x, z] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) basket.line(x, 6, z, 0, 12, 0, ROPE());
  const leg = raptorLeg(0x6e4624, 0xd8b060, 0x2a2018);
  raptorRig('roc', { voxel: 0.12, anim: 'flyer', style: 'roc', hover: 26 }, body, P, [
    part('legL', leg, [0.5, 3, 0.5], [1.9, -2.5, 1], 'body'),
    part('legR', leg, [0.5, 3, 0.5], [-0.9, -2.5, 1], 'body'),
    part('basket', basket, [0, 12, 0], [0.5, -3, 1], 'body'),
  ]);
}

// ---- write -----------------------------------------------------------------------
const g = new Group('egypt_units');
g.extra.rigs = {};
for (const [type, R] of Object.entries(RIGS)) {
  const parts = R.parts.map((p) => ({ ...p, anim: p.anim || p.name }));
  for (const p of parts) p.parentIdx = p.parent ? parts.findIndex((q) => q.name === p.parent) : -1;
  for (const p of parts) if (p.parent && p.parentIdx < 0) throw new Error(`${type}/${p.name}: no parent ${p.parent}`);
  const { parts: _p, ...meta } = R;
  g.extra.rigs[type] = {
    ...meta, euler: 'XYZ',
    parts: parts.map((p) => {
      const o = {
        name: p.name, anim: p.anim, joint: p.joint, parent: p.parent, parentIdx: p.parentIdx,
        coat: !!p.coat, portrait: p.portrait ?? !p.conditional, conditional: !!p.conditional, mesh: `${type}/${p.name}`,
      };
      if (p.vary) o.vary = p.vary;
      if (p.rest) o.rest = p.rest;
      return o;
    }),
  };
  for (const p of parts) {
    // thinner lines on the small-voxel heads and the hand-held gear, so a line
    // never swallows a face or a haft
    // (thin enough that two soldiers side by side keep their own outlines and
    // a line never fills the gap between a torso and an arm)
    // (round 10: thinner again, about 1-2 px at RTS zoom, and drawn in dark
    // sienna by unit_outline.gdshader for every mesh with a width factor, so
    // the line between an arm and a torso stops flattening the figure into a
    // paper cut-out)
    // (round 12) one width for every part of every Egyptian unit (bodies,
    // heads, robes, gear), drawn in each surface's own shade
    // (unit_outline.gdshader), so no unit or part gets a heavier line
    const ol = 0.3;
    g.add(`${type}/${p.name}`, buildVoxelGeometry(p.model, { size: R.voxel * (p.scale || 1), pivot: p.pivot, jitter: p.jitter ?? 0.05, ao: p.ao ?? true }), { outline: ol });
  }
}
g.extra.unitTypes = Object.keys(RIGS);
g.write();
