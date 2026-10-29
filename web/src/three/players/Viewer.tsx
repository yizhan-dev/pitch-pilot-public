import { matchFile, parseClip } from '../../data/paths';
import { hook, hooked } from '../../dev';
import { useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { loadMoment, decisionTime, duration, type Joints, type Loaded } from '../../data';
import { makeClock, type Clock } from '../../clock';
import { Players } from './Styles';
import { makeLooks, keepersOf, HAIR_LABEL, type Look, type Seeds } from './looks';

// The cartoon players' line-up: every player of one real moment, moving as tracked but kept on the spot and turned to
// face the camera (or away from it, to read the shirt numbers), with their invented looks. Each look attribute has its
// own seed, so hair, numbers and skin can be re-rolled separately; the seeds live in the URL hash.

type Facing = 'front' | 'back';
interface ViewState { seeds: Seeds; facing: Facing; live: boolean; team: 'both' | 'att' | 'def'; focus?: number; az?: number; dist?: number; h?: number; el?: number }
const DEFAULT: ViewState = { seeds: { hair: 1, number: 1, skin: 1, build: 1, boots: 1 }, facing: 'front', live: true, team: 'both' };
const GAP = 1.3, ROW = 1.6, COLS = 6, STEP = 0.7;   // a team photo: six to a row, each row a step up, the blue rows in front

function readHash(): ViewState {
  try { const s = JSON.parse(decodeURIComponent(location.hash.slice(1))); return { ...DEFAULT, ...s, seeds: { ...DEFAULT.seeds, ...(s.seeds ?? {}) } }; } catch { return DEFAULT; }
}

/** where the k-th kept player of his team stands (data metres): rows of six, each row centred and staggered by half a
 *  gap from the one in front; the attackers' rows first. attRows: how many rows the attackers fill (0 if none shown) */
function slotOf(k: number, team: 'att' | 'def', inTeam: number, attRows: number) {
  const r = Math.floor(k / COLS), inRow = Math.min(COLS, inTeam - r * COLS), R = (team === 'att' ? 0 : attRows) + r;
  return [(k % COLS - (inRow - 1) / 2) * GAP + (R % 2 ? GAP / 2 : 0), 1.2 - R * ROW, R * STEP] as const;
}

/** the moment's joints, each kept player moved onto his slot and turned about his hips so his chest faces the camera
 *  (data +y), or away from it. His heading is smoothed over half a second either side, so the turn stays calm. */
function lineUp(J: Joints, keep: number[], facing: Facing): Joints {
  const nJ = J.names.length, ix = Object.fromEntries(J.names.map((n, i) => [n, i])), F = J.frames, P = keep.length;
  const out = new Float32Array(F * P * nJ * 3), at = (f: number, p: number, j: number) => ((f * J.players + p) * nJ + j) * 3;
  const nAtt = keep.filter((p) => p < J.nAtt).length, attRows = Math.ceil(nAtt / COLS);
  keep.forEach((p, k) => {
    const team = p < J.nAtt ? 'att' : 'def', inTeam = team === 'att' ? nAtt : P - nAtt, kk = team === 'att' ? k : k - nAtt;
    const [sx, sy, sz] = slotOf(kk, team, inTeam, attRows);
    // heading per frame: square to the shoulders, on the nose's side
    const head = Array.from({ length: F }, (_, f) => {
      const dx = J.data[at(f, p, ix.rShoulder)] - J.data[at(f, p, ix.lShoulder)], dy = J.data[at(f, p, ix.rShoulder) + 1] - J.data[at(f, p, ix.lShoulder) + 1];
      let fx = -dy, fy = dx;
      const nx = J.data[at(f, p, ix.nose)] - J.data[at(f, p, ix.neck)], ny = J.data[at(f, p, ix.nose) + 1] - J.data[at(f, p, ix.neck) + 1];
      if (fx * nx + fy * ny < 0) { fx = -fx; fy = -fy; }
      const l = Math.hypot(fx, fy) || 1; return [fx / l, fy / l];
    });
    const want = facing === 'front' ? Math.PI / 2 : -Math.PI / 2;
    for (let f = 0; f < F; f++) {
      let cx = 0, cy = 0;
      for (let w = Math.max(0, f - 12); w <= Math.min(F - 1, f + 12); w++) { cx += head[w][0]; cy += head[w][1]; }
      const rot = want - Math.atan2(cy, cx), c = Math.cos(rot), s = Math.sin(rot);
      const hx = J.data[at(f, p, ix.midHip)], hy = J.data[at(f, p, ix.midHip) + 1];
      for (let j = 0; j < nJ; j++) {
        const a = at(f, p, j), o = ((f * P + k) * nJ + j) * 3, x = J.data[a] - hx, y = J.data[a + 1] - hy;
        out[o] = sx + c * x - s * y; out[o + 1] = sy + s * x + c * y; out[o + 2] = J.data[a + 2] + sz;
      }
    }
  });
  return { ...J, players: P, nAtt, data: out };
}

/** a close look at one player (focus: his place among those shown), from az degrees round him (0 = from the front) */
function Focus({ at, az, dist = 3.6, h = 0.95, el }: { at: [number, number, number] | null; az: number; dist?: number; h?: number; el?: number }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    if (!at) return;
    const t = new THREE.Vector3(at[0], at[2] + h, at[1]), a = THREE.MathUtils.degToRad(az);
    const e = el === undefined ? Math.atan2(0.1, 3.6) : THREE.MathUtils.degToRad(el), hz = Math.cos(e) * dist;
    camera.position.set(t.x + Math.sin(a) * hz, t.y + Math.sin(e) * dist, t.z + Math.cos(a) * hz); camera.lookAt(t);
    if (controls) { controls.target.copy(t); controls.update(); }
  }, [at, az, dist, h, el, camera, controls]);
  return null;
}

function Tick({ clock, live, end }: { clock: Clock; live: boolean; end: number }) {
  useFrame((_, dt) => { if (live) { clock.t += Math.min(dt, 0.1); if (clock.t > end) clock.t = 0; } hook('frames', (hooked<number>('frames') ?? 0) + 1); });
  return null;
}

const btn: React.CSSProperties = { background: '#1d232c', color: '#e8eaed', border: '1px solid #313945', borderRadius: 6, padding: '6px 10px', font: '13px system-ui, sans-serif', cursor: 'pointer' };
const on: React.CSSProperties = { ...btn, background: '#e8eaed', color: '#0f1216' };

export function PlayerViewer() {
  const [st, setSt] = useState<ViewState>(readHash);
  const [data, setData] = useState<Loaded | null>(null);
  const clock = useMemo(makeClock, []);
  useEffect(() => { history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(st))); }, [st]);
  useEffect(() => {
    // one of the match's clips (?moment=<id> or its address), 15:53 by default, at its key moment (the
    // prototype moments it used to show were archived with their pages)
    (async () => {
      const idx = (await (await fetch(matchFile('index.json'))).json() as { clips: { id: string; moment: string }[] }).clips;
      const want = new URLSearchParams(location.search).get('moment'), id = want ? parseClip(want).id : 'shot-15-53';
      const row = idx.find((r) => r.id === id) ?? idx[0];
      const d = await loadMoment(row.moment); clock.t = decisionTime(d.pkg); setData(d);
    })();
  }, [clock]);
  const keep = useMemo(() => {
    if (!data?.joints) return [];
    const all = Array.from({ length: data.joints.players }, (_, p) => p);
    return st.team === 'both' ? all : all.filter((p) => (p < data.joints!.nAtt) === (st.team === 'att'));
  }, [data, st.team]);
  const looksAll = useMemo(() => (data?.joints ? makeLooks(data.joints.players, data.joints.nAtt, st.seeds, keepersOf(data.pkg)) : []), [data, st.seeds]);
  const looks: Look[] = useMemo(() => keep.map((p) => looksAll[p]), [keep, looksAll]);
  const J = useMemo(() => (data?.joints && keep.length ? lineUp(data.joints, keep, st.facing) : null), [data, keep, st.facing]);
  const roll = (k: keyof Seeds | 'all') => setSt((s) => ({ ...s, seeds: k === 'all'
    ? { hair: s.seeds.hair + 1, number: s.seeds.number + 1, skin: s.seeds.skin + 1, build: (s.seeds.build ?? 1) + 1, boots: (s.seeds.boots ?? 1) + 1 } : { ...s.seeds, [k]: (s.seeds[k] ?? 1) + 1 } }));
  const attRows = J ? Math.ceil(J.nAtt / COLS) : 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0e13' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 34, position: [0, 3.2, 12], near: 0.1, far: 200 }}>
        <color attach="background" args={['#0b0e13']} />
        <hemisphereLight args={['#dfe8ff', '#203024', 0.9]} />
        <directionalLight position={[-6, 12, 9]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-10} shadow-camera-right={10} shadow-camera-top={8} shadow-camera-bottom={-8} />
        <directionalLight position={[8, 6, -6]} intensity={0.5} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[11, 64]} /><meshStandardMaterial color="#3a6b34" roughness={0.95} /></mesh>
        {J && <Players J={J} clock={clock} style="toon" looks={looks} />}
        {/* the steps the back rows stand on */}
        {J && Array.from({ length: Math.ceil(J.nAtt / COLS) + Math.ceil((J.players - J.nAtt) / COLS) }, (_, R) => R > 0 && (
          <mesh key={R} position={[0, R * STEP / 2, 1.2 - R * ROW]} receiveShadow castShadow>
            <boxGeometry args={[COLS * GAP + 1.6, R * STEP, ROW]} /><meshStandardMaterial color="#2b2f36" roughness={0.9} />
          </mesh>
        ))}
        {J && keep.map((p, k) => {
          const team = p < data!.joints!.nAtt ? 'att' : 'def';
          const nAtt = J.nAtt, kk = team === 'att' ? k : k - nAtt, [x, y, z] = slotOf(kk, team, team === 'att' ? nAtt : J.players - nAtt, attRows);
          return (
            <Html key={p} position={[x, z + 0.02, y + 0.55]} center style={{ pointerEvents: 'none', whiteSpace: 'nowrap', font: '11px system-ui, sans-serif', color: '#cfd6de', textShadow: '0 1px 2px #000' }}>
              #{looks[k].number} {looks[k].name}{looks[k].keeper ? ' · 门将' : ''} · {HAIR_LABEL[looks[k].style]}
            </Html>
          );
        })}
        {data && <Tick clock={clock} live={st.live} end={duration(data.pkg)} />}
        <Focus az={st.az ?? 0} dist={st.dist} h={st.h} el={st.el} at={(() => {
          if (!J || st.focus === undefined || st.focus >= keep.length) return null;
          const k = st.focus, team = keep[k] < data!.joints!.nAtt ? 'att' : 'def', kk = team === 'att' ? k : k - J.nAtt;
          return slotOf(kk, team, team === 'att' ? J.nAtt : J.players - J.nAtt, attRows) as unknown as [number, number, number];
        })()} />
        <OrbitControls makeDefault target={[0, 1.6, -1.6]} maxPolarAngle={Math.PI * 0.49} minDistance={1.5} maxDistance={40} />
      </Canvas>
      <div style={{ position: 'fixed', top: 16, left: 16, display: 'grid', gap: 8, padding: 12, background: 'rgba(15,18,22,0.88)', border: '1px solid #262d36', borderRadius: 10, color: '#e8eaed', font: '13px system-ui, sans-serif', maxWidth: 'calc(100vw - 32px)' }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>卡通球员 · 外观</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={btn} onClick={() => roll('all')}>全部随机</button>
          <button style={btn} onClick={() => roll('hair')}>随机发型</button>
          <button style={btn} onClick={() => roll('number')}>随机号码和名字</button>
          <button style={btn} onClick={() => roll('skin')}>随机肤色</button>
          <button style={btn} onClick={() => roll('build')}>随机体型</button>
          <button style={btn} onClick={() => roll('boots')}>随机球鞋</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button style={st.facing === 'front' ? on : btn} onClick={() => setSt((s) => ({ ...s, facing: 'front' }))}>正面</button>
          <button style={st.facing === 'back' ? on : btn} onClick={() => setSt((s) => ({ ...s, facing: 'back' }))}>背面（看号码）</button>
          <button style={st.live ? on : btn} onClick={() => setSt((s) => ({ ...s, live: !s.live }))}>{st.live ? '动作：实时' : '动作：定格'}</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['both', 'att', 'def'] as const).map((t) => <button key={t} style={st.team === t ? on : btn} onClick={() => setSt((s) => ({ ...s, team: t }))}>{{ both: '两队', att: '蓝队', def: '橙队' }[t]}</button>)}
        </div>
        <div style={{ color: '#9aa3ad', fontSize: 12 }}>种子 · 发型 {st.seeds.hair} · 号码 {st.seeds.number} · 肤色 {st.seeds.skin} · 体型 {st.seeds.build ?? 1} · 球鞋 {st.seeds.boots ?? 1}{'\u3000（拖动旋转，滚轮缩放）'}</div>
      </div>
    </div>
  );
}
