import { animFile } from '../data/paths';
// Bodies for players we only know as positions: the what-if's simulated players (Yi, 2026-10-24: the main dish) have a
// path on the ground and nothing else, so their joints are made from Mixamo clips baked to our 29 joints
// (web/scripts/mixamo_joints.mjs; anim/). Each player faces between where he runs and where the ball is (a
// fast runner looks where he goes, a slow one at the ball), turns at a capped rate, and plays the locomotion clips that
// match his speed and his direction against his facing (walk, jog, run; forward, diagonal, sideways, backwards),
// blended, each clip in place and advanced by the ground he covers over its stride, so the feet slide little.
// Out: a Joints block like the tracking's (25 fps, attackers first), so the cartoon players draw it unchanged.
// The baked clips and the tracked skeletons have the same handedness in the pitch frame (measured 2026-10-24: 293 of
// 295 fast runners), so a pose is placed by a plain rotation, never mirrored.
import type { Joints } from '../data';
import type { MomentPkg } from '../types';

export interface AnimClip { name: string; fps: number; frames: number; names: string[]; data: number[] }

/** a locomotion clip ready to loop: the pose in place (the root's straight-line drift taken out), the direction it moves
 *  against its facing (radians, counter-clockwise in the pitch frame, 0 forward), its speed and its cycle */
interface Loop { data: Float32Array; frames: number; period: number; speed: number; stride: number; dir: number }

// eight directions at a jog (measured against the facing, counter-clockwise: diagonals +39° and -41°, strafes +74° and
// -90°, backward diagonals +102° and -143°, backwards 174°); the nine that three.js's FBX parser failed on were run
// through Blender once (2026-10-24, round trip within 4 mm), so no direction is mirrored any more
const LOOPS = {
  walk: 'standard-walk', jog: 'jog-forward', run1: 'running-1', run: 'running', back: 'jog-backward', left: 'jog-strafe-left', right: 'jog-strafe-right',
  diag: 'jog-forward-diagonal', diag2: 'jog-forward-diagonal-2', bdiag: 'jog-backward-diagonal', bdiag2: 'jog-backward-diagonal-2',
} as const;
export const MOTION_CLIPS = [...Object.values(LOOPS), 'offensive-idle', 'goalkeeper-idle'];

/** the clips by name through a reader of one's own (the node checks, scripts/gait_check.ts) */
export const loadClipsFrom = (read: (name: string) => AnimClip, names: string[] = MOTION_CLIPS): Record<string, AnimClip> => Object.fromEntries(names.map((n) => [n, read(n)]));
/** the clips by name, fetched once */
export async function loadClips(names: string[] = MOTION_CLIPS): Promise<Record<string, AnimClip>> {
  const xs = await Promise.all(names.map((n) => fetch(animFile(n)).then((r) => r.json() as Promise<AnimClip>)));
  return Object.fromEntries(names.map((n, i) => [n, xs[i]]));
}

const MIRROR: Record<string, string> = { rShoulder: 'lShoulder', rElbow: 'lElbow', rWrist: 'lWrist', rHip: 'lHip', rKnee: 'lKnee', rAnkle: 'lAnkle', rEye: 'lEye', rEar: 'lEar', rBigToe: 'lBigToe', rSmallToe: 'lSmallToe', rHeel: 'lHeel', rThumb: 'lThumb', rPinky: 'lPinky' };

function loop(c: AnimClip, mirror = false): Loop {
  const nJ = c.names.length, F = c.frames - 1, hip = c.names.indexOf('midHip');   // the last frame repeats the first
  const at = (f: number, j: number, k: number) => c.data[(f * nJ + j) * 3 + k];
  const dx = at(F, hip, 0) - at(0, hip, 0), dy = at(F, hip, 1) - at(0, hip, 1), period = F / c.fps;
  const swap = c.names.map((n) => { const m = MIRROR[n] ?? Object.keys(MIRROR).find((k) => MIRROR[k] === n); return m ? c.names.indexOf(m) : c.names.indexOf(n); });
  const data = new Float32Array(F * nJ * 3);
  for (let f = 0; f < F; f++) for (let j = 0; j < nJ; j++) {
    const s = mirror ? swap[j] : j, u = f / F;
    let x = at(f, s, 0) - at(0, hip, 0) - dx * u;
    const y = at(f, s, 1) - at(0, hip, 1) - dy * u;
    if (mirror) x = -x;
    data.set([x, y, at(f, s, 2)], (f * nJ + j) * 3);
  }
  const mx = mirror ? -dx : dx, d = Math.hypot(mx, dy);
  // the clips face +y; a move's direction against that facing, counter-clockwise positive
  return { data, frames: F, period, speed: d / period, stride: d, dir: Math.atan2(-mx, dy) };
}

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** each loop's weight for a speed and a direction against the facing: forward runs blend walk, jog and run by speed;
 *  the other directions blend the two nearest jogging clips by angle */
function weights(L: Record<string, Loop>, s: number, rel: number): [Loop, number][] {
  const fwdTiers: [Loop, number][] = (() => {
    const tiers = [L.walk, L.jog, L.run1, L.run];
    if (s <= tiers[0].speed) return [[tiers[0], 1]];
    for (let i = 0; i < tiers.length - 1; i++) if (s <= tiers[i + 1].speed) {
      const u = (s - tiers[i].speed) / (tiers[i + 1].speed - tiers[i].speed);
      return [[tiers[i], 1 - u], [tiers[i + 1], u]];
    }
    return [[tiers[tiers.length - 1], 1]];
  })();
  // direction anchors round the circle: forward (a speed blend), the diagonals, the strafes, backwards
  const one = (l: Loop): [Loop, number][] => [[l, 1]];
  const anchors: { dir: number; w: [Loop, number][] }[] = [
    { dir: 0, w: fwdTiers }, { dir: L.diag.dir, w: one(L.diag) }, { dir: L.diag2.dir, w: one(L.diag2) },
    { dir: L.left.dir, w: one(L.left) }, { dir: L.right.dir, w: one(L.right) }, { dir: L.bdiag.dir, w: one(L.bdiag) },
    { dir: L.bdiag2.dir, w: one(L.bdiag2) }, { dir: L.back.dir, w: one(L.back) },
  ];
  anchors.sort((a, b) => a.dir - b.dir);
  let lo = anchors[anchors.length - 1], hi = anchors[0], span = 2 * Math.PI + hi.dir - lo.dir, from = wrapA(rel - lo.dir);
  for (let i = 0; i < anchors.length - 1; i++) if (rel >= anchors[i].dir && rel <= anchors[i + 1].dir) { lo = anchors[i]; hi = anchors[i + 1]; span = hi.dir - lo.dir; from = rel - lo.dir; break; }
  if (from < 0) from += 2 * Math.PI;
  const u = span > 1e-6 ? Math.min(1, Math.max(0, from / span)) : 0;
  return [...lo.w.map(([l, w]): [Loop, number] => [l, w * (1 - u)]), ...hi.w.map(([l, w]): [Loop, number] => [l, w * u])].filter(([, w]) => w > 1e-3);
}

/** the facing rule's two numbers: the ball's pull against the run's (m²/s², the run weighs its speed squared; keepers
 *  apart) and how much of the turn is made each frame */
export interface FacingOpts { ball: number; keeperBall: number; ease: number }
export const FACING: FacingOpts = { ball: 2.2, keeperBall: 12, ease: 0.35 };

export interface Track {
  /** ground position (m) of the hips' centre at each output frame */
  pos: [number, number][];
  /** keeper: faces the ball more, uses the keeper's stance when still */
  keeper: boolean;
}

/** joints for every track at fps, facing between the run and the ball (ball: [x, y] at each output frame, or null) */
export function synthesize(clips: Record<string, AnimClip>, tracks: Track[], ball: ([number, number] | null)[], fps: number, nAtt: number, names: string[], opts: FacingOpts = FACING): Joints {
  const L: Record<string, Loop> = {
    walk: loop(clips[LOOPS.walk]), jog: loop(clips[LOOPS.jog]), run1: loop(clips[LOOPS.run1]), run: loop(clips[LOOPS.run]),
    back: loop(clips[LOOPS.back]), left: loop(clips[LOOPS.left]), right: loop(clips[LOOPS.right]), diag: loop(clips[LOOPS.diag]), diag2: loop(clips[LOOPS.diag2]),
    bdiag: loop(clips[LOOPS.bdiag]), bdiag2: loop(clips[LOOPS.bdiag2]),
  };
  const idle = clips['offensive-idle'], gkIdle = clips['goalkeeper-idle'], nJ = names.length;
  const F = tracks[0]?.pos.length ?? 0, P = tracks.length, dt = 1 / fps, out = new Float32Array(F * P * nJ * 3);
  const sample = (lp: Loop, u: number, j: number, k: number) => {
    const x = (((u % 1) + 1) % 1) * lp.frames, f0 = Math.floor(x) % lp.frames, f1 = (f0 + 1) % lp.frames, a = x - Math.floor(x);
    return lp.data[(f0 * nJ + j) * 3 + k] * (1 - a) + lp.data[(f1 * nJ + j) * 3 + k] * a;
  };
  const still = (c: AnimClip, t: number, j: number, k: number) => {
    const f = Math.floor(t * c.fps) % (c.frames - 1), hip = c.names.indexOf('midHip');
    return c.data[(f * nJ + j) * 3 + k] - (k < 2 ? c.data[(0 * nJ + hip) * 3 + k] : 0);
  };
  tracks.forEach((tr, p) => {
    // velocity: a centred difference over 0.4 s
    const h = Math.max(1, Math.round(0.2 * fps));
    const vel = tr.pos.map((_, f) => {
      const a = tr.pos[Math.max(0, f - h)], b = tr.pos[Math.min(F - 1, f + h)], span = (Math.min(F - 1, f + h) - Math.max(0, f - h)) * dt;
      return span > 0 ? [(b[0] - a[0]) / span, (b[1] - a[1]) / span] : [0, 0];
    });
    let face = NaN, u = (p * 0.137) % 1;            // each player starts his cycle somewhere else
    for (let f = 0; f < F; f++) {
      const [vx, vy] = vel[f], s = Math.hypot(vx, vy), b = ball[f];
      // the facing he wants: the run's direction weighted by speed squared, the ball's by a constant (keepers watch it more)
      const wb = tr.keeper ? opts.keeperBall : opts.ball;
      let fx = vx * s, fy = vy * s;
      if (b) { const bx = b[0] - tr.pos[f][0], by = b[1] - tr.pos[f][1], d = Math.hypot(bx, by) || 1; fx += (wb * bx) / d; fy += (wb * by) / d; }
      const want = Math.atan2(fy, fx);
      if (Number.isNaN(face)) face = want;
      else { const turn = wrapA(want - face), cap = (8 * Math.PI / 3) * dt; face += Math.max(-cap, Math.min(cap, turn * opts.ease)); }
      const rel = wrapA(Math.atan2(vy, vx) - face);
      const W = weights(L, s, rel), still01 = Math.min(1, Math.max(0, (s - 0.35) / 0.6));
      const stride = W.reduce((a, [lp, w]) => a + w * lp.stride, 0) || 1;
      u += (s * dt) / stride;
      const c = Math.cos(face), sn = Math.sin(face), [px, py] = tr.pos[f];
      for (let j = 0; j < nJ; j++) {
        // the clip's frame faces +y: its +y goes to the facing, its +x a quarter turn clockwise of it
        let cx = 0, cy = 0, cz = 0;
        for (const [lp, w] of W) { cx += w * sample(lp, u, j, 0); cy += w * sample(lp, u, j, 1); cz += w * sample(lp, u, j, 2); }
        if (still01 < 1) {
          const st = tr.keeper ? gkIdle : idle, t = f * dt + p * 0.61;
          cx = cx * still01 + still(st, t, j, 0) * (1 - still01); cy = cy * still01 + still(st, t, j, 1) * (1 - still01); cz = cz * still01 + still(st, t, j, 2) * (1 - still01);
        }
        const o = ((f * P + p) * nJ + j) * 3;
        out[o] = px + cx * sn + cy * c; out[o + 1] = py - cx * c + cy * sn; out[o + 2] = cz;
      }
    }
  });
  return { fps, frames: F, players: P, nAtt, names, data: out, flip: [1, 1] };
}

/** a clip's players from its 10 Hz positions only (the check against the tracked bodies, ?synth=1): each player's path
 *  resampled to the joints' 25 fps, the ball likewise, keepers from the package */
export function synthFromPositions(clips: Record<string, AnimClip>, pkg: MomentPkg & { keepers?: number[] }, frames: number, fps: number, names: string[], opts: FacingOpts = FACING): Joints {
  const { tracks, ball, nAtt } = positionTracks(pkg, frames, fps);
  return synthesize(clips, tracks, ball, fps, nAtt, names, opts);
}
/** a clip's 10 Hz positions as tracks at fps (the players' paths, the ball, keepers from the package) */
export function positionTracks(pkg: MomentPkg & { keepers?: number[] }, frames: number, fps: number): { tracks: Track[]; ball: ([number, number] | null)[]; nAtt: number } {
  const src = pkg.frames, sfps = pkg.meta.fps, P = src[0].att.length + src[0].def.length, nAtt = src[0].att.length;
  const at = <T,>(k: number, get: (fr: (typeof src)[number]) => T) => get(src[Math.min(src.length - 1, Math.max(0, k))]);
  const lerp2 = (a: [number, number], b: [number, number], u: number): [number, number] => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const tracks: Track[] = Array.from({ length: P }, (_, p) => ({ keeper: (pkg.keepers ?? []).includes(p), pos: [] as [number, number][] }));
  const ball: ([number, number] | null)[] = [];
  for (let f = 0; f < frames; f++) {
    const x = (f / fps) * sfps, k = Math.floor(x), u = x - k;
    for (let p = 0; p < P; p++) {
      const get = (fr: (typeof src)[number]) => (p < nAtt ? fr.att[p] : fr.def[p - nAtt]);
      tracks[p].pos.push(lerp2(at(k, get), at(k + 1, get), u));
    }
    const b0 = at(k, (fr) => fr.ball), b1 = at(k + 1, (fr) => fr.ball);
    ball.push(b0 && b1 ? lerp2([b0[0], b0[1]], [b1[0], b1[1]], u) : b0 ? [b0[0], b0[1]] : null);
  }
  return { tracks, ball, nAtt };
}
