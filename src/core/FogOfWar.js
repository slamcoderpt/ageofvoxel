import * as THREE from 'three';
import { addShaderPatch, injectVertex, injectFragment, prependVertex, prependFragment } from './shaderPatch.js';
import { PLAYER } from './constants.js';

// Shared uniforms: every fog-aware material references these objects.
export const fowUniforms = {
  fowTex: { value: null },
  fowWorldSize: { value: 128 },
  fowStrength: { value: 1 },
};

// Patch any Mesh*Material so unexplored ground is black and explored-but-not-
// visible ground is dimmed. Works for instanced and non-instanced meshes.
export function applyFogOfWar(material) {
  return addShaderPatch(material, 'fow', (shader) => {
    Object.assign(shader.uniforms, fowUniforms);
    prependVertex(shader, 'varying vec2 vFowXZ;');
    injectVertex(shader, '#include <project_vertex>', `
      {
        vec4 fowWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fowWp = instanceMatrix * fowWp;
        #endif
        fowWp = modelMatrix * fowWp;
        vFowXZ = fowWp.xz;
      }`);
    prependFragment(shader, 'varying vec2 vFowXZ;\nuniform sampler2D fowTex;\nuniform float fowWorldSize;\nuniform float fowStrength;');
    injectFragment(shader, '#include <fog_fragment>', `
      {
        float fowV = texture2D(fowTex, vFowXZ / fowWorldSize).r;
        float fowF = mix(1.0, smoothstep(0.0, 0.5, fowV) * (0.45 + 0.55 * smoothstep(0.5, 1.0, fowV)), fowStrength);
        gl_FragColor.rgb *= fowF;
      }`);
  });
}

// Fog of war for the local player. Visibility is recomputed a few times per
// second from unit/building sight radii. Values: 0 unexplored, 1 explored,
// 2 visible.
export class FogOfWar {
  constructor(game) {
    this.game = game;
    const N = game.map.size;
    this.N = N;
    this.state = new Uint8Array(N * N);
    this.data = new Uint8Array(N * N);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    fowUniforms.fowTex.value = this.tex;
    fowUniforms.fowWorldSize.value = game.map.worldSize;
    this.revealAll = false;
    this.timer = 0;
    this.owner = PLAYER;
  }
  setRevealAll(v) {
    this.revealAll = v;
    fowUniforms.fowStrength.value = v ? 0 : 1;
    this.recompute();
  }
  isVisible(x, z) {
    if (this.revealAll) return true;
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return false;
    return this.state[tz * this.N + tx] === 2;
  }
  isExplored(x, z) {
    if (this.revealAll) return true;
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.N || tz >= this.N) return false;
    return this.state[tz * this.N + tx] >= 1;
  }
  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    this.recompute();
  }
  recompute() {
    const N = this.N, s = this.state;
    for (let i = 0; i < s.length; i++) if (s[i] === 2) s[i] = 1;
    if (this.revealAll) s.fill(2);
    else {
      const stamp = (e) => {
        if (e.owner !== this.owner || e.dead) return;
        const r = e.sight || 8;
        const cx = Math.floor(e.x), cz = Math.floor(e.z);
        const r2 = r * r;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dz * dz > r2) continue;
            const x = cx + dx, z = cz + dz;
            if (x >= 0 && z >= 0 && x < N && z < N) s[z * N + x] = 2;
          }
      };
      for (const u of this.game.entities.units()) stamp(u);
      for (const b of this.game.entities.buildings()) stamp(b);
    }
    const d = this.data;
    for (let i = 0; i < s.length; i++) d[i] = s[i] === 2 ? 255 : s[i] === 1 ? 128 : 0;
    this.tex.needsUpdate = true;
  }
}
