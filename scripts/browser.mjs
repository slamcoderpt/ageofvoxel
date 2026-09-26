// Shared Playwright launcher for the harness scripts: headless Chromium with
// software WebGL (SwiftShader). Falls back to the preinstalled browser under
// /opt/pw-browsers when Playwright's pinned revision is missing.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

function findChrome() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const p = path.join(root, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export async function launch() {
  try {
    return await chromium.launch({ args: GL_ARGS });
  } catch (err) {
    const exe = findChrome();
    if (!exe) throw err;
    return chromium.launch({ args: GL_ARGS, executablePath: exe });
  }
}

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}
