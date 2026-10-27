// The orchestrator's detection rules (docs/plans/orchestrator-notes.md, "Detection"): deterministic and explainable,
// from the clip package alone. Every rule writes what it measured into `why`, so the debug view can say why a beat
// was chosen. Rules, in order:
//  1. actions: the possession as on-ball actions, from the ball's 25 Hz touches (src/explain/actions.ts) joined to the
//     feed's events (Opta: line-breaking, xpass, xG, tags), the touches' times winning (the feed is off by up to 0.3 s);
//  2. the attack: from the attacking side's first action after the defenders last had the ball, to its end;
//  3. phases: build-up until the decisive progression (the line-breaking pass with the most lines, else the first
//     pass or carry gaining 10 m into the final third), progression, final third, finish, after;
//  4. candidates: line-breaking passes, the runs that made the key passes (the receiver's own, or a decoy who took his
//     marker away), the final pass (a one-two when it is), the shot frozen on the boot's contact, the better-placed
//     teammate, the outcome.
import type { Loaded } from '../data';
import { detectTouches, type Touch } from '../explain/actions';
import { contactTime } from '../three/telestration/contact';
import { xgFreeze, type XgFreezeModel, type XgPoint } from '../response/xg';
import type { ResolverParams } from '../response/outcomes';
import { passChance } from '../three/telestration/network';
import { makeGeo, unitsAt, lineX, offsideX, goalSide, spaceAt, nearestOpp, dist, kmh, GOAL_X, THIRD, type Geo, type XY } from './geom';
import type { Action, Phase, Story, Fact } from './types';

export const RULES = 'r1-2026-10-22';

interface FeedEvent { t: number; type: string; outcome?: string; player?: number; receiver?: number; dist?: number; xpass?: number; xg?: number; tags?: string[]; lb?: { lines: number; last: string | null }; key?: boolean }
const SHOTS = new Set(['SavedShot', 'MissedShots', 'Goal', 'ShotOnPost']);

export interface Models { xg: XgFreezeModel | null; resolver: ResolverParams | null }

/** 1. the on-ball actions: every touch, a pass when the next touch is a teammate's, joined to the feed's event of the
 *  same player within 0.6 s (its line-breaking tag, xpass, xG, tags) */
export function buildActions(g: Geo, touches: Touch[], events: FeedEvent[]): Action[] {
  const out: Action[] = [];
  const B = g.data.pkg.ball25;
  const peak = (t0: number, t1: number) => {
    if (!B) return 0; let z = 0;
    for (let k = Math.ceil(t0 * B.fps); k <= Math.floor(t1 * B.fps); k++) { const b = B.xyz[k]; if (b) z = Math.max(z, b[2]); }
    return z;
  };
  const used = new Set<number>();
  for (const tc of touches) {
    const n = tc.next, same = n ? g.side(n.player) === g.side(tc.player) : false;
    let kind: Action['kind'] = 'touch';
    if (tc.kind === 'shot') kind = 'shot';
    else if (tc.kind === 'save') kind = 'save';
    else if (tc.kind === 'clear') kind = 'clear';
    else if (tc.kind === 'kick' && n) kind = same ? 'pass' : 'lost';
    else if (tc.kind === 'dribble' || tc.kind === 'control') kind = 'carry';
    const a: Action = { t: tc.t, player: tc.player, kind };
    if (n && (kind === 'pass' || kind === 'lost' || kind === 'shot')) { a.to = n.player; a.tTo = n.t; a.metres = n.metres; a.peak = +peak(tc.t, n.t).toFixed(1); }
    // the feed's event: a Pass for a kick, the shot for the shot; else whatever the touch already matched
    // (a pass to the same receiver may sit up to 1.5 s off: at 89:07 the feed puts 7's pass to 1 a second early)
    let ei = -1, bd = Infinity;
    events.forEach((e, i) => {
      if (used.has(i) || e.player !== tc.player) return;
      // a kick takes a Pass, the shot its shot event; a control or a dribble neither (at 89:07 a control 1 s before the
      // kick took the kick's Pass)
      const want = kind === 'pass' || kind === 'lost' ? e.type === 'Pass' : kind === 'shot' ? SHOTS.has(e.type) : e.type !== 'Pass' && !SHOTS.has(e.type);
      const d = Math.abs(e.t - tc.t), lim = kind === 'pass' && e.receiver !== undefined && e.receiver === n?.player ? 1.5 : 0.6;
      if (want && d < lim && d < bd) { bd = d; ei = i; }
    });
    if (ei >= 0) {
      const e = events[ei]; used.add(ei); a.event = ei;
      if (e.lb) a.lb = e.lb;
      if (e.xpass !== undefined) a.xpass = e.xpass;
      if (e.xg !== undefined) a.xg = e.xg;
      if (e.tags?.length) a.tags = e.tags;
      a.ok = e.outcome !== 'Unsuccessful';
      if (e.type === 'Pass' && e.tags?.includes('Cross')) a.kind = kind === 'pass' ? 'pass' : 'cross';
    }
    out.push(a);
  }
  // a shot the touches missed (a header in an aerial duel is given to whoever's limb is nearest, often the defender):
  // the feed's shot by an attacker stands, at its own time
  events.forEach((e, ei) => {
    if (used.has(ei) || !SHOTS.has(e.type) || e.player === undefined || g.side(e.player) !== 'att') return;
    used.add(ei);
    out.push({ t: e.t, player: e.player, kind: 'shot', event: ei, ...(e.xg !== undefined ? { xg: e.xg } : {}), ...(e.tags?.length ? { tags: e.tags } : {}), ok: true });
  });
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** 2. the attack: the attacking side's actions from the first after the defenders' last touch before the key moment,
 *  to its end (the shot and its save, a loss, or the clip's end) */
export function attackOf(g: Geo, actions: Action[], keyT: number): { from: number; to: number; end: Story['end']; last: number } {
  let from = 0;
  // the defenders had the ball: a touch of theirs with no attacker's touch in the next 2.5 s (a block, a clearance or an
  // aerial duel that falls straight back to the attack does not end it; the shot clips start at the Opta possession's
  // start, so a long stretch without the attackers on the ball is the only way they lose it before the shot)
  const theirs = (i: number) => {
    if (g.side(actions[i].player) !== 'def' || actions[i].kind === 'save') return false;
    const nextAtt = actions.slice(i + 1).find((a) => g.side(a.player) === 'att');
    return !nextAtt || nextAtt.t - actions[i].t > 2.5;
  };
  for (let i = 0; i < actions.length && actions[i].t < keyT; i++) if (theirs(i)) from = i + 1;
  let to = actions.length - 1, end: Story['end'] = 'other';
  for (let i = from; i < actions.length; i++) {
    const a = actions[i];
    if (a.kind === 'shot') {
      const e = (g.data.pkg as unknown as { events?: FeedEvent[] }).events?.[a.event ?? -1];
      end = e?.type === 'Goal' ? 'goal' : e?.type === 'SavedShot' ? 'saved' : e?.type === 'ShotOnPost' ? 'post' : e?.type === 'MissedShots' ? 'missed' : 'other';
      const nx = actions[i + 1];
      if (nx && g.side(nx.player) === 'def' && end === 'other') end = 'blocked';
      to = i; break;
    }
    if (g.side(a.player) === 'def' && a.t > keyT && theirs(i)) {
      const prev = actions[i - 1];
      end = prev?.kind === 'cross' || prev?.tags?.includes('Cross') ? 'cross-cleared' : 'lost';
      to = i - 1; break;
    }
  }
  return { from, to, end, last: actions[to]?.tTo ?? actions[to]?.t ?? g.end };
}

/** the line-breaking units: Opta's count ending at its deepest line is the authority (raw geometry overcounts in two
 *  of the five demo passes, research doc 3.2); without the tag, our geometry: units the ball went from in front of to
 *  behind, on a pass that gained 10 m or more */
export function linesBroken(g: Geo, a: Action): { units: ('back' | 'mid' | 'front')[]; src: 'opta' | 'tracking'; why: string } | null {
  if (a.kind !== 'pass' || a.tTo === undefined) return null;
  // a feed that tags line-breaking passes at all (MA36) is the authority on the untagged ones too: our geometry only
  // stands in for feeds without the tag
  if (!a.lb && hasLb(g)) return null;
  const order: ('back' | 'mid' | 'front')[] = ['back', 'mid', 'front'];
  const b0 = g.ball(a.t), b1 = g.ball(a.tTo);
  const geo = (): ('back' | 'mid' | 'front')[] => {
    if (!b0 || !b1) return [];
    const u = unitsAt(g, 'def', a.t), got: ('back' | 'mid' | 'front')[] = [];
    for (const k of order) { const L = lineX(g, u[k], a.t); if (u[k].length >= 2 && b0[0] < L(b0[1]) - 0.5 && b1[0] > L(b1[1]) + 0.5) got.push(k); }
    return got;
  };
  if (a.lb && a.lb.lines > 0) {
    // Opta names the deepest line broken ('last' the back line, 'secondToLast' the midfield); when it does not, the
    // deepest of the units our geometry sees crossed, else the front line
    const deepest = a.lb.last === 'secondToLast' ? 1 : a.lb.last === 'last' ? 0 : -1;
    const g0 = geo(), start = deepest >= 0 ? deepest : g0.length ? order.indexOf(g0[0]) : 3 - a.lb.lines;
    return { units: order.slice(start, start + a.lb.lines), src: 'opta', why: `Opta lineBreakingPass：${a.lb.lines} 条线，最深 ${a.lb.last ?? `未标（几何：${g0.join('/') || '无'}）`}` };
  }
  if (!b0 || !b1 || b1[0] - b0[0] < 10) return null;
  const got = geo();
  return got.length ? { units: got, src: 'tracking', why: `轨迹几何：球从 ${got.join('/')} 线前到线后，前进 ${(b1[0] - b0[0]).toFixed(1)} m` } : null;
}

const lbFeeds = new WeakMap<object, boolean>();
const hasLb = (g: Geo) => {
  const pkg = g.data.pkg as unknown as { events?: FeedEvent[] };
  let v = lbFeeds.get(pkg); if (v === undefined) { v = (pkg.events ?? []).some((e) => e.lb !== undefined); lbFeeds.set(pkg, v); }
  return v;
};

/** a player's run over [t0, t1]: path length, displacement, peak and mean speed (km/h), forward metres */
export function runOf(g: Geo, p: number, t0: number, t1: number) {
  let len = 0, peak = 0, prev = g.pos(p, t0);
  const a = prev, b = g.pos(p, t1);
  for (let t = t0 + 0.1; t <= t1 + 1e-6; t += 0.1) { const q = g.pos(p, t); if (q && prev) len += dist(q, prev); prev = q; peak = Math.max(peak, kmh(g.vel(p, t))); }
  return { len, disp: a && b ? dist(a, b) : 0, dx: a && b ? b[0] - a[0] : 0, peak, mean: (len / Math.max(0.1, t1 - t0)) * 3.6, from: a, to: b };
}

/** a player's run onto a ball that reaches him at `recv`, kicked at `kick`: the stretch round his fastest moment in
 *  [kick - 3 s, recv] while he is faster than 14 km/h (running, not jogging); null when he never passes 20 km/h */
export function runSpan(g: Geo, p: number, kick: number, recv: number): { from: number; to: number; peak: number; peakT: number } | null {
  let peak = 0, peakT = recv;
  for (let t = Math.max(0, kick - 3); t <= recv + 1e-6; t += 0.1) { const v = kmh(g.vel(p, t)); if (v > peak) { peak = v; peakT = t; } }
  if (peak < 20) return null;
  let from = peakT, to = peakT;
  while (from - 0.1 >= Math.max(0, kick - 4) && kmh(g.vel(p, from - 0.1)) >= 14) from -= 0.1;
  while (to + 0.1 <= recv + 1e-6 && kmh(g.vel(p, to + 0.1)) >= 14) to += 0.1;
  return { from: +from.toFixed(2), to: +Math.max(to, Math.min(recv, peakT + 0.3)).toFixed(2), peak, peakT };
}

export interface Shot {
  t: number; feedT: number; shooter: number; xg: number | null; opta: number | null; distM: number; angleDeg: number;
  header: boolean; speed: number;
  mate: { player: number; xg: number; earlier: number | null; marker: { player: number; d: number } | null; pass: number | null; metres: number } | null;
}

/** the shot: frozen on the boot's contact (contact.ts), the shooter's defender-aware xG, and the best onside teammate
 *  by the same model at the same instant (and 2.5 s before, how fast his chance grew), with the chance a pass from the
 *  shooter reaches him first (the first-touch model, players' velocities carried on) */
export function shotOf(g: Geo, actions: Action[], models: Models): Shot | null {
  const a = actions.find((x) => x.kind === 'shot' && g.side(x.player) === 'att');
  if (!a) return null;
  const e = (g.data.pkg as unknown as { events?: FeedEvent[] }).events?.[a.event ?? -1];
  const t = contactTime(g.data, e?.t ?? a.t), all = g.all(t), S = all[a.player];
  const header = !!e?.tags?.includes('Head');
  const opp: XgPoint[] = [], keeper = g.defKeeper >= 0 ? all[g.defKeeper] : null;
  for (let p = g.nAtt; p < g.P; p++) if (p !== g.defKeeper) opp.push(all[p]);
  const xgAt = (pp: XY, tt: number, head = false) => {
    if (!models.xg) return null;
    const A = g.all(tt), o: XgPoint[] = []; for (let p = g.nAtt; p < g.P; p++) if (p !== g.defKeeper) o.push(A[p]);
    return xgFreeze(models.xg, pp, head, o, g.defKeeper >= 0 ? A[g.defKeeper] : null);
  };
  const dx = GOAL_X - S[0], dy = S[1];
  const angle = Math.abs(Math.atan2(dy + 3.66, dx) - Math.atan2(dy - 3.66, dx)) * 180 / Math.PI;
  const xg = models.xg ? xgFreeze(models.xg, S, header, opp, keeper) : null;
  // the teammates: onside at the strike (level with or behind the second-last defender, or behind the ball)
  const off = offsideX(g, t), bx = g.ball(t)?.[0] ?? S[0];
  let mate: Shot['mate'] = null;
  if (models.xg) for (let p = 0; p < g.nAtt; p++) {
    if (p === a.player || g.keepers.has(p)) continue;
    const q = all[p]; if (q[0] > Math.max(off, bx) + 0.3) continue;
    const x = xgFreeze(models.xg, q, false, opp, keeper);
    if (!mate || x > mate.xg) mate = { player: p, xg: x, earlier: null, marker: null, pass: null, metres: dist(S, q) };
  }
  if (mate) {
    const q2 = g.pos(mate.player, t - 2.5);
    mate.earlier = q2 ? xgAt(q2, t - 2.5) : null;
    mate.marker = nearestOpp(g, mate.player, t);
    if (models.resolver) {
      const vel = Array.from({ length: g.P }, (_, p) => g.vel(p, t)), gk = Array.from({ length: g.P }, (_, p) => g.keepers.has(p));
      mate.pass = passChance(models.resolver, all, vel, gk, a.player, mate.player);
    }
  }
  return { t, feedT: e?.t ?? a.t, shooter: a.player, xg, opta: a.xg ?? e?.xg ?? null, distM: Math.hypot(dx, dy), angleDeg: angle, header,
    speed: kmhOfKick(g, a.t), mate };
}

/** the ball's speed just after a kick, km/h, from its 25 Hz track (the peak over the next 0.2 s) */
export function kmhOfKick(g: Geo, t: number): number {
  const B = g.data.pkg.ball25; if (!B) return 0;
  let v = 0;
  for (let k = Math.round(t * B.fps) + 1; k <= Math.round((t + 0.2) * B.fps); k++) {
    const a = B.xyz[k], b = B.xyz[k + 1]; if (a && b) v = Math.max(v, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * B.fps * 3.6);
  }
  return Math.round(v);
}

/** 3. the phases of the attack */
export function phasesOf(g: Geo, act: Action[], from: number, to: number, key: Action | null, shot: Shot | null, endT: number): Phase[] {
  const t0 = act[from]?.t ?? 0, out: Phase[] = [];
  const bx = (t: number) => g.ball(t)?.[0] ?? 0;
  if (key && key.t > t0 + 0.5) {
    const where = bx(t0) < -THIRD ? '后场' : bx(t0) < 0 ? '本方半场' : bx(t0) < THIRD ? '中场' : '对方三区前沿';
    out.push({ kind: 'build-up', t0, t1: key.t, why: `从 ${where}（球 x ${bx(t0).toFixed(0)} m）倒脚到决定性的推进` });
  }
  if (key) out.push({ kind: 'progression', t0: key.t, t1: key.tTo ?? key.t, why: key.lb ? `破线传球 ${key.lb.lines} 条线` : `推进到三区，前进 ${((g.ball(key.tTo ?? key.t)?.[0] ?? 0) - bx(key.t)).toFixed(0)} m` });
  const ft0 = key ? key.tTo ?? key.t : t0, ft1 = shot ? shot.t : act[to]?.tTo ?? act[to]?.t ?? endT;
  if (ft1 > ft0 + 0.3) out.push({ kind: 'final-third', t0: ft0, t1: ft1, why: shot ? '推进之后到射门' : '推进之后到这次进攻结束' });
  if (shot) out.push({ kind: 'finish', t0: shot.t, t1: Math.min(endT, shot.t + 1.0), why: '射门' });
  const after = shot ? shot.t + 1.0 : act[to]?.tTo ?? act[to]?.t ?? endT;
  if (endT > after + 0.3) out.push({ kind: 'after', t0: after, t1: endT, why: '这次进攻结束之后' });
  return out;
}

/** the key progression: the line-breaking pass with the most lines (the latest on a tie), else the first pass or carry
 *  gaining 10 m into the final third */
export function keyProgression(g: Geo, act: Action[], from: number, to: number): Action | null {
  let best: Action | null = null;
  for (let i = from; i <= to; i++) {
    const a = act[i]; if (a.kind !== 'pass' || g.side(a.player) !== 'att') continue;
    const lb = linesBroken(g, a); if (!lb) continue;
    if (!best || lb.units.length >= (linesBroken(g, best)?.units.length ?? 0)) best = a;
  }
  if (best) return best;
  for (let i = from; i <= to; i++) {
    const a = act[i]; if (a.kind !== 'pass' || a.tTo === undefined) continue;
    const b0 = g.ball(a.t), b1 = g.ball(a.tTo);
    if (b0 && b1 && b1[0] > THIRD && b1[0] - b0[0] >= 10) return a;
  }
  return null;
}

/** the space a pass went into: the attack's control at the reception point as the passer saw it (at the kick), the
 *  nearest opponent at the reception, and the controlled area round it as a zone */
export function spaceOf(g: Geo, a: Action) {
  if (a.tTo === undefined || a.to === undefined) return null;
  const r = g.ball(a.tTo), k = g.ball(a.t); if (!r || !k) return null;
  const c: XY = [r[0], r[1]], z = spaceAt(g, a.t, c, [k[0], k[1]]);
  const near = nearestOpp(g, a.to, a.tTo);
  return { at: c, control: z?.centre ?? null, poly: z?.poly ?? null, area: z?.area ?? 0, nearest: near };
}

/** defenders beaten: outfield defenders goal-side of the ball at the kick, no longer goal-side when it arrives */
export function beatenBy(g: Geo, a: Action): number[] {
  if (a.tTo === undefined) return [];
  const b0 = g.ball(a.t), b1 = g.ball(a.tTo); if (!b0 || !b1) return [];
  const before = goalSide(g, a.t, b0[0]), after = new Set(goalSide(g, a.tTo, b1[0]));
  return before.filter((p) => !after.has(p));
}

/** decoys: other attackers who ran hard (peak 20 km/h, 8 m or more) in the pass's run window while the defender who
 *  was nearest them at its start went with them (6 m or more the same way) and ended farther from where the ball
 *  arrived: they took a defender out of the receiver's way */
export function decoysFor(g: Geo, a: Action, t0: number): { player: number; marker: number; peak: number; dragged: number; why: string }[] {
  if (a.tTo === undefined || a.to === undefined) return [];
  const r = g.ball(a.tTo); if (!r) return [];
  const out: { player: number; marker: number; peak: number; dragged: number; why: string }[] = [];
  for (let p = 0; p < g.nAtt; p++) {
    if (p === a.player || p === a.to || g.keepers.has(p)) continue;
    const run = runOf(g, p, t0, a.tTo);
    if (run.peak < 20 || run.disp < 8 || !run.from || !run.to) continue;
    const m = nearestOpp(g, p, t0); if (!m || m.d > 6) continue;
    const m0 = g.pos(m.player, t0), m1 = g.pos(m.player, a.tTo); if (!m0 || !m1) continue;
    const mv: XY = [m1[0] - m0[0], m1[1] - m0[1]], rv: XY = [run.to[0] - run.from[0], run.to[1] - run.from[1]];
    const cos = (mv[0] * rv[0] + mv[1] * rv[1]) / (Math.hypot(...mv) * Math.hypot(...rv) || 1);
    const dragged = dist(m1, [r[0], r[1]]) - dist(m0, [r[0], r[1]]);
    if (Math.hypot(...mv) >= 6 && cos >= 0.5 && dragged >= 2) out.push({ player: p, marker: m.player, peak: run.peak, dragged, why: `{n:${p}}跑 ${run.disp.toFixed(0)} m（峰值 ${run.peak.toFixed(0)} km/h），防守 {n:${m.player}} 跟走 ${Math.hypot(...mv).toFixed(0)} m，离落点远了 ${dragged.toFixed(0)} m` });
  }
  return out.sort((x, y) => y.dragged - x.dragged);
}

export const fact = (key: string, value: number | string, src: Fact['src'], unit?: string, note?: string): Fact => ({ key, value: typeof value === 'number' ? +value.toFixed(value < 1 && value > -1 ? 3 : 1) : value, src, ...(unit ? { unit } : {}), ...(note ? { note } : {}) });

/** everything the beats are built from, for one clip */
export function analyse(data: Loaded, models: Models) {
  const g = makeGeo(data);
  const events = ((data.pkg as unknown as { events?: FeedEvent[] }).events ?? []);
  const touches = detectTouches(data);
  const actions = buildActions(g, touches, events);
  const meta = data.pkg.meta as unknown as { kind?: string; shot?: { t: number; shooter: number }; pass?: { t: number; passer: number; receiver: number } };
  const keyT = meta.shot?.t ?? meta.pass?.t ?? g.end / 2;
  const atk = attackOf(g, actions, keyT);
  const shot = shotOf(g, actions.slice(atk.from, atk.to + 1), models);
  const key = keyProgression(g, actions, atk.from, atk.to);
  const phases = phasesOf(g, actions, atk.from, atk.to, key, shot, g.end);
  return { g, touches, actions, atk, shot, key, phases, meta };
}
export type Analysis = ReturnType<typeof analyse>;
