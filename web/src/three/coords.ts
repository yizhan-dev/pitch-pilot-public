import * as THREE from 'three';
import { tr } from '../i18n';
// Data: metres, x along the pitch (team in possession attacks +x), y across, z up.
// Three.js: x = data x, y = data z (up), z = data y.
export const L = 105, W = 68;
export const v3 = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, y);

// The kits. Each team keeps its colours in every clip (Yi, 2026-10-23): home (Team A) blue, away (Team B) orange. Until
// then they went by role, the attacking side blue and the defending side orange, so a team changed colour from one clip
// to the next. The packages stay in attack order (players 0..nAtt-1 attack, pkg.meta.attacking says which team that
// is), so anything drawn in a team's colour asks kitOf / roleTeam / playerTeam below which team a role or a player is.

/** a team, as the packages name it (meta.attacking, the clip index's `team`) */
export type Team = 'home' | 'away';
/** a side's role in a clip: attacking (players 0..nAtt-1) or defending */
export type Role = 'att' | 'def';

/** each team's kit, the same in every clip */
export const TEAM_KIT = {
  home: { shirt: '#3987e5', shorts: '#e9eef5', socks: '#3987e5' },
  away: { shirt: '#d95926', shorts: '#1b2230', socks: '#d95926' },
};
export const KIT = {
  skin: '#8d96a3', boot: '#14171c',
  /** @deprecated the kits by role from before 2026-10-23 (att was always blue, def orange), wrong whenever the away
   *  team attacks; use kitOf(role, attacking) or TEAM_KIT. Kept, the same objects, for code not yet converted
   *  (telestration/style.ts, players/v0/); see docs/plans/team-colours.md */
  att: TEAM_KIT.home,
  /** @deprecated see att */
  def: TEAM_KIT.away,
};

/** the attacking team of a package (pkg.meta): 'away' only when it says so, so a package without one draws as before */
export const attackingOf = (meta: { attacking?: string }): Team => (meta.attacking === 'away' ? 'away' : 'home');

/** the match's ends (Yi, 2026-10-24: "first half blue attacks from left to right, red from right to left; and second
 *  half switch"). A package's attackers attack +x, which the broadcast camera shows left to right: +1 when that is how
 *  the match reads, -1 when the view turns round (the stadium, the lights and the cameras that keep to one side go to
 *  the other touchline, the radar turns; the players, the ball and every model stay in the package's frame). Only where
 *  a page turns it on (GameApp, the Decision Lab), so the other pages keep their views. */
export const matchEnds = { on: false };
export function viewSign(meta: { half?: number; attacking?: string }): 1 | -1 {
  if (!matchEnds.on) return 1;
  const home = attackingOf(meta) === 'home', second = meta.half === 2;
  return home !== second ? 1 : -1;        // home left to right in the first half, away in the second
}
/** the team playing `role` in a clip where `attacking` attacks */
export const roleTeam = (role: Role, attacking: Team): Team => (role === 'att' ? attacking : attacking === 'home' ? 'away' : 'home');
/** the team of player p, in a package's order (the nAtt attackers first) */
export const playerTeam = (p: number, nAtt: number, attacking: Team): Team => roleTeam(p < nAtt ? 'att' : 'def', attacking);
/** the kit `role` wears in a clip where `attacking` attacks */
export const kitOf = (role: Role, attacking: Team) => TEAM_KIT[roleTeam(role, attacking)];

/** the kits' colours by name, as viewers read them */
export const KIT_NAME: Record<Team, string> = { home: tr('蓝', 'Blue'), away: tr('橙', 'Orange') };
/** a player by his kit's colour and his shirt number, as the HUD and the pause window write him: Blue #31, 蓝 31 号 */
export const kitLabel = (team: Team, number: number | string) => tr(`${KIT_NAME[team]} ${number} 号`, `${KIT_NAME[team]} #${number}`);
