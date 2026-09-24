import * as THREE from 'three';

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector2();
const _p = new THREE.Vector3();

// Screen (client px) -> ground point by marching the heightfield.
export function pickGround(game, clientX, clientY) {
  const rect = game.renderer.domElement.getBoundingClientRect();
  _v.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  _ray.setFromCamera(_v, game.camera);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  const map = game.map;
  let t = 0, prevT = 0;
  const step = 0.35;
  for (let i = 0; i < 2000; i++) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= map.heightAt(x, z)) {
      // refine
      let a = prevT, b = t;
      for (let k = 0; k < 8; k++) {
        const m = (a + b) / 2;
        const my = o.y + d.y * m;
        if (my <= map.heightAt(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m;
      }
      return { x: o.x + d.x * b, y: o.y + d.y * b, z: o.z + d.z * b };
    }
    prevT = t;
    t += step;
    if (y < -20) break;
  }
  // fallback: intersect y = 0 plane
  if (d.y < 0) { const tt = -o.y / d.y; return { x: o.x + d.x * tt, y: 0, z: o.z + d.z * tt }; }
  return null;
}

// World -> screen (client px). Returns {x, y, visible}.
export function worldToScreen(game, x, y, z) {
  _p.set(x, y, z).project(game.camera);
  const rect = game.renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + (_p.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-_p.y * 0.5 + 0.5) * rect.height,
    visible: _p.z > -1 && _p.z < 1,
  };
}
