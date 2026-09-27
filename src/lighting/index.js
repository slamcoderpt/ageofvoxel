import * as THREE from 'three';
import { Sky } from './Sky.js';
import { PostFX } from './PostFX.js';
import { MaterialPatcher } from './MaterialPatches.js';
import { fowUniforms } from '../core/FogOfWar.js';
import { VOXEL } from '../core/constants.js';

// Soft shadows without grain, with a penumbra that widens with distance from
// the caster (a cheap PCSS). three's PCF rotates a 5-tap Vogel disk by
// per-pixel noise, which leaves a stippled fringe on every shadow edge; this
// uses fixed taps of hardware-PCF (bilinear) lookups instead:
//  - a tight 2x2 box (contact shadows at wall bases stay crisp),
//  - two rotated rings of 4 at a wide radius (soft outer penumbra),
//  - the wide ring again with the receiver depth pulled toward the light by
//    ~2.5 world units: only blockers further away than that still shadow, so
//    the ratio says how far the casters are. Near casters -> tight filter,
//    far casters (a roof edge several units up) -> wide, soft falloff.
// Shadow camera is orthographic (near 1, far 400): depth is linear in z.
{
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;');
  const b = a < 0 ? -1 : src.indexOf(') * 0.2;', a);
  if (a >= 0 && b > a) {
    THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + `
				vec2 st = vec2( radius * 0.4 );
				float z = shadowCoord.z;
				#define ATM_SH( o, zz ) texture( shadowMap, vec3( shadowCoord.xy + ( o ), zz ) )
				float shN = 0.25 * ( ATM_SH( vec2( -st.x, -st.y ), z ) + ATM_SH( vec2( st.x, -st.y ), z ) +
					ATM_SH( vec2( -st.x, st.y ), z ) + ATM_SH( vec2( st.x, st.y ), z ) );
				float rw = radius * 4.2, rd = rw * 0.7071;
				float zf = z - 0.0065;
				vec2 w0 = vec2( rw, 0.0 ), w1 = vec2( 0.0, rw ), w2 = vec2( rd, rd ), w3 = vec2( rd, -rd );
				vec2 m0 = w2 * 0.5, m1 = w3 * 0.5;
				float shW = 0.125 * ( ATM_SH( w0, z ) + ATM_SH( -w0, z ) + ATM_SH( w1, z ) + ATM_SH( -w1, z ) +
					ATM_SH( m0, z ) + ATM_SH( -m0, z ) + ATM_SH( m1, z ) + ATM_SH( -m1, z ) );
				float shF = 0.125 * ( ATM_SH( w0, zf ) + ATM_SH( -w0, zf ) + ATM_SH( w1, zf ) + ATM_SH( -w1, zf ) +
					ATM_SH( m0, zf ) + ATM_SH( -m0, zf ) + ATM_SH( m1, zf ) + ATM_SH( -m1, zf ) );
				#undef ATM_SH
				// fraction of the wide-ring occluders that are far from the receiver
				float farFrac = clamp( ( 1.0 - shF ) / max( 1.0 - shW, 1e-3 ), 0.0, 1.0 );
				float soft = smoothstep( 0.15, 0.9, farFrac ) * step( 1e-3, 1.0 - min( shW, shN ) );
				shadow = mix( shN, 0.5 * shN + 0.5 * shW, 0.15 ) ;
				shadow = mix( shadow, 0.45 * shN + 0.55 * shW, soft );` + src.slice(b + ') * 0.2;'.length);
  }
}

// Quality levels (?quality=high|medium|low, or the Graphics row of the HUD's
// gear card). 'high' is the reference look. The lower levels trade GPU work
// for fidelity: pixel ratio cap, GTAO resolution (0 = off) and shadow map size.
// With post-processing every pixel pays for MSAA, GTAO, bloom and the grade;
// 1.5x on a 2x (high-DPI) screen is 56% of the pixels and looks the same at
// RTS viewing distance, so even 'high' caps there (2x without post).
export const QUALITY = {
  high: { pixelRatio: 1.5, pixelRatioNoPost: 2, ao: 1, shadow: 4096 },
  medium: { pixelRatio: 1, pixelRatioNoPost: 1, ao: 0.5, shadow: 2048 },
  low: { pixelRatio: 1, pixelRatioNoPost: 1, ao: 0, shadow: 2048 },
};

// Owns the renderer, sun/sky/hemisphere lights, shadows, atmospheric fog and
// post-processing. Other pieces never touch renderer settings directly.
//
// Query params: ?post=high|low|off  ?quality=high|medium|low
export class Lighting {
  constructor(game, { post = 'high', quality = 'high', preserveDrawingBuffer = false } = {}) {
    this.game = game;
    this.postLevel = post;
    const renderer = new THREE.WebGLRenderer({ antialias: post === 'off', powerPreference: 'high-performance', preserveDrawingBuffer });
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCF with a Vogel-disk radius (soft)
    renderer.shadowMap.autoUpdate = false; // drawn once per frame, see draw()
    // PBR Neutral keeps hue and saturation into the highlights (ACES bleached
    // sunlit sandstone to grey-white); all exposure is applied here, before
    // tone mapping, so the grade never has to push values past white.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 2.45;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    const scene = game.scene;

    // Sun: golden late-afternoon light (~31 deg elevation, ~5000K) so buildings and
    // trees throw long, readable shadows like Retold's town shots, and tree
    // crowns shade the crowns beside them.
    this.sunDir = new THREE.Vector3(-0.6, 0.47, 0.4).normalize();
    // The sun carries all of the frame's warmth (the grade adds none).
    this.sun = new THREE.DirectionalLight(0xffd9a0, 5.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); // set by setQuality()
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 1.8;
    // cast shadows are not opaque slabs: ~35% of the sun still reaches them
    // (Retold's plaza shade stays light and walkable, cobbles readable)
    this.sun.shadow.intensity = 0.88;
    this.shadowExtent = 60;
    scene.add(this.sun, this.sun.target);

    // Sky light is a soft cool blue and the ground bounce warm-brown: shadows
    // read as clean cool shade against the warm sunlit stone and roofs.
    this.hemi = new THREE.HemisphereLight(0x9ec4ea, 0x6e6a52, 0.85);
    scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xa4c0e0, 0.3); // soft cool bounce from the opposite side
    this.fill.position.set(0.6, 0.5, -0.5);
    scene.add(this.fill);

    this.sky = new Sky(this.sunDir);
    scene.add(this.sky.mesh);
    // Aerial haze: a soft warm grey-blue (Retold's distance is milky warm air,
    // not white fog). It starts just in front of the view centre and ramps
    // slowly, so the forest at the top of an RTS frame recedes and loses
    // contrast while the town in the middle stays clean.
    this.hazeColor = new THREE.Color(0xc6ced3); // cool, low-contrast air
    this.hazeNear = 0.9; this.hazeFar = 2.6; // x camera distance
    scene.fog = new THREE.Fog(this.hazeColor, 80, 400);
    scene.background = this.hazeColor.clone();

    this.patcher = new MaterialPatcher(game);

    this.post = post === 'off' ? null : new PostFX(renderer, scene, game.camera, post);
    // The depth-only pass (the sun's shadow map) draws objects that carry
    // userData.depthGeometry with that geometry instead: the same surface
    // without colour or AO, so far fewer triangles.
    const smap = renderer.shadowMap, smRender = smap.render.bind(smap);
    smap.render = (...a) => { this._depthGeometry(true); try { smRender(...a); } finally { this._depthGeometry(false); } };
    this.setQuality(quality);
  }

  // Switch quality level live (no reload): pixel ratio, AO, shadow map size.
  setQuality(q) {
    if (!Object.hasOwn(QUALITY, q)) q = 'high';
    this.quality = q;
    const Q = QUALITY[q];
    const r = Math.min(devicePixelRatio, this.post ? Q.pixelRatio : Q.pixelRatioNoPost);
    const sm = this.postLevel === 'high' ? Q.shadow : 2048;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== sm) {
      sh.mapSize.set(sm, sm);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
    }
    this.post?.setAO(Q.ao);
    if (r !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(r);
      this.post?.setPixelRatio(r);
      if (this.game.scene && this.game.renderOrder) this.game.resize();
    }
  }

  // Visual per-frame update: keep the shadow frustum centred on the view and
  // snapped to texels to avoid shimmering.
  render() {
    const ctl = this.game.cameraCtl;
    const t = ctl.target;
    const ext = Math.max(40, ctl.distance * 1.25);
    const cam = this.sun.shadow.camera;
    if (cam.right !== ext) {
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.near = 1; cam.far = 400;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * ext) / this.sun.shadow.mapSize.x;
    const cx = Math.round(t.x / texel) * texel, cz = Math.round(t.z / texel) * texel;
    this.sun.target.position.set(cx, t.y, cz);
    this.sun.position.set(cx + this.sunDir.x * 150, t.y + this.sunDir.y * 150, cz + this.sunDir.z * 150);
    this.sun.target.updateMatrixWorld();
    const f = this.game.scene.fog;
    // aerial perspective: starts just past the view centre so the top third of
    // an RTS frame lifts and desaturates while the focal area stays clean
    f.near = ctl.distance * this.hazeNear;
    f.far = ctl.distance * this.hazeFar + 30;
    this.sky.follow(this.game.camera);
    // with fog of war on, everything beyond the explored map reads as black (AoM style)
    const fow = fowUniforms.fowStrength.value > 0;
    this.sky.mesh.visible = !fow;
    this.game.scene.background = fow ? this._black || (this._black = new THREE.Color(0)) : this.hazeColor;
  }

  draw() {
    this.patcher.scan();
    this.patcher.update(this.sunDir, this.game.camera);
    // The shadow map is drawn once per frame, by the scene render. With
    // autoUpdate three redraws it on every renderer.render() of the scene
    // (GTAO's normal pass used to be a second one).
    this.renderer.shadowMap.needsUpdate = true;
    // World matrices are brought up to date once here (each render() of the
    // scene used to walk and recompose the whole scene graph).
    const scene = this.game.scene;
    scene.matrixWorldAutoUpdate = false;
    scene.updateMatrixWorld();
    const { culled, hidden } = this._cullForFrame();
    if (this.post) this.post.render();
    else this.renderer.render(this.game.scene, this.game.camera);
    for (const o of culled) o.castShadow = true;
    for (const o of hidden) o.visible = true;
    culled.length = 0;
    hidden.length = 0;
  }

  _depthGeometry(on) {
    // (counts nesting, in case a depth pass renders the shadow map)
    this._depthLevel = (this._depthLevel || 0) + (on ? 1 : -1);
    if (this._depthLevel !== (on ? 1 : 0)) return;
    const list = this._cull?.depth;
    if (!list) return;
    for (const o of list) {
      if (on) { o.userData.fullGeometry = o.geometry; o.geometry = o.userData.depthGeometry; }
      else if (o.userData.fullGeometry) { o.geometry = o.userData.fullGeometry; o.userData.fullGeometry = null; }
    }
  }

  // Per-frame culling on top of three's own frustum test, undone after the
  // frame is drawn:
  //  - Instanced meshes with no instances this frame are hidden. three skips
  //    their draw but still binds program, uniforms and buffers for each one
  //    in every pass (units keep a mesh per type and body part).
  //  - Shadow casters whose shadow cannot reach anything on screen are left out
  //    of the shadow pass. The shadow camera covers a square round the view
  //    centre, much of it below and beside the screen; a caster matters only
  //    if the volume its bounding sphere sweeps along the sunlight, down to
  //    the lowest ground, meets the view frustum. The test is conservative
  //    (per frustum plane, both ends of the sweep), so nothing that could
  //    shade a visible pixel is ever dropped.
  // It also prepares every visible object's material for the AO g-buffer
  // while the scene pass writes one (GBuffer.js), before anything is drawn.
  _cullForFrame() {
    const t = this._cull || (this._cull = {
      frustum: new THREE.Frustum(), m: new THREE.Matrix4(), sphere: new THREE.Sphere(),
      end: new THREE.Vector3(), culled: [], hidden: [], depth: [],
    });
    const cam = this.game.camera, culled = t.culled, hidden = t.hidden, depth = t.depth;
    depth.length = 0;
    cam.updateMatrixWorld();
    t.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    t.frustum.setFromProjectionMatrix(t.m, cam.coordinateSystem, cam.reversedDepth);
    const planes = t.frustum.planes;
    const gbuf = this.post?.gbufferActive ? this.post.gbuffer : null;
    const d = this.sunDir; // towards the sun; light travels along -d
    const floor = this._floorY ?? (this._floorY = Math.min(0, this.game.map.heights.reduce((a, b) => Math.min(a, b), 0) * VOXEL) - 1);
    // The cull only reasons about the sun. When another shadow-casting light
    // is lit (the god-power strike spot), casters just off-screen can still
    // shade visible ground through it, so no caster is dropped that frame.
    let otherShadowLight = false;
    const test = (o) => {
      if (o.isLight) { if (o !== this.sun && o.castShadow && o.intensity > 0) otherShadowLight = true; return; }
      if (o.isInstancedMesh && o.count === 0) { o.visible = false; hidden.push(o); return; }
      if (gbuf && o.material) gbuf.prepare(o);
      if (o.userData.depthGeometry) depth.push(o);
      if (!o.castShadow || !o.frustumCulled || !o.geometry) return;
      const bs = o.isInstancedMesh ? (o.boundingSphere || (o.computeBoundingSphere(), o.boundingSphere)) : (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere));
      if (!bs) return;
      const s = t.sphere.copy(bs).applyMatrix4(o.matrixWorld);
      const c = s.center, r = s.radius;
      const k = Math.max(0, (c.y + r - floor) / d.y);
      t.end.set(c.x - d.x * k, c.y - d.y * k, c.z - d.z * k);
      for (let i = 0; i < 6; i++) {
        const p = planes[i];
        if (p.distanceToPoint(c) < -r && p.distanceToPoint(t.end) < -r) {
          o.castShadow = false;
          culled.push(o);
          return;
        }
      }
    };
    this.game.scene.traverseVisible(test);
    if (otherShadowLight) {
      for (const o of culled) o.castShadow = true;
      culled.length = 0;
    }
    return t;
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
  }
}
