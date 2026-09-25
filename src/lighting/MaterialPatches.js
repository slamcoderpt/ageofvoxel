import * as THREE from 'three';
import { addShaderPatch, prependFragment, prependVertex, injectFragment, injectVertex } from '../core/shaderPatch.js';
import { CanopyMap, canopyUniforms } from './Canopy.js';

// Lighting-owned shader patches layered on top of every voxel material
// (anything carrying core's 'voxelTeam' / 'voxelTeamInst' patch):
//
//  - Foliage sky fill: shaded canopy gets an unshadowed, cool blue-green
//    ambient term, so the underside of trees reads as lit volume instead of a
//    near-black wall (Retold's forests stay mid-value in shade).
//  - Leaf translucency: faces of foliage turned toward the sun (and the
//    silhouettes wrapping round it) get a warm yellow-green subsurface lift.
//  - Canopy AO (see Canopy.js): crown interiors, undersides and the gaps
//    between neighbouring crowns fall into deep cool blue-green shade by how
//    far below the local canopy top they sit; lit crown tops keep the sun.
//    The forest floor under the canopy edge (terrain, tufts) is darkened too.
//  - Per-tree crown tint: warm olive / neutral / cool deep green families
//    with +-18% brightness, seeded from each instance's map position.
//  - Daylight emissive: glow voxels (windows, braziers, torches) are scaled by
//    the sun's elevation, so at midday they sit as a soft warm glow instead of
//    blooming out to white; they return to full strength at dusk.
//
// Foliage is detected from the albedo (green-dominant vertex colour), so it
// also applies to grass tufts and bushes, never to stone, roofs or team cloth.

export const atmosUniforms = {
  uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
  uFoliageSky: { value: new THREE.Color(0.36, 0.47, 0.50) },
  uFoliageSun: { value: new THREE.Color(0.26, 0.25, 0.05) },
  uGlowScale: { value: 2.5 },
  uDeepShade: { value: new THREE.Color(0.46, 0.58, 0.62) }, // indirect multiplier at full canopy occlusion (cool blue-green)
  uCanopyAO: { value: 0.62 },
  uUnderstory: { value: 1.0 },
};

const VOXEL_KEYS = ['voxelTeam', 'voxelTeamInst'];

// Shared by both variants: world position, a per-instance seed (one value per
// tree/tuft, from the instance's map position) and the canopy occlusion terms.
function patchCommon(shader) {
  Object.assign(shader.uniforms, atmosUniforms, canopyUniforms);
  prependVertex(shader, 'varying vec3 vAtmWorld;\nvarying float vAtmSeed;');
  injectVertex(shader, '#include <project_vertex>', `
    {
      vec4 aw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        aw = instanceMatrix * aw;
        vec2 ip = floor(instanceMatrix[3].xz * 2.0 + 0.5);
        vAtmSeed = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vAtmSeed = 0.5;
      #endif
      vAtmWorld = (modelMatrix * aw).xyz;
    }`);
  prependFragment(shader, `varying vec3 vAtmWorld;\nvarying float vAtmSeed;
uniform sampler2D uCanopy;\nuniform float uCanopyInvSize, uCanopyOn;
uniform vec3 uSunDirView, uFoliageSky, uFoliageSun, uDeepShade;\nuniform float uGlowScale, uCanopyAO, uUnderstory;
// dens: forest density here; depth: 1 at the forest floor .. 0 at crown tops
void atmCanopy(out float dens, out float hA) {
  dens = 0.0; hA = 10.0;
  if (uCanopyOn > 0.5) {
    vec4 cm = texture2D(uCanopy, vAtmWorld.xz * uCanopyInvSize);
    dens = cm.r; hA = vAtmWorld.y - cm.g;
  }
}`);
}

// Voxel materials: per-tree crown tint, canopy AO inside and between crowns,
// foliage sky fill + translucency, understory darkening, daylight emissive.
function patchVoxel(shader) {
  patchCommon(shader);
  // Core multiplies glow by a constant 2.5; route it through the daylight scale.
  shader.fragmentShader = shader.fragmentShader.replace('vGlow * 2.5', 'vGlow * uGlowScale');
  // per-tree tint and brightness (before the material's diffuse is fixed)
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
    float atmLeaf;
    {
      vec3 a = diffuseColor.rgb;
      atmLeaf = smoothstep(0.08, 0.35, (a.g - max(a.r, a.b)) / max(a.g, 1e-3));
      if (atmLeaf > 0.0) {
        float s = vAtmSeed, s2 = fract(s * 7.31 + 0.17);
        // warm olive / neutral / cool deep green families, +-18% brightness
        vec3 tint = s < 0.3 ? vec3(1.12, 1.02, 0.74) : (s < 0.62 ? vec3(0.97, 1.0, 0.95) : vec3(0.78, 0.92, 1.02));
        float br = 0.80 + 0.34 * s2;
        diffuseColor.rgb = mix(a, a * tint * br, atmLeaf);
      }
    }
    // Bent leaf normals: light foliage with a normal bent halfway toward the
    // sky, as if each crown were a soft rounded mass rather than hard voxel
    // steps. Sides turned from the sun pick up some sun and sky, sun-facing
    // risers lose a little, so the per-step light/dark flip calms down while
    // real shadows (shadow map, canopy AO) keep the volume.
    vec3 atmFaceN = normal;
    normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.5 * atmLeaf));
    #include <lights_physical_fragment>`);
  injectFragment(shader, '#include <lights_fragment_end>', `
    {
      vec3 alb = diffuseColor.rgb;
      float leaf = atmLeaf;
      vec3 wn = normalize(normal);
      vec3 wN = inverseTransformDirection(normalize(atmFaceN), viewMatrix);
      float dens, hA; atmCanopy(dens, hA);
      // canopy AO: how deep inside the forest volume this point sits; faces
      // pointing down or sideways into the canopy see less sky
      float depth = 1.0 - smoothstep(1.2, 5.6, hA);
      // (foliage always gets some self-occlusion so even lone crowns have volume)
      float densL = mix(dens, mix(0.5, 1.0, dens), atmLeaf);
      float occ = clamp(densL * depth * (1.2 - 0.5 * wN.y), 0.0, 1.0);
      float down = smoothstep(0.2, 0.9, -wN.y);
      float occL = clamp(occ * uCanopyAO + down * 0.3, 0.0, 1.0) * leaf;
      // understory: anything low under/near the canopy that is not foliage
      float under = smoothstep(0.1, 0.8, dens) * (1.0 - smoothstep(0.3, 2.6, hA)) * (1.0 - leaf) * uUnderstory;
      float o = max(occL, under);
      reflectedLight.indirectDiffuse *= mix(vec3(1.0), uDeepShade, o);
      reflectedLight.directDiffuse *= 1.0 - (0.45 + 0.1 * leaf) * o;
      if (leaf > 0.0) {
        float ndl = dot(wn, uSunDirView);
        // sky fill: strongest on faces the sun does not reach; fades out in the canopy interior
        float away = 1.0 - smoothstep(-0.15, 0.6, ndl);
        vec3 fill = uFoliageSky * (0.35 + 0.75 * away) * (1.0 - 0.45 * occL);
        // translucency: wrap lighting toward the sun, only on the outer shell
        float wrap = smoothstep(-0.35, 1.0, ndl);
        vec3 sss = uFoliageSun * (wrap * wrap) * (1.0 - 0.6 * occL);
        // soften the per-step light/dark flip on crown tops: tame direct sun on
        // leaves a little and let the (normal-independent) fill carry the rest
        reflectedLight.directDiffuse *= 1.0 - 0.18 * leaf;
        reflectedLight.indirectDiffuse += alb * (fill + sss) * leaf;
      }
    }`);
}

// Terrain: only the understory darkening under the canopy edge.
function patchGround(shader) {
  patchCommon(shader);
  injectFragment(shader, '#include <lights_fragment_end>', `
    {
      float dens, hA; atmCanopy(dens, hA);
      float under = smoothstep(0.1, 0.8, dens) * (1.0 - smoothstep(0.3, 2.6, hA)) * uUnderstory;
      reflectedLight.indirectDiffuse *= mix(vec3(1.0), uDeepShade, under);
      reflectedLight.directDiffuse *= 1.0 - 0.55 * under;
    }`);
}

export class MaterialPatcher {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.canopy = new CanopyMap(game);
    this.seen = new WeakSet();
    this.frame = 0;
  }

  _patchMaterial(m) {
    if (!m || this.seen.has(m)) return;
    this.seen.add(m);
    if (m === this.game.terrain?.mesh?.material) { addShaderPatch(m, 'lightingGround', patchGround); return; }
    const p = m.userData?.patches;
    if (!p || !VOXEL_KEYS.some((k) => p.has(k))) return;
    addShaderPatch(m, 'lightingAtmos', patchVoxel);
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
    this.canopy.update();
    atmosUniforms.uSunDirView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    // sun elevation in degrees; full glow below ~5 deg, soft ember above ~20 deg
    const elev = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)));
    const t = THREE.MathUtils.smoothstep(elev, 5, 20);
    atmosUniforms.uGlowScale.value = THREE.MathUtils.lerp(2.5, 0.22, t);
  }
}
