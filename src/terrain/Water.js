import * as THREE from 'three';
import { VOXEL } from '../core/constants.js';
import { fowUniforms } from '../core/FogOfWar.js';

// Animated water: layered wave normals, depth-tinted colour (turquoise
// shallows -> deep blue), shoreline foam, fresnel sky reflection and a sun
// glint. Depth comes from a texture baked from the heightmap.
export class Water {
  constructor(game, terrainMesh) {
    this.game = game;
    const map = game.map;
    const C = map.cols;
    const depth = new Uint8Array(C * C);
    const wy = map.waterY();
    for (let cz = 0; cz < C; cz++)
      for (let cx = 0; cx < C; cx++) {
        // metres below the surface, from the smoothed seabed
        const bed = terrainMesh ? terrainMesh.surfaceY(cx, cz) : map.heights[cz * C + cx] * VOXEL;
        const d = wy - bed;
        depth[cz * C + cx] = Math.max(0, Math.min(255, Math.round(d * 40)));
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
      uShallow: { value: new THREE.Color(0x5fd8c2) },
      uMid: { value: new THREE.Color(0x1f9aa6) },
      uDeep: { value: new THREE.Color(0x0f4d70) },
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
        uniform vec3 uSunDir, uShallow, uMid, uDeep, uSky, fogColor; uniform float fogNear, fogFar;
        varying vec3 vWorld; varying float vFogDepth;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p){ return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.7) * 0.15; }
        vec2 wave(vec2 p, vec2 d, float f, float s, float t){ float ph = dot(p, d) * f + t * s; return d * cos(ph) * f; }
        // caustic-like cell pattern
        float caustic(vec2 p, float t){
          vec2 q = p + vec2(vnoise(p * 0.7 + t * 0.3), vnoise(p * 0.7 - t * 0.27 + 5.0)) * 1.6;
          float a = abs(sin(q.x * 2.3 + t * 0.9) + sin(q.y * 2.1 - t * 0.7) + sin((q.x + q.y) * 1.6 + t * 0.5));
          return pow(clamp(1.0 - a * 0.5, 0.0, 1.0), 3.0);
        }
        void main(){
          vec2 p = vWorld.xz;
          vec2 uv = p / uWorldSize;
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float depth = mix(3.0, texture2D(uDepth, uv).r * 255.0 / 40.0, inside);
          // wave normal: a few directional swells plus scrolling noise chop
          vec2 g = wave(p, normalize(vec2(1.0, 0.3)), 0.9, 1.4, uTime) * 0.05
                 + wave(p, normalize(vec2(-0.4, 1.0)), 1.7, 2.0, uTime) * 0.035
                 + wave(p, normalize(vec2(0.7, -0.8)), 3.1, 2.9, uTime) * 0.02;
          vec2 np = p * 1.3 + vec2(uTime * 0.25, uTime * 0.18);
          float e = 0.08;
          float n0 = fbm(np), nx = fbm(np + vec2(e, 0.0)), nz = fbm(np + vec2(0.0, e));
          vec2 np2 = p * 3.1 - vec2(uTime * 0.31, -uTime * 0.22);
          float m0 = vnoise(np2), mx = vnoise(np2 + vec2(e, 0.0)), mz = vnoise(np2 + vec2(0.0, e));
          g += vec2(nx - n0, nz - n0) / e * 0.09 + vec2(mx - m0, mz - m0) / e * 0.035;
          float calm = mix(0.45, 1.0, smoothstep(0.0, 1.5, depth)); // flatter in the shallows
          vec3 n = normalize(vec3(-g.x * calm, 1.0, -g.y * calm));
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          // depth tint: clear turquoise shallows -> teal -> deep blue-green
          float d1 = smoothstep(0.0, 0.9, depth), d2 = smoothstep(0.7, 3.2, depth);
          vec3 base = mix(mix(uShallow, uMid, d1), uDeep, d2);
          // large slow colour variation so open water is not flat
          float big = fbm(p * 0.06 + uTime * 0.01);
          base *= 0.9 + big * 0.22;
          vec3 c = mix(base, uSky, fres * 0.55 + 0.05);
          // caustics shimmering in the shallows
          float cau = caustic(p * 1.1, uTime) * (1.0 - smoothstep(0.1, 1.4, depth)) * smoothstep(0.02, 0.15, depth);
          c += vec3(0.75, 0.95, 0.9) * cau * 0.35;
          vec3 h = normalize(uSunDir + v);
          float spec = pow(max(dot(n, h), 0.0), 180.0) * 2.2;
          float sheen = pow(max(dot(n, h), 0.0), 18.0) * 0.12;
          c += vec3(1.0, 0.95, 0.82) * (spec + sheen);
          // shoreline foam: lapping bands rolling in towards the beach, broken up by noise
          float fn = fbm(p * 2.2 + vec2(uTime * 0.2, -uTime * 0.15));
          float bands = sin(depth * 16.0 + uTime * 2.2 + fn * 4.0) * 0.5 + 0.5;
          float bandMask = 1.0 - smoothstep(0.08, 0.55, depth);
          float foam = smoothstep(0.72, 0.95, bands) * bandMask * smoothstep(0.35, 0.6, fn + 0.15);
          float edge = 1.0 - smoothstep(0.0, 0.1 + fn * 0.08, depth); // contact line
          foam = max(foam, edge * smoothstep(0.25, 0.55, fn + 0.1));
          // soft light/dark swell bands on open water
          float swell = sin(dot(p, normalize(vec2(1.0, 0.3))) * 0.9 + uTime * 1.4 + big * 3.0);
          c *= 1.0 + swell * 0.035 * smoothstep(0.8, 2.5, depth);
          foam = clamp(foam, 0.0, 1.0);
          c = mix(c, vec3(0.95, 0.98, 1.0), foam * 0.85);
          float alpha = mix(0.3, 0.94, smoothstep(0.0, 1.6, depth));
          alpha = max(alpha, foam * 0.92);
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
