import { modelFile, matchFile } from '../../data/paths';
// Two networks at a pause, both from where the players are now (not average positions).
//  * chemistry (the passing network proper, the default): how many passes the focus player and each teammate have exchanged
//    since kick-off, both ways, from the match's passes with their inferred receivers (private/hawkeye/
//    export_passes.py -> <match>/passes.json; pitch_pilot's next-on-ball-event rule; 98.8% of the successful
//    passes find a teammate, and all 192 the clips can check agree with Opta's own receiver)
//  * options (kept for the pause window's pass choices): for the carrier and each teammate, the chance a pass reaches
//    that teammate first, from the
// first-touch model the response viewer uses (src/response/outcomes.ts firstTouch, private/response/resolver.py:
// fitted on the Serie A match, 81% first toucher right and AUC 0.85 cut out vs received on the CSL match). The pass is
// the viewer's: 14 m/s off the foot, slowing at 2.5 m/s², played ahead of the receiver's run; beyond 22 m it is lofted
// (the model sees only 2 s, which a ground pass covers to about 23 m, so a longer one would read as nobody reaching it;
// lofted, it lands within the 2 s, and the model already lets nobody reach a ball above 2 m). Players' next 2 s are
// their present velocity carried on (capped at 8 m/s): the response model would move the defenders better, at a
// model's cost, and is the next step if this reads well.
import { firstTouch, type ResolverParams, type V3 } from '../../response/outcomes';
import type { XY } from './anchors';

/** an edge: players a and b (package indices); p 0..1 (a chance, or a count over the largest); n the count, when counted */
export interface NetEdge { a: number; b: number; p: number; n?: number }
export interface Network { carrier: number; star: NetEdge[]; support: NetEdge[] }

let prmPromise: Promise<ResolverParams | null> | null = null;
/** the first-touch model's parameters, fetched once (null when the file is missing: no network) */
export function loadResolver(): Promise<ResolverParams | null> {
  prmPromise ??= fetch(modelFile('resolver.json')).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return prmPromise;
}

const DT = 0.1, FUT = 20, V0 = 14, DEC = 2.5, VMAX = 8, LOFT_FROM = 22, G = 9.81;

/** the chance a ground pass from player i reaches player j first. pos, vel: every player (attackers 0..10 first) */
export function passChance(prm: ResolverParams, pos: XY[], vel: XY[], gk: boolean[], i: number, j: number): number {
  const b0 = pos[i], p = pos[j], v = vel[j];
  // played ahead of the receiver: where he will be when the ball arrives, solved in three passes
  let Ta = Math.hypot(p[0] - b0[0], p[1] - b0[1]) / 12, tgt: XY = p, dist = 0;
  for (let k = 0; k < 3; k++) {
    tgt = [p[0] + v[0] * Math.min(Ta, 1.5), p[1] + v[1] * Math.min(Ta, 1.5)];
    dist = Math.hypot(tgt[0] - b0[0], tgt[1] - b0[1]);
    Ta = (V0 - Math.sqrt(Math.max(V0 * V0 - 2 * DEC * dist, 1e-6))) / DEC;
  }
  let u: XY = [(tgt[0] - b0[0]) / Math.max(dist, 1e-6), (tgt[1] - b0[1]) / Math.max(dist, 1e-6)];
  const ball: V3[] = [[b0[0], b0[1], 0.11]];
  if (Math.hypot(p[0] - b0[0], p[1] - b0[1]) > LOFT_FROM) {
    // lofted: a flight of T s, as long as the distance asks (1.2 to 1.9 s), its height from the flight time, then a roll
    let T = 1.5;
    for (let k = 0; k < 3; k++) {
      tgt = [p[0] + v[0] * Math.min(T, 1.5), p[1] + v[1] * Math.min(T, 1.5)];
      dist = Math.hypot(tgt[0] - b0[0], tgt[1] - b0[1]); T = Math.min(1.9, Math.max(1.2, dist / 18));
    }
    u = [(tgt[0] - b0[0]) / Math.max(dist, 1e-6), (tgt[1] - b0[1]) / Math.max(dist, 1e-6)];
    const vh = dist / T, H = (G * T * T) / 8;
    for (let n = 1; n <= FUT; n++) {
      const t = n * DT, s = t <= T ? vh * t : dist + 6 * (t - T), z = t <= T ? 0.11 + 4 * H * (t / T) * (1 - t / T) : 0.11;
      ball.push([b0[0] + u[0] * s, b0[1] + u[1] * s, z]);
    }
  } else for (let n = 1; n <= FUT; n++) { const t = n * DT, s = Math.min(Math.max(0, V0 * t - 0.5 * DEC * t * t), dist); ball.push([b0[0] + u[0] * s, b0[1] + u[1] * s, 0.11]); }
  const paths = pos.map((q, m) => {
    const sp = Math.hypot(vel[m][0], vel[m][1]), k = sp > VMAX ? VMAX / sp : 1;
    return Array.from({ length: FUT }, (_, n) => [q[0] + vel[m][0] * k * (n + 1) * DT, q[1] + vel[m][1] * k * (n + 1) * DT] as XY);
  });
  return firstTouch(prm, ball, paths, gk, i).p[j];
}

/** the network of the attacking side (players 0..nAtt-1): the carrier's options, and each other attacker's links to
 *  his two nearest teammates within 25 m (the support), with the better direction's chance */
export function passNetwork(prm: ResolverParams, pos: XY[], vel: XY[], gk: boolean[], carrier: number, nAtt: number, withSupport = true): Network {
  const star: NetEdge[] = [];
  for (let j = 0; j < nAtt; j++) if (j !== carrier) star.push({ a: carrier, b: j, p: passChance(prm, pos, vel, gk, carrier, j) });
  const seen = new Set<string>(), support: NetEdge[] = [];
  for (let i = 0; i < (withSupport ? nAtt : 0); i++) {
    if (i === carrier || gk[i]) continue;
    const near = [...Array(nAtt).keys()].filter((j) => j !== i && j !== carrier && !gk[j])
      .map((j) => ({ j, d: Math.hypot(pos[j][0] - pos[i][0], pos[j][1] - pos[i][1]) })).filter((q) => q.d < 25).sort((x, y) => x.d - y.d).slice(0, 2);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      support.push({ a: i, b: j, p: Math.max(passChance(prm, pos, vel, gk, i, j), passChance(prm, pos, vel, gk, j, i)) });
    }
  }
  star.sort((x, y) => y.p - x.p);
  return { carrier, star, support };
}

export interface MatchPass { half: number; clock: number; home: boolean; from: string; ok: boolean; to: string | null; toHome: boolean | null }
const passCache = new Map<string, Promise<MatchPass[] | null>>();
/** the match's passes with their receivers (<match>/passes.json), fetched once per match; null when missing */
export function loadPasses(match: string): Promise<MatchPass[] | null> {
  let p = passCache.get(match);
  if (!p) { p = fetch(matchFile('passes.json', match)).then((r) => (r.ok ? r.json() : null)).then((j) => j?.passes ?? null).catch(() => null); passCache.set(match, p); }
  return p;
}

/** chemistry: the focus player's teammates by passes exchanged with him (both ways, successful, before match clock
 *  `clock`), most first. pids: each package player's id; returns edges whose p is the count over the largest count */
export function chemistry(passes: MatchPass[], pids: string[], focus: number, sideOf: (p: number) => 'att' | 'def', clock: number): Network {
  const me = pids[focus], count = new Map<string, number>();
  for (const q of passes) {
    if (q.clock >= clock || !q.ok || !q.to || q.toHome !== q.home) continue;
    const other = q.from === me ? q.to : q.to === me ? q.from : null;
    if (other) count.set(other, (count.get(other) ?? 0) + 1);
  }
  const star: NetEdge[] = [];
  pids.forEach((pid, j) => { if (j !== focus && sideOf(j) === sideOf(focus) && count.get(pid)) star.push({ a: focus, b: j, p: count.get(pid)!, }); });
  star.sort((x, y) => y.p - x.p);
  const max = star.length ? star[0].p : 1;
  return { carrier: focus, star: star.map((e) => ({ ...e, n: e.p, p: e.p / max })), support: [] };
}
