import { modelFile } from '../data/paths';
// The pass probability for the 战术 mode's passing mark (Yi, 2026-10-25: "can we actually implement the pass
// probability? ... this will be grey out, if there is no player on ball, or within the range"). For the player on the
// ball, the chance a pass to each team-mate is completed, from a small network distilled from Opta's own per-team-mate
// expected completion (Stats Perform MA36 passOption, every pass of this match; private/hawkeye/pass_distil.py): trained
// on the first half's pass options, tested on the second half's, where it follows Opta's numbers with a correlation of
// 0.86 and tells completed from failed passes with an AUC of 0.82 (Opta's own: 0.88). It reads only the positions, so it
// works at any moment, not only at Opta's pass moments, and costs next to nothing. The features are the ones in
// pass_distil.py, computed the same way here from the packages' 10 Hz frames: keep the two in step. A model estimate.
// (The first version simulated each pass with the What-if's model: 0.25 s a team and weaker, AUC 0.75; retired.)
import type { ClipPkg } from './match';
import { store } from './draft';

type XY = [number, number];
/** a player has the ball within this of it (the space export's carrier rule), metres */
export const REACH_M = 2.5;
/** ... with the ball at most this high, metres */
const BALL_MAX_Z = 1.0;
/** ... and moving with him, not a pass going past him, metres per second */
const REL_SPEED_MAX = 5;
/** velocities: the change over this many 10 Hz frames (0.2 s, as pass_distil.py's five 25 Hz samples) */
const BACK_FRAMES = 2;

export interface PassOption {
  /** the team-mate (package index) and where he is */
  p: number; at: XY;
  /** the chance a pass to him is completed, 0..1 */
  prob: number;
  /** in an offside position (a pass to him would be a foul, whatever the chance) */
  offside: boolean;
}
export interface PassState { carrier: number | null; opts: PassOption[] | null }
/** whether someone has the ball at the paused moment, for the column's Passing button (greyed when nobody has it, Yi);
 *  true while playing, so the button does not flicker with every pass. Kept by PitchOverlay3D in the 战术 mode */
export const ballHeld = store<boolean>(true);
/** the same for the Shot xG mark (Yi, 2026-10-26: "only when the ball is passing the halfway line"): someone has the ball in
 *  the opponents' half; true while playing */
export const shotHeld = store<boolean>(true);
/** the player on the ball at clip time t if he is in the opponents' half (the package's attackers attack +x), else null */
export function shooterAt(pkg: ClipPkg, t: number): number | null {
  const c = carrierAt(pkg, t);
  if (c === null) return null;
  const b = pkg.frames[frameAt(pkg, t)].ball;
  return b && (c < nAttOf(pkg) ? b[0] > 0 : b[0] < 0) ? c : null;
}
/** the pass chances on screen now, for the head tags (chat 1's spec, drawn by the Shell chat's ShowLayer): the carrier and
 *  each team-mate's chance, null when the passing mark is off or nobody has the ball. Kept by TacticsItems, a few times a
 *  second */
export const passChances = store<PassState | null>(null);

const nAttOf = (pkg: ClipPkg) => pkg.frames[0]?.att.length ?? 11;
const playersOf = (pkg: ClipPkg) => nAttOf(pkg) + (pkg.frames[0]?.def.length ?? 11);
const frameAt = (pkg: ClipPkg, t: number) => Math.max(BACK_FRAMES, Math.min(pkg.frames.length - 1, Math.round(t * pkg.meta.fps)));
const posAt = (pkg: ClipPkg, k: number, p: number): XY | null => {
  const f = pkg.frames[Math.max(0, Math.min(pkg.frames.length - 1, k))], nAtt = nAttOf(pkg);
  const q = p < nAtt ? f.att[p] : f.def[p - nAtt];
  return q ? [q[0], q[1]] : null;
};

/** the player on the ball at clip time t, of either team: the nearest within REACH_M, the ball low and moving with him;
 *  null when nobody has it (the ball in flight, loose or not tracked) */
export function carrierAt(pkg: ClipPkg, t: number): number | null {
  const k = frameAt(pkg, t), b = pkg.frames[k].ball, b0 = pkg.frames[k - 1].ball;
  if (!b || !b0 || (b[2] ?? 0) > BALL_MAX_Z) return null;
  let best = -1, nearest = REACH_M;
  for (let p = 0; p < playersOf(pkg); p++) {
    const q = posAt(pkg, k, p);
    if (!q) continue;
    const d = Math.hypot(q[0] - b[0], q[1] - b[1]);
    if (d < nearest) { nearest = d; best = p; }
  }
  if (best < 0) return null;
  const q = posAt(pkg, k, best), q0 = posAt(pkg, k - 1, best);
  if (!q || !q0) return null;
  const rel = Math.hypot((b[0] - b0[0]) - (q[0] - q0[0]), (b[1] - b0[1]) - (q[1] - q0[1])) * pkg.meta.fps;
  return rel <= REL_SPEED_MAX ? best : null;
}

/** which side has the ball by the players at clip time t (1 the clip's attackers, 2 its defenders), null when it does not
 *  show: the player on the ball (carrierAt), else a keeper within REACH_M of it at any height (a keeper holding it in his
 *  hands: Hawk-Eye's possession flag still names the other side in 57 of the 198 frames with a keeper on the ball in the
 *  20 clips, Yi 2026-10-26: "offside line seems to be wrong when the GK is possessing the ball") */
export function holderSideAt(pkg: ClipPkg, t: number): 1 | 2 | null {
  const nAtt = nAttOf(pkg), c = carrierAt(pkg, t);
  if (c !== null) return c < nAtt ? 1 : 2;
  const k = frameAt(pkg, t), b = pkg.frames[k].ball;
  if (!b) return null;
  for (const p of pkg.keepers ?? []) {
    const q = posAt(pkg, k, p);
    if (q && Math.hypot(q[0] - b[0], q[1] - b[1]) < REACH_M) return p < nAtt ? 1 : 2;
  }
  return null;
}

// ---- the on-ball moments' contact (Yi, 2026-10-26: "it should stop at the point when the player's foot just hit the ball,
// now sometimes it pause when the ball is in the air"). The feed's times are good to a few tenths and the packages' to
// the 10 Hz frame; the moment was the event's time less 0.15 s, which left 25 kicks in the clips with the ball
// already gone. The contact comes from the ball's own 25 Hz track instead: a peak of its change of velocity (as the
// Explain mode's touches, explain/actions.ts) with the event's player beside the ball, the one nearest the feed's time;
// for a kick, one the ball then leaves him from. Found for 180 of the 191 player events (the rest, Out and such, keep
// the feed's time); within 0.15 s of the feed's for 80% of them.
/** the feed's kicks: their moment is the touch the ball then leaves the player from */
const KICKS = new Set(['Pass', 'SavedShot', 'MissedShots', 'Goal', 'ShotOnPost', 'Clearance', 'BlockedPass']);
/** a peak of the ball's change of velocity this strong is a touch, m/s a sample (detectTouches' PEAK) */
const TOUCH_PEAK = 1.5;
/** the contact is looked for this far either side of the feed's time, s; the player within this of the ball, metres
 *  (his position, not his boots: a header or a stretch), the ball at most this high */
const TOUCH_WITHIN_S = 1.0, TOUCH_REACH_M = 1.6, TOUCH_MAX_Z = 2.7;
/** a kick's ball is this far from the player this long after, metres and s */
const LEAVE_M = 2.5, LEAVE_S = 0.4;

/** the clip time of a feed event's contact: the 25 Hz sample before the event's player touches the ball (his foot on
 *  it, the ball not yet gone), or null when none shows (no 25 Hz ball, or no touch by him near the feed's time) */
export function contactAt(pkg: ClipPkg, e: { t: number; type: string; player: number }): number | null {
  const B = pkg.ball25;
  if (!B) return null;
  const X = B.xyz, fps = B.fps, F = pkg.meta.fps, nAtt = nAttOf(pkg);
  const at = (t: number): XY | null => {   // the player between the 10 Hz frames
    const f = t * F, k = Math.max(0, Math.min(pkg.frames.length - 2, Math.floor(f))), a = f - k;
    const q = (kk: number) => (e.player < nAtt ? pkg.frames[kk].att[e.player] : pkg.frames[kk].def[e.player - nAtt]);
    const q0 = q(k), q1 = q(k + 1);
    return q0 && q1 ? [q0[0] + (q1[0] - q0[0]) * a, q0[1] + (q1[1] - q0[1]) * a] : q0 ? [q0[0], q0[1]] : null;
  };
  const dv = (k: number) => {
    const a = X[k - 1], b = X[k], c = X[k + 1];
    return a && b && c ? Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]) * fps : 0;
  };
  let best: number | null = null, bestD = Infinity, any: number | null = null, anyD = Infinity;
  const k0 = Math.max(2, Math.round((e.t - TOUCH_WITHIN_S) * fps)), k1 = Math.min(X.length - 3, Math.round((e.t + TOUCH_WITHIN_S) * fps));
  for (let k = k0; k <= k1; k++) {
    const v = dv(k), b = X[k];
    if (!b || v < TOUCH_PEAK || v < dv(k - 1) || v < dv(k + 1) || b[2] > TOUCH_MAX_Z) continue;
    const q = at(k / fps);
    if (!q || Math.hypot(q[0] - b[0], q[1] - b[1]) > TOUCH_REACH_M) continue;
    const d = Math.abs(k / fps - e.t);
    if (d < anyD) { anyD = d; any = k; }
    if (!KICKS.has(e.type)) continue;
    const k2 = Math.min(X.length - 1, k + Math.round(LEAVE_S * fps)), b2 = X[k2], q2 = at(k2 / fps);
    if (b2 && q2 && Math.hypot(q2[0] - b2[0], q2[1] - b2[1]) > LEAVE_M && d < bestD) { bestD = d; best = k; }
  }
  // a kick the ball does not clearly leave from (blocked, saved at once, into the net): its nearest touch
  const k = best ?? any;
  return k === null ? null : Math.max(0, (k - 1) / fps);
}

// ---- the distilled model (pass_distil.json in the shared model folder)
export interface PassModel { features: string[]; mean: number[]; std: number[]; layers: { W: number[][]; b: number[] }[]; constants: { ball_speed: number; react: number; run: number } }
let model: PassModel | null = null, loading = false;

/** pass_distil.py's features of one option, in the frame of the passing team attacking +x: ball b, the team-mate at r
 *  moving at vr, the opponents moving at their velocities; keeper: the team-mate is the keeper */
function features(M: PassModel, b: XY, r: XY, vr: XY, opp: XY[], oppv: XY[], keeper: boolean): number[] {
  const { ball_speed: BALL, react: REACT, run: RUN } = M.constants;
  const u: XY = [r[0] - b[0], r[1] - b[1]], d = Math.hypot(u[0], u[1]), dd = Math.max(d * d, 1e-6);
  const dR = opp.map((o) => Math.hypot(o[0] - r[0], o[1] - r[1])).sort((x, y) => x - y);
  const dB = Math.min(...opp.map((o) => Math.hypot(o[0] - b[0], o[1] - b[1])));
  let laneMin = 30, lane2 = 0, lane5 = 0;
  for (const o of opp) {
    const w: XY = [o[0] - b[0], o[1] - b[1]], t = (w[0] * u[0] + w[1] * u[1]) / dd;
    if (t <= 0.05 || t >= 0.95) continue;
    const perp = Math.hypot(w[0] - t * u[0], w[1] - t * u[1]);
    laneMin = Math.min(laneMin, perp); if (perp < 2) lane2++; if (perp < 5) lane5++;
  }
  let margin = Infinity;
  for (let s = 1; s <= 12; s++) {
    const f = s / 12, q: XY = [b[0] + f * u[0], b[1] + f * u[1]], tb = (f * d) / BALL;
    let to = Infinity;
    opp.forEach((o, j) => { to = Math.min(to, REACT + Math.hypot(o[0] + oppv[j][0] * REACT - q[0], o[1] + oppv[j][1] * REACT - q[1]) / RUN); });
    margin = Math.min(margin, to - tb);
  }
  const xs = opp.map((o) => o[0]).sort((x, y) => y - x), line = Math.max(xs[1] ?? 0, b[0], 0);
  const along = d > 1e-6 ? (vr[0] * u[0] + vr[1] * u[1]) / d : 0;
  return [d / 30, u[0] / 30, Math.abs(u[1]) / 30, r[0] / 52.5, Math.abs(r[1]) / 34, b[0] / 52.5,
    Math.min(dR[0] ?? 30, 30) / 10, Math.min(dR[1] ?? 30, 30) / 10, Math.min(dB, 30) / 10,
    Math.min(laneMin, 30) / 10, lane2 / 3, lane5 / 5, Math.max(-2, Math.min(3, margin)) / 2, along / 7, vr[0] / 7,
    r[0] > line + 0.05 ? 1 : 0, opp.filter((o) => o[0] > r[0]).length / 11, keeper ? 1 : 0];
}

/** the network: standardised features, tanh hidden layers, a sigmoid out */
function predict(M: PassModel, x: number[]): number {
  let a = x.map((v, i) => (v - M.mean[i]) / M.std[i]);
  M.layers.forEach((L, li) => {
    const z = L.b.map((c, j) => a.reduce((s, v, i) => s + v * L.W[i][j], c));
    a = li < M.layers.length - 1 ? z.map(Math.tanh) : z.map((v) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, v)))));
  });
  return a[0];
}

/** the passes from the carrier at clip time t to each team-mate, with their chances */
export function passOptions(M: PassModel, pkg: ClipPkg, t: number, carrier: number): PassOption[] {
  const k = frameAt(pkg, t), nAtt = nAttOf(pkg), P = playersOf(pkg), mine = carrier < nAtt, s = mine ? 1 : -1;
  const at = (kk: number, p: number): XY | null => { const q = posAt(pkg, kk, p); return q ? [s * q[0], s * q[1]] : null; };
  const vel = (p: number): XY => { const a = at(k, p), z = at(k - BACK_FRAMES, p), dt = BACK_FRAMES / pkg.meta.fps; return a && z ? [(a[0] - z[0]) / dt, (a[1] - z[1]) / dt] : [0, 0]; };
  const ball = pkg.frames[k].ball, b: XY | null = ball ? [s * ball[0], s * ball[1]] : null;
  if (!b) return [];
  const team = (p: number) => (p < nAtt) === mine, keepers = new Set(pkg.keepers ?? []);
  const opp: XY[] = [], oppv: XY[] = [];
  for (let p = 0; p < P; p++) { if (team(p)) continue; const q = at(k, p); if (q) { opp.push(q); oppv.push(vel(p)); } }
  const out: PassOption[] = [];
  if (opp.length < 2) return out;
  for (let p = 0; p < P; p++) {
    if (!team(p) || p === carrier) continue;
    const r = at(k, p), real = posAt(pkg, k, p);
    if (!r || !real) continue;
    const x = features(M, b, r, vel(p), opp, oppv, keepers.has(p));
    out.push({ p, at: real, prob: predict(M, x), offside: x[15] === 1 });
  }
  return out;
}

/** the passing options at clip time t (opts null until the model has loaded, or with nobody on the ball); `onReady` is
 *  called once the model arrives, for a redraw */
export function passStateAt(pkg: ClipPkg, t: number, onReady: () => void): PassState {
  const carrier = carrierAt(pkg, t);
  if (carrier === null) return { carrier, opts: null };
  if (!model) {
    if (!loading) {
      loading = true;
      fetch(modelFile('pass_distil.json')).then((r) => (r.ok ? r.json() : null)).then((m: PassModel | null) => { model = m; if (m) onReady(); }).catch(() => undefined);
    }
    return { carrier, opts: null };
  }
  return { carrier, opts: passOptions(model, pkg, t, carrier) };
}
