import { useEffect, useMemo, useState } from 'react';
import type { Loaded } from '../data';
import type { Look } from '../three/players/looks';
import type { XgFreezeModel } from '../response/xg';
import { setSettings, useGameSettings, type GameMode } from '../game/settings';
import { closeWhatIf, setWhatIf, useWhatIf } from '../game/whatif';
import { loadXg, mateXg, momentAt, type MomentKind, type PausePkg } from './moment';
import { tr } from '../i18n';
import { attackingOf, kitLabel, playerTeam } from '../three/coords';

// The pause window (design: docs/design/three-channels.html, "暂停窗口"): only while play is paused, top centre; its
// options follow the game mode (settings.mode: 观赛 "Paused" alone, 讲解 the AI's take on the moment, 战术 the what-if tools)
// and what the pause is in front of (a shot, a pass in the next 1.5 s, else a free pause); one tool open at a time,
// closed when play resumes. Built so far: 换队友来射, step 1 (each teammate's xG from where he stands, on the pitch and in
// a list; pick one), 射门视角 and 传球人视角. The rest are shown, greyed, until they are built.

interface Opt { key: string; label: string; ready: boolean }
// the what-ifs that change the play (the pass's target, the runs) left 战术 for the What-if mode of their own (Yi,
// 2026-10-24 evening; whatif/useWhatIf.tsx), which has no pause window: its question card asks instead
const TACTICS: Record<MomentKind, Opt[]> = {
  shot: [{ key: 'mate-shot', label: tr('换队友来射', 'A teammate shoots'), ready: true }, { key: 'eyes', label: tr('射门视角', "Shooter's view"), ready: true }, { key: 'angle', label: tr('射门角度和 xG', 'Shot angle & xG'), ready: false }],
  pass: [{ key: 'options', label: tr('传球选项', 'Pass options'), ready: false }],
  free: [{ key: 'drag', label: tr('拖动任意球员', 'Drag any player'), ready: false }, { key: 'lines', label: tr('2 秒预判线', '2-second forecast'), ready: false }],
};
const OPTIONS: Record<GameMode, Record<MomentKind, Opt[]>> = {
  // 观赛: "Paused" and nothing else (Yi, 2026-10-26: the shooter's and passer's views and the time to the pass are past the MVP)
  watch: { shot: [], pass: [], free: [] },
  // 讲解: as 观赛, "Paused" alone (Yi, 2026-10-26, chat 4: "the same as the one we designed in Watch tab"; the script is
  // the explanation, so its own button stood unbuilt)
  explain: { shot: [], pass: [], free: [] },
  tactics: TACTICS,
  whatif: { shot: [], pass: [], free: [] },
};
const KIND: Record<MomentKind, string> = { shot: tr('射门', 'shot'), pass: tr('传球', 'pass'), free: '' };

export function PauseWindow({ data, t, paused, looks }: { data: Loaded; t: number; paused: boolean; looks: Look[] }) {
  const pkg = data.pkg as unknown as PausePkg, nAtt = data.joints?.nAtt ?? pkg.frames[0].att.length;
  const wi = useWhatIf(), game = useGameSettings(), sel = game.selected, opts = OPTIONS[game.mode][momentAt(pkg, t).kind];
  const [model, setModel] = useState<XgFreezeModel | null>(null);
  useEffect(() => { loadXg().then(setModel); }, []);
  const m = useMemo(() => momentAt(pkg, t), [pkg, t]);
  // a player by his kit's colour and number, Orange #11: by team, as the kits (coords.ts, Yi 2026-10-23)
  const attacking = attackingOf(data.pkg.meta);
  const name = (i: number | null) => (i === null ? '' : kitLabel(playerTeam(i, nAtt, attacking), looks[i]?.number ?? i + 1));

  // resuming play, or leaving 战术, closes the tool; a new time while it is open recomputes its numbers
  useEffect(() => { if (!paused || game.mode !== 'tactics') closeWhatIf(); }, [paused, game.mode]);
  useEffect(() => {
    if (wi.tool === 'mate-shot' && model && Math.abs(wi.t - t) > 1e-3) setWhatIf({ t, xg: mateXg(model, pkg, t), shooter: m.actor, pick: null });
  }, [wi.tool, wi.t, t, model, pkg, m.actor]);
  // a teammate clicked on the pitch while 换队友来射 is open is the pick
  useEffect(() => {
    if (wi.tool === 'mate-shot' && sel !== null && sel !== wi.shooter && wi.xg?.[sel] != null && sel !== wi.pick) setWhatIf({ pick: sel });
  }, [sel, wi.tool, wi.shooter, wi.xg, wi.pick]);

  if (!paused) return null;
  const open = (o: Opt) => {
    if (!o.ready) return;
    if (o.key === 'eyes' && m.actor !== null) { setSettings({ view: 'first', selected: m.actor }); return; }
    if (o.key === 'mate-shot') {
      if (wi.tool === 'mate-shot') { closeWhatIf(); return; }
      if (model) setWhatIf({ tool: 'mate-shot', t, xg: mateXg(model, pkg, t), shooter: m.actor, pick: null });
    }
  };
  const plain = game.mode === 'watch' || game.mode === 'explain';
  const head = plain || m.kind === 'free' ? tr('暂停', 'Paused') : m.dt < 0.05 ? tr(`暂停 · ${KIND[m.kind]}瞬间`, `Paused · at the ${KIND[m.kind]}`) : tr(`暂停 · ${KIND[m.kind]}前 ${m.dt.toFixed(1)} 秒`, `Paused · ${m.dt.toFixed(1)} s before the ${KIND[m.kind]}`);
  const shooterXg = wi.shooter !== null ? wi.xg?.[wi.shooter] ?? null : null;
  const mates = (wi.xg ?? []).map((x, i) => ({ i, x })).filter((r): r is { i: number; x: number } => r.x !== null && r.i !== wi.shooter).sort((a, b) => b.x - a.x).slice(0, 4);
  const diff = (x: number) => (shooterXg === null ? '' : `${x >= shooterXg ? '+' : '−'}${Math.abs(x - shooterXg).toFixed(2)}`);
  // the window holds the options only, low and compact so the play stays in view; a tool's numbers go in the
  // comparison card on the right (the design's 对比卡)
  return (<>
    <div className={`pw glass${plain ? ' plain' : ''}`} role="dialog" aria-label={tr('暂停窗口', 'Pause window')}>
      <div className="pw-h"><b>{head}</b>{!plain && m.actor !== null && <span>{tr(`${name(m.actor)}持球`, `${name(m.actor)} on the ball`)}</span>}</div>
      {opts.length > 0 && <div className="pw-o">
        {opts.map((o) => (
          <button key={o.key} className={wi.tool === o.key ? 'on' : ''} disabled={!o.ready || (o.key === 'mate-shot' && !model)} title={o.ready ? undefined : tr('还没做好', 'Not built yet')} onClick={() => open(o)}>{o.label}</button>
        ))}
      </div>}
    </div>
      {wi.tool === 'mate-shot' && wi.xg && (
        <div className="pw-card glass" aria-label={tr('换队友来射', 'A teammate shoots')}>
          <div className="pw-h"><b>{tr('换队友来射', 'A teammate shoots')}</b><span>xG</span></div>
          <p className="pw-n">{tr('每名队友从他站的位置射门的进球概率，防守和门将都在原地。场上也标着。点一名队友。', "Each teammate's chance of scoring from where he stands, with the defenders and the keeper where they are; also marked on the pitch. Pick a teammate.")}</p>
          <div className="pw-rows">
            {wi.shooter !== null && shooterXg !== null && <div className="pw-r real"><span>{name(wi.shooter)}</span><b>{shooterXg.toFixed(2)}</b><em>{tr('实际射门', 'Actual shot')}</em></div>}
            {mates.map((r) => (
              <button key={r.i} className={`pw-r ${wi.pick === r.i ? 'on' : ''}`} onClick={() => { setWhatIf({ pick: r.i }); setSettings({ selected: r.i }); }}>
                <span>{name(r.i)}</span><b>{r.x.toFixed(2)}</b><em className={shooterXg !== null && r.x > shooterXg ? 'up' : ''}>{diff(r.x)}</em>
              </button>
            ))}
          </div>
          {wi.pick !== null && <p className="pw-n next">{tr(`下一步还没接上：球传给${name(wi.pick)}，球在路上时防守跟着移动，再由他射门，结果和实际对比。`, `Next, not wired yet: the ball goes to ${name(wi.pick)}, the defence moves while it travels, then he shoots, against what really happened.`)}</p>}
        </div>
      )}
  </>);
}
