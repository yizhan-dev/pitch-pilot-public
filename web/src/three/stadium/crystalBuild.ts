// The crystal envelope's geometry, apart from its React component so edits hot-refresh in place. See Crystal.tsx.
import * as THREE from 'three';
import type { CrystalParams } from './crystalParams';
import type { GroundPt, LandscapeSpec, PoolSpec } from './Landscape';
import type { SignAnchor } from './Sign';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';


type V2 = [number, number];
type P3 = [number, number, number];                          // data x, data y, height
const V = (x: number, y: number, h: number) => new THREE.Vector3(x, h, y);   // to three.js: (x, up, y)
const MARGIN = 2.5;                                          // clearance outside the back of the stands
const smooth01 = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
/** quintic smootherstep: zero slope and zero curvature at both ends, so curves built from it are curvature-continuous */
const smoother = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * c * (c * (6 * c - 15) + 10); };
/** a bump that rises over [0, apex] and falls over [apex, 1]; its curvature is continuous everywhere, apex included */
const bump = (u: number, apex: number) => (u < apex ? smoother(u / apex) : smoother((1 - u) / (1 - apex)));

function isect(p1: V2, d1: V2, p2: V2, d2: V2): V2 {
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/** a polygon from lines (point, direction), each vertex where line i-1 meets line i */
function polyFromLines(lines: { p: V2; d: V2 }[]): V2[] {
  return lines.map((l, i) => { const g = lines[(i - 1 + lines.length) % lines.length]; return isect(g.p, g.d, l.p, l.d); });
}

class Mesh {
  pos: number[] = []; nrm: number[] = []; uv: number[] = [];
  /** a flat triangle, wound so that its normal points along `out` */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, out: THREE.Vector3, ua: V2, ub: V2, uc: V2) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.dot(out) < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; n.negate(); }
    n.normalize();
    for (const [p, t] of [[a, ua], [b, ub], [c, uc]] as [THREE.Vector3, V2][]) { this.pos.push(p.x, p.y, p.z); this.nrm.push(n.x, n.y, n.z); this.uv.push(t[0], t[1]); }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, out: THREE.Vector3, uvs: [V2, V2, V2, V2]) {
    this.tri(a, b, c, out, uvs[0], uvs[1], uvs[2]); this.tri(a, c, d, out, uvs[0], uvs[2], uvs[3]);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/** the whole crystal envelope as geometry; exported for the bowl, which fits its top tier under the roof */
export function buildCrystalShell(P: CrystalParams, hx: number, hy: number, rc: number, back: number) {
  // ---- plan: the octagon of eave lines, just clear of the stands
  const A = hx + back + MARGIN, B = hy + back + MARGIN, R = rc + back + MARGIN, cx = hx - rc, cy = hy - rc;
  // the 45 degree cut that clears the stands' corner; the blend dips inside the cut line, hence cornerClear
  const cTan = cx + cy + (R + P.cornerClear) * Math.SQRT2;
  const cq = (k: number) => (A + B) - THREE.MathUtils.clamp(k, 0.05, 1) * (A + B - cTan);
  // the west (-x) end keeps the full cuts, a tapered nose; the east end may take smaller ones, a squarer tail
  // corner cuts NE (east, main side), NW, SW, SE. Diagonal mode rounds one diagonal pair and sharpens the other.
  const diag = P.diag > 0.5, flip = P.diagFlip > 0.5;
  const roundAt = (c: 'NE' | 'NW' | 'SW' | 'SE') => (flip ? c === 'NW' || c === 'SE' : c === 'NE' || c === 'SW');
  const cutK = (c: 'NE' | 'NW' | 'SW' | 'SE') => diag ? (roundAt(c) ? P.roundCut : P.sharpCut)
    : c === 'NE' ? P.cutMain * P.tail : c === 'NW' ? P.cutMain : c === 'SW' ? P.cutOther : P.cutOther * P.tail;
  const cMe = cq(cutK('NE')), cMw = cq(cutK('NW')), cOw = cq(cutK('SW')), cOe = cq(cutK('SE'));
  const hE1 = P.low + P.skew / 2, hE2 = P.low - P.skew / 2, hM = P.low + P.rise + P.mainRise, hO = P.low + P.rise;
  // counter-clockwise from the +x end; face 2 is the main side (+y, the broadcast side)
  const top: P3[] = [[A, -(cOe - A), hE1], [A, cMe - A, hE1], [cMe - B, B, hM], [-(cMw - B), B, hM],
    [-A, cMw - A, hE2], [-A, -(cOw - A), hE2], [-(cOw - B), -B, hO], [cOe - B, -B, hO]];
  const N = top.length, hMax = Math.max(...top.map((p) => p[2]));
  let perim = 0;
  const faces = top.map((a, i) => {
    const b = top[(i + 1) % N], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const u: V2 = [dx / len, dy / len], n: V2 = [u[1], -u[0]];
    const tn = Math.tan(THREE.MathUtils.degToRad(P.lean + (i === 2 ? P.mainLean : 0)));
    // the face plane holds the eave edge and leans out: at the lift height its line is drawn in by (h - lift) tan(lean)
    const s0: V2 = [a[0] - n[0] * (a[2] - P.lift) * tn, a[1] - n[1] * (a[2] - P.lift) * tn];
    const s1: V2 = [b[0] - n[0] * (b[2] - P.lift) * tn, b[1] - n[1] * (b[2] - P.lift) * tn];
    const f = { a, b, len, u, n, s0, s1, s: perim };
    perim += len;
    return f;
  });
  const base = polyFromLines(faces.map((f) => ({ p: f.s0, d: [f.s1[0] - f.s0[0], f.s1[1] - f.s0[1]] as V2 })));
  const pod = polyFromLines(faces.map((f) => ({ p: [f.s0[0] - f.n[0] * P.podInset, f.s0[1] - f.n[1] * P.podInset] as V2, d: [f.s1[0] - f.s0[0], f.s1[1] - f.s0[1]] as V2 })));
  const ring = (d: number) => polyFromLines(faces.map((f) => ({ p: [f.a[0] + f.n[0] * d, f.a[1] + f.n[1] * d] as V2, d: f.u })));
  const outV = (f: (typeof faces)[number]) => new THREE.Vector3(f.n[0], 0, f.n[1]);

  // ---- elevation curves. The roofline is the trapezoid through the corner heights, smoothed by a box window
  // so its shoulders round over; each face's bottom edge arches up between its two folds.
  const STEP = 0.5, nS = Math.ceil(perim / STEP), raw = new Float64Array(nS);
  for (let k = 0, i = 0; k < nS; k++) {
    const sk = k * STEP; while (i < N - 1 && faces[i + 1].s <= sk) i++;
    const f = faces[i], t = (sk - f.s) / f.len; raw[k] = f.a[2] + (f.b[2] - f.a[2]) * t;
  }
  const boxPass = (src: Float64Array, half: number) => {
    const pre = new Float64Array(3 * nS + 1), out = new Float64Array(nS);
    for (let k = 0; k < 3 * nS; k++) pre[k + 1] = pre[k] + src[k % nS];
    for (let k = 0; k < nS; k++) out[k] = (pre[k + nS + half + 1] - pre[k + nS - half]) / (2 * half + 1);
    return out;
  };
  const half = Math.max(0, Math.round(P.fillet / 2 / STEP / 1.4));
  const eaveArr = boxPass(boxPass(raw, half), half);
  const eaveH = (sv: number) => { const x = sv / STEP, k = Math.floor(x), f = x - k, a = eaveArr[((k % nS) + nS) % nS], b = eaveArr[(((k + 1) % nS) + nS) % nS]; return a + (b - a) * f; };
  const archOf = (i: number) => (i === 2 ? P.archMain : i === 6 ? P.archLong : i === 0 || i === 4 ? P.archEnd : 0);
  // three-seven: on the long sides u runs from the west end; the crest rises over [0, split] and falls over the rest
  // u along a long side, from the end where its crest is measured: the west for both, or the east for the far side when twisted
  const uWest = (i: number, t: number) => (i === 2 ? 1 - t : P.crestTwist > 0.5 ? 1 - t : t);
  const sp = THREE.MathUtils.clamp(P.split, 0.1, 0.9);
  const crest = (u: number) => bump(u, sp);
  // the arch under a face: a curvature-continuous bump, touching down flat at the folds where the legs stand
  const archSmooth = (u: number, apex: number) => Math.pow(bump(u, apex), P.archPow);
  // the hard version, after the folded volumes of the German Pavilion at Expo 2010: straight runs meeting at crisp
  // folds. On the long sides: a steep run up from the west leg, a short, nearly level high run over the three-seven
  // point, a long run down, and a last, steeper fold to the east leg. On the ends: a trapezoid.
  const knotsLong = (apex: number): [number, number][] => {
    const a = Math.max(0.06, apex - 0.1), b = Math.min(0.9, apex + 0.08), c = b + 0.62 * (1 - b);
    return [[0, 0], [a, 1], [b, 0.94], [c, 0.28], [1, 0]];
  };
  const knotsEnd: [number, number][] = [[0, 0], [0.3, 1], [0.7, 1], [1, 0]];
  const polyAt = (k: [number, number][], u: number) => {
    for (let j = 0; j < k.length - 1; j++) if (u <= k[j + 1][0]) { const f = (u - k[j][0]) / ((k[j + 1][0] - k[j][0]) || 1); return k[j][1] + (k[j + 1][1] - k[j][1]) * f; }
    return k[k.length - 1][1];
  };
  const archShape = (u: number, apex: number) => {
    const hard = polyAt(apex === 0.5 ? knotsEnd : knotsLong(apex), u);
    return P.edgeHard <= 0 ? archSmooth(u, apex) : P.edgeHard >= 1 ? hard : archSmooth(u, apex) * (1 - P.edgeHard) + hard * P.edgeHard;
  };
  const longSide = (i: number) => i === 2 || i === 6;
  const crownOf = (i: number) => (i === 2 || i === 6 ? P.crown : 0);

  // ---- the facade: a ruled surface between the eave curve and the arched base line. Along each face it is
  // that face's plane; at each fold it may blend round (cornerR); at the top it rolls over into the roof (eaveR).
  const bowOf = (i: number) => (longSide(i) ? P.bowLong : i === 0 || i === 4 ? P.bowEnd : 0);
  // the opening: a superellipse with half-axes drawn in from the eave line by openInset. A superellipse with n > 2 is a
  // rounded rectangle whose curvature changes continuously all the way round: no joins for the light line to show.
  // In diagonal mode the sharp pair's quadrants take a squarer n; at the axes every n gives the same point and tangent.
  const Ain = A - P.openInset, Bin = B - P.openInset;
  const nOf = (x: number, y: number) => {
    const c: 'NE' | 'NW' | 'SW' | 'SE' = x >= 0 ? (y >= 0 ? 'NE' : 'SE') : (y >= 0 ? 'NW' : 'SW');
    return !diag || roundAt(c) ? P.openN : P.openN + 2.5 * (1 - P.sharpCut);
  };
  const innerR = (phi: number) => {
    const c = Math.cos(phi), sn = Math.sin(phi), n = nOf(c, sn);
    return Math.pow(Math.pow(Math.abs(c) / Ain, n) + Math.pow(Math.abs(sn) / Bin, n), -1 / n);
  };
  const inH = (phi: number) => {
    const s2 = Math.sin(phi) ** 2, c = Math.cos(phi);
    return P.low - P.inDrop + (P.rise + (Math.sin(phi) > 0 ? P.mainRise : 0)) * s2 + (P.skew / 2) * c * Math.abs(c);
  };
  const innerOf = (T: THREE.Vector3) => {
    const phi = Math.atan2(T.z, T.x), r = innerR(phi), x = r * Math.cos(phi), y = r * Math.sin(phi);
    const ux = P.crestTwist > 0.5 && y < 0 ? (Ain - x) / (2 * Ain) : (x + Ain) / (2 * Ain);
    const lift3 = 0.6 * P.peak * crest(THREE.MathUtils.clamp(ux, 0, 1)) * Math.sin(Math.abs(phi)) ** 2;
    return V(x, y, inH(phi) + lift3);
  };
  const FG = faces.map((f, i) => {
    const T0 = V(f.a[0], f.a[1], f.a[2]), T1 = V(f.b[0], f.b[1], f.b[2]);
    const b0 = base[i], b1 = base[(i + 1) % N], B0 = V(b0[0], b0[1], P.lift), B1 = V(b1[0], b1[1], P.lift);
    const nrm = new THREE.Vector3().subVectors(T1, T0).cross(new THREE.Vector3().subVectors(B0, T0)).normalize();
    if (nrm.dot(outV(f)) < 0) nrm.negate();
    // the face plane, bowed out in plan by bowOf(i) * sin(pi t): a gently convex face, the same at every height
    const nh = new THREE.Vector3(f.n[0], 0, f.n[1]), u3 = new THREE.Vector3(f.u[0], 0, f.u[1]), bw = bowOf(i);
    const at = (t: number, h: number) => { const Tt = T0.clone().lerp(T1, t), Bt = B0.clone().lerp(B1, t); return Tt.lerp(Bt, (Tt.y - h) / (Tt.y - P.lift)).addScaledVector(nh, bw * Math.sin(Math.PI * t)); };
    const slope = (t: number) => bw * Math.PI * Math.cos(Math.PI * t) / f.len;
    const nAt = (t: number) => { const m = Math.hypot(nrm.x, nrm.z), hz = nh.clone().addScaledVector(u3, -slope(t)).normalize().multiplyScalar(m); return new THREE.Vector3(hz.x, nrm.y, hz.z).normalize(); };
    const tanAt = (t: number): V2 => [f.u[0] + f.n[0] * slope(t), f.u[1] + f.n[1] * slope(t)];
    const hTop = (t: number) => eaveH(f.s + t * f.len) + crownOf(i) * bump(t, 0.5) + (longSide(i) ? P.peak * crest(uWest(i, t)) : 0);
    const hBot = (t: number) => P.lift + archOf(i) * (longSide(i) ? archShape(uWest(i, t), sp) : archShape(t, 0.5));
    return { nrm, nAt, tanAt, bw, nh, T: (t: number) => at(t, hTop(t)), B: (t: number) => at(t, hBot(t)) };
  });
  // corner k sits at the start of face k; its blend half-length is limited by both faces
  const cornerOfV = (k: number): 'NE' | 'NW' | 'SW' | 'SE' => (k === 1 || k === 2 ? 'NE' : k === 3 || k === 4 ? 'NW' : k === 5 || k === 6 ? 'SW' : 'SE');
  const cl = faces.map((f, k) => {
    const lim = Math.min(f.len, faces[(k - 1 + N) % N].len);
    if (!diag) return Math.min(P.cornerR, 0.3 * lim);
    // a rounded corner's two blends nearly meet across its cut face, so the corner reads as one curve
    return roundAt(cornerOfV(k)) ? Math.min(P.roundR, 0.47 * lim) : Math.min(P.sharpR, 0.3 * lim);
  });
  /** quartic Bezier through a, the corner c and e, with its first and last three control points on the two tangents:
   *  the blend leaves each face with zero curvature, so the corner flows instead of bending at a seam */
  const bez4 = (a: THREE.Vector3, c: THREE.Vector3, e: THREE.Vector3, u: number) => {
    const w = [(1 - u) ** 4, 4 * u * (1 - u) ** 3, 6 * u * u * (1 - u) ** 2, 4 * u ** 3 * (1 - u), u ** 4];
    return a.clone().multiplyScalar(w[0]).addScaledVector(a.clone().lerp(c, 0.5), w[1]).addScaledVector(c, w[2]).addScaledVector(e.clone().lerp(c, 0.5), w[3]).addScaledVector(e, w[4]);
  };
  type Samp = { T: THREE.Vector3; B: THREE.Vector3; n: THREE.Vector3; pod: THREE.Vector3; face: number; t: number };
  const podPt = (i: number, t: number) => { const j = (i + 1) % N, o = FG[i].bw * Math.sin(Math.PI * t); return V(pod[i][0] + (pod[j][0] - pod[i][0]) * t + faces[i].n[0] * o, pod[i][1] + (pod[j][1] - pod[i][1]) * t + faces[i].n[1] * o, 0); };
  // the control point of a corner blend: where the two faces' tangents meet in plan, at the given height
  const ctrlOf = (S: THREE.Vector3, dS: V2, E: THREE.Vector3, dE: V2, fallback: THREE.Vector3, h: number) => {
    const X = isect([S.x, S.z], dS, [E.x, E.z], dE);
    return isFinite(X[0]) && isFinite(X[1]) && Math.hypot(X[0] - fallback.x, X[1] - fallback.z) < 20 ? V(X[0], X[1], h) : fallback.clone().setY(h);
  };
  const segs: Samp[][] = [];
  const cornerMid: Samp[] = [];
  const cornerFold: boolean[] = [];                         // true where the corner is a real fold, which earns a light line
  // A rounded corner (diagonal mode, blend radius 12 m or more) is one continuous curve from the long face to the end
  // face: a quintic Bezier whose control polygon runs along the two faces and the cut face between them, its second and
  // second-to-last points on the tangents, so it joins both faces with zero curvature. The cut face itself disappears.
  const radOf = (c: number) => (roundAt(cornerOfV(c)) ? P.roundR : P.sharpR);
  const merged = (c: number) => diag && c % 2 === 1 && radOf(c) >= 12;
  const mL = (c: number, len: number) => Math.min(radOf(c), 0.45 * len);
  const bez5 = (a: THREE.Vector3, f1: THREE.Vector3, f2: THREE.Vector3, e: THREE.Vector3, u: number) => {
    const w = [(1 - u) ** 5, 5 * u * (1 - u) ** 4, 10 * u * u * (1 - u) ** 3, 10 * u ** 3 * (1 - u) ** 2, 5 * u ** 4 * (1 - u), u ** 5];
    const q = [a, a.clone().lerp(f1, 0.5), f1, f2, e.clone().lerp(f2, 0.5), e];
    return q.reduce((acc, v, k) => acc.addScaledVector(v, w[k]), new THREE.Vector3());
  };
  faces.forEach((f, i) => {
    if (merged(i)) return;                                   // a merged corner's cut face: drawn by the blend below
    const g = FG[i], ip = (i - 1 + N) % N, j = (i + 1) % N;
    const ta = merged(ip) ? mL(ip, f.len) / f.len : cl[i] / f.len;
    const tb = merged(j) ? 1 - mL(j, f.len) / f.len : 1 - cl[j] / f.len;
    const K = Math.max(6, Math.ceil((tb - ta) * f.len / 1.0)), seg: Samp[] = [];
    const ts = Array.from({ length: K + 1 }, (_, k) => ta + (tb - ta) * k / K);
    if (P.edgeHard > 0 && archOf(i) > 0) {
      const kn = longSide(i) ? knotsLong(sp).map(([u]) => (uWest(i, u) === u ? u : 1 - u)) : knotsEnd.map(([u]) => u);
      for (const t of kn) if (t > ta + 1e-4 && t < tb - 1e-4) ts.push(t);
      ts.sort((x, y) => x - y);
    }
    for (const t of ts) seg.push({ T: g.T(t), B: g.B(t), n: g.nAt(t), pod: podPt(i, t), face: i, t });
    segs.push(seg);
    if (merged(j)) {
      // one curve round the whole corner: from this face, over the cut face j, onto face j + 1
      const jj = (j + 1) % N, gc = FG[j], gn = FG[jj], t1 = tb, t2 = mL(j, faces[jj].len) / faces[jj].len;
      const nC = Math.max(16, Math.ceil((faces[j].len + 2 * radOf(j)) / 0.6)), cs: Samp[] = [];
      const n1 = g.nAt(t1), n2 = gn.nAt(t2);
      for (let k = 0; k <= nC; k++) {
        const u = k / nC;
        cs.push({
          T: bez5(g.T(t1), gc.T(0), gc.T(1), gn.T(t2), u), B: bez5(g.B(t1), gc.B(0), gc.B(1), gn.B(t2), u),
          n: n1.clone().lerp(n2, smoother(u)).normalize(), pod: bez5(podPt(i, t1), podPt(j, 0), podPt(j, 1), podPt(jj, t2), u), face: -1, t: u,
        });
      }
      segs.push(cs);
      cornerMid.push(cs[nC >> 1]); cornerFold.push(false);
      return;
    }
    // the blend round the fold at the end of this face
    const c = cl[j], gj = FG[j], cornerPod = podPt(j, 0);
    if (c > 0.05) {
      const t1 = 1 - c / f.len, t2 = c / faces[j].len, nC = Math.max(4, Math.ceil(2 * c / 0.6)), cs: Samp[] = [];
      const dS = g.tanAt(t1), dE = gj.tanAt(t2);
      const sT = g.T(t1), eT = gj.T(t2), cT = ctrlOf(sT, dS, eT, dE, g.T(1), g.T(1).y);
      const sB = g.B(t1), eB = gj.B(t2), cB = ctrlOf(sB, dS, eB, dE, g.B(1), g.B(1).y);
      const sP = podPt(i, t1), eP = podPt(j, t2), cP = ctrlOf(sP, dS, eP, dE, cornerPod, 0);
      const n1 = g.nAt(t1), n2 = gj.nAt(t2);
      for (let k = 0; k <= nC; k++) {
        const u = k / nC;
        cs.push({ T: bez4(sT, cT, eT, u), B: bez4(sB, cB, eB, u), n: n1.clone().lerp(n2, smoother(u)).normalize(), pod: bez4(sP, cP, eP, u), face: -1, t: u });
      }
      segs.push(cs);
      cornerMid.push(cs[nC >> 1]); cornerFold.push(c < 6);
    } else { cornerMid.push(seg[seg.length - 1]); cornerFold.push(true); }
  });
  // arc length along the eave, for texture coordinates
  let sAcc = 0, prevT: THREE.Vector3 | null = null;
  const sOfSamp = new Map<Samp, number>();
  for (const seg of segs) for (const q of seg) { if (prevT) sAcc += Math.hypot(q.T.x - prevT.x, q.T.z - prevT.z); sOfSamp.set(q, sAcc); prevT = q.T; }
  const perimE = sAcc + Math.hypot(segs[0][0].T.x - prevT!.x, segs[0][0].T.z - prevT!.z);
  const flat: Samp[] = [];
  segs.forEach((seg, k) => seg.forEach((q, j) => { if (j > 0 || k === 0) flat.push(q); }));
  // Fin bays. finMirror 1: mirror-symmetric north and south. The loop is cut where the eave crosses the long axis (the
  // middle of each goal end), both halves get the same whole number of bays, and the fins stand at the bay middles. bayU
  // counts bays from the east end's middle and runs on from s = 0 without a jump, so the lattice (one diamond per bay) has
  // no seam. finMirror 0 (v0): bays of finStep from s = 0.
  const mirror = P.finMirror > 0.5;
  const sOfFlat = (k: number) => (k < flat.length ? sOfSamp.get(flat[k])! : perimE);
  const crossAt = (east: boolean) => {
    for (let k = 0; k < flat.length; k++) {
      const a = flat[k].T, b = flat[(k + 1) % flat.length].T;
      if (a.x > 0 === east && (a.z <= 0) !== (b.z <= 0)) return sOfFlat(k) + (sOfFlat(k + 1) - sOfFlat(k)) * a.z / (a.z - b.z);
    }
    return east ? 0 : perimE / 2;
  };
  const sE = crossAt(true), sW = crossAt(false), L1 = (((sW - sE) % perimE) + perimE) % perimE, L2 = perimE - L1;
  const nHalf = Math.max(1, Math.round(perimE / 2 / P.finStep));
  const bayU = (s: number) => {
    if (!mirror) return s / P.finStep;
    const d = (((s - sE) % perimE) + perimE) % perimE, u = d <= L1 ? (d / L1) * nHalf : nHalf + ((d - L1) / L2) * nHalf;
    return s < sE ? u - 2 * nHalf : u;
  };
  const bayS = (u: number) => (sE + (u < nHalf ? (u / nHalf) * L1 : L1 + ((u - nHalf) / nHalf) * L2)) % perimE;

  // the eave roll: a curve from the roof (P1) over the old sharp edge (T) down to the facade plane (P0).
  // It is a quartic Bezier whose first and last three control points lie on the roof and facade lines, so its
  // curvature falls to zero where it meets each flat surface: no highlight seam, the shoulder just flows.
  const R_ROWS = Math.max(P.eaveR, P.eaveRSharp) > 0.1 ? 18 : 1;
  // the eave radius eases round the stadium: P.eaveR at the rounded diagonal pair, P.eaveRSharp at the other
  const eaveRAt = (T: THREE.Vector3) => {
    const phi = Math.atan2(T.z, T.x), w = 0.5 + 0.5 * Math.sin(2 * phi) * (flip ? -1 : 1);
    return P.eaveRSharp + (P.eaveR - P.eaveRSharp) * smooth01(w);
  };
  const quart = (p: THREE.Vector3[], u: number) => {
    const w = [(1 - u) ** 4, 4 * u * (1 - u) ** 3, 6 * u * u * (1 - u) ** 2, 4 * u ** 3 * (1 - u), u ** 4];
    return p.reduce((acc, q, k) => acc.addScaledVector(q, w[k]), new THREE.Vector3());
  };
  const roll = (q: Samp) => {
    const T = q.T, dn = q.B.clone().sub(T), hgt = dn.length(); dn.normalize();
    const di = innerOf(T).sub(T).normalize();
    const r = Math.max(0.05, Math.min(eaveRAt(T), 0.45 * (T.y - P.lift), 0.8 * hgt));
    const P0 = T.clone().addScaledVector(dn, r), P1 = T.clone().addScaledVector(di, r);
    const ctrl = [P1, P1.clone().lerp(T, 0.5), T, P0.clone().lerp(T, 0.5), P0];
    const pts = R_ROWS === 1 ? [T.clone()] : Array.from({ length: R_ROWS }, (_, k) => quart(ctrl, k / (R_ROWS - 1)));
    // surface normal along the roll, from the roof's normal to the facade's, eased like the curve
    const tangent = new THREE.Vector3(-q.n.z, 0, q.n.x), nRoof = new THREE.Vector3().crossVectors(di, tangent).normalize();
    if (nRoof.y < 0) nRoof.negate();
    const nrms = pts.map((_, k) => (R_ROWS === 1 ? q.n.clone() : nRoof.clone().lerp(q.n, THREE.MathUtils.smoothstep(k / (R_ROWS - 1), 0, 1)).normalize()));
    return { pts, nrms, P0: pts[pts.length - 1], P1: pts[0], mid: pts[(pts.length - 1) >> 1] };
  };
  const rolls = new Map<Samp, ReturnType<typeof roll>>();
  for (const seg of segs) for (const q of seg) rolls.set(q, roll(q));

  // facade geometry: one strip per segment, so sharp folds stay sharp and blends stay smooth
  const segGeo = (seg: Samp[], rowsOf: (q: Samp) => THREE.Vector3[], uvOf: (q: Samp, p: THREE.Vector3) => V2, uv1Of?: (q: Samp, r: number) => V2) => {
    const pos: number[] = [], uv: number[] = [], uv1: number[] = [], idx: number[] = [], nr = rowsOf(seg[0]).length;
    seg.forEach((q) => rowsOf(q).forEach((p, r) => { pos.push(p.x, p.y, p.z); uv.push(...uvOf(q, p)); if (uv1Of) uv1.push(...uv1Of(q, r)); }));
    for (let i = 0; i < seg.length - 1; i++) for (let r = 0; r < nr - 1; r++) { const a = i * nr + r, b = (i + 1) * nr + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (uv1Of) g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // keep outward normals: flip the winding if it came out inward
    const nA = g.getAttribute('normal'), m = nr * (seg.length >> 1) + (nr - 1);   // a vertex on the straight facade, whose normal is near horizontal
    if (nA.getX(m) * seg[0].n.x + nA.getZ(m) * seg[0].n.z < 0) { const ix = g.getIndex()!; for (let k = 0; k < ix.count; k += 3) { const t = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, t); } g.computeVertexNormals(); }
    return g;
  };
  // The membrane lattice (uv1) is laid by arc length: u counts fin bays (the fins stand on the tile edges, so every bay
  // holds one diamond), v runs in metres up the flat face, over the shoulder and on across the roof without a seam.
  // (uv keeps height / hMax, for the concourse light bands behind the membrane.)
  const LAT_V = 2.4;
  const latU = (q: Samp) => bayU(sOfSamp.get(q)!);
  const faceArc = (q: Samp) => rolls.get(q)!.P0.distanceTo(q.B);
  const rollArc = (q: Samp) => { const pts = rolls.get(q)!.pts, a = [0]; for (let k = pts.length - 2; k >= 0; k--) a.unshift(a[0] + pts[k].distanceTo(pts[k + 1])); return a; };   // from P0 up, per row (row 0 = P1)
  const faceGeo = mergeGeometries(segs.map((seg) => segGeo(seg, (q) => [rolls.get(q)!.P0, q.B], (q, p) => [sOfSamp.get(q)! / 4, p.y / hMax],
    (q, r) => [latU(q), r === 0 ? faceArc(q) / LAT_V : 0])));
  const shoulderGeo = R_ROWS > 1 ? mergeGeometries(segs.map((seg) => segGeo(seg, (q) => rolls.get(q)!.pts, (q, p) => [sOfSamp.get(q)! / 4, p.y / hMax],
    (q, r) => [latU(q), (faceArc(q) + rollArc(q)[r]) / LAT_V]))) : null;

  // fins: straight and evenly spaced along the eave, square to the surface; each wraps the roll and tapers out
  const fins = new Mesh(), cap = new Mesh();
  const lerpS = (a: Samp, b: Samp, u: number) => {
    const ra = rolls.get(a)!, rb = rolls.get(b)!;
    const pts = ra.pts.map((p, k) => p.clone().lerp(rb.pts[k], u)), nrms = ra.nrms.map((n, k) => n.clone().lerp(rb.nrms[k], u).normalize());
    return { pts, nrms, B: a.B.clone().lerp(b.B, u), n: a.n.clone().lerp(b.n, u).normalize() };
  };
  // the rhythm: a wave train round the stadium, its crest on the main face's three-seven point (deepest, square-on);
  // between crests the fins turn and thin out, so the facade breathes as you walk round it. With finMirror the south half
  // mirrors the north (crests on both long faces): the same depth, the turn reversed, fading out on the long axis where
  // the two halves meet.
  const phiA = Math.atan2(B, -A + 2 * A * sp);
  const finMaxDepth = P.finDepth * (1 + P.finWave);
  const rhythm = (p: THREE.Vector3) => {
    const th = Math.atan2(p.z, p.x), a = P.finWaves * ((mirror ? Math.abs(th) : th) - phiA);
    const turn = mirror ? Math.sign(p.z) * THREE.MathUtils.smoothstep(Math.abs(Math.sin(th)), 0, 0.2) : 1;
    return { depth: P.finDepth * (1 + P.finWave * Math.cos(a)), yaw: THREE.MathUtils.degToRad(P.finYaw) * Math.sin(a) * turn };
  };
  const finS = mirror ? Array.from({ length: 2 * nHalf }, (_, j) => bayS(j + 0.5)).sort((x, y) => x - y)
    : Array.from({ length: Math.ceil(perimE / P.finStep) }, (_, j) => (j + 0.5) * P.finStep).filter((x) => x < sOfFlat(flat.length - 1));
  for (let j = 0, k = 0; j < finS.length; j++) {
    const sf = finS[j];
    while (k < flat.length - 1 && sOfFlat(k + 1) <= sf) k++;
    const a = flat[k], b = flat[(k + 1) % flat.length], sa = sOfFlat(k), sb = sOfFlat(k + 1);
    const q = lerpS(a, b, sb > sa ? (sf - sa) / (sb - sa) : 0);
    // the fin's profile: from the middle of the roll down to the base line
    const startK = R_ROWS === 1 ? 0 : Math.round((R_ROWS - 1) * (1 - THREE.MathUtils.clamp(P.finUp, 0, 1) * 0.7));
    // on the flat face a fin is straight with constant depth: one segment, unless it rounds off there (finUp 0)
    const flatN = P.finUp > 0.5 ? 1 : 6, P0 = q.pts[q.pts.length - 1];
    const prof = [...q.pts.slice(startK), ...Array.from({ length: flatN }, (_, j) => P0.clone().lerp(q.B, (j + 1) / flatN))];
    const nr = [...q.nrms.slice(startK), ...Array.from({ length: flatN }, () => q.n)];
    const arc: number[] = [0]; for (let j = 1; j < prof.length; j++) arc.push(arc[j - 1] + prof[j].distanceTo(prof[j - 1]));
    const rh = rhythm(q.B), cosY = Math.cos(rh.yaw), sinY = Math.sin(rh.yaw);
    // the fin's top end rounds off over 1.6 m (a quarter-ellipse), so it ends cleanly where the shoulder begins
    // finUp 1 (the default): the fin grows from nothing over the shoulder to full depth where the flat face begins.
    // finUp 0: the fin starts at the flat face and rounds off over 1.6 m (a quarter-ellipse).
    const rollN = R_ROWS - startK;
    const depthAt = (k2: number) => {
      if (R_ROWS === 1) return rh.depth;
      if (P.finUp > 0.5) return rh.depth * THREE.MathUtils.smoothstep(k2, 0, Math.max(1, rollN - 1));
      const u = Math.min(1, arc[k2] / 1.6); return rh.depth * Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u)));
    };
    // a solid blade: two faces, an outer edge and end caps; it is thick at the root and tapers towards the edge
    const tH0 = new THREE.Vector3(-q.n.z, 0, q.n.x).normalize(), hw0 = P.finThick / 2, hw1 = 0.35 * P.finThick;
    // the blade turns about its root line by the rhythm's yaw: its outward direction and its thickness direction both rotate
    const dirs = nr.map((n) => n.clone().multiplyScalar(cosY).addScaledVector(tH0, sinY).normalize());
    const sides = nr.map((n) => tH0.clone().multiplyScalar(cosY).addScaledVector(n, -sinY).normalize());
    // a turned blade's root corners dip into the shell by half its thickness x sin(yaw): lift the root clear of the surface
    // (plus 1 cm), or the corners poke through and shimmer as thin lines on the inside
    const lift = hw0 * Math.abs(sinY) + 0.01;
    const root = prof.map((p, k2) => p.clone().addScaledVector(nr[k2], lift)), tip = prof.map((p, k2) => p.clone().addScaledVector(dirs[k2], lift + depthAt(k2)));
    const off = (p: THREE.Vector3, k2: number, w: number) => p.clone().addScaledVector(sides[k2], w);
    for (let k2 = 0; k2 < prof.length - 1; k2++) {
      const r0 = root[k2], r1 = root[k2 + 1], e0 = tip[k2], e1 = tip[k2 + 1], j = k2 + 1, sd = sides[k2], nsd = sd.clone().negate();
      fins.quad(off(r0, k2, -hw0), off(r1, j, -hw0), off(e1, j, -hw1), off(e0, k2, -hw1), nsd, [[0, 1], [0, 0], [1, 0], [1, 1]]);
      fins.quad(off(r0, k2, hw0), off(r1, j, hw0), off(e1, j, hw1), off(e0, k2, hw1), sd, [[0, 1], [0, 0], [1, 0], [1, 1]]);
      const out = dirs[k2].clone().add(dirs[j]).normalize();
      fins.quad(off(e0, k2, -hw1), off(e1, j, -hw1), off(e1, j, hw1), off(e0, k2, hw1), out, [[1, 1], [1, 0], [1, 0], [1, 1]]);
    }
    const L = prof.length - 1, upT = root[0].clone().sub(root[1]).normalize(), dnT = root[L].clone().sub(root[L - 1]).normalize();
    fins.quad(off(root[0], 0, -hw0), off(root[0], 0, hw0), off(tip[0], 0, hw1), off(tip[0], 0, -hw1), upT, [[0, 1], [0, 1], [1, 1], [1, 1]]);
    fins.quad(off(root[L], L, -hw0), off(root[L], L, hw0), off(tip[L], L, hw1), off(tip[L], L, -hw1), dnT, [[0, 0], [0, 0], [1, 0], [1, 0]]);
  }
  // caps: a sharp eave plate only when the eave is sharp; a fascia under the fin ends tracing the arches
  for (let k = 0; k < flat.length; k++) {
    const a = flat[k], b = flat[(k + 1) % flat.length], dA = finMaxDepth + 0.15;
    if (R_ROWS === 1) {
      const a2 = a.T.clone().addScaledVector(a.n, dA), b2 = b.T.clone().addScaledVector(b.n, dA);
      cap.quad(a.T, b.T, b2, a2, new THREE.Vector3(0, 1, 0), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      cap.quad(a2, b2, b2.clone().setY(b2.y - 0.7), a2.clone().setY(a2.y - 0.7), a.n, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  // the lower rim: one continuous band under the fin ends, swept along the base line with smooth normals: an underside,
  // a rounded nose and a fascia, and a top plate that hides the fin ends. It does not take the fins' shadows.
  const rim = (() => {
    // its depth follows the fins above it: at every station it reaches 15 cm past the local fin edge (the rhythm's depth,
    // turned by its yaw), so it is deep where the fins are deep and short where they are shallow, e.g. on the goal ends
    const FH = 0.6, finHalf = 0.35 * P.finThick;
    const local = (q: Samp) => {
      const rh = rhythm(q.B), reach = rh.depth * Math.cos(rh.yaw) + finHalf * Math.abs(Math.sin(rh.yaw));
      return { dA: reach + 0.15, drop: rh.depth * Math.max(0, -q.n.y) + 0.08 };
    };
    type C = { d: number; h: number; nd: number; nh: number };
    const outline = (dA: number): C[] => {
      const RN = Math.min(0.22, 0.3 * dA), pf: C[] = [{ d: 0, h: 0, nd: 0, nh: -1 }, { d: dA - RN, h: 0, nd: 0, nh: -1 }];
      for (let j = 1; j <= 6; j++) { const a = (j / 6) * Math.PI / 2; pf.push({ d: dA - RN + RN * Math.sin(a), h: RN - RN * Math.cos(a), nd: Math.sin(a), nh: -Math.cos(a) }); }
      pf.push({ d: dA, h: FH, nd: 1, nh: 0 });
      return pf;
    };
    const topPlate = (dA: number): C[] => [{ d: dA, h: FH, nd: 0, nh: 1 }, { d: 0, h: FH, nd: 0, nh: 1 }];
    const strip = (pfOf: (dA: number) => C[]) => {
      const pos: number[] = [], nrm: number[] = [], idx: number[] = [], L = flat.length, m = pfOf(1).length;
      for (let k = 0; k <= L; k++) {
        const q = flat[k % L], n = q.n.clone().setY(0).normalize(), { dA, drop } = local(q);
        for (const c of pfOf(dA)) {
          const p = q.B.clone().addScaledVector(n, c.d); p.y += c.h - drop;   // below the fin ends, which dip on a leaning face
          const nn = n.clone().multiplyScalar(c.nd); nn.y = c.nh; nn.normalize();
          pos.push(p.x, p.y, p.z); nrm.push(nn.x, nn.y, nn.z);
        }
      }
      for (let k = 0; k < L; k++) for (let j = 0; j < m - 1; j++) { const a = k * m + j, b = (k + 1) * m + j; idx.push(a, a + 1, b, b, a + 1, b + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setIndex(idx);
      return g;
    };
    return mergeGeometries([strip(outline), strip(topPlate)]);
  })();
  // LED lines down the folds
  const arrises: number[] = [];
  // the fold lines run on the outer surface: over the roll, then straight down the facade to the base
  cornerMid.forEach((c, ci) => {
    if (!cornerFold[ci]) return;
    const r = rolls.get(c)!, pts = [...r.pts.slice((r.pts.length - 1) >> 1), c.B], ns = [...r.nrms.slice((r.nrms.length - 1) >> 1), c.n];
    for (let k = 0; k < pts.length - 1; k++) { const a = pts[k].clone().addScaledVector(ns[k], 0.08), b = pts[k + 1].clone().addScaledVector(ns[k + 1], 0.08); arrises.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  });
  // the roof starts where the roll ends
  const eave = flat.map((q) => { const r = rolls.get(q)!; return { x: r.P1.x, y: r.P1.z, h: r.P1.y, s: sOfSamp.get(q)! }; });

  // ---- roof: from the eave down and in to the soft opening
  const inner = flat.map((q) => { const v = innerOf(q.T); return { x: v.x, y: v.z, h: v.y }; });
  const M = eave.length;
  const strip = (rowsOf: (i: number) => THREE.Vector3[], uvOf: (i: number, r: number, p: THREE.Vector3[]) => V2) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nr = rowsOf(0).length;
    for (let i = 0; i <= M; i++) {
      const rows = rowsOf(i % M);
      rows.forEach((p, r) => { pos.push(p.x, p.y, p.z); uv.push(...uvOf(i, r, rows)); });
    }
    for (let i = 0; i < M; i++) for (let r = 0; r < nr - 1; r++) { const a = i * nr + r, b = (i + 1) * nr + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const sOf = (i: number) => (i === M ? perimE : eave[i].s);
  // the roof surface runs from the eave to the opening (and may sag between them); it leaves the eave level,
  // so the roofline stays crisp. With the band on it is split in three rings: white rim, black glass band, white ring.
  const ROWS = Array.from({ length: 13 }, (_, k) => k / 12);
  const roofAt = (i: number, t: number) => {
    const e = eave[i], q = inner[i];
    return V(e.x + (q.x - e.x) * t, e.y + (q.y - e.y) * t, e.h + (q.h - e.h) * t - P.sag * Math.sin(Math.PI * t) * (1 - 0.35 * t));
  };
  const span = (i: number) => Math.hypot(inner[i].x - eave[i].x, inner[i].y - eave[i].y);
  const topArc = flat.map((q) => faceArc(q) + rollArc(q)[0]);   // lattice v where the roof begins
  const roofStrip = (t0: (i: number) => number, t1: (i: number) => number, n = 6) => strip(
    (i) => Array.from({ length: n + 1 }, (_, k) => roofAt(i, t0(i) + (t1(i) - t0(i)) * k / n)),
    (i, r, rows) => [bayU(sOf(i)), (topArc[i % M] + roofAt(i % M, 0).distanceTo(rows[r])) / LAT_V]);
  // band edges: a fixed width from each white ring, averaged over ~25 m so they run as calm curves round the corners
  const smoothCirc = (a: number[], w: number) => a.map((_, i) => { let acc = 0; for (let k = -w; k <= w; k++) acc += a[(i + k + a.length) % a.length]; return acc / (2 * w + 1); });
  const rimT = smoothCirc(eave.map((_, i) => Math.min(0.45, P.rimW / span(i))), 12), lipT = smoothCirc(eave.map((_, i) => Math.max(0.55, 1 - P.lipW / span(i))), 12);
  const tRim = (i: number) => rimT[i % M], tLip = (i: number) => lipT[i % M];
  const banded = P.band > 0.5;
  const roof = banded ? roofStrip(() => 0, tRim, 2) : roofStrip(() => 0, () => 1, P.sag > 0.05 ? 12 : 2);   // flat across unless it sags
  const roofBand = banded ? roofStrip(tRim, tLip, 8) : null;
  const roofLip = banded ? roofStrip(tLip, () => 1, 2) : null;
  // a hairline of steel where the band meets each white ring
  const seam = (tf: (i: number) => number) => new THREE.BufferGeometry().setFromPoints([...Array(M + 1).keys()].map((k) => roofAt(k % M, tf(k % M)).setY(roofAt(k % M, tf(k % M)).y + 0.03)));
  const seams = banded ? [seam(tRim), seam(tLip)] : [];
  const lip = strip((i) => { const q = inner[i]; return [V(q.x, q.y, q.h), V(q.x, q.y, q.h - 1.4)]; }, (i, r) => [sOf(i) / 4, r]);
  // the underside follows the roof 1.4 m below it, from the opening's lip back to just inside the eave
  const under = strip((i) => {
    const e = eave[i], q = inner[i];
    // ...and on down to the top of the flat facade, inside the shoulder, so no slit is left for the fins to show through
    const rows = ROWS.slice().reverse().filter((t) => t > 0.03).map((t) => V(e.x + (q.x - e.x) * t, e.y + (q.y - e.y) * t, e.h + (q.h - e.h) * t - P.sag * Math.sin(Math.PI * t) * (1 - 0.35 * t) - 1.4));
    const r = rolls.get(flat[i % flat.length]);
    if (r) { const inw = new THREE.Vector3(q.x - e.x, 0, q.y - e.y).normalize(); rows.push(r.P0.clone().addScaledVector(inw, 0.15)); }
    return rows;
  }, (i, r) => [sOf(i) / 4, r]);

  // ---- the floating base: soffit and glazed podium follow the arches; legs stand under the folds
  const soffit = new Mesh(), podium = new Mesh(), apron = new Mesh();
  const down = new THREE.Vector3(0, -1, 0), upV = new THREE.Vector3(0, 1, 0), far = ring(30);
  let ps = 0;
  for (let k = 0; k < flat.length; k++) {
    const a = flat[k], b = flat[(k + 1) % flat.length], h0 = a.B.y, h1 = b.B.y;
    soffit.quad(a.B.clone().setY(h0 - 0.02), b.B.clone().setY(h1 - 0.02), b.pod.clone().setY(h1 - 0.02), a.pod.clone().setY(h0 - 0.02), down, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const L = Math.hypot(b.pod.x - a.pod.x, b.pod.z - a.pod.z);
    if (L > 1e-3) {
      const o = new THREE.Vector3(b.pod.z - a.pod.z, 0, -(b.pod.x - a.pod.x)).normalize();
      // the glass may lean in towards the ground, so the base reads as a recess under the volume
      const ia = new THREE.Vector3(-a.n.x, 0, -a.n.z).normalize(), ib = new THREE.Vector3(-b.n.x, 0, -b.n.z).normalize();
      const a0 = a.pod.clone().addScaledVector(ia, P.podSlant), b0 = b.pod.clone().addScaledVector(ib, P.podSlant);
      podium.quad(a0, b0, b.pod.clone().setY(h1), a.pod.clone().setY(h0), o.dot(a.n) < 0 ? o.negate() : o, [[ps / 4, 0], [(ps + L) / 4, 0], [(ps + L) / 4, h1 / P.lift], [ps / 4, h0 / P.lift]]);
    }
    ps += L;
  }
  const podIn = polyFromLines(faces.map((f) => ({ p: [f.s0[0] - f.n[0] * (P.podInset + P.podSlant + 0.5), f.s0[1] - f.n[1] * (P.podInset + P.podSlant + 0.5)] as V2, d: [f.s1[0] - f.s0[0], f.s1[1] - f.s0[1]] as V2 })));
  faces.forEach((_, i) => { const j = (i + 1) % N; apron.quad(V(podIn[i][0], podIn[i][1], 0.02), V(podIn[j][0], podIn[j][1], 0.02), V(far[j][0], far[j][1], 0.02), V(far[i][0], far[i][1], 0.02), upV, [[0, 0], [1, 0], [1, 1], [0, 1]]); });
  // supports. Every family except the first stands clear of the glass on its own concrete footing, under the overhang.
  type Member = { a: THREE.Vector3; b: THREE.Vector3; r: number };
  const legs: Member[] = [], footings: { p: THREE.Vector3; r: number }[] = [];
  const style = Math.round(P.legStyle);
  if (P.lift > 0.5 && style !== 4) {
    // a point on the base line at arc length sv: the soffit edge B, the glass foot and the outward normal
    const at = (sv: number) => {
      const x = ((sv % perimE) + perimE) % perimE;
      let k = 0; while (k < flat.length - 1 && sOfSamp.get(flat[k + 1])! <= x) k++;
      const a = flat[k], b = flat[(k + 1) % flat.length], sa = sOfSamp.get(a)!, sb = k + 1 < flat.length ? sOfSamp.get(b)! : perimE;
      const f = sb > sa ? (x - sa) / (sb - sa) : 0;
      const n = a.n.clone().lerp(b.n, f), inw = new THREE.Vector3(-n.x, 0, -n.z).normalize();
      return { B: a.B.clone().lerp(b.B, f), pod: a.pod.clone().lerp(b.pod, f), inw };
    };
    const deckY = P.landscape > 0.5 ? P.deckH : 0;     // feet stand on the plinth when there is one
    const foot = (q: ReturnType<typeof at>, d: number) => q.B.clone().setY(deckY).addScaledVector(q.inw, d);
    const under = (q: ReturnType<typeof at>, d: number) => q.B.clone().addScaledVector(q.inw, d).setY(q.B.y - 0.05);   // a point on the soffit
    const put = (sv: number) => {
      const q = at(sv);
      if (style === 0) {
        if (P.legV > 0.5) { const d = Math.max(3, (P.legs || 18) * 0.28); legs.push({ a: q.pod, b: at(sv - d).B, r: 1 }, { a: q.pod.clone(), b: at(sv + d).B, r: 1 }); }
        else legs.push({ a: q.pod, b: q.B, r: 1 });
        return;
      }
      const f = foot(q, P.legIn);
      if (style === 1) {                                     // V legs: one footing, two heads on the soffit either side
        const d = Math.max(3, P.legs * 0.3), h1 = at(sv - d), h2 = at(sv + d);
        legs.push({ a: f, b: under(h1, 0.8), r: 1.05 }, { a: f.clone(), b: under(h2, 0.8), r: 1.05 });
        footings.push({ p: f, r: 1.3 });
      } else if (style === 2) {                              // tree columns: a trunk forking into three branches
        const fork = f.clone().setY(Math.min(q.B.y * 0.5, q.B.y - 4)), d = Math.max(3, P.legs * 0.32);
        legs.push({ a: f, b: fork, r: 1.9 });
        for (const o of [-d, 0, d]) { const h = at(sv + o); legs.push({ a: fork.clone(), b: under(h, P.legIn * (o === 0 ? 1.6 : 0.5)), r: 0.85 }); }
        footings.push({ p: f, r: 1.9 });
      } else if (style === 3) {                              // a calm colonnade of slender vertical columns
        legs.push({ a: f, b: f.clone().setY(q.B.y - 0.05), r: 0.75 });
        footings.push({ p: f, r: 0.9 });
      } else if (style === 5) {                              // a few great tapered piers
        legs.push({ a: f, b: f.clone().setY(q.B.y - 0.05), r: 3.4 });
        footings.push({ p: f, r: 3.0 });
      }
    };
    // one at every corner, then evenly between corners
    const cs = cornerMid.map((c) => sOfSamp.get(c)!).filter((v) => v !== undefined).sort((x, y) => x - y);
    cs.forEach((c0, k) => {
      put(c0);
      if (P.legs <= 0) return;
      const c1 = k + 1 < cs.length ? cs[k + 1] : cs[0] + perimE, n = Math.max(1, Math.round((c1 - c0) / P.legs));
      for (let j = 1; j < n; j++) put(c0 + (c1 - c0) * j / n);
    });
  }

  // ---- the ground: one station per base sample, the body's outline at ground level and the deck's inner edge
  const ground: LandscapeSpec = { loop: [], pools: [], octagon: [] };
  if (P.landscape > 0.5) {
    ground.loop = flat.map((q): GroundPt => {
      const inw = new THREE.Vector3(-q.n.x, 0, -q.n.z).normalize();
      return { o: q.pod.clone().setY(0).addScaledVector(inw, -P.podInset), inw, inner: q.pod.clone().setY(0).addScaledVector(inw, P.podSlant + 0.6) };
    });
    // reflecting pools in front of the main entrance and, on the diagonal, the far side's
    const stepsOut = P.podInset + P.deckOut + Math.max(1, Math.round(P.deckH / 0.3)) * P.stepT;
    const pool = (face: number, t: number, L: number, W: number, jets: number): PoolSpec | null => {
      const cand = flat.filter((q) => q.face === face);
      if (!cand.length) return null;
      const q = cand.reduce((m, x) => (Math.abs(x.t - t) < Math.abs(m.t - t) ? x : m));
      const inw = new THREE.Vector3(-q.n.x, 0, -q.n.z).normalize();
      return { c: q.pod.clone().setY(0).addScaledVector(inw, -(stepsOut + 10 + W / 2)), dir: new THREE.Vector3(inw.z, 0, -inw.x), L, W, jets };
    };
    for (const p of [pool(2, 1 - sp, 36, 6.5, 15), pool(6, P.crestTwist > 0.5 ? sp : 1 - sp, 26, 5.5, 11)]) if (p) ground.pools.push(p);
    ground.octagon = ring(P.groundD).map((v) => V(v[0], v[1], 0));
  }

  // ---- sign anchors: on the face plane, between the arched base line and the start of the eave roll. Each sign is
  // fixed on the fins: it carries the fin-tip surface across its width (bend), so the letters can follow the bowed facade.
  const signs: SignAnchor[] = [];
  const anchorAt = (i: number, t: number, kind: SignAnchor['kind'], rise: number) => {
    const g = FG[i], Bp = g.B(t), Tp = g.T(t), up = Tp.clone().sub(Bp).normalize();
    // the flat face runs from the base line up to where the eave roll starts; rise 1 puts the sign's top edge there
    const top = Tp.clone().addScaledVector(up, -Math.max(P.eaveR, P.eaveRSharp)), room = top.distanceTo(Bp) - 1.2;
    const Hs = THREE.MathUtils.clamp(room * 0.35, 3, kind === 'word' ? 7 : 8), span = top.distanceTo(Bp);
    const panelled = kind === 'word' ? P.signWordPanel > 0.5 : P.signSymbolPanel > 0.5;
    const halfH = panelled ? Hs : 0.5 * Hs;                              // the black panel adds 0.5 H clear space above and below
    const lo = Math.min(0.5, (halfH + 0.6) / span), hi = Math.max(0.5, 1 - (halfH + 0.3) / span);
    const pos = Bp.clone().lerp(top, lo + (hi - lo) * THREE.MathUtils.clamp(rise, 0, 1)), n = g.nAt(t);
    const upO = up.clone().addScaledVector(n, -up.dot(n)).normalize(), right = upO.clone().cross(n);
    const H = Hs, half = (kind === 'word' ? 4.84 : 1.33) * H / 2 + H;
    // the fin-tip surface across the sign: sample the face either side, at the sign's height
    const bend: { x: number; d: number }[] = [];
    for (let k = -24; k <= 24; k++) {
      const tk = t + (k / 24) * (half + 2) / faces[i].len;
      if (tk < 0 || tk > 1) continue;
      const b = g.B(tk), tt = g.T(tk), f = THREE.MathUtils.clamp((pos.y - b.y) / ((tt.y - b.y) || 1), 0, 1);
      const root = b.clone().lerp(tt, f), nk = g.nAt(tk), rh = rhythm(b), tH = new THREE.Vector3(-nk.z, 0, nk.x).normalize();
      const tip = root.addScaledVector(nk.clone().multiplyScalar(Math.cos(rh.yaw)).addScaledVector(tH, Math.sin(rh.yaw)).normalize(), rh.depth);
      const rel = tip.sub(pos);
      bend.push({ x: rel.dot(right), d: rel.dot(n) });
    }
    bend.sort((a, b) => a.x - b.x);
    signs.push({ kind, pos, n, up, room, H, bend, standoff: finMaxDepth + 0.6 });
  };
  anchorAt(2, P.signCenter > 0.5 ? 0.5 : 1 - sp, 'word', P.signWordRise);
  anchorAt(6, P.signCenter > 0.5 ? 0.5 : P.crestTwist > 0.5 ? 1 - sp : sp, 'word', P.signWordRise);
  // The goal-end symbol travels along the whole section of its face: up from the lower rim, over the flat face and on up
  // the eave shoulder, tilting back with it. (The flat face alone is only about 8 m tall there, about the panel's height.)
  const symbolAt = (i: number, t: number, rise: number) => {
    const cand = flat.filter((q) => q.face === i);
    if (!cand.length) return;
    const qc = cand.reduce((m, x) => (Math.abs(x.t - t) < Math.abs(m.t - t) ? x : m)), k0 = flat.indexOf(qc);
    // a station's section, bottom up: the base line, the top of the flat face, then the roll towards the roof
    const profileOf = (q: Samp) => {
      const r = rolls.get(q)!, pts = [q.B, ...r.pts.slice().reverse()], ns = [q.n, ...r.nrms.slice().reverse()], sv = [0];
      for (let j = 1; j < pts.length; j++) sv.push(sv[j - 1] + pts[j].distanceTo(pts[j - 1]));
      return { pts, ns, sv };
    };
    const atS = (pr: ReturnType<typeof profileOf>, x: number) => {
      const L = pr.pts.length - 1, xs = THREE.MathUtils.clamp(x, 0, pr.sv[L]);
      let j = 0; while (j < L - 1 && pr.sv[j + 1] < xs) j++;
      const f = THREE.MathUtils.clamp((xs - pr.sv[j]) / ((pr.sv[j + 1] - pr.sv[j]) || 1), 0, 1);
      return { p: pr.pts[j].clone().lerp(pr.pts[j + 1], f), n: pr.ns[j].clone().lerp(pr.ns[j + 1], f).normalize(), j: j + f, tan: pr.pts[j + 1].clone().sub(pr.pts[j]).normalize() };
    };
    // fin depth at profile index j (0 = base line, 1 = top of the flat face, then up the roll), as the fins are built
    const startK = R_ROWS === 1 ? 0 : Math.round((R_ROWS - 1) * (1 - THREE.MathUtils.clamp(P.finUp, 0, 1) * 0.7));
    const finAt = (q: Samp, j: number) => {
      const rh = rhythm(q.B), full = rh.depth * Math.cos(rh.yaw);
      if (j <= 1 || R_ROWS === 1) return full;
      if (P.finUp <= 0.5) return 0;
      const rollIdx = R_ROWS - j;
      return rollIdx < startK ? 0 : full * THREE.MathUtils.smoothstep(rollIdx - startK, 0, Math.max(1, R_ROWS - 1 - startK));
    };
    const pc = profileOf(qc), g = FG[i], flatSpan = g.T(t).distanceTo(g.B(t)) - Math.max(P.eaveR, P.eaveRSharp);
    const H = THREE.MathUtils.clamp((flatSpan - 1.2) * 0.35, 3, 8), halfH = (P.signSymbolPanel > 0.5 ? 1 : 0.5) * H + 0.25 * H;
    // the travel: from just above the lower rim to where the shoulder has tilted back about 35 degrees
    let sHi = pc.sv[pc.sv.length - 1];
    for (let j = 1; j < pc.pts.length; j++) if (pc.ns[j].y > 0.57) { sHi = pc.sv[j]; break; }
    const sLo = halfH + 0.6, sAt = sLo + (Math.max(sLo, sHi) - sLo) * THREE.MathUtils.clamp(rise, 0, 1);
    const c = atS(pc, sAt), n = c.n, up = c.tan, right = up.clone().addScaledVector(n, -up.dot(n)).normalize().cross(n);
    // the fin tips under the sign, across its width and height; the panel then rests on the outermost of them
    const half = 1.33 * H / 2 + H, bend: { x: number; d: number }[] = [];
    for (let dk = -60; dk <= 60; dk++) {
      const q = flat[(k0 + dk + flat.length) % flat.length], pr = profileOf(q);
      let x = 0, d = -Infinity, cnt = 0;
      for (let v = -1; v <= 1; v += 0.25) {
        const a = atS(pr, sAt + v * halfH), tip = a.p.clone().addScaledVector(a.n, finAt(q, a.j)), rel = tip.sub(c.p);
        x += rel.dot(right); cnt++; d = Math.max(d, rel.dot(n));
      }
      x /= cnt;
      if (Math.abs(x) <= half + 2) bend.push({ x, d });
    }
    bend.sort((a, b) => a.x - b.x);
    signs.push({ kind: 'symbol', pos: c.p, n, up, room: flatSpan, H, bend, standoff: finMaxDepth + 0.6 });
  };
  if (P.signEnds > 0.5) { symbolAt(0, 0.5, P.signSymbolRise); symbolAt(4, 0.5, P.signSymbolRiseWest); }   // face 0 east, face 4 west

  // ---- light: the folds, the eave, the opening; floodlights under the opening; plaza lamps
  const edgeLine = new THREE.BufferGeometry().setFromPoints([...flat, flat[0]].map((q) => q.B.clone().addScaledVector(q.n, finMaxDepth + 0.25).setY(q.B.y + 0.3)));
  const eaveLine = new THREE.BufferGeometry().setFromPoints([...flat, flat[0]].map((q) => { const r = rolls.get(q)!, m = r.mid, n = r.nrms[(r.nrms.length - 1) >> 1]; return m.clone().addScaledVector(n, 0.05); }));
  const arrisGeo = new THREE.BufferGeometry(); arrisGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrises, 3));
  const openLine = new THREE.BufferGeometry().setFromPoints([...inner, inner[0]].map((q) => V(q.x, q.y, q.h - 0.7)));
  const lampPos: number[] = [];
  for (let i = 0; i < M; i += 3) { const q = inner[i], e = eave[i], dx = e.x - q.x, dy = e.y - q.y, l = Math.hypot(dx, dy); lampPos.push(q.x + dx / l * 0.8, q.h - 1.7, q.y + dy / l * 0.8); }
  const lampGeo = new THREE.BufferGeometry(); lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const plaza = ring(16), plazaPos: number[] = [];
  plaza.forEach((p, i) => { const q = plaza[(i + 1) % N], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(L / 17)); for (let k = 0; k < n; k++) { const t = k / n; plazaPos.push(p[0] + (q[0] - p[0]) * t, 7, p[1] + (q[1] - p[1]) * t); } });
  const plazaGeo = new THREE.BufferGeometry(); plazaGeo.setAttribute('position', new THREE.Float32BufferAttribute(plazaPos, 3));

  return { face: faceGeo, shoulder: shoulderGeo, rim, fins: fins.geo(), cap: cap.geo(), roof, roofBand, roofLip, seams, lip, under, soffit: soffit.geo(), podium: podium.geo(), apron: apron.geo(), legs, footings, ground, signs, eaveLine, edgeLine, arrisGeo, openLine, lampGeo, plazaGeo, hMax };
}
