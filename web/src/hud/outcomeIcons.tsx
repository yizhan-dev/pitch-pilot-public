import { useId } from 'react';
import type { ClipCategory } from './match';

// A clip's outcome as a badge (set D of /review/event-icons/, a filled circle in the
// outcome's colour with the glyph in dark): on the replay plate, right of the clip's title. Goals green, a big chance
// missed amber, the other shots grey-blue, an offside yellow, a line-breaking attack light blue; kick-off (the opening
// animation's) light grey. Glyphs drawn by us on a 24 x 24 grid, shrunk into the circle.

export type OutcomeKey = ClipCategory;

const COLOUR: Record<OutcomeKey, string> = {
  goal: '#5ad18a', penalty: '#5ad18a', setpiece: '#5ad18a', bigchance: '#ffb23f',
  saved: '#9fb0c6', wide: '#9fb0c6', blocked: '#9fb0c6', post: '#9fb0c6',
  offside: '#ffd23f', attack: '#6ab8ff', possession: '#b39dfa', kickoff: '#e8ecf2',
};
export const OUTCOME_LABEL: Record<OutcomeKey, string> = {
  goal: 'Goal', penalty: 'Penalty goal', setpiece: 'Set-piece goal', bigchance: 'Big chance missed',
  saved: 'Shot saved', wide: 'Shot wide', blocked: 'Shot blocked', post: 'Hits the woodwork',
  offside: 'Offside', attack: 'Line-breaking attack', possession: 'Great possession', kickoff: 'Kick-off',
};
const DARK = '#0d131d';

/** a pentagon of radius r round (cx, cy), for the ball's middle panel */
function pent(cx: number, cy: number, r: number) {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    d += `${i ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
}
/** the ball: a disc with its middle panel cut out in the badge's colour */
const Ball = ({ cx, cy, r, cut }: { cx: number; cy: number; r: number; cut: string }) => (
  <><circle cx={cx} cy={cy} r={r} fill="currentColor" /><path d={pent(cx, cy, r * 0.42)} fill={cut} /></>
);
const FRAME = 'M3 20.5 V6.2 Q3 5 4.2 5 H19.8 Q21 5 21 6.2 V20.5';
/** the net behind a ball, cut away round it */
const Net = ({ id, bx, by, br }: { id: string; bx: number; by: number; br: number }) => (
  <>
    <defs><mask id={id}><rect width="24" height="24" fill="#fff" /><circle cx={bx} cy={by} r={br + 1.6} fill="#000" /></mask></defs>
    <g mask={`url(#${id})`} stroke="currentColor" strokeWidth={0.85} opacity={0.55}><path d="M7.5 5.5V20.5M12 5.5V20.5M16.5 5.5V20.5M3.5 10H20.5M3.5 15H20.5" /></g>
  </>
);
const line = { stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
/** an arc of the circle of radius r round (cx, cy) from angle a to b, degrees clockwise from +x */
function arc(cx: number, cy: number, r: number, a: number, b: number) {
  const p = (d: number) => `${(cx + r * Math.cos((d * Math.PI) / 180)).toFixed(2)} ${(cy + r * Math.sin((d * Math.PI) / 180)).toFixed(2)}`;
  return `M${p(a)} A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${p(b)}`;
}
/** a great possession: the press as a broken ring round the ball, the ball's way out through its widest gap */
const PRESS = [arc(10.5, 13.5, 7.4, -15, 55), arc(10.5, 13.5, 7.4, 75, 145), arc(10.5, 13.5, 7.4, 165, 255)].join(' ');

function Glyph({ k, cut, id }: { k: OutcomeKey; cut: string; id: string }) {
  switch (k) {
    case 'goal': return <><path d={FRAME} fill="none" strokeWidth={2.6} {...line} /><Net id={id} bx={12} by={14.6} br={4.2} /><Ball cx={12} cy={14.6} r={4.2} cut={cut} /></>;
    // a penalty: a bold P alone (with the goal's frame it read as a plain goal at 20 px)
    case 'penalty': return <path d="M8.2 20.2 V4.4 H13.4 A4.9 4.9 0 0 1 13.4 14.2 H8.2" fill="none" strokeWidth={3.4} {...line} />;
    case 'setpiece': return <><path d="M5.5 21V3.5" strokeWidth={2.2} {...line} /><path d="M5.5 3.8 L15 6.6 L5.5 9.6 Z" fill="currentColor" strokeWidth={1.2} {...line} />
      <path d="M5.5 16.2 A4.8 4.8 0 0 1 10.3 21" fill="none" strokeWidth={1.8} {...line} /><Ball cx={16.6} cy={16.4} r={3.6} cut={cut} /></>;
    case 'bigchance': return <><circle cx={9.5} cy={14.5} r={6.8} fill="none" stroke="currentColor" strokeWidth={2.2} /><circle cx={9.5} cy={14.5} r={3.4} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <circle cx={9.5} cy={14.5} r={1.1} fill="currentColor" /><Ball cx={18.4} cy={5.6} r={3.2} cut={cut} /><path d="M13.6 9.4 L15.4 8" strokeWidth={1.5} {...line} /></>;
    case 'saved': return <><path d="M7.6 21 V13.4 L5.6 10.6 Q4.9 9.4 6 8.7 Q7 8.1 7.8 9.1 L9 10.6 V5.2 Q9 3.9 10.25 3.9 Q11.5 3.9 11.5 5.2 V9.6 V4 Q11.5 2.7 12.75 2.7 Q14 2.7 14 4 V9.6 V4.8 Q14 3.5 15.25 3.5 Q16.5 3.5 16.5 4.8 V10.2 V7 Q16.5 5.8 17.7 5.8 Q18.9 5.8 18.9 7 V14.6 Q18.9 21 13.2 21 Z" fill="currentColor" strokeWidth={1.4} {...line} />
      <path d="M7.6 17.6 H18.6" stroke={cut} strokeWidth={1.3} /></>;
    case 'wide': return <><path d="M3 20.5 V9.2 Q3 8 4.2 8 H13.8 Q15 8 15 9.2 V20.5" fill="none" strokeWidth={2.6} {...line} />
      <path d="M9 21 Q14 13 18.2 7.4" fill="none" strokeWidth={1.4} strokeDasharray="1.8 2.2" {...line} /><Ball cx={19.4} cy={5.4} r={2.9} cut={cut} /></>;
    case 'blocked': return <><rect x={14.2} y={3} width={5} height={18} rx={2} fill="currentColor" stroke="currentColor" strokeWidth={1.2} /><Ball cx={7.2} cy={12} r={4} cut={cut} />
      <path d="M12.3 7.2 L13.2 8.4 M12.3 16.8 L13.2 15.6" strokeWidth={1.5} {...line} /></>;
    case 'post': return <><path d="M5 21.5 V4.5 H21.5" fill="none" strokeWidth={3} {...line} /><Ball cx={10.6} cy={10.4} r={3.7} cut={cut} />
      <path d="M15.6 13.6 L17.4 14.8 M14 15.6 L15 17.5 M16.2 10.6 L18.2 10.6" strokeWidth={1.4} {...line} /></>;
    case 'offside': return <><path d="M5 22 V2.8" strokeWidth={2.2} {...line} />
      <defs><clipPath id={id}><rect x={5} y={3.4} width={14.6} height={10} rx={1} /></clipPath></defs>
      <rect x={5} y={3.4} width={14.6} height={10} rx={1} fill="none" stroke="currentColor" strokeWidth={1.8} />
      <g clipPath={`url(#${id})`} fill="currentColor"><rect x={5} y={3.4} width={7.3} height={5} /><rect x={12.3} y={8.4} width={7.3} height={5} /></g></>;
    case 'attack': return <><path d="M9 3.5 V20.5 M15 3.5 V20.5" stroke="currentColor" strokeWidth={1.1} strokeDasharray="2 2.2" opacity={0.75} />
      <path d="M3 17.5 L19.2 8.2" strokeWidth={2.6} {...line} /><path d="M14.6 6.4 L20.6 7.4 L18.2 13" fill="currentColor" strokeWidth={1.6} {...line} /></>;
    case 'possession': return <><path d={PRESS} fill="none" strokeWidth={2.2} {...line} /><Ball cx={10.5} cy={13.5} r={3.4} cut={cut} />
      <path d="M13.3 9.6 L18.6 2.9" strokeWidth={2.2} {...line} /><path d="M14.6 3.1 L19.1 2.4 L18.5 6.9" fill="none" strokeWidth={2.2} {...line} /></>;
    case 'kickoff': return <><rect x={2.2} y={5.2} width={19.6} height={13.6} rx={1.6} fill="none" stroke="currentColor" strokeWidth={2.1} />
      <path d="M12 5.2 V18.8" stroke="currentColor" strokeWidth={1.8} /><circle cx={12} cy={12} r={3.6} fill={cut} stroke="currentColor" strokeWidth={1.8} />
      <circle cx={12} cy={12} r={2.1} fill="currentColor" /></>;
  }
}

/** a clip's outcome badge, `size` px across */
export function OutcomeIcon({ category, size = 20 }: { category: OutcomeKey; size?: number }) {
  const id = 'oc' + useId().replace(/[^A-Za-z0-9_-]/g, ''), c = COLOUR[category];
  return (
    <svg className="hud-outcome" viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={OUTCOME_LABEL[category]}>
      <title>{OUTCOME_LABEL[category]}</title>
      <circle cx={12} cy={12} r={12} fill={c} />
      <g transform="translate(12 12) scale(.66) translate(-12 -12)" color={DARK}><Glyph k={category} cut={c} id={id} /></g>
    </svg>
  );
}
