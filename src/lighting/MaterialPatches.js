import * as THREE from 'three';
import { addShaderPatch, prependFragment, injectFragment } from '../core/shaderPatch.js';

// Lighting-owned shader patches layered on top of every voxel material
// (anything carrying core's 'voxelTeam' / 'voxelTeamInst' patch):
//
//  - Foliage sky fill: shaded canopy gets an unshadowed, cool blue-green
//    ambient term, so the underside of trees reads as lit volume instead of a
//    near-black wall (Retold's forests stay mid-value in shade).
//  - Leaf translucency: faces of foliage turned toward the sun (and the
//    silhouettes wrapping round it) get a warm yellow-green subsurface lift.
//  - Daylight emissive: glow voxels (windows, braziers, torches) are scaled by
//    the sun's elevation, so at midday they sit as a soft warm glow instead of
//    blooming out to white; they return to full strength at dusk.
//
// Foliage is detected from the albedo (green-dominant vertex colour), so it
// also applies to grass tufts and bushes, never to stone, roofs or team cloth.

export const atmosUniforms = {
  uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
  uFoliageSky: { value: new THREE.Color(0.30, 0.38, 0.44) },
  uFoliageSun: { value: new THREE.Color(0.40, 0.32, 0.12) },
  uGlowScale: { value: 2.5 },
};

const VOXEL_KEYS = ['voxelTeam', 'voxelTeamInst'];

function patch(shader) {
  Object.assign(shader.uniforms, atmosUniforms);
  // Core multiplies glow by a constant 2.5; route it through the daylight scale.
  shader.fragmentShader = shader.fragmentShader.replace('vGlow * 2.5', 'vGlow * uGlowScale');
  prependFragment(shader, 'uniform vec3 uSunDirView, uFoliageSky, uFoliageSun;\nuniform float uGlowScale;');
  injectFragment(shader, '#include <lights_fragment_end>', `
    {
      vec3 alb = diffuseColor.rgb;
      float gdom = (alb.g - max(alb.r, alb.b)) / max(alb.g, 1e-3);
      float leaf = smoothstep(0.08, 0.35, gdom);
      if (leaf > 0.0) {
        vec3 wn = normalize(normal);
        float ndl = dot(wn, uSunDirView);
        // sky fill: strongest on faces the sun does not reach, a little everywhere
        float away = 1.0 - smoothstep(-0.15, 0.6, ndl);
        vec3 fill = uFoliageSky * (0.45 + 0.55 * away);
        // translucency: wrap lighting toward the sun, plus a thin rim on back faces
        float wrap = smoothstep(-0.35, 1.0, ndl);
        vec3 sss = uFoliageSun * (wrap * wrap);
        reflectedLight.indirectDiffuse += alb * (fill + sss) * leaf;
      }
    }`);
}

export class MaterialPatcher {
  constructor(scene) {
    this.scene = scene;
    this.seen = new WeakSet();
    this.frame = 0;
  }

  _patchMaterial(m) {
    if (!m || this.seen.has(m)) return;
    this.seen.add(m);
    const p = m.userData?.patches;
    if (!p || !VOXEL_KEYS.some((k) => p.has(k))) return;
    addShaderPatch(m, 'lightingAtmos', patch);
  }

  // Walk the scene for new voxel materials. Cheap enough every few frames;
  // always done on the first frames so paused scene captures include it.
  scan() {
    if (this.frame++ > 8 && this.frame % 20 !== 0) return;
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach((x) => this._patchMaterial(x));
      else this._patchMaterial(m);
    });
  }

  // Per-frame uniforms: sun direction in view space and daylight glow scale.
  update(sunDir, camera) {
    atmosUniforms.uSunDirView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    // sun elevation in degrees; full glow below ~5 deg, soft ember above ~20 deg
    const elev = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)));
    const t = THREE.MathUtils.smoothstep(elev, 5, 20);
    atmosUniforms.uGlowScale.value = THREE.MathUtils.lerp(2.5, 0.22, t);
  }
}
