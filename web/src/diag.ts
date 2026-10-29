// ?diag=1: what this machine does as the page runs, for a report pasted back (the intro's hexagons can drop frames on
// a viewer's machine and not on the test machine). A corner panel shows the frame rate and the dropped frames;
// Copy gives the whole report: the GPU and the screen, the quality's changes, and every frame over 25 ms with what it
// held (main-thread tasks, waits on the GPU's shader compiles, the canvases' sizes, where the line-up show stood).
// Installed before any WebGL context is made (main.tsx imports it first), so its waits are all seen. Nothing without
// the flag.

import { hook, hooked } from './dev';

const ON = typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === '1';

type Frame = { at: number; ms: number; tasks: number; gl: number; glWhat: string; canv: string; intro: string; q: string };

if (ON && typeof window !== 'undefined') {
  const t0 = performance.now();
  const frames: Frame[] = [], qlog: string[] = [];
  let taskMs = 0, glMs = 0, glWhat = new Map<string, number>(), nFrames = 0, drops = 0;
  // the GL calls that wait for the GPU (a shader's compile, a program's link, a read back), timed
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const P = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'readPixels', 'finish', 'getError', 'linkProgram', 'compileShader']) {
      const f = P[name];
      if (typeof f !== 'function') continue;
      P[name] = function (this: unknown, ...a: unknown[]) {
        const s = performance.now(), r = f.apply(this, a), d = performance.now() - s;
        if (d > 1) { glMs += d; glWhat.set(name, (glWhat.get(name) ?? 0) + d); }
        return r;
      };
    }
  }
  // main-thread tasks over 50 ms, as the browser reports them
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) taskMs += e.duration; }).observe({ type: 'longtask', buffered: false }); } catch { /* not in this browser */ }
  const gpu = (() => { try { const c = document.createElement('canvas').getContext('webgl2'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e && c ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : 'unknown'; } catch { return 'unknown'; } })();
  const state = () => {
    const g = document.querySelector('.gm-intro'), q = hooked<{ get: () => { tier: string; scale: number } }>('quality')?.get();
    return {
      canv: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`).join(','),
      intro: g ? `show ${(+getComputedStyle(g).opacity).toFixed(2)} ${(() => { const lu = hooked<{ t: () => number; beat: () => string }>('lu'); return lu ? `${lu.beat()} ${lu.t().toFixed(1)}s` : ''; })()}` : 'game',
      q: q ? `${q.tier} ${q.scale}` : '-',
    };
  };
  let last = 0, lastQ = '';
  const tick = (t: number) => {
    if (last) {
      const ms = t - last; nFrames++;
      if (ms > 25) {
        drops++;
        const s = state();
        frames.push({ at: Math.round(last - t0), ms: Math.round(ms), tasks: Math.round(taskMs), gl: Math.round(glMs), glWhat: [...glWhat].map(([k, v]) => `${k} ${Math.round(v)}`).join(' '), ...s });
        if (frames.length > 400) frames.shift();
      }
    }
    const s = state();
    if (s.q !== lastQ) { qlog.push(`${Math.round(t - t0)} ms: ${s.q} (${s.intro})`); lastQ = s.q; }
    taskMs = 0; glMs = 0; glWhat = new Map(); last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // the panel
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', right: '8px', bottom: '140px', zIndex: '9999', padding: '8px 10px', background: 'rgba(0,0,0,.78)', color: '#bff', font: '12px/1.4 ui-monospace, monospace', borderRadius: '6px', pointerEvents: 'auto' });
  const line = document.createElement('div'), copy = document.createElement('button'), reset = document.createElement('button');
  for (const b of [copy, reset]) Object.assign(b.style, { marginTop: '6px', marginRight: '6px', font: '12px ui-monospace, monospace', padding: '3px 8px', cursor: 'pointer' });
  copy.textContent = 'Copy report'; reset.textContent = 'Reset';
  box.append(line, copy, reset);
  const report = () => [
    `Pitch Pilot diag · ${new Date().toISOString()}`,
    `GPU: ${gpu}`,
    `screen ${screen.width}x${screen.height} · window ${innerWidth}x${innerHeight} · devicePixelRatio ${devicePixelRatio}`,
    `browser: ${navigator.userAgent}`,
    `frames ${nFrames}, over 25 ms: ${drops}`,
    `build ${document.querySelector('script[src*="index-"]')?.getAttribute('src')?.split('/').pop() ?? '?'}`,
    `quality: ${qlog.join(' | ')}`,
    'dropped frames (at ms from load, length ms, long tasks ms, GPU waits ms [which], canvases, intro, quality):',
    ...frames.map((f) => `${f.at} +${f.ms} | tasks ${f.tasks} | gl ${f.gl}${f.glWhat ? ` [${f.glWhat}]` : ''} | ${f.canv} | ${f.intro} | ${f.q}`),
  ].join('\n');
  copy.onclick = (e) => { e.stopPropagation(); void navigator.clipboard?.writeText(report()).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy report'; }, 1500); }).catch(() => { console.log(report()); copy.textContent = 'See console'; }); };
  reset.onclick = (e) => { e.stopPropagation(); frames.length = 0; nFrames = 0; drops = 0; };
  setInterval(() => { line.textContent = `diag · frames ${nFrames} · drops ${drops} · ${state().q}`; }, 500);
  const mount = () => document.body.appendChild(box);
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
  hook('diag', report);
}

export {};
