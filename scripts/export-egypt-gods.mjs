// Export the Egyptian gods' extra voxel rigs (Godot-only) to godot/assets/models/egypt_gods
// (json + bin.gz, the format of export-egypt-units.mjs, which VoxelModels.rig() falls back to
// after "units" and "egypt_units"):
//   serpent      Plague of Serpents' Serpent (Retold: an animal, a desert cobra rising out of
//                the sand; power_07.jpg), a little larger than a man: olive grey-green scales in a
//                dark net with blotches of the army's colour along the back, a yellow belly up the
//                front of an S neck, a broad scaled hood, dark eyes, an open pink mouth; the Wadjet's serpent pose
//                (anim 'medusa', pose 'serpent': coil, tailA..C, torso) without its wings
//   phoenix_egg  the Phoenix's Rebirth egg: a gold-and-ember egg with glowing cracks and a
//                team band, on a ring of charred nest twigs and hot coals (anim 'siege': still)
//   citadel      Sekhmet's Citadel (a static model, voxel 1/8 tile as the Egyptian buildings,
//                pivot at the footprint centre): the fortress that rises round a Town Center made
//                a Citadel Center: battered sandstone curtain walls with a crenellated parapet just
//                outside the 7x7 footprint, four massive corner bastions crowned with a gilt cavetto
//                cornice, merlons and a burning brazier, a gate between two pylons at the front with
//                Sekhmet's red banners and a winged gold sun disc, team bands; drawn by
//                game/godpowers/egypt_fx.gd over every Citadel Center (it rises out of the ground
//                in the cast)
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
  // Retold's cobra (reference/egypt/power_07.jpg): olive grey-green scales in a dark
  // reticulated net, big blotches of the army's colour along the back (power_07's "green and
  // blue" cobras), a yellow belly running up the front of the neck, a broad scaled hood, a
  // small wedge head with dark eyes and an open pink mouth; the neck rises tall in an S
  const SCALE = (x, y, i) => {
    const h = hash3(x, y, i, 71);
    if (((x + 2 * y + i) % 3 + 3) % 3 === 0) return h < 0.5 ? 0x343a22 : 0x2c321c;   // the dark net between scales
    return h < 0.35 ? 0x6c7848 : h < 0.7 ? 0x5e6a3e : 0x76825a;                       // olive grey-green
  };
  // the team blotches: 3 of every 6 voxels along the back, net-broken like the scales
  const blot = (i) => ((i % 6) + 6) % 6 < 3;
  const SC = (m, x, y, z, xx, yy, i) => {
    if (blot(i) && yy >= 0 && ((xx + yy + i) % 3 + 3) % 3 !== 0) {
      if (hash3(xx, yy, i, 72) < 0.55) m.set(x, y, z, TEAM); else tset(m, x, y, z, TEAM_SHADE);
    } else m.set(x, y, z, SCALE(xx, yy, i));
  };
  const BELLY = 0xd8c45c, BELLY_SH = 0xb09c40, BELLY_BAR = 0x8a7a30; // a yellow belly in broad plates
  const belly = (i) => (i % 3 === 0 ? BELLY_BAR : BELLY);
  // a low coil, one and a quarter turns lying on the sand, the neck rising out of its middle
  const coil = new VoxelModel();
  for (let a = 0; a < 40; a++) {
    const th = (a / 40) * Math.PI * 2 * 1.25;
    const rr = 4.6 - a * 0.05;
    const cx = Math.sin(th) * rr, cz = Math.cos(th) * rr - 1;
    const yy = a > 28 ? 1 + (a - 28) * 0.25 : 1;
    for (let y = -2; y <= 2; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (dx * dx + dz * dz + y * y > 4.2) continue;
      const vx = Math.round(cx + dx), vy = Math.round(yy + y), vz = Math.round(cz + dz);
      if (y <= -1) coil.set(vx, vy, vz, y === -2 ? BELLY_SH : belly(a));
      else SC(coil, vx, vy, vz, dx, y, a);
    }
  }
  // the neck rising (into the torso's joint)
  for (let y = 2; y <= 7; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    if (x * x + z * z > 3.2) continue;
    if (z >= 1) coil.set(x, y, z + 1, belly(y + 40)); else SC(coil, x, y, z + 1, x, z + 2, 40 + y);
  }
  // the tail: three tapering segments trailing behind (the rig sways them)
  const seg = (len, r0, r1, i0) => {
    const m = new VoxelModel();
    for (let z = 0; z < len; z++) {
      const r = r0 + (r1 - r0) * (z / len);
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        if (x * x + y * y > r * r + 0.3) continue;
        if (y < -r * 0.4) m.set(x, y, -z, belly(i0 + z)); else SC(m, x, y, -z, x, y + 2, i0 + z);
      }
    }
    return m;
  };
  // the raised neck and head: the neck an S (back, then forward under the head), the yellow
  // belly plates up its front, the hood spread wide behind the head (scaled olive with the dark
  // net, a darker rim, the yellow throat in front with two dark bars), the head a small wedge
  const head = new VoxelModel();
  const NZ = (y) => Math.round(-1.4 * Math.sin((y / 11) * Math.PI * 1.3));   // the S
  for (let y = 0; y <= 11; y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (x * x + z * z > 1.6) continue;
    const vz = z + NZ(y);
    if (z >= 1) head.set(x, y, vz, belly(60 + y)); else SC(head, x, y, vz, x, z + 2, 60 + y);
  }
  for (let y = 4; y <= 11; y++) {
    const w = Math.round(4.2 - Math.abs(y - 8) * 0.75);
    if (w < 2) continue;
    const zb = NZ(y);
    for (let x = -w; x <= w; x++) {
      const edge = Math.abs(x) >= w;
      const h = hash3(x, y, 0, 73);
      // the hood's back: scales in the net, a darker rim
      head.set(x, y, zb - 1, edge ? 0x2a301a : (((x + 2 * y) % 3 + 3) % 3 === 0 ? 0x30361e : h < 0.5 ? 0x6c7848 : 0x5e6a3e));
      // its front: the yellow throat in the middle, olive scales out to the rim, two dark bars
      if (Math.abs(x) <= 1) head.set(x, y, zb, y === 6 || y === 9 ? 0x3a3418 : BELLY);
      else head.set(x, y, zb, edge ? 0x2a301a : h < 0.5 ? 0x8a9460 : 0x7c8652);
    }
  }
  const zh = NZ(11);
  const HD = (x, y, z) => { const h = hash3(x, y, z, 77); return y >= 13 ? (h < 0.5 ? 0x4c5632 : 0x56603a) : (h < 0.5 ? 0x68744a : 0x5e6a40); };
  head.box(-1, 12, zh - 1, 3, 2, 4, HD);      // the skull
  head.box(-1, 12, zh + 3, 3, 1, 1, HD);      // the snout
  head.set(0, 13, zh + 3, 0x4c5632);
  head.set(-2, 13, zh + 1, 0x14140c).set(2, 13, zh + 1, 0x14140c);   // dark eyes
  head.box(-1, 11, zh + 1, 3, 1, 3, () => 0xc86a78);                  // the open mouth, pink
  head.set(-1, 11, zh + 3, 0xfaf4e8).set(1, 11, zh + 3, 0xfaf4e8);   // fangs
  head.box(-1, 10, zh, 3, 1, 3, () => BELLY_SH);                      // the lower jaw
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

// ---- Sekhmet's Citadel (0.125, static) ------------------------------------------------------------
const STATIC = {};
{
  const m = new VoxelModel();
  const pick = (h, a) => a[Math.min(a.length - 1, Math.floor(h * a.length))];
  // sandstone in courses of 4 rows, blocks 6 long, a darker bed joint; a dark plinth; limestone string courses
  const STONE = (x, y, z) => {
    const course = y >> 2, along = (x + z + (course & 1) * 3);
    const h = hash3(Math.floor(along / 6), course, (x * 7 + z * 13) >> 4, 81);
    const c = pick(h, [0xe2c491, 0xd8b680, 0xcca874, 0xdcbd8a]);
    if ((y & 3) === 3) return 0xb8955f;                       // bed joint
    if (((along % 6) + 6) % 6 === 0) return 0xc29d68;          // head joint
    return c;
  };
  const PLINTH = (x, y, z) => pick(hash3(x >> 1, y, z >> 1, 82), [0x8a6e4a, 0x7f6443, 0x947852]);
  const LIME = (x, y, z) => pick(hash3(x, y, z, 83), [0xf1e6cf, 0xe6d8bb, 0xeadcc1]);
  const GILT = 0xdcab3c, GILT_L = 0xf3cf5e, GILT_D = 0xa8782a;
  const RED = 0xa8281c, RED_D = 0x7e1c14, DARK = 0x221c18, BASALT = 0x343a3c;
  const FIRE = [0xffd040, 0xff9a20, 0xff7010];
  const WALL_H = 16;            // curtain wall walk height (2 tiles)
  const IN = 29, OUT = 34;      // |c| range of the curtain wall (the footprint ends at 28)
  const absc = (v) => Math.abs(v + 0.5);
  // the curtain walls: a battered outer face (it leans in 1 voxel every 6 rows), merlons on the outer edge
  for (let x = -38; x < 38; x++) for (let z = -38; z < 38; z++) {
    const ax = absc(x), az = absc(z), r = Math.max(ax, az);
    if (r < IN) continue;
    for (let y = 0; y < WALL_H + 4; y++) {
      const out = OUT - Math.floor(y / 6) - 0.5;
      if (r > out) continue;
      const along = ax >= az ? z : x;            // position along this wall
      const gate = az >= ax && z >= 0 && absc(along) < 6;
      if (gate && y < 22) continue;              // the gate passage (the lintel above)
      if (y >= WALL_H) {
        // parapet: the outer 2 voxels, merlons 2 on / 2 off above a solid course
        if (r < out - 2) continue;
        if (y >= WALL_H + 1 && (((along >> 1) % 2) + 2) % 2 === 1) continue;
      }
      let c;
      if (y < 3) c = PLINTH(x, y, z);
      else if (y === 11 || y === WALL_H - 1) c = LIME(x, y, z);
      else if ((y === 12 || y === 13) && r >= out - 1) c = TEAM;
      else c = STONE(x, y, z);
      m.set(x, y, z, c);
    }
  }
  // the gate lintel (y 16..22) and its winged sun disc
  for (let x = -6; x < 6; x++) for (let z = IN; z < OUT - 2; z++) for (let y = 16; y < 23; y++)
    m.set(x, y, z, y === 22 ? LIME(x, y, z) : STONE(x, y, z));
  for (let x = -8; x < 8; x++) for (let y = 17; y < 21; y++) {
    const ax = absc(x), cy = y - 18.5;
    const disc = ax * ax + cy * cy * 1.6 <= 4.2;
    const wing = ax >= 2 && ax < 8 && y >= 18 + Math.floor((ax - 2) / 3) && y < 21;
    if (disc) m.set(x, y, OUT - 2, ax < 1 && y === 20 ? RED : GILT_L);
    else if (wing) m.set(x, y, OUT - 2, ((ax | 0) + y) % 2 ? GILT : GILT_D);
  }
  // the gate's doors, set back in the passage
  for (let x = -6; x < 6; x++) for (let y = 0; y < 16; y++) m.set(x, y, IN, (x === -1 || x === 0) ? DARK : (y % 4 === 0 ? 0x5a3b22 : 0x7d4624));
  // the corner bastions: 16 x 16 at the foot tapering 1 voxel every 8 rows, 34 rows, a gilt
  // cavetto cornice, merlons, slit windows, a red banner on each outer face, a brazier on top
  const TOWER_H = 32;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * 33, cz = sz * 33;
    for (let y = 0; y < TOWER_H + 5; y++) {
      let hw = 8 - Math.floor(Math.min(y, TOWER_H - 1) / 8);
      if (y >= TOWER_H - 3 && y < TOWER_H) hw += y - (TOWER_H - 4);   // the cornice flares out
      if (y >= TOWER_H) hw = 8 - Math.floor((TOWER_H - 1) / 8) + 3;
      for (let dx = -hw; dx < hw; dx++) for (let dz = -hw; dz < hw; dz++) {
        const ex = dx === -hw || dx === hw - 1, ez = dz === -hw || dz === hw - 1;
        const x = cx + dx, z = cz + dz;
        if (y >= TOWER_H) {           // the crown: merlons round the edge, the floor inside
          if (y > TOWER_H && !(ex || ez)) continue;
          if (y > TOWER_H && (((dx + dz) >> 1) & 1)) continue;
          m.set(x, y, z, y === TOWER_H ? GILT_D : STONE(x, y, z));
          continue;
        }
        let c;
        if (y < 3) c = PLINTH(x, y, z);
        else if (y >= TOWER_H - 3) c = y === TOWER_H - 1 ? GILT_L : y === TOWER_H - 2 ? GILT : GILT_D;
        else if (y === TOWER_H - 4) c = LIME(x, y, z);
        else if (y === 11 || y === 22) c = LIME(x, y, z);
        else if ((y === 12 || y === 13) && (ex || ez)) c = TEAM;
        else c = STONE(x, y, z);
        // slit windows in the middle of every face
        if ((ex && Math.abs(dz + 0.5) < 1 || ez && Math.abs(dx + 0.5) < 1) && y >= 16 && y < 20) c = DARK;
        m.set(x, y, z, c);
      }
    }
    // Sekhmet's red banners down each outward face: a gilt pole, red cloth with a gold sun disc
    for (const face of ['x', 'z']) {
      const hwB = 8 - Math.floor(26 / 8);
      for (let y = 9; y < 27; y++) for (let t = -3; t < 3; t++) {
        const fx = face === 'x' ? cx + sx * (sx > 0 ? hwB : hwB + 1) : cx + t + (sx > 0 ? -2 : 2);
        const fz = face === 'z' ? cz + sz * (sz > 0 ? hwB : hwB + 1) : cz + t + (sz > 0 ? -2 : 2);
        const ty = y - 21.5, tt = t + 0.5;
        let c = (t === -3 || t === 2) ? GILT_D : RED;
        if (y === 26) c = GILT;
        if (tt * tt + ty * ty <= 3.2) c = GILT_L;
        if (y < 11 && ((t + y) & 1)) continue;           // the fringe
        if (y < 12 && c === RED) c = RED_D;
        m.set(fx, y, fz, c);
      }
    }
    // the brazier: a basalt bowl on the bastion's roof, heaped with fire
    for (let dx = -3; dx < 3; dx++) for (let dz = -3; dz < 3; dz++) {
      const rim = dx === -3 || dx === 2 || dz === -3 || dz === 2;
      m.set(cx + dx, TOWER_H + 1, cz + dz, BASALT);
      if (rim) { m.set(cx + dx, TOWER_H + 2, cz + dz, (dx + dz) & 1 ? BASALT : GILT_D); continue; }
      m.set(cx + dx, TOWER_H + 2, cz + dz, FIRE[2], { glow: 0.95 });
      m.set(cx + dx, TOWER_H + 3, cz + dz, FIRE[1], { glow: 0.95 });
      if (dx >= -1 && dx <= 0 && dz >= -1 && dz <= 0) {
        m.set(cx + dx, TOWER_H + 4, cz + dz, FIRE[0], { glow: 0.95 });
        if (dx === dz) m.set(cx + dx, TOWER_H + 5, cz + dz, FIRE[0], { glow: 0.95 });
      }
    }
  }
  // the gate pylons: 10 wide, 12 deep, 30 rows, battered on the outer sides, a gilt cornice, a
  // red banner on the front with a gold sun disc, the team band
  const PY_H = 30;
  for (const sx of [-1, 1]) {
    for (let y = 0; y < PY_H + 3; y++) {
      const lean = Math.floor(y / 7);
      let x0 = 6, x1 = 17 - lean, z0 = 28, z1 = 38 - Math.floor(lean / 2);
      if (y >= PY_H - 2) { x1 += y - (PY_H - 3); z1 += y - (PY_H - 3); }
      if (y >= PY_H) { x1 = 17 - Math.floor((PY_H - 1) / 7) + 2; z1 = 38 - Math.floor(Math.floor((PY_H - 1) / 7) / 2) + 2; }
      for (let a = x0; a < x1; a++) for (let z = z0; z < z1; z++) {
        const x = sx > 0 ? a : -1 - a;
        if (y >= PY_H) {
          const edge = a === x0 || a === x1 - 1 || z === z0 || z === z1 - 1;
          if (y > PY_H && (!edge || ((a + z) >> 1) & 1)) continue;
          m.set(x, y, z, y === PY_H ? GILT_D : STONE(x, y, z));
          continue;
        }
        let c;
        if (y < 3) c = PLINTH(x, y, z);
        else if (y >= PY_H - 2) c = y === PY_H - 1 ? GILT_L : GILT;
        else if (y === PY_H - 3 || y === 11) c = LIME(x, y, z);
        else if ((y === 12 || y === 13) && (z === z1 - 1 || a === x1 - 1)) c = TEAM;
        else c = STONE(x, y, z);
        m.set(x, y, z, c);
      }
    }
    // the banner on the pylon's front
    const zf = 38 - Math.floor(Math.floor(24 / 7) / 2);
    for (let y = 8; y < 26; y++) for (let a = 9; a < 14; a++) {
      const x = sx > 0 ? a : -1 - a;
      const ty = y - 20.5, ta = a - 11;
      let c = (a === 9 || a === 13) ? GILT_D : RED;
      if (y === 25) c = GILT;
      if (ta * ta + ty * ty <= 3.2) c = GILT_L;
      if (y < 10 && ((a + y) & 1)) continue;
      if (y < 11 && c === RED) c = RED_D;
      m.set(x, y, zf, c);
    }
  }
  STATIC['citadel'] = { model: m, voxel: 0.125 };
}

// ---- write ---------------------------------------------------------------------------------
const g = new Group('egypt_gods');
for (const [name, S] of Object.entries(STATIC))
  g.add(name, buildVoxelGeometry(S.model, { size: S.voxel, pivot: [0, 0, 0], jitter: 0.05, ao: true }), { outline: 1 });
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
