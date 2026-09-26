import * as THREE from 'three';
import { VoxelModel, TEAM, buildVoxelGeometry, makeVoxelMaterial } from '../core/voxel.js';

// Battlefield litter: dropped shields, spears (whole, broken, planted in the
// turf) and helmets lying where men fell. Instanced voxel props, lit and
// shadowed like the units. Visual only; items sink away after `life` seconds.
//   debris.drop(kind, x, z, { rot, owner, tilt, roll, life })
// kinds: 'shield' | 'spear' | 'stub' | 'helmet' | 'arrows'

const MAX = 768;
const BRONZE = 0xc08a3e, BRONZE_D = 0x8a5f2a, WOOD = 0x6e4a2a, WOOD_L = 0x9a7048;

function models() {
  const shield = new VoxelModel();
  shield.cylinder(0, 0, 0, 3.6, 1, BRONZE_D);
  shield.cylinder(0, 1, 0, 2.7, 1, TEAM);
  shield.box(-1, 1, -1, 2, 2, 2, BRONZE); // boss
  shield.box(-3, 1, 0, 1, 1, 1, BRONZE).box(2, 1, -1, 1, 1, 1, BRONZE);
  const spear = new VoxelModel();
  spear.box(0, 0, -13, 1, 1, 24, WOOD);
  spear.box(0, 0, 11, 1, 1, 4, 0xd8d0c0); // iron head
  spear.box(0, 0, -15, 1, 1, 2, BRONZE_D); // butt spike
  const stub = new VoxelModel();
  stub.box(0, 0, -6, 1, 1, 9, WOOD);
  stub.box(0, 0, 3, 1, 1, 1, WOOD_L).box(1, 0, 3, 1, 1, 1, WOOD_L); // splintered end
  const helmet = new VoxelModel();
  helmet.box(-2, 0, -2, 4, 3, 4, BRONZE);
  helmet.box(-2, 3, -1, 4, 1, 3, BRONZE);
  helmet.box(-1, 4, -3, 2, 2, 6, TEAM); // crest
  helmet.carve(-1, 0, 1, 2, 2, 1);
  const arrows = new VoxelModel(); // a spent arrow snapped in the grass
  arrows.box(0, 0, -4, 1, 1, 8, WOOD_L);
  arrows.box(0, 0, -5, 1, 1, 1, 0xe8e2d4);
  return { shield, spear, stub, helmet, arrows };
}

export class Debris {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.material = makeVoxelMaterial({ instanced: true });
    this.kinds = new Map();
    const pivot = { shield: [0, 0, 0], spear: [0, 0, 0], stub: [0, 0, 0], helmet: [0, 0, 0], arrows: [0, 0, 0] };
    for (const [k, m] of Object.entries(models())) {
      const geo = buildVoxelGeometry(m, { size: 0.1, pivot: pivot[k], jitter: 0.09, seed: 3 });
      const team = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
      geo.setAttribute('instTeam', team);
      geo.setAttribute('instFlash', flash);
      const mesh = new THREE.InstancedMesh(geo, this.material, MAX);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      game.scene.add(mesh);
      this.kinds.set(k, { mesh, team });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
    this._t = new THREE.Color();
    this.dirty = true;
  }

  drop(kind, x, z, { rot = 0, owner = 0, tilt = 0, roll = 0, lift = 0, life = 40 } = {}) {
    if (!this.kinds.has(kind)) return;
    if (this.items.length >= MAX * 2) this.items.shift();
    this.items.push({ kind, x, z, rot, owner, tilt, roll, lift, die: this.game.time + life });
    this.dirty = true;
  }

  update() {
    const now = this.game.time;
    if (this.items.length && this.items[0].die < now - 1.5) { this.items = this.items.filter((d) => d.die > now - 1.5); this.dirty = true; }
    if (this.items.some((d) => d.die < now)) this.dirty = true;
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;
    const game = this.game, now = game.time;
    const counts = new Map();
    for (const d of this.items) {
      const k = this.kinds.get(d.kind);
      const n = counts.get(d.kind) || 0;
      if (n >= MAX) continue;
      if (d.owner !== game.localPlayer && game.fog && !game.fog.isExplored(d.x, d.z)) continue;
      const sink = Math.max(0, now - d.die) * 0.12;
      this._e.set(d.tilt, d.rot, d.roll);
      this._q.setFromEuler(this._e);
      this._v.set(d.x, game.map.heightAt(d.x, d.z) + 0.02 + d.lift - sink, d.z);
      this._m.compose(this._v, this._q, this._s);
      k.mesh.setMatrixAt(n, this._m);
      this._c.setHex(d.owner ? game.players[d.owner].color : 0xd8d0c0);
      // dropped gear is dusty and trampled: the paint dulled towards the
      // grey-brown of the dead, so it never reads as a live man's colour
      if (d.owner) this._c.lerp(this._t.setRGB(0.42, 0.37, 0.31), 0.78).multiplyScalar(0.8);
      k.team.setXYZ(n, this._c.r, this._c.g, this._c.b);
      counts.set(d.kind, n + 1);
    }
    for (const [kind, k] of this.kinds) {
      k.mesh.count = counts.get(kind) || 0;
      k.mesh.instanceMatrix.needsUpdate = true;
      k.team.needsUpdate = true;
    }
  }
}
