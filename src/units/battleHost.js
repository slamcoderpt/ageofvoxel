// Heroes and myth units for the 'battle' harness scene (src/combat/BattleScene.js
// calls fieldHeroesAndMyth once per army). Kept with the units piece so the
// scene file only needs a one-line hook.
//   P(a, d) -> [x, z]: a = along the front (this army's right is +a), d = depth
//   behind its own front (0 = the seam between the armies).
// Scale hierarchy on the field: cyclops > hero > centaur / medusa / minotaur >
// cavalry > infantry.

export function fieldHeroesAndMyth(game, owner, side, P, rot) {
  const out = [];
  const put = (type, a, d, extra = {}) => {
    let [x, z] = P(a * side, d * side);
    if (!game.map.isWalkable(Math.floor(x), Math.floor(z))) {
      const w = game.pathfinder.nearestWalkable(Math.floor(x), Math.floor(z), 6);
      if (w) { x = w[0] + 0.5; z = w[1] + 0.5; }
    }
    const u = game.units.spawn(type, owner, x, z, { rot });
    Object.assign(u, extra);
    u.attackCd = game.rng.range(0, u.def.attack.cooldown);
    out.push(u);
    return u;
  };
  // the hero leads from the front, just off centre, towards the enemy hero
  put('hero', side > 0 ? -3.5 : 3.5, 0.9, { combat_leash: 4, combat_reach: 0.4 });
  // a cyclops wading into the line
  put('cyclops', 6.5, 1.2, { combat_leash: 4, combat_reach: 0.3 });
  // medusa behind the phalanx
  put('medusa', -8, 6.2);
  // a centaur troop on the far flank of the archer screen
  for (let i = 0; i < 4; i++) put('centaur', -17.5 + (i % 2) * 1.8, 7.5 + i * 1.3);
  return out;
}

// After both armies stand: each hero, cyclops and medusa picks a fight.
export function engageHeroesAndMyth(game, list) {
  for (const u of list) {
    const pref = u.type === 'hero' ? (o) => o.def.myth || o.def.hero : null;
    const t = (pref && game.combat.findEnemyNear(u, 9, pref)) || game.combat.findEnemyNear(u, u.def.attack.projectile ? 13 : 9);
    if (t) game.commands.order(u, { type: 'attack', targetId: t.id, auto: true });
  }
}
