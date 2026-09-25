import * as THREE from 'three';
import { RNG, hash2 } from '../core/rng.js';

// God power visuals (render-only; all state lives in the sim lists owned by
// GodPowers so paused captures are exact).
//
//  - Lightning: fractal (midpoint-displaced) channels with forks and
//    sub-forks, drawn as camera-facing ribbons with a white-hot core and a
//    wide blue halo that blooms; ground-crawling arcs at the impact; an
//    impact glow sprite, expanding shockwave ring, pooled flash lights and
//    scorch decals with cooling ember cracks.
//  - Storm: multiplicative storm-shadow over the area (flash-lit), rain
//    streaks, a funnel with a dark semi-opaque cloud body and bright energy
//    ribbons on its silhouette, a dust wall and a ground shockwave (flattened
//    grass, scoured soil, rolling dust rings) at its foot, trails and rim
//    light on the men it carries, a high violet-white light that pulses with
//    each strike over the whole field, and intra-cloud lightning.
//  - Zaps: little arcs crawling over struck units.
//  - Meteor: falling fireball with a flame trail, warning ring, fire-orange
//    impact flash/shockwave and a large glowing crater.

const BLUE = new THREE.Color(0x3d9bff);
const VIOLET = new THREE.Color(0x6b3dff);
const WHITE = new THREE.Color(0xeef6ff);

// ---------------------------------------------------------------- ribbons
// Ribbon widths are given in world units *as seen from 36 units away* and
// scale with distance to the camera, so a channel keeps a constant pixel width
// even where a 40-unit-tall bolt passes close to the camera (no wide smears).
const ribbonVS = `
  attribute vec3 aTan; attribute float aSide; attribute float aW; attribute float aI; attribute float aCore;
  uniform float uScreen;
  varying float vSide; varying float vI; varying float vCore;
  void main(){
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 t = normalize(mat3(modelMatrix) * aTan);
    vec3 v = normalize(cameraPosition - wp);
    vec3 s = cross(t, v);
    float l = length(s);
    s = l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
    float dist = distance(cameraPosition, wp);
    wp += s * aSide * aW * mix(1.0, clamp(dist / 36.0, 0.05, 3.0), uScreen);
    vSide = aSide; vI = aI; vCore = aCore;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

// Core lines (aCore 1): a thin white-hot channel with a narrow cyan rim.
// Halo lines (aCore 0): a soft gaussian bloom that shifts from cyan at the
// channel to violet at its edge; kept dim so units stay readable through it.
function makeRibbonMaterial(halo, core, coreGain = 4.0, edge = null, screen = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlpha: { value: 1 }, uHalo: { value: halo.clone() }, uCore: { value: core.clone() }, uGain: { value: coreGain },
      uEdge: { value: (edge || halo).clone() }, uScreen: { value: screen },
    },
    vertexShader: ribbonVS,
    fragmentShader: `uniform float uAlpha; uniform vec3 uHalo; uniform vec3 uCore; uniform vec3 uEdge; uniform float uGain;
      varying float vSide; varying float vI; varying float vCore;
      void main(){
        float e = abs(vSide);
        vec3 col;
        if (vCore > 0.5) {
          float hot = 1.0 - smoothstep(0.25, 0.75, e);
          float rim = exp(-e * e * 2.5) * (1.0 - hot);
          col = uCore * hot * uGain + uHalo * rim * 1.6;
        } else {
          float g = exp(-e * e * 4.5);
          col = mix(uEdge, uHalo, exp(-e * e * 9.0)) * g;
        }
        float a = clamp(uAlpha * vI, 0.0, 4.0);
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}

// lines: [{ pts: [{x,y,z, m?, wm?}], w, i, taper }] (m / wm: per-point intensity / width multipliers)
export function ribbonGeometry(lines) {
  const pos = [], tan = [], side = [], w = [], inten = [], core = [], idx = [];
  for (const L of lines) {
    const pts = L.pts, n = pts.length;
    if (n < 2) continue;
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
      const f = k / (n - 1);
      const ww = L.w * (1 - f * (L.taper ?? 0.5)) * (pts[k].wm ?? 1);
      const ii = L.i * (L.fade ? 1 - f * L.fade : 1) * (pts[k].m ?? 1);
      for (const sd of [-1, 1]) {
        pos.push(pts[k].x, pts[k].y, pts[k].z);
        tan.push(tx, ty, tz);
        side.push(sd);
        w.push(ww);
        inten.push(ii);
        core.push(L.halo ? 0 : 1);
      }
      if (k > 0) {
        const p = base + (k - 1) * 2, q = base + k * 2;
        idx.push(p, p + 1, q + 1, p, q + 1, q);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1));
  g.setAttribute('aI', new THREE.Float32BufferAttribute(inten, 1));
  g.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Midpoint displacement between a and b: jagged, self-similar lightning.
function fractalPath(rng, a, b, depth, rough) {
  let pts = [a, b];
  let amp = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * rough;
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      out.push({
        x: (p.x + q.x) / 2 + rng.range(-amp, amp),
        y: (p.y + q.y) / 2 + rng.range(-amp, amp) * 0.35,
        z: (p.z + q.z) / 2 + rng.range(-amp, amp),
      }, q);
    }
    pts = out;
    amp *= 0.55;
  }
  return pts;
}

// A channel = thin white-hot core + a dim tapered cyan/violet bloom round it.
function channel(lines, pts, w, i, taper, fade, bloomW = 7, bloomI = 0.32) {
  lines.push({ pts, w, i, taper, fade });
  lines.push({ pts, w: w * bloomW, i: i * bloomI, taper: Math.min(0.95, taper + 0.1), fade, halo: true });
}

// A cloud-to-ground strike with a clear hierarchy: one leader channel drawn
// as a hair-thin white-hot core inside a narrow cyan sheath and a wide, dim
// violet halo; two or three primary forks at about half its width, each with
// thinner sub-forks, and hair-thin feelers near the cloud. The channel leans
// in from a random point in the sky (mostly behind the target, as seen from
// the RTS camera), so strikes arrive at different angles instead of as
// parallel verticals. Grounded fork tips are returned in lines.ends (they get
// a small scorch and a flash).
export function boltLines(seed, x, groundY, z, heightAt, height = 21) {
  const rng = new RNG(seed);
  const lines = [];
  lines.ends = [];
  const away = Math.atan2(-1, -1); // away from the default (yaw 45) camera
  // the channel drops from almost straight overhead with a modest lean (the
  // cloud root sits a few tiles off, never a long diagonal from the frame
  // corner), so several strikes read as separate stabs, not a V
  const ta = away + (seed & 1 ? 1 : -1) * rng.range(0.5, 1.6), off = rng.range(2.5, 6);
  const top = { x: x + Math.cos(ta) * off, y: groundY + height * rng.range(0.8, 0.95), z: z + Math.sin(ta) * off };
  const main = fractalPath(rng, top, { x, y: groundY + 0.05, z }, 7, 0.07);
  // Width hierarchy (half-widths in world units at 36 units from the camera,
  // ~36 px per unit): the leader is a real channel - a white-hot core ~2 px in
  // the cloud swelling to ~6 px where it earths, inside a cyan sheath ~3x as
  // wide and a soft electric-blue/violet glow ~12x as wide that fades out.
  // Forks leave the leader at its local width and taper to nothing, their
  // sub-forks thinner again: a trunk-and-branches read, not one line reused.
  // (round 10: a real glowing trunk - ~6 px of white-hot core in the cloud
  // swelling to ~18 px where it earths - not a 1-2 px strand)
  // (round 13: thicker again - a white-hot trunk ~10 px wide in the cloud,
  // ~30 px where it earths, so the eye lands on it before anything else)
  const W0 = 0.15, W1 = 0.44;
  const wAt = (f) => W0 + (W1 - W0) * f; // leader core width at fraction f
  const tap = 1 - W1 / W0;
  lines.push({ pts: main, w: W0, i: 0.8, taper: tap, fade: -0.5 });
  // (the outer glow does not swell at the ground and dims there, so the
  // struck men under it keep their silhouettes)
  lines.push({ pts: main, w: W0 * 2.6, i: 0.55, taper: tap * 0.5, fade: -0.2, halo: true });
  lines.push({ pts: main, w: W0 * 7, i: 0.24, taper: tap * 0.3, fade: 0.2, halo: true });
  const nf = rng.int(2, 3) + (rng.chance(0.4) ? 1 : 0);
  for (let f = 0; f < nf; f++) {
    const i = rng.int(Math.floor(main.length * (0.3 + f * 0.14)), Math.floor(main.length * (0.44 + f * 0.14)));
    const p = main[i];
    const drop = p.y - groundY;
    const len = rng.range(0.35, 0.6) * drop + 2;
    const a = ta + Math.PI + (f % 2 ? 1 : -1) * rng.range(0.6, 1.9);
    // (forks stay close to the trunk so every strike earths inside the ring)
    const end = { x: p.x + Math.cos(a) * len * 0.4, y: p.y - len * rng.range(0.8, 1.3), z: p.z + Math.sin(a) * len * 0.4 };
    const gy = heightAt(end.x, end.z) + 0.05;
    const grounded = end.y <= gy + 0.3;
    end.y = Math.max(end.y, gy);
    if (grounded) lines.ends.push({ x: end.x, y: gy, z: end.z, w: f === 0 ? 1 : 0.7 });
    const fork = fractalPath(rng, p, end, 5, 0.12);
    // primary fork: ~60% of the leader where it branches, tapering out
    const fw = wAt(i / (main.length - 1)) * 0.6, ft = grounded ? 0.55 : 0.92;
    lines.push({ pts: fork, w: fw, i: 0.85, taper: ft, fade: grounded ? 0.3 : 0.85 });
    lines.push({ pts: fork, w: fw * 3, i: 0.34, taper: ft, fade: grounded ? 0.35 : 0.9, halo: true });
    lines.push({ pts: fork, w: fw * 9, i: 0.11, taper: ft * 0.8, fade: 0.8, halo: true });
    // sub-forks: thinner again, dying out in the air
    for (let k = 0; k < 3; k++) {
      if (!rng.chance(0.7)) continue;
      const j = rng.int(3, fork.length - 5), q = fork[j], l2 = len * rng.range(0.2, 0.38), b2 = a + rng.range(-1.3, 1.3);
      const sub = fractalPath(rng, q, { x: q.x + Math.cos(b2) * l2, y: Math.max(q.y - l2 * 0.8, heightAt(q.x, q.z) + 0.2), z: q.z + Math.sin(b2) * l2 }, 3, 0.2);
      const sw = fw * (1 - (j / (fork.length - 1)) * ft) * 0.55;
      lines.push({ pts: sub, w: sw, i: 0.6, taper: 0.95, fade: 0.85 });
      lines.push({ pts: sub, w: sw * 4, i: 0.2, taper: 0.95, fade: 0.9, halo: true });
    }
  }
  // hair-thin feelers crawling off the upper channel
  for (let f = 0; f < 3; f++) {
    const i = rng.int(2, Math.floor(main.length * 0.45)), p = main[i], len = rng.range(1.5, 4), a = rng.range(0, Math.PI * 2);
    const pts = fractalPath(rng, p, { x: p.x + Math.cos(a) * len, y: p.y - len * 0.5, z: p.z + Math.sin(a) * len }, 3, 0.22);
    lines.push({ pts, w: 0.014, i: 0.45, taper: 0.95, fade: 0.9 });
    lines.push({ pts, w: 0.06, i: 0.1, taper: 0.95, fade: 0.9, halo: true });
  }
  // short ground arcs crawling out from the impact, thick at the root
  const na = rng.int(3, 5);
  for (let k = 0; k < na; k++) {
    const a = (k / na) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const len = rng.range(0.9, 1.8);
    const pts = [];
    const n = 9;
    let ox = 0, oz = 0;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      ox += rng.range(-0.2, 0.2); oz += rng.range(-0.2, 0.2);
      const px = x + Math.cos(a) * len * t + ox * t, pz = z + Math.sin(a) * len * t + oz * t;
      pts.push({ x: px, y: heightAt(px, pz) + 0.08 + rng.range(0, 0.12), z: pz });
    }
    lines.push({ pts, w: 0.035, i: 0.8, taper: 0.95, fade: 0.9 });
    lines.push({ pts, w: 0.13, i: 0.18, taper: 0.9, fade: 0.9, halo: true });
  }
  return lines;
}

// Horizontal crawler inside the cloud deck.
function skyLines(seed, x, y, z) {
  const rng = new RNG(seed);
  const a = rng.range(0, Math.PI * 2), len = rng.range(8, 16);
  const s = { x: x - Math.cos(a) * len / 2, y, z: z - Math.sin(a) * len / 2 };
  const e = { x: x + Math.cos(a) * len / 2, y: y + rng.range(-2, 2), z: z + Math.sin(a) * len / 2 };
  const main = fractalPath(rng, s, e, 5, 0.12);
  const lines = [];
  channel(lines, main, 0.1, 0.8, 0.3, 0, 7, 0.3);
  for (let f = 0; f < 3; f++) {
    const p = main[rng.int(4, main.length - 5)], b = a + rng.range(-1.5, 1.5), l = len * 0.35;
    channel(lines, fractalPath(rng, p, { x: p.x + Math.cos(b) * l, y: p.y - rng.range(0, 3), z: p.z + Math.sin(b) * l }, 3, 0.15), 0.06, 0.55, 0.9, 0, 6, 0.3);
  }
  return lines;
}

function zapLines(seed, h) {
  const rng = new RNG(seed);
  const lines = [];
  for (let k = 0; k < 2; k++) {
    const a0 = rng.range(0, Math.PI * 2);
    const pts = [];
    for (let s = 0; s <= 7; s++) {
      const a = a0 + s * rng.range(0.3, 0.7), r = rng.range(0.3, 0.5);
      pts.push({ x: Math.cos(a) * r, y: rng.range(0.1, h), z: Math.sin(a) * r });
    }
    channel(lines, pts, 0.025, 1, 0.4, 0, 5, 0.35);
  }
  return lines;
}

// Ground strike brightness: a blinding first stroke, then a held channel that
// re-brightens with return strokes (the eye reads a strike as ~half a second
// of flicker), then a quick fade.
function boltEnv(age, life, seed) {
  // first stroke, one return stroke ~0.1 s later, then a quick decay (an
  // older bolt is only a dim afterimage when the next one lands, so the
  // freshest strike reads on its own instead of three stacking into glare)
  if (age < 0.05) return 1.3;
  const rs = 0.1 + (seed % 5) * 0.012;
  const ret = Math.exp(-Math.pow((age - rs) / 0.03, 2)) * 0.45;
  const flick = 0.85 + 0.15 * Math.abs(Math.sin(age * 38 + (seed % 7)));
  const decay = Math.exp(-(age - 0.05) / 0.16) * Math.max(0, 1 - age / life);
  return (decay * flick + ret) * 1.0;
}

// ---------------------------------------------------------------- textures
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeScorchTexture() {
  return canvasTex(256, (ctx, S) => {
    const rng = new RNG(99);
    const C = S / 2;
    // blast streaks: soot flung outward in rays
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2), r0 = S * 0.12, r1 = S * rng.range(0.3, 0.49), w = rng.range(0.03, 0.09);
      const g = ctx.createLinearGradient(C + Math.cos(a) * r0, C + Math.sin(a) * r0, C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      g.addColorStop(0, 'rgba(12,10,9,0.55)');
      g.addColorStop(1, 'rgba(20,16,12,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a - w) * r0, C + Math.sin(a - w) * r0);
      ctx.lineTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(a + w) * r0, C + Math.sin(a + w) * r0);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(C, C, 2, C, C, C - 1);
    g.addColorStop(0, 'rgba(4,3,3,1)');
    g.addColorStop(0.28, 'rgba(8,7,6,0.97)');
    g.addColorStop(0.5, 'rgba(18,14,11,0.7)');
    g.addColorStop(0.78, 'rgba(26,20,15,0.22)');
    g.addColorStop(1, 'rgba(34,27,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // blocky soot clods (voxel-scale squares)
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.18, 0.46) * S, sz = rng.range(3, 9);
      ctx.fillStyle = `rgba(10,8,7,${rng.range(0.3, 0.8)})`;
      ctx.fillRect(C + Math.cos(a) * r - sz / 2, C + Math.sin(a) * r - sz / 2, sz, sz);
    }
  });
}

// Branching glowing cracks (white = hot); tinted by the material colour.
function makeEmberTexture() {
  return canvasTex(128, (ctx, S) => {
    const rng = new RNG(7);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    const crack = (x, y, a, len, w) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        a += rng.range(-0.6, 0.6);
        x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6;
        ctx.lineTo(x, y);
        if (w > 1.2 && rng.chance(0.3)) { ctx.stroke(); crack(x, y, a + rng.range(-1, 1), len * 0.5, w * 0.6); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y); }
      }
      ctx.stroke();
    };
    for (let k = 0; k < 6; k++) crack(S / 2, S / 2, (k / 6) * Math.PI * 2 + rng.range(-0.3, 0.3), S * rng.range(0.14, 0.26), 4.5);
  });
}

// ---------------------------------------------------------------- materials
// Energy perimeter. Storm (uDash 0): an uneven, flickering crackle whose
// radius wanders with angle and time, broken into live and dead stretches so
// it reads as raw static rather than a UI circle. Meteor warning (uDash 1):
// the same band with marching dashes.
const ringMat = (dash = 0) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uColor: { value: new THREE.Color(0x7fc0ff) }, uFlash: { value: 0 }, uDash: { value: dash } },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uTime; uniform float uK; uniform vec3 uColor; uniform float uFlash; uniform float uDash; varying vec3 vP;
    float h(float n){ return fract(sin(n) * 43758.5453); }
    float vn(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
    void main(){
      float ang = atan(vP.z, vP.x) + 3.14159;
      float b = vP.y; // band coordinate -1 inner .. 1 outer
      float ft = floor(uTime * 24.0);
      if (uDash > 0.5) {
        float seg = floor(ang * 20.0 + uTime * 6.0);
        float crackle = 0.55 + 0.45 * h(seg + ft);
        float edge = exp(-b * b * 18.0) * crackle;
        float dash = step(0.5, fract(ang * 7.6394 - uTime * 0.4)) * exp(-pow(b + 0.7, 2.0) * 30.0) * 0.6;
        gl_FragColor = vec4(uColor * (edge * 0.7 + exp(-b * b * 3.0) * 0.18 + dash) * uK, 1.0);
        return;
      }
      gl_FragColor = vec4(0.0);
    }`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
});

// Storm perimeter, laid on the terrain (depth-tested, so units stand in it).
// vD = signed distance from the nominal radius in world units, vA = angle.
// The edge is broken into ~40 drifting segments; each has its own thickness,
// brightness and flicker, tapers to nothing at its ends and wanders off the
// circle, so it reads as a crackling wall of static rather than a decal. A
// soft glowing ground band spills inward, and the ends of live segments
// flare where the arcs earth themselves.
const PERIM_GLSL = `
    float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
    float vn1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
    // per-angle segment state: x = liveness (0..1), y = thickness, z = taper, w = segment id
    vec4 seg(float ang, float t){
      float sx = ang * 6.3662 + t * 0.35;
      float si = floor(sx), sf = fract(sx);
      float thick = mix(0.25, 1.0, h1(si * 1.37 + 3.1));
      float bright = mix(0.35, 1.0, h1(si * 3.17 + 1.3));
      float fl = h1(si * 2.13 + floor(t * (9.0 + 8.0 * h1(si * 5.1))));
      float on = step(0.28, fl) * (0.55 + 0.45 * fl);
      float len = mix(0.7, 1.0, h1(si * 7.7));
      float tap = smoothstep(0.0, 0.12, sf) * (1.0 - smoothstep(len - 0.18, len, sf));
      return vec4(on * bright, thick, tap, si);
    }
    // the wall answers the strikes: a hotspot on the stretch nearest the
    // latest bolt, the rest of the ring sinks to a low simmer
    uniform float uHotA, uHotW;
    float hotAt(float a){
      float da = abs(mod(a - uHotA + 3.14159265, 6.2831853) - 3.14159265);
      return uHotW * (exp(-da * da * 6.0) + 0.3 * exp(-da * da * 0.9));
    }`;
// The storm wall: a volumetric sheet of energy standing on the perimeter,
// following the terrain at its foot. Brightest in a soft band where it meets
// the ground, fading upward; soft fresnel falloff (the stretches seen edge-on
// at the sides glow, the faces seen square-on front and back are a thin
// veil), torn by two layers of turbulent streaks spiralling up it in opposite
// senses, and surging where the latest bolt fell.
const wallMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uFlash: { value: 0 }, uHotA: { value: 0 }, uHotW: { value: 0 }, uH: { value: 7 } },
  vertexShader: `attribute float aH; attribute float aA; varying float vH; varying float vA; varying vec3 vW; varying vec3 vN;
    void main(){ vH = aH; vA = aA; vN = normalize(vec3(position.x, 0.0, position.z));
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uTime, uK, uFlash, uH; varying float vH; varying float vA; varying vec3 vW; varying vec3 vN;
    ${PERIM_GLSL}
    float hs2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hs2(i), hs2(i + vec2(1.0, 0.0)), f.x), mix(hs2(i + vec2(0.0, 1.0)), hs2(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ return vn2(p) * 0.55 + vn2(p * 2.13 + 5.2) * 0.3 + vn2(p * 4.7 + 1.7) * 0.15; }
    void main(){
      float h = vH, y = h * uH, x = vA * 17.5;           // x: arc length-ish round the ring
      vec3 v = normalize(cameraPosition - vW);
      vec2 vh = normalize(v.xz + 1e-5);
      float facing = dot(vN.xz, vh);                     // +1 near side of the funnel .. -1 far side
      float ndv = abs(facing);
      float fres = pow(1.0 - ndv, 1.4);                  // 1 edge-on .. 0 face-on
      float body = fres * fres;
      // near strands bright, the far side of the funnel a dim veil behind the army
      float front = mix(0.3, 1.15, smoothstep(-0.75, 0.85, facing));
      // two turbulent layers spiralling up the funnel with the spin
      float t1 = fbm(vec2(x * 0.5 + y * 1.1 - uTime * 3.2, y * 0.35 - uTime * 1.1));
      float t2 = fbm(vec2(x * 0.8 + y * 1.6 - uTime * 4.4 + 9.0, y * 0.6 - uTime * 1.7));
      float s1 = smoothstep(0.5, 0.8, t1), s2 = smoothstep(0.56, 0.85, t2);
      float fil = pow(1.0 - abs(t1 - 0.62) / 0.05, 3.0) * step(abs(t1 - 0.62), 0.05);
      float hot = hotAt(vA);
      float gfl = 0.85 + 0.15 * h1(floor(uTime * 20.0) * 1.7) + 0.35 * uFlash;
      // vertical profile: a hot foot on the ground ring, a torn sheet that
      // thins as the funnel flares, frayed into the cloud at the top
      float foot = exp(-y / 0.28) * smoothstep(0.0, 0.04, y) * (0.6 + 0.4 * fres);
      float top = 1.0 - smoothstep(0.45 + 0.3 * t2, 1.0, h);
      float sheet = smoothstep(0.0, 0.12, h) * pow(1.0 - h, 0.9) * top;
      vec3 cFoot = mix(vec3(0.7, 0.25, 1.8), vec3(1.2, 0.95, 1.95), fres);
      vec3 cLow = vec3(0.55, 0.3, 1.5), cHigh = vec3(0.3, 0.08, 0.85);
      vec3 cBody = mix(cLow, cHigh, smoothstep(0.1, 0.9, h));
      vec3 col = cFoot * foot * (0.7 + 0.3 * t1) * (1.0 + 0.4 * fres) * (0.8 + 1.2 * hot)
               + cBody * sheet * body * (0.3 * s1 + 0.2 * s2) * (0.85 + 1.0 * hot)
               + vec3(0.85, 0.75, 1.6) * fil * sheet * fres * 0.8;
      gl_FragColor = vec4(col * front * gfl * uK, 1.0);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
});

// Funnel profile: radius at height fraction h (0 foot .. 1 top). The storm
// stands on a ground ring of radius rb and flares out to rt as it climbs.
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const funnelR = (rb, rt, h) => rb + (rt - rb) * Math.pow(h, 1.7);

// The funnel wall: rings stacked up the profile; the foot follows the
// terrain (smoothed ground heights gh round the circle), upper rings level out.
function funnelGeometry(gh, rb, rt, H, seg = 192, rows = 18) {
  const pos = [], aH = [], aA = [], idx = [], NA = gh.length;
  const base = gh.reduce((m, v) => Math.min(m, v), 1e9);
  for (let j = 0; j <= rows; j++) {
    const h = j / rows, r = funnelR(rb, rt, h);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const g = gh[Math.floor((i / seg) * NA) % NA];
      const y = g + (base - g) * Math.min(1, h * 2.5) + h * H;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      aH.push(h); aA.push(a);
      if (i > 0 && j > 0) {
        const p = (j - 1) * (seg + 1) + i - 1, q = j * (seg + 1) + i - 1;
        idx.push(p, p + 1, q, q, p + 1, q + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(aH, 1));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 1));
  g.setIndex(idx);
  return g;
}

// The funnel's body: a semi-opaque shell of dark storm cloud and dust
// (alpha-blended, so it darkens and hides what is behind it instead of adding
// light). Billowing cloud spirals up it with the spin; it is thin where the
// shell is seen face-on (the men caught inside read through it) and dense
// where it is seen edge-on at the silhouette, lit violet from inside near the
// foot and flashing with the strikes. Drawn as two meshes: the far wall
// (back faces, before everything inside) and the near wall (front faces).
const bodyMat = (front) => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uFlash: { value: 0 }, uH: { value: 11 } },
  vertexShader: `attribute float aH; attribute float aA; varying float vH; varying float vA; varying vec3 vW; varying vec3 vN;
    void main(){ vH = aH; vA = aA; vN = normalize(vec3(position.x, 0.0, position.z));
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uTime, uK, uFlash, uH; varying float vH; varying float vA; varying vec3 vW; varying vec3 vN;
    float hs2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hs2(i), hs2(i + vec2(1.0, 0.0)), f.x), mix(hs2(i + vec2(0.0, 1.0)), hs2(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ return vn2(p) * 0.5 + vn2(p * 2.03 + 5.2) * 0.28 + vn2(p * 4.1 + 1.7) * 0.14 + vn2(p * 8.3 + 3.1) * 0.08; }
    void main(){
      float h = vH, y = h * uH, x = vA * 7.0;
      vec3 v = normalize(cameraPosition - vW);
      float facing = dot(vN.xz, normalize(v.xz + 1e-5));
      float fres = pow(1.0 - abs(facing), 1.3);
      // billows climbing the spiral, torn by faster streaks
      float b = fbm(vec2(x * 0.42 + y * 0.55 - uTime * 1.5, y * 0.32 - uTime * 0.45));
      float st = fbm(vec2(x * 1.3 + y * 1.9 - uTime * 3.4, y * 0.5 - uTime * 1.2));
      float dens = (0.55 + 0.45 * smoothstep(0.2, 0.62, b)) * (0.8 + 0.2 * st);
      float prof = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.62, 1.0, h));
      ${front ? 'float faceA = 0.5, edgeA = 1.7;' : 'float faceA = 0.7, edgeA = 1.3;'}
      float cov = dens * prof * mix(faceA, edgeA, fres);
      // dark storm cloud, lit from inside: violet near the glowing foot,
      // cooler and darker up the funnel; billow crests catch the light
      vec3 dark = mix(vec3(0.08, 0.06, 0.13), vec3(0.11, 0.09, 0.18), smoothstep(0.1, 0.8, h));
      float inner = ${front ? '0.35' : '1.0'} * exp(-y / 2.4);
      vec3 col = dark + vec3(0.22, 0.08, 0.46) * inner * (0.5 + 0.5 * b)
               + vec3(0.13, 0.1, 0.22) * smoothstep(0.5, 0.85, b) * (0.5 + 0.5 * fres)
               + vec3(0.18, 0.14, 0.36) * min(1.2, uFlash) * (0.35 + 0.65 * st) * (0.4 + 0.6 * fres);
      gl_FragColor = vec4(col * 0.22, clamp(cov * uK, 0.0, 0.95));
    }`,
  transparent: true, depthWrite: false, side: front ? THREE.BackSide : THREE.FrontSide, fog: false, // (the funnel's rings wind clockwise seen from outside)
});

// Ground shockwave round the funnel's foot, laid on the terrain: a scoured
// band of dark soil at the foot, grass flattened in curved streaks swept
// round with the spin, and rings of dust rolling outward over it.
const groundRingMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: `attribute float aR; attribute float aA; varying float vR; varying float vA;
    void main(){ vR = aR; vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime, uK, uFlash; varying float vR; varying float vA;
    float hs2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hs2(i), hs2(i + vec2(1.0, 0.0)), f.x), mix(hs2(i + vec2(0.0, 1.0)), hs2(i + vec2(1.0, 1.0)), f.x), f.y); }
    void main(){
      float r = vR;                       // 1 = the funnel's foot
      float sw = vA - 1.4 * r;            // curved streak coordinate, swept with the spin
      float st = vn2(vec2(sw * 38.0, r * 2.2)) * 0.65 + vn2(vec2(sw * 90.0, r * 5.0)) * 0.35;
      float grass = smoothstep(0.45, 0.8, st) * smoothstep(0.92, 1.08, r) * (1.0 - smoothstep(1.3, 1.7, r));
      float scour = exp(-pow((r - 1.02) / 0.07, 2.0));
      // two dust rings rolling out from the foot
      float dust = 0.0;
      for (int i = 0; i < 2; i++) {
        float ph = fract(uTime * 0.55 + float(i) * 0.5);
        float rr = 1.02 + ph * 0.65;
        float n = 0.6 + 0.4 * vn2(vec2(vA * 9.0 + float(i) * 3.0, uTime * 1.5));
        dust += exp(-pow((r - rr) / (0.05 + 0.1 * ph), 2.0)) * (1.0 - ph) * n;
      }
      vec3 cGrass = vec3(0.34, 0.36, 0.2), cSoil = vec3(0.09, 0.07, 0.06), cDust = vec3(0.3, 0.25, 0.3);
      vec3 col = cGrass; float cov = grass * 0.5;
      col = mix(col, cSoil, scour); cov = max(cov, scour * 0.6);
      col = mix(col, cDust + vec3(0.12, 0.05, 0.25) * (1.0 + uFlash), min(1.0, dust)); cov = max(cov, min(0.7, dust * 0.75));
      cov *= 1.0 - smoothstep(1.45, 1.75, r);
      cov *= smoothstep(0.84, 0.94, r);
      col *= 0.45 * (1.0 + 0.5 * uFlash);
      // (round 13) the kill radius, marked crisply on the ground: a dark
      // scorched edge just outside the foot and a thin hot violet line on it
      // (terrain-following, so it sits on every voxel step)
      float scorch = smoothstep(1.125, 1.14, r) * (1.0 - smoothstep(1.17, 1.26, r)) * (0.75 + 0.25 * vn2(vec2(vA * 40.0, 1.0)));
      col = mix(col, vec3(0.02, 0.015, 0.02), scorch); cov = max(cov, scorch * 0.8);
      float line = exp(-pow((r - 1.12) / 0.014, 2.0)) * (0.8 + 0.2 * sin(uTime * 23.0 + vA * 5.0));
      col = mix(col, vec3(2.2, 1.4, 4.0), line); cov = max(cov, line * 0.95);
      gl_FragColor = vec4(col, cov * uK);
    }`,
  transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
});

// Terrain-following annulus (r0..r1 round (cx, cz)); aR = r / rb.
function groundRingGeometry(heightAt, cx, cz, rb, r0, r1, na = 220, nr = 30) {
  const pos = [], aR = [], aA = [], idx = [];
  for (let j = 0; j <= nr; j++) {
    const r = r0 + (r1 - r0) * (j / nr);
    for (let i = 0; i <= na; i++) {
      const a = (i / na) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, heightAt(cx + x, cz + z) + 0.05, z);
      aR.push(r / rb); aA.push(a);
      if (i > 0 && j > 0) {
        const p = (j - 1) * (na + 1) + i - 1, q = j * (na + 1) + i - 1;
        idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 1));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 1));
  g.setIndex(idx);
  return g;
}

// Dust wall at the funnel's foot: earth and grass torn up and whirled round,
// alpha-blended (dust darkens and hazes what is behind it, unlike the light),
// lit violet from inside by the storm, spiralling with the spin.
const dustMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uFlash: { value: 0 }, uH: { value: 3 } },
  vertexShader: `attribute float aH; attribute float aA; varying float vH; varying float vA; varying vec3 vW; varying vec3 vN;
    void main(){ vH = aH; vA = aA; vN = normalize(vec3(position.x, 0.0, position.z));
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `uniform float uTime, uK, uFlash, uH; varying float vH; varying float vA; varying vec3 vW; varying vec3 vN;
    float hs2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hs2(i), hs2(i + vec2(1.0, 0.0)), f.x), mix(hs2(i + vec2(0.0, 1.0)), hs2(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fbm(vec2 p){ return vn2(p) * 0.5 + vn2(p * 2.1 + 5.2) * 0.3 + vn2(p * 4.3 + 1.7) * 0.2; }
    void main(){
      float y = vH * uH, x = vA * 12.0;
      vec3 v = normalize(cameraPosition - vW);
      float facing = dot(vN.xz, normalize(v.xz + 1e-5));
      float n = fbm(vec2(x * 0.7 + y * 1.4 - uTime * 3.0, y * 0.9 - uTime * 0.8));
      float n2 = fbm(vec2(x * 1.9 - uTime * 5.0 + y * 2.0, y * 2.2));
      float prof = smoothstep(0.0, 0.05, vH) * pow(1.0 - vH, 1.2);
      // (not named 'a': SwiftShader's GLSL compile zeroed a local of that name)
      float cov = smoothstep(0.25, 0.7, n) * prof * (0.6 + 0.4 * n2);
      // edge-on stretches read thicker (a wall of dust seen through its depth)
      cov *= mix(0.55, 1.0, pow(1.0 - abs(facing), 1.2));
      vec3 dust = vec3(0.2, 0.15, 0.17);
      vec3 lit = vec3(0.42, 0.22, 0.75) * (0.4 + 0.7 * (1.0 - smoothstep(0.0, 0.6, vH)));
      vec3 col = mix(dust, lit, 0.3 + 0.35 * n2) * (1.0 + 0.6 * uFlash);
      gl_FragColor = vec4(col * 0.35, clamp(cov * 1.6 * uK, 0.0, 0.9));
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
});

// Full-frame storm grade, drawn after the opaque world and before the
// additive effects with multiplicative blending (dst * src). Each pixel's
// view ray is intersected with the ground plane so the darkening, drifting
// cloud shadows and the blue-white light pools under each bolt are placed in
// world space (perspective-correct ellipses that sit on the terrain). Pools
// go above 1 in the HDR buffer, so they relight the albedo of the grass,
// units and walls near the strike rather than pasting a glow over them.
const MAX_POOLS = 6;
const stormGradeMat = (add = false) => new THREE.ShaderMaterial({
  defines: add ? { ADD_POOL: 1 } : {},
  uniforms: {
    uInvVP: { value: new THREE.Matrix4() }, uPlaneY: { value: 0 }, uCenter: { value: new THREE.Vector2() },
    uR: { value: 10 }, uK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 },
    uPools: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector4()) },
    uPoolCol: { value: new THREE.Color(1.2, 0.98, 1.8) },
  },
  vertexShader: `varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform mat4 uInvVP; uniform float uPlaneY, uR, uK, uFlash, uTime; uniform vec2 uCenter;
    uniform vec4 uPools[${MAX_POOLS}]; uniform vec3 uPoolCol; varying vec2 vNdc;
    float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hs(i), hs(i + vec2(1.0, 0.0)), f.x), mix(hs(i + vec2(0.0, 1.0)), hs(i + vec2(1.0, 1.0)), f.x), f.y); }
    void main(){
      vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0); a.xyz /= a.w;
      vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0); b.xyz /= b.w;
      vec3 d = b.xyz - a.xyz;
      vec2 g = d.y < -1e-4 ? a.xz + d.xz * ((uPlaneY - a.y) / d.y) : a.xz + normalize(d.xz + 1e-5) * 300.0;
      float r = length(g - uCenter) / uR;
      float inside = 1.0 - smoothstep(0.85, 1.12, r);
      float near = 1.0 - smoothstep(1.0, 3.2, r);
      // drifting cloud shadows (two octaves), strongest over the storm
      vec2 q = g * 0.06 + vec2(uTime * 0.12, uTime * 0.05);
      float n = vn(q) * 0.6 + vn(q * 2.7 + 7.1) * 0.4;
      float shade = smoothstep(0.3, 0.75, n);
      // multiplier: a deep blue storm tint (never grey). Inside the ring it
      // is a radial vignette - clearer over the struck army at the centre,
      // darker toward the wall - so the strike-lit units read against it;
      // beyond the ring the land sits in the cloud shadow.
      // (the ring is a lit stage: the storm floor stays near full light with a
      // cool cast, and the world past the wall drops into storm dark)
      // inside the funnel the storm floor is lit violet by the whirl: light
      // arms sweep round with the spin, brightest toward the wall
      float ga = atan(g.y - uCenter.y, g.x - uCenter.x);
      float arms = 0.5 + 0.5 * sin(3.0 * ga + 5.0 * r - uTime * 2.6);
      arms = arms * arms * (0.6 + 0.4 * vn(g * 0.35 + uTime * 0.4));
      // (round 13: a near-neutral stage - the old violet multiply cut red to
      // 0.58 while keeping blue, turning the red army magenta; now red keeps
      // ~90% and only ~30% of the violet cast reaches the floor)
      vec3 inC = mix(vec3(0.95, 0.9, 1.0), vec3(0.82, 0.74, 0.98), smoothstep(0.35, 1.0, r)) * (0.92 + 0.1 * shade)
               + vec3(0.08, 0.02, 0.2) * arms * (0.05 + 0.3 * smoothstep(0.5, 0.95, r));
      vec3 midC = vec3(0.4, 0.4, 0.6) * (0.8 + 0.3 * shade);
      vec3 m = mix(vec3(0.42, 0.43, 0.5), midC, near);
      m = mix(m, inC, inside);
      m += vec3(0.04, 0.07, 0.16) * uFlash * (0.3 + 0.7 * inside);
      // each strike throws violet-white light far out over the land round
      // the storm (the funnel is the brightest thing in the world)
      float reach = exp(-max(0.0, r - 0.9) * 0.75) * (1.0 - inside * 0.6);
      m += vec3(0.3, 0.3, 0.75) * min(1.2, uFlash) * reach * 0.3 + vec3(0.05, 0.04, 0.18) * reach * uK * 0.6;
      // screen vignette: the frame edges fall off into storm dark
      float vg = length(vNdc * vec2(0.9, 1.0));
      m *= 1.0 - 0.5 * smoothstep(0.55, 1.45, vg);
      m = mix(vec3(1.0), m, uK);
      float pool = 0.0;
      for (int i = 0; i < ${MAX_POOLS}; i++) {
        vec4 P = uPools[i];
        if (P.z <= 0.0) continue;
        float dd = length(g - P.xy) / P.w;
        pool += P.z * (exp(-dd * dd * 2.2) * 0.85 + exp(-dd * dd * 0.6) * 0.15);
      }
      // the storm wall lights the land, the grass and the men at its foot
      // (a soft violet spill that reaches ~2 tiles in, less outside), so the
      // wall reads as a light source standing on the ground, not a decal
      float dr = (r - 1.0) * uR;
      float ang = atan(g.y - uCenter.y, g.x - uCenter.x);
      float rn = 0.6 + 0.4 * vn(vec2(ang * 9.0 - uTime * 2.0, uTime * 0.7));
      float spill = (dr < 0.0 ? exp(dr / 0.9) : exp(-dr / 0.5)) * rn * uK;
      #ifdef ADD_POOL
        // additive part: blue-grey rain haze over the storm floor (lifts and
        // desaturates the darkened ground) + cool strike light on dark ground
        // (a faint deep-blue lift only: a grey haze turned the army to mush)
        // (only a faint cool lift under the strike: the relight of the albedo
        // in the multiply pass carries the flash, so nothing turns to haze)
        gl_FragColor = vec4(vec3(0.05, 0.09, 0.22) * pool * 0.4 + vec3(0.05, 0.02, 0.13) * spill * 0.35
          + vec3(0.012, 0.006, 0.03) * inside * uK, 1.0);
      #else
        m += uPoolCol * pool + vec3(0.32, 0.1, 1.05) * spill * 0.6;
        gl_FragColor = vec4(m, 1.0);
      #endif
    }`,
  transparent: true, depthWrite: false, depthTest: false, fog: false,
  ...(add ? { blending: THREE.AdditiveBlending } : { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor }),
});

// flat band ring; y of each vertex stores its band coordinate (-1 inner .. 1 outer)
function bandRingGeometry(r0, r1, seg = 128) {
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * r0, -1, s * r0, c * r1, 1, s * r1);
    if (i > 0) { const p = (i - 1) * 2, q = i * 2; idx.push(p, q, p + 1, p + 1, q, q + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((seg + 1) * 4).fill(0), 2));
  g.setIndex(idx);
  return g;
}

// Rain: sparse over the storm floor (so the strike stays clean), denser in a
// curtain round the perimeter and beyond it.
function rainGeometry(seed, R, n = 420) {
  const rng = new RNG(seed);
  const pos = [], aEnd = [], aSeed = [];
  for (let i = 0; i < n; i++) {
    const inner = i < n * 0.15;
    const a = rng.range(0, Math.PI * 2), s = rng.next();
    const r = inner ? Math.sqrt(rng.next()) * R * 0.8 : R * (0.8 + Math.sqrt(rng.next()) * 0.75);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pos.push(x, 0, z, x, 0, z);
    aEnd.push(0, 1);
    aSeed.push(s, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEnd', new THREE.Float32BufferAttribute(aEnd, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(aSeed, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}
const rainMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uFlash: { value: 0 } },
  vertexShader: `attribute float aEnd; attribute float aSeed; uniform float uTime; varying float vA;
    void main(){
      float H = 18.0;
      float y = mod(aSeed * H * 7.13 - uTime * 26.0, H);
      vec3 p = position + vec3(0.0, y + aEnd * 1.1, 0.0) + vec3(0.35, 0.0, 0.25) * aEnd;
      vA = (1.0 - aEnd * 0.8) * smoothstep(0.0, 2.0, y) * smoothstep(H, H - 4.0, y);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `uniform float uK; uniform float uFlash; varying float vA;
    void main(){ gl_FragColor = vec4(vec3(0.5, 0.6, 0.8) * (0.1 + uFlash * 0.22) * vA * uK, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});

// ---------------------------------------------------------------- sparks
// Hot sparks: motion-blurred streaks (head -> tail along the velocity over
// ~1/20 s) with a soft cross-section, additive and HDR so they bloom, each
// cooling on its own from blue-white through yellow and orange to a dull red.
const sparkMat = () => new THREE.ShaderMaterial({
  vertexShader: `attribute vec3 aTan; attribute float aSide; attribute float aW; attribute vec3 aCol; attribute float aT;
    varying float vSide; varying vec3 vCol; varying float vT;
    void main(){
      vec3 wp = position;
      vec3 v = normalize(cameraPosition - wp);
      vec3 s = cross(normalize(aTan), v);
      float l = length(s);
      s = l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
      wp += s * aSide * aW * clamp(distance(cameraPosition, wp) / 36.0, 0.3, 3.0);
      vSide = aSide; vCol = aCol; vT = aT;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`,
  fragmentShader: `varying float vSide; varying vec3 vCol; varying float vT;
    void main(){
      float g = exp(-vSide * vSide * 3.5);
      float tail = pow(1.0 - vT, 1.6);
      gl_FragColor = vec4(vCol * g * tail, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});
// spark temperature (1 hot .. 0 cold) -> HDR colour
function sparkColor(T, out) {
  if (T > 0.8) return out.setRGB(2.6, 2.7, 3.2).lerp(_sc.setRGB(3.0, 2.4, 1.2), (1 - T) / 0.2);
  if (T > 0.55) return out.setRGB(3.0, 2.4, 1.2).lerp(_sc.setRGB(2.8, 1.2, 0.25), (0.8 - T) / 0.25);
  if (T > 0.25) return out.setRGB(2.8, 1.2, 0.25).lerp(_sc.setRGB(1.2, 0.22, 0.04), (0.55 - T) / 0.3);
  return out.setRGB(1.2, 0.22, 0.04).multiplyScalar(Math.max(0, T / 0.25));
}
const _sc = new THREE.Color();

// ---------------------------------------------------------------- renderer
const DEBRIS_MAX = 480;
const stormK = (st, now) => Math.min(1, (now - st.t0) / 1.0) * Math.min(1, Math.max(0, (st.t0 + st.duration - now) / 1.5));
const EMBER_MAX = 96;
const SPARK_MAX = 256;

export class BoltRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'godpower-fx';
    this.group.userData.noAO = true;
    game.scene.add(this.group);
    this.boltMat = makeRibbonMaterial(BLUE, WHITE, 1.35, VIOLET);
    this.fireMat = makeRibbonMaterial(new THREE.Color(0xff5a10), new THREE.Color(0xffe0a0), 3.0, new THREE.Color(0xc0200a), 0);
    this.meshes = new Map();
    this.lights = [];
    // (4 pooled strike/fire lights + 2 storm lights: the scene's light count
    // stays at 6 so no material recompiles when a power starts)
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xa8c4ff, 0, 16, 2);
      this.group.add(l);
      this.lights.push(l);
    }
    // violet storm lights: carried round inside the funnel with the spin,
    // so the whirl lights the ground and the walls and men inside it
    // (light 0 hangs over the funnel's heart: a strong violet-white light
    // that pulses with every strike and reaches the land and the armies all
    // round the storm; light 1 circles inside the funnel)
    this.stormLights = [];
    for (let i = 0; i < 2; i++) {
      const l = i === 0 ? new THREE.PointLight(0xbca4ff, 0, 0, 0.9) : new THREE.PointLight(0x9a60ff, 0, 14, 1.6);
      this.group.add(l);
      this.stormLights.push(l);
    }
    // One shadow-casting spot hangs low over the freshest strike, pointing
    // down: units and walls round the impact throw hard shadows outward.
    this.spot = new THREE.SpotLight(0xcfe0ff, 0, 18, 1.4, 0.55, 2);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0006;
    this.spot.shadow.normalBias = 0.03;
    this.spot.shadow.radius = 1;
    this.spot.shadow.camera.near = 0.3;
    this.spot.shadow.camera.far = 18;
    this.spot.visible = false;
    this.group.add(this.spot, this.spot.target);
    // full-frame storm grade + strike light pools
    this.grade = this.addMesh(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stormGradeMat()), 18);
    this.grade.visible = false;
    this.poolAdd = this.addMesh(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stormGradeMat(true)), 19);
    this.poolAdd.material.uniforms = this.grade.material.uniforms; // share state
    this.poolAdd.visible = false;
    this._m4 = new THREE.Matrix4();
    // thrown earth: lit voxel chunks (cast shadows) and glowing ember cubes
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.debris = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), DEBRIS_MAX);
    this.debris.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_MAX * 3), 3);
    this.debris.castShadow = true;
    this.debris.receiveShadow = true;
    this.debris.count = 0;
    this.addMesh(this.debris, 0);
    this.embers = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false }), EMBER_MAX);
    this.embers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(EMBER_MAX * 3), 3);
    this.embers.count = 0;
    this.addMesh(this.embers, 26);
    this._o = new THREE.Object3D();
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    this._hotC = new THREE.Color(1.8, 2.3, 3.4);
    this.quadGeo = new THREE.PlaneGeometry(1, 1);
    this.scorchMat = new THREE.MeshBasicMaterial({ map: makeScorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.emberMat = new THREE.MeshBasicMaterial({ map: makeEmberTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, color: 0xff7a2a, fog: false });
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // strike flash laid on the ground: a white-hot patch about a tile and a
    // half across fading through electric blue (depth-tested, so the units
    // standing in it keep their silhouettes and their feet are lit)
    this.groundFlashMat = new THREE.ShaderMaterial({
      uniforms: { uO: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uO; varying vec2 vUv;
        void main(){ vec2 p = (vUv - 0.5) * 2.0; float d = length(p);
          float an = atan(p.y, p.x);
          float rays = 0.65 + 0.35 * pow(abs(sin(an * 5.0 + 1.3) * sin(an * 3.0 + 0.4)), 0.5);
          vec3 c = vec3(1.0, 1.0, 1.05) * exp(-pow(d * 3.2, 2.5)) * 1.3
                 + vec3(0.35, 0.6, 1.4) * exp(-d * d * 5.0) * 0.8 * rays
                 + vec3(0.2, 0.3, 1.0) * exp(-d * d * 1.6) * 0.25;
          c *= 1.0 - smoothstep(0.8, 1.0, d);
          gl_FragColor = vec4(c * uO, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
    });
    this.scorchMeshes = new Map();
    this.shockGeo = bandRingGeometry(0.75, 1.0, 48);
    this.shockMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1 }, uColor: { value: new THREE.Color(0xa8d0ff) } },
      vertexShader: `varying float vB; void main(){ vB = position.y; vec3 p = vec3(position.x, 0.0, position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `uniform float uA; uniform vec3 uColor; varying float vB; void main(){ float e = exp(-pow(vB - 0.4, 2.0) * 6.0); gl_FragColor = vec4(uColor * e * uA, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    // strike flash disc: a white-hot core with a hard, bright rim that sits
    // crisp on the ground (uK 0..1 age: the rim opens out a little and the
    // core narrows as it cools through violet)
    this.discMat = new THREE.ShaderMaterial({
      uniforms: { uO: { value: 1 }, uK: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uO, uK; varying vec2 vUv;
        void main(){ vec2 p = (vUv - 0.5) * 2.0; float d = length(p);
          float rr = 0.3 + 0.2 * uK;
          // white-hot core fading to violet toward a hard bright rim, and a
          // charred dark collar just outside it: the contrast that makes the
          // contact read crisp (not one more additive glow on bright grass)
          float core = 1.0 - smoothstep(rr - 0.05, rr, d);
          float rim = exp(-pow((d - rr) / 0.03, 2.0));
          float coll = smoothstep(rr, rr + 0.03, d) * (1.0 - smoothstep(rr + 0.2, rr + 0.5, d));
          vec3 hot = mix(vec3(3.2, 3.0, 3.4), vec3(1.5, 0.8, 2.8), smoothstep(0.0, rr, d) * 0.7 + 0.3 * uK);
          vec3 c = hot * core;
          c = mix(c, vec3(0.03, 0.02, 0.05), coll * (1.0 - core));
          c = mix(c, vec3(2.4, 1.8, 4.0), rim);
          float a = max(core, max(rim, coll * 0.85)) * uO;
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0)); }`,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -9,
    });
    // spark streaks: one preallocated ribbon quad per spark; blue-white
    // electric sparks and molten gold ones (which read against the blue glare)
    this._emptyGeo = new THREE.BufferGeometry();
    this.sparkMesh = this.addMesh(new THREE.Mesh(new THREE.BufferGeometry(), sparkMat()), 55);
    // (round 13) drop shadows under men thrown into the air: a soft dark
    // blot on the ground under each one, tighter and darker the lower he
    // flies, so a flying man reads apart from the debris round him
    // (multiplied into the frame; instanceColor.r = the blot's depth)
    this.shadows = new THREE.InstancedMesh(this.decalGeo, new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; varying float vD;
        void main(){ vUv = uv; vD = instanceColor.r;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv; varying float vD;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.35, 1.0, d)) * vD;
          gl_FragColor = vec4(vec3(1.0 - a), 1.0); }`,
      transparent: true, depthWrite: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    }), 48);
    this.shadows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(48 * 3), 3);
    this.shadows.count = 0;
    this.addMesh(this.shadows, 7);
    this.stormVisuals = new Map();
    this.meteorVisuals = new Map();
    this.zapMeshes = new Map();
  }

  addMesh(obj, order = 50) {
    obj.frustumCulled = false;
    obj.renderOrder = order;
    obj.userData.noAO = true;
    this.group.add(obj);
    return obj;
  }

  // camera-facing additive glow (plain mesh + shader billboard)
  // tight: a pin-sharp hot centre with only a short falloff. depth: tested
  // against the world (placed behind a unit, the unit masks the centre and
  // only a rim of light shows round its silhouette).
  glowSprite(color, order = 60, tight = 0, depth = false) {
    const m = new THREE.Mesh(this.quadGeo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uO: { value: 1 }, uTight: { value: tight } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
        mv.xy += position.xy * sc;
        gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uO; uniform float uTight; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0;
          float a = uTight > 1.5 ? exp(-pow(d * 2.6, 3.0)) * 1.1 + exp(-d * d * 7.0) * 0.35
            : mix(exp(-d * d * 5.0) * 0.8 + exp(-d * d * 40.0) * 1.2, exp(-d * d * 90.0) * 1.4 + exp(-d * d * 9.0) * 0.18, uTight);
          a *= 1.0 - smoothstep(0.85, 1.0, d);
          gl_FragColor = vec4(uColor * a * uO, 1.0); }`,
      transparent: true, depthWrite: false, depthTest: depth, blending: THREE.AdditiveBlending, fog: false,
    }));
    return this.addMesh(m, order);
  }

  render(state, now) {
    const { bolts, storms, scorches, zaps, meteors } = state;
    const game = this.game;
    const heightAt = (x, z) => game.map.heightAt(x, z);
    let flash = 0;
    const pools = [];
    let spotB = null, spotEnv = 0;
    // ---- bolts
    const alive = new Set();
    let li = 0;
    const sorted = bolts.slice().sort((a, b) => b.t0 - a.t0);
    for (const b of sorted) {
      const age = now - b.t0;
      if (age > b.life) continue;
      alive.add(b);
      let v = this.meshes.get(b);
      const kind = b.kind || 'ground';
      if (!v) {
        const lines = kind === 'sky' ? skyLines(b.seed, b.x, b.y, b.z) : (b.lines || boltLines(b.seed, b.x, b.y, b.z, heightAt));
        const mesh = this.addMesh(new THREE.Mesh(ribbonGeometry(lines), this.boltMat.clone()), 52);
        v = { mesh, extra: [] };
        if (kind === 'ground') {
          // thin channels need a hotter core colour to read white against the halo
          mesh.material.uniforms.uGain.value = 1.9;
          mesh.material.uniforms.uCore.value.setRGB(0.8, 0.9, 1.15);
          // one flash per strike: a white-hot bloom ball at the contact that
          // snaps down within ~0.15 s, over a lit patch of ground (the point
          // light, the shadow spot and the grade's light pool carry the spill
          // onto the land, the buildings and the army)
          v.hot = this.glowSprite(0xdfe9ff, 62, 2);
          v.hot.position.set(b.x, b.y + 0.55, b.z);
          v.gflash = this.addMesh(new THREE.Mesh(this.decalGeo, this.groundFlashMat.clone()), 24);
          v.gflash.position.set(b.x, b.y + 0.08, b.z);
          v.gflash.rotation.y = (b.seed % 628) / 100;
          // brightness varies a little from bolt to bolt
          v.gain = 0.8 + 0.35 * hash2(b.seed & 0xffff, 91);
          // (round 13) the channel earths visibly: a tall white-hot stem of
          // light standing on the contact, a crisp flash disc with a hard
          // edge and a shock ring racing out over the ground
          v.stem = this.glowSprite(0xf4f0ff, 63, 2);
          v.stem.position.set(b.x, b.y + 1.2, b.z);
          v.disc = this.addMesh(new THREE.Mesh(this.decalGeo, this.discMat.clone()), 23);
          v.disc.position.set(b.x, b.y + 0.3, b.z);
          v.ring = this.addMesh(new THREE.Mesh(this.shockGeo, this.shockMat.clone()), 46);
          v.ring.material.uniforms.uColor.value.setRGB(0.95, 0.8, 1.6);
          v.ring.position.set(b.x, b.y + 0.12, b.z);
        }
        this.meshes.set(b, v);
      }
      const k = age / b.life;
      // return strokes: a couple of re-brightenings, then a fast decay
      const env = kind === 'ground' ? boltEnv(age, b.life, b.seed)
        : Math.pow(1 - k, 1.4) * (age < 0.06 ? 1.4 : (0.55 + 0.45 * Math.abs(Math.sin(age * 55 + b.seed % 7))));
      v.mesh.material.uniforms.uAlpha.value = Math.min(1.1, env) * (kind === 'sky' ? 0.4 : 1.0);
      if (kind === 'ground') {
        flash = Math.max(flash, env);
        // impact: a blinding additive white-blue core that blooms, inside a
        // wide blue corona; both collapse within ~0.4 s so the lit units show
        // through as the flash dies. The real lights below carry the spill.
        // capped, not clipped: a white core only a few pixels across, a
        // short blue falloff, and the units round it stay readable
        // a white-hot flash ~1.5 tiles wide that snaps down within ~0.35 s to
        // a pin-sharp core, a ground flash under it, a wide blue corona and a
        // horizontal flare; per-bolt gain so no two strikes look alike
        const pin = age < 0.06 ? 1 : Math.exp(-(age - 0.06) / 0.07);
        const g = v.gain ?? 1, e = Math.min(1.5, env) * g;
        v.mesh.material.uniforms.uAlpha.value = Math.min(1.1, env) * g;
        v.hot.material.uniforms.uO.value = 2.6 * g * pin;
        v.hot.scale.setScalar(0.7 + 0.9 * pin);
        v.gflash.material.uniforms.uO.value = Math.min(0.35, e * 0.3) * (0.15 + 0.85 * pin);
        v.gflash.scale.setScalar(1.5 + 0.7 * pin);
        // the freshest strike is the hero: its stem, disc and ring are full
        // strength, older ones only a dim afterimage
        const hero = b === sorted[0] ? 1 : 0.35;
        const sk = Math.min(1, age / 0.4);
        v.stem.material.uniforms.uO.value = 0.9 * g * hero * (age < 0.1 ? 1 : Math.exp(-(age - 0.1) / 0.18));
        v.stem.scale.set(0.35 + 0.15 * pin, 2.4 + 0.6 * pin, 1);
        v.disc.material.uniforms.uO.value = Math.min(1, hero * g * (age < 0.1 ? 1.3 : 1.3 * Math.exp(-(age - 0.1) / 0.2)));
        v.disc.material.uniforms.uK.value = sk;
        v.disc.scale.setScalar(6.2);
        v.ring.scale.setScalar(0.6 + 3.4 * Math.pow(sk, 0.6));
        v.ring.material.uniforms.uA.value = hero * 3.0 * Math.pow(1 - sk, 1.2);
        // the strike relights the land and the men round it: a white-blue
        // pool ~5 tiles across (150-200 px) that multiplies the albedo up to
        // ~3x for the first few frames, then dies with the channel
        const snap = age < 0.1 ? 1 : Math.exp(-(age - 0.1) / 0.12);
        // (round 13: tighter and softer, so the flash disc keeps a crisp edge
        // against the lit ground instead of melting into one white haze)
        pools.push({ x: b.x, z: b.z, i: Math.min(0.5, e * 0.45) * (0.1 + 0.9 * snap) * (b === sorted[0] ? 1 : 0.3), r: 2.8 + 1.0 * snap });
        for (const st of storms) {
          const dx = b.x - st.x, dz = b.z - st.z, d = Math.hypot(dx, dz);
          const w = Math.min(1.2, env) * (0.45 + 0.55 * Math.min(1, d / st.radius)) * Math.pow(1 - k, 0.7);
          if (w > (st._hotW ?? 0) || st._hotT !== now) { st._hotW = w; st._hotA = Math.atan2(dz, dx); st._hotT = now; }
        }
        if (!spotB || env > spotEnv) { spotB = b; spotEnv = env; }
        if (li < this.lights.length) {
          const l = this.lights[li++];
          // low and blue, reaching ~1/3 of the ring: bright blue rim light
          // on the units and walls round the strike
          // (a short, strong flash that reaches the walls of the buildings
          // and the men all round the contact)
          // the freshest strike throws violet-white light low over the
          // voxels and the men round it; older ones stay cool blue
          const heroL = b === sorted[0];
          // (round 13: the hero light reaches ~1.5x the funnel radius so the
          // grass and the unit tops all round the strike take its violet)
          l.color.setHex(heroL ? 0xa878ff : 0x9cbcff);
          // (hung higher with a slow falloff: an even violet tint over the
          // whole kill radius instead of a blown-out lilac spot on the contact)
          l.position.set(b.x, b.y + (heroL ? 4.5 : 3.2), b.z);
          l.distance = heroL ? 12 : 10;
          l.decay = heroL ? 1 : 2;
          const snapL = age < 0.1 ? 1 : Math.exp(-(age - 0.1) / 0.12);
          l.intensity = (heroL ? 7 : 17) * Math.min(1.1, e) * (0.06 + 0.94 * snapL);
        }
      } else flash = Math.max(flash, env * 0.5);
    }
    for (const [b, v] of this.meshes) {
      if (alive.has(b)) continue;
      this.group.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.material.dispose();
      if (v.hot) { this.group.remove(v.hot, v.gflash, v.stem, v.disc, v.ring); for (const o of [v.hot, v.gflash, v.stem, v.disc, v.ring]) o.material.dispose(); }
      for (const s of v.extra || []) { this.group.remove(s); s.material.dispose(); }
      this.meshes.delete(b);
    }
    // hard-shadow spot over the brightest strike
    if (spotB) {
      this.spot.visible = true;
      // hung low over the impact so the units round it throw hard shadows
      // radially outward across the lit ground
      this.spot.position.set(spotB.x + 0.1, spotB.y + 2.6, spotB.z + 0.1);
      this.spot.target.position.set(spotB.x, spotB.y, spotB.z);
      this.spot.target.updateMatrixWorld();
      this.spot.intensity = 12 * Math.min(1.1, spotEnv);
    } else {
      this.spot.visible = false;
      this.spot.intensity = 0;
    }

    // ---- meteors (falling)
    const aliveMet = new Set();
    for (const m of meteors) {
      aliveMet.add(m);
      let v = this.meteorVisuals.get(m);
      const gy = heightAt(m.x, m.z);
      if (!v) {
        const dir = new THREE.Vector3(m.x - m.sx, gy - m.sy, m.z - m.sz).normalize();
        const trail = [];
        for (let i = 0; i <= 10; i++) trail.push({ x: -dir.x * i * 1.1, y: -dir.y * i * 1.1, z: -dir.z * i * 1.1 });
        const tm = this.addMesh(new THREE.Mesh(ribbonGeometry([{ pts: trail, w: 0.5, i: 1, taper: 0.9, fade: 1 }, { pts: trail, w: 1.8, i: 0.9, taper: 0.8, fade: 1, halo: true }]), this.fireMat.clone()), 53);
        const core = this.glowSprite(0xffc070, 61);
        const warn = this.addMesh(new THREE.Mesh(bandRingGeometry(m.radius - 0.5, m.radius + 0.5, 96), ringMat(1)), 44);
        warn.material.uniforms.uColor.value.setHex(0xff8a30);
        v = { tm, core, warn };
        this.meteorVisuals.set(m, v);
      }
      const t = Math.min(1, (now - m.t0) / m.delay);
      const px = m.sx + (m.x - m.sx) * t, py = m.sy + (gy - m.sy) * t, pz = m.sz + (m.z - m.sz) * t;
      v.tm.position.set(px, py, pz);
      v.core.position.set(px, py, pz);
      v.core.scale.setScalar(5 + Math.sin(now * 40) * 0.6);
      v.tm.material.uniforms.uAlpha.value = 1.2;
      v.warn.position.set(m.x, gy + 0.2, m.z);
      v.warn.scale.setScalar(1.6 - t * 0.6);
      v.warn.material.uniforms.uK.value = Math.min(1, t * 3) * 0.8;
      v.warn.material.uniforms.uTime.value = now;
      if (li < this.lights.length) {
        const l = this.lights[li++];
        l.color.setHex(0xff9a40);
        l.position.set(px, py, pz);
        l.intensity = 40;
      }
    }
    for (const [m, v] of this.meteorVisuals) {
      if (aliveMet.has(m)) continue;
      this.group.remove(v.tm, v.core, v.warn);
      v.tm.geometry.dispose(); v.tm.material.dispose(); v.core.material.dispose(); v.warn.geometry.dispose(); v.warn.material.dispose();
      this.meteorVisuals.delete(m);
    }

    // ---- scorch decals + cooling embers (and meteor blasts' flash)
    const live = new Set(scorches);
    for (const sc of scorches) {
      if (this.scorchMeshes.has(sc)) continue;
      const s = this.addMesh(new THREE.Mesh(this.decalGeo, this.scorchMat.clone()), 5);
      const e = this.addMesh(new THREE.Mesh(this.decalGeo, this.emberMat.clone()), 25);
      const size = sc.size ?? 5.2;
      s.scale.setScalar(size);
      e.scale.setScalar(size * (sc.blast ? 0.5 : 0.5));
      s.position.set(sc.x, sc.y + 0.04, sc.z);
      e.position.set(sc.x, sc.y + 0.06, sc.z);
      s.rotation.y = (sc.seed % 628) / 100;
      e.rotation.y = ((sc.seed >>> 3) % 628) / 100;
      const v = { s, e };
      if (sc.blast) {
        v.glow = this.glowSprite(0xffa050);
        v.glow.position.set(sc.x, sc.y + 1.5, sc.z);
        v.shock = this.addMesh(new THREE.Mesh(this.shockGeo, this.shockMat.clone()), 45);
        v.shock.material.uniforms.uColor.value.setHex(0xffa060);
        v.shock.position.set(sc.x, sc.y + 0.2, sc.z);
      }
      this.scorchMeshes.set(sc, v);
    }
    for (const [sc, v] of this.scorchMeshes) {
      if (!live.has(sc)) {
        this.group.remove(v.s, v.e); v.s.material.dispose(); v.e.material.dispose();
        if (v.glow) { this.group.remove(v.glow, v.shock); v.glow.material.dispose(); v.shock.material.dispose(); }
        this.scorchMeshes.delete(sc);
        continue;
      }
      const age = now - sc.t0;
      v.s.material.opacity = Math.max(0, 1 - Math.max(0, age - 8) / 6);
      const heat = Math.exp(-age / (sc.blast ? 2.5 : 1.6));
      v.e.material.opacity = Math.min(1, heat * 0.9);
      if (sc.blast) v.e.material.color.setRGB(0.5 + 0.7 * heat, 0.12 + heat * 0.45, 0.04 + heat * 0.35);
      else {
        // lightning-fused cracks: blue-white hot for a moment (blooms), then
        // cooling through orange to a dull red glow
        const w = Math.max(0, 1 - age / 0.3);
        const q = Math.exp(-age / 1.2) * (sc.size ? 0.22 : 0.38);
        this._c.setRGB(2.2 * q, 0.6 * q * q, 0.12 * q).lerp(this._hotC, w * 0.8);
        v.e.material.color.copy(this._c);
      }
      if (v.glow) {
        const k = Math.min(1, age / 0.7);
        v.glow.material.uniforms.uO.value = Math.pow(Math.max(0, 1 - k), 2) * 0.7;
        v.glow.scale.setScalar(6 + 8 * k);
        v.shock.scale.setScalar(1 + k * 9);
        v.shock.material.uniforms.uA.value = (1 - k) * 2.5;
        if (age < 0.8 && li < this.lights.length) {
          const l = this.lights[li++];
          l.color.setHex(0xff9040);
          l.position.set(sc.x, sc.y + 3, sc.z);
          l.intensity = 60 * (1 - k);
        }
      }
    }
    // burning meteor craters: a flickering warm light under the flames
    for (const f of state.fires || []) {
      if (li >= this.lights.length) break;
      const age = now - f.t0, fk = Math.max(0, 1 - age / f.dur);
      const fl = Math.floor(now * 14);
      const l = this.lights[li++];
      l.color.setHex(0xff7a2a);
      l.position.set(f.x + (hash2(fl, 1) - 0.5) * 0.6, f.y + 2.4, f.z + (hash2(fl, 2) - 0.5) * 0.6);
      l.distance = 10;
      l.intensity = 16 * fk * (0.8 + 0.4 * hash2(fl, 3));
    }
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;

    // ---- zaps on struck units
    const aliveZ = new Set(zaps);
    for (const z of zaps) {
      let zv = this.zapMeshes.get(z);
      if (!zv) {
        const m = this.addMesh(new THREE.Mesh(ribbonGeometry(zapLines(z.seed, z.h)), this.boltMat.clone()), 54);
        m.material.uniforms.uGain.value = 2.2;
        // blue-white back light: a depth-tested glow set just behind the unit
        // (from the camera), so the unit masks its centre and reads as a dark
        // silhouette with an electric rim - the struck man stands out of the crowd
        const rim = this.glowSprite(0x5f9cff, 53, 0, true);
        zv = { m, rim };
        this.zapMeshes.set(z, zv);
      }
      const { m, rim } = zv;
      const age = now - z.t0, k = age / z.life;
      const f = Math.floor(now * 30);
      if (z.u) m.position.set(z.u.x, game.map.heightAt(z.u.x, z.u.z) + (z.u.airY || 0), z.u.z);
      else m.position.set(z.x, z.y, z.z);
      m.rotation.y = f * 2.1 + z.seed;
      m.scale.y = 0.8 + hash2(f, z.seed) * 0.4;
      m.material.uniforms.uAlpha.value = (1 - k) * (hash2(f, z.seed, 3) > 0.3 ? 1 : 0.3) * 0.6;
      const cam = game.camera.position;
      this._v.set(m.position.x - cam.x, 0, m.position.z - cam.z).normalize().multiplyScalar(0.55);
      rim.position.set(m.position.x + this._v.x, m.position.y + z.h * 0.55, m.position.z + this._v.z);
      rim.scale.setScalar(z.h * 1.4);
      rim.material.uniforms.uO.value = Math.pow(1 - k, 1.3) * 0.28;
    }
    for (const [z, zv] of this.zapMeshes) {
      if (aliveZ.has(z)) continue;
      this.group.remove(zv.m, zv.rim); zv.m.geometry.dispose(); zv.m.material.dispose(); zv.rim.material.dispose();
      this.zapMeshes.delete(z);
    }

    // ---- storms
    const aliveStorms = new Set();
    let gradeK = 0, gst = null;
    for (const g of this.rimPool || []) g.visible = false;
    for (const st of storms) {
      aliveStorms.add(st);
      let v = this.stormVisuals.get(st);
      if (!v) v = this.makeStorm(st);
      const y = heightAt(st.x, st.z);
      const age = now - st.t0;
      const k = stormK(st, now);
      const fl = Math.min(1.5, flash);
      if (k >= gradeK) { gradeK = k; gst = st; }
      // hotspot eases off once its strike fades (held briefly between bolts)
      const hw = st._hotT === now ? st._hotW : 0;
      if (hw >= (v.hotW ?? 0) * 0.8 && hw > 0) { v.hotW = hw; v.hotA = st._hotA; } else v.hotW = (v.hotW ?? 0) * 0.9;
      for (const m of [v.dust, v.bodyBack, v.bodyFront, v.ground]) {
        m.material.uniforms.uK.value = k;
        m.material.uniforms.uTime.value = now;
        m.material.uniforms.uFlash.value = fl;
      }
      for (const m of [v.curtain]) {
        m.material.uniforms.uK.value = k;
        m.material.uniforms.uTime.value = now;
        m.material.uniforms.uFlash.value = fl;
        m.material.uniforms.uHotA.value = v.hotA ?? 0;
        m.material.uniforms.uHotW.value = v.hotW ?? 0;
      }
      this.renderBands(st, v, now, k, fl);
      this.renderTrails(st, v, state.airborne || [], k);
      v.rain.position.set(st.x, y, st.z);
      v.rain.material.uniforms.uK.value = k;
      v.rain.material.uniforms.uTime.value = now;
      v.rain.material.uniforms.uFlash.value = fl;
    }
    for (const [st, v] of this.stormVisuals) {
      if (aliveStorms.has(st)) continue;
      this.group.remove(v.rain, v.curtain, v.dust, v.bands, v.bands2, v.bodyBack, v.bodyFront, v.ground, v.trails);
      v.dust.geometry.dispose(); v.dust.material.dispose();
      v.fg.dispose(); v.bodyBack.material.dispose(); v.bodyFront.material.dispose();
      v.ground.geometry.dispose(); v.ground.material.dispose();
      if (v.trails.geometry !== this._emptyGeo) v.trails.geometry.dispose(); v.trails.material.dispose();
      for (const bm of [v.bands, v.bands2]) { if (bm.geometry !== this._emptyGeo) bm.geometry.dispose(); bm.material.dispose(); }
      v.curtain.geometry.dispose(); v.curtain.material.dispose();
      v.rain.geometry.dispose(); v.rain.material.dispose();
      this.stormVisuals.delete(st);
    }

    // ---- thrown debris + spark streaks
    const pulled = [];
    for (const st of storms) {
      const sv = this.stormVisuals.get(st);
      if (sv) { this.pulledDebris(st, sv, now, stormK(st, now), pulled); if (sv.ride) pulled.push(...sv.ride); }
    }
    this.renderDebris(state.debris || [], now, pulled);
    this.renderShadows(state.airborne || []);
    this.renderSparks(this.sparkMesh, state.sparks || [], now);

    // ---- storm light: the cloud deck dims the sun and sky light (the grade
    // below shapes it locally), so the strike lights really carry the scene;
    // health bars are hidden while the storm plays so the strike reads clean
    this.stormLight(gradeK);
    this.stormLights.forEach((l, i) => {
      const sv = gst && this.stormVisuals.get(gst);
      if (!sv) { l.intensity = 0; return; }
      if (i === 0) {
        // (hung high with a slow falloff: a wash over the whole battlefield,
        // not a hot disc on the ground under it)
        l.position.set(gst.x, heightAt(gst.x, gst.z) + 24, gst.z);
        // (round 13: 45 -> 16 per flash - the full-strength wash turned every
        // man in the ring pale lilac; the hero strike's own light carries the
        // local violet now)
        l.intensity = gradeK * (5 + 16 * Math.min(1.2, flash));
        return;
      }
      const a = now * 2.0 + i * Math.PI, r = sv.rb * (0.45 + 0.1 * Math.sin(now * 1.3 + i));
      const px = gst.x + Math.cos(a) * r, pz = gst.z + Math.sin(a) * r;
      l.position.set(px, heightAt(px, pz) + 5, pz);
      l.intensity = 7 * gradeK * (0.85 + 0.15 * Math.sin(now * 7 + i * 2)) + 10 * Math.min(1, flash);
    });
    const ov = game.combat?.overlays;
    if (ov?.bars) {
      if (gradeK > 0) { ov.bars.visible = false; if (ov.marks) ov.marks.visible = false; this._barsHidden = true; }
      else if (this._barsHidden) { ov.bars.visible = true; if (ov.marks) ov.marks.visible = true; this._barsHidden = false; }
    }

    // ---- storm grade + light pools (one full-frame pass)
    const U = this.grade.material.uniforms;
    this.grade.visible = gradeK > 0 || pools.length > 0;
    this.poolAdd.visible = this.grade.visible;
    if (this.grade.visible) {
      const cam = game.camera;
      cam.updateMatrixWorld();
      U.uInvVP.value.multiplyMatrices(cam.matrixWorld, this._m4.copy(cam.projectionMatrix).invert());
      U.uK.value = gradeK;
      U.uFlash.value = Math.min(1.5, flash);
      U.uTime.value = now;
      if (gst) { U.uCenter.value.set(gst.x, gst.z); U.uR.value = this.stormVisuals.get(gst)?.rb ?? gst.radius; U.uPlaneY.value = heightAt(gst.x, gst.z); }
      else if (pools.length) U.uPlaneY.value = heightAt(pools[0].x, pools[0].z);
      for (let i = 0; i < MAX_POOLS; i++) {
        const p = pools[i];
        if (p) U.uPools.value[i].set(p.x, p.z, p.i, p.r);
        else U.uPools.value[i].set(0, 0, 0, 1);
      }
    }
  }

  stormLight(k) {
    const L = this.game.lighting;
    if (!L) return;
    for (const [light, dim] of [[L.sun, 0.66], [L.hemi, 0.35], [L.fill, 0.2]]) {
      if (!light) continue;
      const st = light.userData.gp || (light.userData.gp = { base: light.intensity, set: light.intensity });
      if (light.intensity !== st.set) st.base = light.intensity; // someone else changed it
      st.set = light.intensity = st.base * (1 - dim * k);
    }
    // the storm crushes the milky toe lift and the pale aerial haze of the
    // fair-weather grade: blacks go black, the far land sinks into a dark
    // storm blue and bloom opens up, so the bolts and the wall glow against a
    // dark world instead of sitting on a grey wash (bloom is left alone:
    // opened up, it smeared the strike into a white fog)
    const post = L.post, fog = this.game.scene.fog;
    const ease = (obj, key, target) => {
      if (!obj) return;
      const S = this._postBase || (this._postBase = new Map());
      let st = S.get(obj);
      if (!st) S.set(obj, st = {});
      const cur = obj[key];
      if (st[key] === undefined || (typeof cur === 'number' && cur !== st[key].set)) st[key] = { base: cur, set: cur };
      const b = st[key].base;
      st[key].set = obj[key] = b + (target - b) * k;
    };
    const G = post?.grade?.uniforms;
    if (G) {
      ease(G.uToeLift, 'value', 0.0);
      ease(G.uContrast, 'value', 1.22);
      ease(G.uVignette, 'value', 0.55);
      ease(G.uSaturation, 'value', 1.08);
    }
    if (fog?.color) {
      if (!this._fogBase) this._fogBase = fog.color.clone();
      if (k > 0) fog.color.copy(this._fogBase).lerp(this._stormFog || (this._stormFog = new THREE.Color(0x141a2c)), k);
      else if (this._fogTouched) fog.color.copy(this._fogBase);
      this._fogTouched = k > 0;
    }
  }

  // Spiralling energy ribbons of the funnel, rebuilt each frame. Strands on
  // the near side of the funnel are wider and brighter than those behind it.
  renderBands(st, v, now, k, flash) {
    const layers = [[], []], NA = v.gh.length, TAU = Math.PI * 2;
    const ghAt = (a) => {
      const f = ((a % TAU) + TAU) % TAU / TAU * NA, i = Math.floor(f), t = f - i;
      return v.gh[i % NA] * (1 - t) + v.gh[(i + 1) % NA] * t;
    };
    const base = v.base ?? (v.base = v.gh.reduce((m, x) => Math.min(m, x), 1e9));
    const cam = this.game.camera.position;
    const cd = Math.atan2(cam.z - st.z, cam.x - st.x);
    const hotA = v.hotA ?? 0, hotW = v.hotW ?? 0;
    const ride = [];
    v.ride = ride;
    for (const b of v.bandDefs) {
      const head = b.a0 + b.sp * now;
      const da = Math.abs(((head - hotA) % TAU + TAU * 1.5) % TAU - Math.PI);
      const pulse = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(now * b.pf + b.ph), 1.5);
      const i = b.i * k * pulse * (0.8 + 0.7 * hotW * Math.exp(-da * da * 1.5) + 0.15 * Math.min(1, flash));
      if (i < 0.02) continue;
      // each ribbon is born at the foot, climbs the funnel as it orbits and
      // frays out into the cloud at the top, then is born again
      const cyc = (now * b.rate + b.ph / TAU) % 1;
      const hHead = b.h0 + cyc * (1.05 - b.h0);
      const ii = i * Math.min(1, cyc * 6) * (1 - smoothstep(0.7, 1.05, hHead));
      if (ii < 0.02) continue;
      const pts = [], n = 56;
      for (let s = 0; s <= n; s++) {
        const f = s / n, a = head - b.span * f;
        const hf = Math.max(0, hHead - b.climb * f);
        const r = funnelR(v.rb, v.rt, hf) + b.dr + 0.22 * Math.sin(a * 3 + now * 2.1 + b.ph) + 0.08 * Math.sin(a * 11 - now * 5 + b.ph * 2);
        const g = ghAt(a);
        const face = Math.cos(a - cd); // +1 on the side toward the camera
        const fr = smoothstep(-0.75, 0.85, face);
        // brighter on the funnel's silhouette (seen edge-on) and on the near
        // side, dimmer where it crosses behind the army
        const rim = Math.pow(1 - Math.abs(face), 1.4);
        // leading edge: the head swells in from a rounded point to full
        // width and is white-hot; the tail thins and dims behind it
        const lead = smoothstep(0, 0.05, f) * (1 + 0.5 * Math.exp(-f * 14));
        pts.push({
          x: st.x + Math.cos(a) * r,
          y: g + (base - g) * Math.min(1, hf * 2.5) + 0.15 + hf * v.H + b.ya * Math.sin(a * b.yf + now * 2.3 + b.ph),
          z: st.z + Math.sin(a) * r,
          m: (0.22 + 0.3 * fr + 0.75 * rim) * (1 + 2.2 * Math.exp(-f * 10)), wm: lead * (0.75 + 0.45 * rim) * (0.85 + 0.4 * hf),
        });
      }
      const L = layers[b.layer];
      L.push({ pts, w: b.w, i: 0.75 * ii, taper: 0.97, fade: 1 });
      L.push({ pts, w: b.w * 2.6, i: 0.26 * ii, taper: 0.9, fade: 0.97, halo: true });
      if (b.hero < 2) L.push({ pts, w: b.w * 5, i: 0.06 * ii, taper: 0.8, fade: 0.95, halo: true });
      // dust, turf and leaves riding the streak: strung along its first half,
      // drifting back along it, more and bigger on the broad sweeps
      const nr = [26, 16, 8, 4][b.hero] ?? 0;
      for (let q = 0; q < nr; q++) {
        const hq = hash2(q + 17, b.hero + 3);
        const f = ((hq + now * (0.35 + 0.2 * hash2(q, b.hero, 5))) % 1) * 0.75;
        const p = pts[Math.min(n, Math.round(f * n))];
        const jit = (hash2(q, b.hero, 9) - 0.5) * (0.9 + b.w * 2), jy = (hash2(q, b.hero, 11) - 0.5) * (0.6 + b.w * 2);
        const a = head - b.span * f;
        const kind = q % 3; // 0 earth, 1 leaf, 2 dust mote
        const sz = (kind === 0 ? 0.1 + 0.14 * hq : kind === 1 ? 0.12 + 0.06 * hq : 0.05 + 0.04 * hq) * (0.7 + b.w) * Math.min(1, ii * 1.5) * smoothstep(0.75, 0.55, f);
        ride.push({ x: p.x + Math.cos(a) * jit, y: p.y + jy, z: p.z + Math.sin(a) * jit,
          rx: now * (4 + q % 5) + q, ry: a, rz: now * (3 + q % 4) - q, s: sz,
          sy: kind === 1 ? 0.18 : 1, sx: kind === 1 ? 1.6 : 1,
          color: kind === 0 ? (q & 4 ? 0x6a5238 : 0x4a3a2c) : kind === 1 ? (q & 4 ? 0x5f8a34 : 0x86a03a) : 0x9a8a7a, glow: kind === 2 && q % 2 === 0 });
      }
    }
    v.ride = ride;
    [v.bands, v.bands2].forEach((m, j) => {
      if (m.geometry !== this._emptyGeo) m.geometry.dispose();
      m.geometry = layers[j].length ? ribbonGeometry(layers[j]) : this._emptyGeo;
      m.visible = layers[j].length > 0;
    });
  }

  // Motion trails of the men carried round the funnel: a violet streak from
  // the waist back along the last ~0.4 s of flight, fading to nothing.
  renderTrails(st, v, airborne, k) {
    const lines = [];
    let rim = 0;
    this.rimPool = this.rimPool || [];
    for (const u of airborne) {
      const a = u.gp_air, tr = a?.trail;
      if (!tr || tr.length < 12 || (a.vortex !== st && !a.flung) || u.airY < 0.4) continue;
      const n = tr.length / 3, pts = [];
      for (let i = n - 1; i >= 0; i--) pts.push({ x: tr[i * 3], y: tr[i * 3 + 1], z: tr[i * 3 + 2] });
      const i0 = 0.8 * k * Math.min(1, u.airY / 1.5);
      lines.push({ pts, w: 0.15, i: i0 * 1.3, taper: 0.9, fade: 1 });
      lines.push({ pts, w: 0.55, i: i0 * 0.5, taper: 0.8, fade: 1, halo: true });
      // a violet back light just behind the man (depth-tested, so his body
      // masks its centre): each flying figure reads as a dark silhouette with
      // a glowing rim against the storm, not one more red chunk in a heap
      if (rim < 24) {
        const g = this.rimPool[rim] || (this.rimPool[rim] = this.glowSprite(0xc8d8ff, 43, 0, true));
        const cam = this.game.camera.position, t = tr.length - 3;
        this._v.set(tr[t] - cam.x, 0, tr[t + 2] - cam.z).normalize().multiplyScalar(0.6);
        g.position.set(tr[t] + this._v.x, tr[t + 1] + 0.1, tr[t + 2] + this._v.z);
        g.scale.setScalar(2.0);
        g.material.uniforms.uO.value = 0.75 * k * Math.min(1, u.airY / 1.5);
        g.visible = true;
        rim++;
      }
    }
    if (v.trails.geometry !== this._emptyGeo) v.trails.geometry.dispose();
    v.trails.geometry = lines.length ? ribbonGeometry(lines) : this._emptyGeo;
    v.trails.visible = lines.length > 0;
  }

  // Debris torn up and whirled round the funnel (visual only, a function of
  // time): picked up at the foot ring, spiralling up and out with the spin.
  pulledDebris(st, v, now, k, out) {
    if (k <= 0.05) return;
    const TAU = Math.PI * 2, NA = v.gh.length;
    const base = v.base ?? (v.base = v.gh.reduce((m, x) => Math.min(m, x), 1e9));
    for (const d of v.pull) {
      const u = (now * d.rate + d.ph) % 1;
      const hf = Math.pow(u, 1.3) * 0.85;
      const a = d.a + d.w * now + u * 5.5;
      const r = funnelR(v.rb, v.rt, hf) + d.dr * (1 - 0.5 * u);
      const gi = Math.floor((((a % TAU) + TAU) % TAU) / TAU * NA) % NA;
      const g = v.gh[gi];
      out.push({ x: st.x + Math.cos(a) * r, y: g + (base - g) * Math.min(1, hf * 2.5) + 0.1 + hf * v.H, z: st.z + Math.sin(a) * r,
        rx: d.rx * now, ry: a, rz: d.rz * now, sy: d.sy,
        s: d.s * (1 - u * 0.4) * Math.min(1, k * 1.5) * Math.min(1, (1 - u) * 5) * Math.min(1, u * 12), color: d.color ?? d.col, glow: d.glow, u });
    }
  }

  renderShadows(list) {
    const o = this._o, c = this._c, map = this.game.map;
    let n = 0;
    for (const u of list) {
      if (n >= 48 || !(u.airY > 0.15) || u.dead) continue;
      const h = u.airY;
      o.position.set(u.x, map.heightAt(u.x, u.z) + 0.07, u.z);
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(0.85 + h * 0.09);
      o.updateMatrix();
      this.shadows.setMatrixAt(n, o.matrix);
      this.shadows.setColorAt(n, c.setRGB(0.8 * Math.max(0.35, 1 - h / 14), 0, 0));
      n++;
    }
    this.shadows.count = n;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadows.instanceColor.needsUpdate = true;
  }

  // Spark streaks, rebuilt each frame: one soft quad per spark from its head
  // back along its velocity (motion blur), coloured by its temperature.
  renderSparks(mesh, list, now) {
    const pos = [], tan = [], side = [], w = [], col = [], tt = [], idx = [];
    const c = this._c;
    let n = 0;
    for (const p of list) {
      if (n >= SPARK_MAX) break;
      const k = (now - p.t0) / p.life;
      if (k < 0 || k >= 1) continue;
      const T = (p.heat ?? 1) * Math.pow(1 - k, 0.8) * (p.dim ?? 1);
      sparkColor(T, c);
      const sp = Math.hypot(p.vx, p.vy, p.vz), L = Math.max(0.12, Math.min(1.1, sp * 0.05)) / Math.max(1e-3, sp);
      const tx = -p.vx * L, ty = -p.vy * L, tz = -p.vz * L;
      const ww = 0.065 * (0.6 + 0.6 * (1 - k));
      const base = n * 4;
      for (let e = 0; e < 2; e++) {
        const px = p.x + tx * e, py = p.y + ty * e, pz = p.z + tz * e;
        for (const sd of [-1, 1]) {
          pos.push(px, py, pz); tan.push(tx, ty, tz); side.push(sd); w.push(ww * (1 - e * 0.5));
          col.push(c.r, c.g, c.b); tt.push(e);
        }
      }
      idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
      n++;
    }
    if (mesh.geometry !== this._emptyGeo) mesh.geometry.dispose();
    if (!n) { mesh.geometry = this._emptyGeo; mesh.visible = false; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(w, 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
    g.setIndex(idx);
    mesh.geometry = g;
    mesh.visible = true;
  }

  renderDebris(list, now, pulled = []) {
    const o = this._o, c = this._c;
    let n = 0, ne = 0;
    for (const d of list) {
      const fade = d.settled ? Math.min(1, Math.max(0, (d.die - now) / 1.5)) : 1;
      if (fade <= 0) continue;
      const hot = d.ember ? Math.max(0, 1 - (now - d.t0) / d.cool) : 0;
      o.position.set(d.x, d.y - (1 - fade) * d.s, d.z);
      o.rotation.set(d.rx, d.ry, d.rz);
      o.scale.setScalar(d.s);
      o.updateMatrix();
      if (d.ember && hot > 0.05 && ne < EMBER_MAX) {
        this.embers.setMatrixAt(ne, o.matrix);
        if (d.blue) this.embers.setColorAt(ne, c.setRGB(1.6 * hot * hot + 0.05, 2.2 * hot * hot + 0.12, 3.2 * hot + 0.3));
        else this.embers.setColorAt(ne, c.setRGB(4.5 * hot + 0.3, 1.6 * hot * hot + 0.1, 0.25 * hot));
        ne++;
      } else if (n < DEBRIS_MAX) {
        this.debris.setMatrixAt(n, o.matrix);
        this.debris.setColorAt(n, c.setHex(d.color));
        n++;
      }
    }
    for (const d of pulled) {
      if (d.s <= 0.01) continue;
      o.position.set(d.x, d.y, d.z);
      o.rotation.set(d.rx, d.ry, d.rz);
      o.scale.set(d.s * (d.sx ?? 1), d.s * (d.sy ?? 1), d.s);
      o.updateMatrix();
      if (d.glow && ne < EMBER_MAX) {
        this.embers.setMatrixAt(ne, o.matrix);
        this.embers.setColorAt(ne, c.setRGB(1.6, 0.9, 3.2));
        ne++;
      } else if (!d.glow && n < DEBRIS_MAX) {
        this.debris.setMatrixAt(n, o.matrix);
        this.debris.setColorAt(n, c.setHex(d.color));
        n++;
      }
    }
    this.debris.count = n;
    this.embers.count = ne;
    this.debris.instanceMatrix.needsUpdate = true;
    this.debris.instanceColor.needsUpdate = true;
    this.embers.instanceMatrix.needsUpdate = true;
    this.embers.instanceColor.needsUpdate = true;
  }

  makeStorm(st) {
    const R = st.radius;
    const heightAt = (x, z) => this.game.map.heightAt(x, z);
    // the funnel: a ground ring just inside the strike radius flaring out
    // as it climbs into the cloud
    const rb = R * 0.85, rt = R * 1.18, H = 11, DUST_H = 4.2;
    // ground heights round the foot ring, smoothed along the circle so the
    // foot and the bands glide over voxel steps
    const NA = 256, gh = new Float32Array(NA), raw = new Float32Array(NA);
    for (let i = 0; i < NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      raw[i] = heightAt(st.x + Math.cos(a) * rb, st.z + Math.sin(a) * rb);
    }
    for (let i = 0; i < NA; i++) {
      let m = -1e9, sum = 0;
      for (let d = -6; d <= 6; d++) { const h = raw[(i + d + NA) % NA]; sum += h; m = Math.max(m, h); }
      gh[i] = Math.max(sum / 13, m - 0.35);
    }
    const curtain = this.addMesh(new THREE.Mesh(funnelGeometry(gh, rb, rt, H), wallMat()), 45);
    curtain.material.uniforms.uH.value = H;
    curtain.position.set(st.x, 0, st.z);
    const fg = funnelGeometry(gh, rb * 0.97, rt * 0.97, H, 160, 22);
    const bodyBack = this.addMesh(new THREE.Mesh(fg, bodyMat(false)), 40);
    const bodyFront = this.addMesh(new THREE.Mesh(fg, bodyMat(true)), 44);
    for (const m of [bodyBack, bodyFront]) { m.material.uniforms.uH.value = H; m.position.set(st.x, 0, st.z); }
    const ground = this.addMesh(new THREE.Mesh(groundRingGeometry(heightAt, st.x, st.z, rb, rb * 0.8, rb * 1.75), groundRingMat()), 6);
    ground.position.set(st.x, 0, st.z);
    const trails = this.addMesh(new THREE.Mesh(new THREE.BufferGeometry(), makeRibbonMaterial(new THREE.Color(0x8a60ff), new THREE.Color(0xe8dcff), 1.2, new THREE.Color(0x6a30ff))), 47);
    const dust = this.addMesh(new THREE.Mesh(funnelGeometry(gh, rb * 0.98, rb * 1.4, DUST_H, 160, 8), dustMat()), 30);
    dust.material.uniforms.uH.value = DUST_H;
    dust.position.set(st.x, 0, st.z);
    const rain = this.addMesh(new THREE.LineSegments(rainGeometry(st.t0 * 1000 | 0, R), rainMat()), 46);
    const rng = new RNG((st.t0 * 1000 | 0) ^ 0x9e3779b9);
    // energy ribbons spiralling up the funnel (the Retold vortex): a few
    // broad bright sweeps, a middle rank and many hair-thin strands, each a
    // white-hot head tapering into a violet or blue tail, climbing as it
    // orbits with the spin
    // (round 13: a dozen equal white arcs read as noise. Now four streaks
    // with a clear hierarchy - one broad hero sweep, one strong second, two
    // thin accents - each a hot leading edge thinning into a long tail, set
    // round the funnel at different heights so the spin reads)
    const bandDefs = [];
    const HERO = [
      { w: 0.46, i: 1.0, span: 2.5, h0: 0.08, climb: 0.3, a: 0.0 },
      { w: 0.28, i: 0.95, span: 2.0, h0: 0.28, climb: 0.35, a: 2.3 },
      { w: 0.15, i: 0.85, span: 1.6, h0: 0.02, climb: 0.2, a: 4.1 },
      { w: 0.08, i: 0.75, span: 1.3, h0: 0.45, climb: 0.3, a: 5.2 },
    ];
    for (let j = 0; j < HERO.length; j++) {
      const H0 = HERO[j];
      bandDefs.push({
        layer: j === 2 ? 1 : 0, hero: j,
        a0: H0.a + rng.range(-0.3, 0.3), sp: 1.55 + j * 0.18, span: H0.span,
        h0: H0.h0, climb: H0.climb, dr: rng.range(-0.1, 0.25), ya: rng.range(0.1, 0.25),
        yf: rng.int(2, 4), ph: rng.range(0, 6.28), pf: rng.range(1.2, 2), rate: rng.range(0.1, 0.16),
        w: H0.w, i: H0.i,
      });
    }
    const bands = this.addMesh(new THREE.Mesh(new THREE.BufferGeometry(), makeRibbonMaterial(new THREE.Color(0x7a50ff), new THREE.Color(0xf2eaff), 1.9, new THREE.Color(0x9a28ff))), 48);
    const bands2 = this.addMesh(new THREE.Mesh(new THREE.BufferGeometry(), makeRibbonMaterial(new THREE.Color(0x4f8cff), new THREE.Color(0xeef6ff), 1.9, new THREE.Color(0x5a3dff))), 48);
    // debris torn out of the ground and whirled up the funnel: earth clods,
    // turf and stones, grass tufts (tall thin blades) and a few glowing motes
    const pull = [];
    const EARTH = [0x6a5238, 0x584330, 0x7a6a5c, 0x4a3a2c, 0x8a8078];
    const TURF = [0x4e7a2e, 0x5f8a34, 0x3f6526, 0x6f9a3a];
    for (let j = 0; j < 130; j++) {
      const kind = j % 5 === 0 ? 'glow' : j % 5 < 3 ? 'earth' : 'grass';
      pull.push({ a: rng.range(0, Math.PI * 2), w: rng.range(0.7, 1.3), rate: rng.range(0.16, 0.34), ph: rng.next(),
        dr: rng.range(-0.8, 0.9), s: kind === 'earth' ? rng.range(0.1, 0.26) : kind === 'grass' ? rng.range(0.06, 0.1) : rng.range(0.05, 0.1),
        sy: kind === 'grass' ? rng.range(2.5, 4) : 1,
        col: kind === 'earth' ? rng.pick(EARTH) : rng.pick(TURF), glow: kind === 'glow', rx: rng.range(-9, 9), rz: rng.range(-9, 9) });
    }
    const v = { curtain, dust, rain, bands, bands2, bandDefs, gh, pull, rb, rt, H, bodyBack, bodyFront, ground, trails, fg };
    this.stormVisuals.set(st, v);
    return v;
  }
}
