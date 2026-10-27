import { animFile } from '../data/paths';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Pitch, type PitchMode } from '../three/Pitch';
import { Players } from '../three/players/Styles';
import { makeLooks } from '../three/players/looks';
import { FrameCounter } from '../three/FrameCounter';
import { SkyDome } from '../three/stadium/Sky';
import { ProceduralStadium } from '../three/stadium/Procedural';
import { Furniture } from '../three/stadium/Furniture';
import { StyledBall } from '../three/players/BallStyles';
import { ballAt } from '../three/Ball';
import { HEAD, axes, broadcastShot } from '../three/camera/broadcastFrame';
import { ScoreBug } from '../hud/TopBar';
import { TEAM_CODE } from '../hud/match';
import type { Joints, Loaded } from '../data';
import type { Clock } from '../clock';
import { Flag, nationName } from './flags';
import { Crest } from '../hud/crests';
import { rosterLooks, looksFor, fullName, type Roster } from './roster';
import { tr, pick } from '../i18n';
import { nightOutside } from '../three/stadium/night';
import { BootFrame } from '../three/BootFrame';
import './lineup.css';

/** the teams' names (Yi, 2026-10-23: invented names and crests; working names, not confirmed), as the HUD's TEAM_CODE
 *  (PEL / WIL) and Crest have them. Here until match.ts has a full-name constant beside TEAM_CODE (asked in
 *  docs/plans/lineup-notes.md) */
const TEAM_NAME = { home: tr('鹈鹕', 'Pelicans'), away: tr('野猫', 'Wildcats') } as const;
/** a team's name split after its score-bug code when it starts with it (Pelicans: Pel | icans, shown in capitals), so the
 *  title can fold the rest away as it becomes the score bug; else the whole name and no rest */
const codeSplit = (side: 'home' | 'away'): [string, string] => {
  const name = TEAM_NAME[side], code = TEAM_CODE[side];
  return name.toUpperCase().startsWith(code.toUpperCase()) ? [name.slice(0, code.length), name.slice(code.length)] : [name, ''];
};

// The pre-match line-up show (Yi, 2026-10-23), a cartoon take on the broadcast routine, in one scene with both teams
// warming up in their halves. A sweep inside the stadium with the title, crest against crest (the HUD's score bug built
// large). Then the Pelicans in full: their formation board (the grass turns into the dark board, the eleven at their
// places with number and position); the players one at a time, as a film camera would take them (Yi: go to one, stop,
// show his tags, move on quickly, a bit dramatic): a quick move to the next man (a whip along the line, a rise and a
// turn between lines), a stop in a low hero framing with him on the left third and a slow push in, and his card: the
// number, the flag and the name, the position and the nationality, then his tags one by one (from the match's numbers,
// export_clips.py --lineup); the screen in letterbox for this part. Then the Wildcats, short (agreed with Yi): the camera
// crosses the halfway line to their board (number and name over each man), drops to their back line and tracks along
// each line from above with a plate over every head (number, flag, name). Then the hand-off to the match (Yi,
// 2026-10-23, as a broadcast does it): a crane up and back to the game's broadcast camera over both teams; a ring of
// light grows from the kick-off spot and, as it reaches each man, he is teleported from his staged spot to where he
// really stood at the kick-off (the kick-off clip's first frame, Hawk-Eye tracking), white and sparks as a superhero
// cartoon does it; the HUD's score bug builds itself at the top left at 0:00 (Yi, 2026-10-24: not the title again in
// the middle); the game takes over there and plays the kick-off (watch mode's first clip). Each player in his own warm-up animation (Mixamo, baked to our joints
// by scripts/mixamo_joints.mjs). The camera is scripted (no user control) and every overlay is driven from the show's
// clock, so a recording frame by frame shows what plays live. This page (/lineup.html) is the prototype; the game takes
// it in as the pre-match clip. One look per player from the match roster (roster.ts), the same as in every clip.

export interface LineupTag { tag: string; value: string; tag_en?: string; value_en?: string }
export interface LineupPlayer { pid: string | null; shirt: number; place: number; position: string; side: string; pos_zh: string; pos_en?: string; nat?: string | null; tags?: LineupTag[] }
export interface LineupFile { home: { formation: string; players: LineupPlayer[] }; away: { formation: string; players: LineupPlayer[] } }
interface Anim { name: string; fps: number; frames: number; names: string[]; data: number[] }
type Side = 'home' | 'away';

const FPS = 25;
/** the home 4-2-3-1 by formation place, metres, attacking +x; narrower than in play (as line-ups are staged), the
 *  wingers up level with the striker as a front three; all but the keeper 3 m further back than in the one-team
 *  version, so with both teams out the two front lines stand outside the centre circle, not nose to nose. The y here is
 *  the team's left (+) and right (-); on the pitch a team attacking +x has its right at +y (the near side from the main
 *  stand, checked against the kick-off's tracking, 2026-10-24: until then the staged line-up stood mirrored, the right
 *  back on the left), so spot() turns it over */
const PLACE: Record<number, [number, number]> = {
  1: [-46, 0], 2: [-36, -13.5], 5: [-38.5, -5], 6: [-38.5, 5], 3: [-36, 13.5], 8: [-26.5, -5], 4: [-26.5, 5], 10: [-18, 0], 7: [-10.5, -9], 9: [-7.5, 0], 11: [-10.5, 9],
};
/** a player's spot on the pitch: the home team as above (its right at +y), the away team the same turned half round the
 *  centre spot (attacking -x, its right at -y) */
const spot = (side: Side, place: number): [number, number] => { const [x, y] = PLACE[place] ?? [0, 0]; return side === 'home' ? [x, -y] : [-x, y]; };
/** who does what: the keeper squares up, the rest a mix, never two neighbours alike; the boxer's warm-up on one man only
 *  (Yi, 2026-10-23: on more it makes the team look like it wants a fight). The right winger had Mixamo's taunt, which
 *  holds both fists forward through its whole loop (measured, 100% of frames); Yi chose happy idle over warrior idle
 *  for him (2026-10-23) */
const MOVE: Record<number, string> = {
  1: 'warrior-idle', 2: 'offensive-idle', 5: 'orc-idle', 6: 'warrior-idle', 3: 'happy-idle', 8: 'orc-idle', 4: 'offensive-idle',
  10: 'happy-idle', 7: 'happy-idle', 9: 'offensive-idle', 11: 'warming-up',
};
/** the away team's: a different mix, still no neighbours alike, and no boxer (the home left winger is the only one) */
const MOVE_AWAY: Record<number, string> = {
  1: 'warrior-idle', 2: 'happy-idle', 5: 'offensive-idle', 6: 'orc-idle', 3: 'offensive-idle', 8: 'happy-idle', 4: 'warrior-idle',
  10: 'offensive-idle', 7: 'orc-idle', 9: 'happy-idle', 11: 'offensive-idle',
};
const GROUPS: { title: string; places: number[] }[] = [
  { title: tr('门将', 'Goalkeeper'), places: [1] }, { title: tr('后卫', 'Defence'), places: [2, 5, 6, 3] }, { title: tr('中场', 'Midfield'), places: [8, 4, 10] }, { title: tr('锋线', 'Attack'), places: [7, 9, 11] },
];
/** the home players in the order they are shown, line by line */
const ORDER = GROUPS.flatMap((g, group) => g.places.map((place) => ({ place, group })));
/** the away team's lines for its tracks, the keeper with his back four */
const AWAY_GROUPS: { title: string; places: number[] }[] = [
  { title: tr('后卫', 'Defence'), places: [1, 2, 5, 6, 3] }, { title: tr('中场', 'Midfield'), places: [8, 4, 10] }, { title: tr('锋线', 'Attack'), places: [7, 9, 11] },
];

type V3 = [number, number, number];
interface Cam { pos: V3; look: V3; fov: number; up?: V3; roll?: number }
type Kind = 'title' | 'board' | 'swoop' | 'step' | 'line' | 'hold' | 'cross' | 'tmove' | 'track' | 'final' | 'scan' | 'end';
/** i: the player (into ORDER) a hold shows or a move goes to; for the away part the line (into AWAY_GROUPS) */
interface Beat { t0: number; t1: number; kind: Kind; i?: number; cam: (u: number) => Cam }

const DEG = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (u: number) => u * u * (3 - 2 * u);
const inOut3 = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const inOutSine = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * u);
/** in and out, but slow to start: the speed builds gradually and peaks late (about 0.7 of the way), then settles */
const slowIn = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(u) ** 1.7);
const outExpo = (u: number) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u));
/** 0 before a, 1 after b, smooth between */
const ramp = (t: number, a: number, b: number) => ease(clamp01((t - a) / (b - a)));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: V3, b: V3, u: number): V3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
/** a quadratic curve from a through the pull of q to b */
const curve3 = (a: V3, q: V3, b: V3, e: number) => lerp3(lerp3(a, q, e), lerp3(q, b, e), e);
/** the camera's up turning from one direction to another (the board's flat frame to upright and back) */
const turnUp = (a: V3, b: V3, e: number): V3 => { const v = new THREE.Vector3(...lerp3(a, b, e)).normalize(); return [v.x, v.y, v.z]; };

/** the hero framing of home player i at u through his hold: low (below his chest, looking up a little), off his front by
 *  turns to one side and the other, him on the left third (the card takes the right), pushing slowly in */
function hero(i: number, u: number): Cam {
  const [x0, y0] = PLACE[ORDER[i].place], sgn = i % 2 ? -1 : 1, e = ease(u);
  const th = sgn * (18 - 6 * e) * DEG, d = 5.6 - 1.0 * e, h = 0.7 + 0.12 * e;
  const C: V3 = [x0 + d * Math.cos(th), h, y0 + d * Math.sin(th)];
  // aim to the camera's right of him (forward x up), so he sits a third in from the left
  const fx = x0 - C[0], fz = y0 - C[2], n = Math.hypot(fx, fz), k = 0.17 * d;
  return { pos: C, look: [x0 - (fz / n) * k, 1.0, y0 + (fx / n) * k], fov: 30 };
}

/** a quick move between two framings: fast away, a long settle; along a line a short whip with a little lift and lean,
 *  between lines a rise and a pull back so the next line comes into view */
function travel(a: Cam, b: Cam, u: number, line: boolean): Cam {
  const w = u ** 0.8, e = inOut3(w), el = inOut3(Math.min(1, w * 1.12)), arc = Math.sin(Math.PI * e);
  const pos = lerp3(a.pos, b.pos, e);
  pos[0] += arc * (line ? 6 : 1.4); pos[1] += arc * (line ? 3.4 : 0.5);
  return { pos, look: lerp3(a.look, b.look, el), fov: lerp(a.fov, b.fov, e) + arc * (line ? 12 : 6), roll: line ? 0 : arc * 2.5 * DEG * Math.sign(b.pos[2] - a.pos[2]) };
}

/** an away line's shot at u (Yi, 2026-10-24: a camera tracking sideways along the line was dizzying to read, even
 *  slowed down): the whole line in one still frame, from in front of it and above, pushing in only PUSH metres. Back
 *  far enough that every man of the line stands within the middle FILL of the frame's width (his plate is centred on
 *  him, so it stays on the screen; reckoned at 16:9, on his distance with the camera's height), and at least NEAR in
 *  front of the line's front man. Per line its height: the back line's camera high enough that the midfield, which it
 *  stands over, is under the frame (lower, the unnamed midfielders filled the front of it), and looking AHEAD metres
 *  past the line's middle, towards the keeper, so the line sits low in the frame and the midfield's heads stay out */
const TRACK_H = [18, 8, 7], AHEAD = [8, 0, 0], TRACK_FOV = 38, FILL = 0.68, NEAR = 12, PUSH = 1.5;
/** the plates on a line's frame come in LINE_STAGGER apart */
const LINE_STAGGER = 0.12;
function track(g: number, u: number): Cam {
  const pts = AWAY_GROUPS[g].places.map((p) => spot('away', p)), xs = pts.map((p) => p[0]);
  const front = Math.min(...xs), mid = xs.reduce((a, b) => a + b, 0) / xs.length, hx = Math.tan((TRACK_FOV / 2) * DEG) * (16 / 9) * FILL;
  const H = TRACK_H[g], x = Math.min(front - NEAR, ...pts.map(([px, pz]) => px - Math.sqrt(Math.max(0, (Math.abs(pz) / hx) ** 2 - H * H)))) + PUSH * inOutSine(u);
  return { pos: [x, H, 0], look: [mid + AHEAD[g], 1.2, 0], fov: TRACK_FOV };
}

/** the opening (Yi, 2026-10-25: show off the stadium): T_AERIAL s from outside, as the drone sees it, the title over
 *  it; then T_RISE s straight over the roof and down into the home board, tipping to look straight down (Yi, the same
 *  evening: no stop over the whole stadium on the way, "so the beginning can be more compact"). The rise leaves the drone
 *  shot slowly and gathers speed (Yi, 2026-10-26: it set off too fast): slowIn over 2.6 s (it was inOut3 over 2 s) */
const T_AERIAL = 2.0, T_RISE = 2.6, T_TITLE = T_AERIAL + T_RISE;
/** the drone shot (Yi, 2026-10-25: the first one, square on to the main stand, read too flat, "too 正"; of three angled
 *  ones he chose this, from the far corner with a longer lens, as framed; pulled back with the title low, he kept this).
 *  It turns from yaw0 to yaw1 and pushes in from dist0 to dist1 */
const DRONE = { dist0: 330, dist1: 300, pitch: 0.36, fov: 25, look: 6, yaw0: -0.80, yaw1: -0.64 };
const T_BOARD = 6.0, T_SWOOP = 2.4, T_HOLD = 2.7, T_STEP = 0.75, T_LINE = 1.5;
const T_CROSS = 2.8, T_TMOVE = 1.0, T_TRACK = [5.5, 4.5, 4.5], T_FINAL = 5.5, T_SCAN = 3.2, T_END = 0.8;
/** the board: both teams' formations on one board over the whole pitch, straight down with the frame's top towards -z
 *  (Yi, 2026-10-26: one board for both right after the drone shot, then the home players, then the away lines; until
 *  then a board over each half, the away one before its lines). The camera comes down from BOARD_H0 to BOARD_H1 m through
 *  the shot, high enough for both halves and the plates over the rings at 16:9, the frame BOARD_UP m off the middle
 *  towards its top */
const board = (h: number): Cam => ({ pos: [0, h, 0.01 - BOARD_UP], look: [0, 0, -BOARD_UP], fov: 40, up: [0, 0, -1] });
const BOARD_H0 = 89, BOARD_H1 = 87, BOARD_UP = 1.5;
/** the grass turning over into the board and back (Yi, 2026-10-24: "the hexagon is switching too fast"): the wave runs
 *  from the centre spot BOARD_REACH m, just past the pitch's corners, in FLIP_IN s and back in FLIP_OUT */
const BOARD_REACH = 66, FLIP_IN = 2.0, FLIP_OUT = 1.2;
/** the game's broadcast camera on the kick-off clip's first frame: the show ends exactly there, so the game takes over
 *  on the same picture. It sits in the main stand, which is cut away while the camera is beyond the near touchline, as
 *  the game does (Director's clipPlane). Filled in by broadcastPose once the kick-off is loaded (these are its values at
 *  1600 x 900) */
const BROADCAST: Cam = { pos: [0, 24, 60], look: [-3.218, 1.765, 4.365], fov: 28 };
const HY = 34;
/** the hand-off to the real positions (Yi, 2026-10-24): a ring of light spreads from the kick-off spot (he chose it over
 *  the line sweeping left to right, which was 生硬); where it passes, the men are teleported, as in a superhero cartoon
 *  (Yi: no gliding, no trails; "first pure white, then the texture, maybe with particles", for the arrival): a staged
 *  man goes in a little burst of sparks as the ring reaches his staged place; at his real spot sparks gather into a white
 *  figure, which colours in */
const SWEEP = 2.2, RING_MAX = 64;
/** the white figure of a man arriving (Yi, 2026-10-24: the white is for the moment he appears, not when he goes): white
 *  for WHITE_HOLD, then his colours come through over WHITE_FADE */
const WHITE_HOLD = 0.35, WHITE_FADE = 0.7;
/** a man out of sight: far off the pitch, not under it (Yi, 2026-10-24: kit-coloured balls in front of men: under the
 *  pitch the pose sampler lifted the feet back to the grass, so the hidden men left their socks and boots on it) */
const AWAY_X = 1e4;
/** before the kick-off: each real man stands in his pose from the kick-off's first frame as he arrives, the ball where it
 *  is then (just struck), and the game holds that frame a moment before it plays on (Yi, 2026-10-24: a staged warm-up
 *  before the kick, tried in fix4, turned the men to face the wrong way as they set off; he chose this, the freeze on
 *  the kick, over blending the motions) */

function buildBeats(): Beat[] {
  const beats: Beat[] = [];
  let t = 0;
  const add = (len: number, kind: Kind, cam: Beat['cam'], i?: number) => { beats.push({ t0: t, t1: t + len, kind, i, cam }); t += len; };
  // the opening (Yi, 2026-10-25; until then a sweep inside the bowl): the stadium from outside with the title, a slow
  // drone orbit from the main stand's side; then up over the roof to straight down on the whole stadium (the frame's top
  // turning to -z, the boards' way round), and down into the home board
  const drone = (u: number): Cam => {
    const e = inOutSine(u), yaw = lerp(DRONE.yaw0, DRONE.yaw1, e), d = lerp(DRONE.dist0, DRONE.dist1, e), c = Math.cos(DRONE.pitch);
    return { pos: [d * c * Math.sin(yaw), 12 + d * Math.sin(DRONE.pitch), d * c * Math.cos(yaw)], look: [0, DRONE.look, 0], fov: DRONE.fov };
  };
  add(T_TITLE, 'title', (u) => {
    const s = u * T_TITLE;
    if (s < T_AERIAL) return drone(s / T_AERIAL);
    // over the stand's roof (the curve's pull keeps it clear) and onto the board over the whole pitch, the frame turning flat
    const e = slowIn((s - T_AERIAL) / T_RISE), a = drone(1), b = board(BOARD_H0);
    return { pos: curve3(a.pos, [lerp(a.pos[0], b.pos[0], 0.45), Math.max(a.pos[1], 95), lerp(a.pos[2], b.pos[2], 0.5)], b.pos, e), look: lerp3(a.look, b.look, inOut3(Math.min(1, e * 1.1))), fov: lerp(a.fov, b.fov, e), up: turnUp([0, 1, 0], b.up!, e) };
  });
  add(T_BOARD, 'board', (u) => board(lerp(BOARD_H0, BOARD_H1, ease(u))));
  // down from the board to the home keeper: a curve through a point high in front of him, the frame turning upright
  add(T_SWOOP, 'swoop', (u) => {
    const b = hero(0, 0), e = inOut3(u), top = board(BOARD_H1);
    return { pos: curve3(top.pos, [-31, 9, 2], b.pos, e), look: lerp3(top.look, b.look, inOut3(Math.min(1, u * 1.1))), fov: lerp(40, 30, e), up: turnUp(top.up!, [0, 1, 0], e) };
  }, 0);
  ORDER.forEach((o, i) => {
    if (i > 0) { const line = o.group !== ORDER[i - 1].group; add(line ? T_LINE : T_STEP, line ? 'line' : 'step', (u) => travel(hero(i - 1, 1), hero(i, 0), u, line), i); }
    add(T_HOLD, 'hold', (u) => hero(i, u), i);
  });
  // over the halfway line: up from the last home man and across, straight to the away back line's frame (2026-10-26:
  // their formation was on the one board already, so no away board in between)
  add(T_CROSS, 'cross', (u) => {
    const a = hero(ORDER.length - 1, 1), b = track(0, 0), e = inOut3(u);
    return { pos: curve3(a.pos, [lerp(a.pos[0], b.pos[0], 0.5), Math.max(a.pos[1], b.pos[1]) + 10, lerp(a.pos[2], b.pos[2], 0.5) + 6], b.pos, e), look: lerp3(a.look, b.look, inOut3(Math.min(1, u * 1.15))), fov: lerp(a.fov, b.fov, e) };
  }, 0);
  AWAY_GROUPS.forEach((_, g) => {
    if (g > 0) add(T_TMOVE, 'tmove', (u) => {
      const a = track(g - 1, 1), b = track(g, 0), e = inOut3(u ** 0.85), arc = Math.sin(Math.PI * e), pos = lerp3(a.pos, b.pos, e);
      pos[1] += arc * 2.5;
      return { pos, look: lerp3(a.look, b.look, inOut3(Math.min(1, u * 1.15))), fov: lerp(a.fov, b.fov, e) + arc * 8 };
    }, g);
    add(T_TRACK[g], 'track', (u) => track(g, u), g);
  });
  // up and back to the broadcast camera over both teams, then held through the scan and the score bug's build
  add(T_FINAL, 'final', (u) => { const e = inOut3(Math.min(1, u * 1.25)), a = track(AWAY_GROUPS.length - 1, 1); return { pos: lerp3(a.pos, BROADCAST.pos, e), look: lerp3(a.look, BROADCAST.look, e), fov: lerp(a.fov, BROADCAST.fov, e) }; });
  add(T_SCAN, 'scan', () => BROADCAST);
  add(T_END, 'end', () => BROADCAST);
  return beats;
}
const BEATS = buildBeats();
const LENGTH = BEATS[BEATS.length - 1].t1;
export const beatAt = (t: number) => BEATS.find((b) => t >= b.t0 && t < b.t1) ?? BEATS[BEATS.length - 1];
const beatOf = (kind: Kind, i?: number) => BEATS.find((b) => b.kind === kind && (i === undefined || b.i === i))!;
const HOLDS = ORDER.map((_, i) => beatOf('hold', i));
/** each home line's span: from the move that brings it in (the swoop for the keeper) to the end of its last hold */
const LINES = GROUPS.map((_, g) => {
  const first = ORDER.findIndex((o) => o.group === g), last = ORDER.length - 1 - [...ORDER].reverse().findIndex((o) => o.group === g);
  const entry = first === 0 ? beatOf('swoop') : BEATS.find((b) => b.kind === 'line' && b.i === first)!;
  return { entry, t1: HOLDS[last].t1 };
});
/** each away line's span: from the move that brings the camera to it (the cross for the back line) to its track's end */
const ALINES = AWAY_GROUPS.map((_, g) => ({ entry: g === 0 ? beatOf('cross') : beatOf('tmove', g), track: beatOf('track', g) }));

/** the broadcast camera as the game's camera/Director.tsx broadcast() places it when it snaps to a clip's first frame:
 *  the head in the main stand over the halfway line, turned and zoomed onto the shot broadcastFrame.ts wants there (the
 *  same solve). In the game the show is handed the camera's own pose instead */
function broadcastPose(ko: Loaded, aspect: number): Cam | null {
  const J = ko.joints, b = ballAt(ko.pkg, 0), mid = J ? J.names.indexOf('midHip') : -1;
  if (!J || !b || mid < 0) return null;
  const bodies = Array.from({ length: J.players }, (_, p) => ({ x: J.data[(p * J.names.length + mid) * 3], y: 1, z: J.data[(p * J.names.length + mid) * 3 + 1] })).filter((h) => !Number.isNaN(h.x));
  const { aim } = broadcastShot({ ball: [b[0], b[1], b[2] ?? 0], vel: [0, 0], bodies, nAtt: ko.pkg.frames[0]?.att.length ?? 11, dirAtt: 1, side: 0, tier: 0, aspect });
  const { f } = axes(aim.yaw, aim.pitch);
  return { pos: [HEAD.x, HEAD.y, HEAD.z], look: [HEAD.x + f.x * 60, HEAD.y + f.y * 60, HEAD.z + f.z * 60], fov: THREE.MathUtils.radToDeg(2 * Math.atan(aim.w / aspect)) };
}

/** the wave's progress at t, 0 to 1 over SWEEP from the scan's start, eased in and out (null outside it) */
const waveAt = (t: number) => { const b = beatOf('scan'); return t < b.t0 || t > b.t0 + SWEEP ? null : 0.5 - 0.5 * Math.cos(Math.PI * (t - b.t0) / SWEEP); };
/** when the ring reaches a point of the pitch (x, y), by its distance from the kick-off spot */
const reachAt = (x: number, y: number) => beatOf('scan').t0 + (SWEEP * Math.acos(1 - 2 * clamp01(Math.hypot(x, y) / RING_MAX))) / Math.PI;

/** a player in the show: his team, his line-up entry */
interface Man { side: Side; pl: LineupPlayer }

/** a real player at the kick-off (the kick-off clip's first frame): his pose in the animations' joint order and where
 *  he stands (his mid hip, pitch x and y) */
interface Real { pose: Float32Array; x: number; y: number }

/** the real players from the kick-off clip's first frame by tracking id, their joints mapped to the animations' names */
function realOf(ko: Loaded, names: string[]): Map<string, Real> {
  const J = ko.joints, players = (ko.pkg as unknown as { players?: { pid: string; home: boolean }[] }).players, out = new Map<string, Real>();
  if (!J || !players || players.length !== J.players) return out;
  const map = names.map((n) => J.names.indexOf(n)), hip = names.indexOf('midHip');
  if (map.some((i) => i < 0) || hip < 0) return out;
  players.forEach((pl, i) => {
    const pose = new Float32Array(names.length * 3);
    map.forEach((jj, j) => { for (let c = 0; c < 3; c++) pose[j * 3 + c] = J.data[(i * J.names.length + jj) * 3 + c]; });
    if (!Number.isNaN(pose[hip * 3])) out.set(pl.pid, { pose, x: pose[hip * 3], y: pose[hip * 3 + 1] });
  });
  return out;
}

/** the officials at the kick-off (those the tracking has in its first frame: the referee and one assistant; the other
 *  assistant comes in later, as in the game), each there in his first pose from when the ring reaches him (teleported in
 *  like the men); also each one's pose and spot, for his white figure and sparks */
function officialsOf(ko: Loaded, names: string[]): { J: Joints; who: Real[] } | null {
  const O = ko.officials?.joints;
  if (!O) return null;
  const map = names.map((n) => O.names.indexOf(n)), nO = O.names.length;
  if (map.some((i) => i < 0)) return null;
  const who = Array.from({ length: O.players }, (_, k) => k).filter((k) => map.every((jj) => !Number.isNaN(O.data[(k * nO + jj) * 3])));
  if (!who.length) return null;
  const nJ = names.length, F = Math.ceil(LENGTH * FPS) + 1, P = who.length, data = new Float32Array(F * P * nJ * 3);
  who.forEach((k, p) => {
    let x = 0, y = 0;
    map.forEach((jj) => { x += O.data[(k * nO + jj) * 3]; y += O.data[(k * nO + jj) * 3 + 1]; });
    const from = reachAt(x / nJ, y / nJ);
    for (let f = 0; f < F; f++) {
      const on = f / FPS >= from;
      map.forEach((jj, j) => {
        const o = ((f * P + p) * nJ + j) * 3, i = (k * nO + jj) * 3;
        data[o] = on ? O.data[i] : O.data[i] + AWAY_X; data[o + 1] = O.data[i + 1]; data[o + 2] = O.data[i + 2];
      });
    }
  });
  const real: Real[] = who.map((k) => {
    const pose = new Float32Array(nJ * 3);
    map.forEach((jj, j) => { for (let c = 0; c < 3; c++) pose[j * 3 + c] = O.data[(k * nO + jj) * 3 + c]; });
    let x = 0, y = 0;
    for (let j = 0; j < nJ; j++) { x += pose[j * 3]; y += pose[j * 3 + 1]; }
    return { pose, x: x / nJ, y: y / nJ };
  });
  return { J: { fps: FPS, frames: F, players: P, nAtt: P, names, data, flip: [1, 1] }, who: real };
}

/** what the scene draws, in the joints' order: the home team staged, then those of them at the kick-off as they really
 *  stood, then the same for the away team (the home ones in the joints' attacking slots, so they wear the home kit). A
 *  real slot keeps its man, for his look */
interface Slot { side: Side; man: Man; real?: Real }
const slotsOf = (men: Man[], real: Map<string, Real>): Slot[] => (['home', 'away'] as const).flatMap((side) => {
  const own = men.filter((m) => m.side === side);
  return [...own.map((man) => ({ side, man })), ...own.flatMap((man) => { const r = man.pl.pid ? real.get(man.pl.pid) : undefined; return r ? [{ side, man, real: r }] : []; })];
});

/** every slot's joints through the show. A staged man plays his warm-up animation at his staged place, facing the way
 *  his team attacks (home +x, away -x), looping from his own phase, until the ring reaches his place (when he has a real
 *  self); a real man stands in his kick-off pose from when the ring reaches his real spot. Out of sight is under the
 *  pitch */
function joinMoves(slots: Slot[], anims: Record<string, Anim>): Joints {
  // one frame past the end: the show holds its last frame at LENGTH, and poseAt draws nothing past the joints' last frame
  const P = slots.length, names = Object.values(anims)[0].names, nJ = names.length, F = Math.ceil(LENGTH * FPS) + 1, data = new Float32Array(F * P * nJ * 3);
  const swapped = new Set(slots.filter((s) => s.real).map((s) => s.man));
  slots.forEach((sl, p) => {
    if (sl.real) {
      const r = sl.real, from = reachAt(r.x, r.y);
      for (let f = 0; f < F; f++) {
        const o = (f * P + p) * nJ * 3;
        data.set(r.pose, o);
        if (f / FPS < from) for (let j = 0; j < nJ; j++) data[o + j * 3] += AWAY_X;
      }
      return;
    }
    const { side, pl } = sl.man;
    const a = anims[(side === 'home' ? MOVE : MOVE_AWAY)[pl.place] ?? 'offensive-idle'], [x0, y0] = spot(side, pl.place), k = side === 'home' ? 1 : -1;
    const phase = Math.floor(((pl.shirt * 37 + (side === 'home' ? 0 : 53)) % 100) / 100 * a.frames), gone = swapped.has(sl.man) ? reachAt(x0, y0) : Infinity;
    for (let f = 0; f < F; f++) {
      const s0 = ((f + phase) % a.frames) * nJ, off = f / FPS >= gone;
      for (let j = 0; j < nJ; j++) {
        const s = (s0 + j) * 3, o = ((f * P + p) * nJ + j) * 3;
        // the animation faces +y; turned to face +x: (x, y) -> (y, -x), or -x: (x, y) -> (-y, x); gone, far off the pitch
        data[o] = x0 + k * a.data[s + 1] + (off ? AWAY_X : 0); data[o + 1] = y0 - k * a.data[s]; data[o + 2] = a.data[s + 2];
      }
    }
  });
  return { fps: FPS, frames: F, players: P, nAtt: slots.filter((s) => s.side === 'home').length, names, data, flip: [1, 1] };
}

/** one figure drawn pure white over a man (Players' unlit silhouette, he counted as home so it is white whatever his
 *  team), for a short window round a moment: its own joints for just that window, played on its own clock, its
 *  opacity from a curve of the show's time. A little in front of him (polygon offset), so it covers his colours */
interface FlashSpec { J: Joints; t0: number; curve: (t: number) => number }
function Flash({ clock, spec }: { clock: Clock; spec: FlashSpec }) {
  const g = useRef<THREE.Group>(null);
  const local = useMemo<Clock>(() => ({ t: 0, playing: false, rate: 1 }), []);
  const len = (spec.J.frames - 1) / FPS;
  useFrame(() => {
    const o = spec.curve(clock.t);
    local.t = Math.min(len, Math.max(0, clock.t - spec.t0));
    if (!g.current) return;
    g.current.visible = o > 0.003;
    if (!g.current.visible) return;
    g.current.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[]) {
        if (!mat.transparent) { mat.transparent = true; mat.depthWrite = false; mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4; mat.needsUpdate = true; }
        mat.opacity = o;
      }
    });
  });
  return <group ref={g} visible={false}><Players J={spec.J} clock={local} style="silhouette" lod={false} attacking="home" /></group>;
}

/** the white figures: each real man (and official) white as he appears, colouring in. His pose is held, so his joints
 *  are two equal frames (the pose sampler wants two to blend between) */
function flashesOf(slots: Slot[], officials: Real[], anims: Record<string, Anim>): FlashSpec[] {
  const names = Object.values(anims)[0].names, nJ = names.length;
  const held = (pose: Float32Array): Joints => { const data = new Float32Array(2 * nJ * 3); data.set(pose, 0); data.set(pose, nJ * 3); return { fps: FPS, frames: 2, players: 1, nAtt: 1, names, data, flip: [1, 1] }; };
  const out: FlashSpec[] = [];
  const appear = (r: Real) => { const at = reachAt(r.x, r.y); out.push({ J: held(r.pose), t0: at, curve: (t) => (t < at ? 0 : t < at + WHITE_HOLD ? 1 : 1 - ease(clamp01((t - at - WHITE_HOLD) / WHITE_FADE))) }); };
  for (const sl of slots) if (sl.real) appear(sl.real);
  officials.forEach(appear);
  return out;
}

/** the sparks: as a staged man goes, a small burst from his body outwards and up (he is simply gone in it); before a real
 *  man appears, sparks drawn in from round him onto his body, arriving as his white figure does. Each spark flies from a to b over [t0, t1] (eased out for a burst,
 *  in for a gathering), and dies away (a burst) or glows up (a gathering) on the way; all of them in one set of points,
 *  moved by the show's time in the shader, so a recording frame by frame shows what plays live */
function Sparks({ clock, slots, officials }: { clock: Clock; slots: Slot[]; officials: Real[] }) {
  const { geo, mat } = useMemo(() => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const A: number[] = [], B: number[] = [], T: number[] = [];
    // a point of a body standing at pitch (x, y): within 0.3 m of his axis, up to 1.85 m (pitch y is the scene's z)
    const body = (x: number, y: number) => { const a = rnd() * Math.PI * 2, r = 0.3 * Math.sqrt(rnd()); return [x + r * Math.cos(a), 0.1 + 1.75 * rnd(), y + r * Math.sin(a)]; };
    // seen from the broadcast camera 60 m off, so the sparks are big (20-30 cm) and many, or they would be under a pixel
    const N = 70;
    const gather = (x: number, y: number) => {
      const at = reachAt(x, y);
      for (let k = 0; k < N; k++) {
        // drawn in from 0.8-1.8 m round him over the last 0.3 s, so they come with the ring, not ahead of it
        const end = body(x, y), a = rnd() * Math.PI * 2, r = 0.8 + 1.0 * rnd();
        A.push(end[0] + r * Math.cos(a), end[1] + (rnd() - 0.3) * 1.0, end[2] + r * Math.sin(a)); B.push(...end); T.push(at - 0.3 - 0.08 * rnd(), at, 1);
      }
    };
    const burst = (x: number, y: number) => {
      const at = reachAt(x, y);
      for (let k = 0; k < N * 0.6; k++) {
        const st = body(x, y), dx = st[0] - x, dz = st[2] - y, d = Math.hypot(dx, dz) || 1, v = 1.2 + 1.6 * rnd(), life = 0.55 + 0.35 * rnd();
        A.push(...st); B.push(st[0] + (dx / d) * v * life * 1.6, st[1] + (0.6 + 1.2 * rnd()) * life, st[2] + (dz / d) * v * life * 1.6); T.push(at, at + life, 0);
      }
    };
    const swapped = new Set(slots.filter((s) => s.real).map((s) => s.man));
    for (const sl of slots) {
      if (sl.real) gather(sl.real.x, sl.real.y);
      else if (swapped.has(sl.man)) { const [x0, y0] = spot(sl.side, sl.man.pl.place); burst(x0, y0); }
    }
    for (const o of officials) gather(o.x, o.y);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(A, 3));
    geo.setAttribute('aB', new THREE.Float32BufferAttribute(B, 3));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(T, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uScale: { value: 600 } },
      vertexShader: `uniform float uTime; uniform float uScale; attribute vec3 aB; attribute vec3 aT; varying float vA;
        void main() {
          float u = clamp((uTime - aT.x) / (aT.y - aT.x), 0.0, 1.0), on = step(aT.x, uTime) * step(uTime, aT.y);
          float e = aT.z > 0.5 ? u * u * u : 1.0 - pow(1.0 - u, 3.0);
          vec4 mv = modelViewMatrix * vec4(mix(position, aB, e), 1.0);
          vA = on * (aT.z > 0.5 ? smoothstep(0.0, 0.35, u) : 1.0 - u);
          gl_PointSize = on * uScale * (aT.z > 0.5 ? 0.18 + 0.1 * u : 0.3 * (1.0 - 0.5 * u)) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: 'varying float vA; void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.85, 0.96, 1.0) * a * a * vA * 1.8, 1.0); }',
    });
    return { geo, mat };
  }, [slots, officials]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const { size } = useThree();
  useFrame(() => { mat.uniforms.uTime.value = clock.t; mat.uniforms.uScale.value = size.height * 0.9; });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/** the wave: a ring of light on the grass spreading from the kick-off spot, a low curtain on its edge, eased in and
 *  out, fading at its end */
/** the boards as a tactics board (Yi, 2026-10-24: the hexagons turning the grass dark only to look at the men from above
 *  were "a little meaningless"; the flip is the game's own way into tactics mode, so the board now does what a tactics
 *  board does): once the grass has turned, a ring at each man's feet in his team's colour, then each line of the
 *  formation (GROUPS: the back four, the midfield, the front three) drawn man to man across the pitch, back to front;
 *  gone before the grass turns back. Times from the board's start (RINGS_AT, LINES_AT, a line every LINE_EVERY, each
 *  drawn over LINE_DRAW) and to its end (GONE) */
const TEAM_HEX: Record<Side, string> = { home: '#3987e5', away: '#d95926' };   // tokens.css --home, --away
const RING_R = 1.1, RING_W = 0.16, LINK_W = 0.16, RINGS_AT = 1.7, LINES_AT = 2.0, LINE_EVERY = 0.24, LINE_DRAW = 0.55, GONE = 1.7;   // (lines every 0.24 s, was 0.3: the boards a second shorter, Yi 2026-10-25)
function TacticsBoard({ clock }: { clock: Clock }) {
  const parts = useMemo(() => (['home', 'away'] as const).map((side) => {
    const units = GROUPS.map((g) => [...g.places].sort((a, b) => spot(side, a)[1] - spot(side, b)[1]).map((p) => spot(side, p)));
    // one strip per line, a quad per gap between neighbours from ring edge to ring edge; aT runs 0 to 1 along the line
    const lines = units.filter((u) => u.length > 1).map((pts) => {
      const segs = pts.slice(1).map((b, k) => {
        const a = pts[k], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
        return { a: [a[0] + ux * RING_R, a[1] + uy * RING_R], b: [b[0] - ux * RING_R, b[1] - uy * RING_R], n: [-uy * LINK_W / 2, ux * LINK_W / 2], len: L - 2 * RING_R };
      });
      const total = segs.reduce((s, g) => s + g.len, 0), pos: number[] = [], at: number[] = [], idx: number[] = [];
      let run = 0;
      segs.forEach((g, k) => {
        const t0 = run / total, t1 = (run + g.len) / total;
        for (const [p, t] of [[g.a, t0], [g.b, t1]] as const) for (const s of [1, -1]) { pos.push(p[0] + s * g.n[0], 0.035, p[1] + s * g.n[1]); at.push(t); }
        idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2);
        run += g.len;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1)); geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, uniforms: { uP: { value: 0 }, uO: { value: 0 }, uC: { value: new THREE.Color(TEAM_HEX[side]) } },
        vertexShader: 'attribute float aT; varying float vT; void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uP, uO; uniform vec3 uC; varying float vT; void main() { if (vT > uP) discard; gl_FragColor = vec4(uC, uO * 0.95);\n#include <colorspace_fragment>\n}',
      });
      return { geo, mat };
    });
    const ring = new THREE.RingGeometry(RING_R - RING_W / 2, RING_R + RING_W / 2, 48).rotateX(-Math.PI / 2);
    const rings = units.flat().map((p) => ({ p, mat: new THREE.MeshBasicMaterial({ color: TEAM_HEX[side], transparent: true, opacity: 0, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }) }));
    return { side, lines, ring, rings };
  }), []);
  useEffect(() => () => parts.forEach((s) => { s.ring.dispose(); s.lines.forEach((l) => { l.geo.dispose(); l.mat.dispose(); }); s.rings.forEach((r) => r.mat.dispose()); }), [parts]);
  const groups = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const t = clock.t;
    parts.forEach((s, i) => {
      const bd = beatOf('board'), g = groups.current[i], gone = 1 - ramp(t, bd.t1 - GONE, bd.t1 - GONE + 0.3);
      if (g) g.visible = t >= bd.t0 + RINGS_AT && t < bd.t1 - GONE + 0.3;
      s.rings.forEach((r, k) => { r.mat.opacity = 0.95 * ramp(t, bd.t0 + RINGS_AT + k * 0.03, bd.t0 + RINGS_AT + k * 0.03 + 0.3) * gone; });
      g?.children.forEach((m, k) => { if (k < s.rings.length) { const u = ramp(t, bd.t0 + RINGS_AT + k * 0.03, bd.t0 + RINGS_AT + k * 0.03 + 0.3); m.scale.setScalar(0.6 + 0.4 * u); } });
      s.lines.forEach((l, k) => { const a = bd.t0 + LINES_AT + k * LINE_EVERY; l.mat.uniforms.uP.value = ramp(t, a, a + LINE_DRAW) * 1.0001; l.mat.uniforms.uO.value = gone; });
    });
  });
  return (
    <>
      {parts.map((s, i) => (
        <group key={s.side} ref={(el) => { groups.current[i] = el; }} visible={false}>
          {s.rings.map((r, k) => <mesh key={k} geometry={s.ring} material={r.mat} position={[r.p[0], 0.035, r.p[1]]} />)}
          {s.lines.map((l, k) => <mesh key={`l${k}`} geometry={l.geo} material={l.mat} />)}
        </group>
      ))}
    </>
  );
}

function Scan({ clock }: { clock: Clock }) {
  const ring = useRef<THREE.Group>(null);
  const mats = useMemo(() => {
    const make = (frag: string, extra: Record<string, THREE.IUniform> = {}) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uO: { value: 0 }, ...extra },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uO; varying vec2 vUv; varying vec3 vW; ${Object.keys(extra).map((k) => `uniform float ${k};`).join(' ')} void main() { ${frag} }`,
    });
    const tint = 'vec3(0.66, 0.9, 1.0)';
    return {
      // on the grass: a bright front edge at radius uR, a soft glow trailing inside it
      floor: make(`float d = length(vW.xz); float a = smoothstep(uR + 0.5, uR, d) * (exp(-(uR - d) * 0.35) * 0.55 + smoothstep(uR - 1.2, uR, d) * 0.6); gl_FragColor = vec4(${tint} * a * uO, 1.0);`, { uR: { value: 0 } }),
      // the curtain on the edge (an open cylinder): brightest at the grass, gone by 2 m
      wall: make(`float a = pow(1.0 - vUv.y, 2.4) * 0.8; gl_FragColor = vec4(${tint} * a * uO, 1.0);`),
    };
  }, []);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useFrame(() => {
    const v = waveAt(clock.t), b = beatOf('scan'), o = v === null ? 0 : ramp(clock.t, b.t0, b.t0 + 0.2) * (1 - ramp(clock.t, b.t0 + SWEEP - 0.45, b.t0 + SWEEP));
    mats.floor.uniforms.uO.value = o; mats.wall.uniforms.uO.value = o;
    if (!ring.current) return;
    ring.current.visible = o > 0;
    const R = Math.max(0.01, (v ?? 0) * RING_MAX);
    mats.floor.uniforms.uR.value = R;
    ring.current.children[1].scale.set(R, 1, R);
  });
  return (
    <group ref={ring} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={mats.floor}><planeGeometry args={[140, 100]} /></mesh>
      <mesh position={[0, 1, 0]} material={mats.wall}><cylinderGeometry args={[1, 1, 2, 160, 1, true]} /></mesh>
    </group>
  );
}

function Director({ clock, mode, clipPlane, ball, ballAt0, kickoff, onDone, onPrepare, onNearEnd }: { clock: Clock; mode: PitchMode; clipPlane: THREE.Plane; ball: React.RefObject<THREE.Group | null>; ballAt0: [number, number] | null; kickoff: Loaded | null; onDone?: () => void; onPrepare?: () => void; onNearEnd?: () => void }) {
  const done = useRef(false), prepared = useRef(false), near = useRef(false);
  const { camera, size, scene } = useThree();
  // the game's broadcast camera for this window's shape (the show's last frame)
  useEffect(() => { const c = kickoff && broadcastPose(kickoff, size.width / Math.max(1, size.height)); if (c) Object.assign(BROADCAST, c); }, [kickoff, size.width, size.height]);
  const cam = camera as THREE.PerspectiveCamera;
  const gq = useMemo(() => ({ q: new THREE.Quaternion(), f: new THREE.Vector3() }), []);
  useFrame((_, dt) => {
    // in the game, its own camera behind the show once it is there: the show's broadcast shot is that very pose, so
    // the show ends exactly where the game's camera is (Yi, 2026-10-24: the kick-off came in at another camera angle;
    // broadcastPose above is a copy of the game's formula, kept for the page on its own)
    const g = (window as unknown as { __cam?: () => { mode: string | null; pos: number[]; quat?: number[]; fov: number; blend: number } }).__cam?.();
    if (g?.quat && g.mode === 'broadcast' && g.blend >= 1) {
      gq.f.set(0, 0, -1).applyQuaternion(gq.q.fromArray(g.quat)).multiplyScalar(60);
      BROADCAST.pos = [g.pos[0], g.pos[1], g.pos[2]]; BROADCAST.look = [g.pos[0] + gq.f.x, g.pos[1] + gq.f.y, g.pos[2] + gq.f.z]; BROADCAST.fov = g.fov;
    }
    if (clock.playing) {
      const next = clock.t + dt;
      // the end: with a game to take over (onDone), the show holds its last frame and hands over, once; the page on its
      // own plays the show again
      if (next >= LENGTH && onDone) { clock.t = LENGTH - 1e-3; clock.playing = false; if (!done.current) { done.current = true; onDone(); } }
      else clock.t = next % LENGTH;
    }
    // the game gets ready behind the show on the board (a near still shot, where its first frames' stall does not show),
    // early enough that Skip, which waits for it (canSkip), comes soon after the opening (Yi, 2026-10-26: a Skip pressed
    // before the game had started behind the show stalled the hand-off; until then from the away back line's frame on)
    if (onPrepare && !prepared.current && clock.t >= beatOf('board').t0 + 0.3) { prepared.current = true; onPrepare(); }
    // and draws at full size behind it from the score bug's build on
    if (onNearEnd && !near.current && clock.t >= buildAt()) { near.current = true; onNearEnd(); }
    const t = clock.t, b = beatAt(t), c = b.cam((t - b.t0) / (b.t1 - b.t0));
    cam.up.set(...(c.up ?? [0, 1, 0])); cam.position.set(...c.pos); cam.lookAt(...c.look);
    if (c.roll) cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.near = b.kind === 'title' ? 1 : 0.1; cam.updateProjectionMatrix();
    // the board: the grass turns over from the centre spot in the board shot (FLIP_IN) and comes back before the camera
    // goes down to the players (FLIP_OUT)
    const bd = beatOf('board');
    const k = clamp01((t - bd.t0 - 0.2) / FLIP_IN) * clamp01((bd.t1 - 0.3 - t) / FLIP_OUT);
    mode.origin.set(0, 0);
    mode.current = 0.5 - 0.5 * Math.cos(Math.PI * k);
    // the main stand cut away while the camera is beyond the near touchline (the broadcast camera sits in it), as the game
    // does; never from outside or above the bowl (the opening's drone shot)
    clipPlane.constant = cam.position.z > HY - 0.5 && cam.position.z < 80 && cam.position.y < 45 ? HY + 0.1 : 1e5;
    // the night outside while the camera is far out, as the game's drone views have it (stadium/night.ts); back to the
    // night's fog and lights inside
    nightOutside(scene, ramp(cam.position.length(), 90, 160), cam.position.length(), { near: 160, far: 420 });
    // the ball: there once the wave reaches the spot where it is in the kick-off's first frame
    if (ball.current) ball.current.visible = ballAt0 !== null && t >= reachAt(ballAt0[0], ballAt0[1]) && t < LENGTH;
  });
  return null;
}

export interface OverlayRefs {
  plates: (HTMLDivElement | null)[]; cards: (HTMLDivElement | null)[]; lines: (HTMLDivElement | null)[]; alines: (HTMLDivElement | null)[];
  words: (HTMLDivElement | null)[]; crossWord: HTMLDivElement | null;
  title: HTMLDivElement | null; team: HTMLDivElement | null; teamAway: HTMLDivElement | null; bars: (HTMLDivElement | null)[]; scrim: HTMLDivElement | null;
  lock: HTMLDivElement | null; bug: HTMLDivElement | null; skip: HTMLButtonElement | null;
}

/** a block's parts in turn, lt seconds after it starts: each [data-at] element enters data-at seconds in, over 0.55 s,
 *  by its data-fx (num: from the left, a little; rise: up out of its mask; wipe: drawn from the left; left, right: in
 *  from that side; zoom: down from large; else: in from the right with a slight grow) */
function drive(el: HTMLElement, lt: number) {
  el.querySelectorAll<HTMLElement>('[data-at]').forEach((part) => {
    const e = outExpo(clamp01((lt - +part.dataset.at!) / 0.55)), fx = part.dataset.fx;
    part.style.opacity = e.toFixed(3);
    part.style.transform = fx === 'num' ? `translateX(${-(1 - e) * 46}px)` : fx === 'rise' ? `translateY(${(1 - e) * 105}%)` : fx === 'wipe' ? `scaleX(${e})`
      : fx === 'left' ? `translateX(${-(1 - e) * 90}px)` : fx === 'right' ? `translateX(${(1 - e) * 90}px)` : fx === 'zoom' ? `scale(${1 + 0.5 * (1 - e)})`
      : `translateX(${(1 - e) * 36}px) scale(${0.94 + 0.06 * e})`;
  });
}

/** the score bug built where the game has it (Yi, 2026-10-24: the title coming back in the middle and flying to the
 *  corner repeated the opening's banner): during the scan the HUD's own score bug at the top left assembles itself the
 *  way the title did, the glass opening from the left, the home crest and code, the score between the kit strips, the
 *  away code and crest, then the clock cell; lt, seconds into the build. Once it is done every part is handed back to
 *  the HUD's own styles, so the game's bug takes over on the same pixels */
const BUILD: [string, number, string][] = [
  ['.hud-team.home svg', 0.12, 'left'], ['.hud-team.home b', 0.22, 'rise'], ['.hud-strip', 0.3, 'grow'], ['.hud-score b', 0.36, 'zoom'],
  ['.hud-score-sep', 0.42, 'fade'], ['.hud-team.away b', 0.48, 'rise'], ['.hud-team.away svg', 0.56, 'right'], ['.hud-clock', 0.72, 'wipe'],
];
const BUILD_DONE = 0.72 + 0.55;
/** when the bug starts to build: with the ring, as the men are put on their kick-off spots (Yi, 2026-10-24: "make the
 *  scoreboard animate the same time as we place the players to their positions"; it waited for the ring before) */
const BUILD_AT = 0.2;
const buildAt = () => beatOf('scan').t0 + BUILD_AT;
function build(bug: HTMLElement, lt: number) {
  const done = lt >= BUILD_DONE;
  bug.style.clipPath = done ? '' : `inset(0 ${((1 - outExpo(clamp01(lt / 0.6))) * 100).toFixed(2)}% 0 0)`;
  for (const [sel, at, fx] of BUILD) bug.querySelectorAll<HTMLElement>(sel).forEach((el) => {
    if (done) { el.style.opacity = ''; el.style.transform = ''; el.style.clipPath = ''; return; }
    const e = outExpo(clamp01((lt - at) / 0.55));
    el.style.opacity = (fx === 'wipe' ? Math.min(1, e * 3) : e).toFixed(3);
    // the clock cell opens like the glass (clipped, its figures not squeezed)
    el.style.clipPath = fx === 'wipe' ? `inset(0 ${((1 - e) * 100).toFixed(2)}% 0 0)` : '';
    el.style.transform = fx === 'left' ? `translateX(${(-(1 - e) * 24).toFixed(2)}px)` : fx === 'right' ? `translateX(${((1 - e) * 24).toFixed(2)}px)` : fx === 'rise' ? `translateY(${((1 - e) * 60).toFixed(2)}%)`
      : fx === 'grow' ? `scaleY(${e.toFixed(4)})` : fx === 'zoom' ? `scale(${(1 + 0.6 * (1 - e)).toFixed(4)})` : '';
  });
}

/** the overlays, every frame from the show's clock: the name plates over the heads (each board, each away track), the
 *  title, the teams' heads, the letterbox, each line's name (for the home lines a big word as the camera moves to it,
 *  then in the top bar), the away team's name as the camera crosses to it, and each home player's card through his hold
 *  (its parts in turn: data-at is the delay in seconds, data-fx the entrance) */
function Overlays({ clock, men, refs, canSkip }: { clock: Clock; men: Man[]; refs: React.RefObject<OverlayRefs>; canSkip: React.RefObject<boolean> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const R = refs.current, t = clock.t, b = beatAt(t);
    if (!R) return;
    const show = (el: HTMLElement | null, o: number, transform = '') => { if (!el) return; el.style.opacity = o.toFixed(3); el.style.visibility = o > 0.001 ? 'visible' : 'hidden'; el.style.transform = transform; };
    const hb = beatOf('board'), cross = beatOf('cross'), fin = beatOf('final');
    // the plates: on the board both teams' numbers and positions (Yi, 2026-10-23: too short to read names there; the
    // names wait for the home players' own shots and the away lines' frames); on an away track the large plate, number,
    // flag and full name, over the men of that line
    const onBoard = (bd: Beat) => ramp(t, bd.t0 + 1.2, bd.t0 + 1.8) * (1 - ramp(t, bd.t1 - 0.6, bd.t1 - 0.2));
    // on a line's still frame they come in one after another from the left (the screen's left is the pitch's -y there)
    const onLine = (bd: Beat, place: number) => {
      const k = AWAY_GROUPS[bd.i!].places.filter((q) => spot('away', q)[1] < spot('away', place)[1]).length * LINE_STAGGER;
      return ramp(t, bd.t0 + k, bd.t0 + k + 0.35) * (1 - ramp(t, bd.t1 - 0.3, bd.t1));
    };
    men.forEach(({ side, pl }, p) => {
      const el = R.plates[p];
      if (!el) return;
      const o = b.kind === 'board' ? onBoard(hb)
        : b.kind === 'track' && side === 'away' && AWAY_GROUPS[b.i!].places.includes(pl.place) ? onLine(b, pl.place) : 0;
      if (o <= 0) { show(el, 0); return; }
      // above him on the screen with a gap (Yi, 2026-10-23: on the board the plates covered the players; from straight
      // above, a point over his head lands on him): the higher of his feet and his head on screen, 10 px more; on the
      // boards also above the tactics board's ring at his feet (Yi, 2026-10-24: the plates stood on the rings)
      const [x, y] = spot(side, pl.place);
      v.set(x, 0, y).project(camera);
      let fy = v.y;
      if (b.kind === 'board') for (const d of [-1, 1]) { v.set(x, 0, y + d * (RING_R + RING_W)).project(camera); fy = Math.max(fy, v.y); }
      v.set(x, 2.0, y).project(camera);
      const off = v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1;
      // placed by a transform, to the sub-pixel (Yi, 2026-10-24: set by left/top they snapped to whole pixels and the
      // text shook as the camera tracked)
      const px = (v.x * 0.5 + 0.5) * size.width, py = (-Math.max(v.y, fy) * 0.5 + 0.5) * size.height - 10;
      show(el, off ? 0 : o, `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) translate(-50%, -100%)`);
      el.classList.toggle('pos', b.kind === 'board');
      el.classList.toggle('big', b.kind === 'track');
    });
    // the title: the bar opens, the crests come in from their sides, VS between, the names rise; out before the board
    // (2026-10-25: over the drone shot, out as the camera starts up over the roof)
    const titleOn = b.kind === 'title' ? 1 - ramp(t, T_AERIAL + 0.6, T_AERIAL + 1.1) : 0;
    show(R.title, titleOn);
    if (R.title && titleOn > 0) drive(R.title, t);
    // the HUD's own score bug (PEL 0 : 0 WIL, 0:00), built where the game has it while the ring puts the men on their
    // kick-off spots, then held for the game
    const b0 = buildAt(), bug = R.bug?.querySelector<HTMLElement>('.hud-bug');
    if (R.bug) show(R.bug, t >= b0 ? 1 : 0);
    if (bug && t >= b0) build(bug, t - b0);
    // Skip, until the bug builds; only once the game behind the show is ready to take over (canSkip)
    show(R.skip, !canSkip.current ? 0 : b.kind === 'title' ? ramp(t, 1.0, 1.5) : t < b0 - 0.4 ? 1 : 0);
    // the teams' heads on the board: home top left, away top right, together
    const head = (bd: Beat) => ramp(t, bd.t0 + 0.6, bd.t0 + 1.1) * (1 - ramp(t, bd.t1 - 0.4, bd.t1));
    show(R.team, b.kind === 'board' ? head(hb) : 0);
    show(R.teamAway, b.kind === 'board' ? head(hb) : 0);
    // the letterbox: from the swoop through the home players, the cross and the away lines, to the last frame
    const sw = beatOf('swoop');
    const lb = ramp(t, sw.t0, sw.t0 + 0.7) * (1 - ramp(t, fin.t0 + 0.3, fin.t0 + 1.2));
    R.bars.forEach((el, k) => { if (el) el.style.transform = `translateY(${(k ? 1 : -1) * (1 - lb) * 100}%)`; });
    LINES.forEach((ln, g) => {
      // the line's name in the top bar while it is shown
      show(R.lines[g], ramp(t, ln.entry.t0 + 0.4, ln.entry.t0 + 0.8) * (1 - ramp(t, ln.t1, ln.t1 + 0.3)));
      // and big across the screen as the camera goes to it, drifting left
      const u = (t - ln.entry.t0) / (ln.entry.t1 - ln.entry.t0), o = u < 0 || u > 1 ? 0 : ramp(u, 0, 0.22) * (1 - ramp(u, 0.7, 0.98));
      show(R.words[g], o, `translate(-50%, -50%) translateX(${(0.5 - u) * 140}px) scale(${1.06 - 0.06 * ramp(u, 0, 0.5)})`);
    });
    // the away lines' names in the top bar, no big words (the short version)
    ALINES.forEach((ln, g) => show(R.alines[g], ramp(t, ln.entry.t1 - 0.3, ln.entry.t1 + 0.1) * (1 - ramp(t, ln.track.t1 - 0.1, ln.track.t1 + 0.2))));
    // the away team's name, big, as the camera crosses the halfway line to it
    const uc = (t - cross.t0) / (cross.t1 - cross.t0), oc = uc < 0 || uc > 1 ? 0 : ramp(uc, 0.18, 0.4) * (1 - ramp(uc, 0.8, 1));
    show(R.crossWord, oc, `translate(-50%, -50%) translateX(${(0.5 - uc) * 160}px) scale(${1.06 - 0.06 * ramp(uc, 0.18, 0.6)})`);
    let scrim = 0;
    HOLDS.forEach((h, i) => {
      const el = R.cards[i];
      if (!el) return;
      const lt = t - h.t0, out = 1 - ramp(t, h.t1 - 0.15, h.t1 + 0.25);
      const on = lt > -0.05 && t < h.t1 + 0.3;
      show(el, on ? out : 0, `translateY(-50%) translateX(${-(1 - out) * 70}px)`);
      if (!on) return;
      scrim = Math.max(scrim, out * ramp(lt, -0.05, 0.35));
      drive(el, lt);
    });
    // a shade on the right behind the card, so it reads over the stands
    show(R.scrim, scrim);
  });
  return null;
}

/** the show. kickoff: the kick-off clip (loadMoment), for the hand-off at the end (without it the teams stay staged);
 *  onDone: called once when the show has run to its end (the game takes over there, on the same frame; the show then
 *  holds its last frame); onPrepare: called once when the game should get ready behind it
 *  (small); onNearEnd: called once as the score bug starts to build, for the game to draw at full size behind it, so
 *  the switch at the end is on a picture already drawn; handingOver: the game has taken over (no longer used: the
 *  show's picture now fades out with its overlays over the game's held first frame, Yi 2026-10-24, rather than going
 *  at once); embedded: in the game, so the page's window.__setT is the game's (the show's is window.__introSetT) */
export function LineupShow({ lineup, roster = null, kickoff = null, onDone, onPrepare, onNearEnd, embedded = false, canSkip = true }: { lineup: LineupFile; roster?: Roster | null; kickoff?: Loaded | null; onDone?: () => void; onPrepare?: () => void; onNearEnd?: () => void; handingOver?: boolean; embedded?: boolean;
  /** the game behind the show is ready to take over: Skip shows (and Esc works) only then (the page on its own: always) */ canSkip?: boolean }) {
  // both elevens, home first (the joints' attacking slots, so the home kit), then away
  const men = useMemo<Man[]>(() => [...lineup.home.players.map((pl) => ({ side: 'home' as const, pl })), ...lineup.away.players.map((pl) => ({ side: 'away' as const, pl }))], [lineup]);
  const home = lineup.home.players;
  const [anims, setAnims] = useState<Record<string, Anim> | null>(null);
  useEffect(() => {
    const names = [...new Set([...Object.values(MOVE), ...Object.values(MOVE_AWAY)])];
    Promise.all(names.map((n) => fetch(animFile(n)).then((r) => r.json()))).then((xs: Anim[]) => setAnims(Object.fromEntries(names.map((n, i) => [n, xs[i]]))))
      .catch((e) => console.warn('line-up show: a motion failed to load', e));   // the show stays as it is without them
  }, []);
  const hold = useMemo(() => { const q = new URLSearchParams(location.search).get('t'); return q === null ? null : +q; }, []);
  const clock = useMemo<Clock>(() => ({ t: hold ?? 0, playing: hold === null, rate: 1 }), [hold]);
  useEffect(() => {
    const W = window as unknown as Record<string, unknown>;
    W[embedded ? '__introSetT' : '__setT'] = (t: number, play = false) => { clock.playing = play; clock.t = t % LENGTH; };
    W.__length = LENGTH;
  }, [clock, embedded]);
  const mode = useMemo<PitchMode>(() => ({ current: 0, origin: new THREE.Vector2(0, 0), reach: BOARD_REACH }), []);
  // the real players at the kick-off by tracking id, and every slot the scene draws (staged and real)
  const real = useMemo(() => (kickoff && anims ? realOf(kickoff, Object.values(anims)[0].names) : new Map<string, Real>()), [kickoff, anims]);
  const slots = useMemo(() => slotsOf(men, real), [men, real]);
  const J = useMemo(() => (anims ? joinMoves(slots, anims) : null), [anims, slots]);
  // one look per player, the same as in every clip: the match roster's, by tracking id (roster.ts); without a roster,
  // looks from both elevens in place order, the keepers wearing 1
  const looks = useMemo(() => looksFor(men.map((m) => m.pl.pid), roster ? rosterLooks(roster) : null, makeLooks(22, 11, { hair: 1, number: 1, skin: 1 }, [0, 11])), [roster, men]);
  // the scene's looks in slot order: a real man looks as his staged self
  const slotLooks = useMemo(() => slots.map((sl) => looks[men.indexOf(sl.man)]), [slots, looks, men]);
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5), []);
  const stadiumTime = useMemo(() => () => clock.t - LENGTH, [clock]);
  // the officials at the kick-off, dressed and drawn as the game draws them (Stage.tsx)
  const officials = useMemo(() => (kickoff && anims ? officialsOf(kickoff, Object.values(anims)[0].names) : null), [kickoff, anims]);
  const officialJ = officials?.J ?? null, officialReal = useMemo(() => officials?.who ?? [], [officials]);
  // the teleport's white figures (staged men going, real men and officials arriving)
  const flashes = useMemo(() => (anims && kickoff ? flashesOf(slots, officialReal, anims) : []), [slots, officialReal, anims, kickoff]);
  const officialLooks = useMemo(() => makeLooks(3, 3, { hair: 5, number: 5, skin: 5 }).map((l) => ({ ...l, number: -1, name: '', keeper: false })), []);
  const ball = useRef<THREE.Group>(null);
  // the ball as it is in the kick-off's first frame (just struck, 0.8 m off the spot), held there: a ball track of the
  // show's own, standing still
  const b0 = (kickoff?.pkg as unknown as { ball25?: { xyz: ([number, number, number] | null)[] } } | undefined)?.ball25?.xyz[0];
  const ballTrack = useMemo(() => (b0 ? ({ ball25: { fps: FPS, xyz: Array.from({ length: Math.ceil(LENGTH * FPS) + 1 }, () => b0) } } as unknown as Loaded['pkg']) : null), [b0]);
  const ballAt0: [number, number] | null = b0 ? [b0[0], b0[1]] : null;
  // Skip (and Esc): straight to the broadcast picture, the scan and the score bug's build
  const skipOk = useRef(canSkip); skipOk.current = canSkip;
  const skip = () => { if (!skipOk.current) return; clock.t = Math.max(clock.t, beatOf('final').t1 - 1.6); clock.playing = true; onPrepare?.(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // the card's and the large plates' name: the roster's full name (Yi, 2026-10-23: plausible for his nationality),
  // else the shirt's
  const fullNames = useMemo(() => new Map((roster?.players ?? []).map((r) => [r.pid, fullName(r)])), [roster]);
  const nameOf = (m: Man, p: number) => (m.pl.pid && fullNames.get(m.pl.pid)) || looks[p]?.name;
  // his nationality (the flag and the card's second line): the roster's, which goes with his invented name (Yi,
  // 2026-10-23: the squads read like the Premier League's, mostly British), not the real one in lineup.json
  const nats = useMemo(() => new Map((roster?.players ?? []).map((r) => [r.pid, r.nat])), [roster]);
  const natOf = (m: Man) => (m.pl.pid && nats.get(m.pl.pid)) || m.pl.nat || null;
  const refs = useRef<OverlayRefs>({ plates: [], cards: [], lines: [], alines: [], words: [], crossWord: null, title: null, team: null, teamAway: null, bars: [], scrim: null, lock: null, bug: null, skip: null });
  if (!J) return <div className="lu-loading" />;   // (the page's loader stands over it: index.html)
  const formation = { home: lineup.home.formation.split('').join('-'), away: lineup.away.formation.split('').join('-') };
  return (
    <>
      <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 34, position: [0, 60, 60], near: 0.1, far: 3000 }} gl={{ antialias: true }}>
        <color attach="background" args={['#05070b']} />
        <fog attach="fog" args={['#05070b', 160, 420]} />
        <BootFrame />
        <hemisphereLight name="night-amb" args={['#c9d6ff', '#0b120d', 0.55]} />
        <directionalLight name="night-key" position={[-20, 90, 30]} intensity={1.8} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={40} shadow-camera-bottom={-40} />
        <directionalLight name="night-fill" position={[40, 60, -35]} intensity={0.7} />
        <directionalLight name="night-fill" position={[40, 60, 35]} intensity={0.5} />
        <directionalLight name="night-fill" position={[-40, 60, -35]} intensity={0.5} />
        <SkyDome />
        <Pitch glow={0.22} ground mode={mode} />
        <TacticsBoard clock={clock} />
        <Furniture />
        {/* the stadium's clock (the crowd's motion, the boards' banners) reaches the game's at the kick-off as the show
            ends: clip time 0 there (Yi, 2026-10-24: at the hand-off the scene shifted; on render time the stands and
            boards jumped to another state as the game took over) */}
        <ProceduralStadium shell="crystal" clipPlane={clipPlane} time={stadiumTime} />
        {/* the home eleven fill the joints' attacking slots, so with attacking="home" they wear the home kit and the away
            eleven the away kit (Yi, 2026-10-23: each team its own colours) */}
        <Players J={J} clock={clock} style="toon" looks={slotLooks} lod={false} attacking="home" />
        {flashes.map((f, i) => <Flash key={i} clock={clock} spec={f} />)}
        {kickoff && <Sparks clock={clock} slots={slots} officials={officialReal} />}
        <group ref={ball} visible={false}>{ballTrack && <StyledBall pkg={ballTrack} clock={clock} style="modern" />}</group>
        <Scan clock={clock} />
        {officialJ && <Players J={officialJ} clock={clock} style="toon" looks={officialLooks} lod={false} kit="official" />}
        <Director clock={clock} mode={mode} clipPlane={clipPlane} ball={ball} ballAt0={ballAt0} kickoff={kickoff} onDone={onDone} onPrepare={onPrepare} onNearEnd={onNearEnd} />
        <Overlays clock={clock} men={men} refs={refs} canSkip={skipOk} />
        <FrameCounter />
      </Canvas>
      <div className="lu-vignette" />
      <div className="lu-scrim" ref={(el) => { refs.current.scrim = el; }} />
      {/* the overlays, each in its team's colour (--team: home blue, away orange) */}
      <div className="lu-ov">
        {men.map((m, p) => (
          <div key={`${m.side}${m.pl.place}`} ref={(el) => { refs.current.plates[p] = el; }} className={`lu-plate ${m.side}`}>
            <b>{looks[p]?.number}</b><Flag iso={natOf(m)} className="lu-pflag" /><span className="lu-short">{looks[p]?.name}</span><span className="lu-full">{nameOf(m, p)}</span><i>{pick(m.pl.pos_zh, m.pl.pos_en)}</i>
          </div>
        ))}
        <div className="lu-bar top" ref={(el) => { refs.current.bars[0] = el; }}>
          {GROUPS.map((g, k) => <div key={g.title} className="lu-line" ref={(el) => { refs.current.lines[k] = el; }}><b>{g.title}</b><span><Crest team="home" size={20} />{tr(`${TEAM_NAME.home} 首发`, `${TEAM_NAME.home} starting XI`)} · {formation.home}</span></div>)}
          {AWAY_GROUPS.map((g, k) => <div key={g.title} className="lu-line away" ref={(el) => { refs.current.alines[k] = el; }}><b>{g.title}</b><span><Crest team="away" size={20} />{tr(`${TEAM_NAME.away} 首发`, `${TEAM_NAME.away} starting XI`)} · {formation.away}</span></div>)}
        </div>
        <div className="lu-bar bottom" ref={(el) => { refs.current.bars[1] = el; }} />
        {GROUPS.map((g, k) => <div key={g.title} className="lu-word" ref={(el) => { refs.current.words[k] = el; }}>{g.title}</div>)}
        <div className="lu-word away" ref={(el) => { refs.current.crossWord = el; }}>{TEAM_NAME.away}</div>
        {ORDER.map((o, i) => {
          const p = home.findIndex((pl) => pl.place === o.place), pl = home[p], look = looks[p], nat = pl && natOf(men[p]);
          if (!pl || !look) return null;
          // the card: free text over the scene (Yi, 2026-10-23: he prefers it to the HUD's glass card, "more gamified"),
          // the big number in the team's colour, the flag and the name, the position and the nationality, a rule drawn
          // out, then the tags, each a small chip whose glass blurs what is behind it (the boards' lettering)
          return (
            <div key={o.place} className="lu-card" ref={(el) => { refs.current.cards[i] = el; }}>
              <div className="lu-card-top">
                <b className="lu-no" data-at="0" data-fx="num">{look.number}</b>
                <div className="lu-who">
                  <div className="lu-mask"><div className="lu-name" data-at="0.1" data-fx="rise"><Flag iso={nat} className="lu-flag" /><span>{nameOf(men[p], p)}</span></div></div>
                  <div className="lu-mask"><div className="lu-pos" data-at="0.22" data-fx="rise">{pick(pl.pos_zh, pl.pos_en)}{nat ? ` · ${nationName(nat)}` : ''}</div></div>
                </div>
              </div>
              <i className="lu-rule" data-at="0.18" data-fx="wipe" />
              <div className="lu-tags">
                {(pl.tags ?? []).map((tg, k) => <div key={tg.tag} className="lu-tag" data-at={(0.6 + 0.32 * k).toFixed(2)} data-fx="tag"><b>{pick(tg.tag, tg.tag_en)}</b><span>{pick(tg.value, tg.value_en)}</span></div>)}
              </div>
            </div>
          );
        })}
        {/* the title: the score bug's own build, large (Yi chose it, 2026-10-23): a team cell each side (crest outside,
            name inside), and the middle cell, lighter, between the two kit-colour strips; the glass opens from the
            middle, then the crests come in from their sides and the names rise */}
        <div className="lu-title" ref={(el) => { refs.current.title = el; }}>
          <div className="lu-lock" ref={(el) => { refs.current.lock = el; }}>
            <i className="lu-lock-bg" data-at="0.1" data-fx="wipe" />
            {/* each name split where the score bug's code ends (PEL|ICANS), so the rest can fold away as it docks; the
                middle cell's shade a layer of its own; under VS the score, 0 : 0, the score bug's own figures at this size */}
            <span className="lu-lteam home"><span data-at="0.4" data-fx="left"><Crest team="home" size={140} /></span><span className="lu-mask"><b data-at="0.75" data-fx="rise"><span className="lu-code">{codeSplit('home')[0]}</span><span className="lu-rest">{codeSplit('home')[1]}</span></b></span></span>
            <span className="lu-lmid" data-at="0.3" data-fx="wipe"><i className="lu-lmid-bg" /><i className="lu-strip home" /><span className="lu-lscore"><em data-at="0.6" data-fx="zoom">VS</em><span className="lu-zero"><span className="lu-zero-in"><b>0</b><i className="hud-score-sep" /><b>0</b></span></span></span><i className="lu-strip away" /></span>
            <span className="lu-lteam away"><span className="lu-mask"><b data-at="0.9" data-fx="rise"><span className="lu-code">{codeSplit('away')[0]}</span><span className="lu-rest">{codeSplit('away')[1]}</span></b></span><span data-at="0.5" data-fx="right"><Crest team="away" size={140} /></span></span>
          </div>
        </div>
        <div className="lu-team" ref={(el) => { refs.current.team = el; }}><Crest team="home" size={30} /><b>{TEAM_NAME.home}</b><span>{tr('首发', 'Starting XI')} · {formation.home}</span></div>
        <div className="lu-team away" ref={(el) => { refs.current.teamAway = el; }}><Crest team="away" size={30} /><b>{TEAM_NAME.away}</b><span>{tr('首发', 'Starting XI')} · {formation.away}</span></div>
        <button type="button" className="lu-skip" ref={(el) => { refs.current.skip = el; }} onClick={skip}>{tr('跳过', 'Skip')} <span aria-hidden="true">›</span></button>
      </div>
      {/* the HUD's own score bug where the game has it, built there at the end: kick-off, 0 : 0; after the credits' "i",
          as the HUD has it (drawn only: the HUD's own takes over at the hand-off), so the two bugs meet exactly (the
          Trailer capture chat, 2026-10-27: the show's sat 45 px left of the HUD's since the "i" came) */}
      <div className="hud lu-hud" ref={(el) => { refs.current.bug = el; }}><div className="hud-tl">
        <span className="hud-btn hud-glass hud-info" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9 8 V13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="9" cy="5.2" r="1.05" fill="currentColor" /></svg></span>
        <ScoreBug home={TEAM_CODE.home} away={TEAM_CODE.away} score={[0, 0]} clock={0} />
      </div></div>
    </>
  );
}
