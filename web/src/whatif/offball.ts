// The off-ball what-if (Yi, 2026-10-24: "a teammate's run. The viewer marks a running direction; we simulate until the
// next moment: the ball received, or space created for a teammate"; his answer the same day, kept for the prototype:
// the man on the ball plays his real pass, unchanged; we report the real receiver's chance and space, and the chance
// had the pass gone to the runner). At a moment the viewer picks a teammate and where he runs instead; the real pass is
// played as it really was (the tracked ball, struck when it really was, to where it was really received, the receiver
// on his real way to it), the runner is held to the new run, and the response model moves everyone else, so the
// defenders who would follow him do. The comparison is with the same simulation with the runner on his real run: only
// the run differs between the two. Everything is a simulation, not what happened.
import { PAST, DT, type XY } from '../response/engine';
import type { V3 } from '../response/outcomes';
import {
  atFeet, carryOf, holdFor, kickerPath, ballTo, outcomes, passTime, respondN, noCtrl, turnTo, velOf, toModel,
  TOUCH_N, SIM_N, type Models, type Scene0, type Pass, type Plan, type Outcome, type Held,
} from './onball';
import { offsideReception, receptions } from './snap';
import type { ClipEvent } from '../hud/match';

interface Pkg {
  meta: { fps: number };
  frames: { att: [number, number][]; def: [number, number][]; ball: [number, number, number] | null }[];
  ball25?: { fps: number; xyz: ([number, number, number] | null)[] };
  events?: ClipEvent[];
}

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]], len = (a: XY) => Math.hypot(a[0], a[1]);

/** the carrier's real pass from the moment: whom it reached (package index) and when (clip time), when it was struck,
 *  and whether it went in the air (the tracked ball over 2 m on the way); null if he did not pass or it did not arrive */
/** (offside: an offside pass, how far beyond the line its man stood as it left the passer, snap.ts offsideReception) */
export interface RealPass { receiver: number; tStrike: number; tRec: number; loft: boolean; offside: { beyond: number } | null }
export function realPass(pkg: Pkg, t0: number, carrier: number): RealPass | null {
  const ev = [...(pkg.events ?? [])].sort((a, b) => a.t - b.t).find((e) => (e.type === 'Pass' || e.type === 'OffsidePass') && e.player === carrier && e.t >= t0 - 0.1 && e.t <= t0 + 6);
  if (!ev) return null;
  const off = ev.type === 'OffsidePass' ? offsideReception(pkg, ev) : null;
  const r = off ?? receptions(pkg).find((x) => x.passer === carrier && Math.abs(x.passT - ev.t) < 1e-6);
  if (!r) return null;
  const b = pkg.ball25;
  let top = 0;
  if (b) for (let f = Math.round(ev.t * b.fps); f <= Math.round(r.t * b.fps); f++) top = Math.max(top, b.xyz[f]?.[2] ?? 0);
  return { receiver: r.player, tStrike: ev.t, tRec: r.t, loft: top > 2, offside: off ? { beyond: off.beyond } : null };
}

/** a player's tracked path after the pause (package index), in the model's frame, 10 Hz, as far as the clip goes */
function trackedPath(pkg: Pkg, c: Scene0, t0: number, p: number, n = SIM_N): XY[] {
  const fr = pkg.frames, k0 = Math.round(t0 * pkg.meta.fps), nAtt = fr[0].att.length, s = c.flipped ? -1 : 1, out: XY[] = [];
  for (let k = k0 + 1; k <= Math.min(fr.length - 1, k0 + n); k++) { const q = p < nAtt ? fr[k].att[p] : fr[k].def[p - nAtt]; out.push([s * q[0], s * q[1]]); }
  return out;
}
/** held only in the response model's windows the path covers in full (respondN), so cut to whole 2 s windows */
const windows = (path: XY[]) => path.slice(0, Math.floor(path.length / 20) * 20);

/** the tracked ball from 0.4 s before the pause, PAST + SIM_N + 1 positions at 10 Hz, in the model's frame */
function trackedBall(pkg: Pkg, c: Scene0, t0: number): V3[] {
  const b = pkg.ball25, fr = pkg.frames, s = c.flipped ? -1 : 1;
  return Array.from({ length: PAST + SIM_N + 1 }, (_, n) => {
    const t = t0 + (n - PAST) * DT;
    const q = (b ? b.xyz[Math.min(b.xyz.length - 1, Math.max(0, Math.round(t * b.fps)))] : null) ?? fr[Math.min(fr.length - 1, Math.max(0, Math.round(t * pkg.meta.fps)))].ball ?? [0, 0, 0.11];
    return [s * q[0], s * q[1], q[2]] as V3;
  });
}

/** `path` to step n, then on at `carry` (m/s) from there: SIM_N positions */
function thenCarry(path: XY[], n: number, carry: XY): XY[] {
  const out = path.slice(0, n), at = out[n - 1];
  for (let m = n + 1; m <= SIM_N; m++) out.push([at[0] + carry[0] * (m - n) * DT, at[1] + carry[1] * (m - n) * DT]);
  return out;
}

/** a run from where he is, moving as he is, to E: as fast as he can turn and speed up into it (up to 7 m/s, 5 m/s²,
 *  the on-ball receiver's limits, inside the response model's 9 and 7), slowing so he arrives and stops there;
 *  SIM_N positions at 10 Hz, its length and how long it takes */
export const RUN_V = 7, RUN_A = 5;
export function runPath(p0: XY, v0: XY, E: XY): { path: XY[]; len: number; dur: number } {
  const h = 0.02, per = Math.round(DT / h), path: XY[] = [];
  let p: XY = [...p0], v: XY = [...v0], dur = NaN, run = 0;
  for (let k = 1; k <= SIM_N * per; k++) {
    const to = sub(E, p), d = len(to), sp = d < 0.05 ? 0 : Math.min(RUN_V, Math.sqrt(2 * RUN_A * Math.max(0, d - 0.05)));
    const want: XY = d > 1e-6 ? [(to[0] / d) * sp, (to[1] / d) * sp] : [0, 0];
    const dv = sub(want, v), dl = len(dv), ka = Math.min(1, (RUN_A * h) / Math.max(dl, 1e-9));
    v = [v[0] + dv[0] * ka, v[1] + dv[1] * ka];
    const q: XY = [p[0] + v[0] * h, p[1] + v[1] * h];
    run += len(sub(q, p)); p = q;
    if (Number.isNaN(dur) && len(sub(E, p)) < 0.5) dur = k * h;
    if (k % per === 0) path.push([...p] as XY);
  }
  return { path, len: run, dur: Number.isNaN(dur) ? SIM_N * DT : dur };
}
/** the length and time of a run to E, for the picker's read-out, as the result card has them (the package's frame
 *  works the same: only distances) */
export function runLook(p0: XY, v0: XY, E: XY) { const r = runPath(p0, v0, E); return { len: r.len, dur: r.dur }; }

/** what the comparison reads at the real receiver's touch: his chance of receiving it (kept or tackled after) and of
 *  keeping it, and how far the nearest defender is from him then (metres) */
export interface Read { receive: number; keep: number; near: number }
export interface RunResult {
  /** what can become of the real pass with the new run (the list on the card), and the pass to play them */
  outs: Outcome[]; pass: Pass;
  /** the same with the runner on his real run, and with the new one */
  base: Read; now: Read;
  /** the defender who moved most because of the run (model index) and by how much, at the real receiver's touch */
  follower: { who: number; shift: number } | null;
  /** had the pass gone into the run instead: what could become of it, the runner's chance of receiving it, and
   *  whether it went in the air */
  alt: { pass: Pass; outs: Outcome[]; receive: number; loft: boolean } | null;
  /** the runner and the real receiver (model indices), the run's length (m) and time (s), and the real pass's target in
   *  the package's frame (where it was received) */
  X: number; R: number; len: number; dur: number; to: XY;
}

/** the off-ball what-if at a moment: `runner` (package index) runs to E (package frame) while the real pass is played */
export function runWhatIf(M: Models, pkg: Pkg, c: Scene0, t0: number, rp: RealPass, runner: number, E: XY): RunResult {
  const X = c.toPkg.indexOf(runner), R = c.toPkg.indexOf(rp.receiver), ball0 = trackedBall(pkg, c, t0);
  const hold = Math.max(1, Math.round((rp.tStrike - t0) / DT)), nR = Math.max(hold + 2, Math.min(TOUCH_N, Math.round((rp.tRec - t0) / DT)));
  // the real receiver on his tracked way to the ball, then carrying it on; the passer on his tracked path for the
  // first 2 s; the ball as it was tracked, at the receiver's feet after his touch
  const realR = trackedPath(pkg, c, t0, rp.receiver), { carry } = carryOf(R, ball0, nR);
  const rPath = realR.length >= nR ? thenCarry(realR, nR, carry) : realR;
  const plan: Plan = { who: R, n: nR, path: rPath, ball: atFeet(ball0, rPath, nR, carry) };
  const kp = windows(trackedPath(pkg, c, t0, c.toPkg[c.kicker], 20));
  const at = (n: number): XY => [ball0[PAST + n][0], ball0[PAST + n][1]], to = sub(at(nR), at(hold)), tl = Math.max(len(to), 1e-6);
  const mk = (extra: Held[]): Pass => ({ ball: ball0, plan, kp: kp.length ? kp : kickerPath(c, hold), turn: 0, hold, dir: [to[0] / tl, to[1] / tl], extra });
  const realRun = windows(trackedPath(pkg, c, t0, runner));
  const run = runPath(c.now[X], velOf(c.past, X), toModel(c, E));
  const passBase = mk(realRun.length ? [{ who: X, path: realRun }] : []), passNow = mk([{ who: X, path: run.path }]);
  const outsBase = outcomes(M, c, passBase), outsNow = outcomes(M, c, passNow);
  // the field at the real receiver's touch, held as in the outcomes' "he receives it" case
  const field = (p: Pass) => {
    const { cm, cp } = noCtrl();
    for (const e of p.extra ?? []) { cm[e.who] = true; cp[e.who] = e.path; }
    cm[c.kicker] = true; cp[c.kicker] = p.kp; cm[R] = true; cp[R] = plan.path;
    return respondN(M, c, plan.ball, cm, cp, nR).map((q) => q[nR - 1]);
  };
  const fB = field(passBase), fN = field(passNow);
  const read = (outs: Outcome[], f: XY[]): Read => {
    let near = Infinity;
    for (let d = 11; d < 22; d++) near = Math.min(near, len(sub(f[d], f[R])));
    const mine = outs.filter((o) => o.who === R && (o.kind === 'kept' || o.kind === 'tackled'));
    return { receive: mine.reduce((a, o) => a + o.p, 0), keep: mine.filter((o) => o.kind === 'kept').reduce((a, o) => a + o.p, 0), near };
  };
  let follower: RunResult['follower'] = null;
  for (let d = 11; d < 22; d++) { const sh = len(sub(fN[d], fB[d])); if (sh > 1.5 && (!follower || sh > follower.shift)) follower = { who: d, shift: sh }; }
  return { outs: outsNow, pass: passNow, base: read(outsBase, fB), now: read(outsNow, fN), follower, alt: intoRun(M, c, X, run.path), X, R, len: run.len, dur: run.dur, to: c.flipped ? [-at(nR)[0], -at(nR)[1]] : at(nR) };
}

/** had he played it into the run: along the ground or lofted, whichever gives the runner the better chance of receiving
 *  it (a short ball into a run is not chipped because the real pass was) */
function intoRun(M: Models, c: Scene0, X: number, path: XY[]): RunResult['alt'] {
  const g = intoRunAs(M, c, X, path, false), l = intoRunAs(M, c, X, path, true);
  return !g ? l : !l ? g : l.receive > g.receive ? l : g;
}
/** the first point on the run where the pass (after the turn it takes him, as the on-ball what-if has it) arrives no
 *  later than the runner; the runner meets it there and carries it on; null if no point on the run can be reached in
 *  time */
function intoRunAs(M: Models, c: Scene0, X: number, path: XY[], loft: boolean): RunResult['alt'] {
  for (let n = 4; n <= Math.min(TOUCH_N, path.length); n++) {
    const Q = path[n - 1], turn = turnTo(c, Q), hold = holdFor(turn), kp = kickerPath(c, hold, turn);
    if (n <= hold + 1) continue;
    const ball = ballTo(c, Q, loft, hold, kp), b0: XY = [ball[PAST + hold][0], ball[PAST + hold][1]];
    if (passTime(len(sub(Q, b0)), loft) > (n - hold) * DT) continue;
    // he meets it where it is at step n (on its point, or a little past it), then carries it on
    const { carry } = carryOf(X, ball, n), mp = thenCarry(path, n, carry);
    const plan: Plan = { who: X, n, path: mp, ball: atFeet(ball, mp, n, carry) };
    const d = sub(Q, kp[hold - 1]), dl = Math.max(len(d), 1e-6);
    const pass: Pass = { ball, plan, kp, turn, hold, dir: [d[0] / dl, d[1] / dl] };
    const outs = outcomes(M, c, pass);
    return { pass, outs, loft, receive: outs.filter((o) => o.who === X && (o.kind === 'kept' || o.kind === 'tackled')).reduce((a, o) => a + o.p, 0) };
  }
  return null;
}
