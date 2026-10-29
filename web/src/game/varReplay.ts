import { store } from '../hud/draft';
import type { Loaded } from '../data';
import type { ViewMode } from './settings';
import { contactTime } from '../three/telestration/contact';

// The VAR check in the Watch mode (on the 48:14 offside clip, from the pass to the clip's end, a pulsing
// VAR button left of Radar). A press runs the clip at double speed to the kick, back from where it was paused or on from
// a little before (a 2x rewind, then the actual offside moment for the audience), stops there,
// where offside is judged, and runs the offside close-up
// animation designed for Explain (the wall on the view the viewer had, then the flight to the line, the marks and the
// verdict: telestration/var.ts), holding at its end. Play, or the button again, takes the camera back to the view the
// viewer had; play also plays on from the kick. The HUD sets this store; three/layers/VarReplay.tsx draws and flies.

/** an orbit pose for the camera director's window.__camSet: centre x, y, z; yaw and pitch in degrees; distance */
export type Pose = [number, number, number, number, number, number];
export interface VarState {
  /** seeking: the clip running at double speed to the kick; on: the check runs or holds; leaving: the camera on its way
   *  back */
  phase: 'off' | 'seeking' | 'on' | 'leaving';
  /** the kick's clip time, and the attacker it judges */
  t: number; focus: number | null;
  /** the view to go back to (a free view's pose is kept by VarReplay, which took it over) */
  back: { view: ViewMode } | null;
  /** leaving by play: play on as the camera goes back */
  resume: boolean;
}
export const VAR_OFF: VarState = { phase: 'off', t: 0, focus: null, back: null, resume: false };
export const varReplay = store<VarState>(VAR_OFF);

/** start the check: play stops, the clip runs to the kick (VarReplay drives it), and the view to go back to is kept */
export function startVar(check: { t: number; focus: number | null }, view: ViewMode, play: (p: boolean) => void) {
  play(false);
  varReplay.set({ phase: 'seeking', t: check.t, focus: check.focus, back: { view }, resume: false });
}
/** how fast the clip runs to the kick, back or on (double speed) */
export const VAR_SEEK_RATE = 2;
/** the check is under way (running to the kick, or on it) */
export const varActive = (s: VarState = varReplay.get()) => s.phase === 'seeking' || s.phase === 'on';
/** end it: the camera goes back to the view it came from; with `play`, play goes on from the kick as it does */
export function endVar(play?: (p: boolean) => void) {
  const s = varReplay.get();
  if (!varActive(s)) return;
  // still on the way to the kick, the camera was never taken over: the check just stops where the clip is
  varReplay.set(s.phase === 'seeking' ? VAR_OFF : { ...s, phase: 'leaving', resume: !!play });
  play?.(true);
}

/** the pass's kick near the feed's time t: the ball's sharpest gain in speed from 0.3 s before to 0.8 s after, then the
 *  exact touch there (telestration/contact.ts). contactTime alone takes the first strong touch, and at 48:14 that was
 *  the passer's last dribble at 7.8 s, 0.45 s before the pass (48:14), with the attacker still onside */
function kickOf(data: Pick<Loaded, 'pkg'>, t: number) {
  const B = data.pkg.ball25;
  if (!B) return t;
  const X = B.xyz as ([number, number, number] | null)[], fps = B.fps;
  const speed = (k: number) => { const a = X[k - 1], b = X[k]; return a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) * fps : NaN; };
  let best = -1, gain = 0;
  for (let k = Math.max(2, Math.floor((t - 0.3) * fps)); k <= Math.min(X.length - 3, Math.ceil((t + 0.8) * fps)); k++) {
    const g = speed(k + 1) - speed(k - 1);
    if (g > gain) { gain = g; best = k; }
  }
  return best < 0 ? contactTime(data as Loaded, t) : contactTime(data as Loaded, best / fps, 0.12, 0.12);
}

/** an offside clip's check (meta.kind 'offside', with its pass): from when the button shows (the pass's feed time), the
 *  kick's time (kickOf) and the attacker caught offside. The feed has no
 *  receiver for an offside pass, so he is found in the tracking: of the attackers past the line (the second-last
 *  defender, or the ball if it is further on) at the kick, the one nearest where the ball is 1.5 s later; within a
 *  metre of the line if nobody is past it (the tracking's tenth of a second can leave him a hair short) */
export function varCheckOf(data: Pick<Loaded, 'pkg'>): { from: number; t: number; focus: number | null } | null {
  const pkg = data.pkg as Loaded['pkg'] & { meta: { kind?: string; pass?: { t: number } | null } };
  if (pkg.meta.kind !== 'offside' || !pkg.meta.pass) return null;
  const from = pkg.meta.pass.t, t = kickOf(data, from), F = pkg.frames, fps = pkg.meta.fps;
  const at = (s: number) => F[Math.max(0, Math.min(F.length - 1, Math.round(s * fps)))];
  const f = at(t), later = at(t + 1.5).ball ?? f.ball;
  const defs = f.def.filter(Boolean).map((d) => d![0]).sort((a, b) => b - a);
  const line = Math.max(defs[1] ?? -Infinity, f.ball?.[0] ?? -Infinity);
  const pick = (slack: number) => {
    let best: number | null = null, bd = Infinity;
    f.att.forEach((a, i) => {
      if (!a || a[0] <= line - slack || a[0] <= 0 || !later) return;
      const d = Math.hypot(a[0] - later[0], a[1] - later[1]);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  return { from, t, focus: pick(0) ?? pick(1) };
}
