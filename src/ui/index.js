import * as THREE from 'three';
import { ICONS } from './icons.js';
import { SelectionController } from './Selection.js';
import { Minimap } from './Minimap.js';
import { CommandPanel } from './CommandPanel.js';
import { renderPortrait } from '../core/portrait.js';
import { voxelMaterialFor } from '../core/voxel.js';
import { AGES } from '../core/constants.js';

// UI piece: DOM/CSS HUD overlay (resource bar, god powers, portrait, command
// grid, minimap), selection & orders, messages, move markers.
// Query param ?hud=0|1 toggles the overlay (scenes choose a default).
export class UI {
  constructor(game) {
    this.game = game;
    const root = document.createElement('div');
    root.className = 'hud';
    const resCell = (k, icon) => `<div class="res ${k}"><span class="n">0</span>${icon}<span class="v">0</span></div>`;
    root.innerHTML = `
      <div class="topbar">
        <div class="resrow">
          ${resCell('food', ICONS.food)}${resCell('wood', ICONS.wood)}${resCell('gold', ICONS.gold)}${resCell('favor', ICONS.favor)}
          <div class="res pop">${ICONS.house}<span class="v">0/0</span></div>
        </div>
        <div class="agehub">
          <div class="wing l">${ICONS.wing}</div><div class="wing r">${ICONS.wing}</div>
          <div class="plate l powers-l"></div>
          <div class="medal"><div class="ring"></div><b>I</b></div>
          <div class="plate r powers-r"></div>
        </div>
      </div>
      <div class="topright">
        <div class="clock"><b>00:00</b> <span>(Archaic Age)</span></div>
        <div class="scores"></div>
      </div>
      <div class="sidebtns">
        <div class="sbtn idle" data-tip="<b>Idle Villager</b><br>Select the next idle villager (.)">${ICONS.villager}<span class="badge" style="display:none">0</span></div>
      </div>
      <div class="bl">
        <div class="gild commands"></div>
        <div class="gild info"></div>
      </div>
      <div class="mm">
        <div class="tray"></div>
        <div class="trayrim"><svg viewBox="0 0 330 132" preserveAspectRatio="none"><path d="M1 132V92.4L46.2 29 105.6 1h118.8l59.4 28L329 92.4V132" fill="none" stroke="#0b0806" stroke-width="5"/><path d="M1 132V92.4L46.2 29 105.6 1h118.8l59.4 28L329 92.4V132" fill="none" stroke="#9a7640" stroke-width="2"/></svg></div>
        <div class="dia"><i class="inner"></i><i class="gem c0"></i><i class="gem c1"></i><i class="gem c2"></i><i class="gem c3"></i></div>
        <div class="btns">
          <div class="sbtn home" data-tip="<b>Town Center</b><br>Select and centre on your Town Center (H)">${ICONS.house}</div>
          <div class="sbtn flare" data-tip="<b>Signal</b><br>Right-click the minimap to send selected units there">${ICONS.flare}</div>
        </div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.els = {
      food: root.querySelector('.res.food .v'), wood: root.querySelector('.res.wood .v'),
      gold: root.querySelector('.res.gold .v'), favor: root.querySelector('.res.favor .v'),
      nfood: root.querySelector('.res.food .n'), nwood: root.querySelector('.res.wood .n'),
      ngold: root.querySelector('.res.gold .n'), nfavor: root.querySelector('.res.favor .n'),
      pop: root.querySelector('.res.pop .v'), popBox: root.querySelector('.res.pop'),
      medal: root.querySelector('.medal'), medalTxt: root.querySelector('.medal b'), medalRing: root.querySelector('.medal .ring'),
      clock: root.querySelector('.clock b'), clockAge: root.querySelector('.clock span'), scores: root.querySelector('.scores'),
      powersL: root.querySelector('.powers-l'), powersR: root.querySelector('.powers-r'),
      idle: root.querySelector('.sbtn.idle'), idleBadge: root.querySelector('.sbtn.idle .badge'),
    };
    this.statTimer = 0;
    this.tip = document.createElement('div');
    this.tip.className = 'tooltip';
    document.body.appendChild(this.tip);
    this.msg = document.createElement('div');
    this.msg.className = 'message';
    document.body.appendChild(this.msg);
    this.msgT = 0;

    this.selection = new SelectionController(game, this);
    this.minimap = new Minimap(game, root.querySelector('.mm .dia'));
    this.panel = new CommandPanel(game, this, root.querySelector('.info'), root.querySelector('.commands'));
    this.buildPowers();
    // stop clicks on the HUD from reaching the world
    for (const el of root.querySelectorAll('.topbar, .topright, .sidebtns, .bl, .mm')) el.addEventListener('mousedown', (e) => e.stopPropagation());
    for (const el of root.querySelectorAll('[data-tip]')) {
      el.addEventListener('mouseenter', (e) => this.tooltip(e, el.dataset.tip));
      el.addEventListener('mouseleave', () => this.tooltip(null));
    }
    this.els.idle.addEventListener('click', () => this.selection.cycleIdle());
    root.querySelector('.sbtn.home').addEventListener('click', () => this.selection.gotoTownCenter());
    root.querySelector('.sbtn.flare').addEventListener('click', () => this.message('Right-click the minimap to send units'));
    this.els.medal.addEventListener('mouseenter', (e) => {
      const p = game.players[game.localPlayer];
      this.tooltip(e, `<b>${AGES[p.age]} Age</b><br>Worshipping ${p.god}${AGES[p.age + 1] ? `<br>Advance at the Town Center (A)` : ''}`);
    });
    this.els.medal.addEventListener('mouseleave', () => this.tooltip(null));
    this.markers = [];
    this.markerGeo = new THREE.RingGeometry(0.5, 0.7, 24).rotateX(-Math.PI / 2);
    this.lastText = {};
    this.setVisible(true);
  }

  setVisible(v) { this.visible = v; this.root.classList.toggle('hidden', !v); }

  buildPowers() {
    const game = this.game;
    this.els.powersL.innerHTML = this.els.powersR.innerHTML = '';
    this.powerEls = {};
    const entries = Object.entries(game.godpowers.powers);
    const slots = Math.max(4, entries.length + (entries.length % 2));
    entries.forEach(([id, def], i) => {
      const d = document.createElement('div');
      d.className = 'power';
      d.innerHTML = `${ICONS[def.icon] || (id === 'lightning_storm' ? ICONS.storm : id === 'meteor' ? ICONS.meteor : ICONS.bolt)}<div class="cd"></div>`;
      d.addEventListener('click', () => {
        const r = game.godpowers.canCast(game.localPlayer, id);
        if (!r.ok) { this.message(r.reason); return; }
        this.selection.setMode({ kind: 'power', id });
        this.message(`${def.name}: choose a target`);
      });
      d.addEventListener('mouseenter', (e) => this.tooltip(e, `<b>${def.name}</b> (${def.god})<br>${def.desc}<br>Cost: ${def.cost.favor} favor`));
      d.addEventListener('mouseleave', () => this.tooltip(null));
      (i < slots / 2 ? this.els.powersL : this.els.powersR).appendChild(d);
      this.powerEls[id] = d;
    });
    for (let i = entries.length; i < slots; i++) {
      const d = document.createElement('div');
      d.className = 'power empty';
      (i < slots / 2 ? this.els.powersL : this.els.powersR).appendChild(d);
    }
  }

  refreshPowers() {
    const game = this.game, me = game.localPlayer;
    for (const [id, d] of Object.entries(this.powerEls)) {
      const def = game.godpowers.powers[id];
      d.classList.toggle('disabled', !game.godpowers.canCast(me, id).ok);
      d.classList.toggle('active', this.selection.mode?.id === id);
      const cd = game.godpowers.cooldownLeft(me, id);
      d.querySelector('.cd').style.setProperty('--p', `${(cd / def.cooldown) * 100}%`);
    }
  }

  // Portraits are rendered lazily with the main renderer and cached.
  portrait(key, make) { return renderPortrait(this.game.renderer, key, make, 128); }
  buildingObject(type, owner) {
    return new THREE.Mesh(this.game.buildings.geometry(type), voxelMaterialFor(this.game.players[owner].color, { fog: false }));
  }

  message(text) {
    if (!text) return;
    this.msg.textContent = text;
    this.msg.style.opacity = 1;
    this.msgT = 2.2;
  }

  tooltip(e, html) {
    if (!e) { this.tip.style.display = 'none'; return; }
    this.tip.innerHTML = html;
    this.tip.style.display = 'block';
    const r = e.currentTarget.getBoundingClientRect();
    this.tip.style.left = `${Math.min(innerWidth - 290, r.left)}px`;
    const above = r.top - this.tip.offsetHeight - 8;
    this.tip.style.top = `${above < 4 ? r.bottom + 8 : above}px`;
  }

  marker(x, z, color) {
    const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.set(x, this.game.map.heightAt(x, z) + 0.08, z);
    m.userData.t = 0;
    m.userData.noAO = true;
    this.game.scene.add(m);
    this.markers.push(m);
  }

  // Villager counts per resource, idle villagers, and the score list.
  refreshStats() {
    const game = this.game, me = game.localPlayer;
    const n = { food: 0, wood: 0, gold: 0, favor: 0 };
    let idle = 0;
    const score = {};
    for (const u of game.entities.units()) {
      if (u.dead) continue;
      score[u.owner] = (score[u.owner] || 0) + (u.def.pop || 1) * 10;
      if (u.owner !== me) continue;
      const ot = u.order?.type;
      if ((ot === 'gather' || ot === 'dropoff') && u.econ?.resType in n) n[u.econ.resType]++;
      else if (ot === 'worship') n.favor++;
      else if (u.def.gatherer && ot === 'idle') idle++;
    }
    for (const b of game.entities.buildings()) if (b.built && !b.dead) score[b.owner] = (score[b.owner] || 0) + 25;
    for (const k in n) this.setText(`n${k}`, this.els[`n${k}`], n[k]);
    this.setText('idle', this.els.idleBadge, idle);
    this.els.idleBadge.style.display = idle ? '' : 'none';
    const rows = Object.values(game.players).filter((pl) => pl && pl.id !== 0).map((pl) => {
      const col = '#' + pl.color.toString(16).padStart(6, '0');
      return `<div><span>${pl.id === me ? 'You' : pl.name} <em style="color:var(--muted);font-style:normal;font-weight:500">(${pl.god})</em></span><i style="background:${col}">${pl.id}</i><span class="s">${(score[pl.id] || 0) + pl.age * 100}</span></div>`;
    }).join('');
    if (this.lastText.scores !== rows) { this.lastText.scores = rows; this.els.scores.innerHTML = rows; }
    const p = game.players[me];
    this.setText('ageName', this.els.clockAge, `(${AGES[p.age]} Age)`);
  }

  setText(key, el, text) {
    if (this.lastText[key] !== text) { this.lastText[key] = text; el.textContent = text; }
  }

  render(dt) {
    const game = this.game;
    this.selection.render();
    // markers animate even when hidden
    this.markers = this.markers.filter((m) => {
      m.userData.t += dt;
      const t = m.userData.t;
      m.scale.setScalar(1 + t * 1.5);
      m.material.opacity = Math.max(0, 1 - t / 0.6);
      if (t > 0.6) { game.scene.remove(m); m.material.dispose(); return false; }
      return true;
    });
    if (!this.visible) return;
    const p = game.players[game.localPlayer];
    this.setText('food', this.els.food, Math.floor(p.res.food));
    this.setText('wood', this.els.wood, Math.floor(p.res.wood));
    this.setText('gold', this.els.gold, Math.floor(p.res.gold));
    this.setText('favor', this.els.favor, Math.floor(p.res.favor));
    this.setText('pop', this.els.pop, `${p.pop}/${p.popCap}`);
    this.els.popBox.classList.toggle('warn', p.pop >= p.popCap);
    const roman = ['I', 'II', 'III', 'IV'][p.age] || String(p.age + 1);
    this.setText('medal', this.els.medalTxt, roman);
    const adv = p.advancing ? `${(p.advancing.t / p.advancing.total) * 100}%` : '0%';
    if (this.lastText.adv !== adv) { this.lastText.adv = adv; this.els.medalRing.style.setProperty('--p', adv); }
    const s = Math.floor(game.time);
    this.setText('clock', this.els.clock, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    this.statTimer -= dt;
    if (this.statTimer <= 0) { this.statTimer = 0.5; this.refreshStats(); }
    this.refreshPowers();
    this.panel.render(dt);
    this.minimap.render(dt);
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.style.opacity = 0; }
  }
}
