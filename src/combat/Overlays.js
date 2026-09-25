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
      uniforms: { uResY: { value: 900 }, uBarPx: { value: 8 } },
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
          float w = aInfo.z > 0.5 ? wpp * aInfo.y : max(aInfo.y, wpp * 30.0);
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
          // crisp dark frame (1px) so the bar reads over bright turf and bronze
          if (edge < 1.0) { gl_FragColor = vec4(0.02, 0.018, 0.015, 0.95); return; }
          // fill measured inside the frame, with a lit top edge
          float f = (px.x - 1.0) / (vPx.x - 2.0);
          float yy = (px.y - 1.0) / max(1.0, vPx.y - 2.0);
          // a clear split: bright green for the health left, strong red for
          // what is lost (the men themselves carry the army colour)
          float lit = 0.82 + 0.2 * yy + (yy > 0.65 ? 0.18 : 0.0);
          vec3 c = f < vFill ? vCol * lit : vec3(0.86, 0.1, 0.07) * lit;
          if (abs(f - vFill) * (vPx.x - 2.0) < 0.6) c = vec3(0.02);
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
    const ring = new THREE.RingGeometry(0.9, 1.0, 48);
    ring.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false }), 1024);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 3).fill(1), 3);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 6;
    this.rings.userData.noAO = true;
    game.scene.add(this.rings);
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  resize(w, h) {
    const u = this.bars.material.uniforms;
    u.uResY.value = h;
    // 6px at 1080p: a 1px dark frame round a 4px fill, thick enough to read
    // over a packed melee from RTS height
    u.uBarPx.value = Math.round(Math.min(10, Math.max(5, h / 1080 * 6)));
  }

  render(alpha) {
    const game = this.game;
    const sel = game.selection || new Set();
    const hover = game.hoverId;
    let n = 0, r = 0;
    const addBar = (e, x, y, z, w, px = 0) => {
      if (n >= MAX) return;
      this.aPos.setXYZ(n, x, y, z);
      this.aInfo.setXYZW(n, Math.max(0, e.hp / e.maxHp), w, px, 0);
      // the fill is the owner's colour (bright, so it reads as a bar and not
      // as another man's tunic); Gaia and buildings keep a neutral green
      this._c.setRGB(0.3, 1.0, 0.18);
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
      // No team discs under soldiers: army colour is carried by the men
      // themselves (tunics, cloaks, crests, shield faces); the ground stays
      // clean and only selected units get a thin ring.
      // Bars only where they say something: selected/hovered units, and in a
      // fight the ones that are really hurt (a bar over every scratched man
      // is noise over the crowd).
      const f = u.hp / u.maxHp;
      const big = u.def.myth || u.def.hero;
      // Bars only where they say something (as in Retold, where a melee
      // shows almost none): selected or hovered units, and the badly hurt
      // who were struck in the last couple of seconds (heroes and giants
      // once they are down a quarter). A fixed pixel size per class at a
      // fixed height over the head, so the few there are line up.
      const hurt = f < (big ? 0.8 : 0.7) && game.time - (u.combat_hitT ?? -99) < 6;
      if (selected || hover === u.id || hurt)
        addBar(u, x, game.map.heightAt(u.x, u.z) + game.units.heightOf(u) + 0.3, z, big ? 70 : u.def.class === 'cavalry' ? 46 : 40, 1);
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
    this.bars.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aInfo.needsUpdate = this.aCol.needsUpdate = true;
    this.rings.count = r;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor.needsUpdate = true;
  }
}
