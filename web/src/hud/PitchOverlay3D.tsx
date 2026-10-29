import { useEffect, useMemo, useRef, useState } from 'react';
import { hook } from '../dev';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Clock } from '../clock';
import type { Loaded } from '../data';
import type { Look } from '../three/players/looks';
import { useGameSettings } from '../game/settings';
import { viewSign } from '../three/coords';
import { loadXg } from '../pause/moment';
import type { XgFreezeModel } from '../response/xg';
import type { ClipPkg } from './match';
import { momentAt, moves } from './analysis';
import { annotationShapes, drawShapes } from './overlayShapes';
import { TacticsItems } from './TacticsItems';
import { carrierAt, ballHeld, passStateAt, shooterAt, shotHeld } from './passProb';
import { BaseMap3D } from './BaseMap3D';
import { Pen3D } from './Pen3D';
import { base, annot, annotSub, playbackPlaying, useStore } from './draft';

// The HUD draft's pitch layer in ?ui=game (the new design wired into the Decision Lab): what the HUD preview
// draws on its stand-in pitch, laid on the real grass under the players. A transparent canvas over the pitch carries the
// 战术 mode's annotation canvas (overlayShapes.tsx); the base map is BaseMap3D's (on the GPU), the telestration marks are
// TacticsItems' and the pen's Pen3D's (its pointer and strokes; 画板's canvas strokes and auto lines are gone).
// 观赛's speed rings moved to the Show menu (three/layers/ShowLayer.tsx). Mounted inside the Stage's canvas by GameApp.

const L = 105, W = 68;
/** the canvas's resolution, pixels per metre (1680 x 1088 for the pitch) */
const PX_PER_M = 16;
/** the canvas is redrawn at most this often while the clock runs, per second (at once for a store change or a stroke) */
const REDRAW_HZ = 30;
/** the canvas's height over the grass and the board, metres: over GameLayers (0.03), under the selection rings (0.05) */
const LIFT_M = 0.035;
/** a temporary check by eye: the pass chances written on the grass, ?ptags=1 */
const PTAGS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ptags') === '1';

export interface PitchOverlay3DProps {
  data: Loaded;
  clock: Clock;
  looks: Look[] | undefined;
  /** the pitch's grass-to-board change (Stage's PitchMode): the 战术 layers wait for the board, as GameLayers does */
  mode?: { current: number };
}

export function PitchOverlay3D({ data, clock, looks, mode }: PitchOverlay3DProps) {
  const pkg = data.pkg as unknown as ClipPkg;
  const { mode: gameMode, selected } = useGameSettings();
  const shown = gameMode;
  const selectedBase = useStore(base), selectedAnnotation = useStore(annot), annotationSubs = useStore(annotSub);
  const playing = useStore(playbackPlaying);
  const [xg, setXg] = useState<XgFreezeModel | null>(null);
  useEffect(() => { loadXg().then(setXg); }, []);
  const allMoves = useMemo(() => moves(pkg), [pkg]);
  const name = (p: number) => (looks?.[p] ? `${looks[p].number} ${looks[p].name}` : '');
  const turned = viewSign(pkg.meta as { half?: number; attacking?: string }) < 0;   // tags read from the other touchline

  // ---- the canvas and its texture; the base map's 35 x 23 picture, stretched over the pitch when drawn
  const surface = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(L * PX_PER_M); canvas.height = Math.round(W * PX_PER_M);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    return { canvas, texture };
  }, []);
  useEffect(() => () => surface.texture.dispose(), [surface]);
  const planeRef = useRef<THREE.Mesh>(null);
  // for the headless checks: where a pitch point is on the page, to draw on the grass with synthetic pointer events
  const { camera, gl } = useThree();
  useEffect(() => {
    hook('pitchToScreen', (x: number, y: number): [number, number] => {
      const v = new THREE.Vector3(x, LIFT_M, y).project(camera), r = gl.domElement.getBoundingClientRect();
      return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
    });
  }, [camera, gl]);

  // ---- redrawing: at once after any change of what shows, then with the clock, at most REDRAW_HZ
  const redraw = useRef({ dirty: true, since: 0, t: -1, fade: -1 });
  useEffect(() => { redraw.current.dirty = true; }, [shown, selectedBase, selectedAnnotation, annotationSubs, playing, selected, xg, looks, pkg]);

  useFrame((_, dt) => {
    const plane = planeRef.current;
    if (!plane) return;
    const t = clock.t, m = momentAt(pkg, t);
    const boardFade = mode ? THREE.MathUtils.smoothstep(mode.current, 0.8, 1) : 1;
    // the column's Passing button is greyed while paused with nobody on the ball (passProb.ts)
    if (shown === 'tactics') { ballHeld.set(playing || carrierAt(pkg, t) !== null); shotHeld.set(playing || shooterAt(pkg, t) !== null); }

    // what the canvas carries now
    const tacticsOn = shown === 'tactics' && !!selectedAnnotation && boardFade > 0;
    plane.visible = tacticsOn;
    if (!plane.visible) return;
    const state = redraw.current;
    state.since += dt;
    const changed = state.dirty || boardFade !== state.fade;
    if (!changed && (t === state.t || state.since < 1 / REDRAW_HZ)) return;
    state.dirty = false; state.since = 0; state.t = t; state.fade = boardFade;

    const ctx = surface.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    // metres from the pitch's centre, y down the canvas = pitch y = world z (the plane's top edge is world -z)
    ctx.setTransform(PX_PER_M, 0, 0, PX_PER_M, surface.canvas.width / 2, surface.canvas.height / 2);
    const validSelected = selected !== null && selected >= 0 && selected < m.pos.length ? selected : null;

    // the 战术 mode's base map is BaseMap3D's (on the GPU, under this canvas)
    // the annotation, fading in with the board
    if (shown === 'tactics' && selectedAnnotation && boardFade > 0) {
      // the pass probability is the telestration passing network (TacticsItems.tsx); ?ptags=1 adds each chance on the
      // grass, a temporary check by eye until the head tags take the numbers
      const real = PTAGS && selectedAnnotation === 'pass' ? passStateAt(pkg, t, () => { redraw.current.dirty = true; }) : { carrier: null, opts: null };
      drawShapes(ctx, annotationShapes(pkg, t, selectedAnnotation, annotationSubs[selectedAnnotation], m, allMoves, xg, name, validSelected, real), boardFade, turned);
    }
    surface.texture.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={planeRef} rotation-x={-Math.PI / 2} position-y={LIFT_M} renderOrder={6}>
        <planeGeometry args={[L, W]} />
        <meshBasicMaterial map={surface.texture} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-5} polygonOffsetUnits={-5} />
      </mesh>
      {/* the base map, on the GPU, under this canvas */}
      <BaseMap3D data={data} clock={clock} mode={mode} />
      {/* the telestration marks (the offside line) */}
      <TacticsItems data={data} clock={clock} surface={mode} looks={looks} />
      {/* the Tactics pen: its pointer and its marks */}
      <Pen3D data={data} clock={clock} surface={mode} />
    </group>
  );
}
