import * as THREE from 'three';
import { hash3 } from '../core/rng.js';

// Hearth smoke: soft, semi-transparent round puffs that leave a chimney
// small and dense-ish, swell as they rise, bend over downwind with a slow
// wobble and fade out. Each hearth puffs on its own irregular rhythm and
// some are cold, so a street shows a few thin drifting plumes, not a row
// of white posts. Simulated in the fixed tick (deterministic, hash-driven)
// so paused captures show it.
const CAP = 1500;
const WIND = [0.34, -0.2];         // world units / s, drifting up-screen and right

export class Smoke {
  constructor(scene) {
    this.n = 0;
    this.pos = new Float32Array(CAP * 3);
    this.vel = new Float32Array(CAP * 3);
    this.age = new Float32Array(CAP);
    this.life = new Float32Array(CAP);
    this.size0 = new Float32Array(CAP);
    this.seed = new Float32Array(CAP);
    this.size = new Float32Array(CAP);
    this.alpha = new Float32Array(CAP);
    this.tone = new Float32Array(CAP);
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.aTone = new THREE.BufferAttribute(this.tone, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('psize', this.aSize);
    geo.setAttribute('palpha', this.aAlpha);
    geo.setAttribute('ptone', this.aTone);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: (typeof window !== 'undefined' ? window.innerHeight : 1080) * 0.9 } },
      vertexShader: `
        attribute float psize; attribute float palpha; attribute float ptone;
        varying float vA; varying float vT;
        uniform float uScale;
        void main() {
          vA = palpha; vT = ptone;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying float vT;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          // soft puff, lit from the upper side, a little darker below
          float a = vA * smoothstep(0.5, 0.12, d);
          float lit = 0.84 + 0.2 * clamp(-p.y * 2.0 + 0.3, 0.0, 1.0);
          vec3 c = mix(vec3(0.62, 0.6, 0.58), vec3(0.93, 0.91, 0.88), vT) * lit;
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    this.points.userData.noAO = true;
    scene.add(this.points);
  }

  resize(h) { this.mat.uniforms.uScale.value = h * 0.9; }

  // one puff from (x, y, z); k picks its variation (deterministic)
  puff(x, y, z, k) {
    if (this.n >= CAP) return;
    const i = this.n++;
    const r = (s) => hash3(k, s, this.count, 171);
    this.count++;
    this.pos.set([x + (r(1) - 0.5) * 0.06, y, z + (r(2) - 0.5) * 0.06], i * 3);
    this.vel.set([(r(3) - 0.5) * 0.05, 0.42 + r(4) * 0.18, (r(5) - 0.5) * 0.05], i * 3);
    this.age[i] = 0;
    this.life[i] = 4.5 + r(6) * 2.5;
    this.size0[i] = 0.2 + r(7) * 0.1;
    this.seed[i] = r(8) * 6.28;
    this.tone[i] = 0.55 + r(9) * 0.45;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const k = i * 3, t = this.age[i] / this.life[i];
      // rising slows, wind takes over; a slow side-to-side wobble
      this.vel[k + 1] *= Math.max(0, 1 - 0.35 * dt);
      const w = Math.min(1, this.age[i] * 0.5);
      const wob = Math.sin(this.age[i] * 1.3 + this.seed[i]) * 0.07;
      this.pos[k] += (this.vel[k] + WIND[0] * w + wob) * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += (this.vel[k + 2] + WIND[1] * w - wob * 0.5) * dt;
      this.size[i] = this.size0[i] * (1 + 5.5 * Math.sqrt(t));
      // fades in over the first moments, thins out to nothing
      this.alpha[i] = 0.6 * Math.min(1, t * 8) * (1 - t) * (1 - t);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aTone.needsUpdate = true;
  }

  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (let c = 0; c < 3; c++) { this.pos[i * 3 + c] = this.pos[j * 3 + c]; this.vel[i * 3 + c] = this.vel[j * 3 + c]; }
    for (const a of [this.age, this.life, this.size0, this.seed, this.size, this.alpha, this.tone]) a[i] = a[j];
  }
}
