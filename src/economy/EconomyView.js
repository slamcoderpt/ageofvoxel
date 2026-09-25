import { EconomyRenderer } from './EconomyRenderer.js';
import { SIM_DT } from '../core/constants.js';
import { hash2 } from '../core/rng.js';
import * as M from './models.js';
import { FARM_ROWS } from './constants.js';

const V = M.ECON_VOXEL;
const STOCK_KEYS = {
  wood: ['logs', 'logs', 'logs'],
  gold: ['goldpile', 'goldpile', 'crate_gold'],
  grain: ['sheaf', 'sack', 'crate_grain'],
  fruit: ['crate_apples', 'crate_grapes', 'amphora'],
  meat: ['sack', 'amphora', 'crate_apples'],
  fish: ['crate_fish', 'crate_fish', 'amphora'],
};
const STOCK_ORDER = ['grain', 'fruit', 'meat', 'fish', 'wood', 'gold'];

// Draws everything the economy owns: animals and carcasses, thrown spears,
// fish shoals and fishing boats, crops on farms (with a moving harvest
// front), stockpiles next to drop-off buildings, and scene field dressing.
export class EconomyView {
  constructor(game, econ) {
    this.game = game;
    this.econ = econ;
    const r = (this.r = new EconomyRenderer(game));
    const def = (key, model, size, pivot, opts) => r.define(key, () => ({ model: model(), size, pivot }), opts);
    def('deer', M.deerModel, V, [-0.5, 0, 0]);
    def('boar', M.boarModel, V, [-0.5, 0, 0]);
    def('spear', M.spearModel, V, [0.5, 0.5, 0]);
    def('fish', M.fishModel, 0.06, [0.5, 0.5, 0]);
    def('boat', M.boatModel, V, [0, 1, 0]);
    def('wheat0', () => M.wheatRowModel(0), V, [0, 0, 0.5], { shadow: false });
    def('wheat1', () => M.wheatRowModel(1), V, [0, 0, 0.5]);
    def('wheat2', () => M.wheatRowModel(2), V, [0, 0, 0.5]);
    def('fence', M.fenceModel, V, [0, 0, 0.5]);
    def('hay', M.hayModel, V, [3.5, 0, 3.5]);
    def('sheaf', M.sheafModel, V, [1.5, 0, 1.5]);
    def('sack', M.sackModel, V, [2, 0, 1.5]);
    def('amphora', M.amphoraModel, V, [1.5, 0, 1.5]);
    def('logs', M.logPileModel, V, [4, 0, 7]);
    def('goldpile', M.goldPileModel, V, [3.5, 0, 3.5]);
    def('cart', M.cartModel, V, [0.5, 0, 0]);
    for (const f of ['grain', 'apples', 'grapes', 'fish', 'gold']) def(`crate_${f}`, () => M.crateModel(f), V, [3, 0, 3]);
  }

  render(dt, alpha) {
    const game = this.game, econ = this.econ, r = this.r, map = game.map, fog = game.fog;
    const time = game.time + (game.paused ? 0 : alpha * SIM_DT);
    r.begin();

    // ---- animals & carcasses
    for (const a of econ.wildlife.animals) {
      const x = a.prevX + (a.x - a.prevX) * alpha, z = a.prevZ + (a.z - a.prevZ) * alpha;
      if (a.alive ? !fog.isVisible(x, z) : !fog.isExplored(x, z)) continue;
      const y = map.heightAt(x, z);
      const tint = 1 + (a.flashT > 0 ? a.flashT * 3 : 0);
      if (a.alive) {
        const run = a.econ_moving ? Math.abs(Math.sin(time * (4 + a.econ_speed * 3) + a.id)) * (0.04 + a.econ_speed * 0.03) : 0;
        const pitch = a.econ_moving ? Math.sin(time * (4 + a.econ_speed * 3) * 2 + a.id) * 0.05 : a.econ_graze * 0.32 * (0.8 + 0.2 * Math.sin(time * 1.3 + a.id));
        r.draw(a.type, x, y + run, z, a.rot, { pitch, tint });
      } else {
        const k = Math.min(1, a.econ_deadT / 0.5);
        const f = k * k;
        const left = Math.max(0.35, a.amount / a.maxAmount);
        const side = a.id % 2 ? 1 : -1;
        r.draw(a.type, x, y + f * (a.type === 'boar' ? 0.35 : 0.25), z, a.rot, { roll: side * f * Math.PI / 2 * 0.95, sy: left, sx: 1, sz: 0.7 + 0.3 * left, tint: 0.92 });
      }
    }

    // ---- spears in flight / stuck in the ground
    for (const s of econ.spears) {
      const t = s.t + (game.paused ? 0 : alpha * SIM_DT);
      const k = Math.min(1, t / s.dur);
      const h = 0.35 + Math.hypot(s.x1 - s.x0, s.z1 - s.z0) * 0.08;
      const x = s.x0 + (s.x1 - s.x0) * k, z = s.z0 + (s.z1 - s.z0) * k;
      const y = s.y0 + (s.y1 - s.y0) * k + 4 * h * k * (1 - k);
      const d = Math.hypot(s.x1 - s.x0, s.z1 - s.z0) || 1;
      const dy = (s.y1 - s.y0) + 4 * h * (1 - 2 * k);
      const pitch = k >= 1 ? 0.7 : -Math.atan2(dy, d);
      if (!fog.isVisible(x, z)) continue;
      r.draw('spear', x, k >= 1 ? y - 0.25 : y, z, Math.atan2(s.x1 - s.x0, s.z1 - s.z0), { pitch });
    }

    // ---- fish shoals
    const wy = map.waterY();
    for (const s of econ.fishing.shoals) {
      if (s.amount <= 0 || !fog.isExplored(s.x, s.z)) continue;
      const n = Math.max(2, Math.round(6 * s.amount / s.maxAmount));
      for (let i = 0; i < n; i++) {
        const ang = s.phase * (0.5 + (i % 3) * 0.12) + (i / n) * Math.PI * 2;
        const rad = 0.45 + (i % 3) * 0.3;
        const fx = s.x + Math.cos(ang) * rad, fz = s.z + Math.sin(ang) * rad;
        // tangent heading of the circle
        r.draw('fish', fx, wy - 0.06 + Math.sin(time * 3 + i) * 0.02, fz, Math.atan2(-Math.sin(ang), Math.cos(ang)), { scale: 1.2 });
      }
      // one fish leaps out of the water every few seconds
      const cyc = 3.2 + (s.id % 3) * 0.7;
      const lt = (time + s.id * 1.37) % cyc;
      if (lt < 0.7) {
        const k = lt / 0.7;
        const ang = s.id * 1.9 + Math.floor((time + s.id * 1.37) / cyc) * 2.3;
        const jx = s.x + Math.cos(ang) * (0.3 + k * 0.9), jz = s.z + Math.sin(ang) * (0.3 + k * 0.9);
        r.draw('fish', jx, wy + Math.sin(k * Math.PI) * 0.7, jz, ang + Math.PI / 2, { pitch: (k - 0.5) * 2.2, scale: 1.4 });
      }
    }

    // ---- fishing boats
    for (const b of econ.fishing.boats) {
      const x = b.prevX + (b.x - b.prevX) * alpha, z = b.prevZ + (b.z - b.prevZ) * alpha;
      if (b.owner !== game.localPlayer && !fog.isVisible(x, z)) continue;
      const bob = Math.sin(time * 1.6 + b.id) * 0.05;
      r.draw('boat', x, wy - 0.12 + bob, z, b.rot, {
        roll: Math.sin(time * 1.1 + b.id * 2) * 0.05, pitch: Math.sin(time * 1.4 + b.id) * 0.03,
        team: game.players[b.owner].color,
      });
      if (b.state === 'fishing') {
        // net floats and a few fish splashing beside the hull
        for (let i = 0; i < 3; i++) {
          const a = b.rot + Math.PI / 2 + (i - 1) * 0.4;
          const k = (time * 1.5 + i * 0.33 + b.id) % 1;
          r.draw('fish', x + Math.sin(a) * 1.0, wy + Math.sin(k * Math.PI) * 0.35, z + Math.cos(a) * 1.0, a + i, { pitch: (k - 0.5) * 2, scale: 1.1 });
        }
      }
    }

    // ---- crops on farms (harvest front sweeps the rows as the farmer works)
    for (const f of game.entities.buildings()) {
      if (!f.def.farm || !f.built || !fog.isExplored(f.x, f.z)) continue;
      const H = f.econ_rows || 0;
      const segs = f.w - 1;
      const dz = (f.h - 1.1) / FARM_ROWS;
      const y = map.heightAt(f.x, f.z) + 0.02;
      for (let i = 0; i < FARM_ROWS; i++) {
        const lastCut = H < i ? -Infinity : Math.floor((H - i) / FARM_ROWS) * FARM_ROWS + i;
        // part-cut current row: split at the farmer's position
        const cur = Math.floor(H) % FARM_ROWS === i && H >= i;
        const age = H - lastCut;
        let stage = age < FARM_ROWS * 0.35 ? 0 : age < FARM_ROWS * 0.7 ? 1 : 2;
        const z = f.tz + 0.55 + (i + 0.5) * dz;
        const back = Math.floor(H / FARM_ROWS) % 2 === 1;
        for (let s = 0; s < segs; s++) {
          let st = stage;
          if (cur) {
            const frac = H - Math.floor(H);
            const pos = back ? 1 - (s + 0.5) / segs : (s + 0.5) / segs;
            st = pos < frac ? 0 : Math.floor(H) < FARM_ROWS ? 2 : 2;
          }
          const x = f.tx + 0.5 + s;
          const jit = hash2(f.id * 13 + i, s, 5);
          r.draw(`wheat${st}`, x, y, z, 0, { sy: 0.85 + jit * 0.3, tint: 0.92 + jit * 0.16 });
        }
      }
    }

    // ---- stockpiles beside drop-off buildings
    for (const b of game.entities.buildings()) {
      if (!b.built || !b.econ_stock || !fog.isExplored(b.x, b.z)) continue;
      const slots = this.stockSlots(b);
      let si = 0;
      for (const kind of STOCK_ORDER) {
        const amt = b.econ_stock[kind] || 0;
        if (amt < 5) continue;
        const n = Math.min(3, Math.ceil(Math.log2(1 + amt / 20)));
        for (let j = 0; j < n && si < slots.length; j++, si++) {
          const [sx, sz, rot] = slots[si];
          r.draw(STOCK_KEYS[kind][j], sx, map.heightAt(sx, sz), sz, rot);
        }
      }
    }

    // ---- static field dressing placed by scenes
    for (const d of econ.decor) {
      if (!fog.isExplored(d.x, d.z)) continue;
      r.draw(d.key, d.x, map.heightAt(d.x, d.z) + (d.y || 0), d.z, d.rot || 0, { scale: d.scale || 1, sx: d.sx, sy: d.sy, sz: d.sz });
    }
    r.end();
  }

  // Deterministic prop slots around a building's back and sides.
  stockSlots(b) {
    if (b.econ_slots) return b.econ_slots;
    const out = [];
    const o = 0.55;
    const rot = (i) => (hash2(b.id, i, 3) - 0.5) * 0.8;
    for (let x = b.tx + 0.6; x < b.tx + b.w - 0.3; x += 1.0) out.push([x, b.tz - o, rot(out.length)]);
    for (let z = b.tz + 0.6; z < b.tz + b.h - 0.3; z += 1.0) out.push([b.tx - o, z, Math.PI / 2 + rot(out.length)]);
    for (let z = b.tz + 0.6; z < b.tz + b.h - 0.3; z += 1.0) out.push([b.tx + b.w + o, z, Math.PI / 2 + rot(out.length)]);
    // interleave so each kind spreads around the building
    b.econ_slots = out.filter((_, i) => i % 2 === 0).concat(out.filter((_, i) => i % 2 === 1));
    return b.econ_slots;
  }
}
