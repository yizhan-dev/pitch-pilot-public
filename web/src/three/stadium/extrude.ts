import * as THREE from 'three';
import type { PathPt, Profile } from './path';
import { inGangway } from './layout';

const COLORS = { seat: new THREE.Color('#1c2740'), seat2: new THREE.Color('#223052'), riser: new THREE.Color('#353b45'), wall: new THREE.Color('#14171d'), fascia: new THREE.Color('#0e1116'), aisle: new THREE.Color('#3a3f48'), pitchwall: new THREE.Color('#b9bdc2') };   // pitchwall: the light grey wall between the front row and the pitch

/** skip(p, j): leave out the cell between profile points j and j + 1 at path point p (for openings such as vomitories) */
/** minD(p): profile points nearer than this to the path move out to it, and the rows they belong to turn into wall */
/** mapD(p, d): remaps a profile offset at path point p (the corner setback of the lower tier) */
/** aisles: the gangways' spans on the base path (layout gangwayRanges); their steps take the aisle colour */
export function extrude(path: PathPt[], profile: Profile, opts: { aisles?: [number, number][]; skip?: (p: PathPt, j: number) => boolean; minD?: (p: PathPt) => number; mapD?: (p: PathPt, d: number) => number } = {}) {
  const nP = path.length, nQ = profile.length, pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nP; i++) {
    const p = path[i % nP], aisle = !!opts.aisles && inGangway(p.s, opts.aisles);
    for (let j = 0; j < nQ; j++) {
      const q = profile[j], m = opts.minD ? opts.minD(p) : 0, d = opts.mapD ? opts.mapD(p, Math.max(q.d, m)) : Math.max(q.d, m);
      pos.push(p.x + p.nx * d, q.h, p.y + p.ny * d);
      // a moved point is wall-coloured unless it starts a tread that survives (its next point is not moved): then the
      // tread keeps its seat colour instead of fading into grey, and only the wall below takes the light grey
      const next = profile[j + 1], moved = q.d < m - 1e-6, keepsTread = moved && q.kind === 'seat' && next && next.d >= m - 1e-6;
      const k = moved && !keepsTread ? 'pitchwall' : q.kind, row = Math.floor(j / 2);
      const c = aisle && (k === 'seat' || k === 'riser') ? COLORS.aisle : k === 'seat' ? (row % 2 ? COLORS.seat : COLORS.seat2) : k === 'riser' ? COLORS.riser : k === 'fascia' ? COLORS.fascia : k === 'pitchwall' ? COLORS.pitchwall : COLORS.wall;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nP; i++) for (let j = 0; j < nQ - 1; j++) {
    if (opts.skip && opts.skip(path[i], j) && opts.skip(path[(i + 1) % nP], j)) continue;
    const a = i * nQ + j, b = (i + 1) * nQ + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
