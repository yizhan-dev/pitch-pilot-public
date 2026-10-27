import { matchFile } from '../data/paths';
import { store } from '../hud/draft';
import { setSettings, type ViewMode } from '../game/settings';

// The match summary after the last clip (Yi, 2026-10-26: "at the very last clip, a pulsating button at center top would
// be 'Match Summary', and if user click it, the camera will go back to the drone perspective, echoing the beginning
// intro, and then we will do a drop down panel, showing the 技术统计, and then cycling between that page and other ones,
// such as passing network, attacking lane, key player heatmap, team heatmap, running distance"). The data is one file,
// written by private/hawkeye/match_summary.py (aggregates of the tracking and the Opta feeds, every player by tracking id;
// sealed in the release); MatchSummary.tsx draws it.

export type Side = 'home' | 'away';
/** a stat row; `low`: the smaller leads (PPDA) */
export interface SummaryStat { key: string; label: string; home: number; away: number; unit?: string; low?: boolean; group?: 'attack' | 'passing' | 'defence' | 'physical' }
export interface SummaryPlayer {
  side: Side; starter: boolean; keeper: boolean; minutes: number;
  goals: number; assists: number; passes: number; passOk: number; shots: number; xg?: number; rating?: number;
  /** metres, and by speed band: walking 0-6, jogging 6-15, running 15-20, high-speed 20-25, sprinting 25+ km/h */
  dist?: number; bands?: [number, number, number, number, number]; sprints?: number; top_kmh?: number;
  /** average spot with the ball in play, with his team on it, and where his passes were played from: metres, his team
   *  attacking +x, +y the near touchline (the clip packages' frame; -y is the team's left) */
  avg?: [number, number]; avgOn?: [number, number]; avgPass?: [number, number];
}
export interface MatchSummaryData {
  v: number; final: [number, number];
  stats: SummaryStat[];
  players: Record<string, SummaryPlayer>;
  /** each starter's chip (passes tried, completed, the threat they added, the mean direction of the failed ones, a unit
   *  vector) and the links between two of them, [a, b, a to b, b to a] */
  network: Record<Side, { nodes: { pid: string; at: [number, number]; n: number; ok: number; xt: number; fail: [number, number] | null }[]; edges: [string, string, number, number][] }>;
  /** every shot: where (the shooter's team attacking +x), its xG, how it ended */
  shots: { side: Side; pid: string | null; at: [number, number]; xg: number; how: 'goal' | 'saved' | 'blocked' | 'post' | 'off'; min: number; half?: number; head: boolean; pen: boolean }[];
  /** every goal's assist (v5): who, from where to where (the scorer's team attacking +x), a pass or a shot turned in */
  assists?: { side: Side; pid: string; at: [number, number]; to: [number, number]; min: number; pass: boolean }[];
  /** each team's time on the ball in its attacking third by channel, shares in the order left, centre, right */
  lanes: { order: string[]; home: number[]; away: number[]; third_s: Record<Side, number>; xt_min?: Record<Side, number[]>; fwd?: Record<Side, number> };
  /** heat grids, 0-255 row-major from (x0, y0), `cell` metres: the teams' outfielders and each player, open play */
  heat: { cell: number; nx: number; ny: number; x0: number; y0: number; team: Record<Side, string>; player: Record<string, string> };
  key: { pid: string; why: string } | null;
  /** the teams' running (v6): high-speed metres (20 km/h and over) in each minute of each half and the halves' lengths,
   *  seconds (Hawk-Eye's); metres by third, own to final (each attacking +x); MA45's metres by speed band (walking,
   *  jogging, running, high speed, sprinting), sprints, metres with and without the ball */
  physical?: {
    intensity: Record<Side, Record<'1' | '2', number[]>> & { secs: Record<'1' | '2', number> };
    thirds: Record<Side, number[]>; bands: Record<Side, number[]>; sprints: Record<Side, number>;
    with_ball: Record<Side, number>; without_ball: Record<Side, number>;
  };
}

export const SUMMARY_FILE = matchFile('summary.json');
let loading: Promise<MatchSummaryData | null> | null = null;
export const loadSummary = () => (loading ??= fetch(SUMMARY_FILE).then((r) => (r.ok ? r.json() : null)).catch(() => { loading = null; return null; }));

/** the strip under the panel (Yi, 2026-10-27: "another thin widget right under the center panel ... YIZHAN STADIUM, time,
 *  weather"): decoration, invented to match the scene (a clear night under the floodlights); not the real match's date
 *  or time, which would name it */
export const VENUE = { name: 'YIZHAN Stadium', kickoff: '20:00', weather: 'Clear', tempC: 16 };

/** the summary is open (the camera on the drone, the panel down) */
export const summaryOpen = store<boolean>(false);
/** open it: the whole pitch from high in the roof's opening, turning (Yi, 2026-10-27: not the drone outside; the panel
 *  drops once the camera is up) */
export function openSummary() { summaryOpen.set(true); setSettings({ view: 'aerialIn' as ViewMode, selected: null }); }
/** close it: back to the broadcast camera */
export function closeSummary() { if (!summaryOpen.get()) return; summaryOpen.set(false); setSettings({ view: 'broadcast' }); }

/** a heat grid's bytes */
export function heatBytes(b64: string): Uint8Array {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
