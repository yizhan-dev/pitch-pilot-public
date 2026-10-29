import { clipAddr } from '../../../data/paths';
import { hook, hooked } from '../../../dev';
// The telestration sandbox, http://127.0.0.1:5174/tele.html: the game's pitch, players and cameras with only the
// element under review drawn, so one element at a time can be judged on grass and on the board in every view.
// Address: ?moment=pel-wil/pass-89-22 &t=<s> (held; default the clip's key moment) &play=1 &tac=1 (board)
// &view=<broadcast|free|tactical|referee|ar1|ar2|first|third> &sel=<player> &ui=0 (no panel) &stadium=0 &capture=1
// Hooks for the headless scripts: __setT, __play, __frames (FrameCounter), __tele (the live style), __replay.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { loadMoment, type Loaded } from '../../../data';
import { makeClock, type Clock } from '../../../clock';
import { Pitch, type PitchMode } from '../../Pitch';
import { ballAt } from '../../Ball';
import { SkyDome } from '../../stadium/Sky';
import { ProceduralStadium } from '../../stadium/Procedural';
import { Furniture } from '../../stadium/Furniture';
import { Players, GhostPlayers, type HideRef } from '../../players/Styles';
import { attackingOf } from '../../coords';
import { StyledBall } from '../../players/BallStyles';
import { makeLooks, keepersOf } from '../../players/looks';
import { CameraDirector } from '../../camera/Director';
import { FrameCounter } from '../../FrameCounter';
import { useGameSettings, setSettings, getSettings, VIEWS } from '../../../game/settings';
import { Telestration, selectedItems, type Item, type LaneName, type XY, type StrokeItem } from '../Telestration';
import { TELE, type TeamMode, type PointerShape, type BallMode, type ReadoutMode, type SparkStyle, type ZoneAnim, type MarkStyle, type MarkAnim, type UnitLook, type MarkGrad } from '../style';
import { BallReadout } from '../BallReadout';
import { BallTrace } from '../BallTrace';
import { HoverPointer } from '../HoverPointer';
import { contactTime, shotCamera } from '../contact';
import { useRoster, clipLooks } from '../../../lineup/roster';
import { VAR_FACTS, varCamera } from '../var';
import { StackTags, type StackLayout } from './StackTags';
import { passStateAt } from '../../../hud/passProb';
import type { ClipPkg } from '../../../hud/match';

const q = new URLSearchParams(location.search);
const MOMENT = q.get('moment') ?? clipAddr('pass-89-22');
// &team=kit|lift|layers: the inner ring's team colour; &also=20,5: rings on more players (to compare both sides)
const TEAM_MODES: { key: TeamMode; label: string }[] = [{ key: 'kit', label: '①球衣原色' }, { key: 'lift', label: '②提亮' }, { key: 'layers', label: '③图层队色' }, { key: 'mix', label: '②③之间' }];
{ const t = q.get('team'); if (t && TEAM_MODES.some((m) => m.key === t)) TELE.team.mode = t as TeamMode; }
{ const w = q.get('teamw'); if (w !== null && Number.isFinite(+w)) { TELE.team.mode = 'mix'; TELE.team.mixW = Math.min(1, Math.max(0, +w)); } }
// &ptr=tri|barb|chev: the hover cue's shape; &hover=<player>: hold the cue over him (headless shots have no mouse)
const SHAPES: { key: PointerShape; label: string }[] = [{ key: 'tri', label: 'A 三角' }, { key: 'barb', label: 'B 箭头尖' }, { key: 'chev', label: 'C 人字' }];
{ const s = q.get('ptr'); if (s && SHAPES.some((x) => x.key === s)) TELE.pointer.shape = s as PointerShape; }
// &bt=shadow|drop|plain: the ball trace's variant
const BALLS: { key: BallMode; label: string }[] = [{ key: 'shadow', label: 'A 轨迹+影子' }, { key: 'drop', label: 'B 再加垂线' }, { key: 'plain', label: 'C 只有轨迹' }];
{ const b = q.get('bt'); if (b && BALLS.some((x) => x.key === b)) TELE.ball.mode = b as BallMode; }
// &ro=off|speed|both: the ball's read-out
const READOUTS: { key: ReadoutMode; label: string }[] = [{ key: 'off', label: '关' }, { key: 'speed', label: '球速' }];
{ const r = q.get('ro'); if (r && READOUTS.some((x) => x.key === r)) TELE.readout.mode = r as ReadoutMode; }
// &spk=strong: the louder sparks preset, to compare with the default
// &spk=burst|weld|dust|flow|ripple: the lines' entrance effect; &spk=soft is the first, quieter burst (A)
{ const k = q.get('spk'); if (k === 'soft') Object.assign(TELE.spark, { dt: 0.02, sizePx: 3.2, spread: 1.4, upMax: 1.8, tipPx: 9, tipAlpha: 0.75, burst: 22, burstSpeed: 2.6, life: 0.38 });
  else if (k && ['burst', 'weld', 'dust', 'flow', 'ripple'].includes(k)) TELE.spark.style = k as SparkStyle; }
// &za=corners|scan|unfold|trace|glint: the zone's entrance
{ const z = q.get('za'); if (z && ['corners', 'scan', 'unfold', 'trace', 'glint'].includes(z)) TELE.zone.anim = z as ZoneAnim; }
// &ms=rings|tether|capsule|dumbbell|guard|pool|line|hoops: the marking links' style
{ const v = q.get('ms'); if (v && ['rings', 'tether', 'capsule', 'dumbbell', 'guard', 'pool', 'line', 'hoops'].includes(v)) TELE.mark.style = v as MarkStyle; }
// &ma=stretch|snap|merge|lasso|embrace|sonar|fade: the capsule's entrance; &mp=1 its idle pulse
{ const v = q.get('ma'); if (v && ['stretch', 'snap', 'merge', 'lasso', 'embrace', 'sonar', 'fade'].includes(v)) TELE.mark.anim = v as MarkAnim; }
// &mg=none|lab|hue: the capsule's colour, one or a gradient between the two teams
// &stack=v1|v2|v3|v4 &anchor=m|px &tags=7,20: the head's stack under design (StackTags.tsx: the Show layer's tag and the cue)
const STACK = (['v1', 'v2', 'v3', 'v4'] as const).find((v) => v === q.get('stack')) as StackLayout | undefined;
const STACK_TAGS = (q.get('tags') ?? '').split(',').filter(Boolean).map(Number);
// &drag=8:40,-14: the pen's drag of a player (§22): the running direction's chevrons from his real spot
// to the drop point, nothing else (kept simple: no ghost, only the arrow's ticks); &dragghost=1 his
// ghost (GhostPlayers) at it, &dragring=1 a plain ring in his colour there (both tried, not kept)
// &dragend=fade|hold: the drag's chevrons at the drop point (TELE.heading.toEnd)
{ const v = q.get('dragend'); if (v === 'fade' || v === 'hold') TELE.heading.toEnd = v; }
const DRAG = ((m) => (m ? { player: +m[1], at: [+m[2], +m[3]] as [number, number] } : null))((q.get('drag') ?? '').match(/^(\d+):(-?[\d.]+),(-?[\d.]+)$/));
// &dragseq=to|from: the drag as a sequence of his frozen pose from where he is to the drop point, about
// every DRAG_STEP m, at most DRAG_MAX, fading away from the drop point ('to') or from him ('from'); no chevrons
const DRAG_SEQ = q.get('dragseq'), DRAG_STEP = 2, DRAG_MAX = 6;
function dragGhosts(d: Loaded, t: number, g: { player: number; at: [number, number] }) {
  if (!DRAG_SEQ) return [g];
  const F = d.pkg.frames, f = F[Math.max(0, Math.min(F.length - 1, Math.round(t * d.pkg.meta.fps)))], na = f.att.length;
  const me = g.player < na ? f.att[g.player] : f.def[g.player - na];
  if (!me) return [g];
  const L = Math.hypot(g.at[0] - me[0], g.at[1] - me[1]), n = Math.max(1, Math.min(DRAG_MAX, Math.round(L / DRAG_STEP)));
  return Array.from({ length: n }, (_, i) => {
    const k = (i + 1) / n, fade = DRAG_SEQ === 'from' ? i / n : 1 - k;
    return { player: g.player, at: [me[0] + (g.at[0] - me[0]) * k, me[1] + (g.at[1] - me[1]) * k] as [number, number], alpha: 0.5 * Math.pow(0.62, fade * n) };
  });
}
// &lh=face|plane|flat|cross: the lofted pass's head (LoftArrows.tsx)
{ const v = q.get('lh'); if (v === 'face' || v === 'plane' || v === 'flat' || v === 'cross') TELE.passArrow.loftHead = v; }
// &pa=barbed|chevrons|line|landing: the pass arrow's look
{ const v = q.get('pa'); if (v === 'barbed' || v === 'chevrons' || v === 'line' || v === 'landing') TELE.passArrow.look = v; }
// &va=open|eyes: the vision's entrance; &vb=1: its fan of light from his eyes
{ const v = q.get('va'); if (v === 'open' || v === 'eyes') TELE.vision.anim = v; }
if (q.get('vb') === '1') TELE.vision.beam = true;
// &bl=<look>: the ball trace's look (the proposals in BallTrace.tsx)
// &gfm=<0..1>: the grass ribbon's far-away widening (TELE.ball.groundFlatMin; 0 off)
{ const v = Number(q.get('gfm')); if (q.get('gfm') && Number.isFinite(v)) TELE.ball.groundFlatMin = v; }
{ const v = q.get('bl'); if (v) TELE.ball.look = v; }
{ const v = Number(q.get('vturn')); if (q.get('vturn') && Number.isFinite(v)) TELE.offside.var.turnDeg = v; }
{ const v = q.get('mg'); if (v && ['none', 'lab', 'hue'].includes(v)) TELE.mark.grad = v as MarkGrad; }
if (q.get('mp') === '1') TELE.mark.pulse = true;
// &pl=wedge|arc: the pressers' look
{ const v = q.get('pl'); if (v === 'wedge' || v === 'arc') TELE.press.look = v; }
// &pin=1.2: a pocket's inset off the unit lines, metres
{ const v = Number(q.get('pin')); if (q.get('pin') && Number.isFinite(v)) TELE.zone.pocketInset = v; }
const HOVER = q.get('hover') !== null && Number.isInteger(+(q.get('hover') ?? '')) ? +(q.get('hover') ?? -1) : -1;
// &units=def|att|both: a side's units (back line, midfield, front line); &ul=full|plain|minimal: their look
{ const v = q.get('ul'); if (v && ['full', 'plain', 'minimal'].includes(v)) TELE.unit.look = v as UnitLook; }
// &nsp=1: the passing network with its welding sparks; &hl=full|plain|calm: the hull's entrance
{ const v = q.get('hl'); if (v && ['full', 'plain', 'calm'].includes(v)) TELE.hull.look = v as 'full' | 'plain' | 'calm'; }
if (q.get('nsp') === '1') TELE.net.sparks = true;
const UNITS = (q.get('units') ?? '').split(',').filter((x) => x === 'def' || x === 'att' || x === 'both').flatMap((x) => (x === 'both' ? ['def', 'att'] : [x])) as ('def' | 'att')[];
const ALSO = (q.get('also') ?? '').split(',').filter((x) => x !== '' && Number.isInteger(+x)).map(Number);
type Pkg = Loaded['pkg'] & { meta: { pass?: { t: number; passer: number; receiver: number }; shot?: { t: number; shooter: number } } };

/** the pitch's change to the board and back, mirroring Stage's TacticalFlip (its PitchMode is current,
 *  origin, reach): 2.4 s, sine in and out, a wave from the ball to the farthest corner */
/** a pass clip's pass as the orchestrator would draw it (src/orchestrate/draw.ts): the kick at the strike, the
 *  reception at the receiver's next touch, the pass arrow between the ball's two points, the receiver's run between */
function passArrows(d: Loaded): Item[] {
  const pass = (d.pkg as Pkg).meta.pass, evs = (d.pkg as { events?: { t: number; player?: number }[] }).events ?? [];
  if (!pass) return [];
  const kick = contactTime(d, pass.t), recT = evs.find((e) => e.player === pass.receiver && e.t > kick + 0.2 && e.t < kick + 6)?.t;
  if (recT === undefined) return [];
  const recv = contactTime(d, recT, 0.3, 0.3), a = ballAt(d.pkg, kick), b = ballAt(d.pkg, recv);
  if (!a || !b) return [];
  return [
    { id: 'pass', kind: 'pass', from: [a[0], a[1]], to: [b[0], b[1]], t: [kick, recv] },
    { id: 'run', kind: 'run', path: { player: pass.receiver, from: kick, to: recv } },
  ];
}

// &loft=1 (its height from its length) | track (the ball's own peak) | <metres>: the pen's pass lofted
const LOFT: number | 'track' | boolean = q.get('loft') === null ? false : q.get('loft') === 'track' ? 'track' : q.get('loft') === '1' ? true : Number(q.get('loft')) || false;
function penPassRun(d: Loaded): Item[] {
  const pass = (d.pkg as Pkg).meta.pass, evs = (d.pkg as { events?: { t: number; player?: number }[] }).events ?? [];
  if (!pass) return [];
  const kick = contactTime(d, pass.t), recT = evs.find((e) => e.player === pass.receiver && e.t > kick + 0.2 && e.t < kick + 6)?.t;
  if (recT === undefined) return [];
  const recv = contactTime(d, recT, 0.3, 0.3), a = ballAt(d.pkg, kick), b = ballAt(d.pkg, recv);
  if (!a || !b) return [];
  return [
    { id: 'pen-pass', kind: 'pass', from: [a[0], a[1]], to: [b[0], b[1]], t: [kick, recv], loft: LOFT },
    { id: 'pen-run', kind: 'heading', player: pass.receiver, to: [b[0], b[1]] },
  ];
}

function SurfaceFlip({ data, clock, mode }: { data: Loaded; clock: Clock; mode: PitchMode }) {
  const st = useRef({ p: 0, target: -1 });
  useFrame((_, raw) => {
    const target = getSettings().tactical ? 1 : 0, s = st.current;
    if (s.target < 0) { s.target = target; s.p = target; }
    if (target !== s.target) {
      s.target = target;
      const b = ballAt(data.pkg, clock.t); if (b) mode.origin.set(b[0], -b[1]);
      mode.reach = Math.max(...[[60, 42], [60, -42], [-60, 42], [-60, -42]].map(([x, y]) => Math.hypot(x - mode.origin.x, y - mode.origin.y)));
    }
    const dt = Math.min(raw, 0.1);
    s.p = target > s.p ? Math.min(1, s.p + dt / 2.4) : target < s.p ? Math.max(0, s.p - dt / 2.4) : s.p;
    mode.current = 0.5 - 0.5 * Math.cos(Math.PI * s.p);
  });
  return null;
}

/** for headless shots: keep the hover cue on &hover=<player> (the camera director clears it when the mouse moves) */
/** &var=1: the offside close-up's camera, on the sequence's own clock (VAR_FACTS.age): the wide view as the page set
 *  it, held; then a flight to varCamera()'s view along the line (orbit target, yaw, pitch, distance eased together, the
 *  yaw the short way round); back to the wide view when the sequence starts again (E, or a recording's __replay) */
/** &pen=1: the Tactics pen's seven tools, one stroke each in the four inks, drawn one after another as by hand over
 *  `PEN_S` s of the animation clock (__teleNow when recording), in a second <Telestration> as the Tactics mode mounts
 *  it; the pointer's points change every frame */
const PEN_S = 4.2;
const bez = (a: XY, b: XY, c: XY, n: number): XY[] => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]; });
function penStrokes(data: Loaded, t: number): StrokeItem[] {
  // the attacker nearest the zone the camera looks at, to circle
  const F = data.pkg.frames, f = F[Math.max(0, Math.min(F.length - 1, Math.round(t * data.pkg.meta.fps)))];
  let best = 0, bd = Infinity;
  f.att.forEach((a, i) => { const d = Math.hypot(a[0] - 31, a[1] + 12); if (d < bd) { bd = d; best = i; } });
  // a freehand loop with a little wobble, points every 0.5 m like the pen's
  const loop: XY[] = Array.from({ length: 34 }, (_, i) => { const a = (i / 33) * Math.PI * 1.75 - 0.6, r = 3.2 + 0.25 * Math.sin(i * 1.7); return [42 + r * Math.cos(a), -22 + 0.8 * r * Math.sin(a)]; });
  return [
    { id: 'pen-pass', kind: 'stroke', tool: 'pass', ink: 'white', pts: [[24, -8], [33, -20]] },
    { id: 'pen-run', kind: 'stroke', tool: 'run', ink: 'yellow', pts: bez([26, -26], [37, -27], [39, -16], 22) },
    { id: 'pen-dribble', kind: 'stroke', tool: 'dribble', ink: 'orange', pts: [[20, -18], [28, -12]] },
    { id: 'pen-circle', kind: 'stroke', tool: 'circle', ink: 'blue', pts: [[f.att[best][0], f.att[best][1]]], player: best },
    { id: 'pen-zone', kind: 'stroke', tool: 'zone', ink: 'yellow', pts: [[38, -12], [46, -4]] },
    { id: 'pen-pen', kind: 'stroke', tool: 'pen', ink: 'white', pts: loop },
    { id: 'pen-measure', kind: 'stroke', tool: 'measure', ink: 'white', pts: [[24, -30], [36, -32]] },
  ];
}
function PenDemo({ data, clock, mode }: { data: Loaded; clock: Clock; mode: PitchMode }) {
  const [f, setF] = useState(0), all = useMemo(() => penStrokes(data, clock.t), [data, clock]);
  useFrame((state) => {
    const now = hooked<number>('teleNow') ?? state.clock.elapsedTime;
    const nf = Math.min(1, Math.max(0, now / PEN_S));
    if (Math.abs(nf - f) > 0.004 || (nf === 1 && f !== 1)) setF(nf);
  });
  // each stroke has its share of the time; a two-point tool drags its last point out, a path grows point by point
  const items = all.flatMap((it, i): StrokeItem[] => {
    const g = Math.min(1, Math.max(0, f * all.length - i));
    if (g <= 0) return [];
    const p = it.pts;
    if (it.tool === 'pen' || it.tool === 'run') return [{ ...it, pts: p.slice(0, Math.max(1, Math.ceil(g * p.length))) }];
    if (p.length === 2) return [{ ...it, pts: [p[0], [p[0][0] + (p[1][0] - p[0][0]) * g, p[0][1] + (p[1][1] - p[0][1]) * g]] }];
    return [it];
  });
  return <Telestration data={data} clock={clock} items={items} surface={mode} />;
}

/** &linkdemo=13,11,14,15,16: the pen's link tool as clicked, one player every LINK_STEP s of the animation clock
 *  (__teleNow when recording), in a second <Telestration> as the Tactics mode mounts it; a trailing c closes it after the
 *  last */
const LINK_STEP = 0.55;
function LinkDemo({ data, clock, mode, spec }: { data: Loaded; clock: Clock; mode: PitchMode; spec: string }) {
  const all = useMemo(() => spec.replace('c', '').split(',').map(Number), [spec]), closes = spec.endsWith('c');
  const [n, setN] = useState(0);
  useFrame((state) => {
    const now = hooked<number>('teleNow') ?? state.clock.elapsedTime;
    const k = Math.min(all.length + (closes ? 1 : 0), Math.floor(now / LINK_STEP) + 1);
    if (k !== n) setN(k);
  });
  const items: Item[] = n > 0 ? [{ id: 'linkdemo', kind: 'link', players: all.slice(0, Math.min(n, all.length)), closed: closes && n > all.length }] : [];
  return <Telestration data={data} clock={clock} items={items} surface={mode} />;
}

/** &chance=1: the pass chances in the head's stack, the links by width; &stackshow=name,stamina |
 *  stamina | none: which of the Show tag's rows are on; &cpath=hue|lab the colour's path */
const CHANCE = q.get('chance') === '1';
const SHOW_ROWS = ((v) => ({ name: v.includes('name'), bar: v.includes('stamina') }))((q.get('stackshow') ?? 'name,stamina').split(','));
{ const v = q.get('cpath'); if (v === 'hue' || v === 'lab') TELE.passProb.headPath = v; }
function ChanceTags({ data, clock, looks, hover, mode }: { data: Loaded; clock: Clock; looks: ReturnType<typeof makeLooks> | undefined; hover: HideRef; mode: PitchMode }) {
  const [state, setState] = useState<{ carrier: number; edges: { to: number; p: number; offside: boolean }[] } | null>(null);
  const st = useRef({ t: -1e9, ready: 0 });
  useFrame(() => {
    if (Math.abs(clock.t - st.current.t) < 0.33 && st.current.ready !== 1) return;
    st.current.t = clock.t;
    const s = passStateAt(data.pkg as unknown as ClipPkg, clock.t, () => { st.current.ready = 1; });
    if (st.current.ready === 1) st.current.ready = 2;
    setState(s.carrier !== null && s.opts ? { carrier: s.carrier, edges: s.opts.map((o) => ({ to: o.p, p: o.prob, offside: o.offside })) } : null);
  });
  const players = useMemo(() => (state ? state.edges.map((e) => e.to) : []), [state?.carrier, state?.edges.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const chances = useMemo(() => new Map(state ? state.edges.map((e) => [e.to, e.offside ? null : e.p] as [number, number | null]) : []), [state]);
  if (!state) return null;
  return <>
    <Telestration data={data} clock={clock} items={[{ id: 'pprob', kind: 'passprob', carrier: state.carrier, edges: state.edges, look: 'width' }]} surface={mode} />
    <StackTags data={data} clock={clock} looks={looks} hover={hover} layout="v4" anchor="px" players={players} chances={chances} show={SHOW_ROWS} />
  </>;
}

/** &pprob=width|mid|feet|ramp: the pass chances from the player on the ball (hud/passProb.ts and its model), as
 *  Tactics will mount them, in a second <Telestration>; recomputed three times a second while the clock moves */
function PassProbDemo({ data, clock, mode, look }: { data: Loaded; clock: Clock; mode: PitchMode; look: 'width' | 'mid' | 'feet' | 'ramp' }) {
  const [items, setItems] = useState<Item[]>([]);
  const st = useRef({ t: -1e9, ready: 0 });
  useFrame(() => {
    if (Math.abs(clock.t - st.current.t) < 0.33 && st.current.ready !== 1) return;
    st.current.t = clock.t;
    const s = passStateAt(data.pkg as unknown as ClipPkg, clock.t, () => { st.current.ready = 1; });
    if (st.current.ready === 1) st.current.ready = 2;
    setItems(s.carrier !== null && s.opts ? [{ id: 'pprob', kind: 'passprob', carrier: s.carrier, edges: s.opts.map((o) => ({ to: o.p, p: o.prob, offside: o.offside })), look }] : []);
  });
  return <Telestration data={data} clock={clock} items={items} surface={mode} />;
}

function VarCam() {
  const st = useMemo(() => ({ wide: null as number[] | null, lastAge: Infinity, set: null as null | ((...a: number[]) => void) }), []);
  useFrame(() => {
    type CamSet = ((...a: number[]) => void) & { varWrapped?: boolean };
    const camSet = hooked<CamSet>('camSet'), camGet = hooked<() => { pos: number[]; target: number[] }>('cam'), F = VAR_FACTS, V = TELE.offside.var;
    if (!camSet || !camGet) return;
    // the wide view is whatever the page (or a recording's setup) last set: catch those calls
    if (!camSet.varWrapped) {
      const orig = camSet; st.set = orig;
      const wrapped = Object.assign((...a: number[]) => { st.wide = a; orig(...a); }, { varWrapped: true });
      hook('camSet', wrapped);
    }
    if (!F.on || !st.set) return;
    const restart = F.age < st.lastAge - 0.05;
    st.lastAge = F.age;
    if (!st.wide) {
      const c = camGet(), d = c.pos.map((v, i) => v - c.target[i]), L = Math.hypot(d[0], d[1], d[2]) || 1;
      st.wide = [c.target[0], c.target[1], c.target[2], (Math.atan2(d[0], d[2]) * 180) / Math.PI, (Math.asin(d[1] / L) * 180) / Math.PI, L];
    }
    const w = st.wide, c = varCamera(F, w[3], V.turnDeg);
    if (!c) return;
    const u = Math.min(1, Math.max(0, (F.age - V.holdS) / V.flyS)), e = u * u * (3 - 2 * u);
    if (u <= 0) { if (restart) st.set(...w); return; }
    let dy = c[3] - w[3]; dy -= 360 * Math.round(dy / 360);
    st.set(w[0] + (c[0] - w[0]) * e, w[1] + (c[1] - w[1]) * e, w[2] + (c[2] - w[2]) * e, w[3] + dy * e, w[4] + (c[4] - w[4]) * e, w[5] * Math.pow(c[5] / w[5], e));
  });
  return null;
}

function HoldHover({ hover }: { hover: { current: number } }) {
  useFrame(() => { if (HOVER >= 0) hover.current = HOVER; });
  return null;
}

function Scene({ data, clock, onTick, items, mode }: { data: Loaded; clock: Clock; onTick: (dt: number) => void; items: Item[]; mode: PitchMode }) {
  const game = useGameSettings();
  const hide = useMemo<HideRef>(() => ({ current: -1 }), []), hideOfficial = useMemo<HideRef>(() => ({ current: -1 }), []), hover = useMemo<HideRef>(() => ({ current: -1 }), []);
  // the shot's freeze: the shooter alone in toon, everyone else in silhouette, no referees, no ball trace
  const focus = useMemo<HideRef>(() => ({ current: -1 }), []), shotOn = items.some((it) => it.kind === 'shot');
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5), []);
  // the match roster's looks and names by tracking id, as every window now uses (the line-up show's identities)
  const roster = useRoster();
  const looks = useMemo(() => (data.joints ? clipLooks(data.pkg, roster, makeLooks(data.joints.players, data.joints.nAtt, { hair: 1, number: 1, skin: 1 }, keepersOf(data.pkg))) : undefined), [data, roster]);
  // &nm=0: no names over the pointers (the name over the triangle: the roster's English full name)
  const names = useMemo(() => {
    if (q.get('nm') === '0' || !roster) return undefined;
    // with the head's stack under design (&stack=), the cue's name in the tag's own form: the number and the shirt name
    if (STACK) return (p: number) => (looks?.[p] ? `${looks[p].number} ${looks[p].name.toUpperCase()}` : null);
    const pids = ((data.pkg as { players?: { pid?: string }[] }).players ?? []).map((p) => p.pid), by = new Map(roster.players.map((r) => [r.pid, r.name]));
    return (p: number) => (pids[p] ? by.get(pids[p]!) ?? null : null);
  }, [data, roster, looks]);
  const officialLooks = useMemo(() => makeLooks(3, 3, { hair: 5, number: 5, skin: 5 }).map((l) => ({ ...l, number: -1, name: '', keeper: false })), []);
  // the kits follow the teams, not the roles (home blue, away orange), as in the game
  const attacking = attackingOf(data.pkg.meta);
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
      {q.get('var') === '1' && <VarCam />}
      <Pitch glow={0.22} mode={mode} />
      <SurfaceFlip data={data} clock={clock} mode={mode} />
      <Furniture />
      {q.get('stadium') !== '0' && <ProceduralStadium clipPlane={clipPlane} shell="crystal" />}
      {data.joints && (shotOn
        ? <><Players J={data.joints} clock={clock} style="toon" looks={looks} only={focus} hover={hover} attacking={attacking} /><Players J={data.joints} clock={clock} style="silhouette" looks={looks} hide={focus} attacking={attacking} /></>
        : <Players J={data.joints} clock={clock} style={game.tactical ? game.style : 'toon'} looks={looks} hide={hide} hover={hover} attacking={attacking} />)}
      {data.officials?.joints && !shotOn && <Players J={data.officials.joints} clock={clock} style="toon" looks={officialLooks} hide={hideOfficial} kit="official" />}
      <StyledBall pkg={data.pkg} clock={clock} style="modern" />
      {/* &split=1: the selected ring in a second component mounted after the first, as Stage's and the Tactics mode's
          are in the app (the scene-wide cues must survive the second one's frame) */}
      {q.get('split') === '1'
        ? <><Telestration data={data} clock={clock} items={items.filter((it) => !it.id.startsWith('sel-'))} surface={mode} focus={focus} /><Telestration data={data} clock={clock} items={items.filter((it) => it.id.startsWith('sel-'))} surface={mode} /></>
        : <Telestration data={data} clock={clock} items={items} surface={mode} focus={focus} />}
      <HoverPointer data={data} clock={clock} hover={hover} names={names} />
      {DRAG && data.joints && (q.get('dragghost') === '1' || DRAG_SEQ) && <GhostPlayers J={data.joints} clock={clock} looks={looks} attacking={attackingOf(data.pkg.meta)} ghosts={dragGhosts(data, clock.t, DRAG)} />}
      {STACK && <StackTags data={data} clock={clock} looks={looks} hover={hover} layout={STACK} anchor={q.get('anchor') === 'px' ? 'px' : 'm'} players={STACK_TAGS} />}
      {CHANCE && <ChanceTags data={data} clock={clock} looks={looks} hover={hover} mode={mode} />}
      {!shotOn && q.get('bt') !== 'off' && <BallTrace data={data} clock={clock} surface={mode} />}
      <BallReadout data={data} clock={clock} />
      <HoldHover hover={hover} />
      <CameraDirector data={data} clock={clock} onTick={onTick} hide={hide} hideOfficial={hideOfficial} clipPlane={clipPlane} hover={hover} />
    </>
  );
}

const SLIDERS: { label: string; get: () => number; set: (v: number) => void; min: number; max: number; step: number }[] = [
  { label: '外圈半径 m', get: () => TELE.ring.R, set: (v) => { TELE.ring.R = v; }, min: 0.4, max: 1.6, step: 0.01 },
  { label: '外圈宽 m', get: () => TELE.ring.outerW, set: (v) => { TELE.ring.outerW = v; }, min: 0.05, max: 0.6, step: 0.005 },
  { label: '内圈半径 m', get: () => TELE.ring.innerR, set: (v) => { TELE.ring.innerR = v; }, min: 0.2, max: 1.2, step: 0.01 },
  { label: '内圈宽 m', get: () => TELE.ring.innerW, set: (v) => { TELE.ring.innerW = v; }, min: 0.03, max: 0.5, step: 0.005 },
  { label: '虚线段数', get: () => TELE.ring.arcs, set: (v) => { TELE.ring.arcs = Math.round(v); }, min: 3, max: 24, step: 1 },
  { label: '实段占比', get: () => TELE.ring.dashFill, set: (v) => { TELE.ring.dashFill = v; }, min: 0.3, max: 0.95, step: 0.01 },
  { label: '转一圈 s', get: () => TELE.ring.spinS, set: (v) => { TELE.ring.spinS = v; }, min: 1, max: 20, step: 0.1 },
  { label: '光晕强度', get: () => TELE.glow.strength, set: (v) => { TELE.glow.strength = v; }, min: 0, max: 0.6, step: 0.01 },
  { label: '光晕半径 m', get: () => TELE.glow.sigma, set: (v) => { TELE.glow.sigma = v; }, min: 0.02, max: 0.6, step: 0.005 },
  { label: '最细 px', get: () => TELE.minPx, set: (v) => { TELE.minPx = v; }, min: 0, max: 4, step: 0.1 },
  { label: '俯视放大', get: () => TELE.viewGain.tactical, set: (v) => { TELE.viewGain.tactical = v; }, min: 0.5, max: 3, step: 0.05 },
  { label: '队色 ③→②', get: () => TELE.team.mixW, set: (v) => { TELE.team.mixW = v; TELE.team.mode = 'mix'; }, min: 0, max: 1, step: 0.05 },
  { label: '标记半宽 m', get: () => TELE.pointer.halfM, set: (v) => { TELE.pointer.halfM = v; }, min: 0.05, max: 0.8, step: 0.01 },
  { label: '标记最小', get: () => TELE.pointer.sizeMin, set: (v) => { TELE.pointer.sizeMin = v; }, min: 0.002, max: 0.02, step: 0.0005 },
  { label: '标记最大', get: () => TELE.pointer.sizeVH, set: (v) => { TELE.pointer.sizeVH = v; }, min: 0.004, max: 0.03, step: 0.0005 },
  { label: '标记高度', get: () => TELE.pointer.lift, set: (v) => { TELE.pointer.lift = v; }, min: 0, max: 4, step: 0.05 },
  { label: '浮动幅度', get: () => TELE.pointer.bob, set: (v) => { TELE.pointer.bob = v; }, min: 0, max: 2, step: 0.05 },
  { label: '浮动 Hz', get: () => TELE.pointer.bobHz, set: (v) => { TELE.pointer.bobHz = v; }, min: 0, max: 3, step: 0.05 },
  { label: '暗晕', get: () => TELE.pointer.shadow, set: (v) => { TELE.pointer.shadow = v; }, min: 0, max: 1, step: 0.05 },
  { label: '轨迹秒数', get: () => TELE.ball.seconds, set: (v) => { TELE.ball.seconds = v; }, min: 0.3, max: 4, step: 0.1 },
  { label: '轨迹半宽 m', get: () => TELE.ball.half, set: (v) => { TELE.ball.half = v; }, min: 0.02, max: 0.3, step: 0.005 },
  { label: '轨迹不透明', get: () => TELE.ball.alpha, set: (v) => { TELE.ball.alpha = v; }, min: 0.1, max: 1, step: 0.05 },
  { label: '轨迹光晕', get: () => TELE.ball.glow, set: (v) => { TELE.ball.glow = v; }, min: 0, max: 1, step: 0.05 },
  { label: '影子深浅', get: () => TELE.ball.shadowAlpha, set: (v) => { TELE.ball.shadowAlpha = v; }, min: 0, max: 0.8, step: 0.02 },
  { label: '火花 开=1', get: () => (TELE.spark.on ? 1 : 0), set: (v) => { TELE.spark.on = v >= 0.5; }, min: 0, max: 1, step: 1 },
  { label: '火花寿命 s', get: () => TELE.spark.life, set: (v) => { TELE.spark.life = v; }, min: 0.1, max: 1.2, step: 0.02 },
  { label: '火花间隔 s', get: () => TELE.spark.dt, set: (v) => { TELE.spark.dt = v; }, min: 0.005, max: 0.08, step: 0.005 },
  { label: '火花大小 px', get: () => TELE.spark.sizePx, set: (v) => { TELE.spark.sizePx = v; }, min: 1, max: 10, step: 0.2 },
  { label: '火花溅开', get: () => TELE.spark.spread, set: (v) => { TELE.spark.spread = v; }, min: 0, max: 4, step: 0.1 },
  { label: '火花发白', get: () => TELE.spark.hot, set: (v) => { TELE.spark.hot = v; }, min: 0, max: 1, step: 0.05 },
  { label: '会合爆点', get: () => TELE.spark.burst, set: (v) => { TELE.spark.burst = Math.round(v); }, min: 0, max: 60, step: 1 },
  { label: '连线宽 m', get: () => TELE.unit.lineW, set: (v) => { TELE.unit.lineW = v; }, min: 0.04, max: 0.5, step: 0.005 },
  { label: '距离字高 m', get: () => TELE.unit.labelM, set: (v) => { TELE.unit.labelM = v; }, min: 0.4, max: 3, step: 0.05 },
  { label: '读数字号 px', get: () => TELE.readout.numPx, set: (v) => { TELE.readout.numPx = v; }, min: 14, max: 64, step: 1 },
  { label: '峰值保持 s', get: () => TELE.readout.holdS, set: (v) => { TELE.readout.holdS = v; }, min: 0, max: 3, step: 0.1 },
  { label: '影子半宽 m', get: () => TELE.ball.shadowHalf, set: (v) => { TELE.ball.shadowHalf = v; }, min: 0.04, max: 0.5, step: 0.01 },
];

export function Sandbox() {
  const clock = useMemo(makeClock, []);
  const [data, setData] = useState<Loaded | null>(null);
  const [playing, setPlaying] = useState(q.get('play') === '1');
  const [hidden, setHidden] = useState(false);
  const [, force] = useState(0);
  const st = useRef({ playing: q.get('play') === '1', end: 0 });
  const mode = useMemo<PitchMode>(() => ({ current: 0, origin: new THREE.Vector2(), reach: 75 }), []);
  const game = useGameSettings();

  useEffect(() => {
    loadMoment(MOMENT).then((d) => {
      const pkg = d.pkg as Pkg, key = pkg.meta.pass ?? pkg.meta.shot;
      // a shot freezes on the boot meeting the ball, not the event feed's tenth of a second
      const shot = pkg.meta.shot, feed = key ? key.t : pkg.meta.decision_frame / pkg.meta.fps;
      // and a pass on its kick (offside is judged there)
      const t = q.get('t') !== null ? +(q.get('t') ?? 0) : shot ? contactTime(d, shot.t) : pkg.meta.pass ? contactTime(d, pkg.meta.pass.t) : feed;
      hook('contact', { feed, t });
      // &cam=shot: the low shot camera, once the director is up
      if (q.get('cam') === 'shot' && shot) {
        const c = shotCamera(d, t, shot.shooter);
        hook('shotCam', c);
        const tryIt = (n: number) => { const set = hooked<(...a: number[]) => void>('camSet'); if (c && set) set(...c); else if (n > 0) setTimeout(() => tryIt(n - 1), 200); };
        tryIt(40);
      }
      clock.t = t; st.current.end = (pkg.frames.length - 1) / pkg.meta.fps;
      if (q.get('tac') === '1') setSettings({ tactical: true });
      if (getSettings().selected === null) setSettings({ selected: pkg.meta.pass?.passer ?? pkg.meta.shot?.shooter ?? 0 });
      setData(d);
    });
  }, [clock]);
  const play = useCallback((p: boolean) => { st.current.playing = p; setPlaying(p); }, []);
  const onTick = useCallback((dt: number) => {
    if (st.current.playing) { clock.t += dt; if (clock.t >= st.current.end) clock.t = 0; }
  }, [clock]);
  const replay = useCallback(() => { setHidden(true); setTimeout(() => setHidden(false), 450); }, []);
  /** the tuning, out of the page: downloaded as tele-style.json, copied to the clipboard, kept in localStorage */
  const [saved, setSaved] = useState('');
  const save = useCallback(() => {
    const json = JSON.stringify({ savedAt: new Date().toISOString(), ring: TELE.ring, team: TELE.team, pointer: TELE.pointer, ball: TELE.ball, readout: TELE.readout, unit: TELE.unit, spark: TELE.spark, glow: TELE.glow, minPx: TELE.minPx, viewGain: TELE.viewGain, smoothS: TELE.smoothS, color: TELE.color }, null, 2);
    try { localStorage.setItem('tele-style', json); } catch { /* private window */ }
    navigator.clipboard?.writeText(json).catch(() => undefined);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = 'tele-style.json'; a.click();
    setSaved(new Date().toLocaleTimeString());
  }, []);
  useEffect(() => {
    hook('setT', (x: number) => { clock.t = x; play(false); });
    hook('play', (p: boolean) => play(p));
    hook('tele', TELE); hook('replay', replay);
    hook('select', (p: number) => setSettings({ selected: p >= 0 ? p : null }));
    if (q.get('capture') === '1') hook('capture', true);
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ') { play(!st.current.playing); e.preventDefault(); }
      const v = VIEWS.find((x) => x.hotkey === e.key); if (v) setSettings({ view: v.key });
      if (e.key === 't' || e.key === 'T') setSettings((s) => ({ tactical: !s.tactical }));
      if (e.key === 'e' || e.key === 'E') replay();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [clock, play, replay]);

  const items: Item[] = hidden ? [] : [...selectedItems(game), ...ALSO.filter((p) => p !== game.selected).map((p): Item => ({ id: `also-${p}`, kind: 'marker', at: { player: p } })),
    ...UNITS.map((side): Item => ({ id: `units-${side}`, kind: 'units', side })),
    // &zone=rect:x0,y0,x1,y1 | poly:x,y,x,y,... (3 to 8 corners) | circle:x,y,r | lane:left-half | pocket:def:centre
    // (between the back line and the midfield) ; several with ;
    ...(q.get('zone') ?? '').split(';').filter(Boolean).map((z, i): Item | null => {
      const [k, a, b] = z.split(':');
      if (k === 'rect') { const r = a.split(',').map(Number) as [number, number, number, number]; return r.length === 4 && r.every(Number.isFinite) ? { id: `zone-${i}`, kind: 'zone', rect: r } : null; }
      if (k === 'poly') { const v = a.split(',').map(Number), c: XY[] = []; for (let j = 0; j + 1 < v.length; j += 2) c.push([v[j], v[j + 1]]); return c.length >= 3 && v.every(Number.isFinite) ? { id: `zone-${i}`, kind: 'zone', poly: c.slice(0, 8) } : null; }
      if (k === 'lane') return { id: `zone-${i}`, kind: 'zone', lane: a as LaneName };
      if (k === 'circle') { const c = a.split(',').map(Number) as [number, number, number]; return c.length === 3 && c.every(Number.isFinite) ? { id: `zone-${i}`, kind: 'zone', circle: c } : null; }
      if (k === 'preset') return { id: `zone-${i}`, kind: 'zone', preset: a as 'zone14' | 'half-space-left' | 'half-space-right' };
      if (k === 'pocket') return { id: `zone-${i}`, kind: 'zone', pocket: { side: a as 'att' | 'def', lane: b as LaneName } };
      return null;
    }).filter((x): x is Item => x !== null),
    // &vis=<player>[,<player>...]|sel: their vision, everything none of them sees darkened
    ...(q.get('vis') ? [{ id: 'vis', kind: 'vision', player: q.get('vis') === 'sel' ? (game.selected ?? 0) : (q.get('vis') ?? '').split(',').map(Number) } as Item] : []),
    // &spot=<player>[,<player>...]: the highlight, the white column of light on each (for the narration
    // to point at a player, on the ball or off it; it follows him)
    ...(q.get('spot') ? (q.get('spot') ?? '').split(',').filter((x) => x !== '').map((p): Item => ({ id: `spot-${p}`, kind: 'spotlight', at: { player: +p } })) : []),
    // &lb=1: the clip's line-breaking pass
    ...(q.get('lb') === '1' ? [{ id: 'lb', kind: 'linebreak' } as Item] : []),
    // &trail=<player>|sel: his speed trail and read-out
    ...(q.get('trail') ? [{ id: 'trail', kind: 'trail', player: q.get('trail') === 'sel' ? (game.selected ?? 0) : +q.get('trail')! } as Item] : []),
    // &head=<player>: his running direction (ripples, then the arrow along his next 2 s)
    ...(q.get('head') ? [{ id: 'head', kind: 'heading', player: +q.get('head')! } as Item] : []),
    // &ctrl=1: pitch control, restyled
    ...(q.get('ctrl') === '1' ? [{ id: 'ctrl', kind: 'control' } as Item] : []),
    // &pass=1: the clip's pass as arrows: the ball from the kick to the receiver's next touch, his run in between
    ...(q.get('pass') === '1' && data ? passArrows(data) : []),
    ...(DRAG ? [...(DRAG_SEQ ? [] : [{ id: 'drag', kind: 'heading', player: DRAG.player, to: DRAG.at } as Item]),
      ...(q.get('dragring') === '1' ? [{ id: 'drag-ring', kind: 'zone', circle: [DRAG.at[0], DRAG.at[1], 0.8], fill: 'none', ink: DRAG.player < (data?.pkg.frames[0].att.length ?? 11) ? 'att' : 'def' } as Item] : [])] : []),
    // &link=7,20;13,11,14,15,16;21,19,11,13c: players linked by the pen (LinkItem; a trailing c closes it), several
    // with ; &pocket=21,19,17|13,11,14: the pocket between two linked lines
    ...(q.get('link') ?? '').split(';').filter(Boolean).map((l, i): Item => ({ id: `link-${i}`, kind: 'link', players: l.replace('c', '').split(',').map(Number), closed: l.endsWith('c') })),
    ...(q.get('pocket') ? [{ id: 'pocket', kind: 'zone', lines: (q.get('pocket') ?? '').split('|').map((g) => g.split(',').map(Number)) as [number[], number[]] } as Item] : []),
    // &pa=barbed|chevrons|line|landing: the pass arrow's look (TELE.passArrow) on the clip's pass, beside the receiver's
    // run to where he takes it in the running direction's look (the Tactics pen's pass and run)
    ...(q.get('pa') && data ? penPassRun(data) : []),
    // &off=1: the offside wall (the defending side's line; the clip's receiver's margin); &offall=1 as the Tactics
    // one-click line: every attacker in an offside position ringed, no focus
    ...(q.get('off') === '1' ? [{ id: 'off', kind: 'offside', ...(q.get('offall') === '1' ? { highlight: 'all', focus: null } : {}) } as Item] : []),
    // &var=1: the offside wall with the VAR-style close-up after it (var.ts); &vturn=<deg>: the close-up's turn off the line;
// &vfocus=<player>: the attacker it judges (default the pass's receiver)
    ...(q.get('var') === '1' ? [{ id: 'var', kind: 'offside', close: true, ...(q.get('vfocus') ? { focus: +(q.get('vfocus') ?? 0) } : {}) } as Item] : []),
    // &press=1: pressure on the carrier (the attacker nearest the ball); &press=<n> on player n
    ...(q.get('press') ? [{ id: 'press', kind: 'pressure', carrier: q.get('press') === '1' ? undefined : +q.get('press')! } as Item] : []),
    // &hull=def|att: a side's block, its hull and area
    ...(q.get('hull') === 'def' || q.get('hull') === 'att' ? [{ id: 'hull', kind: 'hull', side: q.get('hull') } as Item] : []),
    // &shot=1: the shot cone from the clip's shooter (or the attacker nearest the ball); &shot=<n> from player n
    ...(q.get('shot') ? [{ id: 'shot', kind: 'shot', shooter: q.get('shot') === '1' ? ((data?.pkg.meta as { shot?: { shooter?: number } } | undefined)?.shot?.shooter ?? undefined) : +q.get('shot')! } as Item] : []),
    // &mark=engine|tracking: marking links (the defending side's), &mfocus=1 only the selected player's
    ...(q.get('mark') === 'engine' || q.get('mark') === 'tracking' ? [{ id: 'mark', kind: 'marking', rule: q.get('mark'), focus: q.get('mfocus') === '1' ? game.selected : null } as Item] : []),
    ...(q.get('net') === '1' || q.get('net') === 'options' ? [{ id: 'net', kind: 'network', mode: q.get('net') === 'options' ? 'options' : 'chemistry', focus: game.selected } as Item] : [])];
  if (!data) return null;
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 30, position: [0, 30, 60], near: 0.5, far: 2000 }} gl={{ antialias: true, localClippingEnabled: true }}>
        <Scene data={data} clock={clock} onTick={onTick} items={items} mode={mode} />
        {q.get('pen') === '1' && <PenDemo data={data} clock={clock} mode={mode} />}
        {(['width', 'mid', 'feet', 'ramp'] as const).filter((v) => v === q.get('pprob')).map((v) => <PassProbDemo key={v} data={data} clock={clock} mode={mode} look={v} />)}
        {q.get('linkdemo') && <LinkDemo data={data} clock={clock} mode={mode} spec={q.get('linkdemo')!} />}
      </Canvas>
      {q.get('ui') !== '0' && (
        <div className="tl-panel">
          <div className="tl-row">{VIEWS.map((v) => <button key={v.key} className={game.view === v.key ? 'on' : ''} onClick={() => setSettings({ view: v.key })} title={v.hotkey}>{v.label}</button>)}</div>
          <div className="tl-row">
            <button className={!game.tactical ? 'on' : ''} onClick={() => setSettings({ tactical: false })}>草皮</button>
            <button className={game.tactical ? 'on' : ''} onClick={() => setSettings({ tactical: true })}>战术板</button>
            <button onClick={() => play(!playing)}>{playing ? '暂停' : '播放'}</button>
            <button onClick={replay} title="E">重播入场</button>
            <button onClick={save} title="下载 tele-style.json，同时复制到剪贴板">保存参数</button>
            {saved && <span className="tl-note">已保存 {saved}</span>}
            <span className="tl-note">选中 {game.selected ?? '无'} · 点球员换人</span>
          </div>
          <div className="tl-row">
            <span className="tl-note">悬停标记</span>
            {SHAPES.map((m) => <button key={m.key} className={TELE.pointer.shape === m.key ? 'on' : ''} onClick={() => { TELE.pointer.shape = m.key; force((x) => x + 1); }}>{m.label}</button>)}
          </div>
          <div className="tl-row">
            <span className="tl-note">球的轨迹</span>
            {BALLS.map((m) => <button key={m.key} className={TELE.ball.mode === m.key ? 'on' : ''} onClick={() => { TELE.ball.mode = m.key; force((x) => x + 1); }}>{m.label}</button>)}
          </div>
          <div className="tl-row">
            <span className="tl-note">连线特效</span>
            {([['burst', 'B 火花'], ['weld', 'C 焊花'], ['dust', 'D 星尘'], ['flow', 'E 光流'], ['ripple', 'F 涟漪']] as const).map(([k, l]) => <button key={k} className={TELE.spark.style === k ? 'on' : ''} onClick={() => { TELE.spark.style = k; force((x) => x + 1); replay(); }}>{l}</button>)}
          </div>
          <div className="tl-row">
            <span className="tl-note">区域入场</span>
            {([['corners', 'A 拼合'], ['scan', 'B 扫描'], ['unfold', 'C 展开'], ['trace', 'D 描边'], ['glint', 'E 闪光']] as const).map(([k, l]) => <button key={k} className={TELE.zone.anim === k ? 'on' : ''} onClick={() => { TELE.zone.anim = k; force((x) => x + 1); replay(); }}>{l}</button>)}
          </div>
          <div className="tl-row"><span className="tl-note">盯人入场</span>
            {([['stretch', 'A 拉伸'], ['snap', 'B 弹射'], ['merge', 'C 融合'], ['lasso', 'D 套索'], ['embrace', 'E 合围'], ['sonar', 'F 声呐'], ['fade', 'G 淡入']] as const).map(([k, l]) => <button key={k} className={TELE.mark.anim === k ? 'on' : ''} onClick={() => { TELE.mark.anim = k; force((x) => x + 1); replay(); }}>{l}</button>)}
            <button className={TELE.mark.pulse ? 'on' : ''} onClick={() => { TELE.mark.pulse = !TELE.mark.pulse; force((x) => x + 1); }}>脉冲</button>
          </div>
          <div className="tl-row">
            <span className="tl-note">球速读数</span>
            {READOUTS.map((m) => <button key={m.key} className={TELE.readout.mode === m.key ? 'on' : ''} onClick={() => { TELE.readout.mode = m.key; force((x) => x + 1); }}>{m.label}</button>)}
          </div>
          <div className="tl-row">
            <span className="tl-note">内圈队色</span>
            {TEAM_MODES.map((m) => <button key={m.key} className={TELE.team.mode === m.key ? 'on' : ''} onClick={() => { TELE.team.mode = m.key; force((x) => x + 1); }}>{m.label}</button>)}
          </div>
          {SLIDERS.map((s) => (
            <label key={s.label} className="tl-slider">
              <span>{s.label}</span>
              <input type="range" min={s.min} max={s.max} step={s.step} defaultValue={s.get()} onInput={(e) => { s.set(+(e.target as HTMLInputElement).value); force((x) => x + 1); }} />
              <b>{+s.get().toFixed(3)}</b>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
