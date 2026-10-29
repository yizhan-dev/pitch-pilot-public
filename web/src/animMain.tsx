import { animFile } from './data/paths';
import { hook } from './dev';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import '@fontsource/inter/400.css';
import { Pitch } from './three/Pitch';
import { Players } from './three/players/Styles';
import { makeLooks } from './three/players/looks';
import { FrameCounter } from './three/FrameCounter';
import type { Joints } from './data';
import type { Clock } from './clock';

// A look at the Mixamo animations on our cartoon players (for the pre-match warm-up): /anim.html shows
// every converted animation side by side (web/scripts/mixamo_joints.mjs writes them to anim/), each player
// looping his own; ?a=offensive-idle,victory picks some. window.__setT and __frames for the recording scripts.

// Baseball Walk Out left out; its FBX stays with the others
const ALL = ['offensive-idle', 'victory', 'warming-up', 'warrior-idle', 'happy-idle', 'orc-idle', 'taunt'];
interface Anim { name: string; fps: number; frames: number; names: string[]; data: number[] }
const SPACING = 2.6, FPS = 25, SECONDS = 12;

/** every animation on one player each, in a row along x, looping, as one joints block like the match's */
function combine(anims: Anim[]): Joints {
  const P = anims.length, nJ = anims[0].names.length, F = SECONDS * FPS, data = new Float32Array(F * P * nJ * 3);
  anims.forEach((a, p) => {
    const x0 = (p - (P - 1) / 2) * SPACING;
    for (let f = 0; f < F; f++) for (let j = 0; j < nJ; j++) {
      const s = ((f % a.frames) * nJ + j) * 3, o = ((f * P + p) * nJ + j) * 3;
      data[o] = a.data[s] + x0; data[o + 1] = a.data[s + 1]; data[o + 2] = a.data[s + 2];
    }
  });
  return { fps: FPS, frames: F, players: P, nAtt: Math.ceil(P / 2), names: anims[0].names, data, flip: [1, 1] };
}

/** the camera framing the whole row, at chest height; each name kept under its player on screen */
function Framing({ width, labels }: { width: number; labels: React.RefObject<(HTMLSpanElement | null)[]> }) {
  const { camera, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera, v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (size.width / size.height));
    cam.position.set(0, 1.5, (width / 2 + 1.4) / Math.tan(hfov / 2)); cam.lookAt(0, 0.95, 0);
    labels.current?.forEach((el, p) => {
      if (!el) return;
      const n = labels.current!.length, x = (p - (n - 1) / 2) * SPACING;
      v.set(x, -0.1, 0).project(cam);
      el.style.left = `${(v.x * 0.5 + 0.5) * size.width}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * size.height + 10}px`;
    });
  });
  return null;
}

function Ticker({ clock }: { clock: Clock }) {
  useFrame((_, dt) => { if (clock.playing) clock.t = (clock.t + dt) % (SECONDS - 0.1); });
  return null;
}

function App() {
  const want = useMemo(() => (new URLSearchParams(location.search).get('a')?.split(',') ?? ALL), []);
  const [anims, setAnims] = useState<Anim[] | null>(null);
  useEffect(() => { Promise.all(want.map((n) => fetch(animFile(n)).then((r) => r.json()))).then(setAnims); }, [want]);
  const clock = useMemo<Clock>(() => ({ t: 0, playing: true, rate: 1 }), []);
  useEffect(() => { hook('setT', (t: number) => { clock.playing = false; clock.t = t % (SECONDS - 0.1); }); }, [clock]);
  const J = useMemo(() => (anims ? combine(anims) : null), [anims]);
  const looks = useMemo(() => (J ? makeLooks(J.players, J.nAtt, { hair: 1, number: 1, skin: 1 }) : []), [J]);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  if (!J || !anims) return null;
  const w = (J.players - 1) * SPACING;
  return (
    <>
      <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 30, position: [0, 1.5, 20], near: 0.1, far: 2000 }}>
        <color attach="background" args={['#05070b']} />
        <hemisphereLight args={['#c9d6ff', '#0b120d', 0.55]} />
        <directionalLight position={[-20, 90, 30]} intensity={1.8} castShadow shadow-mapSize={[2048, 2048]} />
        <directionalLight position={[40, 60, 35]} intensity={0.7} />
        <directionalLight position={[-40, 60, -35]} intensity={0.5} />
        <Pitch glow={0.22} ground />
        <Players J={J} clock={clock} style="toon" looks={looks} lod={false} />
        <Ticker clock={clock} />
        <Framing width={w} labels={labels} />
        <FrameCounter />
      </Canvas>
      <div className="an-head">Mixamo 动作 · 卡通球员 · 循环播放</div>
      {anims.map((a, p) => <span key={a.name} className="an-label" ref={(el) => { labels.current[p] = el; }}>{a.name}</span>)}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
