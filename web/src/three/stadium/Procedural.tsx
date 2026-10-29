import { useMemo } from 'react';
import { hooked } from '../../dev';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { roundedRect, withBreaks, type PathPt, type Profile } from './path';
import { extrude } from './extrude';
import { HX, HY, RC, LOWER, LOWER_END, FASCIA, UPPER, UPPER_END, ROOF, BOX_BAND, lowerD, LOWER_FRONT, LOWER_PREFIX, VOM_TIER, VOM_GATES, gangwayRanges, gangwayBreaks, inGangway } from './layout';
import { focalPx } from './glow';
import { StadiumShell, type ShellForm } from './Shell';
import { TopTier } from './TopTier';
import { Vomitories } from './Vomitories';
import { Ribbon } from './Ribbon';
import { GOAL_FX } from './goalFx';
import { Haze } from './Haze';
import { vomCut, type VomTier } from './vomBuild';


/** One dot per seat: a person on most of them (bright), the rest shown as empty seats (dim). Seats sit at a constant pitch
 *  along each row, so the curved corners carry more seats in their longer back rows instead of fanning out into columns.
 *  aisles: the gangways' spans on the base path, left clear. skip(sBase, row, d) leaves a seat out (the vomitories; d is
 *  the seat's offset from the base path). */
const SEAT_PITCH = 0.58;
function crowd(path: PathPt[], profile: Profile, seed: number, aisles: [number, number][], opts: { mapD?: (p: PathPt, d: number) => number; skip?: (s: number, row: number, d: number) => boolean } = {}) {
  const pos: number[] = [], col: number[] = [], spos: number[] = [];
  let r = seed;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const front = new THREE.Color('#d1e6ff'), back = new THREE.Color('#5c7099'), att = new THREE.Color('#3987e5'), def = new THREE.Color('#d95926'), c = new THREE.Color();
  const seats = profile.filter((q) => q.kind === 'seat'), n = path.length, per = path[1].s * n;
  seats.forEach((q, row) => {
    const v = row / Math.max(1, seats.length - 1);
    // this row's line: every base point pushed out to the row's seat offset
    const D = path.map((p) => (opts.mapD ? opts.mapD(p, q.d + 0.3) : q.d + 0.3));
    const P = path.map((p, i) => [p.x + p.nx * D[i], p.y + p.ny * D[i]]), arc = [0];
    for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + Math.hypot(P[i % n][0] - P[i - 1][0], P[i % n][1] - P[i - 1][1]));
    const total = arc[n], count = Math.floor(total / SEAT_PITCH);
    for (let k = 0, i = 0; k < count; k++) {
      const t = (k + 0.5) * total / count; while (i < n - 1 && arc[i + 1] < t) i++;
      const f = (t - arc[i]) / ((arc[i + 1] - arc[i]) || 1), a = path[i], b = path[(i + 1) % n];
      const sBase = a.s + ((i + 1 === n ? per : b.s) - a.s) * f;
      if (inGangway(sBase, aisles)) continue;
      if (opts.skip && opts.skip(sBase, row, D[i] + (D[(i + 1) % n] - D[i]) * f)) continue;
      const x = P[i][0] + (P[(i + 1) % n][0] - P[i][0]) * f, z = P[i][1] + (P[(i + 1) % n][1] - P[i][1]) * f;
      if (rnd() > 0.86) { spos.push(x, q.h + 0.3, z); continue; }
      pos.push(x, q.h + 0.55, z);
      const tt = rnd();
      c.copy(front).lerp(back, v * 0.8 + 0.1 * rnd());
      if (tt < 0.12) c.lerp(att, 0.55); else if (tt < 0.2) c.lerp(def, 0.55);
      col.push(c.r, c.g, c.b);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const e = new THREE.BufferGeometry(), ec: number[] = [], seatC = new THREE.Color('#3b4a63');
  for (let k = 0; k < spos.length / 3; k++) ec.push(seatC.r, seatC.g, seatC.b);
  e.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
  e.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3));
  return { people: g, empty: e };
}

/** the hospitality boxes between the tiers: dark glass with warm light and a mullion every 4 m */
function boxBand(path: PathPt[]) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], n = path.length, per = path[1].s * n, d = BOX_BAND.d - 0.03;
  for (let i = 0; i <= n; i++) { const p = path[i % n], s = i === n ? per : p.s; for (const [h, v] of [[BOX_BAND.h0, 0], [BOX_BAND.h1, 1]] as const) { pos.push(p.x + p.nx * d, h, p.y + p.ny * d); uv.push(s / 4, v); } }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function boxTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d')!, grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,214,160,0.55)'); grd.addColorStop(0.7, 'rgba(255,200,140,0.9)'); grd.addColorStop(1, 'rgba(120,90,60,1)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#000'; g.fillRect(0, 0, 6, 64); g.fillRect(0, 0, 128, 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.62, 'rgba(255,255,255,1)'); grd.addColorStop(0.78, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function crowdMaterial(dot: THREE.Texture, clip: THREE.Plane[]) {
  return new THREE.ShaderMaterial({
    uniforms: { uFocal: { value: 1000 }, uMap: { value: dot }, uSize: { value: 0.46 }, uMin: { value: 1.7 }, uTime: { value: 0 }, uFlash: { value: CROWD_FX.flash }, uBob: { value: CROWD_FX.bob },
      uGoalT: { value: -1 }, uGoalPos: { value: new THREE.Vector3(52.5, 0, 0) } },
    vertexColors: true, clipping: true, clippingPlanes: clip,
    vertexShader: `#include <clipping_planes_pars_vertex>
      uniform float uFocal, uSize, uMin, uTime, uFlash, uBob, uGoalT; uniform vec3 uGoalPos;
      varying vec3 vColor; varying float vFlash, vWave;
      void main(){ vColor = color;
        // the crowd's life (CROWD_FX): a seed per seat from its position; a quarter of the crowd shifts a couple of
        // centimetres at its own slow pace, and in each sixteenth of a second a few seats take a phone photo: the dot
        // turns white (the front rows are already pale, so anything less is lost) and a quarter larger
        float seed = fract(sin(dot(position.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 p = position; p.y += uBob * step(seed, 0.25) * sin(uTime * (1.6 + 1.2 * fract(seed * 13.7)) + seed * 40.0);
        // goal reactions (goalFx.ts): a ring running out from the scored goal; behind it the crowd jumps
        float gd = length(position.xz - uGoalPos.xz), front = 28.0 * uGoalT, on = step(0.0, uGoalT);
        float wq = (gd - front) / 7.0, wave = on * exp(-wq * wq) * (1.0 - smoothstep(4.0, 7.0, uGoalT));
        float behind = on * smoothstep(front, front - 10.0, gd);
        float near = 1.0 - smoothstep(40.0, 120.0, gd);
        p.y += behind * (1.0 - smoothstep(4.0, 9.0, uGoalT)) * near * 0.28 * max(0.0, sin(uGoalT * 12.0 + seed * 6.2831853));
        vWave = wave;   // (the empty seats' material never gets a goal time, so they keep still)
        vFlash = step(1.0 - uFlash, fract(seed * 97.31 + floor(uTime * 16.0) * 0.618034));
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(uMin, uSize * uFocal / -mvPosition.z) * (1.0 + 0.25 * vFlash) * (1.0 + 0.6 * vWave);
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform sampler2D uMap; varying vec3 vColor; varying float vFlash, vWave;
      void main(){
        #include <clipping_planes_fragment>
        if (texture2D(uMap, gl_PointCoord).a < 0.5) discard;
        vec3 c = mix(vColor, vec3(1.0), 0.9 * vWave);
        gl_FragColor = vec4(mix(c, vec3(1.0), vFlash), 1.0); }`,
  });
}

/** The full stadium: the seating bowl and crowd inside the shell.
 *  cutaway: hide the near stand (the camera side) for elevated broadcast views */
/** time: the clip's clock in seconds, so the crowd holds still when play is paused (render time without it); events: the
 *  clip's shots and goals, for the flashes */
export function ProceduralStadium({ cutaway = false, shell = 'crystal', clipPlane, interior = false, time, events }: { cutaway?: boolean; shell?: ShellForm; clipPlane?: THREE.Plane; interior?: boolean; time?: () => number; events?: StadiumEvent[] }) {
  // clipPlane: a plane the caller moves at run time (the game's camera director cuts the near stand only while the
  // camera is behind it), so the materials compile once
  const clip = useMemo(() => (clipPlane ? [clipPlane] : cutaway ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), HY + 0.1)] : []), [cutaway, clipPlane]);
  return <group><StadiumBowl clip={clip} time={time} events={events} /><StadiumShell clip={clip} form={shell} interior={interior} /></group>;
}

/** every gate, the four corners' included */
const GATES = VOM_GATES;
/** The crowd's life (candidates 8 and 2 of docs/research/stadium-vivid.md, kept subtle: little movement, small and
 *  dim flashes). bob: how far a quarter of the crowd shifts, metres. flash: the share of
 *  seats taking a phone photo in each sixteenth of a second (about four at once round the bowl); a shot or a goal
 *  raises it for a few seconds when the caller passes the clip's events (StadiumEvent). */
const CROWD_FX = { bob: 0.02, flash: 0.0001 };
export type StadiumEvent = { t: number; kind: 'shot' | 'goal'; x?: number; team?: 'home' | 'away' };   // x: the scored goal's x (three.js)
/** the stadium's events from a clip package: the shots in its synced event feed, by Opta's shot types (events[].shooting
 *  marks the shooting team's events, not shots), and its goal (meta.goal) */
const SHOT_TYPES = new Set(['SavedShot', 'MissedShots', 'ShotOnPost', 'Goal']);
export function stadiumEvents(pkg: { events?: { t: number; type?: string }[]; meta?: { goal?: { t: number; x?: number } | null; attacking?: string } }): StadiumEvent[] {
  const team = pkg.meta?.attacking === 'away' ? 'away' as const : 'home' as const;   // the clip's attacking side scores its goal
  // the scored goal's x: a package's attackers attack +x, so +52.5 unless meta.goal says otherwise. Goals from the feed
  // carried no x, so the reactions kept the default +x end of the stadium; in a clip the game shows turned round (Stage
  // maps x by the view's sign) that was the other end, and the crowd by the goal hardly moved
  const gx = pkg.meta?.goal?.x ?? 52.5;
  const out: StadiumEvent[] = (pkg.events ?? []).filter((e) => SHOT_TYPES.has(e.type ?? '')).map((e) => (e.type === 'Goal' ? { t: e.t, kind: 'goal' as const, team, x: gx } : { t: e.t, kind: 'shot' as const }));
  if (pkg.meta?.goal && !out.some((e) => e.kind === 'goal')) out.push({ t: pkg.meta.goal.t, kind: 'goal', x: pkg.meta.goal.x, team });
  return out;
}
/** extra flash share t seconds into the clip: a goal adds 0.0025 fading over 4 s, a shot 0.001 over 2 s */
const flashBurst = (events: StadiumEvent[] | undefined, t: number) => {
  let b = 0;
  for (const e of events ?? []) { const dt = t - e.t, len = e.kind === 'goal' ? 4 : 2; if (dt >= 0 && dt < len) b += (e.kind === 'goal' ? 0.0025 : 0.001) * (1 - dt / len); }
  return b;
};

/** the lower and upper tiers as the vomitories see them (row r's tread is profile point 2r + 1; the lower tier's rows are
 *  remapped on the corners) */
const VOM_LOWER: VomTier = { row: (r, f) => ({ d: lowerD(f, LOWER[2 * r + 1].d), h: LOWER[2 * r + 1].h }), rise: LOWER[3].h - LOWER[1].h, ...VOM_TIER.lower };
const VOM_UPPER: VomTier = { row: (r) => UPPER[2 * r + 1], rise: UPPER[3].h - UPPER[1].h, ...VOM_TIER.upper };
/** a tier cut for the vomitories: its path with samples at the box walls, and its cell and seat skips (cell prefix + 2r
 *  is row r's riser, + 1 its tread) */
/** a tier cut for the vomitories, with its gangways: its path with samples at the box walls and the gangway edges, its
 *  cell and seat skips (cell prefix + 2r is row r's riser, + 1 its tread), and the gangways' spans for a tier whose rows
 *  sit around offset dRef */
function vomTier(path: PathPt[], T: VomTier, prefix: number, dRef: number) {
  const cut = vomCut(path, GATES, T), aisles = gangwayRanges(dRef);
  const skip = (p: PathPt, j: number) => j >= prefix && cut.cell(p.s, (j - prefix) >> 1, (j - prefix) % 2 ? 'tread' : 'riser');
  return { path: withBreaks(path, [...cut.breaks, ...gangwayBreaks(aisles)]), skip, seat: cut.seat, aisles };
}

/** The seating bowl and the crowd: everything inside the shell except the pitch. */
/** fasciaLed: the cyan line along the lower tier's front edge (off by default) */
export function StadiumBowl({ clip = [], fasciaLed = false, time, events }: { clip?: THREE.Plane[]; fasciaLed?: boolean; time?: () => number; events?: StadiumEvent[] }) {
  const path = useMemo(() => roundedRect(HX, HY, RC, 0.9), []);
  const vomL = useMemo(() => vomTier(path, VOM_LOWER, LOWER_PREFIX, LOWER_END.d / 2), [path]), vomU = useMemo(() => vomTier(path, VOM_UPPER, 0, (UPPER[0].d + UPPER_END.d) / 2), [path]);
  const parts = useMemo(() => ({
    // lower tier, with the vomitories' boxes cut out (the earlier designs, a cut slot, a pit and a light grey portal on this
    // tier only: <private-workspace> and stadium-vom3/)
    lower: extrude(vomL.path, [...LOWER_FRONT, ...LOWER], { aisles: vomL.aisles, mapD: lowerD, skip: vomL.skip }),
    boxes: boxBand(path), boxTex: boxTexture(),
    fascia: extrude(path, FASCIA),
    upper: extrude(vomU.path, UPPER, { aisles: vomU.aisles, skip: vomU.skip }),
    // a walkway from the back row to the envelope; above it the glazed hull and the roof underside close the bowl
    back: extrude(path, [{ d: UPPER_END.d, h: UPPER_END.h, kind: 'wall' }, { d: ROOF.back - 0.3, h: UPPER_END.h, kind: 'wall' }]),
    crowdL: crowd(path, LOWER, 7, vomL.aisles, { mapD: lowerD, skip: vomL.seat }), crowdU: crowd(path, UPPER, 11, vomU.aisles, { skip: vomU.seat }),
    vomTiers: [{ tier: VOM_LOWER, gates: GATES }, { tier: VOM_UPPER, gates: GATES }],
    fasciaLed: new THREE.BufferGeometry().setFromPoints([...path, path[0]].map((p) => new THREE.Vector3(p.x + p.nx * (LOWER_END.d + 1.25), LOWER_END.h + 1.8, p.y + p.ny * (LOWER_END.d + 1.25)))),
    dot: dotTexture(),
  }), [path, vomL, vomU]);
  const crowdMat = useMemo(() => crowdMaterial(parts.dot, clip), [parts, clip]);
  const seatMat = useMemo(() => { const m = crowdMaterial(parts.dot, clip); m.uniforms.uSize.value = 0.34; m.uniforms.uMin.value = 1.2; m.uniforms.uFlash.value = m.uniforms.uBob.value = 0; return m; }, [parts, clip]);   // empty seats keep still
  useFrame(({ size, camera, clock }) => {
    const f = focalPx(size.height, (camera as THREE.PerspectiveCamera).fov); crowdMat.uniforms.uFocal.value = f; seatMat.uniforms.uFocal.value = f;
    // the clip's clock when the caller passes it; else render time, or window.__crowdT when a recording steps frames itself
    const t = time ? time() : (hooked<number>('crowdT') ?? clock.elapsedTime);
    crowdMat.uniforms.uTime.value = t; crowdMat.uniforms.uFlash.value = CROWD_FX.flash + flashBurst(events, t);
    // the latest goal in the last 12 s drives the goal reactions (goalFx.ts)
    let since = -1, gx = GOAL_FX.x;
    let team = GOAL_FX.team, last = -Infinity;
    for (const e of events ?? []) if (e.kind === 'goal' && t >= e.t) { last = Math.max(last, e.t); if (t - e.t < 12) { since = t - e.t; gx = e.x ?? gx; team = e.team === 'away' ? 'WILDCATS' : 'PELICANS'; } }
    GOAL_FX.last = last;
    GOAL_FX.since = since; GOAL_FX.x = gx; GOAL_FX.team = team; GOAL_FX.clock = t;   // the team names as the UI shows them (Pelicans home, Wildcats away)
    const u = crowdMat.uniforms;
    u.uGoalT.value = since; u.uGoalPos.value.set(gx, 0, 0);
  });
  const fasciaLine = useMemo(() => new THREE.Line(parts.fasciaLed, new THREE.LineBasicMaterial({ color: '#73d9ff', transparent: true, opacity: 0.55, toneMapped: false, clippingPlanes: clip })), [parts, clip]);
  return (
    <group>
      <mesh geometry={parts.lower}><meshStandardMaterial vertexColors roughness={0.9} metalness={0} clippingPlanes={clip} /></mesh>
      <mesh geometry={parts.fascia}><meshStandardMaterial vertexColors roughness={0.6} clippingPlanes={clip} /></mesh>
      <mesh geometry={parts.upper}><meshStandardMaterial vertexColors roughness={0.9} clippingPlanes={clip} /></mesh>
      <mesh geometry={parts.back}><meshStandardMaterial vertexColors roughness={0.9} side={THREE.DoubleSide} clippingPlanes={clip} /></mesh>
      <mesh geometry={parts.boxes}><meshStandardMaterial color="#0a0d12" metalness={0.6} roughness={0.15} emissive="#ffffff" emissiveMap={parts.boxTex} emissiveIntensity={0.42} clippingPlanes={clip} /></mesh>
      <points geometry={parts.crowdL.people} material={crowdMat} />
      <points geometry={parts.crowdU.people} material={crowdMat} />
      <points geometry={parts.crowdL.empty} material={seatMat} />
      <points geometry={parts.crowdU.empty} material={seatMat} />
      {fasciaLed && <primitive object={fasciaLine} />}
      <Vomitories path={path} clip={clip} tiers={parts.vomTiers} />
      <TopTier path={path} clip={clip} crowdMat={crowdMat} seatMat={seatMat} />
      <Ribbon path={path} clip={clip} />
      <Haze clip={clip} />
    </group>
  );
}
