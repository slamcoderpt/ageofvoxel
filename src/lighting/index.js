import * as THREE from 'three';
import { Sky } from './Sky.js';
import { PostFX } from './PostFX.js';
import { MaterialPatcher } from './MaterialPatches.js';
import { fowUniforms } from '../core/FogOfWar.js';

// Soft shadows without grain: three's PCF rotates a 5-tap Vogel disk by
// per-pixel noise, which leaves a stippled, "filtered" fringe on every shadow
// edge (leaf crowns, plaza). Replace it with a fixed 2x2 box of hardware-PCF
// (bilinear) taps: similar softness, smooth edges, no per-pixel noise, and
// one tap cheaper than the stock filter.
{
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;');
  const b = a < 0 ? -1 : src.indexOf(') * 0.2;', a);
  if (a >= 0 && b > a) {
    THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + `
				vec2 st = vec2( radius * 0.4 );
				shadow = 0.25 * (
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -st.x, -st.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( st.x, -st.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -st.x, st.y ), shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( st.x, st.y ), shadowCoord.z ) ) );` + src.slice(b + ') * 0.2;'.length);
  }
}

// Owns the renderer, sun/sky/hemisphere lights, shadows, atmospheric fog and
// post-processing. Other pieces never touch renderer settings directly.
//
// Query params: ?post=high|low|off
export class Lighting {
  constructor(game, { post = 'high', preserveDrawingBuffer = false } = {}) {
    this.game = game;
    const renderer = new THREE.WebGLRenderer({ antialias: post === 'off', powerPreference: 'high-performance', preserveDrawingBuffer });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCF with a Vogel-disk radius (soft)
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    const scene = game.scene;

    // Sun: golden late-afternoon light (~37 deg elevation) so buildings and
    // trees throw long, readable shadows like Retold's town shots, and tree
    // crowns shade the crowns beside them.
    this.sunDir = new THREE.Vector3(-0.6, 0.55, 0.4).normalize();
    this.sun = new THREE.DirectionalLight(0xffd6a0, 3.9);
    this.sun.castShadow = true;
    const sm = post === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    this.shadowExtent = 60;
    scene.add(this.sun, this.sun.target);

    // Sky light is a soft violet-grey (not cyan) and the ground bounce
    // warm-brown: shadows on pale stone read as desaturated lavender-grey
    // that sits with the warm roofs and the shade under the trees.
    this.hemi = new THREE.HemisphereLight(0xacb0c8, 0x80644a, 1.25);
    scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0xb4b0c8, 0.42); // soft violet-grey bounce from the opposite side
    this.fill.position.set(0.6, 0.5, -0.5);
    scene.add(this.fill);

    this.sky = new Sky(this.sunDir);
    scene.add(this.sky.mesh);
    this.hazeColor = new THREE.Color(0xc4cfd2); // light warm-blue aerial haze
    scene.fog = new THREE.Fog(this.hazeColor, 80, 400);
    scene.background = this.hazeColor.clone();

    this.patcher = new MaterialPatcher(game);

    this.post = post === 'off' ? null : new PostFX(renderer, scene, game.camera, post);
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
    f.near = ctl.distance * 1.25;
    f.far = ctl.distance * 3.6 + 30;
    this.sky.follow(this.game.camera);
    // with fog of war on, everything beyond the explored map reads as black (AoM style)
    const fow = fowUniforms.fowStrength.value > 0;
    this.sky.mesh.visible = !fow;
    this.game.scene.background = fow ? this._black || (this._black = new THREE.Color(0)) : this.hazeColor;
  }

  draw() {
    this.patcher.scan();
    this.patcher.update(this.sunDir, this.game.camera);
    if (this.post) this.post.render();
    else this.renderer.render(this.game.scene, this.game.camera);
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
  }
}
