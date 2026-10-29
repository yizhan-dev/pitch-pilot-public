import { parseClip, inMatch, clipFile } from './data/paths';
import { hook } from './dev';
import type { MomentPkg } from './types';
import { cleanJoints, type CleanStats } from './data/clean';

export interface Joints { fps: number; frames: number; players: number; nAtt: number; names: string[]; data: Float32Array; flip: [number, number]; }
/** the referee and the two assistant referees (clip packages from private/hawkeye/export_clips.py):
 *  positions at the package's 10 fps, [frame][official] = [x, y], and their joints like the players' */
export interface Officials { roles: string[]; pos: [number, number][][]; joints: Joints | null; }
export interface Loaded { pkg: MomentPkg; joints: Joints | null; officials?: Officials | null; }

/** a clip package by its address (`pel-wil/<id>`, or an old form paths.parseClip reads), with its joints and the
 *  officials' joints, whose paths inside the package are relative to the match folder */
/** gate: the CPU's share of the load (the package's parse, the joints' alignment and cleaning, a few hundred ms on a slow
 *  machine) waits for it, the downloads not (GameApp's clip change: until the board is down, so the hexagons turn over
 *  smoothly; during the fan-out the work made it lag) */
/** the joints cleaned (data/clean.ts), off the page in a worker where there is one,
 *  on it otherwise or should the worker fail; the result the same either way */
let cleaner: Worker | null | undefined;
let cleanId = 0;
const cleanWait = new Map<number, (r: { buf: ArrayBuffer; stats: CleanStats | null } | null) => void>();
function cleanerOf(): Worker | null {
  if (cleaner !== undefined) return cleaner;
  try {
    cleaner = new Worker(new URL('./data/cleanWorker.ts', import.meta.url), { type: 'module' });
    cleaner.onmessage = (e: MessageEvent<{ id: number; buf: ArrayBuffer; stats: CleanStats | null }>) => { cleanWait.get(e.data.id)?.(e.data); cleanWait.delete(e.data.id); };
    cleaner.onerror = () => { cleanWait.forEach((r) => r(null)); cleanWait.clear(); cleaner = null; };
  } catch { cleaner = null; }
  return cleaner;
}
async function cleanOff(J: Joints) {
  const w = cleanerOf();
  let stats: CleanStats | null;
  if (w) {
    // (the array goes over and comes back: a copy is kept to clean here should the worker not answer)
    const id = ++cleanId, keep = J.data.slice();
    const r = await new Promise<{ buf: ArrayBuffer; stats: CleanStats | null } | null>((res) => { cleanWait.set(id, res); w.postMessage({ id, names: J.names, frames: J.frames, players: J.players, buf: J.data.buffer }, [J.data.buffer]); });
    if (r) { J.data = new Float32Array(r.buf); stats = r.stats; } else { J.data = keep; stats = cleanJoints(J); }
  } else stats = cleanJoints(J);
  hook('clean', stats);
  // (for the checks: a sum over the cleaned array, the same from the worker as from the page)
  let sum = 0; for (let i = 0; i < J.data.length; i += 7) sum += J.data[i] * ((i % 97) + 1);
  hook('cleanSum', sum);
}

export async function loadMoment(file: string, gate?: Promise<unknown>): Promise<Loaded> {
  const match = parseClip(file).match, storedFile = (rel: string) => inMatch(rel, match);
  const text = await (await fetch(clipFile(file))).text();
  // (with a gate, the joints' download starts before it, from their file's name found in the text: the larger file,
  // so the board's turn and the download overlap as before; the parsed package's own name is the one used after)
  const hint = gate ? text.match(/"joints"\s*:\s*\{\s*"file"\s*:\s*"([^"]+)"/)?.[1] : undefined;
  const early = hint ? fetch(storedFile(hint)).then((r) => r.arrayBuffer()).catch(() => null) : null;
  if (gate) await gate;
  const pkg = JSON.parse(text) as MomentPkg & { joints?: { file: string; fps: number; frames: number; players: number; n_att: number; names: string[] };
    officials?: { roles: string[]; pos: [number, number][][]; joints: { file: string; fps: number; frames: number; players: number; names: string[] } | null } };
  let joints: Joints | null = null;
  const clean = new URLSearchParams(location.search).get('clean') !== '0';
  if (pkg.joints) {
    const buf = (hint === pkg.joints.file ? await early : null) ?? await (await fetch(storedFile(pkg.joints.file))).arrayBuffer();
    joints = { fps: pkg.joints.fps, frames: pkg.joints.frames, players: pkg.joints.players, nAtt: pkg.joints.n_att, names: pkg.joints.names, data: new Float32Array(buf), flip: [1, 1] };
    alignJoints(pkg, joints);
    if (clean) await cleanOff(joints);
  }
  let officials: Officials | null = null;
  if (pkg.officials) {
    let oj: Joints | null = null;
    if (pkg.officials.joints) {
      const o = pkg.officials.joints, buf = await (await fetch(storedFile(o.file))).arrayBuffer();
      // written by the same exporter as the players' joints, so mirrored the same way: take the players' signs
      oj = { fps: o.fps, frames: o.frames, players: o.players, nAtt: o.players, names: o.names, data: new Float32Array(buf), flip: joints?.flip ?? [1, 1] };
      if (oj.flip[0] !== 1 || oj.flip[1] !== 1) for (let k = 0; k < oj.data.length; k += 3) { oj.data[k] *= oj.flip[0]; oj.data[k + 1] *= oj.flip[1]; }
      if (clean) await cleanOff(oj);
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
 *  second x (checked on all 30 moments). Mirrored, the bodies were also drawn inside out, right shoulder on
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


