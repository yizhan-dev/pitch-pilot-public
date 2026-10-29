import { MATCH, clipAddr, directorFile, inMatch } from '../data/paths';
import { hook, hooked } from '../dev';
// The Explain mode's director, wired into the game itself: a clip's hand-tuned director
// script (matches/<match>/director/<clip>.json, the one the orchestrator's board plays and records) played in the
// game itself. One narration time n runs it all, as on the board: the clip's clock (held while a beat holds, so the
// viewer's play state never changes), the drawings, the subject, the cameras (cuts, eased moves, the offside close-up),
// the pointers over the player on the ball and the player the voice names, the voice (one mp3 a passage) and the
// subtitles, both placed on n by private/orchestrator/passage_mix.py export (the script's `track`). The game's frame
// loop calls explainTick (GameApp's onTick); the layer in the canvas (ExplainLayer) and the subtitles (ExplainPlayer)
// read the state below.
import { useSyncExternalStore } from 'react';
import type { Loaded } from '../data';
import type { Clock } from '../clock';
import type { Item } from '../three/telestration/Telestration';
import { getSettings, setSettings, showNamed, scriptBoard } from '../game/settings';
import { loadXg } from '../pause/moment';
import { loadResolver, loadPasses } from '../three/telestration/network';
import { orchestrate, toCues } from '../orchestrate/plan';
import { loadProfile } from '../orchestrate/insights/profile';
import { loadRoster } from '../lineup/roster';
import type { Beat, Plan } from '../orchestrate/types';
import { makeTimeline, type NarrationScript, type Timeline } from './script';
import { ballAt } from '../three/Ball';

export interface Track { passages: { id: string; src: string; n0: number; dur: number }[]; subs: [number, number, string][] }
/** `cutIn`: the script's camera takes over with a cut, not a blend (a trailer cut's script, recorded a segment at a
 *  time, wants hard cuts) */
interface DirectorFile { beats: Partial<Beat>[]; callouts?: Plan['callouts']; track?: Track; cutIn?: boolean }
type Pose = number[];

/** one loaded clip's direction: the plan with the script's beats, its timeline, the voice and subtitle track, the
 *  pointers' names. (A script's `start` no longer moves anything: the mode opens where the clip is) */
export interface Directed { clip: string; plan: Plan; tl: Timeline; N: number; end: number; track: Track; cutIn: boolean; names: (p: number) => string | null; ball: (t: number) => number[] | null }

/** the clip the last script was loaded for (for __explainUse) */
let lastData: Loaded | null = null;

export async function loadDirected(data: Loaded): Promise<Directed | null> {
  lastData = data;
  const pkg = data.pkg as unknown as { meta: { id: string }; teams?: { match?: string } };
  const match = pkg.teams?.match ?? MATCH, clip = pkg.meta.id;
  const dir: DirectorFile | null = await fetch(directorFile(clipAddr(clip, match))).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return dir ? direct(data, dir) : null;
}

async function direct(data: Loaded, dir: DirectorFile): Promise<Directed | null> {
  const pkg = data.pkg as unknown as { meta: { id: string; fps: number }; frames: unknown[]; teams?: { match?: string }; players?: { pid: string }[] };
  const match = pkg.teams?.match ?? MATCH, clip = pkg.meta.id;
  if (!dir?.beats || !dir.track) return null;
  const [xg, resolver, profile, passes, roster] = await Promise.all([loadXg(), loadResolver(), loadProfile(match), loadPasses(match), loadRoster()]);
  const plan = orchestrate(data, { xg, resolver }, profile, passes);
  plan.callouts = dir.callouts ?? [];
  plan.beats = dir.beats.map((b, i) => ({ kind: 'insight', actors: [], facts: [], draw: [], why: [], salience: 1, select: null, say: '', t0: b.at ?? 0, t1: b.at ?? 0, ...b, id: b.id ?? `d${i}` } as Beat));
  const tl = makeTimeline({ clip, v: 1, lang: 'en', written: 'director', cues: toCues(plan) } as unknown as NarrationScript);
  const end = (pkg.frames.length - 1) / pkg.meta.fps;
  const lastSub = dir.track.subs.length ? dir.track.subs[dir.track.subs.length - 1][1] : 0;
  const lastVoice = Math.max(0, ...dir.track.passages.map((p) => p.n0 + p.dur));
  const N = Math.max(tl.n(end) + tl.holds.filter((h) => h.t >= end - 1e-6).reduce((a, h) => a + h.d, 0), lastSub, lastVoice + 0.5);
  // the pointers' names: the surname, as a game shows it (the board's rule: a Chinese name's family name comes first)
  const byPid = new Map((roster?.players ?? []).map((r) => [r.pid, r]));
  const short = (pkg.players ?? []).map((x) => { const r = byPid.get(x.pid); if (!r) return null; const w = r.name.split(' '); return r.nat === 'cn' ? w[0] : w[w.length - 1]; });
  return { clip, plan, tl, N, end, track: { ...dir.track, passages: dir.track.passages.map((p) => ({ ...p, src: inMatch(p.src, match) })) }, cutIn: !!dir.cutIn, names: (p) => short[p] ?? null, ball: (t) => ballAt(data.pkg, t) };
}

// for recordings (a trailer cut): play another director script, handed over whole by the recorder, on the
// clip loaded now. It is never a file the game loads; the clip's own script comes back when the clip loads again
if (typeof window !== 'undefined') {
  hook('explainUse', async (dir: DirectorFile): Promise<boolean> => {
    const d = lastData ? await direct(lastData, dir).catch((e) => { console.warn('__explainUse:', e); return null; }) : null;
    if (d) setDirected(d);
    return d !== null;
  });
}

// ---- the state the layer and the subtitles read ----
interface View { active: boolean; items: Item[]; sub: string | null; locked: boolean }
let view: View = { active: false, items: [], sub: null, locked: false };
const subs = new Set<() => void>();
function publish(patch: Partial<View>) {
  const next = { ...view, ...patch };
  if (next.active === view.active && next.items === view.items && next.sub === view.sub && next.locked === view.locked) return;
  view = next; subs.forEach((f) => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useExplain = () => useSyncExternalStore(subscribe, () => view);
/** for the HUD: a director script runs this clip's Explain mode (its replay player's stand-in parts stand aside) */
export const useExplainScripted = () => useSyncExternalStore(subscribe, () => view.active);
/** the pointers: the player on the ball, the player the voice names (-1: none), read every frame by ExplainLayer */
export const pointers = { carrier: { current: -1 }, call: { current: -1 } };

// ---- the controller ----
interface Ctl {
  d: Directed; clock: Clock; play: (p: boolean) => void;
  n: number; lastT: number; lastN: number; key: string; sel: number | null | undefined; cam: string; pose: Pose | null; eye: boolean;
  /** the view the script last set ('' none yet) */
  view: string;
  mv: null | { from: Pose; to: Pose; n0: number; d: number };
  /** `fade`: when the passage's fade-in began (performance.now()), -1 none */
  audio: { a: HTMLAudioElement; n0: number; dur: number; on: boolean; fade: number }[]; sound: boolean;
}
let ctl: Ctl | null = null;
export let directed: Directed | null = null;
/** the mode at the last tick, and whether the viewer has just switched into Explain from another mode */
let lastMode: string | null = null, switched = false;
/** a passage joined partway fades in over this; a voice let go of (leaving the mode, a clip change) fades out over that */
const VOICE_IN_S = 0.5, VOICE_OUT_S = 0.4;

/** load a clip's direction (or none); the controller starts once the mode is Explain */
export function setDirected(d: Directed | null) { directed = d; if (!d) stop(); }

function start(clock: Clock, play: (p: boolean) => void): Ctl {
  const d = directed!, tn = d.tl.n(clock.t), from = switched;
  switched = false;
  // every entry opens right where the clip is, never a jump to the narration: from another mode, the clip list, a clip change, a fresh page. Before the
  // narration the clip plays as in Watch until the script's first camera takes over. At or past the clip's end it
  // starts again from 0, as Watch's play does. From another mode it also plays, so one click starts the commentary
  const n = tn < d.N - 0.5 && clock.t < d.end - 0.1 ? tn : 0;
  const audio = d.track.passages.map((p) => { const a = new Audio(p.src); a.preload = 'auto'; return { a, n0: p.n0, dur: p.dur, on: false, fade: -1 }; });
  clock.t = Math.min(d.end - 0.05, d.tl.at(n).t);
  ctl = { d, clock, play, n, lastT: clock.t, lastN: -1, key: '', sel: undefined, cam: '', pose: null, eye: false, view: '', mv: null, audio, sound: readSound() };
  publish({ active: true });
  if (from) play(true);
  return ctl;
}
function stop() {
  if (!ctl) return;
  for (const x of ctl.audio) { if (x.on && !x.a.paused) fadeOut(x.a); else { x.a.pause(); x.a.src = ''; } }
  ctl = null; pointers.carrier.current = -1; pointers.call.current = -1; showNamed.clear(); scriptBoard.on = false; scriptBoard.base = null;
  publish({ active: false, items: [], sub: null });
}
/** a speaking voice let go of: down to silence over VOICE_OUT_S, then released (a timer, not the frame loop: a clip
 *  change stops the game's ticks) */
function fadeOut(a: HTMLAudioElement) {
  const v0 = a.volume, t0 = performance.now();
  const id = window.setInterval(() => {
    const k = (performance.now() - t0) / 1000 / VOICE_OUT_S;
    if (k < 1) { a.volume = v0 * (1 - k); return; }
    window.clearInterval(id); a.pause(); a.src = '';
  }, 20);
}
/** the camera director's next change of view blends over s seconds (the camera director's `__camBlend`; without it, its own 0.8 s) */
const blendNext = (s: number) => hooked<(s: number) => void>('camBlend')?.(s);
/** how long the script's camera takes to take over from one it did not set: by how far the eye travels, 1.5-3 s (at
 *  80:17, 16 m in 1.4 s read as a sudden shift of the camera, in 3 s it did not) */
function takeoverS(pose: Pose | undefined): number {
  const now = hooked<() => { pos: number[] }>('cam')?.().pos;
  if (!pose || !now) return 1.5;
  const [x, y, z, yaw, pitch, dist] = pose, p = (pitch * Math.PI) / 180, w = (yaw * Math.PI) / 180;
  const eye = [x + dist * Math.cos(p) * Math.sin(w), y + dist * Math.sin(p), z + dist * Math.cos(p) * Math.cos(w)];
  return Math.min(3, 1.5 + Math.hypot(eye[0] - now[0], eye[1] - now[1], eye[2] - now[2]) / 40);
}
/** the free view's orbit now, as a script pose: its centre and distance, its yaw and pitch from where the camera stands */
function orbitNow(): Pose | null {
  const c = hooked<() => { pos: number[]; target: number[]; dist: number }>('cam')?.();
  if (!c) return null;
  const [x, y, z] = c.target, dx = c.pos[0] - x, dy = c.pos[1] - y, dz = c.pos[2] - z, r = Math.hypot(dx, dy, dz) || 1;
  return [x, y, z, (Math.atan2(dx, dz) * 180) / Math.PI, (Math.asin(dy / r) * 180) / Math.PI, c.dist];
}

const SOUND_KEY = 'fwi-explain-sound';
function readSound() { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } }
export function setSound(on: boolean) { try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* this visit only */ } if (ctl) ctl.sound = on; publish({ locked: false }); }
export const soundOn = () => (ctl ? ctl.sound : readSound());
/** the free pose the script last set (eased poses included), null under a named view or out of the mode */
export const scriptPose = (): readonly number[] | null => ctl?.pose ?? null;

/** the player on the ball at clip time t, as a game shows it: whoever touched it last; once a pass has left his foot
 *  (0.15 s), its receiver (the board's rule) */
function carrierAt(actions: Plan['actions'], t: number): number {
  let a: Plan['actions'][number] | undefined;
  for (const x of actions) if (x.t <= t + 1e-6 && (!a || x.t >= a.t)) a = x;
  if (!a) return -1;
  return a.kind === 'pass' && a.to !== undefined && t > a.t + 0.15 ? a.to : a.player;
}

// for the headless checks: put the narration at n (the viewer's play state kept), and read where it stands
if (typeof window !== 'undefined') {
  hook('explainSet', (n: number) => { if (!ctl) return false; ctl.n = Math.max(0, Math.min(ctl.d.N, n)); ctl.lastT = ctl.clock.t = Math.min(ctl.d.end - 0.05, ctl.d.tl.at(ctl.n).t); return true; });
  hook('explainState', () => ({ ready: directed !== null, active: ctl !== null, n: ctl?.n ?? null, N: ctl?.d.N ?? directed?.N ?? null, t: ctl?.clock.t ?? null, sub: view.sub, items: view.items.map((i) => i.id), cam: ctl?.cam ?? null, voice: ctl?.audio.filter((x) => x.on).map((x) => x.a.src.split('/').pop()) ?? [], vol: ctl?.audio.filter((x) => x.on).map((x) => Math.round(x.a.volume * 100) / 100) ?? [], locked: view.locked, carrier: pointers.carrier.current, call: pointers.call.current, sel: getSettings().selected }));
}

/** GameApp's onTick, every frame: true while a director script runs the clip (the game's own clock then stands aside) */
export function explainTick(dt: number, clock: Clock, playing: boolean, play: (p: boolean) => void): boolean {
  const mode = getSettings().mode;
  if (mode !== lastMode) { switched = lastMode !== null && mode === 'explain'; lastMode = mode; }
  const on = mode === 'explain' && directed !== null;
  if (!on) {
    // leaving the mode: a camera the script set eases back to the broadcast view (the camera director's blend, not a
    // cut), the voice fades out, the drawings play their exits (ExplainLayer)
    if (ctl) {
      const mine = ctl.pose !== null || ctl.eye ? 'free' : ctl.view, sel = ctl.sel;
      stop();
      // (the script's subject is not the viewer's pick: his ring and card go with the mode)
      if (sel !== undefined && sel !== null && getSettings().selected === sel) setSettings({ selected: null });
      if (mine !== '' && mine !== 'broadcast' && getSettings().view === mine) { blendNext(1.5); setSettings({ view: 'broadcast' }); }
    }
    return false;
  }
  const c = ctl && ctl.d === directed && ctl.clock === clock ? ctl : (stop(), start(clock, play));
  const { d } = c, tl = d.tl;
  // the viewer moved the clock (the replay plate's seek, play again from the end): n follows it, before the script's
  // start too (the clip before the narration can still be watched; the mode only opens at the start)
  if (Math.abs(clock.t - c.lastT) > 1e-3) c.n = tl.n(clock.t);
  if (playing) {
    c.n = Math.min(d.N, c.n + dt);
    if (c.n >= d.N - 1e-6) play(false);
  }
  // never quite the clip's last instant: the 25 Hz bodies end on the frame before it, and the players vanished there for
  // the wrap's last seconds (15:53)
  const n = c.n, t = Math.min(d.end - 0.05, tl.at(n).t);
  clock.t = t; c.lastT = t;
  apply(c, n);
  voice(c, n, playing);
  c.lastN = n;
  return true;
}

function apply(c: Ctl, n: number) {
  const { d } = c, tl = d.tl, plan = d.plan;
  const t = c.clock.t;
  // pointers
  const carrier = carrierAt(plan.actions, t), call = [...(plan.callouts ?? [])].reverse().find((x) => x.n0 <= n && n < x.n1);
  pointers.carrier.current = carrier;
  pointers.call.current = call && call.player !== carrier ? call.player : -1;
  // the named player wears the Show layer's tag, as the player on the ball does (as in the Watch mode)
  showNamed.clear(); if (call) showNamed.add(call.player);
  const selNow = getSettings().selected; if (selNow !== null) showNamed.add(selNow);   // the script's subject too (EXPLAIN_SHOW)
  // drawings and the subject: every cue showing at n (the board's stateAt)
  const items: Item[] = [], ids = new Set<string>();
  let select: number | null | undefined;
  for (const p of tl.placed) {
    if (p.s > n + 1e-9) continue;
    if (p.cue.select !== undefined) select = p.cue.select;
    if (n < p.e) for (const it of p.cue.draw ?? []) if (!ids.has(it.id)) { ids.add(it.id); items.push(it); }
  }
  const key = items.map((i) => i.id).join(',');
  if (key !== c.key) { c.key = key; publish({ items }); }
  // never the selection's turning ring on a player who already stands in a light (one light per player): a pressure
  // item's carrier (the one on the ball when it has none), a
  // spotlight's player
  if (select !== undefined && select !== null) {
    const carrierNow = carrierAt(plan.actions, t);
    const lit = items.some((it) => (it.kind === 'pressure' && (it.carrier ?? carrierNow) === select) || (it.kind === 'spotlight' && typeof it.at === 'object' && 'player' in it.at && it.at.player === select));
    if (lit) select = null;
  }
  if (select !== c.sel) { c.sel = select; setSettings({ selected: select ?? null }); }
  // the grey board: while a beat that asks for it runs (t0 to t1 on n, its holds inside)
  const boardBeat = plan.beats.find((b) => b.board && tl.n(b.t0) <= n + 1e-9 && n < tl.n(b.t1) - 1e-9);
  scriptBoard.on = !!boardBeat; scriptBoard.base = boardBeat?.base ?? null;
  // the subtitle
  const sub = d.track.subs.find((s) => s[0] <= n && n < s[1])?.[2] ?? null;
  if (sub !== view.sub) publish({ sub });
  // the camera of the latest beat with one that has started: a free pose (a cut, or eased over `move` s), else a view
  const camBeat = [...plan.beats].filter((b) => b.camera && tl.n(b.t0) <= n + 1e-6).sort((a, b) => tl.n(a.t0) - tl.n(b.t0)).pop();
  const cam = camBeat?.camera;
  const W = { camSet: hooked<(...a: number[]) => void>('camSet'), camCut: hooked<() => void>('camCut'), camEye: hooked<(...a: number[]) => void>('camEye') };
  const camKey = cam ? `${camBeat!.id}:${cam.view}:${cam.pose ?? ''}` : '';
  // before the script's first camera (the clip before the narration): the broadcast view, as Watch plays it
  if (!cam && c.cam !== '') {
    c.cam = ''; c.view = ''; c.mv = null; c.eye = false;
    if (c.pose !== null || getSettings().view !== 'broadcast') { c.pose = null; W.camCut?.(); setSettings({ view: 'broadcast' }); }
  }
  if (cam && camKey !== c.cam && (W.camSet || !cam.pose)) {
    // the script's camera taking over from one it did not set (an entry from another mode, the clip played before the
    // narration, a clip change's landing) eases in, by the camera director's blend (switching into
    // Explain moves the camera, never jumps it); between the script's own cameras a change of view cuts (the camera
    // director's __camCut), as its free poses do among themselves
    const takeover = c.cam === '', was = getSettings().view;
    c.cam = camKey;
    const view = cam.pose ? 'free' : cam.view;
    const blendIn = takeover && !d.cutIn;
    if (was !== view) { if (blendIn) blendNext(takeoverS(cam.pose)); else W.camCut?.(); }
    c.view = view;
    c.eye = !!cam.ball;
    // (the director blends only between views: taking over the viewer's own free view, the script eases the orbit)
    const from = takeover ? (blendIn && was === 'free' && cam.pose ? orbitNow() : null) : cam.move ? c.pose : null;
    if (cam.pose && from) c.mv = { from, to: cam.pose, n0: takeover ? n : tl.n(camBeat!.t0), d: takeover ? takeoverS(cam.pose) : cam.move! };
    else if (cam.pose) { c.mv = null; c.pose = cam.pose; W.camSet!(...cam.pose); }
    else if (cam.ball) { c.mv = null; c.pose = null; }
    else { c.mv = null; c.pose = null; if (getSettings().view !== cam.view) setSettings({ view: cam.view }); }
  }
  // the ball's camera, every frame: on the pass's line behind the ball, low, looking along it, till its stop
  if (cam?.ball && W.camEye) {
    const B = cam.ball, b0 = d.ball(B.from), b1 = d.ball(B.to), b = d.ball(t);
    if (b0 && b1 && b) {
      // straight behind the ball itself (the pass's line bends a little), looking along the line; held where it
      // stops: the first moment the camera would pass stopS along the line
      const L = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) || 1, ux = (b1[0] - b0[0]) / L, uy = (b1[1] - b0[1]) / L, side = B.side ?? 0;
      const along = (q: number[]) => (q[0] - b0[0]) * ux + (q[1] - b0[1]) * uy - B.behind;
      let q = b;
      if (B.stopS !== undefined && along(b) > B.stopS) {
        let lo = B.from, hi = t;
        for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2, m = d.ball(mid); if (m && along(m) > B.stopS) hi = mid; else lo = mid; }
        q = d.ball(hi) ?? b;
      }
      const px = q[0] - ux * B.behind - uy * side, py = q[1] - uy * B.behind + ux * side;
      W.camEye(px, B.up, py, px + ux * 10, B.lookY ?? 0.12, py + uy * 10, B.fov ?? 50);
    }
  }
  if (c.mv && W.camSet) {
    const m = c.mv, u = Math.min(1, Math.max(0, (n - m.n0) / m.d)), e = u * u * (3 - 2 * u);
    let dy = m.to[3] - m.from[3]; dy -= 360 * Math.round(dy / 360);
    const p = [0, 1, 2].map((i) => m.from[i] + (m.to[i] - m.from[i]) * e).concat([m.from[3] + dy * e, m.from[4] + (m.to[4] - m.from[4]) * e, m.from[5] * Math.pow(m.to[5] / m.from[5], e)]);
    W.camSet(...p); c.pose = p;
    if (u >= 1) c.mv = null;
  }
  // a scripted camera (a free pose, or a player's view: 22:54's over-the-shoulder view loses the ball each time Lowe looks
  // away) counts as the viewer's touch, so the camera director's return to the broadcast view (ball out of the frame for
  // 1.5 s) never takes the camera from the script
  if (cam && (cam.pose || cam.view !== 'broadcast')) window.dispatchEvent(new Event('pointermove'));
}

/** each passage plays while n is inside it and the clip plays (a hold included); paused with the viewer, resynced after a
 *  jump; silent with the sound off */
function voice(c: Ctl, n: number, playing: boolean) {
  const jump = Math.abs(n - c.lastN) > 0.5;
  for (const x of c.audio) {
    const inside = n >= x.n0 && n < x.n0 + x.dur;
    if (!inside || !playing || !c.sound) { if (x.on) { x.a.pause(); x.on = false; } continue; }
    const want = n - x.n0;
    if (!x.on && view.locked) continue;   // the browser wants a click first (ExplainPlayer's sound button)
    if (!x.on || jump || Math.abs(x.a.currentTime - want) > 0.3) {
      // a passage joined partway (an entry from another mode, a seek, play after a pause) fades in rather than cutting
      // in mid-word, so the join is seamless
      if (!x.on || jump) { x.fade = want > 0.1 ? performance.now() : -1; x.a.volume = x.fade < 0 ? 1 : 0; }
      x.a.currentTime = want;
    }
    if (x.fade >= 0) { const k = (performance.now() - x.fade) / 1000 / VOICE_IN_S; x.a.volume = Math.min(1, k); if (k >= 1) x.fade = -1; }
    if (!x.on) { x.on = true; x.a.play().then(() => { if (view.locked) publish({ locked: false }); }, () => { x.on = false; publish({ locked: true }); }); }
  }
}
