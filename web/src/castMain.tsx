import { animFile } from './data/paths';
import { hook } from './dev';
import { createRoot } from 'react-dom/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import { Players } from './three/players/Styles';
import { FrameCounter } from './three/FrameCounter';
import { Props } from './cast/Props';
import { CAST, type Anim } from './cast/cast';
import { holdInFront } from './cast/hold';
import { resize } from './cast/resize';
import type { Joints } from './data';
import type { Clock } from './clock';

// The cast (src/cast/cast.ts) on a dark stage, side by side, each looping its animation (option B):
// /cast.html; ?c=coach,gamer picks some. window.__setT and __frames for the recording scripts (scripts/clip.mjs).

interface Baked { name: string; fps: number; frames: number; names: string[]; data: number[] }
const SPACING = 1.45, FPS = 25, SECONDS = 12;
/** the camera's distance from the row, and each figure's turn past facing it (a three-quarter view) */
const CAM_D = 9.5, TURN = +(new URLSearchParams(location.search).get('turn') ?? 0.2);   // ?turn=1.57: from the side, for checking
/** ?anim=coach:happy-idle,fan:victory-2 tries another animation on a figure */
const TRY = Object.fromEntries((new URLSearchParams(location.search).get('anim') ?? '').split(',').filter(Boolean).map((kv) => kv.split(':')));

/** one animation's frames in play order: pinned over its first hip position, or forward then back */
function frames(a: Baked, o: Anim) {
  const nJ = a.names.length, h = a.names.indexOf('midHip');
  const order = o.pingpong ? [...Array(a.frames).keys(), ...[...Array(a.frames - 2).keys()].map((k) => a.frames - 2 - k)] : [...Array(a.frames).keys()];
  return order.map((f) => {
    const s = f * nJ * 3, out = a.data.slice(s, s + nJ * 3);
    if (o.pin) { const dx = a.data[s + h * 3] - a.data[h * 3], dy = a.data[s + h * 3 + 1] - a.data[h * 3 + 1]; for (let j = 0; j < nJ; j++) { out[j * 3] -= dx; out[j * 3 + 1] -= dy; } }
    if (o.size) resize(out, a.names, o.size.k, o.size.inward, a.data[h * 3], a.data[h * 3 + 1]);
    if (o.hold) holdInFront(out, a.names);
    return out;
  });
}

/** the cast in a row along x, as one joints block like the match's */
function combine(baked: Baked[], anims: Anim[]): Joints {
  const P = baked.length, nJ = baked[0].names.length, F = SECONDS * FPS, data = new Float32Array(F * P * nJ * 3);
  baked.forEach((a, p) => {
    const seq = frames(a, anims[p]), x0 = (p - (P - 1) / 2) * SPACING;
    // turned about the hips to face the camera, then a little further, all the same way
    const th = Math.atan2(x0, CAM_D) + TURN, c = Math.cos(th), sn = Math.sin(th);
    for (let f = 0; f < F; f++) {
      const src = seq[f % seq.length];
      for (let j = 0; j < nJ; j++) {
        const o = ((f * P + p) * nJ + j) * 3, x = src[j * 3], y = src[j * 3 + 1];
        data[o] = x * c - y * sn + x0; data[o + 1] = x * sn + y * c; data[o + 2] = src[j * 3 + 2];
      }
    }
  });
  return { fps: FPS, frames: F, players: P, nAtt: P, names: baked[0].names, data, flip: [1, 1] };
}

/** the camera framing the row a little from above; each label kept under its figure */
function Framing({ n, labels }: { n: number; labels: React.RefObject<(HTMLDivElement | null)[]> }) {
  const { camera, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera, v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    // as close as the row's width allows, never past CAM_D (the figures' turn is set for it)
    const w = (n - 1) * SPACING + 1.3, hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (size.width / size.height));
    const d = Math.min(CAM_D, Math.max((w / 2) / Math.tan(hfov / 2), 2.5 / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)))));
    cam.position.set(0, 1.15, d); cam.lookAt(0, 0.98, 0);
    labels.current?.forEach((el, p) => {
      if (!el) return;
      v.set((p - (n - 1) / 2) * SPACING, -0.02, 0.55).project(cam);
      el.style.left = `${(v.x * 0.5 + 0.5) * size.width}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * size.height + 8}px`;
    });
  });
  return null;
}

function Ticker({ clock }: { clock: Clock }) {
  useFrame((_, dt) => { if (clock.playing) clock.t = (clock.t + dt) % (SECONDS - 0.1); });
  return null;
}

function App() {
  const want = useMemo(() => new URLSearchParams(location.search).get('c')?.split(','), []);
  const cast = useMemo(() => CAST.filter((r) => !want || want.includes(r.key)), [want]);
  const [baked, setBaked] = useState<Baked[] | null>(null);
  const anims = useMemo(() => cast.map((r) => (TRY[r.key] ? { name: TRY[r.key] } : r.anim)), [cast]);
  useEffect(() => { Promise.all(anims.map((a) => fetch(animFile(a.name)).then((x) => x.json()))).then(setBaked); }, [anims]);
  const clock = useMemo<Clock>(() => ({ t: 0, playing: true, rate: 1 }), []);
  useEffect(() => { hook('setT', (t: number) => { clock.playing = false; clock.t = t % (SECONDS - 0.1); }); }, [clock]);
  const J = useMemo(() => (baked ? combine(baked, anims) : null), [baked, anims]);
  const looks = useMemo(() => cast.map((r) => r.look), [cast]);
  const props = useMemo(() => cast.map((r) => r.props), [cast]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  if (!J) return null;
  return (
    <>
      <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 24, position: [0, 1.15, 9.5], near: 0.1, far: 200 }}>
        <color attach="background" args={['#0b0e14']} />
        <fog attach="fog" args={['#0b0e14', 10.5, 15]} />
        <hemisphereLight args={['#d6defa', '#141820', 0.75]} />
        <directionalLight position={[-6, 12, 9]} intensity={1.9} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} shadow-bias={-0.0004} />
        <directionalLight position={[8, 6, 6]} intensity={0.6} />
        <directionalLight position={[0, 5, -8]} intensity={0.8} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[30, 64]} /><meshStandardMaterial color="#0a0d12" roughness={0.95} /></mesh>
        {cast.map((_, p) => (
          <mesh key={p} rotation-x={-Math.PI / 2} position={[(p - (cast.length - 1) / 2) * SPACING, 0.002, 0]} receiveShadow>
            <circleGeometry args={[0.55, 48]} /><meshStandardMaterial color="#18202b" roughness={0.9} />
          </mesh>
        ))}
        <Players J={J} clock={clock} style="toon" looks={looks} lod={false} />
        <Props J={J} clock={clock} looks={looks} props={props} />
        <Ticker clock={clock} />
        <Framing n={cast.length} labels={labels} />
        <FrameCounter />
      </Canvas>
      {cast.map((r, p) => (
        <div key={r.key} className="cs-label" ref={(el) => { labels.current[p] = el; }}>
          <b>{r.name}</b><span>{r.mode}</span>
        </div>
      ))}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
