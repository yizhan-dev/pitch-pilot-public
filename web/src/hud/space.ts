import { clipFile, clipAddr, inMatch, MATCH } from '../data/paths';
// The 战术 mode's space family, precalculated at export with Yi's notebook model (Yi, 2026-10-24; docs/plans/space-
// metrics.md in the main tree): Fernández & Bornn pitch control, the space value V learned from where the defenders stand
// for a ball position ("defense as a sensor", trained on this match), Q = PC x V, each player's Q and its change over the
// last second, and the space-generation events (private/hawkeye/space_core.py, space_export.py, from the 25 Hz Hawk-Eye
// tracking). Each clip has <id>.space.json (the header, the card's windows, the events) and <id>.space.bin (per 10 Hz
// frame: the maps and the per-player numbers) beside its package. Package metres, the clip's attackers attacking +x.
// Shown: pitch control and Q. Retired by Yi (2026-10-24): V as a map of its own (it stays inside Q) and SOG / SOL / SGG;
// the export still carries their numbers (windows, sgg, dq), which nothing reads; the code that drew them is in
// <private-workspace>
import { useEffect, useState } from 'react';
import type { ClipPkg } from './match';
import type { Team } from '../three/coords';

interface Block { name: string; offset: number; dtype: 'u1' | 'u2' | 'i2'; shape: number[] }
/** a grid over the pitch: nx by ny, from (x0, y0), w by h metres */
export interface SpaceGrid { nx: number; ny: number; x0: number; y0: number; w: number; h: number }
/** one of the notebook's occupation windows (cell 61) inside the clip: seconds of clip time, the side on the ball (1 the
 *  clip's attackers, 2 the defenders), each of its players' change in Q, and its space-generation events */
export interface SpaceWindow { t0: number; t1: number; side: 1 | 2; dq: [number, number][]; sg: [number, number, number[], number][] }
export interface SpaceHead {
  version: number; id: string; half: number; half_t0: number; frames: number; fps: number; players: number; n_att: number;
  bin: { file: string; bytes: number; layout: Block[] };
  /** pitch control on cell centres, the clip's attackers' share */
  pc: SpaceGrid;
  /** space value on nodes (corners included), for the side on the ball */
  v: SpaceGrid;
  /** the threshold on a change in Q over one second (k-means on this match's windows, notebook cell 66) */
  eps: number;
  window_s: number;
  scale: { q: number; dq: number };
  model: { trained_on: string; samples: number; epochs: number; train_mse: number; eps: { value: number; centroids: number[]; values: number; windows: number } };
  windows: SpaceWindow[];
  /** space generation on the sliding second, every 0.1 s: [frame, generator, receiver, defenders, receiver's change in Q] */
  sgg: [number, number, number, number[], number][];
}
export interface Space {
  head: SpaceHead;
  pc: Uint8Array; v: Uint8Array;
  /** the side on the ball (0 none, 1 attackers, 2 defenders), now, held through none, and at the start of the last second */
  poss: Uint8Array; held: Uint8Array; wposs: Uint8Array;
  /** 1 where the ball was tracked (no map otherwise) */
  ok: Uint8Array;
  q: Uint16Array; dq: Int16Array;
}

const cache = new Map<string, Promise<Space | null>>();
const clipId = (pkg: ClipPkg) => (pkg.meta as { id?: string }).id ?? null;

/** a clip's space family, fetched once; null when it was not exported, or the clip was exported again since (its frames
 *  no longer line up) */
export function loadSpace(pkg: ClipPkg): Promise<Space | null> {
  const id = clipId(pkg);
  if (!id) return Promise.resolve(null);
  let pending = cache.get(id);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(clipFile(clipAddr(id, pkg.teams?.match ?? MATCH), '.space.json'));
      if (!response.ok) return null;
      const head = await response.json() as SpaceHead;
      const t0 = (pkg as { half_t0?: number }).half_t0;
      if (head.frames !== pkg.frames.length || (t0 !== undefined && Math.abs(head.half_t0 - t0) > 1e-6)) return null;
      const buffer = await (await fetch(inMatch(head.bin.file, pkg.teams?.match ?? MATCH))).arrayBuffer();
      const block = (name: string) => {
        const b = head.bin.layout.find((x) => x.name === name);
        if (!b) throw new Error(`space ${id}: no block ${name}`);
        const n = b.shape.reduce((a, x) => a * x, 1);
        return b.dtype === 'u1' ? new Uint8Array(buffer, b.offset, n) : b.dtype === 'u2' ? new Uint16Array(buffer, b.offset, n) : new Int16Array(buffer, b.offset, n);
      };
      return {
        head, pc: block('pc') as Uint8Array, v: block('v') as Uint8Array, poss: block('poss') as Uint8Array, held: block('held') as Uint8Array,
        wposs: block('wposs') as Uint8Array, ok: block('ok') as Uint8Array, q: block('q') as Uint16Array, dq: block('dq') as Int16Array,
      };
    })().catch(() => null);
    cache.set(id, pending);
  }
  return pending;
}

/** the clip's space family once loaded (null meanwhile, when switched off, or when the clip has none) */
export function useSpace(pkg: ClipPkg, enabled = true): Space | null {
  const [loaded, setLoaded] = useState<Space | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    loadSpace(pkg).then((s) => { if (live) setLoaded(s); });
    return () => { live = false; };
  }, [pkg, enabled]);
  return enabled && loaded && loaded.head.id === clipId(pkg) ? loaded : null;
}

// ---- the base maps
export type SpaceMapKey = 'pc' | 'v' | 'q';
/** Q is "controlled Q" (Yi, 2026-10-25: "do what you recommend"): max(0, 2 PC - 1) x V, the valuable ground the side on
 *  the ball clearly controls, 0 at 50/50. The notebook's Q (PC x V) is about half of V on the 84% of cells within 40-60%
 *  control (Q and V correlate 0.95 over the cells), so it mostly repeated V, which Yi had removed as a map */

/** for each pitch-control cell, its bilinear weights on the space-value nodes (both grids are fixed by the export) */
let vWeights: { grid: string; i: Int32Array; w: Float32Array } | null = null;
function weightsFor(pc: SpaceGrid, v: SpaceGrid) {
  const key = JSON.stringify([pc, v]);
  if (vWeights?.grid === key) return vWeights;
  const n = pc.nx * pc.ny, i = new Int32Array(n * 4), w = new Float32Array(n * 4);
  for (let r = 0; r < pc.ny; r++) for (let c = 0; c < pc.nx; c++) {
    const x = pc.x0 + (c + 0.5) * pc.w / pc.nx, y = pc.y0 + (r + 0.5) * pc.h / pc.ny;
    const fx = Math.min(v.nx - 1, Math.max(0, (x - v.x0) / v.w * (v.nx - 1))), fy = Math.min(v.ny - 1, Math.max(0, (y - v.y0) / v.h * (v.ny - 1)));
    const x0 = Math.min(v.nx - 2, Math.floor(fx)), y0 = Math.min(v.ny - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0, o = (r * pc.nx + c) * 4;
    i[o] = y0 * v.nx + x0; i[o + 1] = y0 * v.nx + x0 + 1; i[o + 2] = (y0 + 1) * v.nx + x0; i[o + 3] = (y0 + 1) * v.nx + x0 + 1;
    w[o] = (1 - tx) * (1 - ty); w[o + 1] = tx * (1 - ty); w[o + 2] = (1 - tx) * ty; w[o + 3] = tx * ty;
  }
  vWeights = { grid: key, i, w };
  return vWeights;
}

/** one frame's map on the pitch-control cells, 0..1: pitch control as the attackers' share; V for the side on the ball
 *  (bilinear from its nodes); Q = the pitch control of the side on the ball x V (notebook cell 56) */
function frameMap(sp: Space, key: SpaceMapKey, k: number, out: Float32Array, weight: number) {
  const { pc, v } = sp.head, n = pc.nx * pc.ny, nv = v.nx * v.ny, pcBase = k * n, vBase = k * nv;
  const wt = key === 'pc' ? null : weightsFor(pc, v), attackers = sp.held[k] !== 2;
  for (let i = 0; i < n; i++) {
    let value = sp.pc[pcBase + i] / 255;
    if (wt) {
      const o = i * 4;
      const val = (sp.v[vBase + wt.i[o]] * wt.w[o] + sp.v[vBase + wt.i[o + 1]] * wt.w[o + 1] + sp.v[vBase + wt.i[o + 2]] * wt.w[o + 2] + sp.v[vBase + wt.i[o + 3]] * wt.w[o + 3]) / 255;
      const share = attackers ? value : 1 - value;
      value = key === 'v' ? val : Math.max(0, 2 * share - 1) * val;
    }
    out[i] += weight * value;
  }
}

/** a base map at clip time t on the pitch-control grid (row 0 at y = -34), blended between the two 10 Hz frames round t;
 *  null where the ball was not tracked at either */
export function spaceMap(sp: Space, key: SpaceMapKey, t: number): Float32Array | null {
  const frames = sp.head.frames, x = Math.min(frames - 1, Math.max(0, t * sp.head.fps));
  const k0 = Math.floor(x), k1 = Math.min(frames - 1, k0 + 1), ok0 = sp.ok[k0] === 1, ok1 = sp.ok[k1] === 1;
  if (!ok0 && !ok1) return null;
  const f = !ok0 ? 1 : !ok1 ? 0 : x - k0, out = new Float32Array(sp.head.pc.nx * sp.head.pc.ny);
  if (f < 1) frameMap(sp, key, k0, out, 1 - f);
  if (f > 0) frameMap(sp, key, k1, out, f);
  return out;
}

/** the side on the ball at clip time t, as V and Q follow it (held through 'none'): 1 the clip's attackers, 2 the
 *  defenders */
export function spaceSide(sp: Space, t: number): 1 | 2 {
  const k = Math.min(sp.head.frames - 1, Math.max(0, Math.round(t * sp.head.fps)));
  return sp.held[k] === 2 ? 2 : 1;
}

// ---- pitch control as a contour map (Yi, 2026-10-24: "can we do it in contour map like display?"; the notebook draws pitch
// control with contourf, cell 46), drawn on the GPU by BaseMap3D.tsx since 2026-10-25 (smooth at any zoom)
/** bands on each side of 50/50 (Yi, 2026-10-25: "more layers", then "can we choose 24 layers too": 24; 6 before) */
export const PC_BANDS = 24;

/** where Q reaches full colour on the board: about its 99th percentile over the 20 demo clips' cells (measured
 *  2026-10-24 every 0.5 s: controlled Q p95 0.059, p99 0.137, max 0.50; the notebook's Q was p99 0.30). Fixed, so a map's
 *  strength means the same thing from frame to frame and clip to clip */
export const Q_FULL = 0.14;

// ---- the xT map (Yi, 2026-10-27), drawn by BaseMap3D: the value's strength t runs on a log scale from XT_FLOOR (clear below
// it: about the halfway line's cells, 0.01-0.015, so the own half stays the board) to the highest cell (0.373). Two colourways
// for Yi's eye (temporary, ?xtcolour=heat): gold, the maps' gold with the alpha on t and the top brightened to a pale yellow;
// heat, a magma-like ramp from a dark violet through red and orange to a pale yellow
/** the maps' gold (Q, Yi 2026-10-26: A; the xT map) and the pale yellow its top brightens to; the gold's alpha at the top */
export const MAP_GOLD: [number, number, number] = [255, 209, 102], XT_PALE: [number, number, number] = [255, 242, 196];
export const XT_ALPHA = 0.75;
export const XT_FLOOR = 0.015;
/** the heat colourway's stops: t, sRGB, alpha */
export const XT_HEAT: { t: number; rgb: [number, number, number]; a: number }[] = [
  { t: 0, rgb: [30, 12, 60], a: 0 }, { t: 0.3, rgb: [120, 30, 110], a: 0.35 }, { t: 0.6, rgb: [230, 80, 60], a: 0.7 },
  { t: 0.85, rgb: [250, 170, 60], a: 0.8 }, { t: 1, rgb: [252, 240, 170], a: 0.9 },
];
export const XT_COLOUR: 'gold' | 'heat' = new URLSearchParams(location.search).get('xtcolour') === 'heat' ? 'heat' : 'gold';
/** the xT legend's bar: the colourway's ramp laid along the bar, the floor on the left */
export function xtLegendBar(): string {
  const css = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(2)})`;
  if (XT_COLOUR === 'heat') return `linear-gradient(90deg, ${XT_HEAT.map((s) => `${css(s.rgb, Math.max(s.a, 0.06))} ${Math.round(s.t * 100)}%`).join(', ')})`;
  return `linear-gradient(90deg, ${css(MAP_GOLD, 0.06)}, ${css(MAP_GOLD, XT_ALPHA * 0.7)} 70%, ${css(XT_PALE, XT_ALPHA)})`;
}

// ---- the pitch-control look on the dark board (Yi, 2026-10-24: A of four candidates, the kits' colours as before;
// <private-workspace>)
/** the kits' lighter tones */
const KIT_LIGHT: Record<Team, [number, number, number]> = { home: [106, 184, 255], away: [255, 149, 96] };

/** a cell's colour and alpha (0..1) for the attackers' share of it: the side ahead in its kit's colour, stronger the further
 *  ahead, clear at 50/50 */
export function pcColour(share: number, att: Team, def: Team): [number, number, number, number] {
  const c = KIT_LIGHT[share >= 0.5 ? att : def];
  return [c[0], c[1], c[2], Math.abs(share - 0.5) * 2 * 0.55];
}
/** the legend's colour bar, the attackers' end on the left */
export function pcLegendBar(att: Team, def: Team): string {
  const css = (share: number) => { const [r, g, b, a] = pcColour(share, att, def); return `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.06).toFixed(2)})`; };
  return `linear-gradient(90deg, ${css(1)}, ${css(0.75)} 25%, ${css(0.5)} 50%, ${css(0.25)} 75%, ${css(0)})`;
}
