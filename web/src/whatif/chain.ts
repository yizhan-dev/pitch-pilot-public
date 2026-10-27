// The what-if as a chain of passes (Yi, 2026-10-25: "ideally we can make it even two steps ... the 22:51 moment, what
// would the player do at 22:52, and the user can say, I want to pass to the right side player rather than shooting,
// and then the right side player can choose the cross to the center, and we can calculate the xG"; "for each step, we
// can do a xA and xG calculation"). Each step is a pass to one man, played into his stride, along the ground or lofted
// whichever is worth more, stopping on his touch; there he can shoot (his xG then) or pass on, the viewer picking the
// next man or letting him choose (the best of shooting and every useful pass, by expected xG). A pass's xA here is his
// chance of receiving it times his xG as he takes it (the assist it would be if he shot); the whole move's value is
// the chances of every pass times the last man's xG. Everything after the moment is a simulation.
import { leadPoint, passTo, outcomes as passOutcomes, play, velOf, type Models, type Scene0, type Pass, type Outcome } from './onball';
import { noShot, receives, shotOnPaths, type NoShot, type ShotEval } from './shot';
import { xgFreeze, type XgFreezeModel, type XgPoint } from '../response/xg';
import { DT, PAST, type XY } from '../response/engine';

/** a pass played to `to` (model index), the better of the two kinds: the pass, what can become of it, his chance of
 *  receiving it, his xG as he takes it, and the other kind's numbers */
export interface Tried { loft: boolean; Q: XY; pass: Pass; outs: Outcome[]; p: number; xg: number; no: NoShot; shot: ShotEval | null; value: number; other: { loft: boolean; p: number; xg: number } | null; lane: number | null }

/** the ground lane covered (Yi, 2026-10-26, 26:40 from #15 at the far post to #32 at the spot: "there is likely not a
 *  chance to pass as a ground one, instead a lofted one would make more sense"): an opponent who can reach the ball's
 *  line before the ball passes him (his distance to the nearest point of the lane at 6 m/s after 0.3 s to react,
 *  against the ball's time there), within 4 m of it; the first-touch model, fit on passes that were played, never saw a
 *  ground ball through a man and lets too many through. Returns who (model index) or null. */
export function laneCovered(c: Scene0, pass: Pass): number | null {
  const b0 = pass.ball[4 + pass.hold], Q = pass.plan ? pass.plan.path[pass.plan.n - 1] : null;
  if (!Q) return null;
  const ax = Q[0] - b0[0], ay = Q[1] - b0[1], d2 = ax * ax + ay * ay, d = Math.sqrt(d2);
  let worst: { who: number; margin: number } | null = null;
  for (let i = 11; i < 22; i++) {
    if (c.gk[i]) continue;
    const p = c.now[i], t = ((p[0] - b0[0]) * ax + (p[1] - b0[1]) * ay) / d2;
    if (t < 0.08 || t > 0.95) continue;
    const off = Math.hypot(p[0] - (b0[0] + ax * t), p[1] - (b0[1] + ay * t));
    if (off > 4) continue;
    // the ball's time to that point along the pass (ballTo's pace), his time to it
    let tb = pass.hold * 0.1;
    for (let k = pass.hold + 1; k <= pass.ball.length - 5; k++) { const q = pass.ball[4 + k]; if (Math.hypot(q[0] - b0[0], q[1] - b0[1]) >= t * d) { tb = k * 0.1; break; } }
    const margin = tb - (0.3 + off / 6);
    if (margin > 0 && (!worst || margin > worst.margin)) worst = { who: i, margin };
  }
  return worst?.who ?? null;
}
/** the receiver offside as the ball is struck (2026-10-27): he was onside at the pause (options.ts candidates), but the
 *  passer holds it 0.4-1.3 s, and a man running in behind can be beyond the second-last opponent (or the ball) along the
 *  attack by then, in their half, by 0.3 m; everyone on his way at the pause's pace. The passer would not play it, so
 *  the option is dropped (options.ts optionFor). The real receiver is never judged here (snap.ts, the real feed). */
export function offsideAtStrike(c: Scene0, pass: Pass): boolean {
  const P = pass.plan;
  if (!P || pass.hold < 1) return false;
  const tau = pass.hold * DT, rx = P.path[Math.min(P.path.length - 1, pass.hold - 1)][0], xs: number[] = [];
  for (let i = 11; i < 22; i++) xs.push(c.now[i][0] + velOf(c.past, i)[0] * tau);
  xs.sort((a, b) => b - a);
  const line = Math.max(xs[1] ?? -Infinity, pass.ball[PAST + pass.hold][0]);
  return rx > 0 && rx > line + 0.3;
}
export function tryPass(M: Models, c: Scene0, xg: XgFreezeModel | null, to: number): Tried {
  // (window.__wiForceLoft: the lofted pass alone, for looking at it; checks only)
  const force = (globalThis as { __wiForceLoft?: boolean }).__wiForceLoft;
  const tries = (force ? [true, true] : [false, true]).map((loft) => {
    const Q = leadPoint(c.now[c.kicker], c.facing, c.now[to], velOf(c.past, to), loft);
    const pass = passTo(c, Q, loft, to), outs = receives(passOutcomes(M, c, pass)), mine = outs.find((o) => o.kind === 'kept' && o.who === to);
    // xg: the shot's xG (what the cards show as xG); value: the pass's worth, the chance it reaches him times the shot's
    // worth (its xG times the chance he keeps it through a touch first): what decides
    let x = 0, w = 0, no: NoShot = null, shot: ShotEval | null = null;
    if (mine && xg) { const pl = play(M, c, pass, mine), k = Math.max(0, Math.round(mine.t / 0.1) - 1); shot = shotOnPaths(xg, M.tov, pl.paths, k, to, c.gk, pl.ball[k]?.[2] ?? 0.11); x = shot.best?.xg ?? 0; w = shot.best?.value ?? 0; no = shot.no; }
    const p = mine?.p ?? 0;
    return { loft, Q, pass, outs, p, xg: x, no, shot, value: p * w + 1e-6 * p };
  });
  // the ground lane covered: lofted, whatever the values say (laneCovered); else the better value
  const lane = laneCovered(c, tries[0].pass), best = lane !== null || tries[1].value > tries[0].value ? tries[1] : tries[0], o = best === tries[0] ? tries[1] : tries[0];
  return { ...best, other: { loft: o.loft, p: o.p, xg: o.xg }, lane: best.loft ? lane : null };
}

/** the man on the ball's xG if he shot now, from the scene (model frame); nothing where he cannot shoot (shot.ts) */
export function shootNow(xg: XgFreezeModel, c: Scene0): number {
  const opp: XgPoint[] = [], near: { p: XgPoint; who: number }[] = [];
  let keeper: XgPoint | null = null;
  for (let i = 11; i < 22; i++) { if (c.gk[i]) keeper = c.now[i]; else { opp.push(c.now[i]); near.push({ p: c.now[i], who: i }); } }
  return noShot(c.now[c.kicker], c.facing, near) ? 0 : xgFreeze(xg, c.now[c.kicker], false, opp, keeper);
}

/** what he would do himself (the viewer's "let him choose"): shoot, or the pass worth more than that, of the teammates
 *  worth trying (not the keeper, and only men who could score from near where they stand: xG there 0.01 or more, so a
 *  ball back to the halfway line is not weighed); the best pass with its numbers either way */
export function decide(M: Models, c: Scene0, xg: XgFreezeModel, shootValue: number | null = null): { shoot: number; pass: (Tried & { to: number }) | null; pick: 'shoot' | 'pass' } {
  // (where he cannot shoot from, shooting is worth nothing; a pass to a man who cannot shoot, nothing either; the
  // shot's value as the card showed it at his touch, when known, so the two agree)
  const shoot = shootValue ?? shootNow(xg, c), opp: XgPoint[] = [];
  let keeper: XgPoint | null = null;
  for (let i = 11; i < 22; i++) { if (c.gk[i]) keeper = c.now[i]; else opp.push(c.now[i]); }
  let pass: (Tried & { to: number }) | null = null;
  for (let i = 0; i < 11; i++) {
    if (i === c.kicker || c.gk[i] || xgFreeze(xg, c.now[i], false, opp, keeper) < 0.01) continue;
    const t = tryPass(M, c, xg, i), v = t.no ? 0 : t.value;
    if (v > 0 && (!pass || v > pass.value)) pass = { ...t, value: v, to: i };
  }
  return { shoot, pass, pick: pass && pass.value > shoot ? 'pass' : 'shoot' };
}
