import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { withBreaks, type PathPt } from './path';
import { HX, HY, RC, ROOF, TOP, GREY_BAND, VOM_TIER, VOM_GATES, vomRange, gangwayRanges, inGangway } from './layout';
import { Vomitories } from './Vomitories';
import { vomCut, type VomTier } from './vomBuild';
import { STADIUM_CURRENT, type CrystalParams } from './crystalParams';
import { shellCeiling } from './shellCeiling';

// The third tier: cantilevered over the back of the upper tier, as in a real three-tier stand. It fills the space under
// the roof wherever the roof leaves room: full on the long sides, where the roof is high, and stepping down into the
// corners, where the roof comes down. Each row is kept only if a standing spectator clears the shell above it. At the
// ends the back rows stop first, one row every 1.8 m, down to a single row: an even diagonal staircase under the
// descending roof (Yi, 2026-10-22, option B of four; before it the rows dropped from 10 to 4 within 6 m and stopped at a
// flat grey end, which "just stops suddenly". The other options, a sweep and an end wall, are kept in
// <private-workspace>). Past the last row the tier's front runs on round the
// goal ends as a ring with no seats (Yi, same day: "make the third floor's grey ring continue ... but for the north and
// south do not add any seats"): the same fascia and grey band on a wedge-shaped beam, dipping under the lower roof there.
const dRow = (j: number) => TOP.d0 + j * TOP.tread;
const hRow = (j: number) => TOP.h0 + j * TOP.rise;          // the riser of row j starts here; its tread is at hRow(j + 1)
const soffit = (d: number) => TOP.h0 - TOP.fascia + (d - TOP.d0) * TOP.rise / TOP.tread;

const COL = {
  tread: new THREE.Color('#1c2740'), tread2: new THREE.Color('#223052'), riser: new THREE.Color('#353b45'),
  fascia: new THREE.Color('#b9bdc2'), dark: new THREE.Color('#0e1116'), soffit: new THREE.Color('#14171d'), back: new THREE.Color('#14171d'),
};

/** rows at each path point: what fits under the shell, as an even staircase at the ends (rakeCounts) */
function rowCounts(path: PathPt[], crystal: CrystalParams) {
  const ceil = shellCeiling(crystal, HX, HY, RC, ROOF.back), n = path.length, raw = new Array(n).fill(0);
  path.forEach((p, i) => {
    let k = 0;
    for (let j = 0; j < TOP.maxRows; j++) {
      const dd = dRow(j + 1), x = p.x + p.nx * dd, z = p.y + p.ny * dd;
      if (dd > ROOF.back - 0.9 || ceil.at(x, z) < hRow(j + 1) + TOP.head) break;
      k = j + 1;
    }
    raw[i] = k;
  });
  // On a mirror-symmetric shell the two halves fit the same rows, up to the roof mesh's diagonals and the 1 m field; take
  // the lower of each mirrored pair so the tier ends at the same place north and south. (The path starts at the middle
  // of the north side, so sample i mirrors to n/2 - i.) An asymmetric shell (v0) differs on long stretches; leave it.
  const mir = (i: number) => (((n / 2 - i) % n) + n) % n, same = raw.filter((k, i) => k === raw[mir(i)]).length / n;
  (window as unknown as { __topMirror?: number }).__topMirror = +same.toFixed(3);
  if (n % 2 === 0 && same > 0.95) raw.forEach((k, i) => { raw[i] = Math.min(k, raw[mir(i)]); });
  const rows = rakeCounts(raw, 2), top = ringTop(path, rows, ceil.at);
  ceil.dispose();
  return { rows, top };
}

/** The ring's depth: the beam that carries the front past the last row is a wedge, the fascia in front and the soffit
 *  rising at the tier's rake until it meets the flat top. */
const RING_D = TOP.fascia * TOP.tread / TOP.rise;
/** The front's top at each path point: TOP.h0 wherever there are rows; past them the ring keeps 0.6 m under the roof's
 *  underside over its depth, and changes height at most 0.1 m per metre (a slope-limited lower envelope, then a
 *  moving average, then clamped to keep at least 0.25 m clear), so it dips into the goal ends in one easy curve. */
function ringTop(path: PathPt[], rows: number[], ceilAt: (x: number, z: number) => number) {
  const n = path.length, step = path[1].s;
  const C = path.map((p) => Math.min(...[0, 0.5, 1].map((u) => ceilAt(p.x + p.nx * (TOP.d0 + u * RING_D), p.y + p.ny * (TOP.d0 + u * RING_D)))));
  const target = path.map((_, i) => (rows[i] > 0 ? TOP.h0 : Math.min(TOP.h0, C[i] - 0.6)));
  const W = Math.round(20 / step), env = target.map((_, i) => {
    let m = Infinity; for (let o = -W; o <= W; o++) m = Math.min(m, target[(i + o + n) % n] + 0.1 * step * Math.abs(o)); return m;
  });
  const A = Math.round(5 / step);
  return env.map((_, i) => {
    if (rows[i] > 0) return TOP.h0;
    let sum = 0; for (let o = -A; o <= A; o++) sum += rows[(i + o + n) % n] > 0 ? TOP.h0 : env[(i + o + n) % n];
    return Math.min(sum / (2 * A + 1), C[i] - 0.25, TOP.h0);
  });
}

/** the largest staircase under the roof that drops at most one row every `k` samples (a slope-limited lower envelope of
 *  the raw counts, so the rows end on a constant diagonal whatever the roof does), down to a single row */
function rakeCounts(raw: number[], k: number) {
  const n = raw.length, out = new Array(n).fill(0), W = k * (TOP.maxRows + 1);
  for (let i = 0; i < n; i++) { let m = Infinity; for (let o = -W; o <= W; o++) m = Math.min(m, raw[(i + o + n) % n] + Math.floor(Math.abs(o) / k)); out[i] = Math.min(TOP.maxRows, m); }
  return out;
}

/** skip(a, b, j, kind): leave out row j's tread or riser between path points a and b (the vomitories) */
/** top: the front's top at each path point (ringTop) */
function topGeometry(path: PathPt[], rows: number[], top: number[], skip?: (a: PathPt, b: PathPt, j: number, kind: 'tread' | 'riser') => boolean) {
  const pos: number[] = [], col: number[] = [], idx: number[] = [], n = path.length;
  const P = (p: PathPt, d: number, h: number) => [p.x + p.nx * d, h, p.y + p.ny * d] as const;
  const quad = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], color: THREE.Color) => {
    const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d);
    for (let m = 0; m < 4; m++) col.push(color.r, color.g, color.b);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  for (let i = 0; i < n; i++) {
    const a = path[i], b = path[(i + 1) % n], na = rows[i], nb = rows[(i + 1) % n], m = Math.min(na, nb);
    if (m > 0) {
      // the front: a dark fascia below, the light grey band on top, as on every tier
      quad(P(a, TOP.d0, TOP.h0 - TOP.fascia), P(b, TOP.d0, TOP.h0 - TOP.fascia), P(b, TOP.d0, TOP.h0 - GREY_BAND), P(a, TOP.d0, TOP.h0 - GREY_BAND), COL.dark);
      quad(P(a, TOP.d0, TOP.h0 - GREY_BAND), P(b, TOP.d0, TOP.h0 - GREY_BAND), P(b, TOP.d0, TOP.h0), P(a, TOP.d0, TOP.h0), COL.fascia);
      for (let j = 0; j < m; j++) {
        if (!skip?.(a, b, j, 'riser')) quad(P(a, dRow(j), hRow(j)), P(b, dRow(j), hRow(j)), P(b, dRow(j), hRow(j + 1)), P(a, dRow(j), hRow(j + 1)), COL.riser);
        if (!skip?.(a, b, j, 'tread')) quad(P(a, dRow(j), hRow(j + 1)), P(b, dRow(j), hRow(j + 1)), P(b, dRow(j + 1), hRow(j + 1)), P(a, dRow(j + 1), hRow(j + 1)), j % 2 ? COL.tread : COL.tread2);
        quad(P(a, dRow(j), soffit(dRow(j))), P(b, dRow(j), soffit(dRow(j))), P(b, dRow(j + 1), soffit(dRow(j + 1))), P(a, dRow(j + 1), soffit(dRow(j + 1))), COL.soffit);
      }
      // the back: a wall from the soffit up past the last row
      const db = dRow(m), hb = hRow(m);
      quad(P(a, db, soffit(db)), P(b, db, soffit(db)), P(b, db, hb + 2.2), P(a, db, hb + 2.2), COL.back);
    } else {
      // the ring past the last row: fascia and grey band at the front, the flat top, the soffit rising to meet it
      const ta = top[i], tb = top[(i + 1) % n], D = TOP.d0 + RING_D;
      quad(P(a, TOP.d0, ta - TOP.fascia), P(b, TOP.d0, tb - TOP.fascia), P(b, TOP.d0, tb - GREY_BAND), P(a, TOP.d0, ta - GREY_BAND), COL.dark);
      quad(P(a, TOP.d0, ta - GREY_BAND), P(b, TOP.d0, tb - GREY_BAND), P(b, TOP.d0, tb), P(a, TOP.d0, ta), COL.fascia);
      quad(P(a, TOP.d0, ta), P(b, TOP.d0, tb), P(b, D, tb), P(a, D, ta), COL.back);
      quad(P(a, TOP.d0, ta - TOP.fascia), P(b, TOP.d0, tb - TOP.fascia), P(b, D, tb), P(a, D, ta), COL.soffit);
      // where the rows start, close the wedge's section
      for (const [q, k] of [[a, na], [b, nb]] as const) if (k > 0) quad(P(q, TOP.d0, TOP.h0 - TOP.fascia), P(q, D, TOP.h0), P(q, D, TOP.h0), P(q, TOP.d0, TOP.h0), COL.back);
    }
    // where the row count changes, a light grey cheek closes the side of the extra rows
    if (na !== nb) {
      const q = na > nb ? a : b, lo = Math.min(na, nb), hi = Math.max(na, nb);
      for (let j = lo; j < hi; j++) {
        const d0 = dRow(j), d1 = dRow(j + 1);
        quad(P(q, d0, soffit(d0)), P(q, d1, soffit(d1)), P(q, d1, hRow(j + 1)), P(q, d0, hRow(j + 1)), COL.fascia);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** the gangways' spans for this tier's rows (layout GANGWAYS) */
const AISLES = gangwayRanges(TOP.d0 + 5 * TOP.tread);

/** the top tier's crowd: one dot per seat at a constant pitch along each row, only where that row exists */
function topCrowd(path: PathPt[], rows: number[], seed: number, skip?: (s: number, row: number) => boolean) {
  const pos: number[] = [], col: number[] = [], spos: number[] = [], n = path.length, per = path[1].s * n;
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const front = new THREE.Color('#bcd2f0'), back = new THREE.Color('#566a92'), att = new THREE.Color('#3987e5'), def = new THREE.Color('#d95926'), c = new THREE.Color();
  for (let j = 0; j < TOP.maxRows; j++) {
    const D = dRow(j) + 0.3, v = j / (TOP.maxRows - 1);
    const Pt = path.map((p) => [p.x + p.nx * D, p.y + p.ny * D]), arc = [0];
    for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + Math.hypot(Pt[i % n][0] - Pt[i - 1][0], Pt[i % n][1] - Pt[i - 1][1]));
    const total = arc[n], count = Math.floor(total / 0.58);
    for (let k = 0, i = 0; k < count; k++) {
      const t = (k + 0.5) * total / count; while (i < n - 1 && arc[i + 1] < t) i++;
      if (rows[i] <= j || rows[(i + 1) % n] <= j) continue;
      const f = (t - arc[i]) / ((arc[i + 1] - arc[i]) || 1), a = path[i], b = path[(i + 1) % n];
      const sBase = a.s + ((i + 1 === n ? per : b.s) - a.s) * f;
      if (inGangway(sBase, AISLES)) continue;
      if (skip?.(sBase, j)) continue;
      const x = Pt[i][0] + (Pt[(i + 1) % n][0] - Pt[i][0]) * f, z = Pt[i][1] + (Pt[(i + 1) % n][1] - Pt[i][1]) * f, h = hRow(j + 1);
      if (rnd() > 0.86) { spos.push(x, h + 0.3, z); continue; }
      pos.push(x, h + 0.55, z);
      c.copy(front).lerp(back, v * 0.8 + 0.1 * rnd());
      const tt = rnd(); if (tt < 0.12) c.lerp(att, 0.55); else if (tt < 0.2) c.lerp(def, 0.55);
      col.push(c.r, c.g, c.b);
    }
  }
  const people = new THREE.BufferGeometry(); people.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); people.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const empty = new THREE.BufferGeometry(), ec: number[] = [], sc = new THREE.Color('#3b4a63');
  for (let k = 0; k < spos.length / 3; k++) ec.push(sc.r, sc.g, sc.b);
  empty.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3)); empty.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3));
  return { people, empty };
}

/** the third tier as the vomitories see them: row r's tread starts at dRow(r), its surface is at hRow(r + 1) */
const VOM_TOP: VomTier = { row: (r) => ({ d: dRow(r), h: hRow(r + 1) }), rise: TOP.rise, ...VOM_TIER.top };

/** with the vomitories at the straights' gates where the tier has every row each box needs */
export function TopTier({ path, clip, crowdMat, seatMat, crystal = STADIUM_CURRENT }: {
  path: PathPt[]; clip: THREE.Plane[]; crowdMat: THREE.ShaderMaterial; seatMat: THREE.ShaderMaterial; crystal?: CrystalParams;
}) {
  const parts = useMemo(() => {
    const t0 = performance.now(), { rows, top } = rowCounts(path, crystal);
    (window as unknown as { __topRows?: unknown }).__topRows = { max: Math.max(...rows), share: +(rows.filter((k) => k > 0).length / rows.length).toFixed(2), ms: Math.round(performance.now() - t0) };
    // a gate fits where every sample across its box, a metre either side, has the box's rows and the one its roof meets
    const n = path.length, step = path[1].s, need = VOM_TOP.r0 + VOM_TOP.rows + 1;
    const gates = VOM_GATES.filter((g) => {
      if (g.corner) return false;
      const [lo, hi] = vomRange(g, 0);
      for (let x = lo - 1; x <= hi + 1; x += step / 2) { const i = ((Math.floor(x / step) % n) + n) % n; if (rows[i] < need || rows[(i + 1) % n] < need) return false; }
      return true;
    });
    const cut = vomCut(path, gates, VOM_TOP), fine = withBreaks(path, cut.breaks), src = fine.src!;
    const fineRows = src.map((k) => (k >= 0 ? rows[k] : Math.min(rows[-1 - k], rows[(-k) % n])));
    const fineTop = src.map((k) => (k >= 0 ? top[k] : Math.min(top[-1 - k], top[(-k) % n])));
    const skip = (a: PathPt, b: PathPt, j: number, kind: 'tread' | 'riser') => cut.cell(a.s, j, kind) && cut.cell(b.s, j, kind);
    return { geo: topGeometry(fine, fineRows, fineTop, skip), crowd: topCrowd(path, rows, 23, (s, j) => cut.seat(s, j, dRow(j) + 0.3)), vomTiers: [{ tier: VOM_TOP, gates }] };
  }, [path, crystal]);
  useEffect(() => () => { parts.geo.dispose(); parts.crowd.people.dispose(); parts.crowd.empty.dispose(); }, [parts]);
  return (
    <group>
      <mesh geometry={parts.geo}><meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} clippingPlanes={clip} /></mesh>
      <points geometry={parts.crowd.people} material={crowdMat} />
      <points geometry={parts.crowd.empty} material={seatMat} />
      {parts.vomTiers.length > 0 && <Vomitories path={path} clip={clip} tiers={parts.vomTiers} />}
    </group>
  );
}
