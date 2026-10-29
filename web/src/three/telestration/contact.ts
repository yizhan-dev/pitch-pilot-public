// The instant a player strikes the ball (a shot freezes exactly when the boot touches the ball). The
// event feed's time is only good to about a tenth of a second: at 38:19 its frame shows the ball still a metre short of
// the shooter. The ball's 25 Hz track finds the touch, as the first strong change of its velocity between two steps
// near the feed's time (a kick, or a header's turn; not a block a few tenths later; the window stops short of a save).
// The strike is where the ball's path before the touch meets its path after it, and the freeze is when the ball as the
// app draws it (linear between samples) passes that point. The players' feet are not used: their tracking sits about
// 0.3 m off the ball's, so at the true strike the kicking boot is drawn a little behind the ball, the planted foot
// beside it.
import type { Loaded } from '../../data';
import { ballAt } from '../Ball';

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** the clip time to freeze a touch the feed puts at `t`: the drawn ball at the strike point; `t` itself when the clip
 *  has no 25 Hz ball or no touch near it */
export function contactTime(data: Loaded, t: number, before = 0.25, after = 0.2): number {
  const B = data.pkg.ball25;
  if (!B) return t;
  const fps = B.fps, X = B.xyz as (V3 | null)[], k0 = Math.max(2, Math.floor((t - before) * fps)), k1 = Math.min(X.length - 3, Math.ceil((t + after) * fps));
  // the touch: the first strong change of velocity, the earliest local peak at least half the window's largest (a
  // blocked shot meets the defender a few tenths later with a larger change than the kick's), at sample k
  const dvs: number[] = [];
  for (let k = k0 - 1; k <= k1 + 1; k++) {
    const a = X[k - 1], b = X[k], c = X[k + 1];
    dvs.push(a && b && c ? Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]) * fps : 0);
  }
  const top = Math.max(...dvs);
  let bk = -1;
  for (let i = 1; i + 1 < dvs.length && top > 3; i++) if (dvs[i] >= 0.5 * top && dvs[i] >= dvs[i - 1] && dvs[i] >= dvs[i + 1]) { bk = k0 - 1 + i; break; }
  if (bk < 0) return t;
  // the paths before (samples bk-2 to bk-1) and after (bk+1 to bk+2; tracking smooths the touch over a sample or two),
  // and the time where they come closest: the strike
  const p0 = X[bk - 2], p1 = X[bk - 1], q0 = X[bk + 1], q1 = X[bk + 2];
  if (!p0 || !p1 || !q0 || !q1) return bk / fps;
  const t1 = (bk - 2) / fps, t2 = (bk + 1) / fps, vPre = mul(sub(p1, p0), fps), vPost = mul(sub(q1, q0), fps);
  const w = sub(vPre, vPost), c0 = sub(sub(p0, q0), sub(mul(vPre, t1), mul(vPost, t2))), ww = dot(w, w);
  const tk = ww > 1e-6 ? Math.min(t2, Math.max(t1, -dot(c0, w) / ww)) : bk / fps;
  const pc = sub(p0, mul(vPre, t1 - tk));
  // when the drawn ball passes the strike point
  let tBest = tk, dBest = Infinity;
  for (let tt = t1; tt <= t2 + 1e-9; tt += 0.002) {
    const b = ballAt(data.pkg, tt);
    if (!b) continue;
    const d = Math.hypot(b[0] - pc[0], b[1] - pc[1], b[2] - pc[2]);
    if (d < dBest) { dBest = d; tBest = tt; }
  }
  return tBest;
}

/** a low camera for a shot's freeze (a lower perspective for the demo): behind the shooter and to the
 *  pitch's middle side of his line to goal, about 9 m off and 2.5 m up, looking a few metres past him towards the goal,
 *  so his head (and the xG widget beside it), the cone and the goal are all in the frame. Returns the free camera's
 *  target (scene metres), yaw and pitch (degrees) and distance, for window.__camSet; null without his position */
export function shotCamera(data: Loaded, t: number, shooter: number): [number, number, number, number, number, number] | null {
  const pkg = data.pkg, f = pkg.frames[Math.max(0, Math.min(pkg.frames.length - 1, Math.round(t * pkg.meta.fps)))];
  const nAtt = f.att.length, S = [...f.att, ...f.def][shooter];
  if (!S) return null;
  const gx = shooter < nAtt ? 52.5 : -52.5, dx = gx - S[0], dy = -S[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  // behind him, turned 32 degrees towards the pitch's long axis (the camera stays on the pitch side of his line)
  const turn = (S[1] >= 0 ? -1 : 1) * Math.sign(ux || 1) * THREE_DEG * 32, c = Math.cos(turn), s = Math.sin(turn);
  const ox = -(ux * c - uy * s), oz = -(ux * s + uy * c);      // scene x, z (z is the data's y)
  const tx = S[0] + ux * 3, tz = S[1] + uy * 3;
  return [tx, 1.1, tz, (Math.atan2(ox, oz) * 180) / Math.PI, 15, 10];
}
const THREE_DEG = Math.PI / 180;
