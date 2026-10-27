// What each beat draws (docs/plans/orchestrator-notes.md, "Drawing"): every beat kind maps to the telestration's
// primitives, timed in the telestration's rhythm (draw on, hold, retract), and the whole clip is kept readable by a
// clutter budget: at most MAX_ITEMS drawings at once, the protagonist's ring not counted (it is the selection).
// Timing: lines and units land LEAD s before the moment they explain; an arrow draws as its action starts; a zone
// unfolds as the ball arrives; everything retracts EXIT s after its beat.
import type { Item, XY } from '../three/telestration/Telestration';

/** the telestration's items; the pass and run arrows are built since 2026-10-22 (telestration-notes §13) in the shapes
 *  the narration and orchestrator sessions drafted: `{ kind: 'pass', from, to, t?: [kick, reception], loft?, whatif? }`
 *  (the loft drawn flat until the 3D arc) and `{ kind: 'run', path: { player, from, to } }` */
export type DrawItem = Item;
export type PassArrow = Extract<Item, { kind: 'pass' }>;
export type RunArrow = Extract<Item, { kind: 'run' }>;
/** kinds the telestration does not draw yet (none, since the arrows); the board and the storyboard mark them */
export const PENDING = new Set<string>();

export const MAX_ITEMS = 3;
/** a line lands this long before the moment it explains (units before the kick: research note, section 4) */
export const LEAD = 1.0;
/** drawings stay this long after their beat's moment before retracting */
export const EXIT = 0.8;

/** how much a drawing matters when the budget must cut (higher stays) */
export const PRIO: Record<string, number> = { shot: 5, pass: 4, run: 3, units: 3, zone: 2, marking: 2, spotlight: 2, hull: 1, network: 1, pressure: 1 };

const w = (from: number, to: number) => ({ from: +from.toFixed(2), to: +to.toFixed(2) });

export const draw = {
  /** the defending side's units pinned at the kick of a line-breaking pass */
  units: (id: string, kick: number, from: number, to: number): DrawItem => ({ id, kind: 'units', side: 'def', at: +kick.toFixed(2), window: w(from, to) }),
  /** a pass, from where the ball left to where it was met; lofted along its real flight when it rose over 2 m */
  pass: (id: string, from: XY, to: XY, kick: number, recv: number, peak: number, win: [number, number], whatif = false): DrawItem =>
    ({ id, kind: 'pass', from: [+from[0].toFixed(1), +from[1].toFixed(1)], to: [+to[0].toFixed(1), +to[1].toFixed(1)], t: [+kick.toFixed(2), +recv.toFixed(2)], ...(peak > 2 ? { loft: 'track' as const } : {}), ...(whatif ? { whatif: true } : {}), window: w(...win) }),
  run: (id: string, player: number, from: number, to: number, win: [number, number]): DrawItem => ({ id, kind: 'run', path: { player, from: +from.toFixed(2), to: +to.toFixed(2) }, window: w(...win) }),
  zone: (id: string, poly: XY[], win: [number, number]): DrawItem => ({ id, kind: 'zone', poly: poly.map((q) => [+q[0].toFixed(1), +q[1].toFixed(1)] as XY), ink: 'att', window: w(...win) }),
  hull: (id: string, at: number, win: [number, number]): DrawItem => ({ id, kind: 'hull', side: 'def', at: +at.toFixed(2), window: w(...win) }),
  shot: (id: string, shooter: number, at: number): DrawItem => ({ id, kind: 'shot', shooter, at: +at.toFixed(2) }),
  marking: (id: string, focus: number, at: number, win?: [number, number]): DrawItem => ({ id, kind: 'marking', focus, at: +at.toFixed(2), ...(win ? { window: w(...win) } : {}) }),
  spotlight: (id: string, player: number, win: [number, number]): DrawItem => ({ id, kind: 'spotlight', at: { player }, window: w(...win) }),
};

/** a drawing's window on clip time, or the beat's span when it has none */
export const span = (it: DrawItem, t0: number, t1: number): [number, number] => [it.window?.from ?? t0, it.window?.to ?? t1];
