import { assetFile } from '../../../data/paths';
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import * as THREE from 'three';
import { Pitch } from '../../Pitch';
import { FrameCounter } from '../../FrameCounter';
import { SkyDome } from '../Sky';
import { ProceduralStadium } from '../Procedural';
import { Furniture } from '../Furniture';
import { BigScreen, DIRS, SCREEN_DEFAULT, type ScreenDir, type ScreenParams } from './BigScreen';

// The big-screen testbed (/screen.html; Yi, 2026-10-22: design the 大屏 here, put it in the stadium once satisfied).
// The screen hangs at the west goal end, set into the third tier's grey ring under the roof, inside the full stadium,
// so every direction is judged where it will live. Panel: direction, sliders, camera presets, copy the parameters.
// Address: ?dir=matrix|halftone|portrait|wave|flip|replay|tactics &cam=centre|far|close|corner|flat and any slider key (pitch=0.2).
// Hooks for the headless scripts: window.__screen(patch), window.__screenCam(name), window.__screenT (the screen's clock).

const X = -(61 + 28.6) + 0.12, TOP = 25.7;     // the ring's front at the west end (layout HX + TOP.d0), its top
const PORTRAIT = assetFile('screen/portrait.png'), REPLAY = assetFile('screen/replay.png');   // local renders
const SHOW_SCREEN = new URLSearchParams(location.search).get('screen') !== '0';   // ?screen=0: the stadium alone
const CAMS: Record<string, { pos: [number, number, number]; fov: number; label: string }> = {
  centre: { pos: [0, 9, 0], fov: 40, label: '中圈' },
  far: { pos: [62, 22, 10], fov: 30, label: '对面看台' },
  close: { pos: [-52, 14, 14], fov: 40, label: '禁区前' },
  corner: { pos: [30, 14, 34], fov: 35, label: '角上' },
  flat: { pos: [-20, 17, 0], fov: 10.5, label: '正面长焦' },
};

function readParams(): { p: ScreenParams; cam: string } {
  const q = new URLSearchParams(location.search), p = { ...SCREEN_DEFAULT };
  const d = q.get('dir'); if (d && DIRS.some((x) => x.key === d)) p.dir = d as ScreenDir;
  for (const k of ['w', 'h', 'pitch', 'dot', 'off', 'angle', 'gain'] as const) { const v = q.get(k); if (v !== null && !isNaN(+v)) p[k] = +v; }
  const cam = q.get('cam') ?? 'centre';
  return { p, cam: cam in CAMS ? cam : 'centre' };
}

function Rig({ cam, h }: { cam: string; h: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitImpl | null };
  // debugging: window.__meshes() lists every mesh (index, vertex count, colour), window.__hide([indices]) hides those
  const scene = useThree((st) => st.scene);
  useEffect(() => {
    const W = window as unknown as Record<string, unknown>;
    const all = () => { const out: THREE.Mesh[] = []; scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
    W.__meshes = () => all().map((m, i) => { const mat = m.material as THREE.MeshStandardMaterial; return [i, m.geometry.getAttribute('position')?.count ?? 0, mat.color ? '#' + mat.color.getHexString() : mat.type]; });
    W.__hide = (ix: number[]) => { const a = all(); a.forEach((m, i) => { m.visible = !ix.includes(i); }); return ix.length; };
    W.__points = (on: boolean) => { scene.traverse((o) => { if ((o as THREE.Points).isPoints) o.visible = on; }); return on; };   // the glow sprites and the crowd
  }, [scene]);
  // any camera, for inspecting the stadium from anywhere: window.__look(px, py, pz, tx, ty, tz, fov)
  useEffect(() => {
    (window as unknown as { __look?: unknown }).__look = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 40) => {
      camera.position.set(px, py, pz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(tx, ty, tz);
      if (controls) { controls.target.set(tx, ty, tz); controls.update(); }
    };
  }, [camera, controls]);
  useEffect(() => {
    const c = CAMS[cam] ?? CAMS.centre, target = new THREE.Vector3(X, TOP - h / 2, 0);
    camera.position.set(...c.pos); camera.fov = c.fov; camera.updateProjectionMatrix(); camera.lookAt(target);
    if (controls) { controls.target.copy(target); controls.update(); }
  }, [cam, camera, controls, h]);
  return null;
}

const SLIDERS: { key: keyof Omit<ScreenParams, 'dir'>; label: string; min: number; max: number; step: number }[] = [
  { key: 'pitch', label: '点距 m', min: 0.06, max: 0.5, step: 0.01 }, { key: 'dot', label: '点大小', min: 0.3, max: 1, step: 0.01 },
  { key: 'off', label: '暗点亮度', min: 0, max: 0.25, step: 0.01 }, { key: 'gain', label: '网点增益', min: 0.4, max: 2, step: 0.05 },
  { key: 'angle', label: '网格角度', min: 0, max: 45, step: 45 }, { key: 'w', label: '宽 m', min: 8, max: 32, step: 0.5 }, { key: 'h', label: '高 m', min: 2, max: 8, step: 0.1 },
];

export function ScreenLab() {
  const init = useMemo(readParams, []);
  const [p, setP] = useState<ScreenParams>(init.p), [cam, setCam] = useState(init.cam), [copied, setCopied] = useState(false);
  const set = (patch: Partial<ScreenParams>) => setP((o) => ({ ...o, ...patch }));
  useEffect(() => {
    const W = window as unknown as Record<string, unknown>;
    W.__screen = (patch: Partial<ScreenParams>) => set(patch); W.__screenCam = (c: string) => setCam(c); W.__screenParams = () => p;
  }, [p]);
  useEffect(() => {
    const q = new URLSearchParams(location.search); q.set('dir', p.dir); q.set('cam', cam);
    for (const k of ['w', 'h', 'pitch', 'dot', 'off', 'angle', 'gain'] as const) q.set(k, String(p[k]));
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, [p, cam]);
  const text = `大屏 ${DIRS.find((d) => d.key === p.dir)?.label} · ${JSON.stringify(p)}`;
  return (
    <>
      <Canvas dpr={[1, 1.5]} camera={{ fov: 40, position: [0, 9, 0], near: 0.5, far: 2000 }} gl={{ antialias: true, localClippingEnabled: true }}>
        <color attach="background" args={['#05070b']} />
        <fog attach="fog" args={['#05070b', 160, 420]} />
        <hemisphereLight args={['#c9d6ff', '#0b120d', 0.55]} />
        <directionalLight position={[-20, 90, 30]} intensity={1.8} />
        <directionalLight position={[40, 60, -35]} intensity={0.7} />
        <directionalLight position={[40, 60, 35]} intensity={0.5} />
        <directionalLight position={[-40, 60, -35]} intensity={0.5} />
        <SkyDome />
        <FrameCounter />
        <Pitch glow={0.22} />
        <Furniture />
        <ProceduralStadium shell="crystal" />
        {SHOW_SCREEN && <group position={[X, TOP - p.h / 2, 0]} rotation-y={Math.PI / 2}><BigScreen p={p} portraitUrl={PORTRAIT} replayUrl={REPLAY} /></group>}
        <OrbitControls makeDefault enableDamping={false} />
        <Rig cam={cam} h={p.h} />
      </Canvas>
      <div className="sl-panel">
        <b>大屏测试台 · 网点</b>
        <div className="sl-row">{DIRS.map((d) => <button key={d.key} className={p.dir === d.key ? 'on' : ''} onClick={() => set({ dir: d.key })}>{d.label}</button>)}</div>
        {SLIDERS.map((s) => (
          <label key={s.key} className="sl-slider"><span>{s.label}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={p[s.key]} onChange={(e) => set({ [s.key]: +e.target.value })} /><b>{p[s.key]}</b></label>
        ))}
        <div className="sl-row">{Object.entries(CAMS).map(([k, c]) => <button key={k} className={cam === k ? 'on' : ''} onClick={() => setCam(k)}>{c.label}</button>)}</div>
        <div className="sl-row"><button onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); }}>{copied ? '已复制' : '复制参数'}</button>
          <button onClick={() => setP({ ...SCREEN_DEFAULT, dir: p.dir })}>恢复默认</button></div>
        <span className="sl-note">拖动旋转，滚轮缩放。占位内容：A队 / B队，号码是编的。</span>
      </div>
    </>
  );
}
