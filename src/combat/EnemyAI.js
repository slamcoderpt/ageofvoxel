// Simple scripted opponent: keeps villagers busy, trains more, builds houses
// and a military academy, trains an army and sends attack waves.
// Deterministic (uses game.rng only). Toggle with ai.enabled.
export class EnemyAI {
  constructor(game, owner) {
    this.game = game;
    this.owner = owner;
    this.enabled = true;
    this.timer = 0;
    this.waveSize = 8;
    this.nextWaveAt = 240; // seconds of game time before the first wave may launch
    this.aggression = 1;
  }

  mine(kind, pred) {
    const out = [];
    for (const e of this.game.entities.byKind[kind].values()) if (e.owner === this.owner && !e.dead && (!pred || pred(e))) out.push(e);
    return out;
  }

  update(dt) {
    if (!this.enabled) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.0;
    const game = this.game, p = game.players[this.owner];
    const units = this.mine('unit');
    const buildings = this.mine('building');
    const tc = buildings.find((b) => b.type === 'town_center' && b.built);
    if (!tc) return;
    const vills = units.filter((u) => u.def.gatherer);
    const army = units.filter((u) => !u.def.gatherer);

    // 1. villagers
    if (vills.length < 22 && tc.queue.length < 2) game.economy.train(tc, 'villager');
    const counts = { food: 0, wood: 0, gold: 0 };
    const byType = { food: [], wood: [], gold: [] };
    for (const v of vills) if (v.order?.type === 'gather' && v.econ) { counts[v.econ.resType]++; byType[v.econ.resType].push(v); }
    const workers = vills.filter((v) => v.order?.type === 'idle' || v.order?.type === 'gather').length;
    const target = { food: Math.ceil(workers * 0.5), wood: Math.floor(workers * 0.3), gold: Math.floor(workers * 0.2) };
    const need = () => ['food', 'wood', 'gold'].sort((a, b) => (counts[a] - target[a]) - (counts[b] - target[b]))[0];
    for (const v of vills) {
      if (v.order?.type !== 'idle') continue;
      const want = need();
      if (this.assign(v, want, tc, buildings)) counts[want]++;
      else if (this.assign(v, 'wood', tc, buildings)) counts.wood++;
    }
    // rebalance: move one worker per tick from the most over-staffed resource
    const lack = need();
    if (counts[lack] < target[lack]) {
      const over = ['food', 'wood', 'gold'].sort((a, b) => (counts[b] - target[b]) - (counts[a] - target[a]))[0];
      if (over !== lack && counts[over] > target[over]) {
        const v = byType[over].find((x) => !x.carry.amount || x.carry.amount < 3);
        if (v) this.assign(v, lack, tc, buildings);
      }
    }

    // 2. houses
    const building = (t) => buildings.some((b) => b.type === t && !b.built);
    if (p.popCap - p.pop < 4 && p.popCap < 300 && !building('house')) this.tryBuild('house', this.pickBuilder(vills), tc);
    // 3. military
    const academy = buildings.find((b) => b.type === 'barracks');
    if (!academy && vills.length >= 10) this.tryBuild('barracks', this.pickBuilder(vills), tc);
    if (!buildings.some((b) => b.type === 'temple') && vills.length >= 14) this.tryBuild('temple', this.pickBuilder(vills), tc);
    if (academy && academy.built && academy.queue.length < 3) {
      const pick = ['hoplite', 'toxotes', 'hoplite', 'hippikon'][Math.floor(game.time / 7) % 4];
      game.economy.train(academy, pick);
    }
    const temple = buildings.find((b) => b.type === 'temple' && b.built);
    if (temple && p.age >= 1 && temple.queue.length < 1) game.economy.train(temple, 'minotaur');
    // worshippers
    if (temple && vills.filter((v) => v.order?.type === 'worship').length < 3) {
      const v = vills.find((v) => v.order?.type === 'gather' && v.econ?.resType === 'gold');
      if (v) game.commands.order(v, { type: 'worship', targetId: temple.id });
    }
    // 4. age up
    if (!p.advancing && p.age < 1 && p.res.food > 500) game.economy.advanceAge(this.owner);

    // 5. attack waves
    const idleArmy = army.filter((u) => u.order?.type === 'idle' || u.order?.auto);
    if (game.time >= this.nextWaveAt && idleArmy.length >= this.waveSize) {
      const target = this.findTarget(tc);
      if (target) {
        for (const u of idleArmy) game.commands.order(u, { type: 'attack', targetId: target.id, thenBuildings: true });
        this.waveSize = Math.min(40, this.waveSize + 4);
        this.nextWaveAt = game.time + 120 / this.aggression;
      }
    }
  }

  // Send a villager to gather a resource type; food falls back to farms.
  assign(v, resType, tc, buildings) {
    const game = this.game;
    const r = game.economy.nearestResource(tc.x, tc.z, resType, resType === 'gold' ? 45 : 34);
    if (r) return game.commands.order(v, { type: 'gather', targetId: r.id });
    if (resType !== 'food') return false;
    const farm = buildings.find((b) => b.def.farm && b.built && !(b.farmer && game.entities.get(b.farmer)?.order?.targetId === b.id));
    if (farm) return game.commands.order(v, { type: 'gather', targetId: farm.id });
    if (!buildings.some((b) => b.def.farm && !b.built)) return this.tryBuild('farm', v, tc);
    return false;
  }

  pickBuilder(vills) {
    return vills.find((v) => v.order?.type === 'gather' && v.econ?.resType === 'wood') || vills.find((v) => v.order?.type === 'idle') || vills[0];
  }

  findTarget(from) {
    let best = null, bd = Infinity;
    for (const b of this.game.entities.buildings()) {
      if (!this.game.isEnemy(this.owner, b.owner)) continue;
      const d = (b.x - from.x) ** 2 + (b.z - from.z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  tryBuild(type, builder, tc) {
    const game = this.game, p = game.players[this.owner];
    const def = game.buildings.defs[type];
    if (!builder || !p.canAfford(def.cost)) return false;
    const spot = this.findSpot(type, tc);
    if (!spot) return false;
    p.pay(def.cost);
    const b = game.buildings.spawn(type, this.owner, spot[0], spot[1], { built: false });
    game.commands.order(builder, { type: 'build', targetId: b.id });
    return true;
  }

  findSpot(type, tc) {
    const game = this.game;
    const def = game.buildings.defs[type];
    const cx = Math.floor(tc.x), cz = Math.floor(tc.z);
    for (let r = 6; r < 24; r += 1) {
      for (let k = 0; k < 16; k++) {
        const a = game.rng.range(0, Math.PI * 2);
        const tx = Math.round(cx + Math.cos(a) * r - def.w / 2), tz = Math.round(cz + Math.sin(a) * r - def.h / 2);
        // leave a one-tile gap around buildings so paths stay open
        if (game.buildings.canPlace(type, tx, tz) && this.gapOk(tx, tz, def)) return [tx, tz];
      }
    }
    return null;
  }

  gapOk(tx, tz, def) {
    const map = this.game.map;
    for (let z = tz - 1; z <= tz + def.h; z++)
      for (let x = tx - 1; x <= tx + def.w; x++) if (!map.isWalkable(x, z)) return false;
    return true;
  }
}
