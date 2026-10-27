import { useSyncExternalStore } from 'react';

// What-if state shared by the pause window (DOM, src/pause/) and the pitch (3D, src/three/whatif/): which tool is
// open and what it shows. Kept apart from settings.ts: it belongs to one pause, is not mirrored to the address, and
// closes when play resumes.

export interface WhatIf {
  /** the open tool: 'mate-shot' = 换队友来射 (another teammate shoots), or none */
  tool: null | 'mate-shot';
  /** the clip time the numbers are for */
  t: number;
  /** each player's chance to score if he shot from where he stands at t (index into the package's players,
   *  attackers first); null for defenders and the attacking keeper */
  xg: (number | null)[] | null;
  /** who really shot, and the teammate the viewer picked */
  shooter: number | null;
  pick: number | null;
}

const EMPTY: WhatIf = { tool: null, t: 0, xg: null, shooter: null, pick: null };
let state = EMPTY;
const listeners = new Set<() => void>();
export const getWhatIf = () => state;
export function setWhatIf(patch: Partial<WhatIf>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }
export const closeWhatIf = () => { if (state !== EMPTY) { state = EMPTY; listeners.forEach((l) => l()); } };
export const useWhatIf = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, getWhatIf);
