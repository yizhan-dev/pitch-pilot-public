import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Pitch-side people and television (candidates 6 and 9 of docs/research/stadium-vivid.md). The people
// are drawn in the toon players' language (three-tone toon shading, a dark outline that fades out from 35 to 70 m), as
// simple static figures, all merged into one mesh and one outline: two draw calls. Where they stand follows match-day
// rules:
// - photographers behind the boards behind each goal line, out to the penalty area, never on the bench side (A-Leagues
//   photographer guidelines; UEFA's are the same), kneeling or on low stools, white telephoto lenses on monopods;
// - two ball assistants behind each goal in line with the penalty area, more along the touchlines (Premier League);
// - stewards between the boards and the stand, facing the crowd, in yellow hi-vis vests;
// - television cameras on tripods behind the goals and the main-side boards at the penalty-area lines, and a reverse
//   angle at halfway on the far side, each with its operator.
// - the benches: coaches, staff and substitutes seated.
// (The spidercam was removed: too detailed, not needed. Its code: stadium-vivid2/PitchSide.with-spidercam.tsx)

type V3 = [number, number, number];
/** a capsule from a to b; c2 colours the part beyond `split` (0..1 along a to b): a hand, a sock, a shoe */
type Seg = { kind: 'seg'; a: V3; b: V3; r: number; c: string; c2?: string; split?: number; sx?: number; sz?: number; fine?: boolean };
type Part = Seg | { kind: 'head'; at: V3; r: number; skin: string; hair: string } | { kind: 'box'; at: V3; size: V3; c: string };
const seg = (a: V3, b: V3, r: number, c: string, o: Partial<Seg> = {}): Part => ({ kind: 'seg', a, b, r, c, ...o });
const box = (at: V3, size: V3, c: string): Part => ({ kind: 'box', at, size, c });

const SKIN = ['#e9bc98', '#c98d68', '#8e5b3c', '#f1cdaa', '#a9714d', '#6e452c'], HAIR = ['#1f1b18', '#3b2a1f', '#5a4130', '#16130f', '#8a7a68', '#2b2420'];
const DARK = '#1c2028', SHOE = '#121418';
/** top: the torso (a bib or a vest when there is one); sleeve: the arms; legs: trousers or shorts; socks: below the knee */
type Look = { top: string; sleeve: string; legs: string; socks: string; skin: string; hair: string; shorts?: boolean };

// Poses in the figure's own frame: feet at the origin, facing +z, about 1.78 m tall. A torso, a head with its hair, one
// capsule per arm with the hand at its end, two per leg with the sock or the shoe at the shin's end.
function body(L: Look, j: { hip: number; lean?: number; shoulder?: number }, legs: Part[], arms: [V3, V3][]): Part[] {
  const sh = j.shoulder ?? j.hip + 0.5, lean = j.lean ?? 0;
  return [
    seg([0, j.hip + 0.06, 0], [0, sh - 0.04, lean], 0.165, L.top, { sx: 1.15, sz: 0.72, fine: true }),
    { kind: 'head', at: [0, sh + 0.2, lean + 0.02], r: 0.115, skin: L.skin, hair: L.hair },
    ...arms.map(([s, h]) => seg(s, h, 0.052, L.sleeve, { c2: L.skin, split: 0.86 })),
    ...legs,
  ];
}
/** a leg: thigh hip to knee, shin knee to foot (socks below a short's hem, the shoe at the end), foot forward */
const leg = (hip: V3, knee: V3, foot: V3, L: Look): Part[] => [
  seg(hip, knee, 0.075, L.legs, L.shorts ? { c2: L.skin, split: 0.6 } : {}),
  seg(knee, foot, 0.066, L.shorts ? L.socks : L.legs, { c2: SHOE, split: 0.9 }),
  box([foot[0], 0.05, foot[2] + 0.06], [0.09, 0.08, 0.2], SHOE),
];
/** sitting: lean is how far the shoulders come forward (0.03 upright, 0.25 elbows on knees, -0.08 leaning back);
 *  spread opens the knees */
const seated = (L: Look, hands: [V3, V3], seatH = 0.5, stool = true, lean = 0.03, spread = 0): Part[] => [
  ...body(L, { hip: seatH, shoulder: seatH + 0.48 - Math.max(0, lean - 0.03) * 0.35, lean }, [
    ...leg([0.1, seatH, 0], [0.11 + spread, seatH, 0.42], [0.12 + spread * 0.6, 0.08, 0.46], L), ...leg([-0.1, seatH, 0], [-0.11 - spread, seatH, 0.42], [-0.12 - spread * 0.6, 0.08, 0.46], L),
  ], [[[0.22, seatH + 0.44 - Math.max(0, lean - 0.03) * 0.35, lean], hands[0]], [[-0.22, seatH + 0.44 - Math.max(0, lean - 0.03) * 0.35, lean], hands[1]]]),
  ...(stool ? [seg([0, seatH - 0.08, 0.02], [0, 0.02, 0.02], 0.16, '#2a2e35')] : []),        // the stool
];
const stand = (L: Look, hands: [V3, V3]) => body(L, { hip: 0.92 }, [
  ...leg([0.1, 0.92, 0], [0.11, 0.5, 0.02], [0.12, 0.08, 0], L), ...leg([-0.1, 0.92, 0], [-0.11, 0.5, 0.02], [-0.12, 0.08, 0], L),
], [[[0.22, 1.36, 0], hands[0]], [[-0.22, 1.36, 0], hands[1]]]);
/** a photographer's long white lens on its monopod, held at height y, pointing along +z */
const lens = (y: number, z: number): Part[] => [
  box([0, y, z], [0.15, 0.12, 0.1], '#15171b'), seg([0, y, z + 0.08], [0, y, z + 0.5], 0.058, '#e4e4de', { c2: '#202328', split: 0.92 }),
  seg([0, y - 0.06, z + 0.26], [0, 0.02, z + 0.3], 0.012, '#30343b'),
];
const kneel = (L: Look): Part[] => [
  ...body(L, { hip: 0.62, shoulder: 1.08, lean: 0.1 }, [
    ...leg([0.1, 0.62, 0], [0.12, 0.56, 0.42], [0.12, 0.08, 0.44], L),
    seg([-0.1, 0.62, 0], [-0.1, 0.09, 0.08], 0.075, L.legs), seg([-0.1, 0.09, 0.08], [-0.1, 0.07, -0.42], 0.066, L.legs, { c2: SHOE, split: 0.82 }),
  ], [[[0.21, 1.05, 0.1], [0.07, 1.18, 0.34]], [[-0.21, 1.05, 0.1], [-0.05, 1.14, 0.52]]]),
  ...lens(1.21, 0.34),
];
const shooterSeated = (L: Look): Part[] => [...seated(L, [[0.07, 1.04, 0.34], [-0.05, 1.0, 0.52]], 0.42), ...lens(1.07, 0.34)];
/** a broadcast camera on a tripod, lens along +z, its operator standing behind it */
const tvCamera = (L: Look): Part[] => [
  seg([0, 1.3, 0.55], [0.32, 0.02, 0.4], 0.02, '#2a2e35'), seg([0, 1.3, 0.55], [-0.32, 0.02, 0.4], 0.02, '#2a2e35'), seg([0, 1.3, 0.55], [0, 0.02, 0.95], 0.02, '#2a2e35'),
  box([0, 1.36, 0.55], [0.2, 0.1, 0.24], '#1b1e23'), box([0, 1.55, 0.58], [0.24, 0.3, 0.62], '#23262c'),
  seg([0, 1.56, 0.9], [0, 1.56, 1.12], 0.085, '#16181c'), box([0.15, 1.66, 0.36], [0.1, 0.12, 0.16], '#16181c'),
  seg([0.1, 1.42, 0.38], [0.24, 1.32, 0.14], 0.016, '#2a2e35'), seg([-0.1, 1.42, 0.38], [-0.24, 1.32, 0.14], 0.016, '#2a2e35'),
  ...stand(L, [[0.24, 1.32, 0.16], [-0.24, 1.32, 0.16]]),
];

let seed = 17;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const look = (top: string, sleeve = top, legs = DARK, socks = legs, shorts = false): Look => ({ top, sleeve, legs, socks, shorts, skin: pick(SKIN), hair: pick(HAIR) });

/** every figure: parts, place (x, z in three.js), the direction it faces, and a scale */
function figures() {
  seed = 17;
  const out: { parts: Part[]; x: number; z: number; y?: number; face: [number, number]; s?: number }[] = [];   // (cluster(): which outline group)
  const pitch = (x: number, z: number): [number, number] => [-x, -z * 0.3];
  // photographers: behind the end boards (x = ±58) out to the penalty area, between the goal posts' line and z = ±19
  for (const sx of [1, -1]) for (const sz of [1, -1]) for (let k = 0; k < 3; k++) {
    const x = sx * 59.1, z = sz * (5.8 + k * 5.6) + (rnd() - 0.5) * 0.8, L = look('#8b97a7', '#2a2f37');   // grey bibs over dark jackets
    out.push({ parts: k % 2 ? shooterSeated(L) : kneel(L), x, z, face: [-sx, -sz * 0.08] });
  }
  // ball assistants: two behind each goal in line with the penalty area, in front of the boards; six along the touchlines
  const kid = () => look('#d9dde3', '#d9dde3', '#2b3140');   // light grey tracksuit tops, dark bottoms
  for (const sx of [1, -1]) for (const sz of [1, -1]) out.push({ parts: seated(kid(), [[0.12, 0.58, 0.36], [-0.12, 0.58, 0.36]], 0.38), x: sx * 56.9, z: sz * 20.2, face: [-sx, 0], s: 0.86 });
  for (const [x, z] of [[-30, -37.3], [30, -37.3], [-51, 37.3], [51, 37.3]]) out.push({ parts: seated(kid(), [[0.12, 0.58, 0.36], [-0.12, 0.58, 0.36]], 0.38), x, z, face: [0, -Math.sign(z)], s: 0.86 });
  // (no substitutes warming up: standing still, they read as dead, not alive)
  // the benches (Furniture's Dugout: 21 seats a row, 0.5 m apart, the front row's pans at 0.84 m over a 0.35 m plinth,
  // the back row's at 1.19 m over a 0.75 m step). Seated as people do, not in a regular pattern: the head
  // coach and two assistant coaches near the middle of the front row with a seat or two between them, two staff and a
  // couple of substitutes further along it, the other substitutes spread over the back row in loose groups with gaps;
  // each sits his own way (upright, elbows on knees, arms folded, leaning back, knees apart) and turns a little towards
  // the play. A blue at -x, B orange at +x.
  for (const [sx, coach, staff, top, shorts, socks] of [[-1, '#15181d', '#1f3566', '#2f6fc0', '#e9eef5', '#3987e5'], [1, '#15181d', '#5a2a18', '#c4521f', '#1b2230', '#d95926']] as [number, string, string, string, string, string][]) {
    const seatX = (i: number) => sx * 9.75 - 5 + i * 0.5;
    const pose = (L: Look, seatH: number) => {
      const k = Math.floor(rnd() * 5), up: [V3, V3] = [[0.13, seatH + 0.12, 0.34], [-0.13, seatH + 0.12, 0.34]];
      if (k === 0) return seated(L, up, seatH, false);                                                                  // upright, hands on knees
      if (k === 1) return seated(L, [[0.05, seatH + 0.12, 0.42], [-0.05, seatH + 0.12, 0.42]], seatH, false, 0.25, 0.06); // elbows on knees
      if (k === 2) return seated(L, [[-0.12, seatH + 0.3, 0.16], [0.12, seatH + 0.32, 0.17]], seatH, false);              // arms folded
      if (k === 3) return seated(L, [[0.2, seatH + 0.05, 0.1], [-0.2, seatH + 0.05, 0.1]], seatH, false, -0.08, 0.07);    // leaning back, knees apart
      return seated(L, [[0.12, seatH + 0.12, 0.3], [-0.02, seatH + 0.42, 0.2]], seatH, false, 0.08);                      // a hand at the chin
    };
    const sit = (L: Look, i: number, back: boolean) => {
      const turn = (rnd() - 0.5) * 0.7 + (seatX(i) < 0 ? 0.12 : -0.12);   // most look a little towards the middle of the pitch
      out.push({ parts: pose(L, back ? 0.44 : 0.49), x: seatX(i) + (rnd() - 0.5) * 0.06, y: back ? 0.75 : 0.35, z: back ? 40.65 : 39.7, face: [Math.sin(turn), -Math.cos(turn)] });
    };
    const pickN = (from: number[], n: number) => { const a = [...from]; for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; } return a.slice(0, n); };
    const c0 = 9 + Math.floor(rnd() * 3);                                                       // the head coach's seat
    sit(look(coach, coach), c0, false);
    for (const i of [c0 - 1 - Math.floor(rnd() * 2), c0 + 1 + Math.floor(rnd() * 2)]) sit(look(staff, staff), i, false);   // assistant coaches
    for (const i of pickN([3, 4, 5, 15, 16, 17], 2)) sit(look(staff, staff), i, false);         // physio, kit man
    for (const i of pickN([1, 2, 18, 19], 2)) sit(look(top, top, shorts, socks, true), i, false); // two substitutes in front
    for (const i of pickN([2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18], 7)) sit(look(top, top, shorts, socks, true), i, true);
  }
  // stewards: seated between the boards and the stand, facing the crowd
  const steward = () => look('#d4dc4c', '#23272e');
  for (const x of [-45, -27, -9, 9, 27, 45]) out.push({ parts: seated(steward(), [[0.12, 0.62, 0.36], [-0.12, 0.62, 0.36]], 0.46), x, z: -41.4, face: [0, -1] });
  for (const x of [-47, -22, 22, 47]) out.push({ parts: seated(steward(), [[0.12, 0.62, 0.36], [-0.12, 0.62, 0.36]], 0.46), x, z: 41.4, face: [0, 1] });
  // television: behind both goals beyond the photographers, the main side's penalty-area lines, a far-side reverse angle
  const op = () => look('#1d2026', '#1d2026');
  for (const [x, z] of [[59.6, 22.6], [59.6, -22.6], [-59.6, 22.6], [-59.6, -22.6], [0, -40.4]]) out.push({ parts: tvCamera(op()), x, z, face: pitch(x, z) });
  for (const x of [36, -36]) out.push({ parts: tvCamera(op()), x, z: 40.4, face: [Math.sign(x) * 0.45, -1] });   // across the penalty area
  return out;
}

function build(list: ReturnType<typeof figures>) {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  const C = new Map<string, THREE.Color>(), cc = (h: string) => { let c = C.get(h); if (!c) { c = new THREE.Color(h); C.set(h, c); } return c; };
  /** append g (already in place) with a colour per vertex from its position before placing (local) */
  const add = (g: THREE.BufferGeometry, local: THREE.BufferAttribute, colour: (x: number, y: number, z: number) => THREE.Color) => {
    const base = pos.length / 3, p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      const c = colour(local.getX(i), local.getY(i), local.getZ(i)); col.push(c.r, c.g, c.b);
    }
    const ix = g.getIndex()!; for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  };
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4(), place = new THREE.Matrix4();
  for (const f of list) {
    const yaw = Math.atan2(f.face[0], f.face[1]), s = f.s ?? 1;
    place.compose(new THREE.Vector3(f.x, f.y ?? 0, f.z), new THREE.Quaternion().setFromAxisAngle(up, yaw), new THREE.Vector3(s, s, s));
    for (const p of f.parts) {
      let g: THREE.BufferGeometry, colour: (x: number, y: number, z: number) => THREE.Color;
      if (p.kind === 'seg') {
        // low detail: five sides and one ring per cap (50 triangles), the torso eight sides, thin rods plain cylinders
        const a = new THREE.Vector3(...p.a), b = new THREE.Vector3(...p.b), d = b.clone().sub(a), len = Math.max(0.001, d.length());
        g = p.fine ? new THREE.CapsuleGeometry(p.r, len, 1, 8) : p.r < 0.03 ? new THREE.CylinderGeometry(p.r, p.r, len, 5) : new THREE.CapsuleGeometry(p.r, len, 1, 5);
        const split = (p.split ?? 2) * len - len / 2, c1 = cc(p.c), c2 = cc(p.c2 ?? p.c);
        colour = (_x, y) => (y > split ? c2 : c1);
        const local = (g.getAttribute('position') as THREE.BufferAttribute).clone();
        g.scale(p.sx ?? 1, 1, p.sz ?? 1);
        q.setFromUnitVectors(up, d.normalize()); m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)); g.applyMatrix4(m);
        g.applyMatrix4(place); add(g, local, colour); continue;
      }
      if (p.kind === 'head') {
        // one sphere: hair over the crown and the back of the head, skin on the face
        g = new THREE.SphereGeometry(p.r, 7, 5); const skin = cc(p.skin), hair = cc(p.hair), r = p.r;
        colour = (_x, y, z) => (y > 0.25 * r || (z < -0.35 * r && y > -0.45 * r) ? hair : skin);
        const local = (g.getAttribute('position') as THREE.BufferAttribute).clone();
        g.translate(...p.at); g.applyMatrix4(place); add(g, local, colour); continue;
      }
      g = new THREE.BoxGeometry(...p.size); const c = cc(p.c), local = (g.getAttribute('position') as THREE.BufferAttribute).clone();
      g.translate(...p.at); g.applyMatrix4(place); add(g, local, () => c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** three tones, as the toon players use */
function toonRamp() {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
/** the players' outline (players/Styles.tsx): back faces pushed out about 1.1 px close up, at most 11 mm, fading out
 *  from 35 to 70 m, where the shell collapses so it does not fight the body for depth */
function outlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uW: { value: 1.1 / 1000 }, uMax: { value: 0.011 }, uFade: { value: new THREE.Vector2(35, 70) }, uColor: { value: new THREE.Color('#0b0d10') } },
    side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
    vertexShader: `uniform float uW, uMax; uniform vec2 uFade;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 n = normalize(mat3(modelMatrix) * normal);
        float d = -(viewMatrix * wp).z, f = 1.0 - smoothstep(uFade.x, uFade.y, d);
        if (f < 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        float o = min(uW * d, uMax) * f;
        wp.xyz += n * (d > uFade.x ? max(o, 0.004) : o);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }`,
  });
}

/** outline groups: the main side, the far side and each end; an outline is drawn only while the camera is within 72 m of
 *  one of its figures (past 70 m it has faded out, outlineMaterial), so the broadcast view draws the main side's alone */
const cluster = (x: number, z: number) => (Math.abs(x) > 54 ? (x > 0 ? 2 : 3) : z > 0 ? 0 : 1);
export function PitchSide() {
  const res = useMemo(() => {
    const ramp = toonRamp(), all = figures();
    const groups = [0, 1, 2, 3].map((k) => { const list = all.filter((f) => cluster(f.x, f.z) === k); return { geo: build(list), spots: list.map((f) => new THREE.Vector3(f.x, 1, f.z)) }; });
    return { geo: build(all), groups, ramp, mat: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }), line: outlineMaterial() };
  }, []);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ camera }) => res.groups.forEach((g, k) => { const m = refs.current[k]; if (m) m.visible = g.spots.some((p) => p.distanceToSquared(camera.position) < 72 * 72); }));
  useEffect(() => () => { res.geo.dispose(); res.groups.forEach((g) => g.geo.dispose()); res.ramp.dispose(); res.mat.dispose(); res.line.dispose(); }, [res]);
  return (
    <group>
      <mesh geometry={res.geo} material={res.mat} />
      {res.groups.map((g, k) => <mesh key={k} ref={(m) => { refs.current[k] = m; }} geometry={g.geo} material={res.line} />)}
    </group>
  );
}
