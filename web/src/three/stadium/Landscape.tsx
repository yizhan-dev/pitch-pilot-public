import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glowTexture, glowMaterial, focalPx } from './glow';
import { GROUND_TONE } from './night';

// The ground the stadium stands on: a stone plinth with a sharp sill and a flight of steps all round (the
// "chassis" under the body). Optional, off by default since Yi asked to keep the ground simple: a paved plaza whose
// joints follow the building's outline with lamp posts (plaza), and reflecting pools with jets (fountain).

/** one station round the building's outline at ground level */
export interface GroundPt { o: THREE.Vector3; inw: THREE.Vector3; inner: THREE.Vector3; }
/** a pool: centre on the ground, unit direction along its length */
export interface PoolSpec { c: THREE.Vector3; dir: THREE.Vector3; L: number; W: number; jets: number; }
export interface LandscapeSpec { loop: GroundPt[]; pools: PoolSpec[]; octagon: THREE.Vector3[]; }
export interface LandscapeParams { deckH: number; deckOut: number; stepT: number; plazaW: number; plaza: number; fountain: number; stepLed: number; ground: number; groundStyle: number; lampStep: number; glow: number; }

const STEP_R = 0.3;                                   // riser height
const SILL = { nose: 0.35, recess: 0.7 };             // the deck's front edge and the deep shadow gap under it: the sill line

// (each toned for the night outside, night.ts GROUND_TONE)
const COL = {
  deck: new THREE.Color('#d6d1c6').multiplyScalar(GROUND_TONE), nose: new THREE.Color('#e2ddd3').multiplyScalar(GROUND_TONE), recess: new THREE.Color('#1c1d20'),
  tread: new THREE.Color('#cbc6bb').multiplyScalar(GROUND_TONE), riser: new THREE.Color('#aaa59b').multiplyScalar(GROUND_TONE),
};

/** offsets of the plinth's section, measured outwards from the body outline: [offset, height, colour of the segment that starts here] */
function profile(P: LandscapeParams) {
  const n = Math.max(1, Math.round(P.deckH / STEP_R)), r = P.deckH / n, pts: [number, number, THREE.Color][] = [];
  pts.push([0, P.deckH, COL.deck]);                                       // (the inner edge is added per station)
  pts.push([P.deckOut, P.deckH, COL.nose]);                               // deck top to the sill
  pts.push([P.deckOut, P.deckH - SILL.nose, COL.recess]);                 // nose face
  pts.push([P.deckOut - SILL.recess, P.deckH - SILL.nose, COL.recess]);   // underside of the nose
  pts.push([P.deckOut - SILL.recess, P.deckH - r, COL.tread]);            // recessed first riser
  for (let k = 1; k <= n; k++) {
    const x0 = P.deckOut + (k - 1) * P.stepT, h = P.deckH - k * r;
    pts.push([x0 + P.stepT, h, k < n ? COL.riser : COL.tread]);            // tread
    if (k < n) pts.push([x0 + P.stepT, h - r, COL.tread]);                 // riser
  }
  return { pts, outer: P.deckOut + n * P.stepT };
}

/** every riser of the plinth: its offset from the outline and its top and bottom heights */
function risers(P: LandscapeParams) {
  const n = Math.max(1, Math.round(P.deckH / STEP_R)), r = P.deckH / n, out: { x: number; top: number; bot: number }[] = [];
  out.push({ x: P.deckOut - SILL.recess, top: P.deckH - SILL.nose, bot: P.deckH - r });     // the recessed riser under the sill
  for (let k = 1; k < n; k++) out.push({ x: P.deckOut + k * P.stepT, top: P.deckH - k * r, bot: P.deckH - (k + 1) * r });
  return out;
}

/** light strips tucked under each nosing, and the wash they throw down each riser (aV: 0 at the strip, 1 at the riser's foot) */
function stepLights(loop: GroundPt[], P: LandscapeParams) {
  const M = loop.length, pos: number[] = [], v: number[] = [], idx: number[] = [], strips: THREE.BufferGeometry[] = [];
  const at = (g: GroundPt, d: number, h: number) => g.o.clone().addScaledVector(g.inw, -d).setY(h);
  let base = 0;
  for (const rs of risers(P)) {
    for (let i = 0; i <= M; i++) {
      const g = loop[i % M], a = at(g, rs.x + 0.015, rs.top - 0.02), b = at(g, rs.x + 0.015, rs.bot);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); v.push(0, 1);
    }
    for (let i = 0; i < M; i++) { const a = base + 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    base += 2 * (M + 1);
    strips.push(new THREE.BufferGeometry().setFromPoints([...loop, loop[0]].map((g) => at(g, rs.x + 0.03, rs.top - 0.035))));
  }
  const wash = new THREE.BufferGeometry();
  wash.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wash.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
  wash.setIndex(idx);
  return { wash, strips };
}

function washMaterial(clip: THREE.Plane[]) {
  return new THREE.ShaderMaterial({
    uniforms: { uOn: { value: 1 }, uColor: { value: new THREE.Color('#ffd9a8') } }, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, clipping: true, clippingPlanes: clip, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: `#include <clipping_planes_pars_vertex>
      attribute float aV; varying float vV;
      void main(){ vV = aV; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform float uOn; uniform vec3 uColor; varying float vV;
      void main(){
        #include <clipping_planes_fragment>
        float k = exp(-vV * 2.6) * 1.25 + 0.1;
        gl_FragColor = vec4(uColor * k * uOn, 1.0); }`,
  });
}

function plinthGeometry(loop: GroundPt[], P: LandscapeParams) {
  const { pts } = profile(P), M = loop.length, pos: number[] = [], col: number[] = [], idx: number[] = [];
  let base = 0;
  // one strip per profile segment, so the stone edges stay crisp across the section and smooth along the loop
  const seg = (pa: (g: GroundPt) => THREE.Vector3, pb: (g: GroundPt) => THREE.Vector3, c: THREE.Color) => {
    for (let i = 0; i <= M; i++) {
      const g = loop[i % M], a = pa(g), b = pb(g);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < M; i++) { const a = base + 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    base += 2 * (M + 1);
  };
  const at = (g: GroundPt, d: number, h: number) => g.o.clone().addScaledVector(g.inw, -d).setY(h);
  seg((g) => g.inner.clone().setY(P.deckH), (g) => at(g, pts[0][0], pts[0][1]), COL.deck);
  for (let j = 0; j < pts.length - 1; j++) seg((g) => at(g, pts[j][0], pts[j][1]), (g) => at(g, pts[j + 1][0], pts[j + 1][1]), pts[j][2]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  // the strips' winding depends on the loop direction; make every normal face up or out
  const nA = geo.getAttribute('normal');
  if (nA.getY(0) < 0) { const ix = geo.getIndex()!; for (let k = 0; k < ix.count; k += 3) { const t = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, t); } geo.computeVertexNormals(); }
  return geo;
}

/** the plaza: a strip from the foot of the steps out to plazaW, then a fade; aDist = metres from the foot of the steps */
function plazaGeometry(loop: GroundPt[], P: LandscapeParams, outer: number) {
  const M = loop.length, rows = [0, P.plazaW * 0.5, P.plazaW, P.plazaW + 22], pos: number[] = [], dist: number[] = [], idx: number[] = [];
  for (let i = 0; i <= M; i++) {
    const g = loop[i % M];
    for (const d of rows) { const p = g.o.clone().addScaledVector(g.inw, -(outer + d)); pos.push(p.x, 0.05, p.z); dist.push(d); }
  }
  const nr = rows.length;
  for (let i = 0; i < M; i++) for (let r = 0; r < nr - 1; r++) { const a = i * nr + r, b = (i + 1) * nr + r; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dist, 1));
  geo.setIndex(idx); geo.computeVertexNormals();
  if (geo.getAttribute('normal').getY(0) < 0) { const ix = geo.getIndex()!; for (let k = 0; k < ix.count; k += 3) { const t = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, t); } geo.computeVertexNormals(); }
  return geo;
}

/** paving: radial joints towards the stadium and rings parallel to its outline, dark granite bands, a little tone per slab */
function plazaMaterial(P: LandscapeParams, clip: THREE.Plane[]) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, transparent: true, depthWrite: false, clippingPlanes: clip });
  const u = { uFade: { value: P.plazaW }, uGlow: { value: P.glow } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDist; varying float vDist; varying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist; vWp = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vDist; varying vec3 vWp; uniform float uFade, uGlow;
        float pvHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pvLine(float d, float w) { float aa = fwidth(d) * 1.2 + 1e-4; return 1.0 - smoothstep(w, w + aa, d); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 pw = vWp.xz; float ang = atan(pw.y, pw.x), rad = length(pw);
        float K = 180.0, kk = ang / 6.28318 * K, ki = floor(kk);
        float rayD = abs(fract(kk) - 0.5) * 6.28318 / K * rad;              // metres to the nearest radial joint
        float ringD = abs(fract(vDist / 2.4) - 0.5) * 2.4;                   // metres to the nearest ring joint
        float joints = max(pvLine(rayD, 0.035), pvLine(ringD, 0.035));
        float tone = pvHash(vec2(ki, floor(vDist / 2.4)));
        vec3 stone = mix(vec3(0.18, 0.175, 0.165), vec3(0.215, 0.21, 0.197), tone);   // linear: a warm mid grey granite
        float band = 0.0;
        band = max(band, pvLine(abs(vDist - 4.0), 0.5));
        band = max(band, pvLine(abs(vDist - 12.0), 0.25));
        band = max(band, pvLine(abs(vDist - 26.0), 0.9));
        band = max(band, pvLine(abs(vDist - 44.0), 0.25));
        stone = mix(stone, vec3(0.035, 0.038, 0.045), band);
        stone *= 1.0 - 0.28 * joints * (1.0 - band);
        diffuseColor.rgb = stone;
        diffuseColor.a *= 1.0 - smoothstep(uFade, uFade + 20.0, vDist);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // a dotted line of warm uplights in the wide band
        float dotOn = mod(ki, 6.0) < 0.5 ? 1.0 : 0.0;
        float dotD = length(vec2(abs(fract(kk) - 0.5) * 6.28318 / K * rad, vDist - 26.0));
        totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * uGlow * 1.6 * dotOn * (1.0 - smoothstep(0.12, 0.32, dotD));`);
  };
  m.customProgramCacheKey = () => 'plaza-v3';
  return { m, u };
}

/** the octagonal ground, a ring from just under the foot of the steps out to the octagon; aEdge = metres to its edge.
 *  Built as a radial strip (both outlines are star-shaped about the centre), with the octagon's corners as exact stations. */
function octagonGeometry(oct: THREE.Vector3[], hole: THREE.Vector3[]) {
  const n = oct.length, c = oct.reduce((a, p) => a.clone().add(p), new THREE.Vector3()).multiplyScalar(1 / n);
  const ang = (p: THREE.Vector3) => Math.atan2(p.z - c.z, p.x - c.x);
  const H = hole.map((p) => ({ a: ang(p), r: Math.hypot(p.x - c.x, p.z - c.z) })).sort((u, v) => u.a - v.a);
  const holeR = (a: number) => {
    let j = H.findIndex((h) => h.a > a); if (j < 0) j = 0;
    const p = H[(j - 1 + H.length) % H.length], q = H[j];
    const pa = p.a > a ? p.a - 2 * Math.PI : p.a, qa = q.a < pa ? q.a + 2 * Math.PI : q.a;
    return p.r + (q.r - p.r) * THREE.MathUtils.clamp((a - pa) / ((qa - pa) || 1), 0, 1);
  };
  const edges = oct.map((a, i) => { const b = oct[(i + 1) % n], ab = b.clone().sub(a); let nr = new THREE.Vector3(ab.z, 0, -ab.x).normalize(); if (c.clone().sub(a).dot(nr) < 0) nr = nr.negate(); return { a, nr }; });
  // distance from the centre to the octagon along direction (cos a, sin a): the nearest edge the ray crosses
  const octR = (a: number) => {
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    let best = Infinity;
    for (const e of edges) { const den = -d.dot(e.nr); if (den > 1e-6) { const t = c.clone().sub(e.a).dot(e.nr) / den; if (t > 0) best = Math.min(best, t); } }
    return best;
  };
  const stations = [...H.map((h) => h.a), ...oct.map(ang)].sort((u, v) => u - v);
  const pos: number[] = [], edge: number[] = [], idx: number[] = [];
  const dEdge = (x: number, z: number) => Math.min(...edges.map((e) => (x - e.a.x) * e.nr.x + (z - e.a.z) * e.nr.z));
  stations.forEach((a) => {
    const ri = holeR(a), ro = octR(a), ca = Math.cos(a), sa = Math.sin(a);
    const xi = c.x + ca * ri, zi = c.z + sa * ri, xo = c.x + ca * ro, zo = c.z + sa * ro;
    pos.push(xi, 0.02, zi, xo, 0.02, zo); edge.push(dEdge(xi, zi), 0);
  });
  const m = stations.length;
  for (let k = 0; k < m; k++) { const a = 2 * k, b = 2 * ((k + 1) % m); idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx); g.computeVertexNormals();
  if (g.getAttribute('normal').getY(0) < 0) { const ix = g.getIndex()!; for (let k = 0; k < ix.count; k += 3) { const t = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, t); } g.computeVertexNormals(); }
  return g;
}

/** the octagon ground, with a dark kerb round its edge. style 0: granite in large slabs; 1: one plain light grey;
 *  2: the same grey polished, so it catches the lights; 3: light grey with fine rings that follow the octagon */
function groundMaterial(clip: THREE.Plane[], style: number) {
  const s = Math.round(style);
  const m = new THREE.MeshStandardMaterial({ roughness: s === 2 ? 0.32 : 0.9, metalness: 0, envMapIntensity: s === 2 ? 0.9 : 1, clippingPlanes: clip });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge; varying float vEdge; varying vec3 vGp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge; vGp = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vEdge; varying vec3 vGp;
        float gdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 st;
        ${s === 0 ? `vec2 q = vGp.xz / 3.0, f = abs(fract(q) - 0.5);
        float aa = fwidth(q.x) * 1.5 + 1e-4, joint = 1.0 - smoothstep(0.012, 0.012 + aa, 0.5 - max(f.x, f.y));
        float tone = gdHash(floor(q));
        st = mix(vec3(0.15, 0.148, 0.142), vec3(0.17, 0.167, 0.16), tone);
        st *= 1.0 - 0.22 * joint;`
        : `st = vec3(0.42, 0.43, 0.44);                                         // linear: a cool light grey (#adafb0), a step below the stone steps
        ${s === 3 ? `float rd = abs(fract(vEdge / 7.0) - 0.5) * 7.0, ra = fwidth(vEdge) * 1.2 + 1e-4;
        st *= 1.0 - 0.16 * (1.0 - smoothstep(0.03, 0.03 + ra, rd)) * step(2.0, vEdge);` : ''}`}
        float ea = fwidth(vEdge) * 1.5 + 1e-4, kerb = 1.0 - smoothstep(0.9, 0.9 + ea, vEdge);
        st = mix(st, vec3(0.035, 0.037, 0.042), kerb);
        diffuseColor.rgb = st * ${GROUND_TONE.toFixed(3)};   // (the night outside: night.ts)`);
  };
  m.customProgramCacheKey = () => `octagon-v2-${s}-${GROUND_TONE}`;
  return m;
}

function poolGeometry(L: number, W: number, rim: number) {
  const rr = (w: number, h: number, r: number) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
  };
  const outer = rr(L + 2 * rim, W + 2 * rim, Math.min(W / 2, 2.4) + rim), inner = rr(L, W, Math.min(W / 2, 2.4));
  outer.holes.push(inner as unknown as THREE.Path);
  const rimGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.45, bevelEnabled: false, curveSegments: 10 });
  rimGeo.rotateX(-Math.PI / 2);
  const water = new THREE.ShapeGeometry(inner, 10); water.rotateX(-Math.PI / 2); water.translate(0, 0.32, 0);
  const floor = new THREE.ShapeGeometry(inner, 10); floor.rotateX(-Math.PI / 2); floor.translate(0, 0.05, 0);
  return { rimGeo, water, floor };
}

function jetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFocal: { value: 1000 }, uOn: { value: 1 } }, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `attribute vec3 aBase; attribute float aSeed; attribute float aJet; uniform float uTime, uFocal; varying float vA;
      void main(){
        float H = 2.4 + 3.6 * (0.5 + 0.5 * sin(uTime * 1.25 - aJet * 0.6));
        float ph = fract(aSeed * 7.13 + uTime * 0.5);
        float y = 4.0 * H * ph * (1.0 - ph);
        float a = aSeed * 61.0, sp = 0.18 + 0.5 * ph * ph;
        vec3 p = aBase + vec3(cos(a) * sp, 0.32 + y, sin(a) * sp);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.8, 0.16 * uFocal / -mv.z);
        vA = 0.9 * (1.0 - 0.6 * ph);
      }`,
    fragmentShader: `uniform float uOn; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
        gl_FragColor = vec4(mix(vec3(0.70, 0.80, 0.88), vec3(0.78, 0.96, 1.0), uOn), vA * (1.0 - smoothstep(0.25, 0.5, r))); }`,
  });
}

function jetPoints(pools: PoolSpec[]) {
  const base: number[] = [], seed: number[] = [], jet: number[] = [], PER = 260;
  pools.forEach((p) => {
    const side = new THREE.Vector3(-p.dir.z, 0, p.dir.x);
    for (let j = 0; j < p.jets; j++) {
      const t = p.jets === 1 ? 0 : (j / (p.jets - 1) - 0.5) * (p.L - 3);
      const c = p.c.clone().addScaledVector(p.dir, t).addScaledVector(side, 0);
      for (let k = 0; k < PER; k++) { base.push(c.x, c.y, c.z); seed.push(Math.random()); jet.push(j); }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(base, 3));      // bounding volume only
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute('aJet', new THREE.Float32BufferAttribute(jet, 1));
  g.computeBoundingSphere(); if (g.boundingSphere) g.boundingSphere.radius += 8;
  return g;
}

export function Landscape({ spec, params, clip, shadows }: { spec: LandscapeSpec; params: LandscapeParams; clip: THREE.Plane[]; shadows: boolean }) {
  const P = params;
  const geo = useMemo(() => {
    const { outer } = profile(P);
    const plinth = plinthGeometry(spec.loop, P), plaza = plazaGeometry(spec.loop, P, outer);
    // a sill light in the shadow gap under the deck's nose
    const sill = new THREE.BufferGeometry().setFromPoints([...spec.loop, spec.loop[0]].map((g) => g.o.clone().addScaledVector(g.inw, -(P.deckOut - SILL.recess - 0.02)).setY(P.deckH - SILL.nose - 0.12)));
    // lamp posts round the plaza, about every 26 m on a line 34 m out
    const lamps: THREE.Vector3[] = []; let acc = 0;
    const ring = spec.loop.map((g) => g.o.clone().addScaledVector(g.inw, -(outer + 34)));
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; acc += a.distanceTo(b); if (acc >= 26) { acc = 0; lamps.push(a.clone()); } }
    // street lamps along the octagon's edges, set 4 m in, about lampStep apart, one at every corner
    if (P.ground > 0.5 && spec.octagon.length) {
      lamps.length = 0;
      const oct = spec.octagon, n = oct.length, c = oct.reduce((a, p) => a.clone().add(p), new THREE.Vector3()).multiplyScalar(1 / n);
      for (let i = 0; i < n; i++) {
        const a = oct[i], b = oct[(i + 1) % n], L = a.distanceTo(b), k = Math.max(1, Math.round(L / P.lampStep));
        for (let j = 0; j < k; j++) { const p = a.clone().lerp(b, j / k); lamps.push(p.addScaledVector(c.clone().sub(p).setY(0).normalize(), 4)); }
      }
    }
    const pools = spec.pools.map((p) => ({ p, g: poolGeometry(p.L, p.W, 0.6) }));
    // the ring starts 2 cm under the last step, so the two never overlap on the same plane
    const hole = spec.loop.map((g) => g.o.clone().addScaledVector(g.inw, -(outer - 0.02)));
    // drop near-duplicate points (segment joins repeat a sample), or the triangulation leaves holes
    const octGeo = spec.octagon.length ? octagonGeometry(spec.octagon, hole) : null;
    return { plinth, plaza, sill, lamps, pools, jets: jetPoints(spec.pools), outer, steps: stepLights(spec.loop, P), octGeo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, P.deckH, P.deckOut, P.stepT, P.plazaW, P.ground, P.lampStep]);
  useEffect(() => () => { geo.plinth.dispose(); geo.plaza.dispose(); geo.sill.dispose(); geo.jets.dispose(); geo.steps.wash.dispose(); geo.steps.strips.forEach((g) => g.dispose()); geo.octGeo?.dispose(); geo.pools.forEach(({ g }) => { g.rimGeo.dispose(); g.water.dispose(); g.floor.dispose(); }); }, [geo]);
  const mats = useMemo(() => {
    const glow = glowTexture();
    return {
      stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, clippingPlanes: clip }),
      plaza: plazaMaterial(P, clip),
      sill: new THREE.LineBasicMaterial({ color: '#ffd9a6', toneMapped: false, transparent: true, clippingPlanes: clip }),
      strip: new THREE.LineBasicMaterial({ color: '#fff1dc', toneMapped: false, transparent: true, clippingPlanes: clip }),
      wash: washMaterial(clip),
      ground: groundMaterial(clip, P.groundStyle),
      rim: new THREE.MeshStandardMaterial({ color: '#d9d4ca', roughness: 0.8, clippingPlanes: clip }),
      water: new THREE.MeshStandardMaterial({ color: '#0d1b25', metalness: 0.9, roughness: 0.05, emissive: '#2a8fb0', emissiveIntensity: 0.0, clippingPlanes: clip }),
      floor: new THREE.MeshStandardMaterial({ color: '#203540', roughness: 0.6, clippingPlanes: clip }),
      jets: jetMaterial(),
      pole: new THREE.MeshStandardMaterial({ color: '#9aa1aa', metalness: 0.7, roughness: 0.35, clippingPlanes: clip }),
      lampCore: glowMaterial(glow, clip, 0.6, 2, '#ffd9a6', 1.0),
      lampHalo: glowMaterial(glow, clip, 5, 5, '#ffcf96', 0.16),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, P.groundStyle]);
  useEffect(() => {
    const on = Math.min(1, P.glow / 0.85);
    mats.plaza.u.uGlow.value = P.glow * on;
    mats.sill.opacity = on; mats.strip.opacity = on; mats.wash.uniforms.uOn.value = on * on;
    mats.water.emissiveIntensity = 0.35 * on;
    mats.jets.uniforms.uOn.value = on;
    mats.lampCore.uniforms.uOpacity.value = on; mats.lampHalo.uniforms.uOpacity.value = 0.16 * on;
  }, [mats, P.glow]);
  const objs = useMemo(() => {
    const poleGeo = new THREE.CylinderGeometry(0.045, 0.075, 6, 8); poleGeo.translate(0, 3, 0);
    const poles = new THREE.InstancedMesh(poleGeo, mats.pole, Math.max(1, geo.lamps.length)), Mx = new THREE.Matrix4();
    geo.lamps.forEach((p, k) => { Mx.makeTranslation(p.x, 0, p.z); poles.setMatrixAt(k, Mx); });
    poles.count = geo.lamps.length; poles.instanceMatrix.needsUpdate = true;
    const heads = new THREE.BufferGeometry(); heads.setAttribute('position', new THREE.Float32BufferAttribute(geo.lamps.flatMap((p) => [p.x, 6.1, p.z]), 3));
    return { poles, heads, sill: new THREE.Line(geo.sill, mats.sill), jets: new THREE.Points(geo.jets, mats.jets), strips: geo.steps.strips.map((g) => new THREE.Line(g, mats.strip)) };
  }, [geo, mats]);
  useEffect(() => () => objs.poles.geometry.dispose(), [objs]);
  useEffect(() => { objs.poles.castShadow = shadows; return () => { objs.poles.dispose(); objs.heads.dispose(); }; }, [objs, shadows]);
  useFrame(({ clock, size, camera }) => {
    const f = focalPx(size.height, (camera as THREE.PerspectiveCamera).fov);
    mats.jets.uniforms.uTime.value = clock.elapsedTime; mats.jets.uniforms.uFocal.value = f;
    mats.lampCore.uniforms.uFocal.value = f; mats.lampHalo.uniforms.uFocal.value = f;
  });
  return (
    <group>
      <mesh geometry={geo.plinth} material={mats.stone} castShadow={shadows} receiveShadow={shadows} />
      {P.plaza > 0.5 && <mesh geometry={geo.plaza} material={mats.plaza.m} receiveShadow={shadows} renderOrder={1} />}
      <primitive object={objs.sill} />
      {P.stepLed > 0.5 && <mesh geometry={geo.steps.wash} material={mats.wash} />}
      {P.stepLed > 0.5 && objs.strips.map((l, k) => <primitive key={k} object={l} />)}
      {P.fountain > 0.5 && geo.pools.map(({ p, g }, k) => {
        const ang = Math.atan2(-p.dir.z, p.dir.x);
        return (
          <group key={k} position={[p.c.x, 0, p.c.z]} rotation-y={ang}>
            <mesh geometry={g.rimGeo} material={mats.rim} castShadow={shadows} receiveShadow={shadows} />
            <mesh geometry={g.floor} material={mats.floor} />
            <mesh geometry={g.water} material={mats.water} receiveShadow={shadows} />
          </group>
        );
      })}
      {P.fountain > 0.5 && <primitive object={objs.jets} />}
      {P.ground > 0.5 && geo.octGeo && <mesh geometry={geo.octGeo} material={mats.ground} receiveShadow={shadows} />}
      {(P.plaza > 0.5 || P.ground > 0.5) && <primitive object={objs.poles} />}
      {(P.plaza > 0.5 || P.ground > 0.5) && <points geometry={objs.heads} material={mats.lampHalo} />}
      {(P.plaza > 0.5 || P.ground > 0.5) && <points geometry={objs.heads} material={mats.lampCore} />}
    </group>
  );
}
