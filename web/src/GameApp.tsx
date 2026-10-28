import { matchFile, clipAddr, parseClip } from './data/paths';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Stage } from './three/Stage';
import { loadMoment, duration, type Loaded } from './data';
import { makeClock } from './clock';
import { makeLooks, keepersOf } from './three/players/looks';
import { clipLooks, loadRoster, type Roster } from './lineup/roster';
import { useGameSettings, setSettings, getSettings, toggleTactical, type ViewMode } from './game/settings';
import { Hud } from './hud/Hud';
import { PitchOverlay3D } from './hud/PitchOverlay3D';
import { drawMode, useStore } from './hud/draft';
import type { Playback } from './hud/ReplayPlate';
import { PauseWindow } from './pause/PauseWindow';
import type { ClipIndex, ClipPkg } from './hud/match';
import { byMatchTime } from './hud/match';
import './styles/hud.css';
import './styles/phone.css';   // (after hud.css: a phone's layout, its rules win)
import { LineupShow, type LineupFile } from './lineup/LineupShow';
import { loadClips, synthFromPositions } from './whatif/motion';
import { useWhatIf } from './whatif/useWhatIf';
import { matchEnds } from './three/coords';
import { explainTick } from './explain/director';
import { ExplainPlayer } from './explain/ExplainPlayer';
import { varReplay, VAR_OFF, endVar, varActive } from './game/varReplay';
import { clipSwap, swapBoard, swapTarget, until, SWAP_PULSE_S, SWAP_SETTLE_S } from './game/clipSwap';
import { setDirected } from './explain/director';
import { summaryOpen } from './summary/summary';
import { boot } from './boot';
import { Tour } from './tour/Tour';
import { tourStep } from './tour/tour';

/** ?synth=1: every player drawn from his positions only, as the what-if's simulated players will be (whatif/motion.ts),
 *  to compare with the tracked bodies (Yi, 2026-10-24) */
const SYNTH = typeof location !== 'undefined' && new URLSearchParams(location.search).get('synth') === '1';

// The game UI (?ui=game, 2026-10-22): a clip on the 3D stage with the camera director and the display layers, the HUD
// from src/hud/ (built in a parallel session: top bar, score, view picker, player card, minimap, and the replay plate
// bottom right, which plays, seeks, changes speed and switches clips through `playback` below; the clock stays ours).
// The HUD runs its new design (Yi, 2026-10-23: the HUD preview's draft wired in): per-mode left rails, 画板 and the per-mode
// replay players, with hud/PitchOverlay3D.tsx drawing the 战术 maps and marks, 画板's strokes and 观赛's speed rings on the
// grass. Design: docs/design/three-channels.html; plan:
// docs/plans/2026-10-22-game-ui.md. ?t=<s> holds a time (for screenshots); every setting is in the address
// (src/game/settings.ts).

interface Clip { id: string; kind: 'shot' | 'pass' | 'offside'; moment: string; title: string }
const INDEX = matchFile('index.json');
const DEFAULT_MOMENT = clipAddr('shot-15-53');
/** the pre-match (Yi, 2026-10-23/24, as a broadcast does it, watch mode only): the line-up show (src/lineup/, the line-up
 *  session's), which ends on the kick-off clip's first frame with its title docked into the score bug; the game then
 *  takes over on that same picture and plays the kick-off, watch mode's first clip. It plays when the game opens fresh
 *  in watch mode (no ?moment, ?t or ?capture, so links, screenshots and recordings are as before); ?intro=0 skips it */
const KICKOFF = clipAddr('kickoff-00-00');
// the Decision Lab plays each clip at the match's real ends (Yi, 2026-10-24): Pelicans left to right in the first half,
// Wildcats in the second (coords.ts viewSign)
matchEnds.on = true;
const LINEUP = matchFile('lineup.json');
/** Normalize old bookmarks to the logical addresses used by the clip list. */
const normalized = (m: string | null) => { if (!m) return null; const { match, id } = parseClip(m); return clipAddr(id, match); };
/** at the hand-off the stage is already drawn at full size behind the show, on the clip's first frame (the show's last:
 *  the men in their kick-off poses, the ball just struck); the show's picture goes at once and its overlays fade as the
 *  HUD comes in, over HANDOFF_FADE s, then the kick-off holds HANDOFF_HOLD s and plays (Yi, 2026-10-24: freeze on the
 *  kick and go on from there; the staged warm-up before the kick, tried instead, turned the men the wrong way) */
const HANDOFF_FADE = 0.5, HANDOFF_HOLD = 0.8;
type Intro = 'show' | 'handoff' | 'off';
// each view's line at the bottom, shown for HINT_S when the view (or the pen) comes on, then faded: a brief how-to in
// the product's voice, not a standing caption (Yi, 2026-10-27: "make it less like a vibe coding product")
const HINT: Record<ViewMode, string> = {
  broadcast: 'Broadcast · Drag or scroll to take the camera',
  free: 'Free camera · Drag to orbit · Right-drag to pan · Scroll to zoom · Double-click a player to follow · 1 for broadcast',
  third: 'Player cam · Click another player to switch',
  first: "Player's eyes · Click another player to switch",
  referee: "The referee's view", ar1: "The assistant referee's view", ar2: "The assistant referee's view",
  tactical: 'Top-down · Scroll in to follow play · Drag to pan',
  aerialNear: 'Drone · Drag to change the angle · Scroll to zoom',
  aerialFar: 'Aerial wide · Drag to change the angle · Scroll to zoom',
  aerialIn: 'Stadium orbit · Drag to turn · Scroll to come closer',
};
const DRAW_HINT = 'Drag on the pitch to draw · Space plays on and clears unsaved drawings';
const HINT_S = 5;

export function GameApp() {
  matchEnds.on = true;   // again on every render: a hot reload of coords.ts brings a fresh switch (the module-level line may not rerun)
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const introAtOpen = useMemo(() => !q.get('moment') && q.get('t') === null && q.get('capture') !== '1' && q.get('intro') !== '0' && getSettings().mode === 'watch' && tourStep.get() < 1, [q]);   // (a tour under way: a reload resumes it, no show)
  // the clip on screen; a clip change swaps it in place (gotoMoment), so it is state, not the address
  // (an address from before the data took its fictional identity names the match's old folder: the same clip, renamed)
  const first = useMemo(() => normalized(q.get('moment')) ?? (introAtOpen ? KICKOFF : DEFAULT_MOMENT), [q, introAtOpen]);
  const [moment, setMoment] = useState(first);
  // the pre-match: 'show' while the line-up show runs (the stage starts small behind it once it says so: prepared),
  // 'handoff' while the two cross over, then 'off'
  const [intro, setIntro] = useState<Intro>(introAtOpen ? 'show' : 'off');
  const [prepared, setPrepared] = useState(false);
  // the stage at full size behind the show (from the title's dock on), so the switch is on a picture already drawn
  const [full, setFull] = useState(false);
  // the stage behind the show has drawn its first frames (its shaders built): the show's Skip appears only then (Yi,
  // 2026-10-26: a Skip pressed before it stalled the hand-off)
  const [stageReady, setStageReady] = useState(false), stageFrames = useRef(0);
  const [lineup, setLineup] = useState<LineupFile | null>(null);
  useEffect(() => { if (introAtOpen) fetch(LINEUP).then((r) => r.json()).then(setLineup).catch(() => setIntro('off')); }, [introAtOpen]);
  // the show ends on the broadcast camera, so the game takes over in the broadcast view (Yi, 2026-10-24: a view kept in
  // the address from before made the kick-off cut to another camera angle); the viewer changes it after as usual
  useEffect(() => { if (introAtOpen && getSettings().view !== 'broadcast') setSettings({ view: 'broadcast' }); }, [introAtOpen]);
  const hold = q.get('t') !== null ? +(q.get('t') ?? 0) : introAtOpen ? 0 : null;
  const clock = useMemo(makeClock, []);
  const [data, setData] = useState<Loaded | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [index, setIndex] = useState<ClipIndex | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(hold === null);
  const [speed, setSpeed] = useState(1);
  const st = useRef({ playing: hold === null, speed: 1, ui: 0 });
  // the hand-off: the HUD comes in as the show's overlays go, on the show's last frame, which holds, then plays; the
  // intro ends only then (while the game is held, an ended intro would show the pause window)
  const handOff = useCallback(() => {
    setPrepared(true); setFull(true); setIntro('handoff');
    window.setTimeout(() => { setIntro('off'); st.current.playing = true; setPlaying(true); }, (HANDOFF_FADE + HANDOFF_HOLD) * 1000);
  }, []);
  // while the show runs, the game's keys (and the HUD's) are off; Esc goes on to the show, its Skip
  useEffect(() => {
    if (intro === 'off') return;
    const block = (e: KeyboardEvent) => { if (e.key !== 'Escape') e.stopImmediatePropagation(); };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [intro]);
  const settings = useGameSettings(), varOn = useStore(varReplay).phase !== 'off', swapping = useStore(clipSwap) !== 'off', sumOn = useStore(summaryOpen);
  // the HUD's 画板 mode (the draft design, wired in 2026-10-23): the pointer draws on the pitch, and the pause window keeps clear
  const drawing = useStore(drawMode);
  // the hint's few seconds, again at each change of view or of the pen
  const [hintOn, setHintOn] = useState(true);
  useEffect(() => { setHintOn(true); const id = window.setTimeout(() => setHintOn(false), HINT_S * 1000); return () => window.clearTimeout(id); }, [settings.view, drawing]);
  // the players' toon portraits for the HUD's player card, rendered once per clip by the stage
  const [portraits, setPortraits] = useState<(string | null)[] | null>(null);
  const portraitOf = useCallback((p: number) => portraits?.[p] ?? null, [portraits]);
  // the clip and the match roster together, so every look is the roster's from the first frame (no swap after load)
  const [roster, setRoster] = useState<Roster | null>(null);
  // the clip the page opens on (a later clip comes in through gotoMoment)
  useEffect(() => { Promise.all([loadMoment(moment), loadRoster(), SYNTH ? loadClips() : null]).then(([d, r, clips]) => {
    boot.at(0.9, 'Building the stadium');   // (the loader: the data is in, the 3D build comes next; src/boot.ts)
    clock.t = hold ?? 0; setRoster(r);
    setData(clips && d.joints ? { ...d, joints: synthFromPositions(clips, d.pkg, d.joints.frames, d.joints.fps, d.joints.names) } : d);
  }); }, [clock, hold]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetch(INDEX).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.clips) { j.clips.sort(byMatchTime); setClips(j.clips); setIndex(j); } }).catch(() => undefined); }, []);
  const end = data ? duration(data.pkg) : 0;
  // a pause stops where it is pressed, in every mode (Yi, 2026-10-24: the 战术 pause no longer waits for the next
  // reception; the What-if mode stops on its own curated moments)
  // the What-if mode (whatif/useWhatIf.tsx, chat 2's), set up below: asked first in play and in the tick
  const wiRef = useRef<ReturnType<typeof useWhatIf> | null>(null);
  const play = useCallback((p: boolean) => {
    if (wiRef.current?.play(p)) return;
    st.current.playing = p; setPlaying(p); if (p && clock.t >= end - 1e-3) clock.t = 0;
  }, [clock, end]);
  const onTick = useCallback((dt: number) => {
    const s = st.current;
    // the stage's first frames drawn (it ticks only once mounted): the show may offer Skip from now on
    if (stageFrames.current < 8 && ++stageFrames.current === 8) setStageReady(true);
    // a clip changing in place: the clock stands still under the board (gotoMoment plays the next clip once it is down)
    if (clipSwap.get() !== 'off') return;
    // a clip with a director script in the Explain mode: its narration time runs the clock (holds, cameras, voice;
    // explain/director.ts, chat 4)
    if (explainTick(dt, clock, s.playing, play)) { s.ui += dt; if (s.ui > 1 / 15) { s.ui = 0; setT(clock.t); } return; }
    // forward stops at the end, paused (Yi, 2026-10-24: no instant replay; the viewer picks the next clip, or play starts
    // it over); rewinding (the replay plate's negative speeds) stops at the start, paused, back at 1x
    if (wiRef.current?.tick(dt)) { /* the what-if stopped the clock */ }
    else if (s.playing && end > 0) { clock.t += dt * s.speed; if (clock.t >= end) { clock.t = end; s.playing = false; setPlaying(false); s.ui = 1; } if (clock.t < 0) { clock.t = 0; s.speed = 1; setSpeed(1); s.playing = false; setPlaying(false); } }
    s.ui += dt; if (s.ui > 1 / 15) { s.ui = 0; setT(clock.t); }
  }, [clock, end, play]);
  useEffect(() => { st.current.speed = speed; }, [speed]);

  // the HUD's looks (card, plates, pause window), through the roster as the pitch's are, so the two agree
  const looks = useMemo(() => (data?.joints ? clipLooks(data.pkg, roster, makeLooks(data.joints.players, data.joints.nAtt, { hair: 1, number: 1, skin: 1 }, keepersOf(data.pkg)), { hair: 1, number: 1, skin: 1 }) : []), [data, roster]);
  // the What-if mode: its moments, the branch it plays, its cards (whatif/useWhatIf.tsx)
  const whatIf = useWhatIf({ data, setData, clock, st, setPlaying, setT, moment, mode: settings.mode, t, playing, looks });
  wiRef.current = whatIf;
  const ci = clips.findIndex((c) => c.moment === moment);
  // a clip change in place, without loading the page again (Yi, 2026-10-26; game/clipSwap.ts): the camera rises to the
  // top-down view as the grass turns over into the board, the board's hexagons pulse while the next clip loads (at least
  // SWAP_PULSE_S, so the pulse shows), the clip goes in under the board, and the board turns back into grass as the camera
  // comes down to the broadcast view (the Tactics mode keeps its own view); play starts as it lands. The What-if mode and
  // ?synth=1 set themselves up from the address as the page opens, so there a clip change still loads the page afresh.
  // The address keeps the clip, one history entry each, so the browser's back goes to the clip before, in place too.
  const swapTo = useCallback(async (m: string, push: boolean) => {
    if (clipSwap.get() !== 'off') return;
    const wait = (s: number) => new Promise((r) => window.setTimeout(r, s * 1000));
    const s0 = getSettings(), back: ViewMode = s0.mode === 'tactics' ? s0.view : 'broadcast';
    st.current.playing = false; setPlaying(false); st.current.speed = 1; setSpeed(1);
    setDirected(null); varReplay.set(VAR_OFF); drawMode.set(false);   // the commentary's voice stops; a VAR check or the pen ends
    clipSwap.set('out'); swapTarget.set(m);
    setSettings({ view: 'tactical', selected: null });
    // (the camera up too: in the Tactics mode the board is down already and the pulse starts at once)
    const [d] = await Promise.all([loadMoment(m).catch(() => null), until(() => swapBoard.pulseT >= SWAP_PULSE_S && swapBoard.cam >= 1)]);
    if (d) {
      clock.t = 0; setT(0); setPortraits(null); setData(d); setMoment(m);
      if (push) { const u = new URLSearchParams(location.search); u.set('moment', m); u.delete('t'); history.pushState(null, '', `${location.pathname}?${u}`); }
      await wait(SWAP_SETTLE_S);
    }
    // (a clip that failed to load: the board turns back on the clip there was)
    clipSwap.set('in');
    setSettings({ view: back });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // the director has seen the view change
    await until(() => (swapBoard.p <= 0 || getSettings().tactical) && swapBoard.cam >= 1);   // (the Tactics mode's board stays)
    clipSwap.set('off'); swapTarget.set(null);
    if (d) { st.current.playing = true; setPlaying(true); }
  }, [clock]);
  const gotoMoment = (m: string) => {
    if (getSettings().mode === 'whatif' || SYNTH) { const u = new URLSearchParams(location.search); u.set('moment', m); u.delete('t'); location.search = u.toString(); return; }
    m = normalized(m)!;
    if (m === moment) { clock.t = 0; setT(0); play(true); return; }   // the clip on screen: from its start
    void swapTo(m, true);
  };
  // the browser's back and forward: the clip the address names, in place
  useEffect(() => {
    const pop = () => { void swapTo(normalized(new URLSearchParams(location.search).get('moment')) ?? first, false); };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
  }, [swapTo, first]);
  // the pre-match again (Yi, 2026-10-24: "how do I watch this show again?"): L in watch mode opens the game fresh, the
  // settings kept, so the show plays and hands over to the kick-off as at first
  const replayIntro = () => {
    const u = new URLSearchParams(location.search);
    for (const k of ['moment', 't', 'intro', 'capture']) u.delete(k);
    if (`?${u.toString()}` === location.search) location.reload(); else location.search = u.toString();
  };
  const goClip = (k: number) => { if (k >= 0 && k < clips.length) gotoMoment(clips[k].moment); };
  // the HUD's replay plate drives playback through this; the clock and its loop stay here
  // (play and seeks wait while a clip changes in place)
  const playback: Playback = {
    playing, speed, duration: end, play: (p) => { if (clipSwap.get() === 'off') play(p); },
    seek: (x) => { if (clipSwap.get() !== 'off') return; clock.t = Math.min(end, Math.max(0, x)); setT(clock.t); },
    setSpeed: (x) => { st.current.speed = x; setSpeed(x); },
    gotoClip: gotoMoment,
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT' || clipSwap.get() !== 'off') return;
      // the view keys 1-8, M, V and R (the menus, the radar) belong to the HUD; space and the clip keys stay here; Esc clears the selection unless the
      // HUD used it to close a panel
      // during a VAR check, space plays on and takes the camera back (game/varReplay.ts)
      if (e.key === ' ') { if (varActive()) endVar(play); else play(!st.current.playing); e.preventDefault(); }
      else if (e.key === 'Escape' && !e.defaultPrevented) setSettings({ selected: null });
      else if (e.key === '[') goClip(ci - 1); else if (e.key === ']') goClip(ci + 1);
      else if ((e.key === 'l' || e.key === 'L') && getSettings().mode === 'watch') replayIntro();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    const W = window as unknown as Record<string, unknown>;
    W.__setT = (x: number) => { clock.t = x; play(false); setT(x); };
    W.__play = (p: boolean) => play(p);
    W.__view = (v: ViewMode, sel?: number | null) => setSettings(sel === undefined ? { view: v } : { view: v, selected: sel });
    W.__settings = () => getSettings();
    W.__portraits = () => portraits;
    W.__toggleTactical = () => toggleTactical();   // for recordings: the switch itself is the HUD's now
    W.__replayIntro = () => replayIntro();
    W.__gotoClip = (m: string) => gotoMoment(m);   // for the headless checks: a clip change, as the replay plate makes it
    W.__swapPhase = () => clipSwap.get();
    W.__clipEnd = () => end;   // the clip's length, for the headless checks (the tour's end hold)
    if (q.get('capture') === '1') W.__capture = true;
  });

  // the pre-match show over everything while it runs, fading as the game takes over
  const show = intro !== 'off' && lineup && data ? (
    <div className="gm-intro" style={{ position: 'fixed', inset: 0, zIndex: 50, opacity: intro === 'show' ? 1 : 0, transition: `opacity ${HANDOFF_FADE}s ease`, pointerEvents: intro === 'show' ? 'auto' : 'none' }}>
      <LineupShow lineup={lineup} roster={roster} kickoff={data} embedded canSkip={stageReady} onPrepare={() => setPrepared(true)} onNearEnd={() => { setPrepared(true); setFull(true); }} handingOver={intro === 'handoff'} onDone={handOff} />
    </div>
  ) : null;
  if (!data) return <div className="app" />;
  // the stage: as usual, or while the show runs, nothing at first, then small and out of sight (the window's shape at a
  // fortieth of its size, so the camera's framing is the one it will have) once the show says to get ready. The show
  // stays the app's last child throughout, so it is never mounted afresh (that would start it over)
  const small = intro === 'show' && !full;
  return (
    <div className="app">
      {!small || prepared ? (
        <div className="stage" style={small ? { position: 'fixed', left: 0, top: 0, width: '2.5vw', height: '2.5vh', opacity: 0, pointerEvents: 'none' } : undefined}>
          <Stage data={data} clock={clock} clipKey={moment} phase="tail" layers={{ pc: false, opt: false, vis: false }} selected={null} onTick={onTick} director onPortraits={setPortraits}
            overlay={(mode) => <><PitchOverlay3D data={data} clock={clock} looks={looks} mode={mode} />{whatIf.scene(mode)}</>} />
        </div>
      ) : null}
      <div style={{ opacity: intro === 'show' ? 0 : 1, transition: `opacity ${HANDOFF_FADE}s ease`, pointerEvents: intro === 'show' ? 'none' : undefined }}>
        <div className="vignette" />
        <PauseWindow data={whatIf.realData ?? data} t={t} paused={!playing && !drawing && intro === 'off' && t < end - 0.05 && settings.mode !== 'whatif' && settings.mode !== 'tactics' && !varOn && !swapping} looks={looks} />
        {whatIf.ui}
        <div className={hintOn && !sumOn ? 'gm-hint on' : 'gm-hint'}>{drawing ? DRAW_HINT : HINT[settings.view]}</div>
        <Hud pkg={data.pkg as unknown as ClipPkg} clock={clock} looks={looks} index={index} portraitOf={portraitOf} playback={playback} draft />
        <ExplainPlayer data={data} />
      </div>
      {show}
      <Tour host={{ moment, gotoMoment, t, end, playing, play, seek: playback.seek, intro: intro !== 'off', pkg: data.pkg }} />
    </div>
  );
}
