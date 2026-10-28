import { matchFile, clipAddr } from '../data/paths';
// The clip packages and the clip index as the HUD reads them (pel-wil/, written by
// private/hawkeye/export_clips.py), and small helpers for the match clock and the score.
import type { Loaded } from '../data';

export interface ClipEvent { t: number; type: string; outcome: string | null; shooting: boolean; player: number | null; clock: number; receiver?: number | null; xg?: number; tags: string[]; key?: boolean; lb?: { lines: number; last: string | null } }
/** a clip package: the moment package plus the synced events, the match clock at its start and the teams */
export type ClipPkg = Loaded['pkg'] & {
  events?: ClipEvent[];
  clock0?: number;
  teams?: { home: string; away: string; match: string };
  /** the 3D side's export (2026-10-22), by package player (attackers first): Opta MA2 line-up at the clip's end (null
   *  where the tracking's shirt number did not match), formation per side, cumulative metres at the clip's start, the
   *  same per second through the clip (from kick-off, hsr above 20 km/h), and each player's synced events from kick-off
   *  to the clip's end as [clock, type, ok, xg, tags] */
  lineup?: ({ position: string; side: string; place: number; detail: string } | null)[];
  formation?: { att: string; def: string };
  /** what each outfield player really played round the clip's key moment (Opta MA33 live shapes, the 3D side's export,
   *  2026-10-22): role codes in and out of possession with their Chinese names; null for keepers */
  roles?: ({ in: string | null; out: string | null; in_zh: string | null; out_zh: string | null; in_en?: string | null; out_en?: string | null } | null)[];
  /** each side's detected shape then: in and out of possession, e.g. { label: '4-2-3-1 Off. FB', formation: '4-5-1' } */
  shapes?: { window: [number, number]; att: Record<'in' | 'out', { label: string; formation: string }>; def: Record<'in' | 'out', { label: string; formation: string }> };
  run0?: { dist: number; hsr: number }[];
  /** once a second through the clip: metres from kick-off (dist, hsr from 20 km/h), the fastest second so far in the
   *  match (top, km/h) and the sprints so far (spr: 25 km/h and up for 1 s); top and spr since 2026-10-28 */
  run?: { hz: number; dist: number[][]; hsr: number[][]; top?: number[][]; spr?: number[][] };
  match_events?: { fields: string[]; players: [number, string, number, number | null, string[]][][] };
  /** cards shown so far in the match, by package player (to come from the export: Opta MA2 liveData.card matched through
   *  the tracking's shirt numbers); clock in match seconds */
  cards?: Booking[];
  /** the officials' tracking, when exported (roles Referee, AssistantReferee1/2) */
  officials?: { roles: string[]; joints: unknown | null } | null;
};
export interface Booking { player: number; clock: number; kind: 'yellow' | 'red' | 'second-yellow' }
export interface ClipRow {
  id: string; kind: 'shot' | 'pass' | 'offside' | 'possession' | 'kickoff'; moment: string; title: string; title_en?: string; half: number; clock: number; team: 'home' | 'away'; duration: number;
  xg: number[]; goal: boolean; lines: number | null; last: string | null; xpass: number | null; shot_after: boolean;
  /** its outcome, for the replay plate's icon */
  category?: ClipCategory;
}
/** a clip's outcome, for the replay plate's icon (export_clips.py category(); Yi, 2026-10-23): a goal, a penalty or a
 *  set-piece goal, a big chance not scored, the main shot's post, block, save or miss, a line-breaking attack, an offside,
 *  a great possession (beat the press and kept the ball, Yi 2026-10-24), the kick-off */
/** clips in match time: by half, then the clock (the clip lists and the clip keys, Yi 2026-10-24) */
export const byMatchTime = (a: ClipRow, b: ClipRow) => a.half - b.half || a.clock - b.clock;
export type ClipCategory = 'goal' | 'penalty' | 'setpiece' | 'bigchance' | 'post' | 'blocked' | 'saved' | 'wide' | 'attack' | 'offside' | 'possession' | 'kickoff';
export interface ClipIndex {
  match: string; home: string; away: string; note: string; clips: ClipRow[];
  /** the added time announced in each half, seconds by half ('1', '2'; Opta MA24, written by export_clips.py) */
  added?: Record<string, number>;
}

export const INDEX_FILE = matchFile('index.json');
export const DEFAULT_MOMENT = clipAddr('shot-15-53');

/** the teams' names. No real club names on screen (Yi, 2026-10-22); invented ones since 2026-10-23 (Yi): home the
 *  Pelicans, away the Wildcats, in every clip, each in its own kit (home blue, away orange) with its crest
 *  (./crests.tsx). English only: the Chinese version is retired (Yi, 2026-10-23) */
export const TEAM_LABEL = { home: 'Pelicans', away: 'Wildcats' } as const;
/** the score bug's short names beside the crests, as broadcasts show them (Yi, 2026-10-23) */
export const TEAM_CODE = { home: 'PEL', away: 'WIL' } as const;

/** a text (a clip title) with the data's own team names, whatever a clip package carries, replaced by the team
 *  labels; the names come from the data only, never from the code */
export function hideClubs(text: string, teams: { home: string; away: string }) {
  let out = text;
  for (const side of ['home', 'away'] as const) if (teams[side]) out = out.split(teams[side]).join(TEAM_LABEL[side]);
  return out;
}

/** the match clock as a broadcast shows it: whole minutes and seconds past kick-off (the second half runs on from
 *  45:00), e.g. 15:52 */
export function fmtClock(s: number) {
  const d = Math.max(0, Math.floor(s)), m = Math.floor(d / 60), r = d % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** the added time announced for the clip's half, in whole minutes, once the clock is past the half's 45 or 90 minutes:
 *  the score bug's +N box (Yi, 2026-10-23); null before then, or when the index has no figure for the half */
export function addedAt(index: ClipIndex | null, half: number, now: number): number | null {
  const s = index?.added?.[String(half)];
  return s != null && now >= (half === 1 ? 45 : 90) * 60 ? Math.round(s / 60) : null;
}

/** the score at match clock `now` (seconds), home first. Goals come from the clip's own synced events, and for the rest of
 *  the match from the index (a clip with a goal carries the goal's clock; checked on all five goals, 2026-10-22). */
export function scoreAt(pkg: ClipPkg, index: ClipIndex | null, now: number): [number, number] {
  const att = pkg.meta.attacking === 'home' ? 0 : 1;
  const goals: { clock: number; side: number }[] = (pkg.events ?? []).filter((e) => e.type === 'Goal').map((e) => ({ clock: e.clock, side: e.shooting ? att : 1 - att }));
  for (const c of index?.clips ?? []) if (c.goal && c.id !== pkg.meta.id) goals.push({ clock: c.clock, side: c.team === 'home' ? 0 : 1 });
  const s: [number, number] = [0, 0];
  for (const g of goals) if (g.clock <= now) s[g.side]++;
  return s;
}
