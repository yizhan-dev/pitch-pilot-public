// The insight library's second batch (from the dictionary's brainstorm, docs/research/
// insight-dictionary.md §五): crosses and cut-backs with the box runners, runs timed on the offside line, the second
// ball, one-on-ones, the shooter's look at the keeper, no-look passes, an unpressured shot, a lost marker, and three
// 本场 habits (pressed receptions, one-touch play, the favourite pass pair). The keeper's state at the strike is a
// helper the outcome beat uses (plan.ts). Same contract as detect.ts: deterministic, thresholds in the open, the
// measured numbers in `why`, praise or "it would be better if ..." with the duty rule (criticism only on whoever was responsible).
import { fact, runSpan } from '../detect';
import { offsideX, goalSide, nearestOpp, dist, kmh, unitsAt, lineX, GOAL_X, type XY } from '../geom';
import { draw, LEAD, type DrawItem } from '../draw';
import type { Insight } from './types';
import { angDeg, HIP_BAND } from './skeleton';
import type { Profile } from './profile';
import type { Ctx } from './detect';
import type { Action } from '../types';

const r1 = (x: number) => +x.toFixed(1), r2 = (x: number) => +x.toFixed(2);
const n = (p: number) => `{n:${p}}`;
const inBox = (q: XY) => q[0] >= 36 && Math.abs(q[1]) <= 20.16;
const clockAt = (c: Ctx, t: number) => ((c.g.data.pkg as unknown as { clock0?: number }).clock0 ?? 0) + t;
const ballXY = (c: Ctx, t: number): XY | null => { const b = c.g.ball(t); return b ? [b[0], b[1]] : null; };
/** a pitch-point octagon of radius r round q, for a zone */
const octagon = (q: XY, r: number): XY[] => Array.from({ length: 8 }, (_, k) => [q[0] + r * Math.cos((k * Math.PI) / 4), q[1] + r * Math.sin((k * Math.PI) / 4)] as XY);

// ---- 传中与包抄 / 倒三角
type CrossKind = 'cut-back' | 'early' | 'byline' | 'cross';
const ZONE_ZH = { near: '前点', spot: '点球点', far: '后点', edge: '弧顶' } as const;
export function crossing(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  for (const a of c.act) {
    if (!(a.kind === 'pass' || a.kind === 'cross' || a.kind === 'lost') || a.tTo === undefined || a.player >= g.nAtt) continue;
    const b0 = g.ball(a.t), b1 = g.ball(a.tTo); if (!b0 || !b1) continue;
    const tagged = !!a.tags?.includes('Cross'), dx = b1[0] - b0[0];
    const cutBack = b0[0] >= 42 && Math.abs(b0[1]) >= 6 && b1[0] >= 33 && b1[0] <= 48 && Math.abs(b1[1]) <= 13 && dx <= -2 && (a.peak ?? 0) <= 1.5;
    const wideCross = Math.abs(b0[1]) >= 14 && b0[0] >= 28 && (tagged || inBox([b1[0], b1[1]]));
    if (!cutBack && !wideCross) continue;
    const kind: CrossKind = cutBack ? 'cut-back' : b0[0] < 40 ? 'early' : b0[0] >= 44 ? 'byline' : 'cross';
    const side = Math.sign(b0[1]) || 1, tA = Math.min(a.tTo, a.t + 1.5);
    // the box at the ball's arrival: who attacked which zone (a runner moved at 15 km/h or more in the 2 s before)
    const zoneOf = (q: XY): keyof typeof ZONE_ZH | null => {
      if (!inBox(q)) return q[0] >= 30 && Math.abs(q[1]) <= 12 ? 'edge' : null;
      if (q[0] >= 44.5) return q[1] * side >= 0 ? 'near' : 'far';
      return Math.abs(q[1]) <= 9.16 ? 'spot' : q[1] * side >= 0 ? 'near' : 'far';
    };
    const runners: { p: number; zone: keyof typeof ZONE_ZH; free: number }[] = [];
    let attIn = 0, defIn = 0;
    for (let p = 0; p < g.P; p++) {
      if (g.keepers.has(p)) continue;
      const q = g.pos(p, tA); if (!q) continue;
      if (inBox(q)) { if (p < g.nAtt) attIn++; else defIn++; }
      if (p >= g.nAtt || p === a.player) continue;
      let moved = false; for (let t = a.t - 2; t <= tA + 1e-6; t += 0.2) if (kmh(g.vel(p, t)) >= 15) { moved = true; break; }
      const z = zoneOf(q); if (!z || (!moved && z !== 'edge')) continue;
      runners.push({ p, zone: z, free: nearestOpp(g, p, tA)?.d ?? 99 });
    }
    const zones = new Set(runners.filter((r) => r.zone !== 'edge').map((r) => r.zone));
    // a teammate free near the penalty spot at the kick (for the cross-vs-cut-back what-if)
    let freeMate: { p: number; d: number } | null = null;
    if (kind !== 'cut-back') for (let p = 0; p < g.nAtt; p++) {
      if (p === a.player || g.keepers.has(p)) continue;
      const q = g.pos(p, a.t); if (!q || q[0] < 33 || q[0] > 46 || Math.abs(q[1]) > 12) continue;
      const d = nearestOpp(g, p, a.t)?.d ?? 0; if (d >= 3.5 && (!freeMate || d > freeMate.d)) freeMate = { p, d };
    }
    const received = a.kind === 'pass' && a.to !== undefined && a.to < g.nAtt;
    const recvFree = received ? nearestOpp(g, a.to!, a.tTo)?.d ?? 0 : 0;
    const kindZh = { 'cut-back': '倒三角回传', early: '早传中', byline: '下底传中', cross: '传中' }[kind];
    const roll = runners.filter((r) => r.zone !== 'edge' && !(a.kind === 'pass' && r.p === a.to)).sort((x, y) => ['near', 'spot', 'far'].indexOf(x.zone) - ['near', 'spot', 'far'].indexOf(y.zone));
    const rollZh = (['near', 'spot', 'far'] as const).map((z) => { const ps = roll.filter((r) => r.zone === z); return ps.length ? `${ZONE_ZH[z]} ${ps.map((r) => n(r.p)).join('、')}` : ''; }).filter(Boolean).join('；');
    const praise = kind === 'cut-back' && received ? `${n(a.player)} 沉底倒三角，${n(a.to!)} 在点球点一带，身边 ${recvFree.toFixed(0)} 米没人`
      : zones.size >= 3 ? `${roll.length} 人包抄：${rollZh}，三个点都有人` : zones.size === 2 && received ? `${kindZh}找到了 ${n(a.to!)}，包抄的有${rollZh}` : undefined;
    // (the alternative pass to a free mate is a what-if: the Tactics mode's, not Explain's; kept as a fact)
    const improve = kind !== 'cut-back' && zones.size <= 1 && defIn >= attIn + 2 ? `禁区里 ${attIn} 打 ${defIn}；如果${zones.has('far') ? '前点' : '后点'}再多一个人包抄，这脚${kindZh}就有落点` : undefined;
    const items: DrawItem[] = [draw.pass(`pass-${r1(a.t)}`, [b0[0], b0[1]], [b1[0], b1[1]], a.t, a.tTo, a.peak ?? 0, [a.t - 0.05, a.tTo + 0.8])];
    for (const r of roll.slice(0, 2)) { const s = runSpan(g, r.p, a.t, tA); items.push(draw.run(`run-${r.p}-${r1(a.t)}`, r.p, s?.from ?? a.t - 1.5, tA, [a.t - LEAD, a.tTo + 0.8])); }
    out.push({
      id: `crossing@${r2(a.t)}:${a.player}`, entry: 'crossing', t: a.t, t0: a.t - LEAD - 0.2, t1: a.tTo + 0.8, hold: praise || improve ? 1.4 : undefined,
      players: [{ player: a.player, role: 'passer' }, ...roll.map((r) => ({ player: r.p, role: 'runner' as const }))],
      facts: [fact('kind', kindZh, tagged ? 'opta' : 'tracking', '', tagged ? 'Opta 标为传中' : '几何判定'), fact('box', `${attIn} 打 ${defIn}`, 'tracking', '', '球到时禁区里进攻对防守的人数'), fact('zones', rollZh || '无', 'tracking', '', '包抄到的点（前点 / 点球点 / 后点）'),
        ...(a.xpass !== undefined ? [fact('xpass', a.xpass, 'opta')] : []), fact('received', received ? `{n:${a.to}}` : a.to !== undefined ? `被 {n:${a.to}} 截下` : '无', 'tracking'), ...(freeMate ? [fact('free_mate', `{n:${freeMate.p}}`, 'tracking', '', `出球时点球点一带无人盯的队友，身边 ${freeMate.d.toFixed(1)} m`)] : [])],
      draw: items.slice(0, 3),
      say: { neutral: `${n(a.player)} ${kindZh}，禁区里 ${attIn} 打 ${defIn}${rollZh ? `，包抄：${rollZh}` : ''}`, praise, improve },
      salience: Math.min(1, (praise || improve ? 0.55 : 0.25) + (kind === 'cut-back' && received ? 0.15 : 0) + (zones.size >= 3 ? 0.1 : 0)), confidence: tagged || kind === 'cut-back' ? 0.85 : 0.65,
      why: [`${a.t.toFixed(2)} s ${n(a.player)} 从 (${b0[0].toFixed(0)}, ${b0[1].toFixed(0)}) 出球到 (${b1[0].toFixed(0)}, ${b1[1].toFixed(0)})：${kindZh}${tagged ? '（Opta 传中）' : ''}`, `球到时（${tA.toFixed(1)} s）禁区 ${attIn} 打 ${defIn}；包抄：${rollZh || '无'}`, freeMate ? `出球时 ${n(freeMate.p)} 在点球点一带，最近对手 ${freeMate.d.toFixed(1)} m（≥ 3.5 算空位）` : '点球点一带没有空位的队友'],
    });
  }
  return out;
}

// ---- 反越位打身后: the receiver tight to the line at the kick, behind it at the reception (the law's body parts)
export function onsideRun(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  for (const a of c.act) {
    if (a.kind !== 'pass' || a.to === undefined || a.tTo === undefined || a.to >= g.nAtt || g.keepers.has(a.to)) continue;
    const tk = a.t, r = a.to;
    const frontOf = (p: number) => { const f = skel.ok ? skel.front(p, tk) : NaN; return Number.isFinite(f) ? f : g.pos(p, tk)?.[0] ?? NaN; };
    const defs: { p: number; x: number }[] = [];
    for (let p = g.nAtt; p < g.P; p++) { const x = frontOf(p); if (Number.isFinite(x)) defs.push({ p, x }); }
    if (defs.length < 2) continue;
    defs.sort((x, y) => y.x - x.x);
    const ballX = g.ball(tk)?.[0] ?? -Infinity, line = Math.max(defs[1].x, ballX, 0), setter = line === defs[1].x ? defs[1].p : null;
    const fr = frontOf(r), margin = line - fr, v = kmh(g.vel(r, tk)), q1 = g.pos(r, a.tTo);
    if (!Number.isFinite(margin) || margin < 0 || margin > 2.5 || v < 15 || !q1 || q1[0] < line + 3) continue;
    const s = runSpan(g, r, tk, a.tTo), b0 = g.ball(tk)!, b1 = g.ball(a.tTo)!;
    const tight = margin >= 0.3 && margin <= 1.2;
    out.push({
      id: `onside-run@${r2(tk)}:${r}`, entry: 'onside-run', t: tk, t0: tk - LEAD - 0.2, t1: a.tTo + 0.8, hold: 1.4,
      players: [{ player: r, role: 'runner' }, ...(setter !== null ? [{ player: setter, role: 'marker' as const }] : []), { player: a.player, role: 'passer' }],
      facts: [fact('margin_m', margin, 'tracking', 'm', '出球那一刻他最靠前的身体部位（不算手臂）离越位线的距离；跟踪误差约 0.3 m'), fact('kmh_at_kick', v, 'tracking', 'km/h', '出球那一刻他的速度'), fact('behind_m', q1[0] - line, 'tracking', 'm', '接球时超出那条线多少'), ...(setter !== null ? [fact('line_setter', `{n:${setter}}`, 'tracking', '', '定越位线的防守球员')] : [])],
      draw: [{ id: `offside-${r1(tk)}`, kind: 'offside', focus: r, at: r2(tk), window: { from: r2(tk - LEAD), to: r2(tk + 0.6) } } as DrawItem, draw.pass(`pass-${r1(tk)}`, [b0[0], b0[1]], [b1[0], b1[1]], tk, a.tTo, a.peak ?? 0, [tk - 0.05, a.tTo + 0.8]), draw.run(`run-${r}-${r1(s?.from ?? tk)}`, r, s?.from ?? tk - 1, a.tTo, [tk - LEAD, a.tTo + 0.8])],
      say: { neutral: `${n(r)} 出球时离越位线 ${margin.toFixed(1)} 米，已经在跑（${v.toFixed(0)} 公里），接球时超出 ${(q1[0] - line).toFixed(0)} 米`,
        praise: tight ? `${n(r)} 贴着越位线起跑：出球那一刻还差 ${margin.toFixed(1)} 米，球一出就冲到身后` : `${n(r)} 卡着越位线（差 ${margin.toFixed(1)} 米）提速，接球时已经超出防线 ${(q1[0] - line).toFixed(0)} 米`,
        improve: undefined },
      salience: Math.min(1, 0.55 + (tight ? 0.15 : 0) + (a === c.key ? 0.1 : 0)), confidence: margin >= 0.3 ? 0.8 : 0.5,
      why: [`出球 ${tk.toFixed(2)} s：越位线 x ${line.toFixed(1)}（${setter !== null ? `定线的是 ${n(setter)}` : '球或半场线'}），${n(r)} 身体最前 x ${fr.toFixed(1)}，差 ${margin.toFixed(2)} m（0–2.5 算贴线；< 0.3 m 在跟踪误差内，不说"差半米"）`, `出球时 ${v.toFixed(0)} km/h（≥ 15 算已经在跑）；接球时 x ${q1[0].toFixed(1)}，超出 ${(q1[0] - line).toFixed(1)} m（≥ 3）`],
    });
  }
  return out;
}

// ---- 第二落点: who reaches the loose ball after a clearance, a header, a block or a save
export function secondBall(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, all = c.all;
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i];
    // within the attack: a loose ball after its end (the shot, the loss) belongs to the next story
    if (a.t < c.t0 - 1 || a.t > c.t1 + 0.05) continue;
    const b = g.ball(a.t); if (!b) continue;
    const header = b[2] >= 1.6, loose = a.kind === 'clear' || a.kind === 'save' || header || (a.kind === 'lost' && a.player >= g.nAtt);
    if (!loose) continue;
    const nx = all[i + 1]; if (!nx || nx.t - a.t < 0.6 || nx.t - a.t > 4.5) continue;
    const land = ballXY(c, nx.t)!, from = ballXY(c, a.t)!; if (dist(land, from) < 8) continue;
    const winnerAtt = nx.player < g.nAtt;
    // at the clearance: each side's nearest outfield player to where it came down
    let na = { p: -1, d: Infinity }, nd = { p: -1, d: Infinity };
    for (let p = 0; p < g.P; p++) { if (g.keepers.has(p)) continue; const q = g.pos(p, a.t); if (!q) continue; const d = dist(q, land); if (p < g.nAtt) { if (d < na.d) na = { p, d }; } else if (d < nd.d) nd = { p, d }; }
    const byDef = a.player >= g.nAtt, what = a.kind === 'save' ? '扑救' : header ? '头球' : a.kind === 'clear' ? '解围' : '封堵';
    const cont = winnerAtt && c.act.some((x) => x.t > nx.t && x.kind === 'shot');
    // contested: a defender's touch with an attacker's shot within 1 s (an aerial duel both touch); nobody lost it
    const contested = !winnerAtt && c.act.some((x) => x.kind === 'shot' && x.t >= nx.t - 0.05 && x.t <= nx.t + 1.0);
    out.push({
      id: `second-ball@${r2(a.t)}:${nx.player}`, entry: 'second-ball', t: nx.t, t0: a.t - 0.3, t1: nx.t + 1.0, hold: winnerAtt === byDef ? 1.2 : undefined,
      players: [{ player: nx.player, role: winnerAtt ? 'receiver' : 'marker' }, { player: a.player, role: 'passer' }],
      facts: [fact('after', `${n(a.player)} ${what}`, 'tracking'), fact('winner', `{n:${nx.player}}（${winnerAtt ? 'A' : 'B'} 队）`, 'tracking'), fact('time_s', nx.t - a.t, 'tracking', 's'), fact('nearest_att_m', na.d, 'tracking', 'm', `落点最近的进攻球员 {n:${na.p}}`), fact('nearest_def_m', nd.d, 'tracking', 'm', `落点最近的防守球员 {n:${nd.p}}`), fact('leads_to_shot', cont ? '是' : '否', 'rule')],
      draw: [draw.zone(`land-${r1(a.t)}`, octagon(land, 4), [a.t - 0.2, nx.t + 1.0]), draw.spotlight(`spot-${nx.player}-${r1(nx.t)}`, nx.player, [nx.t - 0.6, nx.t + 0.9])],
      say: { neutral: `${n(a.player)} ${what}之后，第二落点被 ${n(nx.player)} 拿到`,
        praise: byDef && winnerAtt ? `${n(a.player)} ${what}出来，第二落点 ${n(nx.player)} 先到${cont ? '，A 队接着打出了射门' : '，进攻继续'}` : !byDef && !winnerAtt ? undefined : undefined,
        improve: byDef && !winnerAtt && !contested && na.d < 10 ? `${n(a.player)} ${what}后球落在 ${n(na.p)} 附近（${na.d.toFixed(0)} 米），如果他提前一步卡位，第二落点就是 A 队的` : undefined },
      salience: byDef && winnerAtt ? Math.min(1, 0.55 + (cont ? 0.2 : 0)) : byDef && !winnerAtt && !contested && na.d < 10 ? 0.45 : 0.2, confidence: 0.75,
      why: [`${a.t.toFixed(2)} s ${n(a.player)} ${what}（球高 ${b[2].toFixed(1)} m），${(nx.t - a.t).toFixed(1)} s 后 ${n(nx.player)} 在 (${land[0].toFixed(0)}, ${land[1].toFixed(0)}) 拿到${contested ? '；同一刻 A 队打出射门：空中争抢，不算谁丢了第二落点' : ''}`, `那一刻离落点最近：进攻 ${n(na.p)} ${na.d.toFixed(1)} m、防守 ${n(nd.p)} ${nd.d.toFixed(1)} m`],
    });
  }
  return out;
}

// ---- 单刀: an attacker on the ball with nobody between him and the goal but the keeper
export function oneOnOne(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  // his spells on the ball: from a reception (or the attack's start) to his next pass, shot or loss
  for (let i = 0; i < c.act.length; i++) {
    const a = c.act[i];
    if (a.kind !== 'pass' || a.to === undefined || a.tTo === undefined || a.to >= g.nAtt || g.keepers.has(a.to)) continue;
    const p = a.to, tStart = a.tTo, end = c.act.find((x) => x.player === p && x.t > tStart + 0.05 && (x.kind === 'pass' || x.kind === 'shot' || x.kind === 'cross' || x.kind === 'lost'));
    const tEnd = end ? end.t : Math.min(c.t1, tStart + 3);
    // a breakaway: on the ball (within 2.5 m of it), level with or beyond the last line (the second-last defender, the
    // keeper counted, at most 1 m ahead of him), within 28 m of the goal, nobody in the corridor to the goal
    let firstT: number | null = null, lastT = -1;
    for (let t = tStart; t <= tEnd + 1e-6; t += 0.1) {
      const q = g.pos(p, t), b = g.ball(t);
      const ok = !!q && !!b && dist(q, [b[0], b[1]]) <= 2.5 && Math.hypot(GOAL_X - q[0], q[1]) <= 28 && q[0] >= offsideX(g, t) - 1
        && goalSide(g, t, q[0] - 0.5).filter((d) => { const z = g.pos(d, t)!; const u = (z[0] - q[0]) / Math.max(1, GOAL_X - q[0]); const yLine = q[1] * (1 - u); return Math.abs(z[1] - yLine) <= 3 + 6 * u; }).length === 0;
      if (ok) { if (firstT === null) firstT = t; lastT = t; } else if (firstT !== null && lastT - firstT >= 0.8) break; else firstT = null;
    }
    if (firstT === null || lastT - firstT < 0.8) continue;
    const q0 = g.pos(p, firstT)!, k = g.defKeeper, kx0 = k >= 0 ? g.pos(k, firstT)?.[0] ?? GOAL_X : GOAL_X, kx1 = k >= 0 ? g.pos(k, tEnd)?.[0] ?? GOAL_X : GOAL_X;
    const chaser = nearestOpp(g, p, lastT), shotEnd = end?.kind === 'shot', saved = shotEnd && c.shot?.shooter === p && ((g.data.pkg as unknown as { meta: { real_outcome?: string } }).meta.real_outcome === 'saved');
    const kAdv = kx0 - kx1;
    out.push({
      id: `one-on-one@${r2(firstT)}:${p}`, entry: 'one-on-one', t: firstT, t0: firstT - 0.6, t1: tEnd + 0.6, hold: 1.4,
      players: [{ player: p, role: 'carrier' }, ...(k >= 0 ? [{ player: k, role: 'keeper' as const }] : []), ...(chaser ? [{ player: chaser.player, role: 'marker' as const }] : [])],
      facts: [fact('goal_m', Math.hypot(GOAL_X - q0[0], q0[1]), 'tracking', 'm', '单刀开始时离球门'), fact('seconds', lastT - firstT, 'tracking', 's', '面前只剩门将的时长'), ...(chaser ? [fact('chaser_m', chaser.d, 'tracking', 'm', `最近的追防 {n:${chaser.player}}`)] : []), fact('keeper_out_m', kAdv, 'tracking', 'm', '这段时间门将向前出击了多少'), fact('ended', shotEnd ? '射门' : end ? end.kind : '片段结束', 'rule')],
      draw: [draw.spotlight(`spot-${p}-${r1(firstT)}`, p, [firstT - 0.4, tEnd + 0.4]), ...(chaser ? [draw.marking(`mark-${p}-${r1(firstT)}`, p, lastT, [firstT, tEnd + 0.4])] : [])],
      say: { neutral: `${n(p)} 单刀：面前只剩门将，离球门 ${Math.hypot(GOAL_X - q0[0], q0[1]).toFixed(0)} 米`,
        praise: `${n(p)} 单刀！面前只剩门将${chaser ? `，身后 ${n(chaser.player)} 还差 ${chaser.d.toFixed(0)} 米` : ''}`,
        improve: saved && kAdv >= 3 ? `门将这段时间出来了 ${kAdv.toFixed(0)} 米；如果 ${n(p)} 早一步起脚，门将还来不及封角度` : undefined },
      salience: Math.min(1, 0.7 + (shotEnd ? 0.15 : 0)), confidence: 0.8,
      why: [`${firstT.toFixed(1)}–${lastT.toFixed(1)} s ${n(p)} 带球（球在 2.5 m 内），已平行或越过最后一条防线，离门 ≤ 28 m，他和球门之间的走廊里（3 m 起、向门口放宽）没有外场防守球员（≥ 0.8 s）`, chaser ? `最近的追防 ${n(chaser.player)} ${chaser.d.toFixed(1)} m` : '没有追防', `门将 x ${kx0.toFixed(1)} → ${kx1.toFixed(1)}`],
    });
  }
  return out;
}

// ---- 门将站定: the keeper at the strike, for the outcome beat (no beat of its own)
/** the keeper at the strike: set (at most 4.5 km/h at the contact, both feet down: a keeper's set step is about 1 m/s),
 *  still moving (7 km/h or more), or in between (no comment); his hips' band (the telestration's handover). Over the
 *  27 shot clips his speed at the contact runs 0 to 15 km/h */
export interface KeeperState { p: number; state: 'set' | 'moving' | 'between'; speed: number; ratio: number; band: string; inAir: boolean; depth: number }
export function keeperAt(c: Ctx, t: number): KeeperState | null {
  const { g, skel } = c, k = g.defKeeper; if (k < 0 || !skel.ok) return null;
  const speed = kmh(g.vel(k, t)), ratio = skel.hipRatio(k, t), air = skel.inAir(k, t), q = g.pos(k, t);
  if (!Number.isFinite(ratio) || !q) return null;
  const state = !air && speed <= 4.5 ? 'set' : air || speed >= 7 ? 'moving' : 'between';
  return { p: k, state, speed, ratio, band: HIP_BAND(ratio), inAir: air, depth: GOAL_X - q[0] };
}

// ---- 射门前看门将: head up and facing the goal in the 1.5 s before the strike
export function shooterLook(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c, sh = c.shot;
  if (!sh || !skel.ok || sh.header) return out;
  let run = 0, best: { from: number; to: number } | null = null, s0 = -1;
  for (let t = sh.t - 1.5; t <= sh.t - 0.25 + 1e-6; t += 0.04) {
    const q = g.pos(sh.shooter, t), pi = skel.pitch(sh.shooter, t), fa = skel.facing(sh.shooter, t);
    const ok = !!q && Number.isFinite(pi) && pi >= 0 && Number.isFinite(fa) && angDeg(fa, Math.atan2(-q[1], GOAL_X - q[0])) <= 40;
    if (ok) { if (run === 0) s0 = t; run++; if (run >= 5 && (!best || t - s0 > best.to - best.from)) best = { from: s0, to: t }; } else run = 0;
  }
  if (!best) return out;
  const before = sh.t - best.to;
  out.push({
    id: `shooter-look@${r2(best.from)}:${sh.shooter}`, entry: 'shooter-look', t: best.to, t0: best.from - 0.4, t1: sh.t, hold: 1.0,
    players: [{ player: sh.shooter, role: 'shooter' }, ...(g.defKeeper >= 0 ? [{ player: g.defKeeper, role: 'keeper' as const }] : [])],
    facts: [fact('look_s', best.to - best.from, 'tracking', 's', '抬头朝向球门的时长'), fact('before_s', before, 'tracking', 's', '最后一次抬头到起脚')],
    draw: [draw.spotlight(`spot-${sh.shooter}-${r1(best.from)}`, sh.shooter, [best.from - 0.3, sh.t])],
    say: { neutral: `${n(sh.shooter)} 起脚前 ${before.toFixed(1)} 秒抬头看了一眼球门`, praise: `${n(sh.shooter)} 起脚前 ${before.toFixed(1)} 秒抬头看了一眼门将的位置`, improve: undefined },
    salience: 0.5, confidence: 0.6,
    why: [`${best.from.toFixed(2)}–${best.to.toFixed(2)} s：头的俯仰 ≥ 0°（看球时 −30° 到 −60°）且脸朝球门 40° 以内，连续 ≥ 0.2 s`],
  });
  return out;
}

// ---- 不看人传球: the head up and turned 70 degrees or more away from where the pass went
export function noLook(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  if (!skel.ok) return out;
  for (const a of c.act) {
    if (a.kind !== 'pass' || a.to === undefined || a.tTo === undefined || a.to >= g.nAtt || (a.metres ?? 0) < 6 || g.keepers.has(a.player)) continue;
    const b0 = g.ball(a.t), b1 = g.ball(a.tTo); if (!b0 || !b1) continue;
    const dir = Math.atan2(b1[1] - b0[1], b1[0] - b0[0]);
    let worst = 0, up = true;
    for (let t = a.t - 0.12; t <= a.t + 1e-6; t += 0.04) { const fa = skel.facing(a.player, t), pi = skel.pitch(a.player, t); if (!Number.isFinite(fa) || !Number.isFinite(pi)) { up = false; break; } worst = Math.max(worst, angDeg(fa, dir)); if (pi < -15) up = false; }
    if (!up || worst < 70) continue;
    // did he see the receiver earlier: his face within 30 degrees of the receiver in the 3 s before
    let saw: number | null = null;
    for (let t = a.t - 0.3; t >= a.t - 3; t -= 0.04) { const fa = skel.facing(a.player, t), me = g.pos(a.player, t), q = g.pos(a.to, t); if (Number.isFinite(fa) && me && q && angDeg(fa, Math.atan2(q[1] - me[1], q[0] - me[0])) <= 30) { saw = a.t - t; break; } }
    out.push({
      id: `no-look@${r2(a.t)}:${a.player}`, entry: 'no-look', t: a.t, t0: a.t - 0.8, t1: a.tTo + 0.6, hold: 1.2,
      players: [{ player: a.player, role: 'passer' }, { player: a.to, role: 'receiver' }],
      facts: [fact('away_deg', worst, 'tracking', '°', '出脚时脸的朝向离传球方向的夹角'), ...(saw !== null ? [fact('saw_s', saw, 'tracking', 's', '之前最后一次看向接球人')] : [])],
      draw: [draw.pass(`pass-${r1(a.t)}`, [b0[0], b0[1]], [b1[0], b1[1]], a.t, a.tTo, a.peak ?? 0, [a.t - 0.05, a.tTo + 0.6]), draw.spotlight(`spot-${a.player}-${r1(a.t)}`, a.player, [a.t - 0.6, a.t + 0.6])],
      say: { neutral: `${n(a.player)} 不看人传球：出脚时脸偏开 ${worst.toFixed(0)}°，球给了 ${n(a.to)}`, praise: `${n(a.player)} 不看人传球${saw !== null ? `——${saw.toFixed(1)} 秒前他就看到了 ${n(a.to)}` : ''}，出脚时脸还朝着别处`, improve: undefined },
      salience: 0.6, confidence: 0.55,
      why: [`出脚前 0.12 s 内头抬着（俯仰 ≥ −15°），脸离传球方向至少 ${worst.toFixed(0)}°（阈值 70°）`, saw !== null ? `${saw.toFixed(1)} s 前他的脸在接球人 30° 以内` : '之前 3 s 没有正面看过接球人'],
    });
  }
  return out;
}

// ---- 无人封堵: the shot struck with nobody closing; the duty goes to whoever stood nearest when he got the ball
export function noPressure(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, sh = c.shot;
  if (!sh) return out;
  const now = nearestOpp(g, sh.shooter, sh.t); if (!now || now.d < 3) return out;
  const recv = [...c.act].reverse().find((x) => x.kind === 'pass' && x.to === sh.shooter && (x.tTo ?? 0) < sh.t);
  const tr = recv?.tTo ?? sh.t - 1.5, then = nearestOpp(g, sh.shooter, tr);
  const closed = then ? then.d - dist(g.pos(then.player, sh.t)!, g.pos(sh.shooter, sh.t)!) : 0;
  const duty = then && then.d <= 8 && closed < 1;
  out.push({
    id: `no-pressure@${r2(sh.t)}:${sh.shooter}`, entry: 'no-pressure', t: sh.t, t0: tr - 0.3, t1: sh.t, players: [{ player: sh.shooter, role: 'shooter' }, ...(then ? [{ player: then.player, role: 'marker' as const }] : [])],
    facts: [fact('nearest_m', now.d, 'tracking', 'm', `起脚时离他最近的防守球员 {n:${now.player}}`), fact('time_s', sh.t - tr, 'tracking', 's', '接球到起脚'), ...(then ? [fact('closed_m', closed, 'tracking', 'm', `{n:${then.player}} 在这段时间里向他靠近了多少`)] : [])],
    draw: [draw.spotlight(`spot-${sh.shooter}-${r1(sh.t)}`, sh.shooter, [tr - 0.3, sh.t])],
    say: { neutral: `${n(sh.shooter)} 起脚时最近的防守球员在 ${now.d.toFixed(0)} 米外`, praise: `${n(sh.shooter)} 有 ${(sh.t - tr).toFixed(1)} 秒、${now.d.toFixed(0)} 米的空间从容起脚`,
      improve: duty ? `${n(then!.player)} 在他接球时离他 ${then!.d.toFixed(0)} 米，之后没有上前；如果早一步封堵，这脚射门就没那么舒服` : undefined },
    salience: Math.min(1, 0.45 + (now.d >= 5 ? 0.1 : 0) + (duty ? 0.1 : 0)), confidence: 0.8,
    why: [`起脚 ${sh.t.toFixed(2)} s 最近防守 ${n(now.player)} ${now.d.toFixed(1)} m（≥ 3 m 算无人封堵）`, then ? `接球（${tr.toFixed(2)} s）时最近的是 ${n(then.player)}，${then.d.toFixed(1)} m，之后向他靠近 ${closed.toFixed(1)} m（≤ 8 m 且靠近 < 1 m：他该上前）` : '接球时附近没人'],
  });
  return out;
}

// ---- 漏人 / 交接失败: a receiver free at the reception who had a marker 2.5 s before
export function lostMarker(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c;
  for (const a of c.act) {
    if (a.kind !== 'pass' || a.to === undefined || a.tTo === undefined || a.to >= g.nAtt || g.keepers.has(a.to)) continue;
    const r = a.to, tr = a.tTo, q = g.pos(r, tr); if (!q || q[0] < 17.5) continue;
    const free = nearestOpp(g, r, tr); if (!free || free.d < 3.5) continue;
    const t0 = tr - 2.5, m0 = nearestOpp(g, r, t0); if (!m0 || m0.d > 3 || nearestOpp(g, m0.player, t0)?.player !== r) continue;
    // released: the first moment the gap grows past 4 m; who stood nearest him then (the handover)
    let rel: number | null = null; for (let t = t0; t <= tr + 1e-6; t += 0.1) { const a1 = g.pos(m0.player, t), b1 = g.pos(r, t); if (a1 && b1 && dist(a1, b1) > 4) { rel = t; break; } }
    if (rel === null) continue;
    let d2: { p: number; d: number } | null = null;
    for (let p = g.nAtt; p < g.P; p++) { if (p === m0.player || g.keepers.has(p)) continue; const z = g.pos(p, rel), b1 = g.pos(r, rel); if (z && b1) { const d = dist(z, b1); if (d <= 6 && (!d2 || d < d2.d)) d2 = { p, d }; } }
    let picked = false; if (d2) for (let t = rel; t <= tr + 1e-6; t += 0.1) { const z = g.pos(d2.p, t), b1 = g.pos(r, t); if (z && b1 && dist(z, b1) <= 3) { picked = true; break; } }
    if (picked) continue;
    const duty = d2 ? 'handover' : 'lost';
    out.push({
      id: `lost-marker@${r2(rel)}:${r}`, entry: 'lost-marker', t: tr, t0: t0, t1: tr + 0.8, hold: 1.2,
      players: [{ player: r, role: 'receiver' }, { player: m0.player, role: 'marker' }, ...(d2 ? [{ player: d2.p, role: 'marker' as const }] : [])],
      facts: [fact('free_m', free.d, 'tracking', 'm', '接球时离他最近的对手'), fact('marker', `{n:${m0.player}}`, 'tracking', '', `${t0.toFixed(1)} s 时盯着他（${m0.d.toFixed(1)} m，互为最近）`), fact('released_s', rel, 'tracking', 's', '两人拉开到 4 m 以上的时刻'), fact('handover', d2 ? `{n:${d2.p}}（${d2.d.toFixed(1)} m，没接上）` : '无人', 'tracking')],
      draw: [draw.marking(`mark-${r}-${r1(t0)}`, r, t0, [t0, rel + 0.6]), draw.spotlight(`spot-${r}-${r1(tr)}`, r, [rel, tr + 0.8])],
      say: { neutral: `${n(r)} 接球时身边 ${free.d.toFixed(0)} 米没人：2.5 秒前盯他的是 ${n(m0.player)}`,
        praise: `${n(r)} 甩开了 ${n(m0.player)}，接球时身边 ${free.d.toFixed(0)} 米没人`,
        improve: duty === 'handover' ? `${n(m0.player)} 把 ${n(r)} 交了出去，${n(d2!.p)} 就在 ${d2!.d.toFixed(0)} 米外却没接上；如果交接时喊一声、跟一步，会更好` : `${n(m0.player)} 跟丢了 ${n(r)}，身边也没人补；如果他多跟一步，会更好` },
      salience: Math.min(1, 0.5 + (a === c.key ? 0.15 : 0) + (free.d >= 5 ? 0.1 : 0)), confidence: 0.6,
      why: [`${t0.toFixed(1)} s ${n(m0.player)} 和 ${n(r)} 互为最近（${m0.d.toFixed(1)} m）；${rel.toFixed(1)} s 拉开到 4 m 以上`, d2 ? `那一刻 ${n(d2.p)} 离 ${n(r)} ${d2.d.toFixed(1)} m，到接球都没靠近到 3 m：交接没接上` : '那一刻 6 m 内没有别的防守球员：他跟丢了', `接球（${tr.toFixed(2)} s）时最近对手 ${free.d.toFixed(1)} m（≥ 3.5）`],
    });
  }
  return out;
}

// ---- 本场习惯: pressed receptions, one-touch play, the favourite pass pair
function profileRecs(pr: Profile | null, pid: string) { return pr ? pr.receptions.filter((r) => r.pid === pid) : []; }
export function pressedHabit(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, pr = c.profile;
  if (!pr) return out;
  const evById = new Map(pr.events.map((e) => [e.i, e]));
  const seen = new Set<number>();
  for (const a of c.act) {
    if (a.kind !== 'pass' || a.to === undefined || a.tTo === undefined || a.to >= g.nAtt || seen.has(a.to)) continue;
    const r = a.to, near = nearestOpp(g, r, a.tTo); if (!near || near.d > 2) continue;
    const pl = c.players[r]; if (!pl) continue;
    const recs = profileRecs(pr, pl.pid).filter((x) => x.nearest !== null && x.nearest <= 2);
    if (recs.length < 6) continue;
    const kept = recs.filter((x) => evById.get(x.i)?.ok !== false).length, share = kept / recs.length;
    const nx = c.act.find((x) => x.player === r && x.t > a.tTo! + 0.05), keptNow = !!nx && nx.kind !== 'lost';
    if (!(share >= 0.75 && keptNow) && !(share <= 0.45 && !keptNow)) continue;
    seen.add(r);
    out.push({
      id: `pressed-habit@${r2(a.tTo)}:${r}`, entry: 'pressed-habit', t: a.tTo, t0: a.tTo - 0.6, t1: a.tTo + 1.2, players: [{ player: r, role: 'receiver' }, { player: near.player, role: 'marker' }],
      facts: [fact('pressed_now_m', near.d, 'tracking', 'm', '这次接球时贴身的对手'), fact('pressed_kept', `${kept} / ${recs.length}`, 'tracking', '', '本场贴身（≤ 2 m）接球后护住球的次数')],
      draw: [{ id: `press-${r}-${r1(a.tTo)}`, kind: 'pressure', carrier: r, at: r2(a.tTo), window: { from: r2(a.tTo - 0.6), to: r2(a.tTo + 1.2) } } as DrawItem],
      say: { neutral: `${n(r)} 本场 ${recs.length} 次贴身受压接球，${kept} 次护住了`, praise: share >= 0.75 ? `${n(r)} 又一次顶着贴身的 ${n(near.player)} 护住球——本场 ${recs.length} 次贴身接球，${kept} 次没丢` : undefined,
        improve: share <= 0.45 ? `${n(r)} 本场贴身接球 ${recs.length} 次只护住 ${kept} 次；如果接球前先用身体卡住位置，会更好` : undefined },
      salience: 0.45, confidence: 0.7,
      why: [`接球 ${a.tTo.toFixed(2)} s，${n(near.player)} 贴身 ${near.d.toFixed(1)} m`, `全场档案：他贴身（≤ 2 m）接球 ${recs.length} 次，下一步成功 ${kept} 次（${Math.round(share * 100)}%；≥ 75% 夸，≤ 45% 建议）`],
    });
  }
  return out;
}

export function oneTouch(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, pr = c.profile;
  if (!pr) return out;
  const evById = new Map(pr.events.map((e) => [e.i, e]));
  const seen = new Set<number>();
  for (let i = 1; i < c.act.length; i++) {
    const a = c.act[i], prev = c.act[i - 1];
    if (a.kind !== 'pass' || prev.kind !== 'pass' || prev.to !== a.player || prev.tTo === undefined || Math.abs(a.t - prev.tTo) > 0.25 || seen.has(a.player) || a.player >= g.nAtt) continue;
    const pl = c.players[a.player]; if (!pl) continue;
    const recs = profileRecs(pr, pl.pid); if (recs.length < 15) continue;
    const ones = recs.filter((x) => { const e = evById.get(x.i); return x.next === 'Pass' && e && Math.abs(e.t - x.t) <= 0.25; }).length;
    if (ones / recs.length < 0.25) continue;
    seen.add(a.player);
    const b0 = g.ball(a.t)!, b1 = a.tTo !== undefined ? g.ball(a.tTo) : null;
    out.push({
      id: `one-touch@${r2(a.t)}:${a.player}`, entry: 'one-touch', t: a.t, t0: a.t - 0.6, t1: (a.tTo ?? a.t) + 0.6, players: [{ player: a.player, role: 'passer' }, ...(a.to !== undefined ? [{ player: a.to, role: 'receiver' as const }] : [])],
      facts: [fact('one_touch', `${ones} / ${recs.length}`, 'tracking', '', '本场接球后一脚出球的次数')],
      draw: b1 ? [draw.pass(`pass-${r1(a.t)}`, [b0[0], b0[1]], [b1[0], b1[1]], a.t, a.tTo!, a.peak ?? 0, [a.t - 0.05, a.tTo! + 0.6])] : [],
      say: { neutral: `${n(a.player)} 一脚出球`, praise: `${n(a.player)} 一脚出球——本场 ${recs.length} 次接球，${ones} 次是一脚处理`, improve: undefined },
      salience: 0.42, confidence: 0.7,
      why: [`${prev.tTo.toFixed(2)} s 接球、${a.t.toFixed(2)} s 出球（≤ 0.25 s：一脚）`, `全场档案：${recs.length} 次接球里 ${ones} 次一脚出球（≥ 15 次接球、≥ 25% 才讲；本场多数球员在 5–20%）`],
    });
  }
  return out;
}

export function passPair(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, P = c.passes;
  if (!P) return out;
  const said = new Set<string>();
  for (const a of c.act) {
    if (a.kind !== 'pass' || a.to === undefined || a.to >= g.nAtt) continue;
    const A = c.players[a.player], B = c.players[a.to]; if (!A || !B) continue;
    const key = [A.pid, B.pid].sort().join('|'); if (said.has(key)) continue;
    const clk = clockAt(c, a.t);
    const half = (g.data.pkg.meta as unknown as { half: number }).half;
    const before = (q: { half: number; clock: number }) => q.half < half || (q.half === half && q.clock < clk);
    const pairs = new Map<string, number>();
    for (const q of P) { if (!before(q) || !q.ok || !q.to || q.toHome !== q.home) continue; if (q.from !== A.pid && q.to !== A.pid) continue; const other = q.from === A.pid ? q.to : q.from; pairs.set(other, (pairs.get(other) ?? 0) + 1); }
    const k = pairs.get(B.pid) ?? 0, rank = [...pairs.values()].filter((v) => v > k).length + 1;
    if (k < 6 || rank > 2) continue;
    said.add(key);
    out.push({
      id: `pass-pair@${r2(a.t)}:${a.player}`, entry: 'pass-pair', t: a.t, t0: a.t - 0.4, t1: a.t + 1.6, hold: 1.6, players: [{ player: a.player, role: 'passer' }, { player: a.to, role: 'receiver' }],
      facts: [fact('exchanges', k, 'opta', '次', '此前本场两人互相成功传球的次数'), fact('rank', rank, 'opta', '', `在 {n:${a.player}} 的搭档里排第几`)],
      draw: [{ id: `net-${a.player}-${r1(a.t)}`, kind: 'network', mode: 'chemistry', focus: a.player, at: r2(a.t) } as DrawItem],
      say: { neutral: `${n(a.player)} 和 ${n(a.to)} 本场已经互传 ${k} 次`, praise: `又是这一对：${n(a.player)} 和 ${n(a.to)} 本场已经互传 ${k} 次，是 ${n(a.player)} ${rank === 1 ? '最常找' : '第二常找'}的搭档`, improve: undefined },
      salience: 0.4 + Math.min(0.15, k / 100), confidence: 0.9,
      why: [`passes.json：此前两人互相成功传球 ${k} 次（≥ 6），在 ${n(a.player)} 的搭档里排第 ${rank}（≤ 2）`],
    });
  }
  return out;
}

// ---- 防线被扯开: a back-line defender steps out (4 m or more in front of the rest of the line), and within 3 s an
// attacker runs, or the ball goes, into the space behind where he stood. Stepping out to press is often right; the
// duty is the cover's: did the neighbouring defender slide across?
export function jumpedLine(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, seen = new Set<number>();
  for (let t = c.t0; t <= c.t1 + 1e-6; t += 0.2) {
    const u = unitsAt(g, 'def', t), back = u.back.filter((p) => !g.keepers.has(p));
    if (back.length < 3) continue;
    for (const d of back) {
      if (seen.has(d)) continue;
      const q = g.pos(d, t); if (!q) continue;
      const others = back.filter((x) => x !== d), L = lineX(g, others, t)(q[1]);
      const step = L - q[0];
      if (!Number.isFinite(step) || step < 4 || g.vel(d, t)[0] > -0.5) continue;      // in front of the line and moving out
      // the hole: behind where the line would have him, across his lane
      const hole = (z: XY) => z[0] >= L - 2 && z[0] <= L + 14 && Math.abs(z[1] - q[1]) <= 7;
      let into: { p: number; t: number; ball: boolean } | null = null;
      for (let tt = t; tt <= Math.min(c.t1, t + 3) + 1e-6 && !into; tt += 0.1) {
        const b = g.ball(tt); if (b && hole([b[0], b[1]]) && c.act.some((a) => a.kind === 'pass' && a.tTo !== undefined && Math.abs(a.tTo - tt) < 0.15 && a.to !== undefined && a.to < g.nAtt)) { into = { p: -1, t: tt, ball: true }; break; }
        for (let p = 0; p < g.nAtt; p++) { const z = g.pos(p, tt); if (z && hole(z) && kmh(g.vel(p, tt)) >= 15 && (g.pos(p, t)?.[0] ?? 99) < L - 2) { into = { p, t: tt, ball: false }; break; } }
      }
      if (!into) continue;
      seen.add(d);
      // the cover: the back-line neighbour nearest his lane; did he slide 2 m or more towards it
      let cover: { p: number; slid: number } | null = null;
      for (const o of others) { const a0 = g.pos(o, t), a1 = g.pos(o, into.t); if (!a0 || !a1) continue; const slid = Math.abs(a0[1] - q[1]) - Math.abs(a1[1] - q[1]); if (!cover || Math.abs(a0[1] - q[1]) < Math.abs((g.pos(cover.p, t) ?? a0)[1] - q[1])) cover = { p: o, slid }; }
      const covered = !!cover && cover.slid >= 2;
      const runner = into.p >= 0 ? into.p : c.act.find((a) => a.kind === 'pass' && a.tTo !== undefined && Math.abs(a.tTo - into!.t) < 0.15)?.to ?? null;
      out.push({
        id: `jumped-line@${r2(t)}:${d}`, entry: 'jumped-line', t, t0: t - 0.6, t1: into.t + 1.0, hold: 1.4,
        players: [{ player: d, role: 'marker' }, ...(runner !== null ? [{ player: runner, role: 'runner' as const }] : []), ...(cover ? [{ player: cover.p, role: 'marker' as const }] : [])],
        facts: [fact('step_m', step, 'tracking', 'm', '他比防线其余人靠前多少'), fact('exploited_s', into.t - t, 'tracking', 's', into.ball ? '球进入他身后的空当' : `{n:${into.p}} 跑进他身后的空当`), ...(cover ? [fact('cover_slid_m', cover.slid, 'tracking', 'm', `相邻的 {n:${cover.p}} 向空当横移了多少`)] : [])],
        draw: [draw.units(`units-${r1(t)}`, t, t - 0.6, into.t + 0.3), draw.zone(`hole-${r1(t)}`, [[L - 2, q[1] - 7], [L + 14, q[1] - 7], [L + 14, q[1] + 7], [L - 2, q[1] + 7]], [t, into.t + 1.0]), ...(runner !== null ? [draw.spotlight(`spot-${runner}-${r1(into.t)}`, runner, [into.t - 0.5, into.t + 1.0])] : [])],
        say: { neutral: `${n(d)} 前出 ${step.toFixed(0)} 米，${into.ball ? '球' : n(into.p)} ${(into.t - t).toFixed(1)} 秒后进了他身后的空当`,
          praise: runner !== null ? `${n(d)} 被吸出来 ${step.toFixed(0)} 米，${n(runner)} 立刻钻进他身后的空当` : undefined,
          improve: cover && !covered ? `${n(d)} 前出抢断，身后空了；如果 ${n(cover.p)} 及时横移补上，这个空当就不会被利用` : undefined },
        salience: Math.min(1, 0.5 + (into.t - t <= 1.5 ? 0.1 : 0) + (runner !== null && c.act.some((a) => a.kind === 'shot' && a.t > into!.t && a.t - into!.t < 6) ? 0.15 : 0)), confidence: 0.55,
        why: [`${t.toFixed(1)} s ${n(d)} 比后卫线其余人靠前 ${step.toFixed(1)} m（≥ 4）且正在前出`, `${into.t.toFixed(1)} s ${into.ball ? '一脚传球的落点' : `${n(into.p)}（≥ 15 km/h）`} 进了他身后的空当（线后 −2 到 14 m、横向 ±7 m）`, cover ? `相邻的 ${n(cover.p)} 向空当横移 ${cover.slid.toFixed(1)} m（≥ 2 算补上）：${covered ? '补上了，不批评' : '没补上'}` : '没有相邻的后卫'],
      });
    }
  }
  return out;
}

// ---- 举手要球 (a raised hand: actively asking for the ball, as Lowe at 15:53): an attacker off the ball
// with a wrist above his nose for 0.3 to 2 s, no opponent within 5 m; the more space round him, and a ball that then comes to him, the more
// it matters. The skeleton shows the arm; what it means is the read every viewer makes of a raised arm, so it is said.
export function handUp(c: Ctx): Insight[] {
  const out: Insight[] = [], { g, skel } = c;
  if (!skel.ok) return out;
  for (let p = 0; p < g.nAtt; p++) {
    if (g.keepers.has(p)) continue;
    let run = 0, s0 = -1;
    const spans: { from: number; to: number }[] = [];
    for (let t = c.t0; t <= c.t1 + 1e-6; t += 0.04) {
      const q = g.pos(p, t), b = g.ball(t), nose = skel.joint(p, 'nose', t), l = skel.joint(p, 'lWrist', t), r = skel.joint(p, 'rWrist', t);
      const off = !!q && !!b && Math.hypot(q[0] - b[0], q[1] - b[1]) > 3;
      const up = off && !!nose && ((!!l && l[2] > nose[2]) || (!!r && r[2] > nose[2]));
      if (up) { if (run === 0) s0 = t; run++; } else { if (run * 0.04 >= 0.3) spans.push({ from: s0, to: t - 0.04 }); run = 0; }
    }
    if (run * 0.04 >= 0.3) spans.push({ from: s0, to: c.t1 });
    for (const sp of spans) {
      const mid = (sp.from + sp.to) / 2, near = nearestOpp(g, p, mid);
      // asking for it means being free (5 m), and briefly: a long raised arm is an appeal or a protest
      if (!near || near.d < 5 || sp.to - sp.from > 2.0) continue;
      const got = c.act.find((a) => a.kind === 'pass' && a.to === p && a.t >= sp.from - 0.5 && a.t <= sp.to + 6);
      const free = near ? near.d : 99;
      out.push({
        id: `hand-up@${r2(sp.from)}:${p}`, entry: 'hand-up', t: mid, t0: sp.from - 0.3, t1: sp.to + 0.3, hold: 1.0,
        players: [{ player: p, role: 'runner' }],
        facts: [fact('up_s', sp.to - sp.from, 'tracking', 's', '手腕高过头顶的时长'), fact('nearest_m', free, 'tracking', 'm', '举手时离最近的对手'), fact('received', got ? '是' : '否', 'tracking', undefined, got ? `${(got.t - sp.from).toFixed(1)} s 后球来了` : '球没有来')],
        draw: [draw.spotlight(`spot-${p}-${r1(sp.from)}`, p, [sp.from - 0.3, sp.to + 0.3])],
        say: { neutral: `${n(p)} 举手要球`, praise: `${n(p)} 身边 ${Math.round(free)} 米没人，举手要球${got ? '，球很快就来了' : ''}`, improve: undefined },
        salience: Math.min(0.85, 0.4 + (got ? 0.2 : 0) + (free >= 10 ? 0.15 : free >= 5 ? 0.05 : 0)), confidence: Math.min(1, 0.5 + (sp.to - sp.from)),
        why: [`${sp.from.toFixed(2)}–${sp.to.toFixed(2)} s：无球（离球 > 3 m），一只手腕高过鼻子，连续 ≥ 0.3 s`, `离最近的对手 ${free.toFixed(1)} m${got ? `；${got.t.toFixed(2)} s 球传给了他` : ''}`],
      });
    }
  }
  return out;
}

// ---- 交叉换位 (a lane swap, as at 15:53: after it the receiver takes the ball in the wing area, so he cannot be said
// to be in the half-space): two attackers swap lanes within 4 s — one from inside to outside, the other from outside to inside,
// their distances from the centre line crossing, each changing lane (the outside one ending where the other began),
// each moving 6 m or more across, within 12 m of each other, outside the central lane
export function laneSwap(c: Ctx): Insight[] {
  const out: Insight[] = [], { g } = c, seen = new Set<string>();
  const ay = (p: number, t: number) => { const q = g.pos(p, t); return q ? Math.abs(q[1]) : NaN; };
  for (let a = 0; a < g.nAtt; a++) for (let b = a + 1; b < g.nAtt; b++) {
    if (g.keepers.has(a) || g.keepers.has(b)) continue;
    for (let t = c.t0 + 2; t <= c.t1 - 2 + 1e-6; t += 0.2) {
      const d0 = ay(a, t - 2) - ay(b, t - 2), d1 = ay(a, t + 2) - ay(b, t + 2);
      if (!Number.isFinite(d0) || !Number.isFinite(d1) || Math.sign(d0) === Math.sign(d1) || Math.abs(d0) < 3 || Math.abs(d1) < 3) continue;
      const out1 = d0 < 0 ? a : b, in1 = out1 === a ? b : a;          // the one inside first goes out
      const mvOut = ay(out1, t + 2) - ay(out1, t - 2), mvIn = ay(in1, t - 2) - ay(in1, t + 2);
      const qa = g.pos(a, t), qb = g.pos(b, t);
      if (mvOut < 6 || mvIn < 6 || !qa || !qb || Math.hypot(qa[0] - qb[0], qa[1] - qb[1]) > 12) continue;
      // a real swap of lanes, away from the centre: each ends in the lane the other started in (or the next one out
      // for the one going wide), and they cross outside the central lane
      const lane = (p: number, u: number) => { const y = ay(p, u); return y <= 9.16 ? 0 : y <= 20.16 ? 1 : 2; };
      const o0 = lane(out1, t - 2), o1 = lane(out1, t + 2), i0 = lane(in1, t - 2), i1 = lane(in1, t + 2);
      if (!(o1 > o0 && i1 < i0 && o1 >= i0 && i1 <= o0) || (ay(a, t) + ay(b, t)) / 2 <= 9.16) continue;
      // the moment their lanes cross, to 0.04 s
      let tc = t - 2;
      for (let u = t - 2; u <= t + 2; u += 0.04) if (Math.sign(ay(a, u) - ay(b, u)) === Math.sign(d1)) { tc = u; break; }
      const key = `${a}-${b}`; if (seen.has(key)) break; seen.add(key);
      // did the outward runner take his marker with him (the same nearest opponent, staying within 4.5 m)
      const m0 = nearestOpp(g, out1, tc - 1.5), m1 = nearestOpp(g, out1, tc + 1);
      const took = !!m0 && !!m1 && m0.player === m1.player && m1.d <= 4.5;
      const got = c.act.find((x) => x.kind === 'pass' && x.to === in1 && x.t >= tc - 1 && x.t <= tc + 4);
      out.push({
        id: `lane-swap@${r2(tc)}:${in1}`, entry: 'lane-swap', t: tc, t0: tc - 2, t1: tc + 2, hold: 1.0,
        players: [{ player: in1, role: 'runner' }, { player: out1, role: 'decoy' }, ...(took ? [{ player: m0!.player, role: 'marker' as const }] : [])],
        facts: [fact('cross_t', tc, 'tracking', 's', '两人横向位置交叉的时刻'), fact('out_m', mvOut, 'tracking', 'm', `${n(out1)} 往外拉`), fact('in_m', mvIn, 'tracking', 'm', `${n(in1)} 往里插`), fact('marker_followed', took ? `${n(m0!.player)}` : '否', 'tracking'), fact('received', got ? '是' : '否', 'tracking')],
        draw: [{ id: `trail-${out1}-${r1(tc)}`, kind: 'trail', player: out1, window: { from: +(tc - 1.6).toFixed(2), to: +(tc + 0.6).toFixed(2) } } as DrawItem, { id: `trail-${in1}-${r1(tc)}`, kind: 'trail', player: in1, window: { from: +(tc - 1.6).toFixed(2), to: +(tc + 0.6).toFixed(2) } } as DrawItem],
        say: { neutral: `${n(out1)} 和 ${n(in1)} 交叉换位：${n(out1)} 往外拉，${n(in1)} 往里插`, praise: `${n(out1)} 往边路拉${took ? `，把 ${n(m0!.player)} 也带走了` : ''}，${n(in1)} 趁机插进他让出的通道`, improve: undefined },
        salience: Math.min(0.85, 0.5 + (took ? 0.15 : 0) + (got ? 0.15 : 0)), confidence: Math.min(1, 0.5 + Math.min(mvOut, mvIn) / 20),
        why: [`${(tc - 2).toFixed(1)}–${(tc + 2).toFixed(1)} s：${n(out1)} 离中线 +${mvOut.toFixed(1)} m，${n(in1)} −${mvIn.toFixed(1)} m，${tc.toFixed(2)} s 交叉`, took ? `${n(m0!.player)} 跟着 ${n(out1)} 走（${m1!.d.toFixed(1)} m）` : '没人跟着往外拉的人'],
      });
      break;
    }
  }
  return out;
}

export const DETECTORS2 = { crossing, onsideRun, secondBall, oneOnOne, shooterLook, noLook, noPressure, lostMarker, pressedHabit, oneTouch, passPair, jumpedLine, handUp, laneSwap };
export type { Action };
