import { useEffect, useRef, useState } from 'react';
import type { Clock } from '../clock';
import { useClockTime } from './useClockTime';
import { TEAM_LABEL, byMatchTime, fmtClock, hideClubs, type ClipCategory, type ClipEvent, type ClipIndex, type ClipPkg, type ClipRow } from './match';
import { OutcomeIcon } from './outcomeIcons';
import { Crest } from './crests';
import { eventLabel } from './eventNames';
import { tr, pick } from '../i18n';
import { attackingOf, playerTeam } from '../three/coords';
import { frames, drawMode, FRAME_VISIBLE_TOLERANCE_SECONDS, useStore } from './draft';
import { SHOT_TYPES } from '../football/events';
import { useDirectedIds, WHATIF_CLIPS } from './directed';
import { clipSwap, swapTarget } from '../game/clipSwap';

// The replay plate, bottom right (Yi, 2026-10-22): the player card's nameplate mirrored about the screen's centre line,
// its cut corner on the inner side. In the number's place the clip's team crest (A or B), in the name's the event, the
// expand button at the right. Under the rule, in the stamina's place: the match clock, then rewind, play and fast forward (no event
// ticks: over a whole match they would be impossibly dense, Yi), and the speed under the expand button (click for slow
// motion). Along the bottom edge, in the instant stamina's place, the progress bar itself (Yi): hovering it thickens it and
// shows a knob to drag; a click or a drag seeks. Expanded, it grows upward with two tabs, 事件 (this clip's events) and
// 片段 (the exported clips), each a list to click (ReplayTabs). ?replay=open opens it.
// The clock stays the 3D side's: the HUD only asks through `Playback`.

export interface Playback {
  playing: boolean;
  /** playback rate: 1 normal; 0.5 and 0.25 slow motion; 2, 4, 8 fast forward; -2, -4, -8 rewind */
  speed: number;
  /** the clip's length, seconds */
  duration: number;
  play: (on: boolean) => void;
  /** clip seconds */
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  /** load another clip (by its moment, e.g. pel-wil/shot-02-20); without it the clips tab cannot switch */
  gotoClip?: (moment: string) => void;
}

export interface ReplayPlateProps {
  pkg: ClipPkg; clock: Clock; index: ClipIndex | null; playback: Playback; looks?: { number: number; name: string }[];
  /** the per-mode players (Yi, 2026-10-23): watch switches clips only; tactics is an ordinary player (Yi, 2026-10-24: no
   *  snapping to events) that keeps the freeze frames, and steps a tenth of a second while the pen is on (画板 folded into
   *  战术); explain offers only the clips that have an Explain script (Yi, 2026-10-25), play and pause and the previous /
   *  next such clip (the 讲解 chat's narration holds the clock itself). Without it the plate is the general one */
  variant?: 'watch' | 'tactics' | 'explain' | 'whatif';
}

/** a tick on the progress bar: an event, a shot, a part's start, a freeze frame */
type Mark = { t: number; kind: 'event' | 'shot' | 'part' | 'frame' };


/** fast forward: 2, then 4, then 8, then back to normal; rewind the same backwards */
const faster = (s: number) => (s < 2 ? 2 : s < 8 ? s * 2 : 1);
const fasterBack = (s: number) => (s > -2 ? -2 : s > -8 ? s * 2 : 1);
const SLOW = [1, 0.5, 0.25];

/** the clip's title without its leading time and team, nor the trailing Opta xG: 射门被扑出 · 绝佳机会 */
/** a clip's name, short enough never to be cut off (Yi, 2026-10-24: no "…" anywhere, keep it simple; the badge beside
 *  it says the outcome): a goal its kind (Volley goal, Headed goal), a big chance "Big chance missed" whatever happened,
 *  another shot what happened to it (Header saved, Volley blocked), a pass its kind (Through ball, Chip, Long ball), an
 *  offside "Offside". `what` is the English title's part after the team */
function clipName(category: ClipCategory | undefined, what: string) {
  switch (category) {
    case 'bigchance': return 'Big chance missed';
    case 'penalty': return 'Penalty goal';
    case 'setpiece': return 'Set-piece goal';
    case 'post': return 'Hits the post';
    case 'offside': return 'Offside';
    case 'possession': return 'Great possession';
    case 'kickoff': return 'Kick-off';
    case 'goal': return what.split(',')[0];                      // Volley goal, 2nd attempt
    case 'attack': return what.replace(/ (splits|beats|over) .*$/, '');   // Through ball splits the back line
    default: return what;                                        // Shot saved, Header wide, 2 shots, no goal
  }
}

function shortTitle(pkg: ClipPkg, index: ClipIndex | null) {
  const m = pkg.meta as { title_zh?: string; title_en?: string; category?: ClipCategory }, raw = pick(m.title_zh, m.title_en) || pkg.meta.id;
  const teams = pkg.teams ?? (index ? { home: index.home, away: index.away } : null);
  const t = teams ? hideClubs(raw, teams) : raw;
  const parts = t.split(' · ').filter((x) => !x.startsWith('Opta'));
  if (m.category && parts.length > 1) return clipName(m.category, parts[1]);
  return parts.length > 1 ? parts.slice(1).join(' · ') : parts.join(' · ');
}

/** the same title from the clip index's row, for a clip not loaded yet (the one on its way in) */
function rowTitle(c: ClipRow, index: ClipIndex | null) {
  const raw = pick(c.title, c.title_en) || c.id, t = index ? hideClubs(raw, { home: index.home, away: index.away }) : raw;
  const parts = t.split(' · ').filter((x) => !x.startsWith('Opta'));
  if (c.category && parts.length > 1) return clipName(c.category, parts[1]);
  return parts.length > 1 ? parts.slice(1).join(' · ') : parts.join(' · ');
}

const OPEN_AT_LOAD = typeof location !== 'undefined' && new URLSearchParams(location.search).get('replay') === 'open';

/** after a clip is picked in the list, its row shows lit this long before the plate folds (ms) */
const FOLD_AFTER_MS = 450;
const LEAD = 0.5;                       // land this many seconds before an event

/** a clip's title as the list shows it: its time and what happened, without the team, the distance or the figures that
 *  the badges carry (2:20 · 头球偏出; 2:17 · 破后卫线 · 高压下出球) */
export function clipCaption(c: ClipRow) {
  // a line-breaking pass is just 破线传球, however many lines it broke (Yi); by the clip's kind, as the titles now say
  // how in plain words (挑传越过两道防线…, 2026-10-23)
  const parts = pick(c.title, c.title_en).split(' · ').filter((x) => !/^(Opta|预期成功率|随后射门|xPass|then a )/.test(x) && !/^\d+ (米|m)$/.test(x)).map((x, i) => (c.kind === 'pass' && i === 1 ? tr('破线传球', 'Line-breaking pass') : x));
  // the time and the clip's short name, as the plate's title (never cut off; Yi, 2026-10-24)
  if (c.category && c.title_en) return `${parts[0].split(' ')[0]} · ${clipName(c.category, c.title_en.split(' · ')[1] ?? '')}`;
  return [parts[0].split(' ')[0], ...parts.slice(1)].join(' · ');
}

/** a row's tags: categories only (goal, key pass, ...). No numbers such as xG or expected success: the replay is for a
 *  general audience, and those details belong to tactical mode (Yi) */
type Badge = { text: string; kind?: 'goal' | 'muted' | 'key' | 'explain' | 'whatif' };
/** a clip's tags: a goal for shots; a shot after it for passes; Explain where the clip has commentary (Yi, 2026-10-26: so
 *  the viewer knows which clips the Explain mode opens on) */
function clipBadges(c: ClipRow, explained = false, whatif = true): Badge[] {
  const b: Badge[] = c.kind === 'shot' ? (c.goal ? [{ text: tr('进球', 'Goal'), kind: 'goal' }] : []) : c.shot_after ? [{ text: tr('随后射门', 'Shot follows'), kind: 'key' }] : [];
  if (explained) b.push({ text: 'Explain', kind: 'explain' });
  if (whatif && WHATIF_CLIPS.has(c.id)) b.push({ text: 'What-if', kind: 'whatif' });   // a What-if moment in it (hud/directed.ts); not in the What-if player, where every clip has one
  return b;
}

/** an event's tags: a goal, a failed action, a key pass or assist, a line-breaking pass. An assist is
 *  a pass tagged Assist that a team-mate's goal follows within 20 s (the 3D side's note: a shot's IntentionalGoalAssist
 *  means the shot was assisted); an Assist-tagged pass without that goal shows as a key pass */
function eventBadges(e: ClipEvent, all: ClipEvent[]): Badge[] {
  const b: Badge[] = [];
  if (e.type === 'Goal') b.push({ text: tr('进球', 'Goal'), kind: 'goal' });
  const assist = e.type === 'Pass' && e.tags.includes('Assist') && all.some((g) => g.type === 'Goal' && g.shooting === e.shooting && g.t > e.t && g.t <= e.t + 20);
  if (assist) b.push({ text: tr('助攻', 'Assist'), kind: 'key' });
  else if (e.type === 'Pass' && (e.tags.includes('KeyPass') || e.tags.includes('Assist'))) b.push({ text: tr('关键传球', 'Key pass'), kind: 'key' });
  if (e.lb) b.push({ text: tr('破线传球', 'Line-breaking'), kind: 'key' });       // however many lines (Yi)
  if (e.tags.includes('BigChance')) b.push({ text: tr('绝佳机会', 'Big chance') });
  if (e.outcome === 'Unsuccessful' && !SHOT_TYPES.has(e.type)) b.push({ text: tr('未成功', 'Unsuccessful'), kind: 'muted' });
  return b;
}
const Badges = ({ list }: { list: Badge[] }) => <span className="hud-rbadges">{list.map((x, i) => <b key={i} className={x.kind ?? ''}>{x.text}</b>)}</span>;

/** Two tabs in the expanded replay plate (Yi: so the audience can go to the next event or the next clip; it replaced an
 *  iPod-like wheel, which showed only one step either way). 事件: this clip's synced events in time order, the current one
 *  (the last reached, from 0.5 s before it) highlighted and kept in view; a click lands 0.5 s before the event, paused. 片段: the
 *  exported clips in match time (grouped by kind until Yi, 2026-10-24), the current one highlighted; a click loads it. The arrow keys work while it is open:
 *  left and right the previous and next event, up and down the previous and next clip. */
function ReplayTabs({ pkg, t, index, pb, looks, live, only, keep, explained, whatifList, pulseNext, curId }: { pkg: ClipPkg; t: number; index: ClipIndex | null; pb: Playback; looks?: { number: number; name: string }[]; live: boolean;
  /** the clip shown as the current one: the clip on its way in from the click on, else the one on screen */ curId: string;
  /** one list without tabs (the preview's watch player: clips) */ only?: 'events' | 'clips';
  /** the clips offered (the explain player: those with a script); all without it */ keep?: (c: ClipRow) => boolean;
  /** the clips with commentary, tagged Explain (not in the explain player, where every clip has it) */ explained?: Set<string>;
  /** the What-if player's list: no What-if tag on its rows */ whatifList?: boolean;
  /** the clip has played to its end: the next clip's row pulses (Yi, 2026-10-26) */ pulseNext?: boolean }) {
  const [tabState, setTab] = useState<'events' | 'clips'>('events');
  const tab = only ?? tabState;
  // which team's events and clips: everything, then A (home), then B (away), one click per step (Yi)
  const [side, setSide] = useState<'all' | 'home' | 'away'>('all');
  const list = useRef<HTMLDivElement>(null);
  const attacking = attackingOf(pkg.meta), other = attacking === 'home' ? 'away' : 'home';
  const evs = [...(pkg.events ?? [])].sort((a, b) => a.t - b.t).filter((e) => side === 'all' || (e.shooting ? attacking : other) === side);
  // the current event: the last one reached, counting from LEAD s before it, so the row clicked is the row lit
  const cur = evs.reduce((k, e, i) => (e.t - LEAD <= t + 0.05 ? i : k), -1);
  // the clips in match time, not grouped by kind (Yi, 2026-10-24), so up and down step through the match too
  const clips = [...(index?.clips ?? [])].filter((c) => !keep || keep(c)).sort(byMatchTime), ci = clips.findIndex((c) => c.id === curId);
  const shownClips = clips.filter((c) => side === 'all' || c.team === side);
  const nextSide = () => setSide(side === 'all' ? 'home' : side === 'home' ? 'away' : 'all');
  // each row's team as a dot in its colour, even with the filter on (Yi, 2026-10-23): the class is the team, home blue
  // and away orange in every clip, as the kits (coords.ts, Yi 2026-10-23; until then attackers blue, defenders orange).
  // who: shirt number and name, as fans know players by name more than number (Yi: "7. Ronaldo"), in his team's colour
  const nAtt = pkg.frames[0]?.att.length ?? 11;
  const who = (p: number | null | undefined) => (p == null || !looks?.[p] ? null : <span className={`hud-rwho ${playerTeam(p, nAtt, attacking)}`}>{looks[p].number}. {looks[p].name}</span>);
  const jump = (e: ClipEvent | undefined) => { if (!e) return; pb.setSpeed(1); pb.play(false); pb.seek(Math.max(0, e.t - LEAD)); };
  const next = evs.find((e) => e.t - LEAD > t + 0.05), prev = [...evs].reverse().find((e) => e.t - LEAD < t - 0.3);
  // the previous and next clip among those the team filter shows (review F05), also when the current clip is the other team's
  const previousClip = [...shownClips].reverse().find((c) => clips.indexOf(c) < ci), nextClip = shownClips.find((c) => clips.indexOf(c) > ci);
  const go = { left: () => jump(prev), right: () => jump(next), up: () => { if (previousClip) pb.gotoClip?.(previousClip.moment); }, down: () => { if (nextClip) pb.gotoClip?.(nextClip.moment); } };
  const goRef = useRef(go); goRef.current = go;
  useEffect(() => {
    if (!live) return;
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      const d = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as Record<string, keyof typeof go>)[e.key];
      if (d) { goRef.current[d](); e.preventDefault(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [live]);
  // keep the current row in view (scrolling the list only, never the page)
  useEffect(() => {
    const box = list.current, row = box?.querySelector<HTMLElement>('.cur');
    if (!box || !row) return;
    if (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2;
  }, [cur, tab, ci]);
  return (
    <div className="hud-rtabs">
      <div className="hud-rtabs-head" role="tablist">
        {only !== 'clips' && <button type="button" role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>{tr('事件', 'Events')}<small>{evs.length}</small></button>}
        {only !== 'events' && <button type="button" role="tab" aria-selected={tab === 'clips'} onClick={() => setTab('clips')}>{tr('片段', 'Clips')}<small>{shownClips.length}</small></button>}
        {/* no previous / next arrows here (Yi, 2026-10-26: "a bit confusing"); the arrow keys still step through the clips */}
        <button type="button" className={`hud-rside${side === 'all' ? '' : ` ${side}`}`} aria-label={tr(`只看：${side === 'all' ? '全部' : TEAM_LABEL[side]}，点击切换`, `Showing ${side === 'all' ? 'both teams' : TEAM_LABEL[side]}; click to change`)} onClick={nextSide}>
          {side === 'all' ? tr('全部', 'Both') : TEAM_LABEL[side]}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9 H18 L14 5 M20 15 H6 L10 19" /></svg>
        </button>
      </div>
      <div className="hud-rtabs-list" ref={list} role="tabpanel">
        {tab === 'events' ? evs.map((e, i) => (
          <button type="button" key={i} className={`hud-rrow${i === cur ? ' cur' : ''}${SHOT_TYPES.has(e.type) ? ' shot' : ''}`} onClick={() => jump(e)}>
            <span className="hud-rrow-time">{fmtClock(e.clock)}</span>
            <i className={e.shooting ? attacking : other} aria-label={TEAM_LABEL[e.shooting ? attacking : other]} />
            <span className="hud-rrow-what">{who(e.player)} {eventLabel(e.type)}{e.receiver != null && looks?.[e.receiver] ? <> → {who(e.receiver)}</> : null}</span>
            <Badges list={eventBadges(e, evs)} />
          </button>
        )) : clips.map((c, k) => [c, k] as const).filter(([c]) => side === 'all' || c.team === side).map(([c, k]) => (
          <button type="button" key={c.id} className={`hud-rrow${k === ci ? ' cur' : ''}${pulseNext && c.id === nextClip?.id ? ' hud-attn' : ''}`} disabled={!pb.gotoClip} onClick={() => { if (k !== ci) pb.gotoClip?.(c.moment); }}>
            <i className={c.team} aria-label={TEAM_LABEL[c.team]} />
            <span className="hud-rrow-what">{clipCaption(c)}</span>
            <Badges list={clipBadges(c, !keep && !!explained?.has(c.id), !whatifList)} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** the clips with an Explain script (hud/directed.ts, probed once per page): the explain player offers only those (Yi,
 *  2026-10-25) */
const useDirected = useDirectedIds;

/** the tactics player's list: the saved freeze frames, a click goes to one (paused), each can be deleted, or all at once */
function FrameList({ pkg, pb, t }: { pkg: ClipPkg; pb: Playback; t: number }) {
  const fr = useStore(frames);
  return (
    <div className="hud-rtabs">
      <div className="hud-rtabs-head"><span className="hud-rtabs-title">Freeze frames<small>{fr.length}</small></span>
        <button type="button" className="hud-rside" disabled={!fr.length} onClick={() => frames.set([])}>Clear all</button>
      </div>
      <div className="hud-rtabs-list">
        {fr.length === 0 && <p className="hud-rempty">Draw on the paused picture: each drawing is kept here and ticks the timeline.</p>}
        {fr.map((f) => (
          <div key={f.t} className={`hud-rrow hud-frame${Math.abs(f.t - t) < FRAME_VISIBLE_TOLERANCE_SECONDS ? ' cur' : ''}`}>
            <button type="button" className="hud-frame-go" onClick={() => { pb.play(false); pb.seek(f.t); }}>
              <span className="hud-rrow-time">{fmtClock((pkg.clock0 ?? 0) + f.t)}</span>
              <span className="hud-rrow-what">{f.strokes.length} stroke{f.strokes.length === 1 ? '' : 's'}</span>
            </button>
            <button type="button" className="hud-frame-del" aria-label="Delete this freeze frame" onClick={() => frames.set((p) => p.filter((x) => x.t !== f.t))}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** the progress bar along the plate's bottom edge: thin at rest; on hover it thickens and a knob appears; click or drag
 *  to seek (pointer capture keeps the drag going off the bar) */
function Scrubber({ t, end, seek, marks }: { t: number; end: number; seek: (x: number) => void; marks?: Mark[] }) {
  const bar = useRef<HTMLDivElement>(null), [drag, setDrag] = useState(false);
  // a press within 6 px of a tick lands exactly on it (a pixel is about a tenth of a second)
  const at = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(end, Math.max(0, ((clientX - r.left) / r.width) * end)), snap = marks?.find((m) => Math.abs(m.t - x) <= (6 / r.width) * end);
    seek(snap ? snap.t : x);
  };
  const pct = `${(100 * Math.min(end, Math.max(0, t))) / end}%`;
  return (
    <div ref={bar} className={`hud-scrub${drag ? ' drag' : ''}`} role="slider" tabIndex={0} aria-label={tr('进度', 'Progress')} aria-valuemin={0} aria-valuemax={Math.round(end)} aria-valuenow={Math.round(t)}
      onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a scripted event has no pointer */ } setDrag(true); at(e.clientX); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e.clientX); }}
      onPointerUp={() => setDrag(false)} onPointerCancel={() => setDrag(false)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { seek(Math.min(end, Math.max(0, t + (e.key === 'ArrowLeft' ? -5 : 5)))); e.preventDefault(); e.stopPropagation(); } }}>
      <span className="hud-scrub-line"><i style={{ width: pct }} /></span>
      {marks?.map((m) => <span key={`${m.kind}${m.t}`} className={`hud-scrub-mark ${m.kind}`} style={{ left: `${(100 * m.t) / end}%` }} />)}
      <b className="hud-scrub-knob" style={{ left: pct }} />
    </div>
  );
}

const PLAY = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5 L19.5 12 L7 19.5 Z" fill="currentColor" /></svg>;
const PAUSE = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5 H10 V19.5 H6.5 Z M14 4.5 H17.5 V19.5 H14 Z" fill="currentColor" /></svg>;
const FWD = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6 L12 12 L3 18 Z M12 6 L21 12 L12 18 Z" fill="currentColor" /></svg>;
const BACK = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 6 L12 12 L21 18 Z M12 6 L3 12 L12 18 Z" fill="currentColor" /></svg>;
const PREV = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5 V19 M19 5 L9 12 L19 19 Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
const NEXT = <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5 V19 M5 5 L15 12 L5 19 Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
const STEP_BACK = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6 L9 12 L15 18" /></svg>;
const STEP_FWD = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6 L15 12 L9 18" /></svg>;
const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15 L12 9 L18 15" /></svg>
);

export function ReplayPlate({ pkg, clock, index, playback: pb, looks, variant }: ReplayPlateProps) {
  const t = useClockTime(clock, 20);
  const [expanded, setExpanded] = useState(OPEN_AT_LOAD);
  // collapsed, the list is inert: none of its buttons can take focus while hidden (review F09); focus inside it goes back
  // to the expand button first
  const moreRef = useRef<HTMLDivElement>(null), toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const more = moreRef.current;
    if (!more) return;
    if (!expanded && more.contains(document.activeElement)) toggleRef.current?.focus();
    more.inert = !expanded;
  }, [expanded]);
  // another clip picked (a clip changes in place, game/clipSwap.ts): it is the plate's clip from the click on, its row lit
  // and its title, crest and outcome in the head, and the plate folds back to its compact form a moment later, once the
  // new row has shown (Yi, 2026-10-26: "show that this new clip is selected, instead of still showing the old clip", and
  // the fold no longer waits for the load). A clip that comes in otherwise ([ ], the browser's back) folds it as it lands
  const target = useStore(swapTarget), pending = target ? index?.clips.find((c) => c.moment === target) : undefined;
  const curId = pending?.id ?? pkg.meta.id;
  useEffect(() => { if (!pending) return; const k = window.setTimeout(() => setExpanded(false), FOLD_AFTER_MS); return () => window.clearTimeout(k); }, [pending]);
  const lastClip = useRef(curId);
  useEffect(() => { if (curId !== lastClip.current) { lastClip.current = curId; if (!pending) setExpanded(false); } }, [curId, pending]);
  const end = Math.max(1e-6, pb.duration), now = (pkg.clock0 ?? 0) + t;
  // played to its end: the arrows pulse, to send the viewer on to another clip (Yi, 2026-10-26); the next clip's row when
  // the list is open, else the button that opens it. In Watch only: the other modes send the viewer back to Watch instead
  // (TopBar's Back to Watch)
  const swapping = useStore(clipSwap) !== 'off';
  const finished = variant === 'watch' && !pb.playing && t >= end - 0.1 && !swapping;
  // the clip's team (the attacking one): its crest, and the plate in its kit colour, home blue or away orange (the plate
  // was always blue until 2026-10-23, the attacking kit)
  const team = pending?.team ?? attackingOf(pkg.meta);
  const ff = pb.playing && pb.speed > 1, rw = pb.playing && pb.speed < 0;
  // play: back to normal speed while fast forwarding or rewinding, else play or pause
  const onPlay = () => { if (pb.playing && pb.speed !== 1 && pb.speed > 0.99) pb.setSpeed(1); else if (pb.speed < 0) { pb.setSpeed(1); pb.play(true); } else pb.play(!pb.playing); };
  const onFwd = () => { pb.setSpeed(faster(pb.speed)); pb.play(true); };
  const onBack = () => { pb.setSpeed(fasterBack(pb.speed)); pb.play(true); };
  const onSlow = () => { const k = SLOW.indexOf(pb.speed); pb.setSpeed(SLOW[(k + 1) % SLOW.length]); };

  // ---- the per-mode players
  // explain: only the clips with a script, and the previous / next of them; the other players tag those clips Explain
  const directed = useDirected(index);
  const explainable = variant === 'explain' ? [...(index?.clips ?? [])].filter((c) => directed.has(c.id)).sort(byMatchTime) : [];
  const ei = explainable.findIndex((c) => c.id === pkg.meta.id);
  const prevEx = ei > 0 ? explainable[ei - 1] : undefined, nextEx = ei < 0 ? explainable[0] : explainable[ei + 1];
  // tactics keeps the freeze frames (yellow ticks, a press near one snaps to it; every drawing saves itself, hud/draft.ts
  // syncFrame); with the pen on (Yi, 2026-10-25) it steps a tenth of a second at a time instead of rewinding and fast
  // forwarding
  const fr = useStore(frames), pen = useStore(drawMode);
  const keepsFrames = variant === 'tactics', stepping = keepsFrames && pen;
  const onFrame = keepsFrames && fr.some((f) => Math.abs(f.t - t) < FRAME_VISIBLE_TOLERANCE_SECONDS);
  const step = (d: number) => { pb.play(false); pb.seek(Math.min(end, Math.max(0, t + d))); };

  const marks: Mark[] | undefined = keepsFrames ? fr.map((f) => ({ t: f.t, kind: 'frame' })) : undefined;
  const title = pending ? rowTitle(pending, index) : onFrame ? `Freeze frame at ${fmtClock(now)}` : shortTitle(pkg, index);
  // the clip's outcome badge, right of its title (Yi, 2026-10-24: set D); only where the title is the clip's own
  const outcome = pending ? pending.category : (pkg.meta as { category?: ClipCategory }).category;
  const ownTitle = !!pending || !onFrame;
  const pulseNext = finished && expanded;
  const list = variant === 'watch' ? <ReplayTabs pkg={pkg} t={t} index={index} pb={pb} looks={looks} live={expanded} only="clips" explained={directed} pulseNext={pulseNext} curId={curId} />
    : variant === 'explain' ? <ReplayTabs pkg={pkg} t={t} index={index} pb={pb} looks={looks} live={expanded} only="clips" keep={(c) => directed.has(c.id)} pulseNext={pulseNext} curId={curId} />
    // What-if: only the clips with an approved moment (hud/directed.ts WHATIF_CLIPS); a pick plays its moment in (whatif/useWhatIf.tsx)
    : variant === 'whatif' ? <ReplayTabs pkg={pkg} t={t} index={index} pb={pb} looks={looks} live={expanded} only="clips" keep={(c) => WHATIF_CLIPS.has(c.id)} whatifList pulseNext={pulseNext} curId={curId} />
    : keepsFrames ? <FrameList pkg={pkg} pb={pb} t={t} />
    : <ReplayTabs pkg={pkg} t={t} index={index} pb={pb} looks={looks} live={expanded} explained={directed} curId={curId} />;

  const transport = variant === 'explain' ? <>
      <button type="button" aria-label="Previous explained clip" disabled={!prevEx || !pb.gotoClip} onClick={() => { if (prevEx) pb.gotoClip?.(prevEx.moment); }}>{PREV}</button>
      <button type="button" className="hud-transport-play" aria-label={pb.playing ? 'Pause' : 'Play'} onClick={onPlay}>{pb.playing && pb.speed === 1 ? PAUSE : PLAY}</button>
      <button type="button" className={finished && nextEx ? 'hud-attn' : undefined} aria-label="Next explained clip" disabled={!nextEx || !pb.gotoClip} onClick={() => { if (nextEx) pb.gotoClip?.(nextEx.moment); }}>{NEXT}</button>
    </> : stepping ? <>
      <button type="button" aria-label="Back a tenth of a second" onClick={() => step(-0.1)}>{STEP_BACK}</button>
      <button type="button" className="hud-transport-play" aria-label={pb.playing ? 'Pause' : 'Play'} onClick={onPlay}>{pb.playing && pb.speed === 1 ? PAUSE : PLAY}</button>
      <button type="button" aria-label="Forward a tenth of a second" onClick={() => step(0.1)}>{STEP_FWD}</button>
    </> : <>
      <button type="button" className={rw ? 'on' : ''} aria-label={tr('倒放（再点更快）', 'Rewind (again for faster)')} onClick={onBack}>{BACK}</button>
      <button type="button" className="hud-transport-play" aria-label={pb.playing && pb.speed === 1 ? tr('暂停', 'Pause') : tr('播放', 'Play')} onClick={onPlay}>{pb.playing && pb.speed === 1 ? PAUSE : PLAY}</button>
      <button type="button" className={ff ? 'on' : ''} aria-label={tr('快进（再点更快）', 'Fast forward (again for faster)')} onClick={onFwd}>{FWD}</button>
    </>;
  const corner = variant === 'explain' ? <span className="hud-replay-speed" aria-hidden="true" />   // no speeds: the commentary keeps time
    : <button type="button" className={`hud-replay-speed${pb.speed !== 1 ? ' on' : ''}`} aria-label={tr(`速度 ${pb.speed} 倍，点击慢放`, `Speed ${pb.speed}×, click for slow motion`)} onClick={onSlow}>{pb.speed < 0 ? `−${-pb.speed}` : pb.speed}×</button>;

  return (
    <div className="hud-replay">
      <div className={`hud-plate hud-plate-mirror hud-glass ${team}`} aria-label={tr('回放', 'Replay')}>
        <div className="hud-plate-head">
          <span className="hud-plate-no hud-replay-crest" aria-label={TEAM_LABEL[team]}><Crest team={team} size={32} /></span>
          <span className="hud-replay-title" title={title}>{title}</span>
          {ownTitle && outcome && <OutcomeIcon category={outcome} size={20} />}
          <button ref={toggleRef} type="button" className={`hud-plate-toggle${finished && !expanded ? ' hud-attn' : ''}`} aria-expanded={expanded} aria-label={expanded ? 'Collapse the replay controls' : 'Expand the replay controls'} onClick={() => setExpanded(!expanded)}>{CHEVRON}</button>
        </div>
        <i className="hud-plate-rule" />
        <div ref={moreRef} className={`hud-plate-more${expanded ? ' open' : ''}`} aria-hidden={!expanded}>
          <div>{list}<i className="hud-plate-rule" /></div>
        </div>
        <div className="hud-stam hud-replay-row">
          <span className="hud-stam-label hud-replay-clock">{fmtClock(now)}</span>
          <span className="hud-transport">{transport}</span>
          {corner}
        </div>
        <Scrubber t={t} end={end} seek={pb.seek} marks={marks} />
      </div>
    </div>
  );
}
