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
  attribute vec3 aTan; attribute float aSide; attribute float aW; attribute float aI;
  varying float vSide; varying float vI;
  void main(){
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 t = normalize(mat3(modelMatrix) * aTan);
    vec3 v = normalize(cameraPosition - wp);
    vec3 s = cross(t, v);
    float l = length(s);
    s = l > 1e-4 ? s / l : vec3(1.0, 0.0, 0.0);
    wp += s * aSide * aW;
    vSide = aSide; vI = aI;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;

function makeRibbonMaterial(halo, core, coreGain = 4.0) {
  return new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 1 }, uHalo: { value: halo.clone() }, uCore: { value: core.clone() }, uGain: { value: coreGain } },
    vertexShader: ribbonVS,
    fragmentShader: `uniform float uAlpha; uniform vec3 uHalo; uniform vec3 uCore; uniform float uGain;
      varying float vSide; varying float vI;
      void main(){
        float e = abs(vSide);
        float core = 1.0 - smoothstep(0.1, 0.26, e);
        float halo = pow(1.0 - e, 3.0);
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
  const pos = [], tan = [], side = [], w = [], inten = [], idx = [];
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
  const top = { x: x + rng.range(-7, 7), y: groundY + height, z: z + rng.range(-7, 7) };
  const main = fractalPath(rng, top, { x, y: groundY + 0.05, z }, 6, 0.09);
  lines.push({ pts: main, w: 0.8, i: 1, taper: 0.1 });
  // forks and sub-forks peel off the main channel
  const nf = rng.int(4, 7);
  for (let f = 0; f < nf; f++) {
    const i = rng.int(6, main.length - 12);
    const p = main[i];
    const len = rng.range(3, 11) * (1 - i / main.length * 0.5);
    const a = rng.range(0, Math.PI * 2);
    const end = { x: p.x + Math.cos(a) * len, y: p.y - len * rng.range(0.7, 1.5), z: p.z + Math.sin(a) * len };
    const fork = fractalPath(rng, p, end, 4, 0.14);
    lines.push({ pts: fork, w: 0.5, i: 0.75, taper: 0.8, fade: 0.7 });
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
  return canvasTex(128, (ctx, S) => {
    const rng = new RNG(99);
    const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2 - 1);
    g.addColorStop(0, 'rgba(14,11,9,0.95)');
    g.addColorStop(0.45, 'rgba(26,20,15,0.75)');
    g.addColorStop(0.8, 'rgba(34,27,20,0.25)');
    g.addColorStop(1, 'rgba(34,27,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // soot splatter
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(0.25, 0.48) * S;
      ctx.fillStyle = `rgba(18,14,10,${rng.range(0.2, 0.6)})`;
      ctx.beginPath();
      ctx.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rng.range(1, 4), 0, Math.PI * 2);
      ctx.fill();
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
    for (let k = 0; k < 7; k++) crack(S / 2, S / 2, (k / 7) * Math.PI * 2 + rng.range(-0.3, 0.3), S * rng.range(0.25, 0.42), 3.2);
  });
}

// ---------------------------------------------------------------- materials
const ringMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uColor: { value: new THREE.Color(0x7fc0ff) }, uFlash: { value: 0 } },
  vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uTime; uniform float uK; uniform vec3 uColor; uniform float uFlash; varying vec3 vP;
    float h(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      float r = length(vP.xz);
      float ang = atan(vP.z, vP.x);
      // band coordinate: vP.y carries the normalised band position (-1..1)
      float b = vP.y;
      float seg = floor((ang + 3.14159) * 20.0 + uTime * 6.0);
      float crackle = 0.55 + 0.45 * h(seg + floor(uTime * 20.0));
      float edge = exp(-b * b * 18.0) * crackle;
      float glow = exp(-b * b * 3.0) * 0.35;
      float dash = step(0.5, fract((ang + 3.14159) * 7.6394 - uTime * 0.4)) * exp(-pow(b + 0.7, 2.0) * 30.0) * 0.6;
      float a = (edge * 0.7 + glow * 0.5 + dash) * uK * (1.0 + uFlash * 0.3);
      gl_FragColor = vec4(uColor * a, 1.0);
    }`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false,
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

const shadowMat = () => new THREE.ShaderMaterial({
  uniforms: { uK: { value: 0 }, uFlash: { value: 0 }, uR: { value: 10 } },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uK; uniform float uFlash; uniform float uR; varying vec3 vP;
    void main(){
      float r = length(vP.xz) / uR;
      float m = 1.0 - smoothstep(0.3, 1.0, r);
      float w = m * uK;
      vec3 c = mix(vec3(1.0), vec3(0.13, 0.16, 0.3), w) + vec3(0.1, 0.13, 0.26) * (uFlash * w);
      gl_FragColor = vec4(c, 1.0);
    }`,
  transparent: true, depthWrite: false, depthTest: false, fog: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
});

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
      const l = new THREE.PointLight(0xa8c4ff, 0, 30, 1.1);
      this.group.add(l);
      this.lights.push(l);
    }
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
    // ---- bolts
    const alive = new Set();
    let li = 0;
    const sorted = bolts.slice().sort((a, b) => b.t0 - a.t0);
    for (const b of sorted) {
      const age = now - b.t0;
      if (age > b.life) continue;
      alive.add(b);
      let v = this.meshes.get(b);
      if (!v) {
        const sky = b.kind === 'sky';
        const lines = sky ? skyLines(b.seed, b.x, b.y, b.z) : boltLines(b.seed, b.x, b.y, b.z, heightAt);
        const mesh = this.addMesh(new THREE.Mesh(ribbonGeometry(lines), this.boltMat.clone()), 52);
        v = { mesh };
        if (!sky) {
          v.glow = this.glowSprite(0x9cc4ff);
          v.glow.position.set(b.x, b.y + 1.0, b.z);
          v.shock = this.addMesh(new THREE.Mesh(this.shockGeo, this.shockMat.clone()), 45);
          v.shock.position.set(b.x, b.y + 0.15, b.z);
        }
        this.meshes.set(b, v);
      }
      const k = age / b.life;
      // return strokes: a couple of re-brightenings, then a fast decay
      const strobe = age < 0.06 ? 1.4 : (0.55 + 0.45 * Math.abs(Math.sin(age * 55 + b.seed % 7)));
      const env = Math.pow(1 - k, 1.4) * strobe;
      v.mesh.material.uniforms.uAlpha.value = env * (b.kind === 'sky' ? 0.8 : 1);
      if (b.kind !== 'sky') {
        flash = Math.max(flash, env);
        v.glow.material.uniforms.uO.value = Math.min(0.7, env * 0.6);
        v.glow.scale.setScalar(4 + 3 * (1 - k));
        const sk = Math.min(1, age / 0.45);
        v.shock.scale.setScalar(0.6 + sk * 3.2);
        v.shock.material.uniforms.uA.value = (1 - sk) * 2.0;
        if (li < this.lights.length) {
          const l = this.lights[li++];
          l.color.setHex(0xa8c4ff);
          l.position.set(b.x, b.y + 3, b.z);
          l.intensity = 140 * env;
        }
      } else flash = Math.max(flash, env * 0.5);
    }
    for (const [b, v] of this.meshes) {
      if (alive.has(b)) continue;
      this.group.remove(v.mesh); v.mesh.geometry.dispose(); v.mesh.material.dispose();
      if (v.glow) { this.group.remove(v.glow, v.shock); v.glow.material.dispose(); v.shock.material.dispose(); }
      this.meshes.delete(b);
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
        const warn = this.addMesh(new THREE.Mesh(bandRingGeometry(m.radius - 0.5, m.radius + 0.5, 96), ringMat()), 44);
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
        l.intensity = 80;
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
      const e = this.addMesh(new THREE.Mesh(this.decalGeo, this.emberMat.clone()), 6);
      const size = sc.size ?? 3.4;
      s.scale.setScalar(size);
      e.scale.setScalar(size * 0.8);
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
      const heat = Math.exp(-age / (sc.blast ? 2.5 : 1.1));
      v.e.material.opacity = Math.min(1, heat * 1.4);
      v.e.material.color.setRGB(1.0 * (0.6 + heat), 0.35 + heat * 0.5, 0.1 + heat * 0.5);
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
          l.intensity = 120 * (1 - k);
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
      m.position.set(z.x, z.y, z.z);
      m.rotation.y = f * 2.1 + z.seed;
      m.scale.y = 0.8 + hash2(f, z.seed) * 0.4;
      m.material.uniforms.uAlpha.value = (1 - k) * (hash2(f, z.seed, 3) > 0.3 ? 1 : 0.15) * 0.9;
    }
    for (const [z, m] of this.zapMeshes) {
      if (aliveZ.has(z)) continue;
      this.group.remove(m); m.geometry.dispose(); m.material.dispose();
      this.zapMeshes.delete(z);
    }

    // ---- storms
    const aliveStorms = new Set();
    for (const st of storms) {
      aliveStorms.add(st);
      let v = this.stormVisuals.get(st);
      if (!v) v = this.makeStorm(st);
      const y = heightAt(st.x, st.z);
      const age = now - st.t0;
      const k = Math.min(1, age / 1.0) * Math.min(1, Math.max(0, (st.t0 + st.duration - now) / 1.5));
      const fl = Math.min(1.5, flash);
      v.shadow.position.set(st.x, y + 0.3, st.z);
      v.shadow.material.uniforms.uK.value = k;
      v.shadow.material.uniforms.uFlash.value = fl;
      v.ring.position.set(st.x, y + 0.15, st.z);
      v.ring.material.uniforms.uK.value = k * 0.9;
      v.ring.material.uniforms.uTime.value = now;
      v.ring.material.uniforms.uFlash.value = fl;
      v.rain.position.set(st.x, y, st.z);
      v.rain.material.uniforms.uK.value = k;
      v.rain.material.uniforms.uTime.value = now;
      v.rain.material.uniforms.uFlash.value = fl;
    }
    for (const [st, v] of this.stormVisuals) {
      if (aliveStorms.has(st)) continue;
      this.group.remove(v.shadow, v.ring, v.rain);
      v.shadow.geometry.dispose(); v.shadow.material.dispose(); v.ring.geometry.dispose(); v.ring.material.dispose();
      v.rain.geometry.dispose(); v.rain.material.dispose();
      this.stormVisuals.delete(st);
    }
  }

  makeStorm(st) {
    const R = st.radius;
    const shadow = this.addMesh(new THREE.Mesh(new THREE.CircleGeometry(R * 2.4, 64).rotateX(-Math.PI / 2), shadowMat()), -10);
    shadow.material.uniforms.uR.value = R * 2.4;
    const ring = this.addMesh(new THREE.Mesh(bandRingGeometry(R - 0.6, R + 0.6), ringMat()), 44);
    const rain = this.addMesh(new THREE.LineSegments(rainGeometry(st.t0 * 1000 | 0, R * 1.25), rainMat()), 46);
    const v = { shadow, ring, rain };
    this.stormVisuals.set(st, v);
    return v;
  }
}
