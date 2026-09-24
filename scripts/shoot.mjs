// Deterministic screenshot harness.
//   node scripts/shoot.mjs --scene town --out shots/town.png [--port 5173]
//        [--width 1920 --height 1080] [--host localhost] [--params "hud=1&post=low"]
//        [--timeout 240]
// Expects a running server (npx vite --port N, or npx vite preview --port N).
// Waits for window.__sceneReady, saves a PNG, prints console errors and exits
// non-zero if the page threw or the image looks blank.
import fs from 'node:fs';
import path from 'node:path';
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), { scene: 'town', port: '5173', host: 'localhost', width: '1920', height: '1080', timeout: '300' });
const out = args.out || `shots/${args.scene}.png`;
const url = `http://${args.host}:${args.port}/?scene=${encodeURIComponent(args.scene)}${args.params ? `&${args.params}` : ''}`;

const browser = await launch();
let failed = false;
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: +args.width, height: +args.height }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.stack || e.message}`); failed = true; });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__sceneReady === true || (window.__errors && window.__errors.length > 0), null, { timeout: +args.timeout * 1000, polling: 250 });
  const pageErrors = await page.evaluate(() => [...(window.__errors || []), ...((window.__game && window.__game.errors) || [])]);
  if (pageErrors.length) { failed = true; errors.push(...pageErrors.map((e) => `page: ${e}`)); }
  // blank/black check on the WebGL canvas
  const stats = await page.evaluate(() => {
    const src = document.querySelector('#app canvas');
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sum2 = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sum2 += l * l; }
    const mean = sum / n;
    return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out, timeout: 180000 });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!stats) { failed = true; errors.push('no canvas found'); }
  else if (stats.mean < 8 || stats.std < 4) { failed = true; errors.push(`image looks blank (mean ${stats.mean.toFixed(1)}, std ${stats.std.toFixed(1)})`); }
  console.log(`[shoot] ${args.scene} -> ${out} in ${secs}s  (mean ${stats?.mean.toFixed(1)}, std ${stats?.std.toFixed(1)})`);
} catch (err) {
  failed = true;
  errors.push(String(err.stack || err));
} finally {
  await browser.close();
}
for (const e of errors) console.error(`[shoot] ${e}`);
process.exit(failed ? 1 : 0);
