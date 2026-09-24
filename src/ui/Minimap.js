import { GROUND } from '../core/GameMap.js';

// Minimap: a tile-resolution canvas rotated to match the camera yaw so the
// map reads as a diamond, like AoM. Click / drag to move the camera,
// right-click to issue a move/smart order.
const GROUND_RGB = {
  [GROUND.GRASS]: [96, 150, 58], [GROUND.DRYGRASS]: [150, 160, 72], [GROUND.DIRT]: [150, 115, 75],
  [GROUND.SAND]: [215, 196, 140], [GROUND.ROCK]: [140, 134, 124], [GROUND.PAVED]: [200, 190, 165], [GROUND.FARM]: [110, 76, 46],
};

export class Minimap {
  constructor(game, parent) {
    this.game = game;
    const N = game.map.size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = N;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = N;
    this.dirty = true;
    this.timer = 0;
    game.events.on('entity:removed', (e) => { if (e.kind === 'resource') this.dirty = true; });
    game.events.on('building:placed', () => { this.dirty = true; });
    const toWorld = (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = ev.clientX - cx, dy = ev.clientY - cy;
      const yaw = this.game.cameraCtl.yaw;
      // undo the CSS rotation
      const c = Math.cos(-yaw), s = Math.sin(-yaw);
      const rx = dx * c - dy * s, ry = dx * s + dy * c;
      const px = this.canvas.offsetWidth;
      return { x: (rx / px + 0.5) * game.map.worldSize, z: (ry / px + 0.5) * game.map.worldSize };
    };
    let dragging = false;
    this.canvas.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      const p = toWorld(ev);
      if (ev.button === 0) { dragging = true; game.cameraCtl.lookAt(p.x, p.z); }
      else if (ev.button === 2) game.ui.selection.orderAt(p.x, p.z, null);
    });
    addEventListener('mousemove', (ev) => { if (dragging) { const p = toWorld(ev); game.cameraCtl.lookAt(p.x, p.z); } });
    addEventListener('mouseup', () => { dragging = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  drawBase() {
    const map = this.game.map, N = map.size;
    const ctx = this.base.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let tz = 0; tz < N; tz++)
      for (let tx = 0; tx < N; tx++) {
        const cx = tx * map.cps, cz = tz * map.cps;
        const l = map.level(cx, cz);
        let rgb;
        if (l < map.waterLevel) rgb = l < map.waterLevel - 2 ? [34, 90, 150] : [60, 150, 170];
        else rgb = GROUND_RGB[map.groundAt(cx, cz)] || GROUND_RGB[0];
        const k = 0.8 + Math.min(0.35, Math.max(-0.2, (l - 4) * 0.035));
        const i = (tz * N + tx) * 4;
        img.data[i] = rgb[0] * k; img.data[i + 1] = rgb[1] * k; img.data[i + 2] = rgb[2] * k; img.data[i + 3] = 255;
      }
    for (const r of this.game.entities.resources()) {
      const col = r.type === 'tree' ? [36, 82, 30] : r.type === 'gold' ? [250, 210, 60] : [210, 60, 60];
      for (let z = r.tz; z < r.tz + r.h; z++)
        for (let x = r.tx; x < r.tx + r.w; x++) {
          const i = (z * N + x) * 4;
          img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2];
        }
    }
    ctx.putImageData(img, 0, 0);
    this.dirty = false;
  }

  render(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const game = this.game, N = game.map.size, ctx = this.ctx;
    if (this.dirty) this.drawBase();
    this.canvas.style.setProperty('--mm-rot', `${(game.cameraCtl.yaw * 180) / Math.PI}deg`);
    ctx.drawImage(this.base, 0, 0);
    // fog of war
    const fog = game.fog;
    if (!fog.revealAll) {
      const img = ctx.getImageData(0, 0, N, N);
      for (let i = 0; i < N * N; i++) {
        const s = fog.state[i];
        if (s === 2) continue;
        const k = s === 1 ? 0.5 : 0;
        img.data[i * 4] *= k; img.data[i * 4 + 1] *= k; img.data[i * 4 + 2] *= k;
      }
      ctx.putImageData(img, 0, 0);
    }
    for (const b of game.entities.buildings()) {
      if (b.owner !== game.localPlayer && !fog.isExplored(b.x, b.z)) continue;
      ctx.fillStyle = '#' + game.players[b.owner].color.toString(16).padStart(6, '0');
      ctx.fillRect(b.tx, b.tz, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.strokeRect(b.tx + 0.5, b.tz + 0.5, b.w - 1, b.h - 1);
    }
    for (const u of game.entities.units()) {
      if (u.dead || (u.owner !== game.localPlayer && !fog.isVisible(u.x, u.z))) continue;
      ctx.fillStyle = u.owner === game.localPlayer ? '#5fa0ff' : '#ff4a3a';
      ctx.fillRect(Math.floor(u.x) - 1, Math.floor(u.z) - 1, 2, 2);
    }
    // camera view trapezoid
    const w = innerWidth, h = innerHeight;
    const corners = [[0, 40], [w, 40], [w, h - 196], [0, h - 196]].map(([x, y]) => game.pickGround(x, y));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.z) : ctx.moveTo(c.x, c.z)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
