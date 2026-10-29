// A what-if as a clip of its own: the real clip up to the pause, the simulation after it, in the
// package's format, so the stage, the players, the ball, the HUD and the radar play it as they play any clip. Bodies
// after the pause are made from the simulated paths (motion.ts), cross-faded from the real pose over 0.4 s; the passer
// turns from the way he faced to the pass while he holds the ball; over the bodies go his kick at the strike, the
// first touch (a receive, the thigh, the chest or a header, by the ball's height) and a tackle (standing when the
// tackler is close, a slide when he comes from further), each timed so the clip's contact falls on the event.
import type { Loaded, Joints } from '../data';
import type { MomentPkg } from '../types';
import type { ClipEvent } from '../hud/match';
import { synthesize, type AnimClip, type Track } from './motion';
import { synthesizeGait, gaitFits, type GaitLib } from './gait';
import { faceAt, FIRST_HOLD, type Played, type Scene0, type Outcome, type Pass } from './onball';
import type { XY } from '../response/engine';

const FPS_J = 25, PRE_S = 0.4, FADE_S = 0.4;
/** the clips laid over the bodies, each with its moment of contact (clip seconds, read off the baked joints) and the
 *  part played: the kick (right foot fastest at 0.44 s), the receive (it runs in, slows and the left foot comes up to
 *  the ball at 1.0 s), the thigh (right knee highest at 0.28 s), the chest (no chest control among the clips: the
 *  header's lean back, the head furthest back at 0.78 s, presents the chest), the header (the head drives through at
 *  1.0 s), the standing tackle (the first kick's left-foot jab, furthest out at 0.30 s), the slide tackle (right foot
 *  stretched out and low at 0.56 s, then up again) */
/** `part`: what of the body the clip replaces, the rest keeping its strides: a leg (about its hip) with the upper body
 *  (about the hips), or the upper body alone; the whole body when unset (the slide). The touches
 *  are partial too: laid over whole, the receive ran in place for a second while the receiver's path still moved at a
 *  sprint, and he slid to the ball (#37 glided over the last few frames before the xG showed) */
interface Act { clip: string; at: number; from: number; to: number; part?: 'r' | 'l' | 'upper' }
/** the pass, so the ball is seen to leave his feet: the earlier kick
 *  (kick-soccerball-2) lifted the leg and stamped down, the foot moving back as the ball left; the penalty kick is the
 *  pack's one real swing, but it runs in at 2.7 m/s, so only its right leg is laid over, about his right hip, and the
 *  standing foot stays where his own steps put it: the leg from behind, contact at 0.71 s (the toe 3 cm off the grass,
 *  at its fastest), the follow-through low (to 0.5 m), down again at 1.12 s */
const KICK: Act = { clip: 'soccer-penalty-kick', at: 0.71, from: 0.48, to: 1.04, part: 'r' };
/** the right leg's joints, laid about the right hip; and the upper body, about the hips (the torso turning into the
 *  kick, the arms out for balance), the pelvis and the standing leg left as his steps have them */
const LEGS = { r: ['rKnee', 'rAnkle', 'rBigToe', 'rSmallToe', 'rHeel'], l: ['lKnee', 'lAnkle', 'lBigToe', 'lSmallToe', 'lHeel'] } as const;
const UPPER = ['neck', 'nose', 'rEye', 'lEye', 'rEar', 'lEar', 'rShoulder', 'lShoulder', 'rElbow', 'lElbow', 'rWrist', 'lWrist', 'rThumb', 'rPinky', 'lThumb', 'lPinky'];
const RECEIVE: Act = { clip: 'receive-soccerball', at: 1.0, from: 0.75, to: 1.3, part: 'l' };
const THIGH: Act = { clip: 'kneeing-soccerball-2', at: 0.28, from: 0.05, to: 0.55, part: 'r' };
const CHEST: Act = { clip: 'header-soccerball', at: 0.78, from: 0.3, to: 0.95, part: 'upper' };
const HEADER: Act = { clip: 'header-soccerball', at: 1.0, from: 0.6, to: 1.3, part: 'upper' };
const STAND: Act = { clip: 'kick-soccerball', at: 0.3, from: 0, to: 0.56, part: 'l' };
/** the first-time finishes: the header whole (the head drives through at 1.0 s), lifted by the lay's `hop`
 *  for a ball above his standing head; the volley the kick's swing with the leg turned up about the hip until the foot
 *  reaches the ball (the lay's `lift`); a first-time drive the kick itself */
const HEAD_SHOT: Act = { clip: 'header-soccerball', at: 1.0, from: 0.6, to: 1.3 };
const VOLLEY: Act = { clip: 'soccer-penalty-kick', at: 0.71, from: 0.48, to: 1.04, part: 'r' };
const SLIDE: Act = { clip: 'soccer-tackle-2', at: 0.56, from: 0.1, to: 1.72 };
/** the keeper's claim of a ball into his goal area (onball.ts keeperRule / outcomes): the high catch, the
 *  hands together 1.4 m up at 0.4 s, laid over whole, the ball into his hands */
const GK_CATCH: Act = { clip: 'goalkeeper-catch-2', at: 0.4, from: 0, to: 0.8 };
/** a ball along the ground he gathers low: the hands at the grass at 0.7 s */
const GK_SCOOP: Act = { clip: 'goalkeeper-scoop', at: 0.7, from: 0.3, to: 1.1 };
export const ACT_CLIPS = [...new Set([KICK, RECEIVE, THIGH, CHEST, HEADER, STAND, SLIDE, GK_CATCH, GK_SCOOP].map((a) => a.clip))];
/** the first touch's clip by the ball's height there */
const touchAct = (z: number) => (z < 0.5 ? RECEIVE : z < 1.0 ? THIGH : z < 1.6 ? CHEST : HEADER);
/** a tackle: standing when the tackler is within 2.2 m of the ball 0.4 s before, a slide from further */
const tackleAct = (far: number) => (far > 2.2 ? SLIDE : STAND);

type Pkg = MomentPkg & { keepers?: number[]; ball25?: { fps: number; xyz: ([number, number, number] | null)[] }; events?: ClipEvent[]; clock0?: number; players?: unknown[] };

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/** 10 Hz samples at any time: a cubic through them with Catmull-Rom tangents, except at a knot where the motion changes
 *  sharply (a kick from rest, a touch, a bounce, the real play handing over to the simulation), where each side keeps
 *  its own segment's slope; a plain Catmull-Rom ran the ball back 10 cm just before a kick and overshot every stop */
function kinked(a: number[], b: number[]) {
  let dd = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dd += (b[i] - a[i]) ** 2; na += a[i] ** 2; nb += b[i] ** 2; }
  return Math.sqrt(dd) > 0.5 * Math.max(Math.sqrt(na), Math.sqrt(nb)) + 0.02;
}
function smoothAt(get: (i: number) => number[] | null, x: number): number[] | null {
  const k = Math.floor(x), u = x - k, p1 = get(k), p2 = get(k + 1);
  if (!p1 || !p2) return p1;
  const p0 = get(k - 1) ?? p1, p3 = get(k + 2) ?? p2, D = p1.length;
  const d0 = p1.map((v, i) => v - p0[i]), d1 = p2.map((v, i) => v - p1[i]), d2 = p3.map((v, i) => v - p2[i]);
  const m1 = kinked(d0, d1) ? d1 : d1.map((v, i) => (v + d0[i]) / 2), m2 = kinked(d1, d2) ? d1 : d1.map((v, i) => (v + d2[i]) / 2);
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  return Array.from({ length: D }, (_, i) => h00 * p1[i] + h10 * m1[i] + h01 * p2[i] + h11 * m2[i]);
}

/** the angle of a clip's toe swing at time `at` (radians, the clip's own frame: +y its facing), and the toe's place then
 *  about the right hip: the pass faces the swing along the pass, and the ball sits where the toe meets it */
function swingOf(k: AnimClip, at: number) {
  const nJ = k.names.length, T = k.names.indexOf('rBigToe'), H = k.names.indexOf('rHip');
  const g = (t: number, j: number, d: number) => { const x = Math.min(k.frames - 1, Math.max(0, t * k.fps)), a = Math.floor(x), b = Math.min(k.frames - 1, a + 1), u = x - a; return lerp(k.data[(a * nJ + j) * 3 + d], k.data[(b * nJ + j) * 3 + d], u); };
  const vx = g(at + 0.02, T, 0) - g(at - 0.02, T, 0), vy = g(at + 0.02, T, 1) - g(at - 0.02, T, 1);
  return { theta: Math.atan2(vy, vx), toe: [g(at, T, 0) - g(at, H, 0), g(at, T, 1) - g(at, H, 1)] as [number, number] };
}

/** a what-if's own clip (buildBranch's), which a chain's next step is built on (chain.ts) */
export const isBranch = (d: Loaded | null) => !!(d?.pkg.meta as { branch?: boolean } | undefined)?.branch;

export interface BranchInfo { t0: number; target: XY; outcome: Outcome; carrier: number; who: number; tackler: number | null; end: number; turn: number; hold: number }

/** the clip of a what-if: `real` up to t0, then `pl` (the model's frame, turned back here) to its end; `target` is the
 *  picked point in the package's frame */
/** `real`: players whose tracked bodies play on past the pause, to a clip time, because the simulation keeps them on
 *  their tracked paths (the off-ball what-if's passer and real receiver: his real first-time pass, the real touch) */
export interface BranchOpts {
  real?: { p: number; until: number }[];
  /** drag (each ghost dragged to its position instead of animated):
   *  every player keeps his pose of the moment and is carried along his simulated path; no locomotion, kick or touch is
   *  synthesised (the shell shows the branch in the ghost style, useWhatIf.tsx). The real strides (gait.ts), which
   *  animate each player to his spot, replaced it as the default; kept behind ?widrag=1 */
  drag?: boolean;
  /** the real strides (gait.ts): the locomotion comes from the library, each man continuing from his real pose at the
   *  pause, his own strides first; without it the Mixamo loops (motion.ts) */
  gait?: GaitLib | null;
  /** the receiver's finish as the shot what-if decided it (shot.ts evalShot; a header or a volley as well as a ground
   *  shot): first time, it is laid over at his touch facing the goal (a header, jumping for
   *  a ball above his standing head; a volley, the leg raised to the ball; a drive), and the ball stays where he met it
   *  (the shot itself is not simulated: the xG says it); after a touch, the touch as before */
  finish?: { how: 'first' | 'touch'; kind: 'header' | 'volley' | 'drive'; z: number } | null;
}
export function buildBranch(real: Loaded, clips: Record<string, AnimClip>, t0: number, c: Scene0, pl: Played, target: XY, outcome: Outcome, pass: Pass, opts: BranchOpts = {}): { data: Loaded; info: BranchInfo } {
  const pkg = real.pkg as Pkg, fr = pkg.frames, fps = pkg.meta.fps, nAtt = fr[0].att.length, P = nAtt + fr[0].def.length, s = c.flipped ? -1 : 1;
  const k0 = Math.min(fr.length - 1, Math.round(t0 * fps)), N = pl.paths[0].length;
  // the simulated frames in the package's order and frame
  const simPos = (n: number, p: number): [number, number] => { const q = pl.paths[c.toPkg.indexOf(p)][n]; return [s * q[0], s * q[1]]; };
  const frames = fr.slice(0, k0 + 1).map((f) => ({ ...f }));
  for (let n = 0; n < N; n++) {
    const b = pl.ball[n];
    frames.push({ att: Array.from({ length: nAtt }, (_, p) => simPos(n, p)), def: Array.from({ length: P - nAtt }, (_, p) => simPos(n, nAtt + p)), ball: [s * b[0], s * b[1], b[2]] });
  }
  // no opponent standing on the ball as the receiver takes it (at 26:40 the ball #37 was to shoot overlapped the
  // defender in front of him): the engine keeps players apart (limits' minGap) but not a man
  // from the ball, and a marker's path can run through it; round the touch any opponent within BALL_GAP of the ball
  // is set that far off it, the shift faded in and out over three steps. Looks only: the models' numbers stand
  if (outcome.who >= 0 && outcome.kind === 'kept') {
    // (step n after the pause is frame k0 + n: the simulated frames start one step after the pause)
    const nT = Math.round(outcome.t / 0.1), mine = outcome.who < 11, BALL_GAP = 0.6, FADE = 3;
    for (let n = Math.max(1, nT - FADE); n <= Math.min(N, nT + FADE); n++) {
      const f = frames[k0 + n], b = f.ball, w = 1 - Math.abs(n - nT) / (FADE + 1);
      if (!b) continue;
      for (let m = 0; m < 11; m++) {
        const i = mine ? 11 + m : m, p = c.toPkg[i], q = p < nAtt ? f.att[p] : f.def[p - nAtt];
        const dx = q[0] - b[0], dy = q[1] - b[1], d = Math.hypot(dx, dy);
        if (d >= BALL_GAP) continue;
        const ux = d > 1e-6 ? dx / d : 1, uy = d > 1e-6 ? dy / d : 0, push = (BALL_GAP - d) * w;
        q[0] += ux * push; q[1] += uy * push;
      }
    }
  }
  const T0 = k0 / fps, tEnd = (frames.length - 1) / fps;
  // the ball at 25 Hz: the real one to the pause, the simulated one after (linear between its 10 Hz steps before the
  // pause, along the kink-aware cubic after it, so a lofted ball flies an arc and a kick starts from rest)
  const ballFrames = (t: number): [number, number, number] | null => {
    const x = Math.min(frames.length - 1, Math.max(0, t * fps)), k = Math.floor(x), u = x - k, at = (i: number) => frames[Math.min(frames.length - 1, Math.max(0, i))].ball;
    const a = at(k), b = at(k + 1);
    if (!a || !b) return a;
    if (k < k0) return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    const q = smoothAt((i) => at(Math.min(frames.length - 1, Math.max(k0 - 1, i))), x)!;
    return [q[0], q[1], Math.max(0.11, q[2])];
  };
  // the bodies run to the frame at or past the end, whichever way the float falls (rounding left 8.7 s × 25 =
  // 217.4999… and 8.6 s × 25 = 215.0000…03 past the data, and the players vanished on the last moment: poseAt draws
  // no one outside the samples); at most one spare frame
  const f0 = Math.round(T0 * FPS_J), F = Math.ceil(tEnd * FPS_J + 1e-6) + 1;
  const xyz = Array.from({ length: F }, (_, f) => (f <= f0 && pkg.ball25 ? pkg.ball25.xyz[f] ?? ballFrames(f / FPS_J) : ballFrames(f / FPS_J)));

  // bodies: the tracking to the pause; after it, synthesised from the paths (with 0.4 s of the real run before, so the
  // facing and the gait start from how he was moving)
  const J = real.joints!, nJ = J.names.length, pre = Math.round(PRE_S * FPS_J), simF = F - f0 - 1;
  const posAt = (t: number, p: number): [number, number] => {
    const x = Math.min(frames.length - 1, Math.max(0, t * fps)), k = Math.floor(x), u = x - k, g = (i: number) => { const fi = frames[Math.min(frames.length - 1, Math.max(0, i))]; return p < nAtt ? fi.att[p] : fi.def[p - nAtt]; };
    if (k >= k0) { const q = smoothAt((i) => g(Math.max(k0 - 1, i)), x)!; return [q[0], q[1]]; }
    const a = g(k), b = g(k + 1); return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  };
  const tracks: Track[] = Array.from({ length: P }, (_, p) => ({ keeper: (pkg.keepers ?? []).includes(p), pos: Array.from({ length: pre + 1 + simF }, (_, i) => posAt(T0 + (i - pre) / FPS_J, p)) }));
  const ballTrack = Array.from({ length: pre + 1 + simF }, (_, i) => { const b = ballFrames(T0 + (i - pre) / FPS_J); return b ? [b[0], b[1]] as [number, number] : null; });
  const pids = ((pkg.players ?? []) as { pid?: string }[]).map((q) => q?.pid ?? null);
  const S = opts.drag ? null : opts.gait && gaitFits(opts.gait, J.names) ? synthesizeGait(opts.gait, tracks, ballTrack, FPS_J, nAtt, J.names, Array.from({ length: P }, (_, p) => pids[p] ?? null), { J, f0, pre }) : synthesize(clips, tracks, ballTrack, FPS_J, nAtt, J.names);
  const data = new Float32Array(F * P * nJ * 3);
  data.set(J.data.subarray(0, (f0 + 1) * P * nJ * 3));
  const hip = J.names.indexOf('midHip'), carrierPkg = c.toPkg[c.kicker], tStrike = T0 + pass.hold * 0.1, lost = outcome.kind === 'lost';
  const who = outcome.who >= 0 ? c.toPkg[outcome.who] : null, tackler = outcome.tackle ? c.toPkg[outcome.tackle.by] : null;
  const tTouch = T0 + (Number.isFinite(outcome.t) ? outcome.t : 0), tTackle = outcome.tackle ? T0 + outcome.tackle.at * 0.1 : 0;   // from the pause
  const dirTo = (a: [number, number], b: [number, number]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const ball2 = (t: number): [number, number] => { const b = ballFrames(t)!; return [b[0], b[1]]; };
  const far = (p: number, t: number) => Math.hypot(...(([a, b]) => [a[0] - b[0], a[1] - b[1]] as [number, number])([posAt(t - 0.4, p), ball2(t)]));
  /** `pick`: a finish with the foot, struck with whichever foot the ball comes to (`side`, settled at its first frame
   *  from the hips' distances to the ball; the clip's right leg is mirrored onto the left) */
  const lays: { p: number; act: Act; t: number; face: number; hop?: number; lift?: number; pick?: boolean; side?: 'l' | 'r' }[] = [];
  let finishDir: number | null = null;   // the way the receiver's first-time finish goes (towards the goal), for the ball
  // tracked bodies kept past the pause (opts.real), each to a frame; the others from the pause
  const realTo = new Map((opts.real ?? []).map((r) => [r.p, Math.min(J.frames - 1, Math.max(f0, Math.round(r.until * FPS_J)))]));
  const realAt = (p: number, t: number) => (realTo.get(p) ?? f0) >= Math.round(t * FPS_J);
  // the kick swings along the pass (no kick if he loses it first, nor if his tracked body plays it); the first touch
  // faces the ball coming in; a tackle faces the ball from where the tackler set off
  const kickClip = clips[KICK.clip], swing = kickClip ? swingOf(kickClip, KICK.at) : null, kicked = !opts.drag && !lost && !realAt(carrierPkg, tStrike) && !!swing;
  const passAngle = dirTo(posAt(tStrike, carrierPkg), target), kickFace = passAngle + Math.PI / 2 - (swing?.theta ?? Math.PI / 2);
  if (kicked) lays.push({ p: carrierPkg, act: KICK, t: tStrike, face: kickFace });
  if (who !== null && realAt(who, tTouch)) { /* his tracked body makes the touch */ }
  else if (who !== null && lost) lays.push({ p: who, act: tackleAct(far(who, tTouch)), t: tTouch, face: dirTo(posAt(tTouch - 0.4, who), ball2(tTouch)) });
  else if (who !== null && opts.finish?.how === 'first') {
    // first time at the goal (the attacking goal is +x in the model's frame, s turns it to the package's)
    const fin = opts.finish, toGoal = dirTo(posAt(tTouch, who), [s * 52.5, 0]), noseZ = J.data[((f0 * P + who) * nJ + J.names.indexOf('nose')) * 3 + 2] || 1.6;
    finishDir = toGoal;
    if (fin.kind === 'header') lays.push({ p: who, act: HEAD_SHOT, t: tTouch, face: toGoal, hop: Math.max(0, Math.min(0.5, fin.z - (noseZ + 0.08))) });
    else if (fin.kind === 'volley') lays.push({ p: who, act: VOLLEY, t: tTouch, face: toGoal + Math.PI / 2 - (swing?.theta ?? Math.PI / 2), lift: fin.z, pick: true });
    else lays.push({ p: who, act: KICK, t: tTouch, face: toGoal + Math.PI / 2 - (swing?.theta ?? Math.PI / 2), pick: true });
  }
  else if (who !== null && outcome.kind === 'cut' && (pkg.keepers ?? []).includes(who)) lays.push({ p: who, act: (ballFrames(tTouch)?.[2] ?? 0.11) >= 0.8 ? GK_CATCH : GK_SCOOP, t: tTouch, face: dirTo(ball2(tTouch), ball2(tTouch - 0.3)) });
  else if (who !== null) lays.push({ p: who, act: touchAct(ballFrames(tTouch)?.[2] ?? 0.11), t: tTouch, face: dirTo(ball2(tTouch), ball2(tTouch - 0.3)) });
  if (tackler !== null) lays.push({ p: tackler, act: tackleAct(far(tackler, tTackle)), t: tTackle, face: dirTo(posAt(tTackle - 0.4, tackler), ball2(tTackle)) });
  // the passer's turn on the ball: his body held to the way he faces (faceAt, from the pause round to the pass) until
  // the strike, or until he loses it, then let go over 0.3 s
  const tLet = lost ? tTouch : tStrike;   // (s: the model's frame to the package's, above)
  const ix = (n: string) => J.names.indexOf(n), RS = ix('rShoulder'), LS = ix('lShoulder'), RH = ix('rHip'), LH = ix('lHip');
  for (let f = f0 + 1; f < F; f++) {
    const i = pre + (f - f0);
    for (let p = 0; p < P; p++) {
      const fx = realTo.get(p) ?? f0, o = ((f * P + p) * nJ) * 3;
      if (f <= fx) { data.set(J.data.subarray(((f * P + p) * nJ) * 3, ((f * P + p) * nJ + nJ) * 3), o); continue; }
      if (!S) {
        // dragged: his pose at the moment, carried along his path, turned about the hips to face the way he moves once
        // he moves at all (over 0.5 m/s, fully by 1.5), so the runs look authentic
        const ro = ((fx * P + p) * nJ) * 3, a = posAt(fx / FPS_J, p), b = posAt(f / FPS_J, p), dx = b[0] - a[0], dy = b[1] - a[1];
        for (let j = 0; j < nJ; j++) { data[o + j * 3] = J.data[ro + j * 3] + dx; data[o + j * 3 + 1] = J.data[ro + j * 3 + 1] + dy; data[o + j * 3 + 2] = J.data[ro + j * 3 + 2]; }
        const q0 = posAt(Math.max(0, f - 3) / FPS_J, p), q1 = posAt(Math.min(F - 1, f + 3) / FPS_J, p), vx = (q1[0] - q0[0]) * (FPS_J / 6), vy = (q1[1] - q0[1]) * (FPS_J / 6), sp = Math.hypot(vx, vy);
        const wv = Math.min(1, Math.max(0, (sp - 0.5) / 1.0));
        if (wv > 0) {
          const g = (j: number, d: number) => data[o + j * 3 + d], rx = g(RS, 0) - g(LS, 0) + g(RH, 0) - g(LH, 0), ry = g(RS, 1) - g(LS, 1) + g(RH, 1) - g(LH, 1);
          let da = Math.atan2(vy, vx) - Math.atan2(-rx, ry); while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          da *= wv;
          const cs = Math.cos(da), sn = Math.sin(da), hx = g(hip, 0), hy = g(hip, 1);
          for (let j = 0; j < nJ; j++) { const x = data[o + j * 3] - hx, y = data[o + j * 3 + 1] - hy; data[o + j * 3] = hx + x * cs - y * sn; data[o + j * 3 + 1] = hy + x * sn + y * cs; }
        }
        continue;
      }
      const w = smooth((f - fx) / FPS_J / FADE_S), so = ((i * P + p) * nJ) * 3, ro = ((fx * P + p) * nJ) * 3;
      // the real pose at the pause (or where his tracked body stops), carried along with the hips
      const dx = S.data[so + hip * 3] - J.data[ro + hip * 3], dy = S.data[so + hip * 3 + 1] - J.data[ro + hip * 3 + 1];
      for (let j = 0; j < nJ; j++) {
        data[o + j * 3] = lerp(J.data[ro + j * 3] + dx, S.data[so + j * 3], w);
        data[o + j * 3 + 1] = lerp(J.data[ro + j * 3 + 1] + dy, S.data[so + j * 3 + 1], w);
        data[o + j * 3 + 2] = lerp(J.data[ro + j * 3 + 2], S.data[so + j * 3 + 2], w);
      }
      // the turn: rotate his body about the hips from the way it faces to the way he should
      // (a first-time ball: the foot goes to it along the pass, the body stays as it was)
      if (p === carrierPkg && f / FPS_J < tLet + 0.3 && !realAt(carrierPkg, tStrike) && pass.hold > FIRST_HOLD) {
        const tau = Math.min(f / FPS_J, tLet) - T0, want = faceAt(c, pass.dir, pass.hold, tau), wa = Math.atan2(s * want[1], s * want[0]);
        const g = (j: number, d: number) => data[o + j * 3 + d], rx = g(RS, 0) - g(LS, 0) + g(RH, 0) - g(LH, 0), ry = g(RS, 1) - g(LS, 1) + g(RH, 1) - g(LH, 1);
        let da = wa - Math.atan2(-rx, ry); while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        da *= 1 - smooth((f / FPS_J - tLet) / 0.3);
        const cs = Math.cos(da), sn = Math.sin(da), hx = g(hip, 0), hy = g(hip, 1);
        for (let j = 0; j < nJ; j++) { const x = data[o + j * 3] - hx, y = data[o + j * 3 + 1] - hy; data[o + j * 3] = hx + x * cs - y * sn; data[o + j * 3 + 1] = hy + x * sn + y * cs; }
      }
      // the acts laid over: from `from` (ramped in over 0.12 s) to `to`, then held while ramped out over 0.2 s; in
      // place (the clip's hips held on the simulated path, its height kept)
      for (const L of lays) {
        const k = clips[L.act.clip], tk = L.act.at + (f / FPS_J - L.t);
        if (p !== L.p || !k || tk < L.act.from || tk > L.act.to + 0.2) continue;
        const wk = smooth((tk - L.act.from) / 0.12) * (1 - smooth((tk - L.act.to) / 0.2)), kf = Math.min(k.frames - 1, Math.min(L.act.to, tk) * k.fps), kk = Math.floor(kf), ku = kf - kk, k1 = Math.min(k.frames - 1, kk + 1);
        const [rx, ry] = [data[o + hip * 3], data[o + hip * 3 + 1]], cs = Math.cos(L.face), sn = Math.sin(L.face), kh = k.names.indexOf('midHip');
        if (L.act.part) {
          // the acting leg alone, about its hip (the clip's own joint order), the foot kept off the grass; then the
          // upper body about the hips; the other leg and the hips keep their strides
          const part = L.act.part;
          // a finish with the foot takes the foot the ball comes to (the hip nearer the ball at the act's first frame);
          // the clip's leg is mirrored across his facing when it is the other one
          if (L.pick && part !== 'upper' && L.side === undefined) {
            const b = ballFrames(L.t), lh = ix('lHip'), rh = ix('rHip');
            L.side = b && Math.hypot(b[0] - data[o + lh * 3], b[1] - data[o + lh * 3 + 1]) < Math.hypot(b[0] - data[o + rh * 3], b[1] - data[o + rh * 3 + 1]) ? 'l' : 'r';
          }
          const side = part === 'upper' ? part : L.side ?? part, mirror = part !== 'upper' && side !== part, flip = mirror ? -1 : 1;
          const hipN = side === 'l' ? 'lHip' : 'rHip', clipHip = part === 'l' ? 'lHip' : 'rHip';
          const nK = k.names.length, kr = k.names.indexOf(part === 'upper' ? hipN : clipHip), br = ix(hipN), bx = data[o + br * 3], by = data[o + br * 3 + 1], bz = data[o + br * 3 + 2];
          const c = (j: number, d: number) => lerp(k.data[(kk * nK + j) * 3 + d], k.data[(k1 * nK + j) * 3 + d], ku);
          // the volley: the leg turned up about the hip (forward and up, in the clip's own frame) until the ankle at the
          // contact frame reaches a hand's breadth under the ball; a ball out of reach gets the full lift
          let th = 0;
          if (L.lift !== undefined && part !== 'upper') {
            const fa = Math.min(k.frames - 1, Math.round(L.act.at * k.fps)), ja = k.names.indexOf(`${part}Ankle`), fy = k.data[(fa * nK + ja) * 3 + 1] - k.data[(fa * nK + kr) * 3 + 1], fz = k.data[(fa * nK + ja) * 3 + 2] - k.data[(fa * nK + kr) * 3 + 2];
            let lo = 0, hi = 1.35;
            for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (bz + fy * Math.sin(mid) + fz * Math.cos(mid) < L.lift - 0.1) lo = mid; else hi = mid; }
            // (the leg comes up over the whole backswing, from the act's start to the contact, not in the 0.12 s ramp)
            th = lo * smooth((tk - L.act.from) / Math.max(0.05, L.act.at - L.act.from));
          }
          const ct = Math.cos(th), stt = Math.sin(th);
          for (const n of side === 'upper' ? [] : LEGS[side]) {
            const jc = k.names.indexOf(mirror ? n.replace(/^[lr]/, part) : n), jb = ix(n), ax = (c(jc, 0) - c(kr, 0)) * flip, ay0 = c(jc, 1) - c(kr, 1), az0 = c(jc, 2) - c(kr, 2), ay = ay0 * ct - az0 * stt, az = ay0 * stt + az0 * ct;
            data[o + jb * 3] = lerp(data[o + jb * 3], bx + ax * sn + ay * cs, wk);
            data[o + jb * 3 + 1] = lerp(data[o + jb * 3 + 1], by - ax * cs + ay * sn, wk);
            data[o + jb * 3 + 2] = lerp(data[o + jb * 3 + 2], Math.max(n.endsWith('Knee') ? 0.25 : 0.02, bz + az), wk);
          }
          const km = k.names.indexOf('midHip'), hz = data[o + hip * 3 + 2];
          for (const n of UPPER) {
            const jc = k.names.indexOf(n), jb = ix(n), ax = c(jc, 0) - c(km, 0), ay = c(jc, 1) - c(km, 1), az = c(jc, 2) - c(km, 2);
            data[o + jb * 3] = lerp(data[o + jb * 3], rx + ax * sn + ay * cs, wk);
            data[o + jb * 3 + 1] = lerp(data[o + jb * 3 + 1], ry - ax * cs + ay * sn, wk);
            data[o + jb * 3 + 2] = lerp(data[o + jb * 3 + 2], hz + az, wk);
          }
          continue;
        }
        const g = (i: number, j: number, d: number) => lerp(k.data[(kk * nJ + j) * 3 + d], k.data[(k1 * nJ + j) * 3 + d], ku) - (i >= 0 ? lerp(k.data[(kk * nJ + i) * 3 + d], k.data[(k1 * nJ + i) * 3 + d], ku) : 0);
        // the jump for a header (the lay's `hop`): the whole body up and down over 0.7 s about the contact
        const hz = L.hop ? L.hop * Math.max(0, Math.cos((Math.PI * (tk - L.act.at)) / 0.7)) : 0;
        for (let j = 0; j < nJ; j++) {
          const ax = g(kh, j, 0), ay = g(kh, j, 1), az = g(-1, j, 2) + hz;
          // the clip faces +y; its +x goes a quarter turn clockwise of the facing (motion.ts)
          data[o + j * 3] = lerp(data[o + j * 3], rx + ax * sn + ay * cs, wk);
          data[o + j * 3 + 1] = lerp(data[o + j * 3 + 1], ry - ax * cs + ay * sn, wk);
          data[o + j * 3 + 2] = lerp(data[o + j * 3 + 2], az, wk);
        }
      }
    }
  }
  const joints: Joints = { ...J, frames: F, data };

  // the ball on his foot: from where it was at the pause it comes on, slowing, to the point the kicking
  // toe meets (the clip's toe at contact about his right hip, 10 cm on along the pass), rests there, and leaves from it
  // at the strike, the simulated flight taking over within 0.5 s; for the eye only, the models keep their own ball
  const P0 = xyz[f0], Pm = xyz[Math.max(0, f0 - 2)];
  if (P0 && Pm && !realAt(carrierPkg, tStrike)) {
    const V0 = [((P0[0] - Pm[0]) * FPS_J) / 2, ((P0[1] - Pm[1]) * FPS_J) / 2], ta = Math.min(0.4, Math.max(0.15, (lost ? tTouch : tStrike) - T0 - 0.12));
    let contact: [number, number] | null = null;
    const mS = ballFrames(tStrike);
    if (kicked && swing && mS) {
      const fs = Math.min(F - 1, Math.floor(tStrike * FPS_J)), u = tStrike * FPS_J - fs, br = ix('rHip'), at = (f: number, d: number) => data[((Math.min(F - 1, f) * P + carrierPkg) * nJ + br) * 3 + d];
      const hx = lerp(at(fs, 0), at(fs + 1, 0), u), hy = lerp(at(fs, 1), at(fs + 1, 1), u), cs = Math.cos(kickFace), sn = Math.sin(kickFace), [ax, ay] = swing.toe;
      contact = [hx + ax * sn + ay * cs + Math.cos(passAngle) * 0.1, hy - ax * cs + ay * sn + Math.sin(passAngle) * 0.1];
    }
    for (let f = f0 + 1; f < F; f++) {
      const t = f / FPS_J, m = xyz[f];
      if (!m) continue;
      let q: [number, number, number] = [m[0], m[1], m[2]];
      if (contact && mS) {
        const w = t <= tStrike ? smooth((t - (tStrike - 0.35)) / 0.35) : 1 - smooth((t - tStrike) / 0.5);
        q = [m[0] + (contact[0] - mS[0]) * w, m[1] + (contact[1] - mS[1]) * w, t <= tStrike ? 0.11 : m[2]];
      }
      if (t - T0 < ta) {
        // still coming in: on at its own pace, slowing to a stop by ta, handed over to where it should be
        const tau = t - T0, d = tau - (tau * tau) / (2 * ta), w = smooth(tau / ta);
        q = [lerp(P0[0] + V0[0] * d, q[0], w), lerp(P0[1] + V0[1] * d, q[1], w), lerp(Math.max(0.11, P0[2]), q[2], w)];
      }
      xyz[f] = q;
    }
  }

  // a first-time finish: over the last 0.3 s the ball comes to the part that strikes it, the toe for a volley or a
  // drive, the forehead for a header, and stays there, in the air (the shot is not played; the xG says it). The meeting
  // point is under his body, so without this the ball sat at the standing foot while the other swung (the ball belongs
  // at the striking foot, or at the head for a header)
  if (opts.finish?.how === 'first' && who !== null && !lost && !realAt(who, tTouch) && finishDir !== null) {
    const fT = Math.min(F - 1, Math.round(tTouch * FPS_J)), g = (n: string, d: number) => data[((fT * P + who) * nJ + ix(n)) * 3 + d];
    const head = opts.finish.kind === 'header', cx = Math.cos(finishDir), cy = Math.sin(finishDir), toe = `${lays.find((L) => L.p === who && L.pick)?.side ?? 'r'}BigToe`;
    const contact: [number, number, number] = head ? [g('nose', 0) + cx * 0.14, g('nose', 1) + cy * 0.14, g('nose', 2) + 0.02] : [g(toe, 0) + cx * 0.1, g(toe, 1) + cy * 0.1, Math.max(0.11, g(toe, 2) + 0.04)];
    const from = Math.max(f0 + 1, fT - 8);
    for (let f = from; f < F; f++) {
      const m = xyz[f];
      if (!m) continue;
      const u = f >= fT ? 1 : smooth((f - from) / Math.max(1, fT - from));
      xyz[f] = [lerp(m[0], contact[0], u), lerp(m[1], contact[1], u), lerp(m[2], contact[2], u)];
    }
    // and he holds the contact: the frame or two the clip runs past the touch would show the follow-through with the
    // ball still at his foot (the stop is on the contact)
    for (let f = fT + 1; f < F; f++) data.copyWithin(((f * P + who) * nJ) * 3, ((fT * P + who) * nJ) * 3, ((fT * P + who) * nJ + nJ) * 3);
  }

  // the keeper's catch: the ball comes into his hands over the last 0.3 s and stays between them
  if (who !== null && outcome.kind === 'cut' && (pkg.keepers ?? []).includes(who) && !realAt(who, tTouch)) {
    const fT = Math.min(F - 1, Math.round(tTouch * FPS_J)), lw = ix('lWrist'), rw = ix('rWrist');
    const hands = (f: number): [number, number, number] => { const g = (j: number, d: number) => data[((f * P + who) * nJ + j) * 3 + d]; return [(g(lw, 0) + g(rw, 0)) / 2, (g(lw, 1) + g(rw, 1)) / 2, Math.max(0.15, (g(lw, 2) + g(rw, 2)) / 2)]; };
    const from = Math.max(f0 + 1, fT - 8), hT = hands(fT);
    for (let f = from; f < F; f++) {
      const m = xyz[f];
      if (!m) continue;
      if (f >= fT) { xyz[f] = hands(f); continue; }
      const u = smooth((f - from) / Math.max(1, fT - from));
      xyz[f] = [lerp(m[0], hT[0], u), lerp(m[1], hT[1], u), lerp(m[2], hT[2], u)];
    }
  }

  // the events: the real ones before the pause, then the pass and what became of it
  const att = (p: number) => p < nAtt, clock0 = pkg.clock0 ?? 0;
  const ev = (t: number, type: string, player: number, extra: Partial<ClipEvent> = {}): ClipEvent => ({ t, type, outcome: 'Successful', shooting: att(player), player, clock: clock0 + t, tags: [], ...extra });
  const events: ClipEvent[] = (pkg.events ?? []).filter((e) => e.t <= T0);
  if (lost) { if (who !== null) events.push(ev(tTouch, 'Tackle', who)); }
  else events.push(ev(tStrike, 'Pass', carrierPkg, { outcome: outcome.kind === 'kept' || outcome.kind === 'tackled' ? 'Successful' : 'Unsuccessful', receiver: outcome.kind === 'kept' || outcome.kind === 'tackled' ? who : null }));
  if (who !== null && !lost) events.push(ev(tTouch, outcome.kind === 'cut' ? 'Interception' : 'BallTouch', who));
  if (tackler !== null) events.push(ev(tTackle, 'Tackle', tackler));

  // (no real goal in a simulation: the stadium's crowd flashed for the real one at 55:43 while a branch played)
  const branch: Pkg = { ...pkg, frames, ball25: { fps: FPS_J, xyz }, events, meta: { ...pkg.meta, branch: true, goal: undefined } as Pkg["meta"] };
  return { data: { ...real, pkg: branch, joints }, info: { t0: T0, target, outcome, carrier: carrierPkg, who: who ?? -1, tackler, end: tEnd, turn: pass.turn, hold: pass.hold } };
}
