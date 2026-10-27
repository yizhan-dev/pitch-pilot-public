import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { roundedRect, type PathPt } from './path';
import { glowTexture, glowMaterial, focalPx } from './glow';

// The stadium envelope: one section curve swept round the bowl. From the ground it climbs a glazed hull,
// rolls over an eave and runs inwards across the roof to the inner edge over the stands. The roofline rises
// and falls round the perimeter, smoothly (a saddle) or folded into flat facets like a crystal, and the roof
// arches in section. Steel fins stand on the curve: up the facade, and over the eave as ribs on the roof.
export interface FacadeParams {
  // fins
  finStep: number;      // metres between fins along the facade line
  waves: number;        // fin angle waves round the perimeter
  twist: number;        // extra phase along each fin, in turns
  angle: number;        // peak fin angle to the surface normal, degrees
  depthMin: number;     // fin depth range, metres
  depthMax: number;
  depthWaves: number;   // depth waves round the perimeter
  ribs: number;         // how far the fins run on past the top of the facade, over the eave and onto the roof, metres
  lift: number;         // fins start this high, leaving an open, recessed base on raking columns
  finChaos: number;     // 0 = evenly spaced angle waves, 1 = irregular
  // envelope
  inset: number;        // the hull draws in by this much at the ground
  roofAmp: number;      // roofline rise at its peaks, metres
  roofWaves: number;    // peaks round the perimeter (2 = saddle: high along the touchlines)
  roofPhase: number;    // degrees
  plateau: number;      // 0 = pointed peaks; towards 1 the peaks and dips flatten into plateaus joined by straight ramps (a trapezoid wave)
  fold: number;         // 0 = smooth curves, 1 = flat facets with sharp folds
  facets: number;       // facets round the perimeter when folded
  jag: number;          // irregularity of the folded crown, 0..1
  bulge: number;        // roof arch in section, metres
  eave: number;         // eave radius, metres
  // breaking the symmetry
  tilt: number;         // the whole crown tips: one side rises this much, the opposite side drops
  tiltPhase: number;    // degrees, where the high side is
  facetJitter: number;  // uneven facet widths, 0..1
  foldVar: number;      // fold varies round the stadium: hard on one side, soft on the other
  foldPhase: number;    // degrees, where it is hardest
  leanVar: number;      // each facet's wall leans in or out by up to this much, metres
  prow: number;         // the envelope juts out like a bow at one place, metres
  prowPhase: number;    // degrees
  prowWidth: number;    // degrees
  // look
  skin: number;         // 0 = dark glass behind steel fins; 1 = no fins, the whole hull is the silver diamond membrane; 2 = fins in front of the membrane
  glow: number;         // light from inside: concourses, roof band, plaza lamps
  finColor: string;
  roofColor: string;
  ledColor: string;
  ledSpeed: number;     // pulse laps per second, roughly
  ledGain: number;
}
export const DEFAULT_FACADE: FacadeParams = {
  finStep: 1.7, waves: 6, twist: 0.3, angle: 54, depthMin: 0.9, depthMax: 2.1, depthWaves: 12, ribs: 12, lift: 0, finChaos: 0,
  inset: 3.2, roofAmp: 9, roofWaves: 2, roofPhase: 0, plateau: 0, fold: 0, facets: 16, jag: 0.35, bulge: 2.5, eave: 4,
  tilt: 0, tiltPhase: 40, facetJitter: 0, foldVar: 0, foldPhase: 180, leanVar: 0, prow: 0, prowPhase: 40, prowWidth: 28,
  skin: 0, glow: 0.85, finColor: '#c9d0d8', roofColor: '#cfd4da', ledColor: '#73d9ff', ledSpeed: 0.06, ledGain: 1,
};
const SHAPE_KEYS: (keyof FacadeParams)[] = ['finStep', 'waves', 'twist', 'angle', 'depthMin', 'depthMax', 'depthWaves', 'ribs', 'lift', 'finChaos',
  'inset', 'roofAmp', 'roofWaves', 'roofPhase', 'plateau', 'fold', 'facets', 'jag', 'bulge', 'eave',
  'tilt', 'tiltPhase', 'facetJitter', 'foldVar', 'foldPhase', 'leanVar', 'prow', 'prowPhase', 'prowWidth'];

export interface EnvelopeProps {
  hx: number; hy: number; rc: number;       // the bowl's inner edge (rounded rectangle half sizes and corner radius)
  back: number; front: number;              // outer line and roof inner edge, as offsets from the bowl edge
  top: number; frontTop: number;            // base heights of the eave and of the roof inner edge
  clip: THREE.Plane[]; params?: Partial<FacadeParams>; shadows?: boolean;
}

const NH = 16, NE = 8, NR = 18;            // section samples: hull, eave, roof
const NS = NH + NE + NR;                    // the roof inner edge is the last sample
const LEVELS = 30;                          // ribbon segments per fin
const K_VIRTUAL = 40;                       // see roofWeight
const EDGE = 1.4;                           // roof edge depth at the inner edge

const smooth01 = (x: number) => x * x * (3 - 2 * x);
const hash = (k: number) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Angle of a path point round the stadium, taken at a virtual point a fixed distance out along the normal
 *  from the core rectangle, so every point on one normal line (outer facade, roof, inner edge) agrees. */
function phiOf(p: PathPt, rOff: number) {
  const cx = p.x - p.nx * rOff, cy = p.y - p.ny * rOff;
  return Math.atan2(cy + p.ny * K_VIRTUAL, cx + p.nx * K_VIRTUAL);
}
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Facet vertices round the perimeter: uneven widths when jittered; each carries a crown value and a wall lean. */
function facetTable(P: FacadeParams) {
  const n = Math.max(3, Math.round(P.facets)), step = (2 * Math.PI) / n, ph = THREE.MathUtils.degToRad(P.roofPhase);
  const a: number[] = [], crown: number[] = [], lean: number[] = [];
  for (let k = 0; k < n; k++) {
    a.push(k * step + P.facetJitter * (hash(k + 17) - 0.5) * step * 0.85);
    crown.push(P.jag * ((k % 2 ? 0.22 : -0.22) + (hash(k) - 0.5) * 0.35));
    lean.push(2 * hash(k + 101) - 1);
  }
  return { n, a, crown, lean, ph };
}
type Facets = ReturnType<typeof facetTable>;

/** piecewise-linear interpolation of a facet value at angle phi (relative to the roof phase) */
function facetLerp(F: Facets, phi: number, vals: (k: number) => number) {
  const x = ((phi - F.ph) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  let k = F.n - 1;
  for (let j = 0; j < F.n; j++) if (F.a[j] > x) { k = j - 1; break; }
  const k0 = (k + F.n) % F.n, k1 = (k0 + 1) % F.n;
  const a0 = k < 0 ? F.a[F.n - 1] - 2 * Math.PI : F.a[k0], a1 = k1 === 0 ? F.a[0] + 2 * Math.PI : F.a[k1];
  const f = THREE.MathUtils.clamp((x - a0) / ((a1 - a0) || 1), 0, 1);
  return vals(k0) * (1 - f) + vals(k1) * f;
}

interface Crown { H: number; fold: number; inset: number; out: number; }

/** The local shape at angle phi: eave height H, fold, hull inset and outward offset. inner = the roof's inner edge,
 *  whose facet vertices sit half a facet round from the eave's, so the roof panels fold. */
function crownAt(P: FacadeParams, F: Facets, phi: number, base: number, inner = false): Crown {
  const fold = THREE.MathUtils.clamp(P.fold + P.foldVar * Math.cos(phi - THREE.MathUtils.degToRad(P.foldPhase)), 0, 1);
  const sm = (a: number) => {
    const x = (P.roofWaves * (a - F.ph)) / (2 * Math.PI);
    if (P.plateau <= 0) return 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    const fr = x - Math.floor(x), tri = 1 - Math.abs(2 * fr - 1);
    const trap = THREE.MathUtils.clamp((tri - 0.5) / Math.max(0.03, 1 - P.plateau) + 0.5, 0, 1);
    return smooth01(trap) * (1 - fold) + trap * fold;            // rounded shoulders when soft, crisp when folded
  };
  const shift = inner ? fold * 0.5 * (2 * Math.PI / F.n) : 0;
  const poly = facetLerp(F, phi - shift, (k) => sm(F.ph + F.a[k]) + F.crown[k]);
  const w = sm(phi) * (1 - fold) + poly * fold;
  const tilt = P.tilt * Math.cos(phi - THREE.MathUtils.degToRad(P.tiltPhase));
  const lean = facetLerp(F, phi, (k) => F.lean[k]) * P.leanVar * fold;
  const dp = wrapPi(phi - THREE.MathUtils.degToRad(P.prowPhase)), pw = THREE.MathUtils.degToRad(Math.max(4, P.prowWidth));
  const out = P.prow * Math.exp(-(dp / pw) * (dp / pw));
  return { H: base + P.roofAmp * w + tilt, fold, inset: P.inset + lean, out };
}

interface Section { d: number[]; h: number[]; t: number[]; nd: number[]; nh: number[]; hullTop: number; }

/** The section at one path point, in (d outward from the outer line, h up): hull, eave, roof. */
function section(P: FacadeParams, C: Crown, HF: number, L0: number): Section {
  const d: number[] = [], h: number[] = [], fold = C.fold, out = C.out, L = L0 + out;
  const R = Math.min(P.eave, C.H - 6), Hh = Math.max(C.H - R, 25.6), H = Hh + R;   // the hull clears the top row of the stands
  for (let j = 0; j < NH; j++) {                                   // hull: vertical at the top, drawn in at the ground
    const hh = (j / (NH - 1)) * Hh, u = 1 - hh / Hh;
    d.push(out - C.inset * ((1 - fold) * u * u + fold * u)); h.push(hh);
  }
  const span = L - R, dRise = HF - H;
  const alpha = THREE.MathUtils.clamp(Math.atan2(dRise + P.bulge * (fold > 0.5 ? 2 : Math.PI), span), -0.5, 1.0);
  const sweep = Math.PI / 2 - alpha;
  const e0 = [out, Hh], e1 = [out - R + R * Math.cos(sweep), Hh + R * Math.sin(sweep)];
  for (let j = 1; j <= NE; j++) {                                  // eave: an arc, or a chamfer when folded
    const a = (j / NE) * sweep, f = j / NE;
    const arc = [out - R + R * Math.cos(a), Hh + R * Math.sin(a)], chord = [e0[0] + (e1[0] - e0[0]) * f, e0[1] + (e1[1] - e0[1]) * f];
    d.push(arc[0] * (1 - fold) + chord[0] * fold); h.push(arc[1] * (1 - fold) + chord[1] * fold);
  }
  const d0 = e1[0], h0 = e1[1], dF = -L0;
  for (let j = 1; j <= NR; j++) {                                  // roof: arched, or two flat planes and a ridge when folded
    const f = j / NR, arch = Math.sin(Math.PI * f), ridge = 1 - Math.abs(2 * f - 1);
    d.push(d0 + (dF - d0) * f); h.push(h0 + (HF - h0) * f + P.bulge * (arch * (1 - fold) + ridge * fold));
  }
  const t = [0], nd: number[] = [], nh: number[] = [];
  for (let j = 1; j < NS; j++) t.push(t[j - 1] + Math.hypot(d[j] - d[j - 1], h[j] - h[j - 1]));
  for (let j = 0; j < NS; j++) {
    const a = Math.max(0, j - 1), b = Math.min(NS - 1, j + 1), td = d[b] - d[a], th = h[b] - h[a], l = Math.hypot(td, th) || 1;
    nd.push(th / l); nh.push(-td / l);
  }
  return { d, h, t, nd, nh, hullTop: t[NH - 1] };
}

/** interpolate a section at arc length s */
function at(S: Section, s: number) {
  let j = 0;
  while (j < NS - 2 && S.t[j + 1] < s) j++;
  const f = THREE.MathUtils.clamp((s - S.t[j]) / ((S.t[j + 1] - S.t[j]) || 1), 0, 1);
  const lerp = (a: number[]) => a[j] + (a[j + 1] - a[j]) * f;
  const nd = lerp(S.nd), nh = lerp(S.nh), l = Math.hypot(nd, nh) || 1;
  return { d: lerp(S.d), h: lerp(S.h), nd: nd / l, nh: nh / l };
}

function perimeter(path: PathPt[]) { return path[1].s * path.length; }

/** sweep section samples j0..j1 round the path; uv from a callback */
function sweep(path: PathPt[], secs: Section[], j0: number, j1: number, uvOf: (i: number, j: number, S: Section, s: number) => [number, number]) {
  const n = path.length, per = perimeter(path), m = j1 - j0 + 1, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = path[i % n], S = secs[i % n], s = i === n ? per : p.s;
    for (let j = j0; j <= j1; j++) { pos.push(p.x + p.nx * S.d[j], S.h[j], p.y + p.ny * S.d[j]); uv.push(...uvOf(i, j, S, s)); }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) { const a = i * m + j, b = (i + 1) * m + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** the roof's inner edge and its underside, back to the top of the hull */
function underside(path: PathPt[], secs: Section[]) {
  const n = path.length, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = path[i % n], S = secs[i % n], dF = S.d[NS - 1], hF = S.h[NS - 1], dB = S.d[NH - 1] - 0.3, hB = S.h[NH - 1] - 0.4;
    const P3 = (d: number, h: number) => pos.push(p.x + p.nx * d, h, p.y + p.ny * d);
    P3(dF, hF); P3(dF, hF - EDGE); P3(dB, hB);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = (i + 1) * 3 + j; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function finField(P: FacadeParams, s: number, per: number, t: number, tLen: number, tEnd: number, hullTop: number) {
  const u = s / per, a = 2 * Math.PI * (P.waves * u + P.twist * t / hullTop) + P.finChaos * (2.2 * Math.sin(2 * Math.PI * 2 * u + 0.7) + 1.3 * Math.sin(2 * Math.PI * 5 * u + 2.1));
  const theta = THREE.MathUtils.degToRad(P.angle) * Math.sin(a);
  const depthWave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (P.depthWaves * s / per) + 1.3);
  const start = THREE.MathUtils.smoothstep(t, 0, 2.5);
  const end = P.ribs > 0.5 ? smooth01(THREE.MathUtils.clamp((tEnd - t) / Math.min(10, tLen * 0.5), 0, 1)) : 1 - 0.45 * THREE.MathUtils.smoothstep(t, tEnd - 3, tEnd);
  return { theta, depth: (P.depthMin + (P.depthMax - P.depthMin) * depthWave) * (0.35 + 0.65 * start) * (0.15 + 0.85 * end) };
}

function fins(P: FacadeParams, path: PathPt[], secs: Section[]) {
  const per = perimeter(path), pos: number[] = [], idx: number[] = [], tip: number[] = [], tipS: number[] = [], tipH: number[] = [];
  const cols: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  const colEvery = Math.max(2, Math.round(16 / P.finStep));
  path.forEach((p, i) => {
    const S = secs[i], tx = -p.ny, ty = p.nx, base = pos.length / 3;
    let t0 = 0;                                                       // where the fin starts: at the lift height on the hull
    if (P.lift > 0) { let j = 0; while (j < NH - 1 && S.h[j + 1] < P.lift) j++; const f = (P.lift - S.h[j]) / ((S.h[j + 1] - S.h[j]) || 1); t0 = S.t[j] + (S.t[j + 1] - S.t[j]) * THREE.MathUtils.clamp(f, 0, 1); }
    const tEnd = Math.min(S.hullTop + P.ribs, S.t[NS - 1] - 1.5), tLen = tEnd - t0;
    let prev: number[] | null = null;
    for (let k = 0; k <= LEVELS; k++) {
      const t = t0 + (k / LEVELS) * tLen, q = at(S, t);
      const { theta, depth } = finField(P, p.s, per, t - t0, tLen, tLen, S.hullTop - t0);
      const N = [p.nx * q.nd, q.nh, p.ny * q.nd], T = [tx, 0, ty], c = Math.cos(theta), sn = Math.sin(theta);
      const dir = [c * N[0] + sn * T[0], c * N[1] + sn * T[1], c * N[2] + sn * T[2]];
      const B = [p.x + p.nx * q.d, q.h, p.y + p.ny * q.d], E = [B[0] + dir[0] * depth, B[1] + dir[1] * depth, B[2] + dir[2] * depth];
      pos.push(...B, ...E);
      if (prev) { tip.push(...prev, ...E); tipS.push(p.s / per, p.s / per); tipH.push((k - 1) / LEVELS, k / LEVELS); }
      prev = E;
      if (k === 0 && P.lift > 0.5 && i % colEvery === 0) {
        // raking columns in a V: from the foot of the hull out to the fin bases either side
        const foot = new THREE.Vector3(p.x + p.nx * S.d[0], 0, p.y + p.ny * S.d[0]);
        for (const di of [-2, 2]) {
          const pj = path[(i + di + path.length) % path.length], Sj = secs[(i + di + path.length) % path.length], qj = at(Sj, t0);
          cols.push({ a: foot, b: new THREE.Vector3(pj.x + pj.nx * qj.d, qj.h, pj.y + pj.ny * qj.d) });
        }
      }
    }
    for (let k = 0; k < LEVELS; k++) { const a = base + 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const t = new THREE.BufferGeometry();
  t.setAttribute('position', new THREE.Float32BufferAttribute(tip, 3));
  t.setAttribute('aS', new THREE.Float32BufferAttribute(tipS, 1));
  t.setAttribute('aH', new THREE.Float32BufferAttribute(tipH, 1));
  return { fins: g, tips: t, cols };
}

function columnsMesh(cols: { a: THREE.Vector3; b: THREE.Vector3 }[], mat: THREE.Material) {
  const geo = new THREE.CylinderGeometry(0.22, 0.32, 1, 8); geo.translate(0, 0.5, 0);
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cols.length));
  const up = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Sc = new THREE.Vector3();
  cols.forEach((c, k) => { const v = c.b.clone().sub(c.a), l = v.length(); Q.setFromUnitVectors(up, v.normalize()); Sc.set(1, l, 1); M.compose(c.a, Q, Sc); m.setMatrixAt(k, M); });
  m.count = cols.length; m.instanceMatrix.needsUpdate = true;
  return m;
}

/** a flat ring on the ground from just inside the hull foot out to 30 m beyond the facade line */
function apron(path: PathPt[], secs: Section[]) {
  const n = path.length, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) { const p = path[i % n], d0 = secs[i % n].d[0] - 0.2, d1 = Math.max(30, d0 + 22); pos.push(p.x + p.nx * d0, 0.02, p.y + p.ny * d0, p.x + p.nx * d1, 0.02, p.y + p.ny * d1); }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function lineThrough(path: PathPt[], heights: number[], d: number) {
  const pts = [...path, path[0]].map((p, i) => new THREE.Vector3(p.x + p.nx * d, heights[i % path.length], p.y + p.ny * d));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// Concourse levels that glow behind the glass, in metres above the ground.
const BANDS: [number, number, number][] = [[0.4, 4.6, 1.0], [9.4, 12.8, 0.75], [18.8, 22.4, 0.6]];

function hullTexture(top: number) {
  const W = 128, H = 1024, y = (h: number) => (1 - h / top) * H;
  const emit = document.createElement('canvas'); emit.width = W; emit.height = H;
  const e = emit.getContext('2d')!;
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  for (const [h0, h1, k] of BANDS) {
    const g = e.createLinearGradient(0, y(h1), 0, y(h0));
    g.addColorStop(0, `rgba(255,214,150,${k})`); g.addColorStop(0.35, `rgba(255,196,128,${0.75 * k})`); g.addColorStop(1, `rgba(255,170,100,${0.45 * k})`);
    e.fillStyle = g; e.fillRect(0, y(h1), W, y(h0) - y(h1));
  }
  e.fillStyle = '#000';
  e.fillRect(0, 0, 3, H);
  for (const [h0, h1] of BANDS) { e.fillRect(0, y(h1) - 3, W, 6); e.fillRect(0, y(h0) - 2, W, 4); }
  const map = new THREE.CanvasTexture(emit);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.anisotropy = 8;
  return map;
}

/** silver membrane with a diamond lattice and fine perforation, one diamond per fin module */
export function membraneTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = 4; y < 128; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < 128; x += 8) { g.beginPath(); g.arc(x, y, 1.6, 0, 6.283); g.fill(); }
  g.strokeStyle = 'rgba(40,50,62,0.55)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** the roof glows faintly from below, brightest in a translucent band along the inner edge */
function roofGlowTexture() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 512;
  const g = c.getContext('2d')!, grd = g.createLinearGradient(0, 512, 0, 0);   // flipY: canvas bottom is v = 0, the inner edge
  grd.addColorStop(0, 'rgba(190,214,236,1)'); grd.addColorStop(0.16, 'rgba(150,180,210,0.75)'); grd.addColorStop(0.19, 'rgba(40,52,66,1)'); grd.addColorStop(1, 'rgba(14,18,24,1)');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function finGlowTexture() {
  // warm spill from the concourse on the inner edge of each fin, fading towards the tip
  const c = document.createElement('canvas'); c.width = 64; c.height = 4;
  const g = c.getContext('2d')!, grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, 'rgba(214,150,84,1)'); grd.addColorStop(0.55, 'rgba(60,40,22,1)'); grd.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function tipMaterial(clip: THREE.Plane[]) {
  // LED on each fin tip, with two bright pulses travelling round the stadium
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#73d9ff') }, uSpeed: { value: 0.06 }, uGain: { value: 1 } }, clipping: true, clippingPlanes: clip, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `#include <clipping_planes_pars_vertex>
      attribute float aS; attribute float aH; varying float vS; varying float vH;
      void main(){ vS = aS; vH = aH; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform float uTime, uSpeed, uGain; uniform vec3 uColor; varying float vS; varying float vH;
      void main(){
        #include <clipping_planes_fragment>
        float w = fract(2.0 * vS - uTime * uSpeed - 0.35 * vH);
        float pulse = exp(-pow((w - 0.5) * 9.0, 2.0));
        vec3 c = uColor * uGain * (0.22 + 1.1 * pulse) * (0.55 + 0.45 * vH);
        gl_FragColor = vec4(c, 1.0); }`,
  });
}

export function Envelope({ hx, hy, rc, back, front, top, frontTop, clip, params, shadows = false }: EnvelopeProps) {
  const P = useMemo(() => ({ ...DEFAULT_FACADE, ...params }), [params]);
  const shapeKey = SHAPE_KEYS.map((k) => P[k]).join(',');
  const L = back - front;
  const parts = useMemo(() => {
    const rOut = rc + back, rIn = rc + front, F = facetTable(P);
    const sectionsFor = (path: PathPt[]) => path.map((p) => {
      const phi = phiOf(p, rOut), C = crownAt(P, F, phi, top), HF = crownAt(P, F, phi, frontTop, true).H;
      return section(P, C, Math.max(HF, 27), L);
    });
    const line = roundedRect(hx + back, hy + back, rc + back, P.finStep), lineSecs = sectionsFor(line);
    const fine = roundedRect(hx + back, hy + back, rc + back, 0.9), fineSecs = sectionsFor(fine);
    const f = fins(P, line, lineSecs);
    const hull = sweep(fine, fineSecs, 0, NH - 1, (_i, j, S, s) => [s / 4, S.h[j] / top]);
    const roof = sweep(fine, fineSecs, NH - 1, NS - 1, (_i, j, S, s) => [s / P.finStep, (S.t[NS - 1] - S.t[j])]);
    const under = underside(fine, fineSecs);
    // inner edge: LED line, floodlight row and its light line, all following the roofline
    const inner = roundedRect(hx + front, hy + front, rIn, 0.9), lampPath = roundedRect(hx + front, hy + front, rIn, 3.4);
    const hfAt = (p: PathPt) => Math.max(crownAt(P, F, phiOf(p, rIn), frontTop, true).H, 27);
    const innerH = inner.map(hfAt);
    const led = lineThrough(inner, innerH.map((h) => h - 0.7), 0);
    const lightLine = lineThrough(inner, innerH.map((h) => h - 1.5), 1.2);
    const lampPos: number[] = [];
    lampPath.forEach((p) => { const h = hfAt(p) - 1.7; lampPos.push(p.x + p.nx * 0.8, h, p.y + p.ny * 0.8); });
    const lampGeo = new THREE.BufferGeometry(); lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
    const plaza = roundedRect(hx + back + 16, hy + back + 16, rc + back + 16, 17), plazaPos: number[] = [];
    plaza.forEach((p) => { const o = crownAt(P, F, phiOf(p, rc + back + 16), top).out; plazaPos.push(p.x + p.nx * o, 7, p.y + p.ny * o); });
    const plazaGeo = new THREE.BufferGeometry(); plazaGeo.setAttribute('position', new THREE.Float32BufferAttribute(plazaPos, 3));
    return { ...f, hull, roof, under, apron: apron(fine, fineSecs), led, lightLine, lampGeo, plazaGeo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hx, hy, rc, back, front, top, frontTop, shapeKey]);
  useEffect(() => () => { for (const g of [parts.fins, parts.tips, parts.hull, parts.roof, parts.under, parts.apron, parts.led, parts.lightLine, parts.lampGeo, parts.plazaGeo]) g.dispose(); }, [parts]);

  const tex = useMemo(() => {
    const membrane = membraneTexture(), roofGlow = roofGlowTexture();
    membrane.repeat.set(1, 1 / 2.2);                     // one diamond per fin module across, 2.2 m along the section
    roofGlow.repeat.set(1, 1 / 48);                      // v in metres from the inner edge; 48 m spans the roof
    const skinMap = membraneTexture(); skinMap.repeat.set(2, top / 2.6);   // hull uv: u per 4 m module, v = h / top
    return { hull: hullTexture(top), finGlow: finGlowTexture(), glow: glowTexture(), membrane, roofGlow, skinMap };
  }, [top]);
  const mats = useMemo(() => ({
    fin: new THREE.MeshStandardMaterial({ color: '#c9d0d8', metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.finGlow, emissiveIntensity: 0.55, clippingPlanes: clip }),
    hull: new THREE.MeshStandardMaterial({ color: '#10141a', metalness: 0.5, roughness: 0.25, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.hull, emissiveIntensity: 0.85, clippingPlanes: clip }),
    roof: new THREE.MeshStandardMaterial({ color: '#cfd4da', map: tex.membrane, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.roofGlow, emissiveIntensity: 0.4, clippingPlanes: clip }),
    skin: new THREE.MeshStandardMaterial({ color: '#cfd4da', map: tex.skinMap, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex.hull, emissiveIntensity: 0.5, clippingPlanes: clip }),
    under: new THREE.MeshStandardMaterial({ color: '#1f242c', emissive: '#11151d', roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide, clippingPlanes: clip }),
    steel: new THREE.MeshStandardMaterial({ color: '#d7dce2', metalness: 0.5, roughness: 0.4, clippingPlanes: clip }),
    apron: new THREE.MeshStandardMaterial({ color: '#474b52', roughness: 0.95, clippingPlanes: clip }),
    tip: tipMaterial(clip),
    led: new THREE.LineBasicMaterial({ color: '#73d9ff', toneMapped: false, clippingPlanes: clip }),
    light: new THREE.LineBasicMaterial({ color: '#fff6e0', toneMapped: false, clippingPlanes: clip }),
    lampCore: glowMaterial(tex.glow, clip, 1.4, 3, '#fff7e6', 1.0),
    lampHalo: glowMaterial(tex.glow, clip, 9, 10, '#ffe9c2', 0.22),
    plazaCore: glowMaterial(tex.glow, clip, 0.6, 2, '#ffd9a6', 1.0),
    plazaHalo: glowMaterial(tex.glow, clip, 5, 5, '#ffcf96', 0.16),
  }), [tex, clip]);
  useEffect(() => {
    const hard = P.fold + Math.abs(P.foldVar) > 0.5;
    mats.roof.flatShading = hard; mats.roof.needsUpdate = true;
    mats.under.flatShading = hard; mats.under.needsUpdate = true;
  }, [mats, P.fold, P.foldVar]);
  useEffect(() => {
    const on = Math.min(1, P.glow / 0.85);
    mats.fin.color.set(P.finColor); mats.fin.emissiveIntensity = 0.65 * P.glow;
    mats.hull.emissiveIntensity = P.glow;
    mats.roof.color.set(P.roofColor); mats.roof.emissiveIntensity = 0.45 * P.glow;
    mats.skin.color.set(P.roofColor); mats.skin.emissiveIntensity = 0.55 * P.glow;   // the concourses glow through the membrane
    mats.tip.uniforms.uColor.value.set(P.ledColor); mats.tip.uniforms.uSpeed.value = P.ledSpeed; mats.tip.uniforms.uGain.value = P.ledGain;
    mats.led.color.set(P.ledColor);
    mats.lampCore.uniforms.uOpacity.value = on; mats.lampHalo.uniforms.uOpacity.value = 0.22 * on;
    mats.plazaCore.uniforms.uOpacity.value = on; mats.plazaHalo.uniforms.uOpacity.value = 0.16 * on;
  }, [mats, P]);
  const objs = useMemo(() => ({
    tips: new THREE.LineSegments(parts.tips, mats.tip),
    led: new THREE.Line(parts.led, mats.led),
    light: new THREE.Line(parts.lightLine, mats.light),
    cols: columnsMesh(parts.cols, mats.steel),
  }), [parts, mats]);
  useEffect(() => { objs.cols.castShadow = shadows; objs.cols.visible = parts.cols.length > 0; return () => { objs.cols.dispose(); }; }, [objs, parts, shadows]);
  useFrame(({ clock, size, camera }) => {
    mats.tip.uniforms.uTime.value = clock.elapsedTime;
    const f = focalPx(size.height, (camera as THREE.PerspectiveCamera).fov);
    for (const m of [mats.lampCore, mats.lampHalo, mats.plazaCore, mats.plazaHalo]) m.uniforms.uFocal.value = f;
  });
  return (
    <group>
      <mesh geometry={parts.hull} material={P.skin > 0.5 ? mats.skin : mats.hull} castShadow={shadows && P.skin > 0.5} receiveShadow={shadows} />
      {/* fins stand in front of the glass (skin 0) or the membrane (skin 2); skin 1 is the bare membrane */}
      <mesh geometry={parts.roof} material={mats.roof} castShadow={shadows} receiveShadow={shadows} />
      <mesh geometry={parts.under} material={mats.under} />
      <mesh geometry={parts.fins} material={mats.fin} castShadow={shadows} receiveShadow={shadows} visible={P.skin < 0.5 || P.skin > 1.5} />
      <primitive object={objs.tips} visible={P.skin < 0.5 || P.skin > 1.5} />
      <primitive object={objs.cols} />
      <primitive object={objs.led} />
      <primitive object={objs.light} />
      <mesh geometry={parts.apron} material={mats.apron} receiveShadow={shadows} />
      <points geometry={parts.lampGeo} material={mats.lampHalo} />
      <points geometry={parts.lampGeo} material={mats.lampCore} />
      <points geometry={parts.plazaGeo} material={mats.plazaHalo} />
      <points geometry={parts.plazaGeo} material={mats.plazaCore} />
    </group>
  );
}
