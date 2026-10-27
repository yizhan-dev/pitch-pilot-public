import { matchFile } from '../data/paths';
import { useEffect, useState } from 'react';
import { makeLooks, type Look, type Seeds } from '../three/players/looks';
import type { Team } from '../three/coords';
import { pick } from '../i18n';

// The match roster (Yi, 2026-10-23: "we need to make the names consistent and plausible"): one invented identity per
// player, the same in the line-up show and in every clip. The names are in each nationality's style (a Chinese player
// gets a realistic Chinese name), written by private/lineup/make_roster.py into <match>/roster.json and checked
// there against both real squads. The look (face, hair, build, boots, shirt number) comes from one makeLooks over the
// whole roster, so it follows the player by his tracking id instead of his place in a package.

export interface RosterPlayer {
  pid: string; side: Team;
  /** full name, English and Chinese, as the line-up show's card writes it */
  name: string; name_zh: string;
  /** what his shirt carries on the back (capitals; Chinese players the full name, the others the surname) */
  shirt_name: string;
  nat: string; keeper: boolean; starter: boolean;
}
export interface Roster { players: RosterPlayer[] }

export const ROSTER_FILE = matchFile('roster.json');

/** each rostered player's look by tracking id: one makeLooks over the whole roster (home first, so the numbers are
 *  unique within each team and the keepers wear 1), the shirt name in place of the invented syllables */
export function rosterLooks(r: Roster, seeds: Seeds = { hair: 1, number: 1, skin: 1 }): Map<string, Look> {
  const P = r.players, nHome = P.filter((p) => p.side === 'home').length;
  const looks = makeLooks(P.length, nHome, seeds, P.flatMap((p, i) => (p.keeper ? [i] : [])));
  return new Map(P.map((p, i) => [p.pid, { ...looks[i], name: p.shirt_name }]));
}

/** looks in some player order (a package's, attackers first): the roster's by tracking id, the fallback's for anyone
 *  not on it (or when there is no roster) */
export function looksFor(pids: (string | null | undefined)[], byPid: Map<string, Look> | null, fallback: Look[]): Look[] {
  return fallback.map((l, i) => (byPid && pids[i] ? byPid.get(pids[i]!) ?? l : l));
}

/** a rostered player's full name in the viewer's language */
export const fullName = (p: RosterPlayer) => pick(p.name_zh, p.name);

let loading: Promise<Roster | null> | null = null;
/** the match roster, fetched once per page (null if the file is missing: callers fall back to makeLooks) */
export function loadRoster(): Promise<Roster | null> {
  return (loading ??= fetch(ROSTER_FILE).then((r) => (r.ok ? r.json() : null)).catch(() => null));
}
/** the roster in a component: null until it has loaded (or if there is none) */
export function useRoster(): Roster | null {
  const [roster, setRoster] = useState<Roster | null>(null);
  useEffect(() => { let live = true; loadRoster().then((r) => { if (live) setRoster(r); }); return () => { live = false; }; }, []);
  return roster;
}

/** a clip package's looks in its own player order (attackers first): each player's from the roster by his tracking id
 *  (pkg.players, written by export_clips.py in the same order as the joints), the fallback's (the window's own
 *  makeLooks) for anyone not on it; the seeds re-roll the roster's looks as they do the fallback's (the workbench's
 *  ?hair= ?num= ...) */
export function clipLooks(pkg: unknown, roster: Roster | null, fallback: Look[], seeds?: Seeds): Look[] {
  const players = (pkg as { players?: { pid?: string }[] } | null)?.players;
  if (!roster || !players || players.length !== fallback.length) return fallback;
  return looksFor(players.map((p) => p.pid), rosterLooks(roster, seeds), fallback);
}
