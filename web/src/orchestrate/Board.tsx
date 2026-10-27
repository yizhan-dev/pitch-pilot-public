import { clipAddr, parseClip, directorFile } from '../data/paths';
// The orchestrator's board, http://127.0.0.1:5174/src/orchestrate/board.html?moment=pel-wil/shot-15-53:
// the clip played as the narration would play its plan (the plan compiled to cues, src/explain/script.ts's own
// timeline: holds, speed, subject, drawings), with the debug view over it: the beats on a timeline with what each one
// draws, and the beat under way with its facts, its rules and a top-down sketch (which also shows the arrows the
// telestration has not built yet). Click the timeline to jump; Space plays; [ and ] step through the beats.
// &ui=0 hides the debug view (for the storyboard's frames), &stadium=0 drops the stands, &view=<mode> the camera.
// Hooks for scripts: __plan, __cues, __beatFrame(i) (puts the board on beat i's frame and returns it), __sketch() (the
// sketch now, an SVG string), __frames.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { loadMoment, type Loaded } from '../data';
import { makeClock, type Clock } from '../clock';
import { Pitch, type PitchMode } from '../three/Pitch';
import { SkyDome } from '../three/stadium/Sky';
import { ProceduralStadium } from '../three/stadium/Procedural';
import { Furniture } from '../three/stadium/Furniture';
import { Players, type HideRef } from '../three/players/Styles';
import { StyledBall } from '../three/players/BallStyles';
import { makeLooks, keepersOf, type Look } from '../three/players/looks';
import { CameraDirector } from '../three/camera/Director';
import { FrameCounter } from '../three/FrameCounter';
import { useGameSettings, setSettings } from '../game/settings';
import { Telestration, selectedItems, type Item } from '../three/telestration/Telestration';
import { BallTrace } from '../three/telestration/BallTrace';
import { HoverPointer } from '../three/telestration/HoverPointer';
import { makeTimeline, fillNames, type NarrationScript, type Timeline, type Cue } from '../explain/script';
import { fmtClock } from '../hud/match';
import { loadXg } from '../pause/moment';
import { loadResolver, loadPasses } from '../three/telestration/network';
import { orchestrate, toCues } from './plan';
import { makeGeo, type Geo } from './geom';
import { schematic } from './schematic';
import { PENDING, type DrawItem } from './draw';
import { ENTRY } from './insights/catalogue';
import { rosterLooks, looksFor, ROSTER_FILE, type Roster } from '../lineup/roster';
import { shotCamera } from '../three/telestration/contact';
import { VAR_FACTS, varCamera } from '../three/telestration/var';
import { TELE } from '../three/telestration/style';
import { loadProfile } from './insights/profile';
import type { Beat, Plan } from './types';
import './board.css';

const q = new URLSearchParams(location.search);
const MOMENT = q.get('moment') ?? clipAddr('shot-15-53');
const UI = q.get('ui') !== '0';
/** &capture=1: recording (tools/record.mjs steps __setN per frame; the telestration animates on n, the camera on clip time) */
const CAPTURE = q.get('capture') === '1';
/** ?director=1: play the clip's director script (matches/<match>/director/<clip>.json, hand-written: cameras, drawings,
 *  English lines) instead of the automatic plan; ?subs=1 shows its lines (by default in director mode; &subs=0 leaves
 *  them to the recording, which burns in subtitles timed on its voice) */
/** &pointers=0 turns off the on-ball and call-out pointers (on by default in director mode) */
const DIRECTOR = q.get('director') === '1', POINTERS = q.has('pointers') ? q.get('pointers') === '1' : q.get('director') === '1', SUBS = q.has('subs') ? q.get('subs') === '1' : DIRECTOR;

/** a player as the English lines name him: full name, short name (a Chinese name's family name, which comes first;
 *  anyone else's last word), shirt number */
interface Person { full: string; short: string; number: number }
export function fillEn(text: string, people: Person[]): string {
  return text.replace(/\{(p|s|n|name):(\d+)\}/g, (_, k: string, i: string) => {
    const x = people[+i]; if (!x) return '';
    return k === 'n' ? `No. ${x.number}` : k === 's' ? x.short : x.full;
  });
}

export const KIND_ZH: Record<Beat['kind'], string> = { intro: '开场', 'build-up': '组织', 'line-break': '破线传球', run: '无球跑动', 'final-pass': '最后一传', shot: '射门', 'what-if': '本可以', outcome: '结果', insight: '洞察' };
const KIND_COL: Record<Beat['kind'], string> = { intro: '#7d8696', 'build-up': '#5d6b80', 'line-break': '#8fd0ff', run: '#ffb23f', 'final-pass': '#d8e4ff', shot: '#ffffff', 'what-if': '#c9a7ff', outcome: '#9fb3a6', insight: '#7ce8c4' };
const label = (b: Beat) => (b.entry ? ENTRY[b.entry].zh : KIND_ZH[b.kind]);
const ITEM_ZH: Record<string, string> = { units: '防守三条线', pass: '传球箭头', run: '跑动箭头', zone: '空当区域', hull: '防守块', shot: '射门锥和 xG', marking: '盯人连线', spotlight: '光柱', network: '传球网络', pressure: '逼抢', marker: '选中圈' };

/** the pointers (Yi, 2026-10-24, like a game): one over the player on the ball, always; one over the player the narration
 *  names, while it names him (a director script's `callouts`), so the audience can tell who is meant */
interface Pointers { carrier: { current: number }; call: { current: number } }
function Scene({ data, clock, onTick, items, mode, looks, pointers, calling, names }: { data: Loaded; clock: Clock; onTick: (dt: number) => void; items: Item[]; mode: PitchMode; looks: Look[] | undefined; pointers: Pointers; calling: boolean; names: (p: number) => string | null }) {
  // the second pointer names only its own player (the selected one carries both pointers' cues, one name is enough)
  const callName = useCallback((p: number) => (p === pointers.call.current ? names(p) : null), [names, pointers]);
  const game = useGameSettings();
  const hide = useMemo<HideRef>(() => ({ current: -1 }), []), hideOfficial = useMemo<HideRef>(() => ({ current: -1 }), []), hover = useMemo<HideRef>(() => ({ current: -1 }), []);
  // the shot's freeze, as the telestration session's sandbox draws it: the shooter alone in toon, the rest in silhouette
  const focus = useMemo<HideRef>(() => ({ current: -1 }), []), shotOn = items.some((it) => it.kind === 'shot');
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5), []);
  const officialLooks = useMemo(() => makeLooks(3, 3, { hair: 5, number: 5, skin: 5 }).map((l) => ({ ...l, number: -1, name: '', keeper: false })), []);
  // a director script's tags (`{ kind: 'tag', player, text }`, e.g. a pass option's free metres): a pointer each, its text
  // written where the name goes, in the name's look; the telestration never sees them
  const tags = useMemo(() => items.filter((it) => (it as { kind: string }).kind === 'tag') as unknown as { id: string; player: number; text: string }[], [items]);
  const tagRefs = useMemo(() => tags.map((g) => ({ ref: { current: g.player }, name: (p: number) => (p === g.player ? g.text : null) })), [tags]);
  const all = useMemo(() => [...selectedItems(game), ...items.filter((it) => (it as { kind: string }).kind !== 'tag')], [game, items]);
  return (
    <>
      <color attach="background" args={['#05070b']} />
      <fog attach="fog" args={['#05070b', 160, 420]} />
      <hemisphereLight args={['#c9d6ff', '#0b120d', 0.55]} />
      <directionalLight position={[-20, 90, 30]} intensity={1.8} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={40} shadow-camera-bottom={-40} />
      <directionalLight position={[40, 60, -35]} intensity={0.7} />
      <directionalLight position={[40, 60, 35]} intensity={0.5} />
      <directionalLight position={[-40, 60, -35]} intensity={0.5} />
      <SkyDome />
      <FrameCounter />
      <Pitch glow={0.22} mode={mode} />
      <Furniture />
      {q.get('stadium') !== '0' && <ProceduralStadium clipPlane={clipPlane} shell="crystal" />}
      {data.joints && (shotOn
        ? <><Players J={data.joints} clock={clock} style="toon" looks={looks} only={focus} hover={hover} /><Players J={data.joints} clock={clock} style="silhouette" looks={looks} hide={focus} /></>
        : <Players J={data.joints} clock={clock} style="toon" looks={looks} hide={hide} hover={hover} />)}
      {data.officials?.joints && !shotOn && <Players J={data.officials.joints} clock={clock} style="toon" looks={officialLooks} hide={hideOfficial} kit="official" />}
      <StyledBall pkg={data.pkg} clock={clock} style="modern" />
      <Telestration data={data} clock={clock} items={all} surface={mode} focus={focus} />
      {!shotOn && <BallTrace data={data} clock={clock} surface={mode} />}
      <CameraDirector data={data} clock={clock} onTick={onTick} hide={hide} hideOfficial={hideOfficial} clipPlane={clipPlane} hover={hover} />
      {POINTERS && <HoverPointer data={data} clock={clock} hover={pointers.carrier} names={names} />}
      {POINTERS && calling && <HoverPointer data={data} clock={clock} hover={pointers.call} names={callName} />}
      {tagRefs.map((g, i) => <HoverPointer key={`${tags[i].id}`} data={data} clock={clock} hover={g.ref} names={g.name} />)}
      <VarCam />
    </>
  );
}

/** the offside close-up's camera (the telestration sandbox's VarCam, telestration-notes §12): while an offside item
 *  with `close` shows, the wide view (the free pose the script last set) is held `holdS`, then the orbit's target,
 *  yaw, pitch and distance ease over `flyS` to varCamera's pose on the line, a push in and down that keeps looking at
 *  the pitch; the next camera beat cuts away from it */
function VarCam() {
  const st = useMemo(() => ({ wide: null as number[] | null, lastAge: Infinity, set: null as null | ((...a: number[]) => void) }), []);
  useFrame(() => {
    type CamW = { __camSet?: ((...a: number[]) => void) & { varWrapped?: boolean } };
    const W = window as unknown as CamW, F = VAR_FACTS, V = TELE.offside.var;
    if (!W.__camSet) return;
    if (!W.__camSet.varWrapped) {
      const orig = W.__camSet; st.set = orig;
      W.__camSet = Object.assign((...a: number[]) => { st.wide = a; orig(...a); }, { varWrapped: true });
    }
    // not while the item leaves: the script's next camera has cut away by then
    if (!F.on || F.exit !== null || !st.set || !st.wide) return;
    const restart = F.age < st.lastAge - 0.05;
    st.lastAge = F.age;
    const w = st.wide, c = varCamera(F, w[3], V.turnDeg);
    if (!c) return;
    const u = Math.min(1, Math.max(0, (F.age - V.holdS) / V.flyS)), e = u * u * (3 - 2 * u);
    if (u <= 0) { if (restart) st.set(...w); return; }
    let dy = c[3] - w[3]; dy -= 360 * Math.round(dy / 360);
    st.set(w[0] + (c[0] - w[0]) * e, w[1] + (c[1] - w[1]) * e, w[2] + (c[2] - w[2]) * e, w[3] + dy * e, w[4] + (c[4] - w[4]) * e, w[5] * Math.pow(c[5] / w[5], e));
  });
  return null;
}

/** what the narration's player shows at narration time n: the drawings of every cue showing, the latest subject and
 *  view, the speed (src/explain/Narration.tsx's own rules) */
/** the player on the ball at clip time t, as a game shows it: whoever touched it last; once a pass has left his foot
 *  (0.15 s), its receiver */
function carrierAt(actions: Plan['actions'], t: number): number {
  let a: Plan['actions'][number] | undefined;
  for (const x of actions) if (x.t <= t + 1e-6 && (!a || x.t >= a.t)) a = x;
  if (!a) return -1;
  return a.kind === 'pass' && a.to !== undefined && t > a.t + 0.15 ? a.to : a.player;
}

function stateAt(tl: Timeline, n: number) {
  const items: Item[] = [], ids = new Set<string>();
  let select: number | null | undefined, view: Cue['view'], rate = 1;
  for (const p of tl.placed) {
    if (p.s > n + 1e-9) continue;
    if (p.cue.select !== undefined) select = p.cue.select;
    if (p.cue.view) view = p.cue.view;
    if (p.cue.rate !== undefined) rate = p.cue.rate;
    if (n < p.e) for (const it of p.cue.draw ?? []) if (!ids.has(it.id)) { ids.add(it.id); items.push(it); }
  }
  return { items, select, view, rate };
}

/** the beats showing at narration time n */
function beatsAt(plan: Plan, tl: Timeline, n: number): Beat[] {
  const out = new Set<string>();
  for (const p of tl.placed) if (p.s <= n + 1e-9 && n < p.e) { const id = (p.cue as Cue & { beat?: { id: string } }).beat?.id?.split('/')[0]; if (id) out.add(id); }
  return plan.beats.filter((b) => out.has(b.id));
}

export function Board() {
  const clock = useMemo(makeClock, []);
  const [data, setData] = useState<Loaded | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [playing, setPlaying] = useState(false);
  const pointers = useMemo<Pointers>(() => ({ carrier: { current: -1 }, call: { current: -1 } }), []);
  const [calling, setCalling] = useState(false);
  const [, setTick] = useState(0);
  const mode = useMemo<PitchMode>(() => ({ current: 0, origin: new THREE.Vector2(), reach: 75 }), []);
  const st = useRef({ n: 0, playing: false, key: '', sel: undefined as number | null | undefined, view: undefined as string | undefined, cam: '', last: 0, calling: false, pose: null as number[] | null, mv: null as null | { from: number[]; to: number[]; n0: number; d: number } });

  const [roster, setRoster] = useState<Roster | null>(null);
  useEffect(() => {
    const { match } = parseClip(MOMENT);
    const director = DIRECTOR ? fetch(directorFile(MOMENT)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null);
    const rost = fetch(ROSTER_FILE).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([loadMoment(MOMENT), loadXg(), loadResolver(), loadProfile(match), loadPasses(match), director, rost]).then(([d, xg, resolver, profile, passes, dir, ro]) => {
      const p = orchestrate(d, { xg, resolver }, profile, passes);
      // the director's beats replace the plan's (the story, the phases and the candidates stay the plan's)
      if (dir?.speed) p.speed = dir.speed;
      if (dir?.callouts) p.callouts = dir.callouts;
      if (dir?.beats) p.beats = (dir.beats as Partial<Beat>[]).map((b, i) => ({ kind: 'insight', actors: [], facts: [], draw: [], why: [], salience: 1, select: null, say: '', t0: b.at ?? 0, t1: b.at ?? 0, ...b, id: b.id ?? `d${i}` } as Beat));
      // a script that opens on a free pose starts in the free view, so its first camera is a cut, not a blend from broadcast
      const cam0 = [...p.beats].filter((b) => b.camera).sort((x, y) => x.t0 - y.t0)[0]?.camera;
      if (DIRECTOR && cam0?.view === 'free' && cam0.pose) setSettings({ view: 'free' });
      setRoster(ro); setData(d); setPlan(p);
    });
  }, []);
  const looks = useMemo(() => {
    if (!data?.joints) return undefined;
    const fb = makeLooks(data.joints.players, data.joints.nAtt, { hair: 1, number: 1, skin: 1 }, keepersOf(data.pkg));
    const pids = ((data.pkg as unknown as { players?: { pid: string }[] }).players ?? []).map((x) => x.pid);
    return roster ? looksFor(pids, rosterLooks(roster), fb) : fb;
  }, [data, roster]);
  const people = useMemo<Person[]>(() => {
    if (!data || !looks) return [];
    const byPid = new Map((roster?.players ?? []).map((r) => [r.pid, r]));
    return ((data.pkg as unknown as { players?: { pid: string }[] }).players ?? []).map((x, i) => {
      const r = byPid.get(x.pid), full = r?.name ?? looks[i]?.name ?? `${i}`, w = full.split(' ');
      return { full, short: r?.nat === 'cn' ? w[0] : w[w.length - 1], number: looks[i]?.number ?? 0 };
    });
  }, [data, looks, roster]);
  const geo = useMemo<Geo | null>(() => (data ? makeGeo(data) : null), [data]);
  /** the name over a pointer: the surname, as a game shows it */
  const pointerName = useCallback((p: number) => people[p]?.short ?? null, [people]);
  // a director's speed stretches: a cue that sets the rate at t0 and one that sets it back to 1 at t1, both ended at once
  const cues = useMemo(() => (plan ? [...toCues(plan), ...(plan.speed ?? []).flatMap((x, i) => [
    { t: x.t0, until: x.t0 + 0.01, rate: x.rate, beat: { id: `speed${i}`, kind: 'speed', say: '', facts: [] } },
    { t: x.t1, until: x.t1 + 0.01, rate: 1, beat: { id: `speed${i}/end`, kind: 'speed', say: '', facts: [] } },
  ])].sort((a, b) => a.t - b.t) : []), [plan]);
  const tl = useMemo<Timeline | null>(() => (plan ? makeTimeline({ clip: plan.clip, v: 1, lang: 'zh-CN', written: 'orchestrator', cues } as NarrationScript) : null), [plan, cues]);
  const end = data ? (data.pkg.frames.length - 1) / data.pkg.meta.fps : 0;
  const N = tl ? tl.n(end) + tl.holds.filter((h) => h.t >= end - 1e-6).reduce((a, h) => a + h.d, 0) : 0;
  const clock0 = (data?.pkg as unknown as { clock0?: number } | undefined)?.clock0 ?? 0;

  /** apply narration time n: the clip's clock, the drawings, the subject, the view */
  const apply = useCallback((n: number) => {
    if (!tl) return;
    const s = st.current; s.n = n;
    clock.t = Math.min(end, tl.at(n).t);
    if (plan) {
      const c = carrierAt(plan.actions, clock.t), call = [...(plan.callouts ?? [])].reverse().find((x) => x.n0 <= n && n < x.n1);
      pointers.carrier.current = c;
      pointers.call.current = call && call.player !== c ? call.player : -1;
      if ((pointers.call.current >= 0) !== s.calling) { s.calling = pointers.call.current >= 0; setCalling(s.calling); }
    }
    const now = stateAt(tl, n), key = now.items.map((i) => i.id).join(',');
    if (key !== s.key) { s.key = key; setItems(now.items); }
    // the camera of the latest beat with one that has started (director scripts); a player's view selects its player
    const camBeat = plan ? [...plan.beats].filter((b) => b.camera && tl.n(b.t0) <= n + 1e-6).sort((a, b) => tl.n(a.t0) - tl.n(b.t0)).pop() : undefined;
    const cam = camBeat?.camera, camSel = cam && cam.player !== undefined && (cam.view === 'first' || cam.view === 'third') ? cam.player : undefined;
    const sel = camSel !== undefined ? camSel : now.select;
    if (sel !== s.sel) { s.sel = sel; setSettings({ selected: sel ?? null }); }
    const camKey = cam ? `${camBeat!.id}:${cam.view}:${cam.preset ?? ''}:${cam.pose ?? ''}` : '';
    const W = window as unknown as { __camSet?: (...a: number[]) => void };
    // a pose waits for the camera director's __camSet (the board's first apply can come before its first frame; r1 of
    // pass-24-21 opened on the director's seed instead of the script's pose)
    if (cam && camKey !== s.cam && (W.__camSet || (!cam.pose && cam.preset !== 'shot'))) {
      s.cam = camKey;
      // `move` (s of narration time): ease from the pose the script last set to this one, orbit by orbit (target,
      // yaw the short way, pitch, distance in proportion), for two cameras alike enough that a cut reads as a jump
      // (Yi, 2026-10-25, pass-24-21 at 18 s); otherwise a cut
      if (cam.pose && W.__camSet && cam.move && s.pose) s.mv = { from: s.pose, to: cam.pose, n0: tl.n(camBeat!.t0), d: cam.move };
      else if (cam.pose && W.__camSet) { s.mv = null; s.pose = cam.pose; W.__camSet(...cam.pose); }
      else if (cam.preset === 'shot' && data && cam.player !== undefined) { const c = shotCamera(data, cam.at ?? camBeat!.at, cam.player); if (c && W.__camSet) W.__camSet(...c); }
      else setSettings({ view: cam.view });
      s.view = cam.view;
    } else if (!cam && now.view && now.view !== s.view) { s.view = now.view; setSettings({ view: now.view }); }
    if (s.mv && W.__camSet) {
      const m = s.mv, u = Math.min(1, Math.max(0, (n - m.n0) / m.d)), e = u * u * (3 - 2 * u);
      let dy = m.to[3] - m.from[3]; dy -= 360 * Math.round(dy / 360);
      const p = [0, 1, 2].map((i) => m.from[i] + (m.to[i] - m.from[i]) * e).concat([m.from[3] + dy * e, m.from[4] + (m.to[4] - m.from[4]) * e, m.from[5] * Math.pow(m.to[5] / m.from[5], e)]);
      W.__camSet(...p); s.pose = p;
      if (u >= 1) s.mv = null;
    }
    // a scripted free pose counts as the viewer's touch, so the camera director's return to the broadcast view (ball
    // out of the frame for 1.5 s) never takes the camera away from the script (r7: it did in the long ball's wide shot)
    if (cam?.pose) window.dispatchEvent(new Event('pointermove'));
  }, [tl, clock, end, plan, data, pointers]);
  const play = useCallback((p: boolean) => { st.current.playing = p; setPlaying(p); }, []);
  const onTick = useCallback((dt: number) => {
    const s = st.current;
    if (!tl) return;
    if (s.playing) {
      const a = tl.at(s.n), rate = a.hold ? 1 : stateAt(tl, s.n).rate;
      let n = s.n + dt * rate; if (n >= N) n = 0;
      apply(n);
    }
    const now = performance.now(); if ((UI || SUBS) && now - s.last > 120) { s.last = now; setTick((x) => x + 1); }
  }, [tl, apply, N]);

  /** the frame that shows a beat best: a held beat 1.4 s into its hold (entrances done); a play beat at the clip time in
   *  its span where most of its drawings show, the latest such (the arrows drawn furthest) */
  const beatFrame = useCallback((i: number) => {
    if (!plan || !tl) return null;
    const b = plan.beats[i]; if (!b) return null;
    let n: number;
    if (b.t0 === b.t1) {
      const same = plan.beats.filter((x) => x.t0 === x.t1 && x.at === b.at && x.hold), before = same.slice(0, same.indexOf(b)).reduce((a, x) => a + (x.hold ?? 0), 0);
      n = tl.n(b.at) + before + Math.min(1.4, (b.hold ?? 2) / 2);
    } else if (b.hold) n = tl.n(b.at) + Math.min(1.4, b.hold / 2);
    else {
      let best = b.at, bn = -1;
      for (let t = b.t0 + 0.4; t <= b.t1 - 0.2; t += 0.1) {
        const c = b.draw.filter((it) => (it.window?.from ?? b.t0) <= t && t <= (it.window?.to ?? b.t1)).length;
        if (c >= bn) { bn = c; best = t; }
        if (t > b.at + 1.6 && bn > 0) break;
      }
      n = tl.n(best);
    }
    play(false); apply(n);
    return { i, id: b.id, n: +n.toFixed(2), t: +clock.t.toFixed(2) };
  }, [plan, tl, apply, play, clock]);

  const sketch = useCallback(() => {
    if (!geo || !tl) return '';
    const now = stateAt(tl, st.current.n);
    return schematic(geo, now.items as DrawItem[], clock.t, (p) => String(looks?.[p]?.number ?? p), now.select ?? null);
  }, [geo, tl, clock, looks]);

  useEffect(() => {
    if (!plan || !tl) return;
    const W = window as unknown as Record<string, unknown>;
    W.__plan = plan; W.__cues = cues; W.__beatFrame = beatFrame; W.__sketch = sketch; W.__looks = looks?.map((l) => `${l.number} 号 ${l.name}`); W.__people = people;
    W.__setN = (n: number) => { play(false); if (CAPTURE) W.__teleNow = n; apply(n); if (CAPTURE) setTick((x) => x + 1); };
    /** for the recorder: the narration's length, and how fast n runs at n (1 in a hold, the beat's rate otherwise) */
    W.__narrN = N; W.__nOf = (t: number) => tl.n(t); W.__clipT = () => clock.t; W.__rateAt = (n: number) => (tl.at(n).hold ? 1 : stateAt(tl, n).rate);
    if (CAPTURE) W.__capture = true;
    /** a candidate insight (chosen or not) on its own: the clock at its moment (a run 1.2 s in, so the arrow has drawn),
     *  its drawings without their windows, its protagonist selected; returns the sketch too */
    W.__candFrame = (id: string) => {
      const x = plan.candidates.find((c) => c.id === id); if (!x || !geo) return null;
      play(false);
      const runLike = ['blind-side-run', 'overlap', 'half-space-run', 'third-man', 'striker-wide', 'rotation', 'hook-run'].includes(x.entry);
      const t = Math.min(end, runLike ? Math.min(x.t1 - 0.3, x.t + 1.2) : x.t);
      clock.t = t;
      const items = x.draw.map((it) => { const { window: _w, ...rest } = it as Item & { window?: unknown }; void _w; return rest as Item; });
      st.current.key = `cand:${id}`; setItems(items);
      const sel = x.players[0] ?? null; st.current.sel = sel; setSettings({ selected: sel });
      return { id, t: +t.toFixed(2), svg: schematic(geo, items, t, (p) => String(looks?.[p]?.number ?? p), sel) };
    };
    apply(plan.beats[0] ? tl.n(plan.beats[0].t0) : 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ') { play(!st.current.playing); e.preventDefault(); }
      if (e.key === ']' || e.key === '[') {
        const cur = plan.beats.findIndex((b) => tl.n(b.t0) > st.current.n + 0.05);
        const i = e.key === ']' ? (cur < 0 ? 0 : cur) : Math.max(0, (cur < 0 ? plan.beats.length : cur) - 2);
        beatFrame(i);
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [plan, tl, cues, beatFrame, sketch, apply, play, looks, people, N, clock]);

  if (!data || !plan || !tl) return <div className="ob-loading">编排中…</div>;
  const n = st.current.n, cur = beatsAt(plan, tl, n), name = (s: string) => (looks ? fillNames(s, looks) : s);
  return (
    <div className="ob">
      <div className="ob-stage">
        <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 30, position: [0, 30, 60], near: 0.5, far: 2000 }} gl={{ antialias: true, localClippingEnabled: true }}>
          <Scene data={data} clock={clock} onTick={onTick} items={items} mode={mode} looks={looks} pointers={pointers} calling={calling} names={pointerName} />
        </Canvas>
      </div>
      {UI && <>
        <aside className="ob-card">
          <div className="ob-head"><b>{plan.clip}</b><span>{fmtClock(clock0 + clock.t)}</span><button onClick={() => play(!playing)}>{playing ? '暂停' : '播放'}</button></div>
          <div className="ob-story">{name(plan.story.summary)}</div>
          <div className="ob-sketch" dangerouslySetInnerHTML={{ __html: sketch() }} />
          {cur.length === 0 && <div className="ob-none">这一刻没有节拍</div>}
          {cur.map((b) => <BeatCard key={b.id} b={b} clock0={clock0} name={name} />)}
          {plan.dropped.length > 0 && <div className="ob-dropped">没选的：{plan.dropped.map((d) => `${d.id.split('@')[0]} ${d.id.split('@')[1]}（${name(d.why)}）`).join('；')}</div>}
        </aside>
        <TimelineBar plan={plan} tl={tl} N={N} n={n} clock0={clock0} onSeek={(x) => { play(false); apply(x); }} />
      </>}
      {SUBS && <Subtitle plan={plan} tl={tl} n={n} people={people} />}
    </div>
  );
}

/** the director script's English line at narration time n: each line from its moment (a held line at its hold's start)
 *  to the next line, at most 4.5 s; a stand-in for the narration's own subtitles, so a frame shows what is said there */
function Subtitle({ plan, tl, n, people }: { plan: Plan; tl: Timeline; n: number; people: Person[] }) {
  const all = plan.beats.flatMap((b) => (b.lines ?? []).map((l) => ({ s: tl.n(l.t), l }))).sort((a, b) => a.s - b.s);
  let cur: (typeof all)[number] | null = null;
  for (let i = 0; i < all.length; i++) { const e = Math.min(all[i + 1]?.s ?? Infinity, all[i].s + 4.5); if (all[i].s <= n + 1e-6 && n < e) cur = all[i]; }
  if (!cur) return null;
  return <div className="ob-sub"><span>{fillEn(cur.l.subtitle, people)}</span></div>;
}

function BeatCard({ b, clock0, name }: { b: Beat; clock0: number; name: (s: string) => string }) {
  return (
    <div className="ob-beat" style={{ borderColor: KIND_COL[b.kind] }}>
      <div className="ob-beat-h"><b style={{ color: KIND_COL[b.kind] }}>{label(b)}</b><span>{fmtClock(clock0 + b.at)}</span>
        {b.hold ? <i>定格 {b.hold} 秒</i> : null}{b.rate ? <i>{b.rate}×</i> : null}<em>显著度 {b.salience.toFixed(2)}{b.confidence !== undefined ? ` · 置信 ${b.confidence.toFixed(2)}` : ''}</em></div>
      <div className="ob-say">“{name(b.say)}”</div>
      {b.tone?.praise && b.tone.praise !== b.say ? <div className="ob-tone">夸：{name(b.tone.praise)}</div> : null}
      {b.tone?.improve ? <div className="ob-tone">改进：{name(b.tone.improve)}</div> : null}
      <div className="ob-draw">{b.draw.length ? b.draw.map((it) => <span key={it.id} className={PENDING.has(it.kind) ? 'pend' : ''}>{ITEM_ZH[it.kind] ?? it.kind}{PENDING.has(it.kind) ? '（待实现）' : ''}</span>) : <span className="none">不画</span>}</div>
      <table className="ob-facts"><tbody>{b.facts.filter((f) => f.key !== 'recv_t').map((f) => <tr key={f.key}><td>{f.key}</td><td>{String(f.value)}{f.unit ?? ''}</td><td>{f.src}</td></tr>)}</tbody></table>
      <ul className="ob-why">{b.why.map((w, i) => <li key={i}>{name(w)}</li>)}</ul>
    </div>
  );
}

function TimelineBar({ plan, tl, N, n, clock0, onSeek }: { plan: Plan; tl: Timeline; N: number; n: number; clock0: number; onSeek: (n: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const Wd = Math.max(600, window.innerWidth - 420), X = (x: number) => 12 + ((Wd - 24) * x) / Math.max(N, 1e-3);
  const itemRows = new Map<string, { kind: string; s: number; e: number }>();
  for (const p of tl.placed) for (const it of p.cue.draw ?? []) {
    const w = it.window, s = Math.max(p.s, w?.from !== undefined ? tl.n(w.from) : p.s), e = Math.min(p.e, w?.to !== undefined ? tl.n(w.to) + (tl.holds.filter((h) => Math.abs(h.t - w.to!) < 1e-6).reduce((a, h) => a + h.d, 0)) : p.e);
    const r = itemRows.get(it.id); if (r) { r.s = Math.min(r.s, s); r.e = Math.max(r.e, e); } else itemRows.set(it.id, { kind: it.kind, s, e });
  }
  const rows = [...itemRows.entries()], H = 92 + rows.length * 9;
  const seek = (ev: React.MouseEvent) => { const r = ref.current!.getBoundingClientRect(); onSeek(Math.max(0, Math.min(N, ((ev.clientX - r.left - 12) / (Wd - 24)) * N))); };
  return (
    <svg ref={ref} className="ob-tl" width={Wd} height={H} onClick={seek}>
      {plan.phases.map((p, i) => <g key={i}><rect x={X(tl.n(p.t0))} y={6} width={Math.max(1, X(tl.n(p.t1)) - X(tl.n(p.t0)))} height={14} fill={['#24324a', '#2e4c6e', '#3b5f45', '#6e5a2e', '#2a2a2a'][['build-up', 'progression', 'final-third', 'finish', 'after'].indexOf(p.kind)]} /><text x={X(tl.n(p.t0)) + 3} y={17} className="ob-tl-t">{({ 'build-up': '组织', progression: '推进', 'final-third': '最后三区', finish: '射门', after: '之后' } as Record<string, string>)[p.kind]}</text></g>)}
      {tl.holds.map((h, i) => <rect key={i} x={X(tl.n(h.t))} y={24} width={X(tl.n(h.t) + h.d) - X(tl.n(h.t))} height={H - 28} fill="url(#ob-hatch)" />)}
      <defs><pattern id="ob-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="3" height="6" fill="#ffffff" fillOpacity="0.07" /></pattern></defs>
      {plan.beats.map((b) => {
        const placed = tl.placed.filter((p) => (p.cue as Cue & { beat?: { id: string } }).beat?.id === b.id);
        const s = Math.min(...placed.map((p) => p.s)), e = Math.max(...placed.map((p) => p.e));
        return <g key={b.id} onClick={(ev) => { ev.stopPropagation(); onSeek(s + 0.01); }}><rect x={X(s)} y={26} width={Math.max(2, X(e) - X(s))} height={18} rx={2} fill={KIND_COL[b.kind]} fillOpacity={0.85} /><text x={X(s) + 3} y={39} className="ob-tl-b">{label(b)}</text><text x={X(s) + 1} y={56} className="ob-tl-t">{fmtClock(clock0 + b.at)}</text></g>;
      })}
      {rows.map(([id, r], i) => <g key={id}><rect x={X(r.s)} y={64 + i * 9} width={Math.max(2, X(r.e) - X(r.s))} height={6} fill={PENDING.has(r.kind) ? 'none' : '#cfd8e3'} stroke="#cfd8e3" strokeDasharray={PENDING.has(r.kind) ? '3 2' : undefined} fillOpacity={0.6} /><text x={X(r.e) + 4} y={70 + i * 9} className="ob-tl-t">{ITEM_ZH[r.kind] ?? r.kind}</text></g>)}
      {plan.actions.map((a, i) => <line key={i} x1={X(tl.n(a.t))} x2={X(tl.n(a.t))} y1={H - 6} y2={H} stroke={a.kind === 'pass' ? '#8fd0ff' : a.kind === 'shot' ? '#fff' : '#5d6b80'} />)}
      <line x1={X(n)} x2={X(n)} y1={0} y2={H} stroke="#ffb23f" strokeWidth={2} />
    </svg>
  );
}
