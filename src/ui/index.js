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
    root.innerHTML = `
      <div class="topbar">
        <div class="res food">${ICONS.food}<span>0</span></div>
        <div class="res wood">${ICONS.wood}<span>0</span></div>
        <div class="res gold">${ICONS.gold}<span>0</span></div>
        <div class="res favor">${ICONS.favor}<span>0</span></div>
        <div class="res pop">${ICONS.pop}<span>0/0</span></div>
        <div class="powers"></div>
        <div class="spacer"></div>
        <div class="age">Archaic Age<small>Zeus</small></div>
        <div class="clock">00:00</div>
      </div>
      <div class="bottom">
        <div class="frame minimap-wrap"></div>
        <div class="frame info"></div>
        <div class="frame commands"></div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.els = {
      food: root.querySelector('.res.food span'), wood: root.querySelector('.res.wood span'),
      gold: root.querySelector('.res.gold span'), favor: root.querySelector('.res.favor span'),
      pop: root.querySelector('.res.pop span'), popBox: root.querySelector('.res.pop'),
      age: root.querySelector('.age'), clock: root.querySelector('.clock'), powers: root.querySelector('.powers'),
    };
    this.tip = document.createElement('div');
    this.tip.className = 'tooltip';
    document.body.appendChild(this.tip);
    this.msg = document.createElement('div');
    this.msg.className = 'message';
    document.body.appendChild(this.msg);
    this.msgT = 0;

    this.selection = new SelectionController(game, this);
    this.minimap = new Minimap(game, root.querySelector('.minimap-wrap'));
    this.panel = new CommandPanel(game, this, root.querySelector('.info'), root.querySelector('.commands'));
    this.buildPowers();
    // stop clicks on the HUD from reaching the world
    for (const el of root.querySelectorAll('.topbar, .bottom')) el.addEventListener('mousedown', (e) => e.stopPropagation());
    this.markers = [];
    this.markerGeo = new THREE.RingGeometry(0.5, 0.7, 24).rotateX(-Math.PI / 2);
    this.lastText = {};
    this.setVisible(true);
  }

  setVisible(v) { this.visible = v; this.root.classList.toggle('hidden', !v); }

  buildPowers() {
    const game = this.game;
    this.els.powers.innerHTML = '';
    this.powerEls = {};
    for (const [id, def] of Object.entries(game.godpowers.powers)) {
      const d = document.createElement('div');
      d.className = 'power';
      d.innerHTML = `${id === 'lightning_storm' ? ICONS.storm : ICONS.bolt}<div class="cd"></div>`;
      d.addEventListener('click', () => {
        const r = game.godpowers.canCast(game.localPlayer, id);
        if (!r.ok) { this.message(r.reason); return; }
        this.selection.setMode({ kind: 'power', id });
        this.message(`${def.name}: choose a target`);
      });
      d.addEventListener('mouseenter', (e) => this.tooltip(e, `<b>${def.name}</b> (${def.god})<br>${def.desc}<br>Cost: ${def.cost.favor} favor`));
      d.addEventListener('mouseleave', () => this.tooltip(null));
      this.els.powers.appendChild(d);
      this.powerEls[id] = d;
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
    this.tip.style.top = `${r.top - this.tip.offsetHeight - 8}px`;
  }

  marker(x, z, color) {
    const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.position.set(x, this.game.map.heightAt(x, z) + 0.08, z);
    m.userData.t = 0;
    m.userData.noAO = true;
    this.game.scene.add(m);
    this.markers.push(m);
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
    const ageTxt = `${AGES[p.age]} Age${p.advancing ? ` → ${Math.floor((p.advancing.t / p.advancing.total) * 100)}%` : ''}`;
    if (this.lastText.age !== ageTxt) { this.lastText.age = ageTxt; this.els.age.innerHTML = `${ageTxt}<small>${p.god}</small>`; }
    const s = Math.floor(game.time);
    this.setText('clock', this.els.clock, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    this.refreshPowers();
    this.panel.render(dt);
    this.minimap.render(dt);
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg.style.opacity = 0; }
  }
}
