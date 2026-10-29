// The ball's trace (fundamentals, docs/research/telestration.md 0.1): a white comet behind the ball (white is the ball
// in the meaning colours), turned to the camera so it reads in every view, tapering and fading to its old end, with a
// soft halo; while the ball is in the air, a faint shadow straight below it on the grass, so its height reads at a
// glance (pitch_prism's lofted-pass cue: the ground track under the arc). Optionally a thin drop line from the ball to
// its shadow. Pinned to the match: it follows clip time, so a pause freezes it where the ball is.
// Variants to compare (TELE.ball.mode): 'shadow' trace and shadow; 'drop' also the drop line; 'plain' the trace alone.
// Touches (a ball stopped and struck again drew one bent trace through the touch): the trace
// starts again at every touch, a sudden change of the ball's horizontal velocity (a trap, a pass, a shot, a header, the
// post; a bounce changes mostly the vertical one). The part before the touch does not join the new one: its tail runs
// in to the touch point and it is gone in `cutS` s, while the new trace grows out of the touch point.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Loaded } from '../../data';
import type { Clock } from '../../clock';
import { ballAt } from '../Ball';
import { StripLayer, type StripPoint } from './strip';
import { RibbonLayer, type RibbonPoint } from './ribbon';
import { holdInNet } from '../stadium/goalSpace';
import { TELE, surfaceColour } from './style';

/** the clip times where the trace starts again (only touches that obviously change the
 *  ball's direction). A touch is a jump of over `dv` m/s in the ball's horizontal velocity (two samples either side, the
 *  largest within 0.1 s); it restarts the trace when the ball's way out (the next 0.12 s) turns more than `turnDeg` from
 *  the way of the trace it would join (its chord back to the last restart, at most `seconds`), or when that trace is
 *  too short to see (the ball was nearly still). A touch that stops the ball (under 0.25 m in the next 0.12 s) does not:
 *  the trace runs into the stop and drains there by itself. A push along the same line does not either. */
export function ballTouches(pkg: Loaded['pkg'], dv = 3.5, turnDeg = 30, seconds = 1.2): number[] {
  const B = pkg.ball25, fps = B ? B.fps : pkg.meta.fps;
  const X: ([number, number, number] | null)[] = B ? (B.xyz as ([number, number, number] | null)[]) : pkg.frames.map((f) => (f.ball as [number, number, number] | null) ?? null);
  const step = B ? 2 : 1, jumps: number[] = new Array(X.length).fill(0);
  for (let k = step; k + step < X.length; k++) {
    const a = X[k - step], b = X[k], c = X[k + step];
    if (!a || !b || !c) continue;
    const s = fps / step;
    jumps[k] = Math.hypot((c[0] - b[0]) * s - (b[0] - a[0]) * s, (c[1] - b[1]) * s - (b[1] - a[1]) * s);
  }
  const out: number[] = [], w = Math.max(1, Math.round(0.1 * fps)), ahead = Math.max(1, Math.round(0.12 * fps)), back = Math.round(seconds * fps);
  const cosTurn = Math.cos((turnDeg * Math.PI) / 180);
  let last = -Infinity;
  for (let k = 1; k + ahead + 1 < X.length; k++) {
    if (jumps[k] <= dv) continue;
    let peak = true;
    for (let j = Math.max(0, k - w); j <= Math.min(X.length - 1, k + w); j++) if (jumps[j] > jumps[k] || (jumps[j] === jumps[k] && j < k)) { peak = false; break; }
    if (!peak) continue;
    const o0 = X[k + 1], o1 = X[k + 1 + ahead], i1 = X[k - 1];
    const i0 = X[Math.max(0, k - 1 - back, Number.isFinite(last) ? Math.round(last * fps) : 0)];
    if (!o0 || !o1 || !i0 || !i1) continue;
    const ox = o1[0] - o0[0], oy = o1[1] - o0[1], Lo = Math.hypot(ox, oy);
    if (Lo < 0.25) continue;                                                     // stopped: the trace drains by itself
    const ix = i1[0] - i0[0], iy = i1[1] - i0[1], Li = Math.hypot(ix, iy);
    if (Li < 0.3 || (ix * ox + iy * oy) / (Li * Lo) < cosTurn) { out.push(k / fps); last = k / fps; }
  }
  return out;
}

/** the ribbon looks (TELE.ball.look: like a trail on the grass while the ball rolls, a flat band
 *  rather than a cone in the air, always under the ball). All are constant-width white ribbons (TELE.ball.half, alpha,
 *  fade, seconds as the comet), fading to the old end, ending in a round cap, never drawn over the ball (ribbon.ts):
 *   'tape'    one ribbon that lies flat under the ball (on the grass while it rolls) while the ball is within `flatTo`
 *             m of the grass and stands up to face the camera as the ball rises (fully by `faceAt` m), its centre
 *             rising from the ball's underside to its centre as it does
 *   'track'   a ribbon on the grass while the ball rolls, and a camera-facing ribbon for the part in the air, the one
 *             handing over to the other between `airFrom` and `airFull` m (the default, B "without the
 *             ground track": nothing on the grass under a lofted ball, `trackUnderAir` 0)
 *   'curtain' the ground track, and under the part in the air an upright translucent curtain from the grass to the
 *             path (alpha `curtainFoot` at its foot to `curtainTop` at its top), the path a thin line (`lineHalf`) on top
 *  Heights are the ball's centre above the grass (`airFrom`, `airFull`) or its clearance, centre less radius (the rest) */
const LOOK = {
  /** resampling (metres between samples at least) and the length either side the way is taken over */
  step: 0.03, tanM: 0.1,
  /** the live ribbons end this far behind the ball's centre (its radius: the round end stays under the ball) */
  headM: 0.11,
  groundY: 0.01, flatTo: 0.15, faceAt: 0.6, hopM: 0.04,
  // the hand-over from the grass ribbon to the air one, kept short so the two are never seen together (with
  // 0.3 to 0.9 m a bouncing ball drew two trails)
  airFrom: 0.25, airFull: 0.4, groundUnderAir: 0.5, trackUnderAir: 0,
  // a flight lasts from just before the ball rises until it has stayed down this long: its bounces do not break it into
  // pieces of grass and air ribbon (several discontinuous tapes)
  flightBackS: 0.4, flightAheadS: 0.08,
  /** the ribbon on the grass widens at most `groundCap` times (TELE.ball.groundMinPx, groundFlatMin:
   *  far away it thinned to a pitch line) */
  groundCap: 8,
  curtainFoot: 0.18, curtainTop: 0.03, curtainEdge: 0.1, lineHalf: 0.035,
  /** the clear gap round the ball (pixels) and its soft edge (pixels) */
  ballGapPx: 1.2, ballSoftPx: 1.2,
};
const R = 0.11;
const sstep = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
/** a sample of the ball's path: scene position (y its centre's height), clearance, alpha before the look's own */
/** a sample of the path: position, clearance, alpha; `fl` 0..1 how much the ball is in a flight there (its highest point
 *  over the last `flightBackS` s and the next `flightAheadS`), so the bounces of one flight stay one ribbon */
interface PathPt { x: number; y: number; z: number; c: number; a: number; fl: number }

export function BallTrace({ data, clock, surface }: { data: Loaded; clock: Clock; surface?: { current: number } }) {
  const touches = useMemo(() => ballTouches(data.pkg), [data]);
  const res = useMemo(() => ({ trail: new StripLayer('facing', 1024), shadow: new StripLayer('ground', 1024), drop: new StripLayer('facing', 16), size: new THREE.Vector2(), c: [1, 1, 1] as [number, number, number], v: new THREE.Vector3() }), []);
  useEffect(() => () => { res.trail.dispose(); res.shadow.dispose(); res.drop.dispose(); }, [res]);
  const rib = useMemo(() => ({ ground: new RibbonLayer(2048, true), air: new RibbonLayer(2048, false), cam: new THREE.Vector3(), v: new THREE.Vector3() }), []);
  useEffect(() => () => { rib.ground.dispose(); rib.air.dispose(); }, [rib]);
  useFrame((state) => {
    const B = TELE.ball, pkg = data.pkg, t = clock.t, k = surface ? surface.current : 0;
    const cam = state.camera as THREE.PerspectiveCamera;
    state.gl.getDrawingBufferSize(res.size);
    surfaceColour(TELE.color.white, k, res.c);
    if (B.look !== 'comet') {
      res.trail.begin(); res.shadow.begin(); res.drop.begin(); res.trail.end(res.size); res.shadow.end(res.size); res.drop.end(res.size);
      ribbons(B.look);
      return;
    }
    rib.ground.begin(); rib.air.begin(); rib.ground.end(); rib.air.end();
    for (const L of [res.trail, res.drop]) { const u = L.material.uniforms; u.uMinPx.value = TELE.minPx; u.uGlowPx.value = B.glowPx; u.uGlow.value = B.glow; }
    res.trail.begin(); res.shadow.begin(); res.drop.begin();
    // the last touch at or before now: the trace runs from it; the part before it runs in to the touch and is gone
    let lo = 0, hi = touches.length - 1, ic = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (touches[m] <= t) { ic = m; lo = m + 1; } else hi = m - 1; }
    const tc = ic >= 0 ? touches[ic] : -Infinity, tPrev = ic >= 1 ? touches[ic - 1] : -Infinity;
    let run: StripPoint[] = [], shade: StripPoint[] = [];
    const flush = () => { if (run.length > 1) res.trail.line(run); if (shade.length > 1) res.shadow.line(shade, (i) => margin(shade[i])); run = []; shade = []; };
    const margin = (p: StripPoint) => {   // the pixel's footprint along the view at this ground point, for the shadow's antialiasing
      const d = Math.max(0.5, res.v.set(p.x, 0, p.z).distanceTo(cam.position)), lat = (d * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / res.size.y;
      return Math.min(2, 2 * lat * Math.min(60, d / Math.max(0.3, cam.position.y)));
    };
    /** one stretch of the trace, clip times t0..t1, tapering and fading over its own length (so a trace cut short by a
     *  touch still ends in a point, never a flat edge), its alpha times mult; `live`: it ends at the ball
     *  (the gap just behind the ball) */
    const span = (t0: number, t1: number, tHead: number, mult: number, live: boolean) => {
      const n = Math.max(2, Math.round((t1 - t0) / 0.02) + 1);
      for (let i = 0; i < n; i++) {
        const tt = t0 + ((t1 - t0) * i) / (n - 1), age = tHead - tt, b = ballAt(pkg, tt);
        if (!b || tt < 0) { flush(); continue; }
        const f = (tt - t0) / Math.max(1e-6, t1 - t0), h = Math.max(0.11, b[2]);
        // fades: to nothing at the old end, and (live) just behind the ball, so the trace comes out from behind it
        const a = B.alpha * mult * f ** B.fade * (live ? Math.min(1, age / B.headGap) : 1);
        run.push({ x: b[0], y: h, z: b[1], half: B.half * (B.taper + (1 - B.taper) * f), r: res.c[0], g: res.c[1], b: res.c[2], a, glow: 1 });
        if (B.mode !== 'plain') {
          const lift = THREE.MathUtils.smoothstep(h, B.shadowFrom, B.shadowFrom + 0.8);
          if (lift > 0.01) shade.push({ x: b[0], y: 0, z: b[1], half: B.shadowHalf, r: 0, g: 0, b: 0, a: B.shadowAlpha * mult * lift * f ** B.fade, soft: true });
          else if (shade.length) { if (shade.length > 1) res.shadow.line(shade, (j) => margin(shade[j])); shade = []; }
        }
      }
      flush();
    };
    // the live trace, from the last touch (or B.seconds back)
    const t0 = Math.max(t - B.seconds, tc);
    if (t - t0 > 0.01) span(t0, t, t, 1, true);
    // the trace before the touch (only back to the touch before it), its tail running in to the touch point over cutS s
    const since = t - tc;
    if (since >= 0 && since < B.cutS) {
      const k = since / B.cutS, tail = tc - B.seconds * (1 - k), from = Math.max(tail, tc - B.seconds, tPrev);
      if (tc - from > 0.01) span(from, tc, tc, 1 - k * k, false);
    }
    // the drop line: from the ball down to its shadow, while it is in the air
    const b = ballAt(pkg, t);
    if (B.mode === 'drop' && b && b[2] > B.shadowFrom + 0.2) {
      const p = (y: number): StripPoint => ({ x: b[0], y, z: b[1], half: 0.012, r: res.c[0], g: res.c[1], b: res.c[2], a: 0.55 });
      res.drop.line([p(b[2] - 0.12), p(0.02)]);
    }
    res.trail.end(res.size); res.shadow.end(res.size); res.drop.end(res.size);

    /** the ribbon looks: the same spans as the comet (the live one from the last touch, the one before the touch
     *  running in to it), each drawn as the look's ribbons */
    function ribbons(look: string) {
      const G = rib.ground, A = rib.air, [cr, cg, cb] = res.c;
      for (const L of [G, A]) { L.material.uniforms.uMinPx.value = TELE.minPx; L.material.uniforms.uBallGap.value.set(LOOK.ballGapPx, LOOK.ballSoftPx); }
      // the ribbon on the grass keeps a width on screen far away, at full strength (the view flattens it to a pitch line)
      G.material.uniforms.uMinPx.value = TELE.ball.groundMinPx; G.material.uniforms.uFlatMin.value = TELE.ball.groundFlatMin; G.material.uniforms.uCap.value = LOOK.groundCap; G.material.uniforms.uHold.value = 1;
      G.begin(); A.begin();
      rib.cam.setFromMatrixPosition(cam.matrixWorld);
      // the ball as drawn (held in the net like StyledBall), for staying under it
      const bn = ballAt(pkg, t);
      for (const L of [G, A]) { L.ball.on = !!bn; if (bn) holdInNet(L.ball.p.set(bn[0], Math.max(R, bn[2]), bn[1])); }
      let lo = 0, hi = touches.length - 1, ic = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (touches[m] <= t) { ic = m; lo = m + 1; } else hi = m - 1; }
      const tc = ic >= 0 ? touches[ic] : -Infinity, tPrev = ic >= 1 ? touches[ic - 1] : -Infinity;
      /** `live`: the span ends at the ball, and its ribbons end `headM` m behind the ball's centre (along the path), so
       *  their round ends stay under the ball */
      const span = (t0: number, t1: number, mult: number, live: boolean) => {
        const n = Math.max(2, Math.round((t1 - t0) / 0.02) + 1);
        let run: PathPt[] = [];
        for (let i = 0; i < n; i++) {
          const tt = t0 + ((t1 - t0) * i) / (n - 1), b = ballAt(pkg, tt);
          if (!b || tt < 0) { draw(run, look); run = []; continue; }
          const f = (tt - t0) / Math.max(1e-6, t1 - t0), p = holdInNet(rib.v.set(b[0], Math.max(R, b[2]), b[1]));
          let top = 0;
          for (let s = tt - LOOK.flightBackS; s <= tt + LOOK.flightAheadS + 1e-6; s += 0.04) { const q = ballAt(pkg, s); if (q && q[2] > top) top = q[2]; }
          run.push({ x: p.x, y: p.y, z: p.z, c: Math.max(0, p.y - R), a: B.alpha * mult * f ** B.fade, fl: sstep(LOOK.airFrom, LOOK.airFull, Math.max(R, top)) });
        }
        draw(live ? trimHead(run, LOOK.headM) : run, look);
      };
      const t0 = Math.max(t - B.seconds, tc);
      if (t - t0 > 0.01) span(t0, t, 1, true);
      const since = t - tc;
      if (since >= 0 && since < B.cutS) {
        const q = since / B.cutS, tail = tc - B.seconds * (1 - q), from = Math.max(tail, tc - B.seconds, tPrev);
        if (tc - from > 0.01) span(from, tc, 1 - q * q, false);
      }
      G.end(); A.end();

      /** one unbroken run of the path as the look's ribbons */
      /** the run less its last `m` metres of path (none left: nothing) */
      function trimHead(run: PathPt[], m: number): PathPt[] {
        let acc = 0;
        for (let i = run.length - 1; i > 0; i--) {
          const a = run[i - 1], b = run[i], d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
          if (acc + d >= m) {
            const u = (m - acc) / Math.max(d, 1e-9), out = run.slice(0, i);
            out.push({ x: b.x + (a.x - b.x) * u, y: b.y + (a.y - b.y) * u, z: b.z + (a.z - b.z) * u, c: b.c + (a.c - b.c) * u, a: b.a + (a.a - b.a) * u, fl: b.fl + (a.fl - b.fl) * u });
            return out;
          }
          acc += d;
        }
        return [];
      }

      function draw(raw: PathPt[], look: string) {
        // samples closer than `step` to the last one kept are dropped (a slow ball's crowd, and a ribbon folds over
        // steps much shorter than its width); the head stays where the ball is
        const run: PathPt[] = [];
        for (const p of raw) { const q = run[run.length - 1]; if (!q || Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) >= LOOK.step) run.push(p); }
        const hd = raw[raw.length - 1];
        if (hd && run[run.length - 1] !== hd) { if (run.length > 1) run[run.length - 1] = hd; else run.push(hd); }
        const n = run.length;
        if (n < 2) return;
        const sv = sides(run);
        const half = B.half;
        if (look === 'tape') {
          const pts: RibbonPoint[] = [];
          for (let i = 0; i < n; i++) {
            // flat: level with the ball's underside (on the grass while it rolls; tracking's few centimetres of
            // jitter, `hopM`, ignored); standing up: its centre rises to the ball's, so its head is always in the ball
            const p = run[i], w = sstep(LOOK.flatTo, LOOK.faceAt, p.c), foot = LOOK.groundY + Math.max(0, p.c - LOOK.hopM);
            let sx = sv.g[i * 3] + (sv.f[i * 3] - sv.g[i * 3]) * w, sy = sv.g[i * 3 + 1] + (sv.f[i * 3 + 1] - sv.g[i * 3 + 1]) * w, sz = sv.g[i * 3 + 2] + (sv.f[i * 3 + 2] - sv.g[i * 3 + 2]) * w;
            const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
            pts.push({ x: p.x, y: foot + (p.y - foot) * w, z: p.z, sx, sy, sz, half, a: p.a });
          }
          G.line(pts, cr, cg, cb, true);
          return;
        }
        // the ribbon on the grass: 'curtain' under the whole run, fainter under a lofted ball (the curtain's foot);
        // 'track' only while the ball rolls, gone under a lofted one
        const gp: RibbonPoint[] = [], under = look === 'track' ? LOOK.trackUnderAir : LOOK.groundUnderAir;
        for (let i = 0; i < n; i++) {
          const p = run[i], air = p.fl;
          gp.push({ x: p.x, y: LOOK.groundY, z: p.z, sx: sv.g[i * 3], sy: 0, sz: sv.g[i * 3 + 2], half, a: p.a * (1 + (under - 1) * air) });
        }
        G.line(gp, cr, cg, cb, true);
        // the parts in the air: from a sample before the ball rises past airFrom to one after it comes down
        let i0 = -1;
        for (let i = 0; i <= n; i++) {
          const up = i < n && run[i].fl > 0.02;
          if (up && i0 < 0) i0 = Math.max(0, i - 1);
          if (!up && i0 >= 0) { airPart(run, sv, i0, Math.min(n - 1, i), half); i0 = -1; }
        }
        function airPart(run: PathPt[], sv: { g: Float32Array; f: Float32Array }, j0: number, j1: number, half: number) {
          if (j1 - j0 < 1) return;
          const air = (p: PathPt) => p.fl;
          if (look === 'track') {
            const pts: RibbonPoint[] = [];
            for (let i = j0; i <= j1; i++) { const p = run[i]; pts.push({ x: p.x, y: p.y, z: p.z, sx: sv.f[i * 3], sy: sv.f[i * 3 + 1], sz: sv.f[i * 3 + 2], half, a: p.a * air(p) }); }
            A.line(pts, cr, cg, cb, true);
            return;
          }
          // 'curtain': the upright curtain (soft at its head, under the ball), then the line on its top edge
          const cu: RibbonPoint[] = [], ln: RibbonPoint[] = [];
          let along = 0;
          const fromHead: number[] = new Array(j1 - j0 + 1).fill(0);
          for (let i = j1 - 1; i >= j0; i--) { along += Math.hypot(run[i + 1].x - run[i].x, run[i + 1].z - run[i].z); fromHead[i - j0] = along; }
          for (let i = j0; i <= j1; i++) {
            const p = run[i], k = p.a * air(p) * sstep(0, LOOK.curtainEdge, fromHead[i - j0]);
            cu.push({ x: p.x, y: p.y / 2, z: p.z, sx: 0, sy: 1, sz: 0, half: p.y / 2, a: k * LOOK.curtainFoot, a2: k * LOOK.curtainTop });
            ln.push({ x: p.x, y: p.y, z: p.z, sx: sv.f[i * 3], sy: sv.f[i * 3 + 1], sz: sv.f[i * 3 + 2], half: LOOK.lineHalf, a: p.a * air(p) });
          }
          A.line(cu, cr, cg, cb, false);
          A.line(ln, cr, cg, cb, true);
        }
      }
    }

    /** per sample of a run: `g` the side on the grass (level, square to the way), `f` the side turned to the camera
     *  (square to the way and to the view ray). Where the way points along the view ray the camera side is
     *  undefined: it holds the last good one (or the grass side), blended in smoothly, and never flips sign */
    function sides(run: PathPt[]) {
      const n = run.length, g = new Float32Array(n * 3), f = new Float32Array(n * 3), T = new Float32Array(n * 3), ok = new Uint8Array(n), s = new Float32Array(n);
      for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y, run[i].z - run[i - 1].z);
      // the way at a sample: the chord over `tanM` m either side, so a corner (a bounce, a touch that does not restart
      // the trace) turns the ribbon over a little length instead of folding it
      for (let i = 0, ja = 0, jb = 0; i < n; i++) {
        while (ja < i && s[i] - s[ja + 1] >= LOOK.tanM) ja++;
        if (jb < i) jb = i;
        while (jb < n - 1 && s[jb] - s[i] < LOOK.tanM) jb++;
        const a = run[ja], b = run[jb];
        const tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z, L = Math.hypot(tx, ty, tz);
        if (L > 1e-4) { T[i * 3] = tx / L; T[i * 3 + 1] = ty / L; T[i * 3 + 2] = tz / L; ok[i] = 1; }
      }
      // a still ball has no way: take the nearest sample's that has one
      const first = ok.indexOf(1);
      for (let i = 0, last = first; i < n; i++) {
        if (first < 0) { T[i * 3] = 1; continue; }
        if (ok[i]) last = i; else T.copyWithin(i * 3, last * 3, last * 3 + 3);   // before the first: the first's
      }
      let gx = 0, gz = 1, px = NaN, py = 0, pz = 0;
      for (let i = 0; i < n; i++) {
        const tx = T[i * 3], ty = T[i * 3 + 1], tz = T[i * 3 + 2], lh = Math.hypot(tx, tz);
        if (lh > 0.05) { let nx = -tz / lh, nz = tx / lh; if (i > 0 && nx * gx + nz * gz < 0) { nx = -nx; nz = -nz; } gx = nx; gz = nz; }
        g[i * 3] = gx; g[i * 3 + 1] = 0; g[i * 3 + 2] = gz;
        const p = run[i];
        let vx = p.x - rib.cam.x, vy = p.y - rib.cam.y, vz = p.z - rib.cam.z; const lv = Math.hypot(vx, vy, vz) || 1; vx /= lv; vy /= lv; vz /= lv;
        let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
        const m = Math.hypot(sx, sy, sz);
        if (m > 1e-6) { sx /= m; sy /= m; sz /= m; } else { sx = gx; sy = 0; sz = gz; }
        if (sx * gx + sz * gz < 0) { sx = -sx; sy = -sy; sz = -sz; }      // on the grass side's side: no twist
        if (Number.isNaN(px)) { px = gx; py = 0; pz = gz; }
        const w = sstep(0.08, 0.3, m);                                       // collapsing: hold the last good side
        sx = px + (sx - px) * w; sy = py + (sy - py) * w; sz = pz + (sz - pz) * w;
        const l2 = Math.hypot(sx, sy, sz) || 1; sx /= l2; sy /= l2; sz /= l2;
        f[i * 3] = sx; f[i * 3 + 1] = sy; f[i * 3 + 2] = sz; px = sx; py = sy; pz = sz;
      }
      return { g, f };
    }
  });
  return <><primitive object={res.shadow.mesh} /><primitive object={res.trail.mesh} /><primitive object={res.drop.mesh} /><primitive object={rib.ground.mesh} /><primitive object={rib.air.mesh} /></>;
}
