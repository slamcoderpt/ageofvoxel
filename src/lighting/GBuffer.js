import * as THREE from 'three';
import { addShaderPatch } from '../core/shaderPatch.js';

// The AO g-buffer written by the main scene pass: a second colour output with
// the view-space normal GTAO needs (multiple render targets), plus the pass's
// depth, so GTAO no longer draws the whole scene again with a normal material.
//
// Two groups of draws, as GTAO's own normal pass saw them:
//  - AO surfaces: opaque materials, except on objects marked
//    userData.noAO. They write their surface normal (packed as three's
//    MeshNormalMaterial does) and their depth. Lit materials use the
//    interpolated vertex normal (vNormal, exactly what MeshNormalMaterial
//    wrote), not the shading normal the lighting patches bend; other built-ins
//    use the face normal from screen derivatives of the view position, and
//    shader materials (the sky, which writes no depth) a camera-facing normal.
//    With several draw buffers bound, a shader that leaves one unwritten gets
//    its draw dropped, so each of these materials gets this patch (Lighting
//    calls prepare() for every visible object before the frame is drawn).
//  - Late draws: blended materials (water, contact shadows, particles, god
//    power and combat effects) and opaque noAO objects (the unit outline
//    hulls, god power debris; these draw after the opaque scene, renderOrder
//    2). The first late draw of the frame copies the multisampled depth into
//    the depth texture and switches the normal attachment off, so late draws
//    change neither what AO reads nor the image (they draw exactly as before).
//    Without a late draw the depth is copied after the pass.
// The MSAA resolve still averages the 4 samples' normals at silhouettes and
// the depth copy takes one sample, where the old pass sampled pixel centres
// without multisampling: AO differs from it at edges by pixel-noise amounts.
const LIT = ['isMeshStandardMaterial', 'isMeshLambertMaterial', 'isMeshPhongMaterial', 'isMeshToonMaterial', 'isMeshNormalMaterial', 'isMeshMatcapMaterial'];
const DECL = 'layout(location = 1) out highp vec4 gbufNormal;';
const KEY = 'gbuf:';

const FACE = {
  // the vertex normal (as normal_fragment_begin without the shading tweaks),
  // turned toward the camera on back faces
  lit: `
    {
      #ifdef FLAT_SHADED
        vec3 gbN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
      #else
        vec3 gbN = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
      #endif
      gbufNormal = vec4(gbN * 0.5 + 0.5, 1.0);
    }`,
  flat: `
    {
      vec3 gbN = normalize(cross(dFdx(vGbView), dFdy(vGbView)));
      gbufNormal = vec4(gbN * 0.5 + 0.5, 1.0);
    }`,
  facing: 'gbufNormal = vec4(0.5, 0.5, 1.0, 1.0);',
};

function isOpaque(m) {
  return m.blending === THREE.NoBlending || (m.blending === THREE.NormalBlending && !m.transparent);
}

function faceMode(m) {
  if (LIT.some((k) => m[k])) return 'lit';
  return m.isShaderMaterial ? 'facing' : 'flat';
}

function patchFor(mode) {
  return (shader) => {
    const fs = shader.fragmentShader;
    const main = /void\s+main\s*\(\s*(void)?\s*\)\s*\{/.exec(fs);
    if (!main) return;
    let m = mode, decl = DECL;
    if (m === 'flat') {
      // (every built-in mesh vertex shader has project_vertex, which sets mvPosition)
      if (shader.vertexShader.includes('#include <project_vertex>')) {
        shader.vertexShader = `varying vec3 vGbView;\n${shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvGbView = mvPosition.xyz;')}`;
        decl += '\nvarying vec3 vGbView;';
      } else m = 'facing';
    }
    // written first thing in main: derivatives in uniform control flow, and
    // no early return or discard later can skip it
    const at = main.index + main[0].length;
    shader.fragmentShader = `${decl}\n${fs.slice(0, at)}\n${FACE[m]}\n${fs.slice(at)}`;
  };
}
const PATCHES = Object.fromEntries(Object.keys(FACE).map((k) => [k, patchFor(k)]));

function patchMaterial(m) {
  if (m.isRawShaderMaterial || m.glslVersion === THREE.GLSL3) return; // (none in the scene; they declare their own outputs)
  const mode = faceMode(m);
  const key = KEY + mode;
  const p = m.userData.patches;
  if (p?.has(key)) return;
  if (p) {
    for (const k of p.keys()) if (k.startsWith(KEY)) p.delete(k);
  } else if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
    // a material with its own onBeforeCompile keeps it as the first patch,
    // keyed by its own program cache key
    const own = m.onBeforeCompile, ownKey = m.customProgramCacheKey();
    addShaderPatch(m, `own:${ownKey}`, (s, r) => own.call(m, s, r));
  }
  addShaderPatch(m, key, PATCHES[mode]);
}

function noAO(o) {
  for (; o; o = o.parent) if (o.userData.noAO) return true;
  return false;
}

export class SceneGBuffer {
  // target: the multisampled scene target (count 2, with a depthTexture)
  constructor(renderer, target) {
    this.renderer = renderer;
    this.target = target;
    target.resolveDepthBuffer = false; // copied by _copyDepth() instead
    this._snapped = false;
    this._hooked = new WeakSet();
    this._late = () => this._lateDraw();
  }

  // Idempotent and cheap: called for every visible object each frame.
  prepare(o) {
    const ms = o.material;
    if (Array.isArray(ms)) { for (const m of ms) this._prepare(m, o); } else this._prepare(ms, o);
  }

  _prepare(m, o) {
    const late = !isOpaque(m) || noAO(o);
    if (!late) { patchMaterial(m); return; }
    if (this._hooked.has(m)) return;
    this._hooked.add(m);
    const prev = m.onBeforeRender, late0 = this._late;
    m.onBeforeRender = prev === THREE.Material.prototype.onBeforeRender ? late0 : function (...a) { late0(...a); return prev.apply(this, a); };
  }

  // around the scene pass
  begin() { this._snapped = false; }
  end() {
    if (!this._snapped) { this._copyDepth(); return; }
    const r = this.renderer, gl = r.getContext(), p = r.properties.get(this.target);
    r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, p.__webglMultisampledFramebuffer || p.__webglFramebuffer);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }

  _lateDraw() {
    const r = this.renderer;
    if (this._snapped || r.getRenderTarget() !== this.target) return;
    this._snapped = true;
    this._copyDepth();
    const gl = r.getContext();
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]); // (on the multisampled framebuffer, bound by _copyDepth)
  }

  // multisampled depth -> depth texture (one sample per pixel, as three's
  // own resolve does)
  _copyDepth() {
    const r = this.renderer, gl = r.getContext(), st = r.state, t = this.target, p = r.properties.get(t);
    const ms = p.__webglMultisampledFramebuffer;
    if (!ms) return; // (multisampled-render-to-texture path: resolved implicitly, depth included)
    // (three binds FRAMEBUFFER directly in its MRT resolve, which leaves its
    // READ_FRAMEBUFFER cache stale: go through null to force real binds)
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, ms);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, p.__webglFramebuffer);
    gl.blitFramebuffer(0, 0, t.width, t.height, 0, 0, t.width, t.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    st.bindFramebuffer(gl.READ_FRAMEBUFFER, null); // (three's own resolve expects this)
    st.bindFramebuffer(gl.DRAW_FRAMEBUFFER, ms);
  }
}
