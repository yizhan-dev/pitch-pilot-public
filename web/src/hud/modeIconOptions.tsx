import type { ReactNode } from 'react';
import type { GameMode } from '../game/settings';

// Candidates for the three modes' icons, for Yi to pick from on /hud.html?sheet=mode-icons (2026-10-22), as the view icons
// were picked. Same grid and strokes as icons.tsx. PICK is what the 模式 button and menu show meanwhile; ?micon=watch:B,
// explain:C,tactics:D tries others in place. Once Yi picks, the chosen ones move into icons.tsx and this file goes (it
// replaces the 战术模式 switch's candidates, whose switch became the 模式 menu).

const F = { fill: 'currentColor', stroke: 'none' } as const;

export interface IconOption { id: string; name: string; note?: string; node: ReactNode }

export const MODE_OPTIONS: Record<GameMode, IconOption[]> = {
  watch: [
    { id: 'A', name: '眼睛', note: '和「球员视角」的眼睛撞', node: <>
      <path d="M2.5 12 C5.6 6.6 18.4 6.6 21.5 12 C18.4 17.4 5.6 17.4 2.5 12 Z" />
      <circle cx="12" cy="12" r="3.1" /><circle cx="12" cy="12" r="1.2" {...F} />
    </> },
    { id: 'B', name: '看台座椅', node: <>
      <path d="M3.2 12 V8 A2 2 0 0 1 5.2 6 H6.6 A2 2 0 0 1 8.6 8 V12 M9.3 12 V8 A2 2 0 0 1 11.3 6 H12.7 A2 2 0 0 1 14.7 8 V12 M15.4 12 V8 A2 2 0 0 1 17.4 6 H18.8 A2 2 0 0 1 20.8 8 V12" />
      <rect x="2.5" y="12" width="19" height="2.8" rx="1.2" />
      <path d="M2.5 18.5 H21.5 M5.9 14.8 V18.5 M18.1 14.8 V18.5" />
    </> },
    { id: 'C', name: '球票', node: <>
      <path d="M3 6.5 H21 V10 A2 2 0 0 0 21 14 V17.5 H3 V14 A2 2 0 0 0 3 10 Z" />
      <path d="M15.5 8.1 V15.9" strokeDasharray="0 2.6" />
      <path d="M6.5 10.4 H12 M6.5 13.6 H10.2" />
    </> },
    { id: 'D', name: '望远镜', node: <>
      <circle cx="6.8" cy="15.6" r="3.6" /><circle cx="17.2" cy="15.6" r="3.6" />
      <path d="M3.4 14.4 L5.2 6.4 A1.6 1.6 0 0 1 6.8 5 H8.2 A1.6 1.6 0 0 1 9.8 6.6 V13" />
      <path d="M20.6 14.4 L18.8 6.4 A1.6 1.6 0 0 0 17.2 5 H15.8 A1.6 1.6 0 0 0 14.2 6.6 V13" />
      <path d="M9.8 9.6 H14.2" />
    </> },
  ],
  explain: [
    { id: 'A', name: '话筒加一笔线', node: <>
      <rect x="4.6" y="3" width="5.4" height="9.6" rx="2.7" />
      <path d="M2.8 10 A4.5 4.5 0 0 0 11.8 10 M7.3 14.5 V18.5 M4.8 18.5 H9.8" />
      <path d="M13.6 20 C17.6 19.4 20.2 15.6 19.6 8.6" />
      <path d="M17.5 10.4 L19.6 8.3 L21.4 10.6" />
    </> },
    { id: 'B', name: '带箭头的对话框', node: <>
      <path d="M5.5 3.5 H18.5 A2.5 2.5 0 0 1 21 6 V14 A2.5 2.5 0 0 1 18.5 16.5 H11.2 L6.8 20.5 V16.5 H5.5 A2.5 2.5 0 0 1 3 14 V6 A2.5 2.5 0 0 1 5.5 3.5 Z" />
      <path d="M7.2 13.2 C8.6 9.4 12.4 7.9 16.2 9.4" />
      <path d="M13.8 7.6 L16.4 9.5 L14.9 12.2" />
    </> },
    { id: 'C', name: '解说耳麦', node: <>
      <path d="M4.8 12.5 V11.3 A7.2 7.2 0 0 1 19.2 11.3 V12.5" />
      <rect x="3" y="12" width="3.8" height="6.2" rx="1.5" {...F} />
      <rect x="17.2" y="12" width="3.8" height="6.2" rx="1.5" {...F} />
      <path d="M5 18.2 C5 20.4 7.6 21 10.6 20.6" /><circle cx="12" cy="20.4" r="1.4" {...F} />
    </> },
    { id: 'D', name: '画笔画出跑位', node: <>
      <path d="M11.4 12.6 L12.4 9.6 L18.2 3.8 A1.4 1.4 0 0 1 20.2 3.8 A1.4 1.4 0 0 1 20.2 5.8 L14.4 11.6 Z" />
      <path d="M10.4 13.6 C6 14.6 4.6 17.6 6.4 19.2 C8.2 20.6 13.4 19.8 17.4 17.2" />
      <path d="M15 16.2 L17.6 17.1 L16.6 19.7" />
    </> },
  ],
  tactics: [
    { id: 'A', name: '圈叉箭头', node: <>
      <path d="M3.6 15 L8.4 19.8 M8.4 15 L3.6 19.8" /><circle cx="7.2" cy="7" r="2.8" />
      <path d="M11 17.4 C15.4 17.2 18.6 13.4 18.8 7.2" strokeDasharray="2 2.2" />
      <path d="M16.6 9 L18.8 6.6 L20.8 9.1" />
    </> },
    { id: 'B', name: '战术板', note: '原来「战术模式」开关上的', node: <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M5.6 8.4 L8.6 11.4 M8.6 8.4 L5.6 11.4" /><circle cx="17.2" cy="14.8" r="1.9" />
      <path d="M9 13.4 C10.6 16.4 12.6 16.6 14.4 15.6" /><path d="M12.4 14.3 L14.4 15.6 L13.3 17.6" />
    </> },
    { id: 'C', name: '教练夹板', node: <>
      <rect x="4.5" y="4.5" width="15" height="17" rx="2" /><rect x="8.5" y="2.5" width="7" height="4" rx="1" {...F} />
      <path d="M7.5 10 L10.5 13 M10.5 10 L7.5 13" /><circle cx="15.5" cy="17" r="1.8" />
      <path d="M11.5 14.5 L13.8 16" />
    </> },
    { id: 'D', name: '分叉路线（what-if）', node: <>
      <circle cx="12" cy="19.6" r="1.7" {...F} />
      <path d="M12 17.4 V13.6 C12 10.4 9.4 8.8 6.6 5.2" />
      <path d="M12 13.6 C12 10.4 14.6 8.8 17.4 5.2" strokeDasharray="1.9 2" />
      <path d="M4.6 7.2 L6.4 4.8 L9.2 5.6 M14.8 5.6 L17.6 4.8 L19.4 7.2" />
    </> },
  ],
  // the fourth mode (Yi, 2026-10-24 evening: What-if out of 战术 into its own mode): 战术's candidate D, the branching path
  whatif: [
    { id: 'A', name: '分叉路线', node: <>
      <circle cx="12" cy="19.6" r="1.7" {...F} />
      <path d="M12 17.4 V13.6 C12 10.4 9.4 8.8 6.6 5.2" />
      <path d="M12 13.6 C12 10.4 14.6 8.8 17.4 5.2" strokeDasharray="1.9 2" />
      <path d="M4.6 7.2 L6.4 4.8 L9.2 5.6 M14.8 5.6 L17.6 4.8 L19.4 7.2" />
    </> },
  ],
};

/** what the 模式 button and menu show until Yi picks; ?micon=watch:B,explain:C,tactics:D overrides it for a look in place */
const PICK: Record<GameMode, string> = (() => {
  const p: Record<GameMode, string> = { watch: 'C', explain: 'C', tactics: 'A', whatif: 'A' };   // 战术: Yi picked A, 2026-10-22 ("simpler"; D looked bad, E-L tried)
  const q = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('micon');
  for (const part of (q ?? '').split(',')) {
    const [m, id] = part.split(':') as [GameMode, string];
    if (MODE_OPTIONS[m]?.some((o) => o.id === id)) p[m] = id;
  }
  return p;
})();

export const pickedMode = (m: GameMode) => MODE_OPTIONS[m].find((o) => o.id === PICK[m])!;
export const isPicked = (m: GameMode, id: string) => PICK[m] === id;

export function OptionIcon({ node, size }: { node: ReactNode; size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{node}</svg>;
}
