import * as THREE from 'three';

// High 3/4 RTS camera. The view is defined by a ground target, a distance, a
// pitch (angle above the horizon) and a yaw. Pan with the arrow keys, edge
// scroll, middle-drag; zoom with the wheel.
export class CameraController {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.target = new THREE.Vector3(64, 0, 64);
    this.distance = 42;
    this.minDist = 14;
    this.maxDist = 110;
    this.pitch = THREE.MathUtils.degToRad(52);
    this.yaw = THREE.MathUtils.degToRad(45);
    this.edgeScroll = true;
    this.panSpeed = 1.0;
    this.userControl = true;
    this._drag = null;
    const dom = game.renderer.domElement;
    dom.addEventListener('mousedown', (e) => {
      if (e.button === 1) { this._drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => { if (e.button === 1) this._drag = null; });
    addEventListener('mousemove', (e) => {
      if (!this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag = { x: e.clientX, y: e.clientY };
      this.panScreen(-dx * this.distance * 0.0022, -dy * this.distance * 0.0032);
    });
    this.apply();
  }

  // Set the whole view at once (used by scenes). Angles in degrees.
  setView({ x, z, distance, pitch, yaw }) {
    if (x !== undefined) this.target.x = x;
    if (z !== undefined) this.target.z = z;
    if (distance !== undefined) this.distance = distance;
    if (pitch !== undefined) this.pitch = THREE.MathUtils.degToRad(pitch);
    if (yaw !== undefined) this.yaw = THREE.MathUtils.degToRad(yaw);
    this.apply();
  }
  lookAt(x, z) { this.target.x = x; this.target.z = z; this.apply(); }

  // Pan in screen-aligned ground directions.
  panScreen(right, forward) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.target.x += rx * right + fx * forward;
    this.target.z += rz * right + fz * forward;
  }

  update(dt) {
    if (this.userControl) {
      const input = this.game.input;
      const k = input.keys;
      const sp = this.distance * 1.1 * dt * this.panSpeed;
      let r = 0, f = 0;
      // Letter keys are reserved for command hotkeys; pan with the arrows.
      if (k.has('ArrowUp')) f += sp;
      if (k.has('ArrowDown')) f -= sp;
      if (k.has('ArrowRight')) r += sp;
      if (k.has('ArrowLeft')) r -= sp;
      if (this.edgeScroll && input.mouse.inside && document.hasFocus()) {
        const m = 6, w = innerWidth, h = innerHeight, { x, y } = input.mouse;
        if (x <= m) r -= sp; if (x >= w - m) r += sp;
        if (y <= m) f += sp; if (y >= h - m) f -= sp;
      }
      if (r || f) this.panScreen(r, f);
      const wheel = input.consumeWheel();
      if (wheel) this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(wheel * 0.0012), this.minDist, this.maxDist);
    }
    this.apply();
  }

  apply() {
    const ws = this.game.map.worldSize;
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, ws);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, ws);
    this.target.y = this.game.map.smoothHeightAt(this.target.x, this.target.z);
    const h = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * h,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * h,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
