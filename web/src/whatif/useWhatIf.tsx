import { clipAddr, modelFile } from '../data/paths';
import { passOptions, type PassModel } from '../hud/passProb';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Loaded } from '../data';
import type { Clock } from '../clock';
import type { Look } from '../three/players/looks';
import { getSettings, setSettings, guardLeave, type GameMode } from '../game/settings';
import { loadClips, MOTION_CLIPS, type AnimClip } from './motion';
import { loadGait, type GaitLib } from './gait';
import { land, useLand, LAND_OFF, wiStyle, wiRewind, useWiRewind, wiTagged, type LandState, type ChainStep } from './state';
import { loadModels, sceneAt, play as playOutcome, fromModel, facingOf, shootFromHere, type Models, type Scene0, type Outcome, type Pass } from './onball';
import { buildBranch, isBranch, ACT_CLIPS, type BranchInfo } from './branch';
import { decide, tryPass, offsideAtStrike, type Tried } from './chain';
import { candidates, optionFor, pressed, keepWorth, OPTION_MIN_P } from './options';
import { WhatIfScene } from '../three/whatif/WhatIfScene';
import { realAfter } from './snap';
import { RunCard } from './RunCard';
import { realPass, runWhatIf, type RealPass } from './offball';
import { loadXgModel, loadAerial, realShot as realShotOf, shotInClip, shotOnPaths, type ShotEval } from './shot';
import type { XgFreezeModel } from '../response/xg';
import { AskCard } from './AskCard';
import { LEAD, MOMENTS, WI_NONE, clipOf, momentById, resolveMoment, useWiNow, wiNow, type WiMoment } from './moments';
import './whatif.css';
import { WHATIF_CLIPS } from '../hud/directed';

// The What-if mode in the game shell (Yi, 2026-10-24 evening: What-if out of 战术 into a mode of its own, on curated
// moments). Everything the what-if does to the game is here, so the shell (GameApp.tsx, chat 5's) only hands over its
// clock and clip and calls in: `play` and `tick` first in its own, `ui` among its overlays, `realData` for whatever must
// see the real clip while a branch plays.
// - A moment (moments.ts) is a clip's: in this mode the clip's moment plays in by itself, from LEAD s before, and stops
//   on the reception; the widget (AskCard.tsx) asks what to change. The clip is picked in the replay plate (Yi,
//   2026-10-26: "there should not be a what-if moments [list] at top left, they should be just in media player"; the
//   Shell's What-if player lists the approved clips), or [ and ] step through them. Any play through the moment from
//   before stops on it.
// - The change plays as a branch of the clip (branch.ts: the real clip to the moment, the simulation after it) and stops
//   at its end with the result card (LandCard.tsx); "Try another target" picks again, "Back to the real play" returns to
//   the moment, the question card open again. Leaving the mode ends it.

export interface WhatIfHost {
  data: Loaded | null; setData: (d: Loaded) => void;
  clock: Clock; st: MutableRefObject<{ playing: boolean; speed: number; ui: number }>;
  setPlaying: (p: boolean) => void; setT: (t: number) => void;
  /** the clip shown (its moment path, <match>/<id>), the mode, the clock as last drawn, playing or not */
  moment: string; mode: GameMode; t: number; playing: boolean;
  looks: Look[];
}

/** the moments open to the viewer: those on a clip Yi has approved (the Shell's gate, hud/directed.ts WHATIF_APPROVED;
 *  Yi 2026-10-26: "there is only one clip I approved for what if, we will examine other ones"); the rest stay listed in
 *  moments.ts for when he does */
export const OPEN = MOMENTS.filter((m) => WHATIF_CLIPS.has(m.clip));

/** his real receiver as he took it: where, and the shot he had then (shot.ts, his real body's facing, the real positions
 *  as they went on); an offside pass's man has none, the move ends there (the 48:14 moment, 2026-10-26) */
function realTake(base: Loaded, M: Models, xg: XgFreezeModel, rp: RealPass): { at: [number, number]; ev: ShotEval } {
  const f = base.pkg.frames[Math.min(base.pkg.frames.length - 1, Math.round(rp.tRec * base.pkg.meta.fps))], nA = f.att.length, q = rp.receiver < nA ? f.att[rp.receiver] : f.def[rp.receiver - nA];
  const at: [number, number] = [q[0], q[1]];
  if (rp.offside) return { at, ev: { first: null, touch: null, best: null, no: { why: 'offside', beyond: rp.offside.beyond } } };
  return { at, ev: shotInClip(xg, M.tov, base.pkg as never, rp.tRec, rp.receiver, base.joints && !isBranch(base) ? facingOf(base.joints, Math.round(rp.tRec * base.joints.fps), rp.receiver) : null) };
}

/** how fast a simulated play runs back to its moment when the mode is left (twice the real speed, backwards) */
const REWIND_X = 2;

/** The chance by each option's name, and the worth that ranks the options: `opta`, the Tactics mode's pass model
 *  (hud/passProb.ts, distilled from Opta's own expected completion), since 2026-10-27 (Yi, on Marsh's chip back to
 *  Whitfield at 26:42, failed in real life, "a very hard to succeed pass", 68% by the response model: "we can distill the
 *  opta pass success rate or something to make it more realistic"); `?wichance=model` shows the response model's
 *  first-touch chance, the ruler before. Measured on this match's real passes in the clips (142-151), at the touch
 *  before each, against Opta's expected completion: the response model's chance correlates 0.43, the distilled model
 *  0.79; for the hardest passes (Opta 0.37) they say 0.78 / 0.42. (Spearman's pitch control at the meeting point was
 *  measured too, 0.66, and dropped at Yi's word the same day.) The simulation itself (who gets the ball, where) is the
 *  response model's either way. */
const CHANCE = ((typeof location !== 'undefined' && new URLSearchParams(location.search).get('wichance')) || 'opta') as 'model' | 'opta';
let passModelP: Promise<PassModel | null> | null = null;
const loadPassModel = () => (passModelP ??= fetch(modelFile('pass_distil.json')).then((r) => (r.ok ? r.json() as Promise<PassModel> : null)).catch(() => null));

export function useWhatIf(h: WhatIfHost) {
  const { data, setData, clock, st, setPlaying, setT, moment, mode, t, playing, looks } = h;
  const ld = useLand(), wi = useWiNow();
  // while a branch plays, `real` keeps the clip it left, and `sim` what it was made from
  const real = useRef<Loaded | null>(null);
  // a chain's step is built on what the last one left (the real clip, or the last step's simulation): `stepBase`; and
  // the models, kept once loaded, for "let him choose"
  const stepBase = useRef<Loaded | null>(null);
  const mods = useRef<{ M: Models; clips: Record<string, AnimClip>; xg: XgFreezeModel | null; gait: GaitLib | null } | null>(null);
  // the passes tried for his options while he picks (options.ts), by package index, so a click plays one at once
  const optCache = useRef<{ key: string; tried: Map<number, Tried> }>({ key: '', tried: new Map() });
  // (for a run, `pass` is the real pass with the new run and `alt` the pass into the run, `target` where each goes)
  // (`real`: the off-ball what-if's tracked bodies kept past the moment, branch.ts BranchOpts)
  const sim = useRef<{ c: Scene0; pass: Pass; M: Models; clips: Record<string, AnimClip>; target: [number, number]; alt?: { pass: Pass; outs: Outcome[]; target: [number, number] }; real?: { p: number; until: number }[]; xg?: XgFreezeModel | null } | null>(null);
  // the clip last handed to the shell by this hook, read by the effects below in place of `data`: a store change
  // renders at once (useSyncExternalStore), before React applies the setData of the same tick, so after Try another the
  // options effect still saw the branch as `data` and took the moment for a simulated clip's: the real receiver lost his
  // "real" mark and his real numbers, and an offside man got a chance by his name (found 2026-10-26)
  const handed = useRef<Loaded | null>(null);
  useEffect(() => { handed.current = data; }, [data]);
  const show = useCallback((d: Loaded) => { handed.current = d; setData(d); }, [setData]);
  // the ghost style (Yi, 2026-10-25): from the pause on ("when we pause, we should already transform from cartoon
  // player style to ghost style just without trail"), its trail while a pass plays and while a play runs back. The
  // branch's bodies (Yi, 2026-10-27: "actually animate each player to that spot"): the ghosts move by the real strides
  // (gait.ts); until then they were dragged along their paths in their pose of the pause (?widrag=1 keeps that;
  // ?wigait=0 the Mixamo loops of motion.ts alone). The viewer's own style comes back after.
  const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null, DRAG = Q?.get('widrag') === '1', GAIT = Q?.get('wigait') !== '0';
  const ghostAs = (want: 'ghost' | 'ghost-still' | null) => { if (wiStyle.get() !== want) wiStyle.set(want); };
  const halt = (x: number) => { const s = st.current; clock.t = x; s.playing = false; setPlaying(false); s.ui = 1; };
  // every way back runs the play back first (Yi, 2026-10-26, leaving to Watch: "we should first animate the clip in
  // reversed way, to go back to the freeze moment, and then do the transition to put the pitch back to grass texture";
  // "for try another button, we should animate the scene back, instead of just suddenly blink to the last moment"): the
  // play runs back at REWIND_X to where the way back lands, then it is taken: Try another to this step's start; Start
  // over, Esc and leaving the mode to the chain's first moment (the mode change held meanwhile, game/settings.ts
  // guardLeave, so the pitch changes after). The widget and the marks are off meanwhile (wiRewind)
  const rewind = useRef<{ to: number; then: () => void } | null>(null), rw = useWiRewind();
  /** run the play back to `to`, then `then`; at once when nothing has played (picking) or the clock is there already;
   *  asked again on the way, the latest way back wins */
  const backTo = (to: number, then: () => void) => {
    const L = land.get();
    if (rewind.current) { rewind.current = { to, then }; return; }
    if ((L.phase !== 'sim' && L.phase !== 'result') || clock.t <= to + 0.05) { then(); return; }
    rewind.current = { to, then }; wiRewind.set(true);
    st.current.speed = 1; st.current.playing = true; setPlaying(true);
  };

  /** the shell's play(p) asks first: a finished branch plays again from the moment */
  const play = (p: boolean) => {
    const L = land.get();
    if (rewind.current) return true;   // (on its way back: play waits)
    // (from the chain's first pass: the last step's clip holds them all)
    if (p && L.phase === 'result' && L.info) { clock.t = L.steps[0]?.t0 ?? L.info.t0; land.set({ ...L, phase: 'sim' }); st.current.playing = true; setPlaying(true); return true; }
    return false;
  };
  /** the shell's tick asks first: a branch stops at its end, the card open (no loop); in the What-if mode, play through
   *  the moment from before it stops on it */
  const tick = (dt: number) => {
    const s = st.current, L = land.get(), w = wiNow.get(), R = rewind.current;
    if (R) {
      clock.t = Math.max(R.to, clock.t - dt * REWIND_X);
      if (clock.t <= R.to + 1e-6) { rewind.current = null; halt(R.to); wiRewind.set(false); R.then(); }
      return true;
    }
    // picking ends as soon as the clock leaves his moment, whatever moved it: play, a seek, a frame step, an event jump
    // (Yi, 2026-10-26: the columns of light stayed on a play that had moved on). Out of a chain, back to the real clip:
    // where a seek went, or with play at the chain's first moment
    if (L.phase === 'pick' && Math.abs(clock.t - L.t0) > 1e-3) {
      if (!L.steps.length) { land.set(LAND_OFF); return false; }
      const back = real.current, to = clock.t, seek = !s.playing;
      leaveRef.current(false, true);
      if (seek && back) { clock.t = Math.min(to, (back.pkg.frames.length - 1) / back.pkg.meta.fps); setT(clock.t); }
      return true;
    }
    if (!s.playing || s.speed <= 0) return false;
    // a branch playing: the clock is ours, to its end (a chain's next clip is longer than the last, and the shell, until
    // it renders the new one, would stop it at the old clip's end: 2026-10-25)
    if (L.phase === 'sim' && L.info) {
      const nt = clock.t + dt * s.speed;
      if (nt >= L.info.end - 1e-3) { halt(L.info.end); land.set({ ...L, phase: 'result' }); } else clock.t = nt;
      return true;
    }
    // (strictly before it: a play-in of exactly 3.5 s at 60 frames a second lands a hair under the moment, and a
    // tolerance there let it run on, 2026-10-25; a halt puts the clock on it exactly, so play goes on from there)
    if (getSettings().mode === 'whatif' && w.id && L.phase === 'off' && clock.t < w.t && clock.t + dt * s.speed >= w.t) {
      // on the moment, straight into picking his pass; no one selected (Yi, 2026-10-25: no rotating ring for the passer:
      // it sat over the ghosts and against the columns of light)
      halt(w.t); setSettings({ selected: null });
      land.set({ ...LAND_OFF, phase: 'pick', kind: 'pass', t0: w.t, carrier: w.carrier });
      return true;
    }
    return false;
  };

  // ---- the moments
  /** play a moment in, in the clip loaded */
  const start = useCallback((m: WiMoment, d: Loaded) => {
    const r = resolveMoment(d.pkg as never, m);
    wiNow.set({ id: m.id, t: r.t, carrier: r.player });
    clock.t = Math.max(0, r.t - LEAD); setT(clock.t);
    st.current.speed = 1; st.current.playing = true; setPlaying(true);
  }, [clock, st, setPlaying, setT]);
  // in the What-if mode the clip's open moment plays in by itself, once: a clip picked in the replay plate, the mode
  // picked on a clip that has one, the page's address (?wi= picks among a clip's moments, from [ and ])
  const asked = useRef(typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('wi'));
  useEffect(() => {
    if (!data || real.current || mode !== 'whatif' || land.get().phase !== 'off') return;
    // (a ?wi= of another clip is ignored: the shell's clip change keeps the address's other parameters, so coming from
    // 26:40 to 48:14 brought wi=m3 along and nothing played in there, Yi 2026-10-27: "what if seems to be not yet there
    // for other two clips")
    const clip = clipOf(moment), askedM = asked.current ? momentById(asked.current) : null;
    const m = askedM && askedM.clip === clip ? askedM : OPEN.find((x) => x.clip === clip);
    asked.current = null;
    if (m && m.clip === clip && OPEN.includes(m) && wiNow.get().id !== m.id) start(m, data);
  }, [data, moment, mode, start]);

  // ---- the branch
  /** one outcome played as a branch (the real clip to the moment, the simulation after it) from the moment */
  const showOutcome = useCallback((base: Loaded, outs: Outcome[], i: number, L: LandState, alt = false) => {
    const S = sim.current, P = alt ? S?.alt?.pass : S?.pass, target = alt ? S?.alt?.target : S?.target;
    if (!S || !P || !target) return;
    // the pass what-if ends in a shot (shot.ts): a pass a teammate receives is played on first to see what shot he has
    // (as it comes, or a touch first), then the branch runs to that moment: the touch, or where he is ready to shoot
    const toShot = L.kind === 'pass', o = outs[i];
    let shot: LandState['shot'] = null, after = 15, finish: { how: 'first' | 'touch'; kind: 'header' | 'volley' | 'drive'; z: number } | null = null;
    if (toShot && S.xg && o.kind === 'kept' && o.who >= 0) {
      const probe = playOutcome(S.M, S.c, P, o), k = Math.max(0, Math.round(o.t / 0.1) - 1), bz = probe.ball[k]?.[2] ?? 0.11, ev = shotOnPaths(S.xg, S.M.tov, probe.paths, k, o.who, S.c.gk, bz);
      after = ev.best?.how === 'touch' ? Math.round(ev.best.adjust / 0.1) + 1 : 1;
      const b = ev.best, at = fromModel(S.c, [...(b ? b.at : probe.paths[o.who][k])] as [number, number]);
      shot = { who: S.c.toPkg[o.who], at, xg: b?.xg ?? 0, header: b?.kind === 'header', no: ev.no, eval: ev };
      // the finish the branch shows (branch.ts): a header, volley or drive as the ball comes, or the touch as before
      finish = b ? { how: b.how, kind: b.kind, z: bz } : null;
      // (window.__wiFinish = { how, kind }: a finish forced on the branch, for looking at the animation; checks only)
      const forced = (globalThis as { __wiFinish?: { how: 'first' | 'touch'; kind: 'header' | 'volley' | 'drive' } }).__wiFinish;
      if (forced && finish) { finish = { ...finish, ...forced }; if (forced.how === 'first') after = 1; }
    }
    const bodies = { drag: DRAG, gait: GAIT ? mods.current?.gait ?? null : null, finish };
    const pl = playOutcome(S.M, S.c, P, o, toShot ? after : 15), { data: br, info } = buildBranch(base, S.clips, L.t0, S.c, pl, target, o, P, alt ? bodies : { real: S.real, ...bodies });
    (window as unknown as { __wiBranch?: unknown }).__wiBranch = { pkg: br.pkg, joints: br.joints, info, toPkg: S.c.toPkg };   // for checks
    if (!real.current) real.current = base;
    show(br); clock.t = info.t0; setT(info.t0);
    st.current.playing = true; setPlaying(true);
    land.set({ ...L, phase: 'sim', outcomes: alt ? L.outcomes : outs, shown: alt ? -1 : i, alt, info, toPkg: S.c.toPkg, shot,
      realShot: L.realShot !== undefined ? L.realShot : S.xg ? (() => { const r = realShotOf(S.xg, base.pkg as never, L.t0); return r ? { who: r.who, xg: r.xg, opta: r.opta, goal: r.goal } : null; })() : null });
  }, [clock, st, show, setPlaying, setT, DRAG, GAIT]);
  useEffect(() => {
    if (ld.phase !== 'computing' || !data || !(ld.kind === 'run' ? ld.runner !== null && ld.runEnd : ld.target)) return;
    let live = true;
    const base = stepBase.current ?? real.current ?? handed.current ?? data, L = ld;
    Promise.all([loadModels(), loadClips([...MOTION_CLIPS, ...ACT_CLIPS]), loadXgModel(), loadGait(), loadAerial()]).then(([M, clipsAnim, xg, gait]) => {
      if (!live) return;
      mods.current = { M, clips: clipsAnim, xg, gait };
      // (on a simulated clip his pose is dragged, not his own: he faces the way he moves)
      const c = sceneAt(base.pkg as never, L.t0, L.carrier, isBranch(base) ? null : base.joints), ghost = realAfter(base.pkg as never, L.t0, L.carrier);
      if (L.kind === 'pass') {
        // a shooting moment, his own column clicked: the real play to his shot, the real positions (Yi, 2026-10-26)
        if (L.toWho === L.carrier && xg) {
          const r = realShotOf(xg, base.pkg as never, L.t0);
          if (r) {
            const f = base.pkg.frames[Math.min(base.pkg.frames.length - 1, Math.round(r.t * base.pkg.meta.fps))], nA = f.att.length, q = L.carrier < nA ? f.att[L.carrier] : f.def[L.carrier - nA];
            const info: BranchInfo = { t0: L.t0, target: [q[0], q[1]], outcome: { who: -1, p: 1, t: r.t - L.t0, kind: 'kept' }, carrier: L.carrier, who: L.carrier, tackler: null, end: r.t, turn: 0, hold: 0 };
            // (the real shot as it was, on the model: its xG, a header or a foot; not an evaluation of a shot from there)
            const way = { how: 'first' as const, kind: r.header ? 'header' as const : 'drive' as const, xg: r.xg, value: r.xg, adjust: 0, pLose: 0, at: [q[0], q[1]] as [number, number] };
            sim.current = null; if (handed.current !== base) show(base); clock.t = L.t0; setT(L.t0); st.current.speed = 1; st.current.playing = true; setPlaying(true);
            land.set({ ...L, phase: 'sim', isReal: true, info, outcomes: [], shown: 0, toPkg: c.toPkg, loft: false, choice: null, lane: null, realPick: null,
              shot: { who: L.carrier, at: [q[0], q[1]], xg: r.xg, header: r.header, no: null, eval: { first: way, touch: null, best: way, no: null } }, realShot: { who: r.who, xg: r.xg, opta: r.opta, goal: r.goal } });
            return;
          }
        }
        // his real pass, and that receiver's xG as he really took it: the real play itself when he is the one picked
        const rp = realPass(base.pkg as never, L.t0, L.carrier);
        let realPick: LandState['realPick'] = null;
        if (rp && xg) {
          const { at: q, ev } = realTake(base, M, xg, rp);
          realPick = { who: rp.receiver, xg: ev.best?.xg ?? 0, offside: !!rp.offside };
          if (L.toWho === rp.receiver) {
            const info: BranchInfo = { t0: L.t0, target: [q[0], q[1]], outcome: { who: -1, p: 1, t: rp.tRec - L.t0, kind: 'kept' }, carrier: L.carrier, who: rp.receiver, tackler: null, end: rp.tRec, turn: 0, hold: 0 };
            const r = realShotOf(xg, base.pkg as never, L.t0);
            sim.current = null; if (handed.current !== base) show(base); clock.t = L.t0; setT(L.t0); st.current.speed = 1; st.current.playing = true; setPlaying(true);
            land.set({ ...L, phase: 'sim', isReal: true, info, outcomes: [], shown: 0, toPkg: c.toPkg, loft: rp.loft, choice: null, realPick,
              shot: { who: rp.receiver, at: [q[0], q[1]], xg: ev.best?.xg ?? 0, header: ev.best?.kind === 'header', no: ev.no, eval: ev }, realShot: r ? { who: r.who, xg: r.xg, opta: r.opta, goal: r.goal } : null });
            return;
          }
        }
        // the teammate picked: the pass goes into his stride, along the ground and lofted both tried, and the one worth
        // more is played (his chance of receiving it times his xG as he takes it; Yi, 2026-10-25: "it should also be
        // handled intelligently, so we just tell, I think I should pass to A not B")
        const to = L.toWho !== null ? c.toPkg.indexOf(L.toWho) : -1;
        if (to < 0) { land.set({ ...L, phase: 'pick' }); return; }
        const cached = optCache.current.key === `${L.t0}|${L.carrier}` ? optCache.current.tried.get(L.toWho!) : undefined;
        const best = cached ?? tryPass(M, c, xg, to), target = fromModel(c, best.Q);
        sim.current = { c, pass: best.pass, M, clips: clipsAnim, target, xg };
        showOutcome(base, best.outs, 0, { ...L, ghost, target, loft: best.loft, choice: best.other, lane: best.lane !== null ? c.toPkg[best.lane] : null, realPick, isReal: false });
        return;
      }
      // the off-ball what-if: the real pass, the new run (offball.ts); the card compares it with his real run
      const rp = realPass(base.pkg as never, L.t0, L.carrier);
      if (!rp) { land.set({ ...L, phase: 'pick', runEnd: null }); return; }
      const r = runWhatIf(M, base.pkg as never, c, L.t0, rp, L.runner!, L.runEnd!), P = (i: number) => c.toPkg[i];
      const from = (q: [number, number]): [number, number] => (c.flipped ? [-q[0], -q[1]] : q);
      // the passer and the real receiver are on their tracked paths, so their tracked bodies play: his real strike, the
      // real touch (2026-10-25)
      const realBodies = [{ p: L.carrier, until: rp.tStrike + 0.35 }, { p: rp.receiver, until: rp.tRec + 0.05 }];
      sim.current = { c, pass: r.pass, M, clips: clipsAnim, target: r.to, alt: r.alt ? { pass: r.alt.pass, outs: r.alt.outs, target: from(r.alt.pass.plan!.path[r.alt.pass.plan!.n - 1]) } : undefined, real: realBodies };
      const fr = base.pkg.frames, fps = base.pkg.meta.fps, k0 = Math.round(L.t0 * fps), nAtt = fr[0].att.length;
      const realRun = fr.slice(k0, k0 + 61).map((f) => (L.runner! < nAtt ? f.att[L.runner!] : f.def[L.runner! - nAtt])).map((q) => [q[0], q[1]] as [number, number]);
      const run = { receiver: rp.receiver, base: r.base, now: r.now, follower: r.follower ? { who: P(r.follower.who), shift: r.follower.shift } : null, alt: r.alt ? { receive: r.alt.receive, loft: r.alt.loft } : null, len: r.len, dur: r.dur };
      showOutcome(base, r.outs, 0, { ...L, ghost: { ...ghost, run: realRun }, run, target: r.to });
    });
    return () => { live = false; };
  }, [ld.phase]);   // eslint-disable-line react-hooks/exhaustive-deps
  /** back to the real clip at the moment; or (again) this step picked again, from where it started (the chain's
   *  earlier passes kept) */
  const leave = useCallback((again: boolean, off = false) => {
    const L = land.get(), from = again ? stepBase.current ?? real.current : real.current;
    if (from) show(from);
    if (!isBranch(from ?? null)) real.current = null;
    if (!again) stepBase.current = null;
    const t0 = again ? L.t0 : L.steps[0]?.t0 ?? L.t0, carrier = again ? L.carrier : L.steps[0]?.from ?? L.carrier;
    clock.t = t0; setT(t0); st.current.playing = false; setPlaying(false);
    // back at the moment he picks again (the real play goes on with play); leaving the mode ends it
    land.set(off ? LAND_OFF : again ? { ...LAND_OFF, phase: 'pick', kind: L.kind, runner: L.runner, t0, carrier, showReal: L.showReal, steps: L.steps } : { ...LAND_OFF, phase: 'pick', kind: 'pass', t0, carrier });
  }, [clock, st, show, setPlaying, setT]);
  const leaveRef = useRef(leave); leaveRef.current = leave;
  /** the pass done is one step of the chain (state.ts ChainStep): his touch is where the next one starts */
  const stepOf = (L: LandState): ChainStep | null => {
    if (!L.info || L.info.who < 0 || L.info.outcome.kind !== 'kept') return null;
    const p = L.isReal ? 1 : L.outcomes[L.shown]?.p ?? 0;
    // (no shot from where he took it: that pass is worth nothing as an assist)
    // (the next step starts where this one stopped: his touch, or where he was ready to shoot after it)
    return { from: L.carrier, to: L.info.who, t0: L.t0, tTouch: L.info.end, real: L.isReal, loft: L.loft, p, xg: L.shot?.eval.best?.xg ?? 0, auto: L.auto };
  };
  /** pass on from his touch: the viewer picks the next man (or he chooses, `to`) */
  const passOn = (to: number | null = null, decision: LandState['decision'] = null) => {
    const L = land.get(), step = stepOf(L);
    if (L.phase !== 'result' || !step || !data) return;
    stepBase.current = data;
    clock.t = step.tTouch; setT(step.tTouch); st.current.playing = false; setPlaying(false);
    land.set({ ...LAND_OFF, phase: to === null ? 'pick' : 'computing', kind: 'pass', t0: step.tTouch, carrier: step.to, toWho: to, target: to === null ? null : [0, 0], auto: to !== null, decision,
      steps: [...L.steps, step], realShot: L.realShot, showReal: false });
  };
  /** "Shoot" on the widget: at a shooting moment his real shot plays (his own column); at a pass moment his xG if he
   *  shot now, from the scene, no branch (shot.ts evalShot's first-time way on the ball at his feet) */
  // Shoot (Yi, 2026-10-26: "we animate it, once the user clicks shoot"): at a shooting moment his real shot plays; at a
  // pass moment his shot from here plays as a branch (onball.ts shootFromHere: the turn and the strike, everyone
  // answering), stopping on the strike with its xG (shot.ts, from the scene; Yi, 2026-10-26: no ball into the goal);
  // where he cannot shoot, the widget says so and nothing plays
  const shootHere = () => {
    const L = land.get(), base = stepBase.current ?? real.current ?? data;
    if (L.phase !== 'pick' || !base) return;
    if (L.atShot) { land.set({ ...L, phase: 'computing', target: [0, 0], toWho: L.carrier, hoverWho: null }); return; }
    land.set({ ...L, shootHere: null });
    Promise.all([loadModels(), loadClips([...MOTION_CLIPS, ...ACT_CLIPS]), loadXgModel(), loadGait(), loadAerial()]).then(([M, clipsAnim, xg, gait]) => {
      const cur = land.get();
      if (cur.phase !== 'pick' || cur.t0 !== L.t0 || !xg) return;
      const facing = base.joints && !isBranch(base) ? facingOf(base.joints, Math.round(L.t0 * base.joints.fps), L.carrier) : null;
      const ev = shotInClip(xg, M.tov, base.pkg as never, L.t0, L.carrier, facing);
      if (ev.no) { land.set({ ...cur, shootHere: { xg: 0, no: ev.no } }); return; }
      const c = sceneAt(base.pkg as never, L.t0, L.carrier, isBranch(base) ? null : base.joints), sh = shootFromHere(M, c), target = fromModel(c, sh.target);
      // a shot, as the branch sees it: the passer "kicks", nobody receives; the stop is the strike (shootFromHere)
      const o: Outcome = { who: -1, p: 1, t: sh.played.ball.length * 0.1, kind: 'none' };
      const pass: Pass = { ball: [], plan: null, kp: [], turn: sh.turn, hold: sh.hold, dir: [1, 0] };
      const { data: br, info } = buildBranch(base, clipsAnim, L.t0, c, sh.played, target, o, pass, { drag: DRAG, gait: GAIT ? gait : null });
      // (the same way the options are worked out: his best way from here, with the turn it costs him)
      const way = ev.best!, at: [number, number] = (() => { const f = base.pkg.frames[Math.min(base.pkg.frames.length - 1, Math.round(L.t0 * base.pkg.meta.fps))], nA = f.att.length, q = L.carrier < nA ? f.att[L.carrier] : f.def[L.carrier - nA]; return [q[0], q[1]]; })();
      // the real choice, shown beside it as data: his real receiver's xG as he took it
      const rp = isBranch(base) ? null : realPass(base.pkg as never, L.t0, L.carrier);
      const realPick = rp ? { who: rp.receiver, xg: realTake(base, M, xg, rp).ev.best?.xg ?? 0, offside: !!rp.offside } : null;
      if (!real.current) real.current = base;
      show(br); clock.t = info.t0; setT(info.t0); st.current.playing = true; setPlaying(true);
      land.set({ ...cur, phase: 'sim', isShot: true, realPick, isReal: false, info: { ...info, who: L.carrier }, outcomes: [], shown: 0, toPkg: c.toPkg, toWho: null,
        shootHere: { xg: way.xg, no: null }, shot: { who: L.carrier, at, xg: way.xg, header: false, no: null, eval: { first: way, touch: null, best: way, no: null } } });
    });
  };
  /** let him choose at his touch: shoot, or the pass worth more (chain.ts decide); a pass is played as the next step */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Intentionally retained for the dormant Details card below.
  const letChoose = () => {
    const L = land.get(), step = stepOf(L), m = mods.current;
    if (L.phase !== 'result' || !step || !data || !m?.xg) return;
    land.set({ ...L, thinking: true });
    setTimeout(() => {
      const c = sceneAt(data.pkg as never, step.tTouch, step.to, isBranch(data) ? null : data.joints), d = decide(m.M, c, m.xg!, L.shot ? (L.shot.no ? 0 : L.shot.eval.best?.value ?? 0) : null);
      const chosen: LandState['decision'] = { shoot: d.shoot, pick: d.pick, pass: d.pass ? { to: c.toPkg[d.pass.to], value: d.pass.value, p: d.pass.p, xg: d.pass.xg } : null };
      if (d.pick === 'pass' && d.pass) passOn(c.toPkg[d.pass.to], chosen);
      else land.set({ ...land.get(), thinking: false, decision: chosen });
    }, 30);
  };
  // his options while he picks: worked out one man at a time (each about a tenth of a second), so the columns of light
  // come on in turn; kept for the click
  useEffect(() => {
    if (ld.phase !== 'pick' || ld.kind !== 'pass' || ld.options !== null || !data) return;
    let live = true;
    const base = stepBase.current ?? real.current ?? handed.current ?? data, L = ld, key = `${L.t0}|${L.carrier}`;
    // (the aerial model too: without it the options were worked out on the turnover model alone, and a man's best way
    // to meet a lofted ball could differ from the one his branch then played, 2026-10-27 night)
    Promise.all([loadModels(), loadXgModel(), CHANCE === 'opta' ? loadPassModel() : null, loadAerial()]).then(([M, xg, PM]) => {
      if (!live) return;
      const c = sceneAt(base.pkg as never, L.t0, L.carrier, isBranch(base) ? null : base.joints), list = candidates(c), found: NonNullable<LandState['options']> = [], dropped: unknown[] = [];
      const rp = isBranch(base) ? null : realPass(base.pkg as never, L.t0, L.carrier);
      // (CHANCE opta: the distilled model's chance by package index, null for a man it has offside)
      const opta = PM ? new Map(passOptions(PM, base.pkg as never, L.t0, L.carrier).map((o) => [o.p, o.offside ? null : o.prob])) : null;
      // (the keeper's claim of a ball into his goal area comes off whichever ruler gives the chance: Opta's pass model
      // does not see him, 2026-10-28)
      const chanceOf = (who: number, p: number, claim = 0): number | null => { const q = CHANCE === 'opta' ? opta?.get(who) ?? null : p; return q === null ? null : q * (1 - claim); };
      const ruled = CHANCE !== 'model';
      // a shooting moment: no pass of his, his shot next (within 4 s)
      const rs = !isBranch(base) && xg ? realShotOf(xg, base.pkg as never, L.t0) : null, atShot = !rp && !!rs && rs.who === L.carrier && rs.t - L.t0 < 4;
      if (atShot && rs) {
        found.push({ who: L.carrier, at: [0, 0], loft: false, p: 1, xg: rs.xg, worth: rs.xg, real: true, no: null, chance: null });
        land.set({ ...land.get(), atShot: true, realShot: { who: rs.who, xg: rs.xg, opta: rs.opta, goal: rs.goal } });
      }
      optCache.current = { key, tried: new Map() };
      // his real receiver: the real pass's numbers (a click shows the real play), and always lit, the yardstick; also when
      // the candidates leave him out (offside at the pause, or an offside pass's man)
      // (his chance by the models, as for the others; none when the pass was offside)
      const realOpt = (r: RealPass, x: XgFreezeModel) => {
        const { at, ev } = realTake(base, M, x, r), i = c.toPkg.indexOf(r.receiver);
        const tr = r.offside || i < 0 ? null : tryPass(M, c, x, i), chance = tr ? chanceOf(r.receiver, tr.p, tr.claim) : null;
        return { who: r.receiver, at, loft: r.loft, p: 1, xg: ev.best?.xg ?? 0, worth: (ev.best?.value ?? 0) * (ruled && chance !== null ? chance : 1), real: true, no: ev.no, chance };
      };
      // worked out one at a time, then (under pressure, only those worth it: options.ts) lit one after another
      const reveal = (kept: typeof found, n: number) => {
        const cur = land.get();
        if (!live || cur.phase !== 'pick' || cur.t0 !== L.t0 || cur.carrier !== L.carrier) return;
        land.set({ ...cur, options: kept.slice(0, n), optionsDone: n >= kept.length });
        if (n < kept.length) setTimeout(() => reveal(kept, n + 1), 110);
      };
      const next = (k: number) => {
        if (!live) return;
        const cur = land.get();
        if (cur.phase !== 'pick' || cur.t0 !== L.t0 || cur.carrier !== L.carrier) return;
        if (k >= list.length) {
          if (rp && xg && !found.some((o) => o.real && o.who === rp.receiver)) found.push(realOpt(rp, xg));
          // (the chance by his name is the one that gates him, options.ts OPTION_MIN_P, whichever ruler gives it; the
          // real receiver is always offered)
          const shown = found.filter((o) => o.real || o.chance === null || o.chance >= OPTION_MIN_P);
          const keep = keepWorth(shown, pressed(c));
          (window as unknown as { __wiOptions?: unknown }).__wiOptions = { candidates: list.map((i) => c.toPkg[i]), found, shown: shown.map((o) => o.who), pressed: pressed(c), kept: keep.map((o) => o.who), dropped };   // for checks
          reveal(shown.filter((o) => o.real || keep.includes(o)), 1); return;
        }
        const who = c.toPkg[list[k]];
        if (rp && who === rp.receiver && xg) found.push(realOpt(rp, xg));
        else {
          const t = optionFor(M, c, xg, list[k]);
          if (t) { const chance = chanceOf(who, t.p, t.claim); optCache.current.tried.set(who, t); found.push({ who, at: fromModel(c, t.Q), loft: t.loft, p: t.p, xg: t.xg, worth: ruled && chance !== null ? (t.value / t.p) * chance : t.value, no: t.no, chance }); }
          // (window.__wiDebug: why a man was left out, for checks; the pass tried again for him)
          else if ((globalThis as { __wiDebug?: boolean }).__wiDebug) { const tt = tryPass(M, c, xg, list[k]); dropped.push({ who, p: +tt.p.toFixed(2), loft: tt.loft, meet: tt.meet, xg: +tt.xg.toFixed(3), value: +tt.value.toFixed(3), no: tt.no, offsideAtStrike: offsideAtStrike(c, tt.pass), chance: chanceOf(who, tt.p) }); }
        }
        setTimeout(() => next(k + 1), 0);
      };
      land.set({ ...land.get(), options: [] });
      setTimeout(() => next(0), 0);
    });
    return () => { live = false; };
  }, [ld.phase, ld.t0, ld.carrier]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the player style follows the phase: still ghosts while he picks and at the stop, ghosts with their trail while it
  // plays and while a play runs back, his own style back on the real play. The ghosts stay now that the bodies are
  // animated (Yi, 2026-10-27: "we want still the ghost style, even we add the animation")
  useEffect(() => {
    if (mode !== 'whatif' || ld.phase === 'off') ghostAs(null);
    else ghostAs(ld.phase === 'sim' || rw ? 'ghost' : 'ghost-still');
  }, [mode, ld.phase, rw]);
  // the stride library (28 MB) is fetched as the mode opens, while the moment plays in, not at the first pick
  useEffect(() => { if (mode === 'whatif') void loadGait(); }, [mode]);
  useEffect(() => {
    guardLeave({ from: 'whatif', hold: (next) => {
      const L = land.get(), to = L.steps[0]?.t0 ?? L.t0, go = () => { leaveRef.current(false, true); setSettings({ mode: next }, true); };
      if (!rewind.current && ((L.phase !== 'sim' && L.phase !== 'result') || clock.t <= to + 0.05)) return false;
      backTo(to, go);
      return true;
    } });
    return () => { guardLeave(null); rewind.current = null; wiRewind.set(false); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // leaving the mode ends a what-if (picking ends when the clock leaves the moment: tick)
  useEffect(() => {
    // (out of the mode the moment is forgotten, so coming back plays it in again)
    if (mode !== 'whatif' && wiNow.get().id) wiNow.set(WI_NONE);
    if (mode !== 'whatif' && ld.phase !== 'off') leave(false, true);
  }, [mode, ld.phase, leave]);

  /** pick a moment: in this clip at once, else load its clip, which plays it in (above); only an open one */
  const goMoment = (m: WiMoment) => {
    if (!OPEN.includes(m)) return;
    if (land.get().phase !== 'off') leave(false, true);
    const base = real.current ?? handed.current ?? data;
    if (base && m.clip === clipOf(moment)) { start(m, base); return; }
    const u = new URLSearchParams(location.search);
    u.set('moment', clipAddr(m.clip)); u.set('wi', m.id); u.delete('t');
    location.search = u.toString();
  };
  // Esc leaves the what-if, back to the real play at the moment (Yi, 2026-10-26: "we can add a press esc to exit")
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || getSettings().mode !== 'whatif') return;
      const L = land.get();
      if (L.phase === 'off') return;
      backTo(L.steps[0]?.t0 ?? L.t0, () => leaveRef.current(false, true));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [leave]);
  // [ and ] step through the open moments in the What-if mode, in place of the shell's clips (most of which have none,
  // and the Shell's gate would drop the mode there): heard first, in the capture phase, so the shell's key is not
  const goRef = useRef(goMoment); goRef.current = goMoment;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key !== '[' && e.key !== ']') || getSettings().mode !== 'whatif' || !OPEN.length) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const id = wiNow.get().id, clip = clipOf(moment), i = OPEN.findIndex((m) => (id ? m.id === id : m.clip === clip));
      const j = i < 0 ? (e.key === ']' ? 0 : OPEN.length - 1) : i + (e.key === ']' ? 1 : -1);
      if (j >= 0 && j < OPEN.length) goRef.current(OPEN[j]);
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [moment]);
  useEffect(() => {
    const W = window as unknown as Record<string, unknown>;
    W.__land = land;   // the what-if's state, for recordings and checks (state.ts)
    // (for checks too: who the What-if tags, the clock, whether a branch is on screen)
    W.__wi = { now: wiNow, go: (id: string) => { const m = momentById(id); if (m) goMoment(m); }, tagged: () => [...wiTagged()], t: () => clock.t, branch: () => isBranch(data) };
  });

  // ---- what it draws
  const shown = real.current ?? data;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Retained with the dormant Details-card controls; preserve their evaluation.
  const atMoment = mode === 'whatif' && !playing && wi.id !== null && Math.abs(t - wi.t) < 0.05 && (ld.phase === 'off' || ld.phase === 'pick' || ld.phase === 'computing');
  const ui = !data || !shown ? null : <>
    {mode === 'whatif' && ld.kind === 'pass' && ld.phase !== 'off' && !rw && <AskCard meta={shown.pkg.meta} nAtt={shown.pkg.frames[0].att.length} looks={looks}
      onShoot={shootHere} onContinue={() => passOn()} onRetry={() => backTo(land.get().t0, () => leave(true))} onStartOver={() => { const L = land.get(); backTo(L.steps[0]?.t0 ?? L.t0, () => leave(false)); }} />}
    {/* (the pass what-if's widget carries its own "Simulation" title at the top centre, AskCard.tsx; the banner stays for the run kind) */}
    {(ld.phase === 'sim' || ld.phase === 'result') && !ld.isReal && ld.kind !== 'pass' && <div className="gm-sim">What if · simulation</div>}
    {ld.kind === 'run' ? <RunCard meta={data.pkg.meta} nAtt={data.pkg.frames[0].att.length} looks={looks}
      onShow={(i) => { if (real.current) showOutcome(real.current, ld.outcomes, i, ld); }}
      onAlt={() => { const A = sim.current?.alt; if (real.current && A) showOutcome(real.current, A.outs, 0, ld, true); }}
      onRetry={() => leave(true)} onBack={() => leave(false)} onReal={() => land.set({ ...ld, showReal: !ld.showReal })} />
    : null}
    {/* (the Details card, LandCard.tsx, and its "Let him choose" are off for the MVP: Yi, 2026-10-26, "we can delete the
        details button for this MVP"; letChoose stays for when they come back) */}
  </>;
  /** the What-if's own marks in the stage's scene (three/whatif/WhatIfScene.tsx), for the shell's pitch overlay */
  // (a stable callback, so the shell can keep its stage from re-rendering with every frame of GameApp's: Shell's ask)
  const scene = useCallback((surface?: { current: number }) => (mode === 'whatif' && data ? <WhatIfScene data={data} clock={clock} surface={surface} looks={looks} /> : null), [mode, data, clock, looks]);
  return { play, tick, ui, scene, realData: shown, busy: ld.phase !== 'off' };
}
