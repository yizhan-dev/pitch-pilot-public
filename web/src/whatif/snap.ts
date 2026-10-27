// Where a pause stops in tactics mode (Yi, 2026-10-24): not at once, but when the ball next reaches a player, the moment
// the what-if starts from ("we wait until B receives the ball ... and stop it right there"), whatever he really did
// next. A reception is a completed pass's arrival at its receiver, read off the tracking: the first moment after the
// kick that the ball is within REACH of him on the ground and below head height; failing that, his next event.
import type { ClipEvent } from '../hud/match';

const REACH = 1.3, HEAD = 1.8, LOOK = 4;

interface Pkg {
  meta: { fps: number };
  frames: { att: [number, number][]; def: [number, number][]; ball: [number, number, number] | null }[];
  ball25?: { fps: number; xyz: ([number, number, number] | null)[] };
  events?: ClipEvent[];
}

export interface Reception { t: number; player: number; passer: number | null; passT: number }

/** a player's position at clip time t (the 10 Hz frames, linear between them) */
function posAt(pkg: Pkg, p: number, t: number): [number, number] | null {
  const fr = pkg.frames, x = Math.min(fr.length - 1, Math.max(0, t * pkg.meta.fps)), k = Math.floor(x), u = x - k;
  const nAtt = fr[0].att.length, get = (i: number) => (p < nAtt ? fr[i]?.att[p] : fr[i]?.def[p - nAtt]);
  const a = get(k), b = get(Math.min(fr.length - 1, k + 1));
  return a && b ? [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] : a ?? null;
}

/** every completed pass's reception in the clip, in time order */
export function receptions(pkg: Pkg): Reception[] {
  const evs = [...(pkg.events ?? [])].sort((a, b) => a.t - b.t), out: Reception[] = [];
  const ball = pkg.ball25, step = ball ? 1 / ball.fps : 1 / pkg.meta.fps;
  const ballAt = (t: number) => (ball ? ball.xyz[Math.round(t * ball.fps)] : pkg.frames[Math.round(t * pkg.meta.fps)]?.ball) ?? null;
  for (const e of evs) {
    if (e.type !== 'Pass' || e.outcome !== 'Successful' || e.receiver == null) continue;
    let t: number | null = null;
    for (let s = e.t + 0.15; s <= e.t + LOOK; s += step) {
      const b = ballAt(s), q = posAt(pkg, e.receiver, s);
      if (b && q && b[2] < HEAD && Math.hypot(b[0] - q[0], b[1] - q[1]) < REACH) { t = s; break; }
    }
    t ??= evs.find((x) => x.t > e.t && x.player === e.receiver)?.t ?? null;
    if (t !== null) out.push({ t, player: e.receiver, passer: e.player, passT: e.t });
  }
  return out;
}

/** an offside pass's real target (Yi, 2026-10-26: the 48:14 offside as a What-if moment): the event names nobody, so
 *  he is read off the tracking, the first teammate the ball comes within REACH of after it leaves the passer (on the
 *  ground, below head height, within LOOK s); and how far he stood beyond the offside line as it left him (the
 *  second-last defender, or the ball if that is further on; metres along the attack, below 0 onside by the tracking).
 *  The strike is where the ball first gets more than STRIKE_M from the passer: the event's time is a little early */
export interface OffsideReception extends Reception { strike: number; beyond: number }
const STRIKE_M = 0.8;
export function offsideReception(pkg: Pkg, ev: ClipEvent): OffsideReception | null {
  const fr = pkg.frames, nAtt = fr[0].att.length, nDef = fr[0].def.length, passer = ev.player;
  if (passer == null || passer >= nAtt) return null;
  const ball = pkg.ball25, step = ball ? 1 / ball.fps : 1 / pkg.meta.fps;
  const ballAt = (t: number) => (ball ? ball.xyz[Math.min(ball.xyz.length - 1, Math.max(0, Math.round(t * ball.fps)))] : pkg.frames[Math.min(fr.length - 1, Math.max(0, Math.round(t * pkg.meta.fps)))]?.ball) ?? null;
  let strike = ev.t;
  for (let s = ev.t; s <= ev.t + 1; s += step) {
    const b = ballAt(s), q = posAt(pkg, passer, s);
    if (b && q && Math.hypot(b[0] - q[0], b[1] - q[1]) > STRIKE_M) { strike = Math.max(ev.t, s - step); break; }
  }
  let t: number | null = null, who = -1;
  for (let s = strike + 0.15; s <= strike + LOOK && t === null; s += step) {
    const b = ballAt(s);
    if (!b || b[2] >= HEAD) continue;
    for (let i = 0; i < nAtt; i++) {
      const q = i === passer ? null : posAt(pkg, i, s);
      if (q && Math.hypot(b[0] - q[0], b[1] - q[1]) < REACH) { t = s; who = i; break; }
    }
  }
  if (t === null) return null;
  // along the attack: the defending team is the one further on, on the whole
  const at = (i: number) => posAt(pkg, i, strike)?.[0] ?? 0;
  let ma = 0, md = 0;
  for (let i = 0; i < nAtt; i++) ma += at(i) / nAtt;
  for (let j = 0; j < nDef; j++) md += at(nAtt + j) / nDef;
  const s = md >= ma ? 1 : -1, defs = Array.from({ length: nDef }, (_, j) => s * at(nAtt + j)).sort((a, b) => b - a);
  const line = Math.max(defs[1] ?? -Infinity, s * (ballAt(strike)?.[0] ?? 0));
  return { t, player: who, passer, passT: ev.t, strike, beyond: s * at(who) - line };
}

/** the next reception after clip time t (a little after, so a pause right on one moves on), or null */
export function nextReception(pkg: Pkg, t: number): Reception | null {
  return receptions(pkg).find((r) => r.t > t + 0.05) ?? null;
}

/** what really happened after a pause at t0 with `carrier` on the ball, for the what-if's faint comparison: the real
 *  ball for `secs` seconds and his real pass (struck where the ball was at the event, received where the ball met the
 *  receiver, or where the ball was 1.5 s on if it did not arrive) */
export function realAfter(pkg: Pkg, t0: number, carrier: number, secs = 6) {
  const ball = pkg.ball25, fps = ball?.fps ?? pkg.meta.fps;
  const ballAt = (t: number) => (ball ? ball.xyz[Math.min(ball.xyz.length - 1, Math.max(0, Math.round(t * ball.fps)))] : pkg.frames[Math.min(pkg.frames.length - 1, Math.round(t * pkg.meta.fps))]?.ball) ?? null;
  const n = Math.round(secs * fps), xyz = Array.from({ length: n + 1 }, (_, k) => ballAt(t0 + k / fps));
  const ev = [...(pkg.events ?? [])].sort((a, b) => a.t - b.t).find((e) => (e.type === 'Pass' || e.type === 'OffsidePass') && e.player === carrier && e.t >= t0 - 0.1 && e.t <= t0 + secs);
  let pass: { from: [number, number]; to: [number, number]; receiver: number | null; done: boolean; offside: boolean } | null = null;
  if (ev) {
    const offside = ev.type === 'OffsidePass';
    const r = offside ? offsideReception(pkg, ev) : receptions(pkg).find((x) => x.passer === carrier && Math.abs(x.passT - ev.t) < 1e-6), a = ballAt(ev.t), b = ballAt(r ? r.t : ev.t + 1.5);
    if (a && b) pass = { from: [a[0], a[1]], to: [b[0], b[1]], receiver: r ? r.player : null, done: !!r, offside };
  }
  return { t0, xyz, pass };
}
