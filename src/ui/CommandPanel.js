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
            run: () => {
              game.buildings.placement.begin(t, units.filter((u) => u.def.builder));
              // show the ghost under the cursor straight away, not at the map corner
              const m = game.input.mouse;
              if (m.inside) this.ui.selection.hoverPlacement(m.x, m.y);
            },
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
      if (!c) { d.className = 'cmd empty'; this.cmdEl.appendChild(d); return; }
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
    const me = game.localPlayer;
    const god = game.players[me].god;
    const emblem = `<div class="emblem">${ICONS[god.toLowerCase()] || ICONS.zeus}</div>`;
    if (!sel.length) { el.innerHTML = `${emblem}<div class="none">${god} &middot; ${AGES[game.players[me].age]} Age</div>`; return; }
    const ownerTag = (owner) => {
      const pl = game.players[owner];
      const col = '#' + pl.color.toString(16).padStart(6, '0');
      return `<i style="background:${col}">${owner}</i>${owner === me ? 'You' : pl.name}`;
    };
    if (sel.length > 1) {
      const counts = {};
      for (const e of sel) counts[e.def?.name || e.type] = (counts[e.def?.name || e.type] || 0) + 1;
      const title = Object.keys(counts).length === 1 ? `${sel.length} ${Object.keys(counts)[0]}s` : `${sel.length} Selected`;
      el.innerHTML = `${emblem}<div class="ihead"><h2>${title}</h2></div><div class="owner">${ownerTag(sel[0].owner)}</div>`;
      const multi = document.createElement('div');
      multi.className = 'multi';
      for (const e of sel.slice(0, 24)) {
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
    const resIcon = e.type === 'gold' ? ICONS.gold : e.type === 'berry' ? ICONS.food : ICONS.wood;
    el.innerHTML = `${emblem}
      <div class="ihead"><h2>${e.def?.name || e.type}</h2></div>
      <div class="owner">${e.kind === 'resource' ? '<span class="cls">Gaia</span>' : ownerTag(e.owner)}${e.def?.class ? ` <span class="cls">&middot; ${e.def.class}</span>` : ''}</div>
      ${e.kind !== 'resource' ? `<div class="hpline">${ICONS.heart}<span class="hpv"></span><div class="hpbar"><div></div></div></div>` : ''}
      <div class="ibody">
        <div class="portrait">${img ? `<img src="${img}">` : `<div class="ico">${resIcon}</div>`}</div>
        <div class="details"><div class="stats"></div><div class="queue"></div></div>
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
    const hpv = this.infoEl.querySelector('.hpv');
    if (hpv) hpv.textContent = `${Math.ceil(e.hp)}/${e.maxHp}`;
    const st = this.infoEl.querySelector('.stats');
    if (st) {
      const I = (icon, v, label) => `<span>${ICONS[icon]}${v}${label ? ` <em>${label}</em>` : ''}</span>`;
      const parts = [];
      if (e.kind === 'resource') parts.push(I(e.resType === 'gold' ? 'gold' : e.resType === 'food' ? 'food' : 'wood', Math.ceil(e.amount), e.resType));
      if (e.kind === 'unit') {
        const d = e.def;
        if (d.attack) parts.push(I('sword', d.attack.damage, d.attack.projectile ? 'ranged' : 'hack'));
        parts.push(I('shield', `${Math.round((d.armor || 0) * 100)}%`, 'armor'));
        if (d.speed) parts.push(I('speed', d.speed.toFixed(1), 'speed'));
        if (d.sight) parts.push(I('eye', d.sight, 'LOS'));
        if (e.carry?.amount > 0) parts.push(I(e.carry.type in ICONS ? e.carry.type : 'bag', Math.floor(e.carry.amount), `/ ${d.carryCap || 10}`));
        if (e.order && e.order.type !== 'idle') parts.push(`<span class="task">${{ gather: 'Gathering', dropoff: 'Returning', build: 'Building', worship: 'Worshipping', attack: 'Attacking', move: 'Moving' }[e.order.type] || e.order.type}${e.econ?.resType && (e.order.type === 'gather' || e.order.type === 'dropoff') ? ` ${e.econ.resType}` : ''}</span>`);
        else if (e.order?.type === 'idle') parts.push('<span class="task">Idle</span>');
      }
      if (e.kind === 'building') {
        if (!e.built) parts.push(`<span class="task">Under construction &middot; ${Math.floor(e.progress * 100)}%</span>`);
        if (e.def.ageUp && p.advancing && e.owner === game.localPlayer) parts.push(`<span class="task">Advancing &middot; ${Math.floor((p.advancing.t / p.advancing.total) * 100)}%</span>`);
        if (e.def.dropoff) parts.push(`<span>${e.def.dropoff.map((k) => ICONS[k]).join('')} <em>drop-off</em></span>`);
        if (e.def.popCap || e.def.pop) parts.push(I('house', `+${e.def.popCap || e.def.pop}`, 'pop'));
      }
      const html = parts.join('');
      if (st._h !== html) { st._h = html; st.innerHTML = html; }
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
