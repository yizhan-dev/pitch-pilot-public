import { modelFile } from '../data/paths';
// The on-ball what-if (Yi, 2026-10-24: "indicate an intended passing location, then simulate until the next event"): at a
// reception the viewer picks where the ball should go; the ball is passed there along the ground, the other players
// answer it (the response model, web/src/response/engine.ts), and the first touch decides what happens (cut out,
// received and kept, received and tackled, nobody reaches it, it goes out). Grown from the 2D check page's 改落点
// (ballTo / landOutcomes / landBranch; that page, responseMain.ts, was removed on 2026-10-26); here the pass moves at a
// real pass's pace and the first touch is looked for over 4 s, not 2, so long passes are reached as they are on the
// pitch (2026-10-24). Everything is a simulation, not what happened.
// Frames: the response model works with the team on the ball attacking +x and listed first; a package lists its
// attacking team first, attacking +x, so when the receiver is on the other team the scene is turned round (x and y
// negated, the two teams swapped) and turned back after.
import { loadModel, respond, PAST, FUT, DT, type Model, type XY } from '../response/engine';
import type { Joints } from '../data';
import { firstTouch, turnover, type ResolverParams, type TurnoverModel, type V3 } from '../response/outcomes';
import { xgFreeze, type XgFreezeModel } from '../response/xg';

interface Pkg {
  meta: { fps: number };
  frames: { att: [number, number][]; def: [number, number][]; ball: [number, number, number] | null }[];
  keepers?: number[];
}

/** the models, fetched once */
export interface Models { model: Model; prm: ResolverParams; tov: TurnoverModel }
let loading: Promise<Models> | null = null;
export function loadModels(): Promise<Models> {
  return (loading ??= Promise.all([loadModel(), fetch(modelFile('resolver.json')).then((r) => r.json()), fetch(modelFile('turnover.json')).then((r) => r.json()),
    fetch(modelFile('xg_freeze.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null)])
    .then(([model, prm, tov, xg]) => { XG = xg; return { model, prm, tov }; }));
}
/** the xG model, for how hard the defenders press where the ball goes (pressRule); loaded with the others */
let XG: XgFreezeModel | null = null;

/** the scene at the pause, in the model's frame */
export interface Scene0 {
  /** players' positions at 0.4 s before the pause to the pause, 10 Hz ([5][22]) */
  past: XY[][]; now: XY[]; gk: boolean[];
  /** the ball from 0.4 s before (only [0..PAST] matter) */
  ball: V3[];
  /** the receiver, now on the ball, in the model's order */
  kicker: number;
  /** package index of each model index, and whether the scene was turned round */
  toPkg: number[]; flipped: boolean;
  /** the way the player on the ball faces at the pause (unit, model frame), from his tracked shoulders and hips */
  facing: XY;
}

/** the way player p's body faces at joint frame f (unit, the package's frame): square to his shoulders and hips (the
 *  tracked skeletons face +y with the right shoulder at -x, checked against 1133 fast runs: 99.3% face their run) */
export function facingOf(J: Joints, f: number, p: number): XY | null {
  const nJ = J.names.length, ix = (n: string) => J.names.indexOf(n), fr = Math.min(J.frames - 1, Math.max(0, f));
  const at = (j: number, d: number) => J.data[((fr * J.players + p) * nJ + j) * 3 + d];
  const rx = at(ix('rShoulder'), 0) - at(ix('lShoulder'), 0) + at(ix('rHip'), 0) - at(ix('lHip'), 0);
  const ry = at(ix('rShoulder'), 1) - at(ix('lShoulder'), 1) + at(ix('rHip'), 1) - at(ix('lHip'), 1), n = Math.hypot(rx, ry);
  return n > 1e-3 ? [ry / n, -rx / n] : null;
}

/** the scene at clip time t0 (a reception) for the player `carrier` (package index); his facing from the joints when
 *  there are any, else his run, else towards the goal his team attacks */
export function sceneAt(pkg: Pkg, t0: number, carrier: number, J: Joints | null = null): Scene0 {
  const fr = pkg.frames, fps = pkg.meta.fps, k0 = Math.min(fr.length - 1, Math.round(t0 * fps)), nAtt = fr[0].att.length, P = nAtt + fr[0].def.length;
  const flipped = carrier >= nAtt, s = flipped ? -1 : 1;
  const toPkg = Array.from({ length: P }, (_, i) => (flipped ? (i < P - nAtt ? nAtt + i : i - (P - nAtt)) : i));
  const pos = (k: number, p: number): XY => { const f = fr[Math.min(fr.length - 1, Math.max(0, k))], q = p < nAtt ? f.att[p] : f.def[p - nAtt]; return [s * q[0], s * q[1]]; };
  const past = Array.from({ length: PAST + 1 }, (_, n) => toPkg.map((p) => pos(k0 - PAST + n, p)));
  const ballAt = (k: number): V3 => { const b = fr[Math.min(fr.length - 1, Math.max(0, k))].ball ?? [0, 0, 0.11]; return [s * b[0], s * b[1], b[2]]; };
  const ball = Array.from({ length: PAST + FUT + 1 }, (_, n) => ballAt(k0 - PAST + n));
  const keepers = new Set(pkg.keepers ?? []), kicker = toPkg.indexOf(carrier);
  const f = J ? facingOf(J, Math.round(t0 * J.fps), carrier) : null, v = velOf(past, kicker), vl = len(v);
  const facing: XY = f ? [s * f[0], s * f[1]] : vl > 0.5 ? [v[0] / vl, v[1] / vl] : [1, 0];
  return { past, now: past[PAST], gk: toPkg.map((p) => keepers.has(p)), ball, kicker, toPkg, flipped, facing };
}

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]], len = (a: XY) => Math.hypot(a[0], a[1]);
/** steps between the reception and the strike for a pass the way he faces (the kick animation's wind-up, 0.42 s to the
 *  foot's contact) */
export const HOLD = 4;
/** time on the ball before the strike, by how far he must turn to face the pass (Yi, 2026-10-24: a pass behind him is
 *  not a spin and a strike but a stop, a turn with the ball, then the pass). This match's 84 reception-then-pass pairs:
 *  the median from the touch to the pass 0.6 to 0.9 s turning under 90 degrees, about 1.1 s at 90 to 150, 1.7 s past
 *  150 (thin: 15 pairs over 90). Here: the wind-up alone up to 30 degrees, then linear to 1.3 s at 180. */
export const holdFor = (turnDeg: number) => Math.round((0.4 + (0.9 * Math.max(0, turnDeg - 30)) / 150) / DT);
/** the angle (degrees) between the way he faces and the way to Q */
export function turnTo(c: Scene0, Q: XY): number {
  const p = c.now[c.kicker], d = sub(Q, p), dl = len(d);
  return dl < 1e-6 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (d[0] * c.facing[0] + d[1] * c.facing[1]) / dl))) * 180) / Math.PI;
}
/** the first touch is looked for over 4.5 s from the pause (a 45 m lofted ball lands after 2.9 s), and an outcome plays
 *  for up to 6 s (the response model's 2 s answers chained, respondN) */
export const TOUCH_N = 45, SIM_N = 60;
/** the pass's pace, from this match's completed ground passes (137 in the clips, the 25 Hz ball from the strike to the
 *  touch, measured 2026-10-26: struck at 11.6 / 14.9 / 17.8 / 22.9 m/s for 5-10 / 10-15 / 15-22 / 22-30 m, arriving at
 *  7-8 m/s, so slowing at 5.3 / 6.6 / 7.0 / 8.3 m/s², the more the harder they are hit, as drag does): they reach their
 *  man at about 8 m/s (softer when short) and slow at 4.5 + 0.15 m/s² a metre on the way, so 12 m takes 1.1 s and 26 m
 *  1.7 s as theirs do (before, 5.5 m/s² for every pass: a 26 m ball struck at 18.7 m/s took 1.95 s, theirs 1.8); past
 *  the point the ball rolls on, slowing at 2 m/s² */
const ROLL_DEC = 2, arrival = (d: number) => Math.min(8, 4 + 0.35 * d), passDec = (d: number) => 4.5 + 0.15 * d;
/** a lofted pass, from this match's chipped and long passes (27 with the ball 1.5 m up or more, the 25 Hz ball from the
 *  strike to the landing, measured 2026-10-26: 8-15 m chips 1.3 s in the air and 2.6 m up, 22-32 m 2.8 s and 4.9 m,
 *  long balls of 32-49 m 2.8 s and 6.5 m, struck at 12 / 22 / 26 m/s): it lands on the point after 0.8 s + 0.05 s a
 *  metre (26 m: 2.1 s; at most 2.9 s), its arc gravity's for a chip (9.81 m/s²), flattening to 7 m/s² by 45 m (long
 *  balls are driven, and drag and backspin flatten them), slowing 1.5 m/s² across the ground; then one bounce (0.45 of
 *  the drop's speed up, 0.6 of the pace on) and it rolls. (Before, 6.5 m/s² for every pass and 0.9 + 0.042 s a metre: a
 *  12 m chip peaked at 1.6 m, under a defender's head; the real ones at 2.6 m and more.) */
const LOFT_DEC = 1.5;
export const loftTime = (d: number) => Math.min(2.9, Math.max(1, 0.8 + 0.05 * d));
export const loftG = (d: number) => 9.81 + (7 - 9.81) * Math.min(1, Math.max(0, (d - 20) / 25));
/** how long a pass of d metres takes from the strike to its point (ballTo's pace: along the ground, or lofted) */
export function passTime(d: number, loft = false) {
  if (loft) return loftTime(d);
  const vE = arrival(d), dec = passDec(d), v0 = Math.sqrt(vE * vE + 2 * dec * d);
  return (v0 - vE) / dec;
}
/** the highest point of a lofted pass of d metres */
export const loftApex = (d: number) => (loftG(d) * loftTime(d) ** 2) / 8;
/** the height the intended receiver takes a lofted ball at: thigh or chest, or if no one can, up to his head (anyone
 *  may still touch it up to 2 m, the first-touch resolver's zOutfield) */
const REACH_Z = [1.5, 1.9];
/** a header instead (the what-if's third way of playing a lofted ball, 2026-10-27, Yi: "they are always ground shot,
 *  never header or a volley"): he meets it at head height, 1.3 m (shot.ts HEAD_Z, stooping) up to the resolver's 2.0 m */
export const HEAD_Z: [number, number] = [1.3, 2.0];
/** or at his feet: he runs on a step or two and lets it drop to hip height or lower (a volley, or a drive off the
 *  bounce) rather than take a chest-high ball (Yi, 2026-10-27: "he either keep running a few more steps for the ball
 *  to fall lower, or run toward ball earlier, to make it a header") */
export const FOOT_Z = 1.0;
/** where the man a lofted pass is meant for meets it: at his chest or thigh (REACH_Z), his head (HEAD_Z), his feet (FOOT_Z) */
export type Meet = 'chest' | 'head' | 'foot';
/** the pitch's half-length and half-width: a ball past them is out of play */
const HX = 52.5, HY = 34;

/** the passer over the next 2 s (to the strike and on): on along his line, slowing over at most 0.6 s to a third of his
 *  speed for a pass the way he faces, to almost a stop (a tenth) for one he must turn round for, and keeping that;
 *  after 2 s the model moves him */
export function kickerPath(c: Scene0, hold = HOLD, turn = 0): XY[] {
  const p = c.now[c.kicker], v = velOf(c.past, c.kicker), Tb = Math.min(hold * DT, 0.6), h = DT / 5;
  const fEnd = 1 / 3 + (0.1 - 1 / 3) * Math.min(1, Math.max(0, (turn - 45) / 60)), out: XY[] = [];
  let s = 0;
  for (let n = 1; n <= FUT; n++) {
    for (let k = 0; k < 5; k++) { const t = (n - 1) * DT + (k + 0.5) * h; s += (t < Tb ? 1 - ((1 - fEnd) * t) / Tb : fEnd) * h; }
    out.push([p[0] + v[0] * s, p[1] + v[1] * s]);
  }
  return out;
}

/** the way he faces tau seconds after the pause while on the ball: from his facing at the pause round to the pass,
 *  the shorter way, over the hold less the kick's wind-up (0.35 s) */
export function faceAt(c: Scene0, dir: XY, hold: number, tau: number): XY {
  const a0 = Math.atan2(c.facing[1], c.facing[0]), a1 = Math.atan2(dir[1], dir[0]);
  let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const T = Math.max(0.15, hold * DT - 0.35 - 0.1), u = Math.min(1, Math.max(0, (tau - 0.1) / T)), a = a0 + d * u * u * (3 - 2 * u);
  return [Math.cos(a), Math.sin(a)];
}

/** the ball from the pause, PAST + SIM_N + 1 positions: at the passer's feet (0.35 m in front of him, turning with him)
 *  until the strike, then to Q along the ground at a real pass's pace, rolling on past it, or lofted onto it */
export function ballTo(c: Scene0, Q: XY, loft = false, hold = HOLD, kp: XY[] = kickerPath(c, hold, turnTo(c, Q))): V3[] {
  const out = c.ball.slice(0, PAST + 1).map((q) => [...q] as V3), pd = sub(Q, kp[hold - 1]), pl = Math.max(len(pd), 1e-6), dir: XY = [pd[0] / pl, pd[1] / pl];
  const foot = (n: number): XY => { if (n === 0) return [c.ball[PAST][0], c.ball[PAST][1]]; const f = faceAt(c, dir, hold, n * DT); return [kp[n - 1][0] + f[0] * 0.35, kp[n - 1][1] + f[1] * 0.35]; };
  const b0 = foot(hold), d = len(sub(Q, b0)), u: XY = [(Q[0] - b0[0]) / Math.max(d, 1e-6), (Q[1] - b0[1]) / Math.max(d, 1e-6)];
  const vE = arrival(d), dec = passDec(d), v0 = Math.sqrt(vE * vE + 2 * dec * d), T = (v0 - vE) / dec;
  const ground = (t: number): [number, number] => { if (t <= T) return [v0 * t - 0.5 * dec * t * t, 0.11]; const r = Math.min(t - T, vE / ROLL_DEC); return [d + vE * r - 0.5 * ROLL_DEC * r * r, 0.11]; };
  // lofted: in the air to Q, one bounce, then rolling
  const Tf = loftTime(d), g = loftG(d), vh0 = d / Tf + 0.5 * LOFT_DEC * Tf, vhL = vh0 - LOFT_DEC * Tf, vz0 = (g * Tf) / 2;
  const vzB = 0.45 * vz0, Tb = (2 * vzB) / 9.81, vhB = 0.6 * vhL, sB = d + vhB * Tb;
  const lofted = (t: number): [number, number] => {
    if (t <= Tf) return [vh0 * t - 0.5 * LOFT_DEC * t * t, 0.11 + vz0 * t - 0.5 * g * t * t];
    if (t <= Tf + Tb) { const r = t - Tf; return [d + vhB * r, 0.11 + vzB * r - 0.5 * 9.81 * r * r]; }
    const r = Math.min(t - Tf - Tb, vhB / ROLL_DEC); return [sB + vhB * r - 0.5 * ROLL_DEC * r * r, 0.11];
  };
  for (let n = 1; n <= SIM_N; n++) {
    if (n <= hold) { const f = foot(n), a = foot(0), w = Math.min(1, n / 2); out.push([a[0] + (f[0] - a[0]) * w, a[1] + (f[1] - a[1]) * w, 0.11]); continue; }
    const [s, z] = (loft ? lofted : ground)((n - hold) * DT);
    out.push([b0[0] + u[0] * s, b0[1] + u[1] * s, z]);
  }
  return out;
}

function hermite(p0: XY, v0: XY, p1: XY, v1: XY, Ta: number, steps: number): XY[] {
  return Array.from({ length: steps }, (_, n) => {
    const t = (n + 1) * DT;
    if (t > Ta) return [p1[0] + v1[0] * (t - Ta), p1[1] + v1[1] * (t - Ta)] as XY;
    const s = t / Ta, h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    return [h00 * p0[0] + h10 * Ta * v0[0] + h01 * p1[0] + h11 * Ta * v1[0], h00 * p0[1] + h10 * Ta * v0[1] + h01 * p1[1] + h11 * Ta * v1[1]] as XY;
  });
}
export const velOf = (past: XY[][], i: number): XY => [(past[PAST][i][0] - past[PAST - 1][i][0]) / DT, (past[PAST][i][1] - past[PAST - 1][i][1]) / DT];
export const noCtrl = () => ({ cm: Array(22).fill(false) as boolean[], cp: Array.from({ length: 22 }, () => [] as XY[]) });
const ZERO: XY[] = Array.from({ length: FUT }, () => [0, 0] as XY);

/** the response model's 2 s answer chained on to n steps, the last 0.4 s of one answer the past of the next; a player
 *  is held to his path (cp) in each window it covers in full, the model moves him in the rest; ball: from 0.4 s
 *  before the pause */
export function respondN(M: Models, c: Scene0, ball: V3[], cm: boolean[], cp: XY[][], n: number): XY[][] {
  const out: XY[][] = Array.from({ length: 22 }, () => []);
  let past = c.past;
  for (let s = 0; s < n; s += FUT) {
    const B = Array.from({ length: PAST + FUT + 1 }, (_, k) => ball[Math.min(ball.length - 1, s + k)]);
    const m = cm.map((x, i) => x && cp[i].length >= s + FUT), p = cp.map((q, i) => (m[i] ? q.slice(s, s + FUT) : ZERO));
    respond(M.model, { P: past, B, gk: c.gk }, m, p).out.forEach((q, i) => out[i].push(...q));
    past = Array.from({ length: PAST + 1 }, (_, k) => out.map((q) => q[s + FUT - PAST - 1 + k]));
  }
  return out.map((q) => q.slice(0, n));
}

/** player X meets the ball at step n on a smooth path, then carries on with it (at 2.5 m/s, halfway between the
 *  ball's line and the goal his team attacks) */
export function carryOf(X: number, ball: V3[], n: number) {
  const meet: XY = [ball[PAST + n][0], ball[PAST + n][1]], prev: XY = [ball[PAST + n - 1][0], ball[PAST + n - 1][1]];
  const dir = sub(meet, prev), dl = Math.max(len(dir), 1e-6), goal = sub(X < 11 ? [HX, 0] : [-HX, 0], meet), gl = Math.max(len(goal), 1e-6);
  const w: XY = [0.5 * dir[0] / dl + 0.5 * goal[0] / gl, 0.5 * dir[1] / dl + 0.5 * goal[1] / gl], wl = Math.max(len(w), 1e-6);
  return { meet, carry: [(w[0] / wl) * 2.5, (w[1] / wl) * 2.5] as XY };
}
export function meetPath(past: XY[][], X: number, ball: V3[], n: number) {
  const { meet, carry } = carryOf(X, ball, n);
  const path = hermite(past[PAST][X], velOf(past, X), meet, carry, n * DT, SIM_N);
  return { path, ball: atFeet(ball, path, n, carry) };
}

/** the pass as played: the ball, the teammate it is meant for with his run onto it (null if none can get there), the
 *  passer's path, how far he turns (degrees) and how long he is on the ball before the strike (steps), and the
 *  pass's direction */
export interface Pass {
  ball: V3[]; plan: Plan | null; kp: XY[]; turn: number; hold: number; dir: XY;
  /** other players held to a path of their own whatever comes of the pass (the off-ball what-if's runner, offball.ts) */
  extra?: Held[];
  /** the pass was meant for one man (the viewer clicked him): his teammates let it run for him, so only he and the
   *  opponents can take the first touch (an assumption, Yi's "pass to #37", 2026-10-25) */
  leave?: boolean;
}
/** a player (model index) held to a path, 10 Hz from the pause */
export interface Held { who: number; path: XY[] }
/** hold the extra players to their paths, all but those named in `skip` (who are held to something else) */
function holdExtra(cm: boolean[], cp: XY[][], extra: Held[] | undefined, ...skip: number[]) {
  for (const e of extra ?? []) if (!skip.includes(e.who)) { cm[e.who] = true; cp[e.who] = e.path; }
}
export interface Plan {
  /** the teammate (model index), the step he meets the ball at, his run (then him carrying it on, SIM_N steps) and the
   *  ball with him after the meeting */
  who: number; n: number; path: XY[]; ball: V3[];
}
/** the intended receiver's run: up to 7 m/s, 5 m/s² (within the response model's own limits, 9 and 7), on his way
 *  for 0.2 s before he reads the pass; he may meet it from 6 m short of the spot on */
const RUN_V = 7, RUN_A = 5, SEE = 0.2, SHORT = 6;

/** a run from p0 (moving at v0) to meet X at tMeet, then on at `carry`: steered at 50 Hz to arrive on time, the turn
 *  and the speed limited; SIM_N positions at 10 Hz, and how far from X he is at tMeet */
function runTo(p0: XY, v0: XY, X: XY, tMeet: number, carry: XY): { path: XY[]; miss: number } {
  const h = 0.02, sub = Math.round(DT / h), path: XY[] = [];
  let p: XY = [...p0], v: XY = [...v0], miss = Infinity;
  for (let k = 1; k <= SIM_N * sub; k++) {
    const t = k * h;
    let want: XY = v;
    if (t > SEE && t <= tMeet + 1e-9) {
      // on time, but no faster than he can pull up from over what is left (he meets the ball under control, at
      // about 2 m/s, not at a sprint he would have to brake out of with it at his feet)
      const to = sub2(X, p), d = len(to), left = Math.max(tMeet - t + h, h), sp = Math.min(RUN_V, d / left, Math.sqrt(2 * RUN_A * d) + 2);
      want = d > 1e-6 ? [(to[0] / d) * sp, (to[1] / d) * sp] : [0, 0];
    } else if (t > tMeet) want = carry;
    const dv = sub2(want, v), dl = len(dv), ka = Math.min(1, (RUN_A * h) / Math.max(dl, 1e-9));
    v = [v[0] + dv[0] * ka, v[1] + dv[1] * ka];
    const vs = len(v); if (vs > RUN_V) v = [(v[0] / vs) * RUN_V, (v[1] / vs) * RUN_V];
    p = [p[0] + v[0] * h, p[1] + v[1] * h];
    if (Math.abs(t - tMeet) < h / 2) miss = len(sub2(p, X));
    if (k % sub === 0) path.push([...p] as XY);
  }
  return { path, miss };
}
const sub2 = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];

/** the ball from step n on at the feet of a player on `path`: 0.35 m ahead of him the way he moves (along `carry`
 *  while he is nearly still) */
export function atFeet(ball: V3[], path: XY[], n: number, carry: XY): V3[] {
  const nb = ball.map((q) => [...q] as V3), cl = Math.max(len(carry), 1e-6), z0 = ball[PAST + n][2];
  let dir: XY = [carry[0] / cl, carry[1] / cl];
  for (let m = n + 1; m <= SIM_N; m++) {
    const v = sub2(path[m - 1], path[Math.max(0, m - 2)]), vl = len(v) / DT;
    if (vl > 0.8) { const w = Math.min(1, (vl - 0.8) / 1.2), nd: XY = [dir[0] * (1 - w) + (v[0] / (vl * DT)) * w, dir[1] * (1 - w) + (v[1] / (vl * DT)) * w], nl = Math.max(len(nd), 1e-6); dir = [nd[0] / nl, nd[1] / nl]; }
    // a ball taken high (thigh, chest, head) comes down to his feet over 0.3 s, not at once (2026-10-25)
    const u = Math.min(1, (m - n) / 3), z = z0 > 0.2 ? 0.11 + (z0 - 0.11) * (1 - u) * (1 - u) : 0.11;
    nb[PAST + m] = [path[m - 1][0] + dir[0] * 0.35, path[m - 1][1] + dir[1] * 0.35, z];
  }
  return nb;
}

/** the teammate the pass is meant for (the viewer picks a spot, not a man): of those who can meet the ball where it
 *  arrives (6 m short of the spot or beyond, within 4 s), the one who meets it first; he then carries it on as in
 *  meetPath. The keepers and the passer are left out. */
export function intended(c: Scene0, ball: V3[], Q: XY, hold = HOLD, reach = REACH_Z[0], only: number | null = null, minZ = 0): Plan | null {
  const b0: XY = [ball[PAST + hold][0], ball[PAST + hold][1]], d = only === null ? len(sub(Q, b0)) : 0;
  let best: Plan | null = null;
  for (let i = 0; i < 11; i++) {
    if (only !== null ? i !== only : i === c.kicker || c.gk[i]) continue;
    for (let n = hold + 2; n <= TOUCH_N && (!best || n < best.n); n++) {
      const X: XY = [ball[PAST + n][0], ball[PAST + n][1]];
      if (len(sub(X, b0)) < d - SHORT || Math.abs(X[0]) > HX || Math.abs(X[1]) > HY || ball[PAST + n][2] > reach || ball[PAST + n][2] < minZ) continue;
      const { carry } = carryOf(i, ball, n), r = runTo(c.now[i], velOf(c.past, i), X, n * DT, carry);
      if (r.miss > 0.5) continue;
      best = { who: i, n, path: r.path, ball: atFeet(ball, r.path, n, carry) };
      break;
    }
  }
  return best ?? (reach < REACH_Z[1] ? intended(c, ball, Q, hold, REACH_Z[1], only) : null);
}

/** where a pass to a moving teammate goes (Yi, 2026-10-25: a ground pass "to #37", who was running at 5 m/s, went to
 *  where he had been and a man 24 m back picked it up): into his stride, his run carried on at its pace (at most
 *  7 m/s), the first point on it the pass reaches no later than he does after the turn the passer needs; his own spot if
 *  he is nearly still. Distances only, so it works in the package's frame as in the model's. */
export function leadPoint(from: XY, facing: XY, p0: XY, v: XY, loft = false): XY {
  const vs = len(v), u = vs > 7 ? 7 / vs : 1, w: XY = [v[0] * u, v[1] * u];
  if (vs < 1) return p0;
  let Q = p0;
  for (let it = 0; it < 3; it++) {
    const d0 = sub(Q, from), dl = Math.max(len(d0), 1e-6), turn = (Math.acos(Math.max(-1, Math.min(1, (d0[0] * facing[0] + d0[1] * facing[1]) / dl))) * 180) / Math.PI, hold = holdFor(turn) * DT;
    for (let t = hold + 0.2; t <= 4; t += 0.05) {
      const P: XY = [p0[0] + w[0] * t, p0[1] + w[1] * t];
      if (Math.abs(P[0]) > HX || Math.abs(P[1]) > HY) break;
      if (hold + passTime(len(sub(P, from)), loft) <= t) { Q = P; break; }
    }
  }
  return Q;
}

/** the ball, played to Q along the ground or lofted after the turn it takes, with its intended receiver */
/** the keeper by rule, not by the response model (Yi, 2026-10-25: "make GK's position not trained, but more math
 *  algorithm governed"): on the line from his goal's centre to the ball, at the depth this match's keepers keep for the
 *  ball's distance (1826 frames, medians: 1.7 m with the ball within 11 m, 3.2 at 11-25, 3.0 at 25-35, 4.7 at 35-45;
 *  they stand 0.3-0.45 m off that line within 25 m), the ball taken as where the receiver meets it from 0.4 s before
 *  the touch (the shot comes from there); he reads the pass 0.15 s after the strike and moves at up to 6 m/s, 6 m/s².
 *  The response model's keeper was slow (0.9 m/s against the real 2.5 at 26:40) and 1.4 m off that line. */
const GK_DEPTH: [number, number][] = [[5, 1.2], [9, 1.7], [14, 3.0], [22, 3.3], [30, 3.0], [40, 4.7], [60, 8]];
/** the keeper's claim zone: the goal area (5.5 m deep, 18.3 m wide) and a step beyond it; his share of a ball there
 *  against the attacker (StatsBomb open data, see outcomes) */
const CLAIM_DEPTH = 6.5, CLAIM_HALF_W = 10, GK_CLAIM = 0.64;
export const claimZone = (X: XY) => HX - X[0] <= CLAIM_DEPTH && Math.abs(X[1]) <= CLAIM_HALF_W;
function keeperDepth(dist: number) {
  if (dist <= GK_DEPTH[0][0]) return GK_DEPTH[0][1];
  for (let i = 1; i < GK_DEPTH.length; i++) { const [x1, y1] = GK_DEPTH[i], [x0, y0] = GK_DEPTH[i - 1]; if (dist <= x1) return y0 + ((y1 - y0) * (dist - x0)) / (x1 - x0); }
  return GK_DEPTH[GK_DEPTH.length - 1][1];
}
export function keeperRule(c: Scene0, ball: V3[], hold: number, plan: Plan | null): Held | null {
  const gk = c.gk.findIndex((g, i) => g && i >= 11);
  if (gk < 0) return null;
  const h = 0.02, per = Math.round(DT / h), path: XY[] = [], X: XY | null = plan ? plan.path[plan.n - 1] : null;
  // a ball to be taken in his goal area is his to claim (2026-10-28, Yi on 17:28: a chip dropping 3 m in front of the
  // keeper for a 0.53 chance was "quite irrealistic"; by the depth rule he stepped back onto his line): from the moment
  // he reads the pass he goes for the point it is taken at, at his full pace, and the first-touch resolver (his reach
  // 2 m, 2.6 m up) decides whether he or the receiver gets there
  const claim = !!X && claimZone(X);
  let p: XY = [...c.now[gk]], v: XY = velOf(c.past, gk);
  for (let k = 1; k <= SIM_N * per; k++) {
    const t = k * h, step = Math.min(SIM_N, Math.ceil(t / DT)), b = ball[Math.min(ball.length - 1, PAST + step)];
    // the line to where the receiver takes it from the moment he reads the pass (the shot comes from there; a keeper
    // following the ball in flight was 4.6 m off a man taking it in the six-yard box, 2026-10-25), else to the ball
    const w = X ? Math.min(1, Math.max(0, (step - 1) / 3)) : 0, bx = b[0] * (1 - w) + (X ? X[0] * w : 0), by = b[1] * (1 - w) + (X ? X[1] * w : 0);
    const d = Math.hypot(HX - bx, by), ux = d > 1e-6 ? (bx - HX) / d : -1, uy = d > 1e-6 ? by / d : 0, dep = Math.min(keeperDepth(d), Math.max(0.5, d - 1));
    let want: XY = v;
    if (t > hold * DT + 0.15) {
      const T: XY = claim && X ? X : [HX + ux * dep, uy * dep], to = sub(T, p), dl = len(to), sp = Math.min(6, Math.sqrt(2 * 6 * dl));
      want = dl > 1e-6 ? [(to[0] / dl) * sp, (to[1] / dl) * sp] : [0, 0];
    }
    const dv = sub(want, v), dvl = len(dv), ka = Math.min(1, (6 * h) / Math.max(dvl, 1e-9));
    v = [v[0] + dv[0] * ka, v[1] + dv[1] * ka];
    p = [p[0] + v[0] * h, p[1] + v[1] * h];
    if (k % per === 0) path.push([...p] as XY);
  }
  return { who: gk, path };
}

/** the defenders press by danger (Yi, 2026-10-25: "defender still not fierce enough ... especially inside the penalty
 *  box ... like an xG surface, when it is a higher xG area, defenders respond more relentlessly"): the response model
 *  answers a new pass mildly (it learnt from passes that were played), so for the pass meant for one man the two
 *  defenders who can get to him soonest are held to a rule: the first goes goal-side of him and closes him down, the
 *  second gets into the line from him to the goal, both tracking him as he moves. How hard is set by the danger where he
 *  takes the ball, u = his xG there with nobody in the way (the keeper where he stands) over 0.2, capped at 1: reacting
 *  0.35 s after the pause at u 0, 0.15 s at 1 (they squeeze as soon as he has it, not only once the pass is struck: from
 *  the strike the centre-back 4.4 m from #37's touch at 26:40 still ended 2.7 m off him); running at up to 6 to 7.5 m/s,
 *  4.5 to 6.5 m/s²; standing off him 3 m
 *  at u 0, 1 m at 1 (the lane 5 m to 2.5 m). Outside the box u is small and the model mostly decides. */
const lerp1 = (a: number, b: number, u: number) => a + (b - a) * u;
export function pressRule(c: Scene0, plan: Plan, keeperAt: XY | null): Held[] {
  const X = plan.path[plan.n - 1], R = (k: number) => plan.path[Math.min(plan.path.length - 1, Math.max(0, k - 1))];
  const u = XG ? Math.min(1, xgFreeze(XG, X, false, [], keeperAt) / 0.2) : 0.5;
  const react = lerp1(0.35, 0.15, u), vmax = lerp1(6, 7.5, u), amax = lerp1(4.5, 6.5, u);
  const ds = [];
  for (let i = 11; i < 22; i++) if (!c.gk[i]) ds.push({ i, t: len(sub(c.now[i], X)) / vmax });
  ds.sort((a, b) => a.t - b.t);
  const roles: { i: number; off: number }[] = [{ i: ds[0]?.i ?? -1, off: lerp1(3, 1, u) }, { i: ds[1]?.i ?? -1, off: lerp1(5, 2.5, u) }];
  const out: Held[] = [], h = 0.02, per = Math.round(DT / h);
  for (const r of roles) {
    if (r.i < 0) continue;
    let p: XY = [...c.now[r.i]], v: XY = velOf(c.past, r.i);
    const path: XY[] = [];
    for (let k = 1; k <= SIM_N * per; k++) {
      // to the spot goal-side of where he will take it (a target moving with him left them alongside him at 26:40, so
      // nothing stood between him and the goal), then with him
      const t = k * h, step = Math.min(SIM_N, Math.ceil(t / DT)), q = step < plan.n ? X : R(step), g = sub([HX, 0], q), gl = Math.max(len(g), 1e-6);
      const T: XY = [q[0] + (g[0] / gl) * r.off, q[1] + (g[1] / gl) * r.off];
      let want: XY = v;
      if (t > react) { const to = sub(T, p), dl = len(to), sp = Math.min(vmax, Math.sqrt(2 * amax * dl)); want = dl > 1e-6 ? [(to[0] / dl) * sp, (to[1] / dl) * sp] : [0, 0]; }
      const dv = sub(want, v), dvl = len(dv), ka = Math.min(1, (amax * h) / Math.max(dvl, 1e-9));
      v = [v[0] + dv[0] * ka, v[1] + dv[1] * ka];
      p = [p[0] + v[0] * h, p[1] + v[1] * h];
      if (k % per === 0) path.push([...p] as XY);
    }
    out.push({ who: r.i, path });
  }
  return out;
}

/** `to`: the teammate it is meant for (model index), when the viewer clicked a man rather than a spot; he makes the run
 *  onto it if he can, else whoever first can, as for a spot */
export function passTo(c: Scene0, Q: XY, loft = false, to: number | null = null, meet: Meet = 'chest'): Pass {
  const turn = turnTo(c, Q), hold = holdFor(turn), kp = kickerPath(c, hold, turn), ball = ballTo(c, Q, loft, hold, kp);
  const pd = sub(Q, kp[hold - 1]), pl = Math.max(len(pd), 1e-6);
  // (head / foot: the man it is meant for meets it at head height (HEAD_Z) or lets it drop to his feet (FOOT_Z); no
  // plan when he cannot, and the pass reads as any other, which chain.ts tryPass then drops)
  const mine = to !== null && to !== c.kicker
    ? meet === 'head' ? intended(c, ball, Q, hold, HEAD_Z[1], to, HEAD_Z[0]) : meet === 'foot' ? intended(c, ball, Q, hold, FOOT_Z, to) : intended(c, ball, Q, hold, REACH_Z[0], to)
    : null, plan = mine ?? intended(c, ball, Q, hold);
  const gk = keeperRule(c, plan ? plan.ball : ball, hold, plan), extra = gk ? [gk] : [];
  // the pressing rule only for the what-if's pass to one man (the Tactics chat's pass chances call passTo without one)
  if (mine && plan) extra.push(...pressRule(c, plan, gk ? gk.path[Math.min(gk.path.length - 1, plan.n - 1)] : null));
  return { ball, plan, kp, turn, hold, dir: [pd[0] / pl, pd[1] / pl], leave: !!mine, extra };
}

/** the first step the ball is past a line, or 0 */
function outAt(ball: V3[], n: number) {
  for (let k = 1; k <= n; k++) { const b = ball[PAST + k]; if (Math.abs(b[0]) > HX || Math.abs(b[1]) > HY) return k; }
  return 0;
}

export interface Outcome {
  /** the player who touches it first (model index), -1 for nobody within 4 s or before it goes out */
  who: number; p: number; t: number;
  kind: 'cut' | 'kept' | 'tackled' | 'none' | 'out' | 'lost';
  tackle?: { by: number; at: number };
}

/** what can become of a pass to Q: whether he is dispossessed while still on the ball, then who touches the pass first
 *  within 4.5 s (or before it goes out), and for a teammate whether he keeps it for 1.5 s or is tackled; the chances are
 *  the models' (first touch calibrated on real passes, turnover on real receptions) */
export function outcomes(M: Models, c: Scene0, pass: Pass): Outcome[] {
  const { kp, hold, plan } = pass, base = noCtrl(), ball = plan ? plan.ball : pass.ball;
  base.cm[c.kicker] = true; base.cp[c.kicker] = kp;
  if (plan) { base.cm[plan.who] = true; base.cp[plan.who] = plan.path; }
  holdExtra(base.cm, base.cp, pass.extra, c.kicker, plan?.who ?? -1);
  const paths0 = respondN(M, c, ball, base.cm, base.cp, TOUCH_N), out0 = outAt(ball, TOUCH_N), steps = out0 ? out0 - 1 : TOUCH_N;
  // on the ball before the strike he is a receiver who has not let it go: the turnover model's chance of losing it
  // within 1.5 s, from the nearest opponent's closest approach while he holds it, for the share of 1.5 s he holds it
  let near = Infinity, by = 11, at = hold;
  for (let k = 1; k <= hold; k++) for (let d = 11; d < 22; d++) { const dd = len(sub(paths0[d][k - 1], kp[k - 1])); if (dd < near) { near = dd; by = d; at = k; } }
  const pLose = turnover(M.tov, near) * Math.min(1, (hold * DT) / 1.5), keep = 1 - pLose;
  // the first touch of the pass, from the strike on (the passer left out for 2 s, as the resolver does)
  const away = (q: XY[]) => q.map(() => [1e3, 1e3] as XY), leaves = (i: number) => !!pass.leave && !!plan && i < 11 && i !== plan.who && i !== c.kicker;
  const ft = firstTouch(M.prm, ball.slice(PAST + hold), paths0.map((q, i) => (leaves(i) ? away(q) : q).slice(hold)), c.gk, c.kicker, steps - hold), out: Outcome[] = [];
  ft.t = ft.t.map((t) => t + hold * DT);
  ft.p = ft.p.map((p) => p * keep);
  ft.none *= keep;
  // the keeper's claim (keeperRule): a ball to be taken in his goal area that he reaches in time is his to take, by
  // StatsBomb's share of such balls between the keeper and the attacker (64%: 381 taken by the keeper against 212 by a
  // teammate of 1,583 open-play high passes into the goal area, 326 matches). The resolver alone, fitted on outfield
  // touches, gave him one step of hazard under a dropping ball (2026-10-28, Yi on 17:28)
  const gk = c.gk.findIndex((g, i) => g && i >= 11);
  if (plan && gk >= 0 && claimZone(plan.path[plan.n - 1])) {
    const X = plan.path[plan.n - 1], g = paths0[gk][Math.min(paths0[gk].length - 1, plan.n - 1)], d = len(sub(g, X));
    // (the whole share when he is on the spot, within 1 m; none from 2 m, his reach, where the resolver's own hazard
    // is all he has)
    if (d <= M.prm.rKeeper) {
      const take = ft.p[plan.who] * GK_CLAIM * Math.min(1, Math.max(0, (M.prm.rKeeper - d) / Math.max(0.5, M.prm.rKeeper - 1)));
      ft.p[plan.who] -= take; ft.p[gk] += take;
      if (!Number.isFinite(ft.t[gk])) ft.t[gk] = plan.n * DT;
    }
  }
  if (pLose > 0.02) out.push({ who: by, p: pLose, t: Math.max(2, at) * DT, kind: 'lost' });
  ft.p.forEach((p, i) => {
    if (p <= 0.03) return;
    if (i >= 11) { out.push({ who: i, p, t: ft.t[i], kind: 'cut' }); return; }
    const mine = plan?.who === i, n = mine ? plan!.n : Math.max(2, Math.min(steps, Math.round(ft.t[i] / DT)));
    const m = mine ? plan! : meetPath(c.past, i, pass.ball, n), { cm, cp } = noCtrl();
    holdExtra(cm, cp, pass.extra, i, c.kicker);
    cm[i] = true; cp[i] = m.path; cm[c.kicker] = true; cp[c.kicker] = kp;
    const pr = respondN(M, c, m.ball, cm, cp, n), pos = pr[i][n - 1], t = mine ? n * DT : ft.t[i];
    let best = Infinity, by = 11;
    for (let d = 11; d < 22; d++) { const dd = len(sub(pr[d][n - 1], pos)); if (dd < best) { best = dd; by = d; } }
    const pt = turnover(M.tov, best, pass.ball[PAST + n]?.[2] ?? 0.11), tau = Math.min(1.5, Math.max(0.3, best / 4)), at = n + Math.round(tau / DT);
    out.push({ who: i, p: p * (1 - pt), t, kind: 'kept' });
    if (p * pt > 0.02) out.push({ who: i, p: p * pt, t, kind: 'tackled', tackle: { by, at } });
  });
  out.sort((a, b) => b.p - a.p);
  if (ft.none > 0.03) out.push({ who: -1, p: ft.none, t: out0 ? out0 * DT : NaN, kind: out0 ? 'out' : 'none' });
  return out.slice(0, 6);
}

/** one outcome played out: every player's path ([22][n], 10 Hz after the pause) and the ball ([n]), n running to a
 *  little after what decides it (1.5 s of keeping it, the tackle, the cut-out, the ball going out; 4 s if nobody comes) */
export interface Played { paths: XY[][]; ball: V3[]; carrier: number }

/** play one outcome of a pass whose ball path is `ball`; `after`: how many steps a pass a teammate receives runs on
 *  past his touch (the shot what-if stops on the touch, or where he is ready to shoot: shot.ts, Yi 2026-10-25) */
export function play(M: Models, c: Scene0, pass: Pass, o: Outcome, after = 15): Played {
  const { cm, cp } = noCtrl(), { plan } = pass, ball = pass.ball;
  cm[c.kicker] = true; cp[c.kicker] = pass.kp;
  holdExtra(cm, cp, pass.extra, c.kicker);   // (whoever touches the ball or tackles is held to that below instead)
  let b = ball, carrier = -1, end = TOUCH_N;
  if (o.kind === 'out') end = Math.min(SIM_N, Math.round(o.t / DT) + 8);
  if (o.kind === 'lost') {
    // dispossessed on the ball: the opponent comes in and takes it from his feet; there is no pass
    const at = Math.round(o.t / DT), m = meetPath(c.past, o.who, ball, at);
    cm[o.who] = true; cp[o.who] = m.path;
    const paths = respondN(M, c, m.ball, cm, cp, Math.min(SIM_N, at + 12));
    return { paths, ball: m.ball.slice(PAST + 1, PAST + 1 + paths[0].length), carrier: o.who };
  }
  // the intended receiver makes his run whatever comes of it (held to it until the 2 s window the touch falls in ends)
  if (plan && o.who !== plan.who) {
    const until = o.who >= 0 ? Math.round(o.t / DT) : plan.n;
    cm[plan.who] = true; cp[plan.who] = plan.path.slice(0, FUT * Math.max(1, Math.ceil(until / FUT)));
  }
  if (o.who >= 0) {
    const mine = plan?.who === o.who, n = mine ? plan!.n : Math.max(2, Math.min(TOUCH_N, Math.round(o.t / DT))), m = mine ? plan! : meetPath(c.past, o.who, ball, n);
    b = m.ball; carrier = o.who; cm[o.who] = true; cp[o.who] = m.path;
    end = Math.min(SIM_N, n + (o.kind === 'kept' ? after : 10));
    if (o.tackle) {
      const at = Math.min(SIM_N - 4, o.tackle.at), t2 = meetPath(c.past, o.tackle.by, m.ball, at);
      cm[o.tackle.by] = true; cp[o.tackle.by] = t2.path; b = t2.ball; carrier = o.tackle.by;
      end = Math.min(SIM_N, at + 8);
    }
  }
  const paths = respondN(M, c, b, cm, cp, end);
  return { paths, ball: b.slice(PAST + 1, PAST + 1 + end), carrier };
}

/** his shot from here, played (Yi, 2026-10-26: "no need to add '#2 shoots from here: xG 0.06', but we animate it once
 *  the user clicks shoot"): after the turn the shot asks for (as a pass: holdFor), the ball driven low at 22 m/s at the
 *  side of the goal mouth away from the keeper (1.8 m inside the far post), the others answering it through the model,
 *  the keeper on his rule; the clip ends 0.3 s after the ball crosses the line. What becomes of the shot (saved, in,
 *  blocked) is not simulated: the xG says it. */
const SHOT_V = 22;
export function shootFromHere(M: Models, c: Scene0): { played: Played; target: XY; hold: number; turn: number } {
  const gk = c.gk.findIndex((g, i) => g && i >= 11), ky = gk >= 0 ? c.now[gk][1] : 0;
  const target: XY = [HX, (ky > 0 ? -1 : 1) * 1.8];
  // (he stays where he struck it, the follow-through in place: the cone, his tag and the ring then agree; 2026-10-26)
  const turn = turnTo(c, target), hold = holdFor(turn), kp = kickerPath(c, hold, turn).map((q, n, a) => (n >= hold ? a[hold - 1] : q));
  const pd = sub(target, kp[hold - 1]), pl = Math.max(len(pd), 1e-6), dir: XY = [pd[0] / pl, pd[1] / pl];
  // the ball: at his feet to the strike (as ballTo), then straight and flat to the line (for the keeper's rule); the play
  // ends on the strike (Yi, 2026-10-26: "we do not animate the ball in the goal, just stay at the moment the player is
  // kicking the ball, and display xG")
  const ball = c.ball.slice(0, PAST + 1).map((q) => [...q] as V3);
  const foot = (n: number): XY => { if (n === 0) return [c.ball[PAST][0], c.ball[PAST][1]]; const f = faceAt(c, dir, hold, n * DT); return [kp[n - 1][0] + f[0] * 0.35, kp[n - 1][1] + f[1] * 0.35]; };
  const b0 = foot(hold), d = len(sub(target, b0)), u: XY = [(target[0] - b0[0]) / Math.max(d, 1e-6), (target[1] - b0[1]) / Math.max(d, 1e-6)];
  for (let n = 1; n <= SIM_N; n++) {
    if (n <= hold) { const f = foot(n), a = foot(0), w = Math.min(1, n / 2); ball.push([a[0] + (f[0] - a[0]) * w, a[1] + (f[1] - a[1]) * w, 0.11]); continue; }
    const s = Math.min(d, SHOT_V * (n - hold) * DT);
    ball.push([b0[0] + u[0] * s, b0[1] + u[1] * s, 0.11]);
  }
  const end = Math.max(1, Math.min(SIM_N, hold)), { cm, cp } = noCtrl();
  cm[c.kicker] = true; cp[c.kicker] = kp;
  const k = keeperRule(c, ball, hold, null); if (k) { cm[k.who] = true; cp[k.who] = k.path; }
  const paths = respondN(M, c, ball, cm, cp, end);
  return { played: { paths, ball: ball.slice(PAST + 1, PAST + 1 + end), carrier: -1 }, target, hold, turn };
}

/** a point from the package's frame into the model's, and back */
export const toModel = (c: Scene0, q: XY): XY => (c.flipped ? [-q[0], -q[1]] : q);
export const fromModel = toModel;
