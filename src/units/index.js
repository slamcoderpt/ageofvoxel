import * as THREE from 'three';
import { buildVoxelGeometry, makeVoxelMaterial, voxelMaterialFor } from '../core/voxel.js';
import { addShaderPatch, prependVertex, injectVertex, prependFragment, injectFragment } from '../core/shaderPatch.js';
import { UNIT_DEFS } from './defs.js';
import { RIGS } from './models.js';
import { pose, uhash } from './anim.js';

// Units piece: unit entities, rigs, instanced rendering, animation state.
// Public API:
//   units.spawn(type, owner, x, z, { rot }) -> entity
//   units.portraitObject(type, owner) -> THREE.Group (for HUD portraits)
//
// Animation: other systems request a state for this tick by setting
// u.anim.want = 'gather' | 'build' | 'attack' | 'worship'. Walking and dying
// are derived automatically. Combat sets u.anim.attackT (seconds since the
// last strike) and u.flashT (hit flash).
// The dead lie where they fell for the rest of the fight (Retold leaves
// bodies on the field a long while), then dither out.
const CORPSE_TIME = 26;
const FADE_START = 22.5;  // corpses dither out between FADE_START and CORPSE_TIME
// Local avoidance for units standing their ground (fighting, idle soldiers):
// keep about half a body-width of air between neighbours so a melee line
// reads as separate figures rather than one interpenetrating blob.
const SPREAD_GAP = 1.35;   // extra spacing, in multiples of the smaller radius
const SPREAD_SPEED = 2.0; // max drift, tiles/second
// Crowd variety (visual only, never fed back into the sim): each soldier
// stands a little off its formation slot, faces a little off true, is a
// little taller or shorter, and in melee presses in towards its foe so the
// contact line interlocks instead of holding a clean seam.
const JITTER = 0.3;        // tiles, static per unit
const PRESS_RATE = 3;      // per second
const OUTLINE = 0.045;     // outline width, world units (~1 px at the RTS zoom)
const CORPSE_CLEAR = 0.5;  // corpses slide out from under the living, tiles/second
// Per-unit horse coat tints (multiplied into the dappled grey base).
// Pale coats only (greys, near-whites, a light dun): a dark bay under a team
// cloth read as a coloured box on the ground; a pale horse keeps its shape.
const COATS = [[1, 1, 1], [1.08, 1.08, 1.07], [0.97, 0.9, 0.78], [0.86, 0.86, 0.88], [1.04, 1.02, 0.98], [0.92, 0.9, 0.86]];

export class Units {
  constructor(game) {
    this.game = game;
    this.defs = UNIT_DEFS;
    this.group = new THREE.Group();
    this.group.name = 'units';
    game.scene.add(this.group);
    this.material = makeVoxelMaterial({ instanced: true });
    // Per-instance fade (1 = solid, 0 = gone) as an ordered-dither discard, so
    // corpses dissolve without sorting transparent instanced meshes.
    addShaderPatch(this.material, 'unitFade', (shader) => {
      prependVertex(shader, 'attribute float instFade;\nvarying float vFade;');
      injectVertex(shader, '#include <color_vertex>', 'vFade = instFade;');
      prependFragment(shader, 'varying float vFade;');
      injectFragment(shader, '#include <clipping_planes_fragment>', `if (vFade < 0.999) {
        vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
        vec2 lo = mod(q, 2.0), hi = floor(q * 0.5);
        float b = (4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0) + 0.5) / 16.0;
        if (b > vFade) discard;
      }`);
    });
    // Team colour holds its saturation in shade: a small self-lit share of
    // the tinted albedo, so an army lit from behind still reads red or blue
    // instead of brown.
    addShaderPatch(this.material, 'unitTeamLift', (shader) => {
      // plus a lighter rim: faces turned edge-on to the camera (flanks,
      // crest sides, cloak edges) glow a paler, brighter version of the
      // dye, so each figure's team colour has a lit edge against the ground
      injectFragment(shader, '#include <emissivemap_fragment>', `{
        float teamRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 1.6);
        vec3 teamSat = diffuseColor.rgb * vTeam;
        // (pure hue only: a grey lift turned the red army pink)
        totalEmissiveRadiance += teamSat * (0.7 + teamRim * 1.0);
      }`);
    });
    // Silhouette outline: every part is drawn a second time as a dark
    // inverted hull (back faces pushed out along their normals), so each
    // soldier is ringed by a thin dark line against the ground and against
    // the man behind him.
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x140d08, side: THREE.BackSide });
    this.outlineMat.fog = false;
    this.outlineMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instFade;\nvarying float vFade;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFade = instFade;
        transformed += normal * ${OUTLINE.toFixed(4)};`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vFade < 0.999) {
          vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
          vec2 lo = mod(q, 2.0), hi = floor(q * 0.5);
          float b = (4.0 * mod(2.0 * lo.x + 3.0 * lo.y, 4.0) + mod(2.0 * hi.x + 3.0 * hi.y, 4.0) + 0.5) / 16.0;
          if (b > vFade) discard;
        }`);
    };
    this.outlineMat.customProgramCacheKey = () => 'unitOutline';
    this.rigs = new Map(); // type -> { parts: [{name, geo, joint, parent, mesh, cap}], kind, voxel }
    for (const type of Object.keys(RIGS)) this._buildRig(type);
    this._m = new THREE.Matrix4();
    this._root = new THREE.Matrix4();
    this._tmp = new THREE.Matrix4();
    this._e = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._initContactShadows();
  }

  // A dark, soft-edged disc on the ground under every unit, so each man in a
  // crowd sits on his own patch of earth and reads as separate from the mass.
  _initContactShadows() {
    const N = 64, px = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = (i + 0.5) / N * 2 - 1, dz = (j + 0.5) / N * 2 - 1;
      const d = Math.sqrt(dx * dx + dz * dz);
      // solid core under the feet, fading out to the rim
      const a = d >= 1 ? 0 : d < 0.45 ? 1 : Math.pow(1 - (d - 0.45) / 0.55, 1.6);
      const k = (j * N + i) * 4;
      px[k] = px[k + 1] = px[k + 2] = Math.round(a * 255); px[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x0c0804, alphaMap: tex, transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.shadowMat.fog = false;
    this.shadowCap = 0;
    this.shadowMesh = null;
  }

  _ensureShadowCapacity(n) {
    if (this.shadowMesh && this.shadowCap >= n) return;
    const cap = Math.max(256, this.shadowCap * 2, n);
    if (this.shadowMesh) { this.group.remove(this.shadowMesh); this.shadowMesh.dispose(); }
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.shadowMat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.userData.noAO = true;
    mesh.name = 'unitContactShadows';
    this.shadowMesh = mesh; this.shadowCap = cap;
    this.group.add(mesh);
  }

  _buildRig(type) {
    const R = RIGS[type];
    const parts = R.build().map((p) => ({
      name: p.name, anim: p.anim || p.name, joint: p.joint, parent: p.parent, show: p.show || null, coat: !!p.coat, portrait: p.portrait ?? !p.show,
      geo: buildVoxelGeometry(p.model, { size: R.voxel * (p.scale || 1), pivot: p.pivot, jitter: 0.05 }),
      mesh: null, outline: null, cap: 0,
    }));
    const rig = { type, parts, kind: R.anim, voxel: R.voxel, rot: {}, world: parts.map(() => new THREE.Matrix4()) };
    for (const p of parts) {
      rig.rot[p.anim] = [0, 0, 0];
      p.parentIdx = p.parent ? parts.findIndex((q) => q.name === p.parent) : -1;
    }
    this.rigs.set(type, rig);
  }

  _ensureCapacity(part, n) {
    if (part.mesh && part.cap >= n) return;
    const cap = Math.max(64, part.cap * 2, n);
    if (part.mesh) { this.group.remove(part.mesh); part.mesh.dispose(); }
    const mesh = new THREE.InstancedMesh(part.geo, this.material, cap);
    const team = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const flash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1);
    team.setUsage(THREE.DynamicDrawUsage); flash.setUsage(THREE.DynamicDrawUsage); fade.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.team = team; mesh.userData.flash = flash; mesh.userData.fade = fade;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // instanced attributes live on a per-mesh geometry clone that shares buffers
    const g = new THREE.BufferGeometry();
    for (const k in part.geo.attributes) g.setAttribute(k, part.geo.attributes[k]);
    g.setIndex(part.geo.index);
    g.boundingSphere = part.geo.boundingSphere;
    g.setAttribute('instTeam', team);
    g.setAttribute('instFlash', flash);
    g.setAttribute('instFade', fade);
    mesh.geometry = g;
    part.mesh = mesh;
    part.cap = cap;
    this.group.add(mesh);
    if (part.outline) { this.group.remove(part.outline); part.outline.dispose(); }
    const ol = new THREE.InstancedMesh(g, this.outlineMat, cap);
    ol.instanceMatrix = mesh.instanceMatrix;   // shares transforms with the part
    ol.frustumCulled = false;
    ol.castShadow = false; ol.receiveShadow = false;
    ol.userData.noAO = true;
    ol.name = 'unitOutline';
    part.outline = ol;
    this.group.add(ol);
  }

  spawn(type, owner, x, z, { rot = 0 } = {}) {
    const def = UNIT_DEFS[type];
    if (!def) throw new Error(`Unknown unit ${type}`);
    return this.game.entities.add({
      kind: 'unit', type, owner, def,
      x, z, prevX: x, prevZ: z, rot, prevRot: rot,
      hp: def.hp, maxHp: def.hp, speed: def.speed, radius: def.radius, sight: def.sight,
      order: { type: 'idle' }, moving: false, path: null,
      anim: { state: 'idle', t: this.game.rng.range(0, 10), want: null, attackT: 1, dieT: 0 },
      carry: { type: null, amount: 0 },
      attackCd: 0, flashT: 0,
    });
  }

  // ---- simulation -------------------------------------------------------
  update(dt) {
    const game = this.game;
    for (const u of [...game.entities.units()]) {
      const a = u.anim;
      a.t += dt;
      if (u.flashT > 0) u.flashT = Math.max(0, u.flashT - dt);
      a.attackT = (a.attackT ?? 1) + dt;
      // hit reactions (anim.js hitReact): a fresh one for every blow taken
      if (u.units_hitT !== undefined) u.units_hitT += dt;
      if (u.units_hp !== undefined && u.hp < u.units_hp - 0.01 && !u.dead) { u.units_hitT = 0; u.units_hitN = (u.units_hitN || 0) + 1; }
      u.units_hp = u.hp;
      if (u.dead) {
        a.state = 'die';
        a.dieT += dt;
        if (a.dieT > CORPSE_TIME) game.entities.remove(u);
        continue;
      }
      a.state = u.moving ? 'walk' : a.want || 'idle';
      a.want = null;
      // visual press into melee contact and a standing facing offset
      let press = 0;
      // Only the big units shoulder into the enemy line; infantry hold their
      // ground at spear reach so the two fronts keep a readable seam.
      if (a.state === 'attack' && u.def.attack && !u.def.attack.projectile && (u.def.hero || u.def.myth)) {
        const t = game.entities.get(u.order?.targetId);
        if (t && t.kind === 'unit') {
          const d = Math.hypot(t.x - u.x, t.z - u.z);
          const want = (u.def.hero ? 0.1 : 0.2) + uhash(u, 3) * (u.def.hero ? 0.1 : 0.3);
          press = Math.max(0, Math.min(want, (d - (u.radius + t.radius) * 0.95) / 2 - 0.22));
        }
      }
      // every man stands 5-15 degrees off true, to his own side
      // In a fight each man turns up to ~30 degrees off his foe, re-picked
      // every few seconds on his own clock (squaring up to a new threat,
      // side-stepping a thrust), so a melee is not a grid of parallel men.
      let yaw = u.moving ? 0 : (uhash(u, 8) < 0.5 ? -1 : 1) * (0.087 + uhash(u, 4) * 0.175) * 1.15;
      if (!u.moving && u.order?.type === 'attack' && !u.def.attack?.projectile && !u.def.myth) {
        const n = Math.floor(a.t / (2.2 + uhash(u, 63) * 1.6) + uhash(u, 64) * 7);
        // (but never so far off that the spear stops pointing at the man
        // he is fighting)
        yaw = (uhash(u, 65 + n) - 0.5) * 2 * 0.14;
      }
      const k = Math.min(1, dt * PRESS_RATE);
      u.units_press = (u.units_press || 0) + (press - (u.units_press || 0)) * k;
      u.units_yaw = (u.units_yaw || 0) + (yaw - (u.units_yaw || 0)) * k;
    }
    this._spread(dt);
  }

  // Local avoidance for units that are not path-following. Movement's own
  // separation only resolves overlap (radius + radius); here units that stand
  // still drift apart until there is roughly half a body-width between them.
  // Gatherers at work are left alone so they keep their spot on the resource.
  _spread(dt) {
    const game = this.game, hash = game.movement?.hash, map = game.map;
    if (!hash) return;
    const maxStep = SPREAD_SPEED * dt;
    for (const u of game.entities.units()) {
      if (u.dead) { this._clearCorpse(u, dt); continue; }
      if (u.moving) continue;
      const ot = u.order?.type;
      if (u.def.gatherer && ot !== 'idle' && ot !== 'attack') continue;
      const r = u.radius || 0.3;
      let sx = 0, sz = 0;
      hash.forEachNear(u.x, u.z, r + 2, (o) => {
        if (o === u || o.dead) return;
        const ro = o.radius || 0.3;
        const want = r + ro + SPREAD_GAP * Math.min(r, ro);
        const dx = u.x - o.x, dz = u.z - o.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= want * want) return;
        const d = Math.sqrt(d2);
        // moving units steer themselves; big units shove small ones
        const w = (o.moving ? 0.4 : 1) * Math.min(2, ro / r);
        const k = ((want - d) / want) * w;
        if (d < 1e-4) { sx += (u.id % 2 ? 1 : -1) * k; sz += (u.id % 3 ? 1 : -1) * k; }
        else { sx += (dx / d) * k; sz += (dz / d) * k; }
      });
      if (sx === 0 && sz === 0) continue;
      let vx = sx * 5 * dt, vz = sz * 5 * dt;
      const m = Math.hypot(vx, vz);
      if (m > maxStep) { vx *= maxStep / m; vz *= maxStep / m; }
      const nx = u.x + vx, nz = u.z + vz;
      if (map.isWalkable(Math.floor(nx), Math.floor(nz))) { u.x = nx; u.z = nz; }
    }
  }

  // A corpse lying under a man still fighting is pushed out to open ground,
  // so the dead never merge with the living into one heap of limbs. Only the
  // body moves; the living ignore corpses.
  _clearCorpse(u, dt) {
    const game = this.game, hash = game.movement.hash;
    const r = (u.radius || 0.3) * 1.4;
    let sx = 0, sz = 0;
    hash.forEachNear(u.x, u.z, r + 1.5, (o) => {
      if (o === u || o.dead) return;
      const want = r + (o.radius || 0.3) * 1.2;
      const dx = u.x - o.x, dz = u.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= want) return;
      const k = (want - d) / want;
      if (d < 1e-4) { sx += (u.id % 2 ? 1 : -1) * k; sz += (u.id % 3 ? 1 : -1) * k; }
      else { sx += (dx / d) * k; sz += (dz / d) * k; }
    });
    if (sx === 0 && sz === 0) return;
    const m = Math.hypot(sx, sz), step = Math.min(m, 1) * CORPSE_CLEAR * dt;
    const nx = u.x + (sx / m) * step, nz = u.z + (sz / m) * step;
    if (game.map.isWalkable(Math.floor(nx), Math.floor(nz))) { u.prevX = u.x = nx; u.prevZ = u.z = nz; }
  }

  // ---- rendering --------------------------------------------------------
  render(dt, alpha) {
    const game = this.game;
    const fog = game.fog;
    // bucket visible units per rig
    const buckets = new Map();
    for (const u of game.entities.units()) {
      if (u.owner !== game.localPlayer && !fog.isVisible(u.x, u.z)) continue;
      let b = buckets.get(u.type);
      if (!b) buckets.set(u.type, (b = []));
      b.push(u);
    }
    let total = 0;
    for (const b of buckets.values()) total += b.length;
    this._ensureShadowCapacity(total);
    let si = 0;
    const SH = this.shadowMesh;
    for (const [type, rig] of this.rigs) {
      const list = buckets.get(type) || [];
      for (const p of rig.parts) {
        this._ensureCapacity(p, list.length);
        p.mesh.count = list.length;
        p.outline.count = list.length;
      }
      if (!list.length) continue;
      const V = rig.voxel;
      const world = rig.world;
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        const x = u.prevX + (u.x - u.prevX) * alpha;
        const z = u.prevZ + (u.z - u.prevZ) * alpha;
        let dr = u.rot - (u.prevRot ?? u.rot);
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        const { bob, fwd = 0 } = pose(rig.kind, u, rig.rot);
        const rot = (u.prevRot ?? u.rot) + dr * alpha + (u.dead ? 0 : u.units_yaw || 0);
        // static slot jitter + melee press + lunge/recoil along the facing
        const push = u.dead ? 0 : (u.units_press || 0) + fwd;
        const big = u.def.myth || u.def.hero;
        // slot jitter mostly sideways along the rank, little along the facing,
        // so a fighting front stays a line instead of a scatter
        const jl = (uhash(u, 5) - 0.5) * 2 * JITTER * (big ? 0.3 : 1);
        const jf = (uhash(u, 6) - 0.5) * 2 * JITTER * (big ? 0.3 : u.anim.state === 'attack' ? 0.2 : 0.6);
        const px = x + Math.cos(rot) * jl + Math.sin(rot) * (push + jf), pz = z - Math.sin(rot) * jl + Math.cos(rot) * (push + jf);
        const y = game.map.heightAt(px, pz);
        const sc = big ? 1 : 0.93 + uhash(u, 7) * 0.13;
        {
          // contact shadow: stretched along the body for riders and beasts,
          // shrinking while a corpse fades or a unit is flung into the air
          const r = (u.radius || 0.4) * (rig.kind === 'horse' || rig.kind === 'centaur' ? 1.25 : big ? 1.25 : 1.3) * sc;
          const long = rig.kind === 'horse' || rig.kind === 'centaur' ? 1.7 : 1;
          const k = u.dead ? Math.max(0, 1 - u.anim.dieT / 4) : 1 / (1 + (u.airY || 0) * 0.6);
          this._q.setFromEuler(this._e.set(0, rot, 0));
          const hm = game.map, o = r * 0.6;
          const gy = Math.max(y, hm.heightAt(px + o, pz), hm.heightAt(px - o, pz), hm.heightAt(px, pz + o), hm.heightAt(px, pz - o));
          this._m.compose(this._v.set(px, gy + 0.02, pz), this._q, this._s.set(r * 2 * k, 1, r * 2 * long * k));
          SH.setMatrixAt(si++, this._m);
        }
        // root transform (with death topple + sink)
        this._q.setFromEuler(this._e.set(0, rot, 0));
        this._root.compose(this._v.set(px, y + bob * V * sc, pz), this._q, this._s.set(sc, sc, sc));
        if (u.airY) { // thrown by a god power (src/godpowers): lift + tumble about the waist
          this._root.premultiply(this._tmp.makeTranslation(0, u.airY, 0)).multiply(this._tmp.makeTranslation(0, 0.7, 0));
          this._root.multiply(this._tmp.makeRotationFromEuler(this._e.set(u.airRx || 0, 0, u.airRz || 0))).multiply(this._tmp.makeTranslation(0, -0.7, 0));
        }
        if (u.dead) {
          const dt0 = u.anim.dieT;
          const sink = Math.max(0, dt0 - CORPSE_TIME + 2) * 0.5;
          if (rig.kind === 'horse') {
            // horse keels over onto its side (away from the killer's side, by id)
            const k = Math.min(1, dt0 / 0.8);
            const f = k * k * (3 - 2 * k);
            const side = u.id % 2 ? 1 : -1;
            this._root.multiply(this._tmp.makeTranslation(0, f * 0.3, 0));
            this._root.multiply(this._tmp.makeRotationZ(side * f * Math.PI / 2 * 0.92));
          } else if (rig.kind === 'beast') {
            // crumple: knees buckle (pose), then the body rolls onto its side
            // and settles curled up, so a corpse keeps a 3D figure silhouette
            const k = Math.min(1, Math.max(0, (dt0 - 0.22) / 0.5));
            const f = k * k * (3 - 2 * k);
            const side = u.id % 2 ? 1 : -1;
            const bounce = dt0 > 0.72 && dt0 < 0.92 ? Math.sin((dt0 - 0.72) / 0.2 * Math.PI) * 0.05 : 0;
            this._root.multiply(this._tmp.makeTranslation(side * 0.1 * f, 0.45 * f, 0.12 * f));
            this._root.multiply(this._tmp.makeRotationZ(side * (f * 1.42 - bounce)));
            this._root.multiply(this._tmp.makeRotationX(0.3 * f));
          } else {
            // a man goes over full length, most onto their backs (thrown by
            // the blow), some pitched forward on their faces, and lies flat,
            // with a small bounce as he hits the ground
            const k = Math.min(1, Math.max(0, (dt0 - 0.18) / 0.5));
            const f = k * k;
            const dir = uhash(u, 70) < 0.3 ? 1 : -1;
            const side = u.id % 2 ? 1 : -1;
            const bounce = dt0 > 0.68 && dt0 < 0.9 ? Math.sin((dt0 - 0.68) / 0.22 * Math.PI) * 0.08 : 0;
            this._root.multiply(this._tmp.makeTranslation(0, 0.26 * f, -0.12 * dir * f));
            this._root.multiply(this._tmp.makeRotationX(dir * (f * 1.5 - bounce)));
            this._root.multiply(this._tmp.makeRotationZ(side * 0.12 * f));
          }
          this._root.premultiply(this._tmp.makeTranslation(0, -sink, 0));
        }
        const pc = game.players[u.owner].color;
        const coat = COATS[u.id % COATS.length];
        this._c.setHex(pc);
        // full-saturation dye: crush the minor channels (keeping the peak),
        // so red reads as red, not a pinkish brown, once lit and tone mapped
        { const mx = Math.max(this._c.r, this._c.g, this._c.b, 1e-4); this._c.setRGB(mx * (this._c.r / mx) ** 2, mx * (this._c.g / mx) ** 2, mx * (this._c.b / mx) ** 2); }
        // the dead lose their colour: team dye fades to grey-brown, the body darkens
        // the dead keep their army's colour, darkened (so a fallen man still
        // says whose he was) while the rest of him goes dull
        const dk = u.dead ? Math.min(1, u.anim.dieT / 0.8) * 0.72 : 0;
        if (dk) {
          // and half its saturation: a dull, dusty version of the dye
          const l = this._c.r * 0.3 + this._c.g * 0.59 + this._c.b * 0.11, m = dk * 1.1;
          this._c.setRGB(this._c.r + (l - this._c.r) * m, this._c.g + (l - this._c.g) * m, this._c.b + (l - this._c.b) * m).multiplyScalar(1 - dk * 0.9);
        }
        const ck = 1 - (u.gp_char || 0); // god power char (lightning-struck)
        const tr = this._c.r * ck, tg = this._c.g * ck, tb = this._c.b * ck;
        // a hard white flash on the frame (or two) a blow lands, then a faint
        // afterglow while flashT runs out
        const pop = !u.dead && (u.units_hitT ?? 9) < 0.07 && u.flashT > 0 ? 0.26 : 0;
        const flash = Math.max(pop, u.dead ? 0 : Math.min(1, u.flashT / 0.1) * 0.16, u.gp_hit || 0);
        const fade = u.dead ? 1 - Math.min(1, Math.max(0, (u.anim.dieT - FADE_START) / (CORPSE_TIME - 0.3 - FADE_START))) : 1;
        for (let pi = 0; pi < rig.parts.length; pi++) {
          const p = rig.parts[pi];
          const parent = p.parentIdx >= 0 ? world[p.parentIdx] : this._root;
          const r = rig.rot[p.anim];
          this._q.setFromEuler(this._e.set(r[0], r[1], r[2]));
          // the dead let go of their spears (they lie under the body), so a
          // field of corpses is not a litter of loose sticks over the melee
          const sc = (p.show && !p.show(u)) || (u.dead && p.anim === 'weapon' && u.anim.dieT > 0.5 && rig.kind !== 'archer') ? 0 : 1;
          this._m.compose(this._v.set(p.joint[0] * V, p.joint[1] * V, p.joint[2] * V), this._q, this._s.set(sc, sc, sc));
          const m = world[pi].multiplyMatrices(parent, this._m);
          p.mesh.setMatrixAt(i, m);
          p.mesh.userData.team.setXYZ(i, tr, tg, tb);
          p.mesh.userData.flash.setX(i, flash);
          p.mesh.userData.fade.setX(i, fade);
          if (p.coat) p.mesh.setColorAt(i, this._c.setRGB(coat[0] * (1 - dk) * ck, coat[1] * (1 - dk) * ck, coat[2] * (1 - dk) * ck));
          else p.mesh.setColorAt(i, this._c.setRGB((1 - dk * 0.6) * ck, (1 - dk * 0.64) * ck, (1 - dk * 0.68) * ck));
        }
      }
      for (const p of rig.parts) {
        p.mesh.instanceMatrix.needsUpdate = true;
        p.mesh.userData.team.needsUpdate = true;
        p.mesh.userData.flash.needsUpdate = true;
        p.mesh.userData.fade.needsUpdate = true;
        if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      }
    }
    SH.count = si;
    SH.instanceMatrix.needsUpdate = true;
  }

  // Unit height in world units (for health bars etc.)
  heightOf(u) {
    return { villager: 2.0, hoplite: 2.25, toxotes: 2.05, hippikon: 2.75, minotaur: 3.4, hero: 3.7, cyclops: 5.0, centaur: 2.9, medusa: 2.6 }[u.type] ?? 1.8;
  }

  portraitObject(type, owner = 1) {
    const rig = this.rigs.get(type);
    const g = new THREE.Group();
    const mat = voxelMaterialFor(this.game.players[owner].color, { fog: false });
    const world = new Map();
    const V = rig.voxel;
    for (const p of rig.parts) {
      const m = new THREE.Matrix4().makeTranslation(p.joint[0] * V, p.joint[1] * V, p.joint[2] * V);
      if (p.parent) m.premultiply(world.get(p.parent));
      world.set(p.name, m);
      if (!p.portrait) continue;
      const mesh = new THREE.Mesh(p.geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      g.add(mesh);
    }
    return g;
  }
}

export { UNIT_DEFS };
