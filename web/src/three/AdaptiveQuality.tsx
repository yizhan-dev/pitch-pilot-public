import { useEffect, useRef } from 'react';
import { hook } from '../dev';
import { useFrame, useThree } from '@react-three/fiber';
import { clipSwap } from '../game/clipSwap';
import { ADAPT, MAX_SCALE, MIN_SCALE, applied, frameSkips, quality, setQuality, showCeil, tierForced } from './quality';

/** the render scale applied inside the frame, just before it is drawn: R3F resizes the canvas at once on setDpr, so
 *  the frame that follows fills it; set from an effect, between frames, the cleared canvas could be shown black for a
 *  frame, a visible blink. In every canvas that follows the quality */
export function ApplyScale({ ceil, record = applied }: { ceil?: () => number; record?: { scale: number } } = {}) {
  // (a canvas drawing on demand, the stage under the show, draws a frame when the level changes: the new scale and any
  // new shaders are taken there, covered, not at the hand-over)
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => quality.subscribe(() => invalidate()), [invalidate]);
  useFrame((state) => {
    const want = Math.min(ceil ? ceil() : Infinity, quality.get().scale);
    if (Math.abs(state.viewport.dpr - want) > 1e-3) { record.scale = want; state.setDpr(want); }
  });
  return null;
}

// The quality on its own (three/quality.ts): the frame rate over two seconds at a time, frames over time, the long ones
// counted (a slow GPU runs many quick frames, then one long one while its queue drains: a median or a trimmed mean took
// it for a fast machine), and three short windows in a row before a step down. A window held back as a whole (the
// window hidden, the browser throttling it) is not counted, nor one with idle frames in it (Stage.tsx RenderGate); a
// short stall (a clip loading, shaders compiling) is left out of its window's reading. The render scale down a step
// when it is short and up a step when it keeps up, the low tier once the scale is at its floor and still short. No
// reading while the tab is hidden, a clip changes, or just after a step (the new level settles first). A scale that
// went up and came straight back down twice stays where it is for the visit.
const DOWN_FPS = 45, UP_FPS = 57, WINDOW_MS = 2000, SETTLE_MS = 1500, STEP_DOWN = 0.15, STEP_UP = 0.1, STALL_MS = 250, BAD_WINDOWS = 3;
/** after the line-up show and after each clip change, the page settles this long before it is read: the clip, the
 *  portraits and the shaders load then, and were taken for a slow machine (the start lagged, and the
 *  low tier came with it) */
const BUSY_SETTLE_MS = 6000;
const round = (x: number) => Math.round(x * 100) / 100;

/** show: in the line-up show's canvas (LineupShow.tsx), which is read while it runs, a second at a time and two short
 *  ones to a step, so a slow device steps down before its last beat even when Skip comes early (the game's own sampler
 *  waits for the show to be over); without it, at 2560x1440 on the iGPU the show ran at 30 fps, never adapting */
export function AdaptiveQuality({ show = false }: { show?: boolean }) {
  // (and its bar is smoothness, not playability: two seconds under 56 fps, a frame dropped now and then, step it down by
  // 0.1, so the sharpness given up is no more than it takes; measured: the show at 0.75 on a Ryzen iGPU
  // dropped a frame in every ten, about 55 fps, which the game's bar of 45 let through, and every second one through the
  // hexagons; at 0.65 it held)
  const windowMs = show ? 1000 : WINDOW_MS, badWindows = show ? 2 : BAD_WINDOWS, stepDown = show ? 0.1 : STEP_DOWN, downFps = show ? 56 : DOWN_FPS;
  // the sampler
  const st = useRef({ t0: 0, n: 0, prev: 0, ft: [] as number[], since: performance.now() + (show ? 3000 : BUSY_SETTLE_MS), busy: !show, good: 0, bad: 0, last: '' as '' | 'up' | 'down', flips: 0, lockUp: false, lowHere: false, triedHigh: false });
  useFrame(() => {
    if (!ADAPT) return;
    const now = performance.now(), s = st.current;
    // (busy: the line-up show over the stage, or a clip changing; the settling starts once it is over)
    const busy = clipSwap.get() !== 'off' || (!show && !!document.querySelector('.gm-intro'));
    if (busy || s.busy) { if (!busy) s.since = Math.max(s.since, now + BUSY_SETTLE_MS); s.busy = busy; }
    if (document.hidden || busy || now < s.since) { s.t0 = 0; return; }
    if (!s.t0) { s.t0 = now; s.prev = now; s.n = 0; s.ft.length = 0; frameSkips.n = 0; return; }
    s.n++; s.ft.push(now - s.prev); s.prev = now;
    if (now - s.t0 < windowMs) return;
    const span = now - s.t0, q = quality.get();
    s.t0 = 0;
    // frames held back as a whole (a median over 250 ms: the window hidden behind another, the browser throttling it)
    // say nothing about the machine; a stall among the frames (a clip or the stride library loading, shaders
    // compiling), under half the window, is left out of the reading, the frames around it counted at their own pace. A
    // slow GPU's long frames, most of the window, count (it runs a few quick frames, then one long one while its queue
    // drains: seen on SwiftShader; skipping such windows left it at full scale)
    const sorted = s.ft.slice().sort((a, b) => a - b);
    if (sorted[sorted.length >> 1] > STALL_MS) return;
    let stalled = 0, nStalled = 0;
    for (const x of s.ft) if (x > STALL_MS) { stalled += x; nStalled++; }
    const fps = stalled > 0 && stalled < 0.5 * span ? ((s.n - nStalled) * 1000) / Math.max(1, span - stalled) : (s.n * 1000) / span;
    hook('qualityFps', Math.round(fps));   // (for the checks)
    // (frames the stage did not draw, still and paused: cheap ones, no reading of the machine either)
    if (frameSkips.n > 0) return;
    const moved = (dir: 'up' | 'down') => { if (dir === 'down' && s.last === 'up' && ++s.flips >= 2) s.lockUp = true; s.last = dir; s.good = 0; s.bad = 0; s.since = now + SETTLE_MS; };
    if (fps < downFps) {
      s.good = 0;
      if (++s.bad < badWindows) return;
      // (the show above its ceiling: to the ceiling in one step, the level it was drawn at)
      if (q.scale > MIN_SCALE + 1e-3) { const c = showCeil.get(); setQuality({ scale: Math.max(MIN_SCALE, show && q.scale > c + 1e-3 ? c : round(q.scale - stepDown)) }); moved('down'); }
      else if (q.tier === 'high' && !tierForced) { setQuality({ tier: 'low' }); s.lowHere = true; moved('down'); }
    } else if (fps >= UP_FPS) {
      s.bad = 0;
      // (in the show, down only: its shots go from light to heavy, and a scale raised on the light ones met the hexagons'
      // turn too high; measured on the iGPU at 2109x1321: 0.65 → 0.95 through the show, then a dropped
      // frame in every two through the hexagons. The game's own sampler raises it again once the show is over)
      if (show) return;
      s.good++;
      if (!s.lockUp && s.good >= 2 && q.scale < MAX_SCALE - 1e-3) { setQuality({ scale: Math.min(MAX_SCALE, round(q.scale + STEP_UP)) }); moved('up'); }
      // a low tier kept from an earlier visit, the machine now keeping up at full scale for ten seconds: the high tier
      // tried again, once a visit (a low tier reached in this visit stays)
      else if (q.tier === 'low' && !s.lowHere && !s.triedHigh && !tierForced && q.scale >= MAX_SCALE - 1e-3 && s.good >= 5) { s.triedHigh = true; setQuality({ tier: 'high' }); moved('up'); }
    } else { s.good = 0; s.bad = 0; }
  });

  return null;
}
