// A dev-only profile of each pick, posted to a listener on this machine (the dark can step through its fade in a real
// browser tab where the headless checks show it smooth): from the pause, every animation frame's gap and the dark's
// alpha (WhatIfScene.tsx writes window.__wiDim) for two seconds, with the page's size, the quality level and whether
// the trials ran on the workers. Never in a build (import.meta.env.DEV) and only on 127.0.0.1; a failed post is
// nothing. Read with <private-workspace> Remove when the dark is settled.
import { hooked } from '../dev';
const ON = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV && typeof location !== 'undefined' && location.hostname === '127.0.0.1';
let run: { t: number[]; a: number[]; info: Record<string, unknown>; raf: number; t0: number } | null = null;

/** the pause: start logging frames */
export function pickProfileStart(info: Record<string, unknown>) {
  if (!ON) return;
  if (run) cancelAnimationFrame(run.raf);
  const r = { t: [] as number[], a: [] as number[], info, raf: 0, t0: performance.now() };
  const loop = () => { r.t.push(performance.now() - r.t0); r.a.push(hooked<number>('wiDim') ?? 0); if (performance.now() - r.t0 < 2500) r.raf = requestAnimationFrame(loop); };
  r.raf = requestAnimationFrame(loop);
  run = r;
}
/** the options in: close the log after a while and post it */
export function pickProfileEnd(extra: Record<string, unknown>) {
  if (!ON || !run) return;
  const r = run; run = null;
  setTimeout(() => {
    cancelAnimationFrame(r.raf);
    const gaps = r.t.map((t, i) => (i ? +(t - r.t[i - 1]).toFixed(1) : +t.toFixed(1)));
    const q = hooked<{ get: () => unknown }>('quality')?.get();
    const body = JSON.stringify({ ...r.info, ...extra, at: new Date().toISOString(), size: [innerWidth, innerHeight, devicePixelRatio], quality: q, hidden: document.hidden, ua: navigator.userAgent, cores: navigator.hardwareConcurrency, gaps, alpha: r.a.map((x) => +x.toFixed(3)) });
    try { void fetch('http://127.0.0.1:5199/wi-perf', { method: 'POST', mode: 'no-cors', body, keepalive: true }).catch(() => undefined); } catch { /* nothing */ }
  }, 2000);
}
