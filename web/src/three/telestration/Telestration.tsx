import { MATCH } from '../../data/paths';
import { hook, hooked } from '../../dev';
// <Telestration data clock items surface />: tactical drawings on the pitch, declared as a list of items keyed by id.
// A new id plays its entrance, a removed id plays its exit; changing an item (moving its anchor) never replays its
// entrance (pitch_prism's rule: only the newly born element animates). Design: docs/research/telestration.md.
// Clocks (section 4.8): where marks stand follows clip time (the shared Clock); how they move (entrances, exits, the
// ring's spin) runs on render time, so a paused match keeps its overlay alive; with window.__capture (?capture=1)
// everything runs on clip time, so recordings are frame-exact; window.__teleNow, when set, is the animation clock
// (a recording of an entrance over a held moment).
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { getSettings, type GameSettings } from '../../game/settings';
import { GroundLayer, KIND } from './ground';
import { makeAnchors, type Anchor, type XY } from './anchors';
import { ringEnter, ringExit, RING, CASCADE, edgeDraw, retract, EASE_OUT, bezier } from './anim';
import { TELE, TEAM_SIDE, inkColour, surfaceColour, mixPair, liftTo, hex, mixLab, mixHue, AMBER_Y, type Ink, type StrokeTool, type StrokeInk } from './style';
import { attackingOf } from '../coords';
const hex01 = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
import { splitUnits, type UnitMemo } from './units';
import { GroundLabels, type GroundLabel } from './GroundLabels';
import { XgWidget, newXgWidgetState, type XgWidgetState } from './XgWidget';
import { XgGroundTag } from './XgGroundTag';
import { Spotlights, type SpotReq } from './Spotlights';
import { SpeedTags, type SpeedTag } from './SpeedTags';
import { VIS, VIS_MAX, OFFB, patchScene } from './visionDim';
import { VAR_FACTS } from './var';
import { VarMarks } from './VarMarks';
import { VisionBeam, type BeamReq } from './VisionBeam';
import { LoftArrows, type LoftReq } from './LoftArrows';
import { OffsideWalls, type WallReq } from './OffsideWalls';
import { ControlLayer, newControlState, CTRL_NX, CTRL_NZ, type ControlState } from './ControlLayer';
import { pitchControl } from '../../response/outcomes';
import { jointAt } from '../camera/Director';
import { SparkLayer, hash01 } from './sparks';
import { StripLayer, type StripPoint } from './strip';
import { loadResolver, passNetwork, loadPasses, chemistry, type Network, type MatchPass } from './network';
import { markEngine, markTracking, type MarkPair, type MarkRule } from './marking';
import { xgFreeze, type XgFreezeModel, type XgPoint } from '../../response/xg';
import { contactTime } from './contact';
import { ballAt } from '../Ball';
import { loadXg } from '../../pause/moment';
import type { ResolverParams } from '../../response/outcomes';

export type { Anchor, XY } from './anchors';
const tmpColor = new THREE.Color();

interface Base {
  /** stable: an entrance fires once per id; removing the id plays the exit */
  id: string;
  /** clip seconds; outside the window the item leaves (and comes back, with its entrance, when the clock returns) */
  window?: { from?: number; to?: number };
}
/** the selected player's ring (tier 1) */
export interface MarkerItem extends Base { kind: 'marker'; at: Anchor; style?: Partial<typeof TELE.ring> }
/** a side's units: back line, midfield, front line (tier-2 rings joined by lines in the team colour), with the gaps
 *  between them in metres on the pitch. `at` pins them to a clip time (the kick of a line-breaking pass) */
export interface UnitsItem extends Base { kind: 'units'; side: 'att' | 'def'; at?: number; labels?: boolean; players?: number[] }
/** the passing network at a pause, from where the players are now. 'chemistry' (the default): the focus player's
 *  five teammates he has exchanged the most passes with since kick-off, white lines weighted by the count; 'options':
 *  the carrier's five best passes by the first-touch model's chance (for the pause window). `focus`: the player (the
 *  selected one); without it, the carrier. `at` pins it to a clip time (the pause); without it, it follows the clock */
export interface NetworkItem extends Base { kind: 'network'; mode?: 'chemistry' | 'options'; focus?: number | null; at?: number }
/** the pass chances from the player on the ball (hud/passProb.ts gives them): a link
 *  to every team-mate `to` with the chance `p` a pass to him is completed, in TELE.passProb.look (or `look`); an offside
 *  team-mate an amber ring, no link, no number. `at` pins it to a clip time; it follows the clock otherwise (send new
 *  edges as they change: nothing replays while the id stays) */
export interface PassProbItem extends Base { kind: 'passprob'; carrier: number; edges: { to: number; p: number; offside?: boolean }[]; at?: number; look?: 'width' | 'mid' | 'feet' | 'ramp' }
export type LaneName = 'left-wide' | 'left-half' | 'centre' | 'right-half' | 'right-wide';
/** a zone (a drawing tool for any zone, decided by the orchestrator): any shape of 3 to 8 corners
 *  (two sides need not be parallel), the matte zebra inside and a glowing outline all round. Give it as `poly`, its
 *  corners in order in pitch metres (data frame: x along, +x the attack, +y the attack's right); as `rect` [x0, y0,
 *  x1, y1], turned by `angle` radians about its centre; or as a template: `lane` (one of the five vertical lanes,
 *  between x `from` and `to`, default the attacking half), or `pocket` (the space between two of a side's units, back
 *  and midfield by default, within a lane, at the item's moment `at`, its sides on the two lines as they lean).
 *  `axis`: the direction its entrance unfolds along, radians in the data frame (default: a rectangle's own x, a
 *  pocket's lines, any other shape's long axis). `ink`: the outline's colour (default the attacking side's team colour) */
export interface ZoneItem extends Base {
  kind: 'zone'; poly?: XY[]; rect?: [number, number, number, number]; angle?: number; axis?: number;
  /** a fixed template (research doc 5): 'zone14' the space in front of the box (x 18 to 36 m, |y| under 9.16 m),
   *  'half-space-left' / 'half-space-right' the half-spaces (|y| 9.16 to 20.16 m) between `from` and `to` (default the
   *  attacking half); `label` lies on the pitch at its middle (a preset's own by default; false for none) */
  preset?: 'zone14' | 'half-space-left' | 'half-space-right'; label?: string | false;
  lane?: LaneName; from?: number; to?: number;
  pocket?: { side: 'att' | 'def'; lane: LaneName; between?: 'back-mid' | 'mid-front' };
  /** the pocket between two lines the pen linked (players in click order, up to four each): the first line's players,
   *  then the second's back, in the pocket's look (the same as closing a link round them; not used) */
  lines?: [number[], number[]];
  /** a round zone (the Tactics pen's circle): centre x, y and radius, pitch metres; the zones' look */
  circle?: [number, number, number];
  at?: number; ink?: Ink | 'att' | 'def'; fill?: 'zebra' | 'none';
}
/** marking links (who is tracking whom): each marker of `side` (the defending side by default) joined
 *  to the man he marks by a dashed line in his team colour, drawn out from him; `rule` as TELE.mark.rule by default.
 *  `focus`: only the links of that player (an unmarked one still shows his nearest opponent, fainter), with the gap in
 *  metres. `at` pins it to a clip time (the pause); without it, it follows the clock */
export interface MarkingItem extends Base { kind: 'marking'; side?: 'att' | 'def'; rule?: MarkRule; focus?: number | null; at?: number; labels?: boolean; pair?: [number, number] }
/** the shot cone: the goal as the shooter sees it, the light from his feet to the posts with every
 *  opponent's shadow, the goal mouth lit where open, and his xG (the defender-aware model, src/response/xg.ts), the
 *  distance and the angle. `shooter`: a player (default: the attacker nearest the ball); `at` pins it to a clip time */
export interface ShotItem extends Base { kind: 'shot'; shooter?: number; at?: number; labels?: boolean; xg?: number; header?: boolean }
/** a side's block (the defending side by default): the convex hull of its outfield players, grown by a margin, zebra
 *  inside a team-colour outline, with its area in m² (of the hull through the players, Opta's measure). `at` pins it
 *  to a clip time */
export interface HullItem extends Base { kind: 'hull'; side?: 'att' | 'def'; at?: number; labels?: boolean; players?: number[] }
/** players linked by the Tactics pen (§22: click players in order), drawn by who they are: two
 *  opponents as a marking pair (the hoops), teammates as one line in the units' look through them in click order,
 *  `closed` (back to the first) as an area in the hull's look with its m², a single player as his ring so far. `at`
 *  pins it to a clip time (the pause); it follows the clock otherwise. The pocket between two such lines is a zone's
 *  `lines` */
export interface LinkItem extends Base { kind: 'link'; players: number[]; closed?: boolean; at?: number }
/** pressure on the carrier: a circle of `radius` m (5 by default) round him, every opponent inside it ringed and linked
 *  to him by chevrons that flow at the speed he closes in. `carrier`: a player (default: the attacker nearest the ball);
 *  `at` pins it to a clip time */
export interface PressureItem extends Base { kind: 'pressure'; carrier?: number; radius?: number; at?: number }
/** the spotlight: pitch_prism's light column over a player (look at this one) */
export interface SpotlightItem extends Base { kind: 'spotlight'; at: Anchor }
/** the offside wall at the moment `at` (the kick of a pass): across the pitch at the offside line the defending side
 *  (`side`, default 'def') holds, as the law places it: the second-last of its players (the keeper counts) or the ball
 *  if that is nearer their goal, and never inside the attackers' own half. The defender who sets it gets the ring; the
 *  `focus` attacker (default: the clip's pass receiver) gets his margin to the line in metres */
export interface OffsideItem extends Base { kind: 'offside'; side?: 'att' | 'def'; focus?: number | null; at?: number; close?: boolean; highlight?: 'all' }
/** a pass arrow (pitch_prism's, solid white: the ball), in the form the orchestrator and the narration share
 *  (src/orchestrate/draw.ts PassArrow): `from` and `to` as anchors; `t` the clip times of the kick and the reception;
 *  `loft` the arc's apex in metres, or 'track' for the ball's real flight (the 3D arc comes in the next batch; drawn
 *  flat until then); `whatif` a pass that did not happen (drawn fainter for now, its look not final) */
export interface PassArrowItem extends Base { kind: 'pass'; from: Anchor; to: Anchor; t?: [number, number]; loft?: number | 'track' | boolean; whatif?: boolean }
/** a run arrow (pitch_prism's, amber octagon dashes: a player), along the player's tracked path between two clip
 *  times, curved as he ran (draw.ts RunArrow) */
export interface RunArrowItem extends Base { kind: 'run'; path: { player: number; from: number; to: number } }
/** pitch control, restyled: who would win the ball at every point (Spearman, the model the decision lab uses), a
 *  smooth team-coloured wash and the 0.5 frontier as a line of light; `at` pins it to a clip time, else it follows the
 *  clock (recomputed three times a second while playing) */
export interface ControlItem extends Base { kind: 'control'; at?: number }
/** a player's running direction at a moment: ripples from his feet that fade out, then the run arrow
 *  from his feet along where he goes over the next `ahead` s (TELE.heading.aheadS by default); `to`: a run to that
 *  point instead, all the way (the Tactics pen's drag) */
export interface HeadingItem extends Base { kind: 'heading'; player: number; at?: number; ahead?: number; to?: Anchor }
/** a player's speed trail (pitch_prism's): the last 1.5 s of his path as a comet tail on the grass coloured by his
 *  speed, and his speed in km/h upright beside him (`label`, default on) */
export interface TrailItem extends Base { kind: 'trail'; player: number; label?: boolean }
/** a line-breaking pass (a pass clip's own, from meta.pass: Opta's count of lines broken and the deepest one): the
 *  defending units pinned at the kick, the broken ones flashing and cracking open as the ball crosses them (clip
 *  time), the count on the pitch by the receiver. `kick` and `reception` override the clip's own times; `lines`,
 *  `last` and `receiver` its pass (any pass in any clip, such as 22:54's #17 in a shot clip) */
export interface LineBreakItem extends Base { kind: 'linebreak'; kick?: number; reception?: number; lines?: number; last?: 'last' | 'secondToLast'; receiver?: number }
/** a player's vision: where his head points, the edges of his central view on the grass, and everything outside his
 *  view darkened (the whole scene: grass, players, stands) */
export interface VisionItem extends Base { kind: 'vision'; player: number | number[]; at?: number }
/** a number on the pitch (for the narration): at the pitch point `at` (data frame metres), the
 *  share `value` 0..1, or a series over clip time `[t, v][]` (it follows the clock). Entering (render time, from when
 *  the item appears): after `delayS` the arc grows to `from` and holds there `holdS` s, then grows on to the value over
 *  `countS` (the other timings TELE.gauge's); without `from`, straight to the value. `text` replaces the number ("{v}" is the percentage);
 *  `side` the team whose share it is ('att' default; its colour at all, the other's at none); `look` and `r` as
 *  TELE.gauge. Leaves shrinking and fading */
export interface GaugeItem extends Base { kind: 'gauge'; at: XY; value: number | [number, number][]; from?: number; delayS?: number; holdS?: number; countS?: number; text?: string; side?: 'att' | 'def'; look?: 'ring' | 'target' | 'pie'; r?: number }
/** a stroke of the Tactics pen (the pointer, the strokes' storage, undo and
 *  the freeze frames live in hud/draft.ts): `pts` in pitch metres (data frame); pass a straight arrow from the first point to
 *  the last, run a dashed arrow along the path, dribble a wavy arrow from the first to the last, circle a plain ring
 *  round `player` (following him) or the first point, zone the rectangle of the first and the last point, pen the free
 *  line, measure a line with end dots and its metres. `pts` may change every frame while the pointer moves: the stroke
 *  follows at once, nothing replays. `alpha` (default 1) is hud/draft.ts's fade (play resumed, a saved frame passed);
 *  removing the item fades it out over TELE.stroke.exitS (undo, clear) */
export interface StrokeItem extends Base { kind: 'stroke'; tool: StrokeTool; ink: StrokeInk; pts: XY[]; player?: number; alpha?: number }
export type Item = MarkerItem | UnitsItem | NetworkItem | ZoneItem | MarkingItem | ShotItem | HullItem | PressureItem | SpotlightItem | OffsideItem | PassArrowItem | RunArrowItem | ControlItem | HeadingItem | TrailItem | LineBreakItem | VisionItem | StrokeItem | LinkItem | PassProbItem | GaugeItem;

interface Live { item: Item; born: number; exitAt: number | null }

const exitS = (it: Item) => (it.kind === 'marker' ? RING.exitS : it.kind === 'stroke' ? TELE.stroke.exitS : Math.max(RING.exitS, CASCADE.retract));

/** a path's length, metres */
const pathLen = (p: XY[]) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };
/** the path without its last `d` metres, ending where it is cut */
function trimEnd(p: XY[], d: number): XY[] {
  let left = d;
  for (let i = p.length - 1; i > 0; i--) {
    const a = p[i - 1], b = p[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l >= left) { const f = l > 1e-9 ? (l - left) / l : 0; return [...p.slice(0, i), [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]]; }
    left -= l;
  }
  return [p[0], p[0]];
}
/** a hand-drawn path smoothed `n` times (Chaikin's corner cutting), its ends kept */
function chaikin(p: XY[], n: number): XY[] {
  let q = p;
  for (let k = 0; k < n && q.length > 2; k++) {
    const r: XY[] = [q[0]];
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      if (i > 0) r.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      if (i < q.length - 2) r.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    r.push(q[q.length - 1]);
    q = r;
  }
  return q;
}

/** the joints that count for offside: all but the arms and hands (the law: the hands and arms, up to the bottom of
 *  the armpit, do not count; the shoulders do) */
const OFF_EXCLUDE = new Set(['rElbow', 'rWrist', 'lElbow', 'lWrist', 'lThumb', 'lPinky', 'rThumb', 'rPinky']);
const offCache = new WeakMap<object, number[]>();
function offJoints(J: { names: string[] }): number[] {
  let v = offCache.get(J);
  if (!v) { v = J.names.map((n, i) => (OFF_EXCLUDE.has(n) ? -1 : i)).filter((i) => i >= 0); offCache.set(J, v); }
  return v;
}

/** a line-breaking pass worked out once: the units at the kick, which are broken, where and when the ball crosses */
interface LineBreakPlan { kick: number; rec: number; groups: { p: number; xy: XY }[][]; broken: Set<number>; cross: ({ t: number; xy: XY } | null)[]; recXY: XY | null; total: number }

/** a shape's centroid and long axis (radians): the major axis of its area's second moments; nearly round shapes take
 *  the pitch's x */
function centroidAxis(poly: XY[]): { c: XY; axis: number } {
  const [ox, oy] = poly[0];
  let A = 0, sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < poly.length; i++) {
    const x0 = poly[i][0] - ox, y0 = poly[i][1] - oy, x1 = poly[(i + 1) % poly.length][0] - ox, y1 = poly[(i + 1) % poly.length][1] - oy, c = x0 * y1 - x1 * y0;
    A += c / 2; sx += ((x0 + x1) * c) / 6; sy += ((y0 + y1) * c) / 6;
    xx += ((x0 * x0 + x0 * x1 + x1 * x1) * c) / 12; yy += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12; xy += ((x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c) / 24;
  }
  if (Math.abs(A) < 1e-6) return { c: [poly.reduce((q, v) => q + v[0], 0) / poly.length, poly.reduce((q, v) => q + v[1], 0) / poly.length], axis: 0 };
  const mx = sx / A, my = sy / A, Sxx = xx / A - mx * mx, Syy = yy / A - my * my, Sxy = xy / A - mx * my;
  const spread = Math.hypot((Sxx - Syy) / 2, Sxy);
  return { c: [ox + mx, oy + my], axis: spread < 0.075 * (Sxx + Syy) ? 0 : 0.5 * Math.atan2(2 * Sxy, Sxx - Syy) };
}

/** the renderer's frame whose scene-wide cues (the vision's darkness, the offside lift, the VAR facts) were last cleared:
 *  they are shared by every <Telestration> in the scene, so the first one each frame clears them and any may set them
 *  (Stage's and the Tactics mode's both mount one; clearing in each let the later one switch the earlier's vision off) */
let cuesFrame = -1;
/** for design checks in any window (window.__teleExtra = [items], window.__teleHide = [ids]): the extra items are drawn
 *  by the first <Telestration> of each frame */
let extraFrame = -1;

/** the items for the selected player: his ring, except in his own first-person view (the camera is in his head) */
export function selectedItems(s: GameSettings): Item[] {
  if (s.selected === null || s.selected < 0 || s.view === 'first') return [];
  return [{ id: `sel-${s.selected}`, kind: 'marker', at: { player: s.selected } }];
}

/** surface: the pitch's mode progress (Stage's PitchMode: 0 grass, 1 board); without it, the tactical switch */
/** focus: set each frame to the shooter while a shot item is shown (-1 otherwise), for the scene to draw him alone in
 *  toon over everyone else in silhouette (Players' only and hide) */
export function Telestration({ data, clock, items, surface, focus }: { data: Loaded; clock: Clock; items: Item[]; surface?: { current: number }; focus?: { current: number } }) {
  const trails = useMemo(() => new StripLayer('ground', 8192), []), layer = useMemo(() => new GroundLayer(), []), sparks = useMemo(() => new SparkLayer(), []), streaks = useMemo(() => new StripLayer('facing', 8192), []);
  useEffect(() => () => { layer.dispose(); sparks.dispose(); streaks.dispose(); trails.dispose(); }, [layer, sparks, streaks, trails]);
  const anchors = useMemo(() => makeAnchors(data), [data]);
  const nAtt = data.joints?.nAtt ?? data.pkg.frames[0].att.length;   // players are attackers first, then defenders
  TEAM_SIDE.attacking = attackingOf(data.pkg.meta);   // the team colours follow the teams, not the roles (style.ts)
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const keepers = useMemo(() => new Set(data.pkg.keepers ?? []), [data]);
  const P = data.joints?.players ?? data.pkg.frames[0].att.length + data.pkg.frames[0].def.length;
  const st = useMemo(() => ({ live: new Map<string, Live>(), xy: [0, 0] as XY, c1: [0, 0, 0] as [number, number, number], c2: [0, 0, 0] as [number, number, number], v: new THREE.Vector3(),
    memos: new Map<string, UnitMemo>(), labels: { list: [] as GroundLabel[] }, xgw: { s: newXgWidgetState() as XgWidgetState }, spots: { list: [] as SpotReq[] }, beams: { list: [] as BeamReq[] }, visFrames: 0, visA: new THREE.Vector3(), visB: new THREE.Vector3(), breaks: new Map<string, LineBreakPlan | null>(), speedTags: { list: [] as SpeedTag[] }, hipV: new THREE.Vector3(), walls: { list: [] as WallReq[] }, lofts: { list: [] as LoftReq[] }, linkBorn: new Map<string, Map<number, number>>(), ctrl: { s: newControlState() as ControlState }, ctrlT: -1e9, w: [1, 1, 1] as [number, number, number], poly: new Float32Array(16), polyX: new Float32Array(16), hullV: new Float32Array(20),
    camR: new THREE.Vector3(), camU: new THREE.Vector3(), camPos: new THREE.Vector3(), xgFlat: false, vp: new THREE.Vector2(),
    prm: null as ResolverParams | null, nets: new Map<string, { t: number; key: string; net: Network | null }>(), marks: new Map<string, { t: number; key: string; pairs: MarkPair[] }>(), xg: null as XgFreezeModel | null, shotX: new Float32Array(16), passes: null as MatchPass[] | null }), []);
  useEffect(() => { loadResolver().then((p) => { st.prm = p; }); loadXg().then((m) => { st.xg = m; }); }, [st]);
  useEffect(() => {
    let live = true;   // a load that answers after the clip changed is dropped
    st.passes = null; loadPasses((data.pkg as { teams?: { match?: string } }).teams?.match ?? MATCH).then((p) => { if (live) st.passes = p; });
    return () => { live = false; };
  }, [st, data]);

  /** a ring to draw in the second pass, over every line's weld */
  interface RingReq { xy: XY; side: 'att' | 'def'; sc: number; al: number; player: number; style: typeof TELE.ring }
  const sideOf = (p: number): 'att' | 'def' => (p >= nAtt ? 'def' : 'att');
  const hashId = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return h; };

  /** one side's units (every member carries the selected player's own double ring, joined by lines;
   *  no second ring design): pushes the lines now, returns the rings for the second pass, adds the gaps' labels */
  /** `pAge`: each linked player's own age (the pen adds them one click at a time: each pops in, and its line draws, as
   *  he is clicked) */
  const drawUnits = (it: UnitsItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[], pAge?: (p: number) => number) => {
    const U = TELE.unit, tt = it.at ?? clock.t, side = it.side, minimal = U.look === 'minimal', chosen = it.players;
    // the minimal look's ring: the inner ring alone, solid, in the team colour (the outer band laid on it, undashed)
    const R = minimal ? { ...TELE.ring, R: TELE.ring.innerR, outerW: TELE.ring.innerW, dashFill: 1, outer: TELE.ring.inner } : TELE.ring;
    const enter = (a: number): [number, number] => {
      if (!minimal) return ringEnter(a);
      const e = EASE_OUT(Math.min(1, Math.max(0, age / U.fadeS)));
      return [0.85 + 0.15 * e, e];
    };
    const players: { p: number; xy: XY }[] = [];
    if (chosen) { for (const p of chosen) if (anchors.player(p, tt, TELE.smoothS, st.xy)) players.push({ p, xy: [st.xy[0], st.xy[1]] }); }
    else for (let p = side === 'att' ? 0 : nAtt; p < (side === 'att' ? nAtt : P); p++) {
      if (keepers.has(p) || !anchors.player(p, tt, TELE.smoothS, st.xy)) continue;
      players.push({ p, xy: [st.xy[0], st.xy[1]] });
    }
    if (players.length < (chosen ? 2 : 4)) return;
    let memo = st.memos.get(it.id); if (!memo) { memo = { split: null, order: [] }; st.memos.set(it.id, memo); }
    // depth: metres towards the side's own goal (the attack plays towards +x, so the defending side's goal is at +x);
    // players the pen linked are one line, in the order they were clicked
    const units = chosen ? { back: players.map((q) => q.p), mid: [] as number[], front: [] as number[] } : splitUnits(players, (xy) => (side === 'def' ? xy[0] : -xy[0]), memo);
    const at = new Map(players.map((q) => [q.p, q.xy]));
    inkColour('team', side, k, st.c1);
    const col = [...st.c1, 1];
    const left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
    const f = edgeDraw(age - CASCADE.edgeDelay) * left;
    const groups = chosen ? [units.back] : [units.back, units.mid, units.front].map((g) => [...g].sort((a, b) => at.get(a)![1] - at.get(b)![1]));
    const rank = new Map<number, number>(); let i = 0;
    for (const g of groups) for (const p of g) rank.set(p, i++);
    const ageOf = (p: number) => (pAge ? pAge(p) : age - rank.get(p)! * CASCADE.ringStagger);
    const ringScale = (p: number) => enter(ageOf(p))[0] * sx * gain;
    // the lines, welded to the inner ring: cut by its circle at the band's centreline, so the band painted over it in the
    // second pass buries the seam (pitch_prism: the lines stop at the inner ring, never cross the marker)
    for (const g of groups) for (let j = 0; j + 1 < g.length; j++) {
      const A = at.get(g[j])!, B = at.get(g[j + 1])!, dx = B[0] - A[0], dz = B[1] - A[1], Lh = Math.hypot(dx, dz) / 2;
      const fj = pAge ? edgeDraw(Math.min(pAge(g[j]), pAge(g[j + 1])) - CASCADE.edgeDelay) * left : f;
      if (Lh < 1e-3 || fj <= 0) continue;
      const hw = (U.lineW / 2) * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
      layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, ax],
        [Lh, hw, R.innerR * ringScale(g[j]), R.innerR * ringScale(g[j + 1])], [fj, 0, 0, gain], col, col);
    }
    // sparks at the growing tips (entrance only; the full look)
    if (TELE.spark.on && U.look === 'full' && ex === null) {
      let line = 0;
      for (const g of groups) for (let j = 0; j + 1 < g.length; j++) {
        const A = at.get(g[j])!, B = at.get(g[j + 1])!;
        lineSparks(A, B, R.innerR * gain, R.innerR * gain, age - CASCADE.edgeDelay, hashId(it.id) + line++, st.c1, gain);
      }
    }
    // the rings, cascading in: the selected player's double ring on every member (minimal: all fading in together)
    for (const g of groups) for (const p of g) {
      const [se, ae] = enter(ageOf(p));
      rings.push({ xy: at.get(p)!, side, sc: se * sx * gain, al: ae * ax, player: p, style: R });
    }
    // the gaps between the units, in metres, lying on the pitch between them (paint: arrives with the lines)
    if ((it.labels ?? U.labels) && !chosen && f > 0) {
      surfaceColour(TELE.color.white, k, st.w);
      const mean = (g: number[], c: 0 | 1) => g.reduce((s0, p) => s0 + at.get(p)![c], 0) / g.length;
      for (const [g0, g1] of [[groups[0], groups[1]], [groups[1], groups[2]]] as const) {
        if (!g0.length || !g1.length) continue;
        const x0 = mean(g0, 0), x1 = mean(g1, 0), gap = Math.abs(x1 - x0);
        if (gap < 3) continue;
        labels.push({ x: (x0 + x1) / 2, z: (mean(g0, 1) + mean(g1, 1)) / 2, text: `${Math.round(gap)} m`, alpha: U.labelAlpha * f, sizeM: U.labelM * gain, rgb: [...st.w] as [number, number, number] });
      }
    }
  };

  /** the entrance effect of one line drawing in from rings A and B (radii rA, rB) towards the middle, `a` seconds into
   *  its draw, in TELE.spark.style: 'burst' sparks thrown off the growing
   *  tips; 'weld' welding sparks, fast short streaks that bounce once; 'dust' star dust drifting up and twinkling; 'flow'
   *  light streaming along the drawn line into the tip, a star flare on the tip; 'ripple' rings spreading on the grass
   *  from the tips. Stateless: every particle comes from its emission time and seed, so pausing and recording agree */
  const lineSparks = (A: XY, B: XY, rA: number, rB: number, a: number, seed: number, team: [number, number, number], gain: number, oneWay = false) => {
    const S = TELE.spark, dur = CASCADE.edgeDur, style = S.style;
    if (a < 0 || a > dur + Math.max(S.life, S.burstLife, 1)) return;
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
    if (L < 1e-3) return;
    const ux = dx / L, uz = dz / L, px = -uz, pz = ux, Lv = Math.max(L - rA - rB, 0);
    const hot = style === 'weld' ? 0.85 : style === 'dust' ? 0.75 : S.hot;
    const r = team[0] + (1 - team[0]) * hot, g = team[1] + (1 - team[1]) * hot, b = team[2] + (1 - team[2]) * hot;
    // where each tip is when the line is f drawn: tip A runs +u from ring A, tip B runs -u from ring B; a one-way line
    // (a pass) has the one tip, running the whole length to B, and its burst lands at B
    const span = oneWay ? Lv : 0.5 * Lv, SIDES = (oneWay ? [0] : [0, 1]) as (0 | 1)[];
    const tip = (f: number, side: 0 | 1): XY => (side === 0 ? [A[0] + ux * (rA + f * span), A[1] + uz * (rA + f * span)] : [B[0] - ux * (rB + f * span), B[1] - uz * (rB + f * span)]);
    const H = (j: number, side: number, k: number) => hash01(seed, j, side, k);
    const growing = a < dur, fNow = edgeDraw(Math.min(a, dur));

    if (style === 'flow') {
      // light streaming along the drawn line into each tip, and a star flare on the tip
      if (growing) for (const side of SIDES) {
        const [tx, tz] = tip(fNow, side), dir = side === 0 ? 1 : -1, drawn = 0.5 * fNow * Lv, D = Math.min(drawn, 5);
        for (let i = 0; i < 16; i++) {
          const ph = (H(i, side, 1) + a * 1.9) % 1, dist = D * (1 - ph), j = (H(i, side, 2) - 0.5) * 0.3 * (dist / Math.max(D, 1e-3));
          const al = S.alpha * Math.min(1, ph * 3) * Math.min(1, (1 - ph) * 8);
          sparks.push(tx - ux * dir * dist + px * j, 0.06, tz - uz * dir * dist + pz * j, r, g, b, al, S.sizePx * (0.6 + 0.6 * ph));
        }
        sparks.push(tx, 0.06, tz, r, g, b, S.tipAlpha, S.tipPx * 1.3);
        const fl = 0.55 * gain * (0.8 + 0.2 * Math.sin(a * 40));   // the flare's arms, in metres, flickering
        for (const v of [st.camR, st.camU]) streaks.line([
          { x: tx - v.x * fl, y: 0.06 - v.y * fl, z: tz - v.z * fl, half: 0.012, r, g, b, a: 0 },
          { x: tx, y: 0.06, z: tz, half: 0.02, r, g, b, a: S.tipAlpha },
          { x: tx + v.x * fl, y: 0.06 + v.y * fl, z: tz + v.z * fl, half: 0.012, r, g, b, a: 0 }]);
      }
    } else if (style === 'ripple') {
      // rings spreading on the grass from the tips, every 0.09 s; a wide one where the halves meet
      const life = 0.45, n = Math.ceil(dur / 0.09);
      for (let j = 0; j < n; j++) {
        const te = j * 0.09, age = a - te;
        if (age < 0 || age > life) continue;
        const k = 1 - age / life;
        for (const side of SIDES) {
          const [x, z] = tip(edgeDraw(te), side), R0 = (0.12 + 2.0 * age) * gain;
          layer.push([x, z, 1, 0], [R0 + 0.5, R0 + 0.5, KIND.band, S.alpha * k * k], [R0, 0.07 * gain, 0, 0], [0, 0, 0, gain], [r, g, b, 1], [r, g, b, 1]);
        }
      }
      const ab = a - dur;
      if (ab >= 0 && ab <= 0.65) { const [mx, mz] = tip(1, 0), k = 1 - ab / 0.65, R0 = (0.2 + 4.5 * ab) * gain;
        layer.push([mx, mz, 1, 0], [R0 + 0.6, R0 + 0.6, KIND.band, S.alpha * k * k], [R0, 0.1 * gain, 0, 0], [0, 0, 0, gain], [r, g, b, 1], [r, g, b, 1]); }
      if (growing) for (const side of SIDES) { const [x, z] = tip(fNow, side); sparks.push(x, 0.05, z, r, g, b, S.tipAlpha, S.tipPx); }
    } else {
      // particles thrown from the tips: 'burst' sparks, 'weld' streaks, 'dust' motes
      const weld = style === 'weld', dust = style === 'dust';
      const dt = weld ? 0.008 : dust ? 0.015 : S.dt, life = weld ? 0.32 : dust ? 0.9 : S.life;
      const spread = weld ? 2.6 : dust ? 0.45 : S.spread, backS = weld ? 1.6 : dust ? 0.2 : S.back;
      const upMin = weld ? 1.0 : dust ? 0.3 : S.upMin, upMax = weld ? 3.2 : dust ? 0.9 : S.upMax, grav = weld ? 9.8 : dust ? 0 : S.gravity;
      // height and vertical speed at `age` for a spark thrown up at `up` from 5 cm: one bounce (welding sparks), or a
      // fall clamped at the grass; star dust slows as it rises
      const yAt = (up: number, age: number) => {
        if (dust) return 0.05 + up * age * (1 - 0.35 * age);
        const t1 = (up + Math.sqrt(up * up + 2 * grav * 0.05)) / Math.max(grav, 1e-3);
        if (age <= t1 || !weld) return Math.max(0.02, 0.05 + up * age - 0.5 * grav * age * age);
        const u2 = 0.35 * (grav * t1 - up), t2 = age - t1;
        return Math.max(0.02, u2 * t2 - 0.5 * grav * t2 * t2);
      };
      const n = Math.ceil(dur / dt);
      for (let j = 0; j < n; j++) {
        const te = j * dt, age = a - te;
        if (age < 0 || age > life) continue;
        const f = edgeDraw(te), k = 1 - age / life;
        for (const side of SIDES) {
          const [x0, z0] = tip(f, side), dir = side === 0 ? 1 : -1;
          const h1 = H(j, side, 1), h2 = H(j, side, 2), h3 = H(j, side, 3), h4 = H(j, side, 4);
          const lat = (h1 * 2 - 1) * spread, back = -dir * h2 * backS, up = upMin + h3 * (upMax - upMin);
          const at = (q: number) => [x0 + (px * lat + ux * back) * q, yAt(up, q), z0 + (pz * lat + uz * back) * q] as const;
          const [x, y, z] = at(age);
          if (weld) {
            const [x1, y1, z1] = at(Math.max(0, age - 0.06));
            streaks.line([{ x: x1, y: y1, z: z1, half: 0.012, r, g, b, a: 0.15 }, { x, y, z, half: 0.03, r, g, b, a: Math.min(1, 1.1 * k ** 0.8) }]);
          } else {
            const tw = dust ? 0.55 + 0.45 * Math.sin(h4 * 6.283 + age * 28) : 1;
            sparks.push(x, y, z, r, g, b, S.alpha * k ** 1.5 * tw, S.sizePx * (dust ? 0.7 : 0.5 + 0.5 * k) * (0.7 + 0.6 * h4));
          }
        }
      }
      if (growing) for (const side of SIDES) { const [x, z] = tip(fNow, side); sparks.push(x, 0.05, z, r, g, b, S.tipAlpha, S.tipPx); }
      // the halves meet: a burst at the meeting point
      const ab = a - dur, bl = dust ? 0.9 : S.burstLife;
      if (ab >= 0 && ab <= bl) {
        const [mx, mz] = tip(1, 0), k = 1 - ab / bl;
        for (let i = 0; i < S.burst; i++) {
          const h1 = H(999, i, 1), h2 = H(999, i, 2), h3 = H(999, i, 3), ang = h1 * Math.PI * 2, sp = (dust ? 0.6 : weld ? 4.2 : S.burstSpeed) * (0.35 + 0.65 * h2);
          const up = upMin + h3 * (upMax - upMin), q = (t0: number) => [mx + Math.cos(ang) * sp * t0, yAt(up, t0), mz + Math.sin(ang) * sp * t0] as const;
          const [x, y, z] = q(ab);
          if (weld) { const [x1, y1, z1] = q(Math.max(0, ab - 0.06)); streaks.line([{ x: x1, y: y1, z: z1, half: 0.012, r, g, b, a: 0.15 }, { x, y, z, half: 0.03, r, g, b, a: Math.min(1, 1.1 * k ** 0.8) }]); }
          else sparks.push(x, y, z, r, g, b, S.alpha * k ** 1.5, S.sizePx * (0.6 + 0.4 * k) * (0.8 + 0.5 * h3));
        }
      }
    }
  };

  /** the passing network: its lines now, its rings for the second pass, the best three percentages as labels */
  const drawNetwork = (it: NetworkItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const mode = it.mode ?? 'chemistry';
    if (mode === 'options' ? !st.prm : !st.passes) return;
    const N = TELE.net, R = TELE.ring, tt = it.at ?? clock.t;
    // the network at this moment, recomputed only when the moment or the focus moves (a pause holds it)
    let c = st.nets.get(it.id);
    const key = `${mode}|${it.focus ?? -1}`;
    if (!c || Math.abs(c.t - tt) > 0.04 || c.key !== key) {
      const pos: XY[] = [], vel: XY[] = [], gk: boolean[] = [], q: XY = [0, 0];
      for (let p = 0; p < P; p++) {
        anchors.player(p, tt, TELE.smoothS, q); const a: XY = [q[0], q[1]];
        anchors.player(p, tt - 0.2, TELE.smoothS, q); pos.push(a); vel.push([(a[0] - q[0]) / 0.2, (a[1] - q[1]) / 0.2]); gk.push(keepers.has(p));
      }
      // the carrier: the attacker nearest the ball
      const b: XY = [0, 0]; let carrier = 0, bd = Infinity;
      if (anchors.resolve({ ball: true, at: tt }, tt, 0, b)) for (let p = 0; p < nAtt; p++) { const d = Math.hypot(pos[p][0] - b[0], pos[p][1] - b[1]); if (d < bd) { bd = d; carrier = p; } }
      let net: Network | null;
      if (mode === 'options') net = P === 22 && nAtt === 11 && st.prm ? passNetwork(st.prm, pos, vel, gk, carrier, nAtt, TELE.net.support) : null;
      else {
        const pkg = data.pkg as { players?: { pid: string }[]; clock0?: number }, pids = (pkg.players ?? []).map((q) => q.pid);
        const focus = it.focus ?? carrier;
        net = pids.length === P && st.passes ? chemistry(st.passes, pids, focus, sideOf, (pkg.clock0 ?? 0) + tt) : null;
      }
      c = { t: tt, key, net };
      st.nets.set(it.id, c);
    }
    const net = c.net;
    if (!net) return;
    const left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex), side = sideOf(net.carrier);
    surfaceColour(TELE.color.white, k, st.w);
    const white = [...st.w, 1], at = (p: number, out: XY) => anchors.player(p, tt, TELE.smoothS, out);
    const A: XY = [0, 0], B: XY = [0, 0];
    // the carrier's best options (five), best first, each drawn from the carrier out to the teammate like a pass
    const shown = net.star.filter((e) => (mode === 'options' ? e.p >= N.minP : true)).slice(0, N.top);
    shown.forEach((e, rank) => {
      if (e.p < N.minP || !at(e.a, A) || !at(e.b, B)) return;
      const dx = B[0] - A[0], dz = B[1] - A[1], Lh = Math.hypot(dx, dz) / 2;
      if (Lh < 1e-3) return;
      const ea = age - CASCADE.edgeDelay - rank * N.stagger, f = edgeDraw(ea) * left;
      const hw = (N.minHW + (N.maxHW - N.minHW) * e.p) * gain, al = (N.minA + (1 - N.minA) * e.p) * ax, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
      if (f > 0) layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, al],
        [Lh, hw, R.innerR * gain, R.innerR * gain], [f, 1, 0, gain], white, white);
      if (TELE.spark.on && N.sparks && ex === null) lineSparks([A[0], A[1]], [B[0], B[1]], R.innerR * gain, R.innerR * gain, ea, hashId(it.id) + rank, st.w, gain, true);
      // the best options' chances, lying beside the line two thirds of the way out
      if (rank < N.labelTop && f > 0) {
        const L2 = 2 * Lh, ux = dx / L2, uz = dz / L2, off = N.labelOff * gain;
        labels.push({ x: A[0] + dx * 0.62 - uz * off, z: A[1] + dz * 0.62 + ux * off, text: `${Math.round(e.p * 100)}%`, alpha: TELE.unit.labelAlpha * Math.min(1, f * 1.5), sizeM: N.labelM * gain, rgb: [...st.w] as [number, number, number] });
      }
    });
    // the support: faint links between neighbouring teammates, drawn from both ends after the options
    const sDelay = CASCADE.edgeDelay + shown.length * N.stagger;
    for (const e of N.support ? net.support : []) {
      if (!at(e.a, A) || !at(e.b, B)) continue;
      const dx = B[0] - A[0], dz = B[1] - A[1], Lh = Math.hypot(dx, dz) / 2;
      const f = edgeDraw(age - sDelay) * left;
      if (Lh < 1e-3 || f <= 0) continue;
      const hw = N.supportHW * gain, al = N.supportA * (0.4 + 0.6 * e.p) * ax, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
      layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, al],
        [Lh, hw, R.innerR * gain, R.innerR * gain], [f, 0, 0, gain], white, white);
    }
    // the nodes: the carrier first, then his teammates, cascading in
    const order = [net.carrier, ...shown.map((e) => e.b)];
    order.forEach((p, i) => {
      if (!at(p, A)) return;
      const [se, ae] = ringEnter(age - i * CASCADE.ringStagger);
      rings.push({ xy: [A[0], A[1]], side, sc: se * sx * gain, al: ae * ax, player: p, style: R });
    });
  };

  /** marking links: the dashed lines now, their rings for the second pass (the marker's at once, his man's as the line
   *  reaches him), the gaps' labels in focus */
  const drawMarking = (it: MarkingItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const M = TELE.mark, R = TELE.ring, tt = it.at ?? clock.t, side = it.side ?? 'def', other = side === 'def' ? 'att' : 'def', rule = it.rule ?? M.rule;
    const pos = (p: number, t: number, out: XY) => anchors.player(p, t, TELE.smoothS, out);
    const outfield = (s: 'att' | 'def') => { const g: number[] = []; for (let p = s === 'att' ? 0 : nAtt; p < (s === 'att' ? nAtt : P); p++) if (!keepers.has(p)) g.push(p); return g; };
    // the pairs at this moment, recomputed only when the moment or the rule moves (a pause holds them)
    let c = st.marks.get(it.id);
    const key = `${rule}|${side}`;
    if (!c || Math.abs(c.t - tt) > 0.04 || c.key !== key) {
      const defs = outfield(side), atts = outfield(other);
      c = { t: tt, key, pairs: rule === 'tracking' ? markTracking(pos, tt, defs, atts, M.windowS) : markEngine(pos, tt, defs, atts, M.maxM) };
      st.marks.set(it.id, c);
    }
    let pairs = c.pairs;
    const focus = it.focus ?? null, A: XY = [0, 0], B: XY = [0, 0];
    // a pair the pen linked: the one on `side` marks the other
    if (it.pair) {
      const [p0, p1] = it.pair, d = sideOf(p0) === side ? p0 : p1, a = d === p0 ? p1 : p0;
      pairs = pos(d, tt, A) && pos(a, tt, B) ? [{ d, a, dist: Math.hypot(B[0] - A[0], B[1] - A[1]), w: 0 }] : [];
    }
    if (focus !== null) {
      pairs = pairs.filter((q) => q.d === focus || q.a === focus);
      // an unmarked player (or a marker without a man) still shows his nearest opponent within reach, fainter
      if (!pairs.length && pos(focus, tt, A)) {
        let best = -1, bd = Infinity;
        for (const p of outfield(sideOf(focus) === 'att' ? 'def' : 'att')) if (pos(p, tt, B)) { const d = Math.hypot(B[0] - A[0], B[1] - A[1]); if (d < bd) { bd = d; best = p; } }
        if (best >= 0 && bd <= M.maxM) pairs = [sideOf(focus) === side ? { d: focus, a: best, dist: bd, w: 0, loose: true } : { d: best, a: focus, dist: bd, w: 0, loose: true }];
      }
    }
    // the most urgent first: by the man's distance to the ball
    const ball: XY = [0, 0], hasBall = anchors.resolve({ ball: true, at: tt }, tt, 0, ball);
    const ordered = [...pairs].sort((x, y) => (hasBall && pos(x.a, tt, A) && pos(y.a, tt, B) ? Math.hypot(A[0] - ball[0], A[1] - ball[1]) - Math.hypot(B[0] - ball[0], B[1] - ball[1]) : 0));
    const left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
    inkColour('team', side, k, st.c1);
    const col = [...st.c1, 1], showLabels = it.labels ?? (focus !== null ? true : M.labels);
    // the capsule's far end: his man's team colour, for the gradient
    const gradMode = ['none', 'lab', 'hue'].indexOf(M.grad), col2 = gradMode > 0 ? [...inkColour('team', other, k, [0, 0, 0]), 1] : col;
    if (showLabels) surfaceColour(TELE.color.white, k, st.w);
    ordered.forEach((q, i) => {
      if (!pos(q.d, tt, A) || !pos(q.a, tt, B)) return;
      const dx = B[0] - A[0], dz = B[1] - A[1], Lh = Math.hypot(dx, dz) / 2, L2 = Math.max(2 * Lh, 1e-6);
      const ea = age - CASCADE.edgeDelay - i * M.stagger, f = edgeDraw(ea) * left;
      const [seD, aeD] = ringEnter(age - i * M.stagger), [seA, aeA] = ringEnter(ea - 0.75 * CASCADE.edgeDur);
      const scD = seD * sx * gain, scA = seA * sx * gain, al = (q.loose ? M.looseA : 1) * ax;
      let off = M.labelOff * gain;
      if (M.style === 'dumbbell' || M.style === 'guard' || M.style === 'pool' || M.style === 'line' || M.style === 'hoops') {
        // the plainer styles (ground kind 13): fading in as the capsule does,
        // backwards to leave
        const t0 = age - i * M.stagger - 0.05, tp = ex === null ? Math.min(1, Math.max(0, t0 / M.durS.fade)) : Math.max(0, 1 - ex / exitS(it));
        const look = ['dumbbell', 'guard', 'pool', 'line', 'hoops'].indexOf(M.style), m = Math.max(M.capR, M.dotR, M.hoopR, M.guardR + M.guardHW) * gain + 0.6;
        if (tp > 0) {
          const ux = Lh > 1e-3 ? dx / L2 : 1, uz = Lh > 1e-3 ? dz / L2 : 0;
          layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, ux, uz], [Lh + m, m, KIND.pair, al], [Lh, M.capR * gain, M.lineHW * gain, M.poolA],
            [tp, look, 0, gain], col, col2, [gradMode, M.dotR * gain, M.footR * gain, M.guardR * gain, M.guardHW * gain, (M.guardDeg * Math.PI) / 180, M.hoopR * gain, 0]);
        }
        off = (M.capR + 0.8) * gain;
      } else if (M.style === 'capsule') {
        // the outline round the pair, entering in TELE.mark.anim: 'stretch' opens as a circle round the marker (the
        // ring's pop) and stretches to his man; the others run one progress in the shader, backwards to leave
        const anim = M.anim, dur = M.durS[anim], sty = ['stretch', 'snap', 'merge', 'lasso', 'embrace', 'sonar', 'fade'].indexOf(anim);
        const t0 = age - i * M.stagger - 0.05, tp = ex === null ? Math.min(1, Math.max(0, t0 / dur)) : Math.max(0, 1 - ex / exitS(it));
        const stretch = anim === 'stretch', r = M.capR * gain * (stretch ? seD * sx : 1);
        // the idle pulse, once the entrance is done
        const since = t0 - dur, pulse = M.pulse && ex === null && since >= 0 ? (since % M.pulseS) / M.pulseCrossS : -1;
        // the quad: the lasso's wide loop and the snap's overshoot past the man need room
        const m = (anim === 'lasso' ? 2.3 * M.capR : M.capR) * gain + M.capHW * gain + 3 * TELE.glow.sigma * gain + 0.6, mx = anim === 'snap' ? 0.3 * Lh : 0;
        if (r > 1e-3 && (stretch || tp > 0)) {
          const ux = Lh > 1e-3 ? dx / L2 : 1, uz = Lh > 1e-3 ? dz / L2 : 0;
          layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, ux, uz], [Lh + mx + m, m, KIND.capsule, stretch ? al * aeD : al],
            [Lh, r, M.capHW * gain, M.capWash], [stretch ? Math.max(f, 0) : tp, sty, pulse, gain], col, col2, [gradMode]);
        }
        // the sonar's ripples from the marker, and the lock's flash round his man (snap, sonar)
        const hot: [number, number, number] = [st.c1[0] + (1 - st.c1[0]) * 0.5, st.c1[1] + (1 - st.c1[1]) * 0.5, st.c1[2] + (1 - st.c1[2]) * 0.5];
        if (ex === null && anim === 'sonar') {
          const reach = 2 * Lh + M.capR * gain, v = reach / (0.45 * dur);
          for (let j = 0; j < 3; j++) {
            const rt = t0 - j * 0.12, R0 = v * rt;
            if (rt <= 0 || R0 > reach + 1) continue;
            const kf = 1 - R0 / (reach + 1);
            layer.push([A[0], A[1], 1, 0], [R0 + 0.6, R0 + 0.6, KIND.band, 0.8 * kf * kf * al], [R0, 0.07 * gain, 0, 0], [0, 0, 0, gain], [...hot, 1], [...hot, 1]);
          }
        }
        const tl = anim === 'snap' ? 0.143 * dur : anim === 'sonar' ? 0.45 * dur : -1;
        if (ex === null && tl > 0 && t0 >= tl && t0 <= tl + 0.5) {
          const kf = (t0 - tl) / 0.5, R0 = M.capR * gain * (1 + 1.3 * kf);
          layer.push([B[0], B[1], 1, 0], [R0 + 0.6, R0 + 0.6, KIND.band, 0.9 * (1 - kf) ** 2 * al], [R0, 0.09 * gain, 0, 0], [0, 0, 0, gain], [...hot, 1], [...hot, 1]);
        }
        off = (M.capR + 0.8) * gain;
      } else {
        // the dashed line, drawn out from the marker; cut at the inner rings' band ('rings') or near the feet ('tether')
        const rA = M.style === 'rings' ? R.innerR * scD : M.footR * gain, rB = M.style === 'rings' ? R.innerR * scA : M.footR * gain;
        if (Lh > 1e-3 && f > 0) {
          const hw = M.hw * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
          layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / L2, dz / L2], [Lh + m, hw + m, KIND.edge, al],
            [Lh, hw, rA, rB], [f, 1, M.dashM * gain, gain], col, [M.fill, (age * M.march) % (M.dashM * gain), 0, 0]);
        }
        if (M.style === 'rings') {
          rings.push({ xy: [A[0], A[1]], side, sc: scD, al: aeD * al, player: q.d, style: R });
          rings.push({ xy: [B[0], B[1]], side: other, sc: scA, al: aeA * al, player: q.a, style: R });
          off = (R.R + 0.9) * gain;
        }
      }
      // the gap, lying beside the pair's middle
      if (showLabels && f > 0) {
        labels.push({ x: (A[0] + B[0]) / 2 - (dz / L2) * off, z: (A[1] + B[1]) / 2 + (dx / L2) * off, text: `${Math.max(1, Math.round(q.dist))} m`, alpha: TELE.unit.labelAlpha * Math.min(1, f * 1.5) * al, sizeM: M.labelM * gain, rgb: [...st.w] as [number, number, number] });
      }
    });
  };

  /** a stroke of the Tactics pen (StrokeItem): lines on the ground strip (round-ended, run dashed), heads, dots and
   *  rings on the ground layer, all in its ink and without glow */
  const drawStroke = (it: StrokeItem, ex: number | null, k: number, gain: number, labels: GroundLabel[]) => {
    const S = TELE.stroke, Ar = TELE.arrow, al = (it.alpha ?? 1) * (ex === null ? 1 : Math.max(0, 1 - ex / S.exitS));
    if (al <= 0.002 || !it.pts.length) return;
    const c = hex(S.inks[it.ink] ?? S.inks.white), col = [c[0], c[1], c[2], 1], w = S.w * gain, hw = w / 2;
    const first = it.pts[0], last = it.pts[it.pts.length - 1];
    const ribbon = (pts: XY[], dash = false) => trails.line(pts.map(([x, z]) => ({ x, y: 0, z, half: hw, r: c[0], g: c[1], b: c[2], a: al })), () => 0.12,
      { ends: 'round', dash: dash ? { period: S.dashM * gain, fill: S.dashFill } : undefined });
    // a dot, or a plain ring (radius R, band half-width bw), on the ground layer (kind 13's dumbbell and hoops at one point)
    const pushDot = (at: XY, r: number) => layer.push([at[0], at[1], 1, 0], [r + 0.6, r + 0.6, KIND.pair, al], [0, 0, 0, 0], [1, 0, 0, gain], col, col, [0, r, 0, 0, 0, 0, 0, 0]);
    const pushRing = (at: XY, R: number, bw: number) => layer.push([at[0], at[1], 1, 0], [R + bw + 0.6, R + bw + 0.6, KIND.pair, al], [0, 0, bw, 0], [1, 4, 0, gain], col, col, [0, 0, 0, 0, 0, 0, R, 0]);
    // an arrow along a path: the barbed head (kind 11 alone, no glow) at its end, pointing along its last head-length,
    // the shaft running into the head's notch
    const arrow = (path: XY[], dash: boolean) => {
      const L = pathLen(path);
      if (L < 0.3) { pushDot(last, hw); return; }
      const hd = Math.min(S.head * w, 0.6 * L), tip = path[path.length - 1], back = trimEnd(path, hd);
      const b = back[back.length - 1], u: XY = [tip[0] - b[0], tip[1] - b[1]], ul = Math.hypot(u[0], u[1]) || 1;
      u[0] /= ul; u[1] /= ul;
      ribbon(trimEnd(path, hd * (Ar.notch - 0.05)), dash);
      const h = hd / 2, m = hd + 0.6;
      layer.push([tip[0] - u[0] * h, tip[1] - u[1] * h, u[0], u[1]], [h + m, m, KIND.arrow, al], [h, w, hd, Ar.notch], [1, 3, 0, gain], col, [Ar.spread, 0, 0, 1]);
    };
    switch (it.tool) {
      case 'pass': arrow([first, last], false); break;
      case 'run': arrow(chaikin(it.pts, S.smooth), true); break;
      case 'dribble': {
        // a wave either side of the straight way, easing in from the start and flattening out before the head
        const L = Math.hypot(last[0] - first[0], last[1] - first[1]);
        if (L < 0.3) { pushDot(last, hw); break; }
        const ux = (last[0] - first[0]) / L, uz = (last[1] - first[1]) / L, flat = L - Math.min(S.head * w, 0.6 * L) - 0.3, n = Math.max(2, Math.ceil(L / 0.1)), path: XY[] = [];
        for (let i = 0; i <= n; i++) {
          const sv = (L * i) / n, amp = S.waveAmp * gain * Math.min(1, sv / 0.5) * Math.min(1, Math.max(0, (flat - sv) / (0.5 * S.waveM * gain))), o = Math.sin((2 * Math.PI * sv) / (S.waveM * gain)) * amp;
          path.push([first[0] + ux * sv - uz * o, first[1] + uz * sv + ux * o]);
        }
        arrow(path, false);
        break;
      }
      case 'circle': {
        const at: XY = [first[0], first[1]];
        if (it.player !== undefined) anchors.player(it.player, clock.t, TELE.smoothS, at);
        pushRing(at, S.ringR * gain, S.ringW * gain * 0.5);
        break;
      }
      case 'zone': {
        // the rectangle of the two corners as a zone (the zones' solid edge and stripes, kind 6), all in the ink
        const x0 = Math.min(first[0], last[0]), x1 = Math.max(first[0], last[0]), y0 = Math.min(first[1], last[1]), y1 = Math.max(first[1], last[1]);
        if (x1 - x0 < 0.2 || y1 - y0 < 0.2) break;
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, zhw = S.zoneHW * gain, m = zhw + 0.8;
        const V = st.poly, X = st.polyX, r2 = Math.SQRT1_2;
        V.fill(0); V.set([-hx, -hy, hx, -hy, hx, hy, -hx, hy]);
        X.set(V.subarray(4, 16)); X[12] = r2; X[13] = r2; X[14] = r2 * (cx + cy); X[15] = 0;
        layer.push([cx, cy, 1, 0], [hx + m, hy + m, KIND.poly, al], V.subarray(0, 4), [1, TELE.zone.stripeW * gain, zhw, gain], [...c, 4], [...c, mixPair(TELE.zone.zebra, k)], X);
        break;
      }
      case 'measure': {
        const L = Math.hypot(last[0] - first[0], last[1] - first[1]);
        if (L < 0.05) { pushDot(first, S.dotR * gain); break; }
        const ux = (last[0] - first[0]) / L, uz = (last[1] - first[1]) / L, mx = (first[0] + last[0]) / 2, mz = (first[1] + last[1]) / 2, m = S.dotR * gain + 0.6;
        layer.push([mx, mz, ux, uz], [L / 2 + m, m, KIND.pair, al], [L / 2, 0, hw * 0.75, 0], [1, 0, 0, gain], col, col, [0, S.dotR * gain, 0, 0, 0, 0, 0, 0]);
        // the metres beside the line's middle, on the camera's side
        let nx = -uz, nz = ux;
        if ((st.camPos.x - mx) * nx + (st.camPos.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
        const off = S.labelOff * gain + S.labelM * gain * 0.5;
        labels.push({ x: mx + nx * off, z: mz + nz * off, text: `${L.toFixed(1)} m`, alpha: al, sizeM: S.labelM * gain, rgb: [c[0], c[1], c[2]] });
        break;
      }
      default: {
        const path = chaikin(it.pts, S.smooth);
        if (path.length < 2 || pathLen(path) < 0.05) pushDot(first, hw);
        else ribbon(path);
      }
    }
  };

  /** a pass's arc height in metres (0: along the ground): a number as given; true: from its length (TELE.passArrow
   *  loftK, within loftMin..loftMax); 'track': the ball's own highest point between the item's kick and reception */
  const passLoft = (it: PassArrowItem, A: XY, B: XY): number => {
    const Pa = TELE.passArrow, auto = () => Math.min(Pa.loftMax, Math.max(Pa.loftMin, Pa.loftK * Math.hypot(B[0] - A[0], B[1] - A[1])));
    if (typeof it.loft === 'number') return Math.max(0, it.loft);
    if (it.loft === true) return auto();
    if (it.loft === 'track') {
      if (!it.t) return auto();
      let top = 0;
      for (let tt = it.t[0]; tt <= it.t[1]; tt += 0.04) { const b = ballAt(data.pkg, tt); if (b && (b[2] ?? 0) > top) top = b[2] ?? 0; }
      return top;
    }
    return 0;
  };
  /** a lofted pass (LoftArrows.tsx): the arrow along the ball's path in the air, and on the grass the shadow of its flat
   *  track, drawn with the reveal and not fading with the tail (no ring where it lands) */
  const pushLoft = (A: XY, B: XY, H: number, td: number, alpha: number, k: number, gain: number) => {
    const Ar = TELE.arrow, Pa = TELE.passArrow, w = Ar.w * gain;
    surfaceColour(TELE.color.white, k, st.w);
    st.lofts.list.push({ tail: [A[0], A[1]], tip: [B[0], B[1]], H, w, S: Ar.head * w, notch: Ar.notch, spread: Ar.spread, tailFade: Ar.tailFade, t: td, alpha, rgb: [...st.w] as [number, number, number], head: Pa.loftHead });
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
    if (L < 0.5 || td <= 0) return;
    const sc = hex(Pa.shadowRGB), ux = dx / L, uz = dz / L, shown = L * td, sh = Pa.shadowHalfK * w, n = Math.max(2, Math.ceil(shown / 0.5));
    const track = Array.from({ length: n + 1 }, (_, i) => ({ x: A[0] + (ux * shown * i) / n, y: 0, z: A[1] + (uz * shown * i) / n, half: sh, r: sc[0], g: sc[1], b: sc[2], a: Pa.shadowA * alpha, soft: true }));
    trails.line(track, () => sh);
  };
  /** a pass arrow from A to B (scene x, z), in TELE.passArrow.look (the pen's pass, in the run's
   *  family; 'barbed' is §13's arrow, pitch_prism's, the default), along the ground or lofted to `loft` m */
  const drawPass = (A: XY, B: XY, age: number, ex: number | null, alpha: number, k: number, gain: number, loft = 0) => {
    const Pa = TELE.passArrow, Pr = TELE.press, look = Pa.look, td = arrowT(age, ex);
    if (loft > 0.05) { pushLoft(A, B, loft, td, alpha, k, gain); return; }
    if (look === 'barbed') { pushPass(A, B, td, alpha, k, gain); return; }
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
    if (L < 0.6 || td <= 0) return;
    surfaceColour(TELE.color.white, k, st.w);
    const col = [...st.w, 1], ux = dx / L, uz = dz / L, mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], rA = Pa.footR * gain;
    if (look !== 'landing') {
      // the chevrons, flowing from the passer
      const per = (look === 'line' ? Pa.lineGapM : Pa.gapM) * gain, phase = ((Math.max(0, age) * Pa.flow) % per + per) % per;
      const m = Pr.chevHalf * gain * 1.5 + 3 * TELE.glow.sigma * gain + 0.6;
      layer.push([mid[0], mid[1], ux, uz], [L / 2 + m, m, KIND.chevrons, alpha], [L / 2, Math.min(Pr.chevHalf * gain, 0.45 * per), Pr.chevStroke * gain, per], [td, phase, 0, gain], col, [rA, 0, 0, 0]);
    }
    if (look !== 'chevrons') {
      // the slim line, drawn out from the passer; stopping at the landing ring
      const hw = Pa.lineHW * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6, rB = look === 'landing' ? Pa.landR * gain : 0;
      layer.push([mid[0], mid[1], ux, uz], [L / 2 + m, hw + m, KIND.edge, alpha], [L / 2, hw, rA, rB], [td, 1, 0, gain], col, [1, 0, 0, 0]);
    }
    if (look === 'landing') {
      // the ring where it lands, popping in as the line arrives
      const [se, ae] = ringEnter(age - TELE.arrow.drawS * 0.8), [sx, ax] = ex === null ? [1, 1] : ringExit(ex), R = Pa.landR * gain * se * sx;
      if (R > 1e-3) layer.push([B[0], B[1], 1, 0], [R + 0.6, R + 0.6, KIND.band, alpha * ae * ax], [R, Pa.landW * gain, 0, 0], [0, 0, 0, gain], col, col);
    }
  };

  /** the pass chances (PassProbItem): a link from the carrier to every team-mate, best first, in TELE.passProb.look */
  const drawPassProb = (it: PassProbItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const S = TELE.passProb, R = TELE.ring, tt = it.at ?? clock.t, look = it.look ?? S.look, A: XY = [0, 0], B: XY = [0, 0];
    if (!anchors.player(it.carrier, tt, TELE.smoothS, A)) return;
    const left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex), side = sideOf(it.carrier);
    const [se, ae] = ringEnter(age);
    rings.push({ xy: [A[0], A[1]], side, sc: se * sx * gain, al: ae * ax, player: it.carrier, style: R });
    surfaceColour(TELE.color.white, k, st.w);
    const amb: [number, number, number] = [0, 0, 0]; surfaceColour(TELE.color.amber, k, amb);
    const c: [number, number, number] = [0, 0, 0];
    [...it.edges].sort((a, b) => Number(!!a.offside) - Number(!!b.offside) || b.p - a.p).forEach((e, rank) => {
      if (e.to === it.carrier || !anchors.player(e.to, tt, TELE.smoothS, B)) return;
      const ea = age - CASCADE.edgeDelay - rank * S.stagger;
      if (e.offside) {
        // an offside team-mate: the offside position's amber ring, no link, no number
        const [re, ra] = ringEnter(ea), Rh = S.offR * gain * re * sx, bw = S.offW * gain * 0.5, col = [...amb, 1];
        if (Rh > 1e-3) layer.push([B[0], B[1], 1, 0], [Rh + bw + 0.6, Rh + bw + 0.6, KIND.pair, ra * ax], [0, 0, bw, 0], [1, 4, 0, gain], col, col, [0, 0, 0, 0, 0, 0, Rh, 0]);
        return;
      }
      const dx = B[0] - A[0], dz = B[1] - A[1], Lh = Math.hypot(dx, dz) / 2, f = edgeDraw(ea) * left;
      if (Lh < 0.5 || f <= 0) return;
      const p = Math.min(0.99, Math.max(0, e.p));
      if (look === 'width') {
        // the passing network's own look, so the two marks read as one family:
        // TELE.net's width and brightness by the chance, welded to the inner rings at both ends, drawn out best first,
        // each team-mate wearing the double ring as it reaches him
        const N = TELE.net, hw = (N.minHW + (N.maxHW - N.minHW) * p) * gain, al = (N.minA + (1 - N.minA) * p) * ax, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
        // in the carrier's team colour as the other team marks (TELE.passProb.ink),
        // or white as the network's
        const ew = age - CASCADE.edgeDelay - rank * N.stagger, fw = edgeDraw(ew) * left;
        if (S.ink === 'team') inkColour('team', side, k, c); else c.splice(0, 3, ...st.w);
        const lc = [...c, 1];
        if (fw > 0) layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, al],
          [Lh, hw, R.innerR * gain, R.innerR * gain], [fw, 1, 0, gain], lc, lc);
        const [re, ra] = ringEnter(age - (rank + 1) * CASCADE.ringStagger);
        rings.push({ xy: [B[0], B[1]], side: sideOf(e.to), sc: re * sx * gain, al: ra * ax, player: e.to, style: R });
        return;
      }
      if (look === 'ramp') rampCol((p - S.rampLo) / (S.rampHi - S.rampLo), k, c); else c.splice(0, 3, ...st.w);
      const col = [...c, 1], hw = (look === 'mid' ? S.midHW : S.minHW + (S.maxHW - S.minHW) * p) * gain;
      const al = ax, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
      layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, al],
        [Lh, hw, R.innerR * gain, S.endR * gain], [f, 1, 0, gain], col, col);
      // the chance: on the link, or on the grass by the team-mate towards the camera
      let lx: number, lz: number;
      if (look === 'mid') {
        const L2 = 2 * Lh, ux = dx / L2, uz = dz / L2, off = S.midOff * gain;
        lx = A[0] + dx * S.midAt - uz * off; lz = A[1] + dz * S.midAt + ux * off;
      } else {
        const vx = st.camPos.x - B[0], vz = st.camPos.z - B[1], vl = Math.hypot(vx, vz) || 1;
        lx = B[0] + (vx / vl) * S.feetOff * gain; lz = B[1] + (vz / vl) * S.feetOff * gain;
      }
      labels.push({ x: lx, z: lz, text: `${Math.round(p * 100)}%`, alpha: TELE.unit.labelAlpha * Math.min(1, f * 1.5) * ax, sizeM: S.labelM * gain, rgb: [...c] as [number, number, number] });
    });
  };

  /** a number on the pitch (GaugeItem): the gauge, the target or the pie, the number counting up as it enters */
  const drawGauge = (it: GaugeItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const G = TELE.gauge, look = it.look ?? G.look, side = it.side ?? 'att', other = side === 'att' ? 'def' : 'att';
    const v1 = Array.isArray(it.value) ? seriesAt(it.value, clock.t) : it.value;
    // the arc growing: to `from` after the delay, held, then on to the value (or straight to it)
    const sm = (x: number) => { const q = Math.min(1, Math.max(0, x)); return q * q * (3 - 2 * q); };
    const d0 = it.delayS ?? G.growDelayS, first = it.from ?? v1;
    const g1 = sm((age - d0) / G.growS), g2 = it.from === undefined ? 0 : sm((age - d0 - G.growS - (it.holdS ?? 0)) / (it.countS ?? G.countS));
    const v = Math.min(1, Math.max(0, first * g1 + (v1 - first) * g2));
    // the gauge itself appears just before its arc starts (an empty gauge does not wait on the pitch)
    const tin = sm((age - Math.max(0, d0 - G.trackS)) / G.trackS), [sx, ax] = ex === null ? [1, 1] : ringExit(ex), sc = (G.startK + (1 - G.startK) * tin) * sx, al = tin * ax;
    if (al <= 0.002) return;
    // the share's colour: the other team's at none, the side's at all
    const cu = sm((v - G.colourLo) / (G.colourHi - G.colourLo)), mix = G.colourPath === 'hue' ? mixHue : mixLab;
    const c = mix(inkColour('team', other, k, [0, 0, 0]), inkColour('team', side, k, [0, 0, 0]), cu);
    surfaceColour(TELE.color.white, k, st.w);
    const [x, z] = it.at, R = (it.r ?? G.r) * gain * sc;
    // the screen's up on the pitch, and which way is clockwise on screen
    const ux0 = st.camU.x, uz0 = st.camU.z, ul = Math.hypot(ux0, uz0) || 1, ux = ux0 / ul, uz = uz0 / ul;
    const cw = Math.sign((-uz) * st.camR.x + ux * st.camR.z) || 1;
    const text = (it.text ?? '{v}').replace('{v}', `${Math.round(v * 100)}%`);
    if (look === 'target') {
      rings.push({ xy: [x, z], side, sc: G.targetK * sc * gain, al, player: -1, style: TELE.ring });
      const off = (TELE.ring.R * G.targetK + 0.6) * gain + G.labelM * gain * 0.9;
      labels.push({ x: x + st.camR.x * off, z: z + st.camR.z * off, text, alpha: al, sizeM: G.labelM * gain * 0.9, rgb: [...st.w] as [number, number, number] });
      return;
    }
    const m = R + G.bandW * gain + 0.8, pie = look === 'pie' ? 1 : 0;
    layer.push([x, z, ux, uz], [m, m, KIND.arc, al], [R, (G.bandW / 2) * gain, 0, 0], [v, cw, pie, gain], [...c, pie ? G.pieA : 1], [...st.w, G.trackA]);
    if (pie) layer.push([x, z, 1, 0], [R + 0.6, R + 0.6, KIND.band, al], [R, 0.06 * gain, 0, 0], [0, 0, 0, gain], [...st.w, 1], [...st.w, 1]);
    labels.push({ x, z, text, alpha: al, sizeM: G.labelM * gain * (R > 0 ? 1 : 0), rgb: [...st.w] as [number, number, number] });
  };
  /** a series [t, v][] at clip time t, linearly, held at its ends */
  const seriesAt = (s: [number, number][], t: number) => {
    if (!s.length) return 0;
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) if (t <= s[i][0]) { const [t0, a] = s[i - 1], [t1, b] = s[i]; return a + ((b - a) * (t - t0)) / Math.max(1e-6, t1 - t0); }
    return s[s.length - 1][1];
  };

  /** the arrows' shared draw-on: 0..1 drawn, tail to head, un-drawn to leave */
  const arrowT = (age: number, ex: number | null) => (ex === null ? EASE_OUT(Math.min(1, Math.max(0, age / TELE.arrow.drawS))) : 1 - EASE_OUT(Math.min(1, ex / exitS({ kind: 'pass' } as Item))));
  /** a straight pass arrow from A to B (scene x, z) */
  const pushPass = (A: XY, B: XY, t: number, alpha: number, k: number, gain: number) => {
    const Ar = TELE.arrow, dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
    if (L < 0.5 || t <= 0) return;
    const w = Ar.w * gain, S = Ar.head * w, c: [number, number, number] = [0, 0, 0];
    surfaceColour(TELE.color.white, k, c);
    const m = S + 1.2 * w + 0.6;
    layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / L, dz / L], [L / 2 + m, m, KIND.arrow, alpha], [L / 2, w, S, Ar.notch],
      [t, 0, 0, gain], [...c, 1], [Ar.spread, Ar.period * w, Ar.period * w * Ar.fill, Ar.tailFade]);
  };
  /** a run along a polyline (scene x, z): octagon dashes laid from the head's notch backwards and placed along the
   *  curve one by one (each turned to the path there), marching towards the head; the head at the drawn end */
  const pushRun = (path: XY[], t: number, age: number, alpha: number, k: number, gain: number) => {
    const Ar = TELE.arrow, w = Ar.w * gain, S = Ar.head * w, P = Ar.period * w, D = P * Ar.fill;
    if (path.length < 2 || t <= 0) return;
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const Lt = cum[cum.length - 1];
    if (Lt < 1) return;
    // a point and the direction at arclength s
    const at = (s: number): [number, number, number, number] => {
      s = Math.min(Lt, Math.max(0, s));
      let i = 1; while (i < path.length - 1 && cum[i] < s) i++;
      const a = path[i - 1], b = path[i], seg = Math.max(1e-6, cum[i] - cum[i - 1]), u = (s - cum[i - 1]) / seg, dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, dx, dz];
    };
    const c: [number, number, number] = [0, 0, 0];
    surfaceColour(TELE.color.amber, k, c);
    const col = [...c, 1], C2 = [Ar.spread, P, D, Ar.tailFade], shown = Lt * t, notch = shown - S * Ar.notch, ph = ((Math.max(0, age) / Ar.marchS) * P) % P;
    // the dashes, from the notch back to the tail
    for (let kk = 0; ; kk++) {
      const front = notch - Math.max(0, kk * P - ph), rear = Math.max(0, notch - (kk * P - ph + D));
      if (front <= 0) break;
      if (front - rear < 0.02) continue;
      const [x, z, ux, uz] = at((front + rear) / 2), hd = (front - rear) / 2, m = w + 0.4;
      layer.push([x, z, ux, uz], [hd + m, m, KIND.arrow, alpha], [hd, w, S, Ar.notch], [1, 2, 0, gain], col, C2);
    }
    // the head, its tip at the drawn end, turned along the path just behind it
    const [hx, hz] = at(shown), [, , ux, uz] = at(Math.max(0, shown - 0.5 * S)), m = S + 0.6;
    layer.push([hx - ux * S * 0.5, hz - uz * S * 0.5, ux, uz], [S * 0.5 + m, m, KIND.arrow, alpha], [S * 0.5, w, S, Ar.notch], [1, 3, 0, gain], col, C2);
  };

  /** pitch control: the grid recomputed when the moment moves (at most every TELE.control.everyS s), the reveal from
   *  the ball, the colours */
  const drawControl = (it: ControlItem, age: number, ex: number | null, k: number) => {
    const C = TELE.control, S = st.ctrl.s, tt = it.at ?? clock.t;
    if (Math.abs(tt - st.ctrlT) > (it.at !== undefined ? 0.01 : C.everyS) || st.ctrlT < -1e8) {
      const att: XY[] = [], attV: XY[] = [], def: XY[] = [], defV: XY[] = [], q: XY = [0, 0], q0: XY = [0, 0];
      for (let p = 0; p < P; p++) {
        if (!anchors.player(p, tt, TELE.smoothS, q) || !anchors.player(p, tt - 0.2, TELE.smoothS, q0)) continue;
        const v: XY = [(q[0] - q0[0]) / 0.2, (q[1] - q0[1]) / 0.2];
        if (p < nAtt) { att.push([q[0], q[1]]); attV.push(v); } else { def.push([q[0], q[1]]); defV.push(v); }
      }
      const b: XY = [0, 0], hasB = anchors.resolve({ ball: true, at: tt }, tt, 0, b), pts: XY[] = [];
      for (let j = 0; j < CTRL_NZ; j++) for (let i = 0; i < CTRL_NX; i++) pts.push([-52.5 + (105 * i) / (CTRL_NX - 1), -34 + (68 * j) / (CTRL_NZ - 1)]);
      if (att.length && def.length) { S.grid.set(pitchControl(pts, att, attV, def, defV, hasB ? b : [0, 0])); S.dirty = true; }
      if (hasB) { S.cx = b[0]; S.cz = b[1]; }
      st.ctrlT = tt;
    }
    const reach = 130;
    S.reveal = ex === null ? EASE_OUT(Math.min(1, Math.max(0, age / C.revealS))) * reach : reach;
    S.alpha = ex === null ? 1 : 1 - Math.min(1, ex / exitS(it));
    inkColour('team', 'att', k, S.att); inkColour('team', 'def', k, S.def); surfaceColour(TELE.color.white, k, S.line);
    S.k = k; S.on = true;
  };

  /** a player's vision: his head's direction (nose from between the ears, averaged over 0.2 s), the darkness opening
   *  from behind him, the edges of his central view drawn out on the grass */
  const headDir = (p: number, tt: number, out: [number, number]) => {
    const J = data.joints;
    if (!J) return false;
    const nose = J.names.indexOf('nose'), le = J.names.indexOf('lEar'), re = J.names.indexOf('rEar');
    let x = 0, z = 0;
    for (const dt of [-0.1, 0, 0.1]) {
      if (!jointAt(J, p, nose, tt + dt, st.v) || !jointAt(J, p, le, tt + dt, st.visA) || !jointAt(J, p, re, tt + dt, st.visB)) continue;
      x += st.v.x - (st.visA.x + st.visB.x) / 2; z += st.v.z - (st.visA.z + st.visB.z) / 2;
    }
    const l = Math.hypot(x, z);
    if (l < 1e-4) return false;
    out[0] = x / l; out[1] = z / l;
    return true;
  };
  const drawVision = (it: VisionItem, age: number, ex: number | null, k: number, gain: number) => {
    const Vs = TELE.vision, tt = it.at ?? clock.t, q: XY = [0, 0], d: [number, number] = [1, 0];
    // several players: each one's view; what none of them sees is dark. The edges below: the first's
    const who = (Array.isArray(it.player) ? it.player : [it.player]).slice(0, VIS_MAX), J = data.joints, nose = J ? J.names.indexOf('nose') : -1;
    let n = 0;
    for (const p of who) if (anchors.player(p, tt, TELE.smoothS, q) && headDir(p, tt, d)) {
      VIS.uVisP.value[n].set(q[0], q[1]); VIS.uVisD.value[n].set(d[0], d[1]);
      // his eyes: the nose's height, a little behind it (the skeleton's nose; 1.7 m over his feet without one)
      if (J && nose >= 0 && jointAt(J, p, nose, tt, st.v)) VIS.uVisE.value[n].set(st.v.x - d[0] * 0.08, st.v.y, st.v.z - d[1] * 0.08);
      else VIS.uVisE.value[n].set(q[0], 1.7, q[1]);
      n++;
    }
    if (!n) return;
    VIS.uVisN.value = n; q[0] = VIS.uVisP.value[0].x; q[1] = VIS.uVisP.value[0].y; d[0] = VIS.uVisD.value[0].x; d[1] = VIS.uVisD.value[0].y;
    VIS.uVisDark.value.set(Vs.darkBack, Vs.darkPeri); VIS.uVisKeep.value = Vs.keepM;
    const out = ex === null ? 1 : 1 - EASE_OUT(Math.min(1, ex / exitS(it)));
    let reveal = 1e4;
    if (Vs.anim === 'open') {
      // the darkness: its edges open from straight behind him to where his view ends
      const open = ex === null ? EASE_OUT(Math.min(1, Math.max(0, age / Vs.openS))) : out;
      const ang = (deg: number) => Math.cos((Math.PI - (Math.PI - (deg * Math.PI) / 180) * open));
      VIS.uVisOn.value = open > 0.001 ? 1 : 0; VIS.uVisK.value = 1; VIS.uVisR.value = 1e4; VIS.uVisWash.value = 0;
      VIS.uVisCos.value.set(ang(Vs.centralDeg), ang(Vs.peripheralDeg));
    } else {
      // from his eyes: the scene dims, then his sight spreads out from his eyes, a bright band at its front
      const cos = (deg: number) => Math.cos((deg * Math.PI) / 180), u = Math.min(1, Math.max(0, (age - Vs.revealAt) / Vs.revealS));
      const dim = ex === null ? EASE_OUT(Math.min(1, Math.max(0, age / Vs.dimS))) : out;
      reveal = ex === null ? (age < Vs.revealAt ? 0 : Vs.revealM * (1 - (1 - u) ** 2)) : 1e4;
      VIS.uVisOn.value = dim > 0.001 ? 1 : 0; VIS.uVisK.value = dim; VIS.uVisR.value = reveal; VIS.uVisWash.value = ex === null ? Vs.wash * (1 - u) : 0;
      VIS.uVisCos.value.set(cos(Vs.centralDeg), cos(Vs.peripheralDeg));
    }
    // the fan of light from his eyes (the first player's), as his sight goes out
    if (Vs.beam) {
      const e = VIS.uVisE.value[0];
      st.beams.list.push({ eye: [e.x, e.y, e.z], dir: [d[0], d[1]], half: (Vs.centralDeg * Math.PI) / 180, reach: Math.min(reveal, Vs.beamLenM), alpha: Vs.beamA * (Vs.anim === 'open' ? out : VIS.uVisK.value), land: Vs.beamLandM, len: Vs.beamLenM });
    }
    // the edges of his central view, drawn out from him on the grass, fading with distance (off by default)
    if (!Vs.edges) return;
    surfaceColour(TELE.color.white, k, st.w);
    const f = edgeDraw(age - 0.15) * retract(ex), white = [...st.w, 1];
    if (f > 0) for (const s of [-1, 1]) {
      const a = (s * Vs.centralDeg * Math.PI) / 180, ux = d[0] * Math.cos(a) - d[1] * Math.sin(a), uz = d[0] * Math.sin(a) + d[1] * Math.cos(a);
      const L = Vs.edgeM * gain, A: XY = [q[0] + ux * 0.9 * gain, q[1] + uz * 0.9 * gain], B: XY = [q[0] + ux * L, q[1] + uz * L];
      const Lh = (L - 0.9 * gain) / 2, hw = Vs.edgeHW * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
      layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, ux, uz], [Lh + m, hw + m, KIND.edge, 0.85], [Lh, hw, 0, 0], [f, 1, 0, gain], white, white);
    }
  };

  /** a line-breaking pass: the plan (once per item: the kick, the reception, the units at the kick, which are broken
   *  and where and when the ball crosses each), then each frame the units with their flashes and cracks, the count */
  const planBreak = (it: LineBreakItem): LineBreakPlan | null => {
    const own = (data.pkg.meta as { pass?: { t: number; receiver: number; lines?: number; last?: string } }).pass;
    if (!own && (it.kick === undefined || it.lines === undefined)) return null;
    const meta = { lines: it.lines ?? own?.lines, last: it.last ?? own?.last, receiver: it.receiver ?? own?.receiver };
    const kick = it.kick ?? contactTime(data, own!.t);
    const evs = (data.pkg as { events?: { t: number; player?: number }[] }).events ?? [];
    const rec = it.reception ?? evs.find((e) => e.player === meta.receiver && e.t > kick + 0.2 && e.t < kick + 6)?.t ?? kick + 2;
    // the defending outfield players at the kick, split into units, each ordered across the pitch
    const players: { p: number; xy: XY }[] = [], q: XY = [0, 0];
    for (let p = nAtt; p < P; p++) if (!keepers.has(p) && anchors.player(p, kick, 0, q)) players.push({ p, xy: [q[0], q[1]] });
    if (players.length < 4) return null;
    const u = splitUnits(players, (xy) => xy[0], { split: null, order: [] }), at = new Map(players.map((r) => [r.p, r.xy]));
    const groups = [u.back, u.mid, u.front].map((g) => g.map((p) => ({ p, xy: at.get(p)! })).sort((a, b) => a.xy[1] - b.xy[1]));
    // Opta's broken units: `lines` of them, the deepest `last` (the back line) or `secondToLast` (the midfield)
    const deepest = meta.last === 'secondToLast' ? 1 : 0, n = Math.max(0, Math.min(3 - deepest, meta.lines ?? 0));
    const broken = new Set(Array.from({ length: n }, (_, i) => deepest + i));
    // where each broken line is crossed: the first moment after the kick the ball is past it (x beyond the line's x at
    // the ball's y, held flat beyond its end players), and the point on the line there
    const lineX = (g: { xy: XY }[], y: number) => {
      if (y <= g[0].xy[1]) return g[0].xy[0];
      for (let j = 0; j + 1 < g.length; j++) if (y <= g[j + 1].xy[1]) return g[j].xy[0] + ((y - g[j].xy[1]) / Math.max(1e-6, g[j + 1].xy[1] - g[j].xy[1])) * (g[j + 1].xy[0] - g[j].xy[0]);
      return g[g.length - 1].xy[0];
    };
    const cross = groups.map((g, gi) => {
      if (!broken.has(gi) || g.length < 2) return null;
      for (let tt = kick; tt <= rec + 0.4; tt += 0.02) {
        const b = ballAt(data.pkg, tt);
        if (b && b[0] > lineX(g, b[1])) return { t: tt, xy: [lineX(g, b[1]), b[1]] as XY };
      }
      return null;
    });
    const rb = ballAt(data.pkg, rec);
    return { kick, rec, groups, broken, cross, recXY: rb ? [rb[0], rb[1]] : null, total: n };
  };
  const drawBreak = (it: LineBreakItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    let plan = st.breaks.get(it.id);
    if (plan === undefined) { plan = planBreak(it); st.breaks.set(it.id, plan); }
    if (!plan) return;
    const Lb = TELE.linebreak, R = TELE.ring, t = clock.t, left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
    const f = edgeDraw(age - CASCADE.edgeDelay) * left, hw = (TELE.unit.lineW / 2) * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
    inkColour('team', 'def', k, st.c1); surfaceColour(TELE.color.white, k, st.w);
    let rank = 0, count = 0;
    plan.groups.forEach((g, gi) => {
      const isB = plan!.broken.has(gi), dim = isB ? 1 : Lb.dimA, cr = plan!.cross[gi];
      const crossed = !!cr && t >= cr.t, e = cr ? Math.exp(-Math.pow((t - cr.t) / (Lb.flashS / 2), 2)) * (t >= cr.t - 0.05 ? 1 : 0) : 0;
      if (crossed) count++;
      // the line's colour: the team's, flashing to white as the ball crosses
      const col = [st.c1[0] + (st.w[0] - st.c1[0]) * e, st.c1[1] + (st.w[1] - st.c1[1]) * e, st.c1[2] + (st.w[2] - st.c1[2]) * e, 1];
      const gap = crossed ? Lb.gapM * gain * EASE_OUT(Math.min(1, (t - cr!.t) / Lb.gapS)) : 0;
      for (let j = 0; j + 1 < g.length; j++) {
        const A = g[j].xy, B = g[j + 1].xy, dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
        if (L < 1e-3 || f <= 0) continue;
        const ux = dx / L, uz = dz / L, rA = R.innerR * gain, rB = R.innerR * gain;
        // the crack: the segment holding the crossing point splits there, its two ends pulled apart
        const s0 = cr && crossed ? (cr.xy[0] - A[0]) * ux + (cr.xy[1] - A[1]) * uz : -1;
        const onSeg = crossed && s0 > 0 && s0 < L && Math.abs(-(cr!.xy[0] - A[0]) * uz + (cr!.xy[1] - A[1]) * ux) < 0.5;
        const pieces: [XY, XY, number, number][] = onSeg
          ? [[A, [A[0] + ux * Math.max(0, s0 - gap / 2), A[1] + uz * Math.max(0, s0 - gap / 2)], rA, 0], [[A[0] + ux * Math.min(L, s0 + gap / 2), A[1] + uz * Math.min(L, s0 + gap / 2)], B, 0, rB]]
          : [[A, B, rA, rB]];
        for (const [P0, P1, r0, r1] of pieces) {
          const ddx = P1[0] - P0[0], ddz = P1[1] - P0[1], Lh = Math.hypot(ddx, ddz) / 2;
          if (Lh < 0.05) continue;
          layer.push([(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2, ddx / (2 * Lh), ddz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, ax * dim], [Lh, hw * (1 + 0.6 * e), r0, r1], [f, 0, 0, gain], col, col);
        }
      }
      for (const q of g) {
        const [se, ae] = ringEnter(age - rank++ * CASCADE.ringStagger);
        rings.push({ xy: q.xy, side: 'def', sc: se * sx * gain, al: ae * ax * dim, player: q.p, style: R });
      }
      // the burst where the ball crossed: sparks thrown up and out, gone in half a second (clip time)
      if (cr && t >= cr.t && t <= cr.t + 0.6 && TELE.spark.on) {
        const a = t - cr.t, hot = [st.w[0], st.w[1], st.w[2]];
        for (let i = 0; i < Lb.burst; i++) {
          const h1 = hash01(gi, i, 1), h2 = hash01(gi, i, 2), h3 = hash01(gi, i, 3), ang = h1 * Math.PI * 2, sp = 3 + 5 * h2, up = 1 + 3 * h3;
          const x = cr.xy[0] + Math.cos(ang) * sp * a, z = cr.xy[1] + Math.sin(ang) * sp * a, y = Math.max(0.02, 0.05 + up * a - 4.9 * a * a), kk = 1 - a / 0.6;
          sparks.push(x, y, z, hot[0], hot[1], hot[2], TELE.spark.alpha * kk * kk, TELE.spark.sizePx * (0.6 + 0.6 * h3));
        }
      }
    });
    // the count, by the receiver, landing with the first crossing and counting up
    if (count > 0 && plan.recXY) {
      const first = Math.min(...plan.cross.filter((c): c is { t: number; xy: XY } => !!c).map((c) => c.t));
      const fin = Math.min(1, (t - first) / 0.25) * left;
      // in front of where he receives, towards the camera, so the words do not lie under him
      const cx0 = st.camPos.x - plan.recXY[0], cz0 = st.camPos.z - plan.recXY[1], cl = Math.hypot(cx0, cz0) || 1, off = 3.4 * gain;
      labels.push({ x: plan.recXY[0] + (cx0 / cl) * off, z: plan.recXY[1] + (cz0 / cl) * off, text: `${count} LINE${count > 1 ? 'S' : ''} BROKEN`, alpha: TELE.unit.labelAlpha * fin, sizeM: Lb.labelM * gain, rgb: [...st.w] as [number, number, number] });
    }
  };

  /** the speed trail: his hips over the last tailS s (the skeleton's, 25 Hz; his tracked position without it), each
   *  sample's speed a centred difference over 0.16 s; grows out behind him as it enters, drains to leave */
  const rampCol = (u: number, k: number, out: [number, number, number]) => {
    const R = TELE.trail.ramp, x = Math.min(1, Math.max(0, u)), [a, b, f] = x < 0.5 ? [R[0], R[1], x / 0.5] : [R[1], R[2], (x - 0.5) / 0.5];
    // sRGB 0..1 as the strip layer takes them; on the grass lifted to amber's luminance so they read on the green
    const col = (h: string) => { const raw = hex01(h); if (!TELE.trail.liftGrass || k >= 1) return raw; const l = liftTo(h, AMBER_Y); return raw.map((v, i) => l[i] + (v - l[i]) * k) as [number, number, number]; };
    const ca = col(a), cb = col(b);
    out[0] = ca[0] + (cb[0] - ca[0]) * f; out[1] = ca[1] + (cb[1] - ca[1]) * f; out[2] = ca[2] + (cb[2] - ca[2]) * f;
  };
  const hipAt = (p: number, tt: number, out: XY) => {
    const J = data.joints, hip = J ? J.names.indexOf('midHip') : -1;
    if (J && hip >= 0 && jointAt(J, p, hip, tt, st.hipV)) { out[0] = st.hipV.x; out[1] = st.hipV.z; return true; }
    return anchors.player(p, tt, 0, out);
  };
  const drawTrail = (it: TrailItem, age: number, ex: number | null, k: number) => {
    const Tr = TELE.trail, t = clock.t, dt = 0.04;
    // how much of the tail shows: growing out behind him, draining back into him to leave
    const grow = ex === null ? EASE_OUT(Math.min(1, Math.max(0, age / Tr.growS))) : 1 - EASE_OUT(Math.min(1, ex / exitS(it)));
    const tail = Tr.tailS * grow;
    if (tail < 0.05) return;
    const n = Math.max(2, Math.round(tail / dt) + 1), q: XY = [0, 0], a: XY = [0, 0], b: XY = [0, 0], c: [number, number, number] = [0, 0, 0];
    const core: StripPoint[] = [], glow: StripPoint[] = [], shade: StripPoint[] = [];
    for (let i = 0; i < n; i++) {
      const tt = t - tail + (i / (n - 1)) * tail;
      if (!hipAt(it.player, tt, q)) continue;
      const sp = hipAt(it.player, tt - 0.08, a) && hipAt(it.player, tt + 0.08, b) ? Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.16 : 0;
      const frac = i / (n - 1), feet = frac > 1 - Tr.feetFade ? Math.max(0, (1 - frac) / Tr.feetFade) : 1, al = Math.pow(frac, Tr.fadePow) * feet;
      rampCol(sp / Tr.speedMax, k, c);
      const taper = 0.1 + 0.9 * frac;
      core.push({ x: q[0], y: 0, z: q[1], half: Tr.coreHalf * taper, r: c[0], g: c[1], b: c[2], a: al });
      glow.push({ x: q[0], y: 0, z: q[1], half: Tr.glowHalf * taper, r: c[0], g: c[1], b: c[2], a: Tr.glowA * al, soft: true });
      shade.push({ x: q[0], y: 0, z: q[1], half: Tr.shadowHalf * taper, r: 0, g: 0, b: 0, a: Tr.shadowA * al, soft: true });
    }
    trails.line(shade, () => 0.05); trails.line(glow, () => 0.05); trails.line(core, () => 0.05);
    // the read-out: his speed now, averaged over the last 0.2 s
    if ((it.label ?? Tr.label) && hipAt(it.player, t, q) && hipAt(it.player, t - 0.2, a)) {
      const kmh = (Math.hypot(q[0] - a[0], q[1] - a[1]) / 0.2) * 3.6;
      const [se] = ringEnter(age), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
      st.speedTags.list.push({ x: q[0], z: q[1], text: String(Math.round(kmh)), alpha: ax * Math.min(1, age / 0.15), scale: se * sx });
    }
  };

  /** a player's running direction (the pressure's first animation, exactly: ripples, then its stack of
   *  chevrons): ripples in his team colour spreading from his feet and fading out, then the chevrons drawn from his feet
   *  towards where he is `ahead` s later, flowing that way at half his speed */
  const drawHeading = (it: HeadingItem, age: number, ex: number | null, k: number, gain: number) => {
    const Hd = TELE.heading, Pr = TELE.press, tt = it.at ?? clock.t, A: XY = [0, 0], B: XY = [0, 0], ahead = it.ahead ?? Hd.aheadS;
    if (!anchors.player(it.player, tt, TELE.smoothS, A)) return;
    inkColour('team', sideOf(it.player), k, st.c1);
    const col = [...st.c1, 1], left = retract(ex), ax = ex === null ? 1 : ringExit(ex)[1];
    // the ripples: out and gone, entrance only
    if (ex === null) for (let j = 0; j < Hd.rings; j++) {
      const e = (age - j * Hd.gapS) / Hd.rippleS;
      if (e <= 0 || e >= 1) continue;
      const R0 = (0.3 + Hd.rippleR * EASE_OUT(e)) * gain, fade = (1 - e) * (1 - e);
      layer.push([A[0], A[1], 1, 0], [R0 + 0.6, R0 + 0.6, KIND.band, 0.9 * fade], [R0, (0.09 - 0.05 * e) * gain, 0, 0], [0, 0, 0, gain], col, col);
    }
    // the chevrons: from his feet towards where he will be, or to the point chosen for him (`to`: the pen's drag)
    if (!(it.to ? anchors.resolve(it.to, tt, TELE.smoothS, B) : anchors.player(it.player, tt + ahead, TELE.smoothS, B))) return;
    const dx0 = B[0] - A[0], dz0 = B[1] - A[1], d0 = Math.hypot(dx0, dz0);
    if (d0 < 0.6) return;
    // his direction, the length capped (kept short); the speed for the flow is his own. A chosen point: all the way
    const d = it.to ? d0 : Math.min(Hd.lenM * gain, Math.max(2.5 * gain, d0)), dx = (dx0 / d0) * d, dz = (dz0 / d0) * d;
    B[0] = A[0] + dx; B[1] = A[1] + dz;
    const f = edgeDraw(age - Hd.arrowDelayS) * left;
    if (f <= 0) return;
    const speed = it.to ? Hd.toFlow / Pr.flow : d0 / ahead;
    const rA = 0.5 * gain, per = Math.min(Pr.chevGap * gain, (d - rA) / 2), phase = ((Math.max(0, age) * speed * Pr.flow) % per + per) % per;
    const m = Pr.chevHalf * gain * 1.5 + 3 * TELE.glow.sigma * gain + 0.6;
    layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / d, dz / d], [d / 2 + m, m, KIND.chevrons, ax],
      [d / 2, Math.min(Pr.chevHalf * gain, 0.45 * per), Pr.chevStroke * gain, per], [f, phase, 0, gain], col, [rA, 0, it.to && Hd.toEnd === 'hold' ? 1 : 0, 0]);
  };

  /** the offside wall: the line, its sweep and rise, the line-setter's ring, the focus attacker's margin */
  const drawOffside = (it: OffsideItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const O = TELE.offside, R = TELE.ring, tt = it.at ?? clock.t, side = it.side ?? 'def', other = side === 'def' ? 'att' : 'def';
    // the attack runs towards +x for the attacking side's opponents' goal: sg turns the other side's case round
    const sg = side === 'def' ? 1 : -1, q: XY = [0, 0], defs: { p: number; x: number; z: number }[] = [];
    // the law's measure: the part of the body nearest the goal that may play the ball (head, torso, legs and feet; not
    // the arms or hands), from the skeleton at the moment itself (no smoothing: offside is judged at the kick); the
    // hips when the skeleton is missing
    const J = data.joints, at3: [number, number, number] = [0, 0, 0];
    const front = (p: number): number | null => {
      let best = -Infinity;
      if (J) for (const j of offJoints(J)) if (jointAt(J, p, j, tt, st.v) && st.v.x * sg > best) { best = st.v.x * sg; at3[0] = st.v.x; at3[1] = st.v.y; at3[2] = st.v.z; }
      if (best > -Infinity) return best;
      if (!anchors.player(p, tt, 0, q)) return null;
      at3[0] = q[0]; at3[1] = 1.0; at3[2] = q[1];
      return q[0] * sg;
    };
    for (let p = side === 'att' ? 0 : nAtt; p < (side === 'att' ? nAtt : P); p++) {
      const f = front(p);
      if (f !== null && anchors.player(p, tt, 0, q)) defs.push({ p, x: f, z: q[1] });
    }
    if (defs.length < 2) return;
    defs.sort((a, b) => b.x - a.x);
    const second = defs[1], b: XY = [0, 0], ballX = anchors.resolve({ ball: true, at: tt }, tt, 0, b) ? b[0] * sg : -Infinity;
    const lineS = Math.max(second.x, ballX, 0), setter = lineS === second.x ? second : null, lx = lineS * sg;
    const left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
    const z0 = setter ? setter.z : 0;
    // the base line, swept out from the line-setter to both touchlines
    const sweep = ex === null ? EASE_OUT(Math.min(1, Math.max(0, age / O.sweepS))) : left, reach = sweep * (34 + Math.abs(z0));
    // the wall's colour on the surface (white is the board's lighter grey there)
    const wc: [number, number, number] = [0, 0, 0];
    if (O.color === '#ffffff') surfaceColour(TELE.color.white, k, wc); else wc.splice(0, 3, ...new THREE.Color(O.color).toArray());
    const blue = [...wc, 1];
    for (const dir of [-1, 1]) {
      const zEnd = dir * 34, len = Math.min(reach, Math.abs(zEnd - z0));
      if (len < 0.05) continue;
      const zm = z0 + (dir * len) / 2, hw = O.lineHW * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
      layer.push([lx, zm, 0, 1], [len / 2 + m, hw + m, KIND.edge, ax], [len / 2, hw, 0, 0], [1, 1, 0, gain], blue, blue);
    }
    // the wall, rising out of the line as it sweeps
    const rise = ex === null ? EASE_OUT(Math.min(1, Math.max(0, (age - 0.25) / O.riseS))) : left;
    const wall = { x: lx, z0, reach, rise, alpha: ax, rip: [] as [number, number, number, number][] };
    st.walls.list.push(wall);
    // the close-up (var.ts): the wide view's margin and the rings give way as the camera flies down to the line
    const Vr = O.var, closeOn = !!it.close;
    const keepWide = closeOn ? 1 - Math.min(1, Math.max(0, (age - Vr.holdS) / 0.5)) : 1;
    const close = closeOn ? EASE_OUT(Math.min(1, Math.max(0, (age - Vr.holdS - 0.6 * Vr.flyS) / Vr.marksS))) * left : 0;
    // the line-setter's ring
    if (setter && anchors.player(setter.p, tt, 0, q)) { const [se, ae] = ringEnter(age); rings.push({ xy: [q[0], q[1]], side, sc: se * sx * gain, al: ae * ax * keepWide, player: setter.p, style: R }); }
    const defPt: [number, number, number] | null = setter && front(setter.p) !== null ? [at3[0], at3[1], at3[2]] : null;
    // every attacker in an offside position (the Tactics one-click line highlights them all
    // at once): his deciding part beyond the line, by the same measure, gets a plain amber ring (amber as
    // the margin's offside colour). A position, not an offence; keepers left out
    if (it.highlight === 'all') {
      const amb: [number, number, number] = [0, 0, 0]; surfaceColour(TELE.color.amber, k, amb);
      const [se, ae] = ringEnter(age - 0.45), Rh = O.posR * gain * se * sx, bw = O.posW * gain * 0.5, col = [...amb, 1];
      for (let p = other === 'att' ? 0 : nAtt; p < (other === 'att' ? nAtt : P); p++) {
        if (keepers.has(p)) continue;
        const fp = front(p);
        if (fp === null || fp <= lineS + 1e-3 || Rh <= 1e-3 || !anchors.player(p, tt, TELE.smoothS, q)) continue;
        layer.push([q[0], q[1], 1, 0], [Rh + bw + 0.6, Rh + bw + 0.6, KIND.pair, ae * ax * keepWide], [0, 0, bw, 0], [1, 4, 0, gain], col, col, [0, 0, 0, 0, 0, 0, Rh, 0]);
      }
    }
    // the focus attacker's margin: a thin line from his feet to the wall, the metres beside it
    const meta = (data.pkg.meta as { pass?: { receiver?: number } }).pass;
    const focus = it.focus !== undefined ? it.focus : meta?.receiver ?? null;
    if (focus !== null && sideOf(focus) === other && anchors.player(focus, tt, 0, q)) {
      const ax2 = front(focus) ?? q[0] * sg, margin = ax2 - lineS, f = edgeDraw(age - 0.6) * left * keepWide, off = margin > 0;
      const attPt: [number, number, number] = [at3[0], at3[1], at3[2]];
      // beyond the line (offside, by his hips): amber, the player's meaning colour; level or behind it: white
      const amb: [number, number, number] = [0, 0, 0]; surfaceColour(TELE.color.amber, k, amb);
      const mc = off ? [...amb, 1] : null;
      const [se, ae] = ringEnter(age - 0.45);
      rings.push({ xy: [q[0], q[1]], side: other, sc: se * sx * gain, al: ae * ax * keepWide, player: focus, style: R });
      if (f > 0 && Math.abs(margin) > 0.05) {
        const A: XY = [q[0], q[1]], Bp: XY = [lx, q[1]], L2 = Math.abs(Bp[0] - A[0]), dirx = Math.sign(Bp[0] - A[0]);
        const rA = R.innerR * gain, hw = O.marginHW * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
        // a plain line, no glow, clean and simple: the halo's width goes to nothing
        if (L2 > rA + 0.05) layer.push([(A[0] + Bp[0]) / 2, A[1], dirx, 0], [L2 / 2 + m, hw + m, KIND.edge, ax], [L2 / 2, hw, rA, 0], [f, 1, 0, closeOn ? 1e-3 : gain], mc ?? blue, mc ?? blue);
        surfaceColour(TELE.color.white, k, st.w);
        // the metres beside him, clear of his ring, on the side of the wall he stands on (the close-up's verdict tag carries
        // them from the wide view on instead)
        if (!closeOn) {
          const lz = A[1] + (A[1] > 0 ? -1 : 1) * (R.R + 0.25 + 0.5 * O.labelM) * gain;
          labels.push({ x: q[0] - dirx * 0.3 * gain, z: lz, text: `${Math.abs(margin).toFixed(1)} m`, alpha: TELE.unit.labelAlpha * Math.min(1, f * 1.5), sizeM: O.labelM * gain, rgb: off ? (mc!.slice(0, 3) as [number, number, number]) : ([...st.w] as [number, number, number]) });
        }
      }
      if (closeOn) {
        const fq: XY = [q[0], q[1]];                     // where he stands (q is reused below)
        // his own line across the pitch at his deciding part, swept out from him: amber beyond the wall, his team's
        // colour level or behind it; the wall stays the line-setter's
        const ac: [number, number, number] = [0, 0, 0];
        if (off) surfaceColour(TELE.color.amber, k, ac); else inkColour('team', other, k, ac);
        const dc: [number, number, number] = [0, 0, 0]; surfaceColour(TELE.color.white, k, dc);
        const reachA = close * (34 + Math.abs(attPt[2])), acol = [...ac, 1];
        for (const dir of [-1, 1]) {
          const len = Math.min(reachA, Math.abs(dir * 34 - attPt[2]));
          if (len < 0.05) continue;
          const zm = attPt[2] + (dir * len) / 2, hw = O.lineHW * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
          layer.push([attPt[0], zm, 0, 1], [len / 2 + m, hw + m, KIND.edge, ax * close], [len / 2, hw, 0, 0], [1, 1, 0, gain], acol, acol);
        }
        const others: [number, number][] = [];
        for (let p = 0; p < P; p++) if (p !== focus && p !== setter?.p && anchors.player(p, tt, 0, q)) others.push([q[0], q[1]]);
        // the verdict shows from the wide view on (in the close-up alone the metres were easily missed)
        const tag = edgeDraw(age - 0.6) * left;
        Object.assign(VAR_FACTS, { on: true, age, exit: ex, lx, sg, def: defPt, att: attPt, margin, close, defRgb: dc, attRgb: ac, others, tag, feet: fq });
        // the ripples: from the line-setter's deciding part, which lies on the wall, and from the attacker's when he is
        // through it (where his body meets the wall); they start with the close-up's marks
        const tr = age - Vr.holdS - 0.6 * Vr.flyS;
        if (tr > 0 && close > 0) {
          if (defPt) wall.rip.push([defPt[2], defPt[1], tr, close]);
          if (off) wall.rip.push([attPt[2], attPt[1], tr - 0.3, close]);
        }
        // offside: the part of him beyond the wall shows lighter (visionDim.ts OFFB)
        if (off && close > 0) {
          OFFB.uOffOn.value = 1; OFFB.uOffX.value = lx; OFFB.uOffSg.value = sg; OFFB.uOffK.value = close; OFFB.uOffP.value.set(fq[0], fq[1]);
        }
        // onside: a ruler on the grass from the wall to his line, a little in front of him on the camera's side, drawn
        // out from the wall: the body, a tick every 10 cm, a longer one every 50 cm, a bar across at his end
        if (!off && close > 0 && Math.abs(margin) > 0.02) {
          const Ru = Vr.ruler, zr = fq[1] + Math.sign(st.camPos.z - fq[1] || 1) * Ru.offM, L = Math.abs(attPt[0] - lx), dir = Math.sign(attPt[0] - lx) || 1;
          const cx = lx + (dir * L) / 2, rc = [...dc, 1], al = ax * close, g = EASE_OUT(Math.min(1, close * 1.2));
          const band = (hw: number, per: number, fill: number, a: number) => {
            const m = hw + 3 * TELE.glow.sigma * gain + 0.6, h = 0.5 * fill * per;
            layer.push([cx, zr, dir, 0], [L / 2 + m, hw + m, KIND.edge, a], [L / 2, hw, 0, 0], [g, 1, per, gain], rc, per > 0 ? [fill, -h, 0, 0] : rc);
          };
          band(Ru.bodyHW, 0, 0, al);                       // the body
          band(Ru.minorHW, 0.1, 0.16, al * 0.85);          // every 10 cm
          band(Ru.majorHW, 0.5, 0.05, al);                 // every 50 cm
          // the bar across at his end, once the ruler reaches him
          const endA = al * Math.min(1, Math.max(0, (g - 0.95) / 0.05));
          if (endA > 0.01) { const m = Ru.majorHW + 3 * TELE.glow.sigma * gain + 0.6; layer.push([attPt[0], zr, 0, 1], [Ru.majorHW + m, 0.02 + m, KIND.edge, endA], [Ru.majorHW, 0.02, 0, 0], [1, 1, 0, gain], rc, rc); }
        }
      }
    }
  };

  /** a spotlight over the feet at (x, z): grows as one scale from the feet (no overshoot), shrinks to leave */
  const SPOT_GROW = bezier(0.15, 0.85, 0.3, 1);
  const pushSpot = (x: number, z: number, age: number, ex: number | null, gain: number) => {
    const Sp = TELE.spot, g = SPOT_GROW(Math.min(1, Math.max(0, age / Sp.growS)));
    const [sx, ax] = ex === null ? [1, 1] : [1 - 0.78 * EASE_OUT(Math.min(1, ex / Sp.exitS)), 1 - Math.min(1, ex / Sp.exitS)];
    st.spots.list.push({ x, z, scale: g * sx * gain, alpha: ax });
  };

  /** pressure on the carrier: the circle pinging out round him, the pressers' rings as it passes them, their chevrons */
  const drawPressure = (it: PressureItem, age: number, ex: number | null, k: number, gain: number, rings: RingReq[]) => {
    const Pr = TELE.press, tt = it.at ?? clock.t, rad = it.radius ?? Pr.radiusM;
    const pos = (p: number, t: number, out: XY) => anchors.player(p, t, TELE.smoothS, out);
    const C: XY = [0, 0], q: XY = [0, 0], q0: XY = [0, 0];
    let carrier = it.carrier ?? -1;
    if (carrier < 0) {
      const b: XY = [0, 0]; let bd = Infinity;
      if (anchors.resolve({ ball: true, at: tt }, tt, 0, b)) for (let p = 0; p < nAtt; p++) if (pos(p, tt, q)) { const d = Math.hypot(q[0] - b[0], q[1] - b[1]); if (d < bd) { bd = d; carrier = p; } }
    }
    if (carrier < 0 || !pos(carrier, tt, C)) return;
    const side = sideOf(carrier), opp = side === 'att' ? 'def' : 'att';
    const [, ax] = ex === null ? [1, 1] : ringExit(ex), left = retract(ex);
    // the circle at the radius, fading in (its ping went to the running-direction arrow)
    inkColour('team', opp, k, st.c1);
    const col = [...st.c1, 1], fin = ex === null ? Math.min(1, Math.max(0, age / 0.4)) : left;
    if (fin > 0.01) layer.push([C[0], C[1], 1, 0], [rad + 0.8, rad + 0.8, KIND.band, Pr.circleA * ax * fin], [rad, 2 * Pr.circleHW * gain, 0, 0], [0, 0, 0, gain], col, col);
    // the carrier: lit by the spotlight (no rings here)
    pushSpot(C[0], C[1], age, ex, gain);
    // the pressers: every opponent inside the circle, his closing speed over the last 0.3 s
    for (let p = side === 'att' ? nAtt : 0; p < (side === 'att' ? P : nAtt); p++) {
      if (!pos(p, tt, q) || !pos(p, tt - 0.3, q0)) continue;
      const d = Math.hypot(q[0] - C[0], q[1] - C[1]);
      if (d > rad || d < 0.3) continue;
      const close = (Math.hypot(q0[0] - C[0], q0[1] - C[1]) - d) / 0.3, active = close >= Pr.closeMin;
      // his mark, drawn in after the light column starts, nearest first; stronger the faster he closes in
      const I = Math.min(1, Math.max(0, close / Pr.closeFull)), f = edgeDraw(age - 0.2 - (d / rad) * 0.25) * left;
      if (f <= 0) continue;
      if (Pr.look === 'wedge') {
        const dx = C[0] - q[0], dz = C[1] - q[1], m = Pr.wedgeW * gain + 3 * TELE.glow.sigma * gain + 0.6, rB = TELE.spot.r * gain * 0.95;
        if (d > rB + 0.3) layer.push([(q[0] + C[0]) / 2, (q[1] + C[1]) / 2, dx / d, dz / d], [d / 2 + m, m, KIND.press, ax], [d / 2, Pr.wedgeW * gain, 0, I], [f, 0, rB, gain], col, col);
      } else {
        const ux = (q[0] - C[0]) / d, uz = (q[1] - C[1]) / d, R0 = Pr.arcR * gain, ha = Math.min(1.2, Math.atan2(0.9, Math.max(d, 0.5)) + 0.25), m = R0 + 0.8;
        layer.push([C[0], C[1], ux, uz], [m, m, KIND.press, ax], [R0, ha, Pr.arcBW * gain, I], [f, 1, 0, gain], col, col);
      }
      void rings; void active; void Pr.idleA;
    }
  };

  /** a side's block: every outfield player with the rotating double ring, the ones on its hull joined
   *  by welded lines (the units' rule: cut at the inner ring, the ring painted over the seam), pitch_prism's zebra
   *  inside the hull minus the rings, and the hull's area in m² (Opta's measure, through the players) painted at its
   *  middle. Enters in pitch_prism's group cascade: the rings, the lines welding towards each other with sparks, then
   *  the stripes one after another as the area counts up */
  const drawHull = (it: HullItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const Hc = TELE.hull, R = TELE.ring, tt = it.at ?? clock.t, side = it.players?.length ? sideOf(it.players[0]) : it.side ?? 'def', pl: { p: number; xy: XY }[] = [];
    // the players the pen closed a link round, or the side's outfield players
    if (it.players) { for (const p of it.players) if (anchors.player(p, tt, TELE.smoothS, st.xy)) pl.push({ p, xy: [st.xy[0], st.xy[1]] }); }
    else for (let p = side === 'att' ? 0 : nAtt; p < (side === 'att' ? nAtt : P); p++) {
      if (keepers.has(p) || !anchors.player(p, tt, TELE.smoothS, st.xy)) continue;
      pl.push({ p, xy: [st.xy[0], st.xy[1]] });
    }
    if (pl.length < 3) return;
    // the hull, Andrew's monotone chain, counter-clockwise
    const s = [...pl].sort((a, b) => a.xy[0] - b.xy[0] || a.xy[1] - b.xy[1]);
    const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: typeof pl = [], upper: typeof pl = [];
    for (const q of s) { while (lower.length >= 2 && cross(lower[lower.length - 2].xy, lower[lower.length - 1].xy, q.xy) <= 0) lower.pop(); lower.push(q); }
    for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (upper.length >= 2 && cross(upper[upper.length - 2].xy, upper[upper.length - 1].xy, q.xy) <= 0) upper.pop(); upper.push(q); }
    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    let A = 0, cx = 0, cy = 0;
    hull.forEach((a, i) => { const b = hull[(i + 1) % hull.length].xy, c = a.xy[0] * b[1] - b[0] * a.xy[1]; A += c; cx += (a.xy[0] + b[0]) * c; cy += (a.xy[1] + b[1]) * c; });
    if (Math.abs(A) < 1e-3) return;
    cx /= 3 * A; cy /= 3 * A; const area = Math.abs(A) / 2;
    const left = retract(ex), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
    // the rings, cascading in around the hull, then the players inside
    const onHull = new Set(hull.map((q) => q.p)), order = [...hull, ...pl.filter((q) => !onHull.has(q.p))];
    const rank = new Map(order.map((q, i) => [q.p, i]));
    const ringScale = (p: number) => ringEnter(age - rank.get(p)! * CASCADE.ringStagger)[0] * sx * gain;
    for (const q of order) { const [se, ae] = ringEnter(age - rank.get(q.p)! * CASCADE.ringStagger); rings.push({ xy: q.xy, side, sc: se * sx * gain, al: ae * ax, player: q.p, style: R }); }
    // the lines round the hull, welded to the inner rings, drawn from both ends towards the middle, with sparks
    inkColour('team', side, k, st.c1);
    const col = [...st.c1, 1], f = edgeDraw(age - CASCADE.edgeDelay) * left;
    hull.forEach((a, i) => {
      const b = hull[(i + 1) % hull.length], A2 = a.xy, B2 = b.xy, dx = B2[0] - A2[0], dz = B2[1] - A2[1], Lh = Math.hypot(dx, dz) / 2;
      if (Lh < 1e-3) return;
      if (f > 0) {
        const hw = (TELE.unit.lineW / 2) * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
        layer.push([(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, ax],
          [Lh, hw, R.innerR * ringScale(a.p), R.innerR * ringScale(b.p)], [f, 0, 0, gain], col, col);
      }
      if (TELE.spark.on && Hc.look === 'full' && ex === null) lineSparks(A2, B2, R.innerR * gain, R.innerR * gain, age - CASCADE.edgeDelay, hashId(it.id) + i, st.c1, gain);
    });
    // the zebra: the hull through the players (its corners first, then the players inside), a disc cut at every ring
    const tz = ex === null ? Math.min(1, Math.max(0, (age - CASCADE.areaDelay) / Hc.durS)) : left;
    const V = st.hullV; V.fill(0);
    let Rmax = 0;
    order.slice(0, 10).forEach((q, j) => { V[2 * j] = q.xy[0] - cx; V[2 * j + 1] = q.xy[1] - cy; Rmax = Math.max(Rmax, Math.hypot(q.xy[0] - cx, q.xy[1] - cy)); });
    surfaceColour(TELE.color.white, k, st.w);
    // calm: every stripe in place at once, the whole zebra fading in (and out) instead
    const calm = Hc.look === 'calm', tzS = calm ? 1 : tz, zA = calm ? EASE_OUT(tz) : 1;
    if (tz > 0) layer.push([cx, cy, 1, 0], [Rmax + 1, Rmax + 1, KIND.hull, zA], V.subarray(0, 4), [tzS, Math.min(10, order.length), (R.R + R.outerW / 2) * gain, gain],
      [...st.c1, Math.min(10, hull.length)], [...st.w, mixPair(Hc.zebra, k)], V.subarray(4, 20));
    // the area, painted at its middle, counting up with the stripes
    if ((it.labels ?? true) && tz > 0) {
      labels.push({ x: cx, z: cy, text: `${Math.round(area * (calm ? 1 : Math.min(1, tz / 0.8)))} m²`, alpha: TELE.unit.labelAlpha * Math.min(1, tz / 0.3), sizeM: Hc.labelM * gain, rgb: [...st.w] as [number, number, number] });
    }
  };

  /** the shot cone: the light, the shadows and the goal mouth in one quad, the labels lying on the pitch */
  const drawShot = (it: ShotItem, age: number, ex: number | null, k: number, gain: number, labels: GroundLabel[], rings: RingReq[]) => {
    const Sh = TELE.shot, tt = it.at ?? clock.t, xs = st.xg;
    if (!xs) return;
    const pos = (p: number, out: XY) => anchors.player(p, tt, TELE.smoothS, out);
    // the shooter: given, or the attacker nearest the ball
    let shooter = it.shooter ?? -1;
    const S: XY = [0, 0], q: XY = [0, 0];
    if (shooter < 0) {
      const b: XY = [0, 0]; let bd = Infinity;
      if (anchors.resolve({ ball: true, at: tt }, tt, 0, b)) for (let p = 0; p < nAtt; p++) if (!keepers.has(p) && pos(p, q)) { const d = Math.hypot(q[0] - b[0], q[1] - b[1]); if (d < bd) { bd = d; shooter = p; } }
    }
    if (shooter < 0 || !pos(shooter, S)) return;
    // the goal he attacks, and his opponents; the model's frame shoots towards +x, so the other side's shots turn round
    const side = sideOf(shooter), sg = side === 'att' ? 1 : -1, gx = 52.5 * sg, post = xs.params.post_y, body = xs.params.body_half_width_m;
    const opp: XY[] = []; let keeper: XY | null = null;
    for (let p = side === 'att' ? nAtt : 0; p < (side === 'att' ? P : nAtt); p++) {
      if (!pos(p, q)) continue;
      if (keepers.has(p)) keeper = [q[0], q[1]]; else opp.push([q[0], q[1]]);
    }
    const turn = (v: XY): XgPoint => [v[0] * sg, v[1] * sg];
    // a header or a foot from the event's tags (the model tells them apart; the feed has no left or right foot)
    const SHOTS = ['SavedShot', 'MissedShots', 'Goal', 'ShotOnPost'];
    const evs = (data.pkg as { events?: { t: number; type: string; player?: number; tags?: string[] }[] }).events ?? [];
    const shotEv = evs.find((e) => SHOTS.includes(e.type) && e.player === shooter && Math.abs(e.t - tt) < 1.5);
    // (the What-if hands in its own value and kind: its shot-type model, whatif/shot.ts)
    const header = it.header ?? !!shotEv?.tags?.includes('Head');
    const xg = it.xg ?? xgFreeze(xs, turn(S), header, opp.map(turn), keeper ? turn(keeper) : null);
    if (focus) focus.current = shooter;
    // the frame: at the shooter, along the line to the goal's centre
    const gdx = gx - S[0], gdz = -S[1], dist = Math.hypot(gdx, gdz);
    if (dist < 1) return;
    const ux = gdx / dist, uz = gdz / dist, loc = (w: XY): XY => [(w[0] - S[0]) * ux + (w[1] - S[1]) * uz, -(w[0] - S[0]) * uz + (w[1] - S[1]) * ux];
    const P1 = loc([gx, -post]), P2 = loc([gx, post]);
    const a1 = Math.atan2(P1[1], P1[0]), a2 = Math.atan2(P2[1], P2[0]), lo = Math.min(a1, a2), hi = Math.max(a1, a2), L = Math.max(Math.hypot(...P1), Math.hypot(...P2));
    // the shadows: the directions each body hides, cut to the goal mouth, from where he stands; the widest first
    const shadows: [number, number, number][] = [];
    for (const o of keeper ? [...opp, keeper] : opp) {
      const l = loc(o), r = Math.hypot(l[0], l[1]);
      if (r < 0.3 || r > L + 0.5) continue;
      const th = Math.atan2(l[1], l[0]), half = Math.atan2(body, r), s0 = Math.max(th - half, lo), s1 = Math.min(th + half, hi);
      if (s1 > s0) shadows.push([s0, s1, Math.max(0, r - 0.25)]);
    }
    shadows.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
    const shown = shadows.slice(0, Sh.shadows), X = st.shotX; X.fill(0);
    shown.forEach((s, i) => { X[i * 3] = s[0]; X[i * 3 + 1] = s[1]; X[i * 3 + 2] = s[2]; });
    const tp = ex === null ? Math.min(1, Math.max(0, (age - 0.05) / Sh.durS)) : Math.max(0, 1 - ex / exitS(it));
    // the cone starts at his inner ring's band (as the ring grows in and shrinks out)
    { const [se] = ringEnter(age), [sx] = ex === null ? [1] : ringExit(ex); X[15] = TELE.ring.innerR * se * sx * gain; }
    surfaceColour(TELE.color.white, k, st.w);
    const tint = new THREE.Color(Sh.shadowTint);
    const m = 3 * TELE.glow.sigma * gain + 1.0, halfW = Math.max(Math.abs(P1[1]), Math.abs(P2[1])) + m;
    if (tp > 0) layer.push([S[0], S[1], ux, uz], [L + m, halfW, KIND.cone, 1], [P1[0], P1[1], P2[0], P2[1]],
      [tp, mixPair(Sh.wash, k), Sh.edgeHW * gain, gain], [...st.w, shown.length], [tint.r, tint.g, tint.b, Sh.shadowA], X);
    // the shooter's ring
    if (Sh.ring) { const [se, ae] = ringEnter(age), [sx, ax] = ex === null ? [1, 1] : ringExit(ex); rings.push({ xy: [S[0], S[1]], side, sc: se * sx * gain, al: ae * ax, player: shooter, style: TELE.ring }); }
    // the numbers, arriving with the beam: xG on a widget beside his head that rolls to its value
    // with a glitch; the distance lying along the cone's edge, outside it; the angle lying tangent to the apex arc
    if ((it.labels ?? Sh.labels) && tp > 0) {
      const vx = -uz, vz = ux, al = TELE.unit.labelAlpha * Math.min(1, Math.max(0, (tp - 0.15) / 0.3)), rgb = [...st.w] as [number, number, number];
      const cr = Math.hypot(st.camR.x, st.camR.z) > 1e-3 ? [st.camR.x, st.camR.z] : [1, 0];
      // the xG widget beside his head, on the side away from the goal as the camera sees it (XgWidget.tsx)
      const side = ux * cr[0] + uz * cr[1] > 0 ? -1 : 1, W = st.xgw.s, J = data.joints, neck = J ? J.names.indexOf('neck') : -1;
      if (J && neck >= 0 && jointAt(J, shooter, neck, tt, st.v)) W.head = [st.v.x, st.v.y + 0.3, st.v.z]; else W.head = [S[0], 1.85, S[1]];
      inkColour('team', sideOf(shooter), k, st.c2);
      // standing beside his head, or lying on the grass beside his feet when the camera looks down from above
      // TELE.shot.flatAboveDeg (3 degrees either way before it changes, so it does not flicker at the threshold)
      const elev = (Math.atan2(st.camPos.y, Math.hypot(st.camPos.x - S[0], st.camPos.z - S[1])) * 180) / Math.PI;
      if (st.xgFlat ? elev < Sh.flatAboveDeg - 3 : elev > Sh.flatAboveDeg + 3) st.xgFlat = !st.xgFlat;
      W.mode = st.xgFlat ? 'ground' : 'stand'; W.feet = [S[0], S[1]]; W.ringR = (TELE.ring.R + TELE.ring.outerW / 2) * gain; W.tagM = Sh.tagM * gain;
      W.on = true; W.value = xg; W.age = age; W.exit = ex; W.side = side as 1 | -1; W.accent = `#${tmpColor.setRGB(st.c2[0], st.c2[1], st.c2[2], THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}`;
      // the distance, along the edge on the far side from the plate
      const pA = [gx, post], pB = [gx, -post], toward = (q: number[]) => (q[0] - S[0]) * side * cr[0] + (q[1] - S[1]) * side * cr[1];   // the edge away from the widget
      const Pe = toward(pA) < toward(pB) ? pA : pB;
      const ex0 = Pe[0] - S[0], ez0 = Pe[1] - S[1], el = Math.hypot(ex0, ez0), dxE = ex0 / el, dzE = ez0 / el;
      let nx = -dzE, nz = dxE;
      if (nx * (gx - Pe[0]) + nz * (0 - Pe[1]) > 0) { nx = -nx; nz = -nz; }   // outwards, away from the cone
      const off = Sh.labelM * 0.6 + 0.3 * gain, dpos = 0.55 * el;
      labels.push({ x: S[0] + dxE * dpos + nx * off, z: S[1] + dzE * dpos + nz * off, text: `${Math.round(dist)} m`, alpha: al * Math.min(1, Math.max(0, (tp - 0.4) / 0.3)), sizeM: Sh.labelM * gain, rgb, dir: [dxE, dzE] });
      // the angle, across the cone 40% of the way out, where a narrow cone is wide enough to hold the number (no arc),
      // on the bisector of its edges (not the line to the goal's centre, which leans off it from any spot off the
      // middle; centred between the edges), the digits centred and the degree sign hanging after them
      const Ra = Math.min(6, Math.max(2.4, 0.4 * L)), rr = Ra + 0.25 * gain + 0.5 * Sh.labelM * 0.85 * gain, mid = (lo + hi) / 2;
      const bx = ux * Math.cos(mid) + vx * Math.sin(mid), bz = uz * Math.cos(mid) + vz * Math.sin(mid);
      labels.push({ x: S[0] + bx * rr, z: S[1] + bz * rr, text: `${Math.round(((hi - lo) * 180) / Math.PI)}°`, alpha: al * 0.9, sizeM: Sh.labelM * 0.85 * gain, rgb, dir: [-bz, bx], nudge: 0.13 });
    }
  };

  const LANES: LaneName[] = ['left-wide', 'left-half', 'centre', 'right-half', 'right-wide'];
  /** a zone: its corners (from the poly, the rect, the lane or the pocket) and the axis it unfolds along; the unfold
   *  (the default entrance) draws any shape, the sandbox's other entrances draw rectangles */
  const ZONE_PRESETS: Record<NonNullable<ZoneItem['preset']>, Partial<ZoneItem>> = {
    zone14: { rect: [18, -9.16, 36, 9.16], label: 'ZONE 14' },
    'half-space-left': { lane: 'left-half', label: 'HALF-SPACE' },
    'half-space-right': { lane: 'right-half', label: 'HALF-SPACE' },
  };
  const drawZone = (it0: ZoneItem, age: number, ex: number | null, k: number, gain: number, rings: RingReq[], labels: GroundLabel[]) => {
    const it: ZoneItem = it0.preset ? { ...ZONE_PRESETS[it0.preset], ...it0, label: it0.label ?? ZONE_PRESETS[it0.preset].label } : it0;
    const Z = TELE.zone, B = Z.bounds, anim = Z.anim;
    if (it.circle) {
      // a round zone: the zones' look on a disc (ground kind 14), zooming in from its centre on the ring's own curve
      const [cx, cy, r] = it.circle, [se, ae] = ringEnter(age), [sx2, ax2] = ex === null ? [1, 1] : ringExit(ex), R = r * se * sx2;
      if (R < 0.05 || ae * ax2 <= 0.001) return;
      const ink = it.ink ?? 'att';
      if (ink === 'att' || ink === 'def') inkColour('team', ink, k, st.c1); else inkColour(ink, 'att', k, st.c1);
      surfaceColour(TELE.color.white, k, st.w);
      const hw = (TELE.unit.lineW / 2) * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.8, r2 = Math.SQRT1_2, paint = it.fill === 'none' ? 0 : mixPair(Z.zebra, k);
      layer.push([cx, cy, 1, 0], [R + m, R + m, KIND.disc, ae * ax2], [R, hw, Z.stripeW * gain, paint], [1, 0, 0, gain], [...st.c1, 1], [...st.w, 1], [r2, r2, r2 * (cx + cy), 0]);
      if (it.label) {
        const fin = ex === null ? Math.min(1, Math.max(0, (age - 0.15) / 0.35)) : 1 - Math.min(1, ex / exitS(it));
        if (fin > 0.01) labels.push({ x: cx, z: cy, text: it.label, alpha: TELE.unit.labelAlpha * fin, sizeM: Z.labelM * gain, rgb: [...st.w] as [number, number, number] });
      }
      return;
    }
    let poly: XY[] | null = null, axis = it.axis, rect: [number, number, number, number, number] | null = null;
    if (it.poly) poly = it.poly.slice(0, 8);
    else if (it.rect || it.lane) {
      let x0: number, y0: number, x1: number, y1: number;
      if (it.rect) [x0, y0, x1, y1] = it.rect;
      else { const i = LANES.indexOf(it.lane!); x0 = it.from ?? 0; x1 = it.to ?? 52.5; y0 = B[i]; y1 = B[i + 1]; }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = Math.abs(x1 - x0) / 2, hy = Math.abs(y1 - y0) / 2, ang = it.angle ?? 0;
      if (hx < 0.05 || hy < 0.05) return;
      rect = [cx, cy, hx, hy, ang];
      const c = Math.cos(ang), sn = Math.sin(ang);
      poly = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]): XY => [cx + c * sx * hx - sn * sy * hy, cy + sn * sx * hx + c * sy * hy]);
      axis ??= ang;
    } else if (it.lines) {
      // the pocket between two lines the pen linked: through the first line's players in their order, back along the
      // second's (turned to run the same way, so the sides never cross), up to four players each
      const tt = it.at ?? clock.t, four = (g: number[]) => (g.length <= 4 ? g : [0, 1, 2, 3].map((j) => g[Math.round((j * (g.length - 1)) / 3)]));
      const pts = (g: number[]) => four(g).flatMap((p): XY[] => (anchors.player(p, tt, TELE.smoothS, st.xy) ? [[st.xy[0], st.xy[1]]] : []));
      const a = pts(it.lines[0]); let b = pts(it.lines[1]);
      if (a.length < 2 || b.length < 2) return;
      const da: XY = [a[a.length - 1][0] - a[0][0], a[a.length - 1][1] - a[0][1]], db: XY = [b[b.length - 1][0] - b[0][0], b[b.length - 1][1] - b[0][1]];
      if (da[0] * db[0] + da[1] * db[1] < 0) b = [...b].reverse();
      poly = [...a, ...[...b].reverse()];
      axis ??= Math.atan2(da[1], da[0]);
    } else if (it.pocket) {
      // the space between two of the side's units at the moment, within the lane: its sides lie on the two lines as
      // drawn (through the players in order across the pitch, held flat beyond the end players), so they lean as the
      // lines lean, with a corner wherever a line bends inside the lane (two at most)
      const tt = it.at ?? clock.t, side = it.pocket.side, players: { p: number; xy: XY }[] = [];
      for (let p = side === 'att' ? 0 : nAtt; p < (side === 'att' ? nAtt : P); p++) {
        if (keepers.has(p) || !anchors.player(p, tt, TELE.smoothS, st.xy)) continue;
        players.push({ p, xy: [st.xy[0], st.xy[1]] });
      }
      if (players.length < 4) return;
      let memo = st.memos.get(it.id); if (!memo) { memo = { split: null, order: [] }; st.memos.set(it.id, memo); }
      const u = splitUnits(players, (xy) => (side === 'def' ? xy[0] : -xy[0]), memo), at = new Map(players.map((q) => [q.p, q.xy]));
      const [ga, gb] = it.pocket.between === 'mid-front' ? [u.mid, u.front] : [u.back, u.mid];
      if (!ga.length || !gb.length) return;
      const i = LANES.indexOf(it.pocket.lane), yA = B[i], yB = B[i + 1], ym = (yA + yB) / 2;
      const lineX = (g: number[], y: number) => {
        const q = g.map((p) => at.get(p)!).sort((a, b) => a[1] - b[1]);
        if (y <= q[0][1]) return q[0][0];
        for (let j = 0; j + 1 < q.length; j++) if (y <= q[j + 1][1]) return q[j][0] + ((y - q[j][1]) / Math.max(1e-6, q[j + 1][1] - q[j][1])) * (q[j + 1][0] - q[j][0]);
        return q[q.length - 1][0];
      };
      // each line's own bends inside the lane, the two nearest its middle (eight corners in all at most)
      const bends = (g: number[]) => g.map((p) => at.get(p)![1]).filter((y) => y > yA + 0.5 && y < yB - 0.5)
        .sort((a, b) => Math.abs(a - ym) - Math.abs(b - ym)).slice(0, 2).sort((a, b) => a - b);
      const ysA = [yA, ...bends(ga), yB], ysB = [yA, ...bends(gb), yB];
      // the second line's side of the first, from the lane's edges; each side stands pocketInset off its line, towards
      // the other, and the two never cross: the second keeps at least half a metre on its own side
      const sg = Math.sign(lineX(gb, yA) + lineX(gb, yB) - lineX(ga, yA) - lineX(ga, yB)) || 1, ins = Z.pocketInset;
      const sideA = ysA.map((y): XY => [lineX(ga, y) + sg * ins, y]);
      const sideB = ysB.map((y): XY => {
        const xa = lineX(ga, y) + sg * ins, x = lineX(gb, y) - sg * ins;
        return [sg * (x - xa) < 0.5 ? xa + sg * 0.5 : x, y];
      });
      poly = [...sideA, ...sideB.reverse()];
      // the axis: along the lines, from the lane's one edge to the other
      const mA = (lineX(ga, yA) + lineX(gb, yA)) / 2, mB = (lineX(ga, yB) + lineX(gb, yB)) / 2;
      axis ??= Math.atan2(yB - yA, mB - mA);
    }
    if (!poly || poly.length < 3) return;
    // its name, lying on the pitch at its middle, arriving with it
    if (it.label) {
      const ca = centroidAxis(poly), fin = ex === null ? Math.min(1, Math.max(0, (age - 0.15) / 0.35)) : 1 - Math.min(1, ex / exitS(it));
      surfaceColour(TELE.color.white, k, st.w);
      if (fin > 0.01) labels.push({ x: ca.c[0], z: ca.c[1], text: it.label, alpha: TELE.unit.labelAlpha * fin, sizeM: Z.labelM * gain, rgb: [...st.w] as [number, number, number] });
    }
    // a zone the pitch defines (drawn, a template; not a pocket, which the players' lines define): the
    // rings say "a player" and its corners are none: the same zoom and stripes, its edges a solid line of the units'
    // width meeting cleanly at the corners (one polygon, kind 6, shown whole)
    let zoomA = 1, wholeHW = 0;
    if (Z.look === 'lines' && !it.pocket && !it.lines) {
      const [se, ae] = ringEnter(age), [sx2, ax2] = ex === null ? [1, 1] : ringExit(ex), sc = se * sx2;
      zoomA = ae * ax2;
      if (sc <= 0.001 || zoomA <= 0.001) return;
      const ca0 = centroidAxis(poly), [gx, gy] = ca0.c;
      poly = poly.map(([x, y]): XY => [gx + (x - gx) * sc, gy + (y - gy) * sc]);
      wholeHW = (TELE.unit.lineW / 2) * gain;
    }
    if (Z.look === 'rings' && !it.pocket && !it.lines) {
      // the hull's look on a drawn zone (card 06, the free zone; a zone made by players, the pocket
      // between their lines, keeps its outline and its unfold along the lines): a double ring on every corner (its inner band in the zone's colour), welded lines
      // along the edges, the zebra inside with the rings cut out; the whole zone zooms in from its centroid on the
      // ring's own entrance (a zoom through 106%), and zooms out to leave
      const R0 = TELE.ring, ink = it.ink ?? 'att', side: 'att' | 'def' = ink === 'def' ? 'def' : 'att';
      const style = ink === 'att' || ink === 'def' ? R0 : { ...R0, inner: ink as Ink };
      const [se, ae] = ringEnter(age), [sx, ax] = ex === null ? [1, 1] : ringExit(ex), s = se * sx, al = ae * ax;
      if (s <= 0.001 || al <= 0.001) return;
      const ca = centroidAxis(poly), [gx, gy] = ca.c;
      const P2 = poly.map(([x, y]): XY => [gx + (x - gx) * s, gy + (y - gy) * s]);
      // the edges, welded to the inner rings
      if (ink === 'att' || ink === 'def') inkColour('team', ink, k, st.c1); else inkColour(ink, 'att', k, st.c1);
      const col = [...st.c1, al], rIn = R0.innerR * s * gain;
      P2.forEach((A, i) => {
        const B = P2[(i + 1) % P2.length], dx = B[0] - A[0], dz = B[1] - A[1], Lh = Math.hypot(dx, dz) / 2;
        if (Lh < 1e-3) return;
        const hw = (TELE.unit.lineW / 2) * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.6;
        layer.push([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, dx / (2 * Lh), dz / (2 * Lh)], [Lh + m, hw + m, KIND.edge, al], [Lh, hw, rIn, rIn], [1, 0, 0, gain], col, col);
      });
      // the zebra, the corners cut out (the hull's paint: corners first, every one also a hole)
      const V = st.hullV; V.fill(0);
      let Rmax = 0;
      P2.slice(0, 10).forEach(([x, y], j) => { V[2 * j] = x - gx; V[2 * j + 1] = y - gy; Rmax = Math.max(Rmax, Math.hypot(x - gx, y - gy)); });
      surfaceColour(TELE.color.white, k, st.w);
      const paint = it.fill === 'none' ? 0 : mixPair(Z.zebra, k);
      if (paint > 0) layer.push([gx, gy, 1, 0], [Rmax + 1, Rmax + 1, KIND.hull, al], V.subarray(0, 4), [1, Math.min(10, P2.length), (R0.R + R0.outerW / 2) * s * gain, gain],
        [...st.c1, Math.min(10, P2.length)], [...st.w, paint], V.subarray(4, 20));
      // the rings, for the second pass
      for (const c of P2) rings.push({ xy: c, side, sc: s * gain, al, player: -1, style });
      return;
    }
    const left = retract(ex), [, ax] = ex === null ? [1, 1] : ringExit(ex);
    // a pocket between linked lines takes the colour of the team that made them
    const ink = it.ink ?? (it.lines?.[0]?.length ? sideOf(it.lines[0][0]) : 'att');
    if (ink === 'att' || ink === 'def') inkColour('team', ink, k, st.c1); else inkColour(ink, 'att', k, st.c1);
    surfaceColour(TELE.color.white, k, st.w);
    const hw = wholeHW || Z.outlineHW * gain, m = hw + 3 * TELE.glow.sigma * gain + 0.8, paint = it.fill === 'none' ? 0 : mixPair(Z.zebra, k);
    if (rect && anim !== 'unfold' && !wholeHW) {
      // the sandbox's other entrances, on a rectangle (kind 5): corners draws the outline from the corners with welding
      // sparks and the stripes a beat behind; the others run on one progress, and run it backwards to leave
      const [cx, cy, hx, hy, ang] = rect, ux = Math.cos(ang), uz = Math.sin(ang), sty = ['corners', 'scan', 'unfold', 'trace', 'glint'].indexOf(anim);
      const tp = ex === null ? Math.min(1, Math.max(0, (age - 0.08) / Z.durS[anim])) : Math.max(0, 1 - ex / Z.exitS);
      const fo = anim === 'corners' ? edgeDraw(age - CASCADE.edgeDelay) * left : tp;
      const fp = anim === 'corners' ? Math.min(1, Math.max(0, (age - CASCADE.areaDelay) / Z.paintS)) * left : tp;
      layer.push([cx, cy, ux, uz], [hx + m, hy + m, KIND.zone, anim === 'corners' ? ax : 1], [hx, hy, Z.stripeW * gain, paint], [fo, fp, hw, gain], [...st.c1, sty], [...st.w, 1]);
      if (anim === 'corners' && TELE.spark.on && ex === null) {
        const corner = (sx: number, sy: number): XY => [cx + ux * sx * hx - uz * sy * hy, cy + uz * sx * hx + ux * sy * hy];
        const sides: [XY, XY][] = [[corner(-1, -1), corner(1, -1)], [corner(1, -1), corner(1, 1)], [corner(1, 1), corner(-1, 1)], [corner(-1, 1), corner(-1, -1)]];
        sides.forEach(([A, Bc], j) => lineSparks(A, Bc, 0, 0, age - CASCADE.edgeDelay, hashId(it.id) + 31 * j, st.c1, gain));
      }
      return;
    }
    // any shape (kind 6), unfolding along its axis: the corners in the frame of its spine (the axis through the centroid)
    const ca = centroidAxis(poly), [cx, cy] = ca.c;
    axis ??= ca.axis;
    const ux = Math.cos(axis), uz = Math.sin(axis);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of poly) { const lu = (x - cx) * ux + (y - cy) * uz, lv = -(x - cx) * uz + (y - cy) * ux; u0 = Math.min(u0, lu); u1 = Math.max(u1, lu); v0 = Math.min(v0, lv); v1 = Math.max(v1, lv); }
    if (u1 - u0 < 0.1 || v1 - v0 < 0.1) return;
    const V = st.poly; V.fill(0);
    poly.forEach(([x, y], j) => { V[2 * j] = (x - cx) * ux + (y - cy) * uz; V[2 * j + 1] = -(x - cx) * uz + (y - cy) * ux; });
    // the stripes at 45 degrees on the pitch, in phase with every other zone's: their normal in the local axes
    const r2 = Math.SQRT1_2, X = st.polyX;
    X.set(V.subarray(4, 16)); X[12] = r2 * (ux + uz); X[13] = r2 * (ux - uz); X[14] = r2 * (cx + cy); X[15] = 0;
    const tp = wholeHW ? 1 : ex === null ? Math.min(1, Math.max(0, (age - 0.08) / Z.durS.unfold)) : Math.max(0, 1 - ex / Z.exitS);
    layer.push([cx, cy, ux, uz], [Math.max(-u0, u1) + m, Math.max(-v0, v1) + m, KIND.poly, zoomA], V.subarray(0, 4), [tp, Z.stripeW * gain, hw, gain], [...st.c1, poly.length], [...st.w, paint], X);
  };

  useFrame((state) => {
    // the animation clock: render time; clip time when recording; or set outright by a recording script (__teleNow)
    const now = hooked<number>('teleNow') ?? (hooked<boolean>('capture') ? clock.t : state.clock.elapsedTime), t = clock.t;
    const s = getSettings(), k = surface ? surface.current : s.tactical ? 1 : 0, gain = TELE.viewGain[s.view] ?? 1;
    // births and exits
    const ids = new Set<string>();
    // design checks: window.__teleExtra adds items (in the frame's first <Telestration>), __teleHide hides ids
    const teleExtra = hooked<Item[]>('teleExtra'), teleHide = hooked<string[]>('teleHide'), extra = teleExtra && state.gl.info.render.frame !== extraFrame ? teleExtra : null;
    if (extra) extraFrame = state.gl.info.render.frame;
    for (const it of extra ? [...itemsRef.current, ...extra] : itemsRef.current) {
      if (teleHide?.includes(it.id)) continue;
      const inWin = !it.window || ((it.window.from ?? -Infinity) <= t && t <= (it.window.to ?? Infinity));
      if (!inWin) continue;
      ids.add(it.id);
      const L = st.live.get(it.id);
      if (!L) st.live.set(it.id, { item: it, born: now, exitAt: null });
      else { L.item = it; if (L.exitAt !== null) { L.exitAt = null; L.born = now; } }
    }
    for (const L of st.live.values()) if (!ids.has(L.item.id) && L.exitAt === null) L.exitAt = now;

    // the pixel's size in metres at a ground point, laterally and along the view (for the quads' margins)
    const cam = state.camera as THREE.PerspectiveCamera, H = state.size.height;
    const mpp = (x: number, z: number) => {
      const d = Math.max(0.5, st.v.set(x, 0, z).distanceTo(cam.position)), lat = (d * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / H;
      return [lat, lat * Math.min(60, d / Math.max(0.3, cam.position.y))];
    };
    const u = layer.material.uniforms;
    u.uMinPx.value = TELE.minPx; u.uGlowPx.value = TELE.glow.minPx; u.uGlowSigma.value = TELE.glow.sigma; u.uGlow.value = TELE.glow.strength * mixPair(TELE.glow.gain, k);

    // the vision patch on every scene material, now and as new ones load (every 2 s); off unless a vision item sets it
    if (st.visFrames++ % 120 === 0) patchScene(state.scene);
    if (state.gl.info.render.frame !== cuesFrame) { cuesFrame = state.gl.info.render.frame; VIS.uVisOn.value = 0; OFFB.uOffOn.value = 0; VAR_FACTS.on = false; }
    layer.begin(); sparks.begin(); streaks.begin(); trails.begin();
    st.camPos.copy(state.camera.position); st.camR.set(1, 0, 0).applyQuaternion(state.camera.quaternion); st.camU.set(0, 1, 0).applyQuaternion(state.camera.quaternion);
    { const su = streaks.material.uniforms; su.uMinPx.value = 1.2; su.uGlowPx.value = 2; su.uGlow.value = 0.6; }
    // two passes: every line first, then every ring over the welds (a selected player inside a unit gets one ring)
    const labels: GroundLabel[] = [], rings: RingReq[] = [];
    st.xgw.s.on = false; if (focus) focus.current = -1; st.spots.list = []; st.beams.list = []; st.speedTags.list = []; st.walls.list = []; st.lofts.list = []; st.ctrl.s.on = false;
    for (const [id, L] of st.live) {
      const ex = L.exitAt === null ? null : now - L.exitAt;
      if (ex !== null && ex >= exitS(L.item)) { st.live.delete(id); continue; }
      const it = L.item;
      if (it.kind === 'marker') {
        if (!anchors.resolve(it.at, t, TELE.smoothS, st.xy)) continue;
        const [se, ae] = ringEnter(now - L.born), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
        const player = 'player' in it.at && !Array.isArray(it.at) ? it.at.player : -1;
        rings.push({ xy: [st.xy[0], st.xy[1]], side: player >= 0 ? sideOf(player) : 'att', sc: se * sx * gain, al: ae * ax, player, style: { ...TELE.ring, ...it.style } });
      } else if (it.kind === 'units') {
        drawUnits(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'network') {
        drawNetwork(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'zone') {
        drawZone(it, now - L.born, ex, k, gain, rings, labels);
      } else if (it.kind === 'vision') {
        drawVision(it, now - L.born, ex, k, gain);
      } else if (it.kind === 'linebreak') {
        drawBreak(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'trail') {
        drawTrail(it, now - L.born, ex, k);
      } else if (it.kind === 'heading') {
        drawHeading(it, now - L.born, ex, k, gain);
      } else if (it.kind === 'control') {
        drawControl(it, now - L.born, ex, k);
      } else if (it.kind === 'pass') {
        const A: XY = [0, 0], B: XY = [0, 0];
        if (anchors.resolve(it.from, t, 0, A) && anchors.resolve(it.to, t, 0, B)) drawPass([A[0], A[1]], [B[0], B[1]], now - L.born, ex, it.whatif ? 0.55 : 1, k, gain, passLoft(it, A, B));
      } else if (it.kind === 'run') {
        const { player, from, to } = it.path, path: XY[] = [], q: XY = [0, 0];
        for (let tt = from; tt <= to + 1e-6; tt += 0.1) if (anchors.player(player, tt, TELE.smoothS, q)) path.push([q[0], q[1]]);
        pushRun(path, arrowT(now - L.born, ex), now - L.born, 1, k, gain);
      } else if (it.kind === 'offside') {
        drawOffside(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'spotlight') {
        if (anchors.resolve(it.at, t, TELE.smoothS, st.xy)) pushSpot(st.xy[0], st.xy[1], now - L.born, ex, gain);
      } else if (it.kind === 'pressure') {
        drawPressure(it, now - L.born, ex, k, gain, rings);
      } else if (it.kind === 'hull') {
        drawHull(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'shot') {
        drawShot(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'marking') {
        drawMarking(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'stroke') {
        drawStroke(it, ex, k, gain, labels);
      } else if (it.kind === 'gauge') {
        drawGauge(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'passprob') {
        drawPassProb(it, now - L.born, ex, k, gain, labels, rings);
      } else if (it.kind === 'link') {
        // by who was linked (LinkItem): a pair of opponents, an area, a line, or the first player's ring so far
        const ps = it.players, mixed = new Set(ps.map(sideOf)).size > 1, age = now - L.born;
        // when each player was linked, so each pops in on his own click
        let born = st.linkBorn.get(it.id);
        if (!born) { born = new Map(); st.linkBorn.set(it.id, born); }
        for (const p of ps) if (!born.has(p)) born.set(p, now);
        const pAge = (p: number) => now - (born!.get(p) ?? L.born);
        if (ps.length === 2 && mixed) drawMarking({ id: it.id, kind: 'marking', pair: [ps[0], ps[1]], at: it.at, labels: false }, age, ex, k, gain, labels, rings);
        else if (it.closed && ps.length >= 3) drawHull({ id: it.id, kind: 'hull', players: ps, at: it.at }, age, ex, k, gain, labels, rings);
        else if (ps.length >= 2) drawUnits({ id: it.id, kind: 'units', side: sideOf(ps[0]), players: ps, at: it.at, labels: false }, age, ex, k, gain, labels, rings, pAge);
        else if (ps.length === 1 && anchors.player(ps[0], it.at ?? t, TELE.smoothS, st.xy)) {
          const [se, ae] = ringEnter(pAge(ps[0])), [sx, ax] = ex === null ? [1, 1] : ringExit(ex);
          rings.push({ xy: [st.xy[0], st.xy[1]], side: sideOf(ps[0]), sc: se * sx * gain, al: ae * ax, player: ps[0], style: TELE.ring });
        }
      }
    }
    // a player with a ring of his own (the selected one) is drawn once, with the stronger of his rings
    const best = new Map<number, RingReq>();
    for (const r of rings) { if (r.player < 0) continue; const b = best.get(r.player); if (!b || r.al * r.sc > b.al * b.sc) best.set(r.player, r); }
    for (const r of rings) {
      if (r.player >= 0 && best.get(r.player) !== r) continue;
      if (r.al <= 0.001) continue;
      const R = r.style, sc = r.sc, [, along] = mpp(r.xy[0], r.xy[1]);
      const half = (R.R + R.outerW / 2) * sc + Math.min(4, 3 * Math.max(TELE.glow.sigma * sc, TELE.glow.minPx * along) + 0.5 * TELE.minPx * along) + 0.05;
      inkColour(R.outer, r.side, k, st.c1); inkColour(R.inner, r.side, k, st.c2);
      layer.push([r.xy[0], r.xy[1], 1, 0], [half, half, KIND.ring, r.al],
        [R.R * sc, R.outerW * sc, R.innerR * sc, R.innerW * sc],
        [R.arcs, R.dashFill, (2 * Math.PI * now) / R.spinS, sc],
        [...st.c1, 1], [...st.c2, 1]);
    }
    layer.end(); sparks.end(state.gl.getPixelRatio()); streaks.end(state.gl.getDrawingBufferSize(st.vp)); trails.end();
    st.labels.list = labels;
    hook('teleState', { live: [...st.live.keys()], drawn: layer.count, now, t, layer, trails, nets: st.nets });
  });
  return <><primitive object={layer.mesh} /><primitive object={sparks.points} /><primitive object={streaks.mesh} /><GroundLabels store={st.labels} /><XgWidget store={st.xgw} /><XgGroundTag store={st.xgw} /><Spotlights store={st.spots} /><primitive object={trails.mesh} /><SpeedTags store={st.speedTags} /><OffsideWalls store={st.walls} /><VarMarks /><VisionBeam store={st.beams} /><LoftArrows store={st.lofts} /><ControlLayer store={st.ctrl} /></>;
}
