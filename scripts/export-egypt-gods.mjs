// Export the Egyptian gods' extra voxel rigs (Godot-only) to godot/assets/models/egypt_gods
// (json + bin.gz, the format of export-egypt-units.mjs, which VoxelModels.rig() falls back to
// after "units" and "egypt_units"):
//   serpent      Plague of Serpents' Serpent (Retold: an animal, a desert cobra rising out of
//                the sand), a little larger than a man: banded venom-green scales with black
//                saddles (the power's green: it reads on the sand and in a red Greek line), a
//                yellow belly, a hood with the army's colour, glowing red eyes and white fangs; the Wadjet's serpent pose
//                (anim 'medusa', pose 'serpent': coil, tailA..C, torso) without its wings
//   phoenix_egg  the Phoenix's Rebirth egg: a gold-and-ember egg with glowing cracks and a
//                team band, on a ring of charred nest twigs and hot coals (anim 'siege': still)
// Same palette rules as export-egypt-units.mjs (sRGB hex, TEAM voxels tinted by the shader,
// glow in extra.g); one outline width (0.3) as every Egyptian unit.
//
//   node scripts/export-egypt-gods.mjs [--out godot/assets/models]
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
    console.log(`${this.name.padEnd(13)} ${String(Object.keys(this.models).length).padStart(4)} models ${String(tris).padStart(8)} tris ${(gz.length / 1e6).toFixed(2)} MB gz`);
  }
}

const RIGS = {};
const part = (name, model, pivot, joint, parent = null, extra = {}) => ({ name, model, pivot, joint, parent, ...extra });
const rig = (type, meta, parts) => { RIGS[type] = { ...meta, parts }; };
const TEAM_SHADE = 0xb4b4b4;
const tset = (m, x, y, z, base) => { m.set(x, y, z, TEAM); m.get(x, y, z).c = base; return m; };

// ---- the Serpent (0.12) ------------------------------------------------------------------
{
  // banded scales: venom green with black saddles every 4 voxels along the body, dark flecks
  const band = (i) => (Math.floor(i / 4) % 2 === 0);
  const SC = (x, y, i) => {
    const h = hash3(x, y, i, 71);
    if (band(i)) return h < 0.5 ? 0x16220c : 0x101a08;   // near-black saddle
    return h < 0.4 ? 0x4e8e26 : h < 0.8 ? 0x447e20 : 0x5a9c2e; // venom green (the power's colour: reads on the sand and against a red army)
  };
  const BELLY = 0xe8dc78, BELLY_SH = 0xbcae58; // a yellow belly
  // a low coil, one and a half turns lying on the sand, the neck rising out of its middle
  const coil = new VoxelModel();
  for (let a = 0; a < 40; a++) {
    const th = (a / 40) * Math.PI * 2 * 1.25;
    const rr = 4.6 - a * 0.05;
    const cx = Math.sin(th) * rr, cz = Math.cos(th) * rr - 1;
    const yy = a > 28 ? 1 + (a - 28) * 0.25 : 1;
    for (let y = -2; y <= 2; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (dx * dx + dz * dz + y * y > 4.2) continue;
      const vy = Math.round(yy + y);
      coil.set(Math.round(cx + dx), vy, Math.round(cz + dz), y <= -1 ? (y === -2 ? BELLY_SH : BELLY) : SC(dx, y, a));
    }
  }
  // the neck rising (into the torso's joint)
  for (let y = 2; y <= 7; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    if (x * x + z * z > 3.2) continue;
    coil.set(x, y, z + 1, z >= 1 ? BELLY : SC(x, z, 40 + y));
  }
  // the tail: three tapering segments trailing behind (the rig sways them)
  const seg = (len, r0, r1, i0) => {
    const m = new VoxelModel();
    for (let z = 0; z < len; z++) {
      const r = r0 + (r1 - r0) * (z / len);
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++)
        if (x * x + y * y <= r * r + 0.3) m.set(x, y, -z, y < -r * 0.4 ? BELLY : SC(x, y, i0 + z));
    }
    return m;
  };
  // the raised head: a slim scaled neck (a thin cream throat stripe), a cobra's hood spread
  // wide (its front pale with dark throat bars, its back the army's colour), a small wedge
  // head of dark olive with glowing red eyes, white fangs and a flicker of tongue
  const head = new VoxelModel();
  for (let y = 0; y <= 9; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (x * x + z * z > 1.6) continue;
    head.set(x, y, z, z >= 1 && x === 0 ? BELLY : SC(x, z, 60 + y));
  }
  for (let y = 3; y <= 9; y++) {
    const w = Math.round(3.6 - Math.abs(y - 6.5) * 0.65);
    for (let x = -w; x <= w; x++) {
      const edge = Math.abs(x) >= w;
      if (edge) head.set(x, y, -1, 0x241608);
      else if ((x + y) % 2) head.set(x, y, -1, TEAM);   // the hood's back: the army's colour
      else tset(head, x, y, -1, TEAM_SHADE);
      // the hood's front: pale scales, dark bars across the throat
      head.set(x, y, 0, edge ? 0x241608 : (y === 4 || y === 7) ? 0x2a1a0c : Math.abs(x) <= 1 ? BELLY : 0xa8c050);
    }
  }
  const HD = (x, y, z) => { const h = hash3(x, y, z, 77); return y >= 11 ? (h < 0.5 ? 0x24400e : 0x2c4a12) : (h < 0.5 ? 0x3e6a1c : 0x365e18); };
  head.box(-1, 10, -1, 3, 2, 4, HD);
  head.box(-1, 10, 3, 3, 1, 1, HD);
  head.set(0, 11, 3, 0x24400e);
  head.set(-2, 11, 1, 0xff2a10, { glow: 0.9 }).set(2, 11, 1, 0xff2a10, { glow: 0.9 });
  head.set(-1, 9, 3, 0xfaf4e8).set(1, 9, 3, 0xfaf4e8);   // fangs
  head.set(0, 10, 4, 0xc02020);                          // a flicker of tongue
  rig('serpent', { voxel: 0.12, anim: 'medusa', style: 'serpent', pose: 'serpent' }, [
    part('coil', coil, [0, 0, 0], [0, 0, 0]),
    part('tailA', seg(7, 2.0, 1.6, 100), [0, 0, 0], [-3, 1, -5], 'coil'),
    part('tailB', seg(7, 1.6, 1.0, 107), [0, 0, 0], [0, 0, -7], 'tailA'),
    part('tailC', seg(7, 1.0, 0.3, 114), [0, 0, 0], [0, 0, -7], 'tailB'),
    part('torso', head, [0, 0, 0], [0, 7, 1], 'coil'),
  ]);
}

// ---- the Phoenix Egg (0.08) ----------------------------------------------------------------
{
  // the shell: deep gold to ember orange from the top down, a team band round its waist,
  // cracks of white-hot fire (glow) where the new Phoenix stirs
  const egg = new VoxelModel();
  const RX = 4.2, RY = 6.2;
  const cracks = (x, y, z) => {
    // three jagged cracks winding up the shell
    const a = Math.atan2(z, x);
    for (let k = 0; k < 3; k++) {
      const ca = k * 2.09 + Math.sin(y * 0.9 + k) * 0.35;
      let d = Math.abs(a - ca);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < 0.13 && y > 2 && y < 10 && x * x + z * z >= 9) return true;
    }
    return false;
  };
  for (let y = 0; y <= 13; y++) for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    const yy = y - 6.2;
    const rx = RX * (yy > 0 ? 1 - yy * 0.035 : 1);   // narrower at the top
    if ((x * x + z * z) / (rx * rx) + (yy * yy) / (RY * RY) > 1) continue;
    const h = hash3(x, y, z, 97);
    if (cracks(x, y, z)) { egg.set(x, y, z, h < 0.5 ? 0xffd040 : 0xff9a20, { glow: 0.7 }); continue; }
    if (y === 6) { egg.set(x, y, z, TEAM); continue; }
    if (y === 7) { tset(egg, x, y, z, TEAM_SHADE); continue; }
    const top = y / 13;
    // the Phoenix's fire colours (export-egypt-units.mjs FIRE), deep so the grade keeps them
    const c = top > 0.72 ? (h < 0.5 ? 0xa87404 : 0x986804) : top > 0.45 ? (h < 0.5 ? 0x9a420c : 0x8c3a0a) : (h < 0.5 ? 0x6a160a : 0x5a1208);
    egg.set(x, y, z, c);
  }
  // a small flame crest on the tip
  egg.set(0, 14, 0, 0xffe070, { glow: 1 }).set(0, 15, 0, 0xff9a20, { glow: 1 });
  // the nest: charred twigs in a ring, hot coals between them, ash
  const nest = new VoxelModel();
  for (let a = 0; a < 48; a++) {
    const th = (a / 48) * Math.PI * 2;
    for (const r of [4.6, 5.6, 6.4]) {
      const x = Math.round(Math.cos(th) * r), z = Math.round(Math.sin(th) * r);
      const h = hash3(x, a, z, 98);
      const y = r > 6 ? 0 : (h < 0.5 ? 1 : 0);
      nest.set(x, y, z, h < 0.3 ? 0x2a1a10 : h < 0.6 ? 0x3c2616 : h < 0.85 ? 0x1c120c : 0x504034);
      if (h > 0.82) nest.set(x, y + 1, z, 0x241810);
    }
  }
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    const d = Math.hypot(x, z);
    if (d > 6.2 || d < 2.5) continue;
    const h = hash3(x, 0, z, 99);
    if (h < 0.22) nest.set(x, 0, z, h < 0.1 ? 0xff7a18 : 0xd84a10, { glow: 0.9 });   // coals
    else if (!nest.has(x, 0, z)) nest.set(x, 0, z, h < 0.6 ? 0x5a5048 : 0x6a6056);   // ash
  }
  rig('phoenix_egg', { voxel: 0.08, anim: 'siege', style: 'egg' }, [
    part('frame', nest, [0, 0, 0], [0, 0, 0]),
    part('body', egg, [0, 0, 0], [0, 1, 0], 'frame'),
  ]);
}

// ---- write ---------------------------------------------------------------------------------
const g = new Group('egypt_gods');
g.extra.rigs = {};
for (const [type, R] of Object.entries(RIGS)) {
  const parts = R.parts.map((p) => ({ ...p, anim: p.anim || p.name }));
  for (const p of parts) p.parentIdx = p.parent ? parts.findIndex((q) => q.name === p.parent) : -1;
  const { parts: _p, ...meta } = R;
  g.extra.rigs[type] = {
    ...meta, euler: 'XYZ',
    parts: parts.map((p) => ({
      name: p.name, anim: p.anim, joint: p.joint, parent: p.parent, parentIdx: p.parentIdx,
      coat: false, portrait: true, conditional: false, mesh: `${type}/${p.name}`,
    })),
  };
  for (const p of parts)
    g.add(`${type}/${p.name}`, buildVoxelGeometry(p.model, { size: R.voxel, pivot: p.pivot, jitter: 0.05, ao: true }), { outline: 0.3 });
}
g.extra.unitTypes = Object.keys(RIGS);
g.write();
