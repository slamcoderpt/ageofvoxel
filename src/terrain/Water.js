import * as THREE from 'three';
import { VOXEL } from '../core/constants.js';
import { fowUniforms } from '../core/FogOfWar.js';

// Animated water: layered wave normals, depth-tinted colour (turquoise
// shallows -> deep blue), shoreline foam, fresnel sky reflection and a sun
// glint. Depth comes from a texture baked from the heightmap.
export class Water {
  constructor(game) {
    this.game = game;
    const map = game.map;
    const C = map.cols;
    const depth = new Uint8Array(C * C);
    for (let i = 0; i < C * C; i++) {
      const d = (map.waterLevel - map.heights[i]) * VOXEL + 0.15; // metres below surface
      depth[i] = Math.max(0, Math.min(255, Math.round(d * 40)));
    }
    this.depthTex = new THREE.DataTexture(depth, C, C, THREE.RedFormat, THREE.UnsignedByteType);
    this.depthTex.magFilter = THREE.LinearFilter;
    this.depthTex.minFilter = THREE.LinearFilter;
    this.depthTex.needsUpdate = true;

    const ws = map.worldSize;
    this.uniforms = {
      uTime: { value: 0 },
      uDepth: { value: this.depthTex },
      uWorldSize: { value: ws },
      uSunDir: { value: game.lighting.sunDir.clone() },
      uShallow: { value: new THREE.Color(0x3fc6c0) },
      uDeep: { value: new THREE.Color(0x0f4f8f) },
      uSky: { value: new THREE.Color(0xbfe0ff) },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
      ...fowUniforms,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: `
        uniform float uTime; varying vec3 vWorld; varying float vFogDepth;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          wp.y += sin(wp.x * 0.35 + uTime * 1.3) * 0.03 + cos(wp.z * 0.42 + uTime * 1.1) * 0.03;
          vWorld = wp.xyz;
          vec4 mv = viewMatrix * wp;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime, uWorldSize, fowStrength; uniform sampler2D uDepth, fowTex;
        uniform vec3 uSunDir, uShallow, uDeep, uSky, fogColor; uniform float fogNear, fogFar;
        varying vec3 vWorld; varying float vFogDepth;
        vec2 wave(vec2 p, vec2 d, float f, float s, float t){ float ph = dot(p, d) * f + t * s; return d * cos(ph) * f; }
        void main(){
          vec2 p = vWorld.xz;
          vec2 uv = p / uWorldSize;
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float depth = mix(3.0, texture2D(uDepth, uv).r * 255.0 / 40.0, inside);
          // wave normal from a few directional waves
          vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 1.3, 1.7, uTime) * 0.06
                 + wave(p, normalize(vec2(-0.4, 1.0)), 2.1, 2.3, uTime) * 0.04
                 + wave(p, normalize(vec2(0.7, -0.8)), 3.7, 3.1, uTime) * 0.025
                 + wave(p, normalize(vec2(-0.9, -0.2)), 6.3, 4.3, uTime) * 0.015;
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          float dk = 1.0 - exp(-depth * 1.1);
          vec3 base = mix(uShallow, uDeep, dk);
          vec3 c = mix(base, uSky, fres * 0.6 + 0.08);
          vec3 h = normalize(uSunDir + v);
          float spec = pow(max(dot(n, h), 0.0), 220.0) * 3.0;
          c += vec3(1.0, 0.95, 0.8) * spec;
          // shoreline foam
          float foamBand = 1.0 - smoothstep(0.05, 0.35, depth);
          float foamN = sin(p.x * 3.1 + uTime * 2.0) * sin(p.y * 2.7 - uTime * 1.6);
          float foam = foamBand * smoothstep(-0.2, 0.6, foamN + (1.0 - depth * 3.0));
          c = mix(c, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.8);
          float alpha = mix(0.35, 0.93, smoothstep(0.0, 1.2, depth));
          alpha = max(alpha, foam * 0.9);
          // fog of war
          float fowV = texture2D(fowTex, uv).r;
          fowV *= inside;
          float fowF = mix(1.0, smoothstep(0.0, 0.5, fowV) * (0.45 + 0.55 * smoothstep(0.5, 1.0, fowV)), fowStrength);
          float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          c = mix(c, fogColor, fogF);
          c *= fowF;
          gl_FragColor = vec4(c, alpha);
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(ws * 5, ws * 5, 200, 200);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(ws / 2, map.waterY(), ws / 2);
    this.mesh.renderOrder = 5;
    this.mesh.receiveShadow = false;
    this.mesh.name = 'water';
    this.mesh.userData.noAO = true;
  }
  update(time) {
    this.uniforms.uTime.value = time;
    const f = this.game.scene.fog;
    if (f) { this.uniforms.fogColor.value.copy(f.color); this.uniforms.fogNear.value = f.near; this.uniforms.fogFar.value = f.far; }
  }
}
