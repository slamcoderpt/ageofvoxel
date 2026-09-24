import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';

// Unit rigs: each unit type is a list of voxel parts with a joint position
// (in voxels, relative to the parent part's joint, or to the unit origin at
// the feet) and an optional parent. Parts are meshed with their pivot at the
// joint so animation is a rotation about the origin. Facing is +z.

const SKIN = 0xe0a97c;
const SKIN_DARK = 0xc98d63;
const HAIR = 0x3b2618;
const LEG = 0xd79d72;
const SANDAL = 0x6b4526;
const BELT = 0x5a3a20;
const BRONZE = (x, y, z) => (hash3(x, y, z, 2) < 0.6 ? 0xc99a3c : 0xb3862f);
const WOOD = 0x7a5230;
const STEEL = 0xb8bec4;
const DARK = 0x221812;
const LINEN = 0xe8dcc0;

const part = (name, model, pivot, joint, parent = null) => ({ name, model, pivot, joint, parent });

function legs(skin = LEG) {
  const l = new VoxelModel().box(0, 1, 0, 2, 6, 2, skin).box(0, 0, 0, 2, 1, 2, SANDAL).box(0, 0, 2, 2, 1, 1, SANDAL);
  return [part('legL', l, [1, 7, 1], [-1, 7, 0]), part('legR', l, [1, 7, 1], [1, 7, 0])];
}

function torso(tunic = TEAM, extra) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 6, 5, 3, tunic);
  m.box(0, -2, 0, 6, 2, 3, tunic);   // skirt over the hips
  m.box(0, 0, 0, 6, 1, 3, BELT);
  m.box(1, 4, 0, 4, 1, 3, tunic);
  if (extra) extra(m);
  return part('torso', m, [3, 0, 1.5], [0, 7, 0]);
}

function head(style = 'hair', crest = TEAM) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 4, 4, 4, SKIN);
  m.set(1, 2, 3, DARK).set(2, 2, 3, DARK);        // eyes
  m.set(1, 0, 3, SKIN_DARK).set(2, 0, 3, SKIN_DARK);
  if (style === 'hair') {
    m.box(0, 3, 0, 4, 1, 4, HAIR).box(0, 1, 0, 4, 2, 1, HAIR).box(0, 2, 0, 1, 1, 3, HAIR).box(3, 2, 0, 1, 1, 3, HAIR);
    m.set(1, -1, 3, HAIR).set(2, -1, 3, HAIR);    // beard hint
  } else if (style === 'hat') {
    m.box(-1, 4, -1, 6, 1, 6, 0xd8b56a).box(1, 5, 1, 2, 1, 2, 0xc9a55a);
    m.box(0, 3, 0, 4, 1, 1, HAIR);
  } else if (style === 'helmet') {
    m.box(-0, 2, 0, 4, 3, 4, BRONZE).box(0, 0, 0, 1, 2, 4, BRONZE).box(3, 0, 0, 1, 2, 4, BRONZE).box(0, 0, 0, 4, 2, 1, BRONZE);
    m.box(1, 5, -1, 2, 2, 6, crest);              // horsehair crest
    m.set(1, 3, 3, BRONZE).set(2, 3, 3, BRONZE);
  } else if (style === 'cap') {
    m.box(0, 3, 0, 4, 2, 4, 0x8a5a32).box(0, 2, 0, 4, 1, 1, 0x8a5a32);
  }
  return part('head', m, [2, 0, 2], [0, 12, 0]);
}

function arms(sleeve = TEAM) {
  const a = new VoxelModel().box(0, 0, 0, 2, 4, 2, SKIN).box(0, 4, 0, 2, 1, 2, sleeve);
  return [part('armL', a, [1, 5, 1], [-4, 12, 0]), part('armR', a, [1, 5, 1], [4, 12, 0])];
}

function tool(kind) {
  const m = new VoxelModel();
  if (kind === 'axe') {
    m.box(0, 0, -1, 1, 1, 8, WOOD);
    m.box(0, 0, 5, 1, 3, 2, STEEL).box(0, -1, 6, 1, 1, 1, STEEL);
  } else if (kind === 'spear') {
    m.box(0, -6, 0, 1, 20, 1, WOOD);
    m.box(0, 14, 0, 1, 3, 1, STEEL).set(0, 17, 0, STEEL);
    m.set(0, -7, 0, BRONZE(0, 0, 0));
  } else if (kind === 'sword') {
    m.box(0, -1, 0, 1, 1, 2, BRONZE).box(0, 0, 0, 1, 1, 1, WOOD).box(0, 0, 1, 1, 1, 7, STEEL);
  } else if (kind === 'bigaxe') {
    m.box(0, -2, 0, 1, 16, 1, WOOD);
    m.box(0, 10, 1, 1, 5, 4, STEEL).box(0, 11, 5, 1, 3, 1, STEEL).box(0, 10, -3, 1, 4, 3, STEEL);
  }
  return m;
}

function shield() {
  const m = new VoxelModel();
  for (let y = -4; y <= 4; y++)
    for (let x = -4; x <= 4; x++) {
      const d = x * x + y * y;
      if (d > 20) continue;
      m.set(x, y, 0, d > 12 ? BRONZE(x, y, 0) : d < 3 ? BRONZE(x, y, 1) : TEAM);
      if (d <= 12) m.set(x, y, -1, WOOD);
    }
  return m;
}

function bow() {
  const m = new VoxelModel();
  for (let y = -7; y <= 7; y++) {
    const z = Math.round(2.2 - (y * y) / 22);
    m.set(0, y, z, WOOD);
  }
  m.box(0, -6, 0, 1, 13, 1, LINEN); // string
  return m;
}

export function villagerRig() {
  return [
    ...legs(), torso(TEAM), head('hat'), ...arms(TEAM),
    part('tool', tool('axe'), [0, 0, 0], [0, -4, 0], 'armR'),
    part('carry', new VoxelModel().box(0, 0, 0, 4, 3, 3, 0x8b6139), [2, 0, 1.5], [0, 9, -3.5]),
  ];
}

export function hopliteRig() {
  return [
    ...legs(), torso(TEAM, (m) => { m.box(0, 1, 0, 6, 3, 3, BRONZE); m.box(0, -2, 0, 6, 1, 3, TEAM); }),
    head('helmet'), ...arms(TEAM),
    part('weapon', tool('spear'), [0, 0, 0], [0, -4, 1], 'armR'),
    part('shield', shield(), [0, 0, 0], [-1, -3, 3], 'armL'),
  ];
}

export function toxotesRig() {
  return [
    ...legs(), torso(TEAM, (m) => { m.box(4, 1, -1, 2, 6, 1, 0x7a4a26); m.box(4, 7, -1, 1, 1, 1, 0xe8e0d0); }),
    head('cap'), ...arms(TEAM),
    part('weapon', bow(), [0, 0, 0], [0, -4, 1], 'armL'),
  ];
}

export function hippikonRig() {
  const HORSE = (x, y, z) => (hash3(x, y, z, 12) < 0.7 ? 0x8a5a36 : 0x7a4d2d);
  const body = new VoxelModel().box(0, 0, 0, 5, 5, 13, HORSE);
  body.box(0, 5, 3, 5, 1, 6, TEAM).box(-1, 2, 4, 1, 3, 4, TEAM).box(5, 2, 4, 1, 3, 4, TEAM); // saddle cloth
  body.box(2, 2, -2, 1, 3, 2, 0x2b1a10); // tail
  const neck = new VoxelModel().box(0, 0, 0, 3, 7, 3, HORSE).box(0, 5, 3, 3, 3, 4, HORSE).box(1, 2, -1, 1, 7, 1, 0x2b1a10);
  neck.set(0, 6, 5, DARK).set(2, 6, 5, DARK).box(0, 8, 1, 1, 1, 1, HORSE).box(2, 8, 1, 1, 1, 1, HORSE);
  const leg = new VoxelModel().box(0, 1, 0, 2, 8, 2, HORSE).box(0, 0, 0, 2, 1, 2, 0x2b1a10);
  const riderTorso = new VoxelModel().box(0, 0, 0, 6, 5, 3, TEAM).box(0, 1, 0, 6, 2, 3, BRONZE)
    .box(-1, -3, 0, 2, 4, 2, LEG).box(5, -3, 0, 2, 4, 2, LEG);
  return [
    part('body', body, [2.5, 0, 6.5], [0, 8, 0]),
    part('neck', neck, [1.5, 0, 1.5], [0, 11, 6]),
    part('legFL', leg, [1, 9, 1], [-1.5, 9, 5]),
    part('legFR', leg, [1, 9, 1], [1.5, 9, 5]),
    part('legBL', leg, [1, 9, 1], [-1.5, 9, -5]),
    part('legBR', leg, [1, 9, 1], [1.5, 9, -5]),
    part('torso', riderTorso, [3, 0, 1.5], [0, 14, 0]),
    { ...head('helmet'), joint: [0, 19, 0] },
    part('armL', new VoxelModel().box(0, 0, 0, 2, 4, 2, SKIN).box(0, 4, 0, 2, 1, 2, TEAM), [1, 5, 1], [-4, 19, 0]),
    part('armR', new VoxelModel().box(0, 0, 0, 2, 4, 2, SKIN).box(0, 4, 0, 2, 1, 2, TEAM), [1, 5, 1], [4, 19, 0]),
    part('weapon', tool('spear'), [0, 0, 0], [0, -4, 1], 'armR'),
  ];
}

export function minotaurRig() {
  const FUR = (x, y, z) => (hash3(x, y, z, 21) < 0.6 ? 0x6e4128 : 0x5c3520);
  const legM = new VoxelModel().box(0, 2, 0, 3, 7, 3, FUR).box(0, 0, 0, 3, 2, 4, 0x2b1d14);
  const body = new VoxelModel().box(0, 0, 0, 9, 8, 5, FUR).box(1, -2, 0, 7, 2, 5, TEAM).box(1, 0, 0, 7, 1, 5, BELT)
    .box(1, 5, 4, 7, 2, 1, 0x80503a);
  const headM = new VoxelModel().box(0, 0, 0, 5, 5, 5, FUR).box(1, 0, 5, 3, 2, 2, 0x4a2a18)
    .set(1, 3, 5, 0xff4020, { glow: 0.8 }).set(3, 3, 5, 0xff4020, { glow: 0.8 })
    .box(-2, 4, 2, 2, 1, 1, 0xeee4c8).box(-3, 5, 2, 1, 2, 1, 0xeee4c8).box(5, 4, 2, 2, 1, 1, 0xeee4c8).box(7, 5, 2, 1, 2, 1, 0xeee4c8)
    .set(2, 0, 7, 0xd8c060);
  const arm = new VoxelModel().box(0, 0, 0, 3, 7, 3, FUR).box(0, 7, 0, 3, 1, 3, 0x5c3520);
  return [
    part('legL', legM, [1.5, 9, 1.5], [-2, 9, 0]),
    part('legR', legM, [1.5, 9, 1.5], [2, 9, 0]),
    part('torso', body, [4.5, 0, 2.5], [0, 9, 0]),
    part('head', headM, [2.5, 0, 2], [0, 17, 1]),
    part('armL', arm, [1.5, 8, 1.5], [-6, 16, 0]),
    part('armR', arm, [1.5, 8, 1.5], [6, 16, 0]),
    part('weapon', tool('bigaxe'), [0, 0, 0], [0, -7, 1], 'armR'),
  ];
}

export const RIGS = {
  villager: { build: villagerRig, voxel: 0.1, anim: 'human' },
  hoplite: { build: hopliteRig, voxel: 0.1, anim: 'human' },
  toxotes: { build: toxotesRig, voxel: 0.1, anim: 'archer' },
  hippikon: { build: hippikonRig, voxel: 0.1, anim: 'horse' },
  minotaur: { build: minotaurRig, voxel: 0.13, anim: 'human' },
};
