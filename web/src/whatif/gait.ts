// Bodies from the real strides: the nuance of the tracked players' running skeletons, with the Mixamo assets beside
// them, so each player in the forked version is animated to his spot.
// The library (private/hawkeye/gait_build.py; /data/models/gait.json + gait.bin, sealed in a release like the clips)
// holds about a second-long runs of the match's tracked players, each frame in the man's body frame (the hips' centre
// at the origin, his torso facing +y, +x a quarter turn clockwise of it, as motion.ts's clips) with the root he had on
// the pitch beside it. A simulated player has a path on the ground and nothing else, so every 0.2 s the matcher picks
// the frame of the library that best continues his pose along that path (motion matching: his feet where they are and
// moving as they move, his hips moving as the path moves, the path's next 0.2 / 0.4 / 0.6 s and where he should face
// then), his own strides first and every player's as the pool, plays on from it (the clip's turning carried into his
// facing, its frames advanced by the ground he covers so the feet slide little), and smooths the join by carrying the
// difference of the two poses and letting it decay. At the pause the pose he continues from is his real one, so the
// first stride follows it. The Mixamo pack keeps the acts laid over (branch.ts: kick, touch, tackle) and remains the
// fallback (motion.ts) when the library is not there.
import { modelFile } from '../data/paths';
import { hooked } from '../dev';
import type { Joints } from '../data';
import type { FacingOpts, Track } from './motion';

export interface GaitHead { fps: number; names: string[]; frames: number; players: { pid: string; keeper: boolean; start: number; end: number }[]; segs: [number, number][] }
export interface GaitLib extends GaitHead {
  nJ: number;
  /** int16 millimetres, frames × nJ × 3, the body frame */
  pose: Int16Array;
  /** float32 frames × 3: the hips' centre on the pitch (m) and the facing (rad, unwrapped within a run) */
  root: Float32Array;
  /** each frame's run: its first frame and the one past its last */
  segStart: Int32Array; segEnd: Int32Array;
  /** the root's speed (m/s) */
  speed: Float32Array;
  /** the matching features, normalised and weighted (D a frame); `valid`: the frame has 0.6 s of its run ahead */
  feat: Float32Array; valid: Uint8Array; mu: Float32Array; sd: Float32Array;
  /** the valid frames in order of speed, for the pool's search window */
  order: Int32Array; orderSpeed: Float32Array;
  byPid: Map<string, number>;
  /** each frame: the tracked feet down (bit 1 the left, 2 the right: the ankle low and nearly still in the world), for
   *  the foot lock at playback; the frame's player; each player's standing height (the nose's 95th percentile), by
   *  which another man's strides are scaled to him (1.54-1.82 m in this match) */
  planted: Uint8Array; owner: Uint8Array; heights: Float32Array;
}

/** the features: the feet (position and velocity, body frame), the hips' height, the root's velocity (body frame),
 *  the root's position 0.2 / 0.4 / 0.6 s on (body frame), and the facing 0.2 and 0.6 s on against the present one */
const H1 = 5, H2 = 10, H3 = 15, D = 25;
const WEIGHT = [1, 1, 1, 1, 1, 1, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.5, 1, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 0.6, 0.6, 0.8, 0.8];
/** the pool's handicap against a man's own strides (normalised units²), the search window about the path's speed
 *  (m/s), how much better a new frame must be before the clip playing is left, the joins' decay (s), the pull of the
 *  wanted facing a frame (the match does most of the turning; this keeps a long run from drifting) */
const POOL_PEN = 1.0, SPEED_WIN = 1.2, STAY = 1.15, TAU = 0.1, TAU_W = 0.3, REMATCH = 5, TURN = 2.5;
/** the pull of the wanted facing a frame: on the move (the strides carry the turning) and standing (nothing else turns
 *  him); `(globalThis).__gaitOpts` overrides them for the sweeps of scripts/gait_check.ts */
const PULL_MOVE = 0.06, PULL_STILL = 0.12;
/** a foot counts as down in the library below PLANT_Z (m, the ankle) and PLANT_V (m/s); at playback a foot down is
 *  held where it landed (the strides advance by the ground covered, but not exactly, and the tracked feet slide
 *  0.55 m/s at the median themselves), the knee following halfway, the hold let go over TAU_LOCK once it lifts, or
 *  re-planted when the body has moved LOCK_MAX from it */
const PLANT_Z = 0.2, PLANT_V = 0.7, LOCK_MAX = 0.35, TAU_LOCK = 0.06, TAU_DRIFT = 0.15;
type Tuning = { pullMove: number; pullStill: number; lockMax: number; tauLock: number; tauDrift: number };
const tuning = (): Tuning => ({ pullMove: PULL_MOVE, pullStill: PULL_STILL, lockMax: LOCK_MAX, tauLock: TAU_LOCK, tauDrift: TAU_DRIFT, ...(hooked<Partial<Tuning>>('gaitOpts') ?? {}) });

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** the facing asked of the matcher and of the pull: the run's direction (weight speed²) against the ball's pull,
 *  motion.ts's weights (measured on five clips against the tracked bodies: with the pull below the facing
 *  is 13° off at the median, 31° at the 80th percentile; Mixamo's loops 11° / 27°, the strides with a tenth of the
 *  pull 16° / 38°) */
export const GAIT_FACING: FacingOpts = { ball: 2.2, keeperBall: 12, ease: 0 };

let libP: Promise<GaitLib | null> | null = null;
/** the library, fetched once; null when it is not there (motion.ts then does the bodies) */
export const loadGait = (): Promise<GaitLib | null> => (libP ??= (async () => {
  try {
    const [h, b] = await Promise.all([fetch(modelFile('gait.json')), fetch(modelFile('gait.bin'))]);
    if (!h.ok || !b.ok) return null;
    return parseGait(await h.json() as GaitHead, await b.arrayBuffer());
  } catch { return null; }
})());

/** the library from its two files: the runs, the speeds, the features and their normalisation, the speed order */
export function parseGait(head: GaitHead, buf: ArrayBuffer): GaitLib {
  const n = head.frames, nJ = head.names.length, dt = 1 / head.fps;
  const pose = new Int16Array(buf, 0, n * nJ * 3);
  const root = new Float32Array(buf.slice(n * nJ * 6, n * nJ * 6 + n * 12));   // a copy: the offset need not be aligned
  const segStart = new Int32Array(n), segEnd = new Int32Array(n), speed = new Float32Array(n), valid = new Uint8Array(n);
  for (const [s, e] of head.segs) for (let i = s; i < e; i++) { segStart[i] = s; segEnd[i] = e; }
  const lA = head.names.indexOf('lAnkle'), rA = head.names.indexOf('rAnkle'), hip = head.names.indexOf('midHip');
  const P = (i: number, j: number, k: number) => pose[(i * nJ + j) * 3 + k] / 1000;
  const rvel = (i: number, k: number) => { const a = Math.max(segStart[i], i - 1), b = Math.min(segEnd[i] - 1, i + 1); return b > a ? (root[b * 3 + k] - root[a * 3 + k]) / ((b - a) * dt) : 0; };
  for (let i = 0; i < n; i++) { speed[i] = Math.hypot(rvel(i, 0), rvel(i, 1)); valid[i] = i + H3 < segEnd[i] ? 1 : 0; }
  const feat = new Float32Array(n * D), raw = new Float32Array(D);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    rawFeatures(raw, (j, k) => P(i, j, k), (j, k) => { const a = Math.max(segStart[i], i - 1), b = Math.min(segEnd[i] - 1, i + 1); return b > a ? (P(b, j, k) - P(a, j, k)) / ((b - a) * dt) : 0; },
      P(i, hip, 2), rvel(i, 0), rvel(i, 1), (h) => [root[(i + h) * 3] - root[i * 3], root[(i + h) * 3 + 1] - root[i * 3 + 1]], (h) => root[(i + h) * 3 + 2] - root[i * 3 + 2], lA, rA, hip, root[i * 3 + 2]);
    feat.set(raw, i * D);
  }
  // normalised by the library's own spread, then weighted
  const mu = new Float32Array(D), sd = new Float32Array(D);
  let m = 0;
  for (let i = 0; i < n; i++) if (valid[i]) { m++; for (let d = 0; d < D; d++) mu[d] += feat[i * D + d]; }
  for (let d = 0; d < D; d++) mu[d] /= Math.max(1, m);
  for (let i = 0; i < n; i++) if (valid[i]) for (let d = 0; d < D; d++) sd[d] += (feat[i * D + d] - mu[d]) ** 2;
  for (let d = 0; d < D; d++) sd[d] = Math.sqrt(sd[d] / Math.max(1, m)) || 1;
  // the facing's change stays on its own scale (a unit vector): players seldom turn within 0.2 s, so its spread is
  // tiny, and normalised by it a wanted turn outweighed everything else and picked the spinning frames
  for (let d = 21; d < D; d++) { mu[d] = 0; sd[d] = 1; }
  for (let i = 0; i < n; i++) if (valid[i]) for (let d = 0; d < D; d++) feat[i * D + d] = ((feat[i * D + d] - mu[d]) / sd[d]) * WEIGHT[d];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (valid[i]) idx.push(i);
  idx.sort((a, b) => speed[a] - speed[b]);
  const order = Int32Array.from(idx), orderSpeed = Float32Array.from(idx, (i) => speed[i]);
  // the feet down, each frame's player, each player's height
  const planted = new Uint8Array(n), owner = new Uint8Array(n), heights = new Float32Array(head.players.length), nose = head.names.indexOf('nose');
  const footW = (i: number, j: number, k: number) => { const yaw = root[i * 3 + 2], s = Math.sin(yaw), c = Math.cos(yaw), bx = P(i, j, 0), by = P(i, j, 1); return k === 0 ? root[i * 3] + bx * s + by * c : root[i * 3 + 1] - bx * c + by * s; };
  for (let i = 0; i < n; i++) {
    const a = Math.max(segStart[i], i - 1), b = Math.min(segEnd[i] - 1, i + 1), span = (b - a) * dt || dt;
    let bits = 0;
    for (const [j, bit] of [[lA, 1], [rA, 2]] as const) if (Math.hypot(footW(b, j, 0) - footW(a, j, 0), footW(b, j, 1) - footW(a, j, 1)) / span < PLANT_V && P(i, j, 2) < PLANT_Z) bits |= bit;
    planted[i] = bits;
  }
  head.players.forEach((p, q) => {
    for (let i = p.start; i < p.end; i++) owner[i] = q;
    const zs: number[] = []; for (let i = p.start; i < p.end; i += 3) zs.push(P(i, nose, 2)); zs.sort((x, y) => x - y);
    heights[q] = zs[Math.floor(zs.length * 0.95)] ?? 1.7;
  });
  return { ...head, nJ, pose, root, segStart, segEnd, speed, feat, valid, mu, sd, order, orderSpeed, byPid: new Map(head.players.map((p, i) => [p.pid, i])), planted, owner, heights };
}

/** the raw features into `out`, from accessors in the body frame of the present facing: a joint's position and
 *  velocity, the hips' height, the root's world velocity, the root's world offset h frames on, the facing's change */
function rawFeatures(out: Float32Array, pos: (j: number, k: number) => number, vel: (j: number, k: number) => number, hipZ: number, vx: number, vy: number,
  ahead: (h: number) => [number, number], turn: (h: number) => number, lA: number, rA: number, hip: number, yaw?: number) {
  void hip;
  for (let k = 0; k < 3; k++) { out[k] = pos(lA, k); out[3 + k] = pos(rA, k); out[6 + k] = vel(lA, k); out[9 + k] = vel(rA, k); }
  out[12] = hipZ;
  // the library's root velocity and offsets are world vectors about its own frame's facing; the query gives them in
  // the body frame already (yaw undefined), the library turns them here
  const toBody = (x: number, y: number): [number, number] => { if (yaw === undefined) return [x, y]; const s = Math.sin(yaw), c = Math.cos(yaw); return [x * s - y * c, x * c + y * s]; };
  [out[13], out[14]] = toBody(vx, vy);
  [H1, H2, H3].forEach((h, q) => { const [ax, ay] = ahead(h); [out[15 + q * 2], out[16 + q * 2]] = toBody(ax, ay); });
  out[21] = Math.cos(turn(H1)); out[22] = Math.sin(turn(H1)); out[23] = Math.cos(turn(H3)); out[24] = Math.sin(turn(H3));
}

/** the torso's facing on the ground from a world pose: up × (right − left) at the shoulders and the hips, the way it
 *  points by a vote of the toes (ahead of the heels) and the nose (ahead of the neck), as the library was cut (the
 *  nose alone turns round when he looks over his shoulder) */
export function facingOf(get: (j: number, k: number) => number, names: string[]): number {
  const ix = (n: string) => names.indexOf(n), rS = ix('rShoulder'), lS = ix('lShoulder'), rH = ix('rHip'), lH = ix('lHip'), no = ix('nose'), ne = ix('neck');
  const rT = ix('rBigToe'), rE = ix('rHeel'), lT = ix('lBigToe'), lE = ix('lHeel');
  const sx = get(rS, 0) - get(lS, 0) + get(rH, 0) - get(lH, 0), sy = get(rS, 1) - get(lS, 1) + get(rH, 1) - get(lH, 1);
  let fx = -sy, fy = sx;
  const tx = get(rT, 0) - get(rE, 0) + get(lT, 0) - get(lE, 0), ty = get(rT, 1) - get(rE, 1) + get(lT, 1) - get(lE, 1), tl = Math.hypot(tx, ty) || 1;
  const nx = get(no, 0) - get(ne, 0), ny = get(no, 1) - get(ne, 1), nl = Math.hypot(nx, ny) || 1;
  if (fx * (tx / tl + 0.5 * nx / nl) + fy * (ty / tl + 0.5 * ny / nl) < 0) { fx = -fx; fy = -fy; }
  return Math.atan2(fy, fx);
}

/** where he continues from: the real joints (the clip's, or the previous branch's), output frame `pre` being frame
 *  `f0` of them */
export interface GaitStart { J: Joints; f0: number; pre: number }

/** joints for every track at fps from the library: `pids` names each track's player (the library's own strides come
 *  first for him; null, or a player it lacks, draws on the pool alone); `start` the pose each continues from */
/** the library fits a clip's joints (the same names in the same order); branch.ts falls back to the Mixamo loops
 *  when it does not, instead of a throw that left the mode in 'computing' */
export const gaitFits = (lib: GaitLib, names: string[]) => names.length === lib.nJ && names.every((n, j) => lib.names[j] === n);
export function synthesizeGait(lib: GaitLib, tracks: Track[], ball: ([number, number] | null)[], fps: number, nAtt: number, names: string[], pids: (string | null)[], start: GaitStart | null, opts: FacingOpts = GAIT_FACING): Joints {
  const nJ = names.length, F = tracks[0]?.pos.length ?? 0, P = tracks.length, dt = 1 / fps, out = new Float32Array(F * P * nJ * 3);
  if (!gaitFits(lib, names)) throw new Error('gait: the joints differ from the library');
  const lA = names.indexOf('lAnkle'), rA = names.indexOf('rAnkle'), hip = names.indexOf('midHip');
  const FOOT = { l: ['lAnkle', 'lHeel', 'lBigToe', 'lSmallToe'].map((n) => names.indexOf(n)), r: ['rAnkle', 'rHeel', 'rBigToe', 'rSmallToe'].map((n) => names.indexOf(n)) }, KNEE = { l: names.indexOf('lKnee'), r: names.indexOf('rKnee') };
  const meanHeight = lib.heights.reduce((a, b) => a + b, 0) / Math.max(1, lib.heights.length);
  const Q = new Float32Array(D), raw = new Float32Array(D), tune = tuning();
  const dist2 = (i: number, bound: number) => { let c = 0; const o = i * D; for (let d = 0; d < D; d++) { const x = Q[d] - lib.feat[o + d]; c += x * x; if (c > bound) return c; } return c; };
  const lower = (x: number) => { let lo = 0, hi = lib.orderSpeed.length; while (lo < hi) { const m = (lo + hi) >> 1; if (lib.orderSpeed[m] < x) lo = m + 1; else hi = m; } return lo; };
  const poseAt = (c: number, j: number, k: number, sc = 1) => { const a = Math.floor(c), b = Math.min(lib.segEnd[a] - 1, a + 1), u = c - a; return ((lib.pose[(a * nJ + j) * 3 + k] * (1 - u) + lib.pose[(b * nJ + j) * 3 + k] * u) / 1000) * sc; };
  const yawAt = (c: number) => { const a = Math.floor(c), b = Math.min(lib.segEnd[a] - 1, a + 1), u = c - a; return lib.root[a * 3 + 2] * (1 - u) + lib.root[b * 3 + 2] * u; };
  tracks.forEach((tr, p) => {
    const pid = pids[p], ownIdx = pid !== null ? lib.byPid.get(pid) ?? -1 : -1, own = ownIdx >= 0 ? lib.players[ownIdx] : null;
    // another man's strides scaled to his height
    const hTarget = ownIdx >= 0 ? lib.heights[ownIdx] : meanHeight, scaleOf = (f: number) => { const q = lib.owner[f]; return q === ownIdx ? 1 : hTarget / (lib.heights[q] || hTarget); };
    const lock = { l: { on: false, wait: false, x: 0, y: 0, sx: 0, sy: 0 }, r: { on: false, wait: false, x: 0, y: 0, sx: 0, sy: 0 } };
    const h = 3, vel0 = (i: number): [number, number] => { const a = tr.pos[Math.max(0, i - h)], b = tr.pos[Math.min(F - 1, i + h)], span = (Math.min(F - 1, i + h) - Math.max(0, i - h)) * dt; return span > 0 ? [(b[0] - a[0]) / span, (b[1] - a[1]) / span] : [0, 0]; };
    // past the track's end the path carries on at its last speed: looked at as it was, the end read as a stop 0.6 s
    // early, and the matcher chose slowing strides while the hips still ran (the receiver slid to the ball)
    const vEnd = vel0(Math.max(0, F - 4));
    const vel = (k: number): [number, number] => (k <= F - 1 ? vel0(k) : vEnd);
    const pos = (k: number): [number, number] => (k <= F - 1 ? tr.pos[k] : [tr.pos[F - 1][0] + vEnd[0] * (k - (F - 1)) * dt, tr.pos[F - 1][1] + vEnd[1] * (k - (F - 1)) * dt]);
    // the facing he wants: the run's direction weighted by speed squared, the ball's by a constant (motion.ts)
    const want = (i: number, phi: number) => {
      const [vx, vy] = vel(i), s = Math.hypot(vx, vy), b = ball[Math.min(F - 1, i)], wb = tr.keeper ? opts.keeperBall : opts.ball, q = pos(i);
      let fx = vx * s, fy = vy * s;
      if (b) { const bx = b[0] - q[0], by = b[1] - q[1], d = Math.hypot(bx, by) || 1; fx += (wb * bx) / d; fy += (wb * by) / d; }
      return fx === 0 && fy === 0 ? phi : Math.atan2(fy, fx);
    };
    const last = new Float32Array(nJ * 3), prev = new Float32Array(nJ * 3), offB = new Float32Array(nJ * 3);
    let phi = NaN, cursor = -1, since = REMATCH, offW: [number, number] = [0, 0], i0 = 0, have = false, sc = 1;
    if (start) {
      const { J, f0, pre } = start, SP = J.players;
      const at = (f: number, j: number, k: number) => J.data[((f * SP + p) * nJ + j) * 3 + k];
      for (let i = 0; i <= pre && i < F; i++) { const f = Math.max(0, f0 - pre + i), o = (i * P + p) * nJ * 3; for (let j = 0; j < nJ; j++) for (let k = 0; k < 3; k++) out[o + j * 3 + k] = at(f, j, k); }
      for (let j = 0; j < nJ; j++) for (let k = 0; k < 3; k++) { last[j * 3 + k] = at(f0, j, k); prev[j * 3 + k] = at(Math.max(0, f0 - 1), j, k); }
      phi = facingOf((j, k) => last[j * 3 + k], names);
      offW = [last[hip * 3] - tr.pos[Math.min(F - 1, pre)][0], last[hip * 3 + 1] - tr.pos[Math.min(F - 1, pre)][1]];
      i0 = pre + 1; have = true;
    }
    for (let i = i0; i < F; i++) {
      const [vx, vy] = vel(i), s = Math.hypot(vx, vy);
      if (Number.isNaN(phi)) phi = want(i, Math.atan2(vy, vx));
      const sn = Math.sin(phi), cs = Math.cos(phi);
      const toB = (x: number, y: number): [number, number] => [x * sn - y * cs, x * cs + y * sn];
      if (since >= REMATCH || cursor < 0 || cursor + 1 >= lib.segEnd[Math.floor(cursor)] - 1) {
        // the query: his present pose about his present hips, in the body frame of his present facing
        const hx = have ? last[hip * 3] : tr.pos[i][0] + offW[0], hy = have ? last[hip * 3 + 1] : tr.pos[i][1] + offW[1];
        // (no pose yet, before any frame: the feet neutral, raw[0..12] set to the library's means below)
        const bpos = (j: number, k: number) => { if (!have) return 0; if (k === 2) return last[j * 3 + 2]; const [bx, by] = toB(last[j * 3] - hx, last[j * 3 + 1] - hy); return k === 0 ? bx : by; };
        // (a joint's velocity about the hips, as the library holds it: his travel taken out)
        const bvel = (j: number, k: number) => { if (!have) return 0; const d = (q: number) => last[j * 3 + q] - prev[j * 3 + q] - (last[hip * 3 + q] - prev[hip * 3 + q]); if (k === 2) return d(2) / dt; const [bx, by] = toB(d(0), d(1)); return (k === 0 ? bx : by) / dt; };
        const ahead = (hh: number): [number, number] => { const q = pos(i + hh); return toB(q[0] - tr.pos[i][0], q[1] - tr.pos[i][1]); };
        const [bvx, bvy] = toB(vx, vy);
        // (the facing he wants, asked for at the pace a man turns: within TURN a second of the present one)
        const turnTo = (hh: number) => { const d = wrapA(want(i + hh, phi) - phi), cap = TURN * hh * dt; return Math.max(-cap, Math.min(cap, d)); };
        rawFeatures(raw, bpos, bvel, have ? last[hip * 3 + 2] : lib.mu[12], bvx, bvy, ahead, turnTo, lA, rA, hip);
        if (!have) for (let d = 0; d < 13; d++) raw[d] = lib.mu[d];   // no pose yet: the feet neutral
        for (let d = 0; d < D; d++) Q[d] = ((raw[d] - lib.mu[d]) / lib.sd[d]) * WEIGHT[d];
        let best = -1, bestC = Infinity;
        if (own) for (let f = own.start; f < own.end; f++) { if (!lib.valid[f]) continue; const c = dist2(f, bestC); if (c < bestC) { bestC = c; best = f; } }
        const lo = lower(s - SPEED_WIN), hi = lower(s + SPEED_WIN);
        for (let k = lo; k < hi; k++) { const f = lib.order[k]; if (own && f >= own.start && f < own.end) continue; const c = dist2(f, bestC - POOL_PEN) + POOL_PEN; if (c < bestC) { bestC = c; best = f; } }
        const cont = cursor >= 0 ? Math.round(cursor) : -1;
        // nothing found (a path with a NaN in it, a speed past every run's): the clip playing goes on, or the slowest
        // valid frame starts him, rather than a frame -1 and a body of NaNs
        if (best < 0) { best = cont >= 0 ? cont : lib.order[0]; bestC = Infinity; }
        const stay = cont >= 0 && lib.valid[cont] && dist2(cont, Infinity) <= bestC * STAY + 0.05;
        const dbg = hooked<unknown[]>('gaitLog');
        if (dbg) dbg.push({ p, i, best, bestC, cont, stay, phi, speed: s, dbSpeed: best >= 0 ? lib.speed[best] : null, dbYaw: best >= 0 ? lib.root[best * 3 + 2] : null, seg: best >= 0 ? [lib.segStart[best], lib.segEnd[best]] : null, q: Array.from(Q), f: best >= 0 ? Array.from(lib.feat.subarray(best * D, best * D + D)) : null });
        if (!stay && best >= 0) {
          // the join: the difference of his present pose and the new frame's, carried and let decay
          const scB = scaleOf(best);
          if (have) for (let j = 0; j < nJ; j++) { const [bx, by] = toB(last[j * 3] - hx, last[j * 3 + 1] - hy); offB[j * 3] = bx - poseAt(best, j, 0, scB); offB[j * 3 + 1] = by - poseAt(best, j, 1, scB); offB[j * 3 + 2] = last[j * 3 + 2] - poseAt(best, j, 2, scB); }
          cursor = best; sc = scB;
        } else if (cursor < 0) { cursor = best; sc = scaleOf(best); }
        since = 0;
      }
      // play on: the frames advanced by the ground covered (the clip's own speed against the path's), the clip's turning
      // carried into his facing, with a slight pull towards the facing he wants
      const k0 = Math.floor(cursor), vdb = lib.speed[k0], rate = vdb > 0.8 && s > 0.3 ? Math.min(1.5, Math.max(0.6, s / vdb)) : 1;
      const end = lib.segEnd[k0] - 1.001, c0 = cursor;
      cursor = Math.min(end, cursor + rate);
      const still = 1 - Math.min(1, Math.max(0, (s - 0.35) / 0.6));
      phi += yawAt(cursor) - yawAt(c0) + (tune.pullMove * (1 - still) + tune.pullStill * still) * wrapA(want(i, phi) - phi);
      const sn2 = Math.sin(phi), cs2 = Math.cos(phi), decay = Math.exp(-dt / TAU), decayW = Math.exp(-dt / TAU_W);
      offW = [offW[0] * decayW, offW[1] * decayW];
      const px = tr.pos[i][0] + offW[0], py = tr.pos[i][1] + offW[1], o = (i * P + p) * nJ * 3;
      prev.set(last);
      for (let j = 0; j < nJ; j++) {
        // (no joint under the grass: the tracked toes dip a few centimetres below it in the library)
        const bx = poseAt(cursor, j, 0, sc) + offB[j * 3], by = poseAt(cursor, j, 1, sc) + offB[j * 3 + 1], bz = Math.max(0.01, poseAt(cursor, j, 2, sc) + offB[j * 3 + 2]);
        offB[j * 3] *= decay; offB[j * 3 + 1] *= decay; offB[j * 3 + 2] *= decay;
        const wx = px + bx * sn2 + by * cs2, wy = py - bx * cs2 + by * sn2;
        out[o + j * 3] = wx; out[o + j * 3 + 1] = wy; out[o + j * 3 + 2] = bz;
        last[j * 3] = wx; last[j * 3 + 1] = wy; last[j * 3 + 2] = bz;
      }
      // the foot lock: a foot the library has down is held where it landed; lifted, the hold is let go
      const down = lib.planted[Math.floor(cursor)], decayL = Math.exp(-dt / tune.tauLock), decayD = Math.exp(-dt / tune.tauDrift);
      for (const side of ['l', 'r'] as const) {
        const st = lock[side], ank = side === 'l' ? lA : rA, ax = last[ank * 3], ay = last[ank * 3 + 1];
        if (down & (side === 'l' ? 1 : 2)) {
          // planted where the foot is shown (its shift of the moment included, so a foot down again before the last
          // hold has faded does not jump by what remained of it)
          if (!st.on && !st.wait) { st.on = true; st.x = ax + st.sx; st.y = ay + st.sy; }
          if (st.on) {
            const dx = st.x - ax, dy = st.y - ay;
            // drifted too far from where it landed (the strides slower than the path): let go, smoothly, and plant
            // again only once the library's foot has lifted (a re-plant on the spot jumped the foot 0.35 m)
            if (Math.hypot(dx, dy) > tune.lockMax) { st.on = false; st.wait = true; st.sx *= decayD; st.sy *= decayD; } else { st.sx = dx; st.sy = dy; }
          } else { st.sx *= decayD; st.sy *= decayD; }
        } else { st.on = false; st.wait = false; st.sx *= decayL; st.sy *= decayL; }
        if (Math.abs(st.sx) + Math.abs(st.sy) > 1e-4) {
          for (const j of FOOT[side]) { out[o + j * 3] += st.sx; out[o + j * 3 + 1] += st.sy; last[j * 3] += st.sx; last[j * 3 + 1] += st.sy; }
          const kn = KNEE[side]; out[o + kn * 3] += st.sx / 2; out[o + kn * 3 + 1] += st.sy / 2; last[kn * 3] += st.sx / 2; last[kn * 3 + 1] += st.sy / 2;
        }
      }
      have = true; since++;
    }
  });
  return { fps, frames: F, players: P, nAtt, names, data: out, flip: [1, 1] };
}
