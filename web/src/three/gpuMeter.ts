// The GPU's time for a frame, measured (EXT_disjoint_timer_query_webgl2, on the Ryzen's radeonsi path and the 5090
// alike): a query round a gl.render, read back a few frames on. The quality's calibration takes the first frames of
// each canvas, under the loader (three/quality.ts calibrate; a slightly slower load is affordable behind the
// loading bar), so a first visit starts at a level measured, not guessed. null where the extension is
// missing, or the clock was disjoint (the result is not to be trusted then).
import type * as THREE from 'three';

interface Ext { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
interface Pending { q: WebGLQuery; done: (ms: number | null) => void }

export class GpuMeter {
  private ctx: WebGL2RenderingContext | null;
  private ext: Ext | null;
  private pending: Pending[] = [];
  private open = false;
  constructor(gl: THREE.WebGLRenderer) {
    const c = gl.getContext();
    this.ctx = c instanceof WebGL2RenderingContext ? c : null;
    this.ext = (this.ctx?.getExtension('EXT_disjoint_timer_query_webgl2') as Ext | null) ?? null;
  }
  get available() { return !!this.ext; }
  /** draw: the render, timed; resolves with its GPU time in ms, or null */
  time(draw: () => void): Promise<number | null> {
    const { ctx, ext } = this;
    if (!ctx || !ext || this.open) { draw(); return Promise.resolve(null); }
    const q = ctx.createQuery();
    if (!q) { draw(); return Promise.resolve(null); }
    this.open = true;
    ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
    try { draw(); } finally { ctx.endQuery(ext.TIME_ELAPSED_EXT); this.open = false; }
    return new Promise((done) => this.pending.push({ q, done }));
  }
  /** once a frame: the queries whose results are in, resolved */
  poll() {
    const { ctx, ext } = this;
    if (!ctx || !ext || !this.pending.length) return;
    const disjoint = ctx.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    for (const p of [...this.pending]) {
      if (!ctx.getQueryParameter(p.q, ctx.QUERY_RESULT_AVAILABLE)) continue;
      const ns = ctx.getQueryParameter(p.q, ctx.QUERY_RESULT) as number;
      ctx.deleteQuery(p.q);
      this.pending = this.pending.filter((x) => x !== p);
      p.done(disjoint ? null : ns / 1e6);
    }
  }
}
