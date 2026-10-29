import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Clock } from '../clock';
import type { Look } from '../three/players/looks';
import { useGameSettings } from '../game/settings';
import { useClockTime } from './useClockTime';
import { FullStats, StatRow } from './FullStats';
import { TEAM_LABEL, fmtClock, type Booking, type ClipPkg } from './match';
import { DEFAULT_KEYS, estimateRoles, instantStamina, matchStaminaExample, matchStaminaReal, matchStatsExample, nAttOf, realStats, roleFromLineup, roleFromShape, ROLE_POSITION, sampleAt, speedAt, staminaBand, statCatalogue, type Role, type StatEntry } from './playerStats';
import { tr } from '../i18n';
import { attackingOf, playerTeam } from '../three/coords';
/** a booking's name */
const CARD_NAME: Record<string, string> = { red: tr('红牌', 'Red card'), yellow: tr('黄牌', 'Yellow card'), 'second-yellow': tr('两黄变一红', 'Second yellow') };

// The player card, bottom left. With nobody selected, the nameplate's shape greyed out. With a player selected the
// default is a nameplate, as in eFootball or FC: shirt number and name (the team shows by colour alone), the expand
// button, the match stamina as a labelled bar, and the instant stamina as a thin bar along the very bottom edge, no label
// or number, only how far it has drained.
// Expanded, the card grows upward: the name moves to the top, the stamina stays at the bottom, and in between come the
// cartoon portrait (role and live speed on it) and this match's numbers so far, eight entries chosen by role. Under them
// a light strip of stacked arrows scrolls the card's middle up a page: the portrait goes out of view and the full stats
// come in. Information only,
// no actions. ?card=open opens the card at load, ?card=full also the full stats, for the screenshots.

export interface PlayerCardProps {
  pkg: ClipPkg; clock: Clock; looks: Look[];
  /** the score now, home first: a keeper's 失球 */
  score: [number, number];
  /** the cartoon portrait of player p (an image URL), from the 3D side; without it a silhouette holds the place */
  portraitOf?: (p: number) => string | null;
}

/** the match stamina: a short label under the shirt number, the bar from the name's left edge, the number at the right */
function StaminaRow({ label, value }: { label: string; value: number }) {
  const v = Math.round(value);
  return (
    <div className="hud-stam">
      <span className="hud-stam-label">{label}</span>
      <span className="hud-stam-bar"><i className={staminaBand(value)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
      <b>{v}</b>
    </div>
  );
}

/** the instant stamina: a thin bar along the card's bottom edge, the remaining part filled */
function InstantBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return <span className="hud-plate-instant" role="meter" aria-label={tr('瞬时体能', 'Stamina right now')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} title={tr(`瞬时体能 ${Math.round(v)}`, `Stamina right now ${Math.round(v)}`)}><i className={staminaBand(v)} style={{ width: `${v}%` }} /></span>;
}

/** a chevron: up to expand the card (it grows upward), down to collapse it */
const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15 L12 9 L18 15" /></svg>
);

/** the eight entries, two columns by four rows */
function StatsGrid({ entries }: { entries: StatEntry[] }) {
  return (
    <dl className="hud-stats">
      {entries.map((e) => <StatRow key={e.label} e={e} />)}
    </dl>
  );
}

/** the player's cards so far, to the right of his role: a small upright card each, yellow or red; a second yellow shows
 *  as a yellow card with a red one over it */
function Bookings({ list }: { list: Booking[] }) {
  if (!list.length) return null;
  return (
    <span className="hud-bookings">
      {list.map((b, i) => (
        <i key={i} className={`hud-booking ${b.kind}`} title={`${CARD_NAME[b.kind]} ${fmtClock(b.clock)}`} aria-label={`${CARD_NAME[b.kind]}, ${fmtClock(b.clock)}`} />
      ))}
    </span>
  );
}

/** the portrait's stand-in until the 3D side renders portraits: a head-and-shoulders silhouette */
const SILHOUETTE = (
  <svg className="hud-portrait-sil" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="44" r="21" /><path d="M18 120 C18 92 36 78 60 78 C84 78 102 92 102 120 Z" />
  </svg>
);

/** stacked arrows: pointing down in the brief view (more below), turned up in the full view (back up) */
const STACK = (
  <svg width="18" height="14" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3 L12 9 L18 3 M6 9 L12 15 L18 9" /></svg>
);

/** Two pages one above the other in a window that shows one of them, both as tall as the taller one (the card
 *  never changes size), so switching only moves the pages up or down a page inside a fixed window. Both stay mounted;
 *  their natural heights are measured on inner boxes (ResizeObserver), the padded heights set on the pages. */
function PageScroll({ first, second, showSecond }: { first: ReactNode; second: ReactNode; showSecond: boolean }) {
  const a = useRef<HTMLDivElement>(null), b = useRef<HTMLDivElement>(null);
  const [H, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const measure = () => { if (a.current && b.current) setH(Math.max(a.current.offsetHeight, b.current.offsetHeight)); };
    measure();
    const ro = new ResizeObserver(measure);
    if (a.current) ro.observe(a.current);
    if (b.current) ro.observe(b.current);
    return () => ro.disconnect();
  }, []);
  const page = H === null ? undefined : { height: H };
  return (
    <div className="hud-pages" style={page}>
      <div className="hud-pages-track" style={H === null ? undefined : { transform: `translateY(${showSecond ? -H : 0}px)` }}>
        <div className="hud-page" style={page} aria-hidden={showSecond}><div ref={a} className="hud-page-inner">{first}</div></div>
        <div className="hud-page" style={page} aria-hidden={!showSecond}><div ref={b} className="hud-page-inner">{second}</div></div>
      </div>
    </div>
  );
}

const CARD_AT_LOAD = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('card');

const PERSON = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="8.5" r="3.6" /><path d="M4.5 20.5 C4.5 16.2 7.9 14.4 12 14.4 C16.1 14.4 19.5 16.2 19.5 20.5" />
  </svg>
);

export function PlayerCard({ pkg, clock, looks, score, portraitOf }: PlayerCardProps) {
  const { selected } = useGameSettings();
  const t = useClockTime(clock, 12);
  // a selection the clip does not have (?sel=-1, or an index from a bigger clip) shows the empty card (review F01)
  const validSelected = selected !== null && selected >= 0 && selected < looks.length ? selected : null;
  const instant = useMemo(() => instantStamina(pkg), [pkg]);
  const look = validSelected !== null ? looks[validSelected] : undefined;
  const [expanded, setExpanded] = useState(CARD_AT_LOAD === 'open' || CARD_AT_LOAD === 'full');
  const [full, setFull] = useState(CARD_AT_LOAD === 'full');
  // positions from what was really played (MA33 roles), else the export's line-up, else the estimate from the tracking
  const roles = useMemo(() => {
    const est = estimateRoles(pkg, looks.map((l, i) => (l.keeper ? i : -1)).filter((i) => i >= 0)), nAtt = nAttOf(pkg);
    // each side's shape in each phase, with the codes its players had in it (efPosition reads both)
    const shapeOf = (side: 'att' | 'def', lo: number, hi: number) => {
      const sh = pkg.shapes?.[side];
      if (!sh) return undefined;
      const codes = (ph: 'in' | 'out') => new Set((pkg.roles ?? []).slice(lo, hi).map((x) => x?.[ph]).filter((c): c is string => !!c));
      return { in: { ...sh.in, codes: codes('in') }, out: { ...sh.out, codes: codes('out') } };
    };
    const shapes = { att: shapeOf('att', 0, nAtt), def: shapeOf('def', nAtt, est.length) };
    return est.map((r, p): { label: string; role: Role } => roleFromShape(pkg.roles?.[p], p < nAtt, shapes[p < nAtt ? 'att' : 'def']) ?? roleFromLineup(pkg.lineup?.[p]) ?? { label: ROLE_POSITION[r], role: r });
  }, [pkg, looks]);

  if (validSelected === null || !look) {
    // nobody selected: the nameplate's own shape, greyed, so the corner does not jump when a player is picked
    return (
      <div className="hud-card">
        <div className="hud-plate hud-glass empty" aria-label={tr('球员卡：未选中球员', 'Player card: no player selected')}>
          <div className="hud-plate-head">
            <span className="hud-plate-no hud-empty-icon">{PERSON}</span>
            <span className="hud-plate-name hud-empty-name">{tr('未选中球员', 'No player selected')}<small>Click a player or a radar dot</small></span>
            <button type="button" className="hud-plate-toggle" disabled aria-label={tr('展开球员卡（先选中一名球员）', 'Expand the player card (pick a player first)')}>{CHEVRON}</button>
          </div>
          <i className="hud-plate-rule" />
          <div className="hud-stam">
            <span className="hud-stam-label">{tr('体能', 'Stamina')}</span>
            <span className="hud-stam-bar" />
            <b>—</b>
          </div>
          <span className="hud-plate-instant" />
        </div>
      </div>
    );
  }
  // his team, whose kit colour the plate takes (home blue, away orange in every clip: coords.ts)
  const side = playerTeam(validSelected, nAttOf(pkg), attackingOf(pkg.meta));
  const now = (pkg.clock0 ?? 0) + t, info = roles[validSelected] ?? { label: tr('中场', 'Midfielder'), role: '中场' as Role }, role = info.role, portrait = portraitOf?.(validSelected) ?? null;
  // measured where the export has it (running, events), examples otherwise (top speed and sprints always, for now)
  const example = matchStatsExample(validSelected, role, now);
  const stats = pkg.match_events ? realStats(pkg, validSelected, t, example) : example, conceded = side === 'home' ? score[1] : score[0];
  const stamina = pkg.run ? matchStaminaReal(pkg, validSelected, look.keeper, t) : matchStaminaExample(validSelected, look.keeper, now);
  const catalogue = statCatalogue(role, stats, conceded, now), entries = DEFAULT_KEYS[role].map((k) => catalogue[k]);
  // collapsing the card also leaves the full stats, so it reopens on the portrait
  const toggle = () => { if (expanded) setFull(false); setExpanded(!expanded); };
  return (
    <div className="hud-card">
      <div className={`hud-plate hud-glass ${side}`} aria-label={tr(`${TEAM_LABEL[side]} ${look.number} 号 ${look.name}`, `${TEAM_LABEL[side]} number ${look.number} ${look.name}`)}>
        <div className="hud-plate-head">
          <span className="hud-plate-no">{look.number}</span>
          <span className="hud-plate-name">{look.name}</span>
          {/* no GK tag by a keeper's name since the portrait says GK (it would show twice) */}
          <button type="button" className="hud-plate-toggle" aria-expanded={expanded} aria-label={expanded ? tr('收起球员卡', 'Collapse the player card') : tr('展开球员卡', 'Expand the player card')} onClick={toggle}>{CHEVRON}</button>
        </div>
        <i className="hud-plate-rule" />
        <div className={`hud-plate-more${expanded ? ' open' : ''}`} aria-hidden={!expanded}>
          <div>
            <PageScroll showSecond={full}
              first={<>
                <div className="hud-portrait">
                  {portrait ? <img src={portrait} alt="" /> : SILHOUETTE}
                  <span className="hud-portrait-role"><span className="hud-portrait-what">{info.label}</span><Bookings list={(pkg.cards ?? []).filter((b) => b.player === validSelected && b.clock <= now)} /></span>
                  <span className="hud-portrait-speed"><small>{tr('当前速度', 'Speed')}</small><b>{speedAt(pkg, validSelected, t).toFixed(1)}</b><small>km/h</small></span>
                </div>
                {/* the same stats in every mode (the 战术 numbers, ΔxT, xG, xGOT, xA, potential xA, are retired) */}
                <StatsGrid entries={entries} />
              </>}
              second={<>
                <FullStats role={role} entries={catalogue} />
              </>} />
            <button type="button" className="hud-more-strip" aria-expanded={full} aria-label={full ? tr('收起全部数据', 'Fewer stats') : tr('展开全部数据', 'All stats')} tabIndex={expanded ? 0 : -1} onClick={() => setFull(!full)}>{STACK}</button>
            <i className="hud-plate-rule" />
          </div>
        </div>
        <StaminaRow label={tr('体能', 'Stamina')} value={stamina} />
        <InstantBar value={sampleAt(instant[validSelected], t, pkg.meta.fps)} />
      </div>
    </div>
  );
}
