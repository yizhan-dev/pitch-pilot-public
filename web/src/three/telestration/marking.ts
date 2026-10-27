// Marking links (Yi, 2026-10-22: a must, top priority; who is tracking whom). Two rules, to be chosen by eye:
//  * engine: the response engine's own (src/response/engine.ts `coupling`, private/response/coupling.py): a defender and
//    an attacker who are each other's nearest opponent, within 12 m. In the fitted follow gains such a pair copies 0.23
//    to 0.30 of the other's departure at 2 s and any other pair about 0.1, so these are the defenders that move when a
//    dragged attacker moves.
//  * tracking: observed over the last 3 s. For each outfield defender, among his three nearest attackers within 10 m,
//    the one whose own movement he copied most: the regression slope of his displacements on the attacker's, each taken
//    relative to its team's mean shift (a block sliding together is not marking), when the slope is 0.5 or more. When
//    the attacker hardly moved on his own (under 1.5 m in the window), a defender within 3 m of him counts as marking.
import type { XY } from './anchors';

/** a link: defender d marks attacker a (package indices), `dist` metres apart now; w 0..1 its strength (tracking's
 *  slope, 1 for the engine's pairs); loose: no rule pairs them, they are only each other's nearest (a focus fallback) */
export interface MarkPair { d: number; a: number; dist: number; w: number; loose?: boolean }
export type MarkRule = 'engine' | 'tracking';
/** a player's position at clip time t (smoothed), into out; false when unknown */
export type PosAt = (p: number, t: number, out: XY) => boolean;

const q: XY = [0, 0];
function at(pos: PosAt, p: number, t: number): XY | null { return pos(p, t, q) ? [q[0], q[1]] : null; }
const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** the engine's pairs: mutual nearest opponents within maxM metres (keepers already left out of defs and atts) */
export function markEngine(pos: PosAt, t: number, defs: number[], atts: number[], maxM = 12): MarkPair[] {
  const D = new Map<number, XY>(), A = new Map<number, XY>();
  for (const p of defs) { const x = at(pos, p, t); if (x) D.set(p, x); }
  for (const p of atts) { const x = at(pos, p, t); if (x) A.set(p, x); }
  const nearest = (from: XY, pool: Map<number, XY>) => {
    let best = -1, bd = Infinity;
    for (const [p, x] of pool) { const d = dist(from, x); if (d < bd) { bd = d; best = p; } }
    return { p: best, d: bd };
  };
  const out: MarkPair[] = [];
  for (const [d, xd] of D) {
    const na = nearest(xd, A);
    if (na.p < 0 || na.d > maxM) continue;
    if (nearest(A.get(na.p)!, D).p === d) out.push({ d, a: na.p, dist: na.d, w: 1 });
  }
  return out;
}

/** the observed pairs: who copied whose own movement over the last windowS seconds, sampled every stepS */
export function markTracking(pos: PosAt, t: number, defs: number[], atts: number[], windowS = 3, stepS = 0.5): MarkPair[] {
  const n = Math.max(2, Math.round(windowS / stepS)), times = Array.from({ length: n + 1 }, (_, k) => t - windowS + k * stepS);
  // each player's samples (a missing sample repeats the last known one); players unknown now are left out
  const track = (p: number): XY[] | null => {
    const now = at(pos, p, t);
    if (!now) return null;
    let last = now;
    const s = times.map((tk) => { const x = at(pos, p, tk); if (x) last = x; return last; });
    s[n] = now;
    return s;
  };
  const S = new Map<number, XY[]>();
  for (const p of [...defs, ...atts]) { const s = track(p); if (s) S.set(p, s); }
  const D = defs.filter((p) => S.has(p)), A = atts.filter((p) => S.has(p));
  if (!D.length || !A.length) return [];
  // each team's mean shift per step
  const shift = (g: number[]) => Array.from({ length: n }, (_, k) => {
    let x = 0, y = 0;
    for (const p of g) { const s = S.get(p)!; x += s[k + 1][0] - s[k][0]; y += s[k + 1][1] - s[k][1]; }
    return [x / g.length, y / g.length] as XY;
  });
  const cD = shift(D), cA = shift(A), out: MarkPair[] = [];
  for (const d of D) {
    const sd = S.get(d)!, now = sd[n];
    const cands = A.map((a) => ({ a, dd: dist(now, S.get(a)![n]) })).filter((c) => c.dd <= 10).sort((x, y) => x.dd - y.dd).slice(0, 3);
    let best: MarkPair | null = null;
    for (const { a, dd } of cands) {
      const sa = S.get(a)!;
      let num = 0, den = 0, own = 0, md = 0;
      for (let k = 0; k < n; k++) {
        const ax = sa[k + 1][0] - sa[k][0] - cA[k][0], ay = sa[k + 1][1] - sa[k][1] - cA[k][1];
        const dx = sd[k + 1][0] - sd[k][0] - cD[k][0], dy = sd[k + 1][1] - sd[k][1] - cD[k][1];
        num += dx * ax + dy * ay; den += ax * ax + ay * ay; own += Math.hypot(ax, ay); md += dist(sd[k], sa[k]);
      }
      if (md / n > 10) continue;
      const f = own < 1.5 ? (dd <= 3 ? 0.6 : 0) : num / den;
      if (f >= 0.5 && (!best || f > best.w)) best = { d, a, dist: dd, w: Math.min(1, f) };
    }
    if (best) out.push(best);
  }
  return out;
}
