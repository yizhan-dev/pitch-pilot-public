// The orchestrator: a clip in, a plan of beats out (docs/plans/orchestrator-notes.md). `orchestrate` runs the
// detection (detect.ts), turns each finding into a candidate beat with its facts, drawings and a salience, keeps the
// ones that matter within the clip's budget, and checks the clutter budget over the timeline the narration will play.
// `toCues` compiles the plan to the narration's cue format (src/explain/script.ts), without text: the
// narration writes the lines on these cues (or its own, pinned to touches) and keeps the direction.
import type { Loaded } from '../data';
import type { Cue } from '../explain/script';
import { analyse, linesBroken, runOf, runSpan, spaceOf, beatenBy, decoysFor, kmhOfKick, fact, RULES, type Models, type Analysis } from './detect';
import { offsideX, dist, type XY } from './geom';
import { xgFreeze } from '../response/xg';
import { passChance } from '../three/telestration/network';
import { draw, span, MAX_ITEMS, LEAD, EXIT, PRIO, type DrawItem } from './draw';
import type { Beat, Plan, Story, Action, Fact, Actor } from './types';
import { detectInsights, runsIn, type Ctx } from './insights/all';
import { keeperAt } from './insights/detect2';
import { makeSkel } from './insights/skeleton';
import type { Profile } from './insights/profile';
import type { MatchPass } from '../three/telestration/network';
import { ENTRY } from './insights/catalogue';

export type { Models } from './detect';

/** beats below this salience are dropped (the intro, the shot and the outcome are always kept) */
const CUT = 0.35;
/** at most this many beats in a clip, the intro and the outcome included (10 since the insight library) */
const MAX_BEATS = 10;
/** a held beat's length: about one line of reading, 2.5 to 3.5 s */
const HOLD = { shot: 3.0, whatif: 3.6, key: 3.0 };

const r2 = (x: number) => +x.toFixed(2);
const pct = (x: number) => Math.round(x * 100);

function hullArea(pts: XY[]): number {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (s.length < 3) return 0;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XY[] = [], hi: XY[] = [];
  for (const p of s) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...s].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const h = [...lo.slice(0, -1), ...hi.slice(0, -1)];
  let a = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

const START_ZH = (x: number, keeper: boolean) => (keeper ? '从门将' : x < -17.5 ? '从后场' : x < 0 ? '从本方半场' : x < 17.5 ? '从中场' : '在对方禁区前沿');
const END_ZH: Record<Story['end'], string> = { goal: '进球', saved: '射门被扑', missed: '射偏', blocked: '射门被封堵', post: '击中门框', lost: '丢了球权', 'cross-cleared': '传中被解围', other: '结束' };

/** the plan of one clip */
/** options: `whatIf` adds the "what could have been" beats (the better-placed teammate, the better option to a
 *  low-percentage pass). Off for Explain (the what-if belongs to the Tactics mode, not the explanation); the
 *  detection stays for the Tactics tab */
export interface PlanOptions { whatIf?: boolean }

export function orchestrate(data: Loaded, models: Models, profile: Profile | null = null, matchPasses: MatchPass[] | null = null, opts: PlanOptions = {}): Plan {
  const whatIf = opts.whatIf ?? false;
  const A = analyse(data, models), { g, actions, atk, shot, key } = A;
  const pkg = data.pkg as unknown as { meta: { id: string; attacking: string; pass?: { t: number; passer: number; receiver: number } }; players?: { pid: string; home: boolean; shirt: number }[]; lineup?: ({ position: string; side: string } | null)[]; roles?: ({ in: string; out: string } | null)[] };
  const act = actions.slice(atk.from, atk.to + 1).filter((a) => g.side(a.player) === 'att');
  const passes = act.filter((a) => a.kind === 'pass' || a.kind === 'cross');
  const first = act[0];
  const team: Story['team'] = pkg.meta.attacking === 'home' ? 'A' : 'B';
  const story: Story = {
    team, end: atk.end, t0: first?.t ?? 0, t1: shot?.t ?? atk.last, passes: passes.length,
    summary: '',
  };
  const cands: Beat[] = [];
  const beat = (b: Omit<Beat, 'id'> & { id?: string }): Beat => ({ ...b, id: b.id ?? `${b.kind}@${b.at.toFixed(2)}`, t0: r2(b.t0), t1: r2(b.t1), at: r2(b.at) });
  const actors = (...xs: [number | undefined, Actor['role']][]) => xs.filter(([p]) => p !== undefined).map(([p, role]) => ({ player: p!, role }));

  // ---- intro: the story in one line
  if (first) {
    const keeperStart = g.keepers.has(first.player), bx = g.ball(first.t)?.[0] ?? 0, dur = story.t1 - story.t0;
    const lb = key ? linesBroken(g, key) : null;
    const how = shot ? `${START_ZH(bx, keeperStart)}到射门，${Math.round(dur)} 秒、${passes.length} 脚传递` : lb ? `${START_ZH(bx, keeperStart)}倒脚，然后一脚破 ${lb.units.length} 条线` : `${passes.length} 脚传递`;
    story.summary = `${team} 队这次进攻：${how}，${END_ZH[atk.end]}`;
    cands.push(beat({ kind: 'intro', at: first.t, t0: first.t, t1: Math.min(first.t + 3, key ? key.t - LEAD - 0.5 : first.t + 3), select: null, actors: [],
      facts: [fact('team', `${team} 队`, 'rule'), fact('seconds', dur, 'tracking', 's', '第一次触球到射门（或这次进攻结束）'), fact('passes', passes.length, 'tracking', '脚', '传到队友脚下的传球，按球的轨迹'), fact('start', START_ZH(bx, keeperStart), 'tracking'), fact('end', END_ZH[atk.end], 'opta')],
      draw: [], say: story.summary, salience: 1, why: [`进攻从 ${first.t.toFixed(2)} s（{n:${first.player}}第一次触球）到 ${story.t1.toFixed(2)} s，${passes.length} 脚传递，结果：${END_ZH[atk.end]}`] }));
  }

  // ---- build-up: until the key progression; fast forward when long, the block's hull when it is compact
  const bu = A.phases.find((p) => p.kind === 'build-up');
  if (bu && key) {
    const t0 = Math.min(bu.t0 + 3, key.t - LEAD - 1.5), t1 = key.t - LEAD - 0.3, dur = t1 - t0;
    const n = act.filter((a) => a.kind === 'pass' && a.t >= bu.t0 && a.t < key.t).length;
    const tm = (t0 + t1) / 2, def: XY[] = [];
    for (let p = g.nAtt; p < g.P; p++) if (p !== g.defKeeper) { const q = g.pos(p, tm); if (q) def.push(q); }
    const area = hullArea(def), compact = area < 700;
    const why = [`组织阶段 ${bu.t0.toFixed(1)}–${key.t.toFixed(1)} s：${n} 脚传递（${bu.why}）`, `B 方 10 名场上球员围成的面积 ${Math.round(area)} m²（Opta：600 以下算紧凑，900 以上算松散）`];
    if (dur >= 4) cands.push(beat({ kind: 'build-up', at: t0, t0, t1, select: null, actors: [],
      facts: [fact('passes', n, 'tracking', '脚'), fact('seconds', bu.t1 - bu.t0, 'tracking', 's'), fact('block_m2', Math.round(area), 'tracking', 'm²', '防守方 10 名场上球员的凸包面积')],
      draw: compact ? [draw.hull('hull-bu', tm, [t0, t1])] : [],
      say: compact ? `对方收得很紧（${Math.round(area)} 平方米），${team} 队来回倒脚找缝` : `${team} 队后场倒脚 ${n} 次，寻找机会`,
      salience: compact ? 0.45 : 0.36, why: [...why, '正常速度（讲解从不变速，只定格；长的组织阶段多讲几句）', compact ? '紧凑：画防守块' : '不紧凑：不画'] }));
  }

  // ---- line-breaking passes
  const isKeyPass = (a: Action) => pkg.meta.pass && Math.abs(a.t - pkg.meta.pass.t) < 0.8 && a.player === pkg.meta.pass.passer;
  for (const a of act) {
    const lb = linesBroken(g, a);
    if (!lb || a.tTo === undefined || a.to === undefined) continue;
    const keyBeat = !!isKeyPass(a) || (!shot && a === key);
    // a pass through one line that is not the clip's key moment is part of the circulation, told with the build-up
    if (lb.units.length < 2 && !keyBeat && a !== key) { cands.find((b) => b.kind === 'build-up')?.why.push(`${a.t.toFixed(1)} s 破 1 条线（${lb.units.join('')}），不是关键传球：并入组织阶段`); continue; }
    const b0 = g.ball(a.t)!, b1 = g.ball(a.tTo)!, sp = spaceOf(g, a), beaten = beatenBy(g, a);
    const t0 = a.t - LEAD - 0.2, t1 = a.tTo + EXIT + (sp?.poly ? 0.6 : 0);
    const facts: Fact[] = [fact('recv_t', a.tTo, 'tracking', 's', '接球的那一刻'), fact('lines', lb.units.length, lb.src === 'opta' ? 'opta' : 'tracking', '条', lb.units.join('+')), fact('metres', a.metres ?? dist([b0[0], b0[1]], [b1[0], b1[1]]), 'tracking', 'm', '触球到触球'),
      fact('beaten', beaten.length, 'tracking', '人', '出球时在球和球门之间、到球时已被甩在身后的防守球员'), fact('kmh', kmhOfKick(g, a.t), 'tracking', 'km/h')];
    if (a.xpass !== undefined) facts.push(fact('xpass', a.xpass, 'opta', '', 'Opta 的传球预期成功率'));
    if (a.peak !== undefined) facts.push(fact('peak', a.peak, 'tracking', 'm', '球飞行的最高点'));
    if (sp?.nearest) facts.push(fact('space_m', sp.nearest.d, 'tracking', 'm', `接球时离他最近的对手 {n:${sp.nearest.player}}`));
    if (sp?.control !== null && sp?.control !== undefined) facts.push(fact('control', sp.control, 'pitch-control', '', '出球那一刻，落点归进攻方的概率'));
    const items: DrawItem[] = [
      // the lines' story is told when the ball lands: they retract then, the arrow stays a little longer
      draw.units(`units-${a.t.toFixed(1)}`, a.t, t0, a.tTo + 0.3),
      draw.pass(`pass-${a.t.toFixed(1)}`, [b0[0], b0[1]], [b1[0], b1[1]], a.t, a.tTo, a.peak ?? 0, [a.t - (keyBeat ? 0.05 : 0), t1]),
    ];
    if (sp?.poly && sp.area >= 30) items.push(draw.zone(`space-${a.t.toFixed(1)}`, sp.poly, [a.tTo - 0.3, t1]));
    // the receiver's run, drawn ahead of him from the freeze when this is the clip's held moment
    const rsp = runSpan(g, a.to, a.t, a.tTo), run = rsp ? runOf(g, a.to, rsp.from, a.tTo) : runOf(g, a.to, a.t - 1, a.tTo);
    const ranIn = !!rsp && run.disp >= 8, rs = rsp?.from ?? a.t;
    const runWhen = rs < a.t - 0.3 ? `出球前 ${(a.t - rs).toFixed(1)} s 就已起跑` : rs <= a.t + 0.3 ? '和出球同时启动' : `出球后 ${(rs - a.t).toFixed(1)} s 才启动`;
    if (ranIn) facts.push(fact('run_kmh', run.peak, 'tracking', 'km/h', `接球人的跑动峰值；${runWhen}`), fact('run_m', run.disp, 'tracking', 'm'));
    if (keyBeat && ranIn) items.push(draw.run(`run-${a.to}-${a.t.toFixed(1)}`, a.to, Math.min(rs, a.t), a.tTo, [a.t - LEAD, a.tTo + 0.3]));
    const sal = Math.min(1, 0.5 + 0.12 * lb.units.length + (lb.units.includes('back') ? 0.1 : 0) + (a.xpass !== undefined ? 0.2 * (1 - a.xpass) : 0) + (keyBeat ? 0.2 : 0));
    const last = lb.units.includes('back') ? '后卫线' : '中场线';
    cands.push(beat({ kind: 'line-break', at: a.t, t0, t1, hold: keyBeat ? HOLD.key : undefined, select: a.player,
      actors: actors([a.player, 'passer'], [a.to, 'receiver'], ...beaten.map((p) => [p, 'beaten'] as [number, Actor['role']])),
      facts, draw: items,
      say: `{n:${a.player}} ${(a.metres ?? 0) > 30 ? `一脚 ${Math.round(a.metres ?? 0)} 米${(a.peak ?? 0) > 2 ? '长传' : '直塞'}` : '一脚直塞'}，越过 B 队 ${lb.units.length} 条线${lb.units.includes('back') ? '，到后卫线身后' : ''}${sp?.nearest && sp.nearest.d >= 4 ? `，{n:${a.to}} 身边 ${Math.round(sp.nearest.d)} 米没人` : ''}`,
      salience: sal,
      why: [lb.why, `{n:${a.player}} → {n:${a.to}}，${(a.metres ?? 0).toFixed(1)} m，最高 ${a.peak ?? 0} m`, `越过 ${beaten.length} 名防守球员（${beaten.map((p) => `{n:${p}}`).join('、') || '无'}）`,
        sp?.nearest ? `接球时最近的对手 {n:${sp.nearest.player}}，${sp.nearest.d.toFixed(1)} m；落点控制 ${sp.control !== null ? pct(sp.control) + '%' : '—'}，空当 ${Math.round(sp.area)} m²` : '没有落点数据',
        keyBeat ? `这是片段的关键传球：出球时定格 ${HOLD.key} s，画出${last}、传球路线${ranIn ? '和接球人的跑位' : ''}` : '不是片段的关键时刻：不定格',
        ranIn ? `接球人 {n:${a.to}}跑动：${runWhen}（${rs.toFixed(1)} s），到接球跑了 ${run.disp.toFixed(0)} m，峰值 ${run.peak.toFixed(0)} km/h` : `接球人跑动不大（峰值 ${run.peak.toFixed(0)} km/h，${run.disp.toFixed(0)} m）`] }));
  }

  // ---- the final pass, and the run that made the pass before it (a one-two: A to B, B back to A within 4 s)
  if (shot) {
    const si = act.findIndex((a) => a.kind === 'shot');
    const fp = [...act.slice(0, si)].reverse().find((a) => a.kind === 'pass' && a.to === shot.shooter && shot.t - (a.tTo ?? 0) < 6);
    if (fp && fp.tTo !== undefined && !linesBroken(g, fp)) {
      const prev = [...act].reverse().find((a) => a.kind === 'pass' && a.t < fp.t && a.player === fp.to && a.to === fp.player && fp.t - (a.tTo ?? 0) < 4);
      const b0 = g.ball(fp.t)!, b1 = g.ball(fp.tTo)!;
      // the run: the final passer's own run onto the pass before (an overlap), or the shooter's onto the final pass
      const runner = prev ? fp.player : shot.shooter, runTo = prev ? prev.tTo! : fp.tTo, rsp = runSpan(g, runner, prev ? prev.t : fp.t, runTo);
      const rs = rsp?.from ?? runTo, run = runOf(g, runner, rs, runTo);
      if (rsp && run.disp >= 8 && prev) {
        const p0 = g.ball(prev.t)!, p1 = g.ball(prev.tTo!)!, off0 = offsideX(g, rs);
        const t0 = rs - 0.3, t1 = prev.tTo! + 0.6;
        // its moment is the pass played into the run (the line lands there); the arrow shows the whole run
        cands.push(beat({ kind: 'run', at: prev.t, t0, t1, select: runner, actors: actors([runner, 'runner'], [prev.player, 'passer']),
          facts: [fact('peak_kmh', run.peak, 'tracking', 'km/h'), fact('metres', run.disp, 'tracking', 'm'), fact('seconds', runTo - rs, 'tracking', 's'), fact('start_x', run.from?.[0] ?? 0, 'tracking', 'm'), fact('line_x', off0, 'tracking', 'm', '跑动开始时 B 队的越位线')],
          draw: [draw.run(`run-${runner}-${rs.toFixed(1)}`, runner, rs, runTo, [t0, t1]), draw.pass(`pass-${prev.t.toFixed(1)}`, [p0[0], p0[1]], [p1[0], p1[1]], prev.t, prev.tTo!, prev.peak ?? 0, [prev.t - 0.05, t1])],
          say: `{n:${runner}} 全速插上，时速 ${Math.round(run.peak)} 公里`, salience: Math.min(1, 0.45 + (run.peak - 20) / 30),
          why: [`{n:${runner}} ${rs.toFixed(1)}–${runTo.toFixed(1)} s 跑了 ${run.disp.toFixed(0)} m，峰值 ${run.peak.toFixed(0)} km/h（20 km/h 以上算高速）`, `他接 {n:${prev.player}}的传球，再回传：撞墙配合`] }));
      }
      const t0 = fp.t - 0.4, t1 = Math.min(shot.t - 0.1, fp.tTo + 1.0);
      cands.push(beat({ kind: 'final-pass', at: fp.t, t0, t1, select: fp.to ?? null, actors: actors([fp.player, 'passer'], [fp.to, 'receiver']),
        facts: [fact('recv_t', fp.tTo, 'tracking', 's', '接球的那一刻'), fact('metres', fp.metres ?? 0, 'tracking', 'm'), ...(fp.xpass !== undefined ? [fact('xpass', fp.xpass, 'opta')] : []), fact('one_two', prev ? '是' : '否', 'rule'), ...(fp.tags?.length ? [fact('tags', fp.tags.join(','), 'opta')] : [])],
        draw: [draw.pass(`pass-${fp.t.toFixed(1)}`, [b0[0], b0[1]], [b1[0], b1[1]], fp.t, fp.tTo, fp.peak ?? 0, [fp.t - 0.05, t1])],
        say: prev ? `撞墙配合，{n:${fp.to}} 拿球直插禁区` : `{n:${fp.player}} 传给 {n:${fp.to}}`,
        salience: prev ? 0.6 : 0.45, why: [`射门前最后一脚传球：{n:${fp.player}} → {n:${fp.to}}，${(fp.metres ?? 0).toFixed(1)} m${fp.tags?.length ? `（Opta：${fp.tags.join(', ')}）` : ''}`, prev ? `${prev.t.toFixed(1)} s {n:${prev.player}} → {n:${prev.to}}，${fp.t.toFixed(1)} s 传回：撞墙配合` : '不是撞墙配合'] }));
    }
  }

  // ---- decoys: runs that took a defender away from the key pass's reception
  if (key) for (const d of decoysFor(g, key, key.t - 2.0).slice(0, 1)) {
    const rs = runSpan(g, d.player, key.t, key.tTo!)?.from ?? key.t - 2, t0 = key.t - LEAD - 0.2, t1 = key.tTo! + 0.3;
    cands.push(beat({ kind: 'run', id: `decoy@${key.t.toFixed(2)}`, at: key.t, t0, t1, select: d.player, actors: actors([d.player, 'decoy'], [d.marker, 'marker']),
      facts: [fact('peak_kmh', d.peak, 'tracking', 'km/h'), fact('dragged_m', d.dragged, 'tracking', 'm', '他带走的防守球员离落点远了多少')],
      draw: [draw.run(`run-${d.player}-${rs.toFixed(1)}`, d.player, rs, key.tTo!, [t0, t1]), draw.marking(`mark-${d.player}`, d.player, key.t, [t0, t1])],
      say: `{n:${d.player}} 的跑动带走了 {n:${d.marker}}，给传球让出空当`, salience: Math.min(0.8, 0.35 + d.dragged / 15), why: [d.why] }));
  }

  // ---- the shot, frozen on the boot's contact, and the better-placed teammate
  if (shot) {
    const xg = shot.xg ?? shot.opta ?? 0;
    cands.push(beat({ kind: 'shot', at: shot.t, t0: shot.t, t1: shot.t, hold: HOLD.shot, select: shot.shooter, actors: actors([shot.shooter, 'shooter']),
      facts: [...(shot.xg !== null ? [fact('xg', shot.xg, 'xg', '', '我们的模型，算上防守球员和门将')] : []), ...(shot.opta !== null ? [fact('xg_opta', shot.opta, 'opta')] : []),
        fact('distance', shot.distM, 'tracking', 'm'), fact('angle', shot.angleDeg, 'tracking', '°', '两门柱之间的张角'), fact('header', shot.header ? '头球' : '脚', 'opta'), fact('contact_t', shot.t, 'tracking', 's', `事件流 ${shot.feedT} s`)],
      draw: [draw.shot(`shot-${shot.shooter}`, shot.shooter, shot.t)],
      say: `{n:${shot.shooter}} 选择自己打：${Math.round(shot.distM)} 米、角度 ${Math.round(shot.angleDeg)} 度，xG ${xg.toFixed(2)}`, salience: 1,
      why: [`射门定格在触球的那一刻 ${shot.t.toFixed(2)} s（事件流 ${shot.feedT} s）`, `xG：我们 ${shot.xg?.toFixed(3) ?? '—'}，Opta ${shot.opta ?? '—'}`] }));
    const m = shot.mate;
    if (m && whatIf) {
      // after a goal the what-if is not told (the tone: never second-guess a scorer); a header's what-if is a headed
      // lay-off, so the ground pass's chance does not apply
      const scored = atk.end === 'goal', head = shot.header;
      const gain = m.xg - xg, ratio = xg > 0 ? m.xg / xg : Infinity, worth = !scored && m.xg >= 0.15 && m.xg >= 2 * xg && gain >= 0.1;
      const facts: Fact[] = [fact('xg_mate', m.xg, 'xg'), fact('ratio', ratio, 'xg', '倍'), fact('metres', m.metres, 'tracking', 'm', '射门人到他的距离')];
      if (m.earlier !== null) facts.push(fact('xg_mate_2_5s', m.earlier, 'xg', '', '2.5 秒前他站的位置'));
      if (m.marker) facts.push(fact('marker_m', m.marker.d, 'tracking', 'm', `离他最近的对手 {n:${m.marker.player}}`));
      if (m.pass !== null && !head) facts.push(fact('pass_chance', m.pass, 'first-touch', '', '这脚横传他先碰到球的概率（首触模型）'));
      const items: DrawItem[] = [draw.shot(`shot-${m.player}`, m.player, shot.t), draw.marking(`mark-${m.player}`, m.player, shot.t)];
      const sp = g.ball(shot.t)!, mp = g.pos(m.player, shot.t)!;
      // held: no window (the held cue shows it for the hold; a window of [t, t] would miss the clock by a millisecond)
      const wi = draw.pass(`whatif-${m.player}`, [sp[0], sp[1]], mp, shot.t, shot.t, 0, [shot.t, shot.t], true); delete wi.window;
      items.push(wi);
      cands.push(beat({ kind: 'what-if', at: shot.t, t0: shot.t, t1: shot.t, hold: HOLD.whatif, select: m.player, actors: actors([m.player, 'mate'], [shot.shooter, 'shooter'], [m.marker?.player, 'marker']),
        facts, draw: items,
        say: head ? `如果这个头球摆给 {p:${m.player}}：他那里 xG ${m.xg.toFixed(2)}，是这次头球攻门的 ${ratio >= 10 ? '十倍以上' : `${ratio.toFixed(1)} 倍`}`
          : `如果传给 {p:${m.player}}：他那里 xG ${m.xg.toFixed(2)}，是这脚射门的 ${ratio >= 10 ? '十倍以上' : `${ratio.toFixed(1)} 倍`}${m.pass !== null ? `，横传 ${Math.round(m.metres)} 米能到的机会 ${pct(m.pass)}%` : ''}`,
        salience: worth ? Math.min(1, 0.6 + gain) : 0.2,
        why: [`同一时刻、同一模型，每名不越位的队友站的位置的 xG：最高 {n:${m.player}} ${m.xg.toFixed(3)}，射门人 ${xg.toFixed(3)}`, scored ? '进球了：不讲本可以' : worth ? `≥ 0.15、≥ 2 倍、多 0.1 以上：值得讲` : `不够明显（要 ≥ 0.15、≥ 2 倍、多 0.1）：不讲`, ...(head ? ['头球：说"摆给"，不用地面横传的概率'] : []),
          m.earlier !== null ? `2.5 秒前他那里 ${m.earlier.toFixed(3)}：${m.earlier < m.xg / 2 ? '他是最后一刻才跑到的' : '他早就在那里'}` : '', m.pass !== null ? `横传 ${m.metres.toFixed(1)} m，首触模型：他先碰到球 ${pct(m.pass)}%` : ''].filter(Boolean) }));
    }
  }

  // ---- what could have been, without a shot: the last action was a long shot of a pass (Opta xpass under 0.35, a
  // cross into a crowd); was a teammate free, by the same models as the shot's what-if (his xG where he stood, the
  // chance a pass reaches him first)?
  const lastAct = act[act.length - 1];
  if (whatIf && !shot && lastAct && (lastAct.kind === 'cross' || lastAct.kind === 'lost') && (lastAct.xpass ?? 1) < 0.35 && models.xg && models.resolver) {
    const t = lastAct.t, all = g.all(t), vel = Array.from({ length: g.P }, (_, p) => g.vel(p, t)), gk = Array.from({ length: g.P }, (_, p) => g.keepers.has(p));
    const opp: XY[] = []; for (let p = g.nAtt; p < g.P; p++) if (p !== g.defKeeper) opp.push(all[p]);
    const off = offsideX(g, t), bx = g.ball(t)?.[0] ?? 0;
    let best: { p: number; chance: number; xg: number } | null = null;
    for (let p = 0; p < g.nAtt; p++) {
      if (p === lastAct.player || g.keepers.has(p) || all[p][0] > Math.max(off, bx) + 0.3) continue;
      const chance = passChance(models.resolver, all, vel, gk, lastAct.player, p), x = xgFreeze(models.xg, all[p], false, opp, g.defKeeper >= 0 ? all[g.defKeeper] : null);
      if (!best || chance * x > best.chance * best.xg) best = { p, chance, xg: x };
    }
    if (best) {
      const worth = best.xg >= 0.12 && best.chance >= 0.55, b = g.ball(t)!;
      const wi = draw.pass(`whatif-${best.p}`, [b[0], b[1]], all[best.p], t, t, 0, [t, t], true); delete wi.window;
      cands.push(beat({ kind: 'what-if', at: t, t0: t, t1: t, hold: HOLD.whatif, select: best.p, actors: actors([best.p, 'mate'], [lastAct.player, 'carrier']),
        facts: [fact('xpass_real', lastAct.xpass ?? 0, 'opta', '', '实际这脚的预期成功率'), fact('xg_mate', best.xg, 'xg'), fact('pass_chance', best.chance, 'first-touch')],
        draw: [wi, draw.marking(`mark-${best.p}`, best.p, t)],
        say: `{n:${lastAct.player}} 这脚成功率只有 ${pct(lastAct.xpass ?? 0)}%；{n:${best.p}} 那里 xG ${best.xg.toFixed(2)}，传过去的机会 ${pct(best.chance)}%`,
        salience: worth ? 0.75 : 0.2,
        why: [`实际：{n:${lastAct.player}} ${lastAct.kind === 'cross' ? '传中' : '传球'}，Opta 预期成功率 ${pct(lastAct.xpass ?? 0)}%`, `最好的备选：{n:${best.p}}，xG ${best.xg.toFixed(3)}，首触模型传到 ${pct(best.chance)}%`,
          worth ? 'xG ≥ 0.12 且传到 ≥ 55%：值得讲' : '要 xG ≥ 0.12 且传到 ≥ 55%：不够明显，不讲'] }));
    }
  }

  // the detectors' context (the insight library and the keeper's state at the strike)
  const ctx: Ctx = { g, skel: makeSkel(data), profile, act, all: actions, passes: matchPasses, shot, key, players: pkg.players ?? [], lineup: pkg.lineup ?? [], roles: pkg.roles ?? [], t0: story.t0, t1: story.t1 };

  // ---- the outcome (with the keeper's state at the strike: 门将站定, a description only, never a cause)
  {
    // after the shot's holds (a cue at the hold's own moment would start with them and take the selection)
    const t0 = shot ? shot.t + 0.02 : act[act.length - 1]?.t ?? atk.last, t1 = Math.min(g.end, t0 + 2.8);
    const after = actions.slice(atk.to + 1, atk.to + 4), saver = after.find((a) => a.kind === 'save')?.player, last = act[act.length - 1];
    const ks = shot ? keeperAt(ctx, shot.t) : null;
    const kNote = !ks ? '' : atk.end === 'saved' ? (ks.state === 'set' ? `——射门那一刻他已经站定${ks.band === '蹲' || ks.band === '低' ? '，重心压得很低' : ''}` : ks.state === 'moving' ? '——射门那一刻他还在横移' : '')
      : atk.end === 'goal' ? (ks.state === 'moving' ? `射门那一刻门将还在${ks.inAir ? '空中' : '横移'}` : ks.state === 'set' ? '门将已经站定，也没能拦下' : '') : '';
    const say = shot ? (atk.end === 'saved' ? `球速 ${shot.speed} 公里，被门将 {p:${saver ?? g.defKeeper}} 扑出${kNote}` : atk.end === 'goal' ? `球进了！${kNote ? kNote : ''}` : `${END_ZH[atk.end]}`)
      : atk.end === 'cross-cleared' ? `{n:${last?.player}} 传中，被 {n:${after[0]?.player ?? actions[atk.to + 1]?.player}} 挡出` : `${END_ZH[atk.end]}`;
    cands.push(beat({ kind: 'outcome', at: t0, t0, t1, select: null, actors: saver !== undefined ? actors([saver, 'keeper']) : [],
      facts: [fact('end', END_ZH[atk.end], 'opta'), ...(shot ? [fact('ball_kmh', shot.speed, 'tracking', 'km/h')] : []),
        ...(ks ? [fact('keeper_state', ks.state === 'set' ? '站定' : ks.state === 'moving' ? (ks.inAir ? '离地' : '还在移动') : '介于两者', 'tracking', '', `射门那一刻 ${ks.speed.toFixed(1)} km/h`), fact('keeper_hip', ks.band, 'tracking', '', `髋高 / 站立高 ${ks.ratio.toFixed(2)}（遥测交接的分档）`), fact('keeper_depth_m', ks.depth, 'tracking', 'm', '离门线')] : [])],
      draw: [], say, salience: 1,
      why: [`进攻在 ${t0.toFixed(2)} s 结束：${END_ZH[atk.end]}`, ...(ks ? [`门将射门那一刻 ${ks.speed.toFixed(1)} km/h（≤ 4.5 且双脚着地算站定，≥ 7 算还在移动，其间不评价）；重心 ${ks.band}（${ks.ratio.toFixed(2)}）；只描述，不说因此扑没扑到`] : [])] }));
  }

  // ---- the insight library (insights/all.ts): every detector on this attack, each finding a candidate beat
  const insights = detectInsights(ctx);
  for (const x of insights) {
    const rate = (x as { rate?: number }).rate;
    cands.push(beat({ id: x.id, kind: 'insight', entry: x.entry, at: x.t, t0: x.t0, t1: x.t1, hold: x.hold, rate, select: x.players[0]?.player ?? null, actors: x.players,
      facts: x.facts, draw: x.draw, say: x.say.praise ?? x.say.improve ?? x.say.neutral, tone: { praise: x.say.praise, improve: x.say.improve }, confidence: x.confidence,
      // an unvalidated entry stays out of the narration (debug view only)
      salience: ENTRY[x.entry].validated ? x.salience : Math.min(x.salience, CUT - 0.01),
      why: [...x.why, ...(ENTRY[x.entry].validated ? [] : [`${ENTRY[x.entry].zh}：检测器未验证，只在调试页显示`])] }));
  }
  // r1's generic run beat gives way to an insight about the same runner (an overlap, a blind-side run, a third man)
  const RUN_ENTRIES = new Set(['overlap', 'blind-side-run', 'third-man', 'half-space-run', 'hook-run']);
  for (const b of cands) if (b.kind === 'run' && cands.some((x) => x.kind === 'insight' && x.entry && RUN_ENTRIES.has(x.entry) && x.select === b.select && Math.abs(x.at - b.at) < 3)) { b.salience = 0; b.why.push('同一跑动已有更具体的洞察：让位'); }

  // ---- choose: always the intro, the shot and the outcome; the rest by salience, within MAX_BEATS; one beat per
  // insight entry (the best), so the clip does not repeat itself
  // (a build-up with a fast forward was kept whatever its salience; none has one now: the pace never changes)
  const must = new Set(['intro', 'shot', 'outcome']);
  for (const b of cands) if (b.kind === 'build-up' && b.rate) b.why.push('快进节拍：总是保留（决定整段的节奏）');
  const ranked = [...cands].sort((a, b) => b.salience - a.salience);
  const keep = new Set<string>(), dropped: Plan['dropped'] = [];
  const room = MAX_BEATS - cands.filter((b) => must.has(b.kind) || (b.kind === 'build-up' && b.rate)).length;
  let used = 0;
  const entriesUsed = new Set<string>(), buildUp = cands.find((b) => b.kind === 'build-up') ?? null;
  for (const b of ranked) {
    if (must.has(b.kind) || (b.kind === 'build-up' && b.rate)) { keep.add(b.id); continue; }
    if (b.salience < CUT) { dropped.push({ id: b.id, kind: b.kind, salience: b.salience, why: `${b.why[b.why.length - 1]}（显著度 ${b.salience.toFixed(2)}，低于 ${CUT}）` }); continue; }
    if (b.entry && entriesUsed.has(b.entry)) { dropped.push({ id: b.id, kind: b.kind, salience: b.salience, why: `同一类洞察（${ENTRY[b.entry].zh}）已讲过更重要的一次` }); continue; }
    if (b.entry && cands.some((x) => keep.has(x.id) && x.kind === 'insight' && x.select === b.select && Math.abs(x.at - b.at) < 0.6)) { dropped.push({ id: b.id, kind: b.kind, salience: b.salience, why: `同一人同一刻已有一条洞察` }); continue; }
    // at most two insights about one player in a clip (the survey's naming rule, docs/research/orchestrator.md R12)
    if (b.entry && b.select !== null && cands.filter((x) => keep.has(x.id) && x.kind === 'insight' && x.select === b.select).length >= 2) { dropped.push({ id: b.id, kind: b.kind, salience: b.salience, why: `{n:${b.select}} 已有两条洞察` }); continue; }
    // the build-up is told in one beat: at most one insight inside it, unless it matters a lot (0.7 or more)
    if (b.entry && buildUp && b.at < buildUp.t1 && b.salience < 0.7 && cands.some((x) => keep.has(x.id) && x.kind === 'insight' && x.at < buildUp.t1)) { dropped.push({ id: b.id, kind: b.kind, salience: b.salience, why: '组织阶段已有一条洞察' }); continue; }
    if (used >= room) { dropped.push({ id: b.id, kind: b.kind, salience: b.salience, why: `超出 ${MAX_BEATS} 个节拍` }); continue; }
    keep.add(b.id); used++;
    if (b.entry) entriesUsed.add(b.entry);
  }
  const beats = cands.filter((b) => keep.has(b.id)).sort((a, b) => a.at - b.at || order(a) - order(b));
  // the fast forward covers only the uneventful part: it ends before the first beat chosen inside it (that beat plays
  // at normal speed); under 4 s left, no fast forward at all
  for (const bu of beats.filter((b) => b.kind === 'build-up' && b.rate)) {
    const inside = beats.filter((b) => b !== bu && b.t0 < bu.t1 && b.at > bu.t0);
    if (!inside.length) continue;
    const t1 = r2(Math.max(bu.t0, Math.min(...inside.map((b) => b.t0)) - 0.2));
    bu.why.push(`快进到 ${t1.toFixed(2)} s 为止：之后的 ${inside.map((b) => b.id).join('、')} 正常速度`);
    bu.t1 = t1;
    if (bu.t1 - bu.t0 < 4) { delete bu.rate; bu.why.push('快进段不足 4 s：不快进'); }
  }
  // one story at a time (segmenting): a play beat starts once the one before has landed (its moment, the reception
  // for a pass), so two protagonists never share the screen; its drawings may show the past part of its action
  let landed = -Infinity, prevId = '';
  for (const b of beats) {
    if (b.t0 === b.t1) continue;
    if (b.t0 < landed + 0.3 && b.kind !== 'outcome') {
      const t0 = r2(Math.min(b.at, landed + 0.3));
      b.why.push(`一次只讲一件事：等 ${prevId} 落地（${landed.toFixed(2)} s）再开始，${b.t0.toFixed(2)} → ${t0.toFixed(2)} s`);
      for (const it of b.draw) if (it.window && (it.window.from ?? -Infinity) < t0) it.window = { ...it.window, from: t0 };
      b.t0 = t0;
    }
    const land = b.kind === 'line-break' || b.kind === 'final-pass' ? (b.facts.find((f) => f.key === 'recv_t')?.value as number | undefined) ?? b.at : b.kind === 'run' ? b.t1 - 0.6 : b.at;
    // an insight that holds is told in its hold; the ones that play land at their moment
    if (land > landed) { landed = land; prevId = b.id; }
  }
  const budget = enforceBudget(beats);
  const candidates = insights.map((x) => ({ id: x.id, entry: x.entry, t: x.t, t0: x.t0, t1: x.t1, players: x.players.map((a) => a.player), salience: x.salience, confidence: x.confidence, validated: ENTRY[x.entry].validated, say: x.say.neutral, facts: x.facts, draw: x.draw, why: x.why, chosen: keep.has(x.id) }));
  const runs = runsIn(ctx).map((r) => ({ p: r.p, from: r.from, to: r.to, peak: +r.peak.toFixed(1), disp: +r.disp.toFixed(1), passT: r.pass.t, received: r.received }));
  return { clip: pkg.meta.id, v: 1, rules: RULES, story, phases: A.phases, actions: act, beats, dropped, budget, candidates, runs };
}

/** held beats at one moment play in this order */
const order = (b: Beat) => ({ intro: 0, 'build-up': 1, 'line-break': 2, run: 3, insight: 3.5, 'final-pass': 4, shot: 5, 'what-if': 6, outcome: 7 })[b.kind];

/** the clutter budget: at most MAX_ITEMS drawings showing at any narration moment. Play beats' items count over their
 *  windows; a held beat's own items replace whatever play items stand at its moment only if they share the hold, so
 *  they are counted with the play beats spanning it. When over, the least important drawing's window is cut short
 *  (or the drawing dropped when less than 0.6 s would be left). Returns the worst count after the cut */
export function enforceBudget(beats: Beat[]): Plan['budget'] {
  const live = (t: number, held: Beat | null) => {
    const out: { b: Beat; it: DrawItem; s: [number, number] }[] = [];
    for (const b of beats) {
      if (b.t0 === b.t1) { if (held === b) for (const it of b.draw) out.push({ b, it, s: [b.at, b.at] }); continue; }
      for (const it of b.draw) { const s = span(it, b.t0, b.t1); if (t >= s[0] && t <= s[1] && t >= b.t0 && t <= b.t1) out.push({ b, it, s }); }
    }
    return out;
  };
  const times = new Set<number>();
  for (const b of beats) { times.add(b.t0); times.add(b.at); for (const it of b.draw) { const s = span(it, b.t0, b.t1); times.add(s[0]); } }
  let worst = 0, worstAt: number | null = null;
  for (let guard = 0; guard < 50; guard++) {
    let over: { t: number; list: ReturnType<typeof live> } | null = null;
    for (const t of [...times].sort((a, b) => a - b)) {
      for (const held of [null, ...beats.filter((b) => b.t0 === b.t1 && Math.abs(b.at - t) < 1e-6)]) {
        const list = live(t + 1e-4, held);
        if (list.length > MAX_ITEMS) { over = { t, list }; break; }
      }
      if (over) break;
    }
    if (!over) break;
    // the victim: a drawing of the oldest beat (its moment has passed and its story is told), the least important first
    const victim = over.list.filter((x) => x.b.t0 !== x.b.t1).sort((a, b) => a.b.at - b.b.at || (PRIO[a.it.kind] ?? 0) - (PRIO[b.it.kind] ?? 0))[0];
    if (!victim) break;
    const left = over.t - victim.s[0];
    if (left < 0.6) victim.b.draw = victim.b.draw.filter((x) => x !== victim.it);
    else victim.it.window = { from: victim.s[0], to: +(over.t - 0.05).toFixed(2) };
    victim.b.why.push(`杂乱度预算：${over.t.toFixed(2)} s 同时有 ${over.list.length} 个画面，${left < 0.6 ? '去掉' : '提前收起'} ${victim.it.id}`);
  }
  for (const t of [...times]) for (const held of [null, ...beats.filter((b) => b.t0 === b.t1 && Math.abs(b.at - t) < 1e-6)]) { const n = live(t + 1e-4, held).length; if (n > worst) { worst = n; worstAt = t; } }
  return { maxItems: MAX_ITEMS, worst, at: worstAt };
}

/** the plan as the narration's cues, without text: a play beat is a cue from t0 until t1 with its drawings, subject,
 *  view and speed (and a held cue at its moment when it holds); a held beat is a held cue carrying its drawings. The
 *  beat's id, kind, facts and line hint ride along in `on` and `beat` for the narration to write from */
export function toCues(plan: Plan): (Cue & { beat: { id: string; kind: string; say: string; facts: Fact[] } })[] {
  const out: (Cue & { beat: { id: string; kind: string; say: string; facts: Fact[] } })[] = [];
  for (const b of plan.beats) {
    const tag = { id: b.id, kind: b.kind, say: b.say, facts: b.facts };
    if (b.t0 === b.t1 && b.hold) { out.push({ t: b.at, pause: b.hold, draw: b.draw, select: b.select, ...(b.view ? { view: b.view } : {}), beat: tag }); continue; }
    out.push({ t: b.t0, until: b.t1, draw: b.draw, select: b.select, ...(b.view ? { view: b.view } : {}), ...(b.rate ? { rate: b.rate } : {}), beat: tag });
    // back to normal speed: a cue of its own, ended at once (without an end it would run to the next line)
    if (b.rate) out.push({ t: b.t1, until: b.t1 + 0.01, rate: 1, beat: { ...tag, id: `${b.id}/rate` } });
    if (b.hold) out.push({ t: b.at, pause: b.hold, beat: { ...tag, id: `${b.id}/hold` } });
  }
  return out.sort((a, b) => a.t - b.t);
}

export type { Analysis };
