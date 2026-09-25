import * as THREE from 'three';

// Health bars (camera-facing instanced quads) and selection rings (instanced
// ground rings). Visual only.
const MAX = 4096;

export class Overlays {
  constructor(game) {
    this.game = game;
    // --- health bars
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage); // fill, width, r, g
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aInfo', this.aInfo);
    g.setAttribute('aCol', this.aCol);
    g.instanceCount = 0;
    // Bars are sized in world units along their length but a fixed number of
    // pixels tall, with a crisp 1px dark outline, so they stay legible over
    // the busy tops of a packed melee at any zoom.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uResY: { value: 900 }, uBarPx: { value: 5 } },
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aInfo; attribute vec3 aCol;
        uniform float uResY; uniform float uBarPx;
        varying vec2 vUv; varying float vFill; varying vec3 vCol; varying vec2 vPx;
        void main(){
          vUv = uv; vFill = aInfo.x; vCol = aCol;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          float wpp = -mv.z / (projectionMatrix[1][1] * uResY * 0.5); // world units per pixel
          float w = max(aInfo.y, wpp * 14.0);
          float h = wpp * uBarPx;
          vPx = vec2(w / wpp, uBarPx);
          vec3 p = aPos + right * position.x * w + up * position.y * h;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying float vFill; varying vec3 vCol; varying vec2 vPx;
        void main(){
          vec2 px = vUv * vPx;
          float edge = min(min(px.x, vPx.x - px.x), min(px.y, vPx.y - px.y));
          if (edge < 1.0) { gl_FragColor = vec4(0.03, 0.025, 0.02, 0.95); return; }
          // fill measured inside the outline
          float f = (px.x - 1.0) / (vPx.x - 2.0);
          vec3 c = f < vFill ? vCol * (0.8 + 0.45 * vUv.y) : vec3(0.07, 0.03, 0.025);
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.bars = new THREE.Mesh(g, mat);
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 100;
    this.bars.userData.noAO = true;
    game.scene.add(this.bars);

    // --- selection rings
    const ring = new THREE.RingGeometry(0.82, 1.0, 40);
    ring.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false }), 1024);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 3).fill(1), 3);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 6;
    this.rings.userData.noAO = true;
    game.scene.add(this.rings);
    // --- team ground marks: a soft disc of saturated team colour with a
    // brighter rim under every soldier who is fighting. Packed ranks merge
    // into one red and one blue carpet, so from RTS height the two blocks and
    // the seam between them read at a glance. Heroes get a gold rim.
    const disc = new THREE.PlaneGeometry(2, 2);
    disc.rotateX(-Math.PI / 2);
    const dg = new THREE.InstancedBufferGeometry();
    dg.index = disc.index;
    dg.setAttribute('position', disc.attributes.position);
    dg.setAttribute('uv', disc.attributes.uv);
    this.aMark = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage); // x, y, z, radius
    this.aMarkCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage); // rgb, rim kind
    dg.setAttribute('aMark', this.aMark);
    dg.setAttribute('aMarkCol', this.aMarkCol);
    dg.instanceCount = 0;
    this.marks = new THREE.Mesh(dg, new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec4 aMark; attribute vec4 aMarkCol; varying vec2 vUv; varying vec4 vCol;
        void main(){
          vUv = uv * 2.0 - 1.0; vCol = aMarkCol;
          vec3 p = aMark.xyz + position * vec3(aMark.w, 1.0, aMark.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying vec4 vCol;
        void main(){
          float d = length(vUv);
          if (d > 1.0) discard;
          if (vCol.a > 0.5) {
            // hero: a bright gold ring round a warm pool of light, the
            // focal point of a melee
            float ring = smoothstep(0.58, 0.66, d) * (1.0 - smoothstep(0.72, 0.8, d));
            float pool = 0.45 * (1.0 - smoothstep(0.0, 0.62, d));
            float halo = 0.35 * (1.0 - smoothstep(0.78, 1.0, d)) * smoothstep(0.7, 0.8, d);
            vec3 gold = vec3(1.6, 1.05, 0.35);
            float a = max(max(ring, pool), halo);
            gl_FragColor = vec4(mix(mix(vCol.rgb, gold, 0.55), gold, ring), a);
            return;
          }
          float fill = 0.30 * (1.0 - smoothstep(0.55, 0.9, d));
          float rim = smoothstep(0.66, 0.8, d) * (1.0 - smoothstep(0.88, 1.0, d));
          float a = max(fill, rim * 0.6);
          gl_FragColor = vec4(vCol.rgb, a);
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 4;
    this.marks.userData.noAO = true;
    game.scene.add(this.marks);

    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  resize(w, h) {
    const u = this.bars.material.uniforms;
    u.uResY.value = h;
    u.uBarPx.value = Math.round(Math.min(7, Math.max(4, h / 1080 * 6)));
  }

  render(alpha) {
    const game = this.game;
    const sel = game.selection || new Set();
    const hover = game.hoverId;
    let n = 0, r = 0, mk = 0;
    const addBar = (e, x, y, z, w) => {
      if (n >= MAX) return;
      this.aPos.setXYZ(n, x, y, z);
      this.aInfo.setXYZW(n, Math.max(0, e.hp / e.maxHp), w, 0, 0);
      const f = e.hp / e.maxHp;
      if (e.owner === game.localPlayer) this._c.setRGB(0.0, 0.75, 0.3);
      else if (e.owner === 0) this._c.setRGB(0.9, 0.85, 0.6);
      else this._c.setRGB(0.85, 0.0, 0.0);
      if (f < 0.35 && e.owner === game.localPlayer) this._c.setRGB(0.95, 0.6, 0.0);
      this.aCol.setXYZ(n, this._c.r, this._c.g, this._c.b);
      n++;
    };
    const addRing = (e, x, z, rad) => {
      if (r >= 1024) return;
      const y = game.map.heightAt(x, z) + 0.06;
      this._m.makeScale(rad, 1, rad).setPosition(x, y, z);
      this.rings.setMatrixAt(r, this._m);
      if (e.owner === game.localPlayer) this._c.setRGB(0.35, 1.0, 0.45);
      else if (e.owner === 0) this._c.setRGB(1, 0.95, 0.6);
      else this._c.setRGB(1.0, 0.3, 0.25);
      this.rings.setColorAt(r, this._c);
      r++;
    };
    for (const u of game.entities.units()) {
      if (u.dead) continue;
      if (u.owner !== game.localPlayer && !game.fog.isVisible(u.x, u.z)) continue;
      const x = u.prevX + (u.x - u.prevX) * alpha, z = u.prevZ + (u.z - u.prevZ) * alpha;
      const selected = sel.has(u.id);
      if (selected || hover === u.id) addRing(u, x, z, u.radius * 1.5 + 0.1);
      else if (mk < MAX && u.owner !== 0 && u.def.class !== 'villager' && (u.order?.type === 'attack' || u.combat_line)) {
        const hero = u.def.hero;
        this.aMark.setXYZW(mk, x, game.map.heightAt(x, z) + 0.05, z, u.radius * (hero ? 3.4 : 1.25) + 0.05);
        this._c.setHex(game.players[u.owner]?.color ?? 0xffffff);
        this.aMarkCol.setXYZW(mk, this._c.r, this._c.g, this._c.b, hero ? 1 : 0);
        mk++;
      }
      // In a big fight a bar over every scratched man is noise (a mostly empty
      // bar reads as a dark dash over the crowd). As in AoM, rank-and-file show
      // bars only when selected or hovered; heroes and myth units once hurt.
      const f = u.hp / u.maxHp;
      const big = u.def.myth || u.def.hero;
      if (selected || hover === u.id || (big && f < 0.97))
        addBar(u, x, game.map.heightAt(x, z) + game.units.heightOf(u) + 0.35, z, u.def.myth ? 1.5 : u.def.class === 'cavalry' ? 1.0 : 0.8);
    }
    for (const b of game.entities.buildings()) {
      if (b.owner !== game.localPlayer && !game.fog.isExplored(b.x, b.z)) continue;
      const selected = sel.has(b.id);
      if (selected || hover === b.id) addRing(b, b.x, b.z, Math.max(b.w, b.h) * 0.72);
      if (selected || b.hp < b.maxHp || hover === b.id)
        addBar(b, b.x, game.map.heightAt(b.x, b.z) + 2.2 + b.w * 0.55, b.z, Math.min(4, b.w * 0.55));
    }
    for (const e of game.entities.resources()) {
      if (sel.has(e.id) || hover === e.id) addRing(e, e.x, e.z, Math.max(e.w, e.h) * 0.7);
    }
    this.marks.geometry.instanceCount = mk;
    this.aMark.needsUpdate = this.aMarkCol.needsUpdate = true;
    this.bars.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aInfo.needsUpdate = this.aCol.needsUpdate = true;
    this.rings.count = r;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor.needsUpdate = true;
  }
}
