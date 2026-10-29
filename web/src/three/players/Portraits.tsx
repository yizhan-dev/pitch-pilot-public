import { useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Joints } from '../../data';
import type { Clock } from '../../clock';
import type { Look } from './looks';
import { Players } from './Styles';
import type { Team } from '../coords';

// Portraits for the HUD's player card (hud-notes): each player's toon, front-on, head and shoulders, in a
// neutral standing pose, on a transparent ground (the card lays its team-colour gradient underneath). Drawn once per
// clip, a few frames after the pitch first renders: the same figure code and looks as the pitch, in a scene of its own
// (not part of the match scene) with every player standing in a row 4 m apart, one render each into an offscreen
// target, read back as PNG data URLs.

export const PORTRAIT = { w: 544, h: 256 };   // twice the card's 272 x 128

/** a neutral standing pose, facing +z (the camera), in the scene's axes (x, up, z) for a player about 1.8 m tall */
const STAND: Record<string, [number, number, number]> = {
  nose: [0, 1.66, 0.1], neck: [0, 1.5, 0], rShoulder: [-0.19, 1.45, -0.01], rElbow: [-0.24, 1.17, -0.02], rWrist: [-0.26, 0.92, 0.02],
  lShoulder: [0.19, 1.45, -0.01], lElbow: [0.24, 1.17, -0.02], lWrist: [0.26, 0.92, 0.02],
  midHip: [0, 0.98, 0], rHip: [-0.1, 0.97, 0], rKnee: [-0.11, 0.53, 0.02], rAnkle: [-0.12, 0.09, -0.01],
  lHip: [0.1, 0.97, 0], lKnee: [0.11, 0.53, 0.02], lAnkle: [0.12, 0.09, -0.01],
  rEye: [-0.033, 1.7, 0.085], lEye: [0.033, 1.7, 0.085], rEar: [-0.075, 1.67, 0], lEar: [0.075, 1.67, 0],
  lBigToe: [0.11, 0.03, 0.17], lSmallToe: [0.16, 0.03, 0.14], lHeel: [0.12, 0.04, -0.06],
  rBigToe: [-0.11, 0.03, 0.17], rSmallToe: [-0.16, 0.03, 0.14], rHeel: [-0.12, 0.04, -0.06],
  lThumb: [0.25, 0.86, 0.06], lPinky: [0.28, 0.84, 0], rThumb: [-0.25, 0.86, 0.06], rPinky: [-0.28, 0.84, 0],
};
const GAP = 4;

/** two identical frames of every player standing, player p at x = p * GAP, in the joints' layout (x, y, z up) */
function standing(J: Joints): Joints {
  const nJ = J.names.length, P = J.players, data = new Float32Array(2 * P * nJ * 3);
  for (let f = 0; f < 2; f++) for (let p = 0; p < P; p++) J.names.forEach((n, j) => {
    const v = STAND[n] ?? STAND.neck, o = ((f * P + p) * nJ + j) * 3;
    data[o] = v[0] + p * GAP; data[o + 1] = v[2]; data[o + 2] = v[1];
  });
  return { ...J, frames: 2, data, flip: [1, 1] };
}

/** the last clip's portraits, let go of once the next clip's are handed over (they are blob URLs) */
let lastUrls: string[] = [];

/** a portrait's pixels (rows bottom up, as WebGL reads them) as a PNG blob URL, encoded off the main thread */
function toUrl(buf: Uint8Array): Promise<string | null> {
  const cv = document.createElement('canvas'), row = PORTRAIT.w * 4;
  cv.width = PORTRAIT.w; cv.height = PORTRAIT.h;
  const g = cv.getContext('2d');
  if (!g) return Promise.resolve(null);
  const img = g.createImageData(PORTRAIT.w, PORTRAIT.h);
  for (let y = 0; y < PORTRAIT.h; y++) img.data.set(buf.subarray((PORTRAIT.h - 1 - y) * row, (PORTRAIT.h - y) * row), y * row);
  g.putImageData(img, 0, 0);
  return new Promise((r) => cv.toBlob((b) => r(b ? URL.createObjectURL(b) : null), 'image/png'));
}

/** attacking: the team of players 0..nAtt-1, so each portrait wears his team's kit (coords.ts) */
/** delayS: the first portrait this long after the mount (the stage under the line-up show: its title shot is the
 *  heaviest and the hand-over is 6 s off at the earliest, so the portraits wait for the board, where there is room;
 *  the title shot dropped frames on the iGPU otherwise). Then one every second frame, and the studio is unmounted once they are
 *  handed over (GameApp): its figures' frame work ran on for the whole clip before */
export function PortraitStudio({ J, looks, attacking = 'home', onDone, delayS = 0 }: { J: Joints; looks: Look[]; attacking?: Team; onDone: (urls: (string | null)[]) => void; delayS?: number }) {
  const scene = useMemo(() => new THREE.Scene(), []);
  const SJ = useMemo(() => standing(J), [J]);
  const clock = useMemo<Clock>(() => ({ t: 0, playing: false, rate: 1 }), []);
  // one player a frame, read back without waiting on the GPU and encoded off the main thread: all 22 in one frame, read
  // and encoded there, held the page for about two seconds at each clip and in the line-up show (profiled)
  const st = useRef({ frames: 0, next: 0, got: 0, gen: 0, urls: [] as (string | null)[], rt: null as THREE.WebGLRenderTarget | null, startAt: 0 });
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    st.current = { frames: 0, next: 0, got: 0, gen: st.current.gen + 1, urls: [], rt: null, startAt: performance.now() + delayS * 1000 };
    return () => { const c = st.current; c.gen++; c.rt?.dispose(); c.rt = null; };   // (reads still on their way are dropped)
  }, [SJ, looks, attacking, delayS]);
  // (the delay's end asks for a frame: a loop on demand would sleep through it)
  useEffect(() => { const id = window.setTimeout(() => invalidate(), delayS * 1000 + 20); return () => window.clearTimeout(id); }, [delayS, invalidate]);
  const cam = useMemo(() => new THREE.PerspectiveCamera(15, PORTRAIT.w / PORTRAIT.h, 0.1, 20), []);
  useFrame(({ gl }) => {
    const s = st.current, gen = s.gen;
    // (a loop drawing on demand, the stage under the show: the next frame asked for until the last portrait is made)
    if (s.next < J.players) invalidate();
    if (s.next >= J.players || performance.now() < s.startAt || ++s.frames < 4 || s.frames % 3) return;   // the figures place their meshes in their own frame callbacks first; then one every third frame
    if (!s.rt) { s.rt = new THREE.WebGLRenderTarget(PORTRAIT.w, PORTRAIT.h, { samples: 4 }); s.rt.texture.colorSpace = THREE.SRGBColorSpace; }
    const rt = s.rt, p = s.next++, buf = new Uint8Array(PORTRAIT.w * PORTRAIT.h * 4);
    const prevTarget = gl.getRenderTarget(), prevClear = gl.getClearColor(new THREE.Color()), prevAlpha = gl.getClearAlpha();
    let read: Promise<unknown>;
    try {
      cam.position.set(p * GAP, 1.62, 2.4); cam.lookAt(p * GAP, 1.57, 0);   // head and shoulders, from 1.25 m to 1.9 m
      gl.setRenderTarget(rt); gl.setClearColor(0x000000, 0); gl.clear(); gl.render(scene, cam);
      read = gl.readRenderTargetPixelsAsync(rt, 0, 0, PORTRAIT.w, PORTRAIT.h, buf);   // (the only pixel read in the app: its pack buffer stays bound until done)
    } catch (e) { read = Promise.reject(e); }
    finally { gl.setRenderTarget(prevTarget); gl.setClearColor(prevClear, prevAlpha); }   // the renderer as it was, even if a render or a read fails
    read.then(() => toUrl(buf)).catch(() => null).then((url) => {
      if (st.current.gen !== gen) { if (url) URL.revokeObjectURL(url); return; }   // the clip changed meanwhile
      s.urls[p] = url;
      if (++s.got < J.players) return;
      s.rt?.dispose(); s.rt = null;
      const old = lastUrls; lastUrls = s.urls.filter((u): u is string => !!u);
      onDone(Array.from({ length: J.players }, (_, k) => s.urls[k] ?? null));
      window.setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 2000);   // after the card has taken the new ones
    });
  });
  return createPortal(
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[-2, 4, 5]} intensity={1.6} />
      <Players J={SJ} clock={clock} style="toon" looks={looks} lod={false} attacking={attacking} />
    </>,
    scene,
  );
}
