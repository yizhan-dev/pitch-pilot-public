import { useEffect, useMemo } from 'react';
import type { Clock } from '../clock';
import type { Look } from '../three/players/looks';
import { getSettings, setSettings, setMode, toggleLayer, useGameSettings, LAYERS } from '../game/settings';
import { getPanel, setPanel, togglePanel } from './panel';
import { useClockTime } from './useClockTime';
import { scoreAt, addedAt, TEAM_LABEL, type ClipIndex, type ClipPkg } from './match';
import { TopBar } from './TopBar';
import { PlayerCard } from './PlayerCard';
import { Minimap } from './Minimap';
import { TacticsRail } from './TacticsRail';
import { AnalysisLegend } from './AnalysisLegend';
import { drawMode, useDrawingPlayback, useStore } from './draft';
import { explainable, whatifable, hasDirector, momentOf, nextClipOf, WHATIF_CLIPS } from './directed';
import { varReplay, varCheckOf, startVar, endVar, varActive, VAR_OFF } from '../game/varReplay';
import { clipSwap } from '../game/clipSwap';
import { MatchSummary } from '../summary/MatchSummary';
import { summaryOpen, openSummary, closeSummary, loadSummary } from '../summary/summary';
import { ReplayPlate, clipCaption, type Playback } from './ReplayPlate';
import { VIEW_UI, viewBlocked } from './views';

// The game UI's HUD (?ui=game): DOM overlays above the 3D pitch, nothing drawn in 3D. It reads and writes
// src/game/settings.ts and only reads the clock. Mount it over the canvas, inside a positioned parent; the root lets
// clicks through to the pitch except on its own controls. Props and usage: docs/plans/hud-notes.md.

export interface HudProps {
  /** the clip package on screen (loadMoment(...).pkg) */
  pkg: ClipPkg;
  /** the shared playback clock, seconds from the package's start */
  clock: Clock;
  /** the players' cartoon looks, the same as the pitch's (makeLooks), for shirt numbers */
  looks: Look[];
  /** pel-wil/index.json, for the score and the level select; null until loaded */
  index: ClipIndex | null;
  /** playback control for the replay plate (bottom right): play, seek, speed; the clock stays the owner's. Without it the
   *  plate is not shown */
  playback?: Playback;
  /** the cartoon portrait of player p as an image URL, rendered by the 3D side; the card shows a silhouette without it */
  portraitOf?: (p: number) => string | null;
  /** bind the HUD's keys (the views' digits, M the mode menu, V the view menu, R the radar, in the 战术 mode the display switches' letters,
   *  Esc closes a panel); default true */
  keys?: boolean;
  /** the designs Yi is still judging in the HUD preview (2026-10-23: the 战术 mode's analysis layers); leave it off in
   *  ?ui=game until he accepts them */
  draft?: boolean;
}

export function Hud({ pkg, clock, looks, index, portraitOf, playback, keys = true, draft = false }: HudProps) {
  const t = useClockTime(clock);
  const now = (pkg.clock0 ?? 0) + t;
  const score = useMemo(() => scoreAt(pkg, index, now), [pkg, index, now]);
  const bug = { home: TEAM_LABEL.home, away: TEAM_LABEL.away, score, clock: now, added: addedAt(index, pkg.meta.half, now) };
  const hasOfficials = !!pkg.officials?.joints;

  // keys: 1-8 pick a view (src/hud/views.ts; the player views need a selection, the officials' views their tracking);
  // M opens or closes the mode menu, V the view menu, R shows or hides the radar (Yi, 2026-10-26, in place of Q cycling
  // through the modes; R was the broadcast view, M the radar); Esc closes the open panel and marks the event handled
  // (defaultPrevented), so the pitch can keep Esc for clearing the selection when no panel is open
  useEffect(() => {
    if (!keys) return;
    const down = (e: KeyboardEvent) => {
      // (none while a clip changes in place: the camera and the board belong to the change then)
      if (e.ctrlKey || e.metaKey || e.altKey || clipSwap.get() !== 'off' || (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') { if (getPanel()) { setPanel(null); e.preventDefault(); } return; }
      // (over the match summary no mode, view or radar keys either, as their buttons are off: TopBar)
      if (summaryOpen.get() && /^[mvrMVR0-9]$/.test(e.key)) return;
      if (e.key === 'm' || e.key === 'M') { togglePanel('mode'); return; }
      if (e.key === 'v' || e.key === 'V') { togglePanel('view'); return; }
      if (e.key === 'r' || e.key === 'R') { if (getSettings().mode !== 'tactics') toggleLayer('map'); return; }    // the radar, LAYERS' hotkey (none in 战术, Yi 2026-10-25)
      // the old display switches' letters (LAYERS' hotkeys), only where those switches still show: the 战术 mode of the
      // preview's ?current=1. The game's 战术 column has none of them (its marks replaced them, chat 3's request 10,
      // 2026-10-25), so there the letters do nothing
      const l = !draft && getSettings().mode === 'tactics' ? LAYERS.find((x) => x.hotkey.toLowerCase() === e.key.toLowerCase()) : undefined;
      if (l) { toggleLayer(l.key); return; }
      const v = VIEW_UI.find((x) => x.hotkey === e.key);
      if (v && !viewBlocked(v, getSettings().selected, hasOfficials, getSettings().tactical)) setSettings({ view: v.key });
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [keys, hasOfficials, draft]);

  // a press outside the open panel and its button closes the panel
  useEffect(() => {
    const press = (e: PointerEvent) => {
      if (!getPanel()) return;
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.('[data-hud-pop], [data-hud-toggle]')) setPanel(null);
    };
    document.addEventListener('pointerdown', press, true);
    return () => document.removeEventListener('pointerdown', press, true);
  }, []);

  // the Explain mode only where the clip has a director script (Yi, 2026-10-26: Watch is the way into every clip); an
  // address or a clip change that lands in Explain without one falls back to Watch
  const { mode } = useGameSettings(), moment = momentOf(pkg), ok = useStore(explainable), wiOk = WHATIF_CLIPS.has(pkg.meta.id);
  useEffect(() => { whatifable.set(wiOk); }, [wiOk]);
  useEffect(() => {
    let live = true;
    explainable.set(null);
    hasDirector(moment).then((v) => { if (live) explainable.set(v); });
    return () => { live = false; };
  }, [moment]);
  useEffect(() => { if (ok === false && mode === 'explain') setMode('watch'); }, [ok, mode]);
  // the same for What-if, on a clip without a moment (its own list only loads clips with one)
  useEffect(() => { if (!wiOk && mode === 'whatif') setMode('watch'); }, [wiOk, mode]);

  // the VAR check (game/varReplay.ts; Yi, 2026-10-26): on an offside clip in Watch, from the pass to the clip's end, a
  // pulsing VAR button left of Radar. Play, a seek, or the button again ends it; a new clip or another mode drops it
  const check = useMemo(() => varCheckOf({ pkg: pkg as never }), [pkg]), vr = useStore(varReplay), varOn = varActive(vr);
  useEffect(() => { varReplay.set(VAR_OFF); }, [pkg]);
  useEffect(() => { if (mode !== 'watch' && varReplay.get().phase !== 'off') varReplay.set(VAR_OFF); }, [mode]);
  // from the pass's feed time, or the kick's if the ball left a moment earlier (the check returns the clip to the kick)
  const varBtn = playback && check && mode === 'watch' && (t >= Math.min(check.from, check.t) - 0.05 || vr.phase !== 'off')
    ? { on: varOn, toggle: () => (varOn ? endVar() : vr.phase === 'off' && startVar(check, getSettings().view, playback.play)) } : null;
  const pb: Playback | undefined = playback && {
    ...playback,
    play: (p) => { if (p && varActive()) endVar(playback.play); else playback.play(p); },
    seek: (x) => { if (varActive()) endVar(); playback.seek(x); },
  };

  // played to its end: a button at the top centre (Yi, 2026-10-26). In Watch it plays the next clip; in the other modes
  // it goes back to Watch ("in these tabs, the center top button would be: go back to watch mode"), on the same clip
  const swapping = useStore(clipSwap) !== 'off';
  const finished = !!playback && !playback.playing && t >= playback.duration - 0.1 && vr.phase === 'off' && !swapping;
  const next = finished && mode === 'watch' ? nextClipOf(index, pkg.meta.id) : null, backToWatch = finished && mode !== 'watch';
  // the match summary (summary/, Yi 2026-10-26): offered at the end of the last clip in Watch, in place of Play Next Clip;
  // it closes with another clip or mode
  const sumOpen = useStore(summaryOpen), lastClip = finished && mode === 'watch' && !!index && !next;
  useEffect(() => { if (lastClip) void loadSummary(); }, [lastClip]);
  useEffect(() => { closeSummary(); }, [pkg.meta.id]);
  useEffect(() => { if (mode !== 'watch') closeSummary(); }, [mode]);
  useEffect(() => { if (playback?.playing) closeSummary(); }, [playback?.playing]);   // play again: the clip, not the summary

  // the drawings follow playback: unsaved strokes fade when play resumes (the preview stage and the 3D overlay both read it)
  useDrawingPlayback(!!playback?.playing);
  // the per-mode replay player (Yi, 2026-10-23): watch, explain, tactics (an ordinary player, with the pen's freeze frames
  // and steps), What-if (the clips with an approved moment, the What-if chat at Yi's word, 2026-10-26: "they should be just
  // in media player")
  // explain: only the clips with a director script (explain/director.ts, chat 4) and play / pause; its stand-in parts,
  // which paused on their own against the narration's holds, are gone (Yi, 2026-10-25)
  const variant = draft ? (mode === 'explain' ? 'explain' : mode === 'tactics' ? 'tactics' : mode === 'whatif' ? 'whatif' : 'watch') : undefined;
  return (
    <div className={`hud${swapping ? ' hud-swapping' : ''}${sumOpen ? ' hud-summary' : ''}`}>
      <TopBar bug={sumOpen ? { ...bug, label: 'FT' } : bug} hasOfficials={hasOfficials} varBtn={varBtn} backToWatch={backToWatch ? () => { drawMode.set(false); setMode('watch'); } : null} />
      {next && playback?.gotoClip && (
        <button type="button" className="hud-nextclip hud-glass" title={`Play ${clipCaption(next)}`} onClick={() => playback.gotoClip?.(next.moment)}>
          <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M0 0 L10 6 L0 12 Z" fill="currentColor" /></svg><b>Play Next Clip</b>
        </button>
      )}
      {lastClip && !sumOpen && (
        <button type="button" className="hud-nextclip hud-glass" title="The match in numbers: stats, passing, attacks, heat maps, the player of the match, running" onClick={openSummary}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M0 12 V7 H3 V12 Z M4.5 12 V2 H7.5 V12 Z M9 12 V5 H12 V12 Z" fill="currentColor" /></svg><b>Match Summary</b>
        </button>
      )}
      {sumOpen && <MatchSummary portrait={(pid) => { const i = ((pkg as unknown as { players?: { pid: string }[] }).players ?? []).findIndex((x) => x.pid === pid); return i >= 0 ? portraitOf?.(i) ?? null : null; }} />}

      <PlayerCard pkg={pkg} clock={clock} looks={looks} score={score} portraitOf={portraitOf} />
      <Minimap pkg={pkg} clock={clock} looks={looks} />
      <TacticsRail draft={draft} clock={clock} playback={playback} />
      {draft && <AnalysisLegend pkg={pkg} clock={clock} looks={looks} />}
      {pb && <ReplayPlate pkg={pkg} clock={clock} index={index} playback={pb} looks={looks} variant={variant} />}
    </div>
  );
}
