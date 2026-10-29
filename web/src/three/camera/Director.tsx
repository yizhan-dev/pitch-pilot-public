import { useEffect, useMemo, useRef } from 'react';
import { hook, hooked } from '../../dev';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Loaded, Joints } from '../../data';
import type { Clock } from '../../clock';
import { ballAt } from '../Ball';
import { getSettings, setSettings, VIEWS, type ViewMode } from '../../game/settings';
import { HX, HY, RC, LOWER_END, UPPER, UPPER_END, ROOF, TOP } from '../stadium/layout';
import { shellCeiling } from '../stadium/shellCeiling';
import { STADIUM_CURRENT } from '../stadium/crystalParams';
import type { HideRef } from '../players/Styles';
import { drawMode, hoveredPlayer } from '../../hud/draft';
import { picking } from '../../whatif/state';
import { clipSwap, swapBoard, SWAP_BLEND_S } from '../../game/clipSwap';
import { summaryOpen } from '../../summary/summary';
import { HEAD, SHARE, axes, broadcastShot, groundOf, tanOf, type FramePoint } from './broadcastFrame';
import { nightOutside } from '../stadium/night';

// The game's camera (?ui=game): one camera, seven views, smooth changes between them. Scene axes: x along
// the pitch (the attackers towards +x), y up, z across (the package's y). The views:
//  - broadcast: a TV match's main camera, a pan-tilt head rather than a rail: a head fixed in the main stand over the
//    halfway line that only pans, tilts and zooms. The shot it wants
//    holds the ball well inside the frame, where it is heading, the room in front of the man on the ball, the goal he
//    attacks once it is near (with the box's men: a corner shows the taker and the box) and the men round the ball,
//    centred as near the play as that allows (broadcastFrame.ts). The operator's lag on top: the head turns only once
//    the wanted shot leaves a window (14% of the half-frame across, 12% up and down), drifts onto it over about 2.5 s
//    and moves with a critically damped spring capped in speed; the zoom changes past 6%, out faster than in; the
//    ball never goes past 80% of the half-frame (the head turns with it) and nothing the shot must hold leaves it
//  - free: the spidercam. Drag to orbit, right drag or shift drag to pan, wheel to zoom, double click a player to
//    follow him. It flies anywhere in the stadium's air (the old box, 6 m beyond the lines and 40 m up,
//    pulled the camera in long before it neared anything): over the pitch up to the roof's opening (70 m), over the
//    stands 2.5 m clear of the seats and 2 m under the roof (the shell's own underside), short of the third tier's
//    front; never inside a player (0.75 m capsules up to 2.05 m) or a goal (the frame and net as a box). Where the arm
//    from the orbit centre would leave that, it shortens (a spring arm)
//  - third: 1.5-person, 3.6 m behind the selected player at about 2.35 m (a little higher and further
//    back than 2.8 m at 1.95 m), along his smoothed head direction
//  - first: at the selected player's eyes; position, head direction and pitch smoothed apart (0.12 s, 0.25 s and
//    0.5 s), no roll, so the horizon stays level; the player is hidden once the camera is in his head
//  - referee, ar1, ar2: the officials' eyes, the same way
//  - tactical: straight down with a narrow lens (32 degrees), high enough (about 160 m on a 16:9 screen) that the
//    pitch and 5 m round it fill the middle 85% of the height, clear of the HUD bars; goals left and right; the wheel
//    zooms in (down to 25 m) and the view then follows the broadcast focus; a drag pans and stops the follow, which
//    comes back when zoomed out to the whole pitch
//  - aerialNear, aerialFar: the stadium from outside, as from a drone, a slow orbit round its centre
//    on render time (so it keeps turning while play is paused). aerialNear flies low, about 240 m out and 50 m up, the facade
//    with the roof's edge and the sky; aerialFar high, about 420 m out, for the whole stadium and its grounds. A drag turns and tilts it, the
//    wheel moves in or out, and the orbit picks up again 4 s after the last touch. The fog is pushed out while there,
//    the near stand is never cut, and changes to and from them take 1.8 s, a flight out or back in
// Dragging or zooming in the broadcast view hands over to the free view from where the camera is.

export const FREE_BOX = { x: 58.5, z: 40, yMin: 1.2, yMax: 40 };
const GOALS = [-1, 1].map((s) => new THREE.Box3(new THREE.Vector3(s > 0 ? 52.45 : -55.3, -1, -3.95), new THREE.Vector3(s > 0 ? 55.3 : -52.45, 2.65, 3.95)));
const BODY = { r: 0.75, h: 2.05 };
const BLEND = 0.8;
/** the match summary's flight up to the drone (s): slower than a viewer's change to an aerial view (1.8 s) */
const SUMMARY_RISE_S = 2.8;
/** the inside orbit (AERIAL.aerialIn): its height and its lens, the widest the corner fit used to reach */
const IN_H = 58, IN_FOV = 72;
const OFFICIAL_VIEW: Partial<Record<ViewMode, number>> = { referee: 0, ar1: 1, ar2: 2 };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** a point a camera looks at, on its own line of sight (so a path from it starts without a turn): where that meets
 *  the grass (at most 80 m on), or 30 m ahead if it looks up or level */
const lookOf = (c: THREE.Camera) => {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
  const k = f.y < -0.05 ? Math.min(80, -c.position.y / f.y) : 30;
  return c.position.clone().addScaledVector(f, k);
};

interface Damp { v: number }
const damp = (): Damp => ({ v: 0 });
/** the return to the broadcast view: seconds without the viewer's touch, and seconds of the ball out of the frame */
const IDLE = { s: 6, outS: 1.5 };
/** the broadcast camera on a goal: a little shake that mimics not the ball going in but the crowd dancing, jumping and
 *  celebrating, so the stand the camera sits in bounces as the crowd jumps together. A beat of `hz` jumps a second (a crowd jumping in time is
 *  about 2 to 2.3), each landing a small drop of the camera (`dropM` metres) and its aim (`pitch` degrees), the stand
 *  swaying a little side to side at half the beat (`roll`, `yaw` degrees) and a faint rumble under it all. It starts
 *  `delayS` after the ball crosses the line, swells over `riseS`, holds to `holdS` and settles by `endS`. On clip time,
 *  so a pause holds still and a recording is the same every time. The Watch mode only (Explain's camera language keeps
 *  the camera still while play runs) */
const BOUNCE = { hz: 2.2, delayS: 0.35, riseS: 1.0, holdS: 4.4, endS: 6.6, dropM: 0.14, pitch: 0.42, roll: 0.16, yaw: 0.1, rumble: 0.05 };
/** the bounce at s seconds after the ball crossed the line: [yaw, pitch, roll] in radians and the drop in metres */
function bounceAt(s: number): [number, number, number, number] {
  const B = BOUNCE, u = s - B.delayS;
  if (u <= 0 || s >= B.endS) return [0, 0, 0, 0];
  const sm = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
  const env = sm(u / B.riseS) * (1 - sm((s - B.holdS) / (B.endS - B.holdS)));
  // the beat, its tempo drifting a little; a landing is the cusp of |sin|, so the camera drops sharply and rises softly
  const ph = Math.PI * (B.hz * u + 0.06 * Math.sin(1.3 * u)), land = Math.abs(Math.sin(ph)) - 2 / Math.PI;
  const sway = Math.sin(ph + 0.5), rumble = 0.6 * Math.sin(2 * Math.PI * 11.7 * u) + 0.4 * Math.sin(2 * Math.PI * 17.3 * u + 1.1);
  const d = THREE.MathUtils.degToRad;
  return [d(B.yaw * sway * 0.7 + B.rumble * rumble * 0.5) * env, d(-B.pitch * land + B.rumble * rumble) * env, d(B.roll * sway) * env, -B.dropM * land * env];
}
const _sf = new THREE.Vector3(), _sr = new THREE.Vector3(), _su = new THREE.Vector3();
/** when the ball crosses the goal line for each of the clip's goals: from the feed's Goal event (logged at the strike:
 *  the 80:17 header crossed 1.1 s later), the tracking's ball wholly over the line between the posts, from 1 s before
 *  it to 2.5 s after; the feed's time if the tracking misses it */
function goalCrossings(pkg: Loaded['pkg']): number[] {
  const events = (pkg as { events?: { t: number; type: string }[] }).events ?? [];
  return events.filter((e) => e.type === 'Goal').map((e) => {
    for (let k = 0; k <= 175; k++) {
      const t = e.t - 1 + k / 50, b = ballAt(pkg, t);
      if (b && Math.abs(b[0]) > 52.5 + 0.11 && Math.abs(b[1]) < 3.66 + 0.11 && b[2] < 2.44) return t;
    }
    return e.t;
  });
}
/** which way the camera looks across the pitch, for the radar (hud/Minimap.tsx; from the other side the
 *  radar must turn round too): sign 1 while it looks towards -z (from the main stand's side, as the radar is drawn), -1
 *  towards +z. Judged from the screen's up and the view's direction on the ground, so the top-down view and the
 *  player's eyes count too, with a margin so a view along the pitch does not flicker; live once a director runs */
export const camFacing = { sign: 1, live: false };

/** a critically damped spring towards target, time based (Unity's SmoothDamp) */
export function smoothDamp(cur: number, target: number, st: Damp, smoothTime: number, maxSpeed: number, dt: number) {
  if (dt <= 0) return cur;
  const T = Math.max(1e-4, smoothTime), w = 2 / T, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const orig = target, maxC = maxSpeed * T;
  const change = clamp(cur - target, -maxC, maxC);
  target = cur - change;
  const tmp = (st.v + w * change) * dt;
  st.v = (st.v - w * tmp) * e;
  let out = target + (change + tmp) * e;
  if ((orig - cur > 0) === (out > orig)) { out = orig; st.v = (out - orig) / dt; }
  return out;
}
const smoothAngle = (cur: number, target: number, st: Damp, T: number, maxSpeed: number, dt: number) => smoothDamp(cur, cur + wrap(target - cur), st, T, maxSpeed, dt);

/** a joint at time t in scene axes (x, up, across); false where untracked */
export function jointAt(J: Joints, p: number, j: number, t: number, out: THREE.Vector3): boolean {
  const f = t * J.fps;
  if (j < 0 || f < 0 || f > J.frames - 1) return false;
  const i0 = Math.min(J.frames - 2, Math.floor(f)), u = f - i0, nJ = J.names.length, D = J.data;
  const a = ((i0 * J.players + p) * nJ + j) * 3, b = a + J.players * nJ * 3;
  const x = D[a] + (D[b] - D[a]) * u, y = D[a + 1] + (D[b + 1] - D[a + 1]) * u, z = D[a + 2] + (D[b + 2] - D[a + 2]) * u;
  if (!Number.isFinite(x + y + z)) return false;
  out.set(x, z, y);
  return true;
}
interface Ix { midHip: number; neck: number; nose: number; rEye: number; lEye: number; rEar: number; lEar: number }
const indexOf = (J: Joints): Ix => {
  const k = (n: string) => J.names.indexOf(n);
  return { midHip: k('midHip'), neck: k('neck'), nose: k('nose'), rEye: k('rEye'), lEye: k('lEye'), rEar: k('rEar'), lEar: k('lEar') };
};
const va = new THREE.Vector3(), vb = new THREE.Vector3(), vn = new THREE.Vector3();
/** the eyes (between them) and where the face points (nose from between the ears) */
function headOf(J: Joints, ix: Ix, p: number, t: number, eye: THREE.Vector3, fwd: THREE.Vector3): boolean {
  if (!(jointAt(J, p, ix.nose, t, vn) && jointAt(J, p, ix.rEar, t, va) && jointAt(J, p, ix.lEar, t, vb))) return false;
  fwd.copy(vn).sub(va.add(vb).multiplyScalar(0.5));
  if (jointAt(J, p, ix.rEye, t, va) && jointAt(J, p, ix.lEye, t, vb)) eye.copy(va).add(vb).multiplyScalar(0.5); else eye.copy(vn);
  return true;
}

// ---- the free camera's air: the stadium's inside, clear of the seats, the roof and the third tier
const AIR = { seats: 2.5, roof: 2, top: 70, dMax: TOP.d0 - 2 };
let roofAt: ((x: number, z: number) => number) | null = null;   // the shell's underside, built once (shellCeiling)
/** metres beyond the bowl's front edge (the base path, a rounded rectangle), negative over the pitch */
const beyond = (x: number, z: number) => {
  const qx = Math.abs(x) - (HX - RC), qz = Math.abs(z) - (HY - RC);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - RC;
};
/** the seats' height d metres beyond the front edge: the lower tier's rake, the upper tier's front, its rake */
const U0 = UPPER[0];
const seatsAt = (d: number) => d < 0 ? 2.2 : d <= LOWER_END.d ? 2.58 + 0.447 * d : d < U0.d ? U0.h : Math.min(UPPER_END.h, U0.h + 0.52 + 0.65 * (d - U0.d));
/** whether the free camera may be at p */
function inAir(p: THREE.Vector3) {
  if (p.y > AIR.top) return false;                // (the floor, FREE_BOX.yMin, is applied to the result: the orbit centre sits
                                                  // below it, so the arm's first steps would fail)
  const d = beyond(p.x, p.z);
  if (d > AIR.dMax) return false;
  if (d > -0.5 && p.y < seatsAt(Math.max(0, d)) + AIR.seats) return false;
  roofAt ??= shellCeiling(STADIUM_CURRENT, HX, HY, RC, ROOF.back).at;
  return p.y <= roofAt(p.x, p.z) - AIR.roof;
}
const airV = new THREE.Vector3();
/** how far along the arm from a (in the air) towards b the camera may go, as a fraction: walk it in 0.5 m steps, then
 *  narrow down the first step that leaves the air */
function airFraction(a: THREE.Vector3, b: THREE.Vector3) {
  const len = a.distanceTo(b), n = Math.max(1, Math.ceil(len / 0.5));
  let ok = 0;
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    if (inAir(airV.lerpVectors(a, b, f))) { ok = f; continue; }
    let lo = ok, hi = f;
    for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (inAir(airV.lerpVectors(a, b, m))) lo = m; else hi = m; }
    return lo;
  }
  return 1;
}
/** where a segment from a towards b first enters a box, as a fraction, or null */
function entryFraction(a: THREE.Vector3, b: THREE.Vector3, box: THREE.Box3): number | null {
  let t0 = 0, t1 = 1;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) { if (a[k] < box.min[k] || a[k] > box.max[k]) return null; continue; }
    let u0 = (box.min[k] - a[k]) / d, u1 = (box.max[k] - a[k]) / d;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
    if (t0 > t1) return null;
  }
  return t0;
}

interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number; near: number; up: THREE.Vector3 }
interface Head { pos: THREE.Vector3; yaw: number; pitch: number; dx: Damp; dy: Damp; dz: Damp; dYaw: Damp; dPitch: Damp; init: boolean; who: string }
const makeHead = (): Head => ({ pos: new THREE.Vector3(), yaw: 0, pitch: 0, dx: damp(), dy: damp(), dz: damp(), dYaw: damp(), dPitch: damp(), init: false, who: '' });

export function CameraDirector({ data, clock, onTick, hide, hideOfficial, clipPlane, hover, orient = 1 }: { data: Loaded; clock: Clock; onTick: (dt: number) => void; hide: HideRef; hideOfficial: HideRef; clipPlane: THREE.Plane; hover?: HideRef; orient?: 1 | -1 }) {
  const { camera, gl, size, scene } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const ix = useMemo(() => (data.joints ? indexOf(data.joints) : null), [data]);
  const oix = useMemo(() => (data.officials?.joints ? indexOf(data.officials.joints) : null), [data]);
  const goals = useMemo(() => goalCrossings(data.pkg), [data]);
  const st = useRef({
    mode: null as ViewMode | null, fromMode: null as ViewMode | null, sel: null as number | null, seeded: false, from: null as null | { pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; look: THREE.Vector3 }, blend: 1, lastT: -1,
    bc: { px: 0, pz: 0, yaw: 0, pitch: 0.3, w: 0.3, ty: 0, tp: 0.3, tw: 0.3, vy: damp(), vp: damp(), vw: damp(), side: 0, tier: 0, init: false },
    fr: { target: new THREE.Vector3(0, 0.8, 0), yaw: 0, pitch: 0.5, dist: 40, follow: null as number | null, dF: [damp(), damp(), damp()], eye: null as null | { pos: THREE.Vector3; look: THREE.Vector3; fov: number } },
    head: makeHead(), third: { a: new THREE.Vector3(), dx: damp(), dy: damp(), dz: damp(), yaw: 0, dYaw: damp(), init: false, who: -1 },
    drag: null as null | { x: number; y: number; moved: number; pan: boolean; id: number },
    tac: { cx: 0, cz: 0, h: 1e9, manual: false, dx: damp(), dz: damp(), dh: damp(), sx: 0, sz: 0, sh: 150, init: false },
    ae: { yaw: 0, pitch: 0.24, dist: 150, idle: 99, spd: 1 }, blendDur: BLEND, fog: null as null | { near: number; far: number }, fogK: 0,
    orient: 0, lastInput: performance.now(), outFor: 0, cutNext: false, blendNext: 0,
  }).current;
  // the viewer's last touch of the mouse, the wheel or a key (for the return to the broadcast view below)
  useEffect(() => {
    const touch = () => { st.lastInput = performance.now(); };
    const evs = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, touch));
  }, [st]);
  const hips = useMemo(() => Array.from({ length: data.joints?.players ?? 22 }, () => new THREE.Vector3()), [data]);
  const ohips = useMemo(() => Array.from({ length: 3 }, () => new THREE.Vector3()), []);
  const tmp = useMemo(() => ({ eye: new THREE.Vector3(), fwd: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), out: { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30, near: 0.5, up: new THREE.Vector3(0, 1, 0) } as Pose, north: new THREE.Vector3(0, 0, -1), tq: { x: 0, y: 0 } }), []);

  /** every player's hips now (scene axes); false entries keep their last place */
  const updateHips = (t: number) => {
    const J = data.joints;
    if (J && ix) for (let p = 0; p < J.players; p++) {
      if (!jointAt(J, p, ix.midHip, t, hips[p])) {
        const f = data.pkg.frames[clamp(Math.round(t * data.pkg.meta.fps), 0, data.pkg.frames.length - 1)], all = [...f.att, ...f.def];
        if (all[p]) hips[p].set(all[p][0], 1, all[p][1]);
      }
    }
    const O = data.officials;
    if (O) for (let k = 0; k < 3; k++) {
      if (!(O.joints && oix && jointAt(O.joints, k, oix.midHip, t, ohips[k]))) {
        const f = O.pos[clamp(Math.round(t * data.pkg.meta.fps), 0, O.pos.length - 1)];
        if (f?.[k]) ohips[k].set(f[k][0], 1, f[k][1]); else ohips[k].set(0, -100, 0);
      }
    }
  };
  const pushOut = (c: THREE.Vector3, skip = -1) => {
    if (c.y >= BODY.h) return;
    const bodies = [...hips.map((h, i) => (i === skip ? null : h)), ...ohips];
    for (let pass = 0; pass < 2; pass++) for (const h of bodies) {
      if (!h) continue;
      const dx = c.x - h.x, dz = c.z - h.z, d = Math.hypot(dx, dz);
      if (d < BODY.r) { const k = d > 1e-4 ? BODY.r / d : 1; c.x = h.x + (d > 1e-4 ? dx * k : BODY.r); c.z = h.z + (d > 1e-4 ? dz * k : 0); }
    }
  };
  const nearestToBall = (t: number) => {
    const b = ballAt(data.pkg, t);
    if (!b) return 0;
    let best = 0, bd = Infinity;
    hips.forEach((h, i) => { const d = (h.x - b[0]) ** 2 + (h.z - b[1]) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  };

  // ---- the views
  // the one-sided views (broadcast, tactical) when the match's ends turn the view round (coords.ts viewSign): worked out
  // as usual with the ball and the bodies turned round the centre spot, then the pose turned back, so the camera keeps
  // the same place relative to the stadium, which is turned with it (Stage), and the play reads right to left
  const turn = (q: [number, number, number] | null) => (q && orient < 0 ? [-q[0], -q[1], q[2]] as [number, number, number] : q);
  const turned = useMemo(() => hips.map(() => new THREE.Vector3()), [hips]);
  const bodies = () => { if (orient > 0) return hips; hips.forEach((h, i) => turned[i].set(-h.x, h.y, -h.z)); return turned; };
  const broadcast = (t: number, dt: number, snap: boolean, out: Pose) => {
    const bc = st.bc, b = turn(ballAt(data.pkg, t)), b0 = turn(ballAt(data.pkg, t - 0.2)), aspect = size.width / Math.max(1, size.height);
    let hard: FramePoint[] | null = null, must: FramePoint[] = [];
    if (b) {
      const vel: [number, number] = b0 ? [(b[0] - b0[0]) / 0.2, (b[1] - b0[1]) / 0.2] : [0, 0];
      const shot = broadcastShot({ ball: b, vel, bodies: bodies(), nAtt: data.pkg.frames[0]?.att.length ?? 11, dirAtt: orient, side: bc.side, tier: bc.tier, aspect });
      const want = shot.aim;
      bc.side = shot.side; bc.tier = shot.tier; hard = shot.hard; must = shot.must;
      if (snap || !bc.init) { bc.yaw = bc.ty = want.yaw; bc.pitch = bc.tp = want.pitch; bc.w = bc.tw = want.w; bc.vy.v = bc.vp.v = bc.vw.v = 0; }
      // the window: the aim moves only as far as the wanted shot pushes it, then drifts onto it slowly
      const winY = 0.14 * Math.atan(bc.w), winP = 0.12 * Math.atan(bc.w / aspect);
      const dy = wrap(want.yaw - bc.ty), dp = want.pitch - bc.tp;
      if (dy > winY) bc.ty += dy - winY; else if (dy < -winY) bc.ty += dy + winY;
      if (dp > winP) bc.tp += dp - winP; else if (dp < -winP) bc.tp += dp + winP;
      const k = 1 - Math.exp(-dt / 2.5);
      bc.ty += wrap(want.yaw - bc.ty) * k; bc.tp += (want.pitch - bc.tp) * k;
      if (Math.abs(want.w / bc.tw - 1) > 0.06) bc.tw = want.w;
    }
    bc.yaw = smoothAngle(bc.yaw, bc.ty, bc.vy, 0.7, 0.9, dt); bc.pitch = smoothDamp(bc.pitch, bc.tp, bc.vp, 0.9, 0.5, dt);
    bc.w = smoothDamp(bc.w, bc.tw, bc.vw, bc.tw > bc.w ? 0.7 : 1.8, 0.5, dt);
    // the guard: the ball never past 80% of the half-frame (the head turns with it, the target too, so they do not
    // pull against each other); the ball and its heading never past the frame's edge (the lens widens at once), the
    // rest the shot holds not past it for long (the lens widens at its own pace)
    if (hard) {
      axes(bc.yaw, bc.pitch);
      const q = tmp.tq, ball = hard[0];
      if (tanOf(ball, q)) {
        const lx = (0.8 / SHARE.ball) * ball.m * bc.w, ly = lx / aspect;
        const ex = Math.abs(q.x) > lx ? (Math.atan(Math.abs(q.x)) - Math.atan(lx)) * Math.sign(q.x) / Math.max(0.3, Math.cos(bc.pitch)) : 0;
        const ey = Math.abs(q.y) > ly ? (Math.atan(Math.abs(q.y)) - Math.atan(ly)) * Math.sign(q.y) : 0;
        bc.yaw += ex; bc.ty += ex; bc.pitch -= ey; bc.tp -= ey;
        if (ex || ey) axes(bc.yaw, bc.pitch);
      }
      const need = (pts: FramePoint[]) => { let n = 0; for (const p of pts) if (tanOf(p, q)) n = Math.max(n, Math.abs(q.x), Math.abs(q.y) * aspect); return n / 0.98; };
      const now = need(must), soon = need(hard);
      if (now > bc.w) bc.w = now;
      if (soon > bc.tw) bc.tw = soon;
    }
    const { f } = axes(bc.yaw, bc.pitch);
    out.pos.set(HEAD.x, HEAD.y, HEAD.z); out.look.set(HEAD.x + f.x * 60, HEAD.y + f.y * 60, HEAD.z + f.z * 60);
    out.fov = THREE.MathUtils.radToDeg(2 * Math.atan(bc.w / aspect)); out.near = 0.5;
    [bc.px, bc.pz] = groundOf(bc);
    bc.init = true;
  };
  const free = (t: number, dt: number, out: Pose) => {
    const fr = st.fr;
    // a scripted eye (window.__camEye: an Explain script's ball camera): where it is put, none of the
    // orbit's floors, until the next __camSet or the viewer's own drag, wheel or double click
    if (fr.eye) { out.pos.copy(fr.eye.pos); out.look.copy(fr.eye.look); out.fov = fr.eye.fov; out.near = 0.05; return; }
    if (fr.follow !== null && hips[fr.follow]) {
      const h = hips[fr.follow];
      fr.target.x = smoothDamp(fr.target.x, h.x, fr.dF[0], 0.3, 30, dt); fr.target.z = smoothDamp(fr.target.z, h.z, fr.dF[2], 0.3, 30, dt);
      fr.target.y = smoothDamp(fr.target.y, 1.0, fr.dF[1], 0.3, 10, dt);
    }
    fr.target.x = clamp(fr.target.x, -54.5, 54.5); fr.target.z = clamp(fr.target.z, -36, 36); fr.target.y = clamp(fr.target.y, 0.3, 3);
    if (Math.abs(fr.target.z) < 4.3) fr.target.x = clamp(fr.target.x, -52.2, 52.2);   // never orbit about a point inside a goal
    fr.pitch = clamp(fr.pitch, THREE.MathUtils.degToRad(4), THREE.MathUtils.degToRad(86)); fr.dist = clamp(fr.dist, 3, 130);
    const T = fr.target, c = tmp.v.set(Math.cos(fr.pitch) * Math.sin(fr.yaw), Math.sin(fr.pitch), Math.cos(fr.pitch) * Math.cos(fr.yaw)).multiplyScalar(fr.dist).add(T);
    // the spring arm: shorten to stay in the stadium's air and outside both goals
    let s = airFraction(T, c);
    for (const g of GOALS) { const e = entryFraction(T, c, g); if (e !== null) s = Math.min(s, Math.max(0, e - 0.4 / Math.max(0.01, fr.dist))); }
    out.pos.copy(T).lerp(c, s);
    pushOut(out.pos);
    out.pos.y = Math.max(out.pos.y, FREE_BOX.yMin);
    out.look.copy(T); out.fov = 45; out.near = 0.1;
    void t;
  };
  const eyes = (J: Joints, jix: Ix, p: number, key: string, t: number, dt: number, snap: boolean, out: Pose) => {
    const h = st.head;
    if (!headOf(J, jix, p, t, tmp.eye, tmp.fwd)) return false;
    const yawT = Math.atan2(tmp.fwd.x, tmp.fwd.z), pitchT = clamp(-0.14 + 0.35 * Math.atan2(tmp.fwd.y, Math.hypot(tmp.fwd.x, tmp.fwd.z)), -0.45, 0.14);
    if (snap || !h.init || h.who !== key) {
      h.pos.copy(tmp.eye); h.yaw = yawT; h.pitch = pitchT; h.dx.v = h.dy.v = h.dz.v = h.dYaw.v = h.dPitch.v = 0; h.init = true; h.who = key;
    }
    h.pos.x = smoothDamp(h.pos.x, tmp.eye.x, h.dx, 0.12, 14, dt); h.pos.z = smoothDamp(h.pos.z, tmp.eye.z, h.dz, 0.12, 14, dt);
    h.pos.y = smoothDamp(h.pos.y, tmp.eye.y, h.dy, 0.3, 4, dt);
    h.yaw = smoothAngle(h.yaw, yawT, h.dYaw, 0.25, 5.5, dt); h.pitch = smoothDamp(h.pitch, pitchT, h.dPitch, 0.5, 2, dt);
    const dir = tmp.w.set(Math.sin(h.yaw) * Math.cos(h.pitch), Math.sin(h.pitch), Math.cos(h.yaw) * Math.cos(h.pitch));
    out.pos.copy(h.pos).addScaledVector(dir, 0.08); out.look.copy(out.pos).addScaledVector(dir, 10); out.fov = 60; out.near = 0.05;
    return true;
  };
  const third = (p: number, t: number, dt: number, snap: boolean, out: Pose) => {
    const J = data.joints, th = st.third;
    if (!J || !ix || !jointAt(J, p, ix.neck, t, tmp.eye) || !headOf(J, ix, p, t, tmp.v, tmp.fwd)) return false;
    const yawT = Math.atan2(tmp.fwd.x, tmp.fwd.z);
    if (snap || !th.init || th.who !== p) { th.a.copy(tmp.eye); th.yaw = yawT; th.dx.v = th.dy.v = th.dz.v = th.dYaw.v = 0; th.init = true; th.who = p; }
    th.a.x = smoothDamp(th.a.x, tmp.eye.x, th.dx, 0.15, 14, dt); th.a.z = smoothDamp(th.a.z, tmp.eye.z, th.dz, 0.15, 14, dt); th.a.y = smoothDamp(th.a.y, tmp.eye.y, th.dy, 0.35, 4, dt);
    th.yaw = smoothAngle(th.yaw, yawT, th.dYaw, 0.45, 3.5, dt);
    const dx = Math.sin(th.yaw), dz = Math.cos(th.yaw);
    out.pos.set(th.a.x - dx * 3.6 - dz * 0.55, th.a.y + 0.85, th.a.z - dz * 3.6 + dx * 0.55);
    out.look.set(th.a.x + dx * 12, th.a.y - 0.7, th.a.z + dz * 12);
    pushOut(out.pos, p); out.pos.y = Math.max(out.pos.y, FREE_BOX.yMin); out.fov = 52; out.near = 0.1;
    return true;
  };

  const TAC = { fov: 32, hMin: 25 };
  /** the height that shows the whole pitch: 78 m across in 85% of the screen's height, 117 m along in its width */
  const tacFit = () => {
    const tn = Math.tan(THREE.MathUtils.degToRad(TAC.fov / 2)), aspect = size.width / Math.max(1, size.height);
    return Math.max(78 / 0.85 / 2 / tn, 117 / 2 / (tn * aspect));
  };
  const tactical = (dt: number, snap: boolean, out: Pose) => {
    const tc = st.tac, fit = tacFit();
    if (!tc.init || tc.h > fit) tc.h = fit;
    const zoomed = tc.h < fit - 5;
    if (!zoomed) tc.manual = false;
    // where to look: the pitch's centre in full view, the broadcast focus when zoomed in, or where the user panned
    const wx = !zoomed ? 0 : tc.manual ? tc.cx : st.bc.px, wz = !zoomed ? 0 : tc.manual ? tc.cz : st.bc.pz;
    if (!tc.manual) { tc.cx = wx; tc.cz = wz; }
    // keep the view on the pitch: the half-extents the lens covers at this height, the pitch plus 6 m beyond
    const aspect = size.width / Math.max(1, size.height), halfH = tc.h * Math.tan(THREE.MathUtils.degToRad(TAC.fov / 2)), halfW = halfH * aspect;
    const lx = Math.max(0, 58.5 - halfW), lz = Math.max(0, 40 - halfH);
    tc.cx = clamp(tc.cx, -lx, lx); tc.cz = clamp(tc.cz, -lz, lz);
    if (snap || !tc.init) { tc.sx = tc.cx; tc.sz = tc.cz; tc.sh = tc.h; tc.init = true; }
    tc.sx = smoothDamp(tc.sx, tc.cx, tc.dx, 0.35, 60, dt); tc.sz = smoothDamp(tc.sz, tc.cz, tc.dz, 0.35, 60, dt); tc.sh = smoothDamp(tc.sh, tc.h, tc.dh, 0.3, 300, dt);
    out.pos.set(tc.sx, tc.sh, tc.sz); out.look.set(tc.sx, 0, tc.sz); out.up.copy(tmp.north); out.fov = TAC.fov; out.near = 1;
  };
  const tacZoom = (dy: number) => { const tc = st.tac; tc.h = clamp(tc.h * Math.exp(dy * 0.0012), TAC.hMin, tacFit()); };
  const tacPan = (dx: number, dy: number) => {
    const tc = st.tac, m = (2 * tc.h * Math.tan(THREE.MathUtils.degToRad(TAC.fov / 2))) / Math.max(1, size.height);
    if (tc.h >= tacFit() - 5) return;                 // the whole pitch is in view: nothing to pan to
    if (!tc.manual) { tc.manual = true; tc.cx = tc.sx; tc.cz = tc.sz; }
    tc.cx -= dx * m; tc.cz -= dy * m;
  };

  // ---- into the top-down view, smooth, with the whole pitch in frame as early as possible. The plain blend
  // moved the camera in a line and turned it from level to straight down in 0.8 s: the pitch's 8 edge points all in
  // frame only from 0.63 s, the turn peaking at 437 degrees a second (measured, and simulated at 240 Hz from a player
  // cam's pose). Here the camera rises, what it looks at slides from where it was looking to the pitch's centre and it
  // is turned to look there each frame (so it always faces the pitch), and the lens closes to the view's own; every
  // curve starts and ends at rest, so nothing jolts. One zoom out, then still (two earlier tunings that opened the
  // lens on the way read as a zoom out and back in). What the eye reads as the zoom, how
  // large the ground at the frame's middle is drawn (1 / (its distance x tan(lens / 2))), only falls, to the view's
  // own: the camera rises and the lens closes over the first half, the look reaches the centre by three quarters.
  // Simulated at 240 Hz from a player cam's pose: past the end by 0.3 % at most (the earlier tunings 30 % and 128 %,
  // the visible zoom back in), the pitch all in frame from 0.78 s, the turn's peak about 320 degrees a second
  const TO_TOP = { dur: 1.8, rise: 0.5, glance: 0.75, lens: 0.5 };
  const tt = useMemo(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion() }), []);
  const toTop = (from: { pos: THREE.Vector3; fov: number; look: THREE.Vector3 }, out: Pose, b: number) => {
    const e = ease(b), rise = ease(Math.min(1, b / TO_TOP.rise)), glance = ease(Math.min(1, b / TO_TOP.glance));
    tt.pos.set(from.pos.x + (out.pos.x - from.pos.x) * e, from.pos.y + (out.pos.y - from.pos.y) * rise, from.pos.z + (out.pos.z - from.pos.z) * e);
    tt.look.lerpVectors(from.look, out.look, glance);
    tt.up.set(0, 1, 0).lerp(out.up, e).normalize();   // (turned to north over the whole way: a quicker turn spun the frame)
    tt.m.lookAt(tt.pos, tt.look, tt.up); tt.q.setFromRotationMatrix(tt.m);
    camera.position.copy(tt.pos); camera.quaternion.copy(tt.q);
    cam.fov = from.fov + (out.fov - from.fov) * ease(Math.min(1, b / TO_TOP.lens));
  };

  /** seed the free view from wherever the camera is now */
  // headless shots: put the free camera somewhere (orbit centre, yaw, pitch, distance), e.g. over a stand
  useEffect(() => {
    hook('setFree', (o: { x?: number; z?: number; yaw?: number; pitch?: number; dist?: number }) => {
      const fr = st.fr;
      if (o.x !== undefined) fr.target.x = o.x;
      if (o.z !== undefined) fr.target.z = o.z;
      if (o.yaw !== undefined) fr.yaw = o.yaw;
      if (o.pitch !== undefined) fr.pitch = o.pitch;
      if (o.dist !== undefined) fr.dist = o.dist;
    });
  }, [st]);
  const seedFree = () => {
    const fr = st.fr, dir = tmp.w.set(0, 0, -1).applyQuaternion(camera.quaternion), o = camera.position;
    const tHit = dir.y < -0.05 ? -o.y / dir.y : 40;
    const T = tmp.v.copy(o).addScaledVector(dir, Math.min(tHit, 120));
    fr.target.set(clamp(T.x, -54, 54), 0.8, clamp(T.z, -35, 35));
    const off = tmp.w.copy(o).sub(fr.target);
    fr.dist = clamp(off.length(), 3, 90); fr.yaw = Math.atan2(off.x, off.z); fr.pitch = Math.asin(clamp(off.y / Math.max(1e-3, off.length()), -1, 1));
  };
  // the frame loop sees the change of view and blends to it; seeding here keeps the drag that caused it
  const toFree = () => { if (getSettings().view !== 'free') { seedFree(); st.seeded = true; setSettings({ view: 'free' }); } };
  const orbit = (dx: number, dy: number, pan: boolean) => {
    const fr = st.fr;
    if (fr.eye) { fr.eye = null; seedFree(); }
    if (pan) {
      const k = fr.dist * 0.0016, sy = Math.sin(fr.yaw), cy = Math.cos(fr.yaw);
      fr.target.x += -dx * k * cy - dy * k * sy; fr.target.z += dx * k * sy - dy * k * cy; fr.follow = null;
    } else { fr.yaw -= dx * 0.005; fr.pitch += dy * 0.004; }
  };
  const zoom = (dy: number) => { if (st.fr.eye) { st.fr.eye = null; seedFree(); } st.fr.dist *= Math.exp(dy * 0.0012); };
  // ---- 外景: round the stadium's centre; each view its distance, tilt, lens, pace and wheel range
  const AERIAL: Partial<Record<ViewMode, { dist: number; pitch: number; fov: number; turn: number; look: number; dMin: number; dMax: number; inside?: boolean }>> = {
    aerialNear: { dist: 240, pitch: 0.16, fov: 34, turn: 150, look: 22, dMin: 120, dMax: 320 },   // 150 m filled the frame with fins
    aerialFar: { dist: 420, pitch: 0.5, fov: 30, turn: 120, look: 5, dMin: 260, dMax: 700 },
    // inside: an ellipse over the pitch's own outline (dist along it, 0.7 of that across), IN_H up in the roof's
    // opening (the air goes to 70 m there; over the stands the roof comes down to about 30 m), looking at the centre
    // spot through one lens, IN_FOV
    aerialIn: { dist: 48, pitch: 0, fov: 50, turn: 220, look: 0, dMin: 36, dMax: 56, inside: true },   // (220 s a turn: a slow rotation)
  };
  const aerialOrbit = (dx: number, dy: number) => { const a = st.ae; a.yaw -= dx * 0.004; a.pitch = clamp(a.pitch + dy * 0.003, 0.08, 1.15); a.idle = 0; };
  const aerialZoom = (dy: number, k: NonNullable<(typeof AERIAL)[ViewMode]>) => { const a = st.ae; a.dist = clamp(a.dist * Math.exp(dy * 0.0012), k.dMin, k.dMax); a.idle = 0; };
  const aerial = (k: NonNullable<(typeof AERIAL)[ViewMode]>, dt: number, out: Pose) => {
    const a = st.ae;
    a.idle += dt; a.spd += ((a.idle > 4 ? 1 : 0) - a.spd) * Math.min(1, dt / 1.5);   // the orbit eases back in after a touch
    a.yaw += dt * a.spd * (2 * Math.PI / k.turn);
    if (k.inside) {
      out.pos.set(a.dist * Math.sin(a.yaw), IN_H, 0.7 * a.dist * Math.cos(a.yaw)); out.look.set(0, 0, 0); out.near = 1;
      // one lens all the way round (a fitted lens felt like a bump at each touchline): the
      // lens that fitted the four corners sat at its widest for most of the turn (over an end the near corners are under
      // the camera) and dipped to 67 degrees and back in a few seconds as it crossed each touchline, a zoom pulse
      out.fov = IN_FOV;
      return;
    }
    const c = Math.cos(a.pitch);
    out.pos.set(a.dist * c * Math.sin(a.yaw), Math.max(12, 12 + a.dist * Math.sin(a.pitch)), a.dist * c * Math.cos(a.yaw));
    out.look.set(0, k.look, 0); out.fov = k.fov; out.near = 1;
  };
  /** the player under a screen point (within 32 px of his hips), or null */
  const pick = (x: number, y: number) => {
    let best: number | null = null, bd = 32 * 32;
    hips.forEach((h, i) => {
      const v = tmp.v.set(h.x, 1.0, h.z).project(camera);
      if (v.z > 1) return;
      const px = (v.x * 0.5 + 0.5) * size.width, py = (-v.y * 0.5 + 0.5) * size.height, d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  // ---- input on the canvas
  useEffect(() => {
    const el = gl.domElement;
    const local = (e: PointerEvent | MouseEvent) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    // in the HUD's 画板 mode the pointer draws on the pitch (hud/PitchOverlay3D.tsx): no orbit, pan, pick or follow; the
    // wheel still zooms
    // while the What-if picks a pass the pitch's clicks are the picker's (three/whatif/TargetPicker.tsx), but drags and
    // the wheel still move the camera, so the viewer can still change the perspective;
    // the game's own hover cue and click-to-select stay off then
    const down = (e: PointerEvent) => { if (drawMode.get()) return; st.drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, id: e.pointerId }; el.setPointerCapture(e.pointerId); };
    // the hovered player: the cue's (hover) and, in every mode, the HUD's (hud/draft.ts hoveredPlayer: the Tactics pen
    // draws on the player the triangle points at)
    const setHover = (p: number) => { if (hover) hover.current = p; hoveredPlayer.set(p); };
    const move = (e: PointerEvent) => {
      const d = st.drag;
      // (no hover cue and no pick while the match summary is open: on that page every selected player is
      // deselected)
      if ((picking() || summaryOpen.get()) && !d) { setHover(-1); el.style.cursor = 'default'; return; }
      // with the pen on, the hovered player is still picked, so his triangle shows what the pen will draw on; the
      // orbit, the pan, the click to select and the follow stay off
      if (drawMode.get()) { const [x, y] = local(e); setHover(pick(x, y) ?? -1); el.style.cursor = 'crosshair'; return; }
      if (!d) {
        // hovering: the player under the mouse gets the game's cue (a triangle over him, his colours lifted)
        const [x, y] = local(e), p = pick(x, y);
        setHover(p ?? -1);
        el.style.cursor = p !== null ? 'pointer' : getSettings().view === 'free' || AERIAL[getSettings().view] ? 'grab' : 'default';
        return;
      }
      setHover(-1);
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.moved < 5) return;
      const v = getSettings().view;
      if (v === 'tactical') { tacPan(dx, dy); return; }
      if (AERIAL[v]) { aerialOrbit(dx, dy); return; }
      if (v === 'broadcast') toFree();
      if (getSettings().view === 'free') orbit(dx, dy, d.pan);
    };
    const up = (e: PointerEvent) => {
      const d = st.drag; st.drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (d && d.moved < 5 && e.button === 0 && !picking() && !summaryOpen.get()) { const [x, y] = local(e); const p = pick(x, y); if (p !== null) setSettings({ selected: p }); }
    };
    const dbl = (e: MouseEvent) => {
      if (drawMode.get() || picking()) return;
      const [x, y] = local(e); const p = pick(x, y);
      if (p === null) { st.fr.follow = null; return; }
      if (getSettings().view !== 'free') toFree();
      if (st.fr.eye) { st.fr.eye = null; seedFree(); }
      st.fr.follow = p; setSettings({ selected: p });
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (getSettings().view === 'tactical') { tacZoom(e.deltaY); return; }
      const ak = AERIAL[getSettings().view];
      if (ak) { aerialZoom(e.deltaY, ak); return; }
      if (getSettings().view === 'broadcast') toFree();
      if (getSettings().view === 'free') zoom(e.deltaY);
    };
    const menu = (e: Event) => e.preventDefault();
    const leave = () => { setHover(-1); el.style.cursor = 'default'; };
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    el.addEventListener('dblclick', dbl); el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('contextmenu', menu);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.removeEventListener('dblclick', dbl); el.removeEventListener('wheel', wheel); el.removeEventListener('contextmenu', menu); el.removeEventListener('pointerleave', leave);
    };
  });

  // for the headless checks: drive the free camera without a mouse, read where the camera is
  useEffect(() => {
    // quat: where it looks (the line-up show ends on this very camera, LineupShow.tsx)
    hook('cam', () => ({ mode: st.mode, pos: camera.position.toArray(), quat: camera.quaternion.toArray(), fov: cam.fov, target: st.fr.target.toArray(), follow: st.fr.follow, dist: st.fr.dist, blend: st.blend }));
    hook('camDrive', (dx: number, dy: number, pan = false, wheel = 0) => { if (getSettings().view !== 'free') toFree(); orbit(dx, dy, pan); if (wheel) zoom(wheel); });
    hook('camFollow', (p: number | null) => { if (getSettings().view !== 'free') toFree(); if (st.fr.eye) { st.fr.eye = null; seedFree(); } st.fr.follow = p; });
    hook('camBodies', () => [...hips, ...ohips].map((h) => h.toArray()));
    // triangles per top-level part of the scene (instanced meshes count every instance), the biggest first
    hook('triangles', () => {
      const out: Record<string, number> = {};
      scene.children.forEach((top, i) => {
        let n = 0;
        top.traverse((o) => {
          const m = o as THREE.Mesh & { count?: number; isInstancedMesh?: boolean };
          if (!(m as THREE.Mesh).isMesh || !m.visible) return;
          const g = m.geometry as THREE.BufferGeometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
          n += tri * (m.isInstancedMesh ? (m.count ?? 1) : 1);
        });
        const name = top.type + (top.children[0]?.type ? '/' + top.children.length : '') + '#' + i;
        if (n > 0) out[name] = Math.round(n);
      });
      return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 12);
    });
    hook('hover', (p: number) => { if (hover) hover.current = p; hoveredPlayer.set(p); });
    // set the free view outright (for the headless checks): orbit centre, yaw and pitch in degrees, distance
    hook('camSet', (x: number, y: number, z: number, yawDeg: number, pitchDeg: number, dist: number) => {
      if (getSettings().view !== 'free') toFree();
      st.fr.target.set(x, y, z); st.fr.yaw = THREE.MathUtils.degToRad(yawDeg); st.fr.pitch = THREE.MathUtils.degToRad(pitchDeg); st.fr.dist = dist; st.fr.follow = null; st.fr.eye = null;
    });
    // a camera put straight at a point looking at another (scene metres), past the free view's floors: an Explain
    // script's ball camera, set every frame (a ball's-eye view, such as one through #13's legs)
    hook('camEye', (px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 50) => {
      if (getSettings().view !== 'free') toFree();
      const e = st.fr.eye ?? { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov };
      e.pos.set(px, py, pz); e.look.set(lx, ly, lz); e.fov = fov; st.fr.eye = e; st.fr.follow = null;
    });
    // for director scripts (cut between cameras far apart, never fly): the next change of
    // view cuts, with no blend; the viewer's own changes keep the blend
    hook('camCut', () => { st.cutNext = true; });
    // (Explain taking the camera over and giving it back travels up to 70 m, too far for 0.8 s):
    // the next change of view blends over s seconds
    hook('camBlend', (s: number) => { st.blendNext = s; });
    hook('glInfo', () => ({ triangles: gl.info.render.triangles, calls: gl.info.render.calls, points: gl.info.render.points, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }));
    hook('tacZoom', (dy: number) => tacZoom(dy));
    hook('tacPan', (dx: number, dy: number) => tacPan(dx, dy));
  });

  useFrame((_, raw) => {
    onTick(Math.min(raw, 0.1));
    // two clocks for the camera (a pause must stop the camera too). What follows the play (the lazy
    // broadcast follow, the eyes and the 1.5-person view, the free view's follow) runs on the clip's time, so it
    // freezes on pause and slows with slow motion; what the user does (a change of view, the tactical view's zoom and
    // pan) runs on render time, so it still moves while paused. Recording (window.__capture, ?capture=1) holds frames
    // one at a time, so there everything runs on the clip's time.
    const capture = !!hooked<boolean>('capture');
    // (a clip changing in place: the clock stands still, so its flight runs on render time even when recording)
    const t = clock.t, dtPlay = clamp(t - st.lastT, 0, 0.1), dtUser = capture && clipSwap.get() === 'off' ? dtPlay : Math.min(raw, 0.1);
    const snap = st.lastT < 0 || Math.abs(t - st.lastT) > 0.5;
    st.lastT = t;
    updateHips(t);
    // a clip at the other end (coords.ts viewSign): the free camera and the drone keep their own place, so they turn
    // round the centre spot with the stadium, and the play reads the same way as in the broadcast view
    if (st.orient !== orient) {
      if (st.orient !== 0) { st.fr.target.x = -st.fr.target.x; st.fr.target.z = -st.fr.target.z; st.fr.yaw += Math.PI; st.ae.yaw += Math.PI; }
      // a fresh page (a clip change reloads it) starts the camera on the near side: for a clip at the other end, start
      // it on the other, so a free view or the drone seeded from it reads the same way
      else if (orient < 0 && st.mode === null) { camera.position.set(-camera.position.x, camera.position.y, -camera.position.z); camera.lookAt(0, 0, 0); }
      st.orient = orient;
    }
    const s = getSettings();
    let view = s.view;
    const need = VIEWS.find((v) => v.key === view)?.needsPlayer;
    if (need && s.selected === null) { setSettings({ selected: nearestToBall(t) }); return; }
    const oi = OFFICIAL_VIEW[view];
    if (oi !== undefined && !(data.officials?.joints && oix)) view = 'broadcast';
    // a change of view, or of the player a player's view belongs to: blend from where the camera is
    if (view !== st.mode || (need && s.selected !== st.sel)) {
      if (st.mode === 'free' && view !== 'free') st.fr.follow = null;      // the follow ends with the free view
      if (view === 'free' && st.mode !== 'free' && !st.seeded) seedFree();
      st.seeded = false;
      st.from = st.mode === null || st.cutNext ? null : { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: cam.fov, look: lookOf(camera) };
      st.cutNext = false;
      // the drone starts on the side the camera is on, at its view's distance and tilt; a change to or from it is slower
      const ak = AERIAL[view];
      if (ak) Object.assign(st.ae, { yaw: Math.atan2(camera.position.x, camera.position.z), pitch: ak.pitch, dist: ak.dist, idle: 99, spd: 1 });
      // a clip changing in place (game/clipSwap.ts): the flight up to the whole pitch from above, and back down
      const swap = clipSwap.get() !== 'off';
      if (swap && view === 'tactical') { st.tac.h = 1e9; st.tac.manual = false; }
      // the match summary's rise to the drone, slower, as the pre-match show's (summary/summary.ts)
      st.blendDur = st.blendNext > 0 ? st.blendNext : summaryOpen.get() && ak ? SUMMARY_RISE_S : ak || (st.mode && AERIAL[st.mode]) ? 1.8 : swap ? SWAP_BLEND_S : view === 'tactical' ? TO_TOP.dur : BLEND;
      st.blendNext = 0;
      st.blend = st.from ? 0 : 1; st.fromMode = st.mode; st.mode = view; st.sel = s.selected; st.head.init = false; st.third.init = false;
      if (view !== 'free') st.fr.eye = null;   // a script's eye camera ends with the free view
    }
    broadcast(t, dtPlay, snap, tmp.out);              // always runs, so going back to it is seamless
    const out = tmp.out;
    out.up.set(0, 1, 0);
    let ok = true;
    const ak = AERIAL[view];
    if (view === 'tactical') tactical(dtUser, snap, out);
    else if (ak) aerial(ak, dtUser, out);
    else if (view === 'free') free(t, dtPlay, out);
    else if (view === 'third') ok = third(s.selected ?? 0, t, dtPlay, snap, out);
    else if (view === 'first') ok = !!(data.joints && ix) && eyes(data.joints, ix, s.selected ?? 0, `p${s.selected}`, t, dtPlay, snap, out);
    else if (oi !== undefined) ok = eyes(data.officials!.joints!, oix!, oi, `o${oi}`, t, dtPlay, snap, out);
    if (!ok) { out.up.set(0, 1, 0); broadcast(t, 0, false, out); }
    // the one-sided views' poses turned back round the centre spot (see turn above)
    const oneSided = !ok || view === 'tactical' || (!ak && view !== 'free' && view !== 'third' && view !== 'first' && oi === undefined);
    if (orient < 0 && oneSided) for (const v of [out.pos, out.look, out.up]) { v.x = -v.x; v.z = -v.z; }
    // the crowd's bounce after a goal (BOUNCE): the broadcast camera dropping on each landing and its stand swaying, in the
    // Watch mode
    if (view === 'broadcast' && s.mode === 'watch') {
      const g = goals.find((x) => t >= x && t - x <= BOUNCE.endS);
      if (g !== undefined) {
        const [yaw, pitch, roll, drop] = bounceAt(t - g), f = _sf.subVectors(out.look, out.pos), dist = f.length();
        f.multiplyScalar(1 / dist);
        const r = _sr.crossVectors(f, out.up).normalize(), u = _su.crossVectors(r, f);
        out.look.addScaledVector(r, Math.tan(yaw) * dist).addScaledVector(u, Math.tan(pitch) * dist);
        out.up.applyAxisAngle(f, roll);
        out.pos.y += drop; out.look.y += drop;
      }
    }
    // place the camera, blending from the previous view
    tmp.m.lookAt(out.pos, out.look, out.up); tmp.q.setFromRotationMatrix(tmp.m);
    st.blend = Math.min(1, st.blend + dtUser / st.blendDur); swapBoard.cam = st.blend;
    if (st.from && st.blend < 1 && view === 'tactical' && clipSwap.get() === 'off') toTop(st.from, out, st.blend);
    else if (st.from && st.blend < 1) {
      const e = ease(st.blend);
      camera.position.lerpVectors(st.from.pos, out.pos, e); camera.quaternion.slerpQuaternions(st.from.quat, tmp.q, e); cam.fov = st.from.fov + (out.fov - st.from.fov) * e;
    } else { camera.position.copy(out.pos); camera.quaternion.copy(tmp.q); cam.fov = out.fov; }
    cam.near = st.blend < 1 ? Math.min(cam.near, out.near) : out.near;
    cam.updateProjectionMatrix();
    // hide whoever the camera sits in; cut the near stand only while the camera is behind it
    const inHead = (h: THREE.Vector3) => camera.position.distanceTo(h) < 1.2;
    hide.current = view === 'first' && s.selected !== null && inHead(st.head.pos) ? s.selected : -1;
    hideOfficial.current = oi !== undefined && inHead(st.head.pos) ? oi : -1;
    // (never from outside the stadium: the drone would see the near stand cut away). Not for the free camera in the
    // stadium's air either (over the main stand the cut left a bare grey floor under it, as if the scene
    // had not loaded): the air is clear of the seats and the roof, so nothing of the stand stands between it and the
    // pitch; the same while blending out of the free view until the camera leaves the air (the broadcast camera sits in
    // the main stand and keeps the cut)
    const inside = Math.abs(camera.position.x) < 105 && Math.abs(camera.position.z) < 85;
    const freeAir = (view === 'free' || view === 'broadcast' || (st.blend < 1 && (st.fromMode === 'free' || st.fromMode === 'broadcast'))) && inAir(camera.position);
    // (the near stand is on the camera's side, so on the other touchline when the stadium is turned round)
    clipPlane.normal.set(0, 0, -orient);
    clipPlane.constant = !ak && inside && !freeAir && orient * camera.position.z > HY - 0.5 ? HY + 0.1 : 1e5;
    // back to the broadcast view on its own: while the clip plays, once nobody has touched the mouse,
    // the wheel or a key for IDLE.s seconds and the ball has been out of the frame for IDLE.outS seconds (not from the
    // broadcast view itself, nor the top-down one, which holds the pitch); never while a director script drives the camera
    // (window.__camScripted = true)
    const ballNow = ballAt(data.pkg, t), scripted = hooked<boolean>('camScripted') === true;
    if (view !== 'broadcast' && view !== 'tactical' && dtPlay > 0 && ballNow && !scripted) {
      const v = tmp.v.set(ballNow[0], Math.max(0.11, ballNow[2]), ballNow[1]).project(camera);
      st.outFor = v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1 ? st.outFor + dtPlay : 0;
      if (st.outFor >= IDLE.outS && performance.now() - st.lastInput >= IDLE.s * 1000) { st.outFor = 0; setSettings({ view: 'broadcast' }); }
    } else if (view === 'broadcast' || view === 'tactical') st.outFor = 0;
    // the radar's way round (camFacing above)
    {
      const up = tmp.v.set(0, 1, 0).applyQuaternion(camera.quaternion).z, fwd = tmp.w.set(0, 0, -1).applyQuaternion(camera.quaternion).z, g = up + fwd;
      if (g < -0.25) camFacing.sign = 1; else if (g > 0.25) camFacing.sign = -1;
      camFacing.live = true;
    }
    // the night outside for the drone (stadium/night.ts): the fog closes in past the stadium, the sky light and the fills dim
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      st.fog ??= { near: fog.near, far: fog.far };
      st.fogK += ((ak && !ak.inside ? 1 : 0) - st.fogK) * Math.min(1, dtUser / 0.6);
      nightOutside(scene, st.fogK, camera.position.length(), st.fog);
    }
  });
  return null;
}
