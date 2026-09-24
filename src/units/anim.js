// Procedural voxel-part animation. pose(kind, u, t) fills `out` with
// per-part euler rotations [rx, ry, rz] and returns root offsets.
// Conventions: facing +z; a hanging limb swings forward with negative rx.

const S = Math.sin;

export function pose(kind, u, out) {
  const a = u.anim;
  const st = a.state;
  const t = a.t;
  let bob = 0, lean = 0;
  for (const k in out) { const r = out[k]; r[0] = r[1] = r[2] = 0; }
  const set = (name, x, y = 0, z = 0) => { const r = out[name]; if (r) { r[0] = x; r[1] = y; r[2] = z; } };

  if (kind === 'horse') {
    if (st === 'walk' || st === 'charge') {
      const p = t * 11;
      set('legFL', S(p) * 0.8); set('legFR', S(p + 0.6) * 0.8);
      set('legBL', S(p + Math.PI) * 0.8); set('legBR', S(p + Math.PI + 0.6) * 0.8);
      set('neck', 0.15 + S(p * 2) * 0.08);
      set('body', S(p * 2) * 0.03);
      bob = Math.abs(S(p)) * 0.6;
    } else {
      set('neck', 0.1 + S(t * 0.8) * 0.06);
    }
    if (st === 'attack') {
      const k = Math.min(1, (a.attackT ?? 1) / 0.35);
      set('armR', -2.6 + k * 2.0);
    } else set('armR', -0.3);
    set('armL', -0.5, 0, -0.2);
    return { bob, lean };
  }

  if (st === 'walk') {
    const p = t * 9;
    set('legL', S(p) * 0.7); set('legR', -S(p) * 0.7);
    set('armL', -S(p) * 0.55); set('armR', S(p) * 0.55);
    bob = Math.abs(S(p)) * 0.5;
    set('torso', 0.05);
  } else if (st === 'gather' || st === 'build') {
    const sp = st === 'build' ? 8 : 6;
    const s = S(t * sp);
    set('armR', -1.25 - s * 0.95);
    set('armL', -0.9 - s * 0.4);
    set('torso', 0.18 + s * 0.1);
    set('head', 0.2);
    set('legL', -0.15); set('legR', 0.2);
  } else if (st === 'worship') {
    const s = S(t * 2);
    set('armL', -2.6 + s * 0.2, 0, 0.3); set('armR', -2.6 + s * 0.2, 0, -0.3);
    set('head', -0.3);
    set('torso', -0.08);
  } else if (st === 'attack') {
    const k = Math.min(1, (a.attackT ?? 1) / 0.35);
    if (kind === 'archer') {
      set('armL', -1.5, 0.15); // bow arm forward
      set('armR', -1.5 + (1 - k) * 0.1, -0.5 * k);
      set('torso', 0, 0.3);
    } else {
      set('armR', -2.5 + k * 2.1);
      set('armL', -0.9);
      set('torso', 0.25 * (1 - k) - 0.05);
      set('legL', -0.3); set('legR', 0.25);
    }
  } else {
    set('armL', S(t * 1.6) * 0.04, 0, 0.05); set('armR', -S(t * 1.6) * 0.04, 0, -0.05);
    set('head', 0, S(t * 0.6) * 0.25);
    if (kind === 'archer') set('armL', -0.3);
  }
  return { bob, lean };
}
