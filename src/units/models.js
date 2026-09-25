import { VoxelModel, TEAM } from '../core/voxel.js';
import { hash3 } from '../core/rng.js';
import { gearOf } from './anim.js';

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
const BRONZE = (x, y, z) => { const h = hash3(x, y, z, 2); return h < 0.45 ? 0xdba445 : h < 0.8 ? 0xc48d36 : 0xf0c866; };
const BRONZE_DK = 0x7e5a20;
const STEEL = (x, y, z) => (hash3(x, y, z, 5) < 0.5 ? 0xc9ced3 : 0xb4bac0);
const LINEN = (x, y, z) => (hash3(x, y, z, 6) < 0.6 ? 0xece2c8 : 0xe0d4b6);
const STRAW = (x, y, z) => (hash3(x, y, z, 8) < 0.5 ? 0xdcbb6a : 0xc9a655);
const TEAM_TRIM = 0xeee6cc;
const WOOL = (x, y, z) => { const h = hash3(x, y, z, 17); return h < 0.5 ? 0xd8c7a2 : h < 0.85 ? 0xcbb892 : 0xe2d3b0; };
const GOLD = (x, y, z) => { const h = hash3(x, y, z, 31); return h < 0.45 ? 0xf2c648 : h < 0.8 ? 0xe0ae30 : 0xffdc70; };
const GOLD_DK = 0x9c6e1c;
const SHIELD_FACE = (x, y, z) => (hash3(x, y, z, 15) < 0.6 ? 0xe9dfc6 : 0xddd1b4);


const part = (name, model, pivot, joint, parent = null, extra = {}) => ({ name, model, pivot, joint, parent, ...extra });

// Team-tinted voxels on a darker base (the tint multiplies the base), for
// folds and shaded panels that still read as the owner's colour.
function tbox(m, x, y, z, w, h, d, base) {
  m.box(x, y, z, w, h, d, TEAM);
  for (let k = z; k < z + d; k++) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) m.get(i, j, k).c = base;
  return m;
}
const TEAM_SHADE = 0xb2b2b2;

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
    part('legL', t, [1, 6, 1], [1.7, 12, 0]),
    part('shinL', s, [1, 6, 1], [0, -6, 0], 'legL'),
    part('legR', t, [1, 6, 1], [-1.7, 12, 0]),
    part('shinR', s, [1, 6, 1], [0, -6, 0], 'legR'),
  ];
}

// Torso model: x 0..7 (8 wide), z 0..3, hips at y=0, shoulders at y=8.
function torsoModel(style, cloak = true) {
  const m = new VoxelModel();
  // Soldiers wear their army's colour on the whole tunic (chest, back,
  // shoulders, skirt); bronze, skin and leather frame it so the figure reads.
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
    if (style === 'hoplite' || style === 'rider') {
      // Bronze muscle cuirass over a pale linen chiton: the man himself is
      // neutral metal and cloth with a lit/shaded split (bright pecs and
      // shoulders, dark side seams and back channel). His army's colour is
      // trim only: a tunic panel down the front and back under the belt,
      // the crest and the shield face.
      // Round 6: the army's colour is the whole tunic. A dyed linothorax
      // wraps the torso (chest, flanks, back and shoulders, shaded flanks),
      // with only a bronze breastplate on the chest: from the RTS camera
      // every man is a block of red or blue with a bronze heart.
      m.box(0, 2, -1, 8, 7, 6, TEAM);                                             // dyed linothorax
      tbox(m, 0, 2, -1, 1, 6, 6, TEAM_SHADE); tbox(m, 7, 2, -1, 1, 6, 6, TEAM_SHADE); // shaded flanks
      tbox(m, 3, 2, -1, 2, 6, 1, TEAM_SHADE);                                      // back seam
      m.box(2, 4, 5, 4, 4, 1, MET);                                                // bronze breastplate
      m.set(2, 7, 5, 0xf6d98a).set(5, 7, 5, 0xf6d98a);                            // polished pecs
      m.set(3, 5, 5, MET_DK).set(4, 5, 5, MET_DK);
      m.box(0, 9, 0, 8, 1, 4, TEAM).box(2, 9, 0, 4, 1, 4, TEAM_TRIM).box(3, 9, 1, 2, 1, 2, SKIN); // dyed shoulder yoke, pale neckline
      m.box(-1, 6, 0, 1, 3, 4, TEAM).box(8, 6, 0, 1, 3, 4, TEAM);                 // shoulder flaps
      m.box(-1, 6, 0, 1, 1, 4, TEAM_TRIM).box(8, 6, 0, 1, 1, 4, TEAM_TRIM);
      m.box(0, 1, -1, 8, 1, 6, BRONZE_DK).carve(1, 1, 1, 6, 1, 2);                // girdle
    } else {
      m.box(0, 2, 0, 8, 6, 4, MET);
      m.box(1, 1, 0, 6, 1, 4, MET);
      m.box(1, 5, 4, 2, 2, 1, MET).box(5, 5, 4, 2, 2, 1, MET);  // pecs
      m.set(3, 4, 4, MET_DK).set(4, 4, 4, MET_DK).set(3, 2, 4, MET_DK).set(4, 2, 4, MET_DK);
      m.box(0, 7, -1, 2, 2, 6, LINEN).box(6, 7, -1, 2, 2, 6, LINEN); // white linothorax shoulder flaps
      m.box(0, 7, 4, 2, 1, 1, LINEN).box(6, 7, 4, 2, 1, 1, LINEN);
    }
    // pteryges: leather strips alternating with team linen
    // team chiton skirt showing under leather pteryges strips
    // leather and linen strips all round, with a team tunic panel showing
    // down the middle front and back (and a team hem under the strips)
    // dyed skirt all round (alternate strips a shade darker) over a pale hem
    const dyed = style === 'hoplite' || style === 'rider';
    const strip = (m2, x, y, z, i) => { if (!dyed && i % 2 === 1) m2.box(x, y, z, 1, 4, 1, LEATHER); else if (i % 2) tbox(m2, x, y, z, 1, 4, 1, TEAM_SHADE); else m2.box(x, y, z, 1, 4, 1, TEAM); m2.set(x, y - 1, z, dyed ? TEAM_TRIM : TEAM); };
    for (let x = 0; x < 8; x++) for (const z of [-1, 4]) strip(m, x, -4, z, x);
    for (let z = 0; z < 4; z++) { strip(m, -1, -4, z, z + 1); strip(m, 8, -4, z, z); }
    m.box(0, 0, 0, 8, 1, 4, BRONZE_DK);
    if (style === 'rider') {
      // short chlamys knotted at the right shoulder, a narrow fold down the back
      m.box(1, 5, -1, 6, 3, 1, TEAM).box(2, 3, -2, 4, 2, 1, TEAM);
      m.set(1, 7, 4, BRONZE(1, 7, 4));
    } else if (cloak) {
      // Team colour where the RTS camera sees it: a mantle over both shoulders
      // and a cloak down the back to the knees (the near army shows its back).
      const long = style === 'hero';
      m.box(0, 8, -1, 8, 1, 3, TEAM);                                      // mantle over the shoulders
      m.box(1, 1, -1, 6, 7, 1, TEAM);                                      // cloak hanging down the back
      // skirt of the cloak in vertical folds (alternating depth catches AO)
      const bot = long ? -6 : -4;
      for (let x = long ? -1 : 0; x <= (long ? 8 : 7); x++) {
        const deep = x % 2 === 0;
        if (deep) m.box(x, bot, -2, 1, 2 - bot, 1, TEAM); else tbox(m, x, bot, -3, 1, 2 - bot, 1, TEAM_SHADE);
        m.set(x, bot - 1, deep ? -2 : -3, long ? GOLD(x, bot, 0) : TEAM_TRIM);
      }
      if (long) for (let y = bot; y <= 8; y += 2) { m.set(-1, Math.min(y, 1), -2, GOLD(0, y, 1)); m.set(8, Math.min(y, 1), -2, GOLD(1, y, 1)); m.set(1, y, -1, GOLD(2, y, 1)); m.set(6, y, -1, GOLD(3, y, 1)); }
      m.set(0, 8, 4, MET(0, 8, 4)).set(7, 8, 4, MET(7, 8, 4));             // brooches
      m.set(3, 0, 4, MET(3, 0, 4)).set(4, 0, 4, MET(4, 0, 4));
    }
  } else if (style === 'archer') {
    // team chiton with sleeves
    m.box(0, 0, 0, 8, 8, 4, LINEN).box(1, 8, 1, 6, 1, 2, LINEN);
    // tan leather jerkin over a linen chiton; the army's colour is a tunic
    // panel down the chest, the sleeves and the shoulder yoke
    // team-dyed tunic under a leather harness: the archer screen reads as
    // his army's colour from the RTS camera, not as tan jerkins
    m.box(0, 2, -1, 8, 6, 6, TEAM); m.box(1, 8, 0, 6, 1, 4, TEAM);
    tbox(m, 0, 2, -1, 1, 5, 6, TEAM_SHADE); tbox(m, 7, 2, -1, 1, 5, 6, TEAM_SHADE);   // shaded flanks
    m.box(0, 1, -1, 8, 2, 6, LEATHER);
    m.box(1, 4, 5, 1, 4, 1, LEATHER_DK).box(6, 4, 5, 1, 4, 1, LEATHER_DK);
    m.box(-1, 6, 0, 1, 2, 4, TEAM).box(8, 6, 0, 1, 2, 4, TEAM);    // sleeves at the shoulder
    m.line(4, 7, 5, 4, 3, 5, LEATHER_DK);                           // lacing
    m.box(1, 0, 0, 6, 1, 4, BELT);
    m.box(0, -3, -1, 8, 1, 6, LINEN).box(1, -1, 0, 6, 1, 4, LINEN); // chiton hem under the team skirt band
    m.line(7, 7, 4, 1, 1, 4, LEATHER_DK);           // baldric
    m.line(7, 7, -1, 1, 1, -1, LEATHER_DK);
    // quiver on the back, arrows showing over the right shoulder
    m.box(0, 1, -3, 3, 8, 2, 0x96643a).box(0, 1, -3, 1, 8, 2, LEATHER).box(0, 2, -3, 3, 1, 2, TEAM).box(0, 7, -3, 3, 1, 1, BRONZE_DK);
    for (let i = 0; i < 3; i++) { m.set(i, 9, -3 + (i % 2), WOOD); m.set(i, 10, -3 + (i % 2), 0xf4f0e8); m.set(i, 11, -3 + (i % 2), i === 1 ? TEAM : 0xf4f0e8); }
  } else {
    // villager: exomis leaving the right shoulder bare, rope belt
    m.box(0, 5, 0, 3, 3, 4, SKIN);
    m.box(1, 3, 0, 1, 2, 4, SKIN);
    m.line(3, 7, 4, 0, 4, 4, TEAM).line(3, 7, -1, 0, 4, -1, TEAM);
    m.box(1, 0, 0, 6, 1, 4, 0xa27a45);
  }
  return m;
}

function torso(style, cloak = true) {
  return part('torso', torsoModel(style, cloak), [4, 0, 2], [0, 12, 0]);
}

// Hoplite cloaks as separate parts (torso space, same pivot) so the ranks
// seen from behind are not one stamped cape: long to the knees, a short
// chlamys to mid-back pinned on the right shoulder, or none (bronze back).
function cloakModel(kind) {
  const m = new VoxelModel();
  if (kind === 'long') {
    // an undyed campaign cloak in weathered wool, deep folds (alternate
    // folds a shade darker) and a narrow team border at the hem: the man's
    // back stays a figure, not a block of team paint
    // a dyed campaign cloak in the army's colour, deep folds a shade darker
    // and a pale hem: from behind a rank reads as red or blue at a glance
    m.box(0, 8, -1, 8, 1, 3, TEAM);
    m.box(1, 1, -1, 6, 7, 1, TEAM);
    for (let x = 0; x <= 7; x++) {
      const deep = x % 2 === 0;
      if (deep) m.box(x, -2, -2, 1, 4, 1, TEAM); else tbox(m, x, -2, -3, 1, 4, 1, TEAM_SHADE);
      m.set(x, -3, deep ? -2 : -3, TEAM_TRIM);
    }
  } else {
    // short chlamys swept off the left shoulder, hem slanting across the
    // back, undyed with a team edge
    // (undyed wool, so a rank seen from behind is a mix of bronze backs,
    // pale cloaks and dyed ones, not a carpet of team paint)
    m.box(0, 8, -1, 6, 1, 3, TEAM);
    for (let x = 0; x <= 7; x++) {
      const bot = 3 + Math.round(x * 0.45);
      for (let y = bot; y < 8; y++) { if (x % 2) tbox(m, x, y, -2, 1, 1, 1, TEAM_SHADE); else m.set(x, y, -1, TEAM); }
      m.set(x, bot - 1, x % 2 ? -2 : -1, TEAM_TRIM);
    }
    m.set(7, 8, 3, BRONZE(7, 8, 3)).set(7, 8, 4, BRONZE(7, 8, 4)); // brooch
  }
  return m;
}

// A tall horsehair crest arching front to back on a bronze holder, team
// coloured: the one thing on a soldier that stands clear
// of the crowd, so every man is marked by a stroke of his army's colour.
function crest(m, z0, z1, y0, H) {
  const mid = (z0 + z1) / 2, half = (z1 - z0) / 2 + 0.5;
  for (let z = z0; z <= z1; z++) {
    const k = Math.sqrt(Math.max(0, 1 - ((z - mid) / half) ** 2));
    const top = y0 + Math.max(1, Math.round(H * k));
    // a full three-voxel brush: a bold stroke from above, not a hairline
    m.box(1, y0, z, 3, top - y0 + 1, 1, TEAM, { glow: 0.2 });
    m.set(0, top - 1, z, TEAM).set(4, top - 1, z, TEAM);   // brush spreads at the top
  }
}

// Head model: x 0..4, y 0..4, z 0..4, face at z=4.
function headModel(style) {
  const m = new VoxelModel();
  m.box(0, 0, 0, 5, 5, 5, SKIN);
  m.set(1, 2, 4, EYE_WHITE).set(3, 2, 4, EYE_WHITE);
  m.set(1, 2, 5, DARK).set(3, 2, 5, DARK);         // eyes sit under the brow
  m.box(1, 3, 5, 3, 1, 1, style.startsWith('hop') ? BRONZE : HAIR);  // brow
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
    // a slim fin, not a slab: from above it is a stripe down a bronze bowl
    m.box(1, 8, 0, 3, 1, 5, BRONZE_DK);
    crest(m, -3, 7, 8, 6);
    m.box(2, 4, -4, 1, 4, 1, TEAM).set(2, 3, -4, TEAM);              // horsehair tail down the nape
  } else if (style === 'hopCor') {
    // Corinthian: a closed bronze shell with a T-shaped face opening and a
    // tall front-to-back crest, team with a pale ridge
    m.box(-1, -1, -1, 7, 7, 7, BRONZE).box(0, 6, 0, 5, 1, 5, BRONZE);
    m.box(0, 2, 5, 2, 1, 1, DARK).box(3, 2, 5, 2, 1, 1, DARK);        // eye slits
    m.box(2, -1, 5, 1, 2, 1, DARK);                                  // mouth slit
    m.set(2, 1, 6, BRONZE_DK).set(2, 2, 6, BRONZE_DK);               // nose guard
    m.box(-1, 3, 5, 7, 1, 1, BRONZE_DK);                             // brow ridge
    m.box(1, -2, 4, 3, 1, 2, BEARD);
    m.box(2, 7, 0, 1, 1, 5, BRONZE_DK);
    m.box(1, 8, 0, 3, 1, 5, BRONZE_DK);
    crest(m, -3, 6, 8, 7);
    m.box(2, 4, -4, 1, 5, 1, TEAM);
  } else if (style === 'hopAttic') {
    // Attic: open face, hinged cheek guards and a transverse crest from ear
    // to ear (a bar across the head from above)
    m.box(-1, 3, -1, 7, 3, 7, BRONZE).box(0, 6, 0, 5, 1, 5, BRONZE);
    m.box(-1, 0, -1, 7, 3, 2, BRONZE);
    m.box(-1, 0, 2, 1, 3, 2, BRONZE).box(5, 0, 2, 1, 3, 2, BRONZE);
    m.box(0, 4, 5, 5, 1, 1, BRONZE_DK).set(2, 5, 6, BRONZE_DK);       // peaked brow
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 3, BEARD);
    m.box(0, 7, 2, 5, 1, 1, BRONZE_DK);
    m.box(-2, 8, 2, 9, 3, 1, TEAM).box(-1, 11, 2, 7, 1, 1, TEAM).box(0, 12, 2, 5, 1, 1, TEAM).box(1, 13, 2, 3, 1, 1, TEAM);
    m.box(-2, 8, 1, 9, 1, 1, TEAM_TRIM);
    m.box(-2, 7, 2, 1, 1, 1, TEAM).box(6, 7, 2, 1, 1, 1, TEAM);
  } else if (style === 'hopPilos') {
    // pilos: a plain conical bronze cap with a team horsehair tassel at the tip
    m.box(-1, 3, -1, 7, 2, 7, BRONZE).box(-1, 3, -1, 7, 1, 7, BRONZE_DK);
    m.box(0, 5, 0, 5, 2, 5, BRONZE).box(1, 7, 1, 3, 2, 3, BRONZE).set(2, 9, 2, BRONZE_DK);
    m.box(0, 0, 0, 5, 3, 1, HAIR).box(-1, 0, 0, 1, 3, 3, HAIR).box(5, 0, 0, 1, 3, 3, HAIR);
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 3, BEARD).set(2, -1, 6, BEARD);
    m.box(2, 10, 1, 1, 3, 2, TEAM).box(1, 12, 1, 3, 2, 1, TEAM).box(2, 9, -1, 1, 2, 2, TEAM).box(2, 7, -2, 1, 2, 1, TEAM).box(2, 5, -3, 1, 2, 1, TEAM);
  } else if (style === 'hero') {
    // Corinthian helmet in gold with a towering transverse-and-long team crest
    m.box(-1, 3, -1, 7, 3, 7, GOLD).box(0, 6, 0, 5, 1, 5, GOLD);
    m.box(-1, -1, -1, 7, 4, 3, GOLD);
    m.box(-1, 0, 2, 1, 3, 4, GOLD).box(5, 0, 2, 1, 3, 4, GOLD);
    m.carve(0, 3, 5, 5, 1, 2);
    m.box(0, 4, 5, 5, 1, 1, GOLD_DK).set(2, 3, 5, GOLD_DK);
    m.box(1, -1, 5, 3, 1, 1, BEARD);
    m.box(2, 7, -1, 1, 1, 7, GOLD_DK);
    m.box(1, 8, -2, 3, 3, 9, TEAM, { glow: 0.22 }).box(1, 11, -1, 3, 2, 7, TEAM, { glow: 0.22 }).box(2, 13, 0, 1, 1, 5, TEAM, { glow: 0.22 });
    m.box(1, 3, -4, 3, 5, 1, TEAM, { glow: 0.15 }).box(2, 0, -4, 1, 3, 1, TEAM, { glow: 0.15 });
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
    // felt Phrygian cap (undyed) with a team band, beard
    const FELT = (x, y, z) => (hash3(x, y, z, 19) < 0.5 ? 0xb89a6c : 0xa88a5e);
    // dyed in the army's colour (the archer screen reads red or blue from above) over an undyed felt band
    m.box(-1, 4, -1, 7, 2, 7, TEAM).box(0, 6, 0, 5, 1, 5, TEAM).box(1, 7, 2, 3, 1, 3, TEAM).box(2, 7, 4, 1, 1, 2, TEAM).set(2, 8, 5, TEAM);
    m.box(-1, 3, -1, 7, 1, 7, FELT).carve(0, 3, 5, 5, 1, 1);
    m.box(-1, 0, -1, 1, 3, 3, LEATHER).box(5, 0, -1, 1, 3, 3, LEATHER); // ear flaps
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 2, BEARD).set(2, -1, 5, BEARD);
    m.box(0, 0, 0, 5, 3, 1, HAIR);
  } else if (style === 'archerHat') {
    // leather petasos with a narrow brim and a team cord
    m.box(0, 3, 0, 5, 2, 5, HAIR).box(0, 1, 0, 5, 2, 1, HAIR);
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 2, BEARD);
    for (let z = -2; z <= 6; z++) for (let x = -2; x <= 6; x++) { const dx = x - 2, dz = z - 2; if (dx * dx + dz * dz <= 12) m.set(x, 5, z, LEATHER); }
    m.box(0, 6, 0, 5, 1, 5, TEAM).box(1, 7, 1, 3, 1, 3, TEAM);   // dyed crown
    tbox(m, 0, 6, 0, 5, 1, 1, TEAM_SHADE); tbox(m, 0, 6, 4, 5, 1, 1, TEAM_SHADE);
  } else if (style === 'archerBare') {
    // bareheaded: dark curls bound with a team fillet
    m.box(-1, 3, -1, 7, 3, 7, HAIR).box(0, 6, 0, 5, 1, 5, HAIR).box(-1, 0, -1, 7, 3, 2, HAIR);
    m.box(-1, 4, -1, 7, 1, 7, TEAM).carve(0, 4, 5, 5, 1, 1).carve(0, 3, 5, 5, 1, 1);
    m.box(1, 0, 5, 3, 1, 1, BEARD).box(0, -1, 3, 5, 1, 3, BEARD).set(2, -1, 6, BEARD);
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
  if (style === 'hoplite') m.box(0, 5, 0, 2, 2, 2, TEAM).box(0, 5, 0, 2, 1, 2, TEAM_TRIM);   // dyed sleeve, pale hem
  else if (style !== 'villager') m.box(0, 6, 0, 2, 1, 2, LINEN);   // chiton sleeve
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
  // a slim blade with no cross-guard, so a raised spear does not read as a
  // cross from above
  // a broad leaf blade (three voxels across at the swell) that reads as
  // a spearhead from the RTS camera
  m.box(0, t, 0, 1, 7, 1, STEEL).set(0, t + 7, 0, 0x8d9398);
  m.box(-1, t + 1, 0, 3, 3, 1, STEEL).box(0, t + 1, -1, 1, 3, 3, STEEL);
  m.box(0, -11, 0, 1, 2, 1, BRONZE).set(0, -1, 0, LEATHER).set(0, 0, 0, LEATHER).set(0, 1, 0, LEATHER);
  return m;
}

// A small team pennant tied under the spear blade (file leaders carry one).
function pennantModel(len = 34) {
  const m = new VoxelModel();
  const t = len - 9;
  for (let z = 1; z <= 5; z++) {
    const h = z < 4 ? 3 : z === 4 ? 2 : 1;             // swallow-tailed fly
    m.box(0, t - 1 - h, z, 1, h, 1, TEAM);
  }
  m.set(0, t - 1, 1, TEAM_TRIM);
  return m;
}

function aspis(r = 6, RIM = BRONZE, device = 0) {
  const m = new VoxelModel();
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > r + 0.3) continue;
      // a thin bronze rim: the painted face is most of the disc
      const rim = d > r - 0.6;
      // Team-painted face inside a bronze rim, with a small device, so every
      // shield in the line says whose it is:
      //   0 pale lambda   1 thin pale ring   2 bronze boss   3 dark star
      const inner = d < 1.1;
      let c = rim ? RIM(x, y, 0) : TEAM;
      if (rim) { /* rim */ }
      else if (inner) c = device === 1 ? TEAM : RIM(x, y, 1);                                               // boss
      else if (device === 1) { if (Math.abs(d - (r - 1.9)) < 0.35) c = SHIELD_FACE(x, y, 1); }             // pale ring
      else if (device === 2) { if (d < 1.9) c = RIM(x, y, 2); }                                            // broad boss
      else if (device === 3) { if ((x === 0 || y === 0) && d < r - 1.5) c = RIM === GOLD ? GOLD_DK : BRONZE_DK; } // cross-star
      else if (y <= 2 && y >= -3 && Math.abs(Math.abs(x) - (1.6 - y) * 0.6) < 0.55) c = SHIELD_FACE(x, y, 2); // lambda
      m.set(x, y, 1, c);
      // the back is team-painted too (with leather straps): from behind the
      // near army and in front of the far one, the camera sees shield backs
      // the back is bare oxhide and wood with the arm straps: team paint is
      // on the face only
      if (!rim) m.set(x, y, 0, (x === 0 || y === 1) && Math.abs(x) + Math.abs(y) < r ? LEATHER_DK : (x + y * 3) % 5 === 0 ? WOOD_DK : WOOD);
      if (rim) m.set(x, y, 0, RIM === GOLD ? GOLD_DK : BRONZE_DK);
    }
  m.set(0, 0, 2, RIM(0, 0, 2));
  m.box(0, -1, -1, 1, 3, 1, LEATHER); // grip
  return m;
}

// Short leaf-bladed sword (xiphos): grip at the origin, blade along +y. Two
// voxels across so it reads as a blade, not a stick, from the RTS camera.
function swordModel() {
  const m = new VoxelModel();
  m.box(0, -2, 0, 1, 3, 1, LEATHER).set(0, -3, 0, BRONZE);          // grip + pommel
  m.box(-1, 1, 0, 3, 1, 1, BRONZE).box(0, 1, -1, 1, 1, 3, BRONZE);   // cross-guard
  m.box(0, 2, 0, 1, 10, 1, STEEL).box(-1, 4, 0, 3, 5, 1, STEEL).box(0, 4, -1, 1, 5, 3, STEEL);
  m.set(0, 12, 0, 0xe8ecef);
  return m;
}

// Large oblong shield (thureos) for the swordsmen: a tall team-painted
// board curved round the body, with a bronze rim, a pale spine and a boss,
// so from above a swordsman is a long team-coloured slab, not a disc.
function thureos() {
  const m = new VoxelModel();
  const W = 5, H = 8;
  for (let y = -H; y <= H; y++)
    for (let x = -W; x <= W; x++) {
      // rounded corners
      const cx = Math.max(0, Math.abs(x) - (W - 1.5)), cy = Math.max(0, Math.abs(y) - (H - 1.5));
      if (cx * cx + cy * cy > 2.4) continue;
      const z = -Math.round((x * x) / 14);           // curved round the body
      const rim = Math.abs(x) === W || Math.abs(y) === H || cx * cx + cy * cy > 1.0;
      let c = rim ? BRONZE(x, y, 0) : TEAM;
      if (!rim && x === 0 && Math.abs(y) > 1) c = SHIELD_FACE(x, y, 3);   // spine
      if (!rim && Math.abs(x) <= 1 && Math.abs(y) <= 1) c = BRONZE(x, y, 1); // boss
      m.set(x, y, 1 + z, c);
      m.set(x, y, z, rim ? BRONZE_DK : (x === 0 || y === 1) ? LEATHER_DK : WOOD);
    }
  m.set(0, 0, 2, BRONZE(0, 0, 2));
  m.box(0, -1, -1, 1, 3, 1, LEATHER);
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

// Per-soldier kit (helmet, cloak, shield device) as alternative parts that
// share one animation channel; gearOf() in anim.js picks them per unit.
const gearIs = (k, v) => (u) => gearOf(u)[k] === v;
const spearGear = (k, v) => (u) => { const g = gearOf(u); return g.kit === 0 && g[k] === v; };
export function hopliteRig() {
  const helm = (style, v) => ({ ...head(style), name: v ? `head${v}` : 'head', anim: 'head', show: gearIs('helm', v), portrait: !v });
  return [
    ...legs('hoplite'), torso('hoplite', false), ...arms('hoplite'),
    helm('hoplite', 0), helm('hopCor', 1), helm('hopAttic', 2), helm('hopPilos', 3),
    part('cloakLong', cloakModel('long'), [4, 0, 2], [0, 0, 0], 'torso', { show: gearIs('cloak', 1), portrait: true }),
    part('cloakShort', cloakModel('short'), [4, 0, 2], [0, 0, 0], 'torso', { show: gearIs('cloak', 2) }),
    // spearmen: a long spear and a round aspis; swordsmen: a short blade
    // and a tall oblong shield (gearOf(u).kit)
    part('weapon', spearModel(34), [0, 0, 0], HAND, 'armR', { show: gearIs('kit', 0), portrait: true }),
    part('pennant', pennantModel(34), [0, 0, 0], HAND, 'armR', { anim: 'weapon', show: spearGear('pennant', 1), portrait: false }),
    part('sword', swordModel(), [0, 0, 0], HAND, 'armR', { anim: 'weapon', show: gearIs('kit', 1), portrait: false }),
    ...[0, 1, 2, 3].map((v) => part(v ? `shield${v}` : 'shield', aspis(6, BRONZE, v), [0, 0, 0], [1.5, -4, 3.2], 'armL', { anim: 'shield', show: spearGear('shield', v), portrait: !v })),
    part('thureos', thureos(), [0, 0, 0], [1.5, -3.5, 3.2], 'armL', { anim: 'shield', show: gearIs('kit', 1), portrait: false }),
  ];
}

export function toxotesRig() {
  return [
    ...legs('archer'), torso('archer'), ...arms('archer'),
    ...[['archer', 0], ['archerHat', 1], ['archerBare', 2]].map(([st, v]) => ({ ...head(st), name: v ? `head${v}` : 'head', anim: 'head', show: gearIs('hat', v), portrait: !v })),
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
  // saddle cloth: team cloth over the back and down the upper flanks only,
  // with a pale hem, so the pale horse (head, neck, chest, quarters and all
  // four legs) reads round it instead of one blue box
  const m = new VoxelModel();
  for (let z = 7; z <= 14; z++) {
    const lo = z === 7 || z === 14 ? 6 : 4;
    m.box(-1, lo, z, 1, 9 - lo, 1, TEAM).box(7, lo, z, 1, 9 - lo, 1, TEAM);
    m.box(0, 9, z, 7, 1, 1, TEAM);
    m.set(-1, lo - 1, z, TEAM_TRIM).set(7, lo - 1, z, TEAM_TRIM);
    if (z % 2) { tbox(m, -1, lo, z, 1, 9 - lo, 1, TEAM_SHADE); tbox(m, 7, lo, z, 1, 9 - lo, 1, TEAM_SHADE); }
  }
  for (let z = 8; z <= 13; z += 5) { m.set(-2, 6, z, BRONZE(0, z, 1)); m.set(8, 6, z, BRONZE(0, z, 2)); } // studs
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
  body.ellipsoid(4.5, 2.5, 2.5, 4, 3, 3, FUR);    // waist
  body.ellipsoid(4.5, 7.5, 2.5, 5.4, 4.2, 4, FUR); // barrel chest
  body.ellipsoid(4.5, 10.5, 2, 6.3, 2.2, 3.2, FUR); // shoulders
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
  const upperArm = new VoxelModel().ellipsoid(2, 7.5, 2, 2.6, 2.3, 2.6, FUR).ellipsoid(2, 4.5, 2, 2, 3.3, 2, FUR);
  band(upperArm, 6, BRONZE_DK); band(upperArm, 5, BRONZE(0, 0, 0));
  const foreArm = new VoxelModel().ellipsoid(1.5, 3, 1.5, 1.8, 3, 1.8, FUR).box(0, 0, 0, 3, 2, 3, LEATHER);
  foreArm.box(0, -2, 0, 3, 2, 3, 0x5c3520);
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
    part('armL', upperArm, [2, 9, 2], [7.5, 11.5, 0], 'torso'),
    part('foreL', foreArm, [1.5, 5.5, 1.5], [0, -6.5, 0], 'armL'),
    part('armR', upperArm, [2, 9, 2], [-7.5, 11.5, 0], 'torso'),
    part('foreR', foreArm, [1.5, 5.5, 1.5], [0, -6.5, 0], 'armR'),
    part('weapon', axe, [0, 0, 0], [0, -6, 0], 'foreR'),
  ];
}

// ---- hero: Achilles (voxel 0.095, ~1.35x a hoplite) --------------------------
// Gold cuirass and Corinthian helmet, a towering glowing team crest, a long
// team cloak and a big gold-rimmed team shield: the brightest figure on the field.
export function heroRig() {
  return [
    ...legs('hoplite'), torso('hero'), head('hero'), ...arms('hoplite'),
    part('weapon', spearModel(38), [0, 0, 0], HAND, 'armR'),
    part('shield', aspis(6, GOLD), [0, 0, 0], [1.5, -4, 2.5], 'armL'),
  ];
}

// ---- cyclops (voxel 0.15): a one-eyed giant with a tree-trunk club ----------
const CY_SKIN = (x, y, z) => { const h = hash3(x, y, z, 41); return h < 0.5 ? 0xd9a88a : h < 0.85 ? 0xcc9a7c : 0xe2b496; };
const CY_SHADE = 0xa9765c;

// Paint a band of colour round a model's surface at height y (armbands, belts).
function band(m, y, color, x0 = -4, x1 = 16, z0 = -4, z1 = 16) {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++)
    if (m.has(x, y, z) && (!m.has(x + 1, y, z) || !m.has(x - 1, y, z) || !m.has(x, y, z + 1) || !m.has(x, y, z - 1))) m.set(x, y, z, color);
  return m;
}
// Paint a strap over the front (dir 1) or back (dir -1) surface along a 2D
// path in x/y (a sash or baldric draped over a rounded body).
function strap(m, x0, y0, x1, y1, dir, color, w = 2) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n), yb = Math.round(y0 + (y1 - y0) * i / n);
    for (let y = yb; y < yb + w; y++) {
      let z = dir > 0 ? 16 : -6;
      while (z !== (dir > 0 ? -6 : 16) && !m.has(x, y, z)) z -= dir;
      if (m.has(x, y, z)) m.set(x, y, z + dir, color);
    }
  }
  return m;
}

export function cyclopsRig() {
  // rounded, articulated giant: thigh / shin with a big bare foot, a barrel
  // chest and gut on a hunched back, shoulder / upper arm / forearm + fist,
  // and a bald domed head jutting forward with one huge glowing eye
  const thighM = new VoxelModel().ellipsoid(2, 3.8, 2, 2.5, 4, 2.6, CY_SKIN);
  const shinM = new VoxelModel().ellipsoid(1.5, 4.6, 1.8, 1.9, 2.8, 2.1, CY_SKIN);
  shinM.box(0, 1, 0, 3, 2, 3, CY_SKIN).box(0, 1, 0, 3, 1, 3, LEATHER);
  shinM.box(-0, 0, -1, 3, 1, 6, CY_SKIN).box(0, 1, 3, 3, 1, 2, CY_SKIN);   // foot
  shinM.set(0, 0, 5, CY_SHADE).set(1, 0, 5, CY_SHADE).set(2, 0, 5, CY_SHADE);
  band(shinM, 3, LEATHER_DK);
  const body = new VoxelModel();
  body.ellipsoid(6, 4, 4.5, 5, 4.2, 4.4, CY_SKIN);                // gut
  body.ellipsoid(6, 9.5, 4, 6.2, 4.4, 4.3, CY_SKIN);              // barrel chest
  body.ellipsoid(6, 12.5, 2.8, 5.4, 2.6, 3.4, CY_SKIN);           // hunched shoulders / traps
  body.ellipsoid(6, 14, 4, 2.4, 1.8, 2.2, CY_SKIN);               // neck
  for (let y = 7; y <= 11; y++) { if (body.has(6, y, 8)) body.set(6, y, 8, CY_SHADE); }   // pec split
  for (let x = 2; x <= 10; x++) if (body.has(x, 7, 8)) body.set(x, 7, 8, CY_SHADE);        // under the pecs
  body.set(6, 3, 9, CY_SHADE);                                    // navel
  // team: a deep kilt round the hips with front and back flaps, a sash
  // across the chest and back, bronze studs on the belt
  for (let x = -1; x <= 13; x++) for (let z = -1; z <= 10; z++) for (let y = -2; y <= 2; y++) {
    const dx = (x - 6) / 5.4, dz = (z - 4.5) / 4.8;
    if (dx * dx + dz * dz <= 1 && (y > -2 || (x + z) % 3)) body.set(x, y, z, TEAM);   // ragged hem
  }
  body.box(4, -5, 9, 5, 3, 1, TEAM).box(4, -5, -1, 5, 3, 1, TEAM).box(4, -6, 9, 5, 1, 1, TEAM_TRIM);
  band(body, 3, BELT);
  for (let x = 2; x <= 10; x += 2) if (body.has(x, 3, 9)) body.set(x, 3, 10, BRONZE(x, 3, 9));
  strap(body, 11, 13, 1, 3, 1, TEAM, 2);
  strap(body, 11, 13, 1, 3, -1, TEAM, 2);
  const headM = new VoxelModel();
  headM.ellipsoid(4, 5.5, 4, 3.9, 4.6, 3.9, CY_SKIN);              // domed skull
  headM.box(1, 0, 3, 7, 3, 5, CY_SKIN).box(2, -1, 4, 5, 1, 4, CY_SKIN); // heavy jaw
  headM.box(0, 6, 7, 9, 2, 2, CY_SHADE);                         // overhanging brow
  headM.carve(2, 3, 8, 5, 3, 1);
  headM.box(2, 3, 7, 5, 3, 1, EYE_WHITE);                        // the one great eye
  headM.box(3, 3, 8, 3, 3, 1, 0xd05818, { glow: 0.7 }).set(4, 4, 8, 0x1a0e08);
  headM.box(3, 1, 8, 3, 2, 1, CY_SHADE).set(4, 1, 9, CY_SHADE);  // nose
  headM.box(2, 0, 8, 5, 1, 1, 0x5a2418);                         // mouth
  headM.set(2, 1, 8, 0xf2ead4).set(6, 1, 8, 0xf2ead4);           // tusks
  headM.box(-1, 4, 3, 1, 3, 2, CY_SKIN).box(8, 4, 3, 1, 3, 2, CY_SKIN).set(-2, 5, 3, CY_SHADE).set(9, 5, 3, CY_SHADE); // ears
  headM.box(1, 1, -0, 7, 5, 1, HAIR).box(0, 3, 1, 1, 3, 3, HAIR).box(8, 3, 1, 1, 3, 3, HAIR);      // fringe at the back
  headM.box(3, 10, 2, 3, 2, 3, HAIR).box(3, 12, 2, 3, 1, 3, TEAM).box(4, 13, 2, 1, 2, 2, HAIR).set(4, 15, 1, HAIR); // topknot bound in team
  headM.box(1, 8, 6, 1, 1, 1, CY_SHADE).box(2, 9, 6, 1, 1, 1, CY_SHADE);  // scar
  const upperArm = new VoxelModel();
  upperArm.ellipsoid(2, 8, 2, 2.9, 2.6, 2.9, CY_SKIN);            // shoulder ball
  upperArm.ellipsoid(2, 4, 2, 2.2, 4, 2.3, CY_SKIN);              // biceps
  band(upperArm, 6, TEAM); band(upperArm, 5, TEAM);
  const foreArm = new VoxelModel();
  foreArm.ellipsoid(2, 5, 2, 2.1, 3.1, 2.2, CY_SKIN);
  foreArm.box(0, 1, 0, 4, 2, 4, LEATHER).box(0, 3, 0, 4, 1, 4, BRONZE);
  foreArm.ellipsoid(2, -0.5, 2.3, 2, 1.8, 2.2, CY_SKIN);          // fist
  // tree-trunk club with bronze bands
  const club = new VoxelModel();
  const BARK = (x, y, z) => (hash3(x, y, z, 42) < 0.5 ? 0x6b4428 : 0x573620);
  club.box(0, -4, 0, 2, 12, 2, BARK);
  club.ellipsoid(0.5, 13, 0.5, 2.4, 5, 2.4, BARK).box(0, 18, 0, 2, 1, 2, BARK);
  club.box(-2, 10, -2, 6, 1, 6, BRONZE_DK).box(-2, 15, -2, 6, 1, 6, BRONZE_DK);
  club.set(-2, 13, 0, STEEL(0, 0, 0)).set(3, 13, 1, STEEL(0, 1, 0)).set(1, 14, -2, STEEL(1, 0, 0)).set(1, 12, 3, STEEL(1, 1, 0));
  return [
    part('legL', thighM, [2, 7.5, 2], [3, 13, 0]),
    part('shinL', shinM, [1.5, 7, 1.8], [0, -6.5, 0.3], 'legL'),
    part('legR', thighM, [2, 7.5, 2], [-3, 13, 0]),
    part('shinR', shinM, [1.5, 7, 1.8], [0, -6.5, 0.3], 'legR'),
    part('torso', body, [6, 0, 4], [0, 13, 0]),
    part('head', headM, [4, 1, 3], [0, 14.5, 2.5], 'torso'),
    part('armL', upperArm, [2, 9, 2], [7.6, 12.5, -0.5], 'torso'),
    part('foreL', foreArm, [2, 8, 2], [0, -6, 0], 'armL'),
    part('armR', upperArm, [2, 9, 2], [-7.6, 12.5, -0.5], 'torso'),
    part('foreR', foreArm, [2, 8, 2], [0, -6, 0], 'armR'),
    part('weapon', club, [1, 0, 1], [0, -8.5, 0.3], 'foreR'),
  ];
}

// ---- centaur (voxel 0.08): chestnut horse body, bare-chested archer --------
const CHESTNUT = (x, y, z) => { const h = hash3(x, y, z, 51); return h < 0.55 ? 0xe0a868 : h < 0.85 ? 0xd49a5a : 0xeab878; };
const recolor = (m, from, to) => { for (const v of m.vox.values()) if (!v.team && from.includes(v.c)) v.c = typeof to === 'function' ? to(0, 0, 0) : to; return m; };
const COAT_COLS = [0xe4ded2, 0xd2cbbd, 0xbdb5a6];
// a bright sorrel coat: lighter than the turf and the dirt, so the horse
// half keeps its outline on either
const chestnut = (m) => { let i = 0; for (const v of m.vox.values()) if (!v.team && COAT_COLS.includes(v.c)) v.c = [0xe0a868, 0xd49a5a, 0xeab878][(i++ * 7) % 3]; return m; };

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
  // a team saddle-cloth over the middle of the horse back only, hanging to
  // mid-flank with a pale hem: the chestnut barrel, quarters, chest and all
  // four legs stay in view, so from above it reads as a horse, not a box
  const m = new VoxelModel();
  for (let z = 6; z <= 11; z++) {
    const lo = z === 6 || z === 11 ? 8 : 7;
    m.box(-1, lo, z, 1, 10 - lo, 1, TEAM).box(7, lo, z, 1, 10 - lo, 1, TEAM).box(0, 10, z, 7, 1, 1, TEAM);
    if (z % 2) { tbox(m, -1, lo, z, 1, 10 - lo, 1, TEAM_SHADE); tbox(m, 7, lo, z, 1, 10 - lo, 1, TEAM_SHADE); }
    m.set(-1, lo - 1, z, TEAM_TRIM).set(7, lo - 1, z, TEAM_TRIM);
  }
  m.set(-2, 7, 8, BRONZE(0, 8, 1)); m.set(8, 7, 8, BRONZE(0, 8, 2));
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
