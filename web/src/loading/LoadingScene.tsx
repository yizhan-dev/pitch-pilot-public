// The site's loading scene (something iconic: it is the first thing a judge sees): shown
// from the first paint until the game's data is in, then handing over to the line-up show's drone shot. Canvas 2D, no
// three.js, so it paints at once. loading-main.tsx mounts it over the game:
//   <LoadingScene progress={0..1} ready={boolean} onExit={() => ...} />
// - The progress on screen never runs ahead of `progress`, and never faster than the short complete version (MIN_S),
//   so a fast load still plays the whole of it; a slow one keeps its idle motion going while it waits.
// - Once `ready` and the progress on screen is full, the exit plays (EXIT_S) and `onExit` is called once at its end;
//   the canvas is transparent by then, the scene below showing through.
// - Deterministic on a clock: `window.__teleNow` (seconds since it began), when set, drives it, as the telestration's
//   recordings do, so the trailer can open with it.
// - The name is one string (`name`; empty draws none); English only.
import { useEffect, useRef } from 'react';
import { hook, hooked } from '../dev';
import { LOOKS, type LookKey } from './looks';

/** the short complete version: the progress on screen takes at least this long to fill, seconds */
export const MIN_S = 1.4;
/** the exit, seconds */
export const EXIT_S = 0.85;

export interface LoadingProps { progress: number; ready: boolean; onExit?: () => void; name?: string; look?: LookKey }

export function LoadingScene({ progress, ready, onExit, name = '', look = 'ring' }: LoadingProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ progress, ready, onExit, name, look });
  live.current = { progress, ready, onExit, name, look };

  useEffect(() => {
    const cv = canvas.current!, ctx = cv.getContext('2d')!;
    const st = { t0: performance.now() / 1000, last: -1, shown: 0, exitAt: null as number | null, done: false };
    hook('loadReplay', () => { st.t0 = performance.now() / 1000; st.last = -1; st.shown = 0; st.exitAt = null; st.done = false; });
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const L = live.current, tn = hooked<number>('teleNow'), t = typeof tn === 'number' ? tn : performance.now() / 1000 - st.t0;
      const dt = st.last < 0 ? 0 : Math.max(0, Math.min(0.1, t - st.last));
      st.last = t;
      // the canvas at the screen's pixels (at most 2 per CSS pixel)
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      // the progress on screen: towards the real one, never ahead of it, never faster than the short version
      const cap = Math.min(1, t / MIN_S), target = Math.min(Math.max(0, Math.min(1, L.progress)), cap);
      st.shown += (target - st.shown) * (1 - Math.exp(-dt * 9));
      if (target >= 0.999 && Math.abs(target - st.shown) < 0.004) st.shown = target;
      if (st.exitAt === null && L.ready && st.shown >= 0.999 && t >= MIN_S) st.exitAt = t;
      const e = st.exitAt === null ? null : Math.min(1, (t - st.exitAt) / EXIT_S);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!(e !== null && e >= 1)) LOOKS[L.look]({ ctx, W: w, H: h, t, shown: st.shown, e, name: L.name });
      hook('loadState', { t, shown: st.shown, e, look: L.look });
      if (e !== null && e >= 1 && !st.done) { st.done = true; L.onExit?.(); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvas} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none', zIndex: 50 }} />;
}
