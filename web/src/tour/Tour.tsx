// The judges' tour (Yi, 2026-10-28): one card at a time, each asking for one action in the game, written for someone
// who sees the product for the first time. The card turns the page only on Next (Yi: "it sounds like in a rush"):
// once the step's action is done, Next pulses. The part of the HUD a step asks for glows until it is clicked. While
// the tour runs, keys and HUD buttons it does not ask for are held, menus offer only the step's entry, and a held
// click nudges the card (Yi: "lock other not mentioned key binding and buttons"); the pitch itself (camera, players)
// stays free. The card's line follows what the viewer has done so far, so a step taken out of order still reads
// right (a player not picked yet, the voice still locked, each phase of the What-if).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clipAddr } from '../data/paths';
import { getSettings, setSettings, setMode, useGameSettings, type GameMode, type GameSettings } from '../game/settings';
import { base, drawMode, railMenu, strokes, useStore, type BaseKey } from '../hud/draft';
import { setPanel } from '../hud/panel';
import { closeSummary, summaryOpen } from '../summary/summary';
import { land } from '../whatif/state';
import { momentById, resolveMoment, wiNow } from '../whatif/moments';
import { clipSwap } from '../game/clipSwap';
import { endVar, varActive, varReplay } from '../game/varReplay';
import { useExplain } from '../explain/director';
import { endTour, startTour, tourLock, tourStep } from './tour';
import './tour.css';

export interface TourHost {
  /** the clip on screen */
  moment: string;
  gotoMoment: (m: string) => void;
  t: number;
  end: number;
  playing: boolean;
  play: (p: boolean) => void;
  seek: (t: number) => void;
  /** the line-up show still runs */
  intro: boolean;
  /** the clip on screen (for the What-if moment's exact time) */
  pkg: Parameters<typeof resolveMoment>[0];
}

interface Ctx { s: GameSettings; t: number; end: number; base: BaseKey | null; strokes: number; phase: string; sum: boolean; voiceLocked: boolean; voiceOff: boolean; cardOpen: boolean; varShown: boolean; varOn: boolean; latched: boolean }
interface Step {
  /** the clip the step plays, changed to as it begins, and its time for the card while it loads */
  clip?: string; at?: string;
  /** the card's line while the clip loads: what comes next, read as the board turns over (Yi, 2026-10-28) */
  lead?: string;
  title: string;
  /** the card's line for the state the viewer is in; **x** is set bold (keys and buttons) */
  text: (c: Ctx) => string;
  /** keys let through; Escape too unless noEsc */
  keys?: string[]; noEsc?: boolean;
  /** HUD parts that may be clicked */
  allow?: string[];
  /** the HUD parts the step points at, glowing until clicked */
  glow?: string[];
  /** parts that glow whenever they are on screen, whatever the step's aim (the commentary's switch while it is off) */
  glowWhile?: string[];
  /** a part the card points at with a moving arrow beside it, while it is on screen (a small target: the card's toggle) */
  point?: string;
  /** a larger part that does the target's job while the step runs (a press anywhere on it presses the target) */
  proxy?: { area: string; target: string };
  /** the step's action has been done (latched: Next pulses from then on) */
  done?: (c: Ctx) => boolean;
  /** "Show me": does the step's action; offered while it helps */
  showMe?: (h: TourHost) => void;
  canShow?: (c: Ctx) => boolean;
  kind?: 'welcome' | 'summary';
  /** the clip held still while the step's action is not done (moving players are hard to click) */
  hold?: boolean;
  /** the clip set playing once the step's aim is reached (a view that shows the play moving) */
  playOnAim?: boolean;
  /** the clip held still until the step's aim is reached (Yi, 2026-10-28: a step that asks for something waits for it, so
   *  the moment is not missed while the card is read) */
  waitAim?: boolean;
  /** at the clip's end the step plays on from here instead of holding (Yi: the camera step plays until Next) */
  loopFrom?: number;
  /** where the clip starts once loaded (the last clip plays only its end; the What-if step stands a tenth before its moment) */
  startAt?: (h: TourHost) => number;
  /** the clip runs to its real end (the HUD's Match Summary shows only there) */
  natural?: boolean;
  /** once the aim is reached: back to the step's moment if the clip has gone past it (a viewer slower than the clip) */
  onAim?: (h: TourHost) => void;
  /** where the card sits when top centre is taken: the What-if's own card is there, and its teammates stand left and right
   *  of the pitch, so the card goes to the bottom left corner, in the player card's place (Yi, 2026-10-28: mid-left it hid
   *  one of the options) */
  place?: 'corner';
  /** the step that shows the VAR check: its button stays on screen (the tour hides it elsewhere) */
  var?: boolean;
  /** what an earlier step opened and this one keeps (the rest is put away as the step begins) */
  keep?: ('card' | 'pen' | 'rail')[];
  /** the mode the step needs, set as it begins should the step before have been passed over (its tools are that mode's) */
  mode?: GameMode;
}

const KICKOFF = clipAddr('kickoff-00-00'), GOAL = clipAddr('shot-55-43'), CHANCE = clipAddr('shot-15-53');
const BOARD = clipAddr('shot-80-17'), CHIP = clipAddr('pass-26-40'), OFFSIDE = clipAddr('offside-48-14');
/** the match's last clip: at its end the HUD offers the Match Summary (hud/Hud.tsx, the summary's data loads there) */
const FINAL = clipAddr('shot-90-04');
const VIEW_BTN = '[data-tour="view"] > .hud-btn', MODE_BTN = '[data-tour="mode"] > .hud-btn';
const PLAY = ['.hud-transport-play', '.hud-scrub-line', '.hud-scrub-knob'];
const RAIL = '.hud-rail-in', RAIL_POP = '.hud-rpop';
const PICK = 9;   // the player Show me selects at the kick-off
/** the clips' moments, in clip seconds: 55:43's shot (whatif/moments.ts m8: the reception at 7.07, the shot 0.93 s on),
 *  26:40's What-if stop (m3 at 13.09, played in from whatif/moments.ts LEAD before it) */
const GOAL_SHOT = 8.0, CHIP_AT = 13.09, CHIP_LEAD = 3.5;
/** 26:40's What-if moment (whatif/moments.ts m3), at its exact reception in the clip on screen */
const chipMoment = (h: TourHost) => { const m = momentById('m3'); return m ? { m, r: resolveMoment(h.pkg, m) } : null; };
/** the What-if told its moment is already in place, as the mode is picked, so it does not rewind to play it in again: the
 *  clip, standing a tenth before it, plays only into it (Yi, 2026-10-28: "camera no move, just do the hexagon shift") */
function presetChip(h: TourHost) {
  const c = chipMoment(h);
  if (c && Math.abs(h.t - c.r.t) < 0.3) wiNow.set({ id: c.m.id, t: c.r.t, carrier: c.r.player });
}
/** a clip is never let run to its very end while the tour runs: it holds this short of it, the players still there */
const END_HOLD = 0.3;

const STEPS: Step[] = [
  { kind: 'welcome', title: 'Welcome to Pitch Pilot', text: () => 'A match rebuilt in 3D, made for you to explore. The tour takes about three minutes, at your own pace. Starting it skips this line-up show; you can watch it afterwards.' },
  { clip: KICKOFF, at: 'the kick-off', title: 'Pick a player', hold: true, keep: ['card'],
    lead: 'Every player on this pitch is rebuilt from player tracking, frame by frame.',
    text: (c) => (c.s.selected === null ? 'The play is paused for you: click any player, on the pitch or on the radar at the bottom.'
      : c.cardOpen ? 'This is his profile. At the kick-off it is still empty: his stats fill in live as the match goes on.'
      : 'Got him. Press the **arrow** on his card at the bottom left to open his profile.'),
    allow: ['[class*="hud-mm"]', '.hud-card'],
    glowWhile: ['.hud-card .hud-plate:not(.empty):has(.hud-plate-toggle[aria-expanded="false"])', '.hud-card .hud-plate-toggle[aria-expanded="false"]:not([disabled])'],
    point: '.hud-card .hud-plate-toggle[aria-expanded="false"]:not([disabled])',
    proxy: { area: '.hud-card .hud-plate:not(.empty) .hud-plate-head', target: '.hud-card .hud-plate-toggle[aria-expanded="false"]' },
    done: (c) => c.cardOpen, canShow: (c) => !c.cardOpen,
    showMe: () => {
      if (getSettings().selected === null) { setSettings({ selected: PICK }); return; }
      document.querySelector<HTMLButtonElement>('.hud-card .hud-plate-toggle[aria-expanded="false"]')?.click();
    } },
  { title: 'Through his eyes', playOnAim: true, waitAim: true,
    text: (c) => (c.s.selected === null ? 'Click a player first, then press **4** to see the match through his eyes.'
      : c.s.view === 'first' ? 'This is what he sees as the play moves. After the tour, try it with any player.' : 'Press **4**, or open **View** at the top right and choose **Player POV**.'),
    keys: ['4', 'v', 'V'], allow: [VIEW_BTN, '[data-view="first"]', '.hud-card'], glow: [VIEW_BTN, '[data-view="first"]'],
    done: (c) => c.s.view === 'first',
    showMe: () => setSettings({ view: 'first', selected: getSettings().selected ?? PICK }), canShow: (c) => c.s.view !== 'first' },
  { title: 'The big picture', playOnAim: true, waitAim: true,
    text: (c) => (c.s.view === 'aerialIn' ? 'The whole stadium from the sky, turning slowly on its own.' : 'Press **0**, or open **View** and choose **Stadium orbit**.'),
    keys: ['0', 'v', 'V'], allow: [VIEW_BTN, '[data-view="aerialIn"]'], glow: [VIEW_BTN, '[data-view="aerialIn"]'],
    done: (c) => c.s.view === 'aerialIn', showMe: () => setSettings({ view: 'aerialIn' }), canShow: (c) => c.s.view !== 'aerialIn' },
  { clip: GOAL, at: '55:43', title: 'A goal at 55:43', waitAim: true, playOnAim: true,
    lead: 'Next, a goal at 55:43. In Watch the camera is yours, from the broadcast angle to a free camera you fly yourself.',
    text: (c) => (c.s.view === 'free' ? 'Drag to orbit, scroll to zoom, double-click a player to follow. The goal plays on until you press **Next**.'
      : 'Press **3**, or choose **Free** under **View**: the goal plays as soon as the camera is yours.'),
    keys: ['3', 'v', 'V', ' '], allow: [VIEW_BTN, '[data-view="free"]', ...PLAY], glow: [VIEW_BTN, '[data-view="free"]'],
    done: (c) => c.s.view === 'free', loopFrom: GOAL_SHOT - 4,
    onAim: (h) => { if (h.t > GOAL_SHOT + 0.5) rewindTo(h, GOAL_SHOT - 4); },
    showMe: (h) => { setSettings({ view: 'free', selected: null }); h.gotoMoment(GOAL); }, canShow: (c) => c.s.view !== 'free' },
  { clip: OFFSIDE, at: '48:14', title: 'VAR check', var: true,
    lead: 'Next, a VAR check at 48:14: the replay rewinds to the pass and draws the offside line where it was judged.',
    text: (c) => (c.varOn ? "That's the offside line, where it was at the moment of the pass. Press **space** to play on."
      : c.latched ? 'Checked: offside at the moment of the pass. Press **Next** when you are ready.'
      : c.varShown ? 'Paused at the pass for you: press **VAR** at the top right to check the offside.'
      : 'Watch the pass: a **VAR** button appears at the top right as it is played.'),
    keys: [' '], allow: ['.hud-var', ...PLAY], glow: ['.hud-var'], done: (c) => c.varOn,
    showMe: () => document.querySelector<HTMLButtonElement>('.hud-var')?.click(), canShow: (c) => c.varShown && !c.varOn && !c.latched },
  { clip: CHANCE, at: '15:53', title: 'Explain', waitAim: true, playOnAim: true,
    lead: 'Next, Explain at 15:53: a replay directed like a TV breakdown, with an AI commentator, camera cuts and markings on the pitch.',
    text: (c) => (c.s.mode !== 'explain' ? 'Press **M**, or open **Mode** at the top right, and choose **Explain**: the commentary starts as soon as you do.'
      : c.voiceLocked ? 'Turn the voice on with **Click for commentary** at the top left.'
      : c.voiceOff ? 'The commentary is off: turn it on at the top left to hear the voice.'
      : 'The commentary now explains this chance: the run, the space and the finish.'),
    keys: ['m', 'M', ' '], allow: [MODE_BTN, '[data-mode="explain"]', ...PLAY], glow: [MODE_BTN, '[data-mode="explain"]'], glowWhile: ['.nr-sound:not(.on)'],
    done: (c) => c.s.mode === 'explain' && c.end > 0 && c.t >= c.end - 0.3,
    onAim: (h) => { if (h.end > 0 && h.t >= h.end - END_HOLD - 0.2) rewindTo(h, 0); },
    showMe: (h) => { setMode('explain'); h.play(true); }, canShow: (c) => c.s.mode !== 'explain' },
  { clip: BOARD, at: '80:17', title: 'Tactics', waitAim: true, playOnAim: true,
    lead: 'Next, Tactics at 80:17: the same match as an analysis board, with the space each team controls and a pen to draw on it.',
    text: (c) => (c.s.mode === 'tactics' ? 'Its tools are in the rail on the left.' : 'Press **M** and choose **Tactics**.'),
    keys: ['m', 'M'], allow: [MODE_BTN, '[data-mode="tactics"]'], glow: [MODE_BTN, '[data-mode="tactics"]'],
    done: (c) => c.s.mode === 'tactics', showMe: () => setMode('tactics'), canShow: (c) => c.s.mode !== 'tactics' },
  { title: 'Read the space', keep: ['rail'], mode: 'tactics', waitAim: true, playOnAim: true,
    text: (c) => (c.base === 'pc' ? 'Each team owns the grass in its colour. Press play and watch the run pull the space open.'
      : 'Press **Map** in the left rail and choose **Pitch control**: the play runs once it is on.'),
    keys: [' '], allow: [RAIL, RAIL_POP, ...PLAY], glow: ['.hud-rbtn[aria-label="Map"]'],
    done: (c) => c.base === 'pc', showMe: (h) => { base.set('pc'); h.play(true); }, canShow: (c) => c.base !== 'pc' },
  { title: 'Draw it', keep: ['pen', 'rail'], mode: 'tactics', waitAim: true,
    text: (c) => (c.strokes > 0 ? 'Drawn on the frozen frame, as an analyst would in the studio.' : 'Pick up the **Pen** in the left rail and drag on the pitch to draw the run you saw.'),
    allow: [RAIL, RAIL_POP], glow: ['.hud-rbtn[aria-label="Pen"]'],
    done: (c) => c.strokes > 0, showMe: () => drawMode.set(true), canShow: (c) => c.strokes === 0 },
  { clip: CHIP, at: '26:40', title: 'What if?', place: 'corner', noEsc: true, waitAim: true, startAt: (h) => (chipMoment(h)?.r.t ?? CHIP_AT) - 0.1,
    lead: 'The last mode, What-if, at 26:40: stop just before a pass, choose another teammate, and the other 21 players respond in a simulation.',
    text: (c) => (c.s.mode !== 'whatif' ? 'Paused just before the chip over the back line: press **M** and choose **What-if**.'
      : c.phase === 'off' ? 'The play runs in to the chip over the back line.'
      : c.phase === 'pick' && c.latched ? 'Try another teammate in a spotlight, or press **Next** to finish.'
      : c.phase === 'pick' ? '**What would you do?** Click a teammate in a spotlight to send the ball to him instead.'
      : c.phase === 'result' ? 'Press **Try another** for another teammate, or **Next** when you are ready.'
      : 'Watch them respond. A simulation, not what happened.'),
    // (no play: playing on would end the question, and the What-if's clip runs to its very end)
    keys: ['m', 'M'], allow: [MODE_BTN, '[data-mode="whatif"]'], glow: [MODE_BTN, '[data-mode="whatif"]'], glowWhile: ['.wi-ask-act button'],
    done: (c) => c.phase === 'result', showMe: (h) => { presetChip(h); setMode('whatif'); }, canShow: (c) => c.s.mode !== 'whatif',
    // held a tenth before the moment: the What-if needs only to play into it (no rewind, the camera stays); held anywhere
    // else (a late arrival), the quick rewind to the play-in
    onAim: (h) => { const at = chipMoment(h)?.r.t ?? CHIP_AT; if (h.t > at - 0.3 && h.t < at) h.play(true); else rewindTo(h, at - CHIP_LEAD); } },
  { kind: 'summary', clip: FINAL, at: '90:04', title: 'The whole match', natural: true, startAt: (h) => Math.max(0, h.end - 6),
    lead: 'Last stop: the final whistle, and the whole match in numbers.',
    text: (c) => (c.sum ? "That's the tour, thank you. Browse the pages, then explore as you like."
      : 'The last minutes of the match. When the final whistle goes, press **Match Summary** at the top.'),
    keys: [' '], allow: ['.ms', '.hud-nextclip', ...PLAY], glowWhile: ['.hud-nextclip'], done: (c) => c.sum },
];
const LAST = STEPS.length - 1;
// a reload mid-tour resumes at the start of the step's scene: a step without a clip of its own plays on the one before's,
// which the reload does not bring back (once a page: a hot reload of this file leaves the step alone)
{
  const W = window as unknown as { __tourResumed?: boolean }, k = tourStep.get();
  if (!W.__tourResumed && k > 1 && k <= LAST && !STEPS[k].clip) { let j = k; while (j > 1 && !STEPS[j].clip) j--; tourStep.set(j); }
  W.__tourResumed = true;
}

/** back to a moment as a quick visible rewind, not a cut (Yi, 2026-10-28: a jump reads as a fault): the clock runs back
 *  over about a second, eased, then plays from there */
function rewindTo(h: TourHost, target: number) {
  const from = h.t, dur = Math.min(1.2, Math.max(0.6, Math.abs(from - target) / 25)) * 1000, t0 = performance.now();
  h.play(false);
  const frame = (now: number) => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) * (1 - k);
    h.seek(from + (target - from) * e);
    if (k < 1) requestAnimationFrame(frame); else h.play(true);
  };
  requestAnimationFrame(frame);
}

/** **x** as bold */
const rich = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));

/** the line-up show's Skip, once it is there */
function skipShow(): boolean {
  const b = document.querySelector<HTMLButtonElement>('.lu-skip');
  if (!b || getComputedStyle(b).opacity === '0') return false;
  b.click(); return true;
}

export function Tour({ host }: { host: TourHost }) {
  const n = useStore(tourStep);
  const s = useGameSettings(), b = useStore(base), st = useStore(strokes), ld = useStore(land), sum = useStore(summaryOpen);
  const swap = useStore(clipSwap), ex = useExplain();
  const step = n >= 0 && n <= LAST ? STEPS[n] : null;
  const hostRef = useRef(host); hostRef.current = host;
  const [wantSkip, setWantSkip] = useState(false);
  // the show was cut short for the tour: the first card says so, or the cut would look like a fault
  const [skipped, setSkipped] = useState(false);
  // the step's action done at least once: Next pulses from then on, and the glow stops
  const [latched, setLatched] = useState(false);
  // a held click: the card nods, so the viewer looks back at it
  const [nudge, setNudge] = useState(0);
  // each visit to a step, counted: what a step does once is done once a visit (a second tour, after Restart, does it again)
  const visit = useRef(0);
  useEffect(() => { visit.current++; setLatched(false); if (n !== 1) setSkipped(false); if (n < 0) setWantSkip(false); }, [n]);
  // a tick while the tour runs: some of what a step waits for is read off the page (the player card's open state, the
  // commentary's switch), and a held clip no longer re-renders this with the clock
  const [, setTick] = useState(0);
  useEffect(() => { if (n < 0) return; const id = window.setInterval(() => setTick((x) => x + 1), 250); return () => window.clearInterval(id); }, [n]);

  // a step begins on its clip, in the Watch mode, clean: the mode it asks for is the viewer's to choose (an Explain left
  // running would narrate the next clip, a What-if would reload the page on a clip change)
  useEffect(() => {
    if (!step) return;
    const h = hostRef.current;
    // what the step before opened is put away, unless this one keeps it: the menus, the player card, the left rail's
    // pop-overs, the pen
    const keep = new Set(step.keep ?? []);
    setPanel(null);
    if (!keep.has('rail')) railMenu.set(null);
    if (!keep.has('pen')) drawMode.set(false);
    if (!keep.has('card')) {
      // (the tour's own press: past its lock, which may still hold the step before's parts)
      const held = tourLock.keys; tourLock.keys = null;
      document.querySelector<HTMLButtonElement>('.hud-card .hud-plate-toggle[aria-expanded="true"]')?.click();
      tourLock.keys = held;
    }
    if (n === 1) { closeSummary(); if (getSettings().mode !== 'watch') setMode('watch'); drawMode.set(false); base.set(null); }
    if (step.mode && getSettings().mode !== step.mode) setMode(step.mode);
    const clip = step.clip;
    if (!clip) return;
    // (a What-if left on, past its own step, goes too: a reload there would bring it back over the clip)
    if (h.moment !== clip || (getSettings().mode === 'whatif' && step.place !== 'corner')) {
      if (getSettings().mode !== 'watch') setMode('watch');
      drawMode.set(false); base.set(null);
    }
    // asked again whenever the clip on screen is not the step's, for as long as the step lasts: a change asked while
    // another is still under way is not taken (a quick Next), one that failed to load ends back on the old clip, and the
    // browser's Back swaps in the clip before. Never in the What-if (a clip change there reloads the page), and a few
    // times at most (a clip that cannot load is not asked for over and over)
    let asked = 0, tries = 0;
    const ask = () => {
      const now = performance.now();
      if (hostRef.current.moment === clip || clipSwap.get() !== 'off' || now - asked < 1500 || tries >= 5 || getSettings().mode === 'whatif') return;
      // a VAR check still on owns the camera: it ends first, its camera back on the view it came from, and the clip
      // changes once it is off (Yi, 2026-10-28: Next during the check reloaded the pitch in the check's close-up)
      const vr = varReplay.get();
      if (vr.phase !== 'off') { if (varActive(vr)) endVar(); return; }
      asked = now; tries++; hostRef.current.gotoMoment(clip);
    };
    ask();
    const id = window.setInterval(ask, 400);
    return () => window.clearInterval(id);
  }, [n]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the welcome card without a show behind it (the page opened on a clip): straight to the first step
  useEffect(() => { if (n === 0 && !host.intro && !wantSkip) tourStep.set(1); }, [n, host.intro, wantSkip]);
  // Start the tour over the show: its Skip as soon as it is offered, then the first step once the game has taken over
  useEffect(() => {
    if (!wantSkip) return;
    // (the tour ended while the show was still running: it stays ended)
    if (!host.intro) { setWantSkip(false); if (tourStep.get() === 0) { setSkipped(true); tourStep.set(1); } return; }
    const id = window.setInterval(() => { skipShow(); }, 300);
    skipShow();
    return () => window.clearInterval(id);
  }, [wantSkip, host.intro]);

  const loading = !!step?.clip && (host.moment !== step.clip || swap !== 'off');
  // the commentary's switch is the Explain player's (explain/ExplainPlayer.tsx): read off the page, which re-renders this with the clock
  const voiceOff = s.mode === 'explain' && !!document.querySelector('.nr-sound') && !document.querySelector('.nr-sound.on');
  // (the player card's own open state, hud/PlayerCard.tsx, read the same way: the card's, not the replay plate's, which
  // is the same nameplate mirrored and shares its classes)
  const cardOpen = !!document.querySelector('.hud-card .hud-plate-toggle[aria-expanded="true"]');
  const vr = useStore(varReplay), varShown = !!document.querySelector('.hud-var'), varOn = vr.phase !== 'off';
  const ctx: Ctx = { s, t: host.t, end: host.end, base: b, strokes: st.length, phase: ld.phase, sum, voiceLocked: ex.locked, voiceOff, cardOpen, varShown, varOn, latched };
  const done = !loading && !!step?.done?.(ctx);
  useEffect(() => { if (done) setLatched(true); }, [done]);
  // a step that holds the clip keeps it still until Next (a clip change lands playing, so the hold is kept, not set once)
  useEffect(() => { if (step?.hold && !loading && host.playing) host.play(false); }, [n, loading, host.playing]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a step whose aim shows the play moving starts it once, when the aim is reached
  const played = useRef(-1);
  const reached = !!step && !loading && step.playOnAim === true && !(step.canShow?.(ctx) ?? true);
  // (a clip already held at its end runs back to the step's start first, so the play is there to watch: a step with its
  // own way back, onAim, takes it)
  useEffect(() => {
    if (!reached || played.current === visit.current) return;
    played.current = visit.current;
    const h = hostRef.current;
    if (!step?.onAim && h.end > 0 && h.t >= h.end - END_HOLD - 0.2) rewindTo(h, step?.loopFrom ?? 0);
    else if (!h.playing) h.play(true);
  }, [reached, n]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the moment again, once, when the aim is reached late (the clip already past it)
  const backed = useRef(-1);
  const aimed = !!step && !loading && !!step.onAim && !(step.canShow?.(ctx) ?? true);
  useEffect(() => { if (aimed && backed.current !== visit.current) { backed.current = visit.current; step?.onAim?.(hostRef.current); } }, [aimed, n]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the VAR step stops the clip once, the moment its button appears, so the pass is not missed (pressing VAR rewinds to
  // it anyway, should the viewer play on)
  const varPaused = useRef(-1);
  useEffect(() => {
    if (!step?.var || loading || !varShown || varPaused.current === visit.current || latched) return;
    varPaused.current = visit.current; if (hostRef.current.playing) hostRef.current.play(false);
  }, [n, loading, varShown, latched]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the proxy: a press on the larger part presses the small target (once per press; the target's own press is its own)
  useEffect(() => {
    const px = step?.proxy;
    if (!px) return;
    const press = (e: Event) => {
      const el = e.target as Element | null;
      if (!el?.closest?.(px.area) || el.closest(px.target)) return;
      const t = document.querySelector<HTMLButtonElement>(px.target);
      if (t) { e.preventDefault(); t.click(); }
    };
    document.addEventListener('click', press, true);
    return () => document.removeEventListener('click', press, true);
  }, [n]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the What-if step: the mode's own entry in the menu tells the What-if its moment first (the capture runs before the
  // menu's own press, which sets the mode)
  useEffect(() => {
    if (step?.title !== 'What if?') return;
    const press = (e: Event) => { if ((e.target as Element | null)?.closest?.('[data-mode="whatif"]')) presetChip(hostRef.current); };
    document.addEventListener('click', press, true);
    return () => document.removeEventListener('click', press, true);
  }, [n]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a step whose clip starts late (the last clip's end): there, once, as it lands
  const started = useRef(-1);
  useEffect(() => {
    if (!step?.startAt || loading || started.current === visit.current || host.end <= 0) return;
    started.current = visit.current; host.seek(step.startAt(host)); if (!step.waitAim) host.play(true);   // (a waiting step stays held there)
  }, [n, loading, host.end]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the end held: a clip that runs out while the viewer is still reading stops just short of its last frame, with the
  // players on the pitch (the What-if and a VAR check run their own clocks; Explain's director holds just short of the end
  // itself while the voice finishes its last words, which a hold here would cut)
  useEffect(() => {
    if (!step || step.natural || loading || !host.playing || host.end <= 0 || s.mode === 'whatif' || s.mode === 'explain' || vr.phase !== 'off') return;
    if (host.t < host.end - END_HOLD) return;
    if (step.loopFrom !== undefined) host.seek(step.loopFrom);   // the goal again, the camera still the viewer's
    else { host.play(false); host.seek(host.end - END_HOLD); }
  }, [host.t]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the HUD parts the step points at glow until each is clicked, or the step's target is reached (its Show me is no
  // longer offered), or the step is done
  const aim = !!step && (step.canShow?.(ctx) ?? true);
  // a step that waits for its aim keeps the clip still until then (a clip change lands playing: kept, not set once)
  useEffect(() => { if (step?.waitAim && !loading && aim && host.playing) host.play(false); }, [n, loading, aim, host.playing]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clicked = useRef(new Set<string>());
  useEffect(() => { clicked.current = new Set(); }, [n]);
  useEffect(() => {
    const aimed = !latched && !loading && aim ? step?.glow ?? [] : [];
    const always = !loading ? step?.glowWhile ?? [] : [];
    const clear = () => document.querySelectorAll('.tour-glow').forEach((e) => e.classList.remove('tour-glow'));
    if (!aimed.length && !always.length) { clear(); return; }
    // each tick: the parts to glow now (a menu opened, the switch turned on) and none other
    const mark = () => {
      const lit = new Set<Element>();
      for (const sel of aimed) if (!clicked.current.has(sel)) document.querySelectorAll(sel).forEach((e) => lit.add(e));
      for (const sel of always) document.querySelectorAll(sel).forEach((e) => lit.add(e));
      document.querySelectorAll('.tour-glow').forEach((e) => { if (!lit.has(e)) e.classList.remove('tour-glow'); });
      lit.forEach((e) => e.classList.add('tour-glow'));
    };
    const press = (e: Event) => {
      const el = e.target as Element | null;
      for (const sel of aimed) if (el?.closest?.(sel)) { clicked.current.add(sel); mark(); }
    };
    mark();
    const id = window.setInterval(mark, 300);
    document.addEventListener('pointerdown', press, true);
    return () => { window.clearInterval(id); document.removeEventListener('pointerdown', press, true); clear(); };
  }, [n, latched, loading, aim]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the held parts shown as held (Yi, 2026-10-28: "grey out other options"): every HUD control the step does not let
  // through is dimmed, each tick (menus open, the rail changes), and all undimmed when the step or the tour ends
  useEffect(() => {
    if (!step) return;
    const allow = loading ? '' : (step.allow ?? []).join(',');
    const CONTROLS = '.hud button, .hud [role="menuitemradio"], .hud [role="tab"], .hud [data-hud-toggle], .hud-nextclip';
    const mark = () => document.querySelectorAll(CONTROLS).forEach((e) => e.classList.toggle('tour-off', !(allow && e.closest(allow))));
    mark();
    const id = window.setInterval(mark, 250);
    return () => { window.clearInterval(id); document.querySelectorAll('.tour-off').forEach((e) => e.classList.remove('tour-off')); };
  }, [n, loading]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the lock (tour.ts): keys and HUD buttons the step does not ask for are held, and the card nods. While the step's clip
  // loads, everything is held (a mode picked then would act on the clip going away: the What-if's reloads the page)
  useEffect(() => {
    if (!step) { tourLock.keys = null; tourLock.allow = ''; return; }
    tourLock.keys = new Set(loading ? [] : [...(step.noEsc ? [] : ['Escape']), ...(step.keys ?? [])]);
    tourLock.allow = loading ? '' : (step.allow ?? []).join(',');
    tourLock.onHeld = () => setNudge((x) => x + 1);
    return () => { tourLock.keys = null; tourLock.allow = ''; };
  }, [n, loading]);   // eslint-disable-line react-hooks/exhaustive-deps

  // while the tour runs the page says so: the bottom hint and the pause window keep clear of the card
  useEffect(() => {
    document.body.classList.toggle('tour-on', !!step); document.body.classList.toggle('tour-var', !!step?.var);
    // (once checked, the VAR button's own pulse stops: it would ask for the check again)
    document.body.classList.toggle('tour-var-done', !!step?.var && latched);
    document.body.classList.toggle('tour-sum', step?.kind === 'summary');
    document.body.classList.toggle('tour-corner', step?.place === 'corner');
    return () => { for (const c of ['tour-on', 'tour-var', 'tour-var-done', 'tour-sum', 'tour-corner']) document.body.classList.remove(c); };
  }, [step, latched]);

  if (!step) return null;
  const go = (k: number) => tourStep.set(Math.min(LAST, Math.max(1, k)));
  // the moving arrow beside the step's small target (read each tick: the card can open, close, move)
  const pt = step.point && !loading ? document.querySelector(step.point)?.getBoundingClientRect() : null;
  const arrow = pt && pt.width > 0 ? <i className="tour-point" aria-hidden="true" style={{ left: pt.right + 10, top: pt.top + pt.height / 2 }} /> : null;
  const place = step.kind === 'summary' && sum ? ' tour-bottom' : step.place ? ` tour-${step.place}` : '';
  // a Mode or View menu open at the top right: on a narrower screen the card steps left of it, so no row is under the card
  const menu = !place ? document.querySelector('.hud-mpick, .hud-vpick')?.getBoundingClientRect() : null;
  const cardW = Math.min(560, innerWidth - 40), gap = 16;
  const aside = menu && menu.width > 0 && (innerWidth + cardW) / 2 + gap > menu.left ? { left: Math.max(20 + cardW / 2, menu.left - gap - cardW / 2) } : undefined;
  const showMe = !loading && step.showMe && (step.canShow?.(ctx) ?? true);
  return (
    // a press on the card's buttons keeps the keyboard where it was, so space still plays the clip (a focused button would
    // take it as a click: Next, or Show me again)
    <>{arrow}<div key={nudge} className={`tour hud-glass${place}${nudge ? ' tour-nudge' : ''}`} style={aside} role="dialog" aria-label="Tour"
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}>
      <div className="tour-head">
        <b className="tour-title">{step.title}</b>
        {n >= 1 && <span className="tour-count">{n} / {LAST}</span>}
      </div>
      {n === 1 && skipped && <p className="tour-note">Intro skipped: the tour starts at the kick-off. Press <b>L</b> after the tour to watch it.</p>}
      <p className="tour-text">{rich(loading ? step.lead ?? '' : step.text(ctx))}</p>
      {loading && <p className="tour-status"><i className="tour-spin" aria-hidden="true" />Taking you to {step.at}</p>}
      <div className="tour-actions">
        {step.kind === 'welcome' && <button type="button" className="tour-btn go" disabled={wantSkip} onClick={() => (host.intro ? setWantSkip(true) : go(1))}>{wantSkip ? <><i className="tour-spin" aria-hidden="true" />Loading</> : 'Start the tour'}</button>}
        {step.kind === 'summary' && sum && <>
          <button type="button" className="tour-btn go" onClick={() => endTour()}>Explore on your own</button>
          <button type="button" className="tour-btn" onClick={() => startTour(1)}>Restart the tutorial</button>
        </>}
        {/* Show me stays in its place on every step, greyed while it has nothing to do (done already, a clip loading, or a
            step it cannot do for the viewer), so the row does not shift and nothing looks pressable that is not */}
        {n >= 1 && n < LAST && <button type="button" className="tour-btn" disabled={!showMe} title={showMe ? 'Do this step for me' : 'Nothing to show here'} onClick={() => step.showMe?.(hostRef.current)}>Show me</button>}
        {n >= 1 && n < LAST && <button type="button" className={`tour-btn${latched ? ' go ready' : ''}`} disabled={loading} onClick={(e) => { if (e.detail <= 1) go(n + 1); }}>Next</button>}
        {!(step.kind === 'summary' && sum) && <button type="button" className="tour-btn quiet" onClick={() => endTour()}>End tour</button>}
      </div>
    </div></>
  );
}
