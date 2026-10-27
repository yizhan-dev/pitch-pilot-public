// What becomes of a pass and of a reception, for the response check page: who reaches the ball first along its path
// (private/response/resolver.py, fitted on the real passes), the chance the receiver loses it within 1.5 s
// (turnover.py, on the real receptions), and how much of the space round a point a team controls (engine/
// pitch_control.py, Spearman 2018). Same coordinates as engine.ts. No value imports, so node can run it.
import type { XY } from './engine';

export type V3 = [number, number, number];
export interface ResolverParams { lam: number; r: number; s: number; rKeeper: number; alpha: number; platt: [number, number]; zOutfield: number; zKeeper: number; kickerBlockSteps: number }
export interface TurnoverModel { weights: number[] }
const DT = 0.1, FUT = 20;
const sig = (x: number) => 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));

/** First touch along a pass. ball: the 21 positions from the pause to 2 s; paths: each player's predicted 20 positions.
 *  p[i]: the chance player i touches it first within 2 s, after calibrating the opponents' share on real passes;
 *  t[i]: when, on average; none: nobody within 2 s; cut: the chance the first touch is an opponent's (of those within 2 s).
 *  steps: a longer (or shorter) window, with ball and paths that long (the game's what-if looks 4 s ahead). */
export function firstTouch(prm: ResolverParams, ball: V3[], paths: XY[][], gk: boolean[], kicker: number, steps = FUT) {
  const raw = Array(22).fill(0), tsum = Array(22).fill(0);
  let S = 1;
  for (let t = 0; t < steps; t++) {
    const b = ball[t + 1], h = paths.map((p, i) => {
      if (i === kicker && t < prm.kickerBlockSteps) return 0;              // the passer (kickerBlockSteps 20: for the whole pass)
      const d = Math.hypot(p[t][0] - b[0], p[t][1] - b[1]), rr = gk[i] ? prm.rKeeper : prm.r;
      const reach = gk[i] ? sig((prm.zKeeper - b[2]) / 0.15) : sig((prm.zOutfield - b[2]) / 0.15);
      return Math.min(prm.lam * (i < 11 ? prm.alpha : 1) * sig((rr - d) / prm.s) * reach * DT, 0.95);
    });
    const hs = h.reduce((a, x) => a + x, 0), tot = Math.min(hs, 0.99);
    if (hs > 0) h.forEach((x, i) => { const q = S * tot * x / hs; raw[i] += q; tsum[i] += q * (t + 1) * DT; });
    S *= 1 - tot;
  }
  const touched = raw.reduce((a, x) => a + x, 0), opp = raw.slice(11).reduce((a, x) => a + x, 0);
  const share = Math.min(1 - 1e-4, Math.max(1e-4, opp / Math.max(touched, 1e-9)));
  const cut = sig(prm.platt[0] + prm.platt[1] * Math.log(share / (1 - share)));
  const p = raw.map((x, i) => (i < 11 ? x * (1 - cut) / (1 - share) : x * cut / share));
  return { p, t: tsum.map((x, i) => (raw[i] > 0 ? x / raw[i] : NaN)), none: S, cut, rawCut: share, raw };
}

/** the chance a receiver loses the ball within 1.5 s, from the nearest opponent's distance */
export const turnover = (m: TurnoverModel, nearest: number) => sig(m.weights[0] + m.weights[1] * Math.log(Math.max(nearest, 0.3)));

/** Spearman pitch control at points, for a ball at `ball`: the share each team would win (engine/pitch_control.py) */
export function pitchControl(points: XY[], att: XY[], attV: XY[], def: XY[], defV: XY[], ball: XY) {
  const reaction = 0.7, vmax = 5, sigma = 0.45, rate = 4.3, ballSpeed = 15, horizon = 3, dt = 0.04, k = Math.PI / (Math.sqrt(3) * sigma);
  const tti = (pos: XY[], vel: XY[], c: XY) => pos.map((p, i) => reaction + Math.hypot(c[0] - (p[0] + vel[i][0] * reaction), c[1] - (p[1] + vel[i][1] * reaction)) / vmax);
  return points.map((c) => {
    const ta = tti(att, attV, c), td = tti(def, defV, c), tb = Math.hypot(c[0] - ball[0], c[1] - ball[1]) / ballSpeed;
    let pa = 0, pd = 0;
    for (let s = 1; s <= Math.round(horizon / dt); s++) {
      const t = tb + s * dt, free = Math.max(0, Math.min(1, 1 - pa - pd));
      let fa = 0, fd = 0; for (const x of ta) fa += 1 / (1 + Math.exp(-k * (t - x))); for (const x of td) fd += 1 / (1 + Math.exp(-k * (t - x)));
      pa += free * fa * rate * dt; pd += free * fd * rate * dt;
    }
    return pa / Math.max(pa + pd, 1e-9);
  });
}

/** points of a disc of radius r round c, in rings, for an average control */
export function disc(c: XY, r: number): XY[] {
  const out: XY[] = [c];
  for (const rr of [r / 3, 2 * r / 3, r]) { const n = Math.round(6 * rr / (r / 3)); for (let k = 0; k < n; k++) out.push([c[0] + rr * Math.cos(2 * Math.PI * k / n), c[1] + rr * Math.sin(2 * Math.PI * k / n)]); }
  return out;
}
