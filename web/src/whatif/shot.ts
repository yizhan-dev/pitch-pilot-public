import { modelFile } from '../data/paths';
// The what-if ends in a shot (Yi, 2026-10-25: "pause right at #37 receive it, and then plot the xG of him shooting";
// "for now ... only the one-shot-before-goal scenario"): the pass is changed, the simulation stops as the receiver
// takes the ball, and we give his chance of scoring if he shot from there, with the defenders and their keeper where the
// simulation has them then (the defender-aware model, response/xg.ts); beside it what really happened, on the same model.
// Package frames: the attacking team attacks +x; a shooter of the other team is turned round.
import { xgFreeze, type XgFreezeModel, type XgPoint } from '../response/xg';
import { turnover, type TurnoverModel } from '../response/outcomes';
import type { ClipEvent } from '../hud/match';
import type { Outcome } from './onball';

interface Pkg {
  meta: { fps: number };
  frames: { att: [number, number][]; def: [number, number][]; ball: [number, number, number] | null }[];
  keepers?: number[];
  events?: ClipEvent[];
  ball25?: { fps: number; xyz: ([number, number, number] | null)[] };
}

/** the shot-type model (xg_shot.json, private/response/fit_xg_shot.py), the base model if it is missing */
let xgP: Promise<XgFreezeModel | null> | null = null;
export const loadXgModel = () => (xgP ??= fetch(modelFile('xg_shot.json')).then((r) => (r.ok ? r.json() : fetch(modelFile('xg_freeze.json')).then((q) => (q.ok ? q.json() : null)))).catch(() => null));

/** a high ball received in the box (aerial.json, private/response/aerial_fit.py on StatsBomb's 360 data: 2026-10-27,
 *  Yi: "likely the ball will not be able to get on the ground without defender clearing them"): `control` the chance he
 *  loses it if he takes it down, `first` the share taken first time, both logistic in the nearest opponent's distance
 *  (log m). Loaded once beside the xG model; without it the tracking turnover model (with the ball's height) stands in. */
export interface AerialModel { control: number[]; first: number[] }
let AER: AerialModel | null = null, aerP: Promise<AerialModel | null> | null = null;
export const loadAerial = (): Promise<AerialModel | null> => (aerP ??= fetch(modelFile('aerial.json')).then((r) => (r.ok ? r.json() as Promise<AerialModel> : null)).then((m) => (AER = m)).catch(() => null));
const sig = (x: number) => 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
export const aerialLoss = (nearest: number, tov: TurnoverModel | null, ballZ: number) => AER ? sig(AER.control[0] + AER.control[1] * Math.log(Math.max(nearest, 0.3))) : tov ? turnover(tov, nearest, ballZ) : 0;
/** the share of such balls played first time (null without the model): 72% with a man within 1 m, 62% at 1-2 m, 56%
 *  at 2-3 m, 45% at 3-5 m, 21% beyond 5 m */
export const aerialFirst = (nearest: number) => (AER ? sig(AER.first[0] + AER.first[1] * Math.log(Math.max(nearest, 0.3))) : null);

/** whether `shooter` (package index) can shoot at clip time t (noShot): facing given (his own body), else the way he
 *  moves on the 10 Hz frames */
export function noShotAt(pkg: Pkg, t: number, shooter: number, facing: XgPoint | null = null): NoShot {
  const fr = pkg.frames, k = Math.max(0, Math.min(fr.length - 1, Math.round(t * pkg.meta.fps))), nAtt = fr[0].att.length, mine = shooter < nAtt, s = mine ? 1 : -1;
  const pos = (j: number, i: number): XgPoint => { const f = fr[Math.max(0, Math.min(fr.length - 1, j))], q = i < nAtt ? f.att[i] : f.def[i - nAtt]; return [s * q[0], s * q[1]]; };
  const keepers = new Set(pkg.keepers ?? []), opp: { p: XgPoint; who: number }[] = [];
  for (let i = 0; i < fr[0].att.length + fr[0].def.length; i++) if ((mine ? i >= nAtt : i < nAtt) && !keepers.has(i)) opp.push({ p: pos(k, i), who: i });
  const f = facing ? ([s * facing[0], s * facing[1]] as XgPoint) : movingFacing((j) => pos(j, shooter), k);
  return noShot(pos(k, shooter), f, opp);
}

/** his xG if `shooter` (package index) shot at clip time t, a header or not */
export function xgAt(model: XgFreezeModel, pkg: Pkg, t: number, shooter: number, header = false): number {
  const f = pkg.frames[Math.max(0, Math.min(pkg.frames.length - 1, Math.round(t * pkg.meta.fps)))];
  const pos = [...f.att, ...f.def], nAtt = f.att.length, mine = shooter < nAtt, s = mine ? 1 : -1;
  const keepers = pkg.keepers ?? [], theirs = (i: number) => (mine ? i >= nAtt : i < nAtt), turn = (q: [number, number]): XgPoint => [s * q[0], s * q[1]];
  const gk = keepers.find(theirs) ?? -1, opp: XgPoint[] = [];
  pos.forEach((q, i) => { if (theirs(i) && i !== gk) opp.push(turn(q)); });
  return xgFreeze(model, turn(pos[shooter]), header, opp, gk >= 0 ? turn(pos[gk]) : null);
}

/** "no shot from here" (Yi, 2026-10-25: "if you check #32 for the 26:40 decision, when he receives the ball, there
 *  is literally no way for him to do a shot at all, we should not give it a xG"): his back to goal (facing, or for a
 *  dragged ghost moving, more than 100 degrees away from the goal's centre) with an opponent within 2 m; no angle (under
 *  7 degrees of goal mouth); or too far (over 35 m). At 26:40 #32 takes it running away from goal (114 degrees, 5.7 m/s)
 *  with Orange #4 1.0 m off: no shot; #37 runs at goal (22 degrees) with a man 0.9 m in front: a shot, likely blocked
 *  (xG 0.06). Shooting towards +x. */
// (offside: his real pass's man was offside, snap.ts offsideReception; the move ends there, the What-if's 48:14)
export type NoShot = { why: 'back'; by: number } | { why: 'angle' } | { why: 'far' } | { why: 'offside'; beyond: number } | null;
export const BACK_DEG = 100, BACK_NEAR_M = 2, MIN_ANGLE = 0.12, MAX_DIST = 35;
export function noShot(at: XgPoint, facing: XgPoint | null, opp: { p: XgPoint; who: number }[]): NoShot {
  const dx = 52.5 - at[0], dy = -at[1], dist = Math.hypot(dx, dy);
  if (dist > MAX_DIST) return { why: 'far' };
  const ang = Math.abs(Math.atan2(dy + 3.66, dx) - Math.atan2(dy - 3.66, dx));
  if (ang < MIN_ANGLE) return { why: 'angle' };
  if (facing) {
    const fl = Math.hypot(facing[0], facing[1]), cos = fl > 1e-6 ? (facing[0] * dx + facing[1] * dy) / (fl * dist) : 1;
    if ((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI > BACK_DEG) {
      let near: { who: number; d: number } | null = null;
      for (const o of opp) { const d = Math.hypot(o.p[0] - at[0], o.p[1] - at[1]); if (d < BACK_NEAR_M && (!near || d < near.d)) near = { who: o.who, d }; }
      if (near) return { why: 'back', by: near.who };
    }
  }
  return null;
}
/** the reason in words, for the cards */
export const noShotWhy = (no: NonNullable<NoShot>, name: (p: number) => string) =>
  no.why === 'back' ? `his back to goal, ${name(no.by)} on him` : no.why === 'angle' ? 'no angle on goal' : no.why === 'offside' ? `offside, ${offsideWhy(no.beyond)}` : 'too far out';
/** where an offside man stood as the ball was played, from the tracking (to a tenth of a metre; level within 5 cm) */
export const offsideWhy = (beyond: number) => (beyond < 0.05 ? 'level with the second-last defender as the ball was played' : `${beyond.toFixed(1)} m beyond the second-last defender as the ball was played`);

/** the way he faces for that: his body when it is his own (real joints), else the way he moves over the last 0.3 s
 *  (a dragged ghost), else none */
export function movingFacing(pos: (k: number) => XgPoint, k: number): XgPoint | null {
  const a = pos(Math.max(0, k - 3)), b = pos(k), v: XgPoint = [b[0] - a[0], b[1] - a[1]];
  return Math.hypot(v[0], v[1]) > 0.3 ? v : null;
}

/** the shot he can take as he receives (Yi, 2026-10-25: "he shall use a header, or adjust to do a lofted shot, or do
 *  a drive, it depends on the one that has the highest xG"; "we stop at the point when the player first touches the
 *  ball, but not the position when it is ready to shoot"): two ways, each on the shot-type model (xg_shot.json):
 *  - first time, as the ball comes: a header above 1.6 m, a volley between 0.5 and 1.6, a drive below (StatsBomb's
 *    labels, so a header is worth about a third of a drive from the same spot, a volley two thirds);
 *  - a touch first, then a drive: he needs 0.5 s, plus 0.6 s for every 90 degrees he must turn beyond 35 off goal
 *    (this match's nine controlled shots after a pass: 0.9-1.2 s, turning from 70-106 degrees to about 35), plus 0.3 s
 *    to bring a ball above knee height down, 0.5 s to chest one down (none above 1.9 m); the defenders and the keeper
 *    move meanwhile (the paths at that step), and he may lose it first: the turnover model's chance from the nearest
 *    opponent, for the share of 1.5 s the touch takes.
 *  The better one by value is what he does; the other is told beside it. Neither where he cannot shoot (noShot). */
export type ShotKind = 'header' | 'volley' | 'drive';
export interface ShotWay { how: 'first' | 'touch'; kind: ShotKind; xg: number; value: number; adjust: number; pLose: number; at: XgPoint }
export interface ShotEval { first: ShotWay | null; touch: ShotWay | null; best: ShotWay | null; no: NoShot }
// (HEAD_Z 1.3 since 2026-10-27 night, 1.6 before: a ball at chest height is headed stooping, or chested down, not
// volleyed with the leg at 1.3 m; Yi: "sounds good")
export const TURN_FREE_DEG = 35, TOUCH_S = 0.5, TURN_S_PER_90 = 0.6, LIFT_S = 0.3, CHEST_S = 0.5, HEAD_Z = 1.3, KNEE_Z = 0.5, CHEST_MAX_Z = 1.9;
/** a ball between the hip and the chest (VOLLEY_MAX_Z to HEAD_Z) is not struck first time at all: it is chested down,
 *  or he meets it elsewhere on its flight (onball.ts: at his head earlier, at his feet a step or two later; Yi,
 *  2026-10-27: "this point player won't get the ball, he either keep running a few more steps for the ball to fall
 *  lower, or run toward ball earlier, to make it a header") */
export const VOLLEY_MAX_Z = 1.1;
// (A stricter touch under pressure was built as a switch on 2026-10-27, an opponent within 1.2 m before the strike ruling
// the touch out, and dropped the same day at Yi's word: the turnover model is the fitted one, and StatsBomb's shots say
// 55-62% of box shots with an opponent within 2 m came after a touch; the xG model already carries the block and the
// pressure at the strike. Record in docs/plans/what-if.md, "Second realism round".)
/** positions in the shooting frame (+x at goal) at 10 Hz steps: `at(i, j)` player i at step j; which are opponents and
 *  the keeper; the shooter `who`; the touch at step k with the ball `ballZ` high; his facing then (null: unknown) */
export interface ShotScene { at: (i: number, j: number) => XgPoint; opp: number[]; gk: number | null; who: number; k: number; ballZ: number; facing: XgPoint | null }
export function evalShot(model: XgFreezeModel, tov: TurnoverModel | null, S: ShotScene): ShotEval {
  const { at, who, k } = S, me = at(who, k);
  const opp = S.opp.map((i) => at(i, k)), near = S.opp.map((i) => ({ p: at(i, k), who: i })), keeper = S.gk !== null ? at(S.gk, k) : null;
  const no = noShot(me, S.facing, near);
  if (no) return { first: null, touch: null, best: null, no };
  const kind: ShotKind = S.ballZ >= HEAD_Z ? 'header' : S.ballZ >= KNEE_Z ? 'volley' : 'drive', awkward = S.ballZ >= VOLLEY_MAX_Z && S.ballZ < HEAD_Z;
  let x1 = awkward ? 0 : xgFreeze(model, me, kind === 'header', opp, keeper, false, { volley: kind === 'volley', firstTime: true });
  // close in (within 6 m) the keeper is the whole question, and the model sees him as a 1 m body: a man 4 m out with
  // the keeper a step aside got 0.49 (2026-10-25). There the keeper is taken as set on the line from the goal's centre
  // to the shooter, 1 m off his line, whichever gives the lower value
  if (!awkward && Math.hypot(52.5 - me[0], me[1]) < 6) {
    const dxg = 52.5 - me[0], dyg = -me[1], dl = Math.max(1e-6, Math.hypot(dxg, dyg)), set: XgPoint = [52.5 - (dxg / dl) * 1.0, -(dyg / dl) * 1.0];
    x1 = Math.min(x1, xgFreeze(model, me, kind === 'header', opp, set, false, { volley: kind === 'volley', firstTime: true }));
  }
  const first: ShotWay | null = awkward ? null : { how: 'first', kind, xg: x1, value: x1, adjust: 0, pLose: 0, at: me };
  let nearest = Infinity;
  for (const o of opp) nearest = Math.min(nearest, Math.hypot(o[0] - me[0], o[1] - me[1]));
  let touch: ShotWay | null = null;
  if (S.ballZ < CHEST_MAX_Z) {
    const dx = 52.5 - me[0], dy = -me[1], dl = Math.hypot(dx, dy), f = S.facing, fl = f ? Math.hypot(f[0], f[1]) : 0;
    const turn = f && fl > 1e-6 ? (Math.acos(Math.max(-1, Math.min(1, (f[0] * dx + f[1] * dy) / (fl * dl)))) * 180) / Math.PI : 0;
    const adjust = Math.min(1.5, TOUCH_S + (TURN_S_PER_90 * Math.max(0, turn - TURN_FREE_DEG)) / 90 + (S.ballZ >= HEAD_Z ? CHEST_S : S.ballZ >= KNEE_Z ? LIFT_S : 0));
    const j = k + Math.round(adjust / 0.1), me2 = at(who, j), opp2 = S.opp.map((i) => at(i, j)), keeper2 = S.gk !== null ? at(S.gk, j) : null;
    // the control simulated (Yi, 2026-10-27: "if at that point he needs to stop the ball, and then we will calculate
    // how likely that will be disrupted by a defender, and thus maybe he had to do a direct shot"): while he brings
    // the ball down and sets himself, the opponents close on the engine's paths; the nearest any of them comes to him
    // over that window is what the loss model reads. A ball above the knee pays the aerial model's loss whole (that is
    // where a high ball is lost); a ground ball the turnover model's share of its 1.5 s
    // (the keeper among them: in his box he comes for a high ball; the aerial model counts him, 2026-10-27 night)
    let closest = nearest;
    for (let jj = k; jj <= j; jj++) { const q = at(who, jj); for (const i of S.gk !== null ? [...S.opp, S.gk] : S.opp) { const o = at(i, jj); closest = Math.min(closest, Math.hypot(o[0] - q[0], o[1] - q[1])); } }
    const pLose = S.ballZ >= KNEE_Z ? aerialLoss(closest, tov, S.ballZ) : tov ? turnover(tov, closest, S.ballZ) * Math.min(1, adjust / 1.5) : 0;
    const x2 = xgFreeze(model, me2, false, opp2, keeper2, false, { volley: false, firstTime: false });
    touch = { how: 'touch', kind: 'drive', xg: x2, value: x2 * (1 - pLose), adjust, pLose, at: me2 };
  }
  // his decision (this version: the disruption enters as a probability only, no disrupted branch is played; Yi,
  // 2026-10-27): a control more likely disrupted than not forces the first-time strike; otherwise the way worth more
  // (Yi, 2026-10-25), the control's worth already discounted by the disruption
  const best = first && touch && touch.pLose >= 0.5 ? first : touch && (!first || touch.value > first.value) ? touch : first;
  return { first, touch, best, no: null };
}

/** the shot from the simulated paths (onball.ts Played: [22][steps] at 10 Hz, the team on the ball first, attacking
 *  +x), the touch at step k, his facing the way he moves */
export function shotOnPaths(model: XgFreezeModel, tov: TurnoverModel | null, paths: [number, number][][], k: number, who: number, gk: boolean[], ballZ: number): ShotEval {
  const at = (i: number, j: number) => paths[i][Math.min(paths[i].length - 1, Math.max(0, j))] as XgPoint;
  const opp: number[] = []; let g: number | null = null;
  for (let i = 11; i < 22; i++) { if (gk[i]) g = i; else opp.push(i); }
  return evalShot(model, tov, { at, opp, gk: g, who, k, ballZ, facing: movingFacing((j) => at(who, j), k) });
}
/** the shot from a package's frames at clip time t (real play, or a branch's clip), `shooter` a package index; his
 *  facing given (his own body) or the way he moves */
export function shotInClip(model: XgFreezeModel, tov: TurnoverModel | null, pkg: Pkg, t: number, shooter: number, facing: XgPoint | null = null): ShotEval {
  const fr = pkg.frames, fps = pkg.meta.fps, k = Math.max(0, Math.min(fr.length - 1, Math.round(t * fps))), nAtt = fr[0].att.length, mine = shooter < nAtt, s = mine ? 1 : -1;
  const at = (i: number, j: number): XgPoint => { const f = fr[Math.max(0, Math.min(fr.length - 1, j))], q = i < nAtt ? f.att[i] : f.def[i - nAtt]; return [s * q[0], s * q[1]]; };
  const keepers = new Set(pkg.keepers ?? []), opp: number[] = []; let g: number | null = null;
  for (let i = 0; i < fr[0].att.length + fr[0].def.length; i++) { if (!(mine ? i >= nAtt : i < nAtt)) continue; if (keepers.has(i)) g = i; else opp.push(i); }
  const b = pkg.ball25 ? pkg.ball25.xyz[Math.min(pkg.ball25.xyz.length - 1, Math.max(0, Math.round(t * pkg.ball25.fps)))] : fr[k].ball;
  const f = facing ? ([s * facing[0], s * facing[1]] as XgPoint) : movingFacing((j) => at(shooter, j), k);
  return evalShot(model, tov, { at, opp, gk: g, who: shooter, k, ballZ: b?.[2] ?? 0.11, facing: f });
}
/** the shot kind and way in words */
export const shotHow = (w: ShotWay) => (w.how === 'touch' ? `a touch, then a drive (${w.adjust.toFixed(1)}\u00a0s)` : w.kind === 'header' ? 'a header as it comes' : w.kind === 'volley' ? 'a first-time volley' : 'a first-time drive');

/** the shot that really came next after t0, if one did: who, when, whether it was a header, our model's xG for it and
 *  the feed's (Opta) */
const SHOTS = new Set(['Goal', 'SavedShot', 'MissedShots', 'ShotOnPost', 'BlockedShot', 'AttemptSaved', 'Miss', 'Post']);
/** a penalty's chance, the usual figure (StatsBomb's 0.78; Opta gave this match's 0.79) */
const PENALTY_XG = 0.78;
export function realShot(model: XgFreezeModel, pkg: Pkg, t0: number) {
  const e = [...(pkg.events ?? [])].sort((a, b) => a.t - b.t).find((x) => x.t > t0 && SHOTS.has(x.type) && x.player != null);
  if (!e || e.player == null) return null;
  const header = (e.tags ?? []).some((g) => /head/i.test(g)), penalty = (e.tags ?? []).some((g) => /penalty/i.test(g));
  // (the feed says header or not; first time or a volley it does not, so the base technique; a penalty is its own
  // number, PENALTY_XG: the model has no such feature and gave this match's 0.27 against Opta's 0.79, 2026-10-26)
  return { t: e.t, who: e.player, header, xg: penalty ? PENALTY_XG : xgAt(model, pkg, e.t, e.player, header), opta: (e as { xg?: number }).xg ?? null, goal: e.type === 'Goal' };
}

/** the outcomes as the shot what-if lists them: receiving it is what counts, so "receives, keeps it" and "receives,
 *  tackled" (the turnover model's 1.5 s after the touch, which a shot does not wait for) are one row */
export function receives(outs: Outcome[]): Outcome[] {
  const out: Outcome[] = [];
  for (const o of outs) {
    if (o.kind !== 'kept' && o.kind !== 'tackled') { out.push(o); continue; }
    const r = out.find((x) => x.kind === 'kept' && x.who === o.who);
    if (r) r.p += o.p; else out.push({ who: o.who, p: o.p, t: o.t, kind: 'kept' });
  }
  return out.sort((a, b) => b.p - a.p);
}
