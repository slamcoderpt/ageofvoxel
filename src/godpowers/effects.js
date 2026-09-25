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
//  - Storm: multiplicative storm-shadow over the area (flash-lit), swirling
//    cloud vortex framing the target from the viewer, rain streaks, an
//    animated electric boundary ring and intra-cloud lightning.
//  - Zaps: little arcs crawling over struck units.
//  - Meteor: falling fireball with a flame trail, warning ring, fire-orange
//    impact flash/shockwave and a large glowing crater.

const BLUE = new THREE.Color(0x2a78ff);
const WHITE = new THREE.Color(0xe6f2ff);

// ---------------------------------------------------------------- ribbons
const ribbonVS = `
  attribute vec3 aTan; attribute float aSide; attribute float aW; attribute float aI; attribute float aCore;
  varying float vSide; varying float vI; varying float vCore;
  void main(){
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 t = normalize(mat3(modelMatrix) * aTan);
    vec3 v = normalize(cameraPosition - wp);
    vec3 s = cross(t, v);
    float l = length(s);
    s = l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
    wp += s * aSide * aW;
    vSide = aSide; vI = aI; vCore = aCore;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

function makeRibbonMaterial(halo, core, coreGain = 4.0) {
  return new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 1 }, uHalo: { value: halo.clone() }, uCore: { value: core.clone() }, uGain: { value: coreGain } },
    vertexShader: ribbonVS,
    fragmentShader: `uniform float uAlpha; uniform vec3 uHalo; uniform vec3 uCore; uniform float uGain;
      varying float vSide; varying float vI; varying float vCore;
      void main(){
        float e = abs(vSide);
        float core = (1.0 - smoothstep(0.08, 0.3, e)) * vCore;
        float halo = pow(1.0 - e, 3.0) * (1.0 - vCore * 0.25) + (1.0 - vCore) * pow(1.0 - e, 7.0) * 0.6;
        vec3 col = uHalo * halo * 1.1 + uCore * core * uGain;
        float a = clamp(uAlpha * vI, 0.0, 4.0);
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}

// lines: [{ pts: [{x,y,z}], w, i, taper }]
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
      const ww = L.w * (1 - f * (L.taper ?? 0.5));
      const ii = L.i * (L.fade ? 1 - f * L.fade : 1);
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

export function boltLines(seed, x, groundY, z, heightAt, height = 42) {
  const rng = new RNG(seed);
  const lines = [];
  const top = { x: x + rng.range(-3.5, 3.5), y: groundY + height, z: z + rng.range(-3.5, 3.5) };
  const main = fractalPath(rng, top, { x, y: groundY + 0.05, z }, 6, 0.09);
  lines.push({ pts: main, w: 1.35, i: 1.25, taper: 0.05 });
  // wide soft sheath of ionised air round the channel (halo only, no core)
  lines.push({ pts: main, w: 2.4, i: 0.12, taper: 0.3, halo: true });
  // forks and sub-forks peel off the main channel
  const nf = rng.int(4, 7);
  for (let f = 0; f < nf; f++) {
    const i = rng.int(6, main.length - 12);
    const p = main[i];
    const len = rng.range(3, 11) * (1 - i / main.length * 0.5);
    const a = rng.range(0, Math.PI * 2);
    const end = { x: p.x + Math.cos(a) * len, y: p.y - len * rng.range(0.7, 1.5), z: p.z + Math.sin(a) * len };
    const fork = fractalPath(rng, p, end, 4, 0.14);
    lines.push({ pts: fork, w: 0.75, i: 0.85, taper: 0.8, fade: 0.7 });
    if (rng.chance(0.6)) {
      const j = rng.int(3, fork.length - 4), q = fork[j], l2 = len * 0.45, b2 = a + rng.range(-1.2, 1.2);
      lines.push({ pts: fractalPath(rng, q, { x: q.x + Math.cos(b2) * l2, y: q.y - l2, z: q.z + Math.sin(b2) * l2 }, 3, 0.16), w: 0.32, i: 0.5, taper: 0.9, fade: 0.8 });
    }
  }
  // ground arcs crawling out from the impact
  const na = rng.int(5, 8);
  for (let k = 0; k < na; k++) {
    const a = (k / na) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const len = rng.range(1.6, 3.8);
    const pts = [];
    const n = 9;
    let ox = 0, oz = 0;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      ox += rng.range(-0.25, 0.25); oz += rng.range(-0.25, 0.25);
      const px = x + Math.cos(a) * len * t + ox * t, pz = z + Math.sin(a) * len * t + oz * t;
      pts.push({ x: px, y: heightAt(px, pz) + 0.12 + rng.range(0, 0.2), z: pz });
    }
    lines.push({ pts, w: 0.3, i: 0.9, taper: 0.9, fade: 0.6 });
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
  const lines = [{ pts: main, w: 0.7, i: 0.8, taper: 0.3 }];
  for (let f = 0; f < 3; f++) {
    const p = main[rng.int(4, main.length - 5)], b = a + rng.range(-1.5, 1.5), l = len * 0.35;
    lines.push({ pts: fractalPath(rng, p, { x: p.x + Math.cos(b) * l, y: p.y - rng.range(0, 3), z: p.z + Math.sin(b) * l }, 3, 0.15), w: 0.4, i: 0.55, taper: 0.9 });
  }
  return lines;
}

function zapLines(seed, h) {
  const rng = new RNG(seed);
  const lines = [];
  for (let k = 0; k < 4; k++) {
    const a0 = rng.range(0, Math.PI * 2);
    const pts = [];
    for (let s = 0; s <= 7; s++) {
      const a = a0 + s * rng.range(0.3, 0.7), r = rng.range(0.25, 0.5);
      pts.push({ x: Math.cos(a) * r, y: rng.range(0.1, h), z: Math.sin(a) * r });
    }
    lines.push({ pts, w: 0.22, i: 1, taper: 0.4 });
  }
  return lines;
}

// Small arc crawling along the storm perimeter: hops between points on the
// (wobbly) boundary, lifted off the ground in little jagged loops.
function rimLines(seed, cx, cz, R, a0, span, heightAt) {
  const rng = new RNG(seed);
  const n = 14, pts = [];
  for (let s = 0; s <= n; s++) {
    const a = a0 + span * (s / n);
    const r = R + rng.range(-0.45, 0.45);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const lift = Math.sin((s / n) * Math.PI) * rng.range(0.3, 1.1);
    pts.push({ x, y: heightAt(x, z) + 0.2 + lift, z });
  }
  const lines = [{ pts, w: 0.34, i: 0.8, taper: 0.3 }];
  // a leg or two stabbing down to the ground
  for (let k = 0; k < 2; k++) {
    const p = pts[rng.int(3, n - 3)];
    lines.push({ pts: fractalPath(rng, p, { x: p.x + rng.range(-0.6, 0.6), y: heightAt(p.x, p.z) + 0.05, z: p.z + rng.range(-0.6, 0.6) }, 2, 0.25), w: 0.2, i: 0.6, taper: 0.6 });
  }
  return lines;
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
      // wandering centre line: slow large wobble + fast jagged jitter
      float wob = (vn(ang * 3.0 + uTime * 0.7) - 0.5) * 0.9 + (vn(ang * 70.0 + ft * 5.3) - 0.5) * 0.3;
      float bb = b - wob;
      // stretches of the perimeter flare up and die out
      float live = smoothstep(0.35, 0.75, vn(ang * 5.0 - uTime * 2.3 + 11.0));
      float spark = step(0.93, h(floor(ang * 90.0) * 1.7 + ft));
      float core = exp(-bb * bb * 60.0) * (0.25 + 0.9 * live) + exp(-bb * bb * 200.0) * spark * 1.4;
      float glow = exp(-bb * bb * 9.0) * (0.02 + 0.07 * live);
      float a = (core * 0.55 + glow) * uK * (1.0 + uFlash * 0.4);
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
});

// Full-frame storm grade, drawn after the opaque world and before the
// additive effects with multiplicative blending (dst * src). Each pixel's
// view ray is intersected with the ground plane so the darkening, drifting
// cloud shadows and the blue-white light pools under each bolt are placed in
// world space (perspective-correct ellipses that sit on the terrain). Pools
// go above 1 in the HDR buffer, so they relight the albedo of the grass,
// units and walls near the strike rather than pasting a glow over them.
const MAX_POOLS = 6;
const stormGradeMat = () => new THREE.ShaderMaterial({
  uniforms: {
    uInvVP: { value: new THREE.Matrix4() }, uPlaneY: { value: 0 }, uCenter: { value: new THREE.Vector2() },
    uR: { value: 10 }, uK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 },
    uPools: { value: Array.from({ length: MAX_POOLS }, () => new THREE.Vector4()) },
    uPoolCol: { value: new THREE.Color(0.95, 1.15, 1.7) },
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
      float inside = 1.0 - smoothstep(0.75, 2.4, r);
      vec2 q = g * 0.055 + vec2(uTime * 0.09, uTime * 0.035);
      float n = vn(q) * 0.6 + vn(q * 2.7 + 7.1) * 0.4;
      vec3 far = vec3(0.2, 0.235, 0.34);
      vec3 near = vec3(0.125, 0.155, 0.25);
      vec3 m = mix(far, near, inside) * (0.78 + 0.4 * n);
      m += vec3(0.07, 0.09, 0.15) * uFlash * (0.35 + 0.65 * inside);
      m = mix(vec3(1.0), m, uK);
      float pool = 0.0;
      for (int i = 0; i < ${MAX_POOLS}; i++) {
        vec4 P = uPools[i];
        if (P.z <= 0.0) continue;
        float dd = length(g - P.xy) / P.w;
        pool += P.z * (exp(-dd * dd * 3.0) * 1.3 + exp(-dd * dd * 0.45) * 0.4);
      }
      m += uPoolCol * pool;
      gl_FragColor = vec4(m, 1.0);
    }`,
  transparent: true, depthWrite: false, depthTest: false, fog: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
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

function rainGeometry(seed, R, n = 700) {
  const rng = new RNG(seed);
  const pos = [], aEnd = [], aSeed = [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.next()) * R, s = rng.next();
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
    void main(){ gl_FragColor = vec4(vec3(0.55, 0.65, 0.85) * (0.22 + uFlash * 0.5) * vA * uK, 1.0); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});

// ---------------------------------------------------------------- renderer
const DEBRIS_MAX = 480;
const EMBER_MAX = 96;

export class BoltRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'godpower-fx';
    this.group.userData.noAO = true;
    game.scene.add(this.group);
    this.boltMat = makeRibbonMaterial(BLUE, WHITE, 1.7);
    this.fireMat = makeRibbonMaterial(new THREE.Color(0xff5a10), new THREE.Color(0xffe0a0), 3.0);
    this.meshes = new Map();
    this.lights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xa8c4ff, 0, 16, 2);
      this.group.add(l);
      this.lights.push(l);
    }
    // One shadow-casting spot hangs low over the freshest strike, pointing
    // down: units and walls round the impact throw hard shadows outward.
    this.spot = new THREE.SpotLight(0xcfe0ff, 0, 16, 1.3, 0.45, 2);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0006;
    this.spot.shadow.normalBias = 0.03;
    this.spot.shadow.radius = 1;
    this.spot.shadow.camera.near = 0.3;
    this.spot.shadow.camera.far = 16;
    this.spot.visible = false;
    this.group.add(this.spot, this.spot.target);
    // full-frame storm grade + strike light pools
    this.grade = this.addMesh(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stormGradeMat()), 18);
    this.grade.visible = false;
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
    this._c = new THREE.Color();
    this.quadGeo = new THREE.PlaneGeometry(1, 1);
    this.scorchMat = new THREE.MeshBasicMaterial({ map: makeScorchTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.emberMat = new THREE.MeshBasicMaterial({ map: makeEmberTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, color: 0xff7a2a, fog: false });
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.scorchMeshes = new Map();
    this.shockGeo = bandRingGeometry(0.75, 1.0, 48);
    this.shockMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 1 }, uColor: { value: new THREE.Color(0xa8d0ff) } },
      vertexShader: `varying float vB; void main(){ vB = position.y; vec3 p = vec3(position.x, 0.0, position.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `uniform float uA; uniform vec3 uColor; varying float vB; void main(){ float e = exp(-pow(vB - 0.4, 2.0) * 6.0); gl_FragColor = vec4(uColor * e * uA, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
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
  glowSprite(color, order = 60) {
    const m = new THREE.Mesh(this.quadGeo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uO: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sc = length(modelMatrix[0].xyz);
        mv.xy += position.xy * sc;
        gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uO; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0;
          float a = exp(-d * d * 5.0) * 0.8 + exp(-d * d * 40.0) * 1.2;
          a *= 1.0 - smoothstep(0.85, 1.0, d);
          gl_FragColor = vec4(uColor * a * uO, 1.0); }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
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
        const lines = kind === 'sky' ? skyLines(b.seed, b.x, b.y, b.z)
          : kind === 'rim' ? rimLines(b.seed, b.x, b.z, b.r, b.a0, b.span, heightAt)
            : boltLines(b.seed, b.x, b.y, b.z, heightAt);
        const mesh = this.addMesh(new THREE.Mesh(ribbonGeometry(lines), this.boltMat.clone()), kind === 'rim' ? 47 : 52);
        v = { mesh };
        if (kind === 'ground') {
          v.glow = this.glowSprite(0x9cc4ff);
          v.glow.position.set(b.x, b.y + 1.0, b.z);
          v.shock = this.addMesh(new THREE.Mesh(this.shockGeo, this.shockMat.clone()), 45);
          v.shock.position.set(b.x, b.y + 0.15, b.z);
        }
        this.meshes.set(b, v);
      }
      const k = age / b.life;
      if (kind === 'rim') {
        // perimeter arcs flicker on and off, always well below the bolts
        const f = Math.floor(now * 30);
        v.mesh.material.uniforms.uAlpha.value = (1 - k) * (hash2(f, b.seed & 0xffff, 5) > 0.35 ? 0.55 : 0.12);
        continue;
      }
      // return strokes: a couple of re-brightenings, then a fast decay
      const strobe = age < 0.06 ? 1.4 : (0.55 + 0.45 * Math.abs(Math.sin(age * 55 + b.seed % 7)));
      const env = Math.pow(1 - k, 1.4) * strobe;
      v.mesh.material.uniforms.uAlpha.value = env * (kind === 'sky' ? 0.8 : 1.15);
      if (kind === 'ground') {
        flash = Math.max(flash, env);
        v.glow.material.uniforms.uO.value = Math.min(0.4, env * 0.35);
        v.glow.scale.setScalar(2.5 + 2 * (1 - k));
        const sk = Math.min(1, age / 0.25);
        v.shock.scale.setScalar(0.6 + Math.sqrt(sk) * 3.0);
        v.shock.material.uniforms.uA.value = Math.pow(1 - sk, 2) * 1.2;
        pools.push({ x: b.x, z: b.z, i: Math.min(0.75, env * 0.6), r: 2.8 + 1.0 * (1 - k) });
        if (!spotB || env > spotEnv) { spotB = b; spotEnv = env; }
        if (li < this.lights.length) {
          const l = this.lights[li++];
          l.color.setHex(0xa8c4ff);
          l.position.set(b.x, b.y + 2.2, b.z);
          l.intensity = 30 * env;
        }
      } else flash = Math.max(flash, env * 0.5);
    }
    for (const [b, v] of this.meshes) {
      if (alive.has(b)) continue;
      this.group.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.material.dispose();
      if (v.glow) { this.group.remove(v.glow, v.shock); v.glow.material.dispose(); v.shock.material.dispose(); }
      this.meshes.delete(b);
    }
    // hard-shadow spot over the brightest strike
    if (spotB) {
      this.spot.visible = true;
      this.spot.position.set(spotB.x + 0.15, spotB.y + 3.4, spotB.z + 0.1);
      this.spot.target.position.set(spotB.x, spotB.y, spotB.z);
      this.spot.target.updateMatrixWorld();
      this.spot.intensity = 90 * Math.min(1.3, spotEnv);
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
        const tm = this.addMesh(new THREE.Mesh(ribbonGeometry([{ pts: trail, w: 1.6, i: 1, taper: 0.9, fade: 1 }]), this.fireMat.clone()), 53);
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
      const size = sc.size ?? 4.4;
      s.scale.setScalar(size);
      e.scale.setScalar(size * 0.5);
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
      v.e.material.color.setRGB(0.5 + 0.7 * heat, 0.12 + heat * 0.45, 0.04 + heat * 0.35);
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
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;

    // ---- zaps on struck units
    const aliveZ = new Set(zaps);
    for (const z of zaps) {
      let m = this.zapMeshes.get(z);
      if (!m) {
        m = this.addMesh(new THREE.Mesh(ribbonGeometry(zapLines(z.seed, z.h)), this.boltMat.clone()), 54);
        this.zapMeshes.set(z, m);
      }
      const age = now - z.t0, k = age / z.life;
      const f = Math.floor(now * 30);
      if (z.u) m.position.set(z.u.x, game.map.heightAt(z.u.x, z.u.z) + (z.u.airY || 0), z.u.z);
      else m.position.set(z.x, z.y, z.z);
      m.rotation.y = f * 2.1 + z.seed;
      m.scale.y = 0.8 + hash2(f, z.seed) * 0.4;
      m.material.uniforms.uAlpha.value = (1 - k) * (hash2(f, z.seed, 3) > 0.3 ? 1 : 0.15) * 0.9;
    }
    for (const [z, m] of this.zapMeshes) {
      if (aliveZ.has(z)) continue;
      this.group.remove(m); m.geometry.dispose(); m.material.dispose();
      this.zapMeshes.delete(z);
    }

    // ---- thrown debris
    this.renderDebris(state.debris || [], now);

    // ---- storms
    const aliveStorms = new Set();
    let gradeK = 0, gst = null;
    for (const st of storms) {
      aliveStorms.add(st);
      let v = this.stormVisuals.get(st);
      if (!v) v = this.makeStorm(st);
      const y = heightAt(st.x, st.z);
      const age = now - st.t0;
      const k = Math.min(1, age / 1.0) * Math.min(1, Math.max(0, (st.t0 + st.duration - now) / 1.5));
      const fl = Math.min(1.5, flash);
      if (k >= gradeK) { gradeK = k; gst = st; }
      v.ring.position.set(st.x, y + 0.15, st.z);
      v.ring.material.uniforms.uK.value = k * 0.75;
      v.ring.material.uniforms.uTime.value = now;
      v.ring.material.uniforms.uFlash.value = fl;
      v.rain.position.set(st.x, y, st.z);
      v.rain.material.uniforms.uK.value = k;
      v.rain.material.uniforms.uTime.value = now;
      v.rain.material.uniforms.uFlash.value = fl;
    }
    for (const [st, v] of this.stormVisuals) {
      if (aliveStorms.has(st)) continue;
      this.group.remove(v.ring, v.rain);
      v.ring.geometry.dispose(); v.ring.material.dispose();
      v.rain.geometry.dispose(); v.rain.material.dispose();
      this.stormVisuals.delete(st);
    }

    // ---- storm grade + light pools (one full-frame pass)
    const U = this.grade.material.uniforms;
    this.grade.visible = gradeK > 0 || pools.length > 0;
    if (this.grade.visible) {
      const cam = game.camera;
      cam.updateMatrixWorld();
      U.uInvVP.value.multiplyMatrices(cam.matrixWorld, this._m4.copy(cam.projectionMatrix).invert());
      U.uK.value = gradeK;
      U.uFlash.value = Math.min(1.5, flash);
      U.uTime.value = now;
      if (gst) { U.uCenter.value.set(gst.x, gst.z); U.uR.value = gst.radius; U.uPlaneY.value = heightAt(gst.x, gst.z); }
      else if (pools.length) U.uPlaneY.value = heightAt(pools[0].x, pools[0].z);
      for (let i = 0; i < MAX_POOLS; i++) {
        const p = pools[i];
        if (p) U.uPools.value[i].set(p.x, p.z, p.i, p.r);
        else U.uPools.value[i].set(0, 0, 0, 1);
      }
    }
  }

  renderDebris(list, now) {
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
        this.embers.setColorAt(ne, c.setRGB(4.5 * hot + 0.3, 1.6 * hot * hot + 0.1, 0.25 * hot));
        ne++;
      } else if (n < DEBRIS_MAX) {
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
    const ring = this.addMesh(new THREE.Mesh(bandRingGeometry(R - 0.9, R + 0.9, 192), ringMat(0)), 44);
    const rain = this.addMesh(new THREE.LineSegments(rainGeometry(st.t0 * 1000 | 0, R * 1.25), rainMat()), 46);
    const v = { ring, rain };
    this.stormVisuals.set(st, v);
    return v;
  }
}
