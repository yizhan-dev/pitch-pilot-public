// Every touch of the ball in a clip, to the 25 Hz sample (Yi, 2026-10-22: the narration has to land on the very moment
// of each action). The event feed is only good to a few tenths (at 15:47 it puts a pass 0.3 s before the kick), so the
// touches come from the ball's own track: a local peak of its change of velocity, given to the player with a foot,
// knee, head or (keepers) hand nearest the ball at that sample. A peak with nobody within reach is a bounce. Then each
// touch gets a part: a kick (the ball leaves faster than it came, or goes to someone else next), a control (first touch
// of a pass), a dribble touch, and the feed's own types (shot, save, clearance) where they match.
import type { Loaded } from '../data';

type V3 = [number, number, number];
export type TouchKind = 'kick' | 'control' | 'dribble' | 'shot' | 'save' | 'clear' | 'touch';
export interface Touch {
  /** clip seconds, the 25 Hz sample of the touch */
  t: number;
  player: number;
  /** metres from the ball to his nearest limb (tracking puts the boots about 0.3 m off) */
  reach: number;
  /** the limb: 'foot', 'knee', 'head' or 'hand' */
  part: 'foot' | 'knee' | 'head' | 'hand';
  /** the ball's height, metres */
  z: number;
  /** the ball's speed just after, km/h */
  kmh: number;
  kind: TouchKind;
  /** for a kick: who touches the ball next (a teammate: a pass; an opponent: lost), when, and how far it went */
  next?: { player: number; t: number; metres: number };
  /** the feed event this touch is, when one matches (its index in pkg.events) */
  event?: number;
}

const LIMBS: [string, Touch['part']][] = [
  ['lAnkle', 'foot'], ['rAnkle', 'foot'], ['lBigToe', 'foot'], ['rBigToe', 'foot'], ['lHeel', 'foot'], ['rHeel', 'foot'],
  ['lKnee', 'knee'], ['rKnee', 'knee'], ['nose', 'head'], ['neck', 'head'], ['lWrist', 'hand'], ['rWrist', 'hand'],
];
/** a peak this strong (m/s of velocity change per sample) is a touch candidate */
const PEAK = 1.5;
/** a player this close (metres, his nearest limb to the ball) made it; keepers' hands reach a little further */
const REACH = 0.9, REACH_GK = 1.2;
const SHOTS = new Set(['SavedShot', 'MissedShots', 'Goal', 'ShotOnPost']);

interface FeedEvent { t: number; type: string; player?: number; receiver?: number }

/** every touch in the clip, in time order; [] without the 25 Hz ball or the joints */
export function detectTouches(data: Loaded): Touch[] {
  const B = data.pkg.ball25, J = data.joints;
  if (!B || !J) return [];
  const X = B.xyz as (V3 | null)[], fps = B.fps, nJ = J.names.length, P = J.players;
  const keepers = new Set(data.pkg.keepers ?? []);
  const limbs = LIMBS.map(([n, part]) => ({ j: J.names.indexOf(n), part })).filter((l) => l.j >= 0);
  const dv: number[] = new Array(X.length).fill(0);
  for (let k = 1; k + 1 < X.length; k++) {
    const a = X[k - 1], b = X[k], c = X[k + 1];
    if (a && b && c) dv[k] = Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]) * fps;
  }
  const touches: Touch[] = [];
  for (let k = 2; k + 2 < X.length; k++) {
    if (dv[k] < PEAK || dv[k] < dv[k - 1] || dv[k] < dv[k + 1]) continue;
    const b = X[k]!, t = k / fps, f = Math.max(0, Math.min(J.frames - 1, Math.round(t * J.fps)));
    let best = -1, reach = Infinity, part: Touch['part'] = 'foot';
    for (let p = 0; p < P; p++) for (const l of limbs) {
      if (l.part === 'hand' && !keepers.has(p)) continue;
      const o = ((f * P + p) * nJ + l.j) * 3, d = Math.hypot(J.data[o] - b[0], J.data[o + 1] - b[1], J.data[o + 2] - b[2]);
      if (d < reach) { reach = d; best = p; part = l.part; }
    }
    if (best < 0 || reach > (keepers.has(best) ? REACH_GK : REACH)) continue;            // a bounce
    const prev = touches[touches.length - 1];
    if (prev && prev.player === best && t - prev.t < 0.13) { if (dv[k] > dv[Math.round(prev.t * fps)]) { prev.t = t; prev.reach = reach; } continue; }
    const q0 = X[k + 1], q1 = X[k + 2], kmh = q0 && q1 ? Math.hypot(q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]) * fps * 3.6 : 0;
    touches.push({ t: +t.toFixed(2), player: best, reach: +reach.toFixed(2), part, z: +b[2].toFixed(2), kmh: Math.round(kmh), kind: 'touch' });
  }
  // the parts: a touch followed by someone else's is a kick (a pass, a shot, a clearance); the first touch after a
  // teammate's kick is a control; repeated touches by one player are dribbling
  const nAtt = J.nAtt, side = (p: number) => (p < nAtt ? 0 : 1);
  for (let i = 0; i < touches.length; i++) {
    const a = touches[i], b = touches[i + 1], prev = touches[i - 1];
    if (b && b.player !== a.player) {
      const pa = X[Math.round(a.t * fps)], pb = X[Math.round(b.t * fps)];
      a.kind = 'kick';
      a.next = { player: b.player, t: b.t, metres: pa && pb ? +Math.hypot(pb[0] - pa[0], pb[1] - pa[1]).toFixed(1) : 0 };
    } else if (b) a.kind = 'dribble';
    if (prev && prev.player !== a.player && a.kind !== 'kick' && side(prev.player) === side(a.player)) a.kind = 'control';
  }
  // the feed's types where an event of the same player lies within 0.6 s
  const events = ((data.pkg as unknown as { events?: FeedEvent[] }).events ?? []);
  events.forEach((e, ei) => {
    if (e.player === undefined) return;
    let bi = -1, bd = 0.6;
    touches.forEach((tc, i) => { const d = Math.abs(tc.t - e.t); if (tc.player === e.player && d < bd) { bd = d; bi = i; } });
    if (bi < 0) return;
    const tc = touches[bi];
    if (tc.event === undefined) tc.event = ei;
    if (SHOTS.has(e.type)) tc.kind = 'shot';
    else if (e.type === 'Save') tc.kind = 'save';
    else if (e.type === 'Clearance') tc.kind = 'clear';
  });
  return touches;
}

/** the touch of `player` nearest clip time `near` (within `within` s), or null: for pinning a line to an action */
export function touchOf(touches: Touch[], player: number, near: number, within = 1): Touch | null {
  let best: Touch | null = null, bd = within;
  for (const t of touches) { const d = Math.abs(t.t - near); if (t.player === player && d <= bd) { bd = d; best = t; } }
  return best;
}
