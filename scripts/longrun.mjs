// Long headless simulation of the default skirmish (AI vs. idle player) to
// catch runtime errors in rarely-hit code paths.
//   node scripts/longrun.mjs [--port 5173] [--minutes 12]
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), { port: '5173', host: 'localhost', minutes: '12', scene: 'skirmish' });
const browser = await launch();
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://${args.host}:${args.port}/?scene=${args.scene}&post=off&live=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sceneReady === true || (window.__errors || []).length > 0, null, { timeout: 120000 });
  for (let m = 1; m <= +args.minutes; m++) {
    const s = await page.evaluate(() => {
      const g = window.__game;
      // give the idle human player's villagers something to do
      for (const u of g.entities.units()) if (u.owner === 1 && u.order.type === 'idle' && u.def.gatherer) {
        const r = g.economy.nearestResource(u.x, u.z, 'wood', 40); if (r) g.commands.order(u, { type: 'gather', targetId: r.id });
      }
      try { g.fastForward(60); } catch (e) { g.errors.push(String(e.stack || e)); }
      const st = g.stats();
      delete st.unitPositions;
      return st;
    });
    console.log(`t=${m}min`, JSON.stringify(s));
    if (s.errors.length) { ok = false; console.error(s.errors.slice(0, 3).join('\n')); break; }
  }
  if (errors.length) { ok = false; console.error(errors.slice(0, 5).join('\n')); }
} catch (e) { ok = false; console.error(e); }
await browser.close();
console.log(ok ? 'LONGRUN OK' : 'LONGRUN FAILED');
process.exit(ok ? 0 : 1);
