import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';

// Unit rigs: each unit type is a list of voxel parts with a joint position
// (in voxels, relative to the parent part's joint, or to the unit origin at
// the feet) and an optional parent. Parts are meshed with their pivot at the
// joint so animation is a rotation about the origin. Facing is +z, +x is the
// unit's left. Parents must be listed before their children.
//
// Optional part fields (read by the renderer in index.js):
//   show(u)   -> false hides the part for that unit (tools, carried goods)
//   coat      -> part takes the per-unit coat tint (horse colour variation)
//   portrait  -> false keeps the part out of HUD portraits

// ---- palette ---------------------------------------------------------------
// sun-tanned skin, kept warmer/redder than the bronze so arms and faces
// separate from the armour at RTS zoom
const SKIN = (x, y, z) => (hash3(x, y, z, 3) < 0.5 ? 0xd4916a : 0xc98763);
const SKIN_SHADE = 0xa9704f;
const HAIR = 0x3a2517;
const BEARD = 0x4a2f1c;
const DARK = 0x1c1410;
const EYE_WHITE = 0xf0e8dc;
const LEATHER = 0x6e4526;
const LEATHER_DK = 0x4c2e18;
const BELT = 0x55361e;
const SANDAL = 0x5e3b20;
const WOOD = 0x7d5431;
const WOOD_DK = 0x5b3c22;
const BRONZE = (x, y, z) => { const h = hash3(x, y, z, 2); return h < 0.45 ? 0xcf9f3a : h < 0.8 ? 0xb58a2e : 0xe6bd55; };
const BRONZE_DK = 0x7e5a20;
const STEEL = (x, y, z) => (hash3(x, y, z, 5) < 0.5 ? 0xc9ced3 : 0xb4bac0);
const LINEN = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0xece2c8 : 0xe0d4b6);
const STRAW = (x, y, z) => (hash3(x, y, z, 8) < 0.5 ? 0xdcbb6a : 0xc9a655);
const TEAM_TRIM = 0xeee6cc;
const GOLD = (x, y, z) => { const h = hash3(x, y, z, 31); return h < 0.45 ? 0xf2c648 : h < 0.8 ? 0xe0ae30 : 0xffdc70; };
const GOLD_DK = 0x9c6e1c;
const SHIELD_FACE = (x, y, z) => (hash3(x, y, z, 15) < 0.6 ? 0xe9dfc6 : 0xddd1b4);

const part = (name, model, pivot, joint, parent = null, extra = {}) => ({ name, model, pivot, joint, parent, ...extra });

// ---- humans (voxel 0.075, ~22 voxels tall) ---------------------------------
// Root: legs hang from the hips at y=10, shins from the knees. The torso sits
// on the hips; head and arms hang from the torso so leaning carries them.

function thigh(style) {
  const m = new VoxelModel();
  const c = style === 'hoplite' ? SKIN : style === 'archer' ? 0xd9c9a4 : SKIN;
  m.box(0, 0, 0, 2, 6, 2, c);
  return m;
}

function shin(style) {
  const m = new VoxelModel();
  m.box(0, 1, 0, 2, 5, 2, SKIN);
  if (style === 'hoplite') {
    m.box(0, 1, 1, 2, 5, 1, BRONZE).box(0, 2, 0, 2, 3, 1, BRONZE); // greaves
    m.box(0, 0, 0, 2, 1, 3, SANDAL);
  } else if (style === 'archer') {
    m.box(0, 0, 0, 2, 3, 2, LEATHER).box(0, 0, 2, 2, 1, 1, LEATHER_DK).box(0, 3, 0, 2, 1, 2, LEATHER_DK); // boots
  } else {
    m.box(0, 0, 0, 2, 1, 3, SANDAL).set(0, 1, 1, SANDAL).set(1, 2, 1, SANDAL);
  }
  return m;
}

function legs(style) {
  const t = thigh(style), s = shin(style);
  return [
    part('legL', t, [1, 6, 1], [1.2, 12, 0]),
    part('shinL', s, [1, 6, 1], [0, -6, 0], 'legL'),
    part('legR', t, [1, 6, 1], [-1.2, 12, 0]),
    part('shinR', s, [1, 6, 1], [0, -6, 0], 'legR'),
  ];
}

// Torso model: x 0..7 (8 wide), z 0..3, hips at y=0, shoulders at y=8.
function torsoModel(style) {
  const m = new VoxelModel();
  // Team colour is kept to the skirt, trim and small accents so the figure
  // (face, shoulders, weapon arm) reads in silhouette, not as a team block.
  const CLOTH = style === 'villager' ? TEAM : LINEN;
  // chest + waist silhouette (broad shoulders, narrow waist)
  m.box(1, 0, 0, 6, 3, 4, CLOTH);
  m.box(0, 3, 0, 8, 5, 4, CLOTH);
  m.box(1, 8, 1, 6, 1, 2, CLOTH);              // trapezius
  m.box(3, 8, 1, 2, 1, 2, SKIN);               // neck
  m.box(3, 9, 1, 2, 1, 2, SKIN);
  // skirt flaring over the thighs
  m.box(1, -1, 0, 6, 1, 4, TEAM);
  m.box(0, -3, -1, 8, 2, 6, TEAM);
  m.box(1, 0, 0, 6, 1, 4, BELT);
  if (style === 'hoplite' || style === 'rider' || style === 'hero') {
    // muscle cuirass (bronze; gold for the hero) with pectoral and abdominal lines
    const MET = style === 'hero' ? GOLD : BRONZE, MET_DK = style === 'hero' ? GOLD_DK : BRONZE_DK;
    m.box(0, 2, 0, 8, 6, 4, MET);
    m.box(1, 1, 0, 6, 1, 4, MET);
    m.box(1, 5, 4, 2, 2, 1, MET).box(5, 5, 4, 2, 2, 1, MET);  // pecs
    m.set(3, 4, 4, MET_DK).set(4, 4, 4, MET_DK).set(3, 2, 4, MET_DK).set(4, 2, 4, MET_DK);
    m.box(0, 7, 0, 2, 1, 4, LEATHER).box(6, 7, 0, 2, 1, 4, LEATHER); // linothorax shoulder flaps
    m.box(0, 7, 4, 2, 1, 1, LINEN).box(6, 7, 4, 2, 1, 1, LINEN);
    // pteryges: leather strips alternating with team linen
    // team chiton skirt showing under leather pteryges strips
    for (let x = 0; x < 8; x++) for (const z of [-1, 4]) m.box(x, -4, z, 1, 4, 1, x % 3 === 1 ? LEATHER : TEAM);
    for (let z = 0; z < 4; z++) { m.box(-1, -4, z, 1, 4, 1, z % 3 === 1 ? LEATHER : TEAM); m.box(8, -4, z, 1, 4, 1, z % 3 === 1 ? LEATHER : TEAM); }
    m.box(0, 0, 0, 8, 1, 4, BRONZE_DK);
    if (style === 'rider') {
      // short chlamys knotted at the right shoulder, a narrow fold down the back
      m.box(1, 5, -1, 6, 3, 1, TEAM).box(2, 3, -2, 4, 2, 1, TEAM);
      m.set(1, 7, 4, BRONZE(1, 7, 4));
    } else {
      // Team colour where the RTS camera sees it: a mantle over both shoulders
      // and a cloak down the back to the knees (the near army shows its back).
      const long = style === 'hero';
      m.box(0, 8, -1, 8, 1, 3, TEAM);                                      // mantle over the shoulders
      m.box(1, 1, -1, 6, 7, 1, TEAM);                                      // cloak hanging down the back
      // skirt of the cloak in vertical folds (alternating depth catches AO)
      const bot = long ? -8 : -4;
      for (let x = long ? -1 : 0; x <= (long ? 8 : 7); x++) {
        const deep = x % 2 === 0;
        m.box(x, bot, deep ? -2 : -3, 1, 2 - bot, 1, TEAM);
        m.set(x, bot - 1, deep ? -2 : -3, long ? GOLD(x, bot, 0) : TEAM_TRIM);
      }
      if (long) for (let y = bot; y <= 8; y += 2) { m.set(-1, Math.min(y, 1), -2, GOLD(0, y, 1)); m.set(8, Math.min(y, 1), -2, GOLD(1, y, 1)); m.set(1, y, -1, GOLD(2, y, 1)); m.set(6, y, -1, GOLD(3, y, 1)); }
      m.set(0, 8, 4, MET(0, 8, 4)).set(7, 8, 4, MET(7, 8, 4));             // brooches
      m.set(3, 0, 4, MET(3, 0, 4)).set(4, 0, 4, MET(4, 0, 4));
    }
  } else if (style === 'archer') {
    // team chiton over the whole chest, a leather shoulder cape over it
    m.box(0, 0, 0, 8, 8, 4, TEAM).box(1, 8, 1, 6, 1, 2, TEAM);
    m.box(-1, 6, -1, 10, 2, 6, TEAM).box(0, 8, 0, 8, 1, 4, TEAM);
    m.box(1, 0, 0, 6, 1, 4, BELT);
    m.box(0, -3, -1, 8, 1, 6, LINEN).box(1, -1, 0, 6, 1, 4, LINEN); // chiton hem under the team skirt band
    m.line(7, 7, 4, 1, 1, 4, LEATHER_DK);           // baldric
    m.line(7, 7, -1, 1, 1, -1, LEATHER_DK);
    // quiver on the back, arrows showing over the right shoulder
    m.box(0, 1, -2, 3, 8, 2, LEATHER_DK).box(0, 2, -2, 3, 1, 2, TEAM).box(0, 7, -2, 3, 1, 2, TEAM);
    for (let i = 0; i < 3; i++) { m.set(i, 9, -2 + (i % 2), WOOD); m.set(i, 10, -2 + (i % 2), 0xf4f0e8); m.set(i, 11, -2 + (i % 2), i === 1 ? TEAM : 0xf4f0e8); }
  } else {
    // villager: exomis leaving the right shoulder bare, rope belt
    m.box(0, 5, 0, 3, 3, 4, SKIN);
    m.box(1, 3, 0, 1, 2, 4, SKIN);
    m.line(3, 7, 4, 0, 4, 4, TEAM).line(3, 7, -1, 0, 4, -1, TEAM);
    m.box(1, 0, 0, 6, 1, 4, 0xa27a45);
  }
  return m;
}

function torso(style) {
  return part('torso', torsoModel(style), [4, 0, 2], [0, 12, 0]);
}

// Head model: x 0..4, y 0..4, z 0..4, face at z=4.
function headModel(style) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 5, 5, 5, SKIN);
  m.set(1, 2, 4, EYE_WHITE).set(3, 2, 4, EYE_WHITE);
  m.set(1, 2, 5, DARK).set(3, 2, 5, DARK);         // eyes sit under the brow
  m.box(1, 3, 5, 3, 1, 1, style === 'hoplite' ? BRONZE : HAIR);  // brow
  m.set(2, 2, 5, SKIN).set(2, 1, 5, SKIN_SHADE);    // nose
  m.set(0, 2, 2, SKIN_SHADE).set(4, 2, 2, SKIN_SHADE); // ears
  if (style === 'hoplite') {
    // Chalcidian helmet: bronze bowl and cheek guards, the face left open
    m.box(-1, 3, -1, 7, 3, 7, BRONZE);             // bowl
    m.box(0, 6, 0, 5, 1, 5, BRONZE);               // rounded crown
    m.box(-1, -1, -1, 7, 4, 3, BRONZE);            // back and neck guard
    m.box(-1, 0, 2, 1, 3, 3, BRONZE).box(5, 0, 2, 1, 3, 3, BRONZE); // cheek guards
    m.set(-1, 0, 4, BRONZE_DK).set(5, 0, 4, BRONZE_DK);
    m.carve(0, 3, 5, 5, 1, 2);
    m.box(0, 4, 5, 5, 1, 1, BRONZE_DK);            // brow ridge over the eyes
    m.set(2, 3, 5, BRONZE_DK);                     // nasal
    m.box(-1, 3, -1, 7, 1, 1, BRONZE_DK);          // rim line
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 3, BEARD).set(2, -1, 6, BEARD); // beard
    // narrow horsehair crest in team colour: a brush front to back on a bronze holder
    m.box(2, 7, 0, 1, 1, 5, BRONZE_DK);
    m.box(1, 8, -2, 3, 2, 9, TEAM).box(1, 10, -1, 3, 1, 7, TEAM).box(2, 11, 0, 1, 1, 5, TEAM).box(2, 12, 1, 1, 1, 3, TEAM);
    m.box(1, 3, -3, 3, 5, 1, TEAM).box(2, 0, -4, 1, 4, 1, TEAM);  // tail falling down the back
  } else if (style === 'hero') {
    // Corinthian helmet in gold with a towering transverse-and-long team crest
    m.box(-1, 3, -1, 7, 3, 7, GOLD).box(0, 6, 0, 5, 1, 5, GOLD);
    m.box(-1, -1, -1, 7, 4, 3, GOLD);
    m.box(-1, 0, 2, 1, 3, 4, GOLD).box(5, 0, 2, 1, 3, 4, GOLD);
    m.carve(0, 3, 5, 5, 1, 2);
    m.box(0, 4, 5, 5, 1, 1, GOLD_DK).set(2, 3, 5, GOLD_DK);
    m.box(1, -1, 5, 3, 1, 1, BEARD);
    m.box(2, 7, -1, 1, 1, 7, GOLD_DK);
    m.box(0, 8, -3, 5, 3, 11, TEAM, { glow: 0.22 }).box(1, 11, -2, 3, 2, 9, TEAM, { glow: 0.22 }).box(2, 13, -1, 1, 1, 7, TEAM, { glow: 0.22 });
    m.box(1, 2, -4, 3, 6, 2, TEAM, { glow: 0.15 }).box(2, -2, -5, 1, 5, 1, TEAM, { glow: 0.15 });
    m.box(-1, 7, 2, 1, 3, 1, 0xfff4d0, { glow: 0.3 }).box(5, 7, 2, 1, 3, 1, 0xfff4d0, { glow: 0.3 }); // white plume feathers
  } else if (style === 'centaur' || style === 'medusa') {
    m.box(-1, 3, -1, 7, 3, 7, style === 'medusa' ? 0x3f6a38 : HAIR).box(0, 6, 0, 5, 1, 5, style === 'medusa' ? 0x3f6a38 : HAIR);
    m.box(-1, -2, -1, 7, 5, 2, style === 'medusa' ? 0x3f6a38 : HAIR);
    m.box(-1, 4, -1, 7, 1, 7, TEAM).carve(0, 4, 5, 5, 1, 1);            // team headband
    if (style === 'centaur') m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 3, BEARD);
    else {
      // writhing snake locks
      const SN = (x, y, z) => (hash3(x, y, z, 33) < 0.5 ? 0x5f8f3a : 0x44702c);
      for (const [x, z, dx, dz] of [[-2, 1, -1, 0], [6, 1, 1, 0], [-2, 4, -1, 1], [6, 4, 1, 1], [1, -2, 0, -1], [3, -2, 0, -1], [2, 6, 0, 0]]) {
        m.box(x, 5, z, 1, 3, 1, SN).set(x + dx, 8, z + dz, SN).set(x + dx * 2, 8, z + dz * 2, SN).set(x + dx * 2, 9, z + dz * 2, 0xa8d060);
      }
      m.set(1, 2, 5, 0xd8ff60, { glow: 0.9 }).set(3, 2, 5, 0xd8ff60, { glow: 0.9 });
    }
  } else if (style === 'archer') {
    // felt Phrygian cap in team colour, beard
    const FELT = TEAM;
    m.box(-1, 4, -1, 7, 2, 7, FELT).box(0, 6, 0, 5, 1, 5, FELT).box(1, 7, 2, 3, 1, 3, FELT).box(2, 7, 4, 1, 1, 2, TEAM).set(2, 8, 5, TEAM);
    m.box(-1, 3, -1, 7, 1, 7, TEAM).carve(0, 3, 5, 5, 1, 1).box(1, 3, 5, 3, 1, 1, TEAM);
    m.box(-1, 0, -1, 1, 3, 3, LEATHER).box(5, 0, -1, 1, 3, 3, LEATHER); // ear flaps
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 2, BEARD).set(2, -1, 5, BEARD);
    m.box(0, 0, 0, 5, 3, 1, HAIR);
  } else {
    // villager: dark hair, short beard, wide straw petasos
    m.box(0, 3, 0, 5, 2, 5, HAIR).box(0, 1, 0, 5, 2, 1, HAIR).box(0, 1, 0, 1, 2, 3, HAIR).box(4, 1, 0, 1, 2, 3, HAIR);
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 2, BEARD);
    m.set(2, 1, 5, SKIN_SHADE);
    for (let z = -2; z <= 6; z++)
      for (let x = -2; x <= 6; x++) {
        const dx = x - 2, dz = z - 2;
        if (dx * dx + dz * dz <= 17) m.set(x, 5, z, STRAW);
      }
    m.box(0, 6, 0, 5, 1, 5, STRAW).box(1, 7, 1, 3, 1, 3, STRAW);
    m.box(0, 6, 0, 5, 1, 1, 0x8a6a3a).box(0, 6, 4, 5, 1, 1, 0x8a6a3a).box(0, 6, 0, 1, 1, 5, 0x8a6a3a).box(4, 6, 0, 1, 1, 5, 0x8a6a3a);
  }
  return m;
}

function head(style, joint = [0, 10, 0.2], parent = 'torso') {
  // Heads use 80% voxels: a smaller head reads as an adult figure, not a
  // big-headed block, and gives the helmet and face finer detail.
  return part('head', headModel(style), [2.5, 0, 2.5], joint, parent, { scale: 0.8 });
}

// Arm model: x 0..1, y 0..6 (hand at the bottom), pivot at the shoulder.
function armModel(style, side) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 2, 2, 2, SKIN);                    // hand
  m.box(0, 2, 0, 2, 3, 2, SKIN);                    // forearm
  m.box(0, 5, 0, 2, 2, 2, style === 'villager' ? (side === 'R' ? SKIN : TEAM) : SKIN);
  if (style !== 'villager') m.box(0, 6, 0, 2, 1, 2, LINEN);   // chiton sleeve
  if (style === 'hoplite') m.box(0, 2, 0, 2, 2, 2, LEATHER);   // bracer
  if (style === 'archer') m.box(0, 2, 0, 2, 2, 2, side === 'L' ? LEATHER : SKIN);
  m.set(side === 'L' ? 0 : 1, 1, 2, SKIN_SHADE);    // thumb
  return m;
}

function arms(style, y = 8) {
  return [
    part('armL', armModel(style, 'L'), [1, 7, 1], [5.5, y, 0], 'torso'),
    part('armR', armModel(style, 'R'), [1, 7, 1], [-5.5, y, 0], 'torso'),
  ];
}
const HAND = [0, -6, 0];

// ---- hand-held gear --------------------------------------------------------
// Weapons are built along +y with the grip at the origin; the animation
// rotates them relative to the hand.
function spearModel(len = 30) {
  const m = new VoxelModel();
  m.box(0, -9, 0, 1, len, 1, (x, y, z) => (y % 5 === 0 ? WOOD_DK : WOOD));
  const t = len - 9;
  m.box(0, t, 0, 1, 5, 1, STEEL).box(-1, t + 1, 0, 3, 2, 1, STEEL).set(0, t + 5, 0, STEEL);
  m.box(0, -11, 0, 1, 2, 1, BRONZE).set(0, -1, 0, LEATHER).set(0, 0, 0, LEATHER).set(0, 1, 0, LEATHER);
  return m;
}

function aspis(r = 6, RIM = BRONZE) {
  const m = new VoxelModel();
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > r + 0.3) continue;
      const rim = d > r - 1.2;
      // team-coloured face (the biggest flat area on a hoplite), a pale
      // lambda chevron and a bronze boss
      let c = rim ? RIM(x, y, 0) : TEAM;
      if (!rim && d < 1.3) c = RIM(x, y, 1);
      else if (!rim && y <= 2 && y >= -4 && Math.abs(Math.abs(x) - (2 - y) * 0.6) < 0.6) c = SHIELD_FACE(x, y, 1);
      m.set(x, y, 1, c);
      if (!rim) m.set(x, y, 0, WOOD);
      if (rim) m.set(x, y, 0, RIM === GOLD ? GOLD_DK : BRONZE_DK);
    }
  m.set(0, 0, 2, RIM(0, 0, 2));
  m.box(0, -1, -1, 1, 3, 1, LEATHER); // grip
  return m;
}

function bowModel() {
  const m = new VoxelModel();
  // a deep recurve arc, read as a bow from any angle
  for (let y = -12; y <= 12; y++) {
    const z = Math.round(4 - (y * y) / 30 + (Math.abs(y) > 10 ? 1.2 : 0));
    const c = Math.abs(y) < 2 ? LEATHER : Math.abs(y) > 10 ? 0x3a2414 : WOOD_DK;
    m.set(0, y, z, c).set(1, y, z, c);
  }
  m.box(0, -11, 0, 1, 23, 1, 0xf1ead8); // string
  return m;
}

function arrowModel() {
  const m = new VoxelModel();
  m.box(0, 0, -2, 1, 1, 14, WOOD);
  m.set(0, 0, 12, STEEL).set(0, 0, 13, STEEL);
  m.box(0, 0, -3, 1, 1, 3, 0xf4f0e8).set(0, 1, -2, TEAM).set(0, -1, -2, TEAM);
  return m;
}

// Villager tools are built along +z (they point forward when the arm hangs).
function axeModel() {
  const m = new VoxelModel();
  m.box(0, 0, -1, 1, 1, 10, WOOD);
  m.box(0, 0, 7, 1, 3, 2, STEEL).box(0, -1, 8, 1, 5, 1, STEEL).set(0, 0, 6, WOOD_DK);
  return m;
}
function pickModel() {
  const m = new VoxelModel();
  m.box(0, 0, -1, 1, 1, 10, WOOD);
  m.box(0, -3, 8, 1, 7, 1, STEEL).set(0, 4, 8, STEEL).set(0, -4, 8, STEEL).box(0, 0, 9, 1, 1, 1, STEEL);
  return m;
}
function hammerModel() {
  const m = new VoxelModel();
  m.box(0, 0, -1, 1, 1, 7, WOOD);
  m.box(-1, -1, 5, 3, 3, 2, 0x8c8e90);
  return m;
}
function sickleModel() {
  const m = new VoxelModel();
  m.box(0, 0, -1, 1, 1, 4, WOOD);
  m.line(0, 0, 3, 0, 2, 6, STEEL).line(0, 2, 6, 0, 3, 8, STEEL).line(0, 3, 8, 0, 1, 10, STEEL);
  return m;
}

// ---- carried goods (on the villager's torso) --------------------------------
function logsModel() {
  const m = new VoxelModel();
  const BARK = (x, y, z) => (hash3(x, y, z, 9) < 0.5 ? 0x6b4428 : 0x5a3820);
  for (const [x, y] of [[0, 0], [2, 0], [1, 2]]) {
    m.box(x, y, 0, 2, 2, 12, BARK);
    m.box(x, y, 12, 2, 2, 1, 0xc9a26a).box(x, y, -1, 2, 2, 1, 0xc9a26a);
  }
  return m;
}
function basketModel(fill) {
  const m = new VoxelModel();
  const WICKER = (x, y, z) => ((x + y + z) % 2 ? 0xa57a3e : 0x8a6330);
  m.box(0, 0, 0, 6, 4, 4, WICKER).carve(1, 1, 1, 4, 3, 2);
  if (fill === 'gold') {
    const G = (x, y, z) => (hash3(x, y, z, 11) < 0.5 ? 0xf2c230 : 0xd9a520);
    m.box(1, 3, 1, 4, 1, 2, G, { glow: 0.12 }).box(2, 4, 1, 2, 1, 2, G, { glow: 0.12 }).set(1, 4, 2, 0xf6d24a, { glow: 0.2 });
  } else {
    const B = (x, y, z) => (hash3(x, y, z, 12) < 0.5 ? 0xc0282e : 0x8c1a2a);
    m.box(1, 3, 1, 4, 1, 2, B).box(2, 4, 1, 2, 1, 2, B).set(4, 4, 1, 0x3f7a2c).set(1, 4, 2, 0x3f7a2c);
  }
  m.box(0, 4, 0, 1, 3, 1, LEATHER).box(5, 4, 0, 1, 3, 1, LEATHER); // straps
  return m;
}

const gatherType = (u) => u.econ?.resType;
const showTool = (kind) => (u) => {
  const st = u.anim.state;
  if (kind === 'hammer') return st === 'build';
  if (st !== 'gather' && !(st === 'walk' && u.order?.type === 'gather' && !u.carry?.amount)) return false;
  const t = gatherType(u);
  return kind === 'axe' ? t === 'wood' : kind === 'pick' ? t === 'gold' : t === 'food';
};
const showCarry = (kind) => (u) => u.carry?.amount > 0 && u.carry.type === kind;

export function villagerRig() {
  return [
    ...legs('villager'), torso('villager'), head('villager'), ...arms('villager'),
    part('toolAxe', axeModel(), [0, 0, 0], HAND, 'armR', { show: showTool('axe') }),
    part('toolPick', pickModel(), [0, 0, 0], HAND, 'armR', { show: showTool('pick') }),
    part('toolSickle', sickleModel(), [0, 0, 0], HAND, 'armR', { show: showTool('food') }),
    part('toolHammer', hammerModel(), [0, 0, 0], HAND, 'armR', { show: showTool('hammer') }),
    part('carryWood', logsModel(), [2, 0, 6], [-2.5, 8.5, 0], 'torso', { show: showCarry('wood'), portrait: false }),
    part('carryGold', basketModel('gold'), [3, 0, 4], [0, 1, -2], 'torso', { show: showCarry('gold'), portrait: false }),
    part('carryFood', basketModel('food'), [3, 0, 4], [0, 1, -2], 'torso', { show: showCarry('food'), portrait: false }),
  ];
}

export function hopliteRig() {
  return [
    ...legs('hoplite'), torso('hoplite'), head('hoplite'), ...arms('hoplite'),
    part('weapon', spearModel(40), [0, 0, 0], HAND, 'armR'),
    part('shield', aspis(7), [0, 0, 0], [1.5, -4, 3], 'armL'),
  ];
}

export function toxotesRig() {
  return [
    ...legs('archer'), torso('archer'), head('archer'), ...arms('archer'),
    part('weapon', bowModel(), [0, 0, 0], HAND, 'armL'),
    part('arrow', arrowModel(), [0, 0, 0], HAND, 'armR', { show: (u) => u.anim.state === 'attack' && u.anim.attackT > 0.45, portrait: false }),
  ];
}

// ---- cavalry (voxel 0.075) ---------------------------------------------------
// A dappled grey horse under a team caparison, with a bronze-armoured rider.
// Horse legs are two-segment (upper + cannon) so the gallop can fold them.
const COAT = (x, y, z) => { const h = hash3(x, y, z, 12); return h < 0.55 ? 0xe4ded2 : h < 0.85 ? 0xd2cbbd : 0xbdb5a6; };
const MANE = (x, y, z) => (hash3(x, y, z, 13) < 0.5 ? 0x6c655c : 0x57514a);
const HOOF = 0x2e2621;
const MUZZLE = 0x6f675f;

function horseBody() {
  // barrel 7 wide: belly at y~0, back at y~8, rump at z~0, chest at z~21
  const m = new VoxelModel();
  m.ellipsoid(3, 4.5, 10.5, 3.3, 4.6, 9.8, COAT);
  m.ellipsoid(3, 5, 3.5, 3.5, 4.6, 4, COAT);       // rump / quarters
  m.ellipsoid(3, 4, 17.5, 3.1, 4.4, 3.8, COAT);    // chest
  m.ellipsoid(3, 7.5, 2.5, 2.4, 1.5, 3, COAT);     // croup
  m.box(1, 1, 1, 5, 4, 4, COAT);
  m.box(1, 0, 16, 5, 4, 4, COAT);
  for (let z = 8; z < 14; z++) m.carve(0, -2, z, 7, 2 + (z > 9 && z < 12 ? 1 : 0), 1); // belly tuck
  return m;
}

function horseBarding() {
  // caparison: team cloth over the back and flanks with a light hem, saddle on top
  const m = new VoxelModel();
  for (let z = 6; z <= 15; z++) {
    m.box(-1, 2, z, 1, 7, 1, TEAM).box(7, 2, z, 1, 7, 1, TEAM);
    m.box(0, 9, z, 7, 1, 1, TEAM);
    m.set(-1, 1, z, TEAM_TRIM).set(7, 1, z, TEAM_TRIM);
    if (z === 6 || z === 15) m.box(-1, 2, z, 1, 7, 1, TEAM_TRIM).box(7, 2, z, 1, 7, 1, TEAM_TRIM);
  }
  for (let z = 7; z <= 14; z += 3) { m.set(-2, 4, z, BRONZE(0, z, 1)); m.set(8, 4, z, BRONZE(0, z, 2)); } // studs
  m.box(1, 10, 8, 5, 1, 6, LEATHER).box(2, 11, 7, 3, 1, 1, LEATHER_DK).box(2, 11, 14, 3, 1, 1, LEATHER_DK); // saddle
  // breast strap and crupper
  for (let x = 0; x <= 6; x++) m.set(x, 6, 21, LEATHER_DK);
  for (let z = 0; z <= 5; z++) m.set(3, 9, z, LEATHER_DK);
  return m;
}

// Fill voxels within a tapered capsule between two (y, z) points, x in [x0, x0 + w).
function capsuleYZ(m, x0, w, y0, z0, r0, y1, z1, r1, color) {
  const dy = y1 - y0, dz = z1 - z0, L2 = dy * dy + dz * dz || 1;
  const rmax = Math.max(r0, r1);
  for (let y = Math.floor(Math.min(y0, y1) - rmax); y <= Math.ceil(Math.max(y0, y1) + rmax); y++)
    for (let z = Math.floor(Math.min(z0, z1) - rmax); z <= Math.ceil(Math.max(z0, z1) + rmax); z++) {
      const cy = y + 0.5, cz = z + 0.5;
      const t = Math.max(0, Math.min(1, ((cy - y0) * dy + (cz - z0) * dz) / L2));
      const ey = cy - (y0 + dy * t), ez = cz - (z0 + dz * t);
      const r = r0 + (r1 - r0) * t;
      if (ey * ey + ez * ez <= r * r) for (let x = x0; x < x0 + w; x++) m.set(x, y, z, color);
    }
  return m;
}

function horseNeckHead() {
  // arched neck rising from the withers, long head angled down at the poll
  const m = new VoxelModel();
  const pts = [[0, 1.5, 3.2], [4, 2.6, 2.8], [8, 4.4, 2.3], [11.5, 6.4, 1.9]]; // [y, z, radius]
  for (let i = 0; i < pts.length - 1; i++) {
    const [ya, za, ra] = pts[i], [yb, zb, rb] = pts[i + 1];
    capsuleYZ(m, 0, 3, ya, za, ra, yb, zb, rb, COAT);
  }
  // head: poll (y 12, z 6.5) down-forward to the muzzle
  capsuleYZ(m, 0, 3, 12, 7, 2.2, 7.5, 12.5, 1.5, COAT);
  capsuleYZ(m, 0, 3, 11, 8, 1.6, 9, 9.5, 1.6, COAT);   // jaw
  capsuleYZ(m, 0, 3, 7.5, 12.5, 1.5, 7.2, 13.2, 1.2, MUZZLE);
  m.set(0, 7, 13, DARK).set(2, 7, 13, DARK);          // nostrils
  m.set(-1, 11, 8, DARK).set(3, 11, 8, DARK);         // eyes
  m.set(-1, 12, 8, 0x8f877c).set(3, 12, 8, 0x8f877c); // brow
  m.set(0, 14, 6, COAT).set(0, 15, 6, COAT).set(2, 14, 6, COAT).set(2, 15, 6, COAT); // ears
  m.set(0, 15, 7, 0x8f877c).set(2, 15, 7, 0x8f877c);
  // mane along the crest of the neck + forelock
  for (let y = 1; y <= 13; y++) {
    let z = -8;
    while (z < 12 && !m.has(1, y, z)) z++;
    if (z >= 12) continue;
    m.set(1, y, z - 1, MANE).set(1, y, z, MANE);
    if (y % 2 === 0) m.set(1, y, z - 2, MANE);
  }
  m.set(1, 14, 7, MANE).set(1, 13, 8, MANE);
  // bridle in team colour + bronze cheek discs, reins back to the rider
  m.line(-1, 12, 7, -1, 8, 11, TEAM).line(3, 12, 7, 3, 8, 11, TEAM);
  m.box(0, 13, 7, 3, 1, 1, TEAM).box(-1, 8, 12, 5, 1, 1, TEAM);
  m.set(-1, 9, 10, BRONZE(1, 1, 1)).set(3, 9, 10, BRONZE(2, 1, 1));
  m.line(-1, 8, 11, -1, 4, 0, LEATHER_DK).line(3, 8, 11, 3, 4, 0, LEATHER_DK);
  return m;
}

function horseUpper(hind) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 2, 5, hind ? 3 : 2, COAT);
  m.box(0, 3, 0, 2, 2, hind ? 4 : 3, COAT);
  if (hind) m.box(0, 2, -1, 2, 3, 1, COAT);
  return m;
}
function horseLower() {
  const m = new VoxelModel();
  m.box(0, 2, 0, 2, 5, 2, COAT);
  m.box(0, 1, 0, 2, 1, 2, 0xf2eee6);                  // white sock / fetlock
  m.box(0, 0, 0, 2, 1, 3, HOOF);
  return m;
}
function horseTail() {
  const m = new VoxelModel();
  m.box(0, -1, -1, 2, 2, 2, MANE);
  m.box(0, -4, -2, 2, 3, 2, MANE).box(0, -8, -3, 2, 4, 2, MANE).box(0, -10, -3, 2, 2, 1, MANE);
  return m;
}

function riderTorso() {
  const m = torsoModel('rider');
  m.carve(-2, -4, -3, 12, 3, 10);                     // skirt folds over the saddle
  return m;
}
function riderLegs() {
  // thighs over the saddle, shins down the flanks, greaves and sandals
  const m = new VoxelModel();
  for (const x of [-2, 7]) {
    m.box(x, 11, 9, 2, 2, 5, SKIN);
    m.box(x + (x < 0 ? -1 : 1), 5, 12, 2, 6, 2, SKIN);
    m.box(x + (x < 0 ? -1 : 1), 5, 13, 2, 5, 1, BRONZE);
    m.box(x + (x < 0 ? -1 : 1), 4, 12, 2, 1, 3, SANDAL);
  }
  return m;
}

function smallShield() {
  const m = aspis(4);
  return m;
}

export function hippikonRig() {
  const coat = { coat: true };
  return [
    part('body', horseBody(), [3, 0, 10.5], [0, 10, 0], null, coat),
    part('barding', horseBarding(), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('riderLegs', riderLegs(), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('neck', horseNeckHead(), [1.5, 0, 2], [0, 5.5, 8], 'body', coat),
    part('tail', horseTail(), [1, 0, 0], [0, 7, -10], 'body', coat),
    part('legFL', horseUpper(false), [1, 5, 1], [2, 1, 7], 'body', coat),
    part('cannonFL', horseLower(), [1, 7, 1], [0, -4, 0], 'legFL', coat),
    part('legFR', horseUpper(false), [1, 5, 1], [-2, 1, 7], 'body', coat),
    part('cannonFR', horseLower(), [1, 7, 1], [0, -4, 0], 'legFR', coat),
    part('legBL', horseUpper(true), [1, 5, 1.5], [2, 1, -6.5], 'body', coat),
    part('cannonBL', horseLower(), [1, 7, 1], [0, -4, 0], 'legBL', coat),
    part('legBR', horseUpper(true), [1, 5, 1.5], [-2, 1, -6.5], 'body', coat),
    part('cannonBR', horseLower(), [1, 7, 1], [0, -4, 0], 'legBR', coat),
    part('torso', riderTorso(), [4, 0, 2], [0, 10, 0.5], 'body'),
    head('hoplite'),
    ...arms('hoplite'),
    part('weapon', spearModel(30), [0, 0, 0], HAND, 'armR'),
    part('shield', smallShield(), [0, 0, 0], [1.5, -4, 1.5], 'armL'),
  ];
}

// ---- minotaur (voxel 0.1) ---------------------------------------------------
const FUR = (x, y, z) => { const h = hash3(x, y, z, 21); return h < 0.5 ? 0x8a5433 : h < 0.85 ? 0x7a482b : 0x98603b; };
const FUR_DK = 0x4a2a18;
const FUR_LT = (x, y, z) => (hash3(x, y, z, 22) < 0.5 ? 0xb07c55 : 0xa27049);
const HORN = (x, y, z) => (y > 7 ? 0xf2ead4 : 0xd9ccaa);

export function minotaurRig() {
  const thighM = new VoxelModel().box(0, 0, 0, 4, 6, 4, FUR).box(0, 4, -1, 4, 2, 1, FUR);
  const shinM = new VoxelModel().box(0, 2, 0, 3, 5, 3, FUR).box(0, 0, 0, 3, 2, 4, 0x2b1d14).set(1, 0, 4, 0x2b1d14);
  const body = new VoxelModel();
  body.box(1, 0, 0, 8, 4, 5, FUR);                // waist
  body.box(0, 4, -1, 10, 7, 7, FUR);               // chest
  body.box(-1, 9, 0, 12, 3, 5, FUR);               // shoulders
  body.box(1, 7, 6, 3, 3, 1, FUR_LT).box(6, 7, 6, 3, 3, 1, FUR_LT); // pecs
  body.box(3, 2, 5, 4, 4, 1, FUR_LT).set(4, 3, 5, FUR_DK).set(5, 5, 5, FUR_DK);
  body.box(2, 12, 0, 6, 2, 5, FUR);               // hump / neck
  // loincloth, belt with bronze plates, team kilt
  body.box(0, -3, -1, 10, 3, 7, TEAM).box(1, 0, -1, 8, 1, 7, BELT);
  body.box(3, -5, 5, 4, 3, 1, TEAM).box(3, -5, -1, 4, 2, 1, TEAM);
  for (let x = 1; x <= 8; x += 2) body.set(x, 0, 6, BRONZE(x, 0, 6));
  // strap across the chest
  body.line(0, 11, 6, 9, 3, 6, LEATHER_DK).line(0, 11, -1, 9, 3, -1, LEATHER_DK);
  const headM = new VoxelModel();
  headM.box(0, 0, 0, 6, 6, 5, FUR);
  headM.box(1, 0, 5, 4, 3, 3, 0x3a2418).box(1, 3, 5, 4, 1, 1, FUR);      // snout
  headM.set(1, 1, 8, DARK).set(4, 1, 8, DARK);                              // nostrils
  headM.set(2, -1, 8, BRONZE(0, 0, 0)).set(3, -1, 8, BRONZE(1, 0, 0)).set(2, 0, 8, BRONZE(0, 1, 0)).set(3, 0, 8, BRONZE(1, 1, 0)); // nose ring
  headM.set(1, 4, 5, 0xff5020, { glow: 0.9 }).set(4, 4, 5, 0xff5020, { glow: 0.9 });
  headM.box(1, 5, 5, 4, 1, 1, FUR_DK);                                      // brow
  headM.box(1, 6, 1, 4, 1, 3, FUR_DK);                                      // forelock
  // curved horns
  for (const s of [-1, 1]) {
    const bx = s < 0 ? -1 : 6;
    headM.box(bx, 4, 2, 1, 2, 2, HORN).box(bx + s, 5, 2, 1, 2, 2, HORN).box(bx + 2 * s, 6, 2, 1, 2, 1, HORN)
      .set(bx + 3 * s, 7, 2, HORN).set(bx + 3 * s, 8, 3, HORN).set(bx + 3 * s, 9, 3, HORN);
    headM.box(s < 0 ? -1 : 6, 2, 1, 1, 2, 2, FUR_DK); // ears
  }
  const upperArm = new VoxelModel().box(0, 0, 0, 4, 9, 4, FUR).box(0, 5, 0, 4, 2, 4, BRONZE).box(0, 0, 0, 4, 3, 4, LEATHER);
  upperArm.box(0, -2, 0, 4, 2, 4, 0x5c3520);
  // labrys: double-headed bronze axe
  const axe = new VoxelModel();
  axe.box(0, -4, 0, 1, 24, 1, WOOD_DK);
  for (let dy = 0; dy < 7; dy++) {
    const w = 2 + Math.round(Math.abs(dy - 3) * 0.9);
    axe.box(0, 13 + dy, 1, 1, 1, w, BRONZE).box(0, 13 + dy, -w, 1, 1, w, BRONZE);
  }
  axe.box(0, 12, -1, 1, 9, 3, BRONZE_DK).set(0, 20, 0, BRONZE(0, 0, 0));
  return [
    part('legL', thighM, [2, 6, 2], [2.5, 12, 0]),
    part('shinL', shinM, [1.5, 7, 1.5], [0, -5, 0.5], 'legL'),
    part('legR', thighM, [2, 6, 2], [-2.5, 12, 0]),
    part('shinR', shinM, [1.5, 7, 1.5], [0, -5, 0.5], 'legR'),
    part('torso', body, [5, 0, 2.5], [0, 12, 0]),
    part('head', headM, [3, 0, 2], [0, 13, 2.5], 'torso'),
    part('armL', upperArm, [2, 9, 2], [7.5, 12, 0], 'torso'),
    part('armR', upperArm, [2, 9, 2], [-7.5, 12, 0], 'torso'),
    part('weapon', axe, [0, 0, 0], [0, -11, 0], 'armR'),
  ];
}

// ---- hero: Achilles (voxel 0.095, ~1.35x a hoplite) --------------------------
// Gold cuirass and Corinthian helmet, a towering glowing team crest, a long
// team cloak and a big gold-rimmed team shield: the brightest figure on the field.
export function heroRig() {
  return [
    ...legs('hoplite'), torso('hero'), head('hero'), ...arms('hoplite'),
    part('weapon', spearModel(38), [0, 0, 0], HAND, 'armR'),
    part('shield', aspis(7, GOLD), [0, 0, 0], [1.5, -4, 3], 'armL'),
  ];
}

// ---- cyclops (voxel 0.15): a one-eyed giant with a tree-trunk club ----------
const CY_SKIN = (x, y, z) => { const h = hash3(x, y, z, 41); return h < 0.5 ? 0xd9a88a : h < 0.85 ? 0xcc9a7c : 0xe2b496; };
const CY_SHADE = 0xa9765c;

export function cyclopsRig() {
  const thighM = new VoxelModel().box(0, 0, 0, 4, 6, 4, CY_SKIN).box(-1, 2, -1, 6, 4, 6, TEAM);   // team kilt hem over the thighs
  const shinM = new VoxelModel().box(0, 2, 0, 3, 5, 3, CY_SKIN).box(0, 0, 0, 3, 2, 4, LEATHER_DK).box(0, 2, 0, 3, 1, 3, LEATHER);
  const body = new VoxelModel();
  body.box(1, 0, 0, 8, 4, 5, CY_SKIN);                 // belly
  body.box(0, 4, -1, 10, 7, 7, CY_SKIN);               // chest
  body.box(-1, 9, -1, 12, 3, 7, CY_SKIN);              // huge shoulders
  body.box(1, 7, 6, 3, 3, 1, CY_SHADE).box(6, 7, 6, 3, 3, 1, CY_SHADE);
  body.box(2, 1, 5, 6, 3, 1, CY_SKIN).set(5, 2, 6, CY_SHADE);
  // team: a pelt over the back and left shoulder, and a deep kilt
  body.box(7, 9, -2, 5, 4, 9, TEAM).box(8, 12, -1, 3, 1, 7, TEAM);           // pelt over the left shoulder
  for (let i = 0; i <= 9; i++) { body.box(8 - i, 10 - i, 6, 2, 2, 1, TEAM); body.box(8 - i, 10 - i, -2, 2, 2, 1, TEAM); } // sash across chest and back
  body.box(0, -4, -1, 10, 4, 7, TEAM).box(1, 0, -1, 8, 1, 7, BELT);
  body.box(-1, -5, -2, 12, 1, 9, TEAM_TRIM);
  for (let x = 1; x <= 8; x += 2) body.set(x, 0, 6, BRONZE(x, 0, 6));
  body.line(10, 11, 6, 1, 1, 6, LEATHER_DK);
  const headM = new VoxelModel();
  headM.box(0, 0, 0, 6, 7, 6, CY_SKIN);
  headM.box(0, 5, 6, 6, 1, 1, CY_SHADE);                                    // heavy brow
  headM.box(1, 3, 6, 4, 2, 1, EYE_WHITE).set(2, 3, 7, 0x2a1a10).set(3, 3, 7, 0x2a1a10).set(2, 4, 7, 0xff6a20, { glow: 0.6 }).set(3, 4, 7, 0xff6a20, { glow: 0.6 }); // the one eye
  headM.box(2, 2, 6, 2, 1, 1, CY_SHADE);                                    // nose
  headM.box(1, 0, 6, 4, 1, 1, 0x7a3a2a);                                    // mouth
  headM.box(1, 0, -1, 4, 5, 1, HAIR).box(0, 1, 0, 1, 4, 3, HAIR).box(5, 1, 0, 1, 4, 3, HAIR); // hair at back
  headM.set(-1, 3, 3, CY_SHADE).set(6, 3, 3, CY_SHADE);
  headM.box(2, 7, 2, 2, 2, 2, HORN).set(2, 9, 3, HORN);                      // stub horn
  const upperArm = new VoxelModel().box(0, 0, 0, 4, 9, 4, CY_SKIN).box(0, 0, 0, 4, 2, 4, LEATHER).box(0, 6, 0, 4, 1, 4, BRONZE);
  upperArm.box(0, -2, 0, 4, 2, 4, CY_SHADE);
  // tree-trunk club with bronze bands
  const club = new VoxelModel();
  const BARK = (x, y, z) => (hash3(x, y, z, 42) < 0.5 ? 0x6b4428 : 0x573620);
  club.box(0, -4, 0, 2, 12, 2, BARK);
  club.box(-1, 8, -1, 4, 9, 4, BARK).box(0, 17, 0, 2, 1, 2, BARK);
  club.box(-2, 11, -2, 6, 1, 6, BRONZE_DK).box(-2, 15, -2, 6, 1, 6, BRONZE_DK);
  club.set(-2, 13, 0, STEEL(0, 0, 0)).set(3, 13, 1, STEEL(0, 1, 0)).set(1, 14, -2, STEEL(1, 0, 0)).set(1, 12, 3, STEEL(1, 1, 0));
  return [
    part('legL', thighM, [2, 6, 2], [2.5, 12, 0]),
    part('shinL', shinM, [1.5, 7, 1.5], [0, -5, 0.5], 'legL'),
    part('legR', thighM, [2, 6, 2], [-2.5, 12, 0]),
    part('shinR', shinM, [1.5, 7, 1.5], [0, -5, 0.5], 'legR'),
    part('torso', body, [5, 0, 2.5], [0, 12, 0]),
    part('head', headM, [3, 0, 3], [0, 12, 2], 'torso'),
    part('armL', upperArm, [2, 9, 2], [7.5, 12, 0], 'torso'),
    part('armR', upperArm, [2, 9, 2], [-7.5, 12, 0], 'torso'),
    part('weapon', club, [1, 0, 1], [0, -11, 0], 'armR'),
  ];
}

// ---- centaur (voxel 0.08): chestnut horse body, bare-chested archer --------
const CHESTNUT = (x, y, z) => { const h = hash3(x, y, z, 51); return h < 0.55 ? 0x9a5a32 : h < 0.85 ? 0x8a4e2a : 0xa9683c; };
const recolor = (m, from, to) => { for (const v of m.vox.values()) if (!v.team && from.includes(v.c)) v.c = typeof to === 'function' ? to(0, 0, 0) : to; return m; };
const COAT_COLS = [0xe4ded2, 0xd2cbbd, 0xbdb5a6];
const chestnut = (m) => { let i = 0; for (const v of m.vox.values()) if (!v.team && COAT_COLS.includes(v.c)) v.c = [0x9a5a32, 0x8a4e2a, 0xa9683c][(i++ * 7) % 3]; return m; };

function centaurTorso() {
  const m = new VoxelModel();
  m.box(1, -3, 0, 6, 3, 4, CHESTNUT);                  // horse-to-man join
  m.box(1, 0, 0, 6, 3, 4, SKIN);
  m.box(0, 3, 0, 8, 5, 4, SKIN);
  m.box(1, 8, 1, 6, 1, 2, SKIN);
  m.box(3, 8, 1, 2, 2, 2, SKIN);
  m.box(1, 5, 4, 2, 2, 1, SKIN_SHADE).box(5, 5, 4, 2, 2, 1, SKIN_SHADE);
  // team mantle over the shoulders and a broad team sash
  m.box(-1, 6, -1, 10, 2, 6, TEAM).box(0, 8, -1, 8, 1, 5, TEAM).box(0, 2, -1, 8, 4, 1, TEAM);
  m.line(7, 7, 4, 1, 1, 4, TEAM).line(6, 7, 4, 0, 1, 4, TEAM);
  m.box(0, 0, 0, 8, 1, 4, BELT);
  // quiver
  m.box(5, 1, -2, 3, 8, 2, LEATHER_DK).box(5, 7, -2, 3, 1, 2, TEAM);
  for (let i = 0; i < 3; i++) { m.set(5 + i, 9, -2 + (i % 2), WOOD); m.set(5 + i, 10, -2 + (i % 2), 0xf4f0e8); }
  return m;
}

function centaurBlanket() {
  // a team saddle-cloth over the whole horse back: the big readable top area
  const m = new VoxelModel();
  for (let z = 0; z <= 13; z++) {
    m.box(-1, 3, z, 1, 7, 1, TEAM).box(7, 3, z, 1, 7, 1, TEAM).box(0, 10, z, 7, 1, 1, TEAM).box(0, 9, z, 7, 1, 1, TEAM);
    m.set(-1, 2, z, TEAM_TRIM).set(7, 2, z, TEAM_TRIM);
  }
  for (let z = 1; z <= 13; z += 4) { m.set(-2, 5, z, BRONZE(0, z, 1)); m.set(8, 5, z, BRONZE(0, z, 2)); }
  return m;
}

export function centaurRig() {
  return [
    part('body', chestnut(horseBody()), [3, 0, 10.5], [0, 10, 0]),
    part('barding', centaurBlanket(), [3, 0, 10.5], [0, 0, 0], 'body'),
    part('tail', recolor(horseTail(), [0x6c655c, 0x57514a], 0x3a2418), [1, 0, 0], [0, 7, -10], 'body'),
    part('legFL', chestnut(horseUpper(false)), [1, 5, 1], [2, 1, 7], 'body'),
    part('cannonFL', chestnut(horseLower()), [1, 7, 1], [0, -4, 0], 'legFL'),
    part('legFR', chestnut(horseUpper(false)), [1, 5, 1], [-2, 1, 7], 'body'),
    part('cannonFR', chestnut(horseLower()), [1, 7, 1], [0, -4, 0], 'legFR'),
    part('legBL', chestnut(horseUpper(true)), [1, 5, 1.5], [2, 1, -6.5], 'body'),
    part('cannonBL', chestnut(horseLower()), [1, 7, 1], [0, -4, 0], 'legBL'),
    part('legBR', chestnut(horseUpper(true)), [1, 5, 1.5], [-2, 1, -6.5], 'body'),
    part('cannonBR', chestnut(horseLower()), [1, 7, 1], [0, -4, 0], 'legBR'),
    part('torso', centaurTorso(), [4, 0, 2], [0, 8, 8], 'body'),
    head('centaur'),
    ...arms('archer'),
    part('weapon', bowModel(), [0, 0, 0], HAND, 'armL'),
    part('arrow', arrowModel(), [0, 0, 0], HAND, 'armR', { show: (u) => u.anim.state === 'attack' && u.anim.attackT > 0.45, portrait: false }),
  ];
}

// ---- medusa (voxel 0.08): gorgon on a coiled team-scaled serpent tail -------
const SCALE_DK = (x, y, z) => (hash3(x, y, z, 61) < 0.5 ? 0x3a4a2c : 0x2e3c24);
const BELLY = (x, y, z) => (hash3(x, y, z, 62) < 0.5 ? 0xd8c890 : 0xc8b67c);
// banded tail: team-coloured scales with dark rings, pale belly underneath
const tailCol = (y, z, r) => (y < -r * 0.45 ? BELLY : Math.floor(z / 3) % 3 === 0 ? SCALE_DK : TEAM);

function tailSeg(len, r0, r1) {
  const m = new VoxelModel();
  for (let z = 0; z < len; z++) {
    const r = r0 + (r1 - r0) * (z / len);
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++)
      for (let x = -Math.ceil(r); x <= Math.ceil(r); x++)
        if (x * x + y * y <= r * r + 0.3) { const c = tailCol(y, z, r); m.set(x, y, -z, typeof c === 'function' ? c(x, y, z) : c); }
  }
  return m;
}

function medusaCoil() {
  // a thick coil on the ground rising into the waist
  const m = new VoxelModel();
  for (let a = 0; a < 26; a++) {
    const th = (a / 26) * Math.PI * 2 * 0.85;
    const cx = Math.sin(th) * 5, cz = Math.cos(th) * 5 - 1;
    const y0 = 2.2;
    for (let y = -2; y <= 2; y++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (dx * dx + dz * dz + y * y > 6) continue;
          const c = y <= -1 ? BELLY : a % 4 === 0 ? SCALE_DK : TEAM;
          m.set(Math.round(cx + dx), Math.round(y0 + y), Math.round(cz + dz), typeof c === 'function' ? c(dx, y, a) : c);
        }
  }
  // rising column from the coil to the hips
  for (let y = 2; y <= 10; y++) {
    const r = 3 - (y - 2) * 0.15;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= r * r) m.set(x, y, z + 1, z >= 2 ? BELLY(x, y, z) : y % 3 === 0 ? SCALE_DK(x, y, z) : TEAM);
  }
  return m;
}

function medusaTorso() {
  const m = new VoxelModel();
  m.box(1, 0, 0, 6, 3, 4, SKIN);
  m.box(0, 3, 0, 8, 5, 4, SKIN);
  m.box(1, 8, 1, 6, 1, 2, SKIN).box(3, 8, 1, 2, 2, 2, SKIN);
  m.box(1, 5, 4, 2, 2, 1, BRONZE).box(5, 5, 4, 2, 2, 1, BRONZE).box(0, 4, 0, 8, 1, 5, BRONZE); // bronze breastband
  m.box(-1, 6, -1, 10, 2, 6, TEAM).box(0, 8, -1, 8, 1, 5, TEAM);  // team shawl
  m.box(0, -1, -1, 8, 2, 6, TEAM);                                // team girdle
  return m;
}

export function medusaRig() {
  return [
    part('coil', medusaCoil(), [0, 0, 0], [0, 0, 0]),
    part('tailA', tailSeg(8, 2.4, 2.0), [0, 0, 0], [-2, 2, -4], 'coil'),
    part('tailB', tailSeg(8, 2.0, 1.4), [0, 0, 0], [0, 0, -8], 'tailA'),
    part('tailC', tailSeg(8, 1.4, 0.6), [0, 0, 0], [0, 0, -8], 'tailB'),
    part('torso', medusaTorso(), [4, 0, 2], [0, 11, 1], 'coil'),
    head('medusa'),
    ...arms('archer'),
    part('weapon', bowModel(), [0, 0, 0], HAND, 'armL'),
    part('arrow', arrowModel(), [0, 0, 0], HAND, 'armR', { show: (u) => u.anim.state === 'attack' && u.anim.attackT > 0.45, portrait: false }),
  ];
}

export const RIGS = {
  villager: { build: villagerRig, voxel: 0.07, anim: 'human', style: 'villager' },
  hoplite: { build: hopliteRig, voxel: 0.07, anim: 'human', style: 'hoplite' },
  toxotes: { build: toxotesRig, voxel: 0.07, anim: 'archer', style: 'archer' },
  hippikon: { build: hippikonRig, voxel: 0.07, anim: 'horse', style: 'rider' },
  minotaur: { build: minotaurRig, voxel: 0.1, anim: 'beast', style: 'beast' },
  hero: { build: heroRig, voxel: 0.12, anim: 'human', style: 'hero' },
  cyclops: { build: cyclopsRig, voxel: 0.15, anim: 'beast', style: 'beast' },
  centaur: { build: centaurRig, voxel: 0.08, anim: 'centaur', style: 'centaur' },
  medusa: { build: medusaRig, voxel: 0.12, anim: 'medusa', style: 'medusa' },
};
