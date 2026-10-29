// The game UI's shared settings (?ui=game), the contract between the HUD panels (src/hud/, built
// separately) and the 3D pitch (src/three/). The HUD writes them, the pitch reads them. Every field is mirrored to the
// address so the headless scripts can shoot any state: ?view=free&style=toon&scope=all&layers=speed,map&sel=7
// Design: docs/design/three-channels.html; plan: docs/plans/2026-10-22-game-ui.md.
import { useSyncExternalStore } from 'react';
import { tr } from '../i18n';

/** broadcast: follows the ball from the main stand; free: the spidercam; third: 1.5-person behind the selected player;
 *  first: the selected player's eyes; referee, ar1, ar2: the officials' eyes; tactical: straight down from above the
 *  pitch, like a tactics board */
export type ViewMode = 'broadcast' | 'free' | 'third' | 'first' | 'referee' | 'ar1' | 'ar2' | 'tactical' | 'aerialNear' | 'aerialFar' | 'aerialIn';
/** ('ghost-still': the ghost without its trail, the What-if mode's pause and touch; not in the style menu) */
export type PlayerStyle = 'toon' | 'lines' | 'token' | 'silhouette' | 'ghost' | 'ghost-still';
/** which players carry the per-player layers */
export type Scope = 'all' | 'selected' | 'attack';
export type LayerKey = 'speed' | 'trail' | 'fov' | 'lines' | 'offside' | 'mark' | 'ball' | 'xg' | 'map' | 'toast';
export type Preset = 'clean' | 'tactic' | 'fitness' | 'all';

// in the HUD's order: cameras, officials, players; keys 1-8 down the list
/** the views in the menu's order: cameras, then the two player views (renamed as a pair:
 *  球员视角 through his eyes, 球员跟拍 a camera following him), then the officials. The HUD binds the keys. */
export const VIEWS: { key: ViewMode; label: string; hotkey: string; needsPlayer?: boolean; hidden?: boolean }[] = [
  { key: 'broadcast', label: tr('转播', 'Broadcast'), hotkey: '1' },
  { key: 'tactical', label: tr('俯视', 'Top-down'), hotkey: '2' },
  { key: 'free', label: tr('自由', 'Free'), hotkey: '3' },
  { key: 'first', label: tr('球员视角', 'Player POV'), hotkey: '4', needsPlayer: true },
  { key: 'third', label: tr('球员跟拍', 'Player cam'), hotkey: '5', needsPlayer: true },
  { key: 'referee', label: tr('主裁', 'Referee'), hotkey: '6' },
  { key: 'ar1', label: tr('边裁 1', 'Assistant 1'), hotkey: '7' },
  { key: 'ar2', label: tr('边裁 2', 'Assistant 2'), hotkey: '8' },
  // the stadium from outside, as from a drone (a near and a far one); last so the keys above keep
  // their numbers
  // (the stadium orbit replaces the aerial wide on the menu, and the aerial close is named just Drone)
  { key: 'aerialNear', label: tr('无人机', 'Drone'), hotkey: '9' },
  // the whole pitch from high in the roof's opening, turning (made for the match summary, to show the full pitch inside
  // the stadium; on the menu too as the stadium orbit)
  { key: 'aerialIn', label: 'Stadium orbit', hotkey: '0' },
  // the stadium from far outside: off the menus since the orbit took its place, kept in case
  { key: 'aerialFar', label: tr('远景', 'Aerial wide'), hotkey: '', hidden: true },
];

export const STYLES: { key: PlayerStyle; label: string }[] = [
  { key: 'toon', label: tr('卡通', 'Toon') }, { key: 'lines', label: tr('骨骼', 'Skeleton') }, { key: 'token', label: tr('棋子', 'Token') }, { key: 'silhouette', label: tr('剪影', 'Silhouette') }, { key: 'ghost', label: tr('幽灵', 'Ghost') },
];

export const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: tr('全部球员', 'All players') }, { key: 'selected', label: tr('只看选中', 'Selected only') }, { key: 'attack', label: tr('只看进攻方', 'Attackers only') },
];

/** the display switches, in their panel groups; must = in the demo for sure */
export const LAYERS: { key: LayerKey; label: string; group: '球员身上' | '两队阵型' | '球' | '画面'; hotkey: string; must: boolean }[] = [
  { key: 'speed', label: tr('速度圈', 'Speed rings'), group: '球员身上', hotkey: 'V', must: true },
  { key: 'trail', label: tr('跑动拖尾', 'Run trails'), group: '球员身上', hotkey: 'T', must: true },
  { key: 'fov', label: tr('视野', 'Vision'), group: '球员身上', hotkey: 'F', must: true },
  { key: 'lines', label: tr('防线和中场线', 'Defence & midfield lines'), group: '两队阵型', hotkey: 'L', must: true },
  { key: 'offside', label: tr('越位线', 'Offside line'), group: '两队阵型', hotkey: 'O', must: true },
  { key: 'mark', label: tr('盯人连线', 'Marking links'), group: '两队阵型', hotkey: 'K', must: false },
  { key: 'ball', label: tr('球的轨迹', 'Ball path'), group: '球', hotkey: 'B', must: true },
  { key: 'xg', label: tr('持球人实时 xG', 'Live xG of the carrier'), group: '球', hotkey: 'X', must: false },
  { key: 'map', label: 'Radar', group: '画面', hotkey: 'R', must: true },
  { key: 'toast', label: tr('事件提示', 'Event toasts'), group: '画面', hotkey: 'E', must: false },
];

export const PRESETS: Record<Preset, { label: string; layers: LayerKey[] }> = {
  // the 战术 mode's default: the plain dark board after the change, so for now no pitch control (its look
  // on the board is still to be settled), no lines between players and no ball trail (the drawings come from the
  // telestration layer); no number plates
  clean: { label: tr('简洁', 'Clean'), layers: ['map'] },
  // 战术 is the mode's own name now; the Spearman 'space' layer is gone (pitch control is the 战术 base map,
  // the notebook's model precalculated; docs/plans/space-metrics.md)
  tactic: { label: tr('阵型', 'Shape'), layers: ['ball', 'map', 'lines', 'offside', 'trail'] },
  fitness: { label: tr('体能', 'Fitness'), layers: ['ball', 'map', 'speed', 'trail'] },
  all: { label: tr('全开', 'All on'), layers: LAYERS.map((l) => l.key) },
};

/** the game's three modes, from watching to changing: 看 → 懂 → 改. 观赛 you watch the match as it was
 *  (views, the player card, the minimap); 讲解 the AI walks you through it (commentary, lines drawn on the pitch); 战术
 *  you take it apart (the dark analysis pitch, the display layers, the what-if tools when paused). The HUD's 模式
 *  button lists them in this order, with the sub-lines. */
export type GameMode = 'watch' | 'explain' | 'tactics' | 'whatif';
export const MODES: { key: GameMode; label: string; sub: string }[] = [
  { key: 'watch', label: tr('观赛', 'Watch'), sub: tr('自由看球：切视角，点球员看数据', 'Watch freely: switch views, click a player for stats') },
  { key: 'explain', label: tr('讲解', 'Explain'), sub: tr('AI 带你看：配解说，在场上画出跑位和传球', 'AI walks you through it: commentary, runs and passes drawn on the pitch') },
  { key: 'tactics', label: tr('战术', 'Tactics'), sub: 'Take it apart: space and pitch control, threat, passing options, and a pen to draw' },
  // the fourth (docs/plans/hud-notes.md "Four modes"): change a curated moment, see a simulation
  { key: 'whatif', label: 'What-if', sub: 'Change a key moment and watch what could have happened, simulated' },
];

/** the modes on the dark analysis board: 战术, and What-if (its board is the tactics board) */
export const boardOf = (m: GameMode) => m === 'tactics' || m === 'whatif';
/** views not offered on the board: the officials' eyes and the stadium from outside (the officials are
 *  not drawn there either); entering the board from one of them goes back to the broadcast view */
export const OFF_BOARD_VIEWS: ViewMode[] = ['referee', 'ar1', 'ar2', 'aerialNear', 'aerialFar', 'aerialIn'];

/** the Show menu, the same in every mode and kept across them: what is drawn on which players, one tag
 *  over the head (the stamina bar under the name, eFootball's way, three/layers/ShowLayer.tsx), and the chosen players'
 *  style (the rest stay toon; Stage draws the two sets). For the MVP name, stamina and the style only (the speed ring
 *  and the event toasts went, too heavy for it; no token style) */
export type ShowWho = 'ball' | 'selected' | 'home' | 'away' | 'all';
export type ShowWhat = 'name' | 'stamina';
export type ShowStyle = 'toon' | 'lines' | 'silhouette' | 'ghost';
/** who: one choice at a time (the On row is single choice, like the style) */
export interface ShowOpts { who: ShowWho; what: ShowWhat[]; style: ShowStyle }
export const SHOW_WHAT: { key: ShowWhat; label: string }[] = [{ key: 'name', label: 'Name' }, { key: 'stamina', label: 'Stamina' }];
export const SHOW_STYLES: { key: ShowStyle; label: string }[] = [{ key: 'toon', label: 'Toon' }, { key: 'lines', label: 'Skeleton' }, { key: 'silhouette', label: 'Silhouette' }, { key: 'ghost', label: 'Ghost' }];
export const SHOW_WHO: { key: ShowWho; label: string }[] = [{ key: 'ball', label: 'On Ball Player' }, { key: 'selected', label: 'Selected Player' }, { key: 'home', label: 'Home Team' }, { key: 'away', label: 'Away Team' }, { key: 'all', label: 'All Players' }];
/** the player on the ball with his name, everyone toon (the name on by default, the viewer can change it;
 *  the ball's trail is off by default, its layer not in the clean preset) */
const DEFAULT_SHOW: ShowOpts = { who: 'ball', what: ['name'], style: 'toon' };

export interface GameSettings {
  view: ViewMode;
  mode: GameMode;
  /** mode === 'tactics', kept in step by setSettings (the pitch, the layers and other modules read it): the grass flips
   *  to the dark analysis pitch, and the player style and the display layers apply only while it is on. Setting it
   *  (the older toggle) switches the mode to 战术, or back to 观赛. */
  tactical: boolean;
  style: PlayerStyle;
  scope: Scope;
  layers: LayerKey[];
  /** the selected player, as an index into the package's players (attackers first, then defenders), or null */
  selected: number | null;
  /** the Show menu's choices; entering 战术 leaves them as they are */
  show: ShowOpts;
}

const ALL_VIEWS = VIEWS.map((v) => v.key), ALL_STYLES = STYLES.map((s) => s.key), ALL_SCOPES = SCOPES.map((s) => s.key), ALL_LAYERS = LAYERS.map((l) => l.key);

export const DEFAULT_SETTINGS: GameSettings = { view: 'broadcast', mode: 'watch', tactical: false, style: 'toon', scope: 'all', layers: PRESETS.clean.layers, selected: null, show: DEFAULT_SHOW };
const ALL_WHO = SHOW_WHO.map((x) => x.key), ALL_WHAT = SHOW_WHAT.map((x) => x.key);

function fromURL(): GameSettings {
  const q = new URLSearchParams(location.search), s = { ...DEFAULT_SETTINGS };
  const md = q.get('mode');
  if (md === 'explain' || md === 'tactics' || md === 'whatif') s.mode = md; else if (q.get('tac') === '1') s.mode = 'tactics';   // tac=1: the older address
  s.tactical = boardOf(s.mode);
  const v = q.get('view'), st = q.get('style'), sc = q.get('scope'), ly = q.get('layers'), sel = q.get('sel');
  if (v && (ALL_VIEWS as string[]).includes(v)) s.view = v as ViewMode;
  if (st && (ALL_STYLES as string[]).includes(st)) s.style = st as PlayerStyle;
  if (sc && (ALL_SCOPES as string[]).includes(sc)) s.scope = sc as Scope;
  if (ly !== null) s.layers = ly.split(',').filter((k) => (ALL_LAYERS as string[]).includes(k)) as LayerKey[];
  if (sel !== null && sel !== '' && Number.isInteger(+sel)) s.selected = +sel;
  if (s.tactical && OFF_BOARD_VIEWS.includes(s.view)) s.view = 'broadcast';
  // ?show=name,stamina &who=ball|selected|home|away|all &pstyle=lines|silhouette|ghost (written only when they differ
  // from the defaults; an older address's list of whos keeps its first)
  const sh = q.get('show'), who = q.get('who'), ps = q.get('pstyle');
  s.show = {
    what: sh === null ? DEFAULT_SHOW.what : sh.split(',').filter((k) => (ALL_WHAT as string[]).includes(k)) as ShowWhat[],
    who: (who?.split(',').find((k) => (ALL_WHO as string[]).includes(k)) as ShowWho | undefined) ?? DEFAULT_SHOW.who,
    style: SHOW_STYLES.some((x) => x.key === ps) ? ps as ShowStyle : DEFAULT_SHOW.style,
  };
  return s;
}

let state: GameSettings = typeof location === 'undefined' ? DEFAULT_SETTINGS : fromURL();
const listeners = new Set<() => void>();
export const toggleTactical = () => setSettings((s) => ({ tactical: !s.tactical }));
export const setMode = (mode: GameMode) => setSettings({ mode });

function toURL(s: GameSettings) {
  const q = new URLSearchParams(location.search);
  q.set('view', s.view); if (s.mode !== 'watch') q.set('mode', s.mode); else q.delete('mode'); q.delete('tac'); q.delete('fx'); q.delete('hv'); q.delete('hb'); q.delete('hs'); q.set('style', s.style); q.set('scope', s.scope); q.set('layers', s.layers.join(','));
  q.delete('ss');
  if (s.selected === null) q.delete('sel'); else q.set('sel', String(s.selected));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((k) => b.includes(k));
  if (same(s.show.what, DEFAULT_SHOW.what)) q.delete('show'); else q.set('show', s.show.what.join(','));
  if (s.show.who === DEFAULT_SHOW.who) q.delete('who'); else q.set('who', s.show.who);
  q.delete('toasts');
  if (s.show.style === DEFAULT_SHOW.style) q.delete('pstyle'); else q.set('pstyle', s.show.style);
  history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
}

/** the current settings, outside React (the 3D loop reads them every frame) */
export const getSettings = () => state;

/** a mode's own way out (leaving What-if after a simulated step first plays the step back in reverse to the freeze
 *  moment, and only then turns the board back to grass): while one is set, a change of mode away from `from` is first
 *  offered to `hold`; true holds it (the rest of the patch still applies), and the mode makes the change itself when
 *  it is done, with setSettings(..., true). whatif/useWhatIf.tsx sets it */
let leaveGuard: { from: GameMode; hold: (to: GameMode) => boolean } | null = null;
export const guardLeave = (g: typeof leaveGuard) => { leaveGuard = g; };

/** change some settings; listeners and the address follow */
export function setSettings(patch: Partial<GameSettings> | ((s: GameSettings) => Partial<GameSettings>), force = false) {
  const p = { ...(typeof patch === 'function' ? patch(state) : patch) };
  // mode and tactical stay in step: a mode sets tactical; tactical alone (the older toggle) sets the mode
  if (p.mode !== undefined) p.tactical = boardOf(p.mode);
  else if (p.tactical !== undefined) p.mode = p.tactical ? 'tactics' : boardOf(state.mode) ? 'watch' : state.mode;
  if (!force && leaveGuard && p.mode !== undefined && p.mode !== state.mode && state.mode === leaveGuard.from && leaveGuard.hold(p.mode)) {
    delete p.mode; delete p.tactical;
    if (!Object.keys(p).length) return;
  }
  // entering the 战术 mode starts from its defaults every time: 卡通 players and the 简洁 preset (the
  // plain dark board, no lines between players, no ball trail); the minimap keeps its own switch, and whatever the same
  // patch sets wins. An address that opens in the mode keeps what it says.
  if (p.mode !== undefined && boardOf(p.mode) && p.mode !== state.mode) {
    p.style ??= 'toon';
    p.layers ??= withMap(PRESETS.clean.layers, state.layers.includes('map'));
  }
  state = { ...state, ...p };
  if (state.tactical && OFF_BOARD_VIEWS.includes(state.view)) state = { ...state, view: 'broadcast' };
  toURL(state);
  listeners.forEach((f) => f());
}

/** turn one thing drawn on the players on or off (name, stamina) */
export const toggleShow = (k: ShowWhat) => setSettings((s) => {
  const v = s.show;
  return { show: { ...v, what: v.what.includes(k) ? v.what.filter((y) => y !== k) : [...v.what, k] } };
});
/** whom the Show choices apply to (one at a time) */
export const setShowWho = (who: ShowWho) => setSettings((s) => ({ show: { ...s.show, who } }));
/** the chosen players' style (one at a time) */
export const setShowStyle = (style: ShowStyle) => setSettings((s) => ({ show: { ...s.show, style } }));
/** the players the Show menu's choices apply to this frame (three/layers/ShowLayer.tsx keeps it: on the ball, selected,
 *  a team, all); Stage draws them in the Show style, the rest toon */
export const showChosen = new Set<number>();
/** the players the Explain mode's director script names right now (explain/director.ts): the Show layer tags them
 *  as it tags the player on the ball, so the commentary's call-outs look as the Watch mode does */
export const showNamed = new Set<number>();
/** the grey board for a stretch of an Explain script (explain/director.ts; e.g. 80:17's pitch
 *  control on the tactics mode's grey pitch): Stage's flip turns to it as for the Tactics mode, without leaving Explain */
export const scriptBoard: { on: boolean; base: 'pc' | 'q' | null } = { on: false, base: null };   // base: the Tactics mode's base map (hud/BaseMap3D.tsx) on it
/** what the Explain mode shows on the players (there is no Show menu in Explain, and the Watch mode's
 *  choices must not carry into it): the player on the ball, and through showNamed the selected one and the one the
 *  commentary names, each with his name and stamina, everyone toon. The other modes take the Show menu's choices */
export const EXPLAIN_SHOW: ShowOpts = { who: 'ball', what: ['name', 'stamina'], style: 'toon' };
export const showOf = (s: GameSettings): ShowOpts => (s.mode === 'explain' ? EXPLAIN_SHOW : s.show);

/** the players the Show layer tags over the head this frame (three/layers/ShowLayer.tsx keeps it): the telestration
 *  hover cue sits higher over them. (The stamina bar is part of the tag.) */
export const showTagged = new Set<number>();
/** the tag's anchor, for whoever stacks with it (the hover cue): the top of the head, `upM` metres over the neck joint; its
 *  size is TELE.pointer.stack* (three/telestration/style.ts) times stackScale, `px` the unscaled height (name 16, row 4, bar 4) */
export const SHOW_TAG = { upM: 0.28, px: 24 };
export const staminaShown = (_s: GameSettings, p: number, _nAtt: number) => showTagged.has(p);

export const toggleLayer = (k: LayerKey) => setSettings((s) => ({ layers: s.layers.includes(k) ? s.layers.filter((x) => x !== k) : [...s.layers, k] }));
/** layers with the minimap (`map`) on or off: the minimap has its own switch in the HUD's top bar, so the presets leave
 *  it as it is and match regardless of it */
const withMap = (layers: LayerKey[], map: boolean): LayerKey[] => [...layers.filter((k) => k !== 'map'), ...(map ? ['map' as const] : [])];
export const applyPreset = (p: Preset) => setSettings((s) => ({ layers: withMap(PRESETS[p].layers, s.layers.includes('map')) }));
/** the preset the current switches match exactly (the minimap aside), or null */
export const presetOf = (layers: LayerKey[]): Preset | null => {
  const key = (a: LayerKey[]) => a.filter((k) => k !== 'map').sort().join(',');
  return (Object.keys(PRESETS) as Preset[]).find((p) => key(PRESETS[p].layers) === key(layers)) ?? null;
};

function subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** the settings in a React component, re-rendering when they change */
export function useGameSettings(): GameSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
