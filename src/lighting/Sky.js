import * as THREE from 'three';

// Gradient sky dome with a soft sun glow and faint banded clouds. Follows the
// camera so it never clips.
export class Sky {
  constructor(sunDir) {
    this.uniforms = {
      uTop: { value: new THREE.Color(0x2f73d8) },
      uHorizon: { value: new THREE.Color(0xcfe4f7) },
      uBottom: { value: new THREE.Color(0x9bb8a0) },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new THREE.Color(0xfff2d0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.55)) : mix(uHorizon, uBottom, clamp(-h*4.0,0.0,1.0));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          c += uSunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }
  follow(camera) { this.mesh.position.copy(camera.position); }
}
