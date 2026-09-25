import * as THREE from 'three';
import { BUILDING_DEFS } from './defs.js';

// Building placement flow (driven by the UI):
//   placement.begin(type, builders)  -> ghost follows the cursor
//   placement.hover(worldX, worldZ)  -> snap + validity tint
//   placement.confirm()              -> pay, spawn foundation, order builders
//   placement.cancel()
export class Placement {
  constructor(game, buildings) {
    this.game = game;
    this.buildings = buildings;
    this.active = null;
    this.ghost = null;
    this.okMat = new THREE.MeshBasicMaterial({ color: 0x7dff9a, transparent: true, opacity: 0.45, depthWrite: false });
    this.badMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.45, depthWrite: false });
  }
  begin(type, builders) {
    this.cancel();
    const def = BUILDING_DEFS[type];
    this.active = { type, def, builders: builders.slice(), tx: 0, tz: 0, ok: false };
    this.ghost = new THREE.Mesh(this.buildings.geometry(type), this.okMat);
    this.ghost.renderOrder = 30;
    this.game.scene.add(this.ghost);
  }
  hover(x, z) {
    const a = this.active;
    if (!a) return;
    a.tx = Math.round(x - a.def.w / 2);
    a.tz = Math.round(z - a.def.h / 2);
    const player = this.game.players[this.game.localPlayer];
    a.ok = this.buildings.canPlace(a.type, a.tx, a.tz) && player.canAfford(a.def.cost) && this.game.fog.isExplored(a.tx, a.tz);
  }
  confirm() {
    const a = this.active;
    if (!a || !a.ok) return false;
    const game = this.game;
    const player = game.players[game.localPlayer];
    if (!player.pay(a.def.cost)) return false;
    const b = this.buildings.spawn(a.type, game.localPlayer, a.tx, a.tz, { built: false });
    for (const u of a.builders) {
      // remember what the builder was doing, so it goes back to it afterwards
      const prev = u.order?.type === 'build' ? u.order.resume : u.order;
      game.commands.order(u, { type: 'build', targetId: b.id });
      if (u.order.type === 'build' && prev && (prev.type === 'gather' || prev.type === 'worship'))
        u.order.resume = { type: prev.type, targetId: prev.targetId, resType: u.econ?.resType };
    }
    this.cancel();
    return b;
  }
  cancel() {
    if (this.ghost) this.game.scene.remove(this.ghost);
    this.ghost = null;
    this.active = null;
  }
  render() {
    const a = this.active;
    if (!a || !this.ghost) return;
    const x = a.tx + a.def.w / 2, z = a.tz + a.def.h / 2;
    this.ghost.position.set(x, this.game.map.heightAt(x, z) + 0.02, z);
    this.ghost.material = a.ok ? this.okMat : this.badMat;
  }
}
