// The insight detectors (catalogue.ts is their contract): each reads the clip (positions, skeletons, the ball, the
// actions) and the whole-match profile, and returns the insights it finds with their numbers, drawings and line
// variants. Deterministic, thresholds in the open, every rule writing what it measured into `why`.
import type { Action } from '../types';
import { fact, runSpan, runOf, type Shot } from '../detect';
import { offsideX, goalSide, nearestOpp, attControl, dist, kmh, type Geo, type XY } from '../geom';
import { draw, LEAD, type DrawItem } from '../draw';
import type { Insight } from './types';
import type { Skel } from './skeleton';
import { angDeg } from './skeleton';
import { habits, profileReception, footShare, type Profile } from './profile';
import type { MatchPass } from '../../three/telestration/network';
import type { LaneName } from '../../three/telestration/Telestration';

export interface Ctx {
  g: Geo; skel: Skel; profile: Profile | null;
  /** the attacking side's actions of the attack, in order */
  act: Action[];
  /** every action of the clip, both sides */
  all: Action[];
  /** the match's passes with receivers (<match>/passes.json), for the pass pairs; null when not loaded */
  passes: MatchPass[] | null;
  shot: Shot | null; key: Action | null;
  players: { pid: string; home: boolean; shirt: number }[];
  lineup: ({ position: string; side: string } | null)[];
  roles: ({ in: string; out: string } | null)[];
  /** the attack's span */
  t0: number; t1: number;
}

const r1 = (x: number) => +x.toFixed(1), r2 = (x: number) => +x.toFixed(2);
const n = (p: number) => `{n:${p}}`;
export const LANE_ZH: Record<LaneName, string> = { 'left-wide': '左边路', 'left-half': '左肋部', centre: '中路', 'right-half': '右肋部', 'right-wide': '右边路' };
/** the lane of a point (data frame: +y the attack's right) */
export const laneOf = (y: number): LaneName => (y < -20.16 ? 'left-wide' : y < -9.16 ? 'left-half' : y <= 9.16 ? 'centre' : y <= 20.16 ? 'right-half' : 'right-wide');
const ballXY = (g: Geo) => (t: number): XY | null => { const b = g.ball(t); return b ? [b[0], b[1]] : null; };

interface Run { p: number; from: number; to: number; peak: number; disp: number; dx: number; pass: Action; received: boolean; a: XY; b: XY }
/** every attacker's run during the attack's passes (one per player and start) */
export function runsIn(c: Ctx): Run[] {
  const out: Run[] = [], seen = new Set<string>();
  for (const a of c.act) {
    if (a.kind !== 'pass' || a.tTo === undefined || a.to === undefined) continue;
    for (let p = 0; p < c.g.nAtt; p++) {
      if (p === a.player || c.g.keepers.has(p)) continue;
      const s = runSpan(c.g, p, a.t, a.tTo); if (!s) continue;
      const key = `${p}@${Math.round(s.from * 2)}`; if (seen.has(key)) continue;
      const r = runOf(c.g, p, s.from, s.to); if (r.disp < 8 || !r.from || !r.to) continue;
      seen.add(key);
      out.push({ p, from: s.from, to: s.to, peak: r.peak, disp: r.disp, dx: r.dx, pass: a, received: a.to === p, a: r.from, b: r.to });
    }
  }
  return out;
}

// ---- the shape of a run (Yi, 2026-10-23: can we see a 鱼钩跑?): the path from 2.5 s before the run (the check
// before the go is slow) to its end, headings from the displacement over +-0.3 s, the sharpest turn in any 1.5 s
export interface RunShape { shape: 'double' | 'hook' | 'bent' | 'straight' | 'diagonal' | 'lateral'; maxTurn: number; turnT: number; leg1: number; leg2: number; tot: number; heading: number; total: number; t0: number; a: XY; turn: XY; b: XY; dir1: XY; dir2: XY }
const wrapR = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export function runShape(g: Geo, p: number, from: number, to: number): RunShape | null {
  const t0 = Math.max(0, from - 2.5), pts: { t: number; q: XY }[] = [];
  for (let t = t0; t <= to + 1e-6; t += 0.1) { const q = g.pos(p, t); if (q) pts.push({ t, q }); }
  if (pts.length < 8) return null;
  const DEG = 180 / Math.PI;
  const H = pts.map((_, i) => { const a = pts[Math.max(0, i - 3)].q, b = pts[Math.min(pts.length - 1, i + 3)].q; return dist(a, b) >= 1.0 ? Math.atan2(b[1] - a[1], b[0] - a[0]) : NaN; });
  let maxTurn = 0, turnAt = -1;
  for (let i = 0; i + 15 < H.length; i++) { if (!Number.isFinite(H[i]) || !Number.isFinite(H[i + 15])) continue; const d1 = Math.abs(wrapR(H[i + 15] - H[i])) * DEG; if (d1 > maxTurn) { maxTurn = d1; turnAt = i + 7; } }
  let tot = 0; for (let i = 5; i < H.length; i += 5) if (Number.isFinite(H[i]) && Number.isFinite(H[i - 5])) tot += Math.abs(wrapR(H[i] - H[i - 5])) * DEG;
  const a = pts[0].q, b = pts[pts.length - 1].q, turn = turnAt > 0 ? pts[turnAt].q : a, total = dist(a, b);
  const leg1 = turnAt > 0 ? dist(a, turn) : 0, leg2 = turnAt > 0 ? dist(turn, b) : total;
  const heading = Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG;
  const shape: RunShape['shape'] = maxTurn >= 135 && leg1 >= 3 && leg2 >= 4 ? 'double' : maxTurn >= 80 && leg1 >= 3 && leg2 >= 4 ? 'hook' : tot >= 40 && maxTurn < 60 && total >= 8 ? 'bent' : Math.abs(wrapR(heading / DEG)) * DEG <= 30 ? 'straight' : Math.abs(Math.abs(heading) - 90) <= 30 ? 'lateral' : 'diagonal';
  return { shape, maxTurn, turnT: turnAt > 0 ? pts[turnAt].t : from, leg1, leg2, tot, heading, total, t0, a, turn, b, dir1: [turn[0] - a[0], turn[1] - a[1]], dir2: [b[0] - turn[0], b[1] - turn[1]] };
}
/** a leg's direction in words, for a line (data frame: +x the attack, |y| the width) */
function legZh(d: XY, from: XY, behind: boolean): string {
  const L = Math.hypot(d[0], d[1]) || 1, fx = d[0] / L, out = Math.sign(from[1]) * d[1] / L;   // out: away from the pitch's middle
  if (behind) return '身后';
  if (fx < -0.5) return '回撤';
  if (Math.abs(out) > 0.6) return out > 0 ? '拉边' : '内收';
  return fx > 0.5 ? '前压' : '横向';
}

export function hookRun(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  for (const r of runsIn(c)) {
    const sh = runShape(g, r.p, r.from, r.to); if (!sh || (sh.shape !== 'hook' && sh.shape !== 'double')) continue;
    // the marker during the first leg: did he follow it?
    const m = nearestOpp(g, r.p, sh.t0 + 0.3);
    let fooled = 0;
    if (m) { const d0 = g.pos(m.player, sh.t0), d1 = g.pos(m.player, sh.turnT); const L = Math.hypot(...sh.dir1) || 1; if (d0 && d1) fooled = ((d1[0] - d0[0]) * sh.dir1[0] + (d1[1] - d0[1]) * sh.dir1[1]) / L; }
    const off = offsideX(g, sh.turnT), behind = sh.b[0] >= off - 0.5 && sh.b[0] > sh.turn[0] + 3;
    const dir1 = legZh(sh.dir1, sh.a, false), dir2 = legZh(sh.dir2, sh.turn, behind);
    const dbl = sh.shape === 'double';
    out.push({
      id: `hook-run@${r2(r.from)}:${r.p}`, entry: 'hook-run', t: sh.turnT, t0: sh.t0 - LEAD, t1: r.to + 0.8, hold: 1.0, players: [{ player: r.p, role: 'runner' }, ...(m ? [{ player: m.player, role: 'marker' as const }] : []), { player: r.pass.player, role: 'passer' }],
      facts: [fact('turn_deg', sh.maxTurn, 'tracking', '°'), fact('leg1_m', sh.leg1, 'tracking', 'm', `第一段：${dir1}`), fact('leg2_m', sh.leg2, 'tracking', 'm', `第二段：${dir2}`), fact('fooled_m', fooled, 'tracking', 'm', m ? `${n(m.player)} 沿第一段方向跟了多少` : '无盯防'), fact('peak_kmh', r.peak, 'tracking', 'km/h'), fact('received', r.received ? '是' : '否', 'rule')],
      draw: [draw.run(`run-${r.p}-${r1(sh.t0)}`, r.p, sh.t0, r.to, [sh.t0 - LEAD, r.to + 0.8]), ...(m ? [draw.marking(`mark-${r.p}-${r1(sh.turnT)}`, r.p, sh.turnT, [sh.turnT - 0.6, sh.turnT + 0.8])] : []), draw.spotlight(`spot-${r.p}-${r1(sh.t0)}`, r.p, [sh.t0 - 0.3, sh.turnT + 0.5])],
      say: { neutral: `${n(r.p)} 先${dir1} ${sh.leg1.toFixed(0)} 米，再转 ${sh.maxTurn.toFixed(0)}° 钩向${dir2}：${dbl ? '折返假跑' : '鱼钩跑'}`,
        praise: m && fooled >= 1.5 ? `${n(r.p)} 先${dir1} ${sh.leg1.toFixed(0)} 米把 ${n(m.player)} 带偏 ${fooled.toFixed(0)} 米，再钩向${dir2}：${dbl ? '折返假跑' : '鱼钩跑'}${r.received ? '，球也到了' : ''}` : `${n(r.p)} 的${dbl ? '折返假跑' : '鱼钩跑'}：先${dir1}再钩向${dir2}，转了 ${sh.maxTurn.toFixed(0)}°`,
        improve: r.received ? undefined : `如果 ${n(r.pass.player)} 在 ${n(r.p)} 钩回来的那一刻出球，就是${behind ? '身后' : '前面'}的机会` },
      salience: Math.min(1, 0.5 + (r.received ? 0.15 : 0) + (fooled >= 1.5 ? 0.1 : 0) + (behind ? 0.1 : 0)), confidence: Math.min(1, 0.4 + (sh.maxTurn - 80) / 150 + Math.min(0.2, (sh.leg1 - 3) / 10)),
      why: [`${n(r.p)} 路径 ${sh.t0.toFixed(1)}–${r.to.toFixed(1)} s：最大转折 ${sh.maxTurn.toFixed(0)}°（阈值 80，折返 135）于 ${sh.turnT.toFixed(1)} s，两段 ${sh.leg1.toFixed(1)} / ${sh.leg2.toFixed(1)} m（阈值 3 / 4）`, m ? `第一段里 ${n(m.player)} 沿同向移动 ${fooled.toFixed(1)} m（≥ 1.5 算被带偏）` : '第一段里没有盯防', `${behind ? '第二段插到越位线之后' : '第二段未到身后'}；${r.received ? '接到了球' : '没接到球'}`],
    });
  }
  return out;
}

// ---- 盲侧跑位
export function blindSide(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  if (!skel.ok) return out;
  for (const r of runsIn(c)) {
    const m = nearestOpp(g, r.p, r.from); if (!m || m.d > 6) continue;
    // the defender's face against the runner and the ball, every 0.04 s from 0.4 s before the run to 2 s into it
    const T: number[] = [], toRunner: number[] = [], toBall: number[] = [];
    for (let t = r.from - 0.4; t <= Math.min(r.from + 2.0, r.to) + 1e-6; t += 0.04) {
      const fa = skel.facing(m.player, t), d = g.pos(m.player, t), q = g.pos(r.p, t), b = g.ball(t);
      if (!Number.isFinite(fa) || !d || !q || !b) continue;
      T.push(t); toRunner.push(angDeg(fa, Math.atan2(q[1] - d[1], q[0] - d[0]))); toBall.push(angDeg(fa, Math.atan2(b[1] - d[1], b[0] - d[0])));
    }
    if (T.length < 10) continue;
    // the longest stretch with his back to the runner (>= 110 degrees) while he watches the ball (<= 70): the 真空期
    let best: [number, number] | null = null, s0 = -1;
    for (let i = 0; i <= T.length; i++) {
      const on = i < T.length && toRunner[i] >= 110 && toBall[i] <= 70;
      if (on && s0 < 0) s0 = i;
      if (!on && s0 >= 0) { if (!best || T[i - 1] - T[s0] > T[best[1]] - T[best[0]]) best = [s0, i - 1]; s0 = -1; }
    }
    if (!best) continue;
    const b0 = T[best[0]], b1 = T[best[1]], dt = b1 - b0;
    if (dt < 0.4) continue;
    const peakBehind = Math.max(...toRunner.slice(best[0], best[1] + 1));
    // when he turned: the first moment after the stretch his face comes within 60 degrees of the runner
    let turn: number | null = null;
    for (let t = b1; t <= r.to + 0.5; t += 0.04) {
      const fa = skel.facing(m.player, t), d = g.pos(m.player, t), q = g.pos(r.p, t);
      if (Number.isFinite(fa) && d && q && angDeg(fa, Math.atan2(q[1] - d[1], q[0] - d[0])) < 60) { turn = t; break; }
    }
    const tTurn = turn ?? r.to, gap0 = dist(g.pos(r.p, b0)!, g.pos(m.player, b0)!), gap = dist(g.pos(r.p, tTurn)!, g.pos(m.player, tTurn)!);
    const ran = dist(g.pos(r.p, b0)!, g.pos(r.p, b1)!), gained = gap - gap0;
    const atStart = b0 <= r.from + 0.2;
    const conf = Math.min(1, 0.4 + (peakBehind - 110) / 100 + Math.min(0.3, dt / 3));
    // whose duty it was (Yi, 2026-10-23: a defender who looks at the ball is often not the one to blame; the cover
    // behind him is). Was he tracking the runner before: his face within 45 degrees of the runner over the 3 s before
    // the blind stretch, or the runner's marker by the engine's rule (mutual nearest opponents)
    let lockN = 0, lockT = 0;
    for (let t = b0 - 3; t < b0 - 1e-6; t += 0.1) {
      const fa = skel.facing(m.player, t), d = g.pos(m.player, t), q = g.pos(r.p, t);
      if (!Number.isFinite(fa) || !d || !q) continue;
      lockT++; if (angDeg(fa, Math.atan2(q[1] - d[1], q[0] - d[0])) <= 45) lockN++;
    }
    const lockShare = lockT >= 10 ? lockN / lockT : 0;
    const mutual = nearestOpp(g, r.p, b0 - 1)?.player === m.player && nearestOpp(g, m.player, b0 - 1)?.player === r.p;
    const locked = lockShare >= 0.4 || (mutual && lockShare >= 0.25);
    // was there cover: a defending teammate 2 to 12 m deeper (towards their own goal, +x) within 10 m across, at the
    // start of the stretch; and did he pick the runner up by the time the first defender turned
    const dm = g.pos(m.player, b0)!;
    let cover: { player: number; d: number } | null = null;
    for (let q = g.nAtt; q < g.P; q++) {
      if (q === m.player || g.keepers.has(q)) continue;
      const c0 = g.pos(q, b0); if (!c0) continue;
      const deeper = c0[0] - dm[0], across = Math.abs(c0[1] - dm[1]);
      if (deeper < 2 || deeper > 12 || across > 10) continue;
      const d = Math.hypot(deeper, across); if (!cover || d < cover.d) cover = { player: q, d };
    }
    const pick = nearestOpp(g, r.p, tTurn), coverPicked = !!cover && !!pick && pick.player === cover.player && pick.d <= 3;
    const duty = locked ? 'defender' : cover ? (coverPicked ? 'covered' : 'cover') : 'nobody';
    const improve = duty === 'defender' ? `${n(m.player)} 起跑前一直盯着 ${n(r.p)}（${Math.round(lockShare * 100)}% 的时间看着他），回头看球那一刻把他丢了；如果视线能在他身上多留半秒，会更好`
      : duty === 'nobody' ? `${n(m.player)} 在看球，身后没人替他盯着 ${n(r.p)}；如果有队友往这边收一步补位，这次跑位就有人管`
      : duty === 'cover' ? `${n(m.player)} 在看球，${n(cover!.player)} 本可以替他补上 ${n(r.p)}；如果 ${n(cover!.player)} 早一步跟上，会更好`
      : undefined;
    out.push({
      id: `blind-side-run@${r2(r.from)}:${r.p}`, entry: 'blind-side-run', t: b0, t0: r.from - LEAD, t1: Math.min(r.to + 0.5, tTurn + 1.0), hold: 1.6,
      players: [{ player: r.p, role: 'runner' }, { player: m.player, role: 'marker' }],
      facts: [fact('behind_deg', peakBehind, 'tracking', '°', '真空期里防守球员脸朝向离跑者的最大夹角'), fact('blind_s', dt, 'tracking', 's', '他看球、背对跑者的时长'), fact('ran_m', ran, 'tracking', 'm', '真空期里跑者跑的距离'), fact('gap_m', gap, 'tracking', 'm', `转头时两人的距离（真空期开始时 ${gap0.toFixed(1)}）`), fact('peak_kmh', r.peak, 'tracking', 'km/h'), fact('received', r.received ? '是' : '否', 'rule'),
        fact('locked', Math.round(lockShare * 100), 'tracking', '%', '起跑前 3 s 防守球员看着跑者的时间'), fact('cover', cover ? `{n:${cover.player}}${coverPicked ? '（已接管）' : '（未接管）'}` : '无', 'tracking', '', '起跑时他身后 2–12 m、横向 10 m 内的防守队友'), fact('duty', duty === 'defender' ? '他丢了人' : duty === 'nobody' ? '没人补位' : duty === 'cover' ? '补位晚了' : '补位到位', 'rule')],
      draw: [draw.run(`run-${r.p}-${r1(r.from)}`, r.p, r.from, r.to, [r.from - LEAD, r.to + 0.3]), draw.marking(`mark-${r.p}-${r1(r.from)}`, r.p, b0, [b0 - 0.5, tTurn + 0.5]), draw.spotlight(`spot-${m.player}-${r1(r.from)}`, m.player, [b0 - 0.3, tTurn + 0.3])],
      say: { neutral: `${n(m.player)} 回头看球的 ${dt.toFixed(1)} 秒里，${n(r.p)} 从他身后跑了 ${ran.toFixed(0)} 米${gained >= 1.5 ? `，等他转头已经差 ${gap.toFixed(0)} 米` : `，${n(m.player)} ${dt.toFixed(1)} 秒后才发现`}`,
        praise: atStart ? `${n(r.p)} 聪明：${n(m.player)} 回头看球的瞬间他起跑，${dt.toFixed(1)} 秒的真空期${gained >= 1.5 ? `，${n(m.player)} 转头时已经落后 ${gap.toFixed(0)} 米` : `，${n(m.player)} 转头时他已经在身后 ${ran.toFixed(0)} 米外`}` : `${n(r.p)} 的跑位躲在 ${n(m.player)} 的视线外：${n(m.player)} 盯着球的 ${dt.toFixed(1)} 秒里他跑了 ${ran.toFixed(0)} 米${gained >= 1.5 ? `，转头时已经差 ${gap.toFixed(0)} 米` : ''}`,
        improve },
      salience: Math.min(1, 0.5 + Math.min(0.25, dt / 4) + (r.received ? 0.15 : 0) + (gained >= 1.5 ? 0.1 : -0.1)), confidence: conf,
      why: [`${n(r.p)} ${r.from.toFixed(1)} s 起跑（峰值 ${r.peak.toFixed(0)} km/h，${r.disp.toFixed(0)} m）；起跑时最近防守 ${n(m.player)} ${m.d.toFixed(1)} m`, `${b0.toFixed(1)}–${b1.toFixed(1)} s（${dt.toFixed(1)} s，阈值 0.4）他的脸离跑者 ≥ 110°（最大 ${peakBehind.toFixed(0)}°）、离球 ≤ 70°`, turn !== null ? `${tTurn.toFixed(1)} s 转头，那时差 ${gap.toFixed(1)} m（真空期开始时 ${gap0.toFixed(1)} m）` : `到跑动结束都没转向他`,
        `责任：起跑前 3 s 他看着跑者的时间 ${Math.round(lockShare * 100)}%（≥ 40% 算盯着）${mutual ? '，且是他的盯人者' : ''}；身后补位 ${cover ? `${n(cover.player)}（深 ${cover.d.toFixed(0)} m）${coverPicked ? '，转头前已接管跑者' : '，没有接管'}` : '没有'} → ${duty === 'defender' ? '他丢了人，可以说' : duty === 'nobody' ? '不怪他，队友该补位' : duty === 'cover' ? '补位的人该早一步' : '补位到位，不批评任何人'}`],
    });
  }
  return out;
}

// ---- 接球前扫视 and 接球身体朝向: at every reception of the attack
interface Recv { pass: Action; p: number; t: number }
const receptions = (c: Ctx): Recv[] => c.act.filter((a) => a.kind === 'pass' && a.to !== undefined && a.tTo !== undefined && a.to < c.g.nAtt).map((a) => ({ pass: a, p: a.to!, t: a.tTo! }));
const nextBy = (c: Ctx, p: number, t: number) => c.act.find((a) => a.player === p && a.t > t + 0.05);
/** how much a moment matters to the attack's story: near the key pass, the final pass or the shot more, deep in the
 *  build-up less */
function relevance(c: Ctx, t: number, p: number): number {
  let r = 0;
  if (c.key && (Math.abs(t - c.key.t) <= 2 || (c.key.tTo !== undefined && Math.abs(t - c.key.tTo) <= 0.5))) r += 0.15;
  if (c.shot && (p === c.shot.shooter || Math.abs(t - c.shot.t) <= 3)) r += 0.15;
  if (c.key && t < c.key.t - 5) r -= 0.1;
  return r;
}
const clockAt = (c: Ctx, t: number) => ((c.g.data.pkg as unknown as { clock0?: number }).clock0 ?? 0) + t;

export function scanning(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  if (!skel.ok) return out;
  const ball = ballXY(g);
  for (const r of receptions(c)) {
    const s = skel.scans(r.p, r.t, ball); if (!s) continue;
    const nx = nextBy(c, r.p, r.t), delay = nx ? nx.t - r.t : null;
    const b0 = g.ball(r.t), b1 = nx?.tTo !== undefined ? g.ball(nx.tTo) : null;
    const forward = nx?.kind === 'pass' && b0 && b1 ? b1[0] - b0[0] >= 3 : nx?.kind === 'carry' && b0 ? (g.ball(r.t + 1)?.[0] ?? b0[0]) - b0[0] >= 2 : false;
    const near = nearestOpp(g, r.p, r.t), pl = c.players[r.p], h = pl ? habits(c.profile, pl.pid) : null;
    const pr = pl ? profileReception(c.profile, pl.home, pl.shirt, clockAt(c, r.t)) : null;
    const habit = h && h.receptions.n >= 8 ? r2(h.receptions.scans / h.receptions.n) : null;
    const quick = delay !== null && delay <= 1.5, pressed = !!near && near.d <= 3, slow = delay === null || delay >= 2.0;
    const lostIt = nx?.kind === 'lost';
    // worth a line: he scanned and then played quickly forward; or he did not look, was pressed, and it cost him
    // a back pass is not a cost (patient circulation plays back on purpose); a loss, or holding it 2 s pressed, is
    const praise = s.n >= 2 && quick && forward, improve = s.n === 0 && pressed && (slow || lostIt);
    const facts = [fact('scans', s.n, 'tracking', '次', '接球前 3 s'), ...(s.last !== null ? [fact('last_scan_s', s.last, 'tracking', 's', '最后一次扫视结束到接球')] : []), ...(delay !== null ? [fact('next_s', delay, 'tracking', 's', `接球到下一步（${nx?.kind}${forward ? '，向前' : ''}）`)] : []), ...(near ? [fact('nearest_m', near.d, 'tracking', 'm')] : []), ...(habit !== null ? [fact('habit_scans', habit, 'tracking', '次/次接球', `本场 ${h!.receptions.n} 次接球的平均`)] : []), ...(pr && pr.scans !== null ? [fact('profile_scans', pr.scans, 'tracking', '次', '全场档案里同一次接球')] : [])];
    out.push({
      id: `scanning@${r2(r.t)}:${r.p}`, entry: 'scanning', t: r.t, t0: r.t - 3, t1: r.t + 1.0, players: [{ player: r.p, role: 'receiver' }], facts,
      draw: [draw.spotlight(`spot-${r.p}-${r1(r.t)}`, r.p, [r.t - 3, r.t + 0.8])],
      say: { neutral: `${n(r.p)} 接球前 3 秒扫视 ${s.n} 次${s.last !== null ? `，最后一次离接球 ${s.last.toFixed(1)} 秒` : ''}`,
        praise: praise ? `${n(r.p)} 接球前扫了 ${s.n} 次${s.last !== null ? `，最后一次离接球只有 ${s.last.toFixed(1)} 秒` : ''}，所以 ${delay!.toFixed(1)} 秒就向前出球` : undefined,
        improve: improve ? `${n(r.p)} 接球前没有回头看，${near ? `对手离他只有 ${near.d.toFixed(0)} 米` : ''}；如果提前扫一眼，${lostIt ? '这球就不会丢' : '接球后第一脚就能朝前'}` : undefined },
      salience: praise || improve ? Math.max(0, Math.min(1, (praise ? 0.6 : 0.55) + relevance(c, r.t, r.p))) : 0.2, confidence: s.n >= 2 || s.n === 0 ? 0.8 : 0.6,
      why: [`接球 ${r.t.toFixed(2)} s：3 s 内脸离球 > 60° 的扫视 ${s.n} 次${s.last !== null ? `，最后一次结束于接球前 ${s.last.toFixed(2)} s` : ''}`, delay !== null ? `下一步 ${nx!.kind} 在 ${delay.toFixed(1)} s 后${forward ? '，向前' : ''}` : '之后没有动作', praise ? '扫视 ≥ 2 且 1.5 s 内向前出球：值得夸' : improve ? `没扫视、受压（≤ 3 m）、${lostIt ? '丢了球' : '受压持球 2 s 以上'}：可以改进（回传不算代价：耐心倒脚本来就会回传）` : '平常：不讲'],
      ...(praise || improve ? { rate: 0.5 } as object : {}),
    } as Insight);
  }
  return out;
}

export function bodyShape(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  if (!skel.ok) return out;
  for (const r of receptions(c)) {
    const tor = skel.torso(r.p, r.t); if (!Number.isFinite(tor)) continue;
    const deg = angDeg(tor, 0), b0 = g.ball(r.t), b1 = g.ball(r.t + 0.4);
    if (!b0 || !b1) continue;
    const dx = b1[0] - b0[0], dy = b1[1] - b0[1], m = Math.hypot(dx, dy);
    const touch = dx > 0.6 && dx >= Math.abs(dy) ? 'forward' : dx < -0.6 && -dx >= Math.abs(dy) ? 'back' : m > 0.6 ? 'side' : 'still';
    const near = nearestOpp(g, r.p, r.t), pressed = !!near && near.d <= 2;
    const open = deg <= 90, closed = deg >= 135, pl = c.players[r.p], h = pl ? habits(c.profile, pl.pid) : null;
    const openShare = h && h.receptions.n >= 8 ? Math.round((100 * h.receptions.open) / h.receptions.n) : null;
    const nx = nextBy(c, r.p, r.t), delay = nx ? nx.t - r.t : null, b2 = nx?.tTo !== undefined ? g.ball(nx.tTo) : null;
    const fwdPass = nx?.kind === 'pass' && b2 ? b2[0] - b0[0] >= 3 : false, lostIt = nx?.kind === 'lost' || (nx?.kind === 'pass' && b2 ? b2[0] - b0[0] <= -3 : false);
    // worth a line: open body and the ball taken forward under pressure (or a quick forward pass); or closed under
    // pressure and it cost him (lost, or played back)
    const praise = open && ((touch === 'forward' && m >= 1.5 && !!near && near.d <= 4) || (fwdPass && delay !== null && delay <= 1.5)), improve = closed && pressed && (lostIt || touch === 'back');
    const touchZh = { forward: '朝前', back: '朝后', side: '横向', still: '原地' }[touch];
    out.push({
      id: `body-shape@${r2(r.t)}:${r.p}`, entry: 'body-shape', t: r.t, t0: r.t - 0.5, t1: r.t + 1.0, hold: praise || improve ? 1.2 : undefined, players: [{ player: r.p, role: 'receiver' }],
      facts: [fact('body_deg', deg, 'tracking', '°', '躯干朝向与进攻方向的夹角，0 = 面向对方球门'), fact('first_touch', `${touchZh} ${m.toFixed(1)} m`, 'tracking'), ...(near ? [fact('nearest_m', near.d, 'tracking', 'm')] : []), ...(openShare !== null ? [fact('habit_open', openShare, 'tracking', '%', `本场 ${h!.receptions.n} 次接球里身体打开的比例`)] : [])],
      draw: [draw.spotlight(`spot-${r.p}-${r1(r.t)}`, r.p, [r.t - 0.5, r.t + 0.8])],
      say: { neutral: `${n(r.p)} ${open ? '侧身' : closed ? '背身' : '半转身'}接球（${deg.toFixed(0)}°），第一脚${touchZh} ${m.toFixed(1)} 米`,
        praise: praise ? `${n(r.p)} 侧身接球，身体打开朝向前场（${deg.toFixed(0)}°），${touch === 'forward' && m >= 1.5 ? `第一脚直接朝前 ${m.toFixed(1)} 米` : `${delay!.toFixed(1)} 秒就向前出球`}` : undefined,
        improve: improve ? `${n(r.p)} 背身接球（${deg.toFixed(0)}°）${near ? `，对手就在 ${near.d.toFixed(1)} 米` : ''}；如果提前侧身，第一脚就能转向前场` : undefined },
      salience: praise || improve ? Math.max(0, Math.min(1, 0.55 + relevance(c, r.t, r.p))) : 0.2, confidence: open || closed ? 0.8 : 0.5,
      why: [`接球 ${r.t.toFixed(2)} s：躯干 ${deg.toFixed(0)}°（≤ 90 打开，≥ 135 背身）；第一脚 0.4 s 内球${touchZh} ${m.toFixed(1)} m${near ? `；最近对手 ${near.d.toFixed(1)} m` : ''}${delay !== null ? `；下一步 ${nx!.kind} ${delay.toFixed(1)} s 后${fwdPass ? '（向前）' : ''}` : ''}`, praise ? '打开、受压下第一脚朝前（或 1.5 s 内向前出球）：值得夸' : improve ? '背身、受压（≤ 2 m）、丢球或回传：可以改进' : '平常：不讲'],
    });
  }
  return out;
}

// ---- 用脚: the kicks of the clip's protagonists, with their 本场 habits
export function foot(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  if (!skel.ok) return out;
  const kicks = c.act.filter((a) => (a.kind === 'pass' || a.kind === 'shot' || a.kind === 'cross' || a.kind === 'lost') && a.player < g.nAtt && !g.keepers.has(a.player));
  // one per player, at his most telling kick: the shot, the key pass, else his last pass
  const rank = (a: Action) => (a.kind === 'shot' ? 3 : a === c.key ? 2 : a.tags?.includes('KeyPass') ? 1 : 0);
  const best = new Map<number, Action>();
  for (const a of kicks) { const b = best.get(a.player); if (!b || rank(a) >= rank(b)) best.set(a.player, a); }
  for (const [p, a] of best) {
    const t = a.kind === 'shot' && c.shot ? c.shot.t : a.t, b = g.ball(t), f = skel.foot(p, t, b?.[2] ?? 0);
    if (f.foot === '?' || f.foot === 'H') continue;
    const pl = c.players[p], h = pl ? habits(c.profile, pl.pid) : null;
    const ps = h ? footShare(h.passes, 12) : null, ds = h ? footShare(h.dribble, 10) : null;
    const footZh = f.foot === 'L' ? '左脚' : f.foot === 'R' ? '右脚' : '两脚难分';
    const kindZh = a.kind === 'shot' ? '射门' : a === c.key ? '关键传球' : '传球';
    const weak = ps && f.foot !== 'either' ? (f.foot === 'L' ? ps.L : ps.R) < 30 : false;
    // habits from the passes only (checked against Opta: 30 of 35); the dribble touches' feet are not validated
    // (every player comes out near 50/50, which real players do not), so they are facts for the debug view, no line
    const balanced = !!ps && Math.min(ps.L, ps.R) >= 40, oneFooted = !!ps && ps.n >= 30 && Math.max(ps.L, ps.R) >= 92;
    const strong = ps ? (ps.L >= ps.R ? '左脚' : '右脚') : '', other = ps ? (ps.L >= ps.R ? '右脚' : '左脚') : '';
    const facts = [fact('foot', footZh, 'tracking', '', `${kindZh}；摆动 ${f.L.toFixed(1)} 对 ${f.R.toFixed(1)} m/s，比 ${f.ratio.toFixed(2)}`), ...(ps ? [fact('pass_LR', `${ps.L}% / ${ps.R}%`, 'tracking', '', `本场传球左/右，${ps.n} 次能判定`)] : []), ...(ds ? [fact('dribble_LR', `${ds.L}% / ${ds.R}%`, 'tracking', '', `本场带球触球左/右，${ds.n} 次（未验证，不进解说）`)] : []), ...(h ? [fact('shots_LR', `${h.shots.L} / ${h.shots.R}`, 'tracking', '', '本场射门左/右')] : [])];
    out.push({
      id: `foot@${r2(t)}:${p}`, entry: 'foot', t, t0: t - 0.6, t1: t + 1.0, players: [{ player: p, role: a.kind === 'shot' ? 'shooter' : 'passer' }], facts,
      draw: [draw.spotlight(`spot-${p}-${r1(t)}`, p, [t - 0.6, t + 0.8])],
      say: { neutral: `${n(p)} 这脚${kindZh}用${footZh}${ps ? `；本场传球左脚 ${ps.L}%、右脚 ${ps.R}%` : ''}`,
        praise: balanced ? `${n(p)} 两脚均衡：本场传球左脚 ${ps!.L}%、右脚 ${ps!.R}%，所以从哪个角度都能出球` : weak ? `${n(p)} 这脚${kindZh}用的是他本场用得少的${footZh}（传球只占 ${f.foot === 'L' ? ps!.L : ps!.R}%），敢用弱侧脚` : undefined,
        improve: oneFooted && !weak ? `${n(p)} 本场 ${ps!.n} 次传球 ${Math.max(ps!.L, ps!.R)}% 用${strong}；如果${other}也能出球，对手就不能只封他的${strong}一侧` : undefined },
      salience: weak || balanced || oneFooted ? Math.max(0, Math.min(1, (weak && a.kind === 'shot' ? 0.65 : weak ? 0.5 : balanced ? 0.5 : 0.42) + relevance(c, t, p))) : 0.15, confidence: f.foot === 'either' ? 0.4 : Math.min(1, 0.6 + (f.ratio - 1) / 2),
      why: [`${kindZh} ${t.toFixed(2)} s：触球前 0.2 s 左脚 ${f.L.toFixed(1)}、右脚 ${f.R.toFixed(1)} m/s → ${footZh}（射门对照 Opta 20/21）`, ps ? `本场传球 ${ps.n} 次判定：左 ${ps.L}%、右 ${ps.R}%${balanced ? '（均衡 ≥ 40%）' : weak ? '（这脚是弱侧，< 30%）' : oneFooted ? '（≥ 92% 单脚，n ≥ 30）' : ''}` : '本场传球不足 12 次，不谈习惯', ds ? `本场带球触球 ${ds.n} 次：左 ${ds.L}%、右 ${ds.R}%（未验证，不进解说）` : ''].filter(Boolean),
    });
  }
  return out;
}

// ---- 肋部前插
export function halfSpaceRun(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  for (const r of runsIn(c)) {
    const l0 = laneOf(r.a[1]), l1 = laneOf(r.b[1]);
    if (!(l1 === 'left-half' || l1 === 'right-half') || l0 === l1 || r.dx < 8 || r.b[0] < 10) continue;
    const off0 = offsideX(g, r.from);
    if (r.b[0] < off0 - 1 && r.b[0] < 36) continue;
    const before = goalSide(g, r.from, r.a[0]), after = new Set(goalSide(g, r.to, r.b[0])), beaten = before.filter((p) => !after.has(p));
    const conf = Math.min(1, 0.5 + (r.dx - 8) / 20 + (r.b[0] >= off0 ? 0.2 : 0));
    out.push({
      id: `half-space-run@${r2(r.from)}:${r.p}`, entry: 'half-space-run', t: r.from, t0: r.from - LEAD, t1: r.to + 0.8, players: [{ player: r.p, role: 'runner' }, ...beaten.map((p) => ({ player: p, role: 'beaten' as const }))],
      facts: [fact('from', LANE_ZH[l0], 'tracking'), fact('to', LANE_ZH[l1], 'tracking'), fact('forward_m', r.dx, 'tracking', 'm'), fact('peak_kmh', r.peak, 'tracking', 'km/h'), fact('beaten', beaten.length, 'tracking', '人'), fact('line_x', off0, 'tracking', 'm', '起跑时的越位线'), fact('received', r.received ? '是' : '否', 'rule')],
      draw: [{ id: `lane-${l1}-${r1(r.from)}`, kind: 'zone', lane: l1, from: Math.max(0, Math.floor(r.a[0])), to: 52.5, ink: 'att', window: { from: r2(r.from - LEAD), to: r2(r.to + 0.8) } } as DrawItem, draw.run(`run-${r.p}-${r1(r.from)}`, r.p, r.from, r.to, [r.from - LEAD, r.to + 0.8]), draw.units(`units-${r1(r.from)}`, r.from, r.from - LEAD, r.to + 0.3)],
      say: { neutral: `${n(r.p)} 从${LANE_ZH[l0]}插进${LANE_ZH[l1]}，前进 ${r.dx.toFixed(0)} 米，越过 ${beaten.length} 人`,
        praise: `${n(r.p)} 从${LANE_ZH[l0]}插进${LANE_ZH[l1]}，正好是边后卫和中后卫之间的缝，越过 ${beaten.length} 人${r.received ? '，球也到了' : ''}`,
        improve: r.received ? undefined : `${n(r.p)} 这次肋部前插没人看到；如果 ${n(r.pass.player)} 这时给他，就是单刀的角度` },
      salience: Math.min(1, 0.5 + 0.05 * beaten.length + (r.received ? 0.15 : 0)), confidence: conf,
      why: [`${n(r.p)} ${r.from.toFixed(1)}–${r.to.toFixed(1)} s：${LANE_ZH[l0]} → ${LANE_ZH[l1]}，x +${r.dx.toFixed(0)} m（阈值 8），终点 x ${r.b[0].toFixed(0)}（越位线 ${off0.toFixed(0)}）`, `越过 ${beaten.length} 名防守球员；${r.received ? '接到了球' : '没接到球'}`],
    });
  }
  return out;
}

// ---- 中锋拉边
export function strikerWide(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  const strikers = [...Array(g.nAtt).keys()].filter((p) => c.lineup[p]?.position === 'Striker' || c.roles[p]?.in === 'F' || c.roles[p]?.in?.startsWith('F.'));
  const cbs = [...Array(g.P).keys()].filter((p) => p >= g.nAtt && c.lineup[p]?.position === 'Defender' && /Centre/.test(c.lineup[p]?.side ?? ''));
  for (const s of strikers) {
    let best: { t0: number; t1: number; move: number; cb: number | null; dragged: number; dctl: number } | null = null;
    for (let t0 = c.t0; t0 + 4 <= c.t1; t0 += 0.5) {
      const t1 = t0 + 4, a = g.pos(s, t0), b = g.pos(s, t1); if (!a || !b) continue;
      if (Math.abs(a[1]) >= 9.16 || Math.abs(b[1]) < 12 || b[0] < 0) continue;
      const move = dist(a, b); if (move < 8) continue;
      const ux = (b[0] - a[0]) / move, uy = (b[1] - a[1]) / move;
      // the defence as a whole shifts with the ball; a centre back is "dragged" only by what he moves beyond that shift
      let shift = 0, nShift = 0;
      for (let q = g.nAtt; q < g.P; q++) { if (g.keepers.has(q)) continue; const d0 = g.pos(q, t0), d1 = g.pos(q, t1); if (d0 && d1) { shift += (d1[0] - d0[0]) * ux + (d1[1] - d0[1]) * uy; nShift++; } }
      shift = nShift ? shift / nShift : 0;
      let cb: number | null = null, dragged = 0;
      for (const d of cbs) { const d0 = g.pos(d, t0), d1 = g.pos(d, t1); if (!d0 || !d1) continue; const along = (d1[0] - d0[0]) * ux + (d1[1] - d0[1]) * uy - shift; if (along > dragged) { dragged = along; cb = d; } }
      const off = offsideX(g, t1), pts: XY[] = []; for (const x of [off - 9, off - 5, off - 1]) for (const y of [-6, 0, 6]) pts.push([x, y]);
      const bb0 = g.ball(t0), bb1 = g.ball(t1); if (!bb0 || !bb1) continue;
      const mean = (v: number[]) => v.reduce((q, x) => q + x, 0) / v.length;
      const dctl = mean(attControl(g, t1, pts, [bb1[0], bb1[1]])) - mean(attControl(g, t0, pts, [bb0[0], bb0[1]]));
      if (dragged < 3 && dctl < 0.15) continue;
      if (!best || move + dragged > best.move + best.dragged) best = { t0, t1, move, cb, dragged, dctl };
    }
    if (!best) continue;
    const { t0, t1, move, cb, dragged, dctl } = best, off = offsideX(g, t1);
    // who came into the middle
    const into = [...Array(g.nAtt).keys()].filter((p) => p !== s && !g.keepers.has(p)).find((p) => { const a = g.pos(p, t0), b = g.pos(p, t1); return a && b && Math.abs(a[1]) > 9.16 && Math.abs(b[1]) <= 9.16 && b[0] > off - 12; });
    out.push({
      id: `striker-wide@${r2(t0)}:${s}`, entry: 'striker-wide', t: t1, t0: t0 - 0.3, t1: t1 + 1.5, players: [{ player: s, role: 'runner' }, ...(cb !== null ? [{ player: cb, role: 'marker' as const }] : []), ...(into !== undefined ? [{ player: into, role: 'mate' as const }] : [])],
      facts: [fact('move_m', move, 'tracking', 'm', '4 s 内从中路到边路'), ...(cb !== null ? [fact('cb_dragged_m', dragged, 'tracking', 'm', `中后卫 ${n(cb)} 比全队整体移动多走的距离`)] : []), fact('centre_control', dctl, 'pitch-control', '', '中路禁区弧顶 9 点的进攻方控制率变化')],
      draw: [draw.run(`run-${s}-${r1(t0)}`, s, t0, t1, [t0 - 0.3, t1 + 1.2]), ...(cb !== null ? [draw.marking(`mark-${s}-${r1(t1)}`, s, t1, [t1 - 0.5, t1 + 1.5])] : []), draw.zone(`centre-${r1(t1)}`, [[off - 11, -9], [off + 1, -9], [off + 1, 9], [off - 11, 9]], [t1 - 0.5, t1 + 1.5])],
      say: { neutral: `${n(s)} 拉到边路 ${move.toFixed(0)} 米${cb !== null && dragged >= 3 ? `，把 ${n(cb)} 带出 ${dragged.toFixed(0)} 米` : ''}${dctl >= 0.15 ? '，中路空出来' : ''}`,
        praise: cb !== null && dragged >= 3 ? `${n(s)} 拉边把 ${n(cb)} 带出 ${dragged.toFixed(0)} 米${dctl >= 0.15 ? `，中路的空当${into !== undefined ? `留给了 ${n(into)}` : '出来了'}` : into !== undefined ? `，${n(into)} 趁机进了中路` : ''}` : dctl >= 0.15 ? `${n(s)} 拉边，中路的控制交到了 A 队手里${into !== undefined ? `，${n(into)} 插了进去` : ''}` : undefined,
        improve: into === undefined && (dragged >= 3 || dctl >= 0.15) ? `${n(s)} 拉边${dragged >= 3 ? `带出了 ${n(cb!)}` : '腾出了中路'}，如果有队友同时插进中路，这一下就用上了` : undefined },
      salience: Math.min(1, 0.45 + dragged / 12 + (dctl >= 0.15 ? 0.1 : 0) + (into !== undefined ? 0.1 : 0)), confidence: Math.min(1, 0.5 + dragged / 10),
      why: [`${n(s)}（中锋）${t0.toFixed(1)}–${t1.toFixed(1)} s：|y| ${Math.abs(g.pos(s, t0)![1]).toFixed(0)} → ${Math.abs(g.pos(s, t1)![1]).toFixed(0)} m，${move.toFixed(0)} m（阈值 8）`, cb !== null ? `中后卫 ${n(cb)} 沿他的方向比全队的整体移动多走 ${dragged.toFixed(1)} m（阈值 3）` : '没有中后卫被带出（扣掉全队整体移动后）', `中路（禁区弧顶 9 点）的进攻方控制率 ${dctl >= 0 ? '+' : ''}${dctl.toFixed(2)}（阈值 0.15；为负说明他离开后中路反而是对方的）`, into !== undefined ? `${n(into)} 同时进入中路` : '没人进中路'],
    });
  }
  return out;
}

// ---- 局部轮转
export function rotation(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, P = [...Array(g.nAtt).keys()].filter((p) => !g.keepers.has(p));
  const found: { t0: number; t1: number; trio: number[]; disp: number[]; swaps: number; score: number }[] = [];
  for (let t0 = c.t0; t0 + 4 <= c.t1; t0 += 0.5) {
    const t1 = t0 + 4, A = new Map(P.map((p) => [p, g.pos(p, t0)])), B = new Map(P.map((p) => [p, g.pos(p, t1)]));
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (let k = j + 1; k < P.length; k++) {
      const trio = [P[i], P[j], P[k]], a = trio.map((p) => A.get(p)!), b = trio.map((p) => B.get(p)!);
      if (a.some((x) => !x) || b.some((x) => !x)) continue;
      if (dist(a[0], a[1]) > 12 || dist(a[0], a[2]) > 12 || dist(a[1], a[2]) > 12) continue;
      if (dist(b[0], b[1]) > 14 || dist(b[0], b[2]) > 14 || dist(b[1], b[2]) > 14) continue;      // they stay a group
      if (a.some((x) => x[0] < 0)) continue;                                                         // in the opponent's half
      const disp = trio.map((_, q) => dist(a[q], b[q])); if (disp.some((d) => d < 7)) continue;
      let swaps = 0;
      for (const ax of [0, 1] as const) for (let q = 0; q < 3; q++) for (let r = q + 1; r < 3; r++) if (Math.sign(a[q][ax] - a[r][ax]) !== Math.sign(b[q][ax] - b[r][ax])) swaps++;
      if (swaps < 3) continue;
      found.push({ t0, t1, trio, disp, swaps, score: disp.reduce((s, d) => s + d, 0) + swaps * 3 });
    }
  }
  found.sort((x, y) => y.score - x.score);
  const taken: typeof found = [];
  for (const f of found) if (!taken.some((t) => Math.abs(t.t0 - f.t0) < 4 && t.trio.some((p) => f.trio.includes(p)))) taken.push(f);
  for (const f of taken.slice(0, 2)) {
    const [a, b, d] = f.trio;
    const marker = nearestOpp(g, a, f.t0);
    out.push({
      id: `rotation@${r2(f.t0)}:${a}`, entry: 'rotation', t: f.t0, t0: f.t0 - 0.3, t1: f.t1 + 0.8, players: f.trio.map((p) => ({ player: p, role: 'runner' as const })),
      facts: [fact('moves_m', f.disp.map((x) => x.toFixed(0)).join(' / '), 'tracking', 'm', '三人各自 4 s 内的位移'), fact('swaps', f.swaps, 'tracking', '处', '宽度或深度排序交换的对数')],
      draw: f.trio.map((p) => draw.run(`run-${p}-${r1(f.t0)}`, p, f.t0, f.t1, [f.t0 - 0.3, f.t1 + 0.8])),
      say: { neutral: `${n(a)}、${n(b)}、${n(d)} 三人 4 秒内互换位置，局部轮转`, praise: `${n(a)}、${n(b)}、${n(d)} 轮转换位${marker ? `，${n(marker.player)} 不知道该跟谁` : ''}`, improve: undefined },
      salience: Math.min(0.8, 0.45 + 0.05 * f.swaps), confidence: Math.min(1, 0.4 + 0.1 * f.swaps),
      why: [`${f.t0.toFixed(1)}–${f.t1.toFixed(1)} s：三人起点两两 ≤ 12 m、终点 ≤ 14 m，对方半场，各移动 ${f.disp.map((x) => x.toFixed(0)).join('/')} m（阈值 7），排序交换 ${f.swaps} 处（阈值 3）`],
    });
  }
  return out;
}

// ---- 套边 / 内插
export function overlap(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  for (const a of c.act) {
    if (a.kind !== 'pass' && a.kind !== 'cross' && a.kind !== 'lost' && a.kind !== 'shot') continue;
    const carrier = a.player, recv = [...c.act].reverse().find((x) => x.kind === 'pass' && x.to === carrier && x.t < a.t);
    const from = recv?.t ?? a.t - 1.5, to = a.t;
    if (to - from < 0.6) continue;
    for (let m = 0; m < g.nAtt; m++) {
      if (m === carrier || g.keepers.has(m)) continue;
      let cross: number | null = null, prev: number | null = null;
      for (let t = from; t <= to + 1e-6; t += 0.1) {
        const pc = g.pos(carrier, t), pm = g.pos(m, t); if (!pc || !pm) continue;
        const rel = pm[0] - pc[0];
        if (prev !== null && prev < -1 && rel > 1 && Math.abs(pm[1] - pc[1]) <= 8 && kmh(g.vel(m, t)) >= 20) { cross = t; break; }
        if (rel < -1 || rel > 1) prev = rel;
      }
      if (cross === null) continue;
      const pc = g.pos(carrier, cross)!, pm = g.pos(m, cross)!, side = Math.abs(pm[1]) > Math.abs(pc[1]) ? '套边' : '内插';
      const s = runSpan(g, m, from - 1, to + 0.5), run = runOf(g, m, s?.from ?? from, s?.to ?? to), received = a.to === m;
      out.push({
        id: `overlap@${r2(cross)}:${m}`, entry: 'overlap', t: cross, t0: (s?.from ?? from) - LEAD, t1: to + 0.8, players: [{ player: m, role: 'runner' }, { player: carrier, role: 'carrier' }],
        facts: [fact('side', side, 'tracking'), fact('peak_kmh', run.peak, 'tracking', 'km/h'), fact('metres', run.disp, 'tracking', 'm'), fact('received', received ? '是' : '否', 'rule')],
        draw: [draw.run(`run-${m}-${r1(s?.from ?? from)}`, m, s?.from ?? from, s?.to ?? to, [(s?.from ?? from) - LEAD, to + 0.8]), draw.spotlight(`spot-${carrier}-${r1(cross)}`, carrier, [cross - 1, cross + 0.5])],
        say: { neutral: `${n(m)} 从${side === '套边' ? '外侧' : '内侧'}${side}，时速 ${run.peak.toFixed(0)} 公里`, praise: `${n(m)} ${side}，时速 ${run.peak.toFixed(0)} 公里，给 ${n(carrier)} 一个向前的选择${received ? '，球也给到了' : ''}`,
          improve: received ? undefined : `如果 ${n(carrier)} 这时把球给${side}的 ${n(m)}，角度会更好` },
        salience: Math.min(1, 0.45 + (received ? 0.2 : 0) + run.peak / 150), confidence: 0.7,
        why: [`${n(m)} 在 ${cross.toFixed(1)} s 从 ${n(carrier)} 身后（x 差 < -1 m）跑到身前（> +1 m），横向差 ≤ 8 m，速度 ≥ 20 km/h；${side}（|y| ${Math.abs(pm[1]).toFixed(0)} 对 ${Math.abs(pc[1]).toFixed(0)}）`, `跑动 ${run.disp.toFixed(0)} m，峰值 ${run.peak.toFixed(0)} km/h；${received ? '接到了球' : '没接到球'}`],
      });
    }
  }
  return out;
}

// ---- 第三人跑位
export function thirdMan(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, passes = c.act.filter((a) => a.kind === 'pass' && a.to !== undefined && a.tTo !== undefined);
  for (let i = 0; i + 1 < passes.length; i++) {
    const p1 = passes[i], p2 = passes[i + 1];
    if (p2.player !== p1.to || p2.to === p1.player || p2.t - p1.tTo! > 1.5) continue;
    const C = p2.to!, s = runSpan(g, C, p1.t - 0.3, p2.tTo!); if (!s || s.from < p1.t - 0.5 || s.from > p1.tTo! + 0.5) continue;
    const a0 = g.pos(C, s.from)!, a1 = g.pos(C, p2.tTo!)!; if (a1[0] - a0[0] < 8) continue;
    const beaten = goalSide(g, p2.t, g.ball(p2.t)![0]).filter((p) => !new Set(goalSide(g, p2.tTo!, g.ball(p2.tTo!)![0])).has(p));
    const b0 = g.ball(p1.t)!, b1 = g.ball(p1.tTo!)!, b2 = g.ball(p2.t)!, b3 = g.ball(p2.tTo!)!;
    out.push({
      id: `third-man@${r2(p1.t)}:${C}`, entry: 'third-man', t: p1.t, t0: p1.t - LEAD, t1: p2.tTo! + 0.8, players: [{ player: C, role: 'runner' }, { player: p1.player, role: 'passer' }, { player: p2.player, role: 'passer' }],
      facts: [fact('release_s', p2.t - p1.tTo!, 'tracking', 's', 'B 接球到出球'), fact('run_start', s.from - p1.t, 'tracking', 's', 'C 起跑相对 A 的出球'), fact('forward_m', a1[0] - a0[0], 'tracking', 'm'), fact('beaten', beaten.length, 'tracking', '人')],
      draw: [draw.pass(`pass-${r1(p1.t)}`, [b0[0], b0[1]], [b1[0], b1[1]], p1.t, p1.tTo!, p1.peak ?? 0, [p1.t, p2.tTo! + 0.5]), draw.pass(`pass-${r1(p2.t)}`, [b2[0], b2[1]], [b3[0], b3[1]], p2.t, p2.tTo!, p2.peak ?? 0, [p2.t, p2.tTo! + 0.8]), draw.run(`run-${C}-${r1(s.from)}`, C, s.from, p2.tTo!, [p1.t - LEAD, p2.tTo! + 0.8])],
      say: { neutral: `${n(p1.player)} 传 ${n(p2.player)}，${n(p2.player)} ${p2.t - p1.tTo! < 0.3 ? '一脚' : `${(p2.t - p1.tTo!).toFixed(1)} 秒内`}再给已经起跑的 ${n(C)}：第三人跑位`, praise: `第三人跑位：防守盯着 ${n(p1.player)} 和 ${n(p2.player)}，${n(C)} 在第一脚传球飞行时就起跑，${n(p2.player)} ${p2.t - p1.tTo! < 0.3 ? '一脚' : '很快'}给了他`, improve: undefined },
      salience: Math.min(1, 0.65 + (p2.t - p1.tTo! <= 0.6 ? 0.1 : 0) + 0.05 * beaten.length), confidence: 0.75,
      why: [`A ${n(p1.player)} → B ${n(p2.player)}（${p1.t.toFixed(1)} s），B 在 ${(p2.t - p1.tTo!).toFixed(1)} s 内 → C ${n(C)}（阈值 1.5）`, `C 起跑 ${s.from.toFixed(1)} s，在第一脚传球 ${p1.t.toFixed(1)}–${p1.tTo!.toFixed(1)} s 之间；到接球前进 ${(a1[0] - a0[0]).toFixed(0)} m（阈值 8）`],
    });
  }
  return out;
}

export const DETECTORS = { blindSide, scanning, bodyShape, foot, halfSpaceRun, strikerWide, rotation, overlap, thirdMan, hookRun };
