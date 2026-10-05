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
// crocodile, a rainbow scarab, a blue scorpion under a man, a winged cobra,
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
// sun-bronzed Egyptian skin, a step darker and browner than the Greeks'
const SKIN = pick3(3, 0x94572f, 0x8a4f2a, 0x9e6036);
const SKIN_SH = 0x6a3a1e;
const SKIN_DK = pick3(4, 0x5c3824, 0x4f2f1e, 0x684230);   // the Nubian mercenaries
const SKIN_DK_SH = 0x3a2216;
const HAIR = 0x1c1410;
const DARK = 0x140e0a;
const EYE_WHITE = 0xf0e8dc;
const LINEN = pick3(6, 0xf2ecdc, 0xe8e0cb, 0xf8f4e8, 0.55, 0.85);
const LINEN_SH = 0xcfc5ab;
const GOLD = pick3(31, 0xd2a400, 0xc09400, 0xe0b414, 0.45, 0.8);   // deep: the exposure and the tone map's highlight roll-off wash a bright gold to cream
const GOLD_DK = 0x6a4206;
const BRONZE = pick3(2, 0xd29c44, 0xbb8636, 0xe8be62, 0.45, 0.8);
const SILVER = pick3(5, 0xd8dde2, 0xc4cad0, 0xeef1f4);
const SILVER_DK = 0x8c939a;
const LEATHER = 0x6e4526;
const LEATHER_DK = 0x452a16;
const SANDAL = 0x6a4524;
const WOOD = pick3(9, 0x8a5e36, 0x7d5431, 0x96683c);
const WOOD_DK = 0x553820;
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
const HAND = [0, -6, 0];
// collision offsets: a long haft is gripped a little outside and in front of
// the fist and a shield is strapped clear of the forearm, so posed arms swing
// them past the body rather than through it
const GRIP = [-0.6, -6, 0.8];
const SHIELD_AT = [2.4, -4, 3.5];

// ---- human body (the Greek rig's proportions: 0.07 voxels, ~24 tall) ---------
function thighM(skin, kilt = null) {
  const m = new VoxelModel().box(0, 0, 0, 2, 6, 2, skin);
  if (kilt) m.box(0, 4, 0, 2, 2, 2, kilt);
  return m;
}
function shinM(skin, { sandal = true, band: bnd = null, wrap = null, foot = null } = {}) {
  const m = new VoxelModel().box(0, 1, 0, 2, 5, 2, skin);
  if (wrap) for (let y = 1; y <= 5; y++) m.box(0, y, 0, 2, 1, 2, y % 2 ? wrap : LINEN_SH);
  if (bnd) m.box(0, 4, 0, 2, 1, 2, bnd);
  m.box(0, 0, 0, 2, 1, 3, foot || (sandal ? SANDAL : skin));
  if (sandal) m.set(0, 1, 1, SANDAL).set(1, 1, 1, SANDAL);
  return m;
}
function legsE(o = {}) {
  const t = thighM(o.skin || SKIN, o.thighKilt || null), s = shinM(o.skin || SKIN, o);
  return [
    part('legL', t, [1, 6, 1], [1.7, 12, 0]),
    part('shinL', s, [1, 6, 1], [0, -6, 0], 'legL'),
    part('legR', t, [1, 6, 1], [-1.7, 12, 0]),
    part('shinR', s, [1, 6, 1], [0, -6, 0], 'legR'),
  ];
}

// Torso: x 0..7, z 0..3 (front z = 3), hips y = 0, shoulders y = 8.
function torsoBody(skin, shade = SKIN_SH) {
  const m = new VoxelModel();
  m.box(1, 0, 0, 6, 3, 4, skin);
  m.box(0, 3, 0, 8, 5, 4, skin);
  m.box(1, 8, 1, 6, 1, 2, skin);
  m.box(3, 8, 1, 2, 2, 2, skin);                  // neck
  m.set(3, 5, 3, shade).set(4, 5, 3, shade);      // pec line
  m.set(3, 3, 3, shade).set(4, 2, 3, shade);      // abdomen
  return m;
}
// kilt (shendyt) from the belt down to mid-thigh, in the army's colour with
// shaded pleats, a pale hem and an optional front apron
function kilt(m, { len = 4, color = TEAM, hem = TEAM_TRIM, apron = null, belt = LEATHER_DK, flare = true } = {}) {
  for (let i = 1; i <= len; i++) {
    const y = -i, wide = flare && i >= 2;
    const x0 = wide ? 0 : 1, w = wide ? 8 : 6, z0 = wide ? -1 : 0, d = wide ? 6 : 4;
    if (color === TEAM) {
      m.box(x0, y, z0, w, 1, d, TEAM);
      for (let x = x0; x < x0 + w; x += 2) { tset(m, x, y, z0 + d - 1, TEAM_SHADE); tset(m, x, y, z0, TEAM_SHADE); }
    } else m.box(x0, y, z0, w, 1, d, color);
    if (i === len && hem) m.box(x0, y, z0, w, 1, d, hem);
  }
  if (apron) { m.box(3, -len - 1, 4, 2, len + 1, 1, apron); m.set(3, -len - 2, 4, apron).set(4, -len - 2, 4, apron); }
  if (belt) m.box(0, 0, -1, 8, 1, 6, belt);
  return m;
}
// broad collar (wesekh): rows of gold and the army's colour over the shoulders
function collar(m, rows = [GOLD, TEAM, GOLD], skin = SKIN) {
  rows.forEach((c, i) => {
    const y = 8 - i;
    m.box(0, y, -1, 8, 1, 6, c);
    if (i === 0) m.box(1, y + 1, 0, 6, 1, 4, c);
  });
  m.box(3, 8, 1, 2, 2, 2, skin); m.box(3, 9, 1, 2, 1, 2, skin);
  return m;
}
// leather harness straps crossed over a bare chest (spearmen)
function harness(m, color = LEATHER_DK) {
  m.line(1, 8, 4, 6, 1, 4, color).line(6, 8, 4, 1, 1, 4, color);
  m.line(1, 8, -1, 6, 1, -1, color).line(6, 8, -1, 1, 1, -1, color);
  m.set(1, 8, 4, SILVER(1, 8, 4)).set(6, 8, 4, SILVER(6, 8, 4)).box(3, 4, 4, 2, 2, 1, SILVER);
  return m;
}
function scaleArmor(m, a = SILVER, b = SILVER_DK) {
  for (let y = 1; y <= 7; y++) for (let x = 0; x < 8; x++) {
    const c = (x + (y % 2)) % 2 ? a : b;
    m.set(x, y, 4, typeof c === 'function' ? c(x, y, 4) : c); m.set(x, y, -1, typeof c === 'function' ? c(x, y, -1) : c);
  }
  for (let y = 1; y <= 7; y++) for (let z = 0; z < 4; z++) { m.set(-1, y, z, a(-1, y, z)); m.set(8, y, z, a(8, y, z)); }
  return m;
}

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
function faceN(m, skin = SKIN, shade = SKIN_SH, { eyes = null, brow = HAIR, nose = null } = {}) {
  for (let y = 0; y <= 7; y++) for (let x = 0; x <= 6; x++) for (let z = 0; z <= 5; z++) {
    const ex = x === 0 || x === 6, ez = z === 0 || z === 5;
    if (ex && ez) continue;                              // rounded vertical edges
    if (y === 7 && (ex || ez)) continue;                 // rounded crown
    if (y === 0 && (ex || z === 0)) continue;            // the jaw narrows to the chin
    if (y === 1 && ex && z >= 4) continue;
    m.set(x, y, z, ex || z === 0 ? shade : skin);
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
function headE(style) {
  const m = new VoxelModel();
  const dark = style === 'merc' || style === 'mercCav';
  faceN(m, dark ? SKIN_DK : SKIN, dark ? SKIN_DK_SH : SKIN_SH, { nose: dark ? 0x6e4632 : 0xa86a3e });
  if (style === 'laborer') {
    // a white linen khat bound with a team band, gathered into a bag at the nape
    capN(m, LINEN, { y0: 5, front: 6, top: 8 });
    ringN(m, 6, TEAM);
    for (let x = 0; x <= 6; x++) tset(m, x, 6, 6, TEAM_SHADE);
    m.box(1, 1, -2, 5, 5, 1, LINEN).box(2, -1, -2, 3, 2, 1, LINEN_SH);
    m.box(-1, 3, 0, 1, 3, 3, LINEN).box(7, 3, 0, 1, 3, 3, LINEN);
  } else if (style === 'spear') {
    // shaved head with a team headband and one long braided side lock
    for (let x = 1; x <= 5; x++) for (let z = 1; z <= 4; z++) m.set(x, 8, z, SKIN_SH);
    ringN(m, 6, TEAM);
    m.box(-2, 1, 1, 1, 5, 2, HAIR).box(-2, -3, 1, 1, 4, 1, HAIR).set(-2, -4, 1, GOLD(0, 0, 0));
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
        if ((x + y * 2 + z) % 5 === 0 && y > 6) m.set(x, y, z, GOLD); else m.set(x, y, z, TEAM);
      }
    }
    m.box(-1, 6, 6, 9, 1, 1, GOLD).carve(-1, 6, 6, 1, 1, 1).carve(7, 6, 6, 1, 1, 1);
    m.set(3, 7, 7, GOLD).set(3, 8, 7, GOLD).set(3, 9, 7, 0xff5a2a);   // uraeus
    m.box(-1, 1, -1, 9, 4, 1, TEAM).box(-1, 1, 0, 1, 4, 3, TEAM).box(7, 1, 0, 1, 4, 3, TEAM);
    m.box(3, -3, 5, 1, 3, 1, GOLD).set(3, -3, 6, GOLD);                // beard
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
    nemesN(m, GOLD, TEAM, { chest: 8 });
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
function head(style, joint = [0, 10, 0.2], parent = 'torso', extra = {}) {
  return { ...headPart(style, joint, parent), ...extra };
}
// Arm: x 0..1, y 0..6 (the hand at the bottom), pivot at the shoulder.
function armM({ skin = SKIN, shade = SKIN_SH, upper = null, bracer = null, band: bnd = null, side = 'L', sleeve = null } = {}) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 2, 2, 2, skin).box(0, 2, 0, 2, 3, 2, skin).box(0, 5, 0, 2, 2, 2, upper || skin);
  if (sleeve) m.box(0, 4, 0, 2, 3, 2, sleeve);
  if (bracer) m.box(0, 2, 0, 2, 2, 2, bracer);
  if (bnd) m.box(0, 5, 0, 2, 1, 2, bnd);
  m.set(side === 'L' ? 0 : 1, 1, 2, shade);
  return m;
}
function arms(o = {}, y = 8) {
  return [
    part('armL', armM({ ...o, side: 'L' }), [1, 7, 1], [5.5, y, 0], 'torso'),
    part('armR', armM({ ...o, side: 'R' }), [1, 7, 1], [-5.5, y, 0], 'torso'),
  ];
}

// ---- hand-held gear (along +y, the grip at the origin) -------------------------
function spearM(len = 26, head = BRONZE) {
  const m = new VoxelModel();
  m.box(0, -9, 0, 1, len, 1, (x, y, z) => (y % 6 === 0 ? WOOD_DK : WOOD(x, y, z)));
  const t = len - 9;
  m.box(0, t, 0, 1, 6, 1, head).set(0, t + 6, 0, GOLD_DK);
  m.box(-1, t + 1, 0, 3, 3, 1, head).box(0, t + 1, -1, 1, 3, 3, head);
  m.set(0, t - 1, 0, TEAM).set(0, t - 2, 0, TEAM);   // a team tassel under the blade
  m.box(0, -11, 0, 1, 2, 1, head);
  return m;
}
// the epsilon axe: a long haft and a gold crescent blade held at two tangs
function epsilonAxeM() {
  const m = new VoxelModel();
  m.box(0, -6, 0, 1, 22, 1, (x, y, z) => (y % 5 === 0 ? WOOD_DK : WOOD(x, y, z)));
  for (let y = 9; y <= 16; y++) {
    const d = Math.abs(y - 12.5);
    const z1 = 5 - Math.round(d * d * 0.18);
    for (let z = 1; z <= z1; z++) m.set(0, y, z, z === z1 ? 0xe0a838 : GOLD(0, y, z));
  }
  m.carve(0, 11, 1, 1, 3, 2);           // the open eye between the tangs (the epsilon)
  m.set(0, 16, 0, GOLD_DK).set(0, 9, 0, GOLD_DK);
  return m;
}
// khopesh: a short grip, a straight neck, then the hooked sickle blade forward
function khopeshM(col = BRONZE) {
  const m = new VoxelModel();
  m.box(0, -2, 0, 1, 3, 1, LEATHER).set(0, -3, 0, GOLD(0, 0, 0)).box(-1, 1, 0, 3, 1, 1, GOLD);
  m.box(0, 2, 0, 1, 5, 1, col);
  const arc = [[7, 0], [8, 1], [9, 2], [9, 3], [9, 4], [8, 5], [7, 5], [6, 6]];
  for (const [y, z] of arc) { m.set(0, y, z, col); m.set(0, y - 1, z, col); }
  m.set(0, 5, 6, 0xf6f0d0);
  return m;
}
// the camel rider's long khopesh-sword: a gold hilt, a bright blade leaning out from
// the body (-x, the rider's right) and hooked forward at the tip
function camelSwordM() {
  const m = new VoxelModel();
  m.box(0, -2, 0, 1, 3, 1, LEATHER).set(0, -3, 0, GOLD(0, 0, 0)).box(-1, 1, -1, 3, 1, 3, GOLD);
  // the blade runs forward and a little up and out from the fist, hooked at the tip
  for (let i = 0; i <= 8; i++) {
    const x = -Math.round(i * 0.3), y = 2 + Math.round(i * 0.45), z = 1 + i;
    m.set(x, y, z, SILVER_DK).set(x, y + 1, z, SILVER(x, y + 1, z));
  }
  for (const [y, z] of [[8, 10], [8, 11], [7, 11], [6, 11], [6, 12]]) m.set(-2, y, z, z >= 11 ? 0xf4f6f8 : SILVER(0, y, z));
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
    m.set(x, y, 0, edge ? GOLD_DK : (x === 0 ? LEATHER_DK : WOOD));
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
  m.box(0, 0, -2, 1, 1, 14, WOOD).set(0, 0, 12, BRONZE(0, 0, 0)).set(0, 0, 13, BRONZE(0, 0, 1));
  m.box(0, 0, -3, 1, 1, 3, 0xf4f0e8).set(0, 1, -2, TEAM).set(0, -1, -2, TEAM);
  return m;
}
// a sling: two cords from the fist to a leather pouch holding a stone
function slingM() {
  const m = new VoxelModel();
  m.box(0, 0, 0, 1, 7, 1, 0xd8c69a).set(1, 1, 0, 0xd8c69a);
  m.box(-1, 7, 0, 3, 2, 1, LEATHER).set(0, 8, 1, STONE(0, 8, 1)).set(0, 9, 0, STONE(0, 9, 0));
  return m;
}
// the priest's staff, topped by a gold ankh
function ankhStaffM() {
  const m = new VoxelModel();
  m.box(0, -10, 0, 1, 25, 1, (x, y, z) => (y % 7 === 0 ? GOLD(x, y, z) : WOOD_DK));
  const G = (x, y, z) => GOLD(x, y, z);
  m.box(-3, 15, 0, 7, 1, 1, G).box(0, 14, 0, 1, 2, 1, G);
  for (const [x, y] of [[-1, 16], [1, 16], [-2, 17], [2, 17], [-2, 18], [2, 18], [-1, 19], [1, 19], [0, 19]]) m.set(x, y, 0, G, { glow: 0.25 });
  return m;
}
// the pharaoh's crook, striped gold and team
function crookM() {
  const m = new VoxelModel();
  const S = (x, y, z) => ((y >> 1) & 1 ? GOLD(x, y, z) : TEAM);
  for (let y = -4; y <= 13; y++) m.set(0, y, 0, S(0, y, 0));
  for (const [y, z] of [[14, 0], [15, 1], [15, 2], [14, 3], [13, 3], [12, 3]]) m.set(0, y, z, S(0, y, z));
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

// ---- rigs --------------------------------------------------------------------
const RIGS = {};
function rig(type, meta, parts) { RIGS[type] = { ...meta, parts }; }
// scale a sub-rig's internal joints (a rider at another rig voxel size)
const sc = (j, s) => j.map((v) => v * s);

// Laborer: bare chest, white linen kilt with a team sash, a white khat.
{
  const t = torsoBody(SKIN);
  kilt(t, { len: 3, color: LINEN, hem: LINEN_SH, belt: TEAM });
  t.box(0, 0, -1, 8, 1, 6, TEAM).box(5, -3, 4, 1, 3, 1, TEAM);    // team sash and its end
  t.box(1, 8, 0, 6, 1, 4, SKIN).box(3, 8, 1, 2, 2, 2, SKIN);
  const showTool = (n) => ({ conditional: true, portrait: false });
  rig('laborer', { voxel: 0.07, anim: 'human', style: 'villager' }, [
    ...legsE({ sandal: false }), part('torso', t, [4, 0, 2], [0, 12, 0]), head('laborer'),
    ...arms({ bracer: null, band: TEAM }),
    part('toolAxe', axeToolM(), [0, 0, 0], HAND, 'armR', showTool()),
    part('toolPick', pickToolM(), [0, 0, 0], HAND, 'armR', showTool()),
    part('toolSickle', sickleToolM(), [0, 0, 0], HAND, 'armR', showTool()),
    part('toolHammer', hammerToolM(), [0, 0, 0], HAND, 'armR', showTool()),
    part('carryWood', logsM(), [2, 0, 6], [-2.5, 8.5, 0], 'torso', showTool()),
    part('carryGold', basketM('gold'), [3, 0, 4], [0, 1, -2], 'torso', showTool()),
    part('carryFood', basketM('food'), [3, 0, 4], [0, 1, -2], 'torso', showTool()),
  ]);
}

// Spearman: bare-chested with a crossed harness, a team kilt and armbands,
// a long spear and a round-topped team shield.
{
  const t = torsoBody(SKIN);
  kilt(t, { len: 4, apron: LINEN, belt: LEATHER_DK });
  harness(t);
  rig('spearman', { voxel: 0.07, anim: 'human', style: 'spear', pose: 'spear' }, [
    ...legsE({ band: TEAM }), part('torso', t, [4, 0, 2], [0, 12, 0]), head('spear'),
    ...arms({ bracer: TEAM, band: TEAM }),
    part('weapon', spearM(28), [0, 0, 0], GRIP, 'armR'),
    part('shield', egShieldM({ face: TEAM, rim: BRONZE, boss: BRONZE }), [0, 0, 0], SHIELD_AT, 'armL'),
  ]);
}

// Axeman: a gold scale collar, a black-and-gold nemes, a team kilt, the gold
// epsilon axe and a gold and team shield.
{
  const t = torsoBody(SKIN);
  kilt(t, { len: 4, apron: GOLD, belt: GOLD });
  collar(t, [GOLD, GOLD, GOLD_DK, GOLD]);
  for (let x = 0; x < 8; x++) for (let y = 5; y <= 8; y++) if ((x + y) % 2) { if (t.has(x, y, 4)) t.set(x, y, 4, 0xe8c020); }
  rig('axeman', { voxel: 0.07, anim: 'human', style: 'axe', pose: 'slash' }, [
    ...legsE({}), part('torso', t, [4, 0, 2], [0, 12, 0]), head('axe'),
    ...arms({ upper: TEAM, band: GOLD, bracer: GOLD }),
    part('weapon', epsilonAxeM(), [0, 0, 0], GRIP, 'armR'),
    part('shield', egShieldM({ face: GOLD, rim: TEAM, boss: GOLD_DK, bands: true }), [0, 0, 0], SHIELD_AT, 'armL'),
  ]);
}

// Slinger: a short team kilt, a leopard-skin vest, a headband, the sling.
{
  const t = torsoBody(SKIN);
  kilt(t, { len: 3, belt: LEATHER_DK });
  const LEO = (x, y, z) => (hash3(x, y, z, 77) < 0.28 ? 0x3a2414 : hash3(x, y, z, 78) < 0.5 ? 0xd8a24a : 0xc8923c);
  t.box(0, 1, -1, 8, 7, 6, LEO).box(1, 8, 0, 6, 1, 4, LEO).box(2, 4, 4, 4, 4, 1, SKIN);    // open at the chest
  t.box(3, 8, 1, 2, 2, 2, SKIN);
  collar(t, [GOLD], SKIN);
  rig('slinger', { voxel: 0.07, anim: 'archer', style: 'sling', pose: 'sling' }, [
    ...legsE({}), part('torso', t, [4, 0, 2], [0, 12, 0]), head('sling'),
    ...arms({ bracer: TEAM }),
    part('weapon', slingM(), [0, 0, 0], HAND, 'armR'),
    part('pouch', new VoxelModel().box(0, 0, 0, 3, 3, 2, LEATHER).box(0, 3, 0, 3, 1, 2, TEAM), [1.5, 0, 1], [3.5, -1, -0.5], 'torso'),
  ]);
}

// Mercenary: a Nubian spearman in a team loincloth with a round shield.
{
  const t = torsoBody(SKIN_DK, SKIN_DK_SH);
  t.box(1, -1, 0, 6, 1, 4, TEAM).box(2, -4, 4, 4, 3, 1, TEAM).box(2, -3, -1, 4, 2, 1, TEAM);
  t.box(0, 0, -1, 8, 1, 6, LEATHER_DK);
  t.box(1, 8, 0, 6, 1, 4, GOLD).box(0, 7, 0, 8, 1, 4, GOLD).box(3, 8, 1, 2, 2, 2, SKIN_DK);
  const sh = new VoxelModel();
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const d = Math.hypot(x, y); if (d > 5.3) continue;
    sh.set(x, y, 1, d > 4.4 ? TEAM : d < 1.2 ? SILVER(x, y, 1) : (Math.abs(x) <= 1 ? TEAM_TRIM : TEAM));
    sh.set(x, y, 0, LEATHER_DK);
  }
  sh.box(0, -1, -1, 1, 3, 1, LEATHER);
  rig('mercenary', { voxel: 0.07, anim: 'human', style: 'spear', pose: 'spear' }, [
    ...legsE({ skin: SKIN_DK, sandal: false, band: TEAM, foot: SKIN_DK }), part('torso', t, [4, 0, 2], [0, 12, 0]), head('merc'),
    ...arms({ skin: SKIN_DK, shade: SKIN_DK_SH, band: TEAM, bracer: TEAM }),
    part('weapon', spearM(24, SILVER), [0, 0, 0], GRIP, 'armR'),
    part('shield', sh, [0, 0, 0], SHIELD_AT, 'armL'),
  ]);
}

// Priest: a white robe to the feet, a gold sash, gold armbands, the ankh staff.
{
  const t = torsoBody(SKIN);
  t.box(0, 1, -1, 8, 7, 6, LINEN).box(1, 8, 0, 6, 1, 4, LINEN).box(3, 8, 1, 2, 2, 2, SKIN);
  for (let x = 1; x <= 6; x++) t.set(x, 8, 4, x % 2 ? 0x2a3a6a : LINEN(x, 8, 4));   // a dark zigzag collar edge
  t.box(0, 0, -1, 8, 2, 6, GOLD);                                                 // gold sash
  // the robe hangs to the ankles round the legs (bell skirt)
  for (let i = 1; i <= 10; i++) {
    const y = -i, w = i < 3 ? 8 : 10, d = i < 3 ? 6 : 7;
    t.box(4 - w / 2, y, 2 - Math.floor(d / 2) + 0, w, 1, d, i === 10 ? GOLD : LINEN);
  }
  t.box(3, -10, 5, 2, 10, 1, GOLD);   // the sash's long end down the front
  rig('priest', { voxel: 0.07, anim: 'human', style: 'priest', pose: 'staff' }, [
    ...legsE({ sandal: false }), part('torso', t, [4, 0, 2], [0, 12, 0]), head('priest'),
    ...arms({ sleeve: LINEN, bracer: GOLD }),
    part('weapon', ankhStaffM(), [0, 0, 0], GRIP, 'armR'),
  ]);
}

// Pharaoh: the blue (team) crown, a gold collar and a gold robe over a team
// skirt to the feet, the striped crook. A head taller than his men.
{
  const t = torsoBody(SKIN);
  t.box(0, 1, -1, 8, 6, 6, GOLD).box(2, 3, 4, 4, 4, 1, SKIN);                       // gold corselet, open V
  collar(t, [TEAM, GOLD, TEAM, GOLD]);
  for (let i = 1; i <= 11; i++) {
    const y = -i, w = i < 3 ? 8 : 10, d = i < 3 ? 6 : 7;
    const x0 = 4 - w / 2, z0 = 2 - Math.floor(d / 2);
    for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) {
      const outer = x === x0 || x === x0 + w - 1 || z === z0 || z === z0 + d - 1;
      if (!outer) continue;
      t.set(x, y, z, i === 11 ? GOLD : TEAM);
      if (i < 11 && (x + z) % 3 === 0) tset(t, x, y, z, TEAM_SHADE);
    }
  }
  t.box(2, -8, 5, 4, 8, 1, GOLD).box(3, -9, 5, 2, 1, 1, GOLD);                      // gold apron
  t.box(0, 0, -1, 8, 1, 6, GOLD_DK);
  rig('pharaoh', { voxel: 0.08, anim: 'human', style: 'pharaoh', pose: 'staff' }, [
    ...legsE({ sandal: true }), part('torso', t, [4, 0, 2], [0, 12, 0]), head('pharaoh'),
    ...arms({ bracer: TEAM, band: GOLD }),
    part('weapon', crookM(), [0, 0, 0], GRIP, 'armR'),
  ]);
}

// ---- horses, camels, elephants ---------------------------------------------------
const WHITE_COAT = pick3(12, 0xeceae4, 0xdcd8d0, 0xc8c4bc, 0.55, 0.85);
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
function horseNeck(C, MANE, { bridle = TEAM, collar: col = null } = {}) {
  const m = new VoxelModel();
  // an arched neck carried high (the crest up to y 13), the head out in
  // front of the chest at ~40 degrees, clear of the forelegs
  const pts = [[0, 1.5, 3.2], [4, 2.4, 2.8], [8.5, 3.6, 2.3], [12.5, 5.2, 1.9]];
  for (let i = 0; i < pts.length - 1; i++) capsuleYZ(m, 0, 3, pts[i][0], pts[i][1], pts[i][2], pts[i + 1][0], pts[i + 1][1], pts[i + 1][2], C);
  capsuleYZ(m, 0, 3, 13, 6, 2.2, 10, 11.5, 1.5, C);
  capsuleYZ(m, 0, 3, 12, 7, 1.6, 10.5, 8.8, 1.6, C);
  capsuleYZ(m, 0, 3, 10, 11.5, 1.5, 9.6, 12.4, 1.2, 0x6f675f);
  m.set(0, 9, 12, DARK).set(2, 9, 12, DARK).set(-1, 12, 7, DARK).set(3, 12, 7, DARK);
  m.set(0, 15, 5, C).set(0, 16, 5, C).set(2, 15, 5, C).set(2, 16, 5, C);
  for (let y = 1; y <= 14; y++) {
    let z = -8;
    while (z < 12 && !m.has(1, y, z)) z++;
    if (z >= 12) continue;
    m.set(1, y, z - 1, MANE).set(1, y, z, MANE);
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
function stripedBlanket({ z0 = 7, z1 = 14, low = 4, top = 9, colors = [TEAM, TEAM_TRIM, OCHRE, TEAM_TRIM] } = {}) {
  const m = new VoxelModel();
  for (let z = z0; z <= z1; z++) {
    const lo = z === z0 || z === z1 ? low + 2 : low;
    for (let y = lo; y <= top; y++) {
      const c = colors[(top - y) % colors.length];
      m.set(-1, y, z, c).set(7, y, z, c);
    }
    m.box(0, top + 1, z, 7, 1, 1, colors[0]);
    m.set(-1, lo - 1, z, RED).set(7, lo - 1, z, RED);
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
function riderTorso(build) { const m = build(); m.carve(-2, -6, -3, 12, 5, 10); return m; }

// Chariot Archer: a white horse in a striped blanket with a team collar
// pulling a two-wheeled silver chariot with a team front; an archer in silver
// scale armour and a rounded helmet draws his bow standing in the car.
{
  const C = WHITE_COAT, MANE = pick3(13, 0xbab4aa, 0xa8a298, 0xcac4ba);
  const car = new VoxelModel();
  // the car: floor, a curved breastwork (team panel, silver rim), an open back
  for (let x = -4; x <= 4; x++) for (let z = -3; z <= 3; z++) car.set(x, 0, z, WOOD_DK);
  for (let x = -4; x <= 4; x++) for (let y = 1; y <= 7; y++) {
    const zf = 3 - Math.round((x * x) / 10);
    const c = y === 7 || Math.abs(x) === 4 ? SILVER(x, y, zf) : (y >= 3 && y <= 5 && Math.abs(x) <= 2 ? TEAM : SILVER(x, y, zf));
    car.set(x, y, zf, c);
    if (Math.abs(x) >= 3) for (let z = -2; z < zf; z++) if (y <= 5) car.set(x, y, z, z === -2 ? SILVER_DK : SILVER(x, y, z));
  }
  car.set(0, 4, 4, GOLD(0, 4, 4)).set(-1, 4, 4, GOLD(0, 4, 5)).set(1, 4, 4, GOLD(0, 4, 6));
  // the pole forward to the yoke, the axle
  for (let z = 4; z <= 21; z++) car.set(0, -1 + Math.round(Math.max(0, z - 10) * 0.4), z, WOOD_DK);
  car.box(-4, 4, 21, 9, 1, 1, WOOD_DK);   // the yoke
  car.box(-6, -3, -1, 13, 1, 1, SILVER_DK);
  const wheel = new VoxelModel();
  for (let y = -5; y <= 5; y++) for (let z = -5; z <= 5; z++) {
    const d = Math.hypot(y, z);
    if (d > 5.4) continue;
    if (d > 4.4) wheel.set(0, y, z, (y + z) % 3 ? WOOD : WOOD_DK);
    else if (d < 1.2) wheel.set(0, y, z, SILVER(0, y, z));
    else if (y === 0 || z === 0 || Math.abs(y) === Math.abs(z)) wheel.set(0, y, z, WOOD_DK);
  }
  const t = riderTorso(() => { const m = torsoBody(SKIN); scaleArmor(m); collar(m, [GOLD, TEAM, GOLD]); kilt(m, { len: 4 }); m.box(0, 0, -1, 8, 1, 6, LEATHER_DK); return m; });
  const standLegs = new VoxelModel();
  for (const x of [-2, 1]) standLegs.box(x, 0, -1, 2, 10, 2, SKIN).box(x, 9, -1, 2, 2, 2, TEAM).box(x, 0, -1, 2, 1, 3, SANDAL);
  rig('chariot_archer', { voxel: 0.07, anim: 'centaur', style: 'chariot', pose: 'chariot', graze: false }, [
    part('body', horseBody(C), [3, 0, 10.5], [0, 10, 12], null, { coat: true }),
    part('barding', stripedBlanket({ z0: 7, z1: 14, low: 5, top: 9 }), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('neck', horseNeck(C, MANE, { collar: TEAM }), [1.5, 0, 2], [0, 5.5, 8], 'body', { coat: true }),
    part('tail', horseTail(MANE), [1, 0, 0], [0, 7, -10], 'body', { coat: true }),
    ...horseLegs(C, {}),
    part('chariot', car, [0, 0, 0], [0, -5, -24], 'body'),
    part('wheelL', wheel, [0, 0, 0], [6, -3, -1], 'chariot', { anim: 'wheel' }),
    part('wheelR', wheel, [0, 0, 0], [-6, -3, -1], 'chariot', { anim: 'wheel' }),
    part('riderLegs', standLegs, [0, 0, 0], [0, 1, 0], 'chariot'),
    part('torso', t, [4, 0, 2], [0, 12, 0], 'chariot'),
    head('helmet'),
    ...arms({ bracer: TEAM, band: SILVER }),
    part('weapon', bowM(), [0, 0, 0], HAND, 'armL'),
    part('arrow', arrowM(), [0, 0, 0], HAND, 'armR', { conditional: true, portrait: false }),
  ]);
}

// Camel Rider (rig voxel 0.09, the rider at 0.065 / 0.09):
// a dromedary in its own sandy-brown hide (a lighter belly and legs, a dark
// muzzle), one high hump under a domed white saddle cloth with a broad team
// border and a zigzag hem, a long S-curved neck that dips from the chest and
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
  // the saddle cloth: a white dome over the hump and back, a broad team border
  // falling down the flanks, a zigzag hem (ochre / dark leather), team ends
  const cloth = new VoxelModel();
  const Z0 = 5, Z1 = 16;
  for (let z = Z0; z <= Z1; z++) for (let x = 0; x <= 8; x++) {
    let top = -1;
    for (let y = 16; y >= 0; y--) if (body.has(x, y, z)) { top = y; break; }
    if (top < 0) continue;
    const end = z === Z0 || z === Z1;
    cloth.set(x, top + 1, z, end ? TEAM : LINEN(x, top, z));
    if (end) cloth.set(x, top + 2, z, TEAM_TRIM);
  }
  for (let z = Z0; z <= Z1; z++) for (let y = 3; y <= 11; y++) for (const s of [-1, 1]) {
    let xb = s < 0 ? 0 : 8;
    while (xb >= 0 && xb <= 8 && !body.has(xb, y, z)) xb -= s;
    if (xb < 0 || xb > 8) continue;
    const x = xb + s;
    if (cloth.has(x, y, z)) continue;
    const c = y >= 8 ? LINEN(x, y, z) : y >= 6 ? (y === 6 ? TEAM_SHADE : TEAM) : y === 5 ? ((z & 1) ? OCHRE : LEATHER_DK) : ((z & 1) ? null : OCHRE);
    if (c === TEAM_SHADE) tset(cloth, x, y, z, TEAM_SHADE); else if (c) cloth.set(x, y, z, c);
  }
  // the rider's legs astride the hump: thighs over the cloth, bare shins
  // hanging forward of the team border, sandal-less feet
  for (const s of [-1, 1]) {
    const hx = 4 + s * 3.2;
    tube(cloth, [hx, 13.2, 10], [4 + s * 5.4, 10.8, 12.2], 1.1, 1.0, SKIN);
    tube(cloth, [4 + s * 5.4, 10.8, 12.2], [4 + s * 5.8, 4.4, 12.6], 1.0, 0.85, SKIN);
    tube(cloth, [hx, 13.4, 10], [4 + s * 4.6, 12.4, 11.8], 1.25, 1.1, TEAM);    // the kilt over the thigh
    const fx = Math.round(4 + s * 5.9);
    cloth.box(s < 0 ? fx - 1 : fx, 3, 12, 2, 1, 3, SKIN_SH);
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
    if (y >= 0) neck.set(x, y, z, TEAM);
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
  const t = riderTorso(() => {
    const m = torsoBody(SKIN);
    m.box(0, 1, -1, 8, 7, 6, TEAM); tbox(m, 0, 1, -1, 1, 7, 6, TEAM_SHADE); tbox(m, 7, 1, -1, 1, 7, 6, TEAM_SHADE);
    m.box(1, 2, 4, 6, 4, 1, LEATHER).box(1, 2, -2, 6, 4, 1, LEATHER);    // the leather corslet
    collar(m, [GOLD, TEAM_TRIM, GOLD]); kilt(m, { len: 4 }); m.box(0, 0, -1, 8, 1, 6, GOLD_DK);
    return m;
  });
  rig('camel_rider', { voxel: 0.09, anim: 'horse', style: 'camel', gait: 0.75, stride: 0.9, graze: false }, [
    part('body', body, [4, 0, 10], [0, 14, 0.5], null, coat),
    part('barding', cloth, [4, 0, 10], [0, 0, 0], 'body'),
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
    part('torso', t, [4, 0, 2], [0, 14.6, 0], 'body', { scale: R }),
    headPart('camel', sc([0, 10, 0.2], R), 'torso', R),
    part('armL', armM({ side: 'L', upper: TEAM, bracer: GOLD }), [1, 7, 1], sc([5.5, 8, 0], R), 'torso', { scale: R }),
    part('armR', armM({ side: 'R', upper: TEAM, bracer: GOLD }), [1, 7, 1], sc([-5.5, 8, 0], R), 'torso', { scale: R }),
    part('weapon', camelSwordM(), [0, 0, 0], sc(HAND, R), 'armR', { scale: R }),
  ]);
}

// Mercenary Cavalry: a dark armoured horse, a Nubian rider with a spear.
{
  const C = DARK_COAT, MANE = 0x1e1a1a;
  const bard = stripedBlanket({ z0: 6, z1: 15, low: 3, top: 9, colors: [TEAM, TEAM, SILVER_DK, TEAM] });
  for (let z = 6; z <= 15; z += 3) { bard.set(-2, 6, z, SILVER(0, z, 1)); bard.set(8, 6, z, SILVER(0, z, 2)); }
  const t = riderTorso(() => { const m = torsoBody(SKIN_DK, SKIN_DK_SH); m.box(0, 1, -1, 8, 2, 6, LEATHER_DK); m.box(0, 7, -1, 8, 1, 6, GOLD); kilt(m, { len: 4 }); return m; });
  rig('mercenary_cavalry', { voxel: 0.07, anim: 'horse', style: 'rider' }, [
    part('body', horseBody(C), [3, 0, 10.5], [0, 10, 0], null, { coat: false }),
    part('barding', bard, [3, 0, 10.5], [0, 0, 0], 'body'),
    part('riderLegs', riderLegsM({ skin: SKIN_DK, sandal: false }), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('neck', horseNeck(C, MANE, { collar: SILVER_DK }), [1.5, 0, 2], [0, 5.5, 8], 'body'),
    part('tail', horseTail(MANE), [1, 0, 0], [0, 7, -10], 'body'),
    ...horseLegs(C, { sock: TEAM }).map((p) => ({ ...p, coat: false })),
    part('torso', t, [4, 0, 2], [0, 10, 0.5], 'body'),
    head('mercCav'),
    ...arms({ skin: SKIN_DK, shade: SKIN_DK_SH, bracer: TEAM }),
    part('weapon', spearM(30, SILVER), [0, 0, 0], HAND, 'armR'),
  ]);
}

// War Elephant: a grey elephant (rig voxel 0.1) with a cow-hide cloth, a team
// saddle pad, a wooden howdah and a gold-and-team forehead plate; a mahout
// with a spear on its neck (rider parts at 0.7 x, the human voxel size).
{
  const G = pick3(16, 0x9a958f, 0x8c8781, 0xa6a19a, 0.5, 0.85), GD = 0x6e6a66;
  const body = new VoxelModel();
  body.ellipsoid(5.5, 6, 9.5, 5.6, 5.8, 9.2, G);
  body.ellipsoid(5.5, 7, 15, 5.4, 6, 4.4, G);    // the high shoulders
  body.ellipsoid(5.5, 6, 3.5, 5.2, 5.4, 4, G);
  const cloth = new VoxelModel();
  const HIDE = (x, y, z) => (hash3(x >> 1, y >> 1, z >> 1, 91) < 0.35 ? 0x8a4a22 : 0xf0e8d8);
  for (let z = 4; z <= 15; z++) for (let x = -1; x <= 12; x++) {
    let top = -1;
    for (let y = 16; y >= 0; y--) if (body.has(Math.min(11, Math.max(0, x)), y, z)) { top = y; break; }
    if (top < 0) continue;
    if (x >= 0 && x <= 11) cloth.set(x, top + 1, z, HIDE(x, top, z));
  }
  for (let z = 4; z <= 15; z++) for (let y = 4; y <= 11; y++) { cloth.set(-1, y, z, HIDE(0, y, z)); cloth.set(12, y, z, HIDE(1, y, z)); }
  for (let z = 4; z <= 15; z++) { cloth.set(-1, 3, z, TEAM_TRIM); cloth.set(12, 3, z, TEAM_TRIM); }
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
  how.line(-1, 3, 5, -1, -6, 5, LEATHER_DK).line(12, 3, 5, 12, -6, 5, LEATHER_DK);   // girth ropes
  const headM = new VoxelModel();
  headM.ellipsoid(5.5, 7, 3, 4.2, 4.6, 3.6, G);
  // the trunk: down and slightly forward, curled at the tip
  tube(headM, [5.5, 5, 5], [5.5, -2, 8], 2.2, 1.6, G);
  tube(headM, [5.5, -2, 8], [5.5, -8, 8.5], 1.6, 1.2, G);
  tube(headM, [5.5, -8, 8.5], [5.5, -9.5, 10], 1.2, 1.0, GD);
  for (let y = -7; y <= 4; y += 2) band(headM, y, GD);
  // tusks
  tube(headM, [3.2, 3, 5], [2.6, -1, 10], 0.9, 0.6, 0xf0e8d4);
  tube(headM, [7.8, 3, 5], [8.4, -1, 10], 0.9, 0.6, 0xf0e8d4);
  headM.set(3, 7, 6, DARK).set(8, 7, 6, DARK);
  // the forehead plate: silver-gold with a team lozenge and gold studs
  for (let y = 5; y <= 11; y++) for (let x = 2; x <= 9; x++) {
    let z = 10; while (z > -2 && !headM.has(x, y, z)) z--;
    if (z <= -2) continue;
    const d = Math.abs(x - 5.5) + Math.abs(y - 8.5) * 0.8;
    headM.set(x, y, z + 1, d < 2.2 ? TEAM : d < 2.9 ? GOLD(x, y, z) : (x === 2 || x === 9 || y === 5 || y === 11) ? GOLD(x, y, z) : SILVER(x, y, z));
  }
  // ears: big flat flaps
  for (const s of [-1, 1]) {
    const x = s < 0 ? 0 : 11;
    for (let y = 2; y <= 11; y++) for (let z = -3; z <= 3; z++) {
      const dy = (y - 7) / 5, dz = z / 3.5;
      if (dy * dy + dz * dz > 1) continue;
      headM.set(x + s, y, z, (y + z) % 4 === 0 ? GD : G(x, y, z));
      if (dy * dy + dz * dz > 0.55) headM.set(x + 2 * s, y, z, G(x, y, z + 1));
    }
  }
  const legUp = new VoxelModel().box(0, 0, 0, 4, 6, 4, G);
  const legLow = new VoxelModel().box(0, 1, 0, 4, 6, 4, G).box(0, 0, 0, 4, 1, 4, GD).set(0, 0, 4, 0xe8e0cc).set(1, 0, 4, 0xe8e0cc).set(2, 0, 4, 0xe8e0cc).set(3, 0, 4, 0xe8e0cc);
  band(legLow, 5, GOLD_DK); band(legLow, 4, GOLD);
  const R = 0.7;   // mahout scale
  const t = riderTorso(() => { const m = torsoBody(SKIN); m.box(0, 7, -1, 8, 1, 6, GOLD); kilt(m, { len: 4 }); return m; });
  rig('war_elephant', { voxel: 0.1, anim: 'horse', style: 'elephant', gait: 0.55, stride: 0.6 }, [
    part('body', body, [5.5, 0, 9.5], [0, 9, 0], null),
    part('barding', cloth, [5.5, 0, 9.5], [0, 0, 0], 'body'),
    part('howdah', how, [6, 0, 5], [0, 12, -2], 'body'),
    part('riderLegs', riderLegsM({ y: 13, x0: 2, x1: 9, z: 13, len: 5, sandal: false }), [5.5, 0, 9.5], [0, 0, 0], 'body'),
    part('neck', headM, [5.5, 6, 0], [0, 6, 16], 'body'),
    part('tail', new VoxelModel().box(0, -8, 0, 1, 8, 1, G).box(-1, -10, 0, 3, 2, 1, HAIR), [0.5, 0, 0.5], [0, 9, -9], 'body'),
    part('legFL', legUp, [2, 6, 2], [3.5, 3, 5.5], 'body'),
    part('cannonFL', legLow, [2, 7, 2], [0, -5, 0], 'legFL'),
    part('legFR', legUp, [2, 6, 2], [-3.5, 3, 5.5], 'body'),
    part('cannonFR', legLow, [2, 7, 2], [0, -5, 0], 'legFR'),
    part('legBL', legUp, [2, 6, 2], [3.5, 3, -5.5], 'body'),
    part('cannonBL', legLow, [2, 7, 2], [0, -5, 0], 'legBL'),
    part('legBR', legUp, [2, 6, 2], [-3.5, 3, -5.5], 'body'),
    part('cannonBR', legLow, [2, 7, 2], [0, -5, 0], 'legBR'),
    part('torso', t, [4, 0, 2], [0, 13, 4], 'body', { scale: R }),
    headPart('mahout', sc([0, 10, 0.2], R), 'torso', R),
    part('armL', armM({ side: 'L', bracer: TEAM }), [1, 7, 1], sc([5.5, 8, 0], R), 'torso', { scale: R }),
    part('armR', armM({ side: 'R', bracer: TEAM }), [1, 7, 1], sc([-5.5, 8, 0], R), 'torso', { scale: R }),
    part('weapon', spearM(28), [0, 0, 0], sc(HAND, R), 'armR', { scale: R }),
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
  const thigh = new VoxelModel().box(0, 0, 0, 3, 6, 3, FUR);
  const shin = new VoxelModel();
  shin.box(0, 3, -1, 3, 4, 2, FUR).box(0, 1, 0, 3, 3, 2, FUR).box(0, 0, 0, 3, 1, 4, FUR_LT).set(0, 0, 4, DARK).set(2, 0, 4, DARK);
  shin.box(0, 4, -1, 3, 1, 2, SILVER);   // anklets
  const body = new VoxelModel();
  body.ellipsoid(4.5, 3, 2.5, 3.6, 3, 2.6, FUR);
  body.ellipsoid(4.5, 8, 2.5, 4.8, 3.6, 3.2, FUR);
  body.box(2, 11, 1, 5, 2, 3, FUR);
  // linen straps crossed over chest and back, a team kilt
  body.line(0, 11, 6, 9, 3, 6, LINEN).line(9, 11, 6, 0, 3, 6, LINEN).line(0, 10, 6, 8, 3, 6, LINEN);
  body.line(0, 11, -1, 9, 3, -1, LINEN).line(9, 11, -1, 0, 3, -1, LINEN);
  for (let y = -4; y <= 0; y++) body.box(y < -1 ? 0 : 1, y, y < -1 ? -1 : 0, y < -1 ? 9 : 7, 1, y < -1 ? 7 : 5, y === -4 ? LINEN : TEAM);
  body.box(0, 1, -1, 9, 1, 7, GOLD);
  const headM = new VoxelModel();
  headM.box(0, 0, 0, 5, 5, 5, FUR);
  // long muzzle
  headM.box(1, 0, 5, 3, 3, 3, FUR).box(1, 0, 8, 3, 2, 2, FUR).set(2, 1, 10, DARK).box(1, -1, 5, 3, 1, 4, FUR_LT);
  headM.set(1, 3, 5, 0xffd040, { glow: 0.6 }).set(3, 3, 5, 0xffd040, { glow: 0.6 });
  // tall ears
  headM.box(0, 5, 2, 1, 4, 2, FUR).box(4, 5, 2, 1, 4, 2, FUR).set(0, 9, 2, FUR).set(4, 9, 2, FUR).set(0, 6, 3, 0x8a5a40).set(4, 6, 3, 0x8a5a40);
  // team headcloth over the skull and down the nape
  headM.box(-1, 2, -1, 7, 3, 4, TEAM).box(-1, -3, -1, 7, 5, 2, TEAM).box(-1, -3, 1, 1, 5, 2, TEAM).box(5, -3, 1, 1, 5, 2, TEAM);
  tbox(headM, -1, -3, -1, 7, 1, 2, TEAM_SHADE);
  const up = new VoxelModel().ellipsoid(1.5, 4, 1.5, 1.8, 3.5, 1.8, FUR).box(0, 5, 0, 3, 1, 3, SILVER);
  const fore = new VoxelModel().box(0, 0, 0, 3, 5, 3, FUR).box(0, 3, 0, 3, 2, 3, TEAM).box(0, -1, 0, 3, 1, 3, FUR_LT);
  const blade = () => { const m = new VoxelModel(); m.box(0, -2, 0, 1, 3, 1, LEATHER_DK).box(0, 1, 0, 1, 6, 1, SILVER); for (const [y, z] of [[7, 1], [8, 2], [8, 3], [7, 4], [6, 5]]) m.set(0, y, z, SILVER(0, y, z)); return m; };
  rig('anubite', { voxel: 0.085, anim: 'beast', style: 'beast' }, [
    part('legL', thigh, [1.5, 6, 1.5], [2.2, 12, 0]),
    part('shinL', shin, [1.5, 7, 1.5], [0, -5, 0.5], 'legL'),
    part('legR', thigh, [1.5, 6, 1.5], [-2.2, 12, 0]),
    part('shinR', shin, [1.5, 7, 1.5], [0, -5, 0.5], 'legR'),
    part('torso', body, [4.5, 0, 2.5], [0, 12, 0]),
    part('head', headM, [2.5, 0, 2.5], [0, 12, 2], 'torso'),
    part('armL', up, [1.5, 6, 1.5], [6, 10.5, 0], 'torso'),
    part('foreL', fore, [1.5, 5, 1.5], [0, -6, 0], 'armL'),
    part('armR', up, [1.5, 6, 1.5], [-6, 10.5, 0], 'torso'),
    part('foreR', fore, [1.5, 5, 1.5], [0, -6, 0], 'armR'),
    part('weapon', blade(), [0, 0, 0], [0, -1.5, 0.5], 'foreR'),
    part('weapon2', blade(), [0, 0, 0], [0, -1.5, 0.5], 'foreL', { anim: 'weapon' }),
  ]);
}

// Avenger (beast rig, 0.1): a falcon-headed warrior: a dark feathered mantle
// with white tips, a team kilt with a gold hem, a team and gold collar,
// scaled legs with talons, two long gold blades.
{
  const FEATH = pick3(25, 0x3a3f48, 0x2e3239, 0x4a5058);
  const thigh = new VoxelModel().box(0, 0, 0, 3, 6, 3, FEATH);
  const shin = new VoxelModel();
  shin.box(0, 1, 0, 3, 6, 3, (x, y, z) => ((x + y) % 2 ? 0x5a6068 : 0x464c54));
  shin.box(0, 0, -1, 3, 1, 5, 0xd8b060).set(0, 0, 4, DARK).set(2, 0, 4, DARK).set(1, 0, -2, DARK);
  const body = torsoBody(SKIN);
  body.box(-1, 2, -1, 10, 7, 6, SKIN).box(0, 9, 0, 8, 1, 4, SKIN);
  for (let y = -5; y <= 0; y++) body.box(y < -1 ? -1 : 0, y, y < -1 ? -2 : -1, y < -1 ? 10 : 8, 1, y < -1 ? 8 : 6, y === -5 ? GOLD : TEAM);
  for (let x = -1; x <= 8; x += 2) tset(body, x, -3, 5, TEAM_SHADE);
  body.box(-1, 1, -2, 10, 1, 8, GOLD);
  // collar rows
  body.box(-1, 9, -1, 10, 1, 6, GOLD).box(-1, 8, -2, 10, 1, 8, TEAM).box(-1, 7, -2, 10, 1, 8, GOLD).box(0, 6, 5, 8, 1, 1, TEAM);
  // the feathered mantle down the back
  for (let y = 0; y <= 9; y++) for (let x = -1; x <= 8; x++) body.set(x, y, -3, y < 2 ? 0xe8e8e4 : FEATH(x, y, 0));
  for (let x = -1; x <= 8; x += 2) body.set(x, -1, -3, 0xe8e8e4);
  body.box(3, 10, 1, 3, 2, 2, FEATH);
  const headM = new VoxelModel();
  headM.ellipsoid(2.5, 3, 2.5, 3, 3.2, 3, FEATH);
  headM.box(1, 1, 5, 3, 2, 2, GOLD).box(2, 0, 7, 1, 2, 1, GOLD_DK).set(2, -1, 7, GOLD_DK);   // hooked beak
  headM.box(0, 2, 4, 1, 2, 1, 0xf0f0ec).box(4, 2, 4, 1, 2, 1, 0xf0f0ec).set(0, 3, 5, 0xffb020, { glow: 0.5 }).set(4, 3, 5, 0xffb020, { glow: 0.5 });
  headM.box(0, 1, -1, 5, 5, 1, FEATH).box(0, -3, -2, 5, 5, 2, FEATH).box(0, -4, -2, 5, 1, 2, 0xe8e8e4);
  const up = new VoxelModel().ellipsoid(1.5, 4, 1.5, 1.9, 3.5, 1.9, SKIN).box(0, 4, 0, 3, 1, 3, GOLD);
  const fore = new VoxelModel().box(0, 0, 0, 3, 5, 3, SKIN).box(0, 1, 0, 3, 3, 3, TEAM).box(0, 1, 0, 3, 1, 3, GOLD);
  rig('avenger', { voxel: 0.1, anim: 'beast', style: 'beast' }, [
    part('legL', thigh, [1.5, 6, 1.5], [2.2, 12, 0]),
    part('shinL', shin, [1.5, 7, 1.5], [0, -5, 0.5], 'legL'),
    part('legR', thigh, [1.5, 6, 1.5], [-2.2, 12, 0]),
    part('shinR', shin, [1.5, 7, 1.5], [0, -5, 0.5], 'legR'),
    part('torso', body, [4, 0, 2], [0, 12, 0]),
    part('head', headM, [2.5, 0, 2.5], [0, 10.5, 0.8], 'torso'),
    part('armL', up, [1.5, 6, 1.5], [6, 8.5, 0], 'torso'),
    part('foreL', fore, [1.5, 5, 1.5], [0, -6, 0], 'armL'),
    part('armR', up, [1.5, 6, 1.5], [-6, 8.5, 0], 'torso'),
    part('foreR', fore, [1.5, 5, 1.5], [0, -6, 0], 'armR'),
    part('weapon', longBladeM(GOLD, 13), [0, 0, 0], [0, -1.5, 0.5], 'foreR'),
    part('weapon2', longBladeM(GOLD, 13), [0, 0, 0], [0, -1.5, 0.5], 'foreL', { anim: 'weapon' }),
  ]);
}

// Mummy (human rig, 0.08): linen wrappings, a team and gold striped nemes,
// a tattered skirt, a curved blade.
{
  const WRAP = (x, y, z) => { const h = hash3(x, y, z, 63); return (y & 1) ? (h < 0.5 ? 0xd2c6a6 : 0xc6b996) : (h < 0.5 ? 0xb8aa86 : 0xaa9c78); };
  const t = torsoBody(WRAP, 0x8a7c5c);
  t.box(0, 1, -1, 8, 7, 6, WRAP).box(1, 8, 0, 6, 1, 4, WRAP).box(3, 8, 1, 2, 2, 2, WRAP);
  for (let i = 1; i <= 7; i++) for (let x = (i > 2 ? 0 : 1); x <= (i > 2 ? 7 : 6); x++) for (const z of [i > 2 ? -1 : 0, i > 2 ? 4 : 3]) {
    if (i > 4 && hash3(x, i, z, 64) < 0.35) continue;   // ragged hem
    t.set(x, -i, z, i % 3 === 0 ? 0x7e7258 : 0x9a8e6e);
  }
  for (let i = 1; i <= 6; i++) { t.set(0, -i, 1, 0x8a7e60).set(7, -i, 2, 0x8a7e60); }
  t.box(0, 0, -1, 8, 1, 6, TEAM);
  rig('mummy', { voxel: 0.08, anim: 'human', style: 'mummy', pose: 'slash' }, [
    ...legsE({ skin: WRAP, sandal: false, wrap: WRAP, foot: 0x6a6050 }), part('torso', t, [4, 0, 2], [0, 12, 0]),
    head('mummy', [0, 10, 0.6]),
    ...arms({ skin: WRAP, shade: 0x8a7c5c }),
    part('weapon', khopeshM(0x8a7a5a), [0, 0, 0], HAND, 'armR'),
  ]);
}

// Minion (human rig, 0.072): grey undead in a team hood and loincloth.
{
  const GR = pick3(65, 0x8c8c86, 0x7e7e78, 0x9a9a92);
  const t = torsoBody(GR, 0x5e5e58);
  t.set(2, 6, 3, 0x5e5e58).set(5, 6, 3, 0x5e5e58).set(2, 4, 3, 0x5e5e58).set(5, 4, 3, 0x5e5e58);   // ribs
  t.box(1, -1, 0, 6, 1, 4, TEAM).box(2, -4, 4, 4, 3, 1, TEAM).box(2, -3, -1, 4, 2, 1, TEAM).box(0, 0, -1, 8, 1, 6, 0x4a4038);
  t.box(0, 8, -1, 8, 1, 6, TEAM).box(1, 4, -2, 6, 5, 1, TEAM);
  rig('minion', { voxel: 0.072, anim: 'human', style: 'minion', pose: 'slash' }, [
    ...legsE({ skin: GR, sandal: false, foot: 0x5e5e58 }), part('torso', t, [4, 0, 2], [0, 12, 0]),
    head('minion', [0, 10, 0.6]),
    ...arms({ skin: GR, shade: 0x5e5e58 }),
    part('weapon', khopeshM(0x7a7a72), [0, 0, 0], HAND, 'armR'),
  ]);
}

// Son of Osiris (beast rig, 0.1): the Pharaoh as a falcon-headed demigod in
// gold with a glowing ankh staff.
{
  const thigh = new VoxelModel().box(0, 0, 0, 3, 6, 3, SKIN);
  const shin = new VoxelModel().box(0, 1, 0, 3, 6, 3, SKIN).box(0, 3, 0, 3, 2, 3, GOLD).box(0, 0, 0, 3, 1, 4, GOLD);
  const body = torsoBody(SKIN);
  body.box(-1, 2, -1, 10, 7, 6, GOLD).box(1, 4, 5, 6, 4, 1, SKIN);
  collar(body, [TEAM, GOLD, TEAM, GOLD, TEAM]);
  for (let y = -8; y <= 0; y++) body.box(y < -1 ? -1 : 0, y, y < -1 ? -2 : -1, y < -1 ? 10 : 8, 1, y < -1 ? 8 : 6, y === -8 ? GOLD : (y % 2 ? TEAM : GOLD));
  for (let y = 0; y <= 9; y++) for (let x = 0; x <= 7; x++) body.set(x, y, -3, GOLD(x, y, 0), { glow: 0.15 });   // gold wings folded on the back
  const headM = new VoxelModel();
  headM.ellipsoid(2.5, 3, 2.5, 3, 3.2, 3, GOLD, { glow: 0.2 });
  headM.box(1, 1, 5, 3, 2, 2, 0x2a2a30).box(2, 0, 7, 1, 2, 1, 0x2a2a30);
  headM.set(0, 3, 5, 0x60e0ff, { glow: 0.9 }).set(4, 3, 5, 0x60e0ff, { glow: 0.9 });
  headM.ellipsoid(2.5, 8, 2.5, 2, 2.4, 2, 0xffe060, { glow: 0.9 });   // the sun disc
  const up = new VoxelModel().ellipsoid(1.5, 4, 1.5, 1.9, 3.5, 1.9, SKIN).box(0, 4, 0, 3, 1, 3, GOLD);
  const fore = new VoxelModel().box(0, 0, 0, 3, 5, 3, SKIN).box(0, 1, 0, 3, 3, 3, GOLD);
  rig('son_of_osiris', { voxel: 0.1, anim: 'beast', style: 'beast' }, [
    part('legL', thigh, [1.5, 6, 1.5], [2.2, 12, 0]),
    part('shinL', shin, [1.5, 7, 1.5], [0, -5, 0.5], 'legL'),
    part('legR', thigh, [1.5, 6, 1.5], [-2.2, 12, 0]),
    part('shinR', shin, [1.5, 7, 1.5], [0, -5, 0.5], 'legR'),
    part('torso', body, [4, 0, 2], [0, 12, 0]),
    part('head', headM, [2.5, 0, 2.5], [0, 10.5, 0.8], 'torso'),
    part('armL', up, [1.5, 6, 1.5], [6, 8.5, 0], 'torso'),
    part('foreL', fore, [1.5, 5, 1.5], [0, -6, 0], 'armL'),
    part('armR', up, [1.5, 6, 1.5], [-6, 8.5, 0], 'torso'),
    part('foreR', fore, [1.5, 5, 1.5], [0, -6, 0], 'armR'),
    part('weapon', ankhStaffM(), [0, 0, 0], [0, -1.5, 0.5], 'foreR'),
  ]);
}

// Sphinx (four-legged rig, 0.11): a lion's body, a man's face under a team
// and white striped nemes, a tufted tail.
{
  const LION = pick3(51, 0xd8aa5c, 0xcc9c4e, 0xe4b86c, 0.5, 0.85);
  const LION_DK = 0xa87a3a;
  const body = horseBody(LION);
  body.ellipsoid(3, 5.5, 17, 3.6, 5, 4, LION);   // a deep lion's chest
  for (let z = 4; z <= 16; z += 4) band(body, 2, LION_DK, 24);
  // gold harness band across the chest with a team jewel
  for (let y = 2; y <= 8; y++) for (let x = -1; x <= 7; x++) { let z = 23; while (z > 14 && !body.has(x, y, z)) z--; if (z > 14 && y === 6) body.set(x, y, z, GOLD(x, y, z)); }
  body.set(3, 6, 21, TEAM).set(3, 5, 21, TEAM);
  const neck = new VoxelModel();
  capsuleYZ(neck, 0, 5, 0, 1, 3, 4, 3, 2.6, LION);
  for (let y = -1; y <= 4; y++) for (let x = -1; x <= 5; x++) neck.set(x, y, 4, (x + y) % 2 ? LION_DK : LION(x, y, 4));   // the mane ruff
  const h = new VoxelModel();
  faceN(h, (x, y, z) => (hash3(x, y, z, 52) < 0.5 ? 0xb88440 : 0xac7a3a), LION_DK, { nose: 0xc89050 });
  nemesN(h, TEAM, LINEN, { uraeus: true, chest: 7 });
  h.box(3, -4, 5, 1, 4, 1, GOLD).set(3, -4, 6, GOLD);   // the false beard
  const tail = new VoxelModel().line(0, 0, 0, 0, -4, -3, LION).line(0, -4, -3, 0, -8, -4, LION).box(-1, -10, -5, 3, 3, 2, LION_DK);
  const up = (hind) => { const m = horseUpper(LION, hind); m.box(-0, 0, 0, 3, 5, hind ? 3 : 3, LION); return m; };
  const low = () => new VoxelModel().box(0, 2, 0, 3, 5, 3, LION).box(0, 0, -1, 3, 2, 5, LION).set(0, 0, 4, LION_DK).set(2, 0, 4, LION_DK);
  rig('sphinx', { voxel: 0.11, anim: 'horse', style: 'sphinx', gait: 0.8, stride: 0.8 }, [
    part('body', body, [3, 0, 10.5], [0, 10, 0]),
    part('neck', neck, [2.5, 0, 2], [0, 6.5, 8.5], 'body'),
    part('head', h, HEAD_PIVOT, [0, 4, 3], 'neck', { scale: 0.72, rest: [-0.15, 0, 0] }),
    part('tail', tail, [0.5, 0, 0], [0, 7, -10], 'body'),
    part('legFL', up(false), [1.5, 5, 1.5], [2.2, 1, 7.5], 'body'),
    part('cannonFL', low(), [1.5, 7, 1.5], [0, -4, 0], 'legFL'),
    part('legFR', up(false), [1.5, 5, 1.5], [-2.2, 1, 7.5], 'body'),
    part('cannonFR', low(), [1.5, 7, 1.5], [0, -4, 0], 'legFR'),
    part('legBL', up(true), [1.5, 5, 1.5], [2.2, 1, -6.5], 'body'),
    part('cannonBL', low(), [1.5, 7, 1.5], [0, -4, 0], 'legBL'),
    part('legBR', up(true), [1.5, 5, 1.5], [-2.2, 1, -6.5], 'body'),
    part('cannonBR', low(), [1.5, 7, 1.5], [0, -4, 0], 'legBR'),
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

// Petsuchos (four-legged rig, 0.09): a long crocodile with a jewelled gold and
// team collar, a horned sun-disc crown, team bands and a team tail tip.
{
  const CROC = (x, y, z) => { const h = hash3(x, y, z, 71); const ridge = (z & 1) && y >= 4; return ridge ? 0x4e4224 : h < 0.5 ? 0x6e5c32 : h < 0.85 ? 0x62522c : 0x7a683c; };
  const BELLY = 0xb8a676;
  const body = new VoxelModel();
  for (let z = 0; z <= 22; z++) {
    const w = 4.2 - Math.abs(z - 12) * 0.08, hgt = 2.8;
    for (let x = -5; x <= 11; x++) for (let y = 0; y <= 6; y++) {
      const dx = (x - 3) / w, dy = (y - 3) / hgt;
      if (dx * dx + dy * dy <= 1) body.set(x, y, z, y <= 1 ? BELLY : CROC(x, y, z));
    }
  }
  for (let z = 1; z <= 21; z += 2) { body.set(2, 6, z, 0x4a3e20).set(4, 6, z, 0x4a3e20); }
  for (const z of [6, 14]) band(body, 3, GOLD_DK, 24);
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
  const tail = (r0, r1, tip) => {
    const m = new VoxelModel();
    for (let z = 0; z < 8; z++) {
      const r = r0 + (r1 - r0) * (z / 8);
      for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) if (x * x + y * y <= r * r + 0.3) m.set(x, y, -z, tip && z > 3 ? TEAM : y < -r * 0.5 ? BELLY : CROC(x, y, z));
      if (z % 2 === 0) m.set(0, Math.ceil(r), -z, tip && z > 3 ? TEAM : 0x4a3e20);
    }
    if (!tip) band(m, 0, GOLD_DK, 6);
    return m;
  };
  const up = new VoxelModel().box(-1, 0, 0, 3, 3, 2, CROC).box(0, 0, 0, 2, 2, 2, CROC);
  const low = new VoxelModel().box(0, 1, 0, 2, 3, 2, CROC).box(-1, 0, -1, 4, 1, 4, 0x5a4a28).set(-1, 0, 3, DARK).set(2, 0, 3, DARK).box(0, 2, 0, 2, 1, 2, TEAM);
  rig('petsuchos', { voxel: 0.09, anim: 'horse', style: 'croc', gait: 0.7, stride: 0.55 }, [
    part('body', body, [3, 0, 11], [0, 4.5, 0]),
    part('neck', neck, [0, 2, 0], [0, 1, 11], 'body'),
    part('tail', tail(2.6, 1.8, false), [0, 0, 0], [0, 3, -11], 'body'),
    part('tail2', tail(1.8, 1.0, false), [0, 0, 0], [0, 0, -8], 'tail', { anim: 'tail' }),
    part('tail3', tail(1.0, 0.4, true), [0, 0, 0], [0, 0, -8], 'tail2', { anim: 'tail' }),
    part('legFL', up, [1, 3, 1], [5.5, 1.5, 7], 'body'),
    part('cannonFL', low, [1, 4, 1], [1.5, -2, 0.5], 'legFL'),
    part('legFR', up, [1, 3, 1], [-5.5, 1.5, 7], 'body'),
    part('cannonFR', low, [1, 4, 1], [-1.5, -2, 0.5], 'legFR'),
    part('legBL', up, [1, 3, 1], [5.5, 1.5, -6], 'body'),
    part('cannonBL', low, [1, 4, 1], [1.5, -2, 0.5], 'legBL'),
    part('legBR', up, [1, 3, 1], [-5.5, 1.5, -6], 'body'),
    part('cannonBR', low, [1, 4, 1], [-1.5, -2, 0.5], 'legBR'),
  ]);
}

// Scarab (six-legged rig, 0.1): a giant beetle with an iridescent shell
// (green, orange, red) blotched with the army's colour, a dark horned head
// with great mandibles.
{
  const SHELL = (x, y, z) => { const u = Math.sin(z * 0.45 + x * 0.3) + Math.sin(y * 0.6 - x * 0.2); return u > 0.9 ? 0xd8701c : u > 0.1 ? 0x2f8a3a : u > -0.7 ? 0xb83a1c : 0x1f5a6a; };
  const CHIT = pick3(81, 0x2a2018, 0x3a2c1e, 0x221a14);
  const body = new VoxelModel();
  body.ellipsoid(5, 4, 9, 5.8, 4.4, 8.6, SHELL);
  for (let y = 0; y <= 2; y++) for (let z = 1; z <= 17; z++) for (let x = 0; x <= 10; x++) if (body.has(x, y, z)) body.set(x, y, z, CHIT(x, y, z));
  // the wing-case seam and team blotches on the shell
  for (let z = 2; z <= 16; z++) { let y = 10; while (y > 0 && !body.has(5, y, z)) y--; if (y > 0) body.set(5, y, z, 0x14100c); }
  for (const [x, z] of [[2, 6], [8, 11], [3, 13], [7, 4]]) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 2; dz++) {
    let y = 10; while (y > 0 && !body.has(x + dx, y, z + dz)) y--;
    if (y > 2 && (dx * dx + (dz - 0.5) * (dz - 0.5)) < 2.4) body.set(x + dx, y, z + dz, TEAM, { glow: 0.1 });
  }
  const headM = new VoxelModel();
  headM.ellipsoid(4, 3, 2, 3.6, 2.8, 2.6, CHIT);
  headM.set(1, 4, 4, 0xe0e040, { glow: 0.7 }).set(7, 4, 4, 0xe0e040, { glow: 0.7 });
  headM.box(2, 5, 0, 5, 1, 3, 0x3a5a2a);
  // mandibles: great curved horns forward and in
  for (const s of [-1, 1]) {
    tube(headM, [4 + s * 2, 2, 3.5], [4 + s * 4.2, 2.5, 7], 1.1, 0.9, CHIT);
    tube(headM, [4 + s * 4.2, 2.5, 7], [4 + s * 2.6, 2.5, 10.5], 0.9, 0.6, CHIT);
    tube(headM, [4 + s * 2.6, 2.5, 10.5], [4 + s * 0.8, 2.5, 11], 0.6, 0.5, 0x4a3828);
  }
  const legUp = new VoxelModel().box(0, 0, 0, 2, 5, 2, CHIT);
  const legLow = new VoxelModel().box(0, 1, 0, 1, 6, 1, CHIT).box(0, 0, 0, 1, 1, 3, CHIT).set(0, 4, 1, CHIT);
  const leg = (nm, x, z, ch) => [
    part(`leg${nm}`, legUp, [1, 5, 1], [x, 3, z], 'body', { anim: `leg${ch}` }),
    part(`cannon${nm}`, legLow, [0.5, 7, 0.5], [x > 0 ? 2 : -2, -4, 0], `leg${nm}`, { anim: `cannon${ch}` }),
  ];
  rig('scarab', { voxel: 0.1, anim: 'horse', style: 'beetle', gait: 1.1, stride: 0.6 }, [
    part('body', body, [5, 0, 9], [0, 6, 0]),
    part('neck', headM, [4, 2, 0], [0, 2, 8], 'body'),
    ...leg('FL', 5, 6, 'FL'), ...leg('FR', -5, 6, 'FR'),
    ...leg('ML', 6, 0, 'BR'), ...leg('MR', -6, 0, 'BL'),
    ...leg('BL', 5, -6, 'BL'), ...leg('BR', -5, -6, 'BR'),
  ]);
}

// Scorpion Man (four-legged rig, 0.09): a man's torso (bronze skin, a gold
// collar, a shaved head) on a scorpion's body of team and white plates, eight
// black legs, black pincers and a tail arching over the back.
{
  const PLATE = (x, y, z) => ((z >> 1) & 1 ? TEAM : 0xeceae2);
  const CHIT = pick3(82, 0x1e1c22, 0x2a2830, 0x16141a);
  const body = new VoxelModel();
  for (let z = 0; z <= 16; z++) {
    const w = 3.6 - Math.abs(z - 8) * 0.06;
    for (let x = -4; x <= 10; x++) for (let y = 0; y <= 6; y++) {
      const dx = (x - 3) / w, dy = (y - 3) / 2.6;
      if (dx * dx + dy * dy <= 1) body.set(x, y, z, y <= 1 ? CHIT(x, y, z) : PLATE(x, y, z));
    }
  }
  for (let z = 0; z <= 16; z++) for (let x = -4; x <= 10; x++) for (let y = 2; y <= 6; y++) { const v = body.get(x, y, z); if (v && v.team && (x + z) % 2 === 0) v.c = 0xc8c8c8; }
  // the pincers at the front (they move with the "neck" channel)
  const pin = new VoxelModel();
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -4 : 4;
    tube(pin, [x0, 1, 0], [x0 + s * 2, 1, 5], 1.0, 1.0, CHIT);
    tube(pin, [x0 + s * 2, 1, 5], [x0 + s * 1, 2, 9], 1.6, 1.8, CHIT);
    pin.box(x0 + s * 1 - 1, 1, 10, 3, 2, 3, CHIT).carve(x0 + s * 1, 2, 11, 1, 1, 2);
    pin.set(x0 + s * 1, 3, 9, 0x8a4a52);
  }
  // the tail arches up from the rump and over the back, the sting forward
  const ANG = [0.35, 0.9, 1.4, 1.9, 2.4, 2.85];
  const dirOf = (a) => [0, Math.sin(a) * 4.5, -Math.cos(a) * 4.5];
  const tseg = (i) => {
    const m = new VoxelModel();
    const d = dirOf(ANG[i]), r = 2 - i * 0.15;
    tube(m, [0, 0, 0], d, r, r - 0.15, (x, y, z, t) => (t < 0.25 ? CHIT(x, y, z) : (y - d[1] * t > 0 ? 0xeceae2 : TEAM)));
    if (i === 5) { tube(m, d, [0, d[1] - 2, d[2] + 2.5], 1.2, 0.4, 0x8a3a3a); m.set(0, Math.round(d[1] - 2), Math.round(d[2] + 3), 0xffd0a0, { glow: 0.3 }); }
    return m;
  };
  const tail = [];
  let prev = 'body';
  for (let i = 0; i < 6; i++) {
    const nm = i ? `tail${i + 1}` : 'tail';
    tail.push(part(nm, tseg(i), [0, 0, 0], i ? dirOf(ANG[i - 1]) : [0, 4, -8], prev, { anim: 'tail' }));
    prev = nm;
  }
  const legUp = new VoxelModel().box(0, 0, 0, 1, 1, 1, CHIT).line(0, 0, 0, 0, 3, 0, CHIT);
  const legLow = new VoxelModel().line(0, 6, 0, 0, 0, 1, CHIT).set(0, 0, 2, CHIT);
  const legs = [];
  const LCH = [['FL', 'FR'], ['BR', 'BL'], ['FL', 'FR'], ['BR', 'BL']];
  [5, 1.5, -2, -5.5].forEach((z, i) => {
    for (const s of [1, -1]) {
      const ch = s > 0 ? LCH[i][0] : LCH[i][1];
      const nm = `${s > 0 ? 'L' : 'R'}${i}`;
      const up = new VoxelModel(); tube(up, [0, 0, 0], [s * 4, 3, 0], 0.7, 0.6, CHIT);
      legs.push(part(`leg${nm}`, up, [0, 0, 0], [s * 3, 2, z], 'body', { anim: `leg${ch}` }));
      legs.push(part(`cannon${nm}`, legLow, [0.5, 6, 0.5], [s * 4, 3, 0], `leg${nm}`, { anim: `cannon${ch}` }));
    }
  });
  const t = riderTorso(() => { const m = torsoBody(SKIN); collar(m, [GOLD, TEAM, GOLD]); m.box(0, 0, -1, 8, 2, 6, OCHRE); m.box(0, 1, -1, 8, 1, 6, GOLD); return m; });
  rig('scorpion_man', { voxel: 0.09, anim: 'horse', style: 'scorpion', gait: 1.0, stride: 0.5 }, [
    part('body', body, [3, 0, 8], [0, 6, -1]),
    part('neck', pin, [0, 0, 0], [0, 0, 7], 'body'),
    ...tail,
    ...legs,
    part('torso', t, [4, 0, 2], [0, 5, 7], 'body'),
    head('spear'),
    ...arms({ bracer: GOLD, band: TEAM }),
    part('weapon', khopeshM(BRONZE), [0, 0, 0], HAND, 'armR'),
  ]);
}

// Wadjet (serpent rig, 0.09): a winged cobra: a coiled gold-scaled body, a
// hood in gold with dark scales, great wings in the army's colour with red
// bars and dark coverts.
{
  const SC = (x, y, z) => { const h = hash3(x, y, z, 91); return ((x + y + z) & 1) ? (h < 0.5 ? 0xd8b05a : 0xc8a04a) : (h < 0.5 ? 0x4a3e2a : 0x3a3222); };
  const BELLY = 0xe8d8a0;
  const coil = new VoxelModel();
  for (let a = 0; a < 26; a++) {
    const th = (a / 26) * Math.PI * 2 * 0.85;
    const cx = Math.sin(th) * 4.5, cz = Math.cos(th) * 4.5 - 1;
    for (let y = -2; y <= 2; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (dx * dx + dz * dz + y * y > 5) continue;
      coil.set(Math.round(cx + dx), Math.round(2 + y), Math.round(cz + dz), y <= -1 ? BELLY : SC(dx, y, a));
    }
  }
  for (let y = 2; y <= 9; y++) { const r = 2.6 - (y - 2) * 0.1; for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= r * r) coil.set(x, y, z + 1, z >= 2 ? BELLY : SC(x, y, z)); }
  const seg = (len, r0, r1) => { const m = new VoxelModel(); for (let z = 0; z < len; z++) { const r = r0 + (r1 - r0) * (z / len); for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= r * r + 0.3) m.set(x, y, -z, y < -r * 0.4 ? BELLY : SC(x, y, z)); } return m; };
  // the raised neck and hood: a broad flat shield of scales with a team spot pattern
  const hood = new VoxelModel();
  for (let y = 0; y <= 12; y++) { const r = 2.2; for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= r * r) hood.set(x + 4, y, z + 2, z >= 1 ? BELLY : SC(x, y, z)); }
  for (let y = 5; y <= 13; y++) {
    const w = Math.round(5.5 - Math.abs(y - 9.5) * 0.9);
    for (let x = -w; x <= w; x++) {
      hood.set(x + 4, y, 0, Math.abs(x) >= w - 1 ? 0x2a2418 : ((x + y) % 3 === 0 ? TEAM : SC(x, y, 0)));
      hood.set(x + 4, y, 1, (Math.abs(x) <= 1) ? BELLY : 0xd8b05a);
    }
  }
  const sh = new VoxelModel();
  sh.box(0, 0, 0, 4, 3, 5, SC).box(1, 0, 5, 2, 2, 2, SC).set(0, 2, 3, 0xff3020, { glow: 0.7 }).set(3, 2, 3, 0xff3020, { glow: 0.7 }).set(1, -1, 6, 0xf0e8d0).set(2, -1, 6, 0xf0e8d0);
  hood.merge(sh, 2, 13, 1);
  const wing = (s) => {
    const m = new VoxelModel();
    for (let i = 0; i <= 22; i++) {   // along the wing (outward)
      const len = Math.round(9 - i * 0.18 + (i > 14 ? (i - 14) * 0.6 : 0));
      for (let j = 0; j <= len; j++) {   // feather length (down / back)
        const c = j < 3 ? SC(i, j, 0) : (j === 4 || j === 9) ? RED : (j > len - 2 ? 0x1c2a6a : TEAM);
        m.set(s * i, -Math.round(j * 0.55), -j, c);
        if (c === TEAM && j % 3 === 0) tset(m, s * i, -Math.round(j * 0.55), -j, TEAM_SHADE);
      }
    }
    return m;
  };
  rig('wadjet', { voxel: 0.09, anim: 'medusa', style: 'wadjet', pose: 'serpent' }, [
    part('coil', coil, [0, 0, 0], [0, 0, 0]),
    part('tailA', seg(8, 2.2, 1.8), [0, 0, 0], [-2, 2, -4], 'coil'),
    part('tailB', seg(8, 1.8, 1.2), [0, 0, 0], [0, 0, -8], 'tailA'),
    part('tailC', seg(8, 1.2, 0.4), [0, 0, 0], [0, 0, -8], 'tailB'),
    part('torso', hood, [4, 0, 2], [0, 9, 1], 'coil'),
    part('wingL', wing(1), [0, 0, 0], [2.5, 9, -1], 'torso'),
    part('wingR', wing(-1), [0, 0, 0], [-2.5, 9, -1], 'torso'),
  ]);
}

// Phoenix (flyer, 0.1): a bird of fire: an orange body, red and yellow
// glowing wings tipped with blue (team) flame, a long burning tail.
{
  const FIRE = (x, y, z) => { const h = hash3(x, y, z, 95); return h < 0.35 ? 0xc87a20 : h < 0.7 ? 0x9a3414 : 0xe0ae30; };
  const body = new VoxelModel();
  body.ellipsoid(0, 0, 0, 2.6, 2.6, 5, FIRE, { glow: 0.0 });
  body.ellipsoid(0, 2, 5, 1.8, 2, 2, FIRE, { glow: 0.0 });
  body.box(-1, 2, 7, 2, 2, 2, 0xc89a10, { glow: 0.0 }).box(0, 1, 9, 1, 1, 2, GOLD_DK);
  body.set(-1, 3, 8, DARK).set(1, 3, 8, DARK);
  for (let i = 0; i < 6; i++) body.set(0, 4 + i, 5 - i, i > 3 ? TEAM : 0xc89a10, { glow: 0.0 });   // flame crest
  const wing = (s) => {
    const m = new VoxelModel();
    for (let i = 0; i <= 20; i++) {
      const len = Math.round(8 - i * 0.15 + (i > 12 ? (i - 12) * 0.5 : 0));
      for (let j = 0; j <= len; j++) {
        const c = j > len - 2 || i > 17 ? TEAM : j < 3 ? 0xe0ae30 : j < 6 ? 0xc87a20 : 0x9a3414;
        const wy = -Math.round(j * 0.6) + Math.round(Math.abs(i - 9) * 0.25);
        m.set(s * i, wy, -j, c, { glow: c === TEAM ? 0.1 : 0 }).set(s * i, wy - 1, -j, c, { glow: c === TEAM ? 0.1 : 0 });
      }
    }
    return m;
  };
  const tail = new VoxelModel();
  for (let i = 0; i < 14; i++) for (const x of [-2, 0, 2]) tail.set(x + Math.round(x * i * 0.08), -Math.round(i * 0.3), -i, i > 10 ? TEAM : i > 6 ? 0x9a3414 : 0xd09028, { glow: 0.0 });
  const leg = new VoxelModel().box(0, 0, 0, 1, 3, 1, GOLD_DK).box(-1, -1, 0, 3, 1, 2, GOLD_DK);
  rig('phoenix', { voxel: 0.1, anim: 'flyer', style: 'phoenix', hover: 16 }, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('wingL', wing(1), [0, 0, 0], [2, 1.5, 2], 'body'),
    part('wingR', wing(-1), [0, 0, 0], [-2, 1.5, 2], 'body'),
    part('tail', tail, [0, 0, 0], [0, 0, -5], 'body'),
    part('legL', leg, [0.5, 3, 0], [1.2, -2, 0], 'body'),
    part('legR', leg, [0.5, 3, 0], [-1.2, -2, 0], 'body'),
  ]);
}

// Roc (flyer, 0.12): a giant brown eagle with team wingtips carrying a round
// woven basket.
{
  const BR = pick3(96, 0x8a5a2e, 0x7a4e28, 0x9a6836);
  const body = new VoxelModel();
  body.ellipsoid(0, 0, 0, 3.2, 3, 6, BR);
  body.ellipsoid(0, 0, 0, 2.4, 2.4, 5.4, 0xe8c8a0);
  body.ellipsoid(0, 1, 0, 3.2, 2.6, 6, BR);
  body.ellipsoid(0, 2.5, 6, 2.2, 2.2, 2.4, BR);
  body.box(-1, 2, 8, 2, 2, 2, 0xe8d8b8).box(-1, 1, 10, 2, 2, 1, GOLD).set(0, 0, 10, GOLD_DK);
  body.set(-2, 3, 7, DARK).set(2, 3, 7, DARK);
  const wing = (s) => {
    const m = new VoxelModel();
    for (let i = 0; i <= 24; i++) {
      const len = Math.round(9 - i * 0.12 + (i > 16 ? (i - 16) * 0.6 : 0));
      for (let j = 0; j <= len; j++) {
        const c = i > 18 && j > 2 ? (j % 2 ? TEAM : 0xe0d0b0) : j < 3 ? BR(i, j, 0) : j < 7 ? 0x6a4422 : 0x5a3a1e;
        m.set(s * i, 0, -j, c);
      }
    }
    return m;
  };
  const tail = new VoxelModel();
  for (let i = 0; i < 9; i++) for (let x = -3; x <= 3; x++) tail.set(x + Math.round(x * i * 0.1), 0, -i, i > 6 ? TEAM : 0x6a4422);
  const basket = new VoxelModel();
  for (let y = 0; y <= 6; y++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    const d = Math.hypot(x, z);
    if (d > 5.3 || (d < 4.3 && y > 0)) continue;
    basket.set(x, y, z, y === 3 ? TEAM : (x + y + z) % 2 ? 0xc8986a : 0xb08050);
  }
  for (const [x, z] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) basket.line(x, 6, z, 0, 12, 0, ROPE());
  const leg = new VoxelModel().box(0, 0, 0, 1, 3, 1, 0xd8b060).box(-1, -1, -1, 3, 1, 3, 0xd8b060);
  rig('roc', { voxel: 0.12, anim: 'flyer', style: 'roc', hover: 26 }, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('wingL', wing(1), [0, 0, 0], [2.5, 1.5, 2], 'body'),
    part('wingR', wing(-1), [0, 0, 0], [-2.5, 1.5, 2], 'body'),
    part('tail', tail, [0, 0, 0], [0, 0.5, -6], 'body'),
    part('legL', leg, [0.5, 3, 0.5], [1.4, -2.5, 1], 'body'),
    part('legR', leg, [0.5, 3, 0.5], [-1.4, -2.5, 1], 'body'),
    part('basket', basket, [0, 12, 0], [0, -3, 1], 'body'),
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
    const ol = p.name === 'head' ? 0.5 : (p.name === 'weapon' || p.name === 'shield' || p.name.startsWith('tool')) ? 0.6 : 0.75;
    g.add(`${type}/${p.name}`, buildVoxelGeometry(p.model, { size: R.voxel * (p.scale || 1), pivot: p.pivot, jitter: 0.05 }), { outline: ol });
  }
}
g.extra.unitTypes = Object.keys(RIGS);
g.write();
