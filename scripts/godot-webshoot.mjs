// Smoke-test and screenshot the Godot WEB export (dist-godot/web, made by
// scripts/godot-export.sh web) in headless Chromium with software WebGL2.
//
//   node scripts/godot-webshoot.mjs [--scene town|none] [--params "seed=7"] [--out shots/godot/web-town.png]
//        [--dir dist-godot/web] [--width 1280 --height 720] [--settle 20] [--timeout 600] [--coi] [--verbose]
//
// Serves --dir on a local port, opens index.html?scene=<scene>&<params>, waits
// for the scene log line ("aov: scene=...") plus --settle seconds of rendering,
// saves a screenshot and exits non-zero on a Godot / script error, a missing
// extension, a timeout, a blank frame or a black 3D world behind the HUD.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launch, parseArgs } from './browser.mjs';

const args = parseArgs(process.argv.slice(2), {
  scene: 'town', dir: 'dist-godot/web', width: '1280', height: '720', settle: '20', timeout: '600',
});
const out = args.out || `shots/godot/web-${args.scene}.png`;
const root = path.resolve(args.dir);
if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`[webshoot] no ${root}/index.html: run scripts/godot-export.sh web first`);
  process.exit(2);
}

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
};
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  // --coi: serve with cross-origin isolation (COOP/COEP) too; the nothreads
  // build must start either way
  const coi = args.coi ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {};
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', ...coi });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
// --scene none: open index.html with no scene param (the default scene, as
// a player opening the link gets it)
const query = [args.scene !== 'none' ? `scene=${encodeURIComponent(args.scene)}` : '', args.params || ''].filter(Boolean).join('&');
const url = `http://127.0.0.1:${port}/index.html${query ? `?${query}` : ''}`;

const t0 = Date.now();
const browser = await launch();
let code = 0;
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: +args.width, height: +args.height }, deviceScaleFactor: 1 });
  let sceneAt = 0;
  page.on('console', (m) => {
    const t = m.text();
    if (args.verbose) console.log(`[page] ${t}`);
    if (/^aov: scene=/.test(t)) { sceneAt = Date.now(); console.log(`[webshoot] ${t}`); }
    if (/^(USER |SCRIPT )?ERROR|Parse Error|GDExtension.*(fail|error|not found)|Can't open dynamic library|failed to load|AovSim missing|Aborted\(|RuntimeError|corrupted its heap|Class '.*' doesn't exist/i.test(t)) errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url);
  const deadline = t0 + +args.timeout * 1000;
  while (!sceneAt && !errors.length && Date.now() < deadline) await page.waitForTimeout(500);
  if (!sceneAt) throw new Error(errors.length ? 'error before the scene started' : 'timeout waiting for the scene');
  await page.waitForTimeout(+args.settle * 1000);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const png = await page.screenshot({ path: out, timeout: +args.timeout * 1000 });
  // blank-frame check like shoot.mjs: mean / std of the canvas pixels (downscaled)
  const stats = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas'); c.width = 160; c.height = 90;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let s = 0, s2 = 0, n = 0, w = 0, wn = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; n++;
      // the 3D world alone: the frame centre, clear of the HUD bars and minimap
      const x = (i / 4) % 160, y = Math.floor(i / 4 / 160);
      if (x >= 48 && x < 112 && y >= 22 && y < 63) { w += l; wn++; }
    }
    const mean = s / n; return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), world: w / wn };
  }, png.toString('base64'));
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[webshoot] ${args.scene} -> ${out} in ${secs}s  (mean ${stats.mean.toFixed(1)}, std ${stats.std.toFixed(1)}, world ${stats.world.toFixed(1)})`);
  if (stats.mean < 8 || stats.std < 4) { console.error('[webshoot] blank frame'); code = 3; }
  // a black 3D world under a live HUD (e.g. a full-screen pass reading the
  // depth buffer with Forward+ conventions on the Compatibility renderer)
  else if (stats.world < 16) { console.error('[webshoot] black 3D world (HUD only)'); code = 3; }
} catch (e) {
  console.error(`[webshoot] ${e.message}`);
  code = 1;
} finally {
  if (errors.length) {
    console.error(`[webshoot] ${errors.length} error(s):\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}`);
    code = code || 1;
  }
  await browser.close();
  server.close();
}
process.exit(code);
