// Procedural voxel-part animation. pose(kind, u, out) fills `out` with
// per-part euler rotations [rx, ry, rz] and returns root offsets
// { bob (voxels up), lean (unused, kept for callers) }.
// Conventions: facing +z, +x is the unit's left. A hanging limb swings
// forward with negative rx; a left arm swings outward with +rz, a right arm
// with -rz. Weapons are built along +y from the grip: a total pitch
// (arm rx + weapon rx) of +PI/2 points them straight ahead.

const S = Math.sin, C = Math.cos, PI = Math.PI;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const ease = (a, b, k) => a + (b - a) * k;

// Per-unit phase offset so crowds do not move in lockstep.
const phaseOf = (u) => ((u.id * 0.618034) % 1) * PI * 2;
// Stable per-unit hash in [0, 1) (salt k picks an independent value).
export const uhash = (u, k = 0) => ((Math.imul(u.id + 1, 2654435761) ^ Math.imul(k + 7, 40503)) >>> 0) % 10007 / 10007;
// Per-unit animation variant: which idle stance / attack style this soldier uses.
const variantOf = (u, n) => Math.floor(uhash(u, 1) * n);

// Hit recoil (0..1) from the combat hit flash.
const recoilOf = (u) => smooth((u.flashT || 0) / 0.15);

// Archer upper body (toxotes, centaur, medusa): torso, head, arms, bow, arrow.
function archerUpper(u, st, t, set, v) {
  if (st === 'attack') {
    const { a } = attackPhase(u);
    const draw = a < 0.45 ? 0 : smooth((a - 0.45) / 0.6);
    const high = v === 1 ? -0.25 : 0;                 // some loft their shots
    set('torso', 0.02 + high * 0.3, 0.55, 0);
    set('head', high * 0.4, -0.45);
    set('armL', -1.5 + high, -0.45, 0.05);
    set('weapon', 1.5, 0, 0);
    set('armR', (a < 0.45 ? ease(-1.4, -2.5, smooth((a - 0.08) / 0.3)) : ease(-1.55, -1.5, draw)) + high, a < 0.45 ? 0 : ease(0.25, 0.9, draw), 0);
    return true;
  }
  if (st === 'idle') {
    const b = S(t * 1.7);
    if (v === 1) {
      // arrow nocked, bow half raised, scanning the field
      set('armL', -0.95, -0.3, 0.06); set('weapon', 1.3); set('armR', -1.0, 0.4, 0);
      set('torso', 0.04, 0.3 + S(t * 0.4) * 0.15); set('head', -0.05, -0.2 + S(t * 0.6) * 0.3);
    } else { set('armL', -0.25 + b * 0.03, 0, 0.08); set('weapon', 0.25); }
    return true;
  }
  return false;
}

// Attack timeline from attackT (seconds since the strike) and the cooldown:
//   strike 0..0.12 (extend), recover 0.12..0.45, then guard -> wind-up.
function attackPhase(u) {
  const a = (u.anim.attackT ?? 1) * (0.9 + uhash(u, 41) * 0.2);
  const cd = u.def?.attack?.cooldown ?? 1.2;
  const extend = a < 0.1 ? smooth(a / 0.1) : 1 - smooth((a - 0.1) / 0.35);
  const wind = smooth((a - 0.45) / Math.max(0.2, cd - 0.55));
  return { a, cd, extend: a < 0.45 ? extend : 0, wind: a < 0.45 ? 0 : wind };
}

export function pose(kind, u, out) {
  const an = u.anim;
  const st = an.state;
  // each soldier breathes, fidgets and swings at his own tempo (+-15%)
  const t = an.t * (0.85 + uhash(u, 40) * 0.3) + phaseOf(u) * 0.5;
  for (const k in out) { const r = out[k]; r[0] = r[1] = r[2] = 0; }
  const set = (name, x, y = 0, z = 0) => { const r = out[name]; if (r) { r[0] = x; r[1] = y; r[2] = z; } };
  const add = (name, x, y = 0, z = 0) => { const r = out[name]; if (r) { r[0] += x; r[1] += y; r[2] += z; } };

  const v = variantOf(u, 3);
  const av = Math.floor(uhash(u, 9) * 4);   // attack style (independent of the idle stance)
  const rec = st === 'die' ? 0 : recoilOf(u);
  if (kind === 'horse') return horsePose(u, st, t, set, add);
  if (kind === 'centaur') {
    const r = horsePose(u, st, t, set, add);
    set('shield', 0);
    if (!archerUpper(u, st, t, set, v % 2)) { if (st !== 'die') { set('armL', -0.3, 0, 0.1); set('weapon', 0.3); set('armR', -0.2, 0, -0.1); } }
    if (st === 'attack') set('arrow', 1.55 - out.armR[0], 0, 0);
    add('torso', -0.3 * rec);
    return { bob: r.bob, lean: 0, fwd: -0.1 * rec };
  }
  if (kind === 'medusa') return medusaPose(u, st, t, set, add, v, rec, out);

  const beast = kind === 'beast';
  const archer = kind === 'archer';
  const hoplite = u.type === 'hoplite' || u.type === 'hero';
  const hero = u.type === 'hero';
  let bob = 0, fwd = 0;

  if (st === 'walk') {
    const p = t * (beast ? 7 : 10);
    const sw = beast ? 0.5 : 0.6;
    set('legL', -S(p) * sw); set('legR', S(p) * sw);
    // knees fold while the leg swings through
    set('shinL', 0.1 + Math.max(0, C(p)) * 0.9); set('shinR', 0.1 + Math.max(0, -C(p)) * 0.9);
    bob = (1 - Math.abs(C(p))) * (beast ? 1.2 : 0.8);
    set('torso', beast ? 0.12 : 0.06, S(p) * 0.08, S(p) * 0.03);
    set('head', beast ? -0.08 : -0.03, -S(p) * 0.06);
    set('armL', S(p) * 0.5, 0, 0.06); set('armR', -S(p) * 0.5, 0, -0.06);
    if (hoplite) {
      set('armL', -0.55 + S(p) * 0.05, 0.25, 0.1);           // shield carried in front
      set('armR', -0.15 - S(p) * 0.2, 0, -0.08);
      set('weapon', 0.15 + S(p) * 0.2);                     // spear sloped forward
    }
    if (archer) { set('armL', -0.25 + S(p) * 0.3, 0, 0.08); set('weapon', 0.2); }
    if (beast) { set('armL', S(p) * 0.4, 0, 0.15); set('armR', -S(p) * 0.4 - 0.2, 0, -0.15); set('weapon', 0.6); }
  } else if (st === 'gather' || st === 'build') {
    const res = u.econ?.resType;
    if (st === 'build') {
      // crouched hammering, quick strikes
      const p = t * 9;
      const s = Math.max(0, S(p));
      set('legL', -0.9); set('shinL', 1.5); set('legR', 0.25); set('shinR', 1.2);
      bob = -3;
      set('torso', 0.45); set('head', -0.25);
      set('armR', -1.0 - s * 1.1, 0, -0.1);
      set('armL', -0.9, 0.3, 0.1);
    } else if (res === 'food') {
      // bent over, hands reaching alternately (sickle in the right hand)
      const p = t * 4;
      set('legL', -0.45); set('shinL', 0.7); set('legR', -0.2); set('shinR', 0.5);
      bob = -1.2;
      set('torso', 0.75 + S(p) * 0.06); set('head', -0.5);
      set('armR', -1.0 + S(p) * 0.45, 0, -0.2 + C(p) * 0.2);
      set('armL', -1.1 - S(p + 1.5) * 0.35, 0, 0.1);
    } else {
      // two-handed overhead swing: slow lift, fast strike
      const cyc = (t * 0.9) % 1;
      const k = cyc < 0.7 ? smooth(cyc / 0.7) : 1 - smooth((cyc - 0.7) / 0.12);
      const lift = res === 'gold' ? 2.5 : 2.3;
      set('legL', -0.35); set('shinL', 0.25); set('legR', 0.2); set('shinR', 0.15);
      set('torso', 0.35 - k * 0.45, -0.15);
      set('head', 0.1 - k * 0.15);
      set('armR', -0.6 - k * lift, 0, -0.05);
      set('armL', -0.7 - k * (lift - 0.2), 0, 0.2);
      bob = -0.5 + k * 0.3;
    }
  } else if (st === 'worship') {
    const s = S(t * 2);
    set('armL', -2.7 + s * 0.15, 0, 0.35); set('armR', -2.7 + s * 0.15, 0, -0.35);
    set('head', -0.35); set('torso', -0.1 + s * 0.03);
  } else if (st === 'attack') {
    const { a, extend, wind } = attackPhase(u);
    if (archer) {
      // left arm holds the bow out, right hand draws to the cheek
      archerUpper(u, st, t, set, v % 2);
      set('arrow', 1.55 - (out.armR ? out.armR[0] : 0), 0, 0);
      set('legL', -0.25); set('legR', 0.25); set('shinR', 0.15);
    } else if (beast && v === 1) {
      // sweeping backhand: club wound out to the right, whipped across the body
      const arc = -1.5 * wind + 1.2 * extend;
      set('armR', -1.35 - 0.3 * wind, 0, -0.4 + arc * 0.9); set('armL', -0.9 + 0.3 * extend, 0, 0.3);
      set('weapon', 1.1, 0, 0);
      set('foreR', -0.7 * wind - 0.2); set('foreL', -0.6);
      set('torso', 0.15 + 0.2 * extend, -0.6 * wind + 0.7 * extend, 0);
      set('head', 0.1, 0.3 * wind - 0.3 * extend);
      set('legL', -0.5); set('shinL', 0.35); set('legR', 0.45); set('shinR', 0.3);
      bob = -1.2;
      fwd = 0.3 * extend - 0.1 * wind;
    } else if (beast) {
      // huge overhead chop with both arms
      const up = wind * 1.0, down = extend;
      const arm = -1.1 - up * 1.9 + down * 0.7;
      set('armR', arm, 0, -0.15); set('armL', arm + 0.1, 0, 0.35);
      set('weapon', 0.4 + down * 0.4);
      set('foreR', -0.3 - up * 0.6 + down * 0.25); set('foreL', -0.35 - up * 0.5 + down * 0.2);
      set('torso', -0.15 * up + 0.4 * down, 0.1);
      set('head', 0.2 * down - 0.1 * up);
      set('legL', -0.45); set('shinL', 0.3); set('legR', 0.35); set('shinR', 0.25);
      bob = -1.5 * down;
      fwd = 0.35 * down - 0.12 * up;
    } else if (hoplite && av === 3) {
      // shield flung high against a blow from above, spear driven up under it
      const arm = -1.2 - extend * 0.5 + wind * 0.3;
      set('armR', arm, 0.2, -0.25);
      set('weapon', 1.57 - arm - 0.35);
      set('armL', -2.0 + extend * 0.2, 0.3, 0.35);
      set('torso', 0.35 + extend * 0.15, 0.25 - extend * 0.4);
      set('head', -0.3);
      set('legL', -0.9 - extend * 0.2); set('shinL', 0.9); set('legR', 0.6); set('shinR', 0.7);
      bob = -2.6;
      fwd = (hero ? 0.4 : 0.22) * extend - 0.06 * wind;
    } else if (hoplite && av === 1) {
      // low underhand thrust: spear drawn back at the hip, driven in level
      const arm = -0.85 + wind * 0.45 - extend * 0.75;
      set('armR', arm, 0.15, -0.2);
      set('weapon', 1.57 - arm - 0.1);
      set('armL', -1.3 + extend * 0.2, 0.6, 0.2);
      set('torso', 0.25 + extend * 0.3 - wind * 0.1, 0.35 - extend * 0.6);
      set('head', -0.2);
      set('legL', -0.75); set('shinL', 0.55); set('legR', 0.5); set('shinR', 0.5);
      bob = -2.0;
      fwd = (hero ? 0.5 : 0.32) * extend - 0.1 * wind;
    } else if (hoplite && av === 2) {
      // shield punch, then a downward stab over the rim
      const bash = smooth((a - 0.45) / 0.25) * (1 - wind);
      const arm = -2.6 - wind * 0.2 + extend * 0.4;
      set('armR', arm, 0.1, -0.15);
      set('weapon', 1.57 + 0.45 - arm);
      set('armL', -1.2 - bash * 0.55, 0.45 - bash * 0.3, 0.15);
      set('torso', 0.2 + extend * 0.3 + bash * 0.15, -0.1 + extend * 0.25);
      set('head', -0.1);
      set('legL', -0.6); set('shinL', 0.45); set('legR', 0.4); set('shinR', 0.4);
      bob = -1.5;
      fwd = (hero ? 0.45 : 0.25) * Math.max(extend, bash) - 0.05 * wind;
    } else if (hoplite) {
      // overhand spear thrust behind the raised shield
      const arm = -2.25 + wind * -0.25 + extend * 0.55;
      set('armR', arm, 0.1, -0.12);
      set('weapon', 1.57 + 0.18 - arm);
      set('armL', -1.15, 0.45, 0.15);
      set('torso', 0.08 + extend * 0.2 - wind * 0.08, -0.2 + extend * 0.3);
      set('head', -0.05);
      set('legL', -0.5); set('shinL', 0.35); set('legR', 0.35); set('shinR', 0.35);
      bob = -1.2;
      fwd = (hero ? 0.55 : 0.28) * extend - 0.08 * wind;
    } else {
      // villager: axe/fists, overhead strike
      const arm = -1.0 - wind * 1.6 + extend * 0.8;
      set('armR', arm, 0, -0.1); set('armL', -0.8, 0, 0.15);
      set('torso', 0.15 + extend * 0.2);
      set('legL', -0.3); set('legR', 0.25);
    }
    if (hoplite) {
      // footwork: step in with the lead foot on the strike, rock back on the wind-up
      const step = extend - 0.5 * wind;
      add('legL', -0.3 * step); add('shinL', 0.2 * Math.max(0, step)); add('legR', 0.25 * step); add('shinR', 0.25 * Math.max(0, -step));
    }
  } else if (st === 'die') {
    // crumple: recoil, knees buckle and the torso folds (0..0.3 s), then the
    // body rolls onto its side (root, in index.js) and curls up: hips and
    // knees drawn in, arms slack, head lolling; weapon arm flung out.
    const dT = an.dieT;
    const hit = smooth(dT / 0.1) * (1 - smooth((dT - 0.1) / 0.2));
    const buckle = smooth(dT / 0.32);
    const curl = smooth((dT - 0.3) / 0.6);
    const side = u.id % 2 ? 1 : -1;
    set('legL', -0.95 * buckle - 0.45 * curl, 0, 0.1 * curl); set('shinL', 1.55 * buckle + 0.35 * curl);
    set('legR', -0.6 * buckle - 0.8 * curl, 0, -0.1 * curl); set('shinR', 1.35 * buckle + 0.5 * curl);
    set('torso', -0.35 * hit + 0.45 * buckle + 0.25 * curl, 0.15 * side * curl, 0);
    set('head', -0.3 * hit + 0.5 * buckle - 0.2 * curl, 0.35 * side * curl, -0.25 * side * curl);
    set('armL', -0.9 * buckle - 0.5 * curl, 0, 0.25 + 0.5 * hit + 0.35 * curl);
    set('armR', -0.4 * buckle - 1.4 * curl, 0, -0.3 - 0.6 * hit - 0.2 * curl);
    set('weapon', 0.3 + 0.6 * curl);
    set('shield', 0.4 * curl);
    set('arrow', 0);
    bob = beast ? -7 * buckle : -4.2 * buckle;
  } else {
    // idle: breathing, weight shift, glances
    const b = S(t * 1.7);
    set('torso', 0.02 + b * 0.015, S(t * 0.37) * 0.06);
    set('head', S(t * 0.9) * 0.04, S(t * 0.53) * 0.3 * clamp01(S(t * 0.21) * 3));
    set('armL', b * 0.03, 0, 0.07); set('armR', -b * 0.03, 0, -0.07);
    set('legL', -0.04, 0, 0.03); set('legR', 0.04, 0, -0.03);
    if (hoplite && v === 1) {
      // ready stance: crouched behind the raised shield, spear overhand
      set('armL', -1.1, 0.45, 0.15); set('armR', -2.2 + b * 0.04, 0.1, -0.12); set('weapon', 1.57 + 0.2 + 2.2);
      set('torso', 0.12 + b * 0.02, -0.2); set('legL', -0.45); set('shinL', 0.35); set('legR', 0.3); set('shinR', 0.3);
      bob = -1.1;
    } else if (hoplite && v === 2) {
      // spear grounded and leaning on it, shield resting against the leg
      set('armR', -0.55, 0, -0.25); set('weapon', 0.55, 0, 0.25);
      set('armL', -0.15, 0.1, 0.12); set('torso', 0.06, 0.2 + S(t * 0.37) * 0.1, -0.04);
      set('legL', -0.15, 0, 0.1); set('legR', 0.12, 0, -0.02);
    } else if (hoplite) { set('armL', -0.45, 0.2, 0.32); set('armR', -0.3, 0, -0.3); set('weapon', 0.2, 0, 0.18); }
    if (hoplite && u.order?.type === 'attack' && !hero) {
      // waiting behind the fighting rank: each man picks a guard for a few
      // seconds at a time (own clock), so the rear of a melee is a mix of
      // raised shields, levelled spears and men stepping back, not a
      // parade rank
      const rv = Math.floor(uhash(u, 60 + Math.floor(t / 2.7 + uhash(u, 61) * 5)) * 3);
      const sw = S(t * 2.3) * 0.05;
      bob = 0;
      if (rv === 0) {
        // shield up high against arrows, spear cocked overhand
        set('armL', -1.75 + sw, 0.45, 0.35); set('armR', -2.35, 0.15, -0.3); set('weapon', 1.57 + 0.2 + 2.35);
        set('torso', 0.2, -0.25); set('head', -0.15);
        set('legL', -0.6); set('shinL', 0.5); set('legR', 0.4); set('shinR', 0.45);
        bob = -1.6;
      } else if (rv === 1) {
        // spear levelled at the hip, shield pushed out in front
        set('armR', -0.95, 0.2, -0.35); set('weapon', 1.57 + 0.95 - 0.12, 0, 0.1);
        set('armL', -1.25 + sw, 0.55, 0.35); set('torso', 0.28, 0.3); set('head', -0.25);
        set('legL', -0.8); set('shinL', 0.6); set('legR', 0.55); set('shinR', 0.35);
        bob = -2.0;
      } else {
        // falling back a pace: weight on the rear foot, shield across the body
        set('armL', -1.05, 0.7, 0.2); set('armR', -1.6 + sw, 0.1, -0.4); set('weapon', 1.57 + 1.6 - 0.5);
        set('torso', -0.12, -0.35); set('head', 0.1, 0.3);
        set('legL', -0.15); set('shinL', 0.1); set('legR', 0.7); set('shinR', 0.8);
        bob = -1.2;
      }
    }
    if (archer) archerUpper(u, st, t, set, v % 2);
    if (beast) {
      set('torso', 0.1 + b * 0.03);
      set('armR', -0.25, 0, -0.15); set('armL', b * 0.05, 0, 0.18); set('weapon', 0.4);
      set('legL', -0.15, 0, 0.05); set('shinL', 0.2); set('legR', 0.1, 0, -0.05); set('shinR', 0.2);
      set('foreR', -0.55); set('foreL', -0.3 + b * 0.05);
      bob = -0.3 + b * 0.2;
    }
  }
  if (beast && st === 'walk') { set('foreR', -0.45 + S(t * 7) * 0.2); set('foreL', -0.35 - S(t * 7) * 0.2); }

  // ---- hit reactions: 4 variants, picked afresh for every blow taken ----
  const hr = st === 'die' ? null : hitReact(u);
  if (hr) {
    const w = hr.w;
    const mix = (name, x, y = 0, z = 0) => { const r = out[name]; if (r) { r[0] += (x - r[0]) * w; r[1] += (y - r[1]) * w; r[2] += (z - r[2]) * w; } };
    const hv = beast || hero ? (hr.v === 2 ? 2 : 0) : hr.v;
    const k = beast ? 0.5 : hero ? 0.6 : 1;
    if (hv === 0) {
      // snapped back: head and chest thrown back, arms flung wide, a step back
      add('torso', -0.5 * w * k); add('head', -0.55 * w * k);
      add('armR', 0.35 * w * k, 0, -0.55 * w * k); add('armL', 0, 0, 0.35 * w * k);
      mix('legR', 0.5 * k, 0, -0.05); mix('shinR', 0.4 * k); mix('legL', -0.25 * k);
      fwd -= 0.24 * w * k;
    } else if (hv === 1) {
      // stagger: spun half round by the blow, the near knee giving way
      const sd = hr.side;
      add('torso', 0.15 * w, 0.75 * sd * w, 0.3 * sd * w); add('head', 0.25 * w, 0.45 * sd * w, 0.25 * sd * w);
      add('armR', 0.3 * w, 0, -0.4 * w); add('weapon', -0.5 * w, 0, 0.3 * sd * w);
      mix('legL', -0.55); mix('shinL', 0.9); mix('legR', 0.4, 0, -0.15); mix('shinR', 0.35);
      bob -= 1.6 * w; fwd -= 0.14 * w;
    } else if (hv === 2) {
      // brace: crouched hard behind the raised shield, taking the blow on it
      mix('armL', -1.75 * (beast ? 0.6 : 1), 0.5, 0.2); mix('legL', -0.8 * k); mix('shinL', 1.0 * k); mix('legR', 0.55 * k); mix('shinR', 0.9 * k);
      mix('torso', 0.5 * k, -0.25); mix('head', -0.1);
      bob -= 2.8 * w * k; fwd -= 0.1 * w;
    } else {
      // knocked down to one knee, weapon dropping, head bowed
      mix('legL', -1.45, 0, 0.1); mix('shinL', 1.45); mix('legR', 0.25, 0, -0.1); mix('shinR', 1.65);
      mix('torso', 0.55, 0.2 * hr.side); mix('head', 0.4); mix('armR', -0.35, 0, -0.55); mix('armL', -0.7, 0.2, 0.35);
      mix('weapon', 0.95, 0, 0.2);
      bob -= 6.2 * w; fwd -= 0.16 * w;
    }
  }

  // ---- per-soldier kit angles: no two spears or shields held quite alike ----
  if (u.type === 'hoplite' && st !== 'die') {
    add('weapon', (uhash(u, 11) - 0.5) * 0.3, 0, (uhash(u, 12) - 0.5) * 0.16);
    add('shield', (uhash(u, 13) - 0.5) * 0.25, (uhash(u, 14) - 0.5) * 0.5, (uhash(u, 15) - 0.5) * 0.3);
    add('head', (uhash(u, 17) - 0.5) * 0.2, (uhash(u, 16) - 0.5) * 0.5, (uhash(u, 18) - 0.5) * 0.2);
  }
  // A fighting stance: feet planted apart with daylight between the legs,
  // so each man stands on two legs instead of one post.
  if (!beast && (st === 'idle' || st === 'attack') && u.type !== 'villager') {
    const w = 0.13 + uhash(u, 62) * 0.1;
    add('legL', 0, 0, w); add('legR', 0, 0, -w); add('shinL', 0, 0, -w * 0.6); add('shinR', 0, 0, w * 0.6);
    bob -= w * 2;
  }
  // idle fidgets: every few seconds (own period per man) a soldier shifts
  // his weight, turns to the man beside him and re-grips his weapon, so a
  // waiting rank is never a frozen stamp
  if (st === 'idle' && !beast) {
    const g = smooth((S(t * (0.3 + uhash(u, 42) * 0.25) + uhash(u, 43) * 6.28) - 0.55) * 3);
    const sd = uhash(u, 44) < 0.5 ? 1 : -1;
    add('torso', 0.04 * g, 0.35 * sd * g, 0.05 * sd * g); add('head', 0, 0.4 * sd * g);
    add('legL', -0.2 * g); add('shinL', 0.15 * g); add('legR', 0.1 * g, 0, -0.08 * g);
    add('armR', -0.25 * g); add('weapon', 0.2 * g);
    bob -= 0.4 * g;
  }
  // Shields face the enemy, not the sky: the shield channel cancels the
  // arm's and torso's forward pitch, leaving the face leant back about 20
  // degrees so it still catches the sky light instead of going black.
  if (hoplite && st !== 'die' && out.shield) {
    out.shield[0] -= (out.armL ? out.armL[0] : 0) + (out.torso ? out.torso[0] : 0) + 0.35;
  }
  // archers: each man stands, cants his bow and turns his shoulders a little
  // differently, so a volley line is not one repeated figure
  if (archer && st !== 'die') {
    add('torso', (uhash(u, 50) - 0.5) * 0.12, (uhash(u, 51) - 0.5) * 0.35, 0);
    add('weapon', 0, (uhash(u, 52) - 0.5) * 0.3, (uhash(u, 53) - 0.5) * 0.4);
    add('head', (uhash(u, 54) - 0.5) * 0.25, (uhash(u, 55) - 0.5) * 0.4);
    if (st === 'attack') {
      const wide = uhash(u, 56);
      add('legL', -0.25 * wide, 0, 0.1 * wide); add('legR', 0.2 * wide, 0, -0.12 * wide); add('shinR', 0.2 * wide);
      bob -= wide * 0.5;
    }
  }
  return { bob, lean: 0, fwd };
}

// Hit reaction for the last blow taken (units_hitT / units_hitN are kept by
// Units.update from hp drops): weight 0..1 and a variant chosen per blow.
function hitReact(u) {
  const ht = u.units_hitT;
  if (ht === undefined) return null;
  const n = u.units_hitN || 0;
  const v = Math.floor(uhash(u, 30 + n * 3) * 4);
  const dur = v === 3 ? 1.25 : 0.75;
  if (ht >= dur) return null;
  const w = smooth(ht / 0.07) * (1 - smooth((ht - dur * 0.5) / (dur * 0.5)));
  return { w, v, side: uhash(u, 31 + n * 3) < 0.5 ? 1 : -1 };
}

// Per-soldier kit: helmet (Chalcidian, Corinthian, Attic, pilos), cloak
// (none, long, short) and shield device. Cached on the entity.
export function gearOf(u) {
  if (u.units_gear) return u.units_gear;
  const h = uhash(u, 20), c = uhash(u, 21), s = uhash(u, 22);
  return (u.units_gear = {
    helm: h < 0.3 ? 0 : h < 0.58 ? 1 : h < 0.8 ? 2 : 3,
    cloak: c < 0.45 ? 1 : c < 0.85 ? 2 : 0,
    shield: s < 0.25 ? 0 : s < 0.45 ? 1 : s < 0.8 ? 2 : 3,
    hat: h < 0.4 ? 0 : h < 0.72 ? 1 : 2,
    pennant: uhash(u, 23) < 0.22 ? 1 : 0,
  });
}

// Medusa: a slithering tail (travelling wave down three segments), a coil
// that breathes, and an archer's upper body.
function medusaPose(u, st, t, set, add, v, rec, out) {
  const moving = st === 'walk';
  const f = moving ? 5 : 1.6, amp = moving ? 0.6 : 0.3;
  set('tailA', 0, S(t * f) * amp);
  set('tailB', 0, S(t * f - 1.1) * amp * 1.2);
  set('tailC', 0, S(t * f - 2.2) * amp * 1.4);
  set('coil', 0, S(t * f * 0.5) * 0.05);
  let bob = S(t * f) * 0.3;
  if (st === 'die') {
    const k = smooth(u.anim.dieT / 0.6);
    set('torso', 0.9 * k, 0, 0.2 * k); set('head', 0.4 * k); set('armL', -0.6 * k, 0, 0.5 * k); set('armR', -0.4 * k, 0, -0.6 * k);
    bob = -6 * k;
  } else if (!archerUpper(u, st, t, set, v % 2)) {
    set('torso', 0.05, S(t * 2.5) * 0.12); set('armL', -0.4, 0, 0.1); set('weapon', 0.3); set('armR', -0.3, 0, -0.1);
  }
  if (st === 'attack') set('arrow', 1.55 - out.armR[0], 0, 0);
  add('torso', -0.35 * rec);
  return { bob, lean: 0, fwd: -0.08 * rec };
}

// Horse: rotary gallop with folding cannons, rocking body, nodding neck and a
// rider who absorbs the motion. Idle: ear/tail flicks, head bobs, grazing.
function horsePose(u, st, t, set, add) {
  let bob = 0;
  const moving = st === 'walk';
  if (moving) {
    const p = t * 12;
    // gallop footfall order: BL, BR, FL, FR (phase offsets)
    const leg = (up, cannon, ph, hind) => {
      const s = S(p + ph), c = C(p + ph);
      set(up, (hind ? 0.1 : -0.05) - s * (hind ? 0.55 : 0.75));
      // fold during the swing (when the upper leg is moving forward)
      set(cannon, hind ? Math.max(0, c) * 1.1 + 0.1 : Math.max(0, c) * 1.5 + 0.05);
    };
    leg('legBL', 'cannonBL', 0, true);
    leg('legBR', 'cannonBR', 0.5, true);
    leg('legFL', 'cannonFL', 2.2, false);
    leg('legFR', 'cannonFR', 2.7, false);
    set('body', S(p + 1.2) * 0.07);
    set('neck', 0.05 - S(p + 1.2) * 0.14);
    set('tail', -0.7 + S(p * 0.5) * 0.1, S(p) * 0.15);
    bob = 1.2 + S(p + 2.8) * 1.3;
    set('torso', 0.12 - S(p + 1.2) * 0.1);
    set('head', -0.05);
  } else {
    set('neck', 0.05 + S(t * 0.8) * 0.04);
    // occasional graze when idle and not fighting
    if (st === 'idle') {
      const g = smooth((S(t * 0.19 + u.id) - 0.7) * 5);
      add('neck', g * 0.75);
      set('legFL', -0.05); set('legBR', 0.08); set('cannonBR', 0.35);
    }
    set('tail', -0.2 + S(t * 1.3) * 0.05, S(t * 0.9) * 0.25);
    set('torso', 0.02 + S(t * 1.6) * 0.015);
    set('head', 0, S(t * 0.5) * 0.25);
  }
  // rider arms
  if (st === 'attack') {
    const { extend, wind } = attackPhase(u);
    const arm = -2.3 - wind * 0.3 + extend * 0.6;
    set('armR', arm, 0.1, -0.15);
    set('weapon', 1.57 + 0.45 - arm);
    set('torso', 0.05 + extend * 0.25, -0.2 + extend * 0.35);
    // rearing / stamping with the strike
    set('body', -0.12 * wind + 0.05 * extend);
    set('legFL', -0.6 * wind); set('cannonFL', 1.4 * wind);
    set('neck', -0.2 * wind);
  } else if (st === 'die') {
    const k = smooth(u.anim.dieT / 0.8);
    set('legFL', -0.8 * k); set('legFR', -0.5 * k); set('legBL', 0.6 * k); set('legBR', 0.4 * k);
    set('neck', 0.6 * k); set('armR', -2 * k); set('armL', -1.5 * k);
  } else {
    set('armR', moving ? -0.35 : -0.25, 0, -0.12);
    set('weapon', moving ? 0.9 : 0.25);
  }
  if (st !== 'die') { set('armL', -0.75, 0.2, 0.25); set('shield', 0.1, 1.1, 0); }
  return { bob, lean: 0, fwd: st === 'attack' ? 0.25 * attackPhase(u).extend : 0 };
}
