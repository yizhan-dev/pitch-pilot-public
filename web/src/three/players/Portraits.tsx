import { useEffect, useMemo, useRef } from 'react';
import { createPortal, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Joints } from '../../data';
import type { Clock } from '../../clock';
import type { Look } from './looks';
import { Players } from './Styles';
import type { Team } from '../coords';

// Portraits for the HUD's player card (hud-notes, 2026-10-22): each player's toon, front-on, head and shoulders, in a
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

/** attacking: the team of players 0..nAtt-1, so each portrait wears his team's kit (coords.ts, Yi 2026-10-23) */
export function PortraitStudio({ J, looks, attacking = 'home', onDone }: { J: Joints; looks: Look[]; attacking?: Team; onDone: (urls: (string | null)[]) => void }) {
  const scene = useMemo(() => new THREE.Scene(), []);
  const SJ = useMemo(() => standing(J), [J]);
  const clock = useMemo<Clock>(() => ({ t: 0, playing: false, rate: 1 }), []);
  const st = useRef({ frames: 0, done: false });
  useEffect(() => { st.current = { frames: 0, done: false }; }, [SJ, looks, attacking]);
  useFrame(({ gl }) => {
    const s = st.current;
    if (s.done || ++s.frames < 4) return;   // the figures place their meshes in their own frame callbacks first
    s.done = true;
    const rt = new THREE.WebGLRenderTarget(PORTRAIT.w, PORTRAIT.h, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(15, PORTRAIT.w / PORTRAIT.h, 0.1, 20);
    const buf = new Uint8Array(PORTRAIT.w * PORTRAIT.h * 4), cv = document.createElement('canvas');
    cv.width = PORTRAIT.w; cv.height = PORTRAIT.h;
    const g = cv.getContext('2d')!, img = g.createImageData(PORTRAIT.w, PORTRAIT.h), row = PORTRAIT.w * 4;
    const prevTarget = gl.getRenderTarget(), prevClear = gl.getClearColor(new THREE.Color()), prevAlpha = gl.getClearAlpha();
    const urls: (string | null)[] = [];
    try {
      for (let p = 0; p < J.players; p++) {
        cam.position.set(p * GAP, 1.62, 2.4); cam.lookAt(p * GAP, 1.57, 0);   // head and shoulders, from 1.25 m to 1.9 m
        gl.setRenderTarget(rt); gl.setClearColor(0x000000, 0); gl.clear(); gl.render(scene, cam);
        gl.readRenderTargetPixels(rt, 0, 0, PORTRAIT.w, PORTRAIT.h, buf);
        for (let y = 0; y < PORTRAIT.h; y++) img.data.set(buf.subarray((PORTRAIT.h - 1 - y) * row, (PORTRAIT.h - y) * row), y * row);
        g.putImageData(img, 0, 0);
        urls.push(cv.toDataURL('image/png'));
      }
    } finally {   // the renderer's target and clear colour back even if a render or a read fails
      gl.setRenderTarget(prevTarget); gl.setClearColor(prevClear, prevAlpha);
      rt.dispose();
    }
    onDone(urls);
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
