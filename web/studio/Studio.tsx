import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { StadiumShell } from '../src/three/stadium/Shell';
import { StadiumBowl } from '../src/three/stadium/Procedural';
import { Pitch } from '../src/three/Pitch';
import { Furniture } from '../src/three/stadium/Furniture';
import { SkyDome } from '../src/three/stadium/Sky';
import { DEFAULT_FACADE } from '../src/three/stadium/Facade';
import type { ShellForm } from '../src/three/stadium/Shell';
import { CAMS, TIMES, DEFAULT_STATE, type StudioState } from './config';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HX, HY, RC, ROOF } from '../src/three/stadium/layout';
import { roundedRect } from '../src/three/stadium/path';
import { Panel } from './Panel';

const BARE = new URLSearchParams(location.search).has('bare');   // screenshots: no panel
// the section camera cuts the building at x = 0 and keeps the far (west) half, so the wall profiles show in elevation
const SECTION_CLIP = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)];

/** state version written into the URL; bump it with an entry here whenever a crystal default changes on purpose */
const STATE_VERSION = 3;
const CHANGED_DEFAULTS: [number, string[]][] = [
  [2, ['signSymbolPanel']],          // the goal-end symbols lose their black panel
  [3, ['archMain', 'mainRise', 'mainLean']],   // v1, symmetric north and south
];

function readHash(): StudioState {
  try {
    const raw = decodeURIComponent(location.hash.slice(1));
    if (!raw) return DEFAULT_STATE;
    const s = JSON.parse(raw);
    // a link saved before a default changed would otherwise keep the old value: drop the keys changed since its version,
    // so they come from the current fixed version (STADIUM_CURRENT)
    const v = typeof s.v === 'number' ? s.v : 1;
    for (const [since, keys] of CHANGED_DEFAULTS) if (v < since && s.crystal) for (const k of keys) delete s.crystal[k];
    // links made before the crystal existed carry only a facade: open them as the swept envelope
    const form: ShellForm = s.form ?? (s.facade ? 'sweep' : 'crystal');
    return { ...DEFAULT_STATE, ...s, form, facade: { ...DEFAULT_FACADE, ...(s.facade ?? {}) }, crystal: { ...DEFAULT_STATE.crystal, ...(s.crystal ?? {}) } };   // missing keys come from the current fixed version
  } catch { return DEFAULT_STATE; }
}

/** soft reflections for glass and steel: a procedural studio environment, no files to download */
function EnvLight({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl), env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { scene.environment = null; env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  useEffect(() => { scene.environmentIntensity = intensity; }, [scene, intensity]);
  return null;
}

/** counts rendered frames on window.__frames, for the screenshot script */
function FrameCounter() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    // a perf probe for the screenshot scripts: average ms per full render, and what the GPU is asked to draw
    (window as unknown as { __perf?: unknown }).__perf = (n = 20) => {
      const ctx = gl.getContext(), px = new Uint8Array(4), sync = () => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);   // readPixels waits for the GPU
      gl.render(scene, camera); sync();
      const t0 = performance.now(); for (let k = 0; k < n; k++) { gl.render(scene, camera); sync(); }
      const ms = (performance.now() - t0) / n, r = gl.info.render, m = gl.info.memory;
      let meshes = 0, verts = 0; scene.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g && o.visible) { meshes++; verts += g.getAttribute('position')?.count ?? 0; } });
      const top: [string, number][] = [];
      scene.traverse((o) => { const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (!g || !o.visible) return;
        const n0 = g.index ? g.index.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3, inst = (o as THREE.InstancedMesh).count ?? 1;
        const kind = (o as THREE.Points).isPoints ? 'pts' : (o as THREE.Line).isLine ? 'line' : 'mesh';
        top.push([`${kind}:${(o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).type}:${o.castShadow ? 'S' : ''}`, Math.round(kind === 'mesh' ? n0 * ((o as THREE.InstancedMesh).isInstancedMesh ? inst : 1) : (g.getAttribute('position')?.count ?? 0))]); });
      top.sort((a, b) => b[1] - a[1]);
      return { top: top.slice(0, 12), ms: +ms.toFixed(1), calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines, geometries: m.geometries, textures: m.textures, objects: meshes, vertices: verts };
    };
    // a north-south symmetry probe: the highest vertex in each cell x cell column, for z > 0 against its mirror at -z.
    // Reports how far the two halves differ, overall and for the objects that differ most.
    (window as unknown as { __sym?: unknown }).__sym = (cell = 1, tol = 0.15) => {
      const top = new Map<string, number>(), owner = new Map<string, string>(), v = new THREE.Vector3();
      scene.updateMatrixWorld();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !o.visible) return;
        const pos = m.geometry.getAttribute('position'); if (!pos) return;
        const id = `${m.material && (m.material as THREE.Material).type}:${pos.count}`;
        for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          if (Math.abs(v.z) < cell) continue;
          const key = `${Math.round(v.x / cell)},${Math.round(Math.abs(v.z) / cell)},${v.z > 0 ? 'N' : 'S'}`;
          if (!(top.get(key)! >= v.y)) { top.set(key, v.y); owner.set(key, id); } } });
      const d: number[] = [], by = new Map<string, number>(), far: [string, number, number][] = []; let lone = 0;
      for (const [key, h] of top) { if (!key.endsWith('N')) continue; const o = top.get(key.slice(0, -1) + 'S');
        if (o === undefined) { lone++; continue; }
        const dd = Math.abs(h - o); d.push(dd);
        if (dd > tol) { const w = h > o ? owner.get(key)! : owner.get(key.slice(0, -1) + 'S')!; by.set(w, (by.get(w) ?? 0) + 1);
          far.push([key, +h.toFixed(1), +o.toFixed(1)]); } }
      d.sort((a, b) => a - b); const q = (f: number) => +d[Math.floor(f * (d.length - 1))].toFixed(3);
      return { cells: d.length, lone, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over: d.filter((x) => x > tol).length, worst: [...by].sort((a, b) => b[1] - a[1]).slice(0, 8),
        largest: far.sort((a, b) => Math.abs(b[1] - b[2]) - Math.abs(a[1] - a[2])).slice(0, 12) };
    };
  }, [gl, scene, camera]);
  useEffect(() => {
    // a flicker probe: render, nudge the camera sideways by eps metres, render again, and map the pixels that changed.
    // A tiny move should change almost nothing; what does change is z-fighting, aliasing and shimmer.
    (window as unknown as { __flicker?: unknown }).__flicker = (eps = 0.02, thr = 40) => {
      const ctx = gl.getContext(), w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight, a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4);
      const grab = (buf: Uint8Array) => { gl.render(scene, camera); ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf); };
      grab(a);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      camera.position.addScaledVector(right, eps); camera.updateMatrixWorld();
      grab(b);
      camera.position.addScaledVector(right, -eps); camera.updateMatrixWorld();
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c2 = cv.getContext('2d')!, img = c2.createImageData(w, h); let n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4, d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        const g = (a[i] + a[i + 1] + a[i + 2]) / 9;
        if (d > thr) { n++; img.data.set([255, 40, 40, 255], o); } else img.data.set([g, g, g, 255], o);
      }
      c2.putImageData(img, 0, 0);
      return { changed: n, share: +(n / (w * h)).toFixed(4), png: cv.toDataURL('image/png') };
    };
    // a toggle detector: three positions 0, eps, 2 eps. An edge moving smoothly changes steadily; a flickering pixel
    // (z-fighting, aliasing that jumps) changes A -> B -> A. Those are painted red.
    (window as unknown as { __toggle?: unknown }).__toggle = (eps = 0.01, thr = 60) => {
      const ctx = gl.getContext(), w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight, bufs = [0, 1, 2].map(() => new Uint8Array(w * h * 4));
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), p0 = camera.position.clone();
      bufs.forEach((buf, k) => { camera.position.copy(p0).addScaledVector(right, eps * k); camera.updateMatrixWorld(); gl.render(scene, camera); ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf); });
      camera.position.copy(p0); camera.updateMatrixWorld();
      const [a, b, c] = bufs, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c2 = cv.getContext('2d')!, img = c2.createImageData(w, h); let n = 0;
      const D = (x: Uint8Array, y: Uint8Array, i: number) => Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, o = ((h - 1 - y) * w + x) * 4, g = (a[i] + a[i + 1] + a[i + 2]) / 9;
        if (D(a, b, i) > thr && D(b, c, i) > thr && D(a, c, i) < thr / 2) { n++; img.data.set([255, 40, 40, 255], o); } else img.data.set([g, g, g, 255], o);
      }
      c2.putImageData(img, 0, 0);
      return { toggles: n, png: cv.toDataURL('image/png') };
    };
  }, [gl, scene, camera]);
  useFrame(() => { const w = window as unknown as { __frames?: number }; w.__frames = (w.__frames ?? 0) + 1; });
  return null;
}

function CameraRig({ cam, controls }: { cam: string; controls: React.MutableRefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    const c = CAMS[cam] ?? CAMS.plaza, pc = camera as THREE.PerspectiveCamera;
    pc.position.set(...c.pos); pc.fov = c.fov; pc.updateProjectionMatrix();
    if (controls.current) { controls.current.target.set(...c.target); controls.current.update(); } else pc.lookAt(...c.target);
  }, [cam, camera, controls]);
  return null;
}

/** Rendering on demand: the scene only redraws when something changes. Shadows are drawn once per change
 *  instead of every frame; the camera does not move the sun's shadow map, so orbiting reuses it. */
function OnDemand({ dep }: { dep: unknown }) {
  const { gl, invalidate } = useThree();
  useEffect(() => { gl.shadowMap.autoUpdate = BARE; }, [gl]);
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, [gl, invalidate, dep]);
  return null;
}

/** the bowl itself is left out: a dark plate fills the footprint inside the hull */
function Footprint() {
  const geo = useMemo(() => {
    const pts = roundedRect(HX, HY, RC, 2).map((p) => new THREE.Vector2(p.x + p.nx * (ROOF.back - 4), -(p.y + p.ny * (ROOF.back - 4))));
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  return <mesh geometry={geo} position-y={0.03}><meshStandardMaterial color="#07080b" roughness={1} /></mesh>;
}

export function Studio() {
  const [state, setState] = useState<StudioState>(readHash);
  const controls = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify({ ...state, v: STATE_VERSION }))); }, [state]);
  // the panel answers at once; the scene follows when React has time, so dragging a slider never stalls
  const view = useDeferredValue(state);
  const T = TIMES[view.time];
  const facade = useMemo(() => ({ ...view.facade, glow: view.facade.glow * T.glow, ledGain: view.facade.ledGain * T.led }), [view.facade, T]);
  const crystal = useMemo(() => ({ ...view.crystal, glow: view.crystal.glow * T.glow, ledGain: view.crystal.ledGain * T.led }), [view.crystal, T]);
  const clip = view.cam === 'section' ? SECTION_CLIP : undefined;
  const c0 = CAMS[state.cam] ?? CAMS.plaza;
  return (
    <>
      <div className={BARE ? 'studio-view bare' : 'studio-view'}>
      <Canvas frameloop={BARE ? 'always' : 'demand'} shadows dpr={[1, 1.5]} gl={{ antialias: true, localClippingEnabled: true }} camera={{ fov: c0.fov, position: c0.pos, near: 0.5, far: 3000 }}>
        <FrameCounter />
        <OnDemand dep={view} />
        <EnvLight intensity={T.env} />
        <CameraRig cam={view.cam} controls={controls} />
        <fog attach="fog" args={[T.haze, 450, 1300]} />
        <SkyDome top={T.top} haze={T.haze} radius={1400} />
        <hemisphereLight args={T.hemi} />
        <directionalLight position={T.sun.pos} color={T.sun.color} intensity={T.sun.intensity} castShadow
          shadow-mapSize={[4096, 4096]} shadow-camera-left={-170} shadow-camera-right={170} shadow-camera-top={170} shadow-camera-bottom={-170} shadow-camera-far={900} shadow-bias={-0.0004} />
        {/* the open ground sits 25 cm below the stadium's own ground, so the layers never fight for depth at a distance */}
        <mesh rotation-x={-Math.PI / 2} position-y={-0.25} receiveShadow>
          <planeGeometry args={[3000, 3000]} />
          <meshStandardMaterial color={T.ground} roughness={1} />
        </mesh>
        {view.interior ? <>
          <StadiumBowl clip={clip} />
          <Pitch glow={T.pitch} surround={false} />
          <Furniture />
        </> : <Footprint />}
        <StadiumShell form={view.form} facade={facade} crystal={crystal} shadows clip={clip} />
        <OrbitControls ref={controls} makeDefault enableDamping autoRotate={state.spin} autoRotateSpeed={0.5} maxPolarAngle={Math.PI * 0.497} minDistance={1} maxDistance={900} />
      </Canvas>
      </div>
      {!BARE && <Panel state={state} setState={setState} reset={() => setState(DEFAULT_STATE)} />}
    </>
  );
}
