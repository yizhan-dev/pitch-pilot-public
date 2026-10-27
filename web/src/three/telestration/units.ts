// A side's units: back line, midfield, front line (FIFA EFI's "groups of players that act in similar roles"; a unit
// needs at least 2 players to be a line; research doc 3.2). The outfield players (keepers out) are sorted by depth,
// towards their own goal, and split at the two largest gaps with the back line 3 to 5 players, the midfield at least 2,
// the front at least 1. The split is sticky: a new one replaces the last only when its gaps are clearly larger, so a
// player near the boundary does not flicker between two lines during play.
import type { XY } from './anchors';

export interface Units { back: number[]; mid: number[]; front: number[] }
export interface UnitMemo { split: [number, number] | null; order: number[] }

const HYSTERESIS = 2.0;   // metres of total gap a new split must win by

/** players: indices with positions; depth(p): metres towards the side's own goal */
export function splitUnits(players: { p: number; xy: XY }[], depth: (xy: XY) => number, memo: UnitMemo): Units {
  const s = [...players].sort((a, b) => depth(b.xy) - depth(a.xy));
  const n = s.length, d = s.map((q) => depth(q.xy));
  const gap = (i: number) => d[i - 1] - d[i];             // between the (i-1)th and ith deepest
  const score = (i: number, j: number) => gap(i) + gap(j);
  let best: [number, number] | null = null, bs = -Infinity;
  for (let i = 3; i <= Math.min(5, n - 3); i++) for (let j = i + 2; j <= n - 1; j++) { const v = score(i, j); if (v > bs) { bs = v; best = [i, j]; } }
  if (!best) return { back: s.map((q) => q.p), mid: [], front: [] };
  // keep the last split (by membership, not by index) unless the new one wins clearly
  const sameSet = memo.order.length === n && memo.order.every((p) => s.some((q) => q.p === p));
  if (memo.split && sameSet) {
    const [i0, j0] = memo.split, prevBack = new Set(memo.order.slice(0, i0)), prevMid = new Set(memo.order.slice(i0, j0));
    // the previous membership's score at today's depths: re-sort the previous groups and measure their boundary gaps
    const backNow = s.filter((q) => prevBack.has(q.p)), midNow = s.filter((q) => prevMid.has(q.p)), frontNow = s.filter((q) => !prevBack.has(q.p) && !prevMid.has(q.p));
    if (backNow.length && midNow.length && frontNow.length) {
      const gb = Math.min(...backNow.map((q) => depth(q.xy))) - Math.max(...midNow.map((q) => depth(q.xy)));
      const gm = Math.min(...midNow.map((q) => depth(q.xy))) - Math.max(...frontNow.map((q) => depth(q.xy)));
      if (gb + gm >= bs - HYSTERESIS) return { back: backNow.map((q) => q.p), mid: midNow.map((q) => q.p), front: frontNow.map((q) => q.p) };
    }
  }
  memo.split = best; memo.order = s.map((q) => q.p);
  return { back: s.slice(0, best[0]).map((q) => q.p), mid: s.slice(best[0], best[1]).map((q) => q.p), front: s.slice(best[1]).map((q) => q.p) };
}
