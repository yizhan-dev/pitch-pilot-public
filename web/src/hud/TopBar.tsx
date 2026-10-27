import { useEffect, useState } from 'react';
import { useGameSettings, setSettings, setMode, toggleLayer, MODES, type GameMode, type ViewMode } from '../game/settings';
import { usePanel, togglePanel, setPanel } from './panel';
import { fmtClock, TEAM_CODE } from './match';
import { Crest } from './crests';
import type { Team } from '../three/coords';
import { ViewIcon, ModeIcon, MapIcon } from './icons';
import { drawMode, useStore } from './draft';
import { explainable, whatifable } from './directed';
import { VIEW_UI, VIEW_GROUPS, VIEW_GROUP_LABEL, viewUI, viewBlocked } from './views';
import { tr } from '../i18n';
import { CreditsList } from '../credits/Credits';
import { summaryOpen } from '../summary/summary';

// The top bar: top left the score bug, top right the minimap switch, the mode button and the view button. Only designed
// parts are shown (Yi, 2026-10-22): the level, display and games buttons come back as their panels are designed. One
// panel is open at a time (./panel.ts).

export interface ScoreBugProps {
  /** team names as shown, home first */
  home: string; away: string;
  /** goals, home first */
  score: [number, number];
  /** in place of the clock (the match summary's "FT") */
  label?: string;
  /** match clock, seconds from kick-off */
  clock: number;
  /** in added time, the minutes announced for the half (the +3 of 90+3), shown in a box after the clock; else null */
  added?: number | null;
}

/** a team's cell: its crest on the outside, its short name beside it (Yi, 2026-10-23: crest and code, as broadcasts do) */
function TeamCell({ team }: { team: Team }) {
  const crest = <Crest team={team} size={24} />, code = <b>{TEAM_CODE[team]}</b>;
  return <span className={`hud-team ${team}`}>{team === 'home' ? <>{crest}{code}</> : <>{code}{crest}</>}</span>;
}

/** the score bug, laid out like a broadcast one: two team cells (crest and code), the score in its own lighter cell framed
 *  by the two kit colours (home blue, away orange in every clip, Yi 2026-10-23; until then the attacking team's strip
 *  was the blue one), and the clock in a cell of its own */
export function ScoreBug({ home, away, score, clock, added = null, label }: ScoreBugProps) {
  return (
    <div className="hud-bug hud-glass" aria-label={tr(`${home} ${score[0]} 比 ${score[1]} ${away}，比赛时间 ${fmtClock(clock)}${added != null ? `，补时 ${added} 分钟` : ''}`, `${home} ${score[0]}, ${away} ${score[1]}, match time ${fmtClock(clock)}${added != null ? `, ${added} minutes added` : ''}`)}>
      <TeamCell team="home" />
      <span className="hud-score">
        <i className="hud-strip home" />
        <b>{score[0]}</b><span className="hud-score-sep">:</span><b>{score[1]}</b>
        <i className="hud-strip away" />
      </span>
      <TeamCell team="away" />
      <span className="hud-clock">{label ?? fmtClock(clock)}</span>
      {added != null && !label && <span className="hud-added" title={tr(`补时 ${added} 分钟`, `${added} minutes added`)}>+{added}</span>}
    </div>
  );
}

/** the view picker under the view button: icon tiles in three groups, and a line under them for the hovered or current
 *  view (Yi chose this over a list, 2026-10-22). It only sets settings.view; the camera is the 3D side's. */
/** the view menu: one narrow column, the groups one under another (Yi, 2026-10-22: with 近景 and 远景 the row of tiles
 *  reached across to the pause window at the top centre); each row the icon, the name, the key */
export function ViewMenu({ hasOfficials }: { hasOfficials: boolean }) {
  const { view, selected, tactical } = useGameSettings();
  const [hover, setHover] = useState<ViewMode | null>(null);
  const pick = (k: ViewMode) => { setSettings({ view: k }); setPanel(null); };
  const shown = viewUI(hover ?? view), why = viewBlocked(shown, selected, hasOfficials, tactical);
  return (
    <div className="hud-pop hud-vpick" role="menu" aria-label={tr('视角', 'View')} data-hud-pop onPointerLeave={() => setHover(null)}>
      <div className="hud-vrow">
        {VIEW_GROUPS.map((g) => (
          <div className="hud-vgroup" key={g} role="group" aria-label={VIEW_GROUP_LABEL[g]}>
            <p className="hud-vgroup-label">{VIEW_GROUP_LABEL[g]}</p>
            <div className="hud-vtiles">
              {VIEW_UI.filter((v) => v.group === g && !v.hidden).map((v) => (
                <button key={v.key} type="button" role="menuitemradio" aria-checked={view === v.key} aria-disabled={!!viewBlocked(v, selected, hasOfficials, tactical)} className="hud-vtile"
                  onPointerEnter={() => setHover(v.key)} onFocus={() => setHover(v.key)} onBlur={() => setHover(null)}
                  onClick={() => { if (!viewBlocked(v, selected, hasOfficials, tactical)) pick(v.key); }}>
                  <ViewIcon view={v.key} size={22} />
                  <span>{v.label}</span>
                  <kbd className="hud-kbd">{v.hotkey}</kbd>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className={`hud-vfoot${why ? ' off' : ''}`}><b>{shown.label}</b>{why ?? shown.hint}</p>
    </div>
  );
}


/** a mode still being finished, tagged so in the mode menu (Yi, 2026-10-26, to the What-if chat: "add a 'beta' tag for
 *  the what if mode shall we? so judge knows that it is not stable yet"; not on the mode button: "it will make the top
 *  three button position shifts") */
const BETA: Partial<Record<GameMode, string>> = { whatif: 'Beta' };

/** the mode menu under the mode button (Yi, 2026-10-22; four modes since 2026-10-24: 观赛 · 讲解 · 战术 · What-if, 画板 folded
 *  into 战术 as its pen), from watching to changing, each with its icon,
 *  name and the line under it from MODES. A list rather than the view menu's tiles, so the lines read in full; the same
 *  pop-over, hover and checked look as the view menu. It only calls setMode; what each mode shows is the pitch's and the
 *  panels' business. */
export function ModeMenu() {
  const { mode } = useGameSettings();
  // a pick puts the pen away (drawMode: the 战术 pen once chat 3 has it; leaving or changing mode ends the drawing)
  const pick = (m: GameMode) => { drawMode.set(false); setMode(m); setPanel(null); };
  // Explain greyed on a clip without commentary (hud/directed.ts; Yi, 2026-10-26)
  // and What-if on a clip without a What-if moment (Yi, the same day)
  const ok = useStore(explainable), wiOk = useStore(whatifable);
  const off = (m: GameMode) => m !== mode && (m === 'explain' ? ok !== true : m === 'whatif' ? !wiOk : false);
  // the reason only once it is known: while the clip's commentary is still being looked up the row is greyed, untagged
  const said = (m: GameMode) => off(m) && (m !== 'explain' || ok === false);
  const why: Partial<Record<GameMode, string>> = { explain: 'No commentary for this clip', whatif: 'No what-if for this clip' };
  return (
    <div className="hud-pop hud-mpick" role="menu" aria-label={tr('模式', 'Mode')} data-hud-pop>
      {MODES.map((m) => (
        <button key={m.key} type="button" role="menuitemradio" aria-checked={mode === m.key} className="hud-mrow" disabled={off(m.key)} onClick={() => pick(m.key)}>
          <ModeIcon mode={m.key} size={28} />
          <span className="hud-mtext">
            <b>{m.label}{BETA[m.key] && <i className="hud-tag hud-beta">{BETA[m.key]}</i>}{said(m.key) && <i className="hud-tag hud-wip">{why[m.key]}</i>}</b>
            <small>{m.sub}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export interface TopBarProps {
  bug: ScoreBugProps | null;
  /** the clip carries the officials' tracking (pkg.officials.joints); without it the referee views are greyed */
  hasOfficials: boolean;
  /** the VAR check's button (game/varReplay.ts), shown on an offside clip from the pass on; pulsing until pressed */
  varBtn?: { on: boolean; toggle: () => void } | null;
  /** at a clip's end outside Watch: a pulsing "Back to Watch" right under the mode button, as wide as it (Yi, 2026-10-26) */
  backToWatch?: (() => void) | null;
}

export function TopBar({ bug, hasOfficials, varBtn, backToWatch }: TopBarProps) {
  const { view, layers, mode } = useGameSettings();
  const open = usePanel();
  const map = layers.includes('map');
  const cur = viewUI(view), curMode = MODES.find((m) => m.key === mode)!;
  // over the match summary the radar, the mode and the view are off (Yi, 2026-10-27: "for summary page, mode is disabled,
  // and radar is disabled", "view is disabled too"): its camera and its panel own the screen; the credits stay
  const sum = useStore(summaryOpen);
  useEffect(() => { if (sum && (open === 'mode' || open === 'view')) setPanel(null); }, [sum, open]);
  return (
    <>
      <div className="hud-tl">
        {/* the credits (Yi, 2026-10-26; src/credits/): left of the score bug, "so it is more obvious", as tall as it and square */}
        <div className="hud-anchor">
          <button type="button" className="hud-btn hud-glass hud-info" aria-haspopup="dialog" aria-expanded={open === 'credits'} aria-label="Credits" title="Credits" data-hud-toggle onClick={() => togglePanel('credits')}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M9 8 V13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="9" cy="5.2" r="1.05" fill="currentColor" /></svg>
          </button>
          {open === 'credits' && <div className="hud-pop hud-creditspop" role="dialog" aria-label="Credits" data-hud-pop><p className="hud-creditspop-h">Credits</p><CreditsList /></div>}
        </div>
        {bug && <ScoreBug {...bug} />}
      </div>
      <div className="hud-tr">
        {varBtn && (
          <button type="button" className={`hud-btn hud-glass hud-var${varBtn.on ? '' : ' pulse'}`} aria-pressed={varBtn.on}
            title={varBtn.on ? 'Leave the VAR check (or press play)' : 'VAR check: the offside line at the moment of the pass'} onClick={varBtn.toggle}>VAR</button>
        )}
        {/* "Radar", as EA FC and eFootball name the pitch from above in their HUD settings (雷达图; Yi, 2026-10-23: not "Minimap") */}
        <button type="button" className="hud-btn hud-glass hud-mode" aria-pressed={map && mode !== 'tactics' && !sum} disabled={mode === 'tactics' || sum}
          title={sum ? 'No radar over the match summary' : mode === 'tactics' ? 'No radar in Tactics: the legend has its place' : 'Radar: show or hide (R)'} onClick={() => toggleLayer('map')}>
          <kbd className="hud-kbd hud-key" aria-hidden="true">R</kbd><MapIcon size={18} />Radar
        </button>
        <div className="hud-anchor">
          <button type="button" className="hud-btn hud-glass" aria-haspopup="menu" aria-expanded={open === 'mode'} disabled={sum} title={sum ? 'Close the match summary to change the mode' : 'Mode (M)'} data-hud-toggle onClick={() => togglePanel('mode')}>
            <kbd className="hud-kbd hud-key" aria-hidden="true">M</kbd>{tr('模式', 'Mode')}<span className="hud-val"><ModeIcon mode={mode} size={18} />{curMode.label}</span>
          </button>
          {open === 'mode' && <ModeMenu />}
          {backToWatch && open !== 'mode' && (
            <button type="button" className="hud-btn hud-glass hud-back" onClick={backToWatch}><ModeIcon mode="watch" size={18} />Back to Watch</button>
          )}
        </div>
        <div className="hud-anchor">
          <button type="button" className="hud-btn hud-glass" aria-haspopup="menu" aria-expanded={open === 'view'} disabled={sum} title={sum ? 'Close the match summary to change the view' : 'View (V)'} data-hud-toggle onClick={() => togglePanel('view')}>
            <kbd className="hud-kbd hud-key" aria-hidden="true">V</kbd>{tr('视角', 'View')}<span className="hud-val"><ViewIcon view={view} size={18} />{cur.label}</span>
          </button>
          {open === 'view' && <ViewMenu hasOfficials={hasOfficials} />}
        </div>
      </div>
    </>
  );
}
