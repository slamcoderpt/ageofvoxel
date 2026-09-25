import * as THREE from 'three';
import { addShaderPatch, prependFragment, prependVertex, injectFragment, injectVertex } from '../core/shaderPatch.js';
import { CanopyMap, canopyUniforms } from './Canopy.js';
import { ContactMap, contactUniforms } from './Contact.js';

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
  uFoliageSky: { value: new THREE.Color(0.2, 0.28, 0.33) },
  uFoliageSun: { value: new THREE.Color(0.34, 0.27, 0.035) },
  uGlowScale: { value: 2.5 },
  uDeepShade: { value: new THREE.Color(0.24, 0.31, 0.37) }, // indirect multiplier at full canopy occlusion (cool blue-green)
  uCanopyAO: { value: 1.0 },
  uUnderstory: { value: 1.0 },
  uPale: { value: 0.8 },      // albedo scale for pale neutral stone/marble (keeps whites off the clip)
  // Sunlit sandstone: pale neutral stone is re-tinted toward a warm
  // cream/ochre (Retold's plazas and walls are honey limestone, never paper
  // white); upward-facing paving takes the full tint, walls/marble a lighter one.
  uSand: { value: new THREE.Vector3(1.0, 0.85, 0.61) },
  uSandAmt: { value: 0.9 },
  uSandWall: { value: 0.5 },
  uContactAO: { value: 1.0 }, // strength of the wall-base band and ground halos
  // Leaf shadow balance: foliage in the sun's shadow (cast by the crowns next
  // to it) loses this much of its sky/fill light and turns cool, so crown-on-
  // crown and crown-on-floor shadows read as deep blue-green, not mid olive.
  uLeafShadowAmb: { value: 0.62 },
  uShadeCool: { value: new THREE.Vector3(0.72, 0.92, 1.25) },
  uLeafSun: { value: 1.45 },   // direct sun on foliage (lit crown tops glow warm)
  uLeafAmb: { value: 0.75 },   // sky/hemisphere light on foliage (lower = more sun-vs-shade contrast)
  uFloorShade: { value: 0.45 }, // extra darkening of shadowed forest floor
  uCrownRound: { value: 1.0 },  // tree crowns shaded as rounded masses
  // Paving (terrain): Retold's roads and plazas are worn cobbles, never a flat
  // cream slab. uPave scales the procedural stone/mortar breakup, uPaveAlb the
  // paving albedo (keeps sunlit roads off the clip), uGroundBounce is the warm
  // light the sunlit ground throws back into nearby shade.
  uPave: { value: 1.0 },
  uPaveAlb: { value: 0.58 },
  uPaveScale: { value: 4.2 },  // cobbles per world unit
  uPaveJoint: { value: 0.3 },  // joint darkening
  uGroundBounce: { value: new THREE.Color(0.2, 0.14, 0.08) },
  uHalo: { value: 1.0 },
  // Crown value range: the shaded half of every crown (faces turned from the
  // sun, undersides, crevices) is desaturated toward a cool dark green by
  // uLeafShadeDesat; uLeafRim is the warm highlight on the sun-facing
  // upper shell of each crown.
  uLeafShadeDesat: { value: 0.4 },
  uLeafAlb: { value: 0.8 },   // foliage albedo scale (deep olive crowns, not lime)
  uLeafRim: { value: new THREE.Color(0.55, 0.38, 0.08) },
};

const VOXEL_KEYS = ['voxelTeam', 'voxelTeamInst'];

// Shared by both variants: world position, a per-instance seed (one value per
// tree/tuft, from the instance's map position) and the canopy occlusion terms.
function patchCommon(shader) {
  Object.assign(shader.uniforms, atmosUniforms, canopyUniforms, contactUniforms);
  prependVertex(shader, 'varying vec3 vAtmWorld;\nvarying float vAtmSeed;\nvarying vec4 vAtmCrown;');
  injectVertex(shader, '#include <project_vertex>', `
    {
      vec4 aw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        aw = instanceMatrix * aw;
        vec2 ip = floor(instanceMatrix[3].xz * 2.0 + 0.5);
        vAtmSeed = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
        // crown centre of this instance (tree geometry has its pivot at the
        // trunk base; crowns sit ~2.4 units up) and the local height, so tall
        // foliage can be shaded as one rounded mass
        vAtmCrown = vec4((modelMatrix * instanceMatrix * vec4(0.0, 2.4, 0.0, 1.0)).xyz, transformed.y);
      #else
        vAtmSeed = 0.5;
        vAtmCrown = vec4(0.0, 0.0, 0.0, -10.0);
      #endif
      vAtmWorld = (modelMatrix * aw).xyz;
    }`);
  prependFragment(shader, `varying vec3 vAtmWorld;\nvarying float vAtmSeed;\nvarying vec4 vAtmCrown;\nuniform float uCrownRound;
uniform sampler2D uCanopy;\nuniform float uCanopyInvSize, uCanopyOn;
uniform vec3 uSunDirView, uFoliageSky, uFoliageSun, uDeepShade;\nuniform float uGlowScale, uCanopyAO, uUnderstory, uPale, uContactAO, uLeafShadowAmb, uLeafSun, uFloorShade;
uniform vec3 uShadeCool, uSand, uLeafRim;
uniform float uLeafShadeDesat, uLeafAmb, uLeafAlb;
uniform float uSandAmt, uSandWall;
uniform sampler2D uContact;\nuniform vec2 uContactOrigin;\nuniform float uContactInvSize, uContactOn;
// contact map: occ = footprint occupancy near here, hG = height above the ground
void atmContact(out float occ, out float hG) {
  occ = 0.0; hG = 10.0;
  if (uContactOn > 0.5) {
    vec2 uv = (vAtmWorld.xz - uContactOrigin) * uContactInvSize;
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
      vec4 c = texture2D(uContact, uv);
      occ = c.r; hG = vAtmWorld.y - c.g * 31.875; // G = height * 8 / 255
    }
  }
}
// pale neutral albedo (white marble, grey plaza stone) is pulled down so it
// keeps detail under the sun instead of reading as a milky slab
vec3 atmPale(vec3 a, float sandAmt) {
  float mx = max(a.r, max(a.g, a.b)), mn = min(a.r, min(a.g, a.b));
  float sat = (mx - mn) / max(mx, 1e-3);
  float pale = smoothstep(0.42, 0.75, mx) * (1.0 - smoothstep(0.12, 0.3, sat));
  // pale greys that are not tinted cool (team blues stay blue) become sandstone
  float warmable = pale * step(a.b, max(a.r, a.g) + 0.01);
  float l = dot(a, vec3(0.2126, 0.7152, 0.0722));
  vec3 sand = l * uSand / dot(uSand, vec3(0.2126, 0.7152, 0.0722));
  a = mix(a, sand, warmable * sandAmt);
  return a * mix(vec3(1.0), uPale * vec3(1.02, 1.0, 0.96), pale);
}
// dens: forest density here; depth: 1 at the forest floor .. 0 at crown tops
void atmCanopy(out float dens, out float hA) {
  dens = 0.0; hA = 10.0;
  if (uCanopyOn > 0.5) {
    vec4 cm = texture2D(uCanopy, vAtmWorld.xz * uCanopyInvSize);
    dens = cm.r; hA = vAtmWorld.y - cm.g;
  }
}`);
  injectFragment(shader, '#include <shadowmap_pars_fragment>', `
// the sun's shadow term (shadow-casting directional light 0 is the sun)
float atmSunShadow() {
  float sh = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    if (receiveShadow) {
      DirectionalLightShadow s0 = directionalLightShadows[ 0 ];
      sh = getShadow( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowIntensity, s0.shadowBias, s0.shadowRadius, vDirectionalShadowCoord[ 0 ] );
    }
  #endif
  return sh;
}
`);
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
      // paving (upward faces) takes the full sandstone tint, walls a lighter one
      vec3 wUp = inverseTransformDirection(normalize(normal), viewMatrix);
      diffuseColor.rgb = atmPale(diffuseColor.rgb, mix(uSandWall, uSandAmt, smoothstep(0.5, 0.9, wUp.y)));
    }
    {
      vec3 a = diffuseColor.rgb;
      atmLeaf = smoothstep(0.08, 0.35, (a.g - max(a.r, a.b)) / max(a.g, 1e-3));
      if (atmLeaf > 0.0) {
        float s = vAtmSeed, s2 = fract(s * 7.31 + 0.17);
        // warm olive / neutral / cool deep green families, +-18% brightness
        vec3 tint = s < 0.3 ? vec3(1.12, 1.02, 0.74) : (s < 0.62 ? vec3(0.97, 1.0, 0.95) : vec3(0.78, 0.92, 1.02));
        float br = 0.72 + 0.34 * s2;
        diffuseColor.rgb = mix(a, a * tint * br * uLeafAlb * vec3(1.0, 0.96, 0.9), atmLeaf);
      }
    }
    // Bent leaf normals: light foliage with a normal bent halfway toward the
    // sky, as if each crown were a soft rounded mass rather than hard voxel
    // steps. Sides turned from the sun pick up some sun and sky, sun-facing
    // risers lose a little, so the per-step light/dark flip calms down while
    // real shadows (shadow map, canopy AO) keep the volume.
    // Crown rounding: tree crowns (tall instanced foliage) also bend their
    // normals toward a sphere around the crown centre, so every crown gets a
    // sun side and a far side instead of the same lit-top/dark-riser pattern.
    vec3 atmFaceN = normal;
    vec3 atmRoundN = normal;
    {
      vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      float rw = atmLeaf * smoothstep(0.9, 1.5, vAtmCrown.w) * uCrownRound;
      // spires and tips standing well above the crown centre (pine tops,
      // cypress flames) keep their real faces: a lit side and a dark side
      rw *= 1.0 - smoothstep(1.0, 1.8, vAtmWorld.y - vAtmCrown.y);
      vec3 rn = normalize((viewMatrix * vec4((vAtmWorld - vAtmCrown.xyz) * vec3(1.0, 0.55, 1.0), 0.0)).xyz);
      atmRoundN = normalize(mix(normal, rn, 0.85 * rw));
      vec3 nb = mix(normal, rn, 0.6 * rw);
      nb = mix(nb, up, (0.5 - 0.38 * rw) * atmLeaf);
      normal = normalize(nb);
    }
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
      // inner blocks: faces low in the crown (well below the canopy top) sit
      // in the crown's own shade, even at the forest edge
      float inner = (1.0 - smoothstep(2.4, 4.6, hA)) * smoothstep(0.6, 1.6, hA) * (1.0 - 0.6 * max(wN.y, 0.0));
      float occL = clamp(occ * uCanopyAO + down * 0.45 + inner * 0.35, 0.0, 1.0) * leaf;
      // understory: anything low under/near the canopy that is not foliage
      float under = smoothstep(0.1, 0.8, dens) * (1.0 - smoothstep(0.3, 2.6, hA)) * (1.0 - leaf) * uUnderstory;
      float o = max(occL, under);
      reflectedLight.indirectDiffuse *= mix(vec3(1.0), uDeepShade, o);
      reflectedLight.directDiffuse *= 1.0 - (0.45 + 0.15 * leaf) * o;
      // contact band: a dark, slightly warm band a few voxels high where walls,
      // plinths, props and unit feet meet the ground; stronger in footprints'
      // crowded corners, weaker on upward faces (steps, treads)
      float cOcc, hG; atmContact(cOcc, hG);
      float band = (1.0 - smoothstep(0.02, 0.75, hG)) * (1.0 - 0.55 * max(wN.y, 0.0));
      band *= mix(0.55, 1.0, smoothstep(0.2, 0.8, cOcc)) * (1.0 - 0.5 * leaf) * uContactAO;
      reflectedLight.indirectDiffuse *= 1.0 - 0.75 * band;
      reflectedLight.directDiffuse *= 1.0 - 0.6 * band;
      // sun shadow cast by neighbouring crowns (and buildings): shaded
      // foliage and forest floor lose part of their sky light and turn cool
      // (only sampled where it matters: foliage and the forest floor)
      float sh = (leaf > 0.0 || dens > 0.1) ? atmSunShadow() : 1.0;
      float inShadow = 1.0 - sh;
      float faceLit = sh * smoothstep(0.05, 0.45, dot(normalize(atmFaceN), uSunDirView));
      if (leaf > 0.0) {
        float ndl = dot(wn, uSunDirView);
        // sky fill: strongest on faces the sun does not reach; fades out in the canopy interior
        float away = 1.0 - smoothstep(-0.15, 0.6, ndl);
        vec3 fill = uFoliageSky * (0.3 + 0.45 * away) * (1.0 - 0.7 * occL);
        // translucency: wrap lighting toward the sun, only on the outer shell
        // and only where the sun actually reaches (not through a neighbour)
        float wrap = smoothstep(-0.35, 1.0, ndl);
        vec3 sss = uFoliageSun * (wrap * wrap) * (1.0 - 0.6 * occL) * sh;
        reflectedLight.directDiffuse *= mix(1.0, uLeafSun, leaf);
        // cast shadow: less sky; every face away from the sun: cooler, bluer
        float amb = mix(1.0, 1.0 - uLeafShadowAmb, inShadow * leaf);
        vec3 cool = mix(vec3(1.0), uShadeCool, (1.0 - faceLit) * leaf);
        reflectedLight.indirectDiffuse *= amb * cool * mix(1.0, uLeafAmb, leaf);
        reflectedLight.indirectDiffuse += alb * (fill * amb * cool + sss) * leaf;
        // shaded half of the crown: cool, desaturated dark green
        float shadeW = (1.0 - faceLit) * leaf * uLeafShadeDesat;
        float il = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
        reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse, vec3(il) * vec3(0.9, 1.0, 1.08), shadeW);
        // crevices and undersides lose more of what is left
        reflectedLight.indirectDiffuse *= (1.0 - 0.35 * occL * (1.0 - faceLit)) * (1.0 - 0.28 * (1.0 - faceLit) * leaf);
        // warm rim on the sun-facing upper shell (outer crown, sun reaching it)
        float rim = faceLit * smoothstep(0.25, 0.85, ndl) * smoothstep(0.1, 0.75, dot(atmRoundN, uSunDirView)) * (0.4 + 0.6 * max(wN.y, 0.0)) * (1.0 - occL);
        reflectedLight.directDiffuse += alb * uLeafRim * rim * leaf;
      } else {
        // grass tufts, rocks, trunks on the forest floor in crown shadow
        float fl = inShadow * smoothstep(0.1, 0.6, dens) * (1.0 - smoothstep(0.5, 2.5, hA));
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), uShadeCool * (1.0 - uFloorShade), fl);
      }
    }`);
}

// Terrain: paving breakup, understory darkening under the canopy edge, warm
// ground bounce in shade and the contact halo round everything standing here.
function patchGround(shader) {
  patchCommon(shader);
  prependFragment(shader, `uniform float uPave, uPaveAlb, uHalo, uPaveScale, uPaveJoint;\nuniform vec3 uGroundBounce;
float atmH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 atmH22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float atmVN(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(atmH2(i), atmH2(i + vec2(1, 0)), f.x), mix(atmH2(i + vec2(0, 1)), atmH2(i + vec2(1, 1)), f.x), f.y);
}
// irregular cobbles: x = stone id hash, y = distance to the nearest joint
vec2 atmCobble(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = g + 0.15 + 0.7 * atmH22(i + g) - f;
    float d = dot(o, o);
    if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) d2 = d;
  }
  return vec2(atmH2(id * 1.37 + 3.1), sqrt(d2) - sqrt(d1));
}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
    float atmPaveM = 0.0;
    {
      vec3 a0 = diffuseColor.rgb;
      float mx = max(a0.r, max(a0.g, a0.b)), mn = min(a0.r, min(a0.g, a0.b));
      float sat = (mx - mn) / max(mx, 1e-3);
      vec3 wUp = inverseTransformDirection(normalize(normal), viewMatrix);
      // terrain paving is a pale warm grey (linear sat ~0.3-0.4); beach sand
      // (~0.6) and dirt are more saturated, grass is green-dominant
      atmPaveM = smoothstep(0.36, 0.48, mx) * (1.0 - smoothstep(0.44, 0.52, sat)) * step(a0.g, a0.r + 0.01)
               * smoothstep(0.6, 0.9, wUp.y) * uPave;
      diffuseColor.rgb = atmPale(diffuseColor.rgb, uSandAmt);
      if (atmPaveM > 0.0) {
        vec2 wp = vAtmWorld.xz;
        // stones ~0.3 units, slightly elongated along x, with worn joints
        vec2 cb = atmCobble(wp * vec2(1.0, 1.2) * uPaveScale);
        float fw = max(fwidth(cb.y), 1e-3);
        float joint = 1.0 - smoothstep(0.05 - fw * 0.5, 0.16 + fw, cb.y);
        float bevel = smoothstep(0.0, 0.42, cb.y);
        float stone = 0.84 + 0.26 * cb.x;
        // large, soft wear/dirt patches so the plaza is never one flat value
        float mott = atmVN(wp * 0.35) * 0.6 + atmVN(wp * 1.1 + 7.3) * 0.4;
        vec3 dirt = mix(vec3(0.84, 0.8, 0.74), vec3(1.05, 1.02, 0.97), mott);
        vec3 tint = mix(vec3(1.03, 0.99, 0.92), vec3(0.95, 0.97, 1.02), atmH2(vec2(cb.x, 5.1)));
        vec3 pav = diffuseColor.rgb * uPaveAlb * dirt * mix(vec3(1.0), tint * stone * (0.9 + 0.1 * bevel), 0.85);
        pav *= 1.0 - uPaveJoint * joint;
        diffuseColor.rgb = mix(diffuseColor.rgb, pav, atmPaveM);
      }
    }
    #include <lights_physical_fragment>`);
  injectFragment(shader, '#include <lights_fragment_end>', `
    {
      float dens, hA; atmCanopy(dens, hA);
      float under = smoothstep(0.1, 0.8, dens) * (1.0 - smoothstep(0.3, 2.6, hA)) * uUnderstory;
      reflectedLight.indirectDiffuse *= mix(vec3(1.0), uDeepShade, under);
      reflectedLight.directDiffuse *= 1.0 - 0.55 * under;
      float sh = atmSunShadow();
      // forest floor in the crowns' sun shadow: deep, cool green-black gaps
      float fl = dens > 0.1 ? (1.0 - sh) * smoothstep(0.1, 0.6, dens) : 0.0;
      reflectedLight.indirectDiffuse *= mix(vec3(1.0), uShadeCool * (1.0 - uFloorShade), fl);
      // warm bounce: open ground in shade is lit by the sunlit stone and earth
      // around it, so cast shadows on roads read as warm shade, not blue decals
      reflectedLight.indirectDiffuse += diffuseColor.rgb * uGroundBounce * (0.35 + 0.65 * (1.0 - sh)) * (1.0 - under);
      // contact halo round every building, prop and unit standing here
      float cOcc, hG; atmContact(cOcc, hG);
      // (a soft skirt ~1 unit wide plus a tight dark core right at the base,
      // so walls and plinths sit in the road instead of floating on it)
      float halo = smoothstep(0.02, 0.62, cOcc) * uContactAO * uHalo;
      float core = smoothstep(0.3, 0.8, cOcc) * uContactAO * uHalo;
      reflectedLight.indirectDiffuse *= clamp(1.0 - 0.66 * halo - 0.24 * core, 0.0, 1.0);
      reflectedLight.directDiffuse *= clamp(1.0 - 0.42 * halo - 0.3 * core, 0.0, 1.0);
    }`);
}

export class MaterialPatcher {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.canopy = new CanopyMap(game);
    this.contact = new ContactMap(game);
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
    this.contact.update();
    atmosUniforms.uSunDirView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    // sun elevation in degrees; full glow below ~5 deg, soft ember above ~20 deg
    const elev = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)));
    const t = THREE.MathUtils.smoothstep(elev, 5, 20);
    atmosUniforms.uGlowScale.value = THREE.MathUtils.lerp(2.5, 0.22, t);
  }
}
