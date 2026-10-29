import type { ReactNode } from 'react';
import type { GameMode, LayerKey, ViewMode } from '../game/settings';
import { pickedMode, OptionIcon } from './modeIconOptions';

// Line icons for the views, drawn on a 24 grid in currentColor, 1.6 strokes, round ends: one family with the HUD's
// hairlines. Picked from four candidates each: a television for the broadcast, an orbit for the free
// camera, the pitch from above, two cards for the referee, the chequered flag for the assistants, and for the two player
// views a pair in one viewfinder: an eye (first person) and the player himself (1.5 person).
// Aligned by their main mass on the grid's centre (12, 12), measured with getBBox: the television's screen
// and the pitch are the same rounded rectangle, both centred; the others are shifted by what the measurement showed.

const F = { fill: 'currentColor', stroke: 'none' } as const;
/** the television's screen and the pitch's outline: one rounded rectangle, centred on the grid */
const SCREEN = <rect x="2.5" y="5.5" width="19" height="13" rx="2" />;
const FRAME = <path d="M3 8 V3.5 H7.5 M16.5 3.5 H21 V8 M21 16 V20.5 H16.5 M7.5 20.5 H3 V16" />;

const PATHS: Record<ViewMode, ReactNode> = {
  // a television, its live light on; the screen is SCREEN, the antenna and feet kept short so the whole sits centred
  broadcast: <>
    {SCREEN}
    <path d="M8.2 2.6 L12 5.5 L15.8 2.6" />
    <circle cx="17.6" cy="9" r="1.4" {...F} />
    <path d="M6.5 18.5 L5.6 20.4 M17.5 18.5 L18.4 20.4" />
  </>,
  // an orbit around a point: the free camera
  free: <g transform="translate(0 0.2)">
    <circle cx="12" cy="12.4" r="2.5" />
    <path d="M6.84 8.96 A9 4.2 0 1 0 15.08 8.45" />
    <path d="M17.5 7.04 L15.08 8.45 L16.89 10.59" />
  </g>,
  // the pitch from straight above, like a tactics board; its outline is the television's screen, so the two
  // neighbours line up
  tactical: <>
    {SCREEN}
    <path d="M12 5.5 V18.5 M2.5 8.5 H5.6 V15.5 H2.5 M21.5 8.5 H18.4 V15.5 H21.5" />
    <circle cx="12" cy="12" r="2.4" />
  </>,
  // the referee's two cards, the front one filled
  referee: <g transform="translate(0.35 0)">
    <rect x="4" y="4.5" width="9" height="13" rx="1.3" transform="rotate(-12 8.5 11)" />
    <rect x="10.5" y="6.5" width="9" height="13" rx="1.3" transform="rotate(10 15 13)" fill="currentColor" />
  </g>,
  // the assistant referee's chequered flag, numbered
  ar1: flag('1'),
  ar2: flag('2'),
  // first person: an eye in the viewfinder
  first: <>
    {FRAME}
    <path d="M6 12 C8 8.8 16 8.8 18 12 C16 15.2 8 15.2 6 12 Z" />
    <circle cx="12" cy="12" r="1.6" {...F} />
  </>,
  // 1.5 person: the player in the viewfinder
  third: <>
    {FRAME}
    <circle cx="12" cy="10" r="2.6" />
    <path d="M6.8 18 C6.8 15.4 9.1 14.2 12 14.2 C14.9 14.2 17.2 15.4 17.2 18" />
  </>,
  // 近景 and 远景 (外景): placeholders so the type check passes, until candidates are drawn in the HUD's
  // style. 近景: the bowl close, its wall; 远景: the bowl small on the ground, a drone's orbit above
  aerialNear: <>
    <ellipse cx="12" cy="11.5" rx="8.5" ry="4.4" />
    <ellipse cx="12" cy="11.5" rx="4.4" ry="2" />
    <path d="M3.5 11.5 V14.6 A8.5 4.4 0 0 0 20.5 14.6 V11.5" />
  </>,
  aerialFar: <>
    <path d="M2.5 18.5 H21.5" />
    <ellipse cx="12" cy="16" rx="4.6" ry="1.9" />
    <path d="M4.2 10.4 A7.8 3.3 0 0 1 19.8 10.4" />
    <path d="M17.7 8.6 L19.8 10.4 L17.4 11.6" />
  </>,
  // the stadium orbit: the pitch seen from above, an orbit arrow round it
  aerialIn: <>
    <rect x="6" y="9" width="12" height="7.5" rx="0.6" />
    <path d="M12 9 V16.5" />
    <path d="M3.6 8.4 A9.2 4.6 0 0 1 20.4 8.4" />
    <path d="M18.3 6.6 L20.4 8.4 L18 9.6" />
  </>,
};

/** the flag on a pole shorter than the full height and a small number at its foot (the number a little smaller and the
 *  pole a little shorter than the first draft's) */
function flag(n: string) {
  return <g transform="translate(-0.8 0)">
    <path d="M5 19.5 V4" />
    <rect x="5" y="4.6" width="12.5" height="8.4" />
    <path d="M5 4.6 H11.25 V8.8 H5 Z M11.25 8.8 H17.5 V13 H11.25 Z" {...F} />
    <text x="19.6" y="20" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="8.5" {...F}>{n}</text>
  </g>;
}

export function ViewIcon({ view, size = 24, className }: { view: ViewMode; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[view]}
    </svg>
  );
}

/** a mode's icon (观赛, 讲解, 战术), on the 模式 button and in its menu: for now the candidate PICK names in
 *  ./modeIconOptions.tsx, until one is picked */
export function ModeIcon({ mode, size = 24 }: { mode: GameMode; size?: number }) {
  return <OptionIcon node={pickedMode(mode).node} size={size} />;
}

/** the minimap switch's icon: a folded map, three panels */
export function MapIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5 L9 4 L15 6.5 L21 4 V17.5 L15 20 L9 17.5 L3 20 Z" />
      <path d="M9 4 V17.5 M15 6.5 V20" />
    </svg>
  );
}

/** the display switches' icons on the 战术 mode's rail (TacticsRail.tsx): first drafts, one each, in the views' family;
 *  candidates to come */
const LAYER_PATHS: Partial<Record<LayerKey, ReactNode>> = {
  // speed: a gauge and its needle
  speed: <><path d="M4.2 17 A8.6 8.6 0 1 1 19.8 17" /><path d="M12 14.2 L16.2 9" /><circle cx="12" cy="14.6" r="1.5" {...F} /></>,
  // trail: a player and the run behind him, fading into dashes
  trail: <><circle cx="17.6" cy="6.6" r="2.3" {...F} /><path d="M15.2 8.6 C11.6 10.8 11.2 14.4 7.6 16.8" /><path d="M5.6 18 L3.6 19.2" opacity=".55" /></>,
  // fov: where he looks, a sector from his feet
  fov: <><path d="M5.2 18.4 L18.8 10.2 A14 14 0 0 0 11 3.8 Z" /><circle cx="5.2" cy="18.4" r="1.7" {...F} /></>,
  // toast: an event popping up
  toast: <><path d="M5.5 4.5 H18.5 A2 2 0 0 1 20.5 6.5 V13.5 A2 2 0 0 1 18.5 15.5 H11 L7 19 V15.5 H5.5 A2 2 0 0 1 3.5 13.5 V6.5 A2 2 0 0 1 5.5 4.5 Z" /><path d="M12 7.6 V11" /><circle cx="12" cy="13.1" r=".9" {...F} /></>,
  // lines: the back line and the midfield line, players on them
  lines: <><path d="M3 8.5 H21 M3 15.5 H21" strokeWidth="1.2" /><circle cx="6.5" cy="8.5" r="1.7" {...F} /><circle cx="12" cy="8.5" r="1.7" {...F} /><circle cx="17.5" cy="8.5" r="1.7" {...F} /><circle cx="8.5" cy="15.5" r="1.7" {...F} /><circle cx="15.5" cy="15.5" r="1.7" {...F} /></>,
  // offside: the line across the pitch and a player past it
  offside: <><path d="M10 3 V21" strokeDasharray="2 2.2" /><circle cx="16" cy="12" r="2.3" {...F} /><circle cx="5" cy="12" r="2.3" /></>,
  // mark: a defender tied to his man
  mark: <><circle cx="6.5" cy="17.5" r="2.6" /><circle cx="17.5" cy="6.5" r="2.6" {...F} /><path d="M8.6 15.4 L15.4 8.6" /></>,
  // ball: the ball and its path
  ball: <><circle cx="17.4" cy="6.6" r="2.6" /><path d="M3.6 19.4 C7 19.4 12.4 15.8 15.4 8.8" /></>,
  // xg: the letters
  xg: <text x="12" y="16.6" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="13" {...F}>xG</text>,
};

export function LayerIcon({ layer, size = 24 }: { layer: LayerKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {LAYER_PATHS[layer]}
    </svg>
  );
}

/** the rail's two menus: presets (sliders) and how the players are drawn (a figure and its style) */
export function PresetIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7 H20 M4 12 H20 M4 17 H20" strokeWidth="1.2" opacity=".6" /><circle cx="15" cy="7" r="2.2" {...F} /><circle cx="8" cy="12" r="2.2" {...F} /><circle cx="13" cy="17" r="2.2" {...F} />
    </svg>
  );
}
/** a football: the round, a pentagon in the middle and the seams out to the rim (the Show column's ball trail switch) */
export function BallIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.6" /><path d="M12 8.6 L15.2 10.9 L14 14.7 H10 L8.8 10.9 Z" {...F} />
      <path d="M12 8.6 V3.4 M15.2 10.9 L20.1 9.3 M14 14.7 L17 18.9 M10 14.7 L7 18.9 M8.8 10.9 L3.9 9.3" />
    </svg>
  );
}
export function StyleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="6" r="2.6" /><path d="M7 20.5 V15 C7 11.8 9.2 10.4 12 10.4 C14.8 10.4 17 11.8 17 15 V20.5" />
    </svg>
  );
}

/** the left column's buttons in the HUD preview's draft: 观赛's display options, the 战术 mode's base map and
 *  annotations, 画板's tools; first drafts, one each */
const RAIL_PATHS: Record<string, ReactNode> = {
  // 观赛: a battery, partly full (the stamina bars, a draft option: the 3D side does not draw them)
  stamina: <><rect x="2.8" y="7.5" width="16.4" height="9" rx="2" /><path d="M21.2 10.6 V13.4" /><rect x="5" y="9.8" width="7.6" height="4.4" rx=".6" {...F} /></>,
  // 观赛: a name tag over a player
  names: <><rect x="4" y="3.5" width="16" height="6.5" rx="1.6" /><path d="M7 6.75 H14" /><circle cx="12" cy="15" r="2.2" /><path d="M7.6 21 C7.6 18.6 9.6 17.6 12 17.6 C14.4 17.6 16.4 18.6 16.4 21" /></>,
  // 战术: the space family (the pitch, one half shaded)
  space: <><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M12 5.5 V18.5" /><path d="M2.5 13.5 L8 8 M3.5 18 L11 10.5 M7.5 18.5 L12 14" strokeWidth="1.2" /></>,
  // runs: a run and the ground it takes, round where he arrives
  run: <><circle cx="15" cy="9" r="5.6" strokeDasharray="2 2" /><circle cx="15" cy="9" r="2" {...F} /><path d="M3.6 20.4 L9.6 14.4" /></>,
  // threat: the letters
  threat: <text x="12" y="16.2" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="11" {...F}>ΔxT</text>,
  // shots: the goal and a ball flying in
  shot: <><path d="M3.5 19 V6.5 H20.5 V19" /><path d="M3.5 10.5 H20.5 M8 6.5 V19 M12 6.5 V19 M16 6.5 V19" strokeWidth=".9" opacity=".5" /><circle cx="15.5" cy="12" r="2.2" {...F} /></>,
  // chance creation: a pass into a team-mate who shoots
  create: <><circle cx="5" cy="17.5" r="2" {...F} /><path d="M7 16 L13.6 10.4" /><path d="M10.8 10.2 L13.8 10.2 L13.7 13.2" /><circle cx="17" cy="8" r="2.4" /><path d="M19 6 L21.2 3.8" /></>,
  // passing: the options fanning out from the ball
  pass: <><circle cx="5" cy="12" r="2.2" {...F} /><path d="M7.4 11 L19 5 M7.6 12 H19.6 M7.4 13 L19 19" /><circle cx="20" cy="4.6" r="1.2" {...F} /><circle cx="20.6" cy="12" r="1.2" {...F} /><circle cx="20" cy="19.4" r="1.2" {...F} /></>,
  // 画板's tools
  pass_tool: <><path d="M4 19 L18.5 5.5" /><path d="M12.5 5.2 H18.8 V11.5" /></>,
  run_tool: <><path d="M4 19.5 C5 12 11 6.5 18.5 5.8" strokeDasharray="2.2 2.2" /><path d="M14.6 3.4 L18.8 5.8 L15.4 9.4" /></>,
  dribble: <><path d="M3.5 17 C5.5 13 7.5 21 9.5 17 C11.5 13 13.5 21 15.5 17" /><path d="M15.5 17 L19.5 9" /><path d="M16 9.6 L19.6 8.6 L20.4 12.2" /></>,
  circle: <><ellipse cx="12" cy="15.5" rx="8.5" ry="4.2" strokeDasharray="2.6 2" /><circle cx="12" cy="9" r="2.4" {...F} /><path d="M12 11.4 V15.4" /></>,
  zone: <><rect x="3.5" y="5.5" width="17" height="13" rx="1" strokeDasharray="2.6 2" /><path d="M7 15 L11 11 M10 15.5 L15 10.5 M13.5 15.5 L17 12" strokeWidth="1.1" opacity=".7" /></>,
  pen: <><path d="M14.5 4.5 L19.5 9.5 L9 20 H4 V15 Z" /><path d="M12.5 6.5 L17.5 11.5" /></>,
  measure: <><path d="M3.5 12 H20.5" /><path d="M3.5 8.5 V15.5 M20.5 8.5 V15.5" /><path d="M8 12 V14 M12 12 V15 M16 12 V14" strokeWidth="1.2" /></>,
  aids: <><path d="M14 3.5 V20.5" strokeDasharray="2 2" /><path d="M3.5 8 H11 M3.5 16 H11" /><circle cx="18.5" cy="12" r="1.8" {...F} /></>,
  undo: <><path d="M8.5 6 L4.5 10 L8.5 14" /><path d="M4.8 10 H14.5 A5.2 5.2 0 0 1 14.5 20.4 H10" /></>,
  redo: <><path d="M15.5 6 L19.5 10 L15.5 14" /><path d="M19.2 10 H9.5 A5.2 5.2 0 0 0 9.5 20.4 H14" /></>,
  clear: <><path d="M4.5 7 H19.5 M9.5 7 V4.5 H14.5 V7 M6.5 7 L7.5 20 H16.5 L17.5 7" /><path d="M10.2 10.5 V16.5 M13.8 10.5 V16.5" strokeWidth="1.2" /></>,
  frame: <><rect x="3.5" y="5" width="17" height="12" rx="1.5" /><path d="M12 17 V20.5 M8 20.5 H16" /><path d="M9.5 9 V13 L13 11 Z" {...F} /></>,
};

export function RailIcon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {RAIL_PATHS[name]}
    </svg>
  );
}
