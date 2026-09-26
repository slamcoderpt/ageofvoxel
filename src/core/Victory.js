import { PLAYER, ENEMY } from './constants.js';

// Match end: a player loses when all of their Town Centers are destroyed
// (foundations count, so a Town Center being rebuilt keeps a player alive).
// Only players who have owned a Town Center can lose, so scenes without
// Town Centers never end. Enabled per scene (`victory: true`, the skirmish).
// On the result it pauses the game and emits 'game:over' { winner, loser };
// the UI shows the victory / defeat overlay.
export class Victory {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.result = null; // { winner, loser, time } once decided
    this.had = {};
    this.timer = 0;
  }

  update(dt) {
    if (!this.enabled || this.result) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    const alive = {};
    for (const b of this.game.entities.buildings()) if (b.type === 'town_center' && !b.dead) alive[b.owner] = true;
    for (const id of [PLAYER, ENEMY]) if (alive[id]) this.had[id] = true;
    const lost = [PLAYER, ENEMY].filter((id) => this.had[id] && !alive[id]);
    if (!lost.length) return;
    // both gone on the same tick counts as a defeat for the local player
    const loser = lost.includes(this.game.localPlayer) ? this.game.localPlayer : lost[0];
    const winner = loser === PLAYER ? ENEMY : PLAYER;
    this.result = { winner, loser, time: this.game.time };
    this.game.paused = true;
    this.game.events.emit('game:over', this.result);
  }
}
