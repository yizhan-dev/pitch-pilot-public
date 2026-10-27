import { modelFile } from '../data/paths';
import { xgFreeze, type XgFreezeModel, type XgPoint } from '../response/xg';

// What a pause is in front of, and the numbers the pause window's tools start from. Package coordinates: metres, the
// attacking side attacks +x, goal centre (52.5, 0); players by index, attackers first (11 + 11).

export interface ClipEvent { t: number; type: string; player?: number; receiver?: number; outcome?: string }
export interface PausePkg {
  meta: { fps: number; shot?: { t: number; shooter: number } };
  frames: { att: [number, number][]; def: [number, number][]; ball: number[] }[];
  events?: ClipEvent[];
  keepers?: number[];
}

const SHOTS = new Set(['SavedShot', 'MissedShots', 'Goal', 'ShotOnPost']);
/** how far ahead a pause looks for its moment (the design: 1.5 s) */
export const AHEAD = 1.5;

export type MomentKind = 'shot' | 'pass' | 'free';
export interface Moment { kind: MomentKind; /** seconds until it */ dt: number; /** who does it */ actor: number | null; event: ClipEvent | null }

/** the moment a pause at t is in front of: a shot in the next 1.5 s, else a pass, else a free pause */
export function momentAt(pkg: PausePkg, t: number): Moment {
  const ahead = (pkg.events ?? []).filter((e) => e.t >= t - 0.05 && e.t <= t + AHEAD);
  const shot = ahead.find((e) => SHOTS.has(e.type)), pass = ahead.find((e) => e.type === 'Pass');
  const e = shot ?? pass ?? null;
  return { kind: shot ? 'shot' : pass ? 'pass' : 'free', dt: e ? Math.max(0, e.t - t) : 0, actor: e?.player ?? null, event: e };
}

/** every player's position at clip time t (the package's 10 fps, nearest frame) */
export function positionsAt(pkg: PausePkg, t: number): [number, number][] {
  const f = pkg.frames[Math.max(0, Math.min(pkg.frames.length - 1, Math.round(t * pkg.meta.fps)))];
  return [...f.att, ...f.def];
}

/** each attacker's chance to score if he shot from where he stands at t, with the defenders and their keeper where
 *  they are (the defender-aware model, src/response/xg.ts); null for the defenders and the attacking keeper */
export function mateXg(model: XgFreezeModel, pkg: PausePkg, t: number): (number | null)[] {
  const pos = positionsAt(pkg, t), nAtt = pkg.frames[0].att.length, keepers = pkg.keepers ?? [];
  const defKeeper = keepers.find((k) => k >= nAtt) ?? -1;
  const opp: XgPoint[] = [], keeper: XgPoint | null = defKeeper >= 0 ? pos[defKeeper] : null;
  for (let i = nAtt; i < pos.length; i++) if (i !== defKeeper) opp.push(pos[i]);
  return pos.map((p, i) => (i < nAtt && !keepers.includes(i) ? xgFreeze(model, p, false, opp, keeper) : null));
}

let modelP: Promise<XgFreezeModel | null> | null = null;
/** the xG model, fetched once (models/response/xg_freeze.json) */
export const loadXg = () => (modelP ??= fetch(modelFile('xg_freeze.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null));
