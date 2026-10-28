import { parseClip, inMatch, clipFile } from './data/paths';
import type { MomentPkg } from './types';

export interface Joints { fps: number; frames: number; players: number; nAtt: number; names: string[]; data: Float32Array; flip: [number, number]; }
/** the referee and the two assistant referees (clip packages from private/hawkeye/export_clips.py, 2026-10-22):
 *  positions at the package's 10 fps, [frame][official] = [x, y], and their joints like the players' */
export interface Officials { roles: string[]; pos: [number, number][][]; joints: Joints | null; }
export interface Loaded { pkg: MomentPkg; joints: Joints | null; officials?: Officials | null; }

/** a clip package by its address (`pel-wil/<id>`, or an old form paths.parseClip reads), with its joints and the
 *  officials' joints, whose paths inside the package are relative to the match folder */
export async function loadMoment(file: string): Promise<Loaded> {
  const match = parseClip(file).match, storedFile = (rel: string) => inMatch(rel, match);
  const pkg = await (await fetch(clipFile(file))).json() as MomentPkg & { joints?: { file: string; fps: number; frames: number; players: number; n_att: number; names: string[] };
    officials?: { roles: string[]; pos: [number, number][][]; joints: { file: string; fps: number; frames: number; players: number; names: string[] } | null } };
  let joints: Joints | null = null;
  const clean = new URLSearchParams(location.search).get('clean') !== '0';
  if (pkg.joints) {
    const buf = await (await fetch(storedFile(pkg.joints.file))).arrayBuffer();
    joints = { fps: pkg.joints.fps, frames: pkg.joints.frames, players: pkg.joints.players, nAtt: pkg.joints.n_att, names: pkg.joints.names, data: new Float32Array(buf), flip: [1, 1] };
    alignJoints(pkg, joints);
    if (clean) cleanJoints(joints);
  }
  let officials: Officials | null = null;
  if (pkg.officials) {
    let oj: Joints | null = null;
    if (pkg.officials.joints) {
      const o = pkg.officials.joints, buf = await (await fetch(storedFile(o.file))).arrayBuffer();
      // written by the same exporter as the players' joints, so mirrored the same way: take the players' signs
      oj = { fps: o.fps, frames: o.frames, players: o.players, nAtt: o.players, names: o.names, data: new Float32Array(buf), flip: joints?.flip ?? [1, 1] };
      if (oj.flip[0] !== 1 || oj.flip[1] !== 1) for (let k = 0; k < oj.data.length; k += 3) { oj.data[k] *= oj.flip[0]; oj.data[k + 1] *= oj.flip[1]; }
      if (clean) cleanJoints(oj);
    }
    officials = { roles: pkg.officials.roles, pos: pkg.officials.pos, joints: oj };
  }
  return { pkg, joints, officials };
}

/** a clip's files fetched ahead into the browser's cache, nothing kept (GameApp: the next clip while this one plays, so
 *  a change to it waits on no download; a clip is 2 to 9 MB). Once a page; a failed try is tried again next time */
const fetchedAhead = new Set<string>();
export async function prefetchMoment(file: string): Promise<void> {
  if (fetchedAhead.has(file)) return;
  fetchedAhead.add(file);
  try {
    const match = parseClip(file).match;
    const pkg = await (await fetch(clipFile(file))).json() as { joints?: { file: string }; officials?: { joints: { file: string } | null } };
    const files = [pkg.joints?.file, pkg.officials?.joints?.file].filter((f): f is string => !!f);
    await Promise.all(files.map((f) => fetch(inMatch(f, match)).then((r) => r.arrayBuffer())));
  } catch { fetchedAhead.delete(file); }
}

/** Seconds covered by a package and the decision time. */
export const duration = (p: MomentPkg) => (p.frames.length - 1) / p.meta.fps;
export const decisionTime = (p: MomentPkg) => p.meta.decision_frame / p.meta.fps;

/** The exported joints are mirrored against the package's positions and ball: in the first half y is reversed, in the
 *  second x (checked on all 30 moments, 2026-10-21). Mirrored, the bodies were also drawn inside out, right shoulder on
 *  the left. Choose the signs that put each player's hip centre on his tracked position, and apply them in place. */
function alignJoints(pkg: MomentPkg, J: Joints) {
  const nJ = J.names.length, hip = J.names.indexOf('midHip');
  if (hip < 0) return;
  let best: [number, number] = [1, 1], bestErr = Infinity;
  for (const sx of [1, -1]) for (const sy of [1, -1]) {
    const errs: number[] = [];
    for (let k = 0; k < pkg.frames.length; k += 10) {
      const jf = Math.round((k / pkg.meta.fps) * J.fps), fr = pkg.frames[k], pos = [...fr.att, ...fr.def];
      if (jf >= J.frames) break;
      for (let p = 0; p < Math.min(J.players, pos.length); p++) {
        const o = ((jf * J.players + p) * nJ + hip) * 3;
        errs.push(Math.hypot(sx * J.data[o] - pos[p][0], sy * J.data[o + 1] - pos[p][1]));
      }
    }
    errs.sort((a, b) => a - b);
    const med = errs[errs.length >> 1] ?? Infinity;
    if (med < bestErr) { bestErr = med; best = [sx, sy]; }
  }
  J.flip = best;
  if (best[0] === 1 && best[1] === 1) return;
  for (let k = 0; k < J.data.length; k += 3) { J.data[k] *= best[0]; J.data[k + 1] *= best[1]; }
}

// ---- cleaning the tracked skeletons. The tracking is vision based, and a player lying on the grass is tracked badly:
// limbs stretch (bones up to three times their length) and joints jump. Measured on the 30 moments, 0.8% of player-frames
// had a bone off by more than 25%, nearly all of them players on the ground. The cleaning keeps the raw directions of the
// bones and repairs what is implausible: one-frame spikes, bone lengths, and the jitter of a lying body.

const BONE_TREE: [string, string][] = [
  ['midHip', 'neck'], ['neck', 'nose'], ['neck', 'rEye'], ['neck', 'lEye'], ['neck', 'rEar'], ['neck', 'lEar'],
  ['neck', 'rShoulder'], ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'], ['rWrist', 'rThumb'], ['rWrist', 'rPinky'],
  ['neck', 'lShoulder'], ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'], ['lWrist', 'lThumb'], ['lWrist', 'lPinky'],
  ['midHip', 'rHip'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['rAnkle', 'rHeel'], ['rAnkle', 'rBigToe'], ['rAnkle', 'rSmallToe'],
  ['midHip', 'lHip'], ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['lAnkle', 'lHeel'], ['lAnkle', 'lBigToe'], ['lAnkle', 'lSmallToe'],
];

function cleanJoints(J: Joints) {
  const nJ = J.names.length, F = J.frames, P = J.players, D = J.data, ix = Object.fromEntries(J.names.map((n, i) => [n, i]));
  if (BONE_TREE.some(([a, b]) => ix[a] === undefined || ix[b] === undefined)) return;
  const at = (f: number, p: number, j: number) => ((f * P + p) * nJ + j) * 3;
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };
  const len = (f: number, p: number, a: number, b: number) => { const i = at(f, p, a), k = at(f, p, b); return Math.hypot(D[i] - D[k], D[i + 1] - D[k + 1], D[i + 2] - D[k + 2]); };
  const upright = (f: number, p: number) => { const i = at(f, p, ix.neck), k = at(f, p, ix.midHip), dz = D[i + 2] - D[k + 2]; return dz / (Math.hypot(D[i] - D[k], D[i + 1] - D[k + 1], dz) || 1); };
  let spikes = 0, fixedBones = 0, lying = 0;
  // 1. one-frame spikes: a joint far from the median of its neighbours over +-3 frames is replaced by that median. The
  //    medians of these windows (22 x 29 x 3 x every frame of them) are taken in two fixed buffers, not sorted copies:
  //    the same values bit for bit on every clip, ten times quicker (0.8 s of a clip change, 2026-10-27)
  const W = 3, w7 = new Float64Array(2 * W + 1), d7 = new Float64Array(2 * W + 1);
  const mid = (b: Float64Array, n: number) => { for (let i = 1; i < n; i++) { const v = b[i]; let k = i - 1; while (k >= 0 && b[k] > v) { b[k + 1] = b[k]; k--; } b[k + 1] = v; } return b[n >> 1]; };
  const x = new Float64Array(F), out = new Float64Array(F);
  for (let p = 0; p < P; p++) for (let j = 0; j < nJ; j++) for (let c = 0; c < 3; c++) {
    for (let f = 0; f < F; f++) out[f] = x[f] = D[at(f, p, j) + c];
    for (let f = 0; f < F; f++) {
      const lo = Math.max(0, f - W), n = Math.min(F, f + W + 1) - lo;
      for (let i = 0; i < n; i++) w7[i] = x[lo + i];
      const m = mid(w7, n);
      for (let i = 0; i < n; i++) d7[i] = Math.abs(x[lo + i] - m);
      const mad = mid(d7, n);
      if (Math.abs(x[f] - m) > 3 * 1.4826 * mad + 0.08) { out[f] = m; spikes++; }
    }
    for (let f = 0; f < F; f++) D[at(f, p, j) + c] = out[f];
  }
  // 2. bone lengths: each player's own, from his upright frames (the team's when he never stands in the moment); where
  //    a bone is off by more than about 10%, it is set back to its length along the tracked direction, root to tips
  const pop = BONE_TREE.map(([a, b]) => { const v: number[] = []; for (let f = 0; f < F; f += 5) for (let p = 0; p < P; p++) if (upright(f, p) > 0.8) v.push(len(f, p, ix[a], ix[b])); return med(v); });
  for (let p = 0; p < P; p++) {
    const L = BONE_TREE.map(([a, b], k) => { const v: number[] = []; for (let f = 0; f < F; f++) if (upright(f, p) > 0.8) v.push(len(f, p, ix[a], ix[b])); return v.length > 10 ? med(v) : pop[k]; });
    for (let f = 0; f < F; f++) {
      const raw = new Float32Array(nJ * 3); for (let j = 0; j < nJ; j++) for (let c = 0; c < 3; c++) raw[j * 3 + c] = D[at(f, p, j) + c];
      BONE_TREE.forEach(([an, bn], k) => {
        const a = ix[an], b = ix[bn], dx = raw[b * 3] - raw[a * 3], dy = raw[b * 3 + 1] - raw[a * 3 + 1], dz = raw[b * 3 + 2] - raw[a * 3 + 2];
        const l = Math.hypot(dx, dy, dz) || 1e-6, dev = Math.abs(l / (L[k] || l) - 1), wgt = Math.min(1, Math.max(0, (dev - 0.08) / 0.12));
        if (wgt > 0) fixedBones++;
        const pa = at(f, p, a), pb = at(f, p, b), tl = l + (L[k] - l) * wgt;
        D[pb] = D[pa] + (dx / l) * tl; D[pb + 1] = D[pa + 1] + (dy / l) * tl; D[pb + 2] = D[pa + 2] + (dz / l) * tl;
      });
    }
  }
  // 3. a body on the ground (the spine within 60 degrees of the grass, or the hips below 55 cm: lying, sitting or
  //    kneeling): smoothed over about a third of a second, never below the grass
  for (let p = 0; p < P; p++) {
    const down = Array.from({ length: F }, (_, f) => upright(f, p) < 0.5 || D[at(f, p, ix.midHip) + 2] < 0.55);
    if (!down.some(Boolean)) continue;
    const sm = new Float32Array(F * nJ * 3), G = [1, 4, 7, 9, 7, 4, 1], g0 = 3;
    for (let f = 0; f < F; f++) {
      if (!down[f]) continue;
      lying++;
      for (let j = 0; j < nJ; j++) for (let c = 0; c < 3; c++) {
        let acc = 0, wsum = 0;
        for (let k = -g0; k <= g0; k++) { const ff = Math.min(F - 1, Math.max(0, f + k)); acc += D[at(ff, p, j) + c] * G[k + g0]; wsum += G[k + g0]; }
        sm[(f * nJ + j) * 3 + c] = acc / wsum;
      }
    }
    for (let f = 0; f < F; f++) if (down[f]) for (let j = 0; j < nJ; j++) {
      for (let c = 0; c < 3; c++) D[at(f, p, j) + c] = sm[(f * nJ + j) * 3 + c];
      if (D[at(f, p, j) + 2] < 0.04) D[at(f, p, j) + 2] = 0.04;
    }
  }
  (window as unknown as { __clean?: unknown }).__clean = { spikes, fixedBones, lyingFrames: lying, playerFrames: F * P };
}
