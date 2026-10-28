import { parseClip } from '../data/paths';
// The What-if mode's moments (Yi, 2026-10-24 evening, docs/plans/hud-notes.md "Four modes"): curated, about 6-8 across
// the match's 20 clips, listed down the left; picking one loads its clip, plays it in from LEAD s before and stops on it,
// where the question card asks what to change. A moment is a reception whose taker's real next action is a pass
// (whatif/snap.ts), found again in the clip's tracking when it loads, so a re-exported clip still stops on the touch.
import { store, useStore } from '../hud/draft';
import { receptions, type Reception } from './snap';

/** what the question card can change at a moment: the pass's target (built), a run, another shooter (not yet) */
export type Ask = 'target' | 'run' | 'shooter';
export interface WiMoment {
  id: string;
  /** the clip (its id in the index) and the reception in it: about when (clip seconds), who takes the ball (package
   *  index), and the match clock there (seconds, for the list) */
  clip: string; t: number; player: number; clock: number;
  /** a short name for the list (never cut off: no "…" on screen) */
  title: string;
  asks: Ask[];
}
// The moments (Yi, 2026-10-26: "for each attack, let's make it only have a what-if, for the last event before shooting,
// or the shooting moment, to encourage the user to find potentially better options"; "some clips you picked are too far
// from the goal"): one per shot in the 20 clips, at the shooter's own touch before his shot (pass instead of shooting?),
// or at the passer's touch when the shot was first time (the last event before it), within 31 m of goal; 74:58 (36 m)
// and 45:10 (40 m) left out, 3:02, 33:28, 54:18, 74:33, 92:01 have no such touch (set pieces, second balls, a volley off
// a cross). Computed from the events and the tracking (the shooter's reception, else the key pass's passer's); m1-m3
// keep their ids for the check flows. Titles name the shooter (the roster's shirt names). Two more at Yi's word
// (2026-10-26), past the 31 m: 48:14's offside (the passer's touch before the offside pass; snap.ts offsideReception)
// and 74:33's blocked shot (the passer's carry after he won the ball, which is no reception, so the listed time is used).
export const MOMENTS: WiMoment[] = [
  { id: 'm4', clip: 'shot-07-12', t: 33.19, player: 9, clock: 429.8, title: 'Marsh\'s big chance', asks: ['target'] },   // shooter, 20.4 m out, shot 2.31 s on
  { id: 'm1', clip: 'shot-15-53', t: 32.09, player: 7, clock: 951.5, title: 'Lowe\'s big chance', asks: ['target'] },   // shooter, 23.4 m out, shot 1.61 s on
  { id: 'm5', clip: 'shot-17-30', t: 33.83, player: 3, clock: 1048.3, title: 'Ferreira\'s shot, saved', asks: ['target'] },   // passer, 15.3 m out, shot 1.17 s on
  { id: 'm2', clip: 'shot-22-54', t: 30.39, player: 7, clock: 1371.6, title: 'Lowe\'s shot, blocked', asks: ['target'] },   // shooter, 29.8 m out, shot 1.91 s on
  { id: 'm3', clip: 'pass-26-40', t: 13.09, player: 6, clock: 1600.4, title: 'Chip over the back line', asks: ['target'] },   // Yi's own: #2 chips first time over the back line (2026-10-25)
  { id: 'm6', clip: 'shot-33-28', t: 17.6, player: 8, clock: 2005.5, title: 'Marsh\'s goal', asks: ['target'] },   // passer, 23.0 m out, shot 2.9 s on
  { id: 'm7', clip: 'shot-41-23', t: 19.73, player: 10, clock: 2481.8, title: 'Marsh\'s shot wide', asks: ['target'] },   // shooter, 23.0 m out, shot 1.07 s on
  // m11, offside-48-14 (t 7.1, player 10, clock 2893.3, 'Ellison offside'; Yi's own, 2026-10-26: #9 takes #31's ball 38 m
  // out, plays #30 in 1.1 s on, 0.2 m offside) is parked since 2026-10-27 night: its real man was offside, so the
  // what-if had one option (Yi: "let's just remove this"); the clip is off hud/directed.ts WHATIF_APPROVED too, plays #30 in 1.1 s on, 0.2 m offside
  { id: 'm8', clip: 'shot-55-43', t: 7.07, player: 3, clock: 3342.2, title: 'Lowe\'s goal', asks: ['target'] },   // shooter, 17.8 m out, shot 0.93 s on
  { id: 'm12', clip: 'shot-74-33', t: 7.0, player: 5, clock: 4471.7, title: 'Munro\'s shot, blocked', asks: ['target'] },   // Yi's own (2026-10-26): #31's carry after his interception, 36 m out, his pass 0.35 s on, #9's first-time shot blocked
  { id: 'm9', clip: 'shot-80-17', t: 25.71, player: 9, clock: 4815.0, title: 'Lowe\'s goal', asks: ['target'] },   // passer, 27.0 m out, shot 1.89 s on
  // m10 (shot-90-04, t 10.01, player 5, clock 5401.0, 'Nolan's shot, saved': shooter, 19.3 m out, shot 2.99 s on) is
  // parked since 2026-10-27 night: the clip's moment is the cross below (Yi: "we can pause at around 90:10, when it is
  // a cross, we can let user to choose which one to do")
  { id: 'm13', clip: 'shot-90-04', t: 19.5, player: 4, clock: 5410.5, title: 'Croft\'s cross', asks: ['target'] },   // Yi's own (2026-10-27): #4 Croft on the right at 90:10, his cross headed by #7 Lowe at 90:12, saved
];
/** a moment plays in from this long before it (Yi: 3-4 s) */
export const LEAD = 3.5;
export const momentById = (id: string | null) => MOMENTS.find((m) => m.id === id) ?? null;
export const clipOf = (moment: string) => parseClip(moment).id;

/** the moment in a loaded clip: his reception nearest the listed time (within 1 s), else the listed time as it is */
export function resolveMoment(pkg: Parameters<typeof receptions>[0], m: WiMoment): Reception {
  const r = receptions(pkg).filter((x) => x.player === m.player).sort((a, b) => Math.abs(a.t - m.t) - Math.abs(b.t - m.t))[0];
  return r && Math.abs(r.t - m.t) < 1 ? r : { t: m.t, player: m.player, passer: null, passT: m.t };
}

/** the moment being played in or stood on: its id, the reception (clip time) and who has the ball then */
export interface WiNow { id: string | null; t: number; carrier: number }
export const WI_NONE: WiNow = { id: null, t: 0, carrier: -1 };
export const wiNow = store<WiNow>(WI_NONE);
export const useWiNow = () => useStore(wiNow);
