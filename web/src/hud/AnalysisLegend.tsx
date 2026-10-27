import type { Clock } from '../clock';
import { useGameSettings } from '../game/settings';
import { attackingOf, playerTeam } from '../three/coords';
import type { Look } from '../three/players/looks';
import { base, annot, annotSub, offsideMark, xgMark, BASES, ANNOTS, useStore } from './draft';
import { carrierAt } from './passProb';
import { TEAM_LABEL, type ClipPkg } from './match';
import { useClockTime } from './useClockTime';
import { pcLegendBar, xtLegendBar } from './space';
import { XT_RANGE } from './analysis';
import { XT_FLOOR } from './space';
import { tr } from '../i18n';

// The legend of the 战术 mode's layers (the HUD preview's draft, Yi 2026-10-23): above the minimap, a row for the base map
// (its colour scale and what it shows) and one for the annotation (what the marks mean, and the moment's figure: who is
// on the ball for the passing options). Placeholders carry 示例. The threat, shot and chance-creation figures went with
// their marks (Yi, 2026-10-25; code before: <private-workspace>).

const BASE_LINE: Record<string, { line: React.ReactNode; example: boolean }> = {
  // Yi, 2026-10-25: "make Fernandez & Bornn one line itself on second line"
  pc: { line: <>Who controls each area first<br />Fernández &amp; Bornn</>, example: false },
  lanes: { line: <>Wing, half-space, centre, half-space, wing; cut at the boxes and halfway<br />Positional play’s 20 zones</>, example: false },
  zones: { line: <>Six bands along, three across; zone 14 is central, just outside the box<br />The 18-zone grid</>, example: false },
  // Yi, 2026-10-27: the xT map; the notebook iterates to convergence, so the figure is the chance of a goal from a possession here
  xt: { line: <>Chance the side on the ball goes on to score from here, passing, carrying or shooting<br />Karun Singh’s xT, fitted on 2,000 matches of regular play</>, example: false },
};
const ANNOT_LINE: Record<string, { line: string; example: boolean }> = {
  prob: { line: 'Chance a pass to each team-mate is completed: a model of Opta’s expected completion', example: false },
};

export function AnalysisLegend({ pkg, clock, looks }: { pkg: ClipPkg; clock: Clock; looks: Look[] }) {
  const { mode } = useGameSettings();
  const b = useStore(base), a = useStore(annot), sub = useStore(annotSub), offsideOn = useStore(offsideMark), xgOn = useStore(xgMark);
  const t = useClockTime(clock, 5);
  if (mode !== 'tactics' || (!b && !a && !offsideOn && !xgOn)) return null;
  const att = attackingOf(pkg.meta as { attacking?: string }), nAtt = pkg.frames[0]?.att.length ?? 11;
  const s = a ? sub[a] : null;

  // the annotation's figure at this moment
  let figure: React.ReactNode = null;
  if (a === 'pass') {
    const c = carrierAt(pkg, t);
    figure = c !== null && looks[c] ? <span>{tr('持球', 'On the ball')}: {looks[c].number}. {looks[c].name}</span> : <span className="muted">Nobody on the ball</span>;
  }


  const bm = b ? BASES.find((x) => x.key === b)! : null, am = a ? ANNOTS.find((x) => x.key === a)! : null;
  const bl = b ? BASE_LINE[b] : null, al = s ? ANNOT_LINE[s] : null;
  const attTeam = playerTeam(0, nAtt, att), defTeam = attTeam === 'home' ? 'away' : 'home';
  // the colour scale and its ends: pitch control the two teams, xT the lowest and highest cell; the grids have none
  const pct = (v: number) => `${v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`;
  const bar = b === 'pc' ? pcLegendBar(attTeam, defTeam) : b === 'xt' ? xtLegendBar() : null;
  const ends = b === 'pc' ? [TEAM_LABEL[att], TEAM_LABEL[att === 'home' ? 'away' : 'home']] : b === 'xt' ? [`under ${pct(XT_FLOOR)}`, pct(XT_RANGE.max)] : null;
  return (
    <div className="hud-legend hud-glass low" aria-label={tr('图例', 'Legend')}>   {/* bottom centre: no radar in Tactics (the Shell chat, 2026-10-25) */}
      {bm && bl && (
        <div className="hud-legend-row">
          <p className="hud-legend-h"><b>{bm.label}</b>{bm.abbr && <span>{bm.abbr}</span>}{bl.example && <i className="hud-tag">{tr('示例', 'Example')}</i>}</p>
          {bar && ends && <>
            <span className="hud-legend-bar" style={{ background: bar }} />
            <span className="hud-legend-ends"><span>{ends[0]}</span><span>{ends[1]}</span></span>
          </>}
          <p className="hud-legend-line">{bl.line}</p>
        </div>
      )}
      {am && al && (
        <div className="hud-legend-row">
          <p className="hud-legend-h"><small>{tr('标注', 'Marks')}</small><b>{am.label}</b>{am.subs.length > 0 && <span>{am.subs.find((x) => x.key === s)?.label}</span>}{al.example && <i className="hud-tag">{tr('示例', 'Example')}</i>}</p>
          <p className="hud-legend-line">{al.line}</p>
          {figure && <div className="hud-legend-fig">{figure}</div>}
        </div>
      )}
      {xgOn && (
        <div className="hud-legend-row">
          <p className="hud-legend-h"><small>Marks</small><b>Shot xG</b></p>
          <p className="hud-legend-line">If the player on the ball shot now: his chance of scoring, the goal as he sees it</p>
        </div>
      )}
      {offsideOn && (
        <div className="hud-legend-row">
          <p className="hud-legend-h"><small>Marks</small><b>Offside line</b></p>
          <p className="hud-legend-line">The defending side’s offside line: the second-last defender, or the ball</p>
        </div>
      )}
    </div>
  );
}
