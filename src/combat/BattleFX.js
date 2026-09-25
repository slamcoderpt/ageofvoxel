import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { VOXEL } from '../core/constants.js';
import { addShaderPatch, injectVertex, injectFragment, prependVertex, prependFragment } from '../core/shaderPatch.js';
import { applyFogOfWar } from '../core/FogOfWar.js';

// Battle feedback that makes a large fight readable:
//  - ground scars: churned earth and blood stamped onto the voxel columns where
//    units fight and fall (pixel-crisp, lit and shadowed like the terrain)
//  - soft dust clouds kicked up by melee, charges and deaths
//  - hit sparks (bronze on bronze) and blood
// Everything is simulated in the fixed tick (deterministic captures); the
// visual RNG is private so gameplay randomness is untouched.

const MAX_CELLS = 12000;
const MAX_DUST = 3000;
const MAX_SPARK = 2000;

export class BattleFX {
  constructor(game) {
    this.game = game;
    this.rng = new RNG(9173);
    this._initScars();
    this._initDust();
    this._initSparks();
  }

  // ------------------------------------------------------------------ sparks
  // Hot hit sparks: HDR-bright additive points (they catch the bloom pass),
  // drawn over the figures so a blow landing inside a packed line still shows.
  _initSparks() {
    const N = MAX_SPARK;
    this.sN = 0;
    this.sPos = new Float32Array(N * 3); this.sVel = new Float32Array(N * 3); this.sCol = new Float32Array(N * 3);
    this.sSize = new Float32Array(N); this.sBase = new Float32Array(N); this.sAlpha = new Float32Array(N);
    this.sLife = new Float32Array(N); this.sMax = new Float32Array(N); this.sGrav = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    this.gsPos = new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.gsCol = new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage);
    this.gsSize = new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage);
    this.gsAlpha = new THREE.BufferAttribute(this.sAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.gsPos);
    geo.setAttribute('color', this.gsCol);
    geo.setAttribute('psize', this.gsSize);
    geo.setAttribute('palpha', this.gsAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 900 } },
      vertexShader: `
        attribute float psize; attribute float palpha; varying vec3 vCol; varying float vA;
        uniform float uScale;
        void main(){
          vCol = color; vA = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(2.0, psize * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p) * 2.0;
          float core = 1.0 - smoothstep(0.0, 0.45, d);
          float halo = 1.0 - smoothstep(0.3, 1.0, d);
          float a = vA * (core + 0.45 * halo * halo);
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(vCol, vec3(3.0), core * 0.5) * a, a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparks = new THREE.Points(geo, mat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 30;
    this.sparks.userData.noAO = true;
    this.game.scene.add(this.sparks);
  }

  spark(x, y, z, { count = 6, color = 0xffa030, bright = 2.2, size = 0.25, life = 0.35, speed = 4, up = 2.5, gravity = -12 } = {}) {
    const r = this.rng;
    this._dc.set(color);
    for (let n = 0; n < count; n++) {
      if (this.sN >= MAX_SPARK) return;
      const i = this.sN++, k = i * 3;
      const a = r.range(0, Math.PI * 2), sp = speed * r.range(0.3, 1);
      this.sPos[k] = x + r.range(-0.06, 0.06); this.sPos[k + 1] = y + r.range(-0.06, 0.06); this.sPos[k + 2] = z + r.range(-0.06, 0.06);
      this.sVel[k] = Math.cos(a) * sp; this.sVel[k + 1] = up * r.range(0.4, 1.3); this.sVel[k + 2] = Math.sin(a) * sp;
      this.sCol[k] = this._dc.r * bright; this.sCol[k + 1] = this._dc.g * bright; this.sCol[k + 2] = this._dc.b * bright;
      this.sBase[i] = this.sSize[i] = size * r.range(0.7, 1.3);
      this.sAlpha[i] = 1;
      this.sLife[i] = this.sMax[i] = life * r.range(0.6, 1.3);
      this.sGrav[i] = gravity;
    }
  }

  _updateSparks(dt) {
    let i = 0;
    while (i < this.sN) {
      this.sLife[i] -= dt;
      if (this.sLife[i] <= 0) {
        const j = --this.sN;
        if (i !== j) {
          for (const arr of [this.sPos, this.sVel, this.sCol]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
          for (const arr of [this.sSize, this.sBase, this.sAlpha, this.sLife, this.sMax, this.sGrav]) arr[i] = arr[j];
        }
        continue;
      }
      const k = i * 3, dr = Math.max(0, 1 - 3 * dt);
      this.sVel[k] *= dr; this.sVel[k + 2] *= dr;
      this.sVel[k + 1] = this.sVel[k + 1] * dr + this.sGrav[i] * dt;
      this.sPos[k] += this.sVel[k] * dt; this.sPos[k + 1] += this.sVel[k + 1] * dt; this.sPos[k + 2] += this.sVel[k + 2] * dt;
      const t = 1 - this.sLife[i] / this.sMax[i];
      this.sAlpha[i] = Math.min(1, (1 - t) * 1.8);
      this.sSize[i] = this.sBase[i] * (1 - 0.5 * t);
      i++;
    }
  }

  // ------------------------------------------------------------------ scars
  _initScars() {
    const game = this.game;
    this.cells = new Map(); // column index -> slot
    this.cellKey = new Int32Array(MAX_CELLS);
    this.cellN = 0;
    const plane = new THREE.PlaneGeometry(VOXEL, VOXEL);
    plane.rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, plane.attributes[k]);
    this.aCellPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * 2), 2).setUsage(THREE.DynamicDrawUsage); // dirt, blood
    g.setAttribute('aCellPos', this.aCellPos);
    g.setAttribute('aCell', this.aCell);
    g.instanceCount = 0;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    addShaderPatch(mat, 'scar', (shader) => {
      prependVertex(shader, 'attribute vec3 aCellPos; attribute vec2 aCell; varying vec2 vScarXZ; varying vec2 vScar;');
      injectVertex(shader, '#include <begin_vertex>', 'transformed += aCellPos; vScarXZ = transformed.xz; vScar = aCell;');
      prependFragment(shader, `varying vec2 vScarXZ; varying vec2 vScar;
        float scarHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`);
      injectFragment(shader, '#include <color_fragment>', `
        {
          vec2 tx = floor(vScarXZ * 8.0);
          vec2 tc = floor(vScarXZ * 4.0);
          float h3 = scarHash(tx + 41.9);
          // coarse coverage: stains read as solid trodden patches, not sprinkled noise
          float hc = scarHash(tc), hb = scarHash(tc + 5.1);
          float cover = vScar.x - 0.25 * hc;
          float blood = vScar.y - 0.3 * hb;
          vec3 c;
          if (blood > 0.25) c = mix(vec3(0.09, 0.008, 0.006), vec3(0.16, 0.014, 0.01), h3);
          else if (cover > 0.2) c = mix(vec3(0.2, 0.13, 0.065), vec3(0.12, 0.075, 0.035), clamp(cover, 0.0, 1.0)) * (0.9 + 0.2 * h3);
          else discard;
          diffuseColor.rgb = c;
        }`);
    });
    applyFogOfWar(mat);
    this.scarMesh = new THREE.Mesh(g, mat);
    this.scarMesh.frustumCulled = false;
    this.scarMesh.receiveShadow = true;
    this.scarMesh.renderOrder = 1;
    game.scene.add(this.scarMesh);
    this.scarDirty = false;
  }

  // Stamp churned earth (dirt 0..1) and blood (0..1) around (x, z).
  scar(x, z, radius, dirt, blood = 0) {
    const map = this.game.map;
    const r = radius / VOXEL;
    const cx0 = Math.floor(x / VOXEL - r), cx1 = Math.floor(x / VOXEL + r);
    const cz0 = Math.floor(z / VOXEL - r), cz1 = Math.floor(z / VOXEL + r);
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cz < 0 || cx >= map.cols || cz >= map.cols) continue;
        const d = Math.hypot((cx + 0.5) * VOXEL - x, (cz + 0.5) * VOXEL - z) / radius;
        if (d > 1) continue;
        if (map.isWaterCol(cx, cz)) continue;
        const f = (1 - d * d) * (0.75 + 0.5 * this.rng.next());
        const key = cz * map.cols + cx;
        let i = this.cells.get(key);
        if (i === undefined) {
          if (this.cellN >= MAX_CELLS) continue;
          i = this.cellN++;
          this.cells.set(key, i);
          this.cellKey[i] = key;
          this.aCellPos.setXYZ(i, (cx + 0.5) * VOXEL, map.level(cx, cz) * VOXEL + 0.012, (cz + 0.5) * VOXEL);
          this.aCell.setXY(i, 0, 0);
        }
        this.aCell.setX(i, Math.min(0.92, this.aCell.getX(i) + dirt * f));
        this.aCell.setY(i, Math.min(0.8, this.aCell.getY(i) + blood * f));
      }
    this.scarDirty = true;
  }

  // ------------------------------------------------------------------ dust
  _initDust() {
    this.dN = 0;
    this.dPos = new Float32Array(MAX_DUST * 3);
    this.dVel = new Float32Array(MAX_DUST * 3);
    this.dCol = new Float32Array(MAX_DUST * 3);
    this.dSize = new Float32Array(MAX_DUST);
    this.dBase = new Float32Array(MAX_DUST);
    this.dAlpha = new Float32Array(MAX_DUST);
    this.dA0 = new Float32Array(MAX_DUST);
    this.dLife = new Float32Array(MAX_DUST);
    this.dMax = new Float32Array(MAX_DUST);
    const geo = new THREE.BufferGeometry();
    this.gdPos = new THREE.BufferAttribute(this.dPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.gdCol = new THREE.BufferAttribute(this.dCol, 3).setUsage(THREE.DynamicDrawUsage);
    this.gdSize = new THREE.BufferAttribute(this.dSize, 1).setUsage(THREE.DynamicDrawUsage);
    this.gdAlpha = new THREE.BufferAttribute(this.dAlpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.gdPos);
    geo.setAttribute('color', this.gdCol);
    geo.setAttribute('psize', this.gdSize);
    geo.setAttribute('palpha', this.gdAlpha);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 900 } },
      vertexShader: `
        attribute float psize; attribute float palpha; varying vec3 vCol; varying float vA; varying float vSeed;
        uniform float uScale;
        void main(){
          vCol = color; vA = palpha; vSeed = fract(position.x * 3.17 + position.z * 1.91);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(psize * uScale / -mv.z, 512.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA; varying float vSeed;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float ang = atan(p.y, p.x);
          float r = length(p) * (1.0 + 0.18 * sin(ang * 3.0 + vSeed * 6.28) + 0.1 * sin(ang * 5.0 - vSeed * 11.0));
          float a = vA * smoothstep(0.5, 0.12, r);
          if (a < 0.01) discard;
          // lit from above: brighter top, shaded underside
          vec3 c = vCol * (0.82 + 0.4 * (0.5 - p.y));
          gl_FragColor = vec4(c, a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 12;
    this.dust.userData.noAO = true;
    this.game.scene.add(this.dust);
    this._dc = new THREE.Color();
  }

  // Soft dust puffs. dir (dx, dz) biases the drift (e.g. away from a charge).
  puff(x, z, { count = 2, size = 1.0, life = 1.8, alpha = 0.5, speed = 0.6, up = 0.35, color = 0xe2d2ae, spread = 0.35, y = 0.35, dx = 0, dz = 0 } = {}) {
    const r = this.rng;
    const gy = this.game.map.heightAt(x, z);
    this._dc.set(color);
    for (let n = 0; n < count; n++) {
      if (this.dN >= MAX_DUST) return;
      const i = this.dN++;
      const a = r.range(0, Math.PI * 2), sp = speed * r.range(0.3, 1);
      this.dPos[i * 3] = x + r.range(-spread, spread);
      this.dPos[i * 3 + 1] = gy + y + r.range(0, 0.2);
      this.dPos[i * 3 + 2] = z + r.range(-spread, spread);
      this.dVel[i * 3] = Math.cos(a) * sp + dx;
      this.dVel[i * 3 + 1] = up * r.range(0.5, 1.2);
      this.dVel[i * 3 + 2] = Math.sin(a) * sp + dz;
      const k = r.range(0.9, 1.08);
      this.dCol[i * 3] = this._dc.r * k; this.dCol[i * 3 + 1] = this._dc.g * k; this.dCol[i * 3 + 2] = this._dc.b * k;
      this.dBase[i] = size * r.range(0.75, 1.25);
      this.dSize[i] = this.dBase[i];
      this.dA0[i] = alpha * r.range(0.7, 1.1);
      this.dAlpha[i] = 0;
      this.dLife[i] = this.dMax[i] = life * r.range(0.7, 1.2);
    }
  }

  // ------------------------------------------------------------------ hits
  // Visual response to a hit. kind: 'melee' | 'arrow' | 'building'
  hit(target, attacker, kind) {
    const game = this.game;
    const x = target.x, z = target.z;
    const gy = game.map.heightAt(x, z);
    if (target.kind === 'building') {
      game.fx.emit({ x, y: gy + 1.5, z, count: 5, color: 0xb8a888, size: 0.16, life: 0.5, speed: 2, up: 2.5, gravity: -12, spread: 0.3 });
      this.puff(x + this.rng.range(-1, 1), z + this.rng.range(-1, 1), { count: 1, size: 1.2, y: 1.0, alpha: 0.3, color: 0xb0a48c });
      return;
    }
    const h = game.units?.heightOf ? game.units.heightOf(target) : 1.2;
    // contact point: between attacker and target, around chest height
    let px = x, pz = z;
    if (attacker && attacker.x !== undefined && kind === 'melee') {
      const dx = attacker.x - x, dz = attacker.z - z, d = Math.hypot(dx, dz) || 1;
      px += (dx / d) * target.radius * 0.8; pz += (dz / d) * target.radius * 0.8;
    }
    const y = gy + h * 0.6;
    if (kind === 'melee') {
      // bronze on bronze: a hot white flash, a spray of orange and white sparks
      this.spark(px, y + 0.1, pz, { count: 1, color: 0xffd890, bright: 1.8, size: 2.2, life: 0.3, speed: 0, up: 0, gravity: 0 });
      this.spark(px, y, pz, { count: 7, color: 0xff9a30, bright: 2.6, size: 0.5, life: 0.5, speed: 4, up: 2.6 });
      this.spark(px, y, pz, { count: 3, color: 0xffffff, bright: 2.2, size: 0.4, life: 0.32, speed: 5, up: 1.8 });
      // feet scrabbling at the seam: dirt clods and a low burst of dust
      game.fx.emit({ x: px, y: gy + 0.12, z: pz, count: 6, color: 0x6b4a2a, size: 0.13, life: 0.6, speed: 2.4, up: 2.8, gravity: -13, spread: 0.25 });
      this.puff(px, pz, { count: 2, size: 0.9, life: 1.3, alpha: 0.55, speed: 0.9, up: 0.5, y: 0.15, spread: 0.3, color: 0xc9ad84 });
      this.scar(px, pz, 0.55, 0.35, 0.0);
    }
    if (this.rng.next() < 0.3) this.scar(x, z, 0.45, 0.0, 0.35);
  }

  death(e) {
    const x = e.x, z = e.z;
    const big = e.def?.myth ? 1.8 : e.def?.class === 'cavalry' ? 1.4 : 1;
    this.scar(x, z, 0.9 * big, 0.7, 0.75);
    this.puff(x, z, { count: Math.round(3 * big), size: 1.1 * big, life: 2.2, alpha: 0.4, speed: 0.9 });
    this.game.fx.emit({ x, y: this.game.map.heightAt(x, z) + 0.3, z, count: 6, color: 0xa89878, size: 0.22, life: 0.8, speed: 1.8, up: 1.2, gravity: -6 });
  }

  // Heavy ground impact (minotaur splash).
  slam(x, z, radius) {
    this.scar(x, z, radius * 0.9, 0.8, 0.1);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.puff(x + Math.cos(a) * radius * 0.6, z + Math.sin(a) * radius * 0.6, { count: 1, size: 1.3, life: 1.6, alpha: 0.45, speed: 0.3, dx: Math.cos(a) * 1.6, dz: Math.sin(a) * 1.6 });
    }
    this.game.fx.emit({ x, y: this.game.map.heightAt(x, z) + 0.1, z, count: 14, color: 0x7d6a4e, size: 0.2, life: 0.8, speed: 4, up: 3, gravity: -14 });
  }

  // Called every combat scan for a unit swinging in melee / galloping.
  scuff(u, charging, t) {
    if (charging) {
      const b = -Math.sin(u.rot) * 0.9, c = -Math.cos(u.rot) * 0.9;
      this.puff(u.x + b * 0.4, u.z + c * 0.4, { count: 1, size: 1.4, life: 1.8, alpha: 0.45, speed: 0.3, dx: b, dz: c });
      this.scar(u.x, u.z, 0.5, 0.18);
      return;
    }
    // churn the ground and raise dust along the contact line, not round the fighter
    const mx = t ? (u.x + t.x) / 2 : u.x, mz = t ? (u.z + t.z) / 2 : u.z;
    this.scar(mx + this.rng.range(-0.2, 0.2), mz + this.rng.range(-0.2, 0.2), 0.75, 0.3);
    this.puff(mx, mz, { count: 1, size: 1.6, life: 2.4, alpha: 0.42, speed: 0.4, up: 0.35, y: 0.3, spread: 0.3, color: 0xd4bc94 });
    if (this.rng.next() < 0.5) this.game.fx.emit({ x: mx, y: this.game.map.heightAt(mx, mz) + 0.1, z: mz, count: 3, color: 0x5e4126, size: 0.12, life: 0.5, speed: 1.8, up: 2.4, gravity: -13, spread: 0.3 });
  }

  // ------------------------------------------------------------------ tick
  update(dt) {
    this._updateSparks(dt);
    let i = 0;
    while (i < this.dN) {
      this.dLife[i] -= dt;
      if (this.dLife[i] <= 0) { this._killDust(i); continue; }
      const k = i * 3;
      const dr = Math.max(0, 1 - 1.2 * dt);
      this.dVel[k] *= dr; this.dVel[k + 1] *= dr; this.dVel[k + 2] *= dr;
      this.dPos[k] += this.dVel[k] * dt; this.dPos[k + 1] += this.dVel[k + 1] * dt; this.dPos[k + 2] += this.dVel[k + 2] * dt;
      const t = 1 - this.dLife[i] / this.dMax[i];
      this.dAlpha[i] = this.dA0[i] * Math.min(1, t * 5) * (1 - t);
      this.dSize[i] = this.dBase[i] * (1 + 1.6 * Math.sqrt(t));
      i++;
    }
    // scars slowly weather away
    this.scarAge = (this.scarAge || 0) + dt;
    if (this.scarAge > 2 && this.cellN) {
      const fade = this.scarAge * 0.004;
      this.scarAge = 0;
      const map = this.game.map;
      for (let j = 0; j < this.cellN; j++) {
        this.aCell.setXY(j, Math.max(0, this.aCell.getX(j) - fade), Math.max(0, this.aCell.getY(j) - fade * 1.5));
      }
      // compact fully faded cells
      let j = 0;
      while (j < this.cellN) {
        if (this.aCell.getX(j) <= 0 && this.aCell.getY(j) <= 0) {
          const last = --this.cellN;
          this.cells.delete(this.cellKey[j]);
          if (j !== last) {
            this.cellKey[j] = this.cellKey[last];
            this.cells.set(this.cellKey[j], j);
            this.aCellPos.setXYZ(j, this.aCellPos.getX(last), this.aCellPos.getY(last), this.aCellPos.getZ(last));
            this.aCell.setXY(j, this.aCell.getX(last), this.aCell.getY(last));
          }
          continue;
        }
        j++;
      }
      void map;
      this.scarDirty = true;
    }
  }

  _killDust(i) {
    const j = --this.dN;
    if (i === j) return;
    for (const arr of [this.dPos, this.dVel, this.dCol]) { arr[i * 3] = arr[j * 3]; arr[i * 3 + 1] = arr[j * 3 + 1]; arr[i * 3 + 2] = arr[j * 3 + 2]; }
    for (const arr of [this.dSize, this.dBase, this.dAlpha, this.dA0, this.dLife, this.dMax]) arr[i] = arr[j];
  }

  render() {
    this.sparks.geometry.setDrawRange(0, this.sN);
    this.gsPos.needsUpdate = this.gsCol.needsUpdate = this.gsSize.needsUpdate = this.gsAlpha.needsUpdate = true;
    this.dust.geometry.setDrawRange(0, this.dN);
    this.gdPos.needsUpdate = this.gdCol.needsUpdate = this.gdSize.needsUpdate = this.gdAlpha.needsUpdate = true;
    if (this.scarDirty) {
      this.scarMesh.geometry.instanceCount = this.cellN;
      this.aCellPos.needsUpdate = this.aCell.needsUpdate = true;
      this.scarDirty = false;
    }
  }

  resize(w, h) { this.dust.material.uniforms.uScale.value = h * 0.9; this.sparks.material.uniforms.uScale.value = h * 0.9; }
}
