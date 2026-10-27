// Arms bent to hold something in front with both hands, over any animation (the gamer's controller: no Mixamo clip
// we have keeps the hands together). One frame of the baked joints (scripts/mixamo_joints.mjs: x, y on the ground, z
// up, metres) is changed in place: each wrist is put at a point in the torso's frame and the elbow found by two-bone
// IK, bending down and out; the thumb and little finger are set so the fists face each other, thumbs up.

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => mul(a, 1 / (len(a) || 1));
const sum = (...vs: [V, number][]): V => vs.reduce<V>((o, [v, k]) => add(o, mul(v, k)), [0, 0, 0]);

/** where the wrists go, metres from the neck in the torso's frame: forward, down, and out to each side */
export interface Grip { fwd: number; down: number; apart: number }
export const PAD: Grip = { fwd: 0.32, down: 0.36, apart: 0.075 };

export function holdInFront(f: number[], names: string[], g: Grip = PAD) {
  const ix = (n: string) => names.indexOf(n);
  const get = (n: string): V => { const i = ix(n) * 3; return [f[i], f[i + 1], f[i + 2]]; };
  const set = (n: string, v: V) => { const i = ix(n) * 3; f[i] = v[0]; f[i + 1] = v[1]; f[i + 2] = v[2]; };
  const neck = get('neck'), up = unit(sub(neck, get('midHip')));
  let right = sub(get('rShoulder'), get('lShoulder')); right = unit(sub(right, mul(up, dot(right, up))));
  let fwd = cross(up, right);
  if (dot(fwd, sub(get('nose'), neck)) < 0) { fwd = mul(fwd, -1); }
  for (const s of ['r', 'l'] as const) {
    const out = s === 'r' ? right : mul(right, -1);
    const S = get(`${s}Shoulder`), E0 = get(`${s}Elbow`), W0 = get(`${s}Wrist`);
    const a = len(sub(E0, S)), b = len(sub(W0, E0));
    const W = sum([neck, 1], [fwd, g.fwd], [up, -g.down], [out, g.apart]);
    let d = sub(W, S); const dl = Math.min(len(d), a + b - 1e-3); d = unit(d);
    const Wc = add(S, mul(d, dl));
    // the elbow: x along the shoulder-to-wrist line, h off it towards the pole (down, out, a little back)
    const x = (a * a - b * b + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, a * a - x * x));
    let pole = sum([up, -1], [out, 0.7], [fwd, -0.2]); pole = unit(sub(pole, mul(d, dot(pole, d))));
    const E = sum([S, 1], [d, x], [pole, h]);
    // the hand: from the wrist forward and in, the thumb above the little finger
    const T0 = get(`${s}Thumb`), P0 = get(`${s}Pinky`), mid0 = mul(add(T0, P0), 0.5);
    const hl = len(sub(mid0, W0)), half = len(sub(T0, P0)) / 2;
    const dir = unit(sum([fwd, 1], [out, -0.45], [up, 0.15]));
    const mid = add(Wc, mul(dir, hl));
    set(`${s}Elbow`, E); set(`${s}Wrist`, Wc);
    set(`${s}Thumb`, add(mid, mul(up, half))); set(`${s}Pinky`, add(mid, mul(up, -half)));
  }
}
