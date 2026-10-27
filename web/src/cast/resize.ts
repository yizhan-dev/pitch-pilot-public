// A smaller frame over any animation, for the cast's woman (cast.ts, the guide): the baked joints (scripts/
// mixamo_joints.mjs: x, y on the ground, z up, metres; the players are 1.80 m) scaled about a point on the ground,
// and each arm moved in towards the spine along the shoulder line, for narrower shoulders. One frame, in place.

const ARM = ['Shoulder', 'Elbow', 'Wrist', 'Thumb', 'Pinky'];

/** k: the height's factor; inward: metres each arm moves in; x0, y0: the ground point scaled about */
export function resize(f: number[], names: string[], k: number, inward: number, x0: number, y0: number) {
  for (let j = 0; j < names.length; j++) { f[j * 3] = x0 + (f[j * 3] - x0) * k; f[j * 3 + 1] = y0 + (f[j * 3 + 1] - y0) * k; f[j * 3 + 2] *= k; }
  const r = names.indexOf('rShoulder') * 3, l = names.indexOf('lShoulder') * 3;
  let dx = f[r] - f[l], dy = f[r + 1] - f[l + 1], dz = f[r + 2] - f[l + 2];
  const n = Math.hypot(dx, dy, dz) || 1; dx /= n; dy /= n; dz /= n;
  for (const s of ['r', 'l'] as const) {
    const sg = s === 'r' ? -inward : inward;
    for (const a of ARM) { const i = names.indexOf(`${s}${a}`) * 3; f[i] += dx * sg; f[i + 1] += dy * sg; f[i + 2] += dz * sg; }
  }
}
