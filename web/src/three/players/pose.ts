import * as THREE from 'three';
import type { Joints } from '../../data';

// Shared pose sampling for the player styles: the tracked joints at time t, in Three.js coordinates (x, up, y),
// interpolated between the 25 fps samples. The tracking's feet dip a few centimetres below the grass, so each foot
// (ankle, heel, toes) is lifted until its lowest point clears the ground.

export const FOOT_CLEAR = 0.015;

export interface PoseIndex { [name: string]: number }
export const poseIndex = (j: Joints): PoseIndex => Object.fromEntries(j.names.map((n, i) => [n, i]));

const FEET = [['rAnkle', 'rHeel', 'rBigToe', 'rSmallToe'], ['lAnkle', 'lHeel', 'lBigToe', 'lSmallToe']];

/** fills out (players x joints x 3) with the pose at t seconds; returns false where t is outside the samples */
export function poseAt(J: Joints, ix: PoseIndex, t: number, out: Float32Array): boolean {
  const { data, players, fps, frames } = J, nJ = J.names.length;
  const fpos = t * fps;
  if (fpos < 0 || fpos > frames - 1) return false;
  const i0 = Math.min(frames - 2, Math.floor(fpos)), f = fpos - i0, i1 = i0 + 1;
  for (let p = 0; p < players; p++) for (let j = 0; j < nJ; j++) {
    const a = ((i0 * players + p) * nJ + j) * 3, b = ((i1 * players + p) * nJ + j) * 3, o = (p * nJ + j) * 3;
    out[o] = data[a] + (data[b] - data[a]) * f;
    out[o + 1] = data[a + 2] + (data[b + 2] - data[a + 2]) * f;
    out[o + 2] = data[a + 1] + (data[b + 1] - data[a + 1]) * f;
  }
  for (let p = 0; p < players; p++) for (const foot of FEET) {
    let lo = Infinity;
    for (const n of foot) lo = Math.min(lo, out[(p * nJ + ix[n]) * 3 + 1]);
    if (lo < FOOT_CLEAR) for (const n of foot) out[(p * nJ + ix[n]) * 3 + 1] += FOOT_CLEAR - lo;
  }
  return true;
}

export const jointOf = (pose: Float32Array, nJ: number, p: number, j: number, v: THREE.Vector3) => v.fromArray(pose, (p * nJ + j) * 3);

// scratch for torsoFrame (called for every player several times a frame: no allocations)
const _neck = new THREE.Vector3(), _hip = new THREE.Vector3(), _rs = new THREE.Vector3(), _ls = new THREE.Vector3(), _rh = new THREE.Vector3(), _lh = new THREE.Vector3();
const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _x = new THREE.Vector3();
/** the body frame of player p: up along the spine, right across the shoulders, forward out of the chest */
export function torsoFrame(pose: Float32Array, nJ: number, ix: PoseIndex, p: number, m: THREE.Matrix4) {
  const neck = jointOf(pose, nJ, p, ix.neck, _neck), hip = jointOf(pose, nJ, p, ix.midHip, _hip);
  const rs = jointOf(pose, nJ, p, ix.rShoulder, _rs), ls = jointOf(pose, nJ, p, ix.lShoulder, _ls);
  const rh = jointOf(pose, nJ, p, ix.rHip, _rh), lh = jointOf(pose, nJ, p, ix.lHip, _lh);
  const up = _up.copy(neck).sub(hip).normalize();
  const right = rs.sub(ls).add(rh.sub(lh));
  right.addScaledVector(up, -right.dot(up)).normalize();
  // forward out of the chest from the spine and the hip and shoulder lines only (the joints are aligned right-handed in
  // loadMoment); the head's way is not consulted, since a player may look back over his shoulder. The basis (up x fwd,
  // up, fwd) is right-handed, which instanced meshes need: a mirrored instance is drawn inside out
  const fwd = _fwd.crossVectors(up, right).normalize();
  return m.makeBasis(_x.crossVectors(up, fwd), up, fwd);
}

/** world height of the screen at distance 1, in pixels: point sizes in metres become pixels */
export const focalPx = (heightPx: number, fovDeg: number) => (0.5 * heightPx) / Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
