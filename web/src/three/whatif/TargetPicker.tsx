import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Loaded } from '../../data';
import { land, useLand } from '../../whatif/state';
import { runLook } from '../../whatif/offball';
import { L, W } from '../coords';

// Picking where the ball should go (the on-ball what-if, Yi 2026-10-24): while the pause window's "Change the target" is
// on, the pitch takes the pointer; a ring follows it with a line from the player on the ball, and a click (not a drag)
// sets the target and starts the simulation; a lofted pass draws its arc (its real height, onball.ts). An arrow at his
// feet shows the way he faces, and the pause window says how far he must turn for the point under the pointer and how
// long that keeps him on the ball (onball.ts holdFor). Pitch metres: data (x, y) is world (x, z).
// The same file picks a run (the off-ball what-if, step 3, 2026-10-25; RunPicker below) and mounts the shot what-if's
// cone and xG (ShotPlot.tsx): the stage mounts one picker.

const LIFT = 0.03;

/** the what-if's picker on the pitch: where the ball goes, or whose run changes and where he runs */
export function TargetPicker({ data }: { data: Loaded }) {
  return <><PassPicker data={data} /><RunPicker data={data} /></>;
}

// The pass is picked among his options only (Yi, 2026-10-25: "make it only options, we can not set the landing point"):
// the pointer finds the option nearest it (within 2.5 m of where he stands at the pause), which the What-if's scene lights
// and draws the lane to (WhatIfScene.tsx, the Explain kit); a click (not a drag) plays the pass worked out for him.
// Nothing is drawn here: the facing arrow and the rings are gone (Yi: "there is an arrow for the passer, which is not
// needed").
function PassPicker({ data }: { data: Loaded }) {
  const st = useLand(), [down, setDown] = useState<[number, number] | null>(null);
  const fr = data.pkg.frames, fps = data.pkg.meta.fps, nAtt = fr[0].att.length, k0 = Math.min(fr.length - 1, Math.round(st.t0 * fps));
  const posAt = (p: number): [number, number] => { const f = fr[k0], q = p < nAtt ? f.att[p] : f.def[p - nAtt]; return [q[0], q[1]]; };
  const optionAt = (q: [number, number]) => {
    let best: { who: number; d: number } | null = null;
    for (const o of land.get().options ?? []) { const a = posAt(o.who), d = Math.hypot(a[0] - q[0], a[1] - q[1]); if (d < 2.5 && (!best || d < best.d)) best = { who: o.who, d }; }
    return best?.who ?? null;
  };
  const hoverTo = (who: number | null) => { const cur = land.get(); if (cur.hoverWho !== who) land.set({ ...cur, hoverWho: who }); };
  if (st.phase !== 'pick' || st.kind !== 'pass') return null;
  const at = (e: ThreeEvent<PointerEvent>): [number, number] => [Math.max(-L / 2 - 2, Math.min(L / 2 + 2, e.point.x)), Math.max(-W / 2 - 2, Math.min(W / 2 + 2, e.point.z))];
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={LIFT} renderOrder={7}
      onPointerMove={(e) => { e.stopPropagation(); hoverTo(optionAt(at(e))); }}
      onPointerOut={() => hoverTo(null)}
      onPointerDown={(e) => { e.stopPropagation(); setDown([e.clientX, e.clientY]); }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) {
          const who = optionAt(at(e)), o = land.get().options?.find((x) => x.who === who);
          if (o) land.set((s) => ({ ...s, phase: 'computing', target: o.at, toWho: o.who, loft: o.loft, hoverWho: null }));
        }
        setDown(null);
      }}>
      <planeGeometry args={[L + 4, W + 4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// Picking a run: first the teammate (the one nearest the pointer, within 3 m, ringed; the man on the ball and the keeper
// are left out), then where he runs: a line with an arrowhead from him to the pointer, his real run of the next 4 s
// dashed, the length and time in the question card; a click sets it and starts the simulation. While the run plays and
// at its end the chosen run stays drawn, fainter.
const PICK_R = 3, REAL_S = 4;

function RunPicker({ data }: { data: Loaded }) {
  const st = useLand(), [hover, setHover] = useState<[number, number] | null>(null), [down, setDown] = useState<[number, number] | null>(null);
  const on = st.kind === 'run' && st.phase === 'pick', shown = st.kind === 'run' && (st.phase === 'sim' || st.phase === 'result' || st.phase === 'computing');
  const fr = data.pkg.frames, fps = data.pkg.meta.fps, nAtt = fr[0].att.length;
  const k0 = Math.min(fr.length - 1, Math.round(st.t0 * fps));
  const posAt = (k: number, p: number): [number, number] => { const f = fr[Math.min(fr.length - 1, Math.max(0, k))], q = p < nAtt ? f.att[p] : f.def[p - nAtt]; return [q[0], q[1]]; };
  // the teammates who can be picked, where they stand at the moment
  const mates = useMemo(() => {
    if (st.carrier < 0) return [];
    const team = st.carrier < nAtt ? [...Array(nAtt).keys()] : [...Array(fr[0].def.length).keys()].map((i) => nAtt + i), keepers = new Set((data.pkg as { keepers?: number[] }).keepers ?? []);
    return team.filter((p) => p !== st.carrier && !keepers.has(p)).map((p) => ({ p, at: posAt(k0, p) }));
  }, [st.carrier, k0, data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const near = (q: [number, number]) => { let best: { p: number; d: number } | null = null; for (const m of mates) { const d = Math.hypot(m.at[0] - q[0], m.at[1] - q[1]); if (d < PICK_R && (!best || d < best.d)) best = { p: m.p, d }; } return best?.p ?? null; };
  const hovered = on && st.runner === null && hover ? near(hover) : null;
  const from = st.runner !== null ? posAt(k0, st.runner) : null;
  // his real run, dashed
  const real = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (st.runner === null || !on) return g;
    const pts = Array.from({ length: Math.round(REAL_S * fps) + 1 }, (_, i) => posAt(k0 + i, st.runner!)).map((q) => new THREE.Vector3(q[0], LIFT, q[1]));
    g.setFromPoints(pts.slice(0, -1).flatMap((a, i) => [a, pts[i + 1]]));
    return g;
  }, [st.runner, on, k0, data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dashed = useRef<THREE.LineSegments>(null);
  useFrame(() => { dashed.current?.computeLineDistances(); });
  // the run: a line and an arrowhead, always three segments (setFromPoints keeps a geometry's first point count)
  const runLine = useMemo(() => new THREE.BufferGeometry(), []);
  const end = on ? (st.runner !== null ? hover : null) : shown ? st.runEnd : null;
  if (from && end) {
    const d = [end[0] - from[0], end[1] - from[1]], dl = Math.max(Math.hypot(d[0], d[1]), 1e-6), u = [d[0] / dl, d[1] / dl], a = Math.min(1.2, dl * 0.4);
    const v = (x: number, y: number) => new THREE.Vector3(x, LIFT + 0.01, y);
    runLine.setFromPoints([v(from[0], from[1]), v(end[0], end[1]), v(end[0], end[1]), v(end[0] - u[0] * a - u[1] * a * 0.5, end[1] - u[1] * a + u[0] * a * 0.5), v(end[0], end[1]), v(end[0] - u[0] * a + u[1] * a * 0.5, end[1] - u[1] * a - u[0] * a * 0.5)]);
  }
  const aim = (q: [number, number]) => {
    if (st.runner === null || !from) return;
    // his velocity as the simulation takes it (onball.ts velOf: the last 0.1 s), so the read-out matches the card
    const a = posAt(k0 - 1, st.runner), v: [number, number] = [(from[0] - a[0]) * fps, (from[1] - a[1]) * fps];
    const r = runLook(from, v, q), cur = land.get();
    if (!cur.runAim || Math.abs(cur.runAim.len - r.len) >= 0.5) land.set({ ...cur, runAim: r });
  };
  if (!on && !shown) return null;
  const at = (e: ThreeEvent<PointerEvent>): [number, number] => [Math.max(-L / 2 - 2, Math.min(L / 2 + 2, e.point.x)), Math.max(-W / 2 - 2, Math.min(W / 2 + 2, e.point.z))];
  const ring = (q: [number, number], r0: number, r1: number, opacity: number) => (
    <mesh position={[q[0], LIFT + 0.01, q[1]]} rotation-x={-Math.PI / 2} renderOrder={8}>
      <ringGeometry args={[r0, r1, 48]} /><meshBasicMaterial color="#ffffff" transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
  return (
    <group>
      {on && (
        <mesh rotation-x={-Math.PI / 2} position-y={LIFT} renderOrder={7}
          onPointerMove={(e) => { e.stopPropagation(); const q = at(e); setHover(q); aim(q); }}
          onPointerOut={() => setHover(null)}
          onPointerDown={(e) => { e.stopPropagation(); setDown([e.clientX, e.clientY]); }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6) {
              const q = at(e), s = land.get();
              if (s.runner === null) { const p = near(q); if (p !== null) land.set({ ...s, runner: p }); }
              else land.set({ ...s, phase: 'computing', runEnd: q, runAim: null });
            }
            setDown(null);
          }}>
          <planeGeometry args={[L + 4, W + 4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {on && st.runner === null && mates.map((m) => <group key={m.p}>{ring(m.at, 0.75, 0.85, m.p === hovered ? 0 : 0.35)}</group>)}
      {hovered !== null && ring(posAt(k0, hovered), 0.75, 1.0, 0.95)}
      {from && ring(from, 0.75, 1.0, shown ? 0.55 : 0.95)}
      {on && st.runner !== null && (
        <lineSegments ref={dashed} geometry={real} renderOrder={8}>
          <lineDashedMaterial color="#ffffff" dashSize={0.6} gapSize={0.4} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
        </lineSegments>
      )}
      {from && end && (
        <lineSegments geometry={runLine} renderOrder={8}>
          <lineBasicMaterial color="#ffffff" transparent opacity={shown ? 0.5 : 0.9} depthWrite={false} toneMapped={false} />
        </lineSegments>
      )}
      {on && st.runner !== null && hover && ring(hover, 0.5, 0.7, 0.9)}
    </group>
  );
}
