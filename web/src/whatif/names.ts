// How the what-if's cards name a player, minimal and straightforward: the man's number and his shirt
// name, "#37 Pryce"; a man of the other team with his kit colour too, "Orange #4 Lenoir", since the numbers can clash.
// The shirt name is the roster's (lineup/roster.ts, capitals on the shirt), written here in title case.
import type { Look } from '../three/players/looks';
import { kitLabel, playerTeam, type Team } from '../three/coords';

const title = (s: string) => s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase());

/** a namer for one clip: `mine` the team whose man has the ball (its men without the colour) */
export function namer(looks: Look[], nAtt: number, attacking: Team, mine: Team) {
  return (p: number) => {
    const team = playerTeam(p, nAtt, attacking), n = looks[p]?.number ?? p + 1, nm = looks[p]?.name ? ` ${title(looks[p].name)}` : '';
    return (team === mine ? `#${n}` : kitLabel(team, n)) + nm;
  };
}
