import * as THREE from 'three';
import { hash3 } from '../core/rng.js';

// Smooth (non-voxel) parts of the building models: sloped tile roofs with
// fine shingled courses, smooth triangular pediments with raking cornices,
// domes and round shafts. Voxels cannot draw a clean 20-degree roof line (it
// comes out as stairs that read as crenellations), so roofs and domes are
// emitted as flat-shaded polygons in the same voxel coordinate space and
// merged into the building geometry with the same attributes as the voxel
// mesher (position, normal, color, team, glow).
//
// Everything is recorded on `m.extra` of the VoxelModel; coordinates are in
// voxels (a voxel spans [x, x+1)). `withExtras(geo, model, size, pivot)`
// appends them to a geometry built by buildVoxelGeometry.

const _c = new THREE.Color();
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function ext(m) {
  return m.extra || (m.extra = { pos: [], nor: [], col: [], polys: [] });
}

// Convex planar polygon (3 or 4 points, [x,y,z]). `out` is a rough outward
// direction used to fix the winding; `shade` darkens per vertex (array).
export function poly(m, pts, color, { out = null, normals = null, shade = null } = {}) {
  const E = ext(m);
  const p = pts.map(V3);
  const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
  if (n.lengthSq() < 1e-10 && p.length === 4) n.subVectors(p[2], p[0]).cross(new THREE.Vector3().subVectors(p[3], p[0]));
  if (n.lengthSq() < 1e-10) return;
  n.normalize();
  let order = p.map((_, i) => i);
  const ref = out ? V3(out) : normals ? normals.reduce((a, q) => a.add(V3(q)), new THREE.Vector3()) : null;
  if (ref && n.dot(ref) < 0) { order = order.reverse(); n.negate(); }
  const cols = Array.isArray(color) ? color : p.map(() => color);
  const tri = (a, b, c) => {
    for (const i of [a, b, c]) {
      const q = p[i];
      E.pos.push(q.x, q.y, q.z);
      if (normals) E.nor.push(...normals[i]); else E.nor.push(n.x, n.y, n.z);
      _c.setHex(cols[i]);
      const s = shade ? shade[i] : 1;
      E.col.push(_c.r * s, _c.g * s, _c.b * s);
    }
  };
  tri(order[0], order[1], order[2]);
  if (p.length === 4) tri(order[0], order[2], order[3]);
  // remember the polygon (in voxel space) for construction clipping
  E.polys.push(E.pos.length);
}

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add3 = (a, n, s) => [a[0] + n[0] * s, a[1] + n[1] * s, a[2] + n[2] * s];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
function normal3(a, b, c, up) {
  const u = sub3(b, a), v = sub3(c, a);
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = len3(n) || 1;
  n = n.map((q) => q / l);
  if (up && n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < 0) n = n.map((q) => -q);
  return n;
}

// Mix two hex colours.
export function mix(a, b, t) {
  const ch = (c, s) => (c >> s) & 255;
  const r = Math.round(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t);
  const g = Math.round(ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t);
  const bl = Math.round(ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
  return (r << 16) | (g << 8) | bl;
}
export const shadeHex = (c, f) => mix(0, c, Math.min(1, f)) | 0;

// Muted roof tile palettes (2-3 fired hues each; the butt line of every
// course is a darker line, the eave fascia darker still).
export const TILES = {
  terra: { tones: [0xc27a5b, 0xb46c50, 0xcd8a6a], butt: 0x8c4f3a, fascia: 0x7b4634, ridge: 0x9e5a41, soffit: 0x4a3a30 },
  rose: { tones: [0xc98c72, 0xbd7f66, 0xd49a80], butt: 0x946050, fascia: 0x80523f, ridge: 0xa86d58, soffit: 0x4a3a30 },
  umber: { tones: [0xae6e55, 0xa0634c, 0xba7b60], butt: 0x7c4a38, fascia: 0x6c4232, ridge: 0x8e5540, soffit: 0x45362c },
  slate: { tones: [0xbcc7b1, 0xafbba4, 0xc9d1be], butt: 0x86927c, fascia: 0x75806c, ridge: 0x95a28c, soffit: 0x4a4540 },
};

// A tiled roof plane: eave edge e0-e1 (low), top edge r0-r1 (r0 above e0;
// r0 == r1 for a triangle). Courses of shingles run parallel to the eave,
// each course's butt lifted `lip` voxels so a fine shadow line separates
// the rows; tiles within a course take one of the palette hues, offset by
// half a tile every other course. A fascia drops from the eave and the
// underside is closed with a dark soffit.
export function tiledPlane(m, e0, e1, r0, r1, { tiles = TILES.terra, course = 1.1, tileW = 1.4, lip = 0.2, fascia = 0.6, seed = 1, up = [0, 1, 0], closeUnder = true, eaveFascia = true } = {}) {
  const n = normal3(e0, e1, r0[0] === r1[0] && r0[1] === r1[1] && r0[2] === r1[2] ? r0 : r1, up);
  const slope = len3(sub3(lerp3(r0, r1, 0.5), lerp3(e0, e1, 0.5)));
  const N = Math.max(1, Math.round(slope / course));
  const T = tiles.tones;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const L0 = lerp3(e0, r0, t0), R0 = lerp3(e1, r1, t0), L1 = lerp3(e0, r0, t1), R1 = lerp3(e1, r1, t1);
    const wmid = len3(sub3(lerp3(L0, L1, 0.5), lerp3(R0, R1, 0.5)));
    const K = Math.max(1, Math.round(wmid / tileW));
    const off = (i & 1) ? 0.5 : 0;
    const cuts = [0];
    for (let j = 1; j <= K; j++) { const s = (j - off) / K; if (s > 0.02 && s < 0.98) cuts.push(s); }
    cuts.push(1);
    for (let j = 0; j + 1 < cuts.length; j++) {
      const a = cuts[j], b = cuts[j + 1];
      const c = T[Math.floor(hash3(i, j, seed, 57) * T.length) % T.length];
      const p0 = add3(lerp3(L0, R0, a), n, lip), p1 = add3(lerp3(L0, R0, b), n, lip);
      const p2 = lerp3(L1, R1, b), p3 = lerp3(L1, R1, a);
      // the lower courses read a touch darker (weathering toward the eave)
      poly(m, [p0, p1, p2, p3], c, { out: n, shade: [0.94, 0.94, 1, 1] });
    }
    // butt face of this course (its lifted lower edge)
    if (i > 0) poly(m, [L0, R0, add3(R0, n, lip), add3(L0, n, lip)], tiles.butt, { out: sub3(e0, r0) });
  }
  if (eaveFascia) {
    const d = [0, -fascia, 0];
    poly(m, [add3(e0, n, lip), add3(e1, n, lip), add3(e1, d, 1), add3(e0, d, 1)], tiles.fascia, { out: sub3(e0, r0) });
  }
  if (closeUnder) {
    // underside: a dark soffit a little below the tiles
    const dn = [0, -fascia, 0];
    const q = [add3(e0, dn, 1), add3(e1, dn, 1), add3(r1, dn, 0.5), add3(r0, dn, 0.5)];
    if (r0 === r1 || (r0[0] === r1[0] && r0[1] === r1[1] && r0[2] === r1[2])) q.splice(3, 1);
    poly(m, q, tiles.soffit, { out: [-n[0], -n[1], -n[2]] });
  }
  return n;
}

// Triangular prism ridge cap along a-b (horizontal), half-width w, height h.
export function ridgeCap(m, a, b, side, w, h, color) {
  const A1 = add3(a, side, w), A2 = add3(a, side, -w), B1 = add3(b, side, w), B2 = add3(b, side, -w);
  const At = [a[0], a[1] + h, a[2]], Bt = [b[0], b[1] + h, b[2]];
  poly(m, [A1, B1, Bt, At], color, { out: [side[0], 1, side[2]] });
  poly(m, [A2, B2, Bt, At], color, { out: [-side[0], 1, -side[2]] });
  const ax = sub3(a, b);
  poly(m, [A1, A2, At], shadeHex(color, 0.9), { out: ax });
  poly(m, [B1, B2, Bt], shadeHex(color, 0.9), { out: [-ax[0], -ax[1], -ax[2]] });
}

// Gable roof on a rectangular wall block [wx0, wx1) x [wz0, wz1) whose
// walls stop at `top`. `axis` is the ridge direction ('x' or 'z').
// pitch = rise / run. Eaves overhang `ov` voxels, gable ends `ovG`.
// ends: 'wall' fills the gable triangles with `fill`; 'pediment' builds a
// temple pediment (recessed tympanum inside a raking cornice); 'none'.
// Returns { ridgeY, eaveY, point(u, v) } in voxel space.
export function gableRoof(m, { wx0, wx1, wz0, wz1, top, axis = 'x', pitch = 0.38, ov = 1, ovG = 0.6, tiles = TILES.terra, ends = 'wall', fill = 0xeae4d6, rake = 0xf1ece2, rakeShade = 0xd6cfbf, tymp = 0x2f4570, seed = 1, course = 1.1, tileW = 1.4, pedDepth = 1, rakeH = 0.9 }) {
  // local frame: u across the ridge, v along it
  const alongX = axis === 'x';
  const u0 = alongX ? wz0 : wx0, u1 = alongX ? wz1 : wx1;
  const v0 = alongX ? wx0 : wz0, v1 = alongX ? wx1 : wz1;
  const P = (u, y, v) => (alongX ? [v, y, u] : [u, y, v]);
  const half = (u1 - u0) / 2, um = (u0 + u1) / 2;
  const ridgeY = top + pitch * half;
  const eaveY = top - pitch * ov;
  const va = v0 - ovG, vb = v1 + ovG;
  const upA = alongX ? [0, 1, -1] : [-1, 1, 0], upB = alongX ? [0, 1, 1] : [1, 1, 0];
  // the two slopes
  tiledPlane(m, P(u1 + ov, eaveY, va), P(u1 + ov, eaveY, vb), P(um, ridgeY, va), P(um, ridgeY, vb), { tiles, seed, up: upB, course, tileW });
  tiledPlane(m, P(u0 - ov, eaveY, vb), P(u0 - ov, eaveY, va), P(um, ridgeY, vb), P(um, ridgeY, va), { tiles, seed: seed + 5, up: upA, course, tileW });
  const lipY = 0.2 * Math.cos(Math.atan(pitch));
  ridgeCap(m, P(um, ridgeY + lipY * 0.5, va - 0.1), P(um, ridgeY + lipY * 0.5, vb + 0.1), alongX ? [0, 0, 1] : [1, 0, 0], 0.55, 0.45, tiles.ridge);
  const dirV = (s) => (alongX ? [s, 0, 0] : [0, 0, s]);
  for (const [vw, vEnd, s] of [[v0, va, -1], [v1, vb, 1]]) {
    if (ends === 'wall') {
      // gable wall flush with the wall face, verge board along the rake
      poly(m, [P(u0, top, vw), P(u1, top, vw), P(um, ridgeY, vw)], fill, { out: dirV(s) });
      const vv = vEnd;
      // verge: a thin board under the tile edge
      for (const [ue, sg] of [[u0 - ov, -1], [u1 + ov, 1]]) {
        const a = P(ue, eaveY, vv), b = P(um, ridgeY, vv);
        poly(m, [a, b, [b[0], b[1] - 0.6, b[2]], [a[0], a[1] - 0.6, a[2]]], tiles.fascia, { out: dirV(s) });
        void sg;
      }
    } else if (ends === 'pediment') {
      // A smooth pediment: the tympanum triangle sits in the wall plane,
      // the raking cornice is a flat marble band in the outer plane that
      // follows the roof line, and the horizontal geison under it is one
      // flat cornice line. The band's underside closes the recess.
      const vt = vw, vf = vEnd, H = rakeH;
      const uIn0 = u0 + H / pitch, uIn1 = u1 - H / pitch, yIn = ridgeY - H;
      poly(m, [P(uIn0, top, vt), P(uIn1, top, vt), P(um, yIn, vt)], tymp, { out: dirV(s) });
      for (const [uo, ui] of [[u0, uIn0], [u1, uIn1]]) {
        poly(m, [P(uo, top, vf), P(um, ridgeY + 0.2, vf), P(um, yIn, vf), P(ui, top, vf)], rake, { out: dirV(s) });
        poly(m, [P(ui, top, vf), P(um, yIn, vf), P(um, yIn, vt), P(ui, top, vt)], rakeShade, { out: [0, -1, 0] });
      }
      // geison: front face, flat top ledge and underside
      const gy = 1.1;
      poly(m, [P(u0 - ov, top, vf), P(u1 + ov, top, vf), P(u1 + ov, top - gy, vf), P(u0 - ov, top - gy, vf)], rake, { out: dirV(s) });
      poly(m, [P(u0 - ov, top, vf), P(u1 + ov, top, vf), P(u1 + ov, top, vt), P(u0 - ov, top, vt)], rakeShade, { out: [0, 1, 0] });
      poly(m, [P(u0 - ov, top - gy, vf), P(u1 + ov, top - gy, vf), P(u1 + ov, top - gy, vt), P(u0 - ov, top - gy, vt)], 0x9a9384, { out: [0, -1, 0] });
      for (const ue of [u0 - ov, u1 + ov])
        poly(m, [P(ue, top, vf), P(ue, top, vt), P(ue, top - gy, vt), P(ue, top - gy, vf)], rakeShade, { out: alongX ? [0, 0, ue < um ? -1 : 1] : [ue < um ? -1 : 1, 0, 0] });
    }
  }
  return { ridgeY, eaveY, P, um, half, pitch, top, rakeH };
}

// Hipped / pyramid roof over walls [wx0, wx1) x [wz0, wz1).
export function hipRoof(m, { wx0, wx1, wz0, wz1, top, pitch = 0.45, ov = 1, tiles = TILES.terra, seed = 3, finial = null }) {
  const x0 = wx0 - ov, x1 = wx1 + ov, z0 = wz0 - ov, z1 = wz1 + ov;
  const eaveY = top - pitch * ov;
  const hw = (x1 - x0) / 2, hd = (z1 - z0) / 2, h = Math.min(hw, hd);
  const ridgeY = eaveY + pitch * h;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const alongX = hw >= hd;
  const R0 = alongX ? [cx - (hw - h), ridgeY, cz] : [cx, ridgeY, cz - (hd - h)];
  const R1 = alongX ? [cx + (hw - h), ridgeY, cz] : [cx, ridgeY, cz + (hd - h)];
  const o = { tiles };
  tiledPlane(m, [x0, eaveY, z1], [x1, eaveY, z1], alongX ? R0 : R1, R1, { ...o, seed, up: [0, 1, 1] });
  tiledPlane(m, [x1, eaveY, z0], [x0, eaveY, z0], alongX ? R1 : R0, R0, { ...o, seed: seed + 1, up: [0, 1, -1] });
  tiledPlane(m, [x1, eaveY, z1], [x1, eaveY, z0], R1, alongX ? R1 : R0, { ...o, seed: seed + 2, up: [1, 1, 0] });
  tiledPlane(m, [x0, eaveY, z0], [x0, eaveY, z1], R0, alongX ? R0 : R1, { ...o, seed: seed + 3, up: [-1, 1, 0] });
  if (Math.abs(hw - hd) > 0.01) ridgeCap(m, [R0[0], ridgeY + 0.1, R0[2]], [R1[0], ridgeY + 0.1, R1[2]], alongX ? [0, 0, 1] : [1, 0, 0], 0.5, 0.4, tiles.ridge);
  if (finial !== null) cylinder(m, cx, ridgeY, cz, 0.6, 1.2, finial, { segs: 8 });
  return { ridgeY, cx, cz };
}

// Mono-pitch roof: high edge along one side of [wx0,wx1)x[wz0,wz1), falling
// toward `dir` ('+z', '-z', '+x', '-x').
export function shedRoof(m, { wx0, wx1, wz0, wz1, top, dir = '+z', pitch = 0.3, ov = 1, ovS = 0.5, tiles = TILES.terra, seed = 5, fill = 0xeae4d6 }) {
  const fallX = dir[1] === 'x', pos = dir[0] === '+';
  const run = fallX ? wx1 - wx0 : wz1 - wz0;
  const hiY = top + pitch * run;
  const eaveY = top - pitch * ov;
  let e0, e1, r0, r1, up;
  if (!fallX) {
    const ze = pos ? wz1 + ov : wz0 - ov, zh = pos ? wz0 - 0.3 : wz1 + 0.3;
    e0 = [pos ? wx0 - ovS : wx1 + ovS, eaveY, ze]; e1 = [pos ? wx1 + ovS : wx0 - ovS, eaveY, ze];
    r0 = [e0[0], hiY, zh]; r1 = [e1[0], hiY, zh]; up = [0, 1, pos ? 1 : -1];
  } else {
    const xe = pos ? wx1 + ov : wx0 - ov, xh = pos ? wx0 - 0.3 : wx1 + 0.3;
    e0 = [xe, eaveY, pos ? wz1 + ovS : wz0 - ovS]; e1 = [xe, eaveY, pos ? wz0 - ovS : wz1 + ovS];
    r0 = [xh, hiY, e0[2]]; r1 = [xh, hiY, e1[2]]; up = [pos ? 1 : -1, 1, 0];
  }
  tiledPlane(m, e0, e1, r0, r1, { tiles, seed, up });
  // side walls rise as triangles to meet the slope; high wall as a strip
  if (!fallX) {
    const zl = pos ? wz1 : wz0, zh = pos ? wz0 : wz1;
    poly(m, [[wx0, top, zl], [wx0, top, zh], [wx0, hiY, zh]], fill, { out: [-1, 0, 0] });
    poly(m, [[wx1, top, zl], [wx1, top, zh], [wx1, hiY, zh]], fill, { out: [1, 0, 0] });
    poly(m, [[wx0, top, zh], [wx1, top, zh], [wx1, hiY, zh], [wx0, hiY, zh]], fill, { out: [0, 0, pos ? -1 : 1] });
    // verge boards
    for (const [xv, s] of [[e0[0], pos ? -1 : 1], [e1[0], pos ? 1 : -1]])
      poly(m, [[xv, eaveY, e0[2]], [xv, hiY, r0[2]], [xv, hiY - 0.6, r0[2]], [xv, eaveY - 0.6, e0[2]]], tiles.fascia, { out: [s, 0, 0] });
  } else {
    const xl = pos ? wx1 : wx0, xh = pos ? wx0 : wx1;
    poly(m, [[xl, top, wz0], [xh, top, wz0], [xh, hiY, wz0]], fill, { out: [0, 0, -1] });
    poly(m, [[xl, top, wz1], [xh, top, wz1], [xh, hiY, wz1]], fill, { out: [0, 0, 1] });
    poly(m, [[xh, top, wz0], [xh, top, wz1], [xh, hiY, wz1], [xh, hiY, wz0]], fill, { out: [pos ? -1 : 1, 0, 0] });
  }
  return { hiY };
}

// Hemispherical (or shallower, `k` < 1) dome centred at (cx, y, cz), radius
// r, with `ribs` raised marble ribs and an alternating two-tone tile field.
export function dome(m, cx, y, cz, r, { segs = 24, rings = 7, k = 0.8, tones = [0xc98c72, 0xbd7f66], rib = 0xf0ebe0, ribEvery = 3 } = {}) {
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * Math.PI / 2, a1 = ((i + 1) / rings) * Math.PI / 2;
    for (let s = 0; s < segs; s++) {
      const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
      const pt = (a, b) => [cx + Math.cos(a) * Math.cos(b) * r, y + Math.sin(a) * r * k, cz + Math.cos(a) * Math.sin(b) * r];
      const nn = (a, b) => { const v = [Math.cos(a) * Math.cos(b), Math.sin(a) / k, Math.cos(a) * Math.sin(b)]; const l = len3(v); return v.map((q) => q / l); };
      const isRib = s % ribEvery === 0;
      const c = isRib ? rib : tones[(i + s) & 1 ? 1 : 0];
      const pts = [pt(a0, b0), pt(a0, b1), pt(a1, b1), pt(a1, b0)];
      const nrm = [nn(a0, b0), nn(a0, b1), nn(a1, b1), nn(a1, b0)];
      if (i === rings - 1) { pts.splice(3, 1); nrm.splice(3, 1); pts[2] = [cx, y + r * k, cz]; nrm[2] = [0, 1, 0]; }
      poly(m, pts, c, { normals: nrm, shade: pts.map((q) => 0.9 + 0.1 * ((q[1] - y) / (r * k))) });
    }
  }
  // lip ring at the base
  cylinder(m, cx, y - 0.6, cz, r + 0.35, 0.6, rib, { segs, cap: false });
}

// Smooth vertical cylinder (side + optional top cap).
export function cylinder(m, cx, y, cz, r, h, color, { segs = 12, cap = true, flutes = 0, flute = null } = {}) {
  for (let s = 0; s < segs; s++) {
    const b0 = (s / segs) * Math.PI * 2, b1 = ((s + 1) / segs) * Math.PI * 2;
    const p = (b, yy) => [cx + Math.cos(b) * r, yy, cz + Math.sin(b) * r];
    const n = (b) => [Math.cos(b), 0, Math.sin(b)];
    const c = flutes && flute !== null && s % 2 ? flute : color;
    poly(m, [p(b0, y), p(b1, y), p(b1, y + h), p(b0, y + h)], c, { normals: [n(b0), n(b1), n(b1), n(b0)], shade: [0.9, 0.9, 1, 1] });
    if (cap) poly(m, [p(b0, y + h), p(b1, y + h), [cx, y + h, cz]], color, { out: [0, 1, 0] });
  }
}

// Append the recorded smooth parts of `model` (optionally only those whose
// every vertex is below `maxY`) to a voxel geometry.
export function withExtras(geo, model, size, pivot, { maxY = Infinity } = {}) {
  const E = model.extra;
  if (!E || !E.pos.length) return geo;
  const pos = [], nor = [], col = [];
  for (let i = 0; i < E.pos.length; i += 9) {
    if (maxY !== Infinity && Math.max(E.pos[i + 1], E.pos[i + 4], E.pos[i + 7]) > maxY) continue;
    for (let k = 0; k < 9; k += 3) {
      pos.push((E.pos[i + k] - pivot[0]) * size, (E.pos[i + k + 1] - pivot[1]) * size, (E.pos[i + k + 2] - pivot[2]) * size);
      nor.push(E.nor[i + k], E.nor[i + k + 1], E.nor[i + k + 2]);
      col.push(E.col[i + k], E.col[i + k + 1], E.col[i + k + 2]);
    }
  }
  if (!pos.length) return geo;
  const a = geo.attributes;
  const nv = a.position.count, ne = pos.length / 3;
  const cat = (attr, extra, w) => {
    const out = new Float32Array((nv + ne) * w);
    out.set(attr.array.subarray(0, nv * w), 0);
    out.set(extra, nv * w);
    return new THREE.Float32BufferAttribute(out, w);
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', cat(a.position, pos, 3));
  g.setAttribute('normal', cat(a.normal, nor, 3));
  g.setAttribute('color', cat(a.color, col, 3));
  g.setAttribute('team', cat(a.team, new Array(ne).fill(0), 1));
  g.setAttribute('glow', cat(a.glow, new Array(ne).fill(0), 1));
  const oi = geo.index.array;
  const idx = new (nv + ne > 65535 ? Uint32Array : Uint16Array)(oi.length + ne);
  idx.set(oi, 0);
  for (let i = 0; i < ne; i++) idx[oi.length + i] = nv + i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// Smooth axis-aligned box (no bottom face) from (x0,y0,z0) to (x1,y1,z1).
export function sbox(m, x0, y0, z0, x1, y1, z1, color, { bottom = false } = {}) {
  const top = color, side = color;
  poly(m, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], top, { out: [0, 1, 0] });
  poly(m, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], side, { out: [0, 0, 1] });
  poly(m, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], side, { out: [0, 0, -1] });
  poly(m, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], side, { out: [1, 0, 0] });
  poly(m, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], side, { out: [-1, 0, 0] });
  if (bottom) poly(m, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], shadeHex(color, 0.7), { out: [0, -1, 0] });
}

// Round column centred at (cx, cz): torus base, fluted shaft (alternating
// facets a shade darker), dark necking ring, echinus and square abacus.
export function roundColumn(m, cx, y, cz, r, h, { shaft = 0xf1ece2, flute = 0xe2dccf, base = 0xd6cfbf, neck = 0xbdb5a3 } = {}) {
  cylinder(m, cx, y, cz, r + 0.45, 0.5, base, { segs: 12 });
  cylinder(m, cx, y + 0.5, cz, r + 0.25, 0.35, shaft, { segs: 12 });
  cylinder(m, cx, y + 0.85, cz, r, h - 2.2, shaft, { segs: 16, flutes: 1, flute, cap: false });
  cylinder(m, cx, y + h - 1.35, cz, r * 0.96, 0.3, neck, { segs: 16, cap: false });
  cylinder(m, cx, y + h - 1.05, cz, r + 0.3, 0.45, shaft, { segs: 16 });
  sbox(m, cx - r - 0.5, y + h - 0.6, cz - r - 0.5, cx + r + 0.5, y + h, cz + r + 0.5, base, { bottom: true });
}

// Tiled conical ring roof from radius r0 at y0 up to radius r1 at y1.
export function cone(m, cx, cz, r0, y0, r1, y1, { segs = 24, tiles = TILES.terra, seed = 9 } = {}) {
  const T = tiles.tones;
  const rows = Math.max(1, Math.round(Math.hypot(r0 - r1, y1 - y0) / 1.1));
  for (let i = 0; i < rows; i++) {
    const ra = r0 + (r1 - r0) * i / rows, rb = r0 + (r1 - r0) * (i + 1) / rows;
    const ya = y0 + (y1 - y0) * i / rows, yb = y0 + (y1 - y0) * (i + 1) / rows;
    for (let s = 0; s < segs; s++) {
      const b0 = (s + (i & 1) * 0.5) / segs * Math.PI * 2, b1 = (s + 1 + (i & 1) * 0.5) / segs * Math.PI * 2;
      const p = (r, yy, b) => [cx + Math.cos(b) * r, yy, cz + Math.sin(b) * r];
      const c = T[Math.floor(hash3(i, s, seed, 61) * T.length) % T.length];
      const bm = (b0 + b1) / 2;
      poly(m, [p(ra, ya + 0.15, b0), p(ra, ya + 0.15, b1), p(rb, yb, b1), p(rb, yb, b0)], c, { out: [Math.cos(bm), 1, Math.sin(bm)], shade: [0.94, 0.94, 1, 1] });
      poly(m, [p(ra, ya, b0), p(ra, ya, b1), p(ra, ya + 0.15, b1), p(ra, ya + 0.15, b0)], i ? tiles.butt : tiles.fascia, { out: [Math.cos(bm), 0, Math.sin(bm)] });
    }
  }
}
