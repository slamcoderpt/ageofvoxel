import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Final colour grade in display space, tuned towards Retold's warm, cohesive
// "golden afternoon" look:
//  - foliage greens are pulled towards olive/yellow-green and desaturated
//    (Retold's grass is warm, never lime),
//  - overall saturation is gently reduced and luminance-weighted so darks stay
//    rich while highlights stay clean,
//  - split toning: cool blue-teal in the shadows, warm gold in the highlights,
//  - a filmic S-curve with lifted, coloured blacks (no crushed pure greens),
//  - a barely noticeable warm vignette (~12% at the corners).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.12 },
    uChromaLimit: { value: 0.5 },
    uSaturation: { value: 0.96 },
    uGreenShift: { value: 0.42 },
    uGreenDesat: { value: 0.42 },
    uContrast: { value: 1.08 },
    uShadowTint: { value: new THREE.Vector3(0.035, 0.055, 0.065) },
    uHighTint: { value: new THREE.Vector3(1.05, 1.0, 0.93) },
    uVignette: { value: 0.12 },
    uToeLift: { value: 0.06 },
    uKnee: { value: 0.62 },
    uShoulder: { value: 1.5 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uKnee, uShoulder, uToeLift, uChromaLimit, uExposure, uSaturation, uGreenShift, uGreenDesat, uContrast, uVignette;
    uniform vec3 uShadowTint, uHighTint; varying vec2 vUv;
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
    void main(){
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb * uExposure;
      // --- foliage: how "green-dominant" is this pixel?
      float g = clamp((c.g - max(c.r, c.b)) / max(c.g, 1e-3), 0.0, 1.0);
      g = smoothstep(0.05, 0.7, g);
      // push hue from green to yellow-olive (raise red towards green), drop the blue floor
      c.r = mix(c.r, max(c.r, c.g * 0.86), g * uGreenShift);
      c.b = mix(c.b, c.b * 0.9 + c.g * 0.12, g * uGreenShift);
      float l = dot(c, LW);
      c = mix(c, vec3(l), g * uGreenDesat);
      // --- chroma limiter for warm/foliage hues (blue is the weakest channel):
      // sunlit yellow-green grass must not go neon; team blues are untouched.
      float mx = max(c.r, c.g), ch = (mx - c.b) / max(mx, 1e-3);
      float over = smoothstep(0.35, 0.85, ch) * step(c.b, min(c.r, c.g) + 0.02);
      l = dot(c, LW);
      c = mix(c, vec3(l), over * uChromaLimit);
      // --- global saturation
      l = dot(c, LW);
      c = mix(vec3(l), c, uSaturation);
      // --- filmic S-curve: contrast in the mids/highlights only; the toe is
      // protected (and gently lifted) so shaded foliage keeps its value.
      c = clamp(c, 0.0, 1.2);
      vec3 s = c * c * (3.0 - 2.0 * c);
      vec3 k = smoothstep(0.18, 0.55, c);
      c = mix(c, s, (uContrast - 1.0 + 0.25) * k);
      c = c + uToeLift * (1.0 - c) * (1.0 - smoothstep(0.0, 0.35, c));
      // --- highlight shoulder: pale stone and white marble roll off instead of
      // clipping, so plaza and roofs keep their texture next to the forest
      l = dot(c, LW);
      if (l > uKnee) { float e = l - uKnee; c *= (uKnee + e / (1.0 + e * uShoulder)) / l; }
      // --- split tone: cool blue-green shadows, warm highlights
      l = dot(c, LW);
      float hi = smoothstep(0.25, 0.9, l);
      c *= mix(vec3(1.0), uHighTint, hi);
      c += uShadowTint * (1.0 - smoothstep(0.0, 0.45, l));
      // --- barely-there warm vignette (~12% at the far corners)
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
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.5, scale: 1.45, samples: 12, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = 1.0;
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render() { this.composer.render(); }
}
