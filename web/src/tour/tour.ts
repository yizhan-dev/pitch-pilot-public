// The judges' tour (design docs/plans/tutorial.md, compressed): a guided walk through the
// four modes, one action a card. The step lives here, kept in sessionStorage, so a reload (or a mode that reloads the
// page) resumes it. ?tour=1 starts it; the top bar's Tutorial button starts it again at any time.
import { store } from '../hud/draft';
import { hook } from '../dev';

const KEY = 'pp-tour-step';
const read = (): number => {
  try { const v = sessionStorage.getItem(KEY); return v === null ? -1 : +v; } catch { return -1; }
};
const write = (n: number) => {
  try { if (n < 0) sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, String(n)); } catch { /* this tab only */ }
};

const fromUrl = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tour') === '1';
/** the step on screen, -1 when the tour is off */
export const tourStep = store<number>(fromUrl ? 0 : read());
if (fromUrl) {
  write(0);
  // the address loses ?tour=1 once read, so a reload resumes the step kept in sessionStorage rather than starting over
  const u = new URLSearchParams(location.search); u.delete('tour');
  history.replaceState(history.state, '', `${location.pathname}${u.toString() ? `?${u}` : ''}${location.hash}`);
}
tourStep.subscribe(() => write(tourStep.get()));

export const startTour = (from = 0) => tourStep.set(from);
export const endTour = () => tourStep.set(-1);
export const tourOn = () => tourStep.get() >= 0;

/** the lock the card sets for its step (Tour.tsx): the keys and the HUD parts let through, and what a held one does.
 *  Its listeners are added here, as the module loads, so they come before every other key and click listener on the
 *  page: one added later on the same target would otherwise hear the key first (the game's and the HUD's do) */
export const tourLock: { keys: Set<string> | null; allow: string; onHeld: () => void } = { keys: null, allow: '', onHeld: () => undefined };
if (typeof window !== 'undefined') {
  const CONTROL = 'button, a, input, select, [role="button"], [role="menuitemradio"], [role="menuitem"], [role="tab"], [data-hud-toggle]';
  window.addEventListener('keydown', (e) => {
    const keys = tourLock.keys;
    if (!keys || keys.has(e.key) || (e.target as HTMLElement)?.closest?.('.tour')) return;
    // the browser's own keys stay the browser's: a modifier pressed alone, the F keys (reload, full screen), and with Ctrl
    // or Cmd reload, find, zoom, tabs and windows (not L or 0: the game hears those whatever is held)
    if (/^(Shift|Control|Alt|Meta|CapsLock|OS|F\d{1,2})$/.test(e.key) || ((e.ctrlKey || e.metaKey) && /^[rRfFtTwWnN=+-]$/.test(e.key))) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!e.repeat) tourLock.onHeld();
  }, true);
  const click = (e: Event) => {
    if (!tourLock.keys) return;
    const el = e.target as Element | null;
    if (!el?.closest || el.closest('.tour')) return;
    if (!el.closest('.hud, .pw, .hud-nextclip')) return;   // the pitch, the What-if's own cards, the commentary switch: free
    if (tourLock.allow && el.closest(tourLock.allow)) return;
    if (!el.closest(CONTROL)) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (e.type === 'pointerdown') tourLock.onHeld();
  };
  for (const t of ['pointerdown', 'mousedown', 'click']) document.addEventListener(t, click, true);
  // for the headless checks: go to a step, read it
  hook('tour', { go: (n: number) => tourStep.set(n), step: () => tourStep.get() });
}
