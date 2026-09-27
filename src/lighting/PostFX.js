import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { OutputShader } from 'three/examples/jsm/shaders/OutputShader.js';
import { SceneGBuffer } from './GBuffer.js';

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
    uExposure: { value: 0.93 },
    uChromaLimit: { value: 0.42 },
    uSaturation: { value: 0.84 },
    uGreenShift: { value: 0.34 },
    uGreenDesat: { value: 0.14 },
    uContrast: { value: 1.0 },
    // mid S-curve: lit ground and roofs lift, shade drops (no milky mid-grey)
    uMidContrast: { value: 0.24 },
    // shade keeps its colour: chroma boost in the darks instead of a grey veil
    uShadowSat: { value: 0.0 },
    uShadowTint: { value: new THREE.Vector3(0.99, 0.97, 0.98) }, // near neutral: shade reads warm-olive (ground bounce), never lavender
    uBlackFloor: { value: new THREE.Vector3(0.03, 0.036, 0.026) },
    uVignette: { value: 0.0 },
    uToeLift: { value: 0.0 },
    uKnee: { value: 0.68 },
    uShoulder: { value: 3.8 }, // highlights approach uKnee + 1 / uShoulder (~0.9)
    // Top-edge aerial haze: in the RTS view the top of the frame is always
    // the far distance, so it loses contrast and saturation and lifts toward
    // a cool grey-blue (the far forest and shoreline recede).
    uTopHaze: { value: 0.26 },
    // Measured tonal targets (scripts/lumstats.py vs Retold ss_02): foliage
    // luminance is compressed into ~0.19..0.53 by a linear remap
    // (l' = uLeafLum.x + uLeafLum.y * l, soft-capped at uLeafLum.z) on pixels
    // whose hue/saturation read as foliage, so the canopy can neither crush
    // to black in shade nor bleach to mint on sunlit tops; uLeafChroma adds
    // back a little saturation. Everything else gets a soft value floor
    // (l' = sqrt(l^2 + uFloor^2)) so the darkest non-foliage shade sits ~0.2.
    uLeafLum: { value: new THREE.Vector3(0.09, 0.68, 0.57) },
    uLeafChroma: { value: 0.16 },
    uFloor: { value: 0.1 },
    uTopHazeColor: { value: new THREE.Vector3(0.7, 0.78, 0.85) },
    // Cool sky-fill tint applied to the shade (multiplicative, luminance
    // preserved): canopy undersides and cast shadows read blue-green.
    uSplitCool: { value: new THREE.Vector3(0.88, 1.0, 1.16) },
  },
  // (declarations and body are joined after the output transform in FinalPass)
  fragmentDecl: `
    uniform float uTopHaze; uniform vec3 uTopHazeColor;
    uniform float uMidContrast, uShadowSat, uLeafChroma, uFloor; uniform vec3 uLeafLum;
    uniform float uKnee, uShoulder, uToeLift, uChromaLimit, uExposure, uSaturation, uGreenShift, uGreenDesat, uContrast, uVignette;
    uniform vec3 uShadowTint, uBlackFloor;
    uniform vec3 uSplitCool;
    const vec3 LW = vec3(0.2126, 0.7152, 0.0722);`,
  fragmentBody: `
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
        // Per-pixel tonal remap only: no local-mean ratio, no clarity. Any
        // neighbourhood-based gain grows dark rims wherever a dark crown or
        // roof meets pale paving, so edges come from AO and lighting alone.
        // Foliage: gentle linear remap (keeps the crown's own sun/shade
        // contrast) with a soft cap so sunlit tops never bleach.
        float lf = uLeafLum.x + uLeafLum.y * l0;
        float k = uLeafLum.z - 0.06;
        if (lf > k) { float e = lf - k; lf = k + e / (1.0 + e * 8.0); }
        // Everything else: soft floor under the darks.
        float lg = sqrt(l0 * l0 + uFloor * uFloor);
        float lt = mix(lg, lf, wf);
        // cool sky fill in the shade: darks lean blue-green, not brown-black
        float shd = 1.0 - smoothstep(0.1, 0.42, lt);
        c *= mix(vec3(1.0), uSplitCool, shd) / mix(1.0, dot(uSplitCool, LW), shd);
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
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a);`,
};

// Output transform (exposure, tone mapping, sRGB, as three's OutputPass) and
// the colour grade above in one full-screen pass straight to the canvas. They
// used to be two passes with a full-resolution half-float target between them.
// `uniforms` are the grade's (scenes and god powers ease them by name).
class FinalPass extends Pass {
  constructor() {
    super();
    this.uniforms = { ...THREE.UniformsUtils.clone(OutputShader.uniforms), ...THREE.UniformsUtils.clone(GradeShader.uniforms) };
    const body = OutputShader.fragmentShader;
    const a = body.indexOf('void main() {'), b = body.lastIndexOf('}');
    this.material = new THREE.RawShaderMaterial({
      name: 'FinalGradeShader',
      uniforms: this.uniforms,
      vertexShader: OutputShader.vertexShader,
      fragmentShader: `${body.slice(0, a)}
${GradeShader.fragmentDecl}
void main() {
${body.slice(a + 'void main() {'.length, b)}
  vec4 t = gl_FragColor;
${GradeShader.fragmentBody}
}`,
    });
    this._fsQuad = new FullScreenQuad(this.material);
    this._key = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    const key = `${renderer.outputColorSpace}|${renderer.toneMapping}`;
    if (key !== this._key) {
      this._key = key;
      const d = this.material.defines = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      const tm = {
        [THREE.LinearToneMapping]: 'LINEAR', [THREE.ReinhardToneMapping]: 'REINHARD', [THREE.CineonToneMapping]: 'CINEON',
        [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC', [THREE.AgXToneMapping]: 'AGX', [THREE.NeutralToneMapping]: 'NEUTRAL',
        [THREE.CustomToneMapping]: 'CUSTOM',
      }[renderer.toneMapping];
      if (tm) d[`${tm}_TONE_MAPPING`] = '';
      this.material.needsUpdate = true;
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this._fsQuad.dispose(); }
}

// Multiplies the scene colour by GTAO's denoised AO (GTAOPass's own output
// copies the frame and then blends the AO over it: two full-screen passes).
const AOApplyShader = {
  uniforms: { tDiffuse: { value: null }, tAO: { value: null }, intensity: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, tAO; uniform float intensity; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec4 ao = texture2D(tAO, vUv);
      gl_FragColor = c * vec4(mix(vec3(1.0), ao.rgb, intensity), ao.a);
    }`,
};

// Pipeline (high): scene -> 4x MSAA half-float target with two colour
// attachments (colour + view-space normal) and a depth texture (GBuffer.js);
// GTAO reads that normal and depth (it draws no scene of its own) and computes
// AO + denoise; the AO is applied into a plain half-float target; bloom added
// onto it; one final pass (tone map, sRGB, grade) to the canvas. Only the scene
// pass renders into a multisampled target; the full-screen passes write
// single-sample targets. With AO off (quality low, post=low) the scene pass
// uses a colour-only MSAA target instead: no normal output, no depth resolve.
export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.quality = quality;
    this.renderer = renderer;
    this.aoScale = 1;
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    // The scene pass always draws into a multisampled target (see render());
    // the other buffer of the ping-pong pair needs no samples.
    this.msaa = this.plain = this.composer.renderTarget2;
    this.composer.renderTarget1.samples = 0;
    const scenePass = new RenderPass(scene, camera);
    this.composer.addPass(scenePass);
    if (quality === 'high') {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      // Scene target with the g-buffer: textures[1] is the normal (nearest
      // filtered, as GTAO's own normal target was); depth resolves into a
      // 24-bit depth texture. (Made after GTAOPass: its denoise noise comes
      // from Math.random, which every new texture's uuid also draws from, and
      // seeded captures keep the same noise this way.)
      this.gbuf = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType, samples: 4, count: 2,
        depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.UnsignedIntType),
      });
      const nt = this.gbuf.textures[1];
      nt.name = 'normal';
      nt.minFilter = nt.magFilter = THREE.NearestFilter;
      nt.generateMipmaps = false;
      this.gtao.setGBuffer(this.gbuf.depthTexture, nt);
      // decides what each draw writes to it (see GBuffer.js) and copies the
      // depth AO reads before the late draws (outline hulls, blended effects)
      this.gbuffer = new SceneGBuffer(renderer, this.gbuf);
      const sr = scenePass.render.bind(scenePass);
      scenePass.render = (...a) => {
        const on = this.gbufferActive;
        if (on) this.gbuffer.begin();
        sr(...a);
        if (on) this.gbuffer.end();
      };
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.5, scale: 1.6, samples: 12, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = 0.6;
      // AO resolution scale (1 full, 0.5 half: AO and denoise run on a
      // quarter of the pixels, reading the full-resolution g-buffer; set by
      // the quality level)
      const gs = this.gtao.setSize.bind(this.gtao);
      this.gtao.setSize = (w, h) => gs(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
      // GTAO only computes the AO map; the next pass applies it.
      this.gtao.output = GTAOPass.OUTPUT.Off;
      this.gtao.needsSwap = false;
      this.composer.addPass(this.gtao);
      this.aoApply = new ShaderPass(AOApplyShader);
      this.aoApply.uniforms.tAO.value = this.gtao.gtaoMap;
      this.aoApply.uniforms.intensity.value = this.gtao.blendIntensity;
      this.composer.addPass(this.aoApply);
      this.msaa = this.gbuf;
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.05, 0.2, 0.98);
    this.composer.addPass(this.bloom);
    this.grade = new FinalPass();
    this.composer.addPass(this.grade);
  }
  setSize(w, h) { this.composer.setSize(w, h); }

  // True while the scene pass writes the g-buffer: every visible object then
  // goes through gbuffer.prepare() before the frame is drawn (Lighting).
  get gbufferActive() { return this.msaa === this.gbuf; }

  // Quality level knobs (see Lighting.setQuality): AO on/off and resolution.
  setAO(scale) {
    if (!this.gtao) return;
    const on = scale > 0;
    this.gtao.enabled = on;
    this.aoApply.enabled = on;
    this.msaa = on ? this.gbuf : this.plain;
    if (on && scale !== this.aoScale) {
      this.aoScale = scale;
      const s = this.renderer.getSize(new THREE.Vector2());
      this.composer.setSize(s.x, s.y);
    }
  }
  setPixelRatio(r) { this.composer.setPixelRatio(r); }
  render() {
    const c = this.composer, t = this.msaa, w = c.renderTarget1.width, h = c.renderTarget1.height;
    // (the composer sizes renderTarget1/2; the scene target not in use follows here)
    if (t.width !== w || t.height !== h) t.setSize(w, h);
    c.renderTarget2 = t;
    c.readBuffer = t;
    c.writeBuffer = c.renderTarget1;
    c.render();
  }
}
