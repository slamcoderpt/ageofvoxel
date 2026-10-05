#!/usr/bin/env node
// Export every procedural voxel model of the browser build to Godot.
//
//   node scripts/export-models.mjs [--out godot/assets/models]
//
// Runs the real JS builders (the same functions and the same mesher options
// the browser renderers use: Units._buildRig, Buildings.geometry /
// stageGeometry, Props.geometry, ResourceRenderer.geometry, GroundDetails,
// EconomyView, Debris, Projectiles) in node and writes the meshed geometry,
// so Godot shows exactly the same models, colours, per-voxel jitter and baked
// AO. Re-run it whenever a models.js changes; the output is deterministic.
//
// Output per group (units, buildings, construction, props, resources,
// details, economy, combat):
//   <group>.json    manifest: { format, group, bin, bytes, models: { name: entry } }
//   <group>.bin.gz  gzip of little-endian blobs referenced by byte offsets
//                   (Godot: bytes.decompress_dynamic(-1, FileAccess.COMPRESSION_GZIP))
// entry = { vertices, indices, aabb: [minx,miny,minz,maxx,maxy,maxz],
//           position, normal, color, extra, index }  (byte offsets)
//   position  float32 x3 per vertex (world units, pivot at origin)
//   normal    float32 x3
//   color     uint8 x4 RGBA8: sRGB colour with the per-voxel jitter and the
//             baked AO applied (the browser's linear vertex colour, encoded
//             to sRGB so 8 bits do not band), A = 255
//   extra     uint8 x4: (team * 255, glow * 255, outline code (units, see outline-codes.mjs), 0). team 1 = multiply the
//             albedo by the owner colour; glow = emissive (browser: emission =
//             albedo * glow * 2.5)
//   index     int32, triangles already in Godot's winding (clockwise front
//             faces), i.e. three.js order with the 2nd and 3rd index swapped
// Godot loads them with godot/game/core/voxel_models.gd (color -> CUSTOM0,
// extra -> CUSTOM1, both RGBA8_UNORM) and shades them with
// godot/game/core/voxel.gdshader.
// Units additionally carry "rig" metadata in units.json (see below).
import * as THREE from 'three';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outlineCodes } from './outline-codes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(ROOT, argOf('out', 'godot/assets/models'));

const src = (p) => import(path.join(ROOT, 'src', p));
const { Units, UNIT_DEFS } = await src('units/index.js');
const { RIGS } = await src('units/models.js');
const { Buildings, BUILDING_DEFS } = await src('buildings/index.js');
const { BUILDING_VARIANTS } = await src('buildings/models.js');
const { CONSTRUCTION_STAGES } = await src('buildings/construction.js');
const { Props, PROP_KINDS } = await src('buildings/props.js');
const { ResourceRenderer } = await src('terrain/ResourceRenderer.js');
const { GroundDetails } = await src('terrain/GroundDetails.js');
const TM = await src('terrain/models.js');
const { EconomyView } = await src('economy/EconomyView.js');
const { Debris } = await src('combat/Debris.js');
const { Projectiles } = await src('combat/Projectiles.js');

const FORMAT = 2;
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const u8 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
fs.mkdirSync(OUT, { recursive: true });

class Group {
  constructor(name) { this.name = name; this.models = {}; this.chunks = []; this.bytes = 0; this.extra = {}; }
  _blob(typed) {
    const off = this.bytes;
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    this.chunks.push(buf);
    this.bytes += buf.length;
    return off;
  }
  add(name, geo, meta = {}) {
    if (this.models[name]) throw new Error(`duplicate model ${this.name}/${name}`);
    const a = geo.attributes;
    const n = a.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4), ext = new Uint8Array(n * 4);
    // units: extra.b = the outline push per corner (outline-codes.mjs; Godot only, the browser ignores it)
    const codes = this.name === 'units' && a.normal ? outlineCodes(geo) : null;
    for (let i = 0; i < n; i++) {
      if (codes) ext[i * 4 + 2] = codes[i];
      pos[i * 3] = a.position.getX(i); pos[i * 3 + 1] = a.position.getY(i); pos[i * 3 + 2] = a.position.getZ(i);
      if (a.normal) { nor[i * 3] = a.normal.getX(i); nor[i * 3 + 1] = a.normal.getY(i); nor[i * 3 + 2] = a.normal.getZ(i); }
      if (a.color) { col[i * 4] = u8(toSRGB(a.color.getX(i))); col[i * 4 + 1] = u8(toSRGB(a.color.getY(i))); col[i * 4 + 2] = u8(toSRGB(a.color.getZ(i))); }
      else { col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 255; }
      col[i * 4 + 3] = 255;
      ext[i * 4] = a.team ? u8(a.team.getX(i)) : 0;
      ext[i * 4 + 1] = a.glow ? u8(a.glow.getX(i)) : 0;
    }
    let idx;
    if (geo.index) idx = Int32Array.from(geo.index.array);
    else { idx = new Int32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    this.models[name] = {
      vertices: n, indices: idx.length,
      aabb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map(r4),
      position: this._blob(pos), normal: this._blob(nor), color: this._blob(col), extra: this._blob(ext), index: this._blob(idx),
      ...meta,
    };
  }
  write() {
    const man = { format: FORMAT, group: this.name, bin: `${this.name}.bin.gz`, bytes: this.bytes, ...this.extra, models: this.models };
    const gz = zlib.gzipSync(Buffer.concat(this.chunks), { level: 9, mtime: 0 });
    fs.writeFileSync(path.join(OUT, `${this.name}.bin.gz`), gz);
    this.gz = gz.length;
    fs.writeFileSync(path.join(OUT, `${this.name}.json`), JSON.stringify(man, null, 1) + '\n');
    const tris = Object.values(this.models).reduce((s, m) => s + m.indices / 3, 0);
    console.log(`${this.name.padEnd(13)} ${String(Object.keys(this.models).length).padStart(4)} models ${String(tris).padStart(8)} tris ${(this.bytes / 1e6).toFixed(2).padStart(7)} MB raw ${(this.gz / 1e6).toFixed(2).padStart(6)} MB gz`);
  }
}

const fakeGame = { scene: { add() {} }, events: { on() {} } };

// ---- units: one mesh per rig part, pivot at the part's joint --------------
// rig: { voxel, anim (animation family), style, parts: [{ name, anim (channel),
//   joint: [x,y,z] in voxels (x rig voxel = world units) relative to the parent
//   joint (or the unit origin at the feet), parent, parentIdx, coat, portrait,
//   conditional }] }. Parts are listed parents first. `conditional` parts have
//   a show(u) rule in src/units/models.js (tools, carried goods, gear
//   variants): the Godot units piece reimplements those rules.
{
  const g = new Group('units');
  g.extra.rigs = {};
  const host = { rigs: new Map() };
  for (const type of Object.keys(RIGS)) {
    Units.prototype._buildRig.call(host, type);
    const rig = host.rigs.get(type);
    const R = RIGS[type];
    g.extra.rigs[type] = {
      voxel: R.voxel, anim: R.anim, style: R.style, euler: 'XYZ',
      parts: rig.parts.map((p) => ({
        name: p.name, anim: p.anim, joint: p.joint, parent: p.parent, parentIdx: p.parentIdx,
        coat: p.coat, portrait: p.portrait, conditional: !!p.show, mesh: `${type}/${p.name}`,
      })),
    };
    for (const p of rig.parts) g.add(`${type}/${p.name}`, p.geo);
  }
  g.extra.unitTypes = Object.keys(UNIT_DEFS);
  g.write();
}

// ---- buildings: every type x visual variant, and construction stages ------
{
  const g = new Group('buildings');
  const c = new Group('construction');
  c.extra.stages = CONSTRUCTION_STAGES;
  const host = { geos: new Map() };
  const variants = {};
  for (const type of Object.keys(BUILDING_DEFS)) {
    const nv = BUILDING_VARIANTS[type] || 1;
    variants[type] = nv;
    for (let v = 0; v < nv; v++) {
      g.add(`${type}/${v}`, Buildings.prototype.geometry.call(host, type, v));
      for (let s = 0; s < CONSTRUCTION_STAGES; s++) c.add(`${type}/${v}/${s}`, Buildings.prototype.stageGeometry.call(host, type, v, s));
    }
  }
  g.extra.variants = variants;
  g.write();
  c.write();
}

// ---- town props (well, stoa, statues, ...) ---------------------------------
{
  const g = new Group('props');
  const host = { geos: new Map() };
  for (const kind of PROP_KINDS) g.add(kind, Props.prototype.geometry.call(host, kind));
  g.write();
}

// ---- resources (trees 0..9, gold mine, berry bush) + shadow-only shapes ---
{
  const g = new Group('resources');
  const host = { geos: new Map(), shapes: new Map() };
  for (const key of [...Array.from({ length: 10 }, (_, i) => `tree${i}`), 'gold', 'berry']) {
    g.add(key, ResourceRenderer.prototype.geometry.call(host, key));
    g.add(`${key}_shape`, host.shapes.get(key), { shadowOnly: true });
  }
  g.write();
}

// ---- ground details (grass tufts, flowers, pebbles) ------------------------
{
  const g = new Group('details');
  const mk = (model, seed) => GroundDetails.prototype._geo.call(null, model, seed);
  for (let i = 0; i < 5; i++) g.add(`tuft${i}`, mk(TM.makeGrassTuft(i), 1));
  for (let i = 0; i < 4; i++) g.add(`flowers${i}`, mk(TM.makeFlowers(i), 2));
  for (let i = 0; i < 3; i++) g.add(`pebbles${i}`, mk(TM.makePebbles(i), 3));
  g.write();
}

// ---- economy (animals, boats, crops, stockpiles, loads) --------------------
{
  const g = new Group('economy');
  const view = new EconomyView(fakeGame, {});
  for (const [key, b] of view.r.batches) {
    const { model, size, pivot } = b.factory();
    const { buildVoxelGeometry } = await src('core/voxel.js');
    g.add(key, buildVoxelGeometry(model, { size, pivot, jitter: 0.06 }), { shadow: b.shadow });
  }
  g.write();
}

// ---- combat (arrow, battlefield debris) ------------------------------------
{
  const g = new Group('combat');
  const proj = new Projectiles(fakeGame, {});
  g.add('arrow', proj.mesh.geometry);
  const deb = new Debris(fakeGame);
  for (const [k, v] of deb.kinds) g.add(`debris_${k}`, v.geo || v.mesh?.geometry || v.geometry || v);
  g.write();
}
