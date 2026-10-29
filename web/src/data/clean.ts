// The tracked joints cleaned as a clip loads (data.ts loadMoment): one-frame spikes, bone lengths, bodies on the
// ground. Pure, on the arrays it is given, so it runs the same on the main thread or in cleanWorker.ts (three/quality.ts
// xOn 'cleanworker': the clip change's few hundred ms of it off the page, so the board and its pulse turn smoothly; on
// the main thread the hexagons' fan-out lagged).

export interface CleanInput { names: string[]; frames: number; players: number; data: Float32Array }
export interface CleanStats { spikes: number; fixedBones: number; lyingFrames: number; playerFrames: number }

const BONE_TREE: [string, string][] = [
  ['midHip', 'neck'], ['neck', 'nose'], ['neck', 'rEye'], ['neck', 'lEye'], ['neck', 'rEar'], ['neck', 'lEar'],
  ['neck', 'rShoulder'], ['rShoulder', 'rElbow'], ['rElbow', 'rWrist'], ['rWrist', 'rThumb'], ['rWrist', 'rPinky'],
  ['neck', 'lShoulder'], ['lShoulder', 'lElbow'], ['lElbow', 'lWrist'], ['lWrist', 'lThumb'], ['lWrist', 'lPinky'],
  ['midHip', 'rHip'], ['rHip', 'rKnee'], ['rKnee', 'rAnkle'], ['rAnkle', 'rHeel'], ['rAnkle', 'rBigToe'], ['rAnkle', 'rSmallToe'],
  ['midHip', 'lHip'], ['lHip', 'lKnee'], ['lKnee', 'lAnkle'], ['lAnkle', 'lHeel'], ['lAnkle', 'lBigToe'], ['lAnkle', 'lSmallToe'],
];

export function cleanJoints(J: CleanInput): CleanStats | null {
  const nJ = J.names.length, F = J.frames, P = J.players, D = J.data, ix = Object.fromEntries(J.names.map((n, i) => [n, i]));
  if (BONE_TREE.some(([a, b]) => ix[a] === undefined || ix[b] === undefined)) return null;
  const at = (f: number, p: number, j: number) => ((f * P + p) * nJ + j) * 3;
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };
  const len = (f: number, p: number, a: number, b: number) => { const i = at(f, p, a), k = at(f, p, b); return Math.hypot(D[i] - D[k], D[i + 1] - D[k + 1], D[i + 2] - D[k + 2]); };
  const upright = (f: number, p: number) => { const i = at(f, p, ix.neck), k = at(f, p, ix.midHip), dz = D[i + 2] - D[k + 2]; return dz / (Math.hypot(D[i] - D[k], D[i + 1] - D[k + 1], dz) || 1); };
  let spikes = 0, fixedBones = 0, lying = 0;
  // 1. one-frame spikes: a joint far from the median of its neighbours over +-3 frames is replaced by that median. The
  //    medians of these windows (22 x 29 x 3 x every frame of them) are taken in two fixed buffers, not sorted copies:
  //    the same values bit for bit on every clip, ten times quicker (sorting took 0.8 s of a clip change)
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
  return { spikes, fixedBones, lyingFrames: lying, playerFrames: F * P };
}
