// Performance overlay: frame rate, frame time, CPU time per frame, draw calls,
// triangles and render resolution, sampled over half-second windows.
// F3 toggles it; the choice is remembered in localStorage. ?fps=1|0 forces it.
// It starts hidden in the capture scenes (?scene=... other than skirmish) so
// scripts/shoot.mjs frames stay clean. With the profiler on (?prof=1 or the
// stress scene) it adds sim ms per tick, the costliest system and the unit count.
import * as THREE from 'three';

export class PerfMeter {
  constructor(game) {
    this.game = game;
    const el = document.createElement('div');
    el.className = 'perf';
    el.innerHTML = `
      <div class="perf-fps"><b>--</b> FPS</div>
      <canvas class="perf-graph" width="120" height="28"></canvas>
      <div class="perf-rows"></div>
      <div class="perf-hint">F3 hide</div>`;
    document.body.appendChild(el);
    this.el = el;
    this.fpsEl = el.querySelector('.perf-fps b');
    this.rowsEl = el.querySelector('.perf-rows');
    this.graph = el.querySelector('.perf-graph').getContext('2d');
    this.history = [];

    const q = new URLSearchParams(location.search);
    const param = q.get('fps');
    const scene = q.get('scene');
    let stored = null;
    try { stored = localStorage.getItem('aov.perf'); } catch { /* storage may be blocked */ }
    if (param !== null) this.setVisible(param !== '0');
    else if (scene && scene !== 'skirmish') this.setVisible(false);
    else this.setVisible(stored !== '0');
    this.post = q.get('post') || 'high';
    this.size = new THREE.Vector2();

    addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      this.setVisible(!this.visible);
      try { localStorage.setItem('aov.perf', this.visible ? '1' : '0'); } catch { /* ignore */ }
    });

    // Draw calls and triangles must add up across every pass of the composer,
    // so the renderer's counters are reset once per frame here, not per render call.
    const renderer = game.renderer;
    renderer.info.autoReset = false;

    this.win = { start: performance.now(), frames: 0, cpu: 0, worst: 0, calls: 0, tris: 0 };
    this.lastFrame = 0;
    const frame = game.frame.bind(game);
    game.frame = (realDt) => {
      const t0 = performance.now();
      if (this.lastFrame) this.sample(t0 - this.lastFrame);
      this.lastFrame = t0;
      renderer.info.reset();
      frame(realDt);
      this.win.cpu += performance.now() - t0;
      this.win.calls += renderer.info.render.calls;
      this.win.tris += renderer.info.render.triangles;
    };
  }

  setVisible(v) {
    this.visible = v;
    this.el.hidden = !v;
  }

  sample(interval) {
    const w = this.win;
    w.frames++;
    if (interval > w.worst) w.worst = interval;
    const now = performance.now();
    const span = now - w.start;
    if (span < 500) return;
    const fps = (w.frames * 1000) / span;
    this.history.push(fps);
    if (this.history.length > 60) this.history.shift();
    if (this.visible) this.show(fps, span / w.frames, w);
    this.win = { start: now, frames: 0, cpu: 0, worst: 0, calls: 0, tris: 0 };
  }

  show(fps, avgMs, w) {
    const r = this.game.renderer;
    const size = r.getDrawingBufferSize(this.size);
    this.fpsEl.textContent = fps < 10 ? fps.toFixed(1) : fps.toFixed(0);
    this.fpsEl.className = fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad';
    const n = Math.max(1, w.frames);
    const rows = [
      ['frame', `${avgMs.toFixed(1)} ms`],
      ['worst', `${w.worst.toFixed(1)} ms`],
      ['cpu', `${(w.cpu / n).toFixed(1)} ms`],
      ['draws', Math.round(w.calls / n)],
      ['tris', `${(w.tris / n / 1e6).toFixed(2)} M`],
      ['res', `${size.x}×${size.y} @${r.getPixelRatio()}x`],
      ['post', this.post],
      ['quality', this.game.lighting.quality],
    ];
    // with the profiler on (?prof=1, stress scene): sim cost per tick and its top system
    const prof = this.game.prof;
    if (prof && prof.sums.ticks) {
      const S = prof.sums, top = Object.entries(S.sys).sort((a, b) => b[1] - a[1])[0];
      rows.push(['sim', `${(S.total / S.ticks).toFixed(1)} ms/tick`]);
      if (top) rows.push([top[0], `${(top[1] / S.ticks).toFixed(1)} ms`]);
      rows.push(['units', this.game.entities.count('unit')]);
      prof.reset();
    }
    this.rowsEl.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    this.drawGraph();
  }

  drawGraph() {
    const g = this.graph, W = 120, H = 28;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    for (const f of [30, 60]) { const y = H - (f / 75) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    const step = W / 59;
    this.history.forEach((f, i) => {
      g.fillStyle = f >= 55 ? '#7fd07a' : f >= 30 ? '#e8c35a' : '#e8705a';
      const h = Math.min(H, (f / 75) * H);
      g.fillRect(i * step, H - h, Math.max(1, step - 0.5), h);
    });
  }
}
