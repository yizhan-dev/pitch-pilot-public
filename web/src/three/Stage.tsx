import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PerfProbe } from './PerfProbe';
import { AdaptiveQuality, ApplyScale } from './AdaptiveQuality';
import { AA_OFF_AT_LOAD, applied, calib, calibrated, frameSkips, lowHas, useQuality, wantsCalibration, xOn } from './quality';
import { GpuMeter } from './gpuMeter';
import { varActive } from '../game/varReplay';
import { store, useStore } from '../hud/draft';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { Loaded } from '../data';
import type { Clock } from '../clock';
import { Pitch, type PitchMode } from './Pitch';
import { ballAt } from './Ball';
import { CarrierMark, Options, PitchControl, Vision } from './Layers';
import { FrameCounter } from './FrameCounter';
import { BootFrame } from './BootFrame';
import { SkyDome } from './stadium/Sky';
import { ProceduralStadium, stadiumEvents } from './stadium/Procedural';
import { Furniture } from './stadium/Furniture';
import { Players, type HideRef, type Ghost, type PlayerMask } from './players/Styles';
import { CameraDirector } from './camera/Director';
import { GameLayers } from './layers/GameLayers';
import { ShowLayer } from './layers/ShowLayer';
import { MateShotLayer } from './whatif/MateShotLayer';
import { TargetPicker } from './whatif/TargetPicker';
import { useWiStyle } from '../whatif/state';
import { useGameSettings, getSettings, showChosen, showOf, scriptBoard } from '../game/settings';
import { StyledBall } from './players/BallStyles';
import { Celebration } from './players/Celebration';
import { makeLooks, keepersOf } from './players/looks';
import { clipLooks, loadRoster, type Roster } from '../lineup/roster';
import { attackingOf, viewSign } from './coords';
import { PortraitStudio } from './players/Portraits';
import { Telestration, selectedItems } from './telestration/Telestration';
import { HoverPointer } from './telestration/HoverPointer';
import { ExplainLayer } from '../explain/ExplainLayer';
import { VarReplay } from './layers/VarReplay';
import { clipSwap, swapBoard } from '../game/clipSwap';

export type Phase = 'lead' | 'decision' | 'tail';
export interface LayerFlags { pc: boolean; opt: boolean; vis: boolean; }

// The decision lab's scene (2026-10-21): the elements Yi accepted on the workbench, in one place. The floodlit night
// stadium with the C7 crystal shell, its near stand cut away for the elevated camera; the shader grass; the goals,
// boards, benches and corner flags; the cartoon players driven by the tracked joints, with their seeded looks; the
// six-panel ball; and the champagne and fireworks where the package records a goal. The analysis layers draw over it.

function Rig({ data, clock, phase, onTick }: { data: Loaded; clock: Clock; phase: Phase; onTick: (dt: number) => void }) {
  const controls = useRef<OrbitImpl>(null);
  const { camera, size } = useThree();
  const snap = useRef(true);
  useEffect(() => { controls.current?.target.set(0, 0, 3); controls.current?.update(); }, []);
  useEffect(() => { if (!clock.playing) snap.current = true; }, [data, phase, clock]);
  useFrame((_, dt) => {
    onTick(Math.min(dt, 0.1));
    const pkg = data.pkg, c = controls.current;
    if (!c) return;
    const carrier = pkg.frames[pkg.meta.decision_frame].att[pkg.decision.carrier];
    const b = ballAt(pkg, clock.t);
    // keep the action left of centre on wide screens, clear of the decision panel
    const shift = size.width > 900 ? 9 : 0;
    const want = (phase === 'decision' ? carrier[0] + 4 : (b ? b[0] : c.target.x - shift)) + shift;
    const x = Math.max(-34, Math.min(40, want));
    const rate = snap.current ? 1 : phase === 'decision' ? 0.06 : 0.035;
    const dx = (x - c.target.x) * rate;
    c.target.x += dx; camera.position.x += dx;
    // dolly: tighter at the decision, wider while play runs
    const off = camera.position.clone().sub(c.target), want_len = phase === 'decision' ? 50 : 66;
    off.setLength(off.length() + (want_len - off.length()) * (snap.current ? 1 : 0.04));
    camera.position.copy(c.target).add(off);
    snap.current = false;
    c.update();
  });
  return <OrbitControls ref={controls} makeDefault enableDamping maxPolarAngle={Math.PI * 0.47} minDistance={15} maxDistance={140} />;
}

/** the tactical mode's change of pitch: the hexagons' progress eases towards the board while the mode is on, back to
 *  grass when off, in 2.4 s. Render time, so it runs while play is paused (clip time when recording). The wave starts
 *  under the ball. The page opens on the final state, with no change played. */
/** what the board leaves out (Yi, 2026-10-25: the referee and his assistants in 战术): hidden as the board's wave passes
 *  halfway, back as it returns */
/** what belongs to the clip on screen (players, ball): under the board while a clip changes in place (game/clipSwap.ts),
 *  so the old clip's players go as the board closes over them and the next clip's come up as it opens */
function SwapHide({ mode, children }: { mode: PitchMode; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { if (g.current) g.current.visible = clipSwap.get() === 'off' || mode.current < 0.5; });
  return <group ref={g}>{children}</group>;
}
function OffBoard({ mode, children }: { mode: PitchMode; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => { if (g.current) g.current.visible = mode.current < 0.5; });
  return <group ref={g}>{children}</group>;
}

function TacticalFlip({ data, clock, mode }: { data: Loaded; clock: Clock; mode: PitchMode }) {
  const st = useRef({ p: 0, target: -1, lastT: 0 });
  useFrame((_, raw) => {
    const capture = !!(window as unknown as { __capture?: boolean }).__capture;
    const dt = capture && clipSwap.get() === 'off' ? Math.max(0, Math.min(0.1, clock.t - st.current.lastT)) : Math.min(raw, 0.1);
    st.current.lastT = clock.t;
    // the board: the Tactics mode's, an Explain script's (scriptBoard), or a clip changing in place (clipSwap, from the
    // centre spot, the hexagons pulsing on it while the next clip loads)
    const swap = clipSwap.get(), set = getSettings(), target = set.tactical || scriptBoard.on || swap === 'out' ? 1 : 0, s = st.current;
    if (s.target < 0) { s.target = target; s.p = target; }
    if (target !== s.target) {
      s.target = target;
      const b = ballAt(data.pkg, clock.t);
      if (swap !== 'off') mode.origin.set(0, 0); else if (b) mode.origin.set(b[0], -b[1]);
      // the wave runs to the farthest corner of the grass from where it starts, so all of its time is on screen
      mode.reach = Math.max(...[[60, 42], [60, -42], [-60, 42], [-60, -42]].map(([x, y]) => Math.hypot(x - mode.origin.x, y - mode.origin.y)));
    }
    s.p = target > s.p ? Math.min(1, s.p + dt / 2.4) : target < s.p ? Math.max(0, s.p - dt / 2.4) : s.p;   // 2.4 s (Yi: 0.9 s, then 1.8 s, still slightly fast); settled: stay put
    mode.current = 0.5 - 0.5 * Math.cos(Math.PI * s.p);   // sine in and out: a gentler start and end than quadratic
    // the loading pulse: in once the board is down, out over a third of a second when the next clip is in
    const pulseOn = swap === 'out' && s.p >= 1;
    mode.pulse = Math.max(0, Math.min(1, (mode.pulse ?? 0) + (pulseOn ? dt / 0.4 : -dt / 0.3)));
    mode.pulseT = pulseOn || (mode.pulse ?? 0) > 0 ? (mode.pulseT ?? 0) + dt : 0;
    swapBoard.p = s.p; swapBoard.pulseT = pulseOn ? mode.pulseT : 0;
  });
  return null;
}

/** director: the game's camera and settings (?ui=game): seven views instead of the orbit rig, the player style and the
 *  selected player from src/game/settings.ts, the referees drawn, the near stand cut only while the camera is behind it */
/** onPortraits: called once per clip with every player's toon portrait (PNG data URLs) for the HUD's player card */
/** clipKey: the clip on screen (GameApp's moment): what belongs to the clip is mounted afresh when it changes, so each
 *  clip starts clean as it did when a clip change reloaded the page; the What-if's branches (data changes on one clip)
 *  keep it */
/** overlay: what the HUD lays on the pitch inside this canvas with the director (hud/PitchOverlay3D.tsx), given the pitch's
 *  grass-to-board change so its 战术 layers wait for the board */
/** the frame drawn less often while nothing on the stage moves (three/quality.ts xOn 'idlerender'): in Watch or Tactics,
 *  the clock and the camera still for half a second, nobody selected or under the pointer, no pointer, wheel or key for a
 *  second, no VAR check or clip change: 20 frames a second instead of every frame, so what runs on its own (the corner
 *  flags, the big screen) still moves smoothly (at 13 it stepped); anything that moves the camera, the clock or the
 *  board draws at once. Measured: paused and still, 60 renders a second down to 13 at 15 Hz (Watch and Tactics), 60 in
 *  play, the orbit, with a player selected, and as soon as the pointer moves */
const IDLE_MS = 1000 / 20 - 1;   // (every third frame at 60 Hz: 20 a second)
function RenderGate({ clock, mode, hover, covered }: { clock: Clock; mode: PitchMode; hover: HideRef; covered: boolean }) {
  const gl0 = useThree((s) => s.gl);
  const st = useMemo(() => ({ sig: new Float64Array(28), still: 0, last: 0, input: 0, warm: 0, meter: new GpuMeter(gl0), samples: [] as (number | null)[] }), [gl0]);
  useEffect(() => {
    const on = () => { st.input = performance.now(); };
    const evs = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;
    for (const e of evs) window.addEventListener(e, on, { passive: true });
    return () => { for (const e of evs) window.removeEventListener(e, on); };
  }, [st]);
  useFrame((state) => {
    const { gl, scene, camera } = state, now = performance.now(), sg = st.sig;
    // covered by the line-up show: nothing drawn but two warm frames (the textures up, the first programs), the frame's
    // callbacks still run (the ticks, the portraits' own renders)
    st.meter.poll();
    if (covered) {
      // two warm frames, and with the calibration two more, timed: the GPU's time for this view at full scale
      const timing = wantsCalibration() && st.meter.available && calib.game === null;
      if (st.warm >= (timing ? 4 : 2)) { frameSkips.n++; return; }
      st.warm++;
      if (timing && st.warm >= 3) {
        const at = gl.getPixelRatio();
        void st.meter.time(() => gl.render(scene, camera)).then((ms) => {
          st.samples.push(ms);
          if (st.samples.length < 2) return;
          const ok = st.samples.filter((x): x is number => x !== null);
          if (ok.length) calibrated('game', Math.min(...ok), at);
        });
        return;
      }
    }
    const vals = [camera.position.x, camera.position.y, camera.position.z, camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w,
      clock.t, mode.current, mode.pulse ?? 0, mode.pulseT ?? 0, gl.domElement.width];
    let changed = false;
    for (let i = 0; i < vals.length; i++) if (sg[i] !== vals[i]) { changed = true; sg[i] = vals[i]; }
    const pe = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) if (sg[12 + i] !== pe[i]) { changed = true; sg[12 + i] = pe[i]; }
    if (changed) st.still = now;
    const s = getSettings();
    const idle = !changed && now - st.still > 500 && now - st.input > 1000 && (s.mode === 'watch' || s.mode === 'tactics') && s.selected === null
      && hover.current < 0 && !varActive() && clipSwap.get() === 'off' && !document.hidden;
    if (idle && now - st.last < IDLE_MS) { frameSkips.n++; return; }
    st.last = now;
    gl.render(scene, camera);
  }, 1);
  return null;
}

/** the overlay drawn in the stage (the game's 3D overlays and the What-if's scene), handed in through a store instead
 *  of a prop, so the stage need not render again with the page's clock (three/quality.ts xOn 'stagememo') */
export const stageOverlay = store<{ draw: (mode: PitchMode) => ReactNode } | null>(null);   // (wrapped: the store takes a bare function as an updater)
function OverlayHost({ mode }: { mode: PitchMode }) {
  const f = useStore(stageOverlay);
  return f ? <>{f.draw(mode)}</> : null;
}

/** covered: the stage is out of sight under the line-up show, warmed up already; it draws only when asked (a resize),
 *  so the show has the machine to itself, and carries on as the show hands over (GameApp, three/quality.ts xOn
 *  'holdbehind'; Yi, 2026-10-29: "the hexagon fan out and the center circle enlarging before kick off still slightly
 *  lagging", with both canvases drawing at full size) */
/** covered (Stage covered): the stage draws its first two frames at once, with the line-up show's own first frames,
 *  under the loader (index.html hides it at the show's second frame): every program linked and every texture up in
 *  those two, about a second on the iGPU, where nobody sees it; then nothing until the show hands over. A compile ahead
 *  of them (compileAsync) was tried: its programs differed from the render's (the shadow pass's, the clipping's), so
 *  the first draws linked again, in the title, in sight */
function StageImpl({ data, clock, phase, layers, selected, onTick, marker = null, director = false, onPortraits, overlay, clipKey = '', covered = false, held = false }: { data: Loaded; clock: Clock; phase: Phase; layers: LayerFlags; selected: number | null; onTick: (dt: number) => void; marker?: number | null; director?: boolean; onPortraits?: (urls: (string | null)[]) => void; overlay?: (mode: PitchMode) => ReactNode; clipKey?: string; covered?: boolean; held?: boolean }) {
  const lowLight = useQuality().tier === 'low' && lowHas('light');
  const pkg = data.pkg, atDecision = phase === 'decision';
  // which team the package's attackers (players 0..nAtt-1) are: each team wears its own kit in every clip (Yi, 2026-10-23)
  const attacking = attackingOf(pkg.meta);
  // the match's ends (coords.ts viewSign): in the game, a clip that should read right to left turns the stadium round
  // and the director keeps its one-sided cameras on the other touchline
  const orient = director ? viewSign(pkg.meta) : 1;
  const stadiumEv = useMemo(() => stadiumEvents(pkg as Parameters<typeof stadiumEvents>[0]).map((e) => (e.x !== undefined ? { ...e, x: e.x * orient } : e)), [pkg, orient]);
  const game = useGameSettings();
  const hide = useMemo<HideRef>(() => ({ current: -1 }), []), hideOfficial = useMemo<HideRef>(() => ({ current: -1 }), []);
  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e5), []);
  const officialLooks = useMemo(() => makeLooks(3, 3, { hair: 5, number: 5, skin: 5 }).map((l) => ({ ...l, number: -1, name: '', keeper: false })), []);
  const ring = director ? (game.view === 'first' ? null : game.selected) : marker;
  const pitchMode = useMemo<PitchMode>(() => ({ current: 0, origin: new THREE.Vector2(), reach: 75 }), []);
  const hover = useMemo<HideRef>(() => ({ current: -1 }), []);
  // ghosts of players at other spots (Styles' Ghost; the Tactics pen mounts its own through GhostPlayers):
  // window.__ghosts([{ player, at: [x, y] }]) sets them, for the headless checks
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  // the Show menu's style (Yi, 2026-10-25): its chosen players (ShowLayer keeps showChosen each frame) in that style, the
  // rest toon, as two sets of the same players, each masked to its own
  const chosenMask = useMemo<PlayerMask>(() => ({ current: (p) => showChosen.has(p) }), []), restMask = useMemo<PlayerMask>(() => ({ current: (p) => !showChosen.has(p) }), []);
  // while a what-if is open every player is drawn in its style (whatif/state.ts wiStyle: ghosts, with or without their
  // trail), in place of the toon players and the Show menu's style (the What-if chat, 2026-10-26)
  const wis = useWiStyle(), allStyle = director ? wis : null, showStyled = director && !allStyle && showOf(game).style !== 'toon';
  useEffect(() => { (window as unknown as { __ghosts?: (g: Ghost[]) => void }).__ghosts = setGhosts; }, []);
  (window as unknown as { __pitchMode?: PitchMode }).__pitchMode = pitchMode;   // for the headless checks   // no ring at the feet of the eyes we look through
  // the match roster (src/lineup/roster.ts; Yi, 2026-10-23): each player the same name, shirt number and face in every
  // clip and in the line-up show. undefined while it loads, so the players appear once, already in their roster looks
  // (the windows load it with the package, so this resolves at once); null if there is none
  const [roster, setRoster] = useState<Roster | null | undefined>(undefined);
  useEffect(() => { let live = true; loadRoster().then((r) => { if (live) setRoster(r); }); return () => { live = false; }; }, []);
  // the players' invented looks, from the roster by tracking id, else seeded (seeds 1 unless the URL re-rolls them:
  // ?hair= ?num= ?skin= ?build= ?boots=, as on the workbench; the roster's looks re-roll with them)
  const looks = useMemo(() => {
    if (!data.joints || roster === undefined) return undefined;
    const q = new URLSearchParams(location.search), n = (k: string) => +(q.get(k) ?? 1) || 1;
    const seeds = { hair: n('hair'), number: n('num'), skin: n('skin'), build: n('build'), boots: n('boots') };
    const L = clipLooks(pkg, roster, makeLooks(data.joints.players, data.joints.nAtt, seeds, keepersOf(pkg)), seeds);
    (window as unknown as { __looks?: unknown }).__looks = L;   // for the probes (scripts/perf.mjs)
    return L;
  }, [data, pkg, roster]);
  return (
    <Canvas shadows frameloop={held ? 'demand' : 'always'} dpr={applied.scale} camera={{ fov: 30, position: [0, 30, 60], near: 0.5, far: 2000 }} gl={{ antialias: new URLSearchParams(location.search).get('aa') !== '0' && !(AA_OFF_AT_LOAD && lowHas('aa')), localClippingEnabled: true, stencil: true }} onCreated={({ camera, gl }) => { camera.lookAt(0, 0, 3); gl.localClippingEnabled = true; }}>
      <color attach="background" args={['#05070b']} />
      <fog attach="fog" args={['#05070b', 160, 420]} />
      {/* floodlit night, as on the workbench: a high key light for short player shadows, three fills from the other roof corners */}
      <group rotation-y={orient < 0 ? Math.PI : 0}>
      {/* (the low graphics tier, three/quality.ts: no shadows, and the three fills as one from their mean direction, as
          bright on the grass, the sky light a little up for the sides they lit) */}
      <hemisphereLight key={lowLight ? 'amb-low' : 'amb'} name="night-amb" args={['#c9d6ff', '#0b120d', lowLight ? 0.65 : 0.55]} />
      <directionalLight name="night-key" position={[-20, 90, 30]} intensity={1.8} castShadow={!lowLight} shadow-mapSize={[2048, 2048]} shadow-camera-left={-60} shadow-camera-right={60} shadow-camera-top={40} shadow-camera-bottom={-40} />
      {lowLight ? <directionalLight name="night-fill" position={[13, 60, -12]} intensity={1.33} /> : <>
        <directionalLight name="night-fill" position={[40, 60, -35]} intensity={0.7} />
        <directionalLight name="night-fill" position={[40, 60, 35]} intensity={0.5} />
        <directionalLight name="night-fill" position={[-40, 60, -35]} intensity={0.5} />
      </>}
      <SkyDome />
      </group>
      <FrameCounter />
      <PerfProbe />
      <ApplyScale />
      <AdaptiveQuality />
      {director && xOn('idlerender') && <RenderGate clock={clock} mode={pitchMode} hover={hover} covered={covered} />}
      <BootFrame off={covered} />
      <Pitch glow={0.22} ground={director} mode={director ? pitchMode : undefined} />
      {director && <TacticalFlip data={data} clock={clock} mode={pitchMode} />}
      <group rotation-y={orient < 0 ? Math.PI : 0}>
      <Furniture />
      {/* the full shell: drawing only the interior saved about 130,000 triangles but changed how the roof looks (Yi, 2026-10-22: keep it) */}
      {/* the crowd follows the clip's clock (still when paused) and flashes after shots and goals (stadium session, Yi 2026-10-22) */}
      <ProceduralStadium cutaway={!director} clipPlane={director ? clipPlane : undefined} shell="crystal" time={() => clock.t} events={stadiumEv} />
      </group>
      {/* what belongs to the clip, mounted afresh for each clip (a clip changes in place: game/clipSwap.ts); the pitch, the
          stadium and the camera stay */}
      <Fragment key={clipKey}>
      <SwapHide mode={pitchMode}>
      {data.joints && looks && <Players J={data.joints} clock={clock} style={allStyle ?? 'toon'} looks={looks} hide={hide} hover={director ? hover : undefined} attacking={attacking} ghosts={ghosts} mask={showStyled ? restMask : undefined} />}
      {showStyled && data.joints && looks && <Players J={data.joints} clock={clock} style={showOf(game).style} looks={looks} hide={hide} hover={hover} attacking={attacking} mask={chosenMask} />}
      </SwapHide>
      {/* the hover and selection triangles (telestration, Yi 2026-10-22): sized in metres within on-screen bounds, white over
          the player under the mouse, the team colour over the selected one */}
      {director && <HoverPointer data={data} clock={clock} hover={hover} />}
      {director && <MateShotLayer data={data} clock={clock} />}
      {director && <TargetPicker data={data} />}
      {director && data.joints && looks && onPortraits && <PortraitStudio J={data.joints} looks={looks} attacking={attacking} onDone={onPortraits} delayS={covered ? 4.5 : 0} />}
      {director && data.officials?.joints && <OffBoard mode={pitchMode}><Players J={data.officials.joints} clock={clock} style="toon" looks={officialLooks} hide={hideOfficial} kit="official" /></OffBoard>}
      {director && <GameLayers data={data} clock={clock} looks={looks} hide={hide} mode={pitchMode} />}
      {/* the Show menu's tags and speed rings, in every mode (Yi, 2026-10-24) */}
      {director && <ShowLayer data={data} clock={clock} looks={looks} hide={hide} hover={hover} />}
      {director && (overlay ? overlay(pitchMode) : <OverlayHost mode={pitchMode} />)}
      {pkg.meta.goal && <Celebration clock={clock} goalT={pkg.meta.goal.t} goalX={pkg.meta.goal.x} />}
      {<SwapHide mode={pitchMode}><StyledBall pkg={pkg} clock={clock} style="modern" /></SwapHide>}
      {atDecision && layers.pc && <PitchControl pkg={pkg} />}
      {atDecision && layers.vis && <Vision pkg={pkg} />}
      {atDecision && layers.opt && <Options pkg={pkg} selected={selected} showTags />}
      {atDecision && <CarrierMark pkg={pkg} />}
      {/* the selected player's double ring on the grass (telestration, Yi 2026-10-22): dashed white outer band turning once
          in 20 s, inner band in his team colour; none in his own first-person view */}
      {director
        ? <Telestration data={data} clock={clock} items={selectedItems(game)} surface={pitchMode} />
        : ring !== null && <Telestration data={data} clock={clock} items={[{ id: `sel-${ring}`, kind: 'marker', at: { player: ring } }]} />}
      {/* the Explain mode's director script: its drawings, pointers and offside close-up (explain/, chat 4) */}
      {director && <ExplainLayer data={data} clock={clock} surface={pitchMode} />}
      {director && <VarReplay data={data} clock={clock} surface={pitchMode} />}
      </Fragment>
      {director ? <CameraDirector data={data} clock={clock} onTick={onTick} hide={hide} hideOfficial={hideOfficial} clipPlane={clipPlane} hover={hover} orient={orient} /> : <Rig data={data} clock={clock} phase={phase} onTick={onTick} />}
    </Canvas>
  );
}

/** the stage, again only when its own props change (three/quality.ts xOn 'stagememo'): the game's page renders with its
 *  clock fifteen times a second, and every one went through the whole 3D tree */
export const Stage = xOn('stagememo') ? memo(StageImpl) : StageImpl;
