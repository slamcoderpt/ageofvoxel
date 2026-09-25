// Smoke test: loads ?scene=economy live and checks, over a known amount of
// simulated game time, that resources went up, units moved and nothing threw.
//
//   node scripts/smoke.mjs [--port 5173] [--seconds 20] [--timescale 4] [--live 60] [--timeout 300]
//
// Everything is measured against the game time actually simulated, never
// against wall-clock time: the page first runs live (real frames, real
// rendering) for up to --live wall-clock seconds or until --seconds of game
// time have passed. On a slow machine (software GL can take seconds per
// frame) the live loop covers only part of that, so the rest is stepped in
// the page with the fixed-step simulation (game.fastForward, in short chunks
// with a rendered frame between them) until --seconds of game time are done.
// The checks then compare the before/after snapshots over that span.
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), { port: '5173', host: 'localhost', seconds: '20', timescale: '4', live: '60', timeout: '300' });
const url = `http://${args.host}:${args.port}/?scene=economy&live=1&post=off&hud=1&timescale=${args.timescale}`;
const want = +args.seconds;
const browser = await launch();
const errors = [];
let ok = true;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) ok = false; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sceneReady === true || (window.__errors || []).length > 0, null, { timeout: +args.timeout * 1000 });
  const stats = () => page.evaluate(() => window.__game.stats());
  const before = await stats();

  // 1. live: the real loop (frames + fixed-step sim) for a wall-clock budget
  const liveEnd = Date.now() + +args.live * 1000;
  let after = before;
  while (after.time - before.time < want && Date.now() < liveEnd && !errors.length) {
    await page.waitForTimeout(1000);
    after = await stats();
  }
  const liveSim = after.time - before.time;
  const frames = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true))));
  console.log(`live: ${liveSim.toFixed(1)}s of game time in the render loop`);
  check(liveSim > 0 && frames, 'the live game loop advances game time');

  // 2. top up with fixed simulation steps until `want` seconds are simulated
  if (after.time - before.time < want) {
    await page.evaluate(() => { window.__game.paused = true; });
    while (after.time - before.time < want && !errors.length) {
      const step = Math.min(2, want - (after.time - before.time) + 1 / 60);
      await page.evaluate((s) => { const g = window.__game; try { g.fastForward(s); } catch (e) { g.errors.push(String(e.stack || e)); } }, step);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      after = await stats();
      if (after.errors.length) break;
    }
    console.log(`stepped: ${(after.time - before.time - liveSim).toFixed(1)}s of game time with fixed simulation steps`);
  }

  // 3. checks over the simulated span
  const sim = after.time - before.time;
  console.log(`game time ${before.time.toFixed(1)}s -> ${after.time.toFixed(1)}s (${sim.toFixed(1)}s simulated)`);
  console.log('before', JSON.stringify({ ...before, unitPositions: undefined }));
  console.log('after ', JSON.stringify({ ...after, unitPositions: undefined }));
  check(sim >= want - 0.05, `simulated ${sim.toFixed(1)}s of game time (wanted ${want}s)`);
  const gained = ['food', 'wood', 'gold'].map((k) => after.player[k] - before.player[k]);
  const rate = (v) => `${(v / Math.max(sim, 1e-6)).toFixed(2)}/s`;
  check(gained[1] > 0, `wood increased (+${gained[1].toFixed(0)}, ${rate(gained[1])})`);
  check(gained[0] > 0 || after.player.pop > before.player.pop, `food increased or was spent on villagers (+${gained[0].toFixed(0)}, ${rate(gained[0])})`);
  check(gained[2] > 0, `gold increased (+${gained[2].toFixed(0)}, ${rate(gained[2])})`);
  const pos0 = new Map(before.unitPositions.map(([id, x, z]) => [id, [x, z]]));
  let moved = 0;
  for (const [id, x, z] of after.unitPositions) { const p = pos0.get(id); if (p && Math.hypot(p[0] - x, p[1] - z) > 0.5) moved++; }
  check(moved >= 5, `${moved} units moved`);
  const pageErrors = await page.evaluate(() => [...(window.__errors || []), ...window.__game.errors]);
  errors.push(...pageErrors);
  check(errors.length === 0, `no errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
} catch (err) {
  ok = false;
  console.error(err);
} finally {
  await browser.close();
}
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
