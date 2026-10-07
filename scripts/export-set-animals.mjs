#!/usr/bin/env node
// The Animals of Set of Age of Mythology: Retold (EGYPT.md 3.2, reference/
// egypt/unit_12.jpg: natural-looking beasts, a team collar on the neck) for
// the Godot port: the seven summons with no model before (Gazelle, Hyena,
// Giraffe, Crocodile, Hippopotamus, Rhinoceros, Elephant of Set, and the
// Priests' converted Deer and Boar of Set; the Baboon lives in
// export-egypt-units.mjs). Same unit voxel format, mesher and
// animation channels as scripts/export-egypt-units.mjs (four-legged "horse"
// rigs, the Crocodile a "sprawl" rig like the Petsuchos), so AovUnitView
// poses them in the world and portraits.gd renders their HUD icons:
//
//   node scripts/export-set-animals.mjs [--out godot/assets/models]   (~1 s, deterministic)
//
// Output: the "set_animals" model group (set_animals.json + .bin.gz) with a
// "rigs" table keyed by the sim type; VoxelModels.rig() / mesh("units", ..)
// fall back to it after egypt_units and egypt_gods.
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
  add(name, geo, { outline = 1 } = {}) {
    if (this.models[name]) throw new Error(`duplicate model ${this.name}/${name}`);
    const a = geo.attributes;
    const n = a.position.count;
    const codes = outlineCodes(geo);
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

// ---- palette and helpers (as export-egypt-units.mjs) -------------------------
const pick3 = (seed, a, b, c, pa = 0.5, pb = 0.85) => (x, y, z) => { const h = hash3(x, y, z, seed); return h < pa ? a : h < pb ? b : c; };
const GOLD = pick3(31, 0xe8c400, 0xd8b400, 0xf2d020, 0.45, 0.8);
const TEAM_SHADE = 0xb4b4b4;
const DARK = 0x140e0a;
const EYE = 0x1a1210;
const IVORY = 0xf0e6cc;
const IVORY_SH = 0xcfc2a2;
const RED_AMULET = 0xc23a22;

const OFF = 512;
const unkey = (k) => [((k >> 20) & 1023) - OFF, ((k >> 10) & 1023) - OFF, (k & 1023) - OFF];
const tset = (m, x, y, z, base) => { m.set(x, y, z, TEAM); m.get(x, y, z).c = base; return m; };
// a round tapered tube between two 3D points (legs, tails, necks)
function tube(m, a, b, r0, r1, color, opts) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const rm = Math.max(r0, r1);
  for (let x = Math.floor(Math.min(a[0], b[0]) - rm); x <= Math.ceil(Math.max(a[0], b[0]) + rm); x++)
    for (let y = Math.floor(Math.min(a[1], b[1]) - rm); y <= Math.ceil(Math.max(a[1], b[1]) + rm); y++)
      for (let z = Math.floor(Math.min(a[2], b[2]) - rm); z <= Math.ceil(Math.max(a[2], b[2]) + rm); z++) {
        const p = [x - a[0], y - a[1], z - a[2]];
        const t = Math.max(0, Math.min(1, (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / L2));
        const e = [p[0] - d[0] * t, p[1] - d[1] * t, p[2] - d[2] * t];
        const r = r0 + (r1 - r0) * t;
        if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] <= r * r + 0.15) m.set(x, y, z, typeof color === 'function' ? color(x, y, z, t) : color, opts);
      }
  return m;
}
// recolour the outer shell of a model where pred(x, y, z) holds
function paint(m, pred, color) {
  for (const k of [...m.vox.keys()]) {
    const [x, y, z] = unkey(k);
    if (pred(x, y, z)) m.set(x, y, z, color);
  }
  return m;
}
// the team collar of every Animal of Set (unit_12.jpg: a band on the neck) and
// a small gold amulet of Set hanging at its front: a ring of team voxels round
// the model's cross-section at z = zc (only the outer ones), y in [y0, y1]
function collar(m, zc, y0, y1, amulet = true) {
  let lo = null;
  for (const k of [...m.vox.keys()]) {
    const [x, y, z] = unkey(k);
    if (z !== zc || y < y0 || y > y1) continue;
    const out = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    if (!out) continue;
    if ((x + y) & 1) tset(m, x, y, z, TEAM_SHADE); else m.set(x, y, z, TEAM);
    if (x === 0 && (lo === null || y < lo)) lo = y;
  }
  if (amulet && lo !== null) m.set(0, lo - 1, zc, GOLD(0, 0, 0)).set(0, lo - 2, zc, RED_AMULET);
  return m;
}
// paint a vertical-ish collar on a tube-like neck: voxels within dist of a plane
function neckBand(m, a, b, t0, t1) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  for (const k of [...m.vox.keys()]) {
    const [x, y, z] = unkey(k);
    const t = ((x - a[0]) * d[0] + (y - a[1]) * d[1] + (z - a[2]) * d[2]) / L2;
    if (t < t0 || t > t1) continue;
    const out = !m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y + 1, z) || !m.has(x, y - 1, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1);
    if (out) { if ((x + y + z) & 1) tset(m, x, y, z, TEAM_SHADE); else m.set(x, y, z, TEAM); }
  }
  return m;
}

const part = (name, model, pivot, joint, parent = null, extra = {}) => ({ name, model, pivot, joint, parent, ...extra });
const RIGS = {};
const rig = (type, meta, parts) => { RIGS[type] = { ...meta, parts }; };

// A four-legged animal's legs: an upper part (w x up x w) hanging from its
// joint on the body, a lower part (w x low x w) ending on the ground. Leg tops
// at body-relative y `top` (front, back), x +-lx, z `fz` / `bz`.
function legs(o) {
  const out = [];
  for (const [n, front] of [['F', true], ['B', false]]) {
    const up = front ? o.upF : o.upB, low = o.low, w = o.w;
    for (const [s, side] of [[1, 'L'], [-1, 'R']]) {
      out.push(part(`leg${n}${side}`, o.upper(front), [w / 2, up, w / 2], [s * o.lx, front ? o.topF : o.topB, front ? o.fz : o.bz], 'body'));
      out.push(part(`cannon${n}${side}`, o.lower(front), [w / 2, low, w / 2], [0, -(up - 1), 0], `leg${n}${side}`));
    }
  }
  return out;
}

// ---- Gazelle of Set (Classical, 3 favor): a slender fawn antelope ------------
// white belly and rump, a dark flank stripe, a pale face blaze, long black
// lyre horns sweeping back, thin legs, a short black-tipped tail.
{
  const FAWN = pick3(101, 0xb0703a, 0xa66834, 0xba7a42);
  const DK = 0x3e2414, WH = 0xf0e6d4;
  const body = new VoxelModel();
  body.ellipsoid(0, 3, 0, 2.2, 2.4, 5.6, FAWN).ellipsoid(0, 3.6, 3, 2.1, 2.3, 2.6, FAWN);
  paint(body, (x, y, z) => y <= 1, WH);
  paint(body, (x, y, z) => y === 2 && Math.abs(x) >= 2, DK);          // the dark flank stripe
  paint(body, (x, y, z) => z <= -5 && y <= 4, WH);                      // the white rump
  const NA = [0, 0, 0], NB = [0, 6, 3];
  const neck = tube(new VoxelModel(), NA, NB, 1.5, 1.1, FAWN);
  paint(neck, (x, y, z) => z >= 1 && y <= 3 && x === 0 && neck.has(x, y, z + 1) === false, WH);   // pale throat
  neckBand(neck, NA, NB, 0.25, 0.45);
  const h = new VoxelModel();
  h.box(-1, 0, -1, 3, 3, 3, FAWN).box(-1, 0, 2, 3, 2, 2, FAWN).box(0, 0, 4, 1, 1, 1, DK);       // skull, muzzle, nose
  h.set(0, 2, 2, WH).set(0, 2, 1, WH);                                                           // the face blaze
  h.set(-2, 2, 1, EYE).set(2, 2, 1, EYE);
  h.set(-2, 3, -1, FAWN).set(-3, 4, -1, FAWN).set(2, 3, -1, FAWN).set(3, 4, -1, FAWN);           // ears
  for (const s of [-1, 1]) {                                                                     // the lyre horns
    h.set(s, 3, 0, DK).set(s, 4, 0, DK).set(s, 5, -1, DK).set(s, 6, -1, DK).set(s * 1, 7, -2, DK).set(s * 2, 8, -2, DK).set(s * 2, 8, -1, DK);
  }
  const tail = new VoxelModel().box(0, -2, 0, 1, 3, 1, WH).set(0, -3, 0, DK);
  const upper = () => new VoxelModel().box(0, 0, 0, 2, 6, 2, FAWN);
  const lower = () => new VoxelModel().box(0, 2, 0, 1, 7, 1, FAWN).box(0, 0, 0, 1, 2, 1, DK).set(1, 6, 0, FAWN).set(1, 7, 0, FAWN);
  rig('gazelle_of_set', { voxel: 0.06, anim: 'horse', style: 'gazelle', gait: 1.4, stride: 0.9 }, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('neck', neck, [0, 0, 0], [0, 4, 5.5], 'body'),
    part('head', h, [0, 0, 0], [0, 6, 3], 'neck', { rest: [0.1, 0, 0] }),
    part('tail', tail, [0, 0, 0], [0, 4.5, -6], 'body'),
    ...legs({ w: 2, upF: 6, upB: 6, low: 9, topF: 2, topB: 2, lx: 1.4, fz: 3.5, bz: -3.5, upper, lower }),
  ]);
}

// ---- Hyena of Set (Classical, 4 favor): a spotted hyena ----------------------
// high shoulders sloping to a low rump, sandy grey fur with dark spots, a dark
// bristly mane down the neck and back, a short dark muzzle, round ears.
{
  const SAND = (x, y, z) => { const h = hash3(x, y, z, 111); const spot = hash3(x >> 1, y >> 1, z >> 1, 112) < 0.22; return spot ? (h < 0.5 ? 0x3c2c1c : 0x4a3622) : h < 0.5 ? 0xa08a5e : h < 0.85 ? 0x948056 : 0xac966a; };
  const MANE = 0x2e2216, MUZ = 0x2a2018;
  const body = new VoxelModel();
  body.ellipsoid(0, 4, 3, 2.6, 3.2, 3.6, SAND).ellipsoid(0, 2.6, -3, 2.2, 2.4, 3.2, SAND);
  paint(body, (x, y, z) => x === 0 && !body.has(0, y + 1, z) && z >= -2, MANE);
  const NA = [0, 0, 0], NB = [0, 2.5, 3];
  const neck = tube(new VoxelModel(), NA, NB, 2.2, 1.8, SAND);
  paint(neck, (x, y, z) => x === 0 && !neck.has(0, y + 1, z), MANE);
  neckBand(neck, NA, NB, 0.1, 0.35);
  const h = new VoxelModel();
  h.box(-2, -1, -1, 5, 4, 4, SAND).box(-1, -1, 3, 3, 2, 3, MUZ).set(0, 1, 3, MUZ).set(0, 0, 6, DARK);
  h.set(-2, 2, 2, EYE).set(2, 2, 2, EYE).set(-1, -2, 5, IVORY).set(1, -2, 5, IVORY);
  h.box(-3, 3, 0, 2, 2, 1, MUZ).box(2, 3, 0, 2, 2, 1, MUZ);                       // round ears
  const tail = new VoxelModel().box(0, -3, 0, 1, 3, 1, SAND).box(0, -5, 0, 1, 2, 1, MANE);
  const upper = () => new VoxelModel().box(0, 0, 0, 2, 6, 2, SAND);
  const lower = (front) => new VoxelModel().box(0, 1, 0, 2, 6, 2, SAND).box(0, 0, 0, 2, 1, 3, MUZ);
  rig('hyena_of_set', { voxel: 0.06, anim: 'horse', style: 'hyena', gait: 1.3, stride: 0.8 }, [
    part('body', body, [0, 0, 0], [0, 8, 0]),
    part('neck', neck, [0, 0, 0], [0, 5, 5.5], 'body'),
    part('head', h, [0, 0, 0], [0, 2.5, 3], 'neck', { rest: [0.2, 0, 0] }),
    part('tail', tail, [0, 0, 0], [0, 3.5, -6], 'body'),
    ...legs({ w: 2, upF: 6, upB: 4, low: 7, topF: 4, topB: 2, lx: 1.6, fz: 3.5, bz: -3.5, upper, lower }),
  ]);
}

// ---- Giraffe of Set (Heroic, 5 favor): unit_12.jpg's reticulated giraffe -----
// chestnut patches in a net of cream lines, a long neck with a short dark
// mane and the team collar near the head, ossicones with dark tips, long legs.
{
  const NET = (x, y, z) => {
    // reticulation: cells about 3 voxels, offset per row, cream borders
    const cy = Math.floor((y + 40) / 3), off = (cy & 1) ? 1.5 : 0;
    const bz = ((z + 40 + off) % 3.2), by = ((y + 40) % 3);
    const line = bz < 0.75 || by < 0.6 || hash3(x, y, z, 121) < 0.04;
    return line ? 0xe8d6ae : hash3(cy, Math.floor((z + 40 + off) / 3.2), 0, 122) < 0.5 ? 0x8a4620 : 0x7a3c1a;
  };
  const CREAM = 0xe8d6ae, MANE = 0x5a2e14, HOOF = 0x2a1c12;
  const body = new VoxelModel();
  body.ellipsoid(0, 3, 0, 2.6, 2.8, 5.4, NET).ellipsoid(0, 4.4, 3, 2.6, 3, 3, NET);
  paint(body, (x, y, z) => y <= 0, CREAM);
  const NA = [0, 0, 0], NB = [0, 17, 6];
  const neck = tube(new VoxelModel(), NA, NB, 1.9, 1.1, NET);
  for (let t = 0.05; t <= 0.9; t += 0.06) { const y = Math.round(NB[1] * t), z = Math.round(NB[2] * t - 1.6 + t * 0.4); neck.set(0, y, z, MANE); }
  neckBand(neck, NA, NB, 0.78, 0.88);
  const h = new VoxelModel();
  h.box(-1, 0, -1, 3, 3, 3, NET).box(-1, -1, 2, 3, 3, 3, CREAM).box(-1, -1, 5, 3, 2, 1, 0xd8c49a).set(0, 0, 6, DARK);
  h.set(-2, 1, 1, EYE).set(2, 1, 1, EYE);
  h.set(-2, 2, -1, NET).set(-3, 2, -1, CREAM).set(2, 2, -1, NET).set(3, 2, -1, CREAM);           // ears
  h.set(-1, 3, 0, NET).set(-1, 4, 0, DARK).set(1, 3, 0, NET).set(1, 4, 0, DARK);                 // ossicones
  const tail = new VoxelModel().box(0, -6, 0, 1, 6, 1, NET).box(0, -8, 0, 1, 2, 1, DARK).set(1, -8, 0, DARK);
  const upper = () => new VoxelModel().box(0, 0, 0, 2, 8, 2, NET);
  const lower = () => new VoxelModel().box(0, 1, 0, 2, 10, 2, (x, y, z) => (y < 6 ? CREAM : NET(x, y, z))).box(0, 0, 0, 2, 1, 2, HOOF);
  rig('giraffe_of_set', { voxel: 0.07, anim: 'horse', style: 'giraffe', gait: 0.8, stride: 0.75 }, [
    part('body', body, [0, 0, 0], [0, 15, 0]),
    part('neck', neck, [0, 0, 0], [0, 5.5, 5], 'body'),
    part('head', h, [0, 0, 0], [0, 17, 6], 'neck', { rest: [0.15, 0, 0] }),
    part('tail', tail, [0, 0, 0], [0, 5, -5.5], 'body'),
    ...legs({ w: 2, upF: 8, upB: 7, low: 11, topF: 3, topB: 2, lx: 1.6, fz: 3.5, bz: -3.5, upper, lower }),
  ]);
}

// ---- Crocodile of Set (Heroic, 6 favor): a Nile crocodile --------------------
// a low olive-brown body sprawling on its limbs (the Petsuchos' sprawl rig),
// a pale belly, scute ridges, a long toothy snout, the team collar at the neck.
{
  const CROC = (x, y, z) => { const h = hash3(x, y, z, 131); return h < 0.5 ? 0x5a5a2e : h < 0.85 ? 0x4e5028 : 0x666634; };
  const BELLY = 0xc8b886, SCUTE = 0x2e2e18, CLAW = 0xd8c49a;
  const body = new VoxelModel();
  for (let z = 0; z <= 16; z++) {
    const w = z < 4 ? 2.6 + z * 0.2 : z > 12 ? 3.4 - (z - 12) * 0.2 : 3.4;
    for (let x = -4; x <= 4; x++) for (let y = 0; y <= 3; y++) {
      const dx = Math.abs(x) / (w + 0.4), dy = Math.abs(y - 1.5) / 2.2;
      if (Math.pow(dx, 2.6) + Math.pow(dy, 2.6) > 1) continue;
      body.set(x, y, z, y === 0 ? BELLY : CROC(x, y, z));
    }
  }
  for (let z = 1; z <= 15; z += 2) body.set(-1, 4, z, SCUTE).set(1, 4, z, SCUTE);
  collar(body, 16, 0, 4, false);
  const neck = new VoxelModel();
  for (let z = 0; z <= 11; z++) {
    const w = z < 4 ? 2.8 : 2.0 - (z - 4) * 0.08, hh = z < 4 ? 2.2 : 1.4;
    for (let x = -3; x <= 3; x++) for (let y = 0; y <= 4; y++) {
      const dx = x / w, dy = (y - 1.6) / hh;
      if (dx * dx + dy * dy <= 1) neck.set(x, y, z, y === 0 ? BELLY : CROC(x, y, z));
    }
  }
  for (let z = 5; z <= 11; z += 2) neck.set(-2, 1, z, IVORY).set(2, 1, z, IVORY);    // teeth
  neck.set(-2, 3, 3, 0xd8b020).set(2, 3, 3, 0xd8b020).set(-2, 4, 3, CROC).set(2, 4, 3, CROC);   // eyes on top
  neck.set(-1, 3, 11, DARK).set(1, 3, 11, DARK);
  const tail = (r0, r1, drop) => {
    const m = new VoxelModel();
    const yc = (z) => (r0 + (r1 - r0) * (z / 7)) - r0 - drop * (z / 7);
    for (let z = 0; z < 7; z++) {
      const r = r0 + (r1 - r0) * (z / 7), c = yc(z);
      for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) {
        const dy = y - c;
        if (x * x * 0.8 + dy * dy > r * r + 0.3) continue;
        m.set(x, y, -z, dy < -r * 0.45 ? BELLY : CROC(x, y, z));
      }
      if (z % 2 === 0) m.set(0, Math.round(c + r) + 1, -z, SCUTE);
    }
    return { m, next: [0, yc(7), -7] };
  };
  const T1 = tail(1.9, 1.4, 0.5), T2 = tail(1.4, 0.9, 0.3), T3 = tail(0.9, 0.4, 0.2);
  const upper = (s) => { const m = new VoxelModel(); for (let i = 0; i < 3; i++) m.box(s * i, 0, 0, 1, 2, 2, CROC); return m; };
  const lower = (s) => {
    const m = new VoxelModel();
    m.box(0, 2, 0, 1, 1, 2, CROC).box(s, 1, 0, 1, 1, 2, CROC);
    for (let i = 1; i <= 3; i++) for (let k = -1; k <= 1; k++) m.set(s * i, 0, k, CROC);
    m.set(s, 0, 2, CLAW).set(s * 2, 0, 2, CLAW).set(s * 3, 0, 2, CLAW);
    return m;
  };
  rig('crocodile_of_set', { voxel: 0.08, anim: 'horse', style: 'croc', gait: 0.7, stride: 0.55, graze: false, sprawl: true }, [
    part('body', body, [0, 0, 8], [0, 1, 0]),
    part('neck', neck, [0, 2, 0], [0, 1, 8.5], 'body'),
    part('tail', T1.m, [0, 0, 0], [0, 1.8, -8], 'body', { anim: 'tailA' }),
    part('tail2', T2.m, [0, 0, 0], T1.next, 'tail', { anim: 'tailB' }),
    part('tail3', T3.m, [0, 0, 0], T2.next, 'tail2', { anim: 'tailC' }),
    part('legFL', upper(1), [0, 1, 1], [2.8, 1.5, 5.5], 'body'),
    part('cannonFL', lower(1), [0.5, 2, 1], [2.5, 0, 0], 'legFL'),
    part('legFR', upper(-1), [1, 1, 1], [-2.8, 1.5, 5.5], 'body'),
    part('cannonFR', lower(-1), [0.5, 2, 1], [-2.5, 0, 0], 'legFR'),
    part('legBL', upper(1), [0, 1, 1], [2.8, 1.5, -5], 'body'),
    part('cannonBL', lower(1), [0.5, 2, 1], [2.5, 0, 0], 'legBL'),
    part('legBR', upper(-1), [1, 1, 1], [-2.8, 1.5, -5], 'body'),
    part('cannonBR', lower(-1), [0.5, 2, 1], [-2.5, 0, 0], 'legBR'),
  ]);
}

// ---- Hippopotamus of Set (Mythic, 7 favor, 2 pop) ----------------------------
// a huge grey-violet barrel on short stumpy legs, a pink belly and cheeks, a
// massive square muzzle with nostrils, eyes and small ears on top, tusks.
{
  const HIDE = pick3(141, 0x72646c, 0x6a5c64, 0x7c6e76);
  const PINK = 0xb88480, PINK_DK = 0x8e5e5a, TOE = 0x3a3036;
  const body = new VoxelModel();
  body.ellipsoid(0, 4, 0, 4, 3.6, 6.4, HIDE);
  paint(body, (x, y, z) => y <= 1, PINK);
  collar(body, 6, 1, 7);
  const h = new VoxelModel();
  h.ellipsoid(0, 1, 2, 3, 2.6, 2.6, HIDE);                                     // the skull
  h.box(-3, -2, 4, 7, 3, 4, HIDE).box(-3, -3, 4, 7, 1, 4, PINK);               // the square muzzle
  h.box(-2, -1, 8, 5, 2, 1, HIDE);
  h.set(-1, 0, 8, DARK).set(1, 0, 8, DARK);                                    // nostrils
  h.set(-2, 3, 2, EYE).set(2, 3, 2, EYE).set(-2, 4, 2, HIDE).set(2, 4, 2, HIDE);
  h.set(-2, 4, 0, PINK_DK).set(2, 4, 0, PINK_DK);                              // small ears
  h.set(-2, -2, 8, IVORY).set(2, -2, 8, IVORY).set(-2, -1, 8, IVORY_SH).set(2, -1, 8, IVORY_SH);
  paint(h, (x, y, z) => Math.abs(x) >= 3 && y <= -1 && z >= 4, PINK);          // pink cheeks
  const tail = new VoxelModel().box(0, -2, 0, 1, 2, 1, HIDE).set(0, -3, 0, TOE);
  const upper = () => new VoxelModel().box(0, 0, 0, 3, 3, 3, HIDE);
  const lower = () => new VoxelModel().box(0, 1, 0, 3, 3, 3, HIDE).box(0, 0, 0, 3, 1, 3, TOE).set(1, 0, 3, TOE);
  rig('hippo_of_set', { voxel: 0.09, anim: 'horse', style: 'hippo', gait: 0.8, stride: 0.45, graze: false }, [
    part('body', body, [0, 0, 0], [0, 2.5, 0]),
    part('neck', h, [0, 0, 0], [0, 4.5, 6], 'body'),
    part('tail', tail, [0, 0, 0], [0, 5, -6.8], 'body'),
    ...legs({ w: 3, upF: 3, upB: 3, low: 4, topF: 3.5, topB: 3.5, lx: 2.4, fz: 3.8, bz: -3.8, upper, lower }),
  ]);
}

// ---- Rhinoceros of Set (Mythic, 9 favor, 2 pop) ------------------------------
// a dusty brown-grey armoured body (mud-tinted, warmer than the Elephant of
// Set's cool grey, so the two read apart on their buttons) with darker skin
// folds at the shoulder and the hip, a long low head with a great front horn
// and a smaller one behind it, upright ears, pillar legs.
{
  const HIDE = pick3(151, 0x907e6a, 0x847260, 0x9c8a74);
  const FOLD = 0x5e4e40, HORN = 0xd8ccb0, HORN_DK = 0xa89a7c, TOE = 0x3c3834;
  const body = new VoxelModel();
  body.ellipsoid(0, 3.6, 0, 3.2, 3.2, 6.4, HIDE).ellipsoid(0, 4.6, 2.6, 3, 3, 2.8, HIDE);   // the shoulder hump
  for (const zf of [2, -3]) paint(body, (x, y, z) => z === zf, FOLD);
  collar(body, 6, 1, 7);
  const h = new VoxelModel();
  h.box(-2, -1, 0, 5, 4, 4, HIDE).box(-2, -2, 4, 5, 3, 3, HIDE).box(-1, -2, 7, 3, 2, 1, HIDE);   // skull and snout, sloping down
  h.set(-2, 1, 3, EYE).set(2, 1, 3, EYE);
  h.box(-2, 3, 0, 1, 2, 1, HIDE).box(2, 3, 0, 1, 2, 1, HIDE).set(-2, 5, 0, FOLD).set(2, 5, 0, FOLD);   // ears
  // the great horn on the snout, curving back; the small one behind it
  h.box(-1, 1, 6, 3, 1, 2, HORN_DK).box(-1, 2, 6, 2, 1, 2, HORN).set(0, 3, 6, HORN).set(0, 4, 6, HORN).set(0, 5, 5, HORN).set(0, 6, 5, HORN_DK);
  h.set(0, 2, 4, HORN_DK).set(0, 3, 4, HORN);
  const tail = new VoxelModel().box(0, -3, 0, 1, 3, 1, HIDE).set(0, -4, 0, FOLD);
  const upper = () => new VoxelModel().box(0, 0, 0, 3, 4, 3, HIDE);
  const lower = () => new VoxelModel().box(0, 1, 0, 3, 4, 3, HIDE).box(0, 0, 0, 3, 1, 3, TOE);
  rig('rhino_of_set', { voxel: 0.09, anim: 'horse', style: 'rhino', gait: 0.85, stride: 0.55, graze: false }, [
    part('body', body, [0, 0, 0], [0, 5, 0]),
    part('neck', h, [0, 0, 0], [0, 3.5, 6.4], 'body', { rest: [0.2, 0, 0] }),
    part('tail', tail, [0, 0, 0], [0, 4.5, -6.8], 'body'),
    ...legs({ w: 3, upF: 4, upB: 4, low: 5, topF: 3, topB: 3, lx: 2, fz: 3.8, bz: -3.8, upper, lower }),
  ]);
}

// ---- Elephant of Set (Mythic, 14 favor, 2 pop) -------------------------------
// a wild grey bush elephant (no howdah, no armour: not the War Elephant), big
// flapping ears, a hanging trunk, long ivory tusks, the team collar.
{
  const G = pick3(161, 0x8c8784, 0x807b78, 0x98938f);
  const GE = 0x6e6966, NAIL = 0xe8dcc4;
  const body = new VoxelModel();
  body.ellipsoid(0, 4.5, 0, 4.4, 4.4, 7, G).ellipsoid(0, 5.6, 3.5, 4.2, 4.2, 3.6, G);
  collar(body, 7, 2, 9);
  const h = new VoxelModel();
  h.ellipsoid(0, 1, 2, 3.4, 3.6, 2.8, G);                                                      // the domed head
  tube(h, [0, -1, 4.5], [0, -6, 6], 1.6, 1.2, G);                                             // the trunk
  tube(h, [0, -6, 6], [0, -9, 5.5], 1.2, 0.9, G);
  for (const s of [-1, 1]) {
    tube(h, [s * 2, -2, 4], [s * 2.5, -4.5, 7], 0.9, 0.75, IVORY_SH);                          // tusks
    tube(h, [s * 2.5, -4.5, 7], [s * 2.2, -3.2, 9.5], 0.75, 0.3, IVORY);
    for (let y = -4; y <= 4; y++) for (let z = -3; z <= 2; z++) {                             // the big ears, flared
      const dy = (y + 0.5) / 4.6, dz = (z + 0.5) / 3.2;
      if (dy * dy + dz * dz > 1) continue;
      h.set(s * 4, y, z, y <= -3 ? GE : G).set(s * 5, y, z - 1, GE);
    }
    h.set(s * 2, 2, 4, EYE);
  }
  const tail = new VoxelModel().box(0, -6, 0, 1, 6, 1, G).box(0, -7, 0, 1, 1, 1, DARK);
  const upper = () => new VoxelModel().box(0, 0, 0, 4, 6, 4, G);
  const lower = () => {
    const m = new VoxelModel().box(0, 1, 0, 4, 6, 4, G).box(0, 0, 0, 4, 1, 4, GE);
    for (let x = 0; x < 4; x += 2) m.set(x, 0, 4, NAIL);
    return m;
  };
  rig('elephant_of_set', { voxel: 0.1, anim: 'horse', style: 'elephant', gait: 0.55, stride: 0.6, graze: false }, [
    part('body', body, [0, 0, 0], [0, 8, 0]),
    part('neck', h, [0, 0, 0], [0, 7, 7.5], 'body'),
    part('tail', tail, [0, 0, 0], [0, 8, -7.2], 'body'),
    ...legs({ w: 4, upF: 6, upB: 6, low: 7, topF: 4, topB: 4, lx: 2.6, fz: 4.5, bz: -4.5, upper, lower }),
  ]);
}

// ---- Deer of Set / Boar of Set (a Set Priest's converted wild deer / boar,
// EGYPT.md 4 Set): the map's deer (red-brown, white tail, antlers) and boar
// (bristly dark brown, tusks), each with the team collar and Set's amulet.
{
  const RB = pick3(171, 0x8a5430, 0x804c2a, 0x965c36);
  const WH = 0xeee2cc, DK = 0x3a2416, ANT = 0xc8b088;
  const body = new VoxelModel();
  body.ellipsoid(0, 3, 0, 2.2, 2.5, 5.4, RB).ellipsoid(0, 3.7, 3, 2.1, 2.4, 2.6, RB);
  paint(body, (x, y, z) => y <= 1, WH);
  const NA = [0, 0, 0], NB = [0, 5.5, 3];
  const neck = tube(new VoxelModel(), NA, NB, 1.6, 1.2, RB);
  neckBand(neck, NA, NB, 0.25, 0.45);
  const h = new VoxelModel();
  h.box(-1, 0, -1, 3, 3, 3, RB).box(-1, 0, 2, 3, 2, 2, RB).box(0, 0, 4, 1, 1, 1, DK);
  h.set(-2, 2, 1, EYE).set(2, 2, 1, EYE).set(-2, 3, -1, RB).set(-3, 3, -1, RB).set(2, 3, -1, RB).set(3, 3, -1, RB);
  for (const s of [-1, 1]) {   // branching antlers
    h.line(s, 3, 0, s * 2, 6, -1, ANT).line(s * 2, 6, -1, s * 3, 8, -2, ANT).line(s * 2, 6, -1, s * 2, 8, 1, ANT).line(s * 3, 8, -2, s * 4, 9, -1, ANT);
  }
  const tail = new VoxelModel().box(0, -2, 0, 1, 3, 1, WH);
  const upper = () => new VoxelModel().box(0, 0, 0, 2, 6, 2, RB);
  const lower = () => new VoxelModel().box(0, 2, 0, 1, 7, 1, RB).box(0, 0, 0, 1, 2, 1, DK).set(1, 6, 0, RB).set(1, 7, 0, RB);
  rig('deer_of_set', { voxel: 0.065, anim: 'horse', style: 'deer', gait: 1.3, stride: 0.85 }, [
    part('body', body, [0, 0, 0], [0, 10, 0]),
    part('neck', neck, [0, 0, 0], [0, 4, 5.5], 'body'),
    part('head', h, [0, 0, 0], [0, 5.5, 3], 'neck', { rest: [0.1, 0, 0] }),
    part('tail', tail, [0, 0, 0], [0, 4.5, -5.8], 'body'),
    ...legs({ w: 2, upF: 6, upB: 6, low: 9, topF: 2, topB: 2, lx: 1.4, fz: 3.5, bz: -3.5, upper, lower }),
  ]);
}
{
  const BR = (x, y, z) => { const h = hash3(x, y, z, 181); return h < 0.5 ? 0x4a3424 : h < 0.85 ? 0x3e2c1e : 0x58402c; };
  const BRISTLE = 0x221810, SNOUT = 0x8a6a5a, TOE = 0x1e1610;
  const body = new VoxelModel();
  body.ellipsoid(0, 3.4, 0, 3, 3, 5.4, BR).ellipsoid(0, 4.2, 2.6, 2.8, 3, 2.8, BR);
  paint(body, (x, y, z) => x === 0 && !body.has(0, y + 1, z), BRISTLE);
  collar(body, 5, 1, 6);
  const h = new VoxelModel();
  h.box(-2, -1, 0, 5, 4, 3, BR).box(-1, -2, 3, 3, 3, 3, BR).box(-1, -2, 6, 3, 2, 1, SNOUT);
  h.set(-1, -1, 6, DARK).set(1, -1, 6, DARK).set(-2, 1, 2, EYE).set(2, 1, 2, EYE);
  h.set(-2, -2, 5, IVORY).set(2, -2, 5, IVORY).set(-2, -1, 5, IVORY).set(2, -1, 5, IVORY);   // tusks
  h.box(-2, 3, 0, 1, 2, 1, BR).box(2, 3, 0, 1, 2, 1, BR);
  const tail = new VoxelModel().box(0, -3, 0, 1, 3, 1, BR).set(0, -4, 0, BRISTLE);
  const upper = () => new VoxelModel().box(0, 0, 0, 2, 3, 2, BR);
  const lower = () => new VoxelModel().box(0, 1, 0, 2, 3, 2, BR).box(0, 0, 0, 2, 1, 2, TOE);
  rig('boar_of_set', { voxel: 0.08, anim: 'horse', style: 'boar', gait: 1.2, stride: 0.6, graze: false }, [
    part('body', body, [0, 0, 0], [0, 4, 0]),
    part('neck', h, [0, 0, 0], [0, 3.5, 5.2], 'body', { rest: [0.15, 0, 0] }),
    part('tail', tail, [0, 0, 0], [0, 4.5, -5.6], 'body'),
    ...legs({ w: 2, upF: 3, upB: 3, low: 4, topF: 2.5, topB: 2.5, lx: 1.8, fz: 3, bz: -3, upper, lower }),
  ]);
}

// ---- write ---------------------------------------------------------------------
const g = new Group('set_animals');
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
        coat: false, portrait: true, conditional: false, mesh: `${type}/${p.name}`,
      };
      if (p.rest) o.rest = p.rest;
      return o;
    }),
  };
  for (const p of parts) g.add(`${type}/${p.name}`, buildVoxelGeometry(p.model, { size: R.voxel, pivot: p.pivot, jitter: 0.05, ao: true }), { outline: 0.3 });
}
g.extra.unitTypes = Object.keys(RIGS);
g.write();
