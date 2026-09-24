import { Game } from './core/Game.js';
import { SCENES } from './core/scenes/index.js';

// Entry point. Reads URL params, builds the scene and runs the loop.
//   ?scene=skirmish|town|battle|godpower|coast|economy|hud   (default skirmish)
//   &seed=N  &live=0|1  &hud=0|1  &post=high|low|off  &timescale=N  &fog=0|1
//   &cam=x,z[,distance[,pitch[,yaw]]]
const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') || 'skirmish';
const scene = SCENES.get(sceneName);
const bool = (k, d) => (params.has(k) ? params.get(k) !== '0' && params.get(k) !== 'false' : d);

window.__sceneReady = false;
window.__errors = [];
addEventListener('error', (e) => window.__errors.push(String(e.error?.stack || e.message)));
addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason?.stack || e.reason)));

async function boot() {
  if (!scene) throw new Error(`Unknown scene "${sceneName}". Known: ${[...SCENES.keys()].join(', ')}`);
  const harness = params.has('scene');
  const game = new Game(document.getElementById('app'), {
    seed: +(params.get('seed') ?? scene.seed ?? 1),
    preset: scene.preset,
    mapSize: scene.mapSize ?? 128,
    post: params.get('post') || 'high',
    timeScale: +(params.get('timescale') ?? 1),
    harness,
  });
  window.__game = game;
  game.init();
  game.combat.ai.enabled = !!scene.ai;
  const ctx = scene.setup(game) || {};
  game.fog.setRevealAll(!bool('fog', !scene.revealAll));
  game.ui.setVisible(bool('hud', !!scene.hud));
  if (scene.fastForward) game.fastForward(scene.fastForward);
  const cam = typeof scene.camera === 'function' ? scene.camera(game, ctx) : scene.camera;
  if (cam) game.cameraCtl.setView(cam);
  // &cam=x,z[,distance[,pitch[,yaw]]] overrides the scene camera (handy for close-ups)
  if (params.has('cam')) {
    const [x, z, distance, pitch, yaw] = params.get('cam').split(',').map(Number);
    game.cameraCtl.setView({ x, z, distance: distance || undefined, pitch: pitch || undefined, yaw: Number.isFinite(yaw) ? yaw : undefined });
  }
  scene.after?.(game, ctx);
  game.fog.recompute();
  const live = bool('live', !!scene.live);
  game.paused = !live;
  if (harness) game.cameraCtl.edgeScroll = false;
  game.start();
  // wait a few rendered frames (shader compilation, lazy meshes) before capture
  let frames = 0;
  const wait = () => {
    if (++frames >= 4) {
      // a paused harness scene stops redrawing so captures are exact and cheap
      if (harness && !live && navigator.webdriver) game.frozen = true;
      window.__sceneReady = true;
      document.title = `Age of Voxel — ${sceneName}`;
    } else requestAnimationFrame(wait);
  };
  requestAnimationFrame(wait);
}

boot().catch((err) => {
  console.error(err);
  window.__errors.push(String(err.stack || err));
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:40px;left:10px;z-index:99">${err.stack || err}</pre>`);
});
