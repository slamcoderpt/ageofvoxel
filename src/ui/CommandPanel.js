import { ICONS } from './icons.js';
import { AGES, RESOURCES } from '../core/constants.js';
import { BUILD_MENU } from '../buildings/defs.js';

// Bottom-centre info (portrait / stats / queue / multi-select) and the
// bottom-right command grid. Rebuilt on selection change and refreshed a few
// times per second.
export class CommandPanel {
  constructor(game, ui, infoEl, cmdEl) {
    this.game = game;
    this.ui = ui;
    this.infoEl = infoEl;
    this.cmdEl = cmdEl;
    this.buttons = [];
    this.sig = '';
    this.timer = 0;
    game.events.on('selection:changed', () => { this.sig = ''; });
  }

  portraitUnit(type, owner) { return this.ui.portrait(`u:${type}:${owner}`, () => this.game.units.portraitObject(type, owner)); }
  portraitBuilding(type, owner) { return this.ui.portrait(`b:${type}:${owner}`, () => this.ui.buildingObject(type, owner)); }

  costText(cost) {
    return RESOURCES.filter((k) => cost?.[k]).map((k) => `<span class="c">${ICONS[k].replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')} ${cost[k]}</span>`).join(' ');
  }

  commandsFor(sel) {
    const game = this.game, me = game.localPlayer, p = game.players[me];
    const cmds = [];
    if (!sel.length || sel[0].owner !== me) return cmds;
    const units = sel.filter((e) => e.kind === 'unit');
    if (units.length) {
      if (units.some((u) => u.def.builder)) {
        for (const t of BUILD_MENU) {
          const def = game.buildings.defs[t];
          cmds.push({
            key: def.hotkey, img: this.portraitBuilding(t, me), title: `Build ${def.name}`, cost: def.cost,
            enabled: p.canAfford(def.cost) && (def.minAge ?? 0) <= p.age,
            run: () => game.buildings.placement.begin(t, units.filter((u) => u.def.builder)),
          });
        }
      }
      cmds.push({ key: 'X', svg: ICONS.stop, title: 'Stop', run: () => game.commands.stop(units), enabled: true, slot: 14 });
      return cmds;
    }
    const b = sel[0];
    if (b.kind === 'building' && b.built) {
      for (const t of b.def.trains || []) {
        const def = game.units.defs[t];
        const ok = (def.minAge ?? 0) <= p.age;
        cmds.push({
          key: def.hotkey, img: this.portraitUnit(t, me), title: `Train ${def.name}${ok ? '' : ` (requires ${AGES[def.minAge]} Age)`}`, cost: def.cost,
          enabled: ok && p.canAfford(def.cost),
          run: () => { const r = game.economy.train(b, t); if (!r.ok) this.ui.message(r.reason); },
        });
      }
      if (b.def.ageUp && AGES[p.age + 1]) {
        const cost = game.economy.nextAgeCost(me);
        cmds.push({
          key: 'A', svg: ICONS.age, title: p.advancing ? `Advancing to the ${AGES[p.age + 1]} Age...` : `Advance to the ${AGES[p.age + 1]} Age`, cost,
          enabled: !p.advancing && p.canAfford(cost), slot: 4,
          run: () => { const r = game.economy.advanceAge(me); if (!r.ok) this.ui.message(r.reason); },
        });
      }
    }
    return cmds;
  }

  hotkey(k) {
    this.sync();
    const c = this.buttons.find((b) => b.key === k);
    if (c && c.enabled) c.run();
  }

  // Rebuild the grid if the selection (or age state) changed since last time.
  sync() {
    const game = this.game;
    const sel = this.ui.selection.selected;
    const p = game.players[game.localPlayer];
    const sig = sel.map((e) => e.id).join(',') + `|${p.age}|${!!p.advancing}`;
    if (sig !== this.sig) { this.sig = sig; this.rebuild(sel); this.timer = 0; }
    return sel;
  }

  render(dt) {
    this.timer -= dt;
    const sel = this.sync();
    if (this.timer <= 0) { this.timer = 0.2; this.refresh(sel); }
  }

  rebuild(sel) {
    const game = this.game;
    // --- command grid
    this.buttons = this.commandsFor(sel);
    const slots = new Array(15).fill(null);
    let i = 0;
    for (const c of this.buttons) {
      if (c.slot !== undefined && !slots[c.slot]) slots[c.slot] = c;
      else { while (slots[i]) i++; slots[i] = c; }
    }
    this.cmdEl.innerHTML = '';
    slots.forEach((c) => {
      const d = document.createElement('div');
      if (!c) { d.style.visibility = 'hidden'; d.className = 'cmd'; this.cmdEl.appendChild(d); return; }
      d.className = 'cmd';
      d.innerHTML = `${c.img ? `<img src="${c.img}">` : c.svg}<span class="hk">${c.key || ''}</span>`;
      d.addEventListener('click', () => { if (c.enabled) c.run(); else this.ui.message('Cannot do that yet'); });
      d.addEventListener('mouseenter', (e) => this.ui.tooltip(e, `<b>${c.title}</b>${c.cost ? `<br>${this.costText(c.cost)}` : ''}${c.key ? `<br><small>Hotkey: ${c.key}</small>` : ''}`));
      d.addEventListener('mouseleave', () => this.ui.tooltip(null));
      c.el = d;
      this.cmdEl.appendChild(d);
    });
    // --- info
    const el = this.infoEl;
    el.innerHTML = '';
    if (!sel.length) return;
    if (sel.length > 1) {
      const multi = document.createElement('div');
      multi.className = 'multi';
      multi.style.gridColumn = '1 / 3';
      for (const e of sel.slice(0, 40)) {
        const m = document.createElement('div');
        m.className = 'mi';
        m.innerHTML = `<img src="${e.kind === 'unit' ? this.portraitUnit(e.type, e.owner) : this.portraitBuilding(e.type, e.owner)}"><div class="hp"></div>`;
        m.addEventListener('click', () => this.ui.selection.set([e.id]));
        m.dataset.id = e.id;
        multi.appendChild(m);
      }
      el.appendChild(multi);
      return;
    }
    const e = sel[0];
    const img = e.kind === 'unit' ? this.portraitUnit(e.type, e.owner) : e.kind === 'building' ? this.portraitBuilding(e.type, e.owner) : null;
    el.innerHTML = `
      <div class="portrait">${img ? `<img src="${img}">` : `<div style="font-size:42px">${e.type === 'gold' ? ICONS.gold : e.type === 'berry' ? ICONS.food : ICONS.wood}</div>`}</div>
      <div class="details">
        <h2>${e.def?.name || e.type}</h2>
        <div class="sub">${e.kind === 'resource' ? 'Gaia' : game.players[e.owner].name}${e.def?.class ? ` &middot; ${e.def.class}` : ''}</div>
        ${e.kind !== 'resource' ? '<div class="hpbar"><div></div></div>' : ''}
        <div class="stats"></div>
        <div class="queue"></div>
      </div>`;
  }

  refresh(sel) {
    const game = this.game;
    const p = game.players[game.localPlayer];
    for (const c of this.buttons) {
      if (!c.el) continue;
      if (c.cost) c.enabled = p.canAfford(c.cost) && !c.title.includes('requires') && !(c.svg === ICONS.age && p.advancing);
      c.el.classList.toggle('disabled', !c.enabled);
    }
    if (sel.length > 1) {
      for (const m of this.infoEl.querySelectorAll('.mi')) {
        const e = game.entities.get(+m.dataset.id);
        if (e) m.querySelector('.hp').style.width = `${(e.hp / e.maxHp) * 90}%`;
      }
      return;
    }
    const e = sel[0];
    if (!e) return;
    const hp = this.infoEl.querySelector('.hpbar > div');
    if (hp) hp.style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
    const st = this.infoEl.querySelector('.stats');
    if (st) {
      const parts = [];
      if (e.kind !== 'resource') parts.push(`<span>HP <b>${Math.ceil(e.hp)}/${e.maxHp}</b></span>`);
      if (e.kind === 'resource') parts.push(`<span>${e.resType} <b>${Math.ceil(e.amount)}</b></span>`);
      if (e.kind === 'unit' && e.def.attack) parts.push(`<span>Attack <b>${e.def.attack.damage}</b></span>`, `<span>Armor <b>${Math.round((e.def.armor || 0) * 100)}%</b></span>`);
      if (e.kind === 'unit' && e.carry?.amount > 0) parts.push(`<span>Carrying <b>${Math.floor(e.carry.amount)} ${e.carry.type}</b></span>`);
      if (e.kind === 'building' && !e.built) parts.push(`<span>Building <b>${Math.floor(e.progress * 100)}%</b></span>`);
      if (e.kind === 'building' && e.def.ageUp && p.advancing && e.owner === game.localPlayer) parts.push(`<span>Advancing <b>${Math.floor((p.advancing.t / p.advancing.total) * 100)}%</b></span>`);
      if (e.kind === 'unit' && e.order) parts.push(`<span>${e.order.type}</span>`);
      st.innerHTML = parts.join('');
    }
    const q = this.infoEl.querySelector('.queue');
    if (q && e.kind === 'building') {
      const html = e.queue.map((it, i) => `<div class="qi" data-i="${i}"><img src="${this.portraitUnit(it.type, e.owner)}"><div class="bar" style="width:${i === 0 ? (it.t / it.total) * 100 : 0}%"></div></div>`).join('');
      if (q.innerHTML !== html) {
        q.innerHTML = html;
        q.querySelectorAll('.qi').forEach((d) => d.addEventListener('click', () => game.economy.cancelTrain(e, +d.dataset.i)));
      }
    }
  }
}
