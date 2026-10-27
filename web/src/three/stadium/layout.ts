import { steps, type Profile } from './path';

// Bowl inner edge: 8.5 m beyond the goal lines and the touchlines, rounded corners.
export const HX = 61, HY = 42.5, RC = 20;
export const LOWER = steps(0, 2.2, 24, 0.85, 0.38);            // lower tier: 24 rows, about 20 m deep, 9 m rise
export const LOWER_END = LOWER[LOWER.length - 1];
// between the tiers: a cross-aisle, then the upper tier's front: a band of hospitality boxes and a light grey parapet
/** every tier's front carries the same light grey band, this tall (Yi, 2026-10-21) */
export const GREY_BAND = 1.1;
export const BOX_BAND = { d: LOWER_END.d + 1.2, h0: LOWER_END.h + 0.5, h1: LOWER_END.h + 3.2 - GREY_BAND };
export const FASCIA: Profile = [
  { d: LOWER_END.d, h: LOWER_END.h, kind: 'wall' }, { d: LOWER_END.d + 1.2, h: LOWER_END.h + 0.4, kind: 'wall' },
  { d: LOWER_END.d + 1.2, h: LOWER_END.h + 3.2 - GREY_BAND, kind: 'fascia' }, { d: LOWER_END.d + 1.2, h: LOWER_END.h + 3.2 - GREY_BAND, kind: 'pitchwall' },
  { d: LOWER_END.d + 1.2, h: LOWER_END.h + 3.2, kind: 'pitchwall' },
];
/** the lower tier's front wall: dark at pitch level, the grey band on top; LOWER_PREFIX points come before the rows */
export const LOWER_FRONT: Profile = [
  { d: 0, h: 0, kind: 'fascia' }, { d: 0, h: LOWER[0].h - GREY_BAND, kind: 'fascia' },
  { d: 0, h: LOWER[0].h - GREY_BAND, kind: 'pitchwall' }, { d: 0, h: LOWER[0].h, kind: 'pitchwall' },
];
export const LOWER_PREFIX = LOWER_FRONT.length;
export const UPPER = steps(LOWER_END.d + 1.2, LOWER_END.h + 3.2, 20, 0.8, 0.52);
export const UPPER_END = UPPER[UPPER.length - 1];
export const ROOF = { back: UPPER_END.d + 0.5, backH: UPPER_END.h + 4.5, front: 6, frontH: UPPER_END.h + 7.5 };

export const BOWL_PERIM = 4 * (HX - RC) + 4 * (HY - RC) + 2 * Math.PI * RC;
const wrap = (x: number) => x - Math.round(x / BOWL_PERIM) * BOWL_PERIM;
/** true if base arc length s lies in [lo, hi] (wrapping round the loop), with a hair of tolerance so a range's own ends count */
export const inRange = (s: number, [lo, hi]: [number, number]) => Math.abs(wrap(s - (lo + hi) / 2)) <= (hi - lo) / 2 + 1e-4;

/** The straight sides and the corners on the base path (arc length from the middle of the +y side, counter-clockwise),
 *  from the start of the +y side: long, corner, end, corner, long, corner, end, corner. */
export const SIDES: { s0: number; s1: number; kind: 'long' | 'end' | 'corner' }[] = (() => {
  const a = HX - RC, b = HY - RC, q = Math.PI * RC / 2, out: { s0: number; s1: number; kind: 'long' | 'end' | 'corner' }[] = [];
  let s = -a;
  for (const [len, kind] of [[2 * a, 'long'], [q, 'corner'], [2 * b, 'end'], [q, 'corner'], [2 * a, 'long'], [q, 'corner'], [2 * b, 'end'], [q, 'corner']] as [number, 'long' | 'end' | 'corner'][]) { out.push({ s0: s, s1: s + len, kind }); s += len; }
  return out;
})();

/** The gangways (Yi, 2026-10-22: the seat blocks were not centred). They used to run every BOWL_PERIM / 28 from the middle
 *  of the main stand, which centred nothing else: the end blocks sat 0.6-1.2 m off the goal axis, and on a corner one
 *  gangway fell at its start and the next 4 m before its end. Now each side is laid out about its own middle and each
 *  corner about its diagonal: a gangway at every joint between a straight and a corner, one on each corner's diagonal,
 *  five inside each long side (13.67 m apart, one on the halfway line) and three inside each end (11.25 m apart, one on
 *  the goal axis). Still 28 in all. Going round, every other one (never a joint) heads a vomitory; the halfway gangway
 *  on the main side does not, the players' tunnel being under it. s: the centre line on the base path. */
export const GANGWAY_W = 1.2;
export const GANGWAYS: { s: number; corner: boolean; vom: boolean; before: 'corner' | 'straight'; after: 'corner' | 'straight' }[] = (() => {
  const out: { s: number; corner: boolean; vom: boolean; before: 'corner' | 'straight'; after: 'corner' | 'straight' }[] = [];
  const side = (k: 'long' | 'end' | 'corner') => (k === 'corner' ? 'corner' : 'straight');
  SIDES.forEach((x, n) => {
    const len = x.s1 - x.s0, parts = x.kind === 'long' ? 6 : x.kind === 'end' ? 4 : 2, prev = SIDES[(n + SIDES.length - 1) % SIDES.length];
    out.push({ s: x.s0, corner: false, vom: false, before: side(prev.kind), after: side(x.kind) });     // the joint
    for (let i = 1; i < parts; i++) out.push({ s: x.s0 + len * i / parts, corner: x.kind === 'corner', vom: false, before: side(x.kind), after: side(x.kind) });
  });
  out.forEach((g, i) => { g.vom = i % 2 === 1 && Math.abs(wrap(g.s)) > 1; g.s = ((g.s % BOWL_PERIM) + BOWL_PERIM) % BOWL_PERIM; });
  return out;
})();
/** each gangway's span on the base path for a tier whose rows sit around offset dRef. On a straight it is the full width;
 *  on a corner the gangway is radial, so its span in base arc length is the width scaled back to dRef (it widens a
 *  little towards the back, as the corner's rows fan out). A joint has one half of each. */
export const gangwayRanges = (dRef: number): [number, number][] => {
  const hs = GANGWAY_W / 2, hc = hs * RC / (RC + dRef);
  return GANGWAYS.map((g) => [g.s - (g.before === 'corner' ? hc : hs), g.s + (g.after === 'corner' ? hc : hs)]);
};
/** the path samples a tier needs so its gangway strips have crisp edges: at each edge and 1 cm outside it */
export const gangwayBreaks = (r: [number, number][]) => r.flatMap(([lo, hi]) => [lo - 0.01, lo, hi, hi + 0.01]);
export const inGangway = (s: number, r: [number, number][]) => r.some((x) => inRange(s, x));

/** Vomitories, fourth version (Yi, 2026-10-22: "now it looks perfect"). The third version, light grey box portals on the
 *  lower tier only, was rejected ("keep it simplified"); this one follows Yi's terms: slightly smaller, on every tier, a
 *  slightly darker colour so they blend in. Each is a box at the head of a gangway: its floor is row r0's tread, its
 *  level roof runs back until it meets the tread `rows` rows behind, which leaves a 2.1 m doorway under a 0.5-0.6 m
 *  lintel on each tier's rake. Same positions on every tier, stacked. */
export const VOM = { w: 2.4, wall: 0.18, door: 2.1 };
export const VOM_HALF = VOM.w / 2 + VOM.wall;   // half the box's outer width
export const VOM_TIER = { lower: { r0: 6, rows: 7 }, upper: { r0: 7, rows: 5 }, top: { r0: 2, rows: 5 } };
/** A gate sits on a gangway's centre line s: square to the stand on a straight, radial on a corner. */
export type VomGate = { s: number; corner: boolean };
/** the gangways that head a vomitory (GANGWAYS): two on the main side, three on the far side, two on each end, one on each
 *  corner's diagonal */
export const VOM_GATES: VomGate[] = GANGWAYS.filter((g) => g.vom).map((g) => ({ s: g.s, corner: g.corner }));
/** signed distance from a gate's axis of the point at base arc length s, offset d outwards (positive: further along s) */
export const vomLat = (g: VomGate, s: number, d: number) => { const x = wrap(s - g.s); return g.corner && Math.abs(x) < RC ? (RC + d) * Math.sin(x / RC) : x; };   // (the sine only near the gate: it comes back to 0 half a turn away)
/** the base arc-length range the box covers on a row at offset d (on a corner it narrows outwards, as the radials fan) */
export const vomRange = (g: VomGate, d: number): [number, number] => {
  if (!g.corner) return [g.s - VOM_HALF, g.s + VOM_HALF];
  const at = (x: number) => g.s + RC * Math.asin(x / (RC + d));
  return [at(-VOM_HALF), at(VOM_HALF)];
};

/** How far the lower tier's front steps back at path point p: 0 on the straights, CORNER_SETBACK at the corners'
 *  diagonals, easing in with zero slope. It gives the corner flag about 6 m to the stand, diagonally. */
export const CORNER_SETBACK = 2.6;
export const cornerSetback = (p: { nx: number; ny: number; corner: boolean }) => (p.corner ? CORNER_SETBACK * (2 * Math.abs(p.nx * p.ny)) ** 2 : 0);
/** The lower tier's profile offset at path point p: the front steps back by the setback and the rows close up towards
 *  the back, which stays put. Every row survives, a little shallower in the corners; the front wall keeps one height. */
export const lowerD = (p: { nx: number; ny: number; corner: boolean }, d: number) => {
  const sb = cornerSetback(p), dEnd = LOWER_END.d;
  return d >= dEnd ? d : d + sb * (1 - d / dEnd);
};

/** The third tier, cantilevered over the upper tier (TopTier.tsx). */
export const TOP = {
  d0: UPPER_END.d - 9,        // front edge, overhanging the upper tier by 9 m
  h0: UPPER_END.h + 2.6,      // front parapet top
  fascia: 2.4,                // fascia depth below the front edge
  tread: 0.8, rise: 0.54,     // a 34 degree rake, the steepest the safety guidance allows
  maxRows: 10,
  head: 1.25 + 0.7,           // a standing spectator plus clearance below the shell
};
