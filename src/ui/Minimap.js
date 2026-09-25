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
    this.parent = parent;
    this.S = 2; // canvas pixels per tile (smooth terrain, crisp unit dots)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = N * this.S;
    parent.appendChild(this.canvas);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = N;
    this.ctx = this.canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = N;
    this.dirty = true;
    this.timer = 0;
    this.showTerrain = true; // toggled from the minimap button ring
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
        const lw = tx > 0 && tz > 0 ? map.level(cx - map.cps, cz - map.cps) : l;
        const shade = Math.max(-0.22, Math.min(0.22, (l - lw) * 0.09));
        const k = (0.84 + Math.min(0.25, Math.max(-0.2, (l - 4) * 0.03))) * (1 + shade);
        const i = (tz * N + tx) * 4;
        img.data[i] = rgb[0] * k; img.data[i + 1] = rgb[1] * k; img.data[i + 2] = rgb[2] * k; img.data[i + 3] = 255;
      }
    for (const r of this.game.entities.resources()) {
      const col = r.type === 'tree' ? [30, 70, 26] : r.type === 'gold' ? [255, 214, 70] : [214, 70, 88];
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
    const game = this.game, N = game.map.size, ctx = this.ctx, S = this.S;
    if (this.dirty) this.drawBase();
    const rot = `${(game.cameraCtl.yaw * 180) / Math.PI}deg`;
    if (rot !== this._rot) { this._rot = rot; this.parent.style.setProperty('--mm-rot', rot); }
    ctx.imageSmoothingEnabled = true;
    if (this.showTerrain) ctx.drawImage(this.base, 0, 0, N * S, N * S);
    else { ctx.fillStyle = '#0c2129'; ctx.fillRect(0, 0, N * S, N * S); }
    // fog of war: a tile-res alpha mask, smoothed when scaled up
    const fog = game.fog;
    if (!fog.revealAll) {
      const fctx = this.fogCanvas.getContext('2d');
      let img = this._fogImg;
      if (!img) {
        img = this._fogImg = fctx.createImageData(N, N);
        for (let i = 0; i < N * N; i++) { img.data[i * 4] = 6; img.data[i * 4 + 1] = 8; img.data[i * 4 + 2] = 14; }
      }
      // unexplored land stays faintly readable (like Retold's dimmed map), explored-but-unseen is half dark
      for (let i = 0; i < N * N; i++) {
        const s = fog.state[i];
        img.data[i * 4 + 3] = s === 2 ? 0 : s === 1 ? 95 : 175;
      }
      fctx.putImageData(img, 0, 0);
      ctx.drawImage(this.fogCanvas, 0, 0, N * S, N * S);
    }
    ctx.save();
    ctx.scale(S, S);
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    for (const b of game.entities.buildings()) {
      if (b.owner !== game.localPlayer && !fog.isExplored(b.x, b.z)) continue;
      ctx.fillStyle = 'rgba(0,0,0,.75)';
      ctx.fillRect(b.tx - 0.5, b.tz - 0.5, b.w + 1, b.h + 1);
      ctx.fillStyle = hex(game.players[b.owner].color);
      ctx.fillRect(b.tx, b.tz, b.w, b.h);
    }
    for (const u of game.entities.units()) {
      if (u.dead || (u.owner !== game.localPlayer && !fog.isVisible(u.x, u.z))) continue;
      const r = u.def.myth ? 1.6 : 1.1;
      ctx.fillStyle = 'rgba(0,0,0,.8)';
      ctx.fillRect(u.x - r - 0.5, u.z - r - 0.5, 2 * r + 1, 2 * r + 1);
      ctx.fillStyle = u.owner === game.localPlayer ? '#6fb0ff' : hex(game.players[u.owner].color);
      if (game.selection.has(u.id)) ctx.fillStyle = '#ffffff';
      ctx.fillRect(u.x - r, u.z - r, 2 * r, 2 * r);
    }
    // camera view trapezoid
    const w = innerWidth, h = innerHeight;
    const pick = (x, y, dy) => { for (let i = 0; i < 4; i++) { const g = game.pickGround(x, y + dy * i); if (g) return g; } return null; };
    const corners = [pick(0, 0, h * 0.08), pick(w, 0, h * 0.08), pick(w, h - 1, -h * 0.08), pick(0, h - 1, -h * 0.08)];
    if (corners.every(Boolean)) {
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.z) : ctx.moveTo(c.x, c.z)));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.stroke();
    }
    ctx.restore();
  }
}
