import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// Final colour grade in display space: saturation, contrast, warm lift and a
// gentle vignette. Tuned towards Retold's sunny, saturated look.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.18 },
    uContrast: { value: 1.06 },
    uWarm: { value: new THREE.Vector3(1.02, 1.0, 0.96) },
    uVignette: { value: 0.22 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSaturation, uContrast, uVignette; uniform vec3 uWarm; varying vec2 vUv;
    void main(){
      vec4 t = texture2D(tDiffuse, vUv);
      vec3 c = t.rgb * uWarm;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      c *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d * vec2(1.3, 1.0)));
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
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.5, scale: 1.25, samples: 12, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = 0.95;
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
