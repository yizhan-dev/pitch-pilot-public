import * as THREE from 'three';
import type { PathPt } from './path';
import { VOM, VOM_HALF, vomLat, vomRange, inRange, type VomGate } from './layout';

// The vomitories' geometry (fourth version, see VOM in layout.ts): a box at the head of a gangway whose level roof runs
// back into the rake, a doorway in its front, and a lit passage behind. Darker than the light grey bands so it sits in
// the seating rather than on it (Yi: "slightly darker so it looks more resonant"). The tiers' cells inside each box are
// cut away by the tiers themselves (vomCut, used in Procedural.tsx and TopTier.tsx).

type Frame = { x: number; y: number; nx: number; ny: number; corner: boolean };
/** a tier as the box needs it: row r's tread at a frame (d of its front edge, h of its surface; the frame matters where
 *  the rows are remapped, as in the lower tier's corners), the rise per row, and where the box sits: floor on row r0's
 *  tread, roof meeting the tread `rows` rows behind */
export type VomTier = { row: (r: number, f: Frame) => { d: number; h: number }; rise: number; r0: number; rows: number };

const C = {
  face: new THREE.Color('#7a8089'), top: new THREE.Color('#5c626a'),
  // the passage, lit at night but kept low: warm grey, dimmer inwards, the concourse wall at its end
  floor: new THREE.Color('#4f4a43'), wall: new THREE.Color('#5f5950'), ceil: new THREE.Color('#6d665b'), strip: new THREE.Color('#e8dcc6'), end: new THREE.Color('#3f3a34'),
};

/** the base point and outward normal at arc length s on a uniformly sampled path, the normal blended on the corners */
function frameAt(path: PathPt[], s: number): Frame {
  const n = path.length, per = path[1].s * n, t = ((s % per) + per) % per;
  const i = Math.min(n - 1, Math.floor(t / path[1].s)), p = path[i], q = path[(i + 1) % n], f = (t - p.s) / path[1].s;
  const nx = p.nx + (q.nx - p.nx) * f, ny = p.ny + (q.ny - p.ny) * f, l = Math.hypot(nx, ny);
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, nx: nx / l, ny: ny / l, corner: p.corner && q.corner };
}

/** What a tier cuts for its gates: the arc lengths where its path needs samples (each box wall on each cut row), whether a
 *  row's tread or riser at base arc length s is inside a box, and whether a seat is too close to one. The box takes row
 *  r0's tread up to the last tread under its roof, and the risers between. */
export function vomCut(path: PathPt[], gates: VomGate[], T: VomTier) {
  const R = gates.map((g) => { const f = frameAt(path, g.s); return Array.from({ length: T.rows }, (_, k) => vomRange(g, T.row(T.r0 + k, f).d)); });
  const breaks = [...new Set(R.flat(2).map((x) => +x.toFixed(5)))];
  const cell = (s: number, r: number, kind: 'tread' | 'riser') =>
    (kind === 'tread' ? r >= T.r0 : r > T.r0) && r < T.r0 + T.rows && R.some((rows) => inRange(s, rows[r - T.r0]));
  const seat = (s: number, r: number, d: number) => r >= T.r0 && r < T.r0 + T.rows && gates.some((g) => Math.abs(vomLat(g, s, d)) < VOM_HALF + 0.35);
  return { breaks, cell, seat };
}

/** the boxes for one tier at the given gates: exterior faces (lit) and the passage (unlit), as vertex-coloured triangle
 *  soups appended to ext and int */
export function addVomitories(path: PathPt[], gates: VomGate[], T: VomTier, ext: { pos: number[]; col: number[] }, int: { pos: number[]; col: number[] }) {
  const a = VOM.w / 2, b = VOM_HALF;
  for (const g of gates) {
    // the frame on the gangway's centre line, the box's axis (radial on a corner)
    const f = frameAt(path, g.s), tx = -f.ny, ty = f.nx, F = T.row(T.r0, f), Rw = T.row(T.r0 + T.rows, f);
    const d0 = F.d, hf = F.h, d1 = Rw.d, hb = Rw.h, hc = hf + VOM.door, dEnd = d1 + 2.5, slope = (hb - hf) / (d1 - d0);
    const low = (d: number) => hf - T.rise - 0.1 + (d - d0) * slope;            // the cheeks' lower edge, always under the treads
    const fade = (base: THREE.Color, d: number) => base.clone().multiplyScalar(1 - 0.6 * THREE.MathUtils.smoothstep(d, d0 + 0.3, dEnd));
    const P = (u: number, d: number, h: number) => [f.x + tx * u + f.nx * d, h, f.y + ty * u + f.ny * d];
    const quad = (o: { pos: number[]; col: number[] }, c: [number, number, number][], cols: THREE.Color[]) => {
      const v = c.map(([u, d, h]) => P(u, d, h));
      for (const k of [0, 1, 2, 0, 2, 3]) { o.pos.push(...v[k]); o.col.push(cols[k].r, cols[k].g, cols[k].b); }
    };
    const E = (c: [number, number, number][], col: THREE.Color) => quad(ext, c, [col, col, col, col]);
    // the front: lintel and jambs, facing the pitch
    E([[-b, d0, hc], [b, d0, hc], [b, d0, hb], [-b, d0, hb]], C.face);
    E([[-b, d0, hf], [-a, d0, hf], [-a, d0, hc], [-b, d0, hc]], C.face);
    E([[a, d0, hf], [b, d0, hf], [b, d0, hc], [a, d0, hc]], C.face);
    // the level roof, flush with the tread behind; the cheeks above the seats beside the box
    E([[-b, d0, hb], [-b, d1, hb], [b, d1, hb], [b, d0, hb]], C.top);
    for (const u of [-b, b]) E([[u, d0, low(d0)], [u, d1, low(d1)], [u, d1, hb], [u, d0, hb]], C.face);
    // the passage, in steps along its depth, a light strip down the ceiling, the far end
    const N = 6;
    for (let k = 0; k < N; k++) {
      const da = d0 + (dEnd - d0) * k / N, db = d0 + (dEnd - d0) * (k + 1) / N;
      const I = (c: [number, number, number][], base: THREE.Color) => quad(int, c, c.map(([, d]) => fade(base, d)));
      I([[-a, da, hf], [a, da, hf], [a, db, hf], [-a, db, hf]], C.floor);
      I([[-a, da, hf], [-a, db, hf], [-a, db, hc], [-a, da, hc]], C.wall);
      I([[a, da, hf], [a, db, hf], [a, db, hc], [a, da, hc]], C.wall);
      I([[-a, da, hc], [a, da, hc], [a, db, hc], [-a, db, hc]], C.ceil);
      I([[-0.1, da, hc - 0.01], [0.1, da, hc - 0.01], [0.1, db, hc - 0.01], [-0.1, db, hc - 0.01]], C.strip);
    }
    quad(int, [[-a, dEnd, hf], [a, dEnd, hf], [a, dEnd, hc], [-a, dEnd, hc]], [C.end, C.end, C.end, C.end]);
  }
}

export function soupGeometry(o: { pos: number[]; col: number[] }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
  g.computeVertexNormals(); return g;
}
