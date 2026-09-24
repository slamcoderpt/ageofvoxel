import * as THREE from 'three';
import { RNG } from '../core/rng.js';

// Lightning bolt visuals: a jagged main channel with forks, drawn as crossed
// additive ribbons so it reads from any angle; plus pooled point lights for
// the flash (fixed pool = no shader recompiles) and ground scorch decals.

const boltMat = new THREE.ShaderMaterial({
  uniforms: { uAlpha: { value: 1 } },
  vertexShader: `attribute float aEdge; varying float vEdge; void main(){ vEdge = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform float uAlpha; varying float vEdge;
    void main(){ float core = 1.0 - abs(vEdge); float a = pow(core, 1.5) * uAlpha;
      vec3 c = mix(vec3(0.45, 0.6, 1.0), vec3(1.0), smoothstep(0.55, 0.95, core));
      gl_FragColor = vec4(c * a * 3.0, a); }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
});

export function makeBoltGeometry(seed, x, groundY, z, height = 45) {
  const rng = new RNG(seed);
  const pos = [], edge = [], idx = [];
  const addRibbon = (pts, width) => {
    for (let axis = 0; axis < 2; axis++) {
      const base = pos.length / 3;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const w = width * (1 - (i / pts.length) * 0.4);
        const ox = axis === 0 ? w : 0, oz = axis === 1 ? w : 0;
        pos.push(p.x - ox, p.y, p.z - oz, p.x + ox, p.y, p.z + oz);
        edge.push(-1, 1);
        if (i > 0) {
          const a = base + (i - 1) * 2, b = base + i * 2;
          idx.push(a, a + 1, b + 1, a, b + 1, b);
        }
      }
    }
  };
  const channel = (sx, sy, sz, ex, ey, ez, n, jag) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : jag;
      pts.push({ x: sx + (ex - sx) * t + rng.range(-j, j), y: sy + (ey - sy) * t, z: sz + (ez - sz) * t + rng.range(-j, j) });
    }
    return pts;
  };
  const main = channel(x + rng.range(-6, 6), groundY + height, z + rng.range(-6, 6), x, groundY, z, 22, 1.4);
  addRibbon(main, 0.8);
  addRibbon(main, 0.22); // hot core
  for (let f = 0; f < 4; f++) {
    const i = rng.int(3, 15);
    const p = main[i];
    const len = rng.range(4, 10);
    const fork = channel(p.x, p.y, p.z, p.x + rng.range(-len, len), p.y - len * 1.2, p.z + rng.range(-len, len), 8, 0.8);
    addRibbon(fork, 0.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class BoltRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'godpower-fx';
    game.scene.add(this.group);
    this.meshes = new Map(); // bolt -> mesh
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xb8d0ff, 0, 22, 1.2);
      this.group.add(l);
      this.lights.push(l);
    }
    // scorch decals
    const scorchTex = makeScorchTexture();
    this.scorchMat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.scorchMeshes = new Map();
    // storm area ring + cloud disc
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0x1c2233, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.stormVisuals = new Map();
  }

  render(bolts, storms, scorches, now) {
    const game = this.game;
    // bolts
    const alive = new Set();
    let li = 0;
    const sorted = bolts.slice().sort((a, b) => b.t0 - a.t0);
    for (const b of sorted) {
      const age = now - b.t0;
      if (age > b.life) continue;
      alive.add(b);
      let m = this.meshes.get(b);
      if (!m) {
        m = new THREE.Mesh(makeBoltGeometry(b.seed, b.x, b.y, b.z), boltMat.clone());
        m.frustumCulled = false;
        m.renderOrder = 50;
        m.userData.noAO = true;
        this.group.add(m);
        this.meshes.set(b, m);
      }
      const flick = 0.55 + 0.45 * Math.abs(Math.sin(age * 90 + b.seed));
      m.material.uniforms.uAlpha.value = Math.max(0, 1 - age / b.life) * flick;
      if (li < this.lights.length) {
        const l = this.lights[li++];
        l.position.set(b.x, b.y + 3, b.z);
        l.intensity = 60 * Math.max(0, 1 - age / b.life) * flick;
      }
    }
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;
    for (const [b, m] of this.meshes) {
      if (!alive.has(b)) { this.group.remove(m); m.geometry.dispose(); m.material.dispose(); this.meshes.delete(b); }
    }
    // scorch decals (synced to the sim list)
    const live = new Set(scorches);
    for (const sc of scorches) {
      if (this.scorchMeshes.has(sc)) continue;
      const m = new THREE.Mesh(this.scorchGeo, this.scorchMat.clone());
      m.scale.setScalar(3.2);
      m.position.set(sc.x, sc.y + 0.03, sc.z);
      m.rotation.y = sc.seed % 6;
      m.userData.noAO = true;
      this.group.add(m);
      this.scorchMeshes.set(sc, m);
    }
    for (const [sc, m] of this.scorchMeshes) {
      if (!live.has(sc)) { this.group.remove(m); m.material.dispose(); this.scorchMeshes.delete(sc); continue; }
      const age = now - sc.t0;
      m.material.opacity = Math.max(0, 1 - Math.max(0, age - 8) / 6);
    }
    // storm clouds/rings
    const aliveStorms = new Set();
    for (const st of storms) {
      aliveStorms.add(st);
      let v = this.stormVisuals.get(st);
      if (!v) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(st.radius - 0.25, st.radius, 64).rotateX(-Math.PI / 2), this.ringMat.clone());
        const cloud = new THREE.Mesh(new THREE.CircleGeometry(st.radius * 1.3, 48).rotateX(Math.PI / 2), this.cloudMat.clone());
        ring.userData.noAO = cloud.userData.noAO = true;
        this.group.add(ring, cloud);
        v = { ring, cloud };
        this.stormVisuals.set(st, v);
      }
      const y = game.map.heightAt(st.x, st.z);
      const age = now - st.t0, k = Math.min(1, age / 0.8) * Math.min(1, Math.max(0, (st.t0 + st.duration - now) / 1.0));
      v.ring.position.set(st.x, y + 0.1, st.z);
      v.ring.material.opacity = 0.5 * k;
      v.cloud.position.set(st.x, y + 16, st.z);
      v.cloud.material.opacity = 0.55 * k;
    }
    for (const [st, v] of this.stormVisuals) {
      if (!aliveStorms.has(st)) { this.group.remove(v.ring, v.cloud); this.stormVisuals.delete(st); }
    }
  }
}

function makeScorchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(20,16,12,0.9)');
  g.addColorStop(0.5, 'rgba(30,24,18,0.6)');
  g.addColorStop(1, 'rgba(30,24,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
