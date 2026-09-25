// Mouse & keyboard control: box select, click select, double-click select
// same type, right-click smart orders, control groups, building placement
// and god power targeting modes.
export class SelectionController {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    game.selection = new Set();
    game.hoverId = null;
    this.groups = {};
    this.lastGroupTap = { key: null, t: 0 };
    this.box = document.createElement('div');
    this.box.className = 'selbox';
    document.body.appendChild(this.box);
    this.drag = null;
    this.mode = null; // null | { kind: 'power', id }
    this.lastClick = { t: 0, id: null };
    const dom = game.renderer.domElement;
    dom.addEventListener('mousedown', (e) => this.onDown(e));
    addEventListener('mousemove', (e) => this.onMove(e));
    addEventListener('mouseup', (e) => this.onUp(e));
    addEventListener('keydown', (e) => this.onKey(e));
  }

  get selected() {
    const out = [];
    for (const id of this.game.selection) {
      const e = this.game.entities.get(id);
      if (e && !e.dead) out.push(e);
    }
    return out;
  }
  ownUnits() { return this.selected.filter((e) => e.kind === 'unit' && e.owner === this.game.localPlayer); }

  set(ids) {
    const game = this.game;
    game.selection = new Set(ids);
    game.events.emit('selection:changed', [...game.selection]);
  }

  // ---- picking --------------------------------------------------------
  pickEntity(cx, cy) {
    const game = this.game;
    let best = null, bd = Infinity;
    for (const u of game.entities.units()) {
      if (u.dead || (u.owner !== game.localPlayer && !game.fog.isVisible(u.x, u.z))) continue;
      const y = game.map.heightAt(u.x, u.z);
      const top = game.worldToScreen(u.x, y + game.units.heightOf(u), u.z);
      const bot = game.worldToScreen(u.x, y, u.z);
      const hpx = Math.abs(bot.y - top.y);
      const mx = (top.x + bot.x) / 2, my = (top.y + bot.y) / 2;
      const dx = cx - mx, dy = cy - my;
      if (Math.abs(dx) < Math.max(10, hpx * 0.45) && Math.abs(dy) < Math.max(12, hpx * 0.65)) {
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = u; }
      }
    }
    if (best) return best;
    const g = game.pickGround(cx, cy);
    if (!g) return null;
    for (const b of game.entities.buildings()) {
      if (b.owner !== game.localPlayer && !game.fog.isExplored(b.x, b.z)) continue;
      if (g.x >= b.tx - 0.3 && g.x <= b.tx + b.w + 0.3 && g.z >= b.tz - 0.3 && g.z <= b.tz + b.h + 0.3) return b;
    }
    // resources: check projected canopy centre for trees, footprint for others
    bd = Infinity;
    for (const r of game.entities.resources()) {
      if (!game.fog.isExplored(r.x, r.z)) continue;
      if (r.type === 'tree') {
        if (Math.abs(r.x - g.x) > 7 || Math.abs(r.z - g.z) > 7) continue;
        const s = game.worldToScreen(r.x, game.map.heightAt(r.x, r.z) + 2.5, r.z);
        const d = (s.x - cx) ** 2 + (s.y - cy) ** 2;
        if (d < 900 && d < bd) { bd = d; best = r; }
      } else if (g.x >= r.tx - 0.2 && g.x <= r.tx + r.w + 0.2 && g.z >= r.tz - 0.2 && g.z <= r.tz + r.h + 0.2) return r;
    }
    return best;
  }

  // ---- mouse ----------------------------------------------------------
  onDown(e) {
    const game = this.game;
    if (e.button === 0) {
      if (game.buildings.placement.active) {
        const b = game.buildings.placement.confirm();
        if (!b) this.ui.message('Cannot place building here');
        else if (e.shiftKey) {
          const t = b.type; const builders = this.ownUnits().filter((u) => u.def.builder);
          game.buildings.placement.begin(t, builders);
        }
        return;
      }
      if (this.mode?.kind === 'power') {
        const g = game.pickGround(e.clientX, e.clientY);
        if (g) {
          const ok = game.godpowers.cast(game.localPlayer, this.mode.id, g.x, g.z);
          if (!ok) this.ui.message(game.godpowers.canCast(game.localPlayer, this.mode.id).reason);
        }
        this.setMode(null);
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey, active: false };
    } else if (e.button === 2) {
      if (game.buildings.placement.active) { game.buildings.placement.cancel(); return; }
      if (this.mode) { this.setMode(null); return; }
      const g = game.pickGround(e.clientX, e.clientY);
      const target = this.pickEntity(e.clientX, e.clientY);
      if (g) this.orderAt(g.x, g.z, target);
    }
  }

  orderAt(x, z, target) {
    const game = this.game;
    const units = this.ownUnits();
    if (units.length) {
      game.commands.smart(units, x, z, target);
      this.ui.marker(x, z, target && game.isEnemy(game.localPlayer, target.owner) ? 0xff4030 : 0x7dff7a);
      return;
    }
    // rally point for selected own buildings
    const bs = this.selected.filter((b) => b.kind === 'building' && b.owner === game.localPlayer && b.def.trains);
    for (const b of bs) b.rally = { x, z, targetId: target?.id };
    if (bs.length) this.ui.marker(x, z, 0xffd84a);
  }

  onMove(e) {
    const game = this.game;
    if (game.buildings.placement.active) {
      const g = game.pickGround(e.clientX, e.clientY);
      if (g) game.buildings.placement.hover(g.x, g.z);
    }
    if (this.drag) {
      const d = this.drag;
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) d.active = true;
      if (d.active) {
        const x0 = Math.min(d.x, e.clientX), y0 = Math.min(d.y, e.clientY);
        Object.assign(this.box.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${Math.abs(e.clientX - d.x)}px`, height: `${Math.abs(e.clientY - d.y)}px` });
      }
    }
    if (e.target === game.renderer.domElement) {
      this._hoverPending = [e.clientX, e.clientY];
    } else game.hoverId = null;
  }

  onUp(e) {
    if (e.button !== 0 || !this.drag) return;
    const game = this.game;
    const d = this.drag;
    this.drag = null;
    this.box.style.display = 'none';
    if (d.active) {
      const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX);
      const y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
      const ids = [];
      for (const u of game.entities.units()) {
        if (u.dead || u.owner !== game.localPlayer) continue;
        const s = game.worldToScreen(u.x, game.map.heightAt(u.x, u.z) + 0.8, u.z);
        if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(u.id);
      }
      // prefer military if the box contains both
      const mil = ids.filter((id) => !game.entities.get(id).def.gatherer);
      const pick = mil.length && mil.length < ids.length && !d.shift ? mil : ids;
      if (d.shift) this.set([...game.selection, ...pick]);
      else if (pick.length) this.set(pick);
      return;
    }
    const t = this.pickEntity(e.clientX, e.clientY);
    const now = performance.now();
    if (t && this.lastClick.id === t.id && now - this.lastClick.t < 350 && t.kind === 'unit') {
      // double click: all of this type on screen
      const ids = [];
      for (const u of game.entities.units()) {
        if (u.dead || u.owner !== t.owner || u.type !== t.type) continue;
        const s = game.worldToScreen(u.x, game.map.heightAt(u.x, u.z), u.z);
        if (s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight) ids.push(u.id);
      }
      this.set(ids);
    } else if (t) {
      if (d.shift && t.owner === game.localPlayer) {
        const s = new Set(game.selection);
        s.has(t.id) ? s.delete(t.id) : s.add(t.id);
        this.set([...s]);
      } else this.set([t.id]);
    } else if (!d.shift) this.set([]);
    this.lastClick = { t: now, id: t?.id ?? null };
  }

  setMode(m) {
    this.mode = m;
    this.game.renderer.domElement.classList.toggle('cursor-target', !!m);
    this.ui.refreshPowers();
  }

  // ---- keyboard -------------------------------------------------------
  onKey(e) {
    const game = this.game;
    if (e.target?.tagName === 'INPUT') return;
    if (e.code === 'Escape') { game.buildings.placement.cancel(); this.setMode(null); return; }
    const digit = /^Digit([0-9])$/.exec(e.code);
    if (digit) {
      const k = digit[1];
      if (e.ctrlKey || e.metaKey) { this.groups[k] = [...game.selection]; this.ui.message(`Group ${k} assigned`); e.preventDefault(); return; }
      const ids = (this.groups[k] || []).filter((id) => { const x = game.entities.get(id); return x && !x.dead; });
      if (!ids.length) return;
      if (e.shiftKey) this.set([...game.selection, ...ids]); else this.set(ids);
      const now = performance.now();
      if (this.lastGroupTap.key === k && now - this.lastGroupTap.t < 400) this.centerOn(ids);
      this.lastGroupTap = { key: k, t: now };
      return;
    }
    if (e.code === 'KeyH') { this.gotoTownCenter(); return; }
    if (e.code === 'Period') { this.cycleIdle(); return; }
    if (e.code === 'Delete') return;
    // command hotkeys
    if (!e.ctrlKey && !e.metaKey) this.ui.panel.hotkey(e.key.toUpperCase());
  }

  gotoTownCenter() {
    const game = this.game;
    const tc = [...game.entities.buildings()].find((b) => b.owner === game.localPlayer && b.type === 'town_center');
    if (tc) { this.set([tc.id]); game.cameraCtl.lookAt(tc.x, tc.z); }
  }

  cycleIdle() {
    const game = this.game;
    const idle = [...game.entities.units()].filter((u) => u.owner === game.localPlayer && u.def.gatherer && !u.dead && u.order?.type === 'idle');
    if (!idle.length) { this.ui.message('No idle villagers'); return; }
    const i = (this._idleIdx = ((this._idleIdx ?? -1) + 1) % idle.length);
    this.set([idle[i].id]);
    game.cameraCtl.lookAt(idle[i].x, idle[i].z);
  }

  centerOn(ids) {
    let x = 0, z = 0, n = 0;
    for (const id of ids) { const e = this.game.entities.get(id); if (e) { x += e.x; z += e.z; n++; } }
    if (n) this.game.cameraCtl.lookAt(x / n, z / n);
  }

  render() {
    const game = this.game;
    if (this._hoverPending) {
      const [x, y] = this._hoverPending;
      this._hoverPending = null;
      game.hoverId = this.pickEntity(x, y)?.id ?? null;
    }
    // drop dead entities from the selection
    let changed = false;
    for (const id of game.selection) {
      const e = game.entities.get(id);
      if (!e || e.dead) { game.selection.delete(id); changed = true; }
    }
    if (changed) game.events.emit('selection:changed', [...game.selection]);
  }
}
