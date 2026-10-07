// Per-vertex outline push directions for voxel unit meshes (the inverted hull
// of godot/game/units/unit_outline.gdshader). A voxel mesh has a separate copy
// of every corner per face, so pushing each face along its own normal splits
// the hull into offset squares with gaps at every edge and step: the jagged
// black fringes along voxel edges. Here every copy of a corner gets the same
// direction, the sum of the distinct face normals meeting there (each axis
// -1 / 0 / 1), so the hull stays closed. Coded in one byte (extra.b):
// 1 + (x + 1) + 3 (y + 1) + 9 (z + 1); 0 = none (push along the normal).
// flatY: (round 33, the Egyptian fine limbs) no vertical push: the ledges of
// a finely stepped limb are not lifted, so the hull never pokes through them
export function outlineCodes(geo, { flatY = false } = {}) {
  const a = geo.attributes;
  const n = a.position.count;
  // (round 39) a mesh shaded with smooth normals keeps its faces' own normals here
  const N = geo.userData?.faceNormal || a.normal;
  const key = (i) => `${Math.round(a.position.getX(i) * 1e4)},${Math.round(a.position.getY(i) * 1e4)},${Math.round(a.position.getZ(i) * 1e4)}`;
  const corners = new Map();
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = (keys[i] = key(i));
    let c = corners.get(k);
    if (!c) corners.set(k, (c = new Set()));
    c.add(`${Math.round(N.getX(i))},${Math.round(N.getY(i))},${Math.round(N.getZ(i))}`);
  }
  const code = new Map();
  for (const [k, set] of corners) {
    const d = [0, 0, 0];
    for (const sn of set) sn.split(',').forEach((v, j) => { d[j] += +v; });
    const cl = d.map((v) => Math.max(-1, Math.min(1, v)));
    if (flatY && (cl[0] || cl[2])) cl[1] = 0;
    code.set(k, (cl[0] || cl[1] || cl[2]) ? 1 + (cl[0] + 1) + 3 * (cl[1] + 1) + 9 * (cl[2] + 1) : 0);
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = code.get(keys[i]);
  return out;
}
