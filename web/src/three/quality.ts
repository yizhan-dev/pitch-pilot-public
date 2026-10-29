// The graphics quality (a lighter animation and load, so even a Chromebook runs the app smoothly: the render scale
// first, then a low tier, both on their own, a strong machine unchanged). Two
// levers, measured on this machine's weak iGPU at 1366x768 (docs/plans/performance.md):
// - the render scale: the canvas's pixel ratio, lowered in steps while the frame rate is short and raised again once
//   it is back (the GPU here is bound by the pixels it shades: 0.75 took 108 fps to 173);
// - the low tier, once the scale is at its floor and the frame rate still short: the grass drawn with simpler lighting
//   and half the layers of detail, no shadows, the three fill lights as one, no antialiasing from the next load (the
//   stands keep their materials: as Lambert they came out darker, for a tenth of the time). The HUD is HTML and stays
//   sharp whatever the scale.
// The level reached is kept for the device (localStorage), so the next visit starts where this one settled.
// URL overrides, for checks: ?q=high|low (the tier, held), ?scale=0.8 (the scale, held), ?adapt=0 (no adapting).
import { store, useStore } from '../hud/draft';
import { hook } from '../dev';

export type Tier = 'high' | 'low';
export interface Quality { tier: Tier; scale: number }

// (v2: a level forced by the address was kept in v1, and a device left on the low tier from a check, no shadows and
// jagged edges on the next plain visit, the players' shadows missing. v3: the show raised the
// scale on its light shots and kept it, 0.65 to 0.95 on a Ryzen iGPU)
const KEY = 'pp-quality-v3';
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
/** the scale's ceiling: the screen's own pixel ratio, from 1 to 1.5 (as the canvas had it before) */
export const MAX_SCALE = Math.min(Math.max(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, 1), 1.5);
/** and its floor: under this the picture turns soft */
export const MIN_SCALE = 0.6;
const forcedTier = q.get('q') === 'low' || q.get('q') === 'high' ? (q.get('q') as Tier) : null;
const forcedScale = q.get('scale') !== null && +(q.get('scale') ?? '') > 0 ? Math.min(2, +(q.get('scale') ?? 1)) : null;
/** adapting on: off with ?adapt=0, when both are held by the address, for a recording (?capture=1) and in a headless
 *  browser (the checks' screenshots and the recorders run slow by nature and would see a slow machine; ?adapt=1 for a
 *  check of the adapting itself) */
const headless = typeof navigator !== 'undefined' && /HeadlessChrome/.test(navigator.userAgent);
export const ADAPT = q.get('adapt') === '1' || (q.get('adapt') !== '0' && q.get('capture') !== '1' && !headless && !(forcedTier && forcedScale));

function saved(): Quality | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && (v.tier === 'high' || v.tier === 'low') && typeof v.scale === 'number') return { tier: v.tier, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale)) };
  } catch { /* storage off: start from the top */ }
  return null;
}
const start = ADAPT ? saved() : null;   // (no adapting: no level kept from before either)
export const quality = store<Quality>({
  tier: forcedTier ?? start?.tier ?? 'high',
  scale: forcedScale ?? start?.scale ?? MAX_SCALE,
});
export const useQuality = () => useStore(quality);
export const tierForced = forcedTier !== null, scaleForced = forcedScale !== null;
/** the scale the canvas has now: applied inside a frame, just before it is drawn (ApplyScale), never between frames (a
 *  canvas resized between frames is cleared and can show black for a frame, a visible blink); a canvas's
 *  dpr prop must read this, or R3F's configure on a re-render sets the scale again itself, between frames */
export const applied = { scale: quality.get().scale };
/** the tier the page loaded with (antialiasing is the context's, fixed at its creation) */
export const TIER_AT_LOAD = quality.get().tier;
/** no antialiasing only for a device kept on the low tier at the floor of the scale, a weak one: elsewhere the edges
 *  stay smooth (without antialiasing the jagged edges were too strong) */
export const AA_OFF_AT_LOAD = TIER_AT_LOAD === 'low' && quality.get().scale <= MIN_SCALE + 0.05;

/** a step of the quality, kept for the device; never while the address holds a level (a check's level is not the
 *  device's) */
export function setQuality(next: Partial<Quality>) {
  const cur = quality.get(), v = { tier: tierForced ? cur.tier : next.tier ?? cur.tier, scale: scaleForced ? cur.scale : next.scale ?? cur.scale };
  if (v.tier === cur.tier && Math.abs(v.scale - cur.scale) < 1e-3) return;
  quality.set(v);
  if (tierForced || scaleForced) return;
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* this visit only */ }
}

/** the low tier's levers, each one that can be left out for a check (?qx=pitch,light,aa) */
const EXCL = new Set((q.get('qx') ?? '').split(',').filter(Boolean));
export const lowHas = (lever: 'pitch' | 'light' | 'aa') => !EXCL.has(lever);


/** an optimisation turned off from the address for an A/B (?xoff=stagememo,idlerender,hullshadow) */
const XOFF = new Set((q.get('xoff') ?? '').split(',').filter(Boolean));
export const xOn = (name: string) => !XOFF.has(name);

/** the line-up show's own ceiling on a visit with no level kept yet (three/quality.ts xOn 'showbudget'): the canvas
 *  pixels capped at SHOW_BUDGET_PX (1.3 Mpx: 1366x768 at 1 is under it, 1920x1080 goes to 0.79, 2109x1321 to 0.68).
 *  The show is cinematic and starts cold, on a device the page knows nothing of yet; a visit later starts from the
 *  level the game reached. Its sampler, reading the show slow, takes the level to this ceiling in one step and on down
 *  from there (AdaptiveQuality show). Measured: Chrome on a Ryzen iGPU at 2109x1321 dropped a
 *  frame in every ten at 0.75 and held at 0.65 */
export const SHOW_BUDGET_PX = 1.3e6;
/** the guess, before any measurement (the show's first frames draw at it) */
export const SHOW_CEIL = (() => {
  if (typeof window === 'undefined' || start || forcedScale !== null) return MAX_SCALE;
  const px = innerWidth * innerHeight * (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) ** 2;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(Math.sqrt(SHOW_BUDGET_PX / Math.max(1, px)) * 100) / 100));
})();

/** the show's live ceiling: the guess, then the measured level once the show's own first frames are timed (calibrated) */
export const showCeil = store<number>(SHOW_CEIL);
/** the scale the show's canvas has now (as `applied` for the stage's): its dpr prop reads this, or a re-render of the
 *  show (a beat's change of state) had R3F set the prop's old value again, a resize and back (seen at 2109x1321) */
export const appliedShow = { scale: Math.min(SHOW_CEIL, quality.get().scale) };

/** the calibration (three/gpuMeter.ts; xOn 'calib'): each canvas times its first frames at full scale under the loader
 *  and reports the GPU's time for one; the level that fits TARGET_MS follows (the fill scales by the pixels, so the time
 *  at scale 1 is the time measured over the scale squared), in steps of 0.05, never above the ceiling nor below the
 *  floor. Only on a visit with no level kept and nothing held by the address: a kept level is the device's own
 *  experience. Loading a little slower is affordable: the loading bar is on screen meanwhile */
export const TARGET_MS = 12.5;
/** the show's: its first frames are the title's opening angle, and the rise over the roof that follows runs about a
 *  tenth heavier, so the show is given that margin */
export const TARGET_SHOW_MS = 11;
export const calib: { game: { ms1: number; scale: number } | null; show: { ms1: number; scale: number } | null } = { game: null, show: null };
export const wantsCalibration = () => ADAPT && !start && forcedScale === null;
export function calibrated(which: 'game' | 'show', msAtScale: number, atScale: number) {
  if (!wantsCalibration() || !(msAtScale > 0) || !(atScale > 0)) return;
  const ms1 = msAtScale / (atScale * atScale);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.floor(Math.sqrt((which === 'show' ? TARGET_SHOW_MS : TARGET_MS) / Math.max(0.1, ms1)) * 20) / 20));
  calib[which] = { ms1: Math.round(ms1 * 10) / 10, scale };
  if (which === 'show') showCeil.set(scale);
  else if (scale < quality.get().scale) setQuality({ scale });
}

/** frames the stage did not draw (the idle frames, Stage.tsx RenderGate): a window with any is no reading of the machine
 *  (cheap frames made a slow machine look fast, and the scale went up while paused) */
export const frameSkips = { n: 0 };

// for the checks: the level now, and a step by hand
if (typeof window !== 'undefined') hook('quality', { get: () => quality.get(), set: setQuality, adapt: ADAPT, calib, showCeil: () => showCeil.get() });
