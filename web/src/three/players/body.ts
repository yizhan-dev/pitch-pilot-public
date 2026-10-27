import * as THREE from 'three';
import { KIT, TEAM_KIT, type Team } from '../coords';
import { jointOf, type PoseIndex } from './pose';

// The body used by the figure styles: tapered limbs between joints and ellipsoids for the torso, head and joints.
// Sizes in metres, after adult male averages; the tracked joints set the lengths, so only the girths are chosen here.

export type Part = 'shirt' | 'shorts' | 'socks' | 'skin' | 'boot' | 'hair';
/** a joint, a virtual joint (earMid, rHand, lHand), or a point t of the way from one to another */
export type End = string | [string, string, number];
/** a limb between two points: a taper from ra to rb, or a turned profile (t from a to b, radius) for muscle and joints */
/** grp: which body-type factor widens it (looks.ts Build); arm: bare arm, which a keeper's long sleeves cover */
export type Grp = 'arm' | 'leg' | 'neck' | 'torso' | 'head' | 'hand' | 'foot';
/** asym: an uneven section along the limb, (t, side, front, back) half-widths in metres, the front facing `front`: the
 *  shin runs straight in front while the calf swells behind, the quadriceps swell at the front of the thigh, the biceps
 *  on the side the elbow bends to ("straights against curves") */
export interface Limb { a: End; b: End; ra: number; rb: number; part: Part; prof?: [number, number][]; grp: Grp; arm?: boolean;
  asym?: [number, number, number, number][]; front?: 'foot' | 'elbow' | 'thumb' | 'instep' }
export interface Blob { at: End; frame: 'torso' | 'head' | 'rHand' | 'lHand' | 'rFoot' | 'lFoot' | 'rThigh' | 'lThigh' | 'none'; r: [number, number, number]; part: Part; lift?: number; back?: number; grp: Grp; arm?: boolean }

// Limbs narrow into the joints and swell between them: the thigh tapers to the knee, the calf swells below it and
// thins to the ankle, the forearm swells below the elbow and thins to the wrist, so a bend reads as a joint rather than
// a ball between two tubes. The socks start a hand's width below the knee, as match socks do.
const side = (s: 'r' | 'l'): Limb[] => [
  // the sleeve narrows at its top, inside the shoulder ball, so its rim does not square the shoulder off
  { a: [`${s}Shoulder`, `${s}Elbow`, 0.06], b: [`${s}Shoulder`, `${s}Elbow`, 0.48], ra: 0.054, rb: 0.061, part: 'shirt', prof: [[0, 0.054], [0.22, 0.061], [1, 0.061]], grp: 'arm' },
  { a: [`${s}Shoulder`, `${s}Elbow`, 0.44], b: `${s}Elbow`, ra: 0.05, rb: 0.04, part: 'skin', asym: [[0, 0.049, 0.05, 0.047], [0.45, 0.046, 0.054, 0.044], [1, 0.039, 0.04, 0.039]], front: 'elbow', grp: 'arm', arm: true },
  // the heel of the hand: a short taper from the wrist to the fist, so the fist sits a hand's length out, not on the wrist
  { a: `${s}Wrist`, b: [`${s}Wrist`, `${s}Hand`, 0.62], ra: 0.022, rb: 0.031, part: 'skin', grp: 'hand' },
  { a: `${s}Elbow`, b: `${s}Wrist`, ra: 0.041, rb: 0.029, part: 'skin', asym: [[0, 0.04, 0.042, 0.04], [0.25, 0.047, 0.05, 0.044], [0.62, 0.032, 0.036, 0.033], [1, 0.02, 0.026, 0.024]], front: 'thumb', grp: 'arm', arm: true },   // swelling on the thumb side; the wrist flat, about 5 cm wide and 4 cm deep
  // the shorts' leg: the whole thigh, shown right up to the hip, its top a rounded dome above the hip joint that the
  // short pelvis sits between; it swings with the leg, so the hip and seat move with the stride
  { a: [`${s}Hip`, `${s}Knee`, -0.16], b: [`${s}Hip`, `${s}Knee`, 0.52], ra: 0.03, rb: 0.087, part: 'shorts', prof: [[0, 0.03], [0.06, 0.068], [0.16, 0.084], [0.3, 0.089], [0.7, 0.089], [1, 0.087]], grp: 'leg' },
  { a: [`${s}Hip`, `${s}Knee`, 0.45], b: `${s}Knee`, ra: 0.075, rb: 0.05, part: 'skin', asym: [[0, 0.073, 0.077, 0.072], [0.45, 0.066, 0.073, 0.06], [0.85, 0.054, 0.057, 0.05], [1, 0.05, 0.052, 0.047]], front: 'foot', grp: 'leg' },
  // below the knee the kneecap stands at the front and the calf begins behind
  { a: `${s}Knee`, b: [`${s}Knee`, `${s}Ankle`, 0.16], ra: 0.05, rb: 0.054, part: 'skin', asym: [[0, 0.049, 0.054, 0.046], [1, 0.05, 0.048, 0.058]], front: 'foot', grp: 'leg' },
  // the boot: one shape from a rounded heel to a pointed toe, the instep high and the sole flat, its top towards the ankle
  { a: [`${s}Heel`, `${s}BigToe`, -0.1], b: [`${s}Heel`, `${s}BigToe`, 1.08], ra: 0.04, rb: 0.03, part: 'boot', grp: 'foot', front: 'instep',
    asym: [[0, 0.006, 0.006, 0.004], [0.07, 0.032, 0.034, 0.018], [0.2, 0.042, 0.046, 0.022], [0.45, 0.047, 0.042, 0.022], [0.75, 0.045, 0.028, 0.02], [0.94, 0.03, 0.016, 0.013], [1, 0.006, 0.005, 0.004]] },
  { a: [`${s}Knee`, `${s}Ankle`, 0.13], b: `${s}Ankle`, ra: 0.058, rb: 0.035, part: 'socks', asym: [[0, 0.055, 0.05, 0.062], [0.3, 0.057, 0.049, 0.074], [0.62, 0.045, 0.043, 0.05], [1, 0.035, 0.036, 0.033]], front: 'foot', grp: 'leg' },
];
// the neck rises from inside the torso's collar towards the middle of the head (between the ears, a little forward), not
// towards the nose, and ends inside the head, so neither end shows
export const LIMBS: Limb[] = [...side('r'), ...side('l'),
  { a: 'neck', b: ['earMid', 'nose', 0.3], ra: 0.056, rb: 0.046, part: 'skin', prof: [[0, 0.056], [0.4, 0.049], [1, 0.046]], grp: 'neck' }];   // about 10 cm across

/** The torso, lofted through cross-sections from below the hips to the collar: h is the height up the spine as a share of
 *  hip-to-neck (about 0.6 m), w and d the half-width and half-depth in metres. Each section is a rounded rectangle
 *  (a superellipse), turned from the hips' heading at the bottom to the shoulders' at the top, so the body twists as
 *  the player turns. The shorts run up to a waistband, where two sections at one height switch to the shirt. */
export const TORSO_RINGS: { h: number; w: number; d: number; part: Part }[] = [
  // the pelvis is short: it ends at the hips, between the tops of the thighs, so the thighs show up to the hip rather
  // than coming out of a block; below the waistband each side is still carried a little by its thigh (SEAT_FOLLOW)
  { h: 0.02, w: 0.118, d: 0.088, part: 'shorts' },
  { h: 0.09, w: 0.152, d: 0.1, part: 'shorts' },
  { h: 0.13, w: 0.164, d: 0.105, part: 'shorts' },
  { h: 0.13, w: 0.166, d: 0.106, part: 'shirt' },
  { h: 0.26, w: 0.164, d: 0.11, part: 'shirt' },
  { h: 0.45, w: 0.178, d: 0.12, part: 'shirt' },
  { h: 0.65, w: 0.195, d: 0.13, part: 'shirt' },
  { h: 0.82, w: 0.203, d: 0.125, part: 'shirt' },
  { h: 0.93, w: 0.188, d: 0.11, part: 'shirt' },
  { h: 0.99, w: 0.13, d: 0.086, part: 'shirt' },
  { h: 1.03, w: 0.064, d: 0.058, part: 'shirt' },
  { h: 1.065, w: 0.055, d: 0.052, part: 'shirt' },        // the neck's base (skin above the neckline, see Styles.tsx)
];
export const TORSO_SEG = 28, TORSO_N = 2.5;

/** a body's shape beyond its build, for figures drawn as women (the cast's guide, src/cast): factors on the torso's
 *  width at the hips, the waist and the shoulders, and the bust's extra depth at the front as a share (0: none) */
export interface Shape { hip: number; waist: number; shoulder: number; bust: number }
const SHAPE_AT = (s: Shape): [number, number][] => [[0, s.hip], [0.13, s.hip], [0.3, s.waist], [0.45, s.waist], [0.65, 1], [0.82, s.shoulder], [0.99, s.shoulder], [1.03, 1]];
/** the torso's width factor at height h (a share of hip-to-neck) for a shape; 1 without one */
export function shapeW(s: Shape | undefined, h: number) {
  if (!s) return 1;
  const st = SHAPE_AT(s);
  if (h <= st[0][0]) return st[0][1];
  for (let k = 1; k < st.length; k++) if (h <= st[k][0]) {
    const u = (h - st[k - 1][0]) / (st[k][0] - st[k - 1][0]), w = u * u * (3 - 2 * u);
    return st[k - 1][1] + (st[k][1] - st[k - 1][1]) * w;
  }
  return st[st.length - 1][1];
}
/** the share added to the torso's depth at the front at height h: the bust, round about 0.7 of the way up */
export function bustAt(s: Shape | undefined, h: number) {
  if (!s) return 0;
  const x = (h - 0.7) / 0.14;
  return Math.abs(x) >= 1 ? 0 : s.bust * (1 - x * x) ** 2;
}
/** the torso's section at height h as the loft draws it (linear between the rings): half-width, and half-depth to the
 *  front and to the back, metres, for a build's torso factor tw and a shape */
export function torsoSection(h: number, tw: number, s?: Shape) {
  const at = (r: (typeof TORSO_RINGS)[number]) => ({ w: r.w * tw * shapeW(s, r.h), f: r.d * tw * (1 + bustAt(s, r.h)), b: r.d * tw });
  let k = 1; while (k < TORSO_RINGS.length - 1 && TORSO_RINGS[k].h < h) k++;
  const r0 = TORSO_RINGS[k - 1], r1 = TORSO_RINGS[k], a = at(r0), c = at(r1);
  const u = Math.min(1, Math.max(0, (h - r0.h) / ((r1.h - r0.h) || 1)));
  return { w: a.w + (c.w - a.w) * u, front: a.f + (c.f - a.f) * u, back: a.b + (c.b - a.b) * u };
}

const joints = (s: 'r' | 'l'): Blob[] => [
  // the shoulder sits a little below and outside the tracked joint, so the line from the neck falls away to it
  { at: `${s}Shoulder`, frame: 'none', r: [0.056, 0.056, 0.056], part: 'shirt', lift: -0.03, grp: 'arm' },   // the deltoid, blending into the torso's shoulder
  { at: `${s}Elbow`, frame: 'none', r: [0.041, 0.041, 0.041], part: 'skin', grp: 'arm', arm: true },
  { at: `${s}Wrist`, frame: `${s}Hand`, r: [0.025, 0.022, 0.019], part: 'skin', grp: 'arm', arm: true },   // flat like the wrist, not a ball
  { at: `${s}Knee`, frame: 'none', r: [0.051, 0.051, 0.051], part: 'skin', grp: 'leg' },
  { at: `${s}Ankle`, frame: 'none', r: [0.036, 0.036, 0.036], part: 'socks', grp: 'leg' },
  // the boot: one rounded last from heel to toe, and a low collar round the heel and the ankle
  // the boot's low collar sits on the ankle joint, so the shin runs straight into its middle
  { at: [`${s}Ankle`, `${s}Heel`, 0.3], frame: `${s}Foot`, r: [0.041, 0.038, 0.045], part: 'boot', grp: 'foot' },
  // the hand as a loose fist: the tracking gives the wrist, thumb and little finger, so the hand's direction and its turn,
  // but not the fingers. A rounded fist 9 cm long, centred 8 cm out from the wrist; no thumb (Yi found it too big)
  { at: [`${s}Wrist`, `${s}Hand`, 0.82], frame: `${s}Hand`, r: [0.04, 0.045, 0.034], part: 'skin', grp: 'hand' },
];
/** the old torso of four ellipsoids, kept for the dot-matrix style, which samples blobs */
export const DOTS_TORSO: Blob[] = [
  { at: ['midHip', 'neck', 0.69], frame: 'torso', r: [0.205, 0.2, 0.125], part: 'shirt', grp: 'torso' },
  { at: 'neck', frame: 'torso', r: [0.17, 0.085, 0.1], part: 'shirt', lift: -0.055, grp: 'torso' },
  { at: ['midHip', 'neck', 0.39], frame: 'torso', r: [0.192, 0.225, 0.121], part: 'shirt', grp: 'torso' },
  { at: ['midHip', 'neck', 0.03], frame: 'torso', r: [0.172, 0.13, 0.12], part: 'shorts', grp: 'torso' },
];
export const BLOBS: Blob[] = [
  // a slightly large head, as cartoon figures have, with a short neck showing under it
  { at: ['earMid', 'nose', 0.3], frame: 'head', r: [0.1, 0.125, 0.113], part: 'skin', lift: -0.012, grp: 'head' },   // head (hair: looks.ts)
  ...joints('r'), ...joints('l'),
];

// scratch for the functions below, which run for every player and part each frame (no allocations); never handed out
const _w = new THREE.Vector3(), _b = new THREE.Vector3(), _f0 = new THREE.Vector3(), _f1 = new THREE.Vector3(), _f2 = new THREE.Vector3(), _f3 = new THREE.Vector3();
/** one named point, real or virtual (earMid, rHand, lHand), into out; w is scratch */
function onePoint(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, n: string, out: THREE.Vector3, w: THREE.Vector3) {
  if (n === 'earMid') return jointOf(pose, nJ, p, ix.rEar, out).add(jointOf(pose, nJ, p, ix.lEar, w)).multiplyScalar(0.5);
  if (n === 'rHand') return jointOf(pose, nJ, p, ix.rThumb, out).add(jointOf(pose, nJ, p, ix.rPinky, w)).multiplyScalar(0.5);
  if (n === 'lHand') return jointOf(pose, nJ, p, ix.lThumb, out).add(jointOf(pose, nJ, p, ix.lPinky, w)).multiplyScalar(0.5);
  return jointOf(pose, nJ, p, ix[n], out);
}
/** the points a body is built from, real or virtual, for player p */
export function pointOf(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, e: End, v: THREE.Vector3, w = _w): THREE.Vector3 {
  if (typeof e === 'string') return onePoint(pose, nJ, ix, p, e, v, w);
  const b = onePoint(pose, nJ, ix, p, e[1], _b, w);
  return onePoint(pose, nJ, ix, p, e[0], v, w).lerp(b, e[2]);
}

/** a hand's frame: y from the wrist towards the fingers, x across from the little finger to the thumb */
export function handFrame(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, s: 'r' | 'l', m: THREE.Matrix4) {
  const r = s === 'r';
  const w = jointOf(pose, nJ, p, ix[r ? 'rWrist' : 'lWrist'], _f0);
  const y = onePoint(pose, nJ, ix, p, r ? 'rHand' : 'lHand', _f1, _w).sub(w).normalize();
  const x = jointOf(pose, nJ, p, ix[r ? 'rThumb' : 'lThumb'], _f2).sub(jointOf(pose, nJ, p, ix[r ? 'rPinky' : 'lPinky'], _f3));
  x.addScaledVector(y, -x.dot(y)).normalize();
  return m.makeBasis(x, y, _f0.crossVectors(x, y));
}

/** a foot's frame: y from the heel to the big toe, x across to the little toe */
export function footFrame(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, s: 'r' | 'l', m: THREE.Matrix4) {
  const r = s === 'r';
  const h = jointOf(pose, nJ, p, ix[r ? 'rHeel' : 'lHeel'], _f0);
  const y = jointOf(pose, nJ, p, ix[r ? 'rBigToe' : 'lBigToe'], _f1).sub(h).normalize();
  const x = jointOf(pose, nJ, p, ix[r ? 'rSmallToe' : 'lSmallToe'], _f2).sub(jointOf(pose, nJ, p, ix[r ? 'rBigToe' : 'lBigToe'], _f3));
  x.addScaledVector(y, -x.dot(y)).normalize();
  return m.makeBasis(x, y, _f0.crossVectors(x, y));
}

/** a thigh's frame: y down the thigh from hip to knee, z towards the body's front (square to the thigh), x across */
export function thighFrame(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, s: 'r' | 'l', torso: THREE.Matrix4, m: THREE.Matrix4) {
  const r = s === 'r';
  const y = jointOf(pose, nJ, p, ix[r ? 'rKnee' : 'lKnee'], _f0).sub(jointOf(pose, nJ, p, ix[r ? 'rHip' : 'lHip'], _f1)).normalize();
  const z = _f2.setFromMatrixColumn(torso, 2);
  z.addScaledVector(y, -z.dot(y)).normalize();
  return m.makeBasis(_f3.crossVectors(y, z), y, z);
}

/** the frame a blob is laid in: the torso's, the head's, a hand's, or none */
export function blobFrame(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, b: Blob, torso: THREE.Matrix4, head: THREE.Matrix4, out: THREE.Matrix4) {
  if (b.frame === 'torso') return out.copy(torso);
  if (b.frame === 'head') return out.copy(head);
  if (b.frame === 'rHand' || b.frame === 'lHand') return handFrame(pose, nJ, ix, p, b.frame[0] as 'r' | 'l', out);
  if (b.frame === 'rFoot' || b.frame === 'lFoot') return footFrame(pose, nJ, ix, p, b.frame[0] as 'r' | 'l', out);
  if (b.frame === 'rThigh' || b.frame === 'lThigh') return thighFrame(pose, nJ, ix, p, b.frame[0] as 'r' | 'l', torso, out);
  return out.identity();
}

/** the head's frame: up along the spine, forward from the ears to the nose */
export function headFrame(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, torso: THREE.Matrix4, m: THREE.Matrix4) {
  const up = _f0.setFromMatrixColumn(torso, 1);
  const fwd = jointOf(pose, nJ, p, ix.nose, _f1).sub(onePoint(pose, nJ, ix, p, 'earMid', _f2, _w));
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const right = _f3.crossVectors(up, fwd).normalize();
  return m.makeBasis(right, up, fwd);
}

/** a part's colour in `team`'s kit (by team, not by role: coords.ts, Yi 2026-10-23) */
export const kitColor = (part: Part, team: Team) =>
  part === 'skin' ? KIT.skin : part === 'boot' ? KIT.boot : part === 'hair' ? '#26221f' : TEAM_KIT[team][part];
