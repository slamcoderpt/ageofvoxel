import * as THREE from 'three';
import { RNG } from '../rng.js';

// Lightweight CPU particle pool rendered as GL points. Simulated in the fixed
// sim tick (so screenshots are deterministic) but never affects gameplay.
//
//   game.fx.emit({ x, y, z, count: 20, color: 0xffe9a0, size: 0.4, life: 0.8,
//                  speed: 4, spread: 1, up: 2, gravity: -9, drag: 1,
//                  additive: true, square: true, grow: 0 })
class Pool {
  constructor(capacity, additive) {
    this.cap = capacity;
    this.n = 0;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('psize', this.aSize);
    geo.setAttribute('palpha', this.aAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 } },
      vertexShader: `
        attribute float psize; attribute float palpha; varying vec3 vCol; varying float vA;
        uniform float uScale;
        void main() {
          vCol = color; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          ${additive ? 'float a = vA * smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vCol * a, a);' : 'if (max(abs(p.x), abs(p.y)) > 0.45) discard; gl_FragColor = vec4(vCol, vA);'}
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }
  spawn(p) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([p.vx, p.vy, p.vz], i * 3);
    this.col.set([p.r, p.g, p.b], i * 3);
    this.baseSize[i] = p.size; this.size[i] = p.size;
    this.life[i] = p.life; this.maxLife[i] = p.life;
    this.grav[i] = p.gravity; this.drag[i] = p.drag; this.grow[i] = p.grow;
    this.alpha[i] = 1;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const k = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 2] *= dr;
      this.vel[k + 1] = this.vel[k + 1] * dr + this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, (1 - t) * 1.6);
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const arr of [this.pos, this.vel, this.col]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
    for (const arr of [this.size, this.alpha, this.life, this.maxLife, this.grav, this.drag, this.grow, this.baseSize]) arr[i] = arr[j];
  }
}

const _c = new THREE.Color();
export class Particles {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(4242);
    this.glow = new Pool(6000, true);
    this.solid = new Pool(6000, false);
    game.scene.add(this.glow.points, this.solid.points);
  }
  emit(o) {
    const r = this.rng;
    const pool = o.additive ? this.glow : this.solid;
    _c.set(o.color ?? 0xffffff);
    const cv = o.colorVar ?? 0.1;
    for (let i = 0; i < (o.count ?? 10); i++) {
      const a = r.range(0, Math.PI * 2), sp = (o.speed ?? 2) * r.range(0.3, 1);
      const s = o.spread ?? 0.3;
      const k = 1 + r.range(-cv, cv);
      pool.spawn({
        x: o.x + r.range(-s, s), y: o.y + r.range(-s, s) * 0.5, z: o.z + r.range(-s, s),
        vx: Math.cos(a) * sp, vy: (o.up ?? 1) * r.range(0.5, 1.5), vz: Math.sin(a) * sp,
        r: _c.r * k, g: _c.g * k, b: _c.b * k,
        size: (o.size ?? 0.3) * r.range(0.7, 1.3), life: (o.life ?? 1) * r.range(0.6, 1.2),
        gravity: o.gravity ?? -6, drag: o.drag ?? 1, grow: o.grow ?? 0,
      });
    }
  }
  update(dt) { this.glow.update(dt); this.solid.update(dt); }
  resize(h) {
    const s = h * 0.9;
    this.glow.points.material.uniforms.uScale.value = s;
    this.solid.points.material.uniforms.uScale.value = s;
  }
}
