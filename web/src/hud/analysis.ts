// The 战术 mode's numbers for the HUD preview's draft (Yi, 2026-10-23; docs/plans/hud-notes.md): the base maps (pitch
// control, space value, space quality, after Fernández and Bornn, ./fb.ts) and the annotations' data from the clip's
// events and 10 Hz positions: the ΔxT of each pass and carry, shots with their xG, standard and potential xA, the
// passing options, the better-placed team-mates, and line-breaking passes. Pitch metres, the clip's attackers attacking
// +x. What is real and what is a stand-in is said at each function; the stand-ins show 示例 on screen. Later these come
// precalculated with the clip, and the 3D side draws them on the pitch.
import type { ClipEvent, ClipPkg } from './match';
import { nAttOf, playersOf } from './playerStats';
import { control, value, type Moment, type XY } from './fb';
import type { BaseKey } from './draft';

export type { XY };

/** the window over which velocities are measured, seconds */
const VELOCITY_WINDOW_SECONDS = 0.2;
/** where a move ends when no event follows it: this long after it, seconds */
const LAST_MOVE_SECONDS = 1;

/** the base maps' grid: the pitch exactly, 35 x 23 cells (3 x 2.96 m); row 0 is the far touchline (y = -34) */
export const GRID = { nx: 35, nz: 23, w: 105, h: 68 };
const CELLS: XY[] = (() => {
  const out: XY[] = [], cw = GRID.w / GRID.nx, ch = GRID.h / GRID.nz;
  for (let r = 0; r < GRID.nz; r++) for (let c = 0; c < GRID.nx; c++) out.push([-GRID.w / 2 + (c + 0.5) * cw, -GRID.h / 2 + (r + 0.5) * ch]);
  return out;
})();

// Public-source preview: hand-authored illustrative values, not trained xT.
import { sampleThreatGrid as XT } from '../sample/threat';
/** xT at a point for a side: the attackers attack +x, the defenders -x (so their point is mirrored) */
export function xtAt([x, y]: XY, attackers = true): number {
  const px = attackers ? x : -x, py = attackers ? y : -y;
  const c = Math.min(15, Math.max(0, Math.floor(((px + 52.5) / 105) * 16))), r = Math.min(11, Math.max(0, Math.floor(((py + 34) / 68) * 12)));
  return XT[r][c];
}
/** the grid as the Tactics base map draws it (hud/BaseMap3D.tsx, Yi 2026-10-27): XT_NX x XT_NY cells, row j the band across
 *  (y), column i the band along (x), for the side attacking +x (the clip's attackers) or, mirrored through the centre spot,
 *  the other side */
export const XT_NX = 16, XT_NY = 12;
export const XT_RANGE = { min: Math.min(...XT.flat()), max: Math.max(...XT.flat()) };
export function xtGrid(attackers: boolean): Float32Array {
  const out = new Float32Array(XT_NX * XT_NY);
  for (let j = 0; j < XT_NY; j++) for (let i = 0; i < XT_NX; i++) out[j * XT_NX + i] = attackers ? XT[j][i] : XT[XT_NY - 1 - j][XT_NX - 1 - i];
  return out;
}

// ---- the clip at a moment
/** every player's position and the ball at clip time t, interpolated between the 10 Hz frames; the ball is null where
 *  neither neighbouring frame tracked it (never a made-up position: review F08) */
function sampleAt(pkg: ClipPkg, t: number): { pos: XY[]; ball: XY | null } {
  const frameCount = pkg.frames.length, exact = Math.min(frameCount - 1, Math.max(0, t * pkg.meta.fps));
  const k = Math.floor(exact), next = Math.min(frameCount - 1, k + 1), frac = exact - k;
  const a = pkg.frames[k], b = pkg.frames[next], nAtt = nAttOf(pkg), players = playersOf(pkg), pos: XY[] = [];
  const lerp = (p: readonly number[], q: readonly number[]): XY => [p[0] + (q[0] - p[0]) * frac, p[1] + (q[1] - p[1]) * frac];
  for (let player = 0; player < players; player++) {
    const pa = player < nAtt ? a.att[player] : a.def[player - nAtt], pb = (player < nAtt ? b.att[player] : b.def[player - nAtt]) ?? pa;
    pos.push(pa ? lerp(pa, pb) : [0, 0]);
  }
  const ballA = a.ball ?? b.ball, ballB = b.ball ?? a.ball;
  return { pos, ball: ballA && ballB ? lerp(ballA, ballB) : null };
}

export function momentAt(pkg: ClipPkg, t: number): Moment {
  const now = sampleAt(pkg, t), before = sampleAt(pkg, t - VELOCITY_WINDOW_SECONDS);
  const vel = now.pos.map((p, i) => [(p[0] - before.pos[i][0]) / VELOCITY_WINDOW_SECONDS, (p[1] - before.pos[i][1]) / VELOCITY_WINDOW_SECONDS] as XY);
  return { pos: now.pos, vel, ball: now.ball ?? [0, 0], hasBall: now.ball !== null, nAtt: nAttOf(pkg) };
}

// ---- base maps
/** a base map at time t, per cell 0..1: pitch control as the attackers' share (two-sided, blue above 0.5, orange below);
 *  space value and space quality one-sided. The real model for pitch control; V (and so Q) the stand-in of ./fb.ts. Null
 *  when the ball was not tracked (the influence depends on it) */
export function baseMap(pkg: ClipPkg, key: BaseKey, t: number): Float32Array | null {
  const m = momentAt(pkg, t);
  if (!m.hasBall) return null;
  const att = m.pos.slice(0, m.nAtt), attV = m.vel.slice(0, m.nAtt), def = m.pos.slice(m.nAtt), defV = m.vel.slice(m.nAtt);
  if (key === 'pc') return control(att, attV, def, defV, m.ball, CELLS);
  const v = value(def, defV, m.ball, CELLS);
  const pc = control(att, attV, def, defV, m.ball, CELLS);
  return pc.map((p, i) => p * v[i]);
}

// ---- events
const MOVES = new Set(['Pass', 'Carry']);
const ballAt = (pkg: ClipPkg, t: number): XY | null => sampleAt(pkg, t).ball;
/** the player's position at a time, else the ball's; null when neither is known */
const playerAt = (pkg: ClipPkg, player: number | null | undefined, t: number): XY | null => {
  const sample = sampleAt(pkg, t);
  return (player != null ? sample.pos[player] : undefined) ?? sample.ball;
};

export interface Move { e: ClipEvent; from: XY; to: XY; dxt: number; carry: boolean }
/** every pass and carry with where it went and its ΔxT for its own side: xT at the end minus at the start, or minus the
 *  start's xT when it failed (the ball was lost). The end is where the ball is at the next event (the receiver's feet for a
 *  pass that found him). The real xT grid and positions */
export function moves(pkg: ClipPkg): Move[] {
  const ev = pkg.events ?? [], out: Move[] = [];
  ev.forEach((e, i) => {
    if (!MOVES.has(e.type)) return;
    const next = ev[i + 1], tEnd = next ? next.t : e.t + LAST_MOVE_SECONDS;
    const from = playerAt(pkg, e.player, e.t), to = e.type === 'Pass' && e.receiver != null ? playerAt(pkg, e.receiver, tEnd) : ballAt(pkg, tEnd);
    if (!from || !to) return;   // an end that was not tracked: no arrow rather than one to a made-up point
    const ok = e.outcome !== 'Unsuccessful';
    const dxt = ok ? xtAt(to, e.shooting) - xtAt(from, e.shooting) : -xtAt(from, e.shooting);
    out.push({ e, from, to, dxt, carry: e.type === 'Carry' });
  });
  return out;
}
/** the threat annotation: the last n moves up to t (the chain), or only the latest */
export const threatAt = (all: Move[], t: number, n: number) => all.filter((m) => m.e.t <= t).slice(-n);

/** the second-last defender's x (the keeper counted): the offside line for the attackers, attacking +x */
export function offsideX(m: Moment): number {
  const xs = m.pos.slice(m.nAtt).map((p) => p[0]).sort((a, b) => b - a);
  return Math.max(xs[1] ?? 0, 0);
}
