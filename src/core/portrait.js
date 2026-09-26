import * as THREE from 'three';

// Render an Object3D to a small PNG data URL (unit/building portraits for the
// HUD). Uses the main renderer and an offscreen target.
const cache = new Map();
export function renderPortrait(renderer, key, makeObject, size = 128) {
  if (cache.has(key)) return cache.get(key);
  const scene = new THREE.Scene();
  scene.background = null;
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5a4a30, 2.2));
  const sun = new THREE.DirectionalLight(0xfff0d0, 3.2);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const obj = makeObject();
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z) * 0.62;
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  cam.position.set(c.x + r * 2.2, c.y + r * 1.4, c.z + r * 3.2);
  cam.lookAt(c);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const prevT = renderer.getRenderTarget();
  const prevC = renderer.getClearColor(new THREE.Color());
  const prevA = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
  renderer.setRenderTarget(prevT);
  renderer.setClearColor(prevC, prevA);
  rt.dispose();
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  // flip Y and convert linear -> sRGB-ish gamma
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const si = ((size - 1 - y) * size + x) * 4, di = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(Math.pow(px[si + k] / 255, 1 / 2.2) * 255);
      img.data[di + 3] = px[si + 3];
    }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
