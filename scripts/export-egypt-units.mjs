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
  // outlineAt(y): (round 33) a per-vertex factor on it by the model row
  // (a fine limb fading its line out at a joint)
  add(name, geo, { outline = 1, outlineAt = null, flatY = false } = {}) {
    if (this.models[name]) throw new Error(`duplicate model ${this.name}/${name}`);
    const a = geo.attributes;
    const n = a.position.count;
    const codes = outlineCodes(geo, { flatY });   // extra.b: the outline push per corner (outline-codes.mjs)
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4), ext = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = a.position.getX(i); pos[i * 3 + 1] = a.position.getY(i); pos[i * 3 + 2] = a.position.getZ(i);
      nor[i * 3] = a.normal.getX(i); nor[i * 3 + 1] = a.normal.getY(i); nor[i * 3 + 2] = a.normal.getZ(i);
      col[i * 4] = u8(toSRGB(a.color.getX(i))); col[i * 4 + 1] = u8(toSRGB(a.color.getY(i))); col[i * 4 + 2] = u8(toSRGB(a.color.getZ(i)));
      col[i * 4 + 3] = 255;
      ext[i * 4] = u8(a.team.getX(i));
      ext[i * 4 + 1] = u8(a.glow.getX(i));
      ext[i * 4 + 2] = codes[i];
      ext[i * 4 + 3] = Math.max(1, u8(outline * (outlineAt ? outlineAt(a.position.getY(i)) : 1)));
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
// (round 33) the head on the bodies' new lighter tan ramp (PAL_SKIN)
const SKIN = pick3(3, 0xac6234, 0xa85e32, 0xb06638);
const SKIN_SH = 0x8c4c2a;
const SKIN_FACE = pick3(35, 0xc67a48, 0xc27646, 0xca7e4c);
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
// (round 33) the sandal's lacing: a pale cream leather band round the ankle
// and a strap over the instep, so a leg breaks into thigh, shin and foot
const SANDAL_TIE = 0xe2c89a;
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
// (round 24) the Mummy's dried bronze face: lit plane, skull, shade
const MU_FACE_L = 0xb08258, MU_FACE_M = 0x8a6040, MU_FACE_D = 0x5e3e28;
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
// (round 24) the Mummy's nemes as a hood, not a box: a rounded dome over the
// skull (an elliptic shell narrowing towards a filled crown, myth_09's tall
// rounded headcloth), horizontal team bands with a pale line every third row
// (the crown banded front to back), a gold brow band and uraeus over the open
// face, and the cloth falling behind the ears: side wings that start behind
// the cheeks (z <= 3, the face stays clear) and flare a voxel out every
// three or four rows down to the shoulders, joined by a back curtain, the lowest row a dark
// shaded hem. Two lappets come forward over the shoulders onto the chest.
// (round 26) plain: the dome and the back curtain one solid team colour, the
// stripes kept on the side wings and the lappets only (no striped beehive)
function nemesH(m, { line = 0xf2ead2, chest = 8, tip = GOLD, plain = false } = {}) {
  const S = (y) => ((((y + 33) % 3) === 0) ? line : TEAM);
  const put = (x, y, z, c) => { if (c === TEAM) tset(m, x, y, z, 0xffffff); else if (c === 'sh') tset(m, x, y, z, TEAM_SHADE); else if (c === 'dk') tset(m, x, y, z, 0x8a8a8a); else m.set(x, y, z, c); };
  // the dome: y 5..10, the shell 1-1.4 voxels thick round the skull's centre
  for (let y = 5; y <= 11; y++) {
    // a round profile (not stepped in equal voxels like a pyramid)
    const k = y <= 7 ? 1 : Math.sqrt(Math.max(0, 1 - ((y - 7) / 4.6) ** 2));
    const rx = 4.3 * k + (y === 11 ? 0.4 : 0), rz = 3.9 * k + (y === 11 ? 0.4 : 0);
    for (let x = -2; x <= 8; x++) for (let z = -2; z <= 7; z++) {
      const nx = (x - 3) / rx, nz = (z - 2.5) / rz, d = nx * nx + nz * nz;
      if (d > 1) continue;
      const inner = ((x - 3) / (rx - 1.3)) ** 2 + ((z - 2.5) / (rz - 1.3)) ** 2;
      if (y < 11 && rx > 2.6 && inner < 1 && (m.has(x, y, z) || y >= 8)) continue;   // the skull inside (hollow under the crown)
      if (y < 7 && z >= 5) continue;                                       // the face open below the band
      put(x, y, z, plain ? TEAM : y >= 10 ? (((x + 33) % 3) === 1 ? line : TEAM) : S(y));
    }
  }
  for (let x = 0; x <= 6; x++) m.set(x, 6, 6, GOLD);
  m.set(-1, 6, 5, GOLD).set(7, 6, 5, GOLD);
  m.set(3, 7, 7, GOLD).set(3, 8, 7, GOLD).set(3, 9, 7, GOLD_DK);           // the uraeus rearing from the band (no red: it read as a pink nose)
  // the wings and the back curtain: from the temples (y 5) to the shoulders (y -4)
  for (let y = 5; y >= -4; y--) {
    const k = Math.min(2, Math.floor((5 - y) / 3.5));                   // a slight flare: a hood, not a bell
    const zb = -2 - (y < 2 ? 1 : 0);
    for (let x = -1 - k; x <= 7 + k; x++) for (let z = zb; z <= 3; z++) {
      const side = x <= -1 || x >= 7;
      if (!side && z !== zb) continue;                                   // the curtain is one layer at the back
      if (side && x > -1 - k && x < 7 + k && z > zb && z < 3 && m.has(x, y, z)) continue;
      const hem = y === -4;
      const edge = z === 3 && side;                                      // the front edge behind the cheek, shaded
      put(x, y, z, hem ? 'dk' : plain && !side ? TEAM : edge ? (S(y) === TEAM ? 'sh' : line) : S(y));
    }
  }
  // the lappets: 2 wide, forward over the shoulders, then down the chest
  for (const x0 of [-1, 6]) {
    for (let z = 3; z <= chest; z++) for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) put(x0 + dx, -4 - Math.floor((z - 3) * 0.3) + dy, z, S(-4 + dy));
    const yt = -4 - Math.floor((chest - 3) * 0.3);
    for (let y = yt - 1; y >= -8; y--) for (let dx = 0; dx < 2; dx++) put(x0 + dx, y, chest, S(y));
    m.box(x0, -9, chest, 2, 1, 1, tip);
  }
  return m;
}
function headE(style) {
  const m = new VoxelModel();
  const dark = style === 'merc' || style === 'mercCav';
  if (style === 'pharaoh') {
    // (round 32) a calm, regal mask in flat tones (no per-voxel jitter): two
    // kohl-lined eyes (a dark brown kohl line over each, an ivory outer corner
    // and a near-black pupil, a kohl tail on each side of the head), one
    // straight nose ridge standing a voxel proud in a lighter tone, the
    // cheeks and the nostrils plain face (the dark nostrils and lip read as a
    // gaping mouth), a short closed mouth in a muted lip tone; the narrow
    // braided false beard is hung under the chin by the crown below
    const F = 0xc68e5e, FS = 0xa87048, FL = 0xdaa676, KOHL = 0x2e1a10, PUP = 0x0c0806, LIPS = 0xa25e40, EYE_W = 0xeadfcc;
    faceN(m, F, FS, { eyes: [KOHL, PUP], brow: null, nose: F, face: F });
    for (const x of [1, 2, 4, 5]) m.set(x, 5, 5, KOHL).set(x, 3, 5, F).set(x, 2, 5, F);   // the kohl line over each eye
    m.set(1, 4, 5, EYE_W).set(2, 4, 5, PUP).set(4, 4, 5, PUP).set(5, 4, 5, EYE_W);
    m.set(0, 4, 4, KOHL).set(6, 4, 4, KOHL);                                       // the kohl tails
    m.set(3, 5, 5, F).set(3, 4, 5, F).set(3, 4, 6, FL).set(3, 3, 6, FL).set(3, 2, 6, F);   // the nose ridge
    m.set(2, 0, 5, F).set(3, 0, 5, F).set(4, 0, 5, F).set(3, 1, 5, LIPS);
    m.set(2, 1, 5, LIPS).set(4, 1, 5, LIPS);                                       // the closed mouth: one short line
  } else if (dark) {
    faceN(m, SKIN_DK, SKIN_DK_SH, { nose: 0x6e4632, face: 0x6c4632 });
    m.set(1, 3, 5, EYE_WHITE).set(2, 3, 5, DARK).set(4, 3, 5, DARK).set(5, 3, 5, EYE_WHITE);   // (round 33) eyes two rows tall
    for (const x of [1, 2, 4, 5]) m.set(x, 2, 5, 0x845a40);                                   // the lit cheekbone row
  } else {
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
    // (round 33) a face that fills the head block at RTS zoom: the eyes two
    // rows tall (an ivory outer column, a near-black pupil column), the brow
    // two deep (a dark row on the face under the proud ridge), one lit
    // cheekbone row under the eyes either side of the nose, no nostril
    // shadows, a short dark mouth
    m.set(1, 3, 5, 0xf6eee2).set(2, 3, 5, DARK).set(4, 3, 5, DARK).set(5, 3, 5, 0xf6eee2);
    for (const x of [1, 2, 4, 5]) m.set(x, 2, 5, 0xe0a070);                   // the highlight row
    m.set(3, 3, 6, 0xf0b07a).set(3, 2, 6, 0xe8a670);                            // the nose
    m.set(2, 1, 5, 0x5a2a16).set(3, 1, 5, 0x3a1810).set(4, 1, 5, 0x5a2a16);     // the mouth
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
    // (round 31, unit_03) an open face under a ribbed helmet: the helmet sits
    // a row higher and flush with the brow (it overhung and hid the face from
    // the RTS camera), so under it read a lit forehead row, an unbroken
    // near-black brow line standing a voxel proud, two dark eyes with white
    // corners, a light nose ridge standing two voxels out, nostril shadows
    // and a dark mouth; the helmet's ribs alternate gold and the army's colour
    capN(m, (x, y, z) => (y >= 8 ? (x & 1) : ((x + z) & 1)) ? TEAM : GOLD(x, y, z), { y0: 6, front: 7, top: 8 });
    for (let x = 0; x <= 6; x++) m.set(x, 7, 6, GOLD_DK);                        // the helmet's rim over the brow
    m.set(3, 9, 3, GOLD(0, 0, 0)).set(3, 9, 2, GOLD(1, 0, 0)).set(3, 9, 4, GOLD(2, 0, 0));   // a low gold ridge
    for (let x = 1; x <= 5; x++) m.set(x, 6, 5, SKIN_FACE(x, 6, 5));             // the forehead
    for (const x of [0, 1, 2, 4, 5, 6]) m.set(x, 5, 6, 0x1e0e06);                // the brow line
    m.set(3, 5, 6, 0x7a4424);                                                   // the bridge between the brows
    m.set(1, 4, 5, EYE_WHITE).set(2, 4, 5, DARK).set(4, 4, 5, DARK).set(5, 4, 5, EYE_WHITE);
    m.set(3, 4, 6, 0xf2b47e).set(3, 3, 6, 0xf2b47e).set(3, 2, 6, 0xe6a46e).set(3, 3, 7, 0xf8bc86);   // the nose
    m.set(2, 2, 5, 0x5a2c16).set(4, 2, 5, 0x5a2c16);
    m.set(2, 1, 5, 0x4a2014).set(3, 1, 5, 0x2e1008).set(4, 1, 5, 0x4a2014);
    m.box(-1, 2, 1, 1, 4, 3, GOLD_DK).box(7, 2, 1, 1, 4, 3, GOLD_DK);           // cheek guards behind the face
  } else if (style === 'camel') {
    // (round 29, unit_08) Retold's camel rider wears a tall cylindrical cap,
    // not a nemes: a dark leather band at the brow, a team band, a gold rim,
    // a tan felt crown rising four rows above the skull to a darker lid, so
    // the rider ends in a clean vertical post above the camel's hump
    const CAP = 0xa0703c, CAP_SH = 0x7e5428, LID = 0x5e3c1c;
    capN(m, (x, y, z) => (y <= 5 ? LEATHER_DK : y <= 7 ? TEAM : y === 8 ? GOLD(x, y, z) : (x === -1 || z === -1) ? CAP_SH : CAP), { y0: 5, front: 6, top: 12 });
    for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) if (m.has(x, 12, z)) m.set(x, 12, z, (x === 0 || x === 6 || z === 0 || z === 5) ? CAP_SH : LID);
    for (let y = 8; y <= 11; y++) for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) m.set(x, y, z, CAP);   // a solid crown
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
        // (round 32) gold discs in two clean rows (every third voxel round the
        // crown, the upper row offset), not a diagonal speckle
        if ((y === 8 || y === 11) && (x + z + (y === 11 ? 1 : 0)) % 3 === 0) m.set(x, y, z, PH_GOLD_L); else m.set(x, y, z, TEAM);
      }
    }
    m.box(-1, 6, 6, 9, 1, 1, PH_GOLD).carve(-1, 6, 6, 1, 1, 1).carve(7, 6, 6, 1, 1, 1);
    m.set(3, 7, 7, PH_GOLD_L).set(3, 8, 7, PH_GOLD_L).set(3, 9, 7, PH_GOLD_L);   // uraeus
    m.box(-1, 1, -1, 9, 4, 1, TEAM).box(-1, 1, 0, 1, 4, 3, TEAM).box(7, 1, 0, 1, 4, 3, TEAM);
    // (round 32) the narrow false beard: one voxel wide, two deep, hung under
    // the chin and banded gold / the army's colour like a plaited royal beard
    for (let y = -1; y >= -4; y--) for (const z of [4, 5]) { if (y & 1) m.set(3, y, z, PH_GOLD_L); else tset(m, 3, y, z, 0xffffff); }
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
    // (round 24) a dried bronze face, not a bandaged drone: a lit face plane,
    // deep dark eyes (a dim ivory corner and a near-black pupil under a dark
    // brow), a nose ridge, sunken cheeks, a thin mouth, one linen strip
    // wrapped across the jaw; the hood-shaped nemes over it
    m.vox.clear();
    faceN(m, MU_FACE_M, MU_FACE_D, { eyes: [0xdccca8, 0x0c0705], brow: 0x2a180e, nose: MU_FACE_L, face: MU_FACE_L });
    m.set(2, 3, 5, MU_FACE_D).set(4, 3, 5, MU_FACE_D).set(3, 1, 5, 0x3a2216);
    for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) if (m.has(x, 0, z)) m.set(x, 0, z, z === 5 || x === 0 || x === 6 ? 0xd2c4a2 : 0xb4a482);
    m.set(0, 1, 3, 0xb4a482).set(6, 1, 3, 0xb4a482);
    nemesH(m, { chest: 6, plain: true });
  } else if (style === 'falcon') {
    // (round 26, the Avenger, myth_12) Retold's falcon head, no nemes: the
    // round-25 team / gold striped nemes, the striped collar and lappets put
    // the same stripe on the head and the chest, and no face came through.
    // Now a dark slate feathered head and nape (one flat tone, a darker
    // scallop row every third row on the nape only) round one flat cream face
    // plane (x 1..5, y 1..5) set off by a near-black outline row along the
    // brow and down both sides; two 1-voxel black eyes with a white glint
    // voxel outside each, a yellow beak standing two voxels out of the face
    // with one dark hooked tip. Nothing striped on the head.
    m.vox.clear();
    const SL = 0x3e444e, SL_D = 0x2a2e35, SL_L = 0x56606c, OUT = 0x121418;
    const CR = 0xf0e8d4, CR_D = 0xd2c8b0, EYE = 0x050403, BK = 0xf0c800, BK_D = 0xb08a00;
    faceN(m, SL, SL_D, { eyes: [CR, EYE], brow: null, nose: SL, face: SL });
    for (let x = 1; x <= 5; x++) for (let y = 1; y <= 5; y++) m.set(x, y, 5, y === 1 ? CR_D : CR);   // the cream face plane
    for (let y = 1; y <= 6; y++) m.set(0, y, 5, OUT).set(6, y, 5, OUT);                            // the outline down both sides
    for (let x = 0; x <= 6; x++) m.set(x, 6, 5, OUT);                                               // and along the brow
    m.set(1, 0, 5, OUT).set(5, 0, 5, OUT).set(2, 0, 5, CR_D).set(3, 0, 5, CR_D).set(4, 0, 5, CR_D);   // the throat
    m.set(2, 4, 5, EYE).set(4, 4, 5, EYE).set(1, 4, 5, 0xffffff).set(5, 4, 5, 0xffffff);         // eyes, a white glint outside each
    m.set(3, 4, 5, CR).set(3, 3, 5, BK).set(3, 2, 5, BK);                                           // the beak's root
    m.set(3, 3, 6, BK).set(2, 3, 6, BK_D).set(4, 3, 6, BK_D).set(3, 2, 6, BK).set(3, 2, 7, BK).set(3, 1, 7, OUT).set(3, 1, 6, BK_D);   // the beak, a dark hooked tip
    // the crown: one dark dome over the skull, a voxel proud of the brow
    for (let x = 0; x <= 6; x++) for (let z = -1; z <= 5; z++) {
      if ((x === 0 || x === 6) && (z === -1 || z === 5)) continue;
      m.set(x, 8, z, z === 5 ? SL_D : SL);
    }
    for (let x = 0; x <= 6; x++) m.set(x, 7, 5, SL_D).set(x, 7, 6, OUT);   // the brow ridge over the outline
    for (let y = 1; y <= 7; y++) m.set(-1, y, 1, SL).set(-1, y, 2, SL).set(-1, y, 3, SL_D).set(7, y, 1, SL).set(7, y, 2, SL).set(7, y, 3, SL_D);   // the cheeks behind the face
    // the nape: feathers falling from the crown down the back to the shoulders, widening a little
    for (let y = 7; y >= -3; y--) {
      for (let x = (y < 2 ? -1 : 0); x <= (y < 2 ? 7 : 6); x++) {
        m.set(x, y, -1, ((y + 30) % 3 === 0 && y < 4) ? SL_D : SL);
        if (y < 2) m.set(x, y, -2, y === -3 ? OUT : SL_D);
      }
    }
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
// ---- fine heads (round 34) ---------------------------------------------------
// The critic read every soldier's hair as one black cube a third wider than
// the shoulders (a bucket helmet), the face a few smeared pixels under a heavy
// fringe. The bare-headed / wigged men (Laborer, Spearman, Axeman, Slinger,
// the Mercenaries) now get a head modelled on a grid twice as fine as the old
// head (part scale HEAD_SCALE / 2), from shapes rather than boxes, about 0.85
// of the old size with the hair:
// - the skull a cranium ellipsoid (centre y 8.6, radii 5.9 / 6 / 5.5) united
//   with a jaw that narrows row by row to the chin (a rounded section), so
//   the head tapers to the crown and to the chin with no flat top or corner;
// - skin shaded from each voxel's surface normal (a lit face plane, a scalp
//   tone on top, the sides and the back a step down, the jaw's underside and
//   the jaw line in shade);
// - the face carved into it: eye sockets recessed a voxel (a dark lid row
//   over an ivory / near-black / ivory eye), a dark brow over each, a light
//   nose ridge from the bridge to a tip standing a voxel proud with its
//   shadow under it, lit cheekbones, a mouth line, a lit chin, ears;
// - hair as a shell round the cranium (fhShell), never a box: the Slinger's
//   Egyptian bob in stepped tiers that taper to the crown and flare a little
//   at the shoulders (each tier's lowest row stands out and has its shadow
//   under it), the fringe above the brows, the face left open between the
//   side locks; the Laborer's close crop and the Mercenaries' tight curls
//   follow the skull; the Spearman shaved with Retold's long lock from the
//   crown; the Axeman's gold and black striped headcloth a rounded hood with
//   side falls to the shoulders. Hair carries lighter brown-black strand
//   voxels so the mass has value variation.
const FH = {
  skin: { L: 0xca8452, H: 0xdc9a68, S: 0xa8643a, B: 0x8e4e2c, T: 0xb87240, D: 0x74401f, SOCK: 0x4a2414, BROW: 0x4a2414, LIP: 0x6a2c18, LIPL: 0xb06a42 },
  dark: { L: 0x7a5038, H: 0x96664a, S: 0x5e3a26, B: 0x4a2c1c, T: 0x6a4430, D: 0x3a2216, SOCK: 0x1e100a, BROW: 0x120806, LIP: 0x3a1a10, LIPL: 0x7a4a34 },
};
const FH_HAIR = { D: 0x18120e, M: 0x2a1e16, L: 0x45322a, S: 0x0a0605 };
const FH_C = { y: 8.6, z: -0.5, rx: 5.9, ry: 6.0, rz: 5.5 };
const fhCranium = (x, y, z, d = 0) => {
  const px = x + 0.5, py = y + 0.5 - FH_C.y, pz = z + 0.5 - FH_C.z;
  return (px / (FH_C.rx + d)) ** 2 + (py / (FH_C.ry + d)) ** 2 + (pz / (FH_C.rz + d)) ** 2 <= 1;
};
const fhJaw = (x, y, z) => {
  if (y < 0 || y > 8) return false;
  const hw = Math.min(5.5, 2.5 + y * 0.45), zf = y <= 1 ? 4.2 : 4.7, zb = -2.6;
  const cz = (zf + zb) / 2, az = (zf - zb) / 2;
  return Math.abs((x + 0.5) / hw) ** 3 + Math.abs((z + 0.5 - cz) / az) ** 3 <= 1;
};
const fhInHead = (x, y, z) => fhCranium(x, y, z) || fhJaw(x, y, z);
function fineHead(style) {
  const m = new VoxelModel();
  const dark = style === 'merc' || style === 'mercCav';
  const P = dark ? FH.dark : FH.skin;
  // the skull, shaded from the surface normal (empty neighbours within 2)
  for (let y = -3; y <= 16; y++) for (let x = -8; x <= 7; x++) for (let z = -8; z <= 7; z++) {
    const neck = y < 1 && Math.hypot(x + 0.5, (z + 0.5 + 0.8) * 1.1) <= 2.7;
    if (!(fhInHead(x, y, z) || (y >= -3 && neck))) continue;
    let nx = 0, ny = 0, nz = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
      if (!fhInHead(x + dx, y + dy, z + dz) && !(y + dy < 1 && Math.hypot(x + dx + 0.5, (z + dz + 0.5 + 0.8) * 1.1) <= 2.7)) { nx += dx; ny += dy; nz += dz; }
    }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const c = y < 0 ? P.D : ny < -0.45 ? P.D : nz > 0.55 ? P.L : ny > 0.6 ? P.T : nz < -0.35 ? P.B : P.S;
    m.set(x, y, z, c);
  }
  // the face, on the front surface (mirror pairs x / -1 - x)
  const front = (x, y) => { for (let z = 8; z >= -8; z--) if (m.has(x, y, z)) return z; return null; };
  const paintF = (x, y, c, dz = 0) => { const z = front(x, y); if (z !== null) m.set(x, y, z + dz, c); };
  const both = (fn) => { for (const s of [0, 1]) fn((x) => (s ? -1 - x : x)); };
  both((X) => {
    // the jaw line: the lower sides of the face a step darker
    for (let y = 0; y <= 3; y++) { const hw = Math.ceil(2.5 + y * 0.45) - 1; paintF(X(-hw - 1), y, P.D); }
    for (const x of [-5, -4, -3]) paintF(X(x), 6, P.H);                   // the cheekbones
    for (const x of [-4, -3, -2]) paintF(X(x), 9, P.BROW);                 // the brows
    // the eye sockets: recessed a voxel, a dark lid row over the eye
    for (const x of [-4, -3, -2]) for (const y of [7, 8]) { const z = front(X(x), y); if (z !== null) m.remove(X(x), y, z); }
    for (const x of [-4, -3, -2]) paintF(X(x), 8, P.SOCK);
    paintF(X(-4), 7, 0xeee2d0); paintF(X(-3), 7, 0x0e0806); paintF(X(-2), 7, 0xd6c8b4);
    paintF(X(-5), 7, P.D);                                                // the socket's outer edge
    paintF(X(-2), 5, P.S); paintF(X(-2), 6, P.S);                         // the nose's sides
    for (const x of [-2, -1]) paintF(X(x), 2, P.LIP);                     // the mouth
  });
  for (const x of [-1, 0]) {
    paintF(x, 8, P.H); paintF(x, 7, P.H);                                 // the bridge
    for (const y of [5, 6]) paintF(x, y, P.H, 1);                         // the tip, a voxel proud
    paintF(x, 4, P.D);                                                    // its shadow
    paintF(x, 1, P.LIPL); paintF(x, 0, P.H);                              // the lower lip, the chin
    paintF(x, 10, P.H);                                                   // the forehead's light
  }
  for (const s of [-1, 1]) {                                              // ears
    const ex = s < 0 ? -7 : 6;
    for (let y = 5; y <= 8; y++) for (const z of [-1, 0]) m.set(ex, y, z, y === 5 || y === 8 ? P.D : P.S);
    m.set(ex, 6, 0, P.SOCK).set(ex, 7, 0, P.D);
  }
  const H = FH_HAIR;
  const strand = (x, z, seed) => { const h = hash3(x, 0, z, seed); return h < 0.18 ? H.L : h < 0.5 ? H.M : H.D; };
  if (style === 'sling') {
    // the Egyptian bob: a shell 1..2.2 voxels over the cranium, its lower half
    // a column that falls to the jaw (y -2), in tiers of three rows: each
    // tier flares out row by row and the next starts narrower again, the
    // lowest row its shadow; the crown tapers with the cranium; the fringe
    // ends at y 11 (the brows at 9 and the forehead at 10 stay clear); below
    // it the face is open between the side locks, which fall behind the cheeks
    for (let y = -2; y <= 16; y++) {
      const ti = ((16 - y) % 3 + 3) % 3, tierD = 0.3 + ti * 0.32;       // 0 top row of a tier .. 2 bottom row
      const flare = y < 4 ? (4 - y) * 0.16 : 0;
      for (let x = -9; x <= 8; x++) for (let z = -9; z <= 8; z++) {
        if (fhInHead(x, y, z) || m.has(x, y, z)) continue;
        const py = y + 0.5 - FH_C.y, px = x + 0.5, pz = z + 0.5 - FH_C.z;
        const d = 1 + tierD + flare;
        let inside;
        if (py > 0) inside = (px / (FH_C.rx + d)) ** 2 + (py / (FH_C.ry + d)) ** 2 + (pz / (FH_C.rz + d)) ** 2 <= 1;
        else inside = (px / (FH_C.rx + d)) ** 2 + (pz / (FH_C.rz + d)) ** 2 <= 1;
        if (!inside) continue;
        if (y <= 10 && z + 0.5 > 0.5 && Math.abs(px) < 6.4) continue;     // the face and the cheeks open
        if (y <= 10 && z + 0.5 > 2.6) continue;                           // the locks end behind the cheekbones
        if (y < 3 && z + 0.5 > -0.5 && Math.abs(px) < 6.4) continue;      // the jaw and the neck free
        // tiers read by value, not by noise: the top row of each tier lit, the
        // middle row dark with a lighter strand every few columns, the lowest
        // row the shadow under the tier
        const sc = hash3(x, 0, z, 143);
        const c = ti === 2 && y > -2 ? H.S : ti === 0 ? (sc < 0.3 ? H.L : H.M) : (sc < 0.22 ? H.M : H.D);
        m.set(x, y, z, c);
      }
    }
    // the fringe: one straight edge across the forehead, a lit row on top
    for (let x = -6; x <= 5; x++) { const z = front(x, 11); if (z !== null) m.set(x, 11, z + 1, (x & 1) ? H.M : H.L); }
  } else if (style === 'laborer' || style === 'merc' || style === 'mercCav') {
    // close-cropped hair hugging the cranium: from a hairline at the brow
    // (y 11 in front, falling to the ears at the sides) down to the nape (y 5),
    // a shell 0.9 thick; the Mercenaries' tight curls a voxel more with a
    // bumpy outer layer and rows running front to back
    const curls = style !== 'laborer';
    for (let y = 4; y <= 17; y++) for (let x = -9; x <= 8; x++) for (let z = -9; z <= 8; z++) {
      if (fhInHead(x, y, z) || m.has(x, y, z)) continue;
      const d = curls ? 1.5 : 0.95;
      if (!fhCranium(x, y, z, d)) continue;
      const pz = z + 0.5, px = Math.abs(x + 0.5);
      const hairline = pz > 2 ? 11 : pz > -1 ? 9 - (px > 5 ? 2 : 0) : 5;  // the front, the temples, the back
      if (y < hairline) continue;
      if (curls && !fhCranium(x, y, z, d - 0.7) && hash3(x, y, z, 151) < 0.4) continue;   // the curls' bumpy outside
      const row = curls && ((x + 16) % 3 === 0);
      m.set(x, y, z, row ? H.S : curls ? strand(x, y + z, 152) : strand(x, z + y, 153));
    }
    if (curls) both((X) => m.set(X(-7), 4, 0, GOLD(0, 0, 0)).set(X(-7), 3, 0, GOLD(1, 0, 0)));   // gold earrings
  } else if (style === 'spear') {
    // shaved: the scalp a shade cooler than the face with a stubble tone on
    // the crown; Retold's lock: a gold-bound tuft on the crown and a long
    // braid falling back and down the nape to the shoulders
    for (const [k, v] of m.vox) { const y = ((k >> 10) & 1023) - 512; if (y >= 11 && (v.c === P.T || v.c === P.S || v.c === P.B)) v.c = v.c === P.T ? 0x9a6040 : 0x86502e; }
    const pts = [[0, 15.5, -1.5], [0, 16.2, -3.5], [0, 15, -5.8], [0, 12, -7.2], [0, 8, -7.6], [0, 4, -7.4], [0, 0.5, -6.8]];
    let q = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const n = Math.ceil(Math.hypot(b[1] - a[1], b[2] - a[2]) * 2);
      for (let j = 0; j <= n; j++, q++) {
        const t = j / n, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t, r = i === 0 ? 1.4 : i < 3 ? 1.1 : 0.9;
        for (let dx = -2; dx <= 1; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
          const vx = dx, vy = Math.round(y) + dy, vz = Math.round(z) + dz;
          if (Math.hypot(vx + 0.5, vy - y, vz - z) > r + 0.35 || fhInHead(vx, vy, vz)) continue;
          const band = i <= 1 ? (i === 0 && vy <= 15 ? GOLD(vx, vy, vz) : H.M) : (Math.floor(q / 3) % 2 ? H.L : H.D);
          m.set(vx, vy, vz, band);
        }
      }
    }
    for (const x of [-1, 0]) m.set(x, 0, -7, GOLD(x, 0, -7)).set(x, -1, -7, H.M);   // the braid's gold tip
  } else if (style === 'axe') {
    // the gold and black striped headcloth: a rounded hood a voxel and a half
    // over the cranium, its stripes round the head (horizontal, two gold rows
    // to one black), front to back on the crown; a gold brow band at y 11;
    // side falls behind the cheeks to the shoulders (y -3), flaring a voxel,
    // and a back curtain to the nape
    for (let y = -3; y <= 17; y++) for (let x = -10; x <= 9; x++) for (let z = -9; z <= 8; z++) {
      if (fhInHead(x, y, z) || m.has(x, y, z)) continue;
      const py = y + 0.5 - FH_C.y, px = x + 0.5, pz = z + 0.5 - FH_C.z;
      const flare = y < 6 ? (6 - y) * 0.14 : 0, d = 1.4 + flare;
      const inside = py > 0 ? (px / (FH_C.rx + d)) ** 2 + (py / (FH_C.ry + d)) ** 2 + (pz / (FH_C.rz + d)) ** 2 <= 1
        : (px / (FH_C.rx + d)) ** 2 + (pz / (FH_C.rz + d)) ** 2 <= 1;
      if (!inside) continue;
      if (y <= 10 && z + 0.5 > 0 && Math.abs(px) < 6.6) continue;         // the face open
      if (y <= 10 && z + 0.5 > 2) continue;
      if (y < 3 && z + 0.5 > -1.5 && Math.abs(px) < 6.6) continue;        // the neck free
      const top = py > 4.2;
      const blk = top ? ((x + 20) % 3 === 0) : ((y + 30) % 3 === 0);
      const edge = y === -3 || (y <= 10 && z + 0.5 > 1);
      // (the gold self-lit in the unit shader's eg_fire band, as the epsilon
      // axe's bronze: a lit saturated gold grades to cream)
      if (blk) m.set(x, y, z, BLACK);
      else m.set(x, y, z, edge ? 0x7a4a08 : ((x + y + z) & 3) === 0 ? 0xc89410 : 0xb07a0e, { glow: edge ? 0 : 0.78 });
    }
    for (let x = -6; x <= 5; x++) { const z = front(x, 11); if (z !== null) m.set(x, 11, z + 1, 0xd8a420, { glow: 0.78 }); }   // the brow band
  }
  return m;
}
const FINE_HEADS = new Set(['laborer', 'spear', 'axe', 'sling', 'merc', 'mercCav']);
function headPart(style, joint = [0, 10, 0.2], parent = 'torso', s = 1) {
  // (round 34) the fine heads: twice the grid, centred on the neck
  // (the chin sits half a rig voxel lower than the old head's, so the fine
  // neck stub covers the torso's neck block instead of a gap under the jaw)
  if (FINE_HEADS.has(style)) return part('head', fineHead(style), [0, 0, 0], [joint[0], joint[1] - 0.5 * s, joint[2]], parent, { scale: HEAD_SCALE * 0.5 * s, rest: HEAD_TILT, greedy: true, outline: 0.22 });
  // (round 32) the Pharaoh's head a thinner line: at 0.3 the hull round his
  // nose ridge drew a dark moustache across the calm face
  return part('head', headE(style), HEAD_PIVOT, joint, parent, { scale: HEAD_SCALE * s, rest: HEAD_TILT, ...(style === 'pharaoh' ? { outline: 0.12 } : {}) });
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
// (round 33) its own warmer, lighter tan ramp, two steps above the sandals,
// straps and hafts (SANDAL, LEATHER, WOOD): the round-12b mid brown sat on
// the same value as the leather, so a bare leg read as jointed timber
const PAL_SKIN = { H: 0xc27a48, L: 0xae683a, M: 0x8e4e2c, D: 0x6a361e };
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
// (round 24) slim: a lean frame (the Mummy): the 12-wide chest and shoulders
// cut to 10, the deltoids a voxel in, so the shoulders are about 1.5 x the
// headdress, not slabs (pair it with manParts' armX: SLIM_ARM_X)
function manTorso(pal = PAL_SKIN, { slim = false } = {}) {
  const m = new VoxelModel();
  for (const [ys, [w0, z0, z1]] of Object.entries(TORSO_ROWS)) {
    const y = +ys, w = slim && w0 >= 12 ? 10 : w0;
    for (let x = -w / 2; x < w / 2; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === -w / 2 || x === w / 2 - 1, ez = z === z0 || z === z1;
      if (ex && ez && w >= 8) continue;                  // rounded edges
      const ax = Math.abs(x + 0.5);
      let c = pal.M;
      if (z === z1 && !(ex && w >= 8)) c = pal.L;
      // (round 12) the flanks under the arms a tone darker (D)
      // (round 33) no darker flank columns: on the boxy torso they read as
      // noise; the side tone and the light carry the form
      if (y >= 13) c = palH(pal);                        // the lit tops of the shoulders
      if (y >= 15) c = z === z1 ? pal.L : pal.M;         // the neck
      // the shadow under the pectorals: one unbroken row (two dark patches
      // and a solar plexus mark read as a face painted on the chest), the
      // ribs below it a side tone
      // (round 12b) the side tone, not D, and only under the pecs: a full dark
      // row read as a seam cutting the torso in two
      // (round 33) none: the front is one tone from the belt to the collar
      if (z === z0 && y <= 1) c = pal.D;
      m.set(x, y, z, c);
    }
  }
  // rounded deltoids standing out past the chest: the arms hang from under them
  for (const x of slim ? [-6, 5] : [-7, 6]) for (let y = 10; y <= 13; y++) for (let z = -2; z <= 1; z++) {
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
function handVox(m, pal, out, { grip = false, fist = null, slim = false, clean = false } = {}) {
  const H = palH(pal);
  if (clean) {
    // (round 32, the Pharaoh) a clean fist in two tones: a 3-wide, 4-deep
    // block (corners at the back rounded off), its front the thumb laid
    // across the top row and the curled fingers in the bottom row, both lit,
    // a shade crease between them, the palm and sides a tone down; grip: the
    // haft's hole through its middle (x 0, z 0..1), the fingers and thumb
    // closed round it in front
    for (let y = 0; y <= 2; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 2; z++) {
      if (z === -1 && x !== 0 && y !== 1) continue;           // the rounded heel of the hand
      if (grip && x === 0 && (z === 0 || z === 1)) continue;   // the haft's hole
      const front = z === 2;
      m.set(x, y, z, fist || (front && y !== 1 ? pal.L : pal.M));   // the thumb row, a crease, the finger row
    }
    return m;
  }
  if (slim) {
    // a 3 x 3 fist, the knuckles a lit row in front, the corners rounded
    for (let y = 0; y <= 2; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
      if (Math.abs(x) === 1 && Math.abs(z) === 1 && y !== 1) continue;
      const inner = x * out < 0, front = z === 1;
      m.set(x, y, z, fist || (front ? (y === 1 ? H : pal.L) : inner ? pal.D : pal.M));
    }
    return m;
  }
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
// (round 26) a slim arm (the Avenger, myth_12): a 5-wide plus at the
// deltoid, a 3 x 3 upper arm, a 3-wide plus forearm and wrist and a 3 x 3
// fist (no fourth knuckle row), about 30 % less than the men's, so the arms
// read thinner than the legs, not as a gorilla's
const ARM_ROWS_SLIM = [
  [18, 1.4, 1.4], [17, 2.0, 1.6], [16, 2.0, 1.7], [15, 2.0, 1.7], [14, 1.7, 1.6], [13, 1.6, 1.6],
  [12, 1.5, 1.5], [11, 1.5, 1.5], [10, 1.4, 1.4], [9, 1.25, 1.25],
  [8, 1.25, 1.25], [7, 1.25, 1.25], [6, 1.25, 1.25], [5, 1.2, 1.2], [4, 1.1, 1.1], [3, 1.0, 1.0],
];
// (round 32, the Pharaoh) one step from the deltoid to the arm, no lumps
const ARM_ROWS_CLEAN = [
  [18, 1.6, 1.6], [17, 2.2, 2.0], [16, 2.2, 2.0], [15, 2.2, 2.0], [14, 2.2, 2.0],
  [13, 1.6, 1.6], [12, 1.6, 1.6], [11, 1.6, 1.6], [10, 1.6, 1.6], [9, 1.6, 1.6],
  [8, 1.6, 1.6], [7, 1.6, 1.6], [6, 1.6, 1.6], [5, 1.6, 1.6], [4, 1.6, 1.6], [3, 1.25, 1.25],
];
function manArmM({ pal = PAL_SKIN, side = 'L', bracer = null, band: bnd = null, sleeve = null, fist = null, bend = 0, grip = false, slim = false, clean = false } = {}) {
  const m = new VoxelModel();
  const out = side === 'L' ? 1 : -1, H = palH(pal);
  const tone = (x, y, z, nx, nz) => {
    const inner = nx * out < -0.55, front = nz > 0.45;
    let c = front ? pal.L : inner ? pal.D : pal.M;
    if (clean) c = front ? pal.L : pal.M;                 // (round 32) two flat tones, no lit cap or wrist ring
    else {
      if (y >= 16 && nz > -0.6 && !inner) c = H;          // the lit shoulder cap
      if (y >= 17) c = inner ? pal.M : H;
      if (y === 3) c = front ? pal.M : pal.D;             // the wrist, a tone down
    }
    if (bracer && y >= 4 && y <= 7) c = bracer;
    if (bnd && y >= 12 && y <= 13) c = bnd;
    if (sleeve && y >= 13) c = y === 13 ? (typeof sleeve === 'number' ? shadeC(sleeve, 0.86) : sleeve) : sleeve;
    return c;
  };
  limbRows(m, slim ? ARM_ROWS_SLIM : clean ? ARM_ROWS_CLEAN : ARM_ROWS, tone);
  if (!slim && !clean) {
    // (round 30) shoulder and elbow mass: the deltoid a voxel wider on the
    // outer side (rows 13..16, a rounded 3-deep column, its top lit), the
    // biceps a voxel deeper in front, and an elbow knob behind
    const put = (x, y, z, nx, nz) => {
      const c = tone(x, y, z, nx, nz);
      if (c === TEAM) tset(m, x, y, z, nz > 0.45 ? 0xffffff : TEAM_SHADE); else m.set(x, y, z, solid(c, x, y, z));
    };
    for (let y = 13; y <= 16; y++) for (let z = -1; z <= 1; z++) {
      if ((y === 13 || y === 16) && z !== 0) continue;
      put(3 * out, y, z, out, z / 2.3);
    }
    for (let y = 11; y <= 13; y++) put(0, y, 3, 0, 1);    // the biceps in front
    put(0, 10, -2, 0, -1); m.set(0, 9, -2, pal.M);          // the elbow behind
  }
  handVox(m, pal, out, { grip, fist, slim, clean });
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
    if (sandal && sandal === SANDAL && y <= 3) return SANDAL_TIE;   // (round 33) the sandal's pale lacing round the ankle
    const inner = nx * out < -0.55;
    return nz > 0.45 ? pal.L : inner ? pal.D : pal.M;
  });
  // the foot: a sole and the foot over it, straight forward
  const F = foot || pal.M;
  m.box(-1, 0, -2, 3, 1, 6, sandal || F);
  m.box(-1, 1, -1, 3, 1, 4, F).set(0, 1, 3, F);
  if (!foot) m.set(0, 1, 2, pal.L).set(0, 1, 1, pal.L);
  if (sandal === SANDAL) m.set(-1, 1, 1, SANDAL_TIE).set(1, 1, 1, SANDAL_TIE).set(0, 1, 1, SANDAL_TIE).set(0, 1, -1, SANDAL_TIE);   // a pale strap across the instep, the heel strap
  else if (sandal) m.set(-1, 1, 1, sandal).set(1, 1, 1, sandal).set(0, 2, -1, sandal);
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
  armX = MAN.armX, legs = true, torsoJoint = null, torsoParent = null, restL = null, restR = null, liftL = 0, liftR = 0, fine = true } = {}) {
  // (round 12) no baked corner AO on the men's bodies: on the rounded limb
  // sections it drew dark grooves down every arm and leg (a stick-built doll);
  // the scene's light shades the round forms instead
  const S = BODY_SCALE * s, X = { scale: S, jitter: 0.015, ao: false };   // flat tones: almost no per-voxel jitter
  const P = [];
  // (round 33) fine limbs (refineLimb at export)
  const F = (kind, side, p2, o = {}) => (fine ? { fine: kind, fineOut: side === 'L' ? 1 : -1, finePal: p2, ...o } : {});
  if (legs) {
    const lp = leg.pal || pal;
    P.push(
      part('legL', manThighM({ pal, ...leg, side: 'L' }), LEG_PIVOT, sc([MAN.legX, MAN.hip, 0], s), null, { ...X, ...F('thigh', 'L', lp) }),
      part('shinL', manShinM({ pal, ...leg, side: 'L' }), LEG_PIVOT, sc([0, MAN.shin, 0], s), 'legL', { ...X, ...F('shin', 'L', lp) }),
      part('legR', manThighM({ pal, ...leg, side: 'R' }), LEG_PIVOT, sc([-MAN.legX, MAN.hip, 0], s), null, { ...X, ...F('thigh', 'R', lp) }),
      part('shinR', manShinM({ pal, ...leg, side: 'R' }), LEG_PIVOT, sc([0, MAN.shin, 0], s), 'legR', { ...X, ...F('shin', 'R', lp) }),
    );
  }
  P.push(part('torso', torso, [0, 0, 0], torsoJoint || sc([0, MAN.hip, 0], s), torsoParent, { ...X, ...(fine ? { fine: 'torso', finePal: pal } : {}) }));
  P.push(headPart(hs, sc([0, MAN.headY, headZ], s), 'torso', headScale * s));
  // (round 12) an arm with no baked bend is split at the elbow like the
  // archer's (splitArm: the upper arm and the forearm overlap two rows at a
  // rounded elbow, channels foreL / foreR), so a work or fighting pose can
  // bend it instead of swinging a stiff stick from the shoulder; gear held in
  // that hand is re-parented to the forearm by rig()
  for (const [sd, o, lift, rest] of [['L', armL, liftL, restL], ['R', armR, liftR, restR]]) {
    const a = manArmM({ pal, ...arm, ...o, side: sd });
    const sx = sd === 'L' ? armX : -armX, R = rest ? { rest } : {};
    if ({ ...arm, ...o }.bend) { P.push(part(`arm${sd}`, a, [0.5, 18.5, 0.5], sc([sx, MAN.armY + lift, 0], s), 'torso', { ...X, ...R })); continue; }
    const [up, lo] = splitArm(a, pal);
    const fk = { fineK: { ...arm, ...o }.slim ? 0.8 : 1 };
    P.push(part(`arm${sd}`, up, [0.5, 18.5, 0.5], sc([sx, MAN.armY + lift, 0], s), 'torso', { ...X, ...R, ...F('upper', sd, pal, fk) }));
    P.push(part(`fore${sd}`, lo, [0.5, 9.5, 0.5], sc(FORE_J, s), `arm${sd}`, { ...X, forearm: true, ...F('fore', sd, pal, fk) }));
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
// the epsilon axe (round 30), at half a rig voxel (part scale 0.5): a long
// walnut haft two half-voxels square (one rig voxel) and a small bronze
// crescent head about 0.6 of the old one (10 tall, 6 deep: half the head's
// height at RTS zoom), the Egyptian epsilon: three tangs bound to the haft
// with dark leather lashing bands round the haft, two open eyes between
// them, the blade's convex cutting edge out to the side (-x, away from the
// right hand's body, so the head shows its face to the RTS camera). A four-tone
// bronze ramp: a near-black bronze rim along the top, bottom, back and over
// the eyes, a warm copper-bronze face, a lit row inside the edge and a bright
// yellow glint row on the cutting edge, so the head reads as metal against
// skin and sand. Along +y from the grip (the fist) at the origin.
// The lit tones are written as the unit shader's self-lit voxels (glow 0.75
// .. 0.85, as the Phoenix's flame feathers): the frame grade's warm-chroma
// limiter otherwise turns any saturated orange or gold peach-pink or cream
// (round 29's skin-toned "cardboard" axe), and these keep their colour.
const AXE_DK = 0x2a1600, AXE_MID = 0x5e3806, AXE_LT = 0x985c0e, AXE_HI = 0xf0c448;
const AXE_GLOW = { [AXE_MID]: 0.78, [AXE_LT]: 0.78, [AXE_HI]: 0.8 };
const bronzeSet = (m, x, y, z, c) => m.set(x, y, z, c, { glow: AXE_GLOW[c] || 0 });
function epsilonAxeM() {
  const m = new VoxelModel();
  const LASH = 0x2a1608, LASH_L = 0x5a3416;
  m.box(0, -12, 0, 2, 45, 2, (x, y, z) => (y % 9 === 0 ? WOOD_DK : WOOD(x, y, z)));
  m.box(0, 33, 0, 2, 1, 2, AXE_DK);                         // a bronze cap on the haft's top
  m.box(0, -13, 0, 2, 1, 2, WOOD_DK);                       // the butt
  const y0 = 22, y1 = 31, cy = 26.5;
  const tang = (y) => y <= 23 || y === 26 || y === 27 || y >= 30;   // tangs; eyes at 24-25, 28-29
  for (let y = y0; y <= y1; y++) {
    const d = Math.abs(y - cy);
    const zEdge = 7 - Math.round(d * d * 0.12);             // the convex cutting edge (5..7 from the haft)
    for (let z = 2; z <= zEdge; z++) {
      if (!tang(y) && z <= 3) continue;                     // the eyes, open through the head
      let c = AXE_MID;                                      // the bronze face
      if (z === zEdge) c = AXE_HI;                          // the bright honed edge
      else if (z === zEdge - 1) c = AXE_LT;                 // lit just inside it
      else if (y === y0 || y === y1 || z === 2) c = AXE_DK; // the dark rim: top, bottom, back
      else if (z === 4 && (y === 25 || y === 28)) c = AXE_DK;   // a shadow over each eye
      bronzeSet(m, 1 - z, y, 0, c); bronzeSet(m, 1 - z, y, 1, c);   // the blade out to the side (-x)
    }
  }
  // leather lashings binding each tang to the haft: one dark band a voxel
  // proud all round the haft (and over the tang's back), the haft under the
  // tang's second row wrapped flush in a lighter leather
  for (const [ya, yb] of [[22, 23], [26, 27], [30, 31]]) {
    for (let x = -1; x <= 2; x++) for (let z = -1; z <= 2; z++) {
      if ((x === -1 || x === 2) && (z === -1 || z === 2)) continue;
      if (x === 2 && ya !== 26) continue;                  // only the middle band stands proud behind
      if (x >= 0 && x <= 1 && z >= 0 && z <= 1) continue;
      m.set(x, ya, z, LASH);
    }
    m.box(0, yb, 0, 2, 1, 2, LASH_L).set(-1, yb, 0, LASH_L).set(-1, yb, 1, LASH_L);
  }
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
// the camel rider's sword (round 29): authored at the rider's body voxel (half
// a rig voxel, the part scaled like the arm), about one arm long overall: a
// gold pommel, a 2 x 2 dark leather grip with a gold band, a gold crossguard
// eight wide with dark end caps and a shaded underside, then a dark steel
// blade four wide and two thick, 12 long: a near-black fuller down the middle,
// a lit honed edge row on the outer side and a mid-grey edge on the inner,
// tapering over the last three rows to a bright point (along +y, the grip in
// the fist at the origin)
function camelSwordM() {
  const m = new VoxelModel();
  const FACE = 0x4c545c, FULLER = 0x262a30, EDGE = 0xd8dee4, EDGE_IN = 0x8a929a;
  m.box(-1, -6, -1, 4, 2, 4, GOLD).box(0, -7, 0, 2, 1, 2, GOLD_DK);       // pommel
  m.box(0, -4, 0, 2, 4, 2, LEATHER_DK).box(0, -2, 0, 2, 1, 2, GOLD);   // grip, a gold band
  m.box(-3, 0, -1, 8, 1, 4, GOLD).box(-3, -1, 0, 8, 1, 2, GOLD_DK);    // the crossguard, its shaded underside
  for (const x of [-3, 4]) m.box(x, 0, -1, 1, 2, 4, LEATHER_DK);         // end caps
  const top = 13;
  for (let y = 1; y <= top; y++) {
    const [x0, x1] = y <= top - 3 ? [-1, 2] : y <= top - 2 ? [-1, 1] : y <= top - 1 ? [0, 1] : [0, 0];
    for (let x = x0; x <= x1; x++) for (let z = 0; z <= 1; z++) {
      const c = y === top ? EDGE : x === x0 ? EDGE : x === x1 ? EDGE_IN : (y < top - 3 && y > 1 ? FULLER : FACE);
      m.set(x, y, z, x1 - x0 >= 3 && (x === 0 || x === 1) && !(y < top - 3 && y > 1) ? FACE : c);
    }
  }
  return m;
}
// (round 25) the Avenger's sword at half a rig voxel (part scale 0.5): a
// straight bronze blade about 0.6 of the leg, five wide, in a ramp (a lit
// 1-voxel edge row each side, a bronze face, a darker inner band, a dark
// raised spine down the middle), tapering over the last four rows to a
// bright point; a gold crossguard nine wide with dark end caps, a leather
// grip with a gold band, a gold pommel
function bronzeSwordM() {
  const m = new VoxelModel();
  const EDGE = 0xf4d81c, FACE = 0xa07400, IN = 0x684a00, SPINE = 0x241800, GLD = 0xc49c00;
  m.box(-1, -6, -1, 3, 2, 3, GLD).set(0, -7, 0, 0x7a5008);           // pommel
  m.box(-1, -4, -1, 3, 4, 3, LEATHER_DK).box(-1, -2, -1, 3, 1, 3, GLD);   // grip, a gold band
  m.box(-4, 0, -1, 9, 1, 3, GLD).box(-3, 1, 0, 7, 1, 1, 0xd09a18);  // the crossguard
  for (const x of [-4, 4]) m.box(x, 0, -1, 1, 1, 3, 0x7a5010);
  m.box(-4, -1, 0, 9, 1, 1, 0x8a5a10);                                    // its shaded underside
  const top = 18;
  for (let y = 2; y <= top; y++) {
    const w = y < 4 ? 1 : y <= top - 4 ? 2 : y <= top - 2 ? 1 : 0;       // ricasso, blade, taper
    for (let x = -w; x <= w; x++) {
      const a = Math.abs(x);
      const c = y === top ? EDGE : a === w && w > 0 ? EDGE : a === 0 ? (w === 0 ? EDGE : SPINE) : a === 1 && w === 2 ? IN : FACE;
      m.set(x, y, 0, c);
    }
    if (w >= 1 && y < top - 1) { m.set(0, y, 1, SPINE); m.set(0, y, -1, SPINE); }   // the raised spine both faces
  }
  return m;
}
function longBladeM(col = GOLD, len = 12) {
  const m = new VoxelModel();
  m.box(0, -2, 0, 1, 3, 1, LEATHER_DK).set(0, -3, 0, col).box(-1, 1, 0, 3, 1, 1, col).box(0, 1, -1, 1, 1, 3, col);
  m.box(0, 2, 0, 1, len, 1, col).box(0, 3, 1, 1, len - 3, 1, col).set(0, len + 2, 0, 0xfff0b0);
  return m;
}
// Egyptian shield: tall, round-topped, the face in the army's colour inside a gold rim
// (round 30) cow: the face a dappled cowhide (Egyptian shields were hide on a
// wooden frame): cream white with dark brown patches two or three voxels
// across, inside the rim, so the shield never reads as skin-coloured; the
// back a dark wooden frame (a vertical and two cross battens on leather)
const COW_W = pick3(97, 0xf4efe4, 0xe8e0d0, 0xfaf6ee, 0.5, 0.85), COW_B = 0x3e2412, COW_B2 = 0x6a3c1c;
// a hand-laid pattern (x -2..2 across, y 5 down to -5), B a brown patch, b a
// rust-brown one, . white: irregular blotches of two to four voxels, none
// in a line, so it reads as hide, not stripes
const COW_MASK = [
  '..B..',   // y 5
  '.BB..',   // y 4
  '.B..b',   // y 3
  '....b',   // y 2
  'b...B',   // y 1
  'B...B',   // y 0
  'B..BB',   // y -1
  '...B.',   // y -2
  '.b...',   // y -3
  'BB...',   // y -4
  'B..bB',   // y -5
];
const cowAt = (x, y) => {
  const row = COW_MASK[5 - y], ch = row ? row[x + 2] : '.';
  return ch === 'B' ? COW_B : ch === 'b' ? COW_B2 : null;
};
function egShieldM({ face = TEAM, rim = GOLD, boss = GOLD, bands = false, w = 3, h = 6, cow = false } = {}) {
  const m = new VoxelModel();
  for (let y = -h; y <= h - 1; y++) for (let x = -w; x <= w; x++) {
    const top = y > h - 1 - w;
    const cy = h - 1 - w;
    if (top && x * x + (y - cy) * (y - cy) > w * w + 0.6) continue;
    if (y === -h && Math.abs(x) === w) continue;
    const edge = Math.abs(x) === w || y === -h || (top && x * x + (y - cy) * (y - cy) > (w - 1) * (w - 1) + 0.6);
    let c = edge ? rim : face;
    if (!edge && bands && (y === 0 || y === -3 || y === 3)) c = rim;
    if (!edge && cow) c = cowAt(x, y) ?? COW_W(x, y, 1);
    if (!edge && Math.abs(x) <= 0 && Math.abs(y - 1) <= 1) c = boss;
    if (cow && !edge && x === 0 && Math.abs(y - 1) <= 1) c = y === 2 ? AXE_HI : y === 1 ? AXE_LT : AXE_DK;   // a bronze boss, lit on top
    bronzeSet(m, x, y, 1, c);
    m.set(x, y, 0, edge ? GOLD_DK : (x === 0 || y === 2 || y === -3 ? WOOD_DK : (hash3(x, y, 0, 81) < 0.3 ? 0x2a1a10 : LEATHER)));   // the frame behind
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
function crookM(hx = 1) {
  // (round 32) flat banded tones (no jitter speckle) and the hook curled in
  // the shaft's own x-y plane, the plane the raised arm shows the camera
  // (curling towards +z it was seen edge-on, a straight stick): from the
  // shaft's top the crook bends over in a thick half ring (radius 4.5 to its
  // middle, 2 voxels thick) to the outside (hx = +1 / -1 along x), then drops
  // four rows to a gold tip; the bands run on round the hook
  const m = new VoxelModel();
  const G = 0xf0c400, GL = PH_GOLD_L;
  const band = (k) => ((k & 1) ? G : TEAM);
  const put = (x, y, z, c) => { if (c === TEAM) tset(m, x, y, z, 0xffffff); else m.set(x, y, z, c); };
  const TOP = 28;
  for (let y = -7; y <= TOP; y++) for (let x = 0; x <= 1; x++) for (let z = 0; z <= 1; z++)
    put(x, y, z, y <= -5 ? GL : band(Math.floor((y + 30) / 3)));
  // the hook: voxel centres within 3.5..5.5 of (cx, TOP) above the shaft's top
  const cx = 1 + hx * 4.5, cy = TOP + 0.5;
  for (let x = -12; x <= 13; x++) for (let y = TOP + 1; y <= TOP + 7; y++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
    if (r < 3.5 || r > 5.5) continue;
    const a = Math.atan2(dy, -dx * hx);                       // 0 = the shaft side .. PI = the far side
    const k = Math.floor(a / (Math.PI / 5));
    for (let z = 0; z <= 1; z++) put(x, y, z, band(k + 1));
  }
  // the drop on the far side, a gold tip
  const fx = hx > 0 ? 9 : -9;
  for (let y = TOP - 3; y <= TOP; y++) for (let x = fx; x <= fx + 1; x++) for (let z = 0; z <= 1; z++) put(x, y, z, y === TOP - 3 ? GL : band(1));
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
// (round 33) fine limbs: the men's half-voxel limbs read as chains of
// timber cuboids (a 3-wide forearm, wrist and shin are one square column at
// that grid). At export each straight limb part flagged `fine` is resampled
// at a quarter of the rig voxel (twice the body grid) through a smooth
// profile per kind: a rounded deltoid and biceps narrowing to a slim elbow,
// a forearm swelling below it and tapering to a thin wrist over the full
// fist; a thigh narrowing to the knee, a calf bulging behind the shin and a
// thin ankle over the full foot. Each fine voxel takes the colour of the
// body-grid voxel under it (bands, sleeves, bracers and team dye stay where
// they were); skin voxels are re-shaded from the fine surface normal (front
// L, sides M, the inner face D, a lit ridge H down the front of the
// muscles). The hand rows and the foot are only resampled, so grips and
// gear on the fist do not move. Profiles: [y (body-grid rows), rx, rz,
// cx (outwards), cz (forwards)], extents in body voxels from the axis.
const FINE_PROFILES = {
  thigh: { rows: [0, 13], keys: [[0, 1.55, 1.6, 0, 0.1], [2, 1.75, 1.8, 0, 0], [5, 2.05, 2.1, 0, 0], [9, 2.35, 2.35, 0, 0], [13, 2.5, 2.45, 0, 0]] },
  shin: { rows: [2, 13], keys: [[2, 1.0, 1.25, 0, 0.2], [3.5, 0.95, 1.0, 0, 0], [5, 1.2, 1.25, 0, -0.1], [7, 1.55, 1.75, 0, -0.35], [9.5, 1.85, 2.15, 0, -0.5], [11.5, 1.8, 1.95, 0, -0.25], [13.5, 1.55, 1.6, 0, 0.05]] },
  upper: { rows: [9, 18], keys: [[9, 1.5, 1.5, 0, 0], [10.5, 1.55, 1.6, 0, 0], [12, 1.75, 1.95, 0, 0.3], [13.5, 1.95, 2.05, 0.3, 0.2], [15.5, 2.3, 2.1, 0.45, 0], [17.5, 2.05, 1.9, 0.2, 0], [19, 1.5, 1.5, 0, 0]] },
  fore: { rows: [3, 10], keys: [[3, 0.95, 1.0, 0, 0], [4.5, 1.05, 1.1, 0, 0], [6.5, 1.4, 1.4, 0, 0.05], [8, 1.55, 1.5, 0.05, 0.05], [9.5, 1.45, 1.45, 0, 0], [11, 1.35, 1.35, 0, 0]] },
};
const fineProfile = (kind, y) => {
  const K = FINE_PROFILES[kind].keys;
  if (y <= K[0][0]) return K[0];
  for (let i = 1; i < K.length; i++) if (y <= K[i][0]) {
    const a = K[i - 1], b = K[i], t = (y - a[0]) / (b[0] - a[0]);
    return a.map((v, j) => v + (b[j] - v) * t);
  }
  return K[K.length - 1];
};
function refineLimb(src, kind, out, { pal = null, k = 1 } = {}) {
  const P = FINE_PROFILES[kind];
  const m = new VoxelModel();
  const skin = pal ? new Set([pal.H, pal.L, pal.M, pal.D, palH(pal)].filter((c) => c !== undefined)) : new Set();
  let y0 = 1e9, y1 = -1e9;
  for (const [kk] of src.vox) { const y = ((kk >> 10) & 1023) - 512; y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const copy = (xf, yf, zf, v) => { m.set(xf, yf, zf, 0); Object.assign(m.get(xf, yf, zf), v); };
  // the rows outside the profile (the fist, the foot, a sleeve's top): resampled
  for (const [kk, v] of src.vox) {
    const x = ((kk >> 20) & 1023) - 512, y = ((kk >> 10) & 1023) - 512, z = (kk & 1023) - 512;
    if (y >= P.rows[0] && y <= P.rows[1]) continue;
    for (let i = 0; i < 8; i++) copy(2 * x + (i & 1), 2 * y + ((i >> 1) & 1), 2 * z + (i >> 2), v);
  }
  // the profiled rows: a fine ellipse per fine row, coloured from the body grid
  for (let yf = 2 * Math.max(P.rows[0], y0); yf <= 2 * Math.min(P.rows[1], y1) + 1; yf++) {
    const hy = (yf + 0.5) / 2, ys = Math.floor(hy);
    const [, rx0, rz0, cxo, czo] = fineProfile(kind, hy);
    const rx = rx0 * k, rz = rz0 * k, cx = 0.5 + cxo * out * k, cz = 0.5 + czo * k;
    const row = [];
    for (const [kk, v] of src.vox) if (((kk >> 10) & 1023) - 512 === ys) row.push([((kk >> 20) & 1023) - 512, (kk & 1023) - 512, v]);
    if (!row.length) continue;
    for (let xf = -10; xf <= 12; xf++) for (let zf = -10; zf <= 12; zf++) {
      const hx = (xf + 0.5) / 2, hz = (zf + 0.5) / 2;
      const nx = (hx - cx) / rx, nz = (hz - cz) / rz;
      if (nx * nx + nz * nz > 1) continue;
      // the body-grid voxel under it, else the nearest one in the row
      const sx = Math.floor(hx), sz = Math.floor(hz);
      let best = row.find(([x, z]) => x === sx && z === sz);
      if (!best) {
        let bd = 1e9;
        for (const r of row) { const d = (r[0] + 0.5 - hx) ** 2 + (r[1] + 0.5 - hz) ** 2; if (d < bd) { bd = d; best = r; } }
      }
      const v = best[2];
      if (!v.team && skin.has(v.c)) {
        const inner = nx * out < -0.75 && nz < 0.2, front = nz > 0.3;
        m.set(xf, yf, zf, front ? pal.L : inner ? pal.D : pal.M);
      } else copy(xf, yf, zf, v);
    }
  }
  return m;
}
// (round 33) the torso on the fine grid too: each row resampled and its
// corners rounded off (a superellipse through the row's own extents), so the
// chest, the ribs and the shoulders read as a rounded body instead of a crate;
// bare skin re-shaded from that rounded section in three tones (the front L,
// a half tone where it turns, the sides and back M); paint (collars, straps,
// belts, the kilt) keeps its colours and is only rounded with it
const mixC = (a, b, t) => { const f = (s) => [(a >> s) & 255, (b >> s) & 255]; const ch = (s) => { const [x, y] = f(s); return Math.round(x + (y - x) * t) << s; }; return ch(16) | ch(8) | ch(0); };
function refineTorso(src, pal) {
  const m = new VoxelModel();
  const rows = new Map();
  for (const [kk, v] of src.vox) {
    const x = ((kk >> 20) & 1023) - 512, y = ((kk >> 10) & 1023) - 512, z = (kk & 1023) - 512;
    let r = rows.get(y);
    if (!r) rows.set(y, (r = { x0: x, x1: x, z0: z, z1: z }));
    r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.z0 = Math.min(r.z0, z); r.z1 = Math.max(r.z1, z);
  }
  const skin = pal ? new Set([pal.L, pal.M]) : new Set();
  const HALF = pal ? mixC(pal.L, pal.M, 0.5) : 0;
  const P = 3;
  for (const [kk, v] of src.vox) {
    const x = ((kk >> 20) & 1023) - 512, y = ((kk >> 10) & 1023) - 512, z = (kk & 1023) - 512;
    const r = rows.get(y);
    const cx = (r.x0 + r.x1 + 1) / 2, cz = (r.z0 + r.z1 + 1) / 2, ax = (r.x1 + 1 - r.x0) / 2, az = (r.z1 + 1 - r.z0) / 2;
    for (let i = 0; i < 8; i++) {
      const xf = 2 * x + (i & 1), yf = 2 * y + ((i >> 1) & 1), zf = 2 * z + (i >> 2);
      const dx = ((xf + 0.5) / 2 - cx) / ax, dz = ((zf + 0.5) / 2 - cz) / az;
      const e = Math.abs(dx) ** P + Math.abs(dz) ** P;
      if (e > 1 && ax >= 2 && az >= 1.5) continue;
      if (!v.team && skin.has(v.c)) {
        // the section's normal (the superellipse's gradient)
        const gx = Math.sign(dx) * Math.abs(dx) ** (P - 1) / ax, gz = Math.sign(dz) * Math.abs(dz) ** (P - 1) / az;
        const nz = gz / (Math.hypot(gx, gz) || 1);
        m.set(xf, yf, zf, nz > 0.8 ? pal.L : nz > 0.35 ? HALF : pal.M);
      } else { m.set(xf, yf, zf, 0); Object.assign(m.get(xf, yf, zf), v); }
    }
  }
  return m;
}
// the outline factor along a fine limb (model voxels of the fine grid): the
// line fades out over the last rows at a joint, so the knee, the elbow and
// the shoulder show no dark seam ring where two parts meet
const FINE_FADE = { thigh: { lo: [1, 6] }, shin: { hi: [21, 28] }, upper: { lo: [18, 24], hi: [32, 38] }, fore: { hi: [15, 22] } };
const fineOutline = (kind) => (y) => {
  const F = FINE_FADE[kind], cl = (v) => Math.max(0, Math.min(1, v));
  let f = 1;
  if (F.lo) f = Math.min(f, cl((y - F.lo[0]) / (F.lo[1] - F.lo[0])));
  if (F.hi) f = Math.min(f, cl((F.hi[1] - y) / (F.hi[1] - F.hi[0])));
  return f;
};
function archerArms(o = {}, pal = PAL_SKIN) {
  const X = { scale: BODY_SCALE, jitter: 0.015, ao: false };
  const out = [];
  for (const side of ['L', 'R']) {
    const [up, lo] = splitArm(manArmM({ pal, ...o, side }), pal);
    const sx = side === 'L' ? MAN.armX : -MAN.armX;
    const fo = side === 'L' ? 1 : -1;
    out.push(part(`arm${side}`, up, [0.5, 18.5, 0.5], [sx, MAN.armY, 0], 'torso', { ...X, fine: 'upper', fineOut: fo, finePal: pal }));
    out.push(part(`fore${side}`, lo, [0.5, 9.5, 0.5], [0, -4.5, 0], `arm${side}`, { ...X, fine: 'fore', fineOut: fo, finePal: pal }));
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
    part('weapon', epsilonAxeM(), [0, 0, 0], GRIP_E, 'armR', { scale: 0.5, jitter: 0.01 }),
    part('shield', egShieldM({ rim: TEAM, boss: AXE_MID, cow: true }), [0, 0, 0], SHIELD_E, 'armL'),
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
  // (round 32) in four clean tiers (12, 14, 16, 18 wide, flaring forward a
  // voxel a tier front and back) instead of a stair every two or three rows, the team
  // sides one solid dye (the shader shades each face by its turn; the old
  // white / shade patchwork and the stepped corners broke into speckle at
  // the hem), the apron and hem one flat gold with a lit edge
  const LEN = 23, PG = 0xecc000;
  for (let i = 0; i <= LEN; i++) {
    const y = 1 - i, tier = Math.min(3, Math.floor(i / 6));
    const w = 12 + tier * 2, z0 = -3 - tier, z1 = 2 + tier;   // (wide and deep enough that no thigh or shin breaks through, standing or walking)
    const aw = 1.5 + tier * 0.75;
    for (let x = -w / 2; x < w / 2; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === -w / 2 || x === w / 2 - 1;
      if (ex && (z === z0 || z === z1)) continue;
      const ax = Math.abs(x + 0.5);
      if (i >= LEN - 1) t.set(x, y, z, PG);                                          // the gold hem band
      else if (z === z1 && ax <= aw && i <= LEN - 3) t.set(x, y, z, ax > aw - 1 ? PH_GOLD_L : PG);   // the gold apron
      else tset(t, x, y, z, 0xffffff);
    }
  }
  eBelt(t, PH_GOLD, PH_GOLD_L);
  rig('pharaoh', { voxel: 0.08, anim: 'human', style: 'pharaoh', pose: 'staff', stance: 0.3 }, [
    ...manParts({ torso: t, head: 'pharaoh', headScale: 1.1, pal: PAL_PH, arm: { bracer: TEAM, clean: true }, armR: { grip: true },
      // (round 32) the legs sheathed in the robe's dye down to the ankle: a
      // stride swings the back leg out past any hem, and a bare brown leg
      // kicking out behind the robe read as a stray stick
      leg: { sandal: SANDAL, pal: { L: TEAM, M: TEAM, D: TEAM }, foot: PAL_PH.M },
      restL: [-0.35, 0, 0.42], restR: [-0.25, 0, -2.25] }),
    // (round 13) the crook through the raised fist (the fingers round the
    // shaft), laid across over the crown with the hook out past his left
    // shoulder, as Retold's Pharaoh holds it (unit_04)
    part('weapon', crookM(), [1, 0, 1], GRIP_C, 'armR', { scale: 0.5, rest: [0, 0, 1.35] }),
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

// ---- the chariot horse (round 31) -------------------------------------------------
// Authored at half the rig voxel (part scale 0.5, joints still in rig voxels),
// so the horse can be slim and tapered instead of bloated blocks: a long barrel
// (24 rig voxels chest to buttock, 5 wide, 7 deep) on legs as long as the body
// is deep, a deep chest, rounded hindquarters, a withers ridge, a tucked belly;
// a slender arched neck and a wedge head tapering from the cheek to a grey
// muzzle, pricked ears, a dark eye each side, a roached grey mane. Retold's
// tack (unit_03): a cream blanket painted flush on the back (red / ochre /
// red borders and a leather-and-ochre fringe, following the barrel, not a
// pad block), one thin dark girth strap behind the elbow, a team breast band
// with gold studs, a team and gold collar at the neck base, a thin dark
// bridle with a team browband.
// Body space (half voxels): x symmetric about 0, y 0 at the body joint (10
// rig voxels off the ground), z 0 at the barrel's middle, +z forward.
const CH_S = { scale: 0.5, jitter: 0.02, ao: false };
const CH_COAT = (x, y, z) => (y <= 6 ? 0xd4d0c8 : WHITE_COAT(x, y, z));   // a greyer belly under the white
const CH_LEG = 0xc4c0b8, CH_MUZZLE = 0x8a847c, CH_MANE = pick3(13, 0x6e6862, 0x5e5852, 0x7c766e);
const surfaceOf = (m, x, y, z) => !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
function chHorseBody() {
  const m = new VoxelModel(), C = CH_COAT;
  m.ellipsoid(-0.5, 10.5, 0, 4.4, 7, 17, C);       // the barrel
  m.ellipsoid(-0.5, 11, 15, 4.4, 7.6, 7, C);       // the deep chest
  m.ellipsoid(-0.5, 12, -15, 4.6, 7.4, 8, C);      // the hindquarters
  m.ellipsoid(-0.5, 17.5, 12, 2.2, 2.6, 6, C);     // the withers
  m.ellipsoid(-0.5, 18, -14, 2.6, 1.6, 6, C);      // the croup
  for (let z = -11; z <= 7; z++) for (let x = -6; x <= 5; x++) { m.remove(x, 3, z); if (z < -1) m.remove(x, 4, z); }   // the belly tucks up to the flank
  const cells = [...m.vox.keys()].map((k) => [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512]);
  const surf = cells.filter(([x, y, z]) => surfaceOf(m, x, y, z));
  for (const [x, y, z] of surf) {
    // the blanket over the back, z -10..7, down to y 10 (a fringe at y 9)
    if (z >= -10 && z <= 7 && y >= 9) {
      const edge = z === -10 || z === 7, edge2 = z === -9 || z === 6;
      let c;
      if (y === 9) c = (z & 1) ? OCHRE : LEATHER_DK;
      else if (y === 10 || y === 12 || edge) c = BLANKET_RED;
      else if (y === 11 || edge2) c = OCHRE;
      else c = BLANKET_CREAM;
      m.set(x, y, z, c);
      continue;
    }
    if (z === 9 && y >= 4) { m.set(x, y, z, LEATHER_DK); continue; }                   // the girth strap
    if (z >= 10 && (y === 12 || y === 13)) {                                          // the breast band
      if (y === 12 && z >= 17 && (Math.abs(x + 0.5) % 3) < 1) m.set(x, y, z, GOLD(x, y, z));
      else tset(m, x, y, z, y === 13 ? 0xffffff : TEAM_SHADE);
    }
  }
  return m;
}
function chHorseNeck() {
  const m = new VoxelModel(), C = WHITE_COAT;
  tube(m, [0, 0, 0], [0, 14, 7], 4.4, 2.8, C);           // the neck rising forward
  tube(m, [0, 2, -2.5], [0, 15.5, 5.5], 2.8, 2.2, C);    // the arched crest
  m.ellipsoid(-0.5, 13.5, 10, 2.6, 3.4, 3.2, C);         // the cheek
  tube(m, [0, 15.5, 9], [0, 7.5, 18], 2.7, 1.6, C);      // the face tapering to the muzzle
  for (const [k] of m.vox) {
    const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
    const d = Math.hypot(x + 0.5, y + 0.5 - 8.2, z + 0.5 - 17.2);
    if (d < 2.9) m.set(x, y, z, CH_MUZZLE);              // the grey muzzle
  }
  // nostrils, eyes (the outermost voxel each side at the eye's height)
  const side = (y, z, dir) => { for (let x = dir > 0 ? 6 : -7; Math.abs(x) <= 7; x -= dir) if (m.has(x, y, z)) return x; return null; };
  for (const dir of [1, -1]) {
    const xe = side(14, 11, dir); if (xe !== null) m.set(xe, 14, 11, DARK).set(xe, 15, 11, 0x5a5650);
    const xn = side(8, 18, dir); if (xn !== null) m.set(xn, 8, 18, 0x2a2420);
  }
  // pricked ears at the poll, splayed a little, a darker inner face
  for (const [x, o] of [[-2, -1], [1, 1]]) {
    for (let y = 17; y <= 20; y++) m.set(y >= 19 ? x + o : x, y, 8, C).set(y >= 19 ? x + o : x, y, 9, y >= 18 ? 0x9a948c : C);
    m.set(x + o, 21, 8, 0x8a847c);
  }
  // the roached mane along the crest (two voxels wide, one proud), a forelock
  for (let y = 2; y <= 17; y++) {
    let z = -9;
    while (z < 14 && !m.has(0, y, z)) z++;
    if (z >= 14) continue;
    m.set(-1, y, z - 1, CH_MANE).set(0, y, z - 1, CH_MANE).set(-1, y, z, CH_MANE).set(0, y, z, CH_MANE);
  }
  m.set(-1, 17, 10, CH_MANE).set(0, 17, 10, CH_MANE).set(-1, 16, 11, CH_MANE).set(0, 16, 11, CH_MANE);
  // the bridle: a noseband ring, cheek straps from the poll, a team browband,
  // gold rosettes where they meet
  const cells = [...m.vox.keys()].map((k) => [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512]);
  const ax = [0, -8, 9], al = Math.hypot(8, 9);
  for (const [x, y, z] of cells) {
    if (!surfaceOf(m, x, y, z)) continue;
    const t = ((y + 0.5 - 15.5) * ax[1] + (z + 0.5 - 9) * ax[2]) / (al * al);
    if (Math.abs(t - 0.62) < 0.05 && m.get(x, y, z).c !== DARK) m.set(x, y, z, LEATHER_DK);     // the noseband
    if (y >= 3 && y <= 5 && z > -6) { if (y === 5) m.set(x, y, z, GOLD(x, y, z)); else tset(m, x, y, z, y === 4 ? 0xffffff : TEAM_SHADE); }   // the collar
  }
  for (let i = 0; i <= 6; i++) {
    const y = 16 - i * 0.75, z = 8.5 + i * 0.85;
    for (const dir of [1, -1]) { const xs = side(Math.round(y), Math.round(z), dir); if (xs !== null) m.set(xs, Math.round(y), Math.round(z), LEATHER_DK); }
  }
  for (let x = -2; x <= 1; x++) tset(m, x, 17, 10, 0xffffff);                    // the browband
  for (const dir of [1, -1]) { const xr = side(11, 14, dir); if (xr !== null) m.set(xr, 11, 14, GOLD(1, 1, 1)); }
  return m;
}
function chHorseTail() {
  const m = new VoxelModel();
  tube(m, [0, 0, 0], [0, -3, -3], 2.0, 1.9, CH_MANE);
  tube(m, [0, -3, -3], [0, -15, -4.5], 1.9, 1.1, CH_MANE);
  return m;
}
function chHorseLegs() {
  const X = { coat: true, ...CH_S };
  const upper = (hind) => {
    const m = new VoxelModel();
    if (hind) tube(m, [0, 5, 1], [0, -10, -2], 3.1, 1.6, CH_COAT);   // the gaskin sloping back to the hock
    else tube(m, [0, 4, 0], [0, -11, 0.5], 2.5, 1.5, CH_COAT);      // the forearm, muscled at the elbow
    return m;
  };
  const lower = (len) => {
    const m = new VoxelModel();
    tube(m, [0, 1, 0], [0, -len + 5, 0], 1.6, 1.25, CH_LEG);         // the cannon
    m.ellipsoid(-0.5, -len + 4.5, 0.5, 1.6, 1.3, 1.6, CH_LEG);       // the fetlock
    tube(m, [0, -len + 4, 0.5], [0, -len + 3, 1.2], 1.3, 1.3, 0x9a968e);   // the pastern
    m.box(-2, -len, -1, 4, 3, 4, HOOF).remove(-2, -len + 2, 2).remove(1, -len + 2, 2).remove(-2, -len + 2, -1).remove(1, -len + 2, -1);
    return m;
  };
  const P = [];
  for (const [n, x, hind] of [['FL', 1.5, false], ['FR', -1.5, false], ['BL', 1.5, true], ['BR', -1.5, true]]) {
    P.push(part(`leg${n}`, upper(hind), [0, 0, 0], hind ? [x, 3, -7.5] : [x, 2.5, 7], 'body', X));
    P.push(part(`cannon${n}`, lower(hind ? 16 : 14), [0, 0, 0], hind ? [0, -5, -1] : [0, -5.5, 0.25], `leg${n}`, X));
  }
  return P;
}
// (round 31) a thin light self bow: limbs one half-voxel wide in pale honey
// wood with dark wrapping bands, ivory tips curling forward, a dark leather
// grip, a pale string; light against the archer's skin and silver armour,
// held upright out in front of him in the left fist
const BOW_LT = pick3(89, 0xe2b468, 0xd6a85e, 0xecc078);
function chariotBowM() {
  const m = new VoxelModel();
  const H = 17;
  let pz = null;
  for (let y = -H; y <= H; y++) {
    const ay = Math.abs(y);
    let z = Math.round(-(y * y) / 64);
    if (ay >= H - 3) z += ay - (H - 3);
    const c = ay <= 2 ? LEATHER_DK : ay >= H - 1 ? 0xf4ecd6 : (ay % 6 === 4) ? BOW_WOOD_DK : BOW_LT(0, y, 0);
    m.set(0, y, z, c);
    if (pz !== null && Math.abs(z - pz) > 1) for (let k = Math.min(z, pz) + 1; k < Math.max(z, pz); k++) m.set(0, y, k, c);
    pz = z;
    if (ay <= 2) m.set(0, y, z + 1, LEATHER);
  }
  const zs = Math.round(-((H - 4) * (H - 4)) / 64);
  for (let y = -(H - 4); y <= H - 4; y++) m.set(0, y, zs - 1, 0xf2ead6);
  return m;
}
// (round 31) a scale corslet over the torso (Retold's chariot archer): silver
// scales in offset rows (a lit top row, a lower row with dark scale edges),
// the sides a tone down, a one-voxel near-black outline round the arm holes
// and across the shoulders' outer tops, so skin arms read apart from the body
const SCALE_L = 0xdfe2e4, SCALE_M = 0xb4bac0, SCALE_S = 0x8c949c, SCALE_D = 0x5c646c, ARMOUR_OL = 0x1c1814;
const SCALE_G = 0xe8c840;   // a gold scale row at the hem
function scaleArmour(t) {
  return paint(t, (x, y, z) => {
    if (y < 3 || y > 13) return null;
    const ax = Math.abs(x + 0.5);
    if (ax > 5.5) return null;                                        // the deltoids stay skin
    const row = TORSO_ROWS[y];
    if (ax === 5.5 && y >= 7) return ARMOUR_OL;                       // the arm hole
    if (y === 13 && ax >= 3.5) return ARMOUR_OL;                      // the shoulders' outer tops
    if (y === 4) return z === row[2] ? SCALE_G : 0xb89a30;            // the gold hem row over the belt
    // scales: each a lit cap over a mid body, the rows offset by one voxel,
    // the gap between two scales of a row a shade darker (not a black dot)
    const front = z === row[2], band = (y - 5) >> 1, cap = ((y - 5) & 1) === 1;
    const gap = !cap && ((x + band) & 1) === 0;
    if (front) return cap ? SCALE_L : gap ? SCALE_S : SCALE_M;
    return cap ? SCALE_M : gap ? SCALE_D : SCALE_S;
  });
}
// (round 31) the archer's legs in the car at half the rig voxel: a white
// linen kilt from the belt (y 28) to below the car's rim (y 11), tapering to
// the waist and flaring a voxel to the hem, its sides and back a shade down,
// three pleat lines down the front and a team hem; bare shins below it
function chariotLegsM() {
  const m = new VoxelModel();
  for (const x of [-4, 1]) m.box(x, 0, -2, 3, 12, 3, PAL_SKIN.M).box(x, 0, -2, 3, 1, 5, SANDAL);
  for (let y = 10; y <= 28; y++) {
    const hw = y >= 26 ? 4 : y <= 14 ? 6 : 5;                         // half width
    const z0 = y <= 14 ? -5 : -4, z1 = y <= 14 ? 3 : 2;
    for (let x = -hw; x < hw; x++) for (let z = z0; z <= z1; z++) {
      const ex = x === -hw || x === hw - 1, ez = z === z0 || z === z1;
      if (ex && ez) continue;
      let c = ex || z === z0 ? KILT_LINEN_SH : KILT_LINEN(x, y, z);
      if (z === z1 && !ex && (x === -3 || x === 0 || x === 2) && y < 25) c = LINEN_SH;   // pleats
      if (y === 10 || y === 11) { tset(m, x, y, z, y === 11 ? 0xffffff : TEAM_SHADE); continue; }   // the team hem
      m.set(x, y, z, c);
    }
  }
  return m;
}

// Chariot Archer (unit_03): a white horse in a striped blanket and a team
// collar, hitched by two shafts and a yoke on its withers to an Egyptian
// chariot: a D-shaped car open at the back, its breastwork painted in the
// army's colour inside gold rims and struts (a gold sun disc on the front),
// standing on two big six-spoke wheels at the rear axle (the wheel as tall
// as the archer's waist above the floor). The archer (round 31): a silver
// scale corslet outlined at the arm holes, shoulders and waist (a dark
// belt), a gold and team collar, bare bronze arms, a white linen kilt that
// fills the car to below its rim, a quiver on his back, a ribbed helmet over
// an open face, a thin light bow held upright out in front. The horse
// (chHorse*, half voxels) stands mid-stride, a foreleg lifted and the head
// high (pose "chariot", unit_view.cpp).
// Chariot space: the floor at y 0 (6 voxels off the ground at the axle), +z
// forward; the horse's withers at about (y 13.8, z 28.5), its chest at z 33.5.
{
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
  // (round 31) two thin shafts (1 x 1) from under the car past the horse's
  // flanks up to small yoke saddles at its shoulders, a thin yoke across the
  // withers with gold finials (the breast band and girth are on the horse)
  for (const xs of [-4, 3]) {
    for (let z = -2; z <= 28; z++) {
      const y = z < 4 ? -2 : -2 + Math.round((z - 4) * 0.5);
      car.set(xs, y, z, WOOD(xs, y, z));
    }
    car.box(xs < 0 ? -3 : 2, 11, 28, 1, 3, 1, LEATHER_DK);           // the yoke saddle
  }
  car.box(-5, 14, 28, 11, 1, 1, WOOD_DK);                            // the yoke on the withers
  car.set(-6, 14, 28, GOLD(0, 0, 0)).set(6, 14, 28, GOLD(2, 0, 0));
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
  // the archer: the men's torso under a scale corslet (scaleArmour), a dark
  // leather belt as the waist's outline, the gold / team / gold collar, the
  // quiver on his back; arms split at the elbow (archerArms) so the bow arm
  // bends and the right hand rests on the string
  const t = manTorso();
  eKilt(t, { color: KILT_LINEN, side: KILT_LINEN_SH, hem: KILT_LINEN_SH, len: 6, fold: true });
  scaleArmour(t);
  eBelt(t, ARMOUR_OL, GOLD);
  eCollar(t, [ANKH_L, TM, ANKH_L], { r0: 2.4 });
  t.box(2, 3, -6, 3, 11, 2, LEATHER).box(2, 3, -6, 3, 1, 2, LEATHER_DK).box(2, 13, -6, 3, 1, 2, LEATHER_DK);   // the quiver on the back
  for (const x of [2, 4]) t.set(x, 14, -6, 0xf4f0e8).set(x, 15, -5, 0xf4f0e8);
  const rider = riderMan({ torso: t, torsoJoint: [0, 14.5, -1], torsoParent: 'chariot', head: 'charioteer', headScale: 1.2 })
    .filter((p) => !/^(arm|fore)[LR]$/.test(p.name));
  rig('chariot_archer', { voxel: 0.07, anim: 'centaur', style: 'chariot', pose: 'chariot', graze: false }, [
    part('body', chHorseBody(), [0, 0, 0], [0, 10, 12], null, { coat: true, ...CH_S }),
    part('neck', chHorseNeck(), [0, 0, 0], [0, 6, 9], 'body', { coat: true, ...CH_S }),
    part('tail', chHorseTail(), [0, 0, 0], [0, 8, -11.2], 'body', { coat: true, ...CH_S }),
    ...chHorseLegs(),
    part('chariot', car, [0, 0, 0], [0, -3.8, -22.5], 'body'),
    part('wheelL', wheel, [1, 0.5, 0.5], [7.5, -0.5, -2.5], 'chariot', { anim: 'wheel' }),
    part('wheelR', wheel, [1, 0.5, 0.5], [-6.5, -0.5, -2.5], 'chariot', { anim: 'wheel' }),
    part('riderLegs', chariotLegsM(), [0, 0, 0], [0, 1, -1], 'chariot', { scale: 0.5, jitter: 0.015, ao: false }),
    ...rider,
    ...archerArms({ band: TEAM, bracer: LEATHER }),
    part('weapon', chariotBowM(), [0.5, 0, 0], FORE_FIST, 'foreL', { scale: 0.5, jitter: 0.015 }),
    part('arrow', arrowM(), [0, 0, 0], FORE_FIST, 'foreR', { conditional: true, portrait: false }),
  ]);
}

// Camel Rider (rig voxel 0.09; round 36: the camel rebuilt on a grid twice
// as fine, every camel part at part scale 0.5, authored in geometric cells,
// cell i spanning [i, i + 1], x symmetric about 0, each part's origin at its
// joint, +z forward). Retold's dromedary (unit_08): a slim barrel on a deep
// chest, one tall rounded hump, a long low neck thrust forward from the chest
// that dips and rises again in an S to a small head carried level, a narrow
// snout with a split, drooping lip, heavy brows and small ears; long thin
// legs with a broad forearm, a knobbly dark knee callus, a slim cannon, a
// fetlock and a short pastern on a broad splayed two-toed pad; the hind legs
// bent at a pointed hock. A sandy, woolly hide (clumps of three tones), a
// paler belly, throat and legs. One thin blanket (a single cell over the
// hide, so the hump's dome shows through): a cream field over the top of the
// hump, a team border and a brown / ochre zigzag hem at mid-flank, the hump's
// fore and aft slopes bare. A team scarf knotted round the neck with a
// hanging end, a thin leather halter. The rider (round 29's man, at 1.15 x)
// sits up on the hump's crown, his bare legs straddling its front slope over
// the cream cloth (team kilt over the thighs, the knees out by the hump's
// sides, the shins along the blanket), his sword arm clear. Idle (unit_view
// rig.camel): each camel stands its own way (a cocked hind leg, a foreleg
// set forward, the neck high or low, turned) and chews; it walks in a pace
// (both legs of a side together), rolling.
{
  const inE = (p, c, r, e) => { let s = 0; for (let i = 0; i < 3; i++) s += Math.abs((p[i] - c[i]) / r[i]) ** e; return s <= 1; };
  const fillE = (m, c, r, col, e = 2, keep = false) => {
    for (let x = Math.floor(c[0] - r[0]) - 1; x <= Math.ceil(c[0] + r[0]); x++)
      for (let y = Math.floor(c[1] - r[1]) - 1; y <= Math.ceil(c[1] + r[1]); y++)
        for (let z = Math.floor(c[2] - r[2]) - 1; z <= Math.ceil(c[2] + r[2]); z++)
          if (inE([x + 0.5, y + 0.5, z + 0.5], c, r, e) && !(keep && m.has(x, y, z))) m.set(x, y, z, typeof col === 'function' ? col(x, y, z) : col);
  };
  const cellsOf = (m) => [...m.vox.keys()].map((k) => [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512]);
  // a woolly sandy hide: clumps of 2 x 2 x 2 cells in three tones
  const HIDE_L = 0xa47a4c, HIDE_M = 0x9a7046, HIDE_D = 0x8a6440;
  const WOOL = (x, y, z) => { const h = hash3(x >> 1, y >> 1, z >> 1, 61); return h < 0.22 ? HIDE_D : h < 0.8 ? HIDE_M : HIDE_L; };
  const PALE_L = 0xbc966a, PALE_M = 0xb08a5e;
  const PALE = (x, y, z) => (hash3(x >> 1, y >> 1, z >> 1, 62) < 0.4 ? PALE_M : PALE_L);
  const HUMP_HI = 0x8c6238, CALLUS = 0x5e4430, PAD_C = 0x4a3626, NAIL = 0x2a1e16, MUZ = 0x8a6644, LIP = 0x6e5034;

  // ---- the body (origin at the body joint, rig [0, 14, 0.5]: 28 cells over the ground)
  const body = new VoxelModel();
  fillE(body, [0, 7, -1], [6, 6.8, 13], WOOL, 2.3);        // the barrel, slim
  fillE(body, [0, 6, 11], [5.6, 8.6, 5.6], WOOL, 2.3);      // the deep chest (brisket, its pad low)
  fillE(body, [0, 11, 9.5], [4.8, 5, 5.2], WOOL, 2.2);      // the withers, where the neck leaves the chest
  fillE(body, [0, 8.5, -12], [5.2, 6.4, 4.8], WOOL, 2.3);   // the rump, sloping to the tail
  fillE(body, [0, 13, -0.5], [5.6, 4.4, 9.5], WOOL, 2.2);   // the hump's broad base
  fillE(body, [0, 18, -0.5], [4.6, 8.6, 8], WOOL, 2.1);     // the tall, rounded hump (crown at y 26.6)
  // a tucked-up belly between the legs (daylight under it)
  for (const [x, y, z] of cellsOf(body)) if (y < 2 && z > -8 && z < 6) body.remove(x, y, z);
  for (const [x, y, z] of cellsOf(body)) {
    if (y <= 3 && body.has(x, y, z)) body.set(x, y, z, PALE(x, y, z));                // the paler belly
    else if (y >= 24 && hash3(x >> 1, y >> 1, z >> 1, 63) < 0.25) body.set(x, y, z, HUMP_HI);         // a darker, shaggier hump crown
  }
  // a darker chest callus (the pad a camel kneels on)
  for (const [x, y, z] of cellsOf(body)) if (y <= -1 && z >= 9 && Math.abs(x + 0.5) < 3) body.set(x, y, z, CALLUS);

  // ---- the blanket: one cell proud of the hide over the hump's top and down the
  // flanks to mid-barrel (a trapezoid seen from the side), a cream field, two team
  // rows at the hem, a zigzag brown / ochre edge
  const cloth = new VoxelModel();
  const CREAM = 0xf0ebe0, CREAM_SH = 0xd8d0c0, HEM_Y = 9;
  const zIn = (y, z) => Math.abs(z + 0.5) <= 5.5 + (24 - y) * 0.2;
  const clothC = (x, y, z, top) => {
    if (y <= HEM_Y) return ((z + 40) % 4 < 2) === (y === HEM_Y) ? LEATHER : OCHRE;   // the zigzag hem
    if (y <= HEM_Y + 2) return TEAM;
    return top ? CREAM : CREAM_SH;
  };
  for (const [x, y, z] of cellsOf(body)) {
    if (y < HEM_Y - 1 || !zIn(y, z)) continue;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0]]) {
      const X = x + dx, Y = y + dy;
      if (body.has(X, Y, z) || cloth.has(X, Y, z)) continue;
      if (dy === 0 && Y < HEM_Y - 1) continue;
      // the front and back edges of the field in the team colour
      const edge = Y > HEM_Y + 2 && (!zIn(Y, z - 1) || !zIn(Y, z + 1));
      if (edge) tset(cloth, X, Y, z, 0xffffff);
      else { const c = clothC(X, Y, z, dy === 1); if (c === TEAM) tset(cloth, X, Y, z, Y === HEM_Y + 1 ? TEAM_SHADE : 0xffffff); else cloth.set(X, Y, z, c); }
    }
  }
  // ---- the rider's legs (same frame): straddling the hump's front slope, the
  // team kilt over the thigh, bare skin below, the knee out past the hump's
  // side, the shin down along the cream cloth, the bare foot turned forward
  const legs = new VoxelModel();
  const SK = PAL_SKIN;
  for (const s of [-1, 1]) {
    const hip = [s * 2.4, 29.2, 1.5], knee = [s * 5.4, 25, 7.2], ankle = [s * 6.6, 15.6, 6.4], toe = [s * 6.8, 15, 8.8];
    tube(legs, hip, knee, 2.0, 1.55, (x, y, z, t) => (t < 0.45 ? (y > 27 ? 0xffffff : 0xb4b4b4) : SK.L));
    tube(legs, knee, ankle, 1.5, 1.05, SK.L);   // the shin, its calf a step fuller
    tube(legs, [knee[0], knee[1] - 2, knee[2] - 0.6], [ankle[0], ankle[1] + 4, ankle[2] - 0.5], 1.7, 1.2, SK.L);
    tube(legs, ankle, toe, 1.15, 0.9, SK.M);
  }
  // the kilt cells as team dye
  for (const [x, y, z] of cellsOf(legs)) { const v = legs.get(x, y, z); if (v.c === 0xffffff || v.c === 0xb4b4b4) tset(legs, x, y, z, v.c); }
  // the skin's lit tops and its shaded undersides
  for (const [x, y, z] of cellsOf(legs)) {
    const v = legs.get(x, y, z);
    if (v.team) continue;
    if (!legs.has(x, y + 1, z) && v.c === SK.L) v.c = SK.H;
    else if (!legs.has(x, y - 1, z) && v.c !== SK.H) v.c = SK.M;
  }

  // ---- the neck and head (origin at the neck joint, rig [0, 5, 6.5] = cells (0, 10, 13)):
  // forward and down out of the chest, the low point well ahead of the chest,
  // then up to the poll; the head carried level, ahead of the neck
  const neck = new VoxelModel();
  const NP = [[0, 0, -1, 4.6], [0, -2.6, 5.5, 3.5], [0, -2.2, 10.5, 2.9], [0, 1.6, 15, 2.6], [0, 7, 18, 2.4], [0, 11.5, 19.6, 2.4]];
  for (let i = 0; i < NP.length - 1; i++) {
    const a = NP[i], b = NP[i + 1];
    tube(neck, [a[0], a[1], a[2]], [b[0], b[1], b[2]], a[3], b[3], WOOL);
  }
  // the throat's underside paler
  for (const [x, y, z] of cellsOf(neck)) if (!neck.has(x, y - 1, z) && z > 2) neck.set(x, y, z, PALE(x, y, z));
  // the head: a rounded skull behind, a long narrow face forward and a touch
  // down, the split upper lip overhanging a drooping lower lip
  const HEAD = (x, y, z) => (hash3(x, y, z, 64) < 0.35 ? HIDE_M : HIDE_L);
  fillE(neck, [0, 13.4, 21.2], [2.4, 2.8, 3.2], HEAD, 2.2);      // the skull
  tube(neck, [0, 13.2, 22.5], [0, 12.2, 28.2], 2.2, 1.5, HEAD);   // the face, narrowing to the snout
  fillE(neck, [0, 14.2, 23], [2.6, 0.8, 1.3], HIDE_D, 2.4, false); // the heavy brow ridge across the eyes
  fillE(neck, [0, 12.1, 28.6], [1.5, 1.4, 1.6], MUZ, 2.2);        // the upper lip, overhanging
  fillE(neck, [0, 10.6, 27.6], [1.2, 0.9, 1.5], LIP, 2.2);        // the drooping lower lip
  tube(neck, [0, 11.8, 22], [0, 10.8, 27], 1.7, 1.1, PALE_M);     // the jaw's underside
  // the split of the lip and the nostril slits, dark
  neck.set(-1, 12, 30, DARK).set(0, 12, 30, DARK);
  for (const sx of [-1, 1]) {
    const xn = sx > 0 ? 1 : -2;
    neck.set(xn, 13, 29, DARK);
    // the eye: dark, high on the side of the skull under the brow, a pale lid line
    const xe = sx > 0 ? 2 : -3;
    neck.set(xe, 13, 23, DARK).set(xe, 13, 22, 0x2e2018).set(xe, 14, 22, PALE_L);
    // small ears laid back on the poll
    neck.set(sx > 0 ? 2 : -3, 16, 19, HIDE_D).set(sx > 0 ? 2 : -3, 16, 18, LIP);
  }
  // a thin leather halter: a noseband and a cheek strap over the poll
  for (const [x, y, z] of cellsOf(neck)) {
    if (!surfaceOf(neck, x, y, z)) continue;
    if (z === 26 && y >= 10) neck.set(x, y, z, LEATHER_DK);
    else if (z === 20 && y >= 11 && y <= 16) neck.set(x, y, z, LEATHER_DK);
  }
  // the team scarf knotted round the upper neck: a clean band two cells
  // wide square to the neck's line, a darker knot under the throat and its
  // two ends hanging from it
  {
    const a = [0, 1.6, 15], b = [0, 7, 18], d = [b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1]);
    for (const [x, y, z] of cellsOf(neck)) {
      if (!surfaceOf(neck, x, y, z)) continue;
      const s0 = ((y + 0.5 - a[1]) * d[0] + (z + 0.5 - a[2]) * d[1]) / L;
      if (s0 >= 0.6 && s0 <= 2.6) tset(neck, x, y, z, 0xffffff);
    }
    for (let y = -1; y <= 2; y++) for (let x = -1; x <= 0; x++) tset(neck, x, y, 16 - Math.max(0, y), TEAM_SHADE);
    for (let y = -5; y <= -2; y++) { tset(neck, -1, y, 16 + Math.floor((y + 2) / -2), 0xffffff); tset(neck, 0, y + 1, 15, TEAM_SHADE); }
  }

  // ---- legs (origin at each joint). Front: the forearm broad at the top, a
  // knobbly dark knee, a slim cannon, the fetlock, a short pastern forward, a
  // broad flat splayed pad (two toes, a groove, dark nails)
  const LEGC = (x, y, z) => (hash3(x >> 1, y >> 1, z >> 1, 65) < 0.35 ? HIDE_M : HIDE_L);
  const foreUp = new VoxelModel();
  fillE(foreUp, [0, -1, 0], [3.2, 4.6, 3.4], WOOL, 2.2);         // the shoulder / elbow mass into the body
  tube(foreUp, [0, -3, 0], [0, -13.5, 0.2], 2.5, 1.6, LEGC);      // the forearm, tapering
  fillE(foreUp, [0, -15, 0.4], [1.9, 1.9, 2.1], CALLUS, 2.4);     // the knee knob with its callus
  const hindUp = new VoxelModel();
  fillE(hindUp, [0, -1, 0.4], [3.4, 5.6, 4.2], WOOL, 2.2);       // the thigh, into the rump
  tube(hindUp, [0, -4, -0.4], [0, -14.6, -2.6], 2.6, 1.5, LEGC);  // the gaskin, down and back to the hock
  fillE(hindUp, [0, -15, -3.4], [1.6, 1.7, 1.6], CALLUS, 2.4);    // the pointed hock
  const cannon = () => {
    const m = new VoxelModel();
    tube(m, [0, 0, 0], [0, -11.2, 0], 1.35, 1.05, PALE);           // the slim cannon
    fillE(m, [0, -11.4, 0.2], [1.5, 1.3, 1.5], PALE_M, 2.2);       // the fetlock
    tube(m, [0, -11.6, 0.3], [0, -13, 1.4], 1.15, 1.15, PALE_M);   // the pastern, forward
    fillE(m, [0, -14.2, 1.6], [2.6, 0.95, 2.9], PAD_C, 2.6);       // the broad flat pad
    for (const [x, y, z] of cellsOf(m)) {
      if (m.get(x, y, z).c !== PAD_C) continue;
      if ((x === -1 || x === 0) && z >= 3) m.remove(x, y, z);       // the cleft between the two toes
      else if (z >= 3 && y >= -14) m.set(x, y, z, NAIL);             // the nails at the toes' front
      else if (y >= -14) m.set(x, y, z, LIP);                        // the pad's top, lighter
    }
    return m;
  };
  const coat = { coat: true, scale: 0.5, greedy: true, outline: 0.15 };
  // (round 29) the rider 1.15 x his old size (the head 1.35 x)
  const R = 0.065 / 0.09 * 1.15;
  const t = manTorso();
  // the rider reads apart from the cream cloth by value and hue (unit_08): a
  // team kilt, a banded bronze-brown scale corslet (warm mid / dark rows) from
  // belt to chest, the team tunic on the shoulders and sleeves, the gold collar
  eKilt(t, { hem: TM_DK, len: 5, fold: false });
  paint(t, (x, y, z) => (y >= 2 && y <= 13 ? (z >= 2 && Math.abs(x + 0.5) < 5 ? TM : TM_SH) : null));   // the team tunic
  paint(t, (x, y, z) => (y >= 2 && y <= 9 ? ((y & 1) ? (Math.abs(x + 0.5) < 5 ? 0x9a6a34 : 0x7a5028) : 0x4a2c14) : null));   // the banded corslet all round
  eCollar(t, [GOLD, GOLD, TEAM_TRIM, TEAM_TRIM, GOLD], { r0: 2.6 });
  eBelt(t, LEATHER_DK, GOLD);
  rig('camel_rider', { voxel: 0.09, anim: 'horse', style: 'camel', pose: 'mount', camel: true, gait: 0.75, stride: 0.9, graze: false }, [
    part('body', body, [0, 0, 0], [0, 14, 0.5], null, coat),
    part('barding', cloth, [0, 0, 0], [0, 0, 0], 'body', { scale: 0.5, greedy: true, outline: 0.15 }),
    part('riderLegs', legs, [0, 0, 0], [0, 0, 0], 'body', { scale: 0.5, greedy: true, outline: 0.15 }),
    part('neck', neck, [0, 0, 0], [0, 5, 6.5], 'body', coat),
    part('tail', (() => { const m = new VoxelModel(); tube(m, [0, 0, 0], [0, -9, -1.2], 1.1, 0.8, WOOL); fillE(m, [0, -10.4, -1.4], [1, 1.8, 1], HAIR, 2); return m; })(), [0, 0, 0], [0, 7.5, -8.4], 'body', coat),
    part('legFL', foreUp, [0, 0, 0], [1.8, 1, 4.6], 'body', coat),
    part('cannonFL', cannon(), [0, 0, 0], [0, -7.5, 0.2], 'legFL', coat),
    part('legFR', foreUp, [0, 0, 0], [-1.8, 1, 4.6], 'body', coat),
    part('cannonFR', cannon(), [0, 0, 0], [0, -7.5, 0.2], 'legFR', coat),
    part('legBL', hindUp, [0, 0, 0], [1.8, 1, -5.6], 'body', coat),
    part('cannonBL', cannon(), [0, 0, 0], [0, -7.5, -1.3], 'legBL', coat),
    part('legBR', hindUp, [0, 0, 0], [-1.8, 1, -5.6], 'body', coat),
    part('cannonBR', cannon(), [0, 0, 0], [0, -7.5, -1.3], 'legBR', coat),
    ...riderMan({ torso: t, s: R, headScale: 1.05, torsoJoint: [0, 15.2, 0.8], torsoParent: 'body', head: 'camel', arm: { sleeve: TEAM, bracer: GOLD } }),
    // the sword at the arm's own voxel size (one arm long), raised forward
    // and out to the side from the fist, so the blade reads in profile clear
    // of the body, the hump and the neck
    part('weapon', camelSwordM(), [0.5, 0, 0.5], sc(HAND_E, R), 'armR', { scale: BODY_SCALE * R, jitter: 0.01, rest: [0.75, 0, 0.6] }),
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
// legs), a team saddle pad, a wooden howdah. The head (round 35, on a grid
// twice as fine; see headM below): a domed forehead over a brow step, a
// ringed, tapering trunk hanging forward and curling up, tusks from the mouth
// curving up and forward, thin fan ears lying back along the head, and a dark
// crease where the neck meets the shoulders. A mahout with a spear on its neck (rider parts at
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
  // (round 35) a dark crease round the front of the shoulders where the neck sinks in
  for (let z = 17; z <= 20; z++) for (let y = 1; y <= 12; y++) for (let x = 0; x <= 11; x++)
    if (body.has(x, y, z) && !body.has(x, y, z + 1) && Math.hypot(x - 5.5, y - 7) < 6.5) body.set(x, y, z, 0x5a5654);
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
  // (round 35) the head, rebuilt on a grid twice as fine (part scale 0.5,
  // geometric coords: cell i spans [i, i + 1], x symmetric about 0, the joint
  // at the origin at the front of the shoulders, +z forward). It reads as an
  // elephant from the RTS camera: a domed forehead over a clear brow step
  // (the face below it sits back, with a dark crease under the lip), a
  // tapered trunk of four ringed segments hanging forward of the chest and
  // curling up at the tip, thick ivory tusks out of grey lip sheaths at the
  // mouth curving down, forward and up, thin fan ears lying back along the
  // sides of the head and over the shoulders (pale at the rim, a darker field,
  // dark on the inner face), and a dark crease round the neck where it sinks
  // into the shoulders. A team headstall with gold studs crosses the crown.
  const headM = new VoxelModel();
  {
    const H = headM;
    // superellipsoids (exponent e > 2): broad flat planes with rounded edges, so the
    // fine grid shows a few wide terraces instead of a pinstripe of lit tops and
    // shaded risers
    const inE = (p, c, r, e) => { let s = 0; for (let i = 0; i < 3; i++) s += Math.abs((p[i] - c[i]) / r[i]) ** e; return s <= 1; };
    const fill = (c, r, col, keep, e = 2) => {
      for (let x = Math.floor(c[0] - r[0]) - 1; x <= Math.ceil(c[0] + r[0]); x++)
        for (let y = Math.floor(c[1] - r[1]) - 1; y <= Math.ceil(c[1] + r[1]); y++)
          for (let z = Math.floor(c[2] - r[2]) - 1; z <= Math.ceil(c[2] + r[2]); z++)
            if (inE([x + 0.5, y + 0.5, z + 0.5], c, r, e) && !(keep && H.has(x, y, z))) H.set(x, y, z, col);
    };
    const NECK = 0x45413f, SKULL = 0x67635f, DOME = 0x716d69, DOME_HI = 0x7c7874, UNDER = 0x4c4846;
    const TR_A = 0x6e6a67, TR_B = 0x64605d, TR_RING = 0x4a4644, TR_TIP = 0x76706c;
    fill([0, 0, -3], [9.5, 9.5, 6.5], NECK, false, 2.6);            // the neck root, sunk in the shoulders
    fill([0, 1, 4.5], [8.5, 9, 7.5], SKULL, false, 2.8);            // the skull
    fill([0, 7.5, 7.5], [7.6, 6.8, 6.6], SKULL, false, 2.6);        // the domed forehead
    // the brow step: below y 4.5 the face sits back behind the forehead's lip
    for (const [k] of [...H.vox]) {
      const x = ((k >> 20) & 1023) - 512, y = ((k >> 10) & 1023) - 512, z = (k & 1023) - 512;
      if (y < 4 && z >= 11) H.remove(x, y, z);
    }
    fill([0, 0, 8.5], [5.6, 4.6, 3.2], SKULL, true, 2.6);    // the face under the brow, set back
    // the trunk: from the face down and forward, four tapering segments, then
    // a curl forward and up at the tip; a dark ring every few cells
    const TP = [[0, 2, 10.5, 4.3], [0, -5, 13.6, 3.6], [0, -11, 15.2, 3.0], [0, -17, 15.6, 2.5], [0, -22, 15.2, 2.1],
      [0, -25, 17, 1.8], [0, -24.6, 19.6, 1.55], [0, -22.4, 20.8, 1.25]];
    let s0 = 0;
    for (let i = 0; i < TP.length - 1; i++) {
      const a = TP[i], b = TP[i + 1], L = Math.hypot(b[1] - a[1], b[2] - a[2]);
      const ss = s0;
      tube(H, [a[0], a[1], a[2]], [b[0], b[1], b[2]], a[3], b[3], (x, y, z, t) => {
        const s = ss + t * L;
        if (s > 29) return TR_TIP;
        if (s > 5 && (s % 3.6) < 0.75) return TR_RING;
        return Math.floor(s / 3.6) & 1 ? TR_B : TR_A;
      });
      s0 += L;
    }
    // tusks: from grey lip sheaths at the mouth's corners, down and forward,
    // then up and forward to the points
    for (const sx of [-1, 1]) {
      fill([sx * 4.3, -3.6, 10.6], [2.2, 2.4, 2.2], UNDER, true);   // the lip / sheath
      const P = [[4.3, -4.2, 11.2, 1.5], [5.4, -8.2, 14.6, 1.3], [5.8, -10, 18, 1.1], [5.4, -8.6, 21.2, 0.85], [4.8, -6.4, 22.8, 0.45]];
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1];
        tube(H, [sx * a[0], a[1], a[2]], [sx * b[0], b[1], b[2]], a[3], b[3], i < 1 ? IVORY_SH : IVORY);
      }
    }
    // shading of the head's surface: the dome lit, a pale crown highlight,
    // the brow lip's underside and the face beneath it dark, the neck dark
    const cells = [...H.vox.keys()].map((k) => [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512]);
    for (const [x, y, z] of cells) {
      const v = H.get(x, y, z);
      if (v.c !== SKULL || !surfaceOf(H, x, y, z)) continue;
      if (y >= 4 && y <= 5 && z >= 9 && !H.has(x, y - 1, z)) v.c = UNDER;              // the brow lip's underside
      else if (y >= 2 && y <= 3 && z >= 9 && H.has(x, y + 2, z + 1) ) v.c = UNDER;       // the shadow under the brow
      else if (y >= 11 && z >= 3) v.c = (y >= 13 && Math.abs(x + 0.5) < 4) ? DOME_HI : DOME;
      else if (z < 0) v.c = NECK;                                                          // the crease behind the skull
      else if (hash3(x, y, z, 77) < 0.12) v.c = 0x605c59;
    }
    // eyes: a dark eye under the brow on each side, a pale lid, a wrinkle under it
    for (const sx of [-1, 1]) {
      const y = 3, z = 9;
      let x = sx > 0 ? 12 : -13;
      while (Math.abs(x) > 0 && !H.has(x, y, z)) x -= sx;
      H.set(x, y, z, DARK).set(x, y, z - 1, DARK).set(x, y + 1, z, 0x5e5a57).set(x, y - 1, z - 1, 0x5e5a57);
    }
    // the team headstall over the crown behind the dome, gold studs
    for (let x = -10; x <= 9; x++) for (const z of [1, 2]) {
      let y = 20; while (y > 0 && !H.has(x, y, z)) y--;
      if (y > 0) { if (z === 1 && (x & 3) === 1) H.set(x, y, z, GOLD(x, y, z)); else tset(H, x, y, z, z === 2 ? TEAM_SHADE : 0xffffff); }
    }
    // ears: thin fans (2 cells) lying back along the sides of the head and over
    // the front of the shoulders, flaring a little at the back edge; a pale rim
    // on the outer face, a darker field with two veins, dark inside
    const EAR_RIM = 0x8e8884, EAR_F = 0x6c6865, EAR_V = 0x5c5855, EAR_IN = 0x4a4644;
    const inEar = (y, z) => {
      if (z > 5) return false;
      const dy = (y + 0.5 - 0.5) / 10.5, dz = (z + 0.5 + 2.5) / 7.8;
      const lobe = y < -6 && y >= -12 && z >= -4 && z <= 1 && ((y + 12) / 6) >= ((-z - 0.5) / 4) - 0.2;
      return dy * dy + dz * dz <= 1 || lobe;
    };
    for (const sx of [-1, 1]) for (let y = -13; y <= 12; y++) for (let z = -12; z <= 5; z++) {
      if (!inEar(y, z)) continue;
      const rim = !inEar(y + 2, z) || !inEar(y - 2, z) || !inEar(y, z - 2) || !inEar(y + 1, z - 1) || !inEar(y - 1, z - 1);
      const root = z >= 4;
      const vein = !rim && !root && (Math.abs((y - 2) - (z - 4) * 0.55) < 0.6 || Math.abs((y + 4) - (z - 4) * 0.15) < 0.6);
      const xo = 9.6;   // one flat plane (a stepped flare shades as a stripe at every step)
      const xi = Math.round(xo);
      const outer = root ? NECK : rim ? EAR_RIM : vein ? EAR_V : EAR_F;
      if (sx > 0) H.set(xi + 1, y, z, outer).set(xi, y, z, EAR_IN);
      else H.set(-xi - 2, y, z, outer).set(-xi - 1, y, z, EAR_IN);
    }
  }
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
    part('neck', headM, [0, 0, 0], [0, 8, 10], 'body', { scale: 0.5, greedy: true, outline: 0.08 }),
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
  // (round 26) a narrow broad collar (gold, two team rows, gold) on the
  // shoulders and a plain bare chest under it: no stripes below the collar
  eCollar(body, [GOLD, TM, TM, GOLD], { r0: 2.4 });
  for (let y = -2; y <= 14; y++) for (let x = -7; x <= 6; x++) {
    let zb = 9; for (let z = -6; z <= 4; z++) if (body.has(x, y, z)) { zb = z; break; }
    if (zb === 9 || (y < 1 && Math.abs(x + 0.5) > 5)) continue;
    body.set(x, y, zb - 1, y <= 0 ? 0xe8e8e4 : FEATH(x, y, 0));
  }
  const PAL_SC = { L: 0x6a7078, M: 0x4c525a, D: 0x363a40 };
  const shinA = manShinM({ pal: PAL_SC, sandal: null, foot: 0xd8b060 });
  shinA.set(-2, 0, 5, DARK).set(1, 0, 5, DARK).set(-1, 0, -3, DARK);   // talons
  rig('avenger', { voxel: 0.1, anim: 'beast', style: 'beast', idles: true }, [
    ...beastManParts({ torso: body, head: headE('falcon'), headPivot: HEAD_PIVOT, headScale: HEAD_SCALE, headZ: 0.4, arm: { band: GOLD, bracer: TEAM, slim: true }, leg: { kilt: TEAM, pal: { L: 0x4a5058, M: 0x3a3f48, D: 0x2e3239 } }, shin: shinA }),
    // (round 15) the blades low in a fighting grip, forward, down and out
    // from the fists (myth_12), never along the arms
    // in a deep orange-leaning gold (the plain GOLD reads pale beside the linen)
    // (round 25) short bronze swords (bronzeSwordM, about 0.6 of the leg) with
    // a crossguard and pommel, no outline hull round them (it blurred the
    // thin blade into a pale halo)
    part('weapon', bronzeSwordM(), [0, 0, 0], BEAST_FIST, 'foreR', { rest: [2.0, 0, -0.35], scale: 0.5, outline: 0.01 }),
    part('weapon2', bronzeSwordM(), [0, 0, 0], BEAST_FIST, 'foreL', { anim: 'weapon', rest: [2.0, 0, 0.35], scale: 0.5, outline: 0.01 }),
  ]);
}

// Mummy (human rig, 0.08), round 24 (myth_09): a lean body of dried
// bronze-brown skin (four tones: lit shoulder tops, chest / thigh fronts,
// sides, the inner faces) bound in a few broad linen strips, not a pale box:
// two bandages crossing the chest from the shoulders to the hips, the waist
// wrapped, a wrap round each upper arm, a bracer of linen on each forearm
// standing a half voxel proud (the elbow and wrist read as steps), a wrap
// below each knee and at the ankle; a slim torso (manTorso slim) so the
// shoulders are about 1.5 x the headdress; a long opaque grey-brown linen
// skirt with a hanging front panel and a dark hem row, notched at the hem;
// a larger head (the face reads) under the hood-shaped nemes (nemesH);
// the small khopesh. Rig `idles`: each mummy idles in its own pose
// (unit_view.cpp: weight on one leg, the blade lowered or on the shoulder).
{
  const W = { L: 0xdcd0b0, M: 0xbcae8a, D: 0x8e7f60 };              // the linen bandage, three tones
  const PAL_MU = { H: 0x93693f, L: 0x7c5434, M: 0x603e26, D: 0x432a19 };
  const t = manTorso(PAL_MU, { slim: true });
  // the crossed chest bandages and the wrapped waist (outer voxels only)
  paint(t, (x, y, z) => {
    if (y < 2 || y > 13) return null;
    const outer = !t.has(x, y, z + 1) || !t.has(x, y, z - 1) || !t.has(x + 1, y, z) || !t.has(x - 1, y, z);
    if (!outer) return null;
    if (y <= 5) return y === 5 ? W.D : (y === 2 ? W.M : W.L);            // the waist wrap, its upper edge shaded
    const front = z >= 1, back = z <= -3;
    if (!front && !back) return null;
    const u = x + 0.5;
    for (const s of [-1, 1]) {                                          // two strips, shoulder -> opposite hip
      const xs = s * (4.2 - (13 - y) * 0.95);
      const d = u - xs;
      if (Math.abs(d) < 1.3) return d * s > 0.4 ? W.M : W.L;
    }
    return null;
  });
  eKilt(t, { color: 0x8c7b5c, side: 0x6c5d44, hem: 0x3e3324, len: 9, fold: false, pleats: true });
  for (let x = -7; x <= 6; x++) for (let z = -5; z <= 5; z++) if ((x + 40) % 3 === 0) { t.remove(x, -10, z); }   // the notched hem
  eBelt(t, W.M, null);
  const MU_ARM = (side) => {
    const a = manArmM({ pal: PAL_MU, side });
    // linen round the upper arm, and a bracer a half voxel proud from wrist to mid-forearm
    for (const [k, v] of a.vox) { const y = ((k >> 10) & 1023) - 512; if (y === 12 || y === 13) v.c = (k & 1023) - 512 >= 1 ? W.L : W.M; }
    for (const [k, v] of a.vox) { const y = ((k >> 10) & 1023) - 512; if (y >= 4 && y <= 6) v.c = y === 4 ? W.D : (k & 1023) - 512 >= 1 ? W.L : W.M; }
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      if (Math.abs(x) + Math.abs(z) > 3 || (Math.abs(x) < 2 && Math.abs(z) < 2)) continue;
      a.set(x, 7, z, z >= 1 ? W.L : W.M);                                  // the bracer's upper edge stands a half voxel proud
    }
    return a;
  };
  const parts = manParts({ torso: t, head: 'mummy', headScale: 1.15, headZ: 0.55, pal: PAL_MU, armX: 3.5, leg: { sandal: null, foot: PAL_MU.M }, fine: false });
  for (const p of parts) {
    if (p.name === 'shinL' || p.name === 'shinR') {
      // a wrap below the knee and two at the ankle, a half voxel proud; a kneecap step
      for (const y of [3, 11]) for (let x = -2; x <= 2; x++) for (let z = -3; z <= 2; z++) {
        if (Math.abs(x) === 2 && (z === -3 || z === 2)) continue;
        if (Math.abs(x) < 2 && z > -3 && z < 2 && p.model.has(x, y, z)) continue;
        p.model.set(x, y, z, y === 11 ? (z >= 1 ? W.L : W.M) : y === 3 ? W.L : W.M);
      }
    }
    if (p.name === 'legL' || p.name === 'legR') p.model.set(0, 1, 3, PAL_MU.H).set(0, 2, 3, PAL_MU.L);   // the kneecap stands out
  }
  // the arms: rebuilt with the wraps, split at the elbow as manParts does
  for (const sd of ['L', 'R']) {
    const [up, lo] = splitArm(MU_ARM(sd), PAL_MU);
    parts.find((p) => p.name === `arm${sd}`).model = up;
    parts.find((p) => p.name === `fore${sd}`).model = lo;
  }
  rig('mummy', { voxel: 0.08, anim: 'human', style: 'mummy', pose: 'slash', stance: true, idles: true }, [
    ...parts,
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
// Round 28: a shell, not two bricks. The elytra are one stepped dome over the
// whole back, tallest along the seam in the middle and falling away to the
// rear and both sides, painted by height in six value steps: a near-black
// green rim that overhangs a near-black belly, bottle green, green, emerald, a
// gold-green iridescent shoulder and a pale white-green highlight band along
// the ridge (with a few white specular glints on each crown). The team colour
// is an iridescent edge band just above the rim (teal over team, violet at
// the tail), not a stripe on the seam. Legs are femur + knee + tibia +
// tarsus: a bronze knee knob at each joint, every segment with a lighter top
// face so the leg separates from its shadow. The mandibles are smooth inward
// hooks (a ten-segment curve, thick at the root, tapering to a dark tip) with
// a pale tooth on each inner edge.
{
  const S_RIM = 0x030e06, S_DEEP = 0x052410, S_MID = 0x0a4218, S_EM = 0x146428, S_IRI = 0x5a9c26, S_HI = 0xd8f8c0, S_GLINT = 0xffffff;
  const S_SEAM = 0x041a0a, S_TEAL = 0x1aa898, S_VIO = 0x6a40c0;
  const CH_D = 0x120d0a, CH_M = 0x2c2218, CH_L = 0x45362a;
  const PR_D = 0x16260f, PR_M = 0x2e5020, PR_L = 0x6a9030, PR_HI = 0xc8e890;
  const LEG_D = 0x0e0906, LEG_M = 0x261a10, LEG_TOP = 0x684a2e, KNEE = 0x3e2e18, KNEE_TOP = 0x86683a;
  const MD_D = 0x1e1008, MD_M = 0x3a2212, MD_TOP = 0x6e4422, MD_TIP = 0x0c0703, TOOTH = 0xd8c890;
  const OFFK = 512;
  const each = (m, fn) => { for (const [k, v] of m.vox) fn(((k >> 20) & 1023) - OFFK, ((k >> 10) & 1023) - OFFK, (k & 1023) - OFFK, v); };
  // every voxel open to the sky takes the light colour (unless it is a tip / tooth)
  const lightTops = (m, light, keep = new Set()) => each(m, (x, y, z, v) => { if (!m.has(x, y + 1, z) && !keep.has(v.c)) v.c = light; });
  const body = new VoxelModel();
  // the belly: a near-black chitin keel under the shell, narrower than the shell
  body.ellipsoid(6, 2.2, 9.5, 4.6, 2.2, 7.6, (x, y) => (y >= 3 ? CH_M : CH_D));
  // the elytra: one dome. Footprint a superellipse 6.6 either side of the
  // seam, square-shouldered at the front (z = 18), round at the rear (z = 0);
  // the height a cap over it so the crown runs along the seam
  const ZC = 10, BASE = 3, HT = 7.4;
  const elyH = (x, z) => {
    const u = (x - 6) / 6.6;
    const w = z < ZC ? (ZC - z) / 10.4 : (z - ZC) / 8.8;
    const q = 1 - u * u - (z < ZC ? w * w : w * w * w * w);
    if (q <= 0) return -1;
    return HT * Math.pow(q, 0.8);
  };
  const band = (f) => (f < 0.13 ? S_RIM : f < 0.3 ? S_DEEP : f < 0.5 ? S_MID : f < 0.62 ? S_EM : f < 0.77 ? S_IRI : S_HI);
  for (let z = 0; z <= 18; z++) for (let x = -1; x <= 13; x++) {
    const h = elyH(x, z);
    if (h < 0) continue;
    const top = Math.round(BASE + h);
    for (let y = BASE; y <= top; y++) body.set(x, y, z, band((y - BASE) / HT));
  }
  const topY = (x, z) => { let y = 14; while (y >= BASE && !body.has(x, y, z)) y--; return y; };
  // the lip: the lowest shell row reaches one voxel past the row above it all
  // round, near-black, so the shell overhangs a dark underside
  for (let z = 0; z <= 18; z++) for (let x = -1; x <= 13; x++) {
    if (!body.has(x, BASE, z)) continue;
    const o = x < 6 ? -1 : 1;
    if (!body.has(x + o, BASE, z) && Math.abs(x - 6) >= 3) body.set(x + o, BASE, z, S_RIM);
  }
  for (let z = 0; z <= 18; z++) if (body.has(6, BASE, z) && !body.has(6, BASE, z - 1) && z > 0) body.set(6, BASE, z - 1, S_RIM);
  // the iridescent edge band: on the outer face of the shell just above the
  // rim, team colour with a teal row over it, shading to violet at the tail
  for (let z = 0; z <= 18; z++) for (let x = -1; x <= 13; x++) for (const y of [BASE + 1, BASE + 2]) {
    const v = body.get(x, y, z);
    if (!v) continue;
    const o = x < 6 ? -1 : 1;
    const outer = !body.has(x + o, y, z) || !body.has(x, y, z - 1) || !body.has(x, y + 1, z);
    if (!outer) continue;
    if (y === BASE + 1) body.set(x, y, z, TEAM, { glow: 0.06 });
    else body.set(x, y, z, z <= 3 ? S_VIO : z <= 5 && (x + z) % 2 ? S_VIO : S_TEAL);
  }
  // the seam: a dark line down the crown, one voxel deep, opening at the rear
  for (let z = 0; z <= 18; z++) { const y = topY(6, z); if (y > BASE + 2) body.set(6, y, z, S_SEAM); }
  // specular glints: a short white streak on each crown, front of centre
  for (const x of [4, 8]) for (const z of [11, 12, 13]) { const y = topY(x, z); if (y > BASE + 5) body.set(x, y, z, S_GLINT, { glow: 0.15 }); }
  for (const x of [3, 9]) { const y = topY(x, 14); if (y > BASE + 4) body.set(x, y, 14, S_GLINT, { glow: 0.15 }); }
  // the pronotum: a rounded shield in front of the elytra, lower than the
  // shell, a dark gap between, a pale glint on each shoulder
  for (let z = 19; z <= 23; z++) for (let x = 1; x <= 11; x++) {
    const dx = (x - 6) / 5.2, dz = (z - 19.5) / 4.6;
    const q = 1 - dx * dx * dx * dx - dz * dz;
    if (q <= 0) continue;
    const top = Math.round(BASE - 0.5 + 4.4 * Math.sqrt(q));
    for (let y = BASE - 1; y <= top; y++) body.set(x, y, z, y >= top && q > 0.6 ? PR_L : y >= top - 1 ? PR_M : PR_D);
  }
  for (let x = 2; x <= 10; x++) { const y = topY(x, 19); if (y >= BASE) body.set(x, y, 19, PR_D); }
  for (const x of [4, 8]) body.set(x, topY(x, 21), 21, PR_HI);
  // the head (neck channel): a dark wedge, pale yellow eyes on its sides,
  // two curved stag mandibles hooking inward with a tooth on each inner edge
  const headM = new VoxelModel();
  headM.ellipsoid(0, 2.5, 2.4, 3.6, 2.4, 2.8, (x, y) => (y >= 4 ? CH_L : y >= 2 ? CH_M : CH_D));
  headM.box(-2, 4, 3, 5, 1, 2, 0x5e4a36);                       // a ridge across the brow
  for (const s of [-1, 1]) {
    headM.set(s * 4, 3, 2, 0xe8e070, { glow: 0.55 }).set(s * 4, 3, 3, 0xe8e070, { glow: 0.55 }).set(s * 4, 4, 2, 0xc8c058, { glow: 0.4 });
    headM.set(s * 4, 2, 3, CH_D);
  }
  const mand = new VoxelModel();
  const bez = (p0, p1, p2, p3, t) => p0.map((_, i) => { const u = 1 - t; return u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]; });
  for (const s of [-1, 1]) {
    const P = [[s * 2.2, 2.2, 4.4], [s * 7.0, 2.4, 7.6], [s * 6.8, 3.0, 13.2], [s * 1.6, 3.2, 15.0]];
    const N = 10;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const r0 = 1.7 - 1.15 * t0, r1 = 1.7 - 1.15 * t1;
      tube(mand, bez(...P, t0), bez(...P, t1), r0, r1, t1 > 0.9 ? MD_TIP : (x, y) => (y <= 1 ? MD_D : MD_M));
    }
    // the tooth: a stub off the inner edge two-thirds along, pointing in
    const a = bez(...P, 0.6);
    tube(mand, a, [a[0] - s * 2.2, a[1] + 0.2, a[2] + 0.3], 0.75, 0.4, TOOTH);
  }
  lightTops(mand, MD_TOP, new Set([MD_TIP, TOOTH]));
  headM.merge(mand);
  // six legs: femur out and up to a bronze knee knob, tibia down and out to a
  // smaller joint, tarsus on to a dark claw; every segment lit on top
  const legs = [];
  const leg = (nm, ch, zj, zdir) => {
    for (const s of [1, -1]) {
      const fem = new VoxelModel();
      tube(fem, [0, 0, 0], [s * 4.6, 1.6, zdir * 1.4], 1.5, 1.15, (x, y) => (y <= -1 ? LEG_D : LEG_M));
      lightTops(fem, LEG_TOP);
      const tib = new VoxelModel();
      const k = [s * 3.0, -5.0, zdir * 2.0], f = [s * 4.8, -6.8, zdir * 3.4];
      tube(tib, [0, 0, 0], k, 1.1, 0.8, LEG_M);
      tube(tib, k, f, 0.75, 0.55, LEG_D);
      lightTops(tib, LEG_TOP);
      for (const t of [0.35, 0.65]) tib.set(Math.round(k[0] * t + s * 1.2), Math.round(k[1] * t), Math.round(k[2] * t), LEG_D);   // outer spurs
      tib.box(-1, -1, -1, 2, 2, 2, (x, y) => (y >= 0 ? KNEE_TOP : KNEE));                                                    // the knee
      tib.set(Math.round(k[0]), Math.round(k[1]) + 1, Math.round(k[2]), KNEE_TOP).set(Math.round(k[0]), Math.round(k[1]), Math.round(k[2]), KNEE);   // the ankle
      tib.set(Math.round(f[0] + s * 0.6), Math.round(f[1]), Math.round(f[2] + zdir * 0.6), MD_TIP);
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

// Phoenix (flyer, 0.1, myth_13): a bird of fire. (round 27) Built on its own,
// not on the raptor kit: each wing is one continuous stepped surface. The arm
// (wingL / wingR) is a solid wedge in section, thick at the shoulder (the
// leading edge three voxels deep) and stepping down a voxel per feather tract
// toward the trailing edge, so the tracts overlap like shingles; each tract
// is one colour running the length of the wing (gold leading edge, gold and
// orange coverts, red-orange secondaries) with a dark shadow row under each
// step: feather-row stripes, no speckle. The hand (handL / handR, channels
// foreL / foreR) carries five primaries as two-row bands laid side by side
// (no gaps), each with a raised light shaft row, swept back and ending in a
// stepped, rounded tip. The flame colour runs to a gradient band at every tip:
// red-orange, crimson, a dark team step, then the team colour. The two span
// columns at the wing root are darkened (ambient occlusion where the wing
// meets the body). The head is about twice the old one: a big round orange
// head with red feather chevrons, a dark eye voxel on each side, a yellow
// hooked beak and a three-plume crest; a solid fanned tail of nine feathers
// with two long streamers; gold legs with dark talons.
{
  const DIM = (c, f) => ((Math.round(((c >> 16) & 255) * f) << 16) | (Math.round(((c >> 8) & 255) * f) << 8) | Math.round((c & 255) * f));
  // (the fire marker adds 1.1 x the colour as emission, so a full-value gold
  // bleaches to cream: the flame colours sit a step deeper and more saturated)
  const LEAD = 0xd89a00, C1 = 0xcc7c00, C1L = 0xd88c00, C2 = 0xc05800, C3 = 0xa83c00;
  const SEC = 0x9a2a00, SEC2 = 0x8a2200, LINE = 0x5a1000, CRIM = 0x780c30;
  const SHAFT = 0xcc7000, PRIM = 0xa83400, PRIM2 = 0x922800;
  const BEAK = 0xb88c00, BEAK_LO = 0x8c6400, BEAK_TIP = 0x3a2400;
  const NOGLOW = new Set([DARK, BEAK_TIP]);
  // team voxels shaded by base (the tint multiplies); the tips glow a little
  const tm = (m, x, y, z, base) => { m.set(x, y, z, TEAM, { glow: 0.12 }); m.get(x, y, z).c = base; };
  // a tip gradient: u = 0 .. 1 along a feather; returns a colour or a team base
  const tipC = (u, c) => (u > 0.86 ? ['t', 0xffffff] : u > 0.74 ? ['t', 0x8c8c8c] : u > 0.62 ? CRIM : c);
  const put = (m, x, y, z, c, ao = 1) => {
    if (Array.isArray(c)) return tm(m, x, y, z, c[1]);
    m.set(x, y, z, ao < 1 ? DIM(c, ao) : c);
  };
  const wing = (s) => {
    const X = (x) => (s > 0 ? x : -x - 1);
    const ARM = 10;
    const arm = new VoxelModel();
    for (let i = 0; i < ARM; i++) {
      const ao = i === 0 ? 0.6 : i === 1 ? 0.8 : 1;
      const k = i >> 1;                                  // the secondary feather this column belongs to
      const ch = Math.round(11 - (i * 2) / ARM) + (k % 2 ? 0 : 1);   // chord 12 -> 9, alternating by feather
      const rise = Math.floor(i * 0.2);
      const base = i < 5 ? 2 : 1;                        // thick at the shoulder, thinner to the wrist
      for (let v = 0; v <= ch; v++) {
        const lvl = Math.max(0, base - Math.floor(v / 3));
        const back = ch - v;                            // rows from the trailing edge
        let c;
        if (v === 0) c = LEAD;
        else if (v <= 2) c = v === 1 ? C1L : C1;
        else if (v <= 5) c = v === 3 ? DIM(C2, 0.72) : C2;            // lesser coverts, shadow row under the step
        else if (v <= 8) c = v === 6 ? DIM(C3, 0.72) : C3;            // greater coverts
        else c = v === 9 ? LINE : (k % 2 ? SEC : SEC2);               // secondaries
        if (v >= 9) c = tipC(1 - back / 4.2, c);
        else if (back <= 1) c = tipC(1 - back / 4.2, c);
        for (let y = 0; y <= lvl; y++) put(arm, X(i), rise + y, -v, y < lvl && !Array.isArray(c) ? DIM(c, 0.85) : c, ao);
      }
    }
    const armRise = Math.floor(ARM * 0.2);
    const hand = new VoxelModel();
    // five primaries, two chord rows each, laid side by side; the second is longest
    const LEN = [12, 13.5, 12.5, 11, 9.5];
    for (let p = 0; p < 5; p++) {
      for (let r = 0; r < 2; r++) {
        const v = p * 2 + r;
        const L = LEN[p] - (r === 1 ? 1 : 0);          // a stepped, rounded tip
        for (let x = 0; x <= L; x++) {
          const z = -v - Math.round(x * 0.42) - (x > L - 3 ? p * 0.0 : 0);
          const u = x / L;
          const cov = x < 5 - p * 0.8 && v < 6;        // the hand's coverts over the primary roots
          let c;
          if (cov) c = v === 0 ? LEAD : v < 3 ? C1 : C2;
          else c = r === 0 ? PRIM : PRIM2;
          if (!cov) c = tipC(u, c);
          put(hand, X(x), 0, z, c);
          // shingle: each primary's leading row is raised a voxel over the one behind it
          if (r === 0 && x < L - 1) put(hand, X(x), 1, z, cov ? (v === 0 ? LEAD : C1L) : tipC(u, SHAFT));
          if (v === 0 && x < 6) put(hand, X(x), -1, z, DIM(LEAD, 0.85));   // the thick leading edge to the wrist
        }
      }
    }
    return { arm, hand, armRise, armLen: ARM };
  };
  // the body: a gold breast and an orange back in red feather chevrons
  const body = new VoxelModel();
  const plumage = (x, y, z) => {
    const band = ((Math.floor((z * 2 + Math.abs(x) * 1.2) / 3) % 3) + 3) % 3;
    let c = y < 0 ? (band === 0 ? 0xc06800 : 0xd08c00) : band === 0 ? 0x8a2000 : band === 1 ? 0xb84c00 : 0xc87000;
    if (Math.abs(x) >= 2 && y >= 0 && z > -3 && z < 4) c = DIM(c, 0.62);   // shade where the wings meet the body
    return c;
  };
  body.ellipsoid(0, 0, 0, 3, 2.6, 5.2, plumage);
  // neck and a big head (twice the old one)
  for (let k = 0; k <= 3; k++) body.ellipsoid(0, 0.6 + k * 0.4, 4 + k * 0.9, 2.2, 2.1, 1.2, plumage);
  const hz = 8.6, hy = 2.6;
  body.ellipsoid(0, hy, hz, 3, 2.8, 3, (x, y, z) => {
    const band = ((Math.floor((-(z - hz) * 2 + (y - hy) * 1.4) / 2.5) % 3) + 3) % 3;
    return band === 0 ? 0x7a1600 : y > hy + 1 ? 0xc07000 : 0xa84800;
  });
  const ey = Math.round(hy + 0.5), ez = Math.round(hz + 1);
  for (const x of [-3, 3]) {
    body.set(x, ey, ez, DARK).set(x, ey, ez + 1, DARK);                  // the eye: two dark voxels set in the head
    body.set(x, ey + 1, ez, 0x7a1800).set(x, ey + 1, ez - 1, 0x7a1800).set(x, ey + 1, ez + 1, 0x7a1800);   // a red brow
    body.set(x, ey - 1, ez, 0xd89a00).set(x, ey, ez - 1, 0xd89a00);      // a gold eye-ring
  }
  // the beak: a broad yellow base, the upper mandible hooking down over the lower
  const bz = Math.round(hz + 3);
  body.box(-1, ey - 1, bz, 3, 2, 1, BEAK).box(-1, ey - 2, bz, 3, 1, 1, BEAK_LO);
  body.box(-1, ey - 1, bz + 1, 3, 1, 1, BEAK).set(0, ey, bz + 1, BEAK).set(0, ey - 2, bz + 1, BEAK_LO);
  body.set(0, ey - 1, bz + 2, BEAK).set(0, ey - 2, bz + 2, BEAK).set(0, ey - 3, bz + 2, BEAK_TIP);
  // the crest: three plumes sweeping up and back, gold to red to team
  for (const [px, len] of [[0, 9], [-1, 6], [1, 6]]) {
    for (let i = 0; i < len; i++) {
      const u = i / len, y = Math.round(hy + 2.6 + i * 0.45), z = Math.round(hz + 1 - i), x = px * (i < 3 ? 1 : 2);
      const c = tipC(u, u < 0.35 ? C1 : SEC);
      put(body, x, y, z, c);
      put(body, x, y - 1, z, u > 0.62 ? c : u < 0.3 ? C2 : PRIM);    // two voxels deep: one solid plume
    }
  }
  // the tail: a solid fan of nine feathers (shafts lighter, edges dark) and two long streamers
  const tail = new VoxelModel();
  const N = 9, SPREAD = 0.72, TL = 15;
  for (let z = 0; z >= -TL - 2; z--) for (let x = -13; x <= 13; x++) {
    const r = Math.hypot(x, z), a = Math.atan2(x, -z + 0.001);
    if (Math.abs(a) > SPREAD + 0.06) continue;
    const fi = (a + SPREAD) / (2 * SPREAD) * (N - 1), f = Math.round(fi), off = Math.abs(fi - f);
    const L = TL - Math.abs(f - (N - 1) / 2) * 0.6 + (f % 2 ? 0 : 0.8);
    if (r > L) continue;
    const u = r / L;
    let c = off > 0.38 ? LINE : off < 0.12 ? SHAFT : f % 2 ? PRIM : SEC;
    if (r < 3) c = r < 2 ? C1 : C2;           // the coverts over the root of the fan
    put(tail, x, -Math.round(r * 0.08), z, u > 0.62 ? tipC(u, c) : c);
  }
  // (two voxels deep and stepping straight back, so each streamer is one solid ribbon)
  for (let i = 0; i < 14; i++) for (const x of [-1, 1]) {
    const u = i / 14, sx = x * (1 + (i > 7 ? 1 : 0)), sy = -1 - (i >> 2);
    put(tail, sx, sy, -i - 11, tipC(u, i < 5 ? SEC : PRIM2));
    put(tail, sx, sy + 1, -i - 11, tipC(u, SHAFT));
  }
  // legs: orange "trousers", gold shanks two voxels thick, three forward toes and dark talons
  const leg = new VoxelModel();
  leg.ellipsoid(0, 3, 0, 1.4, 1.6, 1.4, C2);
  leg.box(0, 0, 0, 2, 3, 2, BEAK_LO);
  for (const tx of [-1, 1, 2]) leg.box(tx, -1, 1, 1, 1, 3, BEAK_LO).set(tx, -2, 4, DARK);
  leg.box(0, -1, -1, 2, 1, 1, BEAK_LO).set(0, -2, -2, DARK);
  const L = wing(1), R = wing(-1);
  // every flame voxel carries glow 0.8 (the unit shader's fire marker, see
  // PORTING "Raptors"); the team tips glow 0.12, the eyes and talons stay unlit
  const burn = (m) => { for (const v of m.vox.values()) if (!v.team && !NOGLOW.has(v.c)) v.glow = 0.8; return m; };
  for (const m of [body, tail, L.arm, L.hand, R.arm, R.hand, leg]) burn(m);
  rig('phoenix', { voxel: 0.1, anim: 'flyer', style: 'phoenix', hover: 16 }, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('wingL', L.arm, [0, 0, 0], [3.3, 1.5, 2.5], 'body'),
    part('handL', L.hand, [0, 0, 0], [L.armLen, L.armRise, 0], 'wingL', { anim: 'foreL' }),
    part('wingR', R.arm, [0, 0, 0], [-2.3, 1.5, 2.5], 'body'),
    part('handR', R.hand, [0, 0, 0], [-R.armLen, R.armRise, 0], 'wingR', { anim: 'foreR' }),
    part('tail', tail, [0, 0, 0], [0.5, 1.5, -5], 'body'),
    part('legL', leg, [0.5, 3, 0], [1.2, -2, -1], 'body'),
    part('legR', leg, [0.5, 3, 0], [-1.2, -2, -1], 'body'),
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

// (round 33) a greedy mesher for the fine parts (same attributes as
// buildVoxelGeometry, no AO, no jitter): coplanar faces of one colour merge
// into one quad, so the fine limbs and torsos cost about what the body-grid
// ones did instead of three times the triangles
const _gc = new THREE.Color();
function greedyGeometry(model, { size, pivot }) {
  const pos = [], nor = [], col = [], team = [], glow = [], idx = [];
  const V = model.vox;
  const K = (x, y, z) => ((x + 512) << 20) | ((y + 512) << 10) | (z + 512);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const [k] of V) {
    const c = [((k >> 20) & 1023) - 512, ((k >> 10) & 1023) - 512, (k & 1023) - 512];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
  }
  const at = (c) => V.get(K(c[0], c[1], c[2]));
  for (let a = 0; a < 3; a++) for (const sgn of [1, -1]) {
    const u = (a + 1) % 3, w = (a + 2) % 3;
    const nU = hi[u] - lo[u] + 1, nW = hi[w] - lo[w] + 1;
    for (let sl = lo[a]; sl <= hi[a]; sl++) {
      const mask = new Array(nU * nW).fill(null);
      for (let i = 0; i < nU; i++) for (let j = 0; j < nW; j++) {
        const c = [0, 0, 0]; c[a] = sl; c[u] = lo[u] + i; c[w] = lo[w] + j;
        const v = at(c);
        if (!v) continue;
        const nb = c.slice(); nb[a] += sgn;
        if (at(nb)) continue;
        mask[i + j * nU] = `${v.c}|${v.team ? 1 : 0}|${v.glow || 0}`;
      }
      for (let j = 0; j < nW; j++) for (let i = 0; i < nU; ) {
        const key = mask[i + j * nU];
        if (!key) { i++; continue; }
        let wd = 1;
        while (i + wd < nU && mask[i + wd + j * nU] === key) wd++;
        let ht = 1;
        grow: while (j + ht < nW) {
          for (let q = 0; q < wd; q++) if (mask[i + q + (j + ht) * nU] !== key) break grow;
          ht++;
        }
        for (let r = 0; r < ht; r++) for (let q = 0; q < wd; q++) mask[i + q + (j + r) * nU] = null;
        const [cs, ts, gs] = key.split('|');
        _gc.setHex(+cs);
        const plane = sl + (sgn > 0 ? 1 : 0);
        const corner = (du, dw) => { const p = [0, 0, 0]; p[a] = plane; p[u] = lo[u] + i + du; p[w] = lo[w] + j + dw; return p; };
        let cs4 = [corner(0, 0), corner(wd, 0), corner(wd, ht), corner(0, ht)];
        // counter-clockwise seen from outside (as buildVoxelGeometry's faces)
        const e1 = [0, 1, 2].map((q) => cs4[1][q] - cs4[0][q]), e2 = [0, 1, 2].map((q) => cs4[2][q] - cs4[0][q]);
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (cr[a] * sgn < 0) cs4 = [cs4[0], cs4[3], cs4[2], cs4[1]];
        const base = pos.length / 3;
        const n = [0, 0, 0]; n[a] = sgn;
        for (const p of cs4) {
          pos.push((p[0] - pivot[0]) * size, (p[1] - pivot[1]) * size, (p[2] - pivot[2]) * size);
          nor.push(...n); col.push(_gc.r, _gc.g, _gc.b); team.push(+ts); glow.push(+gs);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        i += wd;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('team', new THREE.Float32BufferAttribute(team, 1));
  geo.setAttribute('glow', new THREE.Float32BufferAttribute(glow, 1));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  return geo;
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
    const ol = p.outline ?? 0.3;   // (round 25) a part may thin its own line (the Avenger's blades)
    let model = p.model, size = R.voxel * (p.scale || 1), pivot = p.pivot, outlineAt = null;
    if (p.fine) {
      // (round 33) a fine limb (refineLimb): twice the grid, half the voxel
      model = p.fine === 'torso' ? refineTorso(p.model, p.finePal) : refineLimb(p.model, p.fine, p.fineOut, { pal: p.finePal, k: p.fineK ?? 1 });
      size /= 2; pivot = pivot.map((v) => v * 2);
      if (p.fine !== 'torso') { const fo = fineOutline(p.fine), sz = size, py = pivot[1]; outlineAt = (y) => fo(y / sz + py); }
    }
    // (round 33) a fine part's line at about half the width: at the full
    // width the hull of a narrower row poked through the steps of the fine
    // surface as dark ticks along every limb
    // (round 34) a fine head (fineHead, authored on its fine grid) meshed the same way
    const greedy = p.fine || p.greedy;
    g.add(`${type}/${p.name}`, greedy ? greedyGeometry(model, { size, pivot }) : buildVoxelGeometry(model, { size, pivot, jitter: p.jitter ?? 0.05, ao: p.ao ?? true }), { outline: p.fine ? ol * 0.55 : ol, outlineAt, flatY: !!greedy });
  }
}
g.extra.unitTypes = Object.keys(RIGS);
g.write();
