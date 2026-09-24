// Smoke test: loads ?scene=economy live, lets ~20 s of game time pass and
// checks that resources went up, units moved and nothing threw.
//   node scripts/smoke.mjs [--port 5173] [--seconds 20] [--timescale 4] [--timeout 240]
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), { port: '5173', host: 'localhost', seconds: '20', timescale: '4', timeout: '300' });
const url = `http://${args.host}:${args.port}/?scene=economy&live=1&post=off&hud=1&timescale=${args.timescale}`;
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
  const before = await page.evaluate(() => window.__game.stats());
  const target = before.time + +args.seconds;
  const deadline = Date.now() + +args.timeout * 1000;
  let after = before;
  while (after.time < target && Date.now() < deadline) {
    await page.waitForTimeout(1000);
    after = await page.evaluate(() => window.__game.stats());
  }
  console.log(`game time ${before.time.toFixed(1)}s -> ${after.time.toFixed(1)}s`);
  console.log('before', JSON.stringify({ ...before, unitPositions: undefined }));
  console.log('after ', JSON.stringify({ ...after, unitPositions: undefined }));
  check(after.time - before.time >= +args.seconds * 0.95, `simulated ${(after.time - before.time).toFixed(1)}s of game time`);
  const gained = ['food', 'wood', 'gold'].map((k) => after.player[k] - before.player[k]);
  check(gained[1] > 0, `wood increased (+${gained[1].toFixed(0)})`);
  check(gained[0] > 0 || after.player.pop > before.player.pop, `food increased or was spent on villagers (+${gained[0].toFixed(0)})`);
  check(gained[2] > 0, `gold increased (+${gained[2].toFixed(0)})`);
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
