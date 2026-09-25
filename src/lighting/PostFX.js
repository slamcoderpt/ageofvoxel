import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

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
    uSaturation: { value: 0.72 },
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
    uTopHaze: { value: 0.0 },
    // Measured tonal targets (scripts/lumstats.py vs Retold ss_02): foliage
    // luminance is compressed into ~0.19..0.53 by a linear remap
    // (l' = uLeafLum.x + uLeafLum.y * l, soft-capped at uLeafLum.z) on pixels
    // whose hue/saturation read as foliage, so the canopy can neither crush
    // to black in shade nor bleach to mint on sunlit tops; uLeafChroma adds
    // back a little saturation. Everything else gets a soft value floor
    // (l' = sqrt(l^2 + uFloor^2)) so the darkest non-foliage shade sits ~0.2.
    uLeafLum: { value: new THREE.Vector3(0.19, 0.41, 0.5) },
    uLeafChroma: { value: 0.16 },
    uFloor: { value: 0.15 },
    uTopHazeColor: { value: new THREE.Vector3(0.7, 0.75, 0.78) },
    // Local contrast (Retold's punch is local, not global): tLocal is a
    // blurred copy of the frame (LocalMeanPass, ~1/8 res). The tonal remap
    // above is applied to the local mean, and each pixel's ratio to that mean
    // is raised to uClarity (foliage: uLeafClarity), so crevices between
    // crowns, eaves and cast-shadow edges get darker/brighter against their
    // surroundings while the frame's percentiles stay on target.
    tLocal: { value: null },
    uLocalTexel: { value: new THREE.Vector2(1 / 240, 1 / 135) },
    uClarity: { value: 1.3 },
    uLeafClarity: { value: 1.5 },
    // local split tone: pixels darker than their surroundings lean cool
    // blue, brighter ones lean golden (sun ~5000K vs sky shade)
    uSplitWarm: { value: new THREE.Vector3(1.06, 1.0, 0.86) },
    uSplitCool: { value: new THREE.Vector3(0.9, 0.98, 1.14) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTopHaze; uniform vec3 uTopHazeColor;
    uniform float uMidContrast, uShadowSat, uLeafChroma, uFloor; uniform vec3 uLeafLum;
    uniform float uKnee, uShoulder, uToeLift, uChromaLimit, uExposure, uSaturation, uGreenShift, uGreenDesat, uContrast, uVignette;
    uniform vec3 uShadowTint, uBlackFloor; varying vec2 vUv;
    uniform sampler2D tLocal; uniform vec2 uLocalTexel; uniform float uClarity, uLeafClarity; uniform vec3 uSplitWarm, uSplitCool;
    vec3 localMean(){
      vec2 o = uLocalTexel * 2.0;
      vec3 m = texture2D(tLocal, vUv).rgb * 0.28;
      m += (texture2D(tLocal, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLocal, vUv - vec2(o.x, 0.0)).rgb +
            texture2D(tLocal, vUv + vec2(0.0, o.y)).rgb + texture2D(tLocal, vUv - vec2(0.0, o.y)).rgb) * 0.12;
      m += (texture2D(tLocal, vUv + o).rgb + texture2D(tLocal, vUv - o).rgb +
            texture2D(tLocal, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLocal, vUv + vec2(-o.x, o.y)).rgb) * 0.06;
      return m;
    }
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
        // detail ratio against the local mean (measured on the input frame)
        float dRaw = max(dot(t.rgb, LW), 1e-4) / max(dot(localMean(), LW), 1e-3);
        float dr = clamp(dRaw, 0.4, 2.2);
        float lm = l0 / dr; // this pixel's surroundings, in graded space
        float lf = uLeafLum.x + uLeafLum.y * lm;
        float k = uLeafLum.z - 0.06;
        if (lf > k) { float e = lf - k; lf = k + e / (1.0 + e * 8.0); }
        float lg = sqrt(lm * lm + uFloor * uFloor);
        // detail gain in log space, strongest on small local steps (crevices,
        // eaves, crown gaps) and fading back to 1:1 on big edges (white wall
        // against dark forest) so they do not grow halos
        float xd = log2(dr);
        float gw = exp(-xd * xd * 2.2);
        float lt = mix(lg * exp2(xd * mix(1.0, uClarity, gw)), lf * exp2(xd * mix(1.0, uLeafClarity, gw)), wf);
        // local split tone: below the local mean -> cool, above -> golden
        float sd = clamp(log2(dr) * 1.6, -1.0, 1.0);
        vec3 split = sd < 0.0 ? mix(vec3(1.0), uSplitCool, -sd) : mix(vec3(1.0), uSplitWarm, sd);
        c *= split / dot(split, LW);
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

// Blurred, downsampled copy of the frame for the grade's local contrast:
// 1/4 res (4 bilinear taps = 8x8 box), then 1/8 res (another 2x). Does not
// swap buffers; the grade samples it as tLocal.
class LocalMeanPass extends Pass {
  constructor(grade) {
    super();
    this.needsSwap = false;
    this.grade = grade;
    const o = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, o);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, o);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main(){
          vec2 o = uTexel;
          gl_FragColor = 0.25 * (texture2D(tSrc, vUv + vec2(-o.x, -o.y)) + texture2D(tSrc, vUv + vec2(o.x, -o.y)) +
                                 texture2D(tSrc, vUv + vec2(-o.x, o.y)) + texture2D(tSrc, vUv + vec2(o.x, o.y)));
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtA.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
    this.rtB.setSize(Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
    this.grade.uniforms.uLocalTexel.value.set(1 / this.rtA.width, 1 / this.rtA.height);
  }
  render(renderer, writeBuffer, readBuffer) {
    const w = readBuffer.width, h = readBuffer.height;
    if (w !== this.w || h !== this.h) this.setSize(w, h);
    const prev = renderer.getRenderTarget();
    this.mat.uniforms.tSrc.value = readBuffer.texture;
    this.mat.uniforms.uTexel.value.set(1 / w, 1 / h); // 4 bilinear taps over a 4x4 block
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    this.mat.uniforms.tSrc.value = this.rtA.texture;
    this.mat.uniforms.uTexel.value.set(0.5 / this.rtA.width, 0.5 / this.rtA.height);
    renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
    renderer.setRenderTarget(prev);
    this.grade.uniforms.tLocal.value = this.rtA.texture;
  }
}

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
    this.localMean = new LocalMeanPass(this.grade);
    this.composer.addPass(this.localMean);
    this.composer.addPass(this.grade);
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render() { this.composer.render(); }
}
