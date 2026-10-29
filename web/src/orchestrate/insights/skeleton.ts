// What the 25 Hz skeletons say that the 10 Hz dots cannot: where a player's face points, which way his torso faces,
// which foot swings at a touch, and how many times he looked away from the ball before receiving it. The same
// definitions as private/orchestrator/profile.py (the whole-match profile), so a clip's numbers and the 本场 habits
// agree. Data frame: the package's (the attack towards +x).
import type { Loaded, Joints } from '../../data';
import type { XY } from '../geom';

const DEG = 180 / Math.PI;

export interface Skel {
  ok: boolean;
  /** a joint's position at clip time t (nearest sample), or null */
  joint(p: number, name: string, t: number): [number, number, number] | null;
  /** where the face points on the ground, radians (nose from between the ears); NaN without the joints */
  facing(p: number, t: number): number;
  /** the torso's facing: the horizontal normal of the shoulder line on the nose's side, radians */
  torso(p: number, t: number): number;
  /** peak speed (m/s) of each foot (ankle and big toe) over the 0.2 s up to t */
  swing(p: number, t: number): { L: number; R: number };
  /** the kicking foot at a touch at t: the faster-swinging one; 'either' under the ratio ABSTAIN; 'H' for a ball over
   *  HEAD_Z m; '?' without joints */
  foot(p: number, t: number, ballZ: number): { foot: 'L' | 'R' | 'either' | 'H' | '?'; L: number; R: number; ratio: number };
  /** scans in the SCAN_WIN s before t (the face turned over SCAN_HI degrees from the ball for 3 samples, back under
   *  SCAN_LO), and when the last one ended before t (s); null without the joints */
  scans(p: number, t: number, ball: (t: number) => XY | null): { n: number; last: number | null; trace: number[] } | null;
  /** the nearest of the player's feet, knees or head to a point at t, metres */
  reach(p: number, t: number, at: [number, number, number]): number;
  /** the player's standing height for the hips (the 95th percentile of his midHip z over the clip, 0.95 m without) */
  standing(p: number): number;
  /** midHip z over standing: under 0.85 crouched, 0.85-0.92 low, 0.92-0.97 usual, over 0.97 upright (the
   *  telestration body handover, measured on two matches) */
  hipRatio(p: number, t: number): number;
  /** both feet off the ground: all four foot joints over 0.12 m */
  inAir(p: number, t: number): boolean;
  /** the head's pitch, degrees: the nose against the ears' middle (looking down at the ball at his feet -30 to -60;
   *  head up, looking ahead, 0 or more; measured before the 41 clips' shots) */
  pitch(p: number, t: number): number;
  /** the front of the body as the offside law counts it (every joint but the arms and hands), the largest x */
  front(p: number, t: number): number;
}
export const HIP_BAND = (r: number) => (r < 0.85 ? '蹲' : r < 0.92 ? '低' : r <= 0.97 ? '常态' : '直立');

export const ABSTAIN = 1.05, HEAD_Z = 1.5, SCAN_HI = 60, SCAN_LO = 40, SCAN_S = 3, SCAN_WIN = 3.0;
const LIMBS = ['lAnkle', 'rAnkle', 'lBigToe', 'rBigToe', 'lHeel', 'rHeel', 'lKnee', 'rKnee', 'nose', 'neck'];

export function makeSkel(data: Loaded): Skel {
  const J: Joints | null = data.joints;
  if (!J) {
    const nan = () => NaN;
    return { ok: false, joint: () => null, facing: nan, torso: nan, swing: () => ({ L: NaN, R: NaN }), foot: () => ({ foot: '?', L: NaN, R: NaN, ratio: NaN }), scans: () => null, reach: () => NaN, standing: () => 0.95, hipRatio: nan, inAir: () => false, pitch: nan, front: nan };
  }
  const nJ = J.names.length, ix = (n: string) => J.names.indexOf(n);
  const NO = ix('nose'), LE = ix('lEar'), RE = ix('rEar'), LS = ix('lShoulder'), RS = ix('rShoulder'), LH = ix('lHip'), RH = ix('rHip');
  const FEET = { L: [ix('lAnkle'), ix('lBigToe')], R: [ix('rAnkle'), ix('rBigToe')] };
  const HIP = ix('midHip'), FOUR = ['lBigToe', 'rBigToe', 'lHeel', 'rHeel'].map(ix);
  // the offside law's body parts: everything but the arms and hands (as the telestration's offside wall)
  const ARMS = new Set(['rElbow', 'rWrist', 'lElbow', 'lWrist', 'lThumb', 'lPinky', 'rThumb', 'rPinky']);
  const LAW = J.names.map((nm, i) => (ARMS.has(nm) ? -1 : i)).filter((i) => i >= 0);
  const standingCache = new Map<number, number>();
  const LIMB = LIMBS.map(ix).filter((i) => i >= 0);
  const frame = (t: number) => Math.max(0, Math.min(J.frames - 1, Math.round(t * J.fps)));
  const at = (f: number, p: number, j: number): [number, number, number] => { const o = ((f * J.players + p) * nJ + j) * 3; return [J.data[o], J.data[o + 1], J.data[o + 2]]; };
  const fin = (v: [number, number, number]) => Number.isFinite(v[0]) && Number.isFinite(v[1]);
  const facingAt = (f: number, p: number) => {
    const n = at(f, p, NO), a = at(f, p, LE), b = at(f, p, RE);
    if (!fin(n) || !fin(a) || !fin(b)) return NaN;
    return Math.atan2(n[1] - (a[1] + b[1]) / 2, n[0] - (a[0] + b[0]) / 2);
  };
  const skel: Skel = {
    ok: true,
    joint: (p, name, t) => { const j = ix(name); if (j < 0) return null; const v = at(frame(t), p, j); return fin(v) ? v : null; },
    facing: (p, t) => facingAt(frame(t), p),
    // the recipe in docs/plans/telestration-body-handover.md: the horizontal normals of the
    // shoulder line and the hip line, each on the nose's side, averaged (either alone when one is missing); for
    // players over 4 m/s it matches the running direction (median cos 0.983)
    torso: (p, t) => {
      const f = frame(t), n = at(f, p, NO);
      if (!fin(n)) return NaN;
      let sx = 0, sy = 0;
      for (const [L, R] of [[LS, RS], [LH, RH]]) {
        const l = at(f, p, L), r = at(f, p, R);
        if (!fin(l) || !fin(r)) continue;
        const dx = r[0] - l[0], dy = r[1] - l[1], len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len, ny = dx / len;
        const mx = n[0] - (l[0] + r[0]) / 2, my = n[1] - (l[1] + r[1]) / 2;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        sx += nx; sy += ny;
      }
      return sx === 0 && sy === 0 ? NaN : Math.atan2(sy, sx);
    },
    swing: (p, t) => {
      const f0 = frame(t - 0.22), f1 = frame(t + 0.04), out = { L: 0, R: 0 };
      if (f1 - f0 < 2) return { L: NaN, R: NaN };
      for (const s of ['L', 'R'] as const) for (const j of FEET[s]) {
        if (j < 0) continue;
        for (let f = f0 + 1; f <= f1; f++) { const a = at(f - 1, p, j), b = at(f, p, j); if (fin(a) && fin(b)) out[s] = Math.max(out[s], Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * J.fps); }
      }
      return out;
    },
    foot: (p, t, ballZ) => {
      if (ballZ > HEAD_Z) return { foot: 'H', L: NaN, R: NaN, ratio: NaN };
      const { L, R } = skel.swing(p, t);
      if (!Number.isFinite(L) || !Number.isFinite(R)) return { foot: '?', L, R, ratio: NaN };
      const ratio = Math.max(L, R) / Math.max(Math.min(L, R), 0.1);
      return { foot: ratio < ABSTAIN ? 'either' : L > R ? 'L' : 'R', L, R, ratio };
    },
    scans: (p, t, ball) => {
      const f0 = frame(t - SCAN_WIN), f1 = frame(t);
      if (f1 - f0 < 50) return null;
      let n = 0, on = false, run = 0, last: number | null = null;
      const trace: number[] = [];
      for (let f = f0; f <= f1; f++) {
        const tt = f / J.fps, fa = facingAt(f, p), head = at(f, p, NO), b = ball(tt);
        if (!Number.isFinite(fa) || !b) { trace.push(NaN); continue; }
        const toBall = Math.atan2(b[1] - head[1], b[0] - head[0]);
        let off = Math.abs(fa - toBall); off = Math.min(off, 2 * Math.PI - off) * DEG;
        trace.push(off);
        if (!on && off > SCAN_HI) { run++; if (run >= SCAN_S) { on = true; n++; } }
        else if (on && off < SCAN_LO) { on = false; run = 0; last = t - tt; }
        else if (!on) run = 0;
      }
      if (on) last = 0;
      return { n, last, trace };
    },
    reach: (p, t, q) => {
      const f = frame(t); let d = Infinity;
      for (const j of LIMB) { const v = at(f, p, j); if (fin(v)) d = Math.min(d, Math.hypot(v[0] - q[0], v[1] - q[1], v[2] - q[2])); }
      return d;
    },
    standing: (p) => {
      let h = standingCache.get(p);
      if (h === undefined) {
        const zs: number[] = [];
        if (HIP >= 0) for (let f = 0; f < J.frames; f += 5) { const v = at(f, p, HIP); if (Number.isFinite(v[2]) && v[2] > 0.3) zs.push(v[2]); }
        zs.sort((a, b) => a - b);
        h = zs.length >= 20 ? zs[Math.floor(zs.length * 0.95)] : 0.95;
        standingCache.set(p, h);
      }
      return h;
    },
    hipRatio: (p, t) => { if (HIP < 0) return NaN; const v = at(frame(t), p, HIP); return Number.isFinite(v[2]) ? v[2] / skel.standing(p) : NaN; },
    inAir: (p, t) => { const f = frame(t); return FOUR.every((j) => j >= 0 && at(f, p, j)[2] > 0.12); },
    pitch: (p, t) => {
      const f = frame(t), n = at(f, p, NO), a = at(f, p, LE), b = at(f, p, RE);
      if (!fin(n) || !fin(a) || !fin(b)) return NaN;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = (a[2] + b[2]) / 2;
      return (Math.atan2(n[2] - mz, Math.hypot(n[0] - mx, n[1] - my)) * 180) / Math.PI;
    },
    front: (p, t) => { const f = frame(t); let x = -Infinity; for (const j of LAW) { const v = at(f, p, j); if (Number.isFinite(v[0])) x = Math.max(x, v[0]); } return Number.isFinite(x) ? x : NaN; },
  };
  return skel;
}

/** the absolute angle between two directions, degrees */
export const angDeg = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d * DEG; };
