import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Final colour grade in display space. The renderer tone-maps with Khronos
// PBR Neutral (index.js), which keeps hue and saturation up to the highlights,
// so sunlit sandstone stays warm instead of bleaching to grey-white as it did
// under ACES; all exposure happens before tone mapping, so nothing is pushed
// past white here. The grade then:
//  - pulls foliage greens towards olive/yellow-green and limits warm/foliage
//    chroma (Retold's grass is warm, never lime); team blues are untouched,
//  - sets a true black point: no grey lift. The darkest canopy gaps sit just
//    above black with a faint cool bias (uBlackFloor, only below ~10%),
//  - deepens the shadows with a luminance-only contrast curve below a mid pivot
//    (no hue shift), and tints them cool blue multiplicatively, so the tint
//    fades out in sunlight and black stays black,
//  - rolls sunlit stone off towards ~93% so it keeps its texture,
//  - adds no warmth of its own: warmth comes only from the sun light.
// uToeLift, uVignette (both 0 by default), uKnee/uShoulder, uContrast and
// uSaturation keep their names and meaning for scenes and effects that ease them.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
    uChromaLimit: { value: 0.42 },
    uSaturation: { value: 0.78 },
    uGreenShift: { value: 0.5 },
    uGreenDesat: { value: 0.14 },
    uContrast: { value: 1.0 },
    // mid S-curve: lit ground and roofs lift, shade drops (no milky mid-grey)
    uMidContrast: { value: 0.22 },
    // shade keeps its colour: chroma boost in the darks instead of a grey veil
    uShadowSat: { value: 0.0 },
    uShadowTint: { value: new THREE.Vector3(0.99, 0.97, 0.98) }, // near neutral: shade reads warm-olive (ground bounce), never lavender
    uBlackFloor: { value: new THREE.Vector3(0.03, 0.036, 0.026) },
    uVignette: { value: 0.0 },
    uToeLift: { value: 0.0 },
    uKnee: { value: 0.72 },
    uShoulder: { value: 4.3 }, // highlights approach uKnee + 1 / uShoulder (~0.95)
    // Top-edge aerial haze: in the RTS view the top of the frame is always
    // the far distance, so it loses contrast and saturation and lifts toward
    // a cool grey-blue (the far forest and shoreline recede).
    uTopHaze: { value: 0.3 },
    // Measured tonal targets (scripts/lumstats.py vs Retold ss_02): foliage
    // luminance is compressed into ~0.19..0.53 by a linear remap
    // (l' = uLeafLum.x + uLeafLum.y * l, soft-capped at uLeafLum.z) on pixels
    // whose hue/saturation read as foliage, so the canopy can neither crush
    // to black in shade nor bleach to mint on sunlit tops; uLeafChroma adds
    // back a little saturation. Everything else gets a soft value floor
    // (l' = sqrt(l^2 + uFloor^2)) so the darkest non-foliage shade sits ~0.2.
    uLeafLum: { value: new THREE.Vector3(0.08, 0.61, 0.54) },
    uLeafChroma: { value: 0.16 },
    uFloor: { value: 0.12 },
    uTopHazeColor: { value: new THREE.Vector3(0.7, 0.75, 0.78) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTopHaze; uniform vec3 uTopHazeColor;
    uniform float uMidContrast, uShadowSat, uLeafChroma, uFloor; uniform vec3 uLeafLum;
    uniform float uKnee, uShoulder, uToeLift, uChromaLimit, uExposure, uSaturation, uGreenShift, uGreenDesat, uContrast, uVignette;
    uniform vec3 uShadowTint, uBlackFloor; varying vec2 vUv;
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    void main(){
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb * uExposure;
      // --- foliage: how "green-dominant" is this pixel?
      float g = clamp((c.g - max(c.r, c.b)) / max(c.g, 1e-3), 0.0, 1.0);
      g = smoothstep(0.05, 0.7, g);
      // push hue from green to yellow-olive (raise red towards green), drop the blue floor
      c.r = mix(c.r, max(c.r, c.g * 0.86), g * uGreenShift);
      c.b = mix(c.b, c.b * 0.8, g * uGreenShift); // no mint: foliage leans yellow-green
      float l = dot(c, LW);
      c = mix(c, vec3(l), g * uGreenDesat);
      // --- chroma limiter for warm/foliage hues (blue is the weakest channel)
      float mx = max(c.r, c.g), ch = (mx - c.b) / max(mx, 1e-3);
      float over = smoothstep(0.35, 0.85, ch) * step(c.b, min(c.r, c.g) + 0.02);
      l = dot(c, LW);
      c = mix(c, vec3(l), over * uChromaLimit);
      // --- global saturation
      l = dot(c, LW);
      c = mix(vec3(l), c, uSaturation);
      // --- contrast: luminance-only power curve below a mid pivot; mids and
      // highlights are left to the tone mapper and the shoulder
      l = dot(c, LW);
      const float P = 0.42;
      float ls = l < P ? P * pow(max(l, 0.0) / P, uContrast) : l;
      // mids: cubic S around the pivot (lit stone up, shade down)
      ls = clamp(ls + uMidContrast * (ls - 0.4) * ls * (1.0 - ls) * 2.0, 0.0, 2.0);
      c *= ls / max(l, 1e-4);
      // shade keeps colour: saturate the darks (warm olive shade, not grey)
      l = dot(c, LW);
      c = max(mix(vec3(l), c, 1.0 + uShadowSat * (1.0 - smoothstep(0.08, 0.45, l)) * smoothstep(0.0, 0.05, l)), 0.0);
      // optional toe lift (0 by default; scenes may ease it)
      c = c + uToeLift * (1.0 - c) * (1.0 - smoothstep(0.0, 0.35, c));
      // --- cool shadows: multiplicative, fades out towards sunlit values
      l = dot(c, LW);
      c *= mix(vec3(1.0), uShadowTint, 1.0 - smoothstep(0.04, 0.42, l));
      // --- highlight shoulder: sunlit stone rolls off below white
      l = dot(c, LW);
      if (l > uKnee) { float e = l - uKnee; c *= (uKnee + e / (1.0 + e * uShoulder)) / l; }
      // --- deep shade floor: the darkest gaps sit just above black, faintly cool
      c += uBlackFloor * pow(1.0 - clamp(l, 0.0, 1.0), 12.0);
      // --- measured range: compress foliage, soft floor elsewhere
      {
        c = clamp(c, 0.0, 1.0);
        float mxc = max(c.r, max(c.g, c.b)), mnc = min(c.r, min(c.g, c.b)), dc = mxc - mnc;
        float sc = dc / max(mxc, 1e-4);
        float hc = mxc == c.r ? mod((c.g - c.b) / max(dc, 1e-4), 6.0) : (mxc == c.g ? (c.b - c.r) / max(dc, 1e-4) + 2.0 : (c.r - c.g) / max(dc, 1e-4) + 4.0);
        hc /= 6.0;
        float wf = smoothstep(0.13, 0.18, hc) * (1.0 - smoothstep(0.44, 0.5, hc)) * smoothstep(0.16, 0.28, sc);
        float l0 = dot(c, LW);
        float lf = uLeafLum.x + uLeafLum.y * l0;
        float k = uLeafLum.z - 0.06;
        if (lf > k) { float e = lf - k; lf = k + e / (1.0 + e * 8.0); }
        float lg = sqrt(l0 * l0 + uFloor * uFloor);
        float lt = mix(lg, lf, wf);
        c *= lt / max(l0, 1e-4);
        c = max(mix(vec3(lt), c, 1.0 + uLeafChroma * wf), 0.0);
      }
      // --- top-edge haze: lower contrast and saturation, cool lift
      float th = smoothstep(0.42, 1.0, vUv.y); th *= th * uTopHaze;
      l = dot(c, LW);
      c = mix(c, vec3(l), th * 1.2);
      c = mix(c, uTopHazeColor, th);
      // --- optional vignette (off by default; god powers ease it in)
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
      c *= 1.0 - v * uVignette * vec3(0.85, 1.0, 1.15);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality === 'high') {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.5, scale: 1.6, samples: 12, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = 0.72;
      // Let pieces opt objects out of the AO g-buffer with object.userData.noAO
      // (water, overlays, effects).
      const orig = this.gtao._overrideVisibility.bind(this.gtao);
      this.gtao._overrideVisibility = () => {
        orig();
        scene.traverseVisible((o) => { if (o.userData.noAO) this.gtao._visibilityCache.push(o); });
        for (const o of this.gtao._visibilityCache) o.visible = false;
      };
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.05, 0.2, 0.98);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render() { this.composer.render(); }
}
