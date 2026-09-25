import * as THREE from 'three';
import { Sky } from './Sky.js';
import { PostFX } from './PostFX.js';
import { MaterialPatcher } from './MaterialPatches.js';
import { fowUniforms } from '../core/FogOfWar.js';

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
    // PBR Neutral keeps hue and saturation into the highlights (ACES bleached
    // sunlit sandstone to grey-white); all exposure is applied here, before
    // tone mapping, so the grade never has to push values past white.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 2.85;
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
    const sm = post === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 1.8;
    // cast shadows block the sun fully: shade is lit by the cool sky alone and
    // lands at ~40% of the sunlit value on screen (Retold's crisp blue shade)
    this.sun.shadow.intensity = 1.0;
    this.shadowExtent = 60;
    scene.add(this.sun, this.sun.target);

    // Sky light is a soft cool blue and the ground bounce warm-brown: shadows
    // read as clean cool shade against the warm sunlit stone and roofs.
    this.hemi = new THREE.HemisphereLight(0x8fb6f2, 0x5a5444, 0.66);
    scene.add(this.hemi);
    this.fill = new THREE.DirectionalLight(0x9cbcea, 0.22); // soft cool bounce from the opposite side
    this.fill.position.set(0.6, 0.5, -0.5);
    scene.add(this.fill);

    this.sky = new Sky(this.sunDir);
    scene.add(this.sky.mesh);
    // Aerial haze: a soft warm grey-blue (Retold's distance is milky warm air,
    // not white fog). It starts just in front of the view centre and ramps
    // slowly, so the forest at the top of an RTS frame recedes and loses
    // contrast while the town in the middle stays clean.
    this.hazeColor = new THREE.Color(0xc6ced3); // cool, low-contrast air
    this.hazeNear = 1.3; this.hazeFar = 3.2; // x camera distance
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
    if (this.post) this.post.render();
    else this.renderer.render(this.game.scene, this.game.camera);
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
  }
}
