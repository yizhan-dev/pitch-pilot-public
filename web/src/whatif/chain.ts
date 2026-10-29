// The what-if as a chain of passes, two steps or more with an xA and an xG at each (at 22:51 the viewer can pass to
// the man on the right rather than shoot, and he can cross to the centre, an xG of its own). Each step is a pass to
// one man, played into his stride, along the ground or lofted whichever is worth more, stopping on his touch; there he can shoot (his xG then) or pass on, the viewer picking the
// next man or letting him choose (the best of shooting and every useful pass, by expected xG). A pass's xA here is his
// chance of receiving it times his xG as he takes it (the assist it would be if he shot); the whole move's value is
// the chances of every pass times the last man's xG. Everything after the moment is a simulation.
import { leadPoint, passTo, outcomes as passOutcomes, play, velOf, HEAD_Z, FOOT_Z, FIRST_HOLD, type Meet, type Models, type Scene0, type Pass, type Outcome } from './onball';
import { hooked } from '../dev';
import { noShot, receives, shotOnPaths, crowdFactor, firstTimeRatio, type NoShot, type ShotEval } from './shot';
import { xgFreeze, type XgFreezeModel, type XgPoint } from '../response/xg';
import { DT, PAST, type XY } from '../response/engine';

/** a pass played to `to` (model index), the better of the two kinds: the pass, what can become of it, his chance of
 *  receiving it, his xG as he takes it, and the other kind's numbers */
/** `claim`: the keeper's share of the first touch against him (onball.ts outcomes, a ball into the goal area), 0 to 1 */
/** `first`: struck first time (FIRST_HOLD); `factor`: what the crowd along a ground ball's line and a first-time ball's
 *  execution took off his chance (shot.ts crowdFactor, firstTimeRatio), 1 for a lofted ball, for Opta's ruler to take
 *  off too; `meetAt`: where he meets the ball (model frame), the lane's end on the pitch; `crowd`: the line's crowd */
export interface Tried { loft: boolean; meet: Meet; first: boolean; Q: XY; meetAt: XY; crowd: Crowd | null; factor: number; pass: Pass; outs: Outcome[]; p: number; claim: number; xg: number; no: NoShot; shot: ShotEval | null; value: number; other: { loft: boolean; p: number; xg: number } | null; lane: number | null;
  /** every way tried, and the man covering the ground lane if any, for checks (window.__wiOptions) */
  alts: { loft: boolean; meet: Meet; first: boolean; hold: number; factor: number; p: number; xg: number; value: number; claim: number; how: string | null }[]; laneInfo: LaneCover | null }
/** the riskier pass must pay this much more than a clearly safer one to be the one played */
const RISK_PREMIUM = 1.5;

/** the ground lane covered (26:40 from #15 at the far post to #32 at the spot has no ground pass on, a lofted one makes
 *  more sense): an opponent who can reach the ball's
 *  line before the ball passes him (his distance to the nearest point of the lane at 6 m/s after 0.3 s to react,
 *  against the ball's time there), within LANE_OFF of it; the first-touch model, fit on passes that were played, never saw a
 *  ground ball through a man and lets too many through. Returns who (model index) or null. */
const LANE_OFF = 2.0, LANE_MARGIN = 0.1;
export interface LaneCover { who: number; margin: number; off: number }
export function laneCovered(c: Scene0, pass: Pass): LaneCover | null {
  const b0 = pass.ball[4 + pass.hold], Q = pass.plan ? pass.plan.path[pass.plan.n - 1] : null;
  if (!Q) return null;
  const ax = Q[0] - b0[0], ay = Q[1] - b0[1], d2 = ax * ax + ay * ay, d = Math.sqrt(d2);
  let worst: LaneCover | null = null;
  for (let i = 11; i < 22; i++) {
    if (c.gk[i]) continue;
    const p = c.now[i], t = ((p[0] - b0[0]) * ax + (p[1] - b0[1]) * ay) / d2;
    if (t < 0.08 || t > 0.95) continue;
    const off = Math.hypot(p[0] - (b0[0] + ax * t), p[1] - (b0[1] + ay * t));
    // (within LANE_OFF of the line: at 4 m a man 3.2 m off the line at 17:28 and another at 26:40 turned ground balls
    // worth three times the chip into chips. The resolver's own hazard covers the rest)
    if (off > LANE_OFF) continue;
    // the ball's time to that point along the pass (ballTo's pace), his time to it
    let tb = pass.hold * 0.1;
    for (let k = pass.hold + 1; k <= pass.ball.length - 5; k++) { const q = pass.ball[4 + k]; if (Math.hypot(q[0] - b0[0], q[1] - b0[1]) >= t * d) { tb = k * 0.1; break; } }
    const margin = tb - (0.3 + off / 6);
    if (margin > LANE_MARGIN && (!worst || margin > worst.margin)) worst = { who: i, margin, off };
  }
  return worst;
}
/** the receiver offside as the ball is struck: he was onside at the pause (options.ts candidates), but the
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
/** the crowd along a ground ball's line as it is struck, StatsBomb's frame (private/response/lane_crowd.py): from the
 *  ball at the strike to where it is met (the plan's end, else the spot), each opponent, the keeper too, moved on at
 *  his pace to the strike; of those between 8% and 95% of the line, the nearest's distance off it (5 m when nobody is)
 *  and how many within 1.5 m. `by`: the nearest, and when the ball passes him, for a cut nobody else was given */
export interface Crowd { len: number; inBox: boolean; nearest: number; n15: number }
/** the crowd along the line from `b0` to `end` (attacking +x), the opponents where they stand as it is struck; `by`:
 *  the nearest to the line and how far along it he stands (0 to 1) */
export function crowdAlong(b0: XY, end: XY, opps: { who: number; p: XY }[]): Crowd & { by: { who: number; frac: number } | null } {
  const ax = end[0] - b0[0], ay = end[1] - b0[1], d2 = Math.max(1e-6, ax * ax + ay * ay), len = Math.sqrt(d2);
  let nearest = 5, n15 = 0, by: { who: number; frac: number } | null = null, byOff = Infinity;
  for (const { who, p } of opps) {
    const t = ((p[0] - b0[0]) * ax + (p[1] - b0[1]) * ay) / d2;
    if (t < 0.08 || t > 0.95) continue;
    const off = Math.abs((p[0] - b0[0]) * ay - (p[1] - b0[1]) * ax) / len;
    nearest = Math.min(nearest, off);
    if (off < 1.5) n15++;
    if (off < byOff) { byOff = off; by = { who, frac: t }; }
  }
  return { len, inBox: end[0] >= 52.5 - 16.5 && Math.abs(end[1]) <= 20.16, nearest, n15, by };
}
function crowdOf(c: Scene0, pass: Pass, Q: XY): Crowd & { by: { who: number; t: number } | null } {
  const b0 = pass.ball[PAST + pass.hold], end = pass.plan ? pass.plan.path[pass.plan.n - 1] : Q;
  const opps: { who: number; p: XY }[] = [];
  for (let i = 11; i < 22; i++) { const v = velOf(c.past, i); opps.push({ who: i, p: [c.now[i][0] + v[0] * pass.hold * DT, c.now[i][1] + v[1] * pass.hold * DT] }); }
  const cr = crowdAlong([b0[0], b0[1]], end, opps);
  let by: { who: number; t: number } | null = null;
  if (cr.by) {
    // (when the ball passes him: the first sample of its path that far along)
    let tb = pass.hold * DT;
    for (let k = pass.hold + 1; k <= pass.ball.length - PAST - 1; k++) { const q = pass.ball[PAST + k]; if (Math.hypot(q[0] - b0[0], q[1] - b0[1]) >= cr.by.frac * cr.len) { tb = k * DT; break; } }
    by = { who: cr.by.who, t: tb };
  }
  return { len: cr.len, inBox: cr.inBox, nearest: cr.nearest, n15: cr.n15, by };
}
/** the share `factor` takes off the man a ground ball is for goes to the opponents who cut it, as they stand, or to the
 *  nearest man on the line when none does */
function crowdOut(outs: Outcome[], to: number, factor: number, by: { who: number; t: number } | null): Outcome[] {
  const mine = outs.find((o) => o.kind === 'kept' && o.who === to);
  if (!mine || factor >= 1) return outs;
  const take = mine.p * (1 - factor), cuts = outs.filter((o) => o.kind === 'cut'), sum = cuts.reduce((a, o) => a + o.p, 0);
  const out = outs.map((o) => (o === mine ? { ...o, p: o.p - take } : o.kind === 'cut' && sum > 0 ? { ...o, p: o.p + (take * o.p) / sum } : o));
  if (sum <= 0 && by) out.push({ who: by.who, p: take, t: by.t, kind: 'cut' });
  return out.sort((a, b) => b.p - a.p);
}
export function tryPass(M: Models, c: Scene0, xg: XgFreezeModel | null, to: number): Tried {
  // (window.__wiForceLoft: the lofted pass alone, for looking at it; checks only)
  const force = hooked<boolean>('wiForceLoft');
  // four ways: along the ground, and lofted for him to meet at his chest or thigh, at his head (running towards the
  // ball earlier), or at his feet after a step or two more (the ball fallen lower), so a lofted ball can end in a header
  // or a volley and not always a ground shot; the head and foot
  // ones only when he can meet it there (onball.ts HEAD_Z, FOOT_Z)
  // and a fifth: along the ground first time (FIRST_HOLD), the outside of the boot or a side-foot
  // without a touch (at 17:28 #32's one-touch ball to #13 with the outside of the boot can be the better one;
  // StatsBomb: a third of final-third passes across the body are one-touch and complete as
  // often as held ones, first_time.py)
  const ways: { loft: boolean; meet: Meet; first: boolean }[] = force ? [{ loft: true, meet: 'chest', first: false }, { loft: true, meet: 'chest', first: false }]
    : [{ loft: false, meet: 'chest', first: false }, { loft: false, meet: 'chest', first: true }, { loft: true, meet: 'chest', first: false }, { loft: true, meet: 'head', first: false }, { loft: true, meet: 'foot', first: false }];
  // (a man who cannot meet the lofted ball at his chest meets it nowhere: the head and foot ways are skipped for him,
  // which keeps the options' time near what two ways took)
  let loftPlan: boolean | null = null;
  const tries = ways.map(({ loft, meet, first }) => {
    if (loft && meet !== 'chest' && loftPlan === false) return null;
    const Q = leadPoint(c.now[c.kicker], c.facing, c.now[to], velOf(c.past, to), loft, first ? FIRST_HOLD * DT : null);
    const pass = passTo(c, Q, loft, to, meet, first ? FIRST_HOLD : null);
    if (loft && meet === 'chest') loftPlan = !!pass.plan && pass.plan.who === to;
    const z = pass.plan ? pass.plan.ball[PAST + pass.plan.n][2] : NaN;
    if (meet === 'head' && !(pass.plan && pass.plan.who === to && z >= HEAD_Z[0])) return null;
    if (meet === 'foot' && !(pass.plan && pass.plan.who === to && z <= FOOT_Z)) return null;
    // a ground ball pays the crowd along its line (lane_crowd.json: the resolver, fitted on passes that were played,
    // let a 29 m ball past four men through 65% of the time at 90:10 where StatsBomb has 31%), a
    // first-time one its execution too; the share taken off him goes to the men who cut it
    const crowd = loft ? null : crowdOf(c, pass, Q);
    let factor = crowd ? crowdFactor(crowd.len, crowd.inBox, crowd.nearest, crowd.n15) : 1;
    if (first) factor *= firstTimeRatio(pass.turn);
    const outs = crowdOut(receives(passOutcomes(M, c, pass)), to, factor, crowd?.by ?? null), mine = outs.find((o) => o.kind === 'kept' && o.who === to);
    // xg: the shot's xG (what the cards show as xG); value: the pass's worth, the chance it reaches him times the shot's
    // worth (its xG times the chance he keeps it through a touch first): what decides
    let x = 0, w = 0, no: NoShot = null, shot: ShotEval | null = null;
    if (mine && xg) { const pl = play(M, c, pass, mine), k = Math.max(0, Math.round(mine.t / 0.1) - 1); shot = shotOnPaths(xg, M.tov, pl.paths, k, to, c.gk, pl.ball[k]?.[2] ?? 0.11); x = shot.best?.xg ?? 0; w = shot.best?.value ?? 0; no = shot.no; }
    const p = mine?.p ?? 0, cutGk = outs.find((o) => o.kind === 'cut' && c.gk[o.who])?.p ?? 0, claim = p + cutGk > 0 ? cutGk / (p + cutGk) : 0;
    const meetAt: XY = pass.plan ? pass.plan.path[pass.plan.n - 1] : Q;
    return { loft, meet, first, Q, meetAt, crowd: crowd && { len: crowd.len, inBox: crowd.inBox, nearest: crowd.nearest, n15: crowd.n15 }, factor, pass, outs, p, claim, xg: x, no, shot, value: p * w + 1e-6 * p };
  }).filter((t): t is NonNullable<typeof t> => t !== null);
  // the man covering the ground lane (laneCovered) is found for the report; the pass played is chosen by value below;
  // `other` the best of the rest, the other kind of pass when there is one
  // (the man covering the ground lane is reported for checks; his toll does not come off the ground ball, the crowd
  // along the line covers it: lane_crowd.json charges him and the others with him, from 154,511 passes)
  const ground = tries.find((t) => !t.loft && !t.first), lane = ground ? laneCovered(c, ground.pass) : null;
  const pool = tries;
  // the way played: the one worth most, unless a clearly safer one (the chance of reaching him higher by 0.1) is
  // worth at least 1 / RISK_PREMIUM of it: a man plays the simple ball unless the risky one pays well (as
  // at 17:28: the chip over the keeper against the through ball into the same run)
  let best = pool.reduce((a, b) => (b.value > a.value ? b : a), pool[0]);
  for (const t of pool) if (t.p > best.p + 0.1 && t.value >= best.value / RISK_PREMIUM && (t.p > best.p)) best = t;
  const rest = tries.filter((t) => t !== best), o = rest.find((t) => t.loft !== best.loft) ?? rest.reduce<typeof best | null>((a, b) => (!a || b.value > a.value ? b : a), null);
  const alts = tries.map((t) => ({ loft: t.loft, meet: t.meet, first: t.first, hold: t.pass.hold, factor: +t.factor.toFixed(2), p: +t.p.toFixed(3), xg: +t.xg.toFixed(3), value: +t.value.toFixed(4), claim: +t.claim.toFixed(2), how: t.shot?.best ? `${t.shot.best.how} ${t.shot.best.kind}` : null }));
  return { ...best, other: o ? { loft: o.loft, p: o.p, xg: o.xg } : null, lane: best.loft && lane ? lane.who : null, laneInfo: lane, alts };
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
