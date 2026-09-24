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

// Attack timeline from attackT (seconds since the strike) and the cooldown:
//   strike 0..0.12 (extend), recover 0.12..0.45, then guard -> wind-up.
function attackPhase(u) {
  const a = u.anim.attackT ?? 1;
  const cd = u.def?.attack?.cooldown ?? 1.2;
  const extend = a < 0.1 ? smooth(a / 0.1) : 1 - smooth((a - 0.1) / 0.35);
  const wind = smooth((a - 0.45) / Math.max(0.2, cd - 0.55));
  return { a, cd, extend: a < 0.45 ? extend : 0, wind: a < 0.45 ? 0 : wind };
}

export function pose(kind, u, out) {
  const an = u.anim;
  const st = an.state;
  const t = an.t + phaseOf(u) * 0.3;
  for (const k in out) { const r = out[k]; r[0] = r[1] = r[2] = 0; }
  const set = (name, x, y = 0, z = 0) => { const r = out[name]; if (r) { r[0] = x; r[1] = y; r[2] = z; } };
  const add = (name, x, y = 0, z = 0) => { const r = out[name]; if (r) { r[0] += x; r[1] += y; r[2] += z; } };

  if (kind === 'horse') return horsePose(u, st, t, set, add);

  const beast = kind === 'beast';
  const archer = kind === 'archer';
  const hoplite = u.type === 'hoplite';
  let bob = 0;

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
    if (hoplite || u.type === 'hippikon') {
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
      const draw = a < 0.1 ? 0 : a < 0.45 ? 0 : smooth((a - 0.45) / 0.6);
      set('torso', 0.02, 0.55, 0);
      set('head', 0, -0.45);
      set('armL', -1.5, -0.45, 0.05);
      set('weapon', 1.5, 0, 0);                      // bow upright, belly forward
      set('armR', a < 0.45 ? ease(-1.4, -2.5, smooth((a - 0.08) / 0.3)) : ease(-1.55, -1.5, draw), a < 0.45 ? 0 : ease(0.25, 0.9, draw), 0);
      set('arrow', 1.55 - (out.armR ? out.armR[0] : 0), 0, 0);
      set('legL', -0.25); set('legR', 0.25); set('shinR', 0.15);
    } else if (beast) {
      // huge overhead chop with both arms
      const up = wind * 1.0, down = extend;
      const arm = -1.1 - up * 1.9 + down * 0.7;
      set('armR', arm, 0, -0.15); set('armL', arm + 0.1, 0, 0.35);
      set('weapon', 0.4 + down * 0.4);
      set('torso', -0.15 * up + 0.4 * down, 0.1);
      set('head', 0.2 * down - 0.1 * up);
      set('legL', -0.45); set('shinL', 0.3); set('legR', 0.35); set('shinR', 0.25);
      bob = -1.5 * down;
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
    } else {
      // villager: axe/fists, overhead strike
      const arm = -1.0 - wind * 1.6 + extend * 0.8;
      set('armR', arm, 0, -0.1); set('armL', -0.8, 0, 0.15);
      set('torso', 0.15 + extend * 0.2);
      set('legL', -0.3); set('legR', 0.25);
    }
  } else if (st === 'die') {
    const k = smooth(an.dieT / 0.6);
    set('armL', -2.4 * k, 0, 0.6 * k); set('armR', -2.2 * k, 0, -0.7 * k);
    set('legL', -0.5 * k); set('shinL', 0.6 * k); set('legR', 0.2 * k); set('shinR', 0.3 * k);
    set('head', -0.4 * k);
  } else {
    // idle: breathing, weight shift, glances
    const b = S(t * 1.7);
    set('torso', 0.02 + b * 0.015, S(t * 0.37) * 0.06);
    set('head', S(t * 0.9) * 0.04, S(t * 0.53) * 0.3 * clamp01(S(t * 0.21) * 3));
    set('armL', b * 0.03, 0, 0.07); set('armR', -b * 0.03, 0, -0.07);
    set('legL', -0.04, 0, 0.03); set('legR', 0.04, 0, -0.03);
    if (hoplite) { set('armL', -0.4, 0.2, 0.1); set('armR', -0.25, 0, -0.1); set('weapon', 0.2); }
    if (archer) { set('armL', -0.25, 0, 0.08); set('weapon', 0.25); }
    if (beast) {
      set('torso', 0.1 + b * 0.03);
      set('armR', -0.25, 0, -0.15); set('armL', b * 0.05, 0, 0.18); set('weapon', 0.4);
      set('legL', -0.15, 0, 0.05); set('shinL', 0.2); set('legR', 0.1, 0, -0.05); set('shinR', 0.2);
      bob = -0.3 + b * 0.2;
    }
  }
  return { bob, lean: 0 };
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
  return { bob, lean: 0 };
}
