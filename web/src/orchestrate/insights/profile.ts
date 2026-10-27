import { matchFile } from '../../data/paths';
// The whole-match profile (private/orchestrator/profile.py → matches/<match>/profile.json): every touch's foot,
// every reception's scans and body shape, and per-player 本场 counts. A clip joins its own events to it by team, shirt
// and match clock (within 0.35 s: the profile's contact times come from the same ball track as the clip's touches).
export interface ProfileEvent { i: number; half: number; clock: number; t: number; home: boolean; shirt: number; pid: string; type: string; ok: boolean; how: 'touch' | 'feed'; z: number; foot: 'L' | 'R' | 'H' | 'either' | '?' | '-'; swing: [number | null, number | null]; ratio: number | null; opta_foot?: string }
export interface ProfileReception { pass_i: number; i: number; half: number; clock: number; t: number; home: boolean; shirt: number; pid: string; body: number | null; scans: number | null; last_scan: number | null; touch: 'forward' | 'side' | 'back' | 'still'; touch_m: number; nearest: number | null; next: string }
export interface ProfileDribble { i: number; half: number; clock: number; t: number; home: boolean; shirt: number; pid: string; foot: string; ratio: number | null; lateral: 'in' | 'out' | 'straight' }
export interface Habits {
  home: boolean; shirt: number;
  passes: { n: number; L: number; R: number; H: number; either: number };
  shots: { n: number; L: number; R: number; H: number; either: number };
  dribble: { n: number; L: number; R: number; either: number; in: number; out: number };
  receptions: { n: number; open: number; closed: number; side?: number; scans: number; scanned: number; late_scan: number; forward: number; pressed: number };
}
export interface Profile {
  match: string; made: string; note: string;
  params: Record<string, unknown>;
  validation: { shots: [number, number]; passes: [number, number]; wrong: unknown[] };
  players: Record<string, Habits>;
  events: ProfileEvent[];
  receptions: ProfileReception[];
  dribbles: ProfileDribble[];
}

const cache = new Map<string, Promise<Profile | null>>();
/** the match's profile, fetched once; null when it is not written yet */
export function loadProfile(match: string): Promise<Profile | null> {
  let p = cache.get(match);
  if (!p) { p = fetch(matchFile('profile.json', match)).then((r) => (r.ok ? r.json() : null)).catch(() => null); cache.set(match, p); }
  return p;
}

const TOL = 0.35;
/** the profile's record of a clip event: the same team and shirt, the match clock within TOL s */
export function profileEvent(pr: Profile | null, home: boolean, shirt: number, clock: number, type?: string): ProfileEvent | null {
  if (!pr) return null;
  let best: ProfileEvent | null = null, bd = TOL;
  for (const e of pr.events) { if (e.home !== home || e.shirt !== shirt || (type && e.type !== type)) continue; const d = Math.abs(e.clock - clock); if (d < bd) { bd = d; best = e; } }
  return best;
}
/** the profile's record of a reception: the receiver's team and shirt, the first touch's match clock within TOL s */
export function profileReception(pr: Profile | null, home: boolean, shirt: number, clock: number): ProfileReception | null {
  if (!pr) return null;
  let best: ProfileReception | null = null, bd = TOL + 0.2;
  for (const r of pr.receptions) { if (r.home !== home || r.shirt !== shirt) continue; const d = Math.abs(r.clock - clock); if (d < bd) { bd = d; best = r; } }
  return best;
}
export const habits = (pr: Profile | null, pid: string): Habits | null => pr?.players[pid] ?? null;

/** a share as a percentage of the decided ones (L and R), with its n; null under `min` decided */
export function footShare(c: { L: number; R: number }, min = 10): { L: number; R: number; n: number } | null {
  const n = c.L + c.R;
  return n >= min ? { L: Math.round((100 * c.L) / n), R: Math.round((100 * c.R) / n), n } : null;
}
