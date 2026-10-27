import type { Joints } from '../data';

/** Entirely hand-authored fixture. No tracking feed, trained weights or exported
 * animations are used. Coordinates use x along pitch, y across, z up, in metres.
 */
export const SAMPLE_SECONDS = 12;
const FPS = 10;
const FORMATION: [number, number][] = [
  [-46, 0], [-28, -23], [-30, -8], [-30, 8], [-28, 23],
  [-10, -18], [-8, 0], [-10, 18], [10, -19], [14, 0], [10, 19],
];
const BODY: Record<string, [number, number, number]> = {
  midHip: [0, 0, 0.92], neck: [0, 0, 1.49], nose: [0.08, 0, 1.69],
  rEye: [0.075, -0.035, 1.72], lEye: [0.075, 0.035, 1.72],
  rEar: [0, -0.08, 1.70], lEar: [0, 0.08, 1.70],
  rShoulder: [0, -0.22, 1.43], rElbow: [0.02, -0.32, 1.14], rWrist: [0.06, -0.32, 0.89],
  rThumb: [0.09, -0.29, 0.85], rPinky: [0.03, -0.35, 0.84],
  lShoulder: [0, 0.22, 1.43], lElbow: [-0.02, 0.32, 1.14], lWrist: [-0.06, 0.32, 0.89],
  lThumb: [-0.03, 0.29, 0.85], lPinky: [-0.09, 0.35, 0.84],
  rHip: [0, -0.11, 0.90], rKnee: [0.02, -0.12, 0.50], rAnkle: [0, -0.12, 0.09],
  rHeel: [-0.06, -0.12, 0.06], rBigToe: [0.16, -0.10, 0.04], rSmallToe: [0.14, -0.17, 0.04],
  lHip: [0, 0.11, 0.90], lKnee: [-0.02, 0.12, 0.50], lAnkle: [0, 0.12, 0.09],
  lHeel: [-0.06, 0.12, 0.06], lBigToe: [0.16, 0.10, 0.04], lSmallToe: [0.14, 0.17, 0.04],
};

export function samplePositions(t: number): [number, number][] {
  return Array.from({ length: 22 }, (_, i) => {
    const base = FORMATION[i % 11], sign = i < 11 ? 1 : -1;
    const jog = i % 11 ? 1.5 * Math.sin(t * 0.4 + i * 0.7) : 0;
    return [sign * base[0] + jog, sign * base[1]];
  });
}

export function sampleBall(t: number): [number, number, number] {
  const p = samplePositions(t), alpha = Math.min(1, Math.max(0, (t - 3) / 2));
  return [p[6][0] * (1 - alpha) + p[9][0] * alpha,
    p[6][1] * (1 - alpha) + p[9][1] * alpha, 0.22 + 0.8 * Math.sin(alpha * Math.PI)];
}

export function sampleJoints(): Joints {
  const names = Object.keys(BODY), frames = SAMPLE_SECONDS * FPS + 1;
  const data = new Float32Array(frames * 22 * names.length * 3);
  for (let f = 0; f < frames; f++) {
    const t = f / FPS, positions = samplePositions(t);
    for (let p = 0; p < 22; p++) for (let j = 0; j < names.length; j++) {
      const [x, y, z] = BODY[names[j]], at = ((f * 22 + p) * names.length + j) * 3;
      const sign = p < 11 ? 1 : -1;
      data[at] = positions[p][0] + sign * x;
      data[at + 1] = positions[p][1] + sign * y;
      data[at + 2] = z;
    }
  }
  return { fps: FPS, frames, players: 22, nAtt: 11, names, data, flip: [1, 1] };
}
