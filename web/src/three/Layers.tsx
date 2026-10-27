import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { contourSegments } from './contour';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { MomentPkg } from '../types';
import { L, W, attackingOf, kitOf } from './coords';

const NEUTRAL = new THREE.Color('#3a3f47');
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

const FOCUS_IN = 16, FOCUS_OUT = 34;   // metres from the ball: full strength, then faded out
const focusAt = (x: number, y: number, bx: number, by: number) => {
  const r = Math.hypot(x - bx, y - by);
  return r <= FOCUS_IN ? 1 : r >= FOCUS_OUT ? 0 : 1 - (r - FOCUS_IN) / (FOCUS_OUT - FOCUS_IN);
};

export function PitchControl({ pkg }: { pkg: MomentPkg }) {
  const carrier = pkg.frames[pkg.meta.decision_frame].att[pkg.decision.carrier];
  const tex = useMemo(() => {
    const { w, h, att } = pkg.decision.pitch_control, data = new Uint8Array(w * h * 4), c = new THREE.Color();
    // each side's ground in its team's kit colour, home blue and away orange whichever attacks (coords.ts, Yi 2026-10-23)
    const ATT = new THREE.Color(kitOf('att', attackingOf(pkg.meta)).shirt), DEF = new THREE.Color(kitOf('def', attackingOf(pkg.meta)).shirt);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const r = h - 1 - j, p = att[r * w + i], d = (p - 0.5) * 2, k = (j * w + i) * 4;
      const fade = focusAt(-L / 2 + 0.5 + i, -W / 2 + 0.5 + r, carrier[0], carrier[1]);
      c.copy(NEUTRAL).lerp(d >= 0 ? ATT : DEF, Math.min(1, Math.abs(d)));
      data[k] = c.r * 255; data[k + 1] = c.g * 255; data[k + 2] = c.b * 255; data[k + 3] = fade * (0.04 + 0.4 * Math.abs(d) ** 1.4) * 255;
    }
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    return t;
  }, [pkg]);
  const line = useMemo(() => {
    const { w, h, att } = pkg.decision.pitch_control;
    const seg = contourSegments(att, w, h, 0.5, -L / 2 + 0.5, -W / 2 + 0.5);
    const pos: number[] = [], col: number[] = [];
    for (let i = 0; i < seg.length; i += 4) {
      const fa = focusAt(seg[i], seg[i + 1], carrier[0], carrier[1]), fb = focusAt(seg[i + 2], seg[i + 3], carrier[0], carrier[1]);
      if (fa <= 0 && fb <= 0) continue;
      pos.push(seg[i], 0.04, seg[i + 1], seg[i + 2], 0.04, seg[i + 3]);
      col.push(fa, fa, fa, fb, fb, fb);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [pkg, carrier]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <planeGeometry args={[L, W]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      <lineSegments geometry={line}>
        <lineBasicMaterial vertexColors transparent opacity={0.75} depthWrite={false} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

/** Pulsing ring under the ball carrier at the decision. */
export function CarrierMark({ pkg }: { pkg: MomentPkg }) {
  const c = pkg.frames[pkg.meta.decision_frame].att[pkg.decision.carrier];
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const k = 1 + 0.12 * Math.sin(clock.elapsedTime * 4);
    ref.current.scale.set(k, k, k);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(clock.elapsedTime * 4);
  });
  return (
    <mesh ref={ref} rotation-x={-Math.PI / 2} position={[c[0], 0.05, c[1]]}>
      <ringGeometry args={[0.85, 1.05, 40]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Segment({ a, b, r, color, opacity, dashed }: { a: THREE.Vector3; b: THREE.Vector3; r: number; color: string; opacity: number; dashed?: boolean }) {
  const pieces = useMemo(() => {
    const out: { p: THREE.Vector3; q: THREE.Quaternion; l: number }[] = [];
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const n = dashed ? Math.max(1, Math.floor(len / 1.4)) : 1;
    for (let s = 0; s < n; s++) {
      const f0 = s / n, f1 = dashed ? f0 + 0.55 / n : 1, p0 = a.clone().lerp(b, f0), p1 = a.clone().lerp(b, f1);
      out.push({ p: p0.clone().add(p1).multiplyScalar(0.5), q, l: p0.distanceTo(p1) });
    }
    return out;
  }, [a, b, dashed]);
  return <group>{pieces.map((s, i) => (
    <mesh key={i} position={s.p} quaternion={s.q}><cylinderGeometry args={[r, r, s.l, 8]} /><meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} /></mesh>
  ))}</group>;
}

export function Options({ pkg, selected, showTags }: { pkg: MomentPkg; selected: number | null; showTags: boolean }) {
  const d = pkg.decision, fr = pkg.frames[pkg.meta.decision_frame], c = fr.att[d.carrier];
  const from = useMemo(() => new THREE.Vector3(c[0], 0.12, c[1]), [c]);
  const top = useMemo(() => new Set(d.options.map((o, i) => ({ o, i })).filter(({ o }) => o.kind !== 'hold').sort((a, b) => b.o.ev - a.o.ev).slice(0, 4).map(({ i }) => i)), [d]);
  return (
    <group>
      {d.options.map((o, i) => {
        if (o.kind === 'hold') return null;
        const to = new THREE.Vector3(o.target[0], 0.12, o.target[1]);
        const best = i === d.best, chosen = i === d.chosen, sel = i === selected;
        const strong = best || chosen || sel;
        const color = best ? '#ffffff' : '#9cc6f5';
        return (
          <group key={i}>
            <Segment a={from} b={to} r={best || sel ? 0.16 : 0.07} color={color} opacity={strong ? 0.95 : 0.35} dashed={chosen} />
            <mesh rotation-x={-Math.PI / 2} position={[o.target[0], 0.04, o.target[1]]}>
              <ringGeometry args={[0.55, 0.8, 32]} /><meshBasicMaterial color={color} transparent opacity={strong ? 0.95 : 0.4} depthWrite={false} toneMapped={false} />
            </mesh>
            {showTags && (strong || top.has(i)) && (
              <Html position={[o.target[0], 1.9, o.target[1]]} zIndexRange={[8, 0]}>
                <div className={`tag3d${best ? ' best' : ''}`}>{o.kind === 'pass' ? `#${o.teammate}` : o.kind.toUpperCase()} {pct(o.ev)}<i>{best ? 'BEST' : chosen ? 'HIS CHOICE' : ''}</i></div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

export function Vision({ pkg }: { pkg: MomentPkg }) {
  const v = pkg.decision.vision;
  if (!v) return null;
  const fr = pkg.frames[pkg.meta.decision_frame], c = fr.att[pkg.decision.carrier];
  const rad = THREE.MathUtils.degToRad;
  const fan = (half: number, r: number, op: number) => (
    <mesh rotation-x={-Math.PI / 2} position={[c[0], 0.03, c[1]]}>
      <circleGeometry args={[r, 64, -v.yaw - rad(half), rad(2 * half)]} />
      <meshBasicMaterial color="#ffffff" transparent opacity={op} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
  const ring = (p: [number, number], k: string) => (
    <mesh key={k} rotation-x={-Math.PI / 2} position={[p[0], 0.05, p[1]]}>
      <ringGeometry args={[0.9, 1.05, 32]} /><meshBasicMaterial color="#b9c0cc" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
  );
  return (
    <group>
      {fan(v.peripheral_half_deg, 26, 0.04)}
      {fan(v.view_half_deg, 26, 0.09)}
      {v.outside_view_att.map((i) => ring(fr.att[i], `a${i}`))}
      {v.outside_view_def.map((i) => ring(fr.def[i], `d${i}`))}
    </group>
  );
}
