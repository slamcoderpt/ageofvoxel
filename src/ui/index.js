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
    const ring = (cls, icon, tip) => `<div class="rbtn ${cls}" data-tip="${tip}">${icon}<span class="badge" style="display:none">0</span></div>`;
    root.innerHTML = `
      <div class="groups"></div>
      <div class="feed"></div>
      <div class="topbar">
        <div class="resrow">
          ${resCell('food', ICONS.food)}${resCell('wood', ICONS.wood)}${resCell('gold', ICONS.gold)}${resCell('favor', ICONS.favor)}
          <div class="res pop">${ICONS.house}<span class="v">0/0</span></div>
        </div>
        <div class="agehub">
          <div class="plate l powers-l"></div>
          <div class="medal"><div class="ring"></div><div class="face"><b>I</b></div></div>
          <div class="plate r powers-r"></div>
        </div>
      </div>
      <div class="topright">
        <div class="menubar">
          <div class="mbtn speed" data-tip="<b>Game Speed</b><br>Toggle normal / fast">${ICONS.fast}</div>
          <div class="mbtn pause" data-tip="<b>Pause</b><br>Pause or resume the game">${ICONS.pause}</div>
          <div class="mbtn obj" data-tip="<b>Objectives</b><br>Destroy the enemy Town Center">${ICONS.scroll}</div>
          <div class="mbtn menu" data-tip="<b>Hotkeys</b><br>. idle villager &middot; H Town Center<br>Ctrl+1..9 assign group &middot; 1..9 recall<br>Q/E/F/S/R/B build &middot; X stop">${ICONS.gear}</div>
        </div>
        <div class="clock"><b>00:00</b> <span>(Archaic Age)</span></div>
        <div class="scores"></div>
      </div>
      <div class="bl">
        <div class="gild commands"></div>
        <div class="gild info"></div>
      </div>
      <div class="mm">
        <div class="tray"></div>
        <div class="trayrim"><svg viewBox="0 0 364 150" preserveAspectRatio="none"><path d="M1 150V26L27 1h310l26 25v124" fill="none" stroke="#050d10" stroke-width="5"/><path d="M1 150V26L27 1h310l26 25v124" fill="none" stroke="#b08a4c" stroke-width="2"/><path d="M7 150V29L30 7h304l23 22v121" fill="none" stroke="#5b4422" stroke-width="1"/></svg></div>
        <div class="dia"><i class="inner"></i><i class="gem c0"></i><i class="gem c1"></i><i class="gem c2"></i><i class="gem c3"></i></div>
        ${ring('b0 idle', ICONS.villager, '<b>Idle Villager</b><br>Select the next idle villager (.)')}
        ${ring('b1 army', ICONS.military, '<b>Idle Military</b><br>Select all idle soldiers')}
        ${ring('b2 home', ICONS.house, '<b>Town Center</b><br>Select and centre on your Town Center (H)')}
        ${ring('b3 flare', ICONS.flare, '<b>Signal</b><br>Right-click the minimap to send selected units there')}
        ${ring('b4 terrain', ICONS.terrain, '<b>Terrain</b><br>Show or hide terrain on the minimap')}
        ${ring('b5 score', ICONS.laurel, '<b>Scores</b><br>Show or hide the score list')}
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
      idle: root.querySelector('.rbtn.idle'), idleBadge: root.querySelector('.rbtn.idle .badge'),
      army: root.querySelector('.rbtn.army'), armyBadge: root.querySelector('.rbtn.army .badge'),
      groups: root.querySelector('.groups'), feed: root.querySelector('.feed'),
      pause: root.querySelector('.mbtn.pause'), speed: root.querySelector('.mbtn.speed'),
    };
    this.feedItems = [];
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
    for (const el of root.querySelectorAll('.topbar, .topright, .groups, .bl, .mm')) el.addEventListener('mousedown', (e) => e.stopPropagation());
    for (const el of root.querySelectorAll('[data-tip]')) {
      el.addEventListener('mouseenter', (e) => this.tooltip(e, el.dataset.tip));
      el.addEventListener('mouseleave', () => this.tooltip(null));
    }
    this.els.idle.addEventListener('click', () => this.selection.cycleIdle());
    this.els.army.addEventListener('click', () => this.selectIdleArmy());
    root.querySelector('.rbtn.home').addEventListener('click', () => this.selection.gotoTownCenter());
    root.querySelector('.mbtn.obj').addEventListener('click', () => this.message('Objective: destroy the enemy Town Center'));
    // the hotkey card stays open on click until clicked again
    root.querySelector('.mbtn.menu').addEventListener('click', (e) => {
      const el = e.currentTarget;
      this.tipPinned = this.tipPinned === el ? null : el;
      el.classList.toggle('on', this.tipPinned === el);
      if (this.tipPinned) this.tooltip({ currentTarget: el }, el.dataset.tip, true); else this.tooltip(null, null, true);
    });
    root.querySelector('.rbtn.flare').addEventListener('click', () => this.message('Right-click the minimap to send units'));
    root.querySelector('.rbtn.terrain').addEventListener('click', (e) => { this.minimap.showTerrain = !this.minimap.showTerrain; this.minimap.timer = 0; e.currentTarget.classList.toggle('off', !this.minimap.showTerrain); });
    root.querySelector('.rbtn.score').addEventListener('click', (e) => { const off = this.els.scores.classList.toggle('hidden'); e.currentTarget.classList.toggle('off', off); });
    this.els.pause.addEventListener('click', () => {
      if (game.victory?.result) return;
      game.paused = !game.paused;
      this.els.pause.innerHTML = game.paused ? ICONS.play : ICONS.pause;
      this.message(game.paused ? 'Game paused' : 'Game resumed');
    });
    this.els.speed.addEventListener('click', () => {
      game.timeScale = game.timeScale > 1 ? 1 : 1.5;
      this.els.speed.classList.toggle('on', game.timeScale > 1);
      this.message(game.timeScale > 1 ? 'Fast speed' : 'Normal speed');
    });
    // event feed (top-left), like Retold's "Dojo built." notices
    // (not for the starting Town Center spawned before the clock runs)
    const mine = (e) => e && e.owner === game.localPlayer && game.time > 0;
    game.events.on('building:completed', (b) => { if (mine(b)) this.feed(`${b.def.name} built.`); });
    game.events.on('unit:trained', (u) => { if (mine(u)) this.feed(`${u.def.name} trained.`); });
    game.events.on('age:advanced', (a) => { if (a.owner === game.localPlayer) this.feed(`You reached the ${AGES[a.age]} Age!`, 'gold'); });
    game.events.on('godpower:cast', (g) => { if (g.owner === game.localPlayer) this.feed(`You use the ${game.godpowers.powers[g.power]?.name || 'god'} God Power!`, 'gold'); });
    game.events.on('game:over', (r) => this.showResult(r));
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

  // Victory / defeat card over the frozen battlefield, with a restart button
  // (reloads the page, so the match restarts with the same URL settings).
  showResult({ winner, time }) {
    if (this.resultEl) return;
    const game = this.game, me = game.localPlayer, won = winner === me;
    const p = game.players[me];
    const s = Math.floor(time);
    const clock = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    this.tooltip(null);
    game.buildings.placement.cancel();
    this.selection.setMode(null);
    const el = document.createElement('div');
    el.className = `gameover ${won ? 'victory' : 'defeat'}`;
    el.innerHTML = `<div class="gild card">
        <div class="kicker">${p.god} &middot; ${AGES[p.age]} Age &middot; ${clock}</div>
        <h1>${won ? 'Victory' : 'Defeat'}</h1>
        <p>${won ? 'The enemy Town Center has fallen.' : 'Your last Town Center has fallen.'}</p>
        <div class="btn restart">Play Again</div>
      </div>`;
    el.querySelector('.restart').addEventListener('click', () => location.reload());
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    document.body.appendChild(el);
    this.resultEl = el;
    this.els.pause.innerHTML = ICONS.play;
  }

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

  feed(text, cls = '') {
    const d = document.createElement('div');
    d.className = `note ${cls}`;
    d.textContent = text;
    this.els.feed.appendChild(d);
    this.feedItems.push({ el: d, t: this.game.time });
    while (this.feedItems.length > 4) this.feedItems.shift().el.remove();
  }

  selectIdleArmy() {
    const game = this.game;
    const ids = [...game.entities.units()].filter((u) => u.owner === game.localPlayer && !u.dead && !u.def.gatherer && u.def.attack && (!u.order || u.order.type === 'idle')).map((u) => u.id);
    if (!ids.length) { this.message('No idle military'); return; }
    this.selection.set(ids);
    this.selection.centerOn(ids);
  }

  // Control-group cards (top-left): portrait of the group's most common type, count, key.
  refreshGroups() {
    const game = this.game, groups = this.selection.groups;
    let html = '';
    const keys = [];
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      const es = (groups[k] || []).map((id) => game.entities.get(id)).filter((e) => e && !e.dead);
      if (!es.length) continue;
      const tally = {};
      for (const e of es) tally[e.kind + ':' + e.type] = (tally[e.kind + ':' + e.type] || 0) + 1;
      const [kind, type] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0].split(':');
      const img = kind === 'unit' ? this.panel.portraitUnit(type, es[0].owner) : this.panel.portraitBuilding(type, es[0].owner);
      html += `<div class="grp" data-k="${k}"><img src="${img}"><span class="cnt">${es.length}</span><span class="key">${k}</span></div>`;
      keys.push(k);
    }
    if (this.lastText.groups === html) return;
    this.lastText.groups = html;
    this.els.groups.innerHTML = html;
    for (const d of this.els.groups.querySelectorAll('.grp')) {
      d.addEventListener('click', () => {
        const ids = (groups[d.dataset.k] || []).filter((id) => { const x = game.entities.get(id); return x && !x.dead; });
        if (ids.length) { this.selection.set(ids); this.selection.centerOn(ids); }
      });
    }
  }

  message(text) {
    if (!text) return;
    this.msg.textContent = text;
    this.msg.style.opacity = 1;
    this.msgT = 2.2;
  }

  tooltip(e, html, force = false) {
    if (this.tipPinned && !force) return;
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
    let army = 0;
    for (const u of game.entities.units()) if (u.owner === me && !u.dead && !u.def.gatherer && u.def.attack && (!u.order || u.order.type === 'idle')) army++;
    this.setText('army', this.els.armyBadge, army);
    this.els.armyBadge.style.display = army ? '' : 'none';
    this.refreshGroups();
    // feed notices fade after ~14 s of game time
    this.feedItems = this.feedItems.filter((f) => {
      const age = game.time - f.t;
      if (age > 14) { f.el.remove(); return false; }
      f.el.style.opacity = age > 11 ? String(Math.max(0, (14 - age) / 3)) : '';
      return true;
    });
    const rows = Object.values(game.players).filter((pl) => pl && pl.id !== 0).map((pl) => {
      const col = '#' + pl.color.toString(16).padStart(6, '0');
      return `<div><span>${pl.id === me ? 'You' : pl.name} <em>(${pl.god})</em>:</span><i style="background:${col}">${pl.id}</i><span class="ag">${['I', 'II', 'III', 'IV'][pl.age] || ''}</span><span class="s">${(score[pl.id] || 0) + pl.age * 100}</span></div>`;
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
