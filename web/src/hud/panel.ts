// Which HUD panel is open. One at a time: opening one closes the other. UI state only, so it stays out of
// src/game/settings.ts; ?panel=levels|mode|view|presets|style|rail|display|games|show opens one at load (rail: one of the left column's menus, named in
// draft.ts's railMenu), for the headless screenshots.
import { useSyncExternalStore } from 'react';

export type PanelKey = 'levels' | 'mode' | 'view' | 'presets' | 'style' | 'rail' | 'display' | 'games' | 'show' | 'credits';
const KEYS: PanelKey[] = ['levels', 'mode', 'view', 'presets', 'style', 'rail', 'display', 'games', 'show', 'credits'];

let open: PanelKey | null = (() => {
  if (typeof location === 'undefined') return null;
  const p = new URLSearchParams(location.search).get('panel');
  return p && (KEYS as string[]).includes(p) ? (p as PanelKey) : null;
})();
const listeners = new Set<() => void>();

export const getPanel = () => open;
export function setPanel(k: PanelKey | null) { if (k === open) return; open = k; listeners.forEach((f) => f()); }
export const togglePanel = (k: PanelKey) => setPanel(open === k ? null : k);

function subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function usePanel(): PanelKey | null { return useSyncExternalStore(subscribe, getPanel, getPanel); }
