// Geometry the orchestrator's rules read from a clip package: players and the ball at any clip time, velocities, a
// side's units and its offside line, who is goal-side of the ball, and the attacking side's space round a point.
// Package frame: metres, the attacking side towards +x (their goal at x 52.5), +y the attack's right; players by
// index, attackers first. Positions come from the 10 Hz frames (the joints are for drawing; the hips agree within a
// few centimetres), the ball from its 25 Hz track.
import type { Loaded } from '../data';
import { ballAt } from '../three/Ball';
import { splitUnits, type Units } from '../three/telestration/units';
import { pitchControl } from '../response/outcomes';

export type XY = [number, number];
export const GOAL_X = 52.5;
/** the pitch's thirds (105 m / 3) */
export const THIRD = 17.5;

export interface Geo {
  data: Loaded;
  nAtt: number;
  P: number;
  keepers: Set<number>;
  /** the defending side's keeper, or -1 */
  defKeeper: number;
  end: number;
  pos(p: number, t: number): XY | null;
  vel(p: number, t: number): XY;
  all(t: number): XY[];
  ball(t: number): [number, number, number] | null;
  side(p: number): 'att' | 'def';
}

export function makeGeo(data: Loaded): Geo {
  const pkg = data.pkg, F = pkg.frames, fps = pkg.meta.fps, nAtt = F[0].att.length, P = nAtt + F[0].def.length;
  const keepers = new Set(pkg.keepers ?? []);
  const at = (f: number, p: number): XY | null => {
    const fr = F[Math.max(0, Math.min(F.length - 1, f))];
    const a = p < nAtt ? fr.att[p] : fr.def[p - nAtt];
    return a ? [a[0], a[1]] : null;
  };
  const pos = (p: number, t: number): XY | null => {
    const x = Math.max(0, Math.min(F.length - 1.001, t * fps)), i = Math.floor(x), u = x - i, a = at(i, p), b = at(i + 1, p);
    if (!a || !b) return a ?? b;
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  /** over 0.4 s, centred: the tracking's jitter at 10 Hz is a few centimetres a frame */
  const vel = (p: number, t: number): XY => {
    const a = pos(p, t - 0.2), b = pos(p, t + 0.2);
    return a && b ? [(b[0] - a[0]) / 0.4, (b[1] - a[1]) / 0.4] : [0, 0];
  };
  const all = (t: number) => Array.from({ length: P }, (_, p) => pos(p, t) ?? ([0, 0] as XY));
  return {
    data, nAtt, P, keepers, defKeeper: [...keepers].find((k) => k >= nAtt) ?? -1, end: (F.length - 1) / fps,
    pos, vel, all, ball: (t) => ballAt(pkg, t), side: (p) => (p < nAtt ? 'att' : 'def'),
  };
}

export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const kmh = (v: XY) => Math.hypot(v[0], v[1]) * 3.6;

/** a side's outfield players at t, split into units (the telestration's own rule, so what we count is what it draws) */
export function unitsAt(g: Geo, side: 'att' | 'def', t: number): Units & { depth: (p: number) => number } {
  const players: { p: number; xy: XY }[] = [];
  for (let p = side === 'att' ? 0 : g.nAtt; p < (side === 'att' ? g.nAtt : g.P); p++) {
    if (g.keepers.has(p)) continue;
    const xy = g.pos(p, t); if (xy) players.push({ p, xy });
  }
  const depth = (xy: XY) => (side === 'def' ? xy[0] : -xy[0]);
  const u = splitUnits(players, depth, { split: null, order: [] });
  return { ...u, depth: (p: number) => depth(g.pos(p, t) ?? [0, 0]) };
}

/** a unit's line across the pitch at t: the x of the line at y, linear between its players sorted across (flat beyond
 *  its ends), as the telestration draws it */
export function lineX(g: Geo, unit: number[], t: number): (y: number) => number {
  const pts = unit.map((p) => g.pos(p, t)).filter((q): q is XY => !!q).sort((a, b) => a[1] - b[1]);
  return (y: number) => {
    if (!pts.length) return NaN;
    if (y <= pts[0][1]) return pts[0][0];
    for (let i = 0; i + 1 < pts.length; i++) if (y <= pts[i + 1][1]) { const u = (y - pts[i][1]) / Math.max(1e-6, pts[i + 1][1] - pts[i][1]); return pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u; }
    return pts[pts.length - 1][0];
  };
}

/** the defending side's offside line at t: the second-last defender's x (the keeper counts), never behind halfway */
export function offsideX(g: Geo, t: number): number {
  const xs: number[] = [];
  for (let p = g.nAtt; p < g.P; p++) { const q = g.pos(p, t); if (q) xs.push(q[0]); }
  xs.sort((a, b) => b - a);
  return Math.max(0, xs[1] ?? 0);
}

/** outfield defenders between the ball and their goal at t (x ahead of the ball's by more than `margin` m) */
export function goalSide(g: Geo, t: number, bx: number, margin = 0.5): number[] {
  const out: number[] = [];
  for (let p = g.nAtt; p < g.P; p++) { if (p === g.defKeeper) continue; const q = g.pos(p, t); if (q && q[0] > bx + margin) out.push(p); }
  return out;
}

/** the attacking side's share of the space at points, for a ball at `ball` (Spearman, src/response/outcomes.ts) */
export function attControl(g: Geo, t: number, points: XY[], ball: XY): number[] {
  const att: XY[] = [], attV: XY[] = [], def: XY[] = [], defV: XY[] = [];
  for (let p = 0; p < g.P; p++) {
    const q = g.pos(p, t); if (!q) continue;
    (p < g.nAtt ? att : def).push(q); (p < g.nAtt ? attV : defV).push(g.vel(p, t));
  }
  return pitchControl(points, att, attV, def, defV, ball);
}

/** the space the attack owns round point c at time t, as a polygon of 8 corners: along each of 8 directions, the
 *  farthest radius (to `rMax`, in 1 m steps) the attacking side still controls at `share` or more. null when the
 *  point itself is not theirs. The ball is taken where it was played from (`from`), so it is the space the pass
 *  went into, as the passer saw it */
export function spaceAt(g: Geo, t: number, c: XY, from: XY, share = 0.6, rMax = 14): { poly: XY[]; area: number; centre: number } | null {
  const centre = attControl(g, t, [c], from)[0];
  if (centre < share) return null;
  const dirs = 8, rs = Array.from({ length: rMax }, (_, k) => k + 1), pts: XY[] = [];
  for (let d = 0; d < dirs; d++) for (const r of rs) { const a = (2 * Math.PI * d) / dirs; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  const ctl = attControl(g, t, pts, from), poly: XY[] = [];
  for (let d = 0; d < dirs; d++) {
    let r = 0.8;
    for (let k = 0; k < rs.length; k++) { const q = pts[d * rs.length + k]; if (ctl[d * rs.length + k] < share || Math.abs(q[1]) > 34 || q[0] > GOAL_X) break; r = rs[k]; }
    const a = (2 * Math.PI * d) / dirs;
    poly.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  let area = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += (a[0] * b[1] - b[0] * a[1]) / 2; }
  return { poly, area: Math.abs(area), centre };
}

/** the nearest outfield opponent (or anyone of the other side, keepers too when `keepers`) to player p at t */
export function nearestOpp(g: Geo, p: number, t: number, keepers = false): { player: number; d: number } | null {
  const me = g.pos(p, t); if (!me) return null;
  let best: { player: number; d: number } | null = null;
  const [a, b] = g.side(p) === 'att' ? [g.nAtt, g.P] : [0, g.nAtt];
  for (let q = a; q < b; q++) {
    if (!keepers && g.keepers.has(q)) continue;
    const x = g.pos(q, t); if (!x) continue;
    const d = dist(me, x); if (!best || d < best.d) best = { player: q, d };
  }
  return best;
}
