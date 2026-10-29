// HUD-local state for the designs on trial in the HUD preview: the 画板 mode, 观赛's display options, the
// 战术 mode's base map and annotation, and the drawings. None of it is in src/game/settings.ts yet; once a
// design is accepted, the fields move there for the 3D side (docs/plans/hud-notes.md). Each store is read with `useStore(store)` in
// React (a name the hooks linter recognises), or `store.get()` outside it; addresses open them for screenshots (?draw=1, ?base=pc|v|q, ?annot=run|threat|shot|create|pass,
// ?sub=<sub-option>).
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { tr } from '../i18n';
import type { Clock } from '../clock';
import { getSettings } from '../game/settings';

export interface Store<T> {
  get: () => T;
  set: (next: T | ((previous: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}
/** a small external store: one value, listeners told when it changes (an unchanged value notifies nobody) */
export function store<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      listeners.forEach((notify) => notify());
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
/** a store's value in a React component, re-rendering when it changes */
export function useStore<T>(source: Store<T>): T {
  return useSyncExternalStore(source.subscribe, source.get, source.get);
}
const Q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

// ---- 画板, the fourth mode (draft): a HUD flag over the settings' mode, which stays 观赛 underneath (grass, no layers)
export const drawMode = store<boolean>(Q.get('draw') === '1');

// (观赛's display options moved to the Show menu, settings.ts `show`)

// ---- 战术: one base map and one annotation, each optional
// Retired: space value V as a map of its own (it is the network's output from the ball's position
// alone; it stays inside Q) and the runs' SOG / SGG (rarely there at a random pause, noise when there; code in
// <private-workspace>). Retired from the marks:
// threat ΔxT (it may come back as a showing option of the pen; overlayShapes.tsx keeps threatShapes),
// shots xG / xGOT and chance creation xA / potential xA (code before: <private-workspace>).
// Space quality Q left the menu too (cut for the MVP; BaseMap3D still draws it
// for an Explain script's board). In its place two fixed grids a commentator can talk over (Guardiola's positional-play
// lanes, and the traditional division of the pitch that has zone 14): the same for every moment and team.
export type BaseKey = 'pc' | 'lanes' | 'zones' | 'xt';
export type AnnotKey = 'pass';
export const BASES: { key: BaseKey; label: string; abbr?: string }[] = [
  { key: 'pc', label: tr('球场控制', 'Pitch control') },
  { key: 'lanes', label: 'Five lanes' },   // positional play's lanes: wing, half-space, centre
  { key: 'zones', label: 'Zone 14' },      // the classic 18 zones, zone 14 picked out
  { key: 'xt', label: 'Expected threat', abbr: 'xT' },   // Karun Singh's xT, project_kick's surface
];
/** each annotation's sub-options, as a type: a typo in a sub-option no longer compiles (review F16) */
export interface AnnotationSubs { pass: 'prob' }
export const ANNOTS: { key: AnnotKey; label: string; subs: { key: AnnotationSubs[AnnotKey]; label: string }[] }[] = [
  // only the pass probability stays (line breaks, option value and better team-mates removed): a plain switch
  { key: 'pass', label: tr('传球', 'Passing'), subs: [] },
];
const isBase = (k: string | null): k is BaseKey => BASES.some((b) => b.key === k);
const isAnnot = (k: string | null): k is AnnotKey => ANNOTS.some((a) => a.key === k);
export const base = store<BaseKey | null>(isBase(Q.get('base')) ? (Q.get('base') as BaseKey) : null);
export const annot = store<AnnotKey | null>(isAnnot(Q.get('annot')) ? (Q.get('annot') as AnnotKey) : null);
/** each annotation's chosen sub-option, remembered while the mode is on */
export const annotSub = store<AnnotationSubs>((() => {
  const chosen: AnnotationSubs = { pass: 'prob' };
  const annotation = Q.get('annot'), sub = Q.get('sub');
  const offered = ANNOTS.find((x) => x.key === annotation)?.subs.find((x) => x.key === sub);
  if (isAnnot(annotation) && offered) (chosen as Record<AnnotKey, string>)[annotation] = offered.key;
  return chosen;
})());
/** the offside line (one click, universal; the players in an offside position lit), a switch of its own
 *  beside the annotation, so it can be on with the passing mark (the pass to an offside man then not offered); the
 *  telestration offside item draws it (TacticsItems.tsx). ?offside=1 (or the older ?annot=offside) */
export const offsideMark = store<boolean>(Q.get('offside') === '1' || Q.get('annot') === 'offside');
/** the shot chance (at any on-ball moment, beside the passing probability; in the MARK section): the player on the
 *  ball's xG if he shot now, the telestration shot cone; a switch of its own,
 *  greyed with nobody on the ball, combinable with Passing and the offside line. ?xg=1 */
export const xgMark = store<boolean>(Q.get('xg') === '1');
/** the clip's on-ball moments, for the Tactics pause's previous / next event (kept by TacticsItems from the package's
 *  events): `t` just before the action, while the ball is at his feet */
export const clipMoments = store<{ t: number; label: string }[]>([]);
/** an annotation's catalogue entry and its chosen sub-option's label (total: every key and sub-option is listed above) */
export const annotLabel = (key: AnnotKey, sub: string) => {
  const entry = ANNOTS.find((x) => x.key === key);
  return { label: entry?.label ?? key, sub: entry?.subs.find((x) => x.key === sub)?.label ?? sub };
};

// ---- 画板's drawings, in pitch metres (the 3D side would lay them on the grass)
// The Tactics pen (telestration-notes §22): each tool a gesture, each stroke one of the telestration
// items (Pen3D.tsx): click players (highlight, vision, speed trail; the passing network left out), drag
// from a player (a pass arrow,
// ground or lofted), drag a player (his run's chevrons), click players in order (a link: the marking pair, a line, or an
// area when the first is clicked again), a zone (rectangle, circle or polygon), two points (a distance). 'dribble',
// 'circle' and 'pen' were 画板's and stay in the type for the HUD preview's stand-in only.
export type Tool = 'highlight' | 'vision' | 'trail' | 'pass' | 'run' | 'link' | 'zone' | 'measure' | 'dribble' | 'circle' | 'pen';
export type ZoneShape = 'rect' | 'circle' | 'poly';
export type Ink = 'white' | 'blue' | 'orange' | 'yellow';
export type Aid = 'offside' | 'line' | 'fov' | 'trail';
export interface Stroke {
  tool: Tool; ink: Ink;
  /** pitch metres: the clicks or the drag's ends (a pass's and a run's start and end, a zone's corners, centre and edge) */
  pts: [number, number][];
  /** a pass's or a run's player, 画板's circled player */
  player?: number;
  /** the pen's: its marks' id, the same while it is dragged and once drawn */
  id?: string;
  /** players picked, in order (highlight, vision, trail, network, link); a pass released on a team-mate: [him] */
  players?: number[];
  /** a link back to its first player (an area), a polygon back to its first corner */
  closed?: boolean;
  shape?: ZoneShape;
  /** the clip time it was drawn at: its marks show the players then */
  t?: number;
}
/** a saved freeze frame: its strokes, shown again when the clock comes back to its time */
export interface Frame { t: number; strokes: Stroke[] }
/** the pen's tools, with the gesture each takes (shown under the palette) */
export const TOOLS: { key: Tool; label: string; how: string }[] = [
  { key: 'highlight', label: 'Highlight', how: 'Click players' },
  { key: 'vision', label: 'Vision', how: 'Click players' },
  { key: 'trail', label: 'Speed trail', how: 'Click players' },
  { key: 'pass', label: 'Pass', how: 'Drag from a player' },
  { key: 'run', label: 'Run', how: 'Drag a player' },
  { key: 'link', label: 'Link', how: 'Click players in turn' },
  { key: 'zone', label: 'Zone', how: 'Click corners, then the first' },   // a polygon only (no box or circle)
  { key: 'measure', label: 'Distance', how: 'Drag two points' },
];
export const INKS: { key: Ink; label: string; css: string }[] = [
  { key: 'white', label: tr('白', 'White'), css: '#f2f4f7' }, { key: 'blue', label: tr('蓝', 'Blue'), css: '#6ab8ff' },
  { key: 'orange', label: tr('橙', 'Orange'), css: '#ff9560' }, { key: 'yellow', label: tr('黄', 'Yellow'), css: '#ffd166' },
];
export const AIDS: { key: Aid; label: string }[] = [
  { key: 'offside', label: tr('越位线', 'Offside line') }, { key: 'line', label: tr('防线', 'Defensive line') },   // 'Auto lines': drawn from the data at the moment
  { key: 'fov', label: tr('视野', 'Field of view') }, { key: 'trail', label: tr('跑动轨迹', 'Run trail') },
];
export const tool = store<Tool>('pass');
/** the player under the pointer, as the camera director's hover triangle shows him (-1 for none): the pen draws on the
 *  player the triangle points at, so the viewer sees whom a stroke will be drawn on. Set by the camera Director
 *  (three/camera/Director.tsx; hud-notes.md request 14) */
export const hoveredPlayer = store<number>(-1);
/** a drawn mark under the pointer and the one selected (their strokes' ids), and where the selected one's delete button
 *  goes on the page (a hovered mark can be selected; the selected one shows a delete button that removes it);
 *  Pen3D keeps them */
export const hoveredStroke = store<string | null>(null);
export const selectedStroke = store<string | null>(null);
export const selectedAt = store<[number, number] | null>(null);
/** the zone still being clicked on: the last stroke, a polygon not yet closed (an open polygon is never a finished mark;
 *  Pen3D closes or drops it when the tool changes) */
export const openZone = (list: Stroke[]): Stroke | null => { const s = list[list.length - 1]; return s && s.tool === 'zone' && s.shape === 'poly' && !s.closed ? s : null; };
/** one drawn stroke deleted (the selected one) */
export const removeStroke = (id: string) => { strokes.set((p) => p.filter((s) => s.id !== id)); syncFrame(); if (selectedStroke.get() === id) selectedStroke.set(null); if (hoveredStroke.get() === id) hoveredStroke.set(null); };
/** the stroke being dragged now (its marks follow the pointer) */
export const drafting = store<Stroke | null>(null);
let strokeCount = 0;
/** a new stroke's id for its marks */
export const strokeId = () => `pen-${++strokeCount}`;
export const ink = store<Ink>('white');
export const aids = store<Aid[]>([]);
/** the drawing on the pitch now: the strokes of the freeze frame at its moment (saved as they are drawn) */
export const strokes = store<Stroke[]>([]);
/** strokes taken back by undo, newest last, for redo; a new stroke or a clear empties it */
export const undone = store<Stroke[]>([]);
export const frames = store<Frame[]>([]);
/** a saved frame within this of another replaces it, seconds */
export const FRAME_MERGE_TOLERANCE_SECONDS = 0.05;
/** a saved frame's strokes show while the clock is within this of it, seconds (a press near its tick snaps to it) */
export const FRAME_VISIBLE_TOLERANCE_SECONDS = 0.15;
/** after play passes a saved frame, its strokes fade over this long, seconds */
export const FRAME_FADE_SECONDS = 1.5;
/** save the strokes being drawn as a freeze frame at clip time t (replacing one saved at the same moment); the replay
 *  plate's save button (every drawing also saves itself: syncFrame) */
export const saveFreezeFrame = (t: number, drawn: Stroke[] = strokes.get()) => {
  if (!drawn.length) return;
  frames.set((saved) => [...saved.filter((f) => Math.abs(f.t - t) > FRAME_MERGE_TOLERANCE_SECONDS), { t, strokes: drawn }].sort((a, b) => a.t - b.t));
};

// ---- the freeze frames in the Tactics mode: every drawing is one, kept per clip
// - a drawing on the paused picture saves itself as it is drawn (a tick on the replay plate's timeline and an entry in
//   its list, where it can be deleted): every change to the strokes writes the frame at their moment, and with the last
//   stroke gone the frame goes (syncFrame, from the stroke helpers);
// - play from a drawing: its marks animate out first, then play goes on (useFreezeFramePlay holds the clock
//   through the telestration items' exits);
// - play reaching a frame pauses on it, its drawing coming back, and goes on only when play is pressed
//   again; a frame paused on (the list, a press near its tick) is opened to draw on (Pen3D: openFrame);
// - each clip keeps its own frames while the page is open (switchClip).
/** the clip time of the drawing on the pitch (its frame's), null with none */
let drawingT: number | null = null;
/** the drawing written into its frame: saved at its moment, or the frame dropped with no strokes left */
const syncFrame = () => {
  const s = strokes.get();
  if (s.length) drawingT = s[0].t ?? drawingT;
  if (drawingT === null) return;
  const t = drawingT;
  frames.set((saved) => {
    const rest = saved.filter((f) => Math.abs(f.t - t) > FRAME_MERGE_TOLERANCE_SECONDS);
    return (s.length ? [...rest, { t, strokes: s }] : rest).sort((a, b) => a.t - b.t);
  });
  if (!s.length) drawingT = null;
};
/** the clip time of the drawing on the pitch, null with none */
export const drawingAt = () => drawingT;
/** a saved frame's drawing on the pitch, to draw on (paused on it) */
export const openFrame = (f: Frame) => { strokes.set(f.strokes); undone.set([]); drawingT = f.t; };
/** the drawing leaves the pitch (play, a glide, another moment or clip); its frame stays saved */
export const leaveDrawing = () => { strokes.set([]); undone.set([]); drawingT = null; selectedStroke.set(null); hoveredStroke.set(null); };
/** the drawing's marks are animating out (Pen3D leaves them out of the scene, so the telestration items' exits run) */
export const drawingExit = store<boolean>(false);
/** the longest of the telestration items' exits (a ring's, 0.34 s) and a little, seconds */
export const EXIT_S = 0.4;
/** the drawing animates out, then `then` (play goes on, a glide starts); at once with none */
export const exitDrawing = (then?: () => void) => {
  if (!strokes.get().length) { then?.(); return; }
  if (drawingExit.get()) return;
  drawingExit.set(true); drawingFading.set(true);
  window.setTimeout(() => { leaveDrawing(); drawingExit.set(false); drawingFading.set(false); then?.(); }, EXIT_S * 1000);
};
/** each clip's frames while the page is open, by clip id; the one on screen is `frames` */
const framesByClip = new Map<string, Frame[]>();
let clipOnScreen: string | null = null;
/** another clip on screen: its own frames (the drawing leaves; the last clip's frames are kept for its return) */
export const switchClip = (id: string) => {
  if (id === clipOnScreen) return;
  if (clipOnScreen !== null) framesByClip.set(clipOnScreen, frames.get());
  leaveDrawing();
  frames.set(framesByClip.get(id) ?? []);
  clipOnScreen = id;
};

/** whether the clip is playing, as the HUD's playback says (the pitch overlay inside the 3D scene has no playback of its own) */
export const playbackPlaying = store<boolean>(false);
/** the drawing is animating out (exitDrawing; the HUD preview fades its own drawing by it) */
export const drawingFading = store<boolean>(false);
/** keeps playbackPlaying in step; mounted once, by the HUD */
export function useDrawingPlayback(playing: boolean) {
  useEffect(() => { playbackPlaying.set(playing); }, [playing]);
}
/** a clock step longer than this between two ticks is a jump (a seek, play starting over), not play passing, seconds */
const JUMP_S = 0.5;
/** the Tactics mode's freeze frames in play (see above): play from a drawing holds the clock at its moment while the
 *  marks animate out; play reaching a frame pauses on it. Mounted once, by the Tactics column, which has the playback */
export function useFreezeFramePlay(playback: { playing: boolean; play: (on: boolean) => void; seek: (t: number) => void } | undefined, clock: Clock | undefined) {
  const ctl = useRef(playback);
  ctl.current = playback;
  const playing = !!playback?.playing;
  useEffect(() => {
    if (!playing || !clock || getSettings().mode !== 'tactics') return;
    // play from a drawing: the clock held at its moment while it animates out
    const holdAt = strokes.get().length ? drawingT ?? clock.t : null;
    if (holdAt !== null) exitDrawing();
    let prev = holdAt ?? clock.t, id = 0;
    const tick = () => {
      if (drawingExit.get() && holdAt !== null) clock.t = holdAt;
      else {
        // a frame passed since the last tick (either way: rewind too), not over a jump (a seek, play starting over)
        const t = clock.t, jump = Math.abs(t - prev) > JUMP_S || getSettings().mode !== 'tactics';
        const f = jump ? undefined : frames.get().find((x) => (prev < x.t && x.t <= t) || (t <= x.t && x.t < prev));
        if (f && ctl.current) { ctl.current.play(false); ctl.current.seek(f.t); return; }   // a frame reached: paused on it
        prev = t;
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, clock]);
}
/** how strongly a saved frame shows at clip time t: fully while the clock is at it, fading over the play after it */
export const frameAlpha = (frameT: number, t: number, playing: boolean) =>
  Math.abs(t - frameT) < FRAME_VISIBLE_TOLERANCE_SECONDS ? 1 : playing && t > frameT && t < frameT + FRAME_FADE_SECONDS ? 1 - (t - frameT) / FRAME_FADE_SECONDS : 0;
/** a new stroke on the frame being drawn (redo no longer applies) */
export const addStroke = (s: Stroke) => { strokes.set((p) => [...p, s]); undone.set([]); syncFrame(); };
/** the latest stroke grown (a link or a vision clicked on, a polygon's next corner) */
export const replaceLastStroke = (s: Stroke) => { strokes.set((p) => [...p.slice(0, -1), s]); undone.set([]); syncFrame(); };
export const undo = () => { const p = strokes.get(); if (!p.length) return; undone.set((u) => [...u, p[p.length - 1]]); strokes.set(p.slice(0, -1)); syncFrame(); };
export const redo = () => { const u = undone.get(); if (!u.length) return; strokes.set((p) => [...p, u[u.length - 1]]); undone.set(u.slice(0, -1)); syncFrame(); };
/** the drawing cleared: its frame goes too */
export const clearStrokes = () => { strokes.set([]); undone.set([]); syncFrame(); selectedStroke.set(null); hoveredStroke.set(null); };

/** which of the left column's menus is open (with the panel store's 'rail'): the base map, an annotation, the auto lines,
 *  the colour */
export type RailMenu = 'base' | AnnotKey | 'aids' | 'ink';
const RAIL_MENUS: readonly string[] = ['base', 'aids', 'ink', ...ANNOTS.map((a) => a.key)];
const parseRailMenu = (raw: string | null): RailMenu | null => (raw !== null && RAIL_MENUS.includes(raw) ? (raw as RailMenu) : null);
export const railMenu = store<RailMenu | null>(parseRailMenu(Q.get('menu')));
